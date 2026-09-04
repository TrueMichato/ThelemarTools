import {jest} from "@jest/globals";

import {HubRulesPolicyManager} from "../../../js/hub/hub-rules-policy-manager.js";

function getManager (overrides = {}) {
	return Object.assign(Object.create(HubRulesPolicyManager.prototype), {
		_campaignId: "campaign",
		_context: {},
		_management: {activeRulesVersionId: null, versions: []},
		_draft: {dirty: true},
		_isBusy: false,
		_isOffline: false,
		_isPolicyRefreshRequired: false,
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
});
