import {
	HubApiClient,
	HubApiError,
	HubTransferProposalDrafts,
	HubTransferRefreshQueue,
	HubTransferResolutionDrafts,
	isTransferOutcomeUncertain,
	pResolveTransferFromDraft,
	pResolveTransferAndRefresh,
} from "./hub-api-client.js";
import {HubActiveCampaignCoordinator} from "./hub-active-campaign-coordinator.js";
import {HubActiveCampaignSwitcher} from "./hub-active-campaign-switcher.js";
import {
	HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT,
	HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
	pLoadHubCapabilityModule,
} from "./hub-capabilities.js";
import {
	createCampaignAuthorityChangeHandler,
	HubRealtimeClient,
	isRealtimeEventCoveredByBaseline,
} from "./hub-realtime-client.js";
import {
	bindHubActivityHistoryPagination,
	hasHubActivityAuthorizationChanged,
	mergeHubActivityEvents,
	renderHubActivityRows,
} from "./hub-activity-render.js";
import {
	getCanonicalCharacter,
	getOwnerMembershipId,
	getProjectionId,
	getProjectionOwnerAccountId,
	getProjectionProfileRows,
	getProjectionName,
	getProjectionSummary,
	getProjectionView,
	getTargetableProjections,
	isCanonicalProjection,
} from "./hub-character-view.js";
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
	resolveAwardItemSelection,
} from "./hub-item-award.js";
const api = new HubApiClient();
const transferProposalDrafts = new HubTransferProposalDrafts();
const transferResolutionDrafts = new HubTransferResolutionDrafts();
let campaignAuthorizationErrorHandler = null;

function concealCampaignAuthorizationSurfaces () {
	const content = document.getElementById("campaign-content");
	if (!content) return false;
	content.replaceChildren();
	content.classList.add("ve-hidden");
	content.setAttribute("aria-hidden", "true");
	return true;
}

function showSignedOutAfterSessionExpiry () {
	const signIn = document.getElementById("hub-sign-in");
	if (signIn) {
		const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		signIn.href = `/auth/github/start?${new URLSearchParams({returnTo})}`;
		signIn.hidden = false;
	}
	setHidden(document.getElementById("hub-signed-in"), true);
	setHidden(document.getElementById("hub-signed-out"), false);
}

/**
 * Lightweight Hub shells keep a device-local active campaign selection, but must never fetch the
 * campaign context or brew merely to persist it (ADR 0013). `isContextHost: false` selects the
 * selection-only verification path.
 *
 * It gets its own `HubApiClient` deliberately. Selection maintenance runs in the background, and a
 * shared client carries mutable CSRF state — background work must not be able to perturb a
 * user-initiated mutation on the page. It performs GETs only, and both of its entry points are
 * handed the page's already-verified session, so this costs no extra `GET /api/session`.
 */
const activeCampaignApi = new HubApiClient();
const activeCampaign = new HubActiveCampaignCoordinator({
	api: activeCampaignApi,
	host: {
		requiredCapabilities: [HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT],
		isContextHost: false,
		isResourcePinned: () => document.body?.dataset.hubView === "campaign",
		getExplicitCampaignId: () => new URLSearchParams(window.location.search).get("id"),
	},
});
let activeCampaignSwitcher = null;

async function pRenderActiveCampaignSwitcher () {
	let host = document.querySelector(".hub-context-switcher-host");
	if (!host) {
		host = document.createElement("li");
		host.className = "hub-context-switcher-host";
		document.querySelector(".hub-nav__list")?.append(host);
	}
	if (!host?.isConnected) return;
	activeCampaignSwitcher ||= new HubActiveCampaignSwitcher({
		coordinator: activeCampaign,
		pListCampaigns: () => activeCampaignApi.pListCampaigns(),
		getOpenSelectionUrl: ({campaignId}) => campaignId
			? `campaign.html?id=${encodeURIComponent(campaignId)}`
			: "hub.html",
	});
	await activeCampaignSwitcher.pRender({container: host, variant: "hub"});
}

window.addEventListener("pagehide", event => {
	if (event.persisted) activeCampaign.suspend();
	else {
		activeCampaignSwitcher?.dispose();
		activeCampaign.dispose();
	}
});
window.addEventListener("pageshow", event => {
	// eslint-disable-next-line no-console
	if (event.persisted) activeCampaign.pResume().catch(err => console.warn("Failed to resume campaign selection:", err));
});
const CURRENCY_TYPES = ["cp", "sp", "ep", "gp", "pp"];
const CONDITION_CATALOG_MODULE_URLS = Object.freeze([
	"./hub-condition-catalog.js",
	"./hub-condition-catalog.js?retry=1",
	"./hub-condition-catalog.js?retry=2",
]);
let isCampaignReloadRequired = false;

function setHidden (element, isHidden) {
	element?.classList.toggle("ve-hidden", isHidden);
}

function getErrorMessage (error) {
	if (!(error instanceof HubApiError)) return "The campaign hub could not be reached. Check your connection and try again.";
	switch (error.code) {
		case "NETWORK_UNAVAILABLE": return "The Campaign Hub could not be reached. Your open data is still shown, but changes cannot be saved until the connection returns.";
		case "DATABASE_UNAVAILABLE":
		case "SERVICE_UNAVAILABLE":
			return "The campaign service is temporarily unavailable. Your data was not changed. Try again in a moment.";
		case "RESPONSE_INVALID": return "The campaign service returned an unreadable response. Your data was not changed. Reload the page before trying again.";
		case "AUTH_REQUIRED": return "Your session has expired. Sign in again to continue.";
		case "CAMPAIGN_NOT_FOUND": return "This campaign is unavailable or you no longer have access.";
		case "FORBIDDEN": return "Your campaign permissions no longer allow that action. Reload to update the controls available to you.";
		case "INVALID_CAMPAIGN_NAME": return "Enter a campaign name before creating it.";
		case "INVITE_INVALID": return "That invite is expired, revoked, or has already been fully used.";
		case "ACCOUNT_OWNS_CAMPAIGN": return "Transfer ownership or archive every active campaign before deleting your account.";
		case "ACCOUNT_DELETION_PENDING": return "Your account is scheduled for deletion. Cancel deletion before using campaign features.";
		case "MEMBERSHIP_OWNER_PROTECTED": return "The campaign owner must transfer ownership or archive the campaign first.";
		case "PROTOCOL_UPDATE_REQUIRED": return "This page is out of date. Reload it before making campaign changes.";
		case "PAYLOAD_TOO_LARGE":
		case "CHARACTER_TOO_LARGE":
		case "CLOUD_DATA_TOO_LARGE":
			return "That content is too large to store online. Your existing data was not changed. Reduce the file or character history and try again.";
		case "CLOUD_DATA_TOO_DEEP":
		case "CLOUD_DATA_INVALID":
		case "CLOUD_HTML_FORBIDDEN":
		case "CLOUD_URL_FORBIDDEN":
		case "CLOUD_KEY_FORBIDDEN":
		case "CHARACTER_INVALID":
		case "INVALID_REQUEST":
			return "That content cannot be stored safely. Your existing data was not changed. Review custom content and try again.";
		case "BREW_TOO_LARGE": return "That homebrew bundle exceeds the 1 MB campaign limit or contains too many documents. Split it into a smaller bundle and try again.";
		case "BREW_TOO_DEEP":
		case "BREW_INVALID":
		case "BREW_BLOCKLIST_FORBIDDEN":
		case "BREW_RAW_HTML_FORBIDDEN":
		case "BREW_URL_FORBIDDEN":
			return "That homebrew file is not safe or valid for campaign sharing. Your current campaign homebrew is unchanged.";
		case "BREW_DEPENDENCY_MISSING": return "That homebrew is missing content it depends on. Add the required source documents and publish again.";
		case "TRANSFER_INSUFFICIENT": return "The source no longer has enough of that item or currency. Nothing was moved. Reload the latest balances and try again.";
		case "TRANSFER_ITEM_LINKED": return "That item is currently linked to character equipment or another feature, so it cannot be transferred safely.";
		case "TRANSFER_EMPTY": return "Choose at least one item or enter a positive currency amount before sending a transfer.";
		case "TRANSFER_NOT_FOUND": return "That transfer is no longer waiting. Reload the campaign inbox to see its latest status.";
		case "RESOURCE_INSUFFICIENT": return "The character no longer has enough of that resource. Nothing was applied. Reload the character and try again.";
		case "HP_MAX_UNAVAILABLE": return "This character's hit point maximum could not be read, so nothing was applied. Open it in the character sheet once to refresh its totals, then try again.";
		case "ACTION_NOT_FOUND": return "That effect request is no longer waiting. Reload the campaign inbox to see its latest status.";
		case "REVISION_CONFLICT": return "This data changed on another device. Your changes were not discarded. Reload and use the recovery choice shown before editing again.";
		case "RULES_VERSION_STALE": return "Campaign rules changed on another device. Refresh the active version before trying again.";
		case "RULES_UNKNOWN": return "That policy contains a rule this server does not recognize. No version was created.";
		case "RULES_PARAMETER_INVALID":
		case "RULES_COMBINATION_UNSUPPORTED":
		case "RULES_MODE_UNSUPPORTED":
		case "RULES_SCHEMA_UNSUPPORTED":
		case "RULES_CATALOG_UNSUPPORTED":
		case "RULES_UNAVAILABLE":
		case "RULES_INVALID":
			return "That campaign policy is not supported. Review the highlighted rule settings; no version was created.";
		case "LEASE_HELD": return "This character or workspace is being edited on another device. Open it read-only or explicitly take over editing there.";
		case "LEASE_FENCED":
		case "LEASE_EXPIRED":
			return "This device no longer holds the editing lease. Your unsaved changes remain recoverable; reload before choosing whether to take over.";
		default:
			if (error.status === 503 || error.status >= 500) return "The campaign service is temporarily unavailable. Your data was not changed. Try again in a moment.";
			return "The campaign hub could not complete that request. Your data was not changed. Try again.";
	}
}

function setCampaignReadOnlyAfterAccessChange (error) {
	if (!(error instanceof HubApiError)) return;
	const statuses = {
		AUTH_REQUIRED: "Signed out · data is read only",
		CAMPAIGN_NOT_FOUND: "Access removed · data is read only",
		FORBIDDEN: "Permissions changed · data is read only",
		PROTOCOL_UPDATE_REQUIRED: "Update required · data is read only",
	};
	const label = statuses[error.code];
	if (!label || document.body.dataset.hubView !== "campaign") return;
	setCampaignConnectionStatus({label, state: "error"});
	document.querySelectorAll("#campaign-content button, #campaign-content input, #campaign-content select, #campaign-content textarea")
		.forEach(control => {
			if (control.id !== "hub-logout") control.disabled = true;
		});
}

function renderError (
	messageOrError,
	{actionLabel = null, fnAction = null, isAuthorizationHandled = false} = {},
) {
	const wrp = document.getElementById("hub-error");
	if (!wrp) return;
	const error = messageOrError instanceof HubApiError ? messageOrError : null;
	if (!isAuthorizationHandled && error && campaignAuthorizationErrorHandler?.(error)) return;
	const message = error ? getErrorMessage(error) : messageOrError;
	wrp.replaceChildren();
	if (message) {
		const text = document.createElement("span");
		text.textContent = message;
		wrp.append(text);
	}
	if (error?.code === "PROTOCOL_UPDATE_REQUIRED") {
		actionLabel = "Reload now";
		fnAction = () => window.location.reload();
	}
	if (message && actionLabel && fnAction) {
		const button = document.createElement("button");
		button.className = "hub-button hub-button--small";
		button.type = "button";
		button.textContent = actionLabel;
		button.addEventListener("click", fnAction);
		wrp.append(button);
	}
	setHidden(wrp, !message);
	setCampaignReadOnlyAfterAccessChange(error);
}

function getRoleLabel (role) {
	switch (role) {
		case "dm": return "Dungeon Master";
		case "co_dm": return "Co-DM";
		case "player": return "Player";
		case "spectator": return "Spectator";
		default: return role;
	}
}

function renderCampaignList (campaigns) {
	const list = document.getElementById("hub-campaign-list");
	const empty = document.getElementById("hub-campaign-empty");
	if (!list) return;
	list.replaceChildren();
	setHidden(empty, !!campaigns.length);
	campaigns.forEach(campaign => {
		const link = document.createElement("a");
		link.className = "hub-campaign-row";
		link.href = `campaign.html?id=${encodeURIComponent(campaign.id)}`;
		link.innerHTML = `
			<span class="hub-campaign-row__name"></span>
			<span class="hub-campaign-row__role"></span>
			<span class="hub-campaign-row__open" aria-hidden="true">Open</span>
		`;
		link.querySelector(".hub-campaign-row__name").textContent = campaign.name;
		link.querySelector(".hub-campaign-row__role").textContent = getRoleLabel(campaign.role);
		list.append(link);
	});
}

function renderDetachedCharacterList (characters) {
	const section = document.getElementById("hub-detached-characters");
	const list = document.getElementById("hub-detached-character-list");
	if (!section || !list) return;
	const detached = characters.filter(character => character.campaignId == null);
	setHidden(section, !detached.length);
	list.replaceChildren(...detached.map(character => {
		const link = document.createElement("a");
		link.className = "hub-data-row";
		link.href = `charactersheet.html?id=${encodeURIComponent(character.id)}&hubCharacter=1`;
		const main = document.createElement("span");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.textContent = character.data?.name || "Unnamed Character";
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = "Stored online · choose a campaign";
		main.append(name, meta);
		link.append(main);
		return link;
	}));
}

function getDateLabel (value) {
	if (!value) return "Unknown";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function setCampaignConnectionStatus ({label, state}) {
	const status = document.getElementById("campaign-connection-status");
	if (!status) return;
	status.textContent = label;
	status.dataset.state = state;
}

function initCampaignNetworkAwareness () {
	if (document.body.dataset.hubView !== "campaign") return;
	window.addEventListener("offline", () => {
		isCampaignReloadRequired = true;
		setCampaignConnectionStatus({label: "Offline · shown data may be stale", state: "offline"});
		renderError("You are offline. The campaign data already on screen is retained, but changes cannot be saved until the connection returns.");
	});
	window.addEventListener("online", () => {
		setCampaignConnectionStatus({label: "Back online · reload to refresh", state: "warning"});
		renderError("The connection is back. Reload the campaign before making changes so you have the latest data.", {
			actionLabel: "Reload campaign",
			fnAction: () => window.location.reload(),
		});
	});
}

function setCount ({id, count}) {
	const element = document.getElementById(id);
	if (element) element.textContent = `${count}`;
}

function getCharacterName (character) {
	return getProjectionName(character);
}

function getCharacterSummary (character) {
	return getProjectionSummary(character);
}

function getMemberNameByMembership (members, membershipId) {
	if (!membershipId) return "";
	return members.find(member => member.id === membershipId)?.displayName || "";
}

function getMemberName (members, accountId) {
	return members.find(member => member.accountId === accountId)?.displayName || "A campaign member";
}

function getCharacterById (characters, characterId) {
	return characters.find(character => getProjectionId(character) === characterId);
}

function getCharacterNameById (characters, characterId) {
	return getCharacterName(getCharacterById(characters, characterId));
}

function getTransferContainerName ({transfer, endpoint, characters}) {
	const kind = transfer[`${endpoint}Kind`];
	if (kind === "party_inventory") return "Party inventory";
	const character = getCharacterById(characters, transfer[`${endpoint}Id`]);
	const visibleName = getProjectionView(character).name;
	if (visibleName) return visibleName;
	return transfer[`${endpoint}DisplaySnapshot`]?.displayName || "A character";
}

function getEffectDescription (effect = {}) {
	const context = effect.context ? `${effect.context}: ` : "";
	switch (effect.type) {
		case "damage": return `${context}${Number(effect.amount) || 0} damage`;
		case "healing": return `${context}${Number(effect.amount) || 0} healing`;
		case "condition_add": return `${context}add ${effect.condition || "a condition"}`;
		case "condition_remove": return `${context}remove ${effect.condition || "a condition"}`;
		case "spell_slot_spend": return `${context}spend ${Number(effect.amount) || 1} level ${Number(effect.level) || 1} spell ${Number(effect.amount) === 1 ? "slot" : "slots"}`;
		case "informational": return `${context}${effect.note || "informational request"}`;
		default: return `${context}${String(effect.type || "effect").replaceAll("_", " ")}`;
	}
}

function getCurrencyDescription (currency = {}) {
	return CURRENCY_TYPES
		.filter(type => Number(currency[type]) > 0)
		.map(type => `${currency[type]} ${type.toUpperCase()}`)
		.join(", ");
}

function renderPartyInventoryStatus (partyInventory) {
	const status = document.getElementById("campaign-party-inventory-status");
	if (!status) return;
	status.textContent = `${partyInventory.inventory.length} item stack(s) · ${getCurrencyDescription(partyInventory.currency) || "no currency"}`;
}

function getTransferContentsDescription (transfer) {
	const escrow = transfer.payload?.escrow || transfer.payload?.preview || {};
	const items = (escrow.items || []).map(entry => {
		const source = entry.item?.source ? ` · ${entry.item.source}` : "";
		return `${entry.quantity} × ${entry.item?.name || "item"}${source}`;
	});
	const currency = getCurrencyDescription(escrow.currency);
	return [...items, currency].filter(Boolean).join(" + ") || "Reserved transfer";
}

function shouldAutoResolveTransfer ({isDm, sourceKind, targetKind, targetId, targetCharacters, accountId}) {
	if (isDm) return true;
	if (sourceKind !== "character") return false;
	if (targetKind !== "character") return false;
	return getProjectionOwnerAccountId(getCharacterById(targetCharacters, targetId)) === accountId;
}

function getTransferContainer ({value, characters, partyInventory}) {
	const [kind, id] = value.split(":");
	if (kind === "party_inventory") return partyInventory;
	return getCharacterById(characters, id)?.data || null;
}

function syncTransferItemPicker ({characters, partyInventory}) {
	const source = document.getElementById("campaign-transfer-source");
	const target = document.getElementById("campaign-transfer-target");
	const item = document.getElementById("campaign-transfer-entry");
	const quantity = document.getElementById("campaign-transfer-quantity");
	const balance = document.getElementById("campaign-transfer-balance");
	if (!source || !item || !quantity) return;
	const container = getTransferContainer({value: source.value, characters, partyInventory});
	if (target?.value === source.value) {
		const nextTarget = [...target.options].find(option => option.value !== source.value);
		if (nextTarget) target.value = nextTarget.value;
	}
	const inventory = Array.isArray(container?.inventory) ? container.inventory : [];
	item.replaceChildren();
	const currencyOnly = document.createElement("option");
	currencyOnly.value = "";
	currencyOnly.textContent = inventory.length ? "Currency only" : "No transferable item stacks";
	item.append(currencyOnly, ...inventory.map(entry => {
		const option = document.createElement("option");
		option.value = entry.id;
		const sourceLabel = entry.item?.source ? ` · ${entry.item.source}` : "";
		option.textContent = `${entry.item?.name || "Unnamed item"}${sourceLabel} · ${entry.quantity} available`;
		option.dataset.quantity = `${entry.quantity}`;
		return option;
	}));
	item.disabled = !inventory.length;
	quantity.value = "0";
	quantity.disabled = true;
	quantity.removeAttribute("max");
	if (balance) {
		const currency = getCurrencyDescription(container?.currency);
		balance.textContent = `Available currency: ${currency || "none"}.`;
	}
}

function syncTransferQuantity () {
	const item = document.getElementById("campaign-transfer-entry");
	const quantity = document.getElementById("campaign-transfer-quantity");
	if (!item || !quantity) return;
	const selected = item.selectedOptions[0];
	const maximum = Number(selected?.dataset.quantity);
	const hasItem = !!item.value && Number.isFinite(maximum) && maximum > 0;
	quantity.disabled = !hasItem;
	quantity.value = hasItem ? "1" : "0";
	if (hasItem) quantity.max = `${maximum}`;
	else quantity.removeAttribute("max");
}

function setFrozenTransferOption ({select, value, label, quantity = null}) {
	if (!select || value == null) return;
	let option = [...select.options].find(it => it.value === value);
	if (!option) {
		option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		option.dataset.hubFrozenProposal = "true";
		select.append(option);
	}
	if (quantity != null) option.dataset.quantity = `${quantity}`;
	select.value = value;
}

function setTransferProposalControls ({form, proposalRequest, characters, partyInventory, isLocked}) {
	if (!form) return;
	if (!form._hubTransferControlStates) form._hubTransferControlStates = new Map();
	if (!isLocked) {
		if (isCampaignReloadRequired) {
			for (const control of form.querySelectorAll("button, input, select, textarea")) control.disabled = true;
			return;
		}
		for (const option of form.querySelectorAll("option[data-hub-frozen-proposal]")) option.remove();
		for (const [control, wasDisabled] of form._hubTransferControlStates) control.disabled = wasDisabled;
		form._hubTransferControlStates.clear();
		const latestState = form._hubTransferLatestState;
		if (latestState) syncTransferItemPicker(latestState);
		return;
	}
	form._hubTransferLatestState = {characters, partyInventory};

	const source = document.getElementById("campaign-transfer-source");
	const target = document.getElementById("campaign-transfer-target");
	const item = document.getElementById("campaign-transfer-entry");
	const quantity = document.getElementById("campaign-transfer-quantity");
	setFrozenTransferOption({
		select: source,
		value: `${proposalRequest.sourceKind}:${proposalRequest.sourceId}`,
		label: "Original transfer source (current balance unavailable)",
	});
	syncTransferItemPicker({characters, partyInventory});
	setFrozenTransferOption({
		select: target,
		value: `${proposalRequest.targetKind}:${proposalRequest.targetId}`,
		label: "Original transfer destination (current view unavailable)",
	});
	const requestedItem = proposalRequest.payload?.items?.[0] || null;
	if (requestedItem?.entryId) {
		setFrozenTransferOption({
			select: item,
			value: requestedItem.entryId,
			label: `Original item stack · ${requestedItem.quantity} requested (current balance unavailable)`,
			quantity: requestedItem.quantity,
		});
	} else if (item) item.value = "";
	syncTransferQuantity();
	if (quantity) quantity.value = `${requestedItem?.quantity || 0}`;
	for (const type of CURRENCY_TYPES) {
		const input = document.getElementById(`campaign-transfer-${type}`);
		if (input) input.value = `${proposalRequest.payload?.currency?.[type] || 0}`;
	}
	for (const control of form.querySelectorAll("input, select")) {
		if (!form._hubTransferControlStates.has(control)) form._hubTransferControlStates.set(control, control.disabled);
		control.disabled = true;
	}
}

async function pInitItemAwardComposer ({context, partyInventory, targetCharacters, events = []}) {
	const form = document.getElementById("campaign-item-form");
	const tabs = [...document.querySelectorAll("[data-item-award-source]")];
	const sourceKind = document.getElementById("campaign-item-source-kind");
	const selectionKey = document.getElementById("campaign-item-selection-key");
	const panel = document.getElementById("campaign-item-source-panel");
	const search = document.getElementById("campaign-item-search");
	const searchLabel = document.getElementById("campaign-item-search-label");
	const results = document.getElementById("campaign-item-results");
	const resultsStatus = document.getElementById("campaign-item-results-status");
	const useSelection = document.getElementById("campaign-item-use-selection");
	const selectionSummary = document.getElementById("campaign-item-selection-summary");
	const targetsRoot = document.getElementById("campaign-item-targets");
	const targetsStatus = document.getElementById("campaign-item-targets-status");
	const quantity = document.getElementById("campaign-item-quantity");
	const note = document.getElementById("campaign-item-note");
	const noteCount = document.getElementById("campaign-item-note-count");
	const previewSummary = document.getElementById("campaign-item-preview-summary");
	const previewList = document.getElementById("campaign-item-preview-list");
	const previewWarning = document.getElementById("campaign-item-preview-warning");
	const submit = form?.querySelector("button[type='submit']");
	if (!form || !sourceKind || !search || !results || !targetsRoot || !quantity || !note || !submit) {
		return {
			focusPrimary () {},
			getSubmission () { throw new Error("The item award form is unavailable."); },
			onSuccess () {},
			setCampaignBrewContent () {},
			setEvents () {},
			setPartyInventory () {},
			setPending () {},
			setTargets () {},
		};
	}

	const catalogLoader = createGenerationFencedCatalogLoader({
		campaignBrewContent: context.brewBundle?.content,
		pLoadCatalog: async campaignBrewContent => {
			const {pLoadHubItemCatalog} = await import("./hub-item-catalog.js");
			return pLoadHubItemCatalog({campaignBrewContent});
		},
	});
	let selectedItem = null;
	let currentPartyInventory = partyInventory;
	let currentTargets = targetCharacters;
	let currentEvents = events;
	let visibleItems = [];
	let isTargetSelectionInitialized = false;
	const catalogRenderFence = createCatalogRenderFence({
		getCatalogGeneration: () => catalogLoader.getGeneration(),
	});
	const selectedTargetIds = new Set();
	const pendingDisabledStates = new Map();
	const restorePendingControlStates = () => {
		if (isCampaignReloadRequired) {
			pendingDisabledStates.clear();
			for (const control of form.querySelectorAll("input, textarea, select, button")) control.disabled = true;
			return;
		}
		if (form._hubProjectionControlStates) {
			if (!form._hubProjectionControlRestores) form._hubProjectionControlRestores = new Set();
			form._hubProjectionControlRestores.add(restorePendingControlStates);
			for (const control of form.querySelectorAll("input, textarea, select, button")) control.disabled = true;
			return;
		}
		for (const [control, wasDisabled] of pendingDisabledStates) control.disabled = wasDisabled;
		pendingDisabledStates.clear();
	};

	const getSourceItems = () => {
		const catalog = catalogLoader.getCatalog();
		switch (sourceKind.value) {
			case "recent": return buildRecentAwardItems(currentEvents);
			case "campaign_item": return (catalog || []).filter(item => item.sourceKind === "campaign_item");
			case "party_inventory": return buildStashAwardItems(currentPartyInventory);
			default: return (catalog || []).filter(item => item.sourceKind === "catalog");
		}
	};

	const pEnsureCatalog = async () => {
		resultsStatus.textContent = "Loading item catalog...";
		return catalogLoader.pEnsureCatalog();
	};

	const getSelectedTargets = () => currentTargets.filter(target => selectedTargetIds.has(getProjectionId(target)));

	const renderPreview = () => {
		const selectedTargets = getSelectedTargets();
		const perTargetQuantity = Number(quantity.value);
		const preview = buildAwardPreview({
			targets: selectedTargets,
			selectedItem,
			quantity: Number.isSafeInteger(perTargetQuantity) ? perTargetQuantity : 0,
		});
		previewList.replaceChildren(...preview.rows.map(row => {
			const item = document.createElement("li");
			item.className = `hub-item-award__preview-row hub-item-award__preview-row--${row.state}`;
			const name = document.createElement("strong");
			name.textContent = row.name;
			const detail = document.createElement("span");
			detail.textContent = row.message;
			item.append(name, detail);
			return item;
		}));
		const requiredFromStash = selectedItem?.sourceKind === "party_inventory"
			? perTargetQuantity * selectedTargets.length
			: 0;
		const isQuantityValid = Number.isSafeInteger(perTargetQuantity) && perTargetQuantity >= 1 && perTargetQuantity <= 100000;
		const isStashInsufficient = requiredFromStash > (selectedItem?.availableQuantity || 0);
		quantity.toggleAttribute("aria-invalid", !isQuantityValid || isStashInsufficient);
		if (!selectedItem || !selectedTargets.length) {
			previewSummary.textContent = "Choose an item and at least one recipient to preview this award.";
		} else {
			previewSummary.textContent = `${perTargetQuantity || 0} × ${selectedItem.name} for ${selectedTargets.length} recipient${selectedTargets.length === 1 ? "" : "s"}.`;
		}
		if (isStashInsufficient) {
			previewWarning.textContent = `The party stash has ${selectedItem.availableQuantity}; this award needs ${requiredFromStash}. Nothing will move unless the full batch is available.`;
		} else if (preview.rows.some(row => row.state === "lower_bound")) {
			previewWarning.textContent = "At least one carry total is a lower bound. The server will not block this advisory award.";
		} else if (preview.rows.some(row => row.state === "unavailable")) {
			previewWarning.textContent = "At least one carry preview is unavailable. No hidden load or capacity was inferred.";
		} else {
			previewWarning.textContent = selectedItem && selectedTargets.length
				? "Carry is advisory; the authoritative item arrives only after the whole batch commits."
				: "";
		}
		submit.disabled = !selectedItem
			|| !selectedTargets.length
			|| !isQuantityValid
			|| isStashInsufficient
			|| preview.isPolicyBlocked;
	};

	const renderTargets = () => {
		const availableIds = new Set(currentTargets.map(getProjectionId));
		for (const id of [...selectedTargetIds]) {
			if (!availableIds.has(id)) selectedTargetIds.delete(id);
		}
		if (!isTargetSelectionInitialized && currentTargets[0]) {
			selectedTargetIds.add(getProjectionId(currentTargets[0]));
		}
		isTargetSelectionInitialized = true;
		targetsRoot.replaceChildren(...currentTargets.map(target => {
			const characterId = getProjectionId(target);
			const label = document.createElement("label");
			label.className = "hub-item-award__target";
			const checkbox = document.createElement("input");
			checkbox.id = `campaign-item-target-${characterId}`;
			checkbox.type = "checkbox";
			checkbox.name = "targetCharacter";
			checkbox.value = characterId;
			checkbox.checked = selectedTargetIds.has(characterId);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) selectedTargetIds.add(characterId);
				else selectedTargetIds.delete(characterId);
				renderPreview();
			});
			const text = document.createElement("span");
			const view = getProjectionView(target);
			text.textContent = view.classes.length
				? `${getProjectionName(target)} · ${view.classes.map(cls => `${cls.name} ${cls.level}`).join(" / ")}`
				: getProjectionName(target);
			label.append(checkbox, text);
			return label;
		}));
		targetsStatus.textContent = currentTargets.length
			? `${selectedTargetIds.size} of ${currentTargets.length} eligible character${currentTargets.length === 1 ? "" : "s"} selected.`
			: "No eligible campaign characters are available.";
		renderPreview();
	};

	const renderResults = async () => {
		const isCurrentRender = catalogRenderFence.begin();
		const previousSelectionKey = results.value;
		const isCatalogSource = ["catalog", "campaign_item"].includes(sourceKind.value);
		if (isCatalogSource && (sourceKind.value === "campaign_item" || search.value.trim().length >= 2)) {
			try {
				await pEnsureCatalog();
			} catch (error) {
				if (!isCurrentRender()) return;
				results.replaceChildren();
				resultsStatus.textContent = error.message || "The item catalog could not be loaded.";
				setFormStatus({formId: "campaign-item-form", message: resultsStatus.textContent, isError: true});
				return;
			}
			if (!isCurrentRender()) return;
		}
		visibleItems = filterAwardItems({
			items: getSourceItems(),
			query: search.value,
			isQueryRequired: sourceKind.value === "catalog",
		});
		results.replaceChildren(...visibleItems.map(item => {
			const option = document.createElement("option");
			option.value = getAwardItemSelectionKey(item);
			const amount = item.sourceKind === "party_inventory" ? ` · ${item.availableQuantity} available` : "";
			option.textContent = `${item.name} — ${item.source}${amount}`;
			option._hubAwardItem = item;
			return option;
		}));
		if ([...results.options].some(option => option.value === previousSelectionKey)) {
			results.value = previousSelectionKey;
		}
		useSelection.disabled = !visibleItems.length;
		if (sourceKind.value === "catalog" && search.value.trim().length < 2) {
			resultsStatus.textContent = "Type at least 2 characters to load and search the catalog.";
		} else if (!visibleItems.length) {
			resultsStatus.textContent = `No ${tabs.find(tab => tab.dataset.itemAwardSource === sourceKind.value)?.textContent.toLowerCase() || ""} items match this search.`;
		} else {
			resultsStatus.textContent = `${visibleItems.length}${visibleItems.length === 100 ? "+" : ""} matching item${visibleItems.length === 1 ? "" : "s"}.`;
		}
	};

	const clearSelection = () => {
		selectedItem = null;
		selectionKey.value = "";
		selectionSummary.textContent = "No item selected.";
		renderPreview();
	};

	const applySelection = () => {
		const item = resolveAwardItemSelection({
			selectionKey: results.value,
			selectedOptionItem: results.selectedOptions[0]?._hubAwardItem,
			visibleItems,
			sourceItems: getSourceItems(),
		});
		if (!item) return;
		selectedItem = item;
		selectionKey.value = getAwardItemSelectionKey(item);
		selectionSummary.textContent = `Selected: ${item.name} · ${item.source}${item.sourceKind === "party_inventory" ? ` · ${item.availableQuantity} in the party stash` : ""}`;
		renderPreview();
	};

	const setSource = async (nextSource, {isFocusSearch = true} = {}) => {
		sourceKind.value = nextSource;
		clearSelection();
		search.value = "";
		for (const tab of tabs) {
			const isSelected = tab.dataset.itemAwardSource === nextSource;
			tab.setAttribute("aria-selected", `${isSelected}`);
			tab.tabIndex = isSelected ? 0 : -1;
		}
		const activeTab = tabs.find(tab => tab.dataset.itemAwardSource === nextSource);
		panel?.setAttribute("aria-labelledby", activeTab?.id || "");
		const labels = {
			catalog: ["Search the item catalog", "Type at least 2 characters"],
			recent: ["Search recent awards", "Search by item name or source"],
			campaign_item: ["Search campaign items", "Search published campaign items"],
			party_inventory: ["Search the party stash", "Search shared item stacks"],
		}[nextSource];
		searchLabel.textContent = labels[0];
		search.placeholder = labels[1];
		await renderResults();
		if (isFocusSearch) search.focus();
	};

	for (const [index, tab] of tabs.entries()) {
		tab.addEventListener("click", () => void setSource(tab.dataset.itemAwardSource, {isFocusSearch: false}));
		tab.addEventListener("keydown", event => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const nextIndex = event.key === "Home"
				? 0
				: event.key === "End"
					? tabs.length - 1
					: (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			void setSource(tabs[nextIndex].dataset.itemAwardSource, {isFocusSearch: false})
				.then(() => tabs[nextIndex].focus());
		});
	}
	search.addEventListener("input", () => {
		clearSelection();
		void renderResults();
	});
	results.addEventListener("change", () => {
		useSelection.disabled = !results.selectedOptions.length;
	});
	results.addEventListener("dblclick", applySelection);
	useSelection.addEventListener("click", applySelection);
	quantity.addEventListener("input", renderPreview);
	note.addEventListener("input", () => noteCount.textContent = `${note.value.length} / 500 characters`);
	renderTargets();
	await setSource("catalog", {isFocusSearch: false});

	return {
		focusPrimary () {
			search.focus();
		},
		getSubmission () {
			return buildAwardSubmission({
				selectedItem,
				targets: currentTargets,
				selectedTargetIds,
				quantity: quantity.value,
				note: note.value,
			});
		},
		onSuccess (result) {
			const successEvent = buildAwardSuccessEvent({result, events: currentEvents});
			if (successEvent) currentEvents = [...currentEvents, successEvent];
			selectedItem = null;
			selectionKey.value = "";
			selectionSummary.textContent = "No item selected.";
			quantity.value = "1";
			note.value = "";
			noteCount.textContent = "0 / 500 characters";
			void renderResults();
			renderPreview();
		},
		setCampaignBrewContent (content) {
			catalogLoader.setCampaignBrewContent(content);
			if (["catalog", "campaign_item"].includes(sourceKind.value)) {
				clearSelection();
				void renderResults();
			}
		},
		setEvents (nextEvents) {
			currentEvents = nextEvents;
			if (sourceKind.value === "recent") void renderResults();
		},
		setPartyInventory (nextPartyInventory) {
			currentPartyInventory = nextPartyInventory;
			if (sourceKind.value === "party_inventory") {
				const refreshedSelection = selectedItem?.sourceKind === "party_inventory"
					? buildStashAwardItems(currentPartyInventory).find(item => item.entryId === selectedItem.entryId)
					: null;
				if (refreshedSelection) {
					selectedItem = refreshedSelection;
					selectionKey.value = `${selectedItem.sourceKind}:${selectedItem.entryId}`;
					selectionSummary.textContent = `Selected: ${selectedItem.name} · ${selectedItem.source} · ${selectedItem.availableQuantity} in the party stash`;
					renderPreview();
				} else {
					clearSelection();
				}
				void renderResults();
			}
		},
		setPending (isPending) {
			if (isPending) {
				pendingDisabledStates.clear();
				for (const control of form.querySelectorAll("input, textarea, select, button")) {
					if (control === submit) continue;
					pendingDisabledStates.set(control, control.disabled);
					control.disabled = true;
				}
				return;
			}
			restorePendingControlStates();
		},
		setTargets (nextTargets) {
			currentTargets = nextTargets;
			renderTargets();
		},
	};
}

function applyCampaignRoleLayout ({campaign, characters}) {
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	const canPlay = ["dm", "co_dm", "player"].includes(campaign.role);
	const isSpectator = campaign.role === "spectator";
	const content = document.getElementById("campaign-content");
	if (content) content.dataset.campaignRole = campaign.role;

	const title = document.getElementById("campaign-character-title");
	const description = document.getElementById("campaign-character-description");
	const guidance = document.getElementById("campaign-role-guidance");
	if (isDm) {
		if (title) title.textContent = "Live character roster";
		if (description) description.textContent = "Open any campaign character or continue into the live DM workspace.";
		if (guidance) guidance.textContent = "Lead the session in the DM workspace. Return here for requests, shared supplies, and setup health.";
	} else {
		if (title) title.textContent = "My characters";
		if (description) description.textContent = "Your cloud characters for this campaign. Local originals remain independent.";
		if (guidance) {
			guidance.textContent = isSpectator
				? "Follow party readiness and recent activity. Gameplay and management controls stay read only."
				: "Continue on your character sheet, respond to requests, or share something with the party.";
		}
	}

	setHidden(document.getElementById("campaign-characters-panel"), isSpectator);
	setHidden(document.getElementById("campaign-party-panel"), isDm);
	setHidden(document.getElementById("campaign-workbench"), !canPlay);
	setHidden(document.getElementById("campaign-shared-actions"), !canPlay);
	setHidden(document.getElementById("campaign-action-form"), !isDm);
	setHidden(document.getElementById("campaign-jump-effect"), !isDm);
	setHidden(document.getElementById("campaign-jump-transfer"), !canPlay);
	setHidden(document.getElementById("campaign-dm-grants"), !isDm);
	setHidden(document.getElementById("campaign-content-managed-note"), isDm);
	setHidden(document.getElementById("campaign-open-dm-screen"), !isDm);
	setHidden(document.getElementById("campaign-upload-local"), !canPlay);

	const primaryCharacter = document.getElementById("campaign-open-primary-character");
	const characterSetup = document.getElementById("campaign-open-character-setup");
	const readonlyPrimary = document.getElementById("campaign-primary-readonly");
	const playerCharacters = campaign.status === "active" && campaign.role === "player" ? characters : [];
	const primaryPlayerCharacter = playerCharacters.length === 1 ? playerCharacters[0] : null;
	if (primaryCharacter && primaryPlayerCharacter) {
		primaryCharacter.href = `charactersheet.html?id=${encodeURIComponent(primaryPlayerCharacter.id)}&hubCampaign=${encodeURIComponent(campaign.id)}`;
		primaryCharacter.textContent = `Open ${getCharacterName(primaryPlayerCharacter)}`;
	}
	if (characterSetup && playerCharacters.length !== 1) {
		const hasCharacterChoices = playerCharacters.length > 1;
		characterSetup.href = hasCharacterChoices ? "#campaign-character-list" : "#campaign-upload-local";
		characterSetup.textContent = hasCharacterChoices ? "Choose a character" : "Add a local character copy";
	}
	setHidden(primaryCharacter, !primaryPlayerCharacter);
	setHidden(characterSetup, campaign.status !== "active" || campaign.role !== "player" || playerCharacters.length === 1);
	setHidden(readonlyPrimary, !isSpectator && campaign.status === "active");

	const workbenchDescription = document.getElementById("campaign-workbench-description");
	if (workbenchDescription) {
		workbenchDescription.textContent = isDm
			? "Effects, transfers, XP, and item awards"
			: "Item and currency transfers";
	}
}

function initCampaignWorkbenchLinks () {
	for (const [linkId, targetId] of [
		["campaign-jump-effect", "campaign-action-form"],
		["campaign-jump-transfer", "campaign-transfer-form"],
	]) {
		document.getElementById(linkId)?.addEventListener("click", () => {
			const workbench = document.getElementById("campaign-workbench");
			if (workbench) workbench.open = true;
			requestAnimationFrame(() => document.getElementById(targetId)?.querySelector("select, input, button")?.focus());
		});
	}

	document.getElementById("campaign-open-character-setup")?.addEventListener("click", event => {
		const targetId = event.currentTarget.getAttribute("href")?.slice(1);
		if (!targetId) return;
		requestAnimationFrame(() => {
			const target = document.getElementById(targetId);
			(target?.matches("[tabindex], button, a, input, select, textarea") ? target : target?.querySelector("a, button, input, select, textarea"))?.focus();
		});
	});
}

function setFormStatus ({formId, message = "", isError = false}) {
	const status = document.getElementById(`${formId}-status`);
	if (!status) return;
	status.textContent = message;
	status.classList.toggle("hub-inline-status--error", isError);
}

function setTransferRefreshFailure ({form, message, pRetry}) {
	const status = document.getElementById("campaign-transfer-form-status");
	if (!form?.isConnected) return;
	const submit = form?.querySelector("button[type='submit']");
	if (!status || !submit) return;
	submit.disabled = true;
	status.classList.add("hub-inline-status--error");
	status.replaceChildren(document.createTextNode(isCampaignReloadRequired ? message : `${message} `));
	if (isCampaignReloadRequired) return;
	const retry = document.createElement("button");
	retry.type = "button";
	retry.className = "hub-button hub-button--inline";
	retry.textContent = "Retry latest balances";
	retry.addEventListener("click", async () => {
		if (isCampaignReloadRequired) return;
		retry.disabled = true;
		retry.textContent = "Retrying...";
		try {
			const result = await pRetry();
			if (isCampaignReloadRequired || result?.isFenced) return;
			submit.disabled = false;
			setFormStatus({
				formId: "campaign-transfer-form",
				message: "Latest balances loaded. You can send another transfer.",
			});
		} catch {
			if (isCampaignReloadRequired) return;
			setTransferRefreshFailure({form, message, pRetry});
		}
	});
	status.append(retry);
}

function setTransferProposalReplayExpired ({
	form,
	proposalRef,
	proposalRequest,
	pRefresh,
	message = "This transfer retry is too old to replay safely.",
}) {
	const status = document.getElementById("campaign-transfer-form-status");
	const submit = form?.querySelector("button[type='submit']");
	if (!status || !submit) return;
	submit.disabled = true;
	status.classList.add("hub-inline-status--error");
	status.replaceChildren(document.createTextNode(isCampaignReloadRequired ? message : `${message} `));
	if (isCampaignReloadRequired) return;
	const refresh = document.createElement("button");
	refresh.type = "button";
	refresh.className = "hub-button hub-button--inline";
	refresh.textContent = "Refresh latest balances";
	refresh.addEventListener("click", async () => {
		if (isCampaignReloadRequired) return;
		refresh.disabled = true;
		refresh.textContent = "Refreshing...";
		try {
			const refreshResult = await pRefresh();
			if (isCampaignReloadRequired) return;
			if (refreshResult?.isFenced || !Array.isArray(refreshResult?.transfers)) {
				throw new HubApiError({code: "TRANSFER_REFRESH_FAILED", status: 0});
			}
			const reconciliation = HubTransferProposalDrafts.reconcileExpiredProposal({
				proposalRequest,
				transfers: refreshResult.transfers,
			});
			if (reconciliation.state === "ambiguous") {
				setTransferProposalReplayExpired({
					form,
					proposalRef,
					proposalRequest,
					pRefresh,
					message: "Multiple matching pending transfers were found. This request remains locked to prevent a duplicate; resolve them in the transfer inbox.",
				});
				return;
			}
			if (reconciliation.state === "pending") {
				setTransferProposalReplayExpired({
					form,
					proposalRef,
					proposalRequest,
					pRefresh,
					message: "The original transfer was found and is still pending. Resolve or cancel it in the transfer inbox before starting another.",
				});
				return;
			}

			transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
			form._hubMutationKey = null;
			form._hubMutationFingerprint = null;
			setTransferProposalControls({form, isLocked: false});
			submit.textContent = "Submit transfer";
			submit.disabled = !document.getElementById("campaign-transfer-source")?.options.length;
			const terminalMessages = {
				committed: "The original transfer completed. Latest balances are loaded.",
				rejected: "The original transfer was rejected. Latest balances are loaded.",
				cancelled: "The original transfer was cancelled. Latest balances are loaded.",
				expired: "The original transfer expired. Latest balances are loaded.",
			};
			setFormStatus({
				formId: "campaign-transfer-form",
				message: terminalMessages[reconciliation.transfer?.status]
					|| "No matching transfer was found. Latest balances are loaded; inspect the destination before starting another.",
			});
		} catch {
			if (isCampaignReloadRequired) return;
			setTransferProposalReplayExpired({
				form,
				proposalRef,
				proposalRequest,
				pRefresh,
				message: "The transfer outcome and latest balances could not be confirmed. Retry the state refresh; this request remains locked.",
			});
		}
	});
	status.append(refresh);
}

function setTransferInboxRefreshFailure ({controls, meta, message, pRetry, isResolutionKnown, pendingDecision = null}) {
	meta.textContent = message;
	const decisionButtons = [...controls.querySelectorAll("[data-transfer-decision]")];
	const priorRetry = controls.querySelector("[data-transfer-refresh-retry]");
	priorRetry?.remove();
	if (isCampaignReloadRequired) {
		for (const button of decisionButtons) button.disabled = true;
		return;
	}
	const retry = document.createElement("button");
	retry.type = "button";
	retry.className = "hub-button hub-button--inline";
	retry.textContent = "Retry inbox refresh";
	retry.dataset.transferRefreshRetry = "true";
	retry.addEventListener("click", async () => {
		if (isCampaignReloadRequired) return;
		for (const control of controls.querySelectorAll("button")) control.disabled = true;
		retry.textContent = "Refreshing...";
		try {
			const result = await pRetry();
			if (isCampaignReloadRequired || result?.isFenced) return;
			renderError("");
		} catch (error) {
			renderError(error);
			if (isCampaignReloadRequired) return;
			setTransferInboxRefreshFailure({controls, meta, message, pRetry, isResolutionKnown, pendingDecision});
		}
	});
	if (isResolutionKnown) controls.replaceChildren(retry);
	else {
		for (const button of decisionButtons) button.disabled = button.dataset.transferDecision !== pendingDecision;
		controls.append(retry);
	}
	const list = document.getElementById("campaign-pending-transfers");
	if (list?.isConnected) {
		list._hubTransferInboxRecovery = {meta, controls};
		renderTransferInboxRecovery(list);
	}
}

function renderTransferInboxRecovery (list = document.getElementById("campaign-pending-transfers")) {
	const recovery = list?._hubTransferInboxRecovery;
	if (!list?.isConnected || !recovery) return false;
	const row = document.createElement("div");
	row.className = "hub-data-row";
	const main = document.createElement("span");
	main.className = "hub-data-row__main";
	main.append(recovery.meta);
	row.append(main, recovery.controls);
	list.replaceChildren(row);
	setHidden(document.getElementById("campaign-pending-transfers-empty"), true);
	updateInboxCount({kind: "transfers", count: 1});
	return true;
}

function setFormAvailability ({formId, isAvailable, message}) {
	const form = document.getElementById(formId);
	if (!form) return;
	for (const button of form.querySelectorAll("button[type='submit']")) button.disabled = !isAvailable;
	if (!isAvailable) setFormStatus({formId, message});
}

function setProjectionFormControlsConcealed ({form, isConcealed}) {
	if (!form) return;
	if (isConcealed) {
		if (!form._hubProjectionControlStates) form._hubProjectionControlStates = new Map();
		if (form.contains(document.activeElement)) form._hubProjectionFocusedControl = document.activeElement;
		for (const control of form.querySelectorAll("button, input, select, textarea")) {
			if (!form._hubProjectionControlStates.has(control)) {
				form._hubProjectionControlStates.set(
					control,
					form._hubMutationControlStates?.get(control) ?? control.disabled,
				);
			}
			control.disabled = true;
		}
		return;
	}
	if (isCampaignReloadRequired) return;
	const focusedControl = form._hubProjectionFocusedControl;
	const deferredControlRestores = [...(form._hubProjectionControlRestores || [])];
	for (const [control, wasDisabled] of form._hubProjectionControlStates || []) {
		if (control.isConnected) control.disabled = wasDisabled;
	}
	delete form._hubProjectionControlStates;
	delete form._hubProjectionFocusedControl;
	delete form._hubProjectionControlRestores;
	for (const fnRestore of deferredControlRestores) fnRestore();
	if (
		focusedControl?.isConnected
		&& !focusedControl.disabled
		&& [document.body, focusedControl].includes(document.activeElement)
	) focusedControl.focus({preventScroll: true});
}

function getCampaignTransferDraft () {
	const getValue = id => document.getElementById(id)?.value || "";
	return {
		source: getValue("campaign-transfer-source"),
		target: getValue("campaign-transfer-target"),
		item: getValue("campaign-transfer-entry"),
		quantity: getValue("campaign-transfer-quantity"),
		currency: Object.fromEntries(CURRENCY_TYPES.map(type => [type, getValue(`campaign-transfer-${type}`)])),
	};
}

function captureCampaignTransferDraft () {
	const form = document.getElementById("campaign-transfer-form");
	if (!form || form._hubProjectionTransferDraft) return;
	form._hubProjectionTransferDraft = getCampaignTransferDraft();
}

function renderAccountDeletionPending (deletion) {
	setHidden(document.getElementById("hub-account-active"), true);
	setHidden(document.getElementById("hub-account-deletion-pending"), false);
	const deadline = document.getElementById("hub-deletion-deadline");
	if (deadline) deadline.textContent = `Your account is frozen and scheduled for deletion after ${getDateLabel(deletion.purgeAfter)}. Re-authenticate before then to cancel.`;
}

async function pRenderAccountSessions () {
	const list = document.getElementById("hub-session-list");
	if (!list) return;
	const sessions = await api.pListSessions();
	list.replaceChildren(...sessions.map(session => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.textContent = session.isCurrent ? "This device" : (session.userAgent || "Unknown device");
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = `${session.revokedAt ? "Revoked" : "Active"} · Last seen ${getDateLabel(session.lastSeenAt)}`;
		main.append(name, meta);
		row.append(main);
		if (!session.isCurrent && !session.revokedAt) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = "Sign out";
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await api.pRevokeSession({sessionId: session.id, idempotencyKey: crypto.randomUUID()});
					await pRenderAccountSessions();
				} catch (error) {
					if (!isCampaignReloadRequired) renderError(error);
					button.disabled = false;
				}
			});
			row.append(button);
		}
		return row;
	}));
}

async function pInitHubIndex ({session}) {
	const name = document.getElementById("hub-account-name");
	if (name) name.textContent = session.account.displayName;
	// The Hub index has no explicit campaign, so this is where an account-matching stored
	// selection is actually consumed: it is revalidated through the selection-only path (no
	// context or brew fetch) and cleared if the campaign was archived or access was lost.
	// eslint-disable-next-line no-console
	await activeCampaign.pResolve({trigger: "startup", session});
	await pRenderActiveCampaignSwitcher();
	document.getElementById("hub-cancel-deletion")?.addEventListener("click", async event => {
		const button = event.currentTarget;
		button.disabled = true;
		try {
			await api.pCancelAccountDeletion({idempotencyKey: crypto.randomUUID()});
			window.location.reload();
		} catch (error) {
			renderError(error);
			button.disabled = false;
		}
	});
	if (session.account.status === "deletion_requested") {
		renderAccountDeletionPending({
			purgeAfter: session.account.purgeAfter,
			deletionRequestedAt: session.account.deletionRequestedAt,
		});
		return;
	}
	setHidden(document.getElementById("hub-account-active"), false);
	setHidden(document.getElementById("hub-account-deletion-pending"), true);
	const [campaigns, characters] = await Promise.all([
		api.pListCampaigns(),
		api.pListCharacters(),
	]);
	renderCampaignList(campaigns);
	renderDetachedCharacterList(characters);
	const inviteToken = sessionStorage.getItem("hub-pending-invite");
	if (inviteToken) {
		try {
			const redeemed = await api.pRedeemInvite({token: inviteToken, idempotencyKey: crypto.randomUUID()});
			const campaignId = redeemed.membership?.campaignId;
			if (!campaignId) throw new HubApiError({code: "RESPONSE_INVALID", status: 200});
			const campaign = await api.pGetCampaign({campaignId});
			await activeCampaign.adoptVerified({session, campaign});
			window.location.assign(`campaign.html?id=${encodeURIComponent(campaignId)}`);
			return;
		} catch (error) {
			renderError(error);
		} finally {
			sessionStorage.removeItem("hub-pending-invite");
		}
	}

	const form = document.getElementById("hub-create-form");
	let pendingCreate = null;
	document.getElementById("hub-campaign-name")?.addEventListener("input", event => {
		if (pendingCreate?.name !== event.target.value.trim()) pendingCreate = null;
	});
	form?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		const input = document.getElementById("hub-campaign-name");
		const button = document.getElementById("hub-create-submit");
		const campaignName = input.value.trim();
		if (!campaignName) {
			input.focus();
			renderError("Enter a campaign name before creating it.");
			return;
		}
		button.disabled = true;
		button.textContent = "Creating...";
		try {
			pendingCreate ||= {name: campaignName, idempotencyKey: crypto.randomUUID()};
			const {campaign} = await api.pCreateCampaign(pendingCreate);
			pendingCreate = null;
			window.location.assign(`campaign.html?id=${encodeURIComponent(campaign.id)}`);
		} catch (error) {
			renderError(error);
			button.disabled = false;
			button.textContent = "Create campaign";
		}
	});
	try {
		await pRenderAccountSessions();
	} catch (error) {
		renderError(error);
	}
	document.getElementById("hub-revoke-other-sessions")?.addEventListener("click", async event => {
		const button = event.currentTarget;
		button.disabled = true;
		try {
			await api.pRevokeOtherSessions({idempotencyKey: crypto.randomUUID()});
			await pRenderAccountSessions();
		} catch (error) {
			renderError(error);
		} finally {
			button.disabled = false;
		}
	});
	document.getElementById("hub-request-deletion")?.addEventListener("click", async event => {
		if (window.prompt(`Type DELETE to schedule account deletion after a 7-day grace period.`) !== "DELETE") return;
		const button = event.currentTarget;
		button.disabled = true;
		try {
			const result = await api.pRequestAccountDeletion({idempotencyKey: crypto.randomUUID()});
			renderAccountDeletionPending(result.deletion);
		} catch (error) {
			renderError(error);
			button.disabled = false;
		}
	});
}

async function pInitCampaign ({session}) {
	const campaignId = new URLSearchParams(window.location.search).get("id");
	if (!campaignId) throw new HubApiError({code: "CAMPAIGN_NOT_FOUND", status: 404});
	let campaign;
	try {
		campaign = await api.pGetCampaign({campaignId});
	} catch (error) {
		// An inaccessible explicit campaign must still invalidate a stored selection naming it.
		await activeCampaign.pReportFailure({error, campaignId, session}).catch(() => {});
		throw error;
	}
	// The session and campaign are already verified here, so recording the selection costs no
	// additional request and never fetches the campaign context for selection purposes.
	// An archived campaign still renders read-only, but never becomes the active selection.
	await activeCampaign.adoptVerified({session, campaign});
	await pRenderActiveCampaignSwitcher();
	const [members, characters, snapshot] = await Promise.all([
		api.pListMembers({campaignId}),
		api.pListCharacters({campaignId}),
		api.pGetCampaignSnapshot({campaignId}),
	]);
	const [contextInitial, eventPage] = await Promise.all([
		api.pGetCampaignContext({campaignId}),
		api.pListEventPage({
			campaignId,
			beforeSequence: snapshot.lastSequence + 1,
			limit: 50,
		}),
	]);
	const events = eventPage.events;
	let context = contextInitial;
	const pRefreshMembers = async () => renderMemberList({
		campaign,
		campaignId,
		members: await api.pListMembers({campaignId}),
		session,
		pRefresh: pRefreshMembers,
	});
	const pRefreshInvites = async () => renderInviteList({
		campaignId,
		invites: await api.pListInvites({campaignId}),
		pRefresh: pRefreshInvites,
	});
	document.getElementById("campaign-name").textContent = campaign.name;
	document.getElementById("campaign-role").textContent = getRoleLabel(campaign.role);
	const campaignStatus = document.getElementById("campaign-status");
	campaignStatus.textContent = campaign.status === "active" ? "Active campaign" : "Archived";
	campaignStatus.dataset.state = campaign.status;
	document.getElementById("campaign-account").textContent = session.account.displayName;
	renderMemberList({campaign, campaignId, members, session, pRefresh: pRefreshMembers});
	if (["dm", "co_dm"].includes(campaign.role)) await pRefreshInvites();
	renderCharacterList({
		campaignId,
		characters,
		session,
		isDm: ["dm", "co_dm"].includes(campaign.role),
	});
	renderPartyRoster({
		campaignId,
		characters: snapshot.characters,
		members,
		session,
		isDm: ["dm", "co_dm"].includes(campaign.role),
		roster: snapshot.roster || [],
	});
	renderRecentActivity({events, characters: snapshot.characters, members, history: eventPage.history});
	renderCampaignContext(context);
	applyCampaignRoleLayout({campaign, characters});
	initCampaignWorkbenchLinks();
	let liveEvents = events;
	let activityHistory = eventPage.history;
	let liveMembers = members;
	let liveCharacters = snapshot.characters;
	let liveRoster = snapshot.roster || [];
	let activityAuthorizationGeneration = 0;
	let isActivityAuthorizationFenced = false;
	let projectionAuthorizationGeneration = 0;
	let projectionControlSelectionDraft = null;
	const realtime = new HubRealtimeClient({campaignId, initialLastSequence: snapshot.lastSequence});
	let refreshTimer = null;
	const invalidateActivityAuthorization = () => {
		activityAuthorizationGeneration++;
		isActivityAuthorizationFenced = true;
		const loadEarlier = document.getElementById("campaign-activity-load-earlier");
		if (loadEarlier) loadEarlier.disabled = true;
	};
	const concealActivityAuthorization = ({isLoading = false} = {}) => {
		invalidateActivityAuthorization();
		liveEvents = [];
		activityHistory = null;
		liveMembers = [];
		liveCharacters = [];
		renderRecentActivity({
			events: [],
			characters: [],
			members: [],
			history: null,
			isLoading,
			isAuthorizationFenced: true,
		});
	};
	const concealCampaignAuthorization = ({isLoading = false} = {}) => {
		concealActivityAuthorization({isLoading});
		liveRoster = [];
		context = null;
		projectionControlSelectionDraft = null;
		concealCampaignAuthorizationSurfaces();
	};
	const concealProjectionFormControls = () => {
		for (const formId of ["campaign-action-form", "campaign-transfer-form", "campaign-xp-form", "campaign-item-form"]) {
			setProjectionFormControlsConcealed({
				form: document.getElementById(formId),
				isConcealed: true,
			});
		}
	};
	const concealCampaignProjectionAuthorization = () => {
		projectionAuthorizationGeneration++;
		concealActivityAuthorization({isLoading: true});
		liveRoster = [];
		captureCampaignTransferDraft();
		if (!projectionControlSelectionDraft) {
			projectionControlSelectionDraft = {
				actionTarget: document.getElementById("campaign-action-target")?.value || "",
				xpTarget: document.getElementById("campaign-xp-target")?.value || "",
			};
		}
		concealProjectionFormControls();
		for (const id of [
			"campaign-party-roster",
			"campaign-pending-actions",
			"campaign-pending-transfers",
			"campaign-item-targets",
			"campaign-item-preview-list",
		]) document.getElementById(id)?.replaceChildren();
		renderTransferInboxRecovery();
		for (const id of [
			"campaign-action-target",
			"campaign-transfer-source",
			"campaign-transfer-target",
			"campaign-transfer-entry",
			"campaign-xp-target",
		]) {
			const select = document.getElementById(id);
			select?.replaceChildren();
			if (select) select.disabled = true;
		}
		const partyCount = document.getElementById("campaign-party-count");
		if (partyCount) partyCount.textContent = "0";
		const partyEmpty = document.getElementById("campaign-party-empty");
		if (partyEmpty) partyEmpty.textContent = "Refreshing authorized party details...";
		setHidden(partyEmpty, false);
		const attentionSummary = document.getElementById("campaign-attention-summary");
		if (attentionSummary) attentionSummary.textContent = "Refreshing authorized requests...";
		const attentionCount = document.getElementById("campaign-inbox-count");
		if (attentionCount) attentionCount.textContent = "0";
		const previewSummary = document.getElementById("campaign-item-preview-summary");
		if (previewSummary) previewSummary.textContent = "Refreshing authorized recipients...";
		const transferBalance = document.getElementById("campaign-transfer-balance");
		if (transferBalance) transferBalance.textContent = "";
	};
	const stopCampaignLiveUpdates = () => {
		if (refreshTimer != null) {
			window.clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		realtime.close();
	};
	const handleCampaignAuthorizationError = error => {
		if (!(error instanceof HubApiError)) return false;
		if (!["AUTH_REQUIRED", "FORBIDDEN", "CAMPAIGN_NOT_FOUND", "MEMBERSHIP_NOT_FOUND"].includes(error.code)) return false;
		isCampaignReloadRequired = true;
		if (error.code === "AUTH_REQUIRED") {
			concealCampaignAuthorization();
			stopCampaignLiveUpdates();
			showSignedOutAfterSessionExpiry();
			renderError(error, {isAuthorizationHandled: true});
			return true;
		}
		concealCampaignAuthorization();
		stopCampaignLiveUpdates();
		renderError(error, {isAuthorizationHandled: true});
		return true;
	};
	campaignAuthorizationErrorHandler = handleCampaignAuthorizationError;
	bindHubActivityHistoryPagination({
		button: document.getElementById("campaign-activity-load-earlier"),
		pListEventPage: ({beforeSequence, limit}) => api.pListEventPage({campaignId, beforeSequence, limit}),
		getState: () => ({
			events: liveEvents,
			characters: liveCharacters,
			members: liveMembers,
			history: activityHistory,
		}),
		setState: ({events: eventsNxt, history: historyNxt}) => {
			liveEvents = eventsNxt;
			activityHistory = historyNxt;
		},
		render: input => renderRecentActivity({...input, isAuthorizationFenced: isActivityAuthorizationFenced}),
		renderError,
		getAuthorizationGeneration: () => activityAuthorizationGeneration,
		isAuthorizationFenced: () => isActivityAuthorizationFenced,
		onAuthorizationError: error => {
			return handleCampaignAuthorizationError(error);
		},
		isTerminal: () => isCampaignReloadRequired,
	});
	if (campaign.status !== "active") {
		setHidden(document.getElementById("campaign-invite-form"), true);
		setHidden(document.getElementById("campaign-upload-local"), true);
		setHidden(document.getElementById("campaign-dm-controls"), true);
		setHidden(document.getElementById("campaign-open-dm-screen"), true);
		setHidden(document.getElementById("campaign-inbox-panel"), true);
		setHidden(document.getElementById("campaign-workbench"), true);
		setHidden(document.getElementById("campaign-shared-actions"), true);
		setHidden(document.getElementById("campaign-leave"), true);
		setHidden(document.getElementById("campaign-jump-effect"), true);
		setHidden(document.getElementById("campaign-jump-transfer"), true);
		const partyStatus = document.getElementById("campaign-party-inventory-status");
		if (partyStatus) partyStatus.textContent = "Shared inventory is read-only while this campaign is archived.";
		setCampaignConnectionStatus({label: "Archived · read only", state: "neutral"});
		setHidden(document.getElementById("campaign-loading"), true);
		setHidden(document.getElementById("campaign-content"), false);
		document.title = `${campaign.name} - Campaign Hub - ThelemarTools`;
		return;
	}
	const {
		pRefreshTransferState,
		rulesPolicyManagerPromise,
		refreshActionFields,
		refreshItemAwardControlState,
		pRefreshContextBoundControls,
		isConditionCatalogRetryNeeded,
		flushDeferredMutationUi,
	} = await pInitCampaignForms({
		campaign,
		campaignId,
		session,
		characters,
		targetCharacters: snapshot.characters,
		members,
		context,
		events,
		getProjectionAuthorizationGeneration: () => projectionAuthorizationGeneration,
		requestProjectionRefresh: () => queueLiveRefresh(),
		pRefreshInvites,
		roster: snapshot.roster || [],
	});
	let liveLastSequence = snapshot.lastSequence;
	let projectionSnapshotLastSequence = snapshot.lastSequence;
	let authorityBaselineSequence = snapshot.lastSequence || 0;
	let isRefreshing = false;
	let isRefreshQueued = false;
	let isCampaignContextRefreshQueued = false;
	const pRefreshLiveViews = async () => {
		if (isCampaignReloadRequired || !navigator.onLine) return;
		if (isRefreshing) {
			isRefreshQueued = true;
			return;
		}
		const isRefreshCampaignContext = isCampaignContextRefreshQueued;
		const refreshProjectionGeneration = projectionAuthorizationGeneration;
		const fnIsProjectionCurrent = () => (
			!isCampaignReloadRequired
			&& projectionAuthorizationGeneration === refreshProjectionGeneration
		);
		let isProjectionRefreshSuccessful = false;
		isCampaignContextRefreshQueued = false;
		isRefreshing = true;
		try {
			const pMembersNxt = api.pListMembers({campaignId});
			const pCharactersNxt = api.pListCharacters({campaignId});
			const pSnapshotNxt = api.pGetCampaignSnapshot({campaignId});
			const pEventsPageNxt = pSnapshotNxt.then(snapshotNxt => api.pListEventPage({
				campaignId,
				beforeSequence: snapshotNxt.lastSequence + 1,
				limit: 50,
			}));
			const pActivityRefresh = Promise.all([pSnapshotNxt, pEventsPageNxt])
				.then(([snapshotNxt, eventsPageNxt]) => {
					const isSnapshotCurrent = snapshotNxt.lastSequence >= liveLastSequence;
					const isAuthorizationChanged = isSnapshotCurrent && (
						isActivityAuthorizationFenced
						|| hasHubActivityAuthorizationChanged({
							previousCharacters: liveCharacters,
							nextCharacters: snapshotNxt.characters,
						})
					);
					return {
						events: isActivityAuthorizationFenced && !isAuthorizationChanged
							? []
							: mergeHubActivityEvents({
								currentEvents: liveEvents,
								pageEvents: eventsPageNxt.events,
								isAuthorizationChanged,
							}),
						history: eventsPageNxt.history,
						isAuthorizationChanged,
					};
				});
			const pTransferStateRefresh = pRefreshTransferState({
				charactersNxt: pCharactersNxt,
				snapshotNxt: pSnapshotNxt,
				membersNxt: pMembersNxt,
				eventsNxt: pActivityRefresh.then(({events}) => events),
				fnIsCurrent: fnIsProjectionCurrent,
				fnIsSnapshotCurrent: snapshotNxt => snapshotNxt.lastSequence >= liveLastSequence,
				isProjectionControlRestoreDeferred: true,
			}).then(
				value => ({value}),
				error => ({error}),
			);
			const [membersNxt, charactersNxt, snapshotNxt, activityRefresh] = await Promise.all([
				pMembersNxt,
				pCharactersNxt,
				pSnapshotNxt,
				pActivityRefresh,
			]);
			if (!fnIsProjectionCurrent()) {
				concealProjectionFormControls();
				isRefreshQueued = true;
				return;
			}
			const isSnapshotCurrent = snapshotNxt.lastSequence >= liveLastSequence;
			if (!isSnapshotCurrent) {
				isRefreshQueued = true;
				return;
			}
			liveEvents = activityRefresh.events;
			if (activityRefresh.isAuthorizationChanged) {
				if (!isActivityAuthorizationFenced) invalidateActivityAuthorization();
				activityHistory = activityRefresh.history;
			}
			liveMembers = membersNxt;
			// Replacement, not a merge: a field the owner has just stopped sharing must
			// disappear rather than survive from the previous, broader projection.
			liveCharacters = snapshotNxt.characters;
			liveRoster = snapshotNxt.roster || [];
			liveLastSequence = snapshotNxt.lastSequence;
			projectionSnapshotLastSequence = Math.max(projectionSnapshotLastSequence, snapshotNxt.lastSequence);
			renderCharacterList({
				campaignId,
				characters: charactersNxt,
				session,
				isDm: ["dm", "co_dm"].includes(campaign.role),
			});
			applyCampaignRoleLayout({campaign, characters: charactersNxt});
			renderPartyRoster({
				campaignId,
				characters: liveCharacters,
				members: membersNxt,
				session,
				isDm: ["dm", "co_dm"].includes(campaign.role),
				roster: liveRoster,
			});
			const actionTarget = document.getElementById("campaign-action-target");
			const xpTarget = document.getElementById("campaign-xp-target");
			fillCharacterSelect(
				actionTarget,
				getTargetableProjections({projections: liveCharacters, roster: liveRoster}),
				{
					isPreserveSelection: true,
					selectionValue: projectionControlSelectionDraft?.actionTarget,
				},
			);
			fillCharacterSelect(
				xpTarget,
				charactersNxt,
				{
					isPreserveSelection: true,
					selectionValue: projectionControlSelectionDraft?.xpTarget,
				},
			);
			if (!document.getElementById("campaign-action-form")?._hubProjectionControlStates) {
				if (actionTarget) actionTarget.disabled = !actionTarget.options.length;
				if (xpTarget) xpTarget.disabled = !xpTarget.options.length;
				setFormAvailability({
					formId: "campaign-action-form",
					isAvailable: !!actionTarget?.value,
					message: actionTarget?.options.length
						? "Choose a target character before proposing an effect."
						: "Add a campaign character before proposing an effect.",
				});
			}
			if (activityRefresh.isAuthorizationChanged) isActivityAuthorizationFenced = false;
			renderRecentActivity({
				events: isActivityAuthorizationFenced ? [] : liveEvents,
				characters: isActivityAuthorizationFenced ? [] : liveCharacters,
				members: isActivityAuthorizationFenced ? [] : membersNxt,
				history: isActivityAuthorizationFenced ? null : activityHistory,
				isLoading: isActivityAuthorizationFenced,
				isAuthorizationFenced: isActivityAuthorizationFenced,
			});
			if (isRefreshCampaignContext) {
				const contextNxt = await api.pGetCampaignContext({campaignId});
				if (!fnIsProjectionCurrent()) {
					concealProjectionFormControls();
					isRefreshQueued = true;
					return;
				}
				context = contextNxt;
				renderCampaignContext(contextNxt);
				void rulesPolicyManagerPromise.then(manager => {
					if (fnIsProjectionCurrent()) manager?.replaceContext(contextNxt);
				});
				await pRefreshContextBoundControls({context: contextNxt});
			} else if (isConditionCatalogRetryNeeded()) {
				await pRefreshContextBoundControls({context});
			}
			if (!fnIsProjectionCurrent()) {
				concealProjectionFormControls();
				isRefreshQueued = true;
				return;
			}
			const [actionRefreshResult, transferRefreshResult] = await Promise.all([
				renderPendingActions({
					campaign,
					campaignId,
					session,
					targetCharacters: liveCharacters,
					members: membersNxt,
					roster: liveRoster,
					fnIsCurrent: fnIsProjectionCurrent,
				}),
				pTransferStateRefresh,
			]);
			if (
				!fnIsProjectionCurrent()
				|| actionRefreshResult?.isFenced
				|| transferRefreshResult.value?.isFenced
			) {
				concealProjectionFormControls();
				isRefreshQueued = true;
				return;
			}
			if (transferRefreshResult.error) throw transferRefreshResult.error;
			for (const formId of ["campaign-action-form", "campaign-transfer-form", "campaign-xp-form", "campaign-item-form"]) {
				setProjectionFormControlsConcealed({
					form: document.getElementById(formId),
					isConcealed: false,
				});
			}
			transferRefreshResult.value?.restoreTransferControlState?.();
			if (actionTarget) actionTarget.disabled = !actionTarget.options.length;
			if (xpTarget) xpTarget.disabled = !xpTarget.options.length;
			setFormAvailability({
				formId: "campaign-action-form",
				isAvailable: !!actionTarget?.value,
				message: actionTarget?.options.length
					? "Choose a target character before proposing an effect."
					: "Add a campaign character before proposing an effect.",
			});
			setFormAvailability({
				formId: "campaign-xp-form",
				isAvailable: !!xpTarget?.value,
				message: xpTarget?.options.length
					? "Choose a target character before using this grant."
					: "Add a campaign character before using this grant.",
			});
			refreshItemAwardControlState();
			refreshActionFields({isRetryConditionCatalog: false});
			projectionControlSelectionDraft = null;
			isProjectionRefreshSuccessful = true;
		} catch (error) {
			if (!fnIsProjectionCurrent()) {
				concealProjectionFormControls();
				isRefreshQueued = true;
				return;
			}
			renderError(error);
		} finally {
			isRefreshing = false;
			if (isRefreshQueued) {
				isRefreshQueued = false;
				void pRefreshLiveViews();
			} else if (isProjectionRefreshSuccessful && refreshTimer == null) {
				flushDeferredMutationUi();
			}
		}
	};
	const queueLiveRefresh = ({isCampaignContextRefresh = false} = {}) => {
		if (isCampaignReloadRequired) return;
		if (isCampaignContextRefresh) isCampaignContextRefreshQueued = true;
		if (refreshTimer != null) window.clearTimeout(refreshTimer);
		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			void pRefreshLiveViews();
		}, 250);
	};
	const reloadForAuthorityChange = createCampaignAuthorityChangeHandler({
		fnIsReloadRequired: () => isCampaignReloadRequired,
		fnSetReloadRequired: () => isCampaignReloadRequired = true,
		fnConcealAuthorization: concealCampaignAuthorization,
		fnStopLiveUpdates: stopCampaignLiveUpdates,
		fnReload: () => window.location.reload(),
	});
	realtime.on("event", event => {
		const isOwnRoleChange = event.type === "membership.role_changed"
			&& event.payload?.accountId === session.account.id
			&& event.payload?.role !== campaign.role;
		const isOwnRoleChangeCoveredByBaseline = isOwnRoleChange && isRealtimeEventCoveredByBaseline({
			event,
			baselineSequence: authorityBaselineSequence,
		});
		if (event.type === "campaign.archived" || (isOwnRoleChange && !isOwnRoleChangeCoveredByBaseline)) {
			reloadForAuthorityChange();
			return;
		}
		const isProjectionInvalidation = event.type === "character.projection.invalidated";
		const isProjectionInvalidationCoveredByBaseline = isProjectionInvalidation
			&& isRealtimeEventCoveredByBaseline({
				event,
				baselineSequence: projectionSnapshotLastSequence,
			});
		if (isProjectionInvalidation && !isProjectionInvalidationCoveredByBaseline) {
			concealCampaignProjectionAuthorization();
		}
		if (isProjectionInvalidationCoveredByBaseline) return;
		if (!isCampaignReloadRequired && navigator.onLine) {
			liveLastSequence = Math.max(liveLastSequence, event.sequence || 0);
			if (!isProjectionInvalidation) {
				liveEvents = [...liveEvents.filter(existing => existing.id !== event.id), event]
					.sort((a, b) => a.sequence - b.sequence);
				renderRecentActivity({
					events: liveEvents,
					characters: liveCharacters,
					members: liveMembers,
					history: activityHistory,
					isAuthorizationFenced: isActivityAuthorizationFenced,
				});
			}
		}
		// ADR 0011: `character.projection.invalidated` carries no character data. Every
		// event, including an invalidation, is coalesced into one authorization-scoped
		// HTTP refetch that *replaces* the roster rather than merging into it, so a
		// previously broader projection cannot survive a narrowed sharing policy.
		const isCampaignContextRefresh = event.type === "rules.activated"
			|| event.type === "brew.activated";
		queueLiveRefresh({isCampaignContextRefresh});
	});
	realtime.on("cursor", baseline => {
		authorityBaselineSequence = Math.max(authorityBaselineSequence, baseline?.cursor?.lastSequence || 0);
		if (baseline?.membership?.role && baseline.membership.role !== campaign.role) {
			reloadForAuthorityChange();
			return;
		}
		if ((baseline?.cursor?.lastSequence || 0) >= liveLastSequence) {
			liveLastSequence = baseline.cursor.lastSequence;
		}
		queueLiveRefresh();
	});
	realtime.on("state", ({state, reason}) => {
		if (isCampaignReloadRequired) return;
		if (state === "live") setCampaignConnectionStatus({label: "Live updates connected", state: "connected"});
		else if (state === "reconnecting") setCampaignConnectionStatus({label: "Live updates reconnecting", state: "warning"});
		else if (state === "access_lost") {
			handleCampaignAuthorizationError(
				/session|account deletion/i.test(reason || "")
					? new HubApiError({code: "AUTH_REQUIRED", status: 401})
					: new HubApiError({code: "CAMPAIGN_NOT_FOUND", status: 404}),
			);
		}
	});
	window.addEventListener("beforeunload", () => {
		if (campaignAuthorizationErrorHandler === handleCampaignAuthorizationError) campaignAuthorizationErrorHandler = null;
		realtime.close();
	}, {once: true});
	await realtime.pConnect().catch(() => {
		if (!isCampaignReloadRequired) setCampaignConnectionStatus({label: "Live updates reconnecting", state: "warning"});
	});
	if (realtime.getConnectionState().state !== "live") setCampaignConnectionStatus({label: "Campaign data connected", state: "connected"});
	document.title = `${campaign.name} - Campaign Hub - ThelemarTools`;
	setHidden(document.getElementById("campaign-loading"), true);
	setHidden(document.getElementById("campaign-content"), false);
}

function renderCampaignContext (context) {
	const brew = document.getElementById("campaign-brew-status");
	const rules = document.getElementById("campaign-rules-status");
	if (brew) {
		brew.textContent = context.brewBundle
			? `Version ${context.brewBundle.version} · ${context.brewBundle.manifest.documentCount} ${context.brewBundle.manifest.documentCount === 1 ? "document" : "documents"}`
			: "Not published";
	}
	if (rules) {
		rules.textContent = context.rulesVersion
			? `${context.rulesVersion.rules.exhaustionRules} exhaustion · version ${context.rulesVersion.version}`
			: "Not published";
	}
	renderCampaignPolicySummary({context});
}

function renderCampaignPolicySummary ({context}) {
	const list = document.getElementById("campaign-policy-summary-list");
	const status = document.getElementById("campaign-policy-summary-status");
	if (!list || !status) return;
	const version = context?.rulesVersion;
	list.replaceChildren();
	if (!version) {
		status.textContent = "No campaign policy has been published.";
		setHidden(list, true);
		return;
	}
	status.textContent = `Version ${version.version}. Campaign choices are temporary overlays and do not change personal settings.`;
	setHidden(list, false);
	for (const rule of version.policySummary?.rules || []) {
		const item = document.createElement("div");
		item.className = "hub-policy-summary__item";
		const term = document.createElement("dt");
		term.textContent = rule.title;
		const description = document.createElement("dd");
		description.textContent = `${rule.value} · ${rule.supportLabel}`;
		item.append(term, description);
		list.append(item);
	}
}

function renderCampaignRulesPolicyUnavailable () {
	const root = document.getElementById("campaign-rules-policy-manager");
	const loading = document.getElementById("campaign-rules-policy-loading");
	const content = document.getElementById("campaign-rules-policy-content");
	const legacyForm = document.getElementById("campaign-rules-form");
	if (!root || !loading) return;
	setHidden(root, false);
	setHidden(content, true);
	setHidden(legacyForm, false);
	loading.textContent = "Rules library unavailable. The existing rules editor remains available; no campaign settings were changed.";
	loading.classList.add("hub-inline-status--error");
	root.setAttribute("aria-busy", "false");
}

async function pInitCampaignRulesPolicySurface (options) {
	const loaded = await pLoadHubCapabilityModule({
		capability: HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
		pGetMeta: () => api.pGetMeta(),
		pImport: () => import("./hub-rules-policy-manager.js"),
	});
	if (loaded.status === "disabled") return null;
	if (loaded.status === "unavailable") {
		renderCampaignRulesPolicyUnavailable();
		return null;
	}
	try {
		return await loaded.module.pInitCampaignRulesPolicy({...options, isCapabilityEnabled: true});
	} catch {
		renderCampaignRulesPolicyUnavailable();
		return null;
	}
}

function renderMemberList ({campaign, campaignId, members, session, pRefresh}) {
	const list = document.getElementById("campaign-member-list");
	if (!list) return;
	const summary = document.getElementById("campaign-member-summary");
	if (summary) summary.textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;
	list.replaceChildren(...members.map(member => {
		const row = document.createElement("li");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.textContent = member.displayName;
		const role = document.createElement("span");
		role.className = "hub-data-row__meta";
		role.textContent = getRoleLabel(member.role);
		main.append(name, role);
		row.append(main);
		const isOwner = member.accountId === campaign.ownerAccountId;
		const canChangeRole = campaign.status === "active" && session.account.id === campaign.ownerAccountId && !isOwner;
		const canRemove = campaign.status === "active" && !isOwner && (
			session.account.id === campaign.ownerAccountId
			|| (campaign.role === "co_dm" && ["player", "spectator"].includes(member.role))
		);
		if (canChangeRole || canRemove) {
			const controls = document.createElement("div");
			controls.className = "hub-data-row__controls";
			if (canChangeRole) {
				const select = document.createElement("select");
				select.className = "hub-input";
				for (const value of ["co_dm", "player", "spectator"]) {
					const option = document.createElement("option");
					option.value = value;
					option.textContent = getRoleLabel(value);
					option.selected = member.role === value;
					select.append(option);
				}
				select.addEventListener("change", async () => {
					select.disabled = true;
					try {
						await api.pChangeMemberRole({campaignId, membershipId: member.id, role: select.value, idempotencyKey: crypto.randomUUID()});
						await pRefresh();
					} catch (error) {
						renderError(error);
						if (!isCampaignReloadRequired) select.disabled = false;
						select.value = member.role;
					}
				});
				controls.append(select);
			}
			if (canRemove) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "hub-button hub-button--danger";
				button.textContent = "Remove";
				button.addEventListener("click", async () => {
					if (!window.confirm(`Remove ${member.displayName} from this campaign? Their campaign characters will return to personal ownership.`)) return;
					button.disabled = true;
					try {
						await api.pRemoveMember({campaignId, membershipId: member.id, idempotencyKey: crypto.randomUUID()});
						await pRefresh();
					} catch (error) {
						renderError(error);
						if (!isCampaignReloadRequired) button.disabled = false;
					}
				});
				controls.append(button);
			}
			row.append(controls);
		}
		return row;
	}));
}

function renderInviteList ({campaignId, invites, pRefresh}) {
	const list = document.getElementById("campaign-invite-list");
	if (!list) return;
	list.replaceChildren(...invites.map(invite => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("div");
		main.className = "hub-data-row__main";
		const title = document.createElement("span");
		title.textContent = `${getRoleLabel(invite.role)} invite`;
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = `${invite.useCount}/${invite.maxUses} used · expires ${getDateLabel(invite.expiresAt)}${invite.revokedAt ? " · revoked" : ""}`;
		main.append(title, meta);
		row.append(main);
		if (!invite.revokedAt) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hub-button";
			button.textContent = "Revoke";
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await api.pRevokeInvite({campaignId, inviteId: invite.id, idempotencyKey: crypto.randomUUID()});
					await pRefresh();
				} catch (error) {
					renderError(error);
					if (!isCampaignReloadRequired) button.disabled = false;
				}
			});
			row.append(button);
		}
		return row;
	}));
}

function renderCharacterList ({campaignId, characters, session, isDm}) {
	const list = document.getElementById("campaign-character-list");
	if (!list) return;
	setCount({id: "campaign-character-count", count: characters.length});
	const empty = document.getElementById("campaign-character-empty");
	if (empty) {
		empty.textContent = "No characters are attached yet. Add a local copy without changing the original.";
		setHidden(empty, !!characters.length);
	}
	list.replaceChildren(...characters.map(character => {
		const link = document.createElement("a");
		link.className = "hub-data-row";
		link.href = `charactersheet.html?id=${encodeURIComponent(character.id)}&hubCampaign=${encodeURIComponent(campaignId)}`;
		const isReadOnlyDm = isDm && character.ownerAccountId !== session.account.id;
		if (isReadOnlyDm) link.title = "Open this character in a read-only DM view";
		const main = document.createElement("span");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.className = "hub-data-row__name";
		name.textContent = getCharacterName(character);
		const status = document.createElement("span");
		status.className = "hub-data-row__meta";
		status.textContent = getCharacterSummary(character);
		main.append(name, status);
		const open = document.createElement("span");
		open.className = "hub-data-row__open";
		open.textContent = isReadOnlyDm ? "Inspect sheet" : "Open sheet";
		link.append(main, open);
		return link;
	}));
}

function renderPartyRoster ({campaignId, characters, members, session, isDm, roster = null}) {
	const list = document.getElementById("campaign-party-roster");
	if (!list) return;
	setCount({id: "campaign-party-count", count: characters.length});
	setHidden(document.getElementById("campaign-party-empty"), !!characters.length);
	list.replaceChildren(...characters.map(character => {
		const characterId = getProjectionId(character);
		const isOwner = getProjectionOwnerAccountId(character) === session.account.id;
		const canOpen = isCanonicalProjection(character) && (isDm || isOwner);
		const row = document.createElement(canOpen ? "a" : "summary");
		row.className = "hub-data-row";
		if (canOpen) {
			row.href = `charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`;
			if (isDm && !isOwner) row.title = "Open this character in a read-only DM view";
		}
		const main = document.createElement("span");
		main.className = "hub-data-row__main";
		const name = document.createElement("span");
		name.className = "hub-data-row__name";
		name.textContent = getCharacterName(character);
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		// Owner attribution is campaign-roster metadata gated on peer-visible identity, so
		// it is absent rather than guessed when the owner shares nothing.
		const ownerName = getMemberNameByMembership(members, getOwnerMembershipId({roster, characterId}));
		meta.textContent = [ownerName, getCharacterSummary(character)].filter(Boolean).join(" · ");
		main.append(name, meta);
		row.append(main);
		if (canOpen) {
			const open = document.createElement("span");
			open.className = "hub-data-row__open";
			open.textContent = isDm && !isOwner ? "Inspect sheet" : "Open sheet";
			row.append(open);
			return row;
		}

		const open = document.createElement("span");
		open.className = "hub-data-row__open";
		open.textContent = "View shared profile";
		row.append(open);

		const details = document.createElement("details");
		details.className = "hub-shared-profile";
		details.append(row);
		const profile = document.createElement("div");
		profile.className = "hub-shared-profile__body";
		const fields = getProjectionProfileRows(character);
		if (!fields.length) {
			const empty = document.createElement("p");
			empty.className = "hub-shared-profile__empty";
			empty.textContent = "This player is not sharing any profile details.";
			profile.append(empty);
		} else {
			const heading = document.createElement("p");
			heading.className = "hub-shared-profile__intro";
			heading.textContent = "Server-authorized profile shared with players";
			const values = document.createElement("dl");
			values.className = "hub-shared-profile__list";
			for (const field of fields) {
				const term = document.createElement("dt");
				term.textContent = field.label;
				const description = document.createElement("dd");
				description.textContent = field.value;
				values.append(term, description);
			}
			profile.append(heading, values);
		}
		details.append(profile);
		return details;
	}));
}

function renderRecentActivity ({
	events,
	characters,
	members,
	history = null,
	isLoading = false,
	isAuthorizationFenced = false,
	statusMessage = "",
}) {
	const list = document.getElementById("campaign-activity-list");
	if (!list) return;
	const rows = renderHubActivityRows({
		list,
		events,
		characters,
		members,
		documentRef: document,
		getDateLabel,
		limit: null,
	});
	const hasMore = history?.hasMore === true;
	setHidden(document.getElementById("campaign-activity-empty"), !!rows.length || hasMore || isLoading);
	const status = document.getElementById("campaign-activity-status");
	if (status) {
		status.textContent = isLoading
			? "Loading earlier activity..."
			: statusMessage || (!rows.length && hasMore ? "No visible activity in this window. Older retained history is still available." : "");
		setHidden(status, !status.textContent);
	}
	const loadEarlier = document.getElementById("campaign-activity-load-earlier");
	if (loadEarlier) {
		loadEarlier.disabled = isLoading || isAuthorizationFenced;
		setHidden(loadEarlier, !hasMore);
	}
	return rows;
}

function fillCharacterSelect (
	select,
	characters,
	{
		includeParty = false,
		isPreserveSelection = false,
		partyInventory = null,
		ownerAccountId = null,
		selectionValue = undefined,
	} = {},
) {
	if (!select) return;
	const selectedValue = isPreserveSelection
		? (selectionValue === undefined ? select.value : selectionValue)
		: null;
	select.replaceChildren();
	for (const character of characters) {
		// `characters` may be raw owner-scoped documents (the player's own list) or
		// authorization envelopes (campaign-wide), so ownership is read through one helper.
		if (ownerAccountId && getProjectionOwnerAccountId(character) !== ownerAccountId) continue;
		const option = document.createElement("option");
		option.value = `character:${getProjectionId(character)}`;
		option.textContent = getProjectionName(character);
		select.append(option);
	}
	if (includeParty && partyInventory) {
		const option = document.createElement("option");
		option.value = `party_inventory:${partyInventory.id}`;
		option.textContent = "Party inventory";
		select.append(option);
	}
	if (isPreserveSelection) {
		select.value = [...select.options].some(option => option.value === selectedValue)
			? selectedValue
			: "";
	}
}

function updateInboxCount ({kind, count}) {
	const element = document.getElementById("campaign-inbox-count");
	if (!element) return;
	element.dataset[kind] = `${count}`;
	const total = Number(element.dataset.actions || 0) + Number(element.dataset.transfers || 0);
	element.textContent = `${total}`;
	const panel = document.getElementById("campaign-inbox-panel");
	if (panel) panel.dataset.attention = total ? "pending" : "clear";
	const summary = document.getElementById("campaign-attention-summary");
	if (summary) {
		summary.textContent = total
			? `${total} pending ${total === 1 ? "request" : "requests"}.`
			: "No pending requests.";
	}
}

async function renderPendingActions ({
	campaign,
	campaignId,
	session,
	targetCharacters,
	members,
	roster = null,
	fnIsCurrent = () => true,
}) {
	const list = document.getElementById("campaign-pending-actions");
	if (!list) return;
	const actions = await api.pListPendingActions({campaignId});
	if (!fnIsCurrent()) return {isFenced: true};
	const pending = actions.filter(action => action.status === "proposed");
	updateInboxCount({kind: "actions", count: pending.length});
	setHidden(document.getElementById("campaign-pending-actions-empty"), !!pending.length);
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	list.replaceChildren(...pending.map(action => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("span");
		main.className = "hub-data-row__main";
		const text = document.createElement("span");
		const target = getCharacterById(targetCharacters, action.targetCharacterId);
		const sourceName = action.sourceDisplaySnapshot?.identity?.name || "A character";
		const effectName = action.effectDisplaySnapshot?.label || "an effect";
		const targetName = action.targetDisplaySnapshot?.identity?.name || getCharacterName(target);
		text.textContent = `${sourceName} proposes ${effectName} for ${targetName}.`;
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		const isTargetOwner = campaign.role === "player" && getProjectionOwnerAccountId(target) === session.account.id;
		const decisions = isTargetOwner ? ["accept", "reject"] : isDm ? ["reject"] : [];
		meta.textContent = decisions.length ? "Your response is needed" : "Waiting for the recipient";
		main.append(text, meta);
		row.append(main);
		if (decisions.length) {
			const controls = document.createElement("span");
			controls.className = "hub-data-row__controls";
			for (const decision of decisions) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = decision === "accept" ? "hub-button hub-button--primary" : "hub-button";
				button.textContent = decision === "accept" ? "Apply" : "Reject";
				button.addEventListener("click", async () => {
					button.disabled = true;
					try {
						await api.pResolveStructuredAction({campaignId, actionId: action.operationId, decision, idempotencyKey: crypto.randomUUID()});
						if (!fnIsCurrent()) return;
						await renderPendingActions({campaign, campaignId, session, targetCharacters, members, roster, fnIsCurrent});
					} catch (error) {
						if (!fnIsCurrent()) return;
						renderError(error);
						if (!isCampaignReloadRequired) button.disabled = false;
					}
				});
				controls.append(button);
			}
			row.append(controls);
		}
		return row;
	}));
	return {isFenced: false};
}

async function renderPendingTransfers ({
	campaign,
	campaignId,
	session,
	targetCharacters,
	members,
	pRefreshTransferState,
	fnIsCurrent = () => true,
}) {
	const list = document.getElementById("campaign-pending-transfers");
	if (!list) return {pendingTransferIds: []};
	const transfers = await api.pListTransfers({campaignId});
	if (!fnIsCurrent()) return {pendingTransferIds: [], isFenced: true};
	const pRefreshCurrentTransferState = refresh => pRefreshTransferState({...refresh, fnIsCurrent});
	delete list._hubTransferInboxRecovery;
	const pending = transfers.filter(transfer => ["proposed", "reserved"].includes(transfer.status));
	const pendingTransferIds = pending.map(transfer => transfer.id);
	transferResolutionDrafts.reconcilePending({campaignId, pendingTransferIds});
	updateInboxCount({kind: "transfers", count: pending.length});
	setHidden(document.getElementById("campaign-pending-transfers-empty"), !!pending.length);
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	list.replaceChildren(...pending.map(transfer => {
		const row = document.createElement("div");
		row.className = "hub-data-row";
		const main = document.createElement("span");
		main.className = "hub-data-row__main";
		const text = document.createElement("span");
		const contents = getTransferContentsDescription(transfer);
		const sourceName = getTransferContainerName({transfer, endpoint: "source", characters: targetCharacters});
		const targetName = getTransferContainerName({transfer, endpoint: "target", characters: targetCharacters});
		const isRequest = transfer.status === "proposed";
		text.textContent = isRequest
			? `${targetName} requests ${contents} from ${sourceName}.`
			: `${sourceName} offers ${contents} to ${targetName}.`;
		const target = transfer.targetKind === "character" ? getCharacterById(targetCharacters, transfer.targetId) : null;
		const canAct = isDm || campaign.role === "player";
		const canAccept = canAct && (isRequest
			? isDm
			: isDm || getProjectionOwnerAccountId(target) === session.account.id);
		const canReject = canAct && (canAccept || transfer.actorAccountId === session.account.id);
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = canAccept
			? isRequest
				? "DM approval is needed before the stash changes"
				: isDm && getProjectionOwnerAccountId(target) !== session.account.id
					? "You can apply this transfer with DM authority"
					: "Your response is needed"
			: canReject
				? isRequest
					? "Waiting for a DM; you can cancel this request"
					: "Waiting for the recipient; you can cancel this transfer"
				: isRequest ? "Waiting for a DM" : "Waiting for the recipient";
		main.append(text, meta);
		row.append(main);
		if (canReject) {
			const controls = document.createElement("span");
			controls.className = "hub-data-row__controls";
			const pendingResolutionRequest = transferResolutionDrafts.get({campaignId, transferId: transfer.id});
			for (const decision of [...(canAccept ? ["accept"] : []), "reject"]) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = decision === "accept" ? "hub-button hub-button--primary" : "hub-button";
				button.dataset.transferDecision = decision;
				button.textContent = decision === "accept"
					? isRequest ? "Approve" : "Accept"
					: canAccept ? isRequest ? "Decline" : "Reject" : "Cancel";
				button.addEventListener("click", async () => {
					for (const control of controls.querySelectorAll("button")) control.disabled = true;
					let resolutionRequest = transferResolutionDrafts.get({campaignId, transferId: transfer.id});
					if (resolutionRequest && resolutionRequest.decision !== decision) {
						renderError("");
						setTransferInboxRefreshFailure({
							controls,
							meta,
							message: `The ${resolutionRequest.decision === "accept" ? "accept" : "decline"} outcome is not yet confirmed. Refresh the inbox or retry that same decision.`,
							pRetry: pRefreshTransferState,
							isResolutionKnown: false,
							pendingDecision: resolutionRequest.decision,
						});
						return;
					}
					if (!resolutionRequest) {
						let currentContext;
						try {
							currentContext = decision === "accept"
								? await api.pGetCampaignContext({campaignId})
								: null;
							if (!fnIsCurrent()) return;
						} catch (error) {
							if (!fnIsCurrent()) return;
							renderError(error);
							if (!isCampaignReloadRequired) {
								for (const control of controls.querySelectorAll("button")) control.disabled = false;
							}
							return;
						}
						resolutionRequest = transferResolutionDrafts.stage({
							campaignId,
							transferId: transfer.id,
							decision,
							rulesVersionId: currentContext?.rulesVersion?.id || null,
						});
					}
					if (!transferResolutionDrafts.isReplayable(resolutionRequest)) {
						setTransferInboxRefreshFailure({
							controls,
							meta,
							message: "This decision retry is too old to replay safely. Refresh the inbox before acting again.",
							pRetry: pRefreshTransferState,
							isResolutionKnown: true,
						});
						return;
					}
					const outcome = await pResolveTransferAndRefresh({
						pResolve: async () => {
							try {
								const resolution = await api.pResolveTransfer(resolutionRequest);
								transferResolutionDrafts.clear(resolutionRequest);
								return resolution;
							} catch (error) {
								if (!isTransferOutcomeUncertain(error)) transferResolutionDrafts.clear(resolutionRequest);
								throw error;
							}
						},
						pRefresh: pRefreshCurrentTransferState,
					});
					if (!fnIsCurrent()) return;
					if (outcome.state === "resolved_refreshed") {
						transferResolutionDrafts.clear(resolutionRequest);
						renderError("");
						return;
					}
					if (outcome.state === "resolution_failed_refreshed") {
						const isStillPending = outcome.refreshResult.pendingTransferIds.includes(transfer.id);
						renderError(isStillPending ? outcome.resolutionError : "");
						return;
					}
					if (outcome.state === "resolved_refresh_failed") {
						transferResolutionDrafts.clear(resolutionRequest);
						renderError(outcome.refreshError);
						setTransferInboxRefreshFailure({
							controls,
							meta,
							message: `${decision === "accept" ? "Transfer applied." : "Transfer declined."} The committed outcome is safe, but the latest transfer state could not be loaded.`,
							pRetry: pRefreshCurrentTransferState,
							isResolutionKnown: true,
						});
						return;
					}
					const isOutcomeUncertain = isTransferOutcomeUncertain(outcome.resolutionError);
					renderError(outcome.resolutionError);
					setTransferInboxRefreshFailure({
						controls,
						meta,
						message: isOutcomeUncertain
							? "The transfer outcome is not yet confirmed. Refresh the inbox or retry the same decision."
							: "The decision was not applied, and the latest transfer state could not be loaded. Refresh the inbox before acting again.",
						pRetry: pRefreshCurrentTransferState,
						isResolutionKnown: !isOutcomeUncertain,
						pendingDecision: resolutionRequest.decision,
					});
				});
				controls.append(button);
			}
			if (pendingResolutionRequest) {
				const isReplayable = transferResolutionDrafts.isReplayable(pendingResolutionRequest);
				setTransferInboxRefreshFailure({
					controls,
					meta,
					message: isReplayable
						? "The transfer outcome is not yet confirmed. Refresh the inbox or retry the same decision."
						: "This decision retry is too old to replay safely. Refresh the inbox before acting again.",
					pRetry: pRefreshCurrentTransferState,
					isResolutionKnown: !isReplayable,
					pendingDecision: pendingResolutionRequest.decision,
				});
			}
			row.append(controls);
		}
		return row;
	}));
	return {pendingTransferIds, transfers};
}

function getFormFingerprint (form) {
	return JSON.stringify([...form.elements]
		.filter(control => control.id)
		.map(control => [
			control.id,
			control.type === "file"
				? [...(control.files || [])].map(file => `${file.name}:${file.size}:${file.lastModified}`)
				: ["checkbox", "radio"].includes(control.type)
					? control.checked
					: control.value,
		])
		.sort(([idA], [idB]) => idA.localeCompare(idB)));
}

async function pRunFormMutation ({form, fingerprint, fnMutate}) {
	if (form._hubIsSubmitting) return null;
	if (typeof fingerprint !== "string") throw new TypeError("A mutation fingerprint is required.");
	if (form._hubMutationFingerprint !== fingerprint) {
		form._hubMutationFingerprint = fingerprint;
		form._hubMutationKey = crypto.randomUUID();
	}
	form._hubIsSubmitting = true;
	form._hubMutationControlStates = new Map(
		[...form.querySelectorAll("button, input, select, textarea")]
			.map(control => [control, control.disabled]),
	);
	const buttons = [...form.querySelectorAll("button[type='submit']")];
	const buttonStates = buttons.map(button => ({
		button,
		disabled: button.disabled,
		text: button.textContent,
	}));
	form.setAttribute("aria-busy", "true");
	buttonStates.forEach(({button}) => {
		button.disabled = true;
		if (button.dataset.pendingLabel) button.textContent = button.dataset.pendingLabel;
	});
	try {
		const out = await fnMutate(form._hubMutationKey);
		form._hubMutationKey = null;
		form._hubMutationFingerprint = null;
		return out;
	} finally {
		form._hubIsSubmitting = false;
		form.removeAttribute("aria-busy");
		buttonStates.forEach(({button, disabled, text}) => {
			button.disabled = isCampaignReloadRequired || !!form._hubProjectionControlStates
				? true
				: disabled;
			button.textContent = text;
		});
		delete form._hubMutationControlStates;
	}
}

async function pInitCampaignForms ({
	campaign,
	campaignId,
	session,
	characters,
	targetCharacters,
	members,
	context,
	events = [],
	getProjectionAuthorizationGeneration = () => 0,
	requestProjectionRefresh = () => {},
	pRefreshInvites,
	roster = [],
}) {
	// Roster metadata travels beside the projections and is refreshed with them.
	const rosterRef = {current: roster};
	const captureProjectionAuthorization = () => {
		const generation = getProjectionAuthorizationGeneration();
		return () => (
			!isCampaignReloadRequired
			&& getProjectionAuthorizationGeneration() === generation
		);
	};
	const deferredMutationUi = [];
	const deferMutationUi = ({form, fnApply}) => {
		if (typeof fnApply !== "function") return;
		deferredMutationUi.push({form, fnApply});
		requestProjectionRefresh();
	};
	const flushDeferredMutationUi = () => {
		const deferred = deferredMutationUi.splice(0);
		for (const entry of deferred) {
			if (entry.form?._hubIsSubmitting || entry.form?._hubProjectionControlStates) {
				deferredMutationUi.push(entry);
				continue;
			}
			entry.fnApply();
		}
	};
	const inviteForm = document.getElementById("campaign-invite-form");
	const inviteOutput = document.getElementById("campaign-invite-output");
	const inviteResult = document.getElementById("campaign-invite-result");
	const inviteCopy = document.getElementById("campaign-invite-copy");
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	const activeRules = context.rulesVersion?.rules;
	if (activeRules) {
		document.getElementById("campaign-rule-tgtt").checked = !!activeRules.enableTgtt;
		document.getElementById("campaign-rule-exhaustion").value = activeRules.exhaustionRules;
		document.getElementById("campaign-rule-carry").checked = !!activeRules.thelemar_carryWeight;
		document.getElementById("campaign-rule-encumbrance-tiers").checked = activeRules.thelemar_encumbranceTiers !== false;
		document.getElementById("campaign-rule-jumping").checked = !!activeRules.thelemar_jumping;
		document.getElementById("campaign-rule-linguistics").checked = !!activeRules.thelemar_linguisticsBonus;
		document.getElementById("campaign-rule-critical").checked = !!activeRules.thelemar_criticalRolls;
	}
	const rulesPolicyManagerPromise = isDm
		? pInitCampaignRulesPolicySurface({
			api,
			campaignId,
			context,
			fnRenderCampaignContext: renderCampaignContext,
			fnRenderError: renderError,
		}).catch(error => {
			renderError(error);
			return null;
		})
		: Promise.resolve(null);
	setHidden(inviteForm, !isDm);
	inviteForm?.addEventListener("submit", async event => {
		event.preventDefault();
		setFormStatus({formId: "campaign-invite-form"});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fingerprint: getFormFingerprint(event.currentTarget),
				fnMutate: async idempotencyKey => {
					const role = document.getElementById("campaign-invite-role").value;
					const result = await api.pCreateInvite({campaignId, role, idempotencyKey});
					const joinUrl = new URL("hub.html", window.location.href);
					joinUrl.hash = `invite=${encodeURIComponent(result.token)}`;
					inviteOutput.value = joinUrl.href;
					setHidden(inviteResult, false);
					setFormStatus({formId: "campaign-invite-form", message: "Invite ready. Copy the link and send it privately."});
					await pRefreshInvites();
					inviteCopy.focus();
				}});
		} catch (error) {
			const message = getErrorMessage(error);
			setFormStatus({formId: "campaign-invite-form", message, isError: true});
			renderError(error);
		}
	});
	inviteCopy?.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(inviteOutput.value);
			setFormStatus({formId: "campaign-invite-form", message: "Invite link copied."});
		} catch {
			inviteOutput.select();
			setFormStatus({formId: "campaign-invite-form", message: "The invite link is selected. Copy it with your browser's copy command."});
		}
	});
	const leave = document.getElementById("campaign-leave");
	setHidden(leave, session.account.id === campaign.ownerAccountId);
	leave?.addEventListener("click", async () => {
		if (!window.confirm(`Leave ${campaign.name}? Your campaign characters will return to personal ownership.`)) return;
		leave.disabled = true;
		try {
			await api.pLeaveCampaign({campaignId, idempotencyKey: crypto.randomUUID()});
			window.location.assign("hub.html");
		} catch (error) {
			renderError(error);
			if (!isCampaignReloadRequired) leave.disabled = false;
		}
	});

	const upload = document.getElementById("campaign-upload-local");
	const uploadControls = document.getElementById("campaign-upload-local-controls");
	const uploadSelect = document.getElementById("campaign-upload-local-select");
	const uploadConfirm = document.getElementById("campaign-upload-local-confirm");
	const uploadCancel = document.getElementById("campaign-upload-local-cancel");
	const uploadStatus = document.getElementById("campaign-upload-local-status");
	let localCharacters = [];
	upload?.addEventListener("click", async () => {
		upload.disabled = true;
		if (uploadStatus) uploadStatus.textContent = "";
		try {
			const {pGetLocalCharacters} = await import("./hub-local-character-adapter.js");
			localCharacters = await pGetLocalCharacters();
			if (!localCharacters.length) {
				if (uploadStatus) uploadStatus.textContent = "No local characters are available to copy. Create one in the Character Sheet first.";
				return;
			}
			uploadSelect.replaceChildren(...localCharacters.map((character, index) => {
				const option = document.createElement("option");
				option.value = `${index}`;
				option.textContent = character.name || "Unnamed Character";
				return option;
			}));
			setHidden(uploadControls, false);
			uploadSelect.focus();
		} catch (error) {
			renderError(error.message || "Local character storage could not be read.");
		} finally {
			upload.disabled = false;
		}
	});
	uploadCancel?.addEventListener("click", () => {
		setHidden(uploadControls, true);
		upload.focus();
	});
	uploadConfirm?.addEventListener("click", async () => {
		const character = localCharacters[Number(uploadSelect.value)];
		if (!character) return;
		uploadConfirm.disabled = true;
		try {
			await api.pCreateCharacter({
				clientImportId: character.id,
				campaignId,
				data: character,
				rulesVersionId: context.rulesVersion?.id || null,
				idempotencyKey: crypto.randomUUID(),
			});
			const charactersNxt = await api.pListCharacters({campaignId});
			renderCharacterList({
				campaignId,
				characters: charactersNxt,
				session,
				isDm: ["dm", "co_dm"].includes(campaign.role),
			});
			applyCampaignRoleLayout({campaign, characters: charactersNxt});
			setHidden(uploadControls, true);
			if (uploadStatus) uploadStatus.textContent = `${character.name || "Character"} was added as a cloud copy. The local original is unchanged.`;
		} catch (error) {
			renderError(error);
		} finally {
			if (!isCampaignReloadRequired) uploadConfirm.disabled = false;
		}
	});

	const dmControls = document.getElementById("campaign-dm-controls");
	setHidden(dmControls, !isDm);
	const dmScreenLink = document.getElementById("campaign-open-dm-screen");
	if (dmScreenLink) dmScreenLink.href = `dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`;
	let partyInventory = await api.pGetPartyInventory({campaignId});
	const itemAward = await pInitItemAwardComposer({context, partyInventory, targetCharacters, events});
	const transferRefreshQueue = new HubTransferRefreshQueue();
	const pRefreshTransferState = (
		refresh = {},
		fnIsCurrentAtAdmission = refresh.fnIsCurrent || captureProjectionAuthorization(),
	) => transferRefreshQueue.pRun(async () => {
		let {
			charactersNxt = null,
			targetCharactersNxt = null,
			snapshotNxt = null,
			membersNxt = null,
			partyInventoryNxt = null,
			eventsNxt = null,
			fnIsSnapshotCurrent = () => true,
			isProjectionControlRestoreDeferred = false,
		} = refresh;
		const fnIsCurrent = fnIsCurrentAtAdmission;
		[charactersNxt, targetCharactersNxt, snapshotNxt, membersNxt, partyInventoryNxt, eventsNxt] = await Promise.all([
			charactersNxt,
			targetCharactersNxt,
			snapshotNxt,
			membersNxt,
			partyInventoryNxt,
			eventsNxt,
		]);
		const source = document.getElementById("campaign-transfer-source");
		const target = document.getElementById("campaign-transfer-target");
		const item = document.getElementById("campaign-transfer-entry");
		const form = document.getElementById("campaign-transfer-form");
		const readSelections = () => ({
			source: source?.value,
			target: target?.value,
			item: item?.value,
			quantity: document.getElementById("campaign-transfer-quantity")?.value,
			currency: Object.fromEntries(CURRENCY_TYPES.map(type => [
				type,
				document.getElementById(`campaign-transfer-${type}`)?.value || "",
			])),
		});
		const concealedSelections = form?._hubProjectionTransferDraft || null;
		const selections = concealedSelections || readSelections();
		const [charactersLatest, snapshotLatest, partyInventoryLatest] = await Promise.all([
			charactersNxt ? null : api.pListCharacters({campaignId}),
			targetCharactersNxt || snapshotNxt ? null : api.pGetCampaignSnapshot({campaignId}),
			partyInventoryNxt ? null : api.pGetPartyInventory({campaignId}),
		]);
		if (!fnIsCurrent()) return {pendingTransferIds: [], isFenced: true};
		if (snapshotNxt && !fnIsSnapshotCurrent(snapshotNxt)) return {pendingTransferIds: [], isFenced: true};
		if (!isProjectionControlRestoreDeferred) {
			setProjectionFormControlsConcealed({form, isConcealed: false});
		}
		const acceptedSnapshot = snapshotNxt && fnIsSnapshotCurrent(snapshotNxt)
			? snapshotNxt
			: snapshotLatest;
		const latestSelections = readSelections();
		const selectionsToRestore = concealedSelections || (
			JSON.stringify(latestSelections) !== JSON.stringify(selections)
				? latestSelections
				: selections
		);
		characters.splice(0, characters.length, ...(charactersNxt || charactersLatest));
		const targetCharactersReplacement = targetCharactersNxt || acceptedSnapshot?.characters;
		if (targetCharactersReplacement) targetCharacters.splice(0, targetCharacters.length, ...targetCharactersReplacement);
		if (acceptedSnapshot?.roster) rosterRef.current = acceptedSnapshot.roster;
		if (membersNxt) members.splice(0, members.length, ...membersNxt);
		partyInventory = partyInventoryNxt || partyInventoryLatest;
		if (eventsNxt) itemAward.setEvents(eventsNxt);
		itemAward.setTargets(targetCharacters);
		itemAward.setPartyInventory(partyInventory);

		fillCharacterSelect(source, characters, {
			includeParty: isDm,
			partyInventory,
			ownerAccountId: session.account.id,
		});
		// A character whose identity the owner hid is absent from roster metadata and is
		// therefore not peer-targetable.
		fillCharacterSelect(target, getTargetableProjections({projections: targetCharacters, roster: rosterRef.current}), {includeParty: true, partyInventory});
		if (!isProjectionControlRestoreDeferred) {
			if (source) source.disabled = !source.options.length;
			if (target) target.disabled = !target.options.length;
		}
		const isSourceRestored = [...source.options].some(option => option.value === selectionsToRestore.source);
		const isTargetRestored = [...target.options].some(option => option.value === selectionsToRestore.target);
		if (isSourceRestored) source.value = selectionsToRestore.source;
		if (isTargetRestored) target.value = selectionsToRestore.target;
		syncTransferItemPicker({characters, partyInventory});
		if (
			isSourceRestored
			&& isTargetRestored
			&& [...item.options].some(option => option.value === selectionsToRestore.item)
		) {
			item.value = selectionsToRestore.item;
			syncTransferQuantity();
			const maximum = Number(item.selectedOptions[0]?.dataset.quantity);
			if (Number(selectionsToRestore.quantity) > 0 && Number(selectionsToRestore.quantity) <= maximum) {
				document.getElementById("campaign-transfer-quantity").value = selectionsToRestore.quantity;
			}
		}
		for (const type of CURRENCY_TYPES) {
			const input = document.getElementById(`campaign-transfer-${type}`);
			if (!input) continue;
			input.value = isSourceRestored && isTargetRestored
				? selectionsToRestore.currency?.[type] || "0"
				: "0";
		}
		if (isProjectionControlRestoreDeferred) {
			setProjectionFormControlsConcealed({form, isConcealed: true});
			setProjectionFormControlsConcealed({
				form: document.getElementById("campaign-item-form"),
				isConcealed: true,
			});
		}
		renderPartyInventoryStatus(partyInventory);
		const transferState = await renderPendingTransfers({
			campaign,
			campaignId,
			session,
			targetCharacters,
			members,
			pRefreshTransferState,
			fnIsCurrent,
		});
		if (!fnIsCurrent() || transferState.isFenced) return {pendingTransferIds: [], isFenced: true};
		const pendingProposal = transferProposalDrafts.get({accountId: session.account.id, campaignId});
		const restoreTransferControlState = () => {
			if (!fnIsCurrent()) return false;
			if (pendingProposal) {
				setTransferProposalControls({
					form,
					proposalRequest: pendingProposal,
					characters,
					partyInventory,
					isLocked: true,
				});
				const submit = form?.querySelector("button[type='submit']");
				if (submit && !isCampaignReloadRequired) {
					submit.disabled = false;
					submit.textContent = "Retry transfer";
				}
				delete form?._hubProjectionTransferDraft;
				return true;
			}
			setTransferProposalControls({form, isLocked: false});
			if (source) source.disabled = !source.options.length;
			if (target) target.disabled = !target.options.length;
			const submit = form?.querySelector("button[type='submit']");
			if (submit && !isCampaignReloadRequired) {
				submit.disabled = !source?.options.length;
				submit.textContent = "Submit transfer";
			}
			delete form?._hubProjectionTransferDraft;
			return true;
		};
		if (!isProjectionControlRestoreDeferred) {
			restoreTransferControlState();
		}
		if (isProjectionControlRestoreDeferred) {
			setProjectionFormControlsConcealed({form, isConcealed: true});
		}
		return {
			...transferState,
			restoreTransferControlState,
		};
	});

	await renderPendingActions({
		campaign,
		campaignId,
		session,
		targetCharacters,
		members,
		roster: rosterRef.current,
		fnIsCurrent: captureProjectionAuthorization(),
	});
	await pRefreshTransferState({
		charactersNxt: characters,
		targetCharactersNxt: targetCharacters,
		membersNxt: members,
		partyInventoryNxt: partyInventory,
	});

	fillCharacterSelect(document.getElementById("campaign-action-target"), getTargetableProjections({projections: targetCharacters, roster: rosterRef.current}));
	fillCharacterSelect(document.getElementById("campaign-xp-target"), characters);
	document.getElementById("campaign-transfer-source")?.addEventListener("change", () => syncTransferItemPicker({characters, partyInventory}));
	document.getElementById("campaign-transfer-entry")?.addEventListener("change", syncTransferQuantity);
	setFormAvailability({
		formId: "campaign-action-form",
		isAvailable: !!document.getElementById("campaign-action-target")?.options.length,
		message: "Add a campaign character before proposing an effect.",
	});
	setFormAvailability({
		formId: "campaign-transfer-form",
		isAvailable: !!document.getElementById("campaign-transfer-source")?.options.length,
		message: "Add one of your characters before starting a transfer.",
	});
	const pendingTransferProposal = transferProposalDrafts.get({accountId: session.account.id, campaignId});
	if (pendingTransferProposal) {
		const form = document.getElementById("campaign-transfer-form");
		if (!transferProposalDrafts.isReplayable(pendingTransferProposal)) {
			setTransferProposalReplayExpired({
				form,
				proposalRef: {accountId: session.account.id, campaignId},
				proposalRequest: pendingTransferProposal,
				pRefresh: pRefreshTransferState,
			});
		} else {
			setTransferProposalControls({
				form,
				proposalRequest: pendingTransferProposal,
				characters,
				partyInventory,
				isLocked: true,
			});
			const submit = form?.querySelector("button[type='submit']");
			if (submit) {
				submit.disabled = false;
				submit.textContent = "Retry transfer";
			}
			setFormStatus({
				formId: "campaign-transfer-form",
				message: "The previous transfer outcome is not yet confirmed. Retry to reconcile the same transfer.",
				isError: true,
			});
		}
	}
	setFormAvailability({
		formId: "campaign-xp-form",
		isAvailable: !!characters.length,
		message: "Add a campaign character before using this grant.",
	});
	setFormAvailability({
		formId: "campaign-item-form",
		isAvailable: !!targetCharacters.length,
		message: "Add an eligible campaign character before awarding an item.",
	});

	const actionType = document.getElementById("campaign-action-type");
	const actionValue = document.getElementById("campaign-action-value");
	const actionValueLabel = document.getElementById("campaign-action-value-label");
	const actionConditionField = document.getElementById("campaign-action-condition-field");
	const actionCondition = document.getElementById("campaign-action-condition");
	const actionSlotFields = document.getElementById("campaign-action-slot-fields");
	const conditionCatalogByUid = new Map();
	let conditionCatalogModule = null;
	let conditionCatalogState = "idle";
	let conditionCatalogGeneration = 0;
	let conditionCatalogModuleAttemptIndex = 0;
	let campaignConditionBrewContent = context.brewBundle?.content;
	let activeConditionCatalog = [];
	const getCurrentTargetConditions = () => {
		if (actionType.value !== "condition_remove") return [];
		const targetId = document.getElementById("campaign-action-target")?.value?.split(":")[1];
		if (!targetId) return [];
		const target = getCharacterById(targetCharacters, targetId);
		if (!isCanonicalProjection(target)) return [];
		const conditions = getCanonicalCharacter(target)?.data?.conditions;
		return Array.isArray(conditions) ? conditions : [];
	};
	const pRefreshConditionOptions = () => {
		const previousValue = actionCondition.value;
		conditionCatalogByUid.clear();
		if (conditionCatalogState !== "ready" || !conditionCatalogModule) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = ["module_failed", "module_exhausted", "data_failed"].includes(conditionCatalogState)
				? "Condition catalog unavailable"
				: "Loading conditions...";
			actionCondition.replaceChildren(option);
			return;
		}
		const conditions = conditionCatalogModule.getCampaignConditionCatalog({
			siteData: {condition: activeConditionCatalog},
			additionalConditions: getCurrentTargetConditions(),
		});
		actionCondition.replaceChildren(...conditions.map(condition => {
			const option = document.createElement("option");
			option.value = conditionCatalogModule.getCampaignConditionUid(condition);
			option.textContent = `${condition.name} (${condition.source})`;
			conditionCatalogByUid.set(option.value, condition);
			return option;
		}));
		if (conditionCatalogByUid.has(previousValue)) actionCondition.value = previousValue;
	};
	const syncActionFields = ({isRetryConditionCatalog = true} = {}) => {
		const type = actionType.value;
		const isSlot = ["spell_slot_spend", "spell_slot_restore"].includes(type);
		const isCondition = ["condition_add", "condition_remove"].includes(type);
		setHidden(actionSlotFields, !isSlot);
		setHidden(actionConditionField, !isCondition);
		setHidden(actionValueLabel, isSlot || isCondition);
		setHidden(actionValue, isSlot || isCondition);
		if (isCondition) {
			pRefreshConditionOptions();
			if (isRetryConditionCatalog && ["idle", "module_failed", "data_failed"].includes(conditionCatalogState)) {
				void pRefreshConditionCatalog({
					campaignBrewContent: campaignConditionBrewContent,
				});
			}
		}
		actionCondition.disabled = !isCondition || !conditionCatalogByUid.size;
		actionValue.disabled = isSlot || isCondition;
		actionValue.required = !isSlot && !isCondition;
		if (isSlot || isCondition) return;
		const configuration = {
			damage: {label: "Damage amount", type: "number", placeholder: "1"},
			healing: {label: "Healing amount", type: "number", placeholder: "1"},
		}[type];
		actionValueLabel.textContent = configuration.label;
		actionValue.type = configuration.type;
		actionValue.inputMode = configuration.type === "number" ? "numeric" : "text";
		actionValue.placeholder = configuration.placeholder;
		actionValue.min = configuration.type === "number" ? "1" : "";
	};
	const pRefreshConditionCatalog = async ({campaignBrewContent}) => {
		const generation = ++conditionCatalogGeneration;
		campaignConditionBrewContent = campaignBrewContent;
		conditionCatalogState = conditionCatalogModule ? "loading_data" : "loading_module";
		pRefreshConditionOptions();
		actionCondition.disabled = true;
		let module = conditionCatalogModule;
		if (!module) {
			const conditionCatalogModuleUrl = CONDITION_CATALOG_MODULE_URLS[conditionCatalogModuleAttemptIndex++];
			if (!conditionCatalogModuleUrl) {
				conditionCatalogState = "module_exhausted";
				pRefreshConditionOptions();
				setFormStatus({
					formId: "campaign-action-form",
					message: "Condition options are unavailable until this page is reloaded.",
					isError: true,
				});
				actionCondition.disabled = true;
				return false;
			}
			try {
				conditionCatalogModule = await import(conditionCatalogModuleUrl);
				module = conditionCatalogModule;
			} catch (error) {
				if (generation !== conditionCatalogGeneration) return false;
				activeConditionCatalog = [];
				conditionCatalogState = conditionCatalogModuleAttemptIndex < CONDITION_CATALOG_MODULE_URLS.length
					? "module_failed"
					: "module_exhausted";
				pRefreshConditionOptions();
				setFormStatus({
					formId: "campaign-action-form",
					message: conditionCatalogState === "module_exhausted"
						? "Condition options are unavailable until this page is reloaded."
						: getErrorMessage(error),
					isError: true,
				});
				actionCondition.disabled = true;
				return false;
			}
			if (generation !== conditionCatalogGeneration) return false;
		}
		conditionCatalogState = "loading_data";
		try {
			const catalog = await module.pLoadCampaignConditionCatalog({campaignBrewContent});
			if (generation !== conditionCatalogGeneration) return false;
			activeConditionCatalog = catalog;
			conditionCatalogState = "ready";
			setFormStatus({formId: "campaign-action-form"});
			syncActionFields();
			return true;
		} catch (error) {
			if (generation !== conditionCatalogGeneration) return false;
			activeConditionCatalog = [];
			conditionCatalogState = "data_failed";
			pRefreshConditionOptions();
			setFormStatus({
				formId: "campaign-action-form",
				message: getErrorMessage(error),
				isError: true,
			});
			actionCondition.disabled = true;
			return false;
		}
	};
	actionType?.addEventListener("change", syncActionFields);
	document.getElementById("campaign-action-target")?.addEventListener("change", syncActionFields);
	syncActionFields();
	const pRefreshContextBoundControls = async ({context: contextNxt}) => {
		campaignConditionBrewContent = contextNxt.brewBundle?.content;
		itemAward.setCampaignBrewContent(campaignConditionBrewContent);
		if (conditionCatalogState === "idle") return true;
		if (conditionCatalogState === "module_exhausted") return false;
		return pRefreshConditionCatalog({campaignBrewContent: campaignConditionBrewContent});
	};

	document.getElementById("campaign-action-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const fnIsCurrent = captureProjectionAuthorization();
		const formId = "campaign-action-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fingerprint: getFormFingerprint(event.currentTarget),
				fnMutate: async idempotencyKey => {
					const type = document.getElementById("campaign-action-type").value;
					const targetCharacterId = document.getElementById("campaign-action-target").value.split(":")[1];
					if (!targetCharacterId) throw new Error("Choose a target character.");
					const rawValue = document.getElementById("campaign-action-value").value.trim();
					if (["damage", "healing"].includes(type) && !(Number(rawValue) > 0)) {
						throw new Error("Enter a positive amount.");
					}
					const condition = conditionCatalogByUid.get(actionCondition.value) || null;
					if (["condition_add", "condition_remove"].includes(type) && !condition) throw new Error("Choose a condition.");
					const slotLevel = Number(document.getElementById("campaign-action-slot-level").value);
					const slotAmount = Number(document.getElementById("campaign-action-slot-amount").value);
					if (["spell_slot_spend", "spell_slot_restore"].includes(type) && (!Number.isInteger(slotLevel) || slotLevel < 1 || slotLevel > 9)) {
						throw new Error("Choose a spell-slot level from 1 to 9.");
					}
					if (["spell_slot_spend", "spell_slot_restore"].includes(type) && (!Number.isInteger(slotAmount) || slotAmount < 1)) {
						throw new Error("Enter a whole number of spell slots of at least 1.");
					}
					const operation = ["spell_slot_spend", "spell_slot_restore"].includes(type)
						? {
							kind: type === "spell_slot_spend" ? "spell_slot.spend" : "spell_slot.restore",
							version: 1,
							arguments: {level: slotLevel, amount: slotAmount},
						}
						: ["damage", "healing"].includes(type)
							? {
								kind: type === "damage" ? "hp.damage" : "hp.heal",
								version: 1,
								arguments: {amount: Number(rawValue)},
							}
							: ["condition_add", "condition_remove"].includes(type)
								? {
									kind: type === "condition_add" ? "condition.add" : "condition.remove",
									version: 1,
									arguments: {condition},
								}
								: null;
					await api.pCreateStructuredAction({
						campaignId,
						targetCharacterId,
						operation,
						idempotencyKey,
					});
					if (!fnIsCurrent()) {
						deferMutationUi({
							form: event.currentTarget,
							fnApply: () => {
								document.getElementById("campaign-action-value").value = "";
								setFormStatus({formId, message: "Effect applied."});
							},
						});
						return;
					}
					await renderPendingActions({
						campaign,
						campaignId,
						session,
						targetCharacters,
						members,
						roster: rosterRef.current,
						fnIsCurrent,
					});
					if (!fnIsCurrent()) return;
					document.getElementById("campaign-action-value").value = "";
					setFormStatus({formId, message: "Effect applied."});
				}});
		} catch (error) {
			if (!fnIsCurrent()) return;
			const message = error instanceof HubApiError ? getErrorMessage(error) : error.message;
			setFormStatus({formId, message, isError: true});
			if (error instanceof HubApiError) renderError(error);
		}
	});

	document.getElementById("campaign-xp-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const fnIsCurrent = captureProjectionAuthorization();
		const formId = "campaign-xp-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fingerprint: getFormFingerprint(event.currentTarget),
				fnMutate: async idempotencyKey => {
					await api.pGrantXp({
						campaignId,
						characterId: document.getElementById("campaign-xp-target").value.split(":")[1],
						amount: Number(document.getElementById("campaign-xp-amount").value),
						reason: document.getElementById("campaign-xp-reason").value || null,
						idempotencyKey,
					});
				}});
			if (!fnIsCurrent()) {
				deferMutationUi({
					form: event.currentTarget,
					fnApply: () => {
						setFormStatus({formId, message: "XP granted."});
						document.getElementById("campaign-xp-amount").value = "";
						document.getElementById("campaign-xp-reason").value = "";
					},
				});
				return;
			}
			setFormStatus({formId, message: "XP granted."});
			document.getElementById("campaign-xp-amount").value = "";
			document.getElementById("campaign-xp-reason").value = "";
		} catch (error) {
			if (!fnIsCurrent()) return;
			setFormStatus({formId, message: getErrorMessage(error), isError: true});
			if (error instanceof HubApiError) renderError(error);
		}
	});

	document.getElementById("campaign-item-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const fnIsCurrent = captureProjectionAuthorization();
		const formId = "campaign-item-form";
		setFormStatus({formId});
		renderError(null);
		let isAwardComplete = false;
		try {
			const submission = itemAward.getSubmission();
			let result;
			await pRunFormMutation({
				form: event.currentTarget,
				fingerprint: getAwardCommandFingerprint(submission),
				fnMutate: async idempotencyKey => {
					itemAward.setPending(true);
					result = await api.pAwardItems({
						campaignId,
						...submission,
						rulesVersionId: context.rulesVersion?.id || null,
						idempotencyKey,
					});
				},
			});
			if (!result) return;
			const applyAwardSuccessUi = () => {
				itemAward.onSuccess(result);
				setFormStatus({
					formId,
					message: `${submission.quantity} × ${result.source.item.name} awarded to ${result.targets.length} character${result.targets.length === 1 ? "" : "s"}.`,
				});
			};
			const deferAwardCompletionUi = ({isApplySuccessUi = false} = {}) => {
				deferMutationUi({
					form: event.currentTarget,
					fnApply: () => {
						itemAward.setPending(false);
						if (isApplySuccessUi) applyAwardSuccessUi();
						itemAward.focusPrimary();
					},
				});
			};
			if (!fnIsCurrent()) {
				deferAwardCompletionUi({isApplySuccessUi: true});
				return;
			}
			applyAwardSuccessUi();
			isAwardComplete = true;
			try {
				const refreshResult = await pRefreshTransferState({fnIsCurrent});
				if (!fnIsCurrent() || refreshResult?.isFenced) {
					isAwardComplete = false;
					deferAwardCompletionUi();
				}
			} catch {
				if (!fnIsCurrent()) {
					isAwardComplete = false;
					deferAwardCompletionUi();
					return;
				}
				setFormStatus({
					formId,
					message: "Items awarded, but the latest campaign balances could not be loaded. Reload before awarding from the party stash again.",
					isError: true,
				});
			}
		} catch (error) {
			if (!fnIsCurrent()) return;
			const message = error instanceof HubApiError ? getErrorMessage(error) : error.message;
			setFormStatus({formId, message, isError: true});
			if (error instanceof HubApiError) renderError(error);
		} finally {
			itemAward.setPending(false);
			if (isAwardComplete) itemAward.focusPrimary();
		}
	});

	document.getElementById("campaign-transfer-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const fnIsCurrent = captureProjectionAuthorization();
		const form = event.currentTarget;
		const formId = "campaign-transfer-form";
		setFormStatus({formId});
		try {
			const result = await pRunFormMutation({form,
				fingerprint: getFormFingerprint(form),
				fnMutate: async idempotencyKey => {
					const proposalRef = {accountId: session.account.id, campaignId};
					const pResolveAutoTransfer = transfer => pResolveTransferFromDraft({
						drafts: transferResolutionDrafts,
						campaignId,
						transferId: transfer.id,
						pGetRulesVersionId: async () => {
							const contextCurrent = await api.pGetCampaignContext({campaignId});
							if (!fnIsCurrent()) throw new HubApiError({code: "REQUEST_ABORTED", status: 0});
							return contextCurrent.rulesVersion?.id || null;
						},
						pResolve: request => api.pResolveTransfer(request),
					});
					let proposalRequest = transferProposalDrafts.get(proposalRef);
					if (proposalRequest) {
						if (!transferProposalDrafts.isReplayable(proposalRequest)) {
							throw new HubApiError({code: "IDEMPOTENCY_WINDOW_EXPIRED", status: 0});
						}
						let proposed;
						try {
							proposed = await api.pProposeTransfer(proposalRequest);
							if (!fnIsCurrent()) return null;
						} catch (error) {
							if (!isTransferOutcomeUncertain(error)) {
								transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
							}
							throw error;
						}
						const transfers = await api.pListTransfers({campaignId});
						if (!fnIsCurrent()) return null;
						const currentTransfer = transfers.find(it => it.id === proposed.transfer.id);
						if (!currentTransfer) throw new HubApiError({code: "TRANSFER_NOT_FOUND", status: 404});
						proposed = {...proposed, transfer: currentTransfer};
						if (!["proposed", "reserved", "committed"].includes(proposed.transfer.status)) {
							transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
							return {transfer: proposed.transfer, isAutoResolved: proposalRequest.isAutoResolved, targetKind: proposalRequest.targetKind};
						}
						if (proposed.transfer.status === "committed") {
							transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
							return {transfer: proposed.transfer, isAutoResolved: true, targetKind: proposalRequest.targetKind};
						}
						const isAutoResolved = proposalRequest.isAutoResolved;
						if (!isAutoResolved) {
							transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
							return {transfer: proposed.transfer, isAutoResolved: false, targetKind: proposalRequest.targetKind};
						}
						let resolved;
						try {
							resolved = await pResolveAutoTransfer(proposed.transfer);
							if (!fnIsCurrent()) return null;
						} catch (error) {
							if (!isTransferOutcomeUncertain(error) && error?.code !== "RULES_VERSION_STALE") {
								transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
							}
							throw error;
						}
						transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
						return {transfer: resolved.transfer, isAutoResolved: true, targetKind: proposalRequest.targetKind};
					}
					const [sourceKind, sourceId] = document.getElementById("campaign-transfer-source").value.split(":");
					const [targetKind, targetId] = document.getElementById("campaign-transfer-target").value.split(":");
					if (sourceKind === targetKind && sourceId === targetId) throw new Error("Choose a different recipient.");
					const itemSelect = document.getElementById("campaign-transfer-entry");
					const entryId = itemSelect.value;
					const quantity = entryId ? Number(document.getElementById("campaign-transfer-quantity").value) : 0;
					if (entryId && (!Number.isInteger(quantity) || quantity < 1)) throw new Error("Enter a whole item quantity of at least 1.");
					const availableQuantity = Number(itemSelect.selectedOptions[0]?.dataset.quantity);
					if (entryId && quantity > availableQuantity) throw new Error(`Only ${availableQuantity} of that item is available.`);
					const currency = Object.fromEntries(CURRENCY_TYPES.map(type => [
						type,
						Number(document.getElementById(`campaign-transfer-${type}`).value) || 0,
					]));
					if (Object.values(currency).some(amount => !Number.isInteger(amount) || amount < 0)) {
						throw new Error("Currency amounts must be whole numbers of at least 0.");
					}
					const sourceContainer = getTransferContainer({
						value: document.getElementById("campaign-transfer-source").value,
						characters,
						partyInventory,
					});
					const insufficientType = CURRENCY_TYPES.find(type => currency[type] > (Number(sourceContainer?.currency?.[type]) || 0));
					if (insufficientType) throw new Error(`Only ${sourceContainer?.currency?.[insufficientType] || 0} ${insufficientType.toUpperCase()} is available.`);
					if (!entryId && !Object.values(currency).some(Boolean)) throw new Error("Choose an item or enter a currency amount.");
					const isAutoResolved = shouldAutoResolveTransfer({
						isDm,
						sourceKind,
						targetKind,
						targetId,
						targetCharacters,
						accountId: session.account.id,
					});
					const currentContext = isAutoResolved && targetKind === "character"
						? await api.pGetCampaignContext({campaignId})
						: null;
					if (!fnIsCurrent()) return null;
					proposalRequest = transferProposalDrafts.stage({
						...proposalRef,
						request: {
							campaignId,
							sourceKind,
							sourceId,
							targetKind,
							targetId,
							payload: {
								items: entryId && quantity ? [{entryId, quantity}] : [],
								currency,
							},
							...(isAutoResolved && targetKind === "character"
								? {rulesVersionId: currentContext?.rulesVersion?.id || null}
								: {}),
							idempotencyKey,
							isAutoResolved,
						},
					});
					let proposed;
					try {
						proposed = await api.pProposeTransfer(proposalRequest);
						if (!fnIsCurrent()) return null;
					} catch (error) {
						if (!isTransferOutcomeUncertain(error)) {
							transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
						}
						throw error;
					}
					if (!isAutoResolved) {
						transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
						return {transfer: proposed.transfer, isAutoResolved: false, targetKind};
					}
					if (proposed.transfer.status === "committed") {
						transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
						return {transfer: proposed.transfer, isAutoResolved: true, targetKind};
					}
					let resolved;
					try {
						resolved = await pResolveAutoTransfer(proposed.transfer);
						if (!fnIsCurrent()) return null;
					} catch (error) {
						if (!isTransferOutcomeUncertain(error) && error?.code !== "RULES_VERSION_STALE") {
							transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
						}
						throw error;
					}
					transferProposalDrafts.clear({...proposalRef, idempotencyKey: proposalRequest.idempotencyKey});
					return {transfer: resolved.transfer, isAutoResolved: true, targetKind};
				}});
			if (!result) return;
			const terminalMessages = {
				rejected: "Transfer declined. The authoritative inventories are unchanged.",
				cancelled: "Transfer cancelled. The authoritative inventories are up to date.",
				expired: "Transfer expired. Any reserved assets were restored.",
			};
			const successMessage = result.transfer.status === "committed"
				? "Transfer complete. The authoritative inventories are updated."
				: terminalMessages[result.transfer.status]
					|| (result.transfer.status === "proposed"
						? "Request sent. A DM must approve before anything leaves the party inventory."
						: result.targetKind === "party_inventory"
							? "Transfer reserved. A DM can accept it from the inbox."
							: "Transfer reserved. The recipient can accept it from the inbox.");
			const applyTransferSuccessUi = () => {
				setTransferProposalControls({form, isLocked: false});
				for (const type of CURRENCY_TYPES) document.getElementById(`campaign-transfer-${type}`).value = "0";
				setFormStatus({formId, message: successMessage});
			};
			if (!fnIsCurrent()) {
				deferMutationUi({form, fnApply: applyTransferSuccessUi});
				return;
			}
			applyTransferSuccessUi();
			try {
				await pRefreshTransferState({fnIsCurrent});
			} catch {
				setTransferRefreshFailure({
					form,
					message: `${successMessage} The latest balances could not be loaded.`,
					pRetry: refresh => pRefreshTransferState({...refresh, fnIsCurrent: captureProjectionAuthorization()}),
				});
			}
		} catch (error) {
			if (!fnIsCurrent()) return;
			const message = error instanceof HubApiError ? getErrorMessage(error) : error.message;
			const pendingProposal = transferProposalDrafts.get({accountId: session.account.id, campaignId});
			const isRulesVersionStale = error instanceof HubApiError && error.code === "RULES_VERSION_STALE";
			const isDefinitiveWithoutPending = error instanceof HubApiError
				&& !isTransferOutcomeUncertain(error)
				&& !pendingProposal;
			if (isDefinitiveWithoutPending) {
				form._hubMutationKey = null;
				form._hubMutationFingerprint = null;
				setTransferProposalControls({form, isLocked: false});
				try {
					const refreshResult = await pRefreshTransferState({fnIsCurrent});
					if (!fnIsCurrent() || refreshResult?.isFenced) return;
				} catch {
					if (!fnIsCurrent()) return;
					setTransferRefreshFailure({
						form,
						message: `${message} The latest balances could not be loaded.`,
						pRetry: refresh => pRefreshTransferState({...refresh, fnIsCurrent: captureProjectionAuthorization()}),
					});
					renderError(error);
					return;
				}
			}
			if (pendingProposal && !transferProposalDrafts.isReplayable(pendingProposal)) {
				setTransferProposalReplayExpired({
					form,
					proposalRef: {accountId: session.account.id, campaignId},
					proposalRequest: pendingProposal,
					pRefresh: refresh => pRefreshTransferState({...refresh, fnIsCurrent: captureProjectionAuthorization()}),
				});
				if (error instanceof HubApiError && error.code !== "IDEMPOTENCY_WINDOW_EXPIRED") renderError(error);
				return;
			}
			setFormStatus({
				formId,
				message: pendingProposal
					? isRulesVersionStale
						? "Campaign rules changed before acceptance. Retry to reconcile the reserved transfer under the active version."
						: "The transfer outcome is not yet confirmed. Retry to reconcile the same transfer."
					: message,
				isError: true,
			});
			if (pendingProposal) {
				setTransferProposalControls({
					form,
					proposalRequest: pendingProposal,
					characters,
					partyInventory,
					isLocked: true,
				});
				const submit = form.querySelector("button[type='submit']");
				if (submit) submit.textContent = "Retry transfer";
			}
			if (error instanceof HubApiError) renderError(error);
		}
	});
	setHidden(document.getElementById("campaign-dm-grants"), !isDm);

	document.getElementById("campaign-brew-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		setFormStatus({formId: "campaign-brew-form"});
		const file = document.getElementById("campaign-brew-file").files?.[0];
		if (!file) {
			setFormStatus({formId: "campaign-brew-form", message: "Choose a homebrew JSON file before publishing.", isError: true});
			return;
		}
		try {
			await pRunFormMutation({form: event.currentTarget,
				fingerprint: getFormFingerprint(event.currentTarget),
				fnMutate: async idempotencyKey => {
					const parsed = JSON.parse(await file.text());
					const brewDocs = Array.isArray(parsed)
						? parsed
						: parsed.head && parsed.body
							? [parsed]
							: [{head: {filename: file.name}, body: parsed}];
					const created = await api.pCreateBrewBundleVersion({
						campaignId,
						brewDocs,
						idempotencyKey,
					});
					await api.pActivateBrewBundleVersion({
						campaignId,
						versionId: created.brewBundle.id,
						idempotencyKey: `${idempotencyKey}:activate`,
					});
					const contextNxt = await api.pGetCampaignContext({campaignId});
					renderCampaignContext(contextNxt);
					await pRefreshContextBoundControls({context: contextNxt});
					setFormStatus({formId: "campaign-brew-form", message: "Campaign homebrew published."});
				}});
		} catch (error) {
			const message = error instanceof SyntaxError ? "The selected file is not valid JSON." : getErrorMessage(error);
			setFormStatus({formId: "campaign-brew-form", message, isError: true});
			renderError(error instanceof SyntaxError ? message : error);
		}
	});

	document.getElementById("campaign-rules-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		renderError("");
		setFormStatus({formId: "campaign-rules-form"});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fingerprint: getFormFingerprint(event.currentTarget),
				fnMutate: async idempotencyKey => {
					const rules = {
						enableTgtt: document.getElementById("campaign-rule-tgtt").checked,
						exhaustionRules: document.getElementById("campaign-rule-exhaustion").value,
						thelemar_carryWeight: document.getElementById("campaign-rule-carry").checked,
						thelemar_encumbranceTiers: document.getElementById("campaign-rule-encumbrance-tiers").checked,
						thelemar_jumping: document.getElementById("campaign-rule-jumping").checked,
						thelemar_linguisticsBonus: document.getElementById("campaign-rule-linguistics").checked,
						thelemar_criticalRolls: document.getElementById("campaign-rule-critical").checked,
					};
					const created = await api.pCreateRulesVersion({
						campaignId,
						rules,
						idempotencyKey,
					});
					await api.pActivateRulesVersion({
						campaignId,
						versionId: created.rulesVersion.id,
						idempotencyKey: `${idempotencyKey}:activate`,
					});
					renderCampaignContext(await api.pGetCampaignContext({campaignId}));
					setFormStatus({formId: "campaign-rules-form", message: "Campaign rules published."});
				}});
		} catch (error) {
			const message = getErrorMessage(error);
			setFormStatus({formId: "campaign-rules-form", message, isError: true});
			renderError(error);
		}
	});

	return {
		pRefreshTransferState,
		rulesPolicyManagerPromise,
		refreshActionFields: syncActionFields,
		refreshItemAwardControlState: () => itemAward.setTargets(targetCharacters),
		pRefreshContextBoundControls,
		flushDeferredMutationUi,
		isConditionCatalogRetryNeeded: () => conditionCatalogState === "data_failed"
			|| (
				conditionCatalogState === "module_failed"
				&& conditionCatalogModuleAttemptIndex < CONDITION_CATALOG_MODULE_URLS.length
			),
	};
}

async function pInit () {
	initCampaignNetworkAwareness();
	const inviteFragment = new URLSearchParams(window.location.hash.slice(1)).get("invite");
	if (inviteFragment) {
		sessionStorage.setItem("hub-pending-invite", inviteFragment);
		window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
	}
	const signedOut = document.getElementById("hub-signed-out");
	const signedIn = document.getElementById("hub-signed-in");
	const loading = document.getElementById("hub-loading");
	try {
		const session = await api.pGetSession();
		setHidden(loading, true);
		if (!session.signedIn) {
			// A signed-out session writes a clear tombstone for the stored record's account, so no
			// campaign context stays active in this browser.
			await activeCampaign.pResolve({trigger: "logout", session});
			await pRenderActiveCampaignSwitcher();
			const signIn = document.getElementById("hub-sign-in");
			const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
			const {pRenderHubAuthProviders} = await import("./hub-auth-providers.js");
			await pRenderHubAuthProviders({signIn, returnTo});
			setHidden(signedOut, false);
			return;
		}
		setHidden(signedIn, false);
		document.getElementById("hub-logout")?.addEventListener("click", async () => {
			try {
				// Clear the local selection first: a failed logout request must not leave campaign
				// context active in this browser.
				await activeCampaign.pClearSelection({trigger: "logout"});
				await api.pLogout();
				window.location.assign("hub.html");
			} catch (error) {
				renderError(error);
			}
		});
		const view = document.body.dataset.hubView;
		if (session.account.status === "deletion_requested" && view === "campaign") {
			window.location.assign("hub.html");
			return;
		}
		if (view === "campaign") await pInitCampaign({session});
		else await pInitHubIndex({session});
	} catch (error) {
		setHidden(loading, true);
		setCampaignConnectionStatus({
			label: error instanceof HubApiError && error.code === "NETWORK_UNAVAILABLE"
				? "Offline · campaign unavailable"
				: "Campaign unavailable",
			state: "error",
		});
		renderError(error);
		if (error instanceof HubApiError && error.code === "AUTH_REQUIRED") setHidden(signedOut, false);
	}
}

void pInit();
