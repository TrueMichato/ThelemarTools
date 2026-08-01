/**
 * School of Necromancy (PHB Wizard) — MECHANICAL EFFECT tests.
 *
 * `CharacterSheetWizard.test.js` already pins the existence of the calculation flags.
 * This suite exists for the harder half of the acceptance bar: every feature must
 * actually DO something observable through the state APIs, not merely render as text.
 *
 *   L2/3  Necromancy Savant — halves gp + downtime to scribe Necromancy spells
 *   L2/3  Grim Harvest      — heals 2× (3× Necromancy) the slot level on a kill
 *   L6    Undead Thralls    — Animate Dead into the spellbook, +1 target,
 *                             created undead get +wizard level HP and +PB damage
 *   L10   Inured to Undeath — necrotic resistance + hit point maximum can't be reduced
 *   L14   Command Undead    — action, Charisma save vs. the wizard's spell save DC
 *
 * The generic engine pieces exercised here (`hpMaxReductionImmunity`,
 * `spellbookScribeDiscounts`, `grantedSpellbookSpells`, `createdUndead*`) are shared,
 * so the tests double as regression cover for any feature that opts into them.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const makeNecromancer = (level, {int = 18} = {}) => {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({
		name: "Wizard",
		source: "PHB",
		level,
		subclass: {name: "School of Necromancy", source: "PHB", shortName: "Necromancy"},
	});
	state.setAbilityBase("str", 8);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", int);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 10);
	state.applyClassFeatureEffects();
	return state;
};

const makePlainWizard = (level) => {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({
		name: "Wizard",
		source: "PHB",
		level,
		subclass: {name: "School of Evocation", source: "PHB", shortName: "Evocation"},
	});
	state.setAbilityBase("int", 18);
	state.applyClassFeatureEffects();
	return state;
};

// ==========================================================================
// Necromancy Savant (L2) — scribing discount
// ==========================================================================
describe("Necromancy Savant — spellbook scribing discount", () => {
	it("halves gold and downtime for Necromancy spells", () => {
		const state = makeNecromancer(2);
		const cost = state.getSpellbookScribeCost({level: 3, school: "N"});
		expect(cost.baseGp).toBe(150);
		expect(cost.baseHours).toBe(6);
		expect(cost.gp).toBe(75);
		expect(cost.hours).toBe(3);
		expect(cost.multiplier).toBe(0.5);
		expect(cost.sources).toContain("Necromancy Savant");
	});

	it("charges full price for a spell of any other school", () => {
		const state = makeNecromancer(2);
		const cost = state.getSpellbookScribeCost({level: 3, school: "V"});
		expect(cost.gp).toBe(150);
		expect(cost.hours).toBe(6);
		expect(cost.multiplier).toBe(1);
		expect(cost.sources).toEqual([]);
	});

	it("scales the discounted cost with spell level", () => {
		const state = makeNecromancer(2);
		expect(state.getSpellbookScribeCost({level: 1, school: "N"}).gp).toBe(25);
		expect(state.getSpellbookScribeCost({level: 9, school: "N"}).gp).toBe(225);
	});

	it("costs nothing for a cantrip (cantrips are not copied)", () => {
		const state = makeNecromancer(2);
		const cost = state.getSpellbookScribeCost({level: 0, school: "N"});
		expect(cost.gp).toBe(0);
		expect(cost.hours).toBe(0);
	});

	it("gives a non-Necromancer wizard no discount at all", () => {
		const state = makePlainWizard(2);
		expect(state.getSpellbookScribeCost({level: 3, school: "N"}).gp).toBe(150);
	});

	it("registers the discount generically, keyed by school code", () => {
		const state = makeNecromancer(2);
		const discounts = state.getFeatureCalculations().spellbookScribeDiscounts || [];
		expect(discounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({school: "N", multiplier: 0.5, source: "Necromancy Savant"}),
			]),
		);
	});
});

// ==========================================================================
// Grim Harvest (L2) — healing on a kill
// ==========================================================================
describe("Grim Harvest — healing on a kill", () => {
	it("heals twice the slot level for a non-Necromancy spell", () => {
		const state = makeNecromancer(2);
		expect(state.calculateGrimHarvestHealing(3, false)).toEqual(
			expect.objectContaining({total: 6, spellLevel: 3, multiplier: 2}),
		);
	});

	it("heals three times the slot level for a Necromancy spell", () => {
		const state = makeNecromancer(2);
		expect(state.calculateGrimHarvestHealing(3, true)).toEqual(
			expect.objectContaining({total: 9, spellLevel: 3, multiplier: 3}),
		);
	});

	it("heals nothing for a cantrip kill", () => {
		const state = makeNecromancer(2);
		expect(state.calculateGrimHarvestHealing(0, true).total).toBe(0);
	});

	it("clamps a slot level above 9", () => {
		const state = makeNecromancer(20);
		expect(state.calculateGrimHarvestHealing(12, false).total).toBe(18);
	});

	it("returns null for a wizard without the feature", () => {
		expect(makePlainWizard(6).calculateGrimHarvestHealing(3, true)).toBeNull();
	});

	it("is surfaced as an activatable ability, not a toggle state", () => {
		// The classification is name-keyed, so it holds for the feature however it was
		// materialized (class catalog, homebrew, or an imported save).
		const feature = {
			name: "Grim Harvest",
			description: "Once per turn when you kill one or more creatures with a spell of 1st level or higher, you regain hit points equal to twice the spell's level, or three times if the spell belongs to the School of Necromancy.",
		};
		expect(CharacterSheetState.detectActivatableFeature(feature)?.interactionMode).toBe("limited");
	});
});

// ==========================================================================
// Undead Thralls (L6) — spellbook grant + created-undead buffs
// ==========================================================================
describe("Undead Thralls — spellbook grant", () => {
	it("does not grant Animate Dead before level 6", () => {
		const state = makeNecromancer(5);
		const spells = state.getSpells().filter(s => /^animate dead$/i.test(s.name));
		expect(spells).toHaveLength(0);
	});

	it("adds Animate Dead to the spellbook at level 6", () => {
		const state = makeNecromancer(6);
		const animate = state.getSpells().find(s => /^animate dead$/i.test(s.name));
		expect(animate).toBeTruthy();
		expect(animate.inSpellbook).toBe(true);
		expect(animate.grantedByFeature).toBe(true);
		expect(animate.sourceFeature).toBe("Undead Thralls");
	});

	it("adds Animate Dead to the spellbook but NOT to the prepared list", () => {
		const state = makeNecromancer(6);
		const animate = state.getSpells().find(s => /^animate dead$/i.test(s.name));
		expect(animate.prepared).toBeFalsy();
		expect(animate.alwaysPrepared).toBeFalsy();
	});

	it("is idempotent — repeated effect application never duplicates the grant", () => {
		const state = makeNecromancer(6);
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();
		expect(state.getSpells().filter(s => /^animate dead$/i.test(s.name))).toHaveLength(1);
	});

	it("prunes the grant when the feature is lost (level-down)", () => {
		const state = makeNecromancer(6);
		expect(state.getSpells().filter(s => /^animate dead$/i.test(s.name))).toHaveLength(1);

		const cls = state.getClasses()[0];
		cls.level = 5;
		state.applyClassFeatureEffects();
		expect(state.getSpells().filter(s => /^animate dead$/i.test(s.name))).toHaveLength(0);
	});

	it("never deletes a player-scribed copy of the same spell", () => {
		const state = makeNecromancer(6);
		// Player owns it: strip our grant flag as if they had scribed it themselves.
		// `getSpells()` returns copies, so mutate the backing store.
		const stored = state._data.spellcasting.spellsKnown.find(s => /^animate dead$/i.test(s.name));
		expect(stored).toBeTruthy();
		delete stored.grantedByFeature;

		const cls = state.getClasses()[0];
		cls.level = 5;
		state.applyClassFeatureEffects();
		expect(state.getSpells().filter(s => /^animate dead$/i.test(s.name))).toHaveLength(1);
	});
});

describe("Undead Thralls — created-undead bonuses", () => {
	it("grants +wizard level HP and +proficiency bonus damage at level 6", () => {
		const bonuses = makeNecromancer(6).getCreatedUndeadBonuses();
		expect(bonuses.hpBonus).toBe(6);
		expect(bonuses.damageBonus).toBe(3);
		expect(bonuses.extraTargets).toBe(1);
		expect(bonuses.sources).toContain("Undead Thralls");
		expect(bonuses.hasAny).toBe(true);
	});

	it("scales with wizard level and proficiency bonus", () => {
		const bonuses = makeNecromancer(17).getCreatedUndeadBonuses();
		expect(bonuses.hpBonus).toBe(17);
		expect(bonuses.damageBonus).toBe(6);
	});

	it("grants nothing before level 6", () => {
		const bonuses = makeNecromancer(5).getCreatedUndeadBonuses();
		expect(bonuses.hasAny).toBe(false);
		expect(bonuses.hpBonus).toBe(0);
	});

	it("raises a created companion's hit point maximum and current HP", () => {
		const state = makeNecromancer(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: "Animate Dead",
			hp: {max: 13, current: 13},
		});

		const applied = state.applyCreatedUndeadBonuses(id);
		expect(applied).toEqual(expect.objectContaining({hpBonus: 6, damageBonus: 3}));

		const companion = state.getCompanion(id);
		expect(companion.hp.max).toBe(19);
		expect(companion.hp.current).toBe(19);
	});

	it("adds the damage bonus to every companion attack", () => {
		const state = makeNecromancer(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: "Animate Dead",
			hp: {max: 13, current: 13},
			attacks: [{name: "Shortsword", damage: "1d6"}, {name: "Shortbow", damage: "1d6"}],
		});

		state.applyCreatedUndeadBonuses(id);
		expect(state.getCompanion(id).attacks.map(a => a.damageBonus)).toEqual([3, 3]);
	});

	it("buffs every member of a grouped companion's hpArray", () => {
		const state = makeNecromancer(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: "Animate Dead",
			hp: {max: 13, current: 13},
			count: 3,
			hpArray: [{max: 13, current: 13}, {max: 13, current: 13}, {max: 13, current: 13}],
		});

		state.applyCreatedUndeadBonuses(id);
		expect(state.getCompanion(id).hpArray).toEqual([
			{max: 19, current: 19},
			{max: 19, current: 19},
			{max: 19, current: 19},
		]);
	});

	it("is idempotent — a second application never double-buffs", () => {
		const state = makeNecromancer(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: "Animate Dead",
			hp: {max: 13, current: 13},
			attacks: [{name: "Shortsword", damage: "1d6"}],
		});

		state.applyCreatedUndeadBonuses(id);
		state.applyCreatedUndeadBonuses(id);
		state.applyCreatedUndeadBonuses(id);
		expect(state.getCompanion(id).hp.max).toBe(19);
		expect(state.getCompanion(id).attacks[0].damageBonus).toBe(3);
	});

	it("re-bases (does not stack) when the wizard levels up", () => {
		const state = makeNecromancer(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			origin: "Animate Dead",
			hp: {max: 13, current: 13},
			attacks: [{name: "Shortsword", damage: "1d6"}],
		});
		state.applyCreatedUndeadBonuses(id);

		const cls = state.getClasses()[0];
		cls.level = 10;
		state.applyClassFeatureEffects();
		state.applyCreatedUndeadBonuses(id);

		// 13 base + 10 (wizard level), NOT 13 + 6 + 10.
		expect(state.getCompanion(id).hp.max).toBe(23);
		expect(state.getCompanion(id).attacks[0].damageBonus).toBe(4);
	});

	it("does nothing for a wizard without the feature", () => {
		const state = makePlainWizard(6);
		const id = state.addCompanion({
			name: "Skeleton",
			type: CharacterSheetState.COMPANION_TYPES.SUMMON,
			hp: {max: 13, current: 13},
		});
		expect(state.applyCreatedUndeadBonuses(id)).toBeNull();
		expect(state.getCompanion(id).hp.max).toBe(13);
	});
});

// ==========================================================================
// Inured to Undeath (L10) — necrotic resistance + unreducible HP maximum
// ==========================================================================
describe("Inured to Undeath — necrotic resistance", () => {
	it("does not grant necrotic resistance before level 10", () => {
		expect(makeNecromancer(9).getResistances()).not.toContain("necrotic");
	});

	it("grants necrotic resistance at level 10", () => {
		expect(makeNecromancer(10).getResistances()).toContain("necrotic");
	});

	it("is unconditional — never gated behind a toggle", () => {
		const state = makeNecromancer(10);
		// The resistance is live with no active states and no conditional opt-in.
		expect(state.getResistances()).toContain("necrotic");
	});
});

describe("Inured to Undeath — hit point maximum can't be reduced", () => {
	it("is not immune before level 10", () => {
		expect(makeNecromancer(9).isImmuneToMaxHpReduction()).toBe(false);
	});

	it("is immune at level 10", () => {
		const state = makeNecromancer(10);
		expect(state.isImmuneToMaxHpReduction()).toBe(true);
		expect(state.getMaxHpReductionImmunitySources()).toContain("Inured to Undeath");
	});

	it("applies a max-HP reduction normally at level 9", () => {
		const state = makeNecromancer(9);
		const before = state.getMaxHp();
		state.setMaxHpReduction(10);
		expect(state.getMaxHp()).toBe(before - 10);
		expect(state.getMaxHpReduction()).toBe(10);
	});

	it("ignores a max-HP reduction entirely at level 10", () => {
		const state = makeNecromancer(10);
		const before = state.getMaxHp();
		state.setMaxHpReduction(10);
		expect(state.getMaxHp()).toBe(before);
		expect(state.getMaxHpReduction()).toBe(0);
	});

	it("preserves (does not erase) the player-entered reduction while immune", () => {
		const state = makeNecromancer(10);
		state.setMaxHpReduction(10);
		expect(state.getConfiguredMaxHpReduction()).toBe(10);
	});

	it("re-applies the preserved reduction if the feature is lost", () => {
		const state = makeNecromancer(10);
		const before = state.getMaxHp();
		state.setMaxHpReduction(10);
		expect(state.getMaxHp()).toBe(before);

		const cls = state.getClasses()[0];
		cls.level = 9;
		state.applyClassFeatureEffects();

		expect(state.isImmuneToMaxHpReduction()).toBe(false);
		expect(state.getMaxHpReduction()).toBe(10);
	});

	it("reports immunity in the HP breakdown", () => {
		const state = makeNecromancer(10);
		state.setMaxHpReduction(10);
		const breakdown = state.getHpBreakdown();
		expect(breakdown.maxHpReduction.isImmune).toBe(true);
		expect(breakdown.maxHpReduction.ignored).toBe(10);
		expect(breakdown.maxHpReduction.immunitySources).toContain("Inured to Undeath");
	});

	it("tears the resistance and the immunity down together on level-down", () => {
		const state = makeNecromancer(10);
		const cls = state.getClasses()[0];
		cls.level = 9;
		state.applyClassFeatureEffects();
		expect(state.getResistances()).not.toContain("necrotic");
		expect(state.isImmuneToMaxHpReduction()).toBe(false);
	});
});

// ==========================================================================
// Command Undead (L14)
// ==========================================================================
describe("Command Undead", () => {
	it("is not available before level 14", () => {
		expect(makeNecromancer(13).getCommandUndeadInfo()).toBeNull();
	});

	it("uses the wizard's spell save DC (8 + proficiency + Intelligence)", () => {
		const state = makeNecromancer(14, {int: 18});
		// 8 + 5 (prof at 14) + 4 (INT 18) = 17
		expect(state.getCommandUndeadInfo()).toEqual({dc: 17, ability: "cha", range: 60});
		expect(state.getFeatureCalculations().spellSaveDc).toBe(17);
	});

	it("tracks Intelligence changes", () => {
		const state = makeNecromancer(14, {int: 20});
		expect(state.getCommandUndeadInfo().dc).toBe(18);
	});

	it("tracks proficiency bonus growth", () => {
		expect(makeNecromancer(17, {int: 18}).getCommandUndeadInfo().dc).toBe(18);
	});

	it("is surfaced as an activatable ability, not a toggle state", () => {
		const feature = {
			name: "Command Undead",
			description: "As an action, you can choose one undead that you can see within 60 feet of you. That creature must make a Charisma saving throw against your wizard spell save DC. If it succeeds, you can't use this feature on it again.",
		};
		expect(CharacterSheetState.detectActivatableFeature(feature)?.interactionMode).toBe("limited");
	});
});

// ==========================================================================
// Passive features must NOT leak into the Active-States panel
// ==========================================================================
describe("Necromancy passives stay passive", () => {
	it.each(["Necromancy Savant", "Undead Thralls", "Inured to Undeath"])(
		"%s is classified as passive",
		(name) => {
			expect(CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES[name.toLowerCase()]).toBe("passive");
		},
	);

	it("none of the passives register as a toggleable active state", () => {
		const state = makeNecromancer(14);
		const toggleNames = (state.getToggleableAbilities?.() || []).map(a => a.name);
		expect(toggleNames).not.toContain("Necromancy Savant");
		expect(toggleNames).not.toContain("Undead Thralls");
		expect(toggleNames).not.toContain("Inured to Undeath");
	});
});
