import {jest} from "@jest/globals";

import {
	adaptLegacyCampaignRules,
	createDefaultCampaignRulesPolicy,
} from "../../../js/hub/hub-campaign-rules.js";
import {HubRulesPolicyManager} from "../../../js/hub/hub-rules-policy-manager.js";

function getManager (overrides = {}) {
	return Object.assign(Object.create(HubRulesPolicyManager.prototype), {
		_campaignId: "campaign",
		_context: {},
		_management: {activeRulesVersionId: null, versions: []},
		_draft: {dirty: true},
		_isBusy: false,
		_isLoading: false,
		_isOffline: false,
		_isPolicyRefreshRequired: false,
		_policyLoadGeneration: 0,
		_pendingPolicyLoads: 0,
		_setLoading: jest.fn(),
		_setStatus: jest.fn(),
		_renderFilters: jest.fn(),
		_renderCatalog: jest.fn(),
		_renderHistory: jest.fn(),
		_renderReview: jest.fn(),
		_renderRollbackReview: jest.fn(),
		_fnRenderError: jest.fn(),
		...overrides,
	});
}

function getDeferred () {
	let resolve;
	const promise = new Promise(resolve_ => resolve = resolve_);
	return {promise, resolve};
}

function getElement (overrides = {}) {
	return {
		append (...children) { this.children.push(...children); },
		children: [],
		classList: {toggle: jest.fn()},
		dataset: {},
		disabled: false,
		replaceChildren (...children) {
			this.children = children;
			this.textContent = "";
		},
		setAttribute: jest.fn(),
		textContent: "",
		...overrides,
	};
}

describe("HubRulesPolicyManager freshness", () => {
	it("preserves a dirty draft but keeps mutations disabled across offline to online", () => {
		const manager = getManager();
		const draft = manager._draft;
		manager._handleOffline();
		manager._handleOnline();
		expect(manager._draft).toBe(draft);
		expect(manager._isOffline).toBe(false);
		expect(manager._isPolicyRefreshRequired).toBe(true);
		expect(manager._isMutationUnavailable()).toBe(true);
		expect(manager._setStatus).toHaveBeenLastCalledWith(
			"Back online. Reload policy history before activating changes.",
			true,
		);
	});

	it("clears the reconnect gate only after policy history reload succeeds", async () => {
		const manager = getManager({
			_isPolicyRefreshRequired: true,
			_api: {pGetRulesPolicyManagement: jest.fn().mockRejectedValueOnce(new Error("offline"))},
		});
		await manager._pLoad({preservedDraft: manager._draft});
		expect(manager._isPolicyRefreshRequired).toBe(true);
		manager._api.pGetRulesPolicyManagement.mockResolvedValueOnce({
			catalog: {categories: [], rules: []},
			management: {activeRulesVersionId: null, versions: []},
		});
		await manager._pLoad({preservedDraft: manager._draft});
		expect(manager._isPolicyRefreshRequired).toBe(false);
		expect(manager._isMutationUnavailable()).toBe(false);
	});

	it("ignores a policy load that started before offline and requires a post-reconnect load", async () => {
		const delayed = getDeferred();
		const originalManagement = {activeRulesVersionId: null, versions: []};
		const manager = getManager({
			_api: {pGetRulesPolicyManagement: jest.fn().mockReturnValueOnce(delayed.promise)},
			_management: originalManagement,
		});
		const loading = manager._pLoad({preservedDraft: manager._draft});
		manager._handleOffline();
		manager._handleOnline();
		delayed.resolve({
			catalog: {categories: [], rules: []},
			management: {activeRulesVersionId: "stale", versions: [{id: "stale"}]},
		});
		await loading;

		expect(manager._management).toBe(originalManagement);
		expect(manager._isPolicyRefreshRequired).toBe(true);
		expect(manager._isMutationUnavailable()).toBe(true);

		manager._api.pGetRulesPolicyManagement.mockResolvedValueOnce({
			catalog: {categories: [], rules: []},
			management: {activeRulesVersionId: null, versions: []},
		});
		await manager._pLoad({preservedDraft: manager._draft});
		expect(manager._isPolicyRefreshRequired).toBe(false);
		expect(manager._isMutationUnavailable()).toBe(false);
	});
});

describe("HubRulesPolicyManager historical preview", () => {
	let previousDocument;

	beforeEach(() => previousDocument = globalThis.document);
	afterEach(() => globalThis.document = previousDocument);

	it("previews and enables rollback to an exact compatibility-tolerant legacy policy", () => {
		const active = {
			id: "active",
			schemaVersion: 2,
			policy: createDefaultCampaignRulesPolicy(),
		};
		const legacy = {
			id: "legacy",
			schemaVersion: 1,
			policy: adaptLegacyCampaignRules({enableTgtt: false}),
		};
		const select = getElement({value: legacy.id});
		const output = getElement();
		const button = getElement({disabled: true});
		const elements = {
			"campaign-rules-history": select,
			"campaign-rules-rollback-review": output,
			"campaign-rules-rollback": button,
		};
		globalThis.document = {
			createElement: () => getElement(),
			createTextNode: text => ({textContent: text}),
			getElementById: id => elements[id] || null,
		};
		const manager = getManager({
			_management: {
				activeRulesVersionId: active.id,
				versions: [active, legacy],
			},
			_renderRollbackReview: HubRulesPolicyManager.prototype._renderRollbackReview,
		});

		manager._renderRollbackReview();

		expect(output.children.map(child => child.textContent).join(" ")).toContain("Thelemar rules: On to Off");
		expect(button.disabled).toBe(false);
	});
});

describe("HubRulesPolicyManager busy controls", () => {
	let previousDocument;

	beforeEach(() => previousDocument = globalThis.document);
	afterEach(() => globalThis.document = previousDocument);

	it.each(["publish", "rollback"])("disables every policy control during a slow %s", async operation => {
		const delayed = getDeferred();
		const controls = [
			getElement(),
			getElement(),
			getElement({disabled: true}),
		];
		const history = getElement({value: "legacy"});
		const root = getElement({
			querySelectorAll: jest.fn().mockReturnValue(controls),
		});
		globalThis.document = {getElementById: id => id === "campaign-rules-history" ? history : null};
		const manager = getManager({
			_root: root,
			_management: {activeRulesVersionId: "active", versions: []},
			_draft: createDefaultCampaignRulesPolicy(),
			_api: operation === "publish"
				? {pPublishRulesPolicy: jest.fn().mockReturnValue(delayed.promise)}
				: {pActivateRulesPolicyVersion: jest.fn().mockReturnValue(delayed.promise)},
			_pRefreshContext: jest.fn(),
			_pLoad: jest.fn(),
		});

		const pending = operation === "publish" ? manager._pPublish() : manager._pRollback();
		expect(controls.every(control => control.disabled)).toBe(true);
		expect(root.setAttribute).toHaveBeenCalledWith("aria-busy", "true");

		delayed.resolve({rulesVersion: {version: 2}});
		await pending;

		expect(manager._isBusy).toBe(false);
		expect(controls.map(control => control.disabled)).toEqual([false, false, true]);
		expect(root.setAttribute).toHaveBeenLastCalledWith("aria-busy", "false");
	});
});
