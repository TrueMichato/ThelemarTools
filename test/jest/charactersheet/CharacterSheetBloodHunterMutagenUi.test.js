/**
 * CS-BUG-124 — Order of the Mutant's mutagens were unreachable from the UI.
 *
 * The state layer was complete and had 81 green tests, but every one of them
 * entered BELOW the missing layer by calling `consumeMutagen()` directly. No
 * production code ever called it: `MTGN` appeared nowhere in `js/charactersheet/`,
 * so no feature row was activatable and no controller dispatched to it. A player
 * could not drink a mutagen at all.
 *
 * These tests deliberately enter where the PLAYER enters:
 *   1. the feature row the sheet renders and its `detectActivatableFeature()`
 *      descriptor — the row a player clicks;
 *   2. the controller dispatch and handlers in charactersheet.js — asserted at
 *      source level, per the repo idiom (the 6.5K-line CharacterSheetPage cannot
 *      be imported under jsdom because of its top-level `window.addEventListener`).
 *
 * The source-level half is the exact test whose absence let this ship: the gap
 * WAS the missing dispatch line.
 */

import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controllerSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

const bodyOf = (name) => {
	const m = controllerSrc.match(new RegExp(`async ${name}\\s*\\([\\s\\S]*?\\n\\t\\}`));
	expect(m).not.toBeNull();
	return m[0];
};

function makeMutant (level = 3) {
	const state = new CharacterSheetState();
	state.addClass({name: "Blood Hunter", source: "BH2022", level});
	state.setSubclass("Blood Hunter", {name: "Order of the Mutant", shortName: "Mutant", source: "BH2022"});
	state.setAbilityBase("int", 16);
	state.setMaxHp(80);
	state.setCurrentHp(80);
	return state;
}

// ---------------------------------------------------------------------------
// 1. Reachability — the row a player actually clicks
// ---------------------------------------------------------------------------
describe("CS-BUG-124: a known mutagen formula is reachable from the features list", () => {
	it("grants one activatable feature row per known formula, tagged MTGN", () => {
		const state = makeMutant(3);
		expect(state.getFeatures().filter(f => f.id?.startsWith("bh2022-mutagen-"))).toEqual([]);

		state.learnMutagenFormula("embers");
		const rows = state.getFeatures().filter(f => f.id?.startsWith("bh2022-mutagen-"));
		expect(rows).toHaveLength(1);
		expect(rows[0].optionalFeatureTypes).toContain("MTGN");
		expect(rows[0].mutagenKey).toBe("embers");
		// The row must carry the benefit AND the side effect, or the player is
		// asked to drink something whose drawback is invisible.
		expect(rows[0].description).toMatch(/resistance to fire/i);
		expect(rows[0].description).toMatch(/Side effect/i);
	});

	it("the row is recognised as activatable, which is what makes it clickable", () => {
		const state = makeMutant(3);
		state.learnMutagenFormula("embers");
		const row = state.getFeatures().find(f => f.id === "bh2022-mutagen-embers");

		const detected = CharacterSheetState.detectActivatableFeature(row);
		expect(detected).not.toBeNull();
		expect(detected.stateTypeId).toBe("mutagen");
		expect(detected.activationAction).toBe("bonus");
		expect(detected.resourceName).toBe("Mutagen");
		expect(detected.resourceCost).toBe(1);
	});

	it("forgetting a formula removes its row and ends it if it was active", () => {
		const state = makeMutant(3);
		state.learnMutagenFormula("embers");
		state.consumeMutagen("embers");
		expect(state.getActiveMutagens()).toContain("embers");

		state.setKnownMutagenFormulas(["gelid"]);
		expect(state.getFeatures().some(f => f.id === "bh2022-mutagen-embers")).toBe(false);
		expect(state.getFeatures().some(f => f.id === "bh2022-mutagen-gelid")).toBe(true);
		expect(state.getActiveMutagens()).not.toContain("embers");
		expect(state.getResistances()).not.toContain("fire");
	});
});

// ---------------------------------------------------------------------------
// 2. The limit that was computed but never enforced
// ---------------------------------------------------------------------------
describe("CS-BUG-124: mutagenFormulasKnown is enforced, not merely computed", () => {
	it("caps known formulas at the table value and refuses the one past it", () => {
		const state = makeMutant(3);
		expect(state.getFeatureCalculations().mutagenFormulasKnown).toBe(4);

		for (const key of ["embers", "gelid", "shielded", "impermeable"]) {
			expect(state.learnMutagenFormula(key)).toBe(true);
		}
		expect(state.getKnownMutagenFormulas()).toHaveLength(4);
		// The fifth must be refused — this is the assertion that would have failed
		// before the fix, because nothing read mutagenFormulasKnown.
		expect(state.learnMutagenFormula("unbreakable")).toBe(false);
		expect(state.getKnownMutagenFormulas()).toHaveLength(4);
	});

	it("only known formulas can be drunk, however level-eligible they are", () => {
		const state = makeMutant(3);
		expect(state.getLearnableMutagens()).toContain("gelid");
		// Level-eligible but not known -> refused.
		expect(state.consumeMutagen("gelid")).toBe(false);
		state.learnMutagenFormula("gelid");
		expect(state.consumeMutagen("gelid")).toBe(true);
	});

	it("caps at the table value even when stored data exceeds it (respec or level-down)", () => {
		const state = makeMutant(7);
		expect(state.getFeatureCalculations().mutagenFormulasKnown).toBe(5);
		state.setKnownMutagenFormulas(["embers", "gelid", "shielded", "impermeable", "unbreakable"]);
		expect(state.getKnownMutagenFormulas()).toHaveLength(5);

		// A level-3 Mutant whose saved data still carries five formulas — from a respec,
		// a level-down, or an older save — must not be left holding more than the cap.
		const lowered = makeMutant(3);
		lowered._data.knownMutagenFormulas = ["embers", "gelid", "shielded", "impermeable", "unbreakable"];
		expect(lowered.getFeatureCalculations().mutagenFormulasKnown).toBe(4);
		expect(lowered.getKnownMutagenFormulas()).toHaveLength(4);
		// And the surplus formula is genuinely unusable, not merely hidden from the list.
		expect(lowered.consumeMutagen("unbreakable")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 3. Consuming spends the per-rest pool
// ---------------------------------------------------------------------------
describe("CS-BUG-124: consuming a mutagen spends a concoction", () => {
	it("spends one use and refuses once the pool is empty", () => {
		const state = makeMutant(3);
		state.addFeature({name: "Mutagencraft", level: 3, className: "Blood Hunter", source: "BH2022", description: "Mutagencraft"});
		state.ensureBloodHunterResources();
		const pool = state.getResource("Mutagen");
		expect(pool.max).toBe(1);
		expect(pool.current).toBe(1);

		state.learnMutagenFormula("embers");
		state.learnMutagenFormula("gelid");
		expect(state.consumeMutagen("embers")).toBe(true);
		expect(state.getResource("Mutagen").current).toBe(0);
		// Second drink has nothing left to drink.
		expect(state.consumeMutagen("gelid")).toBe(false);
		expect(state.getActiveMutagens()).toEqual(["embers"]);
	});

	it("refuses to re-consume a mutagen already in the system", () => {
		const state = makeMutant(11);
		state.addFeature({name: "Mutagencraft", level: 3, className: "Blood Hunter", source: "BH2022", description: "Mutagencraft"});
		state.ensureBloodHunterResources();
		state.learnMutagenFormula("embers");
		expect(state.consumeMutagen("embers")).toBe(true);
		const remaining = state.getResource("Mutagen").current;
		expect(state.consumeMutagen("embers")).toBe(false);
		// A refused attempt must not silently burn a concoction.
		expect(state.getResource("Mutagen").current).toBe(remaining);
	});
});

// ---------------------------------------------------------------------------
// 4. The UI path — the layer that did not exist
// ---------------------------------------------------------------------------
describe("CS-BUG-124: the controller reaches the mutagen state", () => {
	it("dispatches an MTGN feature to the consume handler", () => {
		// This single line IS the bug fix: without it no mutagen is reachable.
		expect(controllerSrc).toMatch(/optionalFeatureTypes\?\.includes\("MTGN"\)\)\s*return this\._pConsumeMutagen\(feature\)/);
	});

	it("routes the formula manager so a player can choose what they know", () => {
		expect(controllerSrc).toMatch(/return this\._pManageMutagenFormulas\(feature\)/);
	});

	it("the consume handler gates on the pool, calls consumeMutagen, then persists and re-renders", () => {
		const body = bodyOf("_pConsumeMutagen");
		expect(body).toContain(`getResource?.("Mutagen")`);
		expect(body).toContain("this._state.consumeMutagen(key)");
		expect(body).toContain("this._state.endMutagen(key)");
		expect(body).toContain("_saveCurrentCharacter");
		expect(body).toContain("_renderActiveStates");
	});

	it("the consume prompt shows the side effect, not just the benefit", () => {
		const body = bodyOf("_pConsumeMutagen");
		expect(body).toContain("def?.benefit");
		expect(body).toContain("def?.drawback");
		// Uses the house prompt vocabulary rather than a bespoke modal.
		expect(body).toContain("InputUiUtil.pGetUserBoolean");
		expect(body).not.toContain("CharacterSheetModal.pGetShow");
	});

	it("the formula manager uses the house multi-select and writes the known set", () => {
		const body = bodyOf("_pManageMutagenFormulas");
		expect(body).toContain("InputUiUtil.pGetUserMultipleChoice");
		expect(body).toContain("setKnownMutagenFormulas");
		expect(body).toContain("flushMutagens");
		// `defaults` takes INDICES; `defaultState` is not an option this API has.
		expect(body).toContain("defaults:");
		expect(body).not.toContain("defaultState");
	});
});

// ---------------------------------------------------------------------------
// 5. CS-BUG-125 / CS-BUG-150 — the brand riders that nothing read
// ---------------------------------------------------------------------------
function makeOrder (subclass, level) {
	const state = new CharacterSheetState();
	state.addClass({name: "Blood Hunter", source: "BH2022", level});
	state.setSubclass("Blood Hunter", {name: subclass, shortName: subclass.replace(/^Order of the /, ""), source: "BH2022"});
	state.setAbilityBase("int", 16);
	state.setMaxHp(90);
	state.setCurrentHp(90);
	return state;
}

const brandSources = (state) => {
	state.activateState("brandedTarget");
	const st = state._data.activeStates.find(s => s.stateTypeId === "brandedTarget");
	return (st?.customEffects || []).map(e => e.source);
};

describe("CS-BUG-125: Brand of Sundering's extra hemocraft die actually rides the rite", () => {
	it("doubles the rite damage dice at 11th level, and only for a Ghostslayer", () => {
		// The extra-die clause is NOT limited to a branded creature: the next sentence of
		// the same feature says "while branded", so its omission here is deliberate.
		expect(makeOrder("Order of the Ghostslayer", 11).getFeatureCalculations().crimsonRiteDamage).toBe("2d8");
		// Below 11 it is a single die, and another order at the same level is unaffected.
		expect(makeOrder("Order of the Ghostslayer", 7).getFeatureCalculations().crimsonRiteDamage).toBe("1d6");
		expect(makeOrder("Order of the Lycan", 11).getFeatureCalculations().crimsonRiteDamage).toBe("1d8");
	});

	it("scales with the hemocraft die rather than being pinned to d8", () => {
		expect(makeOrder("Order of the Ghostslayer", 17).getFeatureCalculations().crimsonRiteDamage).toBe("2d10");
	});

	it("re-points a rite lit before 11th level at the new dice", () => {
		// A rite stores its damage on the active state at activation time, so a rite lit
		// at 10th level would keep rolling one die forever without a refresh.
		const state = makeOrder("Order of the Ghostslayer", 10);
		state.addFeature({name: "Rite of the Dawn", level: 3, className: "Blood Hunter", source: "BH2022", description: "Rite of the Dawn"});
		expect(state.activateCrimsonRite("rite of the dawn", {roll: 1, weaponId: "w1", weaponName: "Longsword"})).toBe(true);
		expect(state.getExtraDamageFromStates().find(e => e.isCrimsonRite).dice).toBe("1d6");

		state.addClass({name: "Blood Hunter", source: "BH2022", level: 11});
		state.ensureBloodHunterResources();
		expect(state.getExtraDamageFromStates().find(e => e.isCrimsonRite).dice).toBe("2d8");
	});
});

describe("CS-BUG-150: each order's brand states what it actually does", () => {
	it("surfaces only the riders the character has", () => {
		expect(brandSources(makeOrder("Order of the Ghostslayer", 11)))
			.toEqual(["Brand of Castigation", "Brand of Sundering"]);
		expect(brandSources(makeOrder("Order of the Mutant", 11)))
			.toEqual(["Brand of Castigation", "Brand of Axiom"]);
		expect(brandSources(makeOrder("Order of the Profane Soul", 11)))
			.toEqual(["Brand of Castigation", "Brand of the Sapping Scar"]);
		// Lycan at 15 has Tethering (13) and Voracious (15) on top of Castigation.
		expect(brandSources(makeOrder("Order of the Lycan", 15)))
			.toEqual(["Brand of Castigation", "Brand of Tethering", "Brand of the Voracious"]);
	});

	it("a 6th-level Blood Hunter has only Castigation, with its real psychic damage", () => {
		const state = makeOrder("Order of the Mutant", 6);
		state.activateState("brandedTarget");
		const st = state._data.activeStates.find(s => s.stateTypeId === "brandedTarget");
		expect(st.customEffects).toHaveLength(1);
		// Hemocraft modifier at INT 16 = +3.
		expect(st.customEffects[0].label).toContain("3 psychic damage");
	});

	it("resolves Brand of Axiom's save DC into the text a player reads", () => {
		const state = makeOrder("Order of the Mutant", 11);
		const dc = state.getFeatureCalculations().hemocraftSaveDc;
		state.activateState("brandedTarget");
		const st = state._data.activeStates.find(s => s.stateTypeId === "brandedTarget");
		const axiom = st.customEffects.find(e => e.source === "Brand of Axiom");
		expect(axiom.label).toContain(`DC ${dc} Wisdom save`);
	});

	it("resolves Brand of Tethering's damage and DC rather than describing them vaguely", () => {
		const state = makeOrder("Order of the Lycan", 13);
		state.activateState("brandedTarget");
		const st = state._data.activeStates.find(s => s.stateTypeId === "brandedTarget");
		const tether = st.customEffects.find(e => e.source === "Brand of Tethering");
		expect(tether.label).toContain("4d6");
		expect(tether.label).toMatch(/DC \d+ Wisdom save/);
		// RAW: a failed save cancels the attempt; it is not "half damage".
		expect(tether.label).toContain("the attempt fails");
		expect(tether.label).not.toMatch(/half/i);
	});
});
