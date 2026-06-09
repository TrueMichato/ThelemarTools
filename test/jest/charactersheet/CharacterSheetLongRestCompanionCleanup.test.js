/**
 * Long-rest Wild Shape / Wild-Companion cleanup (round-5 Bug #6) — MECHANICS.
 *
 * 2024 Wild Companion: a druid expends a Wild Shape use to summon a familiar.
 * Wild Shape uses recharge on a rest, so on a long rest:
 *  - any assumed Wild Shape beast form reverts, and
 *  - a Wild-Companion-summoned familiar (which cost a Wild Shape use) disappears
 *    — re-summoning after the rest costs a fresh use.
 * Regular Find Familiar / Pact of the Chain familiars (and every other companion
 * type) must be LEFT untouched. The lingering `wildShape` active state is also
 * cleared so derived stats reset.
 *
 * The spend-on-summon half of #6 is covered in CharacterSheetCombatDruidResources
 * ("Summon (Wild Companion) spends one use…" / "Transform does NOT spend on
 * cancel"); this file covers the long-rest teardown half.
 *
 * The Rest module's constructor wires DOM listeners (node env has no document),
 * so we invoke the pure cleanup method on a prototype instance with an injected
 * state — exactly the collaborator the method uses.
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirnameLocal, "../../..");

let CharacterSheetState;
let CharacterSheetRest;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

function makeDruid () {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level: 5,
		subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
	});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current: 2, max: 2, recharge: "short"}});
	return state;
}

/** Build a Rest instance WITHOUT running the DOM-wiring constructor. */
function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	rest._state = state;
	rest._page = {getState: () => state};
	return rest;
}

describe("#6 — _removeWildShapeCompanionsOnLongRest", () => {
	const T = () => CharacterSheetState.COMPANION_TYPES;

	it("removes the Wild Shape form and the Wild-Companion familiar, keeps a regular familiar", () => {
		const state = makeDruid();
		state.addCompanion({name: "Velociraptor", type: T().WILD_SHAPE, origin: "Wild Shape"});
		state.addCompanion({name: "Sprite", type: T().FAMILIAR, origin: "Wild Companion"});
		state.addCompanion({name: "Imp", type: T().FAMILIAR, origin: "Find Familiar"});

		const removed = makeRest(state)._removeWildShapeCompanionsOnLongRest();

		expect(removed).toBe(2);
		// Wild Shape form gone.
		expect(state.getCompanionsByType(T().WILD_SHAPE)).toHaveLength(0);
		// Only the regular familiar remains.
		const familiars = state.getCompanionsByType(T().FAMILIAR);
		expect(familiars).toHaveLength(1);
		expect(familiars[0].name).toBe("Imp");
		expect(familiars[0].origin).toBe("Find Familiar");
	});

	it("matches the Wild-Companion familiar case-insensitively but not a coincidental prefix", () => {
		const state = makeDruid();
		state.addCompanion({name: "Pixie", type: T().FAMILIAR, origin: "wild companion (fey)"}); // removed
		state.addCompanion({name: "Wildcat", type: T().FAMILIAR, origin: "Wildfire Spirit"}); // kept (not a word-boundary match)

		const removed = makeRest(state)._removeWildShapeCompanionsOnLongRest();

		expect(removed).toBe(1);
		const familiars = state.getCompanionsByType(T().FAMILIAR);
		expect(familiars).toHaveLength(1);
		expect(familiars[0].name).toBe("Wildcat");
	});

	it("leaves unrelated companion types untouched", () => {
		const state = makeDruid();
		state.addCompanion({name: "Steel Defender", type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER || "steel_defender", origin: "Steel Defender"});
		state.addCompanion({name: "Bear", type: T().WILD_SHAPE, origin: "Wild Shape"});

		const removed = makeRest(state)._removeWildShapeCompanionsOnLongRest();

		expect(removed).toBe(1); // only the Wild Shape form
		expect(state.getCompanions().some(c => c.name === "Steel Defender")).toBe(true);
	});

	it("deactivates a lingering wildShape active state", () => {
		const state = makeDruid();
		state.addCompanion({name: "Owl", type: T().WILD_SHAPE, origin: "Wild Shape"});
		state.activateState("wildShape");
		expect(state.isStateTypeActive("wildShape")).toBe(true);

		makeRest(state)._removeWildShapeCompanionsOnLongRest();

		expect(state.isStateTypeActive("wildShape")).toBe(false);
	});

	it("is a no-op (returns 0) when there is nothing to clean up", () => {
		const state = makeDruid();
		state.addCompanion({name: "Imp", type: T().FAMILIAR, origin: "Find Familiar"});
		const removed = makeRest(state)._removeWildShapeCompanionsOnLongRest();
		expect(removed).toBe(0);
		expect(state.getCompanionsByType(T().FAMILIAR)).toHaveLength(1);
	});
});

describe("#6 — the Finish-Long-Rest handler invokes the cleanup", () => {
	const restSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-rest.js"), "utf8");

	it("the long-rest dialog calls _removeWildShapeCompanionsOnLongRest()", () => {
		// The helper is DEFINED (no `this.` prefix, with a body)...
		expect(restSrc).toMatch(/\n\t_removeWildShapeCompanionsOnLongRest\s*\(\)\s*\{/);
		// ...AND actually INVOKED on `this` from the long-rest handler (a `this.`
		// call is distinct from the definition, so this can't pass on the def alone).
		expect(restSrc).toMatch(/this\._removeWildShapeCompanionsOnLongRest\s*\(\)/);
		// The invocation precedes the long-rest success toast.
		const callIdx = restSrc.indexOf("this._removeWildShapeCompanionsOnLongRest()");
		const toastIdx = restSrc.indexOf("Long rest complete");
		expect(callIdx).toBeGreaterThan(-1);
		expect(toastIdx).toBeGreaterThan(callIdx);
	});
});
