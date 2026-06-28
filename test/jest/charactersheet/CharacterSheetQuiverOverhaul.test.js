/**
 * ROUND 32 — Quiver overhaul, ANTI-FALSE-GREEN regression against the REAL save.
 *
 * Loads the user's actual character (`fixtures/D_kaios_Petri_2_v2.json`, a
 * Fighter 9 TGTT Arcane Archer with `settings.ammunitionTracking = false`) and
 * pins ALL FIVE reported quiver defects against it. The save is deliberately
 * "dirty": a prior backfill baked the equipped Quiver's `containedItems` to
 * `[armorId, sleepDartId]` — i.e. the equipped Studded Leather ARMOR is wrongly
 * inside the quiver, and the gear-typed "Healing Arrow" is loose & unrecognised.
 *
 * Defects pinned here:
 *   #2  gear ammo ("Healing Arrow") IS recognised.
 *   #3  ARMOR is NOT recognised as ammo (the `startsWith("A")` bug).
 *   #4  bundle "Sleep Dart (5)" reports 5 effective rounds, not 1.
 *   #5  the ranged quiver picker offers Healing Arrow for the Longbow EVEN THOUGH
 *       ammunition tracking is OFF.
 *   #1  the quiver section lives in the Combat + Inventory tabs, NOT Overview.
 * Plus the PURGE migration (baked armor removed on load) and idempotency.
 */

import "./setup.js";
import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "D_kaios_Petri_2_v2.json");
const HTML_PATH = path.join(__dirname, "..", "..", "..", "charactersheet.html");

// Stable ids from the real save.
const ID = {
	armor: "ad9cca9b-e827-4ca4-b13c-4884ac095698",
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	handCrossbow: "f954015b-aa53-4630-b6f0-d0006d6f31c8",
	blowgun: "112bf427-7ea9-40ab-bede-b1f86761fa89",
	sleepDart: "e547e8e3-5e04-4756-a750-b8fcdae6191e",
	rapier: "3afea0fa-6c63-49e4-b4e9-5187154632d5",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
};

function loadFixtureJson () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function loadCharacter (json = loadFixtureJson()) {
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
}

/** Raw `containedItems` array of an inventory wrapper (no flattening). */
function rawContained (state, containerId) {
	const wrap = state._data.inventory.find(i => i.id === containerId);
	return (wrap?.item?.containedItems || []).slice();
}

function flat (state, id) {
	return state.getItems().find(i => i.id === id);
}

// ===========================================================================
// Premise guard — the saved file really is "dirty" (armor baked into quiver)
// ===========================================================================

describe("repro premise — the saved quiver wrongly contains the armor", () => {
	it("the fixture's equipped Quiver containedItems = [armor, sleepDart] (armor inside!)", () => {
		const json = loadFixtureJson();
		const quiver = json.inventory.find(i => i.id === ID.quiver);
		expect(quiver.equipped).toBe(true);
		expect(quiver.item.containedItems).toContain(ID.armor); // the bug, baked in
		expect(quiver.item.containedItems).toContain(ID.sleepDart);
		// Healing Arrow is loose (NOT yet in the quiver) and not equipped.
		const healing = json.inventory.find(i => i.id === ID.healingArrow);
		expect(healing.equipped).toBe(false);
		expect(quiver.item.containedItems).not.toContain(ID.healingArrow);
		// Tracking is OFF in the user's save.
		expect(json.settings?.ammunitionTracking).toBe(false);
	});
});

// ===========================================================================
// Defects #2 / #3 — recognition predicate (matrix against the REAL items)
// ===========================================================================

describe("_isAmmunitionItem — recognition matrix on the real inventory", () => {
	let state;
	beforeEach(() => { state = loadCharacter(); });

	it("ARMOR is NOT ammunition (the 'ARMOR'.startsWith('A') bug — defect #3)", () => {
		expect(state._isAmmunitionItem(flat(state, ID.armor))).toBe(false);
	});

	it("gear-typed 'Healing Arrow' IS ammunition (defect #2)", () => {
		expect(state._isAmmunitionItem(flat(state, ID.healingArrow))).toBe(true);
	});

	it("gear-typed 'Sleep Dart (5)' IS ammunition", () => {
		expect(state._isAmmunitionItem(flat(state, ID.sleepDart))).toBe(true);
	});

	it("the bows/launchers/melee are NOT ammunition (Longbow / Hand Crossbow / Blowgun / Rapier)", () => {
		expect(state._isAmmunitionItem(flat(state, ID.longbow))).toBe(false);
		expect(state._isAmmunitionItem(flat(state, ID.handCrossbow))).toBe(false);
		expect(state._isAmmunitionItem(flat(state, ID.blowgun))).toBe(false);
		expect(state._isAmmunitionItem(flat(state, ID.rapier))).toBe(false);
	});

	it("a source-suffixed true ammo code 'A|XPHB' still counts (split, not startsWith)", () => {
		expect(state._isAmmunitionItem({name: "Arrow", type: "A|XPHB"})).toBe(true);
		expect(state._isAmmunitionItem({name: "Firearm Bullet", type: "AF|XDMG"})).toBe(true);
		// ...but 'armor|...' and 'apparatus' never sweep in.
		expect(state._isAmmunitionItem({name: "Plate", type: "armor|phb"})).toBe(false);
	});
});

// ===========================================================================
// PURGE migration — baked armor removed from the quiver on load
// ===========================================================================

describe("load purges stale non-ammo from the quiver (baked armor)", () => {
	it("after load, the quiver's raw containedItems DROPS the armor and KEEPS real ammo", () => {
		const state = loadCharacter();
		const contained = rawContained(state, ID.quiver);
		expect(contained).not.toContain(ID.armor); // purged
		expect(contained).toContain(ID.sleepDart); // kept
		expect(contained).toContain(ID.healingArrow); // backfilled (now recognised)
	});

	it("getQuiverAmmunition surfaces Healing Arrow + Sleep Dart, NEVER the armor", () => {
		const state = loadCharacter();
		const ids = state.getQuiverAmmunition(ID.quiver).map(a => a.id);
		expect(ids).toContain(ID.healingArrow);
		expect(ids).toContain(ID.sleepDart);
		expect(ids).not.toContain(ID.armor);
	});
});

// ===========================================================================
// Defect #4 — bundle effective count
// ===========================================================================

describe("getEffectiveAmmoCount — bundle quantity (defect #4)", () => {
	let state;
	beforeEach(() => { state = loadCharacter(); });

	it("'Sleep Dart (5)' (quantity 1) resolves to 5 effective rounds", () => {
		expect(state.getEffectiveAmmoCount(flat(state, ID.sleepDart))).toBe(5);
	});

	it("a non-bundle item resolves to its raw quantity", () => {
		expect(state.getEffectiveAmmoCount(flat(state, ID.healingArrow))).toBe(1);
		expect(state.getEffectiveAmmoCount({name: "Arrows", quantity: 20})).toBe(20);
	});

	it("guards null / missing quantity", () => {
		expect(state.getEffectiveAmmoCount(null)).toBe(0);
		expect(state.getEffectiveAmmoCount({name: "Sleep Dart (5)"})).toBe(0); // qty undefined → 0
	});
});

// ===========================================================================
// Defect #5 — ranged picker integration, even with tracking OFF
// ===========================================================================

describe("getQuiverAmmunitionForWeapon — attack integration (defect #5)", () => {
	it("the Longbow ('arrow|xphb') is offered the Healing Arrow from the quiver", () => {
		const state = loadCharacter();
		expect(state.isAmmunitionTrackingEnabled()).toBe(false); // user has it OFF
		const offered = state.getQuiverAmmunitionForWeapon(ID.longbow).map(a => a.id);
		expect(offered).toContain(ID.healingArrow);
		// The Sleep Dart is NOT an arrow, so it is NOT offered to the Longbow.
		expect(offered).not.toContain(ID.sleepDart);
		expect(offered).not.toContain(ID.armor);
	});
});

// ===========================================================================
// Idempotency — load → toJson → load keeps containedItems clean
// ===========================================================================

describe("idempotency — round-trip keeps the quiver clean", () => {
	it("load → toJson → load: no armor, no duplicates, stable set", () => {
		const first = loadCharacter();
		const c1 = rawContained(first, ID.quiver);

		const round = loadCharacter(first.toJson());
		const c2 = rawContained(round, ID.quiver);

		expect(c2).not.toContain(ID.armor);
		expect(new Set(c2).size).toBe(c2.length); // no dupes
		expect([...c2].sort()).toEqual([...c1].sort()); // stable
	});
});

// ===========================================================================
// Defect #1 — the quiver section lives in Combat + Inventory, NOT Overview
// ===========================================================================

describe("quiver section placement in charactersheet.html (defect #1)", () => {
	const html = fs.readFileSync(HTML_PATH, "utf8");
	const idx = (s) => html.indexOf(s);

	const overview = idx(`id="charsheet-tab-overview"`);
	const combat = idx(`id="charsheet-tab-combat"`);
	const spells = idx(`id="charsheet-tab-spells"`);
	const inventory = idx(`id="charsheet-tab-inventory"`);
	const features = idx(`id="charsheet-tab-features"`);
	const combatQuiver = idx(`id="charsheet-combat-quiver-section"`);
	const invQuiver = idx(`id="charsheet-inventory-quiver-section"`);

	it("the combat quiver section exists and sits INSIDE the Combat tab", () => {
		expect(combatQuiver).toBeGreaterThan(-1);
		expect(combatQuiver).toBeGreaterThan(combat);
		expect(combatQuiver).toBeLessThan(spells);
	});

	it("the combat quiver section is NOT inside the Overview tab", () => {
		const inOverview = combatQuiver > overview && combatQuiver < combat;
		expect(inOverview).toBe(false);
	});

	it("an Inventory-tab quiver section exists inside the Inventory tab", () => {
		expect(invQuiver).toBeGreaterThan(-1);
		expect(invQuiver).toBeGreaterThan(inventory);
		expect(invQuiver).toBeLessThan(features);
	});

	it("there is exactly ONE combat-quiver section element (not duplicated across tabs)", () => {
		const matches = html.split(`id="charsheet-combat-quiver-section"`).length - 1;
		expect(matches).toBe(1);
	});
});
