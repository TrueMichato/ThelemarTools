import {HubApiClient, HubApiError} from "./hub-api-client.js";
import {HubActiveCampaignCoordinator} from "./hub-active-campaign-coordinator.js";
import {HubRealtimeClient} from "./hub-realtime-client.js";
import {renderHubActivityRows} from "./hub-activity-render.js";
import {
	getOwnerMembershipId,
	getProjectionId,
	getProjectionOwnerAccountId,
	getProjectionName,
	getProjectionSummary,
	getTargetableProjections,
	isCanonicalProjection,
} from "./hub-character-view.js";

const api = new HubApiClient();

/**
 * Lightweight Hub shells keep a device-local active campaign selection, but must never fetch the
 * campaign context or brew merely to persist it (ADR 0013). `isContextHost: false` selects the
 * selection-only verification path.
 */
const activeCampaign = new HubActiveCampaignCoordinator({
	api,
	host: {
		isContextHost: false,
		isResourcePinned: () => false,
		getExplicitCampaignId: () => new URLSearchParams(window.location.search).get("id"),
	},
});
window.addEventListener("pagehide", event => {
	if (event.persisted) activeCampaign.suspend();
	else activeCampaign.dispose();
});
window.addEventListener("pageshow", event => {
	// eslint-disable-next-line no-console
	if (event.persisted) activeCampaign.pResume().catch(err => console.warn("Failed to resume campaign selection:", err));
});
const CURRENCY_TYPES = ["cp", "sp", "ep", "gp", "pp"];
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

function renderError (messageOrError, {actionLabel = null, fnAction = null} = {}) {
	const wrp = document.getElementById("hub-error");
	if (!wrp) return;
	const error = messageOrError instanceof HubApiError ? messageOrError : null;
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

function getContainerName ({kind, id, characters}) {
	return kind === "party_inventory" ? "Party inventory" : getCharacterNameById(characters, id);
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
	const escrow = transfer.payload?.escrow || {};
	const items = (escrow.items || []).map(entry => {
		const source = entry.item?.source ? ` · ${entry.item.source}` : "";
		return `${entry.quantity} × ${entry.item?.name || "item"}${source}`;
	});
	const currency = getCurrencyDescription(escrow.currency);
	return [...items, currency].filter(Boolean).join(" + ") || "Reserved transfer";
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

async function pInitGrantItemCatalog ({context}) {
	const open = document.getElementById("campaign-item-catalog-open");
	const close = document.getElementById("campaign-item-catalog-close");
	const wrapper = document.getElementById("campaign-item-catalog");
	const search = document.getElementById("campaign-item-catalog-search");
	const results = document.getElementById("campaign-item-catalog-results");
	const status = document.getElementById("campaign-item-catalog-status");
	const name = document.getElementById("campaign-item-name");
	const source = document.getElementById("campaign-item-source");
	const summary = document.getElementById("campaign-item-selection-summary");
	if (!open || !wrapper || !search || !results || !name || !source) {
		return {setCampaignBrewContent () {}};
	}

	let catalog = null;
	let isApplyingCatalog = false;
	let isCatalogSelection = false;
	let campaignBrewContent = context.brewBundle?.content;
	const renderMatches = () => {
		const query = search.value.trim().toLowerCase();
		results.replaceChildren();
		if (query.length < 2) {
			if (status) status.textContent = "Type at least 2 characters to search.";
			return;
		}
		const matches = catalog
			.filter(item => item.name.toLowerCase().includes(query) || item.source.toLowerCase().includes(query))
			.slice(0, 100);
		results.replaceChildren(...matches.map(item => {
			const option = document.createElement("option");
			option.value = `${item.name}|${item.source}`;
			option.textContent = `${item.name} — ${item.source}`;
			return option;
		}));
		if (status) {
			status.textContent = matches.length
				? `${matches.length}${matches.length === 100 ? "+" : ""} matching items.`
				: "No matching items. Try another name or use a custom item.";
		}
	};
	const applySelection = () => {
		const selected = results.selectedOptions[0];
		if (!selected) return;
		const splitAt = selected.value.lastIndexOf("|");
		isApplyingCatalog = true;
		name.value = selected.value.slice(0, splitAt);
		source.value = selected.value.slice(splitAt + 1);
		isApplyingCatalog = false;
		isCatalogSelection = true;
		if (summary) summary.textContent = `Selected: ${name.value} · ${source.value}`;
	};

	open.addEventListener("click", async () => {
		open.disabled = true;
		open.textContent = "Loading item catalog...";
		try {
			if (!catalog) {
				const {pLoadHubItemCatalog} = await import("./hub-item-catalog.js");
				catalog = await pLoadHubItemCatalog({campaignBrewContent});
			}
			setHidden(wrapper, false);
			search.focus();
			renderMatches();
		} catch (error) {
			const message = error.message || "The item catalog could not be loaded.";
			setFormStatus({formId: "campaign-item-form", message, isError: true});
		} finally {
			open.disabled = false;
			open.textContent = "Choose from item catalog";
		}
	});
	close?.addEventListener("click", () => {
		setHidden(wrapper, true);
		open.focus();
	});
	search.addEventListener("input", renderMatches);
	results.addEventListener("change", applySelection);
	results.addEventListener("dblclick", () => {
		applySelection();
		setHidden(wrapper, true);
		open.focus();
	});
	name.addEventListener("input", () => {
		if (isApplyingCatalog) return;
		isCatalogSelection = false;
		source.value = "HB";
		if (summary) summary.textContent = "Custom item · homebrew source";
	});
	return {
		setCampaignBrewContent (content) {
			campaignBrewContent = content;
			catalog = null;
			search.value = "";
			results.replaceChildren();
			setHidden(wrapper, true);
			if (isCatalogSelection) {
				name.value = "";
				source.value = "HB";
				isCatalogSelection = false;
				if (summary) summary.textContent = "Custom item · homebrew source";
			}
			if (status) status.textContent = "Campaign homebrew changed. Reopen the catalog to use the latest items.";
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
		if (description) description.textContent = "Open any campaign character or move directly into the live DM workspace.";
		if (guidance) guidance.textContent = "Keep play moving from the live workspace, then return here for requests and campaign setup.";
	} else {
		if (title) title.textContent = "My characters";
		if (description) description.textContent = "Your cloud characters for this campaign. Local originals remain independent.";
		if (guidance) {
			guidance.textContent = isSpectator
				? "Follow the party roster and campaign activity. Gameplay controls are reserved for players and DMs."
				: "Open your character, check requests, or send a transfer to another player.";
		}
	}

	setHidden(document.getElementById("campaign-characters-panel"), isSpectator);
	setHidden(document.getElementById("campaign-party-panel"), isDm);
	setHidden(document.getElementById("campaign-shared-actions"), !canPlay);
	setHidden(document.getElementById("campaign-action-form"), !isDm);
	setHidden(document.getElementById("campaign-jump-effect"), !isDm);
	setHidden(document.getElementById("campaign-jump-transfer"), !canPlay);
	setHidden(document.getElementById("campaign-dm-grants"), !isDm);
	setHidden(document.getElementById("campaign-content-managed-note"), isDm);
	setHidden(document.getElementById("campaign-open-dm-screen"), !isDm);
	setHidden(document.getElementById("campaign-upload-local"), !canPlay);

	const primaryCharacter = document.getElementById("campaign-open-primary-character");
	const firstCharacter = !isDm ? characters[0] : null;
	if (primaryCharacter && firstCharacter) {
		primaryCharacter.href = `charactersheet.html?id=${encodeURIComponent(firstCharacter.id)}&hubCampaign=${encodeURIComponent(campaign.id)}`;
		primaryCharacter.textContent = `Open ${getCharacterName(firstCharacter)}`;
	}
	setHidden(primaryCharacter, !firstCharacter);
}

function setFormStatus ({formId, message = "", isError = false}) {
	const status = document.getElementById(`${formId}-status`);
	if (!status) return;
	status.textContent = message;
	status.classList.toggle("hub-inline-status--error", isError);
}

function setFormAvailability ({formId, isAvailable, message}) {
	const form = document.getElementById(formId);
	if (!form) return;
	for (const button of form.querySelectorAll("button[type='submit']")) button.disabled = !isAvailable;
	if (!isAvailable) setFormStatus({formId, message});
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
					renderError(error);
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
	activeCampaign.pResolve({trigger: "startup", session}).catch(err => console.warn("Failed to resolve campaign selection:", err));
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
			await api.pRedeemInvite({token: inviteToken, idempotencyKey: crypto.randomUUID()});
			renderCampaignList(await api.pListCampaigns());
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
		await activeCampaign.pReportFailure({error, campaignId}).catch(() => {});
		throw error;
	}
	// The session and campaign are already verified here, so recording the selection costs no
	// additional request and never fetches the campaign context for selection purposes.
	// An archived campaign still renders read-only, but never becomes the active selection.
	await activeCampaign.adoptVerified({session, campaign});
	const [members, characters, snapshot] = await Promise.all([
		api.pListMembers({campaignId}),
		api.pListCharacters({campaignId}),
		api.pGetCampaignSnapshot({campaignId}),
	]);
	const [context, events] = await Promise.all([
		api.pGetCampaignContext({campaignId}),
		api.pListEvents({
			campaignId,
			afterSequence: Math.max(0, snapshot.lastSequence - 50),
			limit: 50,
		}),
	]);
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
	renderCharacterList({campaignId, characters});
	renderPartyRoster({
		campaignId,
		characters: snapshot.characters,
		members,
		session,
		isDm: ["dm", "co_dm"].includes(campaign.role),
		roster: snapshot.roster || [],
	});
	renderRecentActivity({events, characters: snapshot.characters, members});
	renderCampaignContext(context);
	applyCampaignRoleLayout({campaign, characters});
	if (campaign.status !== "active") {
		setHidden(document.getElementById("campaign-invite-form"), true);
		setHidden(document.getElementById("campaign-upload-local"), true);
		setHidden(document.getElementById("campaign-dm-controls"), true);
		setHidden(document.getElementById("campaign-open-dm-screen"), true);
		setHidden(document.getElementById("campaign-inbox-panel"), true);
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
	const {pRefreshTransferState} = await pInitCampaignForms({
		campaign,
		campaignId,
		session,
		characters,
		targetCharacters: snapshot.characters,
		members,
		context,
		pRefreshInvites,
		roster: snapshot.roster || [],
	});
	const realtime = new HubRealtimeClient({campaignId});
	let liveEvents = events;
	let liveMembers = members;
	let liveCharacters = snapshot.characters;
	let liveRoster = snapshot.roster || [];
	let liveLastSequence = snapshot.lastSequence;
	let refreshTimer = null;
	let isRefreshing = false;
	let isRefreshQueued = false;
	const pRefreshLiveViews = async () => {
		if (isCampaignReloadRequired || !navigator.onLine) return;
		if (isRefreshing) {
			isRefreshQueued = true;
			return;
		}
		isRefreshing = true;
		try {
			const [membersNxt, charactersNxt, snapshotNxt] = await Promise.all([
				api.pListMembers({campaignId}),
				api.pListCharacters({campaignId}),
				api.pGetCampaignSnapshot({campaignId}),
			]);
			const eventsNxt = await api.pListEvents({
				campaignId,
				afterSequence: Math.max(0, snapshotNxt.lastSequence - 50),
				limit: 50,
			});
			liveEvents = [...eventsNxt, ...liveEvents]
				.filter((event, index, all) => all.findIndex(other => other.id === event.id) === index)
				.sort((a, b) => a.sequence - b.sequence)
				.slice(-50);
			liveMembers = membersNxt;
			if (snapshotNxt.lastSequence >= liveLastSequence) {
				// Replacement, not a merge: a field the owner has just stopped sharing must
				// disappear rather than survive from the previous, broader projection.
				liveCharacters = snapshotNxt.characters;
				liveRoster = snapshotNxt.roster || [];
				liveLastSequence = snapshotNxt.lastSequence;
			}
			renderCharacterList({campaignId, characters: charactersNxt});
			renderPartyRoster({
				campaignId,
				characters: liveCharacters,
				members: membersNxt,
				session,
				isDm: ["dm", "co_dm"].includes(campaign.role),
				roster: liveRoster,
			});
			renderRecentActivity({events: liveEvents, characters: liveCharacters, members: membersNxt});
			await Promise.all([
				renderPendingActions({campaign, campaignId, session, targetCharacters: liveCharacters, members: membersNxt, roster: liveRoster}),
				pRefreshTransferState({
					charactersNxt,
					targetCharactersNxt: liveCharacters,
					membersNxt,
				}),
			]);
		} catch (error) {
			renderError(error);
		} finally {
			isRefreshing = false;
			if (isRefreshQueued) {
				isRefreshQueued = false;
				void pRefreshLiveViews();
			}
		}
	};
	const queueLiveRefresh = () => {
		if (isCampaignReloadRequired) return;
		if (refreshTimer != null) window.clearTimeout(refreshTimer);
		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			void pRefreshLiveViews();
		}, 250);
	};
	realtime.on("event", event => {
		if (!isCampaignReloadRequired && navigator.onLine) {
			liveLastSequence = Math.max(liveLastSequence, event.sequence || 0);
			liveEvents = [...liveEvents.filter(existing => existing.id !== event.id), event]
				.sort((a, b) => a.sequence - b.sequence)
				.slice(-50);
			renderRecentActivity({events: liveEvents, characters: liveCharacters, members: liveMembers});
		}
		// ADR 0011: `character.projection.invalidated` carries no character data. Every
		// event, including an invalidation, is coalesced into one authorization-scoped
		// HTTP refetch that *replaces* the roster rather than merging into it, so a
		// previously broader projection cannot survive a narrowed sharing policy.
		queueLiveRefresh();
	});
	realtime.on("cursor", baseline => {
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
			isCampaignReloadRequired = true;
			if (/session|account deletion/i.test(reason || "")) renderError(new HubApiError({code: "AUTH_REQUIRED", status: 401}));
			else if (/membership|authorization/i.test(reason || "")) renderError(new HubApiError({code: "CAMPAIGN_NOT_FOUND", status: 404}));
			else setCampaignConnectionStatus({label: "Live updates stopped · reload required", state: "warning"});
		}
	});
	window.addEventListener("beforeunload", () => realtime.close(), {once: true});
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
						select.disabled = false;
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
						button.disabled = false;
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
					button.disabled = false;
				}
			});
			row.append(button);
		}
		return row;
	}));
}

function renderCharacterList ({campaignId, characters}) {
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
		open.textContent = "Open sheet";
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
		const canOpen = isCanonicalProjection(character) && (isDm || getProjectionOwnerAccountId(character) === session.account.id);
		const row = document.createElement(canOpen ? "a" : "div");
		row.className = "hub-data-row";
		if (canOpen) {
			row.href = `charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`;
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
			open.textContent = "Open sheet";
			row.append(open);
		}
		return row;
	}));
}

function renderRecentActivity ({events, characters, members}) {
	const list = document.getElementById("campaign-activity-list");
	if (!list) return;
	const rows = renderHubActivityRows({
		list,
		events,
		characters,
		members,
		documentRef: document,
		getDateLabel,
	});
	setHidden(document.getElementById("campaign-activity-empty"), !!rows.length);
}

function fillCharacterSelect (select, characters, {includeParty = false, partyInventory = null, ownerAccountId = null} = {}) {
	if (!select) return;
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
}

function updateInboxCount ({kind, count}) {
	const element = document.getElementById("campaign-inbox-count");
	if (!element) return;
	element.dataset[kind] = `${count}`;
	element.textContent = `${Number(element.dataset.actions || 0) + Number(element.dataset.transfers || 0)}`;
}

async function renderPendingActions ({campaign, campaignId, session, targetCharacters, members, roster = null}) {
	const list = document.getElementById("campaign-pending-actions");
	if (!list) return;
	const actions = await api.pListPendingActions({campaignId});
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
						await renderPendingActions({campaign, campaignId, session, targetCharacters, members});
					} catch (error) {
						renderError(error);
						button.disabled = false;
					}
				});
				controls.append(button);
			}
			row.append(controls);
		}
		return row;
	}));
}

async function renderPendingTransfers ({campaign, campaignId, session, targetCharacters, members, pRefreshTransferState}) {
	const list = document.getElementById("campaign-pending-transfers");
	if (!list) return;
	const transfers = await api.pListTransfers({campaignId});
	const pending = transfers.filter(transfer => transfer.status === "reserved");
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
		const sourceName = getContainerName({kind: transfer.sourceKind, id: transfer.sourceId, characters: targetCharacters});
		const targetName = getContainerName({kind: transfer.targetKind, id: transfer.targetId, characters: targetCharacters});
		text.textContent = `${sourceName} offers ${contents} to ${targetName}.`;
		const target = transfer.targetKind === "character" ? getCharacterById(targetCharacters, transfer.targetId) : null;
		const canAccept = isDm || getProjectionOwnerAccountId(target) === session.account.id;
		const canReject = canAccept || transfer.actorAccountId === session.account.id;
		const meta = document.createElement("span");
		meta.className = "hub-data-row__meta";
		meta.textContent = canAccept
			? "Your response is needed"
			: canReject
				? "Waiting for the recipient; you can cancel this transfer"
				: "Waiting for the recipient";
		main.append(text, meta);
		row.append(main);
		if (canReject) {
			const controls = document.createElement("span");
			controls.className = "hub-data-row__controls";
			for (const decision of [...(canAccept ? ["accept"] : []), "reject"]) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = decision === "accept" ? "hub-button hub-button--primary" : "hub-button";
				button.textContent = decision === "accept" ? "Accept" : canAccept ? "Reject" : "Cancel";
				button.addEventListener("click", async () => {
					for (const control of controls.querySelectorAll("button")) control.disabled = true;
					try {
						await api.pResolveTransfer({campaignId, transferId: transfer.id, decision, idempotencyKey: crypto.randomUUID()});
						await pRefreshTransferState();
					} catch (error) {
						renderError(error);
						for (const control of controls.querySelectorAll("button")) control.disabled = false;
					}
				});
				controls.append(button);
			}
			row.append(controls);
		}
		return row;
	}));
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
		]));
}

async function pRunFormMutation ({form, fnMutate}) {
	if (form._hubIsSubmitting) return null;
	const fingerprint = getFormFingerprint(form);
	if (form._hubMutationFingerprint !== fingerprint) {
		form._hubMutationFingerprint = fingerprint;
		form._hubMutationKey = crypto.randomUUID();
	}
	form._hubIsSubmitting = true;
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
			button.disabled = disabled;
			button.textContent = text;
		});
	}
}

async function pInitCampaignForms ({campaign, campaignId, session, characters, targetCharacters, members, context, pRefreshInvites, roster = []}) {
	// Roster metadata travels beside the projections and is refreshed with them.
	const rosterRef = {current: roster};
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
		document.getElementById("campaign-rule-jumping").checked = !!activeRules.thelemar_jumping;
		document.getElementById("campaign-rule-linguistics").checked = !!activeRules.thelemar_linguisticsBonus;
		document.getElementById("campaign-rule-critical").checked = !!activeRules.thelemar_criticalRolls;
	}
	setHidden(inviteForm, !isDm);
	inviteForm?.addEventListener("submit", async event => {
		event.preventDefault();
		setFormStatus({formId: "campaign-invite-form"});
		try {
			await pRunFormMutation({form: event.currentTarget,
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
			leave.disabled = false;
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
				idempotencyKey: crypto.randomUUID(),
			});
			const charactersNxt = await api.pListCharacters({campaignId});
			renderCharacterList({campaignId, characters: charactersNxt});
			applyCampaignRoleLayout({campaign, characters: charactersNxt});
			setHidden(uploadControls, true);
			if (uploadStatus) uploadStatus.textContent = `${character.name || "Character"} was added as a cloud copy. The local original is unchanged.`;
		} catch (error) {
			renderError(error);
		} finally {
			uploadConfirm.disabled = false;
		}
	});

	const dmControls = document.getElementById("campaign-dm-controls");
	setHidden(dmControls, !isDm);
	const dmScreenLink = document.getElementById("campaign-open-dm-screen");
	if (dmScreenLink) dmScreenLink.href = `dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`;
	let partyInventory = await api.pGetPartyInventory({campaignId});
	const pRefreshTransferState = async ({
		charactersNxt = null,
		targetCharactersNxt = null,
		membersNxt = null,
		partyInventoryNxt = null,
	} = {}) => {
		const source = document.getElementById("campaign-transfer-source");
		const target = document.getElementById("campaign-transfer-target");
		const item = document.getElementById("campaign-transfer-entry");
		const selections = {
			source: source?.value,
			target: target?.value,
			item: item?.value,
			quantity: document.getElementById("campaign-transfer-quantity")?.value,
		};
		const [charactersLatest, snapshotLatest, partyInventoryLatest] = await Promise.all([
			charactersNxt ? null : api.pListCharacters({campaignId}),
			targetCharactersNxt ? null : api.pGetCampaignSnapshot({campaignId}),
			partyInventoryNxt ? null : api.pGetPartyInventory({campaignId}),
		]);
		characters.splice(0, characters.length, ...(charactersNxt || charactersLatest));
		targetCharacters.splice(0, targetCharacters.length, ...(targetCharactersNxt || snapshotLatest.characters));
		if (snapshotLatest?.roster) rosterRef.current = snapshotLatest.roster;
		if (membersNxt) members.splice(0, members.length, ...membersNxt);
		partyInventory = partyInventoryNxt || partyInventoryLatest;

		fillCharacterSelect(source, characters, {
			includeParty: isDm,
			partyInventory,
			ownerAccountId: session.account.id,
		});
		// A character whose identity the owner hid is absent from roster metadata and is
		// therefore not peer-targetable.
		fillCharacterSelect(target, getTargetableProjections({projections: targetCharacters, roster: rosterRef.current}), {includeParty: true, partyInventory});
		if ([...source.options].some(option => option.value === selections.source)) source.value = selections.source;
		if ([...target.options].some(option => option.value === selections.target)) target.value = selections.target;
		syncTransferItemPicker({characters, partyInventory});
		if ([...item.options].some(option => option.value === selections.item)) {
			item.value = selections.item;
			syncTransferQuantity();
			const maximum = Number(item.selectedOptions[0]?.dataset.quantity);
			if (Number(selections.quantity) > 0 && Number(selections.quantity) <= maximum) {
				document.getElementById("campaign-transfer-quantity").value = selections.quantity;
			}
		}
		renderPartyInventoryStatus(partyInventory);
		await renderPendingTransfers({
			campaign,
			campaignId,
			session,
			targetCharacters,
			members,
			pRefreshTransferState,
		});
	};

	await renderPendingActions({campaign, campaignId, session, targetCharacters, members});
	await pRefreshTransferState({
		charactersNxt: characters,
		targetCharactersNxt: targetCharacters,
		membersNxt: members,
		partyInventoryNxt: partyInventory,
	});

	fillCharacterSelect(document.getElementById("campaign-action-target"), getTargetableProjections({projections: targetCharacters, roster: rosterRef.current}));
	for (const id of ["campaign-xp-target", "campaign-item-target"]) fillCharacterSelect(document.getElementById(id), characters);
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
	for (const formId of ["campaign-xp-form", "campaign-item-form"]) {
		setFormAvailability({
			formId,
			isAvailable: !!characters.length,
			message: "Add a campaign character before using this grant.",
		});
	}

	const actionType = document.getElementById("campaign-action-type");
	const actionValue = document.getElementById("campaign-action-value");
	const actionValueLabel = document.getElementById("campaign-action-value-label");
	const actionConditionSourceField = document.getElementById("campaign-action-condition-source-field");
	const actionConditionSource = document.getElementById("campaign-action-condition-source");
	const actionSlotFields = document.getElementById("campaign-action-slot-fields");
	const syncActionFields = () => {
		const type = actionType.value;
		const isSlot = ["spell_slot_spend", "spell_slot_restore"].includes(type);
		const isCondition = ["condition_add", "condition_remove"].includes(type);
		setHidden(actionSlotFields, !isSlot);
		setHidden(actionConditionSourceField, !isCondition);
		actionConditionSource.disabled = !isCondition;
		actionValue.disabled = isSlot;
		actionValue.required = !isSlot;
		if (isSlot) return;
		const configuration = {
			damage: {label: "Damage amount", type: "number", placeholder: "1"},
			healing: {label: "Healing amount", type: "number", placeholder: "1"},
			condition_add: {label: "Condition to add", type: "text", placeholder: "Poisoned"},
			condition_remove: {label: "Condition to remove", type: "text", placeholder: "Poisoned"},
		}[type];
		actionValueLabel.textContent = configuration.label;
		actionValue.type = configuration.type;
		actionValue.inputMode = configuration.type === "number" ? "numeric" : "text";
		actionValue.placeholder = configuration.placeholder;
		actionValue.min = configuration.type === "number" ? "1" : "";
	};
	actionType?.addEventListener("change", syncActionFields);
	syncActionFields();

	document.getElementById("campaign-action-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const formId = "campaign-action-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: async idempotencyKey => {
					const type = document.getElementById("campaign-action-type").value;
					const rawValue = document.getElementById("campaign-action-value").value.trim();
					if (["damage", "healing"].includes(type) && !(Number(rawValue) > 0)) {
						throw new Error("Enter a positive amount.");
					}
					if (["condition_add", "condition_remove"].includes(type) && !rawValue) {
						throw new Error("Enter a condition.");
					}
					const conditionSource = document.getElementById("campaign-action-condition-source").value.trim();
					if (["condition_add", "condition_remove"].includes(type) && !conditionSource) {
						throw new Error("Enter the condition source code.");
					}
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
									arguments: {condition: {name: rawValue, source: conditionSource}},
								}
								: null;
					await api.pCreateStructuredAction({
						campaignId,
						targetCharacterId: document.getElementById("campaign-action-target").value.split(":")[1],
						operation,
						idempotencyKey,
					});
					document.getElementById("campaign-action-value").value = "";
					setFormStatus({formId, message: "Effect applied."});
					await renderPendingActions({campaign, campaignId, session, targetCharacters, members});
				}});
		} catch (error) {
			const message = error instanceof HubApiError ? getErrorMessage(error) : error.message;
			setFormStatus({formId, message, isError: true});
			if (error instanceof HubApiError) renderError(error);
		}
	});

	document.getElementById("campaign-xp-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const formId = "campaign-xp-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: idempotencyKey => api.pGrantXp({
					campaignId,
					characterId: document.getElementById("campaign-xp-target").value.split(":")[1],
					amount: Number(document.getElementById("campaign-xp-amount").value),
					reason: document.getElementById("campaign-xp-reason").value || null,
					idempotencyKey,
				})});
			setFormStatus({formId, message: "XP granted."});
			document.getElementById("campaign-xp-amount").value = "";
			document.getElementById("campaign-xp-reason").value = "";
		} catch (error) {
			setFormStatus({formId, message: getErrorMessage(error), isError: true});
			if (error instanceof HubApiError) renderError(error);
		}
	});

	const itemCatalog = await pInitGrantItemCatalog({context});
	document.getElementById("campaign-item-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const formId = "campaign-item-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: idempotencyKey => api.pGrantItem({
					campaignId,
					characterId: document.getElementById("campaign-item-target").value.split(":")[1],
					item: {
						name: document.getElementById("campaign-item-name").value,
						source: document.getElementById("campaign-item-source").value || "HB",
					},
					quantity: Number(document.getElementById("campaign-item-quantity").value) || 1,
					idempotencyKey,
				})});
			setFormStatus({formId, message: "Item granted."});
			document.getElementById("campaign-item-name").value = "";
			document.getElementById("campaign-item-source").value = "HB";
			document.getElementById("campaign-item-quantity").value = "1";
			document.getElementById("campaign-item-selection-summary").textContent = "Custom item · homebrew source";
		} catch (error) {
			setFormStatus({formId, message: getErrorMessage(error), isError: true});
			if (error instanceof HubApiError) renderError(error);
		}
	});

	document.getElementById("campaign-transfer-form")?.addEventListener("submit", async event => {
		event.preventDefault();
		const formId = "campaign-transfer-form";
		setFormStatus({formId});
		try {
			await pRunFormMutation({form: event.currentTarget,
				fnMutate: async idempotencyKey => {
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
					await api.pProposeTransfer({
						campaignId,
						sourceKind,
						sourceId,
						targetKind,
						targetId,
						payload: {
							items: entryId && quantity ? [{entryId, quantity}] : [],
							currency,
						},
						idempotencyKey,
					});
				}});
			for (const type of CURRENCY_TYPES) document.getElementById(`campaign-transfer-${type}`).value = "0";
			setFormStatus({formId, message: "Transfer reserved. The recipient can now accept it from the inbox."});
			try {
				await pRefreshTransferState();
			} catch {
				setFormStatus({
					formId,
					message: "Transfer reserved, but the latest balances could not be loaded. Reload the campaign before sending another transfer.",
					isError: true,
				});
				event.currentTarget.querySelector("button[type='submit']").disabled = true;
			}
		} catch (error) {
			const message = error instanceof HubApiError ? getErrorMessage(error) : error.message;
			setFormStatus({formId, message, isError: true});
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
					itemCatalog.setCampaignBrewContent(contextNxt.brewBundle?.content);
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
				fnMutate: async idempotencyKey => {
					const rules = {
						enableTgtt: document.getElementById("campaign-rule-tgtt").checked,
						exhaustionRules: document.getElementById("campaign-rule-exhaustion").value,
						thelemar_carryWeight: document.getElementById("campaign-rule-carry").checked,
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

	return {pRefreshTransferState};
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
			// eslint-disable-next-line no-console
			activeCampaign.pResolve({trigger: "logout", session}).catch(err => console.warn("Failed to clear campaign selection:", err));
			const signIn = document.getElementById("hub-sign-in");
			if (signIn) {
				const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
				signIn.href = `/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
			}
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
