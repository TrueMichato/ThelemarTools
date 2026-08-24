import {
	addTransferPayload,
	applyStructuredEffect,
	normalizeCharacterInventory,
	removeTransferPayload,
} from "../../../server/src/hub-actions.js";

describe("structured effects", () => {
	it("applies damage through temporary HP and clamps healing", () => {
		const damaged = applyStructuredEffect({
			data: {hp: {current: 20, max: 20, temp: 5}},
			effect: {type: "damage", amount: 8},
		});
		expect(damaged.hp).toEqual({current: 17, max: 20, temp: 0});
		const healed = applyStructuredEffect({data: damaged, effect: {type: "healing", amount: 10}});
		expect(healed.hp.current).toBe(20);
	});

	it("adds conditions idempotently and spends slots", () => {
		let data = applyStructuredEffect({data: {conditions: []}, effect: {type: "condition_add", condition: "Prone"}});
		data = applyStructuredEffect({data, effect: {type: "condition_add", condition: "prone"}});
		expect(data.conditions).toHaveLength(1);
		expect(applyStructuredEffect({
			data: {spellcasting: {spellSlots: {1: {current: 2, max: 4}}}},
			effect: {type: "spell_slot_spend", level: 1},
		}).spellcasting.spellSlots[1].current).toBe(1);
	});
});

describe("inventory escrow", () => {
	const source = normalizeCharacterInventory({
		inventory: [{id: "arrows", item: {name: "Arrow", source: "PHB"}, quantity: 10}],
		currency: {gp: 12, sp: 3},
	});

	it("reserves partial stacks and denomination currency", () => {
		const {container, escrow} = removeTransferPayload({
			container: source,
			payload: {items: [{entryId: "arrows", quantity: 3}], currency: {gp: 5, sp: 2}},
		});
		expect(container.inventory[0].quantity).toBe(7);
		expect(container.currency).toEqual({cp: 0, sp: 1, ep: 0, gp: 7, pp: 0});
		expect(escrow.items[0].quantity).toBe(3);
	});

	it("merges compatible stacks at the destination", () => {
		const {escrow} = removeTransferPayload({
			container: source,
			payload: {items: [{entryId: "arrows", quantity: 3}], currency: {gp: 5}},
		});
		const destination = addTransferPayload({
			container: {
				inventory: [{id: "other-arrows", item: {name: "Arrow", source: "PHB"}, quantity: 2}],
				currency: {gp: 1},
			},
			escrow,
		});
		expect(destination.inventory).toHaveLength(1);
		expect(destination.inventory[0].quantity).toBe(5);
		expect(destination.currency.gp).toBe(6);
	});

	it("preserves wrapper metadata and mints a destination identity only after commit", () => {
		const original = normalizeCharacterInventory({
			inventory: [{id: "custom", item: {name: "Map", source: "HB"}, quantity: 1, note: "Secret route"}],
		});
		const {container, escrow} = removeTransferPayload({
			container: original,
			payload: {items: [{entryId: "custom", quantity: 1}]},
		});
		const restored = addTransferPayload({container, escrow, isRestore: true});
		expect(restored.inventory[0]).toEqual(expect.objectContaining({id: "custom", note: "Secret route"}));

		const committed = addTransferPayload({container: {inventory: [], currency: {}}, escrow});
		expect(committed.inventory[0]).toEqual(expect.objectContaining({note: "Secret route", equipped: false, attuned: false}));
		expect(committed.inventory[0].id).not.toBe("custom");
	});

	it("merges only metadata-compatible stacks", () => {
		const escrow = {items: [{id: "incoming", item: {name: "Map", source: "HB"}, quantity: 1, note: "Secret route"}], currency: {}};
		const destination = addTransferPayload({
			container: {inventory: [{id: "existing", item: {name: "Map", source: "HB"}, quantity: 1, note: "Public route"}], currency: {}},
			escrow,
		});
		expect(destination.inventory).toHaveLength(2);
	});

	it.each([
		["container link", data => data.inventory[1].item.containedItems.push("item")],
		["ammunition selection", data => { data.selectedAmmo = {bow: "item"}; }],
		["item effect", data => { data.namedModifiers = [{sourceFeatureId: "item:item"}]; }],
		["Ioun link", data => { data.inventory[1].item.iounSet = ["item"]; }],
		["active state", data => { data.activeStates = [{customEffects: [{inventoryItemId: "item"}]}]; }],
	])("rejects whole-item transfer while an inventory invariant is active: %s", (_label, fnMutate) => {
		const data = {
			inventory: [
				{id: "item", item: {name: "Arrow"}, quantity: 1},
				{id: "holder", item: {name: "Holder", containedItems: []}, quantity: 1},
			],
			currency: {},
		};
		fnMutate(data);
		expect(() => removeTransferPayload({container: data, payload: {items: [{entryId: "item", quantity: 1}]}}))
			.toThrow(expect.objectContaining({code: "TRANSFER_ITEM_LINKED"}));
	});

	it("rejects insufficient item or currency balances", () => {
		expect(() => removeTransferPayload({container: source, payload: {items: [{entryId: "arrows", quantity: 11}]}}))
			.toThrow(expect.objectContaining({code: "TRANSFER_INSUFFICIENT"}));
		expect(() => removeTransferPayload({container: source, payload: {currency: {pp: 1}}}))
			.toThrow(expect.objectContaining({code: "TRANSFER_INSUFFICIENT"}));
	});

	it("rejects empty transfer reservations", () => {
		expect(() => removeTransferPayload({container: source, payload: {items: [], currency: {gp: 0}}}))
			.toThrow(expect.objectContaining({code: "TRANSFER_EMPTY"}));
	});

	it.each(["Infinity", Number.POSITIVE_INFINITY, Number.NaN])("rejects non-finite inventory and currency values: %s", value => {
		expect(() => normalizeCharacterInventory({inventory: [{item: {name: "Arrow"}, quantity: value}]}))
			.toThrow(expect.objectContaining({code: "NUMERIC_INVALID"}));
		expect(() => removeTransferPayload({container: {inventory: [], currency: {gp: value}}, payload: {currency: {gp: 1}}}))
			.toThrow(expect.objectContaining({code: "NUMERIC_INVALID"}));
	});
});
