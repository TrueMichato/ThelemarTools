import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("CharacterSheetStatBreakdowns", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ─── Save Breakdown ───────────────────────────────────────

	describe("getSaveBreakdown", () => {
		it("should return breakdown with ability modifier", () => {
			state._data.abilities.dex = 16; // +3 mod
			const breakdown = state.getSaveBreakdown("dex");
			expect(breakdown.total).toBe(3);
			expect(breakdown.components.find(c => c.type === "ability")).toBeTruthy();
			expect(breakdown.components.find(c => c.type === "ability").value).toBe(3);
		});

		it("should include proficiency bonus when proficient", () => {
			state._data.abilities.wis = 14; // +2
			state.addSaveProficiency("wis");
			const breakdown = state.getSaveBreakdown("wis");
			const profComp = breakdown.components.find(c => c.type === "proficiency");
			expect(profComp).toBeTruthy();
			expect(profComp.value).toBe(state.getProficiencyBonus());
			expect(breakdown.total).toBe(2 + state.getProficiencyBonus());
		});

		it("should not include proficiency when not proficient", () => {
			state._data.abilities.str = 14;
			const breakdown = state.getSaveBreakdown("str");
			expect(breakdown.components.find(c => c.type === "proficiency")).toBeFalsy();
		});

		it("should include custom modifiers", () => {
			state._data.abilities.con = 10;
			state._data.customModifiers.savingThrows.con = 2;
			const breakdown = state.getSaveBreakdown("con");
			const customComp = breakdown.components.find(c => c.type === "custom");
			expect(customComp).toBeTruthy();
			expect(customComp.value).toBe(2);
		});

		it("should include item bonuses", () => {
			state._data.abilities.dex = 10;
			state.setItemBonuses({savingThrow: 1});
			const breakdown = state.getSaveBreakdown("dex");
			const itemComp = breakdown.components.find(c => c.type === "item");
			expect(itemComp).toBeTruthy();
			expect(itemComp.value).toBe(1);
		});

		it("total should match getSaveMod result", () => {
			state._data.abilities.dex = 16;
			state.addSaveProficiency("dex");
			state._data.customModifiers.savingThrows.dex = 1;
			state.setItemBonuses({savingThrow: 1});
			const breakdown = state.getSaveBreakdown("dex");
			expect(breakdown.total).toBe(state.getSaveMod("dex"));
		});

		it("should include all six abilities correctly", () => {
			const abilities = ["str", "dex", "con", "int", "wis", "cha"];
			abilities.forEach(abl => {
				state._data.abilities[abl] = 14;
			});
			abilities.forEach(abl => {
				const breakdown = state.getSaveBreakdown(abl);
				expect(breakdown.total).toBe(state.getSaveMod(abl));
			});
		});
	});

	// ─── Skill Breakdown ──────────────────────────────────────

	describe("getSkillBreakdown", () => {
		it("should return breakdown with ability modifier for athletics", () => {
			state._data.abilities.str = 16;
			const breakdown = state.getSkillBreakdown("athletics");
			const abilityComp = breakdown.components.find(c => c.type === "ability");
			expect(abilityComp).toBeTruthy();
			expect(abilityComp.value).toBe(3);
			expect(breakdown.ability).toBe("str");
		});

		it("should include proficiency bonus", () => {
			state._data.abilities.dex = 14;
			state.setSkillProficiency("stealth", 1);
			const breakdown = state.getSkillBreakdown("stealth");
			const profComp = breakdown.components.find(c => c.type === "proficiency");
			expect(profComp).toBeTruthy();
			expect(profComp.name).toBe("Proficiency");
		});

		it("should show expertise at 2x", () => {
			state._data.abilities.dex = 14;
			state.setSkillProficiency("stealth", 2);
			const breakdown = state.getSkillBreakdown("stealth");
			const profComp = breakdown.components.find(c => c.type === "proficiency");
			expect(profComp).toBeTruthy();
			expect(profComp.name).toContain("Expertise");
			expect(profComp.value).toBe(2 * state.getProficiencyBonus());
		});

		it("total should match getSkillMod result", () => {
			state._data.abilities.int = 18;
			state.setSkillProficiency("arcana", 2);
			const breakdown = state.getSkillBreakdown("arcana");
			expect(breakdown.total).toBe(state.getSkillMod("arcana"));
		});

		it("should handle homebrew skills correctly", () => {
			state._data.abilities.wis = 16;
			const breakdown = state.getSkillBreakdown("cooking");
			expect(breakdown.ability).toBe("wis");
			expect(breakdown.total).toBe(state.getSkillMod("cooking"));
		});

		it("should return ability field with resolved ability", () => {
			const breakdown = state.getSkillBreakdown("athletics");
			expect(breakdown.ability).toBe("str");
		});
	});

	// ─── Speed Breakdown ──────────────────────────────────────

	describe("getSpeedBreakdown", () => {
		it("should return base walking speed of 30 ft by default", () => {
			const breakdown = state.getSpeedBreakdown("walk");
			const baseComp = breakdown.components.find(c => c.type === "base");
			expect(baseComp).toBeTruthy();
			expect(baseComp.value).toBe(30);
			expect(breakdown.total).toBe(30);
		});

		it("should include custom speed modifier", () => {
			state._data.customModifiers.speed.walk = 10;
			const breakdown = state.getSpeedBreakdown("walk");
			const customComp = breakdown.components.find(c => c.type === "custom");
			expect(customComp).toBeTruthy();
			expect(customComp.value).toBe(10);
			expect(breakdown.total).toBe(40);
		});

		it("should include unarmored movement bonus for Monk", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 6});
			const breakdown = state.getSpeedBreakdown("walk");
			const featureComp = breakdown.components.find(c => c.type === "feature" && c.name === "Unarmored Movement");
			expect(featureComp).toBeTruthy();
			expect(featureComp.value).toBe(15); // Monk level 6 = +15
		});

		it("should return empty breakdown for 0-speed movement types", () => {
			const breakdown = state.getSpeedBreakdown("fly");
			expect(breakdown.total).toBe(0);
			expect(breakdown.components).toEqual([]);
		});

		it("should show speed from race", () => {
			state.setSpeed("walk", 35); // Wood Elf speed
			const breakdown = state.getSpeedBreakdown("walk");
			expect(breakdown.components.find(c => c.type === "base").value).toBe(35);
			expect(breakdown.total).toBe(35);
		});

		it("should include exhaustion penalty", () => {
			state.setExhaustion(2);
			state.setExhaustionRules("2024");
			const breakdown = state.getSpeedBreakdown("walk");
			const penaltyComp = breakdown.components.find(c => c.type === "penalty");
			expect(penaltyComp).toBeTruthy();
			expect(penaltyComp.value).toBeLessThan(0);
		});

		it("total should approximately match getWalkSpeed", () => {
			state.setSpeed("walk", 30);
			state._data.customModifiers.speed.walk = 5;
			const breakdown = state.getSpeedBreakdown("walk");
			expect(breakdown.total).toBe(35);
		});
	});

	// ─── Initiative Breakdown ─────────────────────────────────

	describe("getInitiativeBreakdown", () => {
		it("should include DEX modifier", () => {
			state._data.abilities.dex = 16;
			const breakdown = state.getInitiativeBreakdown();
			const dexComp = breakdown.components.find(c => c.type === "ability");
			expect(dexComp).toBeTruthy();
			expect(dexComp.value).toBe(3);
		});

		it("should include custom initiative modifier", () => {
			state._data.abilities.dex = 10;
			state.setCustomModifier("initiative", 5);
			const breakdown = state.getInitiativeBreakdown();
			const customComp = breakdown.components.find(c => c.type === "custom");
			expect(customComp).toBeTruthy();
			expect(customComp.value).toBe(5);
		});

		it("total should match getInitiative", () => {
			state._data.abilities.dex = 16;
			state.setCustomModifier("initiative", 2);
			const breakdown = state.getInitiativeBreakdown();
			expect(breakdown.total).toBe(state.getInitiative());
		});

		it("should return empty components list for 0 modifier with DEX 10", () => {
			state._data.abilities.dex = 10;
			const breakdown = state.getInitiativeBreakdown();
			expect(breakdown.total).toBe(0);
			expect(breakdown.components.length).toBe(0);
		});
	});

	// ─── Spell Attack Breakdown ───────────────────────────────

	describe("getSpellAttackBreakdown", () => {
		it("should return null when no spellcasting ability", () => {
			const breakdown = state.getSpellAttackBreakdown();
			expect(breakdown).toBeNull();
		});

		it("should include proficiency and ability mod for a caster", () => {
			state.setSpellcastingAbility("cha");
			state._data.abilities.cha = 18;
			const breakdown = state.getSpellAttackBreakdown();
			expect(breakdown).not.toBeNull();
			expect(breakdown.components.find(c => c.type === "proficiency")).toBeTruthy();
			expect(breakdown.components.find(c => c.type === "ability").value).toBe(4);
			expect(breakdown.total).toBe(state.getSpellAttackBonus());
		});

		it("should use class-specific ability when className given", () => {
			state._data.abilities.int = 20;
			const breakdown = state.getSpellAttackBreakdown("Wizard");
			expect(breakdown).not.toBeNull();
			expect(breakdown.components.find(c => c.type === "ability").value).toBe(5);
		});

		it("should include item bonuses", () => {
			state.setSpellcastingAbility("wis");
			state._data.abilities.wis = 10;
			state.setItemBonuses({spellAttack: 2});
			const breakdown = state.getSpellAttackBreakdown();
			const itemComp = breakdown.components.find(c => c.type === "item");
			expect(itemComp).toBeTruthy();
			expect(itemComp.value).toBe(2);
		});
	});

	// ─── Spell DC Breakdown ───────────────────────────────────

	describe("getSpellDcBreakdown", () => {
		it("should return null when no spellcasting ability", () => {
			const breakdown = state.getSpellDcBreakdown();
			expect(breakdown).toBeNull();
		});

		it("should include base 8 + proficiency + ability mod", () => {
			state.setSpellcastingAbility("cha");
			state._data.abilities.cha = 16;
			const breakdown = state.getSpellDcBreakdown();
			expect(breakdown).not.toBeNull();
			expect(breakdown.components.find(c => c.type === "base").value).toBe(8);
			expect(breakdown.components.find(c => c.type === "proficiency")).toBeTruthy();
			expect(breakdown.components.find(c => c.type === "ability").value).toBe(3);
			expect(breakdown.total).toBe(state.getSpellSaveDc());
		});

		it("should use class-specific ability", () => {
			state._data.abilities.wis = 18;
			const breakdown = state.getSpellDcBreakdown("Cleric");
			expect(breakdown).not.toBeNull();
			expect(breakdown.total).toBe(8 + state.getProficiencyBonus() + 4);
		});
	});

	// ─── Component Shape Validation ───────────────────────────

	describe("Component structure", () => {
		it("all breakdown methods return {total, components} format", () => {
			state._data.abilities.dex = 14;
			state.addSaveProficiency("dex");

			const breakdowns = [
				state.getSaveBreakdown("dex"),
				state.getSkillBreakdown("stealth"),
				state.getSpeedBreakdown("walk"),
				state.getInitiativeBreakdown(),
			];

			breakdowns.forEach(bd => {
				expect(bd).toHaveProperty("total");
				expect(bd).toHaveProperty("components");
				expect(Array.isArray(bd.components)).toBe(true);
			});
		});

		it("each component has required fields", () => {
			state._data.abilities.str = 16;
			state.addSaveProficiency("str");
			const breakdown = state.getSaveBreakdown("str");
			breakdown.components.forEach(comp => {
				expect(comp).toHaveProperty("type");
				expect(comp).toHaveProperty("name");
				expect(comp).toHaveProperty("value");
				expect(comp).toHaveProperty("icon");
				expect(typeof comp.type).toBe("string");
				expect(typeof comp.name).toBe("string");
				expect(typeof comp.value).toBe("number");
				expect(typeof comp.icon).toBe("string");
			});
		});

		it("breakdown totals are consistent with sum of components", () => {
			state._data.abilities.dex = 16;
			state.addSaveProficiency("dex");
			state._data.customModifiers.savingThrows.dex = 1;

			const breakdown = state.getSaveBreakdown("dex");
			const summedTotal = breakdown.components.reduce((s, c) => s + c.value, 0);
			expect(breakdown.total).toBe(summedTotal);
		});
	});

	// ─── Phase 5.6: canonical vs effective ─────────────────────

	describe("Canonical vs effective breakdown (Phase 5.6 dual display)", () => {
		describe("getSaveBreakdown.isCanonical", () => {
			it("flags ability/proficiency as canonical, custom/item/state/stance as effective", () => {
				state._data.abilities.dex = 16; // +3
				state.addSaveProficiency("dex");
				state._data.customModifiers.savingThrows.dex = 1;
				state.setItemBonuses({savingThrow: 1});

				const breakdown = state.getSaveBreakdown("dex");
				const byType = Object.fromEntries(breakdown.components.map(c => [c.type, c]));

				expect(byType.ability?.isCanonical).toBe(true);
				expect(byType.proficiency?.isCanonical).toBe(true);
				expect(byType.custom?.isCanonical).toBe(false);
				expect(byType.item?.isCanonical).toBe(false);
			});

			it("exposes canonical field = sum of canonical components", () => {
				state._data.abilities.wis = 16; // +3
				state.addSaveProficiency("wis");
				state._data.customModifiers.savingThrows.wis = 2;

				const breakdown = state.getSaveBreakdown("wis");
				expect(breakdown.canonical).toBe(3 + state.getProficiencyBonus());
				expect(breakdown.total).toBe(3 + state.getProficiencyBonus() + 2);
			});

			it("canonical equals total when no effective-only mods are present", () => {
				state._data.abilities.con = 14; // +2
				state.addSaveProficiency("con");

				const breakdown = state.getSaveBreakdown("con");
				expect(breakdown.canonical).toBe(breakdown.total);
			});
		});

		describe("getSkillBreakdown.isCanonical", () => {
			it("flags ability/proficiency/feature/lore as canonical, custom/item as effective", () => {
				state._data.abilities.dex = 16;
				state.setSkillProficiency("stealth", 1);
				state._data.customModifiers.skills.stealth = 1;
				state.setItemBonuses({abilityCheck: 1});

				const breakdown = state.getSkillBreakdown("stealth");
				const byType = Object.fromEntries(breakdown.components.map(c => [c.type, c]));

				expect(byType.ability?.isCanonical).toBe(true);
				expect(byType.proficiency?.isCanonical).toBe(true);
				expect(byType.custom?.isCanonical).toBe(false);
				expect(byType.item?.isCanonical).toBe(false);
			});

			it("exposes canonical field excluding custom + item", () => {
				state._data.abilities.dex = 16; // +3
				state.setSkillProficiency("acrobatics", 1);
				state._data.customModifiers.skills.acrobatics = 2;

				const breakdown = state.getSkillBreakdown("acrobatics");
				expect(breakdown.canonical).toBe(3 + state.getProficiencyBonus());
				expect(breakdown.total).toBe(3 + state.getProficiencyBonus() + 2);
			});

			it("canonical equals total when no effective-only mods are present", () => {
				state._data.abilities.dex = 14; // +2
				state.setSkillProficiency("perception", 0);
				const breakdown = state.getSkillBreakdown("perception");
				expect(breakdown.canonical).toBe(breakdown.total);
			});
		});

		describe("getInitiativeBreakdown.isCanonical", () => {
			it("flags ability + JoaT as canonical, custom as effective", () => {
				state._data.abilities.dex = 16;
				state._data.customModifiers.initiative = 1;

				const breakdown = state.getInitiativeBreakdown();
				const byType = Object.fromEntries(breakdown.components.map(c => [c.type, c]));
				expect(byType.ability?.isCanonical).toBe(true);
				expect(byType.custom?.isCanonical).toBe(false);
			});

			it("exposes canonical field excluding custom", () => {
				state._data.abilities.dex = 16; // +3
				state._data.customModifiers.initiative = 2;

				const breakdown = state.getInitiativeBreakdown();
				expect(breakdown.canonical).toBe(3);
				expect(breakdown.total).toBe(5);
			});
		});

		describe("getSpellAttackBreakdown.isCanonical", () => {
			it("flags proficiency + ability as canonical, custom + item as effective", () => {
				state._data.abilities.int = 16;
				state._data.spellcasting.ability = "int";
				state._data.customModifiers.spellAttack = 1;
				state.setItemBonuses({spellAttack: 2});

				const breakdown = state.getSpellAttackBreakdown();
				expect(breakdown).toBeTruthy();
				const byType = Object.fromEntries(breakdown.components.map(c => [c.type, c]));
				expect(byType.proficiency?.isCanonical).toBe(true);
				expect(byType.ability?.isCanonical).toBe(true);
				expect(byType.custom?.isCanonical).toBe(false);
				expect(byType.item?.isCanonical).toBe(false);
			});

			it("exposes canonical field excluding custom + item", () => {
				state._data.abilities.int = 16; // +3
				state._data.spellcasting.ability = "int";
				state._data.customModifiers.spellAttack = 1;
				state.setItemBonuses({spellAttack: 2});

				const breakdown = state.getSpellAttackBreakdown();
				expect(breakdown.canonical).toBe(3 + state.getProficiencyBonus());
				expect(breakdown.total).toBe(3 + state.getProficiencyBonus() + 1 + 2);
			});
		});

		describe("getSpellDcBreakdown.isCanonical", () => {
			it("flags base + proficiency + ability as canonical, custom + item as effective", () => {
				state._data.abilities.int = 16;
				state._data.spellcasting.ability = "int";
				state._data.customModifiers.spellDc = 1;
				state.setItemBonuses({spellSaveDc: 2});

				const breakdown = state.getSpellDcBreakdown();
				expect(breakdown).toBeTruthy();
				const byType = Object.fromEntries(breakdown.components.map(c => [c.type, c]));
				expect(byType.base?.isCanonical).toBe(true);
				expect(byType.proficiency?.isCanonical).toBe(true);
				expect(byType.ability?.isCanonical).toBe(true);
				expect(byType.custom?.isCanonical).toBe(false);
				expect(byType.item?.isCanonical).toBe(false);
			});

			it("exposes canonical field excluding custom + item", () => {
				state._data.abilities.int = 16; // +3
				state._data.spellcasting.ability = "int";
				state._data.customModifiers.spellDc = 1;
				state.setItemBonuses({spellSaveDc: 2});

				const breakdown = state.getSpellDcBreakdown();
				expect(breakdown.canonical).toBe(8 + state.getProficiencyBonus() + 3);
				expect(breakdown.total).toBe(8 + state.getProficiencyBonus() + 3 + 1 + 2);
			});
		});
	});
});
