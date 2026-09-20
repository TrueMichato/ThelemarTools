import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;

const getPage = (opts = {}) => {
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
		getClasses: () => opts.classes || [fighter, wizard, cleric],
		getClassFeatures: () => opts.classFeatures || [
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
		getOptionalFeatures: () => opts.optionalFeatures || [],
		getFeats: () => opts.feats || [],
		getSpells: () => opts.spells || [],
		getFilteredSpellData: () => opts.spells || [],
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

const getState = ({
	classes,
	history,
	spells = [],
	cantrips = [],
	abilityScores = {},
	feats = [],
	race = null,
	background = null,
	armorProficiencies = [],
	weaponProficiencies = [],
	spellcastingAbility = null,
	features = [],
}) => ({
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
	getFeats: () => feats,
	getRace: () => race,
	getBackground: () => background,
	getArmorProficiencies: () => armorProficiencies,
	getWeaponProficiencies: () => weaponProficiencies,
	getSpellcastingAbility: () => spellcastingAbility,
	getSpellcastingAbilityForClass: () => spellcastingAbility,
	getFeatureCalculations: () => ({hasSpellcasting: !!spellcastingAbility}),
	getFeatures: () => features,
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

	it("surfaces skipped class feat-progression choices and filters illegal feats", () => {
		const fighter = {
			name: "Fighter",
			source: "XPHB",
			hd: {faces: 10},
			featProgression: [{name: "Fighting Style", category: ["FS"], progression: {"1": 1}}],
			classFeatures: ["Second Wind|Fighter|XPHB|1"],
		};
		const page = getPage({
			classes: [fighter],
			classFeatures: [{name: "Second Wind", source: "XPHB", className: "Fighter", classSource: "XPHB", level: 1, entries: []}],
			feats: [
				{name: "Defense", source: "XPHB", category: "FS"},
				{name: "Advanced Style", source: "TGTT", category: "FS", prerequisite: [{level: 4}]},
				{name: "Alert", source: "XPHB", category: "G"},
			],
		});
		const manifest = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [{name: "Fighter", source: "XPHB", level: 1}],
				history: [{level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {}}],
			}),
		});
		const choice = manifest.decisions.find(it => it.type === "classFeatProgressionFeat");

		expect(choice).toMatchObject({
			characterLevel: 1,
			label: "Fighting Style",
			status: "missing",
			count: 1,
		});
		expect(choice.options.map(it => it.name)).toEqual(["Defense"]);
	});

	it("derives Wizard spellbook/cantrip and prepared-caster permanent spell opportunities", () => {
		const page = getPage();
		const wizardHistory = [
			{level: 1, class: {name: "Wizard", source: "XPHB"}, choices: {}, complete: true, manifestComplete: true},
			{level: 2, class: {name: "Wizard", source: "XPHB"}, choices: {}, complete: true, manifestComplete: true},
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
					{level: 1, class: {name: "Cleric", source: "XPHB"}, choices: {}, complete: true, manifestComplete: true},
					{level: 2, class: {name: "Cleric", source: "XPHB"}, choices: {}, complete: true, manifestComplete: true},
				],
			}),
		});
		expect(clericManifest.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "preparedSpells", characterLevel: 1, count: 4, status: "missing"}),
			expect.objectContaining({type: "preparedSpells", characterLevel: 2, count: 1, status: "missing"}),
		]));
	});

	it("defers only wholly untracked legacy spell progressions", () => {
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {faces: 8},
			casterProgression: "full",
			spellcastingAbility: "cha",
			cantripProgression: [2, 2],
			preparedSpellsProgression: [4, 5],
			classFeatures: [],
		};
		const page = getPage({classes: [bard], classFeatures: []});
		const legacyState = getState({
			classes: [{name: "Bard", source: "TGTT", level: 2}],
			history: [
				{level: 1, class: {name: "Bard", source: "TGTT"}, choices: {}},
				{level: 2, class: {name: "Bard", source: "TGTT"}, choices: {}},
			],
			spellcastingAbility: "cha",
		});

		const legacyManifest = CharacterSheetProgression.buildManifest({page, state: legacyState});
		const deferred = legacyManifest.decisions.filter(it => ["knownSpells", "cantrips"].includes(it.type));
		expect(deferred).not.toHaveLength(0);
		expect(deferred.every(decision =>
			decision.required === false
				&& decision.status === "deferred"
				&& decision.meta?.legacyUntracked === true,
		)).toBe(true);

		const partiallyTrackedState = getState({
			classes: [{name: "Bard", source: "TGTT", level: 2}],
			history: legacyState.getLevelHistory(),
			cantrips: [{name: "Vicious Mockery", source: "XPHB", level: 0, sourceClass: "Bard"}],
			spellcastingAbility: "cha",
		});
		const partiallyTracked = CharacterSheetProgression.buildManifest({page, state: partiallyTrackedState});
		expect(partiallyTracked.decisions.filter(it => it.type === "knownSpells"))
			.toEqual(expect.arrayContaining([expect.objectContaining({required: true, status: "missing"})]));
	});

	it("reconstructs a legal aggregate spell history for a single legacy caster", () => {
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {faces: 8},
			casterProgression: "full",
			spellcastingAbility: "cha",
			cantripProgression: [0, 0, 0],
			spellsKnownProgression: [2, 3, 4],
			classFeatures: [
				"Spellcasting|Bard|TGTT|1",
				"Bard Feature|Bard|TGTT|2",
				"Bard Feature|Bard|TGTT|3",
			],
		};
		const fighter = {
			name: "Fighter",
			source: "XPHB",
			hd: {faces: 10},
			classFeatures: [],
		};
		const spells = [
			{name: "Low A", source: "TGTT", level: 1, classes: {fromClassList: [{name: "Bard", source: "TGTT"}]}},
			{name: "Low B", source: "TGTT", level: 1, classes: {fromClassList: [{name: "Bard", source: "TGTT"}]}},
			{name: "Low C", source: "TGTT", level: 1, classes: {fromClassList: [{name: "Bard", source: "TGTT"}]}},
			{name: "High", source: "TGTT", level: 2, classes: {fromClassList: [{name: "Bard", source: "TGTT"}]}},
		];
		const page = getPage({
			classes: [bard, fighter],
			classFeatures: bard.classFeatures.map((uid, ix) => ({
				name: uid.split("|")[0],
				source: "TGTT",
				className: "Bard",
				classSource: "TGTT",
				level: ix + 1,
				entries: [],
			})),
			spells,
		});
		const manifest = CharacterSheetProgression.buildManifest({
			page,
			state: getState({
				classes: [
					{name: "Bard", source: "TGTT", level: 3},
					{name: "Fighter", source: "XPHB", level: 1},
				],
				history: [
					...[1, 2, 3].map(level => ({
						level,
						class: {name: "Bard", source: "TGTT"},
						choices: {},
					})),
					{level: 4, class: {name: "Fighter", source: "XPHB"}, choices: {}},
				],
				spells: [spells[3], spells[2], spells[0], spells[1]],
				spellcastingAbility: "cha",
			}),
		});

		const choices = manifest.decisions.filter(it => it.type === "knownSpells");
		expect(choices).toHaveLength(3);
		expect(choices.map(it => it.status)).toEqual(["resolved", "resolved", "resolved"]);
		expect(choices[0].selection.map(it => it.name)).toEqual(["Low A", "Low B"]);
		expect(choices[1].selection.map(it => it.name)).toEqual(["Low C"]);
		expect(choices[2].selection.map(it => it.name)).toEqual(["High"]);
	});

	it("reconstructs gain slots from the pre-swap spell pool", () => {
		const bard = {
			name: "Bard",
			source: "PHB",
			hd: {faces: 8},
			casterProgression: "full",
			spellcastingAbility: "cha",
			cantripProgression: [0, 0],
			spellsKnownProgression: [4, 5],
			classFeatures: [],
		};
		const spells = ["A", "B", "C", "D", "E", "F"].map(name => ({
			name,
			source: "PHB",
			level: 1,
			classes: {fromClassList: [{name: "Bard", source: "PHB"}]},
		}));
		const [spellA, spellB, spellC, spellD, spellE, spellF] = spells;
		const history = [
			{level: 1, class: {name: "Bard", source: "PHB"}, choices: {}},
			{
				level: 2,
				class: {name: "Bard", source: "PHB"},
				choices: {spellSwap: {removed: spellA, added: spellE}},
			},
		];
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage({classes: [bard], classFeatures: [], spells}),
			state: getState({
				classes: [{name: "Bard", source: "PHB", level: 2}],
				history,
				spells: [spellB, spellC, spellD, spellE, spellF].map(spell => ({
					...spell,
					sourceClass: "Bard",
					sourceFeature: "Spells Known",
				})),
				spellcastingAbility: "cha",
			}),
		});

		const gains = manifest.decisions.filter(it => it.type === "knownSpells");
		expect(gains[0].selection.map(it => it.name)).toEqual(["A", "B", "C", "D"]);
		expect(gains[1].selection.map(it => it.name)).toEqual(["F"]);
		expect(manifest.decisions.find(it => it.type === "spellSwap")?.selection).toMatchObject({
			removed: {name: "A"},
			added: {name: "E"},
		});
	});

	it("does not reconstruct feat-granted spells as class spell choices", () => {
		const bard = {
			name: "Bard",
			source: "PHB",
			hd: {faces: 8},
			casterProgression: "full",
			spellcastingAbility: "cha",
			cantripProgression: [2],
			spellsKnownProgression: [0],
			classFeatures: [],
		};
		const spells = [
			{name: "Dancing Lights", source: "PHB", level: 0, classes: {fromClassList: [{name: "Bard", source: "PHB"}]}},
			{name: "Vicious Mockery", source: "PHB", level: 0, classes: {fromClassList: [{name: "Bard", source: "PHB"}]}},
			{name: "Mage Hand", source: "PHB", level: 0, classes: {fromClassList: [{name: "Wizard", source: "PHB"}]}},
		];
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage({classes: [bard], classFeatures: [], spells}),
			state: getState({
				classes: [{name: "Bard", source: "PHB", level: 1}],
				history: [{level: 1, class: {name: "Bard", source: "PHB"}, choices: {}}],
				cantrips: [
					{...spells[0], sourceClass: "Bard", sourceFeature: "Cantrips Known"},
					{...spells[1], sourceClass: "Bard", sourceFeature: "Cantrips Known"},
					{...spells[2], sourceFeature: "Telekinetic", fromFeat: "Telekinetic"},
				],
				spellcastingAbility: "cha",
			}),
		});

		expect(manifest.decisions.find(it => it.type === "cantrips")?.selection.map(it => it.name))
			.toEqual(["Dancing Lights", "Vicious Mockery"]);
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

	it("derives level-19 ASI and feat opportunities from class data", () => {
		const makeHistory = source => Array.from({length: 19}, (_, ix) => ({
			level: ix + 1,
			class: {name: "Bard", source},
			choices: ix === 18 ? {asi: {cha: 2}} : {},
			complete: true,
		}));
		const makeClass = ({source, level19Feature, featProgression}) => ({
			name: "Bard",
			source,
			hd: {faces: 8},
			spellcastingAbility: "cha",
			classFeatures: Array.from({length: 19}, (_, ix) => ix === 18 ? [level19Feature] : []),
			...(featProgression ? {featProgression} : {}),
		});
		const phbClass = makeClass({
			source: "PHB",
			level19Feature: "Ability Score Improvement|Bard|PHB|19",
		});
		const tgttClass = makeClass({
			source: "TGTT",
			level19Feature: "Epic Boon|Bard|TGTT|19",
			featProgression: [{
				name: "Epic Boon",
				category: ["EB"],
				progression: {"19": 1},
			}],
		});
		const feats = [
			{name: "Boon of Spell Recall", source: "XPHB", category: "EB", prerequisite: [{level: 19, spellcasting2020: true}]},
			{name: "Actor", source: "XPHB", category: "G", prerequisite: [{level: 4, ability: [{cha: 13}]}]},
			{name: "Athlete", source: "XPHB", category: "G", prerequisite: [{level: 4, ability: [{str: 13}]}, {level: 4, ability: [{dex: 13}]}]},
		];

		const phbManifest = CharacterSheetProgression.buildManifest({
			page: getPage({classes: [phbClass], feats}),
			state: getState({
				classes: [{name: "Bard", source: "PHB", level: 19}],
				history: makeHistory("PHB"),
				abilityScores: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16},
				spellcastingAbility: "cha",
			}),
		});
		expect(phbManifest.decisions.find(decision => decision.characterLevel === 19 && decision.type === "asiOrFeat")).toMatchObject({
			selection: {mode: "asi", asi: {cha: 2}},
			status: "resolved",
		});

		const tgttManifest = CharacterSheetProgression.buildManifest({
			page: getPage({classes: [tgttClass], feats}),
			state: getState({
				classes: [{name: "Bard", source: "TGTT", level: 19}],
				history: makeHistory("TGTT"),
				abilityScores: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16},
				spellcastingAbility: "cha",
			}),
		});
		const tgttDecision = tgttManifest.decisions.find(decision => decision.characterLevel === 19 && decision.type === "feat");
		expect(tgttDecision).toMatchObject({
			label: "Epic Boon or Qualifying Feat",
			selection: {legacyAsi: {cha: 2}, mode: "asi"},
			status: "invalid",
		});
		expect(tgttDecision.options.map(option => option.name)).toEqual(["Boon of Spell Recall", "Actor"]);
		expect(tgttManifest.unresolved).toContain(tgttDecision);
	});

	it("registers a complete adapter contract for every emitted decision", () => {
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage(),
			state: getState({
				classes: [{name: "Fighter", source: "XPHB", level: 1}],
				history: [{
					level: 1,
					class: {name: "Fighter", source: "XPHB"},
					choices: {skills: ["Athletics", "Perception"], hpRoll: 10},
				}],
			}),
		});

		for (const decision of manifest.decisions) {
			expect(CharacterSheetProgression.getDecisionAdapter(decision.type)).toEqual(expect.objectContaining({
				discovery: expect.any(String),
				editor: expect.any(String),
				validation: expect.any(String),
				mechanics: expect.any(String),
				projection: expect.any(Array),
			}));
		}
	});

	it("derives cumulative optional-feature slots from progression deltas instead of final state", () => {
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {faces: 8},
			classFeatures: [],
			optionalfeatureProgression: [{
				name: "Jester's Acts",
				featureType: ["JA"],
				progression: {"3": 2, "5": 3},
			}],
		};
		const history = Array.from({length: 5}, (_, ix) => ({
			level: ix + 1,
			class: {name: "Bard", source: "TGTT"},
			choices: ix === 2
				? {optionalFeatures: [
					{name: "Mocking Flourish", source: "TGTT", type: "JA"},
					{name: "Pratfall", source: "TGTT", type: "JA"},
				]}
				: {},
		}));
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage({
				classes: [bard],
				feats: [],
				classFeatures: [],
			}),
			state: getState({
				classes: [{name: "Bard", source: "TGTT", level: 5}],
				history,
				features: [
					{name: "Mocking Flourish", featureType: "Optional Feature", optionalFeatureTypes: ["JA"]},
					{name: "Pratfall", featureType: "Optional Feature", optionalFeatureTypes: ["JA"]},
				],
			}),
		});
		const actDecisions = manifest.decisions.filter(decision => decision.type === "optionalFeatures");

		expect(actDecisions).toEqual([
			expect.objectContaining({
				characterLevel: 3,
				count: 2,
				status: "resolved",
				selection: [
					expect.objectContaining({name: "Mocking Flourish"}),
					expect.objectContaining({name: "Pratfall"}),
				],
			}),
			expect.objectContaining({
				characterLevel: 5,
				count: 1,
				status: "missing",
				selection: null,
				meta: expect.objectContaining({countBefore: 2, countAfter: 3}),
			}),
		]);
	});

	it("marks historical optional-feature selections invalid when their prerequisites were not met", () => {
		const warlock = {
			name: "Warlock",
			source: "XPHB",
			hd: {faces: 8},
			classFeatures: [],
			optionalfeatureProgression: [{
				name: "Eldritch Invocations",
				featureType: ["EI"],
				progression: {"1": 1},
			}],
		};
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage({
				classes: [warlock],
				classFeatures: [],
				optionalFeatures: [
					{name: "Pact of the Blade", source: "XPHB", featureType: ["EI"]},
					{
						name: "Thirsting Blade",
						source: "XPHB",
						featureType: ["EI"],
						prerequisite: [
							{level: {level: 5, class: {name: "Warlock"}}},
							{pact: "Blade"},
						],
					},
				],
			}),
			state: getState({
				classes: [{name: "Warlock", source: "XPHB", level: 1}],
				history: [{
					level: 1,
					class: {name: "Warlock", source: "XPHB"},
					choices: {optionalFeatures: [{name: "Thirsting Blade", source: "XPHB", type: "EI"}]},
				}],
				features: [],
			}),
		});
		const decision = manifest.decisions.find(it => it.type === "optionalFeatures");

		expect(decision.status).toBe("invalid");
		expect(decision.options.find(it => it.name === "Pact of the Blade")).toMatchObject({_selectable: true});
		expect(decision.options.find(it => it.name === "Thirsting Blade")).toMatchObject({
			_selectable: false,
			_meetsPrereqs: false,
		});
	});

	it("evaluates historical feat prerequisites before later ASIs", () => {
		const fighter = {
			name: "Fighter",
			source: "XPHB",
			hd: {faces: 10},
			classFeatures: [
				...Array.from({length: 3}, () => []),
				["Ability Score Improvement|Fighter|XPHB|4"],
				...Array.from({length: 3}, () => []),
				["Ability Score Improvement|Fighter|XPHB|8"],
			],
		};
		const athlete = {
			name: "Athlete",
			source: "XPHB",
			category: "G",
			prerequisite: [{level: 4, ability: [{str: 13}]}],
		};
		const manifest = CharacterSheetProgression.buildManifest({
			page: getPage({classes: [fighter], classFeatures: [], feats: [athlete]}),
			state: getState({
				classes: [{name: "Fighter", source: "XPHB", level: 8}],
				history: Array.from({length: 8}, (_, ix) => ({
					level: ix + 1,
					class: {name: "Fighter", source: "XPHB"},
					choices: ix === 7 ? {asi: {str: 2}} : {},
				})),
				abilityScores: {str: 14},
			}),
		});

		expect(manifest.decisions.find(it => it.characterLevel === 4 && it.type === "asiOrFeat")?.options)
			.not.toEqual(expect.arrayContaining([expect.objectContaining({name: "Athlete"})]));
	});

	it("resolves feat-category prerequisites from the catalog for legacy stored feats", () => {
		const dragonmark = {name: "Mark of Making", source: "TGTT", category: "D"};
		const potent = {
			name: "Potent Dragonmark",
			source: "TGTT",
			category: "G",
			prerequisite: [{featCategory: ["D"]}],
		};
		const eligible = globalThis.CharacterSheetClassUtils.getEligibleFeats(
			[dragonmark, potent],
			getState({
				classes: [{name: "Fighter", source: "XPHB", level: 4}],
				history: [],
				feats: [{name: "Mark of Making", source: "TGTT"}],
			}),
		);

		expect(eligible.map(it => it.name)).toContain("Potent Dragonmark");
	});
});
