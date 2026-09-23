import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {
	addEventListener () {},
	getElementById () { return null; },
	querySelector () { return null; },
	querySelectorAll () { return []; },
	body: {classList: {add () {}, remove () {}}},
};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};
globalThis.Renderer.dice ||= {parseRandomise2: () => 1};
await import("../../../js/charactersheet/charactersheet.js");

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetPage = globalThis.CharacterSheetPage;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const SPELL_DATA = {
	name: "Command",
	source: "XPHB",
	level: 1,
	components: {v: true, s: true},
	duration: [{type: "instant"}],
};
const CONCENTRATION_DATA = {
	...SPELL_DATA,
	name: "Bless",
	duration: [{type: "timed", concentration: true, duration: {amount: 1, type: "minute"}}],
};

const makeHarness = ({spellData = SPELL_DATA, dice = [12, 12]} = {}) => {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "XPHB", level: 5});
	state.setAbilityBase("con", 14);
	state.addSpell({...spellData, prepared: true});
	const spellId = state.getSpells().find(s => s.name === spellData.name).id;
	const rolls = [...dice];
	state.rollD20 = jest.fn(() => rolls.shift());
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._rollHistory = {addRoll: jest.fn()};
	page._showDiceResult = jest.fn((title, total, breakdown, resultClass, resultNote) => {
		page._rollHistory.addRoll({title, total, breakdown, resultClass, resultNote});
	});
	page.pAnimateD20 = jest.fn(async () => {});
	page.saveCharacter = jest.fn();
	page._renderQuickSpells = jest.fn();
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = page;
	spells._state = state;
	spells._allSpells = [spellData];
	spells._resolveMetamagicChoice = jest.fn(async () => ({cancelled: false, metamagic: null}));
	spells._resolveVariantComponentChoice = jest.fn(async () => ({cancelled: false, variantComponent: null}));
	spells._showCastResult = jest.fn(async () => ({cancelled: false}));
	spells._pConsumeMaterialComponent = jest.fn(async () => {});
	spells._refreshSorceryPointUI = jest.fn();
	spells.renderSlots = jest.fn();
	spells._updateConcentrationUI = jest.fn();
	return {state, page, spells, spellId};
};

describe("TGTT casting constraints — committed casts only", () => {
	let booleanPrompt;
	let toast;

	beforeEach(() => {
		booleanPrompt = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	});

	afterEach(() => jest.restoreAllMocks());

	it("rolls the real d20 for TGTT Frightened, reports DC and success, then commits the cast", async () => {
		const {state, page, spells, spellId} = makeHarness({dice: [8, 19]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		const before = state.getSpellSlotsCurrent(1);

		await spells._castSpell(spellId, {withMetamagic: false});

		expect(state.rollD20).toHaveBeenCalled();
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			title: expect.stringMatching(/Command.*Concentration/i),
			total: 10,
			breakdown: expect.stringMatching(/DC 10/),
			resultNote: expect.stringMatching(/success.*cast/i),
		}));
		expect(page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({roll: 8, mode: "normal"}));
		expect(state.getSpellSlotsCurrent(1)).toBe(before - 1);
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(booleanPrompt).not.toHaveBeenCalled();
	});

	it("fails with no spent slot, metamagic, material, cast effect, or lost concentration", async () => {
		const {state, page, spells, spellId} = makeHarness({spellData: CONCENTRATION_DATA, dice: [7, 20]});
		state.setConcentration("Haste", 3);
		state.setSorceryPoints({current: 3, max: 5});
		state.addCondition({name: "Frightened", source: "TGTT"});
		spells._resolveMetamagicChoice.mockResolvedValue({cancelled: false, metamagic: {key: "quickened", cost: 2, name: "Quickened Spell"}});
		const before = state.getSpellSlotsCurrent(1);

		await spells._castSpell(spellId, {withMetamagic: true, decision: {autoSlot: true}});

		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			total: 9,
			resultNote: expect.stringMatching(/fail.*disrupted/i),
		}));
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(state.getSorceryPoints()).toMatchObject({current: 3, max: 5});
		expect(state.getConcentratingSpell().spellName).toBe("Haste");
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
	});

	it("keeps existing concentration on confirmation cancel or later cast cancellation", async () => {
		const {state, spells, spellId} = makeHarness({spellData: CONCENTRATION_DATA, dice: [15, 15]});
		state.setConcentration("Haste", 3);
		state.addCondition({name: "Frightened", source: "TGTT"});
		const before = state.getSpellSlotsCurrent(1);

		booleanPrompt.mockResolvedValueOnce(null);
		await spells._castSpell(spellId, {withMetamagic: false});
		expect(state.rollD20).not.toHaveBeenCalled();
		expect(state.getConcentratingSpell().spellName).toBe("Haste");

		spells._showCastResult.mockResolvedValueOnce({cancelled: true});
		await spells._castSpell(spellId, {withMetamagic: false});
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(state.getConcentratingSpell().spellName).toBe("Haste");
	});

	it("replaces concentration only once the new concentration spell is committed", async () => {
		const {state, spells, spellId} = makeHarness({spellData: CONCENTRATION_DATA, dice: [15, 15]});
		state.setConcentration("Haste", 3);
		state.addCondition({name: "Frightened", source: "TGTT"});

		await spells._castSpell(spellId, {withMetamagic: false});

		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(state.getConcentratingSpell().spellName).toBe("Bless");
	});

	it("one check covers multiple verbal and somatic constraints, without double charging", async () => {
		const {state, spells, spellId} = makeHarness({dice: [14, 19]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.addCondition({name: "Choked", source: "TGTT"});
		state.addCondition({name: "Grappled", source: "TGTT"});
		const before = state.getSpellSlotsCurrent(1);

		await spells._castSpell(spellId, {withMetamagic: false});

		expect(state.rollD20).toHaveBeenCalledTimes(2);
		expect(state.getSpellSlotsCurrent(1)).toBe(before - 1);
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringMatching(/Frightened.*Choked.*Grappled/),
		}));
	});

	it("uses concentration advantage and TGTT Poisoned disadvantage with cancel-aware dice", async () => {
		const {state, page, spells, spellId} = makeHarness({dice: [18, 3]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.addCondition({name: "Poisoned", source: "TGTT"});
		await spells._castSpell(spellId, {withMetamagic: false});
		expect(page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({mode: "disadvantage", roll: 3}));
		expect(spells._showCastResult).not.toHaveBeenCalled();

		const second = makeHarness({dice: [18, 3]});
		second.state.addCondition({name: "Frightened", source: "TGTT"});
		second.state.addCondition({name: "Poisoned", source: "TGTT"});
		second.state.addNamedModifier({id: "war-caster-test", name: "War Caster", type: "concentration", value: 0, advantage: true, enabled: true});
		await second.spells._castSpell(second.spellId, {withMetamagic: false});
		expect(second.page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({mode: "normal", roll: 18}));
		expect(second.spells._showCastResult).toHaveBeenCalledTimes(1);

		const advantaged = makeHarness({dice: [3, 18]});
		advantaged.state.addCondition({name: "Frightened", source: "TGTT"});
		advantaged.state.addNamedModifier({id: "war-caster-only", name: "War Caster", type: "concentration", value: 0, advantage: true, enabled: true});
		await advantaged.spells._castSpell(advantaged.spellId, {withMetamagic: false});
		expect(advantaged.page.pAnimateD20).toHaveBeenCalledWith(expect.objectContaining({mode: "advantage", roll: 18, roll1: 3, roll2: 18}));
	});

	it("uses CON proficiency, concentration bonuses, exhaustion and the configured critical-roll rule", async () => {
		const {state, page, spells, spellId} = makeHarness({dice: [20, 1]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.addSaveProficiency("con");
		state.addNamedModifier({id: "focus-test", name: "Focus", type: "concentration", value: 2, enabled: true});
		state.setExhaustion(1);
		state.setSetting("thelemar_criticalRolls", true);
		await spells._castSpell(spellId, {withMetamagic: false});

		// 20 + 2 CON + 3 proficiency + 2 focus - 1 TGTT exhaustion + 5 TGTT critical.
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			total: 31,
			breakdown: expect.stringMatching(/Nat 20.*exhaustion.*DC 10/),
		}));
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	});

	it("rolls state and named-modifier bonus dice into the logged concentration total", async () => {
		const {state, page, spells, spellId} = makeHarness({dice: [4, 19]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.getRollBonusDiceFromStates = jest.fn(() => [{dice: "1d4", sign: 1, source: "Bless"}]);
		state.addNamedModifier({id: "focus-die", name: "Focus", type: "concentration", value: 0, bonusDie: "1d4", enabled: true});
		const rollBonus = jest.spyOn(Renderer.dice, "parseRandomise2").mockReturnValueOnce(2).mockReturnValueOnce(3);

		await spells._castSpell(spellId, {withMetamagic: false});

		expect(rollBonus).toHaveBeenCalledTimes(2);
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			total: 11,
			breakdown: expect.stringMatching(/Bless.*Focus.*= 11 vs DC 10/),
		}));
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	});

	it("does not roll for non-TGTT Frightened or a Subtle cast; Silenced hard-blocks a normal cast", async () => {
		const normal = makeHarness();
		normal.state.addCondition({name: "Frightened", source: "XPHB"});
		await normal.spells._castSpell(normal.spellId, {withMetamagic: false});
		expect(normal.state.rollD20).not.toHaveBeenCalled();
		expect(normal.spells._showCastResult).toHaveBeenCalledTimes(1);

		const subtle = makeHarness();
		subtle.state.addCondition({name: "Frightened", source: "TGTT"});
		subtle.state.addCondition({name: "Silenced", source: "HB"});
		subtle.state.setSorceryPoints({current: 3, max: 5});
		subtle.spells._resolveMetamagicChoice.mockResolvedValue({cancelled: false, metamagic: {key: "subtle", name: "Subtle Spell", cost: 1}});
		await subtle.spells._castSpell(subtle.spellId, {withMetamagic: true, decision: {autoSlot: true}});
		expect(subtle.state.rollD20).not.toHaveBeenCalled();
		expect(subtle.spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(subtle.state.getSorceryPoints().current).toBe(2);

		const silenced = makeHarness();
		silenced.state.addCondition({name: "Frightened", source: "TGTT"});
		silenced.state.addCondition({name: "Silenced", source: "HB"});
		await silenced.spells._castSpell(silenced.spellId, {withMetamagic: false});
		expect(silenced.state.rollD20).not.toHaveBeenCalled();
		expect(silenced.spells._showCastResult).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringMatching(/silenced/i)}));
	});

	it("preserves somatic bans and fails closed when the dice roller cannot return a roll", async () => {
		const blocked = makeHarness();
		blocked.state.addCondition({name: "Frightened", source: "TGTT"});
		blocked.state.addCondition({name: "Restrained", source: "TGTT"});
		await blocked.spells._castSpell(blocked.spellId, {withMetamagic: false});
		expect(blocked.state.rollD20).not.toHaveBeenCalled();

		const unavailable = makeHarness();
		unavailable.state.addCondition({name: "Frightened", source: "TGTT"});
		unavailable.page.rollD20 = jest.fn(() => null);
		const before = unavailable.state.getSpellSlotsCurrent(1);
		await unavailable.spells._castSpell(unavailable.spellId, {withMetamagic: false});
		expect(unavailable.state.getSpellSlotsCurrent(1)).toBe(before);
		expect(unavailable.spells._showCastResult).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "warning", content: expect.stringMatching(/roll/i)}));
	});

	it("applies material hard blocks before rolling and respects the restriction-override setting", async () => {
		const blocked = makeHarness({spellData: {...SPELL_DATA, components: {v: true, s: true, m: "a material component"}}});
		blocked.state.addCondition({name: "Frightened", source: "TGTT"});
		blocked.spells._getMaterialComponentBlock = jest.fn(() => "Material required");
		await blocked.spells._castSpell(blocked.spellId, {withMetamagic: false});
		expect(blocked.state.rollD20).not.toHaveBeenCalled();
		expect(blocked.spells._showCastResult).not.toHaveBeenCalled();

		const overridden = makeHarness();
		overridden.state.addCondition({name: "Frightened", source: "TGTT"});
		overridden.state.setSetting("ignoreSpellcastingRestrictions", true);
		await overridden.spells._castSpell(overridden.spellId, {withMetamagic: false});
		expect(overridden.state.rollD20).not.toHaveBeenCalled();
		expect(overridden.spells._showCastResult).toHaveBeenCalledTimes(1);
	});

	it("gates a cantrip and an explicit ritual through the same roll without spending materials", async () => {
		const cantrip = makeHarness({spellData: {...SPELL_DATA, level: 0}, dice: [3, 16]});
		cantrip.state.addCondition({name: "Frightened", source: "TGTT"});
		await cantrip.spells._castSpell(cantrip.spellId, {withMetamagic: false});
		expect(cantrip.state.rollD20).toHaveBeenCalled();
		expect(cantrip.spells._showCastResult).not.toHaveBeenCalled();
		expect(cantrip.spells._pConsumeMaterialComponent).not.toHaveBeenCalled();

		const ritual = makeHarness({dice: [3, 16]});
		ritual.state.canCastAsRitual = jest.fn(() => true);
		ritual.state.addCondition({name: "Frightened", source: "TGTT"});
		await ritual.spells._castSpellAsRitual(ritual.spellId);
		expect(ritual.state.rollD20).toHaveBeenCalled();
		expect(ritual.spells._showCastResult).not.toHaveBeenCalled();
		expect(ritual.spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
	});

	it("keeps metamagic and a variant component when a later choice cancels a ritual cast", async () => {
		const {state, spells, spellId} = makeHarness({dice: [12, 12, 12, 12]});
		state.canCastAsRitual = jest.fn(() => true);
		state.setSorceryPoints({current: 3, max: 5});
		state.addCondition({name: "Frightened", source: "TGTT"});
		spells._resolveMetamagicChoice.mockResolvedValue({cancelled: false, metamagic: {key: "quickened", cost: 2, name: "Quickened Spell"}});
		spells._resolveVariantComponentChoice.mockResolvedValueOnce({cancelled: true});
		await spells._castSpell(spellId, {withMetamagic: true, decision: {castAsRitual: true}});
		expect(state.getSorceryPoints()).toMatchObject({current: 3, max: 5});
		expect(spells._showCastResult).not.toHaveBeenCalled();

		spells._resolveVariantComponentChoice.mockResolvedValue({cancelled: false, variantComponent: {effects: [], itemIds: ["material"]}});
		const consume = jest.spyOn(state, "consumeVariantComponent").mockImplementation(() => true);
		spells._showCastResult.mockResolvedValue({cancelled: true});
		await spells._castSpellAsRitual(spellId);
		expect(consume).not.toHaveBeenCalled();
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
	});

	it("preserves a selected variant material on later cancellation of a slot cast", async () => {
		const {state, spells, spellId} = makeHarness();
		state.addCondition({name: "Frightened", source: "TGTT"});
		spells._resolveVariantComponentChoice.mockResolvedValue({cancelled: false, variantComponent: {effects: [], itemIds: ["material"]}});
		spells._showCastResult.mockResolvedValue({cancelled: true});
		const consume = jest.spyOn(state, "consumeVariantComponent").mockImplementation(() => true);
		const before = state.getSpellSlotsCurrent(1);

		await spells._castSpell(spellId, {withMetamagic: false});

		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(consume).not.toHaveBeenCalled();
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
	});

	it("restores Lunar Boons even when its discount reduces metamagic to zero points on cancellation", async () => {
		const spellData = {...SPELL_DATA, name: "Protection from Evil and Good", school: "A"};
		const {state, spells, spellId} = makeHarness({spellData});
		state.addClass({name: "Sorcerer", source: "PHB", level: 6, subclass: {name: "Lunar Sorcery", source: "DSotDQ"}});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.setSorceryPoints({current: 3, max: 6});
		const boonsBefore = state.getLunarBoonUses();
		const slotsBefore = state.getSpellSlotsCurrent(1);
		spells._resolveMetamagicChoice.mockResolvedValue({
			cancelled: false,
			metamagic: {key: "quickened", cost: 0, lunarBoonApplied: true, lunarBoonSchool: "A"},
		});
		spells._showCastResult.mockResolvedValue({cancelled: true});

		await spells._castSpell(spellId, {withMetamagic: true, decision: {autoSlot: true}});

		expect(state.rollD20).toHaveBeenCalled();
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(state.getLunarBoonUses()).toEqual(boonsBefore);
		expect(state.getSorceryPoints()).toMatchObject({current: 3, max: 6});
		expect(state.getSpellSlotsCurrent(1)).toBe(slotsBefore);
	});

	it("gates item and innate spells using the same check before their own side effects", async () => {
		const item = makeHarness({spellData: CONCENTRATION_DATA, dice: [2, 18]});
		item.state.addCondition({name: "Frightened", source: "TGTT"});
		item.state.setConcentration("Haste", 3);
		const power = {spellName: "Bless", spellSource: "XPHB", itemId: "item", id: "power", itemName: "Magic Wand"};
		expect(await item.spells.pCastItemSpell(power)).toBe(false);
		expect(item.state.getConcentratingSpell().spellName).toBe("Haste");
		expect(item.spells._showCastResult).not.toHaveBeenCalled();

		const innate = makeHarness({dice: [2, 18]});
		innate.state.addCondition({name: "Frightened", source: "TGTT"});
		innate.state.addInnateSpell({name: SPELL_DATA.name, source: SPELL_DATA.source, level: 1, atWill: false, uses: 2, recharge: "long"});
		const grant = innate.state.getInnateSpells().find(s => s.name === SPELL_DATA.name);
		const usesBefore = grant.uses.current;
		await innate.spells._castInnateSpell(grant.id);
		expect(innate.state.rollD20).toHaveBeenCalled();
		expect(innate.state.getInnateSpells().find(s => s.id === grant.id).uses.current).toBe(usesBefore);
	});

	it("does not invoke or destroy an item when its cast fails or its destruction is declined", async () => {
		const {state, spells} = makeHarness({spellData: CONCENTRATION_DATA, dice: [2, 18]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.setConcentration("Haste", 3);
		const power = {
			id: "power",
			itemId: "item",
			itemName: "Magic Wand",
			kind: "spell",
			spellName: "Bless",
			spellSource: "XPHB",
			isAvailable: true,
			isDestructive: true,
			chargesCost: 1,
		};
		state.getItemPower = jest.fn(() => power);
		state.invokeItemPower = jest.fn();
		const inventory = Object.create(CharacterSheetInventory.prototype);
		inventory._state = state;
		inventory._page = {_spells: spells};
		inventory._pConfirmDestructiveItemPower = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		expect(await inventory._pInvokeItemPower("item", "power")).toBe(false);
		expect(state.rollD20).not.toHaveBeenCalled();
		expect(state.invokeItemPower).not.toHaveBeenCalled();
		expect(state.getConcentratingSpell().spellName).toBe("Haste");

		expect(await inventory._pInvokeItemPower("item", "power")).toBe(false);
		expect(state.rollD20).toHaveBeenCalled();
		expect(state.invokeItemPower).not.toHaveBeenCalled();
		expect(state.getConcentratingSpell().spellName).toBe("Haste");
	});

	it("confirms a destructive item spell before casting and commits its charge once", async () => {
		const {state, spells} = makeHarness({spellData: CONCENTRATION_DATA, dice: [14, 18]});
		state.addCondition({name: "Frightened", source: "TGTT"});
		state.setConcentration("Haste", 3);
		const power = {
			id: "power",
			itemId: "item",
			itemName: "Magic Wand",
			name: "Bless",
			kind: "spell",
			spellName: "Bless",
			spellSource: "XPHB",
			isAvailable: true,
			isDestructive: true,
			chargesCost: 1,
		};
		state.getItemPower = jest.fn(() => power);
		state.invokeItemPower = jest.fn(() => ({ok: true, power, chargesMax: 3, chargesCurrent: 2}));
		const inventory = Object.create(CharacterSheetInventory.prototype);
		inventory._state = state;
		inventory._page = {_spells: spells};
		inventory._pConfirmDestructiveItemPower = jest.fn(async () => true);
		inventory._updateItemBonuses = jest.fn();
		inventory._renderItemList = jest.fn();

		expect(await inventory._pInvokeItemPower("item", "power", {chargesCost: 1})).toBe(true);
		expect(inventory._pConfirmDestructiveItemPower).toHaveBeenCalledTimes(1);
		expect(state.rollD20).toHaveBeenCalled();
		expect(state.invokeItemPower).toHaveBeenCalledTimes(1);
		expect(state.invokeItemPower).toHaveBeenCalledWith("item", "power", {chargesCost: 1, confirmed: true});
		expect(state.getConcentratingSpell().spellName).toBe("Bless");
	});
});
