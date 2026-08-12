/**
 * Beastheart (MCDM, BST) — companion stat-block scaling.
 *
 * Asserts DERIVED numbers against the printed stat blocks, not flags:
 *  - the companion's AC / HP / saves / skills / attack resolve from the author's
 *    "13 plus PB", "7 + 7 times caregiver's level", "{@hit +3+PB}" strings;
 *  - they track the caregiver's level and proficiency bonus on level-up;
 *  - live combat state (current HP, conditions) survives a re-scale.
 *
 * The scaling itself is the SHARED `ScaleClassSummonedCreature` used by the bestiary,
 * DM screen and renderer — these tests exist to prove the sheet reuses it correctly,
 * not to re-test the scaler.
 */

import "./beastheartTestHarness.js";
import BST from "./fixtures/beastheart-bst.json" with {type: "json"};

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const getMonster = name => BST.monster.find(m => m.name === name);

describe("Beastheart — companion stat-block scaling", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		CharacterSheetState._CLASS_SUMMON_SCALER = undefined;
	});

	function setLevel (level) {
		state.addClass({name: "Beastheart", source: "BST", level, hitDice: "d8"});
	}

	function makeBeastheart (level, companionName = "Owlbear Companion") {
		setLevel(level);
		state.setAbilityBase("str", 12);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16);
		state.setAbilityBase("cha", 10);
		return state.addCompanionFromBestiary(
			getMonster(companionName),
			CharacterSheetState.COMPANION_TYPES.BEASTHEART_COMPANION,
			"Companion",
			{
				scaling: {
					className: "Beastheart",
					statblockScaler: "classSummon",
					statblock: getMonster(companionName),
				},
			},
		);
	}

	// -------------------------------------------------------------------------
	// HP — "7 + 7 times caregiver's level"
	// -------------------------------------------------------------------------
	describe("hit points scale with caregiver level", () => {
		it.each([
			[1, 14],
			[3, 28],
			[5, 42],
			[11, 84],
			[20, 147],
		])("Owlbear at Beastheart %i has %i HP", (level, expected) => {
			const id = makeBeastheart(level);
			expect(state.getCompanion(id).hp.max).toBe(expected);
		});

		it("raises HP on level-up and keeps a full companion full", () => {
			const id = makeBeastheart(1);
			expect(state.getCompanion(id).hp.max).toBe(14);
			expect(state.getCompanion(id).hp.current).toBe(14);

			setLevel(5);
			const c = state.getCompanion(id);
			expect(c.hp.max).toBe(42);
			expect(c.hp.current).toBe(42);
		});

		it("preserves damage taken across a level-up", () => {
			const id = makeBeastheart(1);
			state.damageCompanion(id, 6); // 14 -> 8
			expect(state.getCompanion(id).hp.current).toBe(8);

			setLevel(5);
			const c = state.getCompanion(id);
			expect(c.hp.max).toBe(42);
			// Still 6 damage down, not silently healed to full.
			expect(c.hp.current).toBe(8);
		});
	});

	// -------------------------------------------------------------------------
	// AC — "13 plus PB (natural armor)"
	// -------------------------------------------------------------------------
	describe("armour class tracks proficiency bonus", () => {
		it.each([
			[1, 15],
			[5, 16],
			[9, 17],
			[13, 18],
			[17, 19],
		])("Owlbear at Beastheart %i has AC %i", (level, expected) => {
			const id = makeBeastheart(level);
			expect(state.getCompanion(id).ac).toBe(expected);
		});
	});

	// -------------------------------------------------------------------------
	// Attacks — "{@hit +3+PB}" / "{@damage 1d6+PB}"
	// -------------------------------------------------------------------------
	describe("signature attack resolves PB into concrete numbers", () => {
		// "+3 plus PB" to hit, "1d6 plus PB" damage. PB is 2 at L1 and 5 at L13.
		it("renders +5 to hit and 1d6 + 2 at level 1 (PB 2)", () => {
			const id = makeBeastheart(1);
			const claws = state.getCompanion(id).actions.find(a => /Claws/.test(a.name));
			expect(claws).toBeTruthy();
			const text = claws.entries.join(" ");
			expect(text).not.toMatch(/\bPB\b/);
			expect(text).toMatch(/\{@hit 5[|}]/);
			expect(text).toMatch(/\{@damage 1d6 \+ 2[|}]/);
		});

		it("rises to +8 to hit and 3d6 + 5 at level 13 (PB 5, +2 dice from Improved Signature Attack)", () => {
			const id = makeBeastheart(13);
			const text = state.getCompanion(id).actions.find(a => /Claws/.test(a.name)).entries.join(" ");
			expect(text).toMatch(/\{@hit 8[|}]/);
			// The printed die is 1d6; Improved Signature Attack adds a die at 5th and again
			// at 11th, so a 13th-level companion swings three dice, not one.
			expect(text).toMatch(/\{@damage 3d6 \+ 5[|}]/);
		});

		it("leaves no unresolved PB tokens anywhere in the stat block", () => {
			const id = makeBeastheart(9);
			const c = state.getCompanion(id);
			const blob = JSON.stringify([c.actions, c.traits, c.reactions, c.bonusActions]);
			expect(blob).not.toMatch(/\bplus PB\b/);
			expect(blob).not.toMatch(/\+PB\b/);
		});
	});

	// -------------------------------------------------------------------------
	// Live state survives re-scaling
	// -------------------------------------------------------------------------
	describe("re-scaling preserves live combat state", () => {
		it("keeps conditions and temp HP across a level-up", () => {
			const id = makeBeastheart(3);
			state.addCompanionCondition(id, "prone");
			state.setCompanionTempHp(id, 5);

			setLevel(4);

			const c = state.getCompanion(id);
			expect(c.conditions).toContain("prone");
			expect(c.hp.temp).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// The roster is real and every entry scales
	// -------------------------------------------------------------------------
	describe("every companion in the roster scales", () => {
		it("has 15 companions", () => {
			expect(BST.monster).toHaveLength(15);
		});

		it.each(BST.monster.map(m => m.name))("%s resolves concrete HP and AC at level 5", name => {
			const id = makeBeastheart(5, name);
			const c = state.getCompanion(id);
			expect(c.hp.max).toBeGreaterThan(1);
			expect(Number.isFinite(c.ac)).toBe(true);
			expect(c.ac).toBeGreaterThan(9);
		});
	});

	// -------------------------------------------------------------------------
	// Degraded mode
	// -------------------------------------------------------------------------
	describe("degrades safely without the scaler", () => {
		it("keeps the stored stat block rather than throwing", () => {
			const id = makeBeastheart(5);
			const before = state.getCompanion(id).hp.max;
			CharacterSheetState._CLASS_SUMMON_SCALER = null;
			expect(() => setLevel(9)).not.toThrow();
			expect(state.getCompanion(id).hp.max).toBe(before);
		});
	});
});

// ---------------------------------------------------------------------------
// CS-BUG-141 — the companion RECORD must carry every field the card draws.
//
// The render gap itself lives in `charactersheet.js` (a DOM module these tests
// do not load), so these assertions pin the contract the renderers depend on:
// if the parser ever stops populating a defence or a movement type, the card
// silently loses a row again and this goes red first.
// ---------------------------------------------------------------------------
describe("Beastheart — companion record carries renderable defences and movement (CS-BUG-141)", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		CharacterSheetState._CLASS_SUMMON_SCALER = undefined;
	});

	// `addCompanionFromBestiary` returns the new companion's ID, not the record — the
	// record is fetched back through the accessor the UI itself uses.
	function bond (companionName) {
		if (!state.getClassLevel("beastheart")) state.addClass({name: "Beastheart", source: "BST", level: 5, hitDice: "d8"});
		state.addCompanionFromBestiary(
			getMonster(companionName),
			CharacterSheetState.COMPANION_TYPES.BEASTHEART_COMPANION,
			"Companion",
			{scaling: {className: "Beastheart", statblockScaler: "classSummon", statblock: getMonster(companionName)}},
		);
		return state.getBeastheartCompanion();
	}

	it("preserves a burrow speed, which one renderer used to omit entirely", () => {
		const companion = bond("Bulette Companion");
		expect(getMonster("Bulette Companion").speed.burrow).toBe(30);
		expect(companion.speed.burrow).toBe(30);
	});

	it("preserves a climb speed, which the compact row used to omit", () => {
		const companion = bond("Giant Spider Companion");
		expect(companion.speed.climb).toBe(30);
	});

	it("keeps every movement type the source stat block declares", () => {
		["Blood Hawk Companion", "Giant Toad Companion", "Earth Elemental Companion"].forEach(name => {
			const src = getMonster(name).speed;
			const got = bond(name).speed;
			Object.keys(src).forEach(k => expect(got[k]).toBe(src[k]));
			state.removeCompanion(state.getBeastheartCompanion().id);
		});
	});

	it("exposes defences as arrays the card can render, never undefined", () => {
		const companion = bond("Owlbear Companion");
		expect(Array.isArray(companion.resistances)).toBe(true);
		expect(Array.isArray(companion.immunities)).toBe(true);
		expect(Array.isArray(companion.conditionImmunities)).toBe(true);
	});

	it("surfaces a bond-granted resistance on the record so the card has something to draw", () => {
		const companion = bond("Owlbear Companion");
		expect(companion.resistances).not.toContain("bludgeoning");

		state._data.beastheart = {...(state._data.beastheart || {}), fiendishFormCompanionId: companion.id};
		state.recalculateCompanion(companion.id);

		const after = state.getBeastheartCompanion();
		expect(after.resistances).toEqual(expect.arrayContaining(["bludgeoning", "piercing", "slashing"]));
	});

	describe("reentrancy guard on companion bonus application", () => {
		// `_applyBeastheartCompanionBonuses` reads `getFeatureCalculations()`, a broad
		// derivation. No path back into companion recalculation was ever observed, but it
		// could not be proven impossible — so the guard turns a hypothetical cycle into a
		// diagnosable no-op rather than a stack overflow. These tests prove the guard
		// actually works, so it is insurance that has been fired at least once.

		it("survives a calculation that re-enters the companion path, instead of overflowing", () => {
			const companion = bond("Bulette Companion");
			// This suite runs as ESM, where the `jest` global is absent — stub directly.
			const realWarn = console.warn;
			/** @type {Array<string>} */ const warnings = [];
			console.warn = (msg) => warnings.push(String(msg));

			// Simulate the worst case: a feature calculation that reaches back into the
			// companion bonus path. Without the guard this recurses until the stack dies.
			let depth = 0;
			const realCalc = state.getFeatureCalculations.bind(state);
			state.getFeatureCalculations = () => {
				if (depth++ < 5) state._applyBeastheartCompanionBonuses(companion);
				return realCalc();
			};

			expect(() => state._applyBeastheartCompanionBonuses(companion)).not.toThrow();

			state.getFeatureCalculations = realCalc;
			console.warn = realWarn;

			// The nested pass was refused, and said so.
			expect(warnings.some(w => w.includes("Re-entered"))).toBe(true);
			// The guard is released once the outer pass unwinds.
			expect(state._isApplyingBeastheartBonuses).toBe(false);
		});

		it("resets the guard afterwards, so a later pass still applies bonuses", () => {
			const companion = bond("Bulette Companion");

			// Throw from inside the guarded body; the `finally` must still clear the flag.
			const realCalc = state.getFeatureCalculations.bind(state);
			state.getFeatureCalculations = () => { throw new Error("boom"); };
			expect(() => state._applyBeastheartCompanionBonuses(companion)).toThrow("boom");
			state.getFeatureCalculations = realCalc;

			expect(state._isApplyingBeastheartBonuses).toBe(false);

			// A subsequent pass is not suppressed: Loyal to the End (13th) still lands.
			state.addClass({name: "Beastheart", source: "BST", level: 13, hitDice: "d8"});
			state.getFeatureCalculations = () => ({hasLoyalToTheEnd: true});
			state._applyBeastheartCompanionBonuses(companion);
			state.getFeatureCalculations = realCalc;

			expect(companion.conditionImmunities).toEqual(expect.arrayContaining(["charmed", "frightened"]));
		});
	});
});
