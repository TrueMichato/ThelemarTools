import fs from "node:fs";
import {jest} from "@jest/globals";
import {
	bindHubActivityHistoryPagination,
	renderHubActivityRows,
} from "../../../js/hub/hub-activity-render.js";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("campaign hub pages", () => {
	const hubHtml = read("hub.html");
	const campaignHtml = read("campaign.html");
	const scss = read("scss/hub.scss");
	const navigation = read("js/navigation.js");
	const rulesPolicyManager = read("js/hub/hub-rules-policy-manager.js");
	const hubCampaignPage = read("test/e2e/pages/HubCampaignPage.ts");

	it("exposes signed-out, loading, error, and signed-in states", () => {
		for (const id of ["hub-loading", "hub-error", "hub-signed-out", "hub-signed-in"]) {
			expect(hubHtml).toContain(`id="${id}"`);
			expect(campaignHtml).toContain(`id="${id}"`);
		}
	});

	it("keeps campaign creation inline and keyboard-addressable", () => {
		expect(hubHtml).toContain("id=\"hub-create-form\"");
		expect(hubHtml).toContain("for=\"hub-campaign-name\"");
		expect(hubHtml).toContain("id=\"hub-create-submit\"");
		expect(hubHtml).toContain("id=\"hub-create-not-entitled\"");
		expect(hubHtml).not.toContain("<dialog");
	});

	it("explains creator entitlement and exposes only focused operator administration", () => {
		for (const id of [
			"hub-account-reauth",
			"hub-account-reauth-status",
			"hub-deletion-reauth",
			"hub-deletion-reauth-status",
			"hub-operator-panel",
			"hub-operator-status",
			"hub-operator-account-list",
			"hub-account-reauth",
			"hub-account-reauth-buttons",
		]) expect(hubHtml).toContain(`id="${id}"`);
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("HUB_CAPABILITY_ACCOUNT_ENTITLEMENTS");
		expect(source).toContain("hasAccountEntitlement(session, \"campaign:create\")");
		expect(source).toContain("pRenderAccountReauthentication");
		expect(source).toContain("hasAccountEntitlement(session, \"platform:operate\")");
		expect(source).toContain("pStartReauthentication");
		expect(source).toContain("accountAction=delete");
		expect(source).toContain("identities: result.identities");
		expect(source).toContain("pendingIdentityUnlinks");
		expect(source).toContain("pendingIdentityLinks");
		expect(source).toContain("isMutationOutcomeUncertain(error)");
		expect(source).toContain("Reload to refresh the device list.");
		expect(source).toContain("pGrantAccountEntitlement");
		expect(source).toContain("pRevokeAccountEntitlement");
		expect(source).toMatch(/Account \$\{account\.id\}/);
	});

	it("waits for both empty and populated campaign-list render states before creating another campaign", () => {
		expect(hubCampaignPage).toContain("#hub-campaign-list .hub-campaign-row, #hub-campaign-empty:not(.ve-hidden)");
		expect(hubCampaignPage).not.toContain("#hub-campaign-list .hub-data-row, #hub-campaign-empty:not(.ve-hidden)");
	});

	it("keeps legacy mutation coverage while releasing leases with the current protocol", () => {
		expect(hubCampaignPage).toMatch(/private async getMutationHeaders[\s\S]*?"x-hub-protocol-version": "3"/);
		expect(hubCampaignPage).toMatch(/private async getLeaseReleaseHeaders[\s\S]*?getMutationHeaders\(\)[\s\S]*?"x-hub-protocol-version": "6"/);
		expect(hubCampaignPage).toMatch(/async releaseCharacterLease[\s\S]*?headers: await this\.getLeaseReleaseHeaders\(\)/);
		expect(hubCampaignPage).toMatch(/Lease release failed with HTTP \$\{response\.status\(\)\}: \$\{responseBody\}/);
	});

	it("exposes account/session/deletion and campaign lifecycle controls", () => {
		for (const id of [
			"hub-sign-in-methods",
			"hub-identity-list",
			"hub-show-account-reauth",
			"hub-account-reauth",
			"hub-account-reauth-buttons",
			"hub-identity-status",
			"hub-session-list",
			"hub-revoke-other-sessions",
			"hub-request-deletion",
			"hub-account-deletion-pending",
			"hub-cancel-deletion",
		]) expect(hubHtml).toContain(`id="${id}"`);
		for (const id of ["campaign-invite-list", "campaign-leave"]) expect(campaignHtml).toContain(`id="${id}"`);
	});

	it("keeps ordinary reauthentication hidden until requested and handles callback success safely", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("getAccountReauthenticationReturnTo");
		expect(source).toContain("createPendingIdentityLinkReauthenticationIntent");
		expect(source).toContain("resolvePendingIdentityLinkReauthenticationIntent");
		expect(source).toContain(`trigger = "initial"`);
		expect(source).toContain(`trigger = "manual"`);
		for (const trigger of [
			"link-required",
			"unlink-required",
			"operator-required",
			"deletion-required",
			"deletion-pending",
		]) expect(source).toContain(`trigger: "${trigger}"`);
		expect(source).toContain("Reauthentication complete. Sensitive account changes are available for five minutes.");
		expect(source).toContain("Choose Link $" + "{pendingLinkProvider.label} again to continue.");
		expect(source).toContain("linkButton.focus()");
		expect(source).toContain("sessionStorage.removeItem(HUB_PENDING_IDENTITY_LINK_REAUTHENTICATION_STORAGE_KEY)");
	});

	it("organizes the campaign as a pinned session brief before administration", () => {
		for (const id of [
			"campaign-manifest-panel",
			"campaign-characters-panel",
			"campaign-party-panel",
			"campaign-inbox-panel",
			"campaign-workbench",
			"campaign-shared-actions",
			"campaign-activity-panel",
			"campaign-dm-controls",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml).toContain("CAMPAIGN HUB DIRECTION CONTRACT");
		expect(campaignHtml).toContain("Pinned session brief");
		expect(campaignHtml.indexOf("id=\"campaign-manifest-panel\""))
			.toBeLessThan(campaignHtml.indexOf("class=\"hub-campaign-admin\""));
		expect(campaignHtml.indexOf("id=\"campaign-inbox-panel\""))
			.toBeLessThan(campaignHtml.indexOf("id=\"campaign-manifest-panel\""));
		expect(campaignHtml.indexOf("id=\"campaign-manifest-panel\""))
			.toBeLessThan(campaignHtml.indexOf("id=\"campaign-activity-panel\""));
		expect(campaignHtml.indexOf("id=\"campaign-activity-panel\""))
			.toBeLessThan(campaignHtml.indexOf("id=\"campaign-workbench\""));
		expect(campaignHtml).toMatch(/<details id="campaign-workbench"[\s\S]*?<summary aria-describedby="campaign-workbench-description">/);
		expect(campaignHtml).not.toMatch(/<details id="campaign-workbench"[^>]*\sopen(?:\s|>)/);
		expect(campaignHtml).toContain("<details class=\"hub-disclosure\">");
		expect(campaignHtml).toContain("People and invitations");
		expect(campaignHtml).toContain("Rules and homebrew");
		expect(campaignHtml).not.toContain("<dialog");
	});

	it("preserves every campaign action behind semantic progressive disclosure", () => {
		for (const id of [
			"campaign-upload-local",
			"campaign-action-form",
			"campaign-transfer-form",
			"campaign-xp-form",
			"campaign-item-form",
			"campaign-member-list",
			"campaign-invite-form",
			"campaign-leave",
			"campaign-brew-form",
			"campaign-rules-form",
			"campaign-rules-policy-manager",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml.indexOf("id=\"campaign-workbench\""))
			.toBeLessThan(campaignHtml.indexOf("id=\"campaign-shared-actions\""));
		expect(campaignHtml.indexOf("class=\"hub-campaign-admin\""))
			.toBeLessThan(campaignHtml.indexOf("id=\"campaign-member-list\""));
	});

	it("provides explicit campaign loading, connection, empty, and mutation feedback", () => {
		for (const id of [
			"campaign-connection-status",
			"campaign-character-empty",
			"campaign-party-empty",
			"campaign-pending-actions-empty",
			"campaign-pending-transfers-empty",
			"campaign-activity-empty",
			"campaign-activity-status",
			"campaign-activity-load-earlier",
			"campaign-invite-form-status",
			"campaign-action-form-status",
			"campaign-transfer-form-status",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml).toContain("aria-live=\"polite\"");
		expect(campaignHtml).toContain("data-pending-label=\"Applying...\"");
	});

	it("keeps transfer submission recoverable after a successful mutation outlives its refresh", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("HubTransferProposalDrafts");
		expect(source).toContain("transferProposalDrafts.stage");
		expect(source).toContain("transferProposalDrafts.get(proposalRef)");
		expect(source).toContain("proposalRequest.isAutoResolved");
		expect(source).toContain("transferProposalDrafts.isReplayable");
		expect(source).toContain("HubTransferProposalDrafts.reconcileExpiredProposal");
		expect(source).toContain("transfers: refreshResult.transfers");
		expect(source).toContain("This request remains locked to prevent a duplicate");
		expect(source).toContain("The original transfer was found and is still pending.");
		expect(source).toContain("No matching transfer was found. Latest balances are loaded");
		expect(source).toContain("Retry transfer");
		expect(source).toContain("Retry to reconcile the same transfer.");
		expect(source).toContain("Refresh latest balances");
		expect(source).toContain("form._hubMutationKey = null");
		expect(source).toContain("form._hubMutationFingerprint = null");
		expect(source).toContain("setTransferRefreshFailure");
		expect(source).toContain("if (!form?.isConnected) return;");
		expect(source).toContain("form._hubTransferRefreshRecovery");
		expect(source).toContain("applyTransferRefreshRecoverySuccess");
		expect(source).toContain("const form = event.currentTarget;");
		expect(source).toContain("Retry latest balances");
		expect(source).toContain("Latest balances loaded. You can send another transfer.");
		expect(source).toContain("retry.dataset.hubProjectionRecoveryControl = \"true\"");
		expect(source).toContain("concealProjectionFormControl");
		expect(source).toContain("const latestSelections = readSelections();");
		expect(source).toContain("selectionsToRestore");
		expect(source).toContain("if (sourceKind !== \"character\") return false;");
		expect(source).toContain("Request sent. A DM must approve before anything leaves the party inventory.");
		expect(source).toMatch(/applyTransferSuccessUi\(\);\s+try \{\s+await pRefreshTransferState\(\{fnIsCurrent\}\);\s+\} catch \{\s+setTransferRefreshFailure\(/);
		expect(source).not.toContain("Reload the campaign before sending another transfer.");
		expect(source).not.toContain("event.currentTarget.querySelector(\"button[type='submit']\").disabled = true");
	});

	it("keeps inbox transfer decisions idempotent and separates committed outcomes from refresh failures", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("HubTransferResolutionDrafts");
		expect(source).toContain("HubTransferRefreshQueue");
		expect(source).toContain("transferRefreshQueue.pRun");
		expect(source).toContain("const pTransferStateRefresh = pRefreshTransferState({");
		expect(source).toContain("charactersNxt: pCharactersNxt");
		expect(source).toContain("snapshotNxt: pSnapshotNxt");
		expect(source).toContain("fnIsSnapshotCurrent: snapshotNxt => snapshotNxt.lastSequence >= liveLastSequence");
		expect(source).toContain("const acceptedSnapshot = snapshotNxt && fnIsSnapshotCurrent(snapshotNxt)");
		expect(source).toContain("if (acceptedSnapshot?.roster) rosterRef.current = acceptedSnapshot.roster");
		expect(source).toContain("pResolveTransferAndRefresh");
		expect(source).toContain("transferResolutionDrafts.stage");
		expect(source).toContain("pResolveTransferFromDraft");
		expect(source).toContain("error?.code !== \"RULES_VERSION_STALE\"");
		expect(source).toContain("const isDefinitiveWithoutPending = error instanceof HubApiError");
		expect(source).toContain("&& !isTransferOutcomeUncertain(error)");
		expect(source).toContain("if (isDefinitiveWithoutPending) {");
		expect(source).toContain("await pRefreshTransferState({fnIsCurrent})");
		expect(source).toContain("The latest balances could not be loaded.");
		expect(source).toContain("setTransferProposalControls");
		expect(source).toContain("form._hubTransferControlStates");
		expect(source).toContain("const transfers = await api.pListTransfers({campaignId})");
		expect(source).toContain("const currentTransfer = transfers.find(it => it.id === proposed.transfer.id)");
		expect(source).toContain("option[data-hub-frozen-proposal]");
		expect(source).toContain("Original item stack");
		expect(source).toContain("const pendingProposal = transferProposalDrafts.get({accountId: session.account.id, campaignId})");
		expect(source).toContain("resolutionRequest.decision !== decision");
		expect(source).toContain("transferResolutionDrafts.isReplayable");
		expect(source).toContain("transferResolutionDrafts.reconcilePending");
		expect(source).toContain("Transfer applied.");
		expect(source).toContain("The committed outcome is safe");
		expect(source).toContain("The transfer outcome is not yet confirmed.");
		expect(source).toContain("Retry inbox refresh");
		expect(source).toContain("fnIsCurrentAtAdmission = refresh.fnIsCurrent || captureProjectionAuthorization()");
		expect(source).toContain("if (!fnIsCurrent() || transferState.isFenced) return {pendingTransferIds: [], isFenced: true}");
		expect(source).toMatch(/const restoreTransferControlState = \(\) => \{[\s\S]*if \(!fnIsCurrent\(\)\) return false;[\s\S]*delete form\?\._hubProjectionTransferDraft/);
		expect(source).toContain("button.disabled = isCampaignReloadRequired || !!form._hubProjectionControlStates");
		expect(source).not.toMatch(/pResolveTransfer\([\s\S]{0,300}idempotencyKey: crypto\.randomUUID\(\)/);
	});

	it("requires an explicit source identity for condition effects", () => {
		const source = read("js/hub/hub-page.js");
		const topLevelImports = source.slice(0, source.indexOf("const api = new HubApiClient();"));
		expect(campaignHtml).toContain("id=\"campaign-action-condition\"");
		expect(campaignHtml).not.toContain("id=\"campaign-action-condition-source\"");
		expect(topLevelImports).not.toContain("hub-condition-catalog.js");
		expect(source).toContain("const CONDITION_CATALOG_MODULE_URLS = Object.freeze([");
		expect(source).toContain("\"./hub-condition-catalog.js?retry=2\"");
		expect(source).toContain("let conditionCatalogModuleAttemptIndex = 0;");
		expect(source).toContain("conditionCatalogModule = await import(conditionCatalogModuleUrl);");
		expect(source).toContain("CONDITION_CATALOG_MODULE_URLS[conditionCatalogModuleAttemptIndex++]");
		expect(source).toMatch(/conditionCatalogModuleAttemptIndex\s*<\s*CONDITION_CATALOG_MODULE_URLS\.length/);
		expect(source).toContain("\"module_failed\"");
		expect(source).toContain("conditionCatalogState = \"module_exhausted\"");
		expect(source).toContain("conditionCatalogState = \"data_failed\"");
		expect(source).not.toContain("conditionCatalogState === \"failed\"");
		expect(source).not.toContain("await pRefreshConditionCatalog({campaignBrewContent: context.brewBundle?.content});");
		expect(source).toMatch(/if \(isRetryConditionCatalog && \["idle", "module_failed", "data_failed"\]\.includes\(conditionCatalogState\)\) \{\s+void pRefreshConditionCatalog/);
		expect(source).toContain("pLoadCampaignConditionCatalog");
		expect(source).toContain("conditionCatalogByUid");
		expect(source).toContain("getCurrentTargetConditions");
		expect(source).toContain("event.type === \"brew.activated\"");
		expect(source).toContain("pRefreshContextBoundControls");
		expect(source).not.toContain("source: \"PHB\"");
	});

	it("labels another member's canonical sheet as DM inspection rather than editing", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("function renderCharacterList ({campaignId, characters, session, isDm})");
		expect(source).toContain("const isReadOnlyDm = isDm && character.ownerAccountId !== session.account.id");
		expect(source).toContain("Open this character in a read-only DM view");
		expect(source).toContain("\"Inspect sheet\" : \"Open sheet\"");
		expect(source).toContain("document.createElement(canOpen ? \"a\" : \"summary\")");
	});

	it("keeps loaded campaign data visible while offline and requires a refresh after reconnecting", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("window.addEventListener(\"offline\"");
		expect(source).toContain("Offline · shown data may be stale");
		expect(source).toContain("window.addEventListener(\"online\"");
		expect(source).toContain("Back online · reload to refresh");
		expect(source).toContain("Reload campaign");
		expect(scss).toContain(".hub-connection[data-state=\"offline\"]::before");
	});

	it("provides actionable protocol, service, access, resource, and validation failures", () => {
		const source = read("js/hub/hub-page.js");
		for (const code of [
			"NETWORK_UNAVAILABLE",
			"DATABASE_UNAVAILABLE",
			"PROTOCOL_UPDATE_REQUIRED",
			"FORBIDDEN",
			"CHARACTER_TOO_LARGE",
			"BREW_TOO_LARGE",
			"TRANSFER_INSUFFICIENT",
			"TRANSFER_ITEM_LINKED",
			"RESOURCE_INSUFFICIENT",
			"REVISION_CONFLICT",
			"LEASE_FENCED",
		]) expect(source).toContain(`case "${code}"`);
		expect(source).toContain("actionLabel = \"Reload now\"");
		expect(source).toContain("setCampaignReadOnlyAfterAccessChange(error)");
		expect(source).toContain("if (error instanceof HubApiError) renderError(error)");
	});

	it("keeps role-specific controls out of unavailable campaign views", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("applyCampaignRoleLayout({campaign, characters})");
		expect(source).toContain("setHidden(document.getElementById(\"campaign-open-dm-screen\"), !isDm)");
		expect(source).toContain("setHidden(document.getElementById(\"campaign-workbench\"), !canPlay)");
		expect(source).toContain("setHidden(document.getElementById(\"campaign-shared-actions\"), !canPlay)");
		expect(source).toContain("setHidden(document.getElementById(\"campaign-characters-panel\"), isSpectator)");
		expect(source).toContain("campaign.status === \"active\" && campaign.role === \"player\" ? characters : []");
		expect(source).toContain("playerCharacters.length === 1");
		expect(source).toContain("hasCharacterChoices ? \"Choose a character\" : \"Add a local character copy\"");
		expect(source).toContain("characterSetup.href = hasCharacterChoices ? \"#campaign-character-list\" : \"#campaign-upload-local\"");
		expect(source).toContain("setHidden(characterSetup, campaign.status !== \"active\" || campaign.role !== \"player\" || playerCharacters.length === 1)");
		expect(source).toContain("setHidden(readonlyPrimary, !isSpectator && campaign.status === \"active\")");
		expect(source).toContain("characters: charactersNxt,\n\t\t\t\tsession,\n\t\t\t\tisDm: [\"dm\", \"co_dm\"].includes(campaign.role)");
		expect(source).toContain("applyCampaignRoleLayout({campaign, characters: charactersNxt});");
		for (const id of [
			"campaign-open-primary-character",
			"campaign-open-character-setup",
			"campaign-open-dm-screen",
			"campaign-primary-readonly",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml).toContain("id=\"campaign-open-character-setup\" class=\"hub-button hub-button--primary ve-hidden\" href=\"#campaign-upload-local\"");
	});

	it("opens campaign actions before moving keyboard focus to a requested task", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("initCampaignWorkbenchLinks()");
		expect(source).toContain("if (workbench) workbench.open = true");
		expect(source).toContain("requestAnimationFrame(() => document.getElementById(targetId)?.querySelector(\"select, input, button\")?.focus())");
		expect(source).toContain("document.getElementById(\"campaign-open-character-setup\")?.addEventListener(\"click\"");
		expect(source).toContain("target?.matches(\"[tabindex], button, a, input, select, textarea\")");
		expect(campaignHtml).toContain("id=\"campaign-character-list\" class=\"hub-data-list hub-data-list--flush\" tabindex=\"-1\" aria-labelledby=\"campaign-character-title\"");
		expect(campaignHtml).toContain("href=\"#campaign-action-form\"");
		expect(campaignHtml).toContain("href=\"#campaign-transfer-form\"");
	});

	it("announces attention with text as well as restrained semantic color", () => {
		const source = read("js/hub/hub-page.js");
		expect(campaignHtml).toContain("id=\"campaign-attention-summary\"");
		expect(campaignHtml).toContain("data-attention=\"clear\"");
		expect(source).toContain("panel.dataset.attention = total ? \"pending\" : \"clear\"");
		expect(source).toContain("No pending requests.");
		expect(source).toContain("const canAct = isDm || campaign.role === \"player\"");
		expect(scss).toContain(".hub-campaign-attention[data-attention=\"pending\"] .hub-count");
	});

	it("renders a named inbox, recent activity, and copyable invite result", () => {
		const source = read("js/hub/hub-page.js");
		const activitySource = read("js/hub/hub-activity-render.js");
		expect(source).toContain("api.pListEventPage({");
		expect(source).toContain("beforeSequence:");
		expect(source).not.toContain("snapshot.lastSequence - 50");
		expect(activitySource).toContain("No additional visible activity in this window");
		expect(source).toContain("new HubRealtimeClient({campaignId, initialLastSequence: snapshot.lastSequence})");
		expect(source).toContain("realtime.on(\"event\", event =>");
		expect(source).toContain("realtime.on(\"cursor\", baseline =>");
		// ADR 0011: the page must not read character data off an event payload; every
		// invalidation is coalesced into an authorization-scoped HTTP refetch.
		expect(source).not.toContain("event.payload?.character");
		expect(source).not.toContain("character.projection.updated");
		expect(source).toMatch(/const reloadForAuthorityChange = createCampaignAuthorityChangeHandler\(\{[\s\S]*fnConcealAuthorization: concealCampaignAuthorization,[\s\S]*fnStopLiveUpdates: stopCampaignLiveUpdates,[\s\S]*fnReload: \(\) => window\.location\.reload\(\),[\s\S]*\}\)/);
		expect(source).toMatch(/realtime\.on\("event", event =>[\s\S]*reloadForAuthorityChange\(\)/);
		expect(source).toMatch(/realtime\.on\("cursor", baseline =>[\s\S]*reloadForAuthorityChange\(\)/);
		expect(source).toContain("let activityAuthorizationGeneration = 0");
		expect(source).toContain("getProjectionAuthorizationGeneration: () => projectionAuthorizationGeneration");
		expect(source).toContain("const captureProjectionAuthorization = () =>");
		expect(source).toContain("let projectionSnapshotLastSequence = snapshot.lastSequence;");
		expect(source).toContain("baselineSequence: projectionSnapshotLastSequence");
		expect(source).toContain("const deferMutationUi = ({form, fnApply}) =>");
		expect(source).toContain("requestProjectionRefresh()");
		expect(source).toMatch(/else if \(isProjectionRefreshSuccessful && refreshTimer == null\) \{\s+flushDeferredMutationUi\(\)/);
		expect(source).toContain("const isProjectionInvalidationCoveredByBaseline = isProjectionInvalidation");
		expect(source).toContain("if (isProjectionInvalidationCoveredByBaseline) return;");
		expect(source).toContain("let isActivityAuthorizationFenced = false");
		expect(source).toContain("const invalidateActivityAuthorization = () =>");
		expect(source).toContain("const concealCampaignAuthorization = ({isLoading = false} = {}) =>");
		expect(source).toContain("const concealCampaignProjectionAuthorization = () =>");
		expect(source).toMatch(/const concealCampaignAuthorization = \(\{isLoading = false\} = \{\}\) => \{[\s\S]*liveRoster = \[\];[\s\S]*concealCampaignAuthorizationSurfaces\(\)/);
		expect(source).toMatch(/function concealCampaignAuthorizationSurfaces \(\) \{[\s\S]*content\.replaceChildren\(\);[\s\S]*content\.classList\.add\("ve-hidden"\);[\s\S]*content\.setAttribute\("aria-hidden", "true"\)/);
		expect(source).toContain("const concealActivityAuthorization = ({isLoading = false} = {}) =>");
		expect(source).toMatch(/const concealActivityAuthorization = \(\{isLoading = false\} = \{\}\) => \{[\s\S]*liveEvents = \[\];[\s\S]*liveMembers = \[\];[\s\S]*renderRecentActivity\(\{[\s\S]*events: \[\],[\s\S]*isLoading,[\s\S]*isAuthorizationFenced: true/);
		expect(source).toContain("isActivityAuthorizationFenced = true");
		expect(source).toContain("isActivityAuthorizationFenced = false");
		expect(source).toContain("isActivityAuthorizationFenced ? [] : liveEvents");
		expect(source).toContain("[\"AUTH_REQUIRED\", \"FORBIDDEN\", \"CAMPAIGN_NOT_FOUND\", \"MEMBERSHIP_NOT_FOUND\"]");
		expect(source).toMatch(/async function pRenderSignedOutProviders \(\) \{[\s\S]*import\("\.\/hub-auth-providers\.js"\)[\s\S]*pRenderHubAuthProviders\(\{[\s\S]*signIn,[\s\S]*returnTo,[\s\S]*inviteToken: _pendingInviteToken/);
		expect(source).toContain("if (_pSignedOutProvidersRender) return _pSignedOutProvidersRender");
		expect(source).toContain("if (!signIn) return;");
		expect(source).toContain("_pSignedOutProvidersRender = null");
		expect(source).toMatch(/function showSignedOutAfterSessionExpiry \(\) \{[\s\S]*setHidden\(document\.getElementById\("hub-signed-in"\), false\);[\s\S]*setHidden\(signedOut, false\);[\s\S]*void pRenderSignedOutProviders\(\)\.catch\(error => renderError\(error\)\)/);
		expect(source).not.toMatch(/function showSignedOutAfterSessionExpiry \(\) \{[\s\S]*\/auth\/github\/start/);
		expect(activitySource).toContain("const requestAuthorizationGeneration = getAuthorizationGeneration()");
		expect(activitySource).toContain("requestAuthorizationGeneration !== getAuthorizationGeneration()");
		expect(source).toContain("const isProjectionInvalidation = event.type === \"character.projection.invalidated\"");
		expect(source).toContain("if (!targetCharacterId) throw new Error(\"Choose a target character.\")");
		expect(source).toMatch(/isProjectionInvalidation[\s\S]*concealCampaignProjectionAuthorization\(\)/);
		expect(source).toMatch(/pRefreshLiveViews = async \(\) => \{[\s\S]*fillCharacterSelect\([\s\S]*"campaign-action-target"[\s\S]*setFormAvailability\(\{[\s\S]*formId: "campaign-action-form"/);
		expect(source).toContain("Effect recorded; the character was already in that state.");
		expect(source).toContain("const handleCampaignAuthorizationError = error =>");
		expect(source).toMatch(/if \(error.code === "AUTH_REQUIRED"\) \{\s*stopCampaignLiveUpdates\(\);\s*showSignedOutAfterSessionExpiry\(\);\s*renderError\(error, \{isAuthorizationHandled: true\}\);\s*return true;\s*\}\s*concealCampaignAuthorization\(\);\s*stopCampaignLiveUpdates\(\);\s*renderError\(error, \{isAuthorizationHandled: true\}\);/);
		const sessionExpiryBranch = source.match(/if \(error.code === "AUTH_REQUIRED"\) \{([\s\S]*?)\n\t\t\}/)?.[1];
		expect(sessionExpiryBranch).toBeDefined();
		expect(sessionExpiryBranch).not.toContain("concealCampaignAuthorization()");
		expect(source.match(/showSignedOutAfterSessionExpiry\(\)/g)).toHaveLength(1);
		expect(source).toContain("isPreserveSelection: true");
		expect(source).toContain("let isTargetSelectionInitialized = false");
		expect(source).toMatch(/state === "access_lost"[\s\S]*handleCampaignAuthorizationError\(/);
		expect(source).toMatch(/onAuthorizationError:[\s\S]*handleCampaignAuthorizationError\(error\)/);
		expect(source).toContain("concealActivityAuthorization({isLoading: true})");
		expect(source).toMatch(/const \[membersNxt, charactersNxt, snapshotNxt, activityRefresh\] = await Promise\.all[\s\S]*if \(isCampaignReloadRequired\) return;/);
		expect(activitySource).toContain("requestAuthorizationGeneration === getAuthorizationGeneration()");
		expect(source).toContain("event.type === \"membership.role_changed\"");
		expect(source).toContain("event.payload?.accountId === session.account.id");
		expect(source).toContain("event.payload?.role !== campaign.role");
		expect(source).toContain("isRealtimeEventCoveredByBaseline({");
		expect(source).toContain("baselineSequence: authorityBaselineSequence");
		expect(source).toContain("isOwnRoleChange && !isOwnRoleChangeCoveredByBaseline");
		expect(source).toContain("authorityBaselineSequence = Math.max(authorityBaselineSequence, baseline?.cursor?.lastSequence || 0)");
		expect(source).toContain("baseline.membership.role !== campaign.role");
		expect(source).toContain("if (isCampaignReloadRequired) return;");
		expect(source).toContain("snapshotNxt.lastSequence >= liveLastSequence");
		expect(source).toContain("liveEvents = [...liveEvents.filter");
		expect(source).toContain("events: liveEvents");
		expect(source).toContain("getCharacterName(target)");
		expect(source).toContain("getTransferContainerName({transfer, endpoint: \"source\"");
		expect(source).toContain("DisplaySnapshot`]?.displayName || \"A character\"");
		expect(source).toContain("navigator.clipboard.writeText(inviteOutput.value)");
		expect(campaignHtml).toContain("id=\"campaign-invite-copy\"");
	});

	it("loads earlier activity for an archived campaign before active-only controls initialize", async () => {
		const source = read("js/hub/hub-page.js");
		expect(source.indexOf("bindHubActivityHistoryPagination({"))
			.toBeLessThan(source.indexOf("if (campaign.status !== \"active\")"));
		const listeners = {};
		const button = {
			disabled: false,
			addEventListener: (type, listener) => listeners[type] = listener,
		};
		const pageRequests = [];
		const renders = [];
		let state = {
			events: [{id: "event-2", sequence: 2}],
			characters: [],
			members: [],
			history: {hasMore: true, scannedBackThroughSequence: 2},
		};
		bindHubActivityHistoryPagination({
			button,
			pListEventPage: async request => {
				pageRequests.push(request);
				return {
					events: [{id: "event-1", sequence: 1}],
					history: {hasMore: false, scannedBackThroughSequence: 1},
				};
			},
			getState: () => state,
			setState: ({events, history}) => state = {...state, events, history},
			render: input => renders.push(input),
			renderError: error => { throw error; },
			getAuthorizationGeneration: () => 0,
			isTerminal: () => false,
		});

		await listeners.click();

		expect(pageRequests).toEqual([{beforeSequence: 2, limit: 50}]);
		expect(state.events.map(event => event.id)).toEqual(["event-1", "event-2"]);
		expect(state.history).toEqual({hasMore: false, scannedBackThroughSequence: 1});
		expect(renders.at(-1)).toEqual(expect.objectContaining({
			events: state.events,
			history: state.history,
			statusMessage: "",
		}));
		expect(button.disabled).toBe(false);
	});

	it("keeps earlier-activity paging fenced until authorized history is replaced", async () => {
		const listeners = {};
		let isAuthorizationFenced = true;
		const button = {
			disabled: true,
			addEventListener: (type, listener) => listeners[type] = listener,
		};
		const pListEventPage = jest.fn().mockResolvedValue({
			events: [],
			history: {hasMore: false, scannedBackThroughSequence: 1},
		});
		bindHubActivityHistoryPagination({
			button,
			pListEventPage,
			getState: () => ({
				events: [{id: "stale", sequence: 2}],
				characters: [],
				members: [],
				history: {hasMore: true, scannedBackThroughSequence: 2},
			}),
			setState: jest.fn(),
			render: jest.fn(),
			renderError: jest.fn(),
			getAuthorizationGeneration: () => 1,
			isAuthorizationFenced: () => isAuthorizationFenced,
			isTerminal: () => false,
		});

		await listeners.click();
		expect(pListEventPage).not.toHaveBeenCalled();
		expect(button.disabled).toBe(true);

		isAuthorizationFenced = false;
		await listeners.click();
		expect(pListEventPage).toHaveBeenCalledTimes(1);
	});

	it("keeps earlier-activity paging fenced after an authorization error", async () => {
		const listeners = {};
		let isAuthorizationFenced = false;
		const error = Object.assign(new Error("access lost"), {code: "CAMPAIGN_NOT_FOUND"});
		const button = {
			disabled: false,
			addEventListener: (type, listener) => listeners[type] = listener,
		};
		const renderError = jest.fn();
		bindHubActivityHistoryPagination({
			button,
			pListEventPage: jest.fn().mockRejectedValue(error),
			getState: () => ({
				events: [{id: "visible", sequence: 2}],
				characters: [],
				members: [],
				history: {hasMore: true, scannedBackThroughSequence: 2},
			}),
			setState: jest.fn(),
			render: jest.fn(),
			renderError,
			getAuthorizationGeneration: () => 0,
			isAuthorizationFenced: () => isAuthorizationFenced,
			onAuthorizationError: caught => {
				isAuthorizationFenced = caught === error;
				return isAuthorizationFenced;
			},
			isTerminal: () => isAuthorizationFenced,
		});

		await listeners.click();

		expect(renderError).toHaveBeenCalledWith(error);
		expect(button.disabled).toBe(true);
	});

	it("renders normalized character subjects safely and keeps activity rows usable on mobile", () => {
		const source = read("js/hub/hub-activity-render.js");
		expect(source).toContain("presentation.subject");
		expect(source).toContain("presentation.subject || presentation.actorName");
		expect(source).toContain("textContent = rollAttribution");
		expect(source).toContain("event.type === \"roll.logged\"");
		expect(source).not.toContain("innerHTML = presentation");
		expect(scss).toContain(".hub-activity-row__subject");
		expect(scss).toMatch(/@media \(width <= 720px\)[\s\S]*\.hub-activity-row\s*\{\s*grid-template-columns: 1fr/);
	});

	it("renders lifecycle subjects safely on a narrow client without raw identifiers", () => {
		const makeElement = tagName => ({
			tagName,
			children: [],
			className: "",
			textContent: "",
			dateTime: "",
			append (...children) {
				this.children.push(...children);
			},
		});
		const documentRef = {createElement: makeElement};
		const list = makeElement("div");
		list.replaceChildren = (...children) => {
			list.children = children;
		};
		const events = [
			{
				id: "event-archive",
				type: "character.archived",
				aggregateType: "character",
				aggregateId: "character-raw-id",
				payload: {characterNameSnapshot: {version: 1, displayName: "<img src=x onerror=alert(1)> Nyx"}},
			},
			{
				id: "event-transfer",
				type: "transfer.cancelled",
				aggregateType: "transfer",
				aggregateId: "transfer-raw-id",
				payload: {
					sourceKind: "character",
					sourceId: "source-raw-id",
					sourceCharacterNameSnapshot: {version: 1, displayName: "Source"},
					targetKind: "character",
					targetId: "target-raw-id",
					targetCharacterNameSnapshot: {version: 1, displayName: "<script>Rook</script>"},
				},
			},
		];
		renderHubActivityRows({
			list,
			events,
			characters: [],
			members: [],
			documentRef,
			getDateLabel: () => "now",
		});
		const text = node => `${node.textContent} ${node.children.map(text).join(" ")}`;
		expect(list.children).toHaveLength(2);
		expect(text(list)).toContain("Nyx was archived.");
		expect(text(list)).toContain("Rook's transfer was cancelled.");
		expect(text(list)).not.toMatch(/<|>|event-|character-|source-|target-|transfer-/);
		expect(list.children.every(row => row.className === "hub-activity-row")).toBe(true);
		expect(scss).toMatch(/@media \(width <= 720px\)[\s\S]*\.hub-activity-row\s*\{\s*grid-template-columns: 1fr/);
	});

	it("uses human-readable interaction controls instead of internal inventory identifiers", () => {
		const source = read("js/hub/hub-page.js");
		for (const type of ["cp", "sp", "ep", "gp", "pp"]) {
			expect(campaignHtml).toContain(`id="campaign-transfer-${type}"`);
		}
		expect(campaignHtml).toContain("<option value=\"spell_slot_spend\">");
		expect(campaignHtml).toMatch(/id="campaign-action-slot-amount"[^>]+required/);
		for (const itemSource of ["catalog", "recent", "campaign", "stash"]) {
			expect(campaignHtml).toContain(`id="campaign-item-source-${itemSource}"`);
		}
		expect(campaignHtml).toContain("id=\"campaign-item-targets\"");
		expect(campaignHtml).toContain("id=\"campaign-item-preview-list\"");
		expect(campaignHtml).toContain("maxlength=\"500\"");
		expect(campaignHtml).toContain("role=\"tablist\"");
		expect(source).toContain("import(\"./hub-item-catalog.js\")");
		expect(source).toContain("ownerAccountId: session.account.id");
		expect(source).toContain("itemAward.setCampaignBrewContent");
		expect(source).toMatch(/sourceKind\.value === "campaign_item" \|\| selectedItem\?\.sourceKind === "campaign_item"/);
		expect(source).toContain("api.pAwardItems");
		expect(source).toContain("getOrStageAwardMutationDraft");
		expect(source).toContain("form._hubAwardMutationDraft");
		expect(source).toContain("sessionStorage.setItem");
		expect(source).toContain("pFindAwardEventByCommandId");
		expect(source).toContain("actorCommandId: awardDraft.idempotencyKey");
		expect(source).toContain("fnGetSubmission: () => itemAward.getSubmission()");
		expect(source).toContain("isMutationOutcomeUncertain");
		expect(source).toContain("Retry previous award");
		expect(source).toMatch(/isAwardRetryRequired = isMutationOutcomeUncertain\(error\)/);
		expect(source).toMatch(/itemAward\.setPending\(isAwardRetryRequired, \{isRetry: isAwardRetryRequired\}\)/);
		expect(source).toMatch(/if \(isRetry\) submit\.disabled = false;\s+applyPendingControlState\(\)/);
		expect(source).toMatch(/if \(!result\) return;\s+itemAward\.setPending\(true\);\s+clearAwardDraftState\(\)/);
		expect(source).toMatch(/setTargets \(nextTargets\) \{\s+if \(isRetryPending\) return;/);
		expect(source).toContain("form._hubItemAwardRetryPending = isRetryPending");
		expect(source).toMatch(/isItemAwardRetryPending[\s\S]*\? \[\] : \["campaign-item-targets", "campaign-item-preview-list"\]/);
		expect(source).toContain("form._hubProjectionControlRestores.add(restorePendingControlStates)");
		expect(source).toMatch(/delete form\._hubProjectionControlRestores;\s+for \(const fnRestore of deferredControlRestores\) fnRestore\(\)/);
		expect(source).toMatch(/const deferAwardCompletionUi = \(\{isApplySuccessUi = false\} = \{\}\) => \{[\s\S]*if \(isApplySuccessUi\) applyAwardSuccessUi\(\);[\s\S]*itemAward\.focusPrimary\(\)/);
		expect(source).toMatch(/if \(!fnIsCurrent\(\)\) \{\s+deferAwardCompletionUi\(\{isApplySuccessUi: true\}\);\s+return;\s+\}\s+applyAwardSuccessUi\(\)/);
		expect(source).toContain("if (!fnIsCurrent() || refreshResult?.isFenced) {");
		expect(source).toContain("deferAwardCompletionUi();");
		expect(source).toContain(".sort(([idA], [idB]) => idA.localeCompare(idB))");
		expect(source).toContain("getTransferContentsDescription(transfer)");
		expect(campaignHtml).not.toContain("Item entry ID");
		expect(campaignHtml).not.toContain("Custom item name");
	});

	it("loads the same hub client on both surfaces", () => {
		expect(hubHtml).toContain("src=\"js/hub/hub-page.js\"");
		expect(campaignHtml).toContain("src=\"js/hub/hub-page.js\"");
	});

	it("loads local character storage only when the copy flow is opened", () => {
		const source = read("js/hub/hub-page.js");
		expect(campaignHtml).not.toContain("src=\"lib/localforage.js\"");
		expect(campaignHtml).toContain("id=\"campaign-upload-local-select\"");
		expect(source).toContain("import(\"./hub-local-character-adapter.js\")");
		expect(source).not.toContain("globalThis.StorageUtil");
		expect(source).not.toContain("globalThis.InputUiUtil");
	});

	it("uses the latest campaign context for long-lived mutation forms", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toMatch(/async function pInitCampaignForms \(\{[\s\S]*\}\) \{[\s\S]*let currentContext = context;/);
		expect(source).toMatch(/const pRefreshContextBoundControls = async \(\{context: contextNxt\}\) => \{\s*currentContext = contextNxt;/);
		expect(source).toMatch(/pCreateCharacter\(\{[\s\S]*rulesVersionId: currentContext\.rulesVersion\?\.id \|\| null/);
		expect(source).toMatch(/getOrStageAwardMutationDraft\(\{[\s\S]*rulesVersionId: currentContext\.rulesVersion\?\.id \|\| null/);
		expect(source).toMatch(/const contextNxt = await api\.pGetCampaignContext\(\{campaignId\}\);\s*renderCampaignContext\(contextNxt\);\s*await pRefreshContextBoundControls\(\{context: contextNxt\}\)/);
	});

	it("preserves the complete hub URL through signed-out OAuth", () => {
		expect(hubHtml).toContain("id=\"hub-sign-in\"");
		const source = read("js/hub/hub-page.js");
		const providerSource = read("js/hub/hub-auth-providers.js");
		expect(source).toContain("window.location.search");
		expect(source).toContain("import(\"./hub-auth-providers.js\")");
		expect(source.split(`import("./hub-auth-providers.js")`)).toHaveLength(3);
		expect(providerSource).toContain("new URLSearchParams({returnTo})");
		expect(source).toContain("sessionStorage.setItem(\"hub-pending-invite\"");
		expect(source).toContain("_pendingInviteToken = inviteFragment");
		expect(providerSource).toContain("pCreateInviteAdmission");
		expect(providerSource).toContain("pRetryInviteAdmission");
		expect(providerSource).toContain("onInviteRetryInvalid");
		expect(providerSource).toContain("window.location.assign(result.authorizationUrl)");
		expect(source).toContain("sessionStorage.setItem(\"hub-invite-retry\"");
		expect(source).toContain("sessionStorage.removeItem(\"hub-invite-retry\")");
		expect(source).toContain("window.location.replace(\"hub.html\")");
		expect(source).toContain("joinUrl.hash");
		expect(source).not.toContain("searchParams.set(\"invite\"");
	});

	it("renders accessible provider controls with explicit duplicate-account guidance", () => {
		const source = read("js/hub/hub-auth-providers.js");
		expect(source).toContain(`setAttribute("role", "group")`);
		expect(source).toContain(`setAttribute("aria-label", "Sign-in providers")`);
		expect(source).toContain("Sign in with $" + "{provider.label}");
		expect(source).toContain("New provider links will require account reauthentication");
		expect(source).toContain("One sign-in provider is temporarily unavailable");
		expect(source).not.toContain("innerHTML");
	});

	it("clears a pending invite failure without aborting Hub setup", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toMatch(/try\s*\{[\s\S]*pRedeemInvite[\s\S]*\}\s*catch \(error\)\s*\{[\s\S]*renderError[\s\S]*\}\s*finally\s*\{[\s\S]*sessionStorage\.removeItem\("hub-pending-invite"\)/);
		expect(source.indexOf(`sessionStorage.removeItem("hub-pending-invite")`))
			.toBeLessThan(source.indexOf(`const form = document.getElementById("hub-create-form")`));
	});

	it("defines responsive, focus-visible, and reduced-motion behavior", () => {
		expect(scss).toContain("@media (width <= 720px)");
		expect(scss).toContain(":focus-visible");
		expect(scss).toContain("@media (prefers-reduced-motion: reduce)");
		expect(scss).toContain("--hub-primary: #5f62e9");
		expect(scss).toMatch(/\.hub-campaign-layout\s*\{[\s\S]*"manifest attention"[\s\S]*"manifest session"/);
		expect(scss).toMatch(/@media \(width <= 900px\)[\s\S]*"attention" auto[\s\S]*"manifest" auto[\s\S]*"session" auto/);
		expect(scss).not.toMatch(/\.hub-rail-section--tools\s*\{\s*display:\s*none/);
		for (const html of [hubHtml, campaignHtml]) {
			expect(html).toContain("class=\"hub-skip-link\"");
			expect(html).toContain("id=\"main-content\"");
			expect(html).toContain("<h1 class=\"sr-only\">Campaign Hub</h1>");
		}
	});

	it("makes the campaign hub reachable from global navigation", () => {
		expect(navigation).toContain("page: \"hub.html\", aText: \"Campaign Hub\"");
	});

	it("uses a valid lightweight navigation list on Hub-owned pages", () => {
		for (const html of [hubHtml, campaignHtml]) {
			expect(html).toContain("aria-label=\"Hub navigation\"");
			expect(html).toContain("href=\"charactersheet.html\"");
			expect(html).toContain("href=\"dmscreen.html\"");
			expect(html).not.toContain("src=\"js/navigation.js\"");
		}
	});

	it("declares pending-transfer rendering at module scope", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toMatch(/^async function renderPendingTransfers/m);
		expect(source.indexOf("async function renderPendingTransfers")).toBeLessThan(source.indexOf("async function pInitCampaignForms"));
		expect(source).toContain("const canReject = canAct && (canAccept || transfer.actorAccountId === session.account.id)");
		expect(source).toContain("[\"proposed\", \"reserved\"].includes(transfer.status)");
		expect(source).toContain("DM approval is needed before the stash changes");
		expect(source).toContain("isRequest ? \"Decline\" : \"Reject\"");
	});

	it("initializes every rules control from the active campaign version", () => {
		const source = read("js/hub/hub-page.js");
		for (const key of [
			"enableTgtt",
			"exhaustionRules",
			"thelemar_carryWeight",
			"thelemar_jumping",
			"thelemar_linguisticsBonus",
			"thelemar_criticalRolls",
		]) expect(source).toContain(`activeRules.${key}`);
	});

	it("provides an accessible, capability-gated rules library and privacy-safe member summary", () => {
		const source = read("js/hub/hub-page.js");
		for (const id of [
			"campaign-policy-summary",
			"campaign-policy-summary-status",
			"campaign-policy-summary-list",
			"campaign-rules-policy-manager",
			"campaign-rules-policy-loading",
			"campaign-rules-search",
			"campaign-rules-category",
			"campaign-rules-support",
			"campaign-rules-results-status",
			"campaign-rules-list",
			"campaign-rules-empty",
			"campaign-rules-review-list",
			"campaign-rules-validation",
			"campaign-rules-activate",
			"campaign-rules-history",
			"campaign-rules-rollback-review",
			"campaign-rules-rollback",
			"campaign-rules-policy-status",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml).toContain("role=\"search\"");
		expect(campaignHtml).toContain("aria-live=\"polite\"");
		expect(source).toContain("HUB_CAPABILITY_CAMPAIGN_RULES_POLICY");
		expect(source).toContain("pLoadHubCapabilityModule");
		expect(source).toContain("pImport: () => import(\"./hub-rules-policy-manager.js\")");
		expect(source).not.toContain("from \"./hub-rules-policy-manager.js\"");
		expect(rulesPolicyManager).toContain("this._isCapabilityEnabled");
		expect(rulesPolicyManager).toContain("setHidden(this._legacyForm, true)");
		expect(rulesPolicyManager).not.toContain("innerHTML");
	});

	it("covers loading, empty, error, offline, conflict, rollback, and long-list rule states", () => {
		const source = read("js/hub/hub-page.js");
		expect(campaignHtml).toContain("Loading rules library...");
		expect(campaignHtml).toContain("No rules match these filters.");
		expect(rulesPolicyManager).toContain("The rules library could not be loaded.");
		expect(source).toContain("Rules library unavailable. The existing rules editor remains available");
		expect(rulesPolicyManager).toContain("window.addEventListener(\"offline\"");
		expect(rulesPolicyManager).toContain("Rules changed elsewhere. Your draft is preserved");
		expect(campaignHtml).toContain("Activate previous version");
		expect(scss).toMatch(/\.hub-rules-list\s*\{[\s\S]*max-height:\s*720px;[\s\S]*overflow:\s*auto/);
		expect(scss).toMatch(/@media \(width <= 720px\)[\s\S]*\.hub-rules-toolbar,[\s\S]*\.hub-rule-row/);
		expect(scss).toContain(".hub-rule-row__control .hub-setting:has(input:focus-visible)");
	});

	it("refetches authorization-scoped campaign context after a rules activation event", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("event.type === \"rules.activated\"");
		expect(source).toMatch(/isCampaignContextRefreshQueued[\s\S]*api\.pGetCampaignContext\(\{campaignId\}\)/);
		expect(source).toContain("renderCampaignContext(context)");
	});
});
