import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// The BH2022 Order of the Profane Soul as the persistence whitelist stores it.
const PROFANE_SOUL = {
	name: "Order of the Profane Soul",
	shortName: "Profane Soul",
	source: "BH2022",
	spellcastingAbility: "int",
	cantripProgression: [0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
	spellsKnownProgression: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 11],
	subclassSpells: [{className: "Warlock", classSource: "PHB"}],
};

function getState (level, subclass = PROFANE_SOUL) {
	const state = new CharacterSheetState();
	state.addClass({name: "Blood Hunter", source: "BH2022", level});
	state.setSubclass("Blood Hunter", subclass);
	state.setAbilityBase("int", 16);
	return state;
}

describe("Subclass-declared spellcasting (CS-BUG-158 / CS-BUG-159)", () => {
	describe("a subclass that publishes its own progression is a caster", () => {
		// Before the fix these all returned `null` -> the character knew zero spells
		// and the Spells tab offered no picks at all.
		it.each([
			[3, 2, 2],
			[5, 3, 2],
			[10, 5, 3],
			[20, 11, 3],
		])("level %i knows %i spells and %i cantrips", (level, spells, cantrips) => {
			const info = getState(level).getSpellcastingInfo();
			expect(info).not.toBeNull();
			expect(info.spellsKnownMax).toBe(spells);
			expect(info.cantripsKnown).toBe(cantrips);
		});

		it("is not a caster before the subclass is gained", () => {
			expect(getState(2).getSpellcastingInfo()).toBeNull();
		});

		it("is generic — any subclass declaring a progression casts, not just Blood Hunter", () => {
			const info = getState(5, {
				name: "Wholly Invented Order",
				shortName: "Invented",
				source: "HOMEBREW",
				spellcastingAbility: "cha",
				cantripProgression: [1, 1, 1, 1, 1],
				spellsKnownProgression: [4, 4, 4, 4, 4],
			}).getSpellcastingInfo();
			expect(info?.spellsKnownMax).toBe(4);
			expect(info?.cantripsKnown).toBe(1);
		});

		it("leaves a non-casting subclass alone", () => {
			const info = getState(5, {name: "Order of the Lycan", shortName: "Lycan", source: "BH2022"}).getSpellcastingInfo();
			expect(info).toBeNull();
		});
	});

	describe("named subclasses keep their own hard-coded tables", () => {
		// The generic branch is deliberately LAST. This is the guard that it stayed
		// there: Eldritch Knight's table differs from anything declared in data.
		it("Eldritch Knight still reports its own spells-known table", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.setSubclass("Fighter", {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"});
			const info = state.getSpellcastingInfo();
			expect(info?.spellsKnownMax).toBe(3);
			expect(info?.cantripsKnown).toBe(2);
		});
	});

	describe("spell-list resolution reads `subclassSpells`", () => {
		it("resolves the Warlock list rather than falling back to the parent class", () => {
			const resolved = CharacterSheetState.getSubclassSpellListClass(PROFANE_SOUL, {name: "Blood Hunter"});
			expect(resolved).toBe("Warlock");
		});

		it("falls back to the parent class when the subclass declares nothing", () => {
			const resolved = CharacterSheetState.getSubclassSpellListClass(
				{name: "Order of the Lycan", source: "BH2022"},
				{name: "Blood Hunter"},
			);
			expect(resolved).toBe("Blood Hunter");
		});

		it("an explicit `spellcastingSpellList` still wins over `subclassSpells`", () => {
			const resolved = CharacterSheetState.getSubclassSpellListClass(
				{...PROFANE_SOUL, spellcastingSpellList: "Wizard"},
				{name: "Blood Hunter"},
			);
			expect(resolved).toBe("Wizard");
		});
	});
});
