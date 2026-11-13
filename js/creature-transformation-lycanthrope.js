import {isTransformationEntry} from "./creature-transformation-entries.js";
import {compileCreatureTransformationStats, getCreatureTransformationProficiencyBonus, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";
import {createFrozenCreatureTransformation} from "./creature-transformation-forms.js";

const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"];
const FORMS = ["humanoid", "hybrid", "animal"];
const KINDS = {
	werebear: {ability: "str", minimum: 19, armor: 1, animal: "bear", size: "L", hybridSize: "L", alignment: ["N", "G"], bite: [2, 10], claw: [2, 8]},
	wereboar: {ability: "str", minimum: 17, armor: 1, animal: "boar", alignment: ["N", "E"], tusks: [2, 6]},
	wererat: {ability: "dex", minimum: 15, armor: 0, animal: "giant rat", size: "S", alignment: ["L", "E"], bite: [1, 4]},
	weretiger: {ability: "str", minimum: 17, armor: 0, animal: "tiger", size: "L", alignment: ["N"], bite: [1, 10], claw: [1, 8]},
	werewolf: {ability: "str", minimum: 15, armor: 1, animal: "wolf", alignment: ["C", "E"], bite: [1, 8], claw: [2, 4]},
	wereshark: {ability: "str", minimum: 16, armor: 1, animal: "hunter shark", size: "L", bite: [1, 8]},
};
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => signature(a) === signature(b);
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const sameMatch = (a, b) => match(a) && match(b) && canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const address = item => `${item.section}:${canonical(item.match.name)}|${canonical(item.match.source)}`;
const sourceFor = kind => kind === "wereshark" ? "Arcadia27" : "MM";
const damage = ([number, faces], modifier) => `${Math.max(0, Math.floor(number * (faces + 1) / 2 + modifier))} ({@damage ${number}d${faces}${modifier ? ` ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}` : ""}})`;

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Lycanthrope: ${message}`);
	error.code = code;
	throw error;
}

export function getLycanthropeProfile (id) {
	return {"catalog:lycanthropy|mm": "lycanthropy", "catalog:wereshark|arcadia27": "wereshark"}[id];
}

function getKind (resolved) {
	if (resolved.id === "catalog:wereshark|arcadia27") return "wereshark";
	const choices = resolved.selectedOptions?.form;
	return Array.isArray(choices) && choices.length === 1 && choices[0] !== "wereshark" && Object.hasOwn(KINDS, choices[0]) ? choices[0] : null;
}

function getRules ({kind, form, ability, pb, con}) {
	const policy = KINDS[kind];
	const source = sourceFor(kind);
	const add = (section, name, ...entries) => ({op: "addEntry", section, entry: {name, source, entries}});
	const nonhumanoid = form !== "humanoid";
	const dc = 8 + pb + Parser.getAbilityModNumber(con);
	const strengthDc = 8 + pb + ability;
	const rules = [
		add("trait", "Lycanthrope Equipment and Forms",
			"Equipment worn or carried does not transform and is not deleted. Each frozen form executes the reviewed target-specific speech, equipment and armor restrictions. These are alternative forms of one owner, not additional transformations. Death restores the humanoid form.",
			kind === "wereshark"
				? "The Arcadia 27 Humanoid template grants only its listed features, not the example's other traits, equipment or actions. This stage retains CR and XP."
				: "This DM-approved NPC adaptation uses the MM 2014 player-character sidebar. Retain the target's statistics except the listed grants and reviewed form restrictions. Alignment changes only when embracing the curse; resisting retains the target's alignment. Character control remains a DM decision, not a combat engine."),
		add(kind === "wereshark" ? "bonus" : "trait", kind === "wereshark" ? "Change Shape" : "Shapechanger",
			`As ${kind === "wereshark" ? "a bonus action" : "an action"}, it can change between its humanoid form, ${kind === "werebear" ? "a Large" : "a"} ${kind === "wereshark" ? "shark" : kind.slice(4)}-humanoid hybrid, and ${policy.size === "L" ? "a Large" : policy.size === "S" ? "a Small" : "a"} ${policy.animal}. Only the source-defined size, movement and natural armor changes and the form's restrictions apply; other statistics are retained. Equipment does not transform. It returns to humanoid form on death.`),
	];
	if (kind !== "wereshark") {
		rules.push(add("trait", "Curse of Lycanthropy",
			"A non-lycanthrope humanoid wounded by a curse-bearing natural attack can acquire this curse on a failed Constitution save. Lycanthropy can also be inherited from a parent. An acquired curse can be removed with {@spell remove curse|PHB}; a natural-born lycanthrope requires {@spell wish|PHB}.",
			"Resisting preserves the creature's normal alignment and personality in humanoid form, but the full moon forces animal or hybrid transformation. Control returns as the moon wanes; memories of the transformation may be lost. Embracing allows learned mastery of voluntary shapechanging over time and changes alignment to that of the selected lycanthrope. The DM may take control of a character whose alignment changes until the curse is removed. These are complete rules, not automatic moon, memory, character-control or curse-removal adjudication."));
	}
	if (form === "animal") rules.push(add("trait", "Animal Speech", "It understands its retained languages but cannot speak. Telepathy is retained separately. Speech-dependent capabilities and explicitly unusable equipment capabilities are absent from this form; equipment itself is not destroyed or dropped by this rule."));
	if (kind === "wereshark") rules.push(add("trait", "Blood Frenzy", "It has advantage on melee attack rolls against a creature that is missing any hit points."));
	else if (["werebear", "wererat"].includes(kind)) rules.push(add("trait", "Keen Smell", "It has advantage on Wisdom ({@skill Perception}) checks that depend on smell."));
	else if (["weretiger", "werewolf"].includes(kind)) rules.push(add("trait", "Keen Hearing and Smell", "It has advantage on Wisdom ({@skill Perception}) checks that depend on hearing or smell."));
	if (kind === "wereboar") {
		rules.push(add("trait", "Relentless (Recharges after a Short or Long Rest)", "If damage of 14 or less would reduce it to 0 hit points, it instead falls to 1 hit point. It cannot use this trait again until it finishes a short or long rest."));
		if (nonhumanoid) rules.push(add("trait", "Charge", `After moving at least 15 feet straight toward a target and hitting it with its tusks on the same turn, it deals an extra 7 ({@damage 2d6}) slashing damage. A creature hit also makes a {@dc ${strengthDc}} Strength save, falling {@condition prone} on failure.`));
	}
	if (kind === "weretiger" && nonhumanoid) rules.push(add("trait", "Pounce", `After moving at least 15 feet straight toward a creature and hitting it with a claw on the same turn, that creature makes a {@dc ${strengthDc}} Strength save, falling {@condition prone} on failure. If the target is {@condition prone}, it can make one bite attack against that target as a bonus action.`));
	const attack = (name, dice, type, curse = false) => add("action", name,
		`{@atk mw} {@hit ${pb + ability}} to hit, reach 5 ft., one ${kind === "werewolf" && name === "Claws" ? "creature" : "target"}. {@h}${damage(dice, ability)} ${type} damage.${curse ? ` ${kind === "wereshark" ? "It may pass on its curse to a non-lycanthrope humanoid it hits" : "A humanoid it hits that is not already a lycanthrope"}: ${kind === "wereshark" ? "that target" : "the target"} must succeed on a {@dc ${dc}} Constitution save or gain ${kind} lycanthropy.${kind === "wereshark" ? " The target may choose to fail the save." : ""}` : ""}`);
	if (nonhumanoid) {
		if (policy.bite) rules.push(attack("Bite", policy.bite, "piercing", true));
		if (policy.tusks) rules.push(attack("Tusks", policy.tusks, "slashing", true));
		if (policy.claw && (kind !== "werewolf" || form === "hybrid")) rules.push(attack(kind === "werewolf" ? "Claws" : "Claw", policy.claw, "slashing"));
		if (kind === "werebear" || (kind === "weretiger" && form === "hybrid")) rules.push(add("action", "Lycanthrope Multiattack", "It makes two claw attacks. This routine is an alternative to, not extra attacks added to, any retained Multiattack."));
		if (kind === "werewolf" && form === "hybrid") rules.push(add("action", "Lycanthrope Multiattack", "It makes one bite attack and one claws attack. This routine is an alternative to, not extra attacks added to, any retained Multiattack."));
	}
	if (["wereboar", "wererat"].includes(kind) && form !== "animal") rules.push(add("action", "Lycanthrope Multiattack", `It makes two attacks, at most one of them ${kind === "wereboar" ? "with its tusks" : "a bite"}. Only actually available retained attacks may fill the other attack. This routine grants no equipment or equipment attacks and is an alternative to any retained Multiattack.`));
	return rules;
}

function getEntries (current, chassisSource) {
	return SECTIONS.flatMap(section => {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100)) fail(`Resolve the bounded ${section} entry list.`);
		const seen = new Set();
		return (current[section] || []).map(entry => {
			const item = {section, match: {name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source}};
			if (!match(item.match) || seen.has(address(item))) fail(`Resolve the exact, unique ${section} entry identity.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			seen.add(address(item));
			return {...item, entry};
		});
	});
}

const speedValue = value => integer(value, 0, 1000) || (keys(value, ["number"], ["condition"]) && integer(value.number, 0, 1000) && (value.condition === undefined || text(value.condition)));
const speed = value => keys(value, [], ["walk", "fly", "swim", "climb", "burrow", "alternate", "canHover"])
	&& ["walk", "fly", "swim", "climb", "burrow"].some(key => value[key] !== undefined)
	&& ["walk", "fly", "swim", "climb", "burrow"].every(key => value[key] === undefined || speedValue(value[key]))
	&& (value.canHover === undefined || typeof value.canHover === "boolean")
	&& (value.alternate === undefined || (record(value.alternate) && Object.entries(value.alternate).every(([key, values]) =>
		["walk", "fly", "swim", "climb", "burrow"].includes(key) && Array.isArray(values) && values.length <= 20 && values.every(speedValue))));

function getMovement (current, kind, form) {
	if (!speed(current.speed)) fail("Resolve the concrete current movement before freezing forms.");
	const movement = structuredClone(current.speed);
	const granted = kind === "wereshark" ? {walk: form === "animal" ? 0 : 30, ...form !== "humanoid" ? {swim: 40} : {}}
		: form === "humanoid" ? {} : {walk: kind === "werebear" || (form === "animal" && ["wereboar", "weretiger", "werewolf"].includes(kind)) ? 40 : 30, ...kind === "werebear" ? {climb: 30} : {}};
	Object.assign(movement, granted);
	if (movement.alternate) {
		for (const mode of Object.keys(granted)) delete movement.alternate[mode];
		if (!Object.keys(movement.alternate).length) delete movement.alternate;
	}
	return movement;
}

function getSpeech (current) {
	if ((current.languages !== undefined && !strings(current.languages)) || (current.languageTags !== undefined && !strings(current.languageTags))) fail("Resolve the concrete language/speech list.");
	const telepathy = [];
	const understood = [];
	for (const language of current.languages || []) {
		if (/^telepathy\b/i.test(language)) { telepathy.push(language); continue; }
		if (/^(?:can't|cannot) speak$/i.test(language)) continue;
		const clean = language.replace(/^understands /i, "").replace(/,? but (?:can't|cannot) speak$/i, "");
		if (/\b(?:speak|understand)\b/i.test(clean)) fail(`Resolve the conditional language "${language}" before restricting speech.`);
		understood.push(clean);
	}
	return {languages: [understood.length ? `understands ${understood.join(", ")} but can't speak` : "can't speak", ...telepathy],
		languageTags: [...new Set([...(current.languageTags || []), "CS"])]};
}

export function isLycanthropeOp (op) {
	return ["setLycanthropeForm", "setLycanthropeAlignment", "removeLycanthropeSpellcasting"].includes(op);
}

export function isLycanthropeChange (step, key = "op") {
	switch (step?.[key]) {
		case "setLycanthropeForm": return keys(step, [key, "form", "size", "speed"], ["speech"]) && FORMS.includes(step.form)
			&& ["T", "S", "M", "L", "H", "G"].includes(step.size) && speed(step.speed)
			&& (step.form === "animal" ? keys(step.speech, ["languages", "languageTags"]) && strings(step.speech.languages) && strings(step.speech.languageTags)
				&& /^(?:understands .+ but can't speak|can't speak)$/.test(step.speech.languages[0])
				&& step.speech.languages.slice(1).every(language => /^telepathy\b/i.test(language)) && step.speech.languageTags.includes("CS") : step.speech === undefined);
		case "setLycanthropeAlignment": return keys(step, [key, "value"]) && Object.values(KINDS).some(kind => kind.alignment && same(kind.alignment, step.value));
		case "removeLycanthropeSpellcasting": return keys(step, [key, "match"]) && match(step.match);
		default: return false;
	}
}

function remove (item) {
	return item.section === "spellcasting" ? {op: "removeLycanthropeSpellcasting", match: structuredClone(item.match)}
		: {op: "removeEntry", section: item.section, match: structuredClone(item.match)};
}

function getCapabilities (entries, choices, form) {
	if (!Array.isArray(choices) || choices.length !== entries.length) fail(`Classify every source-qualified existing entry in ${form}.entries with requiresSpeech and equipment:'not-required'|'usable'|'unusable'.`);
	const used = new Set();
	return entries.filter(item => {
		const found = choices.filter(choice => keys(choice, ["section", "match", "requiresSpeech", "equipment"])
			&& choice.section === item.section && sameMatch(choice.match, item.match)
			&& typeof choice.requiresSpeech === "boolean" && ["not-required", "usable", "unusable"].includes(choice.equipment));
		if (found.length !== 1 || used.has(found[0])) fail(`Classify exactly one ${form} ${address(item)}.`);
		used.add(found[0]);
		return (form === "animal" && found[0].requiresSpeech) || found[0].equipment === "unusable";
	});
}

function validateContract ({resolved, current, chassisSource, contract}) {
	const kind = getKind(resolved);
	if (!kind || !keys(contract, ["adaptation", "embrace", "bindings", "hybrid", "animal", "replaceFeatures"])
		|| contract.adaptation !== (kind === "wereshark" ? "arcadia27-template" : "sidebar-npc")
		|| (kind === "wereshark" ? contract.embrace !== false : typeof contract.embrace !== "boolean")
		|| !keys(contract.bindings, ["armor", "entries", "proficiencyBonus"])) fail("Confirm the exact source adaptation, MM embrace/resist choice, M2b bindings and both nonhumanoid capability/armor decisions.");
	if ((typeof current.type === "string" ? current.type : current.type?.type) !== "humanoid") fail("Both source profiles require a humanoid target.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (!Array.isArray(current.size) || current.size.length !== 1 || !["T", "S", "M", "L", "H", "G"].includes(current.size[0])) fail("Resolve one concrete humanoid size.");
	if (current.mythic?.length) fail("Standalone mythic capabilities need an explicit source policy before restricting form equipment/speech.");
	for (const ability of ["str", "dex", "con"]) if (!integer(current[ability], 1, 30)) fail(`Resolve the current ${ability} score.`);
	const pb = getCreatureTransformationProficiencyBonus(current, contract.bindings.proficiencyBonus, {checkNote: true});
	if (pb === undefined) fail("Declare actual current PB for proficient natural attacks and curse DCs; donor PB and CR are not inputs.");
	const abilities = {[KINDS[kind].ability]: Math.max(KINDS[kind].minimum, current[KINDS[kind].ability])};
	const entries = getEntries(current, chassisSource);
	for (const form of ["hybrid", "animal"]) {
		if (!keys(contract[form], ["entries", "armor"]) || !keys(contract[form].armor, ["mode", "reason"])
			|| !["retain", "unarmored"].includes(contract[form].armor.mode) || !text(contract[form].armor.reason)) fail(`${form} needs exact capability decisions and a reviewed retain/unarmored equipment AC policy.`);
		getCapabilities(entries, contract[form].entries, form);
	}
	const sourceRules = FORMS.flatMap(form => getRules({kind, form, ability: 0, pb, con: current.con}));
	if (!Array.isArray(contract.replaceFeatures) || contract.replaceFeatures.length > 100 || contract.replaceFeatures.some((choice, index) =>
		!keys(choice, ["section", "match"]) || !match(choice.match) || !SECTIONS.includes(choice.section)
		|| contract.replaceFeatures.slice(0, index).some(other => address(other) === address(choice))
		|| !entries.some(item => address(item) === address(choice))
		|| !sourceRules.some(rule => rule.section === choice.section && canonical(rule.entry.name) === canonical(choice.match.name)))) fail("replaceFeatures must identify unique existing source-rule conflicts, not arbitrary capabilities.");
	compileCreatureTransformationBindings({current, abilities, chassisSource, ...contract.bindings});
	return {kind, pb, abilities, entries};
}

function compileLeaf ({resolved, current, chassisSource, contract, form, context}) {
	const {kind, pb, abilities, entries} = context;
	const policy = KINDS[kind];
	const out = {...current, ...abilities};
	const ability = Parser.getAbilityModNumber(kind === "wererat" ? Math.max(out.str, out.dex) : out.str);
	const rules = getRules({kind, form, ability, pb, con: current.con});
	const removed = form === "humanoid" ? [] : getCapabilities(entries, contract[form].entries, form);
	for (const addition of rules) {
		for (const item of entries.filter(item => item.section === addition.section && canonical(item.match.name) === canonical(addition.entry.name))) {
			if (removed.some(other => address(other) === address(item))) continue;
			if (!contract.replaceFeatures.some(choice => address(choice) === address(item))) fail(`Choose replaceFeatures for competing ${address(item)}; source features must not stack.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			removed.push(item);
		}
	}
	const kept = structuredClone(current);
	for (const item of removed) kept[item.section] = kept[item.section].filter(entry => !sameMatch({name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source}, item.match));
	const bound = compileCreatureTransformationBindings({current: kept,
		abilities,
		chassisSource,
		...contract.bindings,
		entries: contract.bindings.entries.filter(binding => !removed.some(item => address(item) === address(binding)))});
	let armor = bound.find(step => step.op === "setArmorClass")?.value ?? current.ac;
	if (form !== "humanoid" && contract[form].armor.mode === "unarmored") armor = [10 + Parser.getAbilityModNumber(out.dex)];
	if (!isCreatureTransformationBindingChange({op: "setArmorClass", value: armor})) fail("Resolve the exact retained armor alternatives before applying natural armor.");
	if (form !== "humanoid" && policy.armor) armor = armor.map(value => typeof value === "number" ? value + policy.armor : {...structuredClone(value), ac: value.ac + policy.armor});
	const changes = [
		...compileCreatureTransformationStats({current, abilities, hp: {mode: "retain"}}),
		...bound.filter(step => step.op !== "setArmorClass"),
		...same(armor, current.ac) ? [] : [{op: "setArmorClass", value: structuredClone(armor)}],
		{op: "setLycanthropeForm",
			form,
			size: form === "animal" ? policy.size ?? current.size[0] : form === "hybrid" ? policy.hybridSize ?? current.size[0] : current.size[0],
			speed: getMovement(current, kind, form),
			...form === "animal" ? {speech: getSpeech(current)} : {}},
		...kind !== "wereshark" && contract.embrace ? [{op: "setLycanthropeAlignment", value: [...policy.alignment]}] : [],
		...["bludgeoning", "piercing", "slashing"].map(value => ({op: "grantConditionalDefense", kind: "immunity", value, when: "nonmagicalUnsilvered"})),
		...kind === "wereshark" ? [{op: "grantSense", sense: "blindsight", range: 60}] : [],
		...removed.map(remove), ...rules,
	];
	const compiled = {...structuredClone(resolved),
		changes,
		selectedOptions: {...kind === "wereshark" ? {} : {form: [kind]},
			"automation-lycanthrope": [kind === "wereshark" ? "arcadia27-template-m9" : "mm-sidebar-npc-m9"],
			"automation-lycanthrope-contract": [signature(contract)]},
		eligibility: [{types: ["humanoid"], dmApproval: true}],
		manualReview: [{field: "cr", reason: "M9 source stage retains CR/XP. Estimated CR/override composition and default editor rollout remain separate milestones."}]};
	delete compiled.automation;
	return compiled;
}

export function compileLycanthrope ({resolved, current, chassisSource, inputs, baseline}) {
	if (!getLycanthropeProfile(resolved?.id) || !keys(inputs, ["lycanthrope", "bindings"])
		|| !keys(inputs.lycanthrope, ["adaptation", "embrace", "hybrid", "animal"], ["replaceFeatures"])
		|| !keys(inputs.bindings, ["armor", "entries"], ["proficiencyBonus"])) fail("Supply source-specific lycanthrope decisions and existing M2b bindings.");
	if (resolved.id === "catalog:wereshark|arcadia27" ? !keys(resolved.selectedOptions, []) : !keys(resolved.selectedOptions, ["form"])) fail("MM form chooses kind, not active form; Wereshark has no catalog options.");
	const pb = getCreatureTransformationProficiencyBonus(current, inputs.bindings.proficiencyBonus, {checkNote: true});
	if (pb === undefined) fail("Declare the actual current PB.");
	const contract = {...structuredClone(inputs.lycanthrope),
		replaceFeatures: structuredClone(inputs.lycanthrope.replaceFeatures ?? []),
		bindings: {...structuredClone(inputs.bindings), proficiencyBonus: pb}};
	const context = validateContract({resolved, current, chassisSource, contract});
	const profiles = FORMS.map(form => ({id: form,
		label: form === "animal" ? KINDS[context.kind].animal : form,
		resolved: compileLeaf({resolved, current, chassisSource, contract, form, context})}));
	if (!baseline) fail("Frozen forms require the authoritative original target and actual pre-owner history baseline, outside target answers.");
	return createFrozenCreatureTransformation({profiles, activeForm: "humanoid", baseline});
}

function getContract (resolved) {
	const receipt = resolved.selectedOptions?.["automation-lycanthrope-contract"];
	if (!Array.isArray(receipt) || receipt.length !== 1 || typeof receipt[0] !== "string" || receipt[0].length > 60_000) return null;
	try { return JSON.parse(receipt[0]); } catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		return null;
	}
}

export function getLycanthropeForm (resolved) {
	return resolved.changes?.find(step => (step.op ?? step.type) === "setLycanthropeForm")?.form;
}

export function isCompiledLycanthrope (resolved) {
	const profile = getLycanthropeProfile(resolved?.id);
	const shark = profile === "wereshark";
	if (!profile || resolved.version !== 2 || resolved.kind !== "catalog" || Object.hasOwn(resolved, "automation")
		|| !same(resolved.identity, shark ? {name: "Wereshark", source: "Arcadia27"} : {name: "Lycanthropy", source: "MM"})
		|| !same(resolved.eligibility, [{types: ["humanoid"], dmApproval: true}])
		|| !keys(resolved.selectedOptions, [...shark ? [] : ["form"], "automation-lycanthrope", "automation-lycanthrope-contract"])
		|| !same(resolved.selectedOptions["automation-lycanthrope"], [shark ? "arcadia27-template-m9" : "mm-sidebar-npc-m9"])
		|| !getKind(resolved) || !getContract(resolved) || !Array.isArray(resolved.changes) || !resolved.changes.length || resolved.changes.length > 256) return false;
	let forms = 0;
	return resolved.changes.every(step => {
		const key = Object.hasOwn(step, "op") ? "op" : "type";
		if (step[key] === "setLycanthropeForm") forms++;
		if (isLycanthropeChange(step, key)) return true;
		if (isCreatureTransformationStatChange(step, key)) return !["setHitPoints", "setProficiencyBonus"].includes(step[key]);
		if (isCreatureTransformationBindingChange(step, key)) return step[key] !== "addInnateSpellcasting";
		switch (step[key]) {
			case "setAbility": return keys(step, [key, "ability", "value"]) && ["str", "dex"].includes(step.ability) && integer(step.value, 1, 30);
			case "grantConditionalDefense": return keys(step, [key, "kind", "value", "when"]) && step.kind === "immunity" && step.when === "nonmagicalUnsilvered" && ["bludgeoning", "piercing", "slashing"].includes(step.value);
			case "grantSense": return keys(step, [key, "sense", "range"]) && shark && step.sense === "blindsight" && step.range === 60;
			case "addEntry": return keys(step, [key, "section", "entry"]) && SECTIONS.includes(step.section) && isTransformationEntry(step.entry) && step.entry.source === sourceFor(getKind(resolved));
			case "removeEntry": return keys(step, [key, "section", "match"]) && SECTIONS.includes(step.section) && step.section !== "spellcasting" && match(step.match);
			default: return false;
		}
	}) && forms === 1;
}

export function assertLycanthropeProjection ({resolved, current, proposed, chassisSource}) {
	const contract = getContract(resolved);
	const context = validateContract({resolved, current, chassisSource, contract});
	const form = getLycanthropeForm(resolved);
	const expected = compileLeaf({resolved, current, chassisSource, contract, form, context});
	const steps = resolved.changes.map(step => ({...Object.fromEntries(Object.entries(step).filter(([key]) => key !== "type")), op: step.op ?? step.type}));
	if (!same(steps, expected.changes)) fail("The complete source profile must match the real pre-owner target: missing or extra setters/removals, stale numbers and contradictory grants are invalid.", "CREATURE_TRANSFORMATION_INVALID");
	const policy = KINDS[context.kind];
	if (proposed[policy.ability] !== Math.max(current[policy.ability], policy.minimum) || proposed.con !== current.con
		|| !same(proposed.hp, current.hp) || !same(proposed.speed, getMovement(current, context.kind, form))) fail("Actual source projection does not preserve the target chassis/minimum/movement.", "CREATURE_TRANSFORMATION_INVALID");
}
