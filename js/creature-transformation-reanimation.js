import {isTransformationEntry} from "./creature-transformation-entries.js";
import {compileCreatureTransformationStats, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";

const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary"];
const LAIR_RENDER_FIELDS = ["lairActions", "regionalEffects", "mythicEncounter"];
const PROFILES = {
	"catalog:dracolich|mm": {name: "Dracolich",
		source: "MM",
		abilities: {},
		defenses: [
			{op: "grantResistance", value: "necrotic"}, {op: "grantImmunity", value: "poison"},
			...["charmed", "frightened", "paralyzed", "poisoned", "exhaustion"].map(value => ({op: "grantConditionImmunity", value})),
		],
		traits: [
			{name: "Magic Resistance", source: "MM", entries: ["The dracolich has advantage on saving throws against spells and other magical effects."]},
			{name: "Undead Nature", source: "MM", entries: ["The dracolich needs no air, food, drink, or sleep."]},
			{name: "Spirit Gem", source: "MM", entries: ["When this body is destroyed, the spirit retreats to its phylactery gem if both are on the same plane. While in the gem, the spirit can possess another dragon's corpse when the gem touches it, becoming a new dracolich. If the gem is on another plane when this body is destroyed, the spirit passes into the afterlife instead."]},
		]},
	"catalog:skeleton|dmg": {name: "Skeleton",
		source: "DMG",
		abilities: {dex: 2, int: -4, cha: -4},
		defenses: [
			{op: "grantSense", sense: "darkvision", range: 60}, {op: "grantImmunity", value: "poison"},
			{op: "grantVulnerability", value: "bludgeoning"},
			...["exhaustion", "poisoned"].map(value => ({op: "grantConditionImmunity", value})),
		],
		traits: []},
	"catalog:zombie|dmg": {name: "Zombie",
		source: "DMG",
		abilities: {str: 1, con: 2, int: -6, wis: -4, cha: -4},
		defenses: [
			{op: "grantSense", sense: "darkvision", range: 60}, {op: "grantImmunity", value: "poison"},
			{op: "grantConditionImmunity", value: "poisoned"},
		],
		traits: [
			{name: "Undead Fortitude", source: "DMG", entries: ["When damage would reduce the zombie to 0 hit points, it makes a Constitution saving throw with DC 5 + the damage taken, unless that damage is radiant or comes from a critical hit. On a success, it has 1 hit point instead."]},
		]},
	"catalog:skeletal wyrmling|ar8": {name: "Skeletal Wyrmling",
		source: "Ar8",
		abilities: {dex: -2, int: -2, cha: -2, wis: -1, con: 2},
		defenses: [
			{op: "grantImmunity", value: "poison"}, {op: "grantConditionImmunity", value: "poisoned"},
		],
		traits: []},
};
const record = value => value != null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const identity = (entry, chassisSource) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source});
const sameMatch = (a, b) => text(a?.name) && text(a?.source) && text(b?.name) && text(b?.source)
	&& canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const content = entries => {
	// Lair groups contain independently sourced nested supplements; validate their metadata
	// without stripping it from the frozen rule text or relaxing the Species entry subset.
	let visited = 0;
	const forValidation = (value, depth = 0) => {
		if (++visited > 10_000 || depth > 30) return null;
		if (Array.isArray(value)) return value.map(part => forValidation(part, depth + 1));
		if (!record(value)) return value;
		if (Object.hasOwn(value, "data") || ((value.source !== undefined || value.page !== undefined)
			&& !["entries", "inset", "list", "item", "itemSpell", "table"].includes(value.type))) return null;
		if ((value.source !== undefined && !text(value.source)) || (value.page !== undefined && (!Number.isInteger(value.page) || value.page < 1))) return null;
		return Object.fromEntries(Object.entries(value).filter(([key]) => !["source", "page"].includes(key)).map(([key, part]) => [key, forValidation(part, depth + 1)]));
	};
	return isTransformationEntry({name: "Lair", source: "MM", entries: forValidation(entries)})
		&& new TextEncoder().encode(JSON.stringify(entries)).length <= 24_000;
};
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);
const undeadType = value => keys(value, ["type"], ["tags", "swarmSize"]) && value.type === "undead"
	&& (value.tags === undefined || (Array.isArray(value.tags) && value.tags.length <= 100 && value.tags.every(tag => text(tag)
		|| (keys(tag, ["tag", "prefix"], ["prefixHidden"]) && text(tag.tag) && text(tag.prefix) && (tag.prefixHidden === undefined || typeof tag.prefixHidden === "boolean")))))
	&& (value.swarmSize === undefined || ["T", "S", "M", "L", "H", "G"].includes(value.swarmSize));
const lairGroup = value => keys(value, ["name", "source"], ["page", "lairActions", "regionalEffects", "mythicEncounter"])
	&& text(value.name) && text(value.source) && (value.page === undefined || (Number.isInteger(value.page) && value.page > 0))
	&& ["lairActions", "regionalEffects", "mythicEncounter"].every(key => value[key] === undefined || (Array.isArray(value[key]) && (!value[key].length || content(value[key]))));

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Reanimation: ${message}`);
	error.code = code;
	throw error;
}

export function isReanimationChange (step, key = "op") {
	switch (step?.[key]) {
		case "setReanimationType": return keys(step, [key, "value"]) && undeadType(step.value);
		case "setReanimationLanguages": return keys(step, [key, "value"]) && keys(step.value, ["languages", "languageTags"])
			&& strings(step.value.languages) && strings(step.value.languageTags)
			&& /^(?:understands .+ but can't speak|can't speak)$/.test(step.value.languages[0])
			&& step.value.languages.slice(1).every(language => /^telepathy\b/i.test(language))
			&& step.value.languageTags.includes("CS");
		case "setReanimationLair": return keys(step, [key, "value"]) && lairGroup(step.value);
		default: return false;
	}
}

export function isReanimationOp (op) {
	return ["setReanimationType", "setReanimationLanguages", "setReanimationLair"].includes(op);
}

function getRemoval (current, section, selected, chassisSource) {
	if (!SECTIONS.includes(section) || !match(selected)) fail("Removal needs an exact section/name/source identity.");
	const found = (current[section] || []).filter(entry => sameMatch(identity(entry, chassisSource), selected));
	if (found.length !== 1) fail(`${section} ${selected.name}|${selected.source} matched ${found.length} entries; resolve that exact identity.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
	return {op: "removeEntry", section, match: structuredClone(selected)};
}

function getSpeech (current) {
	if (current.languages !== undefined && !strings(current.languages)) fail("Resolve the current language list before restricting speech.");
	if (current.languageTags !== undefined && !strings(current.languageTags)) fail("Resolve the current language tags before restricting speech.");
	const languages = [];
	const understood = [];
	for (const language of current.languages || []) {
		if (/^telepathy\b/i.test(language)) { languages.push(language); continue; }
		if (/^(?:can't|cannot) speak$/i.test(language)) continue;
		const clean = language.replace(/^understands /i, "").replace(/,? but (?:can't|cannot) speak$/i, "");
		if (/\b(?:speak|understand)\b/i.test(clean)) fail(`Resolve the conditional language "${language}" to a concrete understanding list first.`);
		understood.push(clean);
	}
	languages.unshift(understood.length ? `understands ${understood.join(", ")} but can't speak` : "can't speak");
	const change = {op: "setReanimationLanguages", value: {languages, languageTags: [...new Set([...(current.languageTags || []), "CS"])]}};
	if (!isReanimationChange(change)) fail("Resolve the understanding-only language list within the supported language/tag limits.");
	return change;
}

function getPhysiology ({current, decisions, chassisSource}) {
	if (!Array.isArray(decisions) || decisions.length > 100) fail("Classify every current trait as retain/remove using physiology:[{match:{name,source},mode}].");
	const removals = [];
	const used = new Set();
	for (const entry of current.trait || []) {
		const selected = identity(entry, chassisSource);
		const matches = decisions.filter(it => keys(it, ["match", "mode"]) && match(it.match) && sameMatch(it.match, selected));
		if (matches.length !== 1 || used.has(matches[0]) || !["retain", "remove"].includes(matches[0].mode)) fail(`Classify exactly one source-qualified physiology decision for ${entry.name}|${selected.source}.`);
		const choice = matches[0];
		used.add(choice);
		if (canonical(selected.name) === "amphibious" && canonical(selected.source) === "mm" && choice.mode !== "remove") fail("Amphibious|MM assumes living physiology and must be removed.");
		if (choice.mode === "remove") removals.push(getRemoval(current, "trait", selected, chassisSource));
	}
	if (used.size !== decisions.length) fail("A physiology decision did not match exactly one current trait.");
	return removals;
}

export function compileCreatureTransformationLair (current, choice, legendaryGroups) {
	if (keys(choice, ["mode"]) && choice.mode === "retain") return [];
	if (!keys(choice, ["mode", "baseline", "actions"]) || choice.mode !== "replace" || !lairGroup(choice.baseline)
		|| !Array.isArray(choice.actions) || (choice.actions.length && !content(choice.actions))) fail("Choose lair mode retain, or replace with the complete source-qualified baseline group and concrete actions (including an empty list to lose all).");
	const existing = current.legendaryGroup;
	if (existing) {
		if (!sameMatch(existing, choice.baseline)) fail("The lair baseline must identify the target's actual legendary group.");
		let actual = existing;
		if (!LAIR_RENDER_FIELDS.some(key => Object.hasOwn(existing, key))) {
			// This is independently loaded source context, not another copy of the user's baseline answer.
			const found = Array.isArray(legendaryGroups) ? legendaryGroups.filter(group => sameMatch(group, existing)) : [];
			if (found.length !== 1 || !LAIR_RENDER_FIELDS.some(key => Object.hasOwn(found[0], key))) {
				fail(`Resolve the complete legendary group ${existing.name}|${existing.source} in legendaryGroups before replacing lair actions; its regional/mythic effects are unknown.`);
			}
			actual = found[0];
		}
		const baseline = Object.fromEntries(["name", "source", "page", ...LAIR_RENDER_FIELDS]
			.filter(key => Object.hasOwn(actual, key)).map(key => [key, actual[key]]));
		if (!lairGroup(baseline) || signature(baseline) !== signature(choice.baseline)) fail(`The lair baseline disagrees with the complete actual ${existing.name}|${existing.source} source-qualified render baseline; retain every regional/mythic effect.`);
	} else if (choice.baseline.lairActions?.length || choice.baseline.regionalEffects?.length || choice.baseline.mythicEncounter?.length) {
		fail("A target without a legendary group needs an empty baseline before inheriting new lair actions.");
	}
	return [{op: "setReanimationLair", value: {...structuredClone(choice.baseline), lairActions: structuredClone(choice.actions)}}];
}

function isDefiniteBreathWeapon (entry) {
	if (!/\bbreath\b/i.test(entry.name)) return false;
	const rules = JSON.stringify(entry.entries);
	return /\{@dc \d+\b/i.test(rules) && /\b(?:cone|line|radius|cube|sphere)\b/i.test(rules);
}

export function compileReanimation ({resolved, current, chassisSource, inputs, legendaryGroups}) {
	const profile = PROFILES[resolved.id];
	if (!profile || resolved.identity.name !== profile.name || resolved.identity.source !== profile.source) fail("Unsupported source-qualified reanimation profile.");
	if (!keys(inputs, ["reanimation"], ["bindings", "hp"])) fail("Complete M6 reanimation needs explicit reanimation decisions and, when scores change, M2b bindings; CR composition remains staged.");
	if (!keys(resolved.selectedOptions, [])) fail("Reanimation profiles do not accept catalog option groups.");
	for (const section of SECTIONS) {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100
			|| current[section].some(entry => !record(entry) || !match(identity(entry, chassisSource))))) fail(`${section} must be a bounded concrete entry array with exact name/source identities.`);
	}
	const dracolich = profile.name === "Dracolich";
	const wyrmling = profile.name === "Skeletal Wyrmling";
	const decisions = inputs.reanimation;
	const type = typeof current.type === "string" ? {type: current.type} : current.type;
	if (!record(type)) fail("A concrete current creature type is required.");
	const converted = {...structuredClone(type), type: "undead"};
	if (!undeadType(converted)) fail("The current type has unsupported metadata; resolve its exact retained tags/swarm size.");
	const changes = [{op: "setReanimationType", value: converted}, ...structuredClone(profile.defenses)];
	const receipts = {"automation-reanimation": [`${resolved.id.slice(8)}:m6`]};
	let removals = [];
	if (dracolich) {
		if (!keys(decisions, ["age", "trueDragon", "shadowDragon", "physiology", "lair"])) fail("Dracolich needs age, trueDragon, shadowDragon, source-qualified physiology decisions and a lair choice.");
		if (type.type !== "dragon" || ["wyrmling", "young"].includes(decisions.age) || decisions.trueDragon === false || decisions.shadowDragon === true
			|| (current.trait || []).some(entry => ["MM", "BEG"].some(source => sameMatch(identity(entry, chassisSource), {name: "Living Shadow", source})))) fail("Only an adult or ancient true dragon, never a shadow dragon, can become a dracolich.", "CREATURE_TRANSFORMATION_INELIGIBLE");
		if (!["adult", "ancient"].includes(decisions.age) || decisions.trueDragon !== true || decisions.shadowDragon !== false) fail("Confirm adult/ancient age, true-dragon identity and non-shadow nature.");
		removals = getPhysiology({current, decisions: decisions.physiology, chassisSource});
		changes.push(...compileCreatureTransformationLair(current, decisions.lair, legendaryGroups));
		receipts["automation-age"] = [decisions.age];
		receipts["automation-nature"] = ["true-dragon", "not-shadow"];
		receipts["automation-physiology"] = decisions.physiology.map(it => `${it.mode}:${it.match.name}|${it.match.source}`);
		receipts["automation-lair"] = [decisions.lair.mode];
		if (inputs.bindings !== undefined || inputs.hp !== undefined) fail("Dracolich retains its numeric chassis; numerical inputs are not needed.");
	} else {
		if (wyrmling) {
			if (!keys(decisions, ["wyrmling", "donor", "breaths"]) || decisions.wyrmling !== true || !match(decisions.donor)) fail("Confirm wyrmling age and the exact name/source blood donor, then classify breath entries.");
			if (type.type !== "dragon" || !sameMatch(current, decisions.donor)) fail("The selected chassis must be the actual dragon wyrmling blood donor, preserving its source/edition.", "CREATURE_TRANSFORMATION_INELIGIBLE");
			if (!Array.isArray(decisions.breaths) || decisions.breaths.length > 100) fail("Supply source-qualified breath decisions.");
			const used = new Set();
			for (const section of SECTIONS) {
				for (const entry of current[section] || []) {
					const selected = identity(entry, chassisSource);
					const found = decisions.breaths.filter(it => keys(it, ["section", "match", "mode"]) && match(it.match) && it.section === section && sameMatch(it.match, selected));
					if (found.length > 1 || (/\bbreath\b/i.test(entry.name) && found.length !== 1)) fail(`Classify ${section} ${entry.name}|${selected.source} as breath removal or a retained non-breath entry.`);
					if (!found.length) continue;
					if (used.has(found[0]) || !["remove", "retain"].includes(found[0].mode)) fail("Breath decisions must identify unique entries and a remove/retain mode.");
					used.add(found[0]);
					if (isDefiniteBreathWeapon(entry) && found[0].mode !== "remove") fail(`Donor breath ${selected.name}|${selected.source} must be removed, including shared alternatives; Ar8's no-breath rule applies to every source.`);
					if (found[0].mode === "remove") removals.push(getRemoval(current, section, selected, chassisSource));
				}
			}
			if (used.size !== decisions.breaths.length) fail("A breath decision did not match exactly one current entry.");
			receipts["automation-donor"] = [`${decisions.donor.name}|${decisions.donor.source}`];
			receipts["automation-breaths"] = decisions.breaths.map(it => `${it.mode}:${it.section}:${it.match.name}|${it.match.source}`);
		} else if (!keys(decisions, [])) fail("DMG NPC features retain alignment, equipment and existing capabilities; no MM monster substitutions or extra loss choices apply.");
		const abilities = Object.fromEntries(Object.entries(profile.abilities).map(([ability, delta]) => [ability, Math.max(1, current[ability] + delta)]));
		if (!keys(inputs.bindings, ["armor", "entries"], ["proficiencyBonus"])) fail("Supply explicit M2b armor and attack/DC bindings; changed scores must not leave stale derived numbers.");
		const hp = inputs.hp ?? {mode: Object.hasOwn(abilities, "con") ? "constitution" : "retain"};
		if (!keys(hp, ["mode"], ["value", "residual"]) || (!["constitution", "override"].includes(hp.mode) && !(hp.mode === "retain" && !Object.hasOwn(abilities, "con")))) fail("HP must reconcile Constitution once, or use an explicit concrete override; retained Hit Dice cannot receive a second per-die bonus.");
		if (!Object.hasOwn(abilities, "con") && hp.mode !== "retain") fail("Skeleton does not change Constitution or Hit Dice; retain its existing HP.");
		const numericCurrent = structuredClone(current);
		for (const removal of removals) numericCurrent[removal.section] = numericCurrent[removal.section].filter(entry => !sameMatch(identity(entry, chassisSource), removal.match));
		changes.push(...compileCreatureTransformationStats({current, abilities, hp}),
			...compileCreatureTransformationBindings({current: numericCurrent, abilities, chassisSource, ...inputs.bindings}), getSpeech(current));
	}
	changes.push(...removals);
	for (const entry of profile.traits) {
		const found = (current.trait || []).filter(it => sameMatch(identity(it, chassisSource), entry));
		if (found.length > 1) fail(`Resolve duplicate ${entry.name}|${entry.source} before granting its rule.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
		changes.push(found.length && !removals.some(it => sameMatch(it.match, entry))
			? {op: "replaceEntry", section: "trait", match: {name: entry.name, source: entry.source}, onMissing: "error", entry: structuredClone(entry)}
			: {op: "addEntry", section: "trait", entry: structuredClone(entry)});
	}
	const compiled = {...structuredClone(resolved),
		changes,
		selectedOptions: receipts,
		eligibility: [...structuredClone(resolved.eligibility).filter(rule => !rule.dmApproval), {dmApproval: true}],
		manualReview: [{field: "cr", reason: "M6 source effects are compiled; current CR/XP is retained. Estimated CR plus override and editor integration remain rollout prerequisites."}]};
	delete compiled.automation;
	if (!isCompiledReanimation(compiled)) throw new Error("Reanimation did not produce its closed, concrete M6 profile.");
	return compiled;
}

export function isCompiledReanimation (resolved) {
	const profile = PROFILES[resolved?.id];
	if (!profile || resolved.version !== 2 || resolved.kind !== "catalog" || resolved.identity?.name !== profile.name || resolved.identity?.source !== profile.source
		|| Object.hasOwn(resolved, "automation") || !Array.isArray(resolved.eligibility) || !resolved.eligibility.some(rule => rule.dmApproval === true)
		|| !keys(resolved.selectedOptions, ["automation-reanimation"],
			profile.name === "Dracolich" ? ["automation-age", "automation-nature", "automation-physiology", "automation-lair"]
				: profile.name === "Skeletal Wyrmling" ? ["automation-donor", "automation-breaths"] : [])
		|| signature(resolved.selectedOptions["automation-reanimation"]) !== signature([`${resolved.id.slice(8)}:m6`])
		|| !Object.values(resolved.selectedOptions).every(strings) || !Array.isArray(resolved.changes) || resolved.changes.length > 256) return false;
	const steps = resolved.changes.map(step => ({...step, op: step.op ?? step.type}));
	const asOp = step => Object.fromEntries(Object.entries(step).filter(([key]) => key !== "type"));
	if (steps[0]?.op !== "setReanimationType" || !isReanimationChange(asOp(steps[0]))
		|| profile.defenses.some((step, index) => signature(step) !== signature(asOp(steps[index + 1] || {})))) return false;
	if (steps.filter(step => step.op === "setReanimationType").length !== 1
		|| steps.filter(step => step.op === "setReanimationLanguages").length !== (profile.name === "Dracolich" ? 0 : 1)
		|| steps.filter(step => step.op === "setReanimationLair").length !== (profile.name === "Dracolich" && resolved.selectedOptions["automation-lair"]?.[0] === "replace" ? 1 : 0)) return false;
	const removalReceipts = profile.name === "Dracolich" ? resolved.selectedOptions["automation-physiology"] : resolved.selectedOptions["automation-breaths"];
	const actualRemovals = steps.filter(step => step.op === "removeEntry").map(step => `remove:${profile.name === "Dracolich" ? "" : `${step.section}:`}${step.match?.name}|${step.match?.source}`);
	if (signature([...actualRemovals].sort()) !== signature((removalReceipts || []).filter(it => it.startsWith("remove:")).sort())) return false;
	if (removalReceipts?.some(it => !(profile.name === "Dracolich"
		? /^(?:remove|retain):.+\|.+$/
		: /^(?:remove|retain):(?:trait|action|bonus|reaction|legendary):.+\|.+$/).test(it))) return false;
	const seen = new Set();
	for (const raw of steps.slice(1 + profile.defenses.length)) {
		const step = asOp(raw);
		let id = step.op;
		if (step.op === "setAbility") {
			if (!keys(step, ["op", "ability", "value"]) || !Object.hasOwn(profile.abilities, step.ability) || !Number.isInteger(step.value) || step.value < 1 || step.value > 30) return false;
			id += `:${step.ability}`;
		} else if (["addEntry", "replaceEntry"].includes(step.op)) {
			if (!profile.traits.some(entry => signature(entry) === signature(step.entry)) || step.section !== "trait"
				|| (step.op === "addEntry" ? !keys(step, ["op", "section", "entry"]) : !keys(step, ["op", "section", "match", "entry", "onMissing"]) || step.onMissing !== "error" || !sameMatch(step.match, step.entry))) return false;
			id = `trait:${step.entry.name}|${step.entry.source}`;
		} else if (step.op === "removeEntry") {
			if (!keys(step, ["op", "section", "match"]) || !SECTIONS.includes(step.section) || !match(step.match) || !["Dracolich", "Skeletal Wyrmling"].includes(profile.name)) return false;
			id += `:${step.section}:${step.match.name}|${step.match.source}`;
		} else if (!isReanimationChange(step) && !isCreatureTransformationStatChange(step) && !isCreatureTransformationBindingChange(step)) return false;
		else if (["setProficiencyBonus", "addInnateSpellcasting"].includes(step.op)) return false;
		else if (profile.name === "Skeleton" && step.op === "setHitPoints") return false;
		else id += `:${step.ability || step.skill || step.match?.name || ""}|${step.match?.source || ""}`;
		if (seen.has(id)) return false;
		seen.add(id);
	}
	if (profile.traits.some(entry => !seen.has(`trait:${entry.name}|${entry.source}`))) return false;
	if (profile.name === "Dracolich") {
		const options = resolved.selectedOptions;
		return ["adult", "ancient"].some(age => signature(options["automation-age"]) === signature([age]))
			&& signature(options["automation-nature"]) === signature(["true-dragon", "not-shadow"])
			&& Array.isArray(options["automation-physiology"]) && ["retain", "replace"].some(mode => signature(options["automation-lair"]) === signature([mode]))
			&& steps.every(step => ["setReanimationType", "setReanimationLair", "grantResistance", "grantImmunity", "grantConditionImmunity", "addEntry", "replaceEntry", "removeEntry"].includes(step.op));
	}
	if (profile.name === "Skeletal Wyrmling" && (!strings(resolved.selectedOptions["automation-donor"]) || resolved.selectedOptions["automation-donor"].length !== 1 || !strings(resolved.selectedOptions["automation-breaths"]))) return false;
	return steps.some(step => step.op === "setReanimationLanguages");
}
