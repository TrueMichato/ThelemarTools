import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;

const CLASS_UID = "Artificer|EFA";
const OWNER_UID = "Alchemist|Artificer|EFA|EFA";
const LESSER_RESTORATION_UID = "Lesser Restoration|XPHB";
const CAULDRON_UID = "Tasha's Bubbling Cauldron|XPHB";
const LESSER_RESTORATION_FEATURE_UID = "Restorative Reagents|Artificer|EFA|Alchemist|EFA|9|EFA";
const CAULDRON_FEATURE_UID = "Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA";
const ALCHEMIST_SUPPLIES_RULE_ID = "efa-alchemist-alchemists-supplies-required";

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const TCE_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "TCE");
const EFA_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const EFA_TCE_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "TCE"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const TCE_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "TCE"
	&& sc.className === "Artificer"
	&& sc.classSource === "TCE",
);

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

function subclassSnapshot (subclass) {
	return {
		name: subclass.name,
		shortName: subclass.shortName,
		source: subclass.source,
		casterProgression: subclass.casterProgression,
		spellcastingAbility: subclass.spellcastingAbility,
		additionalSpells: copy(subclass.additionalSpells),
	};
}

function classEntry ({source = "EFA", level = 15, subclass = EFA_ALCHEMIST} = {}) {
	const cls = source === "EFA" ? EFA_ARTIFICER : TCE_ARTIFICER;
	return {
		name: cls.name,
		source: cls.source,
		level,
		spellcastingAbility: cls.spellcastingAbility,
		casterProgression: cls.casterProgression,
		preparedSpellsProgression: copy(cls.preparedSpellsProgression),
		cantripProgression: copy(cls.cantripProgression),
		subclass: subclass ? subclassSnapshot(subclass) : null,
	};
}

function makeState ({
	source = "EFA",
	level = 15,
	subclass = EFA_ALCHEMIST,
	intelligence = 18,
	beforeClass,
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	state.setAbilityBase("int", intelligence);
	beforeClass?.(state);
	state.addClass(classEntry({source, level, subclass}));
	return state;
}

function getGrant (state, spellUid) {
	return state.getInnateSpells().find(spell => spell.ownerUid === OWNER_UID && spell.spellUid === spellUid);
}

function getGrantResource (state, spellUid) {
	return state.getResources().find(resource => resource.ownerUid === OWNER_UID && resource.spellUid === spellUid);
}

function getSpell (name) {
	const spell = XPHB_SPELLS.find(it => it.name === name && it.source === "XPHB");
	if (!spell) throw new Error(`Missing XPHB spell fixture: ${name}`);
	return spell;
}

function addPreparedSpell (state, name) {
	const spell = getSpell(name);
	state.addSpell({
		name: spell.name,
		source: spell.source,
		level: spell.level,
		school: spell.school,
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
	}, true);
}

function addAlchemistSupplies (state, {
	id = "alchemist-supplies",
	name = "Alchemist's Supplies",
	source = "XPHB",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({
		id,
		name,
		source,
		type: "AT",
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped(id, equipped);
	if (proficient) state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function makeSpellsController (state, {cancelResult = false} = {}) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._allSpells = XPHB_SPELLS;
	spells._page = {
		saveCharacter: jest.fn(),
		_renderResources: jest.fn(),
		_features: {_renderResources: jest.fn()},
		_combat: {renderCombatResources: jest.fn()},
	};
	spells._showCastResult = jest.fn(async () => ({cancelled: cancelResult}));
	spells._pConsumeMaterialComponent = jest.fn(async () => ({consumed: null}));
	spells._renderSpellList = jest.fn();
	return spells;
}

beforeEach(() => {
	jest.clearAllMocks();
	globalThis.InputUiUtil.pGetUserEnum = jest.fn();
	globalThis.InputUiUtil.pGetUserBoolean = jest.fn();
});

describe("EFA Alchemist innate spell grant metadata", () => {
	test("uses exact EFA level/source gates and canonical linked metadata", () => {
		expect(getGrant(makeState({level: 8}), LESSER_RESTORATION_UID)).toBeUndefined();

		const level9 = makeState({level: 9, intelligence: 18});
		const lesser = getGrant(level9, LESSER_RESTORATION_UID);
		const lesserResource = getGrantResource(level9, LESSER_RESTORATION_UID);
		expect(lesser).toEqual(expect.objectContaining({
			grantId: expect.any(String),
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: LESSER_RESTORATION_UID,
			source: "XPHB",
			recharge: "long",
			spellcastingAbility: "int",
			ignoresPreparation: true,
			ignoresMaterialComponents: true,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			sourceSubclass: "Alchemist",
			sourceSubclassSource: "EFA",
			sourceFeatureUid: "Restorative Reagents|Artificer|EFA|Alchemist|EFA|9|EFA",
			spellcastingFocusRequirement: expect.objectContaining({
				required: true,
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: LESSER_RESTORATION_FEATURE_UID,
				filter: {
					itemUids: ["Alchemist's Supplies|XPHB"],
					requiresProficiency: true,
				},
			}),
			maxMode: "abilityMod",
			maxAbility: "int",
			uses: {current: 4, max: 4},
		}));
		expect(lesserResource).toEqual(expect.objectContaining({
			grantId: lesser.grantId,
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: LESSER_RESTORATION_UID,
			recharge: "long",
			maxMode: "abilityMod",
			maxAbility: "int",
			current: 4,
			max: 4,
			linkedInnateSpellId: lesser.id,
		}));
		expect(lesser.linkedResourceId).toBe(lesserResource.id);
		expect(getGrant(level9, CAULDRON_UID)).toBeUndefined();

		const level15 = makeState({level: 15});
		const cauldron = getGrant(level15, CAULDRON_UID);
		expect(cauldron).toEqual(expect.objectContaining({
			grantId: expect.any(String),
			ownerUid: OWNER_UID,
			classUid: CLASS_UID,
			subclassUid: OWNER_UID,
			spellUid: CAULDRON_UID,
			source: "XPHB",
			recharge: "long",
			ignoresPreparation: true,
			ignoresMaterialComponents: true,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			sourceSubclass: "Alchemist",
			sourceSubclassSource: "EFA",
			sourceFeatureUid: "Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA",
			spellcastingFocusRequirement: expect.objectContaining({
				required: true,
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: CAULDRON_FEATURE_UID,
				filter: {
					itemUids: ["Alchemist's Supplies|XPHB"],
					requiresProficiency: true,
				},
			}),
			uses: {current: 1, max: 1},
		}));
		expect(getGrantResource(level15, CAULDRON_UID)).toEqual(expect.objectContaining({
			grantId: cauldron.grantId,
			current: 1,
			max: 1,
			linkedInnateSpellId: cauldron.id,
		}));

		expect(getGrant(makeState({level: 20, subclass: EFA_TCE_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(makeState({source: "TCE", level: 20, subclass: TCE_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(makeState({source: "TCE", level: 20, subclass: EFA_ALCHEMIST}), LESSER_RESTORATION_UID)).toBeUndefined();
	});

	test("preserves spent Lesser Restoration uses when Intelligence changes", () => {
		const state = makeState({level: 15, intelligence: 18});
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 2, max: 4});

		state.setAbilityBase("int", 14);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 0, max: 2});
		expect(getGrantResource(state, LESSER_RESTORATION_UID)).toEqual(expect.objectContaining({current: 0, max: 2}));

		state.setAbilityBase("int", 20);
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 3, max: 5});
		expect(getGrantResource(state, LESSER_RESTORATION_UID)).toEqual(expect.objectContaining({current: 3, max: 5}));
	});

	test("spends no prepared allowance or spell slot and restores both successful casts on Long Rest", async () => {
		const state = makeState({level: 15});
		addAlchemistSupplies(state);
		state._data.spellcasting.spellSlots[1] = {current: 2, max: 4};
		const preparedMax = state.getMaxPreparedSpells("Artificer");
		const spellsController = makeSpellsController(state);

		expect(state.getSpellsKnown().filter(spell => [LESSER_RESTORATION_UID, CAULDRON_UID].includes(`${spell.name}|${spell.source}`))).toEqual([]);
		const grants = state.getInnateSpells();
		const lesser = grants.find(spell => spell.ownerUid === OWNER_UID && spell.spellUid === LESSER_RESTORATION_UID);
		const cauldron = grants.find(spell => spell.ownerUid === OWNER_UID && spell.spellUid === CAULDRON_UID);
		expect(spellsController._renderInnateSpellItem(lesser).outerHTML).toContain("charsheet__innate-cast");
		expect(spellsController._renderInnateSpellItem(cauldron).outerHTML).toContain("charsheet__innate-cast");
		await spellsController._castInnateSpell(lesser.id, {decision: {focusInventoryItemId: "alchemist-supplies"}});
		await spellsController._castInnateSpell(cauldron.id, {decision: {focusInventoryItemId: "alchemist-supplies"}});
		expect(state._data.spellcasting.spellSlots[1]).toEqual({current: 2, max: 4});
		expect(state.getMaxPreparedSpells("Artificer")).toBe(preparedMax);
		expect(getGrantResource(state, LESSER_RESTORATION_UID).current).toBe(3);
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(0);

		state.onLongRest();
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 4, max: 4});
		expect(getGrant(state, CAULDRON_UID).uses).toEqual({current: 1, max: 1});
		expect(getGrantResource(state, LESSER_RESTORATION_UID).current).toBe(4);
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(1);
	});

	test("round-trips and repairs owned metadata idempotently without refunding spent uses", () => {
		const state = makeState({level: 15});
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		expect(state.useInnateSpell(lesser.id)).toBe(true);
		const saved = state.toJson();
		const savedLesser = saved.spellcasting.innateSpells.find(spell => spell.spellUid === LESSER_RESTORATION_UID);
		const savedResource = saved.resources.find(resource => resource.spellUid === LESSER_RESTORATION_UID);
		delete savedLesser.grantId;
		delete savedLesser.linkedResourceId;
		delete savedResource.grantId;
		delete savedResource.linkedInnateSpellId;
		saved.spellcasting.innateSpells.push({...copy(savedLesser), id: "duplicate-owned-lesser"});
		saved.resources.push({...copy(savedResource), id: "duplicate-owned-lesser-resource"});

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(saved);
		expect(loaded.getInnateSpells().filter(spell => spell.ownerUid === OWNER_UID && spell.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(loaded.getResources().filter(resource => resource.ownerUid === OWNER_UID && resource.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(getGrant(loaded, LESSER_RESTORATION_UID).uses).toEqual({current: 3, max: 4});

		const once = loaded.toJson();
		loaded.applyClassFeatureEffects();
		expect(loaded.toJson()).toEqual(once);
		const reloaded = new CharacterSheetState();
		reloaded.setSpellData(XPHB_SPELLS);
		reloaded.loadFromJson(once);
		expect(reloaded.toJson()).toEqual(once);
	});

	test("keeps independent prepared and innate copies isolated from EFA ownership cleanup", () => {
		let independentInnateId;
		const state = makeState({
			level: 15,
			beforeClass: current => {
				addPreparedSpell(current, "Lesser Restoration");
				independentInnateId = current.addInnateSpell({
					name: "Tasha's Bubbling Cauldron",
					source: "XPHB",
					spellcastingAbility: "int",
					uses: {current: 1, max: 1},
					maxUses: 1,
					recharge: "long",
					sourceFeature: "Independent Boon",
				});
			},
		});

		expect(state.getInnateSpells().filter(spell => spell.name === "Tasha's Bubbling Cauldron" && spell.source === "XPHB")).toHaveLength(2);
		expect(state.getPreparedSpells().some(spell => spell.name === "Lesser Restoration" && spell.source === "XPHB")).toBe(true);

		state.setSubclass("Artificer", subclassSnapshot(EFA_TCE_ALCHEMIST));
		expect(getGrant(state, LESSER_RESTORATION_UID)).toBeUndefined();
		expect(getGrant(state, CAULDRON_UID)).toBeUndefined();
		expect(state.getPreparedSpells().some(spell => spell.name === "Lesser Restoration" && spell.source === "XPHB")).toBe(true);
		expect(state.getInnateSpells().find(spell => spell.id === independentInnateId)).toEqual(expect.objectContaining({
			name: "Tasha's Bubbling Cauldron",
			sourceFeature: "Independent Boon",
		}));
		expect(state.getResources().filter(resource => resource.ownerUid === OWNER_UID)).toEqual([]);
	});

	test("removing the EFA parent removes only its owned grant/resource state", () => {
		const state = makeState({
			level: 15,
			beforeClass: current => {
				addPreparedSpell(current, "Tasha's Bubbling Cauldron");
				current.addResource({
					id: "player-cauldron-tracker",
					name: "Tasha's Bubbling Cauldron (Chemical Mastery)",
					current: 2,
					max: 3,
					recharge: "long",
				});
			},
		});
		expect(getGrant(state, LESSER_RESTORATION_UID)).toBeDefined();
		expect(getGrant(state, CAULDRON_UID)).toBeDefined();
		expect(state.getResources().find(resource => resource.id === "player-cauldron-tracker")).toBeDefined();

		state.removeClass("Artificer", "EFA");
		expect(state.getInnateSpells().filter(spell => spell.ownerUid === OWNER_UID)).toEqual([]);
		expect(state.getResources().filter(resource => resource.ownerUid === OWNER_UID)).toEqual([]);
		expect(state.getResources().find(resource => resource.id === "player-cauldron-tracker")).toEqual(expect.objectContaining({current: 2, max: 3}));
		expect(state.getPreparedSpells().some(spell => spell.name === "Tasha's Bubbling Cauldron" && spell.source === "XPHB")).toBe(true);
	});
});

describe("EFA Alchemist executable innate casts", () => {
	test("casts Lesser Restoration through exact XPHB supplies and commits the linked use before hooks", async () => {
		const state = makeState({level: 15, intelligence: 18});
		addAlchemistSupplies(state);
		const slotsBefore = copy(state.getSpellSlots());
		const preparedMax = state.getMaxPreparedSpells("Artificer");
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		const spells = makeSpellsController(state);
		const observer = jest.fn(() => getGrantResource(state, LESSER_RESTORATION_UID).current);
		state.registerCommittedSpellCastHook(CLASS_UID, observer, {hookId: "lesser-observer"});

		const receipt = await spells._castInnateSpell(lesser.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		});

		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({
				id: lesser.id,
				name: "Lesser Restoration",
				sourceClass: "Artificer",
				sourceClassSource: "EFA",
			}),
			2,
			false,
			false,
			expect.objectContaining({
				ignoresMaterialComponents: true,
				spellcastingFocus: expect.objectContaining({
					inventoryItemId: "alchemist-supplies",
					itemUid: "Alchemist's Supplies|XPHB",
				}),
			}),
		);
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 3, max: 4});
		expect(getGrantResource(state, LESSER_RESTORATION_UID)).toEqual(expect.objectContaining({current: 3, max: 4}));
		expect(state.getSpellSlots()).toEqual(slotsBefore);
		expect(state.getMaxPreparedSpells("Artificer")).toBe(preparedMax);
		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			castingClassUid: CLASS_UID,
			castingSubclassUid: OWNER_UID,
			spellEntryId: lesser.id,
			spellUid: LESSER_RESTORATION_UID,
			castType: "innate",
			slotLevel: 2,
			ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
			sourceFeatureUid: LESSER_RESTORATION_FEATURE_UID,
			focusRule: {
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: LESSER_RESTORATION_FEATURE_UID,
			},
			focusInventoryItemId: "alchemist-supplies",
			focusItemUid: "Alchemist's Supplies|XPHB",
			cast: expect.objectContaining({
				innateSpellId: lesser.id,
				resourceId: lesser.linkedResourceId,
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: LESSER_RESTORATION_FEATURE_UID,
			}),
			followUps: expect.arrayContaining([
				{hookId: "lesser-observer", ok: true, value: 3},
				{hookId: "efa-alchemical-savant", ok: true, value: {applied: false, reason: "noEligibleRoll"}},
			]),
		}));
		expect(observer).toHaveBeenCalledWith(receipt);
		expect(state.resolveCommittedSpellCastReceiptFocus(receipt)).toEqual(expect.objectContaining({
			id: "alchemist-supplies",
			item: expect.objectContaining({name: "Alchemist's Supplies", source: "XPHB"}),
		}));
		expect(spells._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(spells._renderSpellList).toHaveBeenCalledTimes(1);
		expect(spells._page._renderResources).toHaveBeenCalledTimes(1);
		expect(spells._page._features._renderResources).toHaveBeenCalledTimes(1);
		expect(spells._page._combat.renderCombatResources).toHaveBeenCalledTimes(1);
	});

	test("casts Cauldron without a slot, preparation, or Material component and rejects a depleted retry", async () => {
		const state = makeState({level: 15});
		addAlchemistSupplies(state);
		const slotsBefore = copy(state.getSpellSlots());
		const preparedMax = state.getMaxPreparedSpells("Artificer");
		const cauldron = getGrant(state, CAULDRON_UID);
		const spells = makeSpellsController(state);
		const observer = jest.fn(() => getGrantResource(state, CAULDRON_UID).current);
		state.registerCommittedSpellCastHook(CLASS_UID, observer, {hookId: "cauldron-observer"});

		const receipt = await spells._castInnateSpell(cauldron.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		});

		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({id: cauldron.id, name: "Tasha's Bubbling Cauldron"}),
			6,
			false,
			false,
			expect.objectContaining({
				ignoresMaterialComponents: true,
				spellcastingFocus: expect.objectContaining({inventoryItemId: "alchemist-supplies"}),
			}),
		);
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
		expect(state.getSpellSlots()).toEqual(slotsBefore);
		expect(state.getMaxPreparedSpells("Artificer")).toBe(preparedMax);
		expect(getGrant(state, CAULDRON_UID).uses).toEqual({current: 0, max: 1});
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(0);
		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			spellUid: CAULDRON_UID,
			castType: "innate",
			slotLevel: 6,
			ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
			sourceFeatureUid: CAULDRON_FEATURE_UID,
			focusRule: {
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: CAULDRON_FEATURE_UID,
			},
			focusInventoryItemId: "alchemist-supplies",
			focusItemUid: "Alchemist's Supplies|XPHB",
			cast: expect.objectContaining({
				ruleId: ALCHEMIST_SUPPLIES_RULE_ID,
				sourceFeatureUid: CAULDRON_FEATURE_UID,
			}),
			followUps: expect.arrayContaining([
				{hookId: "cauldron-observer", ok: true, value: 0},
				{hookId: "efa-alchemical-savant", ok: true, value: {applied: false, reason: "noEligibleRoll"}},
			]),
		}));

		expect(await spells._castInnateSpell(cauldron.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		})).toBeUndefined();
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(observer).toHaveBeenCalledTimes(1);
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(0);
	});

	test.each([
		["missing supplies", null],
		["same-name PHB supplies", {name: "Alchemist's Supplies", source: "PHB"}],
		["unrelated proficient tools", {name: "Smith's Tools", source: "XPHB"}],
		["unproficient XPHB supplies", {name: "Alchemist's Supplies", source: "XPHB", proficient: false}],
	])("blocks %s before spell resolution or resource spend", async (_label, focus) => {
		const state = makeState({level: 15});
		if (focus) addAlchemistSupplies(state, focus);
		const lesser = getGrant(state, LESSER_RESTORATION_UID);
		const spells = makeSpellsController(state);
		const hook = jest.fn();
		state.registerCommittedSpellCastHook(CLASS_UID, hook);

		expect(await spells._castInnateSpell(lesser.id)).toBeUndefined();
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(getGrant(state, LESSER_RESTORATION_UID).uses).toEqual({current: 4, max: 4});
		expect(getGrantResource(state, LESSER_RESTORATION_UID).current).toBe(4);
		expect(hook).not.toHaveBeenCalled();
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
	});

	test("treats focus-picker and downstream target cancellation as complete pre-spend no-ops", async () => {
		const pickerState = makeState({level: 15});
		addAlchemistSupplies(pickerState, {id: "supplies-a"});
		addAlchemistSupplies(pickerState, {id: "supplies-b"});
		const pickerGrant = getGrant(pickerState, LESSER_RESTORATION_UID);
		const pickerSpells = makeSpellsController(pickerState);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue(null);

		expect(await pickerSpells._castInnateSpell(pickerGrant.id)).toBeUndefined();
		expect(pickerSpells._showCastResult).not.toHaveBeenCalled();
		expect(getGrantResource(pickerState, LESSER_RESTORATION_UID).current).toBe(4);

		const targetState = makeState({level: 15});
		addAlchemistSupplies(targetState);
		const targetGrant = getGrant(targetState, LESSER_RESTORATION_UID);
		const targetSpells = makeSpellsController(targetState, {cancelResult: true});
		const hook = jest.fn();
		targetState.registerCommittedSpellCastHook(CLASS_UID, hook);

		expect(await targetSpells._castInnateSpell(targetGrant.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		})).toBeUndefined();
		expect(targetSpells._showCastResult).toHaveBeenCalledTimes(1);
		expect(getGrant(targetState, LESSER_RESTORATION_UID).uses).toEqual({current: 4, max: 4});
		expect(getGrantResource(targetState, LESSER_RESTORATION_UID).current).toBe(4);
		expect(hook).not.toHaveBeenCalled();
		expect(targetSpells._page.saveCharacter).not.toHaveBeenCalled();

		const staleFocusState = makeState({level: 15});
		addAlchemistSupplies(staleFocusState);
		const staleFocusGrant = getGrant(staleFocusState, LESSER_RESTORATION_UID);
		const staleFocusSpells = makeSpellsController(staleFocusState);
		const staleFocusHook = jest.fn();
		staleFocusState.registerCommittedSpellCastHook(CLASS_UID, staleFocusHook);
		staleFocusSpells._showCastResult.mockImplementation(async () => {
			staleFocusState.setItemEquipped("alchemist-supplies", false);
			return {cancelled: false};
		});

		expect(await staleFocusSpells._castInnateSpell(staleFocusGrant.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		})).toBeUndefined();
		expect(getGrantResource(staleFocusState, LESSER_RESTORATION_UID).current).toBe(4);
		expect(staleFocusHook).not.toHaveBeenCalled();
	});

	test.each([
		["under-level custom collision", {source: "EFA", level: 8, subclass: EFA_ALCHEMIST}],
		["TCE subclass under EFA parent", {source: "EFA", level: 15, subclass: EFA_TCE_ALCHEMIST}],
		["TCE parent and subclass", {source: "TCE", level: 15, subclass: TCE_ALCHEMIST}],
	])("does not expose or spend a Restorative Reagents collision for %s", async (_label, stateOptions) => {
		const state = makeState(stateOptions);
		addAlchemistSupplies(state);
		const collisionId = state.addInnateSpell({
			id: `collision-${stateOptions.source}-${stateOptions.subclass.source}`,
			name: "Lesser Restoration",
			source: "XPHB",
			sourceFeature: "Restorative Reagents",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			sourceSubclass: "Alchemist",
			sourceSubclassSource: "EFA",
			uses: {current: 1, max: 1},
			maxUses: 1,
			recharge: "long",
		});
		const collision = state.getInnateSpells().find(spell => spell.id === collisionId);
		const spells = makeSpellsController(state);

		expect(collision).toBeDefined();
		expect(state.canExecuteInnateSpellCast(collision)).toBe(false);
		expect(spells._renderInnateSpellItem(collision).outerHTML).not.toContain("charsheet__innate-cast");
		expect(await spells._castInnateSpell(collision.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		})).toBeUndefined();
		expect(collision.uses.current).toBe(1);
		expect(spells._showCastResult).not.toHaveBeenCalled();
	});

	test("round-trips a spent grant and stable focus identity before the next committed cast", async () => {
		const state = makeState({level: 15});
		addAlchemistSupplies(state, {id: "stable-supplies"});
		const firstGrant = getGrant(state, LESSER_RESTORATION_UID);
		const firstSpells = makeSpellsController(state);
		await firstSpells._castInnateSpell(firstGrant.id, {
			decision: {focusInventoryItemId: "stable-supplies"},
		});

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		loaded.loadFromJson(copy(state.toJson()));
		const loadedGrant = getGrant(loaded, LESSER_RESTORATION_UID);
		const loadedSpells = makeSpellsController(loaded);
		const receipt = await loadedSpells._castInnateSpell(loadedGrant.id, {
			decision: {focusInventoryItemId: "stable-supplies"},
		});

		expect(getGrant(loaded, LESSER_RESTORATION_UID).uses).toEqual({current: 2, max: 4});
		expect(loaded.getInnateSpells().filter(spell => spell.ownerUid === OWNER_UID && spell.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(loaded.getResources().filter(resource => resource.ownerUid === OWNER_UID && resource.spellUid === LESSER_RESTORATION_UID)).toHaveLength(1);
		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			focusInventoryItemId: "stable-supplies",
			focusItemUid: "Alchemist's Supplies|XPHB",
		}));
		expect(loaded.resolveCommittedSpellCastReceiptFocus(receipt)?.id).toBe("stable-supplies");
	});

	test("keeps a post-commit hook failure spent and does not enable a Cauldron retry", async () => {
		const state = makeState({level: 15});
		addAlchemistSupplies(state);
		const cauldron = getGrant(state, CAULDRON_UID);
		const spells = makeSpellsController(state);
		const failedHook = jest.fn(() => {
			throw new Error("follow-up exploded");
		});
		state.registerCommittedSpellCastHook(CLASS_UID, failedHook, {hookId: "failed-follow-up"});

		const receipt = await spells._castInnateSpell(cauldron.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		});

		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			followUpFailed: true,
			followUps: expect.arrayContaining([
				{hookId: "failed-follow-up", ok: false, error: "follow-up exploded"},
				{hookId: "efa-alchemical-savant", ok: true, value: {applied: false, reason: "noEligibleRoll"}},
			]),
		}));
		expect(getGrantResource(state, CAULDRON_UID).current).toBe(0);
		expect(await spells._castInnateSpell(cauldron.id, {
			decision: {focusInventoryItemId: "alchemist-supplies"},
		})).toBeUndefined();
		expect(failedHook).toHaveBeenCalledTimes(1);
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	});
});
