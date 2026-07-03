/**
 * Character Sheet — Cleric structured feature choices & effects.
 *
 * Covers the generic JSON-structured-choice pipeline and the cleric-specific
 * effect emission it feeds:
 *   - BUG 3: Divine Order (L1) — Protector / Thaumaturge offered + applied.
 *   - BUG 8: Blessed Strikes (L7) + Improved Blessed Strikes (L14) — the L7
 *            pick is stored and the L14 upgrade scales the SAME choice.
 *   - BUG 7: Tempest Domain — bonus proficiencies (no dup), Divine Strike
 *            thunder rider, Stormborn fly = walk, Wrath of the Storm resource.
 *   - Structured-choice parser + durable `chosenSubfeatures` storage + the
 *     per-level recurring-series scoping used by TGTT Principles / Specialties.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureChoiceParser = globalThis.FeatureChoiceParser;

// ---- Shared fixtures: 2024 Divine Order + roles -------------------------
const F_DIVINE_ORDER = {
	name: "Divine Order",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: [
		"You have dedicated yourself to one of the following sacred roles of your choice.",
		{
			type: "entries",
			entries: [
				{
					type: "options",
					count: 1,
					entries: [
						{type: "refClassFeature", classFeature: "Protector|Cleric|XPHB|1|XPHB"},
						{type: "refClassFeature", classFeature: "Thaumaturge|Cleric|XPHB|1|XPHB"},
					],
				},
			],
		},
	],
};
const F_PROTECTOR = {
	name: "Protector",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: ["Trained for battle, you gain proficiency with Martial weapons and Heavy armor."],
};
const F_THAUMATURGE = {
	name: "Thaumaturge",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: ["You know one extra cantrip from the Cleric spell list. In addition, you add your Wisdom modifier to any Intelligence (Arcana or Religion) check you make."],
};

function seedDivineOrderChoice (state) {
	state.setClassFeatureCatalog([F_DIVINE_ORDER, F_PROTECTOR, F_THAUMATURGE], []);
	return CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [F_DIVINE_ORDER]);
}

// =========================================================================
// Structured-choice parser
// =========================================================================
describe("FeatureChoiceParser — structured sub-feature choices", () => {
	it("surfaces an options/refClassFeature group (Divine Order)", () => {
		const parsed = FeatureChoiceParser.extractChoices(F_DIVINE_ORDER);
		expect(parsed.subfeatureChoices).toHaveLength(1);
		expect(parsed.subfeatureChoices[0].count).toBe(1);
		expect(parsed.subfeatureChoices[0].options.map(o => o.name).sort())
			.toEqual(["Protector", "Thaumaturge"]);
	});

	it("surfaces a sibling-ref 'one of the following' group (Blessed Strikes)", () => {
		const blessedStrikes = {
			name: "Blessed Strikes",
			source: "XPHB",
			level: 7,
			className: "Cleric",
			classSource: "XPHB",
			entries: [
				"Divine power infuses you in battle. You gain one of the following options of your choice.",
				{
					type: "entries",
					entries: [
						{type: "refClassFeature", classFeature: "Divine Strike|Cleric|XPHB|7"},
						{type: "refClassFeature", classFeature: "Potent Spellcasting|Cleric|XPHB|7"},
					],
				},
			],
		};
		const parsed = FeatureChoiceParser.extractChoices(blessedStrikes);
		expect(parsed.subfeatureChoices).toHaveLength(1);
		expect(parsed.subfeatureChoices[0].options.map(o => o.name).sort())
			.toEqual(["Divine Strike", "Potent Spellcasting"]);
	});

	it("does NOT treat named scaling sub-blocks as a choice (Improved Blessed Strikes)", () => {
		const improved = {
			name: "Improved Blessed Strikes",
			source: "XPHB",
			level: 14,
			className: "Cleric",
			classSource: "XPHB",
			entries: [
				"The option you chose for Blessed Strikes grows more powerful.",
				{type: "entries", name: "Divine Strike", entries: ["The extra damage increases to 2d8."]},
				{type: "entries", name: "Potent Spellcasting", entries: ["You gain temporary hit points."]},
			],
		};
		expect(FeatureChoiceParser.extractChoices(improved).subfeatureChoices).toHaveLength(0);
	});

	it("emits a fromRef descriptor for a cross-referenced pool (Specialties L7+)", () => {
		const specL7 = {
			name: "Specialties",
			source: "TGTT",
			level: 7,
			className: "Cleric",
			classSource: "TGTT",
			entries: ["You gain another specialty of your choice from the {@classFeature Specialties|Cleric|TGTT|3}."],
		};
		const parsed = FeatureChoiceParser.extractChoices(specL7);
		expect(parsed.subfeatureChoices).toHaveLength(1);
		expect(parsed.subfeatureChoices[0].fromRef).toEqual({refType: "classFeature", ref: "Specialties|Cleric|TGTT|3"});
	});
});

// =========================================================================
// BUG 3 — Divine Order (offer + apply)
// =========================================================================
describe("Cleric — Divine Order (2024 L1)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("is offered as a pending sub-feature choice at L1", () => {
		expect(seedDivineOrderChoice(state)).toBe(true);
		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "subfeature");
		expect(pending).toHaveLength(1);
		expect(pending[0].featureName).toBe("Divine Order");
		expect(pending[0].options.map(o => o.name).sort()).toEqual(["Protector", "Thaumaturge"]);
	});

	it("Protector applies Martial weapon + Heavy armor proficiency", () => {
		seedDivineOrderChoice(state);
		const choice = state.getPendingFeatureChoices().find(c => c.kind === "subfeature");
		expect(state.fulfillFeatureChoice(choice.id, {name: "Protector", source: "XPHB"})).toBe(true);
		state.applyClassFeatureEffects();

		const weapons = state.getWeaponProficiencies().map(w => w.toLowerCase());
		const armor = state.getArmorProficiencies().map(a => a.toLowerCase());
		expect(weapons).toContain("martial weapons");
		expect(armor).toContain("heavy armor");
	});

	it("Thaumaturge adds WIS modifier (min 1) to Arcana and Religion", () => {
		state.setAbilityBase("wis", 16); // +3
		seedDivineOrderChoice(state);
		const choice = state.getPendingFeatureChoices().find(c => c.kind === "subfeature");
		expect(state.fulfillFeatureChoice(choice.id, {name: "Thaumaturge", source: "XPHB"})).toBe(true);
		state.applyClassFeatureEffects();

		expect(state.getSkillModifier("arcana")).toBeGreaterThanOrEqual(3);
		expect(state.getSkillModifier("religion")).toBeGreaterThanOrEqual(3);
	});

	it("records the chosen role durably in chosenSubfeatures", () => {
		seedDivineOrderChoice(state);
		const choice = state.getPendingFeatureChoices().find(c => c.kind === "subfeature");
		state.fulfillFeatureChoice(choice.id, {name: "Protector", source: "XPHB"});
		expect(state.getChosenSubfeatures().some(r => r.parent === "Divine Order" && r.name === "Protector")).toBe(true);
	});

	it("does not re-offer the choice once resolved (idempotent seeding)", () => {
		seedDivineOrderChoice(state);
		const choice = state.getPendingFeatureChoices().find(c => c.kind === "subfeature");
		state.fulfillFeatureChoice(choice.id, {name: "Protector", source: "XPHB"});
		// Re-seed (simulates a later level-up catch-up pass).
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [F_DIVINE_ORDER]);
		expect(state.getPendingFeatureChoices().filter(c => c.kind === "subfeature")).toHaveLength(0);
	});
});

// =========================================================================
// BUG 8 — Blessed Strikes L7 stored, L14 scales the SAME choice
// =========================================================================
describe("Cleric — Blessed Strikes / Improved Blessed Strikes", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	function recordBlessedStrikes (name) {
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource: "XPHB", level: 7, name, source: "XPHB"});
	}

	it("chosen Divine Strike emits a single 1d8 weapon rider at L7", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 7});
		recordBlessedStrikes("Divine Strike");
		const calc = state.getFeatureCalculations();
		const riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders).toHaveLength(1);
		expect(riders[0].dice).toBe("1d8");
		expect(riders[0].damageTypeChoices).toEqual(["necrotic", "radiant"]);
	});

	it("the SAME Divine Strike choice scales to 2d8 at L14 (no re-ask)", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 14});
		recordBlessedStrikes("Divine Strike");
		const calc = state.getFeatureCalculations();
		const rider = (calc.weaponDamageRiders || []).find(r => r.id === "clericDivineStrike");
		expect(rider).toBeTruthy();
		expect(rider.dice).toBe("2d8");
	});

	it("getChosenBlessedStrikesOption reads the stored L7 pick", () => {
		recordBlessedStrikes("Divine Strike");
		expect(state.getChosenBlessedStrikesOption()).toBe("Divine Strike");
	});

	it("choosing Potent Spellcasting emits NO Divine Strike rider", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 7});
		recordBlessedStrikes("Potent Spellcasting");
		const calc = state.getFeatureCalculations();
		const riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders).toHaveLength(0);
	});

	it("does NOT emit the rider below Cleric level 7 (stale save / level-down guard)", () => {
		state.addClass({name: "Cleric", source: "XPHB", level: 5});
		recordBlessedStrikes("Divine Strike");
		const calc = state.getFeatureCalculations();
		const riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders).toHaveLength(0);
	});

	it("Tempest + Blessed Strikes emits ONE rider typed radiant (Blessed Strikes supersedes domain thunder)", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 8, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		recordBlessedStrikes("Divine Strike");
		const calc = state.getFeatureCalculations();
		const riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders).toHaveLength(1);
		expect(riders[0].damageType).toBe("radiant"); // NOT thunder
		expect(riders[0].damageTypeChoices).toEqual(["necrotic", "radiant"]);
	});
});

// =========================================================================
// BUG 7 — Tempest Domain
// =========================================================================
describe("Cleric — Tempest Domain", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("wis", 16); // +3 → Wrath uses
	});

	it("grants Martial weapon + Heavy armor proficiency (applied, no duplicates)", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 3, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		state.applyClassFeatureEffects();

		const weapons = state.getWeaponProficiencies().filter(w => w.toLowerCase() === "martial weapons");
		const armor = state.getArmorProficiencies().filter(a => a.toLowerCase() === "heavy armor");
		expect(weapons).toHaveLength(1); // present, exactly once
		expect(armor).toHaveLength(1);
	});

	it("emits a single thunder Divine Strike rider at L8 (1d8 → 2d8 at L14)", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 8, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		let calc = state.getFeatureCalculations();
		let riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders).toHaveLength(1);
		expect(riders[0].damageType).toBe("thunder");
		expect(riders[0].dice).toBe("1d8");

		state.getClasses()[0].level = 14;
		calc = state.getFeatureCalculations();
		riders = (calc.weaponDamageRiders || []).filter(r => r.id === "clericDivineStrike");
		expect(riders[0].dice).toBe("2d8");
	});

	it("Stormborn (L17) grants a flying speed equal to walking speed", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 17, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		state.applyClassFeatureEffects();
		expect(state.getSpeedByType("fly")).toBe(state.getSpeedByType("walk"));
		expect(state.getSpeedByType("fly")).toBeGreaterThan(0);
	});

	it("Wrath of the Storm becomes a WIS-mod / long-rest resource", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 1, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		state.addFeature({
			name: "Wrath of the Storm",
			source: "PHB",
			description: "You can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.",
		});
		const wrath = state.getResources().find(r => r.name === "Wrath of the Storm");
		expect(wrath).toBeTruthy();
		expect(wrath.max).toBe(3); // WIS +3
		expect(wrath.recharge).toBe("long");
	});

	it("Destructive Wrath does NOT create a parallel resource (it is a Channel Divinity option)", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 3, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		state.applyClassFeatureEffects();
		expect(state.getResources().some(r => /destructive wrath/i.test(r.name))).toBe(false);
	});
});

// =========================================================================
// Durable storage: recurring series scoping + save/load round-trip
// =========================================================================
describe("Cleric — chosenSubfeatures durable storage", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("tracks recurring picks per level and excludes already-taken options", () => {
		state._recordChosenSubfeature({parent: "Specialties", parentSource: "TGTT", level: 3, name: "Theologian", source: "TGTT"});
		state._recordChosenSubfeature({parent: "Specialties", parentSource: "TGTT", level: 7, name: "Premonition", source: "TGTT"});

		expect(state.hasChosenSubfeatureForParent("Specialties", "TGTT", 3)).toBe(true);
		expect(state.hasChosenSubfeatureForParent("Specialties", "TGTT", 11)).toBe(false);

		const taken = state.getChosenSubfeatureKeysForSeries("Specialties", "TGTT");
		expect(taken.has("theologian|tgtt")).toBe(true);
		expect(taken.has("premonition|tgtt")).toBe(true);
		expect(taken.size).toBe(2);
	});

	it("dedupes identical records (replay-safe)", () => {
		const rec = {parent: "Divine Order", parentSource: "XPHB", level: 1, name: "Protector", source: "XPHB"};
		state._recordChosenSubfeature(rec);
		state._recordChosenSubfeature({...rec});
		expect(state.getChosenSubfeatures()).toHaveLength(1);
	});

	it("scopes a same-named recurring series per class (multiclass TGTT Specialties don't leak)", () => {
		// Cleric 3 / Paladin 3, both TGTT, both offer "Specialties|TGTT|3".
		state._recordChosenSubfeature({parent: "Specialties", parentSource: "TGTT", parentClass: "Cleric", parentClassSource: "TGTT", level: 3, name: "Theologian", source: "TGTT"});
		state._recordChosenSubfeature({parent: "Specialties", parentSource: "TGTT", parentClass: "Paladin", parentClassSource: "TGTT", level: 3, name: "Righteous Path", source: "TGTT"});

		// Both are stored independently (class is part of the dedup key).
		expect(state.getChosenSubfeatures()).toHaveLength(2);

		// The Cleric L3 instance is resolved, but the Paladin pick must NOT suppress a
		// still-open Cleric one and vice-versa when class is supplied.
		expect(state.hasChosenSubfeatureForParent("Specialties", "TGTT", 3, "Cleric", "TGTT")).toBe(true);
		expect(state.hasChosenSubfeatureForParent("Specialties", "TGTT", 3, "Barbarian", "TGTT")).toBe(false);

		// The no-repeat pool is scoped to one class.
		const clericTaken = state.getChosenSubfeatureKeysForSeries("Specialties", "TGTT", "Cleric", "TGTT");
		expect(clericTaken.has("theologian|tgtt")).toBe(true);
		expect(clericTaken.has("righteous path|tgtt")).toBe(false); // that was the Paladin's pick
	});

	it("survives a save/load round-trip", () => {
		state._recordChosenSubfeature({parent: "Divine Order", parentSource: "XPHB", level: 1, name: "Thaumaturge", source: "XPHB"});
		const json = state.toJson();

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		expect(reloaded.getChosenSubfeatures().some(r => r.name === "Thaumaturge" && r.parent === "Divine Order")).toBe(true);
	});

	it("defaults chosenSubfeatures to [] for legacy saves", () => {
		const legacy = new CharacterSheetState();
		legacy.loadFromJson({name: "Old Cleric", classes: [{name: "Cleric", source: "PHB", level: 1}]});
		expect(legacy.getChosenSubfeatures()).toEqual([]);
	});
});
