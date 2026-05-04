import {Page} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {BuilderWizardPage} from "../pages/BuilderWizardPage";
import {LevelUpPage} from "../pages/LevelUpPage";

/**
 * Character build presets for use across E2E tests.
 * Each preset defines the wizard selections needed to create a character.
 */
export interface CharacterPreset {
	race: string;
	raceSource: string;
	className: string;
	classSource: string;
	background: string;
	bgSource: string;
	name: string;
	quickBuildTargetLevel?: number;
	skillCount?: number;
	masteryCount?: number;
	optFeatCount?: number;
	divineSoulAffinity?: string;
	/** Subclass to select on level-up (e.g. "Bladesinging"). */
	subclassName?: string;
	/** Subclass source ("TGTT", "TGTT-2014", "TGTT-2024", ...). */
	subclassSource?: string;
	/**
	 * Optional signature spells to deterministically pick during creation /
	 * level-up wizards instead of relying on auto-fill. See pickSignatureSpells.
	 */
	signatureSpells?: string[];
}

/** Simple Fighter — minimal selections, fastest to create */
export const PRESET_FIGHTER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "PHB'24",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Test Fighter",
	skillCount: 2,
	masteryCount: 3,
	optFeatCount: 1,
};

/** Cleric — tests Divine Order optional feature + feature options */
export const PRESET_CLERIC: CharacterPreset = {
	race: "Dwarf",
	raceSource: "PHB'24",
	className: "Cleric",
	classSource: "PHB'24",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Test Cleric",
	skillCount: 2,
	optFeatCount: 1,
};

/** Bard — spellcaster with known spells */
export const PRESET_BARD: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Bard",
	classSource: "PHB'24",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Test Bard",
	skillCount: 3,
};

// ═══════════════════════════════════════════════════════════════════════════
//  TGTT PLAYER PARTY PRESETS (7 combos)
// ═══════════════════════════════════════════════════════════════════════════

/** TGTT Bladesinger Wizard */
export const PRESET_TGTT_BLADESINGER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Thea Bladesinger",
	skillCount: 2,
};

/** TGTT Zodiac Druid (Circle of the Stars) */
export const PRESET_TGTT_ZODIAC_DRUID: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Druid",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Celeste Zodiac",
	skillCount: 2,
};

/** TGTT Hunter Ranger */
export const PRESET_TGTT_HUNTER_RANGER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Ranger",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Kael Hunter",
	skillCount: 3,
};

/** TGTT Arcane Archer Fighter */
export const PRESET_TGTT_ARCANE_ARCHER: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Varn Arcane Archer",
	skillCount: 2,
	masteryCount: 3,
};

/** TGTT Way of Mercy Monk */
export const PRESET_TGTT_MERCY_MONK: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Zara Mercy",
	skillCount: 2,
};

/** TGTT Divine Soul Sorcerer */
export const PRESET_TGTT_DIVINE_SOUL: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Isra Divine Soul",
	skillCount: 2,
	divineSoulAffinity: "Good",
};

/** TGTT Hexblade Warlock */
export const PRESET_TGTT_HEXBLADE: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Warlock",
	classSource: "TGTT",
	background: "Criminal",
	bgSource: "PHB'24",
	name: "Mordak Hexblade",
	skillCount: 2,
};

// ═══════════════════════════════════════════════════════════════════════════
//  COMPREHENSIVE PLAYER-BUILD PRESETS — full L1→20 coverage
//  ───────────────────────────────────────────────────────────────────────
//  These are the 10 builds exercised by the comprehensive E2E specs added
//  alongside this preset block.  Race, subclass, and signature spells are
//  pre-resolved to the names actually present in
//  homebrew/TravelersGuidetoThelemar.json so the wizard can select them
//  directly via the existing fuzzy `includes` matchers in
//  BuilderWizardPage / LevelUpPage.
// ═══════════════════════════════════════════════════════════════════════════

/** 1. Mercy Monk Changeling (TGTT) */
export const PRESET_FULL_MERCY_MONK_CHANGELING: CharacterPreset = {
	race: "Changeling",
	raceSource: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Zara Mercyhand",
	skillCount: 2,
	subclassName: "Warrior of Mercy",
	subclassSource: "TGTT",
};

/** 2. Arcane Archer Fighter Hochling (TGTT) */
export const PRESET_FULL_ARCANE_ARCHER_HOCHLING: CharacterPreset = {
	race: "Hochling",
	raceSource: "TGTT",
	className: "Fighter",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Varn Boltcaller",
	skillCount: 2,
	masteryCount: 3,
	subclassName: "Arcane Archer",
	subclassSource: "TGTT",
};

/** 3. Bladesinger Wizard Tabaxi (TGTT) */
export const PRESET_FULL_BLADESINGER_TABAXI: CharacterPreset = {
	race: "Tabaxi",
	raceSource: "TGTT",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Thea Dancesteel",
	skillCount: 2,
	subclassName: "Bladesinging",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Shield", "Booming Blade", "Mage Armor"],
};

/** 4a. Hunter Ranger Centaur (TGTT) — pure single-class */
export const PRESET_FULL_HUNTER_CENTAUR: CharacterPreset = {
	race: "Centaur",
	raceSource: "TGTT",
	className: "Ranger",
	classSource: "TGTT",
	background: "Outlander",
	bgSource: "PHB'24",
	name: "Kael Wildhoof",
	skillCount: 3,
	subclassName: "Hunter",
	subclassSource: "TGTT-2024",
	signatureSpells: ["Hunter's Mark", "Cure Wounds"],
};

/** 4b. Zodiac Druid Centaur (TGTT) — pure single-class */
export const PRESET_FULL_ZODIAC_CENTAUR: CharacterPreset = {
	race: "Centaur",
	raceSource: "TGTT",
	className: "Druid",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Celeste Starhoof",
	skillCount: 2,
	subclassName: "Circle of the Zodiac",
	subclassSource: "TGTT",
	signatureSpells: ["Druidcraft", "Goodberry"],
};

/** 5. Hexblade Warlock 2 / Divine Soul Sorcerer 18 Tortle (TGTT) */
export const PRESET_FULL_HEX_DIVINE_TORTLE: CharacterPreset = {
	race: "Tortle",
	raceSource: "TGTT",
	className: "Warlock",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Shellbound Hex",
	skillCount: 2,
	subclassName: "The Hexblade",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Hex", "Eldritch Blast"],
};

/** 6. Child of the Sun Bloodline Sorcerer Hochling (TGTT) */
export const PRESET_FULL_CHILD_OF_SUN_HOCHLING: CharacterPreset = {
	race: "Hochling",
	raceSource: "TGTT",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Solis Hochsun",
	skillCount: 2,
	subclassName: "Child of the Sun Bloodline",
	subclassSource: "TGTT",
	signatureSpells: ["Fire Bolt", "Burning Hands"],
};

/** 7. Chronurgy Wizard Nyuidj (TGTT) */
export const PRESET_FULL_CHRONURGY_NYUIDJ: CharacterPreset = {
	race: "Nyuidj",
	raceSource: "TGTT",
	className: "Wizard",
	classSource: "TGTT",
	background: "Sage",
	bgSource: "PHB'24",
	name: "Tyk Hourglass",
	skillCount: 2,
	subclassName: "Chronurgy Magic",
	subclassSource: "TGTT-2014",
	signatureSpells: ["Mage Hand", "Magic Missile"],
};

/** 8. College of Surrealism Bard Yuan-Ti (TGTT) */
export const PRESET_FULL_SURREALISM_YUANTI: CharacterPreset = {
	race: "Yuan-Ti",
	raceSource: "TGTT",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Sissin Dreamweaver",
	skillCount: 3,
	subclassName: "College of Surrealism",
	subclassSource: "TGTT",
	signatureSpells: ["Vicious Mockery", "Healing Word"],
};

/** 9. Chained Fury Barbarian Minotaur (TGTT) */
export const PRESET_FULL_CHAINED_FURY_MINOTAUR: CharacterPreset = {
	race: "Minotaur",
	raceSource: "TGTT",
	className: "Barbarian",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Korr Ironhorn",
	skillCount: 2,
	masteryCount: 2,
	subclassName: "Path of the Chained Fury",
	subclassSource: "TGTT",
};

/** 10. Time Domain Cleric (TGTT) — race not specified by user; default to a flexible TGTT race. */
export const PRESET_FULL_TIME_CLERIC: CharacterPreset = {
	race: "Aarakocra",
	raceSource: "MPMM",
	className: "Cleric",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Mira Hourward",
	skillCount: 2,
	subclassName: "Time Domain",
	subclassSource: "TGTT",
	signatureSpells: ["Sacred Flame", "Cure Wounds"],
};

/** Convenience array of all comprehensive presets — handy for parameterised smoke tests. */
export const PRESETS_FULL_PARTY: CharacterPreset[] = [
	PRESET_FULL_MERCY_MONK_CHANGELING,
	PRESET_FULL_ARCANE_ARCHER_HOCHLING,
	PRESET_FULL_BLADESINGER_TABAXI,
	PRESET_FULL_HUNTER_CENTAUR,
	PRESET_FULL_ZODIAC_CENTAUR,
	PRESET_FULL_HEX_DIVINE_TORTLE,
	PRESET_FULL_CHILD_OF_SUN_HOCHLING,
	PRESET_FULL_CHRONURGY_NYUIDJ,
	PRESET_FULL_SURREALISM_YUANTI,
	PRESET_FULL_CHAINED_FURY_MINOTAUR,
	PRESET_FULL_TIME_CLERIC,
];

/**
 * Build a complete character via the Builder Wizard UI.
 * Returns the CharacterSheetPage for further interaction.
 */
export async function createCharacterViaWizard (
	page: Page,
	preset: CharacterPreset = PRESET_FIGHTER,
): Promise<{charSheet: CharacterSheetPage; builder: BuilderWizardPage}> {
	const charSheet = new CharacterSheetPage(page);
	const builder = new BuilderWizardPage(page);

	await charSheet.goto();
	await charSheet.switchToTab(charSheet.tabBuilder);

	// Step 1: Race
	await builder.selectRaceExact(preset.race, preset.raceSource);
	await page.waitForTimeout(300);
	await builder.clickNext();

	// Step 2: Class
	await builder.selectClassExact(preset.className, preset.classSource);
	if (preset.quickBuildTargetLevel != null) {
		await builder.setQuickBuildTargetLevel(preset.quickBuildTargetLevel);
	}
	await page.waitForTimeout(500);
	if (preset.skillCount) {
		await builder.selectFirstAvailableSkills(preset.skillCount);
	}
	if (preset.masteryCount) {
		await builder.selectFirstAvailableWeaponMasteries(preset.masteryCount);
	}
	if (preset.optFeatCount) {
		await builder.selectFirstAvailableOptionalFeatures(preset.optFeatCount);
	}
	// Always try feature options (harmless if none exist)
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 3: Abilities
	await builder.assignStandardArrayDefaults();
	await builder.clickNext();

	// Step 4: Background
	await builder.selectBackgroundExact(preset.background, preset.bgSource);
	await builder.clickNext();

	// Step 5: Equipment — take gold (simplest)
	await builder.selectEquipmentOption("gold");
	await builder.clickNext();
	await builder.autoFillStartingSpells({divineSoulAffinity: preset.divineSoulAffinity});
	if (await page.getByRole("heading", {name: "Starting Spells"}).count()) {
		await builder.clickNext();
	}

	// Step 6: Details
	await builder.fillDetails({name: preset.name});
	await builder.finishWizard();

	return {charSheet, builder};
}

/**
 * Level a character up from their current level to a target level.
 * Each level: clicks Level Up, auto-fills all selections (HP average,
 * first available skills/feats/spells), and finishes.
 *
 * If a subclass needs selecting (e.g. level 3), pass `subclassName`.
 * Pass `signatureSpells` to deterministically tick named spells before
 * the auto-fill step picks the first-available remainder.
 */
export async function levelUpTo (
	page: Page,
	targetLevel: number,
	opts?: {subclassName?: string; subclassSource?: string; signatureSpells?: string[]},
): Promise<void> {
	const charSheet = new CharacterSheetPage(page);
	const levelUp = new LevelUpPage(page);

	// Read current level from the sheet
	const startLevel = await page.evaluate(() => {
		const el = document.querySelector("[data-testid='charsheet-level']")
			|| document.querySelector(".charsheet__header-level");
		if (!el) return 1;
		const match = el.textContent?.match(/(\d+)/);
		return match ? parseInt(match[1], 10) : 1;
	});

	for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
		// Click the Level Up button on the character sheet
		await charSheet.btnLevelUp.waitFor({state: "visible", timeout: 5000});
		await charSheet.btnLevelUp.click();
		await page.waitForTimeout(500);

		// Wait for the level-up modal
		await levelUp.waitForModal();

		// If subclass selection is available and we have a name, select it
		if (opts?.subclassName && await levelUp.isAccordionVisible("subclass")) {
			await levelUp.expandAccordion("subclass");
			await levelUp.selectSubclass(opts.subclassName, opts.subclassSource);
		}

		// HP: take average (most reliable for deterministic tests)
		if (await levelUp.isAccordionVisible("hp")) {
			await levelUp.expandAccordion("hp");
			await levelUp.selectHpOption("average");
		}

		// Try signature spells before the generic auto-fill so they win.
		if (opts?.signatureSpells?.length && await levelUp.isAccordionVisible("knownspells")) {
			await levelUp.expandAccordion("knownspells");
			const {pickSignatureSpells} = await import("./comprehensiveBuildHelpers");
			await pickSignatureSpells(page, opts.signatureSpells);
		}

		// Auto-fill all remaining selections (skills, spells, feats, etc.)
		await levelUp.autoFillAllSelections();

		// Finish this level
		await levelUp.finish();
		await levelUp.expectModalClosed();
		await page.waitForTimeout(300);
	}
}
