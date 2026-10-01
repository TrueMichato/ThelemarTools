export const ENCOUNTER_DAMAGE_TYPES = Object.freeze([
	"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
	"piercing", "poison", "psychic", "radiant", "slashing", "thunder",
]);

export const ENCOUNTER_DAMAGE_SOURCES = Object.freeze([
	"unspecified", "nonmagicalAttack", "magicalAttack", "other",
]);

const DEFENSES = [["immune", "immunity"], ["resist", "resistance"], ["vulnerable", "vulnerability"]];

function isDamageTypeMentioned (text, damageType) {
	return new RegExp(`\\b${damageType}\\b`).test(text.trim().toLowerCase()) || /\ball damage\b/i.test(text);
}

function getMatchingEntry (entry, damageType, property) {
	if (typeof entry === "string") {
		const text = entry.trim().toLowerCase();
		if (text === damageType) return {matches: true, conditional: false, note: ""};
		return {
			matches: isDamageTypeMentioned(text, damageType),
			conditional: true,
			note: entry,
		};
	}
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		return {matches: true, conditional: true, note: "Unrecognized damage defense"};
	}
	if (typeof entry.special === "string") {
		return {matches: true, conditional: true, note: entry.special};
	}
	const values = entry[property];
	if (!Array.isArray(values)) return {matches: true, conditional: true, note: "Unrecognized damage defense"};
	const matches = values.some(value => typeof value !== "string" || isDamageTypeMentioned(value, damageType));
	return {
		matches,
		conditional: !!(entry.cond || entry.note || entry.preNote)
			|| values.some(value => typeof value !== "string"
				|| (value.trim().toLowerCase() !== damageType && isDamageTypeMentioned(value, damageType))),
		note: [entry.preNote, entry.note].filter(Boolean).join(" ").trim() || "Conditional damage defense",
	};
}

function getContextDecision (note, source) {
	if (!/^from nonmagical attacks$/i.test(note.trim())) return null;
	if (source === "nonmagicalAttack") return true;
	if (source === "magicalAttack" || source === "other") return false;
	return null;
}

export function getEncounterDamageForMonster ({monster, amount, damageType, source = "unspecified", decisions = {}}) {
	if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Enter a non-negative whole-number damage amount.");
	if (!ENCOUNTER_DAMAGE_TYPES.includes(damageType)) throw new Error("Choose a known damage type.");
	if (!ENCOUNTER_DAMAGE_SOURCES.includes(source)) throw new Error("Choose a known damage source.");
	if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) throw new Error("Damage defense decisions must be explicit.");
	const defenses = {immune: false, resist: false, vulnerable: false};
	const unresolved = [];
	for (const [property, label] of DEFENSES) {
		const entries = monster?.[property];
		if (entries == null) continue;
		if (!Array.isArray(entries)) throw new Error(`The monster has an unreadable damage ${label}.`);
		entries.forEach((entry, index) => {
			const {matches, conditional, note} = getMatchingEntry(entry, damageType, property);
			if (!matches) return;
			if (!conditional) {
				defenses[property] = true;
				return;
			}
			const key = `${property}:${index}`;
			const decided = Object.hasOwn(decisions, key)
				? decisions[key]
				: getContextDecision(note, source);
			if (decided == null) {
				unresolved.push({key, defense: label, note});
				return;
			}
			if (typeof decided !== "boolean") throw new Error("Choose whether each conditional damage defense applies.");
			if (decided) defenses[property] = true;
		});
	}
	if (unresolved.length) return {damage: null, defenses, unresolved};
	let damage = defenses.immune ? 0 : defenses.resist ? Math.floor(amount / 2) : amount;
	if (!defenses.immune && defenses.vulnerable) {
		if (damage > Number.MAX_SAFE_INTEGER / 2) throw new Error("The adjusted damage exceeds the supported range.");
		damage *= 2;
	}
	return {damage, defenses, unresolved};
}
