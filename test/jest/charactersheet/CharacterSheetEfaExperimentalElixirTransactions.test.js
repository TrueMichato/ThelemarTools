import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;

const copy = value => JSON.parse(JSON.stringify(value));

function makeState ({
	classSource = "EFA",
	subclassSource = "EFA",
	level = 5,
	slotLevel = 1,
	slotMax = 2,
	slotCurrent = 1,
} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: {
			name: "Alchemist",
			shortName: "Alchemist",
			source: subclassSource,
		},
	});
	state.setMaxHp(30);
	state.setHp(7, 30, 0);
	state.setSpellSlots(slotLevel, slotMax, slotCurrent);
	return state;
}

function addSupplies (state, {
	id = "alchemist-supplies",
	name = "Alchemist's Supplies",
	source = "XPHB",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({id, name, source, type: "AT", quantity: 1, _isCustom: true});
	state.setItemEquipped(id, equipped);
	if (proficient) state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function planBatch (state, {
	rolls = Array(state.getEfaExperimentalElixirBatchSize()).fill(1),
	row6Choices = [],
	batchId = "planned-batch",
} = {}) {
	const result = state.planEfaExperimentalElixirBatch({rolls, row6Choices, batchId});
	expect(result.ok).toBe(true);
	return result.plan;
}

function seedBatch (state, {
	rolls = Array(state.getEfaExperimentalElixirBatchSize()).fill(1),
	row6Choices = [],
	batchId = "old-batch",
} = {}) {
	const result = state.commitEfaExperimentalElixirBatch({
		decision: "produce",
		plan: planBatch(state, {rolls, row6Choices, batchId}),
	});
	expect(result.ok).toBe(true);
	return result;
}

function getMetadata (row) {
	return row.item._generatedItemProvenance.metadata;
}

function getVialIdentities (state) {
	return state.getEfaExperimentalElixirRows().map(row => ({
		id: row.id,
		generatedItemId: row.item._generatedItemId,
		metadata: copy(getMetadata(row)),
	}));
}

function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	const page = {
		_lastRestSnapshot: null,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
	};
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

describe("EFA Experimental Elixir Long Rest transactions", () => {
	test("produces a complete chosen batch only after the generic Long Rest commits", () => {
		const state = makeState();
		addSupplies(state);
		const old = seedBatch(state, {rolls: [1, 2, 3], batchId: "old"});
		const {rest, page} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: planBatch(state, {rolls: [4, 5, 6], row6Choices: [2], batchId: "new"}),
		});

		expect(prepared).toMatchObject({
			ok: true,
			hasRequiredSupplies: true,
			draft: {
				requestedDecision: "produce",
				decision: "produce",
			},
		});

		const result = rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			restCommitted: true,
			experimentalElixir: {
				code: "efa-experimental-elixir-batch-replaced",
				requestedDecision: "produce",
				decision: "produce",
				hasRequiredSupplies: true,
			},
		});
		expect(state.getHp().current).toBe(30);
		expect(state.getSpellSlotsCurrent(1)).toBe(2);
		expect(state.getItems().some(item => old.createdItemIds.includes(item.id))).toBe(false);
		expect(state.getEfaExperimentalElixirRows().map(row => getMetadata(row))).toEqual([
			expect.objectContaining({effectKey: "boldness", origin: "longRest", batchId: "new"}),
			expect.objectContaining({effectKey: "flight", origin: "longRest", batchId: "new"}),
			expect.objectContaining({effectKey: "swiftness", origin: "longRest", batchId: "new"}),
		]);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(rest.hasRestUndoAvailable()).toBe(true);
	});

	test("an explicit decline commits the rest and expires the prior batch", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		seedBatch(state, {rolls: [1, 2]});
		const {rest} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({decision: "decline"});

		const result = rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft});

		expect(result).toMatchObject({
			ok: true,
			restCommitted: true,
			experimentalElixir: {
				code: "efa-experimental-elixir-batch-declined",
				requestedDecision: "decline",
				decision: "decline",
				hasRequiredSupplies: true,
			},
		});
		expect(state.getHp().current).toBe(30);
		expect(state.getEfaExperimentalElixirRows()).toEqual([]);
	});

	test("missing supplies demote requested production to an empty committed replacement", () => {
		const state = makeState({level: 3});
		seedBatch(state, {rolls: [1, 2]});
		const {rest} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: planBatch(state, {rolls: [3, 4], batchId: "unused"}),
		});

		expect(prepared).toMatchObject({
			ok: true,
			hasRequiredSupplies: false,
			draft: {
				requestedDecision: "produce",
				decision: "decline",
				plan: null,
			},
		});

		const result = rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft});

		expect(result).toMatchObject({
			ok: true,
			restCommitted: true,
			experimentalElixir: {
				code: "efa-experimental-elixir-batch-declined",
				requestedDecision: "produce",
				decision: "decline",
				hasRequiredSupplies: false,
			},
		});
		expect(state.getHp().current).toBe(30);
		expect(state.getEfaExperimentalElixirRows()).toEqual([]);
	});

	test.each([
		["same-name PHB supplies", {source: "PHB"}],
		["unheld XPHB supplies", {equipped: false}],
		["unproficient XPHB supplies", {proficient: false}],
		["unrelated proficient tools", {name: "Smith's Tools", source: "XPHB"}],
	])("%s do not block the rest and cannot produce a batch", (_label, supplies) => {
		const state = makeState({level: 3});
		addSupplies(state, supplies);
		seedBatch(state, {rolls: [1, 2]});
		const {rest} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: planBatch(state, {rolls: [3, 4]}),
		});

		expect(prepared).toMatchObject({
			ok: true,
			hasRequiredSupplies: false,
			draft: {requestedDecision: "produce", decision: "decline", plan: null},
		});
		expect(rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft})).toMatchObject({
			ok: true,
			restCommitted: true,
			experimentalElixir: {
				requestedDecision: "produce",
				decision: "decline",
				hasRequiredSupplies: false,
			},
		});
		expect(state.getHp().current).toBe(30);
		expect(state.getEfaExperimentalElixirRows()).toEqual([]);
	});

	test("cancelling the entire rest preserves the prior batch and every pre-rest value", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		seedBatch(state, {rolls: [1, 2]});
		const before = copy(state.toJson());
		const {rest, page} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: planBatch(state, {rolls: [3, 4]}),
		});

		expect(rest.commitEfaExperimentalElixirLongRestDraft({
			draft: prepared.draft,
			cancelled: true,
		})).toEqual({
			ok: false,
			committed: false,
			restCommitted: false,
			code: "long-rest-cancelled",
		});
		expect(state.toJson()).toEqual(before);
		expect(page._lastRestSnapshot).toBeNull();
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	test("rejects an unresolved row-6 draft before any Long Rest mutation", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		seedBatch(state, {rolls: [1, 2]});
		const invalidPlan = planBatch(state, {rolls: [6, 2], row6Choices: [1]});
		invalidPlan.vials[0].row6Choice = null;
		const before = copy(state.toJson());
		const {rest, page} = makeRest(state);

		expect(rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: invalidPlan,
		})).toEqual({
			ok: false,
			code: "invalid-efa-experimental-elixir-plan",
		});
		expect(state.toJson()).toEqual(before);
		expect(page._lastRestSnapshot).toBeNull();
	});

	test("a failed replacement restores the full pre-rest transaction boundary", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		seedBatch(state, {rolls: [1, 2], batchId: "before-failure"});
		const beforeIdentities = getVialIdentities(state);
		const {rest, page} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision: "produce",
			plan: planBatch(state, {rolls: [3, 4], batchId: "will-fail"}),
		});
		jest.spyOn(state, "createGeneratedFeatureItem")
			.mockReturnValue({ok: false, code: "forced-rest-item-failure"});

		expect(rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft})).toMatchObject({
			ok: false,
			committed: false,
			restCommitted: false,
			code: "efa-experimental-elixir-batch-commit-failed",
			error: "forced-rest-item-failure",
			rolledBack: true,
		});
		expect(state.getHp().current).toBe(7);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
		expect(getVialIdentities(state)).toEqual(beforeIdentities);
		expect(page._lastRestSnapshot).toBeNull();
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
	});

	test.each(["produce", "decline"])("generic rest undo restores exact prior vial identities after %s", decision => {
		const state = makeState({level: 3});
		addSupplies(state);
		seedBatch(state, {rolls: [1, 2], batchId: "before-undo"});
		const beforeIdentities = getVialIdentities(state);
		const {rest, page} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({
			decision,
			...(decision === "produce"
				? {plan: planBatch(state, {rolls: [4, 5], batchId: "replacement"})}
				: {}),
		});

		expect(rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft}).ok).toBe(true);
		expect(getVialIdentities(state)).not.toEqual(beforeIdentities);
		expect(rest._onUndoRest()).toBe(true);

		expect(getVialIdentities(state)).toEqual(beforeIdentities);
		expect(state.getHp().current).toBe(7);
		expect(state.getSpellSlotsCurrent(1)).toBe(1);
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		expect(page.renderCharacter).toHaveBeenCalledTimes(2);
	});

	test("rest expiry removes only supported exact-owner EFA vials", () => {
		const state = makeState({level: 3});
		const exact = seedBatch(state, {rolls: [1, 2]});
		const unsupported = state.createEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			batchId: "unsupported",
			spentSlotLevel: 1,
		});
		const unsupportedRow = state.getInventory().find(row => row.id === unsupported.itemId);
		unsupportedRow.item._generatedItemProvenance.metadata.metadataSchemaVersion = 999;
		const tce = state.createGeneratedFeatureItem({
			item: {name: "Experimental Elixir", source: "TCE", type: "P"},
			owner: {
				featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|TCE|3|TCE",
				featureSource: "TCE",
				classUid: "Artificer|EFA",
				subclassUid: "Alchemist|Artificer|EFA|TCE",
			},
			metadata: {origin: "longRest"},
		});
		state.addItem({id: "custom-elixir", name: "Experimental Elixir", source: "EFA", type: "P", _isCustom: true});
		const {rest} = makeRest(state);
		const prepared = rest.prepareEfaExperimentalElixirLongRestDraft({decision: "decline"});

		expect(rest.commitEfaExperimentalElixirLongRestDraft({draft: prepared.draft}).ok).toBe(true);
		expect(state.getItems().some(item => exact.createdItemIds.includes(item.id))).toBe(false);
		expect(state.getItems().map(item => item.id)).toEqual(expect.arrayContaining([
			unsupported.itemId,
			tce.itemId,
			"custom-elixir",
		]));
	});
});

describe("EFA Experimental Elixir spell-slot transactions", () => {
	test("atomically spends one selected slot and in-combat Magic action and creates exact metadata", () => {
		const state = makeState({level: 9, slotLevel: 4, slotMax: 2, slotCurrent: 1});
		addSupplies(state);
		state.startCombat();

		const result = state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "resilience",
			slotLevel: 4,
			batchId: "slot-transaction",
		});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			code: "efa-experimental-elixir-spell-slot-created",
			actionType: "action",
			actionLabel: "Magic",
			actionTracked: true,
			spentSlotLevel: 4,
			focus: {
				inventoryItemId: "alchemist-supplies",
				itemUid: "Alchemist's Supplies|XPHB",
			},
			metadata: {
				metadataSchemaVersion: 1,
				effectKey: "resilience",
				origin: "spellSlot",
				batchId: "slot-transaction",
				creationArtificerLevel: 9,
				spentSlotLevel: 4,
				duration: {amount: 1, unit: "hour", endsOnShortRest: true, endsOnLongRest: true},
				value: {kind: "acBonus", amount: 1},
			},
		});
		expect(state.getSpellSlotsCurrent(4)).toBe(0);
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getEfaExperimentalElixirRows()).toHaveLength(1);
	});

	test.each([
		["missing supplies", null],
		["same-name PHB supplies", {source: "PHB"}],
		["unheld XPHB supplies", {equipped: false}],
		["unproficient XPHB supplies", {proficient: false}],
		["unrelated proficient tools", {name: "Smith's Tools", source: "XPHB"}],
	])("rejects %s before spending the action or slot", (_label, supplies) => {
		const state = makeState();
		if (supplies) addSupplies(state, supplies);
		state.startCombat();
		const before = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			slotLevel: 1,
		})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-focus-unavailable",
		});
		expect(state.toJson()).toEqual(before);
	});

	test.each([
		["cancel", {cancelled: true}, "efa-experimental-elixir-spell-slot-cancelled"],
		["invalid effect", {effectKey: "transformation"}, "invalid-efa-experimental-elixir-effect"],
		["invalid slot level", {slotLevel: 0}, "invalid-efa-experimental-elixir-slot-level"],
	])("%s spends nothing", (_label, overrides, expectedCode) => {
		const state = makeState();
		addSupplies(state);
		state.startCombat();
		const before = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			slotLevel: 1,
			...overrides,
		})).toMatchObject({
			ok: false,
			committed: false,
			code: expectedCode,
		});
		expect(state.toJson()).toEqual(before);
	});

	test("an unavailable action spends no slot and creates no vial", () => {
		const state = makeState();
		addSupplies(state);
		state.startCombat();
		state.consumeActionType("action");
		const before = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			slotLevel: 1,
		})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-action-unavailable",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("an unavailable spell slot spends no action and creates no vial", () => {
		const state = makeState({slotCurrent: 0});
		addSupplies(state);
		state.startCombat();
		const before = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "boldness",
			slotLevel: 1,
		})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-spell-slot-unavailable",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("rolls back the action and slot if generated-item creation fails", () => {
		const state = makeState();
		addSupplies(state);
		state.startCombat();
		const before = copy(state.toJson());
		jest.spyOn(state, "createGeneratedFeatureItem")
			.mockReturnValue({ok: false, code: "forced-generated-item-failure"});

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "swiftness",
			slotLevel: 1,
		})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-spell-slot-commit-failed",
			error: "forced-generated-item-failure",
			rolledBack: true,
		});
		expect(state.toJson()).toEqual(before);
	});

	test("outside combat spends slots without permanently latching action economy", () => {
		const state = makeState({slotCurrent: 2});
		addSupplies(state);

		const first = state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			slotLevel: 1,
		});
		const second = state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			slotLevel: 1,
		});

		expect(first).toMatchObject({ok: true, committed: true, actionTracked: false});
		expect(second).toMatchObject({ok: true, committed: true, actionTracked: false});
		expect(state.getSpellSlotsCurrent(1)).toBe(0);
		expect(state.isActionTypeAvailable("action")).toBe(true);
		expect(state.getEfaExperimentalElixirRows()).toHaveLength(2);
	});

	test.each([
		{classSource: "EFA", subclassSource: "TCE"},
		{classSource: "TCE", subclassSource: "TCE"},
		{classSource: "TCE", subclassSource: "EFA"},
	])("never spends for non-exact identity %#", sources => {
		const state = makeState(sources);
		addSupplies(state);
		state.startCombat();
		const before = copy(state.toJson());

		expect(state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "healing",
			slotLevel: 1,
		})).toEqual({
			ok: false,
			committed: false,
			code: "efa-experimental-elixir-unavailable",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("save/load preserves the committed slot cost, generated identity, and exact metadata", () => {
		const state = makeState({level: 15, slotLevel: 3, slotMax: 2, slotCurrent: 1});
		addSupplies(state, {id: "stable-supplies"});
		const committed = state.commitEfaExperimentalElixirSpellSlotVial({
			effectKey: "flight",
			slotLevel: 3,
			batchId: "round-trip-slot",
		});
		const before = getVialIdentities(state);
		const restored = new CharacterSheetState();

		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(restored.getSpellSlotsCurrent(3)).toBe(0);
		expect(getVialIdentities(restored)).toEqual(before);
		expect(getMetadata(restored.getEfaExperimentalElixirRows()[0])).toEqual({
			metadataSchemaVersion: 1,
			effectKey: "flight",
			origin: "spellSlot",
			batchId: "round-trip-slot",
			creationArtificerLevel: 15,
			spentSlotLevel: 3,
			healing: null,
			duration: {amount: 10, unit: "minute", endsOnShortRest: true, endsOnLongRest: true},
			value: {kind: "flySpeedFeet", amount: 30},
		});
		expect(restored.getItems().some(item => item.id === committed.itemId)).toBe(true);
	});
});
