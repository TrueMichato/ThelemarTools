/**
 * Campaign-rules teardown must actually remove campaign rules (ADR 0013, `teardown-rules`).
 *
 * The Character Sheet re-applies `setCampaignSettingsOverlay(this._hubContext?.rulesVersion?.rules)`
 * on every character load and on reset. Clearing the overlay alone is therefore NOT a teardown: a
 * retained `_hubContext` silently reinstalls the torn-down campaign rules on the next character
 * load. These tests pin the exclusive teardown owners and that leak specifically.
 */
import "./setup.js";
import {jest} from "@jest/globals";

const CAMPAIGN_RULES = {variantEncumbrance: true, criticalHitTables: true};

let CharacterSheetPage;
let originalCopyFast;

beforeAll(async () => {
	// `charactersheet.js` registers a `load` listener at module scope, and the Jest environment is
	// `node`. Stub just enough of `window` before importing it.
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		removeEventListener: () => {},
		location: {search: "", href: "http://localhost/charactersheet.html"},
	};
	// The shared setup stub round-trips through JSON and so throws on `undefined`, which the real
	// `MiscUtil.copyFast` tolerates. The overlay records `undefined` for absent settings keys.
	originalCopyFast = globalThis.MiscUtil.copyFast;
	globalThis.MiscUtil.copyFast = value => (value === undefined ? undefined : originalCopyFast(value));
	({CharacterSheetPage} = await import("../../../js/charactersheet/charactersheet.js"));
});

afterAll(() => {
	if (originalCopyFast) globalThis.MiscUtil.copyFast = originalCopyFast;
});

/** Build a page without running `pInit`, then attach only the hub state these owners touch. */
function makePage () {
	const page = new CharacterSheetPage({characterRepository: {}});
	page._hubContext = {rulesVersion: {rules: CAMPAIGN_RULES}};
	page._state.setCampaignSettingsOverlay(page._hubContext.rulesVersion.rules);
	return page;
}

function makeContentContext ({sources = ["PHB"], species = ["Human (Base)|PHB"], editions = ["2014"], id = "rules-1"} = {}) {
	return {
		rulesVersion: {
			id,
			rules: {},
			contentPolicy: {version: 1, sources, species, editions},
		},
		contentCatalog: {
			sources: ["PHB", "XPHB"],
			species: ["Human (Base)|PHB", "Elf|PHB", "Elf|XPHB"],
			sourceEditions: {PHB: "2014", XPHB: "2024"},
		},
	};
}

function getContentCandidates () {
	return [
		{name: "Human", source: "PHB", edition: "classic", __prop: "race", _baseName: "Human", _baseSource: "PHB"},
		{name: "Elf", source: "PHB", edition: "classic", __prop: "race"},
		{name: "Elf", source: "XPHB", edition: "one", __prop: "race"},
	];
}

function deferred () {
	let resolve;
	let reject;
	const promise = new Promise((resolve_, reject_) => {
		resolve = resolve_;
		reject = reject_;
	});
	return {promise, resolve, reject};
}

async function pFlushPromises () {
	await new Promise(resolve => setTimeout(resolve, 0));
}

describe("Character Sheet hub teardown owners", () => {
	it("applies campaign rules as a settings overlay while the context is active", () => {
		const page = makePage();
		expect(page._state.getSettings().variantEncumbrance).toBe(true);
	});

	it("clears campaign rules and drops the context so a later load cannot reinstall them", () => {
		const page = makePage();

		page._clearHubRules();

		expect(page._hubContext).toBeNull();
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();

		// This is the exact re-application performed by `_pLoadCharacter` / `_createNewCharacter`.
		page._state.clearCampaignSettingsOverlay();
		page._state.setCampaignSettingsOverlay(page._hubContext?.rulesVersion?.rules);
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();
	});

	it("is idempotent", () => {
		const page = makePage();
		page._clearHubRules();
		expect(() => page._clearHubRules()).not.toThrow();
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();
	});

	it("keeps each teardown owner exclusive so no stage does another stage's work", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		const order = [];
		page._hubRealtime = {detach: () => order.push("realtime")};
		page._hubEffects = {deactivate: () => order.push("effects")};
		page._partyInventory = {detach: () => order.push("partyInventory")};
		page._characterRepository = {clearRealtimeReconciliation: () => order.push("reconciliation")};

		const generationBefore = page._hubRealtimeGeneration;
		page._fenceHubGeneration();
		expect(page._hubRealtimeGeneration).toBe(generationBefore + 1);
		expect(order).toEqual([]);

		page._detachHubRealtimeClient();
		// The realtime owner touches only the realtime client.
		expect(order).toEqual(["realtime"]);

		page._detachHubProjections();
		expect(order).toEqual(["realtime", "partyInventory", "effects", "reconciliation"]);
	});

	it("keeps the composed detach helper covering every non-rules owner exactly once", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		const order = [];
		page._hubRealtime = {detach: () => order.push("realtime")};
		page._hubEffects = {deactivate: () => order.push("effects")};
		page._partyInventory = {detach: () => order.push("partyInventory")};
		page._characterRepository = {clearRealtimeReconciliation: () => order.push("reconciliation")};

		page._detachHubRealtime();

		expect(order).toEqual(["realtime", "partyInventory", "effects", "reconciliation"]);
		for (const stage of ["realtime", "partyInventory", "effects", "reconciliation"]) {
			expect(order.filter(entry => entry === stage)).toHaveLength(1);
		}
	});

	it("leaves teardown owners safe when the hub subsystems were never created", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		expect(() => {
			page._fenceHubGeneration();
			page._detachHubRealtimeClient();
			page._detachHubProjections();
			page._clearHubRules();
		}).not.toThrow();
	});

	it("is resource-pinned from coordinator creation, before heavy initialisation finishes", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		const host = page._getHubActiveCampaignHost();

		// `_currentCharacterId` is only set after characters load. If pinning waited for it, a
		// remote selection arriving mid-startup would be treated as a free switch and could abort
		// or rebind this page while its URL, repository, and realtime still point at campaign A.
		expect(page._currentCharacterId).toBeFalsy();
		expect(host.isResourcePinned()).toBe(true);
	});

	it("only activates context for the campaign the page is bound to", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._hubCampaignId = "33333333-3333-4333-8333-333333333333";
		const host = page._getHubActiveCampaignHost();

		expect(host.shouldActivateContext({campaignId: page._hubCampaignId})).toBe(true);
		// The repository, realtime, roll log, and URL are bound to `_hubCampaignId`; activating a
		// different campaign's rules here would desynchronise them.
		expect(host.shouldActivateContext({campaignId: "44444444-4444-4444-8444-444444444444"})).toBe(false);
	});

	it("conceals private character state before later teardown stages run", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._isHubCharacter = true;
		page._currentCharacterId = "private-character";
		page._state._data.name = "Private Character";
		const host = page._getHubActiveCampaignHost();

		await host.pTeardownProjections();

		expect(page._currentCharacterId).toBeNull();
		expect(page._state._data.name).toBe("");
	});

	it("places the access-loss alert outside the render-replaceable sheet root", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._isHubCharacter = true;
		page._currentCharacterId = "private-character";
		page._state._data.name = "Private Character";
		const calls = [];
		const message = {setAttribute: (...args) => calls.push(["setAttribute", ...args])};
		const main = {
			before: value => calls.push(["before", value]),
			hidden: false,
			replaceChildren: () => calls.push(["replaceChildren"]),
		};
		const staleMessage = {remove: () => calls.push(["removeStale"])};
		const previousDocument = globalThis.document;
		globalThis.document = {
			body: {append: value => calls.push(["append", value])},
			createElement: () => message,
			getElementById: () => staleMessage,
			querySelector: () => main,
		};

		try {
			page._concealHubPrivateCharacter();
		} finally {
			globalThis.document = previousDocument;
		}

		expect(calls).toContainEqual(["replaceChildren"]);
		expect(main.hidden).toBe(true);
		expect(calls).toContainEqual(["removeStale"]);
		expect(message).toMatchObject({
			id: "charsheet-campaign-access-ended",
			className: "ve-flex-vh-center ve-h-100 ve-muted",
			textContent: "Campaign access ended. Reload or return to the Campaign Hub.",
		});
		expect(calls).toContainEqual(["setAttribute", "role", "alert"]);
		expect(calls).toContainEqual(["before", message]);
		expect(calls).not.toContainEqual(["append", message]);
	});
});

describe("Character Sheet campaign content context lifecycle", () => {
	it("intersects source, edition, and species policy while leaving local sheets unchanged", () => {
		const localPage = new CharacterSheetPage({characterRepository: {}});
		expect(localPage.filterByAllowedSources(getContentCandidates())).toEqual(getContentCandidates());

		const campaignPage = new CharacterSheetPage({characterRepository: {}});
		campaignPage._applyHubContext(makeContentContext());
		expect(campaignPage.filterByAllowedSources(getContentCandidates())).toEqual([
			expect.objectContaining({name: "Human", source: "PHB", _baseName: "Human"}),
		]);
	});

	it("applies the server default catalog boundary before a campaign publishes rules", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext({
			rulesVersion: null,
			brewBundle: null,
			contentCatalog: {
				sources: ["PHB", "XPHB"],
				species: ["Human (Base)|PHB", "Elf|XPHB"],
				sourceEditions: {PHB: "2014", XPHB: "2024"},
			},
		});

		expect(page.filterByAllowedSources([
			...getContentCandidates(),
			{name: "Personal feat", source: "PERSONAL", __prop: "feat", edition: "classic"},
		])).toEqual([
			expect.objectContaining({name: "Human", source: "PHB"}),
			expect.objectContaining({name: "Elf", source: "XPHB"}),
		]);
	});

	it("blocks candidates immediately during refresh and activates only the refreshed policy", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._renderCharacter = jest.fn();
		page._campaign = {render: jest.fn()};
		const refresh = deferred();
		page._hubCampaignContext = {pRefresh: jest.fn(() => refresh.promise)};

		page._onHubCampaignContextChanged();

		expect(page._isHubContextRefreshing).toBe(true);
		expect(page._hubContext).toBeNull();
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([]);

		refresh.resolve(makeContentContext({
			sources: ["XPHB"],
			species: ["Elf|XPHB"],
			editions: ["2024"],
			id: "rules-2",
		}));
		await pFlushPromises();

		expect(page._isHubContextRefreshing).toBe(false);
		expect(page._hubContext.rulesVersion.id).toBe("rules-2");
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([
			expect.objectContaining({name: "Elf", source: "XPHB"}),
		]);
		expect(page._renderCharacter).toHaveBeenCalledTimes(1);
	});

	it.each([
		{type: "rules.activated", aggregateId: "rules-1"},
		{type: "brew.activated", aggregateId: "brew-1"},
	])("ignores a replay of the already-active $type context", ({type, aggregateId}) => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext({
			...makeContentContext(),
			brewBundle: {id: "brew-1", contentHash: "hash-1"},
		});
		page._campaign = {render: jest.fn()};
		page._hubCampaignContext = {pRefresh: jest.fn()};

		page._onHubCampaignContextChanged({type, aggregateId});

		expect(page._hubCampaignContext.pRefresh).not.toHaveBeenCalled();
		expect(page._hubContext.rulesVersion.id).toBe("rules-1");
		expect(page._isHubContextRefreshing).toBe(false);
	});

	it("ignores an authoritative cursor that matches the active context", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext({
			...makeContentContext(),
			brewBundle: {id: "brew-1", contentHash: "hash-1"},
		});
		page._campaign = {render: jest.fn()};
		page._hubCampaignContext = {pRefresh: jest.fn()};

		page._onHubCampaignContextChanged({
			type: "campaign.cursor",
			rulesVersionId: "rules-1",
			brewBundleVersionId: "brew-1",
		});

		expect(page._hubCampaignContext.pRefresh).not.toHaveBeenCalled();
		expect(page._hubContext.rulesVersion.id).toBe("rules-1");
	});

	it("lets the newest activation supersede an in-flight context refresh", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._renderCharacter = jest.fn();
		page._campaign = {render: jest.fn()};
		const first = deferred();
		const second = deferred();
		page._hubCampaignContext = {
			pRefresh: jest.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		};

		page._onHubCampaignContextChanged({type: "rules.activated", aggregateId: "rules-2"});
		page._onHubCampaignContextChanged({type: "rules.activated", aggregateId: "rules-3"});
		first.resolve(makeContentContext({id: "rules-2"}));
		second.resolve(makeContentContext({
			sources: ["XPHB"],
			species: ["Elf|XPHB"],
			editions: ["2024"],
			id: "rules-3",
		}));
		await pFlushPromises();

		expect(page._hubContext.rulesVersion.id).toBe("rules-3");
		expect(page._isHubContextRefreshing).toBe(false);
		expect(page._renderCharacter).toHaveBeenCalledTimes(1);
	});

	it("discards a stale refresh after disconnect and cannot remain refresh-locked", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._campaign = {render: jest.fn()};
		page._characterRepository = {clearRealtimeReconciliation: jest.fn()};
		const refresh = deferred();
		page._hubCampaignContext = {pRefresh: jest.fn(() => refresh.promise)};

		page._onHubCampaignContextChanged();
		page._onHubRealtimeConnectionState({state: "closed"});
		refresh.resolve(makeContentContext({sources: ["XPHB"], species: ["Elf|XPHB"], editions: ["2024"], id: "stale"}));
		await pFlushPromises();

		expect(page._hubContext).toBeNull();
		expect(page._isHubContextUnavailable).toBe(true);
		expect(page._isHubContextRefreshing).toBe(false);
		expect(page._hubContextRefreshActiveGeneration).toBeNull();
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([]);
	});

	it("revalidates a closed connection on live but never reuses policy after access loss", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._renderCharacter = jest.fn();
		page._campaign = {render: jest.fn()};
		page._characterRepository = {clearRealtimeReconciliation: jest.fn()};
		page._hubCampaignContext = {
			pRefresh: jest.fn(async ({fnIsCurrent}) => fnIsCurrent()
				? makeContentContext({sources: ["XPHB"], species: ["Elf|XPHB"], editions: ["2024"], id: "rules-reconnected"})
				: null),
		};
		const campaignContext = page._hubCampaignContext;

		page._onHubRealtimeConnectionState({state: "closed"});
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([]);
		page._onHubRealtimeConnectionState({state: "live"});
		await pFlushPromises();

		expect(page._hubContext.rulesVersion.id).toBe("rules-reconnected");
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([
			expect.objectContaining({name: "Elf", source: "XPHB"}),
		]);

		page._onHubRealtimeConnectionState({state: "access_lost"});
		page._onHubRealtimeConnectionState({state: "live"});
		await pFlushPromises();

		expect(page._hubContext).toBeNull();
		expect(page._isHubContextUnavailable).toBe(true);
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([]);
		expect(campaignContext.pRefresh).toHaveBeenCalledTimes(1);
		expect(page._hubCampaignContext).toBeNull();
	});

	it("routes realtime access loss through the full campaign teardown", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._hubCampaignId = "campaign-1";
		page._applyHubContext(makeContentContext());
		page._campaign = {render: jest.fn()};
		page._hubActiveCampaign = {pHandleAccessLoss: jest.fn(async () => {})};

		page._onHubRealtimeConnectionState({state: "access_lost"});
		await pFlushPromises();

		expect(page._hubActiveCampaign.pHandleAccessLoss).toHaveBeenCalledWith({campaignId: "campaign-1"});
		expect(page._hubContext).toBeNull();
		expect(page._isHubContextUnavailable).toBe(true);
		expect(page._campaign.render).not.toHaveBeenCalled();
	});

	it("keeps candidates blocked after a failed refresh until a later successful revalidation", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._campaign = {render: jest.fn()};
		page._hubCampaignContext = {pRefresh: jest.fn(async () => { throw new Error("offline"); })};

		page._onHubCampaignContextChanged();
		await pFlushPromises();

		expect(page._hubContext).toBeNull();
		expect(page._isHubContextUnavailable).toBe(true);
		expect(page._isHubContextRevalidationRequired).toBe(true);
		expect(page._isHubContextRefreshing).toBe(false);
		expect(page.filterByAllowedSources(getContentCandidates())).toEqual([]);
	});

	it("fences an in-flight context refresh during rules teardown", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		page._applyHubContext(makeContentContext());
		page._campaign = {render: jest.fn()};
		page._renderCharacter = jest.fn();
		const refresh = deferred();
		page._hubCampaignContext = {pRefresh: jest.fn(() => refresh.promise)};

		page._onHubCampaignContextChanged({type: "rules.activated", aggregateId: "rules-2"});
		await page._getHubActiveCampaignHost().pTeardownRules();
		refresh.resolve(makeContentContext({id: "rules-2"}));
		await pFlushPromises();

		expect(page._hubContext).toBeNull();
		expect(page._isHubContextUnavailable).toBe(true);
		expect(page._isHubContextRefreshing).toBe(false);
		expect(page._renderCharacter).not.toHaveBeenCalled();
	});
});

describe("carry authority basis follows the campaign context lifecycle", () => {
	/**
	 * REGRESSION. The carry summary is only trusted when the basis it was stamped with matches
	 * the one the server expects. The server derives `kind: "campaign"` for any character with a
	 * `campaignId`, so a sheet that never stamps the context keeps publishing `kind: "detached"`,
	 * the two never match, and `carrySummary` is silently withheld for EVERY campaign character
	 * — a total, invisible loss of the feature rather than a wrong number.
	 *
	 * That is exactly what shipped in the first cut of this branch: `setCarryAuthorityContext()`
	 * existed with zero production call sites. These tests pin both halves of the lifecycle.
	 */
	const CONTEXT = {
		rulesVersion: {id: "rules-1", rules: CAMPAIGN_RULES},
		brewBundle: {contentHash: "brew-1"},
	};

	/** Drive the real activation hook rather than a hand-rolled imitation of it. */
	async function activate (page, context = CONTEXT) {
		await page._getHubActiveCampaignHost().pOnContextActivated({context});
	}

	it("stamps the campaign basis when the context activates", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		expect(page._state.getCarryAuthorityBasis().kind).toBe("detached");

		await activate(page);

		const basis = page._state.getCarryAuthorityBasis();
		expect(basis).toMatchObject({kind: "campaign", rulesVersionId: "rules-1", brewBundleHash: "brew-1"});
	});

	it("the stamped basis reaches the serialized document, which is what the server reads", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		await activate(page);
		expect(page._state.toJson().carry.basis).toMatchObject({
			kind: "campaign", rulesVersionId: "rules-1", brewBundleHash: "brew-1",
		});
	});

	it("records a campaign with no active rules version as an OBSERVATION, not as detached", async () => {
		// Null here means "there was no active rules version when I saved" — a real state. It
		// must still be a CAMPAIGN basis, so that activating a rules version later correctly
		// invalidates every summary authored before it.
		const page = new CharacterSheetPage({characterRepository: {}});
		await activate(page, {rulesVersion: null, brewBundle: null});
		expect(page._state.getCarryAuthorityBasis()).toMatchObject({
			kind: "campaign", rulesVersionId: null, brewBundleHash: null,
		});
	});

	it("returns to the detached basis through rules teardown", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		await activate(page);
		expect(page._state.getCarryAuthorityBasis().kind).toBe("campaign");

		page._clearHubRules();

		// A summary stamped with a campaign this sheet has left must stop claiming to be current.
		expect(page._state.getCarryAuthorityBasis().kind).toBe("detached");
	});

	it("moves in lockstep with the settings overlay, whose values feed the basis digest", async () => {
		// The digest covers the carry-relevant settings, which the overlay can change. If the
		// two were wired at different points, a character could carry a digest computed under
		// one rule set while stamped with another.
		const page = new CharacterSheetPage({characterRepository: {}});
		await activate(page);
		expect(page._state.getSettings().variantEncumbrance).toBe(true);
		expect(page._state.getCarryAuthorityBasis().kind).toBe("campaign");

		page._clearHubRules();
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();
		expect(page._state.getCarryAuthorityBasis().kind).toBe("detached");
	});

	it("teardown is idempotent for the basis too", async () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		await activate(page);
		page._clearHubRules();
		expect(() => page._clearHubRules()).not.toThrow();
		expect(page._state.getCarryAuthorityBasis().kind).toBe("detached");
	});
});
