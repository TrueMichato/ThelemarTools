/**
 * S3 — Bug #9: a new Might-related TGTT Barbarian specialty ("Unyielding Might").
 *
 * Specialties are `classFeature` objects referenced by the L1 "Specialties" wrapper
 * via `{type:"options"}` → `refClassFeature`. Higher-level Specialties wrappers
 * (L3/6/8/10/13/15/18) re-reference `{@classFeature Specialties|Barbarian|TGTT|1}`,
 * so registering the new ref in the L1 wrapper makes it selectable at every level.
 *
 * "Might" is TGTT's Strength skill; it isn't in the text-parser's skill list, so the
 * concrete, testable effect is phrased as a Strength ({@skill Athletics}) check bonus
 * equal to the proficiency bonus (matching sibling specialties like Agile Sprinter /
 * Lead the Pack), scoped to feats of might (lift/drag/push/throw/grapple/shove). This
 * deliberately avoids the "counts as one size larger" carry clause so it does NOT
 * stack with a Minotaur's Powerful Build.
 */

import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const repo = path.resolve(process.cwd());
const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

const SPEC_NAME = "Unyielding Might";
const SPEC_REF = "Unyielding Might|Barbarian|TGTT|1";

function loadBrew () {
	return JSON.parse(fs.readFileSync(path.join(repo, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));
}

/** Convert 5etools inline tags (e.g. {@skill Athletics}) to plain text, as the
 * sheet's Renderer does before the modifier parser reads a feature description. */
function stripTags (text) {
	return String(text).replace(/\{@\w+ ([^|}]+)(?:\|[^}]*)?\}/g, "$1");
}

describe("Bug #9 — Unyielding Might barbarian specialty", () => {
	it("exists as a level-1 TGTT Barbarian classFeature with entries", () => {
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		expect(spec).toBeTruthy();
		expect(spec.className).toBe("Barbarian");
		expect(spec.classSource).toBe("TGTT");
		expect(spec.level).toBe(1);
		expect(Array.isArray(spec.entries)).toBe(true);
		expect(spec.entries.length).toBeGreaterThan(0);
	});

	it("is registered as a selectable option in the L1 Specialties wrapper", () => {
		const brew = loadBrew();
		const wrapper = brew.classFeature.find(f =>
			f.name === "Specialties" && f.source === "TGTT" && f.className === "Barbarian" && f.level === 1);
		expect(wrapper).toBeTruthy();

		const options = wrapper.entries.find(e => e && e.type === "options");
		expect(options).toBeTruthy();
		const refs = options.entries.map(o => o.classFeature);
		expect(refs).toContain(SPEC_REF);
	});

	it("is selectable at higher levels too (higher wrappers reuse the L1 options list)", () => {
		const brew = loadBrew();
		// Every higher-level Specialties wrapper references the L1 wrapper, so a
		// single L1 registration surfaces the specialty at all specialty levels.
		const higher = brew.classFeature.filter(f =>
			f.name === "Specialties" && f.source === "TGTT" && f.className === "Barbarian" && f.level > 1);
		expect(higher.length).toBeGreaterThan(0);
		higher.forEach(w => {
			expect(JSON.stringify(w.entries)).toContain("Specialties|Barbarian|TGTT|1");
		});
	});

	it("its effect is recognized by the feature-modifier parser (Athletics prof bonus)", () => {
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));
		const mods = FeatureModifierParser.parseModifiers(desc, SPEC_NAME);
		const athMod = mods.find(m => m.type === "skill:athletics");
		expect(athMod).toBeTruthy();
		expect(athMod.proficiencyBonus).toBe(true);
	});

	it("applies a proficiency-bonus boost to Athletics on a real barbarian", () => {
		// NOTE: like the sibling TGTT specialties (Agile Sprinter, Lead the Pack, ...),
		// the "made to lift/drag/push/..." scoping is narrative flavor — the sheet's
		// modifier parser applies the proficiency-bonus boost to Athletics as an
		// always-on modifier. We assert that always-on behavior deliberately.
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));

		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6}); // prof +3
		state.setAbilityBase("str", 14); // Athletics = +2 (mod) with no prof
		const before = state.getSkillBonus("athletics");

		state.addFeature({name: SPEC_NAME, source: "TGTT", sourceType: "classFeature", description: desc});
		state.applyClassFeatureEffects();

		expect(state.getSkillBonus("athletics")).toBe(before + 3);
	});

	it("does NOT grant a carry-capacity size increase (no ×4 stacking with Powerful Build)", () => {
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));

		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		state.setSetting("thelemar_carryWeight", true);
		state.setAbilityBase("str", 14); // base 120
		state.addFeature({name: SPEC_NAME, source: "TGTT", sourceType: "classFeature", description: desc});
		state.applyClassFeatureEffects();

		expect(state.getCarryingCapacity()).toBe(120);
		expect(state.getCarryingCapacityBreakdown().carryMultiplier).toBe(1);
	});
});
