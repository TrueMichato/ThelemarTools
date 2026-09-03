import {
	getProjectionId,
	getProjectionName,
	getProjectionView,
} from "./hub-character-view.js";
import {getHubItemSummary} from "./hub-item-catalog.js";

const REQUEST_ITEM_FIELDS = Object.freeze(["name", "source", "page", "rarity", "weight", "value", "typeCode", "edition"]);

function getItemUid (item) {
	return `${item?.name || ""}|${item?.source || ""}`.toLowerCase();
}

function getRequestItem (item) {
	return Object.fromEntries(REQUEST_ITEM_FIELDS
		.filter(key => item?.[key] !== undefined)
		.map(key => [key, item[key]]));
}

export function buildRecentAwardItems (events = []) {
	const byUid = new Map();
	for (const event of [...events].sort((a, b) => (b.sequence || 0) - (a.sequence || 0))) {
		if (event?.type !== "item.granted") continue;
		const summary = getHubItemSummary(event.payload?.entry?.item, {sourceKind: "recent"});
		if (!summary) continue;
		const uid = getItemUid(summary);
		if (!byUid.has(uid)) byUid.set(uid, summary);
	}
	return [...byUid.values()];
}

export function buildStashAwardItems (partyInventory) {
	return (Array.isArray(partyInventory?.inventory) ? partyInventory.inventory : [])
		.map(entry => {
			const summary = getHubItemSummary(entry?.item, {sourceKind: "party_inventory"});
			const availableQuantity = Number(entry?.quantity);
			if (!summary || !Number.isSafeInteger(availableQuantity) || availableQuantity < 1) return null;
			return {...summary, entryId: entry.id, availableQuantity};
		})
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

export function filterAwardItems ({items = [], query = "", isQueryRequired = false, limit = 100} = {}) {
	const normalizedQuery = query.trim().toLowerCase();
	if (isQueryRequired && normalizedQuery.length < 2) return [];
	return items
		.filter(item => !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery) || item.source.toLowerCase().includes(normalizedQuery))
		.slice(0, limit);
}

export function getAwardSourceRequest (selectedItem) {
	if (!selectedItem) return null;
	if (selectedItem.sourceKind === "party_inventory") {
		return {kind: "party_inventory", entryId: selectedItem.entryId};
	}
	return {
		kind: selectedItem.sourceKind,
		item: getRequestItem(selectedItem),
	};
}

export function buildAwardPreview ({
	targets = [],
	selectedItem = null,
	quantity = 1,
	policyBlockedTargetIds = [],
} = {}) {
	const blocked = new Set(policyBlockedTargetIds);
	const perTargetQuantity = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
	const unitWeight = Number(selectedItem?.weight);
	const hasKnownWeight = Number.isFinite(unitWeight) && unitWeight >= 0;
	const addedWeight = hasKnownWeight ? unitWeight * perTargetQuantity : null;
	const rows = targets.map(target => {
		const characterId = getProjectionId(target);
		const name = getProjectionName(target);
		if (blocked.has(characterId)) {
			return {
				characterId,
				name,
				state: "policy_blocked",
				message: "Campaign policy blocks this award. No item will be sent.",
			};
		}
		const carry = getProjectionView(target).carrySummary;
		if (!carry || !Number.isFinite(carry.carried) || !Number.isFinite(carry.capacity) || addedWeight == null) {
			return {
				characterId,
				name,
				state: "unavailable",
				message: !hasKnownWeight
					? "Post-award carry is unavailable because this item has no published weight."
					: "Post-award carry is unavailable because this character has no current shared carry summary.",
			};
		}
		const postAward = carry.carried + addedWeight;
		if (carry.isIndeterminate) {
			return {
				characterId,
				name,
				state: "lower_bound",
				message: `Known carry becomes at least ${postAward.toLocaleString()} lb of ${carry.capacity.toLocaleString()} lb; unweighed items keep the exact total unavailable.`,
				postAward,
			};
		}
		const warning = postAward > carry.capacity
			? " This is over the current capacity."
			: carry.state && carry.state !== "normal"
				? ` Current carry state: ${carry.state.replaceAll("_", " ")}.`
				: "";
		return {
			characterId,
			name,
			state: "known",
			message: `${carry.carried.toLocaleString()} lb becomes ${postAward.toLocaleString()} lb of ${carry.capacity.toLocaleString()} lb.${warning}`,
			postAward,
		};
	});
	return {
		addedWeight,
		hasKnownWeight,
		rows,
		isPolicyBlocked: rows.some(row => row.state === "policy_blocked"),
	};
}
