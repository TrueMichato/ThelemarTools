import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;

const getPage = () => {
	const fighter = {
		name: "Fighter",
		source: "XPHB",
		hd: {faces: 10},
		startingProficiencies: {
			skills: [{choose: {from: ["athletics", "perception", "survival"], count: 2}}],
		},
		classFeatures: [
			"Fighting Style|Fighter|XPHB|1",
			"Second Wind|Fighter|XPHB|1",
			"Action Surge|Fighter|XPHB|2",
			"Fighter Subclass|Fighter|XPHB|3",
			"Ability Score Improvement|Fighter|XPHB|4",
		],
	};
	const wizard = {
		name: "Wizard",
		source: "XPHB",
		hd: {faces: 6},
		casterProgression: "full",
		spellcastingAbility: "int",
		cantripProgression: [3, 3, 3, 4],
		preparedSpellsProgression: [4, 5, 6, 7],
		startingProficiencies: {
			skills: [{choose: {from: ["arcana", "history", "investigation"], count: 2}}],
		},
		classFeatures: [
			"Spellcasting|Wizard|XPHB|1",
			"Arcane Recovery|Wizard|XPHB|1",
			"Scholar|Wizard|XPHB|2",
			"Wizard Subclass|Wizard|XPHB|3",
			"Ability Score Improvement|Wizard|XPHB|4",
		],
	};
	const cleric = {
		name: "Cleric",
		source: "XPHB",
		hd: {faces: 8},
		casterProgression: "full",
		spellcastingAbility: "wis",
		cantripProgression: [3, 3],
		preparedSpellsProgression: [4, 5],
		startingProficiencies: {
			skills: [{choose: {from: ["history", "medicine", "religion"], count: 2}}],
		},
		classFeatures: [
			"Spellcasting|Cleric|XPHB|1",
			"Divine Order|Cleric|XPHB|1",
		],
	};

	return {
		getClasses: () => [fighter, wizard, cleric],
		getClassFeatures: () => [
			{name: "Fighting Style", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 1, entries: []},
			{name: "Second Wind", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 1, entries: []},
			{name: "Action Surge", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 2, entries: []},
			{name: "Fighter Subclass", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 3, gainSubclassFeature: true, entries: []},
			{name: "Ability Score Improvement", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 4, entries: []},
			{name: "Spellcasting", source: "XPHB", className: "Wizard", classSource: "XPHB", level: 1, entries: []},
			{name: "Arcane Recovery", source: "XPHB", className: "Wizard", classSource: "XPHB", level: 1, entries: []},
			{name: "Scholar", source: "XPHB", className: "Wizard", classSource: "XPHB", level: 2, entries: []},
			{name: "Wizard Subclass", source: "XPHB", className: "Wizard", classSource: "XPHB", level: 3, gainSubclassFeature: true, entries: []},
			{name: "Ability Score Improvement", source: "XPHB", className: "Wizard", classSource: "XPHB", level: 4, entries: []},
			{name: "Spellcasting", source: "XPHB", className: "Cleric", classSource: "XPHB", level: 1, entries: []},
			{name: "Divine Order", source: "XPHB", className: "Cleric", classSource: "XPHB", level: 1, entries: []},
		],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [
			{name: "Athletics"},
			{name: "Perception"},
			{name: "Survival"},
			{name: "Arcana"},
			{name: "History"},
			{name: "Investigation"},
		],
	};
};

const getState = ({classes, history, spells = [], cantrips = [], abilityScores = {}}) => ({
	getClasses: () => classes,
	getLevelHistory: () => history,
	getTotalLevel: () => classes.reduce((sum, cls) => sum + cls.level, 0),
	getSpells: () => [...spells, ...cantrips],
	getSpellsKnown: () => spells,
	getCantripsKnown: () => cantrips,
	getWeaponMasteries: () => [],
	getCombatTraditions: () => [],
	getSettings: () => ({}),
	getAbilityScore: ability => abilityScores[ability] ?? 13,
});

describe("CharacterSheetProgression manifest", () => {
	it("does not duplicate legacy prepared cantrips as known cantrips", () => {
		const decisions = CharacterSheetProgression.projectLegacyChoices({
			level: 1,
			class: {name: "Cleric", source: "XPHB"},
			choices: {preparedCantrips: [{name: "Guidance", source: "XPHB", level: 0}]},
		});

		expect(decisions.filter(decision => decision.type === "preparedCantrips")).toHaveLength(1);
		expect(decisions.filter(decision => decision.type === "cantrips")).toHaveLength(0);
	});

	it("surfaces skipped class skills and ASI choices even when history has no matching keys", () => {
		const page = getPage();
		const history = [
			{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {}, complete: true},
			{level: 2, class: {name: "Fighter", source: "XPHB"}, choices: {}, complete: true},
			{level: 3, class: {name: "Fighter", source: "XPHB"}, choices: {subclass: {name: "Champion", source: "XPHB"}}, complete: true},
			{level: 4, class: {name: "Fighter", source: "XPHB"}, choices: {}, complete: true},
		];
		const state = getState({
			classes: [{name: "Fighter", source: "XPHB", level: 4, subclass: {name: "Champion", source: "XPHB"}}],
			history,
		});

		const manifest = CharacterSheetProgression.buildManifest({page, state});
		const startingSkills = manifest.decisions.find(it => it.type === "skills");
		const asiOrFeat = manifest.decisions.find(it => it.type === "asiOrFeat");

		expect(startingSkills).toMatchObject({characterLevel: 1, required: true, status: "missing", count: 2});
		expect(asiOrFeat).toMatchObject({characterLevel: 4, required: true, status: "missing"});
	});

	it("derives Wizard spellbook/cantrip and prepared-caster permanent spell opportunities", () => {
		const page = getPage();
		const wizardHistory = [
			{level: 1, class: {name: "Wizard", source: "XPHB"}, choices: {}, complete: true},
			{level: 2, class: {name: "Wizard", source: "XPHB"}, choices: {}, complete: true},
		];
		const wizardState = getState({
			classes: [{name: "Wizard", source: "XPHB", level: 2}],
			history: wizardHistory,
		});

		const wizardManifest = CharacterSheetProgression.buildManifest({page, state: wizardState});

		expect(wizardManifest.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "spellbookSpells", characterLevel: 1, count: 6, status: "missing"}),
			expect.objectContaining({type: "cantrips", characterLevel: 1, count: 3, status: "missing"}),
			expect.objectContaining({type: "spellbookSpells", characterLevel: 2, count: 2, status: "missing"}),
		]));
		expect(wizardManifest.decisions.some(it => it.type === "preparedSpells")).toBe(false);

		const clericManifest = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [{name: "Cleric", source: "XPHB", level: 2}],
				history: [
					{level: 1, class: {name: "Cleric", source: "XPHB"}, choices: {}, complete: true},
					{level: 2, class: {name: "Cleric", source: "XPHB"}, choices: {}, complete: true},
				],
			}),
		});
		expect(clericManifest.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "preparedSpells", characterLevel: 1, count: 4, status: "missing"}),
			expect.objectContaining({type: "preparedSpells", characterLevel: 2, count: 1, status: "missing"}),
		]));
	});

	it("keeps semantic decision keys stable when class levels move to different character levels", () => {
		const page = getPage();
		const firstHistory = [
			{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {skills: ["Athletics", "Perception"]}},
			{level: 2, class: {name: "Wizard", source: "XPHB"}, choices: {}},
			{level: 3, class: {name: "Fighter", source: "XPHB"}, choices: {}},
			{level: 4, class: {name: "Fighter", source: "XPHB"}, choices: {subclass: {name: "Champion", source: "XPHB"}}},
		];
		const reorderedHistory = [
			{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {skills: ["Athletics", "Perception"]}},
			{level: 2, class: {name: "Fighter", source: "XPHB"}, choices: {}},
			{level: 3, class: {name: "Fighter", source: "XPHB"}, choices: {subclass: {name: "Champion", source: "XPHB"}}},
			{level: 4, class: {name: "Wizard", source: "XPHB"}, choices: {}},
		];

		const first = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [
					{name: "Fighter", source: "XPHB", level: 3, subclass: {name: "Champion", source: "XPHB"}},
					{name: "Wizard", source: "XPHB", level: 1},
				],
				history: firstHistory,
			}),
		});
		const reordered = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [
					{name: "Fighter", source: "XPHB", level: 3, subclass: {name: "Champion", source: "XPHB"}},
					{name: "Wizard", source: "XPHB", level: 1},
				],
				history: reorderedHistory,
			}),
		});

		const firstSubclass = first.decisions.find(it => it.type === "subclass" && it.className === "Fighter");
		const reorderedSubclass = reordered.decisions.find(it => it.type === "subclass" && it.className === "Fighter");

		expect(firstSubclass.characterLevel).toBe(4);
		expect(reorderedSubclass.characterLevel).toBe(3);
		expect(firstSubclass.semanticKey).toBe(reorderedSubclass.semanticKey);
		expect(firstSubclass.id).not.toBe(reorderedSubclass.id);
	});

	it("projects sparse legacy choices into a versioned compatibility ledger", () => {
		const normalized = CharacterSheetProgression.normalizeHistoryEntry({
			level: 4,
			class: {name: "Fighter", source: "XPHB"},
			choices: {
				asi: {str: 1, con: 1},
				weaponMasteries: ["longsword|XPHB"],
			},
			complete: true,
		});

		expect(normalized.ledgerVersion).toBe(CharacterSheetProgression.LEDGER_VERSION);
		expect(normalized.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "asi", selection: {str: 1, con: 1}, status: "resolved"}),
			expect.objectContaining({type: "weaponMasteries", selection: ["longsword|XPHB"], status: "resolved"}),
		]));
		expect(normalized.manifestComplete).toBe(false);
	});

	it("invalidates a preserved selection when a recomputed opportunity no longer allows it", () => {
		const page = {
			getClasses: () => [{
				name: "Fighter",
				source: "XPHB",
				startingProficiencies: {
					skills: [{choose: {from: ["athletics"], count: 1}}],
				},
				classFeatures: [],
			}],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSkillsList: () => ["athletics"],
		};
		const state = getState({
			classes: [{name: "Fighter", source: "XPHB", level: 1}],
			history: [{
				level: 1,
				class: {name: "Fighter", source: "XPHB"},
				choices: {skills: ["perception"]},
			}],
		});

		const manifest = CharacterSheetProgression.buildManifest({page, state});
		expect(manifest.decisions.find(decision => decision.type === "skills")).toEqual(expect.objectContaining({
			selection: ["perception"],
			status: "invalid",
		}));
	});

	it("matches recorded feature-choice receipts to entity-shaped legal options", () => {
		expect(CharacterSheetProgression._isSelectionValid({
			type: "featureChoice",
			count: 1,
			options: [{name: "Amphibious Combatant", source: "TGTT"}],
			selection: [{
				featureName: "Specialties",
				choice: "Amphibious Combatant",
				source: "TGTT",
				acquisitionLevel: 1,
			}],
		})).toBe(true);
		expect(CharacterSheetProgression._isSelectionValid({
			type: "featureChoice",
			count: 1,
			options: [{name: "Defense", source: "XPHB"}],
			selection: [{featureName: "Fighting Style", choice: "Defense"}],
		})).toBe(true);
		expect(CharacterSheetProgression._isSelectionValid({
			type: "skills",
			count: 1,
			options: ["Animal Handling"],
			selection: ["animalhandling"],
		})).toBe(true);
	});

	it("derives usable options for open tool and expertise grants", () => {
		const previousRenderer = globalThis.Renderer;
		globalThis.Renderer = {
			...(previousRenderer || {}),
			generic: {
				...(previousRenderer?.generic || {}),
				FEATURE__TOOLS_ARTISANS: ["Smith's Tools"],
				FEATURE__TOOLS_MUSICAL_INSTRUMENTS: ["Lute"],
				FEATURE__TOOLS_ALL: ["Smith's Tools", "Lute", "Thieves' Tools"],
			},
		};
		try {
			expect(CharacterSheetProgression._getToolGrant([{anyMusicalInstrument: 3}])).toEqual(expect.objectContaining({
				count: 3,
				options: ["Lute"],
			}));
			expect(CharacterSheetProgression._getToolGrant([{anyArtisansTool: 1}, {anyMusicalInstrument: 1}])).toEqual(expect.objectContaining({
				count: 1,
				options: ["Smith's Tools", "Lute"],
			}));
		} finally {
			globalThis.Renderer = previousRenderer;
		}
	});

	it("keeps legal-option catalogs out of persisted level history", () => {
		const history = [{
			level: 1,
			class: {name: "Fighter", source: "XPHB"},
			choices: {skills: ["athletics"]},
		}];
		const decision = CharacterSheetProgression._makeDecision({
			characterLevel: 1,
			className: "Fighter",
			classSource: "XPHB",
			classLevel: 1,
			type: "skills",
			label: "Starting Skills",
			sourceKey: "starting-proficiencies",
			options: [{name: "Athletics", source: "XPHB", entries: ["Large catalog payload"]}],
			selection: ["athletics"],
		});
		const reconciled = CharacterSheetProgression.reconcileHistoryWithManifest({
			history,
			manifest: {
				levels: [{
					characterLevel: 1,
					className: "Fighter",
					classSource: "XPHB",
					classLevel: 1,
					decisions: [decision],
				}],
			},
		});
		expect(reconciled[0].decisions[0].options).toEqual([]);
	});

	it("preserves legacy choice families which the manifest did not rediscover", () => {
		const projected = CharacterSheetProgression.projectDecisionsToChoices({
			level: 2,
			class: {name: "Fighter", source: "TGTT"},
			choices: {
				weaponMasteries: ["Longsword|XPHB"],
				optionalFeatures: [{name: "Legacy Method", source: "TGTT", type: "CTM:BON"}],
				skills: ["athletics"],
			},
			manifestComplete: true,
			decisions: [CharacterSheetProgression._makeDecision({
				characterLevel: 2,
				className: "Fighter",
				classSource: "TGTT",
				classLevel: 2,
				type: "skills",
				label: "Skills",
				selection: ["perception"],
			})],
		});
		expect(projected.choices.weaponMasteries).toEqual(["Longsword|XPHB"]);
		expect(projected.choices.optionalFeatures).toEqual([{name: "Legacy Method", source: "TGTT", type: "CTM:BON"}]);
		expect(projected.choices.skills).toEqual(["perception"]);
	});

	it("validates spell replacements against the class list and acquisition-level spell cap", () => {
		const bard = {
			name: "Bard",
			source: "PHB",
			hd: {faces: 8},
			casterProgression: "full",
			spellsKnownProgression: [4, 5],
			classFeatures: [],
		};
		const bardSpell = {name: "Dissonant Whispers", source: "PHB", level: 1, classes: {fromClassList: [{name: "Bard", source: "PHB"}]}};
		const wizardSpell = {name: "Magic Missile", source: "PHB", level: 1, classes: {fromClassList: [{name: "Wizard", source: "PHB"}]}};
		const highLevelSpell = {name: "Hypnotic Pattern", source: "PHB", level: 3, classes: {fromClassList: [{name: "Bard", source: "PHB"}]}};
		const page = {
			getClasses: () => [bard],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSpells: () => [bardSpell, wizardSpell, highLevelSpell],
		};
		const state = getState({
			classes: [{name: "Bard", source: "PHB", level: 2}],
			history: [
				{level: 1, class: {name: "Bard", source: "PHB"}, choices: {}},
				{
					level: 2,
					class: {name: "Bard", source: "PHB"},
					choices: {spellSwap: {removed: bardSpell, added: wizardSpell}},
				},
			],
		});

		const manifest = CharacterSheetProgression.buildManifest({page, state});
		const swap = manifest.decisions.find(decision => decision.type === "spellSwap");
		expect(swap.options).toEqual([bardSpell]);
		expect(swap.status).toBe("invalid");
		expect(manifest.isComplete).toBe(false);
	});

	it("checks multiclass prerequisites only when a class is first entered and uses historical ability scores", () => {
		const page = getPage();
		page.getClasses()[0].multiclassing = {requirements: {or: [{str: 13, dex: 13}]}};
		page.getClasses()[1].multiclassing = {requirements: {int: 13}};

		const singleClass = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [{name: "Fighter", source: "XPHB", level: 2}],
				history: [
					{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {}},
					{level: 2, class: {name: "Fighter", source: "XPHB"}, choices: {}},
				],
				abilityScores: {str: 8, dex: 8},
			}),
		});
		expect(singleClass.issues.some(issue => issue.code === "multiclass-prerequisite")).toBe(false);

		const multiclass = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [
					{name: "Fighter", source: "XPHB", level: 3},
					{name: "Wizard", source: "XPHB", level: 1},
				],
				history: [
					{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {}},
					{level: 2, class: {name: "Wizard", source: "XPHB"}, choices: {}},
					{level: 3, class: {name: "Fighter", source: "XPHB"}, choices: {}},
					{level: 4, class: {name: "Fighter", source: "XPHB"}, choices: {asi: {int: 2}}},
				],
				abilityScores: {str: 13, dex: 10, int: 14},
			}),
		});
		expect(multiclass.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: "multiclass-prerequisite",
				message: expect.stringContaining("historical score 12"),
			}),
		]));
		expect(multiclass.decisions.find(decision =>
			decision.type === "class" && decision.characterLevel === 2,
		)?.status).toBe("invalid");
	});
});
