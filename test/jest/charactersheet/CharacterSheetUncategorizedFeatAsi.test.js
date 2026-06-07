/**
 * Uncategorized feats default to General → grant a +1 ASI of the player's choice.
 *
 * Covers the Plantmender bug (bugs.md → Feats): a partnered/homebrew feat with no
 * `category` and no `ability` grant was showing no ASI picker and applying nothing.
 * The fix synthesizes a General-feat "+1 to one ability of your choice" grant for
 * any category-less, ASI-less feat, guarded by `!feat.reprintedAs` (Option B) so
 * superseded legacy 2014 feats (Alert/Lucky/Tough) are NOT retroactively buffed.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;

// Plantmender-style: no category, no ability, no reprintedAs.
const PLANTMENDER = {
	name: "Plantmender",
	source: "HWToH",
	entries: ["You gain the ability to mend plants."],
};

describe("featHasAbilityGrant", () => {
	it("is true for a choose-based ASI", () => {
		expect(ClassUtils.featHasAbilityGrant({ability: [{choose: {from: ["str", "dex"]}}]})).toBe(true);
	});

	it("is true for a fixed numeric ASI", () => {
		expect(ClassUtils.featHasAbilityGrant({ability: [{str: 1}]})).toBe(true);
	});

	it("is false when there is no ability array", () => {
		expect(ClassUtils.featHasAbilityGrant(PLANTMENDER)).toBe(false);
	});

	it("is false for an empty ability array", () => {
		expect(ClassUtils.featHasAbilityGrant({ability: []})).toBe(false);
	});

	it("ignores a lone `max` key (no real ability)", () => {
		expect(ClassUtils.featHasAbilityGrant({ability: [{max: 20}]})).toBe(false);
	});
});

describe("featDefaultsToGeneralAsi", () => {
	it("is true for an uncategorized, ASI-less feat (Plantmender)", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi(PLANTMENDER)).toBe(true);
	});

	it("is false for a categorized feat (Fighting Style)", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi({name: "Archery", category: "FS:F"})).toBe(false);
	});

	it("is false for an Origin feat (category O, no ASI)", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi({name: "Alert", category: "O"})).toBe(false);
	});

	it("is false for a feat that already grants an ASI (Forest Sage-style)", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi({name: "Forest Sage", ability: [{choose: {from: ["wis"]}}]})).toBe(false);
	});

	it("is false for a superseded legacy 2014 feat (reprintedAs guard)", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi({name: "Alert", reprintedAs: ["Alert|XPHB"]})).toBe(false);
	});

	it("is false for non-object input", () => {
		expect(ClassUtils.featDefaultsToGeneralAsi(null)).toBe(false);
		expect(ClassUtils.featDefaultsToGeneralAsi(undefined)).toBe(false);
	});
});

describe("getEffectiveFeatAbility", () => {
	it("synthesizes a single +1 choose-from-all ASI for Plantmender", () => {
		const eff = ClassUtils.getEffectiveFeatAbility(PLANTMENDER);
		expect(Array.isArray(eff)).toBe(true);
		expect(eff).toHaveLength(1);
		expect(eff[0].choose.amount).toBe(1);
		expect(eff[0].choose.count).toBe(1);
		expect(eff[0].choose.from).toEqual(Parser.ABIL_ABVS);
	});

	it("passes through a feat's real ability grant unchanged", () => {
		const real = [{choose: {from: ["wis"], amount: 1, count: 1}}];
		expect(ClassUtils.getEffectiveFeatAbility({name: "X", ability: real})).toBe(real);
	});

	it("returns undefined for a categorized feat with no ASI (no synth)", () => {
		expect(ClassUtils.getEffectiveFeatAbility({name: "Alert", category: "O"})).toBeUndefined();
	});

	it("does not synthesize for a superseded legacy 2014 feat", () => {
		expect(ClassUtils.getEffectiveFeatAbility({name: "Alert", reprintedAs: ["Alert|XPHB"]})).toBeUndefined();
	});
});

describe("buildFeatChoicesSpec surfaces the synthesized ASI picker", () => {
	it("sets choices.ability for Plantmender", () => {
		const spec = ClassUtils.buildFeatChoicesSpec(PLANTMENDER);
		expect(spec.ability).toEqual({count: 1, amount: 1, from: Parser.ABIL_ABVS});
	});

	it("leaves choices.ability null for an Origin feat with no ASI", () => {
		const spec = ClassUtils.buildFeatChoicesSpec({name: "Alert", category: "O"});
		expect(spec.ability).toBeNull();
	});

	it("does not surface an ASI for a superseded legacy 2014 feat", () => {
		const spec = ClassUtils.buildFeatChoicesSpec({name: "Alert", reprintedAs: ["Alert|XPHB"]});
		expect(spec.ability).toBeNull();
	});
});

describe("applyFeatBonuses applies the synthesized +1", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("raises the chosen ability base by 1 for Plantmender", () => {
		expect(state.getAbilityBase("str")).toBe(10);
		ClassUtils.applyFeatBonuses(state, PLANTMENDER, {ability: "str"});
		expect(state.getAbilityBase("str")).toBe(11);
	});

	it("does not change abilities for a categorized no-ASI feat", () => {
		ClassUtils.applyFeatBonuses(state, {name: "Alert", category: "O"}, {ability: "str"});
		expect(state.getAbilityBase("str")).toBe(10);
	});

	it("does not synthesize for a superseded legacy 2014 feat", () => {
		ClassUtils.applyFeatBonuses(state, {name: "Alert", reprintedAs: ["Alert|XPHB"]}, {ability: "str"});
		expect(state.getAbilityBase("str")).toBe(10);
	});

	it("does not double-grant for a feat that already has its own ASI", () => {
		const forestSage = {name: "Forest Sage", ability: [{choose: {from: ["wis"], amount: 1, count: 1}}]};
		ClassUtils.applyFeatBonuses(state, forestSage, {ability: "wis"});
		expect(state.getAbilityBase("wis")).toBe(11);
	});

	it("caps the synthesized increase at 20", () => {
		state.setAbilityBase("dex", 20);
		ClassUtils.applyFeatBonuses(state, PLANTMENDER, {ability: "dex"});
		expect(state.getAbilityBase("dex")).toBe(20);
	});
});
