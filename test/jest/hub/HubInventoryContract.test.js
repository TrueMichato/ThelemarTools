import {
	getInventoryStackWeight,
	getInventoryTransferEligibility,
	getInventoryWeightSummary,
} from "../../../js/hub/hub-inventory-contract.js";

describe("Hub inventory contract", () => {
	it("allows partial movement while preserving linked copies at the source", () => {
		const entry = {
			id: "stack-1",
			quantity: 3,
			equipped: true,
			item: {name: "Rations", weight: 2},
		};
		const container = {inventory: [entry]};

		expect(getInventoryTransferEligibility({container, entry, quantity: 2})).toEqual({
			isEligible: true,
			blockers: [],
			maxQuantity: 3,
		});
		expect(getInventoryTransferEligibility({container, entry, quantity: 3})).toMatchObject({
			isEligible: false,
			blockers: ["equipped"],
			maxQuantity: 2,
		});
	});

	it.each([
		["container contents", {containedItems: ["private-child-id"]}, "contains items"],
		["hosted Ioun items", {iounSet: ["private-stone-id"]}, "hosts Ioun items"],
	])("refuses partial movement that would duplicate %s", (_label, item, blocker) => {
		const entry = {
			id: "stack-1",
			quantity: 2,
			item: {name: "Linked stack", ...item},
		};

		expect(getInventoryTransferEligibility({
			container: {inventory: [entry]},
			entry,
			quantity: 1,
		})).toEqual({
			isEligible: false,
			blockers: [blocker],
			maxQuantity: 0,
		});
		expect(getInventoryTransferEligibility({
			container: {inventory: [entry]},
			entry,
			quantity: 2,
		})).toEqual({
			isEligible: false,
			blockers: [blocker],
			maxQuantity: 0,
		});
	});

	it.each([
		["item-granted spell", {itemGrantedSpells: [{name: "Fireball", source: "PHB", itemId: "stack-1"}]}],
		["spell component", {spellcasting: {spells: [{componentItemId: "stack-1"}]}}],
		["container", {inventory: [{id: "container", quantity: 1, item: {containedItems: ["stack-1"]}}]}],
		["Ioun bond", {iounBonds: {"stack-1": {bonded: true}}}],
	])("refuses a whole stack referenced by %s state", (_label, linkedState) => {
		const entry = {id: "stack-1", quantity: 1, item: {name: "Focus"}};
		expect(getInventoryTransferEligibility({
			container: {inventory: [entry], ...linkedState},
			entry,
			quantity: 1,
		})).toMatchObject({
			isEligible: false,
			blockers: expect.any(Array),
			maxQuantity: 0,
		});
	});

	it("does not invent item linkage from serialized concentration state", () => {
		const entry = {id: "stack-1", quantity: 1, item: {name: "Focus"}};
		const container = {
			inventory: [entry],
			concentrations: [{id: "spell:Bless", kind: "spell", name: "Bless", source: "PHB"}],
			concentrating: {spellName: "Bless", spellLevel: 1},
		};

		expect(getInventoryTransferEligibility({container, entry, quantity: 1})).toEqual({
			isEligible: true,
			blockers: [],
			maxQuantity: 1,
		});
	});

	it("rejects unsafe quantities and computes reusable finite weight summaries", () => {
		const entry = {id: "stack-1", quantity: 2, item: {name: "Rations", weight: 2}};
		const inventory = [
			entry,
			{id: "stack-2", quantity: 3, item: {name: "Torch", weight: 1}},
			{id: "stack-3", quantity: 2, item: {name: "Unknown"}},
		];
		const container = {inventory};

		expect(getInventoryTransferEligibility({container, entry, quantity: Number.MAX_SAFE_INTEGER + 1})).toMatchObject({
			isEligible: false,
			blockers: ["enter a whole-number quantity"],
		});
		expect(getInventoryStackWeight(entry)).toBe(4);
		expect(getInventoryWeightSummary(inventory)).toEqual({
			knownWeight: 7,
			unknownStackCount: 1,
		});
	});
});
