/**
 * Bug #5 — Aasimar "Celestial Revelation" over-granted.
 *
 * `_applyRacialTraits()` → `_addFeatureEntries()` in the builder used to add
 * EVERY race entry to the features list with no level gating, so a fresh
 * (level-1) Aasimar wrongly received the level-3 "Celestial Revelation"
 * transformation trait. The fix gates racial entry features by their unlock
 * level:
 *   - explicit numeric `level`, else
 *   - the leading "When you reach character level N" / "Starting at Nth level"
 *     prose convention (anchored to the FIRST text entry so mid-sentence scaling
 *     text such as Dragonborn Breath Weapon's "...when you reach character levels
 *     5..." never falsely hides a level-1 feature).
 *
 * The level-up / quick-build progression re-applies newly-unlocked racial entries
 * via `CharacterSheetClassUtils.updateRacialFeatures`, which is verified here at
 * the state layer (add on reaching the level, remove on level-down, idempotent).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

// ---------------------------------------------------------------------------
// Fixtures mirroring data/races.json (tags preserved — the parser strips them).
// ---------------------------------------------------------------------------

const ENTRY_CELESTIAL_RESISTANCE = {
	type: "entries",
	name: "Celestial Resistance",
	entries: ["You have {@variantrule Resistance|XPHB} to Necrotic damage and Radiant damage."],
};
const ENTRY_DARKVISION = {
	type: "entries",
	name: "Darkvision",
	entries: ["You have {@sense Darkvision|XPHB} with a range of 60 feet."],
};
const ENTRY_LIGHT_BEARER = {
	type: "entries",
	name: "Light Bearer",
	entries: ["You know the {@spell Light|XPHB} cantrip. Charisma is your spellcasting ability for it."],
};
// XPHB Aasimar — gated to character level 3.
const ENTRY_CELESTIAL_REVELATION_XPHB = {
	type: "entries",
	name: "Celestial Revelation",
	entries: [
		"When you reach character level 3, you can transform as a {@variantrule Bonus Action|XPHB} using one of the options below (choose the option each time you transform). The transformation lasts for 1 minute or until you end it (no action required). Once you transform, you can't do so again until you finish a {@variantrule Long Rest|XPHB}.",
		{type: "list", style: "list-hang-notitle", items: []},
	],
};
// MPMM Aasimar variant — "When you reach 3rd level".
const ENTRY_CELESTIAL_REVELATION_MPMM = {
	type: "entries",
	name: "Celestial Revelation (Necrotic Shroud)",
	entries: [
		"When you reach 3rd level, you can use a bonus action to transform yourself. Your transformation lasts for 1 minute or until you end it as a bonus action.",
	],
};
// DMG Aasimar — has "Celestial Legacy" (NOT Celestial Revelation); its level-3
// spell mention is in the SECOND sentence, so it stays a level-1 trait.
const ENTRY_CELESTIAL_LEGACY_DMG = {
	type: "entries",
	name: "Celestial Legacy",
	entries: [
		"You know the {@spell light} cantrip. Once you reach 3rd level, you can cast the {@spell lesser restoration} spell once with this trait, and you regain the ability to do so when you finish a long rest.",
	],
};
// Dragonborn Breath Weapon — a LEVEL-1 feature whose prose mentions higher
// levels mid-sentence (the classic false-gate trap).
const ENTRY_BREATH_WEAPON = {
	type: "entries",
	name: "Breath Weapon",
	entries: [
		"When you take the {@action Attack|XPHB} action on your turn, you can replace one of your attacks with an exhalation of magical energy. This damage increases by {@damage 1d10} when you reach character levels 5 ({@damage 2d10}), 11 ({@damage 3d10}), and 17 ({@damage 4d10}).",
	],
};
// Simic Hybrid Animal Enhancement — level-1 trait that also evolves at level 5.
const ENTRY_ANIMAL_ENHANCEMENT = {
	type: "entries",
	name: "Animal Enhancement",
	entries: [
		"Your body has been altered to incorporate certain animal characteristics. You choose one animal enhancement now and a second enhancement at 5th level.",
		"At 1st level, choose one of the following options:",
	],
};

const XPHB_AASIMAR_ENTRIES = [
	ENTRY_CELESTIAL_RESISTANCE,
	ENTRY_DARKVISION,
	ENTRY_LIGHT_BEARER,
	ENTRY_CELESTIAL_REVELATION_XPHB,
];

function makeBuilderWithCapture () {
	const captured = [];
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = {addFeature: (f) => captured.push(f)};
	return {builder, captured};
}

// ---------------------------------------------------------------------------
// getFeatureUnlockLevel
// ---------------------------------------------------------------------------

describe("CharacterSheetClassUtils.getFeatureUnlockLevel", () => {
	test("honors an explicit numeric level (homebrew)", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({name: "X", level: 5, entries: ["whatever"]})).toBe(5);
	});

	test("parses XPHB 'When you reach character level 3' → 3", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_CELESTIAL_REVELATION_XPHB)).toBe(3);
	});

	test("parses MPMM 'When you reach 3rd level' → 3", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_CELESTIAL_REVELATION_MPMM)).toBe(3);
	});

	test("parses 'Starting at 5th level' → 5", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({
			name: "Draconic Flight",
			entries: ["Starting at 5th level, you sprout spectral wings."],
		})).toBe(5);
	});

	test("parses 'Starting at character level 5' → 5 (Goliath Large Form phrasing)", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({
			name: "Large Form",
			entries: ["Starting at character level 5, you can change your size to Large as a Bonus Action."],
		})).toBe(5);
	});

	test("parses 'At character level 3' (no ordinal) → 3", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({
			name: "Gated",
			entries: ["At character level 3, you gain a thing."],
		})).toBe(3);
	});

	test("parses 'At 5th level' → 5 (Simic second enhancement style)", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({
			name: "Evolve",
			entries: ["At 5th level, your body evolves further."],
		})).toBe(5);
	});

	test("DOES NOT gate Dragonborn Breath Weapon (mid-sentence higher levels) → 1", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_BREATH_WEAPON)).toBe(1);
	});

	test("DOES NOT gate DMG Celestial Legacy (level mention in 2nd sentence) → 1", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_CELESTIAL_LEGACY_DMG)).toBe(1);
	});

	test("DOES NOT gate Simic Animal Enhancement (level-1 trait that scales) → 1", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_ANIMAL_ENHANCEMENT)).toBe(1);
	});

	test("plain level-1 traits default to 1", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_DARKVISION)).toBe(1);
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(ENTRY_CELESTIAL_RESISTANCE)).toBe(1);
	});

	test("missing/empty feature defaults to 1", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel(null)).toBe(1);
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({name: "Empty"})).toBe(1);
	});

	test("reads a leading gate from a plain description string when entries absent", () => {
		expect(CharacterSheetClassUtils.getFeatureUnlockLevel({
			name: "Late Bloomer",
			description: "When you reach character level 7, you gain a thing.",
		})).toBe(7);
	});
});

// ---------------------------------------------------------------------------
// Builder _addFeatureEntries gating
// ---------------------------------------------------------------------------

describe("CharacterSheetBuilder._addFeatureEntries level gating", () => {
	test("level-1 XPHB Aasimar does NOT get Celestial Revelation, keeps level-1 traits", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries(XPHB_AASIMAR_ENTRIES, "XPHB", "Species", 1);

		const names = captured.map(f => f.name);
		expect(names).toContain("Celestial Resistance");
		expect(names).toContain("Darkvision");
		expect(names).toContain("Light Bearer");
		expect(names).not.toContain("Celestial Revelation");
	});

	test("level-2 XPHB Aasimar still does NOT get Celestial Revelation", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries(XPHB_AASIMAR_ENTRIES, "XPHB", "Species", 2);
		expect(captured.map(f => f.name)).not.toContain("Celestial Revelation");
	});

	test("level-3 XPHB Aasimar DOES get Celestial Revelation", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries(XPHB_AASIMAR_ENTRIES, "XPHB", "Species", 3);
		const rev = captured.find(f => f.name === "Celestial Revelation");
		expect(rev).toBeDefined();
		expect(rev.featureType).toBe("Species");
	});

	test("level-1 DMG Aasimar gets Celestial Legacy but NEVER Celestial Revelation (regression guard)", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries(
			[ENTRY_DARKVISION, ENTRY_CELESTIAL_RESISTANCE, ENTRY_CELESTIAL_LEGACY_DMG],
			"DMG",
			"Species",
			1,
		);
		const names = captured.map(f => f.name);
		expect(names).toContain("Celestial Legacy");
		expect(names).not.toContain("Celestial Revelation");
	});

	test("level-1 MPMM variant does NOT get its level-3 Celestial Revelation", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries([ENTRY_CELESTIAL_REVELATION_MPMM], "MPMM", "Species", 1);
		expect(captured).toHaveLength(0);
	});

	test("Dragonborn Breath Weapon is granted at level 1 (no regression from gating)", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries([ENTRY_BREATH_WEAPON], "XPHB", "Species", 1);
		expect(captured.map(f => f.name)).toContain("Breath Weapon");
	});

	test("default characterLevel (omitted) behaves as level 1", () => {
		const {builder, captured} = makeBuilderWithCapture();
		builder._addFeatureEntries(XPHB_AASIMAR_ENTRIES, "XPHB", "Species");
		expect(captured.map(f => f.name)).not.toContain("Celestial Revelation");
	});

	test("_applyRacialTraits forwards the character's total level to the racial entry calls", () => {
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._selectedRace = {source: "XPHB", entries: XPHB_AASIMAR_ENTRIES};
		builder._selectedSubrace = {source: "XPHB", entries: [ENTRY_DARKVISION]};
		// Empty user-choice collections read by _applyRacialTraits.
		builder._selectedRacialTools = [];
		builder._selectedRacialSkills = [];
		builder._selectedRacialLanguages = {};
		builder._selectedSubraceLanguages = [];
		builder._state = {
			getTotalLevel: () => 4,
			setSpeed: () => {},
			setAbilityBonus: () => {},
			addNamedModifier: () => {},
			addToolProficiency: () => {},
		};
		builder._applyRacialSpells = () => {};
		builder._applyRaceFeatureGrants = () => {};

		// Spy on the gating method to capture the level argument it receives.
		const calls = [];
		builder._addFeatureEntries = (entries, source, featureType, characterLevel) => {
			calls.push({featureType, characterLevel});
		};

		builder._applyRacialTraits();

		const species = calls.find(c => c.featureType === "Species");
		const subrace = calls.find(c => c.featureType === "Subrace");
		expect(species).toBeDefined();
		expect(species.characterLevel).toBe(4);
		expect(subrace).toBeDefined();
		expect(subrace.characterLevel).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// updateRacialFeatures progression reconciler (state layer)
// ---------------------------------------------------------------------------

function makeStateAtLevel (race, level) {
	const state = new CharacterSheetState();
	state._data.classes = [{name: "Fighter", source: "PHB", level}];
	state.setRace(race, null);
	return state;
}

function featureNames (state) {
	return state.getFeatures().map(f => f.name);
}

describe("CharacterSheetClassUtils.updateRacialFeatures (progression)", () => {
	const XPHB_AASIMAR = {name: "Aasimar", source: "XPHB", entries: XPHB_AASIMAR_ENTRIES};

	test("level-1 build then reaching level 3 unlocks Celestial Revelation", () => {
		const state = makeStateAtLevel(XPHB_AASIMAR, 1);
		// Simulate the gated builder output at level 1.
		XPHB_AASIMAR_ENTRIES.forEach(entry => {
			if (CharacterSheetClassUtils.getFeatureUnlockLevel(entry) <= 1) {
				state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject({...entry, source: "XPHB"}, {featureType: "Species"}));
			}
		});
		expect(featureNames(state)).not.toContain("Celestial Revelation");

		// Level up to 3 and reconcile.
		state._data.classes[0].level = 3;
		CharacterSheetClassUtils.updateRacialFeatures(state);

		expect(featureNames(state)).toContain("Celestial Revelation");
		// Existing level-1 traits are not duplicated.
		expect(featureNames(state).filter(n => n === "Darkvision")).toHaveLength(1);
	});

	test("is idempotent — repeated reconciliation at level 3 keeps a single copy", () => {
		const state = makeStateAtLevel(XPHB_AASIMAR, 3);
		CharacterSheetClassUtils.updateRacialFeatures(state);
		CharacterSheetClassUtils.updateRacialFeatures(state);
		expect(featureNames(state).filter(n => n === "Celestial Revelation")).toHaveLength(1);
	});

	test("removes Celestial Revelation again on level-down below 3 (respec)", () => {
		const state = makeStateAtLevel(XPHB_AASIMAR, 3);
		CharacterSheetClassUtils.updateRacialFeatures(state);
		expect(featureNames(state)).toContain("Celestial Revelation");

		state._data.classes[0].level = 2;
		CharacterSheetClassUtils.updateRacialFeatures(state);
		expect(featureNames(state)).not.toContain("Celestial Revelation");
		// Level-1 traits survive the level-down.
		expect(featureNames(state)).toContain("Darkvision");
	});

	test("reconciles subrace entries as Subrace features", () => {
		const race = {name: "Test", source: "HB", entries: [ENTRY_DARKVISION]};
		const subrace = {name: "Test Sub", source: "HB", entries: [ENTRY_CELESTIAL_REVELATION_XPHB]};
		const state = new CharacterSheetState();
		state._data.classes = [{name: "Fighter", source: "PHB", level: 3}];
		state.setRace(race, subrace);
		CharacterSheetClassUtils.updateRacialFeatures(state);
		const rev = state.getFeatures().find(f => f.name === "Celestial Revelation");
		expect(rev).toBeDefined();
		expect(rev.featureType).toBe("Subrace");
	});

	test("Dragonborn Breath Weapon is present from level 1 via the reconciler (no under-grant)", () => {
		const dragonborn = {name: "Dragonborn", source: "XPHB", entries: [ENTRY_DARKVISION, ENTRY_BREATH_WEAPON]};
		const state = makeStateAtLevel(dragonborn, 1);
		CharacterSheetClassUtils.updateRacialFeatures(state);
		expect(featureNames(state)).toContain("Breath Weapon");
	});

	test("no race set is a safe no-op", () => {
		const state = new CharacterSheetState();
		expect(() => CharacterSheetClassUtils.updateRacialFeatures(state)).not.toThrow();
	});
});
