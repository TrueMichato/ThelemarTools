import fs from "node:fs";
import {renderHubActivityRows} from "../../../js/hub/hub-activity-render.js";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("campaign hub pages", () => {
	const hubHtml = read("hub.html");
	const campaignHtml = read("campaign.html");
	const scss = read("scss/hub.scss");
	const navigation = read("js/navigation.js");
	const rulesPolicyManager = read("js/hub/hub-rules-policy-manager.js");

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
		expect(hubHtml).not.toContain("<dialog");
	});

	it("exposes account/session/deletion and campaign lifecycle controls", () => {
		for (const id of [
			"hub-session-list",
			"hub-revoke-other-sessions",
			"hub-request-deletion",
			"hub-account-deletion-pending",
			"hub-cancel-deletion",
		]) expect(hubHtml).toContain(`id="${id}"`);
		for (const id of ["campaign-invite-list", "campaign-leave"]) expect(campaignHtml).toContain(`id="${id}"`);
	});

	it("organizes the campaign around role-aware play tasks before administration", () => {
		for (const id of [
			"campaign-characters-panel",
			"campaign-party-panel",
			"campaign-inbox-panel",
			"campaign-shared-actions",
			"campaign-activity-panel",
			"campaign-dm-controls",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml.indexOf("id=\"campaign-characters-panel\""))
			.toBeLessThan(campaignHtml.indexOf("class=\"hub-campaign-admin\""));
		expect(campaignHtml).toContain("<details class=\"hub-disclosure\">");
		expect(campaignHtml).toContain("People and invitations");
		expect(campaignHtml).toContain("Rules and homebrew");
	});

	it("provides explicit campaign loading, connection, empty, and mutation feedback", () => {
		for (const id of [
			"campaign-connection-status",
			"campaign-character-empty",
			"campaign-party-empty",
			"campaign-pending-actions-empty",
			"campaign-pending-transfers-empty",
			"campaign-activity-empty",
			"campaign-invite-form-status",
			"campaign-action-form-status",
			"campaign-transfer-form-status",
		]) expect(campaignHtml).toContain(`id="${id}"`);
		expect(campaignHtml).toContain("aria-live=\"polite\"");
		expect(campaignHtml).toContain("data-pending-label=\"Applying...\"");
	});

	it("requires an explicit source identity for condition effects", () => {
		const source = read("js/hub/hub-page.js");
		expect(campaignHtml).toContain("id=\"campaign-action-condition-source\"");
		expect(campaignHtml).toContain("value=\"XPHB\"");
		expect(source).toContain("arguments: {condition: {name: rawValue, source: conditionSource}}");
		expect(source).not.toContain("source: \"PHB\"");
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
		expect(source).toContain("setHidden(document.getElementById(\"campaign-shared-actions\"), !canPlay)");
		expect(source).toContain("setHidden(document.getElementById(\"campaign-characters-panel\"), isSpectator)");
	});

	it("renders a named inbox, recent activity, and copyable invite result", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("api.pListEvents({");
		expect(source).toContain("new HubRealtimeClient({campaignId})");
		expect(source).toContain("realtime.on(\"event\", event =>");
		expect(source).toContain("realtime.on(\"cursor\", baseline =>");
		// ADR 0011: the page must not read character data off an event payload; every
		// invalidation is coalesced into an authorization-scoped HTTP refetch.
		expect(source).not.toContain("event.payload?.character");
		expect(source).not.toContain("character.projection.updated");
		expect(source).toContain("snapshotNxt.lastSequence >= liveLastSequence");
		expect(source).toContain("liveEvents = [...liveEvents.filter");
		expect(source).toContain("renderRecentActivity({events: liveEvents");
		expect(source).toContain("getCharacterName(target)");
		expect(source).toContain("getContainerName({kind: transfer.sourceKind");
		expect(source).toContain("navigator.clipboard.writeText(inviteOutput.value)");
		expect(campaignHtml).toContain("id=\"campaign-invite-copy\"");
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
		expect(source).toContain("api.pAwardItems");
		expect(source).toContain("fingerprint: getAwardCommandFingerprint(submission)");
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

	it("preserves the complete hub URL through signed-out OAuth", () => {
		expect(hubHtml).toContain("id=\"hub-sign-in\"");
		const source = read("js/hub/hub-page.js");
		const providerSource = read("js/hub/hub-auth-providers.js");
		expect(source).toContain("window.location.search");
		expect(source).toContain("import(\"./hub-auth-providers.js\")");
		expect(providerSource).toContain("new URLSearchParams({returnTo})");
		expect(source).toContain("sessionStorage.setItem(\"hub-pending-invite\"");
		expect(source).toContain("joinUrl.hash");
		expect(source).not.toContain("searchParams.set(\"invite\"");
	});

	it("renders accessible provider controls with explicit duplicate-account guidance", () => {
		const source = read("js/hub/hub-auth-providers.js");
		expect(source).toContain(`setAttribute("role", "group")`);
		expect(source).toContain(`setAttribute("aria-label", "Sign-in providers")`);
		expect(source).toContain("Sign in with $" + "{provider.label}");
		expect(source).toContain("Using an unlinked provider creates a separate account");
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
		expect(source).toContain("const canReject = canAccept || transfer.actorAccountId === session.account.id");
		expect(source).toContain("canAccept ? \"Reject\" : \"Cancel\"");
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
		expect(rulesPolicyManager).toContain("CAMPAIGN_RULES_POLICY_CAPABILITY");
		expect(rulesPolicyManager).toContain("setHidden(this._legacyForm, true)");
		expect(rulesPolicyManager).not.toContain("innerHTML");
	});

	it("covers loading, empty, error, offline, conflict, rollback, and long-list rule states", () => {
		expect(campaignHtml).toContain("Loading rules library...");
		expect(campaignHtml).toContain("No rules match these filters.");
		expect(rulesPolicyManager).toContain("The rules library could not be loaded.");
		expect(rulesPolicyManager).toContain("window.addEventListener(\"offline\"");
		expect(rulesPolicyManager).toContain("Rules changed elsewhere. Your draft is preserved");
		expect(campaignHtml).toContain("Activate previous version");
		expect(scss).toMatch(/\.hub-rules-list\s*\{[\s\S]*max-height:\s*720px;[\s\S]*overflow:\s*auto/);
		expect(scss).toMatch(/@media \(width <= 720px\)[\s\S]*\.hub-rules-toolbar,[\s\S]*\.hub-rule-row/);
		expect(scss).toContain(".hub-rule-row__control .hub-setting:has(input:focus-visible)");
	});
});
