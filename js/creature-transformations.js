import {getRenderableSpeciesTrait, isTransformationEntry, isTransformationSpell} from "./creature-transformation-entries.js";
import {compileCreatureTransformationStats, isCreatureTransformationStatChange, isCreatureTransformationStatOp} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, isCreatureTransformationBindingChange, isCreatureTransformationBindingOp} from "./creature-transformation-bindings.js";
import {estimateCreatureTransformationCr, getCreatureTransformationCrProficiency, isCreatureTransformationCrChange, isCreatureTransformationCrOp} from "./creature-transformation-cr.js";
import {compileReanimation, isCompiledReanimation} from "./creature-transformation-reanimation.js";
import {compileSporeShadow, getSporeShadowProfile, isCompiledSporeShadow} from "./creature-transformation-spore-shadow.js";
import {compileVampire, isCompiledVampire} from "./creature-transformation-vampire.js";
import {compileLycanthrope, getLycanthropeProfile, isCompiledLycanthrope} from "./creature-transformation-lycanthrope.js";
import {compileFeyBeast, isCompiledFeyBeast, isFeyBeastCatalog} from "./creature-transformation-fey-beast.js";
import {compileFallenAngel, isCompiledFallenAngel, isFallenAngelCatalog} from "./creature-transformation-fallen-angel.js";
import {compileUndead, isCompiledUndead, isUndeadCatalog} from "./creature-transformation-undead.js";

const REVIEW_CHASSIS = [
	{field: "ac", reason: "Recheck AC after changing defenses or creature type."},
	{field: "hp", reason: "Recheck hit points and Hit Dice after changing type or abilities."},
	{field: "attacks", reason: "Recheck attacks, damage, and save DCs against the retained chassis."},
	{field: "cr", reason: "Recalculate challenge rating and experience after all changes."},
	{field: "characterLevel", reason: "Resolve character-level prerequisites for an NPC without a character level."},
];

const DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
const CONDITION_TYPES = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);
const CREATURE_TYPES = new Set(["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"]);
const SENSES = new Set(["darkvision", "blindsight", "tremorsense", "truesight"]);
const SPEEDS = new Set(["walk", "fly", "swim", "climb", "burrow"]);
const RELATIVE_SPEED_MODES = {flying: "fly", swimming: "swim", climbing: "climb", burrowing: "burrow"};
const RELATIVE_SPEED_MENTIONS = {
	fly: /\b(?:fly|flies|flying|flight|wings?)\b/i,
	swim: /\b(?:swim|swimming)\b/i,
	climb: /\b(?:climb|climbing|climber)\b/i,
	burrow: /\b(?:burrow|burrowing)\b/i,
};
const RELATIVE_SPEED_TRAIT = /^(?:Because of your wings, |Thanks to your wings, |Your walking speed is \d+ feet, and )?you have a (flying|swimming|climbing|burrowing) speed equal to your walking speed\.(?: (You can't use this flying speed if you're wearing medium or heavy armor\.)| In addition, at 3rd level, you can move up, down, and across vertical surfaces and upside down along ceilings, while leaving your hands free\.)?$/i;
const ANCESTRAL_LEGACY_RETENTION = [
	"If you replace a race with this lineage, you can keep the following elements of that race: any skill proficiencies you gained from it and any climbing, flying, or swimming speed you gained from it.",
	"If you don't keep any of those elements or you choose this lineage at character creation, you gain proficiency in two skills of your choice.",
];
const isAncestralLegacyRetention = (race, entry) => Boolean(race.lineage)
	&& entry?.type === "entries"
	&& entry.name === "Ancestral Legacy"
	&& Array.isArray(entry.entries)
	&& entry.entries.length === ANCESTRAL_LEGACY_RETENTION.length
	&& entry.entries.every((text, ix) => text === ANCESTRAL_LEGACY_RETENTION[ix]);
const SIZES = new Set(["T", "S", "M", "L", "H", "G"]);
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const ENTRY_SECTIONS = new Set(["trait", "action", "bonus", "reaction", "legendary"]);
const ENTRY_ROLES = new Set(["breathWeapon", "bite", "healingTouch", "angelicWeapons"]);
const REVIEW_FIELDS = new Set(["ac", "hp", "attacks", "cr", "characterLevel", "eligibility", "abilities", "traits", "spellcasting", "other"]);

const copy = value => structuredClone(value);
class CreatureTransformationCandidateError extends Error {}
const getId = (kind, {name, source}) => `${kind}:${name.toLowerCase()}|${source.toLowerCase()}`;
const getStableSignature = value => JSON.stringify(value, (_key, part) =>
	part && typeof part === "object" && !Array.isArray(part)
		? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b)))
		: part);
const getSignatureHash = signature => {
	let hash = 2166136261;
	for (let i = 0; i < signature.length; i++) hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
	return (hash >>> 0).toString(36);
};
const assertIdentity = (entity) => {
	if (typeof entity?.name !== "string" || !entity.name.trim() || typeof entity?.source !== "string" || !entity.source.trim()) {
		throw new CreatureTransformationCandidateError("Creature transformation requires a nonempty name and source.");
	}
};
const isEntry = isTransformationEntry;
const isEntryMatch = match => {
	const keys = Object.keys(match || {}).sort().join(",");
	return (keys === "name,source" && typeof match.name === "string" && !!match.name.trim() && typeof match.source === "string" && !!match.source.trim())
		|| (keys === "role,source" && ENTRY_ROLES.has(match.role) && typeof match.source === "string" && !!match.source.trim());
};
const assertReview = reviews => {
	if (!Array.isArray(reviews) || !reviews.every(it => REVIEW_FIELDS.has(it?.field) && typeof it?.reason === "string" && !!it.reason.trim() && Object.keys(it).sort().join(",") === "field,reason")) {
		throw new CreatureTransformationCandidateError("Transformation manualReview must contain typed, nonempty DM review items.");
	}
};
const assertEligibility = eligibility => {
	if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) throw new CreatureTransformationCandidateError("Transformation eligibility must be an object.");
	const allowed = new Set(["types", "sizes", "minCr", "maxCr", "minInt", "maxInt", "requiresTrait", "dmApproval"]);
	if (Object.keys(eligibility).some(key => !allowed.has(key))) throw new CreatureTransformationCandidateError("Unknown transformation eligibility constraint.");
	if (eligibility.types && (!Array.isArray(eligibility.types) || !eligibility.types.length || eligibility.types.some(it => !CREATURE_TYPES.has(it)))) throw new CreatureTransformationCandidateError("Invalid creature-type eligibility.");
	if (eligibility.sizes && (!Array.isArray(eligibility.sizes) || !eligibility.sizes.length || eligibility.sizes.some(it => !["T", "S", "M", "L", "H", "G"].includes(it)))) throw new CreatureTransformationCandidateError("Invalid size eligibility.");
	if (["minCr", "maxCr"].some(key => eligibility[key] != null && (!Number.isFinite(eligibility[key]) || eligibility[key] < 0))) throw new CreatureTransformationCandidateError("Invalid CR eligibility.");
	if (["minInt", "maxInt"].some(key => eligibility[key] != null && (!Number.isInteger(eligibility[key]) || eligibility[key] < 1 || eligibility[key] > 30))) throw new CreatureTransformationCandidateError("Invalid Intelligence eligibility.");
	if (eligibility.requiresTrait != null && (typeof eligibility.requiresTrait !== "string" || !eligibility.requiresTrait.trim())) throw new CreatureTransformationCandidateError("Invalid trait eligibility.");
	if (eligibility.dmApproval != null && typeof eligibility.dmApproval !== "boolean") throw new CreatureTransformationCandidateError("Invalid DM approval eligibility.");
};
const assertChanges = (changes, {allowStats = false} = {}) => {
	if (!Array.isArray(changes)) throw new CreatureTransformationCandidateError("Transformation changes must be an array.");
	for (const step of changes) {
		const props = Object.keys(step || {}).sort().join(",");
		const valid = (() => {
			switch (step?.op) {
				case "setType": return props === "op,value" && CREATURE_TYPES.has(step.value);
				case "setSize": return props === "op,value" && SIZES.has(step.value);
				case "setAbility":
				case "minimumAbility":
				case "maximumAbility": return props === "ability,op,value" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && Number.isInteger(step.value) && step.value >= 1 && step.value <= 30;
				case "adjustAbility": return props === "ability,amount,floor,op" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && Number.isInteger(step.amount) && step.amount >= -30 && step.amount <= 30 && step.floor === 1;
				case "scaleAbility": return props === "ability,factor,floor,op,round" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && step.factor === 0.5 && step.floor === 1 && step.round === "down";
				case "grantResistance":
				case "grantImmunity":
				case "grantVulnerability": return props === "op,value" && DAMAGE_TYPES.has(step.value);
				case "grantConditionImmunity": return props === "op,value" && CONDITION_TYPES.has(step.value);
				case "grantSense": return props === "op,range,sense" && SENSES.has(step.sense) && Number.isInteger(step.range) && step.range > 0;
				case "grantSpeed": return props === "feet,mode,op" && SPEEDS.has(step.mode) && Number.isInteger(step.feet) && step.feet >= 0;
				case "grantRelativeSpeed": return (props === "mode,op,relativeTo" || props === "condition,mode,op,relativeTo")
					&& SPEEDS.has(step.mode) && step.mode !== "walk" && step.relativeTo === "walk"
					&& (step.condition === undefined || (step.mode === "fly" && step.condition === "noMediumOrHeavyArmor"));
				case "grantLanguage": return props === "op,value" && typeof step.value === "string" && !!step.value.trim();
				case "grantSpell": return isTransformationSpell(step);
				case "grantConditionalDefense": return props === "kind,op,value,when" && ["resistance", "immunity"].includes(step.kind) && DAMAGE_TYPES.has(step.value) && ["nonmagical", "nonmagicalUnsilvered", "dimLightOrDarkness"].includes(step.when);
				case "addEntry": return props === "entry,op,section" && ENTRY_SECTIONS.has(step.section) && isEntry(step.entry);
				case "removeEntry": return props === "match,op,section" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match);
				case "replaceEntry": return props === "entry,match,onMissing,op,section" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match) && isEntry(step.entry) && ["error", "skip"].includes(step.onMissing);
				case "replaceDamageType": return props === "from,match,onMissing,op,section,to" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match) && Array.isArray(step.from) && step.from.length > 0 && new Set(step.from).size === step.from.length && step.from.every(it => DAMAGE_TYPES.has(it)) && DAMAGE_TYPES.has(step.to) && ["error", "skip"].includes(step.onMissing);
				default: return allowStats && (isCreatureTransformationStatChange(step) || isCreatureTransformationBindingChange(step) || isCreatureTransformationCrChange(step));
			}
		})();
		if (!valid) throw new CreatureTransformationCandidateError(`Invalid transformation change: ${step?.op || "(missing op)"}`);
	}
};

const isDracolichIdentity = identity => typeof identity?.name === "string" && identity.name.toLowerCase() === "dracolich"
	&& typeof identity?.source === "string" && identity.source.toLowerCase() === "mm";
const isZombieNumericIdentity = identity => typeof identity?.name === "string" && identity.name.toLowerCase() === "zombie"
	&& typeof identity?.source === "string" && identity.source.toLowerCase() === "dmg";
const isHalfDragonIdentity = identity => identity?.name === "Half-Dragon" && identity.source === "MM";
const HALF_DRAGON_RESISTANCE = {black: "acid", blue: "lightning", brass: "fire", bronze: "lightning", copper: "acid", gold: "fire", green: "poison", red: "fire", silver: "cold", white: "cold"};
const HALF_DRAGON_SIZES = {"large-or-smaller": ["T", "S", "M", "L"], huge: ["H"], gargantuan: ["G"]};
const HALF_DRAGON_MODES = {brass: ["Fire Breath", "Sleep Breath"], bronze: ["Lightning Breath", "Repulsion Breath"], copper: ["Acid Breath", "Slowing Breath"], gold: ["Fire Breath", "Weakening Breath"], silver: ["Cold Breath", "Paralyzing Breath"]};
const getHalfDragonDonorName = (ancestry, size) => {
	const color = ancestry[0].toUpperCase() + ancestry.slice(1);
	return size === "large-or-smaller" ? `${color} Dragon Wyrmling` : `${size === "huge" ? "Young" : "Adult"} ${color} Dragon`;
};
const isHalfDragonAction = (action, ancestry) => {
	if (!isEntry(action) || action.source !== "MM") return false;
	const modes = HALF_DRAGON_MODES[ancestry];
	if (!modes) {
		const damage = HALF_DRAGON_RESISTANCE[ancestry];
		return !!damage && action.name === `${damage[0].toUpperCase()}${damage.slice(1)} Breath {@recharge 5}`
			&& action.entries.length === 1 && typeof action.entries[0] === "string"
			&& !action.entries[0].includes("{@recharge");
	}
	const [header, list] = action.entries;
	return action.name === "Breath Weapons {@recharge 5}" && action.entries.length === 2
		&& typeof header === "string" && !header.includes("{@recharge")
		&& list?.type === "list" && list.style === "list-hang-notitle" && list.items.length === 2
		&& list.items.every((item, index) => item.type === "item" && item.name === modes[index]
			&& typeof item.entry === "string" && !item.entry.includes("{@recharge"));
};
const assertHalfDragonBreaths = rows => {
	if (!Array.isArray(rows) || rows.length !== 30) throw new CreatureTransformationCandidateError("Half-Dragon requires all 30 sourced ancestry/size breath tuples.");
	const seen = new Set();
	for (const row of rows) {
		if (!row || Object.keys(row).sort().join(",") !== "action,ancestry,donor,size"
			|| !Object.hasOwn(HALF_DRAGON_RESISTANCE, row.ancestry) || !Object.hasOwn(HALF_DRAGON_SIZES, row.size)
			|| !row.donor || Object.keys(row.donor).sort().join(",") !== "name,page,source"
			|| row.donor.source !== "MM" || row.donor.name !== getHalfDragonDonorName(row.ancestry, row.size)
			|| !Number.isInteger(row.donor.page) || row.donor.page < 1 || !isHalfDragonAction(row.action, row.ancestry)) {
			throw new CreatureTransformationCandidateError("Half-Dragon breath tuple requires the matching MM ancestry/age donor and one complete shared-recharge action.");
		}
		const key = `${row.ancestry}|${row.size}`;
		if (seen.has(key)) throw new CreatureTransformationCandidateError(`Duplicate Half-Dragon breath tuple: ${key}`);
		seen.add(key);
	}
};
const assertAutomation = (automation, identity) => {
	if (identity?.name === "Undead" && identity.source === "SCRE") {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== "undead-scre") {
			throw new CreatureTransformationCandidateError("Only the exact staged Undead|SCRE M12 profile is supported.");
		}
		return;
	}
	if (identity?.name === "Fallen Angel" && identity.source === "SCRE") {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== "fallen-angel") {
			throw new CreatureTransformationCandidateError("Only the exact staged Fallen Angel|SCRE M11 profile is supported.");
		}
		return;
	}
	if (identity?.name === "Fey Beast" && identity.source === "SCRE") {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== "fey-beast") {
			throw new CreatureTransformationCandidateError("Only the exact staged Fey Beast|SCRE M10 profile is supported.");
		}
		return;
	}
	const lycanthrope = getLycanthropeProfile(getId("catalog", identity));
	if (lycanthrope) {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== lycanthrope
			|| identity.name !== (lycanthrope === "wereshark" ? "Wereshark" : "Lycanthropy")
			|| identity.source !== (lycanthrope === "wereshark" ? "Arcadia27" : "MM")) {
			throw new CreatureTransformationCandidateError("Only the exact source-qualified staged M9 lycanthrope profiles are supported.");
		}
		return;
	}
	if (identity?.name === "Vampire" && identity.source === "MM") {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== "vampire") {
			throw new CreatureTransformationCandidateError("Only the exact staged Vampire|MM NPC adaptation is supported.");
		}
		return;
	}
	const profile = getSporeShadowProfile(getId("catalog", identity));
	if (profile) {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged" || automation.profile !== profile) {
			throw new CreatureTransformationCandidateError("Only the exact source-qualified staged M7 Spore/Shadow profile is supported.");
		}
		return;
	}
	if (["skeleton|DMG", "skeletal wyrmling|Ar8"].includes(`${identity?.name?.toLowerCase()}|${identity?.source}`)) {
		if (!automation || Object.keys(automation).sort().join(",") !== "profile,rollout,version"
			|| automation.version !== 2 || automation.rollout !== "staged"
			|| automation.profile !== (identity.name === "Skeleton" ? "skeleton" : "skeletal-wyrmling")) {
			throw new CreatureTransformationCandidateError("Only the source-qualified staged M6 reanimation profile is supported.");
		}
		return;
	}
	if (isHalfDragonIdentity(identity)) {
		if (!automation || Object.keys(automation).sort().join(",") !== "halfDragonBreaths,profile,rollout,version"
			|| automation.version !== 2 || automation.profile !== "half-dragon" || automation.rollout !== "staged") {
			throw new CreatureTransformationCandidateError("Only the staged version-2 Half-Dragon (MM) breath profile is supported.");
		}
		assertHalfDragonBreaths(automation.halfDragonBreaths);
		return;
	}
	if (isZombieNumericIdentity(identity)) {
		if (!automation || Object.keys(automation).sort().join(",") !== "hitPoints,profile,rollout,version"
			|| automation.version !== 2 || automation.profile !== "zombie-numerics" || automation.rollout !== "staged" || automation.hitPoints !== "constitution") {
			throw new CreatureTransformationCandidateError("Only the staged version-2 Zombie (DMG) numeric profile is supported.");
		}
		return;
	}
	if (!isDracolichIdentity(identity)
		|| !automation || Object.keys(automation).sort().join(",") !== "changes,profile,rollout,version"
		|| automation.version !== 2 || automation.profile !== "dracolich" || automation.rollout !== "staged") {
		throw new CreatureTransformationCandidateError("Only the staged version-2 Dracolich (MM) automation profile is supported.");
	}
	assertChanges(automation.changes);
	const names = new Set(automation.changes.map(it => it.entry?.name));
	if (automation.changes.length !== 2 || !names.has("Magic Resistance") || !names.has("Undead Nature")
		|| automation.changes.some(it => it.op !== "addEntry" || it.section !== "trait" || it.entry.source !== "MM")) {
		throw new CreatureTransformationCandidateError("Staged Dracolich automation requires exactly the sourced Magic Resistance and Undead Nature traits.");
	}
};

const getCombinations = (values, count) => {
	if (!Array.isArray(values) || !values.length || values.length > 24 || new Set(values).size !== values.length
		|| !Number.isInteger(count) || count < 1 || count > 6 || count > values.length) return null;
	const result = [];
	const visit = (start, selected) => {
		if (selected.length === count) {
			result.push(selected);
			return;
		}
		for (let i = start; i < values.length && result.length <= 24; i++) visit(i + 1, [...selected, values[i]]);
	};
	visit(0, []);
	return result.length <= 24 ? result : null;
};

const getSpellUid = value => {
	if (typeof value !== "string" || value.length > 258 || value.includes("{") || value.includes("}") || (value.includes("#") && !value.endsWith("#c"))) return null;
	const clean = value.replace(/#c$/, "");
	if (!/^[^{}<>|#\r\n&]+?(?:\|[a-zA-Z0-9-]{2,40})?$/.test(clean)) return null;
	const [name, source = "PHB"] = clean.split("|");
	return name?.trim() && `${name.trim()}|${source.toLowerCase()}`;
};

const getSpellBlock = (block, source, ability) => {
	const changes = [];
	const manualReview = [];
	const review = reason => manualReview.push({field: "spellcasting", reason});
	for (const category of ["known", "prepared", "innate"]) {
		if (block[category] == null) continue;
		if (!block[category] || typeof block[category] !== "object" || Array.isArray(block[category])) {
			review(`Resolve the ${category} species spells manually.`);
			continue;
		}
		for (const [level, grant] of Object.entries(block[category])) {
			if (!["_", "1"].includes(level)) {
				manualReview.push({field: "characterLevel", reason: `Resolve species spells at character level ${level} with the DM; they were not granted.`});
				review(`Species spells at level ${level} were not granted automatically.`);
				continue;
			}
			const add = (spells, usage, uses) => {
				if (!Array.isArray(spells)) {
					review(`Resolve non-concrete ${category} spell choices with the DM.`);
					return;
				}
				for (const spell of spells) {
					const uid = getSpellUid(spell);
					if (!uid) review(`Choose a concrete ${category} spell and casting level with the DM.`);
					else {
						changes.push({op: "grantSpell",
							spell: uid,
							source,
							usage: ["known", "prepared"].includes(usage) && spell.endsWith("#c") ? "will" : usage,
							...ability ? {ability} : {},
							...uses ? {uses} : {}});
					}
				}
			};
			if (category !== "innate") {
				if (Array.isArray(grant)) add(grant, category);
				else if (grant && typeof grant === "object" && Array.isArray(grant._)) {
					add(grant._, category);
					if (Object.keys(grant).some(key => key !== "_")) review(`Resolve additional ${category} spell usage with the DM.`);
				} else review(`Resolve non-concrete ${category} spell choices with the DM.`);
				continue;
			}
			if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
				review("Resolve innate spell usage with the DM.");
				continue;
			}
			if (grant.will != null) {
				if (Array.isArray(grant.will)) add(grant.will, "will");
				else review("Resolve non-concrete innate at-will spells with the DM.");
			}
			for (const duration of ["daily", "rest"]) {
				if (grant[duration] == null) continue;
				if (!grant[duration] || typeof grant[duration] !== "object" || Array.isArray(grant[duration])) {
					review(`Resolve innate ${duration} spell uses with the DM.`);
					continue;
				}
				for (const [count, spells] of Object.entries(grant[duration])) {
					if (!/^[1-9]e?$/.test(count) || !Array.isArray(spells) || (!count.endsWith("e") && spells.length > 1)) {
						review(`Resolve shared or non-concrete ${duration} spell uses with the DM.`);
						continue;
					}
					add(spells, duration, Number(count[0]));
				}
			}
			for (const key of Object.keys(grant)) if (!["will", "daily", "rest"].includes(key)) review(`Resolve unsupported innate spell usage "${key}" with the DM.`);
		}
	}
	for (const key of Object.keys(block)) if (!["name", "ability", "known", "prepared", "innate"].includes(key)) review(`Resolve unsupported species spell property "${key}" with the DM.`);
	return {changes, manualReview};
};

const getRelativeSpeed = (race, mode) => {
	const entries = Array.isArray(race.entries) ? race.entries : [];
	const relevant = entries.filter(entry => RELATIVE_SPEED_MENTIONS[mode].test(JSON.stringify(entry)) && !isAncestralLegacyRetention(race, entry));
	if (!relevant.length) return race.speed?.[mode] === true ? {op: "grantRelativeSpeed", mode, relativeTo: "walk"} : null;
	if (relevant.length !== 1 || !Array.isArray(relevant[0]?.entries) || relevant[0].entries.length !== 1 || typeof relevant[0].entries[0] !== "string") return null;
	const match = RELATIVE_SPEED_TRAIT.exec(relevant[0].entries[0]);
	if (!match || RELATIVE_SPEED_MODES[match[1].toLowerCase()] !== mode) return null;
	return {
		op: "grantRelativeSpeed",
		mode,
		relativeTo: "walk",
		...match[2] ? {condition: "noMediumOrHeavyArmor"} : {},
	};
};

const getRaceRecipe = race => {
	const changes = [];
	const optionGroups = [];
	const manualReview = copy(REVIEW_CHASSIS);
	const review = (field, reason) => manualReview.push({field, reason});
	const choose = (id, name, values, count, getChanges, field) => {
		const combinations = getCombinations(values, count);
		if (!combinations) {
			review(field, `Resolve ${name} choice with the DM; it cannot be represented as bounded, fixed options.`);
			return;
		}
		const groupId = optionGroups.some(it => it.id === id) ? `${id}-${optionGroups.filter(it => it.id === id || it.id.startsWith(`${id}-`)).length + 1}` : id;
		optionGroups.push({
			id: groupId,
			name,
			selection: "one",
			required: true,
			options: combinations.map((selected, ix) => ({
				id: `choice-${ix + 1}`,
				name: selected.join(" + "),
				changes: selected.flatMap(getChanges),
				manualReview: [],
			})),
		});
	};
	const addTyped = (key, op, allowed, field = "traits") => {
		if (race[key] == null) return;
		if (!Array.isArray(race[key])) {
			review(field, `Resolve this species' ${key} choice or nonstandard value with the DM.`);
			return;
		}
		for (const value of race[key]) {
			if (typeof value === "string" && allowed.has(value)) changes.push({op, value});
			else if (value?.choose && Array.isArray(value.choose.from) && value.choose.from.every(it => allowed.has(it))
				&& Object.keys(value).length === 1 && Object.keys(value.choose).every(it => ["from", "count"].includes(it))) {
				choose(key, `Species ${key}`, value.choose.from, value.choose.count ?? 1, item => [{op, value: item}], field);
			} else review(field, `Resolve this species' ${key} choice or nonstandard value with the DM.`);
		}
	};
	if (race.creatureTypes == null) changes.push({op: "setType", value: "humanoid"});
	else if (Array.isArray(race.creatureTypes) && race.creatureTypes.length === 1 && CREATURE_TYPES.has(race.creatureTypes[0])) changes.push({op: "setType", value: race.creatureTypes[0]});
	else if (Array.isArray(race.creatureTypes) && race.creatureTypes.length > 1 && race.creatureTypes.every(it => CREATURE_TYPES.has(it))) {
		choose("type", "Creature type", race.creatureTypes, 1, value => [{op: "setType", value}], "eligibility");
	} else review("eligibility", "Resolve this species' creature type with the DM.");

	if (Array.isArray(race.size) && race.size.length === 1 && SIZES.has(race.size[0])) changes.push({op: "setSize", value: race.size[0]});
	else if (Array.isArray(race.size) && race.size.length > 1 && race.size.every(it => SIZES.has(it))) {
		choose("size", "Species size", race.size, 1, value => [{op: "setSize", value}], "other");
	} else if (race.size != null) review("other", "Resolve this species' size with the DM.");

	if (race.ability != null) {
		if (!Array.isArray(race.ability) || race.ability.length !== 1 || !race.ability[0] || typeof race.ability[0] !== "object") {
			review("abilities", "Resolve alternative species ability adjustments with the DM.");
		} else {
			const ability = race.ability[0];
			for (const [key, value] of Object.entries(ability)) {
				if (ABILITIES.has(key) && Number.isInteger(value) && value >= -30 && value <= 30 && value !== 0) changes.push({op: "adjustAbility", ability: key, amount: value, floor: 1});
				else if (key === "choose" && value && Array.isArray(value.from) && value.from.every(it => ABILITIES.has(it))
					&& Number.isInteger(value.amount ?? 1) && (value.amount ?? 1) >= -30 && (value.amount ?? 1) <= 30
					&& Object.keys(value).every(it => ["from", "count", "amount"].includes(it))) {
					choose("ability", "Ability adjustment", value.from, value.count ?? 1,
						item => [{op: "adjustAbility", ability: item, amount: value.amount ?? 1, floor: 1}], "abilities");
				} else review("abilities", "Resolve non-fixed species ability adjustments with the DM.");
			}
		}
	}
	addTyped("resist", "grantResistance", DAMAGE_TYPES);
	addTyped("immune", "grantImmunity", DAMAGE_TYPES);
	addTyped("vulnerable", "grantVulnerability", DAMAGE_TYPES);
	addTyped("conditionImmune", "grantConditionImmunity", CONDITION_TYPES);
	for (const sense of SENSES) {
		if (race[sense] == null) continue;
		if (Number.isInteger(race[sense]) && race[sense] > 0) changes.push({op: "grantSense", sense, range: race[sense]});
		else review("traits", `Resolve non-fixed ${sense} range with the DM.`);
	}
	if (race.speed != null) {
		if (Number.isInteger(race.speed) && race.speed >= 0) changes.push({op: "grantSpeed", mode: "walk", feet: race.speed});
		else if (race.speed && typeof race.speed === "object" && !Array.isArray(race.speed)) {
			for (const [mode, value] of Object.entries(race.speed)) {
				if (SPEEDS.has(mode) && Number.isInteger(value) && value >= 0) changes.push({op: "grantSpeed", mode, feet: value});
				else if (value !== true || mode === "walk" || !SPEEDS.has(mode)) review("traits", `Resolve conditional or unsupported ${mode} speed for this species.`);
			}
		} else review("traits", "Resolve non-fixed species speed with the DM.");
	}
	for (const mode of Object.values(RELATIVE_SPEED_MODES)) {
		if (race.speed?.[mode] != null && race.speed[mode] !== true) continue;
		const relative = getRelativeSpeed(race, mode);
		if (relative) changes.push(relative);
		else if (race.speed?.[mode] === true || (Array.isArray(race.entries) && race.entries.some(entry => RELATIVE_SPEED_MENTIONS[mode].test(JSON.stringify(entry))))) {
			review("traits", `Resolve ${mode} speed with the DM; its conditions or choices cannot be applied automatically.`);
		}
	}
	if (race.languageProficiencies != null) {
		if (!Array.isArray(race.languageProficiencies) || !race.languageProficiencies.length) review("traits", "Resolve nonstandard species languages with the DM.");
		else {
			const lists = race.languageProficiencies;
			const fixed = Object.entries(lists[0]).filter(([key, value]) => value === true && key !== "other" && lists.every(list => list[key] === true));
			for (const [key] of fixed) changes.push({op: "grantLanguage", value: key[0].toUpperCase() + key.slice(1)});
			if (lists.length !== 1) review("traits", "Resolve alternative species language lists with the DM.");
			else {
				for (const [key, value] of Object.entries(lists[0])) {
					if (fixed.some(([name]) => name === key)) continue;
					if (key === "choose" && value && Array.isArray(value.from) && value.from.every(it => typeof it === "string" && it !== "other" && /^[a-z][a-z -]*$/i.test(it))) {
						choose("languages", "Species language", value.from, value.count ?? 1, item => [{op: "grantLanguage", value: item[0].toUpperCase() + item.slice(1)}], "traits");
					} else review("traits", `Resolve ${key} language proficiency with the DM.`);
				}
			}
		}
	}
	if (race.additionalSpells != null) {
		if (!Array.isArray(race.additionalSpells) || !race.additionalSpells.length || race.additionalSpells.length > 24) review("spellcasting", "Resolve nonstandard species spells with the DM.");
		else if (race.additionalSpells.length > 1 && !race.additionalSpells.every(it => typeof it?.name === "string" && it.name.trim())) {
			review("spellcasting", "Resolve whether the unnamed species spell grants are cumulative or alternatives with the DM; none were granted.");
		} else {
			const spellOptions = [];
			for (const [ix, block] of race.additionalSpells.entries()) {
				if (!block || typeof block !== "object" || Array.isArray(block)) {
					review("spellcasting", "Resolve nonstandard species spell grants with the DM.");
					continue;
				}
				const abilities = typeof block.ability === "string" ? [block.ability]
					: block.ability?.choose && Array.isArray(block.ability.choose) && Object.keys(block.ability).length === 1
						? block.ability.choose : [null];
				if (!abilities.length || abilities.length > 6 || new Set(abilities).size !== abilities.length
					|| abilities.some(it => it != null && !ABILITIES.has(it)) || (block.ability && abilities[0] == null)) {
					review("spellcasting", "Choose a supported species spellcasting ability with the DM.");
					continue;
				}
				for (const ability of abilities) {
					const data = getSpellBlock(block, race.source, ability);
					spellOptions.push({
						id: `choice-${spellOptions.length + 1}`,
						name: `${block.name || `Spell grant ${ix + 1}`}${abilities.length > 1 ? ` (${ability.toUpperCase()})` : ""}`,
						changes: data.changes,
						manualReview: data.manualReview,
					});
				}
			}
			if (race.additionalSpells.length > 1 || spellOptions.length > 1) {
				if (spellOptions.length && spellOptions.length <= 24) optionGroups.push({id: "spells", name: "Species spell grant and ability", selection: "one", required: true, options: spellOptions});
				else review("spellcasting", "Resolve species spell choices with the DM; no safe finite selection is available.");
			} else if (spellOptions.length) {
				changes.push(...spellOptions[0].changes);
				manualReview.push(...spellOptions[0].manualReview);
			}
			if (spellOptions.some(it => it.changes.length && it.changes.some(change => !change.ability))) review("spellcasting", "Resolve the species spellcasting ability and spell DC with the DM.");
		}
	}
	if (race.entries != null) {
		if (!Array.isArray(race.entries)) review("traits", "Resolve nonstandard species trait entries with the DM.");
		else {
			for (const entry of race.entries) {
				if (race._baseSource && race._baseSource !== race.source && !entry?.source) {
					review("traits", `Review species trait "${entry?.name || "(unnamed)"}" with the DM; merged parent and subrace text has no reliable source attribution.`);
					continue;
				}
				const trait = getRenderableSpeciesTrait(entry, race.source);
				if (trait) changes.push({op: "addEntry", section: "trait", entry: trait});
				else review("traits", `Review unsupported or oversized species trait "${entry?.name || "(unnamed)"}" with the DM; it was not added.`);
			}
			if (race.entries.length) review("traits", "Species trait rules are displayed, but their roll modifiers, proficiencies, and actions are not automated; adjudicate them with the DM.");
		}
	}
	for (const key of ["skillProficiencies", "toolProficiencies", "weaponProficiencies", "armorProficiencies"]) {
		if (race[key]?.length) review("traits", `Review ${key} with the DM; proficiency roll modifiers are not automated.`);
	}
	if (race.skillToolLanguageProficiencies?.length) review("traits", "Review combined skill, tool, and language proficiency choices with the DM; they were not automated.");
	if (race.feats?.length) review("traits", "Review species-granted feats with the DM; they were not automated.");
	if (race.creatureTypeTags?.length) review("traits", "Review species creature-type tags with the DM; only the primary type was changed.");
	if (race.lineage) review("eligibility", "Review lineage selection with the DM; it was not inferred from this species.");
	if (race.entries?.some(entry => isAncestralLegacyRetention(race, entry))) {
		review("traits", "Resolve any movement retained from Ancestral Legacy with the DM; no legacy speed was granted.");
	}
	if (!changes.length && !optionGroups.length) review("other", "No safe executable species change is available for this entry.");
	return {
		kind: "race",
		id: getId("race", race),
		identity: {name: race.name, source: race.source},
		baseIdentity: race._baseName ? {name: race._baseName, source: race._baseSource} : null,
		provenance: {edition: race.edition || "unverified", ...race.page ? {page: race.page} : {}},
		eligibility: {dmApproval: true},
		prerequisites: [],
		changes,
		optionGroups,
		manualReview,
	};
};

/**
 * DataUtil.race already merges separate subraces using Renderer.race.mergeSubraces.
 * The loader also supplies same-source base races; expand inline _versions separately.
 */
function getCreatureTransformationCandidates ({catalog, races, getVersions, onInvalidCandidate = null}) {
	if (!Array.isArray(catalog?.creatureTransformation) || !Array.isArray(races)) throw new Error("Transformation catalog and resolved races are required.");
	const byId = new Map();
	let pending = [];
	const append = candidate => {
		assertIdentity(candidate.identity);
		if (
			!candidate.provenance
			|| !["classic", "one", "unverified"].includes(candidate.provenance.edition)
			|| (candidate.provenance.page != null && (!Number.isInteger(candidate.provenance.page) || candidate.provenance.page < 1))
		) throw new CreatureTransformationCandidateError(`Invalid transformation provenance: ${candidate.id}`);
		assertEligibility(candidate.eligibility);
		assertReview(candidate.manualReview);
		if (Object.hasOwn(candidate, "automation")) assertAutomation(candidate.automation, candidate.identity);
		if (!Array.isArray(candidate.prerequisites) || candidate.prerequisites.some(it => typeof it !== "string" || !it.trim())) throw new CreatureTransformationCandidateError(`Invalid transformation prerequisites: ${candidate.id}`);
		assertChanges(candidate.changes);
		if (!Array.isArray(candidate.optionGroups)) throw new CreatureTransformationCandidateError(`Invalid transformation option groups: ${candidate.id}`);
		const groupIds = new Set();
		for (const group of candidate.optionGroups) {
			if (!group?.id || groupIds.has(group.id)) throw new CreatureTransformationCandidateError(`Duplicate or missing option group in ${candidate.id}.`);
			groupIds.add(group.id);
			if (!["one", "any"].includes(group.selection) || !Array.isArray(group.options) || !group.options.length) throw new CreatureTransformationCandidateError(`Invalid option group in ${candidate.id}.`);
			const ids = new Set();
			for (const option of group.options) {
				if (!option?.id || ids.has(option.id)) throw new CreatureTransformationCandidateError(`Duplicate or missing option in ${candidate.id}/${group.id}.`);
				ids.add(option.id);
				assertChanges(option.changes);
				assertReview(option.manualReview);
				if (option.eligibility) assertEligibility(option.eligibility);
			}
		}
		for (const group of candidate.optionGroups) {
			if (!group.appliesTo) continue;
			const parent = candidate.optionGroups.find(it => it.id === group.appliesTo.group);
			if (!parent?.options.some(it => it.id === group.appliesTo.option) || group.required) throw new CreatureTransformationCandidateError(`Invalid conditional option group in ${candidate.id}/${group.id}.`);
		}
		if (candidate.automation?.profile === "fey-beast" && !isFeyBeastCatalog(candidate)) throw new CreatureTransformationCandidateError("M10 requires the existing ten-choice Fey Beast features contract.");
		if (candidate.automation?.profile === "fallen-angel" && !isFallenAngelCatalog(candidate)) throw new CreatureTransformationCandidateError("M11 requires the existing two-choice Fallen Angel allegiance contract.");
		if (candidate.automation?.profile === "undead-scre" && !isUndeadCatalog(candidate)) throw new CreatureTransformationCandidateError("M12 requires the existing six categories and seven option groups.");
		const matches = [...byId.get(candidate.id) || [], ...pending.filter(it => it.candidate.id === candidate.id)];
		if (matches.length && candidate.kind !== "race") throw new Error(`Duplicate creature transformation identity: ${candidate.id}`);
		const signature = getStableSignature(candidate);
		if (matches.some(it => it.signature === signature)) return;
		pending.push({candidate, signature});
	};

	const visit = (entity, kind, index, fn) => {
		try {
			pending = [];
			fn();
			for (const match of pending) {
				const matches = byId.get(match.candidate.id) || [];
				matches.push(match);
				byId.set(match.candidate.id, matches);
			}
		} catch (e) {
			if (!onInvalidCandidate || !(e instanceof CreatureTransformationCandidateError)) throw e;
			onInvalidCandidate({
				kind,
				index,
				name: typeof entity?.name === "string" ? entity.name : null,
				source: typeof entity?.source === "string" ? entity.source : null,
				reason: e.message,
			});
		}
	};
	for (const [index, recipe] of catalog.creatureTransformation.entries()) {
		visit(recipe, "catalog", index, () => {
			assertIdentity(recipe);
			assertReview(recipe.manualReview);
			append({
				...copy(recipe),
				kind: "catalog",
				id: getId("catalog", recipe),
				identity: {name: recipe.name, source: recipe.source},
				manualReview: [...copy(REVIEW_CHASSIS), ...copy(recipe.manualReview)],
			});
		});
	}
	for (const [index, race] of races.entries()) {
		visit(race, "race", index, () => {
			assertIdentity(race);
			const recipe = getRaceRecipe(race);
			if (race._isBaseRace) recipe.manualReview.push({field: "eligibility", reason: "Select a playable subrace or lineage if required by this species."});
			append(recipe);
			if (!race._versions?.length) return;
			if (typeof getVersions !== "function") throw new Error(`Race versions cannot be resolved: ${race.name}|${race.source}`);
			for (const [ix, version] of getVersions({...race, __prop: "race"}).entries()) {
				assertIdentity(version);
				const versionRecipe = getRaceRecipe({...version, _baseName: race.name, _baseSource: race.source});
				versionRecipe.id = `${versionRecipe.id}~v:${race.name.toLowerCase()}|${race.source.toLowerCase()}:${ix + 1}`;
				append(versionRecipe);
			}
		});
	}
	const result = [];
	for (const [id, matches] of byId) {
		if (matches.length === 1) {
			result.push(matches[0].candidate);
			continue;
		}
		matches.sort((a, b) => a.signature.localeCompare(b.signature));
		const distinctIds = new Set();
		matches.forEach(({candidate, signature}, index) => {
			candidate.id = `${id}~d:${getSignatureHash(signature)}`;
			if (distinctIds.has(candidate.id)) throw new Error(`Cannot distinguish conflicting race definitions: ${id}`);
			distinctIds.add(candidate.id);
			candidate.duplicateVariant = `${index + 1} of ${matches.length}`;
			result.push(candidate);
		});
	}
	return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function pLoadCreatureTransformationCandidates ({dataUtil = globalThis.DataUtil, onWarning = null} = {}) {
	if (!dataUtil?.race || !dataUtil?.generic?.getVersions) throw new Error("DataUtil.race and DataUtil.generic.getVersions are required.");
	const [catalog, site, prerelease, brew] = await Promise.all([
		dataUtil.loadJSON("data/creature-transformations.json"),
		dataUtil.race.loadJSON({isAddBaseRaces: true}),
		dataUtil.race.loadPrerelease({isAddBaseRaces: true}),
		dataUtil.race.loadBrew({isAddBaseRaces: true}),
	]);
	if (!Array.isArray(site?.race)) throw new Error("Site race source is unavailable or malformed.");
	for (const [name, data] of [["prerelease", prerelease], ["homebrew", brew]]) {
		if (!data || typeof data !== "object" || (data.race != null && !Array.isArray(data.race))) throw new Error(`${name} race source is malformed.`);
	}
	const races = JSON.parse(JSON.stringify([...(site.race || []), ...(prerelease.race || []), ...(brew.race || [])]));
	if (races.some(race => race?._copy) && typeof dataUtil.race.pMergeCopy !== "function") {
		throw new Error("Race copies cannot be resolved without DataUtil.race.pMergeCopy.");
	}
	for (const race of races) if (race?._copy) await dataUtil.race.pMergeCopy(races, race, {isErrorOnMissing: true});
	return getCreatureTransformationCandidates({
		catalog,
		races,
		getVersions: race => dataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
		onInvalidCandidate: warning => {
			// eslint-disable-next-line no-console
			console.warn(`[5et:creature-transformations] Skipping ${warning.name || `${warning.kind} entry ${warning.index + 1}`} (${warning.source || "unknown source"}): ${warning.reason}`, warning);
			onWarning?.(warning);
		},
	});
}

function resolveCreatureTransformation ({candidates, id, selections = {}, automationVersion = 1}) {
	if (![1, 2].includes(automationVersion)) throw new Error("Unsupported creature transformation automation version.");
	const candidate = candidates?.find(it => it.id === id);
	if (!candidate || candidates.filter(it => it.id === id).length !== 1) throw new Error(`Unavailable or ambiguous transformation: ${id}`);
	if (selections == null || Array.isArray(selections) || typeof selections !== "object") throw new Error("Selections must be keyed by option group.");
	const groupIds = new Set(candidate.optionGroups.map(it => it.id));
	for (const key of Object.keys(selections)) if (!groupIds.has(key)) throw new Error(`Unknown transformation option group: ${key}`);
	const changes = copy(candidate.changes);
	const manualReview = copy(candidate.manualReview);
	const eligibility = [copy(candidate.eligibility)];
	const selectedOptions = {};
	for (const group of candidate.optionGroups) {
		const chosen = selections[group.id] || [];
		if (!Array.isArray(chosen) || (group.selection === "one" && chosen.length > 1) || (group.required && !chosen.length) || new Set(chosen).size !== chosen.length) {
			throw new Error(`Invalid selection for ${group.id}.`);
		}
		if (chosen.length && group.appliesTo && !selections[group.appliesTo.group]?.includes(group.appliesTo.option)
			&& !(automationVersion === 2 && candidate.id === "catalog:undead|scre")) throw new Error(`Option group ${group.id} requires ${group.appliesTo.group}/${group.appliesTo.option}.`);
		selectedOptions[group.id] = [...chosen];
		for (const optionId of chosen) {
			const option = group.options.find(it => it.id === optionId);
			if (!option) throw new Error(`Unknown transformation option: ${group.id}/${optionId}`);
			changes.push(...copy(option.changes));
			manualReview.push(...copy(option.manualReview));
			if (option.eligibility) eligibility.push(copy(option.eligibility));
		}
	}
	assertChanges(changes);
	assertReview(manualReview);
	const resolved = {
		id: candidate.id,
		kind: candidate.kind,
		identity: copy(candidate.identity),
		provenance: copy(candidate.provenance),
		eligibility,
		prerequisites: copy(candidate.prerequisites),
		selectedOptions,
		changes,
		manualReview,
	};
	if (automationVersion === 2) {
		if (candidate.kind !== "catalog") throw new Error("Staged automation is not available for species.");
		assertAutomation(candidate.automation, candidate.identity);
		resolved.version = 2;
		resolved.automation = copy(candidate.automation);
	}
	return resolved;
}

function isCompiledCreatureTransformation (resolved) {
	if (resolved?.id === "catalog:undead|scre") return isCompiledUndead(resolved);
	if (resolved?.id === "catalog:fallen angel|scre") return isCompiledFallenAngel(resolved);
	if (resolved?.id === "catalog:fey beast|scre") return isCompiledFeyBeast(resolved);
	if (getLycanthropeProfile(resolved?.id)) return isCompiledLycanthrope(resolved);
	if (resolved?.id === "catalog:vampire|mm") return isCompiledVampire(resolved);
	if (getSporeShadowProfile(resolved?.id)) return isCompiledSporeShadow(resolved);
	if (Object.hasOwn(resolved?.selectedOptions || {}, "automation-reanimation")) return isCompiledReanimation(resolved);
	if (resolved?.version === 2 && resolved.kind === "catalog" && resolved.id === "catalog:half-dragon|mm" && isHalfDragonIdentity(resolved.identity)) {
		if (Object.hasOwn(resolved, "automation") || !resolved.selectedOptions
			|| Object.keys(resolved.selectedOptions).sort().join(",") !== "ancestry,automation-breath,size") return false;
		const {ancestry, size, "automation-breath": donor} = resolved.selectedOptions;
		if (![ancestry, size, donor].every(value => Array.isArray(value) && value.length === 1)
			|| !Object.hasOwn(HALF_DRAGON_RESISTANCE, ancestry[0]) || !Object.hasOwn(HALF_DRAGON_SIZES, size[0])
			|| donor[0] !== `${getHalfDragonDonorName(ancestry[0], size[0]).toLowerCase()}|mm`) return false;
		const op = step => step?.op ?? step?.type;
		const expected = [
			{op: "grantSense", sense: "blindsight", range: 10},
			{op: "grantSense", sense: "darkvision", range: 60},
			{op: "grantLanguage", value: "Draconic"},
			{op: "grantResistance", value: HALF_DRAGON_RESISTANCE[ancestry[0]]},
		];
		if (!Array.isArray(resolved.changes) || resolved.changes.length !== 5
			|| expected.some((step, index) => {
				const actual = resolved.changes[index];
				return !actual || getStableSignature({op: op(actual), ...Object.fromEntries(Object.entries(actual).filter(([key]) => !["op", "type"].includes(key)))}) !== getStableSignature(step);
			})) return false;
		const action = resolved.changes[4];
		return op(action) === "addEntry" && action.section === "action" && isHalfDragonAction(action.entry, ancestry[0])
			&& getStableSignature(resolved.eligibility) === getStableSignature([
				{types: ["beast", "humanoid", "giant", "monstrosity"]}, {sizes: HALF_DRAGON_SIZES[size[0]]},
			]);
	}
	if (resolved?.version === 2 && resolved.kind === "catalog" && resolved.id === "catalog:zombie|dmg" && isZombieNumericIdentity(resolved.identity)) {
		const hasBindings = JSON.stringify(resolved.selectedOptions?.["automation-bindings"]) === JSON.stringify(["zombie-dmg-m2b"]);
		const hasCr = JSON.stringify(resolved.selectedOptions?.["automation-cr"]) === JSON.stringify(["zombie-dmg-m3"]);
		const groups = ["automation-numerics", ...hasBindings ? ["automation-bindings"] : [], ...hasCr ? ["automation-cr"] : []].sort().join(",");
		if (Object.hasOwn(resolved, "automation") || !Array.isArray(resolved.eligibility) || !resolved.eligibility.some(rule => rule?.dmApproval === true)
			|| !resolved.selectedOptions || Object.keys(resolved.selectedOptions).sort().join(",") !== groups || (hasCr && !hasBindings)
			|| JSON.stringify(resolved.selectedOptions["automation-numerics"]) !== JSON.stringify(["zombie-dmg-m2a"]) || !Array.isArray(resolved.changes)) return false;
		const seen = new Set();
		for (const step of resolved.changes) {
			const op = step?.op ?? step?.type;
			if (op === "setAbility") {
				if (!(hasBindings ? [...ABILITIES] : ["str", "con", "int", "wis", "cha"]).includes(step.ability) || !Number.isInteger(step.value) || step.value < 1 || step.value > 30) return false;
			} else if (isCreatureTransformationStatOp(op)) {
				if (!isCreatureTransformationStatChange(step, Object.hasOwn(step, "op") ? "op" : "type")) return false;
			} else if (isCreatureTransformationBindingOp(op)) {
				if (!hasBindings || !isCreatureTransformationBindingChange(step, Object.hasOwn(step, "op") ? "op" : "type")) return false;
			} else if (isCreatureTransformationCrOp(op)) {
				if (!hasCr || !isCreatureTransformationCrChange(step, Object.hasOwn(step, "op") ? "op" : "type")) return false;
			} else if (!(op === "setType" && step.value === "undead")
				&& !(op === "grantSense" && step.sense === "darkvision" && step.range === 60)
				&& !(op === "grantImmunity" && step.value === "poison")
				&& !(op === "grantConditionImmunity" && step.value === "poisoned")) return false;
			const key = isCreatureTransformationBindingOp(op)
				? `${op}:${step.section ?? ""}:${step.match?.name?.trim().toLowerCase() ?? step.name ?? ""}|${step.match?.source?.trim().toLowerCase() ?? step.source ?? ""}`
				: `${op}:${step.ability ?? step.skill ?? ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
		}
		if (hasCr) {
			const cr = resolved.changes.find(step => isCreatureTransformationCrOp(step.op ?? step.type));
			const pb = resolved.changes.find(step => (step.op ?? step.type) === "setProficiencyBonus");
			if (!cr || !pb || pb.value !== cr.receipt.proficiency.after) return false;
		}
		return ["setType:", "grantSense:", "grantImmunity:", "grantConditionImmunity:", "setAbility:con", "setHitPoints:"].every(key => seen.has(key));
	}
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== "catalog:dracolich|mm"
		|| !isDracolichIdentity(resolved.identity) || Object.hasOwn(resolved, "automation")) return false;
	if (!Array.isArray(resolved.eligibility) || !resolved.eligibility.some(rule => rule?.dmApproval === true)) return false;
	if (!Array.isArray(resolved.changes)) return false;
	const op = step => step?.op ?? step?.type;
	if (resolved.changes.some(step => !["setType", "grantResistance", "grantImmunity", "grantConditionImmunity", "addEntry", "removeEntry"].includes(op(step)))) return false;
	const types = resolved.changes.filter(step => op(step) === "setType");
	const additions = resolved.changes.filter(step => op(step) === "addEntry");
	const removals = resolved.changes.filter(step => op(step) === "removeEntry");
	if (types.length !== 1 || types[0].value !== "undead"
		|| additions.length !== 2 || new Set(additions.map(step => step.entry?.name)).size !== 2
		|| additions.some(step => step.section !== "trait" || step.entry?.source !== "MM" || !["Magic Resistance", "Undead Nature"].includes(step.entry?.name))
		|| removals.length > 1 || removals.some(step => step.section !== "trait" || typeof step.match?.name !== "string" || step.match.name.trim().toLowerCase() !== "amphibious"
			|| typeof step.match.source !== "string" || !step.match.source.trim() || step.match.source === "$chassis")) return false;
	const options = resolved.selectedOptions;
	if (!options || Object.keys(options).sort().join(",") !== "automation-age,automation-lair,automation-nature,automation-physiology") return false;
	const matches = (key, values) => Array.isArray(options[key]) && options[key].length === values.length && options[key].every((value, index) => value === values[index]);
	return ["adult", "ancient"].some(age => matches("automation-age", [age]))
		&& matches("automation-nature", ["true-dragon", "not-shadow"])
		&& matches("automation-physiology", ["amphibious-only"])
		&& matches("automation-lair", ["retain"]);
}

function compileCreatureTransformation ({resolved, current, chassisSource = current?.source, inputs = {}, proficiencyContext = null, legendaryGroups, baseline}) {
	const fail = (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") => {
		const error = new Error(message);
		error.code = code;
		throw error;
	};
	if (resolved?.version === 2 && resolved.id === "catalog:undead|scre") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileUndead({resolved, current, inputs, chassisSource});
	}
	if (resolved?.version === 2 && resolved.id === "catalog:fallen angel|scre") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileFallenAngel({resolved, current, inputs, chassisSource});
	}
	if (resolved?.version === 2 && resolved.id === "catalog:fey beast|scre") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileFeyBeast({resolved, current, inputs, chassisSource});
	}
	if (resolved?.version === 2 && getLycanthropeProfile(resolved.id)) {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileLycanthrope({resolved, current, chassisSource, inputs, baseline});
	}
	if (resolved?.version === 2 && resolved.id === "catalog:vampire|mm") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileVampire({resolved, current, chassisSource, inputs, baseline});
	}
	if (resolved?.version === 2 && getSporeShadowProfile(resolved.id)) {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileSporeShadow({resolved, current, chassisSource, inputs, legendaryGroups});
	}
	if (resolved?.version === 2 && (Object.hasOwn(inputs || {}, "reanimation") || ["skeleton", "skeletal-wyrmling"].includes(resolved.automation?.profile))) {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		return compileReanimation({resolved, current, chassisSource, inputs, legendaryGroups});
	}
	if (resolved?.version === 2 && resolved.kind === "catalog" && resolved.id === "catalog:half-dragon|mm") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.keys(inputs).length) fail("Half-Dragon needs only its ancestry and size choices; additional automation inputs are unsupported.");
		const options = resolved.selectedOptions;
		if (!options || Object.keys(options).sort().join(",") !== "ancestry,size"
			|| ![options.ancestry, options.size].every(value => Array.isArray(value) && value.length === 1)
			|| !Object.hasOwn(HALF_DRAGON_RESISTANCE, options.ancestry[0]) || !Object.hasOwn(HALF_DRAGON_SIZES, options.size[0])) {
			fail("Choose exactly one Half-Dragon ancestry and one breath size.");
		}
		const [ancestry] = options.ancestry;
		const [size] = options.size;
		const type = typeof current.type === "string" ? current.type : current.type?.type;
		if (!["beast", "humanoid", "giant", "monstrosity"].includes(type)) fail("Half-Dragon requires a beast, humanoid, giant, or monstrosity.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		if (!Array.isArray(current.size) || current.size.length !== 1 || !SIZES.has(current.size[0])) fail("Half-Dragon requires one concrete current size to select its sourced breath bracket.");
		if (!HALF_DRAGON_SIZES[size].includes(current.size[0])) fail("The selected Half-Dragon breath size does not match the current target.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		const row = resolved.automation.halfDragonBreaths.find(it => it.ancestry === ancestry && it.size === size);
		const compiled = copy(resolved);
		delete compiled.automation;
		compiled.eligibility = [{types: ["beast", "humanoid", "giant", "monstrosity"]}, {sizes: copy(HALF_DRAGON_SIZES[size])}];
		compiled.selectedOptions["automation-breath"] = [`${row.donor.name.toLowerCase()}|mm`];
		compiled.changes = [
			{op: "grantSense", sense: "blindsight", range: 10},
			{op: "grantSense", sense: "darkvision", range: 60},
			{op: "grantLanguage", value: "Draconic"},
			{op: "grantResistance", value: HALF_DRAGON_RESISTANCE[ancestry]},
			{op: "addEntry", section: "action", entry: copy(row.action)},
		];
		compiled.manualReview = [{field: "cr", reason: "The source's CR 2/7/8 thresholds are optional guidance, not eligibility floors. This staged breath profile retains CR; estimated CR and override integration await rollout."}];
		assertChanges(compiled.changes);
		if (!isCompiledCreatureTransformation(compiled)) throw new Error("Half-Dragon could not compile its selected sourced breath.");
		return compiled;
	}
	if (resolved?.version === 2 && resolved.kind === "catalog" && resolved.id === "catalog:zombie|dmg") {
		assertAutomation(resolved.automation, resolved.identity);
		assertIdentity(current);
		if (!resolved.selectedOptions || Object.keys(resolved.selectedOptions).length) throw new Error("Staged Zombie numerics do not support additional option groups.");
		if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.keys(inputs).some(key => !["bindings", "cr", "proficiencies"].includes(key))) fail("Zombie numerics accept only explicit bindings and optional M3 CR/proficiency inputs.");
		const hasCr = Object.hasOwn(inputs, "cr");
		if (Object.hasOwn(inputs, "proficiencies") && !hasCr) fail("Proficiency reconciliation requires explicit M3 CR inputs.");
		if (hasCr && (!Object.hasOwn(inputs, "bindings") || !inputs.cr || Object.keys(inputs.cr).sort().join(",") !== "assumptions,table")) fail("M3 CR estimation requires explicit M2b bindings and cr:{table,assumptions}.");
		assertChanges(resolved.changes);
		const abilities = {};
		for (const step of resolved.changes.filter(it => it.op === "adjustAbility")) {
			if (!Number.isInteger(current[step.ability]) || current[step.ability] < 1 || current[step.ability] > 30) fail(`${step.ability} needs a supported current ability score.`);
			abilities[step.ability] = Math.max(step.floor, current[step.ability] + step.amount);
		}
		let numeric = compileCreatureTransformationStats({current, abilities, hp: {mode: resolved.automation.hitPoints}});
		let bound = [];
		let proficiency;
		if (Object.hasOwn(inputs, "bindings")) {
			const bindings = inputs.bindings;
			if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || Object.keys(bindings).some(key => !["armor", "entries", "proficiencyBonus"].includes(key))) fail("Zombie M2b bindings need explicit armor and entry policies, with optional current proficiencyBonus; they cannot grant new spells or change PB.");
			if (hasCr) proficiency = getCreatureTransformationCrProficiency({current, proficiencyBonus: bindings.proficiencyBonus, proficiencyContext, answer: inputs.cr.assumptions?.proficiencyAnswer});
			bound = compileCreatureTransformationBindings({current, abilities, chassisSource, ...bindings, ...hasCr ? {proficiencyBonus: proficiency.before} : {}});
		}
		let cr;
		if (hasCr) {
			const statistics = {...current,
				...abilities,
				hp: numeric.find(it => it.op === "setHitPoints")?.value ?? current.hp,
				ac: bound.find(it => it.op === "setArmorClass")?.value ?? current.ac};
			cr = estimateCreatureTransformationCr({current: statistics, ...inputs.cr, proficiencyBonus: inputs.bindings.proficiencyBonus, proficiencyContext});
			const nextProficiencyBonus = cr.receipt.proficiency.after;
			numeric = compileCreatureTransformationStats({current, abilities, hp: {mode: resolved.automation.hitPoints}, proficiencyBonus: proficiency.before, nextProficiencyBonus, bindings: inputs.proficiencies ?? {}});
			if (!numeric.some(it => it.op === "setProficiencyBonus")) numeric.push({op: "setProficiencyBonus", value: nextProficiencyBonus});
			bound = compileCreatureTransformationBindings({current, abilities, chassisSource, ...inputs.bindings, proficiencyBonus: proficiency.before, nextProficiencyBonus});
		}
		const compiled = copy(resolved);
		delete compiled.automation;
		compiled.selectedOptions = {"automation-numerics": ["zombie-dmg-m2a"]};
		if (Object.hasOwn(inputs, "bindings")) compiled.selectedOptions["automation-bindings"] = ["zombie-dmg-m2b"];
		if (hasCr) compiled.selectedOptions["automation-cr"] = ["zombie-dmg-m3"];
		compiled.changes = [...compiled.changes.filter(it => it.op !== "adjustAbility"), ...numeric, ...bound, ...cr ? [cr] : []];
		compiled.manualReview = compiled.manualReview.filter(it => it.field !== "hp" && it.field !== "abilities");
		if (Object.hasOwn(inputs, "bindings")) compiled.manualReview = compiled.manualReview.filter(it => it.field !== "ac" && it.field !== "attacks");
		if (hasCr) {
			compiled.manualReview = compiled.manualReview.filter(it => it.field !== "cr");
			compiled.manualReview.push({field: "cr", reason: "CR is a DMG 2014 numeric estimate, not a playtested rating. Its frozen assumptions and any explicit override require DM review."});
		}
		compiled.manualReview.push({field: "traits", reason: `${Object.hasOwn(inputs, "bindings") ? "Numeric/binding" : "Numeric-only"} stage: Undead Fortitude, lost capabilities and language restrictions remain unresolved; this is not complete Zombie automation.`});
		assertChanges(compiled.changes, {allowStats: true});
		if (!isCompiledCreatureTransformation(compiled)) throw new Error("The staged Zombie numeric recipe cannot compile to the supported concrete profile.");
		return compiled;
	}
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== "catalog:dracolich|mm") throw new Error("Only staged version-2 Half-Dragon, Dracolich or Zombie numeric compilation is supported.");
	assertAutomation(resolved.automation, resolved.identity);
	if (!resolved.selectedOptions || Object.keys(resolved.selectedOptions).length) throw new Error("Staged Dracolich does not support additional option groups.");
	assertIdentity(current);
	const type = typeof current.type === "string" ? current.type : current.type?.type;
	if (type !== "dragon") fail("Dracolich requires a living true dragon.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)
		|| Object.keys(inputs).some(key => !["age", "trueDragon", "shadowDragon", "physiology", "lairActions"].includes(key))) {
		fail("Dracolich inputs must specify age, true-dragon status, shadow status, physiology and lair decisions.");
	}
	if (["wyrmling", "young"].includes(inputs.age) || inputs.trueDragon === false || inputs.shadowDragon === true) {
		fail("Only an adult or ancient true dragon that is not a shadow dragon can become a dracolich.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	}
	if (!["adult", "ancient"].includes(inputs.age) || inputs.trueDragon !== true || inputs.shadowDragon !== false) {
		fail("Confirm adult or ancient age, true-dragon status, and that the subject is not a shadow dragon.");
	}
	if (inputs.physiology !== "amphibious-only") fail("Review living-physiology traits: this staged profile supports only Amphibious removal; other decisions require later guided support.");
	if (inputs.lairActions !== "retain") fail("Choose to retain existing lair actions; changing them requires later guided support.");
	if (current.trait != null && !Array.isArray(current.trait)) throw new Error("Dracolich traits must be an array.");
	const traits = current.trait || [];
	if (traits.some(it => it.name?.trim().toLowerCase() === "living shadow")) {
		fail("A shadow dragon cannot become a dracolich.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	}
	const amphibious = traits.filter(it => it.name?.trim().toLowerCase() === "amphibious");
	if (amphibious.length > 1) fail("Amphibious matches multiple traits; choose the source-qualified physiology trait before applying.", "CREATURE_TRANSFORMATION_ENTRY_MATCH");
	const compiled = copy(resolved);
	delete compiled.automation;
	compiled.eligibility.push({dmApproval: true});
	compiled.selectedOptions = {
		"automation-age": [inputs.age],
		"automation-nature": ["true-dragon", "not-shadow"],
		"automation-physiology": ["amphibious-only"],
		"automation-lair": ["retain"],
	};
	compiled.changes.push(...copy(resolved.automation.changes));
	if (amphibious.length) {
		const entry = amphibious[0];
		const source = !entry.source || entry.source === "$chassis" ? chassisSource : entry.source;
		if (typeof source !== "string" || !source.trim()) throw new Error("Amphibious requires a resolvable source identity.");
		compiled.changes.push({op: "removeEntry", section: "trait", match: {name: entry.name, source}});
	}
	compiled.manualReview = copy(REVIEW_CHASSIS);
	assertChanges(compiled.changes);
	if (!isCompiledCreatureTransformation(compiled)) throw new Error("The staged Dracolich recipe cannot compile to the supported concrete profile.");
	return compiled;
}

export {compileCreatureTransformation, getCreatureTransformationCandidates, isCompiledCreatureTransformation, pLoadCreatureTransformationCandidates, resolveCreatureTransformation};
