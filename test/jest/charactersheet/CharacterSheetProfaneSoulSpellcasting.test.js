import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

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

describe("Otherworldly Patron is offered as a real choice (CS-BUG-160)", () => {
	// Verbatim from the BH2022 source: the nine patrons live in a `type: "list"`
	// of prose sentences, NOT in a `type: "options"` entry. That is why
	// `findFeatureOptions` could not see them and the choice was never offered,
	// even though `_getProfaneSoulPatron()` was ready to read it back.
	const OTHERWORLDLY_PATRON = {
		name: "Otherworldly Patron",
		source: "BH2022",
		entries: [
			"When you reach 3rd level, you strike a bargain with an otherworldly being of your choice:",
			{
				type: "list",
				items: [
					"The Archfey, the Fiend, or the Great Old One, detailed in the {@book Player's Handbook|PHB}",
					"The Undying, from {@book Sword Coast Adventurer's Guide|SCAG}",
					"The Celestial or the Hexblade, from {@book Xanathar's Guide to Everything|XGE}",
					"The Fathomless or the Genie, from {@book Tasha's Cauldron of Everything|TCE}",
					"The Undead, from {@book Van Richten's Guide to Ravenloft|VGR}",
				],
			},
			"The choice you make augments some of your subclass features, as noted below.",
		],
	};

	it("surfaces exactly one group asking for one of the nine patrons", () => {
		const groups = CharacterSheetClassUtils.findFeatureOptions(OTHERWORLDLY_PATRON, 3);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(1);
		expect(groups[0].options.map(o => o.name)).toEqual([
			"The Archfey", "The Fiend", "The Great Old One", "The Undying", "The Celestial",
			"The Hexblade", "The Fathomless", "The Genie", "The Undead",
		]);
	});

	it("emits the same option shape as a data-declared choice, so nothing downstream special-cases it", () => {
		const [group] = CharacterSheetClassUtils.findFeatureOptions(OTHERWORLDLY_PATRON, 3);
		for (const opt of group.options) {
			expect(opt.type).toBe("inline");
			expect(opt.source).toBe("BH2022");
			expect(Array.isArray(opt.entries)).toBe(true);
		}
	});

	it("does not fire for features that state no choice", () => {
		const plain = {name: "Rite Focus", source: "BH2022", entries: ["Your patron bestows a gift."]};
		expect(CharacterSheetClassUtils.findFeatureOptions(plain, 3)).toEqual([]);
	});

	it("yields to real data: a feature carrying an `options` entry never reaches the table", () => {
		// Guards the ordering. If BH2022 is ever corrected upstream to declare a
		// proper `options` entry, the data must win and the table must go quiet —
		// otherwise the player would be asked twice.
		const withData = {
			...OTHERWORLDLY_PATRON,
			entries: [
				{
					type: "options",
					count: 1,
					entries: [
						{type: "refSubclassFeature", subclassFeature: "The Fiend|Blood Hunter|BH2022|Profane Soul|BH2022|3"},
						{type: "refSubclassFeature", subclassFeature: "The Archfey|Blood Hunter|BH2022|Profane Soul|BH2022|3"},
					],
				},
			],
		};
		const groups = CharacterSheetClassUtils.findFeatureOptions(withData, 3);
		expect(groups).toHaveLength(1);
		// The data group, not the table's nine inline entries.
		expect(groups[0].options.map(o => o.name)).toEqual(["The Fiend", "The Archfey"]);
	});

	it("the recorded pick is read back by the patron accessor", () => {
		// The full round trip: what the wizard stores is what the patron-dependent
		// surfaces (Rite Focus / Revealed Arcana / Unsealed Arcana) read.
		const state = getState(3);
		state._data.levelHistory = [{
			class: {name: "Blood Hunter"},
			choices: {featureChoices: [{featureName: "Otherworldly Patron", choice: "The Archfey"}]},
		}];
		expect(state._getProfaneSoulPatron()).toBe("The Archfey");
		expect(state.getFeatureCalculations().profaneSoulPatron).toBe("The Archfey");
	});

	it("reports no patron when the choice was never made", () => {
		expect(getState(3)._getProfaneSoulPatron()).toBeNull();
	});
});

describe("Pact Magic does not re-ask an already-made choice (CS-BUG-161)", () => {
	// Verbatim shape from BH2022. The prose says the ability is ALREADY fixed by the
	// level-1 Hunter's Bane hemocraft choice; the `abilityDc` entry exists to declare
	// how the DC is displayed, not to pose a second decision.
	const PACT_MAGIC = {
		name: "Pact Magic",
		source: "BH2022",
		entries: [
			"Your chosen Hemocraft ability (Intelligence or Wisdom) is your spellcasting ability for your warlock spells.",
			{type: "abilityDc", name: "Spell save DC", attributes: ["int", "wis"]},
		],
	};

	it("offers no choice, because the ability was chosen at level 1", () => {
		expect(CharacterSheetClassUtils.findFeatureOptions(PACT_MAGIC, 3)).toEqual([]);
	});

	it("still offers the choice for features where it IS a real decision", () => {
		// Hunter's Bane is the choice Pact Magic inherits, and Combat Superiority is
		// the only other multi-attribute `abilityDc` in the official class corpus.
		// Neither may be suppressed by the guard.
		for (const name of ["Hunter's Bane", "Combat Superiority"]) {
			const groups = CharacterSheetClassUtils.findFeatureOptions({
				name,
				source: "BH2022",
				entries: [{type: "abilityDc", name: "Save DC", attributes: ["wis", "int"]}],
			}, 3);
			expect(groups).toHaveLength(1);
			expect(groups[0].options.map(o => o.name)).toEqual(["Wisdom", "Intelligence"]);
		}
	});

	it("the ability actually used is the hemocraft one, which is what made the extra prompt inert", () => {
		const state = getState(3);
		state._data.levelHistory = [{
			class: {name: "Blood Hunter"},
			choices: {featureChoices: [{featureName: "Hunter's Bane", choice: "Wisdom"}]},
		}];
		const calc = state.getFeatureCalculations();
		expect(calc.profaneSoulSpellcastingAbility).toBe(calc.hemocraftAbility);
	});
});
