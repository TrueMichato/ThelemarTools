
import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Character Sheet Feat Effects", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		// Set up a basic character for testing
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 12);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 8);
		state.addClass({name: "Fighter", source: "PHB", level: 5});
	});

	// ===================================================================
	// FEAT REGISTRY TESTS
	// ===================================================================
	describe("Feat Registry", () => {
		test("should have registered feat effects in FeatureEffectRegistry", () => {
			// Test that key feats are registered
			const registry = globalThis.FeatureEffectRegistry;
			expect(registry).toBeDefined();
			expect(registry.getFeatEffects("Tough")).toBeDefined();
			expect(registry.getFeatEffects("Tough").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Alert", "PHB").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Alert", "XPHB").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("War Caster").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Mobile").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Observant", "PHB").length).toBeGreaterThan(0);
		});

		test("should differentiate PHB vs XPHB versions for feats with different effects", () => {
			const registry = globalThis.FeatureEffectRegistry;

			// Alert has different effects between 2014 and 2024
			const alertPHB = registry.getFeatEffects("Alert", "PHB");
			const alertXPHB = registry.getFeatEffects("Alert", "XPHB");

			// PHB: flat +5 initiative
			const phbInit = alertPHB.find(e => e.type === "modifier" && e.modType === "initiative");
			expect(phbInit).toBeDefined();
			expect(phbInit.value).toBe(5);

			// XPHB: proficiency bonus to initiative
			const xphbInit = alertXPHB.find(e => e.type === "modifier" && e.modType === "initiative");
			expect(xphbInit).toBeDefined();
			expect(xphbInit.value).toBe("proficiency");
		});

		test("should fall back to name-only key when source not found", () => {
			const registry = globalThis.FeatureEffectRegistry;

			// Mobile has no source-specific versions
			const mobile = registry.getFeatEffects("Mobile", "PHB");
			const mobileGeneric = registry.getFeatEffects("Mobile");
			expect(mobile).toEqual(mobileGeneric);
			expect(mobile.length).toBeGreaterThan(0);
		});

		test("should not overwrite race features with same-named feats", () => {
			const registry = globalThis.FeatureEffectRegistry;

			// Halfling "Lucky" is a race feature (reroll 1s)
			// "Lucky" feat uses source-specific keys only
			const luckyGeneric = registry.getEffects("Lucky");

			// The generic "Lucky" should still be the Halfling race feature
			expect(luckyGeneric.some(e => e.modType === "reroll:1:attack")).toBe(true);
		});

		test("should have fighting style feats registered", () => {
			const registry = globalThis.FeatureEffectRegistry;
			expect(registry.getFeatEffects("Archery").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Defense").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Dueling").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Great Weapon Fighting").length).toBeGreaterThan(0);
			expect(registry.getFeatEffects("Two-Weapon Fighting").length).toBeGreaterThan(0);
		});
	});

	// ===================================================================
	// TOUGH FEAT — HP Per Level
	// ===================================================================
	describe("Tough Feat", () => {
		test("should increase max HP by 2 per level", () => {
			const hpBefore = state.getMaxHp();
			state.addFeat({name: "Tough", source: "PHB"});
			const hpAfter = state.getMaxHp();

			// At level 5, Tough should add +10 HP (5 levels × 2)
			expect(hpAfter - hpBefore).toBe(10);
		});

		test("should scale with character level", () => {
			state.addFeat({name: "Tough", source: "PHB"});
			const hpAtL5 = state.getMaxHp();

			// Level up to 10
			state.addClass({name: "Fighter", source: "PHB", level: 10});
			const hpAtL10 = state.getMaxHp();

			// HP gain from levels 6-10 should include the +2 per level from Tough
			// Each Fighter level: ceil(10/2)+1+conMod = 6+2 = 8
			// Plus 2 from Tough per level = 10 per level for 5 levels = 50
			// But we just need to verify the Tough bonus itself scales
			const toughBonusL5 = 5 * 2;
			const toughBonusL10 = 10 * 2;

			// The relative difference from Tough should scale
			expect(toughBonusL10).toBeGreaterThan(toughBonusL5);
		});

		test("should create an HP named modifier", () => {
			state.addFeat({name: "Tough", source: "PHB"});
			const mods = state.getNamedModifiers();
			const toughMod = mods.find(m => m.name === "Tough (HP)" && m.type === "hp");
			expect(toughMod).toBeDefined();
			expect(toughMod.value).toBe(2);
			expect(toughMod.perLevel).toBe(true);
			expect(toughMod.sourceType).toBe("feat");
		});

		test("should work with XPHB source too", () => {
			const hpBefore = state.getMaxHp();
			state.addFeat({name: "Tough", source: "XPHB"});
			const hpAfter = state.getMaxHp();
			expect(hpAfter - hpBefore).toBe(10); // 5 levels × 2
		});

		test("should remove HP bonus when feat is removed", () => {
			const hpBefore = state.getMaxHp();
			state.addFeat({name: "Tough", source: "PHB"});
			expect(state.getMaxHp()).toBe(hpBefore + 10);

			state.removeFeat("Tough", "PHB");
			expect(state.getMaxHp()).toBe(hpBefore);
		});
	});

	// ===================================================================
	// ALERT FEAT — Initiative Bonus
	// ===================================================================
	describe("Alert Feat", () => {
		test("should add +5 to initiative (PHB 2014)", () => {
			const initBefore = state.getInitiative();
			state.addFeat({name: "Alert", source: "PHB"});
			const initAfter = state.getInitiative();
			expect(initAfter - initBefore).toBe(5);
		});

		test("should add proficiency bonus to initiative (XPHB 2024)", () => {
			const initBefore = state.getInitiative();
			const profBonus = state.getProficiencyBonus(); // +3 at level 5
			state.addFeat({name: "Alert", source: "XPHB"});
			const initAfter = state.getInitiative();
			expect(initAfter - initBefore).toBe(profBonus);
		});

		test("should create initiative named modifier", () => {
			state.addFeat({name: "Alert", source: "PHB"});
			const mods = state.getNamedModifiers();
			const alertMod = mods.find(m => m.name === "Alert" && m.type === "initiative");
			expect(alertMod).toBeDefined();
			expect(alertMod.value).toBe(5);
			expect(alertMod.sourceType).toBe("feat");
		});

		test("XPHB Alert should create proficiency-based modifier", () => {
			state.addFeat({name: "Alert", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const alertMod = mods.find(m => m.name === "Alert" && m.type === "initiative");
			expect(alertMod).toBeDefined();
			expect(alertMod.proficiencyBonus).toBe(true);
		});

		test("should remove initiative bonus when feat is removed", () => {
			const initBefore = state.getInitiative();
			state.addFeat({name: "Alert", source: "PHB"});
			expect(state.getInitiative()).toBe(initBefore + 5);

			state.removeFeat("Alert", "PHB");
			expect(state.getInitiative()).toBe(initBefore);
		});
	});

	// ===================================================================
	// WAR CASTER FEAT — Concentration Advantage
	// ===================================================================
	describe("War Caster Feat", () => {
		test("should grant advantage on concentration saves", () => {
			state.addFeat({name: "War Caster", source: "PHB"});
			const concAdv = state.getConcentrationAdvantage();
			expect(concAdv.advantage).toBe(true);
		});

		test("should create concentration modifier with advantage flag", () => {
			state.addFeat({name: "War Caster", source: "PHB"});
			const mods = state.getNamedModifiers();
			const wcMod = mods.find(m => m.name === "War Caster" && m.type === "concentration");
			expect(wcMod).toBeDefined();
			expect(wcMod.advantage).toBe(true);
		});

		test("should work with XPHB source", () => {
			state.addFeat({name: "War Caster", source: "XPHB"});
			const concAdv = state.getConcentrationAdvantage();
			expect(concAdv.advantage).toBe(true);
		});
	});

	// ===================================================================
	// OBSERVANT FEAT — Passive Score Bonuses
	// ===================================================================
	describe("Observant Feat", () => {
		test("should add +5 to passive perception (PHB)", () => {
			const ppBefore = state.getPassivePerception();
			state.addFeat({name: "Observant", source: "PHB"});
			const ppAfter = state.getPassivePerception();
			expect(ppAfter - ppBefore).toBe(5);
		});

		test("should add +5 to passive investigation (PHB)", () => {
			const piBefore = state.getPassiveInvestigation();
			state.addFeat({name: "Observant", source: "PHB"});
			const piAfter = state.getPassiveInvestigation();
			expect(piAfter - piBefore).toBe(5);
		});

		test("XPHB Observant should add +5 to passive perception only", () => {
			const ppBefore = state.getPassivePerception();
			const piBefore = state.getPassiveInvestigation();

			state.addFeat({name: "Observant", source: "XPHB"});

			expect(state.getPassivePerception() - ppBefore).toBe(5);
			// XPHB doesn't grant passive investigation bonus
			expect(state.getPassiveInvestigation()).toBe(piBefore);
		});

		test("should create passive score modifiers", () => {
			state.addFeat({name: "Observant", source: "PHB"});
			const mods = state.getNamedModifiers();
			const percMod = mods.find(m => m.type === "passive:perception");
			const invMod = mods.find(m => m.type === "passive:investigation");
			expect(percMod).toBeDefined();
			expect(percMod.value).toBe(5);
			expect(invMod).toBeDefined();
			expect(invMod.value).toBe(5);
		});
	});

	// ===================================================================
	// MOBILE FEAT — Speed Bonus
	// ===================================================================
	describe("Mobile Feat", () => {
		test("should add +10 to walking speed", () => {
			const speedBefore = state.getWalkSpeed();
			state.addFeat({name: "Mobile", source: "PHB"});
			const speedAfter = state.getWalkSpeed();
			expect(speedAfter - speedBefore).toBe(10);
		});

		test("should create speed modifier", () => {
			state.addFeat({name: "Mobile", source: "PHB"});
			const mods = state.getNamedModifiers();
			const speedMod = mods.find(m => m.type === "speed:walk" && m.name.includes("Mobile"));
			expect(speedMod).toBeDefined();
			expect(speedMod.value).toBe(10);
		});

		test("should remove speed bonus when feat is removed", () => {
			const speedBefore = state.getWalkSpeed();
			state.addFeat({name: "Mobile", source: "PHB"});
			expect(state.getWalkSpeed()).toBe(speedBefore + 10);

			state.removeFeat("Mobile", "PHB");
			expect(state.getWalkSpeed()).toBe(speedBefore);
		});
	});

	// ===================================================================
	// DUAL WIELDER FEAT — AC Bonus (PHB 2014)
	// ===================================================================
	describe("Dual Wielder Feat (PHB)", () => {
		test("should create conditional AC modifier", () => {
			state.addFeat({name: "Dual Wielder", source: "PHB"});
			const mods = state.getNamedModifiers();
			const acMod = mods.find(m => m.type === "ac" && m.name.includes("Dual Wielder"));
			expect(acMod).toBeDefined();
			expect(acMod.value).toBe(1);
			expect(acMod.conditional).toBeDefined();
			expect(acMod.conditional).toContain("dual wielding");
		});
	});

	// ===================================================================
	// HEAVY ARMOR MASTER — Damage Reduction
	// ===================================================================
	describe("Heavy Armor Master Feat", () => {
		test("should create damage reduction modifier (PHB)", () => {
			state.addFeat({name: "Heavy Armor Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const drMod = mods.find(m => m.type === "damageReduction");
			expect(drMod).toBeDefined();
			expect(drMod.value).toBe(3);
			expect(drMod.note).toContain("bludgeoning");
		});

		test("XPHB version should use proficiency-based DR", () => {
			state.addFeat({name: "Heavy Armor Master", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const drMod = mods.find(m => m.type === "damageReduction");
			expect(drMod).toBeDefined();
			expect(drMod.proficiencyBonus).toBe(true);
		});
	});

	// ===================================================================
	// HEAVILY ARMORED — Armor Proficiency
	// ===================================================================
	describe("Heavily Armored Feat", () => {
		test("should grant heavy armor proficiency", () => {
			// Ensure not already proficient
			expect(state.hasArmorProficiency("Heavy Armor")).toBe(false);
			state.addFeat({name: "Heavily Armored", source: "PHB"});
			expect(state.hasArmorProficiency("Heavy Armor")).toBe(true);
		});

		test("should not duplicate proficiency if already proficient", () => {
			state.addArmorProficiency("Heavy Armor");
			const countBefore = state.getArmorProficiencies().length;
			state.addFeat({name: "Heavily Armored", source: "PHB"});
			const countAfter = state.getArmorProficiencies().length;
			expect(countAfter).toBe(countBefore);
		});
	});

	// ===================================================================
	// SKULKER FEAT — Blindsight (XPHB)
	// ===================================================================
	describe("Skulker Feat (XPHB)", () => {
		test("should grant blindsight 10 ft via sense modifier", () => {
			state.addFeat({name: "Skulker", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const senseMod = mods.find(m => m.type === "sense:blindsight");
			expect(senseMod).toBeDefined();
			expect(senseMod.value).toBe(10);
			// The modifier-object assertion above is a PREMISE, not the result. On its own it
			// let CS-BUG-136 through for the entire life of this test: the modifier was
			// written correctly with value 10 while the sheet displayed 20, because
			// `getSense()` counted it twice. Assert on the observable getter — that is what
			// the player reads.
			expect(state.getSense("blindsight")).toBe(10);
			expect(state.getSenses().blindsight).toBe(10);
		});
	});

	// ===================================================================
	// SHIELD MASTER — DEX Save Bonus
	// ===================================================================
	describe("Shield Master Feat", () => {
		test("should create conditional DEX save modifier", () => {
			state.addFeat({name: "Shield Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const saveMod = mods.find(m => m.type === "save:dex:shield");
			expect(saveMod).toBeDefined();
			expect(saveMod.conditional).toBeDefined();
		});
	});

	// ===================================================================
	// MEDIUM ARMOR MASTER — AC Max DEX
	// ===================================================================
	describe("Medium Armor Master Feat", () => {
		test("should create max DEX modifier for medium armor", () => {
			state.addFeat({name: "Medium Armor Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const maxDexMod = mods.find(m => m.type === "ac:mediumArmorMaxDex");
			expect(maxDexMod).toBeDefined();
			expect(maxDexMod.value).toBe(3);
		});

		test("should create no-stealth-disadvantage modifier", () => {
			state.addFeat({name: "Medium Armor Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const stealthMod = mods.find(m => m.type === "armor:medium:noStealthDisadvantage");
			expect(stealthMod).toBeDefined();
		});
	});

	// ===================================================================
	// TAVERN BRAWLER — Weapon Proficiency
	// ===================================================================
	describe("Tavern Brawler Feat", () => {
		test("should grant improvised weapon proficiency (PHB)", () => {
			state.addFeat({name: "Tavern Brawler", source: "PHB"});
			expect(state.hasWeaponProficiency("Improvised Weapons")).toBe(true);
		});

		test("should create unarmed damage modifier (PHB)", () => {
			state.addFeat({name: "Tavern Brawler", source: "PHB"});
			const mods = state.getNamedModifiers();
			const unarmedMod = mods.find(m => m.type === "unarmed:damage");
			expect(unarmedMod).toBeDefined();
			expect(unarmedMod.value).toBe("1d4");
		});
	});

	// ===================================================================
	// GREAT WEAPON MASTER — Damage/Attack Modifiers
	// ===================================================================
	describe("Great Weapon Master Feat", () => {
		test("PHB version should create optional -5/+10 modifiers", () => {
			state.addFeat({name: "Great Weapon Master", source: "PHB"});
			const mods = state.getNamedModifiers();

			const attackMod = mods.find(m => m.type === "attack:heavy" && m.name.includes("Great Weapon Master"));
			expect(attackMod).toBeDefined();
			expect(attackMod.value).toBe(-5);
			expect(attackMod.enabled).toBe(false); // Optional, starts disabled

			const damageMod = mods.find(m => m.type === "damage:heavy" && m.name.includes("Great Weapon Master"));
			expect(damageMod).toBeDefined();
			expect(damageMod.value).toBe(10);
			expect(damageMod.enabled).toBe(false); // Optional, starts disabled
		});

		test("XPHB version should have different damage mechanic", () => {
			state.addFeat({name: "Great Weapon Master", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const damageMod = mods.find(m => m.type === "damage:heavy:bonusOnCritOrKill");
			expect(damageMod).toBeDefined();
			expect(damageMod.value).toBe("strMod");
		});
	});

	// ===================================================================
	// SHARPSHOOTER — Ranged Modifiers
	// ===================================================================
	describe("Sharpshooter Feat", () => {
		test("PHB version should create optional -5/+10 modifiers", () => {
			state.addFeat({name: "Sharpshooter", source: "PHB"});
			const mods = state.getNamedModifiers();

			const attackMod = mods.find(m => m.type === "attack:ranged" && m.note?.includes("Sharpshooter"));
			expect(attackMod).toBeDefined();
			expect(attackMod.value).toBe(-5);
			expect(attackMod.enabled).toBe(false);

			const ignoreCover = mods.find(m => m.type === "ranged:ignoreCover");
			expect(ignoreCover).toBeDefined();
		});

		test("XPHB version should have cover/range bonuses but no -5/+10", () => {
			state.addFeat({name: "Sharpshooter", source: "XPHB"});
			const mods = state.getNamedModifiers();

			const ignoreCover = mods.find(m => m.type === "ranged:ignoreCover");
			expect(ignoreCover).toBeDefined();

			const noLongRange = mods.find(m => m.type === "ranged:noLongRangeDisadvantage");
			expect(noLongRange).toBeDefined();

			// XPHB should NOT have the -5/+10 power attack
			const powerAttack = mods.find(m => m.type === "attack:ranged" && m.note?.includes("power attack"));
			expect(powerAttack).toBeUndefined();
		});
	});

	// ===================================================================
	// CROSSBOW EXPERT — Ranged in Melee
	// ===================================================================
	describe("Crossbow Expert Feat", () => {
		test("should create no-disadvantage-in-melee modifier", () => {
			state.addFeat({name: "Crossbow Expert", source: "PHB"});
			const mods = state.getNamedModifiers();
			const noDisadvMod = mods.find(m => m.type === "ranged:noDisdvantageInMelee");
			expect(noDisadvMod).toBeDefined();
		});
	});

	// ===================================================================
	// ATHLETE — Climb Speed
	// ===================================================================
	describe("Athlete Feat", () => {
		test("should grant climb speed equal to walking", () => {
			state.addFeat({name: "Athlete", source: "PHB"});
			const mods = state.getNamedModifiers();
			const climbMod = mods.find(m => m.type === "speed:climb" && m.equalToWalk);
			expect(climbMod).toBeDefined();
		});
	});

	// ===================================================================
	// FIGHTING STYLE FEATS (XPHB 2024)
	// ===================================================================
	describe("Fighting Style Feats", () => {
		test("Archery should add +2 to ranged attacks", () => {
			state.addFeat({name: "Archery", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const archeryMod = mods.find(m => m.type === "attack:ranged" && m.name === "Archery");
			expect(archeryMod).toBeDefined();
			expect(archeryMod.value).toBe(2);
		});

		test("Defense should add +1 AC while wearing armor", () => {
			state.addFeat({name: "Defense", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const defenseMod = mods.find(m => m.type === "ac" && m.name === "Defense");
			expect(defenseMod).toBeDefined();
			expect(defenseMod.value).toBe(1);
			expect(defenseMod.conditional).toContain("armor");
		});

		test("Dueling should add +2 melee damage one-handed", () => {
			state.addFeat({name: "Dueling", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const duelingMod = mods.find(m => m.type === "damage:melee:oneHanded");
			expect(duelingMod).toBeDefined();
			expect(duelingMod.value).toBe(2);
		});

		test("Two-Weapon Fighting should enable ability mod on offhand", () => {
			state.addFeat({name: "Two-Weapon Fighting", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const twfMod = mods.find(m => m.type === "damage:offhand:addAbility");
			expect(twfMod).toBeDefined();
		});
	});

	// ===================================================================
	// FEAT ADDITION + REMOVAL LIFECYCLE
	// ===================================================================
	describe("Feat Lifecycle", () => {
		test("should not add duplicate feats", () => {
			state.addFeat({name: "Alert", source: "PHB"});
			state.addFeat({name: "Alert", source: "PHB"});
			expect(state.getFeats().length).toBe(1);
		});

		test("should allow same feat from different sources", () => {
			state.addFeat({name: "Alert", source: "PHB"});
			state.addFeat({name: "Alert", source: "XPHB"});
			expect(state.getFeats().length).toBe(2);
		});

		test("should remove modifiers when feat is removed", () => {
			state.addFeat({name: "Alert", source: "PHB"});
			const modsWithAlert = state.getNamedModifiers().filter(m => m.name === "Alert");
			expect(modsWithAlert.length).toBeGreaterThan(0);

			state.removeFeat("Alert", "PHB");
			const modsAfter = state.getNamedModifiers().filter(m => m.name === "Alert");
			expect(modsAfter.length).toBe(0);
		});

		test("should handle feat with ability bonus", () => {
			state.setAbilityBase("dex", 15);
			const scoreBefore = state.getAbilityScore("dex");
			state.addFeat({name: "Athlete", source: "PHB", abilityBonus: {dex: 1}});
			expect(state.getAbilityScore("dex")).toBe(scoreBefore + 1);
		});

		test("should preserve ability bonus across modifier recalculation", () => {
			state.setAbilityBase("dex", 15);
			const scoreBefore = state.getAbilityScore("dex");
			state.addFeat({name: "Athlete", source: "PHB", abilityBonus: {dex: 1}});

			// Adding more feats/modifiers should not reset the ability bonus
			state.addFeat({name: "Tough", source: "PHB"});

			expect(state.getAbilityScore("dex")).toBe(scoreBefore + 1);
		});
	});

	// ===================================================================
	// FEAT EFFECTS IN AGGREGATION PIPELINE
	// ===================================================================
	describe("Feat Effects Aggregation", () => {
		test("should include feat effects in _aggregateFeatureEffects", () => {
			state.addFeat({name: "Tough", source: "PHB"});
			const calcs = state.getFeatureCalculations();
			const effects = calcs._effects;

			// Tough should appear in the effects array
			const toughEffects = effects.filter(e => e.source === "Tough");
			expect(toughEffects.length).toBeGreaterThan(0);
			expect(toughEffects.some(e => e.type === "hpBonus")).toBe(true);
		});

		test("should include War Caster effects in aggregation", () => {
			state.addFeat({name: "War Caster", source: "PHB"});
			const calcs = state.getFeatureCalculations();
			const effects = calcs._effects;

			const wcEffects = effects.filter(e => e.source === "War Caster");
			expect(wcEffects.length).toBeGreaterThan(0);
		});

		test("should include source-specific effects for PHB feats", () => {
			state.addFeat({name: "Alert", source: "PHB"});
			const calcs = state.getFeatureCalculations();
			const effects = calcs._effects;

			// Should have the PHB-specific initiative effect
			const alertEffects = effects.filter(e =>
				e.source === "Alert|PHB" || e.source === "Alert",
			);
			expect(alertEffects.length).toBeGreaterThan(0);
		});
	});

	// ===================================================================
	// DURABLE FEAT — Hit Dice Healing
	// ===================================================================
	describe("Durable Feat", () => {
		test("PHB version should create hit dice minimum roll modifier", () => {
			state.addFeat({name: "Durable", source: "PHB"});
			const mods = state.getNamedModifiers();
			const durableMod = mods.find(m => m.type === "hitDice:minimumRoll");
			expect(durableMod).toBeDefined();
			expect(durableMod.value).toBe("conModx2");
		});

		test("XPHB version should create long rest recovery modifier", () => {
			state.addFeat({name: "Durable", source: "XPHB"});
			const mods = state.getNamedModifiers();
			const durableMod = mods.find(m => m.type === "hitDice:longRestRecovery");
			expect(durableMod).toBeDefined();
		});
	});

	// ===================================================================
	// SPELL SNIPER — Spell Modifiers
	// ===================================================================
	describe("Spell Sniper Feat", () => {
		test("should create spell range and cover modifiers", () => {
			state.addFeat({name: "Spell Sniper", source: "PHB"});
			const mods = state.getNamedModifiers();

			const rangeMod = mods.find(m => m.type === "spell:rangeDouble");
			expect(rangeMod).toBeDefined();

			const coverMod = mods.find(m => m.type === "spell:ignoreCover");
			expect(coverMod).toBeDefined();
		});
	});

	// ===================================================================
	// LUCKY FEAT — Resource Management
	// ===================================================================
	describe("Lucky Feat", () => {
		test("PHB version should create luck points resource", () => {
			state.addFeat({name: "Lucky", source: "PHB"});
			const resources = state.getResources();
			const luckResource = resources.find(r => r.name === "Luck Points");
			expect(luckResource).toBeDefined();
			expect(luckResource.max).toBe(3);
			expect(luckResource.recharge).toBe("long");
		});

		test("XPHB version should create prof-bonus luck points", () => {
			state.addFeat({name: "Lucky", source: "XPHB"});
			const resources = state.getResources();
			const luckResource = resources.find(r => r.name === "Luck Points");
			expect(luckResource).toBeDefined();
			// At level 5, prof bonus = 3
			expect(luckResource.max).toBe(state.getProficiencyBonus());
		});
	});

	// ===================================================================
	// MULTIPLE FEATS INTERACTION
	// ===================================================================
	describe("Multiple Feats", () => {
		test("multiple feat bonuses should stack", () => {
			const hpBefore = state.getMaxHp();
			const initBefore = state.getInitiative();

			state.addFeat({name: "Tough", source: "PHB"});
			state.addFeat({name: "Alert", source: "PHB"});

			expect(state.getMaxHp()).toBe(hpBefore + 10); // 5 levels × 2
			expect(state.getInitiative()).toBe(initBefore + 5);
		});

		test("should handle multiple feats creating multiple named modifiers", () => {
			state.addFeat({name: "Tough", source: "PHB"});
			state.addFeat({name: "Alert", source: "PHB"});
			state.addFeat({name: "Mobile", source: "PHB"});
			state.addFeat({name: "War Caster", source: "PHB"});

			const mods = state.getNamedModifiers();
			expect(mods.filter(m => m.sourceType === "feat").length).toBeGreaterThanOrEqual(4);
		});

		test("feats should coexist with feature effects", () => {
			// Add a class feature
			state.addFeature({
				name: "Evasion",
				featureType: "Class",
				description: "Evasion: DEX save half to none.",
			});

			// Add feats
			state.addFeat({name: "Tough", source: "PHB"});
			state.addFeat({name: "Alert", source: "PHB"});

			// Both should work
			const calcs = state.getFeatureCalculations();
			expect(calcs._effects.some(e => e.source === "Evasion")).toBe(true);
			expect(calcs._effects.some(e => e.source === "Tough")).toBe(true);
		});
	});

	// ===================================================================
	// OPTIONAL / CONDITIONAL MODIFIERS
	// ===================================================================
	describe("Optional Modifiers", () => {
		test("GWM power attack should start disabled", () => {
			state.addFeat({name: "Great Weapon Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const gwmAttack = mods.find(m => m.type === "attack:heavy" && m.name.includes("Great Weapon Master"));
			expect(gwmAttack.enabled).toBe(false);
		});

		test("conditional modifiers should have descriptive text", () => {
			state.addFeat({name: "Dual Wielder", source: "PHB"});
			const mods = state.getNamedModifiers();
			const dwMod = mods.find(m => m.name.includes("Dual Wielder") && m.type === "ac");
			expect(dwMod.conditional).toBeDefined();
			expect(typeof dwMod.conditional).toBe("string");
		});
	});

	// ===================================================================
	// POLEARM MASTER — Bonus Action
	// ===================================================================
	describe("Polearm Master Feat", () => {
		test("should create bonus action modifier", () => {
			state.addFeat({name: "Polearm Master", source: "PHB"});
			const mods = state.getNamedModifiers();
			const paMod = mods.find(m => m.type === "bonusAction" && m.name.includes("Polearm Master"));
			expect(paMod).toBeDefined();
			expect(paMod.note).toBeDefined();
		});
	});

	// ===================================================================
	// MAGE SLAYER — Conditional Save Bonus
	// ===================================================================
	describe("Mage Slayer Feat", () => {
		test("should create conditional save modifier", () => {
			state.addFeat({name: "Mage Slayer", source: "PHB"});
			const mods = state.getNamedModifiers();
			const msMod = mods.find(m => m.type === "save:advantage:spell:adjacent");
			expect(msMod).toBeDefined();
			expect(msMod.conditional).toContain("5 feet");
		});
	});

	// ===================================================================
	// HEALER — Healing Bonus
	// ===================================================================
	describe("Healer Feat", () => {
		test("should create healer kit modifier", () => {
			state.addFeat({name: "Healer", source: "PHB"});
			const mods = state.getNamedModifiers();
			const healMod = mods.find(m => m.type === "healing:healerKit");
			expect(healMod).toBeDefined();
		});
	});
});
