import {isTransformationEntry, isTransformationSpell} from "../creature-transformation-entries.js";

const DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const SECTIONS = new Set(["trait", "action", "bonus", "reaction", "legendary"]);
const ROLES = new Set(["breathWeapon", "bite", "healingTouch", "angelicWeapons"]);
const SENSES = new Set(["darkvision", "blindsight", "tremorsense", "truesight"]);
const SPEEDS = new Set(["walk", "fly", "swim", "climb", "burrow"]);
const CREATURE_TYPES = new Set(["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"]);
const CONDITIONS = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);

function expect (condition, message) {
	if (!condition) throw new Error(`Unsupported catalog transformation step: ${message}.`);
}

function isRecord (value) {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function keysAre (value, keys) {
	return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isString (value) {
	return typeof value === "string" && !!value.trim();
}

function isEntry (entry) {
	return isTransformationEntry(entry);
}

function isMatch (match) {
	return (keysAre(match, ["name", "source"]) && isString(match.name) && isString(match.source))
		|| (keysAre(match, ["role", "source"]) && ROLES.has(match.role) && isString(match.source));
}

function validateStep (step) {
	const {op} = step || {};
	switch (op) {
		case "setType":
			return keysAre(step, ["op", "value"]) && CREATURE_TYPES.has(step.value);
		case "setSize":
			return keysAre(step, ["op", "value"]) && ["T", "S", "M", "L", "H", "G"].includes(step.value);
		case "setAbility":
		case "minimumAbility":
		case "maximumAbility":
			return keysAre(step, ["op", "ability", "value"]) && ABILITIES.has(step.ability)
				&& Number.isInteger(step.value) && step.value >= 1 && step.value <= 30;
		case "adjustAbility":
			return keysAre(step, ["op", "ability", "amount", "floor"]) && ABILITIES.has(step.ability)
				&& Number.isInteger(step.amount) && step.amount >= -30 && step.amount <= 30 && step.floor === 1;
		case "scaleAbility":
			return keysAre(step, ["op", "ability", "factor", "round", "floor"]) && ABILITIES.has(step.ability)
				&& step.factor === 0.5 && step.round === "down" && step.floor === 1;
		case "grantResistance":
		case "grantImmunity":
		case "grantVulnerability":
			return keysAre(step, ["op", "value"]) && DAMAGE_TYPES.has(step.value);
		case "grantConditionImmunity":
			return keysAre(step, ["op", "value"]) && CONDITIONS.has(step.value);
		case "grantLanguage":
			return keysAre(step, ["op", "value"]) && isString(step.value);
		case "grantSpell":
			return isTransformationSpell(step);
		case "grantSense":
			return keysAre(step, ["op", "sense", "range"]) && SENSES.has(step.sense)
				&& Number.isInteger(step.range) && step.range > 0;
		case "grantSpeed":
			return keysAre(step, ["op", "mode", "feet"]) && SPEEDS.has(step.mode)
				&& Number.isInteger(step.feet) && step.feet >= 0;
		case "grantRelativeSpeed":
			return (keysAre(step, ["op", "mode", "relativeTo"]) || keysAre(step, ["op", "mode", "relativeTo", "condition"]))
				&& SPEEDS.has(step.mode) && step.mode !== "walk" && step.relativeTo === "walk"
				&& (step.condition === undefined || (step.mode === "fly" && step.condition === "noMediumOrHeavyArmor"));
		case "grantConditionalDefense":
			return keysAre(step, ["op", "kind", "value", "when"])
				&& ["resistance", "immunity"].includes(step.kind) && DAMAGE_TYPES.has(step.value)
				&& ["nonmagical", "nonmagicalUnsilvered", "dimLightOrDarkness"].includes(step.when);
		case "addEntry":
			return keysAre(step, ["op", "section", "entry"]) && SECTIONS.has(step.section) && isEntry(step.entry);
		case "removeEntry":
			return keysAre(step, ["op", "section", "match"]) && SECTIONS.has(step.section) && isMatch(step.match);
		case "replaceEntry":
			return keysAre(step, ["op", "section", "match", "entry", "onMissing"])
				&& SECTIONS.has(step.section) && isMatch(step.match) && isEntry(step.entry)
				&& ["skip", "error"].includes(step.onMissing);
		case "replaceDamageType":
			return keysAre(step, ["op", "section", "match", "from", "to", "onMissing"])
				&& SECTIONS.has(step.section) && isMatch(step.match)
				&& Array.isArray(step.from) && !!step.from.length && new Set(step.from).size === step.from.length
				&& step.from.every(it => DAMAGE_TYPES.has(it)) && DAMAGE_TYPES.has(step.to)
				&& ["skip", "error"].includes(step.onMissing);
		default: return false;
	}
}

export function normalizeCreatureTransformation (resolved) {
	expect(isRecord(resolved) && Array.isArray(resolved.changes), "resolved changes must be an array");
	const changes = resolved.changes.map((step, index) => {
		expect(validateStep(step), `invalid or unrepresentable change ${index + 1} (${step?.op || "missing op"})`);
		const {op, ...fields} = step;
		return {type: op, ...structuredClone(fields)};
	});
	return {...structuredClone(resolved), changes};
}
