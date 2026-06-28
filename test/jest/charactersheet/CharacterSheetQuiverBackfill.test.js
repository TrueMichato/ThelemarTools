/**
 * Quiver backfill (#11) — REAL behaviour against the repro character.
 *
 * A prior pass claimed the quiver was "fully implemented" yet the user still saw
 * an empty/non-functional quiver. This suite LOADS the actual repro character
 * (Fighter 9 TGTT, `fixtures/quiver-backfill-fighter9.json`) whose inventory has:
 *   - an EQUIPPED "Quiver" (containerCapacity arrow|xphb, containedItems: [])
 *   - a loose "Sleep Dart (5)" (type "gear", NOT in the quiver)
 * and asserts the load-time backfill places the dart, the combat-tab quiver
 * section un-hides and lists it, the ranged picker offers it for a compatible
 * weapon, and the whole thing is idempotent across load→save→load.
 */

import "./setup.js";
import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "quiver-backfill-fighter9.json");

let CharacterSheetState;
let CharacterSheetCombat;

function loadFixture () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function loadCharacter (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
}

function findDart (state) {
	return state.getQuiverAmmunition().find(a => /dart/i.test(a.name || ""));
}

beforeAll(async () => {
	const stateModule = await import("../../../js/charactersheet/charactersheet-state.js");
	CharacterSheetState = stateModule.CharacterSheetState || globalThis.CharacterSheetState;

	const combatModule = await import("../../../js/charactersheet/charactersheet-combat.js");
	CharacterSheetCombat = combatModule.CharacterSheetCombat || globalThis.CharacterSheetCombat;
});

// =========================================================================
// Recognition narrowness (Task 1)
// =========================================================================

describe("_isAmmunitionItem narrowness", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("accepts true ammunition and dart/needle throwables", () => {
		expect(state._isAmmunitionItem({name: "Arrows (20)", type: "A"})).toBe(true);
		expect(state._isAmmunitionItem({name: "Crossbow Bolt", bolt: true})).toBe(true);
		expect(state._isAmmunitionItem({name: "Sleep Dart (5)", type: "gear"})).toBe(true);
		expect(state._isAmmunitionItem({name: "Blowgun Needle", type: "gear"})).toBe(true);
	});

	it("rejects bare gear and thrown weapons (dagger/javelin)", () => {
		expect(state._isAmmunitionItem({name: "Dagger", type: "M", weapon: true})).toBe(false);
		expect(state._isAmmunitionItem({name: "Javelin", type: "M", weapon: true})).toBe(false);
		expect(state._isAmmunitionItem({name: "Rope, Hempen (50 feet)", type: "G"})).toBe(false);
		expect(state._isAmmunitionItem(null)).toBe(false);
	});
});

// =========================================================================
// Load backfill against the real repro character (Task 2)
// =========================================================================

describe("loadFromJson quiver backfill (repro character)", () => {
	it("the fixture really starts with an equipped, EMPTY quiver and a loose dart", () => {
		const json = loadFixture();
		const inv = json.inventory;
		const quiver = inv.find(i => /quiver/i.test(i.item?.name || ""));
		const dart = inv.find(i => /sleep dart/i.test(i.item?.name || ""));
		expect(quiver).toBeTruthy();
		expect(quiver.equipped).toBe(true);
		expect(quiver.item.containedItems).toEqual([]);
		expect(dart).toBeTruthy();
		expect(dart.equipped).toBe(false);
		// Guards the premise: the dart is NOT inside the quiver in the saved file.
		expect(quiver.item.containedItems).not.toContain(dart.id);
	});

	it("places the loose Sleep Dart into the equipped quiver on load", () => {
		const state = loadCharacter(loadFixture());

		const quiver = state.getEquippedQuiver();
		expect(quiver).toBeTruthy();

		const ammo = state.getQuiverAmmunition();
		expect(ammo.length).toBeGreaterThan(0);

		const dart = findDart(state);
		expect(dart).toBeTruthy();
		expect(dart.name).toMatch(/sleep dart/i);
	});

	it("offers the contained dart to a dart-compatible ranged weapon (picker source)", () => {
		const state = loadCharacter(loadFixture());

		// Add a dart-throwing weapon so the post-attack picker has a compatible source.
		const weaponId = "test-dart-launcher";
		state.addItem(
			{id: weaponId, name: "Test Dart Launcher", source: "TST", type: "R", weapon: true, ammoType: "dart|xphb", _isCustom: true},
			1, true, false,
		);

		const offered = state.getQuiverAmmunitionForWeapon(weaponId);
		expect(offered.length).toBeGreaterThan(0);
		expect(offered.some(a => /dart/i.test(a.name || ""))).toBe(true);
	});
});

// =========================================================================
// Idempotency (Task 2) — load → save → load must not duplicate/leak
// =========================================================================

describe("quiver backfill idempotency", () => {
	it("load → toJson → load keeps containedItems stable (no dupes, no thrown weapons)", () => {
		const first = loadCharacter(loadFixture());
		const quiver1 = first.getEquippedQuiver();
		const contained1 = [...(first._data.inventory.find(i => i.id === quiver1.id).item.containedItems)];

		const roundTripped = loadCharacter(first.toJson());
		const quiver2 = roundTripped.getEquippedQuiver();
		const contained2 = [...(roundTripped._data.inventory.find(i => i.id === quiver2.id).item.containedItems)];

		// Same set, same length — no duplicates accrued.
		expect(contained2.length).toBe(contained1.length);
		expect(new Set(contained2).size).toBe(contained2.length);
		expect([...contained2].sort()).toEqual([...contained1].sort());

		// No thrown weapon (dagger/javelin/rapier) was ever pulled into the quiver.
		for (const id of contained2) {
			const inv = roundTripped._data.inventory.find(i => i.id === id);
			expect(state_isThrownWeapon(inv?.item)).toBe(false);
		}
	});
});

function state_isThrownWeapon (item) {
	if (!item) return false;
	return /\b(dagger|javelin|rapier|spear|handaxe|trident)\b/i.test(item.name || "");
}

// =========================================================================
// Combat-tab render (Task 3) — compact summary, with a DOM stub
//
// R33 UX REDESIGN: `renderCombatQuiver` now renders a COMPACT summary into
// `#charsheet-combat-quiver-summary` (and shows the 🏹 Quiver header button
// `#charsheet-combat-quiver-open`) instead of un-hiding the old standalone
// `#charsheet-combat-quiver-section`. The full rich quiver moved to a modal
// (`_showQuiverModal`). This test was updated from the old section shape.
// =========================================================================

describe("renderCombatQuiver (R33 compact summary)", () => {
	let originalDocument;

	function stubDom () {
		const els = {
			"charsheet-combat-quiver-summary": {style: {}, innerHTML: "", dataset: {}},
			"charsheet-combat-quiver-open": {style: {display: "none"}, dataset: {}, addEventListener: () => {}},
		};
		originalDocument = globalThis.document;
		globalThis.document = {getElementById: (id) => els[id] || null};
		return els;
	}

	afterEach(() => { globalThis.document = originalDocument; });

	function makeCombat (state) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {};
		return combat;
	}

	it("shows the 🏹 Quiver button and lists the backfilled dart in the compact summary", () => {
		const els = stubDom();
		const state = loadCharacter(loadFixture());
		const combat = makeCombat(state);

		combat.renderCombatQuiver();

		// Header button revealed when a quiver is equipped.
		expect(els["charsheet-combat-quiver-open"].style.display).toBe("");
		// Compact summary lists the ammo (the backfilled dart) with counts.
		expect(els["charsheet-combat-quiver-summary"].innerHTML).toMatch(/dart/i);
		expect(els["charsheet-combat-quiver-summary"].innerHTML).toMatch(/charsheet__quiver-summary/);
	});
});
