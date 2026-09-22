import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const getSubclass = source => ({
	name: "Alchemist",
	shortName: "Alchemist",
	source,
});

const makeState = ({
	classSource = "EFA",
	subclassSource = "EFA",
	level = 3,
} = {}) => {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: getSubclass(subclassSource),
	});
	return state;
};

const planBatch = (state, {
	rolls = Array(state.getEfaExperimentalElixirBatchSize()).fill(1),
	row6Choices = [],
	batchId = "batch-test",
} = {}) => state.planEfaExperimentalElixirBatch({rolls, row6Choices, batchId});

const commitBatch = (state, opts = {}) => {
	const planned = planBatch(state, opts);
	expect(planned.ok).toBe(true);
	return state.commitEfaExperimentalElixirBatch({decision: "produce", plan: planned.plan});
};

const getMetadata = row => row.item._generatedItemProvenance.metadata;

describe("EFA Experimental Elixir core lifecycle", () => {
	test.each([
		[2, 0],
		[3, 2],
		[4, 2],
		[5, 3],
		[8, 3],
		[9, 4],
		[14, 4],
		[15, 5],
		[20, 5],
		[21, 0],
	])("calculates the exact Long Rest batch size at Artificer level %i", (level, expected) => {
		expect(CharacterSheetState.getEfaExperimentalElixirBatchSizeForLevel(level)).toBe(expected);
	});

	test("publishes the canonical exact EFA owner descriptor", () => {
		expect(CharacterSheetState.EFA_EXPERIMENTAL_ELIXIR_OWNER).toEqual({
			featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|EFA|3|EFA",
			featureSource: "EFA",
			classUid: "Artificer|EFA",
			subclassUid: "Alchemist|Artificer|EFA|EFA",
		});
		expect(Object.isFrozen(CharacterSheetState.EFA_EXPERIMENTAL_ELIXIR_OWNER)).toBe(true);
	});

	test("plans exact-count d6 results and requires an explicit row-6 choice", () => {
		const state = makeState({level: 5});
		const beforePlan = copy(state.toJson());
		const planned = planBatch(state, {
			rolls: [6, 2, 6],
			row6Choices: [5, 1],
		});

		expect(state.toJson()).toEqual(beforePlan);
		expect(planned).toMatchObject({
			ok: true,
			plan: {
				planVersion: 1,
				origin: "longRest",
				batchId: "batch-test",
				artificerLevel: 5,
				vials: [
					{roll: 6, row6Choice: 5, resolvedRow: 5, effectKey: "flight"},
					{roll: 2, row6Choice: null, resolvedRow: 2, effectKey: "swiftness"},
					{roll: 6, row6Choice: 1, resolvedRow: 1, effectKey: "healing"},
				],
			},
		});
		expect(planBatch(state, {rolls: [1, 2]})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-roll-count",
		});
		expect(planBatch(state, {rolls: [1, 2, 7]})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-roll",
		});
		expect(planBatch(state, {rolls: [6, 2, 3]})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-row-6-choices",
		});
		expect(planBatch(state, {rolls: [6, 2, 3], row6Choices: [6]})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-row-6-choices",
		});
		expect(planBatch(state, {rolls: [1, 2, 3], row6Choices: [1]})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-row-6-choices",
		});
		expect(makeState({subclassSource: "TCE"}).planEfaExperimentalElixirBatch({rolls: [1]})).toEqual({
			ok: false,
			code: "efa-experimental-elixir-unavailable",
		});
	});

	test.each([
		{
			level: 3,
			expected: {
				healing: {dice: "2d8", diceCount: 2, dieFaces: 8, ability: "int", abilityModifierTiming: "consume"},
				swiftness: {kind: "walkingSpeedBonusFeet", amount: 10},
				resilienceDuration: {amount: 10, unit: "minute", endsOnShortRest: true, endsOnLongRest: true},
				boldnessDuration: {amount: 1, unit: "minute", endsOnShortRest: true, endsOnLongRest: true},
				flight: {kind: "flySpeedFeet", amount: 10},
			},
		},
		{
			level: 9,
			expected: {
				healing: {dice: "3d8", diceCount: 3, dieFaces: 8, ability: "int", abilityModifierTiming: "consume"},
				swiftness: {kind: "walkingSpeedBonusFeet", amount: 15},
				resilienceDuration: {amount: 1, unit: "hour", endsOnShortRest: true, endsOnLongRest: true},
				boldnessDuration: {amount: 10, unit: "minute", endsOnShortRest: true, endsOnLongRest: true},
				flight: {kind: "flySpeedFeet", amount: 20},
			},
		},
		{
			level: 15,
			expected: {
				healing: {dice: "4d8", diceCount: 4, dieFaces: 8, ability: "int", abilityModifierTiming: "consume"},
				swiftness: {kind: "walkingSpeedBonusFeet", amount: 20},
				resilienceDuration: {amount: 8, unit: "hour", endsOnShortRest: false, endsOnLongRest: true},
				boldnessDuration: {amount: 1, unit: "hour", endsOnShortRest: true, endsOnLongRest: true},
				flight: {kind: "flySpeedFeet", amount: 30},
			},
		},
	])("snapshots every effect's later-transaction scaling at level $level", ({level, expected}) => {
		expect(CharacterSheetState.getEfaExperimentalElixirEffectSnapshot("healing", level)).toEqual({
			healing: expected.healing,
			duration: null,
			value: null,
		});
		expect(CharacterSheetState.getEfaExperimentalElixirEffectSnapshot("swiftness", level)).toEqual({
			healing: null,
			duration: {amount: 1, unit: "hour", endsOnShortRest: true, endsOnLongRest: true},
			value: expected.swiftness,
		});
		expect(CharacterSheetState.getEfaExperimentalElixirEffectSnapshot("resilience", level)).toEqual({
			healing: null,
			duration: expected.resilienceDuration,
			value: {kind: "acBonus", amount: 1},
		});
		expect(CharacterSheetState.getEfaExperimentalElixirEffectSnapshot("boldness", level)).toEqual({
			healing: null,
			duration: expected.boldnessDuration,
			value: {kind: "rollBonusDice", dice: "1d4", appliesTo: ["attack", "savingThrow"]},
		});
		expect(CharacterSheetState.getEfaExperimentalElixirEffectSnapshot("flight", level)).toEqual({
			healing: null,
			duration: {amount: 10, unit: "minute", endsOnShortRest: true, endsOnLongRest: true},
			value: expected.flight,
		});
	});

	test("creates exact-owner spell-slot vials with a complete immutable scaling receipt", () => {
		const state = makeState({level: 9});
		const createSpy = jest.spyOn(state, "createGeneratedFeatureItem");
		const created = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "resilience",
			batchId: "slot-batch",
			spentSlotLevel: 4,
		});

		expect(created).toMatchObject({
			ok: true,
			code: "generated-item-created",
			metadata: {
				metadataSchemaVersion: 1,
				effectKey: "resilience",
				origin: "spellSlot",
				batchId: "slot-batch",
				creationArtificerLevel: 9,
				spentSlotLevel: 4,
				healing: null,
				duration: {amount: 1, unit: "hour", endsOnShortRest: true, endsOnLongRest: true},
				value: {kind: "acBonus", amount: 1},
			},
		});
		expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
			owner: CharacterSheetState.EFA_EXPERIMENTAL_ELIXIR_OWNER,
		}));
		expect(state.classifyEfaExperimentalElixir(
			state.getInventory().find(row => row.id === created.itemId),
		)).toMatchObject({
			status: "valid",
			repairRequired: false,
			reason: "supported-efa-experimental-elixir",
		});
		expect(state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "resilience",
			spentSlotLevel: 0,
		})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-metadata",
		});
	});

	test("keeps repeated same-effect vials as distinct non-stacking quantity-1 rows", () => {
		const state = makeState();
		expect(commitBatch(state, {rolls: [1, 1]})).toMatchObject({
			ok: true,
			committed: true,
			code: "efa-experimental-elixir-batch-replaced",
		});

		const rows = state.getEfaExperimentalElixirRows();
		expect(rows).toHaveLength(2);
		expect(rows.map(row => row.quantity)).toEqual([1, 1]);
		expect(new Set(rows.map(row => row.id)).size).toBe(2);
		expect(new Set(rows.map(row => row.item._generatedItemId)).size).toBe(2);
		expect(rows.map(row => getMetadata(row).effectKey)).toEqual(["healing", "healing"]);
	});

	test("atomically replaces the prior supported batch and records one shared new batch", () => {
		const state = makeState({level: 5});
		const first = commitBatch(state, {rolls: [1, 2, 3], batchId: "batch-a"});
		expect(first.createdItemIds).toHaveLength(3);

		const secondPlan = planBatch(state, {
			rolls: [4, 5, 6],
			row6Choices: [2],
			batchId: "batch-b",
		});
		const second = state.commitEfaExperimentalElixirBatch({decision: "produce", plan: secondPlan.plan});
		expect(second).toMatchObject({
			ok: true,
			committed: true,
			expiredItemIds: expect.arrayContaining(first.createdItemIds),
			createdItemIds: expect.any(Array),
			batchId: "batch-b",
		});
		expect(second.createdItemIds).toHaveLength(3);
		expect(state.getEfaExperimentalElixirRows().map(row => getMetadata(row))).toEqual([
			expect.objectContaining({effectKey: "boldness", batchId: "batch-b"}),
			expect.objectContaining({effectKey: "flight", batchId: "batch-b"}),
			expect.objectContaining({effectKey: "swiftness", batchId: "batch-b"}),
		]);
		expect(state.getItems().some(item => first.createdItemIds.includes(item.id))).toBe(false);
	});

	test("decline commits an empty replacement, while cancel and validation failure mutate nothing", () => {
		const state = makeState();
		commitBatch(state, {rolls: [1, 2], batchId: "old"});
		const beforeCancel = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirBatch({decision: "cancel"})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-batch-cancelled",
		});
		expect(state.toJson()).toEqual(beforeCancel);

		const invalidPlan = planBatch(state, {rolls: [1, 2], batchId: "new"}).plan;
		invalidPlan.vials[0].metadata.batchId = "forged";
		expect(state.commitEfaExperimentalElixirBatch({decision: "produce", plan: invalidPlan})).toEqual({
			ok: false,
			committed: false,
			code: "invalid-efa-experimental-elixir-plan",
		});
		expect(state.toJson()).toEqual(beforeCancel);

		const declined = state.commitEfaExperimentalElixirBatch({decision: "decline"});
		expect(declined).toMatchObject({
			ok: true,
			committed: true,
			code: "efa-experimental-elixir-batch-declined",
			expiredItemIds: expect.any(Array),
			createdItemIds: [],
			batchId: null,
		});
		expect(declined.expiredItemIds).toHaveLength(2);
		expect(state.getEfaExperimentalElixirRows()).toEqual([]);
	});

	test("rolls back the full replacement if any generated-vial creation fails", () => {
		const state = makeState();
		commitBatch(state, {rolls: [1, 2], batchId: "old"});
		const before = copy(state.toJson());
		const next = planBatch(state, {rolls: [3, 4], batchId: "next"}).plan;
		const originalCreate = state.createGeneratedFeatureItem.bind(state);
		let calls = 0;
		jest.spyOn(state, "createGeneratedFeatureItem").mockImplementation(opts => {
			calls++;
			if (calls === 2) return {ok: false, code: "forced-test-failure"};
			return originalCreate(opts);
		});

		expect(state.commitEfaExperimentalElixirBatch({decision: "produce", plan: next})).toMatchObject({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-batch-commit-failed",
			error: "forced-test-failure",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("round-trips supported vials and reconciles idempotently without changing identities", () => {
		const state = makeState({level: 9});
		commitBatch(state, {rolls: [1, 2, 3, 4], batchId: "round-trip"});
		const before = copy(state.toJson());
		const restored = new CharacterSheetState();

		expect(restored.loadFromJson(copy(before))).not.toBe(false);
		expect(restored.getEfaExperimentalElixirRows().map(row => ({
			id: row.id,
			generatedItemId: row.item._generatedItemId,
			metadata: getMetadata(row),
		}))).toEqual(state.getEfaExperimentalElixirRows().map(row => ({
			id: row.id,
			generatedItemId: row.item._generatedItemId,
			metadata: getMetadata(row),
		})));
		const normalized = copy(restored.toJson());
		const restoredAgain = new CharacterSheetState();
		expect(restoredAgain.loadFromJson(copy(normalized))).not.toBe(false);
		expect(restoredAgain.toJson()).toEqual(normalized);
		const firstReconcile = restored.reconcileEfaExperimentalElixirs({cause: "test-1"});
		const afterFirst = copy(restored.toJson());
		const secondReconcile = restored.reconcileEfaExperimentalElixirs({cause: "test-2"});
		expect(restored.toJson()).toEqual(afterFirst);
		expect(firstReconcile).toMatchObject({removedItemIds: [], staleItemIds: []});
		expect(secondReconcile).toMatchObject({removedItemIds: [], staleItemIds: []});
		expect(restored.getEfaExperimentalElixirRows().map(row => row.id))
			.toEqual(state.getEfaExperimentalElixirRows().map(row => row.id));
	});

	test("preserves unsupported metadata and six-part provenance as stale repair-required rows", () => {
		const state = makeState();
		const current = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			batchId: "unsupported",
			spentSlotLevel: 1,
		});
		const legacy = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			batchId: "legacy",
			spentSlotLevel: 1,
		});
		const unsupportedRow = state.getInventory().find(row => row.id === current.itemId);
		const legacyRow = state.getInventory().find(row => row.id === legacy.itemId);
		unsupportedRow.item._generatedItemProvenance.metadata.metadataSchemaVersion = 999;
		const legacyOwner = legacyRow.item._generatedItemProvenance.owner;
		legacyOwner.featureUid = legacyOwner.featureUid.split("|").slice(0, 6).join("|");
		delete legacyOwner.featureSource;

		expect(state.classifyEfaExperimentalElixir(unsupportedRow)).toMatchObject({
			status: "stale",
			repairRequired: true,
			reason: "unsupported-efa-experimental-elixir-metadata-version",
		});
		expect(state.classifyEfaExperimentalElixir(legacyRow)).toMatchObject({
			status: "stale",
			repairRequired: true,
			reason: "legacy-subclass-feature-uid",
		});
		expect(state.getEfaExperimentalElixirRows()).toEqual([]);

		state.setSubclass("Artificer", getSubclass("TCE"));
		const before = copy(state.toJson());
		expect(state.getItems().map(item => item.id)).toEqual(expect.arrayContaining([current.itemId, legacy.itemId]));
		expect(state.reconcileEfaExperimentalElixirs({cause: "test"})).toMatchObject({
			activeItemIds: [],
			staleItemIds: expect.arrayContaining([current.itemId, legacy.itemId]),
			removedItemIds: [],
		});
		expect(state.toJson()).toEqual(before);
	});

	test("cleans supported vials on exact subclass or class-source loss without touching isolated rows", () => {
		const state = makeState();
		const exact = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			batchId: "exact",
			spentSlotLevel: 1,
		});
		const tceOwner = {
			featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|TCE|3|TCE",
			featureSource: "TCE",
			classUid: "Artificer|EFA",
			subclassUid: "Alchemist|Artificer|EFA|TCE",
		};
		const tce = state.createGeneratedFeatureItem({
			item: {name: "Experimental Elixir", source: "TCE", type: "P"},
			owner: tceOwner,
			metadata: {origin: "longRest"},
		});
		state.addItem({name: "Experimental Elixir", source: "EFA", type: "P", _isCustom: true});
		const custom = state.getItems().find(item =>
			item.name === "Experimental Elixir"
			&& item.source === "EFA"
			&& !item._isGeneratedFeatureItem);

		state.setSubclass("Artificer", getSubclass("TCE"));
		expect(state.getItems().some(item => item.id === exact.itemId)).toBe(false);
		expect(state.getItems().map(item => item.id)).toEqual(expect.arrayContaining([tce.itemId, custom.id]));

		const secondState = makeState();
		const sourceLost = secondState.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			batchId: "source-loss",
			spentSlotLevel: 1,
		});
		const orphanedSave = copy(secondState.toJson());
		orphanedSave.classes = [];
		const restoredWithoutSource = new CharacterSheetState();
		restoredWithoutSource.loadFromJson(orphanedSave);
		expect(restoredWithoutSource.getItems().some(item => item.id === sourceLost.itemId)).toBe(false);

		secondState.removeClass("Artificer", "EFA");
		expect(secondState.getItems().some(item => item.id === sourceLost.itemId)).toBe(false);
	});

	test("never enables EFA lifecycle APIs for compatibility or TCE Alchemists", () => {
		for (const sources of [
			{classSource: "EFA", subclassSource: "TCE"},
			{classSource: "TCE", subclassSource: "TCE"},
			{classSource: "TCE", subclassSource: "EFA"},
		]) {
			const state = makeState({...sources, level: 20});
			expect(state.getEfaExperimentalElixirBatchSize()).toBe(0);
			expect(state.createEfaExperimentalElixirSpellSlotVial({
				effectKey: "healing",
				spentSlotLevel: 1,
			})).toEqual({
				ok: false,
				code: "efa-experimental-elixir-unavailable",
			});
			expect(state.commitEfaExperimentalElixirBatch({decision: "decline"})).toEqual({
				ok: false,
				committed: false,
				code: "efa-experimental-elixir-unavailable",
			});
		}
	});
});
