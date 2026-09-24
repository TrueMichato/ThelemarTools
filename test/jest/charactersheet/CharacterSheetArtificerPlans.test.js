import "../../../js/charactersheet/charactersheet-artificer-plans.js";

const Plans = globalThis.CharacterSheetArtificerPlans;

const getFeature = () => ({
	name: "Replicate Magic Item",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	level: 2,
	entries: [{
		type: "entries",
		entries: [
			{
				type: "table",
				caption: "Magic Item Plans (Artificer Level 2+)",
				rows: [
					["{@item Bag of Holding|XDMG}", "No"],
					["{@item +1 Weapon|XDMG|Weapon +1}", "No"],
					["{@filter Common magic item that isn't a Potion, a Scroll, or cursed|items|source=|type=!potion;!scroll|rarity=common|category=|miscellaneous=!cursed}*", "Varies"],
				],
			},
			{
				type: "table",
				caption: "Magic Item Plans (Artificer Level 10+)",
				rows: [
					["{@filter Uncommon Wondrous Item that isn't cursed|items|source=|type=wondrous item|rarity=uncommon|category=|miscellaneous=!cursed}*", "Varies"],
				],
			},
		],
	}],
});

const ITEMS = [
	{name: "Bag of Holding", source: "XDMG", rarity: "uncommon", wondrous: true},
	{name: "+1 Weapon", source: "XDMG", rarity: "uncommon"},
	{name: "Clockwork Trinket", source: "EFA", rarity: "common", wondrous: true},
	{name: "Silver Cog", source: "TST", rarity: "common", wondrous: true},
	{name: "Common Potion", source: "TST", rarity: "common", type: "P"},
	{name: "Common Scroll", source: "TST", rarity: "common", type: "SC"},
	{name: "Cursed Doll", source: "TST", rarity: "common", wondrous: true, curse: true},
	{name: "Uncommon Ring", source: "TST", rarity: "uncommon", wondrous: true},
	{name: "Uncommon Sword", source: "TST", rarity: "uncommon", type: "M"},
];

describe("CharacterSheetArtificerPlans", () => {
	test("parses fixed canonical item identities and wildcard item categories from authoritative tables", () => {
		const catalog = Plans.parseCatalog({feature: getFeature(), items: ITEMS});
		expect(catalog.featureUid).toBe("Replicate Magic Item|Artificer|EFA|2");
		expect(catalog.issues).toEqual([]);
		expect(catalog.tables).toEqual([
			expect.objectContaining({tableLevel: 2, rowCount: 3}),
			expect.objectContaining({tableLevel: 10, rowCount: 1}),
		]);
		expect(catalog.entries).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: "fixed",
				itemUid: "+1 Weapon|XDMG",
				displayName: "Weapon +1",
				repeatable: false,
			}),
			expect.objectContaining({
				kind: "wildcard",
				tableLevel: 2,
				repeatable: true,
			}),
		]));
		const level2 = Plans.getEligibleCandidates({catalog, classLevel: 2});
		expect(level2.map(it => it.itemUid)).toEqual([
			"+1 Weapon|XDMG",
			"Bag of Holding|XDMG",
			"Clockwork Trinket|EFA",
			"Silver Cog|TST",
		]);
		expect(level2.find(it => it.itemUid === "+1 Weapon|XDMG")).toMatchObject({
			planKind: "fixed",
			planUid: "+1 Weapon|XDMG",
		});
		expect(level2.find(it => it.itemUid === "Clockwork Trinket|EFA")).toMatchObject({
			planKind: "wildcard",
			categoryLabel: "Common magic item that isn't a Potion, a Scroll, or cursed",
		});
	});

	test("enforces exact source owner, cumulative plan counts, and every-level optional replacement opportunities", () => {
		expect([1, 2, 5, 6, 10, 14, 18].map(level => Plans.getPlansKnown(level))).toEqual([0, 4, 4, 5, 6, 7, 8]);
		expect(Plans.getProgressionOpportunities({className: "Artificer", classSource: "TCE", classLevel: 2})).toEqual([]);
		const level2 = Plans.getProgressionOpportunities({className: "Artificer", classSource: "EFA", classLevel: 2});
		expect(level2.filter(it => it.kind === "acquire")).toHaveLength(4);
		expect(level2.filter(it => it.kind === "replacement")).toHaveLength(1);
		const level3 = Plans.getProgressionOpportunities({className: "Artificer", classSource: "EFA", classLevel: 3});
		expect(level3.filter(it => it.kind === "acquire")).toHaveLength(0);
		expect(level3.filter(it => it.kind === "replacement")).toHaveLength(1);
	});

	test("allows repeated wildcard opportunities only for different exact items and tracks replacement lineage", () => {
		const catalog = Plans.parseCatalog({feature: getFeature(), items: ITEMS});
		const byUid = new Map(Plans.getEligibleCandidates({catalog, classLevel: 10}).map(it => [it.itemUid, it]));
		const opportunities = Plans.getProgressionOpportunities({className: "Artificer", classSource: "EFA", classLevel: 2});
		const decisions = opportunities.filter(it => it.kind === "acquire").map((opportunity, ix) => ({
			...opportunity,
			selection: [
				byUid.get("Clockwork Trinket|EFA"),
				byUid.get("Clockwork Trinket|EFA"),
				byUid.get("Bag of Holding|XDMG"),
				byUid.get("+1 Weapon|XDMG"),
			][ix],
		}));
		const duplicate = Plans.validateDraft({catalog, decisions});
		expect(duplicate.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "duplicate-plan"}),
		]));

		decisions[1].selection = byUid.get("Uncommon Ring|TST");
		decisions[1].classLevel = 10;
		const replacement = {
			...Plans.getProgressionOpportunities({className: "Artificer", classSource: "EFA", classLevel: 10}).find(it => it.kind === "replacement"),
			selection: {
				targetSlotId: decisions[0].slotId,
				previousPlan: decisions[0].selection,
				nextPlan: decisions[0].selection,
			},
		};
		const samePlan = Plans.validateDraft({catalog, decisions: [...decisions, replacement]});
		expect(samePlan.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "same-plan-replacement"}),
		]));
		const samePlanProjection = Plans.projectDecisions({decisions: [...decisions, replacement]});
		expect(samePlanProjection.unresolved).toEqual(expect.arrayContaining([
			expect.objectContaining({opportunityId: replacement.opportunityId}),
		]));
		expect(samePlanProjection.slots.find(slot => slot.slotId === replacement.selection.targetSlotId)?.lineage).toEqual([]);

		replacement.selection.nextPlan = byUid.get("Uncommon Ring|TST");
		const collision = Plans.validateDraft({catalog, decisions: [...decisions, replacement]});
		expect(collision.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "duplicate-plan"}),
		]));

		replacement.selection.nextPlan = byUid.get("Uncommon Ring|TST");
		decisions[0].selection = byUid.get("Bag of Holding|XDMG");
		decisions[1].selection = byUid.get("Clockwork Trinket|EFA");
		decisions[1].classLevel = 2;
		decisions[2].selection = byUid.get("+1 Weapon|XDMG");
		decisions[3].selection = byUid.get("Silver Cog|TST");
		replacement.selection.previousPlan = decisions[0].selection;
		const valid = Plans.validateDraft({catalog, decisions: [...decisions, replacement]});
		expect(valid.issues).toEqual([]);
		expect(valid.isValid).toBe(true);
		expect(valid.slots.find(it => it.slotId === replacement.selection.targetSlotId)).toMatchObject({
			selection: {itemUid: "Uncommon Ring|TST"},
			lineage: [{
				replacementLevel: 10,
				previousPlan: {itemUid: "Bag of Holding|XDMG"},
				nextPlan: {itemUid: "Uncommon Ring|TST"},
			}],
		});
	});

	test("keeps mixed class/subclass/feature sources independent in extension descriptors", () => {
		const extension = Plans.getExtensionDescriptor({
			id: "armorer-armor-plan-replacement",
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Armorer",
			subclassSource: "TCE",
			featureName: "Armor Modifications",
			featureSource: "HB1",
			classLevel: 9,
			constraints: {itemCategories: ["armor"]},
		});
		expect(extension.owner).toEqual({
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Armorer",
			subclassSource: "TCE",
			featureName: "Armor Modifications",
			featureSource: "HB1",
		});
		const opportunities = Plans.getProgressionOpportunities({
			className: "Artificer",
			classSource: "EFA",
			classLevel: 9,
			extensions: [extension],
		});
		expect(opportunities.find(it => it.extensionId === extension.id)).toMatchObject({
			kind: "replacement",
			required: false,
			owner: {
				classSource: "EFA",
				subclassSource: "TCE",
				featureSource: "HB1",
			},
		});
	});

	test("builds source-qualified receipts without inventory effects", () => {
		const catalog = Plans.parseCatalog({feature: getFeature(), items: ITEMS});
		const selection = Plans.getEligibleCandidates({catalog, classLevel: 2})[0];
		const receipt = Plans.getDecisionReceipt({
			kind: "acquire",
			semanticKey: "semantic",
			opportunityId: "opportunity",
			classLevel: 2,
			slotId: "efa-replicate-plan-1",
			selection,
		});
		expect(receipt).toMatchObject({
			family: "artificer-plan",
			sourceDecisionKey: "semantic",
			acquisitionLevel: 2,
			slotId: "efa-replicate-plan-1",
			selection: {
				itemUid: selection.itemUid,
				source: selection.source,
			},
		});
		expect(receipt.effects).toEqual([{type: "configuration", key: "artificer-plan", value: "acquisition"}]);
		expect(JSON.stringify(receipt)).not.toMatch(/inventory|itemId|createdItem/i);

		const replacementReceipt = Plans.getDecisionReceipt({
			kind: "replacement",
			semanticKey: "replacement-semantic",
			opportunityId: "replacement-opportunity",
			classLevel: 3,
			selection: {
				targetSlotId: "efa-replicate-plan-1",
				previousPlan: selection,
				nextPlan: Plans.getEligibleCandidates({catalog, classLevel: 2})[1],
				priorReplacementSemanticKey: null,
			},
		});
		expect(replacementReceipt).toMatchObject({
			decisionLevel: 3,
			acquisitionLevel: null,
			replacementLevel: 3,
			slotId: "efa-replicate-plan-1",
			lineage: {
				previousPlan: {itemUid: selection.itemUid},
				nextPlan: {itemUid: Plans.getEligibleCandidates({catalog, classLevel: 2})[1].itemUid},
			},
		});
	});
});
