/**
 * Bug 4 — College of the Moon Bard "Primal Lore" (FRHoF, subclassFeature, level 3).
 *
 * The feature grants THREE things, all previously inert:
 *   1. The Druidic language.
 *   2. One cantrip from the Druid spell list that counts as a Bard cantrip but does NOT
 *      count against cantrips known, and is replaceable each Bard level.
 *   3. Proficiency in one of six skills (Animal Handling, Insight, Medicine, Nature,
 *      Perception, Survival).
 *
 * The generic FeatureChoiceParser only recognises the "either A or B" / "one of the
 * following … of your choice:" phrasing, so Primal Lore's "choose one of the following
 * skills: … You have proficiency in that skill." skill pick and its open-list Druid
 * cantrip are seeded into the shared pending-feature-choice pipeline by
 * CharacterSheetClassUtils.seedSubclassFeatureChoices (called from LevelUp / QuickBuild).
 *
 * Asserts REAL mechanics via the state + class-utils layer (flow-agnostic).
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

// The real FRHoF Primal Lore feature text (entries with tags intact).
function primalLoreFeature () {
	return {
		name: "Primal Lore",
		source: "FRHoF",
		className: "Bard",
		classSource: "XPHB",
		subclassShortName: "Moon",
		subclassSource: "FRHoF",
		level: 3,
		isSubclassFeature: true,
		entries: [
			"You learn Druidic and one cantrip from the Druid spell list. It counts as a Bard spell for you but doesn't count against the number of cantrips you know. Whenever you gain a Bard level, you can replace this cantrip with another cantrip of your choice from the Druid spell list.",
			"Additionally, choose one of the following skills: {@skill Animal Handling|XPHB}, {@skill Insight|XPHB}, {@skill Medicine|XPHB}, {@skill Nature|XPHB}, {@skill Perception|XPHB}, or {@skill Survival|XPHB}. You have proficiency in that skill.",
		],
	};
}

const SIX_SKILL_KEYS = ["animalhandling", "insight", "medicine", "nature", "perception", "survival"];

// Minimal Druid cantrip database (spellIsForClass reads classes.fromClassList in tests).
function druidCantrips () {
	const mk = (name) => ({name, source: "XPHB", level: 0, school: "T", classes: {fromClassList: [{name: "Druid"}]}});
	return [
		mk("Druidcraft"),
		mk("Guidance"),
		mk("Shillelagh"),
		mk("Thorn Whip"),
		// A non-Druid cantrip that must NOT be offered.
		{name: "Fire Bolt", source: "XPHB", level: 0, school: "V", classes: {fromClassList: [{name: "Wizard"}]}},
		// A Druid *spell* (not cantrip) that must NOT be offered.
		{name: "Entangle", source: "XPHB", level: 1, school: "C", classes: {fromClassList: [{name: "Druid"}]}},
	];
}

// =============================================================================
// Detection helpers
// =============================================================================
describe("Primal Lore — prose detection", () => {
	it("detects the fixed six-skill proficiency choice (normalized keys)", () => {
		const choice = CharacterSheetClassUtils.findFixedSkillProficiencyChoiceInFeature(primalLoreFeature());
		expect(choice).toBeTruthy();
		expect(choice.count).toBe(1);
		expect(choice.options.sort()).toEqual([...SIX_SKILL_KEYS].sort());
	});

	it("detects the bonus Druid-list cantrip grant (non-counting, replaceable)", () => {
		const grant = CharacterSheetClassUtils.findBonusListCantripGrantInFeature(primalLoreFeature());
		expect(grant).toBeTruthy();
		expect(grant.className).toBe("Druid");
		expect(grant.replaceable).toBe(true);
	});

	it("does NOT mistake an ordinary always-granted cantrip for a bonus grant", () => {
		const feature = {name: "Bonus Cantrip", entries: ["You learn one Druid cantrip of your choice."]};
		expect(CharacterSheetClassUtils.findBonusListCantripGrantInFeature(feature)).toBeNull();
	});

	it("getClassCantripOptions returns only that class's cantrips (excludes higher-level + other classes)", () => {
		const opts = CharacterSheetClassUtils.getClassCantripOptions(druidCantrips(), "Druid");
		const names = opts.map(o => o.name);
		expect(names).toEqual(["Druidcraft", "Guidance", "Shillelagh", "Thorn Whip"]);
		expect(names).not.toContain("Fire Bolt");
		expect(names).not.toContain("Entangle");
	});
});

// =============================================================================
// Druidic language (registry effect)
// =============================================================================
describe("Primal Lore — Druidic language", () => {
	it("grants the Druidic language via applyClassFeatureEffects()", () => {
		const state = new CharacterSheetState();
		state.addFeature(primalLoreFeature());
		state.applyClassFeatureEffects();
		expect(state.getLanguages()).toContain("Druidic");
	});

	it("does NOT auto-grant any of the six skills just by adding the feature", () => {
		const state = new CharacterSheetState();
		state.addFeature(primalLoreFeature());
		for (const key of SIX_SKILL_KEYS) {
			expect(state.getSkillProficiency(key)).toBe(0);
		}
	});
});

// =============================================================================
// Seeding + fulfilling the pending choices (mirrors the LevelUp / QuickBuild flow)
// =============================================================================
describe("Primal Lore — seedSubclassFeatureChoices → pending-choice pipeline", () => {
	it("seeds a skill choice (six options) and a Druid cantrip choice", () => {
		const state = new CharacterSheetState();
		state.addFeature(primalLoreFeature());
		const seeded = CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLoreFeature()], {allSpells: druidCantrips()});
		expect(seeded).toBe(true);

		const skill = state.getPendingFeatureChoices().find(c => c.kind === "skill");
		const cantrip = state.getPendingFeatureChoices().find(c => c.kind === "cantrip");
		expect(skill).toBeTruthy();
		expect(skill.options.sort()).toEqual([...SIX_SKILL_KEYS].sort());
		expect(cantrip).toBeTruthy();
		expect(cantrip.options.map(o => o.name)).toEqual(["Druidcraft", "Guidance", "Shillelagh", "Thorn Whip"]);
	});

	it("fulfilling the skill choice grants proficiency ONLY in the picked skill", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLoreFeature()], {allSpells: druidCantrips()});
		const skillId = state.getPendingFeatureChoices().find(c => c.kind === "skill").id;

		expect(state.fulfillFeatureChoice(skillId, "nature")).toBe(true);
		expect(state.getSkillProficiency("nature")).toBe(1);
		// The other five stay non-proficient.
		expect(state.getSkillProficiency("survival")).toBe(0);
		expect(state.getSkillProficiency("insight")).toBe(0);
		// A skill outside the six was never offered.
		expect(state.getPendingFeatureChoices().some(c => c.kind === "skill")).toBe(false);
	});

	it("the six options exclude non-listed skills (e.g. Arcana, Stealth)", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLoreFeature()], {allSpells: druidCantrips()});
		const skill = state.getPendingFeatureChoices().find(c => c.kind === "skill");
		expect(skill.options).not.toContain("arcana");
		expect(skill.options).not.toContain("stealth");
	});

	it("fulfilling the cantrip choice adds a NON-COUNTING Bard cantrip sourced from Primal Lore", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLoreFeature()], {allSpells: druidCantrips()});
		const cantripId = state.getPendingFeatureChoices().find(c => c.kind === "cantrip").id;

		expect(state.fulfillFeatureChoice(cantripId, {name: "Shillelagh", source: "XPHB"}, druidCantrips())).toBe(true);

		const known = state.getCantripsKnown();
		const shillelagh = known.find(c => c.name === "Shillelagh");
		expect(shillelagh).toBeTruthy();
		expect(shillelagh.sourceFeature).toBe("Primal Lore");
		// Non-counting: "Primal Lore" is NOT a player-chosen spell feature.
		expect(CharacterSheetClassUtils.PLAYER_CHOSEN_SPELL_FEATURES.has("Primal Lore")).toBe(false);
	});

	it("does NOT re-seed the cantrip once one sourced from the feature exists", () => {
		const state = new CharacterSheetState();
		state.addCantrip({name: "Druidcraft", source: "XPHB", school: "T", sourceFeature: "Primal Lore", sourceClass: "Bard"});
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLoreFeature()], {allSpells: druidCantrips()});
		expect(state.getPendingFeatureChoices().some(c => c.kind === "cantrip")).toBe(false);
	});
});

// =============================================================================
// Replaceable-each-Bard-level cantrip
// =============================================================================
describe("Primal Lore — replaceable cantrip", () => {
	it("swaps the prior feature-sourced cantrip for a new one, preserving non-counting status", () => {
		const state = new CharacterSheetState();
		state.addCantrip({name: "Druidcraft", source: "XPHB", school: "T", sourceFeature: "Primal Lore", sourceClass: "Bard"});

		const newSpell = {name: "Thorn Whip", source: "XPHB", level: 0, school: "T"};
		expect(CharacterSheetClassUtils.replaceBonusFeatureCantrip(state, "Primal Lore", newSpell, {sourceClass: "Bard"})).toBe(true);

		const known = state.getCantripsKnown();
		expect(known.find(c => c.name === "Druidcraft")).toBeFalsy();
		const thornWhip = known.find(c => c.name === "Thorn Whip");
		expect(thornWhip).toBeTruthy();
		expect(thornWhip.sourceFeature).toBe("Primal Lore");
		// Exactly one Primal Lore cantrip remains.
		expect(known.filter(c => c.sourceFeature === "Primal Lore")).toHaveLength(1);
	});
});
