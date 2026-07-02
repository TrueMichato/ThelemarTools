/**
 * S3 — Bug #9: a new Might-related TGTT Barbarian specialty ("Unyielding Might").
 *
 * Specialties are `classFeature` objects referenced by the L1 "Specialties" wrapper
 * via `{type:"options"}` → `refClassFeature`. Higher-level Specialties wrappers
 * (L3/6/8/10/13/15/18) re-reference `{@classFeature Specialties|Barbarian|TGTT|1}`,
 * so registering the new ref in the L1 wrapper makes it selectable at every level.
 *
 * "Might" is TGTT's custom Strength skill (homebrew skill entry + skillMap `might:"str"`).
 * The specialty grants a bonus equal to the proficiency bonus to Strength ({@skill Might})
 * checks (feats of might: lift/drag/push/throw/grapple/shove), which must flow onto the
 * MIGHT skill line — via `skill:might` → customModifiers.skills.might → getSkillCustomMod —
 * and NOT onto Athletics. The feature-modifier parser recognises TGTT's custom "Might" skill
 * in its structured "bonus to <skill> checks … proficiency bonus" block. The bonus is
 * phrased to match sibling specialties (Agile Sprinter / Lead the Pack) and deliberately
 * avoids the "counts as one size larger" carry clause so it does NOT stack with a Minotaur's
 * Powerful Build.
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

	it("its effect is recognized by the feature-modifier parser (Might prof bonus, not Athletics)", () => {
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));
		const mods = FeatureModifierParser.parseModifiers(desc, SPEC_NAME);

		const mightMod = mods.find(m => m.type === "skill:might");
		expect(mightMod).toBeTruthy();
		expect(mightMod.proficiencyBonus).toBe(true);
		// Always-on: the "made to lift/drag/..." clause is narrative flavor, not a gate.
		expect(mightMod.conditional).toBeFalsy();

		// The bonus must target the Might skill, NOT Athletics.
		expect(mods.some(m => m.type === "skill:athletics")).toBe(false);
	});

	it("also parses the raw {@skill Might|TGTT} tag form (renderer-independent)", () => {
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		// Feed the un-stripped entry text (tags intact) — the parser must still emit skill:might.
		const rawDesc = spec.entries.join(" ");
		const mods = FeatureModifierParser.parseModifiers(rawDesc, SPEC_NAME);
		expect(mods.some(m => m.type === "skill:might" && m.proficiencyBonus === true)).toBe(true);
		expect(mods.some(m => m.type === "skill:athletics")).toBe(false);
	});

	it("applies a proficiency-bonus boost to the Might skill on a real barbarian (not Athletics)", () => {
		// NOTE: like the sibling TGTT specialties (Agile Sprinter, Lead the Pack, ...),
		// the "made to lift/drag/push/..." scoping is narrative flavor — the sheet's
		// modifier parser applies the proficiency-bonus boost to Might as an always-on
		// modifier. We assert that always-on behavior deliberately, and that Athletics
		// (a separate Strength skill) is left untouched.
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));

		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		state.setAbilityBase("str", 14); // STR mod +2 → Might/Athletics = +2 with no prof
		const pb = state.getProficiencyBonus();
		const mightBefore = state.getSkillBonus("might");
		const athBefore = state.getSkillBonus("athletics");

		state.addFeature({name: SPEC_NAME, source: "TGTT", sourceType: "classFeature", description: desc});
		state.applyClassFeatureEffects();

		// Might gains the proficiency bonus; the boost flows through getSkillCustomMod.
		expect(state.getSkillMod("might")).toBe(mightBefore + pb);
		expect(state._data.customModifiers.skills.might).toBe(pb);
		// Athletics is a different skill and must be unchanged (no leak).
		expect(state.getSkillBonus("athletics")).toBe(athBefore);
		expect(state._data.customModifiers.skills.athletics || 0).toBe(0);
	});

	it("does NOT grant a carry-capacity SIZE multiplier (no ×4 stacking with Powerful Build)", () => {
		// The anti-stacking guarantee is specifically about the "counts as one size larger"
		// carry MULTIPLIER (which would ×4-stack with a Minotaur's Powerful Build). Unyielding
		// Might carries no such size clause, so carryMultiplier / sizeMultiplier stay 1.
		//
		// It DOES legitimately raise the flat capacity, because in the Thelemar carry rule the
		// carrying capacity is derived from the passive Might score (getPassiveScore("might") ×10).
		// Boosting the Might skill by the proficiency bonus therefore adds +3 passive Might → +30
		// lbs (120 → 150). That is the intended Might-driven increase, NOT a size multiplier.
		const brew = loadBrew();
		const spec = brew.classFeature.find(f => f.name === SPEC_NAME && f.source === "TGTT");
		const desc = stripTags(spec.entries.join(" "));

		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6}); // prof +3
		state.setSetting("thelemar_carryWeight", true);
		state.setAbilityBase("str", 14); // passive Might 12 → base 120 before the specialty
		state.addFeature({name: SPEC_NAME, source: "TGTT", sourceType: "classFeature", description: desc});
		state.applyClassFeatureEffects();

		const breakdown = state.getCarryingCapacityBreakdown();
		// No size multiplier: the important non-stacking invariant.
		expect(breakdown.carryMultiplier).toBe(1);
		expect(breakdown.sizeMultiplier).toBe(1);
		// The rise comes PURELY through the passive Might linkage (source × 10), not a flat
		// carry bonus or a size multiplier — mechanically enforce the "via Might" claim.
		expect(breakdown.flatBonus).toBe(0);
		expect(breakdown.perPoint).toBe(10);
		expect(breakdown.sourceValue).toBe(state.getPassiveScore("might"));
		expect(state.getCarryingCapacity()).toBe(state.getPassiveScore("might") * 10);
		// Concretely: passive Might 15 × 10 = 150, nowhere near a ×4 size-stacked value (480+).
		expect(state.getCarryingCapacity()).toBe(150);
	});
});
