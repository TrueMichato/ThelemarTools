import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const getOwner = ({
	featureName = "Experimental Elixir",
	classSource = "EFA",
	subclassName = "Alchemist",
	subclassSource = "EFA",
	level = 3,
} = {}) => ({
	featureUid: `${featureName}|Artificer|${classSource}|${subclassName}|${subclassSource}|${level}`,
	classUid: `Artificer|${classSource}`,
	subclassUid: `${subclassName}|Artificer|${classSource}|${subclassSource}`,
});

const getItem = (name = "Experimental Elixir") => ({
	name,
	source: "EFA",
	type: "P",
	entries: ["A generated test item."],
});

describe("Generated feature item provenance", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("creates quantity-1 non-stacking instances with stable unique identities", () => {
		const owner = getOwner();
		const first = state.createGeneratedFeatureItem({
			item: getItem(),
			owner,
			metadata: {effectKey: "healing"},
		});
		const second = state.createGeneratedFeatureItem({
			item: getItem(),
			owner,
			metadata: {effectKey: "swiftness"},
		});

		expect(first).toMatchObject({ok: true, code: "generated-item-created"});
		expect(second).toMatchObject({ok: true, code: "generated-item-created"});
		expect(first.itemId).not.toBe(second.itemId);
		expect(first.generatedItemId).not.toBe(second.generatedItemId);

		const rows = state.getGeneratedFeatureItemRows(owner);
		expect(rows).toHaveLength(2);
		expect(rows.map(row => row.quantity)).toEqual([1, 1]);
		expect(new Set(rows.map(row => row.id)).size).toBe(2);
		expect(new Set(rows.map(row => row.item._generatedItemId)).size).toBe(2);
	});

	it("classifies supported provenance and validates full UID consistency", () => {
		const owner = getOwner();
		const created = state.createGeneratedFeatureItem({
			item: getItem(),
			owner,
			metadata: {origin: "longRest", batchId: "batch-a"},
		});
		const classification = state.classifyGeneratedFeatureItem(
			state.getInventory().find(row => row.id === created.itemId),
		);

		expect(classification).toMatchObject({
			status: "valid",
			repairRequired: false,
			reason: "supported-provenance",
			generatedItemId: created.generatedItemId,
			owner,
			provenance: {
				version: CharacterSheetState.GENERATED_FEATURE_ITEM_PROVENANCE_VERSION,
				owner,
				metadata: {origin: "longRest", batchId: "batch-a"},
			},
		});

		expect(state.createGeneratedFeatureItem({
			item: getItem(),
			owner: {
				...owner,
				classUid: "Artificer|TCE",
			},
		})).toEqual({ok: false, code: "invalid-generated-item-owner"});
	});

	it("isolates exact owner sources, same-named customs, and other EFA features", () => {
		const efaOwner = getOwner();
		const tceOwner = getOwner({subclassSource: "TCE"});
		const otherFeatureOwner = getOwner({featureName: "Alchemical Homunculus"});
		const efa = state.createGeneratedFeatureItem({item: getItem(), owner: efaOwner});
		const tce = state.createGeneratedFeatureItem({
			item: {...getItem(), source: "TCE"},
			owner: tceOwner,
		});
		const otherFeature = state.createGeneratedFeatureItem({item: getItem(), owner: otherFeatureOwner});
		state.addItem({...getItem(), _isCustom: true});
		const custom = state.getItems().find(item =>
			item.name === "Experimental Elixir"
			&& item.source === "EFA"
			&& !item._isGeneratedFeatureItem);

		// Negative-control tripwire: weakening the real owner-key comparison to ignore
		// class/subclass/feature source makes this assertion fail at the public filter call.
		expect(state.getGeneratedFeatureItemRows(efaOwner).map(row => row.id)).toEqual([efa.itemId]);

		const removeSpy = jest.spyOn(state, "removeItem");
		expect(state.removeGeneratedFeatureItemsByOwner(efaOwner)).toEqual([efa.itemId]);
		expect(removeSpy).toHaveBeenCalledTimes(1);
		expect(removeSpy).toHaveBeenCalledWith(efa.itemId);
		expect(state.getItems().map(item => item.id)).toEqual(expect.arrayContaining([
			tce.itemId,
			otherFeature.itemId,
			custom.id,
		]));
	});

	it("surfaces unsupported versions as stale and never lists or removes them", () => {
		const owner = getOwner();
		const created = state.createGeneratedFeatureItem({item: getItem(), owner});
		const wrapper = state.getInventory().find(row => row.id === created.itemId);
		wrapper.item._generatedItemProvenance.version = 999;

		expect(state.classifyGeneratedFeatureItem(wrapper)).toMatchObject({
			status: "stale",
			repairRequired: true,
			reason: "unsupported-provenance-version",
			generatedItemId: created.generatedItemId,
		});
		expect(state.getGeneratedFeatureItemRows(owner)).toEqual([]);
		expect(state.removeGeneratedFeatureItemsByOwner(owner)).toEqual([]);
		expect(state.getItems().find(item => item.id === created.itemId)).toBeDefined();
	});

	it("keeps malformed or duplicate-instance metadata ordinary and untouched", () => {
		const owner = getOwner();
		state.addItem({
			...getItem(),
			_isCustom: true,
			_isGeneratedFeatureItem: true,
			_generatedItemId: "ambiguous-generated-id",
			_generatedItemProvenance: {
				version: CharacterSheetState.GENERATED_FEATURE_ITEM_PROVENANCE_VERSION,
				owner: {
					featureUid: "Experimental Elixir",
					classUid: "Artificer|EFA",
					subclassUid: "Alchemist|Artificer|EFA|EFA",
				},
			},
		});
		const wrapper = state.getInventory()[0];

		expect(state.classifyGeneratedFeatureItem(wrapper)).toEqual({
			status: "ordinary",
			repairRequired: false,
			reason: "malformed-generated-metadata",
		});

		const first = state.createGeneratedFeatureItem({item: getItem("First Vial"), owner});
		const second = state.createGeneratedFeatureItem({item: getItem("Second Vial"), owner});
		const secondWrapper = state.getInventory().find(row => row.id === second.itemId);
		secondWrapper.item._generatedItemId = first.generatedItemId;

		expect(state.classifyGeneratedFeatureItem(
			state.getInventory().find(row => row.id === first.itemId),
		)).toEqual({
			status: "ordinary",
			repairRequired: false,
			reason: "ambiguous-generated-item-id",
		});
		expect(state.classifyGeneratedFeatureItem(secondWrapper)).toEqual({
			status: "ordinary",
			repairRequired: false,
			reason: "ambiguous-generated-item-id",
		});
		expect(state.removeGeneratedFeatureItemsByOwner(owner)).toEqual([]);
		expect(state.getItems()).toHaveLength(3);
	});

	it("preserves valid provenance and instance identity through replacement and save/load", () => {
		const owner = getOwner();
		const metadata = {
			effectKey: "boldness",
			origin: "spellSlot",
			batchId: "batch-b",
			creationClassLevel: 7,
			spentSlotLevel: 2,
		};
		const created = state.createGeneratedFeatureItem({
			item: getItem(),
			owner,
			metadata,
			equipped: true,
		});

		expect(state.replaceItem(created.itemId, {
			name: "Renamed Elixir",
			source: "Custom",
			type: "P",
			entries: ["Player-edited presentation."],
		})).toBe(true);

		const replaced = state.getInventory().find(row => row.id === created.itemId);
		expect(replaced).toMatchObject({
			id: created.itemId,
			quantity: 1,
			equipped: true,
			item: {
				name: "Renamed Elixir",
				_generatedItemId: created.generatedItemId,
			},
		});
		expect(state.classifyGeneratedFeatureItem(replaced)).toMatchObject({
			status: "valid",
			generatedItemId: created.generatedItemId,
			owner,
			provenance: {metadata},
		});

		const restored = new CharacterSheetState();
		restored.loadFromJson(copy(state.toJson()));
		const loaded = restored.getGeneratedFeatureItemRows(owner);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({
			id: created.itemId,
			quantity: 1,
			equipped: true,
			item: {
				name: "Renamed Elixir",
				_generatedItemId: created.generatedItemId,
			},
		});
	});

	it("uses normal item removal semantics for exact-owner cleanup", () => {
		const owner = getOwner();
		const created = state.createGeneratedFeatureItem({
			item: {
				...getItem("Generated Ward"),
				type: "wondrous",
				effects: [{type: "ac", value: 1}],
			},
			owner,
			equipped: true,
		});
		expect(state.getCustomModifier("ac")).toBe(1);

		expect(state.removeGeneratedFeatureItemsByOwner(owner)).toEqual([created.itemId]);
		expect(state.getCustomModifier("ac")).toBe(0);
		expect(state.getItems()).toEqual([]);
	});
});
