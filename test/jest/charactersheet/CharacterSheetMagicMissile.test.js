/**
 * Bug #4 — Magic Missile damage (projectile / dart count).
 *
 * `_rollSpellDamage` previously extracted the single `{@damage 1d4 + 1}` and
 * rolled it ONCE, so Magic Missile dealt one dart (≈5) instead of three at L1
 * (+1 dart per slot level above 1st). The fix adds `_getProjectileSpellInfo`
 * (generic dart/missile/projectile detection) feeding a `diceMultiplier` into
 * `_rollDamageDiceDetailed`. These tests drive that pure logic on a prototype
 * shell with a deterministic `_page.rollDice`, and assert normal spells are
 * not regressed.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

function makeSpells ({rollValue = 2} = {}) {
	const animateCalls = [];
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = {
		// Deterministic single-die roller: always returns `rollValue` (1..sides).
		rollDice: (n, sides) => Math.min(rollValue, sides),
		pAnimateDamageDice: (groups) => { animateCalls.push(groups); },
	};
	spells._state = {
		getItemBonus: () => 0,
		getTotalLevel: () => 5,
	};
	spells._animateCalls = animateCalls;
	return spells;
}

const MAGIC_MISSILE = {
	name: "Magic Missile",
	level: 1,
	damageInflict: ["force"],
	entries: [
		"You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see within range. A dart deals {@damage 1d4 + 1} force damage to its target. The darts all strike simultaneously, and you can direct them to hit one creature or several.",
	],
	entriesHigherLevel: [
		{
			type: "entries",
			name: "At Higher Levels",
			entries: ["When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st."],
		},
	],
};

const FIREBALL = {
	name: "Fireball",
	level: 3,
	damageInflict: ["fire"],
	entries: ["Each creature in a 20-foot-radius sphere must make a Dexterity saving throw. A target takes {@damage 8d6} fire damage on a failed save, or half as much damage on a successful one."],
	entriesHigherLevel: [
		{type: "entries", name: "At Higher Levels", entries: ["the damage increases by {@scaledamage 8d6|3-9|1d6} for each slot level above 3rd."]},
	],
};

const SCORCHING_RAY = {
	name: "Scorching Ray",
	level: 2,
	damageInflict: ["fire"],
	entries: ["You create three rays of fire and hurl them at targets within range. Make a ranged spell attack for each ray. On a hit, the target takes {@damage 2d6} fire damage."],
	entriesHigherLevel: [
		{type: "entries", name: "At Higher Levels", entries: ["you create one more ray for each slot level above 2nd."]},
	],
};

describe("_getProjectileSpellInfo (dart/missile detection)", () => {
	test("Magic Missile at base level fires 3 darts", () => {
		const spells = makeSpells();
		const info = spells._getProjectileSpellInfo(MAGIC_MISSILE, "1d4 + 1", 1, 1);
		expect(info).toEqual({count: 3, perDartDice: "1d4 + 1"});
	});

	test("Magic Missile upcast adds one dart per slot level above 1st", () => {
		const spells = makeSpells();
		expect(spells._getProjectileSpellInfo(MAGIC_MISSILE, "1d4 + 1", 2, 1).count).toBe(4);
		expect(spells._getProjectileSpellInfo(MAGIC_MISSILE, "1d4 + 1", 3, 1).count).toBe(5);
		expect(spells._getProjectileSpellInfo(MAGIC_MISSILE, "1d4 + 1", 9, 1).count).toBe(11);
	});

	test("Fireball is NOT a projectile spell (returns null)", () => {
		const spells = makeSpells();
		expect(spells._getProjectileSpellInfo(FIREBALL, "8d6", 3, 3)).toBeNull();
	});

	test("does not misfire on attack-roll ray spells (no auto-hit darts)", () => {
		// Scorching Ray DOES say 'three rays' but the word list only matches
		// darts/missiles/projectiles, so it must not be treated as auto-hit.
		const spells = makeSpells();
		expect(spells._getProjectileSpellInfo(SCORCHING_RAY, "2d6", 2, 2)).toBeNull();
	});
});

describe("_rollSpellDamage (Bug #4)", () => {
	test("Magic Missile at L1 rolls 3 × (1d4 + 1) = 3 darts, not one", () => {
		// rollDice always returns 2 (a d4 face). 3 darts: dice 3×2=6, mod 3×1=3 → 9.
		const spells = makeSpells({rollValue: 2});
		const res = spells._rollSpellDamage(MAGIC_MISSILE, 1, 1);
		expect(res.total).toBe(9);
		expect(res.dice).toBe("3× 1d4 + 1");
		// Animation must reflect three d4 dice.
		expect(spells._animateCalls.length).toBe(1);
		expect(spells._animateCalls[0]).toEqual([{sides: 4, values: [2, 2, 2]}]);
	});

	test("Magic Missile upcast to L3 rolls 5 darts", () => {
		const spells = makeSpells({rollValue: 2});
		const res = spells._rollSpellDamage(MAGIC_MISSILE, 3, 1);
		// 5 darts: dice 5×2=10, mod 5×1=5 → 15.
		expect(res.total).toBe(15);
		expect(res.dice).toBe("5× 1d4 + 1");
		expect(spells._animateCalls[0]).toEqual([{sides: 4, values: [2, 2, 2, 2, 2]}]);
	});

	test("Magic Missile total stays within the rules bounds (dartCount × (1d4+1))", () => {
		for (let trial = 0; trial < 50; ++trial) {
			const spells = Object.create(CharacterSheetSpells.prototype);
			spells._page = {rollDice: (n, sides) => Math.floor(Math.random() * sides) + 1, pAnimateDamageDice: () => {}};
			spells._state = {getItemBonus: () => 0, getTotalLevel: () => 5};
			const res = spells._rollSpellDamage(MAGIC_MISSILE, 1, 1);
			expect(res.total).toBeGreaterThanOrEqual(3 * (1 + 1)); // 3 × (min 1d4=1 +1)
			expect(res.total).toBeLessThanOrEqual(3 * (4 + 1)); // 3 × (max 1d4=4 +1)
		}
	});

	test("Fireball is unaffected — rolls 8d6 once (no projectile multiplier)", () => {
		const spells = makeSpells({rollValue: 3});
		const res = spells._rollSpellDamage(FIREBALL, 3, 3);
		// 8 dice × 3 = 24, no flat modifier.
		expect(res.total).toBe(24);
		expect(res.dice).toBe("8d6");
		expect(spells._animateCalls[0]).toEqual([{sides: 6, values: [3, 3, 3, 3, 3, 3, 3, 3]}]);
	});
});

describe("_rollDamageDiceDetailed", () => {
	test("rolls per-die values and a multiplied flat modifier", () => {
		const spells = makeSpells({rollValue: 2});
		const detail = spells._rollDamageDiceDetailed("1d4 + 1", {diceMultiplier: 3});
		expect(detail.groups).toEqual([{sides: 4, values: [2, 2, 2]}]);
		expect(detail.modifier).toBe(3); // 1 × 3
		expect(detail.total).toBe(9); // 6 dice + 3 mod
	});

	test("maximize forces the max face on every die", () => {
		const spells = makeSpells({rollValue: 1});
		const detail = spells._rollDamageDiceDetailed("2d6", {maximize: true});
		expect(detail.groups).toEqual([{sides: 6, values: [6, 6]}]);
		expect(detail.total).toBe(12);
	});

	test("a non-dice string yields no groups", () => {
		const spells = makeSpells();
		const detail = spells._rollDamageDiceDetailed("flat 5");
		expect(detail.groups).toEqual([]);
	});
});
