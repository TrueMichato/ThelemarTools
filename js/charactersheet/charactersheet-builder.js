/**
 * Character Sheet Builder
 * Step-by-step character creation wizard
 */
class CharacterSheetBuilder {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._currentStep = 1;
		this._maxSteps = 7;

		this._selectedRace = null;
		this._selectedSubrace = null;
		this._selectedClass = null;
		this._selectedSubclass = null;
		this._selectedBackground = null;
		this._abilityMethod = "standard";
		// Initialize with null for standard array mode (user must assign scores)
		this._abilityScores = {str: null, dex: null, con: null, int: null, wis: null, cha: null};
		this._standardArrayPool = [15, 14, 13, 12, 10, 8]; // Initialize pool for standard array
		this._pointBuyRemaining = 27;
		this._selectedSkills = []; // For class skill proficiency choices
		this._selectedExpertise = []; // For class expertise choices (Rogue, Bard)
		this._selectedWeaponMasteries = []; // For weapon mastery choices (Fighter, Paladin, Ranger, Rogue)
		this._selectedAbilityBonuses = {}; // For background ASI choices
		this._selectedOptionalFeatures = {}; // For class optional features like invocations {featureType: [features]}
		this._selectedToolProficiencies = []; // For background tool proficiency choices
		this._selectedLanguages = []; // For background language choices
		this._selectedClassFeatureLanguages = []; // For class feature language choices (like Deft Explorer)
		this._selectedFeatureOptions = {}; // For class/subclass features with embedded options (like Specialties)
		this._selectedFeatureSkillChoices = {}; // For specialty features that require skill/expertise choices
		this._selectedRaceOptionalFeatures = {}; // For race-level optional feature choices (e.g., Nyuidj Dreamwalker Ability)
		this._selectedCombatTraditions = []; // For combat tradition proficiency choices (Thelemar homebrew)
		this._selectedClassToolProficiencies = []; // For class tool proficiency choices (e.g., Monk artisan/instrument)
		this._lastAppliedClassSnapshot = null; // Snapshot of what case 3 applied; used to undo on class change
		this._selectedRacialSkills = []; // For racial skill proficiency choices (e.g., Elf)
		this._selectedRacialTools = []; // For racial tool proficiency choices (e.g., Dwarf)
		this._selectedRacialLanguages = {}; // For racial language proficiency choices, keyed by profIdx
		this._selectedSubraceLanguages = []; // For subrace language proficiency choices (e.g., Hub Residence Trilingual)
		this._selectedRacialAbilityChoices = {}; // For races with choose-based ASI (TGTT races)
		this._selectedRacialAbilitySetIdx = {}; // For races with multiple ability options (VRGR lineage): which option is selected
		this._selectedRacialSpells = []; // For racial spell choices (e.g., Child of the Empire cantrip)
		this._selectedRacialSpellAbilities = {}; // For racial spell ability choices (e.g., Child of the Empire INT/WIS/CHA)
		this._useTashasRules = false; // For Tasha's Custom Origin rules - reassign racial ASI
		this._tashasAbilityBonuses = {}; // Stores custom ASI when using Tasha's rules
		this._tashasSkillReplacements = []; // Stores replacement skill proficiencies when using Tasha's rules
		this._tashasLanguageReplacements = []; // Stores replacement languages when using Tasha's rules
		this._customBackground = null; // Stores custom background object
		this._customBackgroundData = null; // Stores custom background form data
		this._selectedKnownSpells = []; // For known-caster spell choices at level 1
		this._selectedKnownCantrips = []; // For known-caster cantrip choices at level 1
		this._selectedSpellbookSpells = []; // For Wizard spellbook spell choices at level 1
		this._divineSoulAffinity = null; // Stored Divine Soul affinity choice for spell access and bonus spell
		this._quickBuildTargetLevel = 1; // Target level for Quick Build integration

		this._init();
	}

	// Helper to detect if content is from 2024 edition (D&D One)
	_is2024Edition (entity) {
		if (!entity) return false;
		// 2024 content has "edition": "one" or source "XPHB"
		return entity.edition === "one" || entity.source === "XPHB";
	}

	// Check if race uses 2024 ASI rules (ASI comes from background, not race)
	_raceUses2024ASI () {
		if (!this._selectedRace) return false;
		// Only 2024 species (XPHB) truly have no ASI from race
		// Races with ability: [{choose: ...}] are NOT 2024 — they have choose-based ASI
		if (this._is2024Edition(this._selectedRace)) return true;
		if (!this._selectedRace.ability) return true;
		// If race only has choose entries, it still provides ASI (just player chooses)
		return false;
	}

	// Check if background provides ASI (2024 backgrounds)
	_backgroundProvidesASI () {
		if (!this._selectedBackground) return false;
		return !!(this._selectedBackground.ability && this._selectedBackground.ability.length);
	}

	/**
	 * Find entries of type "options" in a feature's entries array
	 * These represent choices the player must make (like Specialties)
	 * @param {Object} feature - The feature object with entries
	 * @param {number} characterLevel - Current character level for filtering
	 * @returns {Array} Array of {count, options} objects
	 */
	_findFeatureOptions (feature, characterLevel = 1) {
		if (!feature?.entries) return [];

		const results = [];

		const searchEntries = (entries) => {
			if (!Array.isArray(entries)) return;

			for (const entry of entries) {
				if (typeof entry === "object" && entry.type === "options") {
					// Found an options entry
					const count = entry.count || 1;
					const options = [];

					// Process the option entries
					if (entry.entries) {
						for (const opt of entry.entries) {
							if (opt.type === "refClassFeature" && opt.classFeature) {
								// Parse "FeatureName|ClassName|Source|Level" format
								const parts = opt.classFeature.split("|");
								const optLevel = parseInt(parts[3]) || 1;

								// Only include options available at current level
								if (optLevel <= characterLevel) {
									options.push({
										name: parts[0],
										className: parts[1],
										source: parts[2],
										level: optLevel,
										type: "classFeature",
										ref: opt.classFeature,
									});
								}
							} else if (opt.type === "refSubclassFeature" && opt.subclassFeature) {
								const parts = opt.subclassFeature.split("|");
								const optLevel = parseInt(parts[5]) || 1;

								if (optLevel <= characterLevel) {
									options.push({
										name: parts[0],
										className: parts[1],
										classSource: parts[2],
										subclassShortName: parts[3],
										subclassSource: parts[4],
										level: optLevel,
										type: "subclassFeature",
										ref: opt.subclassFeature,
									});
								}
							} else if (opt.type === "refOptionalfeature" && opt.optionalfeature) {
								options.push({
									name: opt.optionalfeature.split("|")[0],
									source: opt.optionalfeature.split("|")[1],
									type: "optionalfeature",
									ref: opt.optionalfeature,
								});
							} else if (typeof opt === "string") {
								options.push({
									name: opt,
									type: "text",
								});
							}
						}
					}

					if (options.length > 0) {
						results.push({count, options, featureName: feature.name});
					}
				}

				// Recursively search nested entries
				if (entry.entries) {
					searchEntries(entry.entries);
				}

				// Check for features that reference another feature's options via {@classFeature ...}
				if (typeof entry === "string") {
					const refMatch = entry.match(/\{@classFeature\s+([^}]+)\}/);
					if (refMatch && /another|additional|gain/i.test(entry)) {
						const refParts = refMatch[1].split("|");
						const refFeatureName = refParts[0];
						const refClassName = refParts[1];
						const refSource = refParts[2];
						const refLevel = parseInt(refParts[3]) || 1;

						const referencedFeature = this._getClassFeatureData(refFeatureName, refClassName, refSource, refLevel);
						if (referencedFeature) {
							const refResults = this._findFeatureOptions(referencedFeature, characterLevel);
							for (const refResult of refResults) {
								results.push({
									count: 1,
									options: refResult.options,
									featureName: feature.name,
									referencedFrom: refMatch[1],
								});
							}
						}
					}
				}
			}
		};

		searchEntries(feature.entries);
		return results;
	}

	/**
	 * Get the full feature data for a class feature reference
	 * @param {string} featureRef - "FeatureName|ClassName|Source|Level" format
	 * @returns {Object|null} The feature object or null
	 */
	_getClassFeatureDataFromRef (featureRef) {
		const parts = featureRef.split("|");
		const [name, className, source, level] = parts;
		const parsedLevel = parseInt(level) || 1;

		return this._getClassFeatureData(name, className, source, parsedLevel);
	}

	_init () {
		this._initStepClickHandlers();
		this._initNavButtons();
		this._renderCurrentStep();
	}

	_initStepClickHandlers () {
		document.querySelectorAll(".charsheet__builder-step").forEach(el => {
			el.addEventListener("click", (e) => {
				const step = parseInt(e.currentTarget.dataset.step);
				if (step <= this._currentStep) {
					this._goToStep(step);
				}
			});
		});
	}

	_initNavButtons () {
		document.getElementById("charsheet-builder-prev").addEventListener("click", () => this._prevStep());
		document.getElementById("charsheet-builder-next").addEventListener("click", () => this._nextStep());
	}

	_updateStepIndicators () {
		document.querySelectorAll(".charsheet__builder-step").forEach(el => {
			const stepNum = parseInt(el.dataset.step);

			el.classList.remove("active", "completed");

			if (stepNum === this._currentStep) {
				el.classList.add("active");
			} else if (stepNum < this._currentStep) {
				el.classList.add("completed");
			}
		});

		// Update nav buttons
		document.getElementById("charsheet-builder-prev").disabled = this._currentStep <= 1;
		const nextBtn = document.getElementById("charsheet-builder-next");

		if (this._currentStep >= this._maxSteps) {
			nextBtn.innerHTML = `<span class="glyphicon glyphicon-ok"></span> Finish`;
		} else {
			nextBtn.innerHTML = `Next <span class="glyphicon glyphicon-chevron-right"></span>`;
		}
	}

	_goToStep (step) {
		this._currentStep = step;
		this._updateStepIndicators();
		this._renderCurrentStep();
	}

	_prevStep () {
		if (this._currentStep > 1) {
			this._goToStep(this._currentStep - 1);
		}
	}

	async _nextStep () {
		// Validate current step before proceeding
		if (!this._validateCurrentStep()) return;

		// Apply current step's choices
		this._applyCurrentStep();

		if (this._currentStep >= this._maxSteps) {
			// Finish character creation
			await this._finishCharacter();
		} else {
			this._goToStep(this._currentStep + 1);
		}
	}

	_validateCurrentStep () {
		switch (this._currentStep) {
			case 1: // Race
				if (!this._selectedRace) {
					JqueryUtil.doToast({type: "warning", content: "Please select a species."});
					return false;
				}
				// Validate racial skill proficiency choices
				if (this._selectedRace.skillProficiencies) {
					const requiredSkillCount = this._getRacialSkillChoiceCount(this._selectedRace);
					if (requiredSkillCount > 0 && this._selectedRacialSkills.length < requiredSkillCount) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${requiredSkillCount} racial skill proficienc${requiredSkillCount > 1 ? "ies" : "y"}.`});
						return false;
					}
				}
				// Validate racial tool proficiency choices
				if (this._selectedRace.toolProficiencies) {
					const requiredToolCount = this._getRacialToolChoiceCount(this._selectedRace);
					if (requiredToolCount > 0 && this._selectedRacialTools.length < requiredToolCount) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${requiredToolCount} racial tool proficienc${requiredToolCount > 1 ? "ies" : "y"}.`});
						return false;
					}
				}
				return true;

			case 2: // Background
				if (!this._selectedBackground) {
					JqueryUtil.doToast({type: "warning", content: "Please select a background."});
					return false;
				}
				return true;

			case 3: // Class
				if (!this._selectedClass) {
					JqueryUtil.doToast({type: "warning", content: "Please select a class."});
					return false;
				}
				// Validate skill selection if class has skill choices
				if (this._selectedClass.startingProficiencies?.skills) {
					const skillChoices = this._selectedClass.startingProficiencies.skills;
					let requiredCount = 2;
					skillChoices.forEach(sc => {
						if (sc.choose?.count) requiredCount = sc.choose.count;
						if (sc.any) requiredCount = sc.any;
					});
					if (this._selectedSkills.length < requiredCount) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${requiredCount} skills for your class.`});
						return false;
					}
				}
				// Validate expertise selection if class has expertise at early levels (1-2)
				const expertiseInfo = this._getClassExpertiseInfoEarlyLevels(this._selectedClass);
				if (expertiseInfo && expertiseInfo.count > 0) {
					if (this._selectedExpertise.length < expertiseInfo.count) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${expertiseInfo.count} skills for expertise.`});
						return false;
					}
				}
				// Validate class feature language selection (like Deft Explorer)
				const classLangInfo = this._getClassFeatureLanguageGrants(this._selectedClass);
				if (classLangInfo && classLangInfo.count > 0) {
					const selectedCount = this._selectedClassFeatureLanguages.filter(l => l).length;
					if (selectedCount < classLangInfo.count) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${classLangInfo.count} languages from ${classLangInfo.featureName}.`});
						return false;
					}
				}
				// Validate weapon mastery selection if class has weapon mastery at level 1
				const masteryInfo = this._getClassWeaponMasteryInfo(this._selectedClass, 1);
				if (masteryInfo && masteryInfo.count > 0) {
					if (this._selectedWeaponMasteries.length < masteryInfo.count) {
						JqueryUtil.doToast({type: "warning", content: `Please select ${masteryInfo.count} weapon masteries.`});
						return false;
					}
				}
				// Validate optional feature selection (invocations, metamagic, combat methods, etc.)
				if (this._selectedClass.optionalfeatureProgression?.length) {
					const optFeatValidation = this._validateOptionalFeatureSelections(this._selectedClass);
					if (!optFeatValidation.valid) {
						JqueryUtil.doToast({type: "warning", content: optFeatValidation.message});
						return false;
					}
				}
				// Validate feature options selection (specialties, etc.)
				const featureOptionsValidation = this._validateFeatureOptionSelections(this._selectedClass, 1);
				if (!featureOptionsValidation.valid) {
					JqueryUtil.doToast({type: "warning", content: featureOptionsValidation.message});
					return false;
				}
				return true;

			case 4: // Abilities
				if (this._abilityMethod === "pointbuy" && this._pointBuyRemaining !== 0) {
					JqueryUtil.doToast({type: "warning", content: "Please spend all ability score points."});
					return false;
				}
				if (this._abilityMethod === "standard") {
					const unassigned = Parser.ABIL_ABVS.filter(abl => this._abilityScores[abl] == null);
					if (unassigned.length > 0) {
						JqueryUtil.doToast({type: "warning", content: "Please assign all ability scores from the standard array."});
						return false;
					}
				}
				// Validate Tasha's Custom Origin choices if enabled
				if (this._useTashasRules) {
					const bonuses = this._getRacialASIBonuses();
					const assignedCount = Object.entries(this._tashasAbilityBonuses)
						.filter(([k, v]) => !k.includes("_amount") && v)
						.length;
					if (assignedCount < bonuses.length) {
						JqueryUtil.doToast({type: "warning", content: "Please assign all ability score bonuses using Tasha's Custom Origin rules."});
						return false;
					}
				}
				return true;

			case 6: { // Spells
				const knownInfo = this._getKnownCasterInfoForBuilder();
				if (!knownInfo) return true; // Not a caster class — nothing to validate
				if (knownInfo.className === "Sorcerer" && CharacterSheetClassUtils.isDivineSoulSubclass(this._selectedSubclass) && !CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity)) {
					JqueryUtil.doToast({type: "warning", content: "Please choose a Divine Soul affinity before finishing spell selection."});
					return false;
				}
				// Spellbook casters (Wizard) must fill their spellbook
				if (knownInfo.isSpellbookCaster && knownInfo.spellbookCount > 0 && this._selectedSpellbookSpells.length < knownInfo.spellbookCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${knownInfo.spellbookCount} spellbook spells (currently ${this._selectedSpellbookSpells.length}).`});
					return false;
				}
				// Known-spell casters (Bard, Sorcerer, Warlock, Ranger)
				if (!knownInfo.isSpellbookCaster && knownInfo.spellCount > 0 && this._selectedKnownSpells.length < knownInfo.spellCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${knownInfo.spellCount} spells (currently ${this._selectedKnownSpells.length}).`});
					return false;
				}
				if (knownInfo.cantripCount > 0 && this._selectedKnownCantrips.length < knownInfo.cantripCount) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${knownInfo.cantripCount} cantrips (currently ${this._selectedKnownCantrips.length}).`});
					return false;
				}
				return true;
			}

			default:
				return true;
		}
	}

	_applyCurrentStep () {
		switch (this._currentStep) {
			case 1: // Race
				this._state.setRace(this._selectedRace, this._selectedSubrace);
				// Clear ability bonuses before applying racial traits to prevent
				// accumulation when re-visiting step 1 (choose-based ASI uses ADD)
				Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));
				this._applyRacialTraits();
				break;

			case 2: // Background
				this._state.setBackground(this._selectedBackground);
				// Clear all ability bonuses and re-apply racial before background
				// to prevent accumulation when re-visiting step 2 without passing
				// through step 1 (e.g., going from step 3 back to step 2)
				Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));
				this._applyRacialAbilityBonuses();
				this._applyBackgroundFeatures();
				break;

			case 3: // Class
				// Clear any previously applied class data before reapplying
				// (handles the "user goes back and picks a different class" scenario)
				this._clearClassApplication(this._lastAppliedClassSnapshot);

				// Determine caster progression - check subclass first (for Eldritch Knight, etc.)
				const casterProgressionBuilder = this._selectedSubclass?.casterProgression || this._selectedClass.casterProgression || null;
				const spellcastingAbilityBuilder = this._selectedSubclass?.spellcastingAbility || this._selectedClass.spellcastingAbility || null;

				this._state.addClass({
					name: this._selectedClass.name,
					source: this._selectedClass.source,
					level: 1,
					subclass: this._selectedSubclass ? {
						name: this._selectedSubclass.name,
						shortName: this._selectedSubclass.shortName,
						source: this._selectedSubclass.source,
						casterProgression: this._selectedSubclass.casterProgression,
						spellcastingAbility: this._selectedSubclass.spellcastingAbility,
						additionalSpells: this._selectedSubclass.additionalSpells,
					} : null,
					subclassChoice: this._divineSoulAffinity,
					casterProgression: casterProgressionBuilder,
					spellcastingAbility: spellcastingAbilityBuilder,
					// Spell progression arrays for 2024/TGTT classes
					preparedSpellsProgression: this._selectedClass.preparedSpellsProgression,
					spellsKnownProgression: this._selectedClass.spellsKnownProgression,
					cantripProgression: this._selectedClass.cantripProgression,
				});
				this._applyClassFeatures();

				// Snapshot what was just applied so it can be undone if the user changes class
				this._lastAppliedClassSnapshot = {
					className: this._selectedClass.name,
					classSource: this._selectedClass.source,
					saveProficiencies: [...(this._selectedClass.proficiency || [])],
					skills: this._selectedSkills.map(s => s.toLowerCase().replace(/\s+/g, "")),
					expertiseSkills: this._selectedExpertise
						.filter(s => !s.toLowerCase().includes("tools"))
						.map(s => s.toLowerCase().replace(/\s+/g, "")),
					armorProficiencies: (this._selectedClass.startingProficiencies?.armor || [])
						.map(a => typeof a === "string" ? a : a.full).filter(Boolean),
					weaponProficiencies: (this._selectedClass.startingProficiencies?.weapons || [])
						.map(w => typeof w === "string" ? w : w.full).filter(Boolean),
					toolProficiencies: [
						...this._selectedClassToolProficiencies.map(c => c.tool?.toTitleCase()).filter(Boolean),
						...(this._selectedClass.startingProficiencies?.tools || [])
							.filter(t => typeof t === "string" && !/\bany\b.*\bchoice\b|\bchoose\b/i.test(t))
							.map(t => t.replace(/{@item\s+([^|}]+)[^}]*}/gi, "$1").toTitleCase()),
					],
					languages: [
						...(this._getClassFeatureLanguageGrants(this._selectedClass)?.autoLanguages || []),
						...this._selectedClassFeatureLanguages.filter(Boolean),
					],
					hadSpellcasting: !!this._selectedClass.spellcastingAbility,
				};

				// Record level 1 history entry
				{
					const level1History = {
						level: 1,
						class: {
							name: this._selectedClass.name,
							source: this._selectedClass.source,
						},
						choices: {},
						complete: true,
						timestamp: Date.now(),
					};

					// Record skill selections
					if (this._selectedSkills?.length > 0) {
						level1History.choices.skills = [...this._selectedSkills];
					}

					// Record expertise selections (for Rogue, etc.)
					if (this._selectedExpertise?.length > 0) {
						level1History.choices.expertise = this._selectedExpertise.map(s => s.toLowerCase());
					}

					// Record subclass if selected at level 1 (Cleric, Sorcerer, Warlock)
					if (this._selectedSubclass) {
						level1History.choices.subclass = {
							name: this._selectedSubclass.name,
							shortName: this._selectedSubclass.shortName,
							source: this._selectedSubclass.source,
						};
						if (CharacterSheetClassUtils.isDivineSoulSubclass(this._selectedSubclass) && this._divineSoulAffinity) {
							level1History.choices.subclassChoice = CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity);
						}
					}

					// Record optional features (invocations from Warlock, etc.)
					if (this._selectedOptionalFeatures && Object.keys(this._selectedOptionalFeatures).length > 0) {
						const optFeatures = [];
						const optFeatureReplay = [];
						Object.entries(this._selectedOptionalFeatures).forEach(([key, opts]) => {
							opts.forEach(opt => {
								optFeatures.push({
									name: opt.name,
									source: opt.source,
									type: key,
								});
								optFeatureReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
									type: key,
								}));
							});
						});
						if (optFeatures.length > 0) {
							level1History.choices.optionalFeatures = optFeatures;
							level1History.choices.replayData = level1History.choices.replayData || {};
							level1History.choices.replayData.optionalFeatures = optFeatureReplay;
						}
					}

					// Record feature choices (fighting styles, specialties, etc.)
					if (this._selectedFeatureOptions && Object.keys(this._selectedFeatureOptions).length > 0) {
						const featureChoices = [];
						const featureChoiceReplay = [];
						Object.entries(this._selectedFeatureOptions).forEach(([featureName, options]) => {
							const parentFeature = featureName.split("_")[0];
							options.forEach(opt => {
								featureChoices.push({
									featureName: parentFeature,
									choice: opt.name,
									source: opt.source,
								});
								featureChoiceReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
									type: opt.type || "featureOption",
									parentFeature,
								}));
							});
						});
						if (featureChoices.length > 0) {
							level1History.choices.featureChoices = featureChoices;
							level1History.choices.replayData = level1History.choices.replayData || {};
							level1History.choices.replayData.featureChoices = featureChoiceReplay;
						}
					}

					// Record weapon masteries
					if (this._selectedWeaponMasteries?.length > 0) {
						level1History.choices.weaponMasteries = [...this._selectedWeaponMasteries];
					}

					// Record combat traditions
					if (this._selectedCombatTraditions?.length > 0) {
						level1History.choices.combatTraditions = [...this._selectedCombatTraditions];
					}

					// Record race/background selections for respec support
					if (this._selectedRace) {
						level1History.choices.race = {
							name: this._selectedRace.name,
							source: this._selectedRace.source,
						};
						if (this._selectedSubrace) {
							level1History.choices.race.subrace = {
								name: this._selectedSubrace.name,
								source: this._selectedSubrace.source,
							};
						}
						level1History.choices.raceUserChoices = {};
						if (Object.keys(this._selectedRacialLanguages).length) {
							level1History.choices.raceUserChoices.selectedLanguages = {};
							for (const [k, v] of Object.entries(this._selectedRacialLanguages)) {
								if (Array.isArray(v)) level1History.choices.raceUserChoices.selectedLanguages[k] = [...v];
							}
						}
						if (this._selectedSubraceLanguages.length) {
							level1History.choices.raceUserChoices.selectedSubraceLanguages = [...this._selectedSubraceLanguages];
						}
						if (this._selectedRacialSkills.length) {
							level1History.choices.raceUserChoices.selectedSkills = [...this._selectedRacialSkills];
						}
						if (this._selectedRacialTools.length) {
							level1History.choices.raceUserChoices.selectedTools = [...this._selectedRacialTools];
						}
						if (Object.keys(this._selectedRacialAbilityChoices).length) {
							level1History.choices.raceUserChoices.selectedAbilityChoices = {};
							for (const [k, v] of Object.entries(this._selectedRacialAbilityChoices)) {
								level1History.choices.raceUserChoices.selectedAbilityChoices[k] = typeof v === "object" && v !== null ? {...v} : v;
							}
						}
						if (this._useTashasRules) {
							level1History.choices.raceUserChoices.useTashasRules = true;
							level1History.choices.raceUserChoices.tashasAbilityBonuses = {...this._tashasAbilityBonuses};
							level1History.choices.raceUserChoices.tashasSkillReplacements = [...this._tashasSkillReplacements];
							level1History.choices.raceUserChoices.tashasLanguageReplacements = [...this._tashasLanguageReplacements];
						}
					}
					if (this._selectedBackground) {
						level1History.choices.background = {
							name: this._selectedBackground.name,
							source: this._selectedBackground.source,
						};
						level1History.choices.backgroundUserChoices = {};
						if (this._selectedToolProficiencies?.length) {
							level1History.choices.backgroundUserChoices.selectedTools = this._selectedToolProficiencies.map(c => ({...c}));
						}
						if (this._selectedLanguages?.length) {
							level1History.choices.backgroundUserChoices.selectedLanguages = this._selectedLanguages.map(c => ({...c}));
						}
						if (this._selectedAbilityBonuses && Object.keys(this._selectedAbilityBonuses).length) {
							level1History.choices.backgroundUserChoices.selectedAbilityBonuses = {...this._selectedAbilityBonuses};
						}
					}

					this._state.recordLevelChoice(level1History);
				}
				break;

			case 4: // Abilities
				Parser.ABIL_ABVS.forEach(abl => {
					const score = this._abilityScores[abl];
					if (score != null) {
						this._state.setAbilityBase(abl, score);
					}
					// Clear existing racial ability bonuses before re-applying
					// (Tasha toggle is in this step, so the step-1 bonuses may be stale)
					this._state.setAbilityBonus(abl, 0);
				});
				// Re-apply racial ability bonuses with current Tasha state
				this._applyRacialAbilityBonuses();
				break;

			case 5: // Equipment
				this._applyEquipmentChoices();
				break;

			case 6: // Spells
				this._applyBuilderSpellChoices();
				break;

			case 7: // Details
				// Details are saved directly in the details step
				break;
		}

		this._page.renderCharacter();
	}

	_applyEquipmentChoices () {
		if (!this._selectedClass?.startingEquipment) return;

		const startingEquip = this._selectedClass.startingEquipment;
		const defaultData = startingEquip.defaultData || [];

		// Check if this is 2024 format (uppercase keys like A, B, C)
		const is2024Format = defaultData.length > 0 && defaultData[0]
			&& Object.keys(defaultData[0]).some(k => /^[A-Z]$/.test(k));

		if (is2024Format) {
			this._apply2024EquipmentChoices(startingEquip);
		} else {
			this._applyClassicEquipmentChoices(startingEquip);
		}
	}

	_apply2024EquipmentChoices (startingEquip) {
		const defaultData = startingEquip.defaultData || [];
		if (!defaultData.length) return;

		const choiceData = defaultData[0];
		const selectedKey = this._equipmentChoices["2024"] || Object.keys(choiceData).filter(k => /^[A-Z]$/.test(k))[0];
		const items = choiceData[selectedKey] || [];

		const allItems = this._page.getItems();

		items.forEach(itemEntry => {
			if (itemEntry.item) {
				// Item with optional quantity
				const [name, source] = itemEntry.item.split("|");
				const item = allItems.find(i =>
					i.name.toLowerCase() === name.toLowerCase()
					&& (!source || i.source?.toLowerCase() === source.toLowerCase()),
				);
				if (item) {
					this._state.addItem(item, itemEntry.quantity || 1);
				}
			} else if (itemEntry.value) {
				// Gold value in copper pieces
				const gp = Math.floor(itemEntry.value / 100);
				this._state.setCurrency("gp", (this._state.getCurrency("gp") || 0) + gp);
			} else if (itemEntry.special) {
				// Special items like "Spellbook" - try to find in items list
				const item = allItems.find(i => i.name.toLowerCase() === itemEntry.special.toLowerCase());
				if (item) {
					this._state.addItem(item, 1);
				}
			}
		});
	}

	_applyClassicEquipmentChoices (startingEquip) {
		// If using gold alternative, add gold instead
		if (this._useGoldAlternative && startingEquip.goldAlternative) {
			// Parse gold amount from string like "{@dice 5d4 × 10|5d4 × 10|Starting Gold}"
			// For simplicity, use average value
			const goldMatch = startingEquip.goldAlternative.match(/(\d+)d(\d+)\s*[×x*]\s*(\d+)/i);
			if (goldMatch) {
				const numDice = parseInt(goldMatch[1]);
				const dieFaces = parseInt(goldMatch[2]);
				const multiplier = parseInt(goldMatch[3]);
				const avgRoll = numDice * (dieFaces + 1) / 2;
				const gold = Math.floor(avgRoll * multiplier);
				this._state.setCurrency("gp", (this._state.getCurrency("gp") || 0) + gold);
			}
			return;
		}

		const defaultData = startingEquip.defaultData || [];

		defaultData.forEach((choiceSet, idx) => {
			const selectedKey = this._equipmentChoices?.[idx] || Object.keys(choiceSet).filter(k => k !== "_")[0] || "_";
			const items = choiceSet[selectedKey] || choiceSet._ || [];
			const pickerPrefix = selectedKey === "_" ? `${idx}__` : `${idx}_${selectedKey}`;

			this._addEquipmentItems(items, pickerPrefix);
		});
	}

	_addEquipmentItems (items, pickerPrefix = "") {
		if (!Array.isArray(items)) return;

		const allItems = this._page.getItems();

		items.forEach((itemEntry, itemIdx) => {
			if (typeof itemEntry === "string") {
				// Direct item reference like "chain mail|phb"
				const [name, source] = itemEntry.split("|");
				const item = allItems.find(i =>
					i.name.toLowerCase() === name.toLowerCase()
					&& (!source || i.source?.toLowerCase() === source.toLowerCase()),
				);
				if (item) {
					this._state.addItem(item, 1);
				}
			} else if (itemEntry.item) {
				// Item with quantity
				const [name, source] = itemEntry.item.split("|");
				const item = allItems.find(i =>
					i.name.toLowerCase() === name.toLowerCase()
					&& (!source || i.source?.toLowerCase() === source.toLowerCase()),
				);
				if (item) {
					this._state.addItem(item, itemEntry.quantity || 1);
				}
			} else if (itemEntry.equipmentType) {
				// Generic equipment type - look up user's selection from the equipment type picker
				const eqType = itemEntry.equipmentType;
				const quantity = itemEntry.quantity || 1;
				for (let q = 0; q < quantity; q++) {
					const selectKey = quantity > 1
						? `${pickerPrefix}${eqType}_${itemIdx}_${q}`
						: `${pickerPrefix}${eqType}_${itemIdx}`;
					const selectedItemName = this._equipmentTypeChoices?.[selectKey];
					if (selectedItemName) {
						const item = allItems.find(i => i.name === selectedItemName);
						if (item) {
							this._state.addItem(item, 1);
						}
					}
				}
			}
		});
	}

	_applyRacialTraits () {
		if (!this._selectedRace) return;

		// Speed - base race
		if (this._selectedRace.speed) {
			if (typeof this._selectedRace.speed === "number") {
				this._state.setSpeed("walk", this._selectedRace.speed);
			} else {
				if (this._selectedRace.speed.walk) this._state.setSpeed("walk", this._selectedRace.speed.walk);
				// Handle non-walk speeds - true means "equal to walking speed"
				["fly", "swim", "climb", "burrow"].forEach(speedType => {
					const speedValue = this._selectedRace.speed[speedType];
					if (speedValue === true) {
						// Add a named modifier with equalToWalk instead of setting to 1
						this._state.addNamedModifier({
							name: `${this._selectedRace.name} ${speedType.charAt(0).toUpperCase() + speedType.slice(1)} Speed`,
							type: `speed:${speedType}`,
							value: 0,
							equalToWalk: true,
							sourceType: "race",
							enabled: true,
						});
					} else if (typeof speedValue === "number" && speedValue > 0) {
						this._state.setSpeed(speedType, speedValue);
					}
				});
			}
		}

		// Speed - subrace can override or add
		if (this._selectedSubrace?.speed) {
			if (typeof this._selectedSubrace.speed === "number") {
				this._state.setSpeed("walk", this._selectedSubrace.speed);
			} else {
				if (this._selectedSubrace.speed.walk) this._state.setSpeed("walk", this._selectedSubrace.speed.walk);
				// Handle non-walk speeds - true means "equal to walking speed"
				["fly", "swim", "climb", "burrow"].forEach(speedType => {
					const speedValue = this._selectedSubrace.speed[speedType];
					if (speedValue === true) {
						// Add a named modifier with equalToWalk instead of setting to 1
						this._state.addNamedModifier({
							name: `${this._selectedSubrace.name} ${speedType.charAt(0).toUpperCase() + speedType.slice(1)} Speed`,
							type: `speed:${speedType}`,
							value: 0,
							equalToWalk: true,
							sourceType: "race",
							enabled: true,
						});
					} else if (typeof speedValue === "number" && speedValue > 0) {
						this._state.setSpeed(speedType, speedValue);
					}
				});
			}
		}

		// Ability score bonuses — delegate to reusable method
		// (also called from _applyCurrentStep case 3 when Tasha toggle may have changed)
		this._applyRacialAbilityBonuses();

		// Languages - base race and subrace
		// When using Tasha's Custom Origin, replace fixed racial languages (except Common) with user's choices
		if (this._useTashasRules && this._tashasLanguageReplacements.length) {
			// Always add Common (cannot be replaced per Tasha's rules)
			const addCommon = (langProficiencies) => {
				if (!langProficiencies) return;
				langProficiencies.forEach(langProf => {
					if (langProf["common"]) this._state.addLanguage("Common");
				});
			};
			addCommon(this._selectedRace?.languageProficiencies);
			addCommon(this._selectedSubrace?.languageProficiencies);

			// Add user-chosen replacement languages
			this._tashasLanguageReplacements.forEach(lang => {
				if (lang) this._state.addLanguage(lang.toTitleCase());
			});
		} else {
			if (this._selectedRace.languageProficiencies) {
				this._selectedRace.languageProficiencies.forEach(langProf => {
					Object.keys(langProf).forEach(lang => {
						if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
						this._state.addLanguage(lang.toTitleCase());
					});
				});
			}

			// Languages - subrace
			if (this._selectedSubrace?.languageProficiencies) {
				this._selectedSubrace.languageProficiencies.forEach(langProf => {
					Object.keys(langProf).forEach(lang => {
						if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
						this._state.addLanguage(lang.toTitleCase());
					});
				});
			}
		}

		// Apply selected racial language choices (from all proficiency entries)
		if (Object.keys(this._selectedRacialLanguages).length) {
			Object.values(this._selectedRacialLanguages).forEach(langArray => {
				if (Array.isArray(langArray)) {
					langArray.forEach(lang => {
						this._state.addLanguage(lang.toTitleCase());
					});
				}
			});
		}

		// Apply selected subrace language choices (e.g., Hub Residence Trilingual)
		if (this._selectedSubraceLanguages.length) {
			this._selectedSubraceLanguages.forEach(lang => {
				this._state.addLanguage(lang.toTitleCase());
			});
		}

		// Resistances - base race
		if (this._selectedRace.resist) {
			this._selectedRace.resist.forEach(r => {
				if (typeof r === "string") this._state.addResistance(r);
			});
		}

		// Resistances - subrace
		if (this._selectedSubrace?.resist) {
			this._selectedSubrace.resist.forEach(r => {
				if (typeof r === "string") this._state.addResistance(r);
			});
		}

		// Darkvision and other senses - set as base values
		if (this._selectedRace.darkvision) {
			this._state.setSense("darkvision", this._selectedRace.darkvision);
		}
		// Subrace can override darkvision (e.g., Drow get 120ft)
		if (this._selectedSubrace?.darkvision) {
			const currentDv = this._state.getSense("darkvision") || 0;
			if (this._selectedSubrace.darkvision > currentDv) {
				this._state.setSense("darkvision", this._selectedSubrace.darkvision);
			}
		}

		// Skill proficiencies from race data
		// When using Tasha's Custom Origin, replace fixed racial skills with user's choices
		if (this._useTashasRules && this._tashasSkillReplacements.length) {
			this._tashasSkillReplacements.forEach(skill => {
				if (skill) {
					const skillKey = skill.toLowerCase().replace(/\s+/g, "");
					this._state.setSkillProficiency(skillKey, 1);
				}
			});
		} else {
			if (this._selectedRace.skillProficiencies) {
				this._selectedRace.skillProficiencies.forEach(skillProf => {
					Object.keys(skillProf).forEach(skill => {
						if (skill !== "any" && skill !== "choose") {
							const skillKey = skill.toLowerCase().replace(/\s+/g, "");
							this._state.setSkillProficiency(skillKey, 1);
						}
					});
				});
			}

			// Skill proficiencies from subrace
			if (this._selectedSubrace?.skillProficiencies) {
				this._selectedSubrace.skillProficiencies.forEach(skillProf => {
					Object.keys(skillProf).forEach(skill => {
						if (skill !== "any" && skill !== "choose") {
							const skillKey = skill.toLowerCase().replace(/\s+/g, "");
							this._state.setSkillProficiency(skillKey, 1);
						}
					});
				});
			}
		}

		// Apply selected racial skill proficiency choices
		if (this._selectedRacialSkills.length) {
			this._selectedRacialSkills.forEach(skill => {
				const skillKey = skill.toLowerCase().replace(/\s+/g, "");
				this._state.setSkillProficiency(skillKey, 1);
			});
		}

		// Armor proficiencies from race (e.g., Mountain Dwarf)
		if (this._selectedRace.armorProficiencies) {
			this._selectedRace.armorProficiencies.forEach(armorProf => {
				Object.keys(armorProf).forEach(armor => {
					this._state.addArmorProficiency(armor.toTitleCase());
				});
			});
		}
		if (this._selectedSubrace?.armorProficiencies) {
			this._selectedSubrace.armorProficiencies.forEach(armorProf => {
				Object.keys(armorProf).forEach(armor => {
					this._state.addArmorProficiency(armor.toTitleCase());
				});
			});
		}

		// Weapon proficiencies from race (e.g., Elf weapon training)
		if (this._selectedRace.weaponProficiencies) {
			this._selectedRace.weaponProficiencies.forEach(weaponProf => {
				Object.keys(weaponProf).forEach(weapon => {
					this._state.addWeaponProficiency(weapon.toTitleCase());
				});
			});
		}
		if (this._selectedSubrace?.weaponProficiencies) {
			this._selectedSubrace.weaponProficiencies.forEach(weaponProf => {
				Object.keys(weaponProf).forEach(weapon => {
					this._state.addWeaponProficiency(weapon.toTitleCase());
				});
			});
		}

		// Tool proficiencies from race (e.g., Dwarf stonecunning tools)
		if (this._selectedRace.toolProficiencies) {
			this._selectedRace.toolProficiencies.forEach(toolProf => {
				Object.keys(toolProf).forEach(tool => {
					if (tool !== "any" && tool !== "choose") {
						this._state.addToolProficiency(tool.toTitleCase());
					}
				});
			});
		}
		if (this._selectedSubrace?.toolProficiencies) {
			this._selectedSubrace.toolProficiencies.forEach(toolProf => {
				Object.keys(toolProf).forEach(tool => {
					if (tool !== "any" && tool !== "choose") {
						this._state.addToolProficiency(tool.toTitleCase());
					}
				});
			});
		}

		// Apply selected racial tool proficiency choices
		if (this._selectedRacialTools.length) {
			this._selectedRacialTools.forEach(tool => {
				this._state.addToolProficiency(tool.toTitleCase());
			});
		}

		// Racial spells (like High Elf cantrip, Tiefling spells, etc.)
		this._applyRacialSpells();

		// Auto-granted optional features (e.g., Nyuidj Dreamwalk)
		this._applyRaceFeatureGrants();

		// Add racial features
		if (this._selectedRace.entries) {
			this._addFeatureEntries(this._selectedRace.entries, this._selectedRace.source, "Species");
		}

		if (this._selectedSubrace?.entries) {
			this._addFeatureEntries(this._selectedSubrace.entries, this._selectedSubrace.source, "Subrace");
		}
	}

	/**
	 * Apply auto-granted optional features from a race's featureGrants array.
	 * E.g., the Nyuidj race automatically grants the Dreamwalk ability.
	 */
	_applyRaceFeatureGrants () {
		const grants = this._selectedRace?.featureGrants;
		if (!grants?.length) return;

		const allOptFeatures = this._page.getOptionalFeatures?.() || [];
		grants.forEach(grant => {
			const opt = allOptFeatures.find(f => f.name === grant.name && f.source === grant.source)
				|| allOptFeatures.find(f => f.name === grant.name);
			if (!opt) return;
			this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
				raceSource: this._selectedRace.source,
				level: 1,
				featureType: "Optional Feature",
				optionalFeatureTypes: opt.featureType,
			}));
		});
	}

	/**
	 * Apply racial ability score bonuses.
	 * When Tasha's Custom Origin is enabled, applies the user's reassigned bonuses
	 * instead of the original racial/subrace bonuses.
	 * Called from both _applyRacialTraits (step 1) and _applyCurrentStep case 3 (Abilities).
	 */
	_applyRacialAbilityBonuses () {
		if (!this._selectedRace) return;

		if (this._useTashasRules) {
			Object.entries(this._tashasAbilityBonuses).forEach(([key, value]) => {
				if (key.includes("_amount") || !value) return;
				const amountKey = `${key}_amount`;
				const amount = this._tashasAbilityBonuses[amountKey] || 0;
				if (amount && Parser.ABIL_ABVS.includes(value)) {
					const current = this._state.getAbilityBonus(value) || 0;
					this._state.setAbilityBonus(value, current + amount);
				}
			});
		} else {
			if (this._selectedRace.ability) {
				const entries = this._getEffectiveAbilityEntries(this._selectedRace.ability, this._selectedRace.name, this._selectedRace.source);
				for (const {abiSet, originalIdx: abiIdx} of entries) {
					// Apply fixed ability entries (e.g., cha: 2) — always process these
					Object.entries(abiSet).forEach(([abi, bonus]) => {
						if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
							this._state.setAbilityBonus(abi, bonus);
						}
					});
					// Apply choose-based entries (e.g., choose 1 from [str, dex, ...])
					if (abiSet.choose) {
						const raceKey = `${this._selectedRace.name}|${this._selectedRace.source}`;
						const choices = this._selectedRacialAbilityChoices[raceKey] || {};
						Object.entries(choices).forEach(([key, abi]) => {
							if (!key.startsWith(`choose_${abiIdx}_`) || key.includes("_amount") || !abi) return;
							const amount = choices[`${key}_amount`] || 1;
							this._state.setAbilityBonus(abi, (this._state.getAbilityBonus(abi) || 0) + amount);
						});
					}
				}
			}

			if (this._selectedSubrace?.ability) {
				const entries = this._getEffectiveAbilityEntries(this._selectedSubrace.ability, this._selectedSubrace.name, this._selectedSubrace.source);
				for (const {abiSet, originalIdx: abiIdx} of entries) {
					// Apply fixed ability entries
					Object.entries(abiSet).forEach(([abi, bonus]) => {
						if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
							const current = this._state.getAbilityBonus(abi);
							this._state.setAbilityBonus(abi, current + bonus);
						}
					});
					// Apply choose-based entries
					if (abiSet.choose) {
						const raceKey = `${this._selectedSubrace.name}|${this._selectedSubrace.source}`;
						const choices = this._selectedRacialAbilityChoices[raceKey] || {};
						Object.entries(choices).forEach(([key, abi]) => {
							if (!key.startsWith(`choose_${abiIdx}_`) || key.includes("_amount") || !abi) return;
							const amount = choices[`${key}_amount`] || 1;
							const current = this._state.getAbilityBonus(abi);
							this._state.setAbilityBonus(abi, current + amount);
						});
					}
				}
			}
		}
	}

	/**
	 * Apply racial spells from additionalSpells property
	 * Handles both known spells and innate spellcasting
	 */
	_applyRacialSpells () {
		const race = this._selectedRace;
		if (!race?.additionalSpells?.length) return;

		const allSpells = this._page.getSpells();
		const raceName = race.name;
		const subraceName = race._subraceName || this._selectedSubrace?.name;


		race.additionalSpells.forEach(spellBlock => {
			// Check if this spell block is subrace-specific
			if (spellBlock.name) {
				// This spell block is for a specific subrace - only apply if it matches
				if (!subraceName || spellBlock.name.toLowerCase() !== subraceName.toLowerCase()) {
					return;
				}
			}

			// Get the spellcasting ability
			let spellAbility = null;
			if (spellBlock.ability) {
				if (typeof spellBlock.ability === "string") {
					spellAbility = spellBlock.ability;
				} else if (spellBlock.ability.choose) {
					// Use user-selected ability if available, otherwise default to first option
					const choiceIdx = race.additionalSpells.indexOf(spellBlock);
					spellAbility = this._selectedRacialSpellAbilities[choiceIdx] || spellBlock.ability.choose[0];
				}
			}

			// Process "known" spells - these are added to the character's spell list
			if (spellBlock.known) {
				Object.entries(spellBlock.known).forEach(([levelStr, spellsAtLevel]) => {
					const charLevel = parseInt(levelStr);
					// Only add spells available at level 1 during character creation
					if (charLevel > 1) return;

					this._processSpellList(spellsAtLevel, allSpells, raceName, spellAbility, false);
				});
			}

			// Process "innate" spells - these are racial abilities with limited uses
			if (spellBlock.innate) {
				Object.entries(spellBlock.innate).forEach(([levelStr, spellConfig]) => {
					const charLevel = parseInt(levelStr);
					// Only add spells available at level 1 during character creation
					if (charLevel > 1) return;

					// Innate spells can be at-will or daily uses
					if (typeof spellConfig === "object") {
						// Handle daily/rest structure
						if (spellConfig.daily) {
							Object.entries(spellConfig.daily).forEach(([uses, spellList]) => {
								this._processInnateSpells(spellList, allSpells, raceName, spellAbility, parseInt(uses), "long");
							});
						}
						if (spellConfig.rest) {
							Object.entries(spellConfig.rest).forEach(([uses, spellList]) => {
								this._processInnateSpells(spellList, allSpells, raceName, spellAbility, parseInt(uses), "short");
							});
						}
						// Direct spell array (at-will)
						if (Array.isArray(spellConfig)) {
							this._processInnateSpells(spellConfig, allSpells, raceName, spellAbility, 0, null);
						}
					} else if (Array.isArray(spellConfig)) {
						// Direct array = at-will
						this._processInnateSpells(spellConfig, allSpells, raceName, spellAbility, 0, null);
					}
				});
			}
		});
	}

	/**
	 * Process a list of spells and add them as known spells
	 */
	_processSpellList (spellList, allSpells, sourceName, spellAbility, isAlwaysPrepared) {
		if (!Array.isArray(spellList)) {
			// Handle choice objects like {"choose": "level=0|class=Wizard"}
			if (typeof spellList === "object") {
				if (spellList.choose) {
					// User-selected spell from _selectedRacialSpells
					// Find matching choice and use selected spell
					this._applySelectedRacialSpells(sourceName, spellAbility);
					return;
				}
				// Handle "_" key which contains an array
				if (spellList._) {
					this._processSpellList(spellList._, allSpells, sourceName, spellAbility, isAlwaysPrepared);
				}
			}
			return;
		}

		spellList.forEach(spellRef => {
			if (typeof spellRef === "object" && spellRef.choose) {
				// User-selected spell from _selectedRacialSpells
				this._applySelectedRacialSpells(sourceName, spellAbility);
				return;
			}
			const spellData = this._resolveSpellReference(spellRef, allSpells);
			if (spellData) {
				this._addRacialSpell(spellData, sourceName, isAlwaysPrepared);
			}
		});
	}

	/**
	 * Apply user-selected racial spells from the builder UI
	 */
	_applySelectedRacialSpells (sourceName, spellAbility) {
		if (!this._selectedRacialSpells?.length) return;

		this._selectedRacialSpells.forEach(spell => {
			if (!spell?.name) return;

			if (spell.level === 0) {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: sourceName,
					sourceClass: null,
				}));
			} else {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: sourceName,
					sourceClass: null,
					prepared: true,
				}));
			}
		});
	}

	/**
	 * Process innate spells with uses/recharge
	 */
	_processInnateSpells (spellList, allSpells, sourceName, spellAbility, uses, recharge) {
		if (!Array.isArray(spellList)) return;

		spellList.forEach(spellRef => {
			const spellData = this._resolveSpellReference(spellRef, allSpells);
			if (spellData) {
				const atWill = uses === 0;
				this._state.addInnateSpell({
					name: spellData.name,
					source: spellData.source,
					level: spellData.level,
					atWill: atWill,
					uses: atWill ? null : uses,
					recharge: recharge,
					sourceFeature: sourceName,
				});
			}
		});
	}

	/**
	 * Resolve a spell reference (name|source or name|source#c for cantrips) to full spell data
	 */
	_resolveSpellReference (spellRef, allSpells) {
		if (typeof spellRef !== "string") {
			// Handle choice objects
			if (spellRef?.choose) {
				return null;
			}
			return null;
		}

		// Parse "spell name|source" or "spell name|source#c" format
		// #c suffix indicates cantrip
		let spellName = spellRef;
		let source = null;
		const isCantrip = spellRef.includes("#c");

		// Remove #c suffix if present
		spellName = spellName.replace(/#c$/, "");

		// Split by | to get source
		const parts = spellName.split("|");
		spellName = parts[0].toLowerCase();
		if (parts.length > 1) {
			source = parts[1].toUpperCase();
		}

		// Find the spell in the spell list
		const spell = allSpells.find(s => {
			const nameMatch = s.name.toLowerCase() === spellName;
			if (!nameMatch) return false;
			if (source) return s.source === source;
			return true;
		});

		if (!spell) {
			console.warn(`[CharSheet Builder] Could not find spell: ${spellRef}`);
			return null;
		}

		return spell;
	}

	/**
	 * Add a racial spell to the character's spell list
	 */
	_addRacialSpell (spellData, sourceName, isAlwaysPrepared) {
		if (spellData.level === 0) {
			this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spellData, {
				sourceFeature: sourceName,
				sourceClass: null,
			}));
		} else {
			this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spellData, {
				sourceFeature: sourceName,
				sourceClass: null,
				prepared: spellData.level === 0 || isAlwaysPrepared,
			}));
		}
	}

	_applyClassFeatures () {
		if (!this._selectedClass) return;

		// Hit die type is implicit in state calculation

		// Saving throw proficiencies
		if (this._selectedClass.proficiency) {
			this._selectedClass.proficiency.forEach(prof => {
				if (Parser.ABIL_ABVS.includes(prof)) {
					this._state.addSaveProficiency(prof);
				}
			});
		}

		// Skill proficiencies (from user selection)
		if (this._selectedSkills.length) {
			this._selectedSkills.forEach(skill => {
				const skillKey = skill.toLowerCase().replace(/\s+/g, "");
				this._state.setSkillProficiency(skillKey, 1);
			});
		}

		// Expertise (from user selection - Rogue, Bard, etc.)
		if (this._selectedExpertise.length) {
			this._selectedExpertise.forEach(skill => {
				const skillKey = skill.toLowerCase().replace(/\s+/g, "");
				// Check if it's a tool (like "thieves' tools")
				if (skill.toLowerCase().includes("tools")) {
					// For tools, we track them differently - add to tool proficiencies if not already
					this._state.addToolProficiency(skill);
					// Mark tool expertise separately (could be tracked in features)
				} else {
					// Skills get expertise level (2)
					this._state.setSkillProficiency(skillKey, 2);
				}
			});
		}

		// Class feature languages — auto-add granted languages (e.g. Thieves' Cant)
		// then add user-selected language choices
		const classLangGrants = this._getClassFeatureLanguageGrants(this._selectedClass);
		if (classLangGrants?.autoLanguages?.length) {
			classLangGrants.autoLanguages.forEach(lang => {
				this._state.addLanguage(lang);
			});
		}
		if (this._selectedClassFeatureLanguages?.length) {
			this._selectedClassFeatureLanguages.forEach(lang => {
				if (lang) {
					this._state.addLanguage(lang);
				}
			});
		}

		// Armor proficiencies
		if (this._selectedClass.startingProficiencies?.armor) {
			this._selectedClass.startingProficiencies.armor.forEach(armor => {
				if (typeof armor === "string") {
					this._state.addArmorProficiency(armor);
				} else if (armor.full) {
					this._state.addArmorProficiency(armor.full);
				}
			});
		}

		// Weapon proficiencies
		if (this._selectedClass.startingProficiencies?.weapons) {
			this._selectedClass.startingProficiencies.weapons.forEach(weapon => {
				if (typeof weapon === "string") {
					this._state.addWeaponProficiency(weapon);
				} else if (weapon.full) {
					this._state.addWeaponProficiency(weapon.full);
				}
			});
		}

		// Tool proficiencies — user-selected class tool choices (e.g., Monk artisan/instrument)
		if (this._selectedClassToolProficiencies?.length) {
			this._selectedClassToolProficiencies.forEach(choice => {
				if (choice.tool) {
					this._state.addToolProficiency(choice.tool.toTitleCase());
				}
			});
		} else if (this._selectedClass.startingProficiencies?.tools) {
			// Fallback: parse text tool descriptions (for classes without structured toolProficiencies)
			this._selectedClass.startingProficiencies.tools.forEach(tool => {
				if (typeof tool === "string") {
					// Skip choice descriptions like "any one type of..." — handled by UI above
					if (/\bany\b.*\bchoice\b|\bchoose\b/i.test(tool)) return;
					// Extract tool name from {@item} tags if present and normalize
					const toolName = tool.replace(/{@item\s+([^|}]+)[^}]*}/gi, "$1").toTitleCase();
					this._state.addToolProficiency(toolName);
				}
			});
		}

		// Weapon Masteries (from user selection - Fighter, Paladin, Ranger, Rogue)
		if (this._selectedWeaponMasteries.length) {
			this._state.setWeaponMasteries(this._selectedWeaponMasteries);
		}

		// Spellcasting
		if (this._selectedClass.spellcastingAbility) {
			this._state.setSpellcastingAbility(this._selectedClass.spellcastingAbility);

			// Set initial spell slots for level 1
			const slots = this._getSpellSlotsForLevel(this._selectedClass.name, 1);
			Object.entries(slots).forEach(([level, count]) => {
				this._state.setSpellSlots(parseInt(level), count, count);
			});
		}

		// Add level 1 class features
		// classFeatures can be:
		// 1. An array of arrays - index 0 = level 1 features, index 1 = level 2 features, etc.
		// 2. An array of strings/objects directly for level 1 features
		if (this._selectedClass.classFeatures && this._selectedClass.classFeatures.length > 0) {
			// Get features at index 0 (level 1)
			let level1Features = this._selectedClass.classFeatures[0];

			// If the first element is not an array, the classFeatures array itself contains the features
			// (happens with some class formats where classFeatures is flat)
			if (level1Features && !Array.isArray(level1Features)) {
				// Check if this is a string/object feature entry rather than an array of features
				// In this case, filter for level 1 features from the flat array
				level1Features = this._selectedClass.classFeatures.filter(f => {
					if (typeof f === "string") {
						const parts = f.split("|");
						return parts[3] === "1" || parts.length < 4; // Level 1 or no level specified
					} else if (typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parts[3] === "1" || parts.length < 4;
					} else if (typeof f === "object" && f.level !== undefined) {
						return f.level === 1;
					}
					return true; // Include if we can't determine level
				});
			}

			level1Features = level1Features || [];

			// Check if we have a subclass selected - if so, we'll filter out features with gainSubclassFeature
			const hasSubclass = !!this._selectedSubclass;

			level1Features.forEach(f => {
				let featureName, featureSource, classSource;
				let hasGainSubclassFeature = false;

				if (typeof f === "string") {
					// Format: "FeatureName|ClassName|ClassSource|Level|FeatureSource"
					// FeatureSource is optional, defaults to ClassSource
					const parts = f.split("|");
					featureName = parts[0];
					classSource = parts[2] || this._selectedClass.source;
					featureSource = parts[4] || classSource; // Feature source defaults to class source
				} else if (typeof f === "object" && f.classFeature) {
					// Format: {classFeature: "FeatureName|ClassName|ClassSource|Level|FeatureSource", gainSubclassFeature: true}
					const parts = f.classFeature.split("|");
					featureName = parts[0];
					classSource = parts[2] || this._selectedClass.source;
					featureSource = parts[4] || classSource; // Feature source defaults to class source
					hasGainSubclassFeature = !!f.gainSubclassFeature;
				} else if (typeof f === "object" && f.name) {
					featureName = f.name;
					classSource = f.classSource || this._selectedClass.source;
					featureSource = f.source || classSource;
					hasGainSubclassFeature = !!f.gainSubclassFeature;
				} else {
					return;
				}

				// Skip features with gainSubclassFeature if we have an actual subclass selected
				// These are placeholder features like "Bard Subclass", "Subclass Feature", etc.
				if (hasSubclass && hasGainSubclassFeature) {
					return;
				}

				// Look up full feature data to get description
				// Use classSource from the reference (e.g., XPHB) not the selected class (e.g., TGTT for homebrew)
				const fullFeatureData = this._getClassFeatureData(featureName, this._selectedClass.name, classSource, 1);
				const description = fullFeatureData?.entries
					? Renderer.get().render({entries: fullFeatureData.entries})
					: "";

				const featureToAdd = {
					name: featureName,
					source: featureSource, // Feature's own source
					level: 1,
					className: this._selectedClass.name,
					classSource: classSource, // Class source from the reference (e.g., XPHB)
					featureType: "Class",
					description,
				};
				this._state.addFeature(featureToAdd);
			});
		} else {
		}

		// Add level 1 subclass features if a subclass is selected
		// NOTE: After DataLoader processing, subclassFeatures is an array-of-arrays where each inner array
		// contains feature OBJECTS (with level, name, entries properties), not strings
		if (this._selectedSubclass && this._selectedSubclass.subclassFeatures) {
			this._selectedSubclass.subclassFeatures.forEach(levelFeatures => {
				// levelFeatures is an array of feature objects for a specific level
				if (Array.isArray(levelFeatures)) {
					levelFeatures.forEach(feature => {
						// Feature is an object with level, name, entries, source, etc.
						if (typeof feature === "object" && feature.level === 1) {
							const featureName = feature.name || Renderer.findName(feature);
							if (featureName) {
								// Render the description from entries
								const description = feature.entries
									? Renderer.get().render({entries: feature.entries})
									: "";

								const featureToAdd = {
									name: featureName,
									source: feature.source || this._selectedSubclass.source || this._selectedClass.source,
									level: 1,
									className: this._selectedClass.name,
									classSource: this._selectedClass.source,
									subclassName: this._selectedSubclass.name,
									subclassShortName: feature.subclassShortName || this._selectedSubclass.shortName,
									subclassSource: feature.subclassSource || this._selectedSubclass.source,
									featureType: "Class",
									isSubclassFeature: true,
									description,
								};
								this._state.addFeature(featureToAdd);
							}
						} else if (typeof feature === "string") {
							// Fallback for raw string format - look up description from subclass features data
							const parts = feature.split("|");
							const featureLevel = parseInt(parts[parts.length - 1]);
							if (featureLevel === 1) {
								const fullFeatureData = this._getSubclassFeatureData(
									parts[0],
									this._selectedClass.name,
									parts[3] || this._selectedSubclass.shortName,
									parts[4] || this._selectedSubclass.source,
									1,
								);
								const description = fullFeatureData?.entries
									? Renderer.get().render({entries: fullFeatureData.entries})
									: "";

								const featureToAdd = CharacterSheetClassUtils.buildFeatureStateObject(
									{
										...(fullFeatureData || {}),
										name: parts[0],
										description,
									},
									{
										className: this._selectedClass.name,
										classSource: this._selectedClass.source,
										level: 1,
										featureType: "Class",
										subclassName: this._selectedSubclass.name,
										subclassShortName: parts[3] || this._selectedSubclass.shortName,
										subclassSource: parts[4] || this._selectedSubclass.source,
										isSubclassFeature: true,
									},
								);
								this._state.addFeature(featureToAdd);
							}
						}
					});
				} else if (typeof levelFeatures === "string") {
					// Raw string format (pre-DataLoader format)
					const parts = levelFeatures.split("|");
					const featureLevel = parseInt(parts[parts.length - 1]);
					if (featureLevel === 1) {
						const fullFeatureData = this._getSubclassFeatureData(
							parts[0],
							this._selectedClass.name,
							parts[3] || this._selectedSubclass.shortName,
							parts[4] || this._selectedSubclass.source,
							1,
						);
						const description = fullFeatureData?.entries
							? Renderer.get().render({entries: fullFeatureData.entries})
							: "";

						const featureToAdd = CharacterSheetClassUtils.buildFeatureStateObject(
							{
								...(fullFeatureData || {}),
								name: parts[0],
								description,
							},
							{
								className: this._selectedClass.name,
								classSource: this._selectedClass.source,
								level: 1,
								featureType: "Class",
								subclassName: this._selectedSubclass.name,
								subclassShortName: parts[3] || this._selectedSubclass.shortName,
								subclassSource: parts[4] || this._selectedSubclass.source,
								isSubclassFeature: true,
							},
						);
						this._state.addFeature(featureToAdd);
					}
				}
			});
		}

		// Add class resources (like Rage, Ki, etc.)
		this._addClassResources(this._selectedClass, 1);

		// Apply selected optional features (invocations, metamagic, etc.)
		this._applySelectedOptionalFeatures();

		// Apply selected feature options (specialties, etc. - features with embedded options)
		this._applySelectedFeatureOptions();
	}

	_applySelectedOptionalFeatures () {
		if (!this._selectedOptionalFeatures) return;

		// Build set of currently selected features (name|source)
		const selectedKeys = new Set();
		Object.values(this._selectedOptionalFeatures).flat().forEach(opt => {
			selectedKeys.add(`${opt.name}|${opt.source}`);
		});

		// Remove optional features from state that are no longer selected
		// Only remove level 1 optional features for this class (builder context)
		const className = this._selectedClass?.name;
		const existingOptFeatures = this._state.getFeatures().filter(f =>
			f.featureType === "Optional Feature"
			&& f.level === 1
			&& f.className === className,
		);

		existingOptFeatures.forEach(f => {
			const key = `${f.name}|${f.source}`;
			if (!selectedKeys.has(key)) {
				this._state.removeFeature(f.name, f.source);
			}
		});

		// Add selected optional features
		Object.entries(this._selectedOptionalFeatures).forEach(([featureKey, features]) => {
			features.forEach(opt => {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
					className: this._selectedClass?.name,
					classSource: this._selectedClass?.source,
					level: 1,
					featureType: "Optional Feature",
					optionalFeatureTypes: opt.featureType,
				}));
			});
		});

		// Store selected combat traditions on the character for level-up reference
		if (this._selectedCombatTraditions != null && this._state.setCombatTraditions) {
			this._state.setCombatTraditions([...this._selectedCombatTraditions]);
		}

		// Apply race-level optional feature choices (e.g., Nyuidj Dreamwalker Ability)
		if (this._selectedRaceOptionalFeatures) {
			Object.entries(this._selectedRaceOptionalFeatures).forEach(([featureKey, features]) => {
				features.forEach(opt => {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
						raceSource: this._selectedRace?.source,
						level: 1,
						featureType: "Optional Feature",
						optionalFeatureTypes: opt.featureType,
					}));
				});
			});
		}
	}

	_applySelectedFeatureOptions () {
		if (!this._selectedFeatureOptions) return;

		Object.entries(this._selectedFeatureOptions).forEach(([featureKey, options]) => {
			options.forEach(opt => {
				// For class feature options (like Specialties), look up the full feature data
				if (opt.type === "classFeature" && opt.ref) {
					const fullOpt = this._getClassFeatureDataFromRef(opt.ref);
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{
							...(fullOpt || {}),
							...opt,
							entries: fullOpt?.entries ?? opt.entries,
						},
						{
							className: opt.className || this._selectedClass?.name,
							classSource: this._selectedClass?.source,
							level: opt.level || 1,
							featureType: "Class",
							isFeatureOption: true,
							parentFeature: featureKey.split("_")[0],
						},
					));

					// Apply any skill sub-choices for this specialty
					const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
					const skillSelections = this._selectedFeatureSkillChoices[choiceKey];
					if (skillSelections?.length) {
						const skillChoice = this._parseFeatureSkillChoice(opt);
						if (skillChoice) {
							skillSelections.forEach(skill => {
								const skillKey = skill.toLowerCase().replace(/\s+/g, "");
								if (skillChoice.type === "proficiency") {
									this._state.setSkillProficiency(skillKey, 1);
								} else if (skillChoice.type === "expertise") {
									this._state.setSkillProficiency(skillKey, 2);
								} else if (skillChoice.type === "bonus") {
									// For "bonus equal to proficiency" - add a named modifier
									this._state.addNamedModifier({
										name: `${opt.name} (${skill})`,
										type: `skill:${skillKey}`,
										value: "proficiency",
										note: `From ${opt.name}: bonus equal to proficiency bonus`,
										enabled: true,
									});
								}
							});
						}
					}

					// Apply auto-effects (passive bonuses, etc.) that don't require user choices
					const autoEffects = this._parseFeatureAutoEffects(opt);
					autoEffects.forEach(effect => {
						this._state.addNamedModifier({
							name: opt.name,
							type: effect.type,
							value: effect.value,
							note: effect.note || `From ${opt.name}`,
							enabled: true,
						});
					});
				} else if (opt.type === "subclassFeature" && opt.ref) {
					// Handle subclass feature options
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
						className: opt.className || this._selectedClass?.name,
						classSource: this._selectedClass?.source,
						level: opt.level || 1,
						featureType: "Class",
						subclassName: this._selectedSubclass?.name,
						subclassShortName: opt.subclassShortName || this._selectedSubclass?.shortName,
						subclassSource: opt.subclassSource || this._selectedSubclass?.source,
						isSubclassFeature: true,
						isFeatureOption: true,
						parentFeature: featureKey.split("_")[0],
					}));
				} else if (opt.type === "optionalfeature" && opt.ref) {
					// Handle optional feature options (like specialties from TGTT)
					const allOptFeatures = this._page.getOptionalFeatures();
					const refParts = opt.ref.split("|");
					const resolvedSource = this._page.resolveOptionalFeatureSource(refParts[0] || opt.name, [
						refParts[1],
						opt.source,
						this._selectedClass?.source,
						Parser.SRC_XPHB,
						Parser.SRC_PHB,
					]);

					const fullOpt = allOptFeatures.find(f =>
						f.name === opt.name
						&& f.source === resolvedSource,
					) || allOptFeatures.find(f => f.name === opt.name);

					if (!fullOpt) {
						const similar = allOptFeatures.filter(f => f.name.toLowerCase().includes(opt.name.toLowerCase().substring(0, 5)));
						console.warn(`[CharSheet Builder] Could not find optional feature "${opt.name}" (source: ${opt.source}). Similar names found:`, similar.map(f => `${f.name}|${f.source}`).join(", "));
					}

					const resolvedOptData = {
						...(fullOpt || {}),
						...opt,
						source: fullOpt?.source || resolvedSource,
						entries: fullOpt?.entries,
					};

					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						resolvedOptData,
						{
							className: this._selectedClass?.name,
							classSource: this._selectedClass?.source,
							level: 1,
							featureType: "Optional Feature",
							isFeatureOption: true,
							parentFeature: featureKey.split("_")[0],
						},
					));

					// Apply skill sub-choices for optional features (proficiency/expertise grants)
					const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
					const skillSelections = this._selectedFeatureSkillChoices[choiceKey];
					if (skillSelections?.length) {
						const skillChoice = CharacterSheetClassUtils.parseFeatureSkillChoice(opt, [], {optionalFeatures: allOptFeatures, resolvedData: fullOpt});
						if (skillChoice) {
							skillSelections.forEach(skill => {
								const skillKey = skill.toLowerCase().replace(/\s+/g, "");
								if (skillChoice.type === "proficiency") {
									this._state.setSkillProficiency(skillKey, 1);
								} else if (skillChoice.type === "expertise") {
									this._state.setSkillProficiency(skillKey, 2);
								} else if (skillChoice.type === "bonus") {
									this._state.addNamedModifier({
										name: `${opt.name} (${skill})`,
										type: `skill:${skillKey}`,
										value: "proficiency",
										note: `From ${opt.name}: bonus equal to proficiency bonus`,
										enabled: true,
									});
								}
							});
						}
					}

					// Apply auto-effects (passive bonuses, speed, etc.)
					const autoEffects = CharacterSheetClassUtils.parseFeatureAutoEffects(opt, [], {optionalFeatures: allOptFeatures, resolvedData: fullOpt});
					autoEffects.forEach(effect => {
						this._state.addNamedModifier({
							name: opt.name,
							type: effect.type,
							value: effect.value,
							note: effect.note || `From ${opt.name}`,
							enabled: true,
						});
					});
				} else if (opt.type === "text") {
					// Simple text option - just note the selection
				}
			});
		});
	}

	_applyBackgroundFeatures () {
		if (!this._selectedBackground) return;

		// Apply selected ability bonuses from 2024 background
		if (this._selectedAbilityBonuses) {
			Object.entries(this._selectedAbilityBonuses).forEach(([key, value]) => {
				if (key.startsWith("bg_") && !key.includes("weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = this._selectedAbilityBonuses[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value);
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}

		// Skill proficiencies
		if (this._selectedBackground.skillProficiencies) {
			this._selectedBackground.skillProficiencies.forEach(skillSet => {
				Object.keys(skillSet).forEach(skill => {
					if (skill !== "choose" && skill !== "any") {
						const skillKey = skill.toLowerCase().replace(/\s+/g, "");
						this._state.setSkillProficiency(skillKey, 1);
					}
				});
			});
		}

		// Tool proficiencies - fixed ones from background
		if (this._selectedBackground.toolProficiencies) {
			this._selectedBackground.toolProficiencies.forEach(toolSet => {
				Object.entries(toolSet).forEach(([key, value]) => {
					// Only add fixed tool proficiencies here (not choose/any/anyMusical)
					if (key !== "choose" && key !== "any" && key !== "anyArtisansTool" && key !== "anyMusicalInstrument" && value === true) {
						this._state.addToolProficiency(key.toTitleCase());
					}
				});
			});
		}

		// Tool proficiencies - choices made by user
		if (this._selectedToolProficiencies?.length) {
			this._selectedToolProficiencies.forEach(choice => {
				if (choice.tool) {
					this._state.addToolProficiency(choice.tool.toTitleCase());
				}
			});
		}

		// Languages - fixed ones from background
		if (this._selectedBackground.languageProficiencies) {
			this._selectedBackground.languageProficiencies.forEach(langSet => {
				Object.entries(langSet).forEach(([key, value]) => {
					// Only add fixed language proficiencies here (not anyStandard/any)
					if (key !== "anyStandard" && key !== "any" && value === true) {
						this._state.addLanguage(key.toTitleCase());
					}
				});
			});
		}

		// Languages - choices made by user
		if (this._selectedLanguages?.length) {
			this._selectedLanguages.forEach(choice => {
				if (choice.language) {
					this._state.addLanguage(choice.language);
				}
			});
		}

		// Background feature
		if (this._selectedBackground.entries) {
			this._addFeatureEntries(this._selectedBackground.entries, this._selectedBackground.source, "Background");
		}
	}

	/**
	 * Undo everything that was applied by case 3 (_applyClassFeatures + addClass) so the user
	 * can switch class without accumulating stale data.  Called at the top of case 3.
	 * @param {object|null} snapshot - Built by case 3 after the previous class was applied
	 */
	_clearClassApplication (snapshot) {
		if (!snapshot) return;

		// Remove class entry from state (also recalculates HP, hit dice, spell slots)
		this._state.removeClass(snapshot.className, snapshot.classSource);

		// Remove save proficiencies granted by this class
		(snapshot.saveProficiencies || []).forEach(p => this._state.removeSaveProficiency(p));

		// Reset class skill proficiencies to 0
		(snapshot.skills || []).forEach(s => this._state.setSkillProficiency(s, 0));

		// Reset expertise-level skills to 0
		(snapshot.expertiseSkills || []).forEach(s => this._state.setSkillProficiency(s, 0));

		// Re-assert background skill proficiencies in case there was an overlap
		// (e.g., background + class both granted Acrobatics)
		if (this._selectedBackground?.skillProficiencies) {
			this._selectedBackground.skillProficiencies.forEach(skillSet => {
				Object.keys(skillSet).forEach(skill => {
					if (skill !== "choose" && skill !== "any") {
						this._state.setSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""), 1);
					}
				});
			});
		}

		// Remove armor, weapon, and tool proficiencies
		(snapshot.armorProficiencies || []).forEach(a => { if (a) this._state.removeArmorProficiency(a); });
		(snapshot.weaponProficiencies || []).forEach(w => { if (w) this._state.removeWeaponProficiency(w); });
		(snapshot.toolProficiencies || []).forEach(t => { if (t) this._state.removeToolProficiency(t); });

		// Remove class feature languages
		(snapshot.languages || []).forEach(l => { if (l) this._state.removeLanguage(l); });

		// Remove all features belonging to this class
		this._state.getFeatures()
			.filter(f => f.className === snapshot.className)
			.forEach(f => this._state.removeFeature(f.name, f.source));

		// Clear weapon masteries (class-granted)
		this._state.setWeaponMasteries([]);

		// Clear spellcasting ability if it was provided by the removed class
		if (snapshot.hadSpellcasting) {
			this._state.setSpellcastingAbility(null);
		}

		// Remove level 1 history so it can be re-recorded with the new class
		this._state.removeLevelHistoryEntry(1);
	}

	_addFeatureEntries (entries, source, featureType) {
		entries.forEach(entry => {
			if (typeof entry === "object" && entry.name) {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
					{
						...entry,
						source: entry.source || source,
					},
					{featureType},
				));
			}
		});
	}

	/**
	 * Look up full class feature data to get description/entries
	 */
	_getClassFeatureData (featureName, className, source, level) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length) {
			return null;
		}

		// Class features can have different property combinations depending on source
		// First try exact source match
		const exactResult = classFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (source && f.source !== source) return false;
			return true;
		});
		if (exactResult) return exactResult;

		// Fall back to flexible PHB/XPHB/SRD matching
		const result = classFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			// Be more flexible with source matching
			if (source && f.source && f.source !== source) {
				// Allow XPHB/PHB/SRD flexibility
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		});

		if (!result && featureName) {
			// Try to find similar features for debugging
			const similar = classFeatures.filter(f => f.name === featureName);
			if (similar.length) {
			} else {
			}
		} else if (result) {
		}
		return result;
	}

	/**
	 * Look up full subclass feature data to get description/entries
	 */
	_getSubclassFeatureData (featureName, className, subclassShortName, source, level) {
		const subclassFeatures = this._page.getSubclassFeatures();
		if (!subclassFeatures?.length) {
			return null;
		}

		const result = subclassFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.subclassShortName !== subclassShortName) return false;
			if (f.level !== level) return false;
			// Be more flexible with source matching
			if (source && f.source && f.source !== source) {
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		});

		if (!result && featureName) {
		}
		return result;
	}

	_addClassResources (cls, level) {
		// Fallback class-specific resources for features that don't have parseable descriptions
		// The auto-detection in addFeature() handles most cases, but some features have
		// complex or non-standard descriptions that need explicit handling
		const profBonus = () => Math.ceil(level / 4) + 1;
		const resources = {
			"Barbarian": [
				{name: "Rage", maxByLevel: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 999], recharge: "long"},
			],
			"Monk": [
				// Ki/Focus Points - level-based, not parseable from text
				// Use "Focus Points" for 2024 (XPHB) monks, "Ki Points" for 2014 (PHB) monks
				{name: "__MONK_RESOURCE__", maxByLevel: lvl => lvl >= 2 ? lvl : 0, recharge: "short"},
			],
			"Sorcerer": [
				{name: "Sorcery Points", maxByLevel: lvl => {
					const isTGTT = cls.source === "TGTT";
					if (isTGTT) return lvl + 1;
					return lvl >= 2 ? lvl : 0;
				}, recharge: "long"},
			],
			"Paladin": [
				// Lay on Hands pool = 5 * level, not parseable
				{name: "Lay on Hands", maxByLevel: lvl => lvl * 5, recharge: "long"},
			],
			"Bard": [
				// Bardic Inspiration uses = CHA mod, recharge changes at level 5
				{name: "Bardic Inspiration", maxByLevel: () => Math.max(1, this._state.getAbilityMod("cha")), recharge: level >= 5 ? "short" : "long"},
			],
		};

		const classResources = resources[cls.name];
		if (classResources) {
			const existingResources = this._state.getResources();
			classResources.forEach(resource => {
				// Resolve special placeholder for monk Ki/Focus Points
				let resourceName = resource.name;
				if (resourceName === "__MONK_RESOURCE__") {
					resourceName = "Focus Points";
				}

				// Skip if resource was already auto-added (check both Ki and Focus for monks)
				const isMonkResource = resourceName === "Ki Points" || resourceName === "Focus Points";
				if (isMonkResource) {
					if (existingResources.find(r => r.name === "Ki Points" || r.name === "Focus Points")) {
						return;
					}
				} else if (existingResources.find(r => r.name === resourceName)) {
					return;
				}

				let max;
				if (typeof resource.maxByLevel === "function") {
					max = resource.maxByLevel(level);
				} else if (Array.isArray(resource.maxByLevel)) {
					max = resource.maxByLevel[level - 1] || 0;
				} else {
					max = resource.maxByLevel;
				}

				if (max > 0) {
					this._state.addResource({
						name: resourceName,
						max,
						recharge: resource.recharge,
					});
				}
			});
		}
	}

	_getSpellSlotsForLevel (className, level) {
		// Full casters
		const fullCasterSlots = {
			1: {1: 2},
			2: {1: 3},
			3: {1: 4, 2: 2},
			4: {1: 4, 2: 3},
			5: {1: 4, 2: 3, 3: 2},
			// ... continues
		};

		// Half casters
		const halfCasterSlots = {
			2: {1: 2},
			3: {1: 3},
			4: {1: 3},
			5: {1: 4, 2: 2},
			// ... continues
		};

		const fullCasters = ["Bard", "Cleric", "Druid", "Sorcerer", "Wizard"];
		const halfCasters = ["Paladin", "Ranger", "Artificer"];

		if (fullCasters.includes(className)) {
			return fullCasterSlots[level] || {};
		} else if (halfCasters.includes(className)) {
			return halfCasterSlots[level] || {};
		}

		return {};
	}

	async _finishCharacter () {
		// Recalculate max HP (CON may have changed since addClass) and fill to full
		this._state.recalculateHp({syncCurrent: true});

		// Save the character
		await this._page.saveCharacter();

		// Update tab visibility (hide builder, show respec)
		this._page._updateTabVisibility();

		// Check if Quick Build target level is set
		if (this._quickBuildTargetLevel > 1 && this._page._quickBuild && this._selectedClass) {
			const quickBuildLaunchData = {
				classData: this._selectedClass,
				targetLevel: this._quickBuildTargetLevel,
				subclass: this._selectedSubclass || null,
				subclassChoice: CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity),
			};

			// Switch to overview first so user sees the character
			this._page.switchToTab("#charsheet-tab-overview");
			JqueryUtil.doToast({type: "success", content: "Character created! Opening Quick Build wizard..."});

			// Small delay to let the UI settle, then open Quick Build
			setTimeout(() => {
				void this._page._quickBuild.showFromBuilder(quickBuildLaunchData)
					.catch(err => {
						void err;
						JqueryUtil.doToast({type: "warning", content: "Character created, but Quick Build could not be opened automatically."});
					});
			}, 500);
		} else {
			// Switch to overview tab
			this._page.switchToTab("#charsheet-tab-overview");
			JqueryUtil.doToast({type: "success", content: "Character created successfully!"});
		}
	}

	_renderCurrentStep () {
		const content = document.getElementById("charsheet-builder-content");
		content.innerHTML = "";

		switch (this._currentStep) {
			case 1:
				this._renderRaceStep(content);
				break;
			case 2:
				this._renderBackgroundStep(content);
				break;
			case 3:
				this._renderClassStep(content);
				break;
			case 4:
				this._renderAbilitiesStep(content);
				break;
			case 5:
				this._renderEquipmentStep(content);
				break;
			case 6:
				this._renderSpellsStep(content);
				break;
			case 7:
				this._renderDetailsStep(content);
				break;
		}
	}

	// #region Step 1: Race
	_renderRaceStep (content) {
		// Get races filtered by allowed sources
		const races = this._page.filterByAllowedSources(this._page.getRaces());

		// Group races by base name - races with _baseName are subraces
		// Group key is "baseName|baseSource" for subraces, or "name|source" for standalone races
		const raceGroups = new Map();

		races.forEach(race => {
			if (race._baseName && race._baseSource) {
				// This is a subrace - group under the base race
				const groupKey = `${race._baseName}|${race._baseSource}`;
				if (!raceGroups.has(groupKey)) {
					raceGroups.set(groupKey, {
						baseName: race._baseName,
						baseSource: race._baseSource,
						subraces: [],
						isBaseRace: false,
					});
				}
				raceGroups.get(groupKey).subraces.push(race);
			} else if (race._isBaseRace) {
				// This is a base race entry (shown when isAddBaseRaces is true)
				const groupKey = `${race._rawName || race.name}|${race.source}`;
				if (!raceGroups.has(groupKey)) {
					raceGroups.set(groupKey, {
						baseName: race._rawName || race.name,
						baseSource: race.source,
						subraces: [],
						isBaseRace: true,
						baseRaceData: race,
					});
				} else {
					raceGroups.get(groupKey).isBaseRace = true;
					raceGroups.get(groupKey).baseRaceData = race;
				}
			} else {
				// Standalone race without subraces
				const groupKey = `${race.name}|${race.source}`;
				if (!raceGroups.has(groupKey)) {
					raceGroups.set(groupKey, {
						baseName: race.name,
						baseSource: race.source,
						subraces: [],
						isBaseRace: false,
						standaloneRace: race,
					});
				}
			}
		});

		const container = e_({outer: `
			<div class="charsheet__builder-selection">
				<div class="charsheet__builder-list">
					<div class="charsheet__builder-list-header">
						<input type="text" class="ve-form-control form-control--minimal" placeholder="Search species..." id="builder-race-search">
					</div>
					<div class="charsheet__builder-list-content" id="builder-race-list"></div>
				</div>
				<div class="charsheet__builder-preview" id="builder-race-preview">
					<div class="charsheet__builder-preview-placeholder">Select a species to see details</div>
				</div>
			</div>
		`});

		content.append(container);

		const list = document.getElementById("builder-race-list");
		const preview = document.getElementById("builder-race-preview");
		const search = document.getElementById("builder-race-search");

		// Populate race list - show grouped races
		const renderRaceList = (filter = "") => {
			list.innerHTML = "";
			const filterLower = filter.toLowerCase();

			// Convert map to array and sort by base name
			const sortedGroups = Array.from(raceGroups.entries())
				.filter(([key, group]) => {
					if (!filter) return true;
					// Search in base name and all subrace names
					if (group.baseName.toLowerCase().includes(filterLower)) return true;
					if (group.subraces.some(sr => sr.name.toLowerCase().includes(filterLower))) return true;
					return false;
				})
				.sort((a, b) => a[1].baseName.localeCompare(b[1].baseName));

			sortedGroups.forEach(([groupKey, group]) => {
				const hasSubraces = group.subraces.length > 0;
				const displayName = group.baseName;

				// Check if this group is selected
				const isSelected = this._selectedRace && (
					(this._selectedRace._baseName === group.baseName && this._selectedRace._baseSource === group.baseSource)
					|| (this._selectedRace.name === group.baseName && this._selectedRace.source === group.baseSource && !this._selectedRace._baseName)
				);

				const subraceCount = hasSubraces ? ` (${group.subraces.length} subraces)` : "";
				const item = e_({outer: `
					<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
						<span class="charsheet__builder-list-item-name">${displayName}${subraceCount}</span>
						<span class="charsheet__builder-list-item-source">${Parser.sourceJsonToAbv(group.baseSource)}</span>
					</div>
				`});

				item.addEventListener("click", () => {
					[...list.querySelectorAll(".charsheet__builder-list-item")].forEach(el => el.classList.remove("active"));
					item.classList.add("active");

					// Reset racial proficiency selections when race group changes
					this._selectedRacialSkills = [];
					this._selectedRacialTools = [];
					this._selectedRacialLanguages = {};
					this._selectedSubraceLanguages = [];
					this._selectedRacialSpells = [];
					this._selectedRacialSpellAbilities = {};

					if (hasSubraces) {
						// Show subrace selection in preview
						this._selectedRace = null;
						this._selectedSubrace = null;
						this._renderRaceGroupPreview(preview, group);
					} else {
						// Standalone race - select directly
						this._selectedRace = group.standaloneRace;
						this._selectedSubrace = null;
						this._renderRacePreview(preview, group.standaloneRace);
					}
				});

				list.append(item);
			});
		};

		search.addEventListener("input", (e) => renderRaceList(e.target.value));
		renderRaceList();

		// If race already selected, show preview
		if (this._selectedRace) {
			// Find the group this race belongs to
			const groupKey = this._selectedRace._baseName
				? `${this._selectedRace._baseName}|${this._selectedRace._baseSource}`
				: `${this._selectedRace.name}|${this._selectedRace.source}`;
			const group = raceGroups.get(groupKey);

			if (group && group.subraces.length > 0) {
				this._renderRaceGroupPreview(preview, group);
			} else {
				this._renderRacePreview(preview, this._selectedRace);
			}
		}
	}

	/**
	 * Render preview for a race group with subrace selection
	 */
	_renderRaceGroupPreview (preview, group) {
		preview.innerHTML = "";

		const contentEl = e_({outer: `
			<div>
				<h4>${group.baseName}</h4>
				<p class="ve-muted">${Parser.sourceJsonToFull(group.baseSource)}</p>
			</div>
		`});

		// Subrace selection dropdown
		const subraceSection = e_({outer: `
			<div class="mt-3">
				<strong>Select Subrace:</strong>
				<select class="ve-form-control form-control--minimal mt-1" id="builder-subrace-select">
					<option value="">-- Choose a subrace --</option>
				</select>
			</div>
		`});

		const select = subraceSection.querySelector("select");

		// Sort subraces alphabetically
		const sortedSubraces = [...group.subraces].sort((a, b) => a.name.localeCompare(b.name));

		sortedSubraces.forEach((subrace, idx) => {
			// Extract just the subrace name part from "BaseName (SubraceName)"
			const subraceName = this._extractSubraceName(subrace.name, group.baseName);
			const sourceAbv = Parser.sourceJsonToAbv(subrace.source);
			select.append(e_({tag: "option", val: `${idx}`, attrs: {"data-source": subrace.source}, txt: `${subraceName} (${sourceAbv})`}));
		});

		// Container for subrace details
		const detailsContainer = e_({tag: "div", id: "builder-subrace-details", clazz: "mt-3"});

		select.addEventListener("change", (e) => {
			const idx = e.target.value;
			if (idx !== "") {
				const selectedSubrace = sortedSubraces[parseInt(idx)];
				this._selectedRace = selectedSubrace;
				// Don't set _selectedSubrace for merged races - all subrace data is already in the race object
				this._selectedSubrace = null;
				// Reset racial proficiency selections when race changes
				this._selectedRacialSkills = [];
				this._selectedRacialTools = [];
				this._selectedRacialLanguages = {};
				this._selectedSubraceLanguages = [];
				this._selectedRacialSpells = [];
				this._selectedRacialSpellAbilities = {};
				this._renderSubraceDetails(detailsContainer, selectedSubrace, group.baseName);
			} else {
				this._selectedRace = null;
				this._selectedSubrace = null;
				// Reset racial proficiency selections
				this._selectedRacialSkills = [];
				this._selectedRacialTools = [];
				this._selectedRacialLanguages = {};
				this._selectedSubraceLanguages = [];
				this._selectedRacialSpells = [];
				this._selectedRacialSpellAbilities = {};
				detailsContainer.innerHTML = "";
			}
		});

		// Pre-select if already chosen
		if (this._selectedRace) {
			const idx = sortedSubraces.findIndex(sr =>
				sr.name === this._selectedRace.name && sr.source === this._selectedRace.source,
			);
			if (idx >= 0) {
				select.value = idx;
				this._renderSubraceDetails(detailsContainer, sortedSubraces[idx], group.baseName);
			}
		}

		contentEl.append(subraceSection);
		contentEl.append(detailsContainer);
		preview.append(contentEl);
	}

	/**
	 * Extract subrace name from full race name
	 * e.g., "Elf (High Elf)" -> "High Elf", "Dwarf (Hill Dwarf)" -> "Hill Dwarf"
	 */
	_extractSubraceName (fullName, baseName) {
		const match = fullName.match(/\(([^)]+)\)$/);
		if (match) return match[1];
		// Fallback: remove base name prefix
		if (fullName.startsWith(baseName)) {
			return fullName.substring(baseName.length).trim().replace(/^\(|\)$/g, "").trim() || fullName;
		}
		return fullName;
	}

	/**
	 * Render details for a selected subrace
	 */
	_renderSubraceDetails (container, race, baseName) {
		container.innerHTML = "";

		const subraceName = this._extractSubraceName(race.name, baseName);

		const details = e_({tag: "div", clazz: "charsheet__builder-subrace-details"});

		details.append(e_({tag: "h5", txt: subraceName}));

		// Ability scores
		if (race.ability?.length) {
			const abilityOptionTexts = race.ability.map(a => {
				const parts = [];
				// Fixed entries (e.g., cha: 2) — always show
				Object.entries(a)
					.filter(([k]) => k !== "choose" && Parser.ABIL_ABVS.includes(k))
					.forEach(([k, v]) => parts.push(`${k.toUpperCase()} +${v}`));
				// Choose entries
				if (a.choose) {
					const c = a.choose;
					if (c.weighted) {
						const weights = c.weighted.weights || [2, 1];
						const fromList = (c.weighted.from || Parser.ABIL_ABVS).map(ab => ab.toUpperCase()).join(", ");
						parts.push(`Choose ${weights.length}: +${weights.join("/+")} from ${fromList}`);
					} else {
						const fromList = (c.from || Parser.ABIL_ABVS).map(ab => ab.toUpperCase()).join(", ");
						parts.push(`Choose ${c.count || 1}: +${c.amount || 1} from ${fromList}`);
					}
				}
				return parts.join(", ");
			});

			if (abilityOptionTexts.filter(Boolean).length) {
				const abilityStr = abilityOptionTexts.length > 1
					? abilityOptionTexts.join(" <em>or</em> ")
					: abilityOptionTexts[0];
				details.append(e_({tag: "p", html: `<strong>Ability Scores:</strong> ${abilityStr}`}));
			}

			// Ability score choice UI
			const asiChoices = this._renderRaceAbilityChoices(race);
			if (asiChoices) {
				details.append(asiChoices);
			}
		}

		// Speed
		if (race.speed) {
			const speedStr = typeof race.speed === "number" ? `${race.speed} ft.` : `${race.speed.walk || 30} ft.`;
			details.append(e_({tag: "p", html: `<strong>Speed:</strong> ${speedStr}`}));
		}

		// Size
		if (race.size) {
			const sizeStr = race.size.map(s => Parser.sizeAbvToFull(s)).join(" or ");
			details.append(e_({tag: "p", html: `<strong>Size:</strong> ${sizeStr}`}));
		}

		// Traits
		if (race.entries) {
			const traits = e_({tag: "div", html: `<strong>Traits:</strong>`, clazz: "mt-2"});
			race.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					traits.append(e_({tag: "p", html: `<em>${entry.name}.</em> ${Renderer.get().render({entries: entry.entries || []})}`}));
				}
			});
			details.append(traits);
		}

		// Racial proficiency choices (skills, tools)
		const profChoices = this._renderRacialProficiencyChoices(race);
		if (profChoices) {
			details.append(profChoices);
		}

		// Racial spell choices (e.g., Child of the Empire cantrip)
		const spellChoices = this._renderRacialSpellChoices(race);
		if (spellChoices) {
			details.append(spellChoices);
		}

		// Race-level optional feature choices (e.g., Nyuidj Dreamwalker Ability)
		const optFeatureChoices = this._renderRaceOptionalFeatureChoices(race);
		if (optFeatureChoices) {
			details.append(optFeatureChoices);
		}

		container.append(details);
	}

	/**
	 * Render ability score choice dropdowns for races with choose-based ASI
	 * @param {Object} race - The race data
	 * @returns {HTMLElement|null} Element with dropdowns, or null if no choices
	 */
	_renderRaceAbilityChoices (race) {
		if (!race.ability?.length) return null;

		// Check if any ability set has a choose block
		const hasAnyChoose = race.ability.some(abiSet => abiSet.choose);
		// For multi-option ability arrays we always need the UI (for the option selector)
		if (!hasAnyChoose && race.ability.length <= 1) return null;

		const raceKey = `${race.name}|${race.source}`;
		if (!this._selectedRacialAbilityChoices[raceKey]) {
			this._selectedRacialAbilityChoices[raceKey] = {};
		}

		const container = e_({tag: "div", clazz: "charsheet__builder-race-asi-choices mt-2"});

		// When multiple ability options exist (VRGR lineage), show radio buttons to select which option
		if (race.ability.length > 1) {
			container.append(e_({tag: "p", clazz: "ve-small ve-muted", txt: "Choose your ability score option:"}));

			const optionSelector = e_({tag: "div", clazz: "charsheet__builder-asi-option-selector mb-2"});
			const selectedSetIdx = this._selectedRacialAbilitySetIdx[raceKey] ?? 0;

			race.ability.forEach((abiSet, optIdx) => {
				const label = this._describeAbilitySet(abiSet);
				const checked = optIdx === selectedSetIdx ? "checked" : "";
				const radio = e_({outer: `
					<label class="ve-flex-v-center mb-1" style="cursor: pointer;">
						<input type="radio" name="race-asi-option-${raceKey}" value="${optIdx}" ${checked} class="mr-2">
						<span>${label}</span>
					</label>
				`});

				radio.querySelector("input").addEventListener("change", () => {
					this._selectedRacialAbilitySetIdx[raceKey] = optIdx;
					// Clear previous choose selections for this race since option changed
					Object.keys(this._selectedRacialAbilityChoices[raceKey]).forEach(k => {
						delete this._selectedRacialAbilityChoices[raceKey][k];
					});
					// Re-render the dropdown section
					dropdownSection.innerHTML = "";
					this._renderAbilityChoiceDropdowns(race.ability[optIdx], optIdx, raceKey, dropdownSection);
					this._updateAbilitySummary?.();
				});

				optionSelector.append(radio);
			});

			container.append(optionSelector);
		} else {
			container.append(e_({tag: "p", clazz: "ve-small ve-muted", txt: "Choose your ability score increases:"}));
		}

		// Dropdown section for individual ability choices
		const dropdownSection = e_({tag: "div", clazz: "charsheet__builder-asi-dropdowns"});
		const effectiveEntries = this._getEffectiveAbilityEntries(race.ability, race.name, race.source);
		for (const {abiSet, originalIdx} of effectiveEntries) {
			if (abiSet.choose) {
				this._renderAbilityChoiceDropdowns(abiSet, originalIdx, raceKey, dropdownSection);
			}
		}
		container.append(dropdownSection);

		// Only return if we actually have content
		return (container.children.length > 0) ? container : null;
	}

	/**
	 * Get a human-readable description of an ability set option
	 */
	_describeAbilitySet (abiSet) {
		const parts = [];
		Object.entries(abiSet)
			.filter(([k]) => k !== "choose" && Parser.ABIL_ABVS.includes(k))
			.forEach(([k, v]) => parts.push(`${k.toUpperCase()} +${v}`));
		if (abiSet.choose) {
			const c = abiSet.choose;
			if (c.weighted) {
				const weights = c.weighted.weights || [2, 1];
				parts.push(`+${weights.join("/+")}`);
			} else {
				const count = c.count || 1;
				const amount = c.amount || 1;
				parts.push(`${count} × +${amount}`);
			}
		}
		return parts.join(", ") || "No bonuses";
	}

	/**
	 * Render dropdowns for a single ability set's choose block
	 */
	_renderAbilityChoiceDropdowns (abiSet, abiIdx, raceKey, container) {
		if (!abiSet.choose) return;

		const choose = abiSet.choose;
		const isWeighted = !!choose.weighted;
		const weights = isWeighted ? (choose.weighted.weights || [2, 1]) : null;
		const count = isWeighted ? weights.length : (choose.count || 1);
		const from = (isWeighted ? choose.weighted.from : choose.from) || Parser.ABIL_ABVS;

		for (let i = 0; i < count; i++) {
			const amount = isWeighted ? weights[i] : (choose.amount || 1);
			const choiceKey = `choose_${abiIdx}_${i}`;
			const row = e_({tag: "div", clazz: "ve-flex-v-center mb-1"});
			row.append(e_({tag: "span", clazz: "mr-2", txt: `+${amount}:`}));

			const select = e_({tag: "select", clazz: "ve-form-control form-control--minimal ve-inline-block w-auto", attrs: {"data-race-asi-key": choiceKey}});
			select.append(e_({tag: "option", val: "", txt: "-- Select --"}));

			from.forEach(ab => {
				const abName = Parser.attAbvToFull(ab);
				const opt = e_({tag: "option", val: ab, txt: abName});
				if (this._selectedRacialAbilityChoices[raceKey]?.[choiceKey] === ab) opt.selected = true;
				select.append(opt);
			});

			select.addEventListener("change", ((capturedAmount) => (e) => {
				const val = e.target.value;
				this._selectedRacialAbilityChoices[raceKey][choiceKey] = val || null;
				this._selectedRacialAbilityChoices[raceKey][`${choiceKey}_amount`] = capturedAmount;

				// Disable already-selected abilities in other dropdowns
				[...container.querySelectorAll("select")].forEach(sel => {
					const selKey = sel.dataset.raceAsiKey;
					[...sel.querySelectorAll("option")].forEach(opt => {
						const optVal = opt.value;
						if (!optVal) return;
						const isSelectedElsewhere = Object.entries(this._selectedRacialAbilityChoices[raceKey])
							.some(([k, v]) => k.startsWith("choose_") && !k.includes("_amount") && k !== selKey && v === optVal);
						opt.disabled = !!(optVal && isSelectedElsewhere);
					});
				});

				this._updateAbilitySummary?.();
			})(amount));

			row.append(select);
			container.append(row);
		}
	}

	/**
	 * Render UI for racial proficiency choices (skills and tools)
	 * @param {Object} race - The race data
	 * @returns {HTMLElement|null} - Element containing proficiency choices, or null if none
	 */
	_renderRacialProficiencyChoices (race) {
		const container = e_({tag: "div", clazz: "charsheet__builder-racial-proficiencies mt-3"});
		let hasChoices = false;

		// Skill proficiency choices
		if (race.skillProficiencies) {
			race.skillProficiencies.forEach((skillProf, profIdx) => {
				if (skillProf.choose) {
					hasChoices = true;
					const chooseFrom = skillProf.choose.from || [];
					const chooseCount = skillProf.choose.count || 1;

					if (chooseFrom.length > 0) {
						const section = this._renderRacialSkillChoice(chooseFrom, chooseCount, profIdx);
						container.append(section);
					}
				}
				if (skillProf.any) {
					hasChoices = true;
					const anyCount = skillProf.any;
					const section = this._renderRacialSkillChoice(null, anyCount, profIdx);
					container.append(section);
				}
			});
		}

		// Tool proficiency choices
		if (race.toolProficiencies) {
			race.toolProficiencies.forEach((toolProf, profIdx) => {
				if (toolProf.choose) {
					hasChoices = true;
					const chooseFrom = toolProf.choose.from || [];
					const chooseCount = toolProf.choose.count || 1;

					if (chooseFrom.length > 0) {
						const section = this._renderRacialToolChoice(chooseFrom, chooseCount, profIdx);
						container.append(section);
					}
				}
				if (toolProf.any) {
					hasChoices = true;
					const anyCount = toolProf.any;
					const section = this._renderRacialToolChoice(null, anyCount, profIdx, "any");
					container.append(section);
				}
				if (toolProf.anyArtisansTool) {
					hasChoices = true;
					const anyCount = typeof toolProf.anyArtisansTool === "number" ? toolProf.anyArtisansTool : 1;
					const section = this._renderRacialToolChoice(null, anyCount, profIdx, "artisan");
					container.append(section);
				}
				if (toolProf.anyMusicalInstrument) {
					hasChoices = true;
					const anyCount = typeof toolProf.anyMusicalInstrument === "number" ? toolProf.anyMusicalInstrument : 1;
					const section = this._renderRacialToolChoice(null, anyCount, profIdx, "musical");
					container.append(section);
				}
			});
		}

		// Language proficiency choices
		if (race.languageProficiencies) {
			// For merged races, find feature names for subrace language proficiencies
			const languageFeatureNames = this._findLanguageFeatureNames(race);

			race.languageProficiencies.forEach((langProf, profIdx) => {
				// Determine the feature name for this language proficiency entry
				// First entry (profIdx=0) is usually base race, subsequent are from subrace features
				const featureName = languageFeatureNames[profIdx] || "Racial Languages";

				if (langProf.choose) {
					hasChoices = true;
					const chooseFrom = langProf.choose.from || [];
					const chooseCount = langProf.choose.count || 1;
					if (chooseFrom.length > 0) {
						const section = this._renderRacialLanguageChoice(chooseFrom, chooseCount, profIdx, featureName);
						container.append(section);
					}
				}
				if (langProf.anyStandard) {
					hasChoices = true;
					const anyCount = typeof langProf.anyStandard === "number" ? langProf.anyStandard : 1;
					const section = this._renderRacialLanguageChoice(null, anyCount, profIdx, featureName);
					container.append(section);
				}
				if (langProf.any) {
					hasChoices = true;
					const anyCount = typeof langProf.any === "number" ? langProf.any : 1;
					const section = this._renderRacialLanguageChoice(null, anyCount, profIdx, featureName);
					container.append(section);
				}
			});
		}

		return hasChoices ? container : null;
	}

	/**
	 * Find feature names that grant language proficiencies from race entries
	 * Returns an array where index corresponds to languageProficiencies index
	 * @param {Object} race - The race data
	 * @returns {Array<string|null>} - Array of feature names
	 */
	_findLanguageFeatureNames (race) {
		const names = [];
		if (!race.entries || !race.languageProficiencies) return names;

		// Count how many language-granting features we need to find
		const numLangProfs = race.languageProficiencies.length;

		// First entry is typically base race - use "Racial Languages"
		if (numLangProfs >= 1) {
			names[0] = "Racial Languages";
		}

		// For subsequent entries, search entries for language-related features
		if (numLangProfs > 1) {
			let foundIdx = 1;
			for (const entry of race.entries) {
				if (foundIdx >= numLangProfs) break;
				if (typeof entry === "object" && entry.name && entry.entries) {
					const entryText = (entry.entries || []).join(" ").toLowerCase();
					// Check if this feature mentions languages
					if (entryText.includes("language") || entry.name.toLowerCase().includes("lingual")) {
						names[foundIdx] = entry.name;
						foundIdx++;
					}
				}
			}
		}

		return names;
	}

	/**
	 * Render skill choice UI for racial proficiencies
	 * @param {string[]|null} skills - Array of skill names to choose from, or null for any skill
	 * @param {number} count - Number of skills to choose
	 * @param {number} profIdx - Index for tracking multiple choice sections
	 * @returns {jQuery} - jQuery element
	 */
	_renderRacialSkillChoice (skills, count, profIdx) {
		// Get skills dynamically from loaded data (supports homebrew) - fallback to Parser
		const allSkills = this._page?.getSkillsList?.()?.map(s => s.name)
			|| (Parser.SKILL_TO_ATB_ABV ? Object.keys(Parser.SKILL_TO_ATB_ABV).map(s => s.toTitleCase()) : [
				"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
				"History", "Insight", "Intimidation", "Investigation", "Medicine",
				"Nature", "Perception", "Performance", "Persuasion", "Religion",
				"Sleight of Hand", "Stealth", "Survival",
			]);

		// Strip source suffix from skill names (e.g., "might|TGTT" -> "might") and title case
		const availableSkills = skills ? skills.map(s => s.split("|")[0].toTitleCase()) : allSkills;
		const label = skills ? `Choose ${count} skill${count > 1 ? "s" : ""} from:` : `Choose any ${count} skill${count > 1 ? "s" : ""}:`;

		const section = e_({outer: `
			<div class="charsheet__builder-racial-skill-selection mt-2">
				<p><strong>Racial Skills:</strong> ${label}</p>
				<div class="charsheet__builder-skill-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="racial-skill-count">${this._selectedRacialSkills.length}</span>/${count}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-skill-checkboxes");
		const takenByOthers = this._getSkillsFromOtherSources("race");

		// Remove any prior racial selections now taken by another source
		this._selectedRacialSkills = this._selectedRacialSkills.filter(s => !takenByOthers.has(s));
		section.querySelector(".racial-skill-count").textContent = this._selectedRacialSkills.length;

		availableSkills.forEach(skill => {
			const isSelected = this._selectedRacialSkills.includes(skill);
			const takenSource = takenByOthers.get(skill);
			const lbl = e_({outer: `
				<label class="charsheet__builder-skill-checkbox mr-3 mb-1${takenSource ? " ve-muted" : ""}">
					<input type="checkbox" value="${skill}" ${isSelected ? "checked" : ""}${takenSource ? " disabled" : ""}>
					${skill}${takenSource ? ` <span class="ve-small">(${takenSource})</span>` : ""}
				</label>
			`});

			if (!takenSource) {
				lbl.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedRacialSkills.length < count) {
							this._selectedRacialSkills.push(skill);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} skill${count > 1 ? "s" : ""}.`});
						}
					} else {
						this._selectedRacialSkills = this._selectedRacialSkills.filter(s => s !== skill);
					}
					section.querySelector(".racial-skill-count").textContent = this._selectedRacialSkills.length;
				});
			}

			checkboxes.append(lbl);
		});

		return section;
	}

	/**
	 * Render tool choice UI for racial proficiencies
	 * @param {string[]|null} tools - Array of tool names to choose from, or null for filtered list
	 * @param {number} count - Number of tools to choose
	 * @param {number} profIdx - Index for tracking multiple choice sections
	 * @param {string} [toolType] - Filter type: 'any', 'artisan', 'musical', or undefined for specific list
	 * @returns {HTMLElement} - jQuery element
	 */
	_renderRacialToolChoice (tools, count, profIdx, toolType) {
		// Common tools list - used when "any" is specified
		const allTools = [
			"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
			"Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
			"Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
			"Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
			"Potter's Tools", "Smith's Tools", "Tinker's Tools",
			"Weaver's Tools", "Woodcarver's Tools", "Disguise Kit",
			"Forgery Kit", "Gaming Set", "Herbalism Kit",
			"Musical Instrument", "Navigator's Tools", "Poisoner's Kit",
			"Thieves' Tools",
		];

		// Artisan's tools only
		const artisanTools = [
			"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
			"Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
			"Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
			"Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
			"Potter's Tools", "Smith's Tools", "Tinker's Tools",
			"Weaver's Tools", "Woodcarver's Tools",
		];

		// Musical instruments
		const musicalInstruments = [
			"Bagpipes", "Drum", "Dulcimer", "Flute", "Lute",
			"Lyre", "Horn", "Pan Flute", "Shawm", "Viol",
		];

		let availableTools;
		let label;
		if (tools) {
			availableTools = tools.map(t => t.toTitleCase());
			label = `Choose ${count} tool${count > 1 ? "s" : ""} from:`;
		} else if (toolType === "artisan") {
			availableTools = artisanTools;
			label = `Choose ${count} artisan's tool${count > 1 ? "s" : ""}:`;
		} else if (toolType === "musical") {
			availableTools = musicalInstruments;
			label = `Choose ${count} musical instrument${count > 1 ? "s" : ""}:`;
		} else {
			availableTools = allTools;
			label = `Choose any ${count} tool${count > 1 ? "s" : ""}:`;
		}

		const section = e_({outer: `
			<div class="charsheet__builder-racial-tool-selection mt-2">
				<p><strong>Racial Tools:</strong> ${label}</p>
				<div class="charsheet__builder-tool-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="racial-tool-count">${this._selectedRacialTools.length}</span>/${count}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-tool-checkboxes");

		availableTools.forEach(tool => {
			const isSelected = this._selectedRacialTools.includes(tool);
			const lbl = e_({outer: `
				<label class="charsheet__builder-tool-checkbox mr-3 mb-1">
					<input type="checkbox" value="${tool}" ${isSelected ? "checked" : ""}>
					${tool}
				</label>
			`});

			lbl.querySelector("input").addEventListener("change", (e) => {
				if (e.target.checked) {
					if (this._selectedRacialTools.length < count) {
						this._selectedRacialTools.push(tool);
					} else {
						e.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} tool${count > 1 ? "s" : ""}.`});
					}
				} else {
					this._selectedRacialTools = this._selectedRacialTools.filter(t => t !== tool);
				}
				section.querySelector(".racial-tool-count").textContent = this._selectedRacialTools.length;
			});

			checkboxes.append(lbl);
		});

		return section;
	}

	/**
	 * Classify a list of language names into {homebrew, standard, exotic, secret} groups,
	 * sorted priority-sources-first then alphabetically within each group.
	 * @param {string[]} names - Language names to group
	 * @returns {{homebrew: string[], standard: string[], exotic: string[], secret: string[]}}
	 */
	_groupLanguagesByType (names) {
		// Use the page's grouped result to know each language's category
		const grouped = this._page.getLanguageOptionsGrouped();
		const standardSet = new Set(grouped.standard);
		const exoticSet = new Set(grouped.exotic);
		const secretSet = new Set(grouped.secret);

		const homebrew = [];
		const standard = [];
		const exotic = [];
		const secret = [];

		for (const name of names) {
			if (standardSet.has(name)) standard.push(name);
			else if (exoticSet.has(name)) exotic.push(name);
			else if (secretSet.has(name)) secret.push(name);
			else homebrew.push(name);
		}

		// Ordering within each group matches the page's already-sorted lists
		const reorder = (arr, reference) =>
			[...reference.filter(l => arr.includes(l)), ...arr.filter(l => !reference.includes(l)).sort()];

		// Build name → source lookup (prefer priority sources)
		const prioritySources = this._state.getPrioritySources() || [];
		const sourceLookup = new Map();
		for (const lang of (this._page._languagesData || [])) {
			const existing = sourceLookup.get(lang.name);
			if (!existing) {
				sourceLookup.set(lang.name, lang.source);
			} else if (prioritySources.includes(lang.source) && !prioritySources.includes(existing)) {
				sourceLookup.set(lang.name, lang.source);
			}
		}

		return {
			homebrew: homebrew.sort(),
			standard: reorder(standard, grouped.standard),
			exotic: reorder(exotic, grouped.exotic),
			secret: reorder(secret, grouped.secret),
			sourceLookup,
		};
	}

	/**
	 * Render grouped language checkboxes into a container element.
	 * @param {{homebrew: string[], standard: string[], exotic: string[], secret: string[], sourceLookup: Map}} groupedLangs
	 * @param {string[]} selectedArr - Mutable array of currently-selected language names
	 * @param {number} maxCount - Maximum number of selections allowed
	 * @param {HTMLElement} countEl - Span element showing the current selection count
	 * @param {HTMLElement} container - Container to append groups into
	 * @param {function} [onChange] - Called after every selection change
	 * @param {{excludeGroups?: string[]}} [options]
	 */
	_renderLanguageCheckboxGroup (groupedLangs, selectedArr, maxCount, countEl, container, onChange, options = {}) {
		const { excludeGroups = [] } = options;
		const sourceLookup = groupedLangs.sourceLookup;

		const GROUP_LABELS = {
			homebrew: "Homebrew",
			standard: "Standard",
			exotic: "Exotic",
			secret: "Secret",
		};

		for (const key of ["homebrew", "standard", "exotic", "secret"]) {
			if (excludeGroups.includes(key)) continue;
			const langs = groupedLangs[key];
			if (!langs?.length) continue;

			const group = e_({outer: `
				<div class="charsheet__builder-lang-group">
					<div class="charsheet__builder-lang-group-header">${GROUP_LABELS[key]}</div>
					<div class="charsheet__builder-lang-group-items"></div>
				</div>
			`});
			const items = group.querySelector(".charsheet__builder-lang-group-items");

			for (const lang of langs) {
				const source = sourceLookup?.get(lang);
				const sourceSpan = source ? ` <span class="charsheet__builder-lang-source">(${source})</span>` : "";
				const isSelected = selectedArr.includes(lang);
				const lbl = e_({outer: `
					<label class="charsheet__builder-lang-checkbox">
						<input type="checkbox" value="${lang}" ${isSelected ? "checked" : ""}>
						${lang}${sourceSpan}
					</label>
				`});
				lbl.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (selectedArr.length < maxCount) {
							selectedArr.push(lang);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${maxCount} language${maxCount > 1 ? "s" : ""}.`});
						}
					} else {
						const idx = selectedArr.indexOf(lang);
						if (idx !== -1) selectedArr.splice(idx, 1);
					}
					countEl.textContent = selectedArr.length;
					if (onChange) onChange();
				});
				items.append(lbl);
			}
			container.append(group);
		}
	}

	/**
	 * Render language choice UI for racial language proficiencies
	 * @param {string[]|null} languages - Array of language names to choose from (may include source suffix like "lexalian|TGTT"), or null for any standard language
	 * @param {number} count - Number of languages to choose
	 * @param {number} profIdx - Index for tracking multiple choice sections
	 * @param {string} featureName - Name of the feature granting these languages (e.g., "Racial Languages" or "Trilinguals")
	 * @returns {HTMLElement} - jQuery element
	 */
	_renderRacialLanguageChoice (languages, count, profIdx, featureName = "Racial Languages") {
		// Get all available languages from the page, sorted by priority sources
		const allLanguages = this._page.getLanguageNamesSorted();
		const prioritySources = this._state.getPrioritySources() || [];

		// Standard languages as fallback if no languages loaded
		const standardLanguages = [
			"Common", "Dwarvish", "Elvish", "Giant", "Gnomish",
			"Goblin", "Halfling", "Orc", "Abyssal", "Celestial",
			"Draconic", "Deep Speech", "Infernal", "Primordial",
			"Sylvan", "Undercommon",
		];

		let availableLanguages;
		if (languages) {
			// Process specific language choices (strip source suffixes like "|TGTT")
			availableLanguages = languages.map(l => {
				const name = l.split("|")[0];
				return name.toTitleCase();
			});
			// Sort chosen languages by priority sources too
			availableLanguages.sort((a, b) => {
				// Check if language is from priority source (marked by presence in loaded data)
				const aInAll = allLanguages.indexOf(a);
				const bInAll = allLanguages.indexOf(b);
				// Languages from priority sources will be at the start of allLanguages
				if (aInAll >= 0 && bInAll >= 0) {
					return aInAll - bInAll;
				}
				return a.localeCompare(b);
			});
		} else {
			// "any" or "anyStandard" - use all loaded languages, or fall back to standard
			availableLanguages = allLanguages.length > 0 ? allLanguages : standardLanguages;
		}

		const label = languages
			? `Choose ${count} language${count > 1 ? "s" : ""} from:`
			: `Choose any ${count} language${count > 1 ? "s" : ""}:`;

		const section = e_({outer: `
			<div class="charsheet__builder-racial-lang-selection mt-2">
				<p><strong>${featureName}:</strong> ${label}</p>
				<div class="charsheet__builder-lang-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="racial-lang-count">${(this._selectedRacialLanguages[profIdx] || []).length}</span>/${count}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-lang-checkboxes");

		// Ensure array exists for this profIdx
		if (!this._selectedRacialLanguages[profIdx]) {
			this._selectedRacialLanguages[profIdx] = [];
		}

		const countEl = section.querySelector(".racial-lang-count");
		const grouped = this._groupLanguagesByType(availableLanguages);
		this._renderLanguageCheckboxGroup(
			grouped,
			this._selectedRacialLanguages[profIdx],
			count,
			countEl,
			checkboxes,
			null,
			{excludeGroups: ["secret"]},
		);

		return section;
	}

	/**
	 * Render proficiency choice UI for subrace-specific proficiencies (e.g., Hub Residence Trilingual)
	 * @param {Object} subrace - The subrace data
	 * @returns {HTMLElement|null} - jQuery element or null if no choices
	 */
	_renderSubraceProficiencyChoices (subrace) {
		if (!subrace) return null;

		const container = e_({outer: `<div class="charsheet__builder-subrace-prof-choices mt-3"></div>`});
		let hasChoices = false;

		// Try to find the feature name for language proficiencies from entries
		// (e.g., "Trilinguals" for Hub Residence)
		const languageFeatureName = this._findSubraceLanguageFeatureName(subrace) || `${subrace.name} Languages`;

		// Language proficiency choices (e.g., Trilingual from Hub Residence)
		if (subrace.languageProficiencies) {
			subrace.languageProficiencies.forEach((langProf, profIdx) => {
				if (langProf.choose) {
					hasChoices = true;
					const chooseFrom = langProf.choose.from || [];
					const chooseCount = langProf.choose.count || 1;
					if (chooseFrom.length > 0) {
						const section = this._renderSubraceLanguageChoice(chooseFrom, chooseCount, profIdx, languageFeatureName);
						container.append(section);
					}
				}
				if (langProf.anyStandard) {
					hasChoices = true;
					const anyCount = typeof langProf.anyStandard === "number" ? langProf.anyStandard : 1;
					const section = this._renderSubraceLanguageChoice(null, anyCount, profIdx, languageFeatureName);
					container.append(section);
				}
				if (langProf.any) {
					hasChoices = true;
					const anyCount = typeof langProf.any === "number" ? langProf.any : 1;
					const section = this._renderSubraceLanguageChoice(null, anyCount, profIdx, languageFeatureName);
					container.append(section);
				}
			});
		}

		return hasChoices ? container : null;
	}

	/**
	 * Find the feature name for language proficiencies from subrace entries
	 * Looks for entries mentioning "language" to find the feature name (e.g., "Trilinguals")
	 * @param {Object} subrace - The subrace data
	 * @returns {string|null} - Feature name or null if not found
	 */
	_findSubraceLanguageFeatureName (subrace) {
		if (!subrace.entries) return null;

		for (const entry of subrace.entries) {
			if (typeof entry === "object" && entry.name && entry.entries) {
				// Check if this entry mentions languages
				const entryText = entry.entries.join(" ").toLowerCase();
				if (entryText.includes("language") || entry.name.toLowerCase().includes("lingual")) {
					return entry.name;
				}
			}
		}
		return null;
	}

	/**
	 * Render language choice UI for subrace language proficiencies (separate from base race)
	 * @param {string[]|null} languages - Array of language names to choose from, or null for any
	 * @param {number} count - Number of languages to choose
	 * @param {number} profIdx - Index for tracking
	 * @param {string} featureName - Name of the feature for labeling (e.g., "Trilinguals")
	 * @returns {HTMLElement} - jQuery element
	 */
	_renderSubraceLanguageChoice (languages, count, profIdx, featureName) {
		const allLanguages = this._page.getLanguageNamesSorted();
		const standardLanguages = [
			"Common", "Dwarvish", "Elvish", "Giant", "Gnomish",
			"Goblin", "Halfling", "Orc", "Abyssal", "Celestial",
			"Draconic", "Deep Speech", "Infernal", "Primordial",
			"Sylvan", "Undercommon",
		];

		let availableLanguages;
		if (languages) {
			availableLanguages = languages.map(l => {
				const name = l.split("|")[0];
				return name.toTitleCase();
			});
			availableLanguages.sort((a, b) => {
				const aInAll = allLanguages.indexOf(a);
				const bInAll = allLanguages.indexOf(b);
				if (aInAll >= 0 && bInAll >= 0) return aInAll - bInAll;
				return a.localeCompare(b);
			});
		} else {
			availableLanguages = allLanguages.length > 0 ? allLanguages : standardLanguages;
		}

		const label = languages
			? `Choose ${count} language${count > 1 ? "s" : ""} from:`
			: `Choose any ${count} language${count > 1 ? "s" : ""}:`;

		const section = e_({outer: `
			<div class="charsheet__builder-subrace-lang-selection mt-2">
				<p><strong>${featureName}:</strong> ${label}</p>
				<div class="charsheet__builder-lang-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="subrace-lang-count">${this._selectedSubraceLanguages.length}</span>/${count}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-lang-checkboxes");

		const countEl = section.querySelector(".subrace-lang-count");
		const grouped = this._groupLanguagesByType(availableLanguages);
		this._renderLanguageCheckboxGroup(
			grouped,
			this._selectedSubraceLanguages,
			count,
			countEl,
			checkboxes,
			null,
			{excludeGroups: ["secret"]},
		);

		return section;
	}

	/**
	 * Get the total number of skill choices required by a race
	 * @param {Object} race - The race data
	 * @returns {number} - Total number of skill choices required
	 */
	_getRacialSkillChoiceCount (race) {
		let count = 0;
		if (race.skillProficiencies) {
			race.skillProficiencies.forEach(skillProf => {
				if (skillProf.choose) {
					count += skillProf.choose.count || 1;
				}
				if (skillProf.any) {
					count += skillProf.any;
				}
			});
		}
		return count;
	}

	/**
	 * Get the total number of tool choices required by a race
	 * @param {Object} race - The race data
	 * @returns {number} - Total number of tool choices required
	 */
	_getRacialToolChoiceCount (race) {
		let count = 0;
		if (race.toolProficiencies) {
			race.toolProficiencies.forEach(toolProf => {
				if (toolProf.choose) {
					count += toolProf.choose.count || 1;
				}
				if (toolProf.any) {
					count += toolProf.any;
				}
			});
		}
		return count;
	}

	/**
	 * Extract racial spell choices from additionalSpells data
	 * @param {Object} race - The race data
	 * @returns {Array} Array of {filter, ability, count, featureName} objects
	 */
	_getRacialSpellChoices (race) {
		const choices = [];
		if (!race.additionalSpells?.length) return choices;

		for (const spellBlock of race.additionalSpells) {
			// Skip subrace-specific spell blocks if they don't match
			if (spellBlock.name && race._subraceName && spellBlock.name.toLowerCase() !== race._subraceName.toLowerCase()) {
				continue;
			}

			// Get spellcasting ability
			let ability = null;
			if (spellBlock.ability) {
				if (typeof spellBlock.ability === "string") {
					ability = spellBlock.ability;
				} else if (spellBlock.ability.choose) {
					ability = spellBlock.ability.choose; // Array of options
				}
			}

			// Process "known" spells at character level 1
			if (spellBlock.known?.["1"]) {
				const spellsAtLevel = spellBlock.known["1"];
				this._extractSpellChoices(spellsAtLevel, ability, race.name, choices);
			}
		}

		return choices;
	}

	/**
	 * Recursively extract spell choices from a spell list structure
	 */
	_extractSpellChoices (spellList, ability, sourceName, choices) {
		if (!spellList) return;

		if (typeof spellList === "object" && !Array.isArray(spellList)) {
			// Handle "_" key
			if (spellList._) {
				this._extractSpellChoices(spellList._, ability, sourceName, choices);
			}
			// Handle "choose" specification
			if (spellList.choose) {
				choices.push({
					filter: spellList.choose,
					ability: ability,
					count: 1,
					featureName: sourceName,
				});
			}
		} else if (Array.isArray(spellList)) {
			spellList.forEach(item => {
				if (typeof item === "object" && item.choose) {
					choices.push({
						filter: item.choose,
						ability: item.ability || ability,
						count: item.count || 1,
						featureName: sourceName,
					});
				}
			});
		}
	}

	/**
	 * Render UI for racial spell choices
	 * @param {Object} race - The race data
	 * @returns {HTMLElement|null} - jQuery element containing spell choices, or null if none
	 */
	_renderRacialSpellChoices (race) {
		const choices = this._getRacialSpellChoices(race);
		if (choices.length === 0) return null;

		const container = e_({outer: `<div class="charsheet__builder-racial-spells mt-3"></div>`});

		choices.forEach((choice, choiceIdx) => {
			const section = this._renderRacialSpellChoice(choice, choiceIdx);
			container.append(section);
		});

		return container;
	}

	/**
	 * Render a single racial spell choice UI section
	 */
	_renderRacialSpellChoice (choice, choiceIdx) {
		// Parse the filter to get a description
		const filterParts = choice.filter.split("|");
		const levelPart = filterParts.find(p => p.startsWith("level="));
		const isCantrip = levelPart === "level=0";
		const spellType = isCantrip ? "cantrip" : "spell";

		// Check if ability is a choosable array
		const hasAbilityChoice = Array.isArray(choice.ability) && choice.ability.length > 1;

		// Get ability description for fixed ability
		let abilityDesc = "";
		if (!hasAbilityChoice && choice.ability) {
			const abi = Array.isArray(choice.ability) ? choice.ability[0] : choice.ability;
			abilityDesc = ` (${abi.toUpperCase()} as spellcasting ability)`;
		}

		const section = e_({outer: `
			<div class="charsheet__builder-racial-spell-selection mt-2">
				<p><strong>Racial ${spellType.toTitleCase()}:</strong> Choose ${choice.count} ${spellType}${abilityDesc}</p>
				<div class="charsheet__builder-spell-choice">
					<button class="btn btn-sm btn-outline-primary charsheet__builder-spell-btn">
						${this._selectedRacialSpells[choiceIdx] ? this._selectedRacialSpells[choiceIdx].name : `Select ${spellType}...`}
					</button>
					${this._selectedRacialSpells[choiceIdx] ? `<span class="ms-2 ve-muted">(${Parser.sourceJsonToAbv(this._selectedRacialSpells[choiceIdx].source)})</span>` : ""}
				</div>
			</div>
		`});

		// Add ability selector if multiple options
		if (hasAbilityChoice) {
			const currentAbility = this._selectedRacialSpellAbilities[choiceIdx] || choice.ability[0];
			const abilityRow = e_({outer: `
				<div class="charsheet__builder-spell-ability-choice mt-1">
					<label class="ve-small">
						Spellcasting Ability:
						<select class="ve-form-control form-control--minimal ve-inline-block w-auto ms-1">
							${choice.ability.map(ab => `<option value="${ab}" ${ab === currentAbility ? "selected" : ""}>${ab.toUpperCase()}</option>`).join("")}
						</select>
					</label>
				</div>
			`});

			abilityRow.querySelector("select").addEventListener("change", (e) => {
				this._selectedRacialSpellAbilities[choiceIdx] = e.target.value;
			});

			// Initialize the selection if not already set
			if (!this._selectedRacialSpellAbilities[choiceIdx]) {
				this._selectedRacialSpellAbilities[choiceIdx] = choice.ability[0];
			}

			section.querySelector(".charsheet__builder-spell-choice").after(abilityRow);
		}

		const btn = section.querySelector(".charsheet__builder-spell-btn");

		btn.addEventListener("click", async () => {
			await this._showRacialSpellPicker(choice, choiceIdx, btn, section);
		});

		return section;
	}

	/**
	 * Show spell picker modal for racial spell choice
	 */
	async _showRacialSpellPicker (choice, choiceIdx, btn, section) {
		if (!this._page._spells?.showFilteredSpellPicker) {
			JqueryUtil.doToast({type: "warning", content: "Spell data not loaded yet. Please wait..."});
			return;
		}

		const choiceObj = {
			filter: choice.filter,
			featureName: choice.featureName || "Racial Spell",
		};

		await this._page._spells.showFilteredSpellPicker(choiceObj, (spell) => {
			// Store the selected spell
			this._selectedRacialSpells[choiceIdx] = spell;

			// Update the button text
			btn.textContent = spell.name;

			// Add source indicator
			const existingSource = section.querySelector(".ve-muted");
			if (existingSource) {
				existingSource.textContent = `(${Parser.sourceJsonToAbv(spell.source)})`;
			} else {
				btn.after(e_({outer: `<span class="ms-2 ve-muted">(${Parser.sourceJsonToAbv(spell.source)})</span>`}));
			}
		});
	}

	/**
	 * Return the list of choosable optional features for a race's optionalfeatureProgression.
	 * Excludes auto-granted features and filters by prerequisites (otherSummary pattern).
	 * @param {Object} race
	 * @param {string[]} featureTypes - e.g. ["DW:C", "DW:S"]
	 * @param {Object} alreadyChosen - map of featureKey → [featObj] for previously made choices
	 * @returns {Object[]} Sorted/filtered list of available optional feature objects
	 */
	_getRaceOptFeatAvailableOptions (race, featureTypes, alreadyChosen) {
		const allOptFeatures = this._page.getOptionalFeatures?.() || [];
		const grantedNames = new Set((race.featureGrants || []).map(g => g.name));
		const chosenNames = new Set(Object.values(alreadyChosen).flat().map(f => f.name));
		const ownedNames = new Set([...grantedNames, ...chosenNames]);

		const matchesType = (optFeatTypes) => optFeatTypes?.some(ft => featureTypes.some(pt => ft === pt || ft.startsWith(pt)));

		return allOptFeatures.filter(opt => {
			if (!matchesType(opt.featureType)) return false;
			if (grantedNames.has(opt.name)) return false;
			if (opt.prerequisite) {
				for (const prereq of opt.prerequisite) {
					if (prereq.level) {
						const reqLevel = prereq.level.level || prereq.level;
						if (reqLevel > 1) return false;
					}
					if (prereq.otherSummary?.entrySummary) {
						if (!ownedNames.has(prereq.otherSummary.entrySummary)) return false;
					}
				}
			}
			return true;
		}).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Render optional feature choice UI for races that have optionalfeatureProgression.
	 * E.g., the Nyuidj race lets the player pick 1 Dreamwalker Ability (beyond the auto-granted Dreamwalk).
	 * Prerequisites using otherSummary are evaluated against featureGrants + already-chosen race features.
	 * @param {Object} race
	 * @returns {HTMLElement|null}
	 */
	_renderRaceOptionalFeatureChoices (race) {
		const progression = race.optionalfeatureProgression;
		if (!progression?.length) return null;

		const container = e_({outer: `<div class="charsheet__builder-race-opt-feats mt-3"></div>`});

		progression.forEach(optFeatProg => {
			// Determine how many choices at level 1
			let count = 0;
			if (Array.isArray(optFeatProg.progression)) {
				count = optFeatProg.progression[0] || 0;
			} else if (typeof optFeatProg.progression === "object") {
				count = optFeatProg.progression["1"] || optFeatProg.progression["*"] || 0;
			}
			if (count === 0) return;

			const featureTypes = optFeatProg.featureType || [];
			const name = optFeatProg.name || featureTypes.join(", ");
			const featureKey = `race_${featureTypes.join("_")}`;

			// Initialize storage
			if (!this._selectedRaceOptionalFeatures[featureKey]) {
				this._selectedRaceOptionalFeatures[featureKey] = [];
			}

			// Get available options using the extracted helper (also used for testing)
			const availableOptions = this._getRaceOptFeatAvailableOptions(race, featureTypes, this._selectedRaceOptionalFeatures);

			const section = e_({outer: `
				<div class="charsheet__builder-opt-feat-section mb-3">
					<p><strong>${name}:</strong> Choose ${count}</p>
					<div class="charsheet__builder-opt-feat-list" style="max-height: 200px; overflow-y: auto;"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="opt-feat-count">${this._selectedRaceOptionalFeatures[featureKey].length}</span>/${count}</div>
				</div>
			`});

			const list = section.querySelector(".charsheet__builder-opt-feat-list");

			availableOptions.sort((a, b) => a.name.localeCompare(b.name)).forEach(opt => {
				const isSelected = this._selectedRaceOptionalFeatures[featureKey].some(
					s => s.name === opt.name && s.source === opt.source,
				);
				const item = e_({outer: `
					<label class="charsheet__builder-opt-feat-item d-block mb-1" style="cursor: pointer;">
						<input type="checkbox" class="mr-2" ${isSelected ? "checked" : ""}>
						<span class="opt-feat-name"></span>
						<span class="ve-muted ve-small ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>
					</label>
				`});

				const optName = item.querySelector(".opt-feat-name");
				if (optName) {
					try {
						const resolvedSource = this._page.resolveOptionalFeatureSource?.(opt.name, [opt.source]) || opt.source;
						optName.innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_OPT_FEATURES, opt.name, resolvedSource);
					} catch (e) {
						optName.textContent = opt.name;
					}
				}

				const cbInput = item.querySelector("input");
				if (cbInput) {
					cbInput.addEventListener("change", (ev) => {
						if (ev.target.checked) {
							if (this._selectedRaceOptionalFeatures[featureKey].length < count) {
								this._selectedRaceOptionalFeatures[featureKey].push(opt);
							} else {
								ev.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} ${name}.`});
							}
						} else {
							this._selectedRaceOptionalFeatures[featureKey] = this._selectedRaceOptionalFeatures[featureKey].filter(
								s => !(s.name === opt.name && s.source === opt.source),
							);
						}
						const countEl = section.querySelector(".opt-feat-count");
						if (countEl) countEl.textContent = this._selectedRaceOptionalFeatures[featureKey].length;
					});
				}

				if (list) list.append(item);
			});

			container.append(section);
		});

		return container.children.length > 0 ? container : null;
	}

	_renderRacePreview (preview, race) {
		preview.innerHTML = "";

		const content = e_({outer: `
			<div>
				<h4>${race.name}</h4>
				<p class="ve-muted">${Parser.sourceJsonToFull(race.source)}</p>
			</div>
		`});

		// Ability scores
		if (race.ability?.length) {
			const abilityOptionTexts = race.ability.map(a => {
				const parts = [];
				// Fixed entries (e.g., cha: 2) — always show
				Object.entries(a)
					.filter(([k]) => k !== "choose" && Parser.ABIL_ABVS.includes(k))
					.forEach(([k, v]) => parts.push(`${k.toUpperCase()} +${v}`));
				// Choose entries
				if (a.choose) {
					const c = a.choose;
					if (c.weighted) {
						const weights = c.weighted.weights || [2, 1];
						const fromList = (c.weighted.from || Parser.ABIL_ABVS).map(ab => ab.toUpperCase()).join(", ");
						parts.push(`Choose ${weights.length}: +${weights.join("/+")} from ${fromList}`);
					} else {
						const fromList = (c.from || Parser.ABIL_ABVS).map(ab => ab.toUpperCase()).join(", ");
						parts.push(`Choose ${c.count || 1}: +${c.amount || 1} from ${fromList}`);
					}
				}
				return parts.join(", ");
			});

			if (abilityOptionTexts.filter(Boolean).length) {
				const abilityStr = abilityOptionTexts.length > 1
					? abilityOptionTexts.join(" <em>or</em> ")
					: abilityOptionTexts[0];
				content.append(e_({outer: `<p><strong>Ability Scores:</strong> ${abilityStr}</p>`}));
			}
		}

		// Ability score choice UI (for races with choose-based ASI)
		const asiChoices = this._renderRaceAbilityChoices(race);
		if (asiChoices) {
			content.append(asiChoices);
		}

		// Speed
		if (race.speed) {
			const speedStr = typeof race.speed === "number" ? `${race.speed} ft.` : `${race.speed.walk || 30} ft.`;
			content.append(e_({outer: `<p><strong>Speed:</strong> ${speedStr}</p>`}));
		}

		// Size
		if (race.size) {
			const sizeStr = race.size.map(s => Parser.sizeAbvToFull(s)).join(" or ");
			content.append(e_({outer: `<p><strong>Size:</strong> ${sizeStr}</p>`}));
		}

		// Traits
		if (race.entries) {
			const traits = e_({outer: `<div class="mt-2"><strong>Traits:</strong></div>`});
			race.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					traits.append(e_({outer: `<div class="mb-1"><em>${entry.name}.</em> ${Renderer.get().render({entries: entry.entries || []})}</div>`}));
				}
			});
			content.append(traits);
		}

		// Racial proficiency choices (skills, tools)
		const profChoices = this._renderRacialProficiencyChoices(race);
		if (profChoices) {
			content.append(profChoices);
		}

		// Racial spell choices (e.g., Child of the Empire cantrip)
		const spellChoices = this._renderRacialSpellChoices(race);
		if (spellChoices) {
			content.append(spellChoices);
		}

		// Race-level optional feature choices (e.g., Nyuidj Dreamwalker Ability)
		const optFeatureChoices = this._renderRaceOptionalFeatureChoices(race);
		if (optFeatureChoices) {
			content.append(optFeatureChoices);
		}

		// Subraces
		if (race.subraces?.length) {
			const subraces = e_({outer: `
				<div class="mt-3">
					<strong>Subrace:</strong>
					<select class="ve-form-control form-control--minimal mt-1" id="builder-subrace-select">
						<option value="">-- Select Subrace --</option>
					</select>
				</div>
			`});

			const select = subraces.querySelector("select");
			race.subraces.forEach((subrace, idx) => {
				select.append(e_({outer: `<option value="${idx}">${subrace.name}</option>`}));
			});

			select.addEventListener("change", (e) => {
				const idx = e.target.value;
				if (idx !== "") {
					this._selectedSubrace = race.subraces[parseInt(idx)];
					// Clear previous subrace language selections
					this._selectedSubraceLanguages = [];
				} else {
					this._selectedSubrace = null;
					this._selectedSubraceLanguages = [];
				}
				// Re-render to show subrace proficiency choices
				this._renderRacePreview(preview, race);
			});

			// Pre-select if already chosen
			if (this._selectedSubrace) {
				const idx = race.subraces.findIndex(s => s.name === this._selectedSubrace.name);
				if (idx >= 0) select.value = idx;
			}

			content.append(subraces);
		}

		// Subrace-specific proficiency choices (e.g., Hub Residence Trilingual)
		if (this._selectedSubrace) {
			const subraceProfChoices = this._renderSubraceProficiencyChoices(this._selectedSubrace);
			if (subraceProfChoices) {
				content.append(subraceProfChoices);
			}
		}

		preview.append(content);
	}
	// #endregion

	// #region Step 2: Class
	_renderClassStep (content) {
		// Get classes filtered by allowed sources
		const classes = this._page.filterByAllowedSources(this._page.getClasses());

		const container = e_({outer: `
			<div class="charsheet__builder-selection">
				<div class="charsheet__builder-list">
					<div class="charsheet__builder-list-header">
						<input type="text" class="ve-form-control form-control--minimal" placeholder="Search classes..." id="builder-class-search">
					</div>
					<div class="charsheet__builder-list-content" id="builder-class-list"></div>
				</div>
				<div class="charsheet__builder-preview" id="builder-class-preview">
					<div class="charsheet__builder-preview-placeholder">Select a class to see details</div>
				</div>
			</div>
		`});

		content.append(container);

		const list = document.getElementById("builder-class-list");
		const preview = document.getElementById("builder-class-preview");
		const search = document.getElementById("builder-class-search");

		const renderClassList = (filter = "") => {
			list.innerHTML = "";
			const filterLower = filter.toLowerCase();

			classes
				.filter(cls => !filter || cls.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.forEach(cls => {
					const isSelected = this._selectedClass?.name === cls.name && this._selectedClass?.source === cls.source;
					const item = e_({outer: `
						<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
							<span class="charsheet__builder-list-item-name">${cls.name}</span>
							<span class="charsheet__builder-list-item-source">${Parser.sourceJsonToAbv(cls.source)}</span>
						</div>
					`});

					item.addEventListener("click", () => {
						list.querySelectorAll(".charsheet__builder-list-item").forEach(el => el.classList.remove("active"));
						item.classList.add("active");
						this._selectedClass = cls;
						this._selectedSubclass = null;
						// Reset skill selections when changing class
						this._selectedSkills = [];
						// Reset expertise selections when changing class
						this._selectedExpertise = [];
						// Reset class feature language selections when changing class
						this._selectedClassFeatureLanguages = [];
						// Reset weapon mastery selections when changing class
						this._selectedWeaponMasteries = [];
						// Reset equipment choices when changing class
						this._equipmentChoices = {};
						this._equipmentTypeChoices = {};
						this._useGoldAlternative = false;
						// Reset optional features when changing class
						this._selectedOptionalFeatures = {};
						// Reset feature options when changing class
						this._selectedFeatureOptions = {};
						// Reset combat traditions when changing class
						this._selectedCombatTraditions = [];
						// Reset spell selections when changing class
						this._selectedKnownSpells = [];
						this._selectedKnownCantrips = [];
						this._selectedSpellbookSpells = [];
						this._selectedClassToolProficiencies = [];
						this._divineSoulAffinity = null;
						this._renderClassPreview(preview, cls);
					});

					list.append(item);
				});
		};

		search.addEventListener("input", (e) => renderClassList(e.target.value));
		renderClassList();

		if (this._selectedClass) {
			this._renderClassPreview(preview, this._selectedClass);
		}
	}

	_renderClassPreview (preview, cls) {
		preview.innerHTML = "";

		const hitDie = cls.hd?.faces || 8;

		const content = e_({outer: `
			<div>
				<h4>${cls.name}</h4>
				<p class="ve-muted">${Parser.sourceJsonToFull(cls.source)}</p>
				<p><strong>Hit Die:</strong> d${hitDie}</p>
			</div>
		`});

		// Primary ability
		if (cls.primaryAbility) {
			const abilityStr = cls.primaryAbility.map(a => {
				return Object.entries(a)
					.filter(([k]) => Parser.ABIL_ABVS.includes(k))
					.map(([k]) => Parser.attAbvToFull(k))
					.join(" or ");
			}).join(", ");
			content.append(e_({outer: `<p><strong>Primary Ability:</strong> ${abilityStr}</p>`}));
		}

		// Saving throws
		if (cls.proficiency) {
			const saves = cls.proficiency.map(p => Parser.attAbvToFull(p)).join(", ");
			content.append(e_({outer: `<p><strong>Saving Throws:</strong> ${saves}</p>`}));
		}

		// Armor
		if (cls.startingProficiencies?.armor) {
			const armor = cls.startingProficiencies.armor.map(a => typeof a === "string" ? a : a.full).join(", ");
			// Render through Renderer to handle any tags
			content.append(e_({outer: `<p><strong>Armor:</strong> ${Renderer.get().render(armor)}</p>`}));
		}

		// Weapons
		if (cls.startingProficiencies?.weapons) {
			const weapons = cls.startingProficiencies.weapons.map(w => typeof w === "string" ? w : w.full).join(", ");
			// Render through Renderer to handle {@filter} and other tags
			content.append(e_({outer: `<p><strong>Weapons:</strong> ${Renderer.get().render(weapons)}</p>`}));
		}

		// Tools
		if (cls.startingProficiencies?.tools) {
			const tools = cls.startingProficiencies.tools.map(t => typeof t === "string" ? t : t.full).join(", ");
			content.append(e_({outer: `<p><strong>Tools:</strong> ${Renderer.get().render(tools)}</p>`}));
		}

		// Tool proficiency choices (structured data — e.g., Monk: choose artisan OR instrument)
		if (cls.startingProficiencies?.toolProficiencies) {
			const toolChoiceSection = this._renderClassToolProficiencyChoice(cls);
			if (toolChoiceSection) content.append(toolChoiceSection);
		}

		// Skills selection
		if (cls.startingProficiencies?.skills) {
			const skillChoices = cls.startingProficiencies.skills;
			const skillSection = this._renderClassSkillSelection(cls, skillChoices);
			content.append(skillSection);
		}

		// Expertise selection (for classes with early expertise: Rogue level 1, Ranger level 1-2, etc.)
		const expertiseInfo = this._getClassExpertiseInfoEarlyLevels(cls);
		if (expertiseInfo && expertiseInfo.count > 0) {
			const expertiseSection = this._renderExpertiseSelection(cls, expertiseInfo);
			content.append(expertiseSection);
		}

		// Class feature language grants (like Deft Explorer)
		const classLangInfo = this._getClassFeatureLanguageGrants(cls);
		if (classLangInfo && classLangInfo.count > 0) {
			const langSection = this._renderClassFeatureLanguageSelection(cls, classLangInfo);
			content.append(langSection);
		}

		// Weapon Mastery selection (for Fighter, Paladin, Ranger, Rogue at level 1)
		const weaponMasteryInfo = this._getClassWeaponMasteryInfo(cls, 1);
		if (weaponMasteryInfo && weaponMasteryInfo.count > 0) {
			const masterySection = this._renderWeaponMasterySelection(cls, weaponMasteryInfo);
			content.append(masterySection);
		}

		// Optional features selection (invocations, metamagic, etc.)
		if (cls.optionalfeatureProgression?.length) {
			const optFeatSection = this._renderClassOptionalFeatures(cls);
			content.append(optFeatSection);
		}

		// Feature options selection (specialties, etc. - features with embedded type: "options")
		const featureOptionsSection = this._renderClassFeatureOptions(cls, 1);
		if (featureOptionsSection) {
			content.append(featureOptionsSection);
		}

		// Spellcasting
		if (cls.spellcastingAbility) {
			content.append(e_({outer: `<p><strong>Spellcasting:</strong> ${Parser.attAbvToFull(cls.spellcastingAbility)}</p>`}));
		}

		// Quick Build target level
		const quickBuildSection = e_({outer: `
			<div class="charsheet__builder-feat-opt-section mt-3">
				<div class="charsheet__builder-feat-opt-header">
					<span class="charsheet__builder-feat-opt-header-name">⚡ Quick Build — Start at Higher Level</span>
				</div>
				<p class="ve-small ve-muted mb-2">Optionally start your character at a higher level. All leveling choices will be collected in a guided wizard after building.</p>
				<div class="ve-flex-v-center gap-2">
					<label class="ve-small ve-bold mb-0">Target Level:</label>
					<input type="range" class="form-control-range" min="1" max="20" value="${this._quickBuildTargetLevel || 1}" style="flex: 1;" id="builder-quickbuild-level-slider">
					<span class="charsheet__quickbuild-level-display ve-bold" style="min-width:30px; text-align:center; font-size:1.2rem; color: var(--cs-primary, #6366f1);" id="builder-quickbuild-level-display">${this._quickBuildTargetLevel || 1}</span>
				</div>
				<div class="ve-small ve-muted mt-1" id="builder-quickbuild-info">
					${(this._quickBuildTargetLevel || 1) > 1 ? `After building at level 1, Quick Build wizard will guide you through leveling to ${this._quickBuildTargetLevel}.` : "Level 1 — standard character creation (no Quick Build)."}
				</div>
			</div>
		`});

		quickBuildSection.querySelector("#builder-quickbuild-level-slider").addEventListener("input", (e) => {
			const val = parseInt(e.target.value);
			this._quickBuildTargetLevel = val;
			quickBuildSection.querySelector("#builder-quickbuild-level-display").textContent = val;
			const info = quickBuildSection.querySelector("#builder-quickbuild-info");
			if (val > 1) {
				info.innerHTML = `After building at level 1, Quick Build wizard will guide you through leveling to <strong>${val}</strong>.`;
			} else {
				info.textContent = "Level 1 — standard character creation (no Quick Build).";
			}
		});

		content.append(quickBuildSection);

		preview.append(content);
	}

	/**
	 * Render tool proficiency choice UI for class starting proficiencies.
	 * Handles anyArtisansTool/anyMusicalInstrument structured data.
	 */
	_renderClassToolProficiencyChoice (cls) {
		const toolProfs = cls.startingProficiencies.toolProficiencies;
		let anyArtisanCount = 0;
		let anyMusicalCount = 0;

		for (const tp of toolProfs) {
			if (tp.anyArtisansTool) anyArtisanCount += tp.anyArtisansTool;
			if (tp.anyMusicalInstrument) anyMusicalCount += tp.anyMusicalInstrument;
		}

		// Common case: choose 1 artisan OR 1 musical instrument (Monk)
		if (anyArtisanCount === 1 && anyMusicalCount === 1) {
			const section = e_({outer: `<div class="charsheet__builder-tool-choice mt-2"></div>`});
			section.append(e_({outer: `<p class="mb-1"><strong>Tool Proficiency:</strong> Choose one artisan's tool or musical instrument</p>`}));

			const artisanTools = Renderer.generic.FEATURE__TOOLS_ARTISANS || [];
			const musicalInstruments = Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS || [];

			const categorySelect = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1">
					<option value="">-- Select Category --</option>
					<option value="artisan">Artisan's Tools</option>
					<option value="instrument">Musical Instrument</option>
				</select>
			`});

			const toolSelect = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" style="display: none;">
					<option value="">-- Select Tool --</option>
				</select>
			`});

			// Pre-select if already chosen
			const existing = this._selectedClassToolProficiencies.find(t => t.isArtisanOrInstrument);
			const populateToolSelect = (category) => {
				toolSelect.innerHTML = ""; toolSelect.append(e_({outer: `<option value="">-- Select ${category === "artisan" ? "Artisan's Tool" : "Musical Instrument"} --</option>`}));
				const tools = category === "artisan" ? artisanTools : musicalInstruments;
				tools.forEach(tool => {
					toolSelect.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`}));
				});
				toolSelect.style.display = "";
			};

			if (existing) {
				const cat = existing.isArtisan ? "artisan" : "instrument";
				categorySelect.value = cat;
				populateToolSelect(cat);
				toolSelect.value = existing.tool;
			}

			categorySelect.addEventListener("change", (e) => {
				this._selectedClassToolProficiencies = this._selectedClassToolProficiencies.filter(t => !t.isArtisanOrInstrument);
				if (e.target.value) {
					populateToolSelect(e.target.value);
				} else {
					toolSelect.style.display = "none";
				}
			});

			toolSelect.addEventListener("change", (e) => {
				this._selectedClassToolProficiencies = this._selectedClassToolProficiencies.filter(t => !t.isArtisanOrInstrument);
				const category = categorySelect.value;
				if (e.target.value) {
					this._selectedClassToolProficiencies.push({
						tool: e.target.value,
						isArtisan: category === "artisan",
						isMusicalInstrument: category === "instrument",
						isArtisanOrInstrument: true,
					});
				}
			});

			section.append(categorySelect, toolSelect);
			return section;
		}

		// Fallback: individual artisan/instrument pickers
		if (anyArtisanCount > 0 || anyMusicalCount > 0) {
			const section = e_({outer: `<div class="charsheet__builder-tool-choice mt-2"></div>`});
			section.append(e_({outer: `<p class="mb-1"><strong>Tool Proficiency Choices:</strong></p>`}));

			for (let i = 0; i < anyArtisanCount; i++) {
				const tools = Renderer.generic.FEATURE__TOOLS_ARTISANS || [];
				const select = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Artisan's Tool --</option></select>`});
				tools.forEach(tool => select.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`})));

				const existing = this._selectedClassToolProficiencies.find(t => t.isArtisan && t.idx === i);
				if (existing) select.value = existing.tool;

				select.addEventListener("change", (e) => {
					this._selectedClassToolProficiencies = this._selectedClassToolProficiencies.filter(t => !(t.isArtisan && t.idx === i));
					if (e.target.value) {
						this._selectedClassToolProficiencies.push({tool: e.target.value, isArtisan: true, idx: i});
					}
				});
				section.append(select);
			}

			for (let i = 0; i < anyMusicalCount; i++) {
				const instruments = Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS || [];
				const select = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Musical Instrument --</option></select>`});
				instruments.forEach(tool => select.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`})));

				const existing = this._selectedClassToolProficiencies.find(t => t.isMusicalInstrument && t.idx === i);
				if (existing) select.value = existing.tool;

				select.addEventListener("change", (e) => {
					this._selectedClassToolProficiencies = this._selectedClassToolProficiencies.filter(t => !(t.isMusicalInstrument && t.idx === i));
					if (e.target.value) {
						this._selectedClassToolProficiencies.push({tool: e.target.value, isMusicalInstrument: true, idx: i});
					}
				});
				section.append(select);
			}

			return section;
		}

		return null;
	}

	_renderClassSkillSelection (cls, skillChoices) {
		// Parse skill choices - typically like {choose: {from: ["athletics", "acrobatics"], count: 2}}
		// or {any: 3} for Bard
		let availableSkills = [];
		let chooseCount = 2;

		// Get skills dynamically from loaded data (supports homebrew)
		const allSkills = this._page.getSkillsList();

		skillChoices.forEach(skillChoice => {
			if (skillChoice.choose) {
				if (skillChoice.choose.from) {
					availableSkills = skillChoice.choose.from;
				}
				if (skillChoice.choose.count) {
					chooseCount = skillChoice.choose.count;
				}
			} else if (skillChoice.any) {
				// "any" means choose from all skills (like Bard)
				chooseCount = skillChoice.any;
				availableSkills = allSkills.map(s => s.name.toLowerCase().replace(/\s+/g, ""));
			} else {
				// Fixed skills
				availableSkills = Object.keys(skillChoice).filter(k => k !== "choose" && k !== "any");
			}
		});

		// Match available skills to proper names (strip source suffix like "might|TGTT" -> "might")
		const formattedSkills = availableSkills.map(skill => {
			// Remove source suffix if present (e.g., "might|TGTT" -> "might")
			const skillNameOnly = skill.split("|")[0];
			const match = allSkills.find(s => s.name.toLowerCase().replace(/\s+/g, "") === skillNameOnly.toLowerCase().replace(/\s+/g, ""));
			return match?.name || skillNameOnly.toTitleCase();
		});

		const section = e_({outer: `
			<div class="charsheet__builder-skill-selection mt-3">
				<p><strong>Skills:</strong> Choose ${chooseCount} from:</p>
				<div class="charsheet__builder-skill-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="skill-count">${this._selectedSkills.length}</span>/${chooseCount}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-skill-checkboxes");
		const takenByOthers = this._getSkillsFromOtherSources("class");

		// Remove any prior class selections now taken by another source
		this._selectedSkills = this._selectedSkills.filter(s => !takenByOthers.has(s));
		section.querySelector(".skill-count").textContent = this._selectedSkills.length;

		formattedSkills.forEach(skill => {
			const isSelected = this._selectedSkills.includes(skill);
			const takenSource = takenByOthers.get(skill);
			const lbl = e_({outer: `
				<label class="charsheet__builder-skill-checkbox mr-3 mb-1${takenSource ? " ve-muted" : ""}">
					<input type="checkbox" value="${skill}" ${isSelected ? "checked" : ""}${takenSource ? " disabled" : ""}>
					${skill}${takenSource ? ` <span class="ve-small">(${takenSource})</span>` : ""}
				</label>
			`});

			if (!takenSource) {
				lbl.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedSkills.length < chooseCount) {
							this._selectedSkills.push(skill);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${chooseCount} skills.`});
						}
					} else {
						this._selectedSkills = this._selectedSkills.filter(s => s !== skill);
						// Also remove from expertise if it was selected
						this._selectedExpertise = this._selectedExpertise.filter(s => s !== skill);
					}
					section.querySelector(".skill-count").textContent = this._selectedSkills.length;
					// Update expertise section to reflect new available skills
					this._updateExpertiseSection(cls);
				});
			}

			checkboxes.append(lbl);
		});

		return section;
	}

	/**
	 * Update expertise section when skills change
	 */
	_updateExpertiseSection (cls) {
		const expertiseInfo = this._getClassExpertiseInfoEarlyLevels(cls);
		if (!expertiseInfo || expertiseInfo.count === 0) return;

		const container = document.querySelector(".charsheet__builder-expertise-selection");
		if (!container) return;

		// Replace with new section
		const newSection = this._renderExpertiseSelection(cls, expertiseInfo);
		container.replaceWith(newSection);
	}

	/**
	 * Get expertise info from class features at early levels (1-2)
	 * Some classes get expertise at level 1 (Rogue), others at level 2 (XPHB Ranger).
	 * This checks both levels during character creation.
	 * @param {Object} cls - Class data
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	_getClassExpertiseInfoEarlyLevels (cls) {
		// During character creation (builder), only check level 1 features
		// Level 2+ features (like Wizard Scholar) should be offered at level-up
		const expertiseInfo = this._getClassExpertiseInfo(cls, 1);
		if (expertiseInfo) return expertiseInfo;

		// Fallback: For homebrew classes, check feature entries directly for expertise text
		// but ONLY at level 1
		return this._getClassExpertiseInfoFromEntries(cls, 1);
	}

	/**
	 * Get expertise info by directly scanning feature entries (fallback for homebrew)
	 * @param {Object} cls - Class data
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	_getClassExpertiseInfoFromEntries (cls, maxLevel = 2) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length) return null;

		// Find all features for this class up to maxLevel
		const earlyFeatures = classFeatures.filter(f => {
			if (f.className !== cls.name) return false;
			if (f.level > maxLevel) return false;
			// For homebrew, classSource might not match exactly - be lenient
			return true;
		});

		// Check each feature's entries for expertise-granting text
		for (const feature of earlyFeatures) {
			if (!feature.entries?.length) continue;

			// Check if this feature or any of its sub-entries grant expertise
			const expertiseInfo = this._findExpertiseInEntries(feature.entries);
			if (expertiseInfo) return expertiseInfo;

			// Also check the top-level entries directly
			if (this._entryGrantsExpertise(feature.entries)) {
				return this._parseExpertiseEntries(feature.entries);
			}
		}

		return null;
	}

	/**
	 * Get expertise info from class features (feature-based, supports homebrew)
	 * Looks at the class's classFeatures array to find expertise grants at the specified level.
	 * Handles both dedicated "Expertise" features and features with nested expertise entries (like Deft Explorer).
	 * @param {Object} cls - Class data
	 * @param {number} level - Level to check for expertise
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	_getClassExpertiseInfo (cls, level) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length || !cls.classFeatures?.length) return null;

		// Get the class's feature references for this level
		const levelFeatures = this._getClassFeatureRefsAtLevel(cls, level);
		if (!levelFeatures.length) return null;

		// Look for expertise in these features
		for (const featureRef of levelFeatures) {
			const expertiseInfo = this._extractExpertiseFromFeatureRef(featureRef, classFeatures, cls);
			if (expertiseInfo) return expertiseInfo;
		}

		return null;
	}

	/**
	 * Get feature references from a class at a specific level
	 * @param {Object} cls - Class data
	 * @param {number} level - Level to check
	 * @returns {Array} Array of feature reference strings
	 */
	_getClassFeatureRefsAtLevel (cls, level) {
		const features = [];

		for (const f of cls.classFeatures) {
			let featureStr;
			if (typeof f === "string") {
				featureStr = f;
			} else if (typeof f === "object" && f.classFeature) {
				featureStr = f.classFeature;
			} else {
				continue;
			}

			// Parse "FeatureName|ClassName|Source|Level" format
			const parts = featureStr.split("|");
			const featureLevel = parseInt(parts[3]) || 1;
			if (featureLevel === level) {
				features.push(featureStr);
			}
		}

		return features;
	}

	/**
	 * Extract expertise info from a feature reference
	 * @param {string} featureRef - Feature reference string like "Expertise|Rogue|XPHB|1" or "Deft Explorer|Ranger||1|TCE"
	 * Format: FeatureName|ClassName|ClassSource|Level|FeatureSource
	 * @param {Array} allFeatures - All loaded class features
	 * @param {Object} cls - Class data for context
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	_extractExpertiseFromFeatureRef (featureRef, allFeatures, cls) {
		const parts = featureRef.split("|");
		const featureName = parts[0];
		const className = parts[1] || cls.name;
		const classSource = parts[2] || cls.source || Parser.SRC_PHB;
		const featureLevel = parseInt(parts[3]) || 1;
		// Feature source is at position 4 if present, otherwise defaults to class source
		const featureSource = parts[4] || classSource;

		// Find the actual feature data
		const featureData = allFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== featureLevel) return false;
			// Match class source
			const fClassSource = f.classSource || Parser.SRC_PHB;
			if (classSource && fClassSource !== classSource) return false;
			// Match feature source
			if (featureSource && f.source && f.source !== featureSource) return false;
			return true;
		});

		if (!featureData) return null;

		// Check if this feature IS an Expertise feature
		if (featureName === "Expertise") {
			return this._parseExpertiseEntries(featureData.entries || []);
		}

		// Check if this feature CONTAINS an Expertise entry (like Deft Explorer)
		return this._findExpertiseInEntries(featureData.entries || []);
	}

	/**
	 * Recursively search entries for nested Expertise grants
	 * @param {Array} entries - Feature entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	_findExpertiseInEntries (entries) {
		for (const entry of entries) {
			if (typeof entry === "object" && entry.type === "entries") {
				// Check if this sub-entry's name is "Expertise"
				if (entry.name === "Expertise") {
					return this._parseExpertiseEntries(entry.entries || []);
				}
				// Check if this sub-entry's TEXT grants expertise (e.g., "proficiency bonus is doubled")
				if (this._entryGrantsExpertise(entry.entries || [])) {
					return this._parseExpertiseEntries(entry.entries || []);
				}
				// Recursively check nested entries
				if (entry.entries) {
					const result = this._findExpertiseInEntries(entry.entries);
					if (result) return result;
				}
			}
		}
		return null;
	}

	/**
	 * Check if entries text indicates an expertise grant
	 * @param {Array} entries - Feature entries to check
	 * @returns {boolean}
	 */
	_entryGrantsExpertise (entries) {
		const entriesText = entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();
		// Check for common expertise-granting patterns:
		// - "proficiency bonus is doubled" (TCE wording)
		// - "gain expertise" (XPHB wording)
		// - "double your proficiency bonus" (alternate wording)
		return entriesText.includes("proficiency bonus is doubled")
			|| entriesText.includes("gain expertise")
			|| entriesText.includes("double your proficiency bonus");
	}

	/**
	 * Parse expertise entries to determine count and tool allowance
	 * @param {Array} entries - Expertise feature entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}}
	 */
	_parseExpertiseEntries (entries) {
		const entriesText = entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();

		// Determine count - look for expertise-specific patterns
		// We need to be careful: "two languages" shouldn't affect expertise count
		// Look for patterns like "one of your skill proficiencies" or "two skill proficiencies"
		let count = 1; // Default to 1 for safety

		// Check for specific expertise-granting patterns
		// "choose two skills" or "two of your skill proficiencies"
		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:two|2)\s+(?:skills?|proficienc)/i)
			|| entriesText.match(/two\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 2;
		}
		// "choose one skill" or "one of your skill proficiencies" (this should take precedence)
		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:one|1|a)\s+(?:skill|proficienc)/i)
			|| entriesText.match(/one\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 1;
		}
		// Explicit number mentions with expertise
		if (entriesText.includes("three") && entriesText.includes("expertise")) count = 3;
		if (entriesText.includes("four") && entriesText.includes("expertise")) count = 4;

		// Check if tools are allowed (PHB wording vs XPHB wording)
		// PHB: "two of your skill proficiencies, or one of your skill proficiencies and your proficiency with thieves' tools"
		// XPHB: "two of your skill proficiencies" (no tools option) - uses variantrule tag
		const allowTools = entriesText.includes("thieves' tools") && !entriesText.includes("variantrule");

		return {
			count,
			allowTools,
			toolName: allowTools ? "Thieves' Tools" : null,
		};
	}

	/**
	 * Render expertise selection UI
	 * @param {Object} cls - Class data
	 * @param {{count: number, allowTools: boolean, toolName: string}} expertiseInfo - Expertise requirements
	 */
	_renderExpertiseSelection (cls, expertiseInfo) {
		const {count, allowTools, toolName} = expertiseInfo;

		const section = e_({outer: `
			<div class="charsheet__builder-expertise-selection mt-3">
				<p><strong>Expertise:</strong> Choose ${count} skills you're proficient in to gain expertise (double proficiency bonus):</p>
				${allowTools ? `<p class="ve-small ve-muted">You may also choose ${toolName} if you're proficient with it.</p>` : ""}
				<div class="charsheet__builder-expertise-checkboxes"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="expertise-count">${this._selectedExpertise.length}</span>/${count}</div>
			</div>
		`});

		const checkboxes = section.querySelector(".charsheet__builder-expertise-checkboxes");

		// Get available skills - must be skills the player is proficient in
		// This includes class skills being selected AND background/racial skills already applied to state
		const availableSkills = new Set([...this._selectedSkills]);

		// Add skills from state (background, racial proficiencies applied in earlier steps)
		const stateSkills = this._state.getSkillProficiencies();
		if (stateSkills) {
			Object.entries(stateSkills).forEach(([skill, level]) => {
				if (level >= 1) {
					// Convert skill key back to display name
					const skillName = skill.replace(/([A-Z])/g, " $1").trim().toTitleCase();
					availableSkills.add(skillName);
				}
			});
		}

		// Also add racial skills that were selected
		if (this._selectedRacialSkills?.length) {
			this._selectedRacialSkills.forEach(skill => availableSkills.add(skill));
		}

		// Optionally add thieves' tools for Rogue
		if (allowTools && toolName) {
			availableSkills.add(toolName);
		}

		const sortedSkills = [...availableSkills].sort();

		if (sortedSkills.length === 0) {
			checkboxes.append(e_({outer: `<p class="ve-muted">Select your skill proficiencies first.</p>`}));
		} else {
			sortedSkills.forEach(skill => {
				const isSelected = this._selectedExpertise.includes(skill);
				const lbl = e_({outer: `
					<label class="charsheet__builder-skill-checkbox mr-3 mb-1">
						<input type="checkbox" value="${skill}" ${isSelected ? "checked" : ""}>
						${skill}
					</label>
				`});

				lbl.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedExpertise.length < count) {
							this._selectedExpertise.push(skill);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} skills for expertise.`});
						}
					} else {
						this._selectedExpertise = this._selectedExpertise.filter(s => s !== skill);
					}
					section.querySelector(".expertise-count").textContent = this._selectedExpertise.length;
				});

				checkboxes.append(lbl);
			});
		}

		return section;
	}

	/**
	 * Get language grants from class features at early levels (1-2)
	 * Features like Deft Explorer grant additional languages.
	 * @param {Object} cls - Class data
	 * @returns {{count: number, featureName: string}|null}
	 */
	_getClassFeatureLanguageGrants (cls) {
		// Check levels 1 and 2 for language-granting features
		for (const level of [1, 2]) {
			const langInfo = this._getClassFeatureLanguageGrantsAtLevel(cls, level);
			if (langInfo) return langInfo;
		}
		return null;
	}

	/**
	 * Get language grants from class features at a specific level
	 * @param {Object} cls - Class data
	 * @param {number} level - Level to check
	 * @returns {{count: number, featureName: string}|null}
	 */
	_getClassFeatureLanguageGrantsAtLevel (cls, level) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length || !cls.classFeatures?.length) return null;

		// Get the class's feature references for this level
		const levelFeatures = this._getClassFeatureRefsAtLevel(cls, level);
		if (!levelFeatures.length) return null;

		// Look for language grants in these features
		for (const featureRef of levelFeatures) {
			const langInfo = this._extractLanguageGrantsFromFeatureRef(featureRef, classFeatures, cls);
			if (langInfo) return langInfo;
		}

		return null;
	}

	/**
	 * Extract language grants from a feature reference
	 * @param {string} featureRef - Feature reference string
	 * @param {Array} allFeatures - All loaded class features
	 * @param {Object} cls - Class data for context
	 * @returns {{count: number, featureName: string}|null}
	 */
	_extractLanguageGrantsFromFeatureRef (featureRef, allFeatures, cls) {
		const parts = featureRef.split("|");
		const featureName = parts[0];
		const className = parts[1] || cls.name;
		const classSource = parts[2] || cls.source || Parser.SRC_PHB;
		const featureLevel = parseInt(parts[3]) || 1;
		const featureSource = parts[4] || classSource;

		// Find the actual feature data
		const featureData = allFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== featureLevel) return false;
			const fClassSource = f.classSource || Parser.SRC_PHB;
			if (classSource && fClassSource !== classSource) return false;
			if (featureSource && f.source && f.source !== featureSource) return false;
			return true;
		});

		if (!featureData) return null;

		// Delegate to the shared utility (has name-based checks + all regex patterns)
		const result = CharacterSheetClassUtils.findLanguageGrantsInFeature(featureData);
		if (result) {
			return {...result, featureName};
		}
		return null;
	}

	/**
	 * Recursively search entries for language grants
	 * @param {Array} entries - Feature entries
	 * @param {string} featureName - Name of the feature for reference
	 * @returns {{count: number, featureName: string}|null}
	 */
	_findLanguageGrantsInEntries (entries, featureName) {
		const entriesText = entries.map(e => {
			if (typeof e === "string") return e;
			if (typeof e === "object" && e.type === "list" && e.items) {
				return e.items.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
			}
			return JSON.stringify(e);
		}).join(" ").toLowerCase();

		// Check for language-granting patterns
		// - "you learn two languages" (TGTT Deft Explorer)
		// - "speak, read, and write two additional languages" (TCE Deft Explorer)
		// - "learn X languages"
		const langPatterns = [
			/learn\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/speak,?\s*read,?\s*and\s*write\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/two\s+(?:additional\s+)?languages\s+of\s+your\s+choice/i,
			/\{@b Languages\.\}\s*You\s+learn\s+(one|two|three|four|\d+)\s+languages?/i,
		];

		for (const pattern of langPatterns) {
			const match = entriesText.match(pattern);
			if (match) {
				let count = 0;
				const numWord = match[1]?.toLowerCase();
				if (numWord === "one" || numWord === "1") count = 1;
				else if (numWord === "two" || numWord === "2") count = 2;
				else if (numWord === "three" || numWord === "3") count = 3;
				else if (numWord === "four" || numWord === "4") count = 4;
				else if (/^\d+$/.test(numWord)) count = parseInt(numWord);

				// Special case for "two additional languages of your choice" without capture group
				if (count === 0 && entriesText.includes("two additional languages")) count = 2;
				if (count === 0 && entriesText.includes("two languages of your choice")) count = 2;

				if (count > 0) {
					return {count, featureName};
				}
			}
		}

		// Recursively check nested entries
		for (const entry of entries) {
			if (typeof entry === "object" && entry.entries) {
				const result = this._findLanguageGrantsInEntries(entry.entries, featureName);
				if (result) return result;
			}
		}

		return null;
	}

	/**
	 * Render language selection UI for class features
	 * @param {Object} cls - Class data
	 * @param {{count: number, featureName: string}} langInfo - Language grant info
	 */
	_renderClassFeatureLanguageSelection (cls, langInfo) {
		const {count, featureName} = langInfo;

		const section = e_({outer: `
			<div class="charsheet__builder-class-lang-selection mt-3">
				<p><strong>Languages (${featureName}):</strong> Choose ${count} language${count > 1 ? "s" : ""}:</p>
				<div class="charsheet__builder-class-lang-dropdowns"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="class-lang-count">${this._selectedClassFeatureLanguages.length}</span>/${count}</div>
			</div>
		`});

		const dropdowns = section.querySelector(".charsheet__builder-class-lang-dropdowns");

		// Get grouped languages including homebrew
		const langOptions = this._page.getLanguageOptionsGrouped?.() || {
			standard: Parser.LANGUAGES_STANDARD,
			exotic: Parser.LANGUAGES_EXOTIC,
			secret: Parser.LANGUAGES_SECRET,
			homebrew: [],
		};

		for (let i = 0; i < count; i++) {
			const selectId = `class-lang-choice-${i}`;
			const select = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
					<option value="">-- Select Language --</option>
				</select>
			`});

			// Add language options grouped by type
			const addOptgroup = (labelText, langs) => {
				const grp = document.createElement("optgroup");
				grp.label = labelText;
				langs.forEach(lang => grp.append(e_({tag: "option", val: lang, txt: lang})));
				select.append(grp);
			};

			if (langOptions.homebrew.length) {
				addOptgroup("──── Homebrew Languages ────", langOptions.homebrew);
			}
			addOptgroup("──── Standard Languages ────", langOptions.standard);
			addOptgroup("──── Exotic/Rare Languages ────", langOptions.exotic);
			addOptgroup("──── Secret Languages ────", langOptions.secret);

			const existingChoice = this._selectedClassFeatureLanguages[i];
			if (existingChoice) {
				select.value = existingChoice;
			}

			select.addEventListener("change", (e) => {
				this._selectedClassFeatureLanguages[i] = e.target.value || null;
				// Count non-null selections
				const selectedCount = this._selectedClassFeatureLanguages.filter(l => l).length;
				section.querySelector(".class-lang-count").textContent = selectedCount;
			});

			dropdowns.append(select);
		}

		return section;
	}

	/**
	 * Validate that all required optional features have been selected
	 * @param {Object} cls - Class data
	 * @returns {{valid: boolean, message: string}}
	 */
	_validateOptionalFeatureSelections (cls) {
		if (!cls.optionalfeatureProgression?.length) return {valid: true, message: ""};

		for (const optFeatProg of cls.optionalfeatureProgression) {
			// Get count at level 1
			let requiredCount = 0;
			if (Array.isArray(optFeatProg.progression)) {
				requiredCount = optFeatProg.progression[0] || 0;
			} else if (typeof optFeatProg.progression === "object") {
				requiredCount = optFeatProg.progression["1"] || 0;
			}

			if (requiredCount === 0) continue;

			const featureTypes = optFeatProg.featureType || [];
			const featureKey = featureTypes.join("_");
			const name = optFeatProg.name || featureTypes.join(", ");

			// Check for Combat Methods - also need traditions selected
			const isCombatMethods = featureTypes.some(ft => ft.startsWith("CTM:"));
			if (isCombatMethods) {
				// Validate traditions are selected
				const traditionCount = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
					classData: cls,
					classFeatures: this._page.getClassFeatures(),
				});
				if (!this._selectedCombatTraditions || this._selectedCombatTraditions.length < traditionCount) {
					return {valid: false, message: `Please select ${traditionCount} combat traditions.`};
				}
			}

			// Check selected count
			const selected = this._selectedOptionalFeatures[featureKey] || [];
			if (selected.length < requiredCount) {
				return {valid: false, message: `Please select ${requiredCount} ${name}.`};
			}
		}

		return {valid: true, message: ""};
	}

	/**
	 * Validate that all required feature options have been selected (specialties, etc.)
	 * @param {Object} cls - Class data
	 * @param {number} level - Character level
	 * @returns {{valid: boolean, message: string}}
	 */
	_validateFeatureOptionSelections (cls, level) {
		// Get features at this level that have options
		const featureOptionsRequired = this._getFeatureOptionsAtLevel(cls, level);

		for (const {featureKey, count, name} of featureOptionsRequired) {
			const selected = this._selectedFeatureOptions[featureKey] || [];
			if (selected.length < count) {
				return {valid: false, message: `Please select ${count} option${count > 1 ? "s" : ""} for ${name}.`};
			}
		}

		return {valid: true, message: ""};
	}

	/**
	 * Get feature options required at a specific level
	 * Uses same key format as _renderClassFeatureOptions: ${featureName}_${featureSource}
	 * @param {Object} cls - Class data
	 * @param {number} level - Character level
	 * @returns {Array<{featureKey: string, count: number, name: string}>}
	 */
	_getFeatureOptionsAtLevel (cls, level) {
		const result = [];

		// Get level features
		let levelFeatures = [];
		if (cls.classFeatures && cls.classFeatures.length > 0) {
			if (Array.isArray(cls.classFeatures[level - 1])) {
				levelFeatures = cls.classFeatures[level - 1];
			} else if (!Array.isArray(cls.classFeatures[0])) {
				// Flat format - filter by level
				levelFeatures = cls.classFeatures.filter(f => {
					if (typeof f === "string") {
						const parts = f.split("|");
						return parts[3] === String(level) || parts.length < 4;
					} else if (typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parts[3] === String(level) || parts.length < 4;
					}
					return false;
				});
			}
		}

		for (const featureRef of levelFeatures) {
			let featureName, featureSource;
			if (typeof featureRef === "string") {
				const parts = featureRef.split("|");
				featureName = parts[0];
				featureSource = parts[2] || cls.source;
			} else if (typeof featureRef === "object" && featureRef.classFeature) {
				const parts = featureRef.classFeature.split("|");
				featureName = parts[0];
				featureSource = parts[2] || cls.source;
			} else {
				continue;
			}

			// Look up the full feature data
			const fullFeature = this._getClassFeatureData(featureName, cls.name, featureSource, level);
			if (!fullFeature) continue;

			// Check for embedded options
			const featureOptions = this._findFeatureOptions(fullFeature, level);
			for (const optionGroup of featureOptions) {
				// Skip option groups already covered by optionalfeatureProgression
				// (e.g. "Eldritch Invocation Options" is handled by _renderClassOptionalFeatures)
				if (this._isOptionGroupCoveredByOptFeatProgression(optionGroup, cls)) continue;

				result.push({
					// Use same key format as _renderClassFeatureOptions
					featureKey: `${fullFeature.name}_${fullFeature.source}`,
					count: optionGroup.count,
					name: fullFeature.name,
				});
			}
		}

		return result;
	}

	/**
	 * Get weapon mastery info from class features (feature-based, supports homebrew)
	 * @param {Object} cls - Class data
	 * @param {number} level - Level to check for weapon mastery
	 * @returns {{count: number}|null}
	 */
	_getClassWeaponMasteryInfo (cls, level) {
		const classFeatures = this._page.getClassFeatures();
		if (!classFeatures?.length || !cls.classFeatures?.length) return null;

		// Get the class's feature references for this level
		const levelFeatures = this._getClassFeatureRefsAtLevel(cls, level);
		if (!levelFeatures.length) return null;

		// Look for "Weapon Mastery" feature
		for (const featureRef of levelFeatures) {
			const parts = featureRef.split("|");
			const featureName = parts[0];

			if (featureName !== "Weapon Mastery") continue;

			const className = parts[1] || cls.name;
			const featureSource = parts[2] || cls.source;
			const featureLevel = parseInt(parts[3]) || 1;

			// Find the actual feature data
			const featureData = classFeatures.find(f => {
				if (f.name !== featureName) return false;
				if (f.className !== className) return false;
				if (f.level !== featureLevel) return false;
				if (featureSource && f.source && f.source !== featureSource) return false;
				return true;
			});

			if (!featureData) continue;

			// Try to get count from classTableGroups first (more accurate)
			const count = this._getWeaponMasteryCountFromTable(cls, level)
				|| this._parseWeaponMasteryCount(featureData.entries || []);

			return {count};
		}

		return null;
	}

	/**
	 * Get weapon mastery count from class table groups
	 * @param {Object} cls - Class data
	 * @param {number} level - Character level
	 * @returns {number|null}
	 */
	_getWeaponMasteryCountFromTable (cls, level) {
		if (!cls.classTableGroups?.length) return null;

		for (const tableGroup of cls.classTableGroups) {
			const masteryColIndex = tableGroup.colLabels?.findIndex(
				col => col === "Weapon Mastery" || col.toLowerCase().includes("mastery"),
			);

			if (masteryColIndex === -1) continue;

			// Rows are 0-indexed for level 1, 1-indexed for level 2, etc.
			const row = tableGroup.rows?.[level - 1];
			if (!row) continue;

			const value = row[masteryColIndex];
			if (typeof value === "number") return value;
			if (typeof value === "string") return parseInt(value) || null;
		}

		return null;
	}

	/**
	 * Parse weapon mastery count from feature entries
	 * @param {Array} entries - Feature entries
	 * @returns {number}
	 */
	_parseWeaponMasteryCount (entries) {
		const entriesText = entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();

		// Parse count from text
		if (entriesText.includes("three kinds")) return 3;
		if (entriesText.includes("two kinds")) return 2;
		if (entriesText.includes("one kind")) return 1;

		return 2; // Default
	}

	/**
	 * Render weapon mastery selection UI
	 * @param {Object} cls - Class data
	 * @param {{count: number}} masteryInfo - Weapon mastery requirements
	 */
	_renderWeaponMasterySelection (cls, masteryInfo) {
		const {count} = masteryInfo;

		const section = e_({outer: `
			<div class="charsheet__builder-mastery-selection mt-3">
				<p><strong>Weapon Mastery:</strong> Choose ${count} weapon${count > 1 ? "s" : ""} to master:</p>
				<p class="ve-small ve-muted">You can use the mastery property of your chosen weapons. You can change these after a long rest.</p>
				<div class="charsheet__builder-mastery-select-container"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="mastery-count">${this._selectedWeaponMasteries.length}</span>/${count}</div>
			</div>
		`});

		const container = section.querySelector(".charsheet__builder-mastery-select-container");

		// Get only BASE weapons with mastery properties (not magic variants)
		const allItems = this._page.getItems();
		const weaponsWithMastery = allItems.filter(item => {
			// Must be a base item, not a magic variant
			if (!item._isBaseItem) return false;
			// Must be a weapon
			if (!item.type || !["M", "R", "S"].includes(item.type)) {
				// Also check weaponCategory for more specific filtering
				if (!item.weaponCategory) return false;
			}
			// Must have mastery property
			return item.mastery?.length > 0;
		});

		// Group weapons by type for easier selection
		const simpleWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "simple" || w.type === "S",
		).sort((a, b) => a.name.localeCompare(b.name));

		const martialWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "martial" || w.type === "M",
		).sort((a, b) => a.name.localeCompare(b.name));

		// Helper function to extract mastery name from string or object format
		const getMasteryName = (masteryEntry) => {
			if (!masteryEntry) return "";
			if (typeof masteryEntry === "string") {
				return masteryEntry.split("|")[0];
			}
			if (typeof masteryEntry === "object" && masteryEntry.uid) {
				return masteryEntry.uid.split("|")[0];
			}
			return "";
		};

		// Create checkboxes
		const renderWeaponGroup = (weapons, groupName) => {
			if (!weapons.length) return;

			const group = e_({outer: `<div class="mb-2"><strong class="ve-small">${groupName}:</strong></div>`});
			const checkboxes = e_({outer: `<div class="charsheet__builder-mastery-checkboxes"></div>`});

			weapons.forEach(weapon => {
				const masteryName = getMasteryName(weapon.mastery?.[0]);
				const weaponKey = `${weapon.name}|${weapon.source}`;
				const isSelected = this._selectedWeaponMasteries.includes(weaponKey);

				const lbl = e_({outer: `
					<label class="charsheet__builder-skill-checkbox mr-3 mb-1" title="${masteryName ? `Mastery: ${masteryName}` : ""}">
						<input type="checkbox" value="${weaponKey}" ${isSelected ? "checked" : ""}>
						${weapon.name} ${masteryName ? `<span class="ve-small text-muted">(${masteryName})</span>` : ""}
					</label>
				`});

				lbl.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedWeaponMasteries.length < count) {
							this._selectedWeaponMasteries.push(weaponKey);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} weapon masteries.`});
						}
					} else {
						this._selectedWeaponMasteries = this._selectedWeaponMasteries.filter(m => m !== weaponKey);
					}
					section.querySelector(".mastery-count").textContent = this._selectedWeaponMasteries.length;
				});

				checkboxes.append(lbl);
			});

			group.append(checkboxes);
			container.append(group);
		};

		renderWeaponGroup(simpleWeapons, "Simple Weapons");
		renderWeaponGroup(martialWeapons, "Martial Weapons");

		if (!simpleWeapons.length && !martialWeapons.length) {
			container.append(e_({outer: `<p class="ve-muted">No weapons with mastery properties found.</p>`}));
		}

		return section;
	}

	/**
	 * Get the maximum method degree available at a given level from the class table
	 * Parses the "Method Degree" column from classTableGroups
	 */
	_getMaxMethodDegree (cls, level) {
		if (!cls.classTableGroups) return 0;

		for (const group of cls.classTableGroups) {
			// Look for a group with "Method Degree" column
			const degreeColIdx = group.colLabels?.findIndex(label =>
				label.toLowerCase().includes("method degree"),
			);

			if (degreeColIdx >= 0 && group.rows) {
				const row = group.rows[level - 1]; // 0-indexed
				if (row) {
					const degreeVal = row[degreeColIdx];
					// Parse "1st", "2nd", "3rd", "4th", "5th" to numbers
					if (typeof degreeVal === "string") {
						const match = degreeVal.match(/^(\d)/);
						if (match) return parseInt(match[1]);
					} else if (typeof degreeVal === "number") {
						return degreeVal;
					}
				}
			}
		}
		return 0;
	}

	/**
	 * Get available combat traditions from optional features
	 * Traditions are identified by feature types like "CTM:AM", "CTM:RC", etc. (no degree number)
	 */
	_getAvailableTraditions (allFeatures) {
		const traditions = new Map();

		for (const opt of allFeatures) {
			if (!CharacterSheetClassUtils.isCombatMethod(opt)) continue;
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
			if (tradCode && !traditions.has(tradCode)) {
				traditions.set(tradCode, {
					code: tradCode,
					fullCode: `CTM:${tradCode}`,
					name: CharacterSheetClassUtils.getTraditionName(tradCode),
				});
			}
		}

		return Array.from(traditions.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Extract tradition codes from class feature description text.
	 * Delegates to ClassUtils.extractTraditionsFromClassFeature.
	 */
	_extractTraditionsFromClassFeature (className, level = 2) {
		const classFeatures = this._page.getClassFeatures();
		return CharacterSheetClassUtils.extractTraditionsFromClassFeature(className, classFeatures);
	}

	/**
	 * Get available combat traditions filtered by what the class has access to.
	 * Delegates to ClassUtils.getAvailableTraditionsForClass.
	 */
	_getAvailableTraditionsForClass (allFeatures, classAllowedTypes, className) {
		const classFeatures = this._page.getClassFeatures();
		return CharacterSheetClassUtils.getAvailableTraditionsForClass(allFeatures, classAllowedTypes, className, classFeatures);
	}

	/**
	 * Get the display name for a tradition code
	 */
	_getTraditionName (tradCode) {
		return CharacterSheetClassUtils.getTraditionName(tradCode);
	}

	/**
	 * Check if an optional feature matches the selected traditions and is within max degree
	 */
	_methodMatchesTraditionsAndDegree (opt, selectedTraditions, maxDegree) {
		if (!CharacterSheetClassUtils.isCombatMethod(opt)) return false;
		const degree = CharacterSheetClassUtils.getMethodDegree(opt);
		const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
		return degree > 0 && degree <= maxDegree && tradCode && selectedTraditions.includes(tradCode);
	}

	/**
	 * Filter optional features by class edition/source.
	 * TGTT classes only see TGTT optional features, XPHB/PHB see their respective editions.
	 */
	_filterOptFeaturesByEdition (optFeatures, classSource) {
		if (!classSource || !optFeatures?.length) return optFeatures;

		const editionMap = {
			"TGTT": ["TGTT"],
			"XPHB": ["XPHB", "TCE", "XGE", "FTD", "SCC"],
			"PHB": ["PHB", "TCE", "XGE", "UA", "FTD", "SCC"],
		};

		const allowedSources = editionMap[classSource];
		if (!allowedSources) return optFeatures;

		return optFeatures.filter(opt => {
			if (!opt.source) return true;
			return allowedSources.includes(opt.source);
		});
	}

	_renderClassOptionalFeatures (cls) {
		const allOptFeaturesRaw = this._page.getOptionalFeatures();
		const allOptFeatures = this._filterOptFeaturesByEdition(allOptFeaturesRaw, cls?.source);
		const container = e_({outer: `<div class="charsheet__builder-optional-features mt-3"></div>`});

		cls.optionalfeatureProgression.forEach(optFeatProg => {
			// Get how many of this feature type at level 1
			let count = 0;
			if (Array.isArray(optFeatProg.progression)) {
				count = optFeatProg.progression[0] || 0; // Level 1 is index 0
			} else if (typeof optFeatProg.progression === "object") {
				count = optFeatProg.progression["1"] || 0;
			}

			if (count === 0) return; // No choices at level 1

			const featureTypes = optFeatProg.featureType || [];
			const name = optFeatProg.name || featureTypes.join(", ");
			const featureKey = featureTypes.join("_");

			// Check if this is a Combat Methods progression (has CTM:X feature types)
			const isCombatMethods = featureTypes.some(ft => ft.startsWith("CTM:"));

			if (isCombatMethods) {
				// Handle Combat Methods with tradition selection
				this._renderCombatMethodsSelection(container, cls, optFeatProg, count, name, featureKey, allOptFeatures);
			} else {
				// Standard optional feature selection
				this._renderStandardOptionalFeatures(container, optFeatProg, count, name, featureKey, allOptFeatures, featureTypes);
			}
		});

		return container;
	}

	/**
	 * Render Combat Methods selection with tradition choice first, then method selection
	 */
	_renderCombatMethodsSelection (container, cls, optFeatProg, methodCount, name, featureKey, allOptFeatures) {
		// Merge combatMethod entities into the available method pool
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
		const allMethods = [...allOptFeatures, ...combatMethodEntities];

		// Get traditions filtered by what the class has access to
		const classAllowedTypes = optFeatProg.featureType || [];
		const availableTraditions = this._getAvailableTraditionsForClass(allMethods, classAllowedTypes, cls?.name);
		const maxDegree = this._getMaxMethodDegree(cls, 1);

		// Determine how many traditions to select (usually 2)
		const traditionCount = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
			classData: cls,
			classFeatures: this._page.getClassFeatures(),
		});

		// Initialize storage
		if (!this._selectedCombatTraditions) this._selectedCombatTraditions = [];
		if (!this._selectedOptionalFeatures[featureKey]) {
			this._selectedOptionalFeatures[featureKey] = [];
		}

		const section = e_({outer: `
			<div class="charsheet__builder-combat-methods mb-3">
				<h6 class="mt-2 mb-1">Combat Traditions & Methods</h6>
				<p class="ve-small ve-muted">First choose ${traditionCount} traditions you're proficient with, then select ${methodCount} methods from those traditions.</p>
				
				<div class="charsheet__builder-traditions mb-2">
					<p><strong>Combat Traditions:</strong> Choose ${traditionCount}</p>
					<div class="charsheet__builder-tradition-list" style="max-height: 150px; overflow-y: auto;"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="tradition-count">${this._selectedCombatTraditions.length}</span>/${traditionCount}</div>
				</div>
				
				<div class="charsheet__builder-methods">
					<p><strong>${name}:</strong> Choose ${methodCount} (max degree: ${maxDegree > 0 ? maxDegree + this._getOrdinalSuffix(maxDegree) : "none"})</p>
					<div class="charsheet__builder-method-list" style="max-height: 250px; overflow-y: auto;"></div>
					<div class="ve-small ve-muted mt-1">Selected: <span class="method-count">${this._selectedOptionalFeatures[featureKey].length}</span>/${methodCount}</div>
				</div>
			</div>
		`});

		const traditionList = section.querySelector(".charsheet__builder-tradition-list");
		const methodList = section.querySelector(".charsheet__builder-method-list");

		// Render tradition selection
		availableTraditions.forEach(trad => {
			const isSelected = this._selectedCombatTraditions.includes(trad.code);
			const item = e_({outer: `
				<label class="charsheet__builder-tradition-item d-block mb-1" style="cursor: pointer;">
					<input type="checkbox" class="mr-2" ${isSelected ? "checked" : ""}>
					<strong>${trad.name}</strong>
					<span class="ve-muted ve-small ml-1">(${trad.code})</span>
				</label>
			`});

			item.querySelector("input").addEventListener("change", (e) => {
				if (e.target.checked) {
					if (this._selectedCombatTraditions.length < traditionCount) {
						this._selectedCombatTraditions.push(trad.code);
					} else {
						e.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${traditionCount} traditions.`});
						return;
					}
				} else {
					this._selectedCombatTraditions = this._selectedCombatTraditions.filter(t => t !== trad.code);
					// Also remove any selected methods from this tradition
					this._selectedOptionalFeatures[featureKey] = this._selectedOptionalFeatures[featureKey].filter(m => {
						return CharacterSheetClassUtils.getMethodTraditionCode(m) !== trad.code;
					});
					section.querySelector(".method-count").textContent = this._selectedOptionalFeatures[featureKey].length;
				}
				section.querySelector(".tradition-count").textContent = this._selectedCombatTraditions.length;
				// Re-render method list when traditions change
				this._renderMethodList(methodList, allMethods, featureKey, methodCount, maxDegree, section);
			});

			traditionList.append(item);
		});

		// Initial method list render
		this._renderMethodList(methodList, allMethods, featureKey, methodCount, maxDegree, section);

		container.append(section);
	}

	/**
	 * Render the list of available methods based on selected traditions and max degree
	 */
	_renderMethodList (methodList, allMethods, featureKey, methodCount, maxDegree, section) {
		methodList.innerHTML = "";

		if (this._selectedCombatTraditions.length === 0) {
			methodList.append(e_({outer: `<p class="ve-muted ve-small">Select traditions first to see available methods.</p>`}));
			return;
		}

		if (maxDegree === 0) {
			methodList.append(e_({outer: `<p class="ve-muted ve-small">No methods available at this level.</p>`}));
			return;
		}

		// Filter methods by selected traditions and max degree
		const availableMethods = allMethods.filter(opt =>
			this._methodMatchesTraditionsAndDegree(opt, this._selectedCombatTraditions, maxDegree),
		);

		if (availableMethods.length === 0) {
			methodList.append(e_({outer: `<p class="ve-muted ve-small">No methods available for selected traditions at this degree.</p>`}));
			return;
		}

		// Group methods by tradition for easier browsing
		const methodsByTradition = new Map();
		for (const method of availableMethods) {
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(method);
			const degree = CharacterSheetClassUtils.getMethodDegree(method);
			if (tradCode && this._selectedCombatTraditions.includes(tradCode)) {
				if (!methodsByTradition.has(tradCode)) {
					methodsByTradition.set(tradCode, []);
				}
				// Avoid duplicates
				if (!methodsByTradition.get(tradCode).some(m => m.name === method.name)) {
					methodsByTradition.get(tradCode).push({
						...method,
						degree,
					});
				}
			}
		}

		// Render methods grouped by tradition
		for (const tradCode of this._selectedCombatTraditions) {
			const methods = methodsByTradition.get(tradCode) || [];
			if (methods.length === 0) continue;

			const tradGroup = e_({outer: `
				<div class="charsheet__builder-method-group mb-2">
					<p class="ve-small mb-1"><strong>${this._getTraditionName(tradCode)}</strong></p>
				</div>
			`});

			methods.sort((a, b) => a.degree - b.degree || a.name.localeCompare(b.name)).forEach(method => {
				const isSelected = this._selectedOptionalFeatures[featureKey].some(
					s => s.name === method.name && s.source === method.source,
				);
				const item = e_({outer: `
					<label class="charsheet__builder-method-item d-block mb-1 ml-2" style="cursor: pointer;">
						<input type="checkbox" class="mr-2" ${isSelected ? "checked" : ""}>
						<span class="method-name"></span>
						<span class="ve-muted ve-small ml-1">(${method.degree}${this._getOrdinalSuffix(method.degree)} degree)</span>
					</label>
				`});

				// Create hoverable link for the method name
				const methodName = item.querySelector(".method-name");
				try {
					const resolvedSource = this._page.resolveOptionalFeatureSource(method.name, [
						method.source,
						this._selectedClass?.source,
						Parser.SRC_XPHB,
						Parser.SRC_PHB,
					]);
					methodName.innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_OPT_FEATURES, method.name, resolvedSource);
				} catch (e) {
					methodName.textContent = method.name;
				}

				item.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedOptionalFeatures[featureKey].length < methodCount) {
							this._selectedOptionalFeatures[featureKey].push(method);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${methodCount} methods.`});
						}
					} else {
						this._selectedOptionalFeatures[featureKey] = this._selectedOptionalFeatures[featureKey].filter(
							s => !(s.name === method.name && s.source === method.source),
						);
					}
					section.querySelector(".method-count").textContent = this._selectedOptionalFeatures[featureKey].length;
				});

				tradGroup.append(item);
			});

			methodList.append(tradGroup);
		}
	}

	_getOrdinalSuffix (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return s[(v - 20) % 10] || s[v] || s[0];
	}

	/**
	 * Render standard optional features (non-Combat Methods)
	 */
	_renderStandardOptionalFeatures (container, optFeatProg, count, name, featureKey, allOptFeatures, featureTypes) {
		// Helper to check if a feature type matches the progression requirements
		const matchesFeatureType = (optFeatTypes) => {
			return optFeatTypes?.some(ft =>
				featureTypes.some(progType =>
					ft === progType || ft.startsWith(progType),
				),
			);
		};

		// Filter available options
		const availableOptions = allOptFeatures.filter(opt => {
			if (!matchesFeatureType(opt.featureType)) return false;

			// Check prerequisites
			if (opt.prerequisite) {
				for (const prereq of opt.prerequisite) {
					if (prereq.level) {
						const reqLevel = prereq.level.level || prereq.level;
						if (reqLevel > 1) return false;
					}
					// Check pact prerequisite — e.g. "Pact of Transformation" invocations
					if (prereq.pact) {
						const hasPact = Object.values(this._selectedOptionalFeatures).flat()
							.some(f => f.name === prereq.pact);
						if (!hasPact) return false;
					}
				}
			}
			return true;
		});

		// Initialize storage
		if (!this._selectedOptionalFeatures[featureKey]) {
			this._selectedOptionalFeatures[featureKey] = [];
		}

		const section = e_({outer: `
			<div class="charsheet__builder-opt-feat-section mb-3">
				<p><strong>${name}:</strong> Choose ${count}</p>
				<div class="charsheet__builder-opt-feat-list" style="max-height: 200px; overflow-y: auto;"></div>
				<div class="ve-small ve-muted mt-1">Selected: <span class="opt-feat-count">${this._selectedOptionalFeatures[featureKey].length}</span>/${count}</div>
			</div>
		`});

		const list = section.querySelector(".charsheet__builder-opt-feat-list");

		availableOptions.sort((a, b) => a.name.localeCompare(b.name)).forEach(opt => {
			const isSelected = this._selectedOptionalFeatures[featureKey].some(
				s => s.name === opt.name && s.source === opt.source,
			);
			const item = e_({outer: `
				<label class="charsheet__builder-opt-feat-item d-block mb-1" style="cursor: pointer;">
					<input type="checkbox" class="mr-2" ${isSelected ? "checked" : ""}>
					<span class="opt-feat-name"></span>
					<span class="ve-muted ve-small ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>
				</label>
			`});

			// Create hoverable link for the optional feature name
			const optName = item.querySelector(".opt-feat-name");
			try {
				const resolvedSource = this._page.resolveOptionalFeatureSource(opt.name, [
					opt.source,
					this._selectedClass?.source,
					Parser.SRC_XPHB,
					Parser.SRC_PHB,
				]);
				optName.innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_OPT_FEATURES, opt.name, resolvedSource);
			} catch (e) {
				optName.textContent = opt.name;
			}

			item.querySelector("input").addEventListener("change", (e) => {
				if (e.target.checked) {
					if (this._selectedOptionalFeatures[featureKey].length < count) {
						this._selectedOptionalFeatures[featureKey].push(opt);
					} else {
						e.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${count} ${name}.`});
					}
				} else {
					this._selectedOptionalFeatures[featureKey] = this._selectedOptionalFeatures[featureKey].filter(
						s => !(s.name === opt.name && s.source === opt.source),
					);
				}
				section.querySelector(".opt-feat-count").textContent = this._selectedOptionalFeatures[featureKey].length;
			});

			list.append(item);
		});

		container.append(section);
	}

	/**
	 * Analyze a feature's text to detect if it requires a skill/expertise choice.
	 * Returns a descriptor object or null if no choice is needed.
	 * @param {Object} opt - The option object (with ref, name, type)
	 * @returns {Object|null} - { type: "proficiency"|"expertise"|"bonus", count: number, from: "any_proficient"|string[] }
	 */
	_parseFeatureSkillChoice (opt) {
		// Resolve feature data first to ensure we have entries
		let resolvedData = null;
		if (opt.type === "classFeature" && opt.ref) {
			resolvedData = this._getClassFeatureDataFromRef(opt.ref);
		} else if (opt.type === "optionalfeature") {
			const allOptFeatures = this._page.getOptionalFeatures?.() || [];
			resolvedData = allOptFeatures.find(f => f.name === opt.name && f.source === opt.source)
				|| allOptFeatures.find(f => f.name === opt.name);
		}
		return CharacterSheetClassUtils.parseFeatureSkillChoice(opt, this._page.getClassFeatures(), {
			optionalFeatures: this._page.getOptionalFeatures?.() || [],
			resolvedData,
		});
	}

	/**
	 * Parse automatic effects from a specialty/feature that don't require user choices.
	 * Examples: "passive Perception increases by 3", "bonus equal to proficiency bonus"
	 * @param {Object} opt - The option object with ref, name, type
	 * @returns {Array} Array of effect objects: [{type, value, note}]
	 */
	_parseFeatureAutoEffects (opt) {
		// Resolve feature data first to ensure we have entries
		let resolvedData = null;
		if (opt.type === "classFeature" && opt.ref) {
			resolvedData = this._getClassFeatureDataFromRef(opt.ref);
		} else if (opt.type === "optionalfeature") {
			const allOptFeatures = this._page.getOptionalFeatures?.() || [];
			resolvedData = allOptFeatures.find(f => f.name === opt.name && f.source === opt.source)
				|| allOptFeatures.find(f => f.name === opt.name);
		}
		return CharacterSheetClassUtils.parseFeatureAutoEffects(opt, this._page.getClassFeatures(), {
			optionalFeatures: this._page.getOptionalFeatures?.() || [],
			resolvedData,
		});
	}

	/**
	 * Render a skill sub-choice UI below a specialty checkbox.
	 * @param {Object} choice - From _parseFeatureSkillChoice: {type, count, from}
	 * @param {string} choiceKey - Unique key for storing selections (featureKey + optName)
	 * @returns {HTMLElement}
	 */
	_renderFeatureSkillSubChoice (choice, choiceKey) {
		const allSkills = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
			"History", "Insight", "Intimidation", "Investigation", "Medicine",
			"Nature", "Perception", "Performance", "Persuasion", "Religion",
			"Sleight of Hand", "Stealth", "Survival",
		];

		// Determine available skills
		let availableSkills;
		if (choice.from === "any_proficient") {
			// Get currently proficient skills
			const proficientSkills = allSkills.filter(s => {
				const key = s.toLowerCase().replace(/\s+/g, "");
				return this._state?.getSkillProficiency?.(key) > 0;
			});
			// If we don't have state yet, show all skills
			availableSkills = proficientSkills.length ? proficientSkills : allSkills;
		} else {
			availableSkills = choice.from;
		}

		const typeLabel = choice.type === "proficiency" ? "Proficiency"
			: choice.type === "expertise" ? "Expertise"
				: "Bonus";

		// Initialize storage
		if (!this._selectedFeatureSkillChoices[choiceKey]) {
			this._selectedFeatureSkillChoices[choiceKey] = [];
		}

		const wrapper = e_({outer: `
			<div class="charsheet__builder-feat-skill-sub-choice ml-4 mt-1 mb-1 pl-2" style="border-left: 2px solid var(--rgb-border-grey, #888);">
				<div class="ve-small"><em>Choose ${choice.count} skill${choice.count > 1 ? "s" : ""} for ${typeLabel}:</em></div>
				<div class="charsheet__builder-feat-skill-checkboxes"></div>
				<div class="ve-small ve-muted">Selected: <span class="feat-skill-count">${this._selectedFeatureSkillChoices[choiceKey].length}</span>/${choice.count}</div>
			</div>
		`});

		const checkboxes = wrapper.querySelector(".charsheet__builder-feat-skill-checkboxes");

		for (const skill of availableSkills) {
			const isSelected = this._selectedFeatureSkillChoices[choiceKey].includes(skill);
			const lbl = e_({outer: `
				<label class="charsheet__builder-feat-skill-cb mr-2 mb-1" style="display: inline-block;">
					<input type="checkbox" value="${skill}" ${isSelected ? "checked" : ""}>
					<span class="ve-small">${skill}</span>
				</label>
			`});

			lbl.querySelector("input").addEventListener("change", (e) => {
				if (e.target.checked) {
					if (this._selectedFeatureSkillChoices[choiceKey].length < choice.count) {
						this._selectedFeatureSkillChoices[choiceKey].push(skill);
					} else {
						e.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${choice.count} skill${choice.count > 1 ? "s" : ""}.`});
					}
				} else {
					this._selectedFeatureSkillChoices[choiceKey] = this._selectedFeatureSkillChoices[choiceKey].filter(s => s !== skill);
				}
				wrapper.querySelector(".feat-skill-count").textContent = this._selectedFeatureSkillChoices[choiceKey].length;
			});

			checkboxes.append(lbl);
		}

		return wrapper;
	}

	/**
	 * Check if a feature option group is already handled by optionalfeatureProgression.
	 * This prevents duplicate rendering for features like "Eldritch Invocation Options" which
	 * appear both as a classFeature with {type: "options"} entries AND in optionalfeatureProgression.
	 * @param {Object} optionGroup - {options: Array, count, featureName, ...}
	 * @param {Object} cls - Class data with optionalfeatureProgression
	 * @returns {boolean}
	 */
	_isOptionGroupCoveredByOptFeatProgression (optionGroup, cls) {
		if (!cls.optionalfeatureProgression?.length) return false;
		// Only suppress if ALL options in the group are optional features (not class features, etc.)
		if (!optionGroup.options?.length) return false;
		if (!optionGroup.options.every(opt => opt.type === "optionalfeature")) return false;

		// Collect all featureTypes covered by optionalfeatureProgression
		const progFeatureTypes = new Set();
		for (const prog of cls.optionalfeatureProgression) {
			if (prog.featureType) {
				for (const ft of prog.featureType) progFeatureTypes.add(ft);
			}
		}

		// Check if ANY option in this group references a feature type covered by the progression.
		// We resolve the optional features from the page data to check their featureType.
		const allOptFeatures = this._page.getOptionalFeatures?.() || [];
		for (const opt of optionGroup.options) {
			const optName = opt.name;
			const match = allOptFeatures.find(f => f.name === optName);
			if (match?.featureType?.some(ft => progFeatureTypes.has(ft))) return true;
		}

		return false;
	}

	/**
	 * Render selection UI for class features that have embedded options (like Specialties)
	 * These are features with {type: "options", count: N, entries: [refClassFeature, ...]}
	 */
	_renderClassFeatureOptions (cls, level) {
		// Get level 1 class features
		let levelFeatures = [];
		if (cls.classFeatures && cls.classFeatures.length > 0) {
			if (Array.isArray(cls.classFeatures[level - 1])) {
				levelFeatures = cls.classFeatures[level - 1];
			} else if (!Array.isArray(cls.classFeatures[0])) {
				// Flat format - filter by level
				levelFeatures = cls.classFeatures.filter(f => {
					if (typeof f === "string") {
						const parts = f.split("|");
						return parts[3] === String(level) || parts.length < 4;
					} else if (typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parts[3] === String(level) || parts.length < 4;
					}
					return false;
				});
			}
		}

		// Find all feature option choices
		const allOptions = [];

		for (const featureRef of levelFeatures) {
			let featureName, featureSource;
			if (typeof featureRef === "string") {
				const parts = featureRef.split("|");
				featureName = parts[0];
				featureSource = parts[2] || cls.source;
			} else if (typeof featureRef === "object" && featureRef.classFeature) {
				const parts = featureRef.classFeature.split("|");
				featureName = parts[0];
				featureSource = parts[2] || cls.source;
			} else {
				continue;
			}

			// Look up the full feature data
			const fullFeature = this._getClassFeatureData(featureName, cls.name, featureSource, level);
			if (!fullFeature) continue;

			// Check for embedded options
			const featureOptions = this._findFeatureOptions(fullFeature, level);
			for (const optionGroup of featureOptions) {
				allOptions.push({
					featureName: fullFeature.name,
					featureSource: fullFeature.source,
					...optionGroup,
				});
			}
		}

		// Also check subclass features for options if subclass selected
		if (this._selectedSubclass && this._selectedSubclass.subclassFeatures) {
			this._selectedSubclass.subclassFeatures.forEach(levelFeatures => {
				if (Array.isArray(levelFeatures)) {
					levelFeatures.forEach(feature => {
						if (typeof feature === "object" && feature.level === level) {
							const featureOptions = this._findFeatureOptions(feature, level);
							for (const optionGroup of featureOptions) {
								allOptions.push({
									featureName: feature.name || Renderer.findName(feature),
									featureSource: feature.source || this._selectedSubclass.source,
									isSubclassFeature: true,
									...optionGroup,
								});
							}
						}
					});
				}
			});
		}

		// Filter out option groups already covered by optionalfeatureProgression
		// (e.g. "Eldritch Invocation Options" is handled by _renderClassOptionalFeatures)
		const filteredOptions = allOptions.filter(og => !this._isOptionGroupCoveredByOptFeatProgression(og, cls));

		if (filteredOptions.length === 0) return null;

		const container = e_({outer: `<div class="charsheet__builder-feature-options mt-3"></div>`});

		for (const optGroup of filteredOptions) {
			const featureKey = `${optGroup.featureName}_${optGroup.featureSource}`;

			// Initialize storage if needed
			if (!this._selectedFeatureOptions[featureKey]) {
				this._selectedFeatureOptions[featureKey] = [];
			}

			const section = e_({outer: `
				<div class="charsheet__builder-feat-opt-section">
					<div class="charsheet__builder-feat-opt-header">
						<span class="charsheet__builder-feat-opt-header-name">${optGroup.featureName}</span>
						<span class="charsheet__builder-feat-opt-header-count">Choose ${optGroup.count}</span>
					</div>
					<div class="charsheet__builder-feat-opt-list"></div>
					<div class="charsheet__builder-feat-opt-status">Selected: <span class="feat-opt-count">${this._selectedFeatureOptions[featureKey].length}</span> / ${optGroup.count}</div>
				</div>
			`});

			const list = section.querySelector(".charsheet__builder-feat-opt-list");

			// Get already-selected features in other groups (for same-session deduplication)
			const allSelectedInSession = Object.values(this._selectedFeatureOptions).flat().map(s => s.name);

			for (const opt of optGroup.options) {
				// Check if already selected in ANOTHER group (different feature key)
				const isSelectedInOtherGroup = !this._selectedFeatureOptions[featureKey]?.some(s => s.name === opt.name)
					&& allSelectedInSession.includes(opt.name);

				// Check if the feature can be taken multiple times
				let canRepeat = false;
				if (isSelectedInOtherGroup && opt.type === "classFeature" && opt.ref) {
					const fullOpt = this._getClassFeatureDataFromRef(opt.ref);
					if (fullOpt?.entries) {
						const text = JSON.stringify(fullOpt.entries).toLowerCase();
						canRepeat = text.includes("multiple times") || text.includes("chosen again") || text.includes("retaken");
					}
				}

				// Skip if selected in another group and not repeatable
				if (isSelectedInOtherGroup && !canRepeat) continue;

				const isSelected = this._selectedFeatureOptions[featureKey].some(
					s => s.name === opt.name && s.ref === opt.ref,
				);

				const item = e_({outer: `
					<label class="charsheet__builder-feat-opt-item">
						<input type="checkbox" ${isSelected ? "checked" : ""}>
						<span class="feat-opt-name"></span>
						${opt.source ? `<span class="ve-muted ve-small">(${Parser.sourceJsonToAbv(opt.source)})</span>` : ""}
					</label>
				`});

				// Create hoverable link for the option name
				const nameSpan = item.querySelector(".feat-opt-name");
				if (opt.type === "classFeature" && opt.ref) {
					const parts = opt.ref.split("|");
					// Hash format: name, className, classSource, level, featureSource
					const featureSource = parts[2] || opt.source || "TGTT";
					const hash = UrlUtil.encodeArrayForHash(parts[0], parts[1], parts[2], parts[3], featureSource);
					try {
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
						nameSpan.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${opt.name}</a>`;
					} catch (e) {
						nameSpan.textContent = opt.name;
					}
				} else if (opt.type === "optionalfeature" && opt.ref) {
					const refParts = opt.ref.split("|");
					const resolvedSource = this._page.resolveOptionalFeatureSource(refParts[0] || opt.name, [
						refParts[1],
						opt.source,
						this._selectedClass?.source,
						Parser.SRC_XPHB,
						Parser.SRC_PHB,
					]);
					try {
						nameSpan.innerHTML = CharacterSheetPage.getHoverLink(UrlUtil.PG_OPT_FEATURES, refParts[0], resolvedSource);
					} catch (e) {
						nameSpan.textContent = opt.name;
					}
				} else {
					nameSpan.textContent = opt.name;
				}

				item.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (this._selectedFeatureOptions[featureKey].length < optGroup.count) {
							this._selectedFeatureOptions[featureKey].push(opt);

							// Check if this option requires a skill sub-choice
							const skillChoice = this._parseFeatureSkillChoice(opt);
							if (skillChoice) {
								const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
								const subChoice = this._renderFeatureSkillSubChoice(skillChoice, choiceKey);
								item.after(subChoice);
							}
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${optGroup.count} options.`});
						}
					} else {
						this._selectedFeatureOptions[featureKey] = this._selectedFeatureOptions[featureKey].filter(
							s => !(s.name === opt.name && s.ref === opt.ref),
						);

						// Remove skill sub-choice UI
						const choiceKey = `${featureKey}__${opt.name}__${opt.ref || ""}`;
						delete this._selectedFeatureSkillChoices[choiceKey];
						{ const _nxt = item.nextElementSibling; if (_nxt?.matches(".charsheet__builder-feat-skill-sub-choice")) _nxt.remove(); };
					}
					section.querySelector(".feat-opt-count").textContent = this._selectedFeatureOptions[featureKey].length;
				});

				list.append(item);
			}

			container.append(section);
		}

		return container;
	}
	// #endregion

	// #region Step 3: Abilities
	_renderAbilitiesStep (content) {
		const container = e_({outer: `
			<div class="charsheet__builder-abilities">
				<div>
					<div class="charsheet__builder-ability-method mb-3">
						<label class="mr-3">
							<input type="radio" name="ability-method" value="standard" ${this._abilityMethod === "standard" ? "checked" : ""}> Standard Array
						</label>
						<label class="mr-3">
							<input type="radio" name="ability-method" value="pointbuy" ${this._abilityMethod === "pointbuy" ? "checked" : ""}> Point Buy
						</label>
						<label>
							<input type="radio" name="ability-method" value="manual" ${this._abilityMethod === "manual" ? "checked" : ""}> Manual Entry
						</label>
					</div>
					<div class="charsheet__builder-points-remaining" id="builder-points-remaining" style="display: ${this._abilityMethod === "pointbuy" ? "block" : "none"}">
						Points Remaining: <span id="points-value">${this._pointBuyRemaining}</span>
					</div>
					<div id="builder-abilities-inputs"></div>
				</div>
				<div>
					<div class="charsheet__section">
						<h5>Racial Bonuses</h5>
						<div id="builder-racial-bonuses"></div>
					</div>
					<div class="charsheet__section mt-3">
						<h5>Summary</h5>
						<div id="builder-abilities-summary"></div>
					</div>
				</div>
			</div>
		`});

		content.append(container);

		// Method selection
		document.querySelectorAll("input[name=\"ability-method\"]").forEach(radio => radio.addEventListener("change", (e) => {
			this._abilityMethod = e.target.value;
			this._resetAbilityScores();
			this._renderAbilityInputs();
		}));

		// Render racial bonuses section with Tasha's option
		this._renderRacialBonusesSection();
		this._renderAbilityInputs();
	}

	/**
	 * Render the racial bonuses section with optional Tasha's Custom Origin rules
	 */
	_renderRacialBonusesSection () {
		const container = document.getElementById("builder-racial-bonuses");
		container.innerHTML = "";

		if (!this._selectedRace) {
			container.append(e_({outer: `<p class='ve-muted'>Select a race first</p>`}));
			return;
		}

		// Check if race is 2024 (no ASI from race) or has ASI to reassign
		const raceIs2024 = this._raceUses2024ASI();
		const hasRacialASI = this._getRacialASITotal() > 0;

		if (raceIs2024) {
			container.append(e_({outer: `<p class='ve-muted'>2024 species do not provide ability score bonuses. ASI comes from your background choice.</p>`}));
			return;
		}

		if (!hasRacialASI) {
			container.append(e_({outer: `<p class='ve-muted'>No racial ability bonuses</p>`}));
			return;
		}

		// Show Tasha's Custom Origin option
		const tashasOption = e_({outer: `
			<label class="ve-flex-v-center mb-2" style="cursor: pointer;">
				<input type="checkbox" class="mr-2" id="builder-tashas-rules" ${this._useTashasRules ? "checked" : ""}>
				<span>Use Tasha's Custom Origin Rules</span>
				<span class="ve-muted ve-small ml-1" title="Allows you to reassign racial ability scores, skill proficiencies, and languages">(reassign ASI, skills &amp; languages)</span>
			</label>
		`});

		tashasOption.querySelector("input").addEventListener("change", (e) => {
			this._useTashasRules = e.target.checked;
			if (!this._useTashasRules) {
				// Reset all custom choices when disabling
				this._tashasAbilityBonuses = {};
				this._tashasSkillReplacements = [];
				this._tashasLanguageReplacements = [];
			}
			this._renderRacialBonusesSection();
			this._updateAbilitySummary();
		});

		container.append(tashasOption);

		// Show either default bonuses or custom selection UI
		if (this._useTashasRules) {
			this._renderTashasASIChoices(container);
			this._renderTashasSkillReplacements(container);
			this._renderTashasLanguageReplacements(container);
		} else {
			container.append(e_({outer: `<div class="mt-2">${this._getRacialBonusesHtml()}</div>`}));
		}
	}

	/**
	 * Get fixed racial skill proficiencies (non-choice) from race and subrace.
	 * @returns {string[]} Array of skill keys (lowercase, no spaces)
	 */
	_getFixedRacialSkills () {
		const skills = [];
		const collectFixed = (skillProficiencies) => {
			if (!skillProficiencies) return;
			skillProficiencies.forEach(skillProf => {
				Object.keys(skillProf).forEach(skill => {
					if (skill !== "any" && skill !== "choose") {
						skills.push(skill);
					}
				});
			});
		};
		collectFixed(this._selectedRace?.skillProficiencies);
		collectFixed(this._selectedSubrace?.skillProficiencies);
		return skills;
	}

	/**
	 * Get skills already chosen by other builder steps, mapped to their source label.
	 * Used to disable duplicate skill selections across race, background, and class pickers.
	 * @param {"race"|"background"|"class"} excludeSource - The calling step's source (excluded from results)
	 * @returns {Map<string, string>} Map of TitleCase skill name → source label (e.g. "Race", "Background")
	 */
	_getSkillsFromOtherSources (excludeSource) {
		const skills = new Map();

		if (excludeSource !== "race") {
			const fixedRacial = this._getFixedRacialSkills();
			if (this._useTashasRules && this._tashasSkillReplacements.length) {
				this._tashasSkillReplacements.forEach(skill => {
					if (skill) skills.set(skill.toTitleCase(), "Race");
				});
			} else {
				fixedRacial.forEach(skill => skills.set(skill.toTitleCase(), "Race"));
			}
			this._selectedRacialSkills.forEach(skill => skills.set(skill, "Race"));
		}

		if (excludeSource !== "background" && this._selectedBackground?.skillProficiencies) {
			this._selectedBackground.skillProficiencies.forEach(skillSet => {
				Object.keys(skillSet).forEach(skill => {
					if (skill !== "choose" && skill !== "any") {
						skills.set(skill.toTitleCase(), "Background");
					}
				});
			});
		}

		if (excludeSource !== "class") {
			this._selectedSkills.forEach(skill => skills.set(skill, "Class"));
		}

		return skills;
	}

	/**
	 * Get fixed racial languages (non-choice, excluding Common) from race and subrace.
	 * @returns {string[]} Array of language names
	 */
	_getFixedRacialLanguages () {
		const languages = [];
		const collectFixed = (langProficiencies) => {
			if (!langProficiencies) return;
			langProficiencies.forEach(langProf => {
				Object.keys(langProf).forEach(lang => {
					if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
					// Common cannot be replaced per Tasha's rules
					if (lang.toLowerCase() === "common") return;
					languages.push(lang);
				});
			});
		};
		collectFixed(this._selectedRace?.languageProficiencies);
		collectFixed(this._selectedSubrace?.languageProficiencies);
		return languages;
	}

	/**
	 * Render Tasha's skill proficiency replacements.
	 * Replaces fixed racial skills with "choose any N skills".
	 */
	_renderTashasSkillReplacements (container) {
		const fixedSkills = this._getFixedRacialSkills();
		if (!fixedSkills.length) return;

		// Use the same data source as other skill pickers (includes homebrew/custom skills)
		const allSkills = this._page.getSkillsList().map(s => s.name);

		const section = e_({outer: `<div class="charsheet__builder-tashas-skills mt-3"></div>`});
		section.append(e_({outer: `<p class="ve-small ve-muted mb-1">Replace ${fixedSkills.length} fixed racial skill${fixedSkills.length > 1 ? "s" : ""} (<em>${fixedSkills.map(s => s.toTitleCase()).join(", ")}</em>) with any skill${fixedSkills.length > 1 ? "s" : ""}:</p>`}));

		for (let i = 0; i < fixedSkills.length; i++) {
			const selectEl = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" id="tashas-skill-${i}">
					<option value="">-- Select Skill --</option>
				</select>
			`});

			allSkills.forEach(skill => {
				selectEl.append(e_({outer: `<option value="${skill}">${skill}</option>`}));
			});

			// Pre-select
			if (this._tashasSkillReplacements[i]) {
				selectEl.value = this._tashasSkillReplacements[i];
			}

			selectEl.addEventListener("change", (e) => {
				this._tashasSkillReplacements[i] = e.target.value || null;
			});

			section.append(selectEl);
		}

		container.append(section);
	}

	/**
	 * Render Tasha's language replacements.
	 * Replaces fixed racial languages (except Common) with "choose any N languages".
	 */
	_renderTashasLanguageReplacements (container) {
		const fixedLanguages = this._getFixedRacialLanguages();
		if (!fixedLanguages.length) return;

		// Use the same data source as other language pickers (includes homebrew languages)
		const allLanguages = this._page.getLanguageNamesSorted();
		const standardLanguages = allLanguages.length > 0 ? allLanguages : ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc"];

		const section = e_({outer: `<div class="charsheet__builder-tashas-languages mt-3"></div>`});
		section.append(e_({outer: `<p class="ve-small ve-muted mb-1">Replace ${fixedLanguages.length} fixed racial language${fixedLanguages.length > 1 ? "s" : ""} (<em>${fixedLanguages.map(l => l.toTitleCase()).join(", ")}</em>) with any language${fixedLanguages.length > 1 ? "s" : ""}:</p>`}));

		for (let i = 0; i < fixedLanguages.length; i++) {
			const selectEl = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" id="tashas-lang-${i}">
					<option value="">-- Select Language --</option>
				</select>
			`});

			standardLanguages.forEach(lang => {
				selectEl.append(e_({outer: `<option value="${lang}">${lang}</option>`}));
			});

			// Pre-select
			if (this._tashasLanguageReplacements[i]) {
				selectEl.value = this._tashasLanguageReplacements[i];
			}

			selectEl.addEventListener("change", (e) => {
				this._tashasLanguageReplacements[i] = e.target.value || null;
			});

			section.append(selectEl);
		}

		container.append(section);
	}

	/**
	 * Get the effective ability array for a race/subrace, respecting the user's choice
	 * when multiple ability options exist (VRGR lineage "choose between +2/+1 or +1/+1/+1").
	 * Multiple ability objects in the array are alternatives (OR), not additive (AND).
	 * Returns [{abiSet, originalIdx}] entries so callers can preserve the correct choice key indices.
	 */
	_getEffectiveAbilityEntries (abilityArray, raceName, raceSource) {
		if (!abilityArray?.length) return [];
		if (abilityArray.length <= 1) return abilityArray.map((abiSet, i) => ({abiSet, originalIdx: i}));
		const raceKey = `${raceName}|${raceSource}`;
		const selectedIdx = this._selectedRacialAbilitySetIdx[raceKey] ?? 0;
		const idx = selectedIdx < abilityArray.length ? selectedIdx : 0;
		return [{abiSet: abilityArray[idx], originalIdx: idx}];
	}

	/**
	 * Get total ASI points from racial bonuses
	 */
	_getRacialASITotal () {
		let total = 0;

		const addTotal = (entries) => {
			for (const {abiSet} of entries) {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) total += bonus;
				});
				if (abiSet.choose) {
					if (abiSet.choose.weighted) {
						total += (abiSet.choose.weighted.weights || [2, 1]).reduce((a, b) => a + b, 0);
					} else {
						total += (abiSet.choose.count || 1) * (abiSet.choose.amount || 1);
					}
				}
			}
		};

		if (this._selectedRace) addTotal(this._getEffectiveAbilityEntries(this._selectedRace.ability, this._selectedRace.name, this._selectedRace.source));
		if (this._selectedSubrace) addTotal(this._getEffectiveAbilityEntries(this._selectedSubrace.ability, this._selectedSubrace.name, this._selectedSubrace.source));

		return total;
	}

	/**
	 * Get racial ASI as an array of bonuses for Tasha's rules
	 * Returns [{amount: 2}, {amount: 1}] or similar
	 */
	_getRacialASIBonuses () {
		const bonuses = [];

		const addBonuses = (entries, sourceName) => {
			for (const {abiSet} of entries) {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi) && typeof bonus === "number") {
						bonuses.push({amount: bonus, source: sourceName});
					}
				});
				if (abiSet.choose) {
					if (abiSet.choose.weighted) {
						const weights = abiSet.choose.weighted.weights || [2, 1];
						weights.forEach(w => bonuses.push({amount: w, source: sourceName, isChoose: true}));
					} else {
						const count = abiSet.choose.count || 1;
						const amount = abiSet.choose.amount || 1;
						for (let i = 0; i < count; i++) {
							bonuses.push({amount, source: sourceName, isChoose: true});
						}
					}
				}
			}
		};

		if (this._selectedRace) addBonuses(this._getEffectiveAbilityEntries(this._selectedRace.ability, this._selectedRace.name, this._selectedRace.source), this._selectedRace.name);
		if (this._selectedSubrace) addBonuses(this._getEffectiveAbilityEntries(this._selectedSubrace.ability, this._selectedSubrace.name, this._selectedSubrace.source), this._selectedSubrace.name);

		return bonuses;
	}

	/**
	 * Render Tasha's Custom Origin ASI selection
	 */
	_renderTashasASIChoices (container) {
		const bonuses = this._getRacialASIBonuses();
		if (!bonuses.length) return;

		const info = e_({outer: `<p class="ve-small ve-muted mb-2">Reassign your racial ability score bonuses to any abilities you choose:</p>`});
		container.append(info);

		const choices = e_({outer: `<div class="charsheet__builder-tashas-asi-choices"></div>`});
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];

		bonuses.forEach((bonus, idx) => {
			const row = e_({outer: `<div class="ve-flex-v-center mb-1"></div>`});
			row.append(e_({outer: `<span class="mr-2">+${bonus.amount}:</span>`}));

			const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-tasha-idx="${idx}"></select>`});
			selectEl.append(e_({outer: `<option value="">-- Select --</option>`}));

			abilities.forEach(ab => {
				const abName = Parser.attAbvToFull(ab);
				const selected = this._tashasAbilityBonuses[`tasha_${idx}`] === ab ? "selected" : "";
				selectEl.append(e_({outer: `<option value="${ab}" ${selected}>${abName}</option>`}));
			});

			selectEl.addEventListener("change", (e) => {
				const val = e.target.value;
				this._tashasAbilityBonuses[`tasha_${idx}`] = val;
				this._tashasAbilityBonuses[`tasha_${idx}_amount`] = bonus.amount;

				// Update other selects to disable already-selected options
				[...choices.querySelectorAll("select")].forEach((sel) => {
					const selIdx = parseInt(sel.dataset.tashaIdx);
					if (selIdx !== idx) {
						[...sel.querySelectorAll("option")].forEach((opt) => {
							const optVal = opt.value;
							// Check if this option is selected in another dropdown
							const isSelectedElsewhere = Object.entries(this._tashasAbilityBonuses)
								.some(([k, v]) => k.startsWith("tasha_") && !k.includes("_amount") && k !== `tasha_${selIdx}` && v === optVal);
							opt.disabled = optVal && isSelectedElsewhere;
						});
					}
				});

				this._updateAbilitySummary();
			});

			row.append(selectEl);
			choices.append(row);
		});

		container.append(choices);
	}

	_resetAbilityScores () {
		if (this._abilityMethod === "standard") {
			// Don't auto-assign - let user choose
			this._abilityScores = {str: null, dex: null, con: null, int: null, wis: null, cha: null};
			this._standardArrayPool = [15, 14, 13, 12, 10, 8];
		} else {
			this._abilityScores = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		}
		this._pointBuyRemaining = 27;
	}

	_renderAbilityInputs () {
		const container = document.getElementById("builder-abilities-inputs");
		container.innerHTML = "";

		const pointsDisplay = document.getElementById("builder-points-remaining");
		pointsDisplay.style.display = (this._abilityMethod === "pointbuy") ? "" : "none";

		// Initialize standard array pool if needed
		if (this._abilityMethod === "standard" && !this._standardArrayPool) {
			this._standardArrayPool = [15, 14, 13, 12, 10, 8];
		}

		Parser.ABIL_ABVS.forEach(abl => {
			const score = this._abilityScores[abl];
			const racialBonus = this._getRacialBonus(abl);
			const total = (score || 0) + racialBonus;
			const mod = score != null ? Math.floor((total - 10) / 2) : null;

			const scoreDisplay = this._abilityMethod === "standard"
				? `<span class="charsheet__builder-ability-score charsheet__builder-ability-dropzone" data-ability="${abl}" style="min-width: 2rem; text-align: center; border: 1px dashed #ccc; padding: 0.25rem 0.5rem; cursor: pointer;">${score ?? "—"}</span>`
				: this._abilityMethod === "manual"
					? `<input type="number" class="ve-form-control form-control--minimal charsheet__builder-ability-score" value="${score}" min="3" max="18" title="Max starting score is 18 (before racial bonuses)">`
					: `<span class="charsheet__builder-ability-score">${score}</span>`;

			const row = e_({outer: `
				<div class="charsheet__builder-ability-row">
					<span class="charsheet__builder-ability-name">${Parser.attAbvToFull(abl)}</span>
					<div class="charsheet__builder-ability-controls">
						${this._abilityMethod === "pointbuy" ? `<button class="ve-btn ve-btn-default ve-btn-xs" data-action="decrease">−</button>` : ""}
						${scoreDisplay}
						${this._abilityMethod === "pointbuy" ? `<button class="ve-btn ve-btn-default ve-btn-xs" data-action="increase">+</button>` : ""}
						${racialBonus ? `<span class="charsheet__builder-ability-racial">+${racialBonus}</span>` : ""}
						<span class="charsheet__builder-ability-mod">(${mod != null ? (mod >= 0 ? "+" : "") + mod : "—"})</span>
					</div>
				</div>
			`});

			if (this._abilityMethod === "pointbuy") {
				row.querySelector("[data-action=\"decrease\"]").addEventListener("click", () => this._adjustPointBuy(abl, -1));
				row.querySelector("[data-action=\"increase\"]").addEventListener("click", () => this._adjustPointBuy(abl, 1));
			}

			if (this._abilityMethod === "manual") {
				row.querySelector("input").addEventListener("change", (e) => {
					// Max base score is 18 for starting characters (before racial bonuses)
					this._abilityScores[abl] = Math.max(3, Math.min(18, parseInt(e.target.value) || 8));
					e.target.value = this._abilityScores[abl]; // Update display if clamped
					this._updateAbilitySummary();
				});
			}

			container.append(row);
		});

		// Standard array assignment
		if (this._abilityMethod === "standard") {
			this._renderStandardArrayAssignment(container);
		}

		this._updateAbilitySummary();
	}

	_renderStandardArrayAssignment (container) {
		const assignment = e_({outer: `
			<div class="mt-3">
				<p class="ve-muted">Click a score, then click an ability to assign it:</p>
				<div class="ve-flex ve-flex-wrap" id="standard-array-pool"></div>
			</div>
		`});

		const pool = assignment.querySelector("#standard-array-pool");

		// Render available scores
		this._standardArrayPool.forEach((score, idx) => {
			const badge = e_({outer: `<span class="badge badge-primary mr-1 mb-1 charsheet__builder-score-badge" data-score="${score}" data-idx="${idx}" style="cursor: pointer; font-size: 1rem; padding: 0.5rem;">${score}</span>`});

			badge.addEventListener("click", () => {
				// Toggle selection
				if (badge.classList.contains("active")) {
					badge.classList.remove("active");
					this._selectedStandardScore = null;
				} else {
					[...pool.querySelectorAll(".badge")].forEach(_el => _el.classList.remove("active"));
					badge.classList.add("active");
					this._selectedStandardScore = {score, idx};
				}
			});

			pool.append(badge);
		});

		// Add click handlers to ability dropzones
		[...container.querySelectorAll(".charsheet__builder-ability-dropzone")].forEach(dz => dz.addEventListener("click", (e) => {
			const abl = e.target.dataset.ability;
			// Valid standard array scores that can be returned to pool
			const STANDARD_ARRAY_SCORES = [15, 14, 13, 12, 10, 8];

			if (this._selectedStandardScore != null) {
				// Assign the selected score to this ability
				const oldScore = this._abilityScores[abl];

				// If this ability already had a valid standard array score, put it back in the pool
				if (oldScore != null && STANDARD_ARRAY_SCORES.includes(oldScore)) {
					this._standardArrayPool.push(oldScore);
					this._standardArrayPool.sort((a, b) => b - a);
				}

				// Assign the new score
				this._abilityScores[abl] = this._selectedStandardScore.score;

				// Remove from pool
				this._standardArrayPool = this._standardArrayPool.filter((_, i) => i !== this._standardArrayPool.indexOf(this._selectedStandardScore.score));

				this._selectedStandardScore = null;
				this._renderAbilityInputs();
			} else if (this._abilityScores[abl] != null) {
				// Clicking an assigned ability with no selection - return to pool (only if valid score)
				if (STANDARD_ARRAY_SCORES.includes(this._abilityScores[abl])) {
					this._standardArrayPool.push(this._abilityScores[abl]);
					this._standardArrayPool.sort((a, b) => b - a);
				}
				this._abilityScores[abl] = null;
				this._renderAbilityInputs();
			}
		}));

		container.append(assignment);
	}

	_adjustPointBuy (ability, delta) {
		const currentScore = this._abilityScores[ability];
		const newScore = currentScore + delta;

		if (newScore < 8 || newScore > 15) return;

		const currentCost = this._getPointBuyCost(currentScore);
		const newCost = this._getPointBuyCost(newScore);
		const costDelta = newCost - currentCost;

		if (this._pointBuyRemaining - costDelta < 0) return;

		this._abilityScores[ability] = newScore;
		this._pointBuyRemaining -= costDelta;

		document.getElementById("points-value").textContent = this._pointBuyRemaining;
		this._renderAbilityInputs();
	}

	_getPointBuyCost (score) {
		if (score <= 8) return 0;
		if (score <= 13) return score - 8;
		if (score === 14) return 7;
		if (score === 15) return 9;
		return 0;
	}

	_getRacialBonus (ability) {
		// If using Tasha's Custom Origin rules, use custom bonuses
		if (this._useTashasRules) {
			let bonus = 0;
			Object.entries(this._tashasAbilityBonuses).forEach(([key, value]) => {
				if (key.includes("_amount")) return;
				if (value === ability) {
					const amountKey = `${key}_amount`;
					bonus += this._tashasAbilityBonuses[amountKey] || 0;
				}
			});
			return bonus;
		}

		// Standard racial bonuses
		let bonus = 0;

		const addFromAbilityEntries = (entries, raceName, raceSource) => {
			for (const {abiSet, originalIdx: abiIdx} of entries) {
				// Fixed entries (e.g., cha: 2) — always process
				if (abiSet[ability] && ability !== "choose") {
					bonus += abiSet[ability];
				}
				// Choose entries — look up stored choices
				if (abiSet.choose) {
					const raceKey = `${raceName}|${raceSource}`;
					const choices = this._selectedRacialAbilityChoices[raceKey] || {};
					Object.entries(choices).forEach(([key, val]) => {
						if (!key.startsWith(`choose_${abiIdx}_`) || key.includes("_amount") || !val) return;
						if (val === ability) {
							bonus += choices[`${key}_amount`] || 1;
						}
					});
				}
			}
		};

		if (this._selectedRace) {
			addFromAbilityEntries(this._getEffectiveAbilityEntries(this._selectedRace.ability, this._selectedRace.name, this._selectedRace.source), this._selectedRace.name, this._selectedRace.source);
		}
		if (this._selectedSubrace) {
			addFromAbilityEntries(this._getEffectiveAbilityEntries(this._selectedSubrace.ability, this._selectedSubrace.name, this._selectedSubrace.source), this._selectedSubrace.name, this._selectedSubrace.source);
		}

		return bonus;
	}

	_getRacialBonusesHtml () {
		const bonuses = [];

		const addBonusesFromEntries = (entries, raceName, raceSource, suffix) => {
			for (const {abiSet, originalIdx: abiIdx} of entries) {
				// Fixed entries (e.g., cha: 2) — always show
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						bonuses.push(`${Parser.attAbvToFull(abi)} +${bonus}${suffix}`);
					}
				});
				// Choose entries — show stored choices or pending message
				if (abiSet.choose) {
					const raceKey = `${raceName}|${raceSource}`;
					const choices = this._selectedRacialAbilityChoices[raceKey] || {};
					const isWeighted = !!abiSet.choose.weighted;
					const weights = isWeighted ? (abiSet.choose.weighted.weights || [2, 1]) : null;
					const count = isWeighted ? weights.length : (abiSet.choose.count || 1);

					let foundChoices = 0;
					for (let i = 0; i < count; i++) {
						const choiceKey = `choose_${abiIdx}_${i}`;
						const val = choices[choiceKey];
						const amt = isWeighted ? weights[i] : (abiSet.choose.amount || 1);
						if (val) {
							bonuses.push(`${Parser.attAbvToFull(val)} +${amt}${suffix ? suffix : ""} (chosen)`);
							foundChoices++;
						}
					}
					if (foundChoices < count) {
						const remaining = count - foundChoices;
						if (isWeighted) {
							const remainingWeights = weights.filter((_, i) => !choices[`choose_${abiIdx}_${i}`]);
							bonuses.push(`Choose ${remaining} more: +${remainingWeights.join("/+")}${suffix}`);
						} else {
							bonuses.push(`Choose ${remaining} more: +${abiSet.choose.amount || 1}${suffix}`);
						}
					}
				}
			}
		};

		if (this._selectedRace) {
			addBonusesFromEntries(this._getEffectiveAbilityEntries(this._selectedRace.ability, this._selectedRace.name, this._selectedRace.source), this._selectedRace.name, this._selectedRace.source, "");
		}
		if (this._selectedSubrace) {
			addBonusesFromEntries(this._getEffectiveAbilityEntries(this._selectedSubrace.ability, this._selectedSubrace.name, this._selectedSubrace.source), this._selectedSubrace.name, this._selectedSubrace.source, ` (${this._selectedSubrace.name})`);
		}

		return bonuses.length ? bonuses.join("<br>") : "<p class='ve-muted'>No racial ability bonuses</p>";
	}

	_updateAbilitySummary () {
		const summary = document.getElementById("builder-abilities-summary");
		if (!summary) return;
		summary.innerHTML = "";

		let allAssigned = true;
		Parser.ABIL_ABVS.forEach(abl => {
			const base = this._abilityScores[abl];
			const racial = this._getRacialBonus(abl);

			// Handle unassigned scores (null in standard array mode)
			if (base == null) {
				allAssigned = false;
				summary.insertAdjacentHTML("beforeend", `
					<div class="ve-flex-v-center">
						<strong class="mr-2" style="width: 80px;">${Parser.attAbvToFull(abl)}:</strong>
						<span class="ve-muted">—${racial ? ` (+${racial})` : ""}</span>
					</div>
				`);
				return;
			}

			const total = base + racial;
			const mod = Math.floor((total - 10) / 2);

			summary.insertAdjacentHTML("beforeend", `
				<div class="ve-flex-v-center">
					<strong class="mr-2" style="width: 80px;">${Parser.attAbvToFull(abl)}:</strong>
					<span>${total} (${mod >= 0 ? "+" : ""}${mod})</span>
				</div>
			`);
		});

		// Show warning if using standard array and not all scores assigned
		if (this._abilityMethod === "standard" && !allAssigned) {
			summary.append(e_({outer: `<p class="ve-muted mt-2 ve-small">Assign all scores from the standard array above.</p>`}));
		}
	}
	// #endregion

	// #region Step 4: Background
	_renderBackgroundStep (content) {
		// Get backgrounds filtered by allowed sources
		const backgrounds = this._page.filterByAllowedSources(this._page.getBackgrounds());

		const container = e_({outer: `
			<div class="charsheet__builder-selection">
				<div class="charsheet__builder-list">
					<div class="charsheet__builder-list-header">
						<input type="text" class="ve-form-control form-control--minimal" placeholder="Search backgrounds..." id="builder-bg-search">
					</div>
					<div class="charsheet__builder-list-content" id="builder-bg-list"></div>
					<div class="charsheet__builder-list-footer p-2" style="border-top: 1px solid var(--rgb-border-grey);">
						<button class="ve-btn ve-btn-xs ve-btn-default w-100" id="builder-custom-bg-btn">
							<span class="glyphicon glyphicon-plus mr-1"></span>Create Custom Background
						</button>
					</div>
				</div>
				<div class="charsheet__builder-preview" id="builder-bg-preview">
					<div class="charsheet__builder-preview-placeholder">Select a background to see details</div>
				</div>
			</div>
		`});

		content.append(container);

		const list = document.getElementById("builder-bg-list");
		const preview = document.getElementById("builder-bg-preview");
		const searchEl = document.getElementById("builder-bg-search");

		// Custom background button
		document.getElementById("builder-custom-bg-btn").addEventListener("click", () => {
			this._showCustomBackgroundCreator(preview);
		});

		const renderBgList = (filter = "") => {
			list.innerHTML = "";
			const filterLower = filter.toLowerCase();

			// Add "Custom" option at the top if we have a custom background selected
			if (this._customBackground) {
				const isSelected = this._selectedBackground === this._customBackground;
				const customItem = e_({outer: `
					<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
						<span class="charsheet__builder-list-item-name">${this._customBackground.name}</span>
						<span class="charsheet__builder-list-item-source">Custom</span>
					</div>
				`});
				customItem.addEventListener("click", () => {
					[...list.querySelectorAll(".charsheet__builder-list-item")].forEach(_el => _el.classList.remove("active"));
					customItem.classList.add("active");
					this._selectedBackground = this._customBackground;
					this._selectedToolProficiencies = [];
					this._selectedLanguages = [];
					this._renderBackgroundPreview(preview, this._customBackground);
				});
				list.append(customItem);
			}

			backgrounds
				.filter(bg => !filter || bg.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.forEach(bg => {
					const isSelected = this._selectedBackground?.name === bg.name && !this._selectedBackground?._isCustom;
					const item = e_({outer: `
						<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
							<span class="charsheet__builder-list-item-name">${bg.name}</span>
							<span class="charsheet__builder-list-item-source">${Parser.sourceJsonToAbv(bg.source)}</span>
						</div>
					`});

					item.addEventListener("click", () => {
						[...list.querySelectorAll(".charsheet__builder-list-item")].forEach(_el => _el.classList.remove("active"));
						item.classList.add("active");
						this._selectedBackground = bg;
						// Reset tool and language choices when changing background
						this._selectedToolProficiencies = [];
						this._selectedLanguages = [];
						this._renderBackgroundPreview(preview, bg);
					});

					list.append(item);
				});
		};

		searchEl.addEventListener("input", (e) => renderBgList(e.target.value));
		renderBgList();

		if (this._selectedBackground) {
			this._renderBackgroundPreview(preview, this._selectedBackground);
		}
	}

	/**
	 * Show the custom background creation form
	 */
	_showCustomBackgroundCreator (preview) {
		preview.innerHTML = "";

		// Initialize custom background data
		if (!this._customBackgroundData) {
			this._customBackgroundData = {
				name: "Custom Background",
				skills: [],
				tools: [],
				languages: [],
				equipment: "",
				feature: "",
			};
		}

		const allSkills = this._page.getSkillsList().map(s => s.name);
		const allTools = [
			"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
			"Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
			"Cook's Utensils", "Disguise Kit", "Forgery Kit", "Gaming Set",
			"Glassblower's Tools", "Herbalism Kit", "Jeweler's Tools",
			"Leatherworker's Tools", "Mason's Tools", "Musical Instrument",
			"Navigator's Tools", "Painter's Supplies", "Poisoner's Kit",
			"Potter's Tools", "Smith's Tools", "Thieves' Tools",
			"Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools",
		];
		const allLanguages = this._page.getLanguagesList().map(l => l.name);

		const content = e_({outer: `
			<div class="charsheet__custom-bg-creator">
				<h4>Create Custom Background</h4>
				<p class="ve-muted ve-small mb-3">Build your own background with custom proficiencies and features.</p>
				
				<div class="charsheet__section mb-3">
					<label class="ve-block mb-1"><strong>Background Name:</strong></label>
					<input type="text" class="ve-form-control form-control--minimal" id="custom-bg-name" 
						value="${this._customBackgroundData.name}" placeholder="Enter background name">
				</div>

				<div class="charsheet__section mb-3">
					<label class="ve-block mb-1"><strong>Skill Proficiencies:</strong> <span class="ve-muted">(choose 2)</span></label>
					<div id="custom-bg-skills" class="charsheet__builder-skill-checkboxes"></div>
				</div>

				<div class="charsheet__section mb-3">
					<label class="ve-block mb-1"><strong>Tool/Language Proficiencies:</strong> <span class="ve-muted">(choose 2 total)</span></label>
					<div class="ve-flex-col">
						<div class="mb-2">
							<label class="ve-muted ve-small">Tools:</label>
							<select class="ve-form-control form-control--minimal" id="custom-bg-tool1">
								<option value="">-- None --</option>
							</select>
						</div>
						<div class="mb-2">
							<label class="ve-muted ve-small">Languages:</label>
							<select class="ve-form-control form-control--minimal" id="custom-bg-lang1">
								<option value="">-- None --</option>
							</select>
						</div>
						<div>
							<label class="ve-muted ve-small">Additional (Tool or Language):</label>
							<select class="ve-form-control form-control--minimal" id="custom-bg-extra">
								<option value="">-- None --</option>
								<optgroup label="──── Tools ────" id="custom-bg-extra-tools"></optgroup>
							</select>
						</div>
					</div>
				</div>

				<div class="charsheet__section mb-3">
					<label class="ve-block mb-1"><strong>Equipment:</strong></label>
					<textarea class="ve-form-control form-control--minimal" id="custom-bg-equipment" rows="2" 
						placeholder="e.g., A set of common clothes, a trinket, 15 gp">${this._customBackgroundData.equipment || ""}</textarea>
				</div>

				<div class="charsheet__section mb-3">
					<label class="ve-block mb-1"><strong>Feature Name:</strong></label>
					<input type="text" class="ve-form-control form-control--minimal" id="custom-bg-feature" 
						value="${this._customBackgroundData.feature || ""}" placeholder="e.g., Shelter of the Faithful">
				</div>

				<div class="ve-flex-v-center ve-flex-h-right mt-3">
					<button class="ve-btn ve-btn-default mr-2" id="custom-bg-cancel">Cancel</button>
					<button class="ve-btn ve-btn-primary" id="custom-bg-save">Create Background</button>
				</div>
			</div>
		`});

		preview.append(content);

		// Populate skill checkboxes
		const skillsContainer = document.getElementById("custom-bg-skills");
		allSkills.forEach(skill => {
			const isSelected = this._customBackgroundData.skills.includes(skill);
			const cb = e_({outer: `
				<label class="charsheet__builder-skill-checkbox">
					<input type="checkbox" data-skill="${skill}" ${isSelected ? "checked" : ""}>
					<span>${skill}</span>
				</label>
			`});
			cb.querySelector("input").addEventListener("change", () => this._updateCustomBgSkills());
			skillsContainer.append(cb);
		});

		// Populate tool dropdown
		const toolSelectEl = document.getElementById("custom-bg-tool1");
		allTools.forEach(tool => {
			toolSelectEl.append(e_({outer: `<option value="${tool}" ${this._customBackgroundData.tools[0] === tool ? "selected" : ""}>${tool}</option>`}));
		});

		// Populate language dropdown with grouped options
		const langOptions = this._page.getLanguageOptionsGrouped?.() || {
			standard: Parser.LANGUAGES_STANDARD,
			exotic: Parser.LANGUAGES_EXOTIC,
			secret: Parser.LANGUAGES_SECRET,
			homebrew: [],
		};

		// Build source lookup for language display
		const bgPrioritySources = this._state.getPrioritySources() || [];
		const bgSourceLookup = new Map();
		for (const lang of (this._page._languagesData || [])) {
			const existing = bgSourceLookup.get(lang.name);
			if (!existing) {
				bgSourceLookup.set(lang.name, lang.source);
			} else if (bgPrioritySources.includes(lang.source) && !bgPrioritySources.includes(existing)) {
				bgSourceLookup.set(lang.name, lang.source);
			}
		}

		const langSelectEl = document.getElementById("custom-bg-lang1");
		const addCustomBgLangOptgroup = (selectEl, label, langs, valueFn, selectedFn) => {
			if (!langs.length) return;
			const grp = e_({outer: `<optgroup label="${label}"></optgroup>`});
			langs.forEach(lang => {
				const src = bgSourceLookup.get(lang);
				const display = src ? `${lang} (${src})` : lang;
				grp.append(e_({outer: `<option value="${valueFn(lang)}" ${selectedFn(lang) ? "selected" : ""}>${display}</option>`}));
			});
			selectEl.append(grp);
		};
		const langSelectedFn = lang => this._customBackgroundData.languages[0] === lang;
		const langValueFn = lang => lang;
		addCustomBgLangOptgroup(langSelectEl, "──── Homebrew Languages ────", langOptions.homebrew, langValueFn, langSelectedFn);
		addCustomBgLangOptgroup(langSelectEl, "──── Standard Languages ────", langOptions.standard, langValueFn, langSelectedFn);
		addCustomBgLangOptgroup(langSelectEl, "──── Exotic/Rare Languages ────", langOptions.exotic, langValueFn, langSelectedFn);
		addCustomBgLangOptgroup(langSelectEl, "──── Secret Languages ────", langOptions.secret, langValueFn, langSelectedFn);

		// Populate extra dropdown (combined tools and languages)
		const extraSelect = document.getElementById("custom-bg-extra");
		const extraToolsGroup = document.getElementById("custom-bg-extra-tools");
		allTools.forEach(tool => {
			extraToolsGroup.append(e_({outer: `<option value="tool:${tool}">${tool}</option>`}));
		});
		// Add language optgroups as direct children of <select> (not nested inside another optgroup)
		const addExtraLangOptgroup = (label, langs) => {
			if (!langs.length) return;
			const grp = e_({outer: `<optgroup label="${label}"></optgroup>`});
			langs.forEach(lang => {
				const src = bgSourceLookup.get(lang);
				const display = src ? `${lang} (${src})` : lang;
				grp.append(e_({outer: `<option value="lang:${lang}">${display}</option>`}));
			});
			extraSelect.append(grp);
		};
		addExtraLangOptgroup("──── Homebrew Languages ────", langOptions.homebrew);
		addExtraLangOptgroup("──── Standard Languages ────", langOptions.standard);
		addExtraLangOptgroup("──── Exotic/Rare Languages ────", langOptions.exotic);
		addExtraLangOptgroup("──── Secret Languages ────", langOptions.secret);

		// Event handlers
		document.getElementById("custom-bg-name").addEventListener("input", (e) => {
			this._customBackgroundData.name = e.target.value || "Custom Background";
		});

		document.getElementById("custom-bg-tool1").addEventListener("change", (e) => {
			this._customBackgroundData.tools[0] = e.target.value;
		});

		document.getElementById("custom-bg-lang1").addEventListener("change", (e) => {
			this._customBackgroundData.languages[0] = e.target.value;
		});

		document.getElementById("custom-bg-extra").addEventListener("change", (e) => {
			const val = e.target.value;
			if (val.startsWith("tool:")) {
				this._customBackgroundData.tools[1] = val.replace("tool:", "");
				this._customBackgroundData.languages[1] = "";
			} else if (val.startsWith("lang:")) {
				this._customBackgroundData.languages[1] = val.replace("lang:", "");
				this._customBackgroundData.tools[1] = "";
			} else {
				this._customBackgroundData.tools[1] = "";
				this._customBackgroundData.languages[1] = "";
			}
		});

		document.getElementById("custom-bg-equipment").addEventListener("input", (e) => {
			this._customBackgroundData.equipment = e.target.value;
		});

		document.getElementById("custom-bg-feature").addEventListener("input", (e) => {
			this._customBackgroundData.feature = e.target.value;
		});

		document.getElementById("custom-bg-cancel").addEventListener("click", () => {
			if (this._selectedBackground) {
				this._renderBackgroundPreview(preview, this._selectedBackground);
			} else {
				preview.innerHTML = `<div class="charsheet__builder-preview-placeholder">Select a background to see details</div>`;
			}
		});

		document.getElementById("custom-bg-save").addEventListener("click", () => {
			// Validate
			if (this._customBackgroundData.skills.length !== 2) {
				JqueryUtil.doToast({type: "warning", content: "Please select exactly 2 skill proficiencies."});
				return;
			}

			// Build the custom background object
			this._customBackground = this._buildCustomBackground();
			this._selectedBackground = this._customBackground;

			// Re-render the list to show the custom background
			const list = document.getElementById("builder-bg-list");
			const searchEl = document.getElementById("builder-bg-search");
			this._renderBackgroundStep_refreshList(list, searchEl.value);

			// Show the preview
			this._renderBackgroundPreview(preview, this._customBackground);
		});
	}

	_updateCustomBgSkills () {
		const selected = [];
		[...document.querySelectorAll("#custom-bg-skills input:checked")].forEach((el) => {
			selected.push(el.dataset.skill);
		});

		// Limit to 2 skills
		if (selected.length > 2) {
			// Uncheck the last one
			const allChecked = [...document.querySelectorAll("#custom-bg-skills input:checked")];
			if (allChecked.length > 2) allChecked.at(-1).checked = false;
			selected.pop();
		}

		this._customBackgroundData.skills = selected;
	}

	_renderBackgroundStep_refreshList (list, filter = "") {
		const backgrounds = this._page.filterByAllowedSources(this._page.getBackgrounds());
		list.innerHTML = "";
		const filterLower = (filter || "").toLowerCase();

		// Add custom background at top if exists
		if (this._customBackground) {
			const isSelected = this._selectedBackground === this._customBackground;
			const customItem = e_({outer: `
				<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
					<span class="charsheet__builder-list-item-name">${this._customBackground.name}</span>
					<span class="charsheet__builder-list-item-source">Custom</span>
				</div>
			`});
			customItem.addEventListener("click", () => {
				[...list.querySelectorAll(".charsheet__builder-list-item")].forEach(_el => _el.classList.remove("active"));
				customItem.classList.add("active");
				this._selectedBackground = this._customBackground;
				this._selectedToolProficiencies = [];
				this._selectedLanguages = [];
				this._renderBackgroundPreview(document.getElementById("builder-bg-preview"), this._customBackground);
			});
			list.append(customItem);
		}

		backgrounds
			.filter(bg => !filter || bg.name.toLowerCase().includes(filterLower))
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach(bg => {
				const isSelected = this._selectedBackground?.name === bg.name && !this._selectedBackground?._isCustom;
				const item = e_({outer: `
					<div class="charsheet__builder-list-item ${isSelected ? "active" : ""}">
						<span class="charsheet__builder-list-item-name">${bg.name}</span>
						<span class="charsheet__builder-list-item-source">${Parser.sourceJsonToAbv(bg.source)}</span>
					</div>
				`});

				item.addEventListener("click", () => {
					[...list.querySelectorAll(".charsheet__builder-list-item")].forEach(_el => _el.classList.remove("active"));
					item.classList.add("active");
					this._selectedBackground = bg;
					this._selectedToolProficiencies = [];
					this._selectedLanguages = [];
					this._renderBackgroundPreview(document.getElementById("builder-bg-preview"), bg);
				});

				list.append(item);
			});
	}

	/**
	 * Build a background object from custom background data
	 */
	_buildCustomBackground () {
		const data = this._customBackgroundData;

		// Build skill proficiencies array
		const skillProfs = data.skills.map(s => s.toLowerCase().replace(/\s+/g, " "));

		// Build tool proficiencies - detect choice-based tools vs fixed tools
		const toolProfs = data.tools.filter(t => t);
		const choiceToolMap = {
			"musical instrument": "anyMusicalInstrument",
			"artisan's tools": "anyArtisansTool",
			"gaming set": "anyGamingSet",
		};
		const fixedTools = toolProfs.filter(t => !choiceToolMap[t.toLowerCase()]);
		const choiceTools = toolProfs.filter(t => choiceToolMap[t.toLowerCase()]);

		// Build toolProficiencies array with correct structure
		const toolProficiencies = [];
		if (fixedTools.length) {
			toolProficiencies.push(Object.fromEntries(fixedTools.map(t => [t.toLowerCase(), true])));
		}
		choiceTools.forEach(t => {
			const key = choiceToolMap[t.toLowerCase()];
			toolProficiencies.push({[key]: 1});
		});

		// Build language proficiencies
		const langProfs = data.languages.filter(l => l);

		return {
			name: data.name || "Custom Background",
			source: "Custom",
			_isCustom: true,
			skillProficiencies: skillProfs.length ? [{[skillProfs[0]]: true, [skillProfs[1]]: true}] : [],
			toolProficiencies: toolProficiencies,
			languageProficiencies: langProfs.length ? [Object.fromEntries(langProfs.map(l => [l.toLowerCase(), true]))] : [],
			entries: [
				data.feature ? {
					type: "entries",
					name: `Feature: ${data.feature}`,
					entries: ["Custom background feature."],
				} : null,
				data.equipment ? {
					type: "entries",
					name: "Equipment",
					entries: [data.equipment],
				} : null,
			].filter(Boolean),
		};
	}

	_renderBackgroundPreview (preview, bg) {
		preview.innerHTML = "";

		const content = e_({outer: `
			<div>
				<h4>${bg.name}</h4>
				<p class="ve-muted">${Parser.sourceJsonToFull(bg.source)}</p>
			</div>
		`});

		// Edition mixing detection
		const raceIs2024 = this._raceUses2024ASI();
		const bgIs2024 = this._is2024Edition(bg);
		const bgHasASI = bg.ability && bg.ability.length;

		// Show edition mixing warnings
		if (this._selectedRace) {
			if (!raceIs2024 && bgIs2024) {
				// 2014 race + 2024 background: warn that ASI from background shouldn't apply
				content.insertAdjacentHTML("beforeend", `
					<div class="alert alert-warning ve-small mb-2">
						<strong>Edition Mixing:</strong> You've selected a 2014 race that provides its own ability score bonuses. 
						The ASI options from this 2024 background will be ignored. Consider using a 2014 background instead.
					</div>
				`);
			} else if (raceIs2024 && !bgHasASI && !bgIs2024) {
				// 2024 species + 2014 background (no ASI): offer free ASI choice
				content.insertAdjacentHTML("beforeend", `
					<div class="alert alert-info ve-small mb-2">
						<strong>Note:</strong> You've selected a 2024 species that expects ability score bonuses from your background. 
						Since this is a 2014 background without ASI, you can choose +2 to one ability and +1 to another below.
					</div>
				`);
			}
		}

		// Ability Score Increases
		// Show ASI if: 2024 background has it OR 2024 species + 2014 background needs free choice
		const showBackgroundASI = (bgHasASI && (raceIs2024 || !this._selectedRace));
		const showFreeASIChoice = (raceIs2024 && !bgHasASI);

		if (showBackgroundASI || showFreeASIChoice) {
			const asiSection = e_({outer: `<div class="charsheet__section mb-2"></div>`});
			asiSection.append(e_({outer: `<p><strong>Ability Score Increases:</strong></p>`}));

			// Initialize selected ability bonuses if not set
			if (!this._selectedAbilityBonuses) {
				this._selectedAbilityBonuses = {};
			}

			if (showBackgroundASI && bgHasASI) {
				// Use the background's ASI options
				this._renderBackgroundASIChoices(asiSection, bg.ability[0]);
			} else if (showFreeASIChoice) {
				// Free choice: +2 to one, +1 to another from any ability
				this._renderFreeASIChoices(asiSection);
			}

			content.append(asiSection);
		}

		// Skills - show summary with overlap warnings for skills already chosen elsewhere
		if (bg.skillProficiencies) {
			const takenByOthers = this._getSkillsFromOtherSources("background");

			// Collect fixed skill names from this background
			const bgFixedSkills = [];
			bg.skillProficiencies.forEach(skillSet => {
				Object.keys(skillSet).forEach(skill => {
					if (skill !== "choose" && skill !== "any") {
						bgFixedSkills.push(skill.toTitleCase());
					}
				});
			});

			const overlaps = bgFixedSkills.filter(s => takenByOthers.has(s));

			// Build skill source map so hover resolves homebrew skills correctly
			const skillSourceMap = new Map();
			for (const skill of (this._page._skillsData || [])) {
				skillSourceMap.set(skill.name.toLowerCase(), skill.source);
			}

			const {summary: skillSummary} = Renderer.generic.getSkillSummary({
				skillProfs: bg.skillProficiencies,
				skillToolLanguageProfs: bg.skillToolLanguageProficiencies,
				isShort: false,
				sourceMap: skillSourceMap,
			});
			if (skillSummary) {
				content.append(e_({outer: `<p><strong>Skills:</strong> ${Renderer.get().render(skillSummary)}</p>`}));
			}

			if (overlaps.length) {
				const overlapList = overlaps.map(s => `<strong>${s}</strong> (${takenByOthers.get(s)})`).join(", ");
				content.append(e_({outer: `
					<div class="alert alert-warning ve-small mb-2">
						⚠️ <strong>Skill overlap:</strong> ${overlapList} ${overlaps.length === 1 ? "is" : "are"} already chosen — picking this background wastes ${overlaps.length === 1 ? "a skill" : `${overlaps.length} skills`}. You can go back to the race step and choose a different skill to accommodate, if possible, or talk with your DM.
					</div>
				`}));
			}
		}

		// Tools - show fixed tools and render choice UI if needed
		this._renderBackgroundToolProficiencies(content, bg);

		// Languages - show fixed languages and render choice UI if needed
		this._renderBackgroundLanguages(content, bg);

		// Equipment
		if (bg.startingEquipment) {
			content.append(e_({outer: `<div class="mb-1"><strong>Equipment:</strong> ${Renderer.get().render({entries: bg.startingEquipment})}</div>`}));
		}

		// Features
		if (bg.entries) {
			const features = e_({outer: `<div class="mt-2"></div>`});
			bg.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					features.append(e_({outer: `<div class="mb-1"><strong>${entry.name}.</strong> ${Renderer.get().render({entries: entry.entries || []})}</div>`}));
				}
			});
			content.append(features);
		}

		preview.append(content);
	}

	/**
	 * Render tool proficiencies section with choice UI when needed
	 */
	_renderBackgroundToolProficiencies (content, bg) {
		if (!bg.toolProficiencies?.length) return;

		const toolSection = e_({outer: `<div class="charsheet__builder-tool-profs mb-2"></div>`});

		// Collect fixed tools and choice options
		const fixedTools = [];
		const choiceOptions = [];
		let anyToolCount = 0;
		let anyArtisanCount = 0;
		let anyMusicalInstrumentCount = 0;

		bg.toolProficiencies.forEach(toolSet => {
			Object.entries(toolSet).forEach(([key, value]) => {
				if (key === "choose" && value.from) {
					choiceOptions.push({
						from: value.from,
						count: value.count || 1,
					});
				} else if (key === "any") {
					anyToolCount += (typeof value === "number" ? value : 1);
				} else if (key === "anyArtisansTool") {
					anyArtisanCount += (typeof value === "number" ? value : 1);
				} else if (key === "anyMusicalInstrument") {
					anyMusicalInstrumentCount += (typeof value === "number" ? value : 1);
				} else if (value === true) {
					fixedTools.push(key);
				}
			});
		});

		// Show fixed tools
		if (fixedTools.length) {
			toolSection.append(e_({outer: `<p><strong>Tools:</strong> ${fixedTools.map(t => t.toTitleCase()).join(", ")}</p>`}));
		}

		// Render choice dropdowns for "choose from" options
		choiceOptions.forEach((choice, choiceIdx) => {
			const choiceSection = e_({outer: `<div class="charsheet__builder-tool-choice mt-1"></div>`});
			choiceSection.append(e_({outer: `<p class="mb-1"><strong>Choose ${choice.count} tool${choice.count > 1 ? "s" : ""}:</strong></p>`}));

			for (let i = 0; i < choice.count; i++) {
				const selectId = `bg-tool-choice-${choiceIdx}-${i}`;
				const selectEl = e_({outer: `
					<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
						<option value="">-- Select Tool --</option>
					</select>
				`});

				choice.from.forEach(tool => {
					selectEl.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`}));
				});

				// Pre-select if already chosen
				const existingChoice = this._selectedToolProficiencies.find(t => t.choiceIdx === choiceIdx && t.selectIdx === i);
				if (existingChoice) {
					selectEl.value = existingChoice.tool;
				}

				selectEl.addEventListener("change", (e) => {
					// Remove old choice for this select
					this._selectedToolProficiencies = this._selectedToolProficiencies.filter(
						t => !(t.choiceIdx === choiceIdx && t.selectIdx === i),
					);
					// Add new choice
					if (e.target.value) {
						this._selectedToolProficiencies.push({
							choiceIdx,
							selectIdx: i,
							tool: e.target.value,
						});
					}
				});

				choiceSection.append(selectEl);
			}
			toolSection.append(choiceSection);
		});

		// Render "any tool" selection
		if (anyToolCount > 0) {
			const anySection = e_({outer: `<div class="charsheet__builder-tool-any mt-1"></div>`});
			anySection.append(e_({outer: `<p class="mb-1"><strong>Choose ${anyToolCount} tool${anyToolCount > 1 ? "s" : ""} (any):</strong></p>`}));

			const allTools = Renderer.generic.FEATURE__TOOLS_ALL;
			for (let i = 0; i < anyToolCount; i++) {
				const selectId = `bg-tool-any-${i}`;
				const selectEl = e_({outer: `
					<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
						<option value="">-- Select Tool --</option>
					</select>
				`});

				allTools.forEach(tool => {
					selectEl.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`}));
				});

				const existingChoice = this._selectedToolProficiencies.find(t => t.anyIdx === i && !t.isArtisan);
				if (existingChoice) {
					selectEl.value = existingChoice.tool;
				}

				selectEl.addEventListener("change", (e) => {
					this._selectedToolProficiencies = this._selectedToolProficiencies.filter(
						t => !(t.anyIdx === i && !t.isArtisan),
					);
					if (e.target.value) {
						this._selectedToolProficiencies.push({
							anyIdx: i,
							tool: e.target.value,
							isArtisan: false,
						});
					}
				});

				anySection.append(selectEl);
			}
			toolSection.append(anySection);
		}

		// When both artisan and musical instrument are present with count=1 each,
		// render a combined "choose one OR the other" picker (e.g. TGTT backgrounds,
		// Mulmaster Aristocrat) instead of two independent dropdowns
		if (anyArtisanCount === 1 && anyMusicalInstrumentCount === 1) {
			const orSection = e_({outer: `<div class="charsheet__builder-tool-or-choice mt-1"></div>`});
			orSection.append(e_({outer: `<p class="mb-1"><strong>Choose one artisan's tool or musical instrument:</strong></p>`}));

			const artisanTools = Renderer.generic.FEATURE__TOOLS_ARTISANS;
			const musicalInstruments = Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS;

			const categorySelect = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" id="bg-tool-or-category">
					<option value="">-- Select Category --</option>
					<option value="artisan">Artisan's Tools</option>
					<option value="instrument">Musical Instrument</option>
				</select>
			`});

			const toolSelectEl = e_({outer: `
				<select class="ve-form-control form-control--minimal mb-1" id="bg-tool-or-specific" style="display: none;">
					<option value="">-- Select Tool --</option>
				</select>
			`});

			// Pre-select if already chosen
			const existingArtisan = this._selectedToolProficiencies.find(t => t.isArtisanOrInstrument && t.isArtisan);
			const existingInstrument = this._selectedToolProficiencies.find(t => t.isArtisanOrInstrument && t.isMusicalInstrument);
			const existingOrChoice = existingArtisan || existingInstrument;

			const populateToolSelect = (category) => {
				toolSelectEl.innerHTML = "".append(e_({outer: `<option value="">-- Select ${category === "artisan" ? "Artisan's Tool" : "Musical Instrument"} --</option>`}));
				const tools = category === "artisan" ? artisanTools : musicalInstruments;
				tools.forEach(tool => {
					toolSelectEl.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`}));
				});
				toolSelectEl.style.display = "";
			};

			if (existingOrChoice) {
				const cat = existingArtisan ? "artisan" : "instrument";
				categorySelect.value = cat;
				populateToolSelect(cat);
				toolSelectEl.value = existingOrChoice.tool;
			}

			categorySelect.addEventListener("change", (e) => {
				// Clear previous or-choice
				this._selectedToolProficiencies = this._selectedToolProficiencies.filter(t => !t.isArtisanOrInstrument);
				if (e.target.value) {
					populateToolSelect(e.target.value);
				} else {
					toolSelectEl.style.display = "none";
				}
			});

			toolSelectEl.addEventListener("change", (e) => {
				this._selectedToolProficiencies = this._selectedToolProficiencies.filter(t => !t.isArtisanOrInstrument);
				const category = categorySelect.value;
				if (e.target.value) {
					this._selectedToolProficiencies.push({
						anyIdx: 0,
						tool: e.target.value,
						isArtisan: category === "artisan",
						isMusicalInstrument: category === "instrument",
						isArtisanOrInstrument: true,
					});
				}
			});

			orSection.append(categorySelect, toolSelectEl);
			toolSection.append(orSection);

			// Consume both counts so they aren't rendered independently below
			anyArtisanCount = 0;
			anyMusicalInstrumentCount = 0;
		}

		// Render "any artisan's tool" selection
		if (anyArtisanCount > 0) {
			const artisanSection = e_({outer: `<div class="charsheet__builder-tool-artisan mt-1"></div>`});
			artisanSection.append(e_({outer: `<p class="mb-1"><strong>Choose ${anyArtisanCount} artisan's tool${anyArtisanCount > 1 ? "s" : ""}:</strong></p>`}));

			const artisanTools = Renderer.generic.FEATURE__TOOLS_ARTISANS;
			for (let i = 0; i < anyArtisanCount; i++) {
				const selectId = `bg-tool-artisan-${i}`;
				const selectEl = e_({outer: `
					<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
						<option value="">-- Select Artisan's Tool --</option>
					</select>
				`});

				artisanTools.forEach(tool => {
					selectEl.append(e_({outer: `<option value="${tool}">${tool.toTitleCase()}</option>`}));
				});

				const existingChoice = this._selectedToolProficiencies.find(t => t.anyIdx === i && t.isArtisan && !t.isArtisanOrInstrument);
				if (existingChoice) {
					selectEl.value = existingChoice.tool;
				}

				selectEl.addEventListener("change", (e) => {
					this._selectedToolProficiencies = this._selectedToolProficiencies.filter(
						t => !(t.anyIdx === i && t.isArtisan && !t.isArtisanOrInstrument),
					);
					if (e.target.value) {
						this._selectedToolProficiencies.push({
							anyIdx: i,
							tool: e.target.value,
							isArtisan: true,
						});
					}
				});

				artisanSection.append(selectEl);
			}
			toolSection.append(artisanSection);
		}

		// Render "any musical instrument" selection
		if (anyMusicalInstrumentCount > 0) {
			const instrumentSection = e_({outer: `<div class="charsheet__builder-tool-instrument mt-1"></div>`});
			instrumentSection.append(e_({outer: `<p class="mb-1"><strong>Choose ${anyMusicalInstrumentCount} musical instrument${anyMusicalInstrumentCount > 1 ? "s" : ""}:</strong></p>`}));

			const musicalInstruments = Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS;
			for (let i = 0; i < anyMusicalInstrumentCount; i++) {
				const selectId = `bg-tool-instrument-${i}`;
				const selectEl = e_({outer: `
					<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
						<option value="">-- Select Musical Instrument --</option>
					</select>
				`});

				musicalInstruments.forEach(instrument => {
					selectEl.append(e_({outer: `<option value="${instrument}">${instrument.toTitleCase()}</option>`}));
				});

				const existingChoice = this._selectedToolProficiencies.find(t => t.anyIdx === i && t.isMusicalInstrument && !t.isArtisanOrInstrument);
				if (existingChoice) {
					selectEl.value = existingChoice.tool;
				}

				selectEl.addEventListener("change", (e) => {
					this._selectedToolProficiencies = this._selectedToolProficiencies.filter(
						t => !(t.anyIdx === i && t.isMusicalInstrument && !t.isArtisanOrInstrument),
					);
					if (e.target.value) {
						this._selectedToolProficiencies.push({
							anyIdx: i,
							tool: e.target.value,
							isMusicalInstrument: true,
						});
					}
				});

				instrumentSection.append(selectEl);
			}
			toolSection.append(instrumentSection);
		}

		if (fixedTools.length || choiceOptions.length || anyToolCount || anyArtisanCount || anyMusicalInstrumentCount) {
			content.append(toolSection);
		}
	}

	/**
	 * Render language proficiencies section with choice UI when needed
	 */
	_renderBackgroundLanguages (content, bg) {
		if (!bg.languageProficiencies?.length) return;

		const langSection = e_({outer: `<div class="charsheet__builder-lang-profs mb-2"></div>`});

		// Collect fixed languages and choice options
		const fixedLangs = [];
		let anyStandardCount = 0;
		let anyCount = 0;

		bg.languageProficiencies.forEach(langSet => {
			Object.entries(langSet).forEach(([key, value]) => {
				if (key === "anyStandard") {
					anyStandardCount += (typeof value === "number" ? value : 1);
				} else if (key === "any") {
					anyCount += (typeof value === "number" ? value : 1);
				} else if (value === true) {
					fixedLangs.push(key);
				}
			});
		});

		// Show fixed languages
		if (fixedLangs.length) {
			langSection.append(e_({outer: `<p><strong>Languages:</strong> ${fixedLangs.map(l => l.toTitleCase()).join(", ")}</p>`}));
		}

		// Render language choice dropdowns
		const totalLangChoices = anyStandardCount + anyCount;
		if (totalLangChoices > 0) {
			const choiceSection = e_({outer: `<div class="charsheet__builder-lang-choice mt-1"></div>`});

			// Check setting for allowing exotic languages by default
			const settings = this._state?.getSettings?.() || {};
			const allowExoticByDefault = settings.allowExoticLanguages !== false; // Default true

			// If anyCount > 0, always allow all languages
			// If only anyStandardCount, check setting - if allowExoticByDefault, still allow all
			const allowAllLanguages = anyCount > 0 || allowExoticByDefault;
			const choiceLabel = anyCount > 0 ? "any language" : (allowExoticByDefault ? "any language" : "standard language");
			choiceSection.append(e_({outer: `<p class="mb-1"><strong>Choose ${totalLangChoices} ${choiceLabel}${totalLangChoices > 1 ? "s" : ""}:</strong></p>`}));

			for (let i = 0; i < totalLangChoices; i++) {
				// Get grouped languages including homebrew
				const langOptions = this._page.getLanguageOptionsGrouped?.() || {
					standard: Parser.LANGUAGES_STANDARD,
					exotic: Parser.LANGUAGES_EXOTIC,
					secret: Parser.LANGUAGES_SECRET,
					homebrew: [],
				};

				const selectId = `bg-lang-choice-${i}`;
				const selectEl = e_({outer: `
					<select class="ve-form-control form-control--minimal mb-1" id="${selectId}">
						<option value="">-- Select Language --</option>
					</select>
				`});

				// Build source lookup for display (priority sources preferred)
				const bgPrioritySources = this._state.getPrioritySources() || [];
				const bgSourceLookup = new Map();
				for (const lang of (this._page._languagesData || [])) {
					const existing = bgSourceLookup.get(lang.name);
					if (!existing) {
						bgSourceLookup.set(lang.name, lang.source);
					} else if (bgPrioritySources.includes(lang.source) && !bgPrioritySources.includes(existing)) {
						bgSourceLookup.set(lang.name, lang.source);
					}
				}

				// Add language options grouped by type - homebrew first if available
				// Secret languages are never offered as racial or background choices
				const addLangOptgroup = (label, langs) => {
					const grp = e_({outer: `<optgroup label="${label}"></optgroup>`});
					langs.forEach(lang => {
						const src = bgSourceLookup.get(lang);
						const display = src ? `${lang} (${src})` : lang;
						grp.append(e_({outer: `<option value="${lang}">${display}</option>`}));
					});
					selectEl.append(grp);
				};

				if (langOptions.homebrew.length) {
					addLangOptgroup("──── Homebrew Languages ────", langOptions.homebrew);
				}

				addLangOptgroup("──── Standard Languages ────", langOptions.standard);

				if (allowAllLanguages) {
					addLangOptgroup("──── Exotic/Rare Languages ────", langOptions.exotic);
				}

				const existingChoice = this._selectedLanguages.find(l => l.selectIdx === i);
				if (existingChoice) {
					selectEl.value = existingChoice.language;
				}

				selectEl.addEventListener("change", (e) => {
					this._selectedLanguages = this._selectedLanguages.filter(l => l.selectIdx !== i);
					if (e.target.value) {
						this._selectedLanguages.push({
							selectIdx: i,
							language: e.target.value,
						});
					}
					// Update all dropdowns to disable already-selected languages
					this._updateLanguageDropdownOptions(choiceSection);
				});

				choiceSection.append(selectEl);
			}
			langSection.append(choiceSection);
		}

		if (fixedLangs.length || totalLangChoices > 0) {
			content.append(langSection);
		}

		// Initial update of dropdown options
		if (totalLangChoices > 0) {
			this._updateLanguageDropdownOptions(langSection.querySelector(".charsheet__builder-lang-choice"));
		}
	}

	/**
	 * Update language dropdown options to disable already-selected languages
	 * @param {HTMLElement} container - The container with language select elements
	 */
	_updateLanguageDropdownOptions (container) {
		// Get all currently selected languages (from this background section and elsewhere)
		const selectedBgLangs = this._selectedLanguages.map(l => l.language);
		const selectedClassLangs = this._selectedClassFeatureLanguages || [];
		const existingLangs = this._state?.getLanguages?.() || [];
		
		// Combine all selected/known languages
		const allSelectedLangs = [...selectedBgLangs, ...selectedClassLangs, ...existingLangs]
			.filter(l => l)
			.map(l => l.toLowerCase());

		// Expand with dialect conflicts (e.g. selecting "Ignan" also disables "Primordial")
		const allDisabledLangs = new Set(allSelectedLangs);
		for (const lang of allSelectedLangs) {
			const conflicts = this._page?.getDialectConflicts?.(lang) || [];
			for (const c of conflicts) allDisabledLangs.add(c.toLowerCase());
		}

		// Update each select element
		[...container.querySelectorAll("select")].forEach((selectEl) => {
			const currentVal = selectEl.value;

			[...selectEl.querySelectorAll("option")].forEach((opt) => {
				const val = opt.value;
				if (!val) return; // Skip placeholder option

				// Disable if selected elsewhere (or dialect-conflicting), but not if it's the current selection
				const isSelectedElsewhere = allDisabledLangs.has(val.toLowerCase()) && val !== currentVal;
				opt.disabled = isSelectedElsewhere;
			});
		});
	}

	_renderBackgroundASIChoices (container, abilityChoice) {
		if (!abilityChoice) return;

		if (abilityChoice.choose) {
			const choose = abilityChoice.choose;
			const abilities = ["str", "dex", "con", "int", "wis", "cha"];
			const availableAbilities = choose.from || choose.weighted?.from || abilities;

			// Handle weighted format (+2 to one, +1 to another)
			if (choose.weighted) {
				const weights = choose.weighted.weights || [2, 1];
				this._renderWeightedASIChoices(container, availableAbilities, weights);
			} else if (choose.count) {
				// Multiple choices of same amount (e.g., +1/+1/+1)
				const amount = choose.amount || 1;
				const count = choose.count;
				this._renderCountASIChoices(container, availableAbilities, count, amount);
			}
		} else {
			// Fixed ability bonuses
			const bonuses = Object.entries(abilityChoice)
				.filter(([k, v]) => typeof v === "number")
				.map(([ab, bonus]) => `${Parser.attAbvToFull(ab)} +${bonus}`)
				.join(", ");
			if (bonuses) {
				container.append(e_({outer: `<p class="ve-muted">${bonuses}</p>`}));
				// Store fixed bonuses
				Object.entries(abilityChoice)
					.filter(([k, v]) => typeof v === "number")
					.forEach(([ab, bonus], idx) => {
						this._selectedAbilityBonuses[`bg_${idx}`] = ab;
						this._selectedAbilityBonuses[`bg_${idx}_weight`] = bonus;
					});
			}
		}
	}

	_renderFreeASIChoices (container) {
		// Free choice for 2024 species + 2014 background: +2 to one ability, +1 to another
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];
		const weights = [2, 1];
		this._renderWeightedASIChoices(container, abilities, weights);
	}

	_renderWeightedASIChoices (container, availableAbilities, weights) {
		const weightedChoices = e_({outer: `<div class="charsheet__builder-asi-choices"></div>`});

		weights.forEach((weight, idx) => {
			const row = e_({outer: `<div class="ve-flex-v-center mb-1"></div>`});
			row.append(e_({outer: `<span class="mr-2">+${weight}:</span>`}));

			const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${idx}"></select>`});
			selectEl.append(e_({outer: `<option value="">-- Select --</option>`}));

			availableAbilities.forEach(ab => {
				const abName = Parser.attAbvToFull(ab);
				const selected = this._selectedAbilityBonuses[`bg_${idx}`] === ab ? "selected" : "";
				selectEl.append(e_({outer: `<option value="${ab}" ${selected}>${abName}</option>`}));
			});

			selectEl.addEventListener("change", (e) => {
				const val = e.target.value;
				this._selectedAbilityBonuses[`bg_${idx}`] = val;
				this._selectedAbilityBonuses[`bg_${idx}_weight`] = weight;

				// Update other selects to disable already-selected options
				[...weightedChoices.querySelectorAll("select")].forEach((sel) => {
					const selIdx = parseInt(sel.dataset.asiIdx);
					if (selIdx !== idx) {
						[...sel.querySelectorAll("option")].forEach((opt) => {
							const optVal = opt.value;
							// Check if this option is selected in another dropdown
							const isSelectedElsewhere = Object.entries(this._selectedAbilityBonuses)
								.some(([k, v]) => k.startsWith("bg_") && !k.includes("weight") && k !== `bg_${selIdx}` && v === optVal);
							opt.disabled = optVal && isSelectedElsewhere;
						});
					}
				});
			});

			row.append(selectEl);
			weightedChoices.append(row);
		});

		container.append(weightedChoices);
	}

	_renderCountASIChoices (container, availableAbilities, count, amount) {
		const countChoices = e_({outer: `<div class="charsheet__builder-asi-choices"></div>`});

		for (let i = 0; i < count; i++) {
			const row = e_({outer: `<div class="ve-flex-v-center mb-1"></div>`});
			row.append(e_({outer: `<span class="mr-2">+${amount}:</span>`}));

			const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${i}"></select>`});
			selectEl.append(e_({outer: `<option value="">-- Select --</option>`}));

			availableAbilities.forEach(ab => {
				const abName = Parser.attAbvToFull(ab);
				const selected = this._selectedAbilityBonuses[`bg_${i}`] === ab ? "selected" : "";
				selectEl.append(e_({outer: `<option value="${ab}" ${selected}>${abName}</option>`}));
			});

			selectEl.addEventListener("change", (e) => {
				this._selectedAbilityBonuses[`bg_${i}`] = e.target.value;
				this._selectedAbilityBonuses[`bg_${i}_weight`] = amount;
			});

			row.append(selectEl);
			countChoices.append(row);
		}

		container.append(countChoices);
	}
	// #endregion

	// #region Step 5: Equipment
	_renderEquipmentStep (content) {
		// Initialize equipment choices if not already set
		if (!this._equipmentChoices) {
			this._equipmentChoices = {};
		}

		const container = e_({outer: `
			<div>
				<h4>Starting Equipment</h4>
				<p class="ve-muted">Choose your starting equipment based on your class and background.</p>
				
				<div class="charsheet__section">
					<h5>Class Equipment</h5>
					<div id="builder-class-equipment"></div>
				</div>
				
				<div class="charsheet__section mt-3">
					<h5>Background Equipment</h5>
					<div id="builder-bg-equipment">
						${this._selectedBackground ? this._getBackgroundEquipmentHtml() : "<p class='ve-muted'>Select a background first</p>"}
					</div>
				</div>
				
				<div class="charsheet__section mt-3 ve-muted ve-small">
					<span class="glyphicon glyphicon-info-sign"></span>
					Additional items can be added from the Inventory tab after character creation.
				</div>
			</div>
		`});

		content.append(container);

		// Render class equipment with choices
		this._renderClassEquipmentChoices(document.getElementById("builder-class-equipment"));
	}

	_renderClassEquipmentChoices (container) {
		container.innerHTML = "";

		if (!this._selectedClass) {
			container.append("<p class='ve-muted'>Select a class first</p>");
			return;
		}

		const startingEquip = this._selectedClass.startingEquipment;
		if (!startingEquip) {
			container.append("<p class='ve-muted'>No starting equipment defined</p>");
			return;
		}

		// Check if this is 2024 format (has uppercase keys like A, B, C in defaultData)
		const defaultData = startingEquip.defaultData || [];
		const is2024Format = defaultData.length > 0 && defaultData[0]
			&& Object.keys(defaultData[0]).some(k => /^[A-Z]$/.test(k));

		if (is2024Format) {
			// 2024 XPHB format - package choices (A, B, C)
			this._render2024EquipmentChoices(container, startingEquip);
		} else if (startingEquip.default) {
			// Classic format - per-row choices (a, b)
			this._renderClassicEquipmentChoices(container, startingEquip);
		} else {
			container.append("<p class='ve-muted'>No starting equipment options available</p>");
		}
	}

	_render2024EquipmentChoices (container, startingEquip) {
		// 2024 format has complete equipment packages as options A, B, C, etc.
		const defaultData = startingEquip.defaultData || [];
		if (!defaultData.length) return;

		const choiceData = defaultData[0]; // All choices are in the first defaultData entry
		const choiceKeys = Object.keys(choiceData).filter(k => /^[A-Z]$/.test(k)).sort();

		if (!choiceKeys.length) {
			container.append("<p class='ve-muted'>No equipment options found</p>");
			return;
		}

		// Display human-readable description if available
		if (startingEquip.entries?.length) {
			const desc = e_({outer: `<div class="mb-3 ve-muted">${Renderer.get().render({entries: startingEquip.entries})}</div>`});
			container.append(desc);
		}

		const choiceGroup = e_({outer: `<div class="charsheet__builder-equipment-choice"></div>`});

		// Initialize default choice if not set
		if (!this._equipmentChoices["2024"]) {
			this._equipmentChoices["2024"] = choiceKeys[0];
		}

		choiceKeys.forEach((key) => {
			const items = choiceData[key] || [];
			const isSelected = this._equipmentChoices["2024"] === key;

			// Build label showing what's in this package
			const labelParts = items.map(item => {
				if (item.item) {
					const [name] = item.item.split("|");
					return item.quantity > 1 ? `${item.quantity}× ${name}` : name;
				} else if (item.value) {
					// Gold value in copper pieces
					const gp = Math.floor(item.value / 100);
					return `${gp} GP`;
				} else if (item.special) {
					return item.special;
				}
				return "";
			}).filter(Boolean);

			const optionEl = e_({outer: `
				<label class="charsheet__builder-equipment-option ve-flex-v-center mb-2 p-2" style="border: 1px solid var(--rgb-border-grey); border-radius: 4px; cursor: pointer;">
					<input type="radio" name="equipment-choice-2024" value="${key}" ${isSelected ? "checked" : ""} class="mr-2">
					<div>
						<strong>Option ${key}:</strong>
						<div class="ve-small ve-muted">${labelParts.join(", ")}</div>
					</div>
				</label>
			`});

			optionEl.querySelector("input").addEventListener("change", () => {
				this._equipmentChoices["2024"] = key;
			});

			choiceGroup.append(optionEl);
		});

		container.append(choiceGroup);
	}

	_renderClassicEquipmentChoices (container, startingEquip) {
		const equipmentEntries = startingEquip.default;
		const defaultData = startingEquip.defaultData || [];

		equipmentEntries.forEach((entry, idx) => {
			const row = e_({outer: `<div class="charsheet__builder-equipment-row mb-2"></div>`});

			// Check if this is a choice (contains "or")
			const isChoice = entry.includes(" or ");

			if (isChoice && defaultData[idx]) {
				// Render as radio choices
				const choiceData = defaultData[idx];
				const choiceKeys = Object.keys(choiceData).filter(k => k !== "_");

				if (choiceKeys.length > 1) {
					const choiceGroup = e_({outer: `<div class="charsheet__builder-equipment-choice"></div>`});
					const pickerContainer = e_({outer: `<div class="charsheet__builder-equipment-type-pickers ml-3 mt-1"></div>`});

					const renderPickersForKey = (key) => {
						pickerContainer.innerHTML = "";
						const items = choiceData[key] || [];
						this._renderEquipmentTypePickers(pickerContainer, items, `${idx}_${key}`);
					};

					choiceKeys.forEach((key, choiceIdx) => {
						const choiceLabel = this._getEquipmentChoiceLabel(choiceData[key], key);
						const isSelected = this._equipmentChoices[idx] === key || (!this._equipmentChoices[idx] && choiceIdx === 0);

						if (!this._equipmentChoices[idx]) {
							this._equipmentChoices[idx] = choiceKeys[0]; // Default to first choice
						}

						if (isSelected) {
							renderPickersForKey(key);
						}

						const optionEl = e_({outer: `
							<label class="charsheet__builder-equipment-option ve-flex-v-center mb-1">
								<input type="radio" name="equipment-choice-${idx}" value="${key}" ${isSelected ? "checked" : ""} class="mr-2">
								<span>(${key}) ${Renderer.get().render(choiceLabel)}</span>
							</label>
						`});

						optionEl.querySelector("input").addEventListener("change", () => {
							this._equipmentChoices[idx] = key;
							renderPickersForKey(key);
						});

						choiceGroup.append(optionEl);
					});

					row.append(choiceGroup);
					row.append(pickerContainer);
				} else if (choiceData._) {
					// Fixed equipment (no choice)
					const label = this._getEquipmentChoiceLabel(choiceData._, "_");
					row.append(e_({outer: `<p>${Renderer.get().render(label)}</p>`}));
					// Render equipment type pickers for fixed data items
					const fixedPickers = e_({outer: `<div class="charsheet__builder-equipment-type-pickers ml-3 mt-1"></div>`});
					this._renderEquipmentTypePickers(fixedPickers, choiceData._, `${idx}__`);
					row.append(fixedPickers);
				}
			} else {
				// Not a choice, just display the entry
				row.append(e_({outer: `<p>${Renderer.get().render(entry)}</p>`}));
				// If there's defaultData for this idx, check for equipmentType items
				if (defaultData[idx]?._) {
					const nonChoicePickers = e_({outer: `<div class="charsheet__builder-equipment-type-pickers ml-3 mt-1"></div>`});
					this._renderEquipmentTypePickers(nonChoicePickers, defaultData[idx]._, `${idx}__`);
					row.append(nonChoicePickers);
				}
			}

			container.append(row);
		});

		// Add gold alternative option if available
		if (this._selectedClass.startingEquipment.goldAlternative) {
			const goldOption = e_({outer: `
				<div class="charsheet__builder-equipment-gold mt-3">
					<label class="ve-flex-v-center">
						<input type="checkbox" id="equipment-gold-alt" class="mr-2">
						<span>Take starting gold instead: ${Renderer.get().render(this._selectedClass.startingEquipment.goldAlternative)}</span>
					</label>
				</div>
			`});

			goldOption.querySelector("input").addEventListener("change", (e) => {
				this._useGoldAlternative = e.target.checked;
			});

			container.append(goldOption);
		}
	}

	/**
	 * Render dropdown pickers for items with equipmentType in an equipment item list.
	 * @param {HTMLElement} container - Container to append pickers to
	 * @param {Array} items - Equipment items array (from defaultData)
	 * @param {string} prefix - Unique prefix for picker keys
	 */
	_renderEquipmentTypePickers (container, items, prefix) {
		if (!Array.isArray(items)) return;
		if (!this._equipmentTypeChoices) this._equipmentTypeChoices = {};

		const allItems = this._page.getItems();

		items.forEach((itemEntry, itemIdx) => {
			if (!itemEntry.equipmentType) return;

			const eqType = itemEntry.equipmentType;
			const pickerKey = `${eqType}_${itemIdx}`;
			const label = CharacterSheetBuilder._EQUIPMENT_TYPE_LABELS[eqType] || eqType;
			const matchingItems = this._getItemsForEquipmentType(eqType, allItems);

			if (matchingItems.length === 0) return;

			const quantity = itemEntry.quantity || 1;
			for (let q = 0; q < quantity; q++) {
				const selectKey = quantity > 1 ? `${prefix}${pickerKey}_${q}` : `${prefix}${pickerKey}`;
				const picker = e_({outer: `
					<div class="charsheet__builder-equipment-type-picker mb-1">
						<label class="ve-small ve-muted">Choose ${label}:</label>
						<select class="ve-form-control form-control--minimal" style="max-width: 300px;">
							<option value="">-- Select --</option>
						</select>
					</div>
				`});

				const selectEl = picker.querySelector("select");
				matchingItems.forEach(item => {
					selectEl.append(e_({outer: `<option value="${item.name}">${item.name}</option>`}));
				});

				// Pre-select if already chosen
				if (this._equipmentTypeChoices[selectKey]) {
					selectEl.value = this._equipmentTypeChoices[selectKey];
				}

				selectEl.addEventListener("change", (e) => {
					this._equipmentTypeChoices[selectKey] = e.target.value || null;
				});

				container.append(picker);
			}
		});
	}

	/**
	 * Map equipmentType values to display labels
	 */
	static _EQUIPMENT_TYPE_LABELS = {
		"weaponSimple": "any simple weapon",
		"weaponMartial": "any martial weapon",
		"weaponSimpleMelee": "any simple melee weapon",
		"weaponMartialMelee": "any martial melee weapon",
		"armorLight": "any light armor",
		"armorMedium": "any medium armor",
		"armorHeavy": "any heavy armor",
		"instrumentMusical": "any musical instrument",
		"toolArtisan": "any artisan's tools",
		"focusSpellcastingArcane": "any arcane focus",
		"focusSpellcastingHoly": "any holy symbol",
		"focusSpellcastingDruidic": "any druidic focus",
	};

	/**
	 * Filter items matching an equipmentType value.
	 * @param {string} equipmentType - e.g. "weaponSimple", "focusSpellcastingArcane"
	 * @param {Array} allItems - All items from page data
	 * @returns {Array} Matching items sorted by name
	 */
	_getItemsForEquipmentType (equipmentType, allItems) {
		const matchFns = {
			"weaponSimple": (i) => i.weaponCategory === "simple",
			"weaponMartial": (i) => i.weaponCategory === "martial",
			"weaponSimpleMelee": (i) => i.weaponCategory === "simple" && (i.type === "M" || i.type === "M|XPHB"),
			"weaponMartialMelee": (i) => i.weaponCategory === "martial" && (i.type === "M" || i.type === "M|XPHB"),
			"armorLight": (i) => i.type === "LA" || i.type === "LA|XPHB",
			"armorMedium": (i) => i.type === "MA" || i.type === "MA|XPHB",
			"armorHeavy": (i) => i.type === "HA" || i.type === "HA|XPHB",
			"instrumentMusical": (i) => i.type === "INS" || i.type === "INS|XPHB",
			"toolArtisan": (i) => i.type === "AT" || i.type === "AT|XPHB",
			"focusSpellcastingArcane": (i) => (i.type === "SCF" || i.type === "SCF|XPHB") && i.scfType === "arcane",
			"focusSpellcastingHoly": (i) => (i.type === "SCF" || i.type === "SCF|XPHB") && i.scfType === "holy",
			"focusSpellcastingDruidic": (i) => (i.type === "SCF" || i.type === "SCF|XPHB") && i.scfType === "druid",
		};

		const matchFn = matchFns[equipmentType];
		if (!matchFn) return [];

		// Deduplicate by name (prefer XPHB source over PHB)
		// Only include base items — exclude magical items and variants
		const matched = allItems.filter(i => i._isBaseItem && matchFn(i));
		const byName = new Map();
		for (const item of matched) {
			const existing = byName.get(item.name);
			if (!existing || (item.source === "XPHB" && existing.source !== "XPHB")) {
				byName.set(item.name, item);
			}
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	_getEquipmentChoiceLabel (items, key) {
		if (!Array.isArray(items)) return String(items);

		return items.map(item => {
			if (typeof item === "string") {
				// Item reference like "chain mail|phb"
				const [name] = item.split("|");
				return `{@item ${item}|${name}}`;
			} else if (item.equipmentType) {
				// Generic equipment type
				const label = CharacterSheetBuilder._EQUIPMENT_TYPE_LABELS[item.equipmentType] || item.equipmentType;
				return item.quantity > 1 ? `${item.quantity} ${label}s` : label;
			} else if (item.item) {
				// Item with quantity
				const [name] = item.item.split("|");
				return item.quantity > 1 ? `${item.quantity} {@item ${item.item}|${name}}` : `{@item ${item.item}|${name}}`;
			} else {
				return JSON.stringify(item);
			}
		}).join(", ");
	}

	_getClassEquipmentHtml () {
		// This is now handled by _renderClassEquipmentChoices
		return "";
	}

	_getBackgroundEquipmentHtml () {
		if (!this._selectedBackground?.startingEquipment) {
			return "<p class='ve-muted'>No starting equipment defined</p>";
		}

		return Renderer.get().render({entries: this._selectedBackground.startingEquipment});
	}

	// #endregion

	// #region Step 6: Spells (for known-spell casters)

	/**
	 * Detect if the selected class is a known-spell caster at level 1 and return
	 * the count of spells/cantrips they need plus the max spell level and class info.
	 */
	_getKnownCasterInfoForBuilder () {
		if (!this._selectedClass) return null;
		const cls = this._selectedClass;
		const className = cls.name;

		// Non-caster classes have no cantripProgression, spellsKnownProgression, or preparedSpellsProgression.
		// Return null so step 6 shows the "no spells at level 1" message.
		const cantripAtLevel1 = CharacterSheetClassUtils.getCantripsAtLevel(cls, className, 1);
		const isSpellbookCaster = !!cls.spellsKnownProgressionFixed; // Wizard-family: permanent spellbook
		const isPreparedCaster = !!cls.preparedSpellsProgression && !isSpellbookCaster; // Cleric/Druid/XPHB casters
		const isKnownCaster = !isSpellbookCaster && !isPreparedCaster;

		const knownAtLevel1 = isKnownCaster
			? CharacterSheetClassUtils.getKnownSpellsAtLevel(cls, className, 1)
			: null;

		// 2024-style prepared casters (XPHB / TGTT) have an explicit preparedSpellsProgression
		// giving the exact number of spells prepared at level 1. Let the builder prompt for
		// those initial prepared selections so new characters don't start with an empty list.
		// 2014-style prepared casters (no preparedSpellsProgression — e.g. PHB Cleric/Druid)
		// traditionally re-prepare each long rest, so we do not prompt at builder.
		const preparedAtLevel1 = isPreparedCaster
			? (cls.preparedSpellsProgression?.[0] || 0)
			: 0;

		// Return null only if there is nothing to select at level 1 at all.
		if (!cantripAtLevel1 && !knownAtLevel1 && !preparedAtLevel1 && !isSpellbookCaster) return null;

		const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(
			cls.casterProgression || this._selectedSubclass?.casterProgression, 1,
		);

		const spellbookCount = isSpellbookCaster
			? (cls.spellsKnownProgressionFixed?.[0] ?? 6)
			: 0;

		const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className,
			subclass: this._selectedSubclass,
			subclassChoice: this._divineSoulAffinity,
		});

		return {
			className,
			classSource: cls.source,
			classLevel: 1,
			isSpellbookCaster,
			isPreparedCaster,
			isKnownCaster,
			spellbookCount,
			spellCount: (knownAtLevel1 || 0) + preparedAtLevel1,
			cantripCount: cantripAtLevel1 || 0,
			maxSpellLevel,
			additionalClassNames,
		};
	}

	_renderSpellsStep (content) {
		const knownInfo = this._getKnownCasterInfoForBuilder();

		if (!knownInfo) {
			// Non-caster: no spell selection needed at level 1
			const container = e_({outer: `<div>
				<h4>Spells</h4>
				<p class="ve-muted">Your class does not require spell selection at level 1. You may choose spells later via Level Up.</p>
			</div>`});
			content.append(container);
			return;
		}

		const container = e_({outer: `<div>
			<h4>Starting Spells</h4>
			<p class="ve-muted mb-2">Choose your starting spells as a <b>${knownInfo.className}</b>.</p>
			<div id="builder-spell-picker"></div>
		</div>`});

		content.append(container);

		if (knownInfo.className === "Sorcerer" && CharacterSheetClassUtils.isDivineSoulSubclass(this._selectedSubclass)) {
			const affinityOptions = CharacterSheetClassUtils.getDivineSoulAffinityOptions(this._selectedSubclass);
			const selectedAffinity = CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity);
			const affinitySection = e_({outer: `
				<div class="charsheet__builder-feat-opt-section mb-3" style="padding: 0.75rem; background: var(--cs-bg-secondary, #f8f9fa); border-radius: 4px;">
					<label class="ve-flex-col gap-2 mb-0">
						<span class="ve-bold">Divine Soul Affinity</span>
						<select class="ve-form-control ve-input-sm">
							<option value="">Choose an affinity</option>
							${affinityOptions.map(opt => `<option value="${opt.key}" ${selectedAffinity?.key === opt.key ? "selected" : ""}>${opt.name}</option>`).join("")}
						</select>
						<span class="ve-small ve-muted">This affinity grants your extra Divine Soul spell and unlocks Cleric spells while you pick Sorcerer spells.</span>
					</label>
				</div>
			`});

			const affinitySelect = affinitySection.querySelector("select");
			if (affinitySelect) {
				affinitySelect.addEventListener("change", evt => {
					this._divineSoulAffinity = affinityOptions.find(opt => opt.key === evt.target.value) || null;
					this._state.setSubclassChoice(this._selectedClass?.name, this._divineSoulAffinity);
					this._state.updateLevelChoice?.(1, {
						subclassChoice: CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity),
					});
					this._renderSpellsStep(content.innerHTML = "");
				});
			}

			const pickerEl = container.querySelector("#builder-spell-picker");
			if (pickerEl) pickerEl.before(affinitySection);
		}

		const sourceFiltered = this._page.getFilteredSpellData();

		// Re-get knownInfo to reflect the current affinity selection
		const updatedKnownInfo = this._getKnownCasterInfoForBuilder();
		const pickerEl = container.querySelector("#builder-spell-picker");
		if (!pickerEl) return;

		if (updatedKnownInfo.isSpellbookCaster) {
			// --- Cantrips (Wizard picks cantrips too) ---
			if (updatedKnownInfo.cantripCount > 0) {
				const cantripSection = CharacterSheetSpellPicker.renderKnownSpellPicker({
					className: updatedKnownInfo.className,
					classSource: updatedKnownInfo.classSource,
					spellCount: 0,
					cantripCount: updatedKnownInfo.cantripCount,
					maxSpellLevel: 0,
					allSpells: sourceFiltered,
					knownSpellIds: new Set(),
					additionalClassNames: updatedKnownInfo.additionalClassNames,
					onSelect: (spells, cantrips) => {
						this._selectedKnownCantrips = cantrips;
					},
					getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
					preSelectedSpells: [],
					preSelectedCantrips: this._selectedKnownCantrips,
				});
				pickerEl.append(cantripSection);
			}
			// --- Spellbook ---
			const spellbookSection = CharacterSheetSpellPicker.renderWizardSpellbookPicker({
				className: updatedKnownInfo.className,
				spellCount: updatedKnownInfo.spellbookCount,
				maxSpellLevel: updatedKnownInfo.maxSpellLevel,
				allSpells: sourceFiltered,
				knownSpellIds: new Set(),
				onSelect: (spells) => {
					this._selectedSpellbookSpells = spells;
				},
				getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
				preSelectedSpells: this._selectedSpellbookSpells,
			});
			pickerEl.append(spellbookSection);
		} else {
			// Known-caster (Bard, Sorcerer, Warlock, Ranger) or cantrip-only prepared caster
			// (PHB Cleric/Druid: has cantripProgression but no preparedSpellsProgression field)
			const section = CharacterSheetSpellPicker.renderKnownSpellPicker({
				className: updatedKnownInfo.className,
				classSource: updatedKnownInfo.classSource,
				spellCount: updatedKnownInfo.spellCount,
				cantripCount: updatedKnownInfo.cantripCount,
				maxSpellLevel: updatedKnownInfo.maxSpellLevel,
				allSpells: sourceFiltered,
				knownSpellIds: new Set(),
				additionalClassNames: updatedKnownInfo.additionalClassNames,
				onSelect: (spells, cantrips) => {
					this._selectedKnownSpells = spells;
					this._selectedKnownCantrips = cantrips;
				},
				getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
				preSelectedSpells: this._selectedKnownSpells,
				preSelectedCantrips: this._selectedKnownCantrips,
			});
			pickerEl.append(section);
		}
	}

	_applyBuilderSpellChoices () {
		const knownInfo = this._getKnownCasterInfoForBuilder();
		if (!knownInfo) return;

		this._state.setSubclassChoice(knownInfo.className, this._divineSoulAffinity);

		if (knownInfo.isSpellbookCaster) {
			// Wizard-family: add spellbook spells (inSpellbook: true) + cantrips
			for (const spell of this._selectedSpellbookSpells) {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Wizard Spellbook",
					sourceClass: knownInfo.className,
					prepared: true,
					inSpellbook: true,
				}));
			}
		} else {
			// Known-caster (Bard, Sorcerer, Warlock, 2014 Ranger) OR prepared-caster
			// picking initial prepared spells (2024 XPHB/TGTT Cleric, Druid, Paladin, Ranger).
			// The picker is the same UI in both cases; only the sourceFeature label differs
			// so downstream consumers can distinguish known vs prepared spells if needed.
			const sourceFeature = knownInfo.isPreparedCaster ? "Spells Prepared" : "Spells Known";
			for (const spell of this._selectedKnownSpells) {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature,
					sourceClass: knownInfo.className,
					prepared: true,
				}));
			}
		}

		// Cantrips apply for all caster types
		for (const cantrip of this._selectedKnownCantrips) {
			this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(cantrip, {
				sourceFeature: "Cantrips Known",
				sourceClass: knownInfo.className,
			}));
		}

		if (knownInfo.className === "Sorcerer" && CharacterSheetClassUtils.isDivineSoulSubclass(this._selectedSubclass)) {
			this._state.ensureDivineSoulKnownSpell(knownInfo.className);
			this._state.updateLevelChoice?.(1, {
				subclassChoice: CharacterSheetClassUtils.normalizeDivineSoulAffinity(this._divineSoulAffinity),
			});
		}
	}

	// #endregion

	// #region Step 7: Details
	_renderDetailsStep (content) {
		const container = e_({outer: `
			<div class="ve-flex">
				<div class="ve-flex-col" style="flex: 1; padding-right: 1rem;">
					<div class="charsheet__section">
						<h5>Character Name</h5>
						<input type="text" class="ve-form-control" id="builder-name" placeholder="Enter character name" value="${this._state.getName()}">
					</div>
					
					<div class="charsheet__section mt-3">
						<h5>Personality Traits</h5>
						<textarea class="ve-form-control" id="builder-personality" rows="3" placeholder="Describe your character's personality...">${this._state.getNote("personality")}</textarea>
					</div>
					
					<div class="charsheet__section mt-3">
						<h5>Ideals</h5>
						<textarea class="ve-form-control" id="builder-ideals" rows="2" placeholder="What does your character believe in?">${this._state.getNote("ideals")}</textarea>
					</div>
					
					<div class="charsheet__section mt-3">
						<h5>Bonds</h5>
						<textarea class="ve-form-control" id="builder-bonds" rows="2" placeholder="What connections does your character have?">${this._state.getNote("bonds")}</textarea>
					</div>
					
					<div class="charsheet__section mt-3">
						<h5>Flaws</h5>
						<textarea class="ve-form-control" id="builder-flaws" rows="2" placeholder="What are your character's weaknesses?">${this._state.getNote("flaws")}</textarea>
					</div>
				</div>
				
				<div class="ve-flex-col" style="flex: 1;">
					<div class="charsheet__section">
						<h5>Appearance</h5>
						<div class="ve-flex mb-2">
							<div class="ve-flex-col mr-2" style="flex: 1;">
								<label class="ve-muted ve-small">Age</label>
								<input type="number" min="0" class="ve-form-control form-control--minimal" id="builder-age" value="${this._state.getAppearance("age")}" placeholder="Years">
							</div>
							<div class="ve-flex-col mr-2" style="flex: 1;">
								<label class="ve-muted ve-small">Height (ft)</label>
								<input type="number" min="0" step="0.1" class="ve-form-control form-control--minimal" id="builder-height" value="${this._state.getAppearance("height")}" placeholder="Feet">
							</div>
							<div class="ve-flex-col" style="flex: 1;">
								<label class="ve-muted ve-small">Weight (lbs)</label>
								<input type="number" min="0" class="ve-form-control form-control--minimal" id="builder-weight" value="${this._state.getAppearance("weight")}" placeholder="Pounds">
							</div>
						</div>
						<div class="ve-flex">
							<div class="ve-flex-col mr-2" style="flex: 1;">
								<label class="ve-muted ve-small">Eyes</label>
								<input type="text" class="ve-form-control form-control--minimal" id="builder-eyes" value="${this._state.getAppearance("eyes")}">
							</div>
							<div class="ve-flex-col mr-2" style="flex: 1;">
								<label class="ve-muted ve-small">Skin</label>
								<input type="text" class="ve-form-control form-control--minimal" id="builder-skin" value="${this._state.getAppearance("skin")}">
							</div>
							<div class="ve-flex-col" style="flex: 1;">
								<label class="ve-muted ve-small">Hair</label>
								<input type="text" class="ve-form-control form-control--minimal" id="builder-hair" value="${this._state.getAppearance("hair")}">
							</div>
						</div>
					</div>
					
					<div class="charsheet__section mt-3">
						<h5>Backstory</h5>
						<textarea class="ve-form-control" id="builder-backstory" rows="8" placeholder="Write your character's backstory...">${this._state.getNote("backstory")}</textarea>
					</div>
				</div>
			</div>
		`});

		content.append(container);

		// Save values on change
		document.getElementById("builder-name").addEventListener("change", (e) => this._state.setName(e.target.value));
		document.getElementById("builder-personality").addEventListener("change", (e) => this._state.setNote("personality", e.target.value));
		document.getElementById("builder-ideals").addEventListener("change", (e) => this._state.setNote("ideals", e.target.value));
		document.getElementById("builder-bonds").addEventListener("change", (e) => this._state.setNote("bonds", e.target.value));
		document.getElementById("builder-flaws").addEventListener("change", (e) => this._state.setNote("flaws", e.target.value));
		document.getElementById("builder-backstory").addEventListener("change", (e) => this._state.setNote("backstory", e.target.value));

		["age", "height", "weight", "eyes", "skin", "hair"].forEach(field => {
			document.getElementById(`builder-${field}`).addEventListener("change", (e) => this._state.setAppearance(field, e.target.value));
		});
	}
	// #endregion
}

globalThis.CharacterSheetBuilder = CharacterSheetBuilder;

export {CharacterSheetBuilder};
