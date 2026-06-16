/**
 * Round 21 — Illrigger Weapon Masteries display, Combat Masteries panel, and the
 * attacks-per-Attack-action count.
 *
 * Covers four real-character bugs (validated against a Hochling Illrigger L10):
 *  - #6/#9 The Combat Masteries panel and the Weapon Mastery badges shared the DOM id
 *    `charsheet-combat-masteries` (declared twice in the HTML). getElementById returns
 *    the first, so renderCombatMasteries() clobbered the badge container and the real
 *    Combat Masteries section never populated. The section container is now the unique
 *    `charsheet-combat-masteries-panel`.
 *  - #5 The Lies weapon picker only listed configured attacks (getAttacks); equipped
 *    melee weapons that are not yet configured attacks were missing. It now merges
 *    equipped melee weapons.
 *  - #11 No `attackCount` was surfaced. getFeatureCalculations() now exposes a generic
 *    `attackCount`, and the combat tab renders an attacks-per-Attack-action banner.
 *
 * State assertions are behavioural reads; the render-layer fixes (jsdom can't measure
 * cleanly) are pinned at source level, mirroring CharacterSheetCombatTabLayout.
 */

import fs from "fs";
import path from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const REPO_ROOT = process.cwd();
const html = fs.readFileSync(path.resolve(REPO_ROOT, "charactersheet.html"), "utf8");
const combatSrc = fs.readFileSync(path.resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

function makeState (classes, abilities = {}) {
	const state = new CharacterSheetState();
	const ab = {str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 18, ...abilities};
	Object.entries(ab).forEach(([k, v]) => state.setAbilityBase(k, v));
	(Array.isArray(classes) ? classes : [classes]).forEach(c => state.addClass(c));
	return state;
}

function liesFeature () {
	return {name: "Lies", source: "IllriggerRevised", optionalFeatureTypes: ["IllMastery"]};
}

// ---------------------------------------------------------------------------
// #11 — attackCount calc field (generic, single source of truth)
// ---------------------------------------------------------------------------
describe("#11 attackCount calc field", () => {
	it("is 1 for a class without Extra Attack", () => {
		const state = makeState({name: "Wizard", source: "PHB", level: 10});
		expect(state.getFeatureCalculations().attackCount).toBe(1);
	});

	it("is 2 for an Illrigger at level 5+ (Extra Attack)", () => {
		const below = makeState({name: "Illrigger", source: "IllriggerRevised", level: 4});
		expect(below.getFeatureCalculations().attackCount).toBe(1);

		const at = makeState({name: "Illrigger", source: "IllriggerRevised", level: 5});
		expect(at.getFeatureCalculations().attackCount).toBe(2);

		const high = makeState({name: "Illrigger", source: "IllriggerRevised", level: 10});
		expect(high.getFeatureCalculations().attackCount).toBe(2);
	});

	it("follows Fighter Extra Attack scaling (2 / 3 / 4)", () => {
		expect(makeState({name: "Fighter", source: "PHB", level: 5}).getFeatureCalculations().attackCount).toBe(2);
		expect(makeState({name: "Fighter", source: "PHB", level: 11}).getFeatureCalculations().attackCount).toBe(3);
		expect(makeState({name: "Fighter", source: "PHB", level: 20}).getFeatureCalculations().attackCount).toBe(4);
	});

	it("takes the maximum across a multiclass (no stacking)", () => {
		const state = makeState([
			{name: "Fighter", source: "PHB", level: 11},
			{name: "Illrigger", source: "IllriggerRevised", level: 5},
		]);
		expect(state.getFeatureCalculations().attackCount).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// #6/#9 — duplicate-id clobber fixed (HTML + combat source)
// ---------------------------------------------------------------------------
describe("#6/#9 Combat Masteries no longer shares the weapon-mastery id", () => {
	it("declares the badge container id exactly once", () => {
		const matches = html.match(/id="charsheet-combat-masteries"/g) || [];
		expect(matches.length).toBe(1);
	});

	it("gives the Combat Masteries section a distinct panel container id", () => {
		expect(html).toContain(`id="charsheet-combat-masteries-section"`);
		expect(html).toContain(`id="charsheet-combat-masteries-panel"`);
	});

	it("renderCombatMasteries targets the distinct panel container, not the badge id", () => {
		const m = combatSrc.match(/renderCombatMasteries\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		expect(body).toContain(`getElementById("charsheet-combat-masteries-panel")`);
		expect(body).not.toContain(`getElementById("charsheet-combat-masteries")`);
	});
});

// ---------------------------------------------------------------------------
// #5 — Lies picker lists all equipped melee weapons
// ---------------------------------------------------------------------------
describe("#5 Lies weapon picker merges equipped melee weapons", () => {
	it("builds the option list from configured attacks AND equipped weapons", () => {
		const m = combatSrc.match(/renderCombatMasteries\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		// Reads configured attacks…
		expect(body).toContain("this._state.getAttacks?.()");
		// …and merges equipped weapons (not getAttacks-only).
		expect(body).toContain("this._state.getItems?.()");
		expect(body).toMatch(/i\.weapon && i\.equipped/);
	});

	it("Lies CHA bonus still resolves for the chosen weapon (behaviour preserved)", () => {
		const state = makeState({name: "Illrigger", source: "IllriggerRevised", level: 5}, {str: 10, dex: 12, cha: 18});
		state.addFeature(liesFeature());
		state.setLiesWeaponType("Rapier");
		const bonus = state.getLiesWeaponBonus({name: "Rapier", abilityMod: "dex"});
		// CHA +4 vs DEX +1 → +3 favourable swing.
		expect(bonus).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// #11 — attacks-per-action banner in the combat tab
// ---------------------------------------------------------------------------
describe("#11 attacks-per-Attack-action banner", () => {
	it("renderAttacks emits a banner gated on attackCount > 1", () => {
		const m = combatSrc.match(/renderAttacks\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		expect(body).toContain("attackCount");
		expect(body).toContain("per Attack action");
		expect(body).toContain("charsheet__attacks-per-action");
	});
});

// ---------------------------------------------------------------------------
// Real-character-equivalent: Illrigger L10 with persisted weapon masteries + Lies
// ---------------------------------------------------------------------------
describe("real-character-equivalent Illrigger L10 load", () => {
	const charJson = {
		fileType: "character",
		name: "R21 Hellspeaker",
		classes: [{
			name: "Illrigger",
			source: "TGTT-IllR",
			level: 10,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "TGTT-IllR"},
		}],
		abilities: {str: 10, dex: 16, con: 14, int: 10, wis: 12, cha: 19},
		features: [{name: "Lies", source: "IllriggerRevised", optionalFeatureTypes: ["IllMastery"]}],
		weaponMasteries: ["Rapier|XPHB", "Quarterstaff|XPHB"],
		illriggerLiesWeapon: "Rapier",
	};

	it("preserves persisted weapon masteries and surfaces all the calc flags", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(JSON.parse(JSON.stringify(charJson)));
		const calc = state.getFeatureCalculations();

		expect(state.getWeaponMasteries()).toEqual(["Rapier|XPHB", "Quarterstaff|XPHB"]);
		expect(calc.weaponMasteryCount).toBe(2);
		expect(calc.hasWeaponMastery).toBe(true);
		expect(calc.hasLiesMastery).toBe(true);
		expect(calc.hasCombatMastery).toBe(true);
		expect(calc.hasExtraAttack).toBe(true);
		expect(calc.attackCount).toBe(2);
		expect(state.getNumberOfAttacks()).toBe(2);
	});
});
