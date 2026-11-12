import {isTransformationEntry} from "./creature-transformation-entries.js";
import {compileCreatureTransformationStats, getCreatureTransformationProficiencyBonus, isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";
import {createFrozenCreatureTransformation} from "./creature-transformation-forms.js";
import {isReanimationChange} from "./creature-transformation-reanimation.js";

const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary", "spellcasting"];
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => signature(a) === signature(b);
const identity = (entry, chassisSource) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source});
const match = value => keys(value, ["name", "source"]) && text(value.name) && text(value.source) && value.source !== "$chassis";
const sameIdentity = (a, b) => match(a) && match(b) && canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const add = (section, name, ...entries) => ({op: "addEntry", section, entry: {name, source: "MM", entries}});
const damage = (number, faces, modifier = 0) => `${Math.max(0, Math.floor(number * (faces + 1) / 2 + modifier))} ({@damage ${number}d${faces}${modifier ? ` ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}` : ""}})`;

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Vampire: ${message}`);
	error.code = code;
	throw error;
}

function getRules ({outcome, form, attack, strength, charmDc, grappleDc, legendary}) {
	const full = outcome === "vampire";
	const rules = [
		add("trait", "NPC Vampirism Adaptation", "This is an approved NPC adaptation of the MM 2014 player-character guidance, not a published universal NPC template. It retains the target's chassis and equipment, applies the sidebar's physical-score minima, and grants only the selected outcome's rules. Legendary actions and lair features are not newly granted. The grapple escape DC is an explicitly reviewed target value, not a formula inferred from a monster example. Current CR and XP require review."),
		add("trait", "Regeneration", `At the start of its turn, it recovers ${full ? 20 : 10} hit points only while it has at least 1 hit point and is outside sunlight and running water. Radiant damage or damage from {@item holy water (flask)|PHB} suppresses this recovery at the start of its next turn.`),
		add("trait", "Spider Climb", "It can climb difficult surfaces and move upside down along ceilings without an ability check. This trait does not grant a separate climbing speed."),
		add("trait", "Vampire Weaknesses",
			"An occupant must invite it before it can enter a residence.",
			"It takes 20 acid damage when it ends its turn in running water.",
			full
				? "A wooden piercing weapon driven through its heart while it is {@condition incapacitated} at its resting place leaves it {@condition paralyzed} until the stake is removed."
				: "A wooden piercing weapon driven through its heart while it is {@condition incapacitated} at its resting place destroys it.",
			"At the start of a turn in sunlight, it takes 20 radiant damage. Sunlight also imposes disadvantage on its attack rolls and ability checks."),
		add("trait", "Undead Nature", "It does not need air."),
		add("trait", "Chained to the Grave", "It must rest during the day at its coffin, crypt, or grave. Without a formal burial, its resting place is beneath a foot of earth at the site where it became undead. Moving its coffin or a significant quantity of grave dirt establishes another resting place."),
		add("trait", "Vampiric Nature", "It casts neither a shadow nor a reflection. The player-character guidance permits DM control and reversal by {@spell wish|PHB}, or by killing the character and restoring it to life; those character-control decisions are provenance, not an NPC combat engine."),
	];
	if (!full) {
		rules[0].entry.entries.push("The approved spawn policy uses minimum Strength, Dexterity, and Constitution 18, preserving higher scores, and lawful evil. This is an authored extension of the character-conversion sidebar, not the example spawn's scores or alignment. Only spawn features are granted; existing unrelated capabilities are retained.");
		rules.push(add("trait", "Creator's Control", "The creating vampire controls this spawn. Its creator's death frees its will but does not make it a true vampire. A true vampire can voluntarily let it drink that vampire's blood, changing it into a free-willed true vampire. This outcome is not a switchable form."));
	}
	if (full) {
		rules.push(
			add("trait", "Shapechanger",
				"As an action, outside sunlight and running water, it can become a Tiny bat, a Medium mist cloud, or its true form. These are forms of this vampire, not vampire/spawn outcomes.",
				"In bat form it cannot speak; its walking speed is 5 feet and its flying speed is 30 feet. Other statistics are unchanged apart from size and speed. Worn equipment transforms with it, but carried equipment does not. Death returns it to its true form.",
				"In mist form it cannot take actions, speak, or manipulate objects. It is weightless, flies 20 feet and can hover. It can occupy an enemy's space. It can pass without squeezing wherever air passes, but not through water. It has advantage on Strength, Dexterity, and Constitution saves, and immunity to nonmagical damage except damage from sunlight."),
			add("trait", "Misty Escape",
				"At 0 hit points outside its resting place, it becomes mist instead of {@condition unconscious}, unless sunlight or running water prevents the change; inability to transform destroys it.",
				"At 0 hit points as mist it cannot return to its true form and must reach its resting place within 2 hours or be destroyed. Reaching that place returns it to its true form, {@condition paralyzed} until it has at least 1 hit point. After 1 hour there at 0 hit points, it regains 1 hit point."),
		);
		if (legendary !== "retain") rules.push(add("trait", "Legendary Resistance (3/Day)", "After failing a saving throw, it can spend one use to succeed instead."));
	}
	if (form === "mist") {
		rules.push(add("trait", "Mist Form", "It cannot take actions, bonus actions, or reactions, cast spells, speak, or manipulate equipment or other objects. Its Strength, Dexterity, and Constitution saving throws have advantage. Its nonmagical-damage immunity excludes sunlight damage; its other weaknesses still apply."));
		return rules;
	}
	if (form === "true") {
		rules.push(add("action", full ? "Vampiric Multiattack (Vampire Form Only)" : "Vampiric Multiattack", "It makes two attacks, at most one of them a bite. This is an alternative to any retained Multiattack, not extra attacks."));
		rules.push(add("action", full ? "Unarmed Strike (Vampire Form Only)" : "Claws",
			`{@atk mw} {@hit ${attack}} to hit, reach 5 ft., one creature. {@h}${full ? damage(1, 8, strength) : damage(2, 4, strength)} ${full ? "bludgeoning" : "slashing"} damage. It may instead deal no damage and grapple that creature (escape {@dc ${grappleDc}}).`));
	}
	rules.push(add("action", full ? "Bite (Bat or Vampire Form Only)" : "Bite",
		`{@atk mw} {@hit ${attack}} to hit, reach 5 ft., one willing creature, or one that it has {@condition grappled}, or that is {@condition incapacitated} or {@condition restrained}. {@h}${damage(1, 6, strength)} piercing damage plus ${damage(full ? 3 : 2, 6)} necrotic damage. Reduce the target's hit point maximum by the necrotic damage actually taken; it regains that many hit points. The maximum reduction ends after the target completes a long rest; a maximum reduced to 0 kills the target.${full ? " If a humanoid dies from this reduction and is buried in the ground, it rises the next night as a {@creature vampire spawn|MM} controlled by this vampire." : ""}`));
	if (full) {
		rules.push(add("action", "Charm",
			`Choose one humanoid it can see within 30 feet. If that humanoid can also see it, the target makes a {@dc ${charmDc}} Wisdom save against magic; failure leaves the target {@condition charmed}. The target considers it a trusted friend worth protecting and interprets its requests and actions favorably, but is not controlled by it. The target willingly accepts its bite.`,
			"Harmful acts by it or its companions each allow another save, ending the charm on success. Otherwise it lasts 24 hours, ending sooner if it is destroyed, leaves the target's plane, or ends the effect with a bonus action."),
		add("action", "Children of the Night (1/Day)",
			"Only while the sun is down, it can magically summon {@dice 2d4} {@creature swarm of bats|MM|bat swarms} or {@creature swarm of rats|MM|rat swarms}; outdoors it may instead summon {@dice 3d6} {@creature wolf|MM|wolves}. Arrival takes {@dice 1d4} rounds. They are allies and follow its spoken commands. They remain for 1 hour, ending sooner on its death or its bonus-action dismissal. A form that cannot speak cannot issue spoken commands."));
	}
	if (form === "bat") rules.push(add("trait", "Bat Equipment and Speech", "Worn equipment transforms with this form, while carried equipment does not. It cannot speak. Carried-equipment usability is an explicit per-capability NPC adjudication, not a blanket source prohibition: retained capabilities still require their actual equipment. It cannot use its vampire-form Multiattack or Unarmed Strike."));
	return rules;
}

const speedValue = value => integer(value, 0, 1000) || (keys(value, ["number"], ["condition"]) && integer(value.number, 0, 1000)
		&& (value.condition === undefined || text(value.condition)));
const speed = value => keys(value, [], ["walk", "fly", "swim", "climb", "burrow", "alternate", "canHover"])
		&& ["walk", "fly", "swim", "climb", "burrow"].some(key => value[key] !== undefined)
		&& ["walk", "fly", "swim", "climb", "burrow"].every(key => value[key] === undefined || speedValue(value[key]))
		&& (value.canHover === undefined || typeof value.canHover === "boolean")
		&& (value.alternate === undefined || (record(value.alternate) && Object.entries(value.alternate).every(([key, values]) =>
			["walk", "fly", "swim", "climb", "burrow"].includes(key) && Array.isArray(values) && values.length <= 20 && values.every(speedValue))));
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);

export function isVampireOp (op) {
	return ["setVampireNature", "setVampireForm", "grantVampireMistImmunity", "removeVampireSpellcasting"].includes(op);
}

export function isVampireChange (step, key = "op") {
	switch (step?.[key]) {
		case "setVampireNature": return keys(step, [key, "value", "alignment"])
				&& isReanimationChange({op: "setReanimationType", value: step.value}) && same(step.alignment, ["L", "E"]);
		case "setVampireForm": return keys(step, [key, "form", "speed", "languages", "languageTags"])
				&& ["bat", "mist"].includes(step.form) && speed(step.speed) && strings(step.languages) && strings(step.languageTags)
				&& /^(?:understands .+ but can't speak|can't speak)$/.test(step.languages[0])
				&& step.languages.slice(1).every(language => /^telepathy\b/i.test(language)) && step.languageTags.includes("CS")
				&& (step.form === "bat" ? step.speed.walk === 5 && step.speed.fly === 30 : step.speed.fly === 20 && step.speed.canHover === true);
		case "grantVampireMistImmunity": return keys(step, [key]);
		case "removeVampireSpellcasting": return keys(step, [key, "match"]) && match(step.match);
		default: return false;
	}
}

export function getVampireMistImmunity () {
	return {immune: [...DAMAGE], note: "from nonmagical damage, except damage from sunlight", cond: true};
}

function getEntries (current, chassisSource) {
	return SECTIONS.flatMap(section => {
		if (current[section] !== undefined && (!Array.isArray(current[section]) || current[section].length > 100)) fail(`${section} must be a bounded concrete entry array.`);
		const seen = new Set();
		return (current[section] || []).map(entry => {
			const selected = identity(entry, chassisSource);
			if (!match(selected)) fail(`${section} needs an exact name/source identity.`);
			const id = `${canonical(selected.name)}|${canonical(selected.source)}`;
			if (seen.has(id)) fail(`Duplicate ${section} ${selected.name}|${selected.source}.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			seen.add(id);
			return {section, match: selected, entry};
		});
	});
}

function remove (item) {
	return item.section === "spellcasting"
		? {op: "removeVampireSpellcasting", match: structuredClone(item.match)}
		: {op: "removeEntry", section: item.section, match: structuredClone(item.match)};
}

function getSpeech (current) {
	if ((current.languages !== undefined && !strings(current.languages)) || (current.languageTags !== undefined && !strings(current.languageTags))) fail("Resolve the concrete language/speech list before compiling forms.");
	const telepathy = [];
	const understood = [];
	for (const language of current.languages || []) {
		if (/^telepathy\b/i.test(language)) { telepathy.push(language); continue; }
		if (/^(?:can't|cannot) speak$/i.test(language)) continue;
		const clean = language.replace(/^understands /i, "").replace(/,? but (?:can't|cannot) speak$/i, "");
		if (/\b(?:speak|understand)\b/i.test(clean)) fail(`Resolve the conditional language "${language}" before restricting speech.`);
		understood.push(clean);
	}
	return {
		languages: [understood.length ? `understands ${understood.join(", ")} but can't speak` : "can't speak", ...telepathy],
		languageTags: [...new Set([...(current.languageTags || []), "CS"])],
	};
}

function getLegendaryPolicy (entries, choice) {
	const existing = entries.filter(item => item.section === "trait" && /^legendary resistance\b/i.test(item.match.name));
	if (!existing.length) {
		if (!keys(choice, ["mode"]) || choice.mode !== "grant") fail("No existing Legendary Resistance: explicitly choose legendaryResistance:{mode:'grant'} for the sidebar's 3/Day trait.");
		return {mode: "grant", removals: [], receipt: ["grant"]};
	}
	if (keys(choice, ["mode", "match"]) && choice.mode === "retain" && existing.length === 1 && sameIdentity(choice.match, existing[0].match)) {
		return {mode: "retain", removals: [], receipt: [`retain:${existing[0].match.name}|${existing[0].match.source}`]};
	}
	if (!keys(choice, ["mode", "matches"]) || choice.mode !== "replace" || !Array.isArray(choice.matches)
			|| choice.matches.length !== existing.length || !choice.matches.every(match)) fail("Existing competing Legendary Resistance needs exact source-qualified retain (one pool only) or replace matches; pools must not stack.");
	const used = new Set();
	for (const item of existing) {
		const found = choice.matches.filter(selected => sameIdentity(selected, item.match));
		if (found.length !== 1 || used.has(found[0])) fail(`Choose exactly one replacement for ${item.match.name}|${item.match.source}.`);
		used.add(found[0]);
	}
	return {mode: "replace", removals: existing.map(remove), receipt: existing.map(item => `replace:${item.match.name}|${item.match.source}`)};
}

function getBatRemovals (entries, choices) {
	if (!Array.isArray(choices) || choices.length !== entries.length) fail("Classify every source-qualified existing entry in batEntries with requiresSpeech and carriedEquipment:'not-required'|'usable'|'unusable'; the app executes the exact target adjudication.");
	const used = new Set();
	const removals = [];
	for (const item of entries) {
		const found = choices.filter(choice => keys(choice, ["section", "match", "requiresSpeech", "carriedEquipment"])
				&& choice.section === item.section && sameIdentity(choice.match, item.match)
				&& typeof choice.requiresSpeech === "boolean" && ["not-required", "usable", "unusable"].includes(choice.carriedEquipment));
		if (found.length !== 1 || used.has(found[0])) fail(`Classify exactly one bat entry ${item.section} ${item.match.name}|${item.match.source}.`);
		used.add(found[0]);
		if (found[0].requiresSpeech || found[0].carriedEquipment === "unusable") removals.push(remove(item));
	}
	return removals;
}

function compileLeaf ({resolved, current, chassisSource, inputs, outcome, form, abilities, numeric, entries, legendary, batRemovals, replacements, pb}) {
	const decisions = inputs.vampire;
	const type = typeof current.type === "string" ? {type: current.type} : structuredClone(current.type);
	type.type = "undead";
	if (outcome === "vampire") type.tags = [...(type.tags || []).filter(tag => typeof tag !== "string" || canonical(tag) !== "shapechanger"), "shapechanger"];
	const nature = {op: "setVampireNature", value: type, alignment: ["L", "E"]};
	if (!isVampireChange(nature)) fail("Resolve the retained creature type metadata before becoming undead.");
	const removals = [...legendary.removals];
	if (form === "bat") removals.push(...batRemovals);
	if (form === "mist") removals.push(...entries.filter(item => item.section !== "trait").map(remove));
	const strength = Parser.getAbilityModNumber(abilities.str);
	const attack = pb + strength;
	const charmDc = outcome === "vampire" ? 8 + pb + Parser.getAbilityModNumber(current.cha) : 0;
	const additions = getRules({outcome, form, attack, strength, charmDc, grappleDc: decisions.grappleDc, legendary: legendary.mode});
	for (const addition of additions) {
		for (const item of entries.filter(item => item.section === addition.section && canonical(item.match.name) === canonical(addition.entry.name))) {
			if (removals.some(step => (step.section || "spellcasting") === item.section && sameIdentity(step.match, item.match))) continue;
			if (!replacements.some(choice => choice.section === item.section && sameIdentity(choice.match, item.match))) fail(`Choose replaceFeatures:[{section,match:{name,source}}] for the competing ${item.section} ${item.match.name}|${item.match.source}; the app will replace it with the complete MM rule.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			removals.push(remove(item));
		}
	}
	const uniqueRemovals = [...new Map(removals.map(step => [`${step.section || "spellcasting"}:${canonical(step.match.name)}|${canonical(step.match.source)}`, step])).values()];
	const kept = structuredClone(current);
	for (const item of uniqueRemovals) {
		const section = item.section || "spellcasting";
		kept[section] = kept[section].filter(entry => !sameIdentity(identity(entry, chassisSource), item.match));
	}
	const bindings = {...inputs.bindings,
		entries: inputs.bindings.entries.filter(binding =>
			!uniqueRemovals.some(step => (step.section || "spellcasting") === binding.section && sameIdentity(step.match, binding.match)))};
	const bound = compileCreatureTransformationBindings({current: kept, abilities, chassisSource, ...bindings, proficiencyBonus: pb});
	const changes = [nature, {op: "grantResistance", value: "necrotic"},
		...["bludgeoning", "piercing", "slashing"].map(value => ({op: "grantConditionalDefense", kind: "resistance", value, when: "nonmagical"})),
		{op: "grantSense", sense: "darkvision", range: outcome === "vampire" ? 120 : 60},
		...numeric, ...bound, ...uniqueRemovals];
	if (form !== "true") {
		if (!speed(current.speed)) fail("Resolve the current movement modes before freezing bat/mist movement.");
		const movement = {...structuredClone(current.speed), ...form === "bat" ? {walk: 5, fly: 30} : {fly: 20, canHover: true}};
		// Superseded alternatives must not re-enable a faster walking/flying mode.
		if (movement.alternate) {
			delete movement.alternate.fly;
			if (form === "bat") delete movement.alternate.walk;
			if (!Object.keys(movement.alternate).length) delete movement.alternate;
		}
		const step = {op: "setVampireForm", form, speed: movement, ...getSpeech(current)};
		if (!isVampireChange(step)) fail("The concrete no-speech/movement form exceeds the bounded contract.");
		changes.push(step);
		if (form === "mist") changes.push({op: "grantVampireMistImmunity"});
	}
	changes.push(...additions);
	const compiled = {...structuredClone(resolved),
		changes,
		selectedOptions: {
			outcome: [outcome],
			"automation-vampire": ["sidebar-npc-m8"],
			"automation-vampire-numbers": [[abilities.str, abilities.dex, abilities.con, pb, decisions.grappleDc, outcome === "vampire" ? current.cha : 0].join(":")],
			"automation-vampire-legendary": legendary.receipt,
			"automation-vampire-bat": batRemovals.map(step => `${step.section || "spellcasting"}:${step.match.name}|${step.match.source}`),
			"automation-vampire-replacements": replacements.map(choice => `${choice.section}:${choice.match.name}|${choice.match.source}`),
		},
		manualReview: [{field: "cr", reason: "M8 source-stage NPC adaptation retains current CR/XP. Automatic estimate/override and guided editor integration remain rollout prerequisites."}]};
	delete compiled.automation;
	return compiled;
}

export function compileVampire ({resolved, current, chassisSource, inputs, baseline}) {
	if (resolved.id !== "catalog:vampire|mm" || resolved.identity.name !== "Vampire" || resolved.identity.source !== "MM") fail("Only Vampire|MM has this staged NPC adaptation.");
	if (!keys(inputs, ["vampire", "bindings"], ["hp"]) || !keys(inputs.bindings, ["armor", "entries"], ["proficiencyBonus"])) fail("Supply vampire decisions and exact M2b armor/entry bindings.");
	if (!keys(resolved.selectedOptions, ["outcome"]) || !Array.isArray(resolved.selectedOptions.outcome) || resolved.selectedOptions.outcome.length !== 1
			|| !["vampire", "spawn"].includes(resolved.selectedOptions.outcome[0])) fail("Choose exactly one vampire/spawn outcome.");
	const [outcome] = resolved.selectedOptions.outcome;
	const full = outcome === "vampire";
	if (!keys(inputs.vampire, ["adaptation", "grappleDc", ...full ? ["legendaryResistance", "batEntries"] : []], ["replaceFeatures"]) || inputs.vampire.adaptation !== "sidebar-npc"
			|| !integer(inputs.vampire.grappleDc, 0, 100)) {
		fail(full
			? "Confirm adaptation:'sidebar-npc', an exact grappleDc (the examples do not define its formula), Legendary Resistance policy and every bat entry."
			: "Confirm the approved sidebar-npc spawn adaptation and exact grappleDc; spawn accepts no Legendary Resistance or bat/form choices.");
	}
	if ((typeof current.type === "string" ? current.type : current.type?.type) !== "humanoid") fail("The staged NPC adaptation requires a humanoid chassis.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	if (full && current.mythic?.length) fail("Standalone mythic actions need a source-policy resolution before a no-actions mist projection can be frozen.");
	if (!Array.isArray(current.size) || current.size.length !== 1 || !["T", "S", "M", "L", "H", "G"].includes(current.size[0])) fail("Resolve one concrete true-form size.");
	const abilities = {};
	for (const ability of ["str", "dex", "con"]) {
		if (!integer(current[ability], 1, 30)) fail(`Resolve the current ${ability} score.`);
		abilities[ability] = Math.max(18, current[ability]);
	}
	if (full && !integer(current.cha, 1, 30)) fail("Resolve the current Charisma for the source-defined Charm DC.");
	const pb = getCreatureTransformationProficiencyBonus(current, inputs.bindings.proficiencyBonus, {checkNote: true});
	if (pb === undefined) fail("Declare the actual current proficiencyBonus for STR-bound attacks and CHA-bound Charm; CR and donor averages are not PB inputs.");
	const hp = inputs.hp ?? {mode: "constitution"};
	if (!keys(hp, ["mode"], ["value", "residual"]) || !["constitution", "override"].includes(hp.mode)) fail("CON changes require M2a Constitution reconciliation or an exact HP override; never a donor Hit Dice substitution.");
	const numeric = compileCreatureTransformationStats({current, abilities, hp});
	const entries = getEntries(current, chassisSource);
	const legendary = full ? getLegendaryPolicy(entries, inputs.vampire.legendaryResistance) : {mode: "not-granted", removals: [], receipt: ["not-granted"]};
	const batRemovals = full ? getBatRemovals(entries, inputs.vampire.batEntries) : [];
	const replacements = inputs.vampire.replaceFeatures ?? [];
	const forms = full ? ["true", "bat", "mist"] : ["true"];
	const sourceRules = forms.flatMap(form => getRules({outcome, form, attack: 0, strength: 0, charmDc: 0, grappleDc: 0, legendary: legendary.mode}));
	if (!Array.isArray(replacements) || replacements.length > 100 || replacements.some((choice, index) =>
		!keys(choice, ["section", "match"]) || !match(choice.match) || !SECTIONS.includes(choice.section)
		|| replacements.slice(0, index).some(other => other.section === choice.section && sameIdentity(other.match, choice.match))
		|| !entries.some(item => item.section === choice.section && sameIdentity(item.match, choice.match))
		|| !sourceRules.some(rule => rule.section === choice.section && canonical(rule.entry.name) === canonical(choice.match.name))
		|| /^legendary resistance\b/i.test(choice.match.name))) fail("replaceFeatures needs unique, existing source-qualified MM-grant conflicts; Legendary Resistance has its separate pool policy.");
	// Validate all supplied bindings before filtering source-required form removals.
	compileCreatureTransformationBindings({current, abilities, chassisSource, ...inputs.bindings, proficiencyBonus: pb});
	if (!full) return compileLeaf({resolved, current, chassisSource, inputs, outcome, form: "true", abilities, numeric, entries, legendary, batRemovals, replacements, pb});
	const profiles = forms.map(form => ({id: form,
		label: {true: "True vampire", bat: "Tiny bat", mist: "Medium mist"}[form],
		resolved: compileLeaf({resolved, current, chassisSource, inputs, outcome, form, abilities, numeric, entries, legendary, batRemovals, replacements, pb})}));
	if (!baseline) fail("Full vampire forms require the authoritative pre-owner baseline supplied by the workflow, outside target answers.");
	return createFrozenCreatureTransformation({profiles, activeForm: "true", baseline});
}

export function getVampireForm (resolved) {
	return resolved.changes.find(step => (step.op ?? step.type) === "setVampireForm")?.form ?? "true";
}

export function assertVampireProjection ({resolved, current, proposed}) {
	const scores = resolved.selectedOptions["automation-vampire-numbers"][0].split(":").map(Number);
	for (const [index, ability] of ["str", "dex", "con"].entries()) {
		if (!integer(current[ability], 1, 30) || scores[index] !== Math.max(18, current[ability]) || proposed[ability] !== scores[index]) {
			fail(`The concrete ${ability} projection must implement the declared minimum 18 and preserve the target's higher score.`, "CREATURE_TRANSFORMATION_INVALID");
		}
	}
	if (getVampireForm(resolved) === "mist") {
		for (const section of ["action", "bonus", "reaction", "legendary", "spellcasting", "mythic"]) {
			if (proposed[section] !== undefined && (!Array.isArray(proposed[section]) || proposed[section].length)) {
				fail(`The concrete mist projection must remove every ${section} capability.`, "CREATURE_TRANSFORMATION_INVALID");
			}
		}
	}
}

export function isCompiledVampire (resolved) {
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== "catalog:vampire|mm" || resolved.identity?.name !== "Vampire"
			|| resolved.identity.source !== "MM" || Object.hasOwn(resolved, "automation") || !Array.isArray(resolved.eligibility)
			|| !same(resolved.eligibility, [{types: ["humanoid"], dmApproval: true}])
			|| !keys(resolved.selectedOptions, ["outcome", "automation-vampire", "automation-vampire-numbers", "automation-vampire-legendary", "automation-vampire-bat", "automation-vampire-replacements"])
			|| !same(resolved.selectedOptions["automation-vampire"], ["sidebar-npc-m8"]) || resolved.selectedOptions.outcome?.length !== 1
			|| !["vampire", "spawn"].includes(resolved.selectedOptions.outcome[0])
			|| !Object.values(resolved.selectedOptions).every(strings) || resolved.selectedOptions["automation-vampire-numbers"].length !== 1
			|| !Array.isArray(resolved.changes) || resolved.changes.length < 1 || resolved.changes.length > 256) return false;
	const numbers = resolved.selectedOptions["automation-vampire-numbers"][0].split(":").map(Number);
	if (numbers.length !== 6 || numbers.some(value => !Number.isInteger(value))) return false;
	const [str, dex, con, pb, grappleDc, cha] = numbers;
	const [outcome] = resolved.selectedOptions.outcome;
	const full = outcome === "vampire";
	if (![str, dex, con].every(value => integer(value, 18, 30)) || !integer(pb, 1, 30) || !integer(grappleDc, 0, 100) || (full ? !integer(cha, 1, 30) : cha !== 0)) return false;
	const steps = resolved.changes.map(step => ({...Object.fromEntries(Object.entries(step).filter(([key]) => key !== "type")), op: step.op ?? step.type}));
	const form = getVampireForm(resolved);
	const lr = resolved.selectedOptions["automation-vampire-legendary"];
	if (full) {
		if (!lr.length || !(same(lr, ["grant"]) || (lr.length === 1 && /^retain:[^|]+\|[^|]+$/.test(lr[0])) || lr.every(value => /^replace:[^|]+\|[^|]+$/.test(value)))) return false;
	} else if (!same(lr, ["not-granted"]) || resolved.selectedOptions["automation-vampire-bat"].length || Object.hasOwn(resolved, "frozenForms")) return false;
	const expected = getRules({outcome, form, attack: pb + Parser.getAbilityModNumber(str), strength: Parser.getAbilityModNumber(str), charmDc: full ? 8 + pb + Parser.getAbilityModNumber(cha) : 0, grappleDc, legendary: lr[0].startsWith("retain:") ? "retain" : "grant"});
	const requiredRemovals = new Set([
		...lr.filter(value => value.startsWith("replace:")).map(value => `trait:${value.slice("replace:".length)}`),
		...resolved.selectedOptions["automation-vampire-replacements"].filter(value =>
			expected.some(rule => canonical(value).startsWith(`${rule.section}:${canonical(rule.entry.name)}|`))),
		...form === "bat" ? resolved.selectedOptions["automation-vampire-bat"] : [],
	].map(canonical));
	const removals = new Set();
	const seen = new Set();
	for (const step of steps) {
		let id = step.op;
		if (isVampireOp(step.op)) {
			if (!isVampireChange(step)) return false;
			if (!full && step.op !== "setVampireNature") return false;
			if (step.op === "setVampireNature" && ((full && !step.value.tags?.includes("shapechanger")) || !same(step.alignment, ["L", "E"]))) return false;
			if (step.op === "removeVampireSpellcasting") {
				const receipt = canonical(`spellcasting:${step.match.name}|${step.match.source}`);
				if (form !== "mist" && !(form === "bat" && requiredRemovals.has(receipt))) return false;
				removals.add(receipt);
				id += `:${step.match.name}|${step.match.source}`;
			}
		} else if (step.op === "setAbility") {
			if (!keys(step, ["op", "ability", "value"]) || !["str", "dex", "con"].includes(step.ability)
					|| step.value !== {str, dex, con}[step.ability]) return false;
			id += `:${step.ability}`;
		} else if (step.op === "addEntry") {
			if (!keys(step, ["op", "section", "entry"]) || !isTransformationEntry(step.entry) || !expected.some(rule => same(rule, step))) return false;
			id = `entry:${step.section}:${step.entry.name}|${step.entry.source}`;
		} else if (step.op === "grantResistance") {
			if (!keys(step, ["op", "value"]) || step.value !== "necrotic") return false;
		} else if (step.op === "grantConditionalDefense") {
			if (!keys(step, ["op", "kind", "value", "when"]) || step.kind !== "resistance" || step.when !== "nonmagical"
					|| !["bludgeoning", "piercing", "slashing"].includes(step.value)) return false;
			id += `:${step.value}`;
		} else if (step.op === "grantSense") {
			if (!keys(step, ["op", "sense", "range"]) || step.sense !== "darkvision" || step.range !== (full ? 120 : 60)) return false;
		} else if (step.op === "removeEntry") {
			if (!keys(step, ["op", "section", "match"]) || !SECTIONS.includes(step.section) || step.section === "spellcasting" || !match(step.match)) return false;
			const receipt = canonical(`${step.section}:${step.match.name}|${step.match.source}`);
			if (!requiredRemovals.has(receipt) && !(form === "mist" && step.section !== "trait")) return false;
			removals.add(receipt);
			id += `:${step.section}:${step.match.name}|${step.match.source}`;
		} else if (isCreatureTransformationStatChange(step) || isCreatureTransformationBindingChange(step)) {
			if (["setProficiencyBonus", "addInnateSpellcasting"].includes(step.op)) return false;
			id += `:${step.ability || step.skill || step.match?.name || ""}|${step.match?.source || ""}`;
		} else return false;
		if (seen.has(id)) return false;
		seen.add(id);
	}
	return [...requiredRemovals].every(receipt => removals.has(receipt))
			&& seen.has("setVampireNature") && expected.every(rule => seen.has(`entry:${rule.section}:${rule.entry.name}|MM`))
			&& seen.has("grantResistance") && seen.has("grantSense") && ["bludgeoning", "piercing", "slashing"].every(value => seen.has(`grantConditionalDefense:${value}`))
			&& seen.has("setVampireForm") === (form !== "true") && seen.has("grantVampireMistImmunity") === (form === "mist");
}
