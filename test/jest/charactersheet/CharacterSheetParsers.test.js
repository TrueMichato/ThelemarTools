/**
 * Character Sheet Parsers - Unit Tests
 * Tests for FeatureUsesParser, NaturalWeaponParser, SpellGrantParser, FeatureModifierParser
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const FeatureUsesParser = globalThis.FeatureUsesParser;
const NaturalWeaponParser = globalThis.NaturalWeaponParser;
const SpellGrantParser = globalThis.SpellGrantParser;
const FeatureModifierParser = globalThis.FeatureModifierParser;

// ==========================================================================
// FeatureUsesParser
// ==========================================================================
describe("FeatureUsesParser", () => {
	// Mock ability mod getter
	const mockGetAbilityMod = (ability) => {
		const mods = {str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 4};
		return mods[ability.toLowerCase()] || 0;
	};

	// Mock proficiency bonus getter
	const mockGetProfBonus = () => 3;

	describe("parseUses", () => {
		it("should parse 'once per long rest' as 1 use with long rest recharge", () => {
			const text = "You can use this feature once. You regain the ability to do so when you finish a long rest.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(1);
			expect(result.recharge).toBe("long");
		});

		it("should parse 'twice per short or long rest'", () => {
			const text = "You can use this feature twice. You regain all expended uses when you finish a short or long rest.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(2);
			expect(result.recharge).toBe("short");
		});

		it("should parse 'proficiency bonus times per long rest'", () => {
			const text = "You can use this feature a number of times equal to your proficiency bonus. You regain all expended uses when you finish a long rest.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(3); // proficiency bonus
			expect(result.recharge).toBe("long");
		});

		it("should parse 'Charisma modifier times'", () => {
			const text = "You can use this feature a number of times equal to your Charisma modifier (minimum of once). You regain all expended uses when you finish a long rest.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(4); // Charisma modifier
			expect(result.recharge).toBe("long");
		});

		it("should parse '1 + Constitution modifier times'", () => {
			const text = "You can use this feature 1 + your Constitution modifier times. You regain all uses after a long rest.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(3); // 1 + 2 CON
		});

		it("should return null for features without uses", () => {
			const text = "You gain proficiency in heavy armor.";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).toBeNull();
		});

		it("should handle HTML in text", () => {
			const text = "<p>You can use this feature <strong>once</strong>. You regain the ability when you finish a <em>long rest</em>.</p>";
			const result = FeatureUsesParser.parseUses(text, mockGetAbilityMod, mockGetProfBonus);
			expect(result).not.toBeNull();
			expect(result.max).toBe(1);
		});
	});

	describe("hasLimitedUses", () => {
		it("should return true for features with uses", () => {
			expect(FeatureUsesParser.hasLimitedUses("You can use this once per long rest.")).toBe(true);
			expect(FeatureUsesParser.hasLimitedUses("Regain all uses when you finish a short rest.")).toBe(true);
		});

		it("should return false for features without uses", () => {
			expect(FeatureUsesParser.hasLimitedUses("You gain proficiency in athletics.")).toBe(false);
		});
	});
});

// ==========================================================================
// NaturalWeaponParser
// ==========================================================================
describe("NaturalWeaponParser", () => {
	describe("parseNaturalWeapon", () => {
		it("should parse bite attack as natural weapon", () => {
			// Use realistic D&D text that mentions "natural weapon"
			const text = "Your fanged maw is a natural weapon, which you can use to make unarmed strikes. If you hit with it, you deal piercing damage equal to 1d6 + your Strength modifier.";
			const result = NaturalWeaponParser.parseNaturalWeapon(text, "Bite");
			expect(result).not.toBeNull();
			expect(result.name).toBe("Bite");
			expect(result.damage).toContain("1d6");
			expect(result.damageType).toBe("piercing");
		});

		it("should parse unarmed strike enhancement", () => {
			const text = "You have talons that you can use to make unarmed strikes. When you hit with them, the strike deals 1d6 + your Strength modifier slashing damage.";
			const result = NaturalWeaponParser.parseNaturalWeapon(text, "Talons");
			expect(result).not.toBeNull();
			expect(result.damageType).toBe("slashing");
		});

		it("should parse melee weapon attack description", () => {
			const text = "You can make a melee weapon attack with your claws. On a hit, the target takes 1d4 slashing damage.";
			const result = NaturalWeaponParser.parseNaturalWeapon(text, "Claws");
			expect(result).not.toBeNull();
			expect(result.damage).toContain("1d4");
		});

		it("should return null for non-weapon features", () => {
			const text = "You gain darkvision out to 60 feet.";
			const result = NaturalWeaponParser.parseNaturalWeapon(text, "Darkvision");
			expect(result).toBeNull();
		});
	});

	describe("isNaturalWeapon", () => {
		it("should identify natural weapon text", () => {
			expect(NaturalWeaponParser.isNaturalWeapon("Your fanged maw is a natural weapon dealing 1d6 damage")).toBe(true);
			expect(NaturalWeaponParser.isNaturalWeapon("You can use to make unarmed strikes dealing 1d4 damage")).toBe(true);
			expect(NaturalWeaponParser.isNaturalWeapon("Make a melee weapon attack with 1d6 slashing damage")).toBe(true);
		});

		it("should not identify non-weapon text", () => {
			expect(NaturalWeaponParser.isNaturalWeapon("gain proficiency")).toBe(false);
		});
	});
});

// ==========================================================================
// SpellGrantParser
// ==========================================================================
describe("SpellGrantParser", () => {
	describe("parseAdditionalSpells", () => {
		it("should parse innate spell with daily uses at character level", () => {
			// Actual 5etools format: level-keyed with daily uses
			const additionalSpells = [
				{
					innate: {
						"1": {
							daily: {
								"1": ["misty step"],
							},
						},
					},
				},
			];
			const result = SpellGrantParser.parseAdditionalSpells(additionalSpells, "Fey Ancestry");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Misty Step");
			expect(result[0].usesMax).toBe(1);
		});

		it("should parse at-will innate spells (array at level)", () => {
			// At-will spells are direct arrays at the level key
			const additionalSpells = [
				{
					innate: {
						"1": ["detect magic"],
					},
				},
			];
			const result = SpellGrantParser.parseAdditionalSpells(additionalSpells, "Magic Sense");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Detect Magic");
			expect(result[0].atWill).toBe(true);
		});

		it("should parse known/prepared spells", () => {
			const additionalSpells = [
				{
					known: {
						"1": ["mage hand"],
						"3": ["invisibility"],
					},
				},
			];
			const result = SpellGrantParser.parseAdditionalSpells(additionalSpells, "Magical Training");
			expect(result.length).toBeGreaterThanOrEqual(2);
		});

		it("should handle spell with source like 'spell|source'", () => {
			const additionalSpells = [
				{
					innate: {
						"1": {
							daily: {
								"1": ["cure wounds|phb"],
							},
						},
					},
				},
			];
			const result = SpellGrantParser.parseAdditionalSpells(additionalSpells, "Healing Touch");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Cure Wounds");
			expect(result[0].source).toBe("PHB");
		});

		it("should return empty array for null input", () => {
			expect(SpellGrantParser.parseAdditionalSpells(null, "Test")).toEqual([]);
			expect(SpellGrantParser.parseAdditionalSpells(undefined, "Test")).toEqual([]);
		});
	});

	describe("parseSpellsFromText", () => {
		it("should extract spell names from text", () => {
			const text = "You know the {@spell mage hand} cantrip. At 3rd level, you can cast {@spell invisibility} once per long rest.";
			const result = SpellGrantParser.parseSpellsFromText(text, "Magic");
			expect(result.length).toBeGreaterThanOrEqual(1);
		});

		it("should return empty array for text without spells", () => {
			const text = "You gain proficiency in stealth.";
			const result = SpellGrantParser.parseSpellsFromText(text, "Sneaky");
			expect(result).toEqual([]);
		});
	});

	describe("grantsSpells", () => {
		it("should detect spell-granting text with @spell tags", () => {
			expect(SpellGrantParser.grantsSpells("You know the {@spell mage hand} cantrip")).toBe(true);
			expect(SpellGrantParser.grantsSpells("You can cast {@spell invisibility}")).toBe(true);
		});

		it("should return false for non-spell text", () => {
			expect(SpellGrantParser.grantsSpells("You gain darkvision")).toBe(false);
		});
	});
});

// ==========================================================================
// FeatureModifierParser
// ==========================================================================
describe("FeatureModifierParser", () => {
	// Helper to find modifier of specific type in result array
	const findModifier = (result, typePattern) => {
		if (!Array.isArray(result)) return null;
		return result.find(m => m.type && m.type.includes(typePattern));
	};

	describe("parseModifiers", () => {
		it("should parse AC bonus", () => {
			const text = "You gain a +1 bonus to AC.";
			const result = FeatureModifierParser.parseModifiers(text, "Ring of Protection");
			// Implementation returns array of modifiers
			expect(Array.isArray(result)).toBe(true);
			const acMod = findModifier(result, "ac");
			expect(acMod).toBeDefined();
			expect(acMod.value).toBe(1);
		});

		it("should parse saving throw bonus", () => {
			const text = "You gain a +1 bonus to all saving throws.";
			const result = FeatureModifierParser.parseModifiers(text, "Cloak of Protection");
			expect(Array.isArray(result)).toBe(true);
			const saveMod = findModifier(result, "save");
			expect(saveMod).toBeDefined();
		});

		it("should parse walking speed increase", () => {
			const text = "Your walking speed increases by 10 feet.";
			const result = FeatureModifierParser.parseModifiers(text, "Mobile");
			expect(Array.isArray(result)).toBe(true);
			const speedMod = findModifier(result, "speed:walk");
			expect(speedMod).toBeDefined();
			expect(speedMod.value).toBe(10);
		});

		it("should parse darkvision grant", () => {
			const text = "You gain darkvision out to 60 feet.";
			const result = FeatureModifierParser.parseModifiers(text, "Darkvision");
			expect(Array.isArray(result)).toBe(true);
			const senseMod = findModifier(result, "sense:darkvision");
			expect(senseMod).toBeDefined();
			expect(senseMod.value).toBe(60);
		});

		it("should parse attack bonus", () => {
			const text = "You gain a +2 bonus to attack rolls with this weapon.";
			const result = FeatureModifierParser.parseModifiers(text, "Magic Weapon");
			expect(Array.isArray(result)).toBe(true);
			const attackMod = findModifier(result, "attack");
			expect(attackMod).toBeDefined();
		});

		it("should parse damage bonus", () => {
			const text = "You gain a +2 bonus to damage rolls with this weapon.";
			const result = FeatureModifierParser.parseModifiers(text, "Magic Weapon");
			expect(Array.isArray(result)).toBe(true);
			const damageMod = findModifier(result, "damage");
			expect(damageMod).toBeDefined();
		});

		it("should return empty array for text without numeric modifiers", () => {
			const text = "You gain proficiency in one skill of your choice.";
			const result = FeatureModifierParser.parseModifiers(text, "Skilled");
			expect(Array.isArray(result)).toBe(true);
			// May have proficiency modifiers but no numeric bonuses
		});

		it("should parse initiative bonus", () => {
			const text = "You gain a +5 bonus to initiative.";
			const result = FeatureModifierParser.parseModifiers(text, "Alert");
			expect(Array.isArray(result)).toBe(true);
			const initMod = findModifier(result, "initiative");
			expect(initMod).toBeDefined();
			expect(initMod.value).toBe(5);
		});

		it("should parse spell save DC bonus", () => {
			const text = "Your spell save DC increases by 1.";
			const result = FeatureModifierParser.parseModifiers(text, "Robe of Archmagi");
			expect(Array.isArray(result)).toBe(true);
			const spellDcMod = findModifier(result, "spellDc");
			expect(spellDcMod).toBeDefined();
		});
	});

	// R27 follow-up: a skill bonus restricted to specific creature types (e.g. the
	// Warlock "Whiff of the Beyond" specialty) must be parsed as CONDITIONAL so it is
	// gated (per-roll opt-in) instead of applied to every check.
	describe("creature-restricted skill bonuses are conditional", () => {
		const findPerception = (result) => result.filter(m => typeof m.type === "string" && m.type.startsWith("skill:perception"));

		const WHIFF_FULL = "You automatically sense when an aberration, celestial, elemental, fey, fiend, or undead has been within 30 feet of you in the past 24 hours. You also gain a bonus to Wisdom ({@skill Perception}) checks equal to your proficiency bonus and have advantage on checks to track these creature types.";
		const WHIFF_BONUS_ONLY = "You also gain a bonus to Wisdom ({@skill Perception}) checks equal to your proficiency bonus and have advantage on checks to track these creature types.";

		it("gates the Whiff of the Beyond Perception bonus (full text) with a creature-type condition", () => {
			const result = FeatureModifierParser.parseModifiers(WHIFF_FULL, "Whiff of the Beyond");
			const perc = findPerception(result);
			expect(perc.length).toBeGreaterThan(0);
			// No emitter may leak an unconditional Perception bonus
			expect(perc.some(m => !m.conditional)).toBe(false);
			expect(perc.every(m => m.proficiencyBonus === true)).toBe(true);
			expect(perc.some(m => /aberration|celestial|fey|fiend|undead|creature types/i.test(m.conditional))).toBe(true);
		});

		it("gates the Whiff bonus even when only the bonus sentence is present", () => {
			const result = FeatureModifierParser.parseModifiers(WHIFF_BONUS_ONLY, "Whiff of the Beyond");
			const perc = findPerception(result);
			expect(perc.length).toBeGreaterThan(0);
			expect(perc.some(m => !m.conditional)).toBe(false);
		});

		it("does NOT gate a generic proficiency-bonus skill (no creature restriction)", () => {
			const text = "You gain a bonus to Dexterity ({@skill Stealth}) checks equal to your proficiency bonus.";
			const result = FeatureModifierParser.parseModifiers(text, "Generic Skill Feature");
			const stealth = result.filter(m => typeof m.type === "string" && m.type.startsWith("skill:stealth"));
			expect(stealth.length).toBeGreaterThan(0);
			// A genuinely unconditional bonus must stay unconditional (not wrongly gated)
			expect(stealth.some(m => !m.conditional)).toBe(true);
		});
	});

	describe("_extractCreatureRestriction", () => {
		it("returns a creature-type condition for 'these creature types' phrasing", () => {
			const out = FeatureModifierParser._extractCreatureRestriction("...advantage on checks to track these creature types.");
			expect(out).toBeTruthy();
			expect(out).toMatch(/creature types/i);
		});

		it("returns a tracking condition for explicit creature types", () => {
			const out = FeatureModifierParser._extractCreatureRestriction("You have advantage on Wisdom (Survival) checks to track fiends and undead.");
			expect(out).toBeTruthy();
			expect(out).toMatch(/track/i);
		});

		it("returns null when there is no creature/tracking restriction", () => {
			expect(FeatureModifierParser._extractCreatureRestriction("You gain a bonus to Stealth checks equal to your proficiency bonus.")).toBeNull();
			expect(FeatureModifierParser._extractCreatureRestriction("")).toBeNull();
			expect(FeatureModifierParser._extractCreatureRestriction(null)).toBeNull();
		});
	});
});
