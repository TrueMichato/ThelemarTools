import {isTransformationEntry} from "./creature-transformation-entries.js";
import {getCreatureTransformationProficiencyBonus, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {getCreatureTransformationCrProficiency} from "./creature-transformation-cr.js";
import {isReanimationChange} from "./creature-transformation-reanimation.js";

const ID = "catalog:fallen angel|scre";
const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary"];
const SPELL_LISTS = ["constant", "will", "ritual", "daily", "rest", "weekly", "monthly", "yearly", "recharge", "charges", "legendary", "spells"];
const FLAT_LISTS = ["constant", "will", "ritual"];
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => signature(a) === signature(b);
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const identity = (entry, source) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? source : entry.source});
const sameIdentity = (a, b) => match(a) && match(b) && canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);
const speedValue = value => integer(value, 0, 1000) || (keys(value, ["number"], ["condition"]) && integer(value.number, 0, 1000) && (value.condition === undefined || text(value.condition)));
const indices = value => Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length && value.every(index => integer(index, 0, 99));
const spell = value => (typeof value === "string" && !!value.trim() && value.length <= 10_000)
	|| (keys(value, ["entry"], ["hidden"]) && typeof value.entry === "string" && !!value.entry.trim() && value.entry.length <= 10_000 && (value.hidden === undefined || typeof value.hidden === "boolean"));
const spellArray = value => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(spell);
const spellList = value => keys(value, ["prop", "spells"], ["key"]) && SPELL_LISTS.includes(value.prop) && spellArray(value.spells)
	&& (FLAT_LISTS.includes(value.prop) ? value.key === undefined : text(value.key) && (value.prop === "spells" ? /^[0-9]$/.test(value.key) : /^(?:[1-9]\d?e?|[1-6])$/.test(value.key)));
const resistance = value => Array.isArray(value) && value.length <= 100 && value.every(part => DAMAGE.includes(part)
	|| (keys(part, ["resist"], ["note", "preNote", "cond"]) && Array.isArray(part.resist) && !!part.resist.length && part.resist.length <= 13 && part.resist.every(type => DAMAGE.includes(type))
		&& ["note", "preNote"].every(key => part[key] === undefined || text(part[key])) && (part.cond === undefined || typeof part.cond === "boolean")));
const radiantPattern = () => /\{@damage ([^{}]+)}(\)?\s+)radiant damage\b/g;
const dice = value => typeof value === "string" && /^[1-9]\d{0,2}d(?:4|6|8|10|12|20)(?:\s*[+-]\s*\d{1,4})?$/.test(value);
const normalizedDice = value => value.replace(/\s+/g, "").toLowerCase();

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Fallen Angel: ${message}`);
	error.code = code;
	throw error;
}

function entries (current, source, sections = [...SECTIONS, "spellcasting"]) {
	return sections.flatMap(section => {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100)) fail(`Resolve the bounded ${section} array.`);
		const seen = new Set();
		return (current[section] || []).map(entry => {
			const selected = identity(entry, source);
			if (!match(selected)) fail(`Resolve the exact ${section} name/source identity.`);
			const id = signature({name: canonical(selected.name), source: canonical(selected.source)});
			if (seen.has(id)) fail(`Duplicate ${section} ${selected.name}|${selected.source}; resolve its identity.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
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

function tokens (item) {
	const found = [];
	if (!isTransformationEntry({name: item.entry.name, source: item.match.source, entries: item.entry.entries})) fail(`Resolve supported concrete rules for ${item.match.name}|${item.match.source}.`);
	mapText(item.entry.entries, rule => {
		for (const result of rule.matchAll(radiantPattern())) found.push({index: found.length, dice: result[1]});
		return rule;
	});
	if (found.length > 100) fail("Too many radiant components in one entry.");
	return found;
}

function weaponAttackKind (item) {
	const rule = JSON.stringify(item.entry.entries);
	const tags = [...rule.matchAll(/\{@atk(?:r)? ([^{}]+)}/gi)];
	if (!tags.length) return /\bweapon attack\b/i.test(rule) ? "mixed" : null;
	const kinds = tags.flatMap(tag => tag[1].toLowerCase().split(",").map(kind => kind.trim()));
	if (!kinds.some(kind => /^[mr]w$/.test(kind))) return null;
	return kinds.every(kind => /^[mr]w$/.test(kind)) ? "weapon" : "mixed";
}

function changedEntry (item, entry) {
	if (!isTransformationEntry(entry)) fail(`The concrete replacement for ${item.match.name} exceeds the bounded entry contract.`);
	return {op: "setFallenAngelEntry", section: item.section, match: item.match, entry};
}

function convert (item, selected, type, name = item.entry.name, source = item.match.source) {
	let index = 0;
	const content = mapText(item.entry.entries, rule => rule.replace(radiantPattern(), (whole, amount, gap) => selected.includes(index++) ? `{@damage ${amount}}${gap}${type} damage` : whole));
	return changedEntry(item, {name, source, entries: content});
}

function getPb (current, declared) {
	return getCreatureTransformationProficiencyBonus(current, declared, {checkNote: true}) ??
		getCreatureTransformationCrProficiency({current}).before;
}

function getUsage (name) {
	const daily = /^Healing Touch \(([1-9]\d?)\/Day\)$/i.exec(name);
	if (daily) return {kind: "day", uses: Number(daily[1])};
	const rest = /^Healing Touch \(([1-9]\d?)\/(Short|Long) Rest\)$/i.exec(name);
	if (rest) return {kind: rest[2].toLowerCase() === "short" ? "shortRest" : "longRest", uses: Number(rest[1])};
	const recharge = /^Healing Touch \{@recharge(?: ([2-6]))?}$/i.exec(name);
	return recharge ? {kind: "recharge", minimum: Number(recharge[1] || 6)} : null;
}

const usage = value => (keys(value, ["kind", "uses"]) && ["day", "shortRest", "longRest"].includes(value.kind) && integer(value.uses, 1, 99))
	|| (keys(value, ["kind", "minimum"]) && value.kind === "recharge" && integer(value.minimum, 2, 6))
	|| (keys(value, ["kind"]) && value.kind === "atWill");
function usageName (value) {
	if (value.kind === "recharge") return ` {@recharge ${value.minimum}}`;
	if (value.kind === "atWill") return " (At Will)";
	return ` (${value.uses}/${{day: "Day", shortRest: "Short Rest", longRest: "Long Rest"}[value.kind]})`;
}

export function isFallenAngelCatalog (candidate) {
	const [group] = candidate.optionGroups || [];
	return candidate.optionGroups?.length === 1 && group.id === "allegiance" && group.selection === "one" && group.required === true
		&& same(group.options.map(option => option.id), ["fallen", "devilsworn"]);
}

export function isFallenAngelOp (op) {
	return ["setFallenAngelNature", "setFallenAngelFlight", "setFallenAngelEntry", "setFallenAngelSpells", "setDevilswornResistances", "setDevilswornSenses"].includes(op);
}

export function isFallenAngelChange (step, key = "op") {
	switch (step?.[key]) {
		case "setFallenAngelNature": return keys(step, [key], ["value"]) && (step.value === undefined
			|| (record(step.value) && isReanimationChange({op: "setReanimationType", value: {...step.value, type: "undead"}}) && step.value.type === "fiend" && step.value.tags?.includes("devil")));
		case "setFallenAngelFlight": return keys(step, [key], ["value", "alternate"]) && (step.value !== undefined || step.alternate !== undefined)
			&& (step.value === undefined || speedValue(step.value)) && (step.alternate === undefined || (Array.isArray(step.alternate) && step.alternate.length <= 20 && step.alternate.every(speedValue)));
		case "setFallenAngelEntry": return keys(step, [key, "section", "match", "entry"]) && SECTIONS.includes(step.section) && match(step.match) && isTransformationEntry(step.entry);
		case "setFallenAngelSpells": return keys(step, [key, "match", "lists"]) && match(step.match) && Array.isArray(step.lists) && step.lists.length <= 100 && step.lists.every(spellList)
			&& new Set(step.lists.map(list => `${list.prop}:${list.key ?? ""}`)).size === step.lists.length;
		case "setDevilswornResistances": return keys(step, [key, "value"]) && resistance(step.value);
		case "setDevilswornSenses": return keys(step, [key, "value", "tags"]) && strings(step.value) && strings(step.tags);
		default: return false;
	}
}

function analyze ({current, chassisSource, allegiance, answer = {}, observing = false}) {
	if (!keys(answer, [], ["angel", "proficiencyBonus", "charisma", "weapons", "healing", "innate", "spellExceptions", "silver", "sight"])) fail("Unsupported fallenAngel decisions.");
	const controls = [];
	const used = new Set();
	const choose = (key, automatic, facts, valid) => {
		if (automatic !== undefined) {
			if (Object.hasOwn(answer, key)) fail(`${key} is automatic on this target; an unrelated or stale answer cannot override it.`);
			return automatic;
		}
		used.add(key);
		controls.push({key, facts});
		if (!Object.hasOwn(answer, key)) {
			if (observing) return undefined;
			fail(`Resolve the target-qualified ${key} binding.`);
		}
		if (!valid(answer[key])) fail(`Invalid target-qualified ${key} binding.`);
		return answer[key];
	};
	const type = typeof current.type === "string" ? {type: current.type} : current.type;
	if (type?.type !== "celestial") fail("Only a celestial angel can receive this template.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (choose("angel", current.group?.includes("Angels") ? true : undefined, {type: current.type, group: current.group ?? [], choices: [true, false]}, value => typeof value === "boolean") === false) fail("The target is not an angel.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	let pb;
	try { pb = getPb(current); } catch (error) {
		if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
		// Contradictory explicit metadata is not an absent PB and cannot be overridden.
		if (current.profBonus !== undefined || current.pbNote !== undefined) throw error;
	}
	pb = choose("proficiencyBonus", pb, {current: current.profBonus ?? current.pbNote ?? current.cr ?? null, minimum: 1, maximum: 30}, value => integer(value, 1, 30));
	const charisma = choose("charisma", integer(current.cha, 1, 30) ? current.cha : undefined, {current: current.cha ?? null, minimum: 1, maximum: 30}, value => integer(value, 1, 30));
	const all = entries(current, chassisSource);
	const proseInnate = all.find(item => item.section !== "spellcasting" && /^innate spellcasting\b/i.test(item.match.name));
	if (proseInnate) fail(`Innate spellcasting in ${proseInnate.section} ${proseInnate.match.name}|${proseInnate.match.source} requires supported spellcasting structure with actual spell-use lists; prose cannot be left unchanged as a complete profile.`);
	const traits = all.filter(item => item.section === "trait");
	const namedWeapons = traits.filter(item => /^angelic weapons\b/i.test(item.match.name));
	const possibleWeapons = namedWeapons.length ? namedWeapons : traits.filter(item => /\bweapon\b/i.test(JSON.stringify(item.entry.entries)) && /\bradiant\b/i.test(JSON.stringify(item.entry.entries)) && tokens(item).length);
	const attacks = all.filter(item => item.section !== "trait" && item.section !== "spellcasting" && /\bradiant damage\b/i.test(JSON.stringify(item.entry.entries)))
		.map(item => ({...item, kind: weaponAttackKind(item)})).filter(item => item.kind);
	const weaponFacts = possibleWeapons.map(item => ({match: item.match, tokens: tokens(item)}));
	const attackFacts = possibleWeapons.length ? attacks.map(item => ({section: item.section, match: item.match, kind: item.kind, tokens: tokens(item)})) : [];
	let automaticWeapons = possibleWeapons.length ? undefined : null;
	if (namedWeapons.length === 1 && weaponFacts[0].tokens.length === 1 && dice(weaponFacts[0].tokens[0].dice)
		&& attackFacts.every(item => item.kind === "weapon" && sameIdentity(item.match, {...item.match, source: namedWeapons[0].match.source}) && item.tokens.length === 1 && normalizedDice(item.tokens[0].dice) === normalizedDice(weaponFacts[0].tokens[0].dice))) {
		automaticWeapons = {match: namedWeapons[0].match, token: 0, attacks: attackFacts.map(item => ({section: item.section, match: item.match, tokens: [0]}))};
	}
	const weapons = choose("weapons", automaticWeapons, {traits: weaponFacts, attacks: attackFacts, allowNone: !namedWeapons.length},
		value => (value === null && !namedWeapons.length) || (keys(value, ["match", "token", "attacks"]) && match(value.match) && integer(value.token, 0, 99)
			&& Array.isArray(value.attacks) && value.attacks.length <= 100 && value.attacks.every(item => keys(item, ["section", "match", "tokens"]) && SECTIONS.includes(item.section) && match(item.match) && indices(item.tokens))));
	const changes = [{op: "setFallenAngelNature"}];
	if (allegiance === "devilsworn") {
		const value = {...structuredClone(type), type: "fiend", tags: [...structuredClone(type.tags || [])]};
		if (!value.tags.includes("devil")) value.tags.push("devil");
		changes[0].value = value;
		if (!isFallenAngelChange(changes[0])) fail("Resolve the retained type tags and swarm metadata before adding the devil tag.");
	}
	if (!record(current.speed)) fail("Resolve the current movement map; no flying speed is invented.");
	const reduce = value => {
		if (!speedValue(value)) fail("Resolve the actual flight speed to a number or {number,condition}.");
		const reduced = number => number === 0 ? 0 : Math.max(30, number - 30);
		return typeof value === "number" ? reduced(value) : {...structuredClone(value), number: reduced(value.number)};
	};
	if (current.speed.fly !== undefined || current.speed.alternate?.fly !== undefined) {
		if (current.speed.alternate?.fly !== undefined && (!Array.isArray(current.speed.alternate.fly) || current.speed.alternate.fly.length > 20)) fail("Resolve the bounded alternate flight speeds.");
		changes.push({op: "setFallenAngelFlight",
			...current.speed.fly !== undefined ? {value: reduce(current.speed.fly)} : {},
			...current.speed.alternate?.fly !== undefined ? {alternate: current.speed.alternate.fly.map(reduce)} : {}});
	}
	if (current.skill !== undefined && !record(current.skill)) fail("Resolve the current skill map without losing its other capabilities.");
	for (const skill of ["deception", "intimidation"]) {
		const raw = current.skill?.[skill];
		if (raw !== undefined && (typeof raw !== "string" || !/^[+-]?\d+$/.test(raw) || !integer(Number(raw), -10_000, 10_000))) fail(`Resolve the actual ${skill} bonus; conditional capabilities cannot be flattened.`);
		if (pb !== undefined && charisma !== undefined) changes.push({op: "setSkillBonus", skill, value: Math.max(Number(raw ?? -10_000), pb + Math.floor((charisma - 10) / 2))});
	}
	changes.push({op: "grantResistance", value: "necrotic"});
	if (weapons) {
		const selected = possibleWeapons.find(item => sameIdentity(item.match, weapons.match));
		const selectedToken = selected && tokens(selected)[weapons.token];
		if (!selected || !selectedToken || !dice(selectedToken.dice)) fail("Choose the actual Angelic Weapons radiant-damage token, not an example bonus.");
		const usedAttacks = new Set();
		const damageType = allegiance === "devilsworn" ? "fire" : "necrotic";
		changes.push(convert(selected, [weapons.token], damageType, allegiance === "devilsworn" ? "Hellish Weapons" : "Scornful Weapons", "SCRE"));
		for (const item of attacks) {
			const binding = weapons.attacks.find(binding => binding.section === item.section && sameIdentity(binding.match, item.match));
			if (!binding || usedAttacks.has(binding)) fail("Bind every actual weapon entry once, including explicit empty tokens for unrelated radiant damage.");
			usedAttacks.add(binding);
			const available = tokens(item);
			if (binding.tokens.some(index => !available[index] || !dice(available[index].dice))) fail("Choose existing concrete weapon damage tokens.");
			if (binding.tokens.length) changes.push(convert(item, binding.tokens, damageType));
		}
		if (usedAttacks.size !== weapons.attacks.length) fail("A weapon answer references an unrelated or duplicate target entry.");
	}
	const healingCandidates = all.filter(item => item.section === "action" && /^healing touch\b/i.test(item.match.name));
	const automaticHealing = healingCandidates.length === 0 ? null : healingCandidates.length === 1 && getUsage(healingCandidates[0].match.name)
		? {match: healingCandidates[0].match, usage: getUsage(healingCandidates[0].match.name)} : undefined;
	const healing = choose("healing", automaticHealing, {actions: healingCandidates.map(item => ({match: item.match, entry: item.entry})), usageKinds: ["day", "shortRest", "longRest", "atWill", "recharge"]},
		value => keys(value, ["match", "usage"]) && match(value.match) && usage(value.usage));
	if (healing) {
		const selected = healingCandidates.find(item => sameIdentity(item.match, healing.match));
		if (!selected) fail("The Healing Touch answer does not match an actual target action.");
		const observed = getUsage(selected.match.name);
		if (observed && !same(observed, healing.usage)) fail("The declared uses disagree with the actual Healing Touch usage.");
		if (pb !== undefined && charisma !== undefined) {
			changes.push(changedEntry(selected, {
				name: `Corrupting Touch${usageName(healing.usage)}`,
				source: "SCRE",
				entries: [`The angel touches one creature, which must make a {@dc ${8 + pb + Math.floor((charisma - 10) / 2)}} Wisdom saving throw against magic. On a failure, the creature is {@condition charmed} for 1 hour and obeys the angel's spoken or telepathic commands.`,
					"If the angel or one of its allies harms the charmed creature, or the creature receives a suicidal command, it can repeat the saving throw, ending the effect on a success. A successful save, or the effect ending for that creature, makes it immune to this angel's Corrupting Touch for 24 hours."],
			}));
		}
	}
	const casting = all.filter(item => item.section === "spellcasting");
	const ambiguousCasting = casting.filter(item => !/^innate spellcasting\b/i.test(item.match.name) && !/\binnately cast\b/i.test(JSON.stringify(item.entry.headerEntries)) && !/^spellcasting$/i.test(item.match.name));
	const innate = choose("innate", ambiguousCasting.length ? undefined : [], {entries: ambiguousCasting.map(item => ({match: item.match, entry: item.entry})), exception: "dispel evil and good", notException: "limited-use detect evil and good"},
		value => Array.isArray(value) && value.length === ambiguousCasting.length && value.every(part => keys(part, ["match", "value"], ["exceptions"]) && match(part.match) && typeof part.value === "boolean"
			&& (part.exceptions === undefined || (Array.isArray(part.exceptions) && part.exceptions.length <= 100 && part.exceptions.every(exception => keys(exception, ["prop", "index", "value"], ["key"]) && SPELL_LISTS.includes(exception.prop) && integer(exception.index, 0, 99) && typeof exception.value === "boolean"))))
			&& ambiguousCasting.every(item => value.filter(part => sameIdentity(part.match, item.match)).length === 1));
	const innateEntries = casting.filter(item => /^innate spellcasting\b/i.test(item.match.name) || /\binnately cast\b/i.test(JSON.stringify(item.entry.headerEntries)) || innate?.some(part => sameIdentity(part.match, item.match) && part.value));
	const lists = [];
	const uncertain = [];
	for (const item of innateEntries) {
		const classification = innate?.find(part => sameIdentity(part.match, item.match));
		const usedExceptions = new Set();
		for (const prop of SPELL_LISTS) {
			if (item.entry[prop] === undefined) continue;
			const data = item.entry[prop];
			const parts = FLAT_LISTS.includes(prop) ? [[undefined, data]] : record(data) ? Object.entries(data) : null;
			if (!parts) fail(`Resolve the actual ${item.match.name} ${prop} spell uses.`);
			for (const [key, row] of parts) {
				const values = prop === "spells" ? row?.spells : row;
				if (!spellArray(values)) fail(`Resolve the bounded ${prop} ${key ?? ""} spell list.`);
				const retained = [];
				values.forEach((value, index) => {
					const rule = typeof value === "string" ? value : value.entry;
					if (prop === "will" || /^\{@spell dispel evil and good(?:\|[^{}]*)?}/i.test(rule)) retained.push(value);
					else if (!/^\{@spell [^{}]+}/i.test(rule)) {
						if (!classification) uncertain.push({match: item.match, prop, ...key !== undefined ? {key} : {}, index, value});
						else {
							const decisions = classification.exceptions?.filter(part => part.prop === prop && part.key === key && part.index === index);
							if (decisions?.length !== 1) fail("Classifying custom magic as innate also requires its exact opaque-spell exception decisions; only Dispel Evil and Good is an exception.");
							usedExceptions.add(decisions[0]);
							if (decisions[0].value) retained.push(value);
						}
					}
				});
				lists.push({item, prop, key, values, retained});
			}
		}
		if ((classification?.exceptions?.length || 0) !== usedExceptions.size) fail("A custom innate-spell exception references an unrelated or duplicate spell.");
	}
	if (innate?.some(part => !part.value && part.exceptions?.length)) fail("Ordinary casting cannot carry innate exception decisions.");
	const exceptions = choose("spellExceptions", uncertain.length ? undefined : [], {spells: uncertain, exception: "dispel evil and good", notException: "limited-use detect evil and good"},
		value => Array.isArray(value) && value.length === uncertain.length && value.every(part => keys(part, ["match", "prop", "index", "value"], ["key"]) && match(part.match) && SPELL_LISTS.includes(part.prop) && integer(part.index, 0, 99) && typeof part.value === "boolean")
			&& uncertain.every(item => value.filter(part => sameIdentity(part.match, item.match) && part.prop === item.prop && part.key === item.key && part.index === item.index).length === 1));
	for (const item of innateEntries) {
		const concrete = lists.filter(list => list.item === item).flatMap(list => {
			const retained = list.values.filter((value, index) => list.retained.includes(value) || exceptions?.some(part => sameIdentity(part.match, item.match) && part.prop === list.prop && part.key === list.key && part.index === index && part.value));
			return retained.length ? [{prop: list.prop, ...list.key !== undefined ? {key: list.key} : {}, spells: structuredClone(retained)}] : [];
		});
		if (concrete.some(list => !spellList(list))) fail("Resolve the concrete original spell-use keys; unsupported keys cannot be silently rewritten.");
		changes.push({op: "setFallenAngelSpells", match: item.match, lists: concrete});
	}
	if (allegiance === "devilsworn") {
		const resist = current.resist || [];
		if (!resistance(resist)) fail("Resolve concrete resistance groups without losing their other conditions.");
		const ambiguous = resist.flatMap((part, index) => record(part) && part.resist.some(type => PHYSICAL.includes(type))
			&& (part.note || part.preNote) && !/^(?:from nonmagical (?:attacks|weapons)(?: that aren't silvered)?|from nonmagical attacks that aren't silvered)$/i.test(part.note || "")
			? [{index, value: part}] : []);
		const silver = choose("silver", ambiguous.length ? undefined : [], {groups: ambiguous, choices: [true, false]},
			value => Array.isArray(value) && value.length === ambiguous.length && value.every(part => keys(part, ["index", "value"]) && integer(part.index, 0, 99) && typeof part.value === "boolean")
				&& ambiguous.every(item => value.filter(part => part.index === item.index).length === 1));
		const converted = resist.flatMap((part, index) => {
			if (!record(part) || !part.resist.some(type => PHYSICAL.includes(type))) return [structuredClone(part)];
			const applies = ambiguous.some(item => item.index === index) ? silver?.find(item => item.index === index)?.value : /^from nonmagical (?:attacks|weapons)/i.test(part.note || "") && !/silvered/i.test(part.note);
			if (!applies) return [structuredClone(part)];
			const physical = part.resist.filter(type => PHYSICAL.includes(type));
			const other = part.resist.filter(type => !PHYSICAL.includes(type));
			const note = `${part.note || "from nonmagical attacks"}; silvered weapons bypass this resistance`;
			if (!text(note)) fail("The qualified resistance exceeds its bounded text limit.");
			return [...other.length ? [{...structuredClone(part), resist: other}] : [], {...structuredClone(part), resist: physical, note, cond: true}];
		});
		for (const type of ["cold", "fire", "necrotic"]) if (!converted.includes(type)) converted.push(type);
		changes.push({op: "setDevilswornResistances", value: converted}, {op: "grantImmunity", value: "poison"}, {op: "grantConditionImmunity", value: "poisoned"});
		if ((current.senses !== undefined && !strings(current.senses)) || (current.senseTags !== undefined && !strings(current.senseTags))) fail("Resolve the actual senses and sense tags.");
		const senses = current.senses || [];
		if (senses.some(value => /\btruesight\b/i.test(value) && (!/^truesight\b/i.test(value) || /[;,]|\b(?:blindsight|darkvision|tremorsense)\b/i.test(value)
			|| [...value.matchAll(/\btruesight\b/gi)].length > 1))) fail("Compound truesight entries may contain unrelated senses; separate each sense into its own array entry before applying Devilsworn.");
		const unclear = senses.flatMap((value, index) => /\btruesight\b/i.test(value) && !/^truesight [1-9]\d{0,3} ft\.(?: .*)?$/i.test(value) ? [{index, value}] : []);
		const sight = choose("sight", unclear.length ? undefined : [], {senses: unclear},
			value => Array.isArray(value) && value.length === unclear.length && value.every(part => keys(part, ["index", "range", "condition"]) && integer(part.index, 0, 99) && integer(part.range, 1, 1000) && (part.condition === "" || text(part.condition)))
				&& unclear.every(item => value.filter(part => part.index === item.index).length === 1));
		const convertedSenses = senses.map((value, index) => {
			if (!/\btruesight\b/i.test(value)) return value;
			if (!unclear.some(item => item.index === index)) return value.replace(/^truesight/i, "darkvision");
			const declaration = sight?.find(part => part.index === index);
			return declaration ? `darkvision ${declaration.range} ft.${declaration.condition ? ` ${declaration.condition}` : ""}` : value;
		});
		if (senses.some(value => /\btruesight\b/i.test(value))) changes.push({op: "setDevilswornSenses", value: convertedSenses, tags: [...new Set([...(current.senseTags || []).filter(tag => tag !== "U"), "D"])]});
		const devilSight = {name: "Devil's Sight", source: "SCRE", entries: ["Magical darkness does not impede this creature's darkvision."]};
		const existing = traits.find(item => sameIdentity(item.match, devilSight));
		changes.push(existing ? changedEntry(existing, devilSight) : {op: "addEntry", section: "trait", entry: devilSight});
	} else if (["silver", "sight"].some(key => Object.hasOwn(answer, key))) fail("Devilsworn-only answers cannot be used for Fallen.");
	for (const key of Object.keys(answer)) if (!used.has(key)) fail(`The ${key} answer is not required on this actual target.`);
	return {controls, changes};
}

export function observeFallenAngel ({current, chassisSource = current.source, allegiance}) {
	return analyze({current, chassisSource, allegiance, observing: true}).controls;
}

function allegiance (selected, compiled = false) {
	if (!keys(selected, ["allegiance"], compiled ? ["automation-fallen-angel", "automation-fallen-angel-inputs"] : [])
		|| !Array.isArray(selected.allegiance) || selected.allegiance.length !== 1 || !["fallen", "devilsworn"].includes(selected.allegiance[0])) fail("Choose exactly one existing allegiance.");
	return selected.allegiance[0];
}

export function compileFallenAngel ({resolved, current, inputs, chassisSource}) {
	if (resolved.id !== ID || resolved.identity.name !== "Fallen Angel" || resolved.identity.source !== "SCRE") fail("Only Fallen Angel|SCRE is supported.");
	if (!keys(inputs, [], ["fallenAngel"]) || (inputs.fallenAngel !== undefined && !record(inputs.fallenAngel))) fail("Only bounded fallenAngel decisions are supported.");
	const answer = inputs.fallenAngel || {};
	const selected = allegiance(resolved.selectedOptions);
	const {changes} = analyze({current, chassisSource, allegiance: selected, answer});
	const receipt = JSON.stringify(answer);
	if (receipt.length > 30_000) fail("The frozen M11 decisions exceed their byte budget.");
	const compiled = {...structuredClone(resolved),
		eligibility: [{types: ["celestial"], dmApproval: true}],
		selectedOptions: {allegiance: [selected], "automation-fallen-angel": ["scre-m11"], "automation-fallen-angel-inputs": [receipt]},
		changes,
		manualReview: [
			{field: "eligibility", reason: "SCRE is provisional screenshot attribution; page, edition and publisher remain unverified."},
			{field: "cr", reason: "M11 retains current CR/XP; estimated CR/override, editor and default rollout remain M13."},
		]};
	delete compiled.automation;
	if (!isCompiledFallenAngel(compiled)) throw new Error("Fallen Angel did not produce its closed M11 profile.");
	return compiled;
}

function getAnswer (resolved) {
	allegiance(resolved.selectedOptions, true);
	if (!keys(resolved.selectedOptions, ["allegiance", "automation-fallen-angel", "automation-fallen-angel-inputs"])
		|| !same(resolved.selectedOptions["automation-fallen-angel"], ["scre-m11"])
		|| !Array.isArray(resolved.selectedOptions["automation-fallen-angel-inputs"]) || resolved.selectedOptions["automation-fallen-angel-inputs"].length !== 1
		|| typeof resolved.selectedOptions["automation-fallen-angel-inputs"][0] !== "string" || resolved.selectedOptions["automation-fallen-angel-inputs"][0].length > 30_000) fail("Missing bounded M11 decisions.");
	try { return JSON.parse(resolved.selectedOptions["automation-fallen-angel-inputs"][0]); } catch { fail("Malformed M11 decisions."); }
}

export function isCompiledFallenAngel (resolved) {
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== ID || !keys(resolved.identity, ["name", "source"])
		|| resolved.identity.name !== "Fallen Angel" || resolved.identity.source !== "SCRE" || Object.hasOwn(resolved, "automation")
		|| !same(resolved.eligibility, [{types: ["celestial"], dmApproval: true}]) || !Array.isArray(resolved.changes) || !resolved.changes.length || resolved.changes.length > 256) return false;
	try {
		const answer = getAnswer(resolved);
		if (!record(answer)) return false;
		return resolved.changes.every(step => {
			const key = Object.hasOwn(step || {}, "op") ? "op" : "type";
			if (isFallenAngelChange(step, key)) return true;
			if (step?.[key] === "setSkillBonus") return ["deception", "intimidation"].includes(step.skill) && isCreatureTransformationStatChange(step, key);
			if (["grantResistance", "grantImmunity", "grantConditionImmunity"].includes(step?.[key])) {
				return keys(step, [key, "value"])
				&& step.value === {grantResistance: "necrotic", grantImmunity: "poison", grantConditionImmunity: "poisoned"}[step[key]];
			}
			return step?.[key] === "addEntry" && keys(step, [key, "section", "entry"]) && step.section === "trait" && isTransformationEntry(step.entry) && step.entry.name === "Devil's Sight" && step.entry.source === "SCRE";
		});
	} catch (error) {
		if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
		return false;
	}
}

export function assertFallenAngelProjection ({resolved, current, chassisSource}) {
	const expected = analyze({current, chassisSource, allegiance: resolved.selectedOptions.allegiance[0], answer: getAnswer(resolved)}).changes;
	const actual = resolved.changes.map(({op, type, ...fields}) => ({op: op ?? type, ...fields}));
	if (!same(actual, expected)) fail("Frozen effects do not match the complete selected source profile on this actual pre-owner target; re-preview its history.");
}

export {SPELL_LISTS as FALLEN_ANGEL_SPELL_LISTS};
