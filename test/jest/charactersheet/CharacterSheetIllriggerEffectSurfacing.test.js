/**
 * Illrigger Specialty & Interdict-Boon effect SURFACING (R20 #15, #16).
 *
 * R19 registered per-specialty effects (FeatureEffectRegistry + specialty calc) and
 * per-boon calc fields (INTERDICT_BOON_FIELDS), but none of them reached the sheet:
 *
 *   #15 ROOT CAUSE — registry-passive specialty effects (Dark Resilience fire resistance,
 *        skill-advantages, carry) only flow through `applyClassFeatureEffects()`, which the
 *        level-up wizard never re-ran after a pick → effects appeared only after a reload.
 *   #16 ROOT CAUSE — the per-boon calc fields (soulEaterTempHp, vengefulShotBonus, …) were
 *        computed but read by NOTHING in the render layer → boons looked "not implemented".
 *
 * This suite proves the EFFECTS surface end-to-end:
 *   - choosing a passive specialty puts its effect on the sheet after the apply pass, and
 *   - every selected boon / calc-only specialty yields a rendered effect summary string.
 */
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEVELUP_SRC = readFileSync(
	resolve(__dirname, "../../../js/charactersheet/charactersheet-levelup.js"),
	"utf8",
);
const FEATURES_SRC = readFileSync(
	resolve(__dirname, "../../../js/charactersheet/charactersheet-features.js"),
	"utf8",
);

function buildIllrigger (level = 10, {cha} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level});
	if (cha != null) state._data.abilities.cha = cha;
	return state;
}

/** Add a chosen specialty exactly as the level-up wizard stores it (feature-option). */
function addSpecialty (state, name) {
	state._data.features.push({
		name,
		featureType: ["Class"],
		className: "Illrigger",
		source: "TGTT-IllR",
		isFeatureOption: true,
		parentFeature: "Specialties",
	});
	return state;
}

/** Add a chosen Interdict Boon exactly as it is stored when picked. */
function addBoon (state, name) {
	state._data.features.push({name, featureType: ["ItdBoon"], source: "TGTT-IllR"});
	return state;
}

// ==========================================================================
// #15 — Specialty passive effects surface after the apply pass (no reload)
// ==========================================================================
describe("R20 #15 — specialty registry effects surface end-to-end", () => {
	test("Dark Resilience grants fire resistance after applyClassFeatureEffects", () => {
		const state = buildIllrigger(3);
		addSpecialty(state, "Dark Resilience");
		// Before the apply pass (i.e. right after the pick) nothing is on the sheet…
		expect(state._data.resistances).not.toContain("fire");
		// …the apply pass the wizard now runs surfaces it.
		state.applyClassFeatureEffects();
		expect(state._data.resistances).toContain("fire");
	});

	test("Purge Toxins grants poison resistance + advantage vs. poisoned", () => {
		const state = buildIllrigger(5);
		addSpecialty(state, "Purge Toxins");
		state.applyClassFeatureEffects();
		expect(state._data.resistances).toContain("poison");
		const adv = (state._data.namedModifiers || []).find(
			m => m.type === "save:advantage:poisoned",
		);
		expect(adv).toBeTruthy();
	});

	test("Faceless Mask grants conditional Stealth & Deception advantage", () => {
		const state = buildIllrigger(3);
		addSpecialty(state, "Faceless Mask");
		state.applyClassFeatureEffects();
		const mods = (state._data.namedModifiers || []).filter(m => m.advantage);
		expect(mods.some(m => m.type === "skill:stealth")).toBe(true);
		expect(mods.some(m => m.type === "skill:deception")).toBe(true);
	});

	test("Infernal Constitution doubles carrying capacity", () => {
		const state = buildIllrigger(3);
		addSpecialty(state, "Infernal Constitution");
		state.applyClassFeatureEffects();
		const carry = (state._data.namedModifiers || []).find(
			m => m.type === "carryCapacity",
		);
		expect(carry).toBeTruthy();
		expect(carry.multiplier).toBe(2);
	});

	test("survives a save round-trip (resistance persists after reload)", () => {
		const state = buildIllrigger(3);
		addSpecialty(state, "Dark Resilience");
		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		expect(reloaded._data.resistances).toContain("fire");
	});
});

// ==========================================================================
// #15 ROOT CAUSE GUARD — the level-up wizard must re-run the apply pass
// ==========================================================================
describe("R20 #15 — level-up wizard surfaces picked passive effects", () => {
	test("_applyLevelUp calls applyClassFeatureEffects()", () => {
		expect(LEVELUP_SRC).toMatch(/this\._state\.applyClassFeatureEffects\(\)/);
	});

	test("the apply pass runs before recalculateHp (hpBonus effects reflected)", () => {
		const applyIdx = LEVELUP_SRC.indexOf("this._state.applyClassFeatureEffects()");
		const recalcIdx = LEVELUP_SRC.indexOf("this._state.recalculateHp({syncCurrent: true})");
		expect(applyIdx).toBeGreaterThan(-1);
		expect(recalcIdx).toBeGreaterThan(-1);
		expect(applyIdx).toBeLessThan(recalcIdx);
	});
});

// ==========================================================================
// #16 — every selected boon yields a rendered effect summary
// ==========================================================================
describe("R20 #16 — Interdict Boon effect summaries surface", () => {
	test("Soul Eater surfaces its level-scaled temporary HP", () => {
		const state = buildIllrigger(13);
		addBoon(state, "Soul Eater");
		const boon = state.getInterdictBoons()[0];
		expect(state.getFeatureEffectSummary(boon)).toBe("Temp HP 13");
	});

	// Representative sample across the boon categories (damage / DC / range / penalty / reduction).
	const SAMPLE = [
		{boon: "Vengeful Shot", level: 10, expected: "+5 damage"},
		{boon: "Soul's Doom", level: 10, expected: "+4 damage"},
		{boon: "Abating Seal", level: 10, expected: "Damage reduction 1d10 + 5"},
		{boon: "Bedevil", level: 10, expected: "Imposes −4 to a save"},
		{boon: "Impaling Shot", level: 10, expected: "Imposes −4 AC"},
		{boon: "Conflagrant Channel", level: 10, expected: "Range 60 ft."},
		{boon: "Sanguine Gift", level: 10, expected: "Heal 10 HP"},
		{boon: "Dispater's Supremacy (Passive)", level: 10, expected: "Crits on 18–20 vs. interdicted"},
		{boon: "Hell Mage (Passive)", level: 10, expected: "Place up to 4 seals"},
	];
	SAMPLE.forEach(({boon, level, expected}) => {
		test(`${boon} → "${expected}"`, () => {
			const state = buildIllrigger(level);
			addBoon(state, boon);
			expect(state.getFeatureEffectSummary(state.getInterdictBoons()[0])).toBe(expected);
		});
	});

	test("DC-based boons resolve the live Interdict save DC", () => {
		const state = buildIllrigger(10, {cha: 18}); // 8 + prof(4) + cha(4) = 16
		addBoon(state, "Acheron's Chain");
		const expectedDc = state.getFeatureCalculations().interdictDc;
		expect(state.getFeatureEffectSummary(state.getInterdictBoons()[0]))
			.toBe(`Save DC ${expectedDc}`);
	});

	test("toggle boons surface a derived label (so they remain visible once the active-state toggle is removed)", () => {
		// R21 #8: the four live-toggle boons previously returned "" because their effect was
		// only conveyed via the active-state toggle; they now carry a real summary label.
		const state = buildIllrigger(10);
		addBoon(state, "Hellish Frenzy");
		addBoon(state, "Shadow Shroud");
		addBoon(state, "Hellsight");
		addBoon(state, "Veil of Lies");
		const boons = state.getInterdictBoons();
		boons.forEach(b => expect(state.getFeatureEffectSummary(b)).toBeTruthy());
	});

	test("purely-narrative / enemy-side boons surface no derived label", () => {
		const state = buildIllrigger(10);
		addBoon(state, "Dark Malediction (Passive)"); // narrative aura
		addBoon(state, "Unleash Hell"); // enemy-side / narrative
		const boons = state.getInterdictBoons();
		boons.forEach(b => expect(state.getFeatureEffectSummary(b)).toBe(""));
	});

	test("summary map covers every boon in the field map", () => {
		const fieldKeys = Object.keys(CharacterSheetState.INTERDICT_BOON_FIELDS).sort();
		const summaryKeys = Object.keys(CharacterSheetState.INTERDICT_BOON_SUMMARIES).sort();
		expect(summaryKeys).toEqual(fieldKeys);
	});
});

// ==========================================================================
// #15 — calc-only specialties surface their level-scaled numbers
// ==========================================================================
describe("R20 #15 — calc-only specialty summaries surface", () => {
	test("Hellish Avenger surfaces its fire damage die (scales at L11)", () => {
		const s5 = buildIllrigger(5);
		addSpecialty(s5, "Hellish Avenger");
		expect(s5.getFeatureEffectSummary(s5._data.features.at(-1))).toBe("+1d8 fire (1/turn)");

		const s11 = buildIllrigger(11);
		addSpecialty(s11, "Hellish Avenger");
		expect(s11.getFeatureEffectSummary(s11._data.features.at(-1))).toBe("+2d8 fire (1/turn)");
	});

	test("Infernal Awareness surfaces its blindsight range", () => {
		const state = buildIllrigger(7);
		addSpecialty(state, "Infernal Awareness");
		expect(state.getFeatureEffectSummary(state._data.features.at(-1)))
			.toBe("Blindsight 10 ft.");
	});

	test("Infernal Supremacy surfaces its Interdict-DC bump", () => {
		const state = buildIllrigger(19);
		addSpecialty(state, "Infernal Supremacy");
		expect(state.getFeatureEffectSummary(state._data.features.at(-1)))
			.toBe("+1 Interdict save DC");
	});

	test("Do Without surfaces its Charisma-scaled endurance", () => {
		const state = buildIllrigger(3, {cha: 16}); // +3
		addSpecialty(state, "Do Without");
		expect(state.getFeatureEffectSummary(state._data.features.at(-1)))
			.toBe("Endure 3 days without food/water");
	});

	test("a specialty with no derivable number surfaces no label", () => {
		const state = buildIllrigger(3);
		addSpecialty(state, "Negate Fall");
		expect(state.getFeatureEffectSummary(state._data.features.at(-1))).toBe("");
	});
});

// ==========================================================================
// #16 RENDER GUARD — the Features panel actually paints the summary
// ==========================================================================
describe("R20 #16 — Features panel renders the derived effect", () => {
	test("_renderFeature reads getFeatureEffectSummary and renders a badge + row", () => {
		expect(FEATURES_SRC).toMatch(/this\._state\.getFeatureEffectSummary\?\.\(feature\)/);
		expect(FEATURES_SRC).toMatch(/derivedEffectBadge/);
		expect(FEATURES_SRC).toMatch(/derivedEffectRow/);
	});
});
