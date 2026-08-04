class CharacterSheetNpcExporter {
	static SOURCE_JSON_DEFAULT = "CSHEET";
	static SOURCE_FULL_DEFAULT = "Character Sheet NPC Exports";
	static SOURCE_VERSION_DEFAULT = "1.0.0";

	// Simplified DMG-style HP thresholds by CR index (aligned to classic tables).
	static _CR_HP_THRESHOLDS = [
		{cr: "0", hp: 6}, {cr: "1/8", hp: 35}, {cr: "1/4", hp: 49}, {cr: "1/2", hp: 70},
		{cr: "1", hp: 85}, {cr: "2", hp: 100}, {cr: "3", hp: 115}, {cr: "4", hp: 130},
		{cr: "5", hp: 145}, {cr: "6", hp: 160}, {cr: "7", hp: 175}, {cr: "8", hp: 190},
		{cr: "9", hp: 205}, {cr: "10", hp: 220}, {cr: "11", hp: 235}, {cr: "12", hp: 250},
		{cr: "13", hp: 265}, {cr: "14", hp: 280}, {cr: "15", hp: 295}, {cr: "16", hp: 310},
		{cr: "17", hp: 325}, {cr: "18", hp: 340}, {cr: "19", hp: 355}, {cr: "20", hp: 400},
		{cr: "21", hp: 445}, {cr: "22", hp: 490}, {cr: "23", hp: 535}, {cr: "24", hp: 580},
		{cr: "25", hp: 625}, {cr: "26", hp: 670}, {cr: "27", hp: 715}, {cr: "28", hp: 760},
		{cr: "29", hp: 805}, {cr: "30", hp: 850},
	];

	static _CR_DPR_THRESHOLDS = [
		{cr: "0", dpr: 1}, {cr: "1/8", dpr: 3}, {cr: "1/4", dpr: 5}, {cr: "1/2", dpr: 8},
		{cr: "1", dpr: 14}, {cr: "2", dpr: 20}, {cr: "3", dpr: 26}, {cr: "4", dpr: 32},
		{cr: "5", dpr: 38}, {cr: "6", dpr: 44}, {cr: "7", dpr: 50}, {cr: "8", dpr: 56},
		{cr: "9", dpr: 62}, {cr: "10", dpr: 68}, {cr: "11", dpr: 74}, {cr: "12", dpr: 80},
		{cr: "13", dpr: 86}, {cr: "14", dpr: 92}, {cr: "15", dpr: 98}, {cr: "16", dpr: 104},
		{cr: "17", dpr: 110}, {cr: "18", dpr: 116}, {cr: "19", dpr: 122}, {cr: "20", dpr: 140},
		{cr: "21", dpr: 158}, {cr: "22", dpr: 176}, {cr: "23", dpr: 194}, {cr: "24", dpr: 212},
		{cr: "25", dpr: 230}, {cr: "26", dpr: 248}, {cr: "27", dpr: 266}, {cr: "28", dpr: 284},
		{cr: "29", dpr: 302}, {cr: "30", dpr: 320},
	];

	static getSanitizedSourceConfig (
		{
			sourceJson = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT,
			abbreviation = sourceJson,
			full = CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT,
			version = CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT,
		} = {},
	) {
		const safeSourceJson = this._getSafeSourceJson(sourceJson);
		const safeAbbreviation = this._getSafeSourceAbbreviation(abbreviation || safeSourceJson);
		const safeFull = this._getSafeSourceFull(full);
		const safeVersion = this._getSafeVersion(version);

		return {
			sourceJson: safeSourceJson,
			abbreviation: safeAbbreviation,
			full: safeFull,
			version: safeVersion,
		};
	}

	static getSanitizedExportOptions (opts = {}) {
		const defenseMode = String(opts.defenseMode || "persistent").toLowerCase() === "active" ? "active" : "persistent";
		const includeUnarmedRaw = String(opts.includeUnarmed || "auto").toLowerCase();
		const includeUnarmed = ["auto", "always", "never"].includes(includeUnarmedRaw) ? includeUnarmedRaw : "auto";
		const includeFeaturesRaw = String(opts.includeFeatures || "auto").toLowerCase();
		const includeFeatures = ["auto", "allimportant", "manual"].includes(includeFeaturesRaw)
			? (includeFeaturesRaw === "allimportant" ? "allImportant" : includeFeaturesRaw)
			: "auto";
		const selectedFeatureIds = Array.isArray(opts.selectedFeatureIds)
			? opts.selectedFeatureIds.map(it => String(it || "").trim()).filter(Boolean).slice(0, 64)
			: [];
		const crMode = String(opts.crMode || "auto").toLowerCase() === "manual" ? "manual" : "auto";
		const crManual = this._normalizeCrString(opts.crManual) || "1";
		const legendaryActions = Math.max(0, Math.min(5, Number(opts.legendaryActions) || 3));
		const legendaryResistances = Math.max(0, Math.min(5, Number(opts.legendaryResistances) || 0));
		const nameSuffixRaw = opts.nameSuffix == null ? " (NPC)" : String(opts.nameSuffix);
		const nameSuffix = nameSuffixRaw.slice(0, 32);

		return {
			defenseMode,
			includeUnarmed,
			includeFeatures,
			selectedFeatureIds,
			includeCustomModifiers: opts.includeCustomModifiers !== false,
			includeCustomAbilities: opts.includeCustomAbilities !== false,
			includeCombatMethods: opts.includeCombatMethods !== false,
			crMode,
			crManual,
			legendaryEnabled: !!opts.legendaryEnabled,
			legendaryActions,
			legendaryResistances,
			nameSuffix,
			includeCrBreakdown: !!opts.includeCrBreakdown,
		};
	}

	static getDefaultSourceMeta (
		{
			sourceJson = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT,
			abbreviation = null,
			full = CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT,
			version = CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT,
			authors = ["Character Sheet"],
			convertedBy = ["Character Sheet"],
		} = {},
	) {
		const sourceConfig = this.getSanitizedSourceConfig({sourceJson, abbreviation, full, version});
		const now = new Date().toISOString().slice(0, 10);
		const safeAuthors = this._getSafeStringList(authors, {maxLen: 64});
		const safeConvertedBy = this._getSafeStringList(convertedBy, {maxLen: 64});
		return {
			json: sourceConfig.sourceJson,
			abbreviation: sourceConfig.abbreviation,
			full: sourceConfig.full,
			authors: safeAuthors.length ? safeAuthors : ["Character Sheet"],
			version: sourceConfig.version,
			convertedBy: safeConvertedBy.length ? safeConvertedBy : ["Character Sheet"],
			dateReleased: now,
		};
	}

	static convertStateToMonster (
		state,
		options = {},
	) {
		const exportOpts = this.getSanitizedExportOptions(options);
		const safeSource = this._getSafeSourceJson(options.sourceJson || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT);
		const name = this._getSafeName(state.getName?.()) || "Unnamed Character";
		const npcName = this._getNpcReferenceName(name);
		const totalLevel = state.getTotalLevel?.() || 0;
		const hp = state.getHp?.() || {current: 0, max: 1};
		const maxHp = Math.max(1, hp.max || 1);
		const ac = Math.max(1, state.getArmorClass?.() ?? state.getAc?.() ?? 10);
		const acFrom = this._getAcFromLabels(state);

		const str = state.getAbilityScore?.("str") ?? 10;
		const dex = state.getAbilityScore?.("dex") ?? 10;
		const con = state.getAbilityScore?.("con") ?? 10;
		const int = state.getAbilityScore?.("int") ?? 10;
		const wis = state.getAbilityScore?.("wis") ?? 10;
		const cha = state.getAbilityScore?.("cha") ?? 10;

		const alignment = this._getAlignmentArray(state.getAlignment?.());
		const size = [this._getSizeAbv(state.getSize?.() || "medium")];
		const speed = this._getSpeedObject(state);
		const saves = this._getSaveBlock(state);
		const skills = this._getSkillBlock(state);
		const senses = this._getSensesBlock(state);
		const passive = state.getPassivePerception?.() ?? 10;
		const languages = this._getSafeStringList(state.getLanguages?.(), {maxLen: 40});
		const defenses = this._getExportDefenses(state, {defenseMode: exportOpts.defenseMode});

		const calculations = state.getFeatureCalculations?.() || {};
		const attacksPerAction = this._getAttacksPerAction(state, calculations);
		const attacks = this._filterAttacksForExport(
			this._getMergedAttacks(state),
			state,
			{includeUnarmed: exportOpts.includeUnarmed},
		);
		const weaponActions = this._getActionEntriesFromAttacks(attacks, state);
		const multiattackAction = this._getMultiattackAction(state, {
			npcName,
			attacks,
			attacksPerAction,
		});
		const actions = [
			...(multiattackAction ? [multiattackAction] : []),
			...weaponActions,
		];

		const methodsBlock = exportOpts.includeCombatMethods
			? this._getCombatMethodsBlock(state, {npcName})
			: null;
		const classResourcesBlock = this._getClassResourcesBlock(state, {npcName});
		const specialEquipmentBlock = this._getSpecialEquipmentBlock(state);
		const armorUpgradeBlock = this._getArmorUpgradeBlock(state);
		const gemstoneNotesBlock = this._getGemstoneNotesBlock(state);
		const itemUseBlocks = this._getMagicItemUseBlocks(state, {npcName});
		const spellcastingBlocks = this._getSpellcastingBlocks(state, {npcName});

		const featureBlocks = this._getFeatureBlocks(state, {
			npcName,
			includeFeatures: exportOpts.includeFeatures,
			selectedFeatureIds: exportOpts.selectedFeatureIds,
			suppressExtraAttack: !!multiattackAction,
		});
		const customAbilityBlocks = exportOpts.includeCustomAbilities
			? this._getCustomAbilityBlocks(state, {npcName})
			: {trait: [], action: [], bonus: [], reaction: []};
		const namedModifierTrait = exportOpts.includeCustomModifiers
			? this._getNamedModifierTrait(state, {npcName})
			: null;

		const crInfo = exportOpts.crMode === "manual"
			? {cr: exportOpts.crManual, defensiveCr: null, offensiveCr: null, breakdown: `Manual CR ${exportOpts.crManual}`}
			: this._estimateCr({
				totalLevel,
				hp: maxHp,
				ac,
				attacks,
				attacksPerAction,
				spellcastingBlocks,
				state,
			});

		const levelSignalEntries = [
			`Built from a level ${Math.max(0, totalLevel)} character (${this._getSafeInlineText(state.getClassSummary?.() || "No Class", {maxLen: 120})}).`,
		];
		if (exportOpts.includeCrBreakdown && crInfo.breakdown) {
			levelSignalEntries.push(crInfo.breakdown);
		}
		const levelSignal = {
			name: "Level Signal",
			entries: levelSignalEntries,
		};

		const legendaryResistanceTrait = exportOpts.legendaryEnabled && exportOpts.legendaryResistances > 0
			? this._getLegendaryResistanceTrait(exportOpts.legendaryResistances, {npcName})
			: null;
		const legendaryActions = exportOpts.legendaryEnabled
			? this._getLegendaryActions(state, {
				npcName,
				attacks,
				count: exportOpts.legendaryActions,
			})
			: null;

		const race = state.getRace?.();
		const monsterType = this._getCreatureTypeFromRace(race);
		const displayName = `${name}${exportOpts.nameSuffix || ""}`;

		const out = {
			name: displayName,
			source: safeSource,
			page: 0,
			size,
			type: monsterType,
			alignment,
			ac: [{ac, from: acFrom}],
			hp: {
				average: maxHp,
				formula: this._getHpFormula(maxHp, state),
			},
			speed,
			str,
			dex,
			con,
			int,
			wis,
			cha,
			passive,
			languages: languages.length ? languages : ["Common"],
			cr: crInfo.cr,
			pbNote: `+${state.getProficiencyBonus?.() ?? 2}`,
			trait: [
				levelSignal,
				...(legendaryResistanceTrait ? [legendaryResistanceTrait] : []),
				...(classResourcesBlock ? [classResourcesBlock] : []),
				...(featureBlocks.trait || []),
				...(customAbilityBlocks.trait || []),
				...(namedModifierTrait ? [namedModifierTrait] : []),
				...(specialEquipmentBlock ? [specialEquipmentBlock] : []),
				...(armorUpgradeBlock ? [armorUpgradeBlock] : []),
				...(gemstoneNotesBlock ? [gemstoneNotesBlock] : []),
				...(methodsBlock ? [methodsBlock] : []),
			],
			action: [...actions, ...(featureBlocks.action || []), ...(customAbilityBlocks.action || []), ...(itemUseBlocks.action || [])],
		};

		if ((itemUseBlocks.bonus || []).length || (customAbilityBlocks.bonus || []).length || (featureBlocks.bonus || []).length) {
			out.bonus = [...(featureBlocks.bonus || []), ...(customAbilityBlocks.bonus || []), ...(itemUseBlocks.bonus || [])];
		}
		if ((itemUseBlocks.reaction || []).length || (customAbilityBlocks.reaction || []).length || (featureBlocks.reaction || []).length) {
			out.reaction = [...(featureBlocks.reaction || []), ...(customAbilityBlocks.reaction || []), ...(itemUseBlocks.reaction || [])];
		}

		if (Object.keys(saves).length) out.save = saves;
		if (Object.keys(skills).length) out.skill = skills;
		if (senses.length) out.senses = senses;
		if ((defenses.resist || []).length) out.resist = defenses.resist;
		if ((defenses.immune || []).length) out.immune = defenses.immune;
		if ((defenses.vulnerable || []).length) out.vulnerable = defenses.vulnerable;
		if ((defenses.conditionImmune || []).length) out.conditionImmune = defenses.conditionImmune;

		if (spellcastingBlocks.length) out.spellcasting = spellcastingBlocks;

		if (legendaryActions?.length) {
			out.legendaryActions = exportOpts.legendaryActions;
			out.legendary = legendaryActions;
		}

		return out;
	}

	/** Classify features for the export dialog feature picker (non-mutating). */
	static listExportableFeatures (state) {
		const sourceFeatureIds = new Set((state.getNamedModifiers?.() || [])
			.map(mod => mod?.sourceFeatureId)
			.filter(Boolean));
		const features = (state.getFeatures?.() || [])
			.filter(f => f?.name && f?.description)
			.filter(f => !(typeof CharacterSheetClassUtils !== "undefined" && CharacterSheetClassUtils.isCombatMethod?.(f)));

		return features.map(feature => {
			const classified = this._classifyFeatureForStatblock(feature, {sourceFeatureIds});
			const section = this._getFeatureActivationSection(feature, classified.analysis) || "trait";
			return {
				id: feature.id || feature.name,
				name: feature.name,
				classification: classified.classification,
				section,
				featureType: feature.featureType || "",
				important: !!feature.important,
			};
		});
	}

	static _getExportDefenses (state, {defenseMode = "persistent"} = {}) {
		if (defenseMode === "active") {
			const effective = state.getEffectiveDefenses?.() || {};
			return {
				resist: this._getSanitizedDefenseList(effective.resistances),
				immune: this._getSanitizedDefenseList(effective.immunities),
				vulnerable: this._getSanitizedDefenseList(effective.vulnerabilities),
				conditionImmune: this._getSanitizedDefenseList(effective.conditionImmunities, {isCondition: true}),
			};
		}

		const baseData = state?._data || {};
		const itemDefenses = baseData.itemDefenses || {};
		const baseResist = baseData.resistances || [];
		const baseImmune = baseData.immunities || [];
		const baseVulnerable = baseData.vulnerabilities || [];
		const baseConditionImmune = baseData.conditionImmunities || [];

		const itemResist = (itemDefenses.resist || []).map(it => it?.type);
		const itemImmune = (itemDefenses.immune || []).map(it => it?.type);
		const itemVulnerable = (itemDefenses.vulnerable || []).map(it => it?.type);
		const itemConditionImmune = (itemDefenses.conditionImmune || []).map(it => it?.type);

		return {
			resist: this._getSanitizedDefenseList([...baseResist, ...itemResist]),
			immune: this._getSanitizedDefenseList([...baseImmune, ...itemImmune]),
			vulnerable: this._getSanitizedDefenseList([...baseVulnerable, ...itemVulnerable]),
			conditionImmune: this._getSanitizedDefenseList([...baseConditionImmune, ...itemConditionImmune], {isCondition: true}),
		};
	}

	static _getSanitizedDefenseList (values, {isCondition = false} = {}) {
		if (!Array.isArray(values)) return [];
		const out = values
			.map(it => String(it || "").split("|")[0])
			.map(it => it.replace(/^damage:/i, "").replace(/^condition:/i, ""))
			.map(it => this._getSafeInlineText(it, {maxLen: 40}).toLowerCase())
			.filter(Boolean);
		const deduped = [...new Set(out)].sort((a, b) => a.localeCompare(b));
		if (!isCondition) return deduped;
		return deduped.map(it => it.replace(/\s+/g, " ").trim());
	}

	static getValidationIssues (monster) {
		const errors = [];
		const warnings = [];

		if (!monster || typeof monster !== "object") {
			return {errors: ["Monster export payload is missing or invalid."], warnings};
		}

		if (!monster.name || typeof monster.name !== "string") errors.push("Missing required field: name.");
		if (!monster.source || typeof monster.source !== "string") errors.push("Missing required field: source.");
		if (!Array.isArray(monster.size) || !monster.size.length) errors.push("Missing required field: size.");
		if (!monster.type) errors.push("Missing required field: type.");
		if (!Array.isArray(monster.alignment) || !monster.alignment.length) errors.push("Missing required field: alignment.");
		if (!Array.isArray(monster.ac) || !monster.ac.length) {
			errors.push("Missing required field: ac.");
		} else {
			const firstAc = monster.ac[0];
			const acValue = typeof firstAc === "number" ? firstAc : firstAc?.ac;
			if (!Number.isFinite(Number(acValue)) || Number(acValue) < 1) errors.push("Armor Class must be a positive number.");
		}

		if (!monster.hp?.average || !monster.hp?.formula) {
			errors.push("Missing required field: hp.");
		} else {
			if (!Number.isFinite(Number(monster.hp.average)) || Number(monster.hp.average) < 1) errors.push("HP average must be a positive number.");
			if (!/^\d+d\d+(?:\s*[+-]\s*\d+)?$/i.test(String(monster.hp.formula).trim())) {
				errors.push("HP formula must use dice notation (for example: 8d8 + 16).");
			}
		}

		if (!monster.speed || typeof monster.speed !== "object") errors.push("Missing required field: speed.");
		if (!monster.cr) errors.push("Missing required field: cr.");
		if (!Array.isArray(monster.action) || !monster.action.length) errors.push("Missing required field: action.");

		if (monster.type) {
			const isTypeString = typeof monster.type === "string" && monster.type.trim();
			const isTypeObject = typeof monster.type === "object" && typeof monster.type.type === "string" && monster.type.type.trim();
			if (!isTypeString && !isTypeObject) errors.push("Creature type must be a string or an object with a type field.");
		}

		if (monster.speed && typeof monster.speed === "object") {
			const speedEntries = Object.entries(monster.speed).filter(([k]) => k !== "canHover");
			if (!speedEntries.length) {
				errors.push("Speed must include at least one movement type.");
			} else {
				speedEntries.forEach(([k, v]) => {
					const speedValue = typeof v === "number" ? v : v?.number;
					if (!Number.isFinite(Number(speedValue)) || Number(speedValue) < 0) {
						errors.push(`Speed "${k}" must be a non-negative number.`);
					}
				});
			}
		}

		if (Array.isArray(monster.action)) {
			monster.action.forEach((action, ix) => {
				if (!action || typeof action !== "object") {
					errors.push(`Action #${ix + 1} must be an object.`);
					return;
				}
				if (typeof action.name !== "string" || !action.name.trim()) errors.push(`Action #${ix + 1} is missing a name.`);
				if (!Array.isArray(action.entries) || !action.entries.length) {
					errors.push(`Action #${ix + 1} is missing entries.`);
				} else if (action.entries.some(it => typeof it !== "string")) {
					errors.push(`Action #${ix + 1} entries must be strings.`);
				}
			});
		}

		const abilAbvs = Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"];
		abilAbvs.forEach(abv => {
			if (!Number.isFinite(Number(monster[abv]))) errors.push(`Missing or invalid ability score: ${abv}.`);
		});

		if (!Number.isFinite(Number(monster.passive))) warnings.push("Passive Perception is missing or non-numeric.");

		const safeSource = this._getSafeSourceJson(monster.source);
		if (safeSource !== monster.source) {
			warnings.push(`Source JSON was normalized to "${safeSource}".`);
		}

		const htmlUnsafePattern = /<[^>]+>|\bon\w+\s*=|javascript:/i;
		const scanStrings = [];
		(monster.languages || []).forEach(it => scanStrings.push({label: "languages", value: it}));
		(monster.senses || []).forEach(it => scanStrings.push({label: "senses", value: it}));
		(monster.action || []).forEach(a => {
			scanStrings.push({label: "action.name", value: a?.name});
			(a?.entries || []).forEach(e => scanStrings.push({label: "action.entries", value: e}));
		});
		(monster.trait || []).forEach(t => {
			scanStrings.push({label: "trait.name", value: t?.name});
			(t?.entries || []).forEach(e => scanStrings.push({label: "trait.entries", value: e}));
		});
		(monster.bonus || []).forEach(a => {
			scanStrings.push({label: "bonus.name", value: a?.name});
			(a?.entries || []).forEach(e => scanStrings.push({label: "bonus.entries", value: e}));
		});
		(monster.reaction || []).forEach(a => {
			scanStrings.push({label: "reaction.name", value: a?.name});
			(a?.entries || []).forEach(e => scanStrings.push({label: "reaction.entries", value: e}));
		});
		(monster.legendary || []).forEach(a => {
			scanStrings.push({label: "legendary.name", value: a?.name});
			(a?.entries || []).forEach(e => scanStrings.push({label: "legendary.entries", value: e}));
		});

		if (monster.legendary && !Array.isArray(monster.legendary)) {
			errors.push("Legendary actions must be an array.");
		} else if (Array.isArray(monster.legendary)) {
			monster.legendary.forEach((action, ix) => {
				if (!action || typeof action !== "object") {
					errors.push(`Legendary action #${ix + 1} must be an object.`);
					return;
				}
				if (typeof action.name !== "string" || !action.name.trim()) errors.push(`Legendary action #${ix + 1} is missing a name.`);
				if (!Array.isArray(action.entries) || !action.entries.length) errors.push(`Legendary action #${ix + 1} is missing entries.`);
			});
			if (monster.legendary.length && (monster.legendaryActions == null || !Number.isFinite(Number(monster.legendaryActions)))) {
				warnings.push("Legendary actions are present but legendaryActions count is missing.");
			}
		}

		if (Array.isArray(monster.spellcasting)) {
			monster.spellcasting.forEach((block, ix) => {
				if (!block || typeof block !== "object") {
					errors.push(`Spellcasting block #${ix + 1} must be an object.`);
					return;
				}
				if (block.type !== "spellcasting") warnings.push(`Spellcasting block #${ix + 1} should set type "spellcasting".`);
				if (!block.name) warnings.push(`Spellcasting block #${ix + 1} is missing a name.`);
				const hasContent = !!(block.will?.length || block.daily || block.spells);
				if (!hasContent) warnings.push(`Spellcasting block #${ix + 1} has no spells.`);
			});
		}

		scanStrings
			.filter(it => typeof it.value === "string" && htmlUnsafePattern.test(it.value))
			.forEach(it => warnings.push(`Potentially unsafe markup found in ${it.label}.`));

		return {
			errors: [...new Set(errors)],
			warnings: [...new Set(warnings)],
		};
	}

	static _getAcFromLabels (state) {
		const breakdown = state.getAcBreakdown?.();
		const components = breakdown?.components || [];
		const labels = [];

		const armorComp = components.find(c => c?.type === "armor" && c?.name);
		if (armorComp?.name) labels.push(this._getSafeInlineText(armorComp.name, {maxLen: 48}));

		const udComp = components.find(c => c?.type === "base" && /unarmored defense/i.test(String(c?.name || "")));
		if (udComp?.name) {
			const subtype = udComp.subtype ? ` (${udComp.subtype})` : "";
			labels.push(this._getSafeInlineText(`${udComp.name}${subtype}`, {maxLen: 48}));
		}

		const naturalComp = components.find(c => c?.type === "base" && /natural/i.test(String(c?.name || "")));
		if (naturalComp?.name && !labels.length) {
			labels.push("natural armor");
		}

		const shieldComp = components.find(c => c?.type === "shield" || /shield/i.test(String(c?.name || "")));
		if (shieldComp) labels.push("shield");

		// Fallback: equipped armor-like items
		if (!labels.length) {
			const armorItem = (state.getItems?.() || []).find(it => it?.equipped && (it.ac || it.armor || ["LA", "MA", "HA"].includes(String(it.type || "").split("|")[0])));
			if (armorItem?.name) labels.push(this._getSafeInlineText(armorItem.name, {maxLen: 48}));
		}

		if (!labels.length) {
			if (state._hasUnarmoredDefense?.()) labels.push("Unarmored Defense");
			else labels.push("natural armor");
		}

		return [...new Set(labels.filter(Boolean))];
	}

	static _getAttacksPerAction (state, calculations = {}) {
		const fromCalc = Number(calculations.attackCount || calculations.extraAttackCount || calculations.extraAttacks || 0);
		if (fromCalc >= 2) return fromCalc;
		if (calculations.hasExtraAttack) return 2;

		const features = state.getFeatures?.() || [];
		const hasExtraAttackFeature = features.some(f => /^extra attack\b/i.test(String(f?.name || "")));
		return hasExtraAttackFeature ? 2 : 1;
	}

	static _filterAttacksForExport (attacks, state, {includeUnarmed = "auto"} = {}) {
		const list = [...(attacks || [])];
		if (includeUnarmed === "always") return list;
		if (includeUnarmed === "never") {
			return list.filter(a => !this._isDefaultUnarmedAttack(a));
		}

		// auto: keep enhanced/monk unarmed; drop plain unarmed when other weapons exist
		const nonUnarmed = list.filter(a => !this._isDefaultUnarmedAttack(a));
		const unarmed = list.filter(a => this._isDefaultUnarmedAttack(a));
		const keepUnarmed = unarmed.filter(a => this._isEnhancedUnarmedAttack(a, state));
		if (nonUnarmed.length) return [...keepUnarmed, ...nonUnarmed];
		return list;
	}

	static _isDefaultUnarmedAttack (attack) {
		if (!attack) return false;
		if (attack.isUnarmedStrike) return true;
		return /^unarmed strike$/i.test(String(attack.name || ""));
	}

	static _isEnhancedUnarmedAttack (attack, state) {
		if (!attack) return false;
		if (attack.isMonkWeapon) return true;
		if (state.getClassLevel?.("Monk") > 0) return true;
		const dmg = String(attack.damage || "").trim();
		// Default unarmed is flat "1" (or 1 + bonus); dice damage is enhanced
		if (/\d+d\d+/i.test(dmg)) return true;
		if (Number(attack.damageBonus) > 0) return true;
		return false;
	}

	static _getMultiattackAction (state, {npcName = "The NPC", attacks = [], attacksPerAction = 1} = {}) {
		if (attacksPerAction < 2) return null;
		const weaponAttacks = (attacks || []).filter(a => a?.name && !this._isDefaultUnarmedAttack(a));
		const primary = weaponAttacks[0] || (attacks || []).find(a => a?.name) || null;
		const attackName = this._getSafeInlineText(primary?.name || "weapon attack", {maxLen: 48}) || "weapon attack";
		const countWord = this._numberToWord(attacksPerAction);
		return {
			name: "Multiattack",
			entries: [
				`${npcName} makes ${countWord} ${attackName} attacks.`,
			],
		};
	}

	static _numberToWord (n) {
		const map = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six"};
		return map[Number(n)] || String(n);
	}

	static _normalizeCrString (value) {
		const raw = String(value || "").trim().toLowerCase();
		if (!raw) return null;
		if (["0", "1/8", "1/4", "1/2"].includes(raw)) return raw;
		const asNum = Number(raw);
		if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 30) return `${Math.round(asNum)}`;
		return null;
	}

	static _getAlignmentArray (alignment) {
		const map = {
			LG: ["L", "G"],
			NG: ["N", "G"],
			CG: ["C", "G"],
			LN: ["L", "N"],
			N: ["N"],
			CN: ["C", "N"],
			LE: ["L", "E"],
			NE: ["N", "E"],
			CE: ["C", "E"],
		};
		return map[alignment] || ["N"];
	}

	static _getSizeAbv (size) {
		const map = {
			tiny: "T",
			small: "S",
			medium: "M",
			large: "L",
			huge: "H",
			gargantuan: "G",
		};
		return map[(size || "medium").toLowerCase()] || "M";
	}

	static _getCreatureTypeFromRace (race) {
		const creatureTypes = race?.creatureTypes || race?.creatureType || null;
		if (Array.isArray(creatureTypes) && creatureTypes.length) {
			const first = creatureTypes[0];
			if (typeof first === "string" && first.trim()) return {type: first.toLowerCase()};
			if (first?.type && typeof first.type === "string") return {type: first.type.toLowerCase()};
			if (Array.isArray(first?.choose) && first.choose.length && typeof first.choose[0] === "string") {
				return {type: first.choose[0].toLowerCase()};
			}
		}
		if (typeof creatureTypes === "string" && creatureTypes.trim()) {
			return {type: creatureTypes.toLowerCase()};
		}
		return {type: "humanoid"};
	}

	static _getSafeSourceJson (sourceJson) {
		const raw = String(sourceJson || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT).trim();
		if (!raw) return CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
		const sanitized = raw
			.toUpperCase()
			.replace(/[^A-Z0-9&+!\- ]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 48);
		return sanitized || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
	}

	static _getSafeSourceAbbreviation (abbreviation) {
		const raw = String(abbreviation || "").trim().slice(0, 32);
		if (!raw) return CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
		return this._getSafeInlineText(raw, {maxLen: 32}) || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
	}

	static _getSafeSourceFull (full) {
		const raw = String(full || "").trim().slice(0, 128);
		if (!raw) return CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT;
		return this._getSafeInlineText(raw, {maxLen: 128}) || CharacterSheetNpcExporter.SOURCE_FULL_DEFAULT;
	}

	static _getSafeVersion (version) {
		const raw = String(version || "").trim();
		if (!raw) return CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT;
		const out = raw.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 32);
		return out || CharacterSheetNpcExporter.SOURCE_VERSION_DEFAULT;
	}

	static _getSafeName (name) {
		return this._stripHtmlTags(String(name || "")).slice(0, 128).trim();
	}

	static _getSafeInlineText (text, {maxLen = 160} = {}) {
		return this._stripHtmlTags(String(text || ""))
			.replace(/[{}]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, maxLen);
	}

	static _getSpeedObject (state) {
		const keys = ["walk", "fly", "swim", "climb", "burrow"];
		const out = {};
		keys.forEach(k => {
			const value = state.getSpeedByType?.(k);
			if (value > 0) out[k] = value;
		});
		if (!out.walk) out.walk = 30;
		return out;
	}

	static _toSignedStr (n) {
		if (n == null || Number.isNaN(Number(n))) return "+0";
		const v = Number(n);
		return v >= 0 ? `+${v}` : `${v}`;
	}

	static _getSaveBlock (state) {
		const out = {};
		(Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"]).forEach(abv => {
			if (!state.hasSaveProficiency?.(abv)) return;
			out[abv] = this._toSignedStr(state.getSaveMod?.(abv));
		});
		return out;
	}

	static _getSkillBlock (state) {
		const skillMap = {
			acrobatics: "acrobatics",
			animalhandling: "animal handling",
			arcana: "arcana",
			athletics: "athletics",
			deception: "deception",
			history: "history",
			insight: "insight",
			intimidation: "intimidation",
			investigation: "investigation",
			medicine: "medicine",
			nature: "nature",
			perception: "perception",
			performance: "performance",
			persuasion: "persuasion",
			religion: "religion",
			sleightofhand: "sleight of hand",
			stealth: "stealth",
			survival: "survival",
		};

		const out = {};
		Object.entries(skillMap).forEach(([key, label]) => {
			const profLevel = state.getSkillProficiency?.(key) || 0;
			if (!profLevel) return;
			out[label] = this._toSignedStr(state.getSkillMod?.(key));
		});
		return out;
	}

	static _getSensesBlock (state) {
		const parts = [];
		const senses = state.getSenses?.() || {};
		Object.entries(senses).forEach(([k, v]) => {
			const value = Number(v);
			if (!value || !Number.isFinite(value)) return;
			const senseName = this._getSafeInlineText(k, {maxLen: 24});
			if (!senseName) return;
			parts.push(`${senseName} ${value} ft.`);
		});
		return parts;
	}

	static _getSafeStringList (values, {maxLen = 64} = {}) {
		if (!Array.isArray(values)) return [];
		return values
			.map(it => this._getSafeInlineText(it, {maxLen}))
			.filter(Boolean);
	}

	static _getMergedAttacks (state) {
		const activeWeapons = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isWeaponItem(it));

		const activeWeaponByName = new Map(
			activeWeapons
				.map(it => [String(it.name || "").toLowerCase(), it])
				.filter(([name]) => !!name),
		);

		const attacks = [...(state.getAttacks?.() || [])].map(attack => {
			const key = String(attack?.name || "").toLowerCase();
			const item = key ? activeWeaponByName.get(key) : null;
			if (!item) return attack;

			// Use effective bonuses (includes upgrade effects) when available
			const eff = state.getEffectiveItemBonuses?.(item.id);
			let magicAttackBonus;
			let magicDamageBonus;
			if (eff) {
				magicAttackBonus = (Number(eff.bonusWeapon) || 0) + (Number(eff.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(eff.bonusWeapon) || 0) + (Number(eff.bonusWeaponDamage) || 0);
			} else {
				magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			}
			const masteryProperty = this._getMasteryName(item.mastery?.[0]);

			return {
				...attack,
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: attack.mastery || item.mastery || [],
				masteryProperty: attack.masteryProperty || masteryProperty || null,
				magicAttackBonus,
				magicDamageBonus,
			};
		});
		const attackNames = new Set(attacks.map(it => (it?.name || "").toLowerCase()).filter(Boolean));

		activeWeapons.forEach(item => {
			const derived = state.updateAttackFromWeapon?.(item);
			if (!derived?.name) return;
			const key = derived.name.toLowerCase();
			if (attackNames.has(key)) return;
			attackNames.add(key);

			// Use effective bonuses (includes upgrade effects) when available
			const eff = state.getEffectiveItemBonuses?.(item.id);
			let magicAttackBonus;
			let magicDamageBonus;
			let damageDieIncrease = 0;
			if (eff) {
				magicAttackBonus = (Number(eff.bonusWeapon) || 0) + (Number(eff.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(eff.bonusWeapon) || 0) + (Number(eff.bonusWeaponDamage) || 0);
				damageDieIncrease = eff.damageDieIncrease || 0;
			} else {
				magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			}
			// Apply Superior upgrade die increase to exported damage
			let exportDamage = derived.damage;
			if (damageDieIncrease > 0 && typeof CharacterSheetUpgrades !== "undefined") {
				exportDamage = CharacterSheetUpgrades.increaseDamageDie(exportDamage, damageDieIncrease);
			}
			const masteryProperty = this._getMasteryName(item.mastery?.[0]);
			const props = item.property || item.properties || derived.properties || [];
			const typeAbv = String(item.type || "").split("|")[0];
			const isRangedType = typeAbv === "R" || typeAbv === "RW";
			const isThrown = props.some(p => p === "T" || String(p).startsWith("T|"));
			attacks.push({
				...derived,
				isMelee: !isRangedType,
				properties: props,
				attackBonus: (Number(derived.attackBonus) || 0) + magicAttackBonus,
				damage: this._addFlatBonusToDiceFormula(exportDamage, magicDamageBonus),
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: item.mastery || [],
				masteryProperty,
				magicAttackBonus,
				magicDamageBonus,
				// preserve thrown for attack tag selection
				_isThrown: isThrown,
			});
		});

		return attacks;
	}

	static _isActiveItem (item) {
		if (!item?.equipped) return false;
		if (item.requiresAttunement && !item.attuned) return false;
		return true;
	}

	static _isWeaponItem (item) {
		if (item.dmg1) return true;
		if (item.weaponCategory) return true;
		return ["M", "R", "MW", "RW"].includes(item.type);
	}

	static _isMagicItem (item) {
		const rarity = String(item?.rarity || "").toLowerCase();
		const hasMeaningfulRarity = rarity && !["none", "unknown", "common"].includes(rarity);
		return !!(
			hasMeaningfulRarity
			|| item?.requiresAttunement
			|| item?.charges
			|| item?.attachedSpells
			|| item?.activation?.length
			|| item?.bonusAc
			|| item?.bonusSavingThrow
			|| item?.bonusWeaponAttack
			|| item?.bonusWeaponDamage
		);
	}

	static _getItemTag (item) {
		const safeName = this._getSafeInlineText(item?.name || "Item", {maxLen: 80}) || "Item";
		const source = this._getSafeSourceJson(item?.source || "");
		if (!source) return safeName;
		return `{@item ${safeName}|${source}}`;
	}

	static _getClassResourcesBlock (state, {npcName = "The NPC"} = {}) {
		const pools = [];
		const seen = new Set();

		const pushPool = (raw) => {
			if (!raw?.name) return;
			const max = Number(raw.max);
			if (!Number.isFinite(max) || max <= 0) return;
			const key = String(raw.name).toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			const current = Number.isFinite(Number(raw.current)) ? Number(raw.current) : max;
			const recharge = this._getSafeInlineText(raw.recharge || "", {maxLen: 24});
			const unlimited = max >= 999 ? " (unlimited)" : "";
			const displayMax = max >= 999 ? "∞" : String(max);
			pools.push(`• {@b ${this._getSafeInlineText(raw.name, {maxLen: 60}) || "Resource"}.} ${current}/${displayMax}${unlimited}${recharge ? `; recharges on ${recharge} rest` : ""}.`);
		};

		// Prefer player-facing generic pools (includes ensure* reconcilers).
		const generic = state.getGenericPoolResources?.() || state.getResources?.() || [];
		generic.forEach(pushPool);

		// Synthetic combat resources (Second Wind, Action Surge, etc.)
		const synthetic = state.getSyntheticCombatResources?.() || [];
		synthetic.forEach(pushPool);

		// Stamina is often tracked outside resources
		const staminaMax = Number(state.getStaminaMax?.() || 0);
		if (staminaMax > 0 && !seen.has("stamina") && !seen.has("stamina points")) {
			const cur = Number.isFinite(Number(state.getStaminaCurrent?.()))
				? Number(state.getStaminaCurrent())
				: staminaMax;
			pushPool({name: "Stamina", current: cur, max: staminaMax, recharge: "short"});
		}

		if (!pools.length) return null;
		return {
			name: "Class Resources",
			entries: [
				`${npcName} tracks the following limited-use pools:`,
				...pools.slice(0, 16),
			],
		};
	}

	static _getSpecialEquipmentBlock (state) {
		const items = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isMagicItem(it));

		if (!items.length) return null;

		const entries = items
			.map(item => {
				const tag = this._getItemTag(item);
				const notes = [];
				if (item.requiresAttunement) notes.push("attuned");
				// Ioun stones only confer benefits while orbiting (equipped).
				if (this._isIounStoneItem(item)) notes.push(item.equipped ? "orbiting" : "stowed");
				if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
					const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
					notes.push(`${current}/${Number(item.charges)} charges`);
				}
				if (item.activation?.length) {
					const acts = item.activation.map(a => String(a?.type || "")).filter(Boolean).join(", ");
					if (acts) notes.push(`activation: ${acts}`);
				}
				return `• ${tag}${notes.length ? ` (${notes.join("; ")})` : ""}`;
			})
			.slice(0, 12);

		return {
			name: "Special Equipment",
			entries,
		};
	}

	static _isIounStoneItem (item) {
		if (typeof CharacterSheetIoun !== "undefined" && CharacterSheetIoun.isIounStone) {
			try { return !!CharacterSheetIoun.isIounStone(item); } catch { /* fall through */ }
		}
		const name = String(item?.name || "");
		if (/ioun\s+(geode|sand)\b/i.test(name)) return false;
		return /\bioun\s+stone\b/i.test(name);
	}

	static _getArmorUpgradeBlock (state) {
		// Prefer state getters when present — do not require the Upgrades UI module
		// to be loaded (tests, headless conversion, degraded mode).
		const notes = state.getArmorUpgradeNotes?.() || [];
		if (!notes.length) return null;
		return {
			name: "Armor Upgrades",
			entries: notes.map(n => `{@b ${this._getSafeInlineText(n.label || "Upgrade", {maxLen: 60}) || "Upgrade"}.} ${this._getSafeInlineText(n.description || "", {maxLen: 240})}`),
		};
	}

	static _getGemstoneNotesBlock (state) {
		const passiveNotes = (state.getGemstonePassiveNotes?.() || [])
			.map(n => this._getSafeInlineText(String(n || ""), {maxLen: 240}))
			.filter(Boolean);
		if (!passiveNotes.length) return null;
		return {
			name: "Gemstone Effects",
			entries: passiveNotes,
		};
	}

	static _getMagicItemUseBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {action: [], bonus: [], reaction: []};
		const items = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isMagicItem(it));
		const spells = state.getItemGrantedSpells?.() || [];

		const dc = state.getFeatureCalculations?.()?.combatMethodDc
			|| (8 + (state.getProficiencyBonus?.() || 2) + Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0));

		items.forEach(item => {
			if (!item.activation?.length) return;
			const activationTypes = new Set(item.activation.map(a => String(a?.type || "").toLowerCase()));
			const snippet = this._getItemUseSnippet(item, {npcName});
			const name = this._getSafeInlineText(item.name || "Magic Item", {maxLen: 80}) || "Magic Item";
			const itemTag = this._getItemTag(item);

			const entry = {
				name,
				entries: [`${itemTag}: ${snippet}${dc ? ` (save {@dc ${dc}} when applicable).` : "."}`],
			};

			if (activationTypes.has("reaction")) out.reaction.push(entry);
			else if (activationTypes.has("bonus")) out.bonus.push(entry);
			else out.action.push(entry);
		});

		spells.forEach(sp => {
			const itemName = this._getSafeInlineText(sp?.sourceItem || "Magic Item", {maxLen: 80}) || "Magic Item";
			const spellName = this._getSafeInlineText(sp?.name || "spell", {maxLen: 80}) || "spell";
			const spellTag = `{@spell ${spellName}|${Parser.SRC_XPHB}}`;
			const usage = this._getItemSpellUsageText(sp);
			const entry = {
				name: `${itemName} (Spell)`,
				entries: [`Casts ${spellTag}${usage ? ` (${usage})` : ""}.`],
			};

			const ownerItem = items.find(it => this._getSafeInlineText(it.name || "", {maxLen: 80}) === itemName);
			const activationTypes = new Set((ownerItem?.activation || []).map(a => String(a?.type || "").toLowerCase()));

			if (activationTypes.has("reaction")) out.reaction.push(entry);
			else if (activationTypes.has("bonus")) out.bonus.push(entry);
			else out.action.push(entry);
		});

		return out;
	}

	static _getItemSpellUsageText (spell) {
		if (!spell) return "";
		if (spell.usageType === "will") return "at will";
		if (spell.usageType === "charges") return `${spell.chargesCost || 1} charge${Number(spell.chargesCost || 1) === 1 ? "" : "s"}`;
		if (spell.usageType === "daily" && spell.usesMax) {
			return `${spell.usesMax}/day${spell.isEach ? " each" : ""}`;
		}
		if (spell.usageType === "rest" && spell.usesMax) {
			return `${spell.usesMax}/rest${spell.isEach ? " each" : ""}`;
		}
		if (spell.usageType === "ritual") return "ritual";
		return "";
	}

	static _getItemUseSnippet (item, {npcName = "The NPC"} = {}) {
		const joined = (item.entries || [])
			.map(it => typeof it === "string" ? it : (it?.entries || []).join(" "))
			.join(" ");
		const plain = this._getSafeInlineText(joined, {maxLen: 240});
		if (plain) return this._normalizeAbilityTextForNpc(plain, {npcName});

		if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
			const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
			return `Has ${current}/${Number(item.charges)} charges`;
		}

		return "Can be activated";
	}

	static _getActionEntriesFromAttacks (attacks, state) {
		const actions = attacks.map(a => {
			const toHit = this._toSignedStr(this._getAttackToHit(a, state));
			const range = this._formatAttackRange(a);
			const hitDamage = this._getAttackDamageText(a, state);
			const name = this._getSafeInlineText(a.name || "Attack", {maxLen: 80}) || "Attack";
			const qualifiers = this._getAttackQualifiers(a, state);
			const atkTag = this._getAttackTypeTag(a);

			return {
				name,
				entries: [
					`{@atk ${atkTag}} {@hit ${toHit}} to hit, ${range}. {@h} ${hitDamage}.${qualifiers ? ` ${qualifiers}` : ""}`,
				],
			};
		});

		if (!actions.length) {
			actions.push({
				name: "Unarmed Strike",
				entries: [
					`{@atk mw} {@hit ${this._toSignedStr((state.getAbilityMod?.("str") || 0) + (state.getProficiencyBonus?.() || 2))}} to hit, reach 5 ft., one target. {@h} ${Math.max(1, 1 + (state.getAbilityMod?.("str") || 0))} bludgeoning damage.`,
				],
			});
		}

		return actions;
	}

	static _formatAttackRange (attack) {
		const isThrown = this._isThrownAttack(attack);
		const isMelee = this._isMeleeAttack(attack);
		const raw = this._getSafeInlineText(String(attack?.range || "").trim(), {maxLen: 80})
			.replace(/\s+/g, " ")
			.replace(/[.,;:]+$/g, "")
			.trim();

		const bandMatch = raw.match(/(\d+\s*\/\s*\d+)/);
		if (isThrown && bandMatch) {
			return `reach 5 ft. or range ${bandMatch[1].replace(/\s+/g, "")} ft., one target`;
		}

		if (raw) {
			let body = raw
				.replace(/^(reach|range)\s+/i, "")
				.replace(/,?\s*one target$/i, "")
				.replace(/[.,;:]+$/g, "")
				.trim();
			// Collapse duplicated ft markers
			body = body.replace(/\s*ft\.?/gi, " ft").replace(/\s+/g, " ").trim();
			if (!/ft$/i.test(body) && /\d/.test(body)) body = `${body} ft`;
			body = body.replace(/\s*ft$/i, " ft.");

			if (isMelee && !isThrown) return `reach ${body}, one target`;
			return `range ${body}, one target`;
		}

		return isMelee ? "reach 5 ft., one target" : "range 30/120 ft., one target";
	}

	static _getAttackTypeTag (attack) {
		const isThrown = this._isThrownAttack(attack);
		const isMelee = this._isMeleeAttack(attack);
		if (isThrown && isMelee) return "mw,rw";
		if (isMelee) return "mw";
		return "rw";
	}

	static _isThrownAttack (attack) {
		if (!attack) return false;
		if (attack._isThrown) return true;
		const props = attack.properties || attack._sourceItem?.property || attack._sourceItem?.properties || [];
		if (props.some(p => p === "T" || String(p).startsWith("T|") || /^thrown$/i.test(String(p)))) return true;
		// Melee weapon with a thrown range band and no explicit ranged type
		const range = String(attack.range || "");
		return this._isMeleeAttack(attack) && !this._isRangedOnlyAttack(attack) && /\d+\s*\/\s*\d+/.test(range);
	}

	static _isRangedOnlyAttack (attack) {
		const type = String(attack?._sourceItem?.type || attack?.type || "").split("|")[0];
		if (type === "R" || type === "RW") return true;
		if (attack?.isMelee === false) return true;
		return false;
	}

	static _isMeleeAttack (attack) {
		if (!attack) return true;
		if (attack.isMelee === false) return false;
		if (this._isRangedOnlyAttack(attack)) return false;
		if (attack.isMelee === true) return true;
		return true;
	}

	static _getAttackDamageText (attack, state) {
		const damageType = this._getSafeInlineText((attack.damageType || "bludgeoning").toLowerCase(), {maxLen: 24}) || "bludgeoning";
		const base = this._normalizeDamageFormula(attack.damage || "1");
		if (/^\d+d\d+(?:\s*[+-]\s*\d+)?$/i.test(base)) {
			return `{@damage ${base}} ${damageType} damage`;
		}

		const dmgBonus = Number(attack.damageBonus) || 0;
		const abilityMod = this._getAttackAbilityMod(attack, state);
		const flat = Number(base) || 1;
		// Flat unarmed-style damage already represents the full amount when damageBonus is used on sheet
		if (attack.isUnarmedStrike || this._isDefaultUnarmedAttack(attack)) {
			const total = Math.max(1, (Number.isFinite(Number(attack.damage)) ? Number(attack.damage) : flat) + dmgBonus + (Number.isFinite(Number(attack.damage)) ? 0 : abilityMod));
			// Prefer explicit sheet total when attackBonus/damage already baked
			if (String(attack.damage || "").trim() === "1" || !/\d+d\d+/i.test(String(attack.damage || ""))) {
				return `${Math.max(1, 1 + abilityMod + dmgBonus)} ${damageType} damage`;
			}
			return `${total} ${damageType} damage`;
		}
		return `${flat + dmgBonus + abilityMod} ${damageType} damage`;
	}

	static _normalizeDamageFormula (damage) {
		const raw = String(damage || "").replace(/\s+/g, "").trim();
		if (!raw) return "1";
		const m = raw.match(/^(\d+d\d+)([+-]\d+)?$/i);
		if (!m) return raw;
		const base = m[1];
		const bonus = Number(m[2] || 0);
		if (!bonus) return base;
		return `${base}${bonus >= 0 ? "+" : ""}${bonus}`;
	}

	static _getAttackToHit (attack, state) {
		const abilityMod = this._getAttackAbilityMod(attack, state);
		const profBonus = state.getProficiencyBonus?.() || 2;
		const magicAttackBonus = Number(attack?.magicAttackBonus) || 0;
		const derived = abilityMod + profBonus + magicAttackBonus;

		const explicit = Number(attack?.attackBonus);
		if (!Number.isFinite(explicit)) return derived;
		return Math.max(explicit, derived);
	}

	static _getAttackAbilityMod (attack, state) {
		if (!attack) return state.getAbilityMod?.("str") || 0;
		if (attack.abilityMod === "finesse") {
			return Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0);
		}
		if (attack.abilityMod === "dex") return state.getAbilityMod?.("dex") || 0;
		if (attack.abilityMod === "spellcasting") {
			return Math.max(state.getAbilityMod?.("int") || 0, state.getAbilityMod?.("wis") || 0, state.getAbilityMod?.("cha") || 0);
		}
		return state.getAbilityMod?.("str") || 0;
	}

	static _getAttackQualifiers (attack, state) {
		const parts = [];

		const magicAttackBonus = Number(attack?.magicAttackBonus) || 0;
		const magicDamageBonus = Number(attack?.magicDamageBonus) || 0;
		if (magicAttackBonus || magicDamageBonus) {
			const magicBits = [];
			if (magicAttackBonus) magicBits.push(`${this._toSignedStr(magicAttackBonus)} attack`);
			if (magicDamageBonus) magicBits.push(`${this._toSignedStr(magicDamageBonus)} damage`);
			parts.push(`Magic weapon (${magicBits.join(", ")})`);
		}

		// Weapon upgrade tags and notes from the source item
		if (attack._sourceItem && typeof CharacterSheetUpgrades !== "undefined") {
			const eff = CharacterSheetUpgrades.getUpgradeEffects(attack._sourceItem);
			if (eff.tags.length) parts.push(eff.tags.join(", "));
			if (eff.bonusDamageDice) parts.push(`Plus {@damage ${eff.bonusDamageDice}} ${eff.bonusDamageType} damage`);
			for (const note of eff.notes) parts.push(note);

			// Gemstone effect summary
			const gems = attack._sourceItem.socketedGemstones || [];
			for (const gem of gems) {
				const summary = CharacterSheetUpgrades.getGemstoneSummary(gem);
				if (summary) parts.push(`Gemstone (${gem.gemName || gem.name}): ${summary}`);
			}
		}

		const masteryEffect = state.getMasteryEffectsForAttack?.(attack);
		if (masteryEffect?.name) {
			const masteryNotes = [];
			if (masteryEffect.dc) masteryNotes.push(`save {@dc ${masteryEffect.dc}}`);
			if (Number.isFinite(masteryEffect.grazeDamage)) masteryNotes.push(`${masteryEffect.grazeDamage} graze damage`);
			const desc = this._getSafeInlineText(masteryEffect.description || "", {maxLen: 180});
			if (desc) masteryNotes.push(desc);
			const masteryTag = this._getMasteryTag(attack, masteryEffect.name);
			parts.push(`Mastery: ${masteryTag}${masteryNotes.length ? ` (${masteryNotes.join("; ")})` : ""}`);
		} else {
			const masteryName = this._getMasteryName(attack.masteryProperty || attack.mastery?.[0]);
			if (masteryName) parts.push(`Mastery: ${this._getMasteryTag(attack, masteryName)}`);
		}

		return parts.join(". ");
	}

	static _getMasteryName (masteryEntry) {
		if (!masteryEntry) return "";
		if (typeof masteryEntry === "string") return masteryEntry.split("|")[0];
		if (typeof masteryEntry === "object" && masteryEntry.uid) return masteryEntry.uid.split("|")[0];
		return "";
	}

	static _getMasteryTag (attack, masteryName) {
		const safeName = this._getSafeInlineText(masteryName || "", {maxLen: 48});
		if (!safeName) return "Mastery";

		let source = Parser.SRC_XPHB;
		const masteryEntry = attack?.mastery?.[0] ?? attack?.masteryProperty;
		if (typeof masteryEntry === "string" && masteryEntry.includes("|")) {
			source = masteryEntry.split("|")[1] || source;
		} else if (typeof masteryEntry === "object" && masteryEntry.uid && masteryEntry.uid.includes("|")) {
			source = masteryEntry.uid.split("|")[1] || source;
		}

		const safeSource = this._getSafeSourceJson(source || Parser.SRC_XPHB);
		return `{@itemMastery ${safeName}|${safeSource}}`;
	}

	static _addFlatBonusToDiceFormula (damage, flatBonus) {
		const bonus = Number(flatBonus) || 0;
		if (!bonus) return damage;

		const raw = String(damage || "").replace(/\s+/g, "").trim();
		const m = raw.match(/^(\d+d\d+)([+-]\d+)?$/i);
		if (!m) return damage;

		const base = m[1];
		const existing = Number(m[2] || 0);
		const total = existing + bonus;
		if (!total) return base;
		return `${base}${total >= 0 ? "+" : ""}${total}`;
	}

	static _getSpellcastingBlocks (state, {npcName = "The NPC"} = {}) {
		const blocks = [];
		const classBlock = this._getClassSpellcastingBlock(state, {npcName});
		if (classBlock) blocks.push(classBlock);
		const innateBlock = this._getInnateSpellcastingBlock(state, {npcName});
		if (innateBlock) blocks.push(innateBlock);
		return blocks;
	}

	static _getSpellDcAndAttack (state, ability) {
		const spellAbility = this._normalizeAbilityAbv(ability || state.getSpellcastingAbility?.() || "int");
		const dcFromState = state.getSpellSaveDcForAbility?.(spellAbility) ??
			state.getSpellSaveDc?.() ??
			null;
		const atkFromState = state.getSpellAttackBonusForAbility?.(spellAbility) ??
			state.getSpellAttackBonus?.() ??
			null;

		const abilityMod = state.getAbilityMod?.(spellAbility) || 0;
		const pb = state.getProficiencyBonus?.() || 2;
		const dc = Number.isFinite(Number(dcFromState)) ? Number(dcFromState) : (8 + pb + abilityMod);
		const atk = Number.isFinite(Number(atkFromState)) ? Number(atkFromState) : (pb + abilityMod);
		return {ability: spellAbility, dc, atk};
	}

	static _formatSpellTag (spell) {
		const name = this._getSafeInlineText(spell?.name || "spell", {maxLen: 80}) || "spell";
		const source = this._getSafeSourceJson(spell?.source || Parser.SRC_XPHB || "XPHB");
		return `{@spell ${name}|${source}}`;
	}

	static _getClassSpellcastingBlock (state, {npcName = "The NPC"} = {}) {
		const cantrips = state.getCantripsKnown?.() || [];
		const spellsKnown = state.getSpellsKnown?.() || [];
		const pact = state.getPactSlots?.() || {};
		const pactMax = Number(pact.max) || 0;
		const pactLevel = Math.max(1, Number(pact.level) || 1);
		const slots = state.getSpellSlots?.() || {};
		const hasSlotTable = Object.values(slots).some(s => Number(s?.max) > 0);
		const hasAnySpells = cantrips.length || spellsKnown.length || pactMax > 0 || hasSlotTable;
		if (!hasAnySpells) return null;

		const {ability, dc, atk} = this._getSpellDcAndAttack(
			state,
			state.getSpellcastingAbility?.() || state.getSpellcasting?.()?.ability || "int",
		);
		const preparedSpells = state.getPreparedSpells?.() || spellsKnown.filter(s => s.prepared || s.alwaysPrepared);
		const isPactCaster = pactMax > 0 && !hasSlotTable;

		const will = cantrips
			.map(s => this._formatSpellTag(s))
			.sort((a, b) => a.localeCompare(b));

		const spells = {};

		if (isPactCaster) {
			const pactSpells = [...new Set(
				[...preparedSpells, ...spellsKnown]
					.filter(s => Number(s.level) >= 1 && Number(s.level) <= pactLevel)
					.map(s => this._formatSpellTag(s)),
			)];
			if (pactSpells.length || pactMax > 0) {
				spells[pactLevel] = {
					lower: 1,
					slots: pactMax,
					spells: pactSpells,
				};
			}
		} else {
			Object.entries(slots)
				.sort((a, b) => Number(a[0]) - Number(b[0]))
				.forEach(([lvl, slotInfo]) => {
					const level = Number(lvl);
					if (!level || !slotInfo?.max) return;

					const preparedAtLevel = preparedSpells
						.filter(s => Number(s.level) === level)
						.map(s => this._formatSpellTag(s));
					const knownAtLevel = spellsKnown
						.filter(s => Number(s.level) === level)
						.map(s => this._formatSpellTag(s));
					const lvlSpells = [...new Set([...preparedAtLevel, ...knownAtLevel])];
					if (!lvlSpells.length) return;
					spells[level] = {slots: slotInfo.max, spells: lvlSpells};
				});

			// Multiclass warlock: surface pact slots as additional note level if present and not already represented
			if (pactMax > 0 && !spells[pactLevel]) {
				const pactSpells = [...new Set(
					[...preparedSpells, ...spellsKnown]
						.filter(s => Number(s.level) >= 1 && Number(s.level) <= pactLevel)
						.map(s => this._formatSpellTag(s)),
				)];
				if (pactSpells.length) {
					spells[pactLevel] = {lower: 1, slots: pactMax, spells: pactSpells};
				}
			}
		}

		if (!will.length && !Object.keys(spells).length) return null;

		const abilityFull = (typeof Parser !== "undefined" && Parser.attAbvToFull)
			? Parser.attAbvToFull(ability)
			: ability.toUpperCase();

		const header = isPactCaster
			? `${npcName} is a spellcaster. ${npcName}'s spellcasting ability is ${abilityFull} (spell save {@dc ${dc}}, {@hit ${this._toSignedStr(atk)}} to hit with spell attacks). ${npcName} regains expended spell slots on a short or long rest.`
			: `${npcName} is a spellcaster. ${npcName}'s spellcasting ability is ${abilityFull} (spell save {@dc ${dc}}, {@hit ${this._toSignedStr(atk)}} to hit with spell attacks).`;

		const out = {
			type: "spellcasting",
			name: isPactCaster ? "Spellcasting (Pact Magic)" : "Spellcasting",
			headerEntries: [header],
			ability,
		};
		if (will.length) out.will = will;
		if (Object.keys(spells).length) out.spells = spells;
		return out;
	}

	static _getInnateSpellcastingBlock (state, {npcName = "The NPC"} = {}) {
		const innate = state.getInnateSpells?.() || [];
		if (!innate.length) return null;

		const abilityHint = innate.find(s => s.spellcastingAbility)?.spellcastingAbility
			|| state.getSpellcastingAbility?.()
			|| "cha";
		const {ability, dc, atk} = this._getSpellDcAndAttack(state, abilityHint);
		const abilityFull = (typeof Parser !== "undefined" && Parser.attAbvToFull)
			? Parser.attAbvToFull(ability)
			: ability.toUpperCase();

		const will = [];
		const daily = {};

		innate.forEach(spell => {
			const tag = this._formatSpellTag(spell);
			if (spell.atWill || spell.usageType === "will") {
				will.push(tag);
				return;
			}
			const maxUses = Number(spell.uses?.max ?? spell.usesMax ?? 0) || 0;
			const keyBase = Math.max(1, maxUses || 1);
			const isEach = !!(spell.isEach || spell.uses?.isEach);
			const key = `${keyBase}${isEach ? "e" : ""}`;
			if (!daily[key]) daily[key] = [];
			daily[key].push(tag);
		});

		const out = {
			type: "spellcasting",
			name: "Innate Spellcasting",
			headerEntries: [
				`${npcName}'s innate spellcasting ability is ${abilityFull} (spell save {@dc ${dc}}, {@hit ${this._toSignedStr(atk)}} to hit with spell attacks). ${npcName} can innately cast the following spells, requiring no material components:`,
			],
			ability,
		};
		if (will.length) out.will = [...new Set(will)].sort((a, b) => a.localeCompare(b));
		if (Object.keys(daily).length) {
			// Sort keys like 1, 1e, 2, 2e
			const sorted = {};
			Object.keys(daily)
				.sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
				.forEach(k => { sorted[k] = [...new Set(daily[k])]; });
			out.daily = sorted;
		}
		if (!out.will && !out.daily) return null;
		return out;
	}

	static _getCombatMethodsBlock (state, {npcName = "The NPC"} = {}) {
		const methods = state.getCombatMethods?.() || [];
		if (!methods.length) return null;
		const calculations = state.getFeatureCalculations?.() || {};
		const methodDc = calculations.combatMethodDc
			|| (8 + (state.getProficiencyBonus?.() || 2) + Math.max(state.getAbilityMod?.("str") || 0, state.getAbilityMod?.("dex") || 0));

		const byCost = new Map();
		methods.forEach(m => {
			const key = Number(m.staminaCost) || 0;
			if (!byCost.has(key)) byCost.set(key, []);
			byCost.get(key).push(m);
		});

		const entries = [];
		const sortedCosts = [...byCost.keys()].sort((a, b) => a - b);
		sortedCosts.forEach(cost => {
			const methodsAtCost = byCost.get(cost)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(m => {
					const actionTypeRaw = m.actionType ? this._getSafeInlineText(m.actionType, {maxLen: 24}) : "Action";
					const actionType = actionTypeRaw ? ` (${actionTypeRaw})` : "";
					const stanceMark = m.isStance ? " [Stance]" : "";
					const safeName = this._getSafeInlineText(m.name, {maxLen: 80}) || "Method";
					const safeSource = this._getSafeSourceJson(m.source || Parser.SRC_TGTT || Parser.SRC_XPHB);
					const methodTag = `{@combatmethod ${safeName}|${safeSource}}`;
					return `${methodTag}${actionType}${stanceMark}`;
				});

			entries.push(`{@b Cost ${cost}:} ${methodsAtCost.join(", ")}.`);
		});

		const staminaMax = state.getStaminaMax?.() || 0;
		const degreeAccess = state.getMethodDegreeAccess?.() || 0;

		entries.unshift(`${npcName} uses combat methods fueled by stamina (pool ${staminaMax}; method degree access ${degreeAccess}; save {@dc ${methodDc}}).`);

		return {
			name: "Combat Methods",
			entries,
		};
	}

	static _getFeatureBlocks (
		state,
		{
			npcName = "The NPC",
			includeFeatures = "auto",
			selectedFeatureIds = [],
			suppressExtraAttack = false,
		} = {},
	) {
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const sourceFeatureIds = new Set((state.getNamedModifiers?.() || [])
			.map(mod => mod?.sourceFeatureId)
			.filter(Boolean));

		const features = (state.getFeatures?.() || [])
			.filter(f => f?.name && f?.description)
			.filter(f => !(typeof CharacterSheetClassUtils !== "undefined" && CharacterSheetClassUtils.isCombatMethod?.(f)));

		const selectedSet = new Set((selectedFeatureIds || []).map(String));
		const classified = features
			.map(feature => this._classifyFeatureForStatblock(feature, {sourceFeatureIds}))
			.filter(({feature, classification}) => {
				if (suppressExtraAttack && /^extra attack\b/i.test(String(feature?.name || ""))) return false;
				if (includeFeatures === "manual") {
					const id = String(feature.id || feature.name || "");
					return selectedSet.has(id) || selectedSet.has(String(feature.name || ""));
				}
				if (includeFeatures === "allImportant") return classification === "important" || feature?.important;
				// auto
				return classification === "important";
			})
			.slice(0, includeFeatures === "manual" ? 24 : 8);

		classified.forEach(({feature, analysis}) => {
			const text = this._normalizeAbilityTextForNpc(this._stripHtmlTags(feature.description).slice(0, 280), {npcName});
			const usesText = this._getFeatureUsesText(feature);
			const entry = {
				name: this._getSafeInlineText(feature.name, {maxLen: 80}) || "Feature",
				entries: [usesText ? `${text} ${usesText}` : text],
			};

			const section = this._getFeatureActivationSection(feature, analysis);
			if (section === "bonus") {
				out.bonus.push(entry);
				return;
			}
			if (section === "reaction") {
				out.reaction.push(entry);
				return;
			}
			if (section === "action") {
				out.action.push(entry);
				return;
			}

			out.trait.push(entry);
		});

		return out;
	}

	static _classifyFeatureForStatblock (feature, {sourceFeatureIds = new Set()} = {}) {
		const analysis = CharacterSheetState.analyzeFeature?.(feature) || null;
		const rawText = String(feature?.description || "").toLowerCase();

		const hasLimitedUses = Number(feature?.uses?.max || 0) > 0;
		const hasCombatKeyword = /\b(action|bonus action|reaction|save|damage|attack|resistance|immunity|advantage|disadvantage)\b/i.test(rawText);
		const isBackgroundFeature = String(feature?.featureType || "").toLowerCase() === "background";

		const isImportant = !!(
			hasLimitedUses
			|| feature?.important
			|| analysis?.isActivatable
			|| analysis?.hasResourceCost
			|| hasCombatKeyword
		);

		const effectTypes = new Set((analysis?.effects || []).map(e => e?.type).filter(Boolean));
		const statDerivedEffectTypes = new Set([
			"bonus", "penalty", "setMinimum", "setMaximum", "setValue",
			"advantage", "disadvantage", "proficiency", "expertise",
			"setSpeed", "speed", "ac", "hp", "damage", "attack",
		]);
		const allEffectsAreStatDerived = effectTypes.size
			&& [...effectTypes].every(type => statDerivedEffectTypes.has(type));
		const activationSection = this._getFeatureActivationSection(feature, analysis);

		const isAlreadyApplied = !!(
			!activationSection
			&& (sourceFeatureIds.has(feature?.id) || allEffectsAreStatDerived)
		);

		if (isBackgroundFeature) {
			return {feature, analysis, classification: "notImportant"};
		}

		if (isAlreadyApplied) return {feature, analysis, classification: "alreadyApplied"};
		if (!isImportant) return {feature, analysis, classification: "notImportant"};
		return {feature, analysis, classification: "important"};
	}

	static _getFeatureActivationSection (feature, analysis = null) {
		const activationAction = String(analysis?.activationInfo?.activationAction || "").toLowerCase();
		if (activationAction === "bonus") return "bonus";
		if (activationAction === "reaction") return "reaction";
		if (activationAction === "action" || activationAction === "attack") return "action";

		const text = String(feature?.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
		if (/\bas a bonus action\b|\buse (?:a|your) bonus action\b/.test(text)) return "bonus";
		if (/\bas a reaction\b|\buse (?:a|your) reaction\b/.test(text)) return "reaction";
		if (/\bas an action\b|\buse (?:an|your) action\b/.test(text)) return "action";
		return null;
	}

	static _getFeatureUsesText (feature) {
		const uses = feature?.uses;
		if (!uses || !Number.isFinite(Number(uses.max)) || Number(uses.max) <= 0) return "";
		const current = Number.isFinite(Number(uses.current)) ? Number(uses.current) : Number(uses.max);
		const recharge = this._getSafeInlineText(uses.recharge || "", {maxLen: 24});
		return `(${current}/${Number(uses.max)} uses${recharge ? `; recharges on ${recharge}` : ""})`;
	}

	static _getCustomAbilityBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const abilities = state.getCustomAbilities?.() || [];
		if (!abilities.length) return out;

		const passiveEntries = [];
		abilities.forEach(ability => {
			const safeName = this._getSafeInlineText(ability?.name || "Custom Ability", {maxLen: 80}) || "Custom Ability";
			const description = this._normalizeAbilityTextForNpc(this._stripHtmlTags(ability?.description || ""), {npcName});
			const mode = this._getSafeInlineText(ability?.mode || "passive", {maxLen: 24}) || "passive";
			const uses = ability?.uses;
			const usesText = uses && Number.isFinite(Number(uses.max))
				? `${Number.isFinite(Number(uses.current)) ? Number(uses.current) : Number(uses.max)}/${Number(uses.max)} uses`
				: "";
			const statusText = ability?.isActive === false ? "inactive" : "active";

			const entryText = [description || `${safeName} grants custom effects.`, `(${mode}; ${statusText}${usesText ? `; ${usesText}` : ""})`]
				.filter(Boolean)
				.join(" ");

			const activation = String(ability?.activationAction || "").toLowerCase();
			const isActivatable = mode !== "passive" || ["action", "bonus", "reaction"].includes(activation);
			if (isActivatable) {
				const actionEntry = {
					name: safeName,
					entries: [entryText],
				};
				if (activation === "bonus") out.bonus.push(actionEntry);
				else if (activation === "reaction") out.reaction.push(actionEntry);
				else out.action.push(actionEntry);
				return;
			}

			passiveEntries.push(`• {@b ${safeName}.} ${entryText}`);
		});

		if (passiveEntries.length) {
			out.trait.push({
				name: "Custom Abilities",
				entries: passiveEntries.slice(0, 12),
			});
		}

		return out;
	}

	static _getNamedModifierTrait (state, {npcName = "The NPC"} = {}) {
		const modifiers = state.getNamedModifiers?.() || [];
		if (!modifiers.length) return null;

		const entries = modifiers
			.slice(0, 20)
			.map(mod => {
				const name = this._getSafeInlineText(mod?.name || "Modifier", {maxLen: 80}) || "Modifier";
				const type = this._getSafeInlineText(mod?.type || "ac", {maxLen: 48}) || "ac";
				const target = this._getModifierTargetLabel(type);
				const value = this._getModifierValueSummary(mod);
				const status = mod?.enabled === false ? "disabled" : "enabled";
				const note = this._normalizeAbilityTextForNpc(this._getSafeInlineText(mod?.note || "", {maxLen: 120}), {npcName});
				const conditionalText = this._getSafeInlineText(mod?.conditional || "", {maxLen: 64});
				const bits = [target, value, status, conditionalText ? `if ${conditionalText}` : "", note].filter(Boolean);
				return `• {@b ${name}.} ${bits.join("; ")}.`;
			});

		return {
			name: "Custom Modifiers",
			entries,
		};
	}

	static _getModifierTargetLabel (type) {
		const map = {
			ac: "Armor Class",
			initiative: "initiative",
			attack: "attack rolls",
			damage: "damage rolls",
			hp: "hit points",
			spellDc: "spell save DC",
			spellAttack: "spell attacks",
			speed: "speed",
			d20: "d20 rolls",
		};

		if (map[type]) return map[type];
		if (type.startsWith("save:")) return `${type.split(":")[1].toUpperCase()} saves`;
		if (type.startsWith("skill:")) return `${type.split(":")[1]} checks`;
		if (type.startsWith("check:")) return `${type.split(":")[1].toUpperCase()} checks`;
		return type;
	}

	static _getModifierValueSummary (modifier) {
		if (!modifier) return "";
		if (modifier.advantage) return "advantage";
		if (modifier.disadvantage) return "disadvantage";
		if (modifier.autoSuccess) return "auto success";
		if (modifier.autoFail) return "auto fail";
		if (modifier.setValue != null) return `set to ${modifier.setValue}`;
		if (modifier.setMinimum != null) return `minimum ${modifier.setMinimum}`;
		if (modifier.setMaximum != null) return `maximum ${modifier.setMaximum}`;
		if (modifier.bonusDie) return `+${modifier.bonusDie}`;
		if (Number.isFinite(Number(modifier.value)) && Number(modifier.value)) return this._toSignedStr(Number(modifier.value));
		return "contextual";
	}

	static _getNpcReferenceName (name) {
		const safeName = this._getSafeInlineText(name || "", {maxLen: 80});
		if (!safeName) return "The NPC";
		return safeName;
	}

	static _normalizeAbilityTextForNpc (text, {npcName = "The NPC"} = {}) {
		const safeText = this._getSafeInlineText(text || "", {maxLen: 280}) || "";
		if (!safeText) return "";

		const possessive = npcName.endsWith("s") ? `${npcName}'` : `${npcName}'s`;
		return safeText
			.replace(/\byourself\b/gi, npcName)
			.replace(/\byou are\b/gi, `${npcName} is`)
			.replace(/\byou have\b/gi, `${npcName} has`)
			.replace(/\byou can\b/gi, `${npcName} can`)
			.replace(/\byou gain\b/gi, `${npcName} gains`)
			.replace(/\byour\b/gi, possessive)
			.replace(/\byou\b/gi, npcName)
			.replace(/\s+/g, " ")
			.trim();
	}

	static _stripHtmlTags (text) {
		if (!text) return "";
		return text
			.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, "$1")
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	static _getHpFormula (maxHp, state) {
		const conMod = state?.getAbilityMod?.("con") || 0;
		const hitDie = this._getPrimaryHitDie(state);
		// Choose die count so average (n*(die+1)/2 + n*con) ≈ maxHp
		const perDie = ((hitDie + 1) / 2) + conMod;
		let n;
		if (perDie <= 0) {
			n = Math.max(1, Math.round(maxHp / Math.max(1, (hitDie + 1) / 2)));
		} else {
			n = Math.max(1, Math.round(maxHp / perDie));
		}
		// Clamp absurd counts
		n = Math.max(1, Math.min(40, n));
		const conPart = conMod * n;
		if (!conPart) return `${n}d${hitDie}`;
		return `${n}d${hitDie} ${conPart >= 0 ? "+" : "-"} ${Math.abs(conPart)}`;
	}

	static _getPrimaryHitDie (state) {
		const classes = state?.getClasses?.() || [];
		if (!classes.length) return 8;
		// Highest level class; ties → first listed
		const primary = [...classes].sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0))[0];
		const name = primary?.name || "";
		const fromState = state?._getClassHitDie?.(name);
		if (Number.isFinite(Number(fromState)) && Number(fromState) >= 6) return Number(fromState);
		const map = {
			barbarian: 12,
			fighter: 10,
			paladin: 10,
			ranger: 10,
			bloodhunter: 10,
			"blood hunter": 10,
			bard: 8,
			cleric: 8,
			druid: 8,
			monk: 8,
			rogue: 8,
			warlock: 8,
			artificer: 8,
			wizard: 6,
			sorcerer: 6,
		};
		return map[String(name).toLowerCase()] || 8;
	}

	static _normalizeAbilityAbv (ability) {
		const normalized = String(ability || "").toLowerCase().trim();
		if ((Parser.ABIL_ABVS || []).includes(normalized)) return normalized;
		return "int";
	}

	static _estimateCr ({totalLevel, hp, ac, attacks, attacksPerAction = 1, spellcastingBlocks = [], state = null}) {
		const defensiveCr = this._crFromHpAndAc(hp, ac);
		const dpr = this._estimateDpr({attacks, attacksPerAction, spellcastingBlocks, state});
		const offensiveCr = this._crFromDprAndAttack(dpr, attacks, state);

		const defVal = this._crStringToNumber(defensiveCr);
		const offVal = this._crStringToNumber(offensiveCr);
		const avg = (defVal + offVal) / 2;
		// Mild level anchor so low-level squishy casters don't collapse to CR 0
		const levelAnchor = totalLevel <= 1 ? 0.25 : Math.max(0.5, (totalLevel - 1) * 0.65);
		const blended = (avg * 0.75) + (levelAnchor * 0.25);
		const cr = this._toCrString(blended);

		return {
			cr,
			defensiveCr,
			offensiveCr,
			breakdown: `CR estimate: defensive ${defensiveCr} / offensive ${offensiveCr} (DPR ~${Math.round(dpr)}) → ${cr}`,
		};
	}

	static _crFromHpAndAc (hp, ac) {
		const table = CharacterSheetNpcExporter._CR_HP_THRESHOLDS;
		let ix = 0;
		for (let i = 0; i < table.length; i++) {
			if (hp <= table[i].hp) { ix = i; break; }
			ix = i;
		}
		// AC adjustment: ±1 CR step per 2 AC from 13
		const acAdj = Math.round(((Number(ac) || 10) - 13) / 2);
		ix = Math.max(0, Math.min(table.length - 1, ix + acAdj));
		return table[ix].cr;
	}

	static _crFromDprAndAttack (dpr, attacks, state) {
		const table = CharacterSheetNpcExporter._CR_DPR_THRESHOLDS;
		let ix = 0;
		for (let i = 0; i < table.length; i++) {
			if (dpr <= table[i].dpr) { ix = i; break; }
			ix = i;
		}
		const attackBonuses = (attacks || []).map(a => this._getAttackToHit(a, state));
		const avgAtk = attackBonuses.length
			? attackBonuses.reduce((a, b) => a + b, 0) / attackBonuses.length
			: 0;
		const atkAdj = Math.round((avgAtk - 3) / 2);
		ix = Math.max(0, Math.min(table.length - 1, ix + Math.max(-2, Math.min(2, atkAdj))));
		return table[ix].cr;
	}

	static _estimateDpr ({attacks = [], attacksPerAction = 1, spellcastingBlocks = [], state = null}) {
		const perHit = attacks.length
			? Math.max(...attacks.map(a => this._estimateDamageScore(a)))
			: 5;
		const weaponDpr = perHit * Math.max(1, attacksPerAction);

		// Rough spell contribution: highest cantrip-ish or leveled presence
		let spellDpr = 0;
		if (spellcastingBlocks?.length) {
			const pb = state?.getProficiencyBonus?.() || 2;
			// cantrip scaling proxy by PB band
			const cantripDice = pb >= 6 ? 4 : pb >= 4 ? 3 : pb >= 3 ? 2 : 1;
			spellDpr = cantripDice * 5.5; // e.g. fire bolt-ish
			const hasLeveled = spellcastingBlocks.some(b => b.spells && Object.keys(b.spells).length);
			if (hasLeveled) spellDpr += 10;
		}
		return Math.max(weaponDpr, spellDpr * 0.75);
	}

	static _estimateDamageScore (attack) {
		const damage = this._normalizeDamageFormula(attack.damage || "");
		const m = damage.match(/(\d+)d(\d+)(?:([+-])(\d+))?/i);
		if (m) {
			const count = Number(m[1]) || 1;
			const die = Number(m[2]) || 6;
			const avg = count * (die + 1) / 2;
			const bonus = m[4] ? (m[3] === "-" ? -Number(m[4]) : Number(m[4])) : 0;
			return avg + bonus;
		}

		return Number(damage) || 5;
	}

	static _crStringToNumber (cr) {
		const map = {"0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5};
		if (map[cr] != null) return map[cr];
		const n = Number(cr);
		return Number.isFinite(n) ? n : 1;
	}

	static _toCrString (value) {
		if (value <= 0) return "0";
		if (value <= 0.125) return "1/8";
		if (value <= 0.25) return "1/4";
		if (value <= 0.5) return "1/2";
		return `${Math.min(30, Math.max(1, Math.round(value)))}`;
	}

	static _getLegendaryResistanceTrait (count, {npcName = "The NPC"} = {}) {
		const n = Math.max(1, Number(count) || 1);
		return {
			name: `Legendary Resistance (${n}/Day)`,
			entries: [
				`If ${npcName} fails a saving throw, ${npcName} can choose to succeed instead.`,
			],
		};
	}

	static _getLegendaryActions (state, {npcName = "The NPC", attacks = [], count = 3} = {}) {
		if (count <= 0) return null;
		const actions = [];
		const primary = (attacks || []).find(a => a?.name && !this._isDefaultUnarmedAttack(a))
			|| (attacks || []).find(a => a?.name)
			|| null;
		const attackName = this._getSafeInlineText(primary?.name || "weapon attack", {maxLen: 48}) || "weapon attack";

		actions.push({
			name: attackName,
			entries: [`${npcName} makes one ${attackName} attack.`],
		});
		actions.push({
			name: "Move",
			entries: [`${npcName} moves up to half its speed without provoking opportunity attacks.`],
		});

		const cantrips = state.getCantripsKnown?.() || [];
		if (cantrips.length) {
			const tag = this._formatSpellTag(cantrips[0]);
			actions.push({
				name: "Cast a Cantrip (Costs 2 Actions)",
				entries: [`${npcName} casts ${tag}.`],
			});
		} else {
			const feature = (state.getFeatures?.() || []).find(f => f?.important && f?.name && !/^extra attack/i.test(f.name));
			if (feature) {
				const fname = this._getSafeInlineText(feature.name, {maxLen: 48}) || "Feature";
				actions.push({
					name: `${fname} (Costs 2 Actions)`,
					entries: [`${npcName} uses ${fname}.`],
				});
			} else {
				actions.push({
					name: "Aggressive Strike (Costs 2 Actions)",
					entries: [`${npcName} makes two ${attackName} attacks.`],
				});
			}
		}

		return actions.slice(0, 4);
	}
}

globalThis.CharacterSheetNpcExporter = CharacterSheetNpcExporter;

export {CharacterSheetNpcExporter};
