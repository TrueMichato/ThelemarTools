#!/usr/bin/env node
// Audit per-spec EffectCheck coverage across TGTT comprehensive build specs.
//
// Walks each `test/e2e/specs/tgtt-*.spec.ts`, parses every `featuresMatrix`
// (and any `*FEATURES_MATRIX` const), and reports per-spec stats:
//
//   spec=<file> entries=N effects=M coverage=M/N skipped=K reason-comments=R
//
// Specs with `coverage < 80%` AND no compensating `// no measurable…`
// comments are flagged as warnings (advisory — does not exit non-zero by
// default; pass `--strict` to exit 1 on any warning).
//
// This is purposely a regex-based scan rather than a full TS parser — the
// matrix shape is uniform enough (FeatureCheck object literals in array
// expressions) that regex handles it well, and we keep the script
// dependency-free.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPECS_DIR = path.join(ROOT, "test", "e2e", "specs");
const STRICT = process.argv.includes("--strict");
const QUIET = process.argv.includes("--quiet");

const COVERAGE_WARN_THRESHOLD = 0.80;

function log (...args) { if (!QUIET) console.log(...args); }
function warn (...args) { console.warn(...args); }

function listSpecs () {
	return fs.readdirSync(SPECS_DIR)
		.filter(f => f.startsWith("tgtt-") && f.endsWith(".spec.ts"))
		.map(f => path.join(SPECS_DIR, f))
		.sort();
}

function auditSpec (specPath) {
	const src = fs.readFileSync(specPath, "utf8");
	const fileName = path.basename(specPath);

	// Count `kind:` occurrences inside FeatureCheck-like object literals.
	// Heuristic: a FeatureCheck row begins with `{level: <n>` and closes
	// at the matching `}`. We count one entry per `level:` followed by a
	// number within a matrix-shaped block.
	const entryMatches = src.match(/\{\s*level:\s*\d+,\s*name:/g) || [];
	const entryCount = entryMatches.length;

	// `effects:` blocks attached to entries.
	const effectsBlocks = src.match(/\beffects:\s*\[/g) || [];
	const effectsCount = effectsBlocks.length;

	// Reason-style comments — both literal `// no measurable …` and
	// inline `// …no clean state probe…`/`CS-BUG-NNN` notes count as
	// auditable acknowledgments that the row is intentionally
	// existence-only. Anything explicitly labelled with a known
	// blocking reason qualifies.
	const reasonComments = src.match(/\/\/[^\n]*(no measurable|no clean (state )?probe|cinematic|CS-BUG-\d+|narrative|capstone[^\n]*no probe)[^\n]*/gi) || [];
	const reasonCount = reasonComments.length;

	// `{skip: true,` skipped probes — and entry-level `skip: true` rows
	// each carry a `skipReason` that documents why no probe runs.
	const skipMatches = src.match(/\bskip:\s*true\b/g) || [];
	const skipCount = skipMatches.length;
	const skipReasonMatches = src.match(/\bskipReason:\s*"/g) || [];
	const skipReasonCount = skipReasonMatches.length;

	// Helper-driven coverage (build*Checks helpers contribute checks too).
	const helperUsage = src.match(/\b(buildSpecialtyChecks|buildBattleTacticChecks|buildMetamagicChecks|buildInvocationChecks|buildJesterActChecks|buildTricksterTrickChecks|buildPreciseStrikeChecks|buildDreamwalkerChecks|buildWeaponMasteryChecks|buildAnyInvocationChecks|buildAnyMetamagicChecks|buildAnyManeuverChecks|buildAnyArcaneShotChecks|buildAnyPactBoonChecks|buildCatalogChecks|buildZodiacFormChecks)\b/g) || [];
	const helperCount = new Set(helperUsage).size;

	// "Effective" coverage: hand-written effects + reason comments +
	// helper usage + skipReason annotations (each represents a row
	// that's been deliberately accounted for).
	const effective = effectsCount + reasonCount + helperCount + skipReasonCount;
	const coverage = entryCount === 0 ? 1 : effective / entryCount;

	const status =
		entryCount === 0 ? "EMPTY"
		: coverage >= 1 ? "FULL"
		: coverage >= COVERAGE_WARN_THRESHOLD ? "OK"
		: "LOW";

	return {
		fileName,
		entryCount,
		effectsCount,
		reasonCount,
		skipCount,
		helperCount,
		coverage,
		status,
	};
}

function main () {
	const specs = listSpecs();
	if (!specs.length) {
		warn("No tgtt-*.spec.ts files found.");
		process.exit(0);
	}

	const results = specs.map(auditSpec);

	const padR = (s, n) => String(s).padEnd(n);
	const padL = (s, n) => String(s).padStart(n);

	log("");
	log("E2E spec EffectCheck coverage:");
	log("─".repeat(96));
	log(`  ${padR("spec", 48)} ${padL("entries", 8)} ${padL("effects", 8)} ${padL("helpers", 8)} ${padL("reason", 7)} ${padL("skip", 5)} ${padL("cov", 6)}  status`);
	log("─".repeat(96));
	let warnings = 0;
	for (const r of results) {
		const pct = r.entryCount === 0 ? "—   " : `${(r.coverage * 100).toFixed(0).padStart(3)}%`;
		const tag = r.status === "LOW" ? "⚠ LOW " : r.status === "FULL" ? "✓ FULL" : r.status === "EMPTY" ? "  EMPTY" : "  OK  ";
		if (r.status === "LOW") warnings++;
		log(`  ${padR(r.fileName, 48)} ${padL(r.entryCount, 8)} ${padL(r.effectsCount, 8)} ${padL(r.helperCount, 8)} ${padL(r.reasonCount, 7)} ${padL(r.skipCount, 5)} ${padL(pct, 6)}  ${tag}`);
	}
	log("─".repeat(96));
	const totalEntries = results.reduce((a, r) => a + r.entryCount, 0);
	const totalEffects = results.reduce((a, r) => a + r.effectsCount, 0);
	const totalReasons = results.reduce((a, r) => a + r.reasonCount, 0);
	const totalHelpers = results.reduce((a, r) => a + r.helperCount, 0);
	log(`  ${padR(`TOTAL (${results.length} specs)`, 48)} ${padL(totalEntries, 8)} ${padL(totalEffects, 8)} ${padL(totalHelpers, 8)} ${padL(totalReasons, 7)}`);
	log("");
	log(`  Threshold: <${(COVERAGE_WARN_THRESHOLD * 100).toFixed(0)}% effective coverage flags as LOW.`);
	log(`  Effective = effects + reason-comments + helper-uses + skipReason annotations.`);
	log("");
	if (warnings > 0) {
		log(`  ${warnings} spec(s) below threshold.`);
		if (STRICT) process.exit(1);
	}
}

main();
