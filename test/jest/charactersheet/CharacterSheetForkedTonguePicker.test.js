/**
 * Character Sheet — Illrigger "Forked Tongue" language-picker UI tests.
 *
 * The model layer (state.js swappable-language API + long-rest swap + L9 Insight
 * advantage) is covered by CharacterSheetForkedTongue.test.js. This suite covers the
 * BUILDER (level 1) and LEVEL-UP (level 9) pickers that let the player actually CHOOSE
 * their swappable spoken languages:
 *
 *  - Detection helper getForkedTongueSwappableGrant(className, prevLevel, newLevel)
 *    (class-name + level-crossing based, because the base feature lives in external
 *    homebrew and its prose won't match the generic language-grant regex).
 *  - Builder L1 functional: chosen languages flow through _applyClassFeatures into the
 *    state (swappable + mirrored into _data.languages), reject Mictlanian/dupes, and are
 *    cleared when switching class.
 *  - Source-level guards that the builder + level-up wiring (render, validation, apply)
 *    is present.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (/** @type {string} */ rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// ==========================================================================
// PART 1: detection helper
// ==========================================================================
describe("getForkedTongueSwappableGrant detection helper", () => {
	it("grants 2 swappable languages crossing into Illrigger level 1", () => {
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Illrigger", 0, 1)).toEqual({count: 2});
	});

	it("grants +1 swappable language crossing into Illrigger level 9", () => {
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Illrigger", 8, 9)).toEqual({count: 1});
	});

	it("grants 3 total (2 + 1) when jumping from 0 straight past level 9", () => {
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Illrigger", 0, 9)).toEqual({count: 3});
	});

	it("grants nothing for intermediate level-ups that don't cross 1 or 9", () => {
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Illrigger", 1, 8).count).toBe(0);
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Illrigger", 9, 12).count).toBe(0);
	});

	it("is case-insensitive on the class name and ignores other classes", () => {
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("illrigger", 0, 1).count).toBe(2);
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant("Fighter", 0, 1).count).toBe(0);
		expect(CharacterSheetClassUtils.getForkedTongueSwappableGrant(null, 0, 1).count).toBe(0);
	});
});

// ==========================================================================
// PART 2: builder L1 functional
// ==========================================================================
describe("Builder L1 Forked Tongue language application", () => {
	/** Minimal CharacterSheetBuilder over a real CharacterSheetState. */
	function makeBuilder (forkedTongueLanguages) {
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._page = {renderCharacter: () => {}, getClassFeatures: () => [], getLanguageOptionsGrouped: () => ({standard: [], exotic: [], secret: [], homebrew: []})};
		builder._state = new CharacterSheetState();
		builder._selectedClass = {name: "Illrigger", source: "IllriggerRevised"};
		builder._selectedSkills = [];
		builder._selectedExpertise = [];
		builder._selectedClassFeatureLanguages = [];
		builder._selectedForkedTongueLanguages = forkedTongueLanguages || [];
		builder._selectedClassToolProficiencies = [];
		builder._selectedWeaponMasteries = [];
		builder._selectedSubclass = null;
		builder._selectedOptionalFeatures = {};
		builder._selectedFeatureOptions = {};
		builder._selectedClassFeatProgression = [];
		return builder;
	}

	it("applies the two chosen swappable languages after the class is committed", () => {
		const builder = makeBuilder(["Elvish", "Draconic"]);
		builder._state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		// Max is already 2 once the class is committed.
		expect(builder._state.getForkedTongueMaxSwappable()).toBe(2);

		builder._applyClassFeatures();

		expect(builder._state.getForkedTongueSwappableLanguages()).toEqual(["Elvish", "Draconic"]);
	});

	it("mirrors the chosen languages (plus Mictlanian) into _data.languages for Linguistics", () => {
		const builder = makeBuilder(["Elvish", "Draconic"]);
		builder._state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		builder._state.applyClassFeatureEffects(); // grants Mictlanian
		builder._applyClassFeatures();

		const langs = builder._state.getLanguages().map(l => l.toLowerCase());
		expect(langs).toContain("mictlanian");
		expect(langs).toContain("elvish");
		expect(langs).toContain("draconic");
	});

	it("does not exceed the max or duplicate when an invalid pick sneaks through", () => {
		const builder = makeBuilder(["Mictlanian", "Elvish", "Elvish"]);
		builder._state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		builder._applyClassFeatures();

		// Mictlanian + the duplicate are rejected by the state API; only Elvish lands.
		expect(builder._state.getForkedTongueSwappableLanguages()).toEqual(["Elvish"]);
	});

	it("clears swappable languages from state when switching away from Illrigger", () => {
		const builder = makeBuilder(["Elvish", "Draconic"]);
		builder._state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		builder._state.applyClassFeatureEffects();
		builder._applyClassFeatures();
		expect(builder._state.getForkedTongueSwappableLanguages()).toHaveLength(2);

		builder._clearClassApplication({
			className: "Illrigger",
			classSource: "IllriggerRevised",
			languages: [],
		});

		expect(builder._state.getForkedTongueSwappableLanguages()).toEqual([]);
		const langs = builder._state.getLanguages().map(l => l.toLowerCase());
		expect(langs).not.toContain("elvish");
		expect(langs).not.toContain("draconic");
	});

	it("is idempotent when _applyClassFeatures runs twice (e.g. a builder revisit)", () => {
		const builder = makeBuilder(["Elvish", "Draconic"]);
		builder._state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		builder._applyClassFeatures();
		builder._applyClassFeatures();
		expect(builder._state.getForkedTongueSwappableLanguages()).toEqual(["Elvish", "Draconic"]);
	});
});

// ==========================================================================
// PART 3: source-level wiring guards
// ==========================================================================
describe("Builder source wiring for Forked Tongue picker", () => {
	const BUILDER_SRC = read("js/charactersheet/charactersheet-builder.js");

	it("renders the picker via the detection helper at the class step", () => {
		expect(BUILDER_SRC).toMatch(/getForkedTongueSwappableGrant\(cls\.name, 0, 1\)/);
		expect(BUILDER_SRC).toMatch(/_renderForkedTongueLanguageSelection\s*\(/);
	});

	it("defines the dedicated render method that excludes Mictlanian", () => {
		const m = BUILDER_SRC.match(/_renderForkedTongueLanguageSelection \(cls, count\) \{[\s\S]*?\n\t\}\n/);
		expect(m).not.toBeNull();
		expect(m[0]).toMatch(/knownLangs\.add\("mictlanian"\)/);
		expect(m[0]).toMatch(/this\._selectedForkedTongueLanguages\[i\]/);
	});

	it("gates the Next button until distinct picks are chosen", () => {
		expect(BUILDER_SRC).toMatch(/Please choose \$\{ftCount\} distinct languages for Forked Tongue/);
	});

	it("applies picks through the state API after addClass", () => {
		expect(BUILDER_SRC).toMatch(/this\._state\.addForkedTongueSwappableLanguage\(lang\)/);
	});

	it("clears applied swappable languages on class switch", () => {
		expect(BUILDER_SRC).toMatch(/removeForkedTongueSwappableLanguage\?\.\(l\)/);
	});
});

describe("LevelUp source wiring for Forked Tongue L9 picker", () => {
	const LEVELUP_SRC = read("js/charactersheet/charactersheet-levelup.js");

	it("detects the L9 grant via the shared helper using the class's current level", () => {
		expect(LEVELUP_SRC).toMatch(/getForkedTongueSwappableGrant\(classEntry\.name, classEntry\.level, newLevel\)/);
	});

	it("renders a dedicated L9 picker accordion and gates Apply", () => {
		expect(LEVELUP_SRC).toMatch(/_renderForkedTongueLevelUpSelection\s*\(/);
		expect(LEVELUP_SRC).toMatch(/Please choose a language for Forked Tongue/);
	});

	it("applies the L9 pick through the state API and records it in history", () => {
		expect(LEVELUP_SRC).toMatch(/this\._state\.addForkedTongueSwappableLanguage\(forkedTongueLevelUpPick\)/);
		expect(LEVELUP_SRC).toMatch(/historyEntry\.choices\.forkedTongueLanguage = forkedTongueLevelUpPick/);
	});
});

// ==========================================================================
// PART 4: level-9 end-to-end model check (mirrors the picker's apply seam)
// ==========================================================================
describe("LevelUp L9 apply seam reaches the third swappable language", () => {
	it("adds a third swappable language once Illrigger reaches level 9", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		state.applyClassFeatureEffects();
		state.addForkedTongueSwappableLanguage("Elvish");
		state.addForkedTongueSwappableLanguage("Draconic");
		// Before L9 a third pick is rejected.
		expect(state.addForkedTongueSwappableLanguage("Goblin")).toBe(false);

		// Level up to 9 (what _applyLevelUp commits before the picker applies).
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 9});
		expect(state.getForkedTongueMaxSwappable()).toBe(3);

		// The picker's apply seam: add the chosen third language.
		expect(state.addForkedTongueSwappableLanguage("Goblin")).toBe(true);
		expect(state.getForkedTongueSwappableLanguages()).toEqual(["Elvish", "Draconic", "Goblin"]);
		expect(state.getLanguages().map(l => l.toLowerCase())).toContain("goblin");
	});
});
