import {getCreatureTransformationProficiencyBonus} from "../creature-transformation-stats.js";
import {getCreatureTransformationCrProficiency} from "../creature-transformation-cr.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const copy = value => structuredClone(value);
const type = item => item.type?.split("|")[0];
const mod = (current, ability) => Parser.getAbilityModNumber(current[ability]);

function proficiency (current) {
	return getCreatureTransformationProficiencyBonus(current, undefined, {checkNote: true}) ??
		getCreatureTransformationCrProficiency({current}).before;
}

function armor (current, items, dexChanges) {
	const alternatives = (current.ac || []).map(value => {
		if (!value.from?.length) {
			if ((value.ac ?? value) === 10 + mod(current, "dex")) return {kind: "unarmored", base: 10, dexterity: "full", shield: 0, fixed: 0};
			return dexChanges ? undefined : {mode: "retain"};
		}
		const equipment = value.from.map(text => {
			const tag = /^\{@item ([^|}]+)\|([^|}]+)(?:\|[^}]+)?}$/i.exec(text);
			return tag && items.find(item => item.name.toLowerCase() === tag[1].toLowerCase() && item.source.toLowerCase() === tag[2].toLowerCase());
		});
		if (equipment.some(item => !item)) return dexChanges ? undefined : {mode: "retain"};
		const worn = equipment.filter(item => ["LA", "MA", "HA"].includes(type(item)));
		const shields = equipment.filter(item => type(item) === "S");
		if (worn.length !== 1 || shields.length > 1 || worn.length + shields.length !== equipment.length) return undefined;
		const item = worn[0];
		const dexterity = {LA: "full", MA: "capped", HA: "none"}[type(item)];
		const shield = shields[0]?.ac ?? 0;
		const contribution = dexterity === "none" ? 0 : dexterity === "capped" ? Math.min(2, mod(current, "dex")) : mod(current, "dex");
		if (item.ac + shield + contribution !== value.ac) return undefined;
		return {kind: "worn", base: item.ac, dexterity, shield, fixed: 0, ...dexterity === "capped" ? {maxDex: 2} : {}};
	});
	if (!alternatives.length || alternatives.some(value => !value)) return undefined;
	return alternatives.every(value => value.mode === "retain") ? {mode: "retain"} : {mode: "recalculate", alternatives};
}

// Proposals explain the existing numbers exactly; unexplained bonuses remain a DM choice.
export function getCreatureTransformationNumericDefaults ({current, entries, items = [], includeArmor = true, dexChanges = false}) {
	const pb = proficiency(current);
	const bindings = [];
	for (const entry of entries.filter(entry => entry.needsBinding)) {
		if (!entry.supported) return undefined;
		const item = (current.attachedItems || []).map(uid => items.find(item => `${item.name}|${item.source}`.toLowerCase() === uid.toLowerCase()))
			.find(item => item && item.name.toLowerCase() === entry.match.name.toLowerCase());
		const content = JSON.stringify(entry.entry.entries ?? entry.entry.headerEntries);
		const weapon = /\{@atk(?:r)? (?:mw|rw)(?:,(?:mw|rw))*}/.test(content);
		const choices = item ? (item.property?.some(prop => prop.split("|")[0] === "F") ? ["str", "dex"] : [type(item) === "R" ? "dex" : "str"]) : ["str", "dex"];
		const hits = entry.tokens.filter(token => token.kind === "hit");
		const abilities = choices.filter(ability => hits.length && hits.every(token => token.value === mod(current, ability) + pb));
		const ability = abilities.length === 1 ? abilities[0] : undefined;
		const numbers = [];
		for (const token of entry.tokens) {
			const address = {paragraph: token.paragraph, kind: token.kind, token: token.token, ...token.dice ? {dice: copy(token.dice)} : {}};
			let governing;
			let multiplier = 0;
			let fixed = 0;
			if (weapon && ["hit", "damage"].includes(token.kind)) {
				if (token.kind === "hit") { governing = ability; multiplier = 1; } else if (["bludgeoning", "piercing", "slashing"].includes([...token.text.matchAll(/\{@damage [^{}]+}\)?\s+(\w+) damage/g)][token.token]?.[1])) governing = ability;
				if ((token.kind === "hit" || token.value !== 0 || /\b(?:bludgeoning|piercing|slashing) damage/.test(token.text)) && !governing) return undefined;
			} else if (["hit", "dc"].includes(token.kind)) {
				governing = entry.entry.ability;
				multiplier = 1;
				fixed = token.kind === "dc" ? 8 : 0;
				if (!ABILITIES.includes(governing)) return undefined;
			} else if (token.value !== 0) return undefined;
			if (governing) {
				if (token.value !== mod(current, governing) + multiplier * pb + fixed) return undefined;
				numbers.push({...address, mode: "ability", ability: governing, proficiency: multiplier, fixed});
			} else numbers.push({...address, mode: "fixed", value: token.value});
		}
		bindings.push({section: entry.section, match: copy(entry.match), mode: "bind", numbers});
	}
	const ac = includeArmor ? armor(current, items, dexChanges) : null;
	if (includeArmor && !ac) return undefined;
	return {...includeArmor ? {armor: ac} : {}, entries: bindings, proficiencyBonus: pb};
}

export function getCreatureTransformationSourceDefault ({control, model, items}) {
	const [namespace, key = namespace] = control.path;
	if (namespace === "spore" && key === "bindings") {
		const entries = model.entries.filter(entry => entry.section !== "trait" && entry.section !== "spellcasting"
			&& /\{@atk mw(?:,rw)?}/.test(JSON.stringify(entry.entry.entries))
			&& /\b(?:bludgeoning|piercing|slashing) damage/.test(JSON.stringify(entry.entry.entries)));
		if (!entries.length) return undefined;
		const defaults = getCreatureTransformationNumericDefaults({current: model.current, entries, items, includeArmor: false});
		if (!defaults) return undefined;
		return {entries: defaults.entries.map(({section, match}) => ({section, match, mode: "retain"}))};
	}
	if (key === "bindings" && namespace !== "spore") {
		const value = getCreatureTransformationNumericDefaults({current: model.current,
			entries: model.entries,
			items,
			dexChanges: ["catalog:skeleton|dmg", "catalog:skeletal wyrmling|ar8", "catalog:vampire|mm", "catalog:lycanthropy|mm", "catalog:wereshark|arcadia27"].includes(model.resolvedId)});
		if (value && namespace === "undead") delete value.proficiencyBonus;
		return value;
	}
	if (key === "proficiencyBonus" && control.required) return proficiency(model.current);
	if (control.choices?.length === 1) return copy(control.choices[0]);
	if (key === "donor") return copy(control.facts);
	if (key === "lair" && namespace !== "spore") return {mode: "retain"};
	if (key === "legendaryResistance" && !control.facts.length) return {mode: "grant"};
	if (namespace === "undead" && key === "senses") {
		const senses = control.facts.senses.flatMap((value, index) => {
			const match = /^(darkvision|blindsight) (\d+) ft\..+$/i.exec(value);
			if (!match || (match[1].toLowerCase() === "blindsight" && !control.facts.activeTraits.includes("headless"))) return [];
			return [{sense: match[1].toLowerCase(), index, range: Number(match[2])}];
		});
		return senses.length && new Set(senses.map(value => value.sense)).size === senses.length ? senses : undefined;
	}
	if (namespace === "undead" && key === "ghostWeapons") {
		const entries = model.entries.filter(entry => /\{@atk(?:r)? (?:mw|rw)(?:,(?:mw|rw))*}/.test(JSON.stringify(entry.entry.entries)));
		if (entries.some(entry => /\{@atk(?:r)? [^}]*[mr]s/.test(JSON.stringify(entry.entry.entries)))) return undefined;
		return entries.map(entry => ({section: entry.section,
			match: copy(entry.match),
			components: [...JSON.stringify(entry.entry.entries).matchAll(/\{@damage [^{}]+}\)?\s+(?:bludgeoning|piercing|slashing) damage/g)].map((_, index) => index)}));
	}
	return undefined;
}
