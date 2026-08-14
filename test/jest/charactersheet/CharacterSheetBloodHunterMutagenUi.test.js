/**
 * CS-BUG-124 — Order of the Mutant's mutagens were unreachable from the UI.
 *
 * The state layer was complete and had 81 green tests, but every one of them
 * entered BELOW the missing layer by calling `consumeMutagen()` directly. No
 * production code ever called it: `MTGN` appeared nowhere in `js/charactersheet/`,
 * so no feature row was activatable and no controller dispatched to it. A player
 * could not drink a mutagen at all.
 *
 * Root cause worth remembering: Blood Curses and Crimson Rites reach the same
 * picker through the GENERIC `optionalfeatureProgression` machinery with no
 * class-specific code at all. Two of the three pools therefore never needed a
 * dispatch line, which is precisely why the missing third was invisible.
 *
 * These tests enter at the feature row the sheet renders — the row a player
 * clicks. The controller dispatch above it is covered by the Playwright spec
 * `test/e2e/specs/tgtt-mutant-blood-hunter.spec.ts`, which drives the real click.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

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
// The controller dispatch is covered end-to-end by the Playwright spec
// `test/e2e/specs/tgtt-mutant-blood-hunter.spec.ts`, whose `mutagenUiFlow` probe
// clicks the real feature row, answers the real prompt, and asserts the benefit
// and the drawback both land. The four source-text regex assertions that used to
// live here were deleted with it: they matched strings in charactersheet.js, so
// they went red on reformatting and green on broken wiring — false in both
// directions about the one thing they were named after.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. CS-BUG-151 / 152 / 153 — three defects found by driving the real UI path
// ---------------------------------------------------------------------------
describe("CS-BUG-151: the generic End control clears the active-mutagen list", () => {
	it("leaves no residue behind, so the same mutagen can be drunk again", () => {
		const state = makeMutant(3);
		state.setKnownMutagenFormulas(["embers"]);
		expect(state.consumeMutagen("embers")).toBeTruthy();
		expect(state.getActiveMutagens()).toContain("embers");

		// The Overview Active-States panel ends states generically; it does not
		// route through endMutagen(). Before the fix this flipped `active` but left
		// `_data.activeMutagens` populated, so getActiveMutagens() over-reported and
		// consumeMutagen() — which refuses a key already listed — blocked the re-drink.
		state.deactivateState("mutagen");

		expect(state.getActiveMutagens()).toEqual([]);
		expect(state.consumeMutagen("embers")).toBeTruthy();
	});
});

describe("CS-BUG-152: the End control still works once the pool is empty", () => {
	it("exempts an MTGN row from the resource pre-flight, because it pays its own cost", () => {
		const state = makeMutant(3);
		state.setKnownMutagenFormulas(["embers"]);
		const row = state.getFeatures().find(f => f.id === "bh2022-mutagen-embers");
		expect(row.optionalFeatureTypes).toContain("MTGN");

		// The controller refuses to dispatch when `resource.current < cost` — but
		// drinking your last concoction empties the very pool the End path was gated
		// on, so the row went silently dead. `featureOwnsItsCost` is the existing
		// escape hatch for handlers that resolve their own cost.
		expect(CharacterSheetState.featureOwnsItsCost(row)).toBe(true);
		// Structural, not name-based: rows are generated per known formula.
		expect(CharacterSheetState.featureOwnsItsCost({name: "Blood Maledict"})).toBe(false);
	});
});

describe("CS-BUG-153: every auto-granted blood curse carries its real mechanics", () => {
	it.each([
		["Order of the Lycan", 18, /Howl/i],
		["Order of the Mutant", 15, /Corrosion/i],
		["Order of the Ghostslayer", 15, /Exorcist/i],
		["Order of the Profane Soul", 18, /Souleater/i],
	])("%s grants a readable, activatable curse", (subclass, level, nameRe) => {
		const state = makeOrder(subclass, level);
		// Auto-granted rows are pushed by ensureBloodHunterResources(); getFeatures()
		// alone does not trigger it, so a bare read misses them.
		state.ensureBloodHunterResources();
		const curse = state.getFeatures().find(f => nameRe.test(f.name || "") && /blood curse/i.test(f.name || ""));
		expect(curse).toBeTruthy();

		// The shipped text was meta-commentary ABOUT the grant — "You gain the Blood
		// Curse of X... doesn't count against your number known" — rather than the
		// curse itself, so the player could not read what it does. The grant note is
		// legitimate as an appendix; it is not legitimate as the whole description.
		const desc = curse.description || "";
		expect(desc).not.toMatch(/^You gain the Blood Curse/i);
		// Both discriminate: the old text had neither an Amplify rider nor anything
		// but the grant note. Not every curse has a save (the Souleater is a self-buff
		// reaction), so asserting one would fail on correct data.
		expect(desc).toMatch(/Amplify/i);

		expect(CharacterSheetState.detectActivatableFeature(curse)).not.toBeNull();
	});
});

describe("Blood Curses known is exact at each threshold", () => {
	// Lives here rather than in the E2E matrix: matrix rows are evaluated at the
	// checkpoint levels [3, 5, 11, 17, 20], not at their declared level, so a
	// level-varying number pinned there is asserted at the wrong levels too.
	it.each([[3, 1], [5, 1], [6, 2], [10, 3], [14, 4], [15, 4], [18, 5], [20, 5]])(
		"L%i → %i known",
		(level, expected) => {
			expect(makeOrder("Order of the Mutant", level).getFeatureCalculations().bloodCursesKnown).toBe(expected);
		},
	);
});
