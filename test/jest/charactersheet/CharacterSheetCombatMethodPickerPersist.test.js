/**
 * Combat Methods picker PERSISTENCE regression (Round 34, bug #4).
 *
 * Report: the user changes which combat methods they know in the Combat Methods
 * picker modal, reloads the sheet, and the changes are gone.
 *
 * Root cause (UI-only): the picker's per-method add/remove click handlers call
 * `_addCombatMethod` / `_removeCombatMethod` — which mutate state via
 * `addFeature` / `removeFeature` — but never persisted. Only the footer "Done"
 * button called `this._page.saveCharacter()`. Closing the modal via the X button,
 * click-outside, or ESC (cbClose only removes a body class) discarded every change.
 *
 * State-level persistence already works (toJson -> reload keeps both adds and
 * removes), so the fix is to persist on EVERY change: `_addCombatMethod` and
 * `_removeCombatMethod` now call `this._page?.saveCharacter?.()` themselves.
 *
 * This suite proves the change durably survives a save -> reload cycle WITHOUT the
 * Done button ever being clicked, by driving the exact methods the click handlers
 * call and reloading the captured JSON.
 *
 * RED proof: delete the `this._page?.saveCharacter?.()` line from either method and
 * the matching test fails — `saveCharacter` never fires, nothing is captured, and
 * the reloaded sheet does not reflect the change.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");

// ADD target — a real-shaped combat-method catalog entity that is NOT already
// known by the fixture character. `_addCombatMethod` copies `featureType` into the
// persisted feature's `optionalFeatureTypes`, so the CTM markers make it surface
// via `isCombatMethod` / `getCombatMethods` after a reload.
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

// REMOVE target — a plain, manually-learned method present in the fixture. It has
// no `className`/`level`, so it is NOT a level-history class choice that gets
// replayed on load, and the fixture has no `grantsCombatMethods` feature, so the
// reconcile pass will not re-add it. (Methods like "Iron Will" ARE level-history
// choices and are deliberately replayed on reload, so they are not valid targets.)
// It is stored malformed in the fixture, so it is included in the catalog below to
// let `_repairCombatMethodMarkers()` surface it via `getCombatMethods`.
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

/** Mirror the production load order: load -> set catalog -> repair -> reconcile. */
function loadState (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	state.setCombatMethodCatalog(CATALOG);
	state._repairCombatMethodMarkers();
	state.reconcileGrantedCombatMethods();
	return state;
}

function readFixture () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

/**
 * Build a real combat controller bound to a real state, with a `_page` stub whose
 * `saveCharacter()` captures a deep snapshot of `state.toJson()` — exactly what the
 * production save path would persist to storage.
 */
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	const saves = [];
	combat._page = {
		saveCharacter: jest.fn(() => {
			saves.push(JSON.parse(JSON.stringify(state.toJson())));
		}),
	};
	combat._saves = saves;
	return combat;
}

const hasMethod = (state, name) => state.getCombatMethods().some(m => m.name === name);
const featureCount = (state, name) => (state._data.features || []).filter(f => f.name === name).length;

describe("Combat Methods picker persistence (bug #4 — D_kaios Petri v2)", () => {
	test("fixture precondition: ADD target absent, REMOVE target present", () => {
		const state = loadState(readFixture());
		expect(hasMethod(state, NEW_METHOD.name)).toBe(false);
		expect(hasMethod(state, REMOVE_TARGET.name)).toBe(true);
	});

	test("ADD via _addCombatMethod persists across save->reload WITHOUT clicking Done", () => {
		const state = loadState(readFixture());
		const combat = makeCombat(state);

		combat._addCombatMethod(NEW_METHOD);

		// The handler path saved on the change itself — no Done click involved.
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		const captured = combat._saves[combat._saves.length - 1];

		// Reload exactly what was persisted; the learned method must still be there.
		const reloaded = loadState(captured);
		expect(hasMethod(reloaded, NEW_METHOD.name)).toBe(true);
	});

	test("REMOVE via _removeCombatMethod persists across save->reload WITHOUT clicking Done", () => {
		const state = loadState(readFixture());
		const combat = makeCombat(state);
		expect(hasMethod(state, REMOVE_TARGET.name)).toBe(true);

		combat._removeCombatMethod(REMOVE_TARGET);

		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		const captured = combat._saves[combat._saves.length - 1];

		const reloaded = loadState(captured);
		expect(hasMethod(reloaded, REMOVE_TARGET.name)).toBe(false);
	});

	test("ADD is idempotent: re-learning the same method does not duplicate it", () => {
		const state = loadState(readFixture());
		const combat = makeCombat(state);

		combat._addCombatMethod(NEW_METHOD);
		combat._addCombatMethod(NEW_METHOD);

		// addFeature's duplicate guard keeps exactly one persisted feature, even
		// though each click still triggers a (harmless, idempotent) save.
		expect(featureCount(state, NEW_METHOD.name)).toBe(1);

		const captured = combat._saves[combat._saves.length - 1];
		const reloaded = loadState(captured);
		expect(featureCount(reloaded, NEW_METHOD.name)).toBe(1);
		expect(hasMethod(reloaded, NEW_METHOD.name)).toBe(true);
	});

	test("save captures the change for both directions in one session", () => {
		const state = loadState(readFixture());
		const combat = makeCombat(state);

		combat._addCombatMethod(NEW_METHOD);
		combat._removeCombatMethod(REMOVE_TARGET);

		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(2);
		const captured = combat._saves[combat._saves.length - 1];

		const reloaded = loadState(captured);
		expect(hasMethod(reloaded, NEW_METHOD.name)).toBe(true);
		expect(hasMethod(reloaded, REMOVE_TARGET.name)).toBe(false);
	});
});
