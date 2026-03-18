import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;

describe("CharacterSheetRespec race/background", () => {
	/** Create a minimal respec instance with mocked dependencies */
	function makeRespec (overrides = {}) {
		const respec = Object.create(CharacterSheetRespec.prototype);

		const removedFeatures = [];
		const removedLanguages = [];
		const removedResistances = [];
		const removedSkills = [];
		const removedArmorProfs = [];
		const removedWeaponProfs = [];
		const removedToolProfs = [];
		const removedNamedMods = [];
		const addedFeatures = [];
		const addedLanguages = [];
		const addedResistances = [];
		const addedTools = [];
		const abilityBonuses = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const skills = {};
		const speed = {walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0};
		const senses = {darkvision: 0};
		let currentRace = overrides.race || null;
		let currentSubrace = overrides.subrace || null;
		let currentBackground = overrides.background || null;
		const features = overrides.features || [];
		const namedModifiers = overrides.namedModifiers || [];
		let levelHistoryUpdates = {};

		respec._state = {
			getRace: () => currentRace,
			getSubrace: () => currentSubrace,
			getRaceName: () => currentRace?.name || null,
			getBackground: () => currentBackground,
			getBackgroundName: () => currentBackground?.name || null,
			getFeatures: () => [...features],
			getNamedModifiers: () => [...namedModifiers],
			getLevelHistory: () => overrides.levelHistory || [],
			setRace: (race, subrace) => { currentRace = race; currentSubrace = subrace; },
			setBackground: (bg) => { currentBackground = bg; },
			setSpeed: (type, value) => { speed[type] = value; },
			setSense: (sense, range) => { senses[sense] = range; },
			setAbilityBonus: (abl, val) => { abilityBonuses[abl] = val; },
			getAbilityBonus: (abl) => abilityBonuses[abl] || 0,
			setSkillProficiency: (skill, level) => {
				skills[skill] = level;
				if (level === 0) removedSkills.push(skill);
			},
			addLanguage: (lang) => { addedLanguages.push(lang); },
			removeLanguage: (lang) => { removedLanguages.push(lang); },
			addResistance: (type) => { addedResistances.push(type); },
			removeResistance: (type) => { removedResistances.push(type); },
			addArmorProficiency: () => {},
			removeArmorProficiency: (a) => { removedArmorProfs.push(a); },
			addWeaponProficiency: () => {},
			removeWeaponProficiency: (w) => { removedWeaponProfs.push(w); },
			addToolProficiency: (t) => { addedTools.push(t); },
			removeToolProficiency: (t) => { removedToolProfs.push(t); },
			addNamedModifier: () => {},
			removeNamedModifier: (id) => { removedNamedMods.push(id); },
			removeFeature: (id) => { removedFeatures.push(id); },
			addFeature: (f) => { addedFeatures.push(f); },
			updateLevelChoice: (level, updates) => { levelHistoryUpdates = {level, updates}; },
		};
		respec._page = overrides.page || {
			getOptionalFeatures: () => [],
			getClassFeatures: () => [],
			getClasses: () => [],
			getRaces: () => [],
			getBackgrounds: () => [],
			filterByAllowedSources: (arr) => arr,
		};
		respec._$timeline = null;
		respec._$legacyBadge = null;

		// Expose tracking arrays for assertions
		respec._test = {
			removedFeatures,
			removedLanguages,
			removedResistances,
			removedSkills,
			removedArmorProfs,
			removedWeaponProfs,
			removedToolProfs,
			removedNamedMods,
			addedFeatures,
			addedLanguages,
			addedResistances,
			addedTools,
			abilityBonuses,
			skills,
			speed,
			senses,
			get levelHistoryUpdates () { return levelHistoryUpdates; },
			get currentRace () { return currentRace; },
			get currentBackground () { return currentBackground; },
		};

		return respec;
	}

	// region _getEditableChoices

	describe("_getEditableChoices includes race and background", () => {
		test("race appears as editable at level 1 with cascade warning", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {
					race: {name: "Elf", source: "PHB"},
				},
			};

			const editable = respec._getEditableChoices(1, history);

			const raceEdit = editable.find(e => e.type === "race");
			expect(raceEdit).toBeDefined();
			expect(raceEdit.label).toBe("Species");
			expect(raceEdit.current).toBe("Elf");
			expect(raceEdit.hasCascade).toBe(true);
		});

		test("background appears as editable at level 1 with cascade warning", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {
					background: {name: "Sage", source: "PHB"},
				},
			};

			const editable = respec._getEditableChoices(1, history);

			const bgEdit = editable.find(e => e.type === "background");
			expect(bgEdit).toBeDefined();
			expect(bgEdit.label).toBe("Background");
			expect(bgEdit.current).toBe("Sage");
			expect(bgEdit.hasCascade).toBe(true);
		});

		test("race and background do NOT appear at levels other than 1", () => {
			const respec = makeRespec();
			const history = {
				level: 4,
				class: {name: "Fighter", source: "PHB"},
				choices: {
					race: {name: "Elf", source: "PHB"},
					background: {name: "Sage", source: "PHB"},
				},
			};

			const editable = respec._getEditableChoices(4, history);

			expect(editable.find(e => e.type === "race")).toBeUndefined();
			expect(editable.find(e => e.type === "background")).toBeUndefined();
		});

		test("race does not appear if not stored in history choices", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {},
			};

			const editable = respec._getEditableChoices(1, history);

			expect(editable.find(e => e.type === "race")).toBeUndefined();
		});

		test("race and background appear before ASI/feat entries", () => {
			const respec = makeRespec({
				race: {name: "Human", source: "PHB"},
				background: {name: "Soldier", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {
					race: {name: "Human", source: "PHB"},
					background: {name: "Soldier", source: "PHB"},
					asi: {str: 2},
				},
			};

			const editable = respec._getEditableChoices(1, history);

			const types = editable.map(e => e.type);
			expect(types.indexOf("race")).toBeLessThan(types.indexOf("asi"));
			expect(types.indexOf("background")).toBeLessThan(types.indexOf("asi"));
		});
	});

	// endregion

	// region _applyRaceChange

	describe("_applyRaceChange clears old grants", () => {
		test("removes features with Species/Subrace/Race featureType", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB"},
				features: [
					{id: "f1", name: "Trance", featureType: "Species"},
					{id: "f2", name: "Keen Senses", featureType: "Species"},
					{id: "f3", name: "Drow Magic", featureType: "Subrace"},
					{id: "f4", name: "Extra Attack", featureType: "Class"},
				],
			});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedFeatures).toContain("f1");
			expect(respec._test.removedFeatures).toContain("f2");
			expect(respec._test.removedFeatures).toContain("f3");
			expect(respec._test.removedFeatures).not.toContain("f4");
		});

		test("clears old racial languages", () => {
			const respec = makeRespec({
				race: {
					name: "Elf",
					source: "PHB",
					languageProficiencies: [{common: true, elvish: true}],
				},
			});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedLanguages).toContain("Common");
			expect(respec._test.removedLanguages).toContain("Elvish");
		});

		test("clears user-chosen racial languages from history", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {
					race: {name: "Elf", source: "PHB"},
					raceUserChoices: {
						selectedLanguages: {0: ["Sylvan"]},
						selectedSubraceLanguages: ["Draconic"],
					},
				},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedLanguages).toContain("Sylvan");
			expect(respec._test.removedLanguages).toContain("Draconic");
		});

		test("clears old racial skills", () => {
			const respec = makeRespec({
				race: {
					name: "Elf",
					source: "PHB",
					skillProficiencies: [{perception: true}],
				},
			});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedSkills).toContain("perception");
		});

		test("clears old racial resistances", () => {
			const respec = makeRespec({
				race: {
					name: "Tiefling",
					source: "PHB",
					resist: ["fire"],
				},
			});
			const history = {
				level: 1,
				class: {name: "Warlock", source: "PHB"},
				choices: {race: {name: "Tiefling", source: "PHB"}},
			};
			const newRace = {name: "Human", source: "PHB", speed: 30};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedResistances).toContain("fire");
		});

		test("removes named modifiers with sourceType 'race'", () => {
			const respec = makeRespec({
				race: {name: "Aarakocra", source: "MPMM"},
				namedModifiers: [
					{id: "nm1", name: "Aarakocra Fly Speed", sourceType: "race"},
					{id: "nm2", name: "Shield +2", sourceType: "item"},
				],
			});
			const history = {
				level: 1,
				class: {name: "Monk", source: "PHB"},
				choices: {race: {name: "Aarakocra", source: "MPMM"}},
			};
			const newRace = {name: "Human", source: "PHB", speed: 30};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedNamedMods).toContain("nm1");
			expect(respec._test.removedNamedMods).not.toContain("nm2");
		});

		test("resets speed and senses", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB", speed: 30, darkvision: 60},
			});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25, darkvision: 60};

			respec._applyRaceChange(history, newRace);

			// Speed should reflect new race
			expect(respec._test.speed.walk).toBe(25);
			// Senses should reflect new race
			expect(respec._test.senses.darkvision).toBe(60);
		});

		test("clears old racial proficiencies", () => {
			const respec = makeRespec({
				race: {
					name: "Dwarf",
					source: "PHB",
					armorProficiencies: [{light: true, medium: true}],
					weaponProficiencies: [{battleaxe: true}],
					toolProficiencies: [{"smith's tools": true}],
				},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {race: {name: "Dwarf", source: "PHB"}},
			};
			const newRace = {name: "Elf", source: "PHB", speed: 30};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.removedArmorProfs).toContain("Light");
			expect(respec._test.removedArmorProfs).toContain("Medium");
			expect(respec._test.removedWeaponProfs).toContain("Battleaxe");
			expect(respec._test.removedToolProfs).toContain("Smith's Tools");
		});
	});

	describe("_applyRaceChange applies new grants", () => {
		test("sets new race on state", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.currentRace).toBe(newRace);
		});

		test("applies new fixed languages", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {
				name: "Dwarf",
				source: "PHB",
				speed: 25,
				languageProficiencies: [{common: true, dwarvish: true}],
			};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.addedLanguages).toContain("Common");
			expect(respec._test.addedLanguages).toContain("Dwarvish");
		});

		test("applies new fixed ability bonuses", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {
				name: "Dwarf",
				source: "PHB",
				speed: 25,
				ability: [{con: 2}],
			};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.abilityBonuses.con).toBe(2);
		});

		test("applies new resistances", () => {
			const respec = makeRespec({race: {name: "Human", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Human", source: "PHB"}},
			};
			const newRace = {
				name: "Tiefling",
				source: "PHB",
				speed: 30,
				resist: ["fire"],
			};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.addedResistances).toContain("fire");
		});

		test("applies new race features as entries", () => {
			const respec = makeRespec({race: {name: "Human", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Human", source: "PHB"}},
			};
			const newRace = {
				name: "Elf",
				source: "PHB",
				speed: 30,
				entries: [
					{name: "Trance", entries: ["Elves don't need to sleep..."]},
					{name: "Keen Senses", entries: ["You have proficiency..."]},
				],
			};

			respec._applyRaceChange(history, newRace);

			const addedNames = respec._test.addedFeatures.map(f => f.name);
			expect(addedNames).toContain("Trance");
			expect(addedNames).toContain("Keen Senses");
		});

		test("updates level history with new race data", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.levelHistoryUpdates.level).toBe(1);
			expect(respec._test.levelHistoryUpdates.updates.race.name).toBe("Dwarf");
			expect(respec._test.levelHistoryUpdates.updates.race.source).toBe("PHB");
		});

		test("reapplies background ability bonuses after clearing", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB"},
				background: {name: "Sage", source: "PHB", ability: [{int: 1}]},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {
					race: {name: "Elf", source: "PHB"},
					backgroundUserChoices: {
						selectedAbilityBonuses: {bg_0: "wis", bg_0_weight: 1},
					},
				},
			};
			const newRace = {name: "Human", source: "PHB", speed: 30, ability: [{str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1}]};

			respec._applyRaceChange(history, newRace);

			// Background user-chosen bonus should be reapplied
			expect(respec._test.abilityBonuses.wis).toBeGreaterThanOrEqual(1);
		});
	});

	// endregion

	// region _applyBackgroundChange

	describe("_applyBackgroundChange clears old grants", () => {
		test("removes features with Background featureType", () => {
			const respec = makeRespec({
				background: {name: "Sage", source: "PHB"},
				features: [
					{id: "bf1", name: "Researcher", featureType: "Background"},
					{id: "cf1", name: "Extra Attack", featureType: "Class"},
				],
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.removedFeatures).toContain("bf1");
			expect(respec._test.removedFeatures).not.toContain("cf1");
		});

		test("clears old background skills", () => {
			const respec = makeRespec({
				background: {
					name: "Sage",
					source: "PHB",
					skillProficiencies: [{arcana: true, history: true}],
				},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.removedSkills).toContain("arcana");
			expect(respec._test.removedSkills).toContain("history");
		});

		test("clears user-chosen background tools and languages", () => {
			const respec = makeRespec({
				background: {name: "Sage", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {
					background: {name: "Sage", source: "PHB"},
					backgroundUserChoices: {
						selectedTools: [{tool: "Disguise Kit"}],
						selectedLanguages: [{language: "Elvish"}],
					},
				},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.removedToolProfs).toContain("Disguise Kit");
			expect(respec._test.removedLanguages).toContain("Elvish");
		});
	});

	describe("_applyBackgroundChange applies new grants", () => {
		test("sets new background on state", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.currentBackground).toBe(newBg);
		});

		test("applies new background skills", () => {
			const respec = makeRespec({
				background: {name: "Sage", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {
				name: "Criminal",
				source: "PHB",
				skillProficiencies: [{deception: true, stealth: true}],
			};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.skills.deception).toBe(1);
			expect(respec._test.skills.stealth).toBe(1);
		});

		test("applies new background fixed languages", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {
				name: "Outlander",
				source: "PHB",
				languageProficiencies: [{giant: true}],
			};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.addedLanguages).toContain("Giant");
		});

		test("applies new background features", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {
				name: "Criminal",
				source: "PHB",
				entries: [
					{name: "Criminal Contact", entries: ["You have a reliable contact..."]},
				],
			};

			respec._applyBackgroundChange(history, newBg);

			const addedNames = respec._test.addedFeatures.map(f => f.name);
			expect(addedNames).toContain("Criminal Contact");
		});

		test("updates level history with new background data", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.levelHistoryUpdates.level).toBe(1);
			expect(respec._test.levelHistoryUpdates.updates.background.name).toBe("Criminal");
		});

		test("reapplies racial ability bonuses after clearing", () => {
			const respec = makeRespec({
				race: {name: "Elf", source: "PHB", ability: [{dex: 2}]},
				background: {name: "Sage", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			// Racial ability bonuses should be reapplied
			expect(respec._test.abilityBonuses.dex).toBe(2);
		});
	});

	// endregion

	// region _applyRaceChange with userChoices

	describe("_applyRaceChange applies user choices", () => {
		test("applies user-chosen languages from userChoices", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {
				name: "Half-Elf",
				source: "PHB",
				speed: 30,
				languageProficiencies: [{common: true, elvish: true, anyStandard: 1}],
			};
			const userChoices = {
				selectedLanguages: {0: ["Draconic"]},
			};

			respec._applyRaceChange(history, newRace, userChoices);

			// Fixed languages should be added
			expect(respec._test.addedLanguages).toContain("Common");
			expect(respec._test.addedLanguages).toContain("Elvish");
			// User-chosen language should be added
			expect(respec._test.addedLanguages).toContain("Draconic");
		});

		test("applies user-chosen skills from userChoices", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {
				name: "Half-Elf",
				source: "PHB",
				speed: 30,
				skillProficiencies: [{any: 2}],
			};
			const userChoices = {
				selectedSkills: ["Stealth", "Perception"],
			};

			respec._applyRaceChange(history, newRace, userChoices);

			expect(respec._test.skills.stealth).toBe(1);
			expect(respec._test.skills.perception).toBe(1);
		});

		test("applies user-chosen tools from userChoices", () => {
			const respec = makeRespec({race: {name: "Human", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Human", source: "PHB"}},
			};
			const newRace = {
				name: "Dwarf",
				source: "PHB",
				speed: 25,
				toolProficiencies: [{anyArtisansTool: 1}],
			};
			const userChoices = {
				selectedTools: ["Smith's Tools"],
			};

			respec._applyRaceChange(history, newRace, userChoices);

			expect(respec._test.addedTools).toContain("Smith's Tools");
		});

		test("applies user-chosen ability bonuses from userChoices", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {
				name: "Half-Elf",
				source: "PHB",
				speed: 30,
				ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 2, amount: 1}}],
			};
			const userChoices = {
				selectedAbilityChoices: {rc_0: "dex", rc_0_weight: 1, rc_1: "con", rc_1_weight: 1},
			};

			respec._applyRaceChange(history, newRace, userChoices);

			// Fixed +2 CHA
			expect(respec._test.abilityBonuses.cha).toBe(2);
			// User-chosen +1 DEX and +1 CON
			expect(respec._test.abilityBonuses.dex).toBe(1);
			expect(respec._test.abilityBonuses.con).toBe(1);
		});

		test("stores userChoices in level history", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Ranger", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Half-Elf", source: "PHB", speed: 30};
			const userChoices = {
				selectedLanguages: {0: ["Draconic"]},
				selectedSkills: ["Stealth"],
			};

			respec._applyRaceChange(history, newRace, userChoices);

			const stored = respec._test.levelHistoryUpdates.updates.raceUserChoices;
			expect(stored.selectedLanguages).toEqual({0: ["Draconic"]});
			expect(stored.selectedSkills).toEqual(["Stealth"]);
		});

		test("works with empty userChoices (backward compatible)", () => {
			const respec = makeRespec({race: {name: "Elf", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Fighter", source: "PHB"},
				choices: {race: {name: "Elf", source: "PHB"}},
			};
			const newRace = {name: "Dwarf", source: "PHB", speed: 25};

			respec._applyRaceChange(history, newRace);

			expect(respec._test.levelHistoryUpdates.updates.raceUserChoices).toEqual({});
		});
	});

	// endregion

	// region _applyBackgroundChange with userChoices

	describe("_applyBackgroundChange applies user choices", () => {
		test("applies user-chosen languages from userChoices", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {
				name: "Noble",
				source: "PHB",
				languageProficiencies: [{anyStandard: 1}],
			};
			const userChoices = {
				selectedLanguages: ["Elvish"],
			};

			respec._applyBackgroundChange(history, newBg, userChoices);

			expect(respec._test.addedLanguages).toContain("Elvish");
		});

		test("applies user-chosen tools from userChoices", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {
				name: "Criminal",
				source: "PHB",
				toolProficiencies: [{any: 1}],
			};
			const userChoices = {
				selectedTools: ["Thieves' Tools"],
			};

			respec._applyBackgroundChange(history, newBg, userChoices);

			expect(respec._test.addedTools).toContain("Thieves' Tools");
		});

		test("applies user-chosen weighted ability bonuses from userChoices", () => {
			const respec = makeRespec({
				race: {name: "Human", source: "XPHB"},
				background: {name: "Sage", source: "XPHB"},
			});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "XPHB"}},
			};
			const newBg = {
				name: "Noble",
				source: "XPHB",
				ability: [{choose: {weighted: {from: ["str", "dex", "con", "int", "wis", "cha"], weights: [2, 1]}}}],
			};
			const userChoices = {
				selectedAbilityBonuses: {bg_0: "int", bg_0_weight: 2, bg_1: "wis", bg_1_weight: 1},
			};

			respec._applyBackgroundChange(history, newBg, userChoices);

			expect(respec._test.abilityBonuses.int).toBe(2);
			expect(respec._test.abilityBonuses.wis).toBe(1);
		});

		test("stores userChoices in correct background format", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};
			const userChoices = {
				selectedLanguages: ["Elvish"],
				selectedTools: ["Disguise Kit"],
				selectedAbilityBonuses: {bg_0: "str", bg_0_weight: 2},
			};

			respec._applyBackgroundChange(history, newBg, userChoices);

			const stored = respec._test.levelHistoryUpdates.updates.backgroundUserChoices;
			// Languages stored as [{language: "..."}]
			expect(stored.selectedLanguages).toEqual([{language: "Elvish"}]);
			// Tools stored as [{tool: "..."}]
			expect(stored.selectedTools).toEqual([{tool: "Disguise Kit"}]);
			// Ability bonuses stored as-is
			expect(stored.selectedAbilityBonuses).toEqual({bg_0: "str", bg_0_weight: 2});
		});

		test("works with empty userChoices (backward compatible)", () => {
			const respec = makeRespec({background: {name: "Sage", source: "PHB"}});
			const history = {
				level: 1,
				class: {name: "Wizard", source: "PHB"},
				choices: {background: {name: "Sage", source: "PHB"}},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			expect(respec._test.levelHistoryUpdates.updates.backgroundUserChoices).toEqual({});
		});
	});

	// endregion

	// region _reapplyRacialAbilityBonuses with user choices

	describe("_reapplyRacialAbilityBonuses includes user-chosen racial bonuses", () => {
		test("reapplies both fixed and user-chosen racial ability bonuses", () => {
			const respec = makeRespec({
				race: {name: "Half-Elf", source: "PHB", ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 2, amount: 1}}]},
				background: {name: "Sage", source: "PHB"},
			});
			const history = {
				level: 1,
				class: {name: "Bard", source: "PHB"},
				choices: {
					background: {name: "Sage", source: "PHB"},
					raceUserChoices: {
						selectedAbilityChoices: {rc_0: "dex", rc_0_weight: 1, rc_1: "con", rc_1_weight: 1},
					},
				},
			};
			const newBg = {name: "Criminal", source: "PHB"};

			respec._applyBackgroundChange(history, newBg);

			// Fixed +2 CHA should be reapplied
			expect(respec._test.abilityBonuses.cha).toBe(2);
			// User-chosen +1 DEX and +1 CON should also be reapplied
			expect(respec._test.abilityBonuses.dex).toBe(1);
			expect(respec._test.abilityBonuses.con).toBe(1);
		});
	});

	// endregion
});
