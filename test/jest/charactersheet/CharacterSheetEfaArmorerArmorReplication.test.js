import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-item-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const State = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;
const Progression = globalThis.CharacterSheetProgression;
const Plans = globalThis.CharacterSheetArtificerPlans;
const LevelUp = globalThis.CharacterSheetLevelUp;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const RespecEngine = globalThis.CharacterSheetRespecEngine;

const classFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-artificer.json"), "utf8"));
const itemFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/items.json"), "utf8"));
const artificer = classFile.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const feature = classFile.classFeature.find(it =>
	it.name === "Replicate Magic Item"
		&& it.className === "Artificer"
		&& it.classSource === "EFA"
		&& it.source === "EFA",
);
const ARMORER = {name: "Armorer", shortName: "Armorer", source: "EFA"};
const ARMORER_DATA = classFile.subclass.find(it =>
	it.name === "Armorer"
		&& it.className === "Artificer"
		&& it.classSource === "EFA"
		&& it.source === "EFA",
);

const PLAN_ITEMS = [
	...itemFile.item,
	{
		name: "+1 Armor",
		source: "XDMG",
		type: "GV|XDMG",
		requires: [{type: "LA|XPHB"}, {type: "MA|XPHB"}, {type: "HA|XPHB"}],
	},
	{
		name: "+1 Shield",
		source: "XDMG",
		type: "GV|XDMG",
		requires: [{type: "S|XPHB"}],
	},
	{
		name: "+1 Weapon",
		source: "XDMG",
		type: "GV|XDMG",
		requires: [{type: "M|XPHB"}, {type: "R|XPHB"}],
	},
	{name: "Clockwork Trinket", source: "EFA", type: "W", wondrous: true, rarity: "common"},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true, rarity: "common"},
	{name: "Wand of Magic Missiles", source: "XDMG", type: "WD", rarity: "uncommon"},
].filter((item, index, all) =>
	all.findIndex(other => other.name === item.name && other.source === item.source) === index,
);

const CATALOG_ITEMS = [
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
		name: "Plate Armor +1",
		source: "XDMG",
		type: "HA",
		armor: true,
		_category: "Specific Variant",
		_variantName: "+1 Armor",
		baseItem: "plate armor|xphb",
		bonusAc: "+1",
	},
	{
		name: "Shield +1",
		source: "XDMG",
		type: "S",
		_category: "Specific Variant",
		_variantName: "+1 Shield",
		baseItem: "shield|xphb",
		bonusAc: "+1",
	},
	{name: "Bag of Holding", source: "XDMG", type: "W", wondrous: true},
	{name: "Clockwork Trinket", source: "EFA", type: "W", wondrous: true},
	{name: "Silver Cog", source: "TST", type: "W", wondrous: true},
	{name: "Wand of Magic Missiles", source: "XDMG", type: "WD"},
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
	saveCharacter: async () => {},
	renderCharacter: () => {},
});

function getCatalog () {
	return Plans.parseCatalog({feature, items: PLAN_ITEMS});
}

function getCandidate (catalog, itemUid, classLevel = 9) {
	return Plans.getEligibleCandidates({catalog, classLevel})
		.find(candidate => candidate.itemUid === itemUid);
}

function getChoicesForLevel ({catalog, classLevel, subclass = ARMORER}) {
	const opportunities = Plans.getProgressionOpportunities({
		className: "Artificer",
		classSource: "EFA",
		classLevel,
		subclassShortName: subclass?.shortName || subclass?.name || null,
		subclassSource: subclass?.source || null,
	});
	const desiredByLevel = {
		2: ["Bag of Holding|XDMG", "+1 Weapon|XDMG", "Clockwork Trinket|EFA", "Silver Cog|TST"],
		6: ["Wand of Magic Missiles|XDMG"],
		9: ["+1 Armor|XDMG"],
	};
	const desired = [...(desiredByLevel[classLevel] || [])];
	const decisions = opportunities
		.filter(opportunity => opportunity.kind === "acquire")
		.map(opportunity => ({
			...opportunity,
			selection: getCandidate(catalog, desired.shift(), classLevel),
		}));
	return Plans.toHistoryChoices(decisions);
}

function buildState ({level = 9, subclass = ARMORER} = {}) {
	const state = new State();
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level,
		subclass,
	});
	const catalog = getCatalog();
	for (let classLevel = 1; classLevel <= level; classLevel++) {
		const choices = [2, 6, 9].includes(classLevel)
			? getChoicesForLevel({catalog, classLevel, subclass})
			: {};
		if (classLevel === 3 && subclass) choices.subclass = {...subclass};
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel,
			choices,
		});
	}
	Progression.syncCanonicalDecisions({page: getPage(state), state});
	state.setItemCatalog(CATALOG_ITEMS);
	const toolsId = state.addItem(CATALOG_ITEMS.find(item => item.name === "Tinker's Tools"), 1, true);
	return {state, toolsId, catalog};
}

function getSlot (state, itemUid) {
	return state.getEfaArtificerPlans().find(plan => plan.selection.itemUid === itemUid);
}

function getProductionSelection (state, itemUid, resolvedItemUid = null) {
	const slot = getSlot(state, itemUid);
	return {
		slotId: slot.slotId,
		...(resolvedItemUid ? {resolvedItemUid} : {}),
	};
}

describe("EFA Armorer Armor Replication", () => {
	test("registers one exact level-9 required acquisition with a stable constrained slot", () => {
		const level8 = Plans.getProgressionOpportunities({
			className: "Artificer",
			classSource: "EFA",
			classLevel: 8,
			subclassShortName: "Armorer",
			subclassSource: "EFA",
		});
		expect(level8.some(opportunity => opportunity.extensionId)).toBe(false);

		const level9 = Plans.getProgressionOpportunities({
			className: "Artificer",
			classSource: "EFA",
			classLevel: 9,
			subclassShortName: "Armorer",
			subclassSource: "EFA",
		});
		expect(level9.filter(opportunity => opportunity.extensionId)).toEqual([
			expect.objectContaining({
				kind: "acquire",
				required: true,
				slotId: Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
				owner: {
					className: "Artificer",
					classSource: "EFA",
					subclassShortName: "Armorer",
					subclassSource: "EFA",
					featureName: "Improved Armorer",
					featureSource: "EFA",
				},
				constraints: {itemKinds: ["armor", "shield"]},
			}),
		]);
		for (const owner of [
			{classSource: "TCE", subclassSource: "EFA"},
			{classSource: "EFA", subclassSource: "TCE"},
		]) {
			expect(Plans.getProgressionOpportunities({
				className: "Artificer",
				classSource: owner.classSource,
				classLevel: 9,
				subclassShortName: "Armorer",
				subclassSource: owner.subclassSource,
			}).some(opportunity => opportunity.extensionId)).toBe(false);
		}
	});

	test("uses canonical item kinds for fixed Armor and Shield plans and preserves the constraint on replacement", () => {
		const catalog = getCatalog();
		const armorOpportunity = Plans.getProgressionOpportunities({
			className: "Artificer",
			classSource: "EFA",
			classLevel: 9,
			subclassShortName: "Armorer",
			subclassSource: "EFA",
		}).find(opportunity => opportunity.extensionId);
		const armor = getCandidate(catalog, "+1 Armor|XDMG");
		const shield = getCandidate(catalog, "+1 Shield|XDMG");
		const wand = getCandidate(catalog, "Wand of Magic Missiles|XDMG");

		expect(armor.itemKinds).toContain("armor");
		expect(shield.itemKinds).toContain("shield");
		expect(Plans.getEligibleCandidates({
			catalog,
			classLevel: 9,
			constraints: armorOpportunity.constraints,
		}).map(candidate => candidate.itemUid)).toEqual(expect.arrayContaining([
			"+1 Armor|XDMG",
			"+1 Shield|XDMG",
		]));
		expect(Plans.getEligibleCandidates({
			catalog,
			classLevel: 9,
			constraints: armorOpportunity.constraints,
		}).map(candidate => candidate.itemUid)).not.toContain(wand.itemUid);

		const acquire = {...armorOpportunity, selection: armor};
		const replacement = {
			...Plans.getProgressionOpportunities({
				className: "Artificer",
				classSource: "EFA",
				classLevel: 10,
				subclassShortName: "Armorer",
				subclassSource: "EFA",
			}).find(opportunity => opportunity.kind === "replacement"),
			selection: {
				targetSlotId: armorOpportunity.slotId,
				previousPlan: armor,
				nextPlan: wand,
			},
		};
		expect(Plans.validateDraft({catalog, decisions: [acquire, replacement]}).issues).toEqual([
			expect.objectContaining({code: "ineligible-plan"}),
		]);
		replacement.selection.nextPlan = armor;
		expect(Plans.validateDraft({catalog, decisions: [acquire, replacement]}).issues).toEqual([
			expect.objectContaining({code: "same-plan-replacement"}),
		]);
		replacement.selection.nextPlan = shield;
		const valid = Plans.validateDraft({catalog, decisions: [acquire, replacement]});
		expect(valid.isValid).toBe(true);
		expect(valid.slots.find(slot => slot.slotId === armorOpportunity.slotId)).toMatchObject({
			slotId: armorOpportunity.slotId,
			selection: {itemUid: "+1 Shield|XDMG"},
			constraints: {itemKinds: ["armor", "shield"]},
		});
	});

	test("surfaces the same required opportunity through Builder, progression, Level Up, Quick Build, and Respec", async () => {
		const {state} = buildState();
		const page = getPage(state);
		const manifest = Progression.buildManifest({page, state});
		const extension = manifest.decisions.find(decision =>
			decision.meta?.owner?.featureName === "Improved Armorer",
		);
		expect(extension).toMatchObject({
			type: Plans.DECISION_TYPE_ACQUIRE,
			required: true,
			status: "resolved",
			selection: {itemUid: "+1 Armor|XDMG"},
			meta: {
				slotId: Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
				constraints: {itemKinds: ["armor", "shield"]},
			},
		});
		expect(state.getEfaArtificerPlans()).toContainEqual(expect.objectContaining({
			slotId: Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
			constraints: {itemKinds: ["armor", "shield"]},
		}));

		const level8State = buildState({level: 8}).state;
		const levelUp = new LevelUp(getPage(level8State));
		expect(levelUp.getArtificerPlanOpportunities({
			classEntry: level8State.getClasses()[0],
			newLevel: 9,
		}).filter(opportunity => opportunity.extensionId)).toHaveLength(1);

		const quickBuild = new QuickBuild(getPage(level8State));
		expect(quickBuild._getArtificerPlanOpportunities([{
			characterLevel: 9,
			className: "Artificer",
			classSource: "EFA",
			classLevel: 9,
			subclass: ARMORER,
		}]).filter(opportunity => opportunity.extensionId)).toHaveLength(1);

		const builderState = new State();
		builderState.addClass({name: "Artificer", source: "EFA", level: 1});
		builderState.recordLevelChoice({
			level: 1,
			class: {name: "Artificer", source: "EFA"},
			classLevel: 1,
			choices: {},
		});
		const builderHandoff = new QuickBuild(getPage(builderState));
		builderHandoff._showWizard = async () => {};
		await builderHandoff.showFromBuilder({
			classData: artificer,
			targetLevel: 9,
			subclass: ARMORER_DATA,
		});
		builderHandoff._buildWizardSteps();
		const builderStep = builderHandoff._steps.find(step => step.id === "artificer-plans");
		expect(builderStep.required).toBe(true);
		expect(builderHandoff._getArtificerPlanOpportunities(builderStep.data)
			.filter(opportunity => opportunity.extensionId)).toHaveLength(1);

		const engine = new RespecEngine({page, state});
		engine.begin();
		const candidate = engine.manifest.decisions.find(decision => decision.semanticKey === extension.semanticKey);
		expect(candidate.options.map(option => option.itemUid)).toEqual(expect.arrayContaining([
			"+1 Armor|XDMG",
			"+1 Shield|XDMG",
		]));
		expect(candidate.options.map(option => option.itemUid)).not.toContain("Wand of Magic Missiles|XDMG");
		engine.cancel();
	});

	test("adds exactly one constrained generated-item slot and accepts either Armor or Shield", () => {
		const {state} = buildState();
		const descriptors = state.getEfaReplicateMagicItemLifecycleDescriptors();
		const baseCapacity = ClassUtils.getEfaArtificerCreatedMagicItemsMax(9);
		expect(descriptors).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "efa-armorer-armor-replication-capacity",
				capacity: 1,
				allowedItemKinds: ["armor", "shield"],
				categoryPredicate: {itemKinds: ["armor", "shield"]},
				metadata: {
					sourceFeatureUid: Plans.EFA_ARMORER_ARMOR_REPLICATION_FEATURE_UID,
					extensionKind: "armor-replication",
				},
			}),
		]));
		expect(state.getEfaReplicateMagicItemProductionOptions().maxCreatedItems).toBe(baseCapacity + 1);

		const owner = State.EFA_REPLICATE_MAGIC_ITEM_OWNER;
		const create = item => state.createGeneratedFeatureItem({item, owner});
		create({name: "First Wand", source: "TST", type: "WD"});
		create({name: "Second Wand", source: "TST", type: "WD"});
		create({name: "Third Wand", source: "TST", type: "WD"});
		const armor = create({name: "Armor Control", source: "TST", type: "HA"});
		expect(state.getGeneratedFeatureItemCapacitySnapshot({owner, descriptors})).toMatchObject({
			fits: true,
			baseCapacity,
			extensionCapacityUsed: 1,
			capacity: baseCapacity + 1,
		});
		state.removeItem(armor.itemId);
		create({name: "Fourth Wand", source: "TST", type: "WD"});
		expect(state.getGeneratedFeatureItemCapacitySnapshot({owner, descriptors})).toMatchObject({
			fits: false,
			baseCapacity,
			extensionCapacityUsed: 0,
			capacity: baseCapacity,
		});
		const fourth = state.getGeneratedFeatureItemRows(owner).at(-1);
		state.removeItem(fourth.id);
		create({name: "Shield Control", source: "TST", type: "S"});
		expect(state.getGeneratedFeatureItemCapacitySnapshot({owner, descriptors}).fits).toBe(true);
	});

	test("creates the extra item only through constrained long-rest production", () => {
		const {state} = buildState();
		const allowed = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				getProductionSelection(state, "Bag of Holding|XDMG"),
				getProductionSelection(state, "+1 Weapon|XDMG", "Longsword +1|XDMG"),
				getProductionSelection(state, "Wand of Magic Missiles|XDMG"),
				getProductionSelection(state, "+1 Armor|XDMG", "Plate Armor +1|XDMG"),
			],
		});
		expect(allowed.ok).toBe(true);
		expect(allowed.created.map(entry => entry.plan.itemUid)).toEqual([
			"Bag of Holding|XDMG",
			"+1 Weapon|XDMG",
			"Wand of Magic Missiles|XDMG",
			"+1 Armor|XDMG",
		]);
		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)).toHaveLength(4);

		const rejected = buildState().state;
		const before = rejected.toJson().inventory;
		expect(rejected.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				getProductionSelection(rejected, "Bag of Holding|XDMG"),
				getProductionSelection(rejected, "+1 Weapon|XDMG", "Longsword +1|XDMG"),
				getProductionSelection(rejected, "Wand of Magic Missiles|XDMG"),
				getProductionSelection(rejected, "Clockwork Trinket|EFA"),
			],
		})).toMatchObject({
			ok: false,
			code: "replicate-production-capacity-exceeded",
		});
		expect(rejected.toJson().inventory).toEqual(before);
	});

	test("round-trips the extension and removes only the now-illegal item on level loss", () => {
		const {state} = buildState();
		const created = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				getProductionSelection(state, "+1 Armor|XDMG", "Plate Armor +1|XDMG"),
				getProductionSelection(state, "Bag of Holding|XDMG"),
				getProductionSelection(state, "+1 Weapon|XDMG", "Longsword +1|XDMG"),
				getProductionSelection(state, "Wand of Magic Missiles|XDMG"),
			],
		});
		expect(created.ok).toBe(true);

		const loaded = new State();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		loaded.setItemCatalog(CATALOG_ITEMS);
		expect(loaded.getEfaArtificerPlans()).toContainEqual(expect.objectContaining({
			slotId: Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
			constraints: {itemKinds: ["armor", "shield"]},
		}));
		expect(loaded.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)).toHaveLength(4);

		const armorItemId = created.created.find(entry => entry.plan.itemUid === "+1 Armor|XDMG").itemId;
		const baseItemIds = created.created.filter(entry => entry.itemId !== armorItemId).map(entry => entry.itemId);
		expect(loaded.removeLastLevel()).toMatchObject({success: true});
		expect(loaded.getClasses()[0].level).toBe(8);
		expect(loaded.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER).map(row => row.id))
			.toEqual(baseItemIds);
		expect(loaded.getEfaArmorerArmorReplicationLifecycleExtensions()).toEqual([]);
	});

	test("uses Respec candidate lineage to replace the Armor slot and remove only its created item", async () => {
		const {state} = buildState();
		const created = state.commitEfaReplicateMagicItemsAtLongRest({
			selections: [
				getProductionSelection(state, "+1 Armor|XDMG", "Plate Armor +1|XDMG"),
				getProductionSelection(state, "Bag of Holding|XDMG"),
				getProductionSelection(state, "+1 Weapon|XDMG", "Longsword +1|XDMG"),
				getProductionSelection(state, "Wand of Magic Missiles|XDMG"),
			],
		});
		const armorItemId = created.created.find(entry => entry.plan.itemUid === "+1 Armor|XDMG").itemId;
		const baseItemIds = created.created.filter(entry => entry.itemId !== armorItemId).map(entry => entry.itemId);
		const page = getPage(state);
		const engine = new RespecEngine({page, state});
		engine.begin();
		const decision = engine.manifest.decisions.find(candidate =>
			candidate.meta?.slotId === Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
		);
		const shield = decision.options.find(option => option.itemUid === "+1 Shield|XDMG");
		await engine.stageGraphMutation(decision.id, shield, {
			reverseParent: true,
			apply: () => ({selection: shield}),
		});
		expect(engine.state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)
			.map(row => row.id)).toEqual(baseItemIds);
		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)
			.map(row => row.id)).toEqual(created.created.map(entry => entry.itemId));
		expect(engine.state.getEfaArtificerPlans().find(plan => plan.selection.itemUid === "+1 Shield|XDMG")).toMatchObject({
			slotId: Plans.getExtensionSlotId(Plans.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID),
		});
		engine.cancel();
		expect(state.getGeneratedFeatureItemRows(State.EFA_REPLICATE_MAGIC_ITEM_OWNER)
			.map(row => row.id)).toEqual(created.created.map(entry => entry.itemId));
	});

	test("keeps EFA/TCE and mixed-source characters isolated", () => {
		const mixedSubclass = new State();
		mixedSubclass.addClass({
			name: "Artificer",
			source: "EFA",
			level: 9,
			subclass: {name: "Armorer", shortName: "Armorer", source: "TCE"},
		});
		expect(mixedSubclass.getEfaArmorerArmorReplicationLifecycleExtensions()).toEqual([]);

		const tce = new State();
		tce.addClass({
			name: "Artificer",
			source: "TCE",
			level: 9,
			subclass: {name: "Armorer", shortName: "Armorer", source: "TCE"},
		});
		expect(tce.getEfaArmorerArmorReplicationLifecycleExtensions()).toEqual([]);
		expect(Plans.getProgressionOpportunities({
			className: "Artificer",
			classSource: "TCE",
			classLevel: 9,
			subclassShortName: "Armorer",
			subclassSource: "TCE",
		})).toEqual([]);
	});
});
