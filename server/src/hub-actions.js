import crypto from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {getHealedHp, resolveApplicableMaxHp} from "../../js/hub/hub-semantic-hp.js";
import {HubStoreError} from "./hub-store-error.js";

export const CURRENCY_TYPES = Object.freeze(["cp", "sp", "ep", "gp", "pp"]);
export const STRUCTURED_EFFECT_TYPES = Object.freeze([
	"damage",
	"healing",
	"condition_add",
	"condition_remove",
	"spell_slot_spend",
	"informational",
]);

export const SEMANTIC_OPERATION_VERSION = 1;
export const SEMANTIC_OPERATION_KINDS = Object.freeze([
	"hp.damage",
	"hp.heal",
	"condition.add",
	"condition.remove",
	"spell_slot.spend",
	"spell_slot.restore",
]);

function getFiniteNumber (value, {label, fallback = 0, minimum = 0, isInteger = false}) {
	if (value == null || value === "") return fallback;
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new HubStoreError("NUMERIC_INVALID", `${label} must be a finite safe number.`);
	return isInteger ? Math.floor(number) : number;
}

function addFinite (a, b, label) {
	const out = a + b;
	if (!Number.isFinite(out) || Math.abs(out) > Number.MAX_SAFE_INTEGER) throw new HubStoreError("NUMERIC_INVALID", `${label} exceeds the safe numeric range.`);
	return out;
}

function getPositiveFiniteNumber (value, label, {isInteger = false} = {}) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || Math.abs(number) > Number.MAX_SAFE_INTEGER) {
		throw new HubStoreError("OPERATION_INVALID", `${label} must be a positive finite safe number.`);
	}
	if (isInteger && !Number.isInteger(number)) {
		throw new HubStoreError("OPERATION_INVALID", `${label} must be an integer.`);
	}
	return number;
}

function getSlotLevel (value) {
	const level = Number(value);
	if (!Number.isInteger(level) || level < 1 || level > 9) {
		throw new HubStoreError("OPERATION_INVALID", `Spell-slot level must be an integer from 1 through 9.`);
	}
	return level;
}

function normalizeConditionReference (value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new HubStoreError("OPERATION_INVALID", `Condition reference is required.`);
	}
	const unknown = Object.keys(value).filter(key => !["name", "source"].includes(key));
	if (unknown.length) throw new HubStoreError("OPERATION_INVALID", `Condition reference contains unsupported fields.`);
	const name = typeof value.name === "string" ? value.name.trim() : "";
	const source = typeof value.source === "string" ? value.source.trim() : "";
	if (!name || name.length > 100 || !source || source.length > 30) {
		throw new HubStoreError("OPERATION_INVALID", `Condition reference is invalid.`);
	}
	return {name, source};
}

function getConditionIdentity (value) {
	const name = typeof value === "string" ? value : value?.name;
	const source = typeof value === "object" && value ? value.source || "XPHB" : "XPHB";
	return `${String(name || "").trim().toLowerCase()}|${String(source || "").trim().toLowerCase()}`;
}

function assertOperationArguments (value, allowedKeys) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new HubStoreError("OPERATION_INVALID", `Operation arguments are required.`);
	}
	if (Object.keys(value).some(key => !allowedKeys.includes(key))) {
		throw new HubStoreError("OPERATION_INVALID", `Operation arguments contain unsupported fields.`);
	}
}

export function normalizeSemanticOperation ({operationId = null, targetCharacterId, kind, version, arguments: rawArguments}) {
	if (!SEMANTIC_OPERATION_KINDS.includes(kind)) {
		throw new HubStoreError("OPERATION_INVALID", `Unsupported semantic operation.`);
	}
	if (version !== SEMANTIC_OPERATION_VERSION) {
		throw new HubStoreError("OPERATION_VERSION_UNSUPPORTED", `Unsupported semantic operation version.`, {status: 409});
	}
	let args;
	switch (kind) {
		case "hp.damage":
		case "hp.heal":
			assertOperationArguments(rawArguments, ["amount"]);
			args = {amount: getPositiveFiniteNumber(rawArguments.amount, "Hit-point amount")};
			break;
		case "condition.add":
		case "condition.remove":
			assertOperationArguments(rawArguments, ["condition"]);
			args = {condition: normalizeConditionReference(rawArguments.condition)};
			break;
		case "spell_slot.spend":
		case "spell_slot.restore":
			assertOperationArguments(rawArguments, ["level", "amount"]);
			args = {
				level: getSlotLevel(rawArguments.level),
				amount: getPositiveFiniteNumber(rawArguments.amount, "Spell-slot amount", {isInteger: true}),
			};
			break;
	}
	return {
		...(operationId == null ? {} : {operationId}),
		kind,
		version,
		targetCharacterId,
		arguments: args,
	};
}

function getSemanticHp (data) {
	const hp = data?.hp;
	if (!hp || typeof hp !== "object" || Array.isArray(hp)) {
		throw new HubStoreError("OPERATION_STATE_INVALID", `Character hit points are unavailable.`, {status: 409});
	}
	// Preserves every other key — notably `effectiveMax`, which operations must carry through
	// byte-for-byte and must never derive or recompute.
	const out = structuredClone(hp);
	for (const key of ["current", "max", "temp"]) {
		const fallback = key === "temp" && hp[key] == null ? 0 : hp[key];
		const value = Number(fallback);
		if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
			throw new HubStoreError("OPERATION_STATE_INVALID", `Character hit points are invalid.`, {status: 409});
		}
		out[key] = value;
	}
	return out;
}

/**
 * The maximum a heal clamps against, or a visible failure.
 *
 * A document that cannot supply a positive maximum is malformed, not "capped at zero". Failing
 * here keeps the operation atomic — nothing is written, no event is emitted, and the character's
 * revision is unchanged — instead of silently converting healing into damage.
 *
 * Uses its own code rather than the shared `OPERATION_STATE_INVALID`, which spell-slot operations
 * also raise, so the client can name the actual remedy without mislabelling a slot failure.
 */
function getApplicableMaxHp (hp) {
	const applicableMax = resolveApplicableMaxHp(hp);
	if (applicableMax == null) {
		throw new HubStoreError(
			"HP_MAX_UNAVAILABLE",
			`Character hit points are missing a usable maximum.`,
			{status: 409},
		);
	}
	return applicableMax;
}

export function applySemanticOperation ({data, operation}) {
	const normalized = normalizeSemanticOperation(operation);
	const out = structuredClone(data);
	switch (normalized.kind) {
		case "hp.damage": {
			const hp = getSemanticHp(out);
			const absorbed = Math.min(hp.temp, normalized.arguments.amount);
			hp.temp -= absorbed;
			hp.current = Math.max(0, hp.current - (normalized.arguments.amount - absorbed));
			out.hp = hp;
			break;
		}
		case "hp.heal": {
			const hp = getSemanticHp(out);
			// Result is bounded by `max(current, applicableMax)` — both already validated as safe
			// numbers — so the intermediate sum can never escape the safe range.
			hp.current = getHealedHp({
				current: hp.current,
				amount: normalized.arguments.amount,
				applicableMax: getApplicableMaxHp(hp),
			});
			out.hp = hp;
			break;
		}
		case "condition.add": {
			if (!Array.isArray(out.conditions)) out.conditions = [];
			const identity = getConditionIdentity(normalized.arguments.condition);
			if (!out.conditions.some(condition => getConditionIdentity(condition) === identity)) {
				out.conditions.push(structuredClone(normalized.arguments.condition));
			}
			break;
		}
		case "condition.remove": {
			const identity = getConditionIdentity(normalized.arguments.condition);
			out.conditions = (Array.isArray(out.conditions) ? out.conditions : [])
				.filter(condition => getConditionIdentity(condition) !== identity);
			break;
		}
		case "spell_slot.spend":
		case "spell_slot.restore": {
			const slot = out.spellcasting?.spellSlots?.[normalized.arguments.level];
			const current = Number(slot?.current);
			const max = Number(slot?.max);
			if (!slot || !Number.isInteger(current) || !Number.isInteger(max) || current < 0 || max < 0 || current > max) {
				throw new HubStoreError("OPERATION_STATE_INVALID", `Spell-slot state is unavailable.`, {status: 409});
			}
			if (normalized.kind === "spell_slot.spend") {
				if (current < normalized.arguments.amount) {
					throw new HubStoreError("RESOURCE_INSUFFICIENT", `Not enough spell slots.`, {status: 409});
				}
				slot.current = current - normalized.arguments.amount;
			} else {
				slot.current = Math.min(max, current + normalized.arguments.amount);
			}
			break;
		}
	}
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
		quantity: getFiniteNumber(entry.quantity, {label: "Item quantity", fallback: 1, minimum: Number.EPSILON}),
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

function hasItemReference (value, itemId) {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(it => hasItemReference(it, itemId));
	for (const [key, child] of Object.entries(value)) {
		if (["inventoryItemId", "weaponId", "itemId", "ammoId"].includes(key) && child === itemId) return true;
		if (hasItemReference(child, itemId)) return true;
	}
	return false;
}

function getWholeItemTransferBlockers ({container, entry}) {
	const itemId = entry.id;
	const sourceFeatureId = `item:${itemId}`;
	const blockers = [];
	if (entry.equipped) blockers.push("equipped");
	if (entry.attuned) blockers.push("attuned");
	if (entry.item?.containedItems?.length) blockers.push("contains items");
	if ((container.inventory || []).some(it => it.id !== itemId && it.item?.containedItems?.includes(itemId))) blockers.push("inside a container");
	if (entry.item?.iounSet?.length) blockers.push("hosts Ioun items");
	if ((container.inventory || []).some(it => it.id !== itemId && it.item?.iounSet?.includes(itemId))) blockers.push("seated in an Ioun host");
	if (container.selectedAmmo?.[itemId] || Object.values(container.selectedAmmo || {}).includes(itemId)) blockers.push("selected ammunition");
	if (Object.hasOwn(container.ammunitionConsumed || {}, itemId)) blockers.push("tracked ammunition");
	if ((container.namedModifiers || []).some(it => it.sourceFeatureId === sourceFeatureId)) blockers.push("item effects");
	if ((container.acFormulas || []).some(it => it.sourceFeatureId === sourceFeatureId)) blockers.push("AC effects");
	if (Object.values(container.grantedDefensiveTraits || {}).some(byName =>
		Object.values(byName || {}).some(sourceIds => Array.isArray(sourceIds) && sourceIds.includes(sourceFeatureId)),
	)) blockers.push("defensive effects");
	if (hasItemReference(container.activeStates, itemId)) blockers.push("active state");
	return [...new Set(blockers)];
}

export function removeTransferPayload ({container, payload}) {
	const out = structuredClone(container);
	out.inventory = normalizeInventory(out.inventory);
	out.currency = normalizeCurrency(out.currency);
	const escrowItems = [];
	for (const requested of payload.items || []) {
		const entry = out.inventory.find(it => it.id === requested.entryId);
		const quantity = getFiniteNumber(requested.quantity, {label: "Transfer quantity", minimum: Number.EPSILON});
		if (!entry || quantity <= 0 || entry.quantity < quantity) {
			throw new HubStoreError("TRANSFER_INSUFFICIENT", `Inventory entry is unavailable.`, {status: 409});
		}
		const isWholeItem = entry.quantity === quantity;
		if (isWholeItem) {
			const blockers = getWholeItemTransferBlockers({container: out, entry});
			if (blockers.length) {
				throw new HubStoreError(
					"TRANSFER_ITEM_LINKED",
					`Unequip, unattune, and detach this item before transferring it: ${blockers.join(", ")}.`,
					{status: 409, details: {entryId: entry.id, blockers}},
				);
			}
		}
		escrowItems.push({...structuredClone(entry), quantity, _sourceIndex: out.inventory.indexOf(entry)});
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
	for (const incoming of escrow.items || []) {
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
