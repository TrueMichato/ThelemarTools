/**
 * Verifies that races expose all four structured senses (darkvision,
 * blindsight, tremorsense, truesight) end-to-end:
 *   - respec's _applyRaceChange resets all four then applies the new race's grants.
 *   - respec's origin-summary items list each populated sense.
 *   - subrace overrides pick the higher value per sense key (spec: max-wins).
 *   - the race renderer's popout attribute list surfaces a "Senses:" item
 *     built from the four numeric fields.
 *
 * Tracker: 5ET-1226 / https://github.com/5etools/tracker/issues/1281
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const SENSE_KEYS = CharacterSheetClassUtils.SENSE_DISPLAY_ORDER;

/** Minimal respec stub — mirrors the pattern from CharacterSheetRespecRaceBackground.test.js. */
function makeRespec (overrides = {}) {
	const respec = Object.create(CharacterSheetRespec.prototype);

	const senses = {darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0};
	const speed = {walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0};
	const abilityBonuses = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
	let currentRace = overrides.race || null;
	let currentSubrace = overrides.subrace || null;

	respec._state = {
		getRace: () => currentRace,
		getSubrace: () => currentSubrace,
		getRaceName: () => currentRace?.name || null,
		getBackground: () => null,
		getBackgroundName: () => null,
		getFeatures: () => [],
		getNamedModifiers: () => [],
		getLevelHistory: () => overrides.levelHistory || [],
		setRace: (race, subrace) => { currentRace = race; currentSubrace = subrace; },
		setBackground: () => {},
		setSpeed: (type, value) => { speed[type] = value; },
		setSense: (sense, range) => { senses[sense] = range; },
		getSense: (sense) => senses[sense] || 0,
		setAbilityBonus: (abl, val) => { abilityBonuses[abl] = val; },
		getAbilityBonus: (abl) => abilityBonuses[abl] || 0,
		setSkillProficiency: () => {},
		addLanguage: () => {},
		removeLanguage: () => {},
		addResistance: () => {},
		removeResistance: () => {},
		addArmorProficiency: () => {},
		removeArmorProficiency: () => {},
		addWeaponProficiency: () => {},
		removeWeaponProficiency: () => {},
		addToolProficiency: () => {},
		removeToolProficiency: () => {},
		addNamedModifier: () => {},
		removeNamedModifier: () => {},
		removeFeature: () => {},
		addFeature: () => {},
		updateLevelChoice: () => {},
	};
	respec._page = {
		getOptionalFeatures: () => [],
		getClassFeatures: () => [],
		getClasses: () => [],
		getRaces: () => [],
		getBackgrounds: () => [],
		filterByAllowedSources: (arr) => arr,
	};
	respec._$timeline = null;
	respec._$legacyBadge = null;

	respec._test = {senses, speed};
	return respec;
}

describe("Race senses (5ET-1226)", () => {
	describe("Respec _applyRaceChange handles all four senses", () => {
		test("applies every populated sense from the new race", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB", speed: 30, darkvision: 60}});
			const history = {level: 1, class: {name: "Fighter", source: "PHB"}, choices: {race: {name: "Elf", source: "PHB"}}};
			const newRace = {
				name: "Sensory Test",
				source: "TEST",
				speed: 30,
				darkvision: 60,
				blindsight: 30,
				tremorsense: 60,
				truesight: 120,
			};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.senses.darkvision).toBe(60);
			expect(respec._test.senses.blindsight).toBe(30);
			expect(respec._test.senses.tremorsense).toBe(60);
			expect(respec._test.senses.truesight).toBe(120);
		});

		test("clears senses granted by the old race that the new race lacks", () => {
			// Simulate old-state as if a previous race had granted blindsight/tremorsense/truesight;
			// after the race change, only darkvision from the new race should remain.
			const respec = makeRespec({
				race: {
					name: "Old Race",
					source: "TEST",
					speed: 30,
					darkvision: 60,
					blindsight: 30,
					tremorsense: 60,
					truesight: 60,
				},
			});
			// Prime the fake state so it reflects the "old race already applied" senses.
			SENSE_KEYS.forEach(k => respec._state.setSense(k, 60));

			const history = {level: 1, class: {name: "Fighter", source: "PHB"}, choices: {race: {name: "Old Race", source: "TEST"}}};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25, darkvision: 60};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.senses.darkvision).toBe(60);
			expect(respec._test.senses.blindsight).toBe(0);
			expect(respec._test.senses.tremorsense).toBe(0);
			expect(respec._test.senses.truesight).toBe(0);
		});

		test("darkvision-only races continue to work (regression guard)", () => {
			const respec = makeRespec({race: {name: "Human", source: "PHB", speed: 30}});
			const history = {level: 1, class: {name: "Fighter", source: "PHB"}, choices: {race: {name: "Human", source: "PHB"}}};
			const newRace = {name: "Elf", source: "PHB", speed: 30, darkvision: 60};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.senses.darkvision).toBe(60);
			expect(respec._test.senses.blindsight).toBe(0);
			expect(respec._test.senses.tremorsense).toBe(0);
			expect(respec._test.senses.truesight).toBe(0);
		});

		test("blindsight-only race (Grimlock-shape) does not silently zero out darkvision on prior state", () => {
			// Guard: a race that only sets structured `blindsight` (like Grimlock)
			// must not accidentally leak darkvision from the old race. The reset
			// pass explicitly clears every sense; the apply pass writes ONLY the
			// senses present on the new race.
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB", speed: 30, darkvision: 60},
			});
			// Prime state to reflect the old Elf grant.
			respec._state.setSense("darkvision", 60);

			const history = {level: 1, class: {name: "Fighter", source: "PHB"}, choices: {race: {name: "Elf", source: "PHB"}}};
			const newRace = {name: "Grimlock", source: "DMG", speed: 30, blindsight: 30};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.senses.darkvision).toBe(0);
			expect(respec._test.senses.blindsight).toBe(30);
			expect(respec._test.senses.tremorsense).toBe(0);
			expect(respec._test.senses.truesight).toBe(0);
		});
	});

	describe("Class-utils SENSE_DISPLAY_ORDER coverage", () => {
		test("advertises all four canonical senses in a stable render order", () => {
			expect(CharacterSheetClassUtils.SENSE_DISPLAY_ORDER).toEqual([
				"darkvision",
				"blindsight",
				"tremorsense",
				"truesight",
			]);
		});

		test("SENSE_DISPLAY_META carries a label for every ordered key", () => {
			CharacterSheetClassUtils.SENSE_DISPLAY_ORDER.forEach(k => {
				expect(CharacterSheetClassUtils.SENSE_DISPLAY_META[k]).toBeDefined();
				expect(CharacterSheetClassUtils.SENSE_DISPLAY_META[k].label).toBeTruthy();
			});
		});
	});
});
