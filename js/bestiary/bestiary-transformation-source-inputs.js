import {compileCreatureTransformation} from "../creature-transformations.js";
import {observeCreatureTransformationRoutineEntries} from "../creature-transformation-routines.js";
import {CREATURE_TRANSFORMATION_DEFENSE_FIELDS, composeCreatureTransformationEstimate, getCreatureTransformationSourceEntryDeclarations, getCreatureTransformationSourceProficiencies} from "../creature-transformation-estimate.js";
import {createFrozenCreatureTransformation} from "../creature-transformation-forms.js";
import {getLycanthropeProfile} from "../creature-transformation-lycanthrope.js";
import {observeFeyBeast} from "../creature-transformation-fey-beast.js";
import {observeFallenAngel} from "../creature-transformation-fallen-angel.js";
import {observeUndead} from "../creature-transformation-undead.js";
import {BestiaryQuickActionsUtil} from "./bestiary-quick-actions-engine.js";
import {BestiaryCreatureTransformation} from "./bestiary-creature-transformation.js";
import {normalizeCreatureTransformation} from "./bestiary-transformation-catalog-adapter.js";

export const SOURCE_ESTIMATE_MODE = "source-estimate-m13";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 1000;
const known = new Set(["CREATURE_TRANSFORMATION_INPUT_REQUIRED", "CREATURE_TRANSFORMATION_INELIGIBLE", "CREATURE_TRANSFORMATION_ENTRY_MATCH"]);
const copy = value => structuredClone(value);

function requireAnswer (condition, message, control = "source") {
	if (condition) return;
	const error = new Error(message);
	Object.assign(error, {code: "CREATURE_TRANSFORMATION_INPUT_REQUIRED", control});
	throw error;
}

function entries (current, source, scope) {
	return observeCreatureTransformationRoutineEntries({current, chassisSource: source, scope});
}

export function inspectCreatureTransformationSourceInputs ({target, resolved}) {
	const {creature: current} = BestiaryQuickActionsUtil._getReplayState({baseCreature: target.baseCreature, operations: target.operations});
	const targetKey = JSON.stringify({target, resolved});
	const model = {mode: SOURCE_ESTIMATE_MODE, targetId: target.id, targetKey, chassisSource: target.baseCreature.source, current, controls: [], requirements: []};
	const add = (path, facts, choices, required = true) => model.controls.push({
		id: JSON.stringify([target.id, `${target.baseCreature.name}|${target.baseCreature.source}`.toLowerCase(), resolved.id, path]),
		path,
		facts: copy(facts ?? null),
		...(choices ? {choices: copy(choices)} : {}),
		required,
	});
	try {
		requireAnswer(resolved.version === 2 && resolved.kind === "catalog" && resolved.automation, "Select a staged finite Template; Species is not part of this source/estimate path.", "profile");
		model.entries = entries(current, model.chassisSource, `${target.id}:before`);
		const bindingFacts = {armor: current.ac,
			entries: model.entries,
			proficiencyBonus: {current: current.profBonus ?? current.pbNote ?? null, currentCr: current.cr ?? null, bounds: [1, 30]},
			modes: ["bind", "retain"],
			retain: "Source-fixed numeric retention only: it never skips a source grant, replacement, removal or form restriction."};
		const binding = () => add(["bindings"], bindingFacts);
		const lair = namespace => add([namespace, "lair"], {current: current.legendaryGroup ?? null, modes: ["retain", "replace"], preserve: ["regionalEffects", "mythicEncounter"]});
		const optionalHp = () => add(["hp"], current.hp, ["constitution", "override"], false);
		const profile = resolved.automation.profile;
		if (resolved.id === "catalog:half-dragon|mm") {
			// Its existing ancestry/size choices fully determine the sourced donor breath.
		} else if (["dracolich", "skeleton", "zombie-numerics", "skeletal-wyrmling"].includes(profile)) {
			if (profile === "dracolich") {
				add(["reanimation", "age"], current, ["adult", "ancient"]);
				add(["reanimation", "trueDragon"], current.type, [true, false]);
				add(["reanimation", "shadowDragon"], current.trait, [true, false]);
				add(["reanimation", "physiology"], model.entries.filter(item => item.section === "trait"), ["retain", "remove"]);
				lair("reanimation");
			} else {
				if (profile === "skeletal-wyrmling") {
					add(["reanimation", "wyrmling"], current, [true]);
					add(["reanimation", "donor"], {name: current.name, source: current.source});
					add(["reanimation", "breaths"], model.entries, ["remove", "retain"]);
				}
				binding();
				if (profile !== "skeleton") optionalHp();
			}
		} else if (profile === "spore-servant") {
			add(["spore", "equipmentDamage"], model.entries, ["equipment", "not-equipment"], false);
			add(["spore", "bindings"], bindingFacts, null, false);
			add(["spore", "proficiencyBonus"], current.cr, null, false);
			if (current.legendaryGroup) lair("spore");
		} else if (["shadow-dragon-mm", "shadow-dragon-beg"].includes(profile)) {
			add(["shadow", "trueDragon"], current.type, [true, false]);
			add(["shadow", "shadowfell"], null, ["born", "years"]);
			add(["shadow", "stealth"], {total: current.skill?.stealth ?? null, dex: current.dex, multipliers: [0, 1, 2], residualBounds: [-1000, 1000]});
			lair("shadow");
			add(["shadow", "attacks"], model.entries, ["bite", "breath", "other"], false);
			add(["shadow", "proficiencyBonus"], {current: current.profBonus ?? current.pbNote ?? null, currentCr: current.cr ?? null, bounds: [1, 30]}, null, current.profBonus === undefined && current.pbNote === undefined);
		} else if (profile === "vampire") {
			binding(); optionalHp();
			add(["vampire", "adaptation"], null, ["sidebar-npc"]);
			add(["vampire", "grappleDc"], {minimum: 0, maximum: 100, sourceDoesNotDefineFormula: true});
			add(["vampire", "replaceFeatures"], model.entries, null, false);
			if (resolved.selectedOptions.outcome[0] === "vampire") {
				add(["vampire", "legendaryResistance"], model.entries.filter(item => /^legendary resistance\b/i.test(item.match.name)), ["grant", "retain", "replace"]);
				add(["vampire", "batEntries"], model.entries, ["not-required", "usable", "unusable"]);
			}
		} else if (getLycanthropeProfile(resolved.id)) {
			binding();
			const shark = profile === "wereshark";
			add(["lycanthrope", "adaptation"], null, [shark ? "arcadia27-template" : "sidebar-npc"]);
			add(["lycanthrope", "embrace"], null, shark ? [false] : [true, false]);
			for (const form of ["hybrid", "animal"]) {
				add(["lycanthrope", form], {entries: model.entries,
					armor: current.ac,
					equipment: ["not-required", "usable", "unusable"],
					requiresSpeech: [true, false],
					armorModes: ["retain", "unarmored"]});
			}
			add(["lycanthrope", "replaceFeatures"], model.entries, null, false);
		} else if (profile === "fey-beast") {
			const facts = observeFeyBeast({current, features: resolved.selectedOptions.features});
			if (facts.speaksSylvan === null) add(["feyBeast", "speaksSylvan"], current.languages, [true, false]);
			if (resolved.selectedOptions.features.some(id => ["entangle", "spike-growth"].includes(id)) && facts.proficiencyBonus === undefined) add(["feyBeast", "proficiencyBonus"], facts);
		} else if (profile === "fallen-angel") {
			for (const control of observeFallenAngel({current, chassisSource: model.chassisSource, allegiance: resolved.selectedOptions.allegiance[0]})) {
				add(["fallenAngel", control.key], control.facts);
			}
		} else if (profile === "undead-scre") {
			const {facts} = observeUndead({current, selected: resolved.selectedOptions, chassisSource: model.chassisSource});
			for (const key of facts.decisionKeys) add(["undead", key], key === "bindings" ? bindingFacts : facts, facts[key], false);
		} else requireAnswer(false, "This source-qualified family has no complete guided producer.", "profile");
		return {...model, status: model.controls.some(item => item.required) ? "needs-answers" : "ready"};
	} catch (error) {
		if (!known.has(error.code)) throw error;
		return {...model,
			status: error.code === "CREATURE_TRANSFORMATION_INELIGIBLE" ? "ineligible" : "needs-answers",
			requirements: [{control: error.control ?? "source", reason: error.message}]};
	}
}

function sourceInputs (model, answers) {
	requireAnswer(keys(answers, ["mode", "targetKey", "source"], ["forms"]) && answers.mode === SOURCE_ESTIMATE_MODE
		&& answers.targetKey === model.targetKey && record(answers.source), "Source answers are stale or belong to another target/history/recipe.", "answers");
	requireAnswer(Object.keys(answers.source).every(id => model.controls.some(item => item.id === id)), "An answer references an unknown source control.", "answers");
	const inputs = {};
	if (["catalog:zombie|dmg", "catalog:skeleton|dmg"].includes(model.resolvedId)) inputs.reanimation = {};
	if (model.resolvedId === "catalog:spore servant|mm") inputs.spore = {};
	for (const control of model.controls) {
		const answer = answers.source[control.id];
		if (answer === undefined && !control.required) continue;
		requireAnswer(keys(answer, ["value", "reason"]) && text(answer.reason), `Resolve ${control.path.join(".")} on this actual target with an explicit reason.`, control.id);
		if (control.choices && (typeof answer.value !== "object" || answer.value === null)) requireAnswer(control.choices.includes(answer.value), "Choose a declared finite source value.", control.id);
		const [namespace, field] = control.path;
		if (field) (inputs[namespace] ||= {})[field] = copy(answer.value);
		else inputs[namespace] = copy(answer.value);
	}
	return inputs;
}

export function previewCreatureTransformationSourceInputs ({target, resolved, answers, legendaryGroups}) {
	const model = {...inspectCreatureTransformationSourceInputs({target, resolved}), resolvedId: resolved.id};
	if (model.requirements.length) return model;
	try {
		const inputs = sourceInputs(model, answers);
		const baseline = BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: target.baseCreature, operations: target.operations});
		const source = compileCreatureTransformation({resolved, current: model.current, inputs, chassisSource: model.chassisSource, baseline, legendaryGroups});
		const profiles = source.frozenForms?.profiles || [{id: "default", label: resolved.identity.name, resolved: source}];
		const forms = profiles.map(profile => {
			const normalized = normalizeCreatureTransformation(profile.resolved);
			const current = BestiaryCreatureTransformation.projectSourceProfile({original: target.baseCreature, current: model.current, resolved: normalized});
			const targetKey = JSON.stringify({targetKey: model.targetKey, source: inputs, profile});
			const scope = `${resolved.id}:${profile.id}`;
			const declarations = getCreatureTransformationSourceEntryDeclarations({source: profile.resolved, current, beforeSource: model.current, chassisSource: model.chassisSource});
			return {id: profile.id,
				label: profile.label,
				targetKey,
				scope,
				chassisSource: model.chassisSource,
				current,
				sourceProficiencies: getCreatureTransformationSourceProficiencies(profile.resolved),
				entries: entries(current, model.chassisSource, scope).map(entry => {
					const required = declarations.find(item => item.section === entry.section && JSON.stringify(item.match) === JSON.stringify(entry.match));
					return {...entry, ...required ? {sourceNumbers: required.numbers} : {}};
				}),
				defenses: CREATURE_TRANSFORMATION_DEFENSE_FIELDS.map(field => ({field, value: copy(current[field] ?? null)}))};
		});
		return {...model, status: "source-ready", source, sourceInputs: inputs, forms, baseline};
	} catch (error) {
		if (!known.has(error.code)) throw error;
		return {...model,
			status: error.code === "CREATURE_TRANSFORMATION_INELIGIBLE" ? "ineligible" : "needs-answers",
			requirements: [{control: error.control ?? "source", reason: error.message}]};
	}
}

export function compileCreatureTransformationSourceEstimate ({target, resolved, sourceInputs: inputs, forms, proficiencyContext = null, legendaryGroups}) {
	const {creature: current} = BestiaryQuickActionsUtil._getReplayState({baseCreature: target.baseCreature, operations: target.operations});
	const baseline = BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: target.baseCreature, operations: target.operations});
	const source = compileCreatureTransformation({resolved, current, inputs, chassisSource: target.baseCreature.source, baseline, legendaryGroups});
	const profiles = source.frozenForms?.profiles || [{id: "default", label: resolved.identity.name, resolved: source}];
	requireAnswer(record(forms) && Object.keys(forms).length === profiles.length && profiles.every(profile => Object.hasOwn(forms, profile.id)), "Estimate every permitted source form exactly once; no extra or omitted forms.", "forms");
	const compiled = profiles.map(profile => {
		const projection = BestiaryCreatureTransformation.projectSourceProfile({original: target.baseCreature, current, resolved: normalizeCreatureTransformation(profile.resolved)});
		return {...profile,
			resolved: composeCreatureTransformationEstimate({source: profile.resolved,
				current: projection,
				beforeSource: current,
				inputs: forms[profile.id],
				baseline,
				chassisSource: target.baseCreature.source,
				proficiencyContext})};
	});
	return source.frozenForms ? createFrozenCreatureTransformation({profiles: compiled, activeForm: source.frozenForms.activeForm, baseline}) : compiled[0].resolved;
}

export function compileCreatureTransformationSourceInputs ({target, resolved, answers, table, proficiencyContext = null, legendaryGroups}) {
	const model = previewCreatureTransformationSourceInputs({target, resolved, answers, legendaryGroups});
	if (model.status !== "source-ready") return model;
	try {
		requireAnswer(record(answers.forms) && Object.keys(answers.forms).length === model.forms.length, "Declare complete post-source CR judgments for every permitted form.", "forms");
		const forms = {};
		for (const form of model.forms) {
			const answer = answers.forms[form.id];
			requireAnswer(keys(answer, ["targetKey", "bindings", "proficiencies", "cr", "defenses", "armorReason"]) && answer.targetKey === form.targetKey
				&& text(answer.armorReason) && record(answer.bindings) && record(answer.cr) && Array.isArray(answer.cr.coverage),
			"Review this exact post-source form, its armor and every numeric retention/binding; a source-input answer is not a CR answer.", form.id);
			forms[form.id] = {bindings: copy(answer.bindings),
				proficiencies: copy(answer.proficiencies),
				table: copy(table),
				composition: copy(answer.cr),
				scope: form.scope,
				armorReason: answer.armorReason,
				coverage: {entries: answer.cr.coverage.map(item => {
					requireAnswer(record(item), "Review each exact post-source entry with a decision and reason.", form.id);
					const entry = form.entries.find(entry => entry.id === item.entryId);
					requireAnswer(entry, "Review each exact post-source entry; stale or unknown entry IDs are unresolved.", form.id);
					return {section: entry.section, match: copy(entry.match), decision: item.decision, reason: item.reason};
				}),
				defenses: copy(answer.defenses)}};
		}
		const automationInputs = {sourceEstimate: {sourceInputs: model.sourceInputs, forms}};
		const compiled = compileCreatureTransformationSourceEstimate({target, resolved, ...automationInputs.sourceEstimate, proficiencyContext, legendaryGroups});
		return {...model,
			status: "ready",
			automationInputs,
			compiled,
			estimates: (compiled.frozenForms?.profiles || [{id: "default", resolved: compiled}]).map(profile => ({form: profile.id,
				label: "DMG 2014 estimate, not playtested",
				...profile.resolved.changes.at(-1)}))};
	} catch (error) {
		if (!known.has(error.code)) throw error;
		return {...model, status: "needs-answers", requirements: [{control: error.control ?? "estimate", reason: error.message}]};
	}
}
