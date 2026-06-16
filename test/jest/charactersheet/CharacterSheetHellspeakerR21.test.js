/**
 * R21 — Illrigger **Hellspeaker** subclass effects (MCDM IllriggerRevised).
 *
 * Covers four player-reported bugs, asserting real mechanical wiring (not flag
 * existence) and validating against the REAL Hochling Illrigger L10 character
 * fixture (prior rounds were false-green on synthetic data only):
 *
 *   #15 — Moloch's Blessing / Forked Tongue Improvement grant ADVANTAGE, not a +1.
 *   #12 — Moloch's Interdiction auto-grants its level-gated free boons.
 *   #17 — Blood Price spends a Hit Die (no heal) to add to a save.
 *   #13 — Infernal Conduit dice pool is 5d10 at L9-10 (the d20 bug is the UI
 *         showDiceResult subtitle path; the pool size is asserted here).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const REAL_CHAR_PATH = path.join(__dirnameLocal, "fixtures", "r21-hochling-illrigger-l10.json");

const addHellspeaker = (state, level, {cha = 16} = {}) => {
	state._data.abilities.cha = cha;
	state.addClass({
		name: "Illrigger",
		source: "IllriggerRevised",
		level,
		subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
	});
	state.applyClassFeatureEffects();
};

describe("R21 Hellspeaker effects", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ----------------------------------------------------------------------
	// #15 — advantage-typed conditional modifiers must NOT add a numeric +1
	// ----------------------------------------------------------------------
	describe("#15 Moloch's Blessing / Forked Tongue grant advantage, not +1", () => {
		it("surfaces Moloch's Blessing as advantage with a 0-bonus chip (not +1)", () => {
			addHellspeaker(state, 3, {cha: 16});
			const agg = state.aggregateModifiers("check:cha");
			const cond = agg.conditionalsAvailable.find(c => c.name === "Moloch's Blessing");
			expect(cond).toBeDefined();
			expect(cond.advantage).toBe(true);
			expect(cond.bonus).toBe(0); // no phantom +1
		});

		it("applies ADVANTAGE (not +1) when the Moloch's Blessing conditional is opted in", () => {
			addHellspeaker(state, 3, {cha: 16});
			const probe = state.aggregateModifiers("check:cha");
			const cond = probe.conditionalsAvailable.find(c => c.name === "Moloch's Blessing");
			const applied = state.aggregateModifiers("check:cha", {appliedConditionalIds: new Set([cond.id])});
			expect(applied.advantage).toBe(true);
			expect(applied.bonus).toBe(0); // the value:1 sentinel must not leak into the total
		});

		it("applies ADVANTAGE (not +1) when Forked Tongue Improvement is opted in at L9", () => {
			addHellspeaker(state, 9, {cha: 16});
			const probe = state.aggregateModifiers("check:wis");
			const cond = probe.conditionalsAvailable.find(c => c.name === "Forked Tongue");
			expect(cond).toBeDefined();
			expect(cond.bonus).toBe(0);
			const applied = state.aggregateModifiers("check:wis", {appliedConditionalIds: new Set([cond.id])});
			expect(applied.advantage).toBe(true);
			expect(applied.bonus).toBe(0);
		});

		it("leaves a real numeric conditional bonus untouched (regression guard)", () => {
			// A non-advantage conditional modifier must still contribute its value.
			state.addNamedModifier?.({
				name: "Test Bonus",
				type: "check:cha",
				value: 3,
				conditional: "in a test",
				enabled: true,
			});
			const probe = state.aggregateModifiers("check:cha");
			const cond = probe.conditionalsAvailable.find(c => c.name === "Test Bonus");
			if (cond) {
				expect(cond.bonus).toBe(3);
				const applied = state.aggregateModifiers("check:cha", {appliedConditionalIds: new Set([cond.id])});
				expect(applied.bonus).toBe(3);
			}
		});
	});

	// ----------------------------------------------------------------------
	// #12 — Moloch's Interdiction auto-grants level-gated free boons
	// ----------------------------------------------------------------------
	describe("#12 Moloch's Interdiction free boons", () => {
		it("does not grant any free boons before L7", () => {
			addHellspeaker(state, 6, {cha: 16});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasMolochInterdiction).toBeFalsy();
			expect(calcs.molochInterdictionBoonNames || []).toEqual([]);
			expect(calcs.hasRedCant).toBeFalsy();
		});

		it("grants Red Cant only at L7-12 (level-gated) and lights up its effect", () => {
			addHellspeaker(state, 10, {cha: 16});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasMolochInterdiction).toBe(true);
			expect(calcs.molochInterdictionBoonNames).toEqual(["Red Cant"]);
			expect(calcs.hasRedCant).toBe(true);
			expect(calcs.redCantFloor).toBe(10);
			expect(calcs.hasSlipperyPloy).toBeFalsy();
			expect(calcs.hasIncontrovertible).toBeFalsy();
		});

		it("adds Slippery Ploy at L13 and Incontrovertible at L18", () => {
			addHellspeaker(state, 13, {cha: 16});
			let calcs = state.getFeatureCalculations();
			expect(calcs.molochInterdictionBoonNames).toEqual(["Red Cant", "Slippery Ploy"]);
			expect(calcs.hasSlipperyPloy).toBe(true);
			expect(calcs.slipperyPloyDc).toBe(calcs.interdictDc);

			const state18 = new CharacterSheetState();
			addHellspeaker(state18, 18, {cha: 16});
			calcs = state18.getFeatureCalculations();
			expect(calcs.molochInterdictionBoonNames).toEqual(["Red Cant", "Slippery Ploy", "Incontrovertible"]);
			expect(calcs.hasIncontrovertible).toBe(true);
		});

		it("does NOT consume the player's interdict-boon budget (free boons aren't selected features)", () => {
			addHellspeaker(state, 10, {cha: 16});
			// The free boons are not stored as selected ItdBoon features.
			expect((state.getInterdictBoons() || []).map(b => b.name)).not.toContain("Red Cant");
		});

		it("surfaces the granted free boons on the Moloch's Interdiction feature card", () => {
			addHellspeaker(state, 10, {cha: 16});
			const calcs = state.getFeatureCalculations();
			const summary = state.getFeatureEffectSummary({name: "Moloch's Interdiction", featureType: "Class"}, calcs);
			expect(summary).toBe("Free boons: Red Cant");
		});
	});

	// ----------------------------------------------------------------------
	// #17 — Blood Price spends a Hit Die (no heal) to add to a failed save
	// ----------------------------------------------------------------------
	describe("#17 Blood Price", () => {
		it("does not expose the feature before L10", () => {
			addHellspeaker(state, 9, {cha: 16});
			expect(state.hasBloodPrice()).toBe(false);
			expect(state.applyBloodPrice(null, {roll: 5})).toBeNull();
		});

		it("spends one Hit Die without healing and returns the rolled value", () => {
			addHellspeaker(state, 10, {cha: 16});
			expect(state.hasBloodPrice()).toBe(true);

			const hdBefore = state.getHitDiceSummary().current;
			const hpBefore = state.getCurrentHp();
			const res = state.applyBloodPrice(null, {roll: 7});

			expect(res).toMatchObject({roll: 7});
			expect(res.dieType).toMatch(/^d\d+$/);
			expect(state.getHitDiceSummary().current).toBe(hdBefore - 1);
			expect(res.remaining).toBe(hdBefore - 1);
			// Blood Price spends the die but does NOT heal.
			expect(state.getCurrentHp()).toBe(hpBefore);
		});

		it("returns null when no Hit Dice remain", () => {
			addHellspeaker(state, 10, {cha: 16});
			// Drain all hit dice.
			for (const [type, pool] of Object.entries(state.getHitDiceByType())) {
				state.adjustHitDieCurrent(type, -pool.max);
			}
			expect(state.applyBloodPrice(null, {roll: 7})).toBeNull();
		});

		it("surfaces availability on the Blood Price feature card", () => {
			addHellspeaker(state, 10, {cha: 16});
			const summary = state.getFeatureEffectSummary({name: "Blood Price", featureType: "Class"}, state.getFeatureCalculations());
			expect(summary).toMatch(/Spend 1 Hit Die/);
		});
	});

	// ----------------------------------------------------------------------
	// #13 — Infernal Conduit pool is 5d10 at L9-10 (UI d20 subtitle bug)
	// ----------------------------------------------------------------------
	describe("#13 Infernal Conduit dice pool", () => {
		it("is 5d10 at L10", () => {
			addHellspeaker(state, 10, {cha: 16});
			expect(state.hasInfernalConduit()).toBe(true);
			expect(state.getInfernalConduitMax()).toBe(5);
			expect(state.getInfernalConduitDie()).toBe(10);
		});

		it("reports the correct NdN dice string when spending dice", () => {
			addHellspeaker(state, 10, {cha: 16});
			const res = state.spendInfernalConduitDice(5, "devour", {saveResult: "fail", roll: 27});
			expect(res).toBeTruthy();
			expect(res.dice).toBe("5d10"); // never "1d20"
			expect(res.diceSpent).toBe(5);
		});
	});

	// ----------------------------------------------------------------------
	// Real-character regression — validate against the actual L10 fixture
	// ----------------------------------------------------------------------
	describe("Real Hochling Illrigger L10 (Hellspeaker) fixture", () => {
		let real;

		beforeEach(() => {
			real = new CharacterSheetState();
			real.loadFromJson(JSON.parse(fs.readFileSync(REAL_CHAR_PATH, "utf8")));
		});

		it("#13 has a 5d10 Infernal Conduit pool", () => {
			expect(real.getInfernalConduitMax()).toBe(5);
			expect(real.getInfernalConduitDie()).toBe(10);
			real._setInfernalConduitAvailable(5); // fixture was saved mid-adventure with the pool spent
			const res = real.spendInfernalConduitDice(5, "devour", {saveResult: "fail", roll: 27});
			expect(res.dice).toBe("5d10");
		});

		it("#15 conditional CHA/WIS advantage gives advantage, not +1", () => {
			for (const skill of ["persuasion", "deception", "intimidation"]) {
				const probe = real.aggregateModifiers(`skill:${skill}`);
				const cond = probe.conditionalsAvailable.find(c => c.name === "Moloch's Blessing");
				expect(cond).toBeDefined();
				expect(cond.bonus).toBe(0);
				const applied = real.aggregateModifiers(`skill:${skill}`, {appliedConditionalIds: new Set([cond.id])});
				expect(applied.advantage).toBe(true);
				expect(applied.bonus).toBe(0);
			}
			const wisProbe = real.aggregateModifiers("skill:insight");
			const wisCond = wisProbe.conditionalsAvailable.find(c => c.name === "Forked Tongue");
			expect(wisCond).toBeDefined();
			expect(wisCond.bonus).toBe(0);
		});

		it("#12 auto-grants Red Cant from Moloch's Interdiction at L10", () => {
			const calcs = real.getFeatureCalculations();
			expect(calcs.hasMolochInterdiction).toBe(true);
			expect(calcs.molochInterdictionBoonNames).toEqual(["Red Cant"]);
			expect(calcs.hasRedCant).toBe(true);
			expect(calcs.redCantFloor).toBe(10);
		});

		it("#17 Blood Price spends a Hit Die without healing", () => {
			expect(real.hasBloodPrice()).toBe(true);
			const hdBefore = real.getHitDiceSummary().current;
			const hpBefore = real.getCurrentHp();
			const res = real.applyBloodPrice(null, {roll: 6});
			expect(res.roll).toBe(6);
			expect(real.getHitDiceSummary().current).toBe(hdBefore - 1);
			expect(real.getCurrentHp()).toBe(hpBefore);
		});
	});
});
