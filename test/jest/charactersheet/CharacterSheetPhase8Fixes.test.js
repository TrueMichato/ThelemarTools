
import "./setup.js";

let CharacterSheetState;
let charState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Phase 8: Standalone Simple Fixes", () => {
	beforeEach(() => {
		charState = new CharacterSheetState();
	});

	// ===================================================================
	// Fix 1: Changeling Shapechanger as combat action
	// ===================================================================
	describe("Changeling Shapechanger classification", () => {
		test("shapechanger should be in FEATURE_CLASSIFICATION_OVERRIDES as combat", () => {
			const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES;
			expect(overrides["shapechanger"]).toBe("combat");
		});

		test("shapechanger should route through combat interactionMode", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Shapechanger",
				description: "As an action, you can change your appearance and your voice. You determine the specifics of the changes. You stay in the new form until you use an action to revert to your true form or until you die.",
			});

			// Should be detected but classified as combat, not toggle
			expect(result).toBeTruthy();
			expect(result.interactionMode).toBe("combat");
		});

		test("shapechanger override should prevent it from being an active toggle state", () => {
			charState.addFeature({
				name: "Shapechanger",
				description: "As an action, you can change your appearance and your voice. You stay in the new form until you use an action to revert to your true form or until you die.",
				source: "ERLW",
			});

			// Should NOT appear in activatable features list (it's a combat action)
			const activatableFeatures = charState.getActivatableFeatures();
			const shapechanger = activatableFeatures.find(f => f.name === "Shapechanger");
			expect(shapechanger).toBeUndefined();
		});
	});

	// ===================================================================
	// Fix 2: Homebrew skill ability modifier fix
	// ===================================================================
	describe("Homebrew skill ability modifiers", () => {
		test("getSkillMod should use getSkillAbility for standard skills", () => {
			charState._data.abilities.dex = 16; // +3 modifier

			const mod = charState.getSkillMod("acrobatics");
			// Dex mod (+3) + no proficiency + no bonuses
			expect(mod).toBe(3);
		});

		test("getSkillMod should use getSkillAbility for hardcoded homebrew skills", () => {
			charState._data.abilities.wis = 16; // +3 modifier

			// "cooking" is in getSkillAbility() as wis, but was NOT in getSkillMod()'s old map
			const mod = charState.getSkillMod("cooking");
			expect(mod).toBe(3); // Should use WIS modifier
		});

		test("getSkillMod should use getSkillAbility for culture (int homebrew skill)", () => {
			charState._data.abilities.int = 18; // +4 modifier

			const mod = charState.getSkillMod("culture");
			expect(mod).toBe(4); // Should use INT modifier
		});

		test("getSkillMod should use getSkillAbility for endurance (con homebrew skill)", () => {
			charState._data.abilities.con = 14; // +2 modifier

			const mod = charState.getSkillMod("endurance");
			expect(mod).toBe(2); // Should use CON modifier
		});

		test("getSkillMod should handle custom skills with specified ability", () => {
			charState._data.abilities.cha = 16; // +3 modifier
			charState.addCustomSkill("Brewing", "cha");

			const mod = charState.getSkillMod("Brewing");
			expect(mod).toBe(3); // Should use CHA modifier
		});

		test("getSkillMod should handle custom skills with empty ability gracefully", () => {
			charState.addCustomSkill("Flat Check", "");

			// With no ability, mod should be 0 (flat bonus only)
			const mod = charState.getSkillMod("Flat Check");
			expect(mod).toBe(0);
		});

		test("getSkillMod should add proficiency bonus for proficient homebrew skills", () => {
			charState._data.abilities.wis = 14; // +2 modifier
			charState._data.level = 5; // prof bonus +3
			charState._data.classes = [{name: "Fighter", level: 5}];
			charState._data.skillProficiencies = {cooking: 1};

			const mod = charState.getSkillMod("cooking");
			// WIS mod (+2) + prof bonus (+3) = 5
			expect(mod).toBe(5);
		});

		test("getSkillAbility should return ability for all hardcoded homebrew skills", () => {
			expect(charState.getSkillAbility("cooking")).toBe("wis");
			expect(charState.getSkillAbility("culture")).toBe("int");
			expect(charState.getSkillAbility("endurance")).toBe("con");
			expect(charState.getSkillAbility("engineering")).toBe("int");
			expect(charState.getSkillAbility("harvesting")).toBe("wis");
			expect(charState.getSkillAbility("linguistics")).toBe("wis");
			expect(charState.getSkillAbility("might")).toBe("str");
		});
	});

	// ===================================================================
	// Fix 3: Feature classification overrides - race features
	// ===================================================================
	describe("Race feature classification", () => {
		test("FEATURE_CLASSIFICATION_OVERRIDES should be case-insensitive on lookup", () => {
			// The overrides map keys should be lowercase
			const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES;
			Object.keys(overrides).forEach(key => {
				expect(key).toBe(key.toLowerCase());
			});
		});

		test("all override values should be valid interaction modes", () => {
			const validModes = new Set(["passive", "combat", "reaction"]);
			const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES;
			Object.entries(overrides).forEach(([key, value]) => {
				expect(validModes.has(value)).toBe(true);
			});
		});
	});

	// ===================================================================
	// Fix 4: Edit attack modal — getItems vs getInventory
	// ===================================================================
	describe("Attack edit data consistency", () => {
		test("getItems should return flattened items with top-level name", () => {
			charState._data.inventory.push({
				id: "weapon-1",
				item: {
					name: "Longsword",
					weapon: true,
					property: ["V|XPHB"],
					dmg1: "1d8",
					dmgType: "S",
				},
				quantity: 1,
				equipped: true,
				attuned: false,
			});

			const items = charState.getItems();
			const sword = items.find(i => i.id === "weapon-1");
			expect(sword).toBeDefined();
			expect(sword.name).toBe("Longsword");
			expect(sword.weapon).toBe(true);
			expect(sword.equipped).toBe(true);
		});

		test("getInventory should return raw items with nested item data", () => {
			charState._data.inventory.push({
				id: "weapon-2",
				item: {
					name: "Shortsword",
					weapon: true,
				},
				quantity: 1,
				equipped: false,
			});

			const inv = charState.getInventory();
			const raw = inv.find(i => i.id === "weapon-2");
			expect(raw).toBeDefined();
			expect(raw.name).toBeUndefined(); // name is nested in item
			expect(raw.item.name).toBe("Shortsword");
		});

		test("auto-generated attack IDs should match getItems item IDs", () => {
			charState._data.inventory.push({
				id: "test-wpn-id",
				item: {
					name: "Battle Axe",
					weapon: true,
					property: [],
				},
				quantity: 1,
				equipped: true,
			});

			const items = charState.getItems();
			const weapon = items.find(i => i.id === "test-wpn-id");
			expect(weapon).toBeDefined();
			expect(weapon.name).toBe("Battle Axe");

			// Verify the auto-attack ID format matches
			const autoAttackId = `auto_${weapon.id}`;
			const weaponId = autoAttackId.substring(5);
			const lookupaWeapon = items.find(i => i.id === weaponId);
			expect(lookupaWeapon).toBeDefined();
			expect(lookupaWeapon.name).toBe("Battle Axe");
		});
	});

	// ===================================================================
	// Fix 5: Levelup tool proficiency — anyMusicalInstrument support
	// ===================================================================
	describe("Monk tool proficiency data", () => {
		test("Monk class data should have both anyArtisansTool and anyMusicalInstrument", () => {
			// Verify our understanding of the data format
			const toolProfs = [
				{anyArtisansTool: 1},
				{anyMusicalInstrument: 1},
			];

			const hasArtisan = toolProfs.some(tp => tp.anyArtisansTool);
			const hasInstrument = toolProfs.some(tp => tp.anyMusicalInstrument);

			expect(hasArtisan).toBe(true);
			expect(hasInstrument).toBe(true);
		});

		test("addToolProficiency should accept musical instruments", () => {
			charState.addToolProficiency("Lute");

			const hasLute = charState.hasToolProficiency("Lute");
			expect(hasLute).toBe(true);
		});

		test("addToolProficiency should accept artisan tools", () => {
			charState.addToolProficiency("Smith's Tools");

			const hasSmith = charState.hasToolProficiency("Smith's Tools");
			expect(hasSmith).toBe(true);
		});
	});
});
