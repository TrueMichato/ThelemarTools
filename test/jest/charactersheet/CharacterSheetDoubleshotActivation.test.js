/**
 * Doubleshot (TGTT ranged extra-die combat method) — REAL activation → next ranged
 * damage roll, driven end-to-end on the repro character (Fighter 9 TGTT).
 *
 * Regression target (the "does nothing to the next damage roll" report): prior rounds
 * tested the fold-in with a synthetic attack that set `isRanged:true` AND mocked the
 * one-shot consumer — a false green. In production, ranged WEAPON attacks are
 * auto-generated (renderAttacks) or modal-built and set only `isMelee` (ranged →
 * `isMelee:false`); they NEVER carry an explicit `isRanged` flag. `_rollDamage` gated
 * the Doubleshot consume on `attack.isRanged`, so the gate was always falsy for those
 * attacks and `_consumePendingWeaponDamageDie` was never called → the armed die was
 * never spent.
 *
 * These tests refuse to take the false-green shortcut:
 *   - They ARM the rider through the REAL activation path (the dispatch the Use button
 *     reaches: `_activateMethodAfterPayment` → `_activateMethodEffect` → category route
 *     → `_activateRangedExtraDieMethod`), never by setting `_pendingDoubleshot` directly.
 *   - They roll damage against a REAL auto-generated-shaped longbow attack (`isMelee:false`,
 *     slash range, NO `isRanged`), never a synthetic `isRanged:true` attack.
 *   - They DO NOT mock `_consumePendingWeaponDamageDie` / `getDoubleshotRiderForAttack`;
 *     the gate, the resolver, and the one-shot consume all run for real. Only
 *     `_parseDamage` (the dice layer, not the gating/consume logic under test) is made
 *     deterministic.
 *
 * NOTE on the fixture: the repro's stored "Doubleshot" feature is malformed — it lacks the
 * combat-method markers (`_entityType` / `tradition` / `degree` / `staminaCost`) that its
 * sibling techniques carry, so `getCombatMethods()` does not surface it. That
 * surfacing/migration defect is owned by a different session; here we normalize the
 * feature shape IN THE TEST so we can exercise the activation→damage path this session owns.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures/D_kaios_Petri_2.json");

// Deterministic per-die-string totals so the folded damage is exact and the extra die
// is unambiguous. `_parseDamage` is the dice layer, not the gate/consume logic we assert.
const PER_DIE = {"1d8": 5, "1d6": 4};

/** Load the repro char and normalize the malformed Doubleshot feature so it surfaces. */
function loadReproState () {
	const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
	const state = new CharacterSheetState();
	state.loadFromJson(json);

	const ds = state._data.features.find(f => f.name === "Doubleshot");
	if (!ds) throw new Error("Repro fixture is missing the Doubleshot feature");
	// Surfacing/migration defect (owned elsewhere): give the feature the combat-method
	// markers its siblings (e.g. Point Blank Shot) already carry so getCombatMethods()
	// recognizes it. This does NOT touch the activation→damage path under test.
	ds._entityType = "combatMethod";
	ds.__prop = "combatMethod";
	ds.tradition = "Biting Zephyr";
	ds.degree = 1;
	ds.staminaCost = 1;
	ds.className = "Fighter";
	ds.classSource = "TGTT";
	ds.level = 9;
	ds.source = ds.source || "TGTT";
	return state;
}

/** A combat module wired to the real state, with only the dice layer made deterministic. */
function mkCombat (state) {
	const captured = [];
	const parseCalls = [];

	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._page = {
		showDiceResult: (args) => { captured.push(args); },
		pAnimateDamageDice: () => {},
		_saveCurrentCharacter: () => {},
		_renderCharacter: () => {},
		_features: {_renderResources: () => {}},
	};

	// Deterministic dice; records (dice, isCrit) so we can assert the extra die is rolled
	// and that crit is forwarded to it. NOT the logic under test.
	combat._parseDamage = (dice, isCrit) => {
		parseCalls.push({dice, isCrit: !!isCrit});
		const total = PER_DIE[dice] ?? (/^\d+$/.test(String(dice).trim()) ? Number(dice) : 0);
		return {total, sides: 8, rolls: [total]};
	};
	combat._pushDiceGroup = () => {};
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
	combat._promptUseCombatMethod = async () => null;

	return {combat, captured, parseCalls};
}

/** Real auto-generated-shaped ranged weapon attack: sets `isMelee:false`, NO `isRanged`. */
function mkAutoLongbow () {
	return {
		id: "auto_longbow",
		name: "Longbow",
		isMelee: false, // ranged auto-attacks set isMelee:false and OMIT isRanged
		abilityMod: "dex",
		range: "150/600",
		damage: "1d8",
		damageType: "Piercing",
		properties: ["A|XPHB", "H|XPHB", "2H|XPHB"],
		isAutoGenerated: true,
	};
}

function mkMeleeRapier () {
	return {
		id: "rapier",
		name: "Rapier",
		isMelee: true,
		abilityMod: "dex",
		range: "5 ft.",
		damage: "1d8",
		damageType: "Piercing",
		properties: ["F|XPHB"],
	};
}

function mkSpellAttack () {
	return {
		id: "firebolt",
		name: "Fire Bolt",
		isSpell: true,
		abilityMod: "int",
		damage: "1d8",
		damageType: "Fire",
	};
}

/** Drive the genuine UI activation dispatch for a method (no direct `_pendingDoubleshot`). */
function activateMethodAsUi (combat, method) {
	const btn = {
		dataset: {cost: String(method.staminaCost ?? 1)},
		classList: {add () {}, remove () {}},
		closest: () => ({_methodData: method}),
	};
	combat._activateMethodAfterPayment(btn, `${method.name}-1`, method.staminaCost ?? 1, "stamina");
}

function getDoubleshotMethod (state) {
	const method = (state.getCombatMethods() || []).find(m => /doubleshot/i.test(m.name || ""));
	if (!method) throw new Error("Doubleshot did not surface from getCombatMethods()");
	return method;
}

describe("Doubleshot — real activation arms the rider; next ranged damage roll spends it", () => {
	it("surfaces Doubleshot as a rangedExtraDie method (real category derivation)", () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		expect(method.methodCategory).toBe("rangedExtraDie");
		expect(method.pendingRangedExtraDie).toBe(true);
	});

	it("REAL activation path arms the one-shot pending flag", () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat} = mkCombat(state);

		expect(combat._pendingDoubleshot).toBeFalsy();
		activateMethodAsUi(combat, method); // dispatch → _activateRangedExtraDieMethod
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"});
	});

	it("adds the matching extra weapon die to the NEXT ranged damage roll, then clears (one-shot)", async () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat, captured, parseCalls} = mkCombat(state);

		const longbow = mkAutoLongbow();
		combat._cachedAttacks = [longbow];

		// Arm via the real path, then roll the real auto-longbow.
		activateMethodAsUi(combat, method);
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"});

		await combat._rollDamage("auto_longbow", false);

		expect(captured.length).toBe(1);
		const display = captured[0];

		// The longbow's own die (1d8) is rolled once for the weapon, and AGAIN for the
		// Doubleshot rider — proving the rider was actually consumed and folded in.
		const oneD8Parses = parseCalls.filter(c => c.dice === "1d8");
		expect(oneD8Parses.length).toBe(2);
		expect(display.subtitle).toMatch(/Doubleshot/i);
		// weapon 1d8=5 + Doubleshot 1d8=5 + dex mod (folded into the same piercing total).
		const dexMod = state.getAbilityMod("dex");
		expect(display.total).toBe(5 + 5 + dexMod);

		// One-shot: the pending flag is cleared after the qualifying ranged roll.
		expect(combat._pendingDoubleshot).toBeNull();
	});

	it("does NOT re-apply the die on a SECOND ranged roll (already consumed)", async () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat, captured} = mkCombat(state);

		const longbow = mkAutoLongbow();
		combat._cachedAttacks = [longbow];

		activateMethodAsUi(combat, method);
		await combat._rollDamage("auto_longbow", false); // consumes
		await combat._rollDamage("auto_longbow", false); // second roll: no rider

		expect(captured.length).toBe(2);
		expect(captured[1].subtitle).not.toMatch(/Doubleshot/i);
		const dexMod = state.getAbilityMod("dex");
		expect(captured[1].total).toBe(5 + dexMod); // weapon 1d8=5 + dex only
	});

	it("forwards isCrit to the rider die so it crit-doubles with the weapon dice", async () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat, parseCalls} = mkCombat(state);

		combat._cachedAttacks = [mkAutoLongbow()];
		activateMethodAsUi(combat, method);
		await combat._rollDamage("auto_longbow", true);

		// Both the weapon die and the rider die are parsed with isCrit=true.
		const critParses = parseCalls.filter(c => c.dice === "1d8" && c.isCrit === true);
		expect(critParses.length).toBe(2);
		expect(parseCalls.every(c => c.isCrit === true)).toBe(true);
	});
});

describe("Doubleshot — gating: melee/spell never receive the die; no leak into unrelated rolls", () => {
	it("does NOT apply the die to a MELEE weapon roll, and leaves the rider armed for the next ranged shot", async () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat, captured} = mkCombat(state);

		combat._cachedAttacks = [mkMeleeRapier(), mkAutoLongbow()];

		activateMethodAsUi(combat, method);
		await combat._rollDamage("rapier", false); // melee → must NOT consume

		expect(captured[0].subtitle).not.toMatch(/Doubleshot/i);
		// The rider is still armed (it is reserved for the next RANGED weapon attack).
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"});

		// The very next ranged shot then receives it.
		await combat._rollDamage("auto_longbow", false);
		expect(captured[1].subtitle).toMatch(/Doubleshot/i);
		expect(combat._pendingDoubleshot).toBeNull();
	});

	it("does NOT apply the die to a SPELL damage roll", async () => {
		const state = loadReproState();
		const method = getDoubleshotMethod(state);
		const {combat, captured} = mkCombat(state);

		combat._cachedAttacks = [mkSpellAttack()];

		activateMethodAsUi(combat, method);
		await combat._rollDamage("firebolt", false);

		expect(captured[0].subtitle).not.toMatch(/Doubleshot/i);
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"}); // untouched
	});

	it("does not leak: with no rider armed, a ranged roll gets no extra die", async () => {
		const state = loadReproState();
		const {combat, captured, parseCalls} = mkCombat(state);

		combat._cachedAttacks = [mkAutoLongbow()];
		// No activation at all.
		await combat._rollDamage("auto_longbow", false);

		expect(parseCalls.filter(c => c.dice === "1d8").length).toBe(1); // weapon only
		expect(captured[0].subtitle).not.toMatch(/Doubleshot/i);
	});
});
