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
	intelligence = 16,
	classSource = "EFA",
	subclassSource = "RHW",
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

function addTool (state) {
	state.addItem({
		id: "reanimator-tool",
		name: "Tinker's Tools",
		source: "XPHB",
		type: "AT|XPHB",
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped("reanimator-tool", true);
	state.addToolProficiency("Tinker's Tools");
}

function getCreationResource (state) {
	return state._data.resources.find(resource =>
		resource.featureUid === FEATURE_UID
		&& resource.classUid === CLASS_UID
		&& resource.subclassUid === SUBCLASS_UID
		&& resource.featureCompanionCreation?.version === 1);
}

function getFocusReference (state) {
	return state.getSpellCastFocusReference(
		state.getInventory().find(row => row.id === "reanimator-tool"),
	);
}

function getSetupChoiceInput (state, selectedOptionIds, {transactionId = null} = {}) {
	const boundary = state.getFeatureCompanionCreationBoundary(FEATURE_UID, {
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		payment: {type: "freeCreation"},
	});
	const transaction = boundary.setupChoices.transaction;
	return {
		transaction,
		input: {
			transactionId: transactionId || transaction.transactionId,
			selectedOptions: selectedOptionIds.map(id =>
				copy(transaction.options.find(option => option.id === id))),
		},
	};
}

function getCreateInput (state, selectedOptionIds, overrides = {}) {
	const {input} = getSetupChoiceInput(state, selectedOptionIds);
	return {
		featureUid: FEATURE_UID,
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		focusReference: getFocusReference(state),
		payment: {type: "freeCreation"},
		setupChoices: input,
		appearance: "A stitched brass hound",
		...overrides,
	};
}

async function createCompanion (state, selectedOptionIds, overrides = {}) {
	if (!state.getInventory().some(row => row.id === "reanimator-tool")) addTool(state);
	return state.pCreateFeatureCompanion(getCreateInput(state, selectedOptionIds, overrides));
}

function getAtomicState (state) {
	return {
		actionEconomyUsage: copy(state._data.actionEconomyUsage),
		turnReceipts: copy(state._data.turnReceipts),
		spellSlots: copy(state.getSpellSlots()),
		pactSlots: copy(state.getPactSlots()),
		resource: copy(getCreationResource(state) || null),
		companions: copy(state.getCompanions()),
		inventory: copy(state.getInventory()),
	};
}

function getCombinations (values, count) {
	if (!count) return [[]];
	if (values.length < count) return [];
	const [head, ...tail] = values;
	return [
		...getCombinations(tail, count - 1).map(combination => [head, ...combination]),
		...getCombinations(tail, count),
	];
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

describe("RHW Reanimator R4a creation choices", () => {
	it.each([
		{level: 3, selected: [], swipe: "1d4", size: "M", improved: false},
		{level: 5, selected: ["ferocity"], swipe: "1d6", size: "M", improved: false},
		{level: 9, selected: ["arcaneConduit", "bloated"], swipe: "1d4", size: "L", improved: true},
		{level: 15, selected: ["ferocity", "gaunt", "moist"], swipe: "1d6", size: "M", improved: true},
		{level: 20, selected: ["arcaneConduit", "bloated", "gaunt"], swipe: "1d4", size: "L", improved: true},
	])("persists the exact level $level generation and projects every current effect", async ({
		level,
		selected,
		swipe,
		size,
		improved,
	}) => {
		const state = makeState({level, intelligence: 18});
		const result = await createCompanion(state, selected);
		expect(result).toMatchObject({ok: true, committed: true});

		const companion = state.getCompanion(result.companionId);
		const choiceReceipt = companion.setup.choices.modifications;
		expect(choiceReceipt).toMatchObject({
			version: 1,
			ownerUid: FEATURE_UID,
			rulesVersion: 2,
			acquisitionLevel: level,
			requiredCount: selected.length,
			selectedOptionIds: selected,
		});
		expect(companion.lifecycle.creationReceipt.setupChoices.modifications).toEqual(choiceReceipt);
		expect(companion.scaling).toMatchObject({
			deferSetupChoices: false,
			resolved: {
				statistics: {size: [size]},
				actions: {
					dreadfulSwipe: {
						damage: {
							dice: swipe,
							ignoresResistance: improved,
						},
					},
				},
				traits: {
					deathBurst: {
						damage: {
							dice: improved ? "4d4" : "2d4",
							ignoresResistance: improved,
						},
					},
				},
				modifications: {
					deferred: false,
					rulesVersion: 2,
					acquisitionLevel: level,
					requiredCount: selected.length,
					selected,
				},
			},
		});
		const projection = state.getFeatureCalculations().reanimatedCompanion.activeCompanion;
		expect(projection).toMatchObject({
			companionId: companion.id,
			generation: 1,
			setupStatus: "complete",
			choiceReceipt,
			resolved: {
				modifications: {selected},
			},
		});
	});

	it.each([
		{level: 5, options: ["arcaneConduit", "ferocity"], count: 1},
		{level: 9, options: ["arcaneConduit", "ferocity", "bloated", "gaunt", "moist"], count: 2},
		{level: 15, options: ["arcaneConduit", "ferocity", "bloated", "gaunt", "moist"], count: 3},
	])("accepts every legal unique level $level creation combination", async ({level, options, count}) => {
		for (const combination of getCombinations(options, count)) {
			const state = makeState({level});
			const result = await createCompanion(state, combination);
			expect(result).toMatchObject({ok: true, committed: true});
			expect(state.getCompanion(result.companionId).setup.choices.modifications.selectedOptionIds)
				.toEqual(combination);
		}
	});

	it.each([
		["malformed zero-choice input", 3, () => [], "invalidChoice"],
		["missing choice", 9, setup => null, "missingChoice"],
		["missing transaction", 9, setup => ({selectedOptions: setup.input.selectedOptions}), "missingChoiceTransaction"],
		["duplicate choice", 9, setup => ({
			transactionId: setup.transaction.transactionId,
			selectedOptions: [setup.input.selectedOptions[0], setup.input.selectedOptions[0]],
		}), "duplicateChoice"],
		["wrong option name", 9, setup => ({
			...setup.input,
			selectedOptions: [{...setup.input.selectedOptions[0], name: "Arcane Channel"}, setup.input.selectedOptions[1]],
		}), "invalidChoiceName"],
		["wrong option source", 9, setup => ({
			...setup.input,
			selectedOptions: [{...setup.input.selectedOptions[0], source: "TST"}, setup.input.selectedOptions[1]],
		}), "invalidChoiceSource"],
		["unknown option ID", 9, setup => ({
			...setup.input,
			selectedOptions: [{id: "graveWax", name: "Grave Wax", source: "RHW"}, setup.input.selectedOptions[1]],
		}), "unknownChoice"],
		["too few choices", 9, setup => ({
			...setup.input,
			selectedOptions: setup.input.selectedOptions.slice(0, 1),
		}), "tooFewChoices"],
		["too many choices", 9, setup => ({
			...setup.input,
			selectedOptions: [
				...setup.input.selectedOptions,
				copy(setup.transaction.options.find(option => option.id === "bloated")),
			],
		}), "tooManyChoices"],
		["unavailable level choice", 5, setup => ({
			transactionId: setup.transaction.transactionId,
			selectedOptions: [{id: "bloated", name: "Bloated", source: "RHW"}],
		}), "unavailableChoice"],
	])("rejects %s before action, payment, tool receipt, or companion mutation", async (
		_label,
		level,
		mutateSetup,
		reason,
	) => {
		const state = makeState({level});
		addTool(state);
		state.startCombat();
		const selected = level === 3
			? []
			: level === 5
				? ["arcaneConduit"]
				: ["arcaneConduit", "ferocity"];
		const setup = getSetupChoiceInput(state, selected);
		const before = JSON.stringify(getAtomicState(state));

		const result = await state.pCreateFeatureCompanion({
			...getCreateInput(state, selected),
			setupChoices: mutateSetup(setup),
		});

		expect(result).toMatchObject({ok: false, committed: false, reason});
		expect(JSON.stringify(getAtomicState(state))).toBe(before);
	});

	it("rejects cancellation, stale transactions, and resolver rejection with no spend", async () => {
		const cancelled = makeState({level: 9});
		addTool(cancelled);
		cancelled.startCombat();
		const cancelledBefore = JSON.stringify(getAtomicState(cancelled));
		await expect(cancelled.pCreateFeatureCompanion({
			...getCreateInput(cancelled, ["arcaneConduit", "ferocity"]),
			cancelled: true,
		})).resolves.toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(JSON.stringify(getAtomicState(cancelled))).toBe(cancelledBefore);

		const stale = makeState({level: 9});
		addTool(stale);
		stale.startCombat();
		const oldSetup = getSetupChoiceInput(stale, ["arcaneConduit", "ferocity"]).input;
		stale.getClasses()[0].level = 15;
		stale.applyClassFeatureEffects();
		const staleBefore = JSON.stringify(getAtomicState(stale));
		await expect(stale.pCreateFeatureCompanion({
			...getCreateInput(stale, ["arcaneConduit", "ferocity", "bloated"]),
			setupChoices: oldSetup,
		})).resolves.toMatchObject({ok: false, committed: false, reason: "staleChoiceTransaction"});
		expect(JSON.stringify(getAtomicState(stale))).toBe(staleBefore);

		const rejected = makeState({level: 9});
		addTool(rejected);
		rejected.startCombat();
		const input = getCreateInput(rejected, ["arcaneConduit", "ferocity"]);
		const rejectedBefore = JSON.stringify(getAtomicState(rejected));
		const resolver = jest.spyOn(rejected, "resolveFeatureCompanionRules")
			.mockImplementationOnce(() => {
				throw new Error("injected resolver rejection");
			});
		await expect(rejected.pCreateFeatureCompanion(input)).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "resolverRejected",
		});
		expect(JSON.stringify(getAtomicState(rejected))).toBe(rejectedBefore);
		resolver.mockRestore();
	});
});

describe("RHW Reanimator R4a derived companion state", () => {
	it("persists every option effect and Arcane Conduit receipt metadata without committing a turn use", async () => {
		const arcaneState = makeState({level: 5, intelligence: 18});
		const arcane = await createCompanion(arcaneState, ["arcaneConduit"]);
		const arcaneEffect = arcaneState.getCompanion(arcane.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit;
		const expectedKey = [
			"feature-companion-operation-v1",
			`owner:${FEATURE_UID}`,
			"source:Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW",
			`companion:${arcane.companionId}`,
			"generation:1",
			"action:arcane-conduit:damage-rider",
		].join("|");
		expect(arcaneEffect).toMatchObject({
			castingOrigin: {
				mayCastFromCompanionSpace: true,
				usesSummonerSenses: true,
			},
			damageRider: {
				requiresCompanionWithinFeet: 120,
				spellClassUid: CLASS_UID,
				spellSchools: ["evocation", "necromancy"],
				trigger: "spellDealsDamage",
				damageRollBonus: 4,
				turnReceipt: {
					ownerUid: FEATURE_UID,
					sourceUid: "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW",
					actionUid: "arcane-conduit:damage-rider",
					companionId: arcane.companionId,
					generation: 1,
					key: expectedKey,
					executionStatus: "executable",
					committed: false,
				},
			},
		});
		expect(arcaneState.queryTurnReceipt(expectedKey))
			.toMatchObject({ok: true, used: false, receipt: null});

		const ferocityState = makeState({level: 5, intelligence: 8});
		const ferocity = await createCompanion(ferocityState, ["ferocity"]);
		expect(ferocityState.getCompanion(ferocity.companionId).scaling.resolved.actions.dreadfulSwipe.damage)
			.toMatchObject({dice: "1d6", flat: -1});

		const macabreState = makeState({level: 15, intelligence: 18});
		const macabre = await createCompanion(macabreState, ["bloated", "gaunt", "moist"]);
		const resolved = macabreState.getCompanion(macabre.companionId).scaling.resolved;
		expect(resolved.statistics).toMatchObject({
			size: ["L"],
			speed: {walk: 45, climb: 45, swim: 45},
		});
		expect(resolved.actions.dreadfulSwipe.riders).toContainEqual(expect.objectContaining({
			id: "bloatedPush",
			effect: "push",
			distanceFeet: 10,
			maximumTargetSize: "L",
		}));
		expect(resolved.traits.deathBurst.damage).toMatchObject({
			dice: "4d4",
			flat: 4,
			ignoresResistance: true,
		});
		expect(resolved.modifications.effects.gaunt).toMatchObject({
			climbing: {
				difficultSurfaces: true,
				ceilings: true,
				requiresAbilityCheck: false,
			},
			fearAura: {
				area: {shape: "emanation", radiusFeet: 10},
				save: {ability: "wis", dc: 17},
				onFailure: {
					condition: "frightened",
					duration: "untilStartOfCreatureNextTurn",
				},
				executionStatus: "executableManualResolution",
			},
		});
		expect(resolved.modifications.effects.moist).toMatchObject({
			squeeze: {minimumSpaceInches: 1, extraMovement: false},
			acidRetaliation: {
				attackerMaximumRangeFeet: 10,
				damage: {flat: 4, type: "acid"},
				executionStatus: "executableManualResolution",
			},
		});
	});

	it("keeps the generation operation key stable, isolated, projected, and uncommitted", async () => {
		const state = makeState({level: 9, intelligence: 18});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt"]);
		const getKey = targetState => targetState.getCompanion(created.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt.key;
		const originalKey = getKey(state);
		const turnReceiptsBefore = JSON.stringify(state._data.turnReceipts);

		state.reconcileFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID});
		state.reconcileFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID});
		expect(getKey(state)).toBe(originalKey);
		expect(state.getFeatureCalculations().reanimatedCompanion.activeCompanion
			.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt.key)
			.toBe(originalKey);
		expect(JSON.stringify(state._data.turnReceipts)).toBe(turnReceiptsBefore);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		loaded.reconcileFeatureOwnedCompanion(created.companionId, {featureUid: FEATURE_UID});
		expect(getKey(loaded)).toBe(originalKey);
		expect(loaded.queryTurnReceipt(originalKey)).toMatchObject({ok: true, used: false, receipt: null});
		expect(JSON.stringify(loaded._data.turnReceipts)).toBe(turnReceiptsBefore);

		const isolatedState = makeState({level: 9, intelligence: 18});
		const isolated = await createCompanion(isolatedState, ["arcaneConduit", "gaunt"]);
		const isolatedReceipt = isolatedState.getCompanion(isolated.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt;
		expect(isolatedReceipt).toMatchObject({
			ownerUid: FEATURE_UID,
			sourceUid: "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW",
			actionUid: "arcane-conduit:damage-rider",
			generation: 1,
			committed: false,
			executionStatus: "executable",
		});
		expect(isolatedReceipt.key).not.toBe(originalKey);
		expect(JSON.stringify(isolatedState._data.turnReceipts)).toBe(turnReceiptsBefore);
	});

	it("keeps generation choices immutable across level changes while current global scaling turns on and off", async () => {
		const state = makeState({level: 9, intelligence: 18});
		const created = await createCompanion(state, ["arcaneConduit", "bloated"]);
		const companion = state.getCompanion(created.companionId);
		companion.hp.current = 7;
		companion.hitDice.current = 2;
		companion.uses.customPool = {current: 1, max: 2, recharge: "long", kept: true};
		companion.turnUsage = {action: true, reaction: true, flags: {kept: true}};
		const receiptBefore = copy(companion.lifecycle.creationReceipt);
		const setupBefore = copy(companion.setup);
		const idBefore = companion.id;

		state.getClasses()[0].level = 15;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(idBefore)).toMatchObject({
			id: idBefore,
			hp: {max: 80, current: 7},
			hitDice: {current: 2, max: 15},
			uses: {customPool: {current: 1, max: 2, kept: true}},
			turnUsage: {action: true, reaction: true, flags: {kept: true}},
			scaling: {
				resolved: {
					modifications: {
						acquisitionLevel: 9,
						requiredCount: 2,
						currentRequiredCount: 3,
						selected: ["arcaneConduit", "bloated"],
					},
					traits: {deathBurst: {damage: {dice: "4d4", flat: 4}}},
				},
			},
		});
		expect(state.getCompanion(idBefore).setup).toEqual(setupBefore);
		expect(state.getCompanion(idBefore).lifecycle.creationReceipt).toEqual(receiptBefore);

		state.getClasses()[0].level = 5;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(idBefore)).toMatchObject({
			id: idBefore,
			hp: {max: 30, current: 7},
			hitDice: {current: 2, max: 5},
			size: "L",
			scaling: {
				resolved: {
					actions: {
						dreadfulSwipe: {
							damage: {ignoresResistance: false},
							riders: [expect.any(Object), expect.objectContaining({id: "bloatedPush"})],
						},
					},
					traits: {deathBurst: {damage: {dice: "2d4", flat: 4, ignoresResistance: false}}},
					modifications: {
						acquisitionLevel: 9,
						requiredCount: 2,
						currentRequiredCount: 1,
						selected: ["arcaneConduit", "bloated"],
						currentlyAvailable: ["arcaneConduit", "ferocity"],
					},
				},
			},
		});
		expect(state.getCompanion(idBefore).setup).toEqual(setupBefore);
		expect(state.getCompanion(idBefore).lifecycle.creationReceipt).toEqual(receiptBefore);
	});

	it("recalculates Intelligence, PB, spell attack, and spell save metadata without healing or resetting receipts", async () => {
		const state = makeState({level: 9, intelligence: 16});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt"]);
		const companion = state.getCompanion(created.companionId);
		companion.hp.current = 11;
		companion.hitDice.current = 3;
		const receiptBefore = copy(companion.lifecycle.creationReceipt);

		state.setAbilityBase("int", 20);
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.applyClassFeatureEffects();

		expect(state.getCompanion(created.companionId)).toMatchObject({
			hp: {max: 50, current: 11},
			hitDice: {current: 3, max: 9},
			profBonus: 5,
			ac: 15,
			scaling: {
				resolved: {
					statistics: {proficiencyBonus: 5, spellAttackBonus: 10, spellSaveDc: 18},
					actions: {dreadfulSwipe: {attackBonus: 10, damage: {flat: 5}}},
					modifications: {
						effects: {
							arcaneConduit: {damageRider: {damageRollBonus: 5}},
							gaunt: {fearAura: {save: {dc: 18}}},
						},
					},
				},
			},
		});
		expect(state.getCompanion(created.companionId).lifecycle.creationReceipt).toEqual(receiptBefore);
	});

	it("requires a fresh three-choice transaction only for a new level-15 generation", async () => {
		const state = makeState({level: 9});
		const first = await createCompanion(state, ["arcaneConduit", "bloated"]);
		const firstKey = state.getCompanion(first.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt.key;
		const turnReceiptsBefore = JSON.stringify(state._data.turnReceipts);
		state.getClasses()[0].level = 15;
		state.applyClassFeatureEffects();
		expect(state.getCompanion(first.companionId).setup.choices.modifications.selectedOptionIds)
			.toEqual(["arcaneConduit", "bloated"]);

		state.killFeatureOwnedCompanion(first.companionId, {featureUid: FEATURE_UID});
		const second = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"], {
			payment: {type: "spellSlot", pool: "spell", slotLevel: 1},
		});
		expect(second).toMatchObject({ok: true, committed: true});
		expect(state.getCompanion(second.companionId)).toMatchObject({
			lifecycle: {generation: 2},
			setup: {
				choices: {
					modifications: {
						acquisitionLevel: 15,
						requiredCount: 3,
						selectedOptionIds: ["arcaneConduit", "gaunt", "moist"],
					},
				},
			},
		});
		const secondReceipt = state.getCompanion(second.companionId)
			.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt;
		expect(secondReceipt).toMatchObject({
			companionId: second.companionId,
			generation: 2,
			ownerUid: FEATURE_UID,
			sourceUid: "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW",
			actionUid: "arcane-conduit:damage-rider",
			committed: false,
			executionStatus: "executable",
		});
		expect(secondReceipt.key).not.toBe(firstKey);
		expect(JSON.stringify(state._data.turnReceipts)).toBe(turnReceiptsBefore);
	});
});

describe("RHW Reanimator R4a persistence and Respec", () => {
	it("round-trips the canonical receipt, resolved effects, live values, and identities idempotently", async () => {
		const state = makeState({level: 15, intelligence: 18});
		const created = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		const companion = state.getCompanion(created.companionId);
		companion.hp.current = 9;
		companion.hitDice.current = 4;
		companion.turnUsage = {action: true, reaction: false, flags: {kept: true}};
		const expected = copy(getAtomicState(state));

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(getAtomicState(loaded)).toEqual(expected);
		loaded.applyClassFeatureEffects();
		loaded._migrateCompanions();
		expect(getAtomicState(loaded)).toEqual(expected);
	});

	it("infers a canonical setup receipt as complete when the redundant scaling flag is absent", async () => {
		const state = makeState({level: 9, intelligence: 18});
		const created = await createCompanion(state, ["arcaneConduit", "bloated"]);
		const companion = state.getCompanion(created.companionId);
		delete companion.scaling.deferSetupChoices;

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(loaded.getCompanion(created.companionId)).toMatchObject({
			setup: {
				choices: {
					modifications: {
						acquisitionLevel: 9,
						selectedOptionIds: ["arcaneConduit", "bloated"],
					},
				},
			},
			scaling: {
				deferSetupChoices: false,
				resolved: {
					statistics: {size: ["L"]},
					modifications: {
						deferred: false,
						selected: ["arcaneConduit", "bloated"],
					},
				},
			},
		});
		expect(loaded.getFeatureCalculations().reanimatedCompanion.activeCompanion)
			.toMatchObject({setupStatus: "complete"});
	});

	it("keeps an R3 deferred generation explicit while applying current Improved Reanimation idempotently", async () => {
		const state = makeState({level: 3});
		const created = await createCompanion(state, []);
		const companion = state.getCompanion(created.companionId);
		state.getClasses()[0].level = 15;
		companion.setup = {appearance: companion.setup.appearance};
		delete companion.lifecycle.creationReceipt.setupChoices;
		companion.scaling.deferSetupChoices = true;
		state.reconcileFeatureOwnedCompanion(companion.id, {
			featureUid: FEATURE_UID,
			deferSetupChoices: true,
		});
		expect(companion.scaling.resolved).toMatchObject({
			traits: {deathBurst: {damage: {dice: "4d4", flat: 0, ignoresResistance: true}}},
			modifications: {
				deferred: true,
				acquisitionLevel: null,
				selected: [],
				currentRequiredCount: 3,
			},
		});

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		const once = copy(loaded.toJson());
		loaded._migrateCompanions();
		expect(loaded.toJson()).toEqual(once);
		expect(loaded.getFeatureCalculations().reanimatedCompanion.activeCompanion)
			.toMatchObject({setupStatus: "legacyDeferred"});
	});

	it("removes only exact RHW R4a state and leaves a six-part collision byte-stable", async () => {
		const state = makeState({level: 9});
		const created = await createCompanion(state, ["arcaneConduit", "ferocity"]);
		const collisionId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			creatureName: "Reanimated Companion",
			creatureSource: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			active: true,
			featureGrant: {
				type: "subclassFeature",
				uid: LEGACY_FEATURE_UID,
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Reanimator",
				subclassSource: "RHW",
				level: 3,
			},
			setup: {choices: {modifications: {selectedOptionIds: ["moist"]}}},
			hp: {max: 45, current: 13, temp: 0},
			lifecycle: {status: "active", generation: 7},
		});
		const collisionBefore = JSON.stringify(state.getCompanion(collisionId));

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();

		expect(state.getCompanion(created.companionId)).toBeNull();
		expect(getCreationResource(state)).toBeUndefined();
		expect(JSON.stringify(state.getCompanion(collisionId))).toBe(collisionBefore);
	});

	it("applies a same-subclass level change without repicking and Undo restores the pre-Apply bytes", async () => {
		const liveState = makeState({level: 9});
		await createCompanion(liveState, ["arcaneConduit", "bloated"]);
		expect(liveState.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const before = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].level = 15;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).resolves.toBe(true);
		expect(liveState.getFeatureOwnedCompanions(FEATURE_UID)[0]).toMatchObject({
			setup: {
				choices: {
					modifications: {
						acquisitionLevel: 9,
						selectedOptionIds: ["arcaneConduit", "bloated"],
					},
				},
			},
			scaling: {
				resolved: {
					modifications: {
						requiredCount: 2,
						currentRequiredCount: 3,
						selected: ["arcaneConduit", "bloated"],
					},
				},
			},
		});

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(liveState.toJson())).toBe(before);
	});

	it("rolls a failed same-subclass Respec Apply back byte-for-byte", async () => {
		const liveState = makeState({level: 15});
		await createCompanion(liveState, ["ferocity", "gaunt", "moist"]);
		expect(liveState.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const before = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].level = 5;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(JSON.stringify(liveState.toJson())).toBe(before);
	});
});
