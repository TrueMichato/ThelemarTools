import {isTransformationEntry} from "./creature-transformation-entries.js";
import {getCreatureTransformationProficiencyBonus, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";
import {compileCreatureTransformationLair, isReanimationChange} from "./creature-transformation-reanimation.js";

const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary"];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const ELEMENTAL = ["acid", "cold", "fire", "lightning", "poison"];
const DAMAGE = [...PHYSICAL, ...ELEMENTAL, "force", "necrotic", "psychic", "radiant", "thunder"];
const PROFILES = {
	"catalog:spore servant|mm": {name: "Spore Servant", source: "MM", profile: "spore-servant"},
	"catalog:shadow dragon|mm": {name: "Shadow Dragon", source: "MM", profile: "shadow-dragon-mm"},
	"catalog:shadow dragon|beg": {name: "Shadow Dragon", source: "BEG", profile: "shadow-dragon-beg"},
};
const record = value => value != null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => signature(a) === signature(b);
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const identity = (entry, source) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? source : entry.source});
const sameIdentity = (a, b) => match(a) && match(b) && canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const damagePattern = () => /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)(?=\s+damage\b)/gi;
const sporeDamagePattern = () => /(\d+) \(\{@damage ([^{}]+)}\) (acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage/g;
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = value => /^\d+$/.test(value) ? Number(value) : words.indexOf(value);
const SPORE_TRAITS = [
	{name: "Limited Blindsight", source: "MM", entries: ["The servant has blindsight to 30 feet and is blind beyond that distance."]},
	{name: "Rapport Orders", source: "MM", entries: ["The servant knows no languages. It follows myconid orders conveyed through rapport spores, giving priority to the most powerful myconid's orders."]},
];
const lethalBreath = "A humanoid reduced to 0 hit points by this damage dies. An undead {@creature shadow|MM} rises from the corpse under the dragon's control and takes its turn immediately after the dragon in initiative.";
// These sources were checked independently. Neither template changes alignment, CR,
// legendary actions, regional effects, or mythic rules.
const SHADOW_TRAITS = {
	MM: [
		{name: "Living Shadow", source: "MM", entries: ["In dim light or darkness, the dragon resists all damage other than force, psychic, and radiant damage."]},
		{name: "Shadow Stealth", source: "MM", entries: ["In dim light or darkness, the dragon can take the {@action Hide} action as a bonus action."]},
		{name: "Sunlight Sensitivity", source: "MM", entries: ["In sunlight, the dragon has disadvantage on attack rolls and on Wisdom ({@skill Perception}) checks that depend on sight."]},
	],
	BEG: [
		{name: "Living Shadow", source: "BEG", entries: ["In dim light or darkness, the dragon resists all damage other than force, psychic, and radiant damage."]},
		{name: "Shadow Stealth", source: "BEG", entries: ["In dim light or darkness, the dragon can take the {@action Hide} action as a bonus action."]},
		{name: "Sunlight Sensitivity", source: "BEG", entries: ["In sunlight, the dragon has disadvantage on attack rolls and on Wisdom ({@skill Perception}) checks that depend on sight."]},
	],
};

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Spore/Shadow: ${message}`);
	error.code = code;
	throw error;
}

function compoundDamage (rule) {
	const type = `(?:${DAMAGE.join("|")})`;
	return new RegExp(`\\b${type}(?:(?:\\s+(?:and|or|and/or)\\s+|,\\s*(?:(?:and|or)\\s+)?|\\s*/\\s*)${type})+\\s+damage\\b`, "i").exec(rule)?.[0];
}

export function getSporeShadowProfile (id) {
	return PROFILES[id]?.profile;
}

function speedValue (value, minimum = 0) {
	return integer(value, minimum, 1000) || (keys(value, ["number"], ["condition"]) && integer(value.number, minimum, 1000)
		&& (value.condition === undefined || text(value.condition)));
}

function speed (value, minimum = 0) {
	const modes = ["walk", "fly", "swim", "climb", "burrow"];
	return record(value) && modes.some(key => value[key] !== undefined) && Object.keys(value).every(key => [...modes, "alternate", "canHover"].includes(key))
		&& modes.every(key => value[key] === undefined || speedValue(value[key], minimum))
		&& (value.canHover === undefined || typeof value.canHover === "boolean")
		&& (value.alternate === undefined || (record(value.alternate) && Object.entries(value.alternate)
			.every(([key, values]) => modes.includes(key) && Array.isArray(values) && values.length <= 20 && values.every(part => speedValue(part, minimum)))));
}

export function isSporeShadowOp (op) {
	return ["setSporeCharacteristics", "removeSporeSpellcasting", "setSporeLair", "setShadowLair"].includes(op);
}

export function isSporeShadowChange (step, key = "op") {
	switch (step?.[key]) {
		case "setSporeCharacteristics": return keys(step, [key, "speed"]) && speed(step.speed, 5);
		case "removeSporeSpellcasting": return keys(step, [key, "match"]) && match(step.match);
		case "setSporeLair":
		case "setShadowLair": return keys(step, [key, "value"])
			&& isReanimationChange({op: "setReanimationLair", value: step.value});
		default: return false;
	}
}

function getEntries (current, source, sections = SECTIONS) {
	return sections.flatMap(section => {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100)) fail(`${section} must be a bounded concrete entry array.`);
		const seen = new Set();
		return (current[section] || []).map(entry => {
			if (!record(entry)) fail(`${section} needs concrete entries with exact name/source identities.`);
			const selected = identity(entry, source);
			if (!match(selected)) fail(`${section} needs exact name/source identities.`);
			const id = `${canonical(selected.name)}|${canonical(selected.source)}`;
			if (seen.has(id)) fail(`Duplicate ${section} ${selected.name}|${selected.source}; resolve its identity.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			seen.add(id);
			return {section, match: selected, entry};
		});
	});
}

function removal (it) {
	return it.section === "spellcasting" ? {op: "removeSporeSpellcasting", match: it.match}
		: {op: "removeEntry", section: it.section, match: it.match};
}

function replacement (it, entries) {
	const entry = {name: it.entry.name, source: it.match.source, entries};
	if (!isTransformationEntry(entry) || Object.keys(it.entry).some(key => !["name", "source", "entries"].includes(key))) fail(`Resolve unsupported rules/metadata in ${it.section} ${it.match.name}|${it.match.source} before replacing its rules.`);
	return {op: "replaceEntry", section: it.section, match: it.match, onMissing: "error", entry};
}

function grantTraits (current, source, traits) {
	return traits.map(entry => {
		const found = (current.trait || []).filter(it => sameIdentity(identity(it, source), identity(entry, source)));
		if (found.length > 1) fail(`Duplicate trait ${entry.name}|${entry.source}.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
		return found.length ? replacement({section: "trait", match: identity(entry, source), entry: found[0]}, structuredClone(entry.entries))
			: {op: "addEntry", section: "trait", entry: structuredClone(entry)};
	});
}

function getPb (current, supplied) {
	const pb = getCreatureTransformationProficiencyBonus(current, supplied, {checkNote: true});
	if (pb === undefined) fail("Supply the current proficiencyBonus explicitly; a skill bonus or CR is not a PB binding.");
	return pb;
}

function getSpeed (current) {
	if (!speed(current.speed)) fail("Resolve speed to concrete walk/fly/swim/climb/burrow numbers or {number,condition}, including alternate speeds, before applying the 10-foot reduction.");
	const reduce = value => typeof value === "number" ? Math.max(5, value - 10) : {...structuredClone(value), number: Math.max(5, value.number - 10)};
	return Object.fromEntries(Object.entries(current.speed).map(([key, value]) => [key, key === "canHover" ? value : key === "alternate"
		? Object.fromEntries(Object.entries(value).map(([mode, values]) => [mode, values.map(reduce)])) : reduce(value)]));
}

function getSporeMelee (it, decisions, used, brute) {
	const entry = it.entry;
	if (!isTransformationEntry({name: entry.name, source: it.match.source, entries: entry.entries}) || entry.entries.some(part => typeof part !== "string")) fail(`Supply a supported, concrete melee rule for ${it.match.name}|${it.match.source}; nested attack riders require a source binding.`);
	const first = entry.entries[0];
	if (!/^\{@atk mw(?:,rw)?}/.test(first)) fail(`Bind the actual melee-only attack header of ${it.match.name}|${it.match.source}; a mixed or nested action cannot be silently removed.`);
	for (const [paragraphIndex, paragraph] of entry.entries.entries()) {
		const compound = compoundDamage(paragraph);
		if (compound) fail(`Resolve compound damage "${compound}" in ${it.section} ${it.match.name}|${it.match.source} paragraph ${paragraphIndex} into separately typed damage components before classifying equipment.`);
	}
	const damage = [...JSON.stringify(entry.entries).matchAll(damagePattern())].map(found => canonical(found[0]));
	if (!damage.some(type => PHYSICAL.includes(type))) return null;
	let entries = entry.entries.map((paragraph, paragraphIndex) => {
		const components = [...paragraph.matchAll(sporeDamagePattern())];
		const tags = [...paragraph.matchAll(/\{@damage [^{}]+}/g)];
		if (components.length !== tags.length || /\b\d+ (?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) damage/.test(paragraph)) fail(`Bind every damage component in ${it.match.name}|${it.match.source}; an untagged/conditional component cannot be silently retained.`);
		const keep = components.map((component, token) => {
			if (PHYSICAL.includes(component[3])) return true;
			const found = decisions.filter(choice => keys(choice, ["section", "match", "paragraph", "token", "equipment"])
				&& choice.section === it.section && sameIdentity(choice.match, it.match) && choice.paragraph === paragraphIndex && choice.token === token && typeof choice.equipment === "boolean");
			if (found.length !== 1) fail(`Classify ${it.section} ${it.match.name}|${it.match.source} paragraph ${paragraphIndex} damage token ${token} with spore.equipmentDamage:[{section,match,paragraph,token,equipment}].`);
			used.add(found[0]);
			return found[0].equipment;
		});
		const edits = [];
		let lostTail = null;
		for (const [token, component] of components.entries()) {
			if (keep[token]) continue;
			const prefix = paragraph.slice(0, component.index);
			const plus = /(?: plus | and )$/.exec(prefix);
			if (plus) edits.push({start: component.index - plus[0].length, end: component.index + component[0].length, text: ""});
			else {
				const tail = prefix.lastIndexOf(", and the target must ");
				if (tail < 0) fail(`Resolve the non-equipment damage rider in ${it.match.name}|${it.match.source}; it is not an isolated damage component or a terminal saving-throw rider.`);
				if (components.some((part, index) => part.index >= tail && keep[index])) fail(`Resolve the ${it.match.name}|${it.match.source} terminal rider; removing it would also delete retained physical or equipment damage.`);
				lostTail = Math.min(lostTail ?? paragraph.length, tail);
			}
		}
		const effectiveEdits = lostTail === null ? edits : [...edits.filter(edit => edit.end <= lostTail), {start: lostTail, end: paragraph.length, text: "."}];
		let result = effectiveEdits.sort((a, b) => b.start - a.start).reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), paragraph);
		const expected = components.filter((_part, token) => keep[token]);
		if (!same([...result.matchAll(sporeDamagePattern())].map(part => part[0]), expected.map(part => part[0]))) fail(`The damage cleanup in ${it.match.name}|${it.match.source} paragraph ${paragraphIndex} does not preserve exactly the permitted components.`);
		const equipmentTypes = new Set(expected.filter(part => !PHYSICAL.includes(part[3])).map(part => part[3]));
		if ([...result.matchAll(damagePattern())].some(part => !PHYSICAL.includes(canonical(part[0])) && !equipmentTypes.has(canonical(part[0])))) fail(`Resolve the remaining damage rider in ${it.match.name}|${it.match.source} paragraph ${paragraphIndex}; each nonphysical type needs its own retained equipment component.`);
		if (/\{@atk mw,rw}/.test(result)) {
			result = result.replace("{@atk mw,rw}", "{@atk mw}").replace(/reach (\d+) ft\. or range \d+\/\d+ ft\./, "reach $1 ft.");
			result = result.replace(/ in melee or \d+ \(\{@damage [^{}]+}\) (?:bludgeoning|piercing|slashing) damage at range\./, ".");
			if (/\brange\b|\bat range\b/.test(result)) fail(`Resolve the melee-only reach/damage binding for ${it.match.name}|${it.match.source}.`);
		}
		if (brute) {
			result = result.replace(/(\d+) \(\{@damage (\d+)d(\d+)([^{}]*)}\) (bludgeoning|piercing|slashing) damage/, (_full, _average, number, faces, suffix, type) => {
				if (Number(number) < 2) fail(`Brute's included extra die is ambiguous in ${it.match.name}|${it.match.source}.`);
				const fixed = suffix.trim() ? Number(suffix.replace(/\s/g, "")) : 0;
				if (!Number.isInteger(fixed)) fail(`Resolve Brute's included damage formula for ${it.match.name}|${it.match.source}.`);
				return `${Math.max(0, Math.floor((Number(number) - 1) * (Number(faces) + 1) / 2 + fixed))} ({@damage ${Number(number) - 1}d${faces}${suffix}}) ${type} damage`;
			});
		}
		return result;
	});
	return same(entries, entry.entries) ? {retained: true} : {change: replacement(it, entries)};
}

function getMultiattack (it, allMelee, retainedMelee) {
	if (!Array.isArray(it.entry.entries) || it.entry.entries.length !== 1 || typeof it.entry.entries[0] !== "string") fail(`Resolve the source attack routine for ${it.match.name}|${it.match.source}.`);
	const rule = it.entry.entries[0];
	const simple = /^The .+ makes (one|two|three|four|five|six|\d+) ([a-z -]+?) attacks?\.$/i.exec(rule);
	const scout = /^The .+ makes (one|two|three|four|\d+) melee attacks or \1 ranged attacks\.$/i.exec(rule);
	const routine = [];
	if (scout) {
		if (!retainedMelee.length) return removal(it);
		return replacement(it, [`The servant makes ${scout[1]} melee weapon attacks.`]);
	}
	if (simple) {
		const name = simple[2].replace(/s$/, "");
		const found = allMelee.filter(attack => attack.section === "action" && canonical(attack.match.name).replace(/s$/, "") === canonical(name));
		if (found.length !== 1) fail(`Bind the exact melee attack referenced by ${it.match.name}|${it.match.source}.`);
		routine.push({attack: found[0], count: count(simple[1])});
	} else {
		const colon = /^(?:The [^.!?]+ makes|The [^.!?]+ can use its [^.!?]+\. It then makes) (?:one|two|three|four|five|six|\d+) attacks?: (.+)\.$/i.exec(rule);
		if (!colon) fail(`Resolve the actual per-attack counts in ${it.match.name}|${it.match.source}; no replacement routine is guessed.`);
		for (const part of colon[1].split(/,? and |, /)) {
			const item = /^(one|two|three|four|five|six|\d+) with its (.+)$/i.exec(part);
			const found = item ? allMelee.filter(attack => attack.section === "action" && canonical(attack.match.name).replace(/s$/, "") === canonical(item[2]).replace(/s$/, "")) : [];
			if (found.length !== 1) fail(`Resolve the source-qualified attack reference "${part}" in ${it.match.name}|${it.match.source}.`);
			routine.push({attack: found[0], count: count(item[1])});
		}
	}
	const selected = routine.filter(item => retainedMelee.includes(item.attack));
	if (!selected.length) return removal(it);
	const total = selected.reduce((sum, item) => sum + item.count, 0);
	if (!integer(total, 1, 100)) fail("Multiattack counts must be finite and source-bound.");
	const description = selected.map(item => `${words[item.count] || item.count} with its ${item.attack.match.name.toLowerCase()}`).join(" and ");
	return replacement(it, [`The servant makes ${words[total] || total} ${total === 1 ? "attack" : "attacks"}: ${description}.`]);
}

function compileSpore ({resolved, current, chassisSource, inputs, legendaryGroups}) {
	if (!keys(inputs, ["spore"]) || !keys(inputs.spore, [], ["equipmentDamage", "proficiencyBonus", "lair", "bindings"])) fail("Spore Servant accepts only spore:{equipmentDamage?,proficiencyBonus?,lair?,bindings?}.");
	const answers = inputs.spore;
	const type = typeof current.type === "string" ? current.type : current.type?.type;
	if (!["aberration", "beast", "celestial", "dragon", "fey", "fiend", "giant", "humanoid", "monstrosity"].includes(type)
		|| !Array.isArray(current.size) || current.size.length !== 1 || !["T", "S", "M", "L"].includes(current.size[0])) fail("Spore Servant requires a once-flesh-and-blood creature of Large or smaller size.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (current.mythic?.length) fail("Resolve the target's mythic action policy before applying Spore Servant; those actions cannot silently survive as special traits.");
	if (record(current.type) && Object.keys(current.type).some(key => !["type", "tags"].includes(key))) fail("Resolve the retained size/swarm characteristic before removing type tags.");
	const all = getEntries(current, chassisSource, [...SECTIONS, "spellcasting"]);
	const decisions = answers.equipmentDamage ?? [];
	if (!Array.isArray(decisions) || decisions.length > 100) fail("equipmentDamage must be a bounded per-component decision array.");
	const used = new Set();
	const changes = [{op: "setSporeCharacteristics", speed: getSpeed(current)}];
	const receipts = [];
	const attacks = all.filter(it => it.section !== "trait" && it.section !== "spellcasting");
	const melee = attacks.filter(it => /\{@atk mw(?:,rw)?}/.test(JSON.stringify(it.entry.entries)));
	const retained = [];
	const brute = all.some(it => it.section === "trait" && sameIdentity(it.match, {name: "Brute", source: "MM"})
		&& /\bone extra die\b.*\bincluded in the attack\b/.test(JSON.stringify(it.entry.entries)));
	const unexplained = all.find(it => it.section === "trait" && /\bincluded in (?:the |its )?(?:attack|damage)\b/i.test(JSON.stringify(it.entry.entries))
		&& !(brute && sameIdentity(it.match, {name: "Brute", source: "MM"})));
	if (unexplained) fail(`Resolve the included attack contribution of lost trait ${unexplained.match.name}|${unexplained.match.source} before compiling its remaining melee damage.`);
	for (const it of all) {
		if (it.section === "trait" || it.section === "spellcasting") {
			changes.push(removal(it));
			continue;
		}
		if (/^multiattack$/i.test(it.match.name)) continue;
		if (!melee.includes(it) && /\bmelee\b|\bweapon attack\b|\{@atkr\b/i.test(JSON.stringify(it.entry.entries))) fail(`Resolve the untagged or indirect melee capability ${it.section} ${it.match.name}|${it.match.source} before classifying its permitted attack.`);
		const result = melee.includes(it) ? getSporeMelee(it, decisions, used, brute) : null;
		if (result) {
			retained.push(it);
			if (result.change) changes.push(result.change);
			receipts.push(`retain:${it.section}:${it.match.name}|${it.match.source}`);
		} else changes.push(removal(it));
	}
	if (used.size !== decisions.length) fail("An equipment-damage decision is duplicate, unknown, or inapplicable to a retained nonphysical melee damage component.");
	for (const it of attacks.filter(it => /^multiattack$/i.test(it.match.name))) changes.push(getMultiattack(it, melee, retained));
	if (retained.length) {
		if (!keys(answers.bindings, ["entries"], ["proficiencyBonus"])) fail("Supply spore.bindings:{entries,proficiencyBonus?} in the M2b format for every retained numerical attack/rider; mental attack abilities cannot be silently retained.");
		const numericCurrent = structuredClone(current);
		for (const section of [...SECTIONS, "spellcasting"]) numericCurrent[section] = [];
		for (const it of retained) {
			const edited = changes.find(step => step.op === "replaceEntry" && step.section === it.section && sameIdentity(step.match, it.match));
			numericCurrent[it.section].push(edited ? {...structuredClone(it.entry), entries: structuredClone(edited.entry.entries)} : structuredClone(it.entry));
		}
		changes.push(...compileCreatureTransformationBindings({current: numericCurrent, chassisSource, abilities: {int: 2, wis: 6, cha: 1}, armor: {mode: "retain"}, ...answers.bindings}));
	} else if (answers.bindings !== undefined) fail("Numerical attack bindings are inapplicable without a retained melee attack.");
	if (!retained.length) {
		const pb = getPb(current, answers.proficiencyBonus);
		if (!integer(current.str, 1, 30)) fail("Fallback unarmed strike requires a concrete Strength score.");
		const modifier = Parser.getAbilityModNumber(current.str);
		const dice = current.size[0] === "L" ? 2 : 1;
		changes.push({op: "addEntry",
			section: "action",
			entry: {name: "Unarmed Strike",
				source: "MM",
				entries: [
					`{@atk mw} {@hit ${modifier + pb}} to hit, reach 5 ft., one target. {@h}${Math.max(0, Math.floor(dice * 2.5 + modifier))} ({@damage ${dice}d4${modifier ? ` ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}` : ""}}) bludgeoning damage.`,
				]}});
		receipts.push(`fallback:${pb}`);
	} else if (answers.proficiencyBonus !== undefined) fail("proficiencyBonus is inapplicable when a retained melee attack already deals damage.");
	if (current.legendaryGroup) {
		if (answers.lair?.mode !== "replace" || answers.lair.actions?.length !== 0) fail("A Spore Servant loses special lair actions; supply spore.lair:{mode:'replace',baseline,actions:[]} and complete legendaryGroups, retaining regional/mythic context.");
		changes.push(...compileCreatureTransformationLair(current, answers.lair, legendaryGroups).map(it => ({...it, op: "setSporeLair"})));
	} else if (answers.lair !== undefined) fail("The lair answer is inapplicable to this target.");
	changes.push(...["blinded", "charmed", "frightened", "paralyzed"].map(value => ({op: "grantConditionImmunity", value})),
		...SPORE_TRAITS.map(entry => ({op: "addEntry", section: "trait", entry: structuredClone(entry)})));
	return {changes,
		receipts: {"automation-spore-shadow": ["spore servant|mm:m7"],
			"automation-actions": receipts,
			"automation-removals": changes.filter(step => ["removeEntry", "removeSporeSpellcasting"].includes(step.op)).map(step => `${step.section || "spellcasting"}:${step.match.name}|${step.match.source}`),
			"automation-equipment": decisions.map(it => `${it.section}:${it.match.name}|${it.match.source}:${it.paragraph}:${it.token}:${it.equipment}`)}};
}

function mapRules (value, transform) {
	if (typeof value === "string") return transform(value);
	if (Array.isArray(value)) return value.map(part => mapRules(part, transform));
	if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, ["entry", "entries", "items"].includes(key) ? mapRules(part, transform) : part]));
	return value;
}

function compileShadow ({resolved, current, chassisSource, inputs, legendaryGroups}) {
	if (!keys(inputs, ["shadow"]) || !keys(inputs.shadow, ["trueDragon", "shadowfell", "stealth", "lair"], ["proficiencyBonus", "attacks"])) fail("Shadow Dragon needs shadow:{trueDragon,shadowfell,stealth,lair,proficiencyBonus?,attacks?}.");
	const answers = inputs.shadow;
	const all = getEntries(current, chassisSource);
	if ((typeof current.type === "string" ? current.type : current.type?.type) !== "dragon" || answers.trueDragon === false
		|| all.some(it => it.section === "trait" && /^undead nature$/i.test(it.match.name) && ["mm", "dmg"].includes(canonical(it.match.source)))) fail("Only a true dragon, never a dracolich, can become a Shadow Dragon.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (answers.trueDragon !== true || !["born", "years"].includes(answers.shadowfell)) fail("Confirm trueDragon:true and shadowfell:'born' or 'years'; short exposure is insufficient.");
	const choices = answers.attacks ?? [];
	if (!Array.isArray(choices) || choices.length > 100) fail("attacks must contain exact source-qualified bite/breath/other role decisions.");
	const used = new Set();
	const receipts = [];
	const pb = getPb(current, answers.proficiencyBonus);
	if (!integer(current.dex, 1, 30) || (current.skill !== undefined && !record(current.skill))) fail("Stealth requires a concrete Dexterity score and skill object.");
	const dex = Parser.getAbilityModNumber(current.dex);
	const stealth = answers.stealth;
	if (!keys(stealth, ["proficiency", "residual"]) || ![0, 1, 2].includes(stealth.proficiency) || !integer(stealth.residual, -1000, 1000)) fail("Bind current Stealth with stealth:{proficiency:0|1|2,residual:integer}; retain authored non-PB bonuses.");
	const original = current.skill?.stealth;
	if (original !== undefined && (typeof original !== "string" || !/^[+-]?\d+$/.test(original))) fail("Resolve conditional/alternative Stealth before granting doubled proficiency.");
	if ((original === undefined ? dex : Number(original)) !== dex + pb * stealth.proficiency + stealth.residual
		|| (original === undefined && (stealth.proficiency !== 0 || stealth.residual !== 0))) fail("The Stealth ability/PB/residual binding does not explain the current target.");
	const changes = [{op: "grantResistance", value: "necrotic"}, {op: "setSkillBonus", skill: "stealth", value: dex + 2 * pb + stealth.residual},
		...DAMAGE.filter(type => !["force", "psychic", "radiant"].includes(type)).map(value => ({op: "grantConditionalDefense", kind: "resistance", value, when: "dimLightOrDarkness"}))];
	for (const it of all) {
		const selected = choices.filter(choice => keys(choice, ["section", "match", "role"]) && choice.section === it.section && sameIdentity(choice.match, it.match));
		if (selected.length > 1) fail(`Duplicate attack role for ${it.section} ${it.match.name}|${it.match.source}.`);
		const rules = JSON.stringify(it.entry.entries);
		const definiteBite = /^bite\b/i.test(it.match.name) && /\{@atk mw/.test(rules);
		const definiteBreath = /\bbreath\b/i.test(it.match.name) && /\{@dc \d+\b/.test(rules) && /\b(?:cone|line|radius|cube|sphere)\b/i.test(rules);
		const role = selected[0]?.role ?? (definiteBite ? "bite" : definiteBreath ? "breath" : "other");
		if (selected.length) {
			if (!["bite", "breath", "other"].includes(role) || ((definiteBite || definiteBreath) && role !== (definiteBite ? "bite" : "breath"))) fail(`The role decision contradicts actual bite/breath mechanics for ${it.match.name}|${it.match.source}.`);
			used.add(selected[0]);
		} else if ((/\b(?:bite|breath)\b/i.test(it.match.name) || /\b(?:breath|exhales?)\b/i.test(rules)) && !definiteBite && !definiteBreath) fail(`Classify ambiguous ${it.section} ${it.match.name}|${it.match.source} in shadow.attacks as bite, breath, or other.`);
		if (role === "other") continue;
		if (!isTransformationEntry({name: it.entry.name, source: it.match.source, entries: it.entry.entries})) fail(`Bind supported, bounded bite/breath content for ${it.match.name}|${it.match.source}; unknown entry structures cannot be partly converted.`);
		let converted = 0;
		const entries = mapRules(it.entry.entries, rule => {
			const compound = compoundDamage(rule);
			if (compound) fail(`Resolve compound damage "${compound}" in ${it.section} ${it.match.name}|${it.match.source} into separately typed damage components before ${role} conversion.`);
			let found = false;
			const next = rule.replace(damagePattern(), type => {
				if (role === "bite" && !ELEMENTAL.includes(canonical(type))) return type;
				found = true;
				converted++;
				return "necrotic";
			});
			return found && role === "breath" ? `${next} ${lethalBreath}` : next;
		});
		if (!converted && /\{@damage\b/.test(rules) && role === "breath") fail(`Bind the actual damage type of breath ${it.match.name}|${it.match.source}; it cannot remain unconverted.`);
		if (converted) {
			changes.push(replacement(it, entries));
			receipts.push(`${role}:${it.section}:${it.match.name}|${it.match.source}`);
		}
	}
	if (used.size !== choices.length) fail("An attack-role decision is unknown, duplicate, or does not identify a current source-qualified entry.");
	changes.push(...compileCreatureTransformationLair(current, answers.lair, legendaryGroups).map(it => ({...it, op: "setShadowLair"})),
		...grantTraits(current, chassisSource, SHADOW_TRAITS[resolved.identity.source]));
	return {changes,
		receipts: {"automation-spore-shadow": [`${resolved.id.slice(8)}:m7`],
			"automation-actions": receipts,
			"automation-nature": ["true-dragon", answers.shadowfell],
			"automation-stealth": [`${pb}:${stealth.proficiency}:${stealth.residual}`],
			"automation-lair": [answers.lair.mode]}};
}

export function compileSporeShadow (options) {
	const {resolved} = options;
	const profile = PROFILES[resolved.id];
	if (!profile || resolved.identity.name !== profile.name || resolved.identity.source !== profile.source) fail("Unsupported source-qualified M7 profile.");
	if (!keys(resolved.selectedOptions, [])) fail("M7 profiles do not accept catalog option groups.");
	const {changes, receipts} = profile.profile === "spore-servant" ? compileSpore(options) : compileShadow(options);
	const compiled = {...structuredClone(resolved),
		changes,
		selectedOptions: receipts,
		eligibility: [...structuredClone(resolved.eligibility).filter(rule => !rule.dmApproval), {dmApproval: true}],
		manualReview: [{field: "cr", reason: "M7 source effects are compiled; current CR/XP is retained. Estimated CR plus override and editor integration remain rollout prerequisites."}]};
	delete compiled.automation;
	if (!isCompiledSporeShadow(compiled)) throw new Error("M7 did not produce its closed, concrete source profile.");
	return compiled;
}

export function isCompiledSporeShadow (resolved) {
	const profile = PROFILES[resolved?.id];
	if (!profile || resolved.version !== 2 || resolved.kind !== "catalog" || !same(resolved.identity, {name: profile.name, source: profile.source})
		|| Object.hasOwn(resolved, "automation") || !Array.isArray(resolved.eligibility) || !resolved.eligibility.some(rule => rule?.dmApproval === true)
		|| !Array.isArray(resolved.changes) || resolved.changes.length > 256 || !resolved.changes.every(record)) return false;
	const spore = profile.profile === "spore-servant";
	const options = resolved.selectedOptions;
	if (!keys(options, ["automation-spore-shadow", "automation-actions", ...spore ? ["automation-equipment", "automation-removals"] : ["automation-nature", "automation-stealth", "automation-lair"]])
		|| !Object.values(options).every(values => Array.isArray(values) && values.length <= 100 && values.every(value => typeof value === "string" && value.length <= 1000))
		|| !same(options["automation-spore-shadow"], [`${resolved.id.slice(8)}:m7`])) return false;
	const steps = resolved.changes.map(step => Object.fromEntries([["op", step.op ?? step.type], ...Object.entries(step).filter(([key]) => !["op", "type"].includes(key))]));
	const traits = spore ? SPORE_TRAITS : SHADOW_TRAITS[profile.source];
	const seen = new Set();
	for (const step of steps) {
		let id = step.op;
		if (isSporeShadowOp(step.op)) {
			if (!isSporeShadowChange(step) || (spore ? step.op === "setShadowLair" : step.op !== "setShadowLair")) return false;
			if (step.op === "removeSporeSpellcasting") id += `:${step.match.name}|${step.match.source}`;
		} else if (step.op === "grantConditionImmunity") {
			if (!spore || !keys(step, ["op", "value"]) || !["blinded", "charmed", "frightened", "paralyzed"].includes(step.value)) return false;
			id += `:${step.value}`;
		} else if (step.op === "grantResistance") {
			if (spore || !same(step, {op: "grantResistance", value: "necrotic"})) return false;
		} else if (step.op === "grantConditionalDefense") {
			if (spore || !keys(step, ["op", "kind", "value", "when"]) || step.kind !== "resistance" || step.when !== "dimLightOrDarkness"
				|| !DAMAGE.includes(step.value) || ["force", "psychic", "radiant"].includes(step.value)) return false;
			id += `:${step.value}`;
		} else if (step.op === "setSkillBonus") {
			if (spore || step.skill !== "stealth" || !isCreatureTransformationStatChange(step)) return false;
		} else if (step.op === "setEntryNumbers") {
			if (!spore || !isCreatureTransformationBindingChange(step) || compoundDamage(JSON.stringify(step.entries))
				|| !options["automation-actions"].includes(`retain:${step.section}:${step.match.name}|${step.match.source}`)) return false;
			id += `:${step.section}:${step.match.name}|${step.match.source}`;
		} else if (step.op === "removeEntry") {
			if (!spore || !keys(step, ["op", "section", "match"]) || !SECTIONS.includes(step.section) || !match(step.match)) return false;
			id += `:${step.section}:${step.match.name}|${step.match.source}`;
		} else if (["addEntry", "replaceEntry"].includes(step.op)) {
			if (!SECTIONS.includes(step.section) || !isTransformationEntry(step.entry)) return false;
			const trait = traits.find(entry => same(entry, step.entry));
			if (!trait && compoundDamage(JSON.stringify(step.entry.entries))) return false;
			if (step.op === "addEntry") {
				if (!keys(step, ["op", "section", "entry"]) || (!trait && !(spore && step.section === "action" && step.entry.name === "Unarmed Strike" && step.entry.source === "MM"))) return false;
				if (!trait) {
					const fallback = options["automation-actions"].filter(value => /^fallback:[1-9]\d*$/.test(value));
					const rule = step.entry.entries.length === 1 && typeof step.entry.entries[0] === "string"
						? /^\{@atk mw} \{@hit (-?\d+)} to hit, reach 5 ft\., one target\. \{@h}(\d+) \(\{@damage ([12])d4(?: ([+-]) (\d+))?}\) bludgeoning damage\.$/.exec(step.entry.entries[0]) : null;
					if (fallback.length !== 1 || options["automation-actions"].length !== 1 || !rule) return false;
					const pb = Number(fallback[0].slice(9));
					const modifier = rule[4] ? Number(`${rule[4]}${rule[5]}`) : 0;
					if (!integer(pb, 1, 30) || !integer(modifier, -5, 10) || Number(rule[1]) !== pb + modifier
						|| Number(rule[2]) !== Math.max(0, Math.floor(Number(rule[3]) * 2.5 + modifier))) return false;
				}
			} else if (!keys(step, ["op", "section", "match", "entry", "onMissing"]) || step.onMissing !== "error" || !sameIdentity(step.match, identity(step.entry, profile.source))) return false;
			if (spore && step.section === "trait" && !trait) return false;
			if (spore && step.op === "replaceEntry" && step.section !== "trait" && !/^multiattack$/i.test(step.match.name)
				&& !options["automation-actions"].includes(`retain:${step.section}:${step.match.name}|${step.match.source}`)) return false;
			if (!spore && !trait) {
				const receipt = `${step.section}:${step.match?.name}|${step.match?.source}`;
				const breath = options["automation-actions"].includes(`breath:${receipt}`);
				if (!breath && !options["automation-actions"].includes(`bite:${receipt}`)) return false;
				if (breath) {
					let complete = true;
					let damageRules = 0;
					mapRules(step.entry.entries, rule => {
						const types = [...rule.matchAll(damagePattern())].map(found => canonical(found[0]));
						if (types.length) {
							damageRules++;
							if (types.some(type => type !== "necrotic") || !rule.endsWith(lethalBreath)) complete = false;
						}
						return rule;
					});
					if (!complete || !damageRules) return false;
				} else if ([...JSON.stringify(step.entry.entries).matchAll(damagePattern())].some(found => ELEMENTAL.includes(canonical(found[0])))) return false;
			}
			id = `entry:${step.section}:${step.entry.name}|${step.entry.source}`;
		} else return false;
		if (seen.has(id)) return false;
		seen.add(id);
	}
	if (!traits.every(entry => seen.has(`entry:trait:${entry.name}|${entry.source}`))) return false;
	const actions = options["automation-actions"];
	if (new Set(actions).size !== actions.length) return false;
	if (spore) {
		const actualRemovals = steps.filter(step => ["removeEntry", "removeSporeSpellcasting"].includes(step.op)).map(step => `${step.section || "spellcasting"}:${step.match.name}|${step.match.source}`);
		const fallback = steps.some(step => step.op === "addEntry" && step.section === "action" && step.entry.name === "Unarmed Strike");
		return !!actions.length && actions.every(receipt => /^fallback:[1-9]\d*$/.test(receipt) ? fallback
			: /^retain:(action|bonus|reaction|legendary):[^|]+\|[^|]+$/.test(receipt) && !fallback && !options["automation-removals"].includes(receipt.slice(7)))
			&& same(actualRemovals, options["automation-removals"]) && seen.has("setSporeCharacteristics")
			&& ["blinded", "charmed", "frightened", "paralyzed"].every(value => seen.has(`grantConditionImmunity:${value}`));
	}
	return actions.every(receipt => /^(bite|breath):/.test(receipt)
		&& steps.some(step => step.op === "replaceEntry" && receipt === `${receipt.split(":")[0]}:${step.section}:${step.match.name}|${step.match.source}`))
		&& same(options["automation-nature"].slice(0, 1), ["true-dragon"]) && ["born", "years"].includes(options["automation-nature"][1]) && options["automation-nature"].length === 2
		&& options["automation-stealth"].length === 1 && /^[1-9]\d*:[012]:-?\d+$/.test(options["automation-stealth"][0])
		&& options["automation-lair"].length === 1 && ["retain", "replace"].includes(options["automation-lair"][0])
		&& seen.has("grantResistance") && seen.has("setSkillBonus")
		&& DAMAGE.filter(type => !["force", "psychic", "radiant"].includes(type)).every(type => seen.has(`grantConditionalDefense:${type}`))
		&& seen.has("setShadowLair") === (options["automation-lair"][0] === "replace");
}
