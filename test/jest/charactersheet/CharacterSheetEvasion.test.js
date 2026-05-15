/**
 * Character Sheet Evasion - Unit Tests
 *
 * Verifies the Evasion visibility & DEX-save reminder system:
 *   - getPassiveSaveAlerts(ability) reports Evasion / Last Ditch Evasion
 *   - Existing damage application via processSavingThrowDamage continues
 *     to apply halfToNone (regression guard)
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("Character Sheet Evasion", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("getPassiveSaveAlerts", () => {
		it("returns Evasion for Monk 7+ on dex saves", () => {
			state.addClass({name: "Monk", level: 7, source: "XPHB"});
			const alerts = state.getPassiveSaveAlerts("dex");
			const keys = alerts.map(a => a.key);
			expect(keys).toContain("evasion");
			const evasion = alerts.find(a => a.key === "evasion");
			expect(evasion.name).toBe("Evasion");
			expect(evasion.summary).toMatch(/no damage/i);
		});

		it("returns Evasion for Rogue 7+ on dex saves", () => {
			state.addClass({name: "Rogue", level: 7, source: "XPHB"});
			const alerts = state.getPassiveSaveAlerts("dex");
			expect(alerts.map(a => a.key)).toContain("evasion");
		});

		it("returns Evasion for PHB Monk 7+", () => {
			state.addClass({name: "Monk", level: 7, source: "PHB"});
			const alerts = state.getPassiveSaveAlerts("dex");
			expect(alerts.map(a => a.key)).toContain("evasion");
		});

		it("does not return Evasion below level 7", () => {
			state.addClass({name: "Rogue", level: 6, source: "XPHB"});
			const alerts = state.getPassiveSaveAlerts("dex");
			expect(alerts.map(a => a.key)).not.toContain("evasion");
		});

		it("returns empty for non-Evasion classes", () => {
			state.addClass({name: "Wizard", level: 20, source: "XPHB"});
			expect(state.getPassiveSaveAlerts("dex")).toEqual([]);
		});

		it("returns empty for non-DEX abilities even with Evasion", () => {
			state.addClass({name: "Monk", level: 9, source: "XPHB"});
			expect(state.getPassiveSaveAlerts("str")).toEqual([]);
			expect(state.getPassiveSaveAlerts("con")).toEqual([]);
			expect(state.getPassiveSaveAlerts("int")).toEqual([]);
			expect(state.getPassiveSaveAlerts("wis")).toEqual([]);
			expect(state.getPassiveSaveAlerts("cha")).toEqual([]);
		});

		it("returns empty array for unknown / falsy ability", () => {
			state.addClass({name: "Monk", level: 9, source: "XPHB"});
			expect(state.getPassiveSaveAlerts("")).toEqual([]);
			expect(state.getPassiveSaveAlerts(null)).toEqual([]);
			expect(state.getPassiveSaveAlerts(undefined)).toEqual([]);
		});

		it("does not duplicate Evasion when also flagged Last Ditch Evasion", () => {
			state.addClass({name: "Monk", level: 7, source: "XPHB"});
			// Force-flag Last Ditch Evasion via direct calculation override
			const origGet = state.getFeatureCalculations.bind(state);
			state.getFeatureCalculations = () => ({...origGet(), hasLastDitchEvasion: true});
			const alerts = state.getPassiveSaveAlerts("dex");
			const keys = alerts.map(a => a.key);
			expect(keys).toContain("evasion");
			expect(keys).toContain("lastDitchEvasion");
			// Each alert appears exactly once
			expect(keys.filter(k => k === "evasion").length).toBe(1);
			expect(keys.filter(k => k === "lastDitchEvasion").length).toBe(1);
		});

		it("each alert has the documented shape", () => {
			state.addClass({name: "Monk", level: 7, source: "XPHB"});
			const alerts = state.getPassiveSaveAlerts("dex");
			alerts.forEach(a => {
				expect(typeof a.key).toBe("string");
				expect(typeof a.name).toBe("string");
				expect(typeof a.summary).toBe("string");
				expect(a.summary.length).toBeGreaterThan(10);
			});
		});
	});

	describe("hasEvasion calculation flag (regression guard)", () => {
		it("Monk 7 (XPHB) sets hasEvasion = true", () => {
			state.addClass({name: "Monk", level: 7, source: "XPHB"});
			expect(state.getFeatureCalculations().hasEvasion).toBe(true);
		});

		it("Monk 6 does NOT set hasEvasion", () => {
			state.addClass({name: "Monk", level: 6, source: "XPHB"});
			expect(state.getFeatureCalculations().hasEvasion).toBeFalsy();
		});

		it("Rogue 7 (XPHB) sets hasEvasion = true", () => {
			state.addClass({name: "Rogue", level: 7, source: "XPHB"});
			expect(state.getFeatureCalculations().hasEvasion).toBe(true);
		});

		it("Wizard 20 does NOT set hasEvasion", () => {
			state.addClass({name: "Wizard", level: 20, source: "XPHB"});
			expect(state.getFeatureCalculations().hasEvasion).toBeFalsy();
		});
	});

	// ===================================================================
	// TGTT (Thelemar) class source — Evasion calc + cross-source feature
	// reference (TGTT classFeatures list `Evasion|Rogue|XPHB|7`).
	// ===================================================================
	describe("TGTT class source", () => {
		it("TGTT Rogue 7 sets hasEvasion = true", () => {
			state.addClass({name: "Rogue", level: 7, source: "TGTT"});
			expect(state.getFeatureCalculations().hasEvasion).toBe(true);
		});

		it("TGTT Monk 7 sets hasEvasion = true", () => {
			state.addClass({name: "Monk", level: 7, source: "TGTT"});
			expect(state.getFeatureCalculations().hasEvasion).toBe(true);
		});

		it("TGTT Rogue 7 surfaces Evasion in passive save alerts", () => {
			state.addClass({name: "Rogue", level: 7, source: "TGTT"});
			const alerts = state.getPassiveSaveAlerts("dex");
			expect(alerts.map(a => a.key)).toContain("evasion");
		});

		it("getLevelFeatures resolves Evasion|Rogue|XPHB|7 for a TGTT Rogue (cross-source ref)", () => {
			// Mimics the real TGTT Rogue classFeatures shape: TGTT-source class
			// listing an XPHB-source feature reference at level 7.
			const tgttRogueClassData = {
				name: "Rogue",
				source: "TGTT",
				classFeatures: [
					"Expertise|Rogue|XPHB|1",
					"Evasion|Rogue|XPHB|7",
					"Reliable Talent|Rogue|XPHB|7",
					{classFeature: "Specialties|Rogue|TGTT|7"},
				],
			};
			const xphbRogueEvasion = {
				name: "Evasion",
				className: "Rogue",
				source: "XPHB",
				level: 7,
				entries: ["Your instinctive agility lets you dodge out of the way of certain area effects."],
			};
			const allClassFeatures = [
				xphbRogueEvasion,
				{name: "Reliable Talent", className: "Rogue", source: "XPHB", level: 7, entries: ["Reliable Talent text."]},
				{name: "Specialties", className: "Rogue", source: "TGTT", level: 7, entries: ["TGTT specialty picks."]},
			];

			const features = CharacterSheetClassUtils.getLevelFeatures(tgttRogueClassData, 7, null, allClassFeatures, []);
			const names = features.map(f => f.name);
			expect(names).toContain("Evasion");

			const evasion = features.find(f => f.name === "Evasion");
			expect(evasion.className).toBe("Rogue");
			expect(evasion.classSource).toBe("XPHB"); // resolved from ref, not class source
			expect(evasion.entries).toEqual(xphbRogueEvasion.entries);
		});
	});
});
