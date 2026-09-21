import {HubStoreError} from "./hub-store-error.js";
import {getWholeItemTransferBlockers} from "./hub-inventory-contract.js";

export const SOURCE_COST_VERSION = 1;
export const PEER_SOURCE_COSTS_CONTRACT_VERSION = 1;
export const PEER_SOURCE_COSTS_PROTOCOL_VERSION = "4";
export const PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION = "peer-effects-v1";
export const SOURCE_COST_KINDS = Object.freeze([
	"spell_slot",
	"item_charge",
	"inventory_quantity",
	"feature_use",
]);

export function isPeerSourceCostsProtocolVersion (protocolVersion) {
	return ["4", "5"].includes(`${protocolVersion}`);
}

export function getPeerSourceCostsCapability ({enabled = false} = {}) {
	return {
		enabled: enabled === true,
		contractVersion: PEER_SOURCE_COSTS_CONTRACT_VERSION,
		protocolVersion: Number(PEER_SOURCE_COSTS_PROTOCOL_VERSION),
		operationVersion: 1,
		resourceKinds: [...SOURCE_COST_KINDS],
		templateRegistryVersion: PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION,
	};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function failUnsupported () {
	throw new HubStoreError("SOURCE_COST_UNSUPPORTED", `The source cost is unsupported.`, {status: 409});
}

function failUnavailable () {
	throw new HubStoreError("SOURCE_COST_UNAVAILABLE", `The source cost is unavailable.`, {status: 409});
}

function isPlainObject (value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys (value, allowed) {
	if (!isPlainObject(value) || Object.keys(value).some(key => !allowed.includes(key))) failUnsupported();
}

function normalizePositiveSafeInteger (value) {
	if (!Number.isSafeInteger(value) || value < 1) failUnsupported();
	return value;
}

function normalizeUuid (value) {
	if (typeof value !== "string" || !UUID_RE.test(value)) failUnsupported();
	return value.toLowerCase();
}

function normalizeResourceId (value) {
	if (typeof value !== "string") failUnsupported();
	const out = value.trim();
	// eslint-disable-next-line no-control-regex
	if (!out || out.length > 200 || /[\u0000-\u001f\u007f]/.test(out)) failUnsupported();
	return UUID_RE.test(out) ? out.toLowerCase() : out;
}

function normalizeContentRef (value) {
	assertExactKeys(value, ["uid", "brewBundleVersionId", "brewContentHash"]);
	const uid = typeof value.uid === "string" ? value.uid.trim().toLowerCase() : "";
	if (!uid || uid.length > 250 || !uid.includes("|")) failUnsupported();
	const out = {uid};
	if (value.brewBundleVersionId != null) out.brewBundleVersionId = normalizeUuid(value.brewBundleVersionId);
	if (value.brewContentHash != null) {
		if (typeof value.brewContentHash !== "string" || !SHA256_RE.test(value.brewContentHash)) failUnsupported();
		out.brewContentHash = value.brewContentHash.toLowerCase();
	}
	if ((out.brewBundleVersionId == null) !== (out.brewContentHash == null)) failUnsupported();
	return out;
}

function getContentUid (value) {
	if (typeof value?.uid === "string" && value.uid.trim()) return value.uid.trim().toLowerCase();
	const name = typeof value?.name === "string" ? value.name.trim() : "";
	const source = typeof value?.source === "string" ? value.source.trim() : "";
	return name && source ? `${name}|${source}`.toLowerCase() : "";
}

function getContentRef (value, wrapper = null) {
	const out = {uid: getContentUid(value)};
	const brewBundleVersionId = wrapper?.brewBundleVersionId ?? value?.brewBundleVersionId;
	const brewContentHash = wrapper?.brewContentHash ?? value?.brewContentHash;
	if (brewBundleVersionId != null) out.brewBundleVersionId = `${brewBundleVersionId}`.toLowerCase();
	if (brewContentHash != null) out.brewContentHash = `${brewContentHash}`.toLowerCase();
	return out;
}

function isSameContentRef (left, right) {
	return left.uid === right.uid
		&& (left.brewBundleVersionId ?? null) === (right.brewBundleVersionId ?? null)
		&& (left.brewContentHash ?? null) === (right.brewContentHash ?? null);
}

function getStoredResourceId (value) {
	const out = `${value ?? ""}`.trim();
	return UUID_RE.test(out) ? out.toLowerCase() : out;
}

function normalizeComponent (component) {
	if (!isPlainObject(component) || !SOURCE_COST_KINDS.includes(component.kind)) failUnsupported();
	switch (component.kind) {
		case "spell_slot": {
			assertExactKeys(component, ["kind", "pool", "level", "amount"]);
			if (!["standard", "pact"].includes(component.pool)) failUnsupported();
			if (!Number.isInteger(component.level) || component.level < 1 || component.level > 9) failUnsupported();
			return {
				kind: component.kind,
				pool: component.pool,
				level: component.level,
				amount: normalizePositiveSafeInteger(component.amount),
			};
		}
		case "item_charge":
		case "inventory_quantity":
			assertExactKeys(component, ["kind", "inventoryEntryId", "itemRef", "amount"]);
			return {
				kind: component.kind,
				inventoryEntryId: normalizeResourceId(component.inventoryEntryId),
				itemRef: normalizeContentRef(component.itemRef),
				amount: normalizePositiveSafeInteger(component.amount),
			};
		case "feature_use":
			assertExactKeys(component, ["kind", "resourceId", "featureRef", "amount"]);
			return {
				kind: component.kind,
				resourceId: normalizeResourceId(component.resourceId),
				featureRef: normalizeContentRef(component.featureRef),
				amount: normalizePositiveSafeInteger(component.amount),
			};
		default: failUnsupported();
	}
}

function getBindingIdentity (component) {
	switch (component.kind) {
		case "spell_slot": return `${component.kind}:${component.pool}:${component.pool === "pact" ? "pool" : component.level}`;
		case "item_charge":
		case "inventory_quantity": return `${component.kind}:${component.inventoryEntryId}`;
		case "feature_use": return `${component.kind}:${component.resourceId}`;
		default: failUnsupported();
	}
}

export function normalizeSourceCost (sourceCost) {
	assertExactKeys(sourceCost, ["version", "components"]);
	if (sourceCost.version !== SOURCE_COST_VERSION) failUnsupported();
	if (!Array.isArray(sourceCost.components) || !sourceCost.components.length || sourceCost.components.length > 8) failUnsupported();

	const byBinding = new Map();
	for (const raw of sourceCost.components) {
		const component = normalizeComponent(raw);
		const binding = getBindingIdentity(component);
		const existing = byBinding.get(binding);
		if (!existing) {
			byBinding.set(binding, component);
			continue;
		}
		const sameDescriptor = JSON.stringify({...existing, amount: 0}) === JSON.stringify({...component, amount: 0});
		if (!sameDescriptor || !Number.isSafeInteger(existing.amount + component.amount)) failUnsupported();
		existing.amount += component.amount;
	}

	return {
		version: SOURCE_COST_VERSION,
		components: [...byBinding.values()]
			.sort((left, right) => getBindingIdentity(left).localeCompare(getBindingIdentity(right))),
	};
}

function getIntegralPool ({current, max, level = null, expectedLevel = null}) {
	if (
		!Number.isSafeInteger(current)
		|| !Number.isSafeInteger(max)
		|| current < 0
		|| max < 0
		|| current > max
		|| (expectedLevel != null && level !== expectedLevel)
	) failUnavailable();
	return {current, max};
}

function findInventoryEntry ({data, component}) {
	const matches = Array.isArray(data?.inventory)
		? data.inventory.filter(it => getStoredResourceId(it?.id) === component.inventoryEntryId)
		: [];
	if (matches.length !== 1) failUnavailable();
	const [entry] = matches;
	if (!isSameContentRef(getContentRef(entry.item, entry), component.itemRef)) failUnavailable();
	return entry;
}

function getFeatureResourceBinding ({data, component}) {
	const resourceMatches = Array.isArray(data?.resources)
		? data.resources.filter(it => getStoredResourceId(it?.id) === component.resourceId)
		: [];
	if (resourceMatches.length !== 1) failUnavailable();
	const [resource] = resourceMatches;

	const featureMatches = (Array.isArray(data?.features) ? data.features : [])
		.filter(feature => resource.featureId != null
			? feature?.id === resource.featureId
			: resource.id != null && feature?.resourceId === resource.id,
		);
	if (featureMatches.length !== 1) failUnavailable();
	const [feature] = featureMatches;

	const content = resource.featureRef || resource.feature || feature;
	if (!isSameContentRef(getContentRef(content, resource), component.featureRef)) failUnavailable();
	const featureContentRef = getContentRef(feature);
	if (featureContentRef.uid && !isSameContentRef(featureContentRef, component.featureRef)) failUnavailable();

	const innateSpellMatches = (Array.isArray(data?.spellcasting?.innateSpells) ? data.spellcasting.innateSpells : [])
		.filter(spell => resource.linkedInnateSpellId != null
			? spell?.id === resource.linkedInnateSpellId
			: resource.id != null
				&& (spell?.resourceId === resource.id || spell?.linkedResourceId === resource.id),
		);
	if (innateSpellMatches.length > 1 || (resource.linkedInnateSpellId != null && innateSpellMatches.length !== 1)) {
		failUnavailable();
	}
	return {resource, feature, innateSpell: innateSpellMatches[0] || null};
}

function assertFeatureResourceMirrors ({resource, feature, innateSpell}) {
	const pool = getIntegralPool({current: resource.current, max: resource.max});
	const featurePool = getIntegralPool({current: feature?.uses?.current, max: feature?.uses?.max});
	if (featurePool.current !== pool.current || featurePool.max !== pool.max) failUnavailable();
	if (innateSpell) {
		const innatePool = getIntegralPool({current: innateSpell.uses?.current, max: innateSpell.uses?.max});
		if (innatePool.current !== pool.current || innatePool.max !== pool.max) failUnavailable();
	}
	return pool;
}

function hasUnsafeZeroQuantityLink ({data, entry}) {
	if (getWholeItemTransferBlockers({
		container: data,
		entry,
		fnNormalizeItemId: getStoredResourceId,
	}).length) return true;
	const harmlessKeys = new Set([
		"id",
		"item",
		"quantity",
		"note",
		"chargesUsed",
		"chargesCurrent",
		"equipped",
		"attuned",
	]);
	const isBenignDefault = value =>
		value == null
		|| value === false
		|| value === ""
		|| (Array.isArray(value) && !value.length)
		|| (isPlainObject(value) && !Object.keys(value).length);
	if (Object.entries(entry).some(([key, value]) => !harmlessKeys.has(key) && !isBenignDefault(value))) return true;
	const clone = structuredClone(data);
	clone.inventory = (Array.isArray(clone.inventory) ? clone.inventory : []).filter(it => it.id !== entry.id);
	const itemId = getStoredResourceId(entry.id);
	const hasNormalizedReference = value => {
		if (typeof value === "string") {
			return getStoredResourceId(value) === itemId
				|| (value.startsWith("item:") && getStoredResourceId(value.slice(5)) === itemId);
		}
		if (Array.isArray(value)) return value.some(hasNormalizedReference);
		if (isPlainObject(value)) return Object.values(value).some(hasNormalizedReference);
		return false;
	};
	return hasNormalizedReference(clone);
}

function resolveComponent ({data, component}) {
	switch (component.kind) {
		case "spell_slot": {
			const slot = component.pool === "standard"
				? data?.spellcasting?.spellSlots?.[component.level]
				: data?.spellcasting?.pactSlots;
			const pool = getIntegralPool({
				current: slot?.current,
				max: slot?.max,
				level: slot?.level,
				expectedLevel: component.pool === "pact" ? component.level : null,
			});
			if (pool.current < component.amount) failUnavailable();
			return {...pool, binding: getBindingIdentity(component)};
		}
		case "item_charge": {
			const entry = findInventoryEntry({data, component});
			const max = entry.item?.charges;
			const current = entry.item?.chargesCurrent ?? max;
			const pool = getIntegralPool({current, max});
			if (pool.current < component.amount) failUnavailable();
			return {...pool, binding: getBindingIdentity(component)};
		}
		case "inventory_quantity": {
			const entry = findInventoryEntry({data, component});
			const quantity = entry.quantity;
			if (!Number.isSafeInteger(quantity) || quantity < component.amount || quantity < 1) failUnavailable();
			if (quantity === component.amount && hasUnsafeZeroQuantityLink({data, entry})) failUnavailable();
			return {current: quantity, max: null, binding: getBindingIdentity(component)};
		}
		case "feature_use": {
			const binding = getFeatureResourceBinding({data, component});
			const pool = assertFeatureResourceMirrors(binding);
			if (pool.current < component.amount) failUnavailable();
			return {...pool, binding: getBindingIdentity(component)};
		}
		default: failUnsupported();
	}
}

export function resolveSourceCost ({data, sourceCost}) {
	const normalized = normalizeSourceCost(sourceCost);
	return {
		sourceCost: normalized,
		components: normalized.components.map(component => ({
			component: structuredClone(component),
			...resolveComponent({data, component}),
		})),
		footprint: getSourceCostMutationFootprint(normalized),
	};
}

export function getSourceCostMutationFootprint (sourceCost) {
	const normalized = normalizeSourceCost(sourceCost);
	return normalized.components.map(getBindingIdentity);
}

function getBindingSnapshot ({data, component}) {
	switch (component.kind) {
		case "spell_slot":
			return structuredClone(component.pool === "standard"
				? data?.spellcasting?.spellSlots?.[component.level] ?? null
				: data?.spellcasting?.pactSlots ?? null);
		case "item_charge":
		case "inventory_quantity": {
			const matches = Array.isArray(data?.inventory)
				? data.inventory.filter(it => getStoredResourceId(it?.id) === component.inventoryEntryId)
				: [];
			return structuredClone({matches});
		}
		case "feature_use": {
			const resources = Array.isArray(data?.resources)
				? data.resources.filter(it => getStoredResourceId(it?.id) === component.resourceId)
				: [];
			const features = (Array.isArray(data?.features) ? data.features : [])
				.filter(feature => resources.some(resource =>
					resource.featureId != null
						? feature?.id === resource.featureId
						: resource.id != null && feature?.resourceId === resource.id,
				));
			const innateSpells = (Array.isArray(data?.spellcasting?.innateSpells) ? data.spellcasting.innateSpells : [])
				.filter(spell => resources.some(resource =>
					resource.linkedInnateSpellId != null
						? spell?.id === resource.linkedInnateSpellId
						: resource.id != null
							&& (spell?.resourceId === resource.id || spell?.linkedResourceId === resource.id),
				));
			return structuredClone({resources, features, innateSpells});
		}
		default: failUnsupported();
	}
}

function getCanonicalJson (value) {
	if (Array.isArray(value)) return `[${value.map(getCanonicalJson).join(",")}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map(key => `${JSON.stringify(key)}:${getCanonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function hasSourceCostBindingChanged ({beforeData, afterData, sourceCost}) {
	const normalized = normalizeSourceCost(sourceCost);
	return normalized.components.some(component =>
		getCanonicalJson(getBindingSnapshot({data: beforeData, component})) !==
		getCanonicalJson(getBindingSnapshot({data: afterData, component})),
	);
}

export function applySourceCost ({data, sourceCost}) {
	const resolved = resolveSourceCost({data, sourceCost});
	const out = structuredClone(data);
	const emptiedInventoryEntries = [];
	for (const component of resolved.sourceCost.components) {
		switch (component.kind) {
			case "spell_slot": {
				const slot = component.pool === "standard"
					? out.spellcasting.spellSlots[component.level]
					: out.spellcasting.pactSlots;
				slot.current -= component.amount;
				break;
			}
			case "item_charge": {
				const entry = findInventoryEntry({data: out, component});
				const current = entry.item.chargesCurrent ?? entry.item.charges;
				entry.item.chargesCurrent = current - component.amount;
				break;
			}
			case "inventory_quantity": {
				const entry = findInventoryEntry({data: out, component});
				entry.quantity -= component.amount;
				if (!entry.quantity) emptiedInventoryEntries.push(entry);
				break;
			}
			case "feature_use": {
				const {resource, feature, innateSpell} = getFeatureResourceBinding({data: out, component});
				assertFeatureResourceMirrors({resource, feature, innateSpell});
				resource.current -= component.amount;
				feature.uses.current = resource.current;
				if (innateSpell) innateSpell.uses.current = resource.current;
				break;
			}
		}
	}
	for (const entry of emptiedInventoryEntries) out.inventory.splice(out.inventory.indexOf(entry), 1);
	return {
		data: out,
		changed: JSON.stringify(out) !== JSON.stringify(data),
		footprint: resolved.footprint,
	};
}
