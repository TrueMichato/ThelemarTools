#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Auto-generates `test/e2e/utils/tgttFeaturePools.ts` from
 * `homebrew/TravelersGuidetoThelemar.json`.
 *
 * Usage:
 *   node scripts/genTgttPools.mjs
 *
 * Run after editing the homebrew JSON whenever a Specialty, Battle
 * Tactic, Metamagic, Eldritch Invocation, Jester Act, Trickster Trick,
 * Precise Strike, Pact Boon, Dreamwalker call/study, or per-tradition
 * combat-method pool changes. The generator is deterministic — same
 * input produces byte-identical output.
 *
 * Pools emitted:
 *   - TGTT_SPECIALTIES + TGTT_SPECIALTY_LEVELS + TGTT_SPECIALTY_FIRST_PICK
 *   - TGTT_BATTLE_TACTICS + TGTT_BATTLE_TACTICS_CUM
 *   - TGTT_METAMAGIC                (MM)
 *   - TGTT_ELDRITCH_INVOCATIONS     (EI)
 *   - TGTT_JESTER_ACTS              (JA)
 *   - TGTT_TRICKSTER_TRICKS         (TT)
 *   - TGTT_PRECISE_STRIKES          (PS)
 *   - TGTT_PACT_BOONS               (PB)
 *   - TGTT_DREAMWALKER_CUSTOMS      (DW:C)
 *   - TGTT_DREAMWALKER_SPECIALS     (DW:S)
 *   - TGTT_COMBAT_METHODS_BY_TRADITION
 *
 * The hand-written `XPHB_WEAPON_MASTERY_EFFECTS` and the per-pick
 * `*_EFFECTS` maps live in a sibling file
 * (`tgttFeatureEffects.ts`) — they are NOT auto-generated.
 */

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOMEBREW_PATH = path.join(ROOT, "homebrew", "TravelersGuidetoThelemar.json");
const FIRSTPARTY_OPT_PATH = path.join(ROOT, "data", "optionalfeatures.json");
const FIRSTPARTY_BESTIARY_DIR = path.join(ROOT, "data", "bestiary");
const OUT_PATH = path.join(ROOT, "test", "e2e", "utils", "tgttFeaturePools.ts");

const raw = fs.readFileSync(HOMEBREW_PATH);
const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
const data = JSON.parse(raw.toString("utf8"));

// First-party optional features (XPHB / PHB / XGE / TCE etc.) — used for
// cross-source picker pools (Warlock can pick XPHB Eldritch Invocations,
// Sorcerer can pick XPHB Metamagic, Arcane Archer Fighter picks XGE
// Arcane Shots, etc.). Optional file — generator works if absent.
let firstPartyOptional = [];
try {
	firstPartyOptional = JSON.parse(fs.readFileSync(FIRSTPARTY_OPT_PATH, "utf8")).optionalfeature ?? [];
} catch (e) {
	console.warn(`[warn] Could not load ${FIRSTPARTY_OPT_PATH}: ${e.message}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a name into an anchored case-insensitive RegExp literal source. */
function nameToRegexLiteral (name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	return `/^${escaped}$/i`;
}

/** Render a string array as a TS RegExp[] literal (sorted alphabetically). */
function renderRegexArray (names, indentTabs = 1) {
	const sorted = [...names].sort((a, b) => a.localeCompare(b));
	const pad = "\t".repeat(indentTabs + 1);
	if (!sorted.length) return "[]";
	return `[\n${sorted.map(n => `${pad}${nameToRegexLiteral(n)},`).join("\n")}\n${"\t".repeat(indentTabs)}]`;
}

/** Get the deterministic auto-picker first choice from a string list. */
function firstChoice (names) {
	const sorted = [...names].sort((a, b) => a.localeCompare(b));
	return sorted[0];
}

// ── Specialties (Class-feature "Specialties" pick-list) ──────────────────────

const specialtiesByClass = {};
const specialtyLevelsByClass = {};

for (const f of (data.classFeature ?? [])) {
	if (f.name !== "Specialties") continue;
	const cls = f.className;
	specialtyLevelsByClass[cls] ??= new Set();
	specialtyLevelsByClass[cls].add(f.level);

	for (const entry of (f.entries ?? [])) {
		if (typeof entry !== "object" || entry?.type !== "options") continue;
		for (const opt of (entry.entries ?? [])) {
			if (opt?.type !== "refClassFeature") continue;
			const ref = opt.classFeature ?? "";
			const optName = ref.split("|")[0];
			if (!optName) continue;
			specialtiesByClass[cls] ??= new Set();
			specialtiesByClass[cls].add(optName);
		}
	}
}

const specialtyClassesSorted = Object.keys(specialtiesByClass).sort();
const specialtyLevels = Object.fromEntries(
	specialtyClassesSorted.map(cls => [cls, [...specialtyLevelsByClass[cls]].sort((a, b) => a - b)]),
);
const specialtyPools = Object.fromEntries(
	specialtyClassesSorted.map(cls => [cls, [...specialtiesByClass[cls]]]),
);

// ── Optional-feature pools by featureType ────────────────────────────────────

const optionalByType = {};
for (const o of (data.optionalfeature ?? [])) {
	for (const t of (o.featureType ?? [])) {
		optionalByType[t] ??= new Set();
		optionalByType[t].add(o.name);
	}
}
const poolFor = (t) => [...(optionalByType[t] ?? [])];

const battleTactics = poolFor("BT");
const metamagic = poolFor("MM");
const invocations = poolFor("EI");
const jesterActs = poolFor("JA");
const tricksterTricks = poolFor("TT");
const preciseStrikes = poolFor("PS");
const pactBoons = poolFor("PB");
const dreamwalkerCustoms = poolFor("DW:C");
const dreamwalkerSpecials = poolFor("DW:S");

// ── Cross-source optional-feature pools ──────────────────────────────────────
// Bucket first-party optional features by (featureType, source). We only emit
// pools for source / featureType combinations our specs actually use.

const FIRSTPARTY_BUCKETS = {
	EI: ["XPHB", "XGE", "PHB", "TCE"], // Eldritch Invocations
	MM: ["XPHB", "PHB", "TCE"], // Metamagic
	AS: ["XGE"], // Arcane Shot
	"MV:B": ["XPHB", "PHB", "TCE"], // Battle Master Maneuvers
	PB: ["XPHB", "PHB", "TCE"], // Pact Boons
};
// Generated var-name prefix per featureType (sanitized — no colons).
const FIRSTPARTY_PREFIX = {
	EI: "EI", MM: "MM", AS: "AS", "MV:B": "MVB", PB: "PB",
};

const firstPartyPools = {}; // {featureType: {source: [names]}}
for (const o of firstPartyOptional) {
	for (const t of (o.featureType ?? [])) {
		if (!FIRSTPARTY_BUCKETS[t]) continue;
		if (!FIRSTPARTY_BUCKETS[t].includes(o.source)) continue;
		firstPartyPools[t] ??= {};
		firstPartyPools[t][o.source] ??= new Set();
		firstPartyPools[t][o.source].add(o.name);
	}
}

// ── Subclass-feature catalogs ────────────────────────────────────────────────
// Some TGTT subclasses enumerate their option list as individual
// `subclassFeature` entries (rather than a single picker feature with
// `refOptionalfeature` children). The clearest example is Zodiac Druid:
// 12 forms at L3 + 12 more at L10. We hand-list which catalogs to emit so
// we don't false-positive on subclass-feature SECTIONS that happen to
// share a level.

const CATALOG_SPEC = [
	{varName: "ZODIAC_FORMS_L3",
		className: "Druid",
		subShort: "Zodiac",
		level: 3,
		exclude: [/^Zodiac Form: /i, /^Circle of the Zodiac$/i]},
	{varName: "ZODIAC_FORMS_L10",
		className: "Druid",
		subShort: "Zodiac",
		level: 10,
		exclude: [/^Zodiac Form: /i]},
	// NOTE: Debilitation Monk Precise Strike Methods are NOT a catalog —
	// they are `PS` optional features picked from a pool, already covered
	// by buildPreciseStrikeChecks() (Monk Debilitation only).
];
const catalogPools = {};
for (const spec of CATALOG_SPEC) {
	const matches = (data.subclassFeature ?? []).filter(sf =>
		sf.className === spec.className
		&& sf.subclassShortName === spec.subShort
		&& sf.level === spec.level
		&& !spec.exclude.some(re => re.test(sf.name)),
	);
	catalogPools[spec.varName] = matches.map(sf => sf.name);
}

// Battle Tactics cumulative grant table (Fighter): L3 → 2 picks, L7 → +1, L10 → +1, L15 → +1.
const battleTacticsCum = {3: 2, 7: 3, 10: 4, 15: 5};

// ── Combat methods by tradition ──────────────────────────────────────────────

const combatMethodsByTradition = {};
for (const m of (data.combatMethod ?? [])) {
	const t = m.tradition;
	if (!t) continue;
	combatMethodsByTradition[t] ??= new Set();
	combatMethodsByTradition[t].add(m.name);
}
const combatMethodsByTraditionEntries = Object.entries(combatMethodsByTradition)
	.sort((a, b) => a[0].localeCompare(b[0]))
	.map(([t, set]) => [t, [...set]]);

// ── Combat method progression, per class ─────────────────────────────────────
// How MANY methods a character knows is a class-table column ("Methods Known"),
// so it is data rather than derivation. WHICH methods they know is not
// knowable here: tradition access is a build-time choice, so two characters of
// the same class and level can hold disjoint method sets.
const combatMethodsKnown = {};
for (const c of (data.class ?? [])) {
	for (const g of (c.classTableGroups ?? [])) {
		const idx = (g.colLabels ?? []).findIndex(l => /methods known/i.test(String(l)));
		if (idx < 0) continue;
		const vals = (g.rows ?? []).map(r => {
			let v = r?.[idx];
			if (v && typeof v === "object") v = v.value ?? 0;
			const n = Number(v);
			return Number.isFinite(n) ? n : 0;
		});
		if (vals.some(v => v > 0)) combatMethodsKnown[c.name] = vals;
	}
}

// A few features GRANT a method outright instead of adding a pick. Those stack
// ON TOP of the class table, so the total a character holds is table + grants.
// Counting them matters: without them the expected total is too low, and a
// too-low expectation would silently mask that many genuinely-lost picks.
//
// There are TWO shapes, and they need separate scans:
//   1. NAMED class grants — "gain the {@combatmethod Groundshatter}". Ranger's
//      Primal Focus Upgrade is the only one. These can be asserted by name.
//   2. UNNAMED subclass grants — "you learn one additional method from this
//      tradition". 27 of these exist (Fighter 11, Monk 14, Paladin 1, Rogue 1),
//      and Eldritch Knight grants TWO. They carry no name, so they can only
//      feed the COUNT, and they make the total subclass-dependent.
const combatMethodAutoGrants = {};
const combatMethodSubclassGrants = {};
const WORD_NUM = {a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5};
for (const kind of ["classFeature", "subclassFeature"]) {
	for (const f of (data[kind] ?? [])) {
		const text = JSON.stringify(f.entries ?? "");
		if (!combatMethodsKnown[f.className]) continue;

		const names = [...text.matchAll(/gain the \{@combatmethod ([^}|]+)/gi)].map(m => m[1].trim());
		if (names.length && kind === "classFeature") {
			(combatMethodAutoGrants[f.className] ??= [])
				.push({level: f.level, names: [...new Set(names)].sort()});
			continue;
		}

		if (kind !== "subclassFeature") continue;
		const m = /learn\s+(\w+)\s+additional\s+methods?/i.exec(text);
		const count = m ? WORD_NUM[m[1].toLowerCase()] ?? Number(m[1]) : null;
		if (!count || !Number.isFinite(count)) continue;
		((combatMethodSubclassGrants[f.className] ??= {})[f.subclassShortName] ??= [])
			.push({level: f.level, count});
	}
}
for (const list of Object.values(combatMethodAutoGrants)) list.sort((a, b) => a.level - b.level);
for (const bySub of Object.values(combatMethodSubclassGrants)) {
	for (const list of Object.values(bySub)) list.sort((a, b) => a.level - b.level);
}

// ── Render ────────────────────────────────────────────────────────────────

const header = `/**
 * TGTT Feature Pools — Auto-generated. Do not edit by hand.
 *
 * Source:        homebrew/TravelersGuidetoThelemar.json (sha256:${hash})
 * Generator:     scripts/genTgttPools.mjs
 * Regenerate:    node scripts/genTgttPools.mjs
 *
 * Pools below are consumed by the comprehensive E2E character build
 * tests in test/e2e/specs/tgtt-*.spec.ts via the build*Checks helpers
 * at the bottom of this file.
 *
 * The per-pick effect maps (TGTT_SPECIALTY_EFFECTS,
 * TGTT_METAMAGIC_EFFECTS, etc.) and the hand-written XPHB pools live
 * in tgttFeatureEffects.ts — that file is NOT auto-generated.
 */

import type {EffectCheck, FeatureCheck} from "./comprehensiveBuildHelpers";
import {
\tTGTT_BATTLE_TACTIC_EFFECTS,
\tTGTT_DREAMWALKER_CUSTOM_EFFECTS,
\tTGTT_DREAMWALKER_SPECIAL_EFFECTS,
\tTGTT_ELDRITCH_INVOCATION_EFFECTS,
\tTGTT_JESTER_ACT_EFFECTS,
\tTGTT_METAMAGIC_EFFECTS,
\tTGTT_PACT_BOON_EFFECTS,
\tTGTT_PRECISE_STRIKE_EFFECTS,
\tTGTT_SPECIALTY_EFFECTS,
\tTGTT_TRICKSTER_TRICK_EFFECTS,
\tXPHB_WEAPON_MASTERY_EFFECTS,
\tXPHB_INVOCATION_EFFECTS,
\tXPHB_METAMAGIC_EFFECTS,
\tXGE_ARCANE_SHOT_EFFECTS,
\tXPHB_MANEUVER_EFFECTS,
\tXPHB_PACT_BOON_EFFECTS,
\tZODIAC_FORM_EFFECTS,
} from "./tgttFeatureEffects";

`;

// Specialties block.
const specialtiesBody = `// ── Specialties (Class-feature "Specialties" pick-list at progression levels) ──
export const TGTT_SPECIALTIES: Record<string, RegExp[]> = {
${specialtyClassesSorted.map(cls => `\t${cls}: ${renderRegexArray(specialtyPools[cls], 1)},`).join("\n")}
};

// Levels at which each TGTT class gains a Specialty pick (cumulative).
export const TGTT_SPECIALTY_LEVELS: Record<string, number[]> = {
${specialtyClassesSorted.map(cls => `\t${cls}: [${specialtyLevels[cls].join(", ")}],`).join("\n")}
};

// Auto-picker's deterministic first choice (alphabetical) per class.
// Used as the key into TGTT_SPECIALTY_EFFECTS.
export const TGTT_SPECIALTY_FIRST_PICK: Record<string, string> = {
${specialtyClassesSorted.map(cls => `\t${cls}: ${JSON.stringify(firstChoice(specialtyPools[cls]))},`).join("\n")}
};
`;

// Optional-feature pool blocks.
function poolBlock (label, comment, varName, pool) {
	const lines = [];
	lines.push(`// ── ${label} ──`);
	lines.push(`// ${comment}`);
	lines.push(`export const ${varName}: RegExp[] = ${pool.length ? renderRegexArray(pool, 0) : "[]"};`);
	const fc = pool.length ? firstChoice(pool) : undefined;
	const firstPickConst = `${varName}_FIRST_PICK`;
	lines.push(`export const ${firstPickConst}: string${fc ? "" : " | undefined"} = ${fc ? JSON.stringify(fc) : "undefined"};`);
	lines.push("");
	return lines.join("\n");
}

const battleTacticsBody = `${poolBlock(
	"Battle Tactics (BT)",
	"featureType BT — Fighter Battle Tactics options.",
	"TGTT_BATTLE_TACTICS",
	battleTactics,
)}// Cumulative Battle Tactics picks at each Fighter level.
export const TGTT_BATTLE_TACTICS_CUM: Record<number, number> = ${
	JSON.stringify(battleTacticsCum).replace(/"/g, "")
};
`;

const optionalPoolsBody = [
	poolBlock("Metamagic (MM)", "featureType MM — Sorcerer Metamagic options.", "TGTT_METAMAGIC", metamagic),
	poolBlock("Eldritch Invocations (EI)", "featureType EI — TGTT-flavoured Warlock Invocations.", "TGTT_ELDRITCH_INVOCATIONS", invocations),
	poolBlock("Jester Acts (JA)", "featureType JA — Jester Bard subclass acts.", "TGTT_JESTER_ACTS", jesterActs),
	poolBlock("Trickster Tricks (TT)", "featureType TT — Trickster Rogue subclass tricks.", "TGTT_TRICKSTER_TRICKS", tricksterTricks),
	poolBlock("Precise Strike Methods (PS)", "featureType PS — Monk Debilitation Precise Strike Methods pool.", "TGTT_PRECISE_STRIKES", preciseStrikes),
	poolBlock("Pact Boons (PB)", "featureType PB — TGTT Warlock Pact Boon variants.", "TGTT_PACT_BOONS", pactBoons),
	poolBlock("Dreamwalker Customs (DW:C)", "featureType DW:C — Dreamwalker calls / customs.", "TGTT_DREAMWALKER_CUSTOMS", dreamwalkerCustoms),
	poolBlock("Dreamwalker Specials (DW:S)", "featureType DW:S — Dreamwalker studies / specials.", "TGTT_DREAMWALKER_SPECIALS", dreamwalkerSpecials),
].join("\n");

const combatMethodsBody = `// ── Combat Methods grouped by tradition (TGTT) ──
// Each combat tradition has its own pool of methods of varying degrees;
// the Fighter / Monk / etc. Combat Methods feature picks from the
// pool of every tradition the character knows.
export const TGTT_COMBAT_METHODS_BY_TRADITION: Record<string, RegExp[]> = {
${combatMethodsByTraditionEntries
		.map(([t, names]) => `\t${JSON.stringify(t)}: ${renderRegexArray(names, 1)},`)
		.join("\n")}
};

// ── Combat Method progression per class (TGTT) ──
// "Methods Known" straight off each class table, indexed by class level - 1
// (so [0] is level 1). This is the number of methods a character PICKS.
export const TGTT_COMBAT_METHODS_KNOWN: Record<string, number[]> = {
${Object.keys(combatMethodsKnown).sort()
		.map(cls => `\t${JSON.stringify(cls)}: [${combatMethodsKnown[cls].join(", ")}],`)
		.join("\n")}
};

// Methods GRANTED outright by a class feature (not picked). These stack on top
// of the table above, so a character's total = table value + every grant whose
// level they have reached.
export const TGTT_COMBAT_METHOD_AUTO_GRANTS: Record<string, Array<{level: number; names: string[]}>> = {
${Object.keys(combatMethodAutoGrants).sort()
		.map(cls => `\t${JSON.stringify(cls)}: [${combatMethodAutoGrants[cls]
			.map(g => `{level: ${g.level}, names: [${g.names.map(n => JSON.stringify(n)).join(", ")}]}`)
			.join(", ")}],`)
		.join("\n")}
};

// Methods granted outright by a SUBCLASS feature — "you learn one additional
// method from this tradition". These carry no method name, so they can only
// feed the expected COUNT, and they make the total subclass-dependent: a
// TGTT Monk 3 picks 2 from the class table and is granted 1 more by whichever
// subclass it took, for a true total of 3. Omitting them under-counts by
// exactly the grant, which is indistinguishable from a lost pick.
export const TGTT_COMBAT_METHOD_SUBCLASS_GRANTS: Record<string, Record<string, Array<{level: number; count: number}>>> = {
${Object.keys(combatMethodSubclassGrants).sort()
		.map(cls => `\t${JSON.stringify(cls)}: {\n${Object.keys(combatMethodSubclassGrants[cls]).sort()
			.map(sub => `\t\t${JSON.stringify(sub)}: [${combatMethodSubclassGrants[cls][sub]
				.map(g => `{level: ${g.level}, count: ${g.count}}`)
				.join(", ")}],`)
			.join("\n")}\n\t},`)
		.join("\n")}
};
`;

// Cross-source pool blocks (one named export per (featureType, source)).
function crossSourcePoolBody () {
	const blocks = ["// ── Cross-source first-party picker pools ──"];
	blocks.push("// One named export per (featureType × source). Specs that pick from");
	blocks.push("// multiple sources should use the buildAny*Checks helpers below to");
	blocks.push("// union the relevant pools.");
	blocks.push("");
	for (const t of Object.keys(FIRSTPARTY_BUCKETS).sort()) {
		const prefix = FIRSTPARTY_PREFIX[t];
		for (const src of FIRSTPARTY_BUCKETS[t]) {
			const names = [...(firstPartyPools[t]?.[src] ?? new Set())];
			const varName = `${prefix}_${src}`;
			blocks.push(`export const ${varName}: RegExp[] = ${names.length ? renderRegexArray(names, 0) : "[]"};`);
			const fc = names.length ? firstChoice(names) : undefined;
			blocks.push(`export const ${varName}_FIRST_PICK: string${fc ? "" : " | undefined"} = ${fc ? JSON.stringify(fc) : "undefined"};`);
		}
		blocks.push("");
	}
	return blocks.join("\n");
}
const crossSourceBody = crossSourcePoolBody();

// Subclass-feature catalog blocks.
function catalogBody () {
	const blocks = ["// ── Subclass-feature catalogs ──"];
	blocks.push("// Subclasses that enumerate options as individual subclassFeature");
	blocks.push("// entries (NOT pickers) — every catalog entry surfaces on the sheet");
	blocks.push("// for any character of that subclass at the appropriate level.");
	blocks.push("");
	for (const spec of CATALOG_SPEC) {
		const names = catalogPools[spec.varName] ?? [];
		blocks.push(`// ${spec.className} / ${spec.subShort} L${spec.level}`);
		blocks.push(`export const ${spec.varName}: RegExp[] = ${names.length ? renderRegexArray(names, 0) : "[]"};`);
		blocks.push(`export const ${spec.varName}_LEVEL: number = ${spec.level};`);
		blocks.push("");
	}
	return blocks.join("\n");
}
const catalogsBodyOut = catalogBody();

// Helpers block — read from a separate file, not from JSON.
const helpersBody = fs.readFileSync(path.join(__dirname, "_genTgttPools.helpers.ts"), "utf8");

const fileContents = [
	header,
	specialtiesBody,
	"\n",
	battleTacticsBody,
	"\n",
	optionalPoolsBody,
	combatMethodsBody,
	"\n",
	crossSourceBody,
	"\n",
	catalogsBodyOut,
	"\n",
	helpersBody,
].join("");

fs.writeFileSync(OUT_PATH, fileContents);
console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (sha256:${hash})`);
console.log(`  Specialties classes:    ${specialtyClassesSorted.length}`);
console.log(`  Battle Tactics:         ${battleTactics.length}`);
console.log(`  Metamagic:              ${metamagic.length}`);
console.log(`  Eldritch Invocations:   ${invocations.length}`);
console.log(`  Jester Acts:            ${jesterActs.length}`);
console.log(`  Trickster Tricks:       ${tricksterTricks.length}`);
console.log(`  Precise Strikes:        ${preciseStrikes.length}`);
console.log(`  Pact Boons:             ${pactBoons.length}`);
console.log(`  Dreamwalker (C/S):      ${dreamwalkerCustoms.length}/${dreamwalkerSpecials.length}`);
console.log(`  Combat Method traditions: ${combatMethodsByTraditionEntries.length}`);
console.log(`  Combat Method progressions: ${Object.keys(combatMethodsKnown).sort().join(", ")}`);
for (const [cls, grants] of Object.entries(combatMethodAutoGrants).sort()) {
	console.log(`    auto-granted (${cls}): ${grants.map(g => `L${g.level} ${g.names.join("+")}`).join(", ")}`);
}
for (const [cls, bySub] of Object.entries(combatMethodSubclassGrants).sort()) {
	const subs = Object.entries(bySub).sort();
	const total = subs.reduce((n, [, list]) => n + list.reduce((m, g) => m + g.count, 0), 0);
	console.log(`    subclass-granted (${cls}): ${subs.length} subclasses, ${total} methods total`);
}
console.log(`  Cross-source pools:`);
for (const t of Object.keys(FIRSTPARTY_BUCKETS).sort()) {
	for (const src of FIRSTPARTY_BUCKETS[t]) {
		const n = (firstPartyPools[t]?.[src]?.size) ?? 0;
		console.log(`    ${FIRSTPARTY_PREFIX[t]}_${src}: ${n}`);
	}
}
console.log(`  Catalogs:`);
for (const spec of CATALOG_SPEC) {
	console.log(`    ${spec.varName}: ${(catalogPools[spec.varName] ?? []).length}`);
}
