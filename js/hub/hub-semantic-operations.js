import {HubStoreError} from "./hub-store-error.js";
import {getHealedHp, resolveApplicableMaxHp} from "./hub-semantic-hp.js";

// The pure, versioned semantic-operation catalog from ADR 0012. Shared verbatim between the Hub server
// (`server/src/hub-actions.js` re-exports these) and the Character Sheet, so damage/heal/condition/spell-slot
// formulas are never duplicated across the wire. Every function here is deterministic and side-effect free for a
// given validated character document plus normalized operation.
export const SEMANTIC_OPERATION_VERSION = 1;
export const SEMANTIC_OPERATION_KINDS = Object.freeze([
	"hp.damage",
	"hp.heal",
	"condition.add",
	"condition.remove",
	"spell_slot.spend",
	"spell_slot.restore",
]);

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

// Conditions are stored by the Character Sheet as either `{name, source}` or a legacy bare string; both must
// resolve to the same identity so a server-applied condition dedupes against a locally-stored legacy one.
export function getConditionIdentity (value) {
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
 * A document that cannot supply a positive maximum is malformed, not "capped at zero". Failing here keeps the
 * operation atomic — nothing is written, no event is emitted, and the character's revision is unchanged —
 * instead of silently converting healing into damage.
 *
 * Uses its own code rather than the shared `OPERATION_STATE_INVALID`, which spell-slot operations also raise, so
 * the client can name the actual remedy without mislabelling a slot failure.
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
			// Result is bounded by `max(current, applicableMax)` — both already validated as safe numbers — so
			// the intermediate sum can never escape the safe range.
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
