import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const State = globalThis.CharacterSheetState;
const Progression = globalThis.CharacterSheetProgression;
const Plans = globalThis.CharacterSheetArtificerPlans;
const Inventory = globalThis.CharacterSheetInventory;
const Combat = globalThis.CharacterSheetCombat;

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}
if (typeof globalThis.CharacterSheetUpgrades === "undefined") {
	globalThis.CharacterSheetUpgrades = {
		isWeapon: () => false,
		isArmor: () => false,
		isShield: () => false,
		getGemstoneDescriptor: () => null,
	};
}

const classFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-artificer.json"), "utf8"));
const artificer = classFile.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const tinkersMagicFeature = classFile.classFeature.find(feature =>
	feature.name === "Tinker's Magic"
	&& feature.className === "Artificer"
	&& feature.classSource === "EFA"
	&& feature.source === "EFA",
);
const replicateFeature = classFile.classFeature.find(feature =>
	feature.name === "Replicate Magic Item"
	&& feature.className === "Artificer"
	&& feature.classSource === "EFA"
	&& feature.source === "EFA",
);

const TINKERS_MAGIC_ITEM_UIDS = tinkersMagicFeature.entries
	.find(entry => entry?.type === "list")
	.items
	.map(entry => {
		const [, name, source] = entry.match(/\{@item ([^|}]+)\|([^|}]+)/) || [];
		return `${name}|${source}`;
	});

const PLAN_ITEMS = [
	{name: "+1 Weapon", source: "XDMG", type: "GV", rarity: "uncommon"},
	{name: "Bag of Holding", source: "XDMG", type: "W", wondrous: true, rarity: "uncommon"},
	{name: "Clockwork Trinket", source: "EFA", type: "W", wondrous: true, rarity: "common"},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true, rarity: "common"},
];

const CATALOG_ITEMS = [
	...TINKERS_MAGIC_ITEM_UIDS.map(uid => {
		const [name, source] = uid.split("|");
		return {name, source, type: name === "Net" ? "R" : "G", rarity: "none"};
	}),
	{
		name: "Longsword +1",
		source: "XDMG",
		type: "M",
		weapon: true,
		rarity: "uncommon",
		_category: "Specific Variant",
		_variantName: "+1 Weapon",
		baseItem: "longsword|xphb",
		bonusWeapon: "+1",
	},
	{
		name: "Bag of Holding",
		source: "XDMG",
		type: "W",
		wondrous: true,
		rarity: "uncommon",
		containerCapacity: {weight: [500]},
	},
	{
		name: "Clockwork Trinket",
		source: "EFA",
		type: "W",
		wondrous: true,
		rarity: "common",
		requiresAttunement: true,
		reqAttuneTags: [{class: "wizard"}],
		charges: 3,
		chargesCurrent: 3,
	},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true, rarity: "rare"},
	{name: "Tinker's Tools", source: "XPHB", type: "AT"},
];

const getPage = state => ({
	getState: () => state,
	getClasses: () => [artificer],
	getClassFeatures: () => classFile.classFeature,
	getSubclassFeatures: () => classFile.subclassFeature || [],
	getOptionalFeatures: () => [],
	getFeats: () => [],
	getSpells: () => [],
	getFilteredSpellData: () => [],
	getSkillsList: () => [],
	getItems: () => PLAN_ITEMS,
	filterByAllowedSources: values => values,
});

function buildState ({level = 6, intelligence = 18} = {}) {
	const state = new State();
	state.setAbilityBase("int", intelligence);
	state.addClass({name: "Artificer", source: "EFA", level});
	state.recordLevelChoice({
		level: 1,
		class: {name: "Artificer", source: "EFA"},
		classLevel: 1,
		choices: {},
	});
	const catalog = Plans.parseCatalog({feature: replicateFeature, items: PLAN_ITEMS});
	const candidates = new Map(Plans.getEligibleCandidates({catalog, classLevel: 2}).map(it => [it.itemUid, it]));
	const desired = ["+1 Weapon|XDMG", "Bag of Holding|XDMG", "Clockwork Trinket|EFA", "Silver Cog|TST"];
	const opportunities = Plans.getProgressionOpportunities({
		className: "Artificer",
		classSource: "EFA",
		classLevel: 2,
	}).filter(it => it.kind === "acquire");
	state.recordLevelChoice({
		level: 2,
		class: {name: "Artificer", source: "EFA"},
		classLevel: 2,
		choices: {
			artificerPlans: opportunities.map((opportunity, index) => ({
				opportunityId: opportunity.opportunityId,
				slotId: opportunity.slotId,
				acquisitionLevel: 2,
				selection: candidates.get(desired[index]),
			})),
		},
	});
	Progression.syncCanonicalDecisions({page: getPage(state), state});
	state.setItemCatalog(CATALOG_ITEMS);
	state.addToolProficiency("Tinker's Tools");
	state.addItem(CATALOG_ITEMS.find(item => item.name === "Tinker's Tools"), 1, true);
	const toolsId = state.getItems().find(item => item.name === "Tinker's Tools" && item.source === "XPHB").id;
	state.calculateSpellSlots();
	return {state, toolsId};
}

function getPlan (state, itemUid) {
	return state.getEfaArtificerPlans().find(plan => plan.selection.itemUid === itemUid);
}

function createReplica (state, itemUid, resolvedItemUid = null) {
	const plan = getPlan(state, itemUid);
	const result = state.commitEfaReplicateMagicItemsAtLongRest({
		selections: [{
			slotId: plan.slotId,
			...(resolvedItemUid ? {resolvedItemUid} : {}),
		}],
	});
	expect(result.ok).toBe(true);
	return result.created[0];
}

function makeInventory (state) {
	const page = {
		getState: () => state,
		getItemMaterials: () => [],
		getMaterialsModule: () => null,
		renderCharacter: jest.fn(),
		saveCharacter: jest.fn().mockResolvedValue(undefined),
	};
	const inventory = new Inventory(page);
	page._inventory = inventory;
	return {inventory, page};
}

describe("EFA Tinker's Magic and Magic Item Tinker transactions", () => {
	test("matches the exact published mundane-item list and keeps Mending in spell progression", () => {
		const {state} = buildState({level: 1});
		const options = state.getEfaArtificerTinkerOptions();

		expect(options.tinkersMagic.itemUids).toEqual(TINKERS_MAGIC_ITEM_UIDS);
		expect(options.tinkersMagic.itemUids).toHaveLength(31);
		expect(options.tinkersMagic.itemUids).not.toContain("Mending|XPHB");
		expect(state.getFeatureCalculations()).toMatchObject({
			hasTinkersMagic: true,
			tinkersMagicUses: 4,
		});
	});

	test("creates distinct provenance-backed mundane rows and expires them only on committed long rest", () => {
		const {state} = buildState({level: 1});
		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "tinkersMagic",
			itemUid: "Basket|XPHB",
		});
		const beforePreview = state.toJson();

		expect(preview).toMatchObject({
			ok: true,
			code: "efa-tinker-preview-ready",
			operation: "tinkersMagic",
			uses: {remaining: 4, max: 4},
		});
		expect(state.toJson()).toEqual(beforePreview);

		const first = state.commitEfaArtificerTinkerTransaction(preview.request);
		const second = state.commitEfaArtificerTinkerTransaction(preview.request);
		expect(first).toMatchObject({ok: true, code: "efa-tinker-committed"});
		expect(second).toMatchObject({ok: true, code: "efa-tinker-committed"});
		expect(first.created.itemId).not.toBe(second.created.itemId);
		expect(first.created.generatedItemId).not.toBe(second.created.generatedItemId);
		expect(state.getGeneratedFeatureItemRows(State.EFA_TINKERS_MAGIC_OWNER)).toHaveLength(2);

		const saved = state.toJson();
		const loaded = new State();
		loaded.setItemCatalog(CATALOG_ITEMS);
		loaded.loadFromJson(saved);
		expect(loaded.getEfaArtificerTinkerOptions().tinkersMagic.uses).toEqual({remaining: 2, max: 4});
		expect(loaded.getGeneratedFeatureItemRows(State.EFA_TINKERS_MAGIC_OWNER)).toHaveLength(2);

		loaded.onLongRest();
		expect(loaded.getGeneratedFeatureItemRows(State.EFA_TINKERS_MAGIC_OWNER)).toEqual([]);
		expect(loaded.getEfaArtificerTinkerOptions().tinkersMagic.uses).toEqual({remaining: 4, max: 4});
	});

	test("Tinker's Magic has a minimum-one use pool and consumes a Magic Action only in combat", () => {
		const {state} = buildState({level: 1, intelligence: 10});
		state.startCombat();
		const request = {operation: "tinkersMagic", itemUid: "Basket|XPHB"};

		expect(state.commitEfaArtificerTinkerTransaction(request).ok).toBe(true);
		expect(state.isActionTypeAvailable("action")).toBe(false);
		state.resetTurnEconomy();
		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "tinkers-magic-uses-spent",
		});

		state.onLongRest();
		state.endCombat();
		expect(state.commitEfaArtificerTinkerTransaction(request).ok).toBe(true);
		expect(state.isActionTypeAvailable("action")).toBe(true);
	});

	test("deterministically charges an exact live Replicate item by the paid slot level", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		const level2Before = state.getSpellSlotsCurrent(2);
		state.startCombat();

		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 2,
		});
		const beforePreview = state.toJson();

		expect(preview).toMatchObject({
			ok: true,
			code: "efa-tinker-preview-ready",
			operation: "charge",
			charge: {
				previous: 0,
				paidSlotLevel: 2,
				restored: 2,
				next: 2,
				max: 3,
			},
		});
		expect(state.toJson()).toEqual(beforePreview);

		const committed = state.commitEfaArtificerTinkerTransaction(preview.request);
		expect(committed).toMatchObject({
			ok: true,
			code: "efa-tinker-committed",
			charge: preview.charge,
		});
		expect(state.getItems().find(item => item.id === replica.itemId).chargesCurrent).toBe(2);
		expect(state.getSpellSlotsCurrent(2)).toBe(level2Before - 1);
		expect(state.isBonusActionAvailable()).toBe(false);
	});

	test("clamps Charge at the item maximum without invoking its random recharge formula", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		const row = state.getInventory().find(item => item.id === replica.itemId);
		row.item.chargesCurrent = 2;
		row.item.rechargeAmount = "{@dice 1d6 + 1}";
		const randomRecharge = jest.spyOn(state, "rechargeItemCharges");

		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 2,
		});
		expect(preview.charge).toMatchObject({previous: 2, restored: 1, next: 3, max: 3});

		expect(state.commitEfaArtificerTinkerTransaction(preview.request).ok).toBe(true);
		expect(row.item.chargesCurrent).toBe(3);
		expect(randomRecharge).not.toHaveBeenCalled();
	});

	test("Charge supports explicit Pact Magic slots and requires a pool choice when levels overlap", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		state.addClass({name: "Warlock", source: "XPHB", level: 1});
		state.setSpellSlotCurrent(1, 0);
		state.setPactSlots({level: 1, current: 1, max: 1});

		const pactOnly = state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
			slotPool: "pact",
		});
		expect(pactOnly).toMatchObject({
			ok: true,
			charge: {paidSlotLevel: 1, paidSlotPool: "pact", restored: 1},
		});
		expect(state.commitEfaArtificerTinkerTransaction(pactOnly.request).ok).toBe(true);
		expect(state.getPactSlots().current).toBe(0);
		expect(state.getSpellSlotsCurrent(1)).toBe(0);

		state.setItemCharges(replica.itemId, 0);
		state.setSpellSlotCurrent(1, 1);
		state.setPactSlots({level: 1, current: 1, max: 1});
		expect(state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
		})).toMatchObject({ok: false, code: "charge-slot-pool-required"});
		const ordinary = state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
			slotPool: "ordinary",
		});
		expect(ordinary).toMatchObject({ok: true, charge: {paidSlotPool: "ordinary"}});
		expect(state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
			slotPool: "pact",
		})).toMatchObject({ok: true, charge: {paidSlotPool: "pact"}});
		expect(state.commitEfaArtificerTinkerTransaction(ordinary.request).ok).toBe(true);
		expect(state.getSpellSlotsCurrent(1)).toBe(0);
		expect(state.getPactSlots().current).toBe(1);
	});

	test("a failed Charge after spending a Pact slot rolls the whole transaction back", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		state.addClass({name: "Warlock", source: "XPHB", level: 1});
		state.setSpellSlotCurrent(1, 0);
		state.setPactSlots({level: 1, current: 1, max: 1});
		const resolveTarget = state._getEfaReplicateRowForTinker.bind(state);
		jest.spyOn(state, "_getEfaReplicateRowForTinker")
			.mockImplementationOnce(resolveTarget)
			.mockReturnValueOnce({ok: false, code: "synthetic-charge-target-failure"});
		const before = state.toJson();

		expect(state.commitEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
			slotPool: "pact",
		})).toMatchObject({
			ok: false,
			code: "efa-tinker-rolled-back",
			message: "synthetic-charge-target-failure",
		});
		expect(state.toJson()).toEqual(before);
	});

	test("requires exact equipped, proficient Tinker's Tools and keeps failed creation pre-cost", () => {
		const {state, toolsId} = buildState({level: 1});
		state.startCombat();
		const request = {operation: "tinkersMagic", itemUid: "Basket|XPHB"};
		const before = state.toJson();

		state._data.toolProficiencies = [];
		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "tinkers-magic-tools-required",
		});
		expect(state.toJson()).toEqual({...before, toolProficiencies: []});
		expect(state.isActionTypeAvailable("action")).toBe(true);

		state.addToolProficiency("Tinker's Tools");
		state.unequip(toolsId);
		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "tinkers-magic-tools-required",
		});
		expect(state.isActionTypeAvailable("action")).toBe(true);

		state.equip(toolsId);
		state.getInventory().find(row => row.id === toolsId).item.source = "TST";
		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "tinkers-magic-tools-required",
		});
		expect(state.isActionTypeAvailable("action")).toBe(true);
	});

	test("keeps Charge cancellation/failure non-mutating and does not lock a Bonus Action outside combat", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		const slotBefore = state.getSpellSlotsCurrent(1);
		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "charge",
			itemId: replica.itemId,
			slotLevel: 1,
		});
		expect(preview.ok).toBe(true);
		expect(state.getItems().find(item => item.id === replica.itemId).chargesCurrent).toBe(0);
		expect(state.getSpellSlotsCurrent(1)).toBe(slotBefore);
		expect(state.isBonusActionAvailable()).toBe(true);

		state.removeItem(replica.itemId);
		expect(state.commitEfaArtificerTinkerTransaction(preview.request)).toMatchObject({
			ok: false,
			code: "missing-replicate-item",
		});
		expect(state.getSpellSlotsCurrent(1)).toBe(slotBefore);
		expect(state.isBonusActionAvailable()).toBe(true);
	});

	test.each([
		["Clockwork Trinket|EFA", "common", 1],
		["Bag of Holding|XDMG", "uncommon", 2],
		["Silver Cog|TST", "rare", 2],
	])("Drain converts a %s Replicate item into the exact temporary slot for %s rarity", (itemUid, rarity, slotLevel) => {
		const {state} = buildState();
		const replica = createReplica(state, itemUid);
		const maxBefore = state.getSpellSlotsMax(slotLevel);
		const currentBefore = state.getSpellSlotsCurrent(slotLevel);
		state.startCombat();

		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		});
		expect(preview).toMatchObject({
			ok: true,
			operation: "drain",
			drain: {rarity, slotLevel},
		});

		const committed = state.commitEfaArtificerTinkerTransaction(preview.request);
		expect(committed).toMatchObject({
			ok: true,
			code: "efa-tinker-committed",
			drain: {rarity, slotLevel},
		});
		expect(state.getItems().find(item => item.id === replica.itemId)).toBeUndefined();
		expect(state.getSpellSlotsMax(slotLevel)).toBe(maxBefore + 1);
		expect(state.getSpellSlotsCurrent(slotLevel)).toBe(currentBefore + 1);
		expect(state.getBonusSpellSlotsForLevel(slotLevel)).toBeGreaterThanOrEqual(1);
		expect(state.isBonusActionAvailable()).toBe(false);
		state.resetTurnEconomy();
		expect(state.previewEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: createReplica(state, "Clockwork Trinket|EFA").itemId,
		})).toMatchObject({ok: false, code: "drain-already-used"});
	});

	test("Drain preserves normal container spill and its temporary slot/use expire on long rest and save/load", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Bag of Holding|XDMG");
		const cargoId = "stored-gem";
		state.addItem({id: cargoId, name: "Stored Gem", source: "TST", type: "G"}, 1, false);
		expect(state.putItemInContainer(cargoId, replica.itemId)).toEqual({success: true});
		const maxBefore = state.getSpellSlotsMax(2);

		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		});
		expect(state.commitEfaArtificerTinkerTransaction(preview.request).ok).toBe(true);
		expect(state.getItems().find(item => item.id === cargoId)).toBeDefined();
		expect(state.getSpellSlotsMax(2)).toBe(maxBefore + 1);

		const loaded = new State();
		loaded.setItemCatalog(CATALOG_ITEMS);
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSpellSlotsMax(2)).toBe(maxBefore + 1);
		expect(loaded.getEfaArtificerTinkerOptions().magicItemTinker.drainAvailable).toBe(false);
		expect(loaded.toJson().efaArtificerTinker.drainSlotAvailable).toBe(true);

		loaded.onLongRest();
		expect(loaded.getSpellSlotsMax(2)).toBe(maxBefore);
		expect(loaded.getSpellSlotsCurrent(2)).toBe(maxBefore);
		expect(loaded.getBonusSpellSlotsForLevel(2)).toBe(0);
		expect(loaded.getEfaArtificerTinkerOptions().magicItemTinker.drainAvailable).toBe(true);
		expect(loaded.toJson().efaArtificerTinker.drainSlotAvailable).toBe(false);
	});

	test("Drain blocks unsupported rarity and leaves item, slot, use, and Bonus Action untouched", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.getInventory().find(row => row.id === replica.itemId).item.rarity = "very rare";
		state.startCombat();
		const before = state.toJson();

		expect(state.previewEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		})).toMatchObject({ok: false, code: "invalid-drain-rarity"});
		expect(state.toJson()).toEqual(before);
		expect(state.isBonusActionAvailable()).toBe(true);
	});

	test("Transmute atomically replaces a Replicate item from a different known plan and preserves lifecycle order", () => {
		const {state} = buildState();
		const original = createReplica(state, "Clockwork Trinket|EFA");
		const originalRow = state.getInventory().find(row => row.id === original.itemId);
		const originalClassification = state.classifyGeneratedFeatureItem(originalRow);
		const targetPlan = getPlan(state, "Bag of Holding|XDMG");
		state.startCombat();

		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "transmute",
			itemId: original.itemId,
			targetPlanSlotId: targetPlan.slotId,
			resolvedItemUid: "Bag of Holding|XDMG",
		});
		expect(preview).toMatchObject({
			ok: true,
			operation: "transmute",
			transmute: {
				fromItemUid: "Clockwork Trinket|EFA",
				toItemUid: "Bag of Holding|XDMG",
			},
		});

		const committed = state.commitEfaArtificerTinkerTransaction(preview.request);
		expect(committed).toMatchObject({
			ok: true,
			code: "efa-tinker-committed",
			operation: "transmute",
		});
		expect(state.getItems().find(item => item.id === original.itemId)).toBeUndefined();
		const replacementRow = state.getInventory().find(row => row.id === committed.transmute.itemId);
		const replacementClassification = state.classifyGeneratedFeatureItem(replacementRow);
		expect(replacementRow.item).toMatchObject({name: "Bag of Holding", source: "XDMG"});
		expect(replacementClassification.owner).toEqual(State.EFA_REPLICATE_MAGIC_ITEM_OWNER);
		expect(replacementClassification.provenance.creation).toEqual(originalClassification.provenance.creation);
		expect(replacementClassification.provenance.lifecycle).toEqual(originalClassification.provenance.lifecycle);
		expect(replacementClassification.provenance.catalog.plan.slotId).toBe(targetPlan.slotId);
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getEfaArtificerTinkerOptions().magicItemTinker.transmuteAvailable).toBe(false);

		state.onLongRest();
		state.endCombat();
		expect(state.getEfaArtificerTinkerOptions().magicItemTinker.transmuteAvailable).toBe(true);
		const reversePlan = getPlan(state, "Clockwork Trinket|EFA");
		const reverse = state.previewEfaArtificerTinkerTransaction({
			operation: "transmute",
			itemId: committed.transmute.itemId,
			targetPlanSlotId: reversePlan.slotId,
			resolvedItemUid: "Clockwork Trinket|EFA",
		});
		expect(state.commitEfaArtificerTinkerTransaction(reverse.request).ok).toBe(true);
		expect(state.isActionTypeAvailable("action")).toBe(true);
	});

	test("Transmute rejects the same plan and fully rolls back a failed replacement", () => {
		const {state} = buildState();
		const original = createReplica(state, "Clockwork Trinket|EFA");
		const samePlan = getPlan(state, "Clockwork Trinket|EFA");
		expect(state.previewEfaArtificerTinkerTransaction({
			operation: "transmute",
			itemId: original.itemId,
			targetPlanSlotId: samePlan.slotId,
			resolvedItemUid: "Clockwork Trinket|EFA",
		})).toMatchObject({ok: false, code: "transmute-same-plan"});

		const targetPlan = getPlan(state, "Bag of Holding|XDMG");
		const preview = state.previewEfaArtificerTinkerTransaction({
			operation: "transmute",
			itemId: original.itemId,
			targetPlanSlotId: targetPlan.slotId,
			resolvedItemUid: "Bag of Holding|XDMG",
		});
		state.startCombat();
		const before = state.toJson();
		const create = jest.spyOn(state, "createGeneratedFeatureItem").mockReturnValue({
			ok: false,
			code: "synthetic-create-failure",
		});

		expect(state.commitEfaArtificerTinkerTransaction(preview.request)).toMatchObject({
			ok: false,
			code: "efa-tinker-rolled-back",
		});
		expect(state.toJson()).toEqual(before);
		expect(state.getItems().find(item => item.id === original.itemId)).toBeDefined();
		expect(state.isActionTypeAvailable("action")).toBe(true);
		expect(state.getEfaArtificerTinkerOptions().magicItemTinker.transmuteAvailable).toBe(true);
		create.mockRestore();
	});

	test("Transmute attunement and capacity preflight failures preserve the original item and all costs", () => {
		const {state} = buildState();
		const original = createReplica(state, "Silver Cog|TST");
		const originalRow = state.getInventory().find(row => row.id === original.itemId);
		originalRow.item.requiresAttunement = true;
		originalRow.attuned = true;
		const targetPlan = getPlan(state, "Clockwork Trinket|EFA");
		const request = {
			operation: "transmute",
			itemId: original.itemId,
			targetPlanSlotId: targetPlan.slotId,
			resolvedItemUid: "Clockwork Trinket|EFA",
		};
		const before = state.toJson();

		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "transmute-attunement-requirements-failed",
		});
		expect(state.toJson()).toEqual(before);

		originalRow.attuned = false;
		const capacity = jest.spyOn(state, "getGeneratedFeatureItemCapacitySnapshot").mockReturnValue({
			fits: false,
			capacity: 0,
			rows: [],
		});
		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "transmute-capacity-exceeded",
		});
		expect(state.getItems().find(item => item.id === original.itemId)).toBeDefined();
		expect(state.isActionTypeAvailable("action")).toBe(true);
		capacity.mockRestore();
	});

	test("Transmute rejects an attuned slot-exempt item becoming slot-consuming at the attunement cap", () => {
		const {state} = buildState();
		state._data._classFeatureAttunementSlots = 5;
		for (let i = 0; i < 5; i++) {
			state.addItem({
				id: `attuned-control-${i}`,
				name: `Attuned Control ${i}`,
				source: "TST",
				type: "W",
				requiresAttunement: true,
			}, 1, false, true);
		}
		const original = createReplica(state, "Silver Cog|TST");
		const originalRow = state.getInventory().find(row => row.id === original.itemId);
		originalRow.item.requiresAttunement = true;
		originalRow.item.entries = ["This attunement doesn't count against the number of magic items to which you can be attuned."];
		originalRow.attuned = true;
		state.setItemCatalog(CATALOG_ITEMS.map(item =>
			item.name === "Bag of Holding" && item.source === "XDMG"
				? {...item, requiresAttunement: true}
				: item,
		));
		expect(state.getAttunedCount()).toBe(5);
		const targetPlan = getPlan(state, "Bag of Holding|XDMG");
		const request = {
			operation: "transmute",
			itemId: original.itemId,
			targetPlanSlotId: targetPlan.slotId,
			resolvedItemUid: "Bag of Holding|XDMG",
		};
		const before = state.toJson();

		expect(state.previewEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "transmute-attunement-cap-reached",
		});
		expect(state.toJson()).toEqual(before);

		state.removeItem("attuned-control-0");
		const attune = jest.spyOn(state, "attune").mockReturnValue(false);
		const beforeCommit = state.toJson();
		expect(state.commitEfaArtificerTinkerTransaction(request)).toMatchObject({
			ok: false,
			code: "efa-tinker-rolled-back",
			message: "transmute-attunement-failed",
		});
		expect(state.toJson()).toEqual(beforeCommit);
		attune.mockRestore();
	});

	test("load repair drops a forged Drain marker that has no exact-source slot modifier", () => {
		const {state} = buildState();
		const saved = state.toJson();
		saved.efaArtificerTinker = {
			version: 1,
			tinkersMagicUsesSpent: 0,
			drainUsed: true,
			transmuteUsed: false,
			drainSlotLevel: 2,
		};
		const loaded = new State();
		loaded.setItemCatalog(CATALOG_ITEMS);
		loaded.loadFromJson(saved);

		expect(loaded.toJson().efaArtificerTinker).toMatchObject({
			drainUsed: false,
			drainSlotLevel: null,
		});
		expect(loaded.getEfaArtificerTinkerOptions().magicItemTinker.drainAvailable).toBe(true);
	});

	test("load repair removes a stale Drain slot maximum when its exact modifier is missing", () => {
		const {state} = buildState();
		const baseMax = state.getSpellSlotsMax(1);
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		expect(state.commitEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		}).ok).toBe(true);
		const saved = state.toJson();
		saved.namedModifiers = saved.namedModifiers.filter(modifier =>
			modifier.sourceDecisionKey !== State.EFA_MAGIC_ITEM_TINKER_DRAIN_DECISION_KEY,
		);
		expect(saved.spellcasting.spellSlots[1]).toMatchObject({max: baseMax + 1, current: baseMax + 1});

		const loaded = new State();
		loaded.setItemCatalog(CATALOG_ITEMS);
		loaded.loadFromJson(saved);

		expect(loaded.getSpellSlotsMax(1)).toBe(baseMax);
		expect(loaded.getSpellSlotsCurrent(1)).toBe(baseMax);
		expect(loaded.getBonusSpellSlotsForLevel(1)).toBe(0);
		expect(loaded.toJson().efaArtificerTinker).toMatchObject({
			drainUsed: false,
			drainSlotLevel: null,
		});
	});

	test("removing an expended Drain slot does not consume a normal spell slot", () => {
		const {state} = buildState();
		const baseMax = state.getSpellSlotsMax(1);
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		expect(state.commitEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		}).ok).toBe(true);
		state.setSpellSlotCurrent(1, state.getSpellSlotsCurrent(1) - 1);
		expect(state.getSpellSlotsCurrent(1)).toBe(baseMax);

		state._data.classes.find(cls => cls.name === "Artificer" && cls.source === "EFA").level = 5;
		state.reconcileEfaArtificerTinker({reason: "test-level-loss"});

		expect(state.getSpellSlotsMax(1)).toBe(baseMax);
		expect(state.getSpellSlotsCurrent(1)).toBe(baseMax);
		expect(state.getBonusSpellSlotsForLevel(1)).toBe(0);
	});

	test("removing an unspent Drain slot does not refund an ordinary spell slot", () => {
		const {state} = buildState();
		state.setSpellSlotCurrent(1, 2);
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		expect(state.commitEfaArtificerTinkerTransaction({
			operation: "drain",
			itemId: replica.itemId,
		}).ok).toBe(true);
		expect(state.getSpellSlots()).toMatchObject({1: {max: 5, current: 3}});

		state._data.classes.find(cls => cls.name === "Artificer" && cls.source === "EFA").level = 5;
		state.reconcileEfaArtificerTinker({reason: "test-unspent-level-loss"});

		expect(state.getSpellSlots()).toMatchObject({1: {max: 4, current: 2}});
		expect(state.getBonusSpellSlotsForLevel(1)).toBe(0);
	});

	test("exact EFA source loss removes Tinker's creations and temporary Drain slots without claiming other owners", () => {
		const {state} = buildState();
		const tinker = state.previewEfaArtificerTinkerTransaction({
			operation: "tinkersMagic",
			itemUid: "Basket|XPHB",
		});
		expect(state.commitEfaArtificerTinkerTransaction(tinker.request).ok).toBe(true);
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		const drain = state.previewEfaArtificerTinkerTransaction({operation: "drain", itemId: replica.itemId});
		expect(state.commitEfaArtificerTinkerTransaction(drain.request).ok).toBe(true);
		const unrelated = state.createGeneratedFeatureItem({
			item: {name: "Other Basket", source: "TST", type: "G"},
			owner: {
				featureUid: "Tinker's Magic|Artificer|HB|1",
				classUid: "Artificer|HB",
				subclassUid: null,
				featureSource: "HB",
			},
		});
		const bonusBefore = state.getBonusSpellSlotsForLevel(1);
		const maxWithDrain = state.getSpellSlotsMax(1);
		expect(bonusBefore).toBe(1);
		expect(state.isBonusActionAvailable()).toBe(true);

		state.removeClass("Artificer", "EFA");

		expect(state.getGeneratedFeatureItemRows(State.EFA_TINKERS_MAGIC_OWNER)).toEqual([]);
		expect(state.getItems().find(item => item.id === unrelated.itemId)).toBeDefined();
		expect(state.getBonusSpellSlotsForLevel(1)).toBe(0);
		expect(state.getSpellSlotsMax(1)).toBe(maxWithDrain - 1);
		expect(state.toJson().efaArtificerTinker).toEqual({
			version: 1,
			tinkersMagicUsesSpent: 0,
			drainUsed: false,
			transmuteUsed: false,
			drainSlotLevel: null,
			drainSlotAvailable: false,
		});
	});

	test("renders Magic Item Tinker affordances only on exact live Replicate rows", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		const unrelated = state.createGeneratedFeatureItem({
			item: {name: "Other Trinket", source: "TST", type: "W", rarity: "common", charges: 3, chargesCurrent: 1},
			owner: {
				featureUid: "Replicate Magic Item|Artificer|HB|2",
				classUid: "Artificer|HB",
				subclassUid: null,
				featureSource: "HB",
			},
		});
		const {inventory} = makeInventory(state);

		const replicateHtml = inventory._renderItemRow(state.getItems().find(item => item.id === replica.itemId)).outerHTML;
		expect(replicateHtml).toContain("charsheet__item-efa-charge");
		expect(replicateHtml).toContain("charsheet__item-efa-drain");
		expect(replicateHtml).toContain("charsheet__item-efa-transmute");

		const unrelatedHtml = inventory._renderItemRow(state.getItems().find(item => item.id === unrelated.itemId)).outerHTML;
		expect(unrelatedHtml).not.toContain("charsheet__item-efa-charge");
		expect(unrelatedHtml).not.toContain("charsheet__item-efa-drain");
		expect(unrelatedHtml).not.toContain("charsheet__item-efa-transmute");
	});

	test("closing the shared Tinker modal is pre-cost and non-mutating", async () => {
		const {state} = buildState({level: 1});
		const {inventory, page} = makeInventory(state);
		const before = state.toJson();
		let closeModal;
		const modal = jest.spyOn(globalThis.CharacterSheetModal, "pGetShow").mockImplementation(async opts => {
			closeModal = opts.cbClose;
			return {
				eleModalInner: globalThis.e_({tag: "div"}),
				eleModalFooter: globalThis.e_({tag: "div"}),
				doClose: value => opts.cbClose(value),
			};
		});

		const pending = inventory.pShowEfaArtificerTinker({operation: "tinkersMagic"});
		await Promise.resolve();
		await Promise.resolve();
		closeModal(false);

		await expect(pending).resolves.toBeNull();
		expect(state.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
		modal.mockRestore();
	});

	test("the Charge modal distinguishes ordinary and Pact Magic slots at the same level", async () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		state.addClass({name: "Warlock", source: "XPHB", level: 1});
		state.setPactSlots({level: 1, current: 1, max: 1});
		const {inventory} = makeInventory(state);
		let closeModal;
		let modalInner;
		const modal = jest.spyOn(globalThis.CharacterSheetModal, "pGetShow").mockImplementation(async opts => {
			closeModal = opts.cbClose;
			modalInner = globalThis.e_({tag: "div"});
			return {
				eleModalInner: modalInner,
				eleModalFooter: globalThis.e_({tag: "div"}),
				doClose: value => opts.cbClose(value),
			};
		});

		const pending = inventory.pShowEfaArtificerTinker({operation: "charge", itemId: replica.itemId});
		await Promise.resolve();
		await Promise.resolve();
		const findById = (node, id) => {
			if (node?.id === id) return node;
			for (const child of node?.children || []) {
				const found = findById(child, id);
				if (found) return found;
			}
			return null;
		};
		const slotSelect = findById(modalInner, "cs-efa-tinker-charge-slot");
		expect(slotSelect.children.map(option => option.textContent)).toEqual(expect.arrayContaining([
			"Ordinary level 1 (4 available)",
			"Pact Magic level 1 (1 available)",
		]));

		closeModal(false);
		await expect(pending).resolves.toBeNull();
		modal.mockRestore();
	});

	test("one modal confirmation cannot commit twice while character save is pending", async () => {
		const {state} = buildState({level: 1});
		const {inventory, page} = makeInventory(state);
		let resolveSave;
		page.saveCharacter = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
		let modalFooter;
		const modal = jest.spyOn(globalThis.CharacterSheetModal, "pGetShow").mockImplementation(async opts => {
			modalFooter = globalThis.e_({tag: "div"});
			return {
				eleModalInner: globalThis.e_({tag: "div"}),
				eleModalFooter: modalFooter,
				doClose: value => opts.cbClose(value),
			};
		});

		const pending = inventory.pShowEfaArtificerTinker({operation: "tinkersMagic"});
		await Promise.resolve();
		await Promise.resolve();
		const confirm = modalFooter.children.find(child => child.textContent === "Create Item");
		confirm.click();
		confirm.click();

		expect(state.getGeneratedFeatureItemRows(State.EFA_TINKERS_MAGIC_OWNER)).toHaveLength(1);
		expect(state.getEfaArtificerTinkerOptions().tinkersMagic.uses).toEqual({remaining: 3, max: 4});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		resolveSave();
		await pending;
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		modal.mockRestore();
	});

	test("renders all four EFA operations on the Combat Actions surface through the shared inventory workflow", () => {
		const {state} = buildState();
		const replica = createReplica(state, "Clockwork Trinket|EFA");
		state.setItemCharges(replica.itemId, 0);
		const openTinker = jest.fn();
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		combat._page = {_inventory: {pShowEfaArtificerTinker: openTinker}};
		const container = globalThis.e_({tag: "div"});

		expect(combat._renderEfaArtificerTinkerActions(container)).toBe(4);
		expect(container.outerHTML).toContain("Tinker's Magic");
		expect(container.outerHTML).toContain("Charge Magic Item");
		expect(container.outerHTML).toContain("Drain Magic Item");
		expect(container.outerHTML).toContain("Transmute Magic Item");
	});
});
