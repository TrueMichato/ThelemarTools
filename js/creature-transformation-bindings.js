import {isTransformationEntry} from "./creature-transformation-entries.js";
import {getCreatureTransformationProficiencyBonus} from "./creature-transformation-stats.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"];
const OPS = new Set(["setArmorClass", "setEntryNumbers", "addInnateSpellcasting"]);
const isRecord = value => value != null && typeof value === "object" && !Array.isArray(value);
const isInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isText = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const keysAre = (value, required, optional = []) => isRecord(value)
	&& required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const isMatch = value => keysAre(value, ["name", "source"]) && isText(value.name) && isText(value.source);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => value.trim().toLowerCase();
const getContent = (entry, section) => entry[section === "spellcasting" ? "headerEntries" : "entries"];
const getTags = text => {
	const counts = {hit: 0, dc: 0, damage: 0};
	return [...text.matchAll(/\{@(hit|dc|damage) ([^{}]+)}/g)]
		.map(tag => Object.assign(tag, {kind: tag[1], raw: tag[2], token: counts[tag[1]]++}));
};
const getDamageMean = (dice, bonus = dice.bonus) => dice.number * (dice.faces + 1) / 2 + bonus;
const getDamageAverage = (dice, bonus = dice.bonus) => Math.max(0, Math.floor(getDamageMean(dice, bonus)));
const hasNumbers = value => /\{@(?:hit|dc|damage)\b|\bDC\s+\d+/.test(typeof value === "string" ? value : JSON.stringify(value) || "");

function fail (message) {
	const error = new Error(`Statblock bindings: ${message}`);
	error.code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED";
	throw error;
}

function expectKeys (value, required, optional, label) {
	if (!keysAre(value, required, optional)) fail(`${label} needs exactly ${required.join(", ")}${optional.length ? ` (optional: ${optional.join(", ")})` : ""}.`);
}

function integer (value, min, max, label) {
	if (!isInteger(value, min, max)) fail(`${label} must be an integer from ${min} to ${max}.`);
	return value;
}

function getMod (creature, ability) {
	if (!ABILITIES.includes(ability)) fail("Declare a supported ability; ability inference is not supported.");
	return Parser.getAbilityModNumber(integer(creature[ability], 1, 30, `${ability} score`));
}

function getPb ({current, proficiencyBonus, nextProficiencyBonus}) {
	const old = getCreatureTransformationProficiencyBonus(current, proficiencyBonus, {checkNote: true});
	if (old === undefined) fail("A proficiency contribution requires an explicit current PB, not a CR estimate or a bonus magnitude.");
	return {old, next: nextProficiencyBonus === undefined ? old : integer(nextProficiencyBonus, 1, 30, "Output PB")};
}

function isAc (value) {
	return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(it =>
		isInteger(it, 0, 100) || (keysAre(it, ["ac"], ["from", "condition", "braces"]) && isInteger(it.ac, 0, 100)
			&& (it.from === undefined || (Array.isArray(it.from) && it.from.length > 0 && it.from.length <= 20 && it.from.every(isText)))
			&& (it.condition === undefined || isText(it.condition)) && (it.braces === undefined || typeof it.braces === "boolean")));
}

function compileArmor ({current, out, armor}) {
	if (keysAre(armor, ["mode"]) && armor.mode === "retain") return [];
	expectKeys(armor, ["mode", "alternatives"], [], "AC policy");
	if (armor.mode !== "recalculate" || !isAc(current.ac) || !Array.isArray(armor.alternatives)
		|| armor.alternatives.length !== current.ac.length) fail("AC needs a binding for every worn/natural/conditional alternative, or an explicit retain policy.");
	const ac = current.ac.map((value, index) => {
		const binding = armor.alternatives[index];
		if (keysAre(binding, ["mode"]) && binding.mode === "retain") return structuredClone(value);
		expectKeys(binding, ["kind", "base", "dexterity", "shield", "fixed"], ["maxDex", "minimum"], `AC alternative ${index}`);
		if (!["worn", "natural", "unarmored"].includes(binding.kind) || !["none", "full", "capped"].includes(binding.dexterity)) fail(`AC alternative ${index} needs an explicit armor kind and Dexterity policy.`);
		integer(binding.base, 0, 100, "AC base");
		integer(binding.shield, 0, 10, "Shield contribution");
		integer(binding.fixed, -100, 100, "Fixed AC contribution");
		if (binding.dexterity === "capped") integer(binding.maxDex, 0, 10, "AC Dexterity cap");
		else if (binding.maxDex !== undefined) fail("A Dexterity cap is only valid for capped AC.");
		if (binding.minimum !== undefined) integer(binding.minimum, 0, 100, "AC minimum");
		const calculate = creature => binding.base + binding.shield + binding.fixed
			+ (binding.dexterity === "none" ? 0 : binding.dexterity === "capped" ? Math.min(binding.maxDex, getMod(creature, "dex")) : getMod(creature, "dex"));
		if (calculate(current) !== (typeof value === "number" ? value : value.ac)) fail(`AC alternative ${index} does not explain the current AC; declare its actual armor/shield/fixed contributions.`);
		const number = integer(Math.max(binding.minimum ?? 0, calculate(out)), 0, 100, `AC alternative ${index} output`);
		return typeof value === "number" ? number : {...structuredClone(value), ac: number};
	});
	return same(ac, current.ac) ? [] : [{op: "setArmorClass", value: ac}];
}

function getDice (text) {
	const match = /^(?:(\d+))?d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(text);
	if (!match) fail(`Unsupported damage formula "${text}"; supply a supported single-die binding or explicitly retain this entry.`);
	const number = integer(Number(match[1] || 1), 1, 1000, "Damage die count");
	const faces = integer(Number(match[2]), 2, 100, "Damage die size");
	const bonus = match[3] ? Number(`${match[3]}${match[4]}`) : 0;
	return {number, faces, bonus: integer(bonus, -10_000, 10_000, "Damage bonus")};
}

function getContribution (binding, creature, pb) {
	if (!ABILITIES.includes(binding.ability) || ![0, 1, 2].includes(binding.proficiency)) fail("A numeric binding needs an explicit ability and proficiency multiplier (0, 1 or 2).");
	integer(binding.fixed, -10_000, 10_000, "Fixed non-PB contribution");
	return getMod(creature, binding.ability) + binding.proficiency * pb + binding.fixed;
}

function compileEntry ({entry, section, binding, current, out, pbOptions}) {
	const content = getContent(entry, section);
	if (!Array.isArray(content) || !isTransformationEntry({name: entry.name, source: binding.match.source, entries: content})) fail(`${section} ${entry.name} has unsupported entry content.`);
	if (binding.mode === "retain") {
		expectKeys(binding, ["section", "match", "mode"], [], "Retained entry binding");
		return null;
	}
	expectKeys(binding, ["section", "match", "mode", "numbers"], [], "Entry binding");
	if (binding.mode !== "bind" || !Array.isArray(binding.numbers) || !binding.numbers.length || binding.numbers.length > 100) fail(`${entry.name} needs explicit numeric bindings or mode retain.`);
	const used = new Set();
	const entries = content.map((text, paragraph) => {
		if (typeof text !== "string") {
			if (hasNumbers(text)) fail(`${entry.name} has nested numerical content; an explicit retain policy is required by this bounded API.`);
			return structuredClone(text);
		}
		const edits = [];
		const tags = getTags(text);
		if ((text.match(/\{@(?:hit|dc|damage)\b/g) || []).length !== tags.length) fail(`${entry.name} has malformed numeric tags; an explicit retain policy or corrected source data is required.`);
		for (const tag of tags) {
			const {kind, raw, token} = tag;
			const matches = binding.numbers.filter(it => it?.paragraph === paragraph && it.kind === kind && it.token === token);
			if (matches.length !== 1) fail(`${entry.name} paragraph ${paragraph} ${kind} ${token} requires exactly one computed or source-fixed binding.`);
			const number = matches[0];
			used.add(number);
			const optional = kind === "damage" ? ["dice"] : [];
			if (number.mode === "fixed") expectKeys(number, ["paragraph", "kind", "token", "mode", "value"], optional, "Source-fixed binding");
			else {
				expectKeys(number, ["paragraph", "kind", "token", "mode", "ability", "proficiency", "fixed"], optional, "Computed binding");
				if (number.mode !== "ability") fail("Numeric binding mode must be ability or fixed.");
			}
			let pb = {old: 0, next: 0};
			if (number.mode === "ability" && number.proficiency !== 0) pb = getPb(pbOptions);
			let before;
			let after;
			if (number.mode === "fixed") before = after = integer(number.value, -10_000, 10_000, "Source-fixed value");
			else {
				before = getContribution(number, current, pb.old);
				after = getContribution(number, out, pb.next);
			}
			if (kind !== "damage") {
				if (!/^[+-]?\d+$/.test(raw) || Number(raw) !== before) fail(`${entry.name} ${kind} ${token} does not match its declared ability/PB/fixed contributions.`);
				if (kind === "dc") integer(after, 0, 100, "Save DC");
				else integer(after, -10_000, 10_000, "Attack bonus");
				if (after !== before) edits.push({start: tag.index, end: tag.index + tag[0].length, text: `{@${kind} ${after}}`});
				continue;
			}
			const dice = getDice(raw);
			if (!keysAre(number.dice, ["number", "faces"]) || number.dice.number !== dice.number || number.dice.faces !== dice.faces || dice.bonus !== before) fail(`${entry.name} damage ${token} does not match its declared dice/ability/fixed contributions.`);
			const average = /(\d+) \($/.exec(text.slice(0, tag.index));
			if (!average || text[tag.index + tag[0].length] !== ")" || Number(average[1]) !== getDamageAverage(dice, before)) fail(`${entry.name} damage ${token} needs an adjacent, matching numeric average; custom averages require an explicit retain policy.`);
			if (after !== before) {
				const formula = `${dice.number}d${dice.faces}${after ? ` ${after < 0 ? "-" : "+"} ${Math.abs(after)}` : ""}`;
				edits.push({
					start: tag.index - average[0].length,
					end: tag.index + tag[0].length + 1,
					text: `${getDamageAverage(dice, after)} ({@damage ${formula}})`,
				});
			}
		}
		if (/\bDC\s+\d+/.test(text)) fail(`${entry.name} contains an untagged DC; declare an explicit retain policy instead of guessing its meaning.`);
		return edits.reverse().reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), text);
	});
	if (used.size !== binding.numbers.length) fail(`${entry.name} has unused or duplicate numeric bindings.`);
	return same(entries, content) ? null : {op: "setEntryNumbers", section, match: structuredClone(binding.match), entries};
}

export function observeCreatureTransformationBindings ({current, chassisSource = current.source}) {
	for (const section of SECTIONS) if (current[section] !== undefined && !Array.isArray(current[section])) fail(`${section} must be an entry array.`);
	return SECTIONS.flatMap(section => (current[section] || []).map(entry => {
		if (!isRecord(entry)) fail(`${section} needs source-qualified entry objects.`);
		const match = {name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source};
		const content = getContent(entry, section);
		const observation = {section, match, entry: structuredClone(entry), needsBinding: hasNumbers(content), tokens: [], supported: true};
		try {
			if (!Array.isArray(content)) fail(`${section} ${entry.name} has unsupported entry content.`);
			for (const [paragraph, text] of (content || []).entries()) {
				if (typeof text !== "string") continue;
				for (const {kind, raw, token} of getTags(text)) {
					const dice = kind === "damage" ? getDice(raw) : null;
					observation.tokens.push({
						paragraph,
						kind,
						token,
						text,
						value: dice ? dice.bonus : Number(raw),
						...dice ? {dice: {number: dice.number, faces: dice.faces},
							mean: getDamageMean(dice),
							average: getDamageAverage(dice)} : {},
					});
				}
			}
			if (observation.needsBinding) {
				compileEntry({
					entry,
					section,
					current,
					out: current,
					binding: {section,
						match,
						mode: "bind",
						numbers: observation.tokens.map(({paragraph, kind, token, value, dice}) =>
							({paragraph, kind, token, mode: "fixed", value, ...dice ? {dice} : {}}))},
				});
			}
		} catch (error) {
			if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
			observation.supported = false;
			observation.reason = error.message;
			observation.tokens.forEach(token => delete token.average);
		}
		return observation;
	}));
}

export function compileCreatureTransformationBindings (options) {
	expectKeys(options, ["current", "armor", "entries"], ["abilities", "chassisSource", "proficiencyBonus", "nextProficiencyBonus"], "Binding inputs");
	const {current, abilities = {}, armor, entries, chassisSource = current?.source, proficiencyBonus, nextProficiencyBonus} = options;
	if (!isRecord(current) || !isText(chassisSource)) fail("Bindings require a current source-qualified target.");
	expectKeys(abilities, [], ABILITIES, "Bound ability changes");
	for (const [ability, score] of Object.entries(abilities)) {
		getMod(current, ability);
		integer(score, 1, 30, `${ability} output score`);
	}
	if (!Array.isArray(entries) || entries.length > 100) fail("Entry bindings must be a bounded array.");
	const out = {...current, ...abilities};
	const changes = compileArmor({current, out, armor});
	const used = new Set();
	for (const section of SECTIONS) {
		if (current[section] !== undefined && !Array.isArray(current[section])) fail(`${section} must be an entry array.`);
		for (const entry of current[section] || []) {
			if (!isRecord(entry)) fail(`${section} needs source-qualified entry objects.`);
			const source = !entry.source || entry.source === "$chassis" ? chassisSource : entry.source;
			if (!isText(entry.name) || !isText(source)) fail(`${section} needs exact entry name/source identities.`);
			const matches = entries.filter(it => it?.section === section && isMatch(it.match) && canonical(it.match.name) === canonical(entry.name) && canonical(it.match.source) === canonical(source));
			const needsBinding = hasNumbers(getContent(entry, section));
			if (matches.length > 1 || (needsBinding && !matches.length)) fail(`${section} ${entry.name}|${source} requires exactly one explicit entry binding.`);
			if (!matches.length) continue;
			const binding = matches[0];
			if (used.has(binding)) fail(`${section} ${entry.name}|${source} is ambiguous; duplicate source-qualified entries cannot be bound.`);
			used.add(binding);
			const change = compileEntry({entry, section, binding, current, out, pbOptions: {current, proficiencyBonus, nextProficiencyBonus}});
			if (change) changes.push(change);
		}
	}
	if (used.size !== entries.length) fail("An entry binding did not match exactly one current name/source/section.");
	return changes;
}

const isSpell = spell => keysAre(spell, ["spell", "usage"], ["uses", "each", "restriction"])
	&& typeof spell.spell === "string" && spell.spell.length <= 256 && /^[^{}<>|#&\r\n]+\|[A-Za-z0-9-]{2,40}$/.test(spell.spell)
	&& !!spell.spell.split("|")[0].trim() && spell.spell.split("|")[0] === spell.spell.split("|")[0].trim()
	&& ["will", "daily", "rest"].includes(spell.usage)
	&& (spell.restriction === undefined || spell.restriction === "selfOnly")
	&& (spell.usage === "will" ? spell.uses === undefined && spell.each === undefined : isInteger(spell.uses, 1, 9) && typeof spell.each === "boolean");

function isInnate (step, key) {
	return keysAre(step, [key, "name", "source", "ability", "saveDc", "attackBonus", "components", "spells"])
		&& isText(step.name) && typeof step.source === "string" && /^[A-Za-z0-9-]{2,40}$/.test(step.source)
		&& ABILITIES.includes(step.ability) && isInteger(step.saveDc, 0, 100) && isInteger(step.attackBonus, -10_000, 10_000)
		&& Array.isArray(step.components) && step.components.length <= 3 && new Set(step.components).size === step.components.length && step.components.every(it => ["V", "S", "M"].includes(it))
		&& Array.isArray(step.spells) && step.spells.length > 0 && step.spells.length <= 100 && step.spells.every(isSpell)
		&& new Set(step.spells.map(it => canonical(it.spell))).size === step.spells.length;
}

export function isCreatureTransformationBindingOp (op) { return OPS.has(op); }

export function isCreatureTransformationBindingChange (step, key = "op") {
	switch (step?.[key]) {
		case "setArmorClass": return keysAre(step, [key, "value"]) && isAc(step.value);
		case "setEntryNumbers": return keysAre(step, [key, "section", "match", "entries"]) && SECTIONS.includes(step.section) && isMatch(step.match)
			&& step.match.source !== "$chassis" && isTransformationEntry({name: step.match.name, source: step.match.source, entries: step.entries});
		case "addInnateSpellcasting": return isInnate(step, key);
		default: return false;
	}
}

export function compileCreatureTransformationInnateSpellcasting (options) {
	expectKeys(options, ["current", "spellcasting"], ["abilities", "proficiencyBonus", "nextProficiencyBonus"], "Innate spell inputs");
	const {current, abilities = {}, spellcasting, proficiencyBonus, nextProficiencyBonus} = options;
	if (!isRecord(current)) fail("Innate spellcasting requires a current target.");
	expectKeys(abilities, [], ABILITIES, "Innate ability changes");
	for (const score of Object.values(abilities)) integer(score, 1, 30, "Innate output ability score");
	expectKeys(spellcasting, ["name", "source", "ability", "dcFixed", "attackFixed", "components", "spells"], [], "Innate spell profile");
	const pb = getPb({current, proficiencyBonus, nextProficiencyBonus});
	const mod = getMod({...current, ...abilities}, spellcasting.ability);
	const {dcFixed, attackFixed, ...fields} = spellcasting;
	const step = {
		op: "addInnateSpellcasting",
		...structuredClone(fields),
		saveDc: mod + pb.next + integer(dcFixed, -100, 100, "Fixed innate DC contribution"),
		attackBonus: mod + pb.next + integer(attackFixed, -100, 100, "Fixed innate attack contribution"),
	};
	if (!isCreatureTransformationBindingChange(step)) fail("Innate spell output requires a concrete ability, DC/attack, source-qualified spell UIDs, uses and explicit V/S/M component requirements.");
	return step;
}

export function getCreatureTransformationInnateSpellcastingEntry (step) {
	if (!isCreatureTransformationBindingChange(step, Object.hasOwn(step || {}, "op") ? "op" : "type") || (step.op ?? step.type) !== "addInnateSpellcasting") fail("Innate spell entry requires a validated concrete innate setter.");
	const required = {V: "verbal", S: "somatic", M: "material"};
	const components = Object.keys(required).filter(it => step.components.includes(it)).map(it => required[it]);
	const omitted = Object.keys(required).filter(it => !step.components.includes(it)).map(it => required[it]);
	const componentText = components.length
		? `It requires ${components.join(" and ")} components${omitted.length ? ` but no ${omitted.join(" or ")} components` : ""}.`
		: "It requires no components.";
	const entry = {
		name: step.name,
		source: step.source,
		type: "spellcasting",
		ability: step.ability,
		headerEntries: [`Its innate spellcasting ability is ${Parser.attAbvToFull(step.ability)} (spell save {@dc ${step.saveDc}}, {@hit ${step.attackBonus}} to hit with spell attacks). ${componentText}`],
	};
	for (const spell of step.spells) {
		const text = `{@spell ${spell.spell}}${spell.restriction === "selfOnly" ? " (self only)" : ""}`;
		if (spell.usage === "will") (entry.will ||= []).push(text);
		else {
			entry[spell.usage] ||= {};
			(entry[spell.usage][`${spell.uses}${spell.each ? "e" : ""}`] ||= []).push(text);
		}
	}
	return entry;
}
