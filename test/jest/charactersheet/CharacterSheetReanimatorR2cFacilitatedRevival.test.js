import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import {CharacterSheetRest} from "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetArtificerPlans = globalThis.CharacterSheetArtificerPlans;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;
const ITEM_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/items.json"),
	"utf8",
));
const MAGIC_VARIANT_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/magicvariants.json"),
	"utf8",
));
const PLAN_ITEMS = [
	...ITEM_DATA.item,
	...MAGIC_VARIANT_DATA.magicvariant.map(variant => ({
		...variant,
		source: variant.source || variant.inherits?.source,
	})),
	{name: "+1 Shield", source: "XDMG"},
	{name: "Armor of Resistance", source: "XDMG"},
	{name: "+2 Shield", source: "XDMG"},
];

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(subclass =>
	subclass.name === "Reanimator"
	&& subclass.source === "RHW"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);
const FEATURE_UID = "Refined Reanimation|Artificer|EFA|Reanimator|RHW|15";
const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const FIXED_SPELLS_UID = "Reanimator Spells|Artificer|EFA|Reanimator|RHW|3";
const SPELL_UID = "Raise Dead|XPHB";

const copy = value => JSON.parse(JSON.stringify(value));

function subclassSnapshot (source = "RHW") {
	return {
		name: REANIMATOR.name,
		shortName: REANIMATOR.shortName,
		source,
		casterProgression: REANIMATOR.casterProgression,
		spellcastingAbility: REANIMATOR.spellcastingAbility,
		additionalSpells: copy(REANIMATOR.additionalSpells || []),
	};
}

function makeState ({
	level = 15,
	classSource = "EFA",
	subclassSource = "RHW",
	playerOwnedRaiseDead = false,
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	state.setAbilityBase("int", 18);
	if (playerOwnedRaiseDead) {
		const raiseDead = XPHB_SPELLS.find(spell => spell.name === "Raise Dead" && spell.source === "XPHB");
		state.addSpell({
			...raiseDead,
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
			sourceClassSource: "XPHB",
			prepared: true,
			alwaysPrepared: false,
		}, true);
	}
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		spellcastingAbility: "int",
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: level >= 3 ? subclassSnapshot(subclassSource) : null,
	});
	return state;
}

function addTool (state, {
	id = "facilitated-tool",
	name = "Tinker's Tools",
	source = "XPHB",
	type = "AT|XPHB",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({id, name, source, type, quantity: 1, _isCustom: true});
	state.setItemEquipped(id, equipped);
	if (proficient) state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function getResource (state) {
	return state._data.resources.find(resource =>
		resource.featureUid === FEATURE_UID
		&& resource.classUid === CLASS_UID
		&& resource.subclassUid === SUBCLASS_UID);
}

function getRaiseDead (state) {
	return state.getSpellsKnown().find(spell => spell.name === "Raise Dead" && spell.source === "XPHB");
}

function getOwners (state, ownerUid) {
	return (getRaiseDead(state)?.subclassSpellGrantOwners || [])
		.filter(owner => owner.grantOwnerUid === ownerUid);
}

function getR2cAtomicState (state) {
	const cls = state.getClasses().find(candidate => candidate.name === "Artificer" && candidate.source === "EFA");
	const spell = getRaiseDead(state);
	return {
		classLevel: cls?.level || null,
		subclass: copy(cls?.subclass || null),
		resource: copy(getResource(state) || null),
		spell: spell ? {
			id: spell.id,
			name: spell.name,
			source: spell.source,
			prepared: spell.prepared,
			alwaysPrepared: spell.alwaysPrepared,
			sourceFeature: spell.sourceFeature,
			sourceClass: spell.sourceClass,
			sourceClassSource: spell.sourceClassSource,
			sourceSubclass: spell.sourceSubclass,
			sourceSubclassSource: spell.sourceSubclassSource,
			owners: copy(spell.subclassSpellGrantOwners || []),
		} : null,
		inventory: copy(state.getInventory()),
		toolProficiencies: copy(state.getToolProficiencies()),
	};
}

function getFocusReference (state, id = "facilitated-tool") {
	const row = state.getInventory().find(candidate => candidate.id === id);
	return state.getSpellCastFocusReference(row);
}

function getUseInput (state, overrides = {}) {
	return {
		featureUid: FEATURE_UID,
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		spellName: "Raise Dead",
		spellSource: "XPHB",
		spellOwnerUid: FEATURE_UID,
		focusReference: getFocusReference(state),
		...overrides,
	};
}

function makeRespecPage (state) {
	return {
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => ARTIFICER_DATA.classFeature,
		getSubclassFeatures: () => ARTIFICER_DATA.subclassFeature,
		getOptionalFeatures: () => [],
		getItems: () => PLAN_ITEMS,
		filterByAllowedSources: values => values,
		getSpells: () => XPHB_SPELLS,
		getFilteredSpellData: () => XPHB_SPELLS,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function resolveFixtureOnlyRespecDecisions (engine) {
	const used = new Set();
	while (true) {
		const decision = engine.manifest.decisions.find(it =>
			it.type === CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE
			&& it.required
			&& it.selection == null);
		if (!decision) break;
		const selection = decision.options.find(option => {
			const identity = CharacterSheetArtificerPlans.getSelectionIdentity(option);
			return identity && !used.has(identity);
		});
		if (!selection) throw new Error("No legal unique Artificer plan remained for the Facilitated Revival Respec fixture.");
		used.add(CharacterSheetArtificerPlans.getSelectionIdentity(selection));
		engine.stageGraphMutation(decision.id, selection);
	}
	for (const decision of engine.manifest.decisions) decision.status = "resolved";
	expect(engine.getValidation().errors).toEqual([]);
}

describe("RHW Reanimator R2c Facilitated Revival boundary", () => {
	it("is read-only and becomes executable only with a live exact-source proficient Artisan focus", () => {
		const state = makeState();
		const before = JSON.stringify(state.toJson());

		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			available: true,
			executable: false,
			reason: "focusUnavailable",
			featureUid: FEATURE_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			focus: {status: "unavailable", eligibleReferences: []},
		});
		expect(JSON.stringify(state.toJson())).toBe(before);

		addTool(state);
		const boundary = state.getRhwFacilitatedRevivalBoundary();
		expect(boundary).toMatchObject({
			available: true,
			executable: true,
			reason: null,
			resource: {current: 1, max: 1, recharge: "long"},
			focus: {
				status: "ready",
				requirement: {
					ruleId: "rhw-facilitated-revival-focus",
					classUid: CLASS_UID,
					filter: {
						itemTypes: ["AT"],
						itemSources: ["XPHB"],
						requiresProficiency: true,
					},
				},
				eligibleReferences: [{
					inventoryItemId: "facilitated-tool",
					itemUid: "Tinker's Tools|XPHB",
					name: "Tinker's Tools",
					source: "XPHB",
				}],
			},
		});
		expect(state.getFeatureCalculations().facilitatedRevival).toMatchObject({
			executable: true,
			executionAvailable: true,
			status: null,
			focusStatus: "ready",
			eligibleFocusReferences: [expect.objectContaining({itemUid: "Tinker's Tools|XPHB"})],
		});
		expect(getResource(state)).not.toHaveProperty("pendingSharedToolContract");
		expect(getOwners(state, FEATURE_UID)[0].alternateCast).not.toHaveProperty("pendingSharedToolContract");
	});

	it.each([
		["Tinker's Tools", "tinkers"],
		["Smith's Tools", "smiths"],
	])("accepts exact XPHB %s as the shared focus", (name, id) => {
		const state = makeState();
		addTool(state, {id, name});
		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			executable: true,
			focus: {eligibleReferences: [expect.objectContaining({inventoryItemId: id, itemUid: `${name}|XPHB`})]},
		});
	});

	it.each([
		["wrong Tinker's source", {name: "Tinker's Tools", source: "PHB", type: "AT"}],
		["non-artisan tool", {name: "Thieves' Tools", source: "XPHB", type: "T|XPHB"}],
		["inventory without proficiency", {name: "Smith's Tools", proficient: false}],
		["unheld focus", {name: "Smith's Tools", equipped: false}],
	])("rejects %s without mutating state", (_label, tool) => {
		const state = makeState();
		addTool(state, tool);
		const before = JSON.stringify(state.toJson());
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook(CLASS_UID, consumer);

		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			executable: false,
			reason: "focusUnavailable",
		});
		return expect(state.pUseRhwFacilitatedRevival(getUseInput(state))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "focusUnavailable",
		}).then(() => {
			expect(JSON.stringify(state.toJson())).toBe(before);
			expect(consumer).not.toHaveBeenCalled();
		});
	});

	it("rejects proficiency without inventory", async () => {
		const state = makeState();
		state.addToolProficiency("Smith's Tools");
		const before = JSON.stringify(state.toJson());

		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			executable: false,
			reason: "focusUnavailable",
		});
		await expect(state.pUseRhwFacilitatedRevival(getUseInput(state))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "focusUnavailable",
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
	});
});

describe("RHW Reanimator R2c committed cast", () => {
	it("spends once, waives slot/material costs, publishes stable focus identities, and surfaces hook failure", async () => {
		const state = makeState();
		addTool(state, {id: "stable-tinkers"});
		state.setSpellSlots(5, 2, 2);
		const resource = getResource(state);
		const spell = getRaiseDead(state);
		const observer = jest.fn(() => getResource(state).current);
		state.registerCommittedSpellCastHook(CLASS_UID, observer, {hookId: "resource-observer"});
		state.registerCommittedSpellCastHook(CLASS_UID, () => {
			throw new Error("revival follow-up exploded");
		}, {hookId: "failing-follow-up"});

		const receipt = await state.pUseRhwFacilitatedRevival(getUseInput(state, {
			focusReference: getFocusReference(state, "stable-tinkers"),
		}));

		expect(state.getSpellSlotsCurrent(5)).toBe(2);
		expect(getResource(state).current).toBe(0);
		expect(observer).toHaveBeenCalledTimes(1);
		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			castingClassUid: CLASS_UID,
			castingSubclassUid: "Reanimator|Artificer|EFA|RHW",
			spellEntryId: spell.id,
			spellUid: SPELL_UID,
			castType: "noSlotResource",
			slotLevel: 0,
			materialComponentsWaived: true,
			focusInventoryItemId: "stable-tinkers",
			focusItemUid: "Tinker's Tools|XPHB",
			focus: {
				inventoryItemId: "stable-tinkers",
				itemUid: "Tinker's Tools|XPHB",
				name: "Tinker's Tools",
				source: "XPHB",
			},
			featureCommit: {
				featureUid: FEATURE_UID,
				resourceId: resource.id,
				resourceCost: 1,
				remainingUses: 0,
			},
			followUpFailed: true,
			followUps: [
				{hookId: "resource-observer", ok: true, value: 0},
				{hookId: "failing-follow-up", ok: false, error: "revival follow-up exploded"},
			],
		}));
		expect(receipt.cast).toEqual(expect.objectContaining({
			type: "noSlotResource",
			slotLevel: 0,
			resourceId: resource.id,
			featureUid: FEATURE_UID,
			spellOwnerUid: FEATURE_UID,
			materialComponentsWaived: true,
		}));

		const afterFirst = JSON.stringify(state.toJson());
		await expect(state.pUseRhwFacilitatedRevival(getUseInput(state, {
			focusReference: getFocusReference(state, "stable-tinkers"),
		}))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "insufficientResource",
		});
		expect(JSON.stringify(state.toJson())).toBe(afterFirst);
		expect(observer).toHaveBeenCalledTimes(1);
	});

	it.each([
		["cancellation", {cancelled: true}, "cancelled"],
		["wrong feature", {featureUid: "Life Transfer|Artificer|EFA|Reanimator|RHW|15"}, "invalidFeature"],
		["wrong class", {classUid: "Artificer|TCE"}, "invalidClass"],
		["wrong subclass", {subclassUid: "Reanimator|Artificer|EFA|TST"}, "invalidSubclass"],
		["wrong spell", {spellName: "Revivify"}, "invalidSpell"],
		["wrong spell source", {spellSource: "PHB"}, "invalidSpellSource"],
		["wrong spell owner", {spellOwnerUid: FIXED_SPELLS_UID}, "invalidSpellOwner"],
		["stale focus identity", {focusReference: {inventoryItemId: "facilitated-tool", itemUid: "Tinker's Tools|PHB"}}, "invalidFocus"],
	])("%s is a byte-for-byte no-spend/no-receipt path", async (_label, override, reason) => {
		const state = makeState();
		addTool(state);
		const before = JSON.stringify(state.toJson());
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook(CLASS_UID, consumer);

		await expect(state.pUseRhwFacilitatedRevival(getUseInput(state, override))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason,
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(consumer).not.toHaveBeenCalled();
	});

	it.each([
		["Artificer|TCE", {classSource: "TCE"}],
		["Reanimator|TST", {subclassSource: "TST"}],
	])("does not activate for %s", async (_label, stateOptions) => {
		const state = makeState(stateOptions);
		addTool(state);
		const before = JSON.stringify(state.toJson());
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook(CLASS_UID, consumer);

		await expect(state.pUseRhwFacilitatedRevival(getUseInput(state))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "featureUnavailable",
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(consumer).not.toHaveBeenCalled();
	});

	it("publishes nothing when the validated generic core commit rejects", async () => {
		const state = makeState();
		addTool(state);
		const before = JSON.stringify(state.toJson());
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook(CLASS_UID, consumer);
		jest.spyOn(state, "pCommitFeatureUse").mockResolvedValue({
			ok: false,
			committed: false,
			reason: "syntheticPreCommitFailure",
		});

		await expect(state.pUseRhwFacilitatedRevival(getUseInput(state))).resolves.toEqual({
			ok: false,
			committed: false,
			reason: "syntheticPreCommitFailure",
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(consumer).not.toHaveBeenCalled();
	});
});

describe("RHW Reanimator R2c persistence, rest, ownership, and Respec", () => {
	it("recharges on a long rest but not a short rest", async () => {
		const state = makeState();
		addTool(state);
		await state.pUseRhwFacilitatedRevival(getUseInput(state));
		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;

		rest._restoreResources("short");
		expect(getResource(state).current).toBe(0);
		rest._restoreResources("long");
		expect(getResource(state).current).toBe(1);
		expect(state.getRhwFacilitatedRevivalBoundary().executable).toBe(true);
	});

	it("keeps one canonical Raise Dead across level 15, level 17, and player-owned collisions", async () => {
		const level15 = makeState({level: 15, playerOwnedRaiseDead: true});
		addTool(level15);
		expect(level15.getSpellsKnown().filter(spell => `${spell.name}|${spell.source}` === SPELL_UID)).toHaveLength(1);
		expect(getOwners(level15, FEATURE_UID)).toHaveLength(1);
		expect(getRaiseDead(level15)).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
			sourceClassSource: "XPHB",
			prepared: true,
		});
		const receipt = await level15.pUseRhwFacilitatedRevival(getUseInput(level15));
		expect(receipt).toMatchObject({
			castingClassUid: CLASS_UID,
			castingSubclassUid: "Reanimator|Artificer|EFA|RHW",
			spellUid: SPELL_UID,
		});

		const level17 = makeState({level: 17});
		expect(level17.getSpellsKnown().filter(spell => `${spell.name}|${spell.source}` === SPELL_UID)).toHaveLength(1);
		expect(getOwners(level17, FEATURE_UID)).toHaveLength(1);
		expect(getOwners(level17, FIXED_SPELLS_UID)).toHaveLength(1);
		expect(getRaiseDead(level17)).toMatchObject({alwaysPrepared: true, prepared: true});
	});

	it("round-trips the spent resource, exact owners, migrated markers, and stable focus receipt data", async () => {
		const state = makeState();
		addTool(state, {id: "stable-smiths", name: "Smith's Tools"});
		const receipt = await state.pUseRhwFacilitatedRevival(getUseInput(state, {
			focusReference: getFocusReference(state, "stable-smiths"),
		}));
		const exported = copy(state.toJson());
		const exportedResource = exported.resources.find(resource =>
			resource.featureUid === FEATURE_UID
			&& resource.classUid === CLASS_UID
			&& resource.subclassUid === SUBCLASS_UID);
		exportedResource.pendingSharedToolContract = true;
		const exportedRaiseDead = exported.spellcasting.spellsKnown.find(spell =>
			spell.name === "Raise Dead" && spell.source === "XPHB");
		const exportedOwner = exportedRaiseDead.subclassSpellGrantOwners.find(owner =>
			owner.grantOwnerUid === FEATURE_UID);
		exportedOwner.alternateCast.pendingSharedToolContract = "sharedToolReceiptAndFocusValidationR2b";
		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		expect(loaded.loadFromJson(exported)).not.toBe(false);

		expect(getResource(loaded)).toMatchObject({current: 0, max: 1});
		expect(getResource(loaded)).not.toHaveProperty("pendingSharedToolContract");
		expect(getOwners(loaded, FEATURE_UID)).toHaveLength(1);
		expect(getOwners(loaded, FEATURE_UID)[0].alternateCast).not.toHaveProperty("pendingSharedToolContract");
		expect(loaded.resolveCommittedSpellCastReceiptFocus(copy(receipt))).toEqual(expect.objectContaining({
			id: "stable-smiths",
			item: expect.objectContaining({name: "Smith's Tools", source: "XPHB"}),
		}));
	});

	it("exact subclass teardown removes only RHW ownership and its spent resource", async () => {
		const state = makeState();
		addTool(state);
		await state.pUseRhwFacilitatedRevival(getUseInput(state));
		const foreignResource = {
			id: "foreign-facilitated",
			name: "Facilitated Revival",
			current: 7,
			max: 7,
			recharge: "long",
			featureUid: "Refined Reanimation|Artificer|EFA|Reanimator|TST|15",
			classUid: CLASS_UID,
			subclassUid: "Reanimator|Artificer|EFA|TST",
		};
		state._data.resources.push(foreignResource);

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();

		expect(getResource(state)).toBeUndefined();
		expect(getOwners(state, FEATURE_UID)).toEqual([]);
		expect(state._data.resources).toEqual(expect.arrayContaining([foreignResource]));
	});

	it("Respec Apply preserves the spent use and Undo restores the exact pre-Apply state", async () => {
		const liveState = makeState();
		addTool(liveState);
		await liveState.pUseRhwFacilitatedRevival(getUseInput(liveState));
		const before = JSON.stringify(getR2cAtomicState(liveState));
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].level = 16;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).resolves.toBe(true);
		expect(getResource(liveState)).toMatchObject({current: 0, max: 1});
		expect(getOwners(liveState, FEATURE_UID)).toHaveLength(1);

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(getR2cAtomicState(liveState))).toBe(before);
	});

	it("a failed Respec Apply restores the spent resource and exact ownership byte-for-byte", async () => {
		const liveState = makeState();
		addTool(liveState);
		await liveState.pUseRhwFacilitatedRevival(getUseInput(liveState));
		const before = JSON.stringify(getR2cAtomicState(liveState));
		const page = makeRespecPage(liveState);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].subclass = null;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(JSON.stringify(getR2cAtomicState(liveState))).toBe(before);
		expect(getResource(liveState)).toMatchObject({current: 0, max: 1});
		expect(getOwners(liveState, FEATURE_UID)).toHaveLength(1);
	});
});
