import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** A Tempest-domain-shaped subclass carrying always-prepared domain spells. */
function makeTempestDomain () {
	return {
		name: "Tempest Domain",
		shortName: "Tempest",
		source: "PHB",
		className: "Cleric",
		classSource: "PHB",
		// The always-prepared "domain spells" — this is what must reach the spell list.
		additionalSpells: [{prepared: {1: ["fog cloud", "thunderwave"]}}],
		subclassFeatures: [
			[
				{name: "Tempest Domain Spells", source: "PHB", className: "Cleric", classSource: "PHB", subclassShortName: "Tempest", subclassSource: "PHB", level: 1, entries: ["You gain domain spells."]},
				{name: "Wrath of the Storm", source: "PHB", className: "Cleric", classSource: "PHB", subclassShortName: "Tempest", subclassSource: "PHB", level: 1, entries: ["Reaction lightning."]},
			],
		],
	};
}

/** A 2014-PHB-shaped Cleric that gains its subclass at level 1. */
function makeClericClass () {
	return {
		name: "Cleric",
		source: "PHB",
		hd: {number: 1, faces: 8},
		spellcastingAbility: "wis",
		casterProgression: "full",
		proficiency: ["con", "wis"],
		subclassTitle: "Divine Domain",
		classFeatures: [
			[
				"Spellcasting|Cleric|PHB|1",
				{classFeature: "Divine Domain|Cleric|PHB|1", gainSubclassFeature: true},
			],
		],
		subclasses: [makeTempestDomain()],
	};
}

/** Minimal page stub sufficient for the apply paths under test. */
function makePage () {
	return {
		renderCharacter: () => {},
		saveCharacter: async () => {},
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getSpells: () => [],
		filterByAllowedSources: (/** @type {*} */ arr) => arr,
	};
}

const domainSpellNames = spells => spells.map(s => s.name.toLowerCase());

// ─── Builder path ────────────────────────────────────────────────────────────

describe("Cleric domain spells — builder path", () => {
	test("selecting a Tempest domain grants its always-prepared domain spells", () => {
		const builder = Object.create(CharacterSheetBuilder.prototype);
		const state = new CharacterSheetState();
		builder._state = state;
		builder._page = makePage();

		const cleric = makeClericClass();
		builder._selectedClass = cleric;
		builder._selectedSubclass = CharacterSheetClassUtils.resolveFullSubclass(cleric.subclasses[0], cleric);
		builder._divineSoulAffinity = null;
		builder._lastAppliedClassSnapshot = null;
		builder._currentStep = 3;

		// Empty user selections so the Class step apply runs with only the class + subclass.
		Object.assign(builder, {
			_selectedSkills: [],
			_selectedExpertise: [],
			_selectedClassToolProficiencies: [],
			_selectedClassFeatureLanguages: [],
			_selectedClassFeatProgression: [],
			_selectedWeaponMasteries: [],
			_selectedCombatTraditions: [],
			_selectedOptionalFeatures: {},
			_selectedFeatureOptions: {},
			_selectedRace: null,
			_selectedSubrace: null,
			_selectedBackground: null,
			_selectedRacialLanguages: {},
			_selectedSubraceLanguages: [],
			_selectedRacialSkills: [],
			_selectedRacialTools: [],
			_selectedRacialAbilityChoices: {},
			_selectedRacialFeatureChoices: {},
			_selectedRacialAbilityBonuses: {},
			_useTashasRules: false,
			_tashasAbilityBonuses: {},
			_tashasSkillReplacements: [],
			_tashasLanguageReplacements: [],
			_selectedToolProficiencies: [],
			_selectedLanguages: [],
			_selectedAbilityBonuses: {},
		});

		builder._applyCurrentStep();

		const known = state.getSpellsKnown();
		const names = domainSpellNames(known);
		expect(names).toContain("fog cloud");
		expect(names).toContain("thunderwave");
		// Domain spells are always-prepared and must not count against the prepared limit.
		known.filter(s => ["fog cloud", "thunderwave"].includes(s.name.toLowerCase()))
			.forEach(s => {
				expect(s.alwaysPrepared).toBe(true);
				expect(s.sourceFeature).toBe("Tempest Domain Spells");
			});
	});

	test("re-applying the class does not double-add domain spells (idempotent)", () => {
		const builder = Object.create(CharacterSheetBuilder.prototype);
		const state = new CharacterSheetState();
		builder._state = state;
		builder._page = makePage();

		const cleric = makeClericClass();
		builder._selectedClass = cleric;
		builder._selectedSubclass = CharacterSheetClassUtils.resolveFullSubclass(cleric.subclasses[0], cleric);
		builder._divineSoulAffinity = null;
		builder._lastAppliedClassSnapshot = null;
		builder._currentStep = 3;
		Object.assign(builder, {
			_selectedSkills: [],
			_selectedExpertise: [],
			_selectedClassToolProficiencies: [],
			_selectedClassFeatureLanguages: [],
			_selectedClassFeatProgression: [],
			_selectedWeaponMasteries: [],
			_selectedCombatTraditions: [],
			_selectedOptionalFeatures: {},
			_selectedFeatureOptions: {},
			_selectedRace: null,
			_selectedSubrace: null,
			_selectedBackground: null,
			_selectedRacialLanguages: {},
			_selectedSubraceLanguages: [],
			_selectedRacialSkills: [],
			_selectedRacialTools: [],
			_selectedRacialAbilityChoices: {},
			_selectedRacialFeatureChoices: {},
			_selectedRacialAbilityBonuses: {},
			_useTashasRules: false,
			_tashasAbilityBonuses: {},
			_tashasSkillReplacements: [],
			_tashasLanguageReplacements: [],
			_selectedToolProficiencies: [],
			_selectedLanguages: [],
			_selectedAbilityBonuses: {},
		});

		builder._applyCurrentStep();
		builder._applyCurrentStep(); // simulate revisiting the Class step

		const fogCount = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "fog cloud").length;
		expect(fogCount).toBe(1);
	});
});

// ─── Multiclass path ──────────────────────────────────────────────────────────

describe("Cleric domain spells — multiclass path", () => {
	function makeLevelUp () {
		const levelup = Object.create(CharacterSheetLevelUp.prototype);
		levelup._state = new CharacterSheetState();
		levelup._page = makePage();
		// Avoid draining downstream feat/spell choice queues in the test harness.
		levelup._processFeatSpellChoices = async () => {};
		return levelup;
	}

	test("adding Cleric with a Tempest domain grants always-prepared domain spells", async () => {
		const levelup = makeLevelUp();
		const cleric = makeClericClass();
		const tempest = CharacterSheetClassUtils.resolveFullSubclass(cleric.subclasses[0], cleric);

		await levelup._applyMulticlass(cleric, [], {}, {}, [], [], [], [], tempest);

		const known = levelup._state.getSpellsKnown();
		const names = domainSpellNames(known);
		expect(names).toContain("fog cloud");
		expect(names).toContain("thunderwave");
		known.filter(s => ["fog cloud", "thunderwave"].includes(s.name.toLowerCase()))
			.forEach(s => expect(s.alwaysPrepared).toBe(true));
	});

	test("multiclass cantrips land in the cantrip list even without an explicit level (isCantrip flag fix)", async () => {
		const levelup = makeLevelUp();
		const cleric = makeClericClass();
		const tempest = CharacterSheetClassUtils.resolveFullSubclass(cleric.subclasses[0], cleric);

		// A cantrip object WITHOUT `level` — the old addSpell(buildSpellStateObject(...,{isCantrip}))
		// path would misroute this into spellsKnown because buildSpellStateObject ignores isCantrip
		// and addSpell only routes level===0 to cantrips. The fix uses addCantrip directly.
		const cantrip = {name: "Sacred Flame", source: "PHB", school: "V"};

		// Positional args: (class, features, optFeatures, featureOptions, skills, spells, cantrips, tools, subclass)
		await levelup._applyMulticlass(cleric, [], {}, {}, [], [], [cantrip], [], tempest);

		const cantripNames = levelup._state.getCantripsKnown().map(c => c.name.toLowerCase());
		const spellNames = levelup._state.getSpellsKnown().map(s => s.name.toLowerCase());
		expect(cantripNames).toContain("sacred flame");
		expect(spellNames).not.toContain("sacred flame");
	});
});
