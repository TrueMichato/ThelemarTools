/**
 * Spellcasting material-component enforcement.
 *
 * Locks in the three rules requested for casting:
 *   1. A gold-cost material component must be possessed; consumed components are
 *      removed from inventory on cast.
 *   2. A no-cost material component requires a spellcasting focus / component pouch
 *      — or a feature that substitutes one (Spellsword Technique → weapon, War
 *      Caster → shield, Star Map, Gambler's Spellcasting → cards/dice/coins).
 *   3. A matching variant spell component supersedes the standard requirement.
 *
 * Also guards the escape-hatch setting and the innate-casting exemption (innate /
 * item casting ignores material components, so enforcement must NOT engage there).
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

// No gold cost → focus/pouch covers it.
const SPELL_NO_COST = {name: "Detect Magic", source: "PHB", level: 1, components: {v: true, s: true, m: "a pinch of powder"}};
// Gold-cost, consumed.
const SPELL_GOLD_CONSUME = {name: "Revivify", source: "PHB", level: 3, components: {v: true, s: true, m: {text: "diamonds worth 300 gp, which the spell consumes", cost: 30000, consume: true}}};
// Gold-cost, not consumed.
const SPELL_GOLD_KEEP = {name: "Chromatic Orb", source: "PHB", level: 1, components: {v: true, s: true, m: {text: "a diamond worth at least 50 gp", cost: 5000}}};
// No material component at all.
const SPELL_NO_MATERIAL = {name: "Shield", source: "PHB", level: 1, components: {v: true, s: true}};

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	return state;
}

function makeSpells (state, allSpells) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._allSpells = allSpells;
	spells._page = {saveCharacter: () => {}};
	return spells;
}

/* -------------------------------------------------------------------------- */
/* getSpellMaterialComponentInfo                                               */
/* -------------------------------------------------------------------------- */

describe("getSpellMaterialComponentInfo", () => {
	const state = makeState();

	it("treats a string material as a no-cost, focus-satisfiable component", () => {
		const info = state.getSpellMaterialComponentInfo(SPELL_NO_COST);
		expect(info).toMatchObject({cost: 0, consume: false, requiresFocus: true});
	});

	it("parses a gold-cost object material (cost in copper, consume flag)", () => {
		const info = state.getSpellMaterialComponentInfo(SPELL_GOLD_CONSUME);
		expect(info).toMatchObject({cost: 30000, consume: true, requiresFocus: false});
	});

	it("returns null when the spell has no material component", () => {
		expect(state.getSpellMaterialComponentInfo(SPELL_NO_MATERIAL)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* getGoldComponentCandidates                                                  */
/* -------------------------------------------------------------------------- */

describe("getGoldComponentCandidates", () => {
	it("matches a value-less item by name keyword and a generic item by value", () => {
		const state = makeState();
		state.addItem({name: "Diamond", source: "Custom", value: 0, _isCustom: true}); // name match, no value
		state.addItem({name: "Ruby Brooch", source: "Custom", value: 40000, _isCustom: true}); // value >= 300gp
		state.addItem({name: "Copper Coin", source: "Custom", value: 1, _isCustom: true}); // neither

		const cands = state.getGoldComponentCandidates(30000, "diamonds worth 300 gp, which the spell consumes");
		const names = cands.map(c => c.name);
		expect(names).toContain("Diamond"); // by name
		expect(names).toContain("Ruby Brooch"); // by value
		expect(names).not.toContain("Copper Coin");
	});

	it("returns empty when nothing matches by name or value", () => {
		const state = makeState();
		state.addItem({name: "Torch", source: "Custom", value: 1, _isCustom: true});
		expect(state.getGoldComponentCandidates(30000, "diamonds worth 300 gp")).toHaveLength(0);
	});
});

/* -------------------------------------------------------------------------- */
/* getSpellcastingFocusStatus                                                  */
/* -------------------------------------------------------------------------- */

describe("getSpellcastingFocusStatus", () => {
	it("is false with an empty inventory and no substitution feature", () => {
		expect(makeState().getSpellcastingFocusStatus().ok).toBe(false);
	});

	it("is true with an arcane focus (SCF) item", () => {
		const state = makeState();
		state.addItem({name: "Orb", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("is true with a component pouch (matched by name)", () => {
		const state = makeState();
		state.addItem({name: "Component Pouch", source: "PHB", type: "G", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("is true via Spellsword Technique with a melee weapon possessed", () => {
		const state = makeState();
		state.addFeat({name: "Spellsword Technique", source: "TGTT"});
		state.addItem({name: "Longsword", source: "PHB", type: "M", weaponCategory: "martial", _isCustom: true});
		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.source).toMatch(/Spellsword/);
	});

	it("is true via War Caster with a shield possessed", () => {
		const state = makeState();
		state.addFeat({name: "War Caster", source: "PHB"});
		state.addItem({name: "Shield", source: "PHB", type: "S", _isCustom: true});
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("is true via the Star Map feature even with no focus item", () => {
		const state = makeState();
		state.addFeature({name: "Star Map", source: "XPHB"});
		expect(state.getSpellcastingFocusStatus().ok).toBe(true);
	});

	it("is NOT satisfied by War Caster alone without a shield", () => {
		const state = makeState();
		state.addFeat({name: "War Caster", source: "PHB"});
		expect(state.getSpellcastingFocusStatus().ok).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* _checkCastingConstraints — material gate                                    */
/* -------------------------------------------------------------------------- */

describe("_checkCastingConstraints material gate", () => {
	it("blocks a no-cost material spell when no focus/pouch is present", () => {
		const state = makeState();
		const spells = makeSpells(state, [SPELL_NO_COST]);
		const {block} = spells._checkCastingConstraints(SPELL_NO_COST, SPELL_NO_COST, null, {enforceMaterial: true});
		expect(block).toMatch(/focus or component pouch/i);
	});

	it("allows a no-cost material spell once a focus is equipped", () => {
		const state = makeState();
		state.addItem({name: "Wand", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_COST]);
		const {block} = spells._checkCastingConstraints(SPELL_NO_COST, SPELL_NO_COST, null, {enforceMaterial: true});
		expect(block).toBeNull();
	});

	it("blocks a gold-cost spell when the valuable component is absent", () => {
		const state = makeState();
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toMatch(/worth at least 300 gp/i);
	});

	it("allows a gold-cost spell when a qualifying component is possessed", () => {
		const state = makeState();
		state.addItem({name: "Diamond", source: "Custom", value: 30000, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toBeNull();
	});

	it("does NOT enforce material components when enforceMaterial is off (innate/item casting)", () => {
		const state = makeState();
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {});
		expect(block).toBeNull();
	});

	it("is bypassed entirely by the ignoreSpellcastingRestrictions setting", () => {
		const state = makeState();
		state.setSetting("ignoreSpellcastingRestrictions", true);
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toBeNull();
	});

	it("lets a matching variant component supersede the requirement (rule 3)", () => {
		const state = makeState();
		// A variant component item that matches the spell by UID — no diamond, no focus.
		state.addItem({
			name: "Soul Gem",
			source: "Custom",
			_isCustom: true,
			variantComponent: {spellEffects: [{match: {spell: "Revivify|PHB"}, effects: [{type: "noSlot"}]}]},
		});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* _pConsumeMaterialComponent                                                  */
/* -------------------------------------------------------------------------- */

describe("_pConsumeMaterialComponent", () => {
	beforeEach(() => {
		globalThis.InputUiUtil = globalThis.InputUiUtil || {};
		globalThis.JqueryUtil = globalThis.JqueryUtil || {};
		globalThis.JqueryUtil.doToast = globalThis.JqueryUtil.doToast || (() => {});
	});

	it("removes the consumed gold component from inventory on cast", async () => {
		const state = makeState();
		const id = "diamond-1";
		state.addItem({id, name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});

		expect(res.consumed?.name).toBe("Diamond");
		expect(state.getItems().find(i => i.id === id)).toBeUndefined(); // removed
	});

	it("does NOT consume a gold component that the spell only requires (not consumed)", async () => {
		const state = makeState();
		state.addItem({id: "d2", name: "Diamond", source: "Custom", value: 5000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_KEEP]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_KEEP, spellData: SPELL_GOLD_KEEP, decision: {skipComponentPrompt: true}});

		expect(res.consumed).toBeNull();
		expect(state.getItems().find(i => i.id === "d2")).toBeDefined(); // kept
	});

	it("does NOT consume anything for a no-cost (focus-covered) material", async () => {
		const state = makeState();
		state.addItem({id: "p1", name: "Component Pouch", source: "PHB", type: "G", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_COST]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_NO_COST, spellData: SPELL_NO_COST, decision: {skipComponentPrompt: true}});
		expect(res.consumed).toBeNull();
	});

	it("does NOT consume the material when a variant component was used instead", async () => {
		const state = makeState();
		state.addItem({id: "d3", name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}, variantUsed: true});

		expect(res.consumed).toBeNull();
		expect(state.getItems().find(i => i.id === "d3")).toBeDefined();
	});

	it("does NOT consume when the escape-hatch setting is on", async () => {
		const state = makeState();
		state.setSetting("ignoreSpellcastingRestrictions", true);
		state.addItem({id: "d4", name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});
		expect(res.consumed).toBeNull();
		expect(state.getItems().find(i => i.id === "d4")).toBeDefined();
	});

	it("decrements quantity (not full removal) when stacked", async () => {
		const state = makeState();
		state.addItem({id: "d5", name: "Diamond", source: "Custom", value: 30000, quantity: 3, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});
		expect(state.getItems().find(i => i.id === "d5")?.quantity).toBe(2);
	});
});
