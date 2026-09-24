/**
 * Round 61 — TGTT Barbarian Specialty parser/registration corpus.
 *
 * The three wording edits in this round align prose with mechanics that were already
 * permanent. This suite pins every option in the L1 Specialties pool so a future wording
 * change cannot silently remove an existing modifier or make an unrelated Specialty match.
 */

import fs from "node:fs";
import path from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const repo = path.resolve(process.cwd());
const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

const EXPECTED_REFS = [
	"Marathoner|Barbarian|TGTT|1",
	"Flock Step|Barbarian|TGTT|1",
	"Mark of the Wilderness|Barbarian|TGTT|1",
	"Natural Tracker|Barbarian|TGTT|1",
	"Path of Blustery Autumns|Barbarian|TGTT|1",
	"Path of Lean Winters|Barbarian|TGTT|1",
	"Path of Scorching Summers|Barbarian|TGTT|1",
	"Sharpened Senses|Barbarian|TGTT|1",
	"Unyielding Might|Barbarian|TGTT|1",
	"Lead the Pack|Barbarian|TGTT|6",
	"Path of Drowning Springs|Barbarian|TGTT|6",
];

const signature = (type, overrides = {}) => ({
	type,
	value: 0,
	proficiencyBonus: false,
	conditional: null,
	advantage: false,
	ignore: false,
	newAbility: null,
	oldAbility: null,
	equalToWalk: false,
	setValue: null,
	...overrides,
});

const EXPECTED_SIGNATURES = {
	"Marathoner": [
		signature("skill:endurance", {proficiencyBonus: true}),
	],
	"Flock Step": [
		signature("skill:stealth", {proficiencyBonus: true}),
	],
	"Mark of the Wilderness": [
		signature("abilitySwap:intimidation", {newAbility: "str", oldAbility: "cha"}),
		signature("skill:intimidation", {proficiencyBonus: true}),
	],
	"Natural Tracker": [],
	"Path of Blustery Autumns": [
		signature("movement:difficultTerrain", {ignore: true}),
		signature("travel:paceBonus", {value: 10}),
	],
	"Path of Lean Winters": [
		signature("save:all", {conditional: "against cold weather", advantage: true}),
	],
	"Path of Scorching Summers": [
		signature("save:all", {conditional: "against hot weather", advantage: true}),
	],
	"Sharpened Senses": [
		signature("skill:investigation", {proficiencyBonus: true}),
		signature("skill:perception", {proficiencyBonus: true}),
		signature("skill:survival", {proficiencyBonus: true}),
	],
	"Unyielding Might": [
		signature("skill:might", {proficiencyBonus: true}),
	],
	"Lead the Pack": [
		signature("skill:acrobatics", {proficiencyBonus: true}),
		signature("skill:athletics", {proficiencyBonus: true}),
	],
	"Path of Drowning Springs": [
		signature("speed:swim", {equalToWalk: true}),
	],
};

function loadBrew () {
	return JSON.parse(fs.readFileSync(path.join(repo, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
}

function flattenEntries (value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(flattenEntries).join(" ");
	if (!value || typeof value !== "object") return "";
	return flattenEntries(value.entries || value.entry || value.items || "");
}

function stripTags (text) {
	return String(text).replace(/\{@\w+ ([^|}]+)(?:\|[^}]*)?\}/g, "$1");
}

function getSpecialty (brew, name) {
	const feature = brew.classFeature.find(it =>
		it.name === name
		&& it.source === "TGTT"
		&& it.className === "Barbarian",
	);
	if (!feature) throw new Error(`Missing TGTT Barbarian Specialty: ${name}`);
	return feature;
}

function normalizeModifiers (modifiers) {
	return modifiers
		.map(mod => signature(mod.type, {
			value: mod.value ?? 0,
			proficiencyBonus: !!mod.proficiencyBonus,
			conditional: mod.conditional || null,
			advantage: !!mod.advantage,
			ignore: !!mod.ignore,
			newAbility: mod.newAbility || null,
			oldAbility: mod.oldAbility || null,
			equalToWalk: !!mod.equalToWalk,
			setValue: mod.setValue ?? null,
		}))
		.sort((a, b) => a.type.localeCompare(b.type));
}

function getWrapperRefs (brew) {
	const wrapper = brew.classFeature.find(it =>
		it.name === "Specialties"
		&& it.source === "TGTT"
		&& it.className === "Barbarian"
		&& it.level === 1,
	);
	const options = wrapper?.entries?.find(it => it?.type === "options");
	return options?.entries?.map(it => it.classFeature) || [];
}

describe("TGTT Barbarian Specialty parser corpus", () => {
	test("the L1 wrapper retains the exact 11-option pool", () => {
		expect(getWrapperRefs(loadBrew())).toEqual(EXPECTED_REFS);
	});

	test.each([
		["raw tagged entries", text => text],
		["renderer-like plain text", stripTags],
	])("%s preserves every pre-edit modifier signature", (_label, transform) => {
		const brew = loadBrew();
		const actual = {};
		for (const ref of getWrapperRefs(brew)) {
			const name = ref.split("|")[0];
			const feature = getSpecialty(brew, name);
			const text = transform(flattenEntries(feature.entries));
			actual[name] = normalizeModifiers(FeatureModifierParser.parseModifiers(text, name));
		}
		expect(actual).toEqual(EXPECTED_SIGNATURES);
	});
});

describe("TGTT Barbarian Specialty registered mechanics", () => {
	test.each([
		["Marathoner", ["endurance"], ["athletics", "acrobatics", "might"]],
		["Lead the Pack", ["athletics", "acrobatics"], ["might"]],
		["Unyielding Might", ["might"], ["athletics", "acrobatics"]],
	])("%s grants permanent PB only to its intended skills", (name, targets, untouched) => {
		const brew = loadBrew();
		const feature = getSpecialty(brew, name);
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);

		const before = Object.fromEntries([...targets, ...untouched].map(skill => [skill, state.getSkillMod(skill)]));
		state.addFeature({
			...feature,
			featureType: "Class",
			isFeatureOption: true,
			description: stripTags(flattenEntries(feature.entries)),
		});
		state.applyClassFeatureEffects();

		const stored = state._data.features.find(it => it.name === name && it.source === "TGTT");
		const registered = state._data.namedModifiers.filter(it => it.sourceFeatureId === stored.id);
		expect(registered).toHaveLength(targets.length);
		expect(registered.every(it => it.enabled && !it.conditional && it.proficiencyBonus)).toBe(true);

		for (const skill of targets) {
			expect(state.getSkillMod(skill)).toBe(before[skill] + state.getProficiencyBonus());
			const aggregate = state.aggregateModifiers(`skill:${skill}`);
			expect(aggregate.bonus).toBe(state.getProficiencyBonus());
			expect(aggregate.conditionalsAvailable).toEqual([]);
			expect(aggregate.sources).toContain(name);
		}

		for (const skill of untouched) {
			expect(state.getSkillMod(skill)).toBe(before[skill]);
			const aggregate = state.aggregateModifiers(`skill:${skill}`);
			expect(aggregate.bonus).toBe(0);
			expect(aggregate.sources).not.toContain(name);
			expect(aggregate.conditionalsAvailable.some(it => it.sourceName === name || it.name === name)).toBe(false);
		}
	});

	test("Natural Tracker remains a no-modifier control", () => {
		const brew = loadBrew();
		const feature = getSpecialty(brew, "Natural Tracker");
		const state = new CharacterSheetState();
		state.addFeature({
			...feature,
			featureType: "Class",
			isFeatureOption: true,
			description: stripTags(flattenEntries(feature.entries)),
		});
		const stored = state._data.features.find(it => it.name === feature.name && it.source === feature.source);
		expect(state._data.namedModifiers.filter(it => it.sourceFeatureId === stored.id)).toEqual([]);
	});

	test("Lead the Pack retains its independent group-check rider", () => {
		const text = flattenEntries(getSpecialty(loadBrew(), "Lead the Pack").entries);
		expect(text).toMatch(/group Athletics or Acrobatics check/i);
		expect(text).toMatch(/one ally to use your roll's result instead of their own/i);
	});
});
