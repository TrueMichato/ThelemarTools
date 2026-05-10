import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal CharacterSheetBuilder instance with a tracked fake state. */
function makeBuilder () {
	const builder = Object.create(CharacterSheetBuilder.prototype);

	builder._page = {renderCharacter: () => {}};
	const state = {
		classes: [],
		saveProficiencies: [],
		skills: {}, // key → level (0=none, 1=prof, 2=expertise)
		armorProficiencies: [],
		weaponProficiencies: [],
		toolProficiencies: [],
		languages: [],
		features: [], // { name, source, className, ... }
		weaponMasteries: [],
		spellcastingAbility: null,
		levelHistory: [],

		addClass (cls) {
			const existing = this.classes.findIndex(c => c.name === cls.name && c.source === cls.source);
			if (existing >= 0) this.classes[existing] = cls;
			else this.classes.push(cls);
		},
		removeClass (className, source) {
			this.classes = this.classes.filter(c => !(c.name === className && c.source === source));
		},
		addSaveProficiency (p) { if (!this.saveProficiencies.includes(p)) this.saveProficiencies.push(p); },
		removeSaveProficiency (p) { this.saveProficiencies = this.saveProficiencies.filter(x => x !== p); },
		setSkillProficiency (key, level) { this.skills[key] = level; },
		addArmorProficiency (a) { if (!this.armorProficiencies.includes(a)) this.armorProficiencies.push(a); },
		removeArmorProficiency (a) { this.armorProficiencies = this.armorProficiencies.filter(x => x !== a); },
		addWeaponProficiency (w) { if (!this.weaponProficiencies.includes(w)) this.weaponProficiencies.push(w); },
		removeWeaponProficiency (w) { this.weaponProficiencies = this.weaponProficiencies.filter(x => x !== w); },
		addToolProficiency (t) {
			const norm = t.toLowerCase().replace(/['\s]+/g, "");
			if (!this.toolProficiencies.some(x => x.toLowerCase().replace(/['\s]+/g, "") === norm)) this.toolProficiencies.push(t);
		},
		removeToolProficiency (t) {
			const norm = t.toLowerCase().replace(/['\s]+/g, "");
			this.toolProficiencies = this.toolProficiencies.filter(x => x.toLowerCase().replace(/['\s]+/g, "") !== norm);
		},
		addLanguage (l) { if (!this.languages.includes(l)) this.languages.push(l); },
		removeLanguage (l) { this.languages = this.languages.filter(x => x.toLowerCase() !== l.toLowerCase()); },
		addFeature (f) {
			const dup = this.features.some(x => x.name === f.name && x.source === f.source && x.className === f.className);
			if (!dup) this.features.push(f);
		},
		removeFeature (name, source) {
			this.features = this.features.filter(f => !(f.name === name && f.source === source));
		},
		getFeatures () { return this.features.map(f => ({...f})); },
		setWeaponMasteries (m) { this.weaponMasteries = [...m]; },
		setSpellcastingAbility (a) { this.spellcastingAbility = a; },
		setSpellSlots () {},
		recordLevelChoice (entry) {
			this.levelHistory = this.levelHistory.filter(h => h.level !== entry.level);
			this.levelHistory.push(entry);
		},
		removeLevelHistoryEntry (level) {
			this.levelHistory = this.levelHistory.filter(h => h.level !== level);
		},
		calculateSpellSlots () {},
	};

	builder._state = state;
	builder._selectedBackground = null;
	builder._lastAppliedClassSnapshot = null;

	return builder;
}

// ─── Simple class stubs ───────────────────────────────────────────────────────

const FIGHTER = {
	name: "Fighter",
	source: "PHB",
	proficiency: ["str", "con"],
	startingProficiencies: {
		armor: ["light armor", "medium armor", "heavy armor", "shields"],
		weapons: ["simple weapons", "martial weapons"],
		tools: [],
	},
	classFeatures: [[
		{classFeature: "Fighting Style|Fighter|PHB|1|PHB"},
		{classFeature: "Second Wind|Fighter|PHB|1|PHB"},
	]],
	spellcastingAbility: null,
	casterProgression: null,
	preparedSpellsProgression: null,
	spellsKnownProgression: null,
	cantripProgression: null,
};

const WIZARD = {
	name: "Wizard",
	source: "PHB",
	proficiency: ["int", "wis"],
	startingProficiencies: {
		armor: [],
		weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"],
		tools: [],
	},
	classFeatures: [[
		{classFeature: "Arcane Recovery|Wizard|PHB|1|PHB"},
		{classFeature: "Spellcasting|Wizard|PHB|1|PHB"},
	]],
	spellcastingAbility: "int",
	casterProgression: "full",
	preparedSpellsProgression: null,
	spellsKnownProgression: null,
	cantripProgression: null,
};

// ─── _clearClassApplication unit tests ────────────────────────────────────────

describe("CharacterSheetBuilder _clearClassApplication()", () => {
	test("does nothing when snapshot is null", () => {
		const builder = makeBuilder();
		// Should not throw
		expect(() => builder._clearClassApplication(null)).not.toThrow();
		expect(() => builder._clearClassApplication(undefined)).not.toThrow();
	});

	test("removes class from state", () => {
		const builder = makeBuilder();
		builder._state.classes.push({name: "Fighter", source: "PHB"});
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.classes).toHaveLength(0);
	});

	test("removes save proficiencies granted by the class", () => {
		const builder = makeBuilder();
		builder._state.saveProficiencies = ["str", "con"];
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: ["str", "con"],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.saveProficiencies).toHaveLength(0);
	});

	test("keeps background skills that overlapped with class skills", () => {
		const builder = makeBuilder();
		// Background grants Acrobatics; class also set it (so it was kept at 1)
		builder._state.skills["acrobatics"] = 1;
		builder._selectedBackground = {
			skillProficiencies: [{"acrobatics": true}],
		};
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: ["acrobatics"], // class had chosen acrobatics
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		// Background re-assertion should keep acrobatics at 1
		expect(builder._state.skills["acrobatics"]).toBe(1);
	});

	test("class-only skills are zeroed after clearing", () => {
		const builder = makeBuilder();
		builder._state.skills["athletics"] = 1;
		// No background — athletics came solely from class
		builder._selectedBackground = null;
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: ["athletics"],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.skills["athletics"]).toBe(0);
	});

	test("removes armor and weapon proficiencies", () => {
		const builder = makeBuilder();
		builder._state.armorProficiencies = ["light armor", "heavy armor"];
		builder._state.weaponProficiencies = ["simple weapons", "martial weapons"];
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: ["light armor", "heavy armor"],
			weaponProficiencies: ["simple weapons", "martial weapons"],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.armorProficiencies).toHaveLength(0);
		expect(builder._state.weaponProficiencies).toHaveLength(0);
	});

	test("removes features belonging to the class", () => {
		const builder = makeBuilder();
		builder._state.features = [
			{name: "Second Wind", source: "PHB", className: "Fighter"},
			{name: "Darkvision", source: "PHB", className: null}, // racial, should stay
		];
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.features).toHaveLength(1);
		expect(builder._state.features[0].name).toBe("Darkvision");
	});

	test("clears spellcasting ability when hadSpellcasting is true", () => {
		const builder = makeBuilder();
		builder._state.spellcastingAbility = "int";
		const snapshot = {
			className: "Wizard",
			classSource: "PHB",
			saveProficiencies: [],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: true,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.spellcastingAbility).toBeNull();
	});

	test("removes the level 1 history entry", () => {
		const builder = makeBuilder();
		builder._state.levelHistory = [{level: 1, class: {name: "Fighter"}}];
		const snapshot = {
			className: "Fighter",
			classSource: "PHB",
			saveProficiencies: [],
			skills: [],
			expertiseSkills: [],
			armorProficiencies: [],
			weaponProficiencies: [],
			toolProficiencies: [],
			languages: [],
			hadSpellcasting: false,
		};
		builder._clearClassApplication(snapshot);
		expect(builder._state.levelHistory).toHaveLength(0);
	});
});

// ─── Snapshot vs. state integration via _applyCurrentStep case 3 ─────────────
// These tests exercise the full case 3 path including clear+reapply

describe("CharacterSheetBuilder class change (case 3 idempotency)", () => {
	/**
	 * Run case 3 of _applyCurrentStep with the given class and user selections.
	 * Returns the builder so state can be inspected.
	 */
	function applyClass (builder, classDef, {skills = [], expertise = [], subclass = null} = {}) {
		builder._selectedClass = classDef;
		builder._selectedSubclass = subclass;
		builder._selectedSkills = skills;
		builder._selectedExpertise = expertise;
		builder._selectedClassToolProficiencies = [];
		builder._selectedClassFeatureLanguages = [];
		builder._selectedOptionalFeatures = {};
		builder._selectedFeatureOptions = {};
		builder._selectedCombatTraditions = [];
		builder._selectedWeaponMasteries = [];
		builder._divineSoulAffinity = null;
		builder._currentStep = 3;

		// Minimal stubs needed by _applyClassFeatures internals
		builder._getSpellSlotsForLevel = () => ({});
		builder._getClassFeatureData = () => null;
		builder._getSubclassFeatureData = () => null;
		builder._getClassFeatureLanguageGrants = () => ({autoLanguages: []});

		builder._applyCurrentStep();
		return builder;
	}

	test("applying Fighter then switching to Wizard yields exactly 1 class (Wizard)", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER, {skills: ["athletics"]});
		expect(builder._state.classes).toHaveLength(1);
		expect(builder._state.classes[0].name).toBe("Fighter");

		applyClass(builder, WIZARD, {skills: ["arcana"]});
		expect(builder._state.classes).toHaveLength(1);
		expect(builder._state.classes[0].name).toBe("Wizard");
	});

	test("Fighter save profs (str, con) are removed when switching to Wizard (int, wis)", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER);
		expect(builder._state.saveProficiencies).toContain("str");
		expect(builder._state.saveProficiencies).toContain("con");

		applyClass(builder, WIZARD);
		expect(builder._state.saveProficiencies).not.toContain("str");
		expect(builder._state.saveProficiencies).not.toContain("con");
		expect(builder._state.saveProficiencies).toContain("int");
		expect(builder._state.saveProficiencies).toContain("wis");
	});

	test("Fighter armor profs are gone after switching to Wizard", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER);
		expect(builder._state.armorProficiencies).toContain("light armor");
		expect(builder._state.armorProficiencies).toContain("heavy armor");

		applyClass(builder, WIZARD);
		expect(builder._state.armorProficiencies).toHaveLength(0);
	});

	test("spellcasting ability is updated when switching from Fighter to Wizard", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER);
		expect(builder._state.spellcastingAbility).toBeNull();

		applyClass(builder, WIZARD);
		expect(builder._state.spellcastingAbility).toBe("int");
	});

	test("applying the same class twice is idempotent (1 entry, no duplicate profs)", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER, {skills: ["athletics"]});
		applyClass(builder, FIGHTER, {skills: ["athletics"]});

		expect(builder._state.classes).toHaveLength(1);
		// str and con should each appear exactly once
		expect(builder._state.saveProficiencies.filter(p => p === "str")).toHaveLength(1);
		expect(builder._state.saveProficiencies.filter(p => p === "con")).toHaveLength(1);
	});

	test("level history has exactly one level-1 entry after a class change", () => {
		const builder = makeBuilder();

		applyClass(builder, FIGHTER);
		expect(builder._state.levelHistory.filter(h => h.level === 1)).toHaveLength(1);
		expect(builder._state.levelHistory[0].class.name).toBe("Fighter");

		applyClass(builder, WIZARD);
		expect(builder._state.levelHistory.filter(h => h.level === 1)).toHaveLength(1);
		expect(builder._state.levelHistory[0].class.name).toBe("Wizard");
	});
});
