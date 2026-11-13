import {compileCreatureTransformationStats} from "./creature-transformation-stats.js";
import {compileCreatureTransformationBindings, observeCreatureTransformationBindings} from "./creature-transformation-bindings.js";
import {estimateCreatureTransformationCr, getCreatureTransformationCrProficiency, isCreatureTransformationCrChange} from "./creature-transformation-cr.js";
import {composeCreatureTransformationRoutines, observeCreatureTransformationRoutineEntries} from "./creature-transformation-routines.js";

export const CREATURE_TRANSFORMATION_DEFENSE_FIELDS = ["hp", "ac", "save", "skill", "passive", "resist", "immune", "vulnerable", "conditionImmune", "speed", "senses", "legendaryGroup", "mythic"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 1000;
const canonical = value => JSON.stringify(value, (_key, part) => record(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const same = (a, b) => canonical(a) === canonical(b);
const asOp = ({op, type, ...fields}) => ({op: op ?? type, ...fields});

function fail (message) {
	const error = new Error(`Source CR composition: ${message}`);
	error.code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED";
	throw error;
}

function assertCoverage (current, coverage, chassisSource) {
	if (!keys(coverage, ["entries", "defenses"]) || !Array.isArray(coverage.entries) || coverage.entries.length > 600
		|| !Array.isArray(coverage.defenses) || coverage.defenses.length !== CREATURE_TRANSFORMATION_DEFENSE_FIELDS.length) fail("Review every post-source entry and each defense field, including absent fields, with a reason.");
	const observed = observeCreatureTransformationBindings({current, chassisSource});
	if (coverage.entries.length !== observed.length || observed.some(entry => coverage.entries.filter(item =>
		keys(item, ["section", "match", "decision", "reason"]) && item.section === entry.section && same(item.match, entry.match)
		&& ["represented", "excluded"].includes(item.decision) && text(item.reason)).length !== 1)
		|| CREATURE_TRANSFORMATION_DEFENSE_FIELDS.some(field => coverage.defenses.filter(item =>
			keys(item, ["field", "reason"]) && item.field === field && text(item.reason)).length !== 1)) fail("Coverage is incomplete, duplicated or stale for the actual post-source entries/defenses.");
}

export function getCreatureTransformationSourceEntryDeclarations ({source, current, beforeSource, chassisSource}) {
	const changes = source.changes.map(asOp);
	const undead = source.id === "catalog:undead|scre" ? JSON.parse(source.selectedOptions["automation-undead-inputs"][0]) : {};
	const original = observeCreatureTransformationBindings({current: beforeSource, chassisSource});
	return observeCreatureTransformationBindings({current, chassisSource}).flatMap(entry => {
		const generated = changes.find(step => ["addEntry", "replaceEntry", "setUndeadEntry", "setFallenAngelEntry"].includes(step.op)
			&& step.section === entry.section && same({name: step.entry?.name, source: step.entry?.source}, entry.match));
		const innate = changes.find(step => step.op === "addInnateSpellcasting" && entry.section === "spellcasting"
			&& same({name: step.name, source: step.source}, entry.match));
		if (!generated && !innate) return [];
		const kind = source.selectedOptions.form?.[0] ?? (source.id === "catalog:wereshark|arcadia27" ? "wereshark" : null);
		const lycan = ["catalog:lycanthropy|mm", "catalog:wereshark|arcadia27"].includes(source.id);
		const vampire = source.id === "catalog:vampire|mm";
		const natural = lycan && ["Bite", "Tusks", "Claw", "Claws"].includes(entry.match.name);
		const vampiric = vampire && /^(?:Bite|Claws|Unarmed Strike)/.test(entry.match.name);
		const spore = source.id === "catalog:spore servant|mm" && entry.match.name === "Unarmed Strike";
		const previous = original.find(item => item.section === entry.section && same(item.match, entry.match));
		const sourceDefined = innate || ["addEntry", "replaceEntry"].includes(generated?.op) || /^Corrupting Touch/.test(entry.match.name)
			|| (entry.match.source === "SCRE" && ["Ghoulish Strikes (1/Turn)", "Stench", "Rotting Strikes", "Dreadful Glare", "Touch of Death (1/Day)", "Deathly Aura"].includes(entry.match.name));
		const numbers = entry.tokens.filter(token => sourceDefined || !previous?.tokens.some(item =>
			item.paragraph === token.paragraph && item.kind === token.kind && item.token === token.token)).map(token => {
			const numeric = {paragraph: token.paragraph,
				kind: token.kind,
				token: token.token,
				mode: "fixed",
				value: token.value,
				...token.dice ? {dice: structuredClone(token.dice)} : {}};
			let ability;
			let proficiency = 0;
			let fixed = 0;
			if ((natural || vampiric || spore) && (token.kind === "hit" || (token.kind === "damage" && token.token === 0))) {
				ability = natural && kind === "wererat" && current.dex > current.str ? "dex" : "str";
				proficiency = token.kind === "hit" ? 1 : 0;
			} else if (token.kind === "dc" && (natural || (lycan && ["Charge", "Pounce"].includes(entry.match.name)))) {
				ability = natural ? "con" : "str"; proficiency = 1; fixed = 8;
			} else if (token.kind === "dc" && ((vampire && entry.match.name === "Charm") || /^Corrupting Touch/.test(entry.match.name))) {
				ability = "cha"; proficiency = 1; fixed = 8;
			} else if (token.kind === "dc" && source.id === "catalog:undead|scre"
				&& ["Ghoulish Strikes (1/Turn)", "Stench", "Rotting Strikes", "Dreadful Glare"].includes(entry.match.name)) {
				ability = entry.match.name === "Dreadful Glare" ? undead.glareAbility : "con"; proficiency = 1; fixed = 8;
			} else if (innate && ["hit", "dc"].includes(token.kind)) {
				ability = innate.ability; proficiency = 1; fixed = token.kind === "dc" ? 8 : 0;
			}
			if (!ability) return numeric;
			const {value, ...bound} = numeric;
			return {...bound, mode: "ability", ability, proficiency, fixed};
		});
		return [{section: entry.section, match: entry.match, supported: entry.supported, numbers}];
	});
}

export function getCreatureTransformationSourceProficiencies (source) {
	const skill = {};
	if (source.id.startsWith("catalog:shadow dragon|")) skill.stealth = 2;
	if (source.id === "catalog:fallen angel|scre") {
		for (const step of source.changes.map(asOp).filter(step => step.op === "setSkillBonus")) skill[step.skill] = 1;
	}
	return {save: {}, skill};
}

function reconciliation ({source, current, beforeSource, inputs, chassisSource, proficiencyContext}) {
	if (!keys(inputs, ["bindings", "proficiencies", "coverage", "table", "composition", "scope", "armorReason"])
		|| !keys(inputs.bindings, ["armor", "entries"], ["proficiencyBonus"]) || !Array.isArray(inputs.bindings.entries)
		|| !keys(inputs.proficiencies, ["save", "skill"]) || !text(inputs.scope) || !text(inputs.armorReason)
		|| !record(inputs.composition)) fail("Use only explained M2 armor/entry declarations, save/skill multipliers, full coverage, and frozen three-round judgments/table.");
	assertCoverage(current, inputs.coverage, chassisSource);
	for (const required of getCreatureTransformationSourceEntryDeclarations({source, current, beforeSource, chassisSource})) {
		if (!required.numbers.length) continue;
		const declared = inputs.bindings.entries?.find(entry => entry.section === required.section && same(entry.match, required.match));
		if (required.supported && (declared?.mode !== "bind" || !Array.isArray(declared.numbers)
			|| required.numbers.some(number => declared.numbers.filter(item => same(item, number)).length !== 1))) {
			fail(`${required.match.name}|${required.match.source} must keep its source-defined PB/ability or donor-fixed contributions; use the finite observed source declarations.`);
		}
	}
	for (const section of ["save", "skill"]) {
		if (!record(inputs.proficiencies[section])
			|| !same(Object.keys(inputs.proficiencies[section]).sort(), Object.keys(current[section] || {}).sort())
			|| Object.values(inputs.proficiencies[section]).some(value => ![0, 1, 2].includes(value))) fail(`Declare every actual post-source ${section} PB/expertise multiplier, including source-fixed zero.`);
	}
	for (const [skill, multiplier] of Object.entries(getCreatureTransformationSourceProficiencies(source).skill)) {
		if (inputs.proficiencies.skill[skill] !== multiplier) fail(`${skill} must retain the actual source-defined PB multiplier ${multiplier}; retained authored minima are reconciled separately.`);
	}
	const entries = observeCreatureTransformationRoutineEntries({current, chassisSource, scope: inputs.scope});
	const proficiency = getCreatureTransformationCrProficiency({current,
		proficiencyBonus: inputs.bindings.proficiencyBonus,
		proficiencyContext,
		answer: inputs.composition.proficiencyAnswer});
	if (source.id.startsWith("catalog:shadow dragon|")
		&& proficiency.before !== Number(source.selectedOptions["automation-stealth"][0].split(":")[0])) {
		fail("Shadow Dragon source Stealth and CR composition must use the same actual PB; declare the source-fixed PB in the post-source bindings when it differs from ordinary CR.");
	}
	const assumptions = composeCreatureTransformationRoutines({model: {entries, chassisSource},
		projection: current,
		bindings: inputs.bindings,
		answer: inputs.composition,
		proficiency,
		compactReview: true});
	if (!same(inputs.coverage.entries, inputs.composition.coverage.map(item => {
		const entry = entries.find(entry => entry.id === item.entryId);
		return {section: entry.section, match: entry.match, decision: item.decision, reason: item.reason};
	}))) fail("Frozen routine and entry coverage decisions disagree.");
	const cr = estimateCreatureTransformationCr({
		current,
		table: inputs.table,
		assumptions,
		proficiencyBonus: inputs.bindings.proficiencyBonus,
		proficiencyContext,
	});
	const {before, after} = cr.receipt.proficiency;
	// Abilities/HP were already reconciled by the source producer. Only declared PB contributions
	// are reconciled here; a second ability delta would double-count the source transformation.
	const numeric = compileCreatureTransformationStats({
		current,
		abilities: {},
		hp: {mode: "retain"},
		proficiencyBonus: before,
		nextProficiencyBonus: after,
		bindings: inputs.proficiencies,
	});
	if (source.id === "catalog:fallen angel|scre") {
		for (const skill of Object.keys(getCreatureTransformationSourceProficiencies(source).skill)) {
			const value = Math.max(Number(beforeSource.skill?.[skill] ?? -10_000), Parser.getAbilityModNumber(current.cha) + after);
			const index = numeric.findIndex(step => step.op === "setSkillBonus" && step.skill === skill);
			if (index !== -1) numeric[index] = {op: "setSkillBonus", skill, value};
			else if (value !== Number(current.skill[skill])) numeric.push({op: "setSkillBonus", skill, value});
		}
	}
	if (!numeric.some(step => step.op === "setProficiencyBonus")) numeric.push({op: "setProficiencyBonus", value: after});
	const bound = compileCreatureTransformationBindings({
		current, chassisSource, ...inputs.bindings, proficiencyBonus: before, nextProficiencyBonus: after,
	});
	return [...numeric, ...bound, cr];
}

export function getCreatureTransformationSourceProfile (resolved) {
	if (!Object.hasOwn(resolved, "estimation")) return resolved;
	const {estimation, frozenForms, ...source} = resolved;
	return {...source, changes: source.changes.slice(0, estimation.sourceChangeCount), manualReview: structuredClone(estimation.sourceReview)};
}

export function isEstimatedCreatureTransformation (resolved) {
	const receipt = resolved?.estimation;
	if (resolved?.version !== 2 || resolved.kind !== "catalog"
		|| (["catalog:zombie|dmg", "catalog:skeleton|dmg", "catalog:dracolich|mm", "catalog:skeletal wyrmling|ar8"].includes(resolved.id)
			&& !Object.hasOwn(resolved.selectedOptions || {}, "automation-reanimation"))
		|| !keys(receipt, ["version", "baseline", "sourceChangeCount", "sourceReview", "inputs"])
		|| receipt.version !== 1 || !keys(receipt.baseline, ["sourceUid", "key"])
		|| typeof receipt.baseline.sourceUid !== "string" || !/^[^|\r\n]+\|[^|\r\n]+$/.test(receipt.baseline.sourceUid)
		|| typeof receipt.baseline.key !== "string" || !/^[a-f0-9]{8}$/.test(receipt.baseline.key)
		|| !Number.isSafeInteger(receipt.sourceChangeCount) || receipt.sourceChangeCount < 1 || receipt.sourceChangeCount > 256
		|| !Array.isArray(receipt.sourceReview) || !receipt.sourceReview.every(item => keys(item, ["field", "reason"]) && text(item.reason))
		|| !Array.isArray(resolved.changes) || resolved.changes.length <= receipt.sourceChangeCount || resolved.changes.length > 512
		|| !keys(receipt.inputs, ["bindings", "proficiencies", "coverage", "table", "composition", "scope", "armorReason"])) return false;
	const tail = resolved.changes.slice(receipt.sourceChangeCount).map(asOp);
	return tail.every(step => ["setSaveBonus", "setSkillBonus", "setPassivePerception", "setProficiencyBonus", "setArmorClass", "setEntryNumbers", "setChallengeRating"].includes(step.op))
		&& tail.filter(step => step.op === "setProficiencyBonus").length === 1
		&& tail.filter(step => step.op === "setChallengeRating").length === 1
		&& isCreatureTransformationCrChange(tail.at(-1))
		&& tail.find(step => step.op === "setProficiencyBonus").value === tail.at(-1).receipt.proficiency.after;
}

export function composeCreatureTransformationEstimate ({source, current, beforeSource, inputs, baseline, chassisSource, proficiencyContext = null}) {
	if (source.estimation || source.frozenForms) fail("Compose one independently compiled source leaf at a time.");
	const tail = reconciliation({source, current, beforeSource, inputs, chassisSource, proficiencyContext});
	return {...structuredClone(source),
		changes: [...structuredClone(source.changes), ...tail],
		manualReview: [...source.manualReview.filter(item => item.field !== "cr"),
			{field: "cr", reason: "DMG 2014 estimate, not playtested. The saved complete three-round/defense judgments and any reasoned override remain DM adjudications."}],
		estimation: {version: 1,
			baseline: structuredClone(baseline),
			sourceChangeCount: source.changes.length,
			sourceReview: structuredClone(source.manualReview),
			inputs: structuredClone(inputs)}};
}

export function assertCreatureTransformationEstimate ({resolved, current, beforeSource, baseline, chassisSource}) {
	if (!isEstimatedCreatureTransformation(resolved) || !same(resolved.estimation.baseline, baseline)) fail("The frozen estimate is malformed or its actual pre-owner target changed.");
	const receipt = resolved.estimation;
	const tail = resolved.changes.slice(receipt.sourceChangeCount).map(asOp);
	const proficiencyContext = tail.at(-1).receipt.proficiency.history;
	const expected = reconciliation({source: getCreatureTransformationSourceProfile(resolved), current, beforeSource, inputs: receipt.inputs, chassisSource, proficiencyContext});
	if (!same(tail, expected)) fail("Frozen CR/PB effects disagree with their actual post-source target and declared contributions; re-preview, never append arbitrary effects.");
}
