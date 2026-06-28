/**
 * ROUND 34 — INTEGRATED repro (orchestrator cross-cut).
 *
 * Two isolated R34 fixes were authored separately and cherry-picked together
 * onto `character-sheet-wip`:
 *   #4  Combat Methods picker did not persist. Closing the modal via X /
 *       click-outside / ESC discarded every add/remove because only the footer
 *       "Done" button saved. Fix: `_addCombatMethod` / `_removeCombatMethod` now
 *       call `this._page?.saveCharacter?.()` themselves.
 *   #1/#2/#3  Quiver / ammunition subsystem. (#1a) newly added ammo auto-places
 *       into an equipped quiver; (#1b) applying a special arrow persists
 *       (`saveCharacter`) and re-renders the Inventory tab (`_inventory.render`);
 *       (#2) the full-quiver display shows every entry, not just the first
 *       sentence; (#3) extra-damage dice are parsed from `entries` TEXT (not only
 *       `bonusWeaponDamage`) and never invented for mundane ammo.
 *
 * This suite proves the two independent fixes COEXIST under a SINGLE real
 * `loadFromJson` of the user's actual save, drive their respective state/render
 * paths on the SAME combat instance, and survive a serialize→load round-trip
 * (idempotency). It is the orchestrator's guarantee that the cherry-pick
 * integration landed both fixes without regressing either.
 *
 * RED proof (each fix independently): strip `saveCharacter` from
 * `_addCombatMethod`/`_removeCombatMethod` → the #4 persistence tests fail; revert
 * the quiver `addItem` auto-place or the active-ammo `_rollDamage` consume hooks →
 * the #1 tests fail. With both fixes in place every test below is GREEN.
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

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");

// Stable ids from the real save.
const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
};

// ADD target — a real-shaped combat-method NOT already known by the fixture.
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

// REMOVE target — a plain manually-learned method present in the fixture (no
// className/level, so NOT replayed from level history on load).
const REMOVE_TARGET = {
	name: "Doubleshot",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Biting Zephyr",
	degree: 1,
	staminaCost: 1,
	actionType: "bonus action",
	optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
	entries: ["Bonus Action (1 Stamina Point). Your next ranged attack uses two missiles."],
};

const CATALOG = [NEW_METHOD, REMOVE_TARGET];

/** Mirror production load order: load -> set catalog -> repair -> reconcile. */
function loadState (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json || JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")));
	state.setCombatMethodCatalog(CATALOG);
	state._repairCombatMethodMarkers();
	state.reconcileGrantedCombatMethods();
	return state;
}

/**
 * Combat controller bound to a real state with a `_page` stub that:
 *  - captures a deep snapshot of `state.toJson()` on each saveCharacter (the #4
 *    persistence surface), and
 *  - records `_inventory.render` calls (the #1b inventory re-render surface).
 */
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	const saves = [];
	const invRenders = [];
	combat._page = {
		saveCharacter: jest.fn(() => { saves.push(JSON.parse(JSON.stringify(state.toJson()))); }),
		_inventory: {render: jest.fn(() => { invRenders.push(1); })},
	};
	combat._saves = saves;
	combat._invRenders = invRenders;
	return combat;
}

const hasMethod = (state, name) => state.getCombatMethods().some(m => m.name === name);
const rawContained = (state, containerId) => {
	const wrap = state._data.inventory.find(i => i.id === containerId);
	return (wrap?.item?.containedItems || []).slice();
};

// ===========================================================================
// Preconditions — prove the single real save exercises both surfaces
// ===========================================================================

describe("R34 integrated — preconditions (anti-false-green)", () => {
	test("#4 fixture: ADD target absent, REMOVE target present as a known method", () => {
		const state = loadState();
		expect(hasMethod(state, NEW_METHOD.name)).toBe(false);
		expect(hasMethod(state, REMOVE_TARGET.name)).toBe(true);
	});

	test("#1 fixture: an equipped quiver holds ammo usable by the ranged Longbow", () => {
		const state = loadState();
		expect(state.getEquippedQuiver()?.id).toBe(ID.quiver);
		expect((state.getQuiverAmmunitionForWeapon?.(ID.longbow) || []).length).toBeGreaterThan(0);
	});
});

// ===========================================================================
// #4 — combat methods picker persists on add/remove WITHOUT clicking Done
// ===========================================================================

describe("R34 integrated — #4 methods persist on every change", () => {
	test("ADD persists across save->reload (no Done click)", () => {
		const state = loadState();
		const combat = makeCombat(state);

		combat._addCombatMethod(NEW_METHOD);

		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		const captured = combat._saves[combat._saves.length - 1];
		expect(hasMethod(loadState(captured), NEW_METHOD.name)).toBe(true);
	});

	test("REMOVE persists across save->reload (no Done click)", () => {
		const state = loadState();
		const combat = makeCombat(state);

		combat._removeCombatMethod(REMOVE_TARGET);

		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		const captured = combat._saves[combat._saves.length - 1];
		expect(hasMethod(loadState(captured), REMOVE_TARGET.name)).toBe(false);
	});
});

// ===========================================================================
// #1a — newly added ammo auto-places into the equipped quiver
// ===========================================================================

describe("R34 integrated — #1a add auto-places into equipped quiver", () => {
	test("a NEW recognised arrow lands in the equipped quiver", () => {
		const state = loadState();
		const newId = "r34-int-arrow";
		expect(rawContained(state, ID.quiver)).not.toContain(newId);

		state.addItem({id: newId, name: "Arrow", source: "XPHB", type: "A", quantity: 20});

		expect(state.getItems().find(i => i.id === newId)).toBeTruthy();
		expect(rawContained(state, ID.quiver)).toContain(newId);
	});

	test("a NON-ammo item is NOT placed into the quiver", () => {
		const state = loadState();
		const newId = "r34-int-torch";
		state.addItem({id: newId, name: "Torch", source: "XPHB", type: "G", quantity: 1});
		expect(rawContained(state, ID.quiver)).not.toContain(newId);
	});
});

// ===========================================================================
// #1b — selecting an ammo: the damage roll persists + re-renders inventory
// ===========================================================================

describe("R34→R35 integrated — #1b active-ammo consume on the damage roll persists + re-renders inventory", () => {
	// R35 (Bug #3): re-pointed from `_pApplySpecialArrow` (removed) to the active-ammo
	// `_rollDamage` consume path — the chosen ammo is consumed once on the damage roll,
	// which persists (saveCharacter) and re-renders the Inventory tab.
	test("decrements the stack AND saves AND re-renders the Inventory tab", async () => {
		const state = loadState();
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);
		const combat = makeCombat(state);
		const weapon = state.getItems().find(i => i.id === ID.longbow);
		combat._cachedAttacks = [{
			id: `auto_${ID.longbow}`,
			name: weapon?.name,
			sourceItem: weapon,
			isSpell: false,
			isMelee: false,
			damage: "1d8",
			damageType: "piercing",
			abilityMod: "dex",
		}];
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat.renderCombatQuiver = () => {};
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = () => ({});

		const arrow = state.getQuiverAmmunitionForWeapon(ID.longbow).find(a => a.id === ID.healingArrow);
		expect(arrow).toBeTruthy();
		const before = state.getItems().find(i => i.id === ID.healingArrow).quantity;

		await combat._rollDamage(`auto_${ID.longbow}`);

		const after = state.getItems().find(i => i.id === ID.healingArrow)?.quantity ?? 0;
		expect(after).toBe(before - 1);
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(combat._invRenders.length).toBe(1);
	});
});

// ===========================================================================
// #2 — full-quiver display shows the COMPLETE description
// ===========================================================================

describe("R34 integrated — #2 full-quiver display shows complete info", () => {
	test("_buildQuiverFullHtml shows the FULL description, not just sentence one", () => {
		const state = loadState();
		const combat = makeCombat(state);
		const html = combat._buildQuiverFullHtml(state.getEquippedQuiver());
		expect(html).toMatch(/Arrows are typically stored in a/);
		expect(html).toMatch(/×/);
	});
});

// ===========================================================================
// #3 — extra-damage parsed from entries TEXT, never invented for mundane
// ===========================================================================

describe("R34 integrated — #3 entries-text damage parser", () => {
	test("parses extra dice from entries text but returns null for mundane", () => {
		const combat = makeCombat(loadState());
		expect(combat._extractAmmoBonusDamage({entries: ["On a hit, the target takes an extra 1d6 fire damage."]}))
			.toEqual({dice: "1d6", type: "fire"});
		expect(combat._extractAmmoBonusDamage({entries: ["Arrows are used with a weapon that has the ammunition property."]}))
			.toBeNull();
	});
});

// ===========================================================================
// Coexistence + round-trip idempotency — both fixes on ONE instance/load
// ===========================================================================

describe("R34 integrated — coexistence + round-trip idempotency", () => {
	test("a single session can change methods AND consume ammo, and both survive reload", async () => {
		const state = loadState();
		const combat = makeCombat(state);
		// R35 (Bug #3): ammo consume is now folded into `_rollDamage`. Wire the
		// damage harness; the #4 method-change assertions below are untouched.
		const weapon = state.getItems().find(i => i.id === ID.longbow);
		combat._cachedAttacks = [{
			id: `auto_${ID.longbow}`,
			name: weapon?.name,
			sourceItem: weapon,
			isSpell: false,
			isMelee: false,
			damage: "1d8",
			damageType: "piercing",
			abilityMod: "dex",
		}];
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat.renderCombatQuiver = () => {};
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = () => ({});

		// #4 — learn a method and forget another, on the same instance.
		combat._addCombatMethod(NEW_METHOD);
		combat._removeCombatMethod(REMOVE_TARGET);

		// #1b — consume the selected ammo on the damage roll, same instance.
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);
		const beforeAmmo = state.getItems().find(i => i.id === ID.healingArrow).quantity;
		await combat._rollDamage(`auto_${ID.longbow}`);

		// The last capture reflects every mutation; reload and verify coexistence.
		const captured = combat._saves[combat._saves.length - 1];
		const reloaded = loadState(captured);

		expect(hasMethod(reloaded, NEW_METHOD.name)).toBe(true);
		expect(hasMethod(reloaded, REMOVE_TARGET.name)).toBe(false);
		expect(reloaded.getItems().find(i => i.id === ID.healingArrow)?.quantity ?? 0).toBe(beforeAmmo - 1);

		// Idempotency: a further toJson->load preserves all three mutation facts
		// and the quiver is still structurally equipped.
		const again = loadState(JSON.parse(JSON.stringify(reloaded.toJson())));
		expect(hasMethod(again, NEW_METHOD.name)).toBe(true);
		expect(hasMethod(again, REMOVE_TARGET.name)).toBe(false);
		expect(again.getItems().find(i => i.id === ID.healingArrow)?.quantity ?? 0).toBe(beforeAmmo - 1);
		expect(again.getEquippedQuiver()?.id).toBe(ID.quiver);
	});

	test("combat-method markers stay sane (no duplicate Singular Focus) after reload", () => {
		const state = loadState();
		const combat = makeCombat(state);
		combat._addCombatMethod(NEW_METHOD);
		combat._addCombatMethod(NEW_METHOD); // idempotent re-learn
		const captured = combat._saves[combat._saves.length - 1];
		const reloaded = loadState(captured);
		const count = (reloaded._data.features || []).filter(f => f.name === NEW_METHOD.name && CharacterSheetClassUtils.isCombatMethod(f)).length;
		expect(count).toBe(1);
	});
});
