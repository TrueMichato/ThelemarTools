/**
 * ROUND 36 — INTEGRATED repro (orchestrator cross-cut).
 *
 * Three follow-up defects reported after R35, all root-caused with LIVE browser
 * reproduction (the bugs live in the runtime load / render paths that the unit
 * suites had not been exercising — which is exactly why three prior "fixed"
 * rounds of #1 were false greens):
 *
 *   #1  Combat-method REMOVAL does not survive a refresh for a method that was
 *       LEARNED at a level. Combat methods are persisted in TWO places —
 *       `_data.features` AND a per-level snapshot in
 *       `levelHistory[].choices.optionalFeatures` (+ `.replayData.optionalFeatures`).
 *       On load, `_reapplyHistoryOptionalFeatures` re-adds every history optional
 *       feature, so a method removed via the picker (which only edited
 *       `_data.features`) was RESURRECTED on the next load. Fix:
 *       `_removeCombatMethod` now also calls the new
 *       `state.removeOptionalFeatureFromHistory(name, source)` to strip the
 *       method from the history snapshots, keeping the removal authoritative.
 *       (This is the bug the Jest suites missed: `toJson()`→reload round-trips
 *       DID run, but no prior test removed a level-history-backed method and then
 *       asserted it stayed gone through `_reapplyHistoryOptionalFeatures`.)
 *
 *   #2  After consuming a selected ammo on the DAMAGE roll, the per-weapon ammo
 *       `<select>` kept a stale count (or a depleted ammo) until a full refresh,
 *       because the consume block re-rendered the quiver + inventory but NOT the
 *       attack rows. Fix: `_rollDamage` now also calls `renderAttacks()` after the
 *       consume so the selector rebuilds from live counts.
 *
 *   #3  Ammo added to inventory IS auto-placed into the equipped quiver, but only
 *       appeared in the ammo selector after a refresh — the inventory add path
 *       never re-rendered the combat tab. Fix: `_addItem` / `_addCustomItem` now
 *       call the new `_refreshCombatAmmoViews()` which re-renders the combat
 *       attack rows + quiver.
 *
 * RED proof (each fix independently):
 *   - drop `removeOptionalFeatureFromHistory` from `_removeCombatMethod` (or make
 *     the new state method a no-op) → the #1 "stays removed after reload" test
 *     FAILS (Iron Will resurrects via the history replay);
 *   - drop the `renderAttacks()` line from the `_rollDamage` consume block → the
 *     #2 "re-renders attacks after consume" test FAILS;
 *   - drop `_refreshCombatAmmoViews()` from `_addItem` / make the helper a no-op
 *     → the #3 wiring test FAILS.
 * With all fixes in place every test below is GREEN.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const ClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");

const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
};

// Faithful subset of the real TGTT combat-method catalog (verbatim markers).
const RAW_CATALOG = [
	{name: "Lean Into It", source: "TGTT", tradition: "Adamant Mountain", degree: 1, staminaCost: 2, actionType: "action"},
	{name: "Shrug It Off", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Warding Wield", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 1, actionType: "bonus action"},
	{name: "Iron Will", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Covering Fire", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "action"},
	{name: "Doubleshot", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action"},
	{name: "Countershot", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 1, actionType: "reaction"},
	{name: "Quickdraw", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Blindshot", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 1, actionType: "bonus action"},
	{name: "Missile Volley", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 2, actionType: "action"},
];
const CATALOG = RAW_CATALOG.map(m => ({...m, _entityType: "combatMethod"}));

// A real-shaped combat-method NOT already known by the fixture.
const NEW_METHOD = {
	name: "Singular Focus",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Unerring Hawk",
	degree: 3,
	staminaCost: 2,
	actionType: "bonus action",
	featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
	entries: ["Choose a creature you can see; you gain advantage on attacks against it."],
};

// A LEVEL-HISTORY-BACKED method present in the real save: Iron Will is learned at
// Fighter level 4 and recorded in levelHistory[3].choices.optionalFeatures AND
// .replayData.optionalFeatures — the exact resurrection vector for #1.
const HISTORY_METHOD = {name: "Iron Will", source: "TGTT"};

function readFixture () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

/** Mirror production load order: load -> set catalog -> repair -> reconcile. */
function loadState (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json || readFixture());
	state.setCombatMethodCatalog(CATALOG);
	state._repairCombatMethodMarkers();
	state.reconcileGrantedCombatMethods();
	return state;
}

const findFeature = (state, name) => (state._data.features || []).find(f => f.name === name);
const hasMethod = (state, name) => state.getCombatMethods().some(m => m.name === name);

const historyHas = (json, name) => (json.levelHistory || []).some(h => {
	const ch = h?.choices || {};
	const a = (ch.optionalFeatures || []).some(o => o.name === name);
	const b = (ch.replayData?.optionalFeatures || []).some(o => o.name === name);
	return a || b;
});

function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._battleTacticToggles = {};
	combat.renderAttacks = jest.fn(() => {});
	combat.renderCombatQuiver = jest.fn(() => {});
	combat._page = {
		saveCharacter: jest.fn(() => {}),
		_inventory: {render: jest.fn(() => {})},
		getOptionalFeatures: () => [],
		getClassFeatures: () => [],
		getClasses: () => [{
			name: "Fighter",
			source: "TGTT",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
			optionalfeatureProgression: [{name: "Combat Methods", featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], progression: {"1": 1}}],
		}],
	};
	return combat;
}

function mkWeaponAttack (state, weaponId, over = {}) {
	const weapon = state.getItems().find(i => i.id === weaponId);
	return {
		id: `auto_${weaponId}`,
		name: weapon?.name,
		sourceItem: weapon,
		isSpell: false,
		isMelee: false,
		damage: "1d8",
		damageType: "piercing",
		abilityMod: "dex",
		...over,
	};
}

/** Inject a synthetic arrow into inventory AND the equipped quiver. */
function addQuiverArrow (state, {id, name, quantity = 5, bonusWeapon}) {
	const item = {name, type: "gear", baseItem: "arrow|xphb", arrow: true, weapon: false, rarity: "uncommon"};
	if (bonusWeapon != null) item.bonusWeapon = bonusWeapon;
	state._data.inventory.push({id, item, quantity, equipped: false, attuned: false});
	const quiver = state._data.inventory.find(i => i.id === ID.quiver);
	quiver.item.containedItems = quiver.item.containedItems || [];
	quiver.item.containedItems.push(id);
}

function wireDamage (combat, state) {
	const captured = {};
	combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
	combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
	combat._promptUseCombatMethod = async () => null;
	combat._promptApplyMethodEffect = async () => false;
	combat._page.pAnimateDamageDice = async () => {};
	combat._page.showDiceResult = (o) => { Object.assign(captured, o); return {}; };
	combat.__captured = captured;
	return captured;
}

// ===========================================================================
// Preconditions — anti-false-green
// ===========================================================================

describe("R36 integrated — preconditions", () => {
	test("raw fixture: Iron Will is a level-learned method present in levelHistory snapshots", () => {
		const json = readFixture();
		// It lives in BOTH the runtime features and the level-4 history snapshots.
		expect((json.features || []).some(f => f.name === "Iron Will")).toBe(true);
		expect(historyHas(json, "Iron Will")).toBe(true);
		const feat = (json.features || []).find(f => f.name === "Iron Will");
		expect(feat.className).toBe("Fighter");
		expect(feat.level).toBe(4);
	});

	test("loaded state surfaces Iron Will as a combat method", () => {
		const state = loadState();
		expect(hasMethod(state, "Iron Will")).toBe(true);
	});

	test("the new state purge helper + the inventory refresh helper exist", () => {
		expect(typeof CharacterSheetState.prototype.removeOptionalFeatureFromHistory).toBe("function");
		expect(typeof CharacterSheetInventory.prototype._refreshCombatAmmoViews).toBe("function");
	});
});

// ===========================================================================
// #1 — removal of a level-history-backed method survives reload
// ===========================================================================

describe("R36 integrated — #1 method removal survives the level-history replay", () => {
	test("removeOptionalFeatureFromHistory strips the method from every snapshot (both arrays)", () => {
		const state = loadState();
		expect(historyHas(state.toJson(), "Iron Will")).toBe(true);
		const changed = state.removeOptionalFeatureFromHistory("Iron Will", "TGTT");
		expect(changed).toBe(true);
		expect(historyHas(state.toJson(), "Iron Will")).toBe(false);
	});

	test("removing a level-learned method via the picker keeps it gone after a full reload", () => {
		const state = loadState();
		const combat = makeCombat(state);

		combat._removeCombatMethod(HISTORY_METHOD);

		// It saved + cleared in-memory immediately.
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(hasMethod(state, "Iron Will")).toBe(false);

		// Round-trip through the REAL load (which runs _reapplyHistoryOptionalFeatures).
		const reloaded = loadState(JSON.parse(JSON.stringify(state.toJson())));
		expect(hasMethod(reloaded, "Iron Will")).toBe(false);
		expect(findFeature(reloaded, "Iron Will")).toBeUndefined();
		expect(historyHas(reloaded.toJson(), "Iron Will")).toBe(false);
	});

	test("a method removed WITHOUT the history purge would be resurrected (guards the real bug)", () => {
		// Simulate the OLD buggy removal: only delete from _data.features, leave the
		// levelHistory snapshots intact. The reload must bring it back — proving the
		// history replay is the true resurrection vector and the purge is required.
		const state = loadState();
		state.removeFeature("Iron Will", "TGTT"); // NO removeOptionalFeatureFromHistory
		expect(hasMethod(state, "Iron Will")).toBe(false);

		const reloaded = loadState(JSON.parse(JSON.stringify(state.toJson())));
		expect(hasMethod(reloaded, "Iron Will")).toBe(true); // resurrected — exactly the bug
	});

	test("learning a NEW method still survives reload (no regression)", () => {
		const state = loadState();
		const combat = makeCombat(state);
		combat._addCombatMethod(NEW_METHOD);
		expect(hasMethod(state, NEW_METHOD.name)).toBe(true);

		const reloaded = loadState(JSON.parse(JSON.stringify(state.toJson())));
		expect(hasMethod(reloaded, NEW_METHOD.name)).toBe(true);
	});

	test("removing one method does NOT disturb its siblings", () => {
		const state = loadState();
		const before = state.getCombatMethods().map(m => m.name).filter(n => n !== "Iron Will").sort();
		makeCombat(state)._removeCombatMethod(HISTORY_METHOD);
		const reloaded = loadState(JSON.parse(JSON.stringify(state.toJson())));
		const after = reloaded.getCombatMethods().map(m => m.name).filter(n => n !== "Iron Will").sort();
		expect(after).toEqual(before);
	});
});

// ===========================================================================
// #2 — consuming selected ammo on the damage roll re-renders the attack rows
// ===========================================================================

describe("R36 integrated — #2 ammo selector refreshes after a damage-roll consume", () => {
	test("rolling damage with a selected ammo consumes it AND re-renders the attack rows", async () => {
		const state = loadState();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 3, bonusWeapon: "+1"});
		state.setSelectedAmmoId(ID.longbow, "plus1");

		const combat = makeCombat(state);
		wireDamage(combat, state);
		await combat._rollDamage(`auto_${ID.longbow}`);

		// One round consumed.
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(2);
		// The attack rows were rebuilt so the <select> count is not stale (the #2 fix).
		expect(combat.renderAttacks).toHaveBeenCalled();
		// And the quiver + inventory were refreshed + persisted, as before.
		expect(combat.renderCombatQuiver).toHaveBeenCalled();
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(combat._page._inventory.render).toHaveBeenCalledTimes(1);
	});

	test("depleting the last round reverts the selection to Regular and still re-renders", async () => {
		const state = loadState();
		addQuiverArrow(state, {id: "last1", name: "+1 Arrow", quantity: 1, bonusWeapon: "+1"});
		state.setSelectedAmmoId(ID.longbow, "last1");

		const combat = makeCombat(state);
		wireDamage(combat, state);
		await combat._rollDamage(`auto_${ID.longbow}`);

		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
		expect(combat.renderAttacks).toHaveBeenCalled();
	});
});

// ===========================================================================
// #3 — adding ammo to inventory refreshes the combat ammo views immediately
// ===========================================================================

describe("R36 integrated — #3 inventory add refreshes the combat ammo selector", () => {
	test("_refreshCombatAmmoViews re-renders the combat attack rows + quiver", () => {
		const inv = Object.create(CharacterSheetInventory.prototype);
		const renderAttacks = jest.fn();
		const renderCombatQuiver = jest.fn();
		inv._page = {_combat: {renderAttacks, renderCombatQuiver}};

		inv._refreshCombatAmmoViews();

		expect(renderAttacks).toHaveBeenCalledTimes(1);
		expect(renderCombatQuiver).toHaveBeenCalledTimes(1);
	});

	test("_refreshCombatAmmoViews is resilient when the combat module is absent", () => {
		const inv = Object.create(CharacterSheetInventory.prototype);
		inv._page = {};
		expect(() => inv._refreshCombatAmmoViews()).not.toThrow();
	});

	test("both inventory add paths invoke the combat ammo refresh", () => {
		// Guards against the wiring being silently dropped from either add path
		// (the full _addItem/_addCustomItem bodies need a live DOM, so we assert the
		// call site is present — the live browser run verified the end-to-end effect).
		expect(/_refreshCombatAmmoViews\s*\(\s*\)/.test(CharacterSheetInventory.prototype._addItem.toString())).toBe(true);
		expect(/_refreshCombatAmmoViews\s*\(\s*\)/.test(CharacterSheetInventory.prototype._addCustomItem.toString())).toBe(true);
	});
});
