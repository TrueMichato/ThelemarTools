/**
 * BUG 5 — Spells-tab view toggle (Current / Prepared / Known)
 * Tests the DOM-free logic: view-mode storage/round-trip, mode filtering, and the
 * prepare-toggle eligibility rules. Instantiated off the prototype (via Object.create)
 * because the Jest env is `node` (no `document`), so the constructor/_init DOM listeners
 * are intentionally bypassed.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

/** Build a spells module bound to a state, without running the DOM-bound constructor. */
function makeSpells (state) {
	const mod = Object.create(CharacterSheetSpells.prototype);
	mod._state = state;
	return mod;
}

describe("BUG 5 — Spell view mode", () => {
	describe("mode storage / round-trip", () => {
		let mod;
		beforeEach(() => {
			mod = makeSpells(new CharacterSheetState());
			try { if (typeof localStorage !== "undefined") localStorage.clear(); } catch (e) { /* ignore */ }
		});

		it("defaults to 'current' when nothing is stored", () => {
			expect(mod._getSpellViewMode()).toBe("current");
		});

		it("round-trips a valid mode through _setSpellViewMode/_getSpellViewMode", () => {
			// Stub the re-render so _setSpellViewMode doesn't require the DOM.
			mod._renderSpellList = jest.fn();
			mod._setSpellViewMode("known");
			expect(mod._spellViewMode).toBe("known");
			expect(mod._getSpellViewMode()).toBe("known");
			expect(mod._renderSpellList).toHaveBeenCalled();
		});

		it("ignores invalid modes", () => {
			mod._renderSpellList = jest.fn();
			mod._setSpellViewMode("current");
			mod._setSpellViewMode("bogus");
			expect(mod._getSpellViewMode()).toBe("current");
		});

		it("exposes exactly the three supported modes", () => {
			expect(CharacterSheetSpells.SPELL_VIEW_MODES).toEqual(["current", "prepared", "known"]);
		});
	});

	describe("_filterSpellsForViewMode", () => {
		let mod;
		const spells = [
			{name: "Fire Bolt", level: 0, prepared: false},
			{name: "Mage Armor", level: 1, prepared: true},
			{name: "Shield", level: 1, prepared: false},
			{name: "Bless", level: 1, alwaysPrepared: true, prepared: false},
			{name: "Fireball", level: 3, prepared: false},
		];
		beforeEach(() => { mod = makeSpells(new CharacterSheetState()); });

		it("returns all spells for 'current'", () => {
			expect(mod._filterSpellsForViewMode(spells, "current")).toHaveLength(5);
		});

		it("returns all spells for 'known'", () => {
			expect(mod._filterSpellsForViewMode(spells, "known")).toHaveLength(5);
		});

		it("returns only cantrips + prepared/always-prepared for 'prepared'", () => {
			const out = mod._filterSpellsForViewMode(spells, "prepared").map(s => s.name);
			expect(out).toContain("Fire Bolt"); // cantrip always shown
			expect(out).toContain("Mage Armor"); // prepared
			expect(out).toContain("Bless"); // always-prepared
			expect(out).not.toContain("Shield"); // unprepared leveled
			expect(out).not.toContain("Fireball"); // unprepared leveled
		});

		it("is defensive against non-array input", () => {
			expect(mod._filterSpellsForViewMode(null, "prepared")).toEqual([]);
		});
	});

	describe("prepare-toggle eligibility (edition/class rules)", () => {
		it("shows the prepare toggle for a prepared caster's (Wizard) leveled spell", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			const mod = makeSpells(state);
			const spell = {name: "Fireball", level: 3, source: "PHB", sourceClass: "Wizard"};
			expect(mod._shouldShowPrepareToggle(spell)).toBe(true);
		});

		it("hides the prepare toggle for a known caster's (Bard) leveled spell", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Bard", source: "PHB", level: 5});
			const mod = makeSpells(state);
			const spell = {name: "Charm Person", level: 1, source: "PHB", sourceClass: "Bard"};
			expect(mod._shouldShowPrepareToggle(spell)).toBe(false);
		});

		it("never shows the prepare toggle for cantrips or always-prepared spells", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			const mod = makeSpells(state);
			expect(mod._shouldShowPrepareToggle({name: "Fire Bolt", level: 0, sourceClass: "Wizard"})).toBe(false);
			expect(mod._shouldShowPrepareToggle({name: "Bless", level: 1, alwaysPrepared: true, sourceClass: "Wizard"})).toBe(false);
		});
	});
});
