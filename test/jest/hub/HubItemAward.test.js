import {
	buildAwardSubmission,
	buildAwardPreview,
	buildAwardSuccessEvent,
	buildRecentAwardItems,
	buildStashAwardItems,
	createCatalogRenderFence,
	createGenerationFencedCatalogLoader,
	filterAwardItems,
	getAwardCommandFingerprint,
	getAwardItemSelectionKey,
	getAwardSourceRequest,
	resolveAwardItemSelection,
	stageAwardMutationDraft,
} from "../../../js/hub/hub-item-award.js";

const getTarget = ({
	id,
	name,
	carried,
	capacity,
	isIndeterminate = false,
	isShared = false,
	state = "normal",
} = {}) => isShared
	? {
		kind: "peer_profile",
		id,
		data: {
			identity: {name},
			carrySummary: carried == null ? undefined : {carried, capacity, state, isIndeterminate},
		},
	}
	: {
		kind: "dm_truth",
		character: {id, data: {name}},
		carrySummary: carried == null ? undefined : {carried, capacity, state, isIndeterminate},
	};

describe("Hub item award presentation contract", () => {
	it("derives recent and stash choices without carrying arbitrary item JSON", () => {
		const recent = buildRecentAwardItems([
			{sequence: 1, type: "item.granted", payload: {entry: {item: {name: "Torch", source: "PHB", weight: 1, entries: ["hidden"]}}}},
			{sequence: 2, type: "item.granted", payload: {sourceKind: "catalog", entry: {item: {name: "Torch", source: "PHB", weight: 1, entries: ["newer"]}}}},
			{sequence: 3, type: "item.granted", payload: {sourceKind: "campaign_item", entry: {item: {name: "Campaign Harp", source: "TST", weight: 2, effects: ["hidden"]}}}},
			{sequence: 4, type: "item.granted", payload: {sourceKind: "party_inventory", entry: {item: {name: "Private Stash Relic", source: "TST", weight: 2}}}},
		]);
		const stash = buildStashAwardItems({
			inventory: [{id: "entry-1", item: {name: "Rope", source: "PHB", weight: 10, entries: ["hidden"]}, quantity: 3}],
		});

		expect(recent).toEqual([
			{name: "Campaign Harp", source: "TST", sourceKind: "campaign_item", weight: 2},
			{name: "Torch", source: "PHB", sourceKind: "catalog", weight: 1},
		]);
		expect(stash).toEqual([{
			name: "Rope",
			source: "PHB",
			sourceKind: "party_inventory",
			weight: 10,
			entryId: "entry-1",
			availableQuantity: 3,
		}]);
		expect(getAwardSourceRequest(recent[0])).toEqual({
			kind: "campaign_item",
			item: {name: "Campaign Harp", source: "TST", weight: 2},
		});
		expect(getAwardSourceRequest(stash[0])).toEqual({kind: "party_inventory", entryId: "entry-1"});
	});

	it("keeps locally synthesized award provenance when authoritative refresh is unavailable", () => {
		const events = [{sequence: 4, type: "campaign.updated", payload: {}}];
		const stashEvent = buildAwardSuccessEvent({
			result: {
				awardId: "award-stash",
				source: {
					kind: "party_inventory",
					item: {name: "Private Stash Relic", source: "TST", weight: 2},
				},
			},
			events,
		});
		const catalogEvent = buildAwardSuccessEvent({
			result: {
				awardId: "award-catalog",
				source: {
					kind: "catalog",
					item: {name: "Torch", source: "PHB", weight: 1},
				},
			},
			events: [...events, stashEvent],
		});

		expect(stashEvent).toMatchObject({
			id: "local-award-stash",
			sequence: 5,
			payload: {sourceKind: "party_inventory"},
		});
		expect(catalogEvent).toMatchObject({
			id: "local-award-catalog",
			sequence: 6,
			payload: {sourceKind: "catalog"},
		});
		expect(buildRecentAwardItems([...events, stashEvent, catalogEvent])).toEqual([{
			name: "Torch",
			source: "PHB",
			sourceKind: "catalog",
			weight: 1,
		}]);
	});

	it("filters source choices predictably and keeps catalog search lazy", () => {
		const items = [
			{name: "Longsword", source: "PHB"},
			{name: "Moon Blade", source: "TGTT"},
		];
		expect(filterAwardItems({items, query: "l", isQueryRequired: true})).toEqual([]);
		expect(filterAwardItems({items, query: "mo"})).toEqual([{name: "Moon Blade", source: "TGTT"}]);
	});

	it("resolves a selected catalog option by stable identity across a projection refresh", () => {
		const longsword = {name: "Longsword", source: "PHB", sourceKind: "catalog", weight: 3};
		const selectionKey = getAwardItemSelectionKey(longsword);

		expect(resolveAwardItemSelection({
			selectionKey,
			selectedOptionItem: longsword,
			visibleItems: [],
			sourceItems: [],
		})).toEqual(longsword);
		expect(resolveAwardItemSelection({
			selectionKey,
			visibleItems: [{name: "Club", source: "PHB", sourceKind: "catalog"}],
			sourceItems: [longsword],
		})).toEqual(longsword);
	});

	it("does not let an older campaign catalog request overwrite newer brew content", async () => {
		const pending = [];
		const loader = createGenerationFencedCatalogLoader({
			pLoadCatalog: content => new Promise(resolve => pending.push({content, resolve})),
		});
		loader.setCampaignBrewContent([{name: "Old Item"}]);
		const oldLoad = loader.pEnsureCatalog();
		loader.setCampaignBrewContent([{name: "New Item"}]);
		const newLoad = loader.pEnsureCatalog();
		await Promise.resolve();

		pending[1].resolve([{name: "New Item", source: "NEW"}]);
		await expect(newLoad).resolves.toEqual([{name: "New Item", source: "NEW"}]);
		pending[0].resolve([{name: "Old Item", source: "OLD"}]);
		await expect(oldLoad).resolves.toBeNull();

		expect(loader.getCatalog()).toEqual([{name: "New Item", source: "NEW"}]);
		expect(loader.getCampaignBrewContent()).toEqual([{name: "New Item"}]);
		expect(loader.getGeneration()).toBe(2);
	});

	it("ignores an obsolete catalog failure after a newer generation succeeds", async () => {
		const pending = [];
		const loader = createGenerationFencedCatalogLoader({
			pLoadCatalog: content => new Promise((resolve, reject) => pending.push({content, resolve, reject})),
		});
		loader.setCampaignBrewContent([{name: "Old Item"}]);
		const oldLoad = loader.pEnsureCatalog();
		loader.setCampaignBrewContent([{name: "New Item"}]);
		const newLoad = loader.pEnsureCatalog();
		await Promise.resolve();

		pending[1].resolve([{name: "New Item", source: "NEW"}]);
		await expect(newLoad).resolves.toEqual([{name: "New Item", source: "NEW"}]);
		pending[0].reject(new Error("stale catalog failure"));

		await expect(oldLoad).resolves.toBeNull();
		expect(loader.getCatalog()).toEqual([{name: "New Item", source: "NEW"}]);
	});

	it("fences obsolete result renders across both render and catalog generations", () => {
		let catalogGeneration = 0;
		const fence = createCatalogRenderFence({getCatalogGeneration: () => catalogGeneration});
		const firstRender = fence.begin();
		const secondRender = fence.begin();

		expect(firstRender()).toBe(false);
		expect(secondRender()).toBe(true);

		catalogGeneration++;
		expect(secondRender()).toBe(false);
		expect(fence.begin()()).toBe(true);
	});

	it("keys retries from the normalized ordered award command instead of incidental controls", () => {
		const selectedItem = {name: "Torch", source: "PHB", sourceKind: "catalog", weight: 1};
		const targets = [
			getTarget({id: "a", name: "A"}),
			getTarget({id: "b", name: "B"}),
		];
		const first = buildAwardSubmission({
			selectedItem,
			targets,
			selectedTargetIds: new Set(["a", "b"]),
			quantity: "2",
			note: "  For the road  ",
		});
		const incidentalTarget = buildAwardSubmission({
			selectedItem,
			targets: [...targets, getTarget({id: "unchecked", name: "Unchecked"})],
			selectedTargetIds: new Set(["a", "b"]),
			quantity: "02",
			note: "For the road",
		});
		const reordered = buildAwardSubmission({
			selectedItem,
			targets: [...targets].reverse(),
			selectedTargetIds: new Set(["a", "b"]),
			quantity: "2",
			note: "For the road",
		});

		expect(incidentalTarget).toEqual(first);
		expect(getAwardCommandFingerprint(incidentalTarget)).toBe(getAwardCommandFingerprint(first));
		expect(reordered.targetCharacterIds).toEqual(["b", "a"]);
		expect(getAwardCommandFingerprint(reordered)).not.toBe(getAwardCommandFingerprint(first));
	});

	it("replays the exact staged award request across projection reorder or removal", () => {
		const selectedItem = {name: "Torch", source: "PHB", sourceKind: "catalog", weight: 1};
		const targets = [
			getTarget({id: "a", name: "A"}),
			getTarget({id: "b", name: "B"}),
			getTarget({id: "c", name: "C"}),
		];
		const firstSubmission = buildAwardSubmission({
			selectedItem,
			targets,
			selectedTargetIds: new Set(["a", "b", "c"]),
			quantity: "2",
			note: "For the road",
		});
		const firstDraft = stageAwardMutationDraft({
			submission: firstSubmission,
			rulesVersionId: "rules-1",
		});
		const replacementSubmission = buildAwardSubmission({
			selectedItem,
			targets: [targets[1], targets[0]],
			selectedTargetIds: new Set(["a", "b"]),
			quantity: "2",
			note: "For the road",
		});
		const retryDraft = stageAwardMutationDraft({
			draft: firstDraft,
			submission: replacementSubmission,
			rulesVersionId: "rules-2",
		});

		expect(retryDraft).toBe(firstDraft);
		expect(retryDraft.request).toEqual({
			...firstSubmission,
			rulesVersionId: "rules-1",
		});
		expect(retryDraft.fingerprint).toBe(getAwardCommandFingerprint(retryDraft.request));
	});

	it("distinguishes exact, lower-bound, unavailable, and policy-blocked previews", () => {
		const preview = buildAwardPreview({
			targets: [
				getTarget({id: "known", name: "Known", carried: 20, capacity: 100}),
				getTarget({id: "lower", name: "Lower", carried: 40, capacity: 80, isIndeterminate: true, isShared: true}),
				getTarget({id: "unavailable", name: "Unavailable"}),
				getTarget({id: "blocked", name: "Blocked", carried: 10, capacity: 50}),
			],
			selectedItem: {name: "Anvil", source: "PHB", weight: 15},
			quantity: 2,
			policyBlockedTargetIds: ["blocked"],
		});

		expect(preview.rows).toEqual([
			expect.objectContaining({characterId: "known", state: "known", postAward: 50}),
			expect.objectContaining({characterId: "lower", state: "lower_bound", postAward: 70}),
			expect.objectContaining({characterId: "unavailable", state: "unavailable"}),
			expect.objectContaining({characterId: "blocked", state: "policy_blocked"}),
		]);
		expect(preview.rows[1].message).toContain("at least 70 lb");
		expect(preview.rows[2].message).not.toMatch(/\d+ lb/);
		expect(preview.isPolicyBlocked).toBe(true);
	});

	it("does not claim an exact post-award load when item weight is unavailable", () => {
		const preview = buildAwardPreview({
			targets: [getTarget({id: "known", name: "Known", carried: 20, capacity: 100})],
			selectedItem: {name: "Mystery Box", source: "HB"},
			quantity: 1,
		});
		expect(preview.rows).toEqual([expect.objectContaining({
			state: "unavailable",
			message: expect.stringContaining("no published weight"),
		})]);
	});

	it.each([
		["crosses capacity", getTarget({id: "crossing", name: "Crossing", carried: 90, capacity: 100, isIndeterminate: true})],
		["is already over capacity", getTarget({id: "over", name: "Over", carried: 110, capacity: 100, isIndeterminate: true, state: "over_capacity"})],
	])("keeps lower-bound wording and the definite warning when the known load %s", (_label, target) => {
		const preview = buildAwardPreview({
			targets: [target],
			selectedItem: {name: "Anvil", source: "PHB", weight: 20},
			quantity: 1,
		});

		expect(preview.rows).toEqual([expect.objectContaining({
			state: "lower_bound",
			message: expect.stringMatching(/at least .* This is over the current capacity\./),
		})]);
	});
});
