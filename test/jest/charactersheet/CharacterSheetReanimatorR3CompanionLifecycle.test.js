import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
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

const FEATURE_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const LEGACY_FEATURE_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3";
const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const COMPANION_UID = "Reanimated Companion|RHW";

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
	level = 3,
	classSource = "EFA",
	subclassSource = "RHW",
	intelligence = 16,
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
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
	state.setSpellSlots(1, 4, 4);
	state.setSpellSlots(2, 3, 3);
	return state;
}

function addTool (state, {
	id = "reanimator-tool",
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

function getCreationResource (state) {
	return state._data.resources.find(resource =>
		resource.featureUid === FEATURE_UID
		&& resource.classUid === CLASS_UID
		&& resource.subclassUid === SUBCLASS_UID
		&& resource.featureCompanionCreation?.version === 1);
}

function getFocusReference (state, id = "reanimator-tool") {
	const row = state.getInventory().find(candidate => candidate.id === id);
	return state.getSpellCastFocusReference(row);
}

function getCreateInput (state, overrides = {}) {
	return {
		featureUid: FEATURE_UID,
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		focusReference: getFocusReference(state),
		payment: {type: "freeCreation"},
		appearance: "A brass-and-bone hound",
		...overrides,
	};
}

function getAtomicR3State (state) {
	return {
		actionEconomyUsage: copy(state._data.actionEconomyUsage),
		spellSlots: copy(state.getSpellSlots()),
		pactSlots: copy(state.getPactSlots()),
		resource: copy(getCreationResource(state) || null),
		companions: copy(state.getCompanions()),
		inventory: copy(state.getInventory()),
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
		getSpells: () => [],
		getFilteredSpellData: () => [],
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
		if (!selection) throw new Error("No legal unique Artificer plan remained for the Reanimator Respec fixture.");
		used.add(CharacterSheetArtificerPlans.getSelectionIdentity(selection));
		engine.stageGraphMutation(decision.id, selection);
	}
	for (const decision of engine.manifest.decisions) decision.status = "resolved";
	expect(engine.getValidation().errors).toEqual([]);
}

async function createCompanion (state, overrides = {}) {
	if (!state.getInventory().some(row => row.id === "reanimator-tool")) addTool(state);
	return state.pCreateFeatureCompanion(getCreateInput(state, overrides));
}

describe("RHW Reanimator R3 creation transaction", () => {
	it("creates one exact-owned base companion with a stable tool/payment receipt and one Magic action", async () => {
		const state = makeState({level: 15, intelligence: 18});
		addTool(state);
		state.startCombat();
		const beforeSlots = state.getSpellSlotsCurrent(1);

		const boundary = state.getFeatureCompanionCreationBoundary(FEATURE_UID, {
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			payment: {type: "freeCreation"},
		});
		expect(boundary).toMatchObject({
			available: true,
			executable: true,
			reason: null,
			ownerUid: FEATURE_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			companionUid: COMPANION_UID,
			actionType: "magicAction",
			selectedPayment: {type: "freeCreation", current: 1},
			focus: {status: "ready"},
		});

		const result = await state.pCreateFeatureCompanion(getCreateInput(state));

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			featureUid: FEATURE_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			creationReceipt: {
				owner: {
					featureUid: FEATURE_UID,
					classUid: CLASS_UID,
					subclassUid: SUBCLASS_UID,
					companionUid: COMPANION_UID,
				},
				action: {
					type: "magicAction",
					economyType: "action",
					trackedInCombat: true,
					committed: true,
				},
				payment: {type: "freeCreation", before: 1, after: 0},
				tool: {
					inventoryItemId: "reanimator-tool",
					itemUid: "Tinker's Tools|XPHB",
				},
			},
		});
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getSpellSlotsCurrent(1)).toBe(beforeSlots);
		expect(getCreationResource(state)).toMatchObject({current: 0, max: 1, recharge: "long"});

		const companions = state.getFeatureOwnedCompanions(FEATURE_UID);
		expect(companions).toHaveLength(1);
		expect(companions[0]).toMatchObject({
			id: result.companionId,
			name: "Reanimated Companion",
			source: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			active: true,
			featureGrant: {
				uid: FEATURE_UID,
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Reanimator",
				subclassSource: "RHW",
				level: 3,
			},
			setup: {appearance: "A brass-and-bone hound"},
			hp: {max: 80, current: 80, temp: 0},
			ac: 14,
			hitDice: {die: "d8", current: 15, max: 15},
			lifecycle: {
				status: "active",
				generation: 1,
				deathBurstEmitted: false,
			},
			scaling: {
				kind: "featureCompanion",
				featureUid: FEATURE_UID,
				registryFeatureUid: LEGACY_FEATURE_UID,
				deferSetupChoices: true,
				resolved: {
					identity: {
						classUid: CLASS_UID,
						subclassUid: SUBCLASS_UID,
						companionUid: COMPANION_UID,
					},
					actions: {
						dreadfulSwipe: {
							attackBonus: 9,
							damage: {dice: "1d4", flat: 4, type: "necrotic", ignoresResistance: false},
						},
					},
					traits: {
						deathBurst: {
							damage: {dice: "2d4", flat: 0, type: "necrotic", ignoresResistance: false},
						},
					},
					modifications: {deferred: true, requiredCount: 3, selected: [], effects: {}},
				},
			},
		});
	});

	it("spends one selected level-1+ spell slot when the free creation is unavailable", async () => {
		const state = makeState();
		addTool(state);
		const first = await state.pCreateFeatureCompanion(getCreateInput(state));
		state.killFeatureOwnedCompanion(first.companionId, {featureUid: FEATURE_UID});
		const beforeSlots = state.getSpellSlotsCurrent(2);
		const beforeResource = getCreationResource(state).current;

		const second = await state.pCreateFeatureCompanion(getCreateInput(state, {
			payment: {type: "spellSlot", pool: "spell", slotLevel: 2},
			appearance: "A second body",
		}));

		expect(second).toMatchObject({
			ok: true,
			committed: true,
			creationReceipt: {
				payment: {
					type: "spellSlot",
					pool: "spell",
					slotLevel: 2,
					before: beforeSlots,
					after: beforeSlots - 1,
				},
			},
		});
		expect(state.getSpellSlotsCurrent(2)).toBe(beforeSlots - 1);
		expect(getCreationResource(state).current).toBe(beforeResource);
		expect(state.getFeatureOwnedCompanions(FEATURE_UID)).toHaveLength(1);
		expect(state.getFeatureOwnedCompanions(FEATURE_UID)[0].id).toBe(second.companionId);
	});

	it("accepts another equipped, proficient XPHB Artisan's Tool through the shared focus resolver", async () => {
		const state = makeState();
		addTool(state, {
			id: "smith-tools",
			name: "Smith's Tools",
		});

		const result = await state.pCreateFeatureCompanion(getCreateInput(state, {
			focusReference: getFocusReference(state, "smith-tools"),
		}));

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			creationReceipt: {
				tool: {
					inventoryItemId: "smith-tools",
					itemUid: "Smith's Tools|XPHB",
				},
			},
		});
	});

	it("does not replace an active companion or spend another action/payment", async () => {
		const state = makeState();
		addTool(state);
		const first = await state.pCreateFeatureCompanion(getCreateInput(state));
		state.resetTurnEconomy();
		const before = JSON.stringify(getAtomicR3State(state));

		const second = await state.pCreateFeatureCompanion(getCreateInput(state, {
			payment: {type: "spellSlot", slotLevel: 1},
		}));

		expect(second).toMatchObject({ok: false, committed: false, reason: "activeCompanion"});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
		expect(state.getCompanion(first.companionId)).not.toBeNull();
	});

	it.each([
		["cancelled", input => ({...input, cancelled: true}), "cancelled"],
		["legacy six-part owner", input => ({...input, featureUid: LEGACY_FEATURE_UID}), "invalidFeature"],
		["wrong class source", input => ({...input, classUid: "Artificer|TCE"}), "invalidClass"],
		["wrong subclass source", input => ({...input, subclassUid: "Reanimator|Artificer|EFA|TST"}), "invalidSubclass"],
		["unavailable slot", input => ({...input, payment: {type: "spellSlot", slotLevel: 9}}), "unavailablePayment"],
	])("rejects %s without changing state", async (_label, mutate, reason) => {
		const state = makeState();
		addTool(state);
		const input = mutate(getCreateInput(state));
		const before = JSON.stringify(getAtomicR3State(state));

		await expect(state.pCreateFeatureCompanion(input)).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason,
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
	});

	it.each([
		["an unequipped", {equipped: false, proficient: true}],
		["an unproficient", {equipped: true, proficient: false}],
		["a wrong-source", {source: "PHB", type: "AT|PHB", equipped: true, proficient: true}],
	])("rejects %s Artisan's Tool without changing state", async (_label, tool) => {
		const state = makeState();
		addTool(state, tool);
		const before = JSON.stringify(getAtomicR3State(state));

		await expect(state.pCreateFeatureCompanion(getCreateInput(state))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "toolUnavailable",
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
	});

	it.each([
		["TCE Artificer", {classSource: "TCE"}],
		["wrong-source subclass", {subclassSource: "TST"}],
	])("never activates creation for %s", async (_label, stateOptions) => {
		const state = makeState(stateOptions);
		addTool(state);
		const before = JSON.stringify(getAtomicR3State(state));

		await expect(state.pCreateFeatureCompanion(getCreateInput(state))).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "ownerNotFound",
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
	});

	it("rejects a stale or no-longer-eligible tool immediately before commit", async () => {
		const state = makeState();
		addTool(state);
		const input = getCreateInput(state);
		const boundary = state.getFeatureCompanionCreationBoundary(FEATURE_UID, {
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			payment: input.payment,
		});
		expect(boundary.executable).toBe(true);
		state.removeItem("reanimator-tool");
		const before = JSON.stringify(getAtomicR3State(state));

		await expect(state.pCreateFeatureCompanion(input)).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "toolUnavailable",
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
	});

	it("revalidates the live tool after payment and rolls back if it becomes stale", async () => {
		const state = makeState();
		addTool(state);
		state.startCombat();
		const before = JSON.stringify(getAtomicR3State(state));
		const useSpellSlot = jest.spyOn(state, "useSpellSlot")
			.mockImplementationOnce(slotLevel => {
				useSpellSlot.mockRestore();
				const committed = state.useSpellSlot(slotLevel);
				state.removeItem("reanimator-tool");
				return committed;
			});

		const result = await state.pCreateFeatureCompanion(getCreateInput(state, {
			payment: {type: "spellSlot", slotLevel: 1},
		}));

		expect(result).toMatchObject({
			ok: false,
			committed: false,
			reason: "coreCommitFailed",
			error: "Creation tool became invalid before the companion commit.",
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
	});

	it("rolls action, payment, and partial companion state back when the core commit fails", async () => {
		const state = makeState();
		addTool(state);
		state.startCombat();
		const before = JSON.stringify(getAtomicR3State(state));
		const reconcile = jest.spyOn(state, "reconcileFeatureOwnedCompanion")
			.mockImplementationOnce(() => {
				throw new Error("injected reconcile failure");
			});

		const result = await state.pCreateFeatureCompanion(getCreateInput(state, {
			payment: {type: "spellSlot", slotLevel: 1},
		}));

		expect(result).toMatchObject({
			ok: false,
			committed: false,
			reason: "coreCommitFailed",
			error: "injected reconcile failure",
		});
		expect(JSON.stringify(getAtomicR3State(state))).toBe(before);
		reconcile.mockRestore();
	});
});

describe("RHW Reanimator R3 lifecycle and rests", () => {
	it("marks ordinary death at 0 HP and emits Death Burst exactly once", async () => {
		const state = makeState();
		const created = await createCompanion(state);

		const first = state.killFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID});
		expect(first).toMatchObject({
			ok: true,
			committed: true,
			removed: false,
			companion: {
				hp: {current: 0, temp: 0},
				active: false,
				lifecycle: {
					status: "dead",
					deathCause: "companionDeath",
					deathBurstEmitted: true,
				},
			},
			deathBurst: {
				save: {ability: "dex", onSuccess: "halfDamage"},
				damage: {dice: "2d4", type: "necrotic"},
			},
		});
		expect(state.getCompanion(created.companionId)).toMatchObject({
			hp: {current: 0},
			active: false,
			lifecycle: {deathBurstEmitted: true},
		});

		expect(state.killFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID}))
			.toMatchObject({ok: true, committed: false, reason: "alreadyDead", deathBurst: null});

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(loaded.killFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID}))
			.toMatchObject({ok: true, committed: false, reason: "alreadyDead", deathBurst: null});
	});

	it("dismisses early with one Magic action, removes the companion, and never bursts", async () => {
		const state = makeState();
		const created = await createCompanion(state);
		state.startCombat();

		const dismissed = await state.pDismissFeatureOwnedCompanion({
			featureUid: FEATURE_UID,
			companionId: created.companionId,
		});

		expect(dismissed).toMatchObject({
			ok: true,
			committed: true,
			deathBurst: null,
			receipt: {
				cause: "earlyDismissal",
				action: {type: "magicAction", trackedInCombat: true, committed: true},
				deathBurst: null,
			},
		});
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getCompanion(created.companionId)).toBeNull();
	});

	it("kills and removes the active companion on summoner death with one Death Burst", async () => {
		const state = makeState();
		const created = await createCompanion(state);

		const first = state.handleFeatureCompanionSummonerDeath(FEATURE_UID);
		expect(first).toMatchObject({
			ok: true,
			committed: true,
			deathBursts: [{damage: {dice: "2d4", type: "necrotic"}}],
			results: [{
				companionId: created.companionId,
				removed: true,
				companion: {hp: {current: 0}, lifecycle: {deathCause: "summonerDeath"}},
			}],
		});
		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(state.handleFeatureCompanionSummonerDeath(FEATURE_UID))
			.toMatchObject({ok: true, committed: false, reason: "noActiveCompanion"});
	});

	it("preserves companion/payment on a Short Rest and expires it while restoring free creation on a Long Rest", async () => {
		const state = makeState();
		const created = await createCompanion(state);
		const beforeShortRest = JSON.stringify({
			companion: state.getCompanion(created.companionId),
			resource: getCreationResource(state),
		});

		state.onShortRest();
		expect(JSON.stringify({
			companion: state.getCompanion(created.companionId),
			resource: getCreationResource(state),
		})).toBe(beforeShortRest);

		state.onLongRest();
		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(getCreationResource(state)).toMatchObject({current: 1, max: 1});
	});

	it("wires the Rest controller resource path to the same lifecycle boundary", async () => {
		const state = makeState();
		const created = await createCompanion(state);
		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;

		rest._restoreResources("short");
		expect(state.getCompanion(created.companionId)).not.toBeNull();
		expect(getCreationResource(state).current).toBe(0);

		rest._restoreResources("long");
		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(getCreationResource(state).current).toBe(1);
	});
});

describe("RHW Reanimator R3 persistence, level sync, and source isolation", () => {
	it("round-trips the active instance, exact receipts, base rules snapshot, and spent free creation idempotently", async () => {
		const state = makeState({level: 15, intelligence: 18});
		const created = await createCompanion(state);
		state.getCompanion(created.companionId).hp.current = 17;
		state.getCompanion(created.companionId).hitDice.current = 4;
		const expected = copy(getAtomicR3State(state));

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(getAtomicR3State(loaded)).toEqual(expected);

		const once = copy(getAtomicR3State(loaded));
		loaded.applyClassFeatureEffects();
		loaded._migrateCompanions();
		expect(getAtomicR3State(loaded)).toEqual(once);
	});

	it.each([
		["free creation", {type: "freeCreation"}, 0],
		["spell slot", {type: "spellSlot", slotLevel: 1}, 1],
	])("conservatively rebuilds a missing creation resource after %s payment", async (_label, payment, expectedCurrent) => {
		const state = makeState();
		const created = await createCompanion(state, {payment});
		state.killFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID});
		state._data.resources = state._data.resources.filter(resource =>
			resource.id !== getCreationResource(state).id);

		state.applyClassFeatureEffects();

		expect(getCreationResource(state)).toMatchObject({current: expectedCurrent, max: 1});
		expect(state.getCompanion(created.companionId)).toMatchObject({
			hp: {current: 0},
			lifecycle: {status: "dead", deathBurstEmitted: true},
		});
	});

	it("updates derived maxima across deferred-modification levels without healing or corrupting payment", async () => {
		const state = makeState({level: 15, intelligence: 18});
		const created = await createCompanion(state);
		const companion = state.getCompanion(created.companionId);
		companion.hp.current = 7;
		companion.hitDice.current = 2;

		state.getClasses()[0].level = 16;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(created.companionId)).toMatchObject({
			hp: {max: 85, current: 7},
			hitDice: {die: "d8", current: 2, max: 16},
			scaling: {
				deferSetupChoices: true,
				resolved: {
					actions: {dreadfulSwipe: {damage: {dice: "1d4", flat: 4}}},
					traits: {deathBurst: {damage: {dice: "2d4", flat: 0}}},
					modifications: {deferred: true, requiredCount: 3, selected: []},
				},
			},
		});
		expect(getCreationResource(state).current).toBe(0);

		state.getClasses()[0].level = 3;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(created.companionId)).toMatchObject({
			hp: {max: 20, current: 7},
			hitDice: {die: "d8", current: 2, max: 3},
		});
		expect(getCreationResource(state).current).toBe(0);
	});

	it("removes only exact RHW companion/resource state and never adopts or deletes collisions or stale generated provenance", async () => {
		const state = makeState();
		const created = await createCompanion(state);
		const playerCompanionId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
			hp: {max: 9, current: 9},
		});
		const foreignCompanionId = state.addCompanion({
			name: "Reanimated Companion",
			source: "TST",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			featureGrant: {uid: "Reanimated Companion|Artificer|EFA|Reanimator|TST|3|TST"},
			hp: {max: 11, current: 11},
		});
		const conflictingOwnerId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			creatureName: "Reanimated Companion",
			creatureSource: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			featureGrant: {
				type: "subclassFeature",
				uid: FEATURE_UID,
				className: "Artificer",
				classSource: "TCE",
				subclassShortName: "Reanimator",
				subclassSource: "RHW",
				level: 3,
			},
			hp: {max: 13, current: 13},
		});
		const conflictingResource = {
			id: "foreign-reanimator-creation",
			name: "Foreign Reanimated Companion Creation",
			current: 1,
			max: 1,
			recharge: "long",
			featureUid: FEATURE_UID,
			classUid: "Artificer|TCE",
			subclassUid: "Reanimator|Artificer|TCE|RHW",
			source: "RHW",
			featureCompanionCreation: {version: 1, featureUid: FEATURE_UID},
			customExtension: {kept: true},
		};
		state._data.resources.push(copy(conflictingResource));
		const generated = state.createGeneratedFeatureItem({
			item: {name: "Reanimated Companion Token", source: "RHW", type: "G"},
			owner: {
				featureUid: FEATURE_UID,
				classUid: CLASS_UID,
				subclassUid: SUBCLASS_UID,
				featureSource: "RHW",
			},
		});
		const generatedWrapper = state.getInventory().find(row => row.id === generated.itemId);
		generatedWrapper.item._generatedItemProvenance.owner.featureUid = LEGACY_FEATURE_UID;
		delete generatedWrapper.item._generatedItemProvenance.owner.featureSource;
		expect(state.classifyGeneratedFeatureItem(generatedWrapper)).toMatchObject({
			status: "stale",
			reason: "legacy-subclass-feature-uid",
		});
		state.applyClassFeatureEffects();
		expect(state._data.resources.find(resource => resource.id === conflictingResource.id))
			.toEqual(conflictingResource);

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();

		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(getCreationResource(state)).toBeUndefined();
		expect(state.getCompanion(playerCompanionId)).toMatchObject({name: "Reanimated Companion"});
		expect(state.getCompanion(playerCompanionId).featureGrant).toBeUndefined();
		expect(state.getCompanion(foreignCompanionId)).toMatchObject({
			featureGrant: {uid: "Reanimated Companion|Artificer|EFA|Reanimator|TST|3|TST"},
		});
		expect(state.getCompanion(conflictingOwnerId)).toMatchObject({
			featureGrant: {uid: FEATURE_UID, classSource: "TCE"},
			hp: {max: 13, current: 13},
		});
		expect(state._data.resources.find(resource => resource.id === conflictingResource.id))
			.toEqual(conflictingResource);
		expect(state.getInventory().some(row => row.id === generated.itemId)).toBe(true);
		expect(state.classifyGeneratedFeatureItem(
			state.getInventory().find(row => row.id === generated.itemId),
		)).toMatchObject({status: "stale", reason: "legacy-subclass-feature-uid"});
	});

	it("leaves a name-only legacy companion unowned across load and reconciliation", () => {
		const state = makeState();
		const legacyId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			hp: {max: 20, current: 5},
		});
		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);

		expect(loaded.getCompanion(legacyId)).toMatchObject({
			name: "Reanimated Companion",
			hp: {max: 20, current: 5},
		});
		expect(loaded.getCompanion(legacyId).featureGrant).toBeUndefined();
		expect(loaded.getFeatureOwnedCompanions(FEATURE_UID)).toEqual([]);
	});
});

describe("RHW Reanimator R3 Respec transactions", () => {
	it("Apply removes exact RHW state and Undo restores the serialized pre-Apply state", async () => {
		const liveState = makeState();
		await createCompanion(liveState);
		expect(liveState.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const before = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].subclass = null;
		engine.state.applyClassFeatureEffects();
		expect(engine.state.getFeatureOwnedCompanions(FEATURE_UID)).toEqual([]);
		expect(getCreationResource(engine.state)).toBeUndefined();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).resolves.toBe(true);
		expect(liveState.getFeatureOwnedCompanions(FEATURE_UID)).toEqual([]);
		expect(getCreationResource(liveState)).toBeUndefined();

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(liveState.toJson())).toBe(before);
	});

	it("restores companion, payment, and stable tool receipt byte-for-byte after an injected failed Apply", async () => {
		const liveState = makeState();
		await createCompanion(liveState);
		expect(liveState.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const before = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].level = 4;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(JSON.stringify(liveState.toJson())).toBe(before);
		expect(liveState.getFeatureOwnedCompanions(FEATURE_UID)).toHaveLength(1);
		expect(liveState.getFeatureOwnedCompanions(FEATURE_UID)[0].lifecycle.creationReceipt.tool)
			.toEqual({
				inventoryItemId: "reanimator-tool",
				itemUid: "Tinker's Tools|XPHB",
				name: "Tinker's Tools",
				source: "XPHB",
			});
		expect(getCreationResource(liveState)).toMatchObject({current: 0, max: 1});
	});
});
