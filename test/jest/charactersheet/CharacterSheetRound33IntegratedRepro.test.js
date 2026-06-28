/**
 * ROUND 33 — INTEGRATED repro (orchestrator cross-cut).
 *
 * The two R33 fixes were authored in isolated sessions and cherry-picked
 * together onto `character-sheet-wip`:
 *   #2  Combat tab's Combat Methods section never showed a known/max count.
 *       Fix: a "Methods: N / M" mini-stat on BOTH methods stat rows, populated
 *       by `renderCombatMethods` (max via `_getCharacterMaxMethods`, which counts
 *       the Arcane Archer subclass +1 on top of the class CTM progression).
 *   #1  The quiver UX was reworked — the R32 post-attack `quiver` popup hook +
 *       `_pPickQuiverAmmo` were REMOVED in favour of an on-demand "🏹 Special
 *       Arrow" button per ranged-weapon attack row, plus a compact summary +
 *       full-quiver modal at the top of "Weapons & Attacks" (standalone
 *       `#charsheet-combat-quiver-section` removed).
 *
 * This suite proves the two independent fixes COEXIST under a SINGLE real
 * `loadFromJson` of the user's actual save, drive their respective render/logic
 * paths on the SAME combat instance, and survive a serialize→load round-trip
 * (idempotency). It is the orchestrator's guarantee that the cherry-pick
 * integration landed both fixes without regressing either.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

// combat.js wires `document` listeners at construction; provide a minimal
// document so the module imports cleanly (we override getElementById per-test).
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");
const HTML_PATH = path.resolve(__dirnameLocal, "../../../charactersheet.html");

// Stable ids from the real save.
const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	rapier: "3afea0fa-6c63-49e4-b4e9-5187154632d5",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
};

// Faithful Fighter TGTT class data — the real Combat Methods optionalfeatureProgression
// (Level 9 → 9 base methods). Arcane Archer subclass adds +1 → max 10.
const FIGHTER_TGTT_CLASS = {
	name: "Fighter",
	source: "TGTT",
	optionalfeatureProgression: [
		{
			name: "Combat Methods",
			featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
			progression: {"1": 3, "2": 4, "3": 4, "4": 5, "5": 6, "6": 7, "7": 7, "8": 8, "9": 9, "10": 10, "11": 10, "12": 11, "13": 12, "14": 13, "15": 13, "16": 14, "17": 15, "18": 16, "19": 16, "20": 17},
		},
	],
};

const loadState = (json) => {
	const state = new CharacterSheetState();
	state.loadFromJson(json || JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")));
	return state;
};

/** A document whose getElementById returns a memoized `e_` stub per id (so textContent is readable). */
const makeDocStub = () => {
	const els = new Map();
	return {
		_els: els,
		getElementById (id) {
			if (!els.has(id)) els.set(id, globalThis.e_({outer: `<span></span>`}));
			return els.get(id);
		},
		addEventListener () {},
		removeEventListener () {},
		querySelector () { return null; },
	};
};

/** Combat module bound to a state, with the real Fighter TGTT progression + inert render helpers. */
const makeCombat = (state) => {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {getClasses: () => [FIGHTER_TGTT_CLASS], saveCharacter: () => {}};
	combat._renderMethodsToContainer = () => {};
	combat._updateStaminaDisplay = () => {};
	combat._getMethodTradition = (m) => CharacterSheetClassUtils.getTraditionCode(m.tradition) || "BZ";
	return combat;
};

/** Build an attack-like object the way `renderAttacks` does (sourceItem = flat weapon). */
const mkWeaponAttack = (state, weaponId, {isMelee = false} = {}) => {
	const weapon = state.getItems().find(i => i.id === weaponId);
	return {id: `auto_${weaponId}`, name: weapon?.name, sourceItem: weapon, isSpell: false, isMelee};
};

/**
 * Drive `renderCombatMethods` against a fresh doc stub and return the two count
 * elements' textContent (BUG #2 surface).
 */
const renderMethodsAndReadCounts = (combat) => {
	const doc = makeDocStub();
	const realDoc = globalThis.document;
	globalThis.document = doc;
	try {
		combat.renderCombatMethods();
	} finally {
		globalThis.document = realDoc;
	}
	return {
		main: doc.getElementById("charsheet-methods-count").textContent,
		tab: doc.getElementById("charsheet-methods-count-tab").textContent,
	};
};

// ===========================================================================
// Preconditions — prove the save genuinely exercises both surfaces
// ===========================================================================

describe("R33 integrated — preconditions (anti-false-green)", () => {
	const state = loadState();

	test("#2 fixture surfaces 14 known combat methods (over the max of 10)", () => {
		const known = (state._data.features || []).filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		expect(known.length).toBe(14);
	});

	test("#1 fixture has an equipped ranged Longbow (ammoType arrow) and a quiver with ammo", () => {
		const longbow = state.getItems().find(i => i.id === ID.longbow);
		expect(longbow?.ammoType).toBe("arrow|xphb");
		expect((state.getQuiverAmmunitionForWeapon?.(ID.longbow) || []).length).toBeGreaterThan(0);
	});
});

// ===========================================================================
// BUG #2 — Combat Methods count renders on the combat-tab section
// ===========================================================================

describe("R33 integrated — #2 methods count present", () => {
	test("max counts the Arcane Archer subclass +1 over the raw class progression", () => {
		const combat = makeCombat(loadState());
		const rawClassMax = FIGHTER_TGTT_CLASS.optionalfeatureProgression[0].progression["9"];
		expect(rawClassMax).toBe(9);
		expect(combat._getCharacterMaxMethods()).toBe(10); // 9 + Arcane Archer +1
	});

	test("both stat rows show the honest known/max (14 / 10, NOT clamped)", () => {
		const combat = makeCombat(loadState());
		const counts = renderMethodsAndReadCounts(combat);
		expect(counts.main).toBe("14 / 10");
		expect(counts.tab).toBe("14 / 10");
	});
});

// ===========================================================================
// BUG #1 — quiver UX redesign (Special Arrow replaces post-attack popup)
// ===========================================================================

describe("R33 integrated — #1 Special Arrow redesign", () => {
	test("the old post-attack `quiver` hook and `_pPickQuiverAmmo` are GONE", () => {
		const combat = makeCombat(loadState());
		const ids = combat._getPostAttackHooks().map(h => h.id);
		expect(ids).not.toContain("quiver");
		expect(CharacterSheetCombat.prototype._pPickQuiverAmmo).toBeUndefined();
	});

	test("the replacement Special Arrow handlers ARE present", () => {
		expect(CharacterSheetCombat.prototype._pPickSpecialArrowDamage.constructor.name).toBe("AsyncFunction");
		expect(CharacterSheetCombat.prototype._pApplySpecialArrow.constructor.name).toBe("AsyncFunction");
	});

	test("Special Arrow is eligible for the ranged Longbow, NOT for the melee Rapier", () => {
		const state = loadState();
		const combat = makeCombat(state);
		expect(combat._isSpecialArrowEligible(mkWeaponAttack(state, ID.longbow), false)).toBe(true);
		expect(combat._isSpecialArrowEligible(mkWeaponAttack(state, ID.rapier, {isMelee: true}), true)).toBe(false);
	});

	test("the rendered button markup appears only for the eligible weapon", () => {
		const state = loadState();
		const combat = makeCombat(state);
		expect(combat._renderSpecialArrowButton(mkWeaponAttack(state, ID.longbow), false))
			.toContain("charsheet__attack-special-arrow");
		expect(combat._renderSpecialArrowButton(mkWeaponAttack(state, ID.rapier, {isMelee: true}), true))
			.toBe("");
	});
});

// ===========================================================================
// Static HTML — both fixes' markup coexists in charactersheet.html
// ===========================================================================

describe("R33 integrated — static HTML coexistence", () => {
	const html = fs.readFileSync(HTML_PATH, "utf8");

	test("#2 both methods-count ids exist", () => {
		expect(html).toContain(`id="charsheet-methods-count"`);
		expect(html).toContain(`id="charsheet-methods-count-tab"`);
	});

	test("#1 quiver summary + open button exist; standalone section removed", () => {
		expect(html).toContain(`charsheet-combat-quiver-summary`);
		expect(html).toContain(`charsheet-combat-quiver-open`);
		expect(html).not.toContain(`id="charsheet-combat-quiver-section"`);
	});

	test("#1 the Inventory-tab quiver section is untouched", () => {
		expect(html).toContain(`charsheet-inventory-quiver-section`);
	});
});

// ===========================================================================
// Idempotency — both fixes survive a serialize → load round-trip
// ===========================================================================

describe("R33 integrated — round-trip idempotency", () => {
	test("counts + Special Arrow eligibility hold after toJson → load", () => {
		const first = loadState();
		const reloaded = loadState(JSON.parse(JSON.stringify(first.toJson())));
		const combat = makeCombat(reloaded);

		// #2 still 14 / 10
		expect(renderMethodsAndReadCounts(combat).tab).toBe("14 / 10");

		// #1 still eligible for the Longbow, no resurrected popup hook
		expect(combat._isSpecialArrowEligible(mkWeaponAttack(reloaded, ID.longbow), false)).toBe(true);
		expect(combat._getPostAttackHooks().map(h => h.id)).not.toContain("quiver");
	});
});
