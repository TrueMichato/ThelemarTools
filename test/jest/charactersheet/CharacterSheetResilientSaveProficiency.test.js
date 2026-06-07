/**
 * Resilient (and other save-granting feats) — grant proficiency in the chosen save.
 *
 * Covers the Resilient bug (bugs.md → Feats): the half-feat raised the chosen ability
 * by 1 but never granted proficiency in that ability's saving throw, because neither
 * the central `applyFeatBonuses` nor the Features-tab inline apply read
 * `feat.savingThrowProficiencies`. The save is implicitly tied to the chosen ability
 * (one pick), resolved by `CharacterSheetClassUtils.resolveFeatSaveProficiencies`.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;

// Resilient: half-feat — choose ability +1 AND save proficiency in that ability.
const RESILIENT_PHB = {
	name: "Resilient",
	source: "PHB",
	ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"], amount: 1}}],
	savingThrowProficiencies: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}}],
};

const RESILIENT_XPHB = {...RESILIENT_PHB, source: "XPHB"};

describe("resolveFeatSaveProficiencies", () => {
	it("ties a choose-block save to the chosen ability (Resilient)", () => {
		expect(ClassUtils.resolveFeatSaveProficiencies(RESILIENT_PHB, {ability: "con"})).toEqual(["con"]);
	});

	it("returns nothing for a choose-block when no ability was chosen", () => {
		expect(ClassUtils.resolveFeatSaveProficiencies(RESILIENT_PHB, {})).toEqual([]);
	});

	it("respects a `from` allowlist (chosen ability not in list → none)", () => {
		const feat = {savingThrowProficiencies: [{choose: {from: ["str", "con"]}}]};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {ability: "wis"})).toEqual([]);
	});

	it("resolves a pre-resolved {con: true} object form", () => {
		const feat = {savingThrowProficiencies: [{con: true}]};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {})).toEqual(["con"]);
	});

	it("resolves a plain string form", () => {
		const feat = {savingThrowProficiencies: ["wis"]};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {})).toEqual(["wis"]);
	});

	it("accepts a single (non-array) object", () => {
		const feat = {savingThrowProficiencies: {dex: true}};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {})).toEqual(["dex"]);
	});

	it("filters invalid ability abbreviations", () => {
		const feat = {savingThrowProficiencies: ["banana", {xyz: true}]};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {})).toEqual([]);
	});

	it("de-duplicates", () => {
		const feat = {savingThrowProficiencies: ["con", {con: true}]};
		expect(ClassUtils.resolveFeatSaveProficiencies(feat, {})).toEqual(["con"]);
	});

	it("returns [] when the feat has no savingThrowProficiencies", () => {
		expect(ClassUtils.resolveFeatSaveProficiencies({name: "X"}, {ability: "con"})).toEqual([]);
		expect(ClassUtils.resolveFeatSaveProficiencies(null, {})).toEqual([]);
	});
});

describe("applyFeatBonuses grants the Resilient save proficiency", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("grants the chosen save AND the +1 ability (PHB)", () => {
		expect(state.getSaveProficiencies?.() ?? state._data.saveProficiencies).not.toContain("con");
		ClassUtils.applyFeatBonuses(state, RESILIENT_PHB, {ability: "con"});
		expect(state._data.saveProficiencies).toContain("con");
		expect(state.getAbilityBase("con")).toBe(11);
	});

	it("works identically for the XPHB version", () => {
		ClassUtils.applyFeatBonuses(state, RESILIENT_XPHB, {ability: "wis"});
		expect(state._data.saveProficiencies).toContain("wis");
		expect(state.getAbilityBase("wis")).toBe(11);
	});

	it("does not grant a save when no ability was chosen", () => {
		ClassUtils.applyFeatBonuses(state, RESILIENT_PHB, {});
		expect(state._data.saveProficiencies).not.toContain("con");
	});

	it("does not duplicate an already-proficient save", () => {
		state.addSaveProficiency("con");
		ClassUtils.applyFeatBonuses(state, RESILIENT_PHB, {ability: "con"});
		const conCount = state._data.saveProficiencies.filter(s => s === "con").length;
		expect(conCount).toBe(1);
	});

	it("grants a pre-resolved save proficiency", () => {
		ClassUtils.applyFeatBonuses(state, {name: "Save Feat", savingThrowProficiencies: [{dex: true}]}, {});
		expect(state._data.saveProficiencies).toContain("dex");
	});
});
