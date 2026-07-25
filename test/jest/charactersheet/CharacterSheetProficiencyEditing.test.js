/**
 * Character Sheet — Proficiency Editing (Round 42, B6 + B7)
 *
 * B6: The Edit Proficiencies picker used to store friendly armor labels
 *     ("Light Armor") that hasArmorProficiency() — an exact-token check against
 *     light/medium/heavy/shields — never matched, so adding armor proficiency via
 *     the modal never cleared the non-proficiency penalty and polluted state with
 *     duplicates. The root-cause fix normalises BOTH sides of the comparison in
 *     state (`_normalizeArmorProfToken`) so labels, title-case, the class-start
 *     singular "shield", and legacy saves all resolve to the canonical token.
 *
 * These assert REAL mechanics (penalty detection + advantage state), not levels.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Wizard (proficient with NO armor) — build then override proficiencies per-test. */
function buildWizard () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("int", 16);
	return state;
}

describe("Proficiency Editing — armor token normalization (B6 root cause)", () => {
	let state;
	beforeEach(() => { state = buildWizard(); });

	describe("_normalizeArmorProfToken", () => {
		it("maps friendly labels and title-case to canonical tokens", () => {
			expect(state._normalizeArmorProfToken("Light Armor")).toBe("light");
			expect(state._normalizeArmorProfToken("Medium armor")).toBe("medium");
			expect(state._normalizeArmorProfToken("Heavy Armour")).toBe("heavy");
			expect(state._normalizeArmorProfToken("Shields")).toBe("shields");
		});

		it("collapses singular/plural shield to 'shields'", () => {
			expect(state._normalizeArmorProfToken("shield")).toBe("shields");
			expect(state._normalizeArmorProfToken("Shield")).toBe("shields");
			expect(state._normalizeArmorProfToken("shields")).toBe("shields");
		});

		it("trims whitespace and lowercases", () => {
			expect(state._normalizeArmorProfToken("  Light armor ")).toBe("light");
		});

		it("passes recognised bare tokens through", () => {
			expect(state._normalizeArmorProfToken("heavy")).toBe("heavy");
		});

		it("preserves an unrecognised homebrew armor NAME (only cleaned, not collapsed to a category)", () => {
			// A specific armor name must NOT be mistaken for a category; it is only
			// lowercased/trimmed and returned intact so it still equals itself.
			expect(state._normalizeArmorProfToken("Studded Leather Armor")).toBe("studded leather armor");
			expect(state._normalizeArmorProfToken("Dragonscale Plate")).toBe("dragonscale plate");
		});

		it("handles empty / nullish input safely", () => {
			expect(state._normalizeArmorProfToken("")).toBe("");
			expect(state._normalizeArmorProfToken(null)).toBe("");
			expect(state._normalizeArmorProfToken(undefined)).toBe("");
		});
	});

	describe("hasArmorProficiency matches regardless of stored form", () => {
		it("matches a canonical token", () => {
			state.addArmorProficiency("light");
			expect(state.hasArmorProficiency("light")).toBe(true);
		});

		it("matches a friendly-label store (legacy save repair, no migration)", () => {
			state.addArmorProficiency("Light Armor");
			expect(state.hasArmorProficiency("light")).toBe(true);
		});

		it("matches class-start singular 'shield' against a 'shields' query", () => {
			state.addArmorProficiency("shield");
			expect(state.hasArmorProficiency("shields")).toBe(true);
		});
	});
});

describe("Proficiency Editing — penalty clears/re-applies live (B6 + B7)", () => {
	describe("body armor", () => {
		let state;
		beforeEach(() => {
			state = buildWizard();
			state.setArmor({name: "Studded Leather", ac: 12, type: "light"});
		});

		it("shows the non-proficiency penalty with no armor proficiency", () => {
			expect(state.isWearingNonProficientArmor()).toBe(true);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
		});

		it("clears the penalty once light proficiency is added (canonical token)", () => {
			state.addArmorProficiency("light");
			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(false);
			expect(state.isSpellcastingBlockedByArmor()).toBe(false);
		});

		it("clears the penalty even when proficiency is stored as a friendly label", () => {
			state.addArmorProficiency("Light Armor");
			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.getAdvantageState("save:str").disadvantage).toBe(false);
		});

		it("re-applies the penalty after the proficiency is removed", () => {
			state.addArmorProficiency("light");
			expect(state.isWearingNonProficientArmor()).toBe(false);
			state.removeArmorProficiency("light");
			expect(state.isWearingNonProficientArmor()).toBe(true);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
		});
	});

	describe("shield", () => {
		let state;
		beforeEach(() => {
			state = buildWizard();
			state.setShield({ac: 2, name: "Shield"});
		});

		it("shows the shield non-proficiency penalty by default", () => {
			expect(state.isWearingNonProficientShield()).toBe(true);
		});

		it("clears the shield penalty with the 'shields' token", () => {
			state.addArmorProficiency("shields");
			expect(state.isWearingNonProficientShield()).toBe(false);
		});

		it("clears the shield penalty with the singular class-start 'shield' token", () => {
			state.addArmorProficiency("shield");
			expect(state.isWearingNonProficientShield()).toBe(false);
		});
	});
});

describe("Proficiency Editing — polluted-save dedupe removal (B6)", () => {
	it("addArmorProficiencyCanonical collapses a differently-cased duplicate (no re-pollution)", () => {
		const state = buildWizard();
		state.addArmorProficiency("Light armor"); // legacy label already stored
		// The editor add path stores the CANONICAL token and drops the stale variant.
		state.addArmorProficiencyCanonical("light");
		const armor = state.getArmorProficiencies();
		expect(armor.filter(a => state._normalizeArmorProfToken(a) === "light")).toEqual(["light"]);
	});

	it("removeArmorProficiencyVariants clears every normalized variant and re-applies the penalty", () => {
		const state = buildWizard();
		state.setArmor({name: "Studded Leather", ac: 12, type: "light"});
		// Simulate a polluted save (both canonical + friendly-label duplicate).
		state.addArmorProficiency("light");
		state.addArmorProficiency("Light armor");
		expect(state.isWearingNonProficientArmor()).toBe(false);

		// The editor removes EVERY stored variant that normalizes to the token in one call.
		const removed = state.removeArmorProficiencyVariants("light");
		expect(removed).toBe(2);

		expect(state.getArmorProficiencies().some(a => state._normalizeArmorProfToken(a) === "light")).toBe(false);
		expect(state.isWearingNonProficientArmor()).toBe(true);
		expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
	});
});
