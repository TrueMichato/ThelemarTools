/**
 * Character Sheet Class Utilities
 * Shared static helpers used by both LevelUp and QuickBuild modules.
 * Single source of truth for class data parsing, spell metadata, feature analysis,
 * combat traditions, and state mutation helpers.
 */
class CharacterSheetClassUtils {
	// ==========================================
	// Pure Utility Methods
	// ==========================================

	/**
	 * Check if a class level grants an Ability Score Improvement.
	 * @param {Object} classData - The class data object
	 * @param {number} level - The class level
	 * @returns {boolean}
	 */
	static levelGrantsAsi (classData, level) {
		const standardAsiLevels = [4, 8, 12, 16, 19];
		if (classData.name === "Fighter") {
			return [...standardAsiLevels, 6, 14].includes(level);
		}
		if (classData.name === "Rogue") {
			return [...standardAsiLevels, 10].includes(level);
		}
		return standardAsiLevels.includes(level);
	}

	/**
	 * Check if a class level grants a subclass feature (data-driven).
	 * @param {Object} classData - The class data with classFeatures
	 * @param {number} level - The class level
	 * @returns {boolean}
	 */
	static levelGrantsSubclass (classData, level) {
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			const levelFeatures = isArrayOfArrays
				? classData.classFeatures[level - 1] || []
				: classData.classFeatures.filter(f => {
					if (typeof f === "string") {
						const parts = f.split("|");
						return parseInt(parts[3]) === level;
					}
					if (typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parseInt(parts[3]) === level;
					}
					return f.level === level;
				});

			return levelFeatures.some(f =>
				typeof f === "object" && f.gainSubclassFeature,
			);
		}

		// Fallback: default subclass level 3
		return level === 3;
	}

	/**
	 * Get the level at which a class gains its subclass (data-driven).
	 * @param {Object} classData - The class data with classFeatures
	 * @returns {number} The subclass level (default: 3)
	 */
	static getSubclassLevel (classData) {
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			if (isArrayOfArrays) {
				for (let lvl = 1; lvl <= 20; lvl++) {
					const features = classData.classFeatures[lvl - 1] || [];
					if (features.some(f => typeof f === "object" && f.gainSubclassFeature)) return lvl;
				}
			} else {
				for (const f of classData.classFeatures) {
					if (typeof f === "object" && f.gainSubclassFeature) {
						const parts = f.classFeature.split("|");
						const lvl = parseInt(parts[3]);
						if (!isNaN(lvl)) return lvl;
					}
				}
			}
		}
		return 3;
	}

	/**
	 * Filter optional features to only include those matching the class's edition.
	 * @param {Array} optFeatures - All optional features
	 * @param {string} classSource - The class's source book
	 * @returns {Array} Filtered optional features
	 */
	static filterOptFeaturesByEdition (optFeatures, classSource) {
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

	/**
	 * Get the hit die size for a class.
	 * @param {Object} classData - The class data
	 * @returns {number} Hit die size (e.g. 6, 8, 10, 12)
	 */
	static getClassHitDie (classData) {
		const hitDieMap = {
			"Barbarian": 12,
			"Fighter": 10,
			"Paladin": 10,
			"Ranger": 10,
			"Bard": 8,
			"Cleric": 8,
			"Druid": 8,
			"Monk": 8,
			"Rogue": 8,
			"Warlock": 8,
			"Sorcerer": 6,
			"Wizard": 6,
		};
		return classData.hd?.faces || hitDieMap[classData.name] || 8;
	}

	/**
	 * Get the spellcasting ability for a class.
	 * @param {Object} classData - The class data
	 * @returns {string|null} Ability abbreviation or null
	 */
	static getSpellcastingAbility (classData) {
		const abilityMap = {
			"Wizard": "int",
			"Artificer": "int",
			"Bard": "cha",
			"Paladin": "cha",
			"Sorcerer": "cha",
			"Warlock": "cha",
			"Cleric": "wis",
			"Druid": "wis",
			"Ranger": "wis",
			"Monk": "wis",
		};
		return classData.spellcastingAbility || abilityMap[classData.name] || null;
	}

	/**
	 * Extract the degree number from a combat method's feature type.
	 * @param {Object} opt - Optional feature with featureType array
	 * @returns {number} The degree (0 if not found)
	 */
	static getMethodDegree (opt) {
		if (!opt.featureType) return 0;
		for (const ft of opt.featureType) {
			const match = ft.match(/^CTM:(\d)[A-Z]{2}$/);
			if (match) return parseInt(match[1]);
		}
		return 0;
	}

	/**
	 * Extract the tradition code from a combat method's feature type.
	 * @param {Object} opt - Optional feature with featureType array
	 * @returns {string|null} Two-letter tradition code or null
	 */
	static getMethodTradition (opt) {
		if (!opt.featureType) return null;
		for (const ft of opt.featureType) {
			const match = ft.match(/^CTM:\d([A-Z]{2})$/);
			if (match) return match[1];
		}
		return null;
	}

	/**
	 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th...).
	 * @param {number} n
	 * @returns {string} The suffix
	 */
	static getOrdinalSuffix (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return s[(v - 20) % 10] || s[v] || s[0];
	}

	/**
	 * Get emoji for a spell school abbreviation.
	 * @param {string} school - Single-letter school abbreviation
	 * @returns {string} Emoji
	 */
	static getSchoolEmoji (school) {
		const schoolEmojis = {
			"A": "✨", // Abjuration
			"C": "🌀", // Conjuration
			"D": "👁️", // Divination
			"E": "💫", // Enchantment
			"V": "🔥", // Evocation
			"I": "🎭", // Illusion
			"N": "💀", // Necromancy
			"T": "🔄", // Transmutation
		};
		return schoolEmojis[school] || "📜";
	}

	/**
	 * Check if a spell belongs to a class's spell list (using Renderer API with fallback).
	 * @param {Object} spell - Spell data object
	 * @param {string} className - Class name to check
	 * @returns {boolean}
	 */
	static spellIsForClass (spell, className) {
		try {
			const classList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
			if (classList?.some(c => c.name === className)) return true;
		} catch (e) { /* fall through */ }
		return spell.classes?.fromClassList?.some(c => c.name === className) || false;
	}

	static isDivineSoulSubclass (subclass) {
		if (!subclass?.name && !subclass?.shortName) return false;
		return [subclass.name, subclass.shortName]
			.filter(Boolean)
			.some(name => String(name).toLowerCase() === "divine soul");
	}

	static normalizeDivineSoulAffinity (choice) {
		if (!choice) return null;

		const rawName = typeof choice === "string"
			? choice
			: choice.name || choice.key;
		if (!rawName) return null;

		const name = String(rawName).trim();
		if (!name) return null;

		return {
			key: name.toLowerCase(),
			name,
		};
	}

	static getDivineSoulAffinityOptions (subclass) {
		if (!this.isDivineSoulSubclass(subclass)) return [];
		return (subclass.additionalSpells || [])
			.filter(block => block?.name)
			.map(block => this.normalizeDivineSoulAffinity(block.name))
			.filter(Boolean);
	}

	static getDivineSoulAffinityBlock (subclass, subclassChoice) {
		if (!this.isDivineSoulSubclass(subclass)) return null;
		const normalized = this.normalizeDivineSoulAffinity(subclassChoice);
		if (!normalized) return null;

		return (subclass.additionalSpells || []).find(block => {
			const blockChoice = this.normalizeDivineSoulAffinity(block?.name);
			return blockChoice?.key === normalized.key;
		}) || null;
	}

	static getDivineSoulKnownSpell (subclass, subclassChoice) {
		const block = this.getDivineSoulAffinityBlock(subclass, subclassChoice);
		const spellRef = block?.known?.["1"]?.[0];
		if (!spellRef) return null;

		if (typeof spellRef === "string") {
			const [name, source] = spellRef.split("|");
			return {
				name: name.trim(),
				source: source || Parser.SRC_PHB,
				level: 1,
			};
		}

		if (spellRef?.name) {
			return {
				name: spellRef.name,
				source: spellRef.source || Parser.SRC_PHB,
				level: spellRef.level ?? 1,
			};
		}

		return null;
	}

	static getAdditionalSpellListClasses ({className, subclass, subclassChoice} = {}) {
		if (className === "Sorcerer" && this.isDivineSoulSubclass(subclass) && this.normalizeDivineSoulAffinity(subclassChoice)) {
			return ["Cleric"];
		}
		return [];
	}

	/**
	 * Get the maximum spell level a class can cast at a given level.
	 * @param {string} className - Class name
	 * @param {number} classLevel - Current class level
	 * @returns {number} Max spell level (0 if non-caster)
	 */
	static getMaxSpellLevelForClass (className, classLevel) {
		const fullCasters = ["Wizard", "Cleric", "Druid", "Bard", "Sorcerer", "Warlock"];
		const halfCasters = ["Paladin", "Ranger", "Artificer"];

		if (fullCasters.includes(className)) {
			return Math.min(9, Math.ceil(classLevel / 2));
		}
		if (halfCasters.includes(className)) {
			return Math.min(5, Math.ceil((classLevel + 1) / 4));
		}
		return 0;
	}

	// ==========================================
	// Spell Metadata Helpers
	// ==========================================

	/**
	 * Get casting time string from spell data.
	 * @param {Object} spell
	 * @returns {string}
	 */
	static getSpellCastingTime (spell) {
		if (!spell.time?.length) return "";
		const time = spell.time[0];
		return `${time.number} ${time.unit}`;
	}

	/**
	 * Get range string from spell data.
	 * @param {Object} spell
	 * @returns {string}
	 */
	static getSpellRange (spell) {
		if (!spell.range) return "";
		const range = spell.range;
		if (range.type === "point") {
			if (range.distance?.type === "self") return "Self";
			if (range.distance?.type === "touch") return "Touch";
			return `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
		}
		return `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
	}

	/**
	 * Get components string from spell data.
	 * @param {Object} spell
	 * @returns {string}
	 */
	static getSpellComponents (spell) {
		if (!spell.components) return "";
		const parts = [];
		if (spell.components.v) parts.push("V");
		if (spell.components.s) parts.push("S");
		if (spell.components.m) {
			const mText = typeof spell.components.m === "string" ? spell.components.m : spell.components.m?.text || "";
			parts.push(mText ? `M (${mText})` : "M");
		}
		return parts.join(", ");
	}

	/**
	 * Get duration string from spell data.
	 * @param {Object} spell
	 * @returns {string}
	 */
	static getSpellDuration (spell) {
		if (!spell.duration?.length) return "";
		const dur = spell.duration[0];
		if (dur.type === "instant") return "Instantaneous";
		if (dur.type === "permanent") return "Until dispelled";
		if (dur.concentration) {
			return `Concentration, up to ${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
		}
		return `${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
	}

	/**
	 * Check if a spell requires concentration.
	 * @param {Object} spell
	 * @returns {boolean}
	 */
	static spellIsConcentration (spell) {
		return spell.concentration || spell.duration?.some?.(d => d.concentration) || false;
	}

	/**
	 * Check if a spell is a ritual.
	 * @param {Object} spell
	 * @returns {boolean}
	 */
	static spellIsRitual (spell) {
		return spell.ritual || spell.meta?.ritual || false;
	}

	// ==========================================
	// Known-Caster Progression Tables
	// ==========================================

	/** @private */
	static _SPELLS_KNOWN_TABLES = {
		"Bard": [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
		"Sorcerer": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
		"Warlock": [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
		"Ranger": [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
	};

	/** @private */
	static _CANTRIP_TABLES = {
		"Bard": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
		"Sorcerer": [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
		"Warlock": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
	};

	/**
	 * Get known-spell count at a class level (for known-caster classes).
	 * @param {Object} classData - The class data
	 * @param {string} className - The class name
	 * @param {number} classLevel - The class level
	 * @returns {number|null} Known spell count, or null if not a known caster
	 */
	static getKnownSpellsAtLevel (classData, className, classLevel) {
		const prog = classData.spellsKnownProgression || CharacterSheetClassUtils._SPELLS_KNOWN_TABLES[className];
		if (!prog) return null;
		return prog[classLevel - 1] || 0;
	}

	/**
	 * Get cantrip count at a class level.
	 * @param {Object} classData - The class data
	 * @param {string} className - The class name
	 * @param {number} classLevel - The class level
	 * @returns {number|null} Cantrip count, or null if no cantrip progression
	 */
	static getCantripsAtLevel (classData, className, classLevel) {
		const prog = classData.cantripProgression || CharacterSheetClassUtils._CANTRIP_TABLES[className];
		if (!prog) return null;
		return prog[classLevel - 1] || 0;
	}

	/**
	 * Parse the maximum castable spell level from a caster progression string.
	 * @param {string} casterProgression - "full", "1/2", "1/3", "pact"
	 * @param {number} classLevel - Current class level
	 * @returns {number} Max spell level
	 */
	static getMaxSpellLevelFromProgression (casterProgression, classLevel) {
		if (casterProgression === "full" || !casterProgression) {
			return Math.min(9, Math.ceil(classLevel / 2));
		} else if (casterProgression === "1/2") {
			return Math.min(5, Math.ceil(classLevel / 4));
		} else if (casterProgression === "1/3") {
			return Math.min(4, Math.ceil(classLevel / 7));
		} else if (casterProgression === "pact") {
			return Math.min(5, Math.ceil(classLevel / 2));
		}
		return Math.min(9, Math.ceil(classLevel / 2));
	}

	// ==========================================
	// Feature Data Extraction
	// ==========================================

	/**
	 * Find entries of type "options" in a feature's entries array.
	 * These represent choices the player must make (like Specialties).
	 * @param {Object} feature - The feature object with entries
	 * @param {number} characterLevel - Current character level for filtering
	 * @param {Array} [classFeatures] - All class features (for ref lookup)
	 * @returns {Array} Array of {count, options} objects
	 */
	static findFeatureOptions (feature, characterLevel = 1, classFeatures = []) {
		if (!feature?.entries) return [];

		const results = [];

		const searchEntries = (entries) => {
			if (!Array.isArray(entries)) return;

			for (const entry of entries) {
				if (typeof entry === "object" && entry.type === "options") {
					const count = entry.count || 1;
					const options = [];

					if (entry.entries) {
						for (const opt of entry.entries) {
							if (opt.type === "refClassFeature" && opt.classFeature) {
								const parts = opt.classFeature.split("|");
								const optLevel = parseInt(parts[3]) || 1;

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
								options.push({
									name: parts[0],
									className: parts[1],
									source: parts[2],
									subclassShortName: parts[3],
									subclassSource: parts[4],
									level: parseInt(parts[5]) || 1,
									type: "subclassFeature",
									ref: opt.subclassFeature,
								});
							} else if (opt.type === "refOptionalfeature" && opt.optionalfeature) {
								const parts = opt.optionalfeature.split("|");
								options.push({
									name: parts[0],
									source: parts[1] || "PHB",
									type: "optionalfeature",
									ref: opt.optionalfeature,
								});
							} else if (typeof opt === "object" && opt.type === "entries") {
								options.push({
									name: opt.name || "Option",
									type: "inline",
									entries: opt.entries,
									source: opt.source,
								});
							}
						}
					}

					if (options.length > 0) {
						results.push({count, options});
					}
				}

				// Recurse into nested entries
				if (typeof entry === "object") {
					if (entry.entries) searchEntries(entry.entries);
					if (entry.items) searchEntries(entry.items);
				}

				// Check for features that reference another feature's options via {@classFeature ...}
				// This handles higher-level Specialty features that reference the level 1 feature
				if (typeof entry === "string") {
					const refMatch = entry.match(/\{@classFeature\s+([^}]+)\}/);
					if (refMatch && /another|additional|gain/i.test(entry)) {
						const refParts = refMatch[1].split("|");
						const refFeatureName = refParts[0];
						const refClassName = refParts[1];
						const refSource = refParts[2];
						const refLevel = parseInt(refParts[3]) || 1;

						const referencedFeature = CharacterSheetClassUtils.getClassFeatureData(
							classFeatures, refFeatureName, refClassName, refSource, refLevel,
						);
						if (referencedFeature) {
							const refResults = CharacterSheetClassUtils.findFeatureOptions(
								referencedFeature, characterLevel, classFeatures,
							);
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
	 * Get feature options from features gained at a specific level.
	 * @param {Array} features - Array of features gained at this level
	 * @param {number} level - The level being gained
	 * @param {Array} [classFeatures] - All class features (for ref lookup)
	 * @returns {Array} Array of {featureName, featureSource, count, options, isSubclassFeature} objects
	 */
	static getFeatureOptionsForLevel (features, level, classFeatures = []) {
		const allOptions = [];

		for (const feature of features) {
			const featureOptions = CharacterSheetClassUtils.findFeatureOptions(feature, level, classFeatures);
			for (const optionGroup of featureOptions) {
				allOptions.push({
					featureName: feature.name,
					featureSource: feature.source,
					isSubclassFeature: feature.isSubclassFeature,
					...optionGroup,
				});
			}
		}

		return allOptions;
	}

	/**
	 * Look up a class feature by reference parts.
	 * @param {Array} classFeatures - All class features
	 * @param {string} featureName
	 * @param {string} className
	 * @param {string} source
	 * @param {number} level
	 * @returns {Object|null}
	 */
	static getClassFeatureByRef (classFeatures, featureName, className, source, level) {
		if (!classFeatures?.length) return null;

		return classFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (source && f.source && f.source !== source) {
				return false;
			}
			return true;
		});
	}

	/**
	 * Look up full class feature data with flexible source matching.
	 * @param {Array} classFeatures - All class features
	 * @param {string} featureName
	 * @param {string} className
	 * @param {string} source
	 * @param {number} level
	 * @returns {Object|null}
	 */
	static getClassFeatureData (classFeatures, featureName, className, source, level) {
		if (!classFeatures?.length) return null;

		// First try exact source match
		const exactMatch = classFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (source && f.source !== source) return false;
			return true;
		});
		if (exactMatch) return exactMatch;

		// Fall back to flexible PHB/XPHB/SRD matching
		return classFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (source && f.source && f.source !== source) {
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		}) || null;
	}

	/**
	 * Look up full class feature data from a reference string.
	 * @param {Array} classFeatures - All class features
	 * @param {string} featureRef - "FeatureName|ClassName|Source|Level" format
	 * @returns {Object|null}
	 */
	static getClassFeatureDataFromRef (classFeatures, featureRef) {
		const parts = featureRef.split("|");
		const [name, className, source, level] = parts;
		return CharacterSheetClassUtils.getClassFeatureData(classFeatures, name, className, source, parseInt(level) || 1);
	}

	/**
	 * Look up full subclass feature data to get description/entries.
	 * @param {Array} subclassFeatures - All loaded subclass features
	 * @param {string} featureName - Name of the feature
	 * @param {string} className - Parent class name
	 * @param {string} subclassShortName - Subclass short name
	 * @param {string} source - Feature source
	 * @param {number} level - Feature level
	 * @returns {Object|null}
	 */
	static getSubclassFeatureData (subclassFeatures, featureName, className, subclassShortName, source, level) {
		if (!subclassFeatures?.length) return null;

		// First try exact source match
		const exactMatch = subclassFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.subclassShortName !== subclassShortName) return false;
			if (f.level !== level) return false;
			if (source && f.source !== source) return false;
			return true;
		});
		if (exactMatch) return exactMatch;

		// Fall back to flexible PHB/XPHB/SRD matching
		return subclassFeatures.find(f => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.subclassShortName !== subclassShortName) return false;
			if (f.level !== level) return false;
			if (source && f.source && f.source !== source) {
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		}) || null;
	}

	/**
	 * Analyze feature text to detect required skill/expertise/bonus choices.
	 * @param {Object} opt - Feature option object
	 * @param {Array} classFeatures - All loaded class features
	 * @returns {{type: string, count: number, from: (string|string[])}|null}
	 */
	static parseFeatureSkillChoice (opt, classFeatures = [], {optionalFeatures = [], resolvedData = null} = {}) {
		if (!opt?.ref || (opt?.type !== "classFeature" && opt?.type !== "optionalfeature")) return null;

		const fullOpt = resolvedData
			|| (opt.type === "optionalfeature"
				? optionalFeatures.find(f => f.name === opt.name && f.source === opt.source) || optionalFeatures.find(f => f.name === opt.name)
				: CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, opt.ref));
		if (!fullOpt?.entries) return null;

		const text = JSON.stringify(fullOpt.entries);

		if (text.includes("You gain proficiency in one of the following")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "proficiency", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("bonus equal to your proficiency bonus on checks made with one of")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "bonus", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("Choose one skill you are proficient in")) {
			return {type: "bonus", count: 1, from: "any_proficient"};
		}

		if (/Choose two (more )?of your skill proficiencies/.test(text)) {
			return {type: "expertise", count: 2, from: "any_proficient"};
		}

		if (text.includes("Choose one of the following skills in which you have proficiency")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "expertise", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("Choose one skill proficiency") && text.includes("Expertise")) {
			return {type: "expertise", count: 1, from: "any_proficient"};
		}

		if (text.includes("Choose two skill proficiencies") && text.includes("Expertise")) {
			return {type: "expertise", count: 2, from: "any_proficient"};
		}

		return null;
	}

	/**
	 * Parse automatic modifiers from feature text that do not require user choices.
	 * @param {Object} opt - Feature option object
	 * @param {Array} classFeatures - All loaded class features
	 * @returns {Array<{type: string, value: number|string, note: string}>}
	 */
	static parseFeatureAutoEffects (opt, classFeatures = [], {optionalFeatures = [], resolvedData = null} = {}) {
		if (!opt?.ref || (opt?.type !== "classFeature" && opt?.type !== "optionalfeature")) return [];

		const fullOpt = resolvedData
			|| (opt.type === "optionalfeature"
				? optionalFeatures.find(f => f.name === opt.name && f.source === opt.source) || optionalFeatures.find(f => f.name === opt.name)
				: CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, opt.ref));
		if (!fullOpt?.entries) return [];

		const text = JSON.stringify(fullOpt.entries);
		const effects = [];

		const passiveIncreaseMatch = text.match(/passive\s+\w+\s*\(\{@skill\s+([^}]+)\}\)\s*(?:score\s+)?increases?\s+by\s+(\d+)/i);
		if (passiveIncreaseMatch) {
			const skill = passiveIncreaseMatch[1].toLowerCase().replace(/\s+/g, "");
			const value = parseInt(passiveIncreaseMatch[2]);
			effects.push({type: `passive:${skill}`, value, note: `+${value} passive ${passiveIncreaseMatch[1]}`});
		}

		const skillBonusProfMatch = text.match(/bonus\s+to\s+\w+\s*\(\{@skill\s+([^}]+)\}\)\s*checks?\s+equal\s+to\s+(?:your\s+)?proficiency\s+bonus/i);
		if (skillBonusProfMatch) {
			const skill = skillBonusProfMatch[1].toLowerCase().replace(/\s+/g, "");
			effects.push({type: `skill:${skill}`, value: "proficiency", note: `+PB to ${skillBonusProfMatch[1]} checks`});
		}

		const skillBonusFixedMatch = text.match(/gain\s+a?\s*\+?(\d+)\s*bonus\s+to\s+\w+\s*\(\{@skill\s+([^}]+)\}\)\s*checks?/i);
		if (skillBonusFixedMatch) {
			const value = parseInt(skillBonusFixedMatch[1]);
			const skill = skillBonusFixedMatch[2].toLowerCase().replace(/\s+/g, "");
			effects.push({type: `skill:${skill}`, value, note: `+${value} to ${skillBonusFixedMatch[2]} checks`});
		}

		const speedIncreaseMatch = text.match(/(?:your\s+)?speed\s+increases?\s+by\s+(\d+)\s*(?:feet|ft)?/i);
		if (speedIncreaseMatch) {
			const value = parseInt(speedIncreaseMatch[1]);
			effects.push({type: "speed", value, note: `+${value} ft. speed`});
		}

		const passiveSimpleMatch = text.match(/\+(\d+)\s*(?:bonus\s+)?(?:to\s+)?(?:your\s+)?passive\s+\{@skill\s+([^}]+)\}/i);
		if (passiveSimpleMatch) {
			const value = parseInt(passiveSimpleMatch[1]);
			const skill = passiveSimpleMatch[2].toLowerCase().replace(/\s+/g, "");
			effects.push({type: `passive:${skill}`, value, note: `+${value} passive ${passiveSimpleMatch[2]}`});
		}

		const darkvisionIncreaseMatch = text.match(/darkvision\s+(?:increases?\s+by|out\s+to)\s+(\d+)\s*(?:feet|ft)?/i);
		if (darkvisionIncreaseMatch) {
			const value = parseInt(darkvisionIncreaseMatch[1]);
			effects.push({type: "sense:darkvision", value, note: `Darkvision ${value} ft.`});
		}

		const acMatch = text.match(/(?:AC|armor\s+class)\s+increases?\s+by\s+(\d+)|\+(\d+)\s+(?:to\s+)?(?:AC|armor\s+class)/i);
		if (acMatch) {
			const value = parseInt(acMatch[1] || acMatch[2]);
			effects.push({type: "ac", value, note: `+${value} AC`});
		}

		const initMatch = text.match(/\+(\d+)\s+(?:to\s+)?initiative|initiative\s+(?:bonus\s+(?:of\s+)?|increases?\s+by\s+)\+?(\d+)/i);
		if (initMatch) {
			const value = parseInt(initMatch[1] || initMatch[2]);
			effects.push({type: "initiative", value, note: `+${value} initiative`});
		}

		return effects;
	}

	/**
	 * Extract skill names from feature text.
	 * @param {string} text
	 * @returns {string[]}
	 */
	static extractSkillListFromText (text) {
		const allSkills = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
			"History", "Insight", "Intimidation", "Investigation", "Medicine",
			"Nature", "Perception", "Performance", "Persuasion", "Religion",
			"Sleight of Hand", "Stealth", "Survival",
		];

		const found = [];

		const tagMatches = text.matchAll(/\{@skill\s+([^}]+)\}/gi);
		for (const m of tagMatches) {
			const skillName = m[1].trim();
			if (allSkills.some(s => s.toLowerCase() === skillName.toLowerCase())) {
				found.push(skillName.toTitleCase());
			}
		}

		if (found.length) return [...new Set(found)];

		for (const skill of allSkills) {
			if (text.includes(skill)) found.push(skill);
		}

		return [...new Set(found)];
	}

	/**
	 * Get all features gained at a specific class level (including subclass features).
	 * @param {Object} classData - The class data
	 * @param {number} level - The class level
	 * @param {Object|null} subclass - The subclass object (optional)
	 * @param {Array} classFeatures - All loaded class features (for description lookup)
	 * @param {Array} subclassFeatures - All loaded subclass features (for homebrew fallback lookup)
	 * @returns {Array} Array of feature objects
	 */
	static getLevelFeatures (classData, level, subclass, classFeatures = [], subclassFeatures = []) {
		const features = [];

		// Get base class features for this level
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			const levelFeatures = isArrayOfArrays
				? classData.classFeatures[level - 1] || []
				: classData.classFeatures;

			const featureRefs = isArrayOfArrays
				? levelFeatures
				: levelFeatures.filter(f => {
					if (typeof f === "string") {
						const parts = f.split("|");
						return parseInt(parts[3]) === level;
					}
					if (typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parseInt(parts[3]) === level;
					}
					return f.level === level;
				});

			featureRefs.forEach(featureRef => {
				if (typeof featureRef === "string") {
					const parts = featureRef.split("|");
					const featureName = parts[0];
					const className = parts[1] || classData.name;
					const classSource = parts[2] || classData.source;
					const featureSource = parts[4] || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureName, className, classSource, level);

					features.push({
						name: featureName,
						className,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: false,
						entries: fullFeature?.entries,
					});
				} else if (typeof featureRef === "object" && featureRef.classFeature) {
					const parts = featureRef.classFeature.split("|");
					const featureName = parts[0];
					const className = parts[1] || classData.name;
					const classSource = parts[2] || classData.source;
					const featureSource = parts[4] || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureName, className, classSource, level);

					features.push({
						name: featureName,
						className,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: !!featureRef.gainSubclassFeature,
						entries: fullFeature?.entries,
					});
				} else if (typeof featureRef === "object" && featureRef.name) {
					const classSource = featureRef.classSource || classData.source;
					const featureSource = featureRef.source || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureRef.name, classData.name, classSource, level);

					features.push({
						name: featureRef.name,
						className: classData.name,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: !!featureRef.gainSubclassFeature,
						entries: fullFeature?.entries,
					});
				}
			});

			// Extract refClassFeature sub-entries from parent features.
			// Some features (e.g. "Ki", "Monk's Focus") contain refClassFeature entries
			// pointing to standalone sub-features (e.g. "Flurry of Blows") that exist as
			// full classFeature objects but aren't listed in the top-level classFeatures array.
			// IMPORTANT: Skip "options" type entries — those are player choices (Specialties, etc.)
			// handled by findFeatureOptions/getFeatureOptionsForLevel, not automatic grants.
			const featureNames = new Set(features.map(f => f.name));
			const extracted = [];
			for (const feature of features) {
				if (!feature.entries) continue;
				for (const entry of feature.entries) {
					if (typeof entry !== "object" || !Array.isArray(entry.entries)) continue;
					if (entry.type === "options") continue;
					for (const sub of entry.entries) {
						if (sub?.type !== "refClassFeature" || !sub.classFeature) continue;
						const refParts = sub.classFeature.split("|");
						const refName = refParts[0];
						if (featureNames.has(refName)) continue;
						const refData = CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, sub.classFeature);
						if (!refData) continue;
						featureNames.add(refName);
						extracted.push({
							name: refName,
							className: refParts[1] || classData.name,
							classSource: refParts[2] || classData.source,
							source: refData.source || refParts[2] || classData.source,
							level: parseInt(refParts[3]) || level,
							gainSubclassFeature: false,
							entries: refData.entries,
							parentFeature: feature.name,
						});
					}
				}
			}
			if (extracted.length) features.push(...extracted);
		}

		// Subclass features
		if (subclass && subclass.subclassFeatures) {
			subclass.subclassFeatures.forEach((levelFeatures, idx) => {
				if (Array.isArray(levelFeatures)) {
					levelFeatures.forEach(feature => {
						if (typeof feature === "object" && feature.level === level) {
							const featureName = feature.name || Renderer.findName(feature);
							if (featureName) {
								features.push({
									name: featureName,
									className: feature.className || subclass.className || classData.name,
									classSource: feature.classSource || subclass.classSource || classData.source,
									subclassName: subclass.name,
									subclassShortName: feature.subclassShortName || subclass.shortName,
									subclassSource: feature.subclassSource || subclass.source || classData.source,
									source: feature.source || subclass.source || classData.source,
									level: feature.level,
									entries: feature.entries,
									isSubclassFeature: true,
								});
							}
						} else if (typeof feature === "string") {
							const parts = feature.split("|");
							const featureLevel = parseInt(parts[parts.length - 1]);
							if (featureLevel === level) {
								const featureName = parts[0];
								const featureClassName = parts[1] || classData.name;
								const featureClassSource = parts[2] || classData.source;
								const featureSubclassShortName = parts[3] || subclass.shortName;
								const featureSource = parts[4] || subclass.source || classData.source;

								// Look up full feature data to get entries/description
								const fullFeature = CharacterSheetClassUtils.getSubclassFeatureData(
									subclassFeatures,
									featureName,
									featureClassName,
									featureSubclassShortName,
									featureSource,
									featureLevel,
								);

								features.push({
									name: featureName,
									className: featureClassName,
									classSource: featureClassSource,
									subclassName: subclass.name,
									subclassShortName: featureSubclassShortName,
									subclassSource: featureSource,
									source: featureSource,
									level: featureLevel,
									entries: fullFeature?.entries,
									isSubclassFeature: true,
								});
							}
						}
					});
				} else if (typeof levelFeatures === "string") {
					const parts = levelFeatures.split("|");
					const featureLevel = parseInt(parts[parts.length - 1]);
					if (featureLevel === level) {
						const featureName = parts[0];
						const featureClassName = parts[1] || classData.name;
						const featureClassSource = parts[2] || classData.source;
						const featureSubclassShortName = parts[3] || subclass.shortName;
						const featureSource = parts[4] || subclass.source || classData.source;

						// Look up full feature data to get entries/description
						const fullFeature = CharacterSheetClassUtils.getSubclassFeatureData(
							subclassFeatures,
							featureName,
							featureClassName,
							featureSubclassShortName,
							featureSource,
							featureLevel,
						);

						features.push({
							name: featureName,
							className: featureClassName,
							classSource: featureClassSource,
							subclassName: subclass.name,
							subclassShortName: featureSubclassShortName,
							subclassSource: featureSource,
							source: featureSource,
							level: featureLevel,
							entries: fullFeature?.entries,
							isSubclassFeature: true,
						});
					}
				}
			});
		}

		// Fallback: If subclass exists but has no subclassFeatures inline (common with homebrew),
		// look up features from the separate subclassFeatures array by subclass name/source
		if (subclass && (!subclass.subclassFeatures || subclass.subclassFeatures.length === 0) && subclassFeatures?.length > 0) {
			const matchingFeatures = subclassFeatures.filter(f => {
				// Match by subclass name and class name
				if (f.subclassShortName !== subclass.shortName && f.subclassShortName !== subclass.name) return false;
				if (f.className !== (subclass.className || classData.name)) return false;
				if (f.level !== level) return false;
				return true;
			});

			matchingFeatures.forEach(feature => {
				features.push({
					name: feature.name,
					className: feature.className || subclass.className || classData.name,
					classSource: feature.classSource || subclass.classSource || classData.source,
					subclassName: subclass.name,
					subclassShortName: feature.subclassShortName || subclass.shortName,
					subclassSource: feature.subclassSource || subclass.source || classData.source,
					source: feature.source || subclass.source || classData.source,
					level: feature.level,
					entries: feature.entries,
					isSubclassFeature: true,
				});
			});
		}

		// Expand refSubclassFeature entries from wrapper features (e.g., "Thief" feature that references "Fast Hands")
		// Many subclasses have a wrapper feature at the subclass level that contains references to actual sub-features
		const expandedFeatures = [];
		for (const feature of features) {
			if (!feature.isSubclassFeature || !feature.entries) continue;

			// Look for refSubclassFeature entries in the feature's entries
			const searchEntries = (entries) => {
				if (!Array.isArray(entries)) return;
				for (const entry of entries) {
					if (entry?.type === "refSubclassFeature" && entry.subclassFeature) {
						// Parse "FeatureName|ClassName|ClassSource|SubclassShortName|SubclassSource|Level"
						const parts = entry.subclassFeature.split("|");
						const refFeatureName = parts[0];
						const refClassName = parts[1] || classData.name;
						const refClassSource = parts[2] || classData.source;
						const refSubclassShortName = parts[3] || subclass?.shortName;
						const refSubclassSource = parts[4] || subclass?.source || classData.source;
						const refLevel = parseInt(parts[5]) || level;

						// Only expand features at current level
						if (refLevel !== level) continue;

						// Look up the referenced subclass feature
						const refFeature = CharacterSheetClassUtils.getSubclassFeatureData(
							subclassFeatures,
							refFeatureName,
							refClassName,
							refSubclassShortName,
							refSubclassSource,
							refLevel,
						);

						if (refFeature && !features.some(f => f.name === refFeatureName && f.level === refLevel)) {
							expandedFeatures.push({
								name: refFeatureName,
								className: refClassName,
								classSource: refClassSource,
								subclassName: subclass?.name,
								subclassShortName: refSubclassShortName,
								subclassSource: refSubclassSource,
								source: refFeature.source || refSubclassSource,
								level: refLevel,
								entries: refFeature.entries,
								isSubclassFeature: true,
							});
						}
					}
					// Recurse into nested entries
					if (entry?.entries) searchEntries(entry.entries);
				}
			};

			searchEntries(feature.entries);
		}

		// Add expanded features
		features.push(...expandedFeatures);

		// Filter out placeholder "gain subclass feature" entries when actual subclass features exist
		const actualSubclassFeatures = features.filter(f => f.isSubclassFeature);
		if (actualSubclassFeatures.length > 0) {
			return features.filter(f => !f.gainSubclassFeature);
		}

		return features;
	}

	// ==========================================
	// Expertise & Language Detection
	// ==========================================

	/**
	 * Get expertise grants from features at a level.
	 * @param {Array} features - Features gained at the level
	 * @returns {Array} Array of {featureName, count, allowTools, toolName}
	 */
	static getExpertiseGrantsForLevel (features) {
		const grants = [];

		for (const feature of features) {
			const expertiseInfo = CharacterSheetClassUtils.findExpertiseInFeature(feature);
			if (expertiseInfo) {
				grants.push({
					featureName: feature.name,
					...expertiseInfo,
				});
			}
		}

		return grants;
	}

	/**
	 * Find expertise grant in a feature's entries.
	 * @param {Object} feature - Feature with entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	static findExpertiseInFeature (feature) {
		if (!feature?.entries) return null;

		if (feature.name === "Expertise") {
			return CharacterSheetClassUtils.parseExpertiseEntries(feature.entries);
		}

		return CharacterSheetClassUtils.findExpertiseInEntries(feature.entries);
	}

	/**
	 * Recursively search entries for nested Expertise grants.
	 * @param {Array} entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	static findExpertiseInEntries (entries) {
		for (const entry of entries) {
			if (typeof entry === "object" && entry.type === "entries") {
				if (entry.name === "Expertise") {
					return CharacterSheetClassUtils.parseExpertiseEntries(entry.entries || []);
				}
				if (CharacterSheetClassUtils.entryGrantsExpertise(entry.entries || [])) {
					return CharacterSheetClassUtils.parseExpertiseEntries(entry.entries || []);
				}
				if (entry.entries) {
					const result = CharacterSheetClassUtils.findExpertiseInEntries(entry.entries);
					if (result) return result;
				}
			}
		}
		return null;
	}

	/**
	 * Check if entries text indicates an expertise grant.
	 * @param {Array} entries
	 * @returns {boolean}
	 */
	static entryGrantsExpertise (entries) {
		const entriesText = entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();
		return entriesText.includes("proficiency bonus is doubled")
			|| entriesText.includes("gain expertise")
			|| entriesText.includes("double your proficiency bonus");
	}

	/**
	 * Parse expertise entries to determine count and tool allowance.
	 * @param {Array} entries
	 * @returns {{count: number, allowTools: boolean, toolName: string, fixedSkills: string[]}}
	 */
	static parseExpertiseEntries (entries) {
		const entriesText = entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();

		// Check for fixed/named skill expertise (e.g., "expertise in the Performance skill")
		const skillNames = Object.keys(Parser.SKILL_TO_ATB_ABV || {}).map(s => s.toLowerCase());
		const fixedSkills = [];
		
		// Pattern: "expertise in [the] {skill} [skill]" or "gain expertise in {skill}"
		const fixedSkillPattern = /(?:gain\s+)?expertise\s+in\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s*(?:skill)?/gi;
		let match;
		while ((match = fixedSkillPattern.exec(entriesText)) !== null) {
			const potentialSkill = match[1].toLowerCase().replace(/\s+/g, "");
			// Check if it's a valid skill name
			const normalizedSkillNames = skillNames.map(s => s.replace(/\s+/g, ""));
			if (normalizedSkillNames.includes(potentialSkill)) {
				fixedSkills.push(potentialSkill);
			}
		}

		// If we found fixed skills, return them with count matching
		if (fixedSkills.length > 0) {
			const allowTools = entriesText.includes("thieves' tools") && !entriesText.includes("variantrule");
			return {
				count: fixedSkills.length,
				allowTools,
				toolName: allowTools ? "Thieves' Tools" : null,
				fixedSkills,
			};
		}

		let count = 1;

		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:two|2)\s+(?:skills?|proficienc)/i)
			|| entriesText.match(/two\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 2;
		}
		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:one|1|a)\s+(?:skill|proficienc)/i)
			|| entriesText.match(/one\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 1;
		}
		if (entriesText.includes("another")) count = 1;
		if (entriesText.includes("three") && entriesText.includes("expertise")) count = 3;
		if (entriesText.includes("four") && entriesText.includes("expertise")) count = 4;

		const allowTools = entriesText.includes("thieves' tools") && !entriesText.includes("variantrule");

		return {
			count,
			allowTools,
			toolName: allowTools ? "Thieves' Tools" : null,
			fixedSkills: [],
		};
	}

	/**
	 * Get language grants from features at a level.
	 * @param {Array} features - Features gained at the level
	 * @returns {Array} Array of {featureName, count, autoLanguages?}
	 */
	static getLanguageGrantsForLevel (features) {
		const grants = [];

		for (const feature of features) {
			const langInfo = CharacterSheetClassUtils.findLanguageGrantsInFeature(feature);
			if (langInfo) {
				grants.push({
					featureName: feature.name,
					count: langInfo.count,
					autoLanguages: langInfo.autoLanguages,
				});
			}
		}

		return grants;
	}

	/**
	 * Find language grant in a feature's entries.
	 * @param {Object} feature
	 * @returns {{count: number, autoLanguages?: string[]}|null}
	 */
	static findLanguageGrantsInFeature (feature) {
		// Special handling for Thieves' Cant - grants Thieves' Cant + 1 other language
		// Check name BEFORE entries since features from string refs may lack entries
		const nameLower = feature?.name?.toLowerCase() || "";
		if (nameLower === "thieves' cant" || nameLower === "thieves cant") {
			return {
				count: 1,
				autoLanguages: ["Thieves' Cant"],
			};
		}

		if (!feature?.entries) return null;

		return CharacterSheetClassUtils.findLanguageGrantsInEntries(feature.entries, feature.name);
	}

	/**
	 * Recursively search entries for language grants.
	 * @param {Array} entries
	 * @param {string} featureName
	 * @returns {{count: number}|null}
	 */
	static findLanguageGrantsInEntries (entries, featureName) {
		const entriesText = entries.map(e => {
			if (typeof e === "string") return e;
			if (typeof e === "object" && e.type === "list" && e.items) {
				return e.items.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
			}
			return JSON.stringify(e);
		}).join(" ").toLowerCase();

		const langPatterns = [
			/learn\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/speak,?\s*read,?\s*and\s*write\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/two\s+(?:additional\s+)?languages?\s+of\s+your\s+choice/i,
			/one\s+(?:additional\s+)?language\s+of\s+your\s+choice/i,
			/one\s+other\s+language\s+of\s+your\s+choice/i,
			/\{@b Languages?\.\}\s*You\s+learn\s+(one|two|three|four|\d+)\s+languages?/i,
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

				if (count === 0 && entriesText.includes("two additional languages")) count = 2;
				if (count === 0 && entriesText.includes("two languages of your choice")) count = 2;
				if (count === 0 && entriesText.includes("one additional language")) count = 1;
				if (count === 0 && entriesText.includes("one language of your choice")) count = 1;
				if (count === 0 && entriesText.includes("one other language of your choice")) count = 1;

				if (count > 0) return {count};
			}
		}

		// Recursively check nested entries
		for (const entry of entries) {
			if (typeof entry === "object" && entry.entries) {
				const result = CharacterSheetClassUtils.findLanguageGrantsInEntries(entry.entries, featureName);
				if (result) return result;
			}
		}

		return null;
	}

	// ==========================================
	// Combat Tradition Helpers
	// ==========================================

	/**
	 * Get combat traditions auto-granted by a subclass feature (e.g. "Combat Methods (Mercy)").
	 * Used during level-up to pre-seed traditions before the effect pipeline runs.
	 * @param {Object} subclass - The subclass object ({ shortName, source, ... })
	 * @param {string} classSource - The class source (e.g. "TGTT")
	 * @returns {Array<{tradition: string, code: string}>} Granted traditions
	 */
	static getSubclassGrantedTraditions (subclass, classSource) {
		if (!subclass?.shortName) return [];
		const isTGTT = classSource === "TGTT" || subclass.source === "TGTT";
		if (!isTGTT) return [];

		// Subclass → granted tradition(s) + bonus method count
		// "choice" entries mean the user picks from the listed options during level-up
		const GRANTS = {
			// --- Monk subclasses ---
			"Mercy": [{tradition: "Sanguine Knot", code: "SK", bonusMethods: 1}],
			"Shadow": [{tradition: "Mist and Shade", code: "MS", bonusMethods: 1}],
			"Shackled": [{tradition: "Unending Wheel", code: "UW", bonusMethods: 1}],
			"Five Animals": [{tradition: "Tooth and Claw", code: "TC", bonusMethods: 1}],
			"Elements": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Long Death": [{tradition: "Mist and Shade", code: "MS", bonusMethods: 1}],
			"Drunken Master": [{tradition: "Rapid Current", code: "RC", bonusMethods: 1}],
			"Sun Soul": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Astral Self": [{tradition: "Mirror's Glint", code: "MG", bonusMethods: 1}],
			"Ascendant Dragon": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Cobalt Soul": [{tradition: "Razor's Edge", code: "RE", bonusMethods: 1}],
			// Choice-based: user picks from listed traditions
			"Open Hand": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			"Debilitation": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			"Kensei": [{tradition: null, code: null, bonusMethods: 1, choice: true}], // any tradition
			// --- Fighter subclasses ---
			"Eldritch Knight": [{tradition: "Arcane Knight", code: "AK", bonusMethods: 1}, {tradition: "Eldritch Blackguard", code: "EB", bonusMethods: 1}],
			"Battle Master": [{tradition: null, code: null, bonusMethods: 1, choice: true}, {tradition: null, code: null, bonusMethods: 0, choice: true}],
			"Arcane Archer": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1, choice: true}, {tradition: "Razor's Edge", code: "RE", bonusMethods: 0, choice: true}, {tradition: "Unending Wheel", code: "UW", bonusMethods: 0, choice: true}],
			"Champion": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			// --- Rogue subclasses ---
			"Swashbuckler": [{tradition: "Comedic Jabs", code: "CJ", bonusMethods: 1}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0}],
			// --- Warder (special: grants 2 fixed traditions) ---
			"Warder": [{tradition: "Tempered Iron", code: "TI", bonusMethods: 1}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0}],
		};
		return GRANTS[subclass.shortName] || [];
	}

	/**
	 * Get the total bonus methods a subclass grants.
	 * @param {Object} subclass
	 * @param {string} classSource
	 * @returns {number}
	 */
	static getSubclassBonusMethodCount (subclass, classSource) {
		const granted = this.getSubclassGrantedTraditions(subclass, classSource);
		return granted.reduce((sum, t) => sum + (t.bonusMethods || 0), 0);
	}

	/**
	 * Map a tradition code to its full name.
	 * @param {string} tradCode - Two-letter code
	 * @returns {string}
	 */
	static getTraditionName (tradCode) {
		const names = {
			"AM": "Adamant Mountain",
			"AK": "Arcane Knight",
			"BU": "Beast Unity",
			"BZ": "Biting Zephyr",
			"CJ": "Comedic Jabs",
			"EB": "Eldritch Blackguard",
			"GH": "Gallant Heart",
			"MG": "Mirror's Glint",
			"MS": "Mist and Shade",
			"RC": "Rapid Current",
			"RE": "Razor's Edge",
			"SK": "Sanguine Knot",
			"SS": "Spirited Steed",
			"TI": "Tempered Iron",
			"TC": "Tooth and Claw",
			"UW": "Unending Wheel",
			"UH": "Unerring Hawk",
		};
		return names[tradCode] || tradCode;
	}

	/**
	 * Get known combat traditions from existing optional features on the character.
	 * @param {Array} existingOptFeatures - Character's existing optional features
	 * @param {Object} state - Character state (for getCombatTraditions)
	 * @returns {Array<string>} Array of tradition codes
	 */
	static getKnownCombatTraditions (existingOptFeatures, state) {
		// First check explicitly stored traditions
		const storedTraditionsRaw = state.getCombatTraditions?.() || [];
		const storedTraditions = Array.from(new Set(
			storedTraditionsRaw
				.map(t => typeof t === "string" ? t : t?.code)
				.filter(Boolean),
		));
		if (storedTraditions.length > 0) return storedTraditions;

		// Fall back to inferring from existing combat method features
		const traditions = new Set();
		for (const feature of existingOptFeatures) {
			if (!feature.optionalFeatureTypes) continue;
			for (const ft of feature.optionalFeatureTypes) {
				const match = ft.match(/^CTM:(\d)?([A-Z]{2})$/);
				if (match) traditions.add(match[2]);
			}
		}
		return Array.from(traditions);
	}

	/**
	 * Get how many combat traditions a class should select.
	 * Attempts to parse from Combat Methods feature text; falls back to default.
	 * @param {Object} opts
	 * @param {Object} opts.classData
	 * @param {Array} opts.classFeatures
	 * @param {number} [opts.defaultCount=2]
	 * @returns {number}
	 */
	static getCombatTraditionSelectionCount ({classData, classFeatures = [], defaultCount = 2} = {}) {
		const className = classData?.name;
		if (!className || !classFeatures?.length) return defaultCount;

		const combatMethodsFeature = classFeatures.find(f =>
			f.className === className
			&& f.name === "Combat Methods"
			&& f.level <= 5,
		);
		if (!combatMethodsFeature?.entries) return defaultCount;

		const text = JSON.stringify(combatMethodsFeature.entries).toLowerCase();
		const wordToNum = {
			one: 1,
			two: 2,
			three: 3,
			four: 4,
			five: 5,
			six: 6,
		};

		const parseToken = (token) => {
			if (!token) return null;
			const asNum = Number(token);
			if (!Number.isNaN(asNum) && asNum > 0) return asNum;
			return wordToNum[token] || null;
		};

		const patterns = [
			/(\d+|one|two|three|four|five|six)\s+combat\s+traditions?\b/i,
			/choose\s+(\d+|one|two|three|four|five|six)\s+(?:different\s+)?traditions?\b/i,
			/gain\s+proficiency\s+in\s+(\d+|one|two|three|four|five|six)\s+combat\s+traditions?\b/i,
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			const parsed = parseToken(match?.[1]);
			if (parsed) return parsed;
		}

		return defaultCount;
	}

	/**
	 * Get the maximum method degree available at a given level from the class table.
	 * @param {Object} cls - Class data
	 * @param {number} level - Class level
	 * @returns {number}
	 */
	static getMaxMethodDegree (cls, level) {
		if (!cls.classTableGroups) return 0;

		for (const group of cls.classTableGroups) {
			const degreeColIdx = group.colLabels?.findIndex(label =>
				label.toLowerCase().includes("method degree"),
			);

			if (degreeColIdx >= 0 && group.rows) {
				const row = group.rows[level - 1];
				if (row) {
					const degreeVal = row[degreeColIdx];
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
	 * Get available combat traditions from optional features.
	 * @param {Array} allOptFeatures - All optional features
	 * @returns {Array<{code: string, name: string}>}
	 */
	static getAvailableTraditions (allOptFeatures) {
		const traditions = new Map();

		for (const opt of allOptFeatures) {
			if (!opt.featureType) continue;
			for (const ft of opt.featureType) {
				const match = ft.match(/^CTM:\d([A-Z]{2})$/);
				if (match) {
					const tradCode = match[1];
					if (!traditions.has(tradCode)) {
						traditions.set(tradCode, {
							code: tradCode,
							name: CharacterSheetClassUtils.getTraditionName(tradCode),
						});
					}
				}
			}
		}

		return Array.from(traditions.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Extract tradition codes from a class's Combat Methods feature description.
	 * @param {string} className
	 * @param {number} level
	 * @param {Array} classFeatures - All loaded class features
	 * @returns {Set<string>} Set of tradition codes
	 */
	static extractTraditionsFromClassFeature (className, level, classFeatures) {
		const traditions = new Set();
		if (!classFeatures?.length) return traditions;

		const combatMethodsFeature = classFeatures.find(f =>
			f.className === className
			&& f.name === "Combat Methods"
			&& f.level <= 5,
		);

		if (!combatMethodsFeature) return traditions;

		const extractFromEntries = (entries) => {
			if (!entries) return;
			if (typeof entries === "string") {
				const matches = entries.matchAll(/feature\s+type[=:]\s*ctm:([a-z]{2})/gi);
				for (const match of matches) {
					traditions.add(match[1].toUpperCase());
				}
				return;
			}
			if (Array.isArray(entries)) {
				for (const entry of entries) extractFromEntries(entry);
				return;
			}
			if (typeof entries === "object") {
				if (entries.entries) extractFromEntries(entries.entries);
				if (entries.items) extractFromEntries(entries.items);
				if (entries.entry) extractFromEntries(entries.entry);
			}
		};

		extractFromEntries(combatMethodsFeature.entries);
		return traditions;
	}

	/**
	 * Get available combat traditions filtered by what the class has access to.
	 * @param {Array} allOptFeatures
	 * @param {Array<string>} classAllowedTypes
	 * @param {string} className
	 * @param {Array} classFeatures
	 * @returns {Array<{code: string, name: string}>}
	 */
	static getAvailableTraditionsForClass (allOptFeatures, classAllowedTypes, className, classFeatures) {
		const allowedTraditionCodes = new Set();
		for (const ft of classAllowedTypes) {
			const match = ft.match(/^CTM:(\d)?([A-Z]{2})$/);
			if (match && match[2]) allowedTraditionCodes.add(match[2]);
		}

		if (allowedTraditionCodes.size === 0 && className) {
			const featureTraditions = CharacterSheetClassUtils.extractTraditionsFromClassFeature(className, 2, classFeatures);
			for (const trad of featureTraditions) allowedTraditionCodes.add(trad);
		}

		if (allowedTraditionCodes.size === 0) {
			return CharacterSheetClassUtils.getAvailableTraditions(allOptFeatures);
		}

		const traditions = new Map();
		for (const tradCode of allowedTraditionCodes) {
			traditions.set(tradCode, {
				code: tradCode,
				name: CharacterSheetClassUtils.getTraditionName(tradCode),
			});
		}

		return Array.from(traditions.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	// ==========================================
	// State Builder Helpers
	// ==========================================

	/**
	 * Build a spell state object ready for state.addSpell().
	 * Single source of truth — includes all enrichment fields.
	 * @param {Object} spell - Raw spell data
	 * @param {Object} opts
	 * @param {string} opts.sourceFeature - e.g. "Wizard Spellbook", "Spells Known"
	 * @param {string} opts.sourceClass - e.g. "Wizard", "Sorcerer"
	 * @param {boolean} [opts.prepared=false] - Whether spell is prepared
	 * @param {boolean} [opts.inSpellbook=false] - Whether spell is in spellbook
	 * @returns {Object} Spell state object
	 */
	static buildSpellStateObject (spell, {sourceFeature, sourceClass, prepared = false, inSpellbook = false}) {
		return {
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			ritual: CharacterSheetClassUtils.spellIsRitual(spell),
			concentration: CharacterSheetClassUtils.spellIsConcentration(spell),
			prepared,
			inSpellbook,
			sourceFeature,
			sourceClass,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			subschools: spell.subschools || [],
		};
	}

	/**
	 * Build a cantrip state object ready for state.addCantrip().
	 * @param {Object} spell - Raw cantrip data
	 * @param {Object} opts
	 * @param {string} opts.sourceFeature
	 * @param {string} opts.sourceClass
	 * @returns {Object} Cantrip state object
	 */
	static buildCantripStateObject (spell, {sourceFeature, sourceClass}) {
		return {
			name: spell.name,
			source: spell.source,
			school: spell.school,
			sourceFeature,
			sourceClass,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			subschools: spell.subschools || [],
		};
	}

	/**
	 * Build a normalized feature object ready for state.addFeature(), preserving
	 * metadata-first fields while applying canonical class/level/source defaults.
	 * @param {Object} feature - Raw feature payload
	 * @param {Object} opts
	 * @param {string} [opts.className]
	 * @param {string} [opts.classSource]
	 * @param {number} [opts.level]
	 * @param {string} [opts.featureType="Class"]
	 * @param {string} [opts.subclassName]
	 * @param {string} [opts.subclassShortName]
	 * @param {string} [opts.subclassSource]
	 * @param {boolean} [opts.isSubclassFeature]
	 * @param {boolean} [opts.isFeatureOption]
	 * @param {string} [opts.parentFeature]
	 * @param {Array<string>} [opts.optionalFeatureTypes]
	 * @returns {Object}
	 */
	static buildFeatureStateObject (
		feature,
		{
			className,
			classSource,
			level,
			featureType = "Class",
			subclassName,
			subclassShortName,
			subclassSource,
			isSubclassFeature,
			isFeatureOption,
			parentFeature,
			optionalFeatureTypes,
		} = {},
	) {
		const outFeature = feature || {};

		const entries = outFeature.entries;
		let description = outFeature.description;
		if (!description && entries) {
			// Strip "options" entries before rendering — their children are player choices
			// (e.g. Specialties), not automatic grants, and would pollute the description
			// with modifier text from ALL options (causing false auto-modifier detection).
			const entriesToRender = CharacterSheetClassUtils._stripOptionsEntries(entries);
			try { description = Renderer.get().render({entries: entriesToRender}); } catch (e) { description = ""; }
		}

		const explicitFeatureType = typeof outFeature.featureType === "string"
			? outFeature.featureType
			: null;

		const normalizedOptionalFeatureTypes = outFeature.optionalFeatureTypes
			|| (Array.isArray(outFeature.featureType) ? outFeature.featureType : undefined)
			|| optionalFeatureTypes;

		return {
			...outFeature,
			name: outFeature.name,
			source: outFeature.source || classSource,
			className: outFeature.className || className,
			classSource: outFeature.classSource || classSource,
			level: outFeature.level || level,
			subclassName: outFeature.subclassName ?? subclassName,
			subclassShortName: outFeature.subclassShortName ?? subclassShortName,
			subclassSource: outFeature.subclassSource ?? subclassSource,
			featureType: explicitFeatureType || featureType,
			entries,
			description: description || "",
			isSubclassFeature: outFeature.isSubclassFeature ?? isSubclassFeature,
			isFeatureOption: outFeature.isFeatureOption ?? isFeatureOption,
			parentFeature: outFeature.parentFeature ?? parentFeature,
			optionalFeatureTypes: normalizedOptionalFeatureTypes,
		};
	}

	/**
	 * Build a compact, replay-safe history snapshot from a feature-like payload.
	 * Used to persist metadata-critical fields in level history without relying on
	 * display-only summary objects.
	 * @param {Object} feature
	 * @param {Object} [opts]
	 * @param {string} [opts.type]
	 * @param {string} [opts.parentFeature]
	 * @returns {Object}
	 */
	static buildHistoryFeatureSnapshot (feature, {type, parentFeature} = {}) {
		const outFeature = feature || {};
		const snapshot = {
			name: outFeature.name,
			source: outFeature.source,
			type: type || outFeature.type,
			parentFeature: parentFeature ?? outFeature.parentFeature,
			ref: outFeature.ref,
			level: outFeature.level,
			featureType: outFeature.featureType,
			optionalFeatureTypes: outFeature.optionalFeatureTypes || (Array.isArray(outFeature.featureType) ? outFeature.featureType : undefined),
			className: outFeature.className,
			classSource: outFeature.classSource,
			subclassName: outFeature.subclassName,
			subclassShortName: outFeature.subclassShortName,
			subclassSource: outFeature.subclassSource,
			isSubclassFeature: outFeature.isSubclassFeature,
			isFeatureOption: outFeature.isFeatureOption,
			activatable: outFeature.activatable,
			effects: outFeature.effects,
			uses: outFeature.uses,
			interactionMode: outFeature.interactionMode,
		};

		if (!snapshot.ref) {
			snapshot.entries = outFeature.entries;
			snapshot.description = outFeature.description;
		}

		return CharacterSheetClassUtils._filterUndefinedKeys(snapshot);
	}

	/**
	 * Remove `type: "options"` entries from an entries array (shallow).
	 * Used to prevent player-choice option lists (Specialties, etc.) from being
	 * rendered into feature descriptions, which would cause false modifier
	 * detection from ALL option texts.
	 * @param {Array} entries
	 * @returns {Array} filtered copy (original not mutated)
	 */
	static _stripOptionsEntries (entries) {
		if (!Array.isArray(entries)) return entries;
		return entries
			.filter(e => !(typeof e === "object" && e?.type === "options"))
			.map(e => {
				if (typeof e === "object" && Array.isArray(e?.entries)) {
					return {...e, entries: CharacterSheetClassUtils._stripOptionsEntries(e.entries)};
				}
				return e;
			});
	}

	/**
	 * Remove undefined keys from a plain object.
	 * @param {Object} obj
	 * @returns {Object}
	 */
	static _filterUndefinedKeys (obj) {
		return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
	}

	/**
	 * Dedup features and build state objects for addFeature().
	 * Filters out ASI placeholders, gainSubclassFeature entries, and already-existing features.
	 * @param {Array} features - Raw features for this level
	 * @param {Array<string>} existingFeatureNames - Lowercase names already on the character
	 * @param {Object} opts
	 * @param {string} opts.className
	 * @param {string} opts.classSource
	 * @param {number} opts.level
	 * @returns {Array} Array of feature data objects ready for state.addFeature()
	 */
	static dedupAndBuildFeatures (features, existingFeatureNames, {className, classSource, level}) {
		const asiFeatureNames = ["ability score improvement", "ability score increase", "asi"];

		const featuresToAdd = features.filter(f => {
			if (f.gainSubclassFeature) return false;
			const nameLower = f.name.toLowerCase();
			if (asiFeatureNames.some(asi => nameLower.includes(asi))) return false;
			if (!f.isSubclassFeature && !f.subclassName && existingFeatureNames.includes(nameLower)) return false;
			return true;
		});

		return featuresToAdd.map(feature => CharacterSheetClassUtils.buildFeatureStateObject(feature, {
			className,
			classSource,
			level,
			featureType: "Class",
		}));
	}

	// ==========================================
	// State Mutation Helpers
	// ==========================================

	/**
	 * Apply feat ability/skill/language bonuses to state.
	 * @param {Object} state - CharacterSheetState instance
	 * @param {Object} feat - The feat object
	 * @param {Object} [featChoices] - Optional feat choices if not stored on feat._featChoices
	 */
	static applyFeatBonuses (state, feat, featChoices = null) {
		const choices = featChoices || feat._featChoices || {};

		// Apply damage immunities from feat/boon data (e.g., Epic Boons with "immune": ["radiant"])
		if (feat.immune) {
			feat.immune.forEach(type => {
				state.addImmunity(type);
			});
		}

		// Apply condition immunities from feat/boon data
		if (feat.conditionImmune) {
			feat.conditionImmune.forEach(cond => {
				const condition = typeof cond === "string" ? cond : cond.conditionImmune;
				if (condition) state.addConditionImmunity(condition);
			});
		}

		if (feat.ability) {
			feat.ability.forEach(ablChoice => {
				const max = ablChoice.max || 20;

				if (ablChoice.choose) {
					// Check for epic boon choice first, then feat choice
					if (feat._epicBoonAbilityChoice) {
						const {ability, amount} = feat._epicBoonAbilityChoice;
						const current = state.getAbilityBase(ability);
						state.setAbilityBase(ability, Math.min(max, current + amount));
					} else if (choices.ability) {
						// Apply chosen ability from feat choices
						const amount = ablChoice.choose.amount || 1;
						const current = state.getAbilityBase(choices.ability);
						state.setAbilityBase(choices.ability, Math.min(max, current + amount));
					}
				} else {
					Object.entries(ablChoice).forEach(([abl, bonus]) => {
						if (abl === "max") return;
						if (Parser.ABIL_ABVS.includes(abl)) {
							const current = state.getAbilityBase(abl);
							state.setAbilityBase(abl, Math.min(max, current + bonus));
						}
					});
				}
			});
		}

		// Apply fixed skill proficiencies from feat data
		if (feat.skillProficiencies) {
			feat.skillProficiencies.forEach(sp => {
				Object.keys(sp).forEach(skill => {
					if (skill !== "choose" && skill !== "any") {
						state.addSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""));
					}
				});
			});
		}

		// Apply chosen skill proficiencies
		if (choices.skills?.length) {
			choices.skills.forEach(skill => {
				state.addSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""));
			});
		}

		// Apply fixed language proficiencies from feat data
		if (feat.languageProficiencies) {
			feat.languageProficiencies.forEach(lp => {
				Object.keys(lp).forEach(lang => {
					if (lang !== "anyStandard" && lang !== "any") {
						state.addLanguage(lang);
					}
				});
			});
		}

		// Apply chosen language proficiencies
		if (choices.languages?.length) {
			choices.languages.forEach(lang => {
				state.addLanguage(lang);
			});
		}

		// Apply fixed tool proficiencies from feat data
		if (feat.toolProficiencies) {
			feat.toolProficiencies.forEach(tp => {
				Object.keys(tp).forEach(tool => {
					if (tool !== "anyArtisansTool" && tool !== "any" && tool !== "choose") {
						state.addToolProficiency(tool);
					}
				});
			});
		}

		// Apply chosen tool proficiencies
		if (choices.tools?.length) {
			choices.tools.forEach(tool => {
				state.addToolProficiency(tool);
			});
		}

		// Apply chosen expertise
		if (choices.expertise?.length) {
			choices.expertise.forEach(skill => {
				state.addExpertise(skill.toLowerCase().replace(/\s+/g, ""));
			});
		}

		// Apply chosen cantrips
		if (choices.cantrips?.length) {
			choices.cantrips.forEach(cantrip => {
				// Check if spell is already known before adding
				const existingSpells = state.getSpells?.() || [];
				const existingInnate = state.getInnateSpells?.() || [];
				const alreadyKnown = [...existingSpells, ...existingInnate].some(
					s => s.name === cantrip.name && s.source === cantrip.source,
				);
				if (!alreadyKnown) {
					state.addSpell({
						name: cantrip.name,
						source: cantrip.source,
						level: 0,
						fromFeat: feat.name,
					});
				}
			});
		}

		// Apply chosen spells
		if (choices.spells?.length) {
			choices.spells.forEach(spell => {
				// Check if spell is already known before adding
				const existingSpells = state.getSpells?.() || [];
				const existingInnate = state.getInnateSpells?.() || [];
				const alreadyKnown = [...existingSpells, ...existingInnate].some(
					s => s.name === spell.name && s.source === spell.source,
				);
				if (!alreadyKnown) {
					if (spell.innate) {
						state.addInnateSpell({
							name: spell.name,
							source: spell.source,
							level: spell.level,
							daily: spell.daily || "1",
							fromFeat: feat.name,
						});
					} else {
						state.addSpell({
							name: spell.name,
							source: spell.source,
							level: spell.level,
							fromFeat: feat.name,
						});
					}
				}
			});
		}
	}

	/**
	 * Update hit dice tracking after gaining a level.
	 * @param {Object} state - CharacterSheetState instance
	 * @param {Object} classData
	 */
	static updateHitDice (state, classData) {
		const hitDie = `d${CharacterSheetClassUtils.getClassHitDie(classData)}`;
		const hitDice = state.getHitDiceByType();

		if (!hitDice[hitDie]) {
			hitDice[hitDie] = {current: 1, max: 1};
		} else {
			hitDice[hitDie].max += 1;
			hitDice[hitDie].current += 1;
		}

		state.setHitDice(hitDice);
	}

	/**
	 * Update class resources (Rage, Ki, Sorcery Points, etc.) after leveling up.
	 * @param {Object} state - CharacterSheetState instance
	 * @param {Object} classEntry - Class entry from state {name, source}
	 * @param {number} newLevel - New class level
	 * @param {Object} classData - Full class data
	 */
	static updateClassResources (state, classEntry, newLevel, classData) {
		const resourceDefs = {
			"Barbarian": [
				{name: "Rage", maxByLevel: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 999], recharge: "long"},
			],
			"Monk": [
				{name: "__MONK_RESOURCE__", maxByLevel: lvl => lvl >= 2 ? lvl : 0, recharge: "short"},
			],
			"Sorcerer": [
				{name: "Sorcery Points", maxByLevel: lvl => {
					const isTGTT = classEntry.source === "TGTT" || classData.source === "TGTT";
					if (isTGTT) return lvl + 1;
					return lvl >= 2 ? lvl : 0;
				}, recharge: "long"},
			],
			"Paladin": [
				{name: "Lay on Hands", maxByLevel: lvl => lvl * 5, recharge: "long"},
			],
			"Bard": [
				{name: "Bardic Inspiration", maxByLevel: () => Math.max(1, state.getAbilityMod("cha")), recharge: newLevel >= 5 ? "short" : "long"},
			],
		};

		const classResourceDefs = resourceDefs[classData.name];
		if (!classResourceDefs) {
			state.recalculateResourceMaximums();
			return;
		}

		const currentResources = state.getResources();

		classResourceDefs.forEach(resourceDef => {
			let resourceName = resourceDef.name;
			if (resourceName === "__MONK_RESOURCE__") {
				resourceName = "Focus Points";
			}

			let newMax;
			if (typeof resourceDef.maxByLevel === "function") {
				newMax = resourceDef.maxByLevel(newLevel);
			} else if (Array.isArray(resourceDef.maxByLevel)) {
				newMax = resourceDef.maxByLevel[newLevel - 1] || 0;
			} else {
				newMax = resourceDef.maxByLevel;
			}

			const isMonkResource = resourceName === "Ki Points" || resourceName === "Focus Points";
			let existingResource;
			if (isMonkResource) {
				existingResource = currentResources.find(r => r.name === "Ki Points" || r.name === "Focus Points");
			} else {
				existingResource = currentResources.find(r => r.name === resourceName);
			}

			if (existingResource) {
				const oldMax = existingResource.max;
				if (newMax > oldMax) {
					existingResource.max = newMax;
					existingResource.current += (newMax - oldMax);
				}
			} else if (newMax > 0) {
				state.addResource({
					name: resourceName,
					max: newMax,
					current: newMax,
					recharge: resourceDef.recharge,
				});
			}

		});

		state.recalculateResourceMaximums();
	}

	/**
	 * Update spell slots after leveling up.
	 * @param {Object} state - CharacterSheetState instance
	 * @param {Object} classEntry - Class entry from state
	 * @param {number} newLevel - New class level
	 * @param {Object} classData - Full class data
	 */
	static updateSpellSlots (state, classEntry, newLevel, classData) {
		const spellcastingAbility = CharacterSheetClassUtils.getSpellcastingAbility(classData);
		if (!spellcastingAbility) return;

		const classes = state.getClasses();
		const isMulticlass = classes.length > 1;

		if (isMulticlass) {
			state.calculateSpellSlots();
		} else {
			const slots = CharacterSheetClassUtils.getSpellSlotsForLevel(classData, newLevel);

			const spellcasting = state.getSpellcasting();
			spellcasting.ability = spellcastingAbility;

			Object.entries(slots).forEach(([level, count]) => {
				if (!spellcasting.spellSlots[level]) {
					spellcasting.spellSlots[level] = {current: count, max: count};
				} else {
					const diff = count - spellcasting.spellSlots[level].max;
					if (diff > 0) {
						spellcasting.spellSlots[level].max = count;
						spellcasting.spellSlots[level].current += diff;
					}
				}
			});
		}
	}

	/**
	 * Get the spell slot table for a class at a given level.
	 * @param {Object} classData
	 * @param {number} level
	 * @returns {Object} Map of spell level → slot count
	 */
	static getSpellSlotsForLevel (classData, level) {
		const fullCasterSlots = {
			1: {1: 2}, 2: {1: 3}, 3: {1: 4, 2: 2}, 4: {1: 4, 2: 3},
			5: {1: 4, 2: 3, 3: 2}, 6: {1: 4, 2: 3, 3: 3}, 7: {1: 4, 2: 3, 3: 3, 4: 1},
			8: {1: 4, 2: 3, 3: 3, 4: 2}, 9: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			10: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2}, 11: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1},
			12: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1}, 13: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1},
			14: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1}, 15: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1},
			16: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1}, 17: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1},
			18: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1, 7: 1, 8: 1, 9: 1}, 19: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 1, 8: 1, 9: 1},
			20: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1},
		};

		const halfCasterSlots = {
			2: {1: 2}, 3: {1: 3}, 4: {1: 3}, 5: {1: 4, 2: 2}, 6: {1: 4, 2: 2},
			7: {1: 4, 2: 3}, 8: {1: 4, 2: 3}, 9: {1: 4, 2: 3, 3: 2}, 10: {1: 4, 2: 3, 3: 2},
			11: {1: 4, 2: 3, 3: 3}, 12: {1: 4, 2: 3, 3: 3}, 13: {1: 4, 2: 3, 3: 3, 4: 1},
			14: {1: 4, 2: 3, 3: 3, 4: 1}, 15: {1: 4, 2: 3, 3: 3, 4: 2}, 16: {1: 4, 2: 3, 3: 3, 4: 2},
			17: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1}, 18: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			19: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2}, 20: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
		};

		const fullCasters = ["Wizard", "Sorcerer", "Cleric", "Druid", "Bard"];
		const halfCasters = ["Paladin", "Ranger"];

		if (fullCasters.includes(classData.name)) return fullCasterSlots[level] || {};
		if (halfCasters.includes(classData.name)) return halfCasterSlots[level] || {};
		return {};
	}

	/**
	 * Check for and add racial spells at the current character level.
	 * @param {Object} state - CharacterSheetState instance
	 * @param {Object} page - CharacterSheetPage instance (for getSpells)
	 */
	static updateRacialSpells (state, page) {
		const race = state.getRace();
		if (!race?.additionalSpells?.length) return;

		const totalLevel = state.getTotalLevel();
		const allSpells = page.getSpells();
		const raceName = race.name;
		const subraceName = race._subraceName || race.subrace;

		race.additionalSpells.forEach(spellBlock => {
			if (spellBlock.name) {
				if (!subraceName || spellBlock.name.toLowerCase() !== subraceName.toLowerCase()) return;
			}

			if (spellBlock.known) {
				Object.entries(spellBlock.known).forEach(([levelStr, spellsAtLevel]) => {
					const charLevel = parseInt(levelStr);
					if (charLevel !== totalLevel) return;
					CharacterSheetClassUtils._processRacialSpellList(state, spellsAtLevel, allSpells, raceName);
				});
			}

			if (spellBlock.innate) {
				Object.entries(spellBlock.innate).forEach(([levelStr, spellConfig]) => {
					const charLevel = parseInt(levelStr);
					if (charLevel !== totalLevel) return;

					if (typeof spellConfig === "object") {
						if (spellConfig.daily) {
							Object.entries(spellConfig.daily).forEach(([uses, spellList]) => {
								CharacterSheetClassUtils._processRacialInnateSpells(state, spellList, allSpells, raceName, parseInt(uses), "long");
							});
						}
						if (spellConfig.rest) {
							Object.entries(spellConfig.rest).forEach(([uses, spellList]) => {
								CharacterSheetClassUtils._processRacialInnateSpells(state, spellList, allSpells, raceName, parseInt(uses), "short");
							});
						}
						if (Array.isArray(spellConfig)) {
							CharacterSheetClassUtils._processRacialInnateSpells(state, spellConfig, allSpells, raceName, 0, null);
						}
					} else if (Array.isArray(spellConfig)) {
						CharacterSheetClassUtils._processRacialInnateSpells(state, spellConfig, allSpells, raceName, 0, null);
					}
				});
			}
		});
	}

	/** @private */
	static _processRacialSpellList (state, spellList, allSpells, sourceName) {
		if (!Array.isArray(spellList)) {
			if (typeof spellList === "object" && spellList._) {
				CharacterSheetClassUtils._processRacialSpellList(state, spellList._, allSpells, sourceName);
			}
			return;
		}

		spellList.forEach(spellRef => {
			const spellData = CharacterSheetClassUtils._resolveSpellReference(spellRef, allSpells);
			if (spellData) {
				const existing = state.getSpells().find(s =>
					s.name === spellData.name && s.source === spellData.source,
				);
				if (existing) return;

				state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spellData, {
					sourceFeature: sourceName,
					sourceClass: "",
					prepared: spellData.level === 0,
				}));
			}
		});
	}

	/** @private */
	static _processRacialInnateSpells (state, spellList, allSpells, sourceName, uses, recharge) {
		if (!Array.isArray(spellList)) return;

		spellList.forEach(spellRef => {
			const spellData = CharacterSheetClassUtils._resolveSpellReference(spellRef, allSpells);
			if (spellData) {
				const existing = state.getInnateSpells().find(s =>
					s.name === spellData.name && s.source === spellData.source,
				);
				if (existing) return;

				const atWill = uses === 0;
				state.addInnateSpell({
					name: spellData.name,
					source: spellData.source,
					level: spellData.level,
					atWill,
					uses: atWill ? null : uses,
					recharge,
					sourceFeature: sourceName,
				});
			}
		});
	}

	/** @private */
	static _resolveSpellReference (spellRef, allSpells) {
		if (typeof spellRef !== "string") return null;

		let spellName = spellRef.replace(/#c$/, "");
		let source = null;

		const parts = spellName.split("|");
		spellName = parts[0].toLowerCase();
		if (parts.length > 1) source = parts[1].toUpperCase();

		return allSpells.find(s => {
			const nameMatch = s.name.toLowerCase() === spellName;
			if (!nameMatch) return false;
			if (source) return s.source === source;
			return true;
		});
	}

	// ------------------------------------------------------------------
	// Optional Feature Progression
	// ------------------------------------------------------------------

	/**
	 * Compute optional feature gains between currentLevel and newLevel.
	 * @param {object} classData - The class data object
	 * @param {number} currentLevel - Previous class level
	 * @param {number} newLevel - New class level
	 * @param {object} state - Character state (needs getFeatures())
	 * @returns {Array} Array of gain objects
	 */
	static getOptionalFeatureGains (classData, currentLevel, newLevel, state) {
		const gains = [];
		if (!classData.optionalfeatureProgression?.length) return gains;

		classData.optionalfeatureProgression.forEach(optFeatProg => {
			const featureTypes = optFeatProg.featureType || [];
			const name = optFeatProg.name || featureTypes.map(ft => ft.replace(/:/g, " ")).join(", ");

			let countAtCurrent = 0;
			let countAtNew = 0;

			if (Array.isArray(optFeatProg.progression)) {
				countAtCurrent = optFeatProg.progression[currentLevel - 1] || 0;
				countAtNew = optFeatProg.progression[newLevel - 1] || 0;
			} else if (typeof optFeatProg.progression === "object") {
				countAtCurrent = optFeatProg.progression[String(currentLevel)] || 0;
				countAtNew = optFeatProg.progression[String(newLevel)] || 0;
			}

			const existingOptFeatures = state.getFeatures().filter(f => f.featureType === "Optional Feature");

			const matchesFeatureType = (optFeatTypes) => {
				return optFeatTypes?.some(ft =>
					featureTypes.some(progType => ft === progType || ft.startsWith(progType)),
				);
			};

			const existingOfType = existingOptFeatures.filter(f =>
				matchesFeatureType(f.optionalFeatureTypes),
			).length;

			const newOptionsCount = countAtNew - existingOfType;
			if (newOptionsCount > 0) {
				gains.push({
					featureTypes,
					name,
					currentCount: existingOfType,
					totalCount: countAtNew,
					newCount: newOptionsCount,
					required: optFeatProg.required || false,
				});
			}
		});

		return gains;
	}
}

// Export
export {CharacterSheetClassUtils};
globalThis.CharacterSheetClassUtils = CharacterSheetClassUtils;
