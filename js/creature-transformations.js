import {getRenderableSpeciesTrait, isTransformationEntry, isTransformationSpell} from "./creature-transformation-entries.js";

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
const RELATIVE_SPEED_TRAIT = /^(?:Because of your wings, |Thanks to your wings, |Your walking speed is \d+ feet, and )?you have a (flying|swimming|climbing|burrowing) speed equal to your walking speed\.(?: (You can't use this flying speed if you're wearing medium or heavy armor\.))?$/i;
const SIZES = new Set(["T", "S", "M", "L", "H", "G"]);
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const ENTRY_SECTIONS = new Set(["trait", "action", "bonus", "reaction", "legendary"]);
const ENTRY_ROLES = new Set(["breathWeapon", "bite", "healingTouch", "angelicWeapons"]);
const REVIEW_FIELDS = new Set(["ac", "hp", "attacks", "cr", "characterLevel", "eligibility", "abilities", "traits", "spellcasting", "other"]);

const copy = value => structuredClone(value);
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
		throw new Error("Creature transformation requires a nonempty name and source.");
	}
};
const isEntry = isTransformationEntry;
const isEntryMatch = match => {
	const keys = Object.keys(match || {}).sort().join(",");
	return (keys === "name,source" && typeof match.name === "string" && !!match.name.trim() && typeof match.source === "string" && !!match.source.trim())
		|| (keys === "role,source" && ENTRY_ROLES.has(match.role) && typeof match.source === "string" && !!match.source.trim());
};
const assertReview = reviews => {
	if (!Array.isArray(reviews) || !reviews.every(it => REVIEW_FIELDS.has(it?.field) && typeof it.reason === "string" && !!it.reason.trim() && Object.keys(it).sort().join(",") === "field,reason")) {
		throw new Error("Transformation manualReview must contain typed, nonempty DM review items.");
	}
};
const assertEligibility = eligibility => {
	if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) throw new Error("Transformation eligibility must be an object.");
	const allowed = new Set(["types", "sizes", "minCr", "maxCr", "minInt", "maxInt", "requiresTrait", "dmApproval"]);
	if (Object.keys(eligibility).some(key => !allowed.has(key))) throw new Error("Unknown transformation eligibility constraint.");
	if (eligibility.types && (!Array.isArray(eligibility.types) || !eligibility.types.length || eligibility.types.some(it => !CREATURE_TYPES.has(it)))) throw new Error("Invalid creature-type eligibility.");
	if (eligibility.sizes && (!Array.isArray(eligibility.sizes) || !eligibility.sizes.length || eligibility.sizes.some(it => !["T", "S", "M", "L", "H", "G"].includes(it)))) throw new Error("Invalid size eligibility.");
	if (["minCr", "maxCr"].some(key => eligibility[key] != null && (!Number.isFinite(eligibility[key]) || eligibility[key] < 0))) throw new Error("Invalid CR eligibility.");
	if (["minInt", "maxInt"].some(key => eligibility[key] != null && (!Number.isInteger(eligibility[key]) || eligibility[key] < 1 || eligibility[key] > 30))) throw new Error("Invalid Intelligence eligibility.");
	if (eligibility.requiresTrait != null && (typeof eligibility.requiresTrait !== "string" || !eligibility.requiresTrait.trim())) throw new Error("Invalid trait eligibility.");
	if (eligibility.dmApproval != null && typeof eligibility.dmApproval !== "boolean") throw new Error("Invalid DM approval eligibility.");
};
const assertChanges = changes => {
	if (!Array.isArray(changes)) throw new Error("Transformation changes must be an array.");
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
				default: return false;
			}
		})();
		if (!valid) throw new Error(`Invalid transformation change: ${step?.op || "(missing op)"}`);
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
	const relevant = entries.filter(entry => RELATIVE_SPEED_MENTIONS[mode].test(JSON.stringify(entry)));
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
function getCreatureTransformationCandidates ({catalog, races, getVersions}) {
	if (!Array.isArray(catalog?.creatureTransformation) || !Array.isArray(races)) throw new Error("Transformation catalog and resolved races are required.");
	const byId = new Map();
	const append = candidate => {
		assertIdentity(candidate.identity);
		if (
			!candidate.provenance
			|| !["classic", "one", "unverified"].includes(candidate.provenance.edition)
			|| (candidate.provenance.page != null && (!Number.isInteger(candidate.provenance.page) || candidate.provenance.page < 1))
		) throw new Error(`Invalid transformation provenance: ${candidate.id}`);
		assertEligibility(candidate.eligibility);
		assertReview(candidate.manualReview);
		if (!Array.isArray(candidate.prerequisites) || candidate.prerequisites.some(it => typeof it !== "string" || !it.trim())) throw new Error(`Invalid transformation prerequisites: ${candidate.id}`);
		assertChanges(candidate.changes);
		if (!Array.isArray(candidate.optionGroups)) throw new Error(`Invalid transformation option groups: ${candidate.id}`);
		const groupIds = new Set();
		for (const group of candidate.optionGroups) {
			if (!group.id || groupIds.has(group.id)) throw new Error(`Duplicate or missing option group in ${candidate.id}.`);
			groupIds.add(group.id);
			if (!["one", "any"].includes(group.selection) || !Array.isArray(group.options) || !group.options.length) throw new Error(`Invalid option group in ${candidate.id}.`);
			const ids = new Set();
			for (const option of group.options) {
				if (!option.id || ids.has(option.id)) throw new Error(`Duplicate or missing option in ${candidate.id}/${group.id}.`);
				ids.add(option.id);
				assertChanges(option.changes);
				assertReview(option.manualReview);
				if (option.eligibility) assertEligibility(option.eligibility);
			}
		}
		for (const group of candidate.optionGroups) {
			if (!group.appliesTo) continue;
			const parent = candidate.optionGroups.find(it => it.id === group.appliesTo.group);
			if (!parent?.options.some(it => it.id === group.appliesTo.option) || group.required) throw new Error(`Invalid conditional option group in ${candidate.id}/${group.id}.`);
		}
		const matches = byId.get(candidate.id) || [];
		if (matches.length && candidate.kind !== "race") throw new Error(`Duplicate creature transformation identity: ${candidate.id}`);
		const signature = getStableSignature(candidate);
		if (matches.some(it => it.signature === signature)) return;
		matches.push({candidate, signature});
		byId.set(candidate.id, matches);
	};

	for (const recipe of catalog.creatureTransformation) {
		assertIdentity(recipe);
		append({
			...copy(recipe),
			kind: "catalog",
			id: getId("catalog", recipe),
			identity: {name: recipe.name, source: recipe.source},
			manualReview: [...copy(REVIEW_CHASSIS), ...copy(recipe.manualReview)],
		});
	}
	for (const race of races) {
		assertIdentity(race);
		const recipe = getRaceRecipe(race);
		if (race._isBaseRace) recipe.manualReview.push({field: "eligibility", reason: "Select a playable subrace or lineage if required by this species."});
		append(recipe);
		if (!race._versions?.length) continue;
		if (typeof getVersions !== "function") throw new Error(`Race versions cannot be resolved: ${race.name}|${race.source}`);
		for (const [ix, version] of getVersions({...race, __prop: "race"}).entries()) {
			assertIdentity(version);
			const versionRecipe = getRaceRecipe({...version, _baseName: race.name, _baseSource: race.source});
			versionRecipe.id = `${versionRecipe.id}~v:${race.name.toLowerCase()}|${race.source.toLowerCase()}:${ix + 1}`;
			append(versionRecipe);
		}
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

async function pLoadCreatureTransformationCandidates ({dataUtil = globalThis.DataUtil} = {}) {
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
	if (races.some(race => race._copy) && typeof dataUtil.race.pMergeCopy !== "function") {
		throw new Error("Race copies cannot be resolved without DataUtil.race.pMergeCopy.");
	}
	for (const race of races) if (race._copy) await dataUtil.race.pMergeCopy(races, race, {isErrorOnMissing: true});
	return getCreatureTransformationCandidates({
		catalog,
		races,
		getVersions: race => dataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
	});
}

function resolveCreatureTransformation ({candidates, id, selections = {}}) {
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
		if (chosen.length && group.appliesTo && !selections[group.appliesTo.group]?.includes(group.appliesTo.option)) throw new Error(`Option group ${group.id} requires ${group.appliesTo.group}/${group.appliesTo.option}.`);
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
	return {
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
}

export {getCreatureTransformationCandidates, pLoadCreatureTransformationCandidates, resolveCreatureTransformation};
