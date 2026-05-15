/**
 * Character Sheet Quick Build
 * A guided wizard that allows players to create/level a character to any target level (1–20)
 * in one streamlined flow, collecting all leveling choices (subclass, ASIs/feats, optional features,
 * expertise, spells, HP) and batch-applying them.
 *
 * Supports:
 * - Single class and multiclass builds
 * - Entry from both the Builder (new characters) and header button (existing characters)
 * - Full interactive wizard with all choice points
 * - Average or rolled HP
 * - Batch spell selection
 */
class CharacterSheetQuickBuild {
	constructor (page) {
		this._page = page;
		this._state = page.getState();

		// Wizard navigation state
		this._currentStep = 0;
		this._steps = [];

		// Selection state
		this._targetLevel = 2;
		this._classAllocations = []; // [{classData, source, targetLevel, startLevel, order}]
		this._fromLevel = 0; // Starting character level (0 for new, >0 for existing)

		// Per-level analysis results
		this._levelAnalysis = []; // [{level, classData, classEntry, needsSubclass, hasAsi, ...}]

		// Collected choices
		this._selections = {
			subclasses: {}, // {className: subclassData}
			subclassChoices: {}, // {className_source: {key, name}}
			asi: {}, // {levelKey: {abilityChoices: {}, feat: null, isBoth: false}}
			optionalFeatures: {}, // {levelKey: {featureTypeKey: [optionObj, ...]}}
			featureOptions: {}, // {levelKey: {featureKey: [optionObj, ...]}}
			expertise: {}, // {levelKey: {featureName: [skill, ...]}}
			languages: {}, // {levelKey: {featureName: [language, ...]}}
			scholarSkill: null,
			spellbookSpells: [], // [{name, source, level, ...}]
			spells: [], // batch spell selections
			hpMethod: "average", // "average" or "roll"
			hpRolls: {}, // {levelKey: rollResult}
			_combatTraditions: [], // TGTT combat tradition selections
			weaponMasteries: [], // XPHB weapon mastery selections
		};

		// Modal/overlay reference
		this._overlay = null;
		this._isActive = false;
	}

	// ==========================================
	// Public API
	// ==========================================

	/**
	 * Show the Quick Build wizard for an existing character
	 * Entry point from the header "Quick Build" button
	 */
	async showQuickBuild () {
		const totalLevel = this._state.getTotalLevel();
		if (totalLevel >= 20) {
			JqueryUtil.doToast({type: "warning", content: "Character is already at maximum level (20)."});
			return;
		}
		if (totalLevel < 1) {
			JqueryUtil.doToast({type: "warning", content: "Please create a character first using the Builder."});
			return;
		}

		this._fromLevel = totalLevel;
		this._targetLevel = Math.min(20, totalLevel + 1);

		// Pre-fill class allocations from existing classes
		this._classAllocations = this._state.getClasses().map(c => ({
			className: c.name,
			classSource: c.source,
			classData: null, // Will be resolved
			currentLevel: c.level,
			targetLevel: c.level, // Start with current levels
			subclass: c.subclass || null,
		}));

		this._resetSelections();
		await this._showWizard();
	}

	/**
	 * Show the Quick Build wizard during character creation (Builder handoff)
	 * @param {Object} opts
	 * @param {Object} opts.classData - The selected class data
	 * @param {number} opts.targetLevel - Target level to build to
	 * @param {?Object} [opts.subclass] - Preselected subclass from Builder
	 * @param {?Object|string} [opts.subclassChoice] - Preselected subclass choice from Builder
	 */
	async showFromBuilder ({classData, targetLevel, subclass = null, subclassChoice = null}) {
		const classKey = `${classData.name}_${classData.source}`;
		const existingClass = this._state.getClasses().find(c => c.name === classData.name && c.source === classData.source);
		const normalizedSubclassChoice = CharacterSheetClassUtils.normalizeDivineSoulAffinity(subclassChoice)
			|| CharacterSheetClassUtils.normalizeDivineSoulAffinity(existingClass?.subclassChoice);
		const resolvedSubclass = subclass || existingClass?.subclass || null;

		this._fromLevel = 1; // Builder creates at level 1
		this._targetLevel = targetLevel;

		this._classAllocations = [{
			className: classData.name,
			classSource: classData.source,
			classData: classData,
			currentLevel: 1,
			targetLevel: targetLevel,
			subclass: resolvedSubclass,
		}];

		this._resetSelections();
		if (resolvedSubclass) this._selections.subclasses[classKey] = resolvedSubclass;
		if (normalizedSubclassChoice) this._selections.subclassChoices[classKey] = normalizedSubclassChoice;
		await this._showWizard();
	}

	/**
	 * Check if Quick Build is currently active
	 */
	get isActive () { return this._isActive; }

	// ==========================================
	// Selection Reset
	// ==========================================

	_resetSelections () {
		this._selections = {
			subclasses: {},
			subclassChoices: {},
			asi: {},
			optionalFeatures: {},
			featureOptions: {},
			expertise: {},
			languages: {},
			scholarSkill: null,
			spellbookSpells: [],
			knownSpells: [], // Known-caster spells (Sorcerer, Bard, etc.)
			knownCantrips: [], // Known-caster cantrips
			preparedSpells: [], // Prepared-caster spells (XPHB Warlock, etc.)
			preparedCantrips: [], // Prepared-caster cantrips
			spells: [],
			hpMethod: "average",
			hpRolls: {},
			_combatTraditions: [],
			weaponMasteries: [],
		};
		this._levelAnalysis = [];
		this._steps = [];
		this._currentStep = 0;
	}

	// ==========================================
	// Level Analysis Engine
	// ==========================================

	/**
	 * Resolve class data objects from the page's loaded data
	 */
	_resolveClassData () {
		const allClasses = this._page.getClasses();
		for (const alloc of this._classAllocations) {
			if (!alloc.classData) {
				alloc.classData = allClasses.find(c => c.name === alloc.className && c.source === alloc.classSource);
			}
		}
	}

	/**
	 * Analyze all levels from current to target, determining what choices are needed at each level.
	 * Returns an array of per-level analysis objects.
	 */
	_analyzeLevels () {
		this._resolveClassData();
		this._levelAnalysis = [];

		// Build a level-by-level plan: which class gains a level at each character level
		const levelPlan = this._buildLevelPlan();

		// Track running state for analysis
		let runningOptionalFeatureCounts = {}; // {featureTypeKey: count}

		for (const planEntry of levelPlan) {
			const {characterLevel, className, classSource, classLevel, classData} = planEntry;

			if (!classData) {
				// eslint-disable-next-line no-console
				console.warn(`[QuickBuild] No class data found for ${className}`);
				continue;
			}

			// Get the subclass (may have been selected in an earlier level's choice)
			const subclass = this._getSubclassForClass(className, classSource, classLevel);

			// Get features for this class level
			const features = this._getLevelFeatures(classData, classLevel, subclass);

			// Check what choices this level requires
			// Only prompt for subclass selection at the *first* gainSubclassFeature level,
			// not at every level that grants a subclass feature (e.g. Sorcerer 3/6/14/18)
			const needsSubclass = classLevel === CharacterSheetClassUtils.getSubclassLevel(classData)
				&& !this._hasSubclass(className, classSource);

			const hasAsi = CharacterSheetClassUtils.levelGrantsAsi(classData, classLevel);

			const optionalFeatureGains = this._getOptionalFeatureGains(
				classData, classLevel, runningOptionalFeatureCounts,
			);

			const featureOptions = this._getFeatureOptionsForLevel(features, classLevel)
				// Filter out option groups where ALL options are optional features — those are
				// handled by optionalfeatureProgression in the Class Options step (e.g. Battle Tactics)
				.filter(optGroup => !optGroup.options.every(opt => opt.type === "optionalfeature"));
			const expertiseGrants = this._getExpertiseGrantsForLevel(features);
			const languageGrants = this._getLanguageGrantsForLevel(features);

			// Check for Wizard-specific features
			const isWizard = classData.name === "Wizard";
			const isXPHBWizard = isWizard && (CharacterSheetClassUtils.is2024Source(classSource) || CharacterSheetClassUtils.is2024Source(classData.source));
			const isScholarLevel = isXPHBWizard && classLevel === 2;
			const isSpellbookLevel = isWizard && classLevel >= 2;

			// Known-spell caster detection (Sorcerer, Bard, Ranger, Warlock, etc.)
			let isKnownCaster = false;
			let knownSpellsGainAtLevel = 0;
			let knownCantripsGainAtLevel = 0;
			let knownMaxSpellLevel = 0;

			if (!isWizard && !classData.preparedSpellsProgression) {
				const newKnown = CharacterSheetClassUtils.getKnownSpellsAtLevel(classData, className, classLevel);
				if (newKnown !== null) {
					isKnownCaster = true;
					const prevKnown = classLevel >= 2 ? (CharacterSheetClassUtils.getKnownSpellsAtLevel(classData, className, classLevel - 1) || 0) : 0;
					knownSpellsGainAtLevel = Math.max(0, newKnown - prevKnown);

					const newCantrips = CharacterSheetClassUtils.getCantripsAtLevel(classData, className, classLevel);
					if (newCantrips !== null) {
						const prevCantrips = classLevel >= 2 ? (CharacterSheetClassUtils.getCantripsAtLevel(classData, className, classLevel - 1) || 0) : 0;
						knownCantripsGainAtLevel = Math.max(0, newCantrips - prevCantrips);
					}

					knownMaxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, classLevel);
				}
			}

			// Check for weapon mastery progression
			const weaponMasteryCount = this._getWeaponMasteryCountAtLevel(classData, classLevel);

			// Prepared-spell caster detection (XPHB Warlock, etc.)
			let isPreparedCaster = false;
			let preparedSpellsGainAtLevel = 0;
			let preparedCantripsGainAtLevel = 0;
			let preparedMaxSpellLevel = 0;

			if (!isWizard && !isKnownCaster && classData.preparedSpellsProgression) {
				isPreparedCaster = true;
				const prog = classData.preparedSpellsProgression;
				const newPrepared = prog[classLevel - 1] || 0;
				const prevPrepared = classLevel >= 2 ? (prog[classLevel - 2] || 0) : 0;
				preparedSpellsGainAtLevel = Math.max(0, newPrepared - prevPrepared);

				const newCantrips = CharacterSheetClassUtils.getCantripsAtLevel(classData, className, classLevel);
				if (newCantrips !== null) {
					const prevCantrips = classLevel >= 2 ? (CharacterSheetClassUtils.getCantripsAtLevel(classData, className, classLevel - 1) || 0) : 0;
					preparedCantripsGainAtLevel = Math.max(0, newCantrips - prevCantrips);
				}

				const casterProg = classData.casterProgression;
				if (casterProg === "pact") {
					preparedMaxSpellLevel = Math.min(5, Math.ceil(classLevel / 2));
				} else if (casterProg === "full") {
					preparedMaxSpellLevel = Math.min(9, Math.ceil(classLevel / 2));
				} else {
					preparedMaxSpellLevel = Math.min(9, Math.ceil(classLevel / 2));
				}
			}

			// Update running optional feature counts
			for (const gain of optionalFeatureGains) {
				const key = gain.featureTypes.join("_");
				runningOptionalFeatureCounts[key] = (runningOptionalFeatureCounts[key] || 0) + gain.newCount;
			}

			const analysis = {
				characterLevel,
				className,
				classSource,
				classLevel,
				classData,
				features,
				needsSubclass,
				hasAsi,
				optionalFeatureGains,
				featureOptions,
				expertiseGrants,
				languageGrants,
				isScholarLevel,
				isSpellbookLevel,
				isWizard,
				isKnownCaster,
				knownSpellsGainAtLevel,
				knownCantripsGainAtLevel,
				knownMaxSpellLevel,
				isPreparedCaster,
				preparedSpellsGainAtLevel,
				preparedCantripsGainAtLevel,
				preparedMaxSpellLevel,
				weaponMasteryCount,
			};

			this._levelAnalysis.push(analysis);
		}

		return this._levelAnalysis;
	}

	/**
	 * Build a level-by-level plan determining which class gains a level at each character level.
	 * For single class: straightforward level 2→N.
	 * For multiclass: respects the user's class allocation order.
	 */
	_buildLevelPlan () {
		const plan = [];
		let characterLevel = this._fromLevel;

		// For simple single-class case
		if (this._classAllocations.length === 1) {
			const alloc = this._classAllocations[0];
			const startClassLevel = alloc.currentLevel;
			for (let cl = startClassLevel + 1; cl <= alloc.targetLevel; cl++) {
				characterLevel++;
				plan.push({
					characterLevel,
					className: alloc.className,
					classSource: alloc.classSource,
					classLevel: cl,
					classData: alloc.classData,
					isNewClass: cl === 1,
				});
			}
			return plan;
		}

		// Multiclass: iterate allocations in order
		// Each allocation specifies a class and how many levels to go up
		// First, process existing classes' additional levels, then new classes
		const classLevelTrackers = {};
		for (const alloc of this._classAllocations) {
			classLevelTrackers[`${alloc.className}_${alloc.classSource}`] = alloc.currentLevel || 0;
		}

		for (const alloc of this._classAllocations) {
			const key = `${alloc.className}_${alloc.classSource}`;
			const startAt = classLevelTrackers[key];
			for (let cl = startAt + 1; cl <= alloc.targetLevel; cl++) {
				characterLevel++;
				if (characterLevel > 20) break;
				plan.push({
					characterLevel,
					className: alloc.className,
					classSource: alloc.classSource,
					classLevel: cl,
					classData: alloc.classData,
					isNewClass: cl === 1,
				});
				classLevelTrackers[key] = cl;
			}
		}

		return plan;
	}

	// ==========================================
	// Level-Up Logic (shared via CharacterSheetClassUtils)
	// ==========================================

	_hasSubclass (className, classSource) {
		// Check if user already selected a subclass for this class in selections
		if (this._selections.subclasses[`${className}_${classSource}`]) return true;
		// Check if existing character has a subclass for this class
		const existing = this._state.getClasses().find(c => c.name === className && c.source === classSource);
		return !!existing?.subclass;
	}

	_getSubclassForClass (className, classSource, classLevel) {
		// Check quick build selection first
		const selected = this._selections.subclasses[`${className}_${classSource}`];
		if (selected) return selected;
		// Check existing character
		const existing = this._state.getClasses().find(c => c.name === className && c.source === classSource);
		return existing?.subclass || null;
	}

	_getLevelFeatures (classData, level, subclass = null) {
		const classFeatures = this._page.getClassFeatures();
		const subclassFeatures = this._page.getSubclassFeatures?.() || [];
		return CharacterSheetClassUtils.getLevelFeatures(classData, level, subclass, classFeatures, subclassFeatures);
	}

	_getOptionalFeatureGains (classData, classLevel, runningCounts) {
		const gains = [];
		if (!classData.optionalfeatureProgression?.length) return gains;

		classData.optionalfeatureProgression.forEach(optFeatProg => {
			const featureTypes = optFeatProg.featureType || [];
			const name = optFeatProg.name || featureTypes.map(ft => ft.replace(/:/g, " ")).join(", ");
			const key = featureTypes.join("_");

			let countAtLevel = 0;
			if (Array.isArray(optFeatProg.progression)) {
				countAtLevel = optFeatProg.progression[classLevel - 1] || 0;
			} else if (typeof optFeatProg.progression === "object") {
				// Object format: find highest key <= classLevel
				let highest = 0;
				for (const [lvlStr, count] of Object.entries(optFeatProg.progression)) {
					const lvl = parseInt(lvlStr);
					if (lvl <= classLevel && lvl > highest) {
						highest = lvl;
						countAtLevel = count;
					}
				}
				if (highest === 0) countAtLevel = 0;
			}

			// How many do we already have from previous levels in quick build + existing?
			const existingCount = runningCounts[key] || 0;
			const existingFromCharacter = this._state.getFeatures().filter(f =>
				f.featureType === "Optional Feature"
				&& f.optionalFeatureTypes?.some(ft => featureTypes.some(pt => ft === pt || ft.startsWith(pt))),
			).length;

			const totalExisting = existingCount + existingFromCharacter;
			const newCount = countAtLevel - totalExisting;

			if (newCount > 0) {
				gains.push({
					featureTypes,
					name,
					currentCount: totalExisting,
					totalCount: countAtLevel,
					newCount,
					required: optFeatProg.required || false,
				});
			}
		});

		return gains;
	}

	_getFeatureOptionsForLevel (features, level) {
		const classFeatures = this._page.getClassFeatures();
		return CharacterSheetClassUtils.getFeatureOptionsForLevel(features, level, classFeatures);
	}

	_getExpertiseGrantsForLevel (features) {
		return CharacterSheetClassUtils.getExpertiseGrantsForLevel(features);
	}

	_getLanguageGrantsForLevel (features) {
		return CharacterSheetClassUtils.getLanguageGrantsForLevel(features);
	}

	/**
	 * Get weapon mastery count at a given class level from classTableGroups.
	 * Returns 0 if the class doesn't have a Weapon Mastery progression.
	 */
	_getWeaponMasteryCountAtLevel (classData, level) {
		if (!classData.classTableGroups?.length) return 0;

		for (const tableGroup of classData.classTableGroups) {
			const masteryColIndex = tableGroup.colLabels?.findIndex(
				col => typeof col === "string" && (col === "Weapon Mastery" || col.toLowerCase().includes("mastery")),
			);
			if (masteryColIndex == null || masteryColIndex === -1) continue;

			const row = tableGroup.rows?.[level - 1];
			if (!row) continue;

			const value = row[masteryColIndex];
			if (typeof value === "number") return value;
			if (typeof value === "string") return parseInt(value) || 0;
		}

		return 0;
	}

	/**
	 * Get the ability score bonus amount from a feat with a choosable ability.
	 * @param {Object} feat - The feat object
	 * @returns {number} The ability increase amount (usually 1), or 0 if no choosable ability
	 */
	_getFeatAbilityAmount (feat) {
		if (!feat?.ability) return 0;
		for (const ab of feat.ability) {
			if (ab.choose) return ab.choose.amount || 1;
		}
		return 0;
	}

	// ==========================================
	// Wizard Step Generation
	// ==========================================

	/**
	 * Build wizard steps based on the level analysis.
	 * Steps with no applicable choices are skipped.
	 */
	_buildWizardSteps () {
		this._steps = [];

		// Step 1: Target Level & Class Allocation (always shown)
		this._steps.push({
			id: "target",
			label: "Target Level",
			icon: "🎯",
			required: true,
			render: (content) => this._renderTargetStep(content),
			validate: () => this._validateTargetStep(),
		});

		const analysis = this._analyzeLevels();
		if (analysis.length === 0) return;

		// Step 2: Subclass Selection (if any class needs one)
		const subclassLevels = analysis.filter(a => a.needsSubclass);
		if (subclassLevels.length > 0) {
			this._steps.push({
				id: "subclass",
				label: "Subclass",
				icon: "📚",
				required: true,
				data: subclassLevels,
				render: (content) => this._renderSubclassStep(content, subclassLevels),
				validate: () => this._validateSubclassStep(subclassLevels),
			});
		}

		// Step 3: ASI / Feat Selection (if any level grants ASI)
		const asiLevels = analysis.filter(a => a.hasAsi);
		if (asiLevels.length > 0) {
			this._steps.push({
				id: "asi",
				label: "ASI / Feats",
				icon: "📈",
				required: true,
				data: asiLevels,
				render: (content) => this._renderAsiStep(content, asiLevels),
				validate: () => this._validateAsiStep(asiLevels),
			});
		}

		// Step 4: Class Options / Optional Features (if any level has them)
		const optFeatLevels = analysis.filter(a => a.optionalFeatureGains.length > 0);
		if (optFeatLevels.length > 0) {
			this._steps.push({
				id: "optfeatures",
				label: "Class Options",
				icon: "✨",
				required: true,
				data: optFeatLevels,
				render: (content) => this._renderOptionalFeaturesStep(content, optFeatLevels),
				validate: () => this._validateOptionalFeaturesStep(optFeatLevels),
			});
		}

		// Step 5: Feature Choices (if any level has embedded options)
		const featureOptionLevels = analysis.filter(a => a.featureOptions.length > 0);
		if (featureOptionLevels.length > 0) {
			this._steps.push({
				id: "featoptions",
				label: "Feature Choices",
				icon: "🎯",
				required: true,
				data: featureOptionLevels,
				render: (content) => this._renderFeatureOptionsStep(content, featureOptionLevels),
				validate: () => this._validateFeatureOptionsStep(featureOptionLevels),
			});
		}

		// Step 5b: Weapon Masteries (if any class gains new mastery slots)
		const masteryInfo = this._getWeaponMasteryGains(analysis);
		if (masteryInfo && masteryInfo.newSlots > 0) {
			this._steps.push({
				id: "weaponmastery",
				label: "Weapon Mastery",
				icon: "⚔️",
				required: true,
				data: masteryInfo,
				render: (content) => this._renderWeaponMasteryStep(content, masteryInfo),
				validate: () => this._validateWeaponMasteryStep(masteryInfo),
			});
		}

		// Step 6: Expertise & Languages (if any level has them)
		const expertiseLevels = analysis.filter(a => a.expertiseGrants.length > 0);
		const languageLevels = analysis.filter(a => a.languageGrants.length > 0);
		const scholarLevel = analysis.find(a => a.isScholarLevel);
		if (expertiseLevels.length > 0 || languageLevels.length > 0 || scholarLevel) {
			this._steps.push({
				id: "expertise",
				label: "Expertise",
				icon: "⭐",
				required: true,
				data: {expertiseLevels, languageLevels, scholarLevel},
				render: (content) => this._renderExpertiseStep(content, {expertiseLevels, languageLevels, scholarLevel}),
				validate: () => this._validateExpertiseStep({expertiseLevels, languageLevels, scholarLevel}),
			});
		}

		// Step 7: Spells (if any class is a spellcaster or wizard with spellbook)
		const hasSpellcasting = analysis.some(a => {
			const ability = CharacterSheetClassUtils.getSpellcastingAbility(a.classData);
			return !!ability;
		});
		const spellbookLevels = analysis.filter(a => a.isSpellbookLevel);

		// Aggregate known-spell gains across all levels for this QB
		const knownCasterLevels = analysis.filter(a => a.isKnownCaster && (a.knownSpellsGainAtLevel > 0 || a.knownCantripsGainAtLevel > 0));
		let totalKnownSpellsGain = 0;
		let totalKnownCantripsGain = 0;
		let knownMaxSpellLevel = 0;
		let knownCasterClassName = null;
		let knownCasterClassSource = null;
		for (const a of knownCasterLevels) {
			totalKnownSpellsGain += a.knownSpellsGainAtLevel;
			totalKnownCantripsGain += a.knownCantripsGainAtLevel;
			knownMaxSpellLevel = Math.max(knownMaxSpellLevel, a.knownMaxSpellLevel);
			knownCasterClassName = a.className;
			knownCasterClassSource = a.classSource;
		}
		// Resolve subclass for the known caster to support features like Divine Soul
		let knownCasterSubclass = null;
		let knownCasterSubclassChoice = null;
		if (knownCasterClassName) {
			const subclassKey = `${knownCasterClassName}_${knownCasterClassSource}`;
			const sub = this._selections.subclasses[subclassKey] || this._getSubclassForClass(knownCasterClassName, knownCasterClassSource, 0);
			knownCasterSubclass = sub || null;
			knownCasterSubclassChoice = this._selections.subclassChoices[subclassKey] || null;
			// Also check existing character state
			if (!knownCasterSubclass) {
				const existing = this._state.getClasses().find(c => c.name === knownCasterClassName && c.source === knownCasterClassSource);
				knownCasterSubclass = existing?.subclass || null;
				knownCasterSubclassChoice = knownCasterSubclassChoice || existing?.subclassChoice || null;
			}
		}
		const knownCasterInfo = totalKnownSpellsGain > 0 || totalKnownCantripsGain > 0 ? {
			className: knownCasterClassName,
			classSource: knownCasterClassSource,
			subclass: knownCasterSubclass,
			subclassChoice: knownCasterSubclassChoice,
			totalSpells: totalKnownSpellsGain,
			totalCantrips: totalKnownCantripsGain,
			maxSpellLevel: knownMaxSpellLevel,
			levelBreakdown: knownCasterLevels.map(a => ({
				level: a.classLevel,
				spellsGain: a.knownSpellsGainAtLevel,
				cantripsGain: a.knownCantripsGainAtLevel,
			})),
		} : null;

		// Aggregate prepared-spell gains across all levels (XPHB Warlock, etc.)
		const preparedCasterLevels = analysis.filter(a => a.isPreparedCaster && (a.preparedSpellsGainAtLevel > 0 || a.preparedCantripsGainAtLevel > 0));
		let totalPreparedSpellsGain = 0;
		let totalPreparedCantripsGain = 0;
		let preparedMaxSpellLevel = 0;
		let preparedCasterClassName = null;
		let preparedCasterClassSource = null;
		for (const a of preparedCasterLevels) {
			totalPreparedSpellsGain += a.preparedSpellsGainAtLevel;
			totalPreparedCantripsGain += a.preparedCantripsGainAtLevel;
			preparedMaxSpellLevel = Math.max(preparedMaxSpellLevel, a.preparedMaxSpellLevel);
			preparedCasterClassName = a.className;
			preparedCasterClassSource = a.classSource;
		}
		const preparedCasterInfo = totalPreparedSpellsGain > 0 || totalPreparedCantripsGain > 0 ? {
			className: preparedCasterClassName,
			classSource: preparedCasterClassSource,
			totalSpells: totalPreparedSpellsGain,
			totalCantrips: totalPreparedCantripsGain,
			maxSpellLevel: preparedMaxSpellLevel,
		} : null;

		if (hasSpellcasting || spellbookLevels.length > 0 || knownCasterInfo || preparedCasterInfo) {
			this._steps.push({
				id: "spells",
				label: "Spells",
				icon: "🔮",
				required: true,
				data: {hasSpellcasting, spellbookLevels, knownCasterInfo, preparedCasterInfo},
				render: (content) => this._renderSpellsStep(content, {hasSpellcasting, spellbookLevels, knownCasterInfo, preparedCasterInfo}),
				validate: () => this._validateSpellsStep({hasSpellcasting, spellbookLevels, knownCasterInfo, preparedCasterInfo}),
			});
		}

		// Step 8: HP & Hit Dice (always shown)
		this._steps.push({
			id: "hp",
			label: "Hit Points",
			icon: "❤️",
			required: true,
			render: (content) => this._renderHpStep(content),
			validate: () => this._validateHpStep(),
		});

		// Step 9: Review & Confirm (always shown)
		this._steps.push({
			id: "review",
			label: "Review",
			icon: "✅",
			required: false,
			render: (content) => this._renderReviewStep(content),
			validate: () => true,
		});
	}

	// ==========================================
	// Wizard UI (Full-Screen Overlay)
	// ==========================================

	async _showWizard () {
		this._isActive = true;

		// Build initial steps (just target step; rest built after analysis)
		this._buildWizardSteps();

		// Create overlay
		this._overlay = e_({outer: `
			<div class="charsheet__quickbuild-overlay">
				<div class="charsheet__quickbuild-container">
					<div class="charsheet__quickbuild-header">
						<h3 class="charsheet__quickbuild-title">⚡ Quick Build</h3>
						<button class="ve-btn ve-btn-default ve-btn-xs charsheet__quickbuild-close" title="Cancel">✕</button>
					</div>
					<div class="charsheet__quickbuild-steps" id="quickbuild-steps"></div>
					<div class="charsheet__quickbuild-progress">
						<div class="charsheet__quickbuild-progress-bar">
							<div class="charsheet__quickbuild-progress-fill" id="quickbuild-progress-fill" style="width: 0%"></div>
						</div>
						<div class="charsheet__quickbuild-progress-text" id="quickbuild-progress-text">0% complete</div>
					</div>
					<div class="charsheet__quickbuild-content" id="quickbuild-content"></div>
					<div class="charsheet__quickbuild-nav">
						<button class="ve-btn ve-btn-default" id="quickbuild-prev" disabled>
							<span class="glyphicon glyphicon-chevron-left"></span> Previous
						</button>
						<div class="charsheet__quickbuild-nav-info" id="quickbuild-nav-info"></div>
						<button class="ve-btn ve-btn-primary" id="quickbuild-next">
							Next <span class="glyphicon glyphicon-chevron-right"></span>
						</button>
					</div>
				</div>
			</div>
		`});

		document.body.append(this._overlay);
		document.body.classList.add("has-quickbuild-overlay");

		// Wire events
		this._overlay.querySelector(".charsheet__quickbuild-close").addEventListener("click", () => this._closeWizard());
		this._overlay.querySelector("#quickbuild-prev").addEventListener("click", () => this._prevStep());
		this._overlay.querySelector("#quickbuild-next").addEventListener("click", () => this._nextStep());

		// Escape key closes the wizard
		this._escapeHandler = (e) => { if (e.key === "Escape") this._closeWizard(); };
		document.addEventListener("keydown", this._escapeHandler);

		// Render initial step
		this._renderStepIndicators();
		this._renderCurrentStep();
	}

	async _closeWizard ({force = false} = {}) {
		if (!force && this._currentStep > 0) {
			const confirm = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Close Quick Build?",
				htmlDescription: "<p>You have unsaved progress. Are you sure you want to close?</p>",
				textYes: "Close",
				textNo: "Cancel",
				zIndex: 10000,
			}));
			if (!confirm) return;
		}
		if (this._escapeHandler) {
			document.removeEventListener("keydown", this._escapeHandler);
			this._escapeHandler = null;
		}
		if (this._overlay) {
			this._overlay.remove();
			this._overlay = null;
		}
		document.body.classList.remove("has-quickbuild-overlay");
		this._isActive = false;
	}

	_renderStepIndicators () {
		const stepsContainer = this._overlay.querySelector("#quickbuild-steps");
		stepsContainer.innerHTML = "";

		this._steps.forEach((step, i) => {
			const state = i === this._currentStep ? "active"
				: i < this._currentStep ? "completed"
					: "";
			const stepEl = e_({outer: `
				<div class="charsheet__builder-step ${state}" data-step="${i}">
					<span class="charsheet__builder-step-num">${step.icon || (i + 1)}</span>
					<span class="charsheet__builder-step-label">${step.label}</span>
				</div>
			`});
			stepEl.addEventListener("click", () => {
				if (i <= this._currentStep) this._goToStep(i);
			});
			stepsContainer.append(stepEl);
		});
	}

	_renderCurrentStep () {
		const content = this._overlay.querySelector("#quickbuild-content");
		content.innerHTML = "";

		if (this._currentStep < this._steps.length) {
			this._steps[this._currentStep].render(content);
		}

		// Update progress bar
		const progress = this._steps.length > 1
			? Math.round((this._currentStep / (this._steps.length - 1)) * 100)
			: 100;
		this._overlay.querySelector("#quickbuild-progress-fill").style.width = `${progress}%`;
		this._overlay.querySelector("#quickbuild-progress-text").textContent = `${progress}% complete`;

		// Update nav
		this._overlay.querySelector("#quickbuild-prev").disabled = this._currentStep <= 0;
		const nextBtn = this._overlay.querySelector("#quickbuild-next");
		if (this._currentStep >= this._steps.length - 1) {
			nextBtn.innerHTML = `<span class="glyphicon glyphicon-ok"></span> Build Character`;
			nextBtn.classList.remove("ve-btn-primary");
			nextBtn.classList.add("ve-btn-success");
		} else {
			nextBtn.innerHTML = `Next <span class="glyphicon glyphicon-chevron-right"></span>`;
			nextBtn.classList.remove("ve-btn-success");
			nextBtn.classList.add("ve-btn-primary");
		}

		// Update nav info
		const info = this._overlay.querySelector("#quickbuild-nav-info");
		info.textContent = `Step ${this._currentStep + 1} of ${this._steps.length}`;
	}

	_goToStep (step) {
		this._currentStep = step;
		this._renderStepIndicators();
		this._renderCurrentStep();
	}

	_prevStep () {
		if (this._currentStep > 0) {
			this._goToStep(this._currentStep - 1);
		}
	}

	async _nextStep () {
		const currentStep = this._steps[this._currentStep];
		if (currentStep?.validate && !currentStep.validate()) return;

		// After the Target step, rebuild steps based on analysis
		if (currentStep?.id === "target") {
			this._buildWizardSteps();
			this._renderStepIndicators();
		}

		if (this._currentStep >= this._steps.length - 1) {
			// Final step — apply the build
			await this._applyQuickBuild();
			this._closeWizard({force: true});
		} else {
			this._goToStep(this._currentStep + 1);
		}
	}

	// ==========================================
	// Step 1: Target Level & Class Allocation
	// ==========================================

	_renderTargetStep (content) {
		const isExisting = this._fromLevel > 0;
		const classes = this._page.filterByAllowedSources(this._page.getClasses());

		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});

		// Title
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>${isExisting ? "Level Up To..." : "Build Character To Level..."}</h4>
				<p class="ve-muted">Select your target level${isExisting ? ` (currently level ${this._fromLevel})` : ""} and configure your class allocation.</p>
			</div>
		`}));

		// Target level selector
		const levelSection = e_({outer: `<div class="charsheet__quickbuild-section mb-3"></div>`});
		levelSection.append(e_({outer: `<label class="ve-bold mb-1">Target Level</label>`}));
		const levelRow = e_({outer: `<div class="ve-flex-v-center gap-3"></div>`});

		const minLevel = this._fromLevel + 1;
		const levelSlider = e_({outer: `<input type="range" class="form-control-range" min="${minLevel}" max="20" value="${this._targetLevel}" style="flex: 1;">`});
		const levelDisplay = e_({outer: `<span class="charsheet__quickbuild-level-display">${this._targetLevel}</span>`});
		const levelInput = e_({outer: `<input type="number" class="ve-form-control ve-input-sm" style="max-width: 70px;" min="${minLevel}" max="20" value="${this._targetLevel}">`});

		levelSlider.addEventListener("input", () => {
			const val = parseInt(levelSlider.value);
			this._targetLevel = val;
			levelDisplay.textContent = val;
			levelInput.value = val;
			this._updateClassAllocations();
			renderAllocations();
		});

		levelInput.addEventListener("change", () => {
			let val = parseInt(levelInput.value);
			val = Math.max(minLevel, Math.min(20, val || minLevel));
			this._targetLevel = val;
			levelSlider.value = val;
			levelDisplay.textContent = val;
			levelInput.value = val;
			this._updateClassAllocations();
			renderAllocations();
		});

		levelRow.append(levelSlider, levelDisplay, levelInput);
		levelSection.append(levelRow);
		step.append(levelSection);

		// Class allocation section
		const classSection = e_({outer: `<div class="charsheet__quickbuild-section mb-3"></div>`});
		classSection.append(e_({outer: `<label class="ve-bold mb-1">Class Allocation</label>`}));
		const allocations = e_({outer: `<div id="quickbuild-class-allocations"></div>`});
		classSection.append(allocations);

		// Add class button (for multiclass)
		const addClassBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mt-2"><span class="glyphicon glyphicon-plus"></span> Add Class (Multiclass)</button>`});
		addClassBtn.addEventListener("click", () => {
			this._showAddClassModal(classes, () => {
				renderAllocations();
			});
		});

		// Only show add-class if total allocated < 20 and not at target
		if (this._targetLevel < 20) {
			classSection.append(addClassBtn);
		}

		step.append(classSection);

		// Level summary
		const summary = e_({outer: `<div class="charsheet__quickbuild-section" id="quickbuild-target-summary"></div>`});
		step.append(summary);

		const renderAllocations = () => {
			allocations.innerHTML = "";
			const totalAllocated = this._classAllocations.reduce((sum, a) => sum + (a.targetLevel - (a.currentLevel || 0)), 0);
			const totalNeeded = this._targetLevel - this._fromLevel;

			this._classAllocations.forEach((alloc, idx) => {
				const levelsToGain = alloc.targetLevel - (alloc.currentLevel || 0);
				const row = e_({outer: `
					<div class="charsheet__quickbuild-class-row ve-flex-v-center gap-2 mb-2 p-2" style="border: 1px solid var(--cs-border, #ddd); border-radius: 8px;">
						<div class="ve-flex-1">
							<strong>${alloc.className}</strong>
							<span class="ve-muted ve-small">(${Parser.sourceJsonToAbv(alloc.classSource)})</span>
							${alloc.currentLevel > 0 ? `<span class="ve-muted"> — currently Lv${alloc.currentLevel}</span>` : ""}
						</div>
						<div class="ve-flex-v-center gap-2">
							<label class="ve-small ve-muted mb-0">Target Lv:</label>
							<input type="number" class="ve-form-control ve-input-sm"
								style="max-width: 60px;"
								min="${alloc.currentLevel || 1}" max="20"
								value="${alloc.targetLevel}">
						</div>
						${this._classAllocations.length > 1 && !alloc.currentLevel
		? `<button class="ve-btn ve-btn-xs ve-btn-danger" title="Remove class"><span class="glyphicon glyphicon-trash"></span></button>`
		: ""}
					</div>
				`});

				// Wire level input
				row.querySelector("input[type=number]").addEventListener("change", (e) => {
					let val = parseInt(e.target.value);
					val = Math.max(alloc.currentLevel || 1, Math.min(20, val || 1));
					alloc.targetLevel = val;
					e.target.value = val;
					renderSummary();
				});

				// Wire remove button
				const removeBtn = row.querySelector(".ve-btn-danger");
				if (removeBtn) {
					removeBtn.addEventListener("click", () => {
						this._classAllocations.splice(idx, 1);
						renderAllocations();
					});
				}

				allocations.append(row);
			});

			renderSummary();
		};

		const renderSummary = () => {
			summary.innerHTML = "";

			const totalAllocated = this._classAllocations.reduce((sum, a) => sum + a.targetLevel, 0);
			const totalNew = totalAllocated - this._fromLevel;
			const targetNew = this._targetLevel - this._fromLevel;
			const isValid = totalNew === targetNew && totalAllocated <= 20;

			const summaryContent = e_({outer: `
				<div class="p-2" style="background: ${isValid ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)"}; border-radius: 8px;">
					<strong>${isValid ? "✓" : "⚠"} Summary:</strong>
					Character Level ${this._fromLevel} → ${totalAllocated}
					(${totalNew} level${totalNew !== 1 ? "s" : ""} to gain${targetNew !== totalNew ? `, target: ${targetNew}` : ""})
					${!isValid ? `<br><span class="text-danger ve-small">Level allocation must equal target level (${this._targetLevel})</span>` : ""}
				</div>
			`});
			summary.append(summaryContent);
		};

		renderAllocations();
		content.append(step);
	}

	_updateClassAllocations () {
		// For single class, just update the target level
		if (this._classAllocations.length === 1) {
			this._classAllocations[0].targetLevel = this._targetLevel;
		}
	}

	_showAddClassModal (allClasses, onComplete) {
		// Filter out already-selected classes
		const existingNames = new Set(this._classAllocations.map(a => `${a.className}_${a.classSource}`));
		const available = allClasses.filter(c => !existingNames.has(`${c.name}_${c.source}`));

		if (available.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No more classes available to add."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = UiUtil.getShowModal({
			title: "Add Multiclass",
			isMinHeight0: true,
			zIndex: 10001, // Above quickbuild overlay (z-index: 9999)
		});

		const search = e_({outer: `<input type="text" class="ve-form-control mb-2" placeholder="Search classes...">`});
		const list = e_({outer: `<div style="max-height: 300px; overflow-y: auto;"></div>`});

		const renderList = (filter = "") => {
			list.innerHTML = "";
			const filterLower = filter.toLowerCase();
			available
				.filter(c => !filter || c.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.forEach(cls => {
					const item = e_({outer: `
						<div class="charsheet__builder-list-item" style="cursor: pointer;">
							<span class="charsheet__builder-list-item-name">${cls.name}</span>
							<span class="charsheet__builder-list-item-source">${Parser.sourceJsonToAbv(cls.source)}</span>
						</div>
					`});
					item.addEventListener("click", () => {
						this._classAllocations.push({
							className: cls.name,
							classSource: cls.source,
							classData: cls,
							currentLevel: 0,
							targetLevel: 1,
							subclass: null,
						});
						doClose(true);
						onComplete();
					});
					list.append(item);
				});
		};

		const renderListDebounced = MiscUtil.debounce(() => renderList(search.value), 100);
		search.addEventListener("input", renderListDebounced);
		renderList();

		modalInner.append(search, list);
	}

	_validateTargetStep () {
		const totalAllocated = this._classAllocations.reduce((sum, a) => sum + a.targetLevel, 0);
		const targetNew = this._targetLevel - this._fromLevel;
		const totalNew = totalAllocated - this._fromLevel;

		if (totalAllocated > 20) {
			JqueryUtil.doToast({type: "warning", content: "Total allocated levels cannot exceed 20."});
			return false;
		}

		if (totalNew !== targetNew) {
			JqueryUtil.doToast({type: "warning", content: `Class allocation levels must add up to target level ${this._targetLevel}.`});
			return false;
		}

		if (this._classAllocations.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "You must have at least one class."});
			return false;
		}

		// Resolve class data
		this._resolveClassData();
		return true;
	}

	// ==========================================
	// Step 2: Subclass Selection
	// ==========================================

	_renderSubclassStep (content, subclassLevels) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Choose Subclass${subclassLevels.length > 1 ? "es" : ""}</h4>
				<p class="ve-muted">Select a subclass for each class that requires one.</p>
			</div>
		`}));

		subclassLevels.forEach(analysis => {
			const {classData, className, classSource, classLevel} = analysis;
			const key = `${className}_${classSource}`;
			const subclassTitle = classData.subclassTitle || "Subclass";

			const section = e_({outer: `
				<div class="charsheet__quickbuild-section mb-3">
					<h5>${className} — ${subclassTitle} (Level ${classLevel})</h5>
				</div>
			`});

			// Get available subclasses - filter by allowed sources
			const allSubclasses = (classData.subclasses || [])
				.filter(sc => this._page.filterByAllowedSources([sc]).length > 0);

			if (allSubclasses.length === 0) {
				section.append(e_({outer: `<p class="ve-muted">No subclasses available for this class with current source settings.</p>`}));
			} else {
				// Group subclasses by source affinity
				const primarySubclasses = allSubclasses.filter(sc => {
					const scClassSource = sc.classSource || Parser.SRC_PHB;
					return scClassSource === classSource
						|| ([Parser.SRC_PHB, Parser.SRC_XPHB].includes(scClassSource)
							&& [Parser.SRC_PHB, Parser.SRC_XPHB].includes(classSource));
				}).sort((a, b) => a.name.localeCompare(b.name));

				const secondarySubclasses = allSubclasses.filter(sc => {
					const scClassSource = sc.classSource || Parser.SRC_PHB;
					if (scClassSource === classSource) return false;
					if ([Parser.SRC_PHB, Parser.SRC_XPHB].includes(scClassSource)
						&& [Parser.SRC_PHB, Parser.SRC_XPHB].includes(classSource)) return false;
					return true;
				}).sort((a, b) => a.name.localeCompare(b.name));

				// Build source filter options
				const availableSources = [...new Set(allSubclasses.map(sc => sc.source))].sort();
				const filterRow = e_({outer: `<div class="ve-flex gap-2 mb-2"></div>`});
				const search = e_({outer: `<input type="text" class="ve-form-control ve-input-sm ve-flex-grow" placeholder="Search ${subclassTitle.toLowerCase()}s...">`});
				const sourceFilter = e_({outer: `
					<select class="ve-form-control ve-input-sm" style="width: auto; min-width: 100px;">
						<option value="">All Sources</option>
						${availableSources.map(src => `<option value="${src}">${Parser.sourceJsonToAbv(src)}</option>`).join("")}
					</select>
				`});
				filterRow.append(search, sourceFilter);

				const list = e_({outer: `<div class="charsheet__quickbuild-subclass-list" style="max-height: 350px; overflow-y: auto;"></div>`});

				let selectedSource = "";

				const renderSubclassItem = (sc) => {
					const isSelected = this._selections.subclasses[key]?.name === sc.name
						&& this._selections.subclasses[key]?.source === sc.source;
					const item = e_({outer: `
						<div class="charsheet__quickbuild-option ${isSelected ? "selected" : ""}">
							<div class="ve-flex-v-center">
								<input type="radio" name="qb-subclass-${key}" ${isSelected ? "checked" : ""}>
								<span class="subclass-name-link ml-2"></span>
								<span class="ve-muted ve-small ml-2">(${Parser.sourceJsonToAbv(sc.source)})</span>
							</div>
							${sc.shortName && sc.shortName !== sc.name ? `<div class="ve-muted ve-small ml-4">${sc.shortName}</div>` : ""}
						</div>
					`});
					// Add hoverable subclass link
					const subclassLink = CharacterSheetPage.getSubclassHoverLink(sc);
					const nameSpan = item.querySelector(".subclass-name-link");
					if (typeof subclassLink === "string") nameSpan.innerHTML = subclassLink;
					else nameSpan.append(subclassLink);
					item.addEventListener("click", async () => {
						let subclassChoice = null;
						if (CharacterSheetClassUtils.isDivineSoulSubclass(sc)) {
							const affinityOptions = CharacterSheetClassUtils.getDivineSoulAffinityOptions(sc);
							subclassChoice = await InputUiUtil.pGetUserEnum({
								title: "Divine Soul Affinity",
								values: affinityOptions,
								fnDisplay: opt => opt.name,
								isResolveItem: true,
								zIndex: 10002,
								htmlDescription: "<div>Choose the Divine Soul affinity that grants your extra spell and Cleric spell access.</div>",
							});
							if (!subclassChoice) return;
						}

						list.querySelectorAll(".charsheet__quickbuild-option").forEach(el => el.classList.remove("selected"));
						list.querySelectorAll("input[type=radio]").forEach(el => { el.checked = false; });
						item.classList.add("selected");
						item.querySelector("input[type=radio]").checked = true;
						this._selections.subclasses[key] = sc;
						this._selections.subclassChoices[key] = CharacterSheetClassUtils.normalizeDivineSoulAffinity(subclassChoice);
					});
					return item;
				};

				// Track collapse states
				let primaryCollapsed = false;
				let secondaryCollapsed = true; // Start collapsed

				const renderList = (textFilter = "") => {
					list.innerHTML = "";
					const filterLower = textFilter.toLowerCase();

					const filterSubclasses = (scs) => scs.filter(sc => {
						if (selectedSource && sc.source !== selectedSource) return false;
						if (!textFilter) return true;
						return sc.name.toLowerCase().includes(filterLower)
							|| (sc.shortName && sc.shortName.toLowerCase().includes(filterLower));
					});

					const filteredPrimary = filterSubclasses(primarySubclasses);
					const filteredSecondary = filterSubclasses(secondarySubclasses);

					if (filteredPrimary.length === 0 && filteredSecondary.length === 0) {
						list.append(e_({outer: `<p class="ve-muted text-center py-2">No matching ${subclassTitle.toLowerCase()}s</p>`}));
						return;
					}

					// Render primary subclasses (matching class source)
					if (filteredPrimary.length > 0) {
						const primaryHeader = e_({outer: `
							<div class="ve-flex-v-center py-2 px-3 mb-2 clickable" 
								style="background: linear-gradient(135deg, rgba(66, 153, 225, 0.15) 0%, rgba(66, 153, 225, 0.05) 100%); border: 1px solid rgba(66, 153, 225, 0.3); border-radius: 6px; user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
								<span class="mr-2" style="transition: transform 0.2s; font-size: 0.9em;">▶</span>
								<span class="ve-bold" style="color: var(--rgb-name-blue);">🎯 ${Parser.sourceJsonToAbv(classSource)} ${subclassTitle}s</span>
								<span class="badge badge-primary ml-auto" style="font-size: 0.75em;">${filteredPrimary.length}</span>
							</div>
						`});
						const primaryContent = e_({outer: `<div class="mb-3 pl-2" style="border-left: 3px solid rgba(66, 153, 225, 0.3);"></div>`});
						filteredPrimary.forEach(sc => primaryContent.append(renderSubclassItem(sc)));

						primaryHeader.addEventListener("click", () => {
							primaryCollapsed = !primaryCollapsed;
							primaryHeader.querySelector("span:first-child").style.transform = primaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
							primaryContent.style.display = primaryCollapsed ? "none" : "";
						});

						// Apply initial state
						primaryHeader.querySelector("span:first-child").style.transform = primaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
						primaryContent.style.display = primaryCollapsed ? "none" : "";

						list.append(primaryHeader, primaryContent);
					}

					// Render secondary subclasses (other sources)
					if (filteredSecondary.length > 0) {
						const secondaryHeader = e_({outer: `
							<div class="ve-flex-v-center py-2 px-3 mb-2 clickable" 
								style="background: linear-gradient(135deg, rgba(128, 128, 128, 0.1) 0%, rgba(128, 128, 128, 0.03) 100%); border: 1px solid rgba(128, 128, 128, 0.2); border-radius: 6px; user-select: none;">
								<span class="mr-2" style="transition: transform 0.2s; font-size: 0.9em;">▶</span>
								<span class="ve-bold ve-muted">📚 Other ${subclassTitle}s</span>
								<span class="badge badge-secondary ml-auto" style="font-size: 0.75em;">${filteredSecondary.length}</span>
							</div>
						`});
						const secondaryContent = e_({outer: `<div class="mb-2 pl-2" style="border-left: 3px solid rgba(128, 128, 128, 0.2);"></div>`});
						filteredSecondary.forEach(sc => secondaryContent.append(renderSubclassItem(sc)));

						secondaryHeader.addEventListener("click", () => {
							secondaryCollapsed = !secondaryCollapsed;
							secondaryHeader.querySelector("span:first-child").style.transform = secondaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
							secondaryContent.style.display = secondaryCollapsed ? "none" : "";
						});

						// Apply initial state
						secondaryHeader.querySelector("span:first-child").style.transform = secondaryCollapsed ? "rotate(0deg)" : "rotate(90deg)";
						secondaryContent.style.display = secondaryCollapsed ? "none" : "";

						list.append(secondaryHeader, secondaryContent);
					}
				};

				const renderListDebounced = MiscUtil.debounce(() => renderList(search.value), 100);
				search.addEventListener("input", renderListDebounced);
				sourceFilter.addEventListener("change", () => {
					selectedSource = sourceFilter.value;
					renderList(search.value);
				});
				renderList();

				section.append(filterRow, list);
			}

			step.append(section);
		});

		content.append(step);
	}

	_validateSubclassStep (subclassLevels) {
		for (const analysis of subclassLevels) {
			const key = `${analysis.className}_${analysis.classSource}`;
			if (!this._selections.subclasses[key]) {
				JqueryUtil.doToast({type: "warning", content: `Please select a subclass for ${analysis.className}.`});
				return false;
			}
		}
		return true;
	}

	// ==========================================
	// Step 3: ASI / Feat Selection
	// ==========================================

	_renderAsiStep (content, asiLevels) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});

		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Ability Score Improvements & Feats</h4>
				<p class="ve-muted">${asiLevels.length} ASI level${asiLevels.length > 1 ? "s" : ""} to configure. Each grants +2 ability score points or a feat.</p>
			</div>
		`}));

		// Collect section containers for re-rendering when earlier ASI choices change
		const sectionRenderers = [];

		const computeRunningScores = (upToIdx) => {
			const scores = {};
			Parser.ABIL_ABVS.forEach(abl => {
				scores[abl] = this._state.getAbilityScore(abl);
			});
			for (let i = 0; i < upToIdx; i++) {
				const prevKey = `${asiLevels[i].className}_${asiLevels[i].classLevel}`;
				const prevSel = this._selections.asi[prevKey];
				if (!prevSel) continue;

				if (prevSel.mode === "asi" || prevSel.isBoth) {
					for (const [abl, inc] of Object.entries(prevSel.abilityChoices || {})) {
						scores[abl] = (scores[abl] || 0) + inc;
					}
				}

				if ((prevSel.mode === "feat" || prevSel.isBoth) && prevSel.feat && prevSel.featChoices?.ability) {
					const amount = this._getFeatAbilityAmount(prevSel.feat);
					if (amount > 0) {
						scores[prevSel.featChoices.ability] = (scores[prevSel.featChoices.ability] || 0) + amount;
					}
				}
			}
			return scores;
		};

		const reRenderFrom = (startIdx) => {
			for (let i = startIdx; i < sectionRenderers.length; i++) {
				sectionRenderers[i]();
			}
		};

		asiLevels.forEach((analysis, idx) => {
			const {characterLevel, className, classLevel, classData} = analysis;
			const levelKey = `${className}_${classLevel}`;
			// Thelemar rule fires at CHARACTER level 4 (matters for multiclass).
			const isBoth = this._state.shouldGrantBothAsiAndFeat(characterLevel);
			const isEpicBoon = classLevel === 19;

			if (!this._selections.asi[levelKey]) {
				this._selections.asi[levelKey] = {
					mode: "asi",
					abilityChoices: {},
					feat: null,
					isBoth,
				};
			}
			const sel = this._selections.asi[levelKey];

			const section = e_({outer: `
				<div class="charsheet__quickbuild-section mb-3">
					<h5>${className} Level ${classLevel} — ${isEpicBoon ? "Epic Boon" : "ASI / Feat"}
						${isBoth ? ` <span class="badge badge-info">ASI + Feat</span>` : ""}
					</h5>
				</div>
			`});

			if (isBoth) {
				section.append(e_({outer: `<p class="ve-small text-info">At level 4, you gain both an Ability Score Improvement and a Feat!</p>`}));
			}

			// Mode toggle (ASI vs Feat) — not shown for isBoth
			const modeRow = e_({outer: `<div class="ve-flex-v-center gap-2 mb-2"></div>`});
			if (!isBoth) {
				const asiRadio = e_({outer: `<label class="ve-flex-v-center gap-1"><input type="radio" name="qb-asi-mode-${levelKey}" value="asi" ${sel.mode === "asi" ? "checked" : ""}> Increase Ability Scores (+2 total)</label>`});
				const featRadio = e_({outer: `<label class="ve-flex-v-center gap-1"><input type="radio" name="qb-asi-mode-${levelKey}" value="feat" ${sel.mode === "feat" ? "checked" : ""}> Take a ${isEpicBoon ? "Boon" : "Feat"}</label>`});

				asiRadio.querySelector("input").addEventListener("change", () => { sel.mode = "asi"; renderAsiContent(); reRenderFrom(idx + 1); });
				featRadio.querySelector("input").addEventListener("change", () => { sel.mode = "feat"; renderAsiContent(); reRenderFrom(idx + 1); });

				modeRow.append(asiRadio, featRadio);
			}
			section.append(modeRow);

			const asiContent = e_({outer: `<div class="charsheet__quickbuild-asi-content"></div>`});
			section.append(asiContent);

			const renderAsiContent = () => {
				asiContent.innerHTML = "";
				const runningScores = computeRunningScores(idx);

				if (isBoth || sel.mode === "asi") {
					// For isBoth mode: ASI changes should re-render the feat section within
					// the same level (so feat ability buttons show updated scores), then cascade
					const onAsiChanged = isBoth
						? () => { renderAsiContent(); reRenderFrom(idx + 1); }
						: () => reRenderFrom(idx + 1);
					const asiControls = this._renderAsiControls(levelKey, sel, runningScores, onAsiChanged);
					asiContent.append(asiControls);
				}

				if (isBoth || sel.mode === "feat") {
					// For isBoth mode: pass running scores that include current level's ASI choices,
					// so feat ability buttons reflect ASI increases at this level
					const featScores = isBoth ? this._computeRunningScoresWithCurrentASI(runningScores, sel) : runningScores;
					const onFeatAbilityChanged = isBoth
						? () => { renderAsiContent(); reRenderFrom(idx + 1); }
						: null;
					const featSelect = this._renderFeatSelector(levelKey, sel, isEpicBoon, featScores, onFeatAbilityChanged);
					asiContent.append(featSelect);
				}
			};

			sectionRenderers.push(renderAsiContent);
			renderAsiContent();
			step.append(section);
		});

		content.append(step);
	}

	/**
	 * Compute running scores that include the current level's ASI choices.
	 * Used in isBoth mode so the feat ability buttons reflect ASI increases at this level.
	 */
	_computeRunningScoresWithCurrentASI (runningScores, sel) {
		const scores = {...runningScores};
		if (sel.abilityChoices) {
			for (const [abl, inc] of Object.entries(sel.abilityChoices)) {
				scores[abl] = (scores[abl] || 0) + inc;
			}
		}
		return scores;
	}

	_renderAsiControls (levelKey, sel, runningScores, onChanged) {
		const container = e_({outer: `<div class="charsheet__quickbuild-asi-controls mb-2"></div>`});
		container.append(e_({outer: `<label class="ve-bold ve-small">Ability Score Increases (+2 total)</label>`}));

		let pointsRemaining = 2;
		const tempChoices = {...(sel.abilityChoices || {})};
		Object.values(tempChoices).forEach(v => { pointsRemaining -= v; });

		const points = e_({outer: `<div class="ve-small mb-1">Points remaining: <strong id="qb-asi-points-${levelKey}">${pointsRemaining}</strong></div>`});
		container.append(points);

		const grid = e_({outer: `<div class="charsheet__quickbuild-asi-grid"></div>`});
		Parser.ABIL_ABVS.forEach(abl => {
			const currentBase = runningScores[abl];
			const increase = tempChoices[abl] || 0;

			const row = e_({outer: `
				<div class="charsheet__levelup-asi-row">
					<span class="charsheet__levelup-asi-name">${Parser.attAbvToFull(abl)}</span>
					<span class="charsheet__levelup-asi-current">${currentBase}</span>
					<button class="ve-btn ve-btn-xs ve-btn-default qb-asi-minus" data-abl="${abl}">−</button>
					<span class="charsheet__levelup-asi-bonus qb-asi-val">+${increase}</span>
					<button class="ve-btn ve-btn-xs ve-btn-default qb-asi-plus" data-abl="${abl}">+</button>
					<span class="charsheet__levelup-asi-new">→ ${currentBase + increase}</span>
				</div>
			`});

			row.querySelector(".qb-asi-plus").addEventListener("click", () => {
				const currentIncrease = tempChoices[abl] || 0;
				if (pointsRemaining <= 0) return;
				if (currentIncrease >= 2) return;
				if (runningScores[abl] + currentIncrease + 1 > 20) return;

				tempChoices[abl] = currentIncrease + 1;
				sel.abilityChoices = {...tempChoices};
				pointsRemaining--;
				container.replaceWith(this._renderAsiControls(levelKey, sel, runningScores, onChanged));
				if (onChanged) onChanged();
			});

			row.querySelector(".qb-asi-minus").addEventListener("click", () => {
				const currentIncrease = tempChoices[abl] || 0;
				if (currentIncrease <= 0) return;

				tempChoices[abl] = currentIncrease - 1;
				if (tempChoices[abl] === 0) delete tempChoices[abl];
				sel.abilityChoices = {...tempChoices};
				pointsRemaining++;
				container.replaceWith(this._renderAsiControls(levelKey, sel, runningScores, onChanged));
				if (onChanged) onChanged();
			});

			grid.append(row);
		});

		container.append(grid);
		return container;
	}

	_renderFeatSelector (levelKey, sel, isEpicBoon, runningScores = null, onFeatAbilityChanged = null) {
		const container = e_({outer: `<div class="charsheet__quickbuild-feat-select mb-2"></div>`});
		container.append(e_({outer: `<label class="ve-bold ve-small">${isEpicBoon ? "Epic Boon" : "Feat"} Selection</label>`}));

		let feats = this._page.filterByAllowedSources(this._page.getFeats() || []);
		if (isEpicBoon) {
			feats = feats.filter(f => f.category === "EB");
		} else {
			feats = feats.filter(f => f.category !== "EB");
		}

		if (!sel.featChoices) {
			sel.featChoices = {skills: [], languages: [], tools: [], ability: null, expertise: [], spellList: null, cantrips: [], spells: []};
		}

		const search = e_({outer: `<input type="text" class="ve-form-control ve-input-sm mb-1" placeholder="Search ${isEpicBoon ? "boons" : "feats"}...">`});
		const list = e_({outer: `<div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--cs-border, #ddd); border-radius: 8px;"></div>`});
		const choicesContainer = e_({outer: `<div class="charsheet__quickbuild-feat-choices mt-2"></div>`});

		// Helper to detect if feat has choices
		const getFeatChoices = (feat) => {
			const choices = {skills: null, languages: null, tools: null, ability: null, expertise: null, spells: null};

			// Check skill choices
			if (feat.skillProficiencies) {
				for (const sp of feat.skillProficiencies) {
					if (sp.choose) {
						choices.skills = {
							count: sp.choose.count || 1,
							from: sp.choose.from || Object.keys(Parser.SKILL_TO_ATB_ABV),
						};
						break;
					}
					if (sp.any) {
						choices.skills = {
							count: sp.any,
							from: Object.keys(Parser.SKILL_TO_ATB_ABV),
						};
						break;
					}
				}
			}

			// Check language choices
			if (feat.languageProficiencies) {
				for (const lp of feat.languageProficiencies) {
					if (lp.anyStandard) {
						choices.languages = {count: lp.anyStandard, type: "standard"};
						break;
					}
					if (lp.any) {
						choices.languages = {count: lp.any, type: "any"};
						break;
					}
					if (lp.choose) {
						choices.languages = {count: lp.choose.count || 1, from: lp.choose.from};
						break;
					}
				}
			}

			// Check tool choices
			if (feat.toolProficiencies) {
				for (const tp of feat.toolProficiencies) {
					if (tp.choose) {
						choices.tools = {count: tp.choose.count || 1, from: tp.choose.from, type: "choose"};
						break;
					}
					if (tp.any) {
						choices.tools = {count: tp.any, type: "any"};
						break;
					}
					if (tp.anyArtisansTool) {
						choices.tools = {count: tp.anyArtisansTool, type: "artisan"};
						break;
					}
				}
			}

			// Check expertise choices
			if (feat.expertise) {
				for (const exp of feat.expertise) {
					if (exp.anyProficientSkill) {
						choices.expertise = {count: exp.anyProficientSkill, type: "proficient"};
						break;
					}
					if (exp.choose) {
						choices.expertise = {count: exp.choose.count || 1, from: exp.choose.from};
						break;
					}
				}
			}

			// Check ability choices
			if (feat.ability) {
				for (const ab of feat.ability) {
					if (ab.choose) {
						choices.ability = {
							count: ab.choose.count || 1,
							amount: ab.choose.amount || 1,
							from: ab.choose.from || Parser.ABIL_ABVS,
						};
						break;
					}
				}
			}

			// Check spell choices (from additionalSpells)
			if (feat.additionalSpells) {
				choices.spells = {lists: [], cantrips: null, spells: null};

				// Check for named spell list options (Magic Initiate style)
				const namedLists = feat.additionalSpells.filter(as => as.name);
				if (namedLists.length > 1) {
					choices.spells.lists = namedLists.map(as => ({
						name: as.name,
						ability: as.ability,
					}));
				}

				// Parse the first (or only) spell list for cantrip/spell counts
				const spellList = feat.additionalSpells[0];
				if (spellList) {
					// Check for cantrip choices in 'known' block
					if (spellList.known) {
						const levelKey = Object.keys(spellList.known).find(k => k === "_" || !isNaN(/** @type {*} */ (k)));
						const spellsAtLevel = levelKey ? spellList.known[levelKey] : null;
						if (Array.isArray(spellsAtLevel)) {
							spellsAtLevel.forEach(sp => {
								if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
									const filter = sp.choose;
									if (filter.includes("level=0") || filter.includes("level=cantrip")) {
										choices.spells.cantrips = {count: sp.count || 1, filter};
									} else {
										choices.spells.spells = {count: sp.count || 1, filter, known: true};
									}
								}
							});
						}
					}
					// Check for spell choices in 'innate' block (recursively handle nested structures)
					if (spellList.innate) {
						const parseInnateSpellChoices = (block, isDaily = false) => {
							if (Array.isArray(block)) {
								block.forEach(sp => {
									if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
										const filter = sp.choose;
										if (filter.includes("level=0") || filter.includes("level=cantrip")) {
											choices.spells.cantrips = {count: sp.count || 1, filter};
										} else {
											choices.spells.spells = {count: sp.count || 1, filter: sp.choose, innate: true, daily: isDaily};
										}
									}
								});
							} else if (typeof block === "object" && block !== null) {
								Object.entries(block).forEach(([key, v]) => {
									parseInnateSpellChoices(v, key === "daily" || isDaily);
								});
							}
						};
						parseInnateSpellChoices(spellList.innate);
					}
					// Check for spell choices in 'prepared' block (recursively handle nested structures)
					if (spellList.prepared) {
						const parseSpellChoicesFromBlock = (block) => {
							if (Array.isArray(block)) {
								block.forEach(sp => {
									if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
										const filter = sp.choose;
										if (filter.includes("level=0") || filter.includes("level=cantrip")) {
											choices.spells.cantrips = {count: sp.count || 1, filter};
										} else {
											choices.spells.spells = {count: sp.count || 1, filter: sp.choose, prepared: true};
										}
									}
								});
							} else if (typeof block === "object" && block !== null) {
								Object.values(block).forEach(v => parseSpellChoicesFromBlock(v));
							}
						};
						parseSpellChoicesFromBlock(spellList.prepared);
					}
				}

				// Clean up if no actual choices found
				if (!choices.spells.lists.length && !choices.spells.cantrips && !choices.spells.spells) {
					choices.spells = null;
				}
			}

			return choices;
		};

		// Render choices UI for selected feat
		const renderFeatChoices = () => {
			choicesContainer.innerHTML = "";
			if (!sel.feat) return;

			const choices = getFeatChoices(sel.feat);
			const hasChoices = choices.skills || choices.languages || choices.tools || choices.ability || choices.expertise || choices.spells;
			if (!hasChoices) return;

			choicesContainer.append(e_({outer: `<div class="ve-small ve-bold mb-1">Additional Choices for ${sel.feat.name}:</div>`}));

			// Spell list selection (for feats like Magic Initiate)
			if (choices.spells?.lists?.length > 1) {
				const listSection = e_({outer: `<div class="mb-2"></div>`});
				listSection.append(e_({outer: `<label class="ve-small">Choose spell list:</label>`}));
				const select = e_({outer: `<select class="ve-form-control ve-input-sm mt-1"></select>`});
				select.append(e_({outer: `<option value="">-- Select --</option>`}));
				choices.spells.lists.forEach(spList => {
					const isSelected = sel.featChoices.spellList === spList.name;
					select.append(e_({outer: `<option value="${spList.name}" ${isSelected ? "selected" : ""}>${spList.name}</option>`}));
				});
				select.addEventListener("change", () => {
					sel.featChoices.spellList = select.value || null;
					sel.featChoices.cantrips = [];
					sel.featChoices.spells = [];
					renderFeatChoices();
				});
				listSection.append(select);
				choicesContainer.append(listSection);
			}

			// Ability score choices
			if (choices.ability) {
				const abilitySection = e_({outer: `<div class="mb-2"></div>`});
				abilitySection.append(e_({outer: `<label class="ve-small">Choose ability to increase by ${choices.ability.amount}:</label>`}));
				const abilityGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

				choices.ability.from.forEach(abl => {
					const isSelected = sel.featChoices.ability === abl;
					const currentScore = runningScores ? runningScores[abl] : this._state.getAbilityScore(abl);
					const amount = choices.ability.amount || 1;
					const cap = choices.ability.max || 20;
					const newScore = Math.min(cap, currentScore + amount);
					const isCapped = currentScore >= cap;

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}" ${isCapped ? `disabled title="Already at maximum (${cap})"` : ""}>
							${Parser.attAbvToFull(abl)} (${currentScore} → ${newScore})
						</button>
					`});

					btn.addEventListener("click", () => {
						if (isCapped) return;
						sel.featChoices.ability = isSelected ? null : abl;
						if (onFeatAbilityChanged) {
							onFeatAbilityChanged();
						} else {
							renderFeatChoices();
						}
					});
					abilityGrid.append(btn);
				});

				abilitySection.append(abilityGrid);
				choicesContainer.append(abilitySection);
			}

			// Skill choices
			if (choices.skills) {
				const skillSection = e_({outer: `<div class="mb-2"></div>`});
				skillSection.append(e_({outer: `<label class="ve-small">Choose ${choices.skills.count} skill${choices.skills.count > 1 ? "s" : ""}:</label>`}));
				const skillGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

				const availableSkills = choices.skills.from.map(s => s.toLowerCase().replace(/\s+/g, ""));
				const existingSkills = new Set(Object.keys(this._state.getSkillProficiencies?.() || {}).map(s => s.toLowerCase()));

				availableSkills.forEach(skill => {
					const isKnown = existingSkills.has(skill);
					const isSelected = sel.featChoices.skills.includes(skill);
					const displayName = skill.replace(/([A-Z])/g, " $1").trim().toTitleCase();

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}" 
							${isKnown ? "disabled title=\"Already proficient\"" : ""} 
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${displayName}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								sel.featChoices.skills = sel.featChoices.skills.filter(s => s !== skill);
							} else if (sel.featChoices.skills.length < choices.skills.count) {
								sel.featChoices.skills.push(skill);
							}
							renderFeatChoices();
						});
					}
					skillGrid.append(btn);
				});

				skillSection.append(skillGrid);
				skillSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.skills.length}/${choices.skills.count}</div>`}));
				choicesContainer.append(skillSection);
			}

			// Tool choices
			if (choices.tools) {
				const toolSection = e_({outer: `<div class="mb-2"></div>`});
				toolSection.append(e_({outer: `<label class="ve-small">Choose ${choices.tools.count} tool${choices.tools.count > 1 ? "s" : ""}:</label>`}));
				const toolGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

				const allTools = this._page.getToolsList() || [];
				let availableTools = allTools;
				if (choices.tools.type === "artisan") {
					availableTools = allTools.filter(t => t.name.toLowerCase().includes("tool")
						|| ["alchemist's supplies", "brewer's supplies", "calligrapher's supplies", "carpenter's tools",
							"cartographer's tools", "cobbler's tools", "cook's utensils", "glassblower's tools",
							"jeweler's tools", "leatherworker's tools", "mason's tools", "painter's supplies",
							"potter's tools", "smith's tools", "tinker's tools", "weaver's tools", "woodcarver's tools"].some(art => t.name.toLowerCase().includes(art.toLowerCase().replace("'s tools", "").replace("'s supplies", "").replace("'s utensils", ""))));
				} else if (choices.tools.from) {
					availableTools = allTools.filter(t => choices.tools.from.some(f => t.name.toLowerCase().includes(f.toLowerCase())));
				}

				const existingTools = new Set((this._state.getToolProficiencies?.() || []).map(t => t.toLowerCase()));

				availableTools.forEach(tool => {
					const isKnown = existingTools.has(tool.name.toLowerCase());
					const isSelected = sel.featChoices.tools.includes(tool.name);

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
							${isKnown ? "disabled title=\"Already proficient\"" : ""}
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${tool.name}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								sel.featChoices.tools = sel.featChoices.tools.filter(t => t !== tool.name);
							} else if (sel.featChoices.tools.length < choices.tools.count) {
								sel.featChoices.tools.push(tool.name);
							}
							renderFeatChoices();
						});
					}
					toolGrid.append(btn);
				});

				toolSection.append(toolGrid);
				toolSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.tools.length}/${choices.tools.count}</div>`}));
				choicesContainer.append(toolSection);
			}

			// Expertise choices
			if (choices.expertise) {
				const expSection = e_({outer: `<div class="mb-2"></div>`});
				expSection.append(e_({outer: `<label class="ve-small">Choose ${choices.expertise.count} skill${choices.expertise.count > 1 ? "s" : ""} for expertise:</label>`}));
				const expGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});

				const proficientSkills = Object.keys(this._state.getSkillProficiencies?.() || {});
				const skillsBeingAdded = sel.featChoices.skills || [];
				const fixedFeatSkills = (sel.feat?.skillProficiencies || []).flatMap(sp =>
					Object.entries(sp)
						.filter(([k, v]) => v === true && k !== "choose" && k !== "any")
						.map(([s]) => s.toLowerCase()),
				);
				const existingExpertise = new Set((this._state.getExpertise?.() || []).map(s => s.toLowerCase()));
				const availableForExpertise = [...new Set([...proficientSkills, ...skillsBeingAdded, ...fixedFeatSkills])].map(s => s.toLowerCase());

				if (availableForExpertise.length === 0) {
					expSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">No proficient skills available for expertise. Add skill proficiencies first.</div>`}));
				} else {
					availableForExpertise.forEach(skill => {
						const hasExpertise = existingExpertise.has(skill);
						const isSelected = sel.featChoices.expertise.includes(skill);
						const displayName = skill.replace(/([A-Z])/g, " $1").trim().toTitleCase();

						const btn = e_({outer: `
							<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
								${hasExpertise ? "disabled title=\"Already has expertise\"" : ""}
								style="${hasExpertise ? "opacity: 0.5;" : ""}">
								${displayName}${hasExpertise ? " ✓✓" : ""}
							</button>
						`});

						if (!hasExpertise) {
							btn.addEventListener("click", () => {
								if (isSelected) {
									sel.featChoices.expertise = sel.featChoices.expertise.filter(s => s !== skill);
								} else if (sel.featChoices.expertise.length < choices.expertise.count) {
									sel.featChoices.expertise.push(skill);
								}
								renderFeatChoices();
							});
						}
						expGrid.append(btn);
					});
				}

				expSection.append(expGrid);
				expSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.expertise.length}/${choices.expertise.count}</div>`}));
				choicesContainer.append(expSection);
			}

			// Language choices
			if (choices.languages) {
				const langSection = e_({outer: `<div class="mb-2"></div>`});
				langSection.append(e_({outer: `<label class="ve-small">Choose ${choices.languages.count} language${choices.languages.count > 1 ? "s" : ""}:</label>`}));

				const existingLangs = new Set((this._state.getLanguages?.() || []).map(l => l.toLowerCase()));
				const standardLangs = ["common", "dwarvish", "elvish", "giant", "gnomish", "goblin", "halfling", "orc"];
				const exoticLangs = ["abyssal", "celestial", "draconic", "deep speech", "infernal", "primordial", "sylvan", "undercommon"];
				const availableLangs = choices.languages.type === "standard" ? standardLangs : [...standardLangs, ...exoticLangs];

				const langGrid = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});
				availableLangs.forEach(lang => {
					const isKnown = existingLangs.has(lang.toLowerCase());
					const isSelected = sel.featChoices.languages.includes(lang);

					const btn = e_({outer: `
						<button class="ve-btn ve-btn-xs ${isSelected ? "ve-btn-primary" : "ve-btn-default"}"
							${isKnown ? "disabled title=\"Already known\"" : ""}
							style="${isKnown ? "opacity: 0.5;" : ""}">
							${(/** @type {*} */ (lang)).toTitleCase()}${isKnown ? " ✓" : ""}
						</button>
					`});

					if (!isKnown) {
						btn.addEventListener("click", () => {
							if (isSelected) {
								sel.featChoices.languages = sel.featChoices.languages.filter(l => l !== lang);
							} else if (sel.featChoices.languages.length < choices.languages.count) {
								sel.featChoices.languages.push(lang);
							}
							renderFeatChoices();
						});
					}
					langGrid.append(btn);
				});

				langSection.append(langGrid);
				langSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.languages.length}/${choices.languages.count}</div>`}));
				choicesContainer.append(langSection);
			}

			// Cantrip choices
			if (choices.spells?.cantrips) {
				const cantripSection = e_({outer: `<div class="mb-2"></div>`});
				cantripSection.append(e_({outer: `<label class="ve-small">Choose ${choices.spells.cantrips.count} cantrip${choices.spells.cantrips.count > 1 ? "s" : ""}:</label>`}));

				const cantripList = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});
				sel.featChoices.cantrips.forEach((cantrip, idx) => {
					const badge = e_({outer: `<span class="badge badge-primary mr-1">${cantrip.name} <span class="clickable" style="cursor: pointer;">×</span></span>`});
					badge.querySelector(".clickable").addEventListener("click", () => {
						sel.featChoices.cantrips.splice(idx, 1);
						renderFeatChoices();
					});
					cantripList.append(badge);
				});

				if (sel.featChoices.cantrips.length < choices.spells.cantrips.count) {
					const addBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default">+ Add Cantrip</button>`});
					addBtn.addEventListener("click", async () => {
						await this._showSpellPicker(choices.spells.cantrips.filter, true, (spell) => {
							if (!sel.featChoices.cantrips.find(s => s.name === spell.name && s.source === spell.source)) {
								sel.featChoices.cantrips.push({name: spell.name, source: spell.source, level: 0});
								renderFeatChoices();
							}
						});
					});
					cantripList.append(addBtn);
				}

				cantripSection.append(cantripList);
				cantripSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.cantrips.length}/${choices.spells.cantrips.count}</div>`}));
				choicesContainer.append(cantripSection);
			}

			// Spell choices
			if (choices.spells?.spells) {
				const spellSection = e_({outer: `<div class="mb-2"></div>`});
				const spellType = choices.spells.spells.innate ? "innate spell" : "spell";
				spellSection.append(e_({outer: `<label class="ve-small">Choose ${choices.spells.spells.count} ${spellType}${choices.spells.spells.count > 1 ? "s" : ""}:</label>`}));

				const spellList = e_({outer: `<div class="ve-flex-wrap gap-1 mt-1"></div>`});
				sel.featChoices.spells.forEach((spell, idx) => {
					const badge = e_({outer: `<span class="badge badge-primary mr-1">${spell.name} <span class="clickable" style="cursor: pointer;">×</span></span>`});
					badge.querySelector(".clickable").addEventListener("click", () => {
						sel.featChoices.spells.splice(idx, 1);
						renderFeatChoices();
					});
					spellList.append(badge);
				});

				if (sel.featChoices.spells.length < choices.spells.spells.count) {
					const addBtn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-default">+ Add Spell</button>`});
					addBtn.addEventListener("click", async () => {
						await this._showSpellPicker(choices.spells.spells.filter, false, (spell) => {
							if (!sel.featChoices.spells.find(s => s.name === spell.name && s.source === spell.source)) {
								sel.featChoices.spells.push({
									name: spell.name,
									source: spell.source,
									level: spell.level,
									innate: choices.spells.spells.innate,
									daily: choices.spells.spells.daily,
								});
								renderFeatChoices();
							}
						});
					});
					spellList.append(addBtn);
				}

				spellSection.append(spellList);
				spellSection.append(e_({outer: `<div class="ve-small ve-muted mt-1">Selected: ${sel.featChoices.spells.length}/${choices.spells.spells.count}</div>`}));
				choicesContainer.append(spellSection);
			}
		};

		const renderList = (filter = "") => {
			list.innerHTML = "";
			const filterLower = filter.toLowerCase();
			feats
				.filter(f => !filter || f.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 50)
				.forEach(feat => {
					const isSelected = sel.feat?.name === feat.name && sel.feat?.source === feat.source;
					const choices = getFeatChoices(feat);
					const hasChoices = choices.skills || choices.languages || choices.tools || choices.ability || choices.expertise || choices.spells;

					const item = e_({outer: `<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 4px 8px; cursor: pointer;"></div>`});
					const featLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_FEATS, feat.name, feat.source);
					const strong = e_({tag: "strong"});
					if (typeof featLink === "string") strong.innerHTML = featLink;
					else strong.append(featLink);
					item.append(strong);
					item.append(e_({outer: ` <span class="ve-muted">(${Parser.sourceJsonToAbv(feat.source)})</span>`}));
					if (feat.category) {
						const categoryFull = Parser.featCategoryToFull?.(feat.category) || feat.category;
						item.append(e_({outer: ` <span class="badge badge-secondary ml-1" style="font-size: 0.6rem;">${categoryFull}</span>`}));
					}
					if (hasChoices) item.append(e_({outer: ` <span class="badge badge-info ml-1" style="font-size: 0.65rem;">has choices</span>`}));

					item.addEventListener("click", () => {
						list.querySelectorAll(".charsheet__quickbuild-option").forEach(el => el.classList.remove("selected"));
						item.classList.add("selected");
						sel.feat = feat;
						sel.featChoices = {skills: [], languages: [], tools: [], ability: null, expertise: [], spellList: null, cantrips: [], spells: []};
						renderFeatChoices();
					});
					list.append(item);
				});
		};

		const renderListDebounced = MiscUtil.debounce(() => renderList(search.value), 100);
		search.addEventListener("input", renderListDebounced);
		renderList();

		container.append(search, list, choicesContainer);

		if (sel.feat) {
			container.append(e_({outer: `<div class="ve-small mt-1"><strong>Selected:</strong> ${sel.feat.name}</div>`}));
			renderFeatChoices();
		}

		return container;
	}

	/**
	 * Show a spell picker modal filtered by the given filter string
	 * @param {string} filterStr - Filter string like "level=0|class=Wizard"
	 * @param {boolean} isCantrip - Whether we're picking cantrips (level 0)
	 * @param {function} onSelect - Callback when spell is selected
	 */
	async _showSpellPicker (filterStr, isCantrip, onSelect) {
		if (!this._page._spells?.showFilteredSpellPicker) {
			JqueryUtil.doToast({type: "warning", content: "Spell picker not available"});
			return;
		}

		const choice = {
			filter: filterStr,
			featureName: isCantrip ? "Feat Cantrip" : "Feat Spell",
		};

		await this._page._spells.showFilteredSpellPicker(choice, onSelect);
	}

	_validateAsiStep (asiLevels) {
		for (const analysis of asiLevels) {
			const levelKey = `${analysis.className}_${analysis.classLevel}`;
			const sel = this._selections.asi[levelKey];
			if (!sel) {
				JqueryUtil.doToast({type: "warning", content: `Please configure ASI for ${analysis.className} level ${analysis.classLevel}.`});
				return false;
			}

			const isBoth = this._state.shouldGrantBothAsiAndFeat(analysis.characterLevel);

			if (isBoth) {
				// Need both ASI points spent AND a feat
				const pointsUsed = Object.values(sel.abilityChoices || {}).reduce((s, v) => s + v, 0);
				if (pointsUsed !== 2) {
					JqueryUtil.doToast({type: "warning", content: `Please allocate all 2 ASI points for ${analysis.className} level ${analysis.classLevel}.`});
					return false;
				}
				if (!sel.feat) {
					JqueryUtil.doToast({type: "warning", content: `Please select a feat for ${analysis.className} level ${analysis.classLevel}.`});
					return false;
				}
			} else if (sel.mode === "asi") {
				const pointsUsed = Object.values(sel.abilityChoices || {}).reduce((s, v) => s + v, 0);
				if (pointsUsed !== 2) {
					JqueryUtil.doToast({type: "warning", content: `Please allocate all 2 ASI points for ${analysis.className} level ${analysis.classLevel}.`});
					return false;
				}
			} else if (sel.mode === "feat") {
				if (!sel.feat) {
					JqueryUtil.doToast({type: "warning", content: `Please select a feat for ${analysis.className} level ${analysis.classLevel}.`});
					return false;
				}
			}
		}
		return true;
	}

	// ==========================================
	// Step 4: Optional Features (Invocations, Metamagic, etc.)
	// ==========================================

	_renderOptionalFeaturesStep (content, optFeatLevels) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});

		// Aggregate gains by feature type across all levels
		const aggregatedGains = {};
		optFeatLevels.forEach(analysis => {
			analysis.optionalFeatureGains.forEach(gain => {
				const key = gain.featureTypes.join("_");
				if (!aggregatedGains[key]) {
					aggregatedGains[key] = {
						name: gain.name,
						featureTypes: gain.featureTypes,
						totalNeeded: 0,
						className: analysis.className,
						classSource: analysis.classSource,
						classData: analysis.classData,
						maxClassLevel: analysis.classLevel,
					};
				}
				aggregatedGains[key].totalNeeded += gain.newCount;
				aggregatedGains[key].maxClassLevel = Math.max(aggregatedGains[key].maxClassLevel, analysis.classLevel);
			});
		});

		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Class Options</h4>
				<p class="ve-muted">Select your optional class features (invocations, metamagic, etc.).</p>
			</div>
		`}));

		Object.entries(aggregatedGains).forEach(([typeKey, gain]) => {
			const isCombatMethods = gain.featureTypes.some(ft => ft.startsWith("CTM:"));

			// Add subclass bonus method count for combat methods
			if (isCombatMethods) {
				const subclass = this._getSubclassForClass(gain.className, gain.classSource, 0);
				if (subclass) {
					const bonusCount = CharacterSheetClassUtils.getSubclassBonusMethodCount(subclass, gain.classSource);
					gain.totalNeeded += bonusCount;
				}
			}

			if (isCombatMethods) {
				this._renderCombatMethodsOptFeature(step, typeKey, gain);
			} else {
				this._renderStandardOptFeature(step, typeKey, gain);
			}
		});

		content.append(step);
	}

	_validateOptionalFeaturesStep (optFeatLevels) {
		// Check all aggregated gains are met
		const aggregatedGains = {};
		optFeatLevels.forEach(analysis => {
			analysis.optionalFeatureGains.forEach(gain => {
				const key = gain.featureTypes.join("_");
				if (!aggregatedGains[key]) {
					aggregatedGains[key] = {name: gain.name, totalNeeded: 0};
				}
				aggregatedGains[key].totalNeeded += gain.newCount;
			});
		});

		for (const [key, gain] of Object.entries(aggregatedGains)) {
			// Add subclass bonus method count for combat methods
			const isCTM = key.includes("CTM:");
			if (isCTM) {
				const analysis = optFeatLevels[0];
				if (analysis) {
					const subclass = this._getSubclassForClass(analysis.className, analysis.classSource, 0);
					if (subclass) {
						gain.totalNeeded += CharacterSheetClassUtils.getSubclassBonusMethodCount(subclass, analysis.classSource);
					}
				}
			}

			const selected = this._selections.optionalFeatures[key] || [];
			if (selected.length < gain.totalNeeded) {
				JqueryUtil.doToast({type: "warning", content: `Please select ${gain.totalNeeded} ${gain.name} (currently ${selected.length}).`});
				return false;
			}
		}
		return true;
	}

	/**
	 * Render a standard (non-Combat-Methods) optional feature gain section.
	 */
	_renderStandardOptFeature (step, typeKey, gain) {
		if (!this._selections.optionalFeatures[typeKey]) {
			this._selections.optionalFeatures[typeKey] = [];
		}
		const selectedList = this._selections.optionalFeatures[typeKey];

		const existingOptFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");

		const isRepeatable = (opt) => {
			if (!opt.entries) return false;
			const checkEntries = (entries) => {
				for (const entry of entries) {
					if (typeof entry === "string" && entry.toLowerCase().includes("repeatable")) return true;
					if (entry?.name?.toLowerCase().includes("repeatable")) return true;
					if (entry?.entries && checkEntries(entry.entries)) return true;
				}
				return false;
			};
			return checkEntries(opt.entries);
		};

		const section = e_({outer: `
			<div class="charsheet__quickbuild-section mb-3">
				<h5>${gain.name} <span class="badge badge-primary qb-opt-counter">${selectedList.length}/${gain.totalNeeded}</span></h5>
			</div>
		`});

		const allOptFeatures = this._page.getOptionalFeatures() || [];
		const filtered = allOptFeatures.filter(f => {
			const fTypes = f.featureType || [];
			return fTypes.some(ft =>
				gain.featureTypes.some(pt => ft === pt || ft.startsWith(pt)),
			);
		});

		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const editionFiltered = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(filtered, {showAll});
		const sourceFiltered = this._page.filterByAllowedSources(editionFiltered);

		const existingCountMap = new Map();
		for (const existing of existingOptFeatures) {
			const key = `${existing.name}|${existing.source}`;
			existingCountMap.set(key, (existingCountMap.get(key) || 0) + 1);
		}

		const enrichedOptions = sourceFiltered.map(opt => {
			const key = `${opt.name}|${opt.source}`;
			const timesKnown = existingCountMap.get(key) || 0;
			const alreadyKnown = timesKnown > 0;
			const repeatable = isRepeatable(opt);
			return {
				...opt,
				_alreadyKnown: alreadyKnown,
				_timesKnown: timesKnown,
				_selectable: !alreadyKnown || repeatable,
				_repeatable: repeatable,
			};
		});

		const hasKnownOptions = enrichedOptions.some(opt => opt._alreadyKnown);

		const search = e_({outer: `<input type="text" class="ve-form-control ve-input-sm mb-1" placeholder="Search...">`});
		const listEl = e_({outer: `<div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--cs-border, #ddd); border-radius: 8px;"></div>`});

		const renderList = (filter = "") => {
			listEl.innerHTML = "";

			const hasAnyKnownOrSelected = hasKnownOptions || selectedList.length > 0;
			if (hasAnyKnownOrSelected) {
				listEl.append(e_({outer: `
					<div class="ve-small ve-muted mb-2 pb-2 px-2 pt-1" style="border-bottom: 1px solid var(--cs-border, #ddd);">
						<span class="badge badge-success mr-1">✓ Known</span> = Already have
						<span class="badge badge-primary ml-2 mr-1">● Selected</span> = Chosen now
						<span class="badge badge-info ml-2 mr-1">↺ Repeatable</span> = Can take again
					</div>
				`}));
			}

			const filterLower = filter.toLowerCase();
			enrichedOptions
				.filter(f => !filter || f.name.toLowerCase().includes(filterLower))
				.sort((a, b) => {
					if (a._selectable !== b._selectable) return a._selectable ? -1 : 1;
					if (a._alreadyKnown !== b._alreadyKnown) return a._alreadyKnown ? -1 : 1;
					return a.name.localeCompare(b.name);
				})
				.forEach(opt => {
					const isSelected = selectedList.some(s => s.name === opt.name && s.source === opt.source);
					const isDisabled = !opt._selectable;

					const knownText = opt._timesKnown > 1 ? `Known ×${opt._timesKnown}` : "Known";
					const knownBadge = opt._alreadyKnown
						? `<span class="badge badge-success ml-1" title="Already have this${opt._timesKnown > 1 ? ` (${opt._timesKnown} times)` : ""}">✓ ${knownText}</span>`
						: "";
					const selectedBadge = isSelected && !opt._alreadyKnown
						? `<span class="badge badge-primary ml-1" title="Selected in this session">● Selected</span>`
						: "";
					const repeatableBadge = opt._repeatable
						? `<span class="badge badge-info ml-1" title="Can be taken multiple times">↺ Repeatable</span>`
						: "";

					const itemStyle = `padding: 6px 8px; cursor: ${isDisabled ? "not-allowed" : "pointer"};${isDisabled ? " opacity: 0.5;" : ""}${isSelected && !opt._alreadyKnown ? " background: rgba(13, 110, 253, 0.1); border-left: 3px solid #0d6efd;" : ""}${opt._alreadyKnown && opt._selectable ? " background: rgba(40, 167, 69, 0.1); border-left: 3px solid #28a745;" : ""}${opt._alreadyKnown && !opt._selectable ? " background: rgba(128, 128, 128, 0.1);" : ""}`;

					const item = e_({outer: `
						<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="${itemStyle}">
							<div class="ve-flex-v-center">
								<input type="checkbox" ${isSelected ? "checked" : ""}${isDisabled ? " disabled" : ""}>
								<span class="qb-opt-name ml-2"></span>
								${knownBadge}${selectedBadge}${repeatableBadge}
								<span class="ve-muted ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>
							</div>
						</div>
					`});

					const optName = item.querySelector(".qb-opt-name");
					try {
						const resolvedSource = this._page.resolveOptionalFeatureSource(opt.name, [
							opt.source,
							Parser.SRC_XPHB,
							Parser.SRC_PHB,
						]);
						const page = CharacterSheetClassUtils.isCombatMethod(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
						const link = CharacterSheetPage.getHoverLink(page, opt.name, resolvedSource);
						if (typeof link === "string") optName.innerHTML = link;
						else optName.append(link);
					} catch (e) {
						optName.innerHTML = `<strong>${opt.name}</strong>`;
					}

					item.addEventListener("click", () => {
						if (isDisabled) return;

						if (isSelected) {
							const idx = selectedList.findIndex(s => s.name === opt.name && s.source === opt.source);
							if (idx >= 0) selectedList.splice(idx, 1);
						} else {
							if (selectedList.length >= gain.totalNeeded) {
								JqueryUtil.doToast({type: "warning", content: `You can only select ${gain.totalNeeded} ${gain.name}.`});
								return;
							}
							selectedList.push(opt);
						}
						renderList(filter);
						section.querySelector(".qb-opt-counter").textContent = `${selectedList.length}/${gain.totalNeeded}`;
					});
					listEl.append(item);
				});
		};

		const renderListDebounced = MiscUtil.debounce(() => renderList(search.value), 100);
		search.addEventListener("input", renderListDebounced);
		renderList();

		section.append(search, listEl);
		step.append(section);
	}

	/**
	 * Render a Combat Methods optional feature gain with tradition + degree filtering.
	 */
	_renderCombatMethodsOptFeature (step, typeKey, gain) {
		if (!this._selections.optionalFeatures[typeKey]) {
			this._selections.optionalFeatures[typeKey] = [];
		}
		const selectedList = this._selections.optionalFeatures[typeKey];

		const rawOptFeatures = this._page.getOptionalFeatures() || [];
		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const editionFiltered = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(rawOptFeatures, {showAll});
		const allOptFeatures = this._page.filterByAllowedSources(editionFiltered);
		const existingOptFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");

		const maxDegree = CharacterSheetClassUtils.getMaxMethodDegree(gain.classData, gain.maxClassLevel) || 1;

		let knownTraditions = CharacterSheetClassUtils.getKnownCombatTraditions(existingOptFeatures, this._state);
		const classFeatures = this._page.getClassFeatures();
		const traditionCount = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
			classData: gain.classData,
			classFeatures,
		});

		// Identify subclass-granted traditions (e.g. Mercy → Sanguine Knot)
		let subclassGrantedCodes = [];
		const subclass = this._getSubclassForClass(gain.className, gain.classSource, 0);
		if (subclass) {
			const grantedTraditions = CharacterSheetClassUtils.getSubclassGrantedTraditions(subclass, gain.classSource);
			subclassGrantedCodes = grantedTraditions.filter(t => t.code && !(/** @type {*} */ (t)).choice).map(t => t.code);
		}

		// _combatTraditions tracks only user-chosen traditions (not subclass grants)
		if (!this._selections._combatTraditions) {
			this._selections._combatTraditions = knownTraditions.filter(t => !subclassGrantedCodes.includes(t));
		}

		// Combined set for method filtering; user count for picker limit
		const getAllTraditions = () => [...new Set([...this._selections._combatTraditions, ...subclassGrantedCodes])];
		const getUserChosenCount = () => this._selections._combatTraditions.length;

		const section = e_({outer: `
			<div class="charsheet__quickbuild-section mb-3">
				<h5>${gain.name} <span class="badge badge-primary">${selectedList.length}/${gain.totalNeeded}</span></h5>
				${CharacterSheetClassUtils.getCombatMethodsSystemSummary()}
				<p class="ve-muted ve-small">Max degree: ${maxDegree}${CharacterSheetClassUtils.getOrdinalSuffix(maxDegree)}</p>
			</div>
		`});

		const tradContainer = e_({outer: `<div class="mb-2"></div>`});
		const methodsContainer = e_({outer: `<div></div>`});

		if (getUserChosenCount() < traditionCount) {
			const availableTraditions = CharacterSheetClassUtils.getAvailableTraditionsForClass(
				allOptFeatures,
				gain.featureTypes || [],
				gain.className,
				classFeatures,
			);

			tradContainer.append(e_({outer: `<div>
				<p class="ve-small ve-muted mb-1">Choose ${traditionCount} Combat Traditions:</p>
				<div class="ve-small ve-muted mb-1">Selected: <span class="qb-trad-count">${getUserChosenCount()}</span>/${traditionCount}</div>
			</div>`}));

			// Show subclass-granted traditions as non-interactive badges
			if (subclassGrantedCodes.length > 0) {
				const grantedNames = subclassGrantedCodes.map(c => CharacterSheetClassUtils.getTraditionName(c)).join(", ");
				tradContainer.append(e_({outer: `<div class="ve-small ve-muted mb-1" style="padding: 4px 6px;">Free from subclass: <strong>${grantedNames}</strong></div>`}));
			}

			const tradList = e_({outer: `<div class="charsheet__quickbuild-picker-list"></div>`});

			availableTraditions.filter(trad => !subclassGrantedCodes.includes(trad.code)).forEach(trad => {
				const isChecked = this._selections._combatTraditions.includes(trad.code);
				const desc = CharacterSheetClassUtils.getTraditionDescription(trad.code);

				// Build hoverable tradition name linking to the Combat Traditions variant rule
				let tradNameHtml;
				try {
					tradNameHtml = CharacterSheetPage.getHoverLink(
						UrlUtil.PG_VARIANTRULES,
						"Combat Traditions",
						Parser.SRC_TGTT || "TGTT",
						null,
						trad.name,
					);
				} catch (e) {
					tradNameHtml = `<strong>${trad.name}</strong>`;
				}

				const item = e_({outer: `
					<label class="charsheet__tradition-row d-block ve-small mb-1">
						<input type="checkbox" class="mr-2" ${isChecked ? "checked" : ""}>
						<strong class="tradition-name-slot"></strong>
						<span class="ve-muted ml-1">(${trad.code})</span>
						${desc ? `<div class="ve-muted" style="margin-left: 1.5rem; font-size: 0.85em;">${desc}</div>` : ""}
					</label>
				`});
				item.querySelector(".tradition-name-slot").innerHTML = tradNameHtml;

				item.querySelector("input").addEventListener("change", (e) => {
					if (e.target.checked) {
						if (getUserChosenCount() < traditionCount) {
							this._selections._combatTraditions.push(trad.code);
						} else {
							e.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${traditionCount} traditions.`});
							return;
						}
					} else {
						this._selections._combatTraditions = this._selections._combatTraditions.filter(t => t !== trad.code);
						const allTraditions = getAllTraditions();
						const remaining = selectedList.filter(s => {
							const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(s);
							if (!tradCode) return true;
							return allTraditions.includes(tradCode);
						});
						selectedList.length = 0;
						remaining.forEach(s => selectedList.push(s));
					}
					tradContainer.querySelector(".qb-trad-count").textContent = getUserChosenCount();
					renderMethods();
					section.querySelector(".badge").textContent = `${selectedList.length}/${gain.totalNeeded}`;
				});

				tradList.append(item);
			});

			tradContainer.append(tradList);
		} else {
			const allTraditions = getAllTraditions();
			const tradNames = allTraditions.map(t => CharacterSheetClassUtils.getTraditionName(t)).join(", ");
			tradContainer.append(e_({outer: `<p class="ve-small ve-muted">Traditions: ${tradNames}</p>`}));
		}

		const renderMethods = () => {
			methodsContainer.innerHTML = "";
			const activeTraditions = getAllTraditions();

			if (activeTraditions.length === 0) {
				methodsContainer.append(e_({outer: `<p class="ve-muted ve-small">Select traditions above to see available methods.</p>`}));
				return;
			}

			const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
			const allMethods = [...allOptFeatures, ...combatMethodEntities];

			const availableMethods = allMethods.filter(opt => {
				if (!CharacterSheetClassUtils.isCombatMethod(opt)) return false;
				const degree = CharacterSheetClassUtils.getMethodDegree(opt);
				const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
				return degree > 0 && degree <= maxDegree && tradCode && activeTraditions.includes(tradCode);
			});

			const existingNames = new Set(existingOptFeatures.map(f => `${f.name}|${f.source}`));
			const newMethods = availableMethods.filter(m => !existingNames.has(`${m.name}|${m.source}`));

			const search = e_({outer: `<input type="text" class="ve-form-control ve-input-sm mb-1" placeholder="Search methods...">`});
			const list = e_({outer: `<div class="charsheet__quickbuild-picker-list charsheet__quickbuild-picker-list--methods"></div>`});

			const renderFiltered = (filter = "") => {
				list.innerHTML = "";
				const filterLower = filter.toLowerCase();

				for (const tradCode of activeTraditions) {
					const tradName = CharacterSheetClassUtils.getTraditionName(tradCode);
					const tradMethods = newMethods.filter(m => {
						if (filter && !m.name.toLowerCase().includes(filterLower)) return false;
						return CharacterSheetClassUtils.getMethodTraditionCode(m) === tradCode;
					});
					if (tradMethods.length === 0) continue;

					list.append(e_({outer: `<div class="ve-small px-2 pt-2 pb-1" style="font-weight: 600; border-bottom: 1px solid var(--cs-border, #ddd);">${tradName}</div>`}));

					tradMethods.sort((a, b) => {
						const dA = CharacterSheetClassUtils.getMethodDegree(a);
						const dB = CharacterSheetClassUtils.getMethodDegree(b);
						return dA - dB || a.name.localeCompare(b.name);
					}).forEach(opt => {
						const degree = CharacterSheetClassUtils.getMethodDegree(opt);
						const isSelected = selectedList.some(s => s.name === opt.name && s.source === opt.source);
						const item = e_({outer: `
							<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 6px 8px; cursor: pointer;">
								<div class="ve-flex-v-center">
									<input type="checkbox" ${isSelected ? "checked" : ""}>
									<span class="qb-method-name ml-2"></span>
									<span class="ve-muted ml-1">(${degree}${CharacterSheetClassUtils.getOrdinalSuffix(degree)} degree)</span>
								</div>
							</div>
						`});

						const methodName = item.querySelector(".qb-method-name");
						try {
							const resolvedSource = this._page.resolveOptionalFeatureSource(opt.name, [
								opt.source,
								Parser.SRC_XPHB,
								Parser.SRC_PHB,
							]);
							const link = CharacterSheetPage.getHoverLink(UrlUtil.PG_COMBAT_METHODS, opt.name, resolvedSource);
							if (typeof link === "string") methodName.innerHTML = link;
							else methodName.append(link);
						} catch (e) {
							methodName.innerHTML = `<strong>${opt.name}</strong>`;
						}

						item.addEventListener("click", () => {
							if (isSelected) {
								const idx = selectedList.findIndex(s => s.name === opt.name && s.source === opt.source);
								if (idx >= 0) selectedList.splice(idx, 1);
							} else {
								if (selectedList.length >= gain.totalNeeded) {
									JqueryUtil.doToast({type: "warning", content: `You can only select ${gain.totalNeeded} ${gain.name}.`});
									return;
								}
								selectedList.push(opt);
							}
							renderFiltered(filter);
							section.querySelector(".badge").textContent = `${selectedList.length}/${gain.totalNeeded}`;
						});
						list.append(item);
					});
				}

				if (list.children.length === 0) {
					list.append(e_({outer: `<div class="ve-muted ve-small p-2">No methods available.</div>`}));
				}
			};

			const renderFilteredDebounced = MiscUtil.debounce(() => renderFiltered(search.value), 100);
			search.addEventListener("input", renderFilteredDebounced);
			renderFiltered();

			methodsContainer.append(search, list);
		};

		renderMethods();
		section.append(tradContainer, methodsContainer);
		step.append(section);
	}

	// ==========================================
	// Step 5b: Weapon Mastery
	// ==========================================

	/**
	 * Compute how many new weapon mastery slots the character gains during this Quick Build.
	 * Compares the mastery count at the starting level vs. the target level.
	 */
	_getWeaponMasteryGains (analysisArray) {
		// Find the highest target mastery count across all classes
		let targetTotal = 0;
		let className = null;
		let classData = null;

		for (const a of analysisArray) {
			if (a.weaponMasteryCount > targetTotal) {
				targetTotal = a.weaponMasteryCount;
				className = a.className;
				classData = a.classData;
			}
		}

		if (targetTotal === 0) return null;

		// Current mastery count = whatever the character already has set
		const currentMasteries = this._state.getWeaponMasteries() || [];
		const existingCount = currentMasteries.length;

		const newSlots = targetTotal - existingCount;
		if (newSlots <= 0) return null;

		return {
			className,
			classData,
			currentMasteries,
			existingCount,
			targetTotal,
			newSlots,
		};
	}

	/**
	 * Render the weapon mastery step: let the user fill up to the new total.
	 */
	_renderWeaponMasteryStep (content, masteryInfo) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Weapon Mastery</h4>
				<p class="ve-muted">Choose weapons to master. You can change these after a Long Rest.
					Your ${masteryInfo.className} now masters ${masteryInfo.targetTotal} weapon${masteryInfo.targetTotal !== 1 ? "s" : ""}
					(was ${masteryInfo.existingCount}).</p>
			</div>
		`}));

		if (!this._selections.weaponMasteries) {
			this._selections.weaponMasteries = [...masteryInfo.currentMasteries];
		}
		const selectedList = this._selections.weaponMasteries;

		const section = e_({outer: `
			<div class="charsheet__quickbuild-section mb-3">
				<h5>Weapon Masteries <span class="badge badge-primary">${selectedList.length}/${masteryInfo.targetTotal}</span></h5>
			</div>
		`});

		const allItems = this._page.getItems?.() || [];
		const weaponsWithMastery = allItems.filter(item => {
			if (!item._isBaseItem) return false;
			if (!item.weaponCategory && !["M", "R", "S"].includes(item.type)) return false;
			return item.mastery?.length > 0;
		});

		const getMasteryName = (entry) => {
			if (!entry) return "";
			if (typeof entry === "string") return entry.split("|")[0];
			if (typeof entry === "object" && entry.uid) return entry.uid.split("|")[0];
			return "";
		};

		const simpleWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "simple" || w.type === "S",
		).sort((a, b) => a.name.localeCompare(b.name));

		const martialWeapons = weaponsWithMastery.filter(w =>
			w.weaponCategory === "martial" || w.type === "M",
		).sort((a, b) => a.name.localeCompare(b.name));

		const list = e_({outer: `<div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--cs-border, #ddd); border-radius: 8px;"></div>`});

		const renderList = () => {
			list.innerHTML = "";

			const renderGroup = (weapons, groupName) => {
				if (!weapons.length) return;
				list.append(e_({outer: `<div class="ve-small px-2 pt-2 pb-1" style="font-weight: 600; border-bottom: 1px solid var(--cs-border, #ddd);">${groupName}</div>`}));
				weapons.forEach(weapon => {
					const weaponKey = `${weapon.name}|${weapon.source}`;
					const masteryProp = getMasteryName(weapon.mastery?.[0]);
					const isSelected = selectedList.includes(weaponKey);

					const item = e_({outer: `
						<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 6px 8px; cursor: pointer;">
							<div class="ve-flex-v-center">
								<input type="checkbox" ${isSelected ? "checked" : ""}>
								<strong class="ml-2">${weapon.name}</strong>
								${masteryProp ? `<span class="ve-muted ml-1">(${masteryProp})</span>` : ""}
							</div>
						</div>
					`});
					item.addEventListener("click", () => {
						if (isSelected) {
							const idx = selectedList.indexOf(weaponKey);
							if (idx >= 0) selectedList.splice(idx, 1);
						} else {
							if (selectedList.length >= masteryInfo.targetTotal) {
								JqueryUtil.doToast({type: "warning", content: `You can only master ${masteryInfo.targetTotal} weapons.`});
								return;
							}
							selectedList.push(weaponKey);
						}
						renderList();
						section.querySelector(".badge").textContent = `${selectedList.length}/${masteryInfo.targetTotal}`;
					});
					list.append(item);
				});
			};

			renderGroup(simpleWeapons, "Simple Weapons");
			renderGroup(martialWeapons, "Martial Weapons");
		};

		renderList();
		section.append(list);
		step.append(section);
		content.append(step);
	}

	_validateWeaponMasteryStep (masteryInfo) {
		const selected = this._selections.weaponMasteries || [];
		if (selected.length < masteryInfo.targetTotal) {
			JqueryUtil.doToast({
				type: "warning",
				content: `Please select ${masteryInfo.targetTotal} weapon masteries (currently ${selected.length}).`,
			});
			return false;
		}
		return true;
	}

	// ==========================================
	// Step 5: Feature Choices (Specialties, etc.)
	// ==========================================

	_renderFeatureOptionsStep (content, featureOptionLevels) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Feature Choices</h4>
				<p class="ve-muted">Select options for features that offer choices (fighting styles, specialties, etc.).</p>
			</div>
		`}));

		// Get existing features to mark "already known" options
		const existingFeatures = this._state.getFeatures() || [];
		const existingFeatureNames = new Set(existingFeatures.map(f => f.name?.toLowerCase()));

		// Collect all option groups and identify shared option pools.
		// Groups that reference the same base feature share a pool and should cross-deduplicate.
		const allSections = [];
		featureOptionLevels.forEach(analysis => {
			const {className, classLevel, featureOptions} = analysis;

			featureOptions.forEach(optGroup => {
				const levelKey = `${className}_${classLevel}_${optGroup.featureName}`;
				if (!this._selections.featureOptions[levelKey]) {
					this._selections.featureOptions[levelKey] = [];
				}
				// Pool key: groups that share the same base option list.
				// `referencedFrom` is set by _findFeatureOptions for "gain another X" refs.
				// Normalize: convert "FeatureName|ClassName|Source|Level" → "ClassName_FeatureName"
				// so that both the base feature and its "gain another" references share the same pool.
				let poolKey;
				if (optGroup.referencedFrom) {
					const refParts = optGroup.referencedFrom.split("|");
					poolKey = `${refParts[1] || className}_${refParts[0]}`;
				} else {
					poolKey = `${className}_${optGroup.featureName}`;
				}
				allSections.push({
					analysis,
					optGroup,
					levelKey,
					poolKey,
					section: null,
					list: null,
				});
			});
		});

		// Build a map of pool key → sections sharing that pool
		const poolMap = {};
		for (const sec of allSections) {
			if (!poolMap[sec.poolKey]) poolMap[sec.poolKey] = [];
			poolMap[sec.poolKey].push(sec);
		}

		// Get names already selected in OTHER sections of the same pool
		const getPoolSelectedNames = (poolKey, excludeLevelKey) => {
			const names = new Set();
			for (const sec of (poolMap[poolKey] || [])) {
				if (sec.levelKey === excludeLevelKey) continue;
				for (const s of (this._selections.featureOptions[sec.levelKey] || [])) {
					names.add(s.name);
				}
			}
			return names;
		};

		// Get which level selected a given option in this pool (returns {classLevel, className} or null)
		const getPoolSelectionLevel = (poolKey, optName, excludeLevelKey) => {
			for (const sec of (poolMap[poolKey] || [])) {
				if (sec.levelKey === excludeLevelKey) continue;
				const selections = this._selections.featureOptions[sec.levelKey] || [];
				if (selections.some(s => s.name === optName)) {
					return {classLevel: sec.analysis.classLevel, className: sec.analysis.className};
				}
			}
			return null;
		};

		// Check if a feature option is repeatable (can be taken multiple times)
		const isRepeatableOpt = (opt) => {
			if (opt.type !== "classFeature" || !opt.ref) return false;
			const parts = opt.ref.split("|");
			const classFeatures = this._page.getClassFeatures();
			const fullOpt = classFeatures.find(f =>
				f.name === parts[0]
				&& f.className === parts[1]
				&& (f.source === parts[2] || !parts[2]),
			);
			if (!fullOpt?.entries) return false;
			const text = JSON.stringify(fullOpt.entries).toLowerCase();
			return text.includes("multiple times") || text.includes("chosen again") || text.includes("retaken");
		};

		// Render a single section; callable multiple times for re-render on selection change
		const renderSection = (sec) => {
			const {optGroup, levelKey, poolKey} = sec;
			const selectedList = this._selections.featureOptions[levelKey];

			sec.list.innerHTML = "";

			const usedNames = getPoolSelectedNames(poolKey, levelKey);

			(optGroup.options || []).forEach(opt => {
				const isRepeatable = isRepeatableOpt(opt);

				const chosenElsewhere = !isRepeatable && usedNames.has(opt.name)
					? getPoolSelectionLevel(poolKey, opt.name, levelKey)
					: null;

				const isSelected = selectedList.some(s => s.name === opt.name);
				const isAlreadyKnown = existingFeatureNames.has(opt.name?.toLowerCase());

				// Build badges for known/chosen elsewhere/repeatable
				let statusBadge = "";
				if (chosenElsewhere) {
					statusBadge = `<span class="badge badge-warning ml-1" title="Chosen at ${chosenElsewhere.className} level ${chosenElsewhere.classLevel}">✓ Level ${chosenElsewhere.classLevel}</span>`;
				} else if (isAlreadyKnown) {
					statusBadge = `<span class="badge badge-success ml-1" title="Already selected">✓ Known</span>`;
				}
				const repeatableBadge = isRepeatable
					? `<span class="badge badge-info ml-1" title="Can be taken multiple times">↺ Repeatable</span>`
					: "";

				// Disable non-repeatable options that are known or chosen elsewhere
				const isDisabled = (isAlreadyKnown || chosenElsewhere) && !isRepeatable;
				const itemStyle = isDisabled ? "opacity: 0.5; cursor: not-allowed;" : "cursor: pointer;";

				const item = e_({outer: `
					<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 6px 8px; ${itemStyle}">
						<div class="ve-flex-v-center">
							<input type="${optGroup.count === 1 ? "radio" : "checkbox"}" name="qb-featopt-${levelKey}" ${isSelected ? "checked" : ""}${isDisabled ? " disabled" : ""}>
							<span class="qb-feat-opt-name ml-2"></span>
							${statusBadge}${repeatableBadge}
							${opt.source ? `<span class="ve-muted ml-1">(${Parser.sourceJsonToAbv(opt.source)})</span>` : ""}
						</div>
					</div>
				`});

				const featOptName = item.querySelector(".qb-feat-opt-name");
				if (opt.type === "classFeature" && opt.ref) {
					const parts = opt.ref.split("|");
					const featureSource = parts[2] || opt.source || "TGTT";
					const hash = UrlUtil.encodeArrayForHash(parts[0], parts[1], parts[2], parts[3], featureSource);
					try {
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
						featOptName.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${opt.name}</a>`;
					} catch (e) {
						featOptName.innerHTML = `<strong>${opt.name}</strong>`;
					}
				} else if (opt.type === "optionalfeature" && opt.ref) {
					const refParts = opt.ref.split("|");
					try {
						const resolvedSource = this._page.resolveOptionalFeatureSource(refParts[0] || opt.name, [
							refParts[1],
							opt.source,
							Parser.SRC_XPHB,
							Parser.SRC_PHB,
						]);
						const page = CharacterSheetClassUtils.isCombatMethod(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
						const link = CharacterSheetPage.getHoverLink(page, refParts[0], resolvedSource);
						if (typeof link === "string") featOptName.innerHTML = link;
						else featOptName.append(link);
					} catch (e) {
						featOptName.innerHTML = `<strong>${opt.name}</strong>`;
					}
				} else {
					featOptName.innerHTML = `<strong>${opt.name}</strong>`;
				}

				if (!isDisabled) {
					item.addEventListener("click", () => {
						if (isSelected) {
							const idx = selectedList.findIndex(s => s.name === opt.name);
							if (idx >= 0) selectedList.splice(idx, 1);
						} else {
							if (optGroup.count === 1) {
								selectedList.length = 0;
							}
							if (selectedList.length >= optGroup.count) return;
							selectedList.push(opt);
						}
						for (const poolSec of (poolMap[poolKey] || [])) {
							renderSection(poolSec);
							poolSec.section.querySelector(".badge-primary").textContent =
								`${(this._selections.featureOptions[poolSec.levelKey] || []).length}/${poolSec.optGroup.count}`;
						}
					});
				}
				sec.list.append(item);
			});
		};

		// Build DOM for each section
		for (const sec of allSections) {
			const {analysis, optGroup, levelKey} = sec;
			const selectedList = this._selections.featureOptions[levelKey];

			const sectionEl = e_({outer: `
				<div class="charsheet__quickbuild-section mb-3">
					<h5>${analysis.className} Level ${analysis.classLevel} — ${optGroup.featureName}
						<span class="badge badge-primary">${selectedList.length}/${optGroup.count}</span>
					</h5>
				</div>
			`});
			const listEl = e_({outer: `<div></div>`});

			sec.section = sectionEl;
			sec.list = listEl;

			renderSection(sec);

			sectionEl.append(listEl);
			step.append(sectionEl);
		}

		content.append(step);
	}

	_validateFeatureOptionsStep (featureOptionLevels) {
		for (const analysis of featureOptionLevels) {
			for (const optGroup of analysis.featureOptions) {
				const levelKey = `${analysis.className}_${analysis.classLevel}_${optGroup.featureName}`;
				const selected = this._selections.featureOptions[levelKey] || [];
				if (selected.length < optGroup.count) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${optGroup.count} option${optGroup.count > 1 ? "s" : ""} for ${optGroup.featureName}.`});
					return false;
				}
			}
		}
		return true;
	}

	// ==========================================
	// Step 6: Expertise & Languages
	// ==========================================

	_renderExpertiseStep (content, {expertiseLevels, languageLevels, scholarLevel}) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Expertise, Languages & Scholar</h4>
				<p class="ve-muted">Configure skill expertise, language proficiencies, and scholar choices.</p>
			</div>
		`}));

		if (scholarLevel) {
			const section = e_({outer: `
				<div class="charsheet__quickbuild-section mb-3">
					<h5>Scholar Expertise (Wizard Level 2)</h5>
					<p class="ve-small ve-muted">Choose a skill to gain expertise in.</p>
				</div>
			`});

			const scholarSkills = ["arcana", "history", "investigation", "nature", "religion"];
			const listEl = e_({outer: `<div></div>`});
			scholarSkills.forEach(skill => {
				const isSelected = this._selections.scholarSkill === skill;
				const item = e_({outer: `
					<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 4px 8px; cursor: pointer;">
						<input type="radio" name="qb-scholar" ${isSelected ? "checked" : ""}>
						<strong class="ml-2">${(/** @type {*} */ (skill)).toTitleCase()}</strong>
					</div>
				`});
				item.addEventListener("click", () => {
					listEl.querySelectorAll(".charsheet__quickbuild-option").forEach(el => {
						el.classList.remove("selected");
						el.querySelector("input").checked = false;
					});
					item.classList.add("selected");
					item.querySelector("input").checked = true;
					this._selections.scholarSkill = skill;
				});
				listEl.append(item);
			});
			section.append(listEl);
			step.append(section);
		}

		if (expertiseLevels.length > 0) {
			expertiseLevels.forEach(analysis => {
				analysis.expertiseGrants.forEach(grant => {
					const levelKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
					if (!this._selections.expertise[levelKey]) {
						this._selections.expertise[levelKey] = [];
					}

					if (grant.fixedSkills?.length > 0) {
						this._selections.expertise[levelKey] = [...grant.fixedSkills];

						const section = e_({outer: `
							<div class="charsheet__quickbuild-section mb-3">
								<h5>${analysis.className} Level ${analysis.classLevel} — ${grant.featureName} Expertise
									<span class="badge badge-success">Auto</span>
								</h5>
								<p class="ve-small ve-muted">This feature grants expertise in specific skills:</p>
								<div class="ve-small" style="padding: 4px 8px;">
									${grant.fixedSkills.map(s => `<span class="badge badge-info mr-1">${s.toTitleCase()}</span>`).join("")}
								</div>
							</div>
						`});
						step.append(section);
						return;
					}

					const section = e_({outer: `
						<div class="charsheet__quickbuild-section mb-3">
							<h5>${analysis.className} Level ${analysis.classLevel} — ${grant.featureName} Expertise
								<span class="badge badge-primary">${this._selections.expertise[levelKey].length}/${grant.count || 2}</span>
							</h5>
						</div>
					`});

					const skillProfs = this._state._data?.skillProficiencies || {};
					const proficientSkills = Object.keys(skillProfs).filter(s => skillProfs[s] >= 1);

					const listEl = e_({outer: `<div></div>`});
					proficientSkills.forEach(skill => {
						const isSelected = this._selections.expertise[levelKey].includes(skill);
						const item = e_({outer: `
							<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 4px 8px; cursor: pointer;">
								<input type="checkbox" ${isSelected ? "checked" : ""}>
								<strong class="ml-2">${(/** @type {*} */ (skill)).toTitleCase()}</strong>
							</div>
						`});
						item.addEventListener("click", () => {
							const list = this._selections.expertise[levelKey];
							const maxCount = grant.count || 2;
							if (isSelected) {
								const idx = list.indexOf(skill);
								if (idx >= 0) list.splice(idx, 1);
							} else {
								if (list.length >= maxCount) return;
								list.push(skill);
							}
							section.querySelector(".badge").textContent = `${list.length}/${maxCount}`;
							item.classList.toggle("selected");
							item.querySelector("input").checked = !isSelected;
						});
						listEl.append(item);
					});
					section.append(listEl);
					step.append(section);
				});
			});
		}

		if (languageLevels.length > 0) {
			languageLevels.forEach(analysis => {
				analysis.languageGrants.forEach(grant => {
					const levelKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
					if (!this._selections.languages[levelKey]) {
						this._selections.languages[levelKey] = [];
					}

					const section = e_({outer: `
						<div class="charsheet__quickbuild-section mb-3">
							<h5>${analysis.className} Level ${analysis.classLevel} — ${grant.featureName} Languages
								<span class="badge badge-primary">${this._selections.languages[levelKey].length}/${grant.count}</span>
							</h5>
						</div>
					`});

					const allLanguages = this._page.getLanguagesList() || [];
					const knownLanguages = this._state.getLanguages().map(l => l.toLowerCase());

					const listEl = e_({outer: `<div style="max-height: 200px; overflow-y: auto;"></div>`});
					allLanguages
						.filter(l => !knownLanguages.includes(l.name?.toLowerCase()))
						.sort((a, b) => a.name.localeCompare(b.name))
						.forEach(lang => {
							const isSelected = this._selections.languages[levelKey].includes(lang.name);
							const item = e_({outer: `
								<div class="charsheet__quickbuild-option ve-small ${isSelected ? "selected" : ""}" style="padding: 4px 8px; cursor: pointer;">
									<input type="checkbox" ${isSelected ? "checked" : ""}>
									<strong class="ml-2">${lang.name}</strong>
								</div>
							`});
							item.addEventListener("click", () => {
								const list = this._selections.languages[levelKey];
								if (isSelected) {
									const idx = list.indexOf(lang.name);
									if (idx >= 0) list.splice(idx, 1);
								} else {
									if (list.length >= grant.count) return;
									list.push(lang.name);
								}
								section.querySelector(".badge").textContent = `${list.length}/${grant.count}`;
								item.classList.toggle("selected");
								item.querySelector("input").checked = !isSelected;
							});
							listEl.append(item);
						});
					section.append(listEl);
					step.append(section);
				});
			});
		}

		content.append(step);
	}

	_validateExpertiseStep ({expertiseLevels, languageLevels, scholarLevel}) {
		if (scholarLevel && !this._selections.scholarSkill) {
			JqueryUtil.doToast({type: "warning", content: "Please select a Scholar expertise skill."});
			return false;
		}

		for (const analysis of expertiseLevels) {
			for (const grant of analysis.expertiseGrants) {
				// Skip validation for fixed expertise (auto-populated)
				if (grant.fixedSkills?.length > 0) continue;

				const levelKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
				const selected = this._selections.expertise[levelKey] || [];
				const needed = grant.count || 2;
				if (selected.length < needed) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${needed} expertise skill${needed > 1 ? "s" : ""} for ${grant.featureName}.`});
					return false;
				}
			}
		}

		for (const analysis of languageLevels) {
			for (const grant of analysis.languageGrants) {
				const levelKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
				const selected = this._selections.languages[levelKey] || [];
				if (selected.length < grant.count) {
					JqueryUtil.doToast({type: "warning", content: `Please select ${grant.count} language${grant.count > 1 ? "s" : ""} for ${grant.featureName}.`});
					return false;
				}
			}
		}

		return true;
	}

	// ==========================================
	// Step 7: Spells
	// ==========================================

	_renderSpellsStep (content, {hasSpellcasting, spellbookLevels, knownCasterInfo, preparedCasterInfo}) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Spell Selection</h4>
				<p class="ve-muted">Select spells gained across all levels. Spells are organized by level.</p>
			</div>
		`}));

		if (spellbookLevels.length > 0) {
			const totalSpellbookSpells = spellbookLevels.length * 2;
			const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelForClass("Wizard", this._targetLevel);

			const existingSpellbook = this._state.getWizardSpellbook?.() || [];
			const knownSpellIds = new Set(existingSpellbook.map(s => `${s.name}|${s.source}`));

			const sourceFiltered = this._page.getFilteredSpellData();

			const section = CharacterSheetSpellPicker.renderWizardSpellbookPicker({
				spellCount: totalSpellbookSpells,
				maxSpellLevel,
				allSpells: sourceFiltered,
				knownSpellIds,
				className: "Wizard",
				subclass: this._state.getClasses()?.[0]?.subclass,
				subclassChoice: this._state.getClasses()?.[0]?.subclassChoice,
				additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
					className: "Wizard",
					subclass: this._state.getClasses()?.[0]?.subclass,
					subclassChoice: this._state.getClasses()?.[0]?.subclassChoice,
				}),
				onSelect: (spells) => {
					this._selections.spellbookSpells = spells;
				},
				getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
				preSelectedSpells: this._selections.spellbookSpells,
			});

			step.append(section);
		}

		if (knownCasterInfo) {
			this._renderKnownSpellPicker(step, knownCasterInfo);
		}

		if (preparedCasterInfo) {
			this._renderPreparedSpellPicker(step, preparedCasterInfo);
		}

		if (!knownCasterInfo && !preparedCasterInfo && hasSpellcasting && spellbookLevels.length === 0) {
			step.append(e_({outer: `
				<div class="charsheet__quickbuild-section mb-3">
					<p class="ve-muted">Spell preparation and known spell management can be done from the Spells tab after building your character. Your spell slots will be automatically calculated based on your class levels.</p>
				</div>
			`}));
		}

		content.append(step);
	}

	/**
	 * Render a known-spell picker section for the Quick Build spells step.
	 * Uses the shared CharacterSheetSpellPicker component.
	 */
	_renderKnownSpellPicker (step, knownCasterInfo) {
		const {className, classSource, totalSpells, totalCantrips, maxSpellLevel, levelBreakdown} = knownCasterInfo;

		if (levelBreakdown && levelBreakdown.length > 1) {
			const breakdown = this._renderLevelBreakdownPanel(levelBreakdown, className);
			step.append(breakdown);
		}

		const knownSpells = this._state.getSpells?.() || [];
		const knownCantrips = this._state.getCantripsKnown?.() || [];
		const knownSpellIds = new Set([...knownSpells, ...knownCantrips].map(s => `${s.name}|${s.source}`));

		const sourceFiltered = this._page.getFilteredSpellData();

		// Resolve subclass/subclassChoice from current selections (may have been updated in subclass step
		// after knownCasterInfo was captured at step-build time)
		const subclassKey = `${className}_${classSource}`;
		const resolvedSubclass = this._selections.subclasses[subclassKey] || knownCasterInfo.subclass;
		const resolvedSubclassChoice = this._selections.subclassChoices[subclassKey] || knownCasterInfo.subclassChoice;

		const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className,
			subclass: resolvedSubclass,
			subclassChoice: resolvedSubclassChoice,
		});

		const section = CharacterSheetSpellPicker.renderKnownSpellPicker({
			className,
			classSource,
			spellCount: totalSpells,
			cantripCount: totalCantrips,
			maxSpellLevel,
			allSpells: sourceFiltered,
			knownSpellIds,
			subclass: resolvedSubclass,
			subclassChoice: resolvedSubclassChoice,
			additionalClassNames,
			onSelect: (spells, cantrips) => {
				this._selections.knownSpells = spells;
				this._selections.knownCantrips = cantrips;
			},
			getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
			preSelectedSpells: this._selections.knownSpells,
			preSelectedCantrips: this._selections.knownCantrips,
		});

		step.append(section);
	}

	/**
	 * Render a collapsible panel showing per-level spell gain breakdown.
	 * Helps users understand where their spell budget comes from in multi-level builds.
	 */
	_renderLevelBreakdownPanel (levelBreakdown, className) {
		const totalSpells = levelBreakdown.reduce((sum, l) => sum + l.spellsGain, 0);
		const totalCantrips = levelBreakdown.reduce((sum, l) => sum + l.cantripsGain, 0);

		const parts = [];
		if (totalSpells > 0) parts.push(`${totalSpells} spell${totalSpells !== 1 ? "s" : ""}`);
		if (totalCantrips > 0) parts.push(`${totalCantrips} cantrip${totalCantrips !== 1 ? "s" : ""}`);

		const panel = e_({outer: `
			<div class="charsheet__qb-level-breakdown mb-3">
				<div class="charsheet__qb-level-breakdown-header">
					<span class="charsheet__qb-level-breakdown-toggle">
						<span class="charsheet__qb-level-breakdown-chevron">▶</span>
						<span class="charsheet__qb-level-breakdown-title">Level-by-Level Breakdown</span>
					</span>
					<span class="charsheet__qb-level-breakdown-summary">${parts.join(" + ")} total</span>
				</div>
				<div class="charsheet__qb-level-breakdown-body" style="display: none;"></div>
			</div>
		`});

		const toggle = panel.querySelector(".charsheet__qb-level-breakdown-toggle");
		const body = panel.querySelector(".charsheet__qb-level-breakdown-body");
		const chevron = panel.querySelector(".charsheet__qb-level-breakdown-chevron");

		toggle.addEventListener("click", () => {
			const isExpanded = body.style.display !== "none";
			body.style.display = isExpanded ? "none" : "";
			chevron.classList.toggle("charsheet__qb-level-breakdown-chevron--expanded", !isExpanded);
		});

		levelBreakdown.forEach(({level, spellsGain, cantripsGain}) => {
			const gains = [];
			if (spellsGain > 0) gains.push(`+${spellsGain} spell${spellsGain !== 1 ? "s" : ""}`);
			if (cantripsGain > 0) gains.push(`+${cantripsGain} cantrip${cantripsGain !== 1 ? "s" : ""}`);

			if (gains.length > 0) {
				body.append(e_({outer: `
					<div class="charsheet__qb-level-breakdown-item">
						<span class="charsheet__qb-level-breakdown-level">${className} Level ${level}</span>
						<span class="charsheet__qb-level-breakdown-gains">${gains.join(", ")}</span>
					</div>
				`}));
			}
		});

		return panel;
	}

	/**
	 * Render a prepared-spell picker section for the Quick Build spells step.
	 * Uses the shared CharacterSheetSpellPicker component (same UI as known-spell picker).
	 */
	_renderPreparedSpellPicker (step, preparedCasterInfo) {
		const {className, classSource, totalSpells, totalCantrips, maxSpellLevel} = preparedCasterInfo;

		const knownSpells = this._state.getSpells?.() || [];
		const knownCantrips = this._state.getCantripsKnown?.() || [];
		const preparedSpells = this._state.getPreparedSpells?.() || [];
		const knownSpellIds = new Set([...knownSpells, ...knownCantrips, ...preparedSpells].map(s => `${s.name}|${s.source}`));

		const sourceFiltered = this._page.getFilteredSpellData();

		const subclassKey = `${className}_${classSource}`;
		const resolvedSubclass = this._selections.subclasses[subclassKey] || preparedCasterInfo.subclass;
		const resolvedSubclassChoice = this._selections.subclassChoices[subclassKey] || preparedCasterInfo.subclassChoice;
		const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className,
			subclass: resolvedSubclass,
			subclassChoice: resolvedSubclassChoice,
		});

		const section = CharacterSheetSpellPicker.renderKnownSpellPicker({
			className,
			classSource,
			spellCount: totalSpells,
			cantripCount: totalCantrips,
			maxSpellLevel,
			allSpells: sourceFiltered,
			knownSpellIds,
			subclass: resolvedSubclass,
			subclassChoice: resolvedSubclassChoice,
			additionalClassNames,
			onSelect: (spells, cantrips) => {
				this._selections.preparedSpells = spells;
				this._selections.preparedCantrips = cantrips;
			},
			getHoverLink: (page, name, source) => CharacterSheetPage.getHoverLink(page, name, source),
			preSelectedSpells: this._selections.preparedSpells || [],
			preSelectedCantrips: this._selections.preparedCantrips || [],
		});

		step.append(section);
	}

	_validateSpellsStep ({hasSpellcasting, spellbookLevels, knownCasterInfo, preparedCasterInfo}) {
		// Spell selection in Quick Build is intentionally optional: whatever the
		// player picked is applied, and any remaining unspent spell/cantrip slots
		// can be filled later from the Spells tab. We do not gate or warn on
		// under-filled spell pools — the section already shows accurate counts.
		return true;
	}

	// ==========================================
	// Step 8: HP & Hit Dice
	// ==========================================

	_renderHpStep (content) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});

		const conMod = this._state.getAbilityMod("con");
		const levelsToGain = this._targetLevel - this._fromLevel;

		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Hit Points</h4>
				<p class="ve-muted">${levelsToGain} level${levelsToGain > 1 ? "s" : ""} to gain. Choose how to determine HP for each level.</p>
			</div>
		`}));

		const methodSection = e_({outer: `
			<div class="charsheet__quickbuild-section mb-3">
				<h5>HP Method</h5>
			</div>
		`});

		const avgRadio = e_({outer: `<label class="ve-flex-v-center gap-2 mb-1">
			<input type="radio" name="qb-hp-method" value="average" ${this._selections.hpMethod === "average" ? "checked" : ""}>
			<strong>Average HP (Recommended)</strong>
			<span class="ve-muted ve-small">— Uses the standard average value per level</span>
		</label>`});
		const rollRadio = e_({outer: `<label class="ve-flex-v-center gap-2 mb-1">
			<input type="radio" name="qb-hp-method" value="roll" ${this._selections.hpMethod === "roll" ? "checked" : ""}>
			<strong>Roll HP</strong>
			<span class="ve-muted ve-small">— Roll hit dice for each level</span>
		</label>`});

		avgRadio.querySelector("input").addEventListener("change", () => {
			this._selections.hpMethod = "average";
			renderHpDetails();
		});
		rollRadio.querySelector("input").addEventListener("change", () => {
			this._selections.hpMethod = "roll";
			renderHpDetails();
		});

		methodSection.append(avgRadio, rollRadio);
		step.append(methodSection);

		const details = e_({outer: `<div id="quickbuild-hp-details"></div>`});
		step.append(details);

		const renderHpDetails = () => {
			details.innerHTML = "";

			let totalHp = 0;
			const currentMaxHp = this._state.getMaxHp();
			const table = e_({outer: `<table class="table table-sm table-striped ve-small">
				<thead><tr><th>Level</th><th>Class</th><th>Hit Die</th><th>CON</th><th>HP Gain</th></tr></thead>
				<tbody></tbody>
			</table>`});
			const tbody = table.querySelector("tbody");

			for (const analysis of this._levelAnalysis) {
				const hitDie = CharacterSheetClassUtils.getClassHitDie(analysis.classData);
				const levelKey = `${analysis.className}_${analysis.classLevel}`;

				let hpGain;
				if (this._selections.hpMethod === "average") {
					hpGain = Math.ceil(hitDie / 2) + 1 + conMod;
				} else {
					if (!this._selections.hpRolls[levelKey]) {
						// Store BARE die roll (1..hitDie); conMod is added live so CON changes flow through.
						this._selections.hpRolls[levelKey] = Math.floor(Math.random() * hitDie) + 1;
					}
					hpGain = this._selections.hpRolls[levelKey] + conMod;
				}
				hpGain = Math.max(1, hpGain);
				totalHp += hpGain;

				const row = e_({outer: `
					<tr>
						<td>${analysis.characterLevel}</td>
						<td>${analysis.className} ${analysis.classLevel}</td>
						<td>d${hitDie}</td>
						<td>${conMod >= 0 ? "+" : ""}${conMod}</td>
						<td class="ve-bold">${hpGain}</td>
					</tr>
				`});

				if (this._selections.hpMethod === "roll") {
					const rerollTd = e_({outer: `<td><button class="ve-btn ve-btn-xs ve-btn-default" title="Re-roll">🎲</button></td>`});
					rerollTd.querySelector("button").addEventListener("click", () => {
						// Bare die roll — conMod added live during apply.
						this._selections.hpRolls[levelKey] = Math.floor(Math.random() * hitDie) + 1;
						renderHpDetails();
					});
					row.append(rerollTd);
				}

				tbody.append(row);
			}

			const summary = e_({outer: `
				<div class="charsheet__quickbuild-section p-2" style="background: rgba(16, 185, 129, 0.1); border-radius: 8px;">
					<strong>Total HP Gain: +${totalHp}</strong>
					<span class="ve-muted ml-2">(Current ${currentMaxHp} → ${currentMaxHp + totalHp})</span>
				</div>
			`});

			details.append(table, summary);

			if (this._selections.hpMethod === "roll") {
				const rollAllBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mt-2">🎲 Re-roll All</button>`});
				rollAllBtn.addEventListener("click", () => {
					this._selections.hpRolls = {};
					renderHpDetails();
				});
				details.append(rollAllBtn);
			}
		};

		renderHpDetails();
		content.append(step);
	}

	_validateHpStep () {
		return true; // HP is always valid (average or rolled)
	}

	// ==========================================
	// Step 9: Review & Confirm
	// ==========================================

	_renderReviewStep (content) {
		const step = e_({outer: `<div class="charsheet__quickbuild-step"></div>`});
		step.append(e_({outer: `
			<div class="charsheet__quickbuild-step-header">
				<h4>Review & Confirm</h4>
				<p class="ve-muted">Review your selections before building. Click "Build Character" to apply all changes.</p>
			</div>
		`}));

		// Helper to create hoverable entity link
		const makeHoverLink = (entity, page) => {
			try {
				// For spells, use getSpellHoverLink for charsheet-aware hover
				if (page === UrlUtil.PG_SPELLS && this._page?.getSpellHoverLink) {
					return this._page.getSpellHoverLink(entity.name, entity.source || "XPHB", entity, null);
				}
				const source = entity.source || "XPHB";
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page]?.(entity) || `${UrlUtil.encodeForHash(entity.name)}${HASH_PART_SEP}${UrlUtil.encodeForHash(source)}`;
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page, source, hash});
				return `<a href="${page}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${entity.name}</a>`;
			} catch (e) {
				return entity.name;
			}
		};

		// Helper to create hoverable subclass link
		const makeSubclassHoverLink = (subclass) => {
			try {
				const hash = `${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name: subclass.className, source: subclass.classSource})}${HASH_PART_SEP}${UrlUtil.getClassesPageStatePart({subclass})}`;
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({
					page: UrlUtil.PG_CLASSES,
					source: subclass.source,
					hash,
				});
				return `<a href="${UrlUtil.PG_CLASSES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${subclass.name}</a>`;
			} catch (e) {
				return subclass.name;
			}
		};

		// Class summary with hoverable subclass links
		const classSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>📊 Classes</h5></div>`});
		this._classAllocations.forEach(alloc => {
			const levelsGained = alloc.targetLevel - (alloc.currentLevel || 0);
			const subclass = this._selections.subclasses[`${alloc.className}_${alloc.classSource}`];
			const row = e_({outer: `<div class="ve-small mb-1"></div>`});
			const subclassHtml = subclass ? ` — <span class="text-info">${makeSubclassHoverLink(subclass)}</span>` : "";
			row.innerHTML = `
				<strong>${alloc.className}</strong> ${alloc.currentLevel || 0} → ${alloc.targetLevel}
				(+${levelsGained} level${levelsGained !== 1 ? "s" : ""})${subclassHtml}
			`;
			classSummary.append(row);
		});
		step.append(classSummary);

		// ASI / Feat summary with hoverable feat links
		const asiKeys = Object.keys(this._selections.asi);
		if (asiKeys.length > 0) {
			const asiSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>📈 ASI / Feats</h5></div>`});
			asiKeys.forEach(key => {
				const sel = this._selections.asi[key];
				const [className, classLevel] = key.split("_");
				const increases = Object.entries(sel.abilityChoices || {})
					.filter(([_, v]) => v > 0)
					.map(([abl, v]) => `${Parser.attAbvToFull(abl)} +${v}`);

				const row = e_({outer: `<div class="ve-small mb-1"></div>`});
				let rowContent = `${className} Lv${classLevel}: `;
				if (sel.isBoth) {
					const featLink = sel.feat ? makeHoverLink(sel.feat, UrlUtil.PG_FEATS) : "none";
					row.innerHTML = `${rowContent}ASI (${increases.join(", ") || "none"}) + Feat: ${featLink}`;
				} else if (sel.mode === "feat") {
					const featLink = sel.feat ? makeHoverLink(sel.feat, UrlUtil.PG_FEATS) : "none";
					row.innerHTML = `${rowContent}Feat: ${featLink}`;
				} else {
					row.innerHTML = `${rowContent}${increases.join(", ") || "none"}`;
				}
				asiSummary.append(row);
			});
			step.append(asiSummary);
		}

		// Optional features summary with hoverable links
		const optFeatKeys = Object.keys(this._selections.optionalFeatures);
		if (optFeatKeys.length > 0) {
			const optSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>✨ Class Options</h5></div>`});
			const byType = {};
			optFeatKeys.forEach(key => {
				const list = this._selections.optionalFeatures[key];
				if (list.length > 0) {
					const typeName = key.split("_").slice(2).join(" ") || "Options";
					if (!byType[typeName]) byType[typeName] = [];
					byType[typeName].push(...list);
				}
			});
			Object.entries(byType).forEach(([typeName, items]) => {
				const row = e_({outer: `<div class="ve-small mb-1"></div>`});
				const links = items.map(f => {
					const page = CharacterSheetClassUtils.isCombatMethod(f) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					return makeHoverLink(f, page);
				}).join(", ");
				row.innerHTML = `<strong>${typeName}</strong> (${items.length}): ${links}`;
				optSummary.append(row);
			});
			step.append(optSummary);
		}

		// Feature options summary with hoverable links
		const featOptKeys = Object.keys(this._selections.featureOptions);
		if (featOptKeys.length > 0) {
			const featOptSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>🎯 Feature Choices</h5></div>`});
			featOptKeys.forEach(key => {
				const list = this._selections.featureOptions[key];
				if (list.length > 0) {
					const parts = key.split("_");
					const className = parts[0];
					const classLevel = parts[1];
					const featureName = parts.slice(2).join("_");
					const row = e_({outer: `<div class="ve-small mb-1"><strong>${featureName}</strong> (${className} ${classLevel}): </div>`});
					const links = list.map(f => {
						if (f.featureType || f.type === "optionalfeature") {
							const page = CharacterSheetClassUtils.isCombatMethod(f) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
							return CharacterSheetPage.getHoverLink(page, f.name, f.source || Parser.SRC_XPHB);
						}
						if (f.type === "classFeature" && f.ref) {
							try {
								const refParts = f.ref.split("|");
								const featureSource = refParts[2] || f.source || "XPHB";
								const hash = UrlUtil.encodeArrayForHash(refParts[0], refParts[1], refParts[2], refParts[3], featureSource);
								const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
								return `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${f.name}</a>`;
							} catch (e) {
								return f.name;
							}
						}
						if (f.source) {
							const page = CharacterSheetClassUtils.isCombatMethod(f) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
							return CharacterSheetPage.getHoverLink(page, f.name, f.source);
						}
						return f.name;
					});
					links.forEach((link, i) => {
						if (i > 0) row.append(", ");
						if (typeof link === "string") {
							const span = e_({outer: `<span></span>`});
							span.innerHTML = link;
							row.append(span);
						} else {
							row.append(link);
						}
					});
					featOptSummary.append(row);
				}
			});
			step.append(featOptSummary);
		}

		// Spellbook summary with hoverable spell links
		if (this._selections.spellbookSpells.length > 0) {
			const spellSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>📕 Spellbook Spells</h5></div>`});
			const byLevel = {};
			this._selections.spellbookSpells.forEach(s => {
				if (!byLevel[s.level]) byLevel[s.level] = [];
				byLevel[s.level].push(s);
			});
			Object.entries(byLevel).sort(([a], [b]) => Number(a) - Number(b)).forEach(([lvl, spells]) => {
				const row = e_({outer: `<div class="ve-small mb-1"></div>`});
				const links = spells.map(sp => makeHoverLink(sp, UrlUtil.PG_SPELLS)).join(", ");
				row.innerHTML = `Level ${lvl}: ${links}`;
				spellSummary.append(row);
			});
			step.append(spellSummary);
		}

		// Known spells summary with hoverable links
		if (this._selections.knownSpells.length > 0 || this._selections.knownCantrips.length > 0) {
			const knownSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>🔮 Spells Known</h5></div>`});
			if (this._selections.knownCantrips.length > 0) {
				const row = e_({outer: `<div class="ve-small mb-1"></div>`});
				const links = this._selections.knownCantrips.map(sp => makeHoverLink(sp, UrlUtil.PG_SPELLS)).join(", ");
				row.innerHTML = `Cantrips: ${links}`;
				knownSummary.append(row);
			}
			if (this._selections.knownSpells.length > 0) {
				const byLevel = {};
				this._selections.knownSpells.forEach(s => {
					if (!byLevel[s.level]) byLevel[s.level] = [];
					byLevel[s.level].push(s);
				});
				Object.entries(byLevel).sort(([a], [b]) => Number(a) - Number(b)).forEach(([lvl, spells]) => {
					const row = e_({outer: `<div class="ve-small mb-1"></div>`});
					const links = spells.map(sp => makeHoverLink(sp, UrlUtil.PG_SPELLS)).join(", ");
					row.innerHTML = `Level ${lvl}: ${links}`;
					knownSummary.append(row);
				});
			}
			step.append(knownSummary);
		}

		// Expertise & Languages summary
		const hasExpertise = Object.keys(this._selections.expertise).some(k => this._selections.expertise[k]?.length > 0);
		const hasLanguages = Object.keys(this._selections.languages).some(k => this._selections.languages[k]?.length > 0);
		const hasScholar = this._selections.scholarSkill;

		if (hasExpertise || hasLanguages || hasScholar) {
			const expertiseSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>🎓 Expertise & Languages</h5></div>`});

			if (hasScholar) {
				expertiseSummary.append(e_({outer: `<div class="ve-small mb-1"><strong>Scholar:</strong> ${this._selections.scholarSkill.toTitleCase()} expertise</div>`}));
			}

			Object.entries(this._selections.expertise).forEach(([key, skills]) => {
				if (skills?.length > 0) {
					const parts = key.split("_");
					const className = parts[0];
					const classLevel = parts[1];
					const featureName = parts.slice(2).join("_");
					expertiseSummary.append(e_({outer: `<div class="ve-small mb-1"><strong>${featureName}</strong> (${className} ${classLevel}): ${skills.map(s => s.toTitleCase()).join(", ")}</div>`}));
				}
			});

			const allLanguages = this._page.getLanguagesList() || [];
			Object.entries(this._selections.languages).forEach(([key, langs]) => {
				if (langs?.length > 0) {
					const parts = key.split("_");
					const className = parts[0];
					const classLevel = parts[1];
					const featureName = parts.slice(2).join("_");
					const row = e_({outer: `<div class="ve-small mb-1"><strong>${featureName}</strong> (${className} ${classLevel}): </div>`});
					const langLinks = langs.map(langName => {
						const langData = allLanguages.find(l => l.name === langName);
						if (langData) {
							return CharacterSheetPage.getHoverLink(UrlUtil.PG_LANGUAGES, langData.name, langData.source);
						}
						return langName;
					});
					langLinks.forEach((link, i) => {
						if (i > 0) row.append(", ");
						if (typeof link === "string") {
							const span = e_({outer: `<span></span>`});
							span.innerHTML = link;
							row.append(span);
						} else {
							row.append(link);
						}
					});
					expertiseSummary.append(row);
				}
			});

			step.append(expertiseSummary);
		}

		// HP summary
		const conMod = this._state.getAbilityMod("con");
		let totalHp = 0;
		for (const analysis of this._levelAnalysis) {
			const hitDie = CharacterSheetClassUtils.getClassHitDie(analysis.classData);
			const levelKey = `${analysis.className}_${analysis.classLevel}`;
			if (this._selections.hpMethod === "average") {
				totalHp += Math.max(1, Math.ceil(hitDie / 2) + 1 + conMod);
			} else {
				const rolledGain = this._selections.hpRolls[levelKey] != null
					? this._selections.hpRolls[levelKey] + conMod
					: (Math.ceil(hitDie / 2) + 1 + conMod);
				totalHp += Math.max(1, rolledGain);
			}
		}

		const hpSummary = e_({outer: `
			<div class="charsheet__quickbuild-section mb-3">
				<h5>❤️ Hit Points</h5>
				<div class="ve-small">
					Method: <strong>${this._selections.hpMethod === "average" ? "Average" : "Rolled"}</strong><br>
					HP Gained: <strong>+${totalHp}</strong>
					(${this._state.getMaxHp()} → ${this._state.getMaxHp() + totalHp})
				</div>
			</div>
		`});
		step.append(hpSummary);

		// Features gained - enhanced with hover links and styled cards
		const featureSummary = e_({outer: `<div class="charsheet__quickbuild-section mb-3"><h5>⭐ Features Gained</h5></div>`});
		const allFeatures = [];
		const seenFeatureKeys = new Set();

		for (const analysis of this._levelAnalysis) {
			(analysis.features || []).forEach(f => {
				if (f.gainSubclassFeature) return; // Skip placeholder features
				const featureKey = `${f.name}|${f.source || ""}`;
				if (seenFeatureKeys.has(featureKey)) return;
				seenFeatureKeys.add(featureKey);
				allFeatures.push({
					...f,
					_className: analysis.className,
					_classSource: analysis.classSource,
					_classLevel: analysis.classLevel,
				});
			});
		}

		if (allFeatures.length > 0) {
			const featureList = e_({outer: `<div class="charsheet__quickbuild-features-list"></div>`});

			allFeatures.forEach(feature => {
				const truncatedDesc = (() => {
					if (!feature.entries) return "";
					try {
						const rendered = Renderer.get().render({entries: feature.entries});
						const textOnly = rendered.replace(/<[^>]*>/g, "").substring(0, 150);
						return textOnly.length >= 150 ? `${textOnly}...` : textOnly;
					} catch (e) {
						const firstEntry = feature.entries.find(e => typeof e === "string") || "";
						return firstEntry.substring(0, 150) + (firstEntry.length >= 150 ? "..." : "");
					}
				})();

				const featureCard = e_({outer: `
					<div class="charsheet__quickbuild-feature-card" style="border-left: 3px solid #f59e0b; background: linear-gradient(90deg, rgba(245, 158, 11, 0.08), transparent); padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; border-radius: 4px;">
						<div class="ve-flex-v-center ve-small">
							<span style="margin-right: 0.25rem;">⭐</span>
							<span class="qb-feature-name"></span>
							<span class="ve-muted ml-1">(${feature._className} ${feature._classLevel})</span>
						</div>
						${truncatedDesc ? `<div class="ve-muted ve-small mt-1" style="font-size: 0.75rem; line-height: 1.3;">${truncatedDesc}</div>` : ""}
					</div>
				`});

				const featureName = featureCard.querySelector(".qb-feature-name");
				try {
					const featureSource = feature.source || feature._classSource || "XPHB";
					if (feature.className || feature._className) {
						const hash = UrlUtil.encodeArrayForHash([
							feature.name,
							feature.className || feature._className,
							feature.classSource || feature._classSource,
							feature.level || feature._classLevel,
							featureSource,
						]);
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({
							page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES,
							source: featureSource,
							hash,
						});
						featureName.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer"><strong>${feature.name}</strong></a>`;
					} else {
						featureName.innerHTML = `<strong>${feature.name}</strong>`;
					}
				} catch (e) {
					featureName.innerHTML = `<strong>${feature.name}</strong>`;
				}

				featureList.append(featureCard);
			});

			featureSummary.append(featureList);
		} else {
			featureSummary.append(e_({outer: `<div class="ve-small ve-muted">No new features.</div>`}));
		}
		step.append(featureSummary);

		content.append(step);
	}

	// ==========================================
	// Batch Apply Engine
	// ==========================================

	/**
	 * Apply all Quick Build selections to the character state.
	 * Mirrors _applyLevelUp() from CharacterSheetLevelUp but processes multiple levels at once.
	 */
	async _applyQuickBuild () {
		const conMod = this._state.getAbilityMod("con");
		const pendingHistoryEntries = [];

		// Process each level in order
		for (const analysis of this._levelAnalysis) {
			const {characterLevel, className, classSource, classLevel, classData, features} = analysis;
			const levelKey = `${className}_${classLevel}`;

			// 1. Resolve subclass if this is the subclass level
			let selectedSubclass = null;
			if (analysis.needsSubclass) {
				selectedSubclass = this._selections.subclasses[`${className}_${classSource}`];
			}

			// Re-compute features with subclass if just selected
			let levelFeatures = features;
			if (selectedSubclass) {
				levelFeatures = this._getLevelFeatures(classData, classLevel, selectedSubclass);
			}

			// 2. Update class level
			const classes = this._state.getClasses();
			const targetClass = classes.find(c => c.name === className && c.source === classSource);

			if (targetClass) {
				targetClass.level = classLevel;
				if (selectedSubclass) {
					targetClass.subclass = {
						name: selectedSubclass.name,
						shortName: selectedSubclass.shortName,
						source: selectedSubclass.source,
						casterProgression: selectedSubclass.casterProgression,
						spellcastingAbility: selectedSubclass.spellcastingAbility,
						additionalSpells: selectedSubclass.additionalSpells,
					};
					if (selectedSubclass.casterProgression && !targetClass.casterProgression) {
						targetClass.casterProgression = selectedSubclass.casterProgression;
						targetClass.spellcastingAbility = selectedSubclass.spellcastingAbility;
					}
				}
				targetClass.subclassChoice = this._selections.subclassChoices[`${className}_${classSource}`] || targetClass.subclassChoice || null;
			} else if (classLevel === 1) {
				// New multiclass — add to state
				this._state.addClass({
					name: className,
					source: classSource,
					level: 1,
					subclass: null,
					subclassChoice: this._selections.subclassChoices[`${className}_${classSource}`] || null,
					casterProgression: classData.casterProgression,
					spellcastingAbility: classData.spellcastingAbility,
					// Spell progression arrays for 2024/TGTT classes
					preparedSpellsProgression: classData.preparedSpellsProgression,
					spellsKnownProgression: classData.spellsKnownProgression,
					cantripProgression: classData.cantripProgression,
				});
			}

			this._state.ensureXpMatchesLevel();
			this._state.ensureUnarmedStrike();

			// 3. Apply ASI / Feat
			if (analysis.hasAsi) {
				const asiSel = this._selections.asi[levelKey];
				if (asiSel) {
					const classEntry = {name: className, source: classSource};
					this._applyAsiOrFeat(asiSel, classEntry, classLevel, classData);
				}
			}

			// 4. Apply Optional Features for this level
			if (analysis.optionalFeatureGains.length > 0) {
				this._applyOptionalFeaturesForLevel(analysis, levelKey);
			}

			// 5. Apply Feature Options for this level
			if (analysis.featureOptions.length > 0) {
				this._applyFeatureOptionsForLevel(analysis);
			}

			// 6. Apply Expertise
			if (analysis.expertiseGrants.length > 0) {
				for (const grant of analysis.expertiseGrants) {
					const expKey = `${className}_${classLevel}_${grant.featureName}`;
					const skills = this._selections.expertise[expKey] || [];
					skills.forEach(skill => this._state.addExpertise(skill.toLowerCase()));
				}
			}

			// 7. Apply Scholar
			if (analysis.isScholarLevel && this._selections.scholarSkill) {
				this._state.setScholarExpertise(this._selections.scholarSkill);
			}

			// 8. Apply Languages
			if (analysis.languageGrants.length > 0) {
				for (const grant of analysis.languageGrants) {
					// First add any auto-languages (like Thieves' Cant)
					if (grant.autoLanguages?.length > 0) {
						grant.autoLanguages.forEach(lang => this._state.addLanguage(lang));
					}
					// Then add user-selected languages
					const langKey = `${className}_${classLevel}_${grant.featureName}`;
					const langs = this._selections.languages[langKey] || [];
					langs.forEach(lang => this._state.addLanguage(lang));
				}
			}

			// 9. HP is applied in bulk AFTER history is recorded so _calculateMaxHp can
			// see per-level hpRoll entries and any feat/race hpPerLevel modifiers added below.

			// 10. Add features
			const existingClassFeatureNames = this._state.getFeatures()
				.filter(f => f.className === className && !f.subclassName && !f.isSubclassFeature)
				.map(f => f.name.toLowerCase());

			CharacterSheetClassUtils.dedupAndBuildFeatures(levelFeatures, existingClassFeatureNames, {
				className,
				classSource: classData.source,
				level: classLevel,
			}).forEach(feature => this._state.addFeature(feature));

			// 11. Update hit dice
			CharacterSheetClassUtils.updateHitDice(this._state, classData);

			// 12. Update class resources
			const classEntry = this._state.getClasses().find(c => c.name === className && c.source === classSource);
			if (classEntry) {
				CharacterSheetClassUtils.updateClassResources(this._state, classEntry, classLevel, classData);
			}

			// 13. Update spell slots
			if (classEntry) {
				CharacterSheetClassUtils.updateSpellSlots(this._state, classEntry, classLevel, classData);
			}

			// 14. Stage level history entry (record after global selections are finalized)
			const historyEntry = this._buildHistoryEntry(analysis, levelKey);
			pendingHistoryEntries.push(historyEntry);
		}

		// Recalculate HP from scratch and sync current = max.
		// Must happen AFTER history (so per-level hpRoll values flow into _calculateMaxHp)
		// AND after features/feats are applied (so customModifiers.hpPerLevel from Toughness etc. are present).
		// History recording is moved BEFORE the recalc below.

		// Post-loop finalizations

		// Apply weapon masteries
		if (this._selections.weaponMasteries?.length > 0) {
			this._state.setWeaponMasteries(this._selections.weaponMasteries);
		}

		// Apply combat traditions (if selected during QB)
		if (this._selections._combatTraditions != null) {
			this._state.setCombatTraditions(this._selections._combatTraditions);
		}

		// Record level history BEFORE the final HP recalc so _calculateMaxHp sees stored hpRoll values.
		pendingHistoryEntries.forEach(entry => this._state.recordLevelChoice(entry));

		// Now compute max HP from history + live CON + customModifiers, and sync current = max.
		this._state.recalculateHp({syncCurrent: true});

		// Enrich history with replay-critical global choices at selection-relevant levels
		const finalCombatTraditions = this._state.getCombatTraditions?.() || [];
		if (finalCombatTraditions.length > 0) {
			const firstCtmLevel = this._levelAnalysis
				.find(a => a.optionalFeatureGains?.some(g => (g.featureTypes || []).some(ft => ft.startsWith("CTM:"))))
				?.characterLevel;

			if (firstCtmLevel != null) {
				this._state.updateLevelChoice(firstCtmLevel, {
					combatTraditions: [...finalCombatTraditions],
				});
			}
		}

		const finalWeaponMasteries = this._state.getWeaponMasteries?.() || [];
		if (finalWeaponMasteries.length > 0) {
			let lastCount = 0;
			let lastMasteryGainLevel = null;
			this._levelAnalysis.forEach(a => {
				const currentCount = a.weaponMasteryCount || 0;
				if (currentCount > lastCount) {
					lastMasteryGainLevel = a.characterLevel;
				}
				lastCount = Math.max(lastCount, currentCount);
			});

			if (lastMasteryGainLevel != null) {
				this._state.updateLevelChoice(lastMasteryGainLevel, {
					weaponMasteries: [...finalWeaponMasteries],
				});
			}
		}

		// Apply spellbook spells
		if (this._selections.spellbookSpells.length > 0) {
			this._selections.spellbookSpells.forEach(spell => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Wizard Spellbook",
					sourceClass: "Wizard",
					inSpellbook: true,
				}));
			});
		}

		// Apply known spells (Sorcerer, Bard, Ranger, Warlock, etc.)
		if (this._selections.knownSpells.length > 0) {
			const knownClassName = this._classAllocations.find(a =>
				!a.classData?.preparedSpellsProgression && a.classData?.name !== "Wizard",
			)?.className;
			this._selections.knownSpells.forEach(spell => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Spells Known",
					sourceClass: knownClassName || "",
				}));
			});
		}

		// Apply known cantrips
		if (this._selections.knownCantrips.length > 0) {
			const knownClassName = this._classAllocations.find(a =>
				!a.classData?.preparedSpellsProgression && a.classData?.name !== "Wizard",
			)?.className;
			this._selections.knownCantrips.forEach(spell => {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Cantrips Known",
					sourceClass: knownClassName || "",
				}));
			});
		}

		const divineSoulClass = this._classAllocations.find(a => CharacterSheetClassUtils.isDivineSoulSubclass(this._selections.subclasses[`${a.className}_${a.classSource}`]));
		if (divineSoulClass) {
			this._state.setSubclassChoice(divineSoulClass.className, this._selections.subclassChoices[`${divineSoulClass.className}_${divineSoulClass.classSource}`]);
			this._state.ensureDivineSoulKnownSpell(divineSoulClass.className);
		}

		// Apply prepared spells (XPHB Warlock, etc.)
		if (this._selections.preparedSpells?.length > 0) {
			const prepClassName = this._classAllocations.find(a =>
				a.classData?.preparedSpellsProgression,
			)?.className;
			this._selections.preparedSpells.forEach(spell => {
				this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
					sourceFeature: "Prepared Spells",
					sourceClass: prepClassName || "",
					prepared: true,
				}));
			});
		}

		// Apply prepared cantrips
		if (this._selections.preparedCantrips?.length > 0) {
			const prepClassName = this._classAllocations.find(a =>
				a.classData?.preparedSpellsProgression,
			)?.className;
			this._selections.preparedCantrips.forEach(spell => {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Prepared Spells",
					sourceClass: prepClassName || "",
				}));
			});
		}

		// Check racial spells
		CharacterSheetClassUtils.updateRacialSpells(this._state, this._page);

		// Process any pending spell choices from feats or features that grant selectable spells
		if (this._page._spells?.processPendingSpellChoices) {
			await this._page._spells.processPendingSpellChoices();
		}

		// Final recalculations
		this._state.ensureXpMatchesLevel();
		this._state.applyClassFeatureEffects();
		this._state.calculateSpellSlots();
		this._state.recalculateAllCompanions();

		// Save and re-render
		await this._page.saveCharacter();
		this._page.renderCharacter();
		this._page._updateTabVisibility();

		const levelsGained = this._targetLevel - this._fromLevel;
		JqueryUtil.doToast({
			type: "success",
			content: `Quick Build complete! Gained ${levelsGained} level${levelsGained !== 1 ? "s" : ""} (now level ${this._targetLevel}).`,
		});
	}

	// ==========================================
	// Apply Helpers
	// ==========================================

	_applyAsiOrFeat (asiSel, classEntry, classLevel, classData) {
		if (asiSel.isBoth) {
			// Apply ASI
			const increases = [];
			Parser.ABIL_ABVS.forEach(abl => {
				if (asiSel.abilityChoices?.[abl]) {
					const currentBase = this._state.getAbilityBase(abl);
					this._state.setAbilityBase(abl, Math.min(20, currentBase + asiSel.abilityChoices[abl]));
					increases.push(`${Parser.attAbvToFull(abl)} +${asiSel.abilityChoices[abl]}`);
				}
			});
			if (increases.length > 0) {
				this._state.addFeature({
					name: "Ability Score Improvement",
					source: classData.source,
					className: classEntry.name,
					classSource: classEntry.source,
					level: classLevel,
					featureType: "Class",
					description: `<p><strong>Ability Score Increases:</strong> ${increases.join(", ")}</p>`,
					isAsiChoice: true,
				});
			}
			// Apply feat
			if (asiSel.feat) {
				this._state.addFeat(asiSel.feat, {allSpells: this._page.getSpells()});
				CharacterSheetClassUtils.applyFeatBonuses(this._state, asiSel.feat, asiSel.featChoices);
			}
		} else if (asiSel.mode === "feat" && asiSel.feat) {
			this._state.addFeat(asiSel.feat, {allSpells: this._page.getSpells()});
			CharacterSheetClassUtils.applyFeatBonuses(this._state, asiSel.feat, asiSel.featChoices);
		} else if (asiSel.mode === "asi") {
			const increases = [];
			Parser.ABIL_ABVS.forEach(abl => {
				if (asiSel.abilityChoices?.[abl]) {
					const currentBase = this._state.getAbilityBase(abl);
					this._state.setAbilityBase(abl, Math.min(20, currentBase + asiSel.abilityChoices[abl]));
					increases.push(`${Parser.attAbvToFull(abl)} +${asiSel.abilityChoices[abl]}`);
				}
			});
			if (increases.length > 0) {
				this._state.addFeature({
					name: "Ability Score Improvement",
					source: classData.source,
					className: classEntry.name,
					classSource: classEntry.source,
					level: classLevel,
					featureType: "Class",
					description: `<p><strong>Ability Score Increases:</strong> ${increases.join(", ")}</p>`,
					isAsiChoice: true,
				});
			}
		}
	}

	_applyOptionalFeaturesForLevel (analysis, levelKey) {
		// Distribute selected optional features to this level
		analysis.optionalFeatureGains.forEach(gain => {
			const key = gain.featureTypes.join("_");
			const allSelected = this._selections.optionalFeatures[key] || [];
			// Take the next N unassigned
			const alreadyAssigned = this._levelAnalysis
				.filter(a => a !== analysis)
				.reduce((count, a) => {
					return count + a.optionalFeatureGains
						.filter(g => g.featureTypes.join("_") === key)
						.reduce((s, g) => s + g.newCount, 0);
				}, 0);

			// This is simplified — just assign features from the pool in order
			const startIdx = this._getOptionalFeatureStartIndex(key, analysis);
			const endIdx = startIdx + gain.newCount;
			const assigned = allSelected.slice(startIdx, endIdx);

			assigned.forEach(opt => {
				this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
					className: analysis.className,
					classSource: analysis.classSource,
					level: analysis.classLevel,
					featureType: "Optional Feature",
					optionalFeatureTypes: opt.featureType || gain.featureTypes,
				}));
			});
		});
	}

	_getOptionalFeatureStartIndex (typeKey, targetAnalysis) {
		let idx = 0;
		for (const analysis of this._levelAnalysis) {
			if (analysis === targetAnalysis) break;
			for (const gain of analysis.optionalFeatureGains) {
				if (gain.featureTypes.join("_") === typeKey) {
					idx += gain.newCount;
				}
			}
		}
		return idx;
	}

	_applyFeatureOptionsForLevel (analysis) {
		analysis.featureOptions.forEach(optGroup => {
			const levelKey = `${analysis.className}_${analysis.classLevel}_${optGroup.featureName}`;
			const selected = this._selections.featureOptions[levelKey] || [];

			selected.forEach(opt => {
				if (opt.type === "classFeature" && opt.ref) {
					const classFeatures = this._page.getClassFeatures();
					const parts = opt.ref.split("|");
					const fullOpt = classFeatures.find(f =>
						f.name === parts[0] && f.className === parts[1] && f.source === parts[2],
					);
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{
							...(fullOpt || {}),
							...opt,
							entries: fullOpt?.entries ?? opt.entries,
						},
						{
							className: analysis.className,
							classSource: analysis.classSource,
							level: opt.level || analysis.classLevel,
							featureType: "Class",
							isFeatureOption: true,
							parentFeature: optGroup.featureName,
						},
					));
				} else if (opt.type === "subclassFeature" && opt.ref) {
					const subclass = this._getSubclassForClass(analysis.className, analysis.classSource, analysis.classLevel);
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(opt, {
						className: analysis.className,
						classSource: analysis.classSource,
						level: opt.level || analysis.classLevel,
						featureType: "Class",
						subclassName: subclass?.name,
						subclassShortName: opt.subclassShortName || subclass?.shortName,
						subclassSource: opt.subclassSource || subclass?.source,
						isSubclassFeature: true,
						isFeatureOption: true,
						parentFeature: optGroup.featureName,
					}));
				} else if (opt.type === "optionalfeature" && opt.ref) {
					const allOptFeats = this._page.getOptionalFeatures();
					const fullOpt = allOptFeats.find(f => f.name === opt.name);
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{
							...(fullOpt || {}),
							...opt,
							entries: fullOpt?.entries ?? opt.entries,
						},
						{
							className: analysis.className,
							classSource: analysis.classSource,
							level: analysis.classLevel,
							featureType: "Optional Feature",
							isFeatureOption: true,
							parentFeature: optGroup.featureName,
						},
					));
				}
			});
		});
	}

	_buildHistoryEntry (analysis, levelKey) {
		const entry = {
			level: analysis.characterLevel,
			class: {name: analysis.className, source: analysis.classSource},
			choices: {},
			complete: true,
			timestamp: Date.now(),
		};

		// HP roll (bare die value, no conMod). Only persisted in "roll" mode and only above L1
		// (L1 always uses max hit die per RAW; _calculateMaxHp ignores hpRoll at the first level).
		if (this._selections.hpMethod === "roll"
			&& analysis.characterLevel > 1
			&& typeof this._selections.hpRolls[levelKey] === "number") {
			entry.choices.hpRoll = this._selections.hpRolls[levelKey];
		}

		// ASI / Feat
		const asiSel = this._selections.asi[levelKey];
		if (asiSel) {
			if (asiSel.feat) {
				entry.choices.feat = {name: asiSel.feat.name, source: asiSel.feat.source};
			}
			const asiData = {};
			Parser.ABIL_ABVS.forEach(abl => {
				if (asiSel.abilityChoices?.[abl]) asiData[abl] = asiSel.abilityChoices[abl];
			});
			if (Object.keys(asiData).length > 0) entry.choices.asi = asiData;
		}

		// Subclass
		const subclass = this._selections.subclasses[`${analysis.className}_${analysis.classSource}`];
		if (analysis.needsSubclass && subclass) {
			entry.choices.subclass = {name: subclass.name, shortName: subclass.shortName, source: subclass.source};
			const subclassChoice = this._selections.subclassChoices[`${analysis.className}_${analysis.classSource}`];
			if (subclassChoice) entry.choices.subclassChoice = CharacterSheetClassUtils.normalizeDivineSoulAffinity(subclassChoice);
		}

		// Optional features
		const optFeatures = [];
		const optFeatureReplay = [];
		analysis.optionalFeatureGains.forEach(gain => {
			const key = gain.featureTypes.join("_");
			const startIdx = this._getOptionalFeatureStartIndex(key, analysis);
			const allSelected = this._selections.optionalFeatures[key] || [];
			const assigned = allSelected.slice(startIdx, startIdx + gain.newCount);
			assigned.forEach(opt => {
				optFeatures.push({name: opt.name, source: opt.source, type: key});
				optFeatureReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
					type: key,
				}));
			});
		});
		if (optFeatures.length > 0) {
			entry.choices.optionalFeatures = optFeatures;
			entry.choices.replayData = entry.choices.replayData || {};
			entry.choices.replayData.optionalFeatures = optFeatureReplay;
		}

		// Feature options
		const featureChoices = [];
		const featureChoiceReplay = [];
		analysis.featureOptions.forEach(optGroup => {
			const selKey = `${analysis.className}_${analysis.classLevel}_${optGroup.featureName}`;
			const selected = this._selections.featureOptions[selKey] || [];
			selected.forEach(opt => {
				featureChoices.push({featureName: optGroup.featureName, choice: opt.name, source: opt.source});
				featureChoiceReplay.push(CharacterSheetClassUtils.buildHistoryFeatureSnapshot(opt, {
					type: opt.type || "featureOption",
					parentFeature: optGroup.featureName,
				}));
			});
		});
		if (featureChoices.length > 0) {
			entry.choices.featureChoices = featureChoices;
			entry.choices.replayData = entry.choices.replayData || {};
			entry.choices.replayData.featureChoices = featureChoiceReplay;
		}

		// Expertise
		analysis.expertiseGrants.forEach(grant => {
			const expKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
			const skills = this._selections.expertise[expKey] || [];
			if (skills.length > 0) entry.choices.expertise = skills.map(s => s.toLowerCase());
		});

		// Languages
		analysis.languageGrants.forEach(grant => {
			const langKey = `${analysis.className}_${analysis.classLevel}_${grant.featureName}`;
			const langs = this._selections.languages[langKey] || [];
			if (langs.length > 0) {
				entry.choices.languages = langs.map(l => ({featureName: grant.featureName, language: l}));
			}
		});

		// Scholar
		if (analysis.isScholarLevel && this._selections.scholarSkill) {
			entry.choices.scholarSkill = this._selections.scholarSkill;
		}

		return entry;
	}
}

// Export
export {CharacterSheetQuickBuild};
globalThis.CharacterSheetQuickBuild = CharacterSheetQuickBuild;
