/**
 * Bug 4 regression — the Overview "Favourite Spells" section (formerly
 * "Quick Spells") should render the user's spell-typed favourites, not
 * the arbitrary first-3-cantrips + first-4-prepared slice.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Favourite Spells (Bug 4)", () => {
	function makeStateWithSpells (spells) {
		const state = new CharacterSheetState();
		state._data.spellcasting = state._data.spellcasting || {};
		state._data.spellcasting.cantripsKnown = spells.filter(s => s.level === 0)
			.map((s, i) => ({id: `cantrip_${i}`, ...s}));
		state._data.spellcasting.spellsKnown = spells.filter(s => s.level > 0)
			.map((s, i) => ({id: `spell_${i}`, ...s}));
		state._data.favorites = [];
		return state;
	}

	test("getFavorites().filter(spell) returns only spell-typed favourites", () => {
		const state = makeStateWithSpells([
			{name: "Guidance", level: 0, source: "PHB"},
			{name: "Bless", level: 1, source: "PHB", prepared: true},
			{name: "Fireball", level: 3, source: "PHB", prepared: true},
		]);
		state._data.favorites = [
			{id: "spell:cantrip_0", type: "spell", name: "Guidance", icon: "✨"},
			{id: "spell:spell_1", type: "spell", name: "Fireball", icon: "✨"},
			{id: "feature:rage", type: "feature", name: "Rage", icon: "📜"},
		];

		const favSpellRecords = state.getFavorites().filter(f => f.type === "spell");
		expect(favSpellRecords).toHaveLength(2);
		expect(favSpellRecords.map(f => f.name)).toEqual(["Guidance", "Fireball"]);
	});

	test("_resolveFavorite resolves a spell favourite to the underlying spell entity", () => {
		const state = makeStateWithSpells([
			{name: "Guidance", level: 0, source: "PHB"},
			{name: "Bless", level: 1, source: "PHB", prepared: true},
		]);
		state._data.favorites = [{id: "spell:spell_0", type: "spell", name: "Bless", icon: "✨"}];

		const resolved = state._resolveFavorite(state._data.favorites[0]);
		expect(resolved.found).toBe(true);
		expect(resolved.entity.name).toBe("Bless");
		expect(resolved.entity.level).toBe(1);
		expect(resolved.detail).toBe("Level 1");
	});

	test("_resolveFavorite returns {found:false} for an orphaned spell favourite (spell removed)", () => {
		const state = makeStateWithSpells([
			{name: "Guidance", level: 0, source: "PHB"},
		]);
		state._data.favorites = [{id: "spell:spell_99", type: "spell", name: "Removed Spell", icon: "✨"}];

		const resolved = state._resolveFavorite(state._data.favorites[0]);
		expect(resolved.found).toBe(false);
	});

	test("addFavorite respects the shared 8-favourite cap", () => {
		const state = makeStateWithSpells([
			{name: "S1", level: 0, source: "PHB"},
			{name: "S2", level: 0, source: "PHB"},
		]);
		for (let i = 0; i < 8; i++) {
			const ok = state.addFavorite({id: `spell:spell_${i}`, type: "spell", name: `S${i + 1}`, icon: "✨"});
			expect(ok).toBe(true);
		}
		// 9th must be rejected
		const ninth = state.addFavorite({id: "spell:spell_8", type: "spell", name: "S9", icon: "✨"});
		expect(ninth).toBe(false);
		expect(state.getFavorites()).toHaveLength(8);
	});
});
