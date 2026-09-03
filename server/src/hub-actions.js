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
		const entry = isRestore ? structuredClone(incoming) : getDestinationInventoryEntry(incoming);
		delete entry._sourceIndex;
		const existing = isRestore
			? out.inventory.find(it => it.id === entry.id)
			: out.inventory.find(it => isDeepStrictEqual(getComparableInventoryEntry(it), getComparableInventoryEntry(entry)));
		if (existing) existing.quantity = addFinite(existing.quantity, incoming.quantity, "Item quantity");
		else if (isRestore) out.inventory.splice(Math.min(incoming._sourceIndex ?? out.inventory.length, out.inventory.length), 0, entry);
		else out.inventory.push({...entry, id: crypto.randomUUID()});
	}
	const currency = normalizeCurrency(escrow.currency);
	for (const type of CURRENCY_TYPES) out.currency[type] = addFinite(out.currency[type], currency[type], `${type} amount`);
	return out;
}
