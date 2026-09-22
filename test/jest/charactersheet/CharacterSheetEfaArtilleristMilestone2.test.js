import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;
let CharacterSheetPage;
const savedWindow = globalThis.window;

beforeAll(async () => {
	globalThis.window = {
		...(savedWindow || {}),
		addEventListener: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterAll(() => {
	globalThis.window = savedWindow;
});

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const objectData = JSON.parse(fs.readFileSync("data/objects.json", "utf8")).object;
const EFA_CANNON_TEMPLATE = objectData.find(it => it.name === "Eldritch Cannon" && it.source === "EFA");
const EFA_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
		&& it.source === "EFA"
		&& it.classSource === "EFA",
);
const TCE_ARTILLERIST = artificerData.subclass.find(it =>
	it.name === "Artillerist"
		&& it.source === "TCE"
		&& it.classSource === "TCE",
);

const makeClassEntry = ({source = "EFA", level = 3} = {}) => {
	const subclass = source === "EFA" ? EFA_ARTILLERIST : TCE_ARTILLERIST;
	return {
		name: "Artificer",
		source,
		level,
		hd: {number: 1, faces: 8},
		subclass: {
			name: subclass.name,
			shortName: subclass.shortName,
			source: subclass.source,
		},
	};
};

const makeState = ({source = "EFA", level = 3} = {}) => {
	const state = new CharacterSheetState();
	state.setClassSummonTemplateCatalog(objectData);
	state.addClass(makeClassEntry({source, level}));
	return state;
};

const createCannon = (state, overrides = {}) => state.createEfaEldritchCannon({
	form: "forceBallista",
	size: "S",
	placement: "deployed",
	mobility: "wheels",
	distanceFromOwnerFt: 5,
	createdWith: "freeUse",
	createdWithSlotLevel: null,
	...overrides,
});

const makeRawCannon = ({
	id = "raw-cannon",
	slot = 0,
	revision = 1,
	overrides = {},
} = {}) => ({
	id,
	name: "Eldritch Cannon",
	source: "EFA",
	type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
	origin: "Eldritch Cannon",
	generatedClassSummon: {
		templateUid: "Eldritch Cannon|EFA",
		ownerClassUid: "Artificer|EFA",
		ownerSubclassUid: "Artillerist|Artificer|EFA|EFA",
		ownerFeatureUid: "Eldritch Cannon|Artificer|EFA|Artillerist|EFA|3|EFA",
		generatedSlot: slot,
		generationVersion: 1,
	},
	form: "forceBallista",
	size: "S",
	placement: "deployed",
	mobility: "wheels",
	distanceFromOwnerFt: 5,
	currentHp: 15,
	durationRemainingMinutes: 60,
	createdWith: "freeUse",
	createdWithSlotLevel: null,
	instanceRevision: revision,
	...overrides,
});

const makeCompanionListStub = () => ({
	innerHTML: "",
	insertAdjacentHTML (position, html) {
		switch (position) {
			case "beforeend": this.innerHTML += html; break;
			case "afterbegin": this.innerHTML = `${html}${this.innerHTML}`; break;
			default: throw new Error(`Unsupported insertAdjacentHTML position: ${position}`);
		}
	},
});

const loadWithPreReconciliationCompanionSnapshot = ({saved, recordId}) => {
	const restored = new CharacterSheetState();
	restored.setClassSummonTemplateCatalog(objectData);
	const reconcileClassSummons = restored.reconcileClassSummons.bind(restored);
	let beforeReconcile = null;
	restored.reconcileClassSummons = () => {
		const previousDocument = globalThis.document;
		const list = makeCompanionListStub();
		globalThis.document = {
			getElementById: id => id === "charsheet-companions-list" ? list : null,
		};
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = restored;
		page._ensureBeastheartCompanionBonded = jest.fn();
		page._renderCompanionButtons = jest.fn();
		page._renderCompanionsOverviewIndicator = jest.fn();

		let renderError = null;
		try {
			page._renderCompanions();
		} catch (error) {
			renderError = error;
		} finally {
			globalThis.document = previousDocument;
		}

		const rawRecord = restored._data.companions.find(it => it.id === recordId);
		beforeReconcile = {
			rawType: rawRecord?.type,
			rawGeneratedClassSummon: rawRecord?.generatedClassSummon,
			companionIds: restored.getCompanions().map(it => it.id),
			activeCompanionIds: restored.getActiveCompanions().map(it => it.id),
			direct: restored.getCompanion(recordId),
			conditions: restored.getCompanionConditions(recordId),
			initiative: restored.getCompanionInitiative(recordId),
			damage: restored.damageCompanion(recordId, 5),
			removed: restored.removeCompanion(recordId),
			renderError,
			renderHtml: list.innerHTML,
		};
		return reconcileClassSummons();
	};

	restored.loadFromJson(saved);
	return {restored, beforeReconcile};
};

const expectHiddenFromGenericCompanionSurfaces = beforeReconcile => {
	expect(beforeReconcile).toMatchObject({
		companionIds: [],
		activeCompanionIds: [],
		direct: null,
		conditions: [],
		initiative: 0,
		damage: {
			remaining: 0,
			tempAbsorbed: 0,
			hpLost: 0,
			droppedToZero: false,
		},
		removed: false,
		renderError: null,
	});
	expect(beforeReconcile.renderHtml).toContain("No active companions");
	expect(beforeReconcile.renderHtml).not.toContain("Eldritch Cannon");
};

describe("EFA Artillerist generated class-summon contract", () => {
	test("persists exact ownership/runtime metadata without derived stat duplicates", () => {
		const state = makeState({level: 3});
		const created = createCannon(state);

		expect(created.ok).toBe(true);
		const [stored] = state.toJson().companions;
		expect(stored.generatedClassSummon).toEqual({
			templateUid: "Eldritch Cannon|EFA",
			ownerClassUid: "Artificer|EFA",
			ownerSubclassUid: "Artillerist|Artificer|EFA|EFA",
			ownerFeatureUid: "Eldritch Cannon|Artificer|EFA|Artillerist|EFA|3|EFA",
			generatedSlot: 0,
			generationVersion: 1,
		});
		expect(stored).toMatchObject({
			form: "forceBallista",
			size: "S",
			placement: "deployed",
			mobility: "wheels",
			distanceFromOwnerFt: 5,
			currentHp: 15,
			durationRemainingMinutes: 60,
			createdWith: "freeUse",
			createdWithSlotLevel: null,
			instanceRevision: 1,
		});
		expect(stored).not.toHaveProperty("ac");
		expect(stored).not.toHaveProperty("hp");
		expect(stored).not.toHaveProperty("immunities");
		expect(stored).not.toHaveProperty("calculations");
	});

	test("projects authoritative object defenses and current EFA formulas", () => {
		const state = makeState({level: 9});
		state.setAbilityBase("int", 18);
		let created = createCannon(state);
		let cannon = state.getEfaEldritchCannon(created.instanceId);

		expect(EFA_CANNON_TEMPLATE).toBeTruthy();
		expect(cannon).toMatchObject({
			name: "Eldritch Cannon",
			source: "EFA",
			ac: 18,
			hp: {current: 45, max: 45},
			immunities: ["poison", "psychic"],
			calculations: {
				artificerLevel: 9,
				maxCannonCount: 1,
				activationRangeFt: 60,
				movementSpeedFt: 15,
				spellAttackBonus: 8,
				spellSaveDc: 16,
				kind: "spellAttack",
				damageDice: "3d8",
				damageType: "force",
				rangeFt: 120,
				pushFt: 5,
			},
		});

		state.dismissClassSummon(created.instanceId);
		created = createCannon(state, {form: "flamethrower"});
		cannon = state.getEfaEldritchCannon(created.instanceId);
		expect(cannon.calculations).toMatchObject({
			kind: "savingThrow",
			saveAbility: "dex",
			saveDc: 16,
			damageDice: "3d8",
			damageType: "fire",
			area: {shape: "cone", sizeFt: 15},
		});

		state.dismissClassSummon(created.instanceId);
		created = createCannon(state, {
			form: "protector",
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 0,
		});
		cannon = state.getEfaEldritchCannon(created.instanceId);
		expect(cannon.calculations).toMatchObject({
			kind: "temporaryHitPoints",
			tempHpDice: "2d8",
			tempHpBonus: 4,
			rangeFt: 10,
		});
	});

	test("preserves damage across level gain, clamps on level reduction, and retires at 0 HP", () => {
		const state = makeState({level: 3});
		const {instanceId} = createCannon(state);
		expect(state.setClassSummonCurrentHp(instanceId, 8)).toMatchObject({ok: true, currentHp: 8});

		state.addClass(makeClassEntry({level: 5}));
		expect(state.getClassSummon(instanceId).hp).toEqual({current: 8, max: 25});
		expect(state.toJson().companions[0]).not.toHaveProperty("profBonus");

		state.setClassSummonCurrentHp(instanceId, 20);
		state.addClass(makeClassEntry({level: 3}));
		expect(state.getClassSummon(instanceId).hp).toEqual({current: 15, max: 15});
		expect(state.getLastClassSummonReconciliationResults()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				instanceId,
				action: "clamped",
				reason: "levelReduced",
			}),
		]));

		expect(state.setClassSummonCurrentHp(instanceId, 0)).toMatchObject({
			ok: true,
			action: "retired",
			reason: "destroyed",
		});
		expect(state.listEfaEldritchCannons()).toEqual([]);
	});

	test("advances explicit game time and expires at 0 without a wall-clock timer", () => {
		const state = makeState();
		const {instanceId} = createCannon(state);

		expect(state.advanceClassSummonGameTime(59.5)).toEqual([
			expect.objectContaining({
				instanceId,
				action: "kept",
				details: expect.objectContaining({durationRemainingMinutes: 0.5}),
			}),
		]);
		expect(state.getClassSummon(instanceId).durationRemainingMinutes).toBe(0.5);

		expect(state.advanceClassSummonGameTime(0.5)).toEqual([
			expect.objectContaining({
				instanceId,
				action: "retired",
				reason: "durationExpired",
			}),
		]);
		expect(state.getClassSummon(instanceId)).toBeNull();
		expect(() => state.advanceClassSummonGameTime(-1)).toThrow(RangeError);
	});

	test("leaves rest expiration deferred without healing or corrupting compact state", () => {
		const state = makeState({level: 5});
		const {instanceId} = createCannon(state);
		state.setClassSummonCurrentHp(instanceId, 7);
		state.advanceClassSummonGameTime(12);

		state.restCompanions("short");
		state.restCompanions("long");

		expect(state.getClassSummon(instanceId)).toMatchObject({
			hp: {current: 7, max: 25},
			durationRemainingMinutes: 48,
		});
		expect(state.toJson().companions[0]).not.toHaveProperty("hp");
		expect(state.toJson().companions[0]).not.toHaveProperty("conditions");
		expect(state.toJson().companions[0]).not.toHaveProperty("exhaustion");
	});

	test("enforces carried and deployed mobility invariants at creation and reconciliation", () => {
		const state = makeState();
		expect(createCannon(state, {mobility: null})).toMatchObject({ok: false, reason: "invalidState"});
		expect(createCannon(state, {
			placement: "carried",
			mobility: "legs",
			distanceFromOwnerFt: 0,
		})).toMatchObject({ok: false, reason: "invalidState"});
		expect(state.listEfaEldritchCannons()).toEqual([]);

		state._data.companions.push(makeRawCannon({
			overrides: {placement: "deployed", mobility: null},
		}));
		expect(state.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "invalidState"}),
		]);
		expect(state.listEfaEldritchCannons()).toEqual([]);

		expect(createCannon(state, {mobility: "legs"})).toMatchObject({ok: true});
	});

	test("increments the ownership-slot revision after retirement across save/load", () => {
		const state = makeState();
		const first = createCannon(state);
		expect(first.summon.instanceRevision).toBe(1);
		expect(state.dismissEfaEldritchCannon(first.instanceId)).toMatchObject({
			ok: true,
			reason: "dismissed",
		});

		const restored = new CharacterSheetState();
		restored.setClassSummonTemplateCatalog(objectData);
		restored.loadFromJson(state.toJson());
		const second = createCannon(restored, {
			form: "protector",
			placement: "carried",
			mobility: null,
			distanceFromOwnerFt: 0,
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
		});

		expect(second.ok).toBe(true);
		expect(second.summon).toMatchObject({
			form: "protector",
			instanceRevision: 2,
			createdWith: "spellSlot",
			createdWithSlotLevel: 1,
			calculations: {
				kind: "temporaryHitPoints",
				tempHpDice: "1d8",
			},
		});
	});

	test("round-trips an active cannon while re-deriving stats from the current level", () => {
		const state = makeState({level: 5});
		const {instanceId} = createCannon(state);
		state.setClassSummonCurrentHp(instanceId, 11);
		state.advanceClassSummonGameTime(7);
		const saved = state.toJson();

		const restored = new CharacterSheetState();
		restored.setClassSummonTemplateCatalog(objectData);
		restored.loadFromJson(saved);

		expect(restored.getClassSummon(instanceId)).toMatchObject({
			hp: {current: 11, max: 25},
			durationRemainingMinutes: 53,
			instanceRevision: 1,
		});
		expect(restored.toJson().companions[0]).not.toHaveProperty("ac");
		expect(restored.toJson().companions[0]).not.toHaveProperty("hp");
	});
});

describe("EFA cannon reconciliation", () => {
	test("deduplicates by ownership slot and keeps the newest legal revision", () => {
		const state = makeState({level: 15});
		state._data.companions.push(
			makeRawCannon({id: "older", revision: 1, overrides: {currentHp: 40}}),
			makeRawCannon({id: "newer", revision: 3, overrides: {form: "protector", currentHp: 50}}),
			makeRawCannon({id: "invalid-newest", revision: 9, overrides: {form: "laser", currentHp: 50}}),
		);

		const results = state.reconcileClassSummons();

		expect(state.listEfaEldritchCannons()).toHaveLength(1);
		expect(state.listEfaEldritchCannons()[0]).toMatchObject({instanceId: "newer", instanceRevision: 3, form: "protector"});
		expect(results).toEqual(expect.arrayContaining([
			expect.objectContaining({
				instanceId: "older",
				action: "retired",
				reason: "deduplicated",
				details: {keptInstanceId: "newer"},
			}),
			expect.objectContaining({
				instanceId: "invalid-newest",
				action: "retired",
				reason: "invalidState",
			}),
		]));
		expect(Object.values(state.toJson().generatedClassSummonRevisions)).toEqual([3]);
	});

	test("retires invalid runtime and source-crossed metadata instead of coercing it", () => {
		const invalidRuntime = makeState();
		invalidRuntime._data.companions.push(makeRawCannon({overrides: {form: "laser"}}));
		expect(invalidRuntime.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "invalidState"}),
		]);

		const tceOwner = makeState({source: "TCE"});
		tceOwner._data.companions.push(makeRawCannon());
		expect(tceOwner.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "sourceMismatch"}),
		]);

		const crossedTemplate = makeState();
		crossedTemplate._data.companions.push(makeRawCannon({
			overrides: {
				generatedClassSummon: {
					...makeRawCannon().generatedClassSummon,
					templateUid: "Eldritch Cannon|TCE",
				},
			},
		}));
		expect(crossedTemplate.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "sourceMismatch"}),
		]);

		const crossedOwner = makeState();
		crossedOwner._data.companions.push(makeRawCannon({
			overrides: {
				generatedClassSummon: {
					...makeRawCannon().generatedClassSummon,
					ownerClassUid: "Artificer|TCE",
				},
			},
		}));
		expect(crossedOwner.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "sourceMismatch"}),
		]);

		const missingTemplate = makeState();
		missingTemplate._classSummonTemplateCatalog = objectData.filter(it => it !== EFA_CANNON_TEMPLATE);
		missingTemplate._data.companions.push(makeRawCannon());
		expect(missingTemplate.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "invalidState"}),
		]);
	});

	test.each([
		["missing", undefined, null],
		["incorrect", "custom", "custom"],
	])("treats a generated record with %s type as compact before load reconciliation retires it", (label, recordType, expectedActualType) => {
		const saved = makeState().toJson();
		const malformed = makeRawCannon({id: `malformed-${label}`});
		if (recordType === undefined) delete malformed.type;
		else malformed.type = recordType;
		saved.companions.push(malformed);

		const {restored, beforeReconcile} = loadWithPreReconciliationCompanionSnapshot({
			saved,
			recordId: malformed.id,
		});

		expect(beforeReconcile.rawType).toBe(recordType);
		expectHiddenFromGenericCompanionSurfaces(beforeReconcile);
		expect(restored.getLastClassSummonReconciliationResults()).toEqual([
			expect.objectContaining({
				instanceId: malformed.id,
				action: "retired",
				reason: "invalidState",
				details: {
					typeInvalid: true,
					expectedType: "class_summon",
					actualType: expectedActualType,
				},
			}),
		]);
		expect(restored.toJson().companions).toEqual([]);
		expect(restored.getCompanions()).toEqual([]);
	});

	test.each([
		["null", null, {metadataMissing: true}],
		["false", false, {metadataInvalid: true}],
		["zero", 0, {metadataInvalid: true}],
		["empty string", "", {metadataInvalid: true}],
		["array", [], {metadataInvalid: true}],
		["empty object", {}, {metadataInvalid: true}],
	])("isolates a reserved %s envelope before load reconciliation retires it", (label, envelope, expectedDetails) => {
		const saved = makeState().toJson();
		const malformed = makeRawCannon({
			id: `malformed-envelope-${label.replaceAll(" ", "-")}`,
			overrides: {generatedClassSummon: envelope},
		});
		saved.companions.push(malformed);

		const {restored, beforeReconcile} = loadWithPreReconciliationCompanionSnapshot({
			saved,
			recordId: malformed.id,
		});

		expect(beforeReconcile.rawGeneratedClassSummon).toEqual(envelope);
		expectHiddenFromGenericCompanionSurfaces(beforeReconcile);
		expect(restored.getLastClassSummonReconciliationResults()).toEqual([
			expect.objectContaining({
				instanceId: malformed.id,
				action: "retired",
				reason: "invalidState",
				details: expectedDetails,
			}),
		]);
		expect(restored.toJson().companions).toEqual([]);
		expect(restored.getCompanions()).toEqual([]);
	});

	test("retires missing owners and stale slot 1 below level 15 while preserving slot 0", () => {
		const noOwner = new CharacterSheetState();
		noOwner.setClassSummonTemplateCatalog(objectData);
		noOwner._data.companions.push(makeRawCannon());
		expect(noOwner.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "ownerRemoved"}),
		]);

		const level14 = makeState({level: 14});
		level14._data.companions.push(
			makeRawCannon({id: "slot-0", slot: 0, overrides: {currentHp: 60}}),
			makeRawCannon({id: "slot-1", slot: 1, overrides: {currentHp: 60}}),
		);
		const results = level14.reconcileClassSummons();
		expect(level14.listEfaEldritchCannons().map(it => it.instanceId)).toEqual(["slot-0"]);
		expect(results).toEqual(expect.arrayContaining([
			expect.objectContaining({instanceId: "slot-1", action: "retired", reason: "levelReduced"}),
		]));

		const level2 = makeState({level: 3});
		level2._data.classes[0].level = 2;
		level2._data.companions.push(makeRawCannon({overrides: {currentHp: 10}}));
		expect(level2.reconcileClassSummons()).toEqual([
			expect.objectContaining({action: "retired", reason: "levelReduced"}),
		]);
	});

	test("accepts reserved slot 1 metadata at level 15 without exposing a creation path", () => {
		const state = makeState({level: 15});
		state._data.companions.push(
			makeRawCannon({id: "slot-0", slot: 0, revision: 1, overrides: {currentHp: 70}}),
			makeRawCannon({id: "slot-1", slot: 1, revision: 1, overrides: {currentHp: 70}}),
		);

		expect(state.reconcileClassSummons()).toEqual(expect.arrayContaining([
			expect.objectContaining({instanceId: "slot-0", action: "kept"}),
			expect.objectContaining({instanceId: "slot-1", action: "kept"}),
		]));
		expect(state.listEfaEldritchCannons()).toHaveLength(2);
		expect(createCannon(state)).toMatchObject({ok: false, reason: "slotOccupied"});
	});

	test("loads old saves with no generated runtime fields without inventing a cannon", () => {
		const state = makeState();
		const legacy = state.toJson();
		delete legacy.generatedClassSummonRevisions;
		legacy.companions = [];

		const restored = new CharacterSheetState();
		restored.setClassSummonTemplateCatalog(objectData);
		restored.loadFromJson(legacy);

		expect(restored.listEfaEldritchCannons()).toEqual([]);
		expect(restored.toJson().generatedClassSummonRevisions).toEqual({});
	});

	test("rejects the reserved detonation reason in Milestone 2", () => {
		const state = makeState();
		const {instanceId} = createCannon(state);

		expect(state.retireClassSummon(instanceId, "detonated")).toMatchObject({
			ok: false,
			reason: "invalidState",
		});
		expect(state.getClassSummon(instanceId)).not.toBeNull();
	});
});

describe("EFA cannon integration boundaries", () => {
	test("isolates compact summons from generic companion render and mutation paths", () => {
		const state = makeState();
		const {instanceId} = createCannon(state);
		const familiarId = state.addCompanion({
			name: "Owl",
			type: CharacterSheetState.COMPANION_TYPES.FAMILIAR,
			hp: {max: 12, current: 12},
			abilities: {dex: 14},
		});
		const dancingItemId = state.addCompanion({
			name: "Dancing Item",
			source: "TCE",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			hp: {max: 20, current: 20},
			abilities: {dex: 18},
		});

		expect(state.getCompanions().map(it => it.id)).toEqual([familiarId, dancingItemId]);
		expect(state.getActiveCompanions().map(it => it.id)).toEqual([familiarId, dancingItemId]);
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON).map(it => it.id)).toEqual([dancingItemId]);
		expect(state.getCompanion(instanceId)).toBeNull();
		expect(state.getCompanionConditions(instanceId)).toEqual([]);
		expect(state.getCompanionInitiative(instanceId)).toBe(0);
		expect(state.damageCompanion(instanceId, 5)).toEqual({
			remaining: 0,
			tempAbsorbed: 0,
			hpLost: 0,
			droppedToZero: false,
		});
		expect(state.healCompanion(instanceId, 5)).toBe(0);
		expect(state.updateCompanion(instanceId, {name: "Leaked"})).toBe(false);
		expect(state.updateCompanionNote(instanceId, "Leaked")).toBe(false);
		expect(state.removeCompanion(instanceId)).toBe(false);
		expect(state.getClassSummon(instanceId)).toMatchObject({instanceId, currentHp: 15});

		expect(state.getCompanionInitiative(familiarId)).toBe(2);
		state.addCompanionCondition(familiarId, "Prone");
		expect(state.getCompanionConditions(familiarId)).toEqual(["Prone"]);
		expect(state.damageCompanion(familiarId, 5)).toMatchObject({hpLost: 5, droppedToZero: false});
		expect(state.getCompanion(familiarId).hp.current).toBe(7);

		expect(state.removeCompanionsByType(CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON)).toBe(1);
		expect(state.getCompanion(dancingItemId)).toBeNull();
		expect(state.getClassSummon(instanceId)).not.toBeNull();
		expect(state.toJson().companions.map(it => it.id)).toEqual([instanceId, familiarId]);
	});

	test("keeps compact summons out of the normal CharacterSheet companion renderer", () => {
		const state = makeState();
		const {instanceId} = createCannon(state);
		const previousDocument = globalThis.document;
		const list = makeCompanionListStub();
		globalThis.document = {
			getElementById: id => id === "charsheet-companions-list" ? list : null,
		};
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._ensureBeastheartCompanionBonded = jest.fn();
		page._renderCompanionButtons = jest.fn();
		page._renderCompanionsOverviewIndicator = jest.fn();

		try {
			expect(() => page._renderCompanions()).not.toThrow();
			expect(list.innerHTML).toContain("No active companions");
			expect(list.innerHTML).not.toContain("Eldritch Cannon");
			expect(state.getClassSummon(instanceId)).not.toBeNull();
		} finally {
			globalThis.document = previousDocument;
		}
	});

	test("leaves TCE Artillerists and non-generated class summons on legacy companion paths", () => {
		const state = makeState({source: "TCE", level: 3});
		const dancingItemId = state.addCompanion({
			name: "Dancing Item",
			source: "TCE",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			hp: {max: 25, current: 25},
			abilities: {dex: 16},
		});
		const before = state.toJson();

		expect(state.reconcileClassSummons()).toEqual([]);
		expect(state.advanceClassSummonGameTime(10)).toEqual([]);
		expect(state.createEfaEldritchCannon({
			form: "forceBallista",
			size: "S",
			placement: "deployed",
			mobility: "wheels",
			distanceFromOwnerFt: 5,
			createdWith: "freeUse",
		})).toMatchObject({ok: false, reason: "sourceMismatch"});
		expect(state.setClassSummonCurrentHp(dancingItemId, 1)).toMatchObject({ok: false, reason: "notFound"});
		expect(state.retireClassSummon(dancingItemId, "dismissed")).toMatchObject({ok: false, reason: "notFound"});
		expect(state.toJson()).toEqual(before);

		expect(state.getCompanions().map(it => it.id)).toEqual([dancingItemId]);
		expect(state.getCompanionInitiative(dancingItemId)).toBe(3);
		expect(state.damageCompanion(dancingItemId, 5)).toMatchObject({hpLost: 5, droppedToZero: false});
		expect(state.getCompanion(dancingItemId).hp.current).toBe(20);
	});

	test("keeps Respec source changes candidate-isolated and restores the cannon on undo", async () => {
		const state = makeState({level: 3});
		const {instanceId} = createCannon(state);
		for (let level = 1; level <= 3; level++) {
			state.recordLevelChoice({
				level,
				class: {name: "Artificer", source: "EFA"},
				classLevel: level,
				choices: level === 3 ? {subclass: makeClassEntry({source: "EFA"}).subclass} : {},
			});
		}

		const page = {
			getClasses: () => [
				{...makeClassEntry({source: "EFA"}), classFeatures: []},
				{...makeClassEntry({source: "TCE"}), classFeatures: []},
			],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			saveCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
		};
		const engine = new CharacterSheetRespecEngine({page, state});
		engine.begin();
		expect(engine.state.getClassSummon(instanceId)).not.toBeNull();

		engine.state.removeClass("Artificer", "EFA");
		engine.state.addClass(makeClassEntry({source: "TCE", level: 3}));
		for (const entry of engine.state.getLevelHistory()) {
			entry.class = {name: "Artificer", source: "TCE"};
			if (entry.choices?.subclass) entry.choices.subclass = makeClassEntry({source: "TCE"}).subclass;
		}
		engine.markDirty();

		expect(engine.state.listEfaEldritchCannons()).toEqual([]);
		expect(state.getClassSummon(instanceId)).not.toBeNull();

		await engine.apply();
		expect(state.listEfaEldritchCannons()).toEqual([]);

		await engine.undo();
		expect(state.getClassSummon(instanceId)).toMatchObject({
			instanceId,
			instanceRevision: 1,
		});
	});

	test("does not create or mutate inventory rows", () => {
		const state = makeState();
		state.addItem({name: "Woodcarver's Tools", source: "XPHB", type: "AT"});
		const before = state.getItems().map(item => ({id: item.id, name: item.name, quantity: item.quantity}));

		const created = createCannon(state);
		state.setClassSummonCurrentHp(created.instanceId, 4);
		state.dismissClassSummon(created.instanceId);

		expect(state.getItems().map(item => ({id: item.id, name: item.name, quantity: item.quantity}))).toEqual(before);
	});
});
