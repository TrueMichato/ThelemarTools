import {compileCreatureTransformation} from "../creature-transformations.js";
import {observeCreatureTransformationBindings} from "../creature-transformation-bindings.js";
import {getCreatureTransformationProficiencyBonus, observeCreatureTransformationHitPoints} from "../creature-transformation-stats.js";
import {getCreatureTransformationCrProficiency} from "../creature-transformation-cr.js";
import {normalizeCreatureTransformation} from "./bestiary-transformation-catalog-adapter.js";
import {BestiaryQuickActionsUtil} from "./bestiary-quick-actions-engine.js";
import {getLycanthropeProfile} from "../creature-transformation-lycanthrope.js";
import {observeFeyBeast} from "../creature-transformation-fey-beast.js";
import {observeFallenAngel} from "../creature-transformation-fallen-angel.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value, required, optional = []) => isRecord(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 1000;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sourceUid = creature => `${creature.name}|${creature.source}`.toLowerCase();
const known = new Set(["CREATURE_TRANSFORMATION_INPUT_REQUIRED", "CREATURE_TRANSFORMATION_INELIGIBLE", "CREATURE_TRANSFORMATION_ENTRY_MATCH"]);

function requireAnswer (condition, reason, control, selector = null) {
	if (condition) return;
	const error = new Error(reason);
	Object.assign(error, {code: "CREATURE_TRANSFORMATION_INPUT_REQUIRED", control, selector});
	throw error;
}

export function freezeCreatureTransformationInputs (value) {
	if (value && typeof value === "object") {
		Object.values(value).forEach(freezeCreatureTransformationInputs);
		Object.freeze(value);
	}
	return value;
}

export function inspectCreatureTransformationInputs ({target, resolved}) {
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations});
	const targetKey = JSON.stringify({id: target.id, baseCreature: target.baseCreature, operations: target.operations || []});
	const model = {targetId: target.id, sourceUid: sourceUid(target.baseCreature), chassisSource: target.baseCreature.source, targetKey, current, controls: [], suggestions: [], requirements: []};
	const add = (kind, selector, facts = {}) => {
		const control = {id: JSON.stringify([target.id, model.sourceUid, kind, selector]), kind, selector, ...facts};
		model.controls.push(control);
		return control;
	};
	const issue = (control, reason, selector = control) => model.requirements.push({targetId: target.id, control, selector, reason});
	if (resolved?.version === 2 && resolved.id === "catalog:fallen angel|scre" && resolved.automation?.profile === "fallen-angel") {
		try {
			for (const binding of observeFallenAngel({current, chassisSource: target.baseCreature.source, allegiance: resolved.selectedOptions.allegiance[0]})) {
				add("fallenAngelBinding", binding.key, {facts: binding.facts});
			}
		} catch (error) {
			if (!known.has(error.code)) throw error;
			issue("fallenAngel", error.message);
		}
		return {...model, status: model.requirements.length ? "blocked" : model.controls.length ? "needs-answers" : "ready"};
	}
	if (resolved?.version === 2 && resolved.id === "catalog:fey beast|scre" && resolved.automation?.profile === "fey-beast") {
		try {
			const observed = observeFeyBeast({current, features: resolved.selectedOptions.features});
			model.facts = observed;
			if (observed.speaksSylvan === null) add("confirmation", "speaksSylvan", {facts: current.languages, choices: [true, false]});
			if (resolved.selectedOptions.features.some(id => ["entangle", "spike-growth"].includes(id)) && observed.proficiencyBonus === undefined) add("proficiencyBonus", "current", {reason: observed.proficiencyReason});
		} catch (error) {
			if (!known.has(error.code)) throw error;
			issue("feyBeast", error.message);
		}
		return {...model, status: model.requirements.length ? "blocked" : model.controls.length ? "needs-answers" : "ready"};
	}
	if (resolved?.version === 2 && getLycanthropeProfile(resolved.id) && getLycanthropeProfile(resolved.id) === resolved.automation?.profile) {
		const shark = resolved.id === "catalog:wereshark|arcadia27";
		add("lycanthropeConsent", "adaptation", {choices: [shark ? "arcadia27-template" : "sidebar-npc"]});
		if (!shark) add("lycanthropeConsent", "embrace", {choices: [true, false]});
		add("proficiencyBonus", "current", {facts: current.profBonus ?? current.pbNote ?? null});
		add("lycanthropeArmorBinding", "current", {facts: current.ac});
		add("lycanthropeReplacements", "features");
		try { model.entries = observeCreatureTransformationBindings({current, chassisSource: target.baseCreature.source}); } catch (error) {
			if (!known.has(error.code)) throw error;
			issue("entry", error.message);
			return {...model, status: "blocked"};
		}
		for (const entry of model.entries) {
			if (entry.needsBinding) add("lycanthropeEntryBinding", {section: entry.section, ...entry.match}, {facts: entry});
			for (const form of ["hybrid", "animal"]) {
				add("lycanthropeCapability", {form, section: entry.section, ...entry.match}, {facts: entry,
					equipmentChoices: ["not-required", "usable", "unusable"],
					speechRestricted: form === "animal"});
			}
		}
		for (const form of ["hybrid", "animal"]) add("lycanthropeArmor", form, {facts: current.ac, choices: ["retain", "unarmored"]});
		return {...model, status: "needs-answers"};
	}
	if (resolved?.version !== 2 || !resolved.automation || ![
		["catalog:zombie|dmg", "zombie-numerics"], ["catalog:dracolich|mm", "dracolich"],
	].some(([id, profile]) => resolved.id === id && resolved.automation.profile === profile)) {
		issue("profile", "This identity has no supported staged guided producer.");
		return {...model, status: "unsupported"};
	}
	if (resolved.id === "catalog:dracolich|mm") {
		for (const field of ["age", "trueDragon", "shadowDragon", "physiology", "lairActions"]) add("confirmation", field);
		model.facts = {type: current.type, traits: structuredClone(current.trait || []), lair: structuredClone(current.legendaryGroup ?? null)};
		return {...model, status: "needs-answers"};
	}
	model.facts = {abilities: Object.fromEntries(ABILITIES.map(key => [key, current[key]])), hp: structuredClone(current.hp), ac: structuredClone(current.ac)};
	try { model.facts.hitPoints = observeCreatureTransformationHitPoints(current); } catch (error) {
		if (!known.has(error.code)) throw error;
		issue("hp", error.message);
	}
	try { model.facts.explicitPb = getCreatureTransformationProficiencyBonus(current, undefined, {checkNote: true}); } catch (error) {
		if (!known.has(error.code)) throw error;
		issue("proficiency", error.message);
	}
	try { model.entries = observeCreatureTransformationBindings({current, chassisSource: target.baseCreature.source}); } catch (error) {
		if (!known.has(error.code)) throw error;
		issue("entry", error.message);
		return {...model, status: "blocked"};
	}
	for (const entry of model.entries) {
		entry.id = add("entry", {section: entry.section, ...entry.match}, {facts: entry}).id;
		for (const token of entry.tokens) token.id = add("token", {section: entry.section, ...entry.match, paragraph: token.paragraph, kind: token.kind, token: token.token}, {facts: token}).id;
	}
	if (new Set(model.entries.map(entry => entry.id)).size !== model.entries.length) issue("entry", "Duplicate source-qualified entries cannot be bound.");
	add("armor", "retain", {facts: current.ac});
	for (const section of ["save", "skill"]) {
		for (const [name, total] of Object.entries(current[section] || {})) {
			add("proficiency", {section, name}, {facts: {total, ability: section === "save" ? name : Parser.skillToAbilityAbv(name)}});
		}
	}
	add("proficiencyBonus", "current");
	add("cr", "estimate");
	model.suggestions.push({kind: "expectedCr", value: current.cr, accepted: false});
	for (const entry of model.entries.filter(it => it.section === "spellcasting" && it.entry.ability)) {
		model.suggestions.push({kind: "castingAbility", entryId: entry.id, value: entry.entry.ability, accepted: false});
	}
	return {...model, status: model.requirements.length ? "blocked" : "needs-answers"};
}

function proposeResidual ({model, tokenId, ability, proficiency, proficiencyBonus, proficiencyContext = null, proficiencyAnswer = null}) {
	const entry = model.entries?.find(it => it.tokens.some(token => token.id === tokenId));
	const token = entry?.tokens.find(it => it.id === tokenId);
	requireAnswer(!model.requirements.length && entry?.supported && integer(token?.value, -10_000, 10_000),
		"Choose a supported token on this exact target/source/history.", "token", tokenId);
	requireAnswer(ABILITIES.includes(ability) && integer(model.current[ability], 1, 30) && [0, 1, 2].includes(proficiency),
		"Deliberately choose an ability and PB multiplier before requesting a residual.", "token", tokenId);
	const pb = proficiency === 0 ? null : getCreatureTransformationCrProficiency({
		current: model.current, proficiencyBonus, proficiencyContext, answer: proficiencyAnswer,
	});
	const abilityModifier = Parser.getAbilityModNumber(model.current[ability]);
	const fixed = token.value - abilityModifier - proficiency * (pb?.before ?? 0);
	requireAnswer(integer(fixed, -10_000, 10_000), "The proposed residual exceeds the supported binding bounds.", "token", tokenId);
	return freezeCreatureTransformationInputs({
		targetId: model.targetId,
		sourceUid: model.sourceUid,
		targetKey: model.targetKey,
		tokenId,
		ability,
		proficiency,
		observed: token.value,
		abilityModifier,
		pb,
		fixed,
		accepted: false,
	});
}

export function proposeCreatureTransformationResidual ({target, resolved, tokenId, ability, proficiency, proficiencyBonus, proficiencyContext, proficiencyAnswer}) {
	return proposeResidual({model: inspectCreatureTransformationInputs({target, resolved}), tokenId, ability, proficiency, proficiencyBonus, proficiencyContext, proficiencyAnswer});
}

function getBindings (model, answers, proficiencyContext) {
	const controls = answers.controls;
	const get = (kind, selector) => controls[model.controls.find(it => it.kind === kind && same(it.selector, selector))?.id];
	const armor = get("armor", "retain");
	requireAnswer(keysAre(armor, ["mode", "reason"]) && armor.mode === "retain" && text(armor.reason),
		"Review retention of the unchanged Dexterity/equipment AC policy; this producer does not change armor.", "armor");
	const bindings = {armor: {mode: "retain"}, entries: []};
	const pb = get("proficiencyBonus", "current");
	if (pb !== undefined) {
		requireAnswer(keysAre(pb, ["value", "reason"]) && integer(pb.value, 1, 30) && text(pb.reason), "Declare an explicit current source PB and reason.", "proficiencyBonus");
		bindings.proficiencyBonus = pb.value;
	}
	for (const entry of model.entries.filter(it => it.needsBinding)) {
		const retained = controls[entry.id];
		if (retained !== undefined) {
			requireAnswer(keysAre(retained, ["mode", "reason"]) && retained.mode === "retain" && text(retained.reason), "Entry retention needs an explicit reason.", "entry", entry.id);
			requireAnswer(!entry.tokens.some(it => controls[it.id] !== undefined), "Choose entry retention or token bindings, not both.", "entry", entry.id);
			bindings.entries.push({section: entry.section, match: entry.match, mode: "retain"});
			continue;
		}
		requireAnswer(entry.supported, entry.reason || "Unsupported entry content needs an explicit retention policy.", "entry", entry.id);
		const numbers = entry.tokens.map(token => {
			const answer = controls[token.id];
			requireAnswer(text(answer?.reason), "Choose an ability/PB/fixed residual or source-fixed token with a reason; arithmetic alone is not an answer.", "token", token.id);
			const {paragraph, kind, token: index, dice} = token;
			const address = {paragraph, kind, token: index, ...dice ? {dice} : {}};
			if (answer.mode === "fixed") {
				requireAnswer(keysAre(answer, ["mode", "value", "reason"]) && answer.value === token.value, "Source-fixed value must agree with the observed token.", "token", token.id);
				return {...address, mode: "fixed", value: answer.value};
			}
			let fixed = answer.fixed;
			if (Object.hasOwn(answer, "proposal")) {
				requireAnswer(keysAre(answer, ["mode", "ability", "proficiency", "proposal", "adopted", "reason"]) && answer.mode === "ability" && answer.adopted === true,
					"Deliberately adopt the residual proposal with a reason; a proposal is not an answer.", "token", token.id);
				const proposal = proposeResidual({model,
					tokenId: token.id,
					ability: answer.ability,
					proficiency: answer.proficiency,
					proficiencyBonus: bindings.proficiencyBonus,
					proficiencyContext,
					proficiencyAnswer: get("cr", "estimate")?.proficiencyAnswer ?? null});
				requireAnswer(same(answer.proposal, proposal), "The residual proposal is stale or belongs to a different target/token/PB choice; request and review it again.", "token", token.id);
				fixed = proposal.fixed;
			} else requireAnswer(keysAre(answer, ["mode", "ability", "proficiency", "fixed", "reason"]), "Declare the reviewed fixed residual or explicitly adopt its proposal.", "token", token.id);
			requireAnswer(answer.mode === "ability"
				&& ABILITIES.includes(answer.ability) && [0, 1, 2].includes(answer.proficiency) && integer(fixed, -10_000, 10_000),
			"Declare the ability, PB multiplier and reviewed fixed residual.", "token", token.id);
			return {...address, mode: "ability", ability: answer.ability, proficiency: answer.proficiency, fixed};
		});
		bindings.entries.push({section: entry.section, match: entry.match, mode: "bind", numbers});
	}
	return bindings;
}

function project ({target, resolved, automationInputs, proficiency}) {
	const concrete = normalizeCreatureTransformation(compileCreatureTransformation({
		resolved,
		current: BestiaryQuickActionsUtil.applyOperations({baseCreature: target.baseCreature, operations: target.operations}),
		chassisSource: target.baseCreature.source,
		inputs: proficiency
			? {...automationInputs, bindings: {...automationInputs.bindings, proficiencyBonus: proficiency.before}} : automationInputs,
		...getLycanthropeProfile(resolved.id) ? {baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: target.baseCreature, operations: target.operations})} : {},
	}));
	const options = {baseCreature: target.baseCreature,
		operations: target.operations,
		resolved: concrete,
		acknowledgedPrerequisites: concrete.prerequisites,
		dmApproved: true};
	const first = BestiaryQuickActionsUtil.previewCreatureTransformation(options);
	// Inspection only: these winners and provisional consent never leave this function.
	const conflictDecisions = Object.fromEntries(first.conflicts.map(it => [it.path, "incoming"]));
	return BestiaryQuickActionsUtil.previewCreatureTransformation({...options, conflictDecisions}).proposed;
}

function composeRoutines ({model, projection, bindings, answer, proficiency}) {
	requireAnswer(keysAre(answer, ["defense", "routines", "routine", "review", "override", "zeroXp", "proficiencyAnswer", "coverage"])
		&& keysAre(answer.review, ["confirmed", "reason"]) && answer.review.confirmed === true && text(answer.review.reason),
	"Explicitly confirm completeness with an explanation; unsupported effects cannot be silently omitted.", "cr", "review");
	requireAnswer(Array.isArray(answer.coverage) && answer.coverage.length === model.entries.length
		&& model.entries.every(entry => answer.coverage.filter(it => keysAre(it, ["entryId", "decision", "reason"]) && it.entryId === entry.id
			&& ["represented", "excluded"].includes(it.decision) && text(it.reason)).length === 1),
	"Review inclusion/exclusion of every observed entry, including baked dice, riders, spells and alternatives.", "cr", "coverage");
	requireAnswer(Array.isArray(answer.routines) && answer.routines.length >= 1 && answer.routines.length <= 12, "Choose 1 to 12 complete alternative routines.", "cr", "routines");
	const observed = observeCreatureTransformationBindings({current: projection, chassisSource: model.chassisSource});
	const tokens = new Map();
	for (const entry of model.entries) {
		const after = observed.find(it => it.section === entry.section && same(it.match, entry.match));
		for (const token of entry.tokens) {
			const projected = after?.tokens.find(it => it.paragraph === token.paragraph && it.kind === token.kind && it.token === token.token);
			const binding = bindings.entries.find(it => it.section === entry.section && same(it.match, entry.match));
			const number = binding?.numbers?.find(it => it.paragraph === token.paragraph && it.kind === token.kind && it.token === token.token);
			tokens.set(token.id, {entry,
				token: projected,
				supported: entry.supported && after?.supported,
				proficiency: number?.mode === "ability" ? number.proficiency : 0});
		}
	}
	const routines = answer.routines.map(routine => {
		requireAnswer(keysAre(routine, ["id", "rows", "accuracy", "mixedReason", "note"]) && text(routine.note)
			&& Array.isArray(routine.rows) && routine.rows.length >= 1 && routine.rows.length <= 24, "Each routine needs 1..24 reviewed contribution rows.", "cr", routine?.id);
		const rounds = Array.from({length: 3}, () => ({value: 0, proficiency: 0}));
		const notes = [];
		for (const row of routine.rows) {
			requireAnswer(keysAre(row, ["counts", "targets", "timing", "reason"], ["tokenId", "fixed"]) && text(row.reason)
				&& ["normal", "conditional", "off-turn", "ongoing", "recharge", "limited-use"].includes(row.timing)
				&& ["counts", "targets"].every(key => Array.isArray(row[key]) && row[key].length === 3
					&& [...row[key]].every(value => integer(value, key === "counts" ? 0 : 1, key === "counts" ? 20 : 100)))
				&& (Object.hasOwn(row, "tokenId") !== Object.hasOwn(row, "fixed")), "Review exactly three rounds of counts, targets, timing and source.", "cr", routine.id);
			let value;
			let coefficient = 0;
			if (Object.hasOwn(row, "tokenId")) {
				const selected = tokens.get(row.tokenId);
				requireAnswer(selected?.supported && selected.token?.kind === "damage", "Select an exact supported observed damage token; unsupported contributions remain unresolved.", "cr", row.tokenId);
				requireAnswer(answer.coverage.find(it => it.entryId === selected.entry.id)?.decision === "represented", "A selected contribution cannot be marked excluded.", "cr", row.tokenId);
				value = selected.token.average;
				requireAnswer(selected.proficiency === 0 || proficiency.source !== "derived-cr"
					|| selected.token.mean + selected.proficiency * (2 - proficiency.before) >= 0,
				"A per-token zero-floor crossing cannot be represented by linear M3 PB coefficients; supply a bounded fixed adjudication.", "cr", row.tokenId);
				coefficient = selected.proficiency;
				notes.push(`${selected.entry.match.name}|${selected.entry.match.source} ${selected.token.kind}:${selected.token.paragraph}:${selected.token.token}`);
			} else {
				requireAnswer(keysAre(row.fixed, ["value", "source", "reason"]) && Number.isFinite(row.fixed.value) && row.fixed.value >= 0
					&& row.fixed.value <= 100_000 && keysAre(row.fixed.source, ["name", "source"])
					&& text(row.fixed.source.name) && text(row.fixed.source.source) && text(row.fixed.reason),
				"Fixed contributions need a bounded per-use value, source-qualified adjudication and reason.", "cr", routine.id);
				value = row.fixed.value;
				notes.push(`${row.fixed.source.name}|${row.fixed.source.source} fixed ${value}: ${row.fixed.reason}`);
			}
			notes.push(`${row.counts.join("/")} uses x ${row.targets.join("/")} targets; ${row.timing}: ${row.reason}`);
			for (let i = 0; i < 3; ++i) {
				rounds[i].value += value * row.counts[i] * row.targets[i];
				rounds[i].proficiency += coefficient * row.counts[i] * row.targets[i];
			}
		}
		const accuracy = tokens.get(routine.accuracy);
		requireAnswer(accuracy?.supported && ["hit", "dc"].includes(accuracy.token?.kind) && text(routine.mixedReason),
			"Deliberately choose supported attack/save accuracy and explain predominant/mixed measures.", "cr", routine.id);
		requireAnswer(answer.coverage.find(it => it.entryId === accuracy.entry.id)?.decision === "represented",
			"The selected accuracy source must be represented in the review.", "cr", routine.accuracy);
		return {id: routine.id,
			rounds,
			accuracy: {kind: accuracy.token.kind === "hit" ? "attack" : "save", value: accuracy.token.value, proficiency: accuracy.proficiency},
			note: [routine.note, routine.mixedReason, ...notes].join("; ")};
	});
	return {defense: structuredClone(answer.defense),
		routines,
		routine: answer.routine,
		review: [answer.review.reason, ...answer.coverage.map(it => `${model.entries.find(entry => entry.id === it.entryId).match.name}: ${it.decision}: ${it.reason}`)].join("; "),
		override: structuredClone(answer.override),
		zeroXp: answer.zeroXp,
		proficiencyAnswer: structuredClone(answer.proficiencyAnswer)};
}

export function compileCreatureTransformationInputs ({target, resolved, answers, table, proficiencyContext = null}) {
	const model = inspectCreatureTransformationInputs({target, resolved});
	if (model.requirements.length) return model;
	let control = "answers";
	try {
		requireAnswer(keysAre(answers, ["targetKey", "controls"]) && answers.targetKey === model.targetKey && isRecord(answers.controls),
			"Answers are missing or stale for this exact target/source/history; retain the old draft without retargeting it.", "answers");
		requireAnswer(Object.keys(answers.controls).every(id => model.controls.some(it => it.id === id)), "An answer references an unknown target/source-qualified control.", "answers");
		if (resolved.id === "catalog:fallen angel|scre") {
			const fallenAngel = {};
			for (const item of model.controls) {
				const answer = answers.controls[item.id];
				requireAnswer(keysAre(answer, ["value", "reason"]) && text(answer.reason), "Resolve this actual source-qualified M11 binding and record its reason.", item.kind, item.selector);
				fallenAngel[item.selector] = answer.value;
			}
			const automationInputs = {fallenAngel};
			control = "projection";
			const projection = project({target, resolved, automationInputs});
			return {...model, status: "ready", projectionOnly: true, projection, automationInputs};
		}
		if (resolved.id === "catalog:fey beast|scre") {
			const feyBeast = {};
			for (const item of model.controls) {
				const answer = answers.controls[item.id];
				if (item.kind === "proficiencyBonus") {
					requireAnswer(keysAre(answer, ["value", "reason"]) && integer(answer.value, 1, 30) && text(answer.reason), "Declare the actual current PB with its source/reason, not an estimated CR.", item.kind, item.selector);
					feyBeast.proficiencyBonus = answer.value;
				} else {
					requireAnswer(keysAre(answer, ["value"]) && typeof answer.value === "boolean", "Confirm whether this actual language capability includes speaking Sylvan; existing speech is retained.", item.kind, item.selector);
					feyBeast.speaksSylvan = answer.value;
				}
			}
			const automationInputs = {feyBeast};
			control = "projection";
			const projection = project({target, resolved, automationInputs});
			return {...model, status: "ready", projectionOnly: true, projection, automationInputs};
		}
		if (getLycanthropeProfile(resolved.id)) {
			const get = (kind, selector) => {
				const item = model.controls.find(control => control.kind === kind && same(control.selector, selector));
				const answer = answers.controls[item?.id];
				requireAnswer(answer !== undefined, "Answer this exact source/target form control; no speech, equipment, armor or consent decision is inferred.", kind, selector);
				return answer;
			};
			const consent = selector => {
				const answer = get("lycanthropeConsent", selector);
				requireAnswer(keysAre(answer, ["value"]), "Consent needs one explicit value.", "lycanthropeConsent", selector);
				return answer.value;
			};
			const pb = get("proficiencyBonus", "current");
			requireAnswer(keysAre(pb, ["value", "reason"]) && integer(pb.value, 1, 30) && text(pb.reason), "Declare the actual current PB and its source/reason.", "proficiencyBonus");
			const bindings = {proficiencyBonus: pb.value,
				armor: get("lycanthropeArmorBinding", "current"),
				entries: model.entries.filter(entry => entry.needsBinding).map(entry => {
					const selector = {section: entry.section, ...entry.match};
					const answer = get("lycanthropeEntryBinding", selector);
					requireAnswer(keysAre(answer, ["mode"], ["numbers"]), "Entry answers cannot replace their source-qualified control identity.", "lycanthropeEntryBinding", selector);
					return {section: entry.section, match: entry.match, ...answer};
				})};
			const form = name => ({armor: get("lycanthropeArmor", name),
				entries: model.entries.map(entry => {
					const selector = {form: name, section: entry.section, ...entry.match};
					const answer = get("lycanthropeCapability", selector);
					requireAnswer(keysAre(answer, ["requiresSpeech", "equipment"]), "Capability answers cannot replace their source-qualified control identity.", "lycanthropeCapability", selector);
					return {section: entry.section, match: entry.match, ...answer};
				})});
			const automationInputs = {lycanthrope: {adaptation: consent("adaptation"),
				embrace: resolved.id === "catalog:wereshark|arcadia27" ? false : consent("embrace"),
				hybrid: form("hybrid"),
				animal: form("animal"),
				replaceFeatures: get("lycanthropeReplacements", "features")},
			bindings};
			control = "projection";
			const projection = project({target, resolved, automationInputs});
			return {...model, status: "ready", projectionOnly: true, projection, automationInputs};
		}
		let automationInputs;
		if (resolved.id === "catalog:dracolich|mm") {
			automationInputs = {};
			for (const item of model.controls) {
				requireAnswer(keysAre(answers.controls[item.id], ["value"]) && answers.controls[item.id].value !== undefined, "Confirm this Dracolich eligibility/physiology decision.", "confirmation", item.selector);
				automationInputs[item.selector] = answers.controls[item.id].value;
			}
		} else automationInputs = {bindings: getBindings(model, answers, proficiencyContext)};
		const cr = model.controls.find(it => it.kind === "cr");
		const answer = answers.controls[cr?.id];
		control = "proficiency";
		requireAnswer(answer === undefined || isRecord(answer), "CR composition needs typed answers, not a null or scalar.", "cr", "estimate");
		const proficiency = answer === undefined ? null : getCreatureTransformationCrProficiency({
			current: model.current, proficiencyBonus: automationInputs.bindings.proficiencyBonus, proficiencyContext, answer: answer.proficiencyAnswer,
		});
		control = "projection";
		const projection = project({target, resolved, automationInputs, proficiency});
		if (answer !== undefined) {
			control = "cr";
			const assumptions = composeRoutines({model, projection, bindings: automationInputs.bindings, answer, proficiency});
			automationInputs.proficiencies = {save: {}, skill: {}};
			for (const item of model.controls.filter(it => it.kind === "proficiency")) {
				const supplied = answers.controls[item.id];
				requireAnswer(keysAre(supplied, ["multiplier", "reason"]) && [0, 1, 2].includes(supplied.multiplier) && text(supplied.reason),
					"Review this save/skill PB or expertise multiplier; a total is not an answer.", "proficiency", item.selector);
				automationInputs.proficiencies[item.selector.section][item.selector.name] = supplied.multiplier;
			}
			requireAnswer(Array.isArray(table), "Request the version-matched CR table for this explicit CR path.", "cr", "table");
			automationInputs.cr = {table: structuredClone(table), assumptions};
			const compiled = compileCreatureTransformation({resolved, current: model.current, chassisSource: target.baseCreature.source, inputs: automationInputs, proficiencyContext});
			model.estimate = {label: "DMG 2014 estimate, not playtested", ...compiled.changes.find(it => it.op === "setChallengeRating")};
			model.proficiency = proficiency;
		}
		return {...model, status: "ready", projectionOnly: true, projection, automationInputs};
	} catch (error) {
		if (!known.has(error.code)) throw error;
		return {...model,
			status: error.code === "CREATURE_TRANSFORMATION_INELIGIBLE" ? "ineligible" : "needs-answers",
			requirements: [{targetId: target.id, control: error.control || control, selector: error.selector ?? control, reason: error.message}]};
	}
}

export async function pLoadCreatureTransformationInputTable ({requested, dataUtil = globalThis.DataUtil}) {
	if (!requested) return null;
	const table = (await dataUtil.loadJSON("data/msbcr.json")).cr;
	if (!Array.isArray(table)) return table;
	return table.map(row => {
		if (!row || typeof row !== "object" || Array.isArray(row)) return row;
		const copy = {...row};
		if (copy.__prop === "cr") delete copy.__prop;
		return copy;
	});
}
