import {getInventoryWeightSummary} from "./hub-inventory-contract.js";
import {getProjectionId, getProjectionName, getProjectionOwnerAccountId} from "./hub-character-view.js";
import {renderHubActivityRows} from "./hub-activity-render.js";

const COINS = ["cp", "sp", "ep", "gp", "pp"];
const isPublishedNumber = value => ["number", "string"].includes(typeof value) && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const formatNumber = value => Number(value).toLocaleString();

/** Read-only presentation over the existing authorized stash, roster and event reads. */
export function createHubInventoryWorkspace ({root, campaign, accountId, documentRef = document, pRefresh}) {
	if (!root) return null;
	const find = name => root.querySelector(`[data-inventory-${name}]`);
	const status = find("status");
	const retry = find("retry");
	const actions = find("actions");
	const guidance = find("guidance");
	const items = find("items");
	const empty = find("empty");
	const currency = find("currency");
	const weight = find("weight");
	const activity = find("activity");
	const activityEmpty = find("activity-empty");
	const search = root.querySelector("#campaign-inventory-search");
	let partyInventory = null;
	let characters = [];
	let state = "loading";
	let isOnline = true;
	let isTerminal = false;
	let isReloadRequired = false;
	let isRetrying = false;
	let generation = 0;
	let pendingCount = null;
	let presentationKey = null;
	const isDm = ["dm", "co_dm"].includes(campaign.role);
	const isPlayer = campaign.role === "player";
	const canPlay = campaign.status === "active" && (isDm || isPlayer);
	const make = (tag, text, className) => {
		const element = documentRef.createElement(tag);
		if (text != null) element.textContent = text;
		if (className) element.className = className;
		return element;
	};
	const addLink = ({label, href, targetId = null}) => {
		const link = make("a", label, "hub-button");
		link.href = href;
		if (targetId) {
			link.addEventListener("click", event => {
				const target = documentRef.getElementById(targetId);
				if (!target) return;
				event.preventDefault();
				const workbench = target.closest("details");
				if (workbench) workbench.open = true;
				const focusTarget = target.querySelector("select:not(:disabled), input:not([type='hidden']):not(:disabled), button:not(:disabled), textarea:not(:disabled)") || target;
				if (!focusTarget.hasAttribute("tabindex") && focusTarget === target) focusTarget.tabIndex = -1;
				focusTarget.focus();
				target.scrollIntoView({block: "nearest"});
			});
		}
		actions.append(link);
	};
	const renderActions = () => {
		// Keep the existing anchors alive on ordinary refreshes so keyboard focus survives.
		const owned = characters.filter(character => getProjectionOwnerAccountId(character) === accountId);
		const key = JSON.stringify([state === "ready" && isOnline && !isReloadRequired && !isTerminal, owned.map(character => [getProjectionId(character), getProjectionName(character)]), pendingCount]);
		if (presentationKey === key) return;
		const focusedHref = actions.contains(documentRef.activeElement) ? documentRef.activeElement.getAttribute("href") : null;
		presentationKey = key;
		actions.replaceChildren();
		guidance.textContent = !canPlay
			? "Read-only shared supplies. Inventory actions are not available for this campaign role or status."
			: isDm
				? "Move shared supplies with DM authority, review requests, or award items without editing a player's Sheet."
				: "Use your owned Sheet to deposit, request shared supplies, or offer gear. A DM must approve stash requests before anything moves.";
		if (!canPlay || state !== "ready" || !isOnline || isReloadRequired || isTerminal) return;
		if (isDm) {
			addLink({label: "Move items or currency", href: "#campaign-transfer-form", targetId: "campaign-transfer-form"});
			addLink({label: "Award items", href: "#campaign-item-form", targetId: "campaign-item-form"});
			addLink({label: "Grant XP", href: "#campaign-xp-form", targetId: "campaign-xp-form"});
			addLink({label: pendingCount == null ? "Review transfers" : `Review transfers (${pendingCount} pending)`, href: "#campaign-pending-transfers", targetId: "campaign-pending-transfers"});
		} else {
			for (const character of owned) {
				addLink({
					label: `Open ${getProjectionName(character)} Sheet`,
					href: `charactersheet.html?id=${encodeURIComponent(getProjectionId(character))}&hubCampaign=${encodeURIComponent(campaign.id)}`,
				});
			}
			if (!owned.length) guidance.textContent = "Add a cloud character copy to this campaign, then use its owned Sheet for deposits, requests and offers. A DM must approve stash requests.";
		}
		if (focusedHref && [documentRef.body, actions].includes(documentRef.activeElement)) {
			[...actions.querySelectorAll("a")].find(link => link.getAttribute("href") === focusedHref)?.focus({preventScroll: true});
		}
	};
	const renderState = () => {
		root.setAttribute("aria-busy", `${state === "loading" || isRetrying}`);
		status.textContent = isTerminal ? "Shared inventory is no longer available."
			: !isOnline ? "Offline · last loaded supplies are read only and may be stale."
				: isReloadRequired ? "Back online · Reload the campaign to revalidate access before making changes."
					: state === "loading" || isRetrying ? (partyInventory ? "Refreshing shared supplies..." : "Loading shared supplies...")
						: state === "error" ? `Shared supplies could not be loaded.${partyInventory ? " Showing last loaded balances." : ""} Retry refresh; no transfer will be sent.`
							: "Shared supplies are up to date.";
		status.classList.toggle("hub-inline-status--error", state === "error" && isOnline && !isReloadRequired);
		retry.hidden = isTerminal || (state !== "error" && !isReloadRequired && isOnline);
		retry.disabled = !isOnline || isRetrying || isTerminal;
		retry.textContent = isReloadRequired ? "Reload campaign" : isRetrying ? "Refreshing..." : "Retry shared supplies";
		renderActions();
	};
	const renderItems = () => {
		const query = search.value.trim().toLowerCase();
		const inventory = partyInventory?.inventory || [];
		const visible = inventory.filter(entry => [entry.item?.name, entry.item?.source].some(value => String(value || "").toLowerCase().includes(query)));
		items.replaceChildren(...visible.map(entry => {
			const row = make("li", null, "hub-data-row");
			const main = make("div", null, "hub-data-row__main");
			main.append(make("strong", `${formatNumber(entry.quantity)} × ${entry.item?.name || "Unnamed item"}`, "hub-data-row__name"));
			const metadata = [entry.item?.source, entry.item?.rarity].filter(value => typeof value === "string" && value);
			main.append(make("span", metadata.join(" · ") || "Source not provided", "hub-data-row__meta"));
			const detail = [
				isPublishedNumber(entry.item?.weight) ? `${formatNumber(entry.item.weight)} lb each` : "Weight unavailable",
				...(isPublishedNumber(entry.item?.value) ? [`${formatNumber(entry.item.value)} CP each`] : []),
			];
			row.append(main, make("span", detail.join(" · "), "hub-data-row__meta"));
			return row;
		}));
		empty.hidden = !partyInventory || !!visible.length;
		const hasCurrency = COINS.some(type => Number(partyInventory?.currency?.[type]) > 0);
		empty.textContent = inventory.length ? "No shared items match this search."
			: hasCurrency ? "No shared item stacks. Currency is available below."
				: "The shared stash is empty. Deposit items or currency from an owned Sheet to stock it.";
		currency.replaceChildren(...(partyInventory ? COINS.map(type => make("span", `${formatNumber(partyInventory.currency?.[type] || 0)} ${type.toUpperCase()}`)) : []));
		if (!partyInventory) {
			weight.textContent = "";
			return;
		}
		// Missing weight is unknown, never zero. The shared helper expects a published number.
		const weightEntries = inventory.map(entry => isPublishedNumber(entry.item?.weight) ? entry : {...entry, item: {...entry.item, weight: undefined}});
		const summary = getInventoryWeightSummary(weightEntries);
		weight.textContent = `Shared item weight: ${summary.unknownStackCount ? "at least " : ""}${formatNumber(summary.knownWeight)} lb${summary.unknownStackCount ? " · exact total unavailable for unweighed stacks" : ""}. Coin weight is not included. Shared custody is not assigned to a character; destination carry previews use only authorized summaries in the award composer.`;
	};
	search.addEventListener("input", renderItems);
	retry.addEventListener("click", async () => {
		if (!isOnline || isTerminal || isRetrying) return;
		if (isReloadRequired) {
			documentRef.defaultView.location.reload();
			return;
		}
		const requestGeneration = generation;
		isRetrying = true;
		renderState();
		try {
			// This callback refreshes reads only; it must never replay a proposal or resolution.
			await pRefresh?.();
		} catch {
			if (generation === requestGeneration && !isTerminal) state = "error";
		} finally {
			if (generation === requestGeneration && !isTerminal) {
				isRetrying = false;
				renderState();
				if (state === "ready" && documentRef.activeElement === retry) search.focus();
			}
		}
	});
	renderState();
	return {
		replace ({partyInventory: next, characters: nextCharacters = []}) {
			if (isTerminal || isReloadRequired || !isOnline) return;
			partyInventory = next;
			characters = nextCharacters;
			state = "ready";
			renderItems();
			renderState();
		},
		setPending (count) {
			if (isTerminal) return;
			pendingCount = count;
			renderActions();
		},
		setActivity ({events = [], characters: activityCharacters = [], members = []}) {
			if (isTerminal || isReloadRequired || !isOnline) return;
			const rows = renderHubActivityRows({
				list: activity,
				events: events.filter(event => event.type?.startsWith("transfer.") || event.type === "item.granted"),
				characters: activityCharacters,
				members,
				documentRef,
				getDateLabel: value => value ? new Date(value).toLocaleString() : "",
				limit: 5,
			});
			activityEmpty.hidden = !!rows.length;
		},
		setLoading () {
			if (isTerminal || isReloadRequired) return;
			state = "loading";
			renderState();
		},
		setError () {
			if (isTerminal) return;
			state = "error";
			renderState();
		},
		setOnline (online) {
			isOnline = online;
			isReloadRequired = true;
			renderState();
		},
		conceal ({isTerminal: terminal = false} = {}) {
			generation++;
			isTerminal ||= terminal;
			isRetrying = false;
			partyInventory = null;
			characters = [];
			pendingCount = null;
			state = "loading";
			items.replaceChildren();
			currency.replaceChildren();
			activity.replaceChildren();
			activityEmpty.hidden = true;
			if (isTerminal) search.value = "";
			empty.hidden = true;
			weight.textContent = "";
			renderState();
		},
	};
}
