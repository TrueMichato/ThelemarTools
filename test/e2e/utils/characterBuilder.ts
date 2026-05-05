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
	/**
	 * Optional subrace label exactly as it appears in the wizard's
	 * subrace dropdown (e.g. "Jaknian", "Lexalian"). When the chosen
	 * race exposes a subrace selector, this label is selected after
	 * the parent race click. Required for races that gate stats
	 * behind a subrace pick.
	 */
	subrace?: string;
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
	bgSource: "PHB",
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

/** 11. Gambler Rogue Clairnian (TGTT) — Spellcasting from L3 (warlock list). */
export const PRESET_FULL_GAMBLER_CLAIRNIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Clairnian",
	className: "Rogue",
	classSource: "TGTT",
	background: "Charlatan",
	bgSource: "PHB'24",
	name: "Faro Luckwell",
	skillCount: 4,
	subclassName: "Gambler",
	subclassSource: "TGTT",
	signatureSpells: ["Eldritch Blast", "Hex"],
};

/** 12. Belly Dancer Rogue Jaknian (TGTT) — Dance of the Country toggle. */
export const PRESET_FULL_BELLY_DANCER_JAKNIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Jaknian",
	className: "Rogue",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Sahar Whirlstep",
	skillCount: 4,
	subclassName: "The Belly Dancer",
	subclassSource: "TGTT",
};

/** 13. Jester Bard Dendulra (TGTT) — Jester's Acts at L3. */
export const PRESET_FULL_JESTER_DENDULRA: CharacterPreset = {
	race: "Dendulra",
	raceSource: "TGTT",
	className: "Bard",
	classSource: "TGTT",
	background: "Entertainer",
	bgSource: "PHB'24",
	name: "Pip Bellsong",
	skillCount: 3,
	subclassName: "College of Jesters",
	subclassSource: "TGTT",
	signatureSpells: ["Vicious Mockery", "Healing Word"],
};

/** 14. Oath of Bastion Paladin Bugbear (TGTT). */
export const PRESET_FULL_BASTION_BUGBEAR: CharacterPreset = {
	race: "Bugbear",
	raceSource: "TGTT",
	className: "Paladin",
	classSource: "TGTT",
	background: "Soldier",
	bgSource: "PHB'24",
	name: "Grom Shieldoath",
	skillCount: 2,
	subclassName: "Oath of Bastion",
	subclassSource: "TGTT",
};

/** 15. Heroic Soul Sorcerer Half-Ogre (TGTT) — Over Soul + Stamina + Metamagic. */
export const PRESET_FULL_HEROIC_SOUL_HALFOGRE: CharacterPreset = {
	race: "Half-Ogre",
	raceSource: "TGTT",
	className: "Sorcerer",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Kael Heartflame",
	skillCount: 2,
	subclassName: "Heroic Soul",
	subclassSource: "TGTT",
	signatureSpells: ["Fire Bolt", "Magic Missile"],
};

/** 16. Trickster Rogue Goblin (TGTT) — Trickster Dice resource + Tricks. */
export const PRESET_FULL_TRICKSTER_GOBLIN: CharacterPreset = {
	race: "Goblin",
	raceSource: "TGTT",
	className: "Rogue",
	classSource: "TGTT",
	background: "Criminal",
	bgSource: "PHB'24",
	name: "Snik Quickfingers",
	skillCount: 4,
	subclassName: "Trickster",
	subclassSource: "TGTT",
};

/** 17. Lust Domain Cleric Lexalian (TGTT). */
export const PRESET_FULL_LUST_LEXALIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Lexalian",
	className: "Cleric",
	classSource: "TGTT",
	background: "Acolyte",
	bgSource: "PHB'24",
	name: "Lyra Heartcall",
	skillCount: 2,
	subclassName: "Lust Domain",
	subclassSource: "TGTT",
	signatureSpells: ["Sacred Flame", "Cure Wounds"],
};

/** 18. Horror Warlock Theocracian (TGTT). */
export const PRESET_FULL_HORROR_THEOCRACIAN: CharacterPreset = {
	race: "Child of the Empire",
	raceSource: "TGTT",
	subrace: "Theocracian",
	className: "Warlock",
	classSource: "TGTT",
	background: "Hermit",
	bgSource: "PHB'24",
	name: "Vex Whisperer",
	skillCount: 2,
	subclassName: "The Horror",
	subclassSource: "TGTT",
	signatureSpells: ["Eldritch Blast", "Hex"],
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
	PRESET_FULL_GAMBLER_CLAIRNIAN,
	PRESET_FULL_BELLY_DANCER_JAKNIAN,
	PRESET_FULL_JESTER_DENDULRA,
	PRESET_FULL_BASTION_BUGBEAR,
	PRESET_FULL_HEROIC_SOUL_HALFOGRE,
	PRESET_FULL_TRICKSTER_GOBLIN,
	PRESET_FULL_LUST_LEXALIAN,
	PRESET_FULL_HORROR_THEOCRACIAN,
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

	// CRITICAL: the wizard must run against an actual character record.
	// Just switching to the builder tab does NOT create a character — the
	// page only assigns a `_currentCharacterId` when the user clicks the
	// "+" New Character button (or selects an existing one). Without an
	// id, `_saveCurrentCharacter()` early-returns, so the wizard's final
	// "Finish" never persists. The sheet then renders the in-memory state
	// (so L1 assertions pass) but `#charsheet-name-select` remains on the
	// "Create New Character" placeholder, breaking every later flow that
	// depends on a loaded character (Level Up, Multiclass, etc.).
	await page.locator("#charsheet-btn-new").click();
	await charSheet.switchToTab(charSheet.tabBuilder);

	// Builder steps (current order, see js/charactersheet/charactersheet-builder.js):
	//   1. Race  →  2. Background  →  3. Class  →  4. Abilities
	//   5. Equipment  →  6. Spells  →  7. Details

	// Step 1: Race
	await builder.selectRaceExact(preset.race, preset.raceSource);
	await page.waitForTimeout(300);
	if (preset.subrace) {
		// Some races (Children of the Empire, Genasi, etc.) defer their
		// stat-relevant choices to a subrace dropdown that appears in the
		// race preview pane after the parent row is clicked.
		if (await builder.hasSubraceSelection()) {
			await builder.selectSubrace(preset.subrace);
		}
	}
	// Race may require sub-choices (skill/tool/language picks) — satisfy
	// validation before clicking Next.  No-op for races without choices.
	await builder.selectAllRacialChoices();
	await builder.clickNext();

	// Step 2: Background
	await builder.selectBackgroundExact(preset.background, preset.bgSource);
	// Backgrounds (esp. 2024) may have skill/tool/feat sub-pickers — these
	// are harmless no-ops if the background has no choices.
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 3: Class
	await builder.selectClassExact(preset.className, preset.classSource);
	if (preset.quickBuildTargetLevel != null) {
		await builder.setQuickBuildTargetLevel(preset.quickBuildTargetLevel);
	}
	await page.waitForTimeout(500);
	if (preset.skillCount) {
		await builder.selectFirstAvailableSkills(preset.skillCount);
	}
	// Expertise (Rogue / Bard / TGTT-Ranger) — must come AFTER class skills
	// are picked so the expertise list isn't empty.
	await builder.selectFirstAvailableExpertise(4);
	// Class-feature language grants (e.g. Ranger Deft Explorer)
	await builder.selectAllClassFeatureLanguages();
	if (preset.masteryCount) {
		await builder.selectFirstAvailableWeaponMasteries(preset.masteryCount);
	} else {
		// Fighter/Paladin/Ranger/Rogue (and TGTT variants) require weapon
		// masteries even when the test preset doesn't request a specific
		// count. Selecting up to 3 is safe — the picker caps itself.
		await builder.selectFirstAvailableWeaponMasteries(3);
	}
	if (preset.optFeatCount) {
		await builder.selectFirstAvailableOptionalFeatures(preset.optFeatCount);
	} else {
		// TGTT Warlock starts with Eldritch Invocations at L1 (etc.) so
		// always attempt to fill any optional-feature picker that's present.
		await builder.selectFirstAvailableOptionalFeatures(5);
	}
	// TGTT Fighter / Paladin / etc. expose Combat Traditions + Methods
	// pickers under the optional-features region — these gate Next when
	// unfilled. The helper is a no-op when the section is absent.
	await builder.selectCombatTraditionsAndMethods();
	// Always try feature options (harmless if none exist)
	await builder.selectFirstAvailableFeatureOptions(10);
	await builder.clickNext();

	// Step 4: Abilities
	await builder.assignStandardArrayDefaults();
	await builder.clickNext();

	// Step 5: Equipment — take gold (simplest)
	await builder.selectEquipmentOption("gold");
	await builder.clickNext();

	// Step 6: Spells (renders for every class; only spellcasters have a
	// "Starting Spells" heading, but the wizard still has a Next button to
	// advance to step 7 either way).
	await builder.autoFillStartingSpells({divineSoulAffinity: preset.divineSoulAffinity});
	await builder.clickNext();
	// If we under-filled spells/cantrips, the wizard pops a "Skip Spell
	// Selection?" confirmation modal — accept it so we reach Details.
	await builder.acceptSkipSpellsDialog();

	// Step 7: Details
	await builder.fillDetails({name: preset.name});
	await builder.finishWizard();

	// Confirm the character actually saved & became the active record.
	// `_finishCharacter` calls `saveCharacter()` then switches to the
	// overview tab — both async. Without this wait, downstream steps
	// (Level Up, etc.) operate against a not-yet-loaded character.
	// (Note: the builder doesn't refresh `#charsheet-sel-character` after
	// save, so we don't assert on the dropdown here — only on the
	// in-memory state, which is what every other module reads.)
	await page.waitForFunction(
		(name) => {
			const cs: any = (globalThis as any).charSheet;
			if (!cs?._currentCharacterId) return false;
			return cs?._state?.getName?.() === name;
		},
		preset.name,
		{timeout: 10_000},
	);

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
/**
 * After clicking the Level Up button on a multiclass character, the
 * runtime opens an `InputUiUtil.pGetUserEnum` modal asking which class
 * to advance. This helper picks the class deterministically and clicks
 * OK so the actual level-up wizard appears.
 *
 * If `targetClassName` is provided, picks that class. Otherwise picks
 * the LAST class in the dropdown — which matches the most-recently
 * added multiclass leg (so consecutive level-ups in a multiclass plan
 * land on the new class).
 *
 * Returns immediately (no-op) if no picker modal opens (single-class
 * characters skip the picker entirely). Bounded ~1.5s.
 */
export async function pHandleLevelUpClassPicker (page: Page, targetClassName?: string): Promise<void> {
	// The picker modal is the InputUiUtil enum dialog: a `<select>`
	// inside a modal whose only contents are the select + OK/Cancel.
	// Crucially it does NOT contain `.charsheet__levelup-wizard` —
	// that's how we tell the picker apart from the real wizard.
	const picker = await page.waitForFunction(
		() => {
			const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
				.filter(m => m.offsetParent !== null);
			for (const m of inners) {
				if (m.querySelector(".charsheet__levelup-wizard")) continue;
				const sel = m.querySelector<HTMLSelectElement>("select");
				if (sel && sel.options.length > 1) return true;
			}
			return false;
		},
		{timeout: 1500},
	).then(() => true).catch(() => false);

	if (!picker) {
		(globalThis as unknown as {__lastPickerSeen?: boolean}).__lastPickerSeen = false;
		return;
	}
	(globalThis as unknown as {__lastPickerSeen?: boolean}).__lastPickerSeen = true;

	await page.evaluate((wantClassName) => {
		const inners = Array.from(document.querySelectorAll<HTMLElement>(".ve-ui-modal__inner, .ui-modal__inner"))
			.filter(m => m.offsetParent !== null);
		for (const m of inners) {
			if (m.querySelector(".charsheet__levelup-wizard")) continue;
			const sel = m.querySelector<HTMLSelectElement>("select");
			if (!sel) continue;
			const realOpts = Array.from(sel.options).filter(o => o.value !== "-1");
			if (!realOpts.length) continue;
			let chosen: HTMLOptionElement | undefined;
			if (wantClassName) {
				const re = new RegExp(`\\b${wantClassName}\\b`, "i");
				chosen = realOpts.find(o => re.test(o.textContent || ""));
			}
			if (!chosen) chosen = realOpts[realOpts.length - 1];
			sel.value = chosen.value;
			sel.dispatchEvent(new Event("change", {bubbles: true}));
			const okBtn = Array.from(m.querySelectorAll<HTMLButtonElement>("button"))
				.find(b => /\bOK\b|\bConfirm\b/i.test(b.textContent || ""));
			if (okBtn) okBtn.click();
			return;
		}
	}, targetClassName);

	await page.waitForTimeout(200);
}


export async function levelUpTo (
	page: Page,
	targetLevel: number,
	opts?: {subclassName?: string; subclassSource?: string; signatureSpells?: string[]; targetClassName?: string},
): Promise<void> {
	const charSheet = new CharacterSheetPage(page);
	const levelUp = new LevelUpPage(page);

	// Read current level from the live state (single source of truth).
	// DOM-based selectors here historically defaulted to 1 when they
	// missed (the real element is `#charsheet-disp-level`), causing
	// consecutive `levelUpTo` calls to overshoot by re-levelling from L1.
	const startLevel = await page.evaluate(() => {
		const cs: any = (globalThis as any).charSheet;
		const fromState = cs?._state?.getTotalLevel?.();
		if (typeof fromState === "number" && fromState >= 1) return fromState;
		const el = document.getElementById("charsheet-disp-level")
			|| document.querySelector("[data-testid='charsheet-level']")
			|| document.querySelector(".charsheet__header-level");
		const match = el?.textContent?.match(/(\d+)/);
		return match ? parseInt(match[1], 10) : 1;
	});

	if (targetLevel <= startLevel) return;

	for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
		const t0 = Date.now();
		if (page.isClosed()) throw new Error(`levelUpTo: page closed before reaching L${lvl} (last reached L${lvl - 1})`);

		// When `opts.targetClassName` is provided, bypass the Level Up
		// button entirely and call the production API directly. This
		// sidesteps the multiclass class-picker modal that
		// `pGetUserEnum` otherwise raises (and which played havoc with
		// our DOM-based wait loop on multiclass characters).
		if (opts?.targetClassName) {
			await page.evaluate(async (cls) => {
				const cs: any = (globalThis as any).charSheet;
				if (!cs?._levelUp?.showLevelUp) throw new Error("charSheet._levelUp.showLevelUp unavailable");
				await cs._levelUp.showLevelUp(cls);
			}, opts.targetClassName);
			await page.waitForTimeout(200);
		} else {
			await charSheet.btnLevelUp.waitFor({state: "visible", timeout: 5000});
			await charSheet.btnLevelUp.click();
			await page.waitForTimeout(300);
			// Only single-class characters reach this branch in normal
			// flow (multiclass tests pass `targetClassName` and use the
			// API path above). For safety against unexpected pickers we
			// still detect the picker modal — but only if it appears
			// BEFORE the wizard renders, so we never race against the
			// wizard's own select elements (HP option, subclass picker).
			const wizardOpen = await page.locator(".charsheet__levelup-wizard").isVisible().catch(() => false);
			if (!wizardOpen) await pHandleLevelUpClassPicker(page, opts?.targetClassName);
		}

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
		await page.waitForTimeout(100);

		// Confirm the level actually advanced. If not, the wizard rejected
		// `finish()` (e.g. silent toast about an unfilled required choice)
		// and we'd otherwise spin up another level-up against the same
		// state. Surface this immediately.
		await page.waitForFunction(
			(expected) => {
				const cs: any = (globalThis as any).charSheet;
				return (cs?._state?.getTotalLevel?.() ?? 0) >= expected;
			},
			lvl,
			{timeout: 10_000},
		).catch(async () => {
			const got = await page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				return {
					level: cs?._state?.getTotalLevel?.() ?? null,
					name: cs?._state?.getName?.() ?? null,
					id: cs?._currentCharacterId ?? null,
					selValue: (document.getElementById("charsheet-sel-character") as HTMLSelectElement | null)?.value ?? null,
				};
			});
			throw new Error(
				`level-up to ${lvl} did not take effect. sheet state=${JSON.stringify(got)}`,
			);
		});
		// eslint-disable-next-line no-console
		console.log(`[levelUpTo] reached L${lvl} in ${Date.now() - t0}ms`);
	}
}
