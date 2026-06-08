/**
 * Bug #13 — Wild Shape "Transform" regression: the companion type/origin
 * contract.
 *
 * ROOT CAUSE: the shared beast picker in `charactersheet.js` called
 *   `addCompanionFromBestiary(creature, {type, origin})`
 * passing an OBJECT where a positional string `type` was expected
 * (`addCompanionFromBestiary(creature, type, origin, options)`). The object is
 * truthy, so it was stored verbatim as `companion.type`, which never `===`
 * a string `COMPANION_TYPES` value. Consequences:
 *   - `getCompanionsByType(WILD_SHAPE)` never matched → the Druid Resources
 *     before/after diff found no new Wild Shape companion → the Wild Shape use
 *     was NEVER spent (the visible regression);
 *   - the mis-typed companion still rendered generically (looked like a summon).
 *
 * The fix is layered:
 *   1. call site fixed to pass positional args;
 *   2. `addCompanion` defensively normalizes a malformed object `type`;
 *   3. `_migrateCompanions()` repairs old saves on load.
 *
 * These tests lock all three layers AND add a SOURCE-LEVEL structural guard on
 * the real picker call site (the page module is too heavy to import, and a
 * mocked picker is exactly why the regression escaped the existing tests).
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const T = () => CharacterSheetState.COMPANION_TYPES;

describe("Companion type/origin contract — addCompanion normalization", () => {
	it("stores a valid string type as-is", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({name: "Wolf", type: T().WILD_SHAPE, origin: "Wild Shape"});
		const c = state.getCompanion(id);
		expect(c.type).toBe("wild_shape");
		expect(c.origin).toBe("Wild Shape");
	});

	it("unpacks a malformed object `type` (the #13 bug shape) into the string type + recovers origin", () => {
		const state = new CharacterSheetState();
		// Exactly what the buggy call site produced: an object passed as `type`.
		const id = state.addCompanion({name: "Bear", type: {type: "wild_shape", origin: "Wild Shape"}});
		const c = state.getCompanion(id);
		expect(typeof c.type).toBe("string");
		expect(c.type).toBe("wild_shape");
		expect(c.origin).toBe("Wild Shape");
	});

	it("defaults an unknown/garbage type to CUSTOM", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({name: "Thing", type: "not_a_real_type"});
		expect(state.getCompanion(id).type).toBe("custom");
	});

	it("defaults a missing type to CUSTOM", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({name: "Thing"});
		expect(state.getCompanion(id).type).toBe("custom");
	});

	it("a normalized Wild Shape companion is found by getCompanionsByType", () => {
		const state = new CharacterSheetState();
		state.addCompanion({name: "Bear", type: {type: "wild_shape", origin: "Wild Shape"}});
		expect(state.getCompanionsByType(T().WILD_SHAPE).length).toBe(1);
	});
});

describe("Companion type/origin contract — addCompanionFromBestiary positional args", () => {
	const wolfData = {
		name: "Dire Wolf",
		source: "MM",
		type: "beast",
		ac: [{ac: 14}],
		hp: {average: 37, formula: "5d10 + 10"},
		speed: {walk: 50},
		str: 17,
		dex: 15,
		con: 15,
		int: 3,
		wis: 12,
		cha: 7,
	};

	it("creates a string-typed companion found by getCompanionsByType (WILD_SHAPE)", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanionFromBestiary(wolfData, T().WILD_SHAPE, "Wild Shape");
		const c = state.getCompanion(id);
		expect(c.type).toBe("wild_shape");
		expect(c.origin).toBe("Wild Shape");
		expect(state.getCompanionsByType(T().WILD_SHAPE).map(x => x.id)).toContain(id);
	});

	it("creates a FAMILIAR distinctly from a WILD_SHAPE form (no type bleed)", () => {
		const state = new CharacterSheetState();
		state.addCompanionFromBestiary(wolfData, T().WILD_SHAPE, "Wild Shape");
		state.addCompanionFromBestiary({name: "Owl", source: "MM", type: "beast", ac: [{ac: 11}], hp: {average: 1, formula: "1d4-1"}, speed: {walk: 5, fly: 60}, str: 3, dex: 13, con: 8, int: 2, wis: 12, cha: 7}, T().FAMILIAR, "Wild Companion");

		expect(state.getCompanionsByType(T().WILD_SHAPE).length).toBe(1);
		expect(state.getCompanionsByType(T().FAMILIAR).length).toBe(1);
	});
});

describe("Companion type/origin contract — _migrateCompanions repairs old saves", () => {
	it("repairs a save whose companion.type was stored as an object, on load", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({name: "Bear", type: T().WILD_SHAPE, origin: "Wild Shape"});
		const json = state.toJson();

		// Simulate a legacy save written before the fix: corrupt the persisted type.
		json.companions = json.companions || state._data.companions;
		const target = (json.companions || []).find(c => c.id === id) || json.companions[0];
		target.type = {type: "wild_shape", origin: "Wild Shape"};
		delete target.origin;

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		const c = reloaded.getCompanion(id) || reloaded.getCompanions()[0];
		expect(typeof c.type).toBe("string");
		expect(c.type).toBe("wild_shape");
		expect(c.origin).toBe("Wild Shape");
		expect(reloaded.getCompanionsByType(T().WILD_SHAPE).length).toBe(1);
	});

	it("is idempotent — a well-formed save is left untouched", () => {
		const state = new CharacterSheetState();
		state.addCompanion({name: "Bear", type: T().WILD_SHAPE, origin: "Wild Shape"});
		const json = state.toJson();

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		// Loading again (round-trips through _migrateCompanions) must not change types.
		const reloaded2 = new CharacterSheetState();
		reloaded2.loadFromJson(reloaded.toJson());

		expect(reloaded2.getCompanionsByType(T().WILD_SHAPE).length).toBe(1);
		expect(reloaded2.getCompanions()[0].type).toBe("wild_shape");
	});
});

describe("Bug #13 — structural guard on the real beast picker call site", () => {
	const pageSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

	it("_pShowBeastPicker calls addCompanionFromBestiary with POSITIONAL type/origin (not an object)", () => {
		// Isolate the _pShowBeastPicker method DEFINITION (not its call sites).
		const idx = pageSrc.indexOf("async _pShowBeastPicker");
		expect(idx).toBeGreaterThan(-1);
		const region = pageSrc.slice(idx, idx + 4000);

		// It must call addCompanionFromBestiary...
		expect(region).toMatch(/addCompanionFromBestiary(?:\?\.)?\s*\(/);
		// ...and must NOT pass an object literal as the 2nd argument (the #13 bug),
		// e.g. addCompanionFromBestiary(creature, {type, ...}). The fixed call passes
		// the positional `type` (and `origin`) variables.
		expect(region).not.toMatch(/addCompanionFromBestiary(?:\?\.)?\s*\([^,]+,\s*\{/);
	});
});
