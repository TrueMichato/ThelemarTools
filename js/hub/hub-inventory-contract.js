const ITEM_REFERENCE_KEYS = new Set([
	"ammoId",
	"componentItemId",
	"grantedByItemId",
	"inventoryItemId",
	"itemId",
	"sourceItemId",
	"weaponId",
]);

const PARTIAL_TRANSFER_BLOCKERS = new Set([
	"contains items",
	"hosts Ioun items",
]);

function hasItemReference (value, itemId, fnNormalizeItemId) {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(it => hasItemReference(it, itemId, fnNormalizeItemId));
	for (const [key, child] of Object.entries(value)) {
		if (ITEM_REFERENCE_KEYS.has(key) && fnNormalizeItemId(child) === itemId) return true;
		if (hasItemReference(child, itemId, fnNormalizeItemId)) return true;
	}
	return false;
}

export function getWholeItemTransferBlockers ({
	container,
	entry,
	fnNormalizeItemId = value => value,
}) {
	const itemId = fnNormalizeItemId(entry?.id);
	if (!itemId) return ["missing inventory identity"];
	const sourceFeatureId = `item:${itemId}`;
	const normalizeSourceFeatureId = value => {
		if (typeof value !== "string" || !value.startsWith("item:")) return value;
		return `item:${fnNormalizeItemId(value.slice(5))}`;
	};
	const blockers = [];
	if (entry.equipped) blockers.push("equipped");
	if (entry.attuned) blockers.push("attuned");
	if (entry.item?.containedItems?.length) blockers.push("contains items");
	if ((container?.inventory || []).some(it =>
		fnNormalizeItemId(it.id) !== itemId
		&& it.item?.containedItems?.some(containedId => fnNormalizeItemId(containedId) === itemId),
	)) blockers.push("inside a container");
	if (entry.item?.iounSet?.length) blockers.push("hosts Ioun items");
	if ((container?.inventory || []).some(it =>
		fnNormalizeItemId(it.id) !== itemId
		&& it.item?.iounSet?.some(iounId => fnNormalizeItemId(iounId) === itemId),
	)) blockers.push("seated in an Ioun host");
	if (
		Object.entries(container?.selectedAmmo || {}).some(([key, value]) =>
			fnNormalizeItemId(key) === itemId || fnNormalizeItemId(value) === itemId,
		)
	) blockers.push("selected ammunition");
	if (Object.keys(container?.ammunitionConsumed || {}).some(key => fnNormalizeItemId(key) === itemId)) blockers.push("tracked ammunition");
	if ((container?.namedModifiers || []).some(it => normalizeSourceFeatureId(it.sourceFeatureId) === sourceFeatureId)) blockers.push("item effects");
	if ((container?.acFormulas || []).some(it => normalizeSourceFeatureId(it.sourceFeatureId) === sourceFeatureId)) blockers.push("AC effects");
	if (Object.values(container?.grantedDefensiveTraits || {}).some(byName =>
		Object.values(byName || {}).some(sourceIds =>
			Array.isArray(sourceIds)
			&& sourceIds.some(sourceId => normalizeSourceFeatureId(sourceId) === sourceFeatureId),
		),
	)) blockers.push("defensive effects");
	if (hasItemReference(container?.activeStates, itemId, fnNormalizeItemId)) blockers.push("active state");
	if (
		hasItemReference(container?.itemGrantedSpells, itemId, fnNormalizeItemId)
		|| hasItemReference(container?.spellcasting, itemId, fnNormalizeItemId)
	) blockers.push("spell or component link");
	if (Object.keys(container?.iounBonds || {}).some(key => fnNormalizeItemId(key) === itemId)) blockers.push("Ioun bond");
	return [...new Set(blockers)];
}

export function getInventoryTransferEligibility ({container, entry, quantity = entry?.quantity} = {}) {
	const availableQuantity = Number(entry?.quantity);
	if (!Number.isSafeInteger(availableQuantity) || availableQuantity < 1) {
		return {isEligible: false, blockers: ["invalid available quantity"], maxQuantity: 0};
	}
	if (!Number.isSafeInteger(quantity) || quantity < 1) {
		return {isEligible: false, blockers: ["enter a whole-number quantity"], maxQuantity: availableQuantity};
	}
	if (quantity > availableQuantity) {
		return {isEligible: false, blockers: ["not enough quantity remains"], maxQuantity: availableQuantity};
	}
	const blockers = getWholeItemTransferBlockers({container, entry});
	if (quantity < availableQuantity) {
		const partialBlockers = blockers.filter(blocker => PARTIAL_TRANSFER_BLOCKERS.has(blocker));
		return {
			isEligible: !partialBlockers.length,
			blockers: partialBlockers,
			maxQuantity: partialBlockers.length ? 0 : availableQuantity,
		};
	}
	return {
		isEligible: !blockers.length,
		blockers,
		maxQuantity: blockers.length
			? (blockers.some(blocker => PARTIAL_TRANSFER_BLOCKERS.has(blocker)) ? 0 : Math.max(0, availableQuantity - 1))
			: availableQuantity,
	};
}

export function getInventoryStackWeight (entry) {
	const quantity = Number(entry?.quantity);
	const unitWeight = Number(entry?.item?.weight);
	if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isFinite(unitWeight) || unitWeight < 0) return null;
	const weight = quantity * unitWeight;
	return Number.isFinite(weight) && weight <= Number.MAX_SAFE_INTEGER ? weight : null;
}

export function getInventoryWeightSummary (inventory = []) {
	return (Array.isArray(inventory) ? inventory : []).reduce((summary, entry) => {
		const weight = getInventoryStackWeight(entry);
		if (weight == null) summary.unknownStackCount++;
		else summary.knownWeight += weight;
		return summary;
	}, {knownWeight: 0, unknownStackCount: 0});
}
