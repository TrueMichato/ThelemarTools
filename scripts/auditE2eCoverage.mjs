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
// It SELF-CHECKS its own comment blanker (see `findCommentLeaks`), because
// every detector below reads the blanked source and a desynchronised blanker
// corrupts all of them at once, in the direction that manufactures false
// positives rather than losing code.
//
// It also reports four classes of PREDETERMINED-OUTCOME PROBE — assertions
// whose result is fixed by the harness's own shape, independent of any
// product behaviour. All four have shipped here, and every one of them read
// as a product finding until someone measured it:
//
//   1. INERT LEVEL WINDOWS — rows whose `[level, untilLevel]` span
//      contains none of the MEGA checkpoints, and which therefore never
//      execute. Worse than a `skip: true` because they leave no marker to
//      grep for, and without this check they would still count towards
//      `effects` — laundering dead probes as coverage. Cannot FAIL.
//
//      Do not "simplify" this check away. The row's `name:` existence
//      check dies along with its `effects:`, so an inert row means the
//      feature has NO verification of ANY kind at ANY level — not merely
//      a missing numeric assertion. That is a silent hole straight
//      through this batch's acceptance bar (every ability a subclass
//      provides must be offered, shown, AND implemented), and it presents
//      as a green spec. Measured: three permanent Rogue subclass features
//      in tgtt-belly-dancer-rogue-jaknian were wholly unverified this way.
//
//      The general property: a skipped or inert assertion is a FROZEN
//      CLAIM ABOUT A MOVING TARGET, and the freeze is invisible precisely
//      because the test stays green. Live assertions get re-validated
//      continuously; these do not. So they cannot be found by running the
//      suite — only by asking the harness about its own shape, statically,
//      which is what this script exists to do.
//
//   2. UNREACHABLE PICK THRESHOLDS — a `pickedCount: N` asserted against
//      a pool holding fewer than N options, either written literally in a
//      spec or derived by a `build*Checks` helper from a levels table.
//      A stale generated pool (one entry dropped, or a straight
//      apostrophe turned curly so its regex can no longer match) makes
//      the last milestone permanently red. Cannot PASS.
//
// COVERAGE is assertion-based: effects + helper-driven checks + rows whose
// feature a sibling row asserts + rows blocked by a documented CS-BUG,
// minus rows sitting in an inert window. Explanatory comments are counted
// and shown in the `reason` column but do NOT raise coverage — knowing
// about a gap is not the same as closing it, and crediting prose is how
// tgtt-time-domain-cleric came to read 100% FULL while carrying exactly
// ONE mechanical assertion across seventeen features.
//
//   3. VACUOUS SPELL NAME MATCHES — `spellMatchMode: "any"` paired with a
//      non-empty `spell:`. The mode does not RELAX the name match, it
//      DELETES it: in "any" mode the helper never reads `e.spell` and
//      checks only `getKnownSpellsByLevel()[level].length >= 1`. So the
//      probe still reads as a name assertion while asserting only that
//      the character knows at least one spell of that level — something
//      most builds satisfy incidentally. Passes for a DIFFERENT REASON
//      than it appears to. `spell: ""` is the honest form and is ignored.
//
//      This is the third sibling of the property, and the one that was
//      briefly thought to be undetectable-by-machine. It is not: the
//      pairing is a purely static fact about the probe literal.
//
//   4. UNMATCHABLE RESOURCE NAMES — a `kind: "resource"` row whose `name`
//      is a RegExp containing metacharacters, with no `resourceName`
//      override. The matrix resolves the pool with `fc.name.source`, and
//      `getResource()` filters on Playwright's `hasText: <string>` — a
//      LITERAL substring match. So `/^channel divinity$/i` looks for a
//      resource called "^channel divinity$" and always misses. Cannot PASS.
//
//      This one is mostly LATENT, which is what makes it the sharpest of
//      the family: all six instances found suite-wide sit under a
//      `skip: true` citing an UNRELATED product bug. They cost nothing
//      today and detonate the moment someone lifts that skip — then
//      present as "the product bug I just un-skipped is still broken",
//      sending the next author to debug the product instead of the
//      harness. So: a skipped assertion is not inert, it is ARMED. It
//      freezes its own claim about the product AND any latent defect in
//      the probe itself, and both stay invisible because the suite is green.
//
//      Fix by adding `resourceName: "<exact name>"`. Never widen the
//      regex — it is the correct FEATURE matcher (`/^channel divinity$/i`
//      properly excludes "Channel Divinity: Temporal Manipulation");
//      only the pool lookup needs its own exact key.
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

/**
 * Classify every matrix row once, so a single bare row cannot be credited
 * twice by two different mechanisms.
 *
 * A row with `effects:` is covered outright. A BARE row is accounted for
 * if EITHER a sibling row of the same name carries the probes, OR the
 * author left an explanatory comment immediately above it. Sibling cover
 * wins, and rows carrying their own `skipReason` are left to the separate
 * skipReason tally -- so the three credits are mutually exclusive.
 *
 * This replaced a LEXICAL reason-comment counter that matched a fixed
 * vocabulary (`no measurable`, `no clean probe`, `cinematic`, `narrative`,
 * `CS-BUG-NNN`). That counter was not merely narrow, it was UNCORRELATED
 * with the thing it claimed to measure, in both directions:
 *
 *   - tgtt-daemonologist-wizard-dwarf documents all five of its gaps
 *     ("the factory has no ritual-cast probe", "no deterministic matrix
 *     delta", "auto-picked and therefore not deterministic", ...) and
 *     scored ZERO, because it used none of the blessed words. It was the
 *     suite's worst-scoring spec at 32% as a direct result.
 *   - tgtt-arcana-cleric scored SIX reason credits while having ZERO bare
 *     rows -- pure phantom coverage, since there was no gap for any of
 *     them to account for. tgtt-tempest-cleric likewise, and
 *     battle-master / astral-self / shadow-magic each banked credits for
 *     comments sitting on rows that already had effects.
 *
 * So it penalised authors for writing specific reasons instead of
 * boilerplate, while rewarding specs that had nothing to explain. Being
 * bounded by the bare-row count is what stops the second failure mode:
 * you cannot be credited for explaining a gap you do not have.
 */
function classifyRows (src) {
	const lines = src.split("\n");
	const lineStarts = [];
	{
		let at = 0;
		for (const ln of lines) { lineStarts.push(at); at += ln.length + 1; }
	}
	const lineOf = (idx) => {
		let lo = 0; let hi = lineStarts.length - 1;
		while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
		return lo;
	};

	const rows = [];
	const re = /\{\s*level:\s*\d+\s*,/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		const obj = readObjectLiteral(src, m.index);
		if (!obj) continue;
		const name = obj.match(/name:\s*("[^"]*"|\/[^/\n]*\/[a-z]*)/)?.[1] || null;
		let k = lineOf(m.index) - 1;
		while (k >= 0 && /^\s*$/.test(lines[k])) --k;
		const commented = k >= 0
			&& /^\s*\/\//.test(lines[k])
			&& !/^\s*\/\/\s*(TODO|FIXME|XXX)\b/i.test(lines[k]);
		rows.push({name, hasEffects: RE_EFFECTS.test(obj), hasSkipReason: /\bskipReason:/.test(obj), commented});
	}

	const assertedNames = new Set(rows.filter(r => r.hasEffects && r.name).map(r => r.name));
	let siblingCovered = 0; let explained = 0; let bare = 0; let unaccounted = 0;
	for (const r of rows) {
		if (r.hasEffects) continue;
		++bare;
		if (r.name && assertedNames.has(r.name)) { ++siblingCovered; continue; }
		if (r.hasSkipReason) continue; // counted by the skipReason tally
		if (r.commented) { ++explained; continue; }
		++unaccounted;
	}
	return {siblingCovered, explained, bare, unaccounted};
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

/**
 * Blank out comments while PRESERVING length and newlines, so every index
 * and reported line number stays valid against the original source.
 *
 * Needed because this file's own warning prose quotes the dangerous form
 * verbatim (`{spell: "Bane", spellMatchMode: "any"}`) in four specs. A
 * detector that fires on the documentation warning against it is noise,
 * and noisy checks get switched off — which would cost us the real
 * instances it exists to find.
 *
 * String and template literals are tracked so a `//` inside one is not
 * mistaken for a comment, and REGEX literals are tracked so an apostrophe
 * inside one (`name: /granny'?s gifts/i` — 7 specs carry this shape) does
 * not open a phantom string that swallows every comment until the next
 * apostrophe. That bug was live in the first version of this function and
 * produced exactly the false positive it exists to prevent: proof that a
 * tool for finding shape-determined results is itself subject to them.
 */
function blankComments (src) {
	const out = src.split("");
	let i = 0;
	const n = src.length;
	const blank = (from, to) => {
		for (let k = from; k < to && k < n; ++k) if (out[k] !== "\n") out[k] = " ";
	};
	// A `/` starts a regex (rather than division) when the previous
	// meaningful character opens an expression position.
	const prevMeaningful = (at) => {
		for (let k = at - 1; k >= 0; --k) if (!/\s/.test(src[k])) return src[k];
		return "";
	};
	while (i < n) {
		const c = src[i];
		if (c === "\"" || c === "'" || c === "`") {
			const quote = c;
			++i;
			while (i < n && src[i] !== quote) {
				if (src[i] === "\\") ++i;
				++i;
			}
			++i;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			let j = i;
			while (j < n && src[j] !== "\n") ++j;
			blank(i, j);
			i = j;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const j = src.indexOf("*/", i + 2);
			const end = j < 0 ? n : j + 2;
			blank(i, end);
			i = end;
			continue;
		}
		if (c === "/" && ":,([=!&|?{;+*%^~<>".includes(prevMeaningful(i))) {
			let j = i + 1;
			let inClass = false;
			while (j < n && src[j] !== "\n") {
				if (src[j] === "\\") { j += 2; continue; }
				if (src[j] === "[") inClass = true;
				else if (src[j] === "]") inClass = false;
				else if (src[j] === "/" && !inClass) break;
				++j;
			}
			i = j + 1;
			continue;
		}
		++i;
	}
	return out.join("");
}

/**
 * `spellMatchMode: "any"` does NOT relax the name match — it DELETES it.
 * In "any" mode `comprehensiveBuildHelpers.ts` never reads `e.spell` and
 * checks only `getKnownSpellsByLevel()[level].length >= 1`. So pairing it
 * with a NON-EMPTY `spell:` yields a probe that cannot fail for the
 * reason its author intended: the name is silently discarded while the
 * spec still reads as a name assertion.
 *
 * `spell: ""` is the honest form — it makes "count only" explicit — so it
 * is not reported.
 */
function findVacuousSpellMatches (rawSrc) {
	const src = blankComments(rawSrc);
	const out = [];
	// Anchor on the mode and walk back to the enclosing `{`; key order
	// inside a matrix effect is not fixed.
	const re = /\bspellMatchMode:\s*["']any["']/g;
	let m;
	const seen = new Set();
	while ((m = re.exec(src)) !== null) {
		const open = enclosingBrace(src, m.index);
		if (open < 0 || seen.has(open)) continue;
		seen.add(open);
		const obj = readObjectLiteral(src, open);
		if (!obj) continue;
		const spell = obj.match(/\bspell:\s*(["'])((?:\\.|(?!\1).)*)\1/);
		if (!spell) continue; // no literal `spell:` — unresolvable, stay silent
		if (spell[2].trim() === "") continue; // honest form
		out.push({
			where: `line ${src.slice(0, open).split("\n").length}`,
			spell: spell[2].slice(0, 28),
		});
	}
	return out;
}

/**
 * Detector 4 — resource rows whose pool lookup can never match.
 *
 * `assertFeaturesMatrix` resolves a `kind: "resource"` row's pool with
 * `fc.resourceName ?? (fc.name instanceof RegExp ? fc.name.source : fc.name)`,
 * and `CharacterSheetPage.getResource()` filters with Playwright's
 * `hasText: <string>` — a LITERAL, case-insensitive substring match. So a
 * RegExp `name` is handed to the lookup as its raw `.source`: `/^channel
 * divinity$/i` searches for a resource literally called "^channel divinity$".
 * No rendered resource contains regex metacharacters, so the lookup always
 * misses and line 2342 throws `resource not found on sheet`.
 *
 * This is the cannot-PASS half of the predetermined-outcome property, and it
 * is mostly LATENT: every instance found so far sits under a `skip: true`
 * citing an unrelated product bug. It detonates when someone lifts that skip
 * — and then presents as "the product bug I just un-skipped is still broken",
 * sending the next author to debug the product instead of the harness.
 * The fix is never to widen the regex: add `resourceName: "<exact name>"`,
 * which keeps the regex as the FEATURE matcher and gives the pool its own key.
 */
function findUnmatchableResourceNames (rawSrc) {
	const src = blankComments(rawSrc);
	const out = [];
	// Metacharacters that cannot appear in a rendered resource label. `.` and
	// `-` are deliberately excluded — they are legal literal text, so flagging
	// them would produce false positives.
	const FATAL = /[$^|\\[\]()*+?{}]/;
	const re = /\bkind:\s*["']resource["']/g;
	let m;
	const seen = new Set();
	while ((m = re.exec(src)) !== null) {
		const open = enclosingBrace(src, m.index);
		if (open < 0 || seen.has(open)) continue;
		seen.add(open);
		const obj = readObjectLiteral(src, open);
		if (!obj) continue;
		if (/\bresourceName:/.test(obj)) continue; // explicit override — fine
		const nm = obj.match(/\bname:\s*\/((?:\\.|[^/\\])*)\//);
		if (!nm) continue; // string name, or unresolvable — stay silent
		if (!FATAL.test(nm[1])) continue;
		out.push({
			where: `line ${src.slice(0, open).split("\n").length}`,
			name: nm[1].slice(0, 34),
			latent: /\bskip:\s*true/.test(obj),
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

	// Bare rows whose gap the author explained in an adjacent comment.
	// Structural, not lexical: see classifyRows() for why matching a fixed
	// vocabulary measured the wrong thing in both directions.
	const rowClasses = classifyRows(src);
	const reasonCount = rowClasses.explained;

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
	const vacuousSpellMatches = findVacuousSpellMatches(src);
	const unmatchableResources = findUnmatchableResourceNames(src);
	const commentLeaks = findCommentLeaks(src);
	const writeOnlyCalcs = findWriteOnlyCalcProbes(src);
	const siblingCovered = rowClasses.siblingCovered;
	// `reasonCount` is deliberately NOT added. An explanatory comment
	// records that a gap is KNOWN; it does not make the feature verified.
	// This batch's acceptance bar is that every ability a subclass provides
	// is offered, shown, AND mechanically implemented — description-only
	// was explicitly unacceptable — so a row whose only accounting is prose
	// must keep counting against the spec. It is reported in its own
	// column so the backlog stays visible rather than being laundered into
	// the score.
	const effective = effectsCount + helperCount + skipReasonCount + siblingCovered - inertWithProbes;
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
		vacuousSpellMatches,
		unmatchableResources,
		commentLeaks,
		writeOnlyCalcs,
		coverage,
		status,
	};
}

/**
 * SELF-CHECK ON THE BLANKER ITSELF.
 *
 * Every detector in this file reads `blankComments(src)`, so a desynchronised
 * blanker silently corrupts ALL of them at once — and does it in the direction
 * that is hardest to notice: comment prose leaks into the "code" view and
 * manufactures FALSE POSITIVES, rather than losing real code.
 *
 * That is not hypothetical. The blanker has already shipped two bugs (it did
 * not recognise regex literals, so an apostrophe inside `/gambler's folly/i`
 * opened a phantom string that swallowed the rest of the file's comments).
 * Both ran clean before and after; only a deliberately planted instance
 * separated them. A guard never observed firing is indistinguishable from a
 * guard that cannot fire, so the blanker is now PINNED rather than trusted.
 *
 * The invariant: after blanking, no `//` may survive OUTSIDE a string literal.
 * Quoted `//` is legitimate and excluded — `spawn.spec.ts` uses "rogue//1" to
 * mean an empty subclass slot, which is why the naive form of this check has
 * three standing false positives and this form has none.
 *
 * Measured both directions rather than assumed:
 *   fixed blanker  →   0 leaks across all 54 specs
 *   regex branch disabled → 274 leaks across 13 specs
 *
 * Use the LEAK COUNT to tell those apart, never the `--strict` exit code.
 * Leaks are only one of six conditions in that gate, and two of the others
 * (`warnings`, `totalUnmatch`) are non-zero on the shipped tree, so `--strict`
 * exits 1 either way. "It is wired into --strict, therefore --strict
 * discriminates" is true of the wiring and false of the observable.
 *
 * NOTE the first attempt at this invariant asserted that real `kind:` tokens
 * survive blanking. It could never fire, because a phantom string makes the
 * scanner SKIP text rather than blank it — the failure direction is leakage,
 * not loss. It is recorded here so nobody rebuilds the version that cannot
 * fail.
 */
function findCommentLeaks (rawSrc) {
	const blanked = blankComments(rawSrc);
	const out = [];
	blanked.split("\n").forEach((line, i) => {
		const unquoted = line
			.replace(/"(?:[^"\\]|\\.)*"/g, "")
			.replace(/'(?:[^'\\]|\\.)*'/g, "");
		if (/\/\/[^\n]*\S/.test(unquoted)) out.push({line: i + 1, text: line.trim().slice(0, 80)});
	});
	return out;
}

/**
 * WRITE-ONLY FEATURE CALCULATION KEYS (see CS-BUG-093).
 *
 * A `featureCalculation` probe asserts `getFeatureCalculations()[key]`. If
 * NOTHING in `js/` ever reads that key, the probe pins a value the product
 * computes and then discards — it cannot fail when the feature's real surface
 * breaks, because it never touches that surface. That is the same
 * predetermined-outcome property as an inert level window, arrived at from the
 * product side rather than the harness side.
 *
 * Framing matters here and the entry deliberately does NOT say "this feature
 * is unimplemented". Write-only is NOT the same as inert: several of these
 * features work perfectly via a different path (the generic feature-uses
 * parser reading the homebrew entry, a dedicated pool, a bespoke renderer),
 * leaving the calc key as redundant dead data beside a working feature. What
 * the check asserts is narrower and always true: THIS PROBE is not watching
 * the surface that would break.
 *
 * ── Scope, and why it is not the whole population ──────────────────────
 * 2114 calc keys are assigned; 1504 are never read by a static reference.
 * Reporting all of them would be worse than useless — noise is how a correct
 * check gets switched off — and a large share are false positives, because
 * the product reads calc keys in ways no reference count can see:
 *
 *   1. SUFFIX READS.  `charactersheet.js` builds the key from the feature's
 *      DISPLAY NAME at runtime: `calc[`${key}Dc`]`, `${key}Damage`,
 *      `${key}SaveAbility`, … So "Decay" reads `decayDc` etc., and a naive
 *      count calls all five of them write-only. Suffixes are discovered from
 *      the source rather than hardcoded, and matching keys are listed
 *      SEPARATELY as candidates instead of being silently dropped —
 *      over-subtraction is also a way to be wrong.
 *   2. DATA-DRIVEN FLAGS.  `calculations[entry.calcFlag] = true` and
 *      `calc[def.calcFlag]` resolve through registries.
 *   3. `getFeatureCalculation(key)` is a public getter by arbitrary string.
 *      In practice it has exactly ONE caller, passing the literal
 *      "rageDamage", so it is not a general escape hatch — but it is why
 *      this check can never be sound enough to gate on.
 *
 * So the check is scoped to keys THE SPECS ACTUALLY PROBE. That is the
 * audit's own subject matter, it is the actionable set, and it keeps the
 * finding at a size someone will read.
 *
 * Deliberately NOT wired to `--strict`: it is a heuristic over a population
 * with known-unresolvable false positives, and a permanently-red gate is a
 * gate nobody runs.
 *
 * Scans `js/` ONLY — never `docs/`. `known-bugs.md` and several spec comments
 * now quote these key names verbatim, and a check that fires on its own
 * documentation is the failure mode detector #3 shipped with.
 */
function readCalcKeyUsage () {
	const jsRoot = path.join(ROOT, "js");
	const files = [];
	(function walk (dir) {
		let entries;
		try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
		for (const e of entries) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".js")) files.push(p);
		}
	})(jsRoot);

	const lineHits = new Map(); // identifier -> number of LINES mentioning it
	const assigned = new Map(); // calc key   -> "file:line" of first assignment
	const suffixes = new Set(); // dynamically-constructed key suffixes
	const RE_ID = /[A-Za-z_$][A-Za-z0-9_$]*/g;
	const RE_ASSIGN = /calculations\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
	const RE_TPL = /(?:calc|calculations)\[`\$\{[^}]+\}([A-Za-z0-9_$]+)`\]/g;

	for (const file of files) {
		const rel = path.relative(ROOT, file);
		const lines = fs.readFileSync(file, "utf8").split("\n");
		for (let i = 0; i < lines.length; ++i) {
			// Line-granularity matches the manual `grep -rn <key> js/ | wc -l`
			// measurement this check was derived from, so the two agree.
			for (const id of new Set(lines[i].match(RE_ID) || [])) lineHits.set(id, (lineHits.get(id) || 0) + 1);
			let m;
			RE_ASSIGN.lastIndex = 0;
			while ((m = RE_ASSIGN.exec(lines[i])) !== null) if (!assigned.has(m[1])) assigned.set(m[1], `${rel}:${i + 1}`);
			RE_TPL.lastIndex = 0;
			while ((m = RE_TPL.exec(lines[i])) !== null) suffixes.add(m[1]);
		}
	}
	return {lineHits, assigned, suffixes};
}

let _calcUsage = null;
const calcUsage = () => (_calcUsage ||= readCalcKeyUsage());

/** Calc keys a spec asserts through `featureCalculation*` probes. */
function probedCalcKeys (rawSrc) {
	// Blanked, not raw: a `property: "…"` inside a comment is prose, and
	// crediting it would let documentation manufacture a finding.
	const src = blankComments(rawSrc);
	const out = [];
	const re = /kind:\s*"featureCalculation(?:DerivedFrom)?"/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		const open = enclosingBrace(src, m.index);
		if (open < 0) continue;
		const body = readObjectLiteral(src, open);
		if (!body) continue;
		const prop = body.match(/\bproperty:\s*"([A-Za-z0-9_$]+)"/);
		if (prop) out.push({key: prop[1], line: src.slice(0, m.index).split("\n").length});
	}
	return out;
}

function findWriteOnlyCalcProbes (rawSrc) {
	const {lineHits, assigned, suffixes} = calcUsage();
	const sufList = [...suffixes];
	const seen = new Set();
	const out = [];
	for (const {key, line} of probedCalcKeys(rawSrc)) {
		if (seen.has(key)) continue;
		seen.add(key);
		if (!assigned.has(key)) continue; // not a calc key at all
		if (lineHits.get(key) !== 1) continue; // has a real reader
		const dynamic = sufList.some(s => key.length > s.length && key.endsWith(s));
		out.push({key, line, site: assigned.get(key), dynamic});
	}
	return out;
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
	log(`  Effective = effects + reason-comments + helper-uses + skipReason annotations\n            + rows whose feature a sibling row asserts − inert rows.`);
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
		const probeSpecs = inertSpecs.filter(r => r.inertWithProbes > 0);
		if (totalInertProbes) {
			log(`  ${totalInertProbes} row(s) carry probes that can never execute, across ${probeSpecs.length} spec(s).`);
		}
		const bare = inertSpecs.reduce((a, r) => a + r.inertRows.filter(x => !x.hasProbes).length, 0);
		if (bare) {
			log(`  ${bare} further inert row(s) attach no probes — the existence check itself never runs.`);
		}
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

	const vacuousSpecs = results.filter(r => r.vacuousSpellMatches.length);
	const totalVacuous = results.reduce((a, r) => a + r.vacuousSpellMatches.length, 0);
	if (vacuousSpecs.length) {
		log(`  ⚠ Vacuous spell name matches — \`spellMatchMode: "any"\` DELETES the name:`);
		log("");
		for (const r of vacuousSpecs) {
			for (const row of r.vacuousSpellMatches) {
				log(`      ${padR(r.fileName, 46)} ${padR(row.where, 30)} spell: "${row.spell}" is never read`);
			}
		}
		log("");
		log(`  ${totalVacuous} probe(s) name a spell that the matcher discards. In "any" mode`);
		log(`  only \`getKnownSpellsByLevel()[level].length >= 1\` is checked, so these`);
		log(`  cannot fail for the reason their author intended. Use exact-name mode,`);
		log(`  or \`spell: ""\` to state "count only" honestly.`);
		log("");
	}

	if (warnings > 0) {
		log(`  ${warnings} spec(s) below threshold.`);
	}

	const woSpecs = results.filter(r => r.writeOnlyCalcs.some(x => !x.dynamic));
	const totalWo = results.reduce((a, r) => a + r.writeOnlyCalcs.filter(x => !x.dynamic).length, 0);
	const totalWoDyn = results.reduce((a, r) => a + r.writeOnlyCalcs.filter(x => x.dynamic).length, 0);
	if (woSpecs.length) {
		log("");
		log(`  \u26a0 featureCalculation probes on WRITE-ONLY keys (CS-BUG-093):`);
		log("");
		const SHOW = process.argv.includes("--write-only-full") ? Infinity : 6;
		for (const r of woSpecs) {
			const rows = r.writeOnlyCalcs.filter(x => !x.dynamic);
			const head = rows.slice(0, SHOW);
			for (const row of head) {
				log(`      ${padR(r.fileName, 46)} line ${padR(row.line, 5)} ${padR(row.key, 34)} assigned ${row.site}`);
			}
			if (rows.length > head.length) {
				log(`      ${padR(r.fileName, 46)} ${padL(`… and ${rows.length - head.length} more`, 12)}`);
			}
		}
		log("");
		log(`  ${totalWo} probe(s) across ${woSpecs.length} spec(s) assert a calc key that nothing in`);
		log(`  js/ reads. The value is computed and discarded, so the probe cannot fail`);
		log(`  when the feature's REAL surface breaks — it never touches it.`);
		log(`  Write-only is NOT the same as unimplemented: many of these features work`);
		log(`  through another path entirely, which is exactly why the probe is looking`);
		log(`  in the wrong place. Prefer the reading surface (getSpeed, getResource,`);
		log(`  aggregateModifiers, a rendered row) over getFeatureCalculations().`);
		if (totalWoDyn) {
			log(`  ${totalWoDyn} further key(s) end in a suffix the product builds dynamically`);
			log(`  (calc[\`\${name}Dc\`] and friends) — excluded from the count as probably read.`);
		}
		log(`  Advisory only, never --strict: reference counting cannot see data-driven`);
		log(`  reads, so a red gate here would be permanent and therefore ignored.`);
		log("");
	}

	const unmatchSpecs = results.filter(r => r.unmatchableResources.length);
	const totalUnmatch = results.reduce((a, r) => a + r.unmatchableResources.length, 0);
	if (unmatchSpecs.length) {
		log(`  \u26a0 Resource rows whose pool lookup can never match:`);
		for (const r of unmatchSpecs) {
			for (const row of r.unmatchableResources) {
				log(`      ${padR(r.fileName, 46)} ${padR(row.where, 30)} name=/${row.name}/ ${row.latent ? "(latent — under skip:true)" : "(LIVE)"}`);
			}
		}
		log(`  ${totalUnmatch} row(s) hand a RegExp \`.source\` to a literal substring match.`);
		log(`  Add \`resourceName: "<exact name>"\`; do NOT widen the regex.`);
		log(``);
	}

	const leakSpecs = results.filter(r => r.commentLeaks.length);
	const totalLeaks = results.reduce((a, r) => a + r.commentLeaks.length, 0);
	if (leakSpecs.length) {
		log(`  \u26a0 BLANKER DESYNC — comment text leaked into the code view:`);
		for (const r of leakSpecs) {
			for (const row of r.commentLeaks.slice(0, 5)) log(`      ${padR(r.fileName, 46)} :${row.line}  ${row.text}`);
		}
		log(`  ${totalLeaks} leak(s). EVERY detector above reads the blanked source, so`);
		log(`  treat their output as unreliable until this is zero.`);
		log(``);
	}

	if (STRICT && (totalLeaks > 0 || warnings > 0 || totalInertProbes > 0 || totalUnreachable > 0 || totalVacuous > 0 || totalUnmatch > 0)) process.exit(1);
}

main();
