/**
 * Character Sheet — TGTT Ranger Feature Implementation Tests
 *
 * Covers the Ranger feature-implementation bug group:
 *  1. Hunter's Prey option-gated weapon damage riders (Colossus Slayer / Horde Breaker / Giant Killer)
 *  2. Primal Focus mode lifecycle (Pursuit speed in Predator, Terrain Defense AC/DEX in Prey) + recompute on switch
 *  3. Tireless (WIS-mod uses, temp-HP grant, short-rest exhaustion) + uses-parser fixes + migration
 *  4. Comprehensive 1–20 feature effects (Enduring Traveler, Unrivaled Pioneer saves/floors,
 *     Penetrating Senses, Apex Sentinel blindsight, Battle Instincts, Apex Focus)
 *
 * Assertions check actual COMPUTED values (speeds, senses, save proficiencies, roll floors,
 * gated damage riders), not mere text presence.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Build a TGTT Ranger at the given level (Hunter subclass once level >= 3). */
function buildTgttRanger (level, {wis = 16, subclass = "Hunter"} = {}) {
	const s = new CharacterSheetState();
	s.setRace({name: "Human", source: "PHB"});
	s.addClass({name: "Ranger", source: "TGTT", level, subclass: level >= 3 ? {name: subclass} : undefined});
	s.setAbilityBase("str", 14);
	s.setAbilityBase("dex", 16);
	s.setAbilityBase("con", 14);
	s.setAbilityBase("int", 10);
	s.setAbilityBase("wis", wis);
	s.setAbilityBase("cha", 10);
	return s;
}

// ==========================================================================
// PART 1: Hunter's Prey option-gated weapon damage riders
// ==========================================================================
describe("TGTT Hunter's Prey — option-gated damage riders", () => {
	it("exposes a Colossus Slayer 1d8 rider ONLY when Colossus Slayer is active", () => {
		const s = buildTgttRanger(6);
		s.setHuntersPreyOption("colossus");
		const calc = s.getFeatureCalculations();
		const rider = (calc.weaponDamageRiders || []).find(r => r.id === "colossusSlayer");
		expect(rider).toBeTruthy();
		expect(rider.dice).toBe("1d8");
		expect(calc.colossusSlayerDamage).toBe("1d8");
	});

	it("does NOT expose the Colossus Slayer rider when Horde Breaker is active", () => {
		const s = buildTgttRanger(6);
		s.setHuntersPreyOption("horde");
		const calc = s.getFeatureCalculations();
		const rider = (calc.weaponDamageRiders || []).find(r => r.id === "colossusSlayer");
		expect(rider).toBeUndefined();
		expect(calc.hasHordeBreaker).toBe(true);
		expect(calc.colossusSlayerDamage).toBeUndefined();
	});

	it("does NOT expose the Colossus Slayer rider when Giant Killer is active", () => {
		const s = buildTgttRanger(6);
		s.setHuntersPreyOption("giantKiller");
		const calc = s.getFeatureCalculations();
		const rider = (calc.weaponDamageRiders || []).find(r => r.id === "colossusSlayer");
		expect(rider).toBeUndefined();
		expect(calc.hasGiantKiller).toBe(true);
	});
});

// ==========================================================================
// PART 2: Primal Focus — Focused Quarry rider (mode-gated + scaling)
// ==========================================================================
describe("TGTT Primal Focus — Focused Quarry rider", () => {
	it("exposes the Focused Quarry rider ONLY in Predator focus", () => {
		const s = buildTgttRanger(6);
		s.setPrimalFocusMode("predator");
		let calc = s.getFeatureCalculations();
		expect((calc.weaponDamageRiders || []).some(r => r.id === "focusedQuarry")).toBe(true);

		s.setPrimalFocusMode("prey");
		calc = s.getFeatureCalculations();
		expect((calc.weaponDamageRiders || []).some(r => r.id === "focusedQuarry")).toBe(false);
	});

	it("scales the Focused Quarry die with Ranger level (1d4 → 1d6 → 1d8 → 1d10)", () => {
		const expectations = {1: "1d4", 4: "1d4", 5: "1d6", 9: "1d6", 10: "1d8", 13: "1d8", 14: "1d10", 20: "1d10"};
		for (const [lvl, die] of Object.entries(expectations)) {
			const s = buildTgttRanger(parseInt(lvl));
			s.setPrimalFocusMode("predator");
			const calc = s.getFeatureCalculations();
			expect(calc.focusedQuarryDamage).toBe(die);
		}
	});
});

// ==========================================================================
// PART 3: Primal Focus — mode lifecycle effects (computed speed / AC / saves)
// ==========================================================================
describe("TGTT Primal Focus — mode-gated effects through the persisted pipeline", () => {
	it("Pursuit grants +10 walking speed in Predator and reverts in Prey (no double-count)", () => {
		const s = buildTgttRanger(6);
		s.setSpeed("walk", 30);
		s.setPrimalFocusMode("predator");
		expect(s.getWalkSpeed()).toBe(40);

		s.setPrimalFocusMode("prey");
		expect(s.getWalkSpeed()).toBe(30);

		// Switching back is idempotent (no accumulation)
		s.setPrimalFocusMode("predator");
		expect(s.getWalkSpeed()).toBe(40);
	});

	it("Terrain Defense adds AC + DEX-save modifiers (situational toggles) only in Prey", () => {
		const s = buildTgttRanger(6);

		s.setPrimalFocusMode("predator");
		let mods = s.getNamedModifiers().filter(m => (m.name || "").includes("Terrain Defense"));
		expect(mods.length).toBe(0);

		s.setPrimalFocusMode("prey");
		mods = s.getNamedModifiers().filter(m => (m.name || "").includes("Terrain Defense"));
		const acMod = mods.find(m => m.type === "ac");
		const dexSaveMod = mods.find(m => m.type === "save:dex");
		expect(acMod).toBeTruthy();
		expect(dexSaveMod).toBeTruthy();
		// Situational → stored disabled until the player enables them in cover/difficult terrain
		expect(acMod.enabled).toBe(false);
		expect(dexSaveMod.enabled).toBe(false);
	});

	it("persists the selected mode (long-rest selection model)", () => {
		const s = buildTgttRanger(6);
		s.setPrimalFocusMode("prey");
		expect(s.getPrimalFocusMode()).toBe("prey");
		s.setPrimalFocusMode("predator");
		expect(s.getPrimalFocusMode()).toBe("predator");
	});
});

// ==========================================================================
// PART 4: Tireless — uses, temp-HP grant, parser, migration
// ==========================================================================
describe("TGTT Tireless", () => {
	it("uses = Wisdom modifier (min 1) for TGTT, not proficiency bonus", () => {
		const s = buildTgttRanger(6, {wis: 16}); // WIS +3, profBonus +3 — distinguish at higher level instead
		const calc = s.getFeatureCalculations();
		expect(calc.hasTireless).toBe(true);
		expect(calc.tirelessUses).toBe(3); // max(1, +3)
		expect(calc.tirelessTempHp).toBe("1d8 + 3");
		expect(calc.tirelessEffects.grantTempHp.formula).toBe("1d8+3");
	});

	it("distinguishes WIS-mod uses from proficiency bonus at higher level", () => {
		// Level 17 → profBonus +6, WIS 14 (+2). TGTT must use WIS mod, not profBonus.
		const s = buildTgttRanger(17, {wis: 14});
		const calc = s.getFeatureCalculations();
		expect(s.getProficiencyBonus()).toBe(6);
		expect(calc.tirelessUses).toBe(2);
	});

	it("floors WIS-mod uses at 1 for a low Wisdom", () => {
		const s = buildTgttRanger(6, {wis: 8}); // WIS -1
		const calc = s.getFeatureCalculations();
		expect(calc.tirelessUses).toBe(1);
	});
});

describe("FeatureUsesParser — phrasing + regain-context fixes", () => {
	const parse = (txt, wisMod = 3, prof = 3) =>
		globalThis.FeatureUsesParser.parseUses(txt, (a) => (a === "wis" ? wisMod : 0), () => prof);

	it("parses 'Uses equal your Wisdom modifier' (no 'to')", () => {
		expect(parse("Uses equal your Wisdom modifier (minimum 1); regain uses on a long rest."))
			.toEqual({max: 3, recharge: "long"});
	});

	it("parses 'equal your proficiency bonus' (no 'to')", () => {
		expect(parse("Uses equal your proficiency bonus; you regain all uses on a long rest.", 3, 4))
			.toEqual({max: 4, recharge: "long"});
	});

	it("ties recharge to the regain clause, ignoring an unrelated 'short rest' mention", () => {
		// Tireless: uses regain on a long rest, but a separate clause mentions short rest.
		const txt = "Uses equal your Wisdom modifier (minimum 1); regain uses on a long rest. "
			+ "Whenever you finish a short rest, your exhaustion level decreases by 1.";
		expect(parse(txt).recharge).toBe("long");
	});

	it("still detects short-rest recharge when uses regain on a short rest", () => {
		expect(parse("You can use this twice. You regain all expended uses when you finish a short rest.", 3, 2))
			.toEqual({max: 2, recharge: "short"});
	});

	it("ignores an unrelated 'restore on a short rest' clause and uses the long-rest regain clause", () => {
		// Restoring hit points on a short rest must NOT set recharge; the uses-regain
		// clause (long rest) is authoritative.
		const txt = "You restore hit points when you finish a short rest. "
			+ "Uses equal your Wisdom modifier; you regain all expended uses when you finish a long rest.";
		expect(parse(txt).recharge).toBe("long");
	});
});

describe("Tireless uses migration (older saves)", () => {
	it("backfills uses + resource (recharge long) for a Tireless feature lacking uses", () => {
		const s = buildTgttRanger(6, {wis: 16});
		const json = s.toJson();
		// Simulate an older save: a Tireless feature with the canonical text but no uses
		json.features = json.features || [];
		json.features.push({
			id: "tireless-old",
			name: "Tireless",
			className: "Ranger",
			classSource: "TGTT",
			level: 5,
			description: "<b>Temporary Hit Points.</b> As a Bonus Action, gain 1d8 + your Wisdom modifier (minimum 1). "
				+ "Uses equal your Wisdom modifier (minimum 1); regain uses on a long rest. "
				+ "<b>Decrease Exhaustion.</b> Whenever you finish a short rest, your exhaustion level decreases by 1.",
			uses: null,
		});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);

		const feature = loaded._data.features.find(f => (f.name || "").toLowerCase() === "tireless");
		expect(feature.uses).toBeTruthy();
		expect(feature.uses.max).toBe(3);
		expect(feature.uses.recharge).toBe("long");

		const resource = loaded._data.resources.find(r => r.name === "Tireless");
		expect(resource).toBeTruthy();
		expect(resource.max).toBe(3);
		expect(resource.recharge).toBe("long");
	});

	it("is idempotent — does not duplicate the resource on a second load", () => {
		const s = buildTgttRanger(6, {wis: 16});
		const json = s.toJson();
		json.features.push({
			id: "tireless-old",
			name: "Tireless",
			className: "Ranger",
			classSource: "TGTT",
			level: 5,
			description: "Uses equal your Wisdom modifier (minimum 1); regain uses on a long rest.",
			uses: null,
		});

		const first = new CharacterSheetState();
		first.loadFromJson(json);
		const reJson = first.toJson();

		const second = new CharacterSheetState();
		second.loadFromJson(reJson);
		const tirelessResources = second._data.resources.filter(r => r.name === "Tireless");
		expect(tirelessResources.length).toBe(1);
	});
});

// ==========================================================================
// PART 5: Comprehensive 1–20 feature effects
// ==========================================================================
describe("TGTT Ranger — Enduring Traveler (level 4)", () => {
	it("is absent before level 4 and present from level 4", () => {
		expect(buildTgttRanger(3).getFeatureCalculations().hasEnduringTraveler).toBeFalsy();
		const calc = buildTgttRanger(4).getFeatureCalculations();
		expect(calc.hasEnduringTraveler).toBe(true);
		expect(calc.immuneExtremeCold).toBe(true);
		expect(calc.immuneExtremeHeat).toBe(true);
		expect(calc.immuneHighAltitude).toBe(true);
		expect(calc.autoSucceedTravelExhaustionSaves).toBe(true);
	});
});

describe("TGTT Ranger — Unrivaled Pioneer (level 9)", () => {
	it("grants INT & WIS save proficiency and Nature/Survival roll floors of 10", () => {
		const s = buildTgttRanger(9);
		const calc = s.getFeatureCalculations();
		expect(calc.hasUnrivaledPioneer).toBe(true);
		expect(calc.unrivaledPioneerSaveProficiencies).toEqual(["int", "wis"]);
		// Expertise is a user pick — must NOT be auto-granted
		expect(calc.unrivaledPioneerExpertisePending).toBe(true);

		s.applyClassFeatureEffects();
		expect(s._data.saveProficiencies).toContain("int");
		expect(s._data.saveProficiencies).toContain("wis");
		expect(s._data.rollFloors.skill.nature.minimum).toBe(10);
		expect(s._data.rollFloors.skill.survival.minimum).toBe(10);
	});
});

describe("TGTT Ranger — Penetrating Senses (level 14)", () => {
	it("sets see-invisible / illusion / shapechanger flags within 60 ft (NOT truesight)", () => {
		const calc = buildTgttRanger(14).getFeatureCalculations();
		expect(calc.hasPenetratingSenses).toBe(true);
		expect(calc.penetratingSensesRange).toBe(60);
		expect(calc.canSeeInvisible).toBe(true);
		expect(calc.detectVisualIllusions).toBe(true);
		expect(calc.perceiveShapechangerTrueForm).toBe(true);
		// Must not fabricate truesight
		expect(calc.truesightRange).toBeUndefined();
	});
});

describe("TGTT Ranger — Apex Sentinel (level 17)", () => {
	it("grants 60 ft blindsight through the senses pipeline (supersedes Feral Senses 30)", () => {
		const s = buildTgttRanger(17);
		s.applyClassFeatureEffects();
		expect(s.getSenses().blindsight).toBeGreaterThanOrEqual(60);
		const calc = s.getFeatureCalculations();
		expect(calc.apexSentinelAuraBonus).toBe(Math.max(1, s.getAbilityMod("wis")));
	});
});

describe("TGTT Ranger — Battle Instincts (level 18)", () => {
	it("flags surprise immunity, unbreakable concentration, and retaliation reaction", () => {
		const calc = buildTgttRanger(18).getFeatureCalculations();
		expect(calc.hasBattleInstincts).toBe(true);
		expect(calc.surpriseImmunity).toBe(true);
		expect(calc.concentrationUnbreakableByDamage).toBe(true);
		expect(calc.hasRetaliationReaction).toBe(true);
	});
});

describe("TGTT Ranger — Apex Focus (level 20)", () => {
	it("flags doubled speed / no weapon disadvantage / per-turn temp HP and applies +2 AC (no heavy armor)", () => {
		const s = buildTgttRanger(20);
		const calc = s.getFeatureCalculations();
		expect(calc.hasApexFocus).toBe(true);
		expect(calc.apexFocusSpeedDoubled).toBe(true);
		expect(calc.apexFocusNoWeaponDisadvantage).toBe(true);
		expect(calc.apexFocusTempHpPerTurn).toBe(20);
		expect(calc.apexFocusAcBonus).toBe(2);

		s.applyClassFeatureEffects();
		const acMod = s.getNamedModifiers().find(m => (m.name || "").includes("Apex Focus") && m.type === "ac");
		expect(acMod).toBeTruthy();
		// Conditional ("while not wearing heavy armor") → stored as a disabled situational toggle
		expect(acMod.enabled).toBe(false);
	});
});
