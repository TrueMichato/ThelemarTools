/**
 * Regression tests for the Druid multiclass / Primal Order (Magician) bug fixes:
 *  - Same-named class variants (XPHB Druid vs TGTT Druid) are collapsed to a single
 *    preferred entry so multiclassing resolves to the variant whose features (Specialties,
 *    Primal Order, …) actually exist.
 *  - The Druid "Magician" Primal Order option grants one extra cantrip, surfaced via the
 *    central spellcasting cantrip budget so every flow (builder/multiclass/respec/load)
 *    can offer the extra pick.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

// XPHB / TGTT Druid prepared-caster progression (level 1 values are all that matter here).
const DRUID_CANTRIP_PROGRESSION = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const DRUID_PREPARED_PROGRESSION = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];

const makeDruid = (source) => ({
	name: "Druid",
	source,
	level: 1,
	cantripProgression: DRUID_CANTRIP_PROGRESSION,
	preparedSpellsProgression: DRUID_PREPARED_PROGRESSION,
	spellcastingAbility: "wis",
	casterProgression: "full",
});

describe("dedupeClassesBySourcePreference", () => {
	const xphbDruid = {name: "Druid", source: "XPHB"};
	const tgttDruid = {name: "Druid", source: "TGTT"};
	const phbDruid = {name: "Druid", source: "PHB"};
	const wizard = {name: "Wizard", source: "XPHB"};

	test("collapses same-named variants to a single entry", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[xphbDruid, tgttDruid, wizard],
			{existingClasses: [], enableTgtt: true},
		);
		const druids = out.filter((c) => c.name === "Druid");
		expect(druids).toHaveLength(1);
		expect(out.some((c) => c.name === "Wizard")).toBe(true);
	});

	test("prefers TGTT when TGTT is enabled", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[xphbDruid, tgttDruid],
			{existingClasses: [], enableTgtt: true},
		);
		expect(out.find((c) => c.name === "Druid").source).toBe("TGTT");
	});

	test("prefers XPHB over TGTT when TGTT is disabled", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[tgttDruid, xphbDruid],
			{existingClasses: [], enableTgtt: false},
		);
		expect(out.find((c) => c.name === "Druid").source).toBe("XPHB");
	});

	test("prefers a source the character already uses over everything else", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[xphbDruid, tgttDruid, phbDruid],
			{existingClasses: [{name: "Ranger", source: "PHB"}], enableTgtt: true},
		);
		expect(out.find((c) => c.name === "Druid").source).toBe("PHB");
	});

	test("falls back to XPHB then PHB when neither TGTT nor existing-source apply", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[phbDruid, xphbDruid],
			{existingClasses: [], enableTgtt: false},
		);
		expect(out.find((c) => c.name === "Druid").source).toBe("XPHB");
	});

	test("returns input unchanged when empty / single", () => {
		expect(CharacterSheetClassUtils.dedupeClassesBySourcePreference([], {})).toEqual([]);
		const single = [xphbDruid];
		expect(CharacterSheetClassUtils.dedupeClassesBySourcePreference(single, {})).toEqual(single);
	});

	test("preserves first-seen order of distinct names", () => {
		const out = CharacterSheetClassUtils.dedupeClassesBySourcePreference(
			[wizard, xphbDruid, tgttDruid],
			{existingClasses: [], enableTgtt: true},
		);
		expect(out.map((c) => c.name)).toEqual(["Wizard", "Druid"]);
	});
});

describe("getMagicianBonusCantripCount", () => {
	test("returns 1 when Magician is among selected options", () => {
		expect(CharacterSheetClassUtils.getMagicianBonusCantripCount([
			{name: "Warden"}, {name: "Magician"},
		])).toBe(1);
	});

	test("is case-insensitive", () => {
		expect(CharacterSheetClassUtils.getMagicianBonusCantripCount([{name: "magician"}])).toBe(1);
	});

	test("returns 0 when only Warden is selected", () => {
		expect(CharacterSheetClassUtils.getMagicianBonusCantripCount([{name: "Warden"}])).toBe(0);
	});

	test("returns 0 for empty / nullish input", () => {
		expect(CharacterSheetClassUtils.getMagicianBonusCantripCount([])).toBe(0);
		expect(CharacterSheetClassUtils.getMagicianBonusCantripCount(undefined)).toBe(0);
	});
});

describe("Magician extra cantrip — central spellcasting budget", () => {
	const buildDruid = (source) => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16);
		state.addClass(makeDruid(source));
		return state;
	};

	test("Druid without Primal Order choice gets base cantrips known", () => {
		const state = buildDruid("TGTT");
		const info = state.getSpellcastingInfo();
		expect(info.cantripsKnown).toBe(2);
	});

	test("Druid with Magician gets one extra cantrip known", () => {
		const state = buildDruid("TGTT");
		state.addFeature({name: "Magician", source: "XPHB", parentFeature: "Primal Order"});
		const info = state.getSpellcastingInfo();
		expect(info.cantripsKnown).toBe(3);
	});

	test("Druid with Warden gets no extra cantrip", () => {
		const state = buildDruid("TGTT");
		state.addFeature({name: "Warden", source: "XPHB", parentFeature: "Primal Order"});
		const info = state.getSpellcastingInfo();
		expect(info.cantripsKnown).toBe(2);
	});

	test("XPHB-sourced Druid with Magician also gets the bonus", () => {
		const state = buildDruid("XPHB");
		state.addFeature({name: "Magician", source: "XPHB", parentFeature: "Primal Order"});
		const info = state.getSpellcastingInfo();
		expect(info.cantripsKnown).toBe(3);
	});

	test("Magician on a non-Druid class does not inflate that class's cantrips", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("int", 16);
		state.addClass({
			name: "Wizard",
			source: "XPHB",
			level: 1,
			cantripProgression: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
			spellsKnownProgressionFixed: [6],
			spellcastingAbility: "int",
			casterProgression: "full",
		});
		// Stray Magician feature (shouldn't happen in practice) must not affect Wizard cantrips.
		state.addFeature({name: "Magician", source: "XPHB"});
		const info = state.getSpellcastingInfo();
		expect(info.cantripsKnown).toBe(3);
	});
});
