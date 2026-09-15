import {
	addTransferPayload,
	applySemanticOperation,
	applyStructuredEffect,
	isDirectTransferAuthority,
	normalizeCharacterInventory,
	normalizeSemanticOperation,
	removeTransferPayload,
} from "../../../server/src/hub-actions.js";
import {
	getInventoryTransferEligibility,
	getInventoryWeightSummary,
} from "../../../js/hub/hub-inventory-contract.js";

describe("transfer authority", () => {
	it("derives direct commits only from trusted DM roles or same-owner player characters", () => {
		expect(isDirectTransferAuthority({
			role: "dm",
			accountId: "dm",
			sourceKind: "party_inventory",
			targetKind: "character",
			targetOwnerAccountId: "player",
		})).toBe(true);
		expect(isDirectTransferAuthority({
			role: "co_dm",
			accountId: "co-dm",
			sourceKind: "character",
			targetKind: "party_inventory",
			targetOwnerAccountId: null,
		})).toBe(true);
		expect(isDirectTransferAuthority({
			role: "player",
			accountId: "player",
			sourceKind: "character",
			targetKind: "character",
			targetOwnerAccountId: "player",
		})).toBe(true);
		for (const candidate of [
			{role: "player", sourceKind: "character", targetKind: "character", targetOwnerAccountId: "peer"},
			{role: "player", sourceKind: "character", targetKind: "party_inventory", targetOwnerAccountId: null},
			{role: "player", sourceKind: "party_inventory", targetKind: "character", targetOwnerAccountId: "player"},
			{role: "spectator", sourceKind: "character", targetKind: "character", targetOwnerAccountId: "player"},
		]) {
			expect(isDirectTransferAuthority({accountId: "player", ...candidate})).toBe(false);
		}
	});
});

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

	it("refuses to heal a character with no usable maximum instead of zeroing it", () => {
		expect(() => applyStructuredEffect({
			data: {hp: {current: 25, max: 0, temp: 0}},
			effect: {type: "healing", amount: 10},
		})).toThrow(expect.objectContaining({code: "HP_MAX_UNAVAILABLE"}));
	});

	it("clamps healing to the applicable maximum and never lowers hit points", () => {
		expect(applyStructuredEffect({
			data: {hp: {current: 10, max: 44, temp: 0, effectiveMax: 54}},
			effect: {type: "healing", amount: 100},
		}).hp.current).toBe(54);
		expect(applyStructuredEffect({
			data: {hp: {current: 30, max: 40, temp: 0, effectiveMax: 20}},
			effect: {type: "healing", amount: 5},
		}).hp.current).toBe(30);
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

describe("semantic operations", () => {
	const getOperation = (kind, args) => ({
		operationId: "00000000-0000-4000-8000-000000000001",
		targetCharacterId: "00000000-0000-4000-8000-000000000002",
		kind,
		version: 1,
		arguments: args,
	});

	it("normalizes the closed version-1 catalog and rejects ambiguous inputs", () => {
		expect(normalizeSemanticOperation(getOperation("hp.heal", {amount: 2}))).toEqual(getOperation("hp.heal", {amount: 2}));
		for (const operation of [
			getOperation("custom", {}),
			{...getOperation("hp.heal", {amount: 1}), version: 2},
			getOperation("hp.heal", {amount: 0}),
			getOperation("hp.damage", {amount: Number.POSITIVE_INFINITY}),
			getOperation("condition.add", {condition: {name: "Prone"}}),
			getOperation("spell_slot.spend", {level: 0, amount: 1}),
			getOperation("spell_slot.restore", {level: 1, amount: 1.5}),
		]) expect(() => normalizeSemanticOperation(operation)).toThrow();
	});

	it("applies every operation deterministically without mutating its input", () => {
		const original = {
			hp: {current: 10, max: 20, temp: 3},
			conditions: [{name: "Prone", source: "PHB"}],
			spellcasting: {spellSlots: {1: {current: 2, max: 4}}},
		};
		let data = applySemanticOperation({data: original, operation: getOperation("hp.damage", {amount: 5})});
		expect(data.hp).toEqual({current: 8, max: 20, temp: 0});
		data = applySemanticOperation({data, operation: getOperation("hp.heal", {amount: 50})});
		expect(data.hp.current).toBe(20);
		data = applySemanticOperation({data, operation: getOperation("condition.add", {condition: {name: "Poisoned", source: "PHB"}})});
		data = applySemanticOperation({data, operation: getOperation("condition.add", {condition: {name: "poisoned", source: "phb"}})});
		expect(data.conditions).toHaveLength(2);
		data = applySemanticOperation({data, operation: getOperation("condition.remove", {condition: {name: "PRONE", source: "phb"}})});
		expect(data.conditions).toEqual([{name: "Poisoned", source: "PHB"}]);
		data = applySemanticOperation({data, operation: getOperation("spell_slot.spend", {level: 1, amount: 2})});
		expect(data.spellcasting.spellSlots[1].current).toBe(0);
		data = applySemanticOperation({data, operation: getOperation("spell_slot.restore", {level: 1, amount: 10})});
		expect(data.spellcasting.spellSlots[1].current).toBe(4);
		expect(original).toEqual({
			hp: {current: 10, max: 20, temp: 3},
			conditions: [{name: "Prone", source: "PHB"}],
			spellcasting: {spellSlots: {1: {current: 2, max: 4}}},
		});
	});

	it("fails closed on missing state and insufficient resources", () => {
		expect(() => applySemanticOperation({data: {}, operation: getOperation("hp.heal", {amount: 1})})).toThrow();
		expect(() => applySemanticOperation({
			data: {spellcasting: {spellSlots: {1: {current: 0, max: 1}}}},
			operation: getOperation("spell_slot.spend", {level: 1, amount: 1}),
		})).toThrow();
	});

	it("clamps a heal to the applicable maximum, not the stored base maximum", () => {
		// `hp.max` is the sheet's base cache; item max-HP effects and strain live only in
		// `effectiveMax`. Clamping to the base would silently under-apply the heal.
		const data = applySemanticOperation({
			data: {hp: {current: 10, max: 44, temp: 0, effectiveMax: 54}},
			operation: getOperation("hp.heal", {amount: 100}),
		});

		expect(data.hp.current).toBe(54);
	});

	it("refuses to heal a character whose document has no usable maximum", () => {
		// The regression: a save written before the maximum was recalculated serialized
		// `max: 0`, and `Math.min(0, ...)` turned a heal into "set hit points to zero".
		const original = {hp: {current: 25, max: 0, temp: 0}};

		expect(() => applySemanticOperation({
			data: original,
			operation: getOperation("hp.heal", {amount: 10}),
		})).toThrow(expect.objectContaining({code: "HP_MAX_UNAVAILABLE", status: 409}));
		expect(original).toEqual({hp: {current: 25, max: 0, temp: 0}});
	});

	it("never lowers hit points when the current total exceeds the applicable maximum", () => {
		const data = applySemanticOperation({
			data: {hp: {current: 30, max: 40, temp: 0, effectiveMax: 20}},
			operation: getOperation("hp.heal", {amount: 5}),
		});

		expect(data.hp.current).toBe(30);
	});

	it("changes only current hit points when the maximum inputs are unchanged", () => {
		const original = {hp: {current: 10, max: 44, temp: 3, effectiveMax: 54}};

		const data = applySemanticOperation({data: original, operation: getOperation("hp.heal", {amount: 6})});

		expect(data.hp).toEqual({...original.hp, current: 16});
	});

	it("carries effectiveMax through every operation without recomputing it", () => {
		// A stale-looking value must survive byte-for-byte: the applicator is not allowed to
		// derive it, so no operation may add, drop, or "correct" it.
		const hp = {current: 10, max: 44, temp: 4, effectiveMax: 54};
		let data = {hp, conditions: [], spellcasting: {spellSlots: {1: {current: 1, max: 2}}}};
		for (const operation of [
			getOperation("hp.damage", {amount: 6}),
			getOperation("hp.heal", {amount: 3}),
			getOperation("condition.add", {condition: {name: "Prone", source: "PHB"}}),
			getOperation("condition.remove", {condition: {name: "Prone", source: "PHB"}}),
			getOperation("spell_slot.spend", {level: 1, amount: 1}),
			getOperation("spell_slot.restore", {level: 1, amount: 1}),
		]) {
			data = applySemanticOperation({data, operation});
			expect(data.hp.effectiveMax).toBe(54);
			expect(data.hp.max).toBe(44);
		}
	});

	it("matches legacy source-less conditions against their XPHB identity", () => {
		const original = {conditions: ["Prone", {name: "Poisoned"}]};
		let data = applySemanticOperation({
			data: original,
			operation: getOperation("condition.add", {condition: {name: "prone", source: "XPHB"}}),
		});
		expect(data.conditions).toEqual(original.conditions);
		data = applySemanticOperation({
			data,
			operation: getOperation("condition.remove", {condition: {name: "PRONE", source: "xphb"}}),
		});
		expect(data.conditions).toEqual([{name: "Poisoned"}]);
		expect(original).toEqual({conditions: ["Prone", {name: "Poisoned"}]});
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

	it("refuses partial stacks whose structural links cannot be partitioned", () => {
		const linked = normalizeCharacterInventory({
			inventory: [{
				id: "quivers",
				item: {name: "Quiver", containedItems: ["private-arrow-id"]},
				quantity: 2,
			}],
			currency: {},
		});

		expect(() => removeTransferPayload({
			container: linked,
			payload: {items: [{entryId: "quivers", quantity: 1}]},
		})).toThrow(expect.objectContaining({
			code: "TRANSFER_ITEM_LINKED",
			details: {entryId: "quivers", blockers: ["contains items"]},
		}));
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

	it("merges restored same-ID stacks across deterministic Character Sheet aliases", () => {
		const restored = addTransferPayload({
			container: {
				inventory: [{
					id: "blade",
					item: {
						name: "Longsword",
						source: "PHB",
						type: "M",
						typeCode: "M",
						property: ["V"],
						properties: ["V"],
						weaponCategory: "martial",
						weapon: true,
						charges: 5,
						chargesCurrent: 5,
						appliedUpgrades: [],
						socketedGemstones: [],
					},
					quantity: 2,
				}],
				currency: {},
			},
			escrow: {
				items: [{
					id: "blade",
					item: {
						name: "Longsword",
						source: "PHB",
						type: "M",
						property: ["V"],
						weaponCategory: "martial",
						charges: 5,
					},
					quantity: 2,
					_sourceIndex: 0,
				}],
				currency: {},
			},
			isRestore: true,
		});

		expect(restored.inventory).toEqual([
			expect.objectContaining({id: "blade", quantity: 4}),
		]);
	});

	it("restores multiple whole stacks to their exact original order", () => {
		const original = normalizeCharacterInventory({
			inventory: [
				{id: "first", item: {name: "First"}, quantity: 1},
				{id: "second", item: {name: "Second"}, quantity: 1},
				{id: "third", item: {name: "Third"}, quantity: 1},
			],
		});
		const {container, escrow} = removeTransferPayload({
			container: original,
			payload: {
				items: [
					{entryId: "second", quantity: 1},
					{entryId: "first", quantity: 1},
				],
			},
		});

		const restored = addTransferPayload({container, escrow, isRestore: true});

		expect(restored.inventory.map(entry => entry.id)).toEqual(["first", "second", "third"]);
	});

	it("restores escrow beside a metadata-diverged same-ID stack without discarding either identity", () => {
		const originalItem = {
			name: "Arrow",
			source: "PHB",
			_fromPack: "Wayfarer's Kit|PHB",
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
			charges: 7,
			chargesCurrent: 5,
			material: {name: "Dragonbone", source: "PHB", role: "strikingSurface"},
			appliedUpgrades: [{name: "Balanced", source: "PHB"}],
			socketedGemstones: [{name: "Journey", source: "PHB"}],
			custom: {maker: "Rook", batch: "original"},
		};
		const originalWrapper = {note: "Original commission", customState: {privacy: "owner-only"}};
		const {container, escrow} = removeTransferPayload({
			container: {
				inventory: [
					{id: "before", item: {name: "Before"}, quantity: 1},
					{id: "starblade", item: originalItem, quantity: 4, ...originalWrapper},
					{id: "after", item: {name: "After"}, quantity: 1},
				],
				currency: {},
			},
			payload: {items: [{entryId: "starblade", quantity: 2}]},
		});
		const modifiedItem = {
			...structuredClone(originalItem),
			_fromPack: "Reforged Kit|PHB",
			effects: [{type: "skillBonus", skill: "arcana", value: 2}],
			chargesCurrent: 1,
			material: {name: "Star Iron", source: "PHB", role: "strikingSurface"},
			appliedUpgrades: [{name: "Keen", source: "PHB"}],
			socketedGemstones: [{name: "Ember", source: "PHB"}],
			custom: {maker: "Vale", batch: "modified"},
		};
		container.inventory[1] = {
			...container.inventory[1],
			item: modifiedItem,
			note: "Reworked commission",
			customState: {privacy: "shared"},
		};

		const restored = addTransferPayload({container, escrow, isRestore: true});
		const modified = restored.inventory.find(entry => entry.id === "starblade");
		const original = restored.inventory.find(entry => entry.item.custom?.batch === "original");
		const restoredId = original?.id;

		expect(restored.inventory.map(entry => entry.id)).toEqual(["before", restoredId, "starblade", "after"]);
		expect(new Set(restored.inventory.map(entry => entry.id)).size).toBe(restored.inventory.length);
		expect(modified).toEqual(expect.objectContaining({
			item: modifiedItem,
			quantity: 2,
			note: "Reworked commission",
			customState: {privacy: "shared"},
		}));
		expect(original).toEqual(expect.objectContaining({
			item: originalItem,
			quantity: 2,
			note: "Original commission",
			customState: {privacy: "owner-only"},
		}));
		expect(restoredId).not.toBe("starblade");
		expect(modified.quantity + original.quantity).toBe(4);
	});

	it("keeps multiple metadata-diverged partial restores adjacent to their remaining source rows", () => {
		const {container, escrow} = removeTransferPayload({
			container: {
				inventory: [
					{id: "before", item: {name: "Before"}, quantity: 1},
					{id: "first", item: {name: "Arrow", custom: {version: "first-original"}}, quantity: 4},
					{id: "second", item: {name: "Bolt", custom: {version: "second-original"}}, quantity: 6},
					{id: "after", item: {name: "After"}, quantity: 1},
				],
				currency: {},
			},
			payload: {
				items: [
					{entryId: "first", quantity: 2},
					{entryId: "second", quantity: 3},
				],
			},
		});
		container.inventory.find(entry => entry.id === "first").item.custom.version = "first-modified";
		container.inventory.find(entry => entry.id === "second").item.custom.version = "second-modified";

		const restored = addTransferPayload({container, escrow, isRestore: true});

		expect(restored.inventory.map(entry => entry.item.custom?.version || entry.id)).toEqual([
			"before",
			"first-original",
			"first-modified",
			"second-original",
			"second-modified",
			"after",
		]);
		expect(new Set(restored.inventory.map(entry => entry.id)).size).toBe(restored.inventory.length);
		expect(restored.inventory
			.filter(entry => ["Arrow", "Bolt"].includes(entry.item.name))
			.reduce((total, entry) => total + entry.quantity, 0)).toBe(10);
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
		["granted spell", data => { data.itemGrantedSpells = [{itemId: "item", name: "Light"}]; }],
		["Ioun bond", data => { data.iounBonds = {item: 3}; }],
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

	it("does not infer an item link from real or legacy concentration records", () => {
		const {container, escrow} = removeTransferPayload({
			container: {
				inventory: [{id: "item", item: {name: "Focus"}, quantity: 1}],
				currency: {},
				concentrations: [{id: "spell:Bless", kind: "spell", name: "Bless", source: "PHB"}],
				concentrating: {spellName: "Bless", spellLevel: 1},
			},
			payload: {items: [{entryId: "item", quantity: 1}]},
		});

		expect(container.inventory).toEqual([]);
		expect(escrow.items).toEqual([expect.objectContaining({id: "item", quantity: 1})]);
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

	it("allows existing fractional stacks without allowing fractional transfer requests", () => {
		expect(normalizeCharacterInventory({inventory: [{item: {name: "Flour"}, quantity: 0.6667}]}).inventory[0].quantity)
			.toBe(0.6667);
		expect(() => removeTransferPayload({container: source, payload: {items: [{entryId: "arrows", quantity: 1.5}]}}))
			.toThrow(expect.objectContaining({code: "NUMERIC_INVALID"}));
	});

	it("rejects quantities outside the safe numeric range", () => {
		const quantity = Number.MAX_SAFE_INTEGER + 1;
		expect(() => normalizeCharacterInventory({inventory: [{item: {name: "Arrow"}, quantity}]}))
			.toThrow(expect.objectContaining({code: "NUMERIC_INVALID"}));
		expect(() => removeTransferPayload({container: source, payload: {items: [{entryId: "arrows", quantity}]}}))
			.toThrow(expect.objectContaining({code: "NUMERIC_INVALID"}));
	});

	it("shares server eligibility reasons without exposing inventory identities", () => {
		const container = {
			inventory: [{id: "secret-entry-id", item: {name: "Arrow"}, quantity: 3, equipped: true}],
			currency: {},
		};
		expect(getInventoryTransferEligibility({container, entry: container.inventory[0], quantity: 2})).toEqual({
			isEligible: true,
			blockers: [],
			maxQuantity: 3,
		});
		const whole = getInventoryTransferEligibility({container, entry: container.inventory[0], quantity: 3});
		expect(whole).toEqual({isEligible: false, blockers: ["equipped"], maxQuantity: 2});
		expect(JSON.stringify(whole)).not.toContain("secret-entry-id");
	});

	it("reports exact known inventory weight and unknown stacks separately", () => {
		expect(getInventoryWeightSummary([
			{item: {weight: 0.05}, quantity: 20},
			{item: {weight: 2}, quantity: 3},
			{item: {}, quantity: 1},
		])).toEqual({knownWeight: 7, unknownStackCount: 1});
	});
});
