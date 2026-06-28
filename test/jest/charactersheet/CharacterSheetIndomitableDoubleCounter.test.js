/**
 * R32 #3 — Indomitable double counter (S-INDOM).
 *
 * At Fighter L9 the Combat tab showed an Indomitable counter of 2/2 instead of 1.
 * The synthetic pool/state is already correct (`getIndomitableMax()===1`, and S2's
 * migration part (b) strips the duplicate generic `_data.resources` row). The stray '2'
 * came from a SECOND, INDEPENDENT source: a baked `uses:{current:2,max:2,recharge:'long'}`
 * object on the Indomitable FEATURE itself, which the combat features/actions render
 * surfaces as a `2/2` counter next to the (correct, max-1) synthetic pool.
 *
 * FIX:
 *   (A) `_migrateStalePassiveData` part (c) deletes the baked `feature.uses` from the
 *       Indomitable / Arcane Shot feature objects on load (NEVER Second Wind, whose
 *       synthetic pool reads `feature.uses`).
 *   (B) `_createCombatActionElement` suppresses the per-feature `uses` counter for any
 *       synthetic-tracked feature (defense-in-depth for un-migrated runtime state).
 *
 * The committed fixture (`D_kaios_Petri_2_v2.json`, Fighter 9 TGTT Arcane Archer) bakes
 * the stale `feature.uses`, so these tests drive the REAL serialize→load path and assert
 * the corrected mechanics + idempotency, while proving Second Wind tracking is intact.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;

const FIXTURE = resolve(__dirname, "fixtures", "D_kaios_Petri_2_v2.json");

function rawSave () {
	return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function loadRealChar () {
	const state = new CharacterSheetState();
	state.loadFromJson(rawSave());
	return state;
}

const featByName = (state, name) =>
	(state._data.features || []).find(f => (f.name || "").toLowerCase() === name.toLowerCase());

describe("R32 #3 Indomitable double counter — fixture preconditions (anti-false-green)", () => {
	// Assert the STALE artifact genuinely exists in the committed save, so the post-load
	// assertions below prove the migration did real work (not a no-op against clean data).
	const raw = rawSave();
	const rawFeat = name => (raw.features || []).find(f => (f.name || "").toLowerCase() === name.toLowerCase());

	test("save bakes Indomitable feature.uses {max:2} that the migration must strip", () => {
		const indom = rawFeat("Indomitable");
		expect(indom).toBeTruthy();
		expect(indom.uses).toBeTruthy();
		expect(indom.uses.max).toBe(2);
	});

	test("save also bakes Arcane Shot feature.uses (stripped) and Second Wind feature.uses (preserved)", () => {
		expect(rawFeat("Arcane Shot")?.uses?.max).toBeGreaterThan(0);
		expect(rawFeat("Second Wind")?.uses?.max).toBeGreaterThan(0);
	});
});

describe("R32 #3 Indomitable double counter — corrected mechanics after load", () => {
	test("Indomitable feature no longer carries a baked `uses` pool", () => {
		const state = loadRealChar();
		const indom = featByName(state, "Indomitable");
		expect(indom).toBeTruthy();
		expect(indom.uses).toBeUndefined();
	});

	test("synthetic Indomitable max is still 1 at Fighter L9", () => {
		const state = loadRealChar();
		expect(state.getIndomitableMax()).toBe(1);
		expect(state.getFeatureCalculations().indomitableUses).toBe(1);
	});

	test("Arcane Shot feature.uses is stripped but the synthetic pool max is unchanged", () => {
		const state = loadRealChar();
		const arcaneShotMax = state.getArcaneShotMax();
		expect(featByName(state, "Arcane Shot")?.uses).toBeUndefined();
		// Pool tracking is independent of feature.uses, so the max survives the strip.
		expect(arcaneShotMax).toBeGreaterThan(0);
	});

	test("Second Wind tracking is INTACT — feature.uses preserved and helpers still work", () => {
		const state = loadRealChar();
		const sw = featByName(state, "Second Wind");
		expect(sw).toBeTruthy();
		expect(sw.uses).toBeTruthy();
		expect(sw.uses.max).toBeGreaterThan(0);
		expect(state.getSecondWindUsesMax()).toBeGreaterThan(0);
		expect(state.getSecondWindUsesRemaining()).toBeGreaterThanOrEqual(0);
		expect(state.getSecondWindUsesRemaining()).toBeLessThanOrEqual(state.getSecondWindUsesMax());
	});

	test("the single synthetic Indomitable combat resource has max 1 (no shadowing duplicate)", () => {
		const state = loadRealChar();
		const synth = (state.getSyntheticCombatResources?.() || [])
			.filter(r => (r.name || "").toLowerCase() === "indomitable");
		expect(synth.length).toBe(1);
		expect(synth[0].max).toBe(1);
	});
});

describe("R32 #3 Indomitable double counter — idempotency", () => {
	test("load → toJson → load keeps Indomitable.uses absent (never resurrected)", () => {
		const state1 = loadRealChar();
		expect(featByName(state1, "Indomitable")?.uses).toBeUndefined();

		const json = state1.toJson();
		const state2 = new CharacterSheetState();
		state2.loadFromJson(json);

		expect(featByName(state2, "Indomitable")?.uses).toBeUndefined();
		expect(featByName(state2, "Arcane Shot")?.uses).toBeUndefined();
		expect(state2.getIndomitableMax()).toBe(1);
		// Second Wind still intact after the round-trip.
		expect(featByName(state2, "Second Wind")?.uses).toBeTruthy();
		expect(state2.getSecondWindUsesMax()).toBeGreaterThan(0);
	});
});

describe("R32 #3 Indomitable double counter — render dedup (defense-in-depth)", () => {
	// Even with an un-migrated `feature.uses` baked on a synthetic-tracked feature, the
	// combat features/actions render must NOT emit a per-feature uses counter for it.
	test("isSyntheticTrackedResourceFeature gates the render uses counter", () => {
		// The render gate (_createCombatActionElement) computes:
		//   hasUses = !isSyntheticTracked && feature.uses && feature.uses.max > 0
		// Mirror that predicate here against a feature still carrying baked uses.
		const indomLike = {name: "Indomitable", uses: {current: 2, max: 2, recharge: "long"}};
		const swLike = {name: "Second Wind", uses: {current: 3, max: 3, recharge: "short"}};
		const featLike = {name: "Some Feat", uses: {current: 1, max: 1, recharge: "long"}};

		const hasUses = f => !CharacterSheetState.isSyntheticTrackedResourceFeature(f.name)
			&& f.uses && f.uses.max > 0;

		// Synthetic-tracked features (incl. Second Wind, shown as a synthetic pool) are
		// suppressed in the combat actions list to avoid a duplicate counter.
		expect(hasUses(indomLike)).toBe(false);
		expect(hasUses(swLike)).toBe(false);
		// Non-synthetic limited-use features still render their counter.
		expect(hasUses(featLike)).toBe(true);
	});
});
