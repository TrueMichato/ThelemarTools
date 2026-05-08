#!/usr/bin/env node
/**
 * Auto-generates `test/e2e/utils/tgttFeaturePools.ts` from
 * `homebrew/TravelersGuidetoThelemar.json`.
 *
 * Usage:
 *   node scripts/genTgttPools.mjs
 *
 * Run after editing the homebrew JSON whenever a Specialty, Battle
 * Tactic, Metamagic, Eldritch Invocation, Jester Act, Trickster Trick,
 * Painful Strike, Pact Boon, Dreamwalker call/study, or per-tradition
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
 *   - TGTT_PAINFUL_STRIKES          (PS)
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
const OUT_PATH = path.join(ROOT, "test", "e2e", "utils", "tgttFeaturePools.ts");

const raw = fs.readFileSync(HOMEBREW_PATH);
const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
const data = JSON.parse(raw.toString("utf8"));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a name into an anchored case-insensitive RegExp literal source. */
function nameToRegexLiteral (name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
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
const painfulStrikes = poolFor("PS");
const pactBoons = poolFor("PB");
const dreamwalkerCustoms = poolFor("DW:C");
const dreamwalkerSpecials = poolFor("DW:S");

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
\tTGTT_PAINFUL_STRIKE_EFFECTS,
\tTGTT_SPECIALTY_EFFECTS,
\tTGTT_TRICKSTER_TRICK_EFFECTS,
\tXPHB_WEAPON_MASTERY_EFFECTS,
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
	poolBlock("Painful Strikes (PS)", "featureType PS — Painful / pugilistic strikes pool.", "TGTT_PAINFUL_STRIKES", painfulStrikes),
	poolBlock("Pact Boons (PB)", "featureType PB — TGTT Warlock Pact Boon variants.", "TGTT_PACT_BOONS", pactBoons),
	poolBlock("Dreamwalker Customs (DW:C)", "featureType DW:C — Dreamwalker calls / customs.", "TGTT_DREAMWALKER_CUSTOMS", dreamwalkerCustoms),
	poolBlock("Dreamwalker Specials (DW:S)", "featureType DW:S — Dreamwalker studies / specials.", "TGTT_DREAMWALKER_SPECIALS", dreamwalkerSpecials),
].join("\n");

const combatMethodsBody = `// ── Combat Methods grouped by tradition (TGTT) ──
// Each combat tradition has its own pool of methods of varying degrees;
// the Fighter / Pugilist / etc. Combat Methods feature picks from the
// pool of every tradition the character knows.
export const TGTT_COMBAT_METHODS_BY_TRADITION: Record<string, RegExp[]> = {
${combatMethodsByTraditionEntries
		.map(([t, names]) => `\t${JSON.stringify(t)}: ${renderRegexArray(names, 1)},`)
		.join("\n")}
};
`;

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
console.log(`  Painful Strikes:        ${painfulStrikes.length}`);
console.log(`  Pact Boons:             ${pactBoons.length}`);
console.log(`  Dreamwalker (C/S):      ${dreamwalkerCustoms.length}/${dreamwalkerSpecials.length}`);
console.log(`  Combat Method traditions: ${combatMethodsByTraditionEntries.length}`);
