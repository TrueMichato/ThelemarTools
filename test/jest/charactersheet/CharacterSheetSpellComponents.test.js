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
// Weapon-channel cantrip: its material component IS the melee weapon you attack with,
// so it must never be blocked by the focus/gold-cost gate (Booming Blade / Green-Flame
// Blade). Shaped like the real TCE data so getWeaponChannelCantripInfo() recognises it.
const SPELL_BLADE_CANTRIP = {
	name: "Booming Blade",
	source: "TCE",
	level: 0,
	components: {s: true, m: {text: "a melee weapon worth at least 1 sp", cost: 10}},
	scalingLevelDice: [
		{label: "thunder damage on moving", scaling: {5: "1d8", 11: "2d8", 17: "3d8"}},
		{label: "thunder damage on hit", scaling: {5: "1d8", 11: "2d8", 17: "3d8"}},
	],
	entries: ["You brandish the weapon used in the spell's casting and make a melee attack with it against one creature within 5 feet of you."],
	damageInflict: ["thunder"],
};

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
	it("matches the named component (even value-less) but NOT a merely-valuable item", () => {
		const state = makeState();
		state.addItem({name: "Diamond", source: "Custom", value: 0, _isCustom: true}); // name match, no value → trusted
		state.addItem({name: "Ruby Brooch", source: "Custom", value: 40000, _isCustom: true}); // valuable, but not named
		state.addItem({name: "Copper Coin", source: "Custom", value: 1, _isCustom: true}); // neither

		const cands = state.getGoldComponentCandidates(30000, "diamonds worth 300 gp, which the spell consumes");
		const names = cands.map(c => c.name);
		expect(names).toContain("Diamond"); // by name — accepted even with no value
		expect(names).not.toContain("Ruby Brooch"); // valuable but not the named component → rejected
		expect(names).not.toContain("Copper Coin");
	});

	it("rejects a named component that is explicitly worth less than the cost", () => {
		const state = makeState();
		// A real Diamond, but only 200 gp — Revivify needs 300 gp. Must NOT qualify.
		state.addItem({name: "Diamond", source: "Custom", value: 20000, _isCustom: true});
		expect(state.getGoldComponentCandidates(30000, "diamonds worth 300 gp")).toHaveLength(0);
	});

	it("accepts a named component worth exactly the cost, and one with no explicit value", () => {
		const state = makeState();
		state.addItem({id: "exact", name: "Diamond", source: "Custom", value: 30000, _isCustom: true}); // exactly 300 gp
		state.addItem({id: "priceless", name: "Heirloom Diamond", source: "Custom", value: 0, _isCustom: true}); // homebrew, no price
		const names = state.getGoldComponentCandidates(30000, "diamonds worth 300 gp").map(c => c.name);
		expect(names).toContain("Diamond");
		expect(names).toContain("Heirloom Diamond");
	});

	it("returns empty when nothing matches the component name (a valuable is not a substitute)", () => {
		const state = makeState();
		state.addItem({name: "Torch", source: "Custom", value: 1, _isCustom: true});
		state.addItem({name: "Ruby Brooch", source: "Custom", value: 40000, _isCustom: true}); // worth enough, wrong item
		expect(state.getGoldComponentCandidates(30000, "diamonds worth 300 gp")).toHaveLength(0);
	});

	it("returns empty when the component text names nothing to match", () => {
		const state = makeState();
		state.addItem({name: "Diamond", source: "Custom", value: 50000, _isCustom: true});
		// no extractable noun (all stopwords) → cannot name-match anything
		expect(state.getGoldComponentCandidates(30000, "worth at least 300 gp")).toHaveLength(0);
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
		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.itemName).toBe("Orb");
		expect(status.source).toBe("arcane focus");
	});

	it("is true with a component pouch (matched by name)", () => {
		const state = makeState();
		state.addItem({name: "Component Pouch", source: "PHB", type: "G", _isCustom: true});
		const status = state.getSpellcastingFocusStatus();
		expect(status.ok).toBe(true);
		expect(status.itemName).toBe("Component Pouch");
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
/* _getSpellFocusNote — cast-result focus readout                              */
/* -------------------------------------------------------------------------- */

describe("_getSpellFocusNote", () => {
	it("names the focus item and its kind for a no-cost material spell", () => {
		const state = makeState();
		state.addItem({name: "Crystal", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_COST]);
		expect(spells._getSpellFocusNote(SPELL_NO_COST, SPELL_NO_COST)).toBe("Crystal (arcane focus)");
	});

	it("does not repeat 'component pouch' when the item name already says it", () => {
		const state = makeState();
		state.addItem({name: "Component Pouch", source: "PHB", type: "G", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_COST]);
		expect(spells._getSpellFocusNote(SPELL_NO_COST, SPELL_NO_COST)).toBe("Component Pouch");
	});

	it("reports a feature-only substitution with no item (Star Map)", () => {
		const state = makeState();
		state.addFeature({name: "Star Map", source: "XPHB"});
		const spells = makeSpells(state, [SPELL_NO_COST]);
		expect(spells._getSpellFocusNote(SPELL_NO_COST, SPELL_NO_COST)).toBe("Star Map");
	});

	it("returns null for a spell with no material component", () => {
		const state = makeState();
		state.addItem({name: "Crystal", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_MATERIAL]);
		expect(spells._getSpellFocusNote(SPELL_NO_MATERIAL, SPELL_NO_MATERIAL)).toBeNull();
	});

	it("returns null for a gold-cost component spell (that uses the component, not a focus)", () => {
		const state = makeState();
		state.addItem({name: "Crystal", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		expect(spells._getSpellFocusNote(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME)).toBeNull();
	});

	it("returns null when a variant component was used instead", () => {
		const state = makeState();
		state.addItem({name: "Crystal", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		const spells = makeSpells(state, [SPELL_NO_COST]);
		expect(spells._getSpellFocusNote(SPELL_NO_COST, SPELL_NO_COST, {variantUsed: true})).toBeNull();
	});

	it("returns null when no focus is possessed", () => {
		const state = makeState();
		const spells = makeSpells(state, [SPELL_NO_COST]);
		expect(spells._getSpellFocusNote(SPELL_NO_COST, SPELL_NO_COST)).toBeNull();
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

	it("still BLOCKS a gold-cost spell when you own a valuable that is NOT the named component", () => {
		// A 400 gp brooch is worth more than the 300 gp diamond Revivify needs, but it
		// is not a diamond — you must own the actual named component to cast.
		const state = makeState();
		state.addItem({name: "Ruby Brooch", source: "Custom", value: 40000, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toMatch(/worth at least 300 gp/i);
	});

	it("still BLOCKS a gold-cost spell when the named component is worth too little", () => {
		// A genuine Diamond, but only 200 gp — under Revivify's 300 gp floor.
		const state = makeState();
		state.addItem({name: "Diamond", source: "Custom", value: 20000, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		const {block} = spells._checkCastingConstraints(SPELL_GOLD_CONSUME, SPELL_GOLD_CONSUME, null, {enforceMaterial: true});
		expect(block).toMatch(/worth at least 300 gp/i);
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

	// Regression (Booming Blade): the material component of a weapon-channel cantrip is the
	// melee weapon used to make the attack. The generic focus/gold-cost gate cannot see that
	// weapon as the component, so before the fix it hard-blocked the cast ("worth at least
	// 0 gp") BEFORE the weapon-channel branch that prompts for the weapon could ever run —
	// the normal Cast button silently did nothing. The gate must waive it; the channel flow
	// enforces the equipped-weapon requirement itself with a precise message.
	it("does NOT block a weapon-channel cantrip (Booming Blade) with no focus and no weapon", () => {
		const state = makeState(); // empty inventory: no focus, no weapon
		const spells = makeSpells(state, [SPELL_BLADE_CANTRIP]);
		// Self-validate: the fixture is genuinely classified as a weapon-channel cantrip,
		// otherwise the assertion below would be vacuous.
		expect(CharacterSheetSpells.getWeaponChannelCantripInfo(SPELL_BLADE_CANTRIP)).toBeTruthy();
		const {block} = spells._checkCastingConstraints(SPELL_BLADE_CANTRIP, SPELL_BLADE_CANTRIP, null, {enforceMaterial: true});
		expect(block).toBeNull();
	});

	it("_getMaterialComponentBlock waives a weapon-channel cantrip (the weapon IS the component)", () => {
		const state = makeState();
		const spells = makeSpells(state, [SPELL_BLADE_CANTRIP]);
		expect(spells._getMaterialComponentBlock(SPELL_BLADE_CANTRIP, SPELL_BLADE_CANTRIP)).toBeNull();
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
		// Default prompt stubs — individual tests override the return value and/or
		// assert call counts. Defaulting to "Keep it" / "keep all" is the SAFE answer
		// (nothing destroyed) so an unexpected prompt can't silently pass a test.
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => false);
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async () => null);
	});

	it("removes the consumed gold component from inventory on cast (single named item, no prompt)", async () => {
		const state = makeState();
		const id = "diamond-1";
		state.addItem({id, name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});

		expect(res.consumed?.name).toBe("Diamond");
		expect(state.getItems().find(i => i.id === id)).toBeUndefined(); // removed
		// A single, explicitly-named component is unambiguous — consumed directly, NO prompt.
		expect(globalThis.InputUiUtil.pGetUserBoolean).not.toHaveBeenCalled();
		expect(globalThis.InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
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

	// region The reported bug: an item that is merely worth enough (but does NOT
	// name the component) is not "the component" — it is never consumed, never
	// prompted, and never silently destroyed. (The gate blocks such a cast; if
	// consume is somehow reached it must no-op.)
	it("never touches a merely-valuable item — not the named component, so nothing is spent or prompted", async () => {
		const state = makeState();
		// A 400 gp brooch: worth more than Revivify's 300 gp diamond, but NOT a diamond.
		state.addItem({id: "ruby-1", name: "Ruby Brooch", source: "Custom", value: 40000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});

		expect(res.consumed).toBeNull();
		expect(globalThis.InputUiUtil.pGetUserBoolean).not.toHaveBeenCalled(); // never even asked
		expect(globalThis.InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === "ruby-1")).toBeDefined(); // untouched
	});

	it("a quick-cast never silently destroys an unnamed valuable (regression guard)", async () => {
		const state = makeState();
		state.addItem({id: "ruby-3", name: "Ruby Brooch", source: "Custom", value: 40000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);

		// skipComponentPrompt is the DEFAULT for click-to-cast — even so, a valuable
		// that isn't the named component must survive untouched.
		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});
		expect(res.consumed).toBeNull();
		expect(state.getItems().find(i => i.id === "ruby-3")).toBeDefined();
	});

	it("a single named component with an optional consume prompts before spending", async () => {
		const state = makeState();
		state.addItem({id: "dia-opt", name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		const OPTIONAL = {...SPELL_GOLD_CONSUME, name: "Optional Revivify", components: {v: true, s: true, m: {text: "diamonds worth 300 gp", cost: 30000, consume: "optional"}}};
		const spells = makeSpells(state, [OPTIONAL]);
		globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(false); // "Keep it"

		const res = await spells._pConsumeMaterialComponent({spell: OPTIONAL, spellData: OPTIONAL, decision: {skipComponentPrompt: true}});

		expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledTimes(1); // optional → ask
		expect(res.consumed).toBeNull();
		expect(state.getItems().find(i => i.id === "dia-opt")).toBeDefined();
	});

	it("prompts a picker when several named items match, and consumes only the chosen one", async () => {
		const state = makeState();
		state.addItem({id: "dia-a", name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		state.addItem({id: "dia-b", name: "Flawless Diamond", source: "Custom", value: 50000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		// Pick the second candidate from whatever list the picker is given.
		globalThis.InputUiUtil.pGetUserEnum.mockImplementation(async ({values}) => values[1]);

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});

		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalledTimes(1);
		// The two diamonds are the candidates; the chosen id is the one removed, the other kept.
		const remaining = state.getItems().filter(i => ["dia-a", "dia-b"].includes(i.id));
		expect(remaining).toHaveLength(1);
		expect(res.consumed.id).not.toBe(remaining[0].id);
	});

	it("does not consume when the picker is cancelled (null) on a multi-match", async () => {
		const state = makeState();
		state.addItem({id: "dia-c", name: "Diamond", source: "Custom", value: 30000, quantity: 1, _isCustom: true});
		state.addItem({id: "dia-d", name: "Flawless Diamond", source: "Custom", value: 50000, quantity: 1, _isCustom: true});
		const spells = makeSpells(state, [SPELL_GOLD_CONSUME]);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue(null); // cancelled / "keep all"

		const res = await spells._pConsumeMaterialComponent({spell: SPELL_GOLD_CONSUME, spellData: SPELL_GOLD_CONSUME, decision: {skipComponentPrompt: true}});
		expect(res.consumed).toBeNull();
		expect(state.getItems().filter(i => ["dia-c", "dia-d"].includes(i.id))).toHaveLength(2);
	});
	// endregion
});
