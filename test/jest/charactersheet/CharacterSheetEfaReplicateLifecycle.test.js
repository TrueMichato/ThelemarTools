import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const State = globalThis.CharacterSheetState;
const Progression = globalThis.CharacterSheetProgression;
const Plans = globalThis.CharacterSheetArtificerPlans;

const classFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-artificer.json"), "utf8"));
const artificer = classFile.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");

const PLAN_ITEMS = [
	{name: "+1 Weapon", source: "XDMG", type: "GV", rarity: "uncommon"},
	{name: "Bag of Holding", source: "XDMG", type: "W", wondrous: true, rarity: "uncommon"},
	{name: "Clockwork Trinket", source: "EFA", type: "W", wondrous: true, rarity: "common"},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true, rarity: "common"},
];

const ENHANCED_ITEMS = [
	{
		name: "Longsword +1",
		source: "XDMG",
		type: "M",
		weapon: true,
		_category: "Specific Variant",
		_variantName: "+1 Weapon",
		baseItem: "longsword|xphb",
		bonusWeapon: "+1",
	},
	{
		name: "Battleaxe +1",
		source: "XDMG",
		type: "M",
		weapon: true,
		_category: "Specific Variant",
		_variantName: "+1 Weapon",
		baseItem: "battleaxe|xphb",
		bonusWeapon: "+1",
	},
	{
		name: "Bag of Holding",
		source: "XDMG",
		type: "W",
		wondrous: true,
		containerCapacity: {weight: [500]},
		requiresAttunement: true,
	},
	{
		name: "Clockwork Trinket",
		source: "EFA",
		type: "W",
		wondrous: true,
		requiresAttunement: true,
		reqAttuneTags: [{class: "wizard"}],
		charges: 3,
		chargesCurrent: 3,
	},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true},
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

function buildState ({level = 2} = {}) {
	const state = new State();
	state.addClass({name: "Artificer", source: "EFA", level});
	state.recordLevelChoice({
		level: 1,
		class: {name: "Artificer", source: "EFA"},
		classLevel: 1,
		choices: {},
	});
	const feature = classFile.classFeature.find(it =>
		it.name === "Replicate Magic Item"
		&& it.className === "Artificer"
		&& it.classSource === "EFA"
		&& it.source === "EFA",
	);
	const catalog = Plans.parseCatalog({feature, items: PLAN_ITEMS});
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
	state.setItemCatalog(ENHANCED_ITEMS);
	const toolsId = state.addItem(ENHANCED_ITEMS.find(item => item.name === "Tinker's Tools"), 1, true);
	return {state, toolsId};
}

function getSlot (state, itemUid) {
	return state.getEfaArtificerPlans().find(plan => plan.selection.itemUid === itemUid);
}

describe("EFA Replicate Magic Item lifecycle", () => {
	test("resolves direct plans exactly and requires a specific enhanced item for a generic-variant plan", () => {
		const {state} = buildState();
		const options = state.getEfaReplicateMagicItemProductionOptions();
		const bag = options.plans.find(plan => plan.plan.selection.itemUid === "Bag of Holding|XDMG");
		const weapon = options.plans.find(plan => plan.plan.selection.itemUid === "+1 Weapon|XDMG");

		expect(options).toMatchObject({available: true, maxCreatedItems: 2});
		expect(bag).toMatchObject({
			ok: true,
			code: "resolved-plan-item",
			options: [{itemUid: "Bag of Holding|XDMG"}],
		});
		expect(weapon).toMatchObject({
			ok: true,
			code: "specific-variant-selection-required",
		});
		expect(weapon.options.map(option => option.itemUid)).toEqual([
			"Battleaxe +1|XDMG",
			"Longsword +1|XDMG",
		]);

		const before = state.toJson().inventory;
		expect(state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [{slotId: weapon.plan.slotId}],
		})).toMatchObject({ok: false, code: "ambiguous-resolved-catalog-item"});
		expect(state.toJson().inventory).toEqual(before);

		state.setItemCatalog([
			...ENHANCED_ITEMS,
			{...ENHANCED_ITEMS.find(item => item.name === "Bag of Holding")},
		]);
		expect(state.getEfaReplicateMagicItemProductionOptions().plans
			.find(plan => plan.plan.selection.itemUid === "Bag of Holding|XDMG")).toMatchObject({
			ok: false,
			code: "ambiguous-plan-catalog-item",
		});
	});

	test("atomically creates distinct provenance-backed rows and records exact plan and resolved catalog identities", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const weapon = getSlot(state, "+1 Weapon|XDMG");
		const result = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId},
				{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			code: "replicate-production-committed",
			created: [
				{plan: {itemUid: "Bag of Holding|XDMG"}, resolvedItem: {itemUid: "Bag of Holding|XDMG"}},
				{plan: {itemUid: "+1 Weapon|XDMG"}, resolvedItem: {itemUid: "Longsword +1|XDMG"}},
			],
		});
		const rows = state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER);
		expect(rows).toHaveLength(2);
		expect(rows.map(row => row.quantity)).toEqual([1, 1]);
		expect(new Set(rows.map(row => row.id)).size).toBe(2);
		expect(new Set(rows.map(row => row.item._generatedItemId)).size).toBe(2);
		expect(rows.map(row => row.item._generatedItemProvenance.creation.order)).toEqual([1, 2]);
		expect(rows[1].item).toMatchObject({
			_variantName: "+1 Weapon",
			baseItem: "longsword|xphb",
			bonusWeapon: "+1",
		});
		expect(rows[1].item._generatedItemProvenance).toMatchObject({
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			catalog: {
				plan: {
					slotId: weapon.slotId,
					selection: {itemUid: "+1 Weapon|XDMG"},
				},
				resolvedItem: {
					itemUid: "Longsword +1|XDMG",
					variantName: "+1 Weapon",
					baseItem: "longsword|xphb",
				},
			},
			lifecycle: {
				state: "active",
				callbacks: {
					onLongRest: "retain",
					onDeath: "expire-after-1d4-days",
				},
			},
		});
	});

	test("rejects duplicate plan use before mutation and evicts the oldest exact-owner rows on later production", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const weapon = getSlot(state, "+1 Weapon|XDMG");

		const before = state.toJson().inventory;
		expect(state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId},
				{slotId: bag.slotId},
			],
		})).toMatchObject({ok: false, code: "duplicate-replicate-plan"});
		expect(state.toJson().inventory).toEqual(before);

		const first = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId},
				{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"},
			],
		});
		const second = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId},
				{slotId: weapon.slotId, resolvedItemUid: "Battleaxe +1|XDMG"},
			],
		});

		expect(second).toMatchObject({
			ok: true,
			evicted: [
				{itemId: first.created[0].itemId},
				{itemId: first.created[1].itemId},
			],
		});
		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)
			.map(row => row.item._generatedItemProvenance.creation.order)).toEqual([3, 4]);
	});

	test("maximizes overlapping extension capacity independently of descriptor order", () => {
		const {state} = buildState();
		const owner = State.EFA_REPLICATE_MAGIC_ITEM_OWNER;
		const make = item => state.createGeneratedFeatureItem({
			item,
			owner,
			lifecycle: {
				version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
				state: "active",
				deathExpiryDaysRemaining: null,
				deathExpiryAssignedReceiptId: null,
				callbacks: {},
				metadata: {},
			},
		});
		make({name: "First Armor", source: "TST", type: "HA"});
		make({name: "Second Wand", source: "TST", type: "WD"});
		make({name: "Third Wand", source: "TST", type: "WD"});
		make({name: "Fourth Wand", source: "TST", type: "WD"});
		const broad = {
			id: "broad-armor-or-wand-capacity-proof",
			owner,
			capacity: 1,
			allowedOwners: [owner],
			allowedItemKinds: ["armor", "wand"],
			categoryPredicate: {itemKinds: ["armor", "wand"]},
			generatedPredicate: {featureUid: owner.featureUid},
			lifecycleCallbacks: {onOwnerRemoved: "remove"},
			metadata: {proofOnly: true, consumerRegistered: false},
		};
		const armorOnly = {
			id: "armorer-level-9-armor-capacity-proof",
			owner,
			capacity: 1,
			allowedOwners: [owner],
			allowedItemKinds: ["armor"],
			categoryPredicate: {itemKinds: ["armor"]},
			generatedPredicate: {featureUid: owner.featureUid},
			lifecycleCallbacks: {onOwnerRemoved: "remove"},
			metadata: {proofOnly: true, consumerRegistered: false},
		};

		for (const extensions of [[broad, armorOnly], [armorOnly, broad]]) {
			const descriptors = state.getEfaReplicateMagicItemLifecycleDescriptors({extensions});
			expect(state.getGeneratedFeatureItemCapacitySnapshot({owner, descriptors})).toMatchObject({
				fits: true,
				baseCapacity: 2,
				extensionCapacityUsed: 2,
				capacity: 4,
			});
		}
	});

	test("attunes when legal, reports refusal without cancelling creation, and preserves ordinary item mechanics", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const trinket = getSlot(state, "Clockwork Trinket|EFA");
		const result = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId, attune: true},
				{slotId: trinket.slotId, attune: true},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			attunement: [
				{status: "attuned"},
				{status: "requirements-failed", reasons: expect.arrayContaining([expect.stringMatching(/Wizard/i)])},
			],
		});
		const bagRow = state.getInventory().find(row => row.id === result.created[0].itemId);
		const trinketRow = state.getInventory().find(row => row.id === result.created[1].itemId);
		expect(bagRow).toMatchObject({attuned: true, item: {containerCapacity: {weight: [500]}}});
		expect(trinketRow).toMatchObject({
			attuned: false,
			item: {
				requiresAttunement: true,
				reqAttuneTags: [{class: "wizard"}],
				charges: 3,
				chargesCurrent: 3,
			},
		});
	});

	test("uses slot-consuming attunement count and never charges exempt created items against the cap", () => {
		const {state} = buildState();
		const exemptionText = "This attunement doesn't count against the number of magic items to which you can normally be attuned.";
		state.addItem({name: "First Normal Attunement", source: "TST", type: "W", requiresAttunement: true}, 1, false, true);
		state.addItem({name: "Second Normal Attunement", source: "TST", type: "W", requiresAttunement: true}, 1, false, true);
		state.addItem({
			name: "Existing Exempt Attunement",
			source: "TST",
			type: "W",
			requiresAttunement: true,
			entries: [exemptionText],
		}, 1, false, true);
		state.setItemCatalog([
			...ENHANCED_ITEMS.filter(item => item.name !== "Silver Cog"),
			{
				name: "Silver Cog",
				source: "TST",
				type: "W",
				wondrous: true,
				requiresAttunement: true,
				entries: [exemptionText],
			},
		]);

		expect(state.getAttunedItems()).toHaveLength(3);
		expect(state.getAttunedCount()).toBe(2);
		const result = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: getSlot(state, "Bag of Holding|XDMG").slotId, attune: true},
				{slotId: getSlot(state, "Silver Cog|TST").slotId, attune: true},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			attunement: [
				{status: "attuned"},
				{status: "attuned"},
			],
		});
		expect(state.getAttunedItems()).toHaveLength(5);
		expect(state.getAttunedCount()).toBe(3);
		expect(state.getInventory().find(row => row.id === result.created[1].itemId)?.attuned).toBe(true);
	});

	test("uses normal container removal semantics so oldest-item eviction spills contents instead of deleting them", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const weapon = getSlot(state, "+1 Weapon|XDMG");
		const first = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [{slotId: bag.slotId}],
		});
		const cargoId = "stored-gem";
		state.addItem({id: cargoId, name: "Stored Gem", source: "TST", type: "G", weight: 1});
		expect(state.putItemInContainer(cargoId, first.created[0].itemId)).toEqual({success: true});

		state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"},
				{slotId: getSlot(state, "Silver Cog|TST").slotId},
			],
		});

		expect(state.getInventory().find(row => row.id === first.created[0].itemId)).toBeUndefined();
		expect(state.getInventory().find(row => row.id === cargoId)).toBeDefined();
		expect(state.getItemContainer(cargoId)).toBeNull();
	});

	test("cleans exact-owner rows on committed plan lineage and class-source loss without touching another owner", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const weapon = getSlot(state, "+1 Weapon|XDMG");
		const created = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId},
				{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"},
			],
		});
		const otherOwner = {
			featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|RHW|3|EFA",
			classUid: "Artificer|EFA",
			subclassUid: "Alchemist|Artificer|EFA|RHW",
			featureSource: "EFA",
		};
		const other = state.createGeneratedFeatureItem({
			item: {name: "Other Generated Item", source: "TST", type: "W"},
			owner: otherOwner,
		});
		const wrongFeatureSourceOwner = {
			featureUid: "Replicate Magic Item|Artificer|EFA|2",
			classUid: "Artificer|EFA",
			subclassUid: null,
			featureSource: "HB",
		};
		const wrongFeatureSource = state.createGeneratedFeatureItem({
			item: {name: "Wrong-source Replica", source: "TST", type: "W"},
			owner: wrongFeatureSourceOwner,
		});

		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)
			.map(row => row.id)).toEqual(created.created.map(row => row.itemId));
		expect(state.commitGeneratedFeatureItemPlanLineage({
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			removedPlan: bag.selection,
			slotId: bag.slotId,
		})).toEqual([created.created[0].itemId]);
		expect(state.getInventory().find(row => row.id === created.created[0].itemId)).toBeUndefined();
		expect(state.getInventory().find(row => row.id === created.created[1].itemId)).toBeDefined();
		expect(state.getInventory().find(row => row.id === other.itemId)).toBeDefined();
		expect(state.getInventory().find(row => row.id === wrongFeatureSource.itemId)).toBeDefined();

		state.removeClass("Artificer", "EFA");
		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)).toEqual([]);
		expect(state.getInventory().find(row => row.id === other.itemId)).toBeDefined();
		expect(state.getInventory().find(row => row.id === wrongFeatureSource.itemId)).toBeDefined();
	});

	test("round-trips provenance, order, attunement, specific variants, containers, and repair state without silently dropping rows", () => {
		const {state} = buildState();
		const bag = getSlot(state, "Bag of Holding|XDMG");
		const weapon = getSlot(state, "+1 Weapon|XDMG");
		const created = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				{slotId: bag.slotId, attune: true},
				{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"},
			],
		});
		const cargoId = "stored-gem";
		state.addItem({id: cargoId, name: "Stored Gem", source: "TST", type: "G", weight: 1});
		state.putItemInContainer(cargoId, created.created[0].itemId);

		const loaded = new State();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		loaded.setItemCatalog(ENHANCED_ITEMS.filter(item => item.name !== "Longsword +1"));
		const loadedRows = loaded.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER);
		expect(loadedRows).toHaveLength(2);
		expect(loadedRows.map(row => row.item._generatedItemProvenance.creation.order)).toEqual([1, 2]);
		expect(loadedRows[0]).toMatchObject({
			attuned: true,
			item: {containedItems: [cargoId]},
		});
		expect(loadedRows[1]).toMatchObject({
			item: {
				_variantName: "+1 Weapon",
				baseItem: "longsword|xphb",
				_generatedItemProvenance: {
					catalog: {
						plan: {selection: {itemUid: "+1 Weapon|XDMG"}},
						resolvedItem: {itemUid: "Longsword +1|XDMG"},
					},
					lifecycle: {state: "unresolved"},
				},
			},
		});
		expect(loaded.getGeneratedFeatureItemManagementRows()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				itemId: created.created[1].itemId,
				repairRequired: true,
				issues: ["missing-catalog-item"],
			}),
		]));

		loaded.setItemCatalog(ENHANCED_ITEMS);
		expect(loaded.getInventory().find(row => row.id === created.created[1].itemId)
			.item._generatedItemProvenance.lifecycle.state).toBe("active");
		expect(loaded.getGeneratedFeatureItemManagementRows()
			.find(row => row.itemId === created.created[1].itemId)?.repairRequired).toBe(false);
	});

	test("accepts only an equipped exact-owner replicated Wand or Weapon as an EFA focus and preserves provenance in the receipt reference", () => {
		const {state, toolsId} = buildState();
		state.unequip(toolsId);
		const weapon = getSlot(state, "+1 Weapon|XDMG");
		const created = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [{slotId: weapon.slotId, resolvedItemUid: "Longsword +1|XDMG"}],
		}).created[0];
		state.equip(created.itemId);
		const wrongOwner = {
			featureUid: "Experimental Elixir|Artificer|EFA|Alchemist|EFA|3|EFA",
			classUid: "Artificer|EFA",
			subclassUid: "Alchemist|Artificer|EFA|EFA",
			featureSource: "EFA",
		};
		const wrong = state.createGeneratedFeatureItem({
			item: {name: "Wrong Wand", source: "TST", type: "WD"},
			owner: wrongOwner,
			equipped: true,
		});
		const wrongFeatureSource = state.createGeneratedFeatureItem({
			item: {name: "Wrong-source Replica Wand", source: "TST", type: "WD"},
			owner: {
				featureUid: "Replicate Magic Item|Artificer|EFA|2",
				classUid: "Artificer|EFA",
				subclassUid: null,
				featureSource: "HB",
			},
			equipped: true,
		});
		expect(wrong.ok).toBe(true);
		expect(wrongFeatureSource.ok).toBe(true);

		const requirement = state.getSpellCastFocusRequirement({
			name: "Cure Wounds",
			source: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});
		expect(state.getEligibleSpellCastFocusInventoryRows(requirement).map(row => row.id)).toEqual([created.itemId]);

		const wrapper = state.getInventory().find(row => row.id === created.itemId);
		const reference = state.getSpellCastFocusReference(wrapper);
		expect(reference).toMatchObject({
			inventoryItemId: created.itemId,
			itemUid: "Longsword +1|XDMG",
			generatedFeatureItem: {
				generatedItemId: created.generatedItemId,
				owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
				planUid: "+1 Weapon|XDMG",
				catalogItemUid: "Longsword +1|XDMG",
				creationReceiptId: expect.any(String),
			},
		});
		expect(state.resolveSpellCastFocusReference(reference)?.id).toBe(created.itemId);

		state.unequip(created.itemId);
		expect(state.getEligibleSpellCastFocusInventoryRows(requirement)).toEqual([]);
		state.equip(created.itemId);
		state.removeItem(created.itemId);
		expect(state.resolveSpellCastFocusReference(reference)).toBeNull();
	});
});
