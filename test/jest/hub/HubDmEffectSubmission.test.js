import fs from "node:fs";
import vm from "node:vm";
import {jest} from "@jest/globals";
import {HubApiError} from "../../../js/hub/hub-api-client.js";

const source = fs.readFileSync(new URL("../../../js/hub/hub-page.js", import.meta.url), "utf8");

function getSourceBetween (start, end) {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex);
	if (startIndex < 0 || endIndex < 0) throw new Error("Campaign effect handler source boundaries are missing.");
	return source.slice(startIndex, endIndex);
}

function createSubmission ({refreshError = null, changed = true, isRefreshCurrent = true} = {}) {
	const fields = new Map([
		["campaign-action-type", {value: "damage"}],
		["campaign-action-target", {value: "character:synthetic-target"}],
		["campaign-action-value", {value: "3"}],
		["campaign-action-slot-level", {value: "1"}],
		["campaign-action-slot-amount", {value: "1"}],
	]);
	let submit;
	let isCurrent = true;
	let privateVisible = true;
	fields.set("campaign-action-form", {
		addEventListener: (type, listener) => {
			if (type !== "submit") throw new Error("Unexpected campaign effect listener.");
			submit = listener;
		},
	});
	const conceal = () => {
		isCurrent = false;
		privateVisible = false;
	};
	const context = {
		HubApiError,
		document: {getElementById: id => fields.get(id)},
		campaignAuthorizationErrorHandler: null,
		isCampaignReloadRequired: false,
		captureProjectionAuthorization: () => () => isCurrent,
		setFormStatus: jest.fn(),
		getFormFingerprint: () => "synthetic-effect",
		pRunFormMutation: ({fnMutate}) => fnMutate("synthetic-command"),
		conditionCatalogByUid: new Map(),
		actionCondition: {value: ""},
		api: {pCreateStructuredAction: jest.fn().mockResolvedValue({operation: {changed}})},
		campaign: {},
		campaignId: "synthetic-campaign",
		session: {},
		targetCharacters: [],
		members: [],
		rosterRef: {current: []},
		renderPendingActions: jest.fn(async () => {
			isCurrent = isRefreshCurrent;
			if (refreshError) throw refreshError;
		}),
		deferMutationUi: jest.fn(),
		concealCampaignAuthorization: jest.fn(conceal),
		concealInventoryAuthorization: jest.fn(conceal),
		showSignedOutAfterSessionExpiry: jest.fn(conceal),
		stopCampaignLiveUpdates: jest.fn(),
		renderError: jest.fn(),
		console: {error: jest.fn()},
	};
	// Execute the shipped listener and its real authorization dispatcher, not a duplicated handler.
	vm.runInNewContext(
		getSourceBetween("\tconst handleCampaignAuthorizationError = error => {", "\tbindHubActivityHistoryPagination({")
		+ getSourceBetween(
			"\tdocument.getElementById(\"campaign-action-form\")?.addEventListener(\"submit\"",
			"\tdocument.getElementById(\"campaign-xp-form\")?.addEventListener(\"submit\"",
		),
		context,
	);
	if (!submit) throw new Error("Campaign effect submit listener was not registered.");
	return {
		context,
		fields,
		isPrivateVisible: () => privateVisible,
		submit: () => submit({preventDefault: jest.fn(), currentTarget: fields.get("campaign-action-form")}),
	};
}

describe("Campaign DM effect post-commit refresh", () => {
	it.each(["AUTH_REQUIRED", "FORBIDDEN", "CAMPAIGN_NOT_FOUND", "MEMBERSHIP_NOT_FOUND"])(
		"fences private campaign data when refresh returns %s after a committed effect",
		async code => {
			const error = new HubApiError({code, status: code === "AUTH_REQUIRED" ? 401 : 403});
			const fixture = createSubmission({refreshError: error});
			await fixture.submit();
			expect(fixture.context.api.pCreateStructuredAction).toHaveBeenCalledTimes(1);
			expect(fixture.context.concealInventoryAuthorization).toHaveBeenCalledTimes(code === "AUTH_REQUIRED" ? 1 : 0);
			expect(fixture.context.stopCampaignLiveUpdates).toHaveBeenCalledTimes(1);
			expect(fixture.context.renderError).toHaveBeenCalledWith(error, {isAuthorizationHandled: true});
			expect(fixture.isPrivateVisible()).toBe(false);
			expect(fixture.context.setFormStatus.mock.calls.some(([status]) => status.isError)).toBe(false);
			expect(fixture.context.console.error).not.toHaveBeenCalled();
		},
	);

	it("retains truthful committed success for a transient refresh failure without retrying the POST", async () => {
		const error = new HubApiError({code: "SERVER_ERROR", status: 503});
		const fixture = createSubmission({refreshError: error});
		await fixture.submit();
		expect(fixture.context.api.pCreateStructuredAction).toHaveBeenCalledTimes(1);
		expect(fixture.context.renderError).not.toHaveBeenCalled();
		expect(fixture.context.stopCampaignLiveUpdates).not.toHaveBeenCalled();
		expect(fixture.isPrivateVisible()).toBe(true);
		expect(fixture.context.setFormStatus).toHaveBeenLastCalledWith({
			formId: "campaign-action-form",
			message: "Effect applied. Pending requests could not be refreshed; use Refresh to retry the read.",
		});
		expect(fixture.context.console.error).toHaveBeenCalledWith("Effect committed but pending-action refresh failed:", error);
	});

	it("does not publish a stale refresh failure after another authorization fence wins", async () => {
		const fixture = createSubmission({
			refreshError: new HubApiError({code: "FORBIDDEN", status: 403}),
			isRefreshCurrent: false,
		});
		await fixture.submit();
		expect(fixture.context.renderError).not.toHaveBeenCalled();
		expect(fixture.context.setFormStatus).toHaveBeenLastCalledWith({formId: "campaign-action-form", message: "Effect applied."});
	});

	it("records a valid no-op once and refreshes normally", async () => {
		const fixture = createSubmission({changed: false});
		await fixture.submit();
		expect(fixture.context.api.pCreateStructuredAction).toHaveBeenCalledTimes(1);
		expect(fixture.context.renderPendingActions).toHaveBeenCalledTimes(1);
		expect(fixture.context.setFormStatus).toHaveBeenLastCalledWith({
			formId: "campaign-action-form",
			message: "Effect recorded; the character was already in that state.",
		});
		expect(fixture.fields.get("campaign-action-value").value).toBe("");
	});
});
