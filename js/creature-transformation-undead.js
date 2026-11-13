import {isTransformationEntry} from "./creature-transformation-entries.js";
import {compileCreatureTransformationStats, getCreatureTransformationProficiencyBonus, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, compileCreatureTransformationInnateSpellcasting, isCreatureTransformationBindingChange, observeCreatureTransformationBindings} from "./creature-transformation-bindings.js";
import {getCreatureTransformationCrProficiency} from "./creature-transformation-cr.js";
import {isReanimationChange} from "./creature-transformation-reanimation.js";

const ID = "catalog:undead|scre";
const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary"];
const MODES = ["walk", "fly", "swim", "climb", "burrow"];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const GROUPS = {
	category: ["ghostly", "skeletal", "vampiric", "zombie", "ghoulish", "mummified"],
	"ghostly-strikes": ["spectral-strikes", "withering-strikes"],
	"ghostly-features": ["etherealness"],
	"vampiric-weaknesses": ["forbiddance", "running-water", "stake-to-heart", "sunlight"],
	"ghoulish-features": ["ghoulish-strikes", "stench"],
	"mummified-features": ["rotting-strikes"],
	miscellaneous: ["deathly-aura", "detect-life", "ethereal-sight", "headless", "bestow-curse", "chill-touch", "magic-resistance", "necrotic-absorption", "overwhelming-necrosis", "shadow-stealth", "sunlight-sensitivity", "touch-of-death", "turn-immunity", "turn-resistance", "dreadful-glare"],
};
const CATEGORY = {
	ghostly: ["ghost-flight", "ghost-abilities", "ghost-defenses", "incorporeal-movement"],
	skeletal: ["skeletal-abilities", "skeletal-vulnerability"],
	vampiric: ["physical-resistance", "superior-darkvision", "draining-strikes", "regeneration", "spider-climb"],
	zombie: ["slowed-movement", "zombie-abilities", "undead-fortitude"],
	ghoulish: ["ghoulish-immunity", "ghoulish-strikes"],
	mummified: ["mummy-movement", "mummy-abilities", "mummy-defenses", "rotting-strikes"],
};
const EXTRA = [...new Set(Object.values(CATEGORY).flat())];
const DECISIONS = ["additionalTraits", "alignment", "allowUnusualType", "bindings", "abilityOrder", "ghostAbility", "ghostDamage", "ghostWeapons", "ghostFlight", "movementOrder", "drainAttack", "spellAbility", "components", "glareAbility", "headless", "movementRounding", "proficiencyBonus", "challengeRating", "senses"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => signature(a) === signature(b);
const canonical = value => value.trim().toLowerCase();
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const identity = (entry, source) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? source : entry.source});
const matches = (a, b) => match(a) && match(b) && canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);
const speedValue = value => integer(value, 0, 1000) || (keys(value, ["number"], ["condition"]) && integer(value.number, 0, 1000) && (value.condition === undefined || text(value.condition)));
const speed = value => keys(value, [], [...MODES, "canHover", "alternate"]) && MODES.some(mode => Object.hasOwn(value, mode))
	&& MODES.every(mode => value[mode] === undefined || speedValue(value[mode]))
	&& (value.canHover === undefined || typeof value.canHover === "boolean")
	&& (value.alternate === undefined || (keys(value.alternate, [], MODES) && Object.values(value.alternate).every(values => Array.isArray(values) && values.length <= 20 && values.every(speedValue))));
const ALIGNMENTS = [["L", "G"], ["N", "G"], ["C", "G"], ["L", "N"], ["N"], ["C", "N"], ["L", "E"], ["N", "E"], ["C", "E"], ["U"]];
const alignment = value => ALIGNMENTS.some(allowed => same(allowed, value));

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Undead: ${message}`);
	error.code = code;
	throw error;
}

function selections (value, compiled = false) {
	if (!keys(value, Object.keys(GROUPS), compiled ? ["automation-undead", "automation-undead-inputs"] : [])) fail("Use exactly the existing seven Undead option groups.");
	for (const [group, allowed] of Object.entries(GROUPS)) {
		const selected = value[group];
		if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(id => !allowed.includes(id))
			|| (["category", "ghostly-strikes"].includes(group) && selected.length > 1) || (group === "category" && selected.length !== 1)) fail(`Invalid ${group} selection.`);
	}
	return new Set([...CATEGORY[value.category[0]], ...Object.entries(GROUPS).filter(([group]) => group !== "category").flatMap(([group]) => value[group])]);
}

export function isUndeadCatalog (candidate) {
	return candidate.optionGroups?.length === 7 && candidate.optionGroups.every((group, index) => {
		const [id, options] = Object.entries(GROUPS)[index];
		return group.id === id && group.selection === (["category", "ghostly-strikes"].includes(id) ? "one" : "any")
			&& group.required === (id === "category") && same(group.options.map(option => option.id), options);
	});
}

export function isUndeadOp (op) {
	return ["setUndeadNature", "setUndeadMovement", "setUndeadEntry", "setUndeadSenses"].includes(op);
}

export function isUndeadChange (step, key = "op") {
	switch (step?.[key]) {
		case "setUndeadNature": return keys(step, [key, "value", "alignment"])
			&& isReanimationChange({op: "setReanimationType", value: step.value}) && alignment(step.alignment);
		case "setUndeadMovement": return keys(step, [key, "value"]) && speed(step.value);
		case "setUndeadEntry": return keys(step, [key, "section", "match", "entry"]) && SECTIONS.includes(step.section) && match(step.match) && isTransformationEntry(step.entry);
		case "setUndeadSenses": return keys(step, [key, "value"]) && strings(step.value);
		default: return false;
	}
}

function entries (current, source) {
	return SECTIONS.flatMap(section => {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100)) fail(`Resolve the bounded ${section} array.`);
		const seen = new Set();
		return (current[section] || []).map(entry => {
			if (!record(entry) || !Array.isArray(entry.entries)) fail(`Resolve the source-qualified ${section} entry content.`);
			const selected = identity(entry, source);
			const id = signature({name: canonical(selected.name || ""), source: canonical(selected.source || "")});
			if (!match(selected) || seen.has(id)) fail(`Resolve duplicate or missing ${section} name/source identities.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			seen.add(id);
			return {section, match: selected, entry};
		});
	});
}

function mapText (value, fn) {
	if (typeof value === "string") return fn(value);
	if (Array.isArray(value)) return value.map(part => mapText(part, fn));
	if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, ["entries", "entry", "items", "rows"].includes(key) ? mapText(part, fn) : part]));
	return value;
}

function kind (item, strict = false) {
	const content = JSON.stringify(item.entry.entries);
	const tags = [...content.matchAll(/\{@atk(?:r)? ([^{}]+)}/gi)].flatMap(tag => tag[1].toLowerCase().split(",").map(value => value.trim()));
	if (strict) {
		const location = `${item.section} "${item.match.name}|${item.match.source}"`;
		if (/\b(?:melee|ranged)(?: or (?:melee|ranged))? (?:weapon|spell)(?: or (?:weapon|spell))? attack\s*:/i.test(content)) fail(`Unsupported untagged attack in ${location}; normalize its attack and damage tags before applying an attack-dependent Undead clause.`);
		if (tags.some(value => !["mw", "rw", "ms", "rs"].includes(value))) fail(`Unsupported attack classification in ${location}; resolve its weapon/spell and melee/ranged tags explicitly.`);
		if (tags.some(value => /^[mr]w$/.test(value)) && /\b(?:bludgeoning|piercing|slashing) damage\b/i.test(content.replace(/\{@damage [^{}]+}\)?\s+(?:bludgeoning|piercing|slashing) damage\b/gi, ""))) fail(`Unsupported untagged physical damage in ${location}; normalize every physical damage component before applying an attack-dependent Undead clause.`);
	}
	if (!tags.length) return null;
	return {weapon: tags.some(value => /^[mr]w$/.test(value)), melee: tags.some(value => /^m[ws]$/.test(value)), mixed: tags.some(value => /^[mr]s$/.test(value)) && tags.some(value => /^[mr]w$/.test(value))};
}

function getCr (current, answer) {
	const raw = record(current.cr) ? current.cr.cr : current.cr;
	const value = {"1/8": 0.125, "1/4": 0.25, "1/2": 0.5}[raw] ?? (/^(?:[0-9]|[12][0-9]|30)$/.test(raw) ? Number(raw) : undefined);
	if (answer !== undefined && (value !== undefined || ![0, 0.125, 0.25, 0.5, ...Array.from({length: 30}, (_, index) => index + 1)].includes(answer))) fail("challengeRating may resolve only an absent/ambiguous CR, not override the target's actual rating.");
	return value ?? answer;
}

function getPb (current, answer) {
	const explicit = getCreatureTransformationProficiencyBonus(current, answer, {checkNote: true});
	if (explicit !== undefined) return explicit;
	return getCreatureTransformationCrProficiency({current}).before;
}

function analyze ({current, chassisSource, selected, answer = {}}) {
	if (!keys(answer, [], DECISIONS)) fail("Unsupported undead decisions; arbitrary fields and paths are not allowed.");
	const features = selections(selected);
	const extra = answer.additionalTraits ?? [];
	if (!Array.isArray(extra) || new Set(extra).size !== extra.length || extra.some(id => !EXTRA.includes(id))) fail("additionalTraits must select distinct finite source clauses, not a second template or arbitrary effects.");
	extra.forEach(id => features.add(id));
	const used = new Set(["additionalTraits", "alignment"]);
	const proficiency = () => {
		if (answer.proficiencyBonus !== undefined) used.add("proficiencyBonus");
		return getPb(current, answer.proficiencyBonus);
	};
	const requireChoice = (key, valid, facts) => {
		used.add(key);
		if (!Object.hasOwn(answer, key) || !valid(answer[key])) fail(`Resolve ${key}: ${facts}`);
		return answer[key];
	};
	if (selected.category[0] === "ghostly" && !features.has("spectral-strikes") && !features.has("withering-strikes")) {
		const damage = requireChoice("ghostDamage", value => ["force", "necrotic"].includes(value), "choose Spectral (force) or Withering (necrotic) Strikes");
		features.add(damage === "force" ? "spectral-strikes" : "withering-strikes");
	}
	const type = typeof current.type === "string" ? {type: current.type} : current.type;
	if (!["beast", "dragon", "giant", "humanoid", "monstrosity"].includes(type?.type)) {
		if (requireChoice("allowUnusualType", value => typeof value === "boolean", "DM discretion for this creature type") !== true) fail("The DM did not approve this unusual creature type.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	}
	const nature = {...structuredClone(type), type: "undead"};
	let aligned = answer.alignment;
	if (aligned === undefined && alignment(current.alignment) && !current.alignmentPrefix) {
		aligned = current.alignment.includes("U") || current.alignment.includes("E") ? current.alignment : current.alignment.length === 1 ? ["N", "E"] : [current.alignment[0], "E"];
	}
	if (!alignment(aligned)) aligned = requireChoice("alignment", alignment, "one concrete DM-selected alignment, including unaligned");
	const changes = [{op: "setUndeadNature", value: nature, alignment: structuredClone(aligned)}];
	const all = entries(current, chassisSource);
	if (["ghost-abilities", "spectral-strikes", "withering-strikes", "draining-strikes"].some(id => features.has(id))) all.forEach(item => kind(item, true));
	const abilities = {};
	const getScore = ability => {
		if (!integer(current[ability], 1, 30)) fail(`Resolve the actual ${ability} score.`);
		return abilities[ability] ?? current[ability];
	};
	const half = ability => { abilities[ability] = Math.max(1, Math.floor(getScore(ability) / 2)); };
	let abilityOrder = ["ghost-abilities", "mummy-abilities", "skeletal-abilities", "zombie-abilities"].filter(id => features.has(id));
	const overlapping = abilityOrder.filter(id => id !== "ghost-abilities").length > 1;
	if (overlapping) abilityOrder = requireChoice("abilityOrder", value => Array.isArray(value) && value.length === abilityOrder.length && new Set(value).size === value.length && value.every(id => abilityOrder.includes(id)), "choose the order of the selected overlapping ability clauses");
	for (const feature of abilityOrder) {
		if (feature === "ghost-abilities") half("str");
		else if (feature === "mummy-abilities") half("int");
		else {
			abilities.int = Math.min(getScore("int"), feature === "zombie-abilities" ? 3 : 6);
			half("wis"); half("cha");
		}
	}
	changes.push(...compileCreatureTransformationStats({current, abilities, hp: {mode: "retain"}}));
	let bindings;
	if (Object.keys(abilities).length || features.has("ghost-abilities")) {
		bindings = requireChoice("bindings", value => keys(value, ["armor", "entries"]), "the existing M2 armor/entry declarations (including explicit retention of source-fixed rules)");
		const bound = compileCreatureTransformationBindings({current, abilities, chassisSource, ...bindings, proficiencyBonus: proficiency()});
		changes.push(...bound);
	}
	const needCr = ["stench", "rotting-strikes", "turn-immunity", "touch-of-death"].some(id => features.has(id));
	let cr;
	if (needCr) {
		cr = getCr(current, answer.challengeRating);
		if (cr === undefined) cr = requireChoice("challengeRating", value => Number.isFinite(value) && value >= 0 && value <= 30, "the current challenge rating for source thresholds");
		if (answer.challengeRating !== undefined) used.add("challengeRating");
	}
	const mod = ability => Math.floor((getScore(ability) - 10) / 2);
	const dc = ability => 8 + mod(ability) + proficiency();
	const upsert = (section, name, rule) => {
		const entry = {name, source: "SCRE", entries: Array.isArray(rule) ? rule : [rule]};
		const existing = all.find(item => item.section === section && matches(item.match, entry));
		changes.push(existing ? {op: "setUndeadEntry", section, match: existing.match, entry} : {op: "addEntry", section, entry});
	};
	const rewritten = new Map();
	const rewrite = (item, fn) => {
		const key = `${item.section}:${signature(item.match)}`;
		if (!rewritten.has(key)) {
			const numeric = changes.find(step => step.op === "setEntryNumbers" && step.section === item.section && matches(step.match, item.match));
			if (numeric) changes.splice(changes.indexOf(numeric), 1);
			rewritten.set(key, {item, entry: {name: item.entry.name, source: item.match.source, entries: structuredClone(numeric?.entries ?? item.entry.entries)}});
		}
		const value = rewritten.get(key);
		value.entry.entries = fn(value.entry.entries);
	};
	const resist = value => {
		if (!(current.immune || []).includes(value) && !(value === "necrotic" && features.has("necrotic-absorption"))) changes.push({op: "grantResistance", value});
	};
	resist("necrotic");
	changes.push({op: "grantImmunity", value: "poison"}, ...["poisoned", "exhaustion"].map(value => ({op: "grantConditionImmunity", value})));
	upsert("trait", "Undead Nature", "This creature doesn't require air, food, drink, or sleep.");
	if (features.has("ghost-defenses")) {
		for (const damage of ["acid", "cold", "fire", "lightning", "thunder"]) resist(damage);
		for (const value of ["charmed", "frightened", "grappled", "paralyzed", "petrified", "prone", "restrained"]) changes.push({op: "grantConditionImmunity", value});
	}
	if (["ghost-defenses", "mummy-defenses", "physical-resistance"].some(id => features.has(id))) {
		for (const value of PHYSICAL) {
			if (!(current.immune || []).includes(value) && !(current.resist || []).includes(value)) changes.push({op: "grantConditionalDefense", kind: "resistance", value, when: "nonmagical"});
		}
	}
	if (features.has("mummy-defenses")) changes.push({op: "grantVulnerability", value: "fire"}, ...["charmed", "frightened", "paralyzed"].map(value => ({op: "grantConditionImmunity", value})));
	if (features.has("skeletal-vulnerability")) changes.push({op: "grantVulnerability", value: "bludgeoning"});
	if (features.has("ghoulish-immunity")) changes.push({op: "grantConditionImmunity", value: "charmed"});
	const senses = structuredClone(current.senses || []);
	if (!strings(senses)) fail("Resolve the current sense array without discarding unrelated senses.");
	const senseChoices = answer.senses || [];
	if (answer.senses !== undefined) used.add("senses");
	if (!Array.isArray(senseChoices) || senseChoices.length > 2 || !senseChoices.every(choice => keys(choice, ["sense", "index", "range"]) && ["darkvision", "blindsight"].includes(choice.sense) && integer(choice.index, 0, 99) && integer(choice.range, 0, 1000))
		|| new Set(senseChoices.map(choice => choice.sense)).size !== senseChoices.length) fail("senses must bind at most one actual darkvision/blindsight range each.");
	const usedSenses = new Set();
	const sense = (name, range) => {
		const found = senses.flatMap((value, index) => new RegExp(`\\b${name}\\b`, "i").test(value) ? [{value, index}] : []);
		if (found.length > 1 || (found.length && !new RegExp(`^${name}\\b`, "i").test(found[0].value))) fail(`Separate compound or duplicate ${name} entries before applying the source clause.`);
		if (!found.length) { senses.push(`${name} ${range} ft.`); return; }
		const item = found[0];
		const plain = new RegExp(`^${name} (\\d+) ft\\.$`, "i").exec(item.value);
		if (plain) {
			if (senseChoices.some(choice => choice.sense === name)) fail(`${name} range is already concrete.`);
			senses[item.index] = `${name} ${Math.max(Number(plain[1]), range)} ft.`;
		} else {
			const choice = senseChoices.find(choice => choice.sense === name && choice.index === item.index);
			if (!choice) fail(`Resolve senses: bind the actual conditional ${name} range; its conditions will be retained.`);
			usedSenses.add(choice);
			const parsed = new RegExp(`^(${name} )\\d+( ft\\..*)$`, "i").exec(item.value);
			if (!parsed || Number(item.value.match(/\d+/)?.[0]) !== choice.range) fail(`Resolve the supported numeric ${name} entry; prose ranges cannot be rewritten safely.`);
			senses.push(`${name} ${range} ft.`);
		}
	};
	sense("darkvision", features.has("superior-darkvision") ? 120 : 60);
	if (features.has("headless")) {
		if (!requireChoice("headless", value => typeof value === "boolean", "confirm it formerly had eyes or a head and no longer does")) fail("Headless requires former eyes or a head.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		sense("blindsight", 60);
		const radius = Number(senses.find(value => /^blindsight \d+ ft\.$/i.test(value)).match(/\d+/)[0]);
		upsert("trait", "Headless", `This creature formerly had eyes or a head but no longer does. It has unconditional blindsight out to a range of ${radius} feet and retains any greater conditional blindsight. It is blind beyond its applicable blindsight radius.`);
	}
	if (usedSenses.size !== senseChoices.length) fail("An unused/stale sense range was supplied.");
	if (!same(senses, current.senses)) changes.push({op: "setUndeadSenses", value: senses});
	if (["ghost-flight", "slowed-movement", "mummy-movement"].some(id => features.has(id))) {
		const movement = typeof current.speed === "number" ? {walk: current.speed} : structuredClone(current.speed);
		if (!speed(movement)) fail("Resolve movement to the existing finite speed/alternate/condition contract.");
		const number = value => typeof value === "number" ? value : value.number;
		const movementFeatures = ["ghost-flight", "mummy-movement", "slowed-movement"].filter(id => features.has(id));
		let order = movementFeatures;
		if (movementFeatures.length > 1) order = requireChoice("movementOrder", value => Array.isArray(value) && value.length === movementFeatures.length && new Set(value).size === value.length && value.every(id => movementFeatures.includes(id)), "choose the order of the selected source movement clauses");
		const transform = (value, feature) => {
			let feet = number(value);
			if (!feet) return structuredClone(value);
			if (feature === "mummy-movement") {
				feet = Math.max(20, feet / 2);
				if (!Number.isInteger(feet)) {
					const rounding = requireChoice("movementRounding", value => ["down", "up"].includes(value), "round fractional feet after halving");
					feet = Math[rounding === "down" ? "floor" : "ceil"](feet);
				}
			}
			if (feature === "slowed-movement") feet = Math.max(5, feet - 10);
			return typeof value === "number" ? feet : {...value, number: feet};
		};
		let result = movement;
		for (const feature of order) {
			if (feature === "ghost-flight") {
				let flight = result.fly;
				const hasFlight = flight !== undefined && number(flight) > 0;
				if (!hasFlight) {
					const ambiguous = record(result.walk) || record(result.swim) || result.alternate?.walk?.length || result.alternate?.swim?.length;
					if (ambiguous) {
						const binding = requireChoice("ghostFlight", value => keys(value, ["mode"], ["alternate"]) && ["walk", "swim"].includes(value.mode) && (value.alternate === undefined || integer(value.alternate, 0, 19)), "choose an actual walking/swimming branch; its condition is preserved");
						flight = binding.alternate === undefined ? result[binding.mode] : result.alternate?.[binding.mode]?.[binding.alternate];
						if (flight === undefined) fail("The chosen source speed does not exist.");
					} else flight = Math.max(number(result.walk ?? 0), number(result.swim ?? 0));
				}
				const alternates = structuredClone(result.alternate?.fly || []);
				if (!hasFlight && record(flight) && flight.condition) {
					const baseline = Math.max(...["walk", "swim"].map(mode => typeof result[mode] === "number" ? result[mode] : result[mode]?.condition ? 0 : result[mode]?.number ?? 0));
					alternates.push(flight);
					flight = baseline;
				}
				result = {walk: 0, fly: flight, canHover: true, ...alternates.length ? {alternate: {fly: alternates}} : {}};
			} else {
				for (const mode of MODES) {
					if (result[mode] !== undefined) result[mode] = transform(result[mode], feature);
					if (result.alternate?.[mode]) result.alternate[mode] = result.alternate[mode].map(value => transform(value, feature));
				}
			}
		}
		changes.push({op: "setUndeadMovement", value: result});
	}
	if (features.has("incorporeal-movement")) upsert("trait", "Incorporeal Movement", "This creature can move through other creatures and objects as if they were difficult terrain. It takes 5 ({@damage 1d10}) force damage if it ends its turn inside an object.");
	const weapons = all.filter(item => kind(item)?.weapon);
	const spectral = features.has("spectral-strikes");
	const withering = features.has("withering-strikes");
	if (spectral && withering) fail("Choose force OR necrotic damage for Spectral/Withering Strikes.");
	if (features.has("ghost-abilities")) {
		const ability = requireChoice("ghostAbility", value => ["str", "dex", "cha"].includes(value), "retain Strength, or use Dexterity or Charisma for the monster's Strength-based attack/damage rolls");
		// M2 declarations establish which tokens actually use Strength, not arithmetic guesses.
		const ghostMod = mod(ability);
		for (const item of all.filter(item => kind(item))) {
			const binding = bindings.entries.find(binding => binding.section === item.section && matches(binding.match, item.match));
			if (ability === "str" || !binding || binding.mode === "retain") continue;
			const chosen = binding.numbers.filter(number => number.mode === "ability" && number.ability === "str" && ["hit", "damage"].includes(number.kind));
			rewrite(item, content => content.map((rule, paragraph) => {
				if (typeof rule !== "string") return rule;
				let damage = 0; let hit = 0;
				return rule.replace(/(?:(\d+) \()?(\{@(hit|damage) ([^{}]+)})(\))?/g, (whole, average, tag, type, raw, close) => {
					const token = type === "hit" ? hit++ : damage++;
					if (!chosen.some(number => number.paragraph === paragraph && number.kind === type && number.token === token)) return whole;
					const delta = ghostMod - mod("str");
					if (type === "hit") return `{@hit ${Number(raw) + delta}}`;
					const dice = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(raw);
					if (!dice || average === undefined || !close) fail("Ghost ability substitution needs M2-supported damage averages.");
					const bonus = (dice[3] ? Number(`${dice[3]}${dice[4]}`) : 0) + delta;
					return `${Math.max(0, Math.floor(Number(dice[1]) * (Number(dice[2]) + 1) / 2 + bonus))} ({@damage ${dice[1]}d${dice[2]}${bonus ? ` ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}` : ""}})`;
				});
			}));
		}
	}
	if (spectral || withering) {
		const damageType = spectral ? "force" : "necrotic";
		const declarations = requireChoice("ghostWeapons", value => Array.isArray(value) && value.length <= 100, "bind every actual weapon entry and its physical damage components, including explicit empty arrays for unrelated damage");
		const usedWeapons = new Set();
		for (const item of weapons) {
			const choices = declarations.filter(choice => keys(choice, ["section", "match", "components"]) && choice.section === item.section && matches(choice.match, item.match));
			if (choices.length !== 1 || usedWeapons.has(choices[0])) fail("Bind each source-qualified weapon entry exactly once.");
			const choice = choices[0]; usedWeapons.add(choice);
			if (!Array.isArray(choice.components) || choice.components.length > 100 || new Set(choice.components).size !== choice.components.length || choice.components.some(index => !integer(index, 0, 99))) fail("Use distinct bounded weapon damage-component indices.");
			let index = 0;
			const found = new Set();
			rewrite(item, content => mapText(content, rule => rule.replace(/(\{@damage [^{}]+}\)?\s+)(bludgeoning|piercing|slashing) damage\b/g, (whole, prefix) => {
				const at = index++;
				if (!choice.components.includes(at)) return whole;
				found.add(at);
				return `${prefix}${damageType} damage`;
			})));
			if (found.size !== choice.components.length) fail("A ghost weapon component is absent or not physical damage.");
			if (!kind(item).mixed && index && found.size !== index) fail("Every physical component of an unambiguously weapon-only attack must change damage type.");
		}
		if (usedWeapons.size !== declarations.length) fail("A ghost weapon binding references a duplicate or unrelated entry.");
	}
	if (features.has("ghoulish-strikes")) upsert("trait", "Ghoulish Strikes (1/Turn)", `When this creature hits a creature other than an elf or undead, the target must succeed on a {@dc ${dc("con")}} Constitution saving throw or be {@condition paralyzed} for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.`);
	if (features.has("stench")) {
		if (cr < 2) fail("Stench requires CR 2 or higher.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		upsert("trait", "Stench", `Any creature that starts its turn within 5 feet of this creature must succeed on a {@dc ${dc("con")}} Constitution saving throw or be {@condition poisoned} until the start of its next turn. On a successful saving throw, the creature is immune to this Stench for 24 hours.`);
	}
	if (features.has("rotting-strikes")) {
		const dice = cr >= 5 ? "2d6" : "1d6";
		const amount = cr >= 5 ? 7 : 3;
		upsert("trait", "Rotting Strikes", `Whenever this creature hits a target with an attack, the target takes an extra ${amount} ({@damage ${dice}}) necrotic damage. If the target is a creature, it must succeed on a {@dc ${dc("con")}} Constitution saving throw or be cursed with mummy rot. The cursed target can't regain hit points, and its hit point maximum decreases by ${amount} ({@dice ${dice}}) for every 24 hours that elapse. If the curse reduces the target's hit point maximum to 0, the target dies, and its body turns to dust. The curse lasts until removed by the {@spell remove curse|PHB} spell or other magic.`);
	}
	if (features.has("draining-strikes")) {
		const attacks = all.filter(item => kind(item));
		const bites = attacks.filter(item => /^bite\b/i.test(item.match.name));
		let selectedAttack = bites.length === 1 ? {section: bites[0].section, match: bites[0].match} : undefined;
		if (!selectedAttack || answer.drainAttack !== undefined) selectedAttack = requireChoice("drainAttack", value => keys(value, ["section", "match"]) && SECTIONS.includes(value.section) && match(value.match), "choose the actual bite or, if absent, one DM-approved melee weapon attack");
		const item = attacks.find(item => item.section === selectedAttack.section && matches(item.match, selectedAttack.match));
		if (!item || (bites.length ? !bites.includes(item) : !kind(item).melee || !kind(item).weapon)) fail("Draining Strikes must bind an existing bite, or one melee weapon attack when no bite exists.");
		const trigger = bites.length ? "this bite attack" : "the melee weapon option of this attack";
		rewrite(item, content => [...content, `Draining Strikes (1/Turn). When ${trigger} hits a living creature, it takes an extra 7 ({@damage 2d6}) necrotic damage, its hit point maximum is reduced by the necrotic damage taken, and this creature regains hit points equal to that reduction. The reduction lasts until the target finishes a long rest. The target dies if this effect reduces its hit point maximum to 0.`]);
	}
	if (features.has("regeneration")) upsert("trait", "Regeneration", "This creature regains 10 hit points at the start of its turn if it has at least 1 hit point and isn't in sunlight or running water. If it takes radiant damage or damage from holy water, this trait doesn't function at the start of its next turn.");
	if (features.has("spider-climb")) upsert("trait", "Spider Climb", "This creature can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check.");
	if (features.has("forbiddance")) {
		if (getScore("int") < 6) fail("Forbiddance requires Intelligence 6 or higher.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		upsert("trait", "Forbiddance", "This creature can't enter a residence without an invitation from one of the occupants.");
	}
	if (features.has("running-water")) upsert("trait", "Harmed by Running Water", "This creature takes 20 acid damage if it ends its turn in running water.");
	if (features.has("stake-to-heart")) upsert("trait", "Stake to the Heart", "This creature is destroyed if a piercing weapon made of wood is driven into its heart while it is incapacitated in its resting place.");
	if (features.has("sunlight")) upsert("trait", "Sunlight Hypersensitivity", "This creature takes 20 radiant damage when it starts its turn in sunlight. While in sunlight, it has disadvantage on attack rolls and ability checks.");
	if (features.has("undead-fortitude")) upsert("trait", "Undead Fortitude", "If damage reduces this creature to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, it drops to 1 hit point instead.");
	if (features.has("deathly-aura")) upsert("trait", "Deathly Aura", "At the start of each of this creature's turns, each non-undead creature within 5 feet of it takes 5 ({@damage 1d10}) cold damage.");
	if (features.has("detect-life")) upsert("trait", "Detect Life", "This creature can magically sense the presence of living creatures up to 5 miles away that aren't undead or constructs. It knows their general direction but not their exact locations.");
	if (features.has("ethereal-sight")) upsert("trait", "Ethereal Sight", "This creature can see 120 feet into the Ethereal Plane when it is on the Material Plane and vice versa.");
	if (features.has("etherealness")) {
		if (!features.has("ethereal-sight") && !all.some(item => item.section === "trait" && canonical(item.match.name) === "ethereal sight")) fail("Etherealness requires selected or retained Ethereal Sight.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		upsert("action", "Etherealness", "This creature enters the Ethereal Plane from the Material Plane, or vice versa. It is visible on the Material Plane while it is in the Border Ethereal, and vice versa, yet it can't affect or be affected by anything on the other plane.");
	}
	if (features.has("magic-resistance")) upsert("trait", "Magic Resistance", "This creature has advantage on saving throws against spells and other magical effects.");
	if (features.has("necrotic-absorption")) {
		changes.push({op: "grantImmunity", value: "necrotic"});
		upsert("trait", "Necrotic Absorption", "This creature is immune to necrotic damage. Whenever it is subjected to necrotic damage, it takes no damage and instead regains hit points equal to the necrotic damage dealt.");
	}
	if (features.has("overwhelming-necrosis")) upsert("trait", "Overwhelming Necrosis", "Necrotic damage this creature deals ignores resistance to necrotic damage. In addition, when it reduces a creature to 0 hit points, the creature immediately suffers one death saving throw failure.");
	if (features.has("sunlight-sensitivity")) upsert("trait", "Sunlight Sensitivity", "While in sunlight, this creature has disadvantage on attack rolls, as well as on Wisdom (Perception) checks that rely on sight.");
	if (features.has("shadow-stealth")) {
		if (!features.has("sunlight-sensitivity") && !all.some(item => item.section === "trait" && canonical(item.match.name) === "sunlight sensitivity")) fail("Shadow Stealth requires selected or retained Sunlight Sensitivity.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		upsert("bonus", "Shadow Stealth", "While in dim light or darkness, this creature can take the Hide action as a bonus action.");
	}
	if (features.has("touch-of-death")) {
		if (!Number.isInteger(cr) && cr >= 1) fail("Touch of Death requires a concrete source die count.");
		const count = Math.max(1, Math.floor(cr));
		upsert("trait", "Touch of Death (1/Day)", `When this creature hits a creature with a melee attack, it can choose to deal an extra ${Math.floor(count * 4.5)} ({@damage ${count}d8}) necrotic damage to the target.`);
	}
	if (features.has("turn-immunity")) {
		if (cr < 5) fail("Turn Immunity requires CR 5 or higher.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		upsert("trait", "Turn Immunity", "This creature is immune to any effect that turns undead.");
	}
	if (features.has("turn-resistance")) upsert("trait", "Turn Resistance", "This creature has advantage on saving throws against any effect that turns undead.");
	if (features.has("dreadful-glare")) {
		const ability = requireChoice("glareAbility", value => ["con", "cha"].includes(value), "Constitution or Charisma determines Dreadful Glare's DC");
		upsert("action", "Dreadful Glare", `This creature targets one creature it can see within 60 feet of it. If the target can see this creature, it must succeed on a {@dc ${dc(ability)}} Wisdom saving throw against this magic or become {@condition frightened} until the end of this creature's next turn. If the target fails the saving throw by 5 or more, it is also {@condition paralyzed} for the same duration. A target that succeeds on the saving throw is immune to the Dreadful Glare of all undead for the next 24 hours.`);
		const multi = all.filter(item => item.section === "action" && canonical(item.match.name) === "multiattack");
		if (multi.length > 1) fail("Resolve the actual source-qualified Multiattack before adding Dreadful Glare.");
		if (multi.length) rewrite(multi[0], content => [...content, "This creature can also use its Dreadful Glare as part of this Multiattack."]);
	}
	if (features.has("bestow-curse") || features.has("chill-touch")) {
		const ability = requireChoice("spellAbility", value => ["wis", "cha"].includes(value), "Wisdom or Charisma for the selected innate spells");
		const components = requireChoice("components", value => Array.isArray(value) && new Set(value).size === value.length && value.length <= 3 && value.every(component => ["V", "S", "M"].includes(component)), "the source does not waive spell components; explicitly adjudicate required V/S/M components");
		changes.push(compileCreatureTransformationInnateSpellcasting({current,
			abilities,
			proficiencyBonus: proficiency(),
			spellcasting: {name: "Innate Spellcasting (Undead)",
				source: "SCRE",
				ability,
				dcFixed: 8,
				attackFixed: 0,
				components,
				spells: [...features.has("bestow-curse") ? [{spell: "bestow curse|PHB", usage: "daily", uses: 1, each: true}] : [], ...features.has("chill-touch") ? [{spell: "chill touch|PHB", usage: "will"}] : []]}}));
	}
	for (const {item, entry} of rewritten.values()) changes.push({op: "setUndeadEntry", section: item.section, match: item.match, entry});
	for (const key of Object.keys(answer)) if (!used.has(key)) fail(`The ${key} decision is unrelated or stale on this target.`);
	if (!changes.every(step => validStep(step))) fail("The complete source profile exceeds its closed concrete operation contract.");
	return changes;
}

function validStep (step) {
	const key = Object.hasOwn(step || {}, "op") ? "op" : "type";
	if (isUndeadChange(step, key) || (["setSaveBonus", "setSkillBonus", "setPassivePerception"].includes(step?.[key]) && isCreatureTransformationStatChange(step, key)) || isCreatureTransformationBindingChange(step, key)) return true;
	switch (step?.[key]) {
		case "setAbility": return keys(step, [key, "ability", "value"]) && ["str", "int", "wis", "cha"].includes(step.ability) && integer(step.value, 1, 30);
		case "grantResistance": return keys(step, [key, "value"]) && ["necrotic", "acid", "cold", "fire", "lightning", "thunder"].includes(step.value);
		case "grantImmunity": return keys(step, [key, "value"]) && ["poison", "necrotic"].includes(step.value);
		case "grantVulnerability": return keys(step, [key, "value"]) && ["bludgeoning", "fire"].includes(step.value);
		case "grantConditionImmunity": return keys(step, [key, "value"]) && ["charmed", "exhaustion", "frightened", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained"].includes(step.value);
		case "grantConditionalDefense": return keys(step, [key, "kind", "value", "when"]) && step.kind === "resistance" && PHYSICAL.includes(step.value) && step.when === "nonmagical";
		case "addEntry": return keys(step, [key, "section", "entry"]) && ["trait", "action", "bonus"].includes(step.section) && isTransformationEntry(step.entry) && step.entry.source === "SCRE";
		default: return false;
	}
}

export function observeUndead ({current, selected, chassisSource = current.source}) {
	selections(selected);
	return {key: "profile",
		facts: {
			additionalTraits: EXTRA,
			alignment: ALIGNMENTS,
			creatureType: current.type,
			abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(key => [key, current[key]])),
			entries: observeCreatureTransformationBindings({current, chassisSource}),
			speed: current.speed,
			senses: current.senses || [],
			ghostAbility: ["str", "dex", "cha"],
			ghostDamage: ["force", "necrotic"],
			spellAbility: ["wis", "cha"],
			glareAbility: ["con", "cha"],
			components: ["V", "S", "M"],
			movementRounding: ["down", "up"],
			decisionKeys: DECISIONS,
		}};
}

export function compileUndead ({resolved, current, inputs, chassisSource}) {
	if (resolved.id !== ID || resolved.identity.name !== "Undead" || resolved.identity.source !== "SCRE") fail("Only Undead|SCRE is supported.");
	if (!keys(inputs, [], ["undead"]) || (inputs.undead !== undefined && !record(inputs.undead))) fail("Use only finite undead decisions.");
	const answer = inputs.undead || {};
	const changes = analyze({current, chassisSource, selected: resolved.selectedOptions, answer});
	const receipt = JSON.stringify(answer);
	if (receipt.length > 30_000) fail("The frozen M12 decisions exceed their byte budget.");
	const compiled = {...structuredClone(resolved),
		eligibility: [{dmApproval: true}],
		selectedOptions: {...structuredClone(resolved.selectedOptions), "automation-undead": ["scre-m12"], "automation-undead-inputs": [receipt]},
		changes,
		manualReview: [
			{field: "eligibility", reason: "SCRE remains provisional screenshot attribution; publisher, page and edition are unverified. Half-CR extra-trait count is guidance, not a hard cap."},
			{field: "cr", reason: "M12 retains current CR/XP. Shared estimated CR/override and editor/default rollout remain M13."},
		]};
	delete compiled.automation;
	if (!isCompiledUndead(compiled)) fail("The source profile did not compile within its M12 contract.");
	return compiled;
}

function getAnswer (resolved) {
	selections(resolved.selectedOptions, true);
	const receipt = resolved.selectedOptions["automation-undead-inputs"];
	if (!same(resolved.selectedOptions["automation-undead"], ["scre-m12"]) || !Array.isArray(receipt) || receipt.length !== 1 || typeof receipt[0] !== "string" || receipt[0].length > 30_000) fail("Missing bounded frozen M12 decisions.");
	let answer;
	try { answer = JSON.parse(receipt[0]); } catch { fail("Malformed frozen M12 decisions."); }
	if (!keys(answer, [], DECISIONS)) fail("Unsupported frozen M12 decisions.");
	return answer;
}

export function isCompiledUndead (resolved) {
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== ID || !keys(resolved.identity, ["name", "source"])
		|| resolved.identity.name !== "Undead" || resolved.identity.source !== "SCRE" || Object.hasOwn(resolved, "automation")
		|| !same(resolved.eligibility, [{dmApproval: true}]) || !Array.isArray(resolved.changes) || !resolved.changes.length || resolved.changes.length > 256) return false;
	try { getAnswer(resolved); return resolved.changes.every(validStep); } catch (error) {
		if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
		return false;
	}
}

export function assertUndeadProjection ({resolved, current, chassisSource}) {
	const expected = analyze({current, chassisSource, selected: Object.fromEntries(Object.keys(GROUPS).map(key => [key, resolved.selectedOptions[key]])), answer: getAnswer(resolved)});
	const actual = resolved.changes.map(({op, type, ...fields}) => ({op: op ?? type, ...fields}));
	if (!same(actual, expected)) fail("Frozen effects do not match the complete selected source profile on this actual pre-owner target; re-preview its history.");
}
