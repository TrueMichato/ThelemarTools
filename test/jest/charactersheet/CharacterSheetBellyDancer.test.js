/**
 * Rogue / The Belly Dancer (TGTT) — EFFECT-level coverage.
 *
 * Unlike the older Belly Dancer blocks in CharacterSheetTGTT.test.js, which assert
 * that a feature was added and stop there, every test in this file drives the REAL
 * feature text out of `homebrew/TravelersGuidetoThelemar.json` and then asserts on a
 * measurable consequence: an AC number, an advantage flag, a resource, a Sneak Attack
 * licence, a DC, a save outcome, or a save/load round-trip.
 *
 * A feature can be present and inert. These tests are designed to fail when it is.
 */

import "./setup.js";
import fs from "fs";
import path from "path";

let CharacterSheetState;

const brew = JSON.parse(fs.readFileSync(path.resolve("homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const BD_FEATURES = brew.subclassFeature.filter(f => f.subclassShortName === "Belly Dancer" && f.className === "Rogue");

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** Flatten a homebrew `entries` tree into the plain description string the sheet parses. */
function entriesToText (entries) {
	const out = [];
	const walk = e => {
		if (typeof e === "string") out.push(e);
		else if (Array.isArray(e)) e.forEach(walk);
		else if (e?.entries) walk(e.entries);
		else if (e?.items) walk(e.items);
	};
	walk(entries);
	return out.join(" ");
}

/**
 * Build a Belly Dancer rogue at `level`, using the REAL homebrew feature entries.
 * @param {number} level
 * @param {object} [abilities]
 */
function makeBellyDancer (level, abilities = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", abilities.dex ?? 18);
	state.setAbilityBase("cha", abilities.cha ?? 16);
	state.setAbilityBase("con", abilities.con ?? 12);
	state.addClass({
		name: "Rogue",
		source: "PHB",
		level,
		subclass: {name: "The Belly Dancer", shortName: "Belly Dancer", source: "TGTT"},
	});
	BD_FEATURES.filter(f => f.level <= level).forEach(f => {
		state.addFeature({
			name: f.name,
			source: "TGTT",
			featureType: "Subclass",
			level: f.level,
			description: entriesToText(f.entries),
			className: "Rogue",
			subclassName: "The Belly Dancer",
			subclassShortName: "Belly Dancer",
		});
	});
	return state;
}

describe("Rogue / The Belly Dancer (TGTT) — effect-level", () => {
	describe("data sanity", () => {
		it("has exactly the five documented features at the documented levels", () => {
			const byLevel = BD_FEATURES.map(f => `${f.level}:${f.name}`).sort();
			expect(byLevel).toEqual([
				"13:Fluid Step",
				"17:Percussive Strike",
				"3:Bonus Proficiency",
				"3:Dance of the Country",
				"9:Tantalizing Shivers",
			]);
		});

		it("Dance of the Country is a single toggle, NOT a pick-a-dance choice feature", () => {
			const dance = BD_FEATURES.find(f => f.name === "Dance of the Country");
			const text = entriesToText(dance.entries);
			expect(text).toMatch(/start Dancing/i);
			expect(text).toMatch(/stop doing so at will/i);
			// No sub-list of named dances to choose between.
			expect(text).not.toMatch(/choose (one|a dance)/i);
		});
	});

	// ==========================================================
	// L3 — Bonus Proficiency
	// ==========================================================
	describe("L3 — Bonus Proficiency", () => {
		it("grants EXPERTISE in Performance (not mere proficiency)", () => {
			const state = makeBellyDancer(3);
			expect(state.getSkillProficiency("performance")).toBe(2);
			expect(state.getExpertise()).toContain("performance");
		});

		it("flags Concealed weapons in the feature calculations", () => {
			expect(makeBellyDancer(3).getFeatureCalculations().hasConcealedWeapons).toBe(true);
			expect(makeBellyDancer(2).getFeatureCalculations().hasConcealedWeapons).toBeFalsy();
		});

		it("surfaces the Concealed advantage as a CONDITIONAL Sleight of Hand modifier", () => {
			const state = makeBellyDancer(3);
			const agg = state.aggregateModifiers("skill:sleightofhand", {});
			// Gated by default (repo convention) — offered in the per-roll picker...
			expect(agg.advantage).toBe(false);
			const conditional = agg.conditionalsAvailable.find(c => /Concealed/i.test(c.name));
			expect(conditional).toBeDefined();
			expect(conditional.advantage).toBe(true);
			expect(conditional.conditional).toMatch(/hidden/i);
		});

		it("applies the Concealed advantage when the player opts in for that roll", () => {
			const state = makeBellyDancer(3);
			const {conditionalsAvailable} = state.aggregateModifiers("skill:sleightofhand", {});
			const applied = state.aggregateModifiers("skill:sleightofhand", {
				appliedConditionalIds: new Set([conditionalsAvailable[0].id]),
			});
			expect(applied.advantage).toBe(true);
		});
	});

	// ==========================================================
	// L3 — Dance of the Country
	// ==========================================================
	describe("L3 — Dance of the Country", () => {
		it("is SURFACED as a bonus-action toggle in the activatable list", () => {
			const state = makeBellyDancer(3);
			const entry = state.getActivatableFeatures().find(a => a.feature.name === "Dance of the Country");
			expect(entry).toBeDefined();
			expect(entry.interactionMode).toBe("toggle");
			expect(entry.stateTypeId).toBe("dancing");
		});

		it("grants a resource of PB uses that recharges on a SHORT rest", () => {
			for (const [level, pb] of [[3, 2], [9, 4], [13, 5], [17, 6]]) {
				const state = makeBellyDancer(level);
				const res = state.getResources().find(r => r.name === "Dance of the Country");
				expect(res).toBeDefined();
				expect(res.max).toBe(pb);
				expect(res.recharge).toBe("short");
			}
		});

		it("raises AC by the CHA modifier while Dancing, and only while Dancing", () => {
			const state = makeBellyDancer(3, {cha: 16, dex: 18});
			const before = state.getAc();
			state.activateState("dancing");
			expect(state.getAc()).toBe(before + 3);
			state.deactivateState("dancing");
			expect(state.getAc()).toBe(before);
		});

		it("enforces the documented MINIMUM +1 AC when the CHA modifier is negative", () => {
			const state = makeBellyDancer(3, {cha: 8}); // -1
			const before = state.getAc();
			state.activateState("dancing");
			expect(state.getAc()).toBe(before + 1);
		});

		it("grants advantage on Dexterity (ACROBATICS) — not Athletics (CS-BUG-014)", () => {
			const state = makeBellyDancer(3);
			state.activateState("dancing");
			expect(state.getSkillAdvantageState("acrobatics").advantage).toBe(true);
			expect(state.getSkillAdvantageState("athletics").advantage).toBe(false);
		});

		it("licenses Sneak Attack without advantage — in MELEE range only", () => {
			const state = makeBellyDancer(3);
			expect(state.canSneakAttackWithoutAdvantage({isMelee: true})).toBe(false);
			state.activateState("dancing");
			expect(state.canSneakAttackWithoutAdvantage({isMelee: true})).toBe(true);
			// "creatures within your melee range" — ranged attacks get no licence.
			expect(state.canSneakAttackWithoutAdvantage({isMelee: false})).toBe(false);
			state.deactivateState("dancing");
			expect(state.canSneakAttackWithoutAdvantage({isMelee: true})).toBe(false);
		});

		it("declares the documented end conditions (heavy armor, not all armor)", () => {
			const state = makeBellyDancer(3);
			state.activateState("dancing");
			const active = state.getActiveStates().find(s => s.stateTypeId === "dancing");
			const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.dancing;
			expect(active).toBeDefined();
			expect(stateType.endConditions).toEqual(
				expect.arrayContaining(["Incapacitated", "Paralyzed", "Restrained"]),
			);
			expect(stateType.endConditions.join("|")).toMatch(/heavy armor/i);
			expect(stateType.endConditions.join("|")).not.toMatch(/^Wearing armor$/i);
		});

		it("declares a DC 10 CON end-of-dance save", () => {
			const save = makeBellyDancer(3).getStateEndSave("dancing");
			expect(save).toMatchObject({ability: "con", dc: 10, onFailure: {exhaustion: 1}});
		});

		it("applies one level of exhaustion when the end save FAILS", () => {
			const state = makeBellyDancer(3);
			expect(state.getExhaustion()).toBe(0);
			const result = state.resolveStateEndSave("dancing", {total: 5});
			expect(result).toMatchObject({success: false, dc: 10, exhaustionGained: 1});
			expect(state.getExhaustion()).toBe(1);
		});

		it("applies NO exhaustion when the end save SUCCEEDS", () => {
			const state = makeBellyDancer(3);
			const result = state.resolveStateEndSave("dancing", {total: 10}); // meets DC
			expect(result).toMatchObject({success: true, exhaustionGained: 0});
			expect(state.getExhaustion()).toBe(0);
		});

		it("lasts 1 minute", () => {
			expect(String(CharacterSheetState.ACTIVE_STATE_TYPES.dancing.duration)).toMatch(/1 minute|^10$/);
		});
	});

	// ==========================================================
	// L9 — Tantalizing Shivers
	// ==========================================================
	describe("L9 — Tantalizing Shivers", () => {
		it("is not offered before level 9", () => {
			const state = makeBellyDancer(3);
			state.activateState("dancing");
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Tantalizing Shivers")).toBe(false);
		});

		it("is HIDDEN until the Dance is running, then surfaced as a toggle", () => {
			const state = makeBellyDancer(9);
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Tantalizing Shivers")).toBe(false);
			state.activateState("dancing");
			const entry = state.getActivatableFeatures().find(a => a.feature.name === "Tantalizing Shivers");
			expect(entry).toBeDefined();
			expect(entry.stateTypeId).toBe("tantalizingShivers");
		});

		it("exposes a Charisma (Performance) contest vs Wisdom (Insight) while Dancing", () => {
			const state = makeBellyDancer(9, {cha: 16});
			// "a bonus action while Dancing" — no contest is offered outside the Dance.
			expect(state.getTantalizingShiversContest()).toBeNull();
			state.activateState("dancing");
			const contest = state.getTantalizingShiversContest();
			expect(contest).toMatchObject({skill: "performance", ability: "cha", opposedBy: "Wisdom (Insight)"});
			// CHA +3, Expertise in Performance at PB +4 => +3 + 8 = +11
			expect(contest.modifier).toBe(11);
		});

		it("returns no contest below level 9", () => {
			const state = makeBellyDancer(3);
			state.activateState("dancing");
			expect(state.getTantalizingShiversContest()).toBeNull();
		});

		it("grants ADVANTAGE ON ATTACKS while active", () => {
			const state = makeBellyDancer(9);
			state.activateState("dancing");
			expect(state.hasAdvantageFromStates("attack")).toBe(false);
			state.activateState("tantalizingShivers");
			expect(state.hasAdvantageFromStates("attack")).toBe(true);
		});

		it("ends automatically when the Dance ends", () => {
			const state = makeBellyDancer(9);
			state.activateState("dancing");
			state.activateState("tantalizingShivers");
			expect(state.isStateTypeActive("tantalizingShivers")).toBe(true);
			state.deactivateState("dancing");
			expect(state.isStateTypeActive("tantalizingShivers")).toBe(false);
		});

		it("lasts one round", () => {
			expect(String(CharacterSheetState.ACTIVE_STATE_TYPES.tantalizingShivers.duration)).toMatch(/1 round|^1$/);
		});
	});

	// ==========================================================
	// L13 — Fluid Step
	// ==========================================================
	describe("L13 — Fluid Step", () => {
		it("grants the Disengage benefit while Dancing, and only while Dancing", () => {
			const state = makeBellyDancer(13);
			expect(state.hasActionBenefitFromStates("disengage")).toBe(false);
			state.activateState("dancing");
			expect(state.hasActionBenefitFromStates("disengage")).toBe(true);
			state.deactivateState("dancing");
			expect(state.hasActionBenefitFromStates("disengage")).toBe(false);
		});

		it("does NOT grant the Disengage benefit below level 13", () => {
			const state = makeBellyDancer(12);
			state.activateState("dancing");
			expect(state.hasActionBenefitFromStates("disengage")).toBe(false);
		});

		it("notes that enemies cannot Disengage from the dancer", () => {
			const state = makeBellyDancer(13);
			state.activateState("dancing");
			const notes = state.getActiveStateEffects().filter(e => e.type === "note").map(e => e.value || e.text || "");
			expect(notes.join(" ")).toMatch(/disengag/i);
		});

		it("is classified as a passive feature (no phantom toggle)", () => {
			const state = makeBellyDancer(13);
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Fluid Step")).toBe(false);
			state.activateState("dancing");
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Fluid Step")).toBe(false);
		});
	});

	// ==========================================================
	// L17 — Percussive Strike
	// ==========================================================
	describe("L17 — Percussive Strike", () => {
		it("computes DC = 8 + PB + CHA mod", () => {
			// L17 => PB +6; CHA 16 => +3 => DC 17
			expect(makeBellyDancer(17, {cha: 16}).getPercussiveStrikeDc()).toBe(17);
			// CHA 20 => +5 => DC 19
			expect(makeBellyDancer(17, {cha: 20}).getPercussiveStrikeDc()).toBe(19);
		});

		it("exposes the DC in the feature calculations", () => {
			expect(makeBellyDancer(17, {cha: 16}).getFeatureCalculations().percussiveStrikeDc).toBe(17);
		});

		it("returns no DC below level 17", () => {
			expect(makeBellyDancer(16).getPercussiveStrikeDc()).toBeNull();
		});

		it("is HIDDEN until the Dance is running, then surfaced as a toggle", () => {
			const state = makeBellyDancer(17);
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Percussive Strike")).toBe(false);
			state.activateState("dancing");
			expect(state.getActivatableFeatures().some(a => a.feature.name === "Percussive Strike")).toBe(true);
		});

		it("grants ADVANTAGE ON ATTACKS while active", () => {
			const state = makeBellyDancer(17);
			state.activateState("dancing");
			expect(state.hasAdvantageFromStates("attack")).toBe(false);
			state.activateState("percussiveStrike");
			expect(state.hasAdvantageFromStates("attack")).toBe(true);
		});

		it("ends when the Dance ends (it lasts 'as long as the Dance is active')", () => {
			const state = makeBellyDancer(17);
			state.activateState("dancing");
			state.activateState("percussiveStrike");
			state.deactivateState("dancing");
			expect(state.isStateTypeActive("percussiveStrike")).toBe(false);
		});
	});

	// ==========================================================
	// Persistence
	// ==========================================================
	describe("save / load round-trip", () => {
		it("preserves every active Belly Dancer state and its mechanical effects", () => {
			const state = makeBellyDancer(17, {cha: 16, dex: 18});
			state.activateState("dancing");
			state.activateState("tantalizingShivers");
			state.activateState("percussiveStrike");
			const acBefore = state.getAc();

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

			expect(reloaded.getActiveStates().map(s => s.stateTypeId).sort())
				.toEqual(["dancing", "percussiveStrike", "tantalizingShivers"]);
			expect(reloaded.getAc()).toBe(acBefore);
			expect(reloaded.canSneakAttackWithoutAdvantage({isMelee: true})).toBe(true);
			expect(reloaded.hasActionBenefitFromStates("disengage")).toBe(true);
			expect(reloaded.hasAdvantageFromStates("attack")).toBe(true);
			expect(reloaded.getSkillAdvantageState("acrobatics").advantage).toBe(true);
			expect(reloaded.getPercussiveStrikeDc()).toBe(17);
		});

		it("preserves the Dance resource pool", () => {
			const state = makeBellyDancer(17);
			const res = state.getResources().find(r => r.name === "Dance of the Country");
			state.setResourceCurrent(res.id, 2);

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
			const reloadedRes = reloaded.getResources().find(r => r.name === "Dance of the Country");
			expect(reloadedRes.current).toBe(2);
			expect(reloadedRes.max).toBe(6);
		});

		it("restores the Dance resource on a SHORT rest", () => {
			const state = makeBellyDancer(17);
			const res = state.getResources().find(r => r.name === "Dance of the Country");
			state.setResourceCurrent(res.id, 0);
			state.recoverResources("short");
			expect(state.getResources().find(r => r.name === "Dance of the Country").current).toBe(6);
		});
	});

	// ==========================================================
	// Regression: the phantom "Snake Charmer" feature
	// ==========================================================
	describe("regression — no phantom Snake Charmer feature", () => {
		it("does not invent a feature that is absent from the TGTT data", () => {
			expect(BD_FEATURES.some(f => /snake charmer/i.test(f.name))).toBe(false);
			const calcs = makeBellyDancer(17).getFeatureCalculations();
			expect(calcs.hasSnakeCharmer).toBeUndefined();
			const phantom = (calcs._effects || []).find(e => /snake charmer/i.test(e.source || ""));
			expect(phantom).toBeUndefined();
		});

		it("does not double-count the Dance AC bonus", () => {
			const state = makeBellyDancer(17, {cha: 16, dex: 18});
			const before = state.getAc();
			state.activateState("dancing");
			// Exactly one +3, not +6.
			expect(state.getAc()).toBe(before + 3);
		});
	});
});
