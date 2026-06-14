import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const makeSpells = () => {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = {saveCharacter: jest.fn()};
	spells._allSpells = [];
	return spells;
};

// region R17 Bug #3a — left-click / quick cast must not open the slot-enum modal
describe("R17 Bug #3a: quick auto-cast skips the 'Choose Slot Level' modal", () => {
	let spells;
	let setSpellSlots;

	beforeEach(() => {
		spells = makeSpells();
		setSpellSlots = jest.fn();
		// Multi-slot leveled spell: slots at level 3 AND 4 → more than one cast option.
		spells._allSpells = [{name: "Fireball", source: "XPHB", level: 3, duration: [{type: "instant"}]}];
		spells._state = {
			getSpells: () => [{id: "fb", name: "Fireball", source: "XPHB", level: 3}],
			isConcentrating: () => false,
			canCastAsRitual: () => false,
			getPactSlots: () => ({current: 0, max: 0, level: 0}),
			getSpellSlotsCurrent: lvl => ((lvl === 3 || lvl === 4) ? 2 : 0),
			getSpellSlotsMax: lvl => ((lvl === 3 || lvl === 4) ? 2 : 0),
			setSpellSlots,
			getNoSlotCastResourcesForSpell: () => [],
			getCastableActiveMetamagics: () => [],
			getSorceryPoints: () => ({current: 3, max: 5}),
			useSorceryPoint: () => true,
			getAttunedItems: () => [],
		};
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: null}));
		spells._pChooseVariantComponent = jest.fn(async () => ({cancelled: false}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._refreshSorceryPointUI = jest.fn();
		spells.renderSlots = jest.fn();
		spells._updateConcentrationUI = jest.fn();
		spells._page._renderQuickSpells = jest.fn();
		spells._showCastResult = jest.fn(async () => ({}));

		globalThis.JqueryUtil = {doToast: jest.fn()};
		globalThis.InputUiUtil = {
			pGetUserEnum: jest.fn(async (opts) => opts.values[0]),
			pGetUserBoolean: jest.fn(async () => true),
		};
	});

	it("does NOT open the slot-enum modal on the quick auto-cast decision", async () => {
		await spells._castSpell("fb", {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}});
		expect(globalThis.InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
		expect(spells._showCastResult).toHaveBeenCalled();
		expect(spells._showCastResult.mock.calls[0][1]).toBe(3);
		expect(setSpellSlots).toHaveBeenCalledWith(3, 2, 1);
	});

	it("does NOT open the slot-enum modal for a legacy spellId-only call (combat/overview/favourites)", async () => {
		await spells._castSpell("fb");
		expect(globalThis.InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
		expect(spells._showCastResult).toHaveBeenCalled();
	});

	it("DOES open the slot-enum modal on the explicit Cast-w/-Metamagic path", async () => {
		await spells._castSpell("fb", {withMetamagic: true});
		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalledTimes(1);
		expect(spells._pChooseActiveMetamagic).toHaveBeenCalledTimes(1);
	});

	it("metamagic + upcast flow casts at the chosen higher slot with the metamagic applied", async () => {
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async (opts) => opts.values.find(v => /Level 4/.test(v)));
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: {key: "twinned", name: "Twinned Spell", cost: 2}}));
		const useSp = jest.fn(() => true);
		spells._state.useSorceryPoint = useSp;

		await spells._castSpell("fb", {withMetamagic: true});

		expect(spells._showCastResult).toHaveBeenCalled();
		const call = spells._showCastResult.mock.calls[0];
		expect(call[1]).toBe(4);
		expect(call[4].appliedMetamagic).toEqual(expect.objectContaining({key: "twinned"}));
		expect(useSp).toHaveBeenCalledWith(2);
		expect(setSpellSlots).toHaveBeenCalledWith(4, 2, 1);
	});
});
// endregion

// region R17 Bug #3b — Feywild Shard is strictly a metamagic sub-option
describe("R17 Bug #3b: Feywild Shard only fires under an applied metamagic", () => {
	let spells;
	let castMetaSeen;

	beforeEach(() => {
		spells = makeSpells();
		castMetaSeen = null;
		spells._allSpells = [{name: "Fireball", source: "XPHB", level: 3, duration: [{type: "instant"}]}];
		spells._state = {
			getSpells: () => [{id: "fb", name: "Fireball", source: "XPHB", level: 3}],
			isConcentrating: () => false,
			canCastAsRitual: () => false,
			getPactSlots: () => ({current: 0, max: 0, level: 0}),
			getSpellSlotsCurrent: lvl => (lvl === 3 ? 2 : 0),
			getSpellSlotsMax: lvl => (lvl === 3 ? 2 : 0),
			setSpellSlots: jest.fn(),
			getNoSlotCastResourcesForSpell: () => [],
			getCastableActiveMetamagics: () => [],
			getSorceryPoints: () => ({current: 3, max: 5}),
			useSorceryPoint: () => true,
			getAttunedItems: () => [{item: {name: "Feywild Shard", source: "TCE"}, attuned: true}],
		};
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._pChooseVariantComponent = jest.fn(async () => ({cancelled: false}));
		spells._refreshSorceryPointUI = jest.fn();
		spells.renderSlots = jest.fn();
		spells._updateConcentrationUI = jest.fn();
		spells._page._renderQuickSpells = jest.fn();
		spells._showCastResult = jest.fn(async (spell, slotLevel, isPact, isRitual, castMeta) => { castMetaSeen = castMeta; return {}; });

		globalThis.JqueryUtil = {doToast: jest.fn()};
		globalThis.InputUiUtil = {pGetUserEnum: jest.fn(async (opts) => opts.values[0]), pGetUserBoolean: jest.fn(async () => true)};
	});

	it("does NOT pass feywildShard on a plain quick cast (no metamagic)", async () => {
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: null}));
		await spells._castSpell("fb", {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}});
		expect(castMetaSeen).toBeTruthy();
		expect(castMetaSeen.feywildShard).toBeFalsy();
	});

	it("passes feywildShard only when a metamagic is applied AND the toggle is on", async () => {
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: {key: "twinned", name: "Twinned Spell", cost: 2}, feywildShard: true}));
		await spells._castSpell("fb", {withMetamagic: true});
		expect(castMetaSeen.appliedMetamagic).toEqual(expect.objectContaining({key: "twinned"}));
		expect(castMetaSeen.feywildShard).toBe(true);
	});

	it("does NOT pass feywildShard when a metamagic is applied but the toggle is OFF", async () => {
		spells._pChooseActiveMetamagic = jest.fn(async () => ({cancelled: false, metamagic: {key: "twinned", name: "Twinned Spell", cost: 2}, feywildShard: false}));
		await spells._castSpell("fb", {withMetamagic: true});
		expect(castMetaSeen.appliedMetamagic).toEqual(expect.objectContaining({key: "twinned"}));
		expect(castMetaSeen.feywildShard).toBeFalsy();
	});

	it("threads feywildShard through a context-menu metamagic decision", async () => {
		spells._state.getCastableActiveMetamagics = () => [{key: "twinned", name: "Twinned Spell", cost: 2, isAvailable: true}];
		await spells._castSpell("fb", {decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true, metamagic: {key: "twinned", name: "Twinned Spell", cost: 2}, feywildShard: true}});
		expect(castMetaSeen.appliedMetamagic).toEqual(expect.objectContaining({key: "twinned"}));
		expect(castMetaSeen.feywildShard).toBe(true);
	});
});

describe("R17 Bug #3b: cast-options menu surfaces Feywild only as a metamagic variant", () => {
	let spells;

	const makeMenuState = ({attuned = false, metamagics = []} = {}) => ({
		getSpellSlotsCurrent: () => 0,
		getCastableActiveMetamagics: () => metamagics,
		canCastAsRitual: () => false,
		getMatchingVariantComponents: () => [],
		getAttunedItems: () => (attuned ? [{item: {name: "Feywild Shard", source: "TCE"}, attuned: true}] : []),
	});

	beforeEach(() => {
		spells = makeSpells();
		spells._castSpell = jest.fn();
		spells._castSpellAsRitual = jest.fn();
	});

	it("offers no Feywild option when no metamagic is available (even if attuned)", () => {
		spells._state = makeMenuState({attuned: true, metamagics: []});
		const items = spells._buildCastOptionItems({id: "fb", name: "Fireball", source: "XPHB", level: 3}, {name: "Fireball", source: "XPHB", level: 3});
		expect(items.some(it => /Feywild/.test(it.label))).toBe(false);
	});

	it("offers a metamagic + Feywild Shard variant when both are available", () => {
		spells._state = makeMenuState({attuned: true, metamagics: [{key: "twinned", name: "Twinned Spell", cost: 2, isAvailable: true}]});
		const items = spells._buildCastOptionItems({id: "fb", name: "Fireball", source: "XPHB", level: 3}, {name: "Fireball", source: "XPHB", level: 3});
		const feywildItem = items.find(it => /Feywild Shard/.test(it.label));
		expect(feywildItem).toBeTruthy();
		feywildItem.onSelect();
		expect(spells._castSpell).toHaveBeenCalledWith("fb", {decision: expect.objectContaining({feywildShard: true, metamagic: expect.objectContaining({key: "twinned"})})});
	});

	it("never offers a standalone (no-metamagic) Feywild cast entry", () => {
		spells._state = makeMenuState({attuned: true, metamagics: [{key: "twinned", name: "Twinned Spell", cost: 2, isAvailable: true}]});
		const items = spells._buildCastOptionItems({id: "fb", name: "Fireball", source: "XPHB", level: 3}, {name: "Fireball", source: "XPHB", level: 3});
		const feywildItems = items.filter(it => /Feywild/.test(it.label));
		expect(feywildItems.length).toBeGreaterThan(0);
		expect(feywildItems.every(it => /Feywild Shard/.test(it.label) && /🌀/.test(it.label))).toBe(true);
	});

	it("does NOT offer Feywild for a cantrip even when attuned", () => {
		spells._state = makeMenuState({attuned: true, metamagics: [{key: "twinned", name: "Twinned Spell", cost: 2, isAvailable: true}]});
		const items = spells._buildCastOptionItems({id: "fbolt", name: "Fire Bolt", source: "XPHB", level: 0}, {name: "Fire Bolt", source: "XPHB", level: 0});
		expect(items.some(it => /Feywild/.test(it.label))).toBe(false);
	});
});
// endregion
