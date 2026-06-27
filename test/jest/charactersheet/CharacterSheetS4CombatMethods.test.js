/**
 * S4 — TGTT Combat Methods & active-state toggles (bugs #18–#21).
 *
 * Asserts REAL mechanics, not existence:
 *
 *  #18 Catch Your Breath  — parses the self-heal formula and `applyCombatMethodSelfHeal`
 *      heals exactly `die + proficiency + ability modifier` (clamped to a minimum and to
 *      max HP). Previously the `selfHeal` category was a no-op toast.
 *
 *  #19 Stances            — modeled as on/off toggles backed by the single `combatStance`
 *      slot + `_data.activeStance`, so entering a second stance auto-replaces the first
 *      (mutual exclusion), and the combat module's `_exitStance` fully reverses activation.
 *
 *  #20 Doubleshot         — arms a one-shot pending rider; the pure `getDoubleshotRiderForAttack`
 *      resolves a single weapon die for a qualifying RANGED weapon attack (null for melee /
 *      spells), and `_consumePendingWeaponDamageDie` yields it exactly once (one-shot). The
 *      damage-pipeline consumption itself is an S5-owned 2-line hook.
 *
 *  #21 Iron Will          — registers a GATED `save:all` advantage conditional modifier that
 *      the existing aggregation surfaces in `conditionalsAvailable` (default OFF) and only
 *      grants advantage when the caller opts in — no roll-handler edits.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import {readFileSync} from "fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// --- Fixtures (verbatim rules text from homebrew/TravelersGuidetoThelemar.json) ----------

const CATCH_YOUR_BREATH = {
	name: "Catch Your Breath",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Adamant Mountain",
	degree: 1,
	staminaCost: 2,
	actionType: "bonus action",
	entries: [
		"{@b Bonus Action (2 Stamina Points)}. You have a limited well of stamina that you can draw on to protect yourself from harm. You regain hit points equal to {@dice 1d6} + your proficiency bonus + your Constitution modifier (minimum 0).",
	],
};

const DOUBLESHOT = {
	name: "Doubleshot",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Biting Zephyr",
	degree: 1,
	staminaCost: 1,
	actionType: "bonus action",
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. You palm two blades or nock two arrows, launching both missiles at the same opponent. The next ranged weapon attack you make uses two missiles instead of one. On a hit, you deal an additional weapon damage die.",
	],
};

const IRON_WILL = {
	name: "Iron Will",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Razor's Edge",
	degree: 1,
	staminaCost: 1,
	actionType: "reaction",
	entries: [
		"{@b Reaction (1 Stamina Point)}. Withdrawing into your mind, you focus and concentrate to steel your nerves. When you make a saving throw to resist being {@condition charmed} or {@condition frightened}, you can use your reaction to gain advantage on the saving throw.",
	],
};

const PERCEPTIVE_STANCE = {
	name: "Perceptive Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Razor's Edge",
	degree: 1,
	staminaCost: 1,
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. While in this stance, your passive Wisdom (Perception) score increases by 3, and you gain a bonus to Wisdom (Perception) checks equal to your proficiency bonus. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

const HEAVY_STANCE = {
	name: "Heavy Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Adamant Mountain",
	degree: 1,
	staminaCost: 1,
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. While in this stance, you gain a bonus to Strength (Athletics) checks equal to your proficiency bonus. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

function buildState (...features) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "TGTT", level: 5}); // proficiency bonus +3
	state.setAbilityBase("con", 14); // +2
	state.setAbilityBase("str", 12); // +1
	state.setAbilityBase("wis", 14); // +2
	for (const f of features) state.addFeature(f);
	return state;
}

function makeCombat () {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._page = {};
	return combat;
}

// =========================================================================================
// #18 — Catch Your Breath (self-heal)
// =========================================================================================
describe("#18 Catch Your Breath — self-heal", () => {
	it("parses the self-heal formula into structured fields", () => {
		const state = buildState(CATCH_YOUR_BREATH);
		const parsed = state._parseCombatMethodEffects(CATCH_YOUR_BREATH);
		expect(parsed.methodCategory).toBe("selfHeal");
		expect(parsed.selfHeal).toEqual({dice: "1d6", addProficiency: true, abilityMod: "con", minimum: 0});
	});

	it("heals exactly die + proficiency + CON modifier", () => {
		const state = buildState(CATCH_YOUR_BREATH);
		const maxHp = state.getMaxHp();
		state._data.hp.current = maxHp;
		state.takeDamage(15);
		const wounded = state._data.hp.current;

		const res = state.applyCombatMethodSelfHeal("Catch Your Breath", {dieRoll: 4});

		const expected = 4 + state.getProficiencyBonus() + state.getAbilityMod("con"); // 4 + 3 + 2 = 9
		expect(res.amount).toBe(expected);
		expect(state._data.hp.current).toBe(Math.min(maxHp, wounded + expected));
	});

	it("clamps healing to max HP but still reports the rolled amount", () => {
		const state = buildState(CATCH_YOUR_BREATH);
		const maxHp = state.getMaxHp();
		state._data.hp.current = maxHp;
		state.takeDamage(2); // only 2 HP of headroom

		const res = state.applyCombatMethodSelfHeal("Catch Your Breath", {dieRoll: 4}); // amount 9
		expect(res.amount).toBe(9);
		expect(state._data.hp.current).toBe(maxHp); // clamped
	});

	it("never returns less than the minimum (0)", () => {
		const state = buildState(CATCH_YOUR_BREATH);
		state._data.hp.current = state.getMaxHp();
		state.takeDamage(10);
		// dieRoll 0 + prof + con is already positive; assert the floor is honoured (>= 0)
		const res = state.applyCombatMethodSelfHeal("Catch Your Breath", {dieRoll: 0});
		expect(res.amount).toBeGreaterThanOrEqual(0);
		expect(res.amount).toBe(state.getProficiencyBonus() + state.getAbilityMod("con"));
	});

	it("clamps to the minimum when the raw total would be negative", () => {
		const state = buildState(CATCH_YOUR_BREATH);
		state.setAbilityBase("con", 1); // -5 modifier
		state._data.hp.current = state.getMaxHp();
		state.takeDamage(10);
		const before = state._data.hp.current;
		// raw = 0 (die) + prof(3) + con(-5) = -2 → clamped to minimum 0
		const res = state.applyCombatMethodSelfHeal("Catch Your Breath", {dieRoll: 0});
		expect(res.amount).toBe(0);
		expect(state._data.hp.current).toBe(before); // no healing, but never damages
	});

	it("returns null for a non-self-heal method", () => {
		const state = buildState(IRON_WILL);
		expect(state.applyCombatMethodSelfHeal("Iron Will", {dieRoll: 4})).toBeNull();
	});

	it("the combat module's _activateSelfHealMethod rolls the die, applies the heal, and refreshes HP", () => {
		const combat = makeCombat();
		combat._parseDamage = jest.fn(() => ({total: 5}));
		combat._state = {applyCombatMethodSelfHeal: jest.fn(() => ({amount: 10, formulaText: "1d6 + prof + CON"}))};
		combat.renderCombatResources = jest.fn();
		combat._page = {_renderHp: jest.fn(), _renderCharacter: jest.fn(), _saveCurrentCharacter: jest.fn()};

		combat._activateSelfHealMethod({name: "Catch Your Breath"}, {selfHeal: {dice: "1d6"}}, 2, "stamina");

		expect(combat._parseDamage).toHaveBeenCalledWith("1d6");
		expect(combat._state.applyCombatMethodSelfHeal).toHaveBeenCalledWith("Catch Your Breath", {dieRoll: 5});
		expect(combat._page._renderHp).toHaveBeenCalled();
		expect(combat._page._saveCurrentCharacter).toHaveBeenCalled();
	});
});

// =========================================================================================
// #19 — Stances as on/off toggles (mutual exclusion + exit)
// =========================================================================================
describe("#19 Stances — on/off toggles with mutual exclusion", () => {
	it("entering a second stance replaces the first (single combatStance slot)", () => {
		const state = buildState(PERCEPTIVE_STANCE, HEAVY_STANCE);

		expect(state.activateStance("Perceptive Stance")).toBe(true);
		expect(state.isStanceActive("Perceptive Stance")).toBe(true);

		// Enter the second stance — mutual exclusion: only one fighter stance at a time.
		expect(state.activateStance("Heavy Stance")).toBe(true);
		expect(state.isStanceActive("Heavy Stance")).toBe(true);
		expect(state.isStanceActive("Perceptive Stance")).toBe(false);
		expect(state.getActiveStance()).toBe("Heavy Stance");
	});

	it("_exitStance fully reverses activation and refreshes the UI", () => {
		const state = buildState(PERCEPTIVE_STANCE);
		state.activateState("combatStance", {name: "Perceptive Stance", icon: "⚔️"});
		state.activateStance("Perceptive Stance");
		expect(state.isStanceActive("Perceptive Stance")).toBe(true);

		const combat = makeCombat();
		combat._state = state;
		combat._page = {
			_renderActiveStates: jest.fn(),
			_saveCurrentCharacter: jest.fn(),
			_renderCharacter: jest.fn(),
		};
		// Stub the DOM-touching renders so the mechanical seam can be tested headlessly.
		combat.renderCombatStates = jest.fn();
		combat.renderCombatEffects = jest.fn();
		combat.renderCombatMethods = jest.fn();

		combat._exitStance({name: "Perceptive Stance"});

		expect(state.isStanceActive("Perceptive Stance")).toBe(false);
		expect(state.getActiveStance()).toBeNull();
		expect(state.isStateTypeActive("combatStance")).toBe(false);
		// Full refresh path mirrored from activation.
		expect(combat.renderCombatStates).toHaveBeenCalled();
		expect(combat.renderCombatMethods).toHaveBeenCalled();
		expect(combat._page._saveCurrentCharacter).toHaveBeenCalled();
		expect(combat._page._renderCharacter).toHaveBeenCalled();
	});
});

// =========================================================================================
// #20 — Doubleshot (pending ranged extra weapon die)
// =========================================================================================
describe("#20 Doubleshot — pending ranged extra weapon die", () => {
	it("parses into a pending ranged-extra-die effect", () => {
		const state = buildState(DOUBLESHOT);
		const parsed = state._parseCombatMethodEffects(DOUBLESHOT);
		expect(parsed.pendingRangedExtraDie).toBe(true);
		expect(parsed.methodCategory).toBe("rangedExtraDie");
	});

	it("getDoubleshotRiderForAttack returns a single weapon die for a qualifying ranged attack", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};

		// Explicit ranged flag (active-state style attack).
		expect(combat.getDoubleshotRiderForAttack({isRanged: true, isSpell: false, damage: "1d8"})).toBe("1d8");
		// Real stored weapon attack: ranged weapons carry isMelee:false + a "X/Y" range.
		expect(combat.getDoubleshotRiderForAttack({isMelee: false, isSpell: false, range: "80/320 ft.", damage: "1d8"})).toBe("1d8");
		// Thrown weapon (range "X/Y") counts as a ranged weapon attack.
		expect(combat.getDoubleshotRiderForAttack({isMelee: true, isSpell: false, range: "20/60 ft.", damage: "1d4"})).toBe("1d4");
		// Reduces multi-dice / modifier weapons to a single die of the same size.
		expect(combat.getDoubleshotRiderForAttack({isRanged: true, isSpell: false, damage: "2d6+3"})).toBe("1d6");
	});

	it("does NOT apply to melee weapons or spell attacks", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};

		// Stored melee weapon: isMelee true (or a fixed 5 ft. range, no slash).
		expect(combat.getDoubleshotRiderForAttack({isMelee: true, isSpell: false, range: "5 ft.", damage: "1d8"})).toBeNull();
		expect(combat.getDoubleshotRiderForAttack({isRanged: false, isSpell: false, damage: "1d8"})).toBeNull();
		// Spell attacks never qualify even if flagged ranged.
		expect(combat.getDoubleshotRiderForAttack({isRanged: true, isSpell: true, damage: "1d8"})).toBeNull();
	});

	it("returns null when no Doubleshot is pending", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = null;
		expect(combat.getDoubleshotRiderForAttack({isRanged: true, isSpell: false, damage: "1d8"})).toBeNull();
	});

	it("getDoubleshotRiderForAttack is PURE — it does not consume the pending flag", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};
		const attack = {isRanged: true, isSpell: false, damage: "1d10"};
		expect(combat.getDoubleshotRiderForAttack(attack)).toBe("1d10");
		expect(combat.getDoubleshotRiderForAttack(attack)).toBe("1d10"); // still pending
		expect(combat._pendingDoubleshot).not.toBeNull();
	});

	it("_consumePendingWeaponDamageDie yields the die exactly once (one-shot)", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};
		const attack = {isRanged: true, isSpell: false, damage: "1d8"};

		expect(combat._consumePendingWeaponDamageDie(attack)).toBe("1d8");
		expect(combat._pendingDoubleshot).toBeNull();
		// Second qualifying attack gets nothing — the rider was a one-shot.
		expect(combat._consumePendingWeaponDamageDie(attack)).toBeNull();
	});

	it("_activateRangedExtraDieMethod arms the pending flag", () => {
		const combat = makeCombat();
		combat._activateRangedExtraDieMethod({name: "Doubleshot"}, 1, "stamina");
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"});
	});
});

// =========================================================================================
// #21 — Iron Will (gated conditional save advantage)
// =========================================================================================
describe("#21 Iron Will — gated conditional save advantage", () => {
	it("registers a gated save:all advantage modifier sourced from the combat method", () => {
		const state = buildState(IRON_WILL);
		state.applyClassFeatureEffects();

		const mod = state._data.namedModifiers.find(m => m.sourceType === "combatMethod" && m.name === "Iron Will");
		expect(mod).toBeTruthy();
		expect(mod.type).toBe("save:all");
		expect(mod.advantage).toBe(true);
		expect(mod.conditional).toMatch(/charmed/i);
		expect(mod.conditional).toMatch(/frightened/i);
	});

	it("does NOT auto-grant advantage — it surfaces as an opt-in conditional", () => {
		const state = buildState(IRON_WILL);
		state.applyClassFeatureEffects();

		const res = state.aggregateModifiers("save:wis");
		expect(res.advantage).toBe(false); // gated OFF by default
		const offered = res.conditionalsAvailable.find(c => c.name === "Iron Will");
		expect(offered).toBeTruthy();
		expect(offered.advantage).toBe(true);
	});

	it("grants advantage only when the player opts in for the roll", () => {
		const state = buildState(IRON_WILL);
		state.applyClassFeatureEffects();

		const offered = state.aggregateModifiers("save:wis").conditionalsAvailable.find(c => c.name === "Iron Will");
		const applied = new Set([offered.id]);

		const res = state.aggregateModifiers("save:wis", {appliedConditionalIds: applied});
		expect(res.advantage).toBe(true);
	});

	it("is idempotent across repeated effect re-application (no duplicate modifiers)", () => {
		const state = buildState(IRON_WILL);
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();
		const mods = state._data.namedModifiers.filter(m => m.sourceType === "combatMethod" && m.name === "Iron Will");
		expect(mods).toHaveLength(1);
	});
});

// =========================================================================================
// Parser false-positive guard — golden match sets across the full TGTT combat-method catalog
// =========================================================================================
describe("Combat-method parser — catalog golden sets (guards against regex broadening)", () => {
	const homebrew = JSON.parse(readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));
	const methods = homebrew.combatMethod || [];

	function namesMatching (predicate) {
		const state = new CharacterSheetState();
		return methods.filter(m => predicate(state._parseCombatMethodEffects(m))).map(m => m.name).sort();
	}

	it("the catalog actually has combat methods to scan", () => {
		expect(methods.length).toBeGreaterThan(300);
	});

	it("only Catch Your Breath and Unyielding are detected as self-heal methods", () => {
		expect(namesMatching(p => !!p.selfHeal)).toEqual(["Catch Your Breath", "Unyielding"]);
	});

	it("only Doubleshot is detected as a pending-ranged-extra-die method", () => {
		expect(namesMatching(p => !!p.pendingRangedExtraDie)).toEqual(["Doubleshot"]);
	});

	it("only Iron Will is detected as a conditional-save-advantage method", () => {
		expect(namesMatching(p => !!p.conditionalSaveAdvantage)).toEqual(["Iron Will"]);
	});
});
