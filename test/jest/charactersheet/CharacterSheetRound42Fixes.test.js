/**
 * Character Sheet — Round 42 regression guards (real-character bugs)
 *
 * All three bugs were reproduced from a single real exported character (a
 * Barbarian|TGTT / Bard|TGTT multiclass whose Barbarian carried the official
 * XPHB "Path of the World Tree" subclass features and whose Bard was a
 * College of the Moon with a frequency-object always-prepared spell):
 *
 *   Bug 1 — "Vitality of the Tree does nothing": the barbarian save had
 *           `subclass: null` with embedded World Tree features whose
 *           `classSource` ("XPHB") differed from the class `source` ("TGTT").
 *           `getSubclassFromFeatures` excluded any feature whose classSource
 *           didn't match the class source, so the subclass was never repaired
 *           and `hasVitalityOfTheTree` stayed false → no Temp HP, no banner.
 *
 *   Bug 3 — Moon Bard L6 crash "spells is not iterable": a subclass
 *           `additionalSpells` level-value can be a frequency object
 *           (`{"6": {"daily": {"1e": ["moonbeam|xphb"]}}}`), but
 *           `getSubclassAlwaysPreparedSpells` iterated it as a flat array.
 *
 *   Bug 2 — Primal Lore skill choice re-offered on EVERY later level-up: the
 *           catch-up backfill re-lists earlier subclass features each level, so
 *           `seedSubclassFeatureChoices` re-seeded the (source-less) skill
 *           proficiency choice. The cantrip grant had an idempotency guard; the
 *           skill choice did not.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// =========================================================================
// Bug 1 — getSubclassFromFeatures tolerates classSource ≠ class source
// =========================================================================
describe("Bug 1 — subclass repair for a homebrew class re-using official subclass features", () => {
	const worldTreeFeatures = [
		{name: "Path of the World Tree", isSubclassFeature: true, className: "Barbarian", classSource: "XPHB", subclassName: "Path of the World Tree", subclassShortName: "World Tree", subclassSource: "XPHB", level: 3},
		{name: "Vitality of the Tree", isSubclassFeature: true, className: "Barbarian", classSource: "XPHB", subclassName: "Path of the World Tree", subclassShortName: "World Tree", subclassSource: "XPHB", level: 3},
		{name: "Branches of the Tree", isSubclassFeature: true, className: "Barbarian", classSource: "XPHB", subclassName: "Path of the World Tree", subclassShortName: "World Tree", subclassSource: "XPHB", level: 6},
	];

	it("reconstructs the subclass when the class is TGTT but features are XPHB", () => {
		const cls = {name: "Barbarian", source: "TGTT", subclass: null};
		const resolved = CharacterSheetClassUtils.getSubclassFromFeatures(cls, worldTreeFeatures);
		expect(resolved).toEqual({name: "Path of the World Tree", shortName: "World Tree", source: "XPHB"});
	});

	it("still disambiguates a genuine same-name multiclass by classSource", () => {
		// Two Barbarian entries: PHB owns Berserker features, XPHB owns World Tree.
		const features = [
			{name: "Frenzy", isSubclassFeature: true, className: "Barbarian", classSource: "PHB", subclassShortName: "Berserker", subclassName: "Path of the Berserker", subclassSource: "PHB", level: 3},
			...worldTreeFeatures,
		];
		const phbBarb = {name: "Barbarian", source: "PHB", subclass: null};
		const xphbBarb = {name: "Barbarian", source: "XPHB", subclass: null};
		expect(CharacterSheetClassUtils.getSubclassFromFeatures(phbBarb, features))
			.toEqual({name: "Path of the Berserker", shortName: "Berserker", source: "PHB"});
		expect(CharacterSheetClassUtils.getSubclassFromFeatures(xphbBarb, features))
			.toEqual({name: "Path of the World Tree", shortName: "World Tree", source: "XPHB"});
	});

	it("does not pull a different class's features (multiclass safety preserved)", () => {
		const cls = {name: "Bard", source: "TGTT", subclass: null};
		expect(CharacterSheetClassUtils.getSubclassFromFeatures(cls, worldTreeFeatures)).toBeNull();
	});

	it("loadFromJson repairs the null subclass and Rage then grants Vitality Temp HP", () => {
		const state = new CharacterSheetState();
		state.setRace?.({name: "Human", source: "XPHB"});
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		// Simulate the real save: subclass null, World Tree features embedded.
		const json = state.toJson();
		const barb = json.classes.find(c => c.name === "Barbarian");
		barb.subclass = null;
		json.features = [...(json.features || []), ...worldTreeFeatures];

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const repaired = loaded.getClasses().find(c => c.name === "Barbarian");
		expect(repaired.subclass?.shortName).toBe("World Tree");

		const calc = loaded.getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBe(true);
		expect(calc.vitalityTempHp).toBe(6);

		loaded.setTempHp(0);
		loaded.activateState("rage");
		expect(loaded.getTempHp()).toBe(6);
	});
});

// =========================================================================
// Bug 3 — frequency-object always-prepared spells don't crash
// =========================================================================
describe("Bug 3 — getSubclassAlwaysPreparedSpells handles frequency-object level-values", () => {
	it("_flattenAdditionalSpellsLevelValue handles both flat-array and frequency-object forms", () => {
		const flatten = CharacterSheetState._flattenAdditionalSpellsLevelValue;
		expect(flatten(["moonbeam|xphb"])).toEqual(["moonbeam|xphb"]);
		expect(flatten({daily: {"1e": ["moonbeam|xphb"]}})).toEqual(["moonbeam|xphb"]);
		expect(flatten({will: ["light|xphb"], daily: {"1": ["fireball|xphb"]}}))
			.toEqual(expect.arrayContaining(["light|xphb", "fireball|xphb"]));
		expect(flatten(null)).toEqual([]);
		expect(flatten(undefined)).toEqual([]);
	});

	it("does not throw and surfaces the frequency-object spell (Moon Bard L6 moonbeam)", () => {
		const cls = {
			name: "Bard",
			source: "TGTT",
			level: 6,
			subclass: {
				name: "College of the Moon",
				shortName: "Moon",
				source: "TGTT-2024",
				additionalSpells: [{prepared: {"6": {daily: {"1e": ["moonbeam|xphb"]}}}}],
			},
		};
		const state = new CharacterSheetState();
		let result;
		expect(() => { result = state.getSubclassAlwaysPreparedSpells(cls); }).not.toThrow();
		expect(result.map(s => String(s.name).toLowerCase())).toContain("moonbeam");
	});

	it("still handles the classic flat-array prepared form", () => {
		const cls = {
			name: "Cleric",
			source: "XPHB",
			level: 3,
			subclass: {
				name: "Life Domain",
				shortName: "Life",
				source: "XPHB",
				additionalSpells: [{prepared: {"1": ["bless|xphb", "cure wounds|xphb"]}}],
			},
		};
		const state = new CharacterSheetState();
		const names = state.getSubclassAlwaysPreparedSpells(cls).map(s => String(s.name).toLowerCase());
		expect(names).toEqual(expect.arrayContaining(["bless", "cure wounds"]));
	});
});

// =========================================================================
// Bug 2 — Primal Lore skill choice seeded once, never re-offered
// =========================================================================
describe("Bug 2 — seeded subclass-feature skill choice is idempotent across level-ups", () => {
	const primalLore = {
		name: "Primal Lore",
		isSubclassFeature: true,
		className: "Bard",
		subclassShortName: "Moon",
		entries: [
			"You learn Druidic and one cantrip from the Druid spell list. It counts as a Bard spell for you but doesn't count against the number of cantrips you know. Whenever you gain a Bard level, you can replace this cantrip with another cantrip of your choice from the Druid spell list.",
			"Additionally, choose one of the following skills: {@skill Animal Handling|XPHB}, {@skill Insight|XPHB}, {@skill Medicine|XPHB}, {@skill Nature|XPHB}, {@skill Perception|XPHB}, or {@skill Survival|XPHB}. You have proficiency in that skill.",
		],
	};

	const pendingSkill = state => state.getPendingFeatureChoices()
		.filter(c => c.featureName === "Primal Lore" && c.kind === "skill");

	it("offers the skill choice on the level it is added", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		expect(pendingSkill(state).length).toBe(1);
	});

	it("does NOT re-offer the skill choice on later level-ups after it is fulfilled", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		const choice = pendingSkill(state)[0];
		state.fulfillFeatureChoice(choice.id, "nature");

		expect(state.hasFulfilledFeatureSkillChoice("Primal Lore")).toBe(true);
		expect(state.getSkillProficiencies().nature).toBe(1);

		// Two subsequent level-ups re-list the feature via the catch-up backfill.
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		expect(pendingSkill(state).length).toBe(0);
	});

	it("persists the fulfilled marker across save/reload so it is never re-offered", () => {
		const state = new CharacterSheetState();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [primalLore], {allSpells: []});
		state.fulfillFeatureChoice(pendingSkill(state)[0].id, "nature");

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.hasFulfilledFeatureSkillChoice("Primal Lore")).toBe(true);

		CharacterSheetClassUtils.seedSubclassFeatureChoices(reloaded, [primalLore], {allSpells: []});
		expect(pendingSkill(reloaded).length).toBe(0);
	});
});
