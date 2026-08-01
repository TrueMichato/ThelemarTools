#!/usr/bin/env node
/* eslint-disable no-console */
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
// It also reports two classes of PREDETERMINED-OUTCOME PROBE — assertions
// whose result is fixed by the harness's own shape, independent of any
// product behaviour. Both have shipped here, and both read as product
// findings until someone measures them:
//
//   1. INERT LEVEL WINDOWS — rows whose `[level, untilLevel]` span
//      contains none of the MEGA checkpoints, and which therefore never
//      execute. Worse than a `skip: true` because they leave no marker to
//      grep for, and without this check they would still count towards
//      `effects` — laundering dead probes as coverage. Cannot FAIL.
//
//   2. UNREACHABLE PICK THRESHOLDS — a `pickedCount: N` asserted against
//      a pool holding fewer than N options, either written literally in a
//      spec or derived by a `build*Checks` helper from a levels table.
//      A stale generated pool (one entry dropped, or a straight
//      apostrophe turned curly so its regex can no longer match) makes
//      the last milestone permanently red. Cannot PASS.
//
// The checkpoint list is read out of `characterSpecFactory.ts` so it
// cannot drift. Pool sizes are resolved conservatively — flat arrays,
// keyed `Record<string, RegExp[]>` maps, spec-local aliases and inline
// arrays — and anything unresolvable is skipped rather than guessed at,
// so this reports no false positives.
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
const FACTORY_PATH = path.join(ROOT, "test", "e2e", "utils", "characterSpecFactory.ts");
const STRICT = process.argv.includes("--strict");
const QUIET = process.argv.includes("--quiet");

const COVERAGE_WARN_THRESHOLD = 0.80;

function log (...args) { if (!QUIET) console.log(...args); }
function warn (...args) { console.warn(...args); }

/**
 * The MEGA matrix only evaluates the features matrix at a fixed set of
 * levels. Read them out of the factory rather than hard-coding, so this
 * audit cannot silently drift if the checkpoint list changes.
 */
function readCheckpoints () {
	const FALLBACK = [3, 5, 11, 17, 20];
	try {
		const src = fs.readFileSync(FACTORY_PATH, "utf8");
		const m = src.match(/const\s+checkpoints\s*=\s*\[([\d,\s]+)\]/);
		if (!m) return FALLBACK;
		const parsed = m[1].split(",").map(s => Number(s.trim())).filter(Number.isFinite);
		return parsed.length ? parsed : FALLBACK;
	} catch {
		return FALLBACK;
	}
}

const CHECKPOINTS = readCheckpoints();

/** Extract the balanced `{...}` literal that starts at `start`. */
function readObjectLiteral (src, start) {
	let depth = 0;
	for (let j = start; j < src.length; ++j) {
		if (src[j] === "{") ++depth;
		else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
	}
	return null;
}

/**
 * A features-matrix row is only ever evaluated at a checkpoint that falls
 * inside its `[level, untilLevel]` window. A row whose window contains no
 * checkpoint NEVER RUNS — its probes are dead code that nothing reports,
 * which is strictly worse than a `skip: true` because there is no marker
 * to grep for. Without this check such rows still count towards
 * `effects`, so the audit would launder them as covered.
 */
function findInertRows (src) {
	const out = [];
	const re = /\{\s*level:\s*(\d+)/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		const obj = readObjectLiteral(src, m.index);
		if (!obj) continue;
		const until = obj.match(/untilLevel:\s*(\d+)/);
		if (!until) continue; // open-ended windows always reach the last checkpoint
		const lo = Number(m[1]);
		const hi = Number(until[1]);
		if (CHECKPOINTS.some(c => c >= lo && c <= hi)) continue;
		out.push({
			line: src.slice(0, m.index).split("\n").length,
			window: `L${lo}-${hi}`,
			name: (obj.match(/name:\s*([^,\n]+)/)?.[1] || "?").trim().slice(0, 40),
			hasProbes: RE_HAS_PROBES.test(obj),
		});
	}
	return out;
}

const POOLS_PATH = path.join(ROOT, "test", "e2e", "utils", "tgttFeaturePools.ts");

/** Extract the balanced `[...]` or `{...}` literal starting at `start`. */
function readBracketed (src, start) {
	const open = src[start];
	if (open !== "[" && open !== "{") return null;
	const close = open === "[" ? "]" : "}";
	let depth = 0;
	for (let j = start; j < src.length; ++j) {
		if (src[j] === open) ++depth;
		else if (src[j] === close && --depth === 0) return src.slice(start, j + 1);
	}
	return null;
}

// Count regex literals in a pool body. Generated pools are anchored
// (`/^Foo$/i`) but hand-written inline pools in specs are not
// (`/archery/i`), so anchoring the count on `/^` silently reports every
// inline pool as size 0 — which reads as "unresolvable" and makes the
// reachability check skip exactly the rows a human wrote by hand.
// Match an `effects:` block, tolerating an inline TypeScript type
// assertion (`effects: <EffectCheck[]>[…]`). Three specs use that form,
// and matching only `effects: [` reported them as having no probes at
// all — including inside the inert-window detector, where it downgraded
// a dead probe to "no probes attached".
const RE_EFFECTS = /\beffects:\s*(?:<[^>]*>\s*)?\[/;
const RE_HAS_PROBES = /\beffects:\s*(?:<[^>]*>\s*)?\[|\bpickedCount:/;

// Count regex literals in a pool body. Generated pools are anchored
// (`/^Foo$/i`) but hand-written inline pools in specs are not
// (`/archery/i`), so anchoring the count on `/^` silently reports every
// inline pool as size 0 — which reads as "unresolvable" and makes the
// reachability check skip exactly the rows a human wrote by hand.
const countPatterns = body => (body.match(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*/g) || []).length;

/**
 * Map every resolvable pool name to how many option patterns it holds —
 * both flat `const NAME = [/^…$/i, …]` arrays and keyed
 * `Record<string, RegExp[]>` maps (recorded as `NAME` for the whole map
 * and `NAME.Key` per entry). Used to prove a `pickedCount` is reachable.
 */
function collectPools (src, into = new Map()) {
	const re = /\b(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=\s*/g;
	let m;
	const aliases = [];
	while ((m = re.exec(src)) !== null) {
		const at = m.index + m[0].length;
		const name = m[1];
		const body = readBracketed(src, at);
		if (!body) {
			// `const FIGHTER_SPECIALTIES = TGTT_SPECIALTIES.Fighter;` — an
			// alias, not a literal. This is the dominant spec idiom, so
			// skipping it would make the check blind to most spec rows.
			const ref = src.slice(at).match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*[;,\n]/)?.[1];
			if (ref) aliases.push([name, ref]);
			continue;
		}
		into.set(name, countPatterns(body));
		if (body[0] !== "{") continue;
		const keyed = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[/g;
		let k;
		while ((k = keyed.exec(body)) !== null) {
			const arr = readBracketed(body, k.index + k[0].length - 1);
			if (arr) into.set(`${name}.${k[1]}`, countPatterns(arr));
		}
	}
	// Resolve transitively; a fixed number of passes is enough and cannot loop.
	for (let pass = 0; pass < 4; ++pass) {
		for (const [name, ref] of aliases) {
			if (!into.has(name) && into.has(ref)) into.set(name, into.get(ref));
		}
	}
	return into;
}

let SHARED_POOLS = null;
function sharedPools () {
	if (!SHARED_POOLS) {
		try { SHARED_POOLS = collectPools(fs.readFileSync(POOLS_PATH, "utf8")); } catch { SHARED_POOLS = new Map(); }
	}
	return SHARED_POOLS;
}

/**
 * The dual of an inert row. A row asserting `pickedCount: N` against a
 * pool holding fewer than N options can NEVER PASS — it is a permanent
 * red whose outcome is fixed by the harness's own shape, independent of
 * any product behaviour. This is how the stale generated pool presented:
 * a Barbarian L20 assertion was structurally unsatisfiable and was filed
 * as a product bug for as long as it stood.
 *
 * Two sources of demand, because most specs never write `pickedCount`
 * themselves:
 *   - the `build*Checks` helpers in the generated pools file, which
 *     derive it from a levels/progression table, and
 *   - literal `pickedCount` + `pickedFrom` pairs in a spec.
 *
 * Deliberately conservative — anything unresolvable, or any helper
 * referencing more than one pool, is skipped rather than guessed at, so
 * this reports no false positives.
 */
function findUnreachablePicks (src) {
	const pools = collectPools(src, new Map(sharedPools()));
	const out = [];
	// Anchor on `pickedCount` and walk back to the enclosing `{`, rather
	// than on `{ level:`. Key order inside a matrix row is not fixed, and
	// anchoring on a leading key silently drops every row that orders its
	// keys differently — a false-negative mode this audit exists to catch.
	const re = /\bpickedCount:\s*(\d+)/g;
	let m;
	const seen = new Set();
	while ((m = re.exec(src)) !== null) {
		const open = enclosingBrace(src, m.index);
		if (open < 0 || seen.has(open)) continue;
		seen.add(open);
		const obj = readObjectLiteral(src, open);
		if (!obj) continue;
		const want = Number(m[1]);
		const from = obj.match(/pickedFrom:\s*([A-Za-z_][A-Za-z0-9_.]*|\[)/)?.[1];
		if (!Number.isFinite(want) || !from) continue;
		const have = from === "["
			? countPatterns(readBracketed(obj, obj.indexOf("[", obj.indexOf("pickedFrom:"))) || "")
			: pools.get(from);
		if (!Number.isFinite(have) || have === 0) continue; // unresolvable — stay silent
		if (want <= have) continue;
		out.push({
			where: `line ${src.slice(0, open).split("\n").length}`,
			label: (obj.match(/name:\s*([^,\n]+)/)?.[1] || "?").trim().slice(0, 34),
			want,
			pool: from === "[" ? "(inline)" : from,
			have,
		});
	}
	return out;
}

/** Index of the `{` opening the object literal containing `at`, or -1. */
function enclosingBrace (src, at) {
	let depth = 0;
	for (let i = at; i >= 0; --i) {
		const c = src[i];
		if (c === "}") ++depth;
		else if (c === "{") {
			if (depth === 0) return i;
			--depth;
		}
	}
	return -1;
}

/**
 * The same invariant one level up, inside the generated pools file. A
 * `build*Checks` helper hands out one cumulative pick per milestone, so
 * its pool must hold at least as many options as its largest
 * `pickedCount`. A pool that goes stale — an entry dropped, or a regex
 * that can no longer match because a straight apostrophe became curly —
 * silently makes the last milestone unsatisfiable in every spec that
 * spreads the helper.
 */
function findUnreachableHelpers () {
	const src = (() => {
		try { return fs.readFileSync(POOLS_PATH, "utf8"); } catch { return ""; }
	})();
	if (!src) return [];
	const pools = sharedPools();
	const out = [];
	const fnRe = /export function (build\w*Checks)\s*\(/g;
	let f;
	while ((f = fnRe.exec(src)) !== null) {
		const bodyStart = src.indexOf("{", src.indexOf(")", f.index));
		const body = readObjectLiteral(src, bodyStart);
		if (!body) continue;

		// Only reason about helpers wired to exactly one option pool.
		const referenced = [...new Set((body.match(/TGTT_[A-Z_]+/g) || []))]
			.filter(n => (pools.get(n) || 0) > 0);
		if (referenced.length !== 1) continue;
		const poolName = referenced[0];

		// Demand: explicit cumulative counts, or one pick per level entry.
		// Keyed tables are compared PER KEY — the max demand of one class
		// against the min pool of another is a cross-class comparison and a
		// guaranteed false positive.
		const cums = [...body.matchAll(/\bcum:\s*(\d+)/g)].map(x => Number(x[1]));
		const perPool = [...pools.keys()].filter(k => k.startsWith(`${poolName}.`));
		if (cums.length) {
			const want = Math.max(...cums);
			const have = perPool.length
				? Math.min(...perPool.map(k => pools.get(k)))
				: pools.get(poolName);
			if (Number.isFinite(have) && have > 0 && want > have) {
				out.push({where: `${f[1]}()`, label: "max cum", want, pool: poolName, have});
			}
			continue;
		}
		if (!/pickedCount:\s*idx\s*\+\s*1/.test(body)) continue;
		const levelsName = body.match(/(TGTT_\w*LEVELS)\[/)?.[1];
		if (!levelsName) continue;
		for (const key of [...pools.keys()].filter(k => k.startsWith(`${levelsName}.`))) {
			const cls = key.slice(levelsName.length + 1);
			const want = countLevels(src, key);
			const have = pools.get(`${poolName}.${cls}`);
			if (!want || !Number.isFinite(have) || have === 0 || want <= have) continue;
			out.push({where: `${f[1]}(${cls})`, label: "levels", want, pool: `${poolName}.${cls}`, have});
		}
	}
	return out;
}

/** Count entries in a keyed `NAME.Key: [a, b, c]` numeric levels array. */
function countLevels (src, dottedKey) {
	const [name, key] = dottedKey.split(".");
	const at = src.indexOf(`const ${name}`);
	if (at < 0) return 0;
	const map = readObjectLiteral(src, src.indexOf("{", at));
	if (!map) return 0;
	const arr = readBracketed(map, map.indexOf("[", map.indexOf(`${key}:`)));
	if (!arr) return 0;
	return arr.slice(1, -1).split(",").filter(s => s.trim()).length;
}

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
	//
	// Anchored on `{ level: N,` and NOT on `{ level: N, name:` — a row's
	// second key is `untilLevel` whenever it is tiered, and tiering is the
	// idiom this suite has been converging on. The stricter anchor missed
	// 102 entries across 27 of 39 specs, all of them tiered rows, so the
	// denominator shrank exactly where a spec was best written and every
	// coverage figure came out overstated.
	const entryMatches = src.match(/\{\s*level:\s*\d+\s*,/g) || [];
	const entryCount = entryMatches.length;

	// `effects:` blocks attached to entries.
	const effectsBlocks = src.match(new RegExp(RE_EFFECTS.source, "g")) || [];
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
	// that's been deliberately accounted for). Rows sitting in an inert
	// level window are subtracted back out — they carry probes that can
	// never execute, so counting them would overstate coverage.
	const inertRows = findInertRows(src);
	const inertWithProbes = inertRows.filter(r => r.hasProbes).length;
	const unreachablePicks = findUnreachablePicks(src);
	const effective = effectsCount + reasonCount + helperCount + skipReasonCount - inertWithProbes;
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
		inertRows,
		inertWithProbes,
		unreachablePicks,
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
	log(`  ${padR("spec", 48)} ${padL("entries", 8)} ${padL("effects", 8)} ${padL("helpers", 8)} ${padL("reason", 7)} ${padL("skip", 5)} ${padL("inert", 6)} ${padL("cov", 6)}  status`);
	log("─".repeat(96));
	let warnings = 0;
	for (const r of results) {
		const pct = r.entryCount === 0 ? "—   " : `${(r.coverage * 100).toFixed(0).padStart(3)}%`;
		const tag = r.status === "LOW" ? "⚠ LOW " : r.status === "FULL" ? "✓ FULL" : r.status === "EMPTY" ? "  EMPTY" : "  OK  ";
		if (r.status === "LOW") warnings++;
		log(`  ${padR(r.fileName, 48)} ${padL(r.entryCount, 8)} ${padL(r.effectsCount, 8)} ${padL(r.helperCount, 8)} ${padL(r.reasonCount, 7)} ${padL(r.skipCount, 5)} ${padL(r.inertWithProbes || "", 6)} ${padL(pct, 6)}  ${tag}`);
	}
	log("─".repeat(96));
	const totalEntries = results.reduce((a, r) => a + r.entryCount, 0);
	const totalEffects = results.reduce((a, r) => a + r.effectsCount, 0);
	const totalReasons = results.reduce((a, r) => a + r.reasonCount, 0);
	const totalHelpers = results.reduce((a, r) => a + r.helperCount, 0);
	log(`  ${padR(`TOTAL (${results.length} specs)`, 48)} ${padL(totalEntries, 8)} ${padL(totalEffects, 8)} ${padL(totalHelpers, 8)} ${padL(totalReasons, 7)}`);
	log("");
	log(`  Threshold: <${(COVERAGE_WARN_THRESHOLD * 100).toFixed(0)}% effective coverage flags as LOW.`);
	log(`  Effective = effects + reason-comments + helper-uses + skipReason annotations − inert rows.`);
	log("");

	const inertSpecs = results.filter(r => r.inertRows.length);
	const totalInertProbes = results.reduce((a, r) => a + r.inertWithProbes, 0);
	if (inertSpecs.length) {
		log(`  ⚠ Inert level windows — never evaluated at any checkpoint [${CHECKPOINTS.join(", ")}]:`);
		log("");
		for (const r of inertSpecs) {
			for (const row of r.inertRows) {
				const tag = row.hasProbes ? "probes NEVER RUN" : "no probes attached";
				log(`      ${padR(r.fileName, 46)} ${padR(row.window, 8)} line ${padR(row.line, 5)} ${padR(row.name, 40)} ${tag}`);
			}
		}
		log("");
		log(`  ${totalInertProbes} row(s) carry probes that can never execute, across ${inertSpecs.length} spec(s).`);
		log(`  Unlike \`skip: true\` these leave no marker — widen untilLevel to reach a`);
		log(`  checkpoint, or move the row's level to one.`);
		log("");
	}

	const unreachSpecs = results.filter(r => r.unreachablePicks.length);
	const helperUnreachable = findUnreachableHelpers();
	const totalUnreachable = results.reduce((a, r) => a + r.unreachablePicks.length, 0)
		+ helperUnreachable.length;
	if (unreachSpecs.length || helperUnreachable.length) {
		log(`  ⚠ Unreachable pick thresholds — assertion can never pass:`);
		log("");
		for (const row of helperUnreachable) {
			log(`      ${padR("tgttFeaturePools.ts (generated)", 46)} ${padR(row.where, 30)} ${padR(row.label, 10)} wants ${row.want}, ${row.pool} holds ${row.have}`);
		}
		for (const r of unreachSpecs) {
			for (const row of r.unreachablePicks) {
				log(`      ${padR(r.fileName, 46)} ${padR(row.where, 30)} ${padR(row.label, 10)} wants ${row.want}, ${row.pool} holds ${row.have}`);
			}
		}
		log("");
		log(`  ${totalUnreachable} site(s) assert more picks than the pool can supply — a`);
		log(`  permanent red fixed by the harness's own shape, not by the product.`);
		log(`  Usually a stale generated pool: re-run \`node scripts/genTgttPools.mjs\`.`);
		log("");
	}

	if (warnings > 0) {
		log(`  ${warnings} spec(s) below threshold.`);
	}
	if (STRICT && (warnings > 0 || totalInertProbes > 0 || totalUnreachable > 0)) process.exit(1);
}

main();
