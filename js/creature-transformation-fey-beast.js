import {compileCreatureTransformationInnateSpellcasting, isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";
import {getCreatureTransformationProficiencyBonus} from "./creature-transformation-stats.js";
import {getCreatureTransformationCrProficiency} from "./creature-transformation-cr.js";

const ID = "catalog:fey beast|scre";
const FEATURES = ["barkskin", "fey-touched", "entangle", "spike-growth", "natural-camouflage", "plant-stride", "rooted", "tree-stride", "nature-sense", "teleport"];
const RULES = {
	"fey-touched": ["trait", "Fey-Touched", "The creature has advantage on saving throws against being charmed or frightened."],
	"natural-camouflage": ["trait", "Natural Camouflage", "In forest or grassland terrain, the creature has advantage on Dexterity (Stealth) checks."],
	"plant-stride": ["trait", "Plant Stride", "Nonmagical plants neither slow the creature nor damage it with thorns, spines, or similar hazards when it moves through them. Plants created or manipulated by magic also do not impede its movement, including those from the entangle spell."],
	rooted: ["trait", "Rooted", "The creature has advantage on saving throws against effects that push it, pull it, or knock it prone."],
	"tree-stride": ["trait", "Tree Stride", "Once on its own turn, the creature can spend 10 feet of movement to magically enter a living tree within 5 feet of it and emerge in an unoccupied space within 5 feet of another living tree within 60 feet of the first tree. Both trees must be at least one size larger than the creature. This movement does not require an action or bonus action."],
	"nature-sense": ["action", "Nature Sense", "As an action, the creature chooses a kind of beast or plant and magically learns the direction and distance to the nearest one within 5 miles, if any is present."],
	teleport: ["action", "Teleport {@recharge 4}", "As an action, the creature magically teleports up to 30 feet to an unoccupied space it can see, taking its worn and carried equipment with it. As part of this action, it can make exactly one attack either before or after teleporting, not both; this does not grant Multiattack."],
};
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 256;
const canonical = value => value.trim().toLowerCase();
const signature = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const strings = value => Array.isArray(value) && value.length <= 100 && value.every(text);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hasSpells = features => features.some(id => ["entangle", "spike-growth"].includes(id));
const identity = (entry, chassisSource) => ({name: entry.name, source: !entry.source || entry.source === "$chassis" ? chassisSource : entry.source});
const sameIdentity = (a, b) => text(a?.name) && text(a?.source) && text(b?.name) && text(b?.source)
	&& canonical(a.name) === canonical(b.name) && canonical(a.source) === canonical(b.source);
const typeValue = value => keys(value, ["type"], ["tags", "swarmSize"]) && value.type === "fey"
	&& (value.tags === undefined || (Array.isArray(value.tags) && value.tags.length <= 100 && value.tags.every(tag => text(tag)
		|| (keys(tag, ["tag", "prefix"], ["prefixHidden"]) && text(tag.tag) && text(tag.prefix) && (tag.prefixHidden === undefined || typeof tag.prefixHidden === "boolean")))))
	&& (value.swarmSize === undefined || ["T", "S", "M", "L", "H", "G"].includes(value.swarmSize));

function getProficiency (current, declared) {
	const explicit = getCreatureTransformationProficiencyBonus(current, declared, {checkNote: true});
	return explicit ?? getCreatureTransformationCrProficiency({current}).before;
}

function fail (message, code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED") {
	const error = new Error(`Fey Beast: ${message}`);
	error.code = code;
	throw error;
}

function selections (selected) {
	if (!keys(selected, ["features"], ["automation-fey-beast", "automation-fey-beast-inputs"])
		|| !Array.isArray(selected.features) || !selected.features.length || selected.features.length > 10
		|| new Set(selected.features).size !== selected.features.length || selected.features.some(id => !FEATURES.includes(id))) fail("Choose one or more distinct existing Fey Beast features; CR is typical guidance, not a selection cap.");
	return selected.features;
}

function decisions (inputs, features) {
	if (!keys(inputs, [], ["feyBeast"]) || (inputs.feyBeast !== undefined && !keys(inputs.feyBeast, [], ["proficiencyBonus", "speaksSylvan"]))) fail("Only optional feyBeast proficiencyBonus and ambiguous speaksSylvan decisions are supported.");
	const answer = inputs.feyBeast || {};
	if (answer.proficiencyBonus !== undefined && (!hasSpells(features) || !integer(answer.proficiencyBonus, 1, 30))) fail("A current PB declaration is only needed for a selected spell and must be an integer from 1 to 30.");
	if (answer.speaksSylvan !== undefined && typeof answer.speaksSylvan !== "boolean") fail("The ambiguous Sylvan speech decision must be a boolean.");
	return answer;
}

export function observeFeyBeast ({current, features}) {
	if (!integer(current.int, 1, 30)) fail("Resolve the target's actual Intelligence before determining Sylvan understanding.");
	if (current.languages !== undefined && !strings(current.languages)) fail("Resolve the concrete language list before adding Sylvan understanding.");
	const languages = current.languages || [];
	const listsSylvan = language => /(?:^|,\s*|\band\s+)Sylvan(?:$|,|\s+and\b)/i.test(language);
	const understandsSylvan = languages.some(language => {
		const understanding = /^understands\s+(.+)$/i.exec(language);
		return understanding && listsSylvan(understanding[1].split(/\s+(?:but|except)\b/i)[0].trim());
	});
	const understandingOnly = language => /^understands\b.*\bbut (?:can't|cannot) speak(?: (?:it|them))?$/i.test(language);
	const spoken = languages.filter(language => !understandingOnly(language) && !/^(?:can't|cannot) speak\b|^telepathy\b/i.test(language));
	const speaksSylvan = spoken.some(language => !/^understands\b/i.test(language) && listsSylvan(language));
	const ambiguous = current.int >= 3 && !speaksSylvan && spoken.some(language => /\b(?:any|all|one|two|three|choice|chose|chosen|languages?|life|creator|understands?|speaks?)\b/i.test(language) || /\bSylvan\b/i.test(language));
	let proficiencyBonus;
	let proficiencyReason;
	if (hasSpells(features)) {
		const explicit = getCreatureTransformationProficiencyBonus(current, undefined, {checkNote: true});
		if (explicit !== undefined) proficiencyBonus = explicit;
		else {
			try { proficiencyBonus = getProficiency(current); } catch (error) {
				if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
				proficiencyReason = error.message;
			}
		}
	}
	return {speaksSylvan: current.int < 3 ? false : ambiguous ? null : speaksSylvan, understandsSylvan, proficiencyBonus, proficiencyReason};
}

export function isFeyBeastCatalog (candidate) {
	const [group] = candidate.optionGroups || [];
	return candidate.optionGroups?.length === 1 && group.id === "features" && group.selection === "any" && group.required === true
		&& signature(group.options.map(option => option.id)) === signature(FEATURES);
}

export function isFeyBeastOp (op) {
	return ["setFeyBeastType", "grantFeyBeastUnderstanding"].includes(op);
}

export function isFeyBeastChange (step, key = "op") {
	if (step?.[key] === "setFeyBeastType") return keys(step, [key, "value"]) && typeValue(step.value);
	return step?.[key] === "grantFeyBeastUnderstanding" && keys(step, [key]);
}

function getChanges ({current, features, answer, chassisSource}) {
	const type = typeof current.type === "string" ? {type: current.type} : current.type;
	if (type?.type !== "beast") fail("Only a beast can receive Fey Beast.", "CREATURE_TRANSFORMATION_INELIGIBLE");
	const value = {...structuredClone(type), type: "fey"};
	if (!typeValue(value)) fail("Resolve the current type's unsupported metadata; retained tags and swarm size must be concrete.");
	const observed = observeFeyBeast({current, features});
	if (observed.speaksSylvan === null && answer.speaksSylvan === undefined) fail("Confirm whether this target's ambiguous language capability already includes speaking Sylvan.");
	if (observed.speaksSylvan !== null && answer.speaksSylvan !== undefined) fail("A Sylvan speech answer is only permitted for an ambiguous current language capability.");
	const changes = [{op: "setFeyBeastType", value}];
	if (current.int >= 3 && !(answer.speaksSylvan ?? observed.speaksSylvan)
		&& !observed.understandsSylvan) {
		if (current.languages?.length >= 100) fail("The understanding grant would exceed the bounded language-list limit; resolve the language list first.");
		changes.push({op: "grantFeyBeastUnderstanding"});
	}
	for (const feature of features) {
		if (feature === "barkskin") {
			changes.push({op: "setArmorClass", value: [{ac: 16, from: ["natural armor (Barkskin)"]}]});
			continue;
		}
		if (["entangle", "spike-growth"].includes(feature)) {
			const name = feature === "entangle" ? "Entangle" : "Spike Growth";
			const step = compileCreatureTransformationInnateSpellcasting({
				current,
				proficiencyBonus: getProficiency(current, answer.proficiencyBonus),
				spellcasting: {name: `Innate Spellcasting: ${name}`,
					source: "SCRE",
					ability: "wis",
					dcFixed: 8,
					attackFixed: 0,
					components: ["S"],
					spells: [{spell: `${name.toLowerCase()}|PHB`, usage: "daily", uses: 1, each: true}]},
			});
			if (current.spellcasting !== undefined && !Array.isArray(current.spellcasting)) fail("Resolve the current spellcasting array without removing its unrelated spells.");
			if ((current.spellcasting || []).some(entry => sameIdentity(identity(entry, chassisSource), step))) fail(`Resolve the existing ${step.name}|SCRE grant before adding the same source-qualified spell.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
			changes.push(step);
			continue;
		}
		const [section, name, rule] = RULES[feature];
		if (current[section] !== undefined && !Array.isArray(current[section])) fail(`Resolve the current ${section} array without losing its retained capabilities.`);
		const entry = {name, source: "SCRE", entries: [rule]};
		const found = (current[section] || []).filter(it => sameIdentity(identity(it, chassisSource), entry));
		if (found.length > 1) fail(`Resolve duplicate ${section} ${name}|SCRE identities.`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
		changes.push(found.length
			? {op: "replaceEntry", section, match: {name, source: "SCRE"}, onMissing: "error", entry}
			: {op: "addEntry", section, entry});
	}
	return changes;
}

export function compileFeyBeast ({resolved, current, inputs, chassisSource}) {
	if (resolved.id !== ID || resolved.identity.name !== "Fey Beast" || resolved.identity.source !== "SCRE") fail("Only the source-qualified Fey Beast|SCRE profile is supported.");
	const features = selections(resolved.selectedOptions);
	if (Object.keys(resolved.selectedOptions).length !== 1) fail("Pending Fey Beast accepts only its existing features group.");
	const answer = decisions(inputs, features);
	const compiled = {...structuredClone(resolved),
		eligibility: [{types: ["beast"], dmApproval: true}],
		selectedOptions: {features: [...features], "automation-fey-beast": ["scre-m10"], "automation-fey-beast-inputs": [JSON.stringify(answer)]},
		changes: getChanges({current, features, answer, chassisSource}),
		manualReview: [
			{field: "eligibility", reason: "SCRE is provisional screenshot attribution; page, edition and publisher remain independently unverified."},
			{field: "cr", reason: "M10 retains current CR/XP. The typical CR-linked feature count is guidance, not a cap. Estimated CR/override and default rollout remain M13."},
		]};
	delete compiled.automation;
	if (!isCompiledFeyBeast(compiled)) throw new Error("Fey Beast did not produce its closed M10 profile.");
	return compiled;
}

function getAnswer (resolved) {
	const options = resolved.selectedOptions;
	selections(options);
	if (!keys(options, ["features", "automation-fey-beast", "automation-fey-beast-inputs"])
		|| signature(options["automation-fey-beast"]) !== "[\"scre-m10\"]"
		|| !Array.isArray(options["automation-fey-beast-inputs"]) || options["automation-fey-beast-inputs"].length !== 1
		|| typeof options["automation-fey-beast-inputs"][0] !== "string" || options["automation-fey-beast-inputs"][0].length > 256) fail("Missing bounded M10 input receipt.");
	let answer;
	try { answer = JSON.parse(options["automation-fey-beast-inputs"][0]); } catch { fail("Malformed M10 input receipt."); }
	return decisions({feyBeast: answer}, options.features);
}

export function isCompiledFeyBeast (resolved) {
	if (resolved?.version !== 2 || resolved.kind !== "catalog" || resolved.id !== ID
		|| !keys(resolved.identity, ["name", "source"]) || resolved.identity.name !== "Fey Beast" || resolved.identity.source !== "SCRE"
		|| Object.hasOwn(resolved, "automation") || signature(resolved.eligibility) !== signature([{types: ["beast"], dmApproval: true}])
		|| !Array.isArray(resolved.changes) || !resolved.changes.length || resolved.changes.length > 12) return false;
	try {
		getAnswer(resolved);
		return resolved.changes.every(step => {
			if (!record(step)) return false;
			const key = Object.hasOwn(step, "op") ? "op" : "type";
			return isFeyBeastChange(step, key)
				|| (["setArmorClass", "addInnateSpellcasting"].includes(step[key]) && isCreatureTransformationBindingChange(step, key))
				|| (["addEntry", "replaceEntry"].includes(step[key]) && ["trait", "action"].includes(step.section) && step.entry?.source === "SCRE");
		});
	} catch (error) {
		if (error.code !== "CREATURE_TRANSFORMATION_INPUT_REQUIRED") throw error;
		return false;
	}
}

export function assertFeyBeastProjection ({resolved, current, chassisSource}) {
	const answer = getAnswer(resolved);
	const expected = getChanges({current, features: resolved.selectedOptions.features, answer, chassisSource});
	const actual = resolved.changes.map(step => {
		const {op, type, ...fields} = step;
		return {op: op ?? type, ...fields};
	});
	if (signature(actual) !== signature(expected)) fail("The frozen effects do not match the complete selected source profile on this actual pre-owner target; re-preview its history.");
}
