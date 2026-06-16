/**
 * R20 S4 — Seals UX + burn damage + Interdict/Charm DC display.
 *
 * Covers four player-facing bugs on the Illrigger (MCDM IllriggerRevised brew):
 *  - #11: burning a seal must produce the seal DAMAGE dice (NdN d6), never a d20.
 *  - #10: the Place / Move seal flows must offer the already-interdicted creatures
 *         as selectable destinations (plus a free-text new-creature entry).
 *  - #14: the Interdict DC must surface in the Features-tab calculated-stats list.
 *  - #19: the redundant separate "Charm Enemy DC" row must be gone (it equals the
 *         Interdict DC, which now represents the whole class).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

// CharacterSheetCombat / CharacterSheetFeatures constructors wire a global click
// listener; tests below call individual prototype methods with a faked `this`,
// so a stub document keeps imports from throwing in the node test environment.
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

const addIllrigger = (state, level, {cha = 16, subclass} = {}) => {
	state._data.abilities.cha = cha;
	state.addClass({
		name: "Illrigger",
		source: "IllriggerRevised",
		level,
		...(subclass ? {subclass} : {}),
	});
	state.applyClassFeatureEffects();
};

// ==========================================================================
// #11 — burning a seal returns the seal DAMAGE dice (NdN d6), not a d20.
// ==========================================================================
describe("#11 burnSeals returns seal damage dice (not a d20)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("returns NdN d6 fire/necrotic dice and never a d20", () => {
		addIllrigger(state, 5, {cha: 16}); // L5 → 2d6 per seal
		const placed = state.placeSeal("Goblin", {force: true});
		state.placeSeal("Goblin", {force: true}); // 2 seals
		const result = state.burnSeals(placed.id, 2, "fire");
		expect(result).toBeTruthy();
		// 2 seals × 2d6 = 4d6.
		expect(result.dice).toMatch(/^\d+d6\b/);
		expect(result.dice).not.toMatch(/d20/);
		expect(result.damageType).toBe("fire");
	});

	it("honours the chosen necrotic damage type", () => {
		addIllrigger(state, 1, {cha: 14}); // L1 → 1d6 per seal
		const placed = state.placeSeal("Skeleton", {force: true});
		const result = state.burnSeals(placed.id, 1, "necrotic");
		expect(result.dice).toMatch(/^\d+d6\b/);
		expect(result.damageType).toBe("necrotic");
	});
});

// ==========================================================================
// #10 — Place / Move flows offer existing interdicted creatures as options.
// ==========================================================================
describe("#10 place/move seal flows offer existing placements", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	const mkCombat = (st) => ({_state: st});

	it("_getSealPlaceTargets lists every currently interdicted creature", () => {
		addIllrigger(state, 5, {cha: 16});
		state.placeSeal("Goblin", {force: true});
		state.placeSeal("Goblin", {force: true});
		state.placeSeal("Ogre", {force: true});

		const targets = CharacterSheetCombat.prototype._getSealPlaceTargets.call(mkCombat(state));
		const names = targets.map(t => t.target).sort();
		expect(names).toEqual(["Goblin", "Ogre"]);
		const goblin = targets.find(t => t.target === "Goblin");
		expect(goblin.count).toBe(2);
	});

	it("_getSealMoveTargets offers the OTHER creatures, never the source itself", () => {
		addIllrigger(state, 5, {cha: 16});
		const source = state.placeSeal("Dying Cultist", {force: true});
		state.placeSeal("Acolyte", {force: true});
		state.placeSeal("Bandit", {force: true});

		const dests = CharacterSheetCombat.prototype._getSealMoveTargets.call(mkCombat(state), source.id);
		const names = dests.map(d => d.target).sort();
		expect(names).toEqual(["Acolyte", "Bandit"]);
		expect(names).not.toContain("Dying Cultist");
	});

	it("_getSealMoveTargets is empty when the source is the only interdicted creature", () => {
		addIllrigger(state, 3, {cha: 16});
		const source = state.placeSeal("Lone Wolf", {force: true});
		const dests = CharacterSheetCombat.prototype._getSealMoveTargets.call(mkCombat(state), source.id);
		expect(dests).toEqual([]);
	});
});

// ==========================================================================
// #14 / #19 — Interdict DC row surfaces; redundant Charm Enemy DC row is gone.
// ==========================================================================
describe("#14/#19 calculated-stats DC rows", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	const renderStats = (st) => {
		const container = globalThis.e_({tag: "div"});
		const fakeFeatures = {_state: st, _renderPassiveDefenses () {}};
		CharacterSheetFeatures.prototype._renderCalculatedStats.call(fakeFeatures, container);
		return container.innerHTML;
	};

	it("renders an Interdict DC row for an Illrigger (#14)", () => {
		addIllrigger(state, 5, {cha: 16}); // 8 + 3 prof + 3 cha = 14
		expect(state.getFeatureCalculations().interdictDc).toBe(14);
		const html = renderStats(state);
		expect(html).toContain("Interdict DC");
		expect(html).toContain("14");
	});

	it("does NOT render a separate Charm Enemy DC row for a Hellspeaker (#19)", () => {
		addIllrigger(state, 3, {cha: 16, subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"}});
		const calcs = state.getFeatureCalculations();
		// The state value is preserved (other logic may rely on it)…
		expect(calcs.charmEnemyDc).toBe(calcs.interdictDc);
		// …but the display shows ONE Interdict DC row, not a duplicate Charm Enemy DC row.
		const html = renderStats(state);
		expect(html).toContain("Interdict DC");
		expect(html).not.toContain("Charm Enemy DC");
	});
});
