import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {gotoWithThelemar, clearHomebrewStorage} from "../utils/homebrewLoader";

// ─── FEATS ──────────────────────────────────────────────────────────────────

test.describe("Thelemar Feats", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have all 5 TGTT feats loaded in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const featNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._featsData) return [];
			return cs._featsData
				.filter((f: any) => f.source === "TGTT")
				.map((f: any) => f.name);
		});

		const expectedFeats = [
			"Lore Mastery",
			"Spellsword Technique",
			"Whip Master",
			"Spell Scribing Adept",
			"Dreamer",
		];

		for (const feat of expectedFeats) {
			expect(featNames, `Feat "${feat}" should be loaded`).toContain(feat);
		}
	});
});

// ─── CUSTOM SKILLS ──────────────────────────────────────────────────────────

test.describe("Thelemar Custom Skills", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have all 5 TGTT custom skills in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const skillInfo = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			// Skills may be in _skillsData or loaded via the skill data arrays
			const skills = cs?._skillsData || [];
			return skills
				.filter((s: any) => s.source === "TGTT")
				.map((s: any) => ({name: s.name, ability: s.ability}));
		});

		const expectedSkills = [
			{name: "Linguistics", ability: "wis"},
			{name: "Culture", ability: "wis"},
			{name: "Engineering", ability: "int"},
			{name: "Might", ability: "str"},
			{name: "Endurance", ability: "con"},
		];

		for (const skill of expectedSkills) {
			const found = skillInfo.some((s: any) => s.name === skill.name);
			expect(found, `Skill "${skill.name}" should be loaded`).toBe(true);
		}
	});

	test("should show TGTT custom skills in Fighter skill selection", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		const builder = new BuilderWizardPage(page);

		await gotoWithThelemar(page);
		await charSheet.switchToTab(charSheet.tabBuilder);

		// Navigate to class step with TGTT Fighter (Race → Background → Class)
		await builder.selectRaceExact("Aarakocra", "MPMM");
		await page.waitForTimeout(300);
		await builder.clickNext();

		await builder.selectBackgroundExact("Soldier", "PHB'24");
		await builder.clickNext();

		await builder.selectClassExact("Fighter", "TGTT");
		await page.waitForTimeout(500);

		// Check the full page text for TGTT custom skill names
		// TGTT Fighter's skill list includes Culture, Endurance, Engineering, Might
		const pageText = await page.textContent("body") || "";

		const customSkills = ["Culture", "Endurance", "Engineering", "Might"];
		let foundCount = 0;
		for (const skill of customSkills) {
			if (pageText.includes(skill)) foundCount++;
		}
		expect(foundCount).toBeGreaterThan(0);
	});
});

// ─── CUSTOM CONDITIONS ──────────────────────────────────────────────────────

test.describe("Thelemar Custom Conditions", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have TGTT custom conditions in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const conditionNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._conditionsData) return [];
			return cs._conditionsData
				.filter((c: any) => c.source === "TGTT")
				.map((c: any) => c.name);
		});

		// Check for new TGTT-original conditions
		const expectedNewConditions = [
			"Slowed",
			"Dazed",
			"Choked",
			"Hidden",
			"Undetected",
		];

		for (const cond of expectedNewConditions) {
			expect(conditionNames, `Condition "${cond}" should be loaded`).toContain(cond);
		}
	});

	test("should have modified TGTT conditions in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const conditionNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._conditionsData) return [];
			return cs._conditionsData
				.filter((c: any) => c.source === "TGTT")
				.map((c: any) => c.name);
		});

		// Modified existing conditions
		const expectedModifiedConditions = [
			"Exhaustion",
			"Incapacitated",
			"Stunned",
			"Petrified",
			"Grappled",
			"Restrained",
			"Poisoned",
			"Frightened",
			"Invisible",
		];

		for (const cond of expectedModifiedConditions) {
			expect(conditionNames, `Modified condition "${cond}" should be loaded`).toContain(cond);
		}
	});
});

// ─── CUSTOM SPELLS ──────────────────────────────────────────────────────────

test.describe("Thelemar Custom Spells", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have original TGTT cantrips in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const spellNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._spellsData) return [];
			return cs._spellsData
				.filter((s: any) => s.source === "TGTT" && s.level === 0)
				.map((s: any) => s.name);
		});

		const expectedCantrips = ["Nox", "Amanuensis", "Transposition"];
		for (const cantrip of expectedCantrips) {
			expect(spellNames, `Cantrip "${cantrip}" should be loaded`).toContain(cantrip);
		}
	});

	test("should have key original TGTT spells in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const spellNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._spellsData) return [];
			return cs._spellsData
				.filter((s: any) => s.source === "TGTT" && s.level > 0)
				.map((s: any) => s.name);
		});

		// Check a representative sample of original TGTT spells across levels
		const expectedSpells = [
			"Adhesion",           // 1st
			"Wall of Darkness",   // 1st
			"Darkbeam",           // 2nd
			"Smog Cloud",         // 2nd
			"Counterspell",       // 3rd (TGTT version)
			"Ward Dream",         // 3rd
			"Veil Dream",         // 4th
			"Conduit",            // 5th
			"Lightningold's Golden Lightning", // 7th
		];

		for (const spell of expectedSpells) {
			expect(spellNames, `Spell "${spell}" should be loaded`).toContain(spell);
		}
	});
});

// ─── CUSTOM ITEMS ───────────────────────────────────────────────────────────

test.describe("Thelemar Custom Items", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have TGTT custom weapons in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const itemNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._itemsData) return [];
			return cs._itemsData
				.filter((i: any) => i.source === "TGTT")
				.map((i: any) => i.name);
		});

		const expectedItems = ["Bullwhip", "Qilinbian", "Stockwhip", "Smoke Bomb"];
		for (const item of expectedItems) {
			expect(itemNames, `Item "${item}" should be loaded`).toContain(item);
		}
	});
});

// ─── ALL TGTT CLASSES IN DATA ───────────────────────────────────────────────

test.describe("Thelemar Data Integrity", () => {
	test.afterEach(async ({page}) => {
		await clearHomebrewStorage(page);
	});

	test("should have all 13 TGTT classes loaded in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const classNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._classes) return [];
			return cs._classes
				.filter((c: any) => c.source === "TGTT")
				.map((c: any) => c.name);
		});

		const expectedClasses = [
			"Barbarian", "Bard", "Cleric", "Druid", "Fighter",
			"Monk", "Paladin", "Ranger", "Rogue", "Sorcerer",
			"Warlock", "Wizard", "Dreamwalker",
		];

		for (const cls of expectedClasses) {
			expect(classNames, `Class "${cls}" should be loaded`).toContain(cls);
		}
	});

	test("should have all original TGTT races loaded in app data", async ({page}) => {
		await gotoWithThelemar(page);

		const raceNames = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._races) return [];
			return cs._races
				.filter((r: any) => r.source === "TGTT")
				.map((r: any) => r.name);
		});

		const expectedRaces = [
			"Nyuidj", "Child of the Empire", "Dendulra", "Descathi",
			"Genasi", "Tiefling", "Thelemerian Dragonborn",
			"Gnoll", "Half-Ogre", "Kobold",
		];

		for (const race of expectedRaces) {
			const found = raceNames.some((r: string) => r.includes(race));
			expect(found, `Race "${race}" should be loaded`).toBe(true);
		}
	});

	test("should have TGTT optional features loaded", async ({page}) => {
		await gotoWithThelemar(page);

		const optFeatTypes = await page.evaluate(() => {
			const cs = (window as any).charSheet;
			if (!cs?._optionalFeaturesData) return [];
			const tgttFeats = cs._optionalFeaturesData.filter((f: any) => f.source === "TGTT");
			// Get unique feature types
			const types = new Set<string>();
			for (const f of tgttFeats) {
				if (f.featureType) {
					for (const ft of f.featureType) types.add(ft);
				}
			}
			return [...types];
		});

		// TGTT defines many optional feature types for Combat Traditions
		// Check that at least some key types are present
		const expectedTypes = ["BT", "JA", "PS", "MM"];
		let foundCount = 0;
		for (const ft of expectedTypes) {
			if (optFeatTypes.includes(ft)) foundCount++;
		}
		// At least some should be found
		expect(foundCount).toBeGreaterThan(0);
	});
});
