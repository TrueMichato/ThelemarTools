import crypto from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {getInventoryTransferEligibility} from "../../js/hub/hub-inventory-contract.js";
import {getHealedHp, resolveApplicableMaxHp} from "../../js/hub/hub-semantic-hp.js";
import {HubStoreError} from "./hub-store-error.js";

// The versioned semantic-operation catalog lives in `js/hub/` so the Character Sheet can apply the exact same
// pure operation locally for ADR 0012's `R = E(B)` / `F = E(L)` transition instead of duplicating the formulas.
// Re-exported here so existing server import sites keep working unchanged.
export {
	applySemanticOperation,
	getConditionIdentity,
	normalizeSemanticOperation,
	SEMANTIC_OPERATION_KINDS,
	SEMANTIC_OPERATION_VERSION,
} from "../../js/hub/hub-semantic-operations.js";

export const CURRENCY_TYPES = Object.freeze(["cp", "sp", "ep", "gp", "pp"]);
export const SAFE_ITEM_SUMMARY_FIELDS = Object.freeze([
	"name",
	"source",
	"page",
	"rarity",
	"weight",
	"value",
	"typeCode",
	"edition",
]);
export const ITEM_AWARD_SOURCE_KINDS = Object.freeze(["catalog", "recent", "campaign_item", "party_inventory"]);
export const STRUCTURED_EFFECT_TYPES = Object.freeze([
	"damage",
	"healing",
	"condition_add",
	"condition_remove",
	"spell_slot_spend",
	"informational",
]);

function getFiniteNumber (value, {label, fallback = 0, minimum = 0, isInteger = false}) {
	if (value == null || value === "") return fallback;
	const number = Number(value);
	if (
		!Number.isFinite(number)
		|| number < minimum
		|| Math.abs(number) > Number.MAX_SAFE_INTEGER
		|| (isInteger && !Number.isSafeInteger(number))
	) throw new HubStoreError("NUMERIC_INVALID", `${label} must be a finite safe${isInteger ? " integer" : " number"}.`);
	return number;
}

function throwItemAwardInvalid (message) {
	throw new HubStoreError("ITEM_AWARD_INVALID", message);
}

function isPlainObject (value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.prototype.toString.call(value) === "[object Object]";
}

function assertExactKeys (value, allowedKeys, label) {
	if (!isPlainObject(value)) throwItemAwardInvalid(`${label} must be an object.`);
	const unknownKey = Object.keys(value).find(key => !allowedKeys.includes(key));
	if (unknownKey) throwItemAwardInvalid(`${label} contains an unsupported field.`);
}

function normalizeSafeItemString (value, {label, maxLength, isRequired = false}) {
	if (value == null && !isRequired) return null;
	if (typeof value !== "string" || value.length > maxLength) {
		throwItemAwardInvalid(`${label} must be a string of at most ${maxLength} characters.`);
	}
	const normalized = value.trim();
	if (isRequired && !normalized) throwItemAwardInvalid(`${label} is required.`);
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(normalized)
		|| /<\/?[a-z][^>]*>/i.test(normalized)
		|| /\bon\w+\s*=/i.test(normalized)
		|| /(?:^|\|)(?:javascript|data|vbscript|file):/i.test(normalized.replace(/\s+/g, ""))) {
		throwItemAwardInvalid(`${label} contains unsafe text.`);
	}
	return normalized;
}

function normalizeSafeItemNumber (value, {label, isInteger = false}) {
	if (value == null) return null;
	if (
		typeof value !== "number"
		|| !Number.isFinite(value)
		|| value < 0
		|| Math.abs(value) > Number.MAX_SAFE_INTEGER
		|| (isInteger && !Number.isSafeInteger(value))
	) throwItemAwardInvalid(`${label} must be a finite nonnegative safe${isInteger ? " integer" : " number"}.`);
	return value;
}

export function normalizeSafeItemSummary (item) {
	assertExactKeys(item, SAFE_ITEM_SUMMARY_FIELDS, "Item");
	const out = {
		name: normalizeSafeItemString(item.name, {label: "Item name", maxLength: 200, isRequired: true}),
		source: normalizeSafeItemString(item.source, {label: "Item source", maxLength: 50, isRequired: true}),
	};
	const optional = {
		page: normalizeSafeItemNumber(item.page, {label: "Item page", isInteger: true}),
		rarity: normalizeSafeItemString(item.rarity, {label: "Item rarity", maxLength: 80}),
		weight: normalizeSafeItemNumber(item.weight, {label: "Item weight"}),
		value: normalizeSafeItemNumber(item.value, {label: "Item value"}),
		typeCode: normalizeSafeItemString(item.typeCode, {label: "Item type code", maxLength: 80}),
	};
	for (const [key, value] of Object.entries(optional)) if (value != null) out[key] = value;
	if (item.edition != null) {
		if (!["classic", "one"].includes(item.edition)) throwItemAwardInvalid(`Item edition is unsupported.`);
		out.edition = item.edition;
	}
	return out;
}

export function getSafeItemSummary (item) {
	if (!isPlainObject(item)) throwItemAwardInvalid(`Item must be an object.`);
	return normalizeSafeItemSummary(Object.fromEntries(
		SAFE_ITEM_SUMMARY_FIELDS
			.filter(key => Object.hasOwn(item, key))
			.map(key => [key, item[key]]),
	));
}

export function normalizeItemAwardQuantity (quantity) {
	if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
		throwItemAwardInvalid(`Award quantity must be an integer between 1 and 100000.`);
	}
	return quantity;
}

export function normalizeItemAwardRequest ({source, targetCharacterIds, quantity, note = null}) {
	assertExactKeys(source, ["kind", "item", "entryId"], "Award source");
	if (!ITEM_AWARD_SOURCE_KINDS.includes(source.kind)) throwItemAwardInvalid(`Award source kind is unsupported.`);
	let normalizedSource;
	if (source.kind === "party_inventory") {
		assertExactKeys(source, ["kind", "entryId"], "Party-inventory award source");
		if (typeof source.entryId !== "string" || !source.entryId || source.entryId.length > 200) {
			throwItemAwardInvalid(`Party-inventory entry ID is required.`);
		}
		normalizedSource = {kind: source.kind, entryId: source.entryId};
	} else {
		assertExactKeys(source, ["kind", "item"], "Catalog award source");
		normalizedSource = {kind: source.kind, item: normalizeSafeItemSummary(source.item)};
	}
	if (!Array.isArray(targetCharacterIds) || !targetCharacterIds.length || targetCharacterIds.length > 50) {
		throwItemAwardInvalid(`Award targets must contain between 1 and 50 characters.`);
	}
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	if (targetCharacterIds.some(id => typeof id !== "string" || !uuidPattern.test(id))) {
		throwItemAwardInvalid(`Award targets must be valid character IDs.`);
	}
	if (new Set(targetCharacterIds).size !== targetCharacterIds.length) {
		throwItemAwardInvalid(`Award targets must be unique.`);
	}
	normalizeItemAwardQuantity(quantity);
	if (note != null && (typeof note !== "string" || note.length > 500)) {
		throwItemAwardInvalid(`Award note must be null or a string of at most 500 characters.`);
	}
	return {
		source: normalizedSource,
		targetCharacterIds: [...targetCharacterIds],
		quantity,
		note,
	};
}

export function getItemAwardTotalQuantity ({quantity, targetCount}) {
	const total = quantity * targetCount;
	if (!Number.isSafeInteger(total)) throwItemAwardInvalid(`Total award quantity exceeds the safe numeric range.`);
	return total;
}

export function getItemAwardIdempotencyKey ({idempotencyKey, campaignId, request}) {
	if (idempotencyKey && typeof idempotencyKey === "object") return idempotencyKey;
	const key = `${idempotencyKey}`;
	return {
		key,
		requestHash: crypto.createHash("sha256")
			.update(JSON.stringify({campaignId, ...request}))
			.digest("hex"),
	};
}

function addFinite (a, b, label) {
	const out = a + b;
	if (!Number.isFinite(out) || Math.abs(out) > Number.MAX_SAFE_INTEGER) throw new HubStoreError("NUMERIC_INVALID", `${label} exceeds the safe numeric range.`);
	return out;
}

export function normalizeCurrency (currency = {}) {
	return Object.fromEntries(CURRENCY_TYPES.map(type => [
		type,
		getFiniteNumber(currency[type], {label: `${type} amount`, fallback: 0, minimum: 0, isInteger: true}),
	]));
}

export function normalizeInventory (inventory = []) {
	if (!Array.isArray(inventory)) return [];
	return inventory.map(entry => ({
		...structuredClone(entry),
		id: entry.id || crypto.randomUUID(),
		quantity: getFiniteNumber(entry.quantity, {label: "Item quantity", fallback: 1, minimum: Number.MIN_VALUE}),
	}));
}

export function normalizeCharacterInventory (data) {
	const out = structuredClone(data);
	out.inventory = normalizeInventory(out.inventory);
	out.currency = normalizeCurrency(out.currency);
	return out;
}

function getHp (data) {
	data.hp ||= {};
	data.hp.max = Math.max(0, Number(data.hp.max) || 0);
	data.hp.current = Math.max(0, Number(data.hp.current) || 0);
	data.hp.temp = Math.max(0, Number(data.hp.temp) || 0);
	return data.hp;
}

export function applyStructuredEffect ({data, effect}) {
	if (!STRUCTURED_EFFECT_TYPES.includes(effect?.type)) throw new HubStoreError("ACTION_INVALID", `Unsupported structured effect.`);
	const out = structuredClone(data);
	switch (effect.type) {
		case "damage": {
			const amount = getFiniteNumber(effect.amount, {label: "Damage amount"});
			const hp = getHp(out);
			const absorbed = Math.min(hp.temp, amount);
			hp.temp -= absorbed;
			hp.current = Math.max(0, hp.current - (amount - absorbed));
			break;
		}
		case "healing": {
			const amount = getFiniteNumber(effect.amount, {label: "Healing amount"});
			const hp = getHp(out);
			// Same applicable-maximum rule as the semantic `hp.heal` operation, so the legacy
			// structured-effect path cannot clamp a heal down to zero hit points either.
			const applicableMax = resolveApplicableMaxHp(hp);
			if (applicableMax == null) throw new HubStoreError("HP_MAX_UNAVAILABLE", `Character hit points are missing a usable maximum.`, {status: 409});
			hp.current = getHealedHp({current: hp.current, amount, applicableMax});
			break;
		}
		case "condition_add": {
			if (typeof effect.condition !== "string" || !effect.condition.trim()) throw new HubStoreError("ACTION_INVALID", `Condition is required.`);
			out.conditions ||= [];
			if (!out.conditions.some(it => (typeof it === "string" ? it : it.name)?.toLowerCase() === effect.condition.toLowerCase())) {
				out.conditions.push({name: effect.condition, source: effect.source || null});
			}
			break;
		}
		case "condition_remove":
			out.conditions = (out.conditions || []).filter(it => (typeof it === "string" ? it : it.name)?.toLowerCase() !== `${effect.condition || ""}`.toLowerCase());
			break;
		case "spell_slot_spend": {
			const level = getFiniteNumber(effect.level, {label: "Spell-slot level", minimum: 0, isInteger: true});
			const amount = getFiniteNumber(effect.amount, {label: "Spell-slot amount", fallback: 1, minimum: 1, isInteger: true});
			const slot = out.spellcasting?.spellSlots?.[level];
			if (!slot || slot.current < amount) throw new HubStoreError("RESOURCE_INSUFFICIENT", `Not enough spell slots.`);
			slot.current -= amount;
			break;
		}
		case "informational": break;
	}
	return out;
}

function getComparableInventoryEntry (entry) {
	const out = structuredClone(entry);
	delete out.id;
	delete out.quantity;
	delete out._sourceIndex;
	for (const key of ["equipped", "attuned", "starred"]) {
		if (!out[key]) delete out[key];
	}
	return out;
}

function getDestinationInventoryEntry (entry) {
	const out = structuredClone(entry);
	delete out._sourceIndex;
	out.equipped = false;
	out.attuned = false;
	out.starred = false;
	return out;
}

function addDestinationInventoryEntry ({inventory, incoming}) {
	const entry = getDestinationInventoryEntry(incoming);
	const existing = inventory.find(it => isDeepStrictEqual(getComparableInventoryEntry(it), getComparableInventoryEntry(entry)));
	if (existing) {
		existing.quantity = addFinite(existing.quantity, incoming.quantity, "Item quantity");
		return existing;
	}
	const created = {...entry, id: crypto.randomUUID()};
	inventory.push(created);
	return created;
}

export function addAwardedEntryToCharacter ({container, incoming}) {
	const out = normalizeCharacterInventory(container);
	const normalizedIncoming = structuredClone(incoming);
	normalizedIncoming.quantity = normalizeItemAwardQuantity(normalizedIncoming.quantity);
	const entry = addDestinationInventoryEntry({
		inventory: out.inventory,
		incoming: normalizedIncoming,
	});
	return {container: out, entry: structuredClone(entry)};
}

export function addAwardedItemToCharacter ({container, item, quantity}) {
	return addAwardedEntryToCharacter({
		container,
		incoming: {item: normalizeSafeItemSummary(item), quantity},
	});
}

export function removeTransferPayload ({container, payload}) {
	const out = structuredClone(container);
	out.inventory = normalizeInventory(out.inventory);
	out.currency = normalizeCurrency(out.currency);
	const sourceIndexes = new Map(out.inventory.map((entry, index) => [entry.id, index]));
	const escrowItems = [];
	for (const requested of payload.items || []) {
		const entry = out.inventory.find(it => it.id === requested.entryId);
		const quantity = getFiniteNumber(requested.quantity, {label: "Transfer quantity", minimum: 1, isInteger: true});
		if (!entry || quantity <= 0 || entry.quantity < quantity) {
			throw new HubStoreError("TRANSFER_INSUFFICIENT", `Inventory entry is unavailable.`, {status: 409});
		}
		const eligibility = getInventoryTransferEligibility({container: out, entry, quantity});
		if (!eligibility.isEligible) {
			throw new HubStoreError(
				"TRANSFER_ITEM_LINKED",
				`Unequip, unattune, and detach this item before transferring it: ${eligibility.blockers.join(", ")}.`,
				{status: 409, details: {entryId: entry.id, blockers: eligibility.blockers}},
			);
		}
		escrowItems.push({...structuredClone(entry), quantity, _sourceIndex: sourceIndexes.get(entry.id)});
		entry.quantity -= quantity;
		if (!entry.quantity) out.inventory.splice(out.inventory.indexOf(entry), 1);
	}
	const escrowCurrency = normalizeCurrency(payload.currency);
	if (!escrowItems.length && !CURRENCY_TYPES.some(type => escrowCurrency[type] > 0)) {
		throw new HubStoreError("TRANSFER_EMPTY", `Transfer must contain an item or positive currency amount.`);
	}
	for (const type of CURRENCY_TYPES) {
		if (out.currency[type] < escrowCurrency[type]) throw new HubStoreError("TRANSFER_INSUFFICIENT", `Insufficient ${type}.`, {status: 409});
		out.currency[type] -= escrowCurrency[type];
	}
	return {container: out, escrow: {items: escrowItems, currency: escrowCurrency}};
}

export function addTransferPayload ({container, escrow, isRestore = false}) {
	const out = structuredClone(container);
	out.inventory = normalizeInventory(out.inventory);
	out.currency = normalizeCurrency(out.currency);
	const incomingItems = isRestore
		? [...(escrow.items || [])].sort((a, b) => (a._sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b._sourceIndex ?? Number.MAX_SAFE_INTEGER))
		: escrow.items || [];
	for (const incoming of incomingItems) {
		if (!isRestore) {
			addDestinationInventoryEntry({inventory: out.inventory, incoming});
			continue;
		}
		const entry = structuredClone(incoming);
		delete entry._sourceIndex;
		const existing = out.inventory.find(it => it.id === entry.id);
		if (existing) existing.quantity = addFinite(existing.quantity, incoming.quantity, "Item quantity");
		else out.inventory.splice(Math.min(incoming._sourceIndex ?? out.inventory.length, out.inventory.length), 0, entry);
	}
	const currency = normalizeCurrency(escrow.currency);
	for (const type of CURRENCY_TYPES) out.currency[type] = addFinite(out.currency[type], currency[type], `${type} amount`);
	return out;
}
