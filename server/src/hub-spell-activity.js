import {HubStoreError} from "./hub-store-error.js";

const SPELL_USE_MODES = new Set(["cantrip", "ritual", "spell_slot", "pact_slot", "resource", "free"]);
const SPELL_ACTIVITY_KEYS = new Set(["type", "spellName", "spellSource", "spellLevel", "slotLevel", "mode"]);

function cleanText (value, maxLength) {
	if (typeof value !== "string") return "";
	return value
		.replace(/<[^>]*>/g, "")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function invalidActivity () {
	return new HubStoreError("INVALID_CHARACTER_ACTIVITY", "Character activity is invalid.", {status: 400});
}

export function normalizeCharacterPatchActivity (activity) {
	if (activity == null) return null;
	if (!activity || typeof activity !== "object" || Array.isArray(activity)) throw invalidActivity();
	if (Object.keys(activity).some(key => !SPELL_ACTIVITY_KEYS.has(key))) throw invalidActivity();
	if (activity.type !== "spell.used") throw invalidActivity();
	const spellName = cleanText(activity.spellName, 100);
	const spellSource = cleanText(activity.spellSource, 20);
	if (!spellName || !spellSource) throw invalidActivity();
	if (!Number.isInteger(activity.spellLevel) || activity.spellLevel < 0 || activity.spellLevel > 9) throw invalidActivity();
	if (!Number.isInteger(activity.slotLevel) || activity.slotLevel < 0 || activity.slotLevel > 9) throw invalidActivity();
	if (!SPELL_USE_MODES.has(activity.mode)) throw invalidActivity();
	return {
		type: "spell.used",
		spellName,
		spellSource,
		spellLevel: activity.spellLevel,
		slotLevel: activity.slotLevel,
		mode: activity.mode,
	};
}
