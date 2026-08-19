class CharacterSheetNpcExporter {
	static SOURCE_JSON_DEFAULT = "CSHEET";
	static SOURCE_FULL_DEFAULT = "Character Sheet NPC Exports";
	static SOURCE_VERSION_DEFAULT = "1.0.0";

	// 5etools item `dmgType` codes → statblock words.
	static _DMG_TYPE_CODES = {
		A: "acid",
		B: "bludgeoning",
		C: "cold",
		F: "fire",
		O: "force",
		L: "lightning",
		N: "necrotic",
		P: "piercing",
		I: "poison",
		Y: "psychic",
		R: "radiant",
		S: "slashing",
		T: "thunder",
	};

	static _ABILITY_CODES = {
		str: "STR",
		strength: "STR",
		dex: "DEX",
		dexterity: "DEX",
		con: "CON",
		constitution: "CON",
		int: "INT",
		intelligence: "INT",
		wis: "WIS",
		wisdom: "WIS",
		cha: "CHA",
		charisma: "CHA",
	};

	static _MOD_TYPE_LABELS = {
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

	static _MOD_SCOPE_WORDS = {
		onehanded: "one-handed weapons",
		twohanded: "two-handed weapons",
		melee: "melee attacks",
		ranged: "ranged attacks",
		spell: "spells",
		magic: "magic",
		reroll: "rerolls",
		weapon: "weapons",
	};

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

	/**
	 * The 2024 facts about each base weapon, keyed by lowercased name.
	 *
	 * Two defects share one cause. Most magic weapons in the corpus are built on a *2014*
	 * base item — `greatsword|phb`, `war pick|phb` — which carries no mastery at all, so a
	 * Weapon Mastery character's signature weapon exports without the property it is
	 * entitled to. Separately, homebrew weapons frequently omit `property`, `dmgType` and
	 * `weaponCategory` entirely, and the attack derivation then reads Finesse as absent,
	 * proficiency as absent and the damage type as bludgeoning — Juen's Hecate's Dagger
	 * exported at +8 for 1d4+2 bludgeoning instead of +14 for 1d4+8 piercing.
	 *
	 * The 2024 twin of every base weapon shares its name, so the name alone recovers all
	 * of it. Mirrors the XPHB `baseitem` entries in `data/items-base.json`.
	 */
	static _XPHB_BASE_WEAPON = {
		"battleaxe": {mastery: "Topple", dmgType: "S", category: "martial", properties: ["V"]},
		"blowgun": {mastery: "Vex", dmgType: "P", category: "martial", properties: ["A", "LD"]},
		"club": {mastery: "Slow", dmgType: "B", category: "simple", properties: ["L"]},
		"dagger": {mastery: "Nick", dmgType: "P", category: "simple", properties: ["F", "L", "T"]},
		"dart": {mastery: "Vex", dmgType: "P", category: "simple", properties: ["F", "T"]},
		"flail": {mastery: "Sap", dmgType: "B", category: "martial", properties: []},
		"glaive": {mastery: "Graze", dmgType: "S", category: "martial", properties: ["H", "R", "2H"]},
		"greataxe": {mastery: "Cleave", dmgType: "S", category: "martial", properties: ["H", "2H"]},
		"greatclub": {mastery: "Push", dmgType: "B", category: "simple", properties: ["2H"]},
		"greatsword": {mastery: "Graze", dmgType: "S", category: "martial", properties: ["H", "2H"]},
		"halberd": {mastery: "Cleave", dmgType: "S", category: "martial", properties: ["H", "R", "2H"]},
		"hand crossbow": {mastery: "Vex", dmgType: "P", category: "martial", properties: ["A", "L", "LD"]},
		"handaxe": {mastery: "Vex", dmgType: "S", category: "simple", properties: ["L", "T"]},
		"heavy crossbow": {mastery: "Push", dmgType: "P", category: "martial", properties: ["A", "H", "LD", "2H"]},
		"javelin": {mastery: "Slow", dmgType: "P", category: "simple", properties: ["T"]},
		"lance": {mastery: "Topple", dmgType: "P", category: "martial", properties: ["H", "R", "2H"]},
		"light crossbow": {mastery: "Slow", dmgType: "P", category: "simple", properties: ["A", "LD", "2H"]},
		"light hammer": {mastery: "Nick", dmgType: "B", category: "simple", properties: ["L", "T"]},
		"longbow": {mastery: "Slow", dmgType: "P", category: "martial", properties: ["A", "H", "2H"]},
		"longsword": {mastery: "Sap", dmgType: "S", category: "martial", properties: ["V"]},
		"mace": {mastery: "Sap", dmgType: "B", category: "simple", properties: []},
		"maul": {mastery: "Topple", dmgType: "B", category: "martial", properties: ["H", "2H"]},
		"morningstar": {mastery: "Sap", dmgType: "P", category: "martial", properties: []},
		"musket": {mastery: "Slow", dmgType: "P", category: "martial", properties: ["A", "LD", "2H"]},
		"pike": {mastery: "Push", dmgType: "P", category: "martial", properties: ["H", "R", "2H"]},
		"pistol": {mastery: "Vex", dmgType: "P", category: "martial", properties: ["A", "LD"]},
		"quarterstaff": {mastery: "Topple", dmgType: "B", category: "simple", properties: ["V"]},
		"rapier": {mastery: "Vex", dmgType: "P", category: "martial", properties: ["F"]},
		"scimitar": {mastery: "Nick", dmgType: "S", category: "martial", properties: ["F", "L"]},
		"shortbow": {mastery: "Vex", dmgType: "P", category: "simple", properties: ["A", "2H"]},
		"shortsword": {mastery: "Vex", dmgType: "P", category: "martial", properties: ["F", "L"]},
		"sickle": {mastery: "Nick", dmgType: "S", category: "simple", properties: ["L"]},
		"sling": {mastery: "Slow", dmgType: "B", category: "simple", properties: ["A"]},
		"spear": {mastery: "Sap", dmgType: "P", category: "simple", properties: ["T", "V"]},
		"trident": {mastery: "Topple", dmgType: "P", category: "martial", properties: ["T", "V"]},
		"war pick": {mastery: "Sap", dmgType: "P", category: "martial", properties: ["V"]},
		"warhammer": {mastery: "Push", dmgType: "B", category: "martial", properties: ["V"]},
		"whip": {mastery: "Slow", dmgType: "S", category: "martial", properties: ["F", "R"]},
	};

	static _MASTERY_PROPERTY_NAMES = ["Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex"];

	/**
	 * The 2024 base-weapon record behind an inventory item, or `null`.
	 *
	 * @param {object} item inventory item
	 * @returns {object|null} `{mastery, dmgType, category, properties}`
	 */
	static _getBaseWeaponRecord (item) {
		const baseName = String(item?.baseItem || "").split("|")[0].trim().toLowerCase();
		if (baseName && this._XPHB_BASE_WEAPON[baseName]) return this._XPHB_BASE_WEAPON[baseName];
		// A homebrew weapon that declares no base item may still *be* one by name.
		const ownName = String(item?.name || "").trim().toLowerCase();
		return this._XPHB_BASE_WEAPON[ownName] || null;
	}

	/**
	 * Fills in the weapon facts a homebrew or 2014 item omitted, from its 2024 base weapon.
	 *
	 * Only ever adds: an item that states its own damage type, properties or category is
	 * authoritative and is returned untouched. Without this, a weapon missing `property`
	 * loses Finesse (so a Dexterity rogue swings at Strength), loses its category (so
	 * proficiency is not detected, costing the whole proficiency bonus) and falls back to
	 * bludgeoning damage.
	 *
	 * @param {object} item inventory item
	 * @returns {object} the item, or a filled-in copy of it
	 */
	static _withBaseWeaponFacts (item) {
		if (!item) return item;
		const declared = (item.property?.length ? item.property : null) || item.properties || [];
		const base = this._getBaseWeaponRecord(item);

		const out = {...item};
		let changed = false;
		// `updateAttackFromWeapon` reads `item.property || item.properties`, and an *empty*
		// array is truthy — so a saved item carrying `property: []` alongside a populated
		// `properties` silently loses Finesse, and a Dexterity rogue swings at Strength.
		if (Array.isArray(item.property) && !item.property.length && declared.length) {
			out.property = [...declared];
			changed = true;
		}
		if (!base) return changed ? out : item;

		if (!declared.length && base.properties.length) {
			out.property = [...base.properties];
			out.properties = [...base.properties];
			changed = true;
		}
		if (!item.dmgType && base.dmgType) { out.dmgType = base.dmgType; changed = true; }
		if (!item.weaponCategory && base.category) { out.weaponCategory = base.category; changed = true; }
		return changed ? out : item;
	}

	/**
	 * Mastery a magic weapon inherits from its base item, or `""`.
	 *
	 * Gated twice, because printing a property the creature cannot use is a worse bug than
	 * omitting one: the character must have the Weapon Mastery feature *and* have chosen
	 * this base weapon as one of its mastered weapons.
	 *
	 * @param {object} item inventory item
	 * @param {object} state character state
	 * @returns {string} mastery property name, or `""`
	 */
	static _getInheritedMasteryFromBaseItem (item, state) {
		if (!item || !state) return "";
		if (item.mastery?.length) return "";

		const mastery = this._getBaseWeaponRecord(item)?.mastery;
		if (!mastery) return "";

		const baseName = String(item.baseItem || item.name || "").split("|")[0].trim().toLowerCase();
		const calc = state.getFeatureCalculations?.() || {};
		if (!calc.hasWeaponMastery && !calc.weaponMasterySlots) return "";
		if (!state.hasWeaponMastery?.(baseName)) return "";

		return mastery;
	}

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
			// Smart residual: default ON so leftovers not promoted elsewhere still appear.
			// Pure bookkeeping (folded defenses/speed/HP/skills) is still filtered out.
			includeCustomModifiers: opts.includeCustomModifiers !== false,
			includeCustomAbilities: opts.includeCustomAbilities !== false,
			includeCombatMethods: opts.includeCombatMethods !== false,
			crMode,
			crManual,
			// Built by the caller from the site's spell data; absent in tests and headless
			// use, where the school-weighted fallback takes over.
			spellIndex: (opts.spellIndex && typeof opts.spellIndex === "object") ? opts.spellIndex : null,
			legendaryEnabled: !!opts.legendaryEnabled,
			legendaryActions,
			legendaryResistances,
			nameSuffix,
			includeCrBreakdown: !!opts.includeCrBreakdown,
			includeLevelSignal: !!opts.includeLevelSignal,
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
		this._activeSpellVocabulary = this._getSpellVocabulary(state);
		this._activeLevelContext = this._getLevelContext(state);
		try {
			return this._convertStateToMonsterInner(state, options, exportOpts);
		} finally {
			this._activeSpellVocabulary = null;
			this._activeLevelContext = null;
		}
	}

	/** Class levels keyed by lowercased class name, plus the total, for table row selection. */
	static _getLevelContext (state) {
		const byClass = {};
		(state?.getClasses?.() || []).forEach(cls => {
			const key = String(cls?.name || "").trim().toLowerCase();
			if (key) byClass[key] = Math.max(byClass[key] || 0, Number(cls?.level) || 0);
		});
		return {byClass, total: Number(state?.getTotalLevel?.()) || 0};
	}

	static _convertStateToMonsterInner (state, options, exportOpts) {
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
		this._rebuildSpellProvenanceTags(state);
		this._rebuildSpellCastingTimes(state, exportOpts?.spellIndex);
		this._rebuildCompanionItemSource(safeSource);
		const size = [this._getSizeAbv(state.getSize?.() || "medium")];
		const speed = this._getSpeedObject(state);
		const saves = this._getSaveBlock(state);
		const {skills, uniform: uniformSkillBonus} = this._getSkillBlockDetail(state);
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
		const damageRiders = (() => {
			const base = [
				...this._getConditionalDamageRiders(state, calculations),
				...this._getItemDamageRiders(attacks),
			];
			return [...base, ...this._getItemProseDamageRiders(attacks, base)];
		})();
		// The sheet stores a whole-feature rider (Radiant Strikes, Divine Strike) as its own
		// attack row, so the block printed a phantom weapon whose damage is really an extra
		// die on every other attack. The rider now rides those attacks; the row is a ghost.
		const riderAttackNames = new Set(damageRiders
			.filter(rider => rider.wholeFeature && rider.sourceName)
			.map(rider => this._normalizeFeatureKey(rider.sourceName)));
		const realAttacks = riderAttackNames.size
			? attacks.filter(attack => !riderAttackNames.has(this._normalizeFeatureKey(attack?.name)))
			: attacks;
		const weaponActions = [
			...this._getActionEntriesFromAttacks(realAttacks, state, {damageRiders}),
			...this._getFeatureWeaponActions(state, {npcName}),
			...this._getFeatureGrantedAttacks(state, calculations, {npcName}),
		];
		const multiattackAction = this._getMultiattackAction(state, {
			npcName,
			attacks: realAttacks,
			attacksPerAction,
		});
		const actions = [
			...(multiattackAction ? [multiattackAction] : []),
			...weaponActions,
		];

		const methodsBlock = exportOpts.includeCombatMethods
			? this._getCombatMethodsBlock(state, {npcName})
			: null;
		const specialEquipmentBlock = this._getSpecialEquipmentBlock(state);
		const divineFavorBlock = this._getDivineFavorBlock(state, {npcName});
		const armorUpgradeBlock = this._getArmorUpgradeBlock(state);
		const gemstoneNotesBlock = this._getGemstoneNotesBlock(state);
		const itemUseBlocks = this._getMagicItemUseBlocks(state, {npcName});
		const spellcastingBlocks = this._getSpellcastingBlocks(state, {npcName});

		const featureBlocks = this._getFeatureBlocks(state, {
			npcName,
			includeFeatures: exportOpts.includeFeatures,
			selectedFeatureIds: exportOpts.selectedFeatureIds,
			suppressExtraAttack: !!multiattackAction,
			// An attack line that says "plus 1d8 damage against Constructs" is meaningless
			// if the cap evicts the feature that grants it, so referenced features are
			// exempt for the same reason limited-use pool owners are.
			protectedFeatureNames: damageRiders.map(rider => rider.sourceName).filter(Boolean),
		});
		// A rider that reproduces its feature in full makes the feature's own trait pure
		// duplication of the attack line it now sits on. Deletion is available only to
		// leaves: a feature another entry names (see `_buildFeatureReferenceGraph`) keeps
		// its antecedent no matter how completely the line restates it.
		const referenceGraph = this._buildFeatureReferenceGraph(featureBlocks);
		// Residue first: an entry that still says something the line does not carry has
		// earned its place, even when the rider claimed the whole feature.
		const reducedNames = this._reduceRiderSourcesToResidue(featureBlocks, damageRiders, referenceGraph);
		const riderReplacedNames = new Set(damageRiders
			.filter(rider => rider.wholeFeature && rider.sourceName && !this._isReferencedAnchor(rider.sourceName, referenceGraph))
			.map(rider => this._normalizeFeatureKey(rider.sourceName))
			.filter(key => !reducedNames.has(key)));
		if (riderReplacedNames.size) {
			["trait", "action", "bonus", "reaction"].forEach(section => {
				if (!featureBlocks[section]?.length) return;
				featureBlocks[section] = featureBlocks[section]
					.filter(entry => !riderReplacedNames.has(this._normalizeFeatureKey(entry?.name)));
			});
		}
		const customAbilityBlocks = exportOpts.includeCustomAbilities
			? this._getCustomAbilityBlocks(state, {npcName})
			: {trait: [], action: [], bonus: [], reaction: []};

		// Ability names that already carry limited-use pools → suppress Class Resources rows.
		const coveredPoolNames = this._collectCoveredResourceNames(state, {
			featureBlocks,
			customAbilityBlocks,
			itemUseBlocks,
			methodsBlock,
		});
		const classResourcesBlock = this._getClassResourcesBlock(state, {npcName, coveredPoolNames});

		const representedAbilityNames = this._collectRepresentedAbilityNames({
			featureBlocks,
			customAbilityBlocks,
			itemUseBlocks,
			methodsBlock,
		});
		const namedModifierTrait = exportOpts.includeCustomModifiers
			? this._getNamedModifierTrait(state, {
				npcName,
				representedAbilityNames,
				describedEffects: this._collectDescribedEffectTexts({featureBlocks, customAbilityBlocks, itemUseBlocks, extraBlocks: divineFavorBlock ? {trait: [divineFavorBlock]} : null}),
			})
			: null;
		const promotedBonusActions = exportOpts.includeCustomModifiers
			? this._getPromotedBonusActionBlocks(state, {npcName, representedAbilityNames, attacks})
			: [];

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
				defenses,
				spellIndex: exportOpts.spellIndex,
			});

		const levelSignalEntries = [
			`Built from a level ${Math.max(0, totalLevel)} character (${this._getSafeInlineText(state.getClassSummary?.() || "No Class", {maxLen: 120})}).`,
		];
		if (exportOpts.includeCrBreakdown && crInfo.breakdown) {
			levelSignalEntries.push(crInfo.breakdown);
		}
		// Out-of-fiction provenance: opt-in only, but forced on when the CR breakdown
		// is requested since that note has nowhere else to live.
		const levelSignal = (exportOpts.includeLevelSignal || exportOpts.includeCrBreakdown)
			? {name: "Level Signal", entries: levelSignalEntries}
			: null;

		const legendaryResistanceTrait = exportOpts.legendaryEnabled && exportOpts.legendaryResistances > 0
			? this._getLegendaryResistanceTrait(exportOpts.legendaryResistances, {npcName})
			: null;
		// Defences outside the schema vocabularies would be dropped by a validator, so
		// state them in prose instead of losing them.
		const offSchemaDefenseTrait = (defenses.offSchema || []).length
			? {
				name: "Other Defenses",
				entries: [`${npcName} also has ${(defenses.offSchema || []).join(", ")}.`],
			}
			: null;
		const uniformSkillBonusTrait = uniformSkillBonus
			? {
				name: "Skill Versatility",
				entries: [`${npcName} adds ${this._toSignedStr(uniformSkillBonus.value)} to every ability check not listed above${uniformSkillBonus.feature ? ` (${this._getFeatureHoverTag(uniformSkillBonus.feature)})` : ""}.`],
			}
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
			isNpc: true,
			size,
			type: monsterType,
			alignment,
			ac: this._getAcEntries(state, ac, acFrom),
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
				...(levelSignal ? [levelSignal] : []),
				...(legendaryResistanceTrait ? [legendaryResistanceTrait] : []),
				...(classResourcesBlock ? [classResourcesBlock] : []),
				...(featureBlocks.trait || []),
				...(customAbilityBlocks.trait || []),
				...(itemUseBlocks.trait || []),
				...(namedModifierTrait ? [namedModifierTrait] : []),
				...(divineFavorBlock ? [divineFavorBlock] : []),
				...(specialEquipmentBlock ? [specialEquipmentBlock] : []),
				...(armorUpgradeBlock ? [armorUpgradeBlock] : []),
				...(gemstoneNotesBlock ? [gemstoneNotesBlock] : []),
				...(uniformSkillBonusTrait ? [uniformSkillBonusTrait] : []),
				...(offSchemaDefenseTrait ? [offSchemaDefenseTrait] : []),
				...(methodsBlock ? [methodsBlock] : []),
			],
			action: [...actions, ...(featureBlocks.action || []), ...(customAbilityBlocks.action || []), ...(itemUseBlocks.action || [])],
		};

		const bonusAll = [
			...(featureBlocks.bonus || []),
			...(customAbilityBlocks.bonus || []),
			...(itemUseBlocks.bonus || []),
			...promotedBonusActions,
		];
		const reactionAll = [
			...(featureBlocks.reaction || []),
			...(customAbilityBlocks.reaction || []),
			...(itemUseBlocks.reaction || []),
		];
		if (bonusAll.length) out.bonus = bonusAll;
		if (reactionAll.length) out.reaction = reactionAll;

		if (Object.keys(saves).length) out.save = saves;
		if (Object.keys(skills).length) out.skill = skills;

		// Initiative is only worth stating when the character beats (or trails) the
		// bare Dexterity modifier a reader would otherwise assume — Alert, Feral
		// Instinct and similar are invisible otherwise.
		const initiative = this._getInitiativeValue(state);
		if (initiative != null) out.initiative = initiative;
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

		this._dedupeStatblockEntries(out);
		this._compactStatblockProse(out);
		// Early: the provenance label is a prefix on the first sentence, so every later pass
		// that reasons about how an entry opens needs it gone first.
		this._stripFeatureProvenanceLabels(out);
		this._resolveDerivedNumbers(out, state, calculations);
		this._resolvePsionicPowerSaveDcs(out, state, calculations);
		this._resolveScaledFeatureDice(out, calculations);
		this._normalizeResourceTerminology(out, state);
		this._stripBlockRestatedSentences(out, state);
		this._stripRestatedNumericSentences(out, state);
		this._dropRedundantSpellGrantEntries(out, state);
		this._dropResourcesCoveredBySpellcasting(out);
		this._splitMultiBenefitEntries(out);
		this._absorbOrphanRiderEntries(out);
		this._dropUseCountImprovementEntries(out);
		this._dropEntriesRestatedAsLabelledClauses(out);
		this._consolidateManeuverEntries(out, state, calculations, {npcName});
		this._consolidateMetamagicEntries(out, state, {npcName});
		this._mergeResilienceTraits(out, {npcName});
		this._resolveHeldWeaponReferences(out, state);
		this._consolidateShapeshiftEntries(out, state, {npcName});
		// After the shapeshift merge: the base and improved statements of the same quantity
		// only meet each other once both features are folded into one entry.
		this._dropSupersededQuantityClaims(out);
		// Cross-entry now that every merge above has settled which entries exist.
		this._mergeSameNameEntriesAcrossSections(out);
		this._foldImprovedEntriesIntoBase(out);
		this._dropUnownedOptionClauses(out, state);
		this._applyCrossEntryQuantityUpgrades(out);
		// After the "Improved X" fold and the quantity upgrade: what is left are dependents
		// that name their anchor in prose rather than in their own name.
		this._foldNamedDependentsIntoAnchor(out);
		this._mergeAuraEntries(out, {npcName});
		this._rosterBloodCurses(out, {npcName});
		this._dropSpellOnlyFeatEntries(out);
		this._foldItemPowerTraitsOntoAttack(out);
		// After every fold: a paragraph pulled in from another entry can carry a labelled
		// sub-option in its middle, which reads as part of the sentence before it.
		this._splitAtInlineBoldLabels(out);
		this._dropScaffoldSentences(out);
		this._trimNonMechanicalSentences(out);
		this._boldInlineSubHeadings(out);
		this._splitOverlongParagraphs(out);
		// After the paragraph split: a form block's sub-features are only separable once each
		// labelled benefit is its own line.
		this._splitFormBlocksIntoAlternateForm(out);
		this._promoteReplacementAttacks(out);
		this._annotateToggledAttackRiders(out);
		this._foldSituationalAttackBonuses(out);
		this._mintCoatedWeaponAttacks(out);
		this._foldCountUpgradesIntoBase(out);
		// After the roster passes have settled the trait's final name.
		this._linkSpellModifiersFromSpellcasting(out);
		this._foldAttackActionTrailers(out);
		this._dropSupersededProcedures(out);
		this._refileByStatedEconomy(out);
		this._demoteEconomylessEntries(out);
		this._stripItemSelfEcho(out);
		this._dropInertItemEntries(out);
		this._dropDuplicateItemSpellStubs(out);
		this._dropItemSpellEntriesCoveredByRoster(out);
		this._dropItemEntriesRestatingDefenses(out);
		this._tidyEntryNames(out);
		this._fixImperativeVoice(out);
		this._collapseParallelOptionLists(out);
		this._dropFlavourLeadSentences(out);
		// After the trims above: an entry only reveals its true mechanical density once the
		// scaffolding and boilerplate sentences have gone.
		this._dropMechaniclessLoreEntries(out);
		this._resolveConditionalFeatureReferences(out, state);
		this._ensureToggleAbilityIntegrity(out, state, {npcName});
		// Runs last: toggle integrity can promote a stance to its own ability, which is
		// what makes the roster's inlined copy of it redundant.
		this._dropDuplicatedStanceBodies(out);
		// After the roster passes: a maneuver roster states its own die budget, which
		// makes a standalone pool trait for the same pool pure restatement.
		this._dropPoolTraitsRestatedElsewhere(out);
		// Second pass, deliberately late: a claim that was still in first person or still
		// carried a level preamble the first time round only reads as a standing modifier
		// once the voice and preamble passes have run.
		this._mergeResilienceTraits(out, {npcName});
		// After the resilience merge exists to receive them: a save bonus the sheet applies
		// but never names reads, on the block, as an arithmetic error.
		this._explainSaveBonusesOnResilience(out, state, {npcName});
		// After the resilience merge exists to receive the form's advantage claims.
		this._foldFormTraitOntoLines(out, {npcName});
		// Before the trait ordering and the hover pass: both key off entry names.
		this._consolidateCostedOptionMenus(out);
		this._annotateResourceCostsOnNames(out);
		this._orderTraitsForReading(out);
		// After every prose pass: tagging turns words into tags, and a pass that matches
		// on plain text would stop seeing what it needs to.
		// Late: the subject substitution that produces "(e.g. Its rapier)" and
		// "Juen May may cast" runs after the early prose compaction, so its residue is
		// only visible now.
		this._dropDanglingConnectives(out);
		this._dropRestatedSleepImmunity(out);
		this._applyResidualGrammar(out);
		this._tagBareDice(out);
		// After the dice are tagged: a ladder mixes dice that arrived tagged from source
		// data with dice this exporter tagged, and the pass needs to see them alike.
		this._collapseScalingLadders(out);
		this._resolveStatedDiceAndSpeeds(out, calculations);
		// After every trim, split and substitution: any of them can leave a line without
		// its full stop, which reads as a mid-sentence truncation.
		this._ensureTerminalPunctuation(out);
		// Absolutely last: every pass above matches entries by their plain-text name, and
		// this one rewrites names into hover tags.
		this._enrichHoverTags(out, state);

		return out;
	}

	/**
	 * "Hover when you can." A DM reading `takes the Dodge action` should be able to hover
	 * it the same way they can already hover a condition or a combat method — the corpus
	 * carried 79 `{@condition}` tags and 69 `{@combatmethod}` tags against just 9
	 * `{@action}` tags, so the capability vocabulary was the one gap left.
	 *
	 * Only names verified to exist as 5etools entities are tagged, and only the *first*
	 * mention in an entry: a paragraph with the same term hovered four times is harder to
	 * read, not easier.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character sheet state
	 */
	/**
	 * A line that stops without punctuation reads as a truncation even when nothing was
	 * lost — the row-rendering and paragraph-splitting passes both produce them. Skipped
	 * for a line that ends on a tag or a bracket, which closes itself.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _ensureTerminalPunctuation (out) {
		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(line => {
					if (typeof line !== "string") return line;
					// A resolved distance carries its own abbreviating period, so a
					// substitution at a sentence end leaves "30 ft..".
					const tidied = line.replace(/\b(ft|in|lb|sq)\.\.(?!\.)/g, "$1.");
					const trimmed = tidied.trim();
					if (!trimmed || /[.!?:;)"\]}•]$/.test(trimmed)) return tidied;
					return `${trimmed}.`;
				});
			});
		});
	}

	static _enrichHoverTags (out, state) {
		const featTags = new Map();
		(state?.getFeats?.() || []).forEach(feat => {
			const name = String(feat?.name || "").trim();
			const source = String(feat?.source || "").trim();
			if (name && source) featTags.set(name.toLowerCase(), `{@feat ${name}|${source}}`);
		});

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				// Reset per line: a roster prints one option per line, and a DM reading the
				// fourth maneuver should get the same hovers as one reading the first.
				entry.entries = entry.entries.map(it => (typeof it === "string" ? this._tagCapabilityTerms(it, new Set()) : it));

				// A trait whose whole subject is a feat should link to it. The uses suffix
				// ("(3/Long Rest)") is bookkeeping this exporter added, so it stays outside.
				const raw = String(entry.name || "");
				const [, bare, suffix = ""] = raw.match(/^(.*?)(\s*\([^)]*\))?$/) || [];
				const tag = featTags.get(String(bare || "").trim().toLowerCase());
				if (tag) entry.name = `${tag}${suffix}`;

				// Truly last, and deliberately after every other tag pass: a tag of the
				// wrong kind renders as a failed lookup. Demoting one to plain text mid
				// pipeline would hide the entry from passes that match on tags, so the
				// correction only ever runs once the statblock is otherwise final.
				entry.entries = entry.entries.map(it => (typeof it === "string" ? this._sanitizeTagKinds(it) : it));
				if (entry.name) entry.name = this._sanitizeTagKinds(entry.name);
			});
		});
	}

	/**
	 * Substitutes the verified action / rules-glossary vocabulary, skipping any span that
	 * is already inside a tag — a nested `{@action}` inside a `{@item}` display string
	 * would corrupt both.
	 *
	 * @param {string} text entry text
	 * @param {Set<string>} seen terms already hovered in this entry
	 * @returns {string} text with capability terms tagged
	 */
	static _tagCapabilityTerms (text, seen) {
		const str = String(text || "");
		if (!str) return str;

		// Mask existing tags, brace-depth aware so nested tags survive intact.
		const {plain: initial, masked} = this._maskTaggedSpans(str);
		let plain = initial;

		const once = (pattern, build) => {
			plain = plain.replace(pattern, (m, ...rest) => {
				const key = String(m).toLowerCase();
				if (seen.has(key)) return m;
				const out = build(m, ...rest);
				if (out === m) return m;
				seen.add(key);
				// Mask the tag we just wrote, or a later, shorter vocabulary entry will
				// match the term inside it and nest a tag within a tag.
				return `\uE001${masked.push(out) - 1}\uE001`;
			});
		};

		// Item and homebrew text writes these terms in lower case, so match case-free and
		// keep whatever casing the sentence used as the tag's display text.
		const glossary = (pattern, canonical, tag) => once(pattern, (m) => (m === canonical ? `{@${tag} ${canonical}|XPHB}` : `{@${tag} ${canonical}|XPHB|${m}}`));

		const ACTIONS = "Attack|Dash|Disengage|Dodge|Help|Hide|Influence|Magic|Ready|Search|Study|Utilize";
		once(new RegExp(String.raw`\b(${ACTIONS})\b(?=\s+action\b)`, "g"), (m, word) => `{@action ${word}|XPHB}`);
		// A coordinated list of action names is unambiguous even without the noun
		// ("take a Bonus Action to Dash, Disengage, or Hide"), which is how Cunning Action
		// and its relatives are written. Two or more items is the signal — a lone "Hide"
		// or "Attack" in prose is too often the ordinary English word.
		const ACTION_RUN = new RegExp(String.raw`\b(?:${ACTIONS})\b(?:(?:,\s*|\s+)(?:(?:or|and)\s+)?(?:the\s+)?(?:${ACTIONS})\b)+`, "g");
		plain = plain.replace(ACTION_RUN, run => run.replace(new RegExp(String.raw`\b(${ACTIONS})\b`, "g"),
			word => `\uE001${masked.push(`{@action ${word}|XPHB}`) - 1}\uE001`));
		// `surprised` and `concentration` read like conditions but 5etools files them as
		// statuses; the hover only resolves under `{@status}`.
		plain = plain.replace(/\b(surprised|concentration)\b/g, (m, word) => `\uE001${masked.push(`{@status ${word}}`) - 1}\uE001`);

		// Mastery property names are all ordinary English words — "push", "slow", "sap" —
		// so they are only ever tagged when the sentence names them *as* properties. That
		// keeps Tactical Master's "the Push, Sap, or Slow property" hoverable without
		// turning every "push the target" into a broken link.
		const MASTERIES = this._MASTERY_PROPERTY_NAMES.join("|");
		const MASTERY_RUN = new RegExp(
			String.raw`\b(?:${MASTERIES})\b(?:(?:,\s*|\s+)(?:(?:or|and)\s+)?(?:${MASTERIES})\b)*(?=\s+(?:mastery|propert(?:y|ies)))`,
			"g",
		);
		plain = plain.replace(MASTERY_RUN, run => run.replace(new RegExp(String.raw`\b(${MASTERIES})\b`, "g"),
			word => `\uE001${masked.push(`{@itemMastery ${word}|XPHB}`) - 1}\uE001`));
		glossary(/\bopportunity attacks\b/gi, "Opportunity Attack", "action");
		glossary(/\bopportunity attack\b/gi, "Opportunity Attack", "action");
		glossary(/\bunarmed strikes\b/gi, "Unarmed Strike", "variantrule");
		glossary(/\bunarmed strike\b/gi, "Unarmed Strike", "variantrule");
		glossary(/\bdifficult terrain\b/gi, "Difficult Terrain", "variantrule");

		// A DC is a number the DM reads off the block constantly, and `{@dc}` renders it
		// in the house style. Every occurrence is tagged, not just the first: two
		// different DCs in one entry are two different numbers to look up.
		plain = plain.replace(/\bDC (\d{1,2})\b(?!\s*\})/g, (m, num) => `\uE001${masked.push(`{@dc ${num}}`) - 1}\uE001`);

		return this._unmaskTaggedSpans(plain, masked);
	}

	/**
	 * Hides every `{@tag …}` span behind a placeholder so a text pass can match on prose
	 * without ever matching inside a tag. Brace-depth aware, so a nested tag (an
	 * `{@action}` inside an `{@item}` display string) is masked as one unit rather than
	 * being cut in half.
	 *
	 * The returned `masked` array is live: a caller may push a freshly-built tag onto it
	 * and emit the matching placeholder to protect that tag from its own later passes.
	 *
	 * @param {string} str text to mask
	 * @returns {{plain: string, masked: string[]}} placeholder text and the spans it hides
	 */
	static _maskTaggedSpans (str) {
		const masked = [];
		let plain = "";
		for (let i = 0; i < str.length; ++i) {
			if (str[i] !== "{" || str[i + 1] !== "@") {
				plain += str[i];
				continue;
			}
			let depth = 0;
			let j = i;
			for (; j < str.length; ++j) {
				if (str[j] === "{") depth++;
				else if (str[j] === "}" && --depth === 0) break;
			}
			plain += `\uE001${masked.push(str.slice(i, j + 1)) - 1}\uE001`;
			i = j;
		}
		return {plain, masked};
	}

	/**
	 * Puts back every span `_maskTaggedSpans` hid.
	 *
	 * @param {string} plain placeholder text
	 * @param {string[]} masked spans to restore
	 * @returns {string} text with tags restored
	 */
	static _unmaskTaggedSpans (plain, masked) {
		return plain.replace(/\uE001(\d+)\uE001/g, (_m, idx) => masked[Number(idx)]);
	}

	/**
	 * Dice written as plain prose are inert: `deal an extra 10d6 damage` is something the
	 * DM has to go and roll by hand, while `{@damage 10d6}` is one click. The corpus
	 * carried 57 untagged dice across 18 of 21 characters, which made this the single
	 * biggest "easier to run at the table" gap left in the export.
	 *
	 * Two dice are deliberately left alone:
	 *
	 * - `d20` never means "roll this for an effect" — it names the D20 Test itself
	 *   ("rolls a 20 on the d20", "reroll the d20"), so a roll link there is noise.
	 * - a die-size change ("the d6 becomes a d8") describes scaling. Hovering both sides
	 *   asks the DM which one to roll when the sentence has already told them.
	 *
	 * `{@damage}` vs `{@dice}` follows the bestiary's own convention: damage rolls are
	 * `{@damage}`, everything else — healing, temp HP, resource regain, reductions,
	 * durations — is `{@dice}`.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _tagBareDice (out) {
		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(it => (typeof it === "string" ? this._tagBareDiceInText(it) : it));
			});
		});
	}

	/**
	 * @param {string} text entry text
	 * @returns {string} text with bare dice wrapped in `{@damage}` / `{@dice}`
	 */
	static _tagBareDiceInText (text) {
		const str = String(text || "");
		if (!/\d*d\d/.test(str)) return str;

		const {plain, masked} = this._maskTaggedSpans(str);

		// `+ 1` is part of the roll, but `+ 1d6` starts a second die that must stay out of
		// this one's tag.
		const DIE = /\b(\d*)d(\d+)\b(\s*[+-]\s*\d+(?!\s*d\d))?/g;

		const tagged = plain.replace(DIE, (m, count, faces, mod, offset, whole) => {
			if (faces === "20") return m;

			const before = whole.slice(Math.max(0, offset - 70), offset);
			// Wide enough to reach a trailing "reducing the damage by the total" — the
			// checks that read this window are each bounded on their own.
			const after = whole.slice(offset + m.length, offset + m.length + 90);

			const body = `${count}d${faces}${mod ? mod.replace(/\s*([+-])\s*/, " $1 ") : ""}`;
			return `\uE001${masked.push(`{@${this._getBareDiceTagName(before, after)} ${body}}`) - 1}\uE001`;
		});

		return this._unmaskTaggedSpans(tagged, masked);
	}

	/**
	 * Decides whether a die rolls damage or something else.
	 *
	 * What follows the die is the strongest signal — a unit noun ("rounds", "Hit Points")
	 * settles it outright, and a nearby "damage" makes it a damage roll. Only when the
	 * trailing text says nothing does the preceding clause get a vote, and even then a
	 * reduction ("roll a d12 … reducing the damage") names damage while rolling something
	 * that is emphatically not damage, so those verbs veto it.
	 *
	 * @param {string} before up to 70 characters preceding the die
	 * @param {string} after up to 45 characters following the die
	 * @returns {string} `"damage"` or `"dice"`
	 */
	static _getBareDiceTagName (before, after) {
		if (/^\s*(?:\+\s*\d+\s*)?(?:rounds?|minutes?|hours?|days?|feet|foot|ft\.)\b/i.test(after)) return "dice";
		if (/^\s*(?:\+\s*\d+\s*)?(?:[Hh]it\s+[Pp]oints|[A-Z][a-z]+\s+Points)\b/.test(after)) return "dice";
		// "an extra 1d8 Cold, Fire, Lightning, or Thunder damage" puts a long type list
		// between the die and the word that classifies it.
		if (/^\s*(?:[^.;]{0,40}?\b)?damage\b/i.test(after)) return "damage";
		// A reduction names damage while rolling something that is emphatically not damage
		// ("roll a d12 … reducing the damage by the total"), so it vetoes the vote below.
		// Only this sentence counts: "…hemocraft die (1d8). This damage can't be reduced"
		// is a damage die whose *next* sentence happens to say "reduced".
		const clause = before + String(after).split(/[.;]/)[0];
		if (/\breduc(?:e|es|ed|tion|ing)\b|\bsubtracts?\b|\bregains?\b|\btemporary hit points\b/i.test(clause)) return "dice";
		if (/\bdamage\b/i.test(before)) return "damage";
		return "dice";
	}

	/**
	 * The TGTT metamagic system draws a distinction the corpus loses entirely: an
	 * option is either **Active** (pay on casting, one per spell) or **Passive**
	 * (tuned with an action, then it modifies *every* spell cast afterwards while
	 * holding its cost out of the maximum Sorcery Point pool). Six loose traits with
	 * detached "Cost:" lines tell a DM none of that. Replace them with one roster
	 * grouped by what is on right now, each line a hoverable name plus a single
	 * short parenthetical: cost — which spells it touches: what it does.
	 */
	static _consolidateMetamagicEntries (out, state, {npcName = "The NPC"} = {}) {
		const options = (state.getFeatures?.() || [])
			.filter(feature => (feature?.optionalFeatureTypes || []).map(it => String(it).toUpperCase()).includes("MM"));
		if (options.length < 2) return;

		const tuned = new Set(
			(state._data?.tunedMetamagics || [])
				.map(it => this._normalizeFeatureKey(typeof it === "string" ? it : it?.name))
				.filter(Boolean),
		);

		const byKey = new Map();
		options.forEach(feature => {
			const key = this._normalizeFeatureKey(feature?.name);
			if (key) byKey.set(key, feature);
		});

		// Pull the exported entries so their (already number-resolved) prose is what the
		// roster summarises, and so nothing is left behind restating the same option.
		const bodies = new Map();
		let removed = 0;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const bare = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "");
				const key = this._normalizeFeatureKey(String(entry?.name || ""));
				const bareKey = this._normalizeFeatureKey(bare);
				const hit = byKey.has(key) ? key : (byKey.has(bareKey) ? bareKey : null);
				if (!hit) return true;
				bodies.set(hit, (entry.entries || []).filter(it => typeof it === "string").join(" "));
				removed++;
				return false;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
		if (!removed) return;

		const groups = {tuned: [], passive: [], active: []};
		[...byKey.entries()]
			.sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)))
			.forEach(([key, feature]) => {
				const name = String(feature.name || "");
				const isPassive = /\bpassive\b/i.test(name) || /\bpassive\b/i.test(bodies.get(key) || "");
				const line = this._getMetamagicRosterLine(feature, bodies.get(key) || "", npcName);
				if (!line) return;
				if (isPassive) (tuned.has(key) ? groups.tuned : groups.passive).push(line);
				else groups.active.push(line);
			});
		if (!groups.tuned.length && !groups.passive.length && !groups.active.length) return;

		// The guidance trait only restates the rules the lead now states in one line.
		out.trait = (out.trait || []).filter(entry => this._normalizeFeatureKey(entry?.name) !== "metamagic");

		const entries = [
			`A Passive option is tuned with an action and then applies to every spell ${npcName} casts until cancelled, with its cost held out of ${npcName}'s maximum Sorcery Points. Only one Active option can be used on a given spell.`,
		];
		if (groups.tuned.length) entries.push(`{@b Tuned (on now):} ${groups.tuned.join("; ")}.`);
		if (groups.passive.length) entries.push(`{@b Passive (not tuned):} ${groups.passive.join("; ")}.`);
		if (groups.active.length) entries.push(`{@b Active:} ${groups.active.join("; ")}.`);

		out.trait.push({name: "Metamagic", entries});
	}

	/**
	 * One roster line: the hoverable option name and a parenthetical no longer than a
	 * clause. Anything the option's own page already says stays on that page.
	 * @returns {string}
	 */
	static _getMetamagicRosterLine (feature, body, npcName) {
		let tag = this._getFeatureHoverTag(feature) || String(feature?.name || "");
		if (!tag) return "";
		// The group heading already says Passive or Active, so the suffix is noise in the
		// link text — keep it in the lookup, display the bare option name.
		tag = tag.replace(/^\{@optfeature ([^|}]+?)\s*\((Passive|Active)\)\|([^|}]+)\}$/i, "{@optfeature $1 ($2)|$3|$1}");

		// The exported entry is preferred (its numbers are already resolved), but an option
		// that never earned an entry still has its own description to summarise.
		const raw = String(body || "").trim() || this._getPlainMatchTextCased(feature?.description || "");
		const text = String(raw).replace(/\s+/g, " ").trim();
		if (!text) return tag;

		// Read the option's own "Cost:" line rather than the first number in the body —
		// Twinned Spell's body ends "(1 sorcery point if the spell is a cantrip)", which
		// is the exception, not the cost.
		const costLine = (/cost:\s*([^.(]+?)\s*(?:\(|\.|$)/i.exec(text) || [])[1];
		const costAmount = (/^(\d+|x)\b/i.exec(costLine || "") || [])[1]
			|| (/(\d+)\s*sorcery point/i.exec(text) || [])[1]
			|| "";
		const costLabel = !costAmount
			? ""
			: (/^x$/i.test(costAmount) && /where x is the spell'?s level/i.test(text) ? "spell level SP" : `${costAmount} SP`);

		const escaped = String(npcName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const tidy = str => String(str || "")
			.replace(/\bto resist its effects\b/gi, "")
			// Resolved numbers must survive the aside-stripping below, so lift them out of
			// their parentheses first: "the damage dice up to its Charisma modifier (5)"
			// carries the number a DM needs, unlike a rules aside.
			.replace(/\b([a-z]+) (?:a number of |some of )?(?:the )?([a-z]+(?: [a-z]+)?) up to (?:its|his|her|their) [A-Za-z]+ modifier \(\+?(\d+)[^)]*\)/gi, "$1 up to $3 $2")
			.replace(/(?:its|his|her|their) [A-Za-z]+ modifier \(\+?(\d+)[^)]*\)/gi, "$1")
			// A roster line is a reminder, not a rules quotation: nested asides break the
			// outer parenthetical, and "saving throw" reads as a save this NPC forces.
			.replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, "")
			.replace(/\bsaving throws?\b/gi, "save")
			.replace(/\bforces? (?:other )?(?:creatures?|targets?) to make an? /gi, "forces a ")
			.replace(/\bthose creatures\b/gi, "the targets")
			.replace(new RegExp(String.raw`\b(?:${escaped}|you|your)\b`, "gi"), m => (/^your$/i.test(m) ? "its" : "it"))
			.replace(/\s*,\s*$/, "")
			.replace(/\s{2,}/g, " ")
			.trim();

		// "When <name> casts a spell that <condition>, it can <effect>" is the shape every
		// option in the corpus uses; it maps exactly onto "which spells: what it does".
		const shaped = new RegExp(String.raw`when (?:${escaped}|it|you) (casts?|rolls? damage for|rolls?) an? spell(?: that ([^,]+?))?, (?:it|you) can (.+)`, "i").exec(text);
		let affected = "";
		let effect = "";
		if (shaped) {
			// Kept singular ("a spell that forces…") so the condition's own verb agreement,
			// which the source text already got right, survives the extraction.
			affected = shaped[2] ? `a spell that ${shaped[2]}` : (/rolls? damage/i.test(shaped[1]) ? "a spell that rolls damage" : "any spell");
			effect = shaped[3];
		} else {
			effect = text.replace(/^cost:[^.]*\.?\s*/i, "");
		}

		// "Choose up to N creatures" and "A chosen creature automatically succeeds" are one
		// mechanic split over two sentences; a roster line has room for the fused form only.
		const chosenCount = /\bchoose (?:a number of )?(?:those )?([a-z]+) up to [^.]*?\(\+?(\d+)/i.exec(text);
		const chosenEffect = /\bA chosen (?:creature|target) ([^.]+)\./i.exec(text);
		if (chosenCount && chosenEffect) {
			effect = `up to ${chosenCount[2]} chosen ${chosenCount[1]} ${chosenEffect[1]
				.replace(/\b(succeeds|takes|has|gains|makes)\b/i, m => m.slice(0, -1))
				.replace(/\bits (saving throws?|save)\b/gi, "the $1")}`;
		}

		effect = tidy(effect
			.replace(/^spend (?:\d+|a number of) sorcery points?[^.]{0,60}\s(?:to|and) /i, "")
			.replace(/\bit can spend \d+ sorcery points? to /gi, ""));
		// One clause is the budget. A whole first sentence is better than a word-boundary
		// cut, so take it when it fits.
		const firstSentence = (/^(.+?[.!?])(?:\s|$)/.exec(effect) || [])[1];
		if (firstSentence && firstSentence.length <= 110) effect = firstSentence;
		effect = this._truncateAtSentenceOrWord(effect, 95);
		affected = this._getMetamagicAffectedLabel(tidy(affected));

		const note = [costLabel, [affected, effect].filter(Boolean).join(": ")].filter(Boolean).join(" — ");
		return note ? `${tag} (${note})` : tag;
	}

	/**
	 * "Which spells does this touch?" is a category, not a clause. Truncating the
	 * source condition mid-phrase ("a spell that deals a type of damage from the")
	 * loses the category entirely, so name it instead.
	 */
	static _getMetamagicAffectedLabel (condition) {
		const text = String(condition || "").trim();
		if (!text) return "";
		const LABELS = [
			[/\bcasting time of 1 action\b/i, "1-action spells"],
			[/\btargets only one creature\b/i, "single-target spells"],
			[/\bforces? a(?:n)? [A-Za-z]* ?save\b|\bmake an? [A-Za-z]* ?save\b/i, "spells forcing a save"],
			[/\brolls? damage\b|\bdamage dice\b/i, "damage spells"],
			[/\bdeals? a type of damage\b|\bdamage type\b/i, "damage spells"],
			[/\bsomatic or verbal\b/i, "any spell"],
			[/\brange of self\b/i, "single-target spells"],
		];
		const hit = LABELS.find(([re]) => re.test(text));
		if (hit) return hit[1];
		return this._truncateAtSentenceOrWord(text, 52);
	}

	/**
	 * Cut to the last sentence or word boundary that fits, so a condensed note never
	 * ends mid-word or mid-sentence.
	 */
	static _truncateAtSentenceOrWord (text, maxLen) {
		let s = String(text || "").trim().replace(/[.;,]+$/, "");
		if (s.length <= maxLen) return s;
		s = s.slice(0, maxLen);
		const cut = Math.max(s.lastIndexOf(". "), s.lastIndexOf(" "));
		return (cut > 0 ? s.slice(0, cut) : s).replace(/[.;,]+$/, "").trim();
	}

	/**
	 * A menu subsystem — Cunning Strike, Devious Strikes — stores each option as its own
	 * feature, so the block scattered six entries named "Poison (Cost: 1d6)" across two
	 * sections while the feature that explains them named none of them. A DM reading
	 * "Cunning Strike" learned the rule and had to hunt the page for the options.
	 *
	 * Give the subsystem one home: the explaining entry keeps its rule and gains the
	 * roster, each option costed on its own label. The umbrella entry that exists only to
	 * say "the following effects are now among its options" has nothing left to say once
	 * the options are listed under the rule, so it goes.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _consolidateCostedOptionMenus (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];
		const COSTED = /^(.+?)\s*\(Cost:\s*([^)]+)\)\s*$/i;

		const options = [];
		SECTIONS.forEach(section => {
			(out[section] || []).forEach(entry => {
				const m = COSTED.exec(String(entry?.name || ""));
				if (m) options.push({section, entry, label: m[1].trim(), cost: m[2].trim()});
			});
		});
		if (options.length < 2) return;

		const parent = SECTIONS
			.flatMap(section => out[section] || [])
			.find(entry => !COSTED.test(String(entry?.name || ""))
				&& /\bdie cost\b/i.test((entry?.entries || []).filter(it => typeof it === "string").join(" ")));
		if (!parent) return;

		const dropped = new Set(options.map(it => it.entry));
		options.forEach(({entry, label, cost}) => {
			const body = this._getFirstSentences((entry.entries || []).filter(it => typeof it === "string").join(" "), 2);
			if (!body) return;
			parent.entries.push(`{@b ${label} (${cost}).} ${body}`);
		});

		// "The following effects are now among its Cunning Strike options" is a pointer to
		// a list that now sits directly under the rule.
		SECTIONS.forEach(section => {
			(out[section] || []).forEach(entry => {
				const body = (entry?.entries || []).filter(it => typeof it === "string").join(" ");
				if (entry !== parent && /\b(?:are|is) now among its\b[^.]*\boptions\b/i.test(body) && body.length < 220) dropped.add(entry);
			});
			out[section] = (out[section] || []).filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * @param {string} text
	 * @param {number} count
	 * @returns {string} the first `count` sentences of `text`
	 */
	static _getFirstSentences (text, count = 1) {
		const parts = this._splitIntoClauses(String(text || ""));
		return parts.slice(0, Math.max(1, count)).join(" ").trim();
	}

	/**
	 * A DM scanning a statblock reads names first. "Instant Step" costing 4 Stamina is
	 * buried three clauses into its own prose, so the cost only surfaces once the
	 * ability has already been chosen. Lift a single, unconditional resource cost onto
	 * the name — the same treatment limited uses already get.
	 */
	static _annotateResourceCostsOnNames (out) {
		const RESOURCES = [
			[/focus points?/i, "Focus"],
			[/ki points?/i, "Ki"],
			[/sorcery points?/i, "SP"],
			[/stamina points?/i, "Stamina"],
			[/superiority dice|superiority die/i, "Superiority Die"],
			[/rage uses?|uses? of rage/i, "Rage"],
		];

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const name = String(entry?.name || "");
				if (!name || /\)\s*$/.test(name)) return;
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				if (!body) return;

				// An entry built around an attack is free to use; any cost inside it buys an
				// upgrade (Radiant Sun Bolt's second shot), not the attack.
				if (/\{@atk\b/.test(body)) return;

				// Strain is *gained*, not spent, so the generic matcher never saw it and a
				// psionic power's price stayed buried mid-paragraph.
				const strain = [...body.matchAll(/\bgains?\s+(\d+)\s+strain\b/gi)];
				if (strain.length === 1) {
					entry.name = `${name} (${strain[0][1]} Strain)`;
					return;
				}

				const hits = [...body.matchAll(/\b(?:spends?|expends?)\s+(\d+)\s+([a-z]+(?:\s+(?:points?|dice|die))?)/gi)];
				if (hits.length !== 1) return;
				// "Alternatively, it can expend 1 Focus Point to…" describes an upgrade to a
				// free ability; charging for the whole entry would misprice it.
				const lead = body.slice(0, hits[0].index);
				if (/\b(?:alternatively|instead|in addition|optionally)\b[^.]*$/i.test(lead)) return;

				// The cost prices the whole ability only when it is stated up front, or in
				// the sentence that first declares the ability's action economy. Anywhere
				// later it is buying an extra — Deflect Attacks' redirect, Religious
				// Training's divination — and the ability itself is free.
				const sentences = this._splitIntoClauses(body);
				const costIdx = sentences.findIndex(it => /\b(?:spends?|expends?)\s+\d+\s/i.test(it));
				const ECONOMY = /\bas an? (?:action|bonus action|reaction)\b|\btakes? an? (?:Reaction|Bonus Action)\b/i;
				const economyIdx = sentences.findIndex(it => ECONOMY.test(it));
				if (costIdx > 0 && costIdx !== economyIdx) return;

				const label = (RESOURCES.find(([re]) => re.test(hits[0][2])) || [])[1];
				if (!label) return;
				entry.name = `${name} (${hits[0][1]} ${label})`;
			});
		});
	}

	/**
	 * Some sources mark a sub-benefit with a bare Title-Case sentence rather than a
	 * heading tag or a colon — "…to a distance of 120 feet. Wisdom of the Spirit. It has
	 * advantage on…". The label then reads as part of the previous sentence, and when
	 * compaction lands a paragraph break on it the label is stranded one paragraph away
	 * from the body it introduces.
	 *
	 * Bold it and weld it to that body. The detection is deliberately narrow: a candidate
	 * must be a short all-capitalised phrase, and the entry must already show the shape
	 * elsewhere (a second candidate, or a bold label the source did tag) before any
	 * rewrite happens — a lone capitalised fragment is far more likely to be prose.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _boldInlineSubHeadings (out) {
		const FUNCTION_WORDS = "of|the|a|an|and|or|in|with|from|on|for";
		const RE = new RegExp(`(^|(?<=[.!?]\\s))([A-Z][\\w'\u2019-]*(?:\\s+(?:${FUNCTION_WORDS}|[A-Z][\\w'\u2019-]*))*\\s+[A-Z][\\w'\u2019-]*)\\.(?=\\s|$)`, "g");
		const isCandidate = phrase => {
			const words = phrase.trim().split(/\s+/);
			return words.length >= 2 && words.length <= 5 && phrase.length <= 40;
		};
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const strings = entry.entries.filter(it => typeof it === "string");
				if (!strings.length) return;
				let count = 0;
				strings.forEach(line => {
					line.replace(RE, (m, _lead, phrase) => {
						if (isCandidate(phrase)) count++;
						return m;
					});
				});
				if (!count) return;
				if (count < 2 && !strings.some(line => line.includes("{@b "))) return;

				entry.entries = entry.entries.map(line => (typeof line !== "string"
					? line
					: line.replace(RE, (m, lead, phrase) => (isCandidate(phrase) ? `${lead}{@b ${phrase}.}` : m))));

				// A label that ends its paragraph belongs to the paragraph after it.
				for (let i = 0; i < entry.entries.length - 1; ++i) {
					const cur = entry.entries[i];
					const next = entry.entries[i + 1];
					if (typeof cur !== "string" || typeof next !== "string") continue;
					const trailing = /\s(\{@b [^{}]+\})$/.exec(cur.trimEnd());
					if (!trailing) continue;
					entry.entries[i] = cur.trimEnd().slice(0, -trailing[1].length).trim();
					entry.entries[i + 1] = `${trailing[1]} ${next.trim()}`;
				}
				entry.entries = entry.entries.filter(line => typeof line !== "string" || line.trim());
			});
		});
	}

	/**
	 * One 900-character paragraph is a wall a DM has to re-read mid-fight. Splitting it at
	 * a sentence boundary costs nothing and gives the eye somewhere to land; the entry
	 * still reads in order because the renderer prints each string as its own paragraph.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _splitOverlongParagraphs (out) {
		const BUDGET = 620;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.flatMap(line => {
					if (typeof line !== "string" || line.length <= BUDGET) return [line];
					const sentences = line.split(/(?<=[.!?])\s+/);
					// Lists and rosters are one unit; splitting them scatters the options. A
					// roster is semicolon-dense *and* sentence-poor — long prose that happens
					// to use semicolons is still prose.
					if (/^\u2022/.test(line.trim()) || /\{@optfeature|\{@combatmethod/.test(line)) return [line];
					if ((line.match(/;/g) || []).length >= 2 && sentences.length < 4) return [line];
					if (sentences.length < 2) return [line];
					const half = line.length / 2;
					let best = 0;
					let run = 0;
					sentences.forEach((sentence, ix) => {
						run += sentence.length + 1;
						if (ix === sentences.length - 1) return;
						if (Math.abs(run - half) < Math.abs(best - half) || !best) best = run;
					});
					let acc = 0;
					const first = [];
					const rest = [];
					sentences.forEach(sentence => {
						(acc < best ? first : rest).push(sentence);
						acc += sentence.length + 1;
					});
					if (!first.length || !rest.length) return [line];
					return [first.join(" ").trim(), rest.join(" ").trim()];
				});
			});
		});
	}

	/**
	 * Sentences that exist to organise a rulebook rather than to run a creature: a
	 * promise of what a higher level will grant, a pointer to text printed elsewhere,
	 * and the "choose one of the following" framing around a menu the block already
	 * lists. A statblock is a snapshot at one level with everything on the page.
	 *
	 * Deliberately blind to anything carrying a rolled value, so a sentence that
	 * happens to mention a level but also states a mechanic survives.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropScaffoldSentences (out) {
		const SCAFFOLD = [
			/\b(?:gains?|regains?|learns?|earns?)\b[^.]*\bwhen (?:it|you|they) reach(?:es)?[^.]*\blevel \d+/i,
			/\bwhich (?:is|are) described (?:below|above)\b/i,
			/\b(?:other|additional) [A-Za-z' ]{3,40} features give (?:it |you )?(?:additional|more|other)\b/i,
			/\beach time (?:it|you) uses? this (?:class's|class\u2019s|feature)[^.]*\bchoos/i,
			/\bis described in (?:the|this) [A-Za-z' ]{3,40}\b/i,
			// The chosen ability is already visible in the saving throw line.
			/\bproficiency in saving throws using the chosen ability\b/i,
		];
		const KEEPS_MECHANIC = /\{@(?:dc|damage|dice|hit|atk|recharge|scaledamage)\b/;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]) return;
			out[section].forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const next = entry.entries.map(line => {
					if (typeof line !== "string") return line;
					if (/^\u2022/.test(line.trim())) return line;
					const kept = line
						.split(/(?<=[.!?])\s+/)
						.filter(sentence => KEEPS_MECHANIC.test(sentence) || !SCAFFOLD.some(re => re.test(sentence)));
					return kept.join(" ").replace(/\s+/g, " ").trim();
				}).filter(it => (typeof it === "string" ? it.length : true));
				if (next.filter(it => typeof it === "string").join(" ").trim().length) entry.entries = next;
			});
			// A promise with nothing left to promise ("It gains the following benefits:")
			// is noise; the benefit it introduced is now stated elsewhere on the block.
			out[section] = out[section].filter(entry => {
				const strings = (entry?.entries || []).filter(it => typeof it === "string");
				if (!strings.length) return true;
				return !strings.every(line => /:$/.test(line.trim()) && !this._hasMechanicalToken(line));
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * A trim that leaves "To do so, it uses a bonus action…" first has cut the sentence
	 * that "so" refers to, and the reader has to guess what the character is doing. The
	 * antecedent earns its place back.
	 *
	 * @param {Array<string>} clauses every sentence before the trim, in order
	 * @param {Array<string>} kept surviving sentences (mutated in place)
	 */
	static _restoreBackReferenceLead (clauses, kept) {
		const BACK_REFERENCE = /^(?:to do so|doing so|in doing so|if it does|when it does|it does so)\b/i;
		if (!kept.length || !BACK_REFERENCE.test(kept[0].trim())) return;
		const ix = clauses.findIndex(clause => clause === kept[0]);
		if (ix <= 0) return;
		kept.unshift(clauses[ix - 1]);
	}

	/**
	 * Long entries earn their length only if every sentence carries a mechanic. The
	 * summoned-aspect chains are the worst offenders — "It determines the arms'
	 * appearance", "covers its physical form like a suit of armor" — descriptive
	 * sentences a DM has to read past to reach the numbers. Short entries keep their
	 * voice; only bloated ones get pruned.
	 */
	static _trimNonMechanicalSentences (out) {
		const BUDGET = 380;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const strings = entry.entries.filter(it => typeof it === "string");
				if (strings.join(" ").length < BUDGET) return;

				// The opening sentence usually states the trigger and economy, so it is only
				// expendable when a later sentence does that job instead.
				// "it can use its reaction to …" states the economy just as plainly as "as a
				// reaction"; without it Battlemind's whole trigger sentence was judged lead flavour.
				const ECONOMY = /\b(?:as an? (?:bonus )?action|as a reaction|no action required|magic action|it can spend|uses? (?:its |a |an )?(?:reaction|bonus action|action)|when it (?:hits|takes|makes))\b/i;
				const rest = strings.join(" ").slice(strings[0]?.split(/(?<=\.)\s/)[0]?.length || 0);
				const leadExpendable = ECONOMY.test(rest);

				let index = 0;
				const next = entry.entries.map(line => {
					if (typeof line !== "string") return line;
					// A roster line is a semicolon-separated list, not prose; splitting it into
					// "sentences" and judging each one drops entries off the end of the list.
					if (/\{@optfeature|\{@combatmethod/.test(line) || (line.match(/;/g) || []).length >= 2) return line;
					const clauses = this._splitIntoClauses(line);
					const kept = this._dropClauseContinuations(clauses, sentence => {
						const isLead = index++ === 0;
						// A modal makes a flavour lead ("Tikal can summon the visage of its astral
						// self") look mechanical, so the lead is judged on hard evidence only.
						if (isLead && leadExpendable && !/\{@|\d/.test(sentence) && !ECONOMY.test(sentence)) return false;
						return !this._isPureFlavourSentence(sentence);
					});
					this._restoreBackReferenceLead(clauses, kept);
					return kept
						.join(" ")
						// "While the spectral arms are present, it gains the following benefits:"
						// is four words of scaffolding around one word of meaning.
						.replace(/\bwhile (?:the |its |his |her |their )?[^,.]{0,60}? (?:is|are) present, [^,.]{0,40}? gains the following benefits[.:]?/gi, "{@b While active:}")
						// The appearance clause is decoration welded onto a real exit condition.
						.replace(/\b(?:it|[A-Z][\w'’]*) determines (?:the|its|their)[^.,]{0,40}appearance,? and (?:they|it) /gi, "They ")
						.replace(/\b(?:it|[A-Z][\w'’]*) determines (?:the|its|their)[^.,]{0,40}appearance\.\s*/gi, "")
						.replace(/\s{2,}/g, " ")
						.trim();
				}).filter(it => (typeof it === "string" ? it.length : true));

				if (next.filter(it => typeof it === "string").join(" ").trim().length) entry.entries = next;
			});
		});
	}

	/**
	 * Clause splitting cuts at semicolons, so removing one half of "The DM chooses the
	 * nature; the effect of any cleric spell would be appropriate" strands a lowercase
	 * fragment as its own sentence. A continuation goes wherever its head went.
	 * @returns {Array<string>}
	 */
	static _dropClauseContinuations (clauses, keep) {
		const out = [];
		let droppedPrev = false;
		clauses.forEach(clause => {
			const isContinuation = /^[a-z]/.test(this._getPlainMatchTextCased(clause).trim());
			if (droppedPrev && isContinuation) return;
			if (!keep(clause)) { droppedPrev = true; return; }
			droppedPrev = false;
			out.push(clause);
		});
		return out;
	}

	/**
	 * An entry's own text names the action economy it uses; the section it was filed into
	 * is an inference made earlier from weaker evidence. When they disagree, believe the
	 * text — a DM reading "As a Magic action" under Bonus Actions is being misled.
	 */
	static _refileByStatedEconomy (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const moves = [];
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const body = (entry.entries || []).filter(it => typeof it === "string");
				if (!body.length) return;
				const sentence = this._getPlainMatchTextCased(this._splitIntoClauses(body[0])[0] || "");
				// "When it uses its action to Dash, it can use a bonus action to…" names two
				// economies: the trigger and the cost. Only the cost decides where the entry
				// lives, so a leading subordinate clause is dropped before matching.
				const lead = sentence.replace(/^\s*(?:when|whenever|if|after|while|once)\b[^,]{0,120},\s*/i, "");
				const kinds = new Set();
				if (/\(no action required\)/i.test(lead)) kinds.add("trait");
				if (/\bas a bonus action\b|\bas part of the bonus action\b|\b(?:use[sd]?|takes?) a bonus action\b/i.test(lead)) kinds.add("bonus");
				if (/\bas a reaction\b|\buse[sd]? its reaction\b/i.test(lead)) kinds.add("reaction");
				if (/\bas an? (?!bonus\b)[a-z]* ?action\b|\buse[sd]? (?:its|an) action\b|\btakes? an? (?!bonus\b)(?:[a-z]+ )?action\b/i.test(lead)) kinds.add("action");
				// Two economies in one lead is an ambiguity, not a correction.
				if (kinds.size !== 1) return;
				const [stated] = [...kinds];
				if (stated === section) return;
				moves.push({entry, from: section, to: stated});
			});
		});
		if (!moves.length) return;

		moves.forEach(({entry, from, to}) => {
			out[from] = (out[from] || []).filter(it => it !== entry);
			(out[to] = out[to] || []).push(entry);
		});
		sections.forEach(section => {
			if (out[section] && !out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * An item entry titled "Moonlit Aegis" that opens "{@item Moonlit Aegis|…}: This
	 * magic shield glows softly under moonlight." spends its first line saying its own
	 * name and then describing how it looks. The name is already the entry heading and
	 * the appearance is not a rule; the DM wants the sentence after that.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _stripItemSelfEcho (out) {
		// Appearance-only openers. Kept deliberately narrow: a sentence that also states
		// a condition ("While attuned…") is doing work and stays.
		const APPEARANCE = /^This (?:magic |magical )?[a-z ]{2,30} (?:glows|shimmers|gleams|is carved|appears|looks|feels)\b[^.]*\.\s*/i;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const name = String(entry.name || "").replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1").trim();
				entry.entries = entry.entries.map((line, ix) => {
					if (ix || typeof line !== "string") return line;
					const echo = line.match(/^\{@item ([^|}]+)[^}]*\}\s*[:\u2014-]\s*/);
					if (!echo || echo[1].trim().toLowerCase() !== name.toLowerCase()) return line;
					// The tag is the only hover the item has, so it is promoted to the heading
					// rather than deleted along with the echo.
					if (!/\{@item /.test(String(entry.name || ""))) entry.name = echo[0].replace(/\s*[:\u2014-]\s*$/, "");
					return line.slice(echo[0].length).replace(APPEARANCE, "").trim();
				});
			});
		});
	}

	/**
	 * The lead-sentence test above only corrects an entry that names a *different*
	 * economy. It cannot see an entry that names none at all — War Caster sat under
	 * Reactions on seven characters while its whole body ("has advantage on
	 * Constitution saves…, can cast with its hands full…") is passive. A DM scanning
	 * Reactions for something to spend a reaction on finds a trait.
	 *
	 * An entry earns its place in Bonus Actions or Reactions by naming the economy or
	 * by naming a trigger somewhere in its body. One that does neither is a trait.
	 *
	 * Scoped to feat-derived entries and to item prose that opens by naming itself. A
	 * class feature or psionic discipline carries an authoritative economy in its own
	 * data, so its body is free to omit it — Phirse's Minor Acceleration is a real
	 * bonus action whose prose never says so.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _demoteEconomylessEntries (out) {
		const ECONOMY = /\b(?:bonus action|reaction|as an action|magic action|no action required)\b/i;
		const TRIGGER = /(?:^|[.;]\s*|,\s*)(?:when|whenever|in response to|immediately after)\b/i;
		["bonus", "reaction"].forEach(section => {
			if (!out[section]) return;
			const keep = [];
			out[section].forEach(entry => {
				const isInferred = /\{@feat /.test(String(entry?.name || ""))
					|| /^\{@item /.test(String((entry.entries || []).find(it => typeof it === "string") || ""));
				if (!isInferred) { keep.push(entry); return; }
				const body = this._getPlainMatchTextCased((entry.entries || []).filter(it => typeof it === "string").join(" "));
				if (!body || ECONOMY.test(body) || TRIGGER.test(body)) { keep.push(entry); return; }
				(out.trait = out.trait || []).push(entry);
			});
			out[section] = keep;
			if (!out[section].length) delete out[section];
		});
	}

	/**
	 * An item entry that only describes what the item looks like, or that ends on the
	 * colon of a list it never got, costs a statblock slot and returns nothing.
	 */
	static _dropInertItemEntries (out) {
		const MECHANICAL = /\d|\{@(?:dc|damage|dice|hit|atk|condition|spell|skill|action|variantrule|status)\b|\b(?:advantage|disadvantage|resistance|immunity|immune|bonus|saving throw|save|attack|cast|charges?|regains?|healing|difficult terrain|knows the)\b/i;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => {
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ").trim();
				if (!body) return false;
				if (/:\s*$/.test(body)) return false;
				// Only item-derived entries are judged this way; a class feature with no
				// number is still a rule the character has.
				const isItem = /\{@item |\s—\s/.test(String(entry.name || "")) || /\{@item /.test(body);
				if (!isItem) return true;
				// Matched against the raw body: flattening to plain text would erase the very
				// tags that prove the entry is mechanical (Wisp's shield grants a spell and
				// nothing else, and read as inert once its {@spell} tag was flattened away).
				// "…as described {@book above|…}" points at a book the statblock is not in.
				const stripped = body.replace(/\{@(?:item|book|adventure|filter|5etools) [^}]*\}/g, "").trim();
				if (/\bas described\b/i.test(stripped) && !/\d/.test(stripped)) return false;
				// "…tosses one of these stones into the air, the stone orbits its head and
				// confers a benefit" is the catalogue preamble, never the benefit.
				if (/stones? into the air/i.test(stripped) && /confers a benefit/i.test(stripped)) return false;
				// "When found, the book contains the following spells…" is the item's
				// acquisition flavour. The spells it introduces are printed in full by the
				// item's own roster entry, so this one only repeats the first of them.
				if (/\bcontains the following spells\b/i.test(stripped)) return false;
				return MECHANICAL.test(body.replace(/\{@item [^}]*\}/g, ""));
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * An item entry whose every sentence states a defense the block already carries in
	 * `resist` / `immune` / `conditionImmune` is pure restatement, and it was landing in
	 * the action block where a DM looks for things to *do*.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropItemEntriesRestatingDefenses (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => {
				const name = String(entry?.name || "");
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				if (!body) return true;
				// Item-derived only: a class feature with no number is still a rule it has.
				if (!/\{@item /.test(body) && !/\u2014/.test(name)) return true;
				const sentences = body
					.replace(/\{@item [^}]*\}:?/g, " ")
					.split(/(?<=[.!?])\s+/)
					.map(it => it.trim())
					.filter(Boolean);
				// Flavour ("this helm is made of carved bone") neither restates nor adds a
				// mechanic; the judgement is about what the entry actually *does*.
				const mechanical = sentences.filter(sentence => this._hasMechanicalToken(sentence));
				if (!mechanical.length) return true;
				// "While wearing it" is not a condition the block is missing — the item is
				// worn, which is why its resistances are on the block at all.
				const ungate = sentence => sentence
					.replace(/^while (?:wearing|holding|attuned to|carrying|it (?:wears|holds))[^,]{0,40},\s*/i, "")
					.replace(/^\s*([a-z])/, (m, ch) => ch.toUpperCase());
				return !mechanical.every(sentence => {
					const plain = ungate(sentence);
					// Only a sentence that literally grants a defense counts as restatement;
					// anything else (a light aura, a duration, an ally buff) is real content.
					return this._getDefenseGrantMatches(plain).length > 0 && this._isRestatedSentence(plain);
				});
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * A magic item's spells are consolidated into one "Item — Spells" roster, but the
	 * per-spell entries the roster was built from stayed on the block, so Mikase's
	 * starfire katana announced Sunburst twice and Juen's dagger announced three spells
	 * twice each. The roster is the item's one home for its spells.
	 *
	 * The per-spell entry is not pure duplication — it often carries the save DC the
	 * roster omits — so the DC is moved onto the roster before the entry is dropped.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropItemSpellEntriesCoveredByRoster (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const all = [];
		sections.forEach(section => (out[section] || []).forEach(entry => all.push(entry)));

		const itemOf = name => String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
		const rosters = all
			.filter(entry => /\u2014\s*Spells\s*$/.test(String(entry?.name || "")))
			.map(entry => ({
				entry,
				item: itemOf(String(entry.name).split("\u2014")[0]).toLowerCase(),
				spells: new Set((((entry.entries || []).filter(it => typeof it === "string").join(" "))
					.match(/\{@spell ([^}|]+)/g) || []).map(it => it.replace(/^\{@spell /, "").trim().toLowerCase())),
			}));
		if (!rosters.length) return;

		const dropped = new Set();
		all.forEach(entry => {
			const name = String(entry?.name || "");
			if (!name.includes("\u2014") || /\u2014\s*Spells\s*$/.test(name)) return;
			const item = itemOf(name.split("\u2014")[0]).toLowerCase();
			const suffix = itemOf(name.split("\u2014").slice(1).join("\u2014")).toLowerCase();
			const roster = rosters.find(it => it.item === item && it.spells.has(suffix));
			if (!roster) return;

			const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
			const dc = /\bsave DC (\d+)\b/i.exec(body)?.[1];
			const rosterText = (roster.entry.entries || []).filter(it => typeof it === "string").join(" ");
			if (dc && !/\{@dc |save DC/i.test(rosterText) && roster.entry.entries?.length) {
				const idx = roster.entry.entries.length - 1;
				roster.entry.entries[idx] = `${String(roster.entry.entries[idx]).replace(/\.\s*$/, "")} (save {@dc ${dc}}).`;
			}
			dropped.add(entry);
		});
		if (!dropped.size) return;

		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * An item can advertise a spell in one entry and describe how it is actually used in
	 * another. "Fili can cast Protection from Evil and Good." adds nothing next to the
	 * entry that gives the action, the duration and the concentration exemption.
	 */
	static _dropDuplicateItemSpellStubs (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const all = [];
		sections.forEach(section => (out[section] || []).forEach(entry => all.push({section, entry})));
		const spellsIn = entry => new Set(
			(String((entry.entries || []).filter(it => typeof it === "string").join(" ")).match(/\{@spell ([^}|]+)/g) || [])
				.map(it => it.replace(/^\{@spell /, "").trim().toLowerCase()),
		);

		const dropped = new Set();
		all.forEach(({entry}) => {
			const body = (entry.entries || []).filter(it => typeof it === "string").join(" ").trim();
			if (!/^[A-Z][a-z]+ can cast \{@spell [^}]+\}\.?$/.test(body)) return;
			const spells = spellsIn(entry);
			if (spells.size !== 1) return;
			const [spell] = [...spells];
			const richer = all.some(({entry: other}) => other !== entry
				&& spellsIn(other).has(spell)
				&& (other.entries || []).join(" ").length > body.length);
			if (richer) dropped.add(entry);
		});
		if (!dropped.size) return;

		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * The conjugation pass sees each sentence while it is still in the player's voice, so
	 * an instruction that only becomes an instruction after the subject is rewritten
	 * ("When it does so, choose…") survives it. Sweep the finished text once more.
	 */
	static _fixImperativeVoice (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(line => (typeof line === "string" ? this._resolveImperativeLeftovers(line) : line));
			});
		});
	}

	/**
	 * Item entry names are assembled from parts that are not always present, leaving
	 * "(1 charges)" or a trailing separator with nothing after it.
	 */
	static _tidyEntryNames (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (typeof entry?.name !== "string") return;
				entry.name = entry.name
					.replace(/\(1 charges\)/gi, "(1 charge)")
					.replace(/\s*[—-]\s*$/, "")
					.replace(/\s{2,}/g, " ")
					.trim();
			});
		});
	}

	/**
	 * A feature can print the full procedure it used to require and then say the roll no
	 * longer happens. Both survive, and the first one is the one a DM reads.
	 */
	static _dropSupersededProcedures (out) {
		const NEGATED = /\b(?:succeeds? automatically|no roll (?:is )?required|without (?:making )?a roll)\b/i;
		const PROCEDURE = /\b(?:rolls? percentile dice|if it rolls a number equal to or lower than|roll a d100)\b/i;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const joined = entry.entries.filter(it => typeof it === "string").join(" ");
				if (!NEGATED.test(this._getPlainMatchTextCased(joined))) return;
				entry.entries = entry.entries
					.map(line => {
						if (typeof line !== "string") return line;
						return this._dropClauseContinuations(
							this._splitIntoClauses(line),
							sentence => !PROCEDURE.test(this._getPlainMatchTextCased(sentence)),
						).join(" ").trim();
					})
					.filter(it => (typeof it === "string" ? it.length : true));
			});
		});
	}

	/**
	 * Deciding what to cut by looking for mechanics gets it backwards — a sentence can
	 * state a duration or a tracking sense without a number or a modal, and losing it
	 * loses rules. Cut only what is positively identifiable as description: what the
	 * effect looks like, and instructions aimed at the player or the DM.
	 */
	static _isPureFlavourSentence (sentence) {
		const raw = String(sentence || "");
		if (/\{@(?!i |b )/.test(raw) || /\d/.test(raw)) return false;
		const text = this._getPlainMatchText(raw);
		if (!text.trim()) return false;
		// Anything that states duration, permission, obligation or a lasting sense is
		// rules text however plainly it is written.
		if (/\b(?:until|as long as|whenever|unless|instead|automatically|no roll|can|can't|cannot|must|may|advantage|disadvantage|resistance|immunity|lasts?|ends?|knows the direction)\b/.test(text)) return false;
		return /\b(?:determines?|decides?) (?:the|its|their|his|her)\b[^.]{0,40}\bappearance\b/.test(text)
			|| /\bthe dm (?:chooses|decides|determines|describes)\b/.test(text)
			|| /^describe\b/.test(text.trim())
			|| /\b(?:covers|hovers|surrounds|sprouts|shimmers|glows|appears as|looks like|resembles|takes the shape of)\b/.test(text);
	}

	/**
	 * A feature that improves another one is exported as its own entry, so the base
	 * entry keeps stating the value the improvement already replaced — Radiant Fire
	 * says 1d4 while Honed Spellfire says it "increases to 1d8". A DM reading top to
	 * bottom gets the wrong number. Apply the upgrade to the base and retire the
	 * sentence that announced it.
	 */
	static _applyCrossEntryQuantityUpgrades (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const index = new Map();
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const bare = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
				const key = this._normalizeFeatureKey(bare);
				if (key && !index.has(key)) index.set(key, entry);
			});
		});
		if (!index.size) return;

		const UPGRADE = /\b(?:the\s+)?(?:extra\s+|bonus\s+)?(?:damage|die|dice)\s+of\s+(?:[A-Z][\w'’]*\s+)*?([A-Z][\w'’]*(?:\s+[A-Z][\w'’]*){0,3})\s+increases\s+to\s+(\d*d\d+|\+?\d+)/;

		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const self = this._normalizeFeatureKey(String(entry.name || "").replace(/\s*\([^)]*\)\s*$/, ""));
				const kept = [];
				entry.entries.forEach(line => {
					if (typeof line !== "string") return void kept.push(line);
					const surviving = this._splitIntoClauses(line).filter(sentence => {
						const m = UPGRADE.exec(this._getPlainMatchTextCased(sentence));
						if (!m) return true;
						const target = index.get(this._normalizeFeatureKey(m[1]));
						if (!target || target === entry || this._normalizeFeatureKey(m[1]) === self) return true;
						return !this._rewriteStatedQuantity(target, m[2]);
					});
					if (surviving.length) kept.push(surviving.join(" "));
				});
				entry.entries = kept;
			});
			out[section] = (out[section] || []).filter(entry => (entry.entries || []).length);
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * Overwrite the last quantity of the same kind (die or flat number) an entry
	 * states. Returns false when the entry states nothing comparable, so the caller
	 * keeps the announcing sentence rather than silently losing the upgrade.
	 * @returns {boolean}
	 */
	static _rewriteStatedQuantity (entry, value) {
		const isDie = /^\d*d\d+$/i.test(value);
		const re = isDie ? /\b\d*d\d+\b/g : /\b\d+\b/g;
		for (let i = (entry.entries || []).length - 1; i >= 0; --i) {
			const line = entry.entries[i];
			if (typeof line !== "string") continue;
			const hits = [...line.matchAll(re)].filter(m => m[0].toLowerCase() !== String(value).toLowerCase());
			if (!hits.length) continue;
			const hit = hits[hits.length - 1];
			entry.entries[i] = `${line.slice(0, hit.index)}${value}${line.slice(hit.index + hit[0].length)}`;
			return true;
		}
		return false;
	}

	/**
	 * A class feature that offers a choice ("Blessed Strikes: Divine Strike *or*
	 * Potent Spellcasting") exports every option, including the ones this character
	 * never took. When some labels in a menu name features the character has and
	 * others name nothing it owns, the unowned ones are the paths not taken.
	 */
	static _dropUnownedOptionClauses (out, state) {
		const owned = new Set();
		[...(state.getFeatures?.() || []), ...(state.getFeats?.() || [])].forEach(feature => {
			const key = this._normalizeFeatureKey(feature?.name);
			if (key) owned.add(key);
		});
		if (!owned.size) return;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				// The menu can be one string or one string per option, so the labels have to
				// be gathered across the whole entry before any of them can be judged.
				const LABEL = /^\{@b ([^}]+)\.\}/;
				const split = line => (typeof line === "string" ? line.split(/(?=\{@b [^}]+\.\})/g).filter(it => it.trim()) : [line]);
				const labelKeys = entry.entries
					.flatMap(split)
					.map(it => (typeof it === "string" ? LABEL.exec(it) : null))
					.filter(Boolean)
					.map(m => this._normalizeFeatureKey(m[1]));
				if (labelKeys.length < 2) return;
				// Only a genuine menu of features qualifies: at least one label must name
				// something the character actually has, or these are section headings.
				if (!labelKeys.some(k => owned.has(k)) || labelKeys.every(k => owned.has(k))) return;

				entry.entries = entry.entries
					.map(line => {
						if (typeof line !== "string") return line;
						const kept = split(line).filter(it => {
							const m = LABEL.exec(it);
							if (!m || owned.has(this._normalizeFeatureKey(m[1]))) return true;
							// A clause that *defines* an unowned label is a sub-benefit of this very
							// feature ("Temporary Hit Points", "Lunar Radiance"). A path not taken
							// instead *modifies* a feature the statblock never defines.
							const body = it.replace(LABEL, "");
							const named = new RegExp(`\\b${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.]{0,60}?\\b(?:increases? to|improves? to|becomes|now deals?|is increased)\\b`, "i");
							return !named.test(body);
						});
						return kept.join(" ").replace(/\s{2,}/g, " ").trim();
					})
					.filter(it => (typeof it === "string" ? it.length : true));
			});
		});
	}

	/**
	 * A feature whose whole subject is another feature is a rider on it, not a second
	 * ability — but only some of them announce that in their name. Brand of Tethering
	 * exists solely to edit Brand of Castigation; Improved Shadowcasting solely to extend
	 * Shadowcasting. Kept apart, a DM reads the anchor, acts on its numbers, and only then
	 * discovers a later entry replaced them.
	 *
	 * The detector is deliberately narrow. A dependent must open by naming its anchor and
	 * doing something to it, must live in the same section (an entry with its own action
	 * economy is a real ability), and must not itself be named by anything else — v15's
	 * anchor rule holds, so a feature other entries point at may be compressed but never
	 * folded away.
	 *
	 * @param {Object} out monster object (mutated)
	 */
	static _foldNamedDependentsIntoAnchor (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const bare = entry => String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
		const all = [];
		sections.forEach(section => (out[section] || []).forEach(entry => all.push({section, entry})));
		// A one-word name matches too much English to be a safe anchor ("Rage" inside
		// "courage"); an anchor has to be nameable without ambiguity.
		const anchors = all.filter(it => bare(it.entry).split(/\s+/).length >= 2);
		if (!anchors.length) return;

		const EDITS = /\b(?:increases? to|improves? to|becomes|now|also|instead|in addition|additionally|extends?|gains?|can (?:instead|also))\b/i;
		// A rider can also announce itself as a trigger on the anchor rather than as an
		// edit to it — Tactical Shift fires "whenever it activates its Second Wind". That
		// has no action economy of its own, so it is part of the anchor, not a sibling.
		const TRIGGERS = /^(?:whenever|when|each time|immediately after)\b/i;
		const dropped = new Set();

		all.forEach(({section, entry}) => {
			if (dropped.has(entry)) return;
			const body = (entry.entries || []).filter(it => typeof it === "string");
			if (!body.length) return;
			const first = this._splitIntoClauses(body[0])[0] || "";
			const isEdit = EDITS.test(first);
			// Only a trait may cross into another section: it is the one shape that cannot
			// be a turn's worth of action in its own right.
			const isTrigger = !isEdit && section === "trait" && TRIGGERS.test(first);
			if (!isEdit && !isTrigger) return;

			const selfKey = this._normalizeFeatureKey(bare(entry));
			const hit = anchors.find(({section: anchorSection, entry: anchor}) => {
				if (anchor === entry || dropped.has(anchor) || (!isTrigger && anchorSection !== section)) return false;
				const name = bare(anchor);
				if (this._normalizeFeatureKey(name) === selfKey) return false;
				return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(first);
			});
			if (!hit) return;
			// Something else leans on this entry, so it is an anchor in its own right.
			const isReferenced = all.some(({entry: other}) => other !== entry
				&& (other.entries || []).some(line => typeof line === "string"
					&& new RegExp(`\\b${bare(entry).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line)));
			if (isReferenced) return;

			const anchor = hit.entry;
			// The announcing sentence is only worth keeping when the value it announces
			// could not be written onto the anchor in its place. Rewriting by position is
			// not safe here — the anchor states several numbers and only one of them is the
			// one being raised — so the replacement is keyed on the phrase they share.
			const upgrade = /\bincreases?\s+to\s+(.+?)\.?\s*$/i.exec(first);
			const applied = upgrade && this._rewriteDerivedPhrase(anchor, upgrade[1]);
			const surviving = isTrigger
				// The full name, not the bare one: a rider that owns a pool ("Uncanny
				// Metabolism (1/LR)") takes its uses with it or the pool is lost.
				? this._getTriggerRiderLines(entry, String(entry.name || bare(entry)).trim(), bare(anchor), body)
				: body.flatMap((line, idx) => {
					const clauses = this._splitIntoClauses(line);
					if (idx === 0 && applied) clauses.shift();
					return clauses.length ? [clauses.join(" ")] : [];
				});
			const existing = (anchor.entries || []).filter(it => typeof it === "string").join(" ");
			// Once the options sit in the anchor's own list, "the following effects are now
			// among its options" points at a distinction the statblock no longer draws.
			const CONNECTOR = /^\s*the following (?:effects?|options?)[^.]{0,40}\bnow\b[^.]{0,40}\.\s*$/i;
			anchor.entries.push(...surviving.filter(line => line && !existing.includes(line) && !CONNECTOR.test(line)));
			dropped.add(entry);
		});

		if (!dropped.size) return;
		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * A trigger rider keeps its own name once it is inside the anchor — a DM still has to
	 * be able to say which feature is doing this — but loses the self-reference, because
	 * "whenever it activates its Second Wind" is a fact the rider's new position already
	 * states. Only that exact self-reference is stripped; any other trigger is preserved
	 * verbatim, since it says something the placement does not.
	 *
	 * @param {Object} entry the dependent being folded away
	 * @param {string} name its bare display name
	 * @param {string} anchorName the anchor's bare display name
	 * @param {Array<string>} body its string entries
	 * @returns {Array<string>} lines to append to the anchor
	 */
	static _getTriggerRiderLines (entry, name, anchorName, body) {
		const escaped = anchorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const selfTrigger = new RegExp(`^(?:whenever|when|each time)\\s+.{0,40}?\\b(?:activates?|uses?|takes?)\\b[^,]*\\b${escaped}\\b[^,]*,\\s*`, "i");
		const first = String(body[0] || "");
		const stripped = selfTrigger.test(first)
			? first.replace(selfTrigger, "").replace(/^it can\b/i, "it can also")
			: first;
		const sentence = `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}`;
		return [`{@b ${name}.} ${sentence}`, ...body.slice(1)];
	}

	/**
	 * A labelled sub-option is a heading, so it has to start its own paragraph. Left in the
	 * middle of a line it reads as a continuation of the sentence before it — "…make a
	 * single weapon attack with a shadow weapon it is holding. {@b Eyes of the Dark.} …" —
	 * and the option becomes invisible to anyone scanning for it.
	 *
	 * @param {Object} out monster object (mutated)
	 */
	static _splitAtInlineBoldLabels (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.flatMap(line => {
					if (typeof line !== "string") return [line];
					// Bullets carry their own label by construction, and a roster is one unit.
					if (/^\s*\u2022/.test(line)) return [line];
					// Only break where a label follows a finished sentence — mid-sentence bold is
					// emphasis, not a heading.
					const parts = line.split(/(?<=[.!?}])\s+(?=\{@b [^}]+\.\})/g).map(it => it.trim()).filter(Boolean);
					// A line that *is* one labelled option is already correct; only a line that
					// buries a label after other prose needs breaking up.
					return parts.length > 1 ? parts : [line];
				});
			});
		});
	}

	/**
	 * An item power that triggers on a hit with that item belongs on that item's attack
	 * line. Filed as its own trait it is invisible at the moment it matters: a DM rolls
	 * the sword, reads the damage, and never learns the sword also kills on a failed save.
	 *
	 * Only on-hit powers move. A power that costs its own action ("in place of one attack",
	 * "can take a Magic action") is a separate thing to do on a turn and keeps its entry,
	 * and a power the attack line already names is simply dropped as a duplicate.
	 *
	 * @param {Object} out monster object (mutated)
	 */
	static _foldItemPowerTraitsOntoAttack (out) {
		const attacks = (out.action || []).filter(entry => (entry.entries || [])
			.some(it => typeof it === "string" && /\{@atk\b/.test(it)));
		if (!attacks.length || !(out.trait || []).length) return;

		const ON_HIT = /\b(?:hits?|hitting)\b/i;
		const TRIGGER = /^(?:when|whenever|each time|the first time|if|while)\b/i;
		const OWN_ACTION = /\b(?:in place of one attack|take a \{@action|takes? an? (?:Magic|Attack) action|can use an action|as an action|bonus action)\b/i;
		const dropped = new Set();

		(out.trait || []).forEach(entry => {
			const name = String(entry?.name || "").trim();
			const split = /^(.+?)\s+[\u2014-]\s+(.+)$/.exec(name);
			if (!split) return;
			const attack = attacks.find(it => this._normalizeFeatureKey(it.name) === this._normalizeFeatureKey(split[1]));
			if (!attack) return;

			const body = (entry.entries || []).filter(it => typeof it === "string");
			if (body.length !== 1) return;
			const text = body[0];
			const first = this._splitIntoClauses(text)[0] || "";
			if (!TRIGGER.test(first) || !ON_HIT.test(first) || OWN_ACTION.test(text)) return;

			const power = split[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
			const line = attack.entries.findIndex(it => typeof it === "string" && /\{@atk\b/.test(it));
			// The rider channel may already have put this power's numbers on the line, in
			// which case the trait is a second telling of the same fact.
			if (new RegExp(`\\b${power.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(attack.entries[line]))) {
				dropped.add(entry);
				return;
			}
			attack.entries.splice(line + 1, 0, `{@b ${power}.} ${text}`);
			dropped.add(entry);
		});

		if (!dropped.size) return;
		out.trait = out.trait.filter(entry => !dropped.has(entry));
	}

	/**
	 * Blood Maledict opens on the book's own words — "it knows one blood curse of its
	 * choice" — which tells a DM nothing about the creature in front of them. The curses
	 * it actually knows are already exported, three entries away and in other sections.
	 * Same defect the Combat Method and Maneuver rosters already fixed: name the roster.
	 *
	 * @param {Object} out monster object (mutated)
	 * @param {Object} opts
	 * @param {string} opts.npcName creature name
	 */
	static _rosterBloodCurses (out, {npcName} = {}) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const COST = {trait: "", action: "Action", bonus: "Bonus Action", reaction: "Reaction"};
		let maledict = null;
		const curses = [];
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const name = String(entry?.name || "").trim();
				if (/^Blood Maledict\b/i.test(name)) { maledict = maledict || entry; return; }
				if (/^Blood Curse of\b/i.test(name)) curses.push({name: name.replace(/\s*\([^)]*\)\s*$/, ""), cost: COST[section]});
			});
		});
		if (!maledict || !curses.length) return;

		const who = npcName || "The creature";
		const listed = curses.map(it => (it.cost ? `${it.name} (${it.cost})` : it.name)).join(", ");
		// Everything else the generic text says is either restated by each curse's own entry
		// or is the amplify rule, which is one number and one proviso.
		const amplify = (maledict.entries || [])
			.filter(it => typeof it === "string")
			.flatMap(line => this._splitIntoClauses(line))
			.filter(it => /\bamplif/i.test(it) && !/^Each time\b/i.test(it));
		maledict.entries = [`${who} knows ${listed}.`, ...amplify];
	}

	/**
	 * A feat whose whole mechanic is "you learn these spells" is already stated by the
	 * spellcasting block, which attributes each granted spell to the feat that granted it.
	 * Keeping the feat as well says the same thing twice, in the section a DM reads for
	 * things the stat lines cannot express.
	 *
	 * Only the spell sentences are removed, so a feat that also does something real —
	 * Telekinetic's bonus-action shove, War Caster's reaction — keeps its entry and simply
	 * loses the half the spell block already covers.
	 *
	 * @param {Object} out monster object (mutated)
	 */
	static _dropSpellOnlyFeatEntries (out) {
		const granted = new Set();
		// The attribution is written before feat names are tagged, so it can be either
		// `({@feat Shadow Touched|TCE})` or a bare `(Shadow Touched)` depending on when in
		// the chain this runs. Read both rather than depending on the order.
		// Every spell the block prints, so a sentence is only dropped once the block
		// demonstrably says the same thing; a feat that also grants a spell the block never
		// lists keeps that sentence rather than losing it silently.
		const printed = new Set();
		(out.spellcasting || []).forEach(block => {
			const json = JSON.stringify(block);
			// v19 puts a superscript economy mark between the tag and its provenance
			// parenthetical, so the mark has to be skipped rather than blocking the match.
			const reGranted = new RegExp(`\\{@spell ([^|}]+)[^}]*\\}${this.ECONOMY_MARK_RE_SRC}?\\s*\\((?:\\{@feat )?([^}()|]+?)(?:\\|[^}]*\\})?\\)`, "g");
			[...json.matchAll(reGranted)]
				.forEach(m => granted.add(this._normalizeFeatureKey(m[2])));
			[...json.matchAll(/\{@spell ([^|}]+)/g)].forEach(m => printed.add(this._normalizeFeatureKey(m[1])));
		});
		if (!granted.size) return;

		const SPELL_ONLY = /^[^.]{0,80}\b(?:learns?|knows?|can cast)\b[^.]*\{@spell /i;
		const CAST_PROVISO = /^It can cast (?:each of these spells|it|them)\b/i;
		// "its spellcasting ability for these spells is Constitution" loses its antecedent the
		// moment the spells leave, and the block it sends them to states the ability anyway.
		const ORPHAN = /spellcasting ability for (?:these|those|this|the) spells?\b/i;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const raw = String(entry?.name || "").replace(/^\{@feat ([^}|]+)\|[^}]*\}$/, "$1").replace(/\s*\([^)]*\)\s*$/, "");
				if (!granted.has(this._normalizeFeatureKey(raw)) || !Array.isArray(entry.entries)) return;
				entry.entries = entry.entries.flatMap(line => {
					if (typeof line !== "string") return [line];
					const kept = this._splitIntoClauses(line).filter(it => {
						if (CAST_PROVISO.test(it) || ORPHAN.test(it)) return false;
						if (!SPELL_ONLY.test(it)) return true;
						const named = [...it.matchAll(/\{@spell ([^|}]+)/g)].map(sp => this._normalizeFeatureKey(sp[1]));
						return !named.length || !named.every(sp => printed.has(sp));
					});
					return kept.length ? [kept.join(" ")] : [];
				});
			});
			out[section] = (out[section] || []).filter(entry => (entry.entries || []).length);
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * Replace a derived phrase the anchor already states with the upgraded form of the
	 * same phrase ("its Hemocraft modifier (2)" -> "twice its Hemocraft modifier (4)").
	 *
	 * Keyed on the phrase's own noun rather than on position, because an anchor states
	 * several numbers and overwriting the wrong one silently corrupts a fact the DM has
	 * no way to check. Returns false when the anchor states nothing comparable, so the
	 * caller keeps the announcing sentence instead of losing the upgrade.
	 *
	 * @param {Object} entry anchor entry (mutated)
	 * @param {string} phrase the upgraded phrase, e.g. "twice its Hemocraft modifier (4)"
	 * @returns {boolean}
	 */
	static _rewriteDerivedPhrase (entry, phrase) {
		const text = String(phrase || "").trim();
		// The noun is what makes two phrases comparable; without one there is nothing to
		// key on and a blind replacement would be a guess.
		const noun = /\b((?:[A-Z][\w'\u2019]*\s+)?\w+\s+(?:modifier|die|dice|bonus))\b/i.exec(text);
		if (!noun) return false;
		const find = new RegExp(String.raw`(?:twice |half |double )?(?:its |the )?${noun[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\s*\((?:minimum[^)]*|[+-]?\d+)\))?`, "i");
		for (let i = 0; i < (entry.entries || []).length; ++i) {
			const line = entry.entries[i];
			if (typeof line !== "string" || !find.test(line)) continue;
			entry.entries[i] = line.replace(find, text);
			return true;
		}
		return false;
	}

	/**
	 * A paladin's auras are three entries describing one emanation. Read down the trait
	 * list, they look like three separate zones to track; at the table they are one circle
	 * whose contents a DM states once. Merge them, keeping each clause's source so the
	 * player can still see which aura granted what.
	 *
	 * @param {Object} out monster object (mutated)
	 * @param {Object} opts
	 * @param {string} opts.npcName creature name
	 */
	static _mergeAuraEntries (out, {npcName} = {}) {
		const traits = out.trait || [];
		const auras = traits.filter(entry => /^Aura of\b/i.test(String(entry?.name || "").trim())
			&& (entry.entries || []).some(it => typeof it === "string"));
		if (auras.length < 2) return;

		const who = npcName || "The creature";
		let radius = 0;
		let saveBonus = "";
		const immunities = [];
		const extras = [];

		// Boilerplate the merged entry states once, or does not need to state at all: the
		// emanation's own description, the incapacitated proviso, the multi-paladin
		// arbitration rule, and the restatement that an aura also works on allies who walk
		// into it (which is what "in the aura" already means).
		const NOISE = [
			/radiates? an?\b[^.]*\bEmanation\b/i,
			/\baura is inactive\b/i,
			/\banother Paladin is present\b/i,
			/^If an? \{@condition [^}]+\} ally enters the aura\b/i,
			/\bchooses which aura\b/i,
		];

		auras.forEach(entry => {
			const source = String(entry.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
			(entry.entries || []).forEach(line => {
				if (typeof line !== "string") return;
				this._splitIntoClauses(line).forEach(sentence => {
					const text = sentence.trim();
					if (!text) return;
					const m = /(\d+)[- ]f(?:oo|ee)?t\.?\s*Emanation/i.exec(text);
					if (m) radius = Math.max(radius, Number(m[1]) || 0);
					if (NOISE.some(re => re.test(text))) return;

					const save = /bonus to saving throws[^.]*?\(([+-]?\d+)\)/i.exec(text);
					if (save) { saveBonus = this._toSignedStr(Number(save[1])); return; }

					const imm = /Immunity to the (\{@condition [^}]+\}) condition/i.exec(text);
					if (imm) { immunities.push({condition: imm[1], source}); return; }

					extras.push(`${text.replace(/\.$/, "")} (${source})`);
				});
			});
		});
		if (!saveBonus && !immunities.length) return;

		const parts = [];
		if (saveBonus) parts.push(`add ${saveBonus} to saving throws`);
		if (immunities.length) {
			const listed = immunities.map(it => `${it.condition} (${it.source})`).join(" and ");
			parts.push(`have Immunity to the ${listed} condition${immunities.length > 1 ? "s" : ""}`);
		}

		const merged = {
			name: radius ? `Auras (${radius}-ft. Emanation)` : "Auras",
			entries: [
				`${who} and its allies in the emanation ${parts.join(", and ")}.`,
				...extras,
				`Inactive while ${who} has the {@condition incapacitated} condition.`,
			],
		};
		out.trait = traits.filter(entry => !auras.includes(entry));
		out.trait.unshift(merged);
	}

	/**
	 * "Improved X" is a rider on "X", not a second ability. Kept apart, a DM has to
	 * read two entries in two sections and reconcile them. Fold the rider into the
	 * base and keep the base's action economy.
	 */
	static _foldImprovedEntriesIntoBase (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const bare = entry => String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
		const index = new Map();
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const key = this._normalizeFeatureKey(bare(entry));
				if (key && !index.has(key)) index.set(key, entry);
			});
		});

		const dropped = new Set();
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const m = /^(?:improved|greater|superior)\s+(.+)$/i.exec(bare(entry));
				if (!m) return;
				const base = index.get(this._normalizeFeatureKey(m[1]));
				if (!base || base === entry) return;
				// Only fold a genuine continuation; a rider that restates the whole feature
				// would duplicate rather than extend it.
				const body = (entry.entries || []).filter(it => typeof it === "string");
				// The name already proves this is a rider, so the continuation opener only has
				// to appear somewhere in the body — Improved Shadowcasting leads with the extra
				// attack it grants and states "In addition" one paragraph later.
				if (!body.length || !body.some(line => /^\s*(?:in addition|additionally|moreover|also|whenever|the\s)/i.test(line))) return;
				const existing = (base.entries || []).filter(it => typeof it === "string").join(" ");
				// Once the options sit in the base feature's own list, "the following effects
				// are now among its options" points at a distinction the statblock no longer
				// draws.
				const CONNECTOR = /^\s*the following (?:effects?|options?)[^.]{0,40}\bnow\b[^.]{0,40}\.\s*$/i;
				base.entries.push(...body.filter(line => !existing.includes(line) && !CONNECTOR.test(line)));
				dropped.add(entry);
			});
		});
		if (!dropped.size) return;

		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * The same feature can be filed twice — once for its passive half and once for the
	 * half that costs an action — leaving two entries with one name and half a
	 * mechanic each. Merge them into whichever section states the action economy.
	 */
	static _mergeSameNameEntriesAcrossSections (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const groups = new Map();
		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const key = this._normalizeFeatureKey(String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, ""));
				if (!key) return;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push({section, entry});
			});
		});

		const dropped = new Set();
		groups.forEach(members => {
			if (members.length < 2) return;
			// The section that owns the merged entry is the one whose text declares an
			// economy; a trait half is always the passive half.
			const primary = members.find(({section}) => section !== "trait") || members[0];
			members.forEach(member => {
				if (member === primary) return;
				const body = (member.entry.entries || []).filter(it => typeof it === "string");
				const existing = (primary.entry.entries || []).filter(it => typeof it === "string").join(" ");
				const additions = body.filter(line => !existing.includes(line));
				// The passive half sets up the active one ("Wearing armor doesn't impose
				// disadvantage… In addition, whenever it makes a Dexterity save…"), so it
				// has to lead or the merged entry opens on a dangling continuation.
				const leads = /^\s*(?:in addition|additionally|moreover|also)\b/i.test(String((primary.entry.entries || [])[0] || ""));
				if (leads) primary.entry.entries.unshift(...additions);
				else primary.entry.entries.push(...additions);
				dropped.add(member.entry);
			});
		});
		if (!dropped.size) return;

		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * A home-less resource pool is exported as its own trait ("Superiority Dice
	 * (5/Short Rest)"). If a later consolidation then prints a roster that opens by
	 * stating the same budget, the standalone trait says nothing new.
	 */
	static _dropPoolTraitsRestatedElsewhere (out) {
		const traits = out.trait;
		if (!Array.isArray(traits) || traits.length < 2) return;

		const bodyOf = e => (e?.entries || []).filter(it => typeof it === "string").join(" ");
		const survivors = traits.filter(entry => {
			const m = /^(.+?) \((\d+)\/[^)]*\)$/.exec(String(entry?.name || ""));
			if (!m) return true;
			const pool = m[1].trim();
			const budget = m[2];
			// Only a *pool* trait is a candidate: its body must be the boilerplate the
			// residual-pool builder writes, not a real ability.
			if (!/\bwhich it spends on the abilities below\b/i.test(bodyOf(entry))) return true;
			const restated = traits.concat(out.action || [], out.bonus || [], out.reaction || [])
				.some(other => other !== entry
					&& new RegExp(`\\b${budget}\\s+${pool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(bodyOf(other)));
			return !restated;
		});
		if (survivors.length !== traits.length) out.trait = survivors;
	}

	/**
	 * Some features are **anchors**: other entries on the block key off them by name.
	 * Sneak Attack is the sharpest case — `Cunning Strike` spends dice out of it,
	 * `Improved Cunning Strike` spends two, and `Assassinate` turns a round-1 Sneak Attack
	 * hit into a critical. Rage, Wild Shape, Crimson Rite, Superiority Dice, Bardic
	 * Inspiration, Channel Divinity and every point pool behave the same way; the pattern
	 * covers 14 of the 24 corpus characters.
	 *
	 * That matters because a rider printed onto an attack line normally retires its source
	 * entry. Retiring an *anchor* would present a spendable pool as fixed damage and orphan
	 * every dependent whose trigger clause no longer has an antecedent. So: deletion is
	 * available only to leaves. An anchor may be compressed, never removed.
	 *
	 * @param {Object} out monster object being assembled
	 * @returns {Map<string, Array<string>>} anchor key → names of the entries referencing it
	 */
	static _buildFeatureReferenceGraph (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];
		const entries = [];
		SECTIONS.forEach(section => (out?.[section] || []).forEach(entry => {
			if (entry) entries.push(entry);
		}));
		if (entries.length < 2) return new Map();

		const rows = entries.map(entry => ({
			entry,
			name: this._getAnchorBareName(entry?.name),
			body: this._getAnchorSearchText(entry),
		}));

		const graph = new Map();
		rows.forEach(target => {
			const aliases = this._getAnchorAliases(target.name);
			if (!aliases.length) return;
			const referrers = rows
				.filter(other => other.entry !== target.entry
					&& !this._STRUCTURAL_REFERRERS.has(other.name)
					// A sibling entry sharing the bare name ("Sun Blade" / "Sun Blade —
					// Blade of Radiance") is the same feature, not a dependent of it.
					&& other.name !== target.name
					&& aliases.some(alias => this._mentionsAnchor(other.body, alias)))
				.map(other => other.name)
				.filter(Boolean);
			if (!referrers.length) return;
			const key = this._normalizeFeatureKey(target.name);
			if (!key) return;
			const existing = graph.get(key) || [];
			graph.set(key, [...new Set([...existing, ...referrers])]);
		});
		return graph;
	}

	// These entries name every item or weapon on the block by construction, so a mention
	// inside them is a listing, not a dependency. Without this every magic item became an
	// anchor and nothing could ever be retired.
	static _STRUCTURAL_REFERRERS = new Set(["Special Equipment", "Multiattack", "Additional Effects"]);

	/** True when another entry on the block names this feature, so it cannot be removed. */
	static _isReferencedAnchor (name, graph) {
		if (!graph?.size) return false;
		const key = this._normalizeFeatureKey(this._getAnchorBareName(name));
		if (!key) return false;
		if (graph.has(key)) return true;
		// "Focus Points (12/SR)" is referenced as "1 Focus Point"; the singular and the
		// pool label are the same anchor.
		return [...graph.keys()].some(anchorKey => this._featureKeyMatches(anchorKey, key));
	}

	/**
	 * Once a rider is printed on the attack line, the clause its source feature devotes to
	 * that same damage is pure duplication — Onger read *"plus 1d8 against Constructs"* on
	 * the line and then *"Onger's melee weapon attacks deal an extra 1d8 damage to
	 * constructs, and deal double damage to objects and structures"* three entries later.
	 *
	 * Strip exactly the clause the line now carries and nothing else. What remains is the
	 * residue — here, the double damage to objects, which the line does not carry and must
	 * not lose. An entry reduced to nothing is dropped, but only if it is a leaf: an anchor
	 * keeps its name and body so its dependents still have an antecedent.
	 *
	 * @param {Object} featureBlocks sections of assembled feature entries (mutated)
	 * @param {Array<Object>} riders emitted rider records
	 * @param {Map} referenceGraph anchor → referring entries
	 * @returns {Set<string>} normalized names whose body was actually reduced
	 */
	static _reduceRiderSourcesToResidue (featureBlocks, riders, referenceGraph) {
		const reduced = new Set();
		const bySource = new Map();
		(riders || []).forEach(rider => {
			if (!rider?.sourceName || !rider?.damage) return;
			const key = this._normalizeFeatureKey(rider.sourceName);
			if (!key) return;
			if (!bySource.has(key)) bySource.set(key, []);
			bySource.get(key).push(rider);
		});
		if (!bySource.size) return reduced;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			const entries = featureBlocks?.[section];
			if (!entries?.length) return;
			featureBlocks[section] = entries.filter(entry => {
				const key = this._normalizeFeatureKey(this._getAnchorBareName(entry?.name));
				const matching = bySource.get(key);
				if (!matching?.length) return true;
				const isAnchor = this._isReferencedAnchor(entry?.name, referenceGraph);
				let changed = false;

				const rewritten = (entry.entries || []).map(line => {
					if (typeof line !== "string") return line;
					let out = line;
					matching.forEach(rider => { out = this._stripEmittedDamageClause(out, rider.damage); });
					if (out === line) return line;
					changed = true;
					const tidy = out.replace(/\s{2,}/g, " ").trim();
					return /[.!?]$/.test(tidy) ? tidy : `${tidy}.`;
				});
				if (!changed) return true;
				const kept = rewritten.filter(line => typeof line !== "string" || this._isUsableRiderResidue(line));
				// Never leave a rider's source empty-bodied; and never delete an anchor.
				if (!kept.length) return isAnchor;
				entry.entries = kept;
				reduced.add(key);
				return true;
			});
		});
		return reduced;
	}

	/**
	 * A residue is only worth keeping if it still reads as a rule on its own. Divine Strike
	 * is the counter-example: its whole sentence is the rider, so stripping the rider leaves
	 * *"…when it hits a creature with an attack roll using a weapon, it can cause the target
	 * to."* — a decapitated clause that must be discarded, letting the entry be retired.
	 *
	 * @param {string} text candidate residue line
	 * @returns {boolean} true when the line stands as a rule by itself
	 */
	static _isUsableRiderResidue (text) {
		const line = String(text || "").trim();
		if (line.replace(/[^A-Za-z0-9]/g, "").length < 12) return false;
		// The strip consumed the sentence's object or its main verb's complement.
		if (/\b(?:to|the|a|an|of|with|and|or|from|by|into|target|creature|it|its)\s*[.]$/i.test(line)) return false;
		return true;
	}

	/**
	 * Remove one "deals an extra <dice> damage …" clause, taking its coordinator with it so
	 * the sentence still reads. Deliberately clause-scoped rather than sentence-scoped: a
	 * sentence usually carries a second mechanic the attack line does not.
	 *
	 * @param {string} text feature body line
	 * @param {string} damage rider damage, tagged or bare ("1d8", "5")
	 * @returns {string} the line with that clause removed
	 */
	static _stripEmittedDamageClause (text, damage) {
		const value = String(damage || "").trim();
		if (!value) return text;
		const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const die = `(?:\\{@damage\\s+${escaped}\\}|\\{@dice\\s+${escaped}\\}|${escaped})`;
		const clause = new RegExp(`(?:,\\s*and\\s+|\\s+and\\s+|,\\s*)?\\b(?:deals?|takes?|inflicts?)\\s+an\\s+extra\\s+${die}[^,.;]*(?:,\\s*and\\s+)?`, "i");
		const match = clause.exec(text);
		if (!match) return text;
		const out = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
		return out.replace(/\s+([,.;])/g, "$1").replace(/\s{2,}/g, " ").trim();
	}

	/** Entry name without its use-count suffix, tag markup or provenance parenthetical. */
	static _getAnchorBareName (name) {
		return this._stripEconomyMarks(name)
			.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1")
			.replace(/\s*\([^)]*\)\s*$/, "")
			.replace(/\s*—.*$/, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	/** Flattened, tag-stripped body of an entry, for anchor-mention detection. */
	static _getAnchorSearchText (entry) {
		return (entry?.entries || [])
			.map(line => (typeof line === "string" ? line : JSON.stringify(line)))
			.join(" ")
			.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1");
	}

	// A one-word anchor is a trap: "Rage" is inside "courage" and "forager", and a bare
	// "Iron" or "Kindling" is ordinary English. Only multi-word names, or the handful of
	// single words that are unambiguous class resources, may anchor.
	static _SINGLE_WORD_ANCHORS = new Set(["rage", "ki", "psionics"]);

	/** Name variants an entry may be referenced by ("Focus Points" → "focus point"). */
	static _getAnchorAliases (name) {
		const bare = String(name || "").trim();
		if (!bare) return [];
		const words = bare.split(/\s+/);
		if (words.length === 1 && !this._SINGLE_WORD_ANCHORS.has(bare.toLowerCase())) return [];
		const out = new Set([bare]);
		// Pools are named in the plural and spent in the singular.
		if (/s$/i.test(bare)) out.add(bare.replace(/s$/i, ""));
		else out.add(`${bare}s`);
		return [...out].filter(alias => alias.length >= 3);
	}

	/** Whole-word, case-insensitive mention test — never a substring match. */
	static _mentionsAnchor (haystack, alias) {
		if (!haystack || !alias) return false;
		const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
	}

	/**
	 * Later class levels bolt riders onto an earlier transformation, and the sheet files
	 * each rider as its own feature. Their text gives them away: they open with an orphan
	 * lead ("Its hybrid form also gains the following additional benefit.") that refers to
	 * a form defined somewhere else entirely. Read as a standalone trait the lead has no
	 * referent, and worse, the rider often picks up a use count from a resource pool it
	 * does not actually spend.
	 *
	 * Move the rider's benefit clauses onto the entry that defines the form and drop the
	 * orphan lead. Any content the rider carried *before* the lead is a genuine standalone
	 * benefit and stays where it is.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _absorbOrphanRiderEntries (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];
		const LEAD = /(?:^|(?<=[.;]))\s*(?:(?:Its|The|Your)\s+)?(\w+)\s+form\s+also\s+gains?\s+the\s+following\s+additional\s+benefits?\.?/i;

		const findHost = formWord => {
			for (const section of SECTIONS) {
				const hit = (out[section] || []).find(e => new RegExp(`\\b${formWord}\\b`, "i").test(String(e?.name || "")) && /\b(?:transformation|form|shape)\b/i.test(String(e?.name || "")));
				if (hit) return hit;
			}
			return null;
		};

		SECTIONS.forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				if (!Array.isArray(entry?.entries)) return true;

				// The compaction passes may have merged the lead onto the end of an earlier
				// sentence, so it has to be located within a string as well as as one.
				const leadIdx = entry.entries.findIndex(it => typeof it === "string" && LEAD.test(it));
				if (leadIdx < 0) return true;

				const hit = LEAD.exec(entry.entries[leadIdx]);
				const host = findHost(hit[1]);
				if (!host || host === entry || !Array.isArray(host.entries)) return true;

				const riders = entry.entries.slice(leadIdx + 1);
				if (!riders.length) return true;

				host.entries.push(...riders);
				const head = entry.entries[leadIdx].replace(LEAD, "").trim();
				entry.entries = [...entry.entries.slice(0, leadIdx), head].filter(it => (typeof it === "string" ? it.trim() : it));
				return entry.entries.length > 0;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * A class that raises a feature's use count at a later level ships the raise as its own
	 * feature (`Blood Maledict Improvement`), whose entire body is a restatement of the new
	 * count. On a statblock that is worse than redundant: the parent's `(N/SR)` suffix
	 * already carries the *current* count, while the improvement entry states an
	 * intermediate one and flatly contradicts it.
	 *
	 * Drop the improvement entry when the feature it improves is present. Only entries
	 * whose body says nothing except the count qualify — an improvement that adds a real
	 * mechanic keeps its entry.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropUseCountImprovementEntries (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];

		const present = new Set();
		SECTIONS.forEach(section => {
			(out[section] || []).forEach(e => {
				const key = this._normalizeFeatureKey(String(e?.name || "").replace(/\s*\([^)]*\)\s*$/, ""));
				if (key) present.add(key);
			});
		});

		SECTIONS.forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const bare = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "");
				const parent = /^(.+?)\s+Improvement$/i.exec(bare)?.[1] || /^Improved\s+(.+)$/i.exec(bare)?.[1];
				if (!parent || !present.has(this._normalizeFeatureKey(parent))) return true;

				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ").trim();
				const onlyCount = /^[^.]*\b(?:can use|uses?)\b[^.]*\b(?:once|twice|three times|four times|five times|\d+ times)\b[^.]*\.?$/i.test(body);
				return !onlyCount;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * When a feature enumerates its own options as labelled clauses (`Crimson Rite` lists
	 * every rite; `Wild Shape` lists every form), the sheet *also* surfaces the individual
	 * options the character selected as standalone abilities. The result prints the same
	 * one-line rule twice, once with context and once without.
	 *
	 * Drop the standalone copy — the enumeration is strictly more informative. Only an
	 * exact body match qualifies, so an option the character has genuinely specialised
	 * (and whose text therefore differs) keeps its own entry.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropEntriesRestatedAsLabelledClauses (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];

		const clauses = new Map();
		SECTIONS.forEach(section => {
			(out[section] || []).forEach(entry => {
				(entry?.entries || []).forEach(line => {
					if (typeof line !== "string") return;
					const hit = /^\{@b ([^}]+?)\.?\}\s*(.+)$/.exec(line.trim());
					if (!hit) return;
					const key = this._normalizeFeatureKey(hit[1].replace(/\s*\([^)]*\)\s*$/, ""));
					if (key && !clauses.has(key)) clauses.set(key, {owner: entry, body: this._getProseComparisonKey(hit[2])});
				});
			});
		});
		if (!clauses.size) return;

		SECTIONS.forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const bare = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "");
				const found = clauses.get(this._normalizeFeatureKey(bare));
				if (!found || found.owner === entry) return true;
				const body = this._getProseComparisonKey((entry.entries || []).filter(it => typeof it === "string").join(" "));
				return !body || body !== found.body;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * Normalizes prose for equality comparison: tag markup and punctuation vary between
	 * two renderings of the same rule, the words do not.
	 *
	 * @param {string} text prose
	 * @returns {string} comparison key
	 */
	static _getProseComparisonKey (text) {
		return String(text || "")
			.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}

	/**
	 * Once a roster entry's name is hoverable, the full book paragraph underneath it is
	 * reference material the DM already has one click away — and eight of them turn a
	 * scannable roster into three thousand characters of prose. Keep enough to choose the
	 * option at the table (what triggers it, what it does, what the target rolls) and let
	 * the hover carry the rest.
	 *
	 * Sentences that carry a save, a DC, a condition or a number are always kept; the
	 * remainder is capped so no single clause outgrows the roster it belongs to.
	 *
	 * @param {string} text prepared clause body
	 * @param {number} maxSentences sentences to keep beyond the mandatory mechanical ones
	 * @return {string} condensed body
	 */
	static _condenseRosterClause (text, maxSentences = 2) {
		const str = String(text || "").trim();
		if (!str) return str;

		// Split on sentence boundaries without breaking inside a `{@tag ...}` span.
		const sentences = [];
		let depth = 0;
		let buf = "";
		for (let i = 0; i < str.length; ++i) {
			const ch = str[i];
			buf += ch;
			if (ch === "{") depth++;
			else if (ch === "}") depth = Math.max(0, depth - 1);
			else if (!depth && ch === "." && (i + 1 >= str.length || /\s/.test(str[i + 1]))) {
				sentences.push(buf.trim());
				buf = "";
			}
		}
		if (buf.trim()) sentences.push(buf.trim());
		if (sentences.length <= maxSentences) return str;

		const MECHANICAL = /\{@(?:dc|damage|dice|condition)\b|saving throw|\bAdvantage\b|\bDisadvantage\b/;
		const kept = [];
		sentences.forEach((sentence, idx) => {
			if (idx < maxSentences || MECHANICAL.test(sentence)) kept.push(sentence);
		});
		return (kept.length ? kept : sentences.slice(0, maxSentences)).join(" ");
	}

	/**
	 * A stance body in the source is three parts: the action economy, a sentence of
	 * flavour, and (sometimes) the rule. The roster line directly above already carries
	 * the economy and the cost, and the duration is stated once for the whole subsystem,
	 * so the only part worth reprinting is the rule.
	 *
	 * `_condenseRosterClause` keeps the *first* sentences, which for stance prose is
	 * exactly the wrong half — six of thirteen corpus stances reduced to a line of
	 * flavour. This keeps the mechanical sentences instead, and returns empty when there
	 * are none.
	 *
	 * @param {string} text prepared stance description
	 * @return {string} mechanical body, or "" when the prose says nothing mechanical
	 */
	static _condenseStanceBody (text) {
		let str = String(text || "").trim();
		if (!str) return "";

		// "{@b Bonus Action (1 Stamina Point)}." or the same unbolded — both forms reach
		// here because the source prose bolds it inconsistently.
		str = str
			.replace(/^\{@b\s*([^}]*?)\}\s*\.?\s*/i, (m, inner) => (/\b(?:action|stamina)\b/i.test(inner) ? "" : m))
			.replace(/^(?:Bonus Action|Action|Reaction|No Action Required)\b[^.]{0,40}\.\s*/i, "")
			.trim();

		const MECHANICAL = /\{@(?:dc|damage|dice|condition|skill|status|variantrule|spell|action)\b|saving throw|\bAdvantage\b|\bDisadvantage\b|\bresistan|\bimmun|\bbonus (?:to|equal to|of)\b|\b\d+ (?:feet|foot)\b|\bextra \d/;
		// A sentence that only says when the stance stops is worthless without the one
		// that says what it does, and the shared duration rule is already in the header.
		const DURATION = /^This stance (?:lasts|ends)\b/i;

		const kept = this._splitIntoClauses(str)
			.filter(sentence => MECHANICAL.test(sentence) || DURATION.test(sentence.trim()));
		if (!kept.some(sentence => !DURATION.test(sentence.trim()))) return "";

		return kept
			.filter(sentence => !/^This stance lasts\b/i.test(sentence.trim()))
			.join(" ")
			// The roster line above already states the economy for every method.
			.replace(/^As a bonus action,\s*/i, "")
			.replace(/^As part of this stance,\s*/i, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * Book text hedges because it is written for every possible build: "If Dzeiy has its
	 * Extra Attack feature…", "(such as the barbarian's Rage feature)". An exported NPC
	 * is one specific build, so the hedge is answerable — and a DM should never have to
	 * check the character sheet to resolve a conditional in the statblock.
	 *
	 * Resolve against the features the character actually has: keep the clause without its
	 * condition when the referenced feature is present, drop the whole sentence when it is
	 * not.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character sheet state
	 */
	static _resolveConditionalFeatureReferences (out, state) {
		const owned = new Set();
		(state?.getFeatures?.() || []).forEach(feature => {
			const key = this._normalizeFeatureKey(feature?.name);
			if (key) owned.add(key);
		});

		const has = name => owned.has(this._normalizeFeatureKey(name));

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(line => {
					if (typeof line !== "string") return line;
					return line
						// "(such as the barbarian's Rage feature)" — an example drawn from a
						// class this character may not even have.
						.replace(/\s*\((?:such as|like) [^()]{0,80}?\bfeature\)/gi, (m) => (has(/([A-Z][\w' ]+) feature\)/.exec(m)?.[1] || "") ? m : ""))
						// "If X has its Extra Attack feature, <clause>."
						.replace(/(^|\.\s+)If [^.]{0,40}?\bhas (?:its|the) ([A-Z][\w' ]+) feature,\s*(it\b[^.]*\.)/g, (m, pre, feat, clause) => {
							if (!has(feat)) return pre;
							// The clause was written to lean on the condition ("…use it for
							// this attack"), so name the feature where the pronoun stood.
							const resolved = clause.replace(/\buse it\b/, `use its ${feat}`);
							return `${pre}${resolved.charAt(0).toUpperCase()}${resolved.slice(1)}`;
						});
				}).filter(line => typeof line !== "string" || line.trim());
			});
		});
	}

	/**
	 * Feature text written for a player usually opens by telling them what the feature is
	 * *about* — "Wisp has a limited well of physical and mental stamina that it can draw
	 * on." — before it says what the feature does. In a statblock the entry name already
	 * carries that, and the DM has to read past it every time.
	 *
	 * Only drop a leading sentence that carries no mechanical content whatsoever: no
	 * number, no tag, none of the vocabulary a rule is written in. Anything that might be
	 * the sole description of an effect stays, which is what keeps homebrew and custom
	 * abilities safe under the same rule.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	/**
	 * Elizabeth carried 2,853 characters of elven school history — *"Most schools of
	 * Bladesinging are in Evermeet or Evereska"* — because it is subclass text and subclass
	 * text is normally rules. A DM running her needs none of it.
	 *
	 * The test is a *ratio*, not the absence of mechanics: `Bladesinger Styles` contains two
	 * sentences the token vocabulary reads as mechanical (a `{@skill}` hover, and "which can
	 * keep many foes at bay" — a modal inside flavour), so an all-or-nothing test misses it.
	 * A long entry that is 90% description is description.
	 *
	 * Deliberately conservative on both axes: short entries are exempt, because a terse
	 * mechanical line the vocabulary happens to miss ("Nagara's elemental empowerment is to
	 * cold damage") must survive; and an entry with three or more mechanical sentences is
	 * exempt however long it is. Across the corpus this matches exactly the two lore traits
	 * and nothing else.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropMechaniclessLoreEntries (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const lines = (entry?.entries || []).filter(it => typeof it === "string");
				if (lines.length !== (entry?.entries || []).length) return true;
				const body = lines.join(" ");
				if (body.length < 250) return true;
				const sentences = lines
					.flatMap(line => this._splitIntoClauses(line))
					.filter(it => typeof it === "string" && it.trim().length > 15);
				if (!sentences.length) return true;
				const mechanical = sentences.filter(it => this._hasMechanicalToken(it)).length;
				return mechanical > 2 || (mechanical / sentences.length) >= 0.25;
			});
		});
	}

	/**
	 * Dzeiy's Hybrid Transformation was 2,531 characters inside a single Bonus Action: the
	 * activation, and then seven standing features the form confers. A DM reading Bonus
	 * Actions wants to know how to transform; a DM reading a transformed Dzeiy wants the
	 * deltas — and those are two different moments.
	 *
	 * Split on the connector the source itself supplies ("While it is transformed, it gains
	 * the following features:"). The activation stays where the economy put it; the deltas
	 * become a companion trait, which is where every other standing modifier on the block
	 * already lives. Generalises to any form feature written this way (Mikase's Angelic
	 * Avatar, Wild Shape's rules-while-shifted).
	 *
	 * Requires the connector *and* at least two labelled sub-features: a form entry with one
	 * benefit is not a block, and splitting it would only add a heading.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	/**
	 * Mikase's Starlight Arc was 754 characters of trait describing *an attack* — a cone, a
	 * shared attack roll and an extra damage die — with the to-hit and base damage it uses
	 * sitting in a different entry entirely. Running it meant reading a paragraph and then
	 * cross-referencing the weapon.
	 *
	 * Promotes such a power to a real action entry carrying the parent weapon's own line,
	 * with the target clause replaced by the area the power states and the power's extra
	 * damage appended. Deliberately narrow: fires only when the parent attack, the area and
	 * the extra damage are all recovered, because a synthesised attack line that guesses any
	 * of the three is worse than the paragraph it replaces.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _promoteReplacementAttacks (out) {
		const attacks = (out.action || []).filter(it => (it.entries || []).some(line => typeof line === "string" && /\{@atk /.test(line)));
		if (!attacks.length) return;

		["trait", "action"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const name = String(entry?.name || "");
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				if (!body || !/\bforgo (?:the first attack|one of)|\breplace one of (?:its|your) attacks\b/i.test(body)) return;
				if (/\{@atk /.test(body)) return;

				const parent = attacks.find(it => name.startsWith(`${it.name} `) || body.includes(it.name));
				if (!parent) return;
				const parentLine = parent.entries.find(line => typeof line === "string" && /\{@atk /.test(line));

				const area = /(\d+)-foot (cone|line|radius|sphere)/i.exec(body);
				const extra = /takes? an extra (\{@damage [^}]+\}) (\w+) damage/i.exec(body);
				if (!area || !extra) return;

				const shortName = name.includes("—") ? name.split("—").pop().trim() : name;
				const targets = `${area[1]}-foot ${area[2].toLowerCase()}, each nearest creature in it`;
				// The extra die belongs in the damage sentence, not at the end of the line: a
				// parent that closes on "The attack is magical." would otherwise read
				// "…magical., plus 1d8 radiant damage".
				const retargeted = parentLine
					.replace(/reach [^,]+, one target\.|range [^,]+, one target\.|, one target\./i, `${targets}.`);
				const clauses = this._splitIntoClauses(retargeted);
				const hitIx = clauses.findIndex(it => /\{@h\}/.test(it));
				const addition = `, plus ${extra[1]} ${extra[2].toLowerCase()} damage`;
				if (hitIx >= 0) clauses[hitIx] = `${clauses[hitIx].replace(/\s*\.$/, "")}${addition}.`;
				else clauses.push(`${addition.replace(/^,\s*/, "").replace(/^./, c => c.toUpperCase())}.`);
				const line = clauses.join(" ").replace(/\s{2,}/g, " ");
				// Only what the line cannot carry. Every other sentence in the source either
				// restates the roll, the damage, or the fact that an area ends after it fires.
				const residue = [
					/using that attack roll against each/i.test(body) ? "One attack roll applies to every target." : "",
					/illusion/i.test(body) ? "Any illusions on a target it hits end." : "",
				].filter(Boolean).join(" ");

				out.action = out.action || [];
				out.action.push({name: `${shortName} (Replaces One Attack)`, entries: [`${line}.`.replace(/\.\.$/, "."), residue].filter(Boolean)});
				entry._npcRemove = true;
			});
			if (out[section]) out[section] = out[section].filter(it => !it._npcRemove);
		});
	}

	/**
	 * Reggu's Eldritch Maul gives every melee attack 15-foot reach and an extra 1d6 force
	 * damage for a minute — and said so only inside a Bonus Action nobody reading `Talons`
	 * would think to consult. A toggle that changes an attack belongs on that attack.
	 *
	 * Annotates every melee attack line with the gated effect and reduces the source to its
	 * activation. Requires the extra damage to parse; a reach change alone is left in prose,
	 * because reach without a number is not something an attack line can state.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _annotateToggledAttackRiders (out) {
		const melee = (out.action || []).filter(it => (it.entries || []).some(line => typeof line === "string" && /\{@atk (?:mw|ms)\b/.test(line)));
		if (!melee.length) return;

		["bonus", "action"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				if (!body || /\{@atk /.test(body)) return;
				if (!/\bfor (?:the duration|1 minute|\d+ minutes?)\b/i.test(body)) return;

				const dmg = /(?:its|your) melee attacks? (?:deal|deals) an extra (\{@damage [^}]+\}) (\w+) damage/i.exec(body);
				if (!dmg) return;
				const reach = /reach a target up to (\d+) feet away/i.exec(body);

				const rawName = String(entry.name || "");
				const toggle = (rawName.includes("—") ? rawName.split("—").pop() : rawName).replace(/\s*\([^)]*\)\s*$/, "").trim();
				if (!toggle) return;

				const rider = [reach ? `reach ${reach[1]} ft.` : "", `plus ${dmg[1]} ${dmg[2].toLowerCase()} damage`]
					.filter(Boolean).join(" and ");
				melee.forEach(attack => {
					attack.entries = attack.entries.map(line => {
						if (typeof line !== "string" || !/\{@atk /.test(line)) return line;
						if (line.includes(toggle)) return line;
						return `${line.replace(/\s+$/, "")} While ${toggle} is active, ${rider}.`;
					});
				});

				// The activation is all the source still has to say; the numbers now ride the
				// lines they modify, and the daily limit is already on the entry name.
				const activation = body.split(/(?<=\.)\s+/)[0];
				if (activation) entry.entries = [`${activation} Its melee attacks gain ${rider} for the duration.`];
			});
		});
	}

	/**
	 * A conditional to-hit bonus is a number a DM needs at the instant of rolling, and
	 * filed as its own trait it is a number they will not have. High Ground's +2 with
	 * ranged attacks was three entries away from the only ranged attack on the block.
	 *
	 * Writes the alternative straight onto the roll — `{@hit +6} to hit (+8 when standing
	 * 5 feet or more above an enemy)` — and drops the trait once every attack it could
	 * reach has been annotated. A gate too long to sit inside the line keeps its trait and
	 * is referenced by name, because an attack line is not the place for a paragraph.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _foldSituationalAttackBonuses (out) {
		const SECTIONS = ["action", "bonus", "reaction"];
		const lines = [];
		SECTIONS.forEach(section => (out[section] || []).forEach(entry => {
			(entry.entries || []).forEach((line, ix) => {
				if (typeof line === "string" && /\{@hit [+-]?\d+\}/.test(line)) lines.push({entry, ix});
			});
		}));
		if (!lines.length || !out.trait?.length) return;

		const dropped = new Set();
		out.trait.forEach(trait => {
			const body = (trait.entries || []).filter(it => typeof it === "string");
			const claim = body
				.map(it => /^(?:(?:when|while|whenever)\s+(.+?),\s*)?[^,.]{0,40}?\bgains? an? \+(\d+) bonus to (?:hit|attack rolls?)\b(.*)$/i
					.exec(this._getPlainMatchTextCased(it).trim()))
				.find(Boolean);
			if (!claim) return;
			const gate = String(claim[1] || "").trim().replace(/^(?:it|they|he|she) /i, "");
			const bonus = Number(claim[2]);
			if (!bonus) return;

			const scope = /\bwith ranged\b/i.test(claim[3]) ? "ranged"
				: /\bwith melee\b/i.test(claim[3]) ? "melee"
					: "any";
			// A gate the line cannot hold is referenced by name, and its trait survives to
			// state it in full.
			const inlinable = !!gate && gate.length <= 60;
			const qualifier = inlinable ? `when ${gate}` : `with ${this._getResilienceAttributionLabel(trait.name)}`;

			const inScope = lines.filter(({entry, ix}) => this._attackLineMatchesScope(entry.entries[ix], scope));
			let placed = 0;
			let missed = 0;
			inScope.forEach(({entry, ix}) => {
				const line = entry.entries[ix];
				if (line.includes(qualifier)) return void ++placed;
				const hit = /\{@hit ([+-]?\d+)\}(\s*to hit)/.exec(line);
				if (!hit) return void ++missed;
				const raised = this._toSignedStr(Number(hit[1]) + bonus);
				// A second conditional joins the first parenthetical rather than opening a
				// rival one — two asides in a row read as a typo.
				const existing = new RegExp(`${hit[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(([^)]*)\\)`).exec(line);
				entry.entries[ix] = existing
					? line.replace(existing[0], `${hit[0]} (${existing[1]}; ${raised} ${qualifier})`)
					: line.replace(hit[0], `${hit[0]} (${raised} ${qualifier})`);
				++placed;
			});

			// The trait is only redundant when the lines now carry the whole claim: every
			// attack in scope, and the condition itself. The trait is the only place a long
			// gate or an unreachable attack can still be read.
			if (placed && !missed && inlinable && body.length === 1) dropped.add(trait);
		});

		if (dropped.size) out.trait = out.trait.filter(it => !dropped.has(it));
	}

	/**
	 * Umbral Coating turns a weapon the NPC already carries into a shadow weapon, which
	 * unlocks Shadow Sneak and Shadowbite on it. Written as a paragraph three entries away
	 * from the sword, that is a conversion a DM has to reconstruct mid-turn.
	 *
	 * Mints the converted weapon as a real attack sitting next to its base — the same shape
	 * a statblock uses for any alternative attack form — and retires the paragraph and the
	 * "can instead convert …" cross-reference that stood in for it.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _mintCoatedWeaponAttacks (out) {
		const SECTIONS = ["trait", "action", "bonus", "reaction"];
		const coating = this._findWeaponCoatingClause(out, SECTIONS);
		if (!coating) return;

		const base = (out.action || []).find(it => this._normalizeFeatureKey(it?.name) === this._normalizeFeatureKey(coating.weaponName));
		const attackIx = (base?.entries || []).findIndex(it => typeof it === "string" && /\{@atk /.test(it));
		if (attackIx < 0) return;

		// The features a shadow weapon unlocks are the reason to convert at all, so they are
		// named on the line rather than left to be discovered.
		const unlocked = this._getCoatingUnlockedFeatureNames(out, SECTIONS, coating.adjective);
		const unlockedNote = unlocked.length ? ` (${unlocked.join(", ")})` : "";
		const thrown = coating.range ? ` or range ${coating.range} ft. (returns to its hand as a Bonus Action)` : "";

		const line = String(base.entries[attackIx])
			.replace(/(reach \d+ ft\.)(,?)/i, `$1${thrown}$2`)
			.replace(/\.\s*$/, "");
		const name = `${base.name} (${coating.label})`;
		if ((out.action || []).some(it => it?.name === name)) return;

		const entries = base.entries.map((it, ix) => (ix === attackIx
			? `${line}. Counts as a ${coating.adjective} weapon${unlockedNote}.`
			: it));
		out.action.splice(out.action.indexOf(base) + 1, 0, {name, entries});

		// The prose that described the conversion has been superseded by the attack.
		coating.drop();
		this._dropCoatingCrossReferences(out, SECTIONS, coating.weaponName);
	}

	/** Locates a "coat <weapon> in shadowstuff" clause and everything the attack needs from it. */
	static _findWeaponCoatingClause (out, sections) {
		let found = null;
		sections.forEach(section => (out[section] || []).forEach(entry => {
			(entry.entries || []).forEach((rawLine, ix) => {
				if (found || typeof rawLine !== "string") return;
				const tag = /\bcoat\s+(\{@item ([^|}]+)[^}]*\})/i.exec(rawLine);
				if (!tag) return;
				const plain = this._getPlainMatchTextCased(rawLine);
				const adjective = (/\bcounts as an?\s+([a-z]+)\s+weapon\b/i.exec(plain) || [])[1];
				if (!adjective) return;
				found = {
					weaponName: tag[2].trim(),
					adjective: adjective.toLowerCase(),
					range: (/\bthrown property \(range (\d+\/\d+)\)/i.exec(plain) || [])[1] || "",
					label: this._getSafeInlineText((/^\{@b ([^}]+?)\.\}/.exec(rawLine) || [])[1] || entry.name || "Coated", {maxLen: 40}),
					drop: () => { entry.entries = entry.entries.filter((_, i) => i !== ix); },
				};
			});
		}));
		return found;
	}

	/** Names of the entries that only trigger off a `<adjective> weapon` — the point of coating one. */
	static _getCoatingUnlockedFeatureNames (out, sections, adjective) {
		const names = [];
		// Only a rider that fires off a hit is unlocked by coating a weapon; a line that
		// merely mentions attacking with one (Shadowcasting's bonus-action attack) is not.
		const re = new RegExp(`\\bhit(?:s|ting)?\\b[^.]*\\bwith an?\\s+${adjective}\\s+weapon\\b`, "i");
		sections.forEach(section => (out[section] || []).forEach(entry => {
			(entry.entries || []).forEach(line => {
				if (typeof line !== "string" || !re.test(this._getPlainMatchTextCased(line))) return;
				// The list already sits inside parentheses, so a rider's own "(1/SR)" suffix
				// would nest a second pair — which the renderer reads as unbalanced.
				const label = String((/^\{@b ([^}]+?)\.\}/.exec(line) || [])[1] || entry.name || "")
					.replace(/\s*\([^)]*\)\s*$/, "");
				const safe = this._getSafeInlineText(label, {maxLen: 40});
				if (safe && !names.includes(safe)) names.push(safe);
			});
		}));
		return names;
	}

	/** Retires "it can instead convert <weapon> (see X)" once the converted attack exists. */
	static _dropCoatingCrossReferences (out, sections, weaponName) {
		const escaped = String(weaponName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`\\s*[^.]*\\bcan instead convert\\b[^.]*${escaped}[^.]*\\.`, "i");
		sections.forEach(section => (out[section] || []).forEach(entry => {
			entry.entries = (entry.entries || [])
				.map(it => (typeof it === "string" ? it.replace(re, "") : it))
				.filter(it => typeof it !== "string" || it.trim());
		}));
	}

	/** Whether an attack line is melee, ranged, or either — for scoped rider placement. */
	static _attackLineMatchesScope (line, scope) {
		if (scope === "any") return true;
		const tag = /\{@atk ([^}]+)\}/.exec(line)?.[1] || "";
		const kinds = tag.split(",").map(it => it.trim().toLowerCase());
		if (scope === "ranged") return kinds.some(it => it === "rw" || it === "rs");
		return kinds.some(it => it === "mw" || it === "ms");
	}

	/**
	 * `Improved Cunning Strike` says one thing — you may now use two effects instead of one —
	 * and `_foldImprovedEntriesIntoBase` will not take it, because it is not an addition to
	 * the base feature but an *edit* to the base feature's own count. Filed separately, the
	 * statblock states "add one of the following" and then contradicts itself an entry later.
	 *
	 * Applies the edit where the count is stated and drops the improvement, which is A0.3:
	 * a modifier on an anchor belongs at the anchor, and the dependent then has nothing left
	 * to say. Only fires when the improvement's whole body is the count claim.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _foldCountUpgradesIntoBase (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const WORDS = {one: "one", two: "two", three: "three", four: "four"};
		const dropped = new Set();

		sections.forEach(section => {
			(out[section] || []).forEach(entry => {
				const body = (entry.entries || []).filter(it => typeof it === "string");
				if (body.length !== 1) return;
				const claim = /^[^.]*?\bcan use up to (one|two|three|four|\d+) (.+?) effects\b[^.]*\.$/i.exec(body[0].trim());
				if (!claim) return;
				const count = WORDS[claim[1].toLowerCase()] || claim[1];
				const baseKey = this._normalizeFeatureKey(claim[2]);

				const base = sections
					.flatMap(sec => out[sec] || [])
					.find(it => it !== entry && this._normalizeFeatureKey(String(it?.name || "").replace(/\s*\([^)]*\)\s*$/, "")) === baseKey);
				if (!base?.entries?.length) return;

				let applied = false;
				base.entries = base.entries.map(line => {
					if (applied || typeof line !== "string") return line;
					const next = line.replace(/\b(add|use) one of the following\b/i, (_, verb) => `${verb} up to ${count} of the following`);
					if (next === line) return line;
					applied = true;
					return next;
				});
				if (applied) dropped.add(entry);
			});
		});
		if (!dropped.size) return;

		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(entry => !dropped.has(entry));
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	static _splitFormBlocksIntoAlternateForm (out) {
		const CONNECTOR = /^(?:while (?:it is |you are )?(?:transformed|in this form)|in this form)[^.:]{0,60}[:.]?$/i;
		["bonus", "action", "trait"].forEach(section => {
			const entries = out[section];
			if (!entries?.length) return;
			const added = [];

			entries.forEach(entry => {
				const lines = entry?.entries;
				if (!Array.isArray(lines) || lines.length < 4) return;
				if (!lines.every(it => typeof it === "string")) return;
				const at = lines.findIndex(line => CONNECTOR.test(line.replace(/\s+/g, " ").trim()));
				if (at < 1 || at === lines.length - 1) return;
				const rest = lines.slice(at + 1);
				if (rest.filter(line => /^\{@b [^}]+\.\}/.test(line.trim())).length < 2) return;

				const formName = this._getFormTraitName(entry.name);
				if (!formName) return;
				entry.entries = lines.slice(0, at);
				added.push({name: formName, entries: rest});
			});

			if (added.length) (out.trait = out.trait || []).push(...added);
		});
	}

	/** "Hybrid Transformation (2/SR)" → "Hybrid Form"; "Angelic Avatar (1/LR)" → "Angelic Avatar Form". */
	static _getFormTraitName (rawName) {
		const bare = this._getAnchorBareName(rawName).trim();
		if (!bare) return "";
		const stem = bare.replace(/\s*\b(?:transformation|form)\b\s*$/i, "").trim();
		return stem ? `${stem} Form` : "";
	}

	/**
	 * Nessa's Metamagic roster sat among the traits with nothing connecting it to the spells
	 * it modifies, so casting a spell meant remembering that a trait five entries away might
	 * change it. State the connection where the spells are.
	 *
	 * Innate blocks are excluded: Metamagic applies to the class's spellcasting, and an
	 * innate list is a different feature with a different ability.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _linkSpellModifiersFromSpellcasting (out) {
		if (!out.spellcasting?.length) return;
		const roster = ["trait", "action", "bonus", "reaction"]
			.flatMap(section => out[section] || [])
			.find(entry => /^metamagic$/i.test(String(entry?.name || "").trim()));
		if (!roster) return;

		const block = out.spellcasting.find(sc => !/innate/i.test(String(sc?.name || "")));
		if (!block?.headerEntries?.length) return;
		const last = block.headerEntries.length - 1;
		if (typeof block.headerEntries[last] !== "string") return;
		if (/metamagic/i.test(block.headerEntries.join(" "))) return;
		block.headerEntries[last] += " It can alter these spells with Metamagic (see its Metamagic trait for the options and their costs).";
	}

	/**
	 * Reggu's Radiant Sun Bolt line ended with 150 characters restating the Attack action in
	 * order to say one thing: it costs a Focus Point to make the attack twice as a Bonus
	 * Action. At the table that is a cost and a count, not a paragraph.
	 *
	 * Only rewrites when both the cost and the repeat count are recoverable from the
	 * sentence; anything else keeps its prose, because a half-parsed cost is worse than a
	 * long one.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _foldAttackActionTrailers (out) {
		const TRAILER = /\s*When (?:it|[A-Z][\w'’-]*) takes the \{@action Attack[^}]*\} action[^.]*?, (?:it|[A-Z][\w'’-]*) can spend (\d+) ([A-Za-z ]+?) to (?:make|use) (?:the|this) (?:special )?attack (twice|two times) as a (?:bonus action|\{@variantrule Bonus Action[^}]*\})\.\s*/i;
		(out.action || []).forEach(entry => {
			const lines = entry.entries || [];
			const next = [];
			lines.forEach(line => {
				if (typeof line !== "string") return void next.push(line);
				const match = TRAILER.exec(line);
				if (!match) return void next.push(line);
				const [, cost, resource] = match;
				const unit = this._getSafeInlineText(resource.trim(), {maxLen: 30});
				if (!unit) return void next.push(line);
				const stripped = `${line.slice(0, match.index)}${line.slice(match.index + match[0].length)}`.replace(/\s{2,}/g, " ").trim();
				const folded = `As part of the Attack action, ${cost} ${unit}: make this attack twice as a Bonus Action.`;
				// The clause belongs on the attack line, not in a paragraph beneath it — even
				// when the sheet filed it as its own entry.
				const prev = next.length ? next[next.length - 1] : null;
				if (!stripped && typeof prev === "string") next[next.length - 1] = `${prev} ${folded}`.replace(/\s{2,}/g, " ");
				else next.push(`${stripped ? `${stripped} ` : ""}${folded}`.replace(/\s{2,}/g, " "));
			});
			entry.entries = next;
		});
	}

	static _dropFlavourLeadSentences (out) {
		const MECHANICAL = /\b(?:advantage|disadvantage|saving throw|save|damage|hit points?|action|reaction|resistan|immun|condition|DC|proficiency|attack|speed|spell|feet|foot|rest|round|turn|AC|Armor Class|temporary|minutes?|hours?|days?|weeks?|months?|years?|miles?|yards?)\b/i;

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const lines = entry?.entries;
				if (!Array.isArray(lines) || !lines.length) return;
				const first = lines[0];
				if (typeof first !== "string") return;

				const m = /^([^.{}]{15,160}\.)(\s+)(?=[A-Z{])/.exec(first);
				const lead = m?.[1];
				// A lead that is the entire first line is only droppable when another line
				// follows it; otherwise the entry would be left empty.
				const remainder = m ? first.slice(m[0].length) : "";
				if (!lead) return;
				if (!remainder && lines.length < 2) return;
				if (/\d/.test(lead) || MECHANICAL.test(lead)) return;

				// The decisive test: a lead is only scene-setting if nothing after it leans
				// on a noun it introduced. Vern's clear spindle says "requires no food or
				// drink" and the next sentence is the penalty *for that*, so it stays.
				const STOP = new Set(["that", "this", "with", "from", "into", "when", "while", "which", "their", "them", "they", "then", "than", "such", "also", "have", "having", "make", "makes", "made", "your", "yours", "itself", "other", "others", "only", "once", "upon", "over", "under", "gains", "gain", "uses", "use", "used", "using"]);
				const wordsOf = str => new Set(String(str)
					.toLowerCase()
					.replace(/\{@[a-z]+ |[|}]/g, " ")
					.match(/[a-z]{4,}/g)
					?.filter(it => !STOP.has(it)) || []);
				const tail = [remainder, ...lines.slice(1).filter(it => typeof it === "string")].join(" ");
				const tailWords = wordsOf(tail);
				if ([...wordsOf(lead)].some(it => tailWords.has(it))) return;
				// "To do so, it uses a bonus action…" points back at the sentence it follows.
				if (/^(?:to do so|doing so|in doing so|to use (?:it|this)|it does so)\b/i.test(tail.trim())) return;

				if (remainder) lines[0] = remainder;
				else lines.shift();
			});
		});
	}

	/**
	 * Traits arrive in whatever order the sheet stored the features, so Wisp's block puts
	 * nineteen entries on the page with always-on defences interleaved between triggered
	 * effects and option rosters. A DM scanning the block mid-turn needs the standing
	 * facts first and the reference lists last.
	 *
	 * Sort into four bands — standing passives, resource pools, triggered effects,
	 * rosters — with a stable sort so entries inside a band keep the order they were
	 * assembled in.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _orderTraitsForReading (out) {
		const traits = out.trait;
		if (!Array.isArray(traits) || traits.length < 4) return;

		const ROSTERS = /^(?:additional effects|special equipment|combat methods|maneuvers|divine favor|blood curses|class resources|invocations|metamagic)\b/i;
		const TRIGGER = /\b(?:when|whenever|if|while|as a bonus action|as an action|as a reaction|in response)\b/i;

		const rank = entry => {
			const name = String(entry?.name || "");
			if (ROSTERS.test(name)) return 3;
			const body = (entry?.entries || []).filter(it => typeof it === "string").join(" ");
			if (/\(\d+\/[^)]*\)\s*$/.test(name)) return 1;
			return TRIGGER.test(body) ? 2 : 0;
		};

		out.trait = traits
			.map((entry, idx) => ({entry, idx, rank: rank(entry)}))
			.sort((a, b) => a.rank - b.rank || a.idx - b.idx)
			.map(it => it.entry);
	}

	/**
	 * Subclasses that offer a menu print one labelled sub-block per option, and when the
	 * options differ by a single word — Crimson Rite's six rites are the same sentence
	 * with the damage type swapped — the block spends a thousand characters saying one
	 * thing six times.
	 *
	 * Detect a run of parallel sub-blocks by shape rather than by name: shared opening,
	 * shared ending, one short varying middle each. Rewrite the shared sentence once with
	 * the options folded in, so the menu still lists every choice but reads as a line.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _collapseParallelOptionLists (out) {
		const commonPrefix = (arr) => {
			let n = 0;
			while (n < arr[0].length && arr.every(it => it[n] === arr[0][n])) n++;
			return arr[0].slice(0, n);
		};
		const commonSuffix = (arr) => {
			let n = 0;
			while (n < arr[0].length && arr.every(it => it.length > n && it[it.length - 1 - n] === arr[0][arr[0].length - 1 - n])) n++;
			return n ? arr[0].slice(arr[0].length - n) : "";
		};

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries) || entry.entries.length < 4) return;

				const parsed = entry.entries.map(line => (typeof line === "string" ? /^\{@b ([^{}]+?)\.\}\s*(.+)$/.exec(line) : null));
				const rebuilt = [];
				for (let i = 0; i < entry.entries.length; ++i) {
					let j = i;
					while (j < entry.entries.length && parsed[j]) j++;
					const run = parsed.slice(i, j);
					if (run.length < 3) {
						rebuilt.push(entry.entries[i]);
						continue;
					}

					const bodies = run.map(m => m[2]);
					let pre = commonPrefix(bodies);
					let suf = commonSuffix(bodies);
					// Snap to word boundaries so the template reads as English.
					pre = pre.replace(/\S*$/, "");
					suf = suf.replace(/^\S*/, "");
					const middles = bodies.map(b => b.slice(pre.length, b.length - suf.length).trim());
					const shared = pre.length + suf.length;
					const isParallel = shared >= 25
						&& middles.every(mid => mid && mid.length <= 40 && !/[.;]/.test(mid))
						&& new Set(middles).size === middles.length
						&& shared >= 0.4 * Math.min(...bodies.map(b => b.length));
					if (!isParallel) {
						for (let k = i; k < j; ++k) rebuilt.push(entry.entries[k]);
						i = j - 1;
						continue;
					}

					const list = run.map((m, idx) => `${middles[idx]} (${m[1].trim()})`);
					const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")}, or ${list[list.length - 1]}` : list[0];
					rebuilt.push(`${pre}${joined}${suf}`.replace(/\s{2,}/g, " ").trim());
					i = j - 1;
				}
				if (rebuilt.length !== entry.entries.length) entry.entries = rebuilt;
			});
		});
	}

	/**
	 * A subclass improvement usually *replaces* a base-class number rather than adding to
	 * it, but both sentences travel together into the export: Tignor's Wild Shape states
	 * Temporary Hit Points "equal to its Druid level (10)" and then "equal to three times
	 * its Druid level (30)", and caps the form's Challenge Rating at both 1 and 3. A
	 * statblock that gives two different answers to the same question is worse than one
	 * that gives none.
	 *
	 * Keep the highest value for each claimed quantity and remove the rest — dropping the
	 * sentence when the claim is the whole sentence, and rewriting the number in place
	 * when it is one item in a list that carries other facts.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropSupersededQuantityClaims (out) {
		const CLAIMS = [
			{key: "tempHp", mode: "sentence", re: /Temporary Hit Points equal to [^.]{0,80}?\((\d+)\)/i},
			{key: "maxCr", mode: "value", re: /\bMax CR (\d+)\b/i},
			{key: "maxCr", mode: "sentence", re: /maximum Challenge Rating[^.]{0,90}?\((\d+)\)/i},
		];

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries) || entry.entries.length < 2) return;

				const found = new Map();
				entry.entries.forEach((line, idx) => {
					if (typeof line !== "string") return;
					CLAIMS.forEach(claim => {
						const m = line.match(claim.re);
						if (!m) return;
						if (!found.has(claim.key)) found.set(claim.key, []);
						found.get(claim.key).push({idx, value: Number(m[1]), claim, match: m[0]});
					});
				});

				const drop = new Set();
				found.forEach(hits => {
					if (hits.length < 2) return;
					const best = Math.max(...hits.map(it => it.value));
					hits.forEach(hit => {
						if (hit.claim.mode === "value") {
							// A compact "Max CR 3" list item carries other facts on its line,
							// so it is never dropped — only corrected.
							if (hit.value !== best) entry.entries[hit.idx] = entry.entries[hit.idx].replace(hit.match, hit.match.replace(String(hit.value), String(best)));
							return;
						}
						// A prose sentence is dropped when it is superseded *or* when it
						// merely restates a value the compact list already gives.
						if (hit.value !== best || hits.some(it => it.claim.mode === "value" && Math.max(it.value, best) === best)) drop.add(hit.idx);
					});
				});

				if (drop.size) entry.entries = entry.entries.filter((_it, idx) => !drop.has(idx));
			});
		});
	}

	/**
	 * A Battle Master knows seven-plus maneuvers, and each one arrives as its own full
	 * trait/bonus/reaction. Spread across three sections they read as seven unrelated
	 * abilities that happen to share a resource, and the shared resource — the thing that
	 * actually constrains how many can be used — is stated fourteen times inside the
	 * bodies and nowhere as a budget.
	 *
	 * Collapse them into one roster the way the Combat Methods block already does: the
	 * pool and save DC stated once in a lead sentence, then one labelled clause per
	 * maneuver carrying its action economy. Membership comes from the optional-feature
	 * type (`MV:B`), not from prose sniffing, so a homebrew maneuver is picked up and a
	 * similarly-worded class feature is not.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character sheet state
	 * @param {Object} calculations `getFeatureCalculations()` output
	 */
	static _consolidateManeuverEntries (out, state, calculations = {}, {npcName = "The NPC"} = {}) {
		const names = new Map();
		(state.getFeatures?.() || []).forEach(feature => {
			if (!(feature?.optionalFeatureTypes || []).includes("MV:B")) return;
			const key = this._normalizeFeatureKey(feature?.name);
			if (key) names.set(key, feature);
		});
		if (names.size < 2) return;

		const collected = [];
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const bare = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "");
				const feature = names.get(this._normalizeFeatureKey(bare));
				if (!feature) return true;
				collected.push({section, name: bare, feature, entries: entry.entries || []});
				return false;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
		if (collected.length < 2) return;

		const die = String(calculations.superiorityDie || "").replace(/^1/, "");
		const count = Number(calculations.superiorityDiceCount) || 0;
		const dc = Number(calculations.maneuverSaveDc) || 0;

		const pool = [count ? `${count} Superiority Dice` : "Superiority Dice", die ? `(${die})` : ""].filter(Boolean).join(" ");

		const bodies = [];
		let damageRiderCount = 0;
		collected
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach(({section, name, feature, entries: body}) => {
				const text = body.filter(it => typeof it === "string").join(" ");
				if (!text) return;
				// The die is stated in the lead; repeating it inside every clause is the
				// noise this consolidation exists to remove.
				let compact = text
					.replace(/\s*\((?:1?d\d+)\)/g, "")
					// The cost is stated once in the lead, so every "expend one Superiority
					// Die" is a restatement — but the sentence it sits in still has to
					// survive as grammatical English.
					.replace(/,?\s*it can expend one Superiority Die,? (?:to|and) /gi, ", it can ")
					.replace(/\s*and expend one Superiority Die\b/gi, "")
					.replace(/\bexpend one Superiority Die,\s*roll that die,\s*and add it to\b/gi, "roll the die and add it to");
				// Only when the rider is a whole sentence — in Feinting Attack it is the tail
				// of "If that attack hits, add the Superiority Die…", and cutting it there
				// leaves a dangling conditional.
				let withoutRider = compact.replace(/(^|\.\s+)Add the Superiority Die(?: roll)? to the attack['’]?s damage roll\.\s*/g, "$1");
				// Riposte states the same rule again as its own closing sentence. The body has
				// been rewritten to third person by now but not yet de-imperativised, so both
				// "add" and "it adds" have to be accepted.
				withoutRider = withoutRider.replace(/(^|\.\s+)If (?:it hits|you hit), (?:it adds |add )the Superiority Die to the attack['’]?s damage(?: roll)?\.\s*/gi, "$1");
				// Trip Attack states it mid-sentence, carrying the on-hit trigger the clause
				// that follows depends on — so the rider goes and the trigger is joined to it.
				withoutRider = withoutRider.replace(/,? (?:it can |you can )?add the die to the attack['’]?s damage roll\.\s+If /gi, ", if ");
				if (withoutRider !== compact) {
					damageRiderCount++;
					compact = withoutRider;
				}
				compact = compact.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
				const label = this._getManeuverActionLabel(section, compact);
				const labelMark = this._getEconomyMark(label);
				compact = this._condenseRosterClause(compact);
				const lead = this._getFeatureHoverTag(feature) || name;
				// "Replaces One Attack" / "Triggered" / "Special" have no glyph and stay prose.
				bodies.push(labelMark
					? `{@b ${lead}${labelMark}.} ${compact}`
					: `{@b ${lead} (${label}).} ${compact}`);
			});

		if (bodies.length < 2) return;

		const lead = [
			`${npcName} has ${pool}, regained on a Short or Long Rest. Each maneuver below costs one die.`,
			damageRiderCount >= 2 ? " Unless noted otherwise, a maneuver that hits adds the die to that attack's damage roll." : "",
			dc ? ` Maneuver save {@dc ${dc}}.` : "",
		].join("");

		out.trait = out.trait || [];
		out.trait.push({name: "Maneuvers", entries: [lead, ...bodies]});

		this._dropPoolFromClassResources(out, "Superiority Dice");
	}

	/**
	 * A maneuver's action economy is not stated in its own text — it is implied by which
	 * section the sheet filed it under. The one exception is a maneuver that replaces an
	 * attack (Commander's Strike), which the sheet files as a reaction because it has a
	 * trigger, but which a DM must read as part of the Attack action or they will spend a
	 * reaction they do not have to.
	 *
	 * @param {string} section section the entry was collected from
	 * @param {string} text maneuver body
	 * @returns {string} display label
	 */
	static _getManeuverActionLabel (section, text) {
		if (/\breplace one of (?:its|your|their) attacks\b/i.test(text)) return "Replaces One Attack";
		if (section === "bonus") return "Bonus Action";
		if (section === "reaction") return "Reaction";
		if (section === "action") return "Action";
		return /^\s*(?:When|If|Whenever)\b/i.test(text) ? "Triggered" : "Special";
	}

	/**
	 * Once a pool's budget is stated in the block that spends it, the Class Resources
	 * summary line is a second, weaker statement of the same fact.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {string} poolName pool to remove
	 */
	static _dropPoolFromClassResources (out, poolName) {
		const entry = (out.trait || []).find(it => it?.name === "Class Resources");
		if (!entry?.entries?.length) return;

		const re = new RegExp(`\\s*${poolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^;.]*[;.]`, "i");
		entry.entries = entry.entries
			.map(it => (typeof it === "string" ? it.replace(re, "").replace(/:\s*\.?$/, ".").replace(/\s{2,}/g, " ").trim() : it))
			.filter(it => (typeof it === "string" ? !/limited-use pools:?\.?$/i.test(it) && it.trim() : it));

		if (!entry.entries.length) out.trait = out.trait.filter(it => it !== entry);
	}

	/**
	 * A character of any depth accumulates a scatter of one-line standing defences —
	 * advantage on saves against being frightened, against spells, to keep concentration
	 * — each occupying a whole trait for a single clause. Read as a statblock they are
	 * noise the DM has to re-scan every round.
	 *
	 * Merge them into one leading `Resilience` trait, keeping each contributing feature
	 * named in parentheses so nothing becomes unattributable. Only single-clause standing
	 * benefits qualify; anything with its own action economy, dice, gate or second
	 * sentence keeps its full trait.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _mergeResilienceTraits (out, {npcName = "The NPC"} = {}) {
		if (!out.trait?.length) return;

		this._liftDefenseBulletsFromAdditionalEffects(out, npcName);

		const merged = [];
		const kept = [];

		out.trait.forEach(entry => {
			const single = this._getStandingDefenseClause(entry, npcName);
			const clauses = single ? [single] : this._extractStandingDefenseResidue(entry, npcName, kept);
			if (!clauses.length) return void kept.push(entry);
			clauses.forEach(clause => merged.push({
				clause,
				sig: this._getDefenseClauseSignature(clause),
				label: this._getResilienceAttributionLabel(entry.name),
				kind: this._getDefenseClauseKind(clause),
				conditions: this._getDefenseClauseConditions(clause),
			}));
		});

		// Two sources granting the same defence contribute one clause. The more specific
		// wording wins: "advantage on saves against spells" is subsumed by "…against
		// spells and other magical effects".
		const distinct = merged.filter((it, ix) => !merged.some((other, oix) => oix !== ix
			&& other.sig
			&& it.sig
			&& other.sig.startsWith(it.sig)
			&& (other.sig.length > it.sig.length || oix < ix)))
			// Prefix matching cannot see that "advantage on saving throws against being
			// frightened" is wholly contained in "advantage on saving throws to resist
			// being charmed or frightened" — different wording, same defence, larger set.
			.filter((it, ix, arr) => !arr.some((other, oix) => oix !== ix
				&& other.kind
				&& other.kind === it.kind
				&& it.conditions.length
				&& other.conditions.length > it.conditions.length
				&& it.conditions.every(c => other.conditions.includes(c))));

		// Even one standing claim belongs in the pinned list rather than adrift among the
		// narrative traits — a DM reads every roll modifier in one place, always first.
		if (!distinct.length) return;

		const text = distinct
			.map(it => {
				// Sentence case belongs to the merged trait, not to each clause.
				const clause = it.clause.replace(/^([A-Z])(?=[a-z])/, m => m.toLowerCase());
				return it.label ? `${clause} (${it.label})` : clause;
			})
			.join("; ");

		// A second, later run of this pass finds claims that were still in first person or
		// still carried a level preamble the first time round. Those append to the existing
		// list rather than minting a rival trait.
		const prior = kept.find(it => /^resilience$/i.test(String(it?.name || "")));
		const priorText = prior ? String(prior.entries?.[0] || "").replace(/\.$/, "") : "";
		const body = priorText ? `${priorText}; ${text.replace(/^([A-Z])(?=[a-z])/, m => m.toLowerCase())}` : text;

		out.trait = [
			{name: "Resilience", entries: [`${body.charAt(0).toUpperCase()}${body.slice(1)}.`]},
			...kept.filter(it => it !== prior),
		];
	}

	/**
	 * A trait that opens with a standing modifier and then goes on to something else —
	 * Stable Footing's advantage against being knocked prone, followed by a fall-damage
	 * rule — must be split rather than swallowed whole. The roll clause joins the merged
	 * list; the remainder stays as a (shorter) trait so no mechanic is lost.
	 *
	 * @param {Object} entry candidate trait
	 * @param {string} npcName
	 * @param {Array} kept accumulator the shortened remainder is pushed onto
	 * @returns {Array<string>} the extracted clauses, empty when the trait does not split
	 */
	static _extractStandingDefenseResidue (entry, npcName, kept) {
		const strings = (entry?.entries || []).filter(it => typeof it === "string");
		if (!strings.length || strings.length !== (entry?.entries || []).length) return [];
		if (/^resilience$/i.test(String(entry?.name || ""))) return [];

		const sentences = strings[0].split(/(?<=[.!?])\s+/).map(it => it.trim()).filter(Boolean);
		if (sentences.length < 2) return [];

		// Only a leading run of claims is taken. A defence stated after other prose is
		// usually a qualification of that prose, and tearing it out would leave the
		// remainder referring to something that is no longer there.
		const clauses = [];
		let ix = 0;
		for (; ix < sentences.length; ++ix) {
			const clause = this._getStandingDefenseClause({name: entry.name, entries: [sentences[ix]]}, npcName);
			if (!clause) break;
			clauses.push(clause);
		}
		if (!clauses.length) return [];

		const remainder = [sentences.slice(ix).join(" "), ...strings.slice(1)].filter(Boolean);
		if (!remainder.length) return clauses;
		kept.push({...entry, entries: remainder});
		return clauses;
	}

	/**
	 * Two sources can state the same defence in opposite word order — an item says
	 * "Resistance to damage from spells", the sheet's own defence list says "resistance
	 * to spell damage". Canonicalising the phrasing lets the subsumption filter see that
	 * they are one claim rather than printing both.
	 */
	static _getDefenseClauseSignature (clause) {
		return this._getEntryBodySignature(String(clause || "")
			.replace(/\bdamage from (\w+)s\b/gi, "$1 damage")
			.replace(/\bto being (\w+)\b/gi, "to $1"));
	}

	/**
	 * Standing defences granted by feats and custom modifiers arrive as bullets inside
	 * `Additional Effects` rather than as their own trait, so the Resilience merge never
	 * sees them — and the block ends up stating the same advantage twice, once as a trait
	 * and once as a bullet. Lifting them makes both halves of the duplicate visible to the
	 * same de-duplication pass, and puts every defence in one place for the reader.
	 *
	 * @param {Object} out statblock (mutated)
	 * @param {string} npcName
	 */
	static _liftDefenseBulletsFromAdditionalEffects (out, npcName) {
		const host = (out.trait || []).find(it => /^additional effects$/i.test(String(it?.name || "")));
		if (!Array.isArray(host?.entries)) return;

		const keptBullets = [];
		const lifted = [];
		host.entries.forEach(line => {
			if (typeof line !== "string") return void keptBullets.push(line);
			// Compaction welds a bulleted list into one string, so the split has to happen
			// here or every bullet after the first is invisible to this pass.
			const bullets = line.split(/\s*(?=•)/).map(it => it.trim()).filter(Boolean);
			const survivors = [];
			bullets.forEach(bullet => {
				const hit = /^[•\-\s]*\{@b ([^}]+?)\.?\}\s*(.+)$/.exec(bullet);
				if (!hit) return void survivors.push(bullet);
				// A bullet states the benefit as a bare noun phrase ("Advantage on saving
				// throws…"); the clause detector expects a sentence with a subject.
				const body = hit[2].trim();
				const normalized = /^(?:advantage|resistance|immunity|immune)\b/i.test(body)
					? `It gains ${body.charAt(0).toLowerCase()}${body.slice(1)}`
					: body;
				const candidate = {name: hit[1].trim(), entries: [normalized]};
				if (!this._getStandingDefenseClause(candidate, npcName)) return void survivors.push(bullet);
				lifted.push(candidate);
			});
			if (survivors.length) keptBullets.push(survivors.join(" "));
		});

		if (!lifted.length) return;
		host.entries = keptBullets;
		if (!keptBullets.length) out.trait = out.trait.filter(it => it !== host);
		out.trait.push(...lifted);
	}

	/** Which kind of standing defence a clause states, for subsumption comparisons. */
	static _getDefenseClauseKind (clause) {
		const text = this._getPlainMatchText(clause);
		if (/\bimmun/.test(text)) return "immunity";
		if (/\bresistance to\b/.test(text)) return "resistance";
		if (/\badvantage on\b[^.]*\bsaving throws?\b/.test(text)) return "save-advantage";
		if (/\badvantage on\b/.test(text)) return "advantage";
		return "";
	}

	/** Sorted condition names a defence clause covers, for subset comparisons. */
	static _getDefenseClauseConditions (clause) {
		const text = this._getPlainMatchText(clause);
		const CONDITIONS = "blinded|charmed|deafened|exhaustion|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious";
		return [...new Set([...text.matchAll(new RegExp(`\\b(${CONDITIONS})\\b`, "g"))].map(m => m[1]))].sort();
	}

	/** `Robe of the Archmagi — Magic Resistance` reads as `Magic Resistance` in a list. */
	static _getResilienceAttributionLabel (name) {
		// The attribution sits inside parentheses, so a name that already carries a use
		// annotation ("Stronghold Builder (1/LR)") would nest a second pair inside the first.
		const raw = String(name || "").trim().replace(/\s*\([^()]*\)\s*$/, "").trim();
		if (/^other defenses$/i.test(raw)) return "";
		const parts = raw.split(/\s+[—–-]\s+/);
		return parts[parts.length - 1] || raw;
	}

	/**
	 * The single standing-defence clause a trait states, or `""` when the trait carries
	 * anything else. @see _mergeResilienceTraits
	 */
	static _getStandingDefenseClause (entry, npcName) {
		const strings = (entry?.entries || []).filter(it => typeof it === "string");
		if (strings.length !== (entry?.entries || []).length || strings.length !== 1) return "";
		if (/^resilience$/i.test(String(entry?.name || ""))) return "";

		const body = strings[0].trim();
		if (body.split(/(?<=[.!?])\s+/).filter(it => it.trim()).length !== 1) return "";
		// Dice, DCs, action economy and gates are mechanics a flat list cannot carry.
		if (/\{@(?:dc|damage|atk|hit|recharge|scaledamage|spell)\b/.test(body)) return "";
		if (/\b(?:bonus action|reaction|as an action|magic action|spell slot|per turn|until|when it|if it)\b/i.test(body)) return "";

		const subject = String(npcName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// A claim may open with a gate ("While holding the rod, …") or bury the subject
		// behind flavour ("Its instincts are so honed that it has …"); both still state one
		// standing modifier, and the gate is carried into the merged clause so nothing about
		// when it applies is lost.
		const gate = /^(While\s[^,]{3,60}),\s+(.+)$/i.exec(body);
		const rest = (gate ? gate[2] : body).trim();
		const re = new RegExp(`^(?:${subject}|it|they|he|she)\\s+(?:also\\s+)?(?:has|have|gains?|doesn't have|does not have)\\s+(.+?)\\.?$`, "i");
		// The flavour strip is a fallback only. Applied first it would eat the relative
		// clause out of "…saving throws that it makes to maintain Concentration".
		const clause = re.exec(rest)?.[1] ??
			re.exec(rest.replace(/^[^.]*?\bthat\s+(?=(?:it|they|he|she)\s)/i, ""))?.[1];
		// A defence is often stated from the attacker's side — "Spell attack rolls against
		// it have Disadvantage" — which never names the NPC as the subject. That is the
		// same kind of standing roll modifier and belongs in the same pinned list.
		if (!clause) {
			const inverted = new RegExp(`^(.+?\\brolls?)\\s+(?:made\\s+)?against\\s+(?:${subject}|it|them|him|her)\\s+(?:have|has|are made with)\\s+(advantage|disadvantage)\\b`, "i")
				.exec(this._getPlainMatchText(rest));
			if (!inverted) return "";
			const inv = `${inverted[2].toLowerCase()} on ${inverted[1].toLowerCase()} against it`;
			return gate ? `${inv} ${gate[1].toLowerCase()}` : inv;
		}

		// Only standing modifiers merge — a benefit with its own decision belongs to its
		// own feature.
		if (!/\b(?:advantage|disadvantage|resistance|immunity|immune|resistant)\b/i.test(clause)) return "";
		if (!/\b(?:saving throws?|saves?|damage|condition|being|to the|checks?|initiative)\b/i.test(clause)) return "";
		return gate ? `${clause.trim().replace(/\.$/, "")} ${gate[1].toLowerCase()}` : clause.trim();
	}

	/**
	 * "a physical weapon it is holding" is a question the statblock can already answer.
	 * A DM running the NPC should not have to cross-reference the inventory to learn
	 * which weapon Umbral Coating or a similar feature applies to, so an unresolved
	 * held-weapon reference is replaced by the equipped weapon's name.
	 *
	 * Only rewrites when the answer is unambiguous — with two or more equipped weapons
	 * the generic phrasing is genuinely correct and is left alone.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character sheet state
	 */
	static _resolveHeldWeaponReferences (out, state) {
		const weapons = (state.getItems?.() || [])
			.filter(it => it?.equipped && String(it.type || "").toLowerCase() === "weapon")
			.map(it => this._getItemTag(it))
			.filter(Boolean);
		if (weapons.length !== 1) return;

		const tag = weapons[0];
		const re = /\ba (?:physical |melee |nonmagical )?weapon (?:it|they|he|she) (?:is|are) (?:already )?(?:holding|wielding)\b/gi;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				entry.entries = (entry.entries || []).map(it => (typeof it === "string" ? it.replace(re, tag) : it));
			});
		});
	}

	/**
	 * The Combat Methods roster inlines each stance's full body so its effects are not
	 * name-only — but a stance that also reaches the block as its own ability then prints
	 * twice, verbatim. The roster keeps the one-line `{@combatmethod}` index and the body
	 * lives in exactly one place: the stance's own entry, where a DM looks for it.
	 *
	 * The inline body is kept whenever no standalone entry exists, so nothing is lost.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropDuplicatedStanceBodies (out) {
		const methods = (out.trait || []).find(it => /^combat methods$/i.test(String(it?.name || "")));
		if (!methods?.entries?.length) return;

		const standalone = new Set();
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (entry === methods) return;
				const key = this._normalizeFeatureKey(entry?.name);
				if (key) standalone.add(key);
			});
		});
		if (!standalone.size) return;

		methods.entries = methods.entries.filter(line => {
			if (typeof line !== "string") return true;
			const label = /^\{@b (?:\{@combatmethod ([^|}]+)[^}]*\}|([^}]+?))\s*\(Stance\)\.\}/.exec(line);
			const name = label?.[1] || label?.[2];
			return !name || !standalone.has(this._normalizeFeatureKey(name));
		});
	}

	/**
	 * A feat that grants several benefits arrives as one paragraph filed under a single
	 * action type — Shield Master is a bonus action, a passive AC benefit *and* a
	 * reaction, all under `bonus`. A DM reading the reaction section would never find
	 * it. Split the sentences by their own stated activation and file each where it
	 * belongs, keeping the un-activated sentences (the gate, the passive benefit) with
	 * the original entry.
	 *
	 * Only entries that state two or more distinct activations are split: a feature
	 * with one activation plus explanatory prose is already filed correctly.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _splitMultiBenefitEntries (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			const keep = [];
			out[section].forEach(entry => {
				// An item property is one ability with one activation; its later sentences
				// describe the effect, not a second economy. Splitting produced two entries
				// with the same name, and the cross-section dedupe then deleted one half.
				const moved = /\u2014/.test(String(entry?.name || ""))
					? []
					: this._extractForeignActivations(entry, section);
				keep.push(entry);
				moved.forEach(({section: target, entries}) => {
					out[target] = out[target] || [];
					out[target].push({name: entry.name, entries});
				});
			});
			out[section] = keep.filter(entry => entry?.entries?.length);
		});
	}

	/**
	 * A limited-use pool whose label names a spell already printed in a spellcasting
	 * block is pure restatement — "Divine Favor: Command 1/long rest" says nothing the
	 * `daily: {"1": [Command …]}` line does not. Prune those rows, and drop the trait
	 * outright once nothing survives.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropResourcesCoveredBySpellcasting (out) {
		const idx = (out.trait || []).findIndex(it => /^class resources$/i.test(String(it?.name || "")));
		if (!~idx) return;

		const spellNames = new Set();
		const collect = (value) => {
			if (!value) return;
			if (typeof value === "string") {
				const re = /\{@spell ([^|}]+)/g;
				let m;
				while ((m = re.exec(value))) spellNames.add(this._normalizeFeatureKey(m[1]));
				return;
			}
			if (Array.isArray(value)) return value.forEach(collect);
			if (typeof value === "object") return Object.values(value).forEach(collect);
		};
		(out.spellcasting || []).forEach(collect);
		if (!spellNames.size) return;

		const entry = out.trait[idx];
		const text = (entry.entries || []).filter(it => typeof it === "string").join(" ");
		const lead = /^(.*?limited-use pools:)/i.exec(text)?.[1];
		if (!lead) return;

		const rows = text.slice(lead.length).split(/[;.]\s+|\.\s*$/).map(it => it.trim()).filter(Boolean);
		const kept = rows.filter(row => {
			const label = row.replace(/\s+\S+\/\S+.*$/, "").trim();
			const tokens = new Set(this._normalizeFeatureKey(label).split(" ").filter(Boolean));
			// Covered when every word of a printed spell name appears in the pool label.
			return ![...spellNames].some(spell => {
				const parts = spell.split(" ").filter(Boolean);
				return parts.length && parts.every(p => tokens.has(p));
			});
		});

		if (kept.length === rows.length) return;
		if (!kept.length) out.trait.splice(idx, 1);
		else entry.entries = [`${lead} ${kept.join("; ")}.`];
		if (!out.trait.length) delete out.trait;
	}

	/**
	 * Pull the sentences of `entry` whose stated activation is not `section`.
	 * @returns {Array<{section: string, entries: Array<string>}>}
	 */
	static _extractForeignActivations (entry, section) {
		const strings = (entry.entries || []).filter(it => typeof it === "string");
		if (strings.length !== (entry.entries || []).length) return [];

		const sentences = strings.join(" ").split(/(?<=[.!?])\s+/).filter(it => it.trim());
		if (sentences.length < 2) return [];

		const classified = sentences.map(sentence => this._getActivationSectionFromText(sentence));

		// A feat whose text opens with standing benefits and only later states its
		// activation (War Caster: two passive benefits, then a reaction) gets filed wholly
		// under the activation, hiding the passives in the reaction block. A lead sentence
		// that mentions no action economy at all cannot be part of the activation, so it
		// belongs in `trait`.
		if (section !== "trait") {
			const firstOwn = classified.findIndex(it => it === section);
			if (firstOwn > 0 && classified.slice(0, firstOwn).every(it => !it)) {
				const lead = sentences.slice(0, firstOwn);
				const isStanding = (sentence) => {
					const text = this._getPlainMatchText(sentence);
					if (/^(?:when|if|whenever|while|before|after|as |instead|on a )/.test(text)) return false;
					if (/\b(?:bonus action|reaction|an action|magic action)\b/.test(text)) return false;
					// A flavour lead ("can inspire others through stirring words") also mentions
					// no action economy, but it introduces the activation rather than standing
					// apart from it — moving it strands the feature's own opening line in the
					// trait block. Only a benefit that is persistent *by grammar* qualifies.
					return /\b(?:has|have) (?:advantage|disadvantage|resistance|immunity)\b/.test(text)
						|| /\b(?:is|are) (?:immune|resistant|proficient)\b/.test(text)
						|| /\b(?:ignores?|counts? as|can perform|can(?:'|\u2019)?t be|doesn(?:'|\u2019)?t)\b/.test(text);
				};
				if (lead.every(isStanding)) {
					entry.entries = [sentences.slice(firstOwn).join(" ")];
					return [{section: "trait", entries: [lead.join(" ")]}];
				}
			}
		}

		// A `{@b Label.}` introduces a named sub-benefit whose text may run for several
		// sentences. Splitting between the label and its continuation scatters one option
		// across two sections ("Cloak of Shadow." filed under `action`, its "For the next
		// hour…" clause left behind under `bonus`), so a label and everything up to the
		// next label move as one unit.
		const units = this._groupSentencesIntoBenefitUnits(sentences, classified);
		const distinct = new Set(units.map(it => it.section).filter(Boolean));
		if (distinct.size < 2) return [];

		const groups = new Map();
		const retained = [];
		units.forEach(unit => {
			const target = unit.section;
			if (!target || target === section) return void retained.push(unit.text);
			if (!groups.has(target)) groups.set(target, []);
			groups.get(target).push(unit.text);
		});
		if (!groups.size || !retained.length) return [];

		entry.entries = [retained.join(" ")];
		return [...groups.entries()].map(([target, list]) => ({section: target, entries: [list.join(" ")]}));
	}

	/**
	 * Collapse sentences into indivisible benefit units. A sentence opening with a
	 * `{@b Label.}` starts a new unit and absorbs following unlabelled sentences; an
	 * unlabelled sentence outside any label is its own unit. A unit's activation is the
	 * first activation any of its sentences states.
	 *
	 * @returns {Array<{text: string, section: string}>}
	 */
	static _groupSentencesIntoBenefitUnits (sentences, classified) {
		const isLabelled = (sentence) => /\{@b\s[^}]*\.\}/.test(sentence);
		const units = [];
		let open = null;

		sentences.forEach((sentence, ix) => {
			if (isLabelled(sentence)) {
				open = {parts: [sentence], section: classified[ix] || ""};
				units.push(open);
				return;
			}
			if (open) {
				open.parts.push(sentence);
				if (!open.section) open.section = classified[ix] || "";
				return;
			}
			units.push({parts: [sentence], section: classified[ix] || ""});
		});

		return units.map(it => ({text: it.parts.join(" "), section: it.section}));
	}

	/**
	 * The same ability can reach the block from several pipelines (feat prose, promoted
	 * named modifier, item entry). Keep one entry per base name — the one that actually
	 * carries mechanics — and drop redundant action-economy suffixes from its name.
	 */
	static _dedupeStatblockEntries (out) {
		const sections = ["trait", "action", "bonus", "reaction"];
		const best = new Map();
		sections.forEach(section => {
			(out[section] || []).forEach((entry, idx) => {
				const key = this._getStatblockDedupeKey(entry?.name);
				if (!key) return;
				const score = this._getStatblockEntryScore(entry);
				const prev = best.get(key);
				if (!prev || score > prev.score) best.set(key, {section, idx, score});
			});
		});

		sections.forEach(section => {
			if (!Array.isArray(out[section])) return;
			out[section] = out[section].filter((entry, idx) => {
				const key = this._getStatblockDedupeKey(entry?.name);
				if (!key) return true;
				const winner = best.get(key);
				return winner.section === section && winner.idx === idx;
			});
			out[section].forEach(entry => {
				entry.name = this._cleanStatblockEntryName(entry.name, section);
			});
			if (!out[section].length && (section === "bonus" || section === "reaction")) delete out[section];
		});
	}

	/**
	 * Player-handbook prose carries a lot of text a statblock has no use for: recharge
	 * clauses the `(5/SR)` on the name already states, references to a class table, "For
	 * example…" asides, and a flavour lead-in before the first real mechanic. Removing
	 * them is what makes a 17th-level character readable at the table.
	 *
	 * Every rule is sentence-level and conservative — a sentence survives unless it is
	 * *entirely* one of the known-dead forms, and the last remaining sentence is never
	 * removed.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _compactStatblockProse (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section].forEach(entry => {
				const hasUsesOnName = /\(\s*\d+\s*\/\s*[^)]+\)/.test(String(entry?.name || ""));
				entry.entries = this._compactFeatureEntries(entry.entries, {hasUsesOnName})
					.map(it => (typeof it === "string" ? this._tidyStatblockText(it) : it))
					// "Once per day, it can …" under a name that already reads "(1/Day)".
					.map(it => (typeof it === "string" && hasUsesOnName
						? it.replace(/^once per (?:day|dawn|long rest|short rest),\s*([a-z])/i, (m, ch) => ch.toUpperCase())
						: it))
					.filter(it => (typeof it === "string" ? it.trim() : it));
			});
			out[section] = out[section].filter(entry => entry?.entries?.length);
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * Class prose states a scaling die at its level-1 value and then defers to a table:
	 * "you can deal an extra 1d6 damage… The extra damage increases as you gain Rogue
	 * levels, as shown in the Sneak Attack table." A statblock has no table, so a
	 * level-20 rogue was exporting a level-1 number — the single most misleading thing an
	 * export can do.
	 *
	 * Rewrite the stale die rather than annotate it: unlike a named die ("its Superiority
	 * Die"), the printed value is simply wrong at this level, and leaving it alongside the
	 * right one invites the DM to roll the smaller.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} calculations `getFeatureCalculations()` output
	 */
	static _resolveScaledFeatureDice (out, calculations = {}) {
		const SCALED = [
			[/^sneak attack\b/i, calculations.sneakAttack?.dice || calculations.sneakAttackDice],
			[/^martial arts\b/i, calculations.martialArtsDie],
			[/^divine smite\b/i, calculations.divineSmiteDice],
		];

		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const name = String(entry?.name || "");
				const die = (SCALED.find(([re]) => re.test(name)) || [])[1];
				const shown = String(die || "").trim();
				if (!shown || !/^\d+d\d+$/.test(shown)) return;

				let replaced = false;
				entry.entries = (entry.entries || []).map(line => {
					if (typeof line !== "string" || replaced) return line;
					const next = line.replace(/(\{@damage )?\b\d+d\d+\b/, (m, tag) => {
						replaced = true;
						return tag ? `${tag}${shown}` : shown;
					});
					return next;
				});
			});
		});
	}

	/**
	 * A manifested power names the save it forces but never its DC — the number lives on
	 * the class, and a DM reading the power alone has nothing to call for. Item powers on
	 * the same statblock carry their own DCs, so only real powers are touched.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character state
	 * @param {Object} calculations feature calculations
	 */
	static _resolvePsionicPowerSaveDcs (out, state, calculations = {}) {
		const dc = Number(calculations?.powerSaveDc);
		if (!Number.isFinite(dc)) return;
		const powerNames = new Set(
			(state?.getFeatures?.() || [])
				.filter(f => f?._entityType === "psionicPower")
				.map(f => String(f?.name || "").trim().toLowerCase())
				.filter(Boolean),
		);
		if (!powerNames.size) return;
		const RE = /\bmust (make|succeed on) an? (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b(?!\s*(?:\(|against))/gi;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const base = String(entry?.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
				if (!powerNames.has(base)) return;
				if (!Array.isArray(entry.entries)) return;
				entry.entries = entry.entries.map(line => (typeof line === "string"
					? line.replace(RE, (m, verb, abil) => `must ${verb.toLowerCase()} a {@dc ${dc}} ${abil} saving throw`)
					: line));
			});
		});
	}

	/**
	 * Class prose is written for a player who can look up their own level and dice, so it
	 * says "one roll of its hemocraft die" or "equal to its Monk level" and stops there. A
	 * statblock has no such lookup — the DM reading it needs the number.
	 *
	 * The sheet already computes every one of these (`getFeatureCalculations()` carries the
	 * scaling dice; `getClassLevel()` carries the levels), they were simply never
	 * substituted back into the prose. Annotate rather than replace: keeping the original
	 * wording and appending the resolved value in parentheses preserves the rule's meaning
	 * for anyone cross-checking it against the source book.
	 *
	 * Every substitution is guarded with a `(?!\s*\()` lookahead so a phrase that already
	 * carries a parenthetical — from this pass or an upstream one — is never annotated
	 * twice.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state character sheet state
	 * @param {Object} calculations `getFeatureCalculations()` output
	 */
	static _resolveDerivedNumbers (out, state, calculations = {}) {
		const rules = [];

		const addDie = (phrase, raw) => {
			const die = String(raw || "").trim();
			if (!die) return;
			// Calculations store these inconsistently ("1d8" vs "d10"); a statblock should
			// print one die either way.
			const shown = /^\d/.test(die) ? die : `1${die}`;
			// Some book wording states the die inline at its level-1 value ("one Bardic
			// Inspiration die, a d6"). Replace the stale statement rather than appending a
			// second, contradicting one.
			rules.push([new RegExp(`\\b(${phrase}),\\s+an?\\s+d\\d+`, "g"), (_m, p) => `${p} (${shown})`]);
			// The lookahead must match a *die value* paren, not any paren — "one
			// Superiority Die (no action required)" otherwise reads as already annotated.
			// A tag counts as already-annotated too: the psionics block writes
			// "Manifestation die {@dice 1d8}", and appending to that reads as two dice.
			rules.push([new RegExp(`\\b${phrase}\\b(?!\\s*(?:\\(\\d*d\\d|\\{@(?:dice|damage)\\s+\\d*d\\d))`, "g"), m => `${m} (${shown})`]);
		};

		addDie("[Hh]emocraft [Dd]i(?:e|ce)", calculations.hemocraftDie);
		addDie("[Mm]artial [Aa]rts [Dd]i(?:e|ce)", calculations.martialArtsDie);
		addDie("[Ss]uperiority [Dd]i(?:e|ce)", calculations.superiorityDie);
		addDie("[Bb]ardic [Ii]nspiration [Dd]i(?:e|ce)", calculations.bardicInspirationDie);
		addDie("[Ss]neak [Aa]ttack [Dd]i(?:e|ce)", calculations.sneakAttack?.dice || calculations.sneakAttackDice);
		addDie("[Pp]sionic [Ee]nergy [Dd]i(?:e|ce)", calculations.psionicEnergyDie);
		addDie("[Mm]anifestation [Dd]i(?:e|ce)", calculations.manifestationDie);

		// "the DC equals 8 plus its Dexterity modifier and Proficiency Bonus (+14)" makes
		// the DM do the addition the sheet already did.
		const dcPb = Number(state?.getProficiencyBonus?.()) || 0;
		rules.push([
			/\bthe (?:save )?DC equals 8 plus [^.]*?\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier and (?:its )?Proficiency Bonus(?:\s*\(\+\d+\))?/gi,
			(m, ability) => {
				const mod = Number(state?.getAbilityMod?.(ability.slice(0, 3).toLowerCase()));
				if (!Number.isFinite(mod) || !dcPb) return m;
				return `the save DC is {@dc ${8 + mod + dcPb}}`;
			},
		]);

		// "the DC equals the spell save DC from this class's Spellcasting feature" asks the
		// reader to go and find a number the block already knows.
		const spellDc = this._getSpellDcAndAttack(state)?.dc;
		if (Number.isFinite(Number(spellDc))) {
			rules.push([
				/\bthe (?:save )?DC equals (?:your|its|their|the) spell save DC[^.]*/gi,
				`the save DC is {@dc ${spellDc}}`,
			]);
		}

		// "against your talent power save DC" is a lookup the statblock cannot perform.
		if (Number.isFinite(Number(calculations.powerSaveDc))) {
			rules.push([/\b(?:its |their )?(?:talent )?power save DC\b(?!\s*\()/g, `power save {@dc ${calculations.powerSaveDc}}`]);
		}

		const MULTIPLIERS = [
			["half", lvl => Math.floor(lvl / 2)],
			["twice", lvl => lvl * 2],
			["three times", lvl => lvl * 3],
			["four times", lvl => lvl * 4],
			["five times", lvl => lvl * 5],
			["ten times", lvl => lvl * 10],
		];

		(state.getClasses?.() || []).forEach(cls => {
			const name = String(cls?.name || "").trim();
			if (!name) return;
			const level = Number(state.getClassLevel?.(name)) || Number(cls?.level) || 0;
			if (!level) return;
			const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
			// The guard has to be a *numeric* paren. "half its Wizard level (round up)" and
			// "half its blood hunter level (maximum 9th level)" both carry a parenthetical
			// that is part of the rule, not an annotation this pass already added, and a
			// blanket `\(` lookahead left those two phrases unresolved forever.
			const NOT_RESOLVED = String.raw`(?!\s*\(\d)`;
			// A stated rounding direction is the book telling the reader how to finish the
			// division. Once the number is printed, the instruction has nothing left to do.
			const ROUNDING = String.raw`(\s*\(round(?:ed)?\s+(up|down)\))?`;
			// Multiplier forms first; the bare form's lookahead then skips what they wrote.
			MULTIPLIERS.forEach(([word, fn]) => {
				rules.push([
					new RegExp(`\\b${word}\\s+its\\s+${esc}\\s+level\\b${ROUNDING}${NOT_RESOLVED}`, "gi"),
					(m, roundParen, direction) => {
						const base = fn(level);
						const roundsUp = /^up$/i.test(direction || "") && base * 2 !== level;
						return `${roundParen ? m.slice(0, -roundParen.length) : m} (${base + (roundsUp ? 1 : 0)})`;
					},
				]);
			});
			rules.push([new RegExp(`\\bits\\s+${esc}\\s+level\\b${NOT_RESOLVED}`, "gi"), m => `${m} (${level})`]);
		});

		// Feat text says "its level" with no class, because a feat does not belong to one.
		// Inspiring Leader printed "equal to its level + its Charisma modifier (1)", where
		// the only number shown is the modifier — so the line looked like it stated the
		// answer while being off by the whole character level. State the total instead.
		const totalLevel = Number(state.getTotalLevel?.()) || 0;
		if (totalLevel) {
			rules.push([
				/\bits level\s*\+\s*its\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+modifier(?:\s*\([+-]?\d+\))?/gi,
				(m, ability) => {
					const mod = Number(state.getAbilityMod?.(ability.slice(0, 3).toLowerCase()));
					return Number.isFinite(mod) ? `${totalLevel + mod}` : m;
				},
			]);
			rules.push([/\bits level\b(?!\s*\(\d)/g, m => `${m} (${totalLevel})`]);
		}

		// "half its blood hunter level (6) (maximum 9th level)" states a ceiling this
		// character is nowhere near. A statblock is a snapshot of one level, so a cap the
		// resolved value already clears is guidance for a different character.
		rules.push([
			/\((\d+)\)\s*\(maximum (\d+)(?:st|nd|rd|th) level\)/g,
			(m, value, cap) => (Number(value) <= Number(cap) ? `(${value})` : m),
		]);

		// No early return on an empty `rules` — the DC passes below stand on their own.

		// A "DC equal to 8 + its proficiency bonus + its Strength modifier" is the book
		// telling the player how to compute a number the sheet already knows. Collapse it.
		const pb = Number(state.getProficiencyBonus?.()) || 0;
		const ABBR = {strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"};
		const formulaRe = /\b(?:a |the )?DC(?: for [\w' ]{1,24})?\s*(?:equal to|of|equals)?\s*8\s*(?:\+|plus)\s*(?:its )?(?:proficiency bonus\s*(?:\+|plus|and)\s*(?:its )?(\w+) modifier|(\w+) modifier\s*(?:\+|plus|and)\s*(?:its )?proficiency bonus)/gi;
		const resolveFormula = txt => String(txt || "").replace(formulaRe, (m, a, b) => {
			const abbr = ABBR[String(a || b || "").toLowerCase()];
			if (!abbr) return m;
			const mod = Number(state.getAbilityMod?.(abbr));
			if (!Number.isFinite(mod)) return m;
			return `{@dc ${8 + pb + mod}}`;
		})
			// Feat text defers to "the ability modifier used for the spell" because the feat
			// does not know which class granted it. The sheet does — it is the character's
			// spell save DC.
			.replace(/\b(?:a |the )?DC(?: for [\w' ]{1,24})?\s*(?:equal to|of|equals)?\s*8\s*(?:\+|plus)\s*(?:its )?proficiency bonus(?:\s*\(\+?\d+\))?\s*(?:\+|plus|and)\s*the ability modifier (?:used (?:for|to cast) (?:the|this) spell|of the (?:ability )?score increased by this feat)/gi, m => {
				const dc = Number(state.getSpellSaveDC?.());
				return Number.isFinite(dc) && dc > 0 ? `{@dc ${dc}}` : m;
			})
			// The formula usually sits in its own sentence ("The DC for the saving throw
			// equals 8 + …"), which collapses to a bare "{@dc 14}." floating after the
			// effect. Attach it to the save it governs instead.
			.replace(/\b([Ss]aving throw)((?:(?!saving throw)[^.])*\.)\s*\{@dc (\d+)\}\.\s*/g, "$1 ({@dc $3})$2 ")
			.trim();

		const dcIndex = this._getFeatureSaveDcIndex(state, calculations);

		const resolve = txt => this._resolveAbilityFormulas(rules.reduce((acc, [re, fn]) => acc.replace(re, fn), resolveFormula(txt)), state);
		const charLevel = Number(state.getTotalLevel?.()) || 0;

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(it => (typeof it === "string" ? this._collapseScalingBonusSentences(resolve(it), charLevel) : it));
				this._resolveLevelGatedUpgrades(entry, charLevel);
				this._dedupeDerivedAnnotations(entry);
				this._injectMissingSaveDc(entry, dcIndex);
			});
		});
	}

	/**
	 * Sibling of the level/die substitution above, covering the other half of the book's
	 * "look it up yourself" shorthand: ability modifiers and the proficiency bonus. Those
	 * account for every unresolved formula left in the corpus after v9 — a DM reading
	 * "reduce the damage by 1d10 plus its Dexterity modifier and Monk level" cannot run the
	 * creature without stopping to do arithmetic the sheet already did.
	 *
	 * Compound forms are resolved to a *single* total and stashed behind a placeholder
	 * before the bare forms run, because otherwise the bare rule re-matches the operands
	 * inside a phrase this pass just finished resolving and annotates them a second time.
	 *
	 * A trailing "(minimum of 1)" is dropped once the resolved value clears the floor: it
	 * is guidance for a level-1 character, not a fact about this one.
	 *
	 * @param {string} text entry text
	 * @param {Object} state character sheet state
	 * @returns {string} text with modifier/proficiency formulas resolved
	 */
	/**
	 * Modifiers a class names after itself rather than after an ability score.
	 *
	 * Fails closed: a name is only offered for substitution when the sheet has actually
	 * computed a finite value for it, because printing a wrong number is worse than
	 * leaving the formula for the DM to read.
	 *
	 * @param {Object} state character sheet state
	 * @returns {Map<string, number>} lowercase modifier name -> value
	 */
	static _getNamedModifierValues (state) {
		const out = new Map();
		let calc = null;
		try { calc = state.getFeatureCalculations?.(); } catch (ignored) { calc = null; }
		if (!calc) return out;

		const put = (name, value) => {
			const num = Number(value);
			if (Number.isFinite(num)) out.set(name, num);
		};
		put("hemocraft", calc.hemocraftModifier);
		if (calc.manifestationAbility) put("manifestation ability", state.getAbilityMod?.(calc.manifestationAbility));
		return out;
	}

	static _resolveAbilityFormulas (text, state) {
		let str = String(text || "");
		if (!str || !/modifier|proficiency bonus/i.test(str)) return str;

		const ABBR = {strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"};
		const ABL = "Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma";
		const pb = Number(state.getProficiencyBonus?.()) || 0;
		const modOf = word => {
			const mod = Number(state.getAbilityMod?.(ABBR[String(word || "").toLowerCase()]));
			return Number.isFinite(mod) ? mod : null;
		};

		// "equal to X" introduces a quantity, so it reads as a bare number; anything else is
		// a modifier being added to a roll, which conventionally carries its sign.
		const QUANTITY = /(?:equal to|number of|total of|rolls? of|amount equal to|increases? to|becomes)[^.]{0,24}$/i;
		// "a bonus to its attack roll equal to X" satisfies QUANTITY on the "equal to", but a
		// bonus is a thing you add to a roll and so conventionally carries its sign.
		const SIGNED = /\bbonus (?:to|on)\b[^.]{0,40}$/i;
		const format = (whole, offset, value) => {
			const before = whole.slice(Math.max(0, offset - 60), offset);
			if (SIGNED.test(before)) return this._toSignedStr(value);
			return QUANTITY.test(before.slice(-40)) ? `${value}` : this._toSignedStr(value);
		};

		// A trailing minimum clause is part of the same formula, so it must be consumed with
		// it — otherwise the "already annotated" guard below sees a parenthesis and the whole
		// formula silently survives unresolved. Covers "(minimum of 1)", "(minimum of one)",
		// "(minimum of one creature)", "(minimum of 1d8)", "(minimum reduction of 1)" and
		// "(minimum of 1 temporary hit point)".
		const NUM_WORD = {once: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6};
		const MIN_BODY = String.raw`\((?:a )?minimum(?:\s+\w+)?(?:\s+of)?\s+(once|one|two|three|four|five|six|\+?\d+)(?:d\d+)?(?:\s+[\w ]{1,28})?\)`;
		const MIN = String.raw`(?:\s*${MIN_BODY})?`;
		const MIN_RE = new RegExp(MIN_BODY, "i");
		const minimumOf = m => {
			const found = MIN_RE.exec(m);
			if (!found) return null;
			const raw = String(found[1]).toLowerCase();
			const val = NUM_WORD[raw] ?? Number(raw.replace("+", ""));
			return Number.isFinite(val) ? val : null;
		};

		const stash = [];
		const keep = resolved => `\uE000${stash.push(resolved) - 1}\uE000`;

		const compound = (pattern, valueOf, {unsigned = false, restate = false} = {}) => {
			str = str.replace(new RegExp(`${pattern}${MIN}(?!\\s*\\()`, "gi"), (m, ...rest) => {
				const offset = rest[rest.length - 2];
				const whole = rest[rest.length - 1];
				const value = valueOf(rest.slice(0, -2));
				if (value == null || !Number.isFinite(value)) return m;
				// The clause exists to stop the formula going below a floor. Once the real
				// value is known the floor is either moot (drop it) or the answer (use it).
				const floor = minimumOf(m);
				const resolved = floor != null && value < floor ? floor : value;
				const phrase = m.replace(new RegExp(String.raw`\s*${MIN_BODY}`, "i"), "");
				const shown = unsigned ? resolved : format(whole, offset, resolved);
				// Appending the value works while the phrase ends on the noun the value
				// measures. It does not for "13 plus its Wisdom modifier", where the trailing
				// noun is an operand — "its Wisdom modifier (18)" states a false fact about a
				// character whose Wisdom modifier is +5. Those phrases lead with the answer.
				return keep(restate ? `${shown} (${phrase})` : `${phrase} (${shown})`);
			});
		};

		const classLevels = new Map();
		(state.getClasses?.() || []).forEach(cls => {
			const name = String(cls?.name || "").trim();
			if (name) classLevels.set(name.toLowerCase(), Number(state.getClassLevel?.(name)) || Number(cls?.level) || 0);
		});
		const classAlt = [...classLevels.keys()].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)";

		compound(String.raw`\b(?:its )?(${ABL}) modifier (?:\+|plus|and) (?:its )?[Pp]roficiency [Bb]onus\b`, ([abl]) => {
			const mod = modOf(abl);
			return mod == null ? null : mod + pb;
		});
		compound(String.raw`\b(?:its )?[Pp]roficiency [Bb]onus (?:\+|plus|and) (?:its )?(${ABL}) modifier\b`, ([abl]) => {
			const mod = modOf(abl);
			return mod == null ? null : mod + pb;
		});
		// A class can name its own modifier ("its Hemocraft modifier", "its manifestation
		// ability modifier"). Those read exactly like an ability modifier to a DM but are not
		// one of the six, so the alternation above never sees them and Dzeiy's brand keeps
		// printing "equal to its Hemocraft modifier (minimum of 1)" instead of the number.
		const named = this._getNamedModifierValues(state);
		const namedAlt = [...named.keys()].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)";
		compound(String.raw`\btwice (?:its )?(${namedAlt}) modifier\b`, ([nm]) => {
			const mod = named.get(String(nm).toLowerCase());
			return mod == null ? null : 2 * mod;
		});
		compound(String.raw`\b(?:its )?(${namedAlt}) modifier\b`, ([nm]) => named.get(String(nm).toLowerCase()) ?? null);

		compound(String.raw`\b(?:its )?(${ABL}) modifier and (?:its )?(${classAlt}) level\b`, ([abl, cls]) => {
			const mod = modOf(abl);
			const lvl = classLevels.get(String(cls).toLowerCase());
			return mod == null || !lvl ? null : mod + lvl;
		});
		compound(String.raw`\b(?:1|one) \+ twice (?:its )?(${ABL}) modifier\b`, ([abl]) => {
			const mod = modOf(abl);
			return mod == null ? null : 1 + (2 * mod);
		});
		compound(String.raw`\btwice (?:its )?(${ABL}) modifier\b`, ([abl]) => {
			const mod = modOf(abl);
			return mod == null ? null : 2 * mod;
		});
		// "its AC equals 13 plus its Wisdom modifier" — the DM needs the total, not the
		// two operands. The lookbehind keeps dice expressions out ("1d10 plus its
		// Dexterity modifier" must annotate the modifier, not sum 10 into it).
		compound(String.raw`(?<![\dd])(\d{1,2}) (?:plus|\+) (?:its )?(${ABL}) modifier\b`, ([base, abl]) => {
			const mod = modOf(abl);
			return mod == null ? null : Number(base) + mod;
		}, {restate: true, unsigned: true});
		compound(String.raw`\b(?:its )?[Pp]roficiency [Bb]onus\s*(?:×|x|\*)\s*(\d+)\b`, ([mult]) => (pb ? pb * Number(mult) : null));

		compound(String.raw`\b(?:its )?(${ABL}) modifier\b`, ([abl]) => modOf(abl));
		compound(String.raw`\b(?:its )?[Pp]roficiency [Bb]onus\b`, () => pb || null);

		return str.replace(/\uE000(\d+)\uE000/g, (_m, idx) => stash[Number(idx)]);
	}

	/**
	 * Book prose names its own die on every mention ("the creature can roll the Bardic
	 * Inspiration die… once the Bardic Inspiration die is rolled…"). Annotating all four
	 * turns one fact into four, which is exactly the noise a statblock exists to remove.
	 * Keep the first annotation in each entry and strip the rest.
	 *
	 * @param {Object} entry statblock entry (mutated)
	 */
	static _dedupeDerivedAnnotations (entry) {
		if (!Array.isArray(entry?.entries)) return;
		const seen = new Set();
		entry.entries = entry.entries.map(it => {
			if (typeof it !== "string") return it;
			return it.replace(/\b((?:[A-Z][\w']*\s+){0,3}[Dd]i(?:e|ce))\s\((\d*d\d+)\)/g, (m, phrase, die) => {
				const key = `${String(phrase).toLowerCase().replace(/^(?:the|a|an|one|its)\s+/, "")}|${die}`;
				if (!seen.has(key)) {
					seen.add(key);
					return m;
				}
				return phrase;
			});
		});
	}

	/**
	 * Class prose states a bonus at its level-1 value and then tacks on the whole scaling
	 * chain ("+1 bonus to melee damage rolls. This bonus increases to +2 at 11th level and
	 * to +3 at 18th level."). A statblock is a snapshot of one creature at one level, so
	 * the chain is noise at best and misleading at worst — a DM skimming it will read the
	 * first number and use +1 on a character whose bonus is +2.
	 *
	 * Fold the highest step the character has actually reached back into the base value and
	 * delete the chain. When no step applies the chain is simply dropped, leaving the base
	 * untouched.
	 *
	 * @param {string} text entry text
	 * @param {number} charLevel character level
	 * @returns {string} text with scaling chains resolved
	 */
	static _collapseScalingBonusSentences (text, charLevel) {
		const str = String(text || "");
		if (!charLevel || !/\bincreases to \+?\d+ at \d+(?:st|nd|rd|th) level/i.test(str)) return str;

		const CHAIN = /(\+)(\d+)([^.]{0,90}\.\s*)((?:This|The) bonus increases to \+?\d+ at \d+(?:st|nd|rd|th) level(?:,?\s*(?:and )?(?:to )?\+?\d+ at \d+(?:st|nd|rd|th) level)*\.\s*)/gi;

		return str.replace(CHAIN, (m, sign, base, middle, chain) => {
			let best = Number(base);
			let matched;
			const step = /\+?(\d+) at (\d+)(?:st|nd|rd|th) level/gi;
			while ((matched = step.exec(chain)) !== null) {
				const value = Number(matched[1]);
				const atLevel = Number(matched[2]);
				if (atLevel <= charLevel && value > best) best = value;
			}
			return `${sign}${best}${middle}`;
		});
	}

	/**
	 * Class prose describes a feature across a whole career: it states the level-1 value and
	 * then names every later upgrade ("…up to 15 feet. When it reaches 7th level in this
	 * class, the leap's distance can total up to 30 feet instead."). A statblock is a
	 * snapshot of one creature at one level, so the upgrade sentence is simultaneously
	 * redundant and misleading — the value printed first is the one a DM will use, and it is
	 * the wrong one.
	 *
	 * Resolve rather than delete: take the highest step the character has actually reached,
	 * write that value over the base value it supersedes, and drop the upgrade sentence.
	 * Only same-kind values are substituted (a die replaces a die, a distance a distance, a
	 * size a size), so a sentence whose upgrade has no counterpart in the base text is left
	 * alone rather than corrupted.
	 *
	 * @param {string} text entry text
	 * @param {number} charLevel level to resolve against
	 * @returns {string} text with level-gated upgrades folded into the base value
	 */
	static _resolveLevelGatedUpgrades (entry, charLevel) {
		if (!charLevel || !Array.isArray(entry?.entries)) return;
		const lines = entry.entries;
		if (!lines.some(it => typeof it === "string" && /\breach(?:es)?\b|\bbecomes?\b/i.test(it))) return;

		const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
		// Guarded on both sides so a size never matches inside a longer word ("smaller").
		const VALUE = String.raw`(?<![A-Za-z])(?:\d*d\d+|\d+\s*(?:feet|foot|ft\.)|Tiny|Small|Medium|Large|Huge|Gargantuan)(?![A-Za-z])`;
		const kindOf = value => {
			const v = String(value).trim().toLowerCase();
			if (/^\d*d\d+$/.test(v)) return "die";
			if (/feet|foot|ft\./.test(v)) return "distance";
			return SIZES.includes(v) ? "size" : null;
		};
		const rank = value => {
			const v = String(value).trim().toLowerCase();
			if (SIZES.includes(v)) return SIZES.indexOf(v);
			const die = /^(\d*)d(\d+)$/.exec(v);
			if (die) return (Number(die[1]) || 1) * Number(die[2]);
			return Number((/\d+/.exec(v) || [0])[0]);
		};

		// A level must be written as a level — an ordinal ("6th level") or an explicit list
		// ("Cleric levels 7 (2d8), 13 (3d8)"). Matching a bare integer instead lets "30 feet"
		// parse as level 3 upgrading to "0 feet".
		const PAIRED = new RegExp(String.raw`\b(\d+)(?:st|nd|rd|th)?\s*(?:levels?)?\s*\((${VALUE})\)`, "gi");
		const ORDINAL = /\b(\d+)(?:st|nd|rd|th)\s+level\b/i;
		const TRAILING = new RegExp(String.raw`(${VALUE})(?!.*(?:${VALUE}))`, "i");

		// Flatten to sentences while remembering which line each came from, so a base value
		// and the upgrade that supersedes it are comparable even when the converter split
		// them into separate paragraphs.
		const units = [];
		lines.forEach((line, lineIdx) => {
			if (typeof line !== "string") return void units.push({lineIdx, text: line, opaque: true});
			this._splitIntoClauses(line).forEach(text => units.push({lineIdx, text}));
		});

		let changed = false;
		for (let i = units.length - 1; i > 0; --i) {
			const unit = units[i];
			if (unit.opaque) continue;
			const plain = this._getPlainMatchTextCased(unit.text);
			const gated = /\breach(?:es)?\b[^.]{0,40}\blevels?\b/i.test(plain);
			// A progression that lost its level clauses in conversion ("this extra damage
			// becomes 1d10, and it becomes 1d12") states upgrades with no gate at all. The
			// character's own level already decided the answer, so take the best one.
			const ungated = /\b(?:damage|bonus|die|distance)\b[^.]{0,40}\bbecomes?\b/i.test(plain) && /becomes?\s+(?:\d*d\d+|\+?\d+)/i.test(plain);
			if (!gated && !ungated) continue;

			const steps = [];
			if (!gated) {
				[...plain.matchAll(new RegExp(String.raw`becomes?\s+(${VALUE})`, "gi"))].forEach(m => steps.push({at: 0, value: m[1]}));
			} else {
				PAIRED.lastIndex = 0;
				let m;
				while ((m = PAIRED.exec(plain)) !== null) steps.push({at: Number(m[1]), value: m[2]});
				// "When it reaches 7th level in this class, the leap's distance can total up to
				// 30 feet instead." — one gate, and the new value closes the sentence.
				if (!steps.length) {
					const at = ORDINAL.exec(plain);
					const value = at ? TRAILING.exec(plain.slice(at.index + at[0].length)) : null;
					if (value) steps.push({at: Number(at[1]), value: value[1]});
				}
			}

			const reached = steps.filter(s => s.at <= charLevel && kindOf(s.value));
			if (!reached.length) continue;
			const best = reached.reduce((a, b) => (rank(b.value) > rank(a.value) ? b : a));
			const kind = kindOf(best.value);

			// Write the winning value over the most recent same-kind value stated before it.
			let applied = false;
			for (let j = i - 1; j >= 0 && !applied; --j) {
				if (units[j].opaque) continue;
				const base = [...units[j].text.matchAll(new RegExp(`(${VALUE})`, "gi"))]
					.filter(m => kindOf(m[1]) === kind && rank(m[1]) !== rank(best.value));
				if (!base.length) continue;
				const target = base[base.length - 1];
				units[j].text = `${units[j].text.slice(0, target.index)}${best.value}${units[j].text.slice(target.index + target[1].length)}`;
				applied = true;
			}
			if (!applied) continue;
			units.splice(i, 1);
			changed = true;
		}
		if (!changed) return;

		const rebuilt = [];
		units.forEach(u => {
			if (u.opaque) return void rebuilt.push({idx: u.lineIdx, value: u.text, opaque: true});
			const prev = rebuilt[rebuilt.length - 1];
			if (prev && !prev.opaque && prev.idx === u.lineIdx) prev.value = `${prev.value} ${u.text}`;
			else rebuilt.push({idx: u.lineIdx, value: u.text});
		});
		entry.entries = rebuilt.map(r => r.value);
	}

	/**
	 * The provenance label a character builder prints above a feature ("3rd-level College of
	 * Creation feature") survives conversion in two shapes: as its own line, and welded to
	 * the front of the first sentence, sometimes wrapped in `{@i}`. The standalone form is
	 * handled with the other dead sentences; this removes the welded prefix, which no
	 * sentence-level pass can see because it carries no terminator of its own.
	 *
	 * @param {Object} out monster object (mutated)
	 */
	static _stripFeatureProvenanceLabels (out) {
		const LABEL = /^\s*(?:\{@i\s*)?\d+(?:st|nd|rd|th)[- ]level [\w'’ ]{2,44}?(?:optional )?feature\}?\.?\s*/i;
		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries
					.map(it => (typeof it === "string" ? it.replace(LABEL, "").trim() : it))
					.filter(it => typeof it !== "string" || it);
			});
		});
	}

	/**
	 * Maps each of the character's feature names to the save DC that feature would impose.
	 * `state.getFeatureSaveDc()` already resolves this correctly for multiclass characters
	 * (owning class's DC, falling back to the global spell save DC), so this is only an
	 * index over it keyed by the name the statblock entry will carry.
	 *
	 * @param {Object} state character sheet state
	 * @returns {Map<string, number>} normalized feature name -> DC
	 */
	static _getFeatureSaveDcIndex (state, calculations = {}) {
		// `getFeatureSaveDc()` resolves to a *spell* save DC, so it returns null for
		// martial classes whose save-forcing features key off a class-specific DC instead.
		const BY_CLASS = {
			fighter: calculations.maneuverSaveDc,
			"blood hunter": calculations.hemocraftSaveDc,
			monk: calculations.focusSaveDc ?? calculations.kiSaveDc,
			rogue: calculations.roguishSaveDc,
		};

		const index = new Map();
		(state.getFeatures?.() || []).forEach(feature => {
			const name = this._normalizeFeatureKey(feature?.name);
			if (!name || index.has(name)) return;
			const dc = Number(state.getFeatureSaveDc?.(feature)) || Number(BY_CLASS[String(feature?.className || "").toLowerCase()]);
			if (Number.isFinite(dc) && dc > 0) index.set(name, dc);
		});
		return index;
	}

	/**
	 * A statblock entry that says "the target must make a Constitution saving throw" and
	 * never states a DC is unusable at the table — the DM has nothing to roll against.
	 * Class prose omits it because RAW defers to the class's spell save DC, which a player
	 * has on their sheet and a DM reading a statblock does not.
	 *
	 * Only entries that actually *force* a save qualify; "it has advantage on Dexterity
	 * saving throws" is a defence, not a DC-bearing effect, and must be left alone. An
	 * entry that already states any DC is also left alone — a second, derived number could
	 * contradict the one the feature deliberately specifies.
	 *
	 * @param {Object} entry statblock entry (mutated)
	 * @param {Map<string, number>} dcIndex feature name -> DC
	 */
	static _injectMissingSaveDc (entry, dcIndex) {
		if (!Array.isArray(entry?.entries)) return;

		const joined = entry.entries.filter(it => typeof it === "string").join(" ");
		if (!joined || /\{@dc |\bDC\s*\d/i.test(joined)) return;

		// The save must be forced on someone else. "an effect that allows it to make a
		// Dexterity saving throw" (Evasion) is a save the NPC *makes*, governed by a DC the
		// statblock cannot know, so requiring an explicit third-party subject in the same
		// clause is what keeps a defensive feature from acquiring the NPC's own save DC.
		const FORCED = /\b(?:creature|creatures|target|targets|enemy|enemies|foe|foes|ally|allies|monster)\b[^.]{0,80}?\b(?:must (?:make|succeed on|repeat)|makes?) (?:a|an|its|the) [A-Za-z]* ?saving throw/i;
		const FORCED_ALT = /\bforce(?:s|d)? (?:it|them|the \w+|that \w+|each \w+) to (?:make|succeed on) (?:a|an|its|the) [A-Za-z]* ?saving throw/i;
		const matches = str => FORCED.test(str) || FORCED_ALT.test(str);
		if (!matches(joined)) return;

		// The entry name may carry a "(3/SR)" suffix the feature name does not.
		const dc = dcIndex.get(this._normalizeFeatureKey(String(entry.name || "").replace(/\s*\([^)]*\)\s*$/, "")));
		if (!Number.isFinite(dc)) return;

		let done = false;
		entry.entries = entry.entries.map(it => {
			if (done || typeof it !== "string" || !matches(it)) return it;
			const hit = FORCED.exec(it) || FORCED_ALT.exec(it);
			if (!hit) return it;
			done = true;
			// Anchor on the forced clause so an earlier, unrelated "saving throw" phrase in
			// the same paragraph does not absorb the DC.
			return `${it.slice(0, hit.index)}${hit[0].replace(/(saving throw)$/, `$1 ({@dc ${dc}})`)}${it.slice(hit.index + hit[0].length)}`;
		});
	}

	/**
	 * Final punctuation hygiene, applied to every surviving string. These artifacts come
	 * from upstream stages that each have a good reason to produce them — dice
	 * substitution leaves "( 2d8 )", truncation leaves "….", and the toggle layer tracks
	 * "(passive; active)" state that means nothing to a DM reading a statblock.
	 */
	static _tidyStatblockText (text) {
		// "Juen May may cast" is a surname colliding with a modal, not a duplicated word.
		// Collapsing it deletes the surname and leaves a sentence that reads as a modal.
		const MODAL_ALT = {may: "can", might: "could", will: "shall", can: "is able to"};
		return this._fixResidualGrammar(String(text || ""))
			.replace(/\((?:\s*(?:passive|active|inactive)\s*[;,]?)+\)/gi, "")
			.replace(/…\s*\./g, "…")
			.replace(/\(\s+/g, "(")
			.replace(/\s+\)/g, ")")
			.replace(/\b(e|i)\.\s+(g|e)\./gi, (m, a, b) => `${a}.${b}.`)
			.replace(/\s+([,.;:!?])/g, "$1")
			// Some upstream pass pads punctuation and turns "2,000 pounds" into "2, 000".
			.replace(/(\d),\s+(\d{3})\b/g, "$1,$2")
			// Substituting the subject into "You may cast…" leaves "Juen May may cast".
			// The lower-cased survivor is the real word; the capital is the leftover —
			// unless a capitalised word precedes it, in which case the pair is a full name.
			.replace(/(\b[A-Z][a-z]{1,20} )?\b([A-Z][a-z]{2,})\s+([a-z]{3,})\b/g, (m, lead, first, second) => {
				if (first.toLowerCase() !== second) return m;
				if (lead && MODAL_ALT[second]) return `${lead}${first} ${MODAL_ALT[second]}`;
				return `${lead || ""}${second}`;
			})
			// An em-dash the source spaced on one side only ("Darkness —such as").
			.replace(/\s+—(?=\S)/g, "—")
			.replace(/\s{2,}/g, " ")
			.trim();
	}

	/**
	 * Residue from the second-person rewrite that the agreement passes cannot reach,
	 * because it sits across a coordinator rather than next to the subject.
	 *
	 * Every rule here is anchored on a *finite* verb ("it makes … and miss") and refuses
	 * to fire when a modal or an infinitive governs the span, because "must succeed on a
	 * saving throw or take damage" is already correct and conjugating it would be wrong.
	 *
	 * @param {string} text entry text
	 * @returns {string} text with coordinated and collided forms repaired
	 */
	/**
	 * "In addition," as the first words of a standalone entry points at a sentence the
	 * trimming passes already removed, so the reader is told this adds to something that
	 * is not there. The connective goes; the rule it introduces stays.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropDanglingConnectives (out) {
		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				const first = entry.entries[0];
				if (typeof first !== "string") return;
				entry.entries[0] = first
					.replace(/^\s*(?:In addition|Additionally|Furthermore|Moreover|Also)\s*,\s*([A-Za-z{])/, (m, ch) => ch.toUpperCase())
					.trim();
			});
		});
	}

	/**
	 * The 2014 and 2024 printings of Fey Ancestry say the same thing in different words,
	 * and a character carrying both lands them side by side: "magic can't put it to sleep
	 * (Fey Ancestry); immunity to being magically asleep".
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropRestatedSleepImmunity (out) {
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(line => {
					if (typeof line !== "string" || !/magic can't put it to sleep/i.test(line)) return line;
					return line
						.replace(/;\s*immunity to being magically asleep\b/i, "")
						.replace(/\bimmunity to being magically asleep\s*;\s*/i, "");
				});
			});
		});
	}

	/**
	 * A scaling ladder is player-facing progression text: "the damage increases to 2d6
	 * when your proficiency bonus is +3, 3d6 at +4, …". An NPC statblock states the
	 * number the creature has now — and once the governing value has been resolved to a
	 * literal the ladder actively misinforms, because the resolver substitutes into the
	 * *condition* rather than using it to select the row: Nagara reads "deal 1d6 … the
	 * damage increases to 2d6 when Nagara's proficiency bonus (+5) is +3", asserting
	 * nonsense while leading with the wrong die.
	 *
	 * Collapses the ladder to the row that applies, rewrites the value stated earlier in
	 * the entry, and drops the progression sentence.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _collapseScalingLadders (out) {
		const DIE = String.raw`\{@(?:damage|dice) ([^}|]+)\}`;
		// The whole sentence: a first row carrying the governing value in parentheses,
		// then any number of bare "X at +N" rows.
		const LADDER = new RegExp(String.raw`[^.]*?\b(?:increases?|rises?|improves?|goes up) to ${DIE} when [^.]*?\(\+?(\d+)\)\s*(?:is|reaches|equals|becomes)\s*\+?(\d+)((?:,?\s*(?:and\s*)?${DIE} at \+?\d+)*)\.\s*`, "g");
		const ROW = new RegExp(String.raw`${DIE} at \+?(\d+)`, "g");

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				// Entry-wide, not per line: the paragraph splitter routinely puts the
				// ladder in its own paragraph, leaving the value it governs behind in an
				// earlier one.
				const lineIdx = entry.entries.findIndex(line => {
					if (typeof line !== "string") return false;
					LADDER.lastIndex = 0;
					return LADDER.test(line);
				});
				if (lineIdx < 0) return;

				const line = entry.entries[lineIdx];
				LADDER.lastIndex = 0;
				const m = LADDER.exec(line);
				const [whole, firstValue, currentRaw, firstThreshold, tail] = m;
				const current = Number(currentRaw);
				if (!Number.isFinite(current)) return;

				const rows = [{value: firstValue, at: Number(firstThreshold)}];
				ROW.lastIndex = 0;
				let r;
				while ((r = ROW.exec(tail || ""))) rows.push({value: r[1], at: Number(r[2])});

				// The best row the creature actually qualifies for. Below the first
				// threshold the value stated ahead of the ladder already applies.
				const applicable = rows.filter(row => current >= row.at).sort((a, b) => b.at - a.at)[0];
				const residue = (line.slice(0, m.index) + line.slice(m.index + whole.length)).trim();
				const next = entry.entries.slice();
				if (residue) next[lineIdx] = residue;
				else next.splice(lineIdx, 1);
				if (!applicable) { entry.entries = next; return; }

				// Restate the value in force, but only where the entry states exactly one
				// ahead of the ladder — with several, which one the ladder governs is
				// guesswork, so the ladder is better left alone.
				const ahead = next.slice(0, residue ? lineIdx + 1 : lineIdx);
				const counts = ahead.map(it => (typeof it === "string" ? (it.match(new RegExp(DIE, "g")) || []).length : 0));
				if (counts.reduce((a, b) => a + b, 0) !== 1) return;
				const target = counts.findIndex(c => c === 1);
				next[target] = next[target].replace(new RegExp(DIE), `{@damage ${applicable.value}}`);
				entry.entries = next;
			});
		});
	}

	/**
	 * A resolved number is not the same as a usable roll. "roll a number of d8s equal to
	 * its Wisdom modifier (5)" states the count but still makes the DM assemble the dice,
	 * and offers nothing to click; "a Fly Speed equal to its Speed" makes them look up a
	 * value the block already prints two lines above. Both are the last places the v13
	 * "state the number" rule had not reached.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _resolveStatedDiceAndSpeeds (out, calculations = {}) {
		const walk = Number(out?.speed?.walk);
		const TAIL = "(?:,?\\s+and add (?:the rolls|them) together)?";
		// A derived value the sheet already knows ("equal to its Rage Damage bonus") reads
		// as homework. Resolving it first lets the dice rules below see a count.
		const DERIVED = [
			[/\bits Rage Damage bonus\b/gi, Number(calculations.rageDamage)],
		].filter(([, value]) => Number.isFinite(value) && value > 0);
		// "To determine this damage, roll a number of d6s equal to … (6)." — the framing
		// clause exists only to introduce the assembly, so state the result instead.
		const FRAMED = new RegExp(`To determine (?:this|the) ([^,]{1,60}), rolls? a number of (d\\d+)s? equal to [^.]*?\\((\\d+)\\)${TAIL}\\.`, "gi");
		const BARE = new RegExp(`rolls? a number of (d\\d+)s? equal to [^.]*?\\((\\d+)\\)${TAIL}`, "gi");
		const SPEED = /\b(a |an )?(fly|flying|swim|swimming|climb|climbing|burrow|burrowing)\s+speed equal to (?:its|it's|the)\s+(?:walking |base |normal )?speed\b/gi;

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(line => {
					if (typeof line !== "string") return line;
					let s = line;
					DERIVED.forEach(([pattern, value]) => { s = s.replace(pattern, `its Rage Damage bonus (${value})`); });
					s = s
						.replace(FRAMED, (m, subject, die, count) => {
							const noun = String(subject).trim();
							return `The ${noun.charAt(0).toLowerCase() + noun.slice(1)} is {@damage ${count}${die}}.`;
						})
						.replace(BARE, (m, die, count) => `roll {@damage ${count}${die}}`);
					if (Number.isFinite(walk) && walk > 0) {
						s = s.replace(SPEED, (m, article, kind) => `${article || "a "}${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()} Speed of ${walk} ft.`);
					}
					return s;
				});
			});
		});
	}

	static _applyResidualGrammar (out) {
		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(it => (typeof it === "string" ? this._fixResidualGrammar(it) : it));
			});
		});
	}

	static _fixResidualGrammar (text) {
		const CONJUGATE = /^(?:miss|push|hit|deal|take|gain|make|move|roll|force|knock|reduce|add)$/;
		const GOVERNED = /\b(?:can|could|must|may|might|shall|should|will|would)\b|\bto (?:make|hit|deal|take|move|push|gain|use|roll|force|cast|attack|do|choose|spend)\b/i;
		return String(text || "")
			.replace(/\b([Ii]t (?:either |also |then )?[a-z]+s\b)([^.;]{0,90}?)(\s(?:and|or)\s)([a-z]+)\b/g, (m, subj, span, coord, verb) => {
				if (!CONJUGATE.test(verb)) return m;
				// The coordinated verb is inside a parenthetical whose own clause governs it.
				if ((span.match(/\(/g) || []).length > (span.match(/\)/g) || []).length) return m;
				// A closed parenthetical carries its own clause, so its verbs say nothing
				// about the one being coordinated here.
				if (GOVERNED.test(span.replace(/\([^)]*\)/g, " "))) return m;
				return `${subj}${span}${coord}${verb === "miss" ? "misses" : `${verb}s`}`;
			})
			// "attack rolls against it has advantage" — plural subject, singular verb.
			.replace(/\b((?:rolls?|attacks?|strikes?)\}? against (?:it|[A-Z][\w' ]{1,24})) has\b/gi, "$1 have")
			// A resolved distance carries its own abbreviating period, so substituting it
			// where a sentence already ended leaves "30 ft..".
			.replace(/\b(ft|in|lb|sq)\.\.(?!\.)/g, "$1.")
			// "As a Bonus Action, it can use it to regain Hit Points" — the second "it" is
			// the feature, and the reader has to work that out mid-sentence.
			.replace(/\bit can use it to ([a-z]+)/g, "it can $1")
			// "(e.g. Its rapier)" — a parenthetical example is not a sentence.
			.replace(/(\be\.g\.\s+)(Its|It|The|A|An)\b/g, (m, lead, word) => `${lead}${word.toLowerCase()}`);
	}

	/**
	 * Entries arrive already split by the structure-aware prose pipeline — often one
	 * sentence per element — so the rules have to see the whole ability at once or a
	 * single-sentence element can never be judged against what follows it.
	 */
	static _compactFeatureEntries (entries, {hasUsesOnName = false} = {}) {
		const source = (entries || []);
		// Clause-level, not just sentence-level: rules text routinely welds a restated
		// mechanic to a novel one with a semicolon ("Its damage die is a d8 …; the weapon
		// is harmless against objects"), and dropping the whole sentence loses the novel half.
		const groups = source.map(text => (typeof text === "string"
			? this._splitIntoClauses(text)
			: [text]));
		const flat = groups.flat();
		if (flat.length <= 1) return source.filter(Boolean);

		const dead = new Set();
		const seen = new Set();
		let leading = true;
		flat.forEach(sentence => {
			if (typeof sentence !== "string") return void (leading = false);
			if (this._isDeadStatblockSentence(sentence, {hasUsesOnName})) return void dead.add(sentence);
			// A leading sentence that establishes no mechanic is pure flavour once a
			// mechanical sentence follows — but a gate ("while wielding a shield") is a
			// mechanic. Only ever one sentence: dropping a *run* eats real text whenever the
			// mechanical-token vocabulary has a gap. A bold label is the entry's identity,
			// never flavour.
			if (leading && !/\{@b/.test(sentence) && !this._hasMechanicalToken(sentence)) {
				leading = false;
				return void dead.add(sentence);
			}
			leading = false;
			// The same trailer repeated on every sub-section (stance boilerplate) only needs
			// saying once.
			const key = sentence.trim().toLowerCase();
			if (key.length < 30) return;
			if (seen.has(key)) return void dead.add(sentence);
			seen.add(key);
		});

		const kept = groups
			.map(group => group.filter(sentence => typeof sentence !== "string" || !dead.has(sentence)))
			.map(group => (group.length === 1 && typeof group[0] !== "string"
				? group[0]
				: this._repairClauseSeam(group.join(" ").replace(/\s+/g, " ").trim())))
			.filter(Boolean);

		// Compaction must never reduce an entry to bookkeeping ("(passive; active)");
		// if nothing with substance survives, the original text was all substance.
		const keptText = kept.filter(it => typeof it === "string").join(" ").replace(/\([^)]*\)/g, "");
		if (!kept.length || !/[a-z]{4}/i.test(keptText)) return source.filter(Boolean);
		return this._demoteOrphanedRider(kept);
	}

	/**
	 * Split prose into judgeable clauses. Punctuation inside parentheses or inside a
	 * `{@tag …}` is structural, not a boundary: "(attuned; orbiting)" is one parenthetical
	 * and splitting it strands an unbalanced paren in the output.
	 */
	static _splitIntoClauses (text) {
		const raw = String(text || "");
		const out = [];
		let depth = 0;
		let start = 0;
		for (let i = 0; i < raw.length; ++i) {
			const ch = raw[i];
			if (ch === "(" || ch === "{") ++depth;
			else if (ch === ")" || ch === "}") depth = Math.max(0, depth - 1);
			else if (depth === 0 && /[.!?;]/.test(ch) && /\s/.test(raw[i + 1] || " ")) {
				const piece = raw.slice(start, i + 1).trim();
				if (piece) out.push(piece);
				start = i + 1;
			}
		}
		const tail = raw.slice(start).trim();
		if (tail) out.push(tail);
		return out.filter(it => it.trim());
	}

	/**
	 * Removing a clause can leave a trailing semicolon or a group that now opens
	 * mid-thought. Re-punctuate so the surviving text still reads as prose. Only the
	 * start of the string is re-capitalised: "reach 5 ft. or range 20/60 ft." proves
	 * a period is not a reliable sentence boundary in rules text.
	 */
	static _repairClauseSeam (text) {
		return String(text || "")
			.replace(/;\s*(?=[.!?]|$)/g, "")
			.replace(/;\s+(?=[A-Z])/g, ". ")
			.replace(/^([a-z])/, (m, c) => c.toUpperCase())
			.trim();
	}

	/**
	 * A shared rider ("If the effect requires a saving throw, it uses a DC of …") is only
	 * meaningful after the options it qualifies. When it lands first it reads as a dangling
	 * reference, so move it below the labelled list it belongs to.
	 * @param {Array<string|Object>} entries
	 * @returns {Array<string|Object>}
	 */
	static _demoteOrphanedRider (entries) {
		if (entries.length < 2) return entries;
		const [first, ...rest] = entries;
		if (typeof first !== "string") return entries;
		if (!/^if (?:the|this|that|it) /i.test(first.trim())) return entries;
		if (!rest.some(it => typeof it === "string" && /^\{@b /.test(it.trim()))) return entries;
		return [...rest, first];
	}

	static _isDeadStatblockSentence (sentence, {hasUsesOnName = false} = {}) {
		const text = this._getPlainMatchText(sentence);
		if (!text) return true;
		// Progression scaffolding: an NPC is a snapshot at one level.
		if (/\bas shown in the .{0,60}\btable\b/.test(text)) return true;
		if (/\breach(?:es)? certain .{0,40}\blevels?\b/.test(text)) return true;
		// An upgrade with no stated trigger cannot be evaluated against a fixed level, and
		// the block already prints the value that applies now.
		if (/^(?:this|the) (?:damage|bonus|die) (?:increases?|improves?|becomes?) to \d*d?\d+\.?$/.test(text)) return true;
		// A level-table collapse that lost its level clauses ("The die becomes a d8 a d10
		// and a d12."). The block already prints the die the character actually has, so the
		// residue is a contradiction rather than information.
		if (/\bdie (?:becomes?|changes? to|improves? to) (?:an? )?d\d+(?:,?\s*(?:and\s+)?(?:an? )?d\d+)+/.test(text)) return true;
		if (/^for example\b/.test(text)) return true;
		// Weapon construction rules. When a feature builds a weapon the block already
		// prints as a full attack line, its damage die, ability modifier and proficiency
		// are all visible in that line's `+X to hit` and damage expression.
		if (/\bdamage die is (?:a |an )?d\d+/.test(text)) return true;
		if (/\b(?:is|are) proficient with (?:it|them|this weapon|these weapons)\b/.test(text)) return true;
		// Rulebook navigation and build-time guidance. A statblock is read at the table,
		// where "see chapter 10 of the Player's Handbook" and "the Rat is recommended"
		// are pure noise — the character has already been built.
		if (/\b(?:see|described in|found in|refer to)\b[^.]{0,60}\b(?:chapter|appendix|table|stat block options|rules)\b/.test(text)) return true;
		if (/\bchapter\s+\d+\b/.test(text)) return true;
		if (/\b(?:player'?s handbook|dungeon master'?s guide|monster manual)\b/.test(text)) return true;
		if (/\b(?:is|are)\s+recommended\b/.test(text)) return true;
		if (/\b(?:dungeon master|dm)\s+(?:permits|allows|decides|approves)\b/.test(text)) return true;
		if (/\bif (?:the|your) (?:dungeon master|dm)\b/.test(text)) return true;
		// Form-change boilerplate. When a feature swaps in another creature's stat block,
		// the manual-reference half — how equipment merges, how objects are handled, which
		// statistics are replaced — is the same for every user of the feature and says
		// nothing about this NPC.
		if (/\bgame statistics are replaced\b/.test(text)) return true;
		if (/\bability to handle objects\b/.test(text)) return true;
		if (/\bequipment\b[^.]*\b(?:merges?|merge with|falls? to the ground|change size or shape|no effect while)\b/.test(text)) return true;
		if (/\bif a (?:skill|saving throw) .{0,40}\bis higher than\b/.test(text)) return true;
		// Stray list fragments ("Hit Points.", "Game Statistics.") left behind when a
		// bulleted source list is flattened into prose. A lowercase or unbalanced fragment
		// is a split artifact rather than a list label, and dropping it corrupts its clause.
		if (!/\{@/.test(String(sentence)) && !/\d/.test(text) && text.split(/\s+/).filter(Boolean).length <= 3) {
			const raw = String(sentence).trim();
			const balanced = (raw.match(/\(/g) || []).length === (raw.match(/\)/g) || []).length;
			if (balanced && /^[A-Z]/.test(raw)) return true;
		}
		// Build-time spellcasting bookkeeping. The block prints one save DC, and every
		// granted spell already carries its granting feature as a hoverable annotation.
		if (/\bspellcasting ability (?:for (?:this|these) spells? )?is the ability (?:score )?increased by this feat\b/.test(text)) return true;
		if (/\bmust be (?:from|of) the .{0,60}\bschool of magic\b/.test(text)) return true;
		if (/\bif it already knows (?:this|either) spell\b/.test(text)) return true;
		if (/\bcan also cast (?:this|these|it|them)[^.]*\busing (?:any )?spell slots?\b/.test(text)) return true;
		if (/\bcan(?:'|\u2019)?t cast (?:that|this|either) spell in this way again until\b/.test(text)) return true;
		// The attack-option preamble ("gains a new attack option…", "the special attack is
		// a ranged spell attack with a range of 30 feet…", "its damage die is a d4"). The
		// exporter now mints a real attack entry from exactly these sentences, so leaving
		// them in prose restates the action line in a strictly less usable form.
		if (/\bgains? a new attack option\b/.test(text)) return true;
		if (/\bspecial attack is an? (?:ranged|melee)(?: spell)? attack with a (?:range|reach) of \d+ feet\b/.test(text)) return true;
		if (/\bis proficient with it\b[^.]*\bmodifier to its attack and damage rolls\b/.test(text)) return true;
		if (/\bits damage is [a-z]+, and its damage die is\b/.test(text)) return true;
		if (/\bthis die changes as\b[^.]*\bshown in the \w+(?: \w+)* column\b/.test(text)) return true;
		// Selection and progression bookkeeping: a statblock states what the creature has,
		// never when it chose a subclass or which later feature widens the option.
		// `text` is already lower-cased here, so these patterns must be case-free.
		if (/\bwhen (?:it|[\w'’ .-]{1,40}) chooses? this (?:tradition|subclass|path|order|circle|domain|oath|archetype)\b/.test(text)) return true;
		if (/\bwhen (?:it|[\w'’ .-]{1,40}) gains? the [\w'’ ]{3,40} feature\b/.test(text)) return true;
		// The provenance label a character builder prints above a feature ("3rd-level
		// College of Creation feature"). It answers "where did this come from", which is a
		// build-time question; the statblock has already answered "what can it do".
		if (/^\d+(?:st|nd|rd|th)[- ]level [\w'’ ]{2,44}(?:optional )?feature\.?$/.test(text)) return true;
		// Options the character will choose later, and the menus they choose from. The
		// picks already made are exported as their own entries.
		if (/\bgains? (?:another|an additional|one more|two|three) [\w'’ ]{0,30}\bat \d+(?:st|nd|rd|th)(?:,\s*\d+(?:st|nd|rd|th))*(?:,? and \d+(?:st|nd|rd|th))? level\b/.test(text)) return true;
		if (/\bgains? \w+ of (?!the following\b)[\w'’ ]{3,40} options? of (?:its|your|their) choice\b/.test(text)) return true;
		if (/\bgains? additional [\w'’ ]{3,40} options? at higher\b/.test(text)) return true;
		// A table flattened into prose by the HTML-to-text conversion. Column headers
		// followed by a long run of bare integers carry no recoverable structure, and the
		// sentence that points at the table is equally unusable without it.
		if (/(?:\b\d+\s+){5,}\d+\s*$/.test(text) && !/\{@/.test(String(sentence))) return true;
		if (/\bthe number shown in the table\b/.test(text)) return true;
		if (/\btable shows the cost\b/.test(text)) return true;
		// Rules the table has to agree on before the feature means anything. A DM running
		// the NPC needs the effect, not the negotiation that produced it.
		if (/\brelies on the table\b/.test(text)) return true;
		if (/\bif (?:either|any) of these assumptions\b/.test(text)) return true;
		if (!hasUsesOnName) return false;
		// Recharge restatements — the `(N/SR)` suffix on the name already says this.
		if (/\bcan use .{0,40}\b(?:once|twice|three times|four times|\d+ times)\b/.test(text)) return true;
		if (/\b(?:regains?|recovers?)\b[^.]*\bexpended uses?\b/.test(text)) return true;
		if (/\bcan(?:'|\u2019)?t (?:do so|use it) again until\b[^.]*\brest\b/.test(text)) return true;
		// "Once it uses this feature, it must finish a rest before it can use it again" is
		// a 1/rest statement, and directly contradicts an `(N/SR)` name suffix for N > 1.
		// It must be the whole sentence — the same sentence often carries a real cost
		// ("…and it suffers one level of exhaustion") that is not a recharge restatement.
		if (/\bonce (?:it|the \w+|\w+) uses? (?:this|the) (?:feature|trait|ability)\b[^.]*\bmust finish\b[^.]*\brest\b[^.]{0,30}\bagain\b\.?$/.test(text)) return true;
		if (/\buse (?:this|the) (?:feature|trait|ability)\b[^.]*\btimes equal to\b/.test(text)) return true;
		if (/\b(?:number of times|uses?) equal to (?:its|your|their) proficiency bonus\b/.test(text)) return true;
		return false;
	}

	static _hasMechanicalToken (sentence) {
		const raw = String(sentence || "");
		if (/\{@(?:dice|damage|dc|hit|atk|condition|skill|spell|scaledamage|recharge|item|chance)\b/.test(raw)) return true;
		const text = this._getPlainMatchText(raw);
		if (/\d/.test(text)) return true;
		if (/\bwhile\b|\bunless\b|\bwhenever\b|\bwhen (?:it|you|a|an|the)\b|\bif it\b|\bif you\b/.test(text)) return true;
		// Flavour describes; mechanics permit or oblige. A modal is the most reliable
		// signal available without a vocabulary that has to be extended per feature.
		if (/\b(?:can|can(?:'|\u2019)t|cannot|must|may|needn(?:'|\u2019)t)\b/.test(text)) return true;
		return /\b(?:bonus action|reaction|as an action|magic action|attack action|saving throw|attack roll|hit points|speed|resistance|immunity|proficiency|opportunity attack|spell slots?|hit dice|short rest|long rest)\b/.test(text)
			|| /\b(?:regains?|recovers?|expends?|expended|restores?)\b/.test(text)
			// An ability check is a mechanic; without this a power whose whole effect is
			// "make a Charisma check to influence that creature" reads as scene-setting.
			|| /\b(?:ability|skill|strength|dexterity|constitution|intelligence|wisdom|charisma) check\b/.test(text)
			// "affects every Medium or smaller light source within range" is the whole
			// mechanic of a power; without these it read as scene-setting and was dropped.
			|| /\bwithin range\b|\btargets?\b/.test(text)
			|| /\b(?:tiny|small|medium|large|huge|gargantuan) or (?:smaller|larger|bigger)\b/.test(text)
			|| /\b(?:has|have|gains?|with|grants?) (?:advantage|disadvantage)\b/.test(text);
	}

	/**
	 * A trait that says "It also has resistance to poison damage" repeats a line the
	 * statblock already prints — and now prints *attributed to this very feature*. Remove
	 * the restating sentence rather than the whole trait, so the mechanics the block has
	 * no room for (advantage on saves, free casting) survive.
	 *
	 * Sentence-level rather than feature-level: the old all-or-nothing residue check kept
	 * 149 characters of duplication because one clause of it was novel.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state
	 */
	static _stripBlockRestatedSentences (out, state) {
		const attributions = this._getDefenseAttributions(state);
		const attributedFeatureKeys = new Set([...attributions.values()]
			.map(it => this._normalizeFeatureKey(it.name))
			.filter(Boolean));
		if (!attributedFeatureKeys.size) return;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section].forEach(entry => {
				const key = this._getStatblockDedupeKey(entry?.name);
				if (!key || !attributedFeatureKeys.has(key)) return;

				entry.entries = (entry.entries || []).map(text => {
					if (typeof text !== "string") return text;
					const kept = text
						.split(/(?<=[.!?])\s+/)
						.filter(sentence => !this._isRestatedSentence(sentence))
						.map(sentence => this._stripRestatedDefenseClause(sentence));
					return kept.join(" ").replace(/\s+/g, " ").trim();
				}).filter(Boolean);
			});
			out[section] = out[section].filter(entry => entry?.entries?.length);
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/**
	 * "It is immune to disease and has advantage on saves against poison" is half
	 * restatement and half novel, so the sentence filter has to keep all of it. Removing
	 * just the restated clause keeps the sentence and drops the duplication.
	 *
	 * @param {string} sentence
	 * @returns {string}
	 */
	static _stripRestatedDefenseClause (sentence) {
		const raw = String(sentence || "");
		const re = /\b(?:is|are)\s+(?:immune|resistant|vulnerable)\s+to\s+(?:the\s+)?[a-z, ]{3,40}?(?:\s+damage|\s+condition)?\s+and\s+(have|has|gain|gains|can|is|are)\b\s*/i;
		const match = re.exec(raw);
		if (!match) return raw;
		if (!this._getDefenseGrantMatches(this._getPlainMatchText(match[0])).length) return raw;
		const verb = {have: "has", gain: "gains", are: "is"}[match[1].toLowerCase()] || match[1];
		return `${raw.slice(0, match.index)}${verb} ${raw.slice(match.index + match[0].length)}`
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * A sentence is redundant only when the thing the block already states is *all* it
	 * says; anything left over after the grant phrase is removed keeps it alive.
	 */
	static _isRestatedSentence (sentence) {
		const raw = String(sentence || "").trim();
		if (!raw) return false;
		if (!this._getDefenseGrantMatches(this._getPlainMatchText(raw)).length) return false;

		const residue = raw
			.replace(/\b(?:resistance|resistant|immunity|immune|vulnerability|vulnerable) to (?:the )?[a-z, ]*?(?: damage| condition)?(?=[.,;]|\band\b|$)/gi, " ")
			.replace(/\bcan(?:'|\u2019)?t be [a-z]+\b/gi, " ");

		// A gate ("while raging") is itself information the flat line cannot carry.
		if (/\bwhile\b|\bunless\b|\bwhen\b/i.test(residue)) return false;
		if (/\{@(?:dc|damage|atk|hit|recharge|scaledamage|condition|spell)\b/.test(residue)) return false;
		if (/\b(?:bonus action|reaction|as an action|magic action|advantage|disadvantage|saving throw|attack roll|spell slot)\b/i.test(residue)) return false;
		return residue.replace(/[^A-Za-z]/g, "").length < 40;
	}

	/**
	 * "gains a +5 bonus to initiative" and "gains a +3 bonus to AC and a +2 bonus to all
	 * saving throws" describe arithmetic the sheet has already performed — the numbers
	 * are sitting in `initiative`, `ac` and `save` a few lines above. Restating them
	 * invites a DM to add them twice.
	 *
	 * Every drop is verified against what was actually folded in: an initiative clause
	 * needs a matching enabled initiative modifier, and an AC clause needs the granting
	 * item credited in `ac[].from`. Anything unverifiable is left alone.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state
	 */
	static _stripRestatedNumericSentences (out, state) {
		const initiativeValues = new Set((state.getNamedModifiers?.() || [])
			.filter(mod => mod?.enabled && !mod.conditional && String(mod.type || "") === "initiative")
			.map(mod => Number(mod.value))
			.filter(Number.isFinite));
		const hasInitiative = out.initiative != null;

		const acSources = new Set();
		(out.ac || []).forEach(row => (row?.from || []).forEach(src => {
			const key = this._normalizeFeatureKey(String(src).replace(/\{@item ([^|}]+)[^}]*\}/g, "$1"));
			if (key) acSources.add(key);
		}));

		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section].forEach(entry => {
				const nameKey = this._normalizeFeatureKey(entry?.name);
				const creditedForAc = [...acSources].some(src => src && nameKey.includes(src));

				entry.entries = (entry.entries || []).map(text => {
					if (typeof text !== "string") return text;
					const kept = text
						.split(/(?<=[.!?])\s+/)
						.filter(sentence => !this._isRestatedNumericSentence(sentence, {
							initiativeValues,
							hasInitiative,
							creditedForAc,
						}));
					return kept.join(" ").replace(/\s+/g, " ").trim();
				}).filter(Boolean);
			});
			out[section] = out[section].filter(entry => entry?.entries?.length);
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	/** @see _stripRestatedNumericSentences */
	static _isRestatedNumericSentence (sentence, {initiativeValues, hasInitiative, creditedForAc} = {}) {
		const raw = String(sentence || "").trim();
		if (!raw) return false;
		const plain = this._stripHtmlTags(raw);

		const grants = [...plain.matchAll(/\+(\d+)\s+bonus to (?:the )?((?:all )?[a-z ]+?)(?=[.,;]|\band\b|$)/gi)];
		if (!grants.length) return false;

		const isFolded = (amount, target) => {
			const what = target.trim().toLowerCase();
			if (/^initiative(?: rolls?)?$/.test(what)) return hasInitiative && initiativeValues.has(amount);
			if (/^(?:ac|armor class)$/.test(what)) return creditedForAc;
			if (/^all saving throws?$/.test(what)) return creditedForAc;
			return false;
		};
		if (!grants.every(m => isFolded(Number(m[1]), m[2]))) return false;

		// Whatever the sentence says *besides* the folded numbers keeps it alive.
		const residue = plain.replace(/(?:gains? )?a? ?\+\d+\s+bonus to (?:the )?(?:all )?[a-z ]+?(?=[.,;]|\band\b|$)/gi, " ");
		if (/\b(?:bonus action|reaction|as an action|magic action|advantage|disadvantage|attack roll|spell slot|can(?:'|\u2019)?t|cannot|resistance|immunity)\b/i.test(residue)) return false;
		return residue.replace(/[^A-Za-z]/g, "").length < 40;
	}

	/**
	 * A feature whose entire content is "you learn spell X" is fully represented by
	 * the `(Feature)` provenance annotation now attached to that spell, so keeping it
	 * as its own ability states the same grant twice. Features that *also* carry
	 * mechanics (Fey Touched's free casting, Telekinetic's shove) are kept intact.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state
	 */
	/**
	 * The class "Spellcasting" feature is character-building instructions — how many
	 * cantrips to know, which table lists the slots, how to prepare each day. The
	 * exporter already emits a real spellcasting block holding the answers those rules
	 * produce, so the feature is redundant by construction whenever that block exists.
	 * @param {Object} out monster object being assembled (mutated)
	 */
	static _dropBuildRulesSpellcastingTrait (out) {
		if (!out.spellcasting?.length) return;
		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const key = this._getStatblockDedupeKey(entry?.name);
				return !/^(?:[a-z]+\s+)?(?:spellcasting|pact magic)$/.test(key || "");
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	static _dropRedundantSpellGrantEntries (out, state) {
		this._dropBuildRulesSpellcastingTrait(out);
		const attributed = new Set();
		const knownSpells = new Set();
		[...(state.getCantripsKnown?.() || []), ...(state.getSpellsKnown?.() || [])].forEach(spell => {
			const label = this._getSpellProvenanceLabel(spell);
			if (label) attributed.add(this._normalizeFeatureKey(label));
			const name = this._normalizeFeatureKey(spell?.name);
			if (name) knownSpells.add(name);
		});
		if (!attributed.size && !knownSpells.size) return;

		["trait", "action", "bonus", "reaction"].forEach(section => {
			if (!out[section]?.length) return;
			out[section] = out[section].filter(entry => {
				const key = this._getStatblockDedupeKey(entry?.name);

				const text = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				if (!/\{@spell /.test(text)) return true;

				// A feature is a pure grant either because provenance says so, or because
				// every spell it names is already printed on the block — Talna's Misty Step
				// sits in her spellbook, so Fey Touched leaves no provenance trail yet still
				// says nothing the reader cannot already see. A feature that *modifies* a
				// spell it already has ("when it casts Moonbeam, it can…") is not a grant.
				const named = [...text.matchAll(/\{@spell ([^|}]+)/g)].map(m => this._normalizeFeatureKey(m[1]));
				const readsAsGrant = /\b(?:learns?|knows?|always (?:has |have )?prepared|can cast|gains? the|adds? the)\b/i.test(text);
				const isGrantOnly = (key && attributed.has(key))
					|| (named.length && readsAsGrant && named.every(name => knownSpells.has(name)));
				if (!isGrantOnly) return true;

				// Whatever survives once every spell-granting sentence is removed is
				// the feature's own mechanics; only an empty remainder is redundant.
				const residue = text
					.split(/(?<=[.!?])\s+/)
					.filter(sentence => !/\{@spell /.test(sentence))
					.join(" ")
					.trim();
				if (/\{@(?:dc|damage|atk|hit|recharge|scaledamage)\b/.test(residue)) return true;
				if (/\b(?:bonus action|reaction|as an action|magic action)\b/i.test(residue)) return true;
				return residue.replace(/[^A-Za-z]/g, "").length >= 60;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});
	}

	static _getStatblockDedupeKey (name) {
		const base = String(name || "").replace(/\([^()]*\)/g, " ").trim();
		return this._normalizeFeatureKey(base);
	}

	static _getStatblockEntryScore (entry) {
		const text = (entry?.entries || []).map(it => (typeof it === "string" ? it : JSON.stringify(it))).join(" ");
		let score = 0;
		if (/\{@(?:atk|hit|damage|dc|recharge)\b/.test(text)) score += 4;
		if (/\(\d+\/(?:LR|SR|Day|Dawn|Short|Long)/i.test(String(entry?.name || ""))) score += 2;
		score += Math.min(2, Math.floor(text.length / 300));
		return score;
	}

	/** "Polearm Master (Bonus Action)" inside the bonus block already says Bonus Action. */
	static _cleanStatblockEntryName (name, section) {
		const label = {bonus: "bonus action", reaction: "reaction", action: "action"}[section];
		if (!label) return name;
		return String(name || "").replace(new RegExp(`\\s*\\(${label}\\)\\s*$`, "i"), "").trim() || name;
	}

	/** Classify features for the export dialog feature picker (non-mutating). */
	static listExportableFeatures (state) {
		const sourceFeatureIds = new Set((state.getNamedModifiers?.() || [])
			.map(mod => mod?.sourceFeatureId)
			.filter(Boolean));
		const features = [
			...(state.getFeatures?.() || [])
				.filter(f => f?.name && f?.description)
				.filter(f => !(typeof CharacterSheetClassUtils !== "undefined" && CharacterSheetClassUtils.isCombatMethod?.(f))),
			...(state.getFeats?.() || [])
				.filter(f => f?.name && f?.description)
				.map(f => ({...f, featureType: f.featureType || "Feat"})),
		];

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
		let resist;
		let immune;
		let vulnerable;
		let conditionImmune;

		if (defenseMode === "active") {
			const effective = state.getEffectiveDefenses?.() || {};
			resist = effective.resistances;
			immune = effective.immunities;
			vulnerable = effective.vulnerabilities;
			conditionImmune = effective.conditionImmunities;
		} else {
			const baseData = state?._data || {};
			const itemDefenses = baseData.itemDefenses || {};
			resist = [...(baseData.resistances || []), ...(itemDefenses.resist || []).map(it => it?.type)];
			immune = [...(baseData.immunities || []), ...(itemDefenses.immune || []).map(it => it?.type)];
			vulnerable = [...(baseData.vulnerabilities || []), ...(itemDefenses.vulnerable || []).map(it => it?.type)];
			conditionImmune = [...(baseData.conditionImmunities || []), ...(itemDefenses.conditionImmune || []).map(it => it?.type)];
		}

		// Permanent named-modifier defenses (no conditional) fold as plain strings.
		const folded = this._getNamedModifierDefenseFolds(state, {conditionalOnly: false, permanentOnly: true});
		// Toggle / conditional defenses always annotate the block (while raging, while in stance, …).
		const rejected = [];
		const conditional = this._getConditionalDefenseAnnotations(state, {rejected});
		const attributions = this._getDefenseAttributions(state);
		// A gated grant that also landed in the flat list would otherwise win, hiding both
		// the gate and the alternate mode; convert rather than duplicate.
		const gatedKeys = new Set(this._getGatedDefenseGrants(state).map(it => `${it.bucket}|${it.value}`));
		// A feature that says "is immune to disease" states a defense the sheet has nowhere
		// to store, so it survived only as a sentence in the feature's trait.
		const featureConditionImmune = [...attributions.entries()]
			.filter(([key]) => key.startsWith("conditionImmune|"))
			.map(([key]) => key.split("|")[1])
			.filter(value => !(conditionImmune || []).map(it => String(it).toLowerCase()).includes(value));
		const unflatten = (values, bucket) => (values || []).filter(v => !gatedKeys.has(`${bucket}|${String(v).toLowerCase()}`));
		// One clause grants several defences, but the sheet stores each separately and a
		// character can end up recording only some of them — Nagara's Stormborn states
		// Cold, Lightning *and* Thunder while the sheet held two, so the printed line
		// contradicted the trait right beside it. Completing the clause is only safe
		// because it is evidence-gated: at least one value must already be present, which
		// proves sheet and exporter agree the feature applies.
		const complete = (values, bucket) => {
			const have = new Set((values || []).map(v => String(v).toLowerCase()));
			const byFeature = new Map();
			attributions.forEach((meta, key) => {
				const [keyBucket, value] = key.split("|");
				if (keyBucket !== bucket || !meta?.featureId) return;
				if (!byFeature.has(meta.featureId)) byFeature.set(meta.featureId, []);
				byFeature.get(meta.featureId).push(value);
			});
			const added = [];
			byFeature.forEach(vals => {
				if (!vals.some(v => have.has(v))) return;
				vals.forEach(v => {
					if (have.has(v) || gatedKeys.has(`${bucket}|${v}`)) return;
					have.add(v);
					added.push(v);
				});
			});
			return added.length ? [...values, ...added] : values;
		};

		return {
			resist: this._mergeDefenseEntries(
				complete(unflatten(this._getSanitizedDefenseList([...(resist || []), ...folded.resist], {rejected, bucket: "resist"}), "resist"), "resist"),
				conditional.resist,
				{attributions, bucket: "resist"},
			),
			immune: this._mergeDefenseEntries(
				complete(unflatten(this._getSanitizedDefenseList([...(immune || []), ...folded.immune], {rejected, bucket: "immune"}), "immune"), "immune"),
				conditional.immune,
				{attributions, bucket: "immune"},
			),
			vulnerable: this._mergeDefenseEntries(
				complete(unflatten(this._getSanitizedDefenseList([...(vulnerable || []), ...folded.vulnerable], {rejected, bucket: "vulnerable"}), "vulnerable"), "vulnerable"),
				conditional.vulnerable,
				{attributions, bucket: "vulnerable"},
			),
			conditionImmune: this._mergeDefenseEntries(
				unflatten(this._getSanitizedDefenseList([...(conditionImmune || []), ...folded.conditionImmune, ...featureConditionImmune], {isCondition: true, rejected, bucket: "conditionImmune"}), "conditionImmune"),
				conditional.conditionImmune,
				{isCondition: true, attributions, bucket: "conditionImmune"},
			),
			offSchema: this._describeOffSchemaDefenses(rejected),
		};
	}

	/**
	 * Permanent (unconditional) named-mod defense folds.
	 * @param {{conditionalOnly?: boolean, permanentOnly?: boolean}} [opts]
	 */
	static _getNamedModifierDefenseFolds (state, {conditionalOnly = false, permanentOnly = false} = {}) {
		const out = {resist: [], immune: [], vulnerable: [], conditionImmune: []};
		const modifiers = state.getNamedModifiers?.() || [];
		const inferredNotes = this._getModifierConditionalNoteMap(state);
		modifiers.forEach(mod => {
			if (!mod || mod.enabled === false) return;
			const explicit = String(mod.conditional || "").trim();
			const inferred = explicit || inferredNotes.get(String(mod.sourceFeatureId || "")) || inferredNotes.get(String(mod.name || "").toLowerCase()) || "";
			const hasCond = !!inferred;
			if (permanentOnly && hasCond) return;
			if (conditionalOnly && !hasCond) return;

			const type = String(mod.type || "");
			const push = (bucket, value) => {
				if (!value) return;
				// The sheet's own feature parser mints defense modifiers from prose, and it
				// mis-reads target-facing clauses ("The creature is immune to the blinded
				// condition") as self-grants. Verify against the source feature before the
				// statblock claims a defense the character does not have.
				if (this._isModifierDefenseContradictedBySource(state, mod, bucket, value)) return;
				if (hasCond) {
					out[bucket].push({value: String(value), note: inferred});
				} else {
					out[bucket].push(String(value));
				}
			};

			if (type.startsWith("conditionImmunity:")) {
				push("conditionImmune", type.slice("conditionImmunity:".length));
				return;
			}
			if (type.startsWith("damageResistance:") || type.startsWith("resist:")) {
				push("resist", type.split(":")[1]);
				return;
			}
			if (type.startsWith("damageImmunity:") || type.startsWith("immune:")) {
				push("immune", type.split(":")[1]);
				return;
			}
			if (type.startsWith("damageVulnerability:") || type.startsWith("vulnerable:")) {
				push("vulnerable", type.split(":")[1]);
			}
		});
		return out;
	}

	/**
	 * Many feature-granted modifiers are stored without a `conditional`, even though the
	 * feature text itself gates them ("While you're raging, you are immune to…").
	 * Exporting those as permanent misstates the statblock, so recover the gate from the
	 * source feature's prose and key it by both feature id and modifier name.
	 * @returns {Map<string, string>}
	 */
	static _getModifierConditionalNoteMap (state) {
		const out = new Map();
		const features = [
			...(state.getFeatures?.() || []),
			...(state.getFeats?.() || []),
		];
		features.forEach(feature => {
			const note = this._inferConditionalNoteFromFeature(feature);
			if (!note) return;
			if (feature.id) out.set(String(feature.id), note);
			const name = String(feature.name || "").trim().toLowerCase();
			if (name && !out.has(name)) out.set(name, note);
		});
		return out;
	}

	/** Extract a short "while …" gate from a feature's own description, or null. */
	static _inferConditionalNoteFromFeature (feature) {
		const name = String(feature?.name || "").trim();
		const text = this._stripHtmlTags(feature?.description || "");
		if (!text) return null;

		if (/\bwhile\s+(?:you(?:'re|\s+are)\s+)?raging\b/i.test(text)
			|| /\bwhile\s+your\s+rage\s+is\s+active\b/i.test(text)
			|| /\braging\b[^.]{0,40}\byou\s+(?:are|gain)\b/i.test(text)) {
			return "while raging";
		}
		if (/\bwhile\s+(?:in\s+)?th(?:is|e)\s+stance\b/i.test(text) || /\bwhile\s+this\s+stance\s+is\s+active\b/i.test(text)) {
			return name ? `while in ${name}` : "while in this stance";
		}
		if (/\bwhile\s+(?:you(?:'re|\s+are)\s+)?(?:wild\s+shaped|transformed)\b/i.test(text)) return "while transformed";
		if (/\bwhile\s+(?:you(?:'re|\s+are)\s+)?concentrating\b/i.test(text)) return "while concentrating";

		const generic = /\bwhile\s+(?:you(?:'re|\s+are)\s+)?([a-z][\w'\- ]{2,32}?)\s*[,.]/i.exec(text);
		if (generic) {
			const phrase = generic[1].trim().toLowerCase();
			if (!/^(you|it|they|the|a|an|this|that)$/.test(phrase)) return `while ${phrase}`;
		}
		return null;
	}

	/**
	 * Available toggle defenses (Rage, active states) + conditional named mods + stance notes.
	 * Always attached with bestiary `{resist:[…], note, cond:true}` shape so the block
	 * documents what the NPC can gain without requiring defenseMode: "active".
	 */
	static _getConditionalDefenseAnnotations (state, {rejected = null} = {}) {
		const out = {resist: [], immune: [], vulnerable: [], conditionImmune: []};

		const pushCond = (bucket, values, note) => {
			const clean = this._getSanitizedDefenseList(values, {isCondition: bucket === "conditionImmune", rejected, bucket});
			if (!clean.length || !note) return;
			out[bucket].push({
				[bucket === "conditionImmune" ? "conditionImmune" : bucket === "immune" ? "immune" : bucket === "vulnerable" ? "vulnerable" : "resist"]: clean,
				note: this._getSafeInlineText(note, {maxLen: 80}),
				cond: true,
			});
		};

		// Named modifiers with explicit conditionals
		const condMods = this._getNamedModifierDefenseFolds(state, {conditionalOnly: true});
		["resist", "immune", "vulnerable", "conditionImmune"].forEach(bucket => {
			const byNote = new Map();
			(condMods[bucket] || []).forEach(entry => {
				if (typeof entry === "string") return;
				const note = entry.note || "conditionally";
				if (!byNote.has(note)) byNote.set(note, []);
				byNote.get(note).push(entry.value);
			});
			byNote.forEach((vals, note) => pushCond(bucket, vals, note));
		});

		// ACTIVE_STATE_TYPES available on this character
		const activeTypes = (typeof CharacterSheetState !== "undefined" && CharacterSheetState.ACTIVE_STATE_TYPES)
			? CharacterSheetState.ACTIVE_STATE_TYPES
			: {};
		const featureNames = [
			...(state.getFeatures?.() || []),
			...(state.getFeats?.() || []),
		].map(f => String(f?.name || "").toLowerCase());
		const calcs = state.getFeatureCalculations?.() || {};
		const poolNames = [
			...(state.getGenericPoolResources?.() || []),
			...(state.getResources?.() || []),
			...(state.getSyntheticCombatResources?.() || []),
		].map(p => String(p?.name || "").toLowerCase());

		Object.values(activeTypes).forEach(def => {
			if (!def?.effects?.length) return;
			const id = String(def.id || "");
			const name = String(def.name || id);
			let available = false;
			if (id === "rage" && calcs.hasRage) available = true;
			// A shared pool is not evidence of a specific feature: every Sorcerer has
			// Sorcery Points, but only a level-18 Shadow Sorcerer has Umbral Form. Requiring
			// the feature itself keeps the block from inventing defenses.
			const hasNamedFeature = () => {
				const nk = this._normalizeFeatureKey(name);
				if (featureNames.some(n => this._featureNameCoversState(this._normalizeFeatureKey(n), nk))) return true;
				return Array.isArray(def.detectPatterns) && featureNames.some(n => def.detectPatterns.some(pat => {
					try { return new RegExp(pat, "i").test(n); } catch { return false; }
				}));
			};
			if (!available && def.resourceName) {
				const rn = this._normalizeFeatureKey(def.resourceName);
				available = poolNames.some(p => this._featureKeyMatches(this._normalizeFeatureKey(p), rn)) && hasNamedFeature();
			}
			if (!available && Array.isArray(def.detectPatterns)) {
				available = featureNames.some(n => def.detectPatterns.some(pat => {
					try { return new RegExp(pat, "i").test(n); } catch { return false; }
				}));
			}
			if (!available) {
				const nk = this._normalizeFeatureKey(name);
				// One-directional on purpose: every token of the *state* name must appear in
				// the feature name. The reverse (used for resource matching) lets a feature
				// named "Champion" unlock the level-18 "Exalted Champion" state.
				available = featureNames.some(n => this._featureNameCoversState(this._normalizeFeatureKey(n), nk));
			}
			if (!available) return;

			const note = id === "rage"
				? "while raging"
				: `while ${name} is active`;

			const resists = [];
			const immunes = [];
			const condImm = [];
			def.effects.forEach(eff => {
				const t = String(eff?.type || "").toLowerCase();
				const target = String(eff?.target || eff?.damageType || "").toLowerCase();
				const dmg = target.replace(/^damage:/, "");
				if (t === "resistance" && dmg && dmg !== "choice" && dmg !== "ancestry") resists.push(dmg);
				if (t === "immunity" && dmg) immunes.push(dmg);
				if (t === "conditionimmunity" || t === "condition_immunity") {
					condImm.push(target.replace(/^condition:/, "") || dmg);
				}
				if (t === "conditionimmunity" || (t === "conditionImmunity".toLowerCase())) {
					condImm.push(String(eff?.condition || target.replace(/^condition:/, "") || "").toLowerCase());
				}
			});
			// Also handle type: "conditionImmunity" with target: "charmed"
			def.effects.forEach(eff => {
				if (String(eff?.type || "") === "conditionImmunity") {
					const c = String(eff.target || eff.condition || "").replace(/^condition:/i, "");
					if (c) condImm.push(c);
				}
			});

			pushCond("resist", resists, note);
			pushCond("immune", immunes, note);
			pushCond("conditionImmune", condImm, note);
		});

		// Combat method stances → annotate parseable defenses with "while in {Stance}"
		const methods = state.getCombatMethods?.() || [];
		methods.filter(m => m?.isStance).forEach(m => {
			const stanceName = this._getSafeInlineText(m.name || "Stance", {maxLen: 60}) || "Stance";
			const note = `while in ${stanceName}`;
			const parsed = this._parseStanceDefenseText(m.description);
			pushCond("resist", parsed.resist, note);
			pushCond("immune", parsed.immune, note);
			pushCond("vulnerable", parsed.vulnerable, note);
			pushCond("conditionImmune", parsed.conditionImmune, note);
		});

		// Any feature body that gates a defense behind a "While …" clause, including the
		// mutually-exclusive modes of a form-swapping feature — both of which must show,
		// since a DM choosing between them needs to see what each one buys.
		const byGate = new Map();
		this._getGatedDefenseGrants(state).forEach(({bucket, value, note}) => {
			const key = `${bucket}|${note}`;
			if (!byGate.has(key)) byGate.set(key, {bucket, note, values: []});
			byGate.get(key).values.push(value);
		});
		byGate.forEach(({bucket, note, values}) => pushCond(bucket, values, note));

		return out;
	}

	/**
	 * "While you are siphoning power from Arch Daemons, you have Resistance to Necrotic"
	 * is a *conditional* defense, but it reaches `_data.resistances` as a flat "necrotic"
	 * with the gate — and the alternate mode entirely — lost. Recover both from the prose.
	 *
	 * @returns {Array<{bucket: string, value: string, note: string}>}
	 */
	static _getGatedDefenseGrants (state) {
		const out = [];
		const features = [
			...(state?.getFeatures?.() || []),
			...(state?.getFeats?.() || []),
		];
		features.forEach(feature => {
			const text = this._getPlainMatchTextCased(feature?.description || "");
			if (!text) return;
			for (const match of text.matchAll(/\bwhile\s+([^,.;]{3,70}?),\s*([^.;]{0,220})/gi)) {
				const gate = this._normalizeDefenseGate(match[1]);
				if (!gate) continue;
				this._getDefenseGrantMatches(match[2]).forEach(({bucket, value}) => {
					out.push({bucket, value: String(value).toLowerCase(), note: `while ${gate}`});
				});
			}
		});
		return out;
	}

	static _normalizeDefenseGate (raw) {
		const phrase = String(raw || "").trim()
			.replace(/^(?:you(?:'re| are)?|it(?:'s| is)?|they(?:'re| are)?|[A-Za-z']+ is)\s+/i, "")
			.replace(/\s+/g, " ")
			.trim();
		if (phrase.length < 3) return "";
		if (/^(?:the|a|an|this|that|there)$/i.test(phrase)) return "";
		return phrase;
	}

	/**
	 * Stances carry their mechanics only in prose — the stored `stanceEffects`
	 * payload is empty in practice — so the defensive clauses are lifted out of the
	 * description text. Kept name-agnostic so any present or future stance works.
	 *
	 * Advantage on saves against a condition is deliberately NOT promoted to a
	 * condition immunity; it is surfaced separately as a conditional note.
	 *
	 * @param {string} description raw (possibly HTML) stance description
	 * @returns {{resist: string[], immune: string[], vulnerable: string[], conditionImmune: string[], saveAdvantage: string[], notes: string[]}}
	 */
	static _parseStanceDefenseText (description) {
		const out = {resist: [], immune: [], vulnerable: [], conditionImmune: [], saveAdvantage: [], notes: []};
		const text = this._getPlainMatchText(description || "");
		if (!text) return out;

		const splitList = raw => String(raw || "")
			.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)
			.map(it => it.trim().toLowerCase())
			.filter(it => it && it.length < 24);

		[...text.matchAll(/\bresistance to ([\w\s,]+?)\s+damage/gi)]
			.forEach(match => out.resist.push(...splitList(match[1])));
		[...text.matchAll(/\bimmunity to ([\w\s,]+?)\s+damage/gi)]
			.forEach(match => out.immune.push(...splitList(match[1])));
		[...text.matchAll(/\bvulnerability to ([\w\s,]+?)\s+damage/gi)]
			.forEach(match => out.vulnerable.push(...splitList(match[1])));
		[...text.matchAll(/\bimmune to (?:the )?([\w\s,]+?) condition/gi)]
			.forEach(match => out.conditionImmune.push(...splitList(match[1])));
		[...text.matchAll(/\badvantage on (?:all )?saving throws (?:made )?(?:to resist|against)\s+(?:being\s+)?([\w\s,]+?)(?:[.;]|$)/gi)]
			.forEach(match => out.saveAdvantage.push(...splitList(match[1])));

		return out;
	}

	/**
	 * Every "while in X" / "while X" annotation promises the reader an ability the
	 * statblock must also define. Toggles reachable only through the sheet UI
	 * (active states, stances) otherwise leave dangling references — Resolute Stance
	 * annotated `conditionImmune` while appearing in no section at all.
	 *
	 * @param {Object} out monster object being assembled (mutated)
	 * @param {Object} state
	 * @param {{npcName: string}} opts
	 */
	static _ensureToggleAbilityIntegrity (out, state, {npcName = "The NPC"} = {}) {
		const referenced = new Map();
		["resist", "immune", "vulnerable", "conditionImmune"].forEach(bucket => {
			(out[bucket] || []).forEach(entry => {
				if (!entry || typeof entry !== "object" || !entry.note) return;
				const match = /^while (?:in )?(.+)$/i.exec(String(entry.note).trim());
				if (!match) return;
				const label = match[1].trim();
				// "raging"/"concentrating" describe a state whose ability is named
				// elsewhere (Rage); only proper-noun toggles need a definition.
				if (!/^[A-Z]/.test(label)) return;
				referenced.set(label.toLowerCase(), label);
			});
		});

		const defined = new Set();
		["trait", "action", "bonus", "reaction"].forEach(section => {
			(out[section] || []).forEach(entry => {
				const base = String(entry?.name || "").replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
				if (base) defined.add(base.toLowerCase());
			});
		});

		const missing = [...referenced.entries()].filter(([key]) => !defined.has(key));

		const activeTypes = (typeof CharacterSheetState !== "undefined" && CharacterSheetState.ACTIVE_STATE_TYPES)
			? Object.values(CharacterSheetState.ACTIVE_STATE_TYPES)
			: [];
		const stances = (state.getCombatMethods?.() || []).filter(m => m?.isStance);

		// A stance that alters defenses, saves, skills or speed is a statblock-level
		// effect even when nothing else references it, so it earns a definition too.
		stances.forEach(stance => {
			const key = String(stance.name || "").toLowerCase();
			if (!key || defined.has(key) || missing.some(([k]) => k === key)) return;
			const parsed = this._parseStanceDefenseText(stance.description);
			const hasEffect = ["resist", "immune", "vulnerable", "conditionImmune", "saveAdvantage"]
				.some(bucket => (parsed[bucket] || []).length);
			if (hasEffect) missing.push([key, this._getSafeInlineText(stance.name, {maxLen: 60})]);
		});

		if (!missing.length) return;

		const added = [];
		missing.forEach(([key, label]) => {
			const stance = stances.find(m => String(m.name || "").toLowerCase() === key);
			const activeType = activeTypes.find(def => String(def?.name || "").toLowerCase() === key);
			const source = stance || activeType;
			if (!source) return;

			const body = this._prepareFeatureTextForNpc(source.description || "", {npcName, maxLen: 600});
			const duration = activeType?.duration ? ` Duration: ${activeType.duration}.` : "";
			if (!body) return;
			added.push({name: label, entries: [`${body}${duration}`]});
		});

		if (!added.length) return;
		out.trait = [...(out.trait || []), ...added];
	}

	static _mergeDefenseEntries (plainList, conditionalEntries = [], {isCondition = false, attributions = null, bucket = ""} = {}) {
		const plains = new Set(plainList || []);
		const out = [];
		const sortedPlains = [...plains].sort((a, b) => a.localeCompare(b));

		// A bare "poison" says nothing about *why* the NPC has it. Grouping the values that
		// share a granting feature under one note keeps the line short while making the
		// source hoverable — and lets that feature's own trait drop the sentence this line
		// now states.
		const byNote = new Map();
		sortedPlains.forEach(value => {
			const attribution = attributions?.get(`${bucket}|${String(value).toLowerCase()}`);
			if (!attribution?.tag) return void out.push(value);
			const noteKey = attribution.tag;
			if (!byNote.has(noteKey)) {
				const holder = {[bucket]: [], note: `(${attribution.tag})`};
				byNote.set(noteKey, holder);
				out.push(holder);
			}
			byNote.get(noteKey)[bucket].push(value);
		});

		const seenCond = new Set();
		const claimed = new Set();
		(conditionalEntries || []).forEach(entry => {
			if (!entry || typeof entry !== "object") return;
			const key = entry.resist
				? "resist"
				: entry.immune
					? "immune"
					: entry.vulnerable
						? "vulnerable"
						: entry.conditionImmune
							? "conditionImmune"
							: null;
			if (!key) return;
			const note = this._canonicalizeConditionalNote(entry.note);
			const vals = (entry[key] || []).filter(v => v && !plains.has(v) && !claimed.has(`${key}|${v}`));
			if (!vals.length) return;
			const sig = `${key}|${vals.slice().sort().join(",")}|${note}`;
			if (seenCond.has(sig)) return;
			seenCond.add(sig);
			vals.forEach(v => claimed.add(`${key}|${v}`));
			out.push({
				[key]: vals,
				note,
				cond: true,
			});
		});
		void isCondition;
		return out;
	}

	/**
	 * Map every damage type / condition the block will print back to the feature that
	 * grants it. A `note` on a resist/immune object is pushed through
	 * `Renderer.get().render()` (`Parser._getFullImmRes_getRenderedObject`), so a tag placed
	 * here hovers on the rendered statblock.
	 * @returns {Map<string, {name: string, tag: string, featureId: string}>} keyed `bucket|value`
	 */
	static _getDefenseAttributions (state) {
		const out = new Map();
		const features = [
			...(state?.getFeatures?.() || []),
			...(state?.getFeats?.() || []).map(f => ({...f, featureType: f?.featureType || "Feat"})),
		];
		features.forEach(feature => {
			const name = String(feature?.name || "").trim();
			if (!name) return;
			const text = this._getPlainMatchText(feature?.description || "");
			if (!text) return;
			const tag = this._getFeatureHoverTag(feature);
			this._getDefenseGrantMatches(text).forEach(({bucket, value}) => {
				const key = `${bucket}|${String(value).trim().toLowerCase()}`;
				if (!key.split("|")[1] || out.has(key)) return;
				out.set(key, {name, tag, featureId: String(feature?.id || "")});
			});
		});
		return out;
	}

	/**
	 * Sentence-level detection of "this feature grants defense X", shared by the defense
	 * annotator and the prose de-duplicator so a line can never be stripped from the text
	 * without the block having gained it.
	 */
	static _getDefenseGrantMatches (plainText, {includeForeign = false} = {}) {
		const out = [];
		const text = String(plainText || "");
		const DMG = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
		const dmg = `(${DMG})`;
		// One clause routinely grants several defences — "Resistance to Cold, Lightning,
		// and Thunder damage". Matching only the type adjacent to "resistance to" left the
		// rest unattributed, so the block printed one value carrying its source note and
		// the others bare, reading as if they were unconditional.
		const LIST = `((?:${DMG})(?:\\s*(?:,\\s*|,?\\s*(?:and|or)\\s+)(?:${DMG}))*)`;
		const scan = (re, bucket) => {
			for (const m of text.matchAll(re)) {
				// "The creature is immune to X" describes the target of an ability, not the
				// creature using it. Without this the block gains defences it does not have.
				const foreign = this._isForeignSubjectDefenseClause(text, m.index);
				if (foreign && !includeForeign) continue;
				const span = String(m[1] || "");
				const values = [...span.matchAll(new RegExp(dmg, "gi"))].map(it => it[1]);
				(values.length ? values : [span]).forEach(value => out.push({bucket, value, foreign}));
			}
		};
		scan(new RegExp(`resistances? to ${LIST}`, "gi"), "resist");
		scan(new RegExp(`resistant to ${LIST}`, "gi"), "resist");
		scan(new RegExp(`immunity to ${LIST} damage`, "gi"), "immune");
		scan(new RegExp(`immune to ${LIST} damage`, "gi"), "immune");
		scan(new RegExp(`vulnerabilit(?:y|ies) to ${LIST}`, "gi"), "vulnerable");
		scan(/\b(?:immune|immunity) to (disease)s?\b/gi, "conditionImmune");
		scan(/immunity to the ([a-z]+(?:(?:,\s*|,?\s*and\s+)[a-z]+)*) conditions?/gi, "conditionImmune");
		scan(/immune to the ([a-z]+(?:(?:,\s*|,?\s*and\s+)[a-z]+)*) conditions?/gi, "conditionImmune");
		// "can't be knocked prone" / "can't be frightened" — the verb is not the condition.
		// Lists share one verb: "can't be charmed or frightened".
		scan(/can(?:'|\u2019)?t be (?:knocked |made |rendered |left )?([a-z]+(?:\s*(?:,\s*|,?\s*(?:and|or)\s+)(?:knocked |made |rendered |left )?[a-z]+)*)\b/gi, "conditionImmune");
		return out
			// A condition clause captured as a list arrives as one span; split it before
			// the vocabulary filter or "charmed and frightened" survives as neither.
			.flatMap(it => (it.bucket === "conditionImmune" && /[, ]/.test(it.value)
				? String(it.value).split(/\s*(?:,|\band\b|\bor\b)\s*/i).filter(Boolean).map(value => ({...it, value}))
				: [it]))
			.map(it => (it.bucket === "conditionImmune" && /^diseases?$/i.test(it.value) ? {...it, value: "disease"} : it))
			.filter(({bucket, value}) => bucket !== "conditionImmune" || this._isKnownConditionName(value));
	}

	/**
	 * True when the source feature only ever mentions this defense as belonging to someone
	 * else. Deliberately conservative: a modifier is dropped only when the feature text
	 * contains a defense-granting phrase for the value *and every one of them* is
	 * foreign-subject, so modifiers whose wording this exporter cannot parse survive.
	 */
	static _isModifierDefenseContradictedBySource (state, mod, bucket, value) {
		const sourceId = String(mod?.sourceFeatureId || "");
		if (!sourceId) return false;
		const feature = [
			...(state?.getFeatures?.() || []),
			...(state?.getFeats?.() || []),
		].find(it => String(it?.id || "") === sourceId);
		if (!feature) return false;

		const text = this._getPlainMatchText(feature.description || "");
		if (!text) return false;
		const wanted = String(value).trim().toLowerCase();
		const matches = this._getDefenseGrantMatches(text, {includeForeign: true})
			.filter(it => it.bucket === bucket && String(it.value).toLowerCase() === wanted);
		if (!matches.length) return false;
		return matches.every(it => it.foreign);
	}

	/**
	 * True when the defence phrase belongs to someone other than this creature — the target
	 * of an ability, or the precondition of an "if X is immune…" clause. Both read exactly
	 * like a self-grant to a naive regex, so the subject has to be resolved before the
	 * block can claim the defence.
	 */
	static _isForeignSubjectDefenseClause (text, matchIndex) {
		const before = String(text || "").slice(0, Number(matchIndex) || 0);
		const boundary = Math.max(
			before.lastIndexOf(". "),
			before.lastIndexOf("! "),
			before.lastIndexOf("? "),
			before.lastIndexOf("\n"),
		);
		const lead = before.slice(boundary + 1);

		// "…if it is immune to the blinded condition" states a condition for the ability to
		// work, never a defence the creature possesses.
		if (/\bif\s+(?:\S+\s+){0,3}(?:is|are|was|were|has|have)\s*$/i.test(lead)) return true;

		// "The creature is immune…", "Each target has resistance…" — the grant lands on a
		// third party. Only fires when the sentence never refers back to this creature, so a
		// genuine "when a creature hits it, it gains resistance" is left alone.
		const foreignSubject = /(?:^|\W)(?:the|a|an|each|that|any|another|every)\s+(?:\w+\s+){0,2}(?:creature|target|enemy|foe|attacker|ally|monster)s?\s+(?:is|are|has|have|gains?|becomes?|takes?)\b/i;
		if (!foreignSubject.test(lead)) return false;
		return !/(?:§§SUBJ§§|\byou\b|\byour\b|\bit\b|\bits\b|\bthey\b|\btheir\b)/i.test(lead);
	}

	static _isKnownConditionName (value) {
		const name = String(value || "").trim().toLowerCase();
		if (!name) return false;
		const known = (typeof Parser !== "undefined" && Array.isArray(Parser.CONDITIONS))
			? Parser.CONDITIONS.map(it => String(it).toLowerCase())
			: [
				"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
				"incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
				"restrained", "stunned", "unconscious",
			];
		// The bestiary schema carries "disease" as a condition-immunity value even though it
		// is not a rules condition, and Paladin/Monk/Warforged features grant it by name.
		return known.includes(name) || name === "disease";
	}

	/**
	 * "Hover when you can" — feats are page-backed and resolve reliably. Class, subclass and
	 * species features are keyed by class/level tuples this exporter cannot reconstruct, so
	 * they degrade to a bare name rather than emitting a link that resolves to nothing.
	 */
	static _getFeatureHoverTag (feature) {
		const name = String(feature?.name || "").trim();
		if (!name) return "";
		const source = String(feature?.source || "").trim();
		const type = String(feature?.featureType || "").toLowerCase();
		if (type === "feat" && source) return `{@feat ${name}|${source}}`;
		// Optional features (maneuvers, invocations, metamagic, fighting styles) are
		// page-backed by name+source exactly as feats are. Combat methods have their own
		// tag and page, so they are routed away from the generic one.
		const optTypes = (feature?.optionalFeatureTypes || []).map(it => String(it).toUpperCase());
		if (source && optTypes.length && !optTypes.some(it => it.startsWith("CTM") || it === "BT")) return `{@optfeature ${name}|${source}}`;
		return name;
	}

	/**
	 * The same gate reaches the exporter from several paths with different phrasing
	 * ("while in Resolute Stance" vs "while resolute stance"); collapse to one form so
	 * duplicate annotations merge instead of stacking.
	 */
	static _canonicalizeConditionalNote (note) {
		const raw = String(note || "").trim().replace(/\s+/g, " ");
		if (!raw) return "conditionally";
		const phrase = raw.replace(/^while\s+/i, "").replace(/^in\s+/i, "").trim();
		if (!phrase) return "conditionally";
		if (/\bstance\b/i.test(phrase)) return `while in ${this._toDisplayTitleCase(phrase)}`;
		// Proper nouns ("Arch Daemons") carry meaning that blanket lower-casing destroys.
		if (/[a-z][A-Z]|\b[A-Z][a-z]/.test(phrase.slice(1))) return `while ${phrase}`;
		return `while ${phrase.toLowerCase()}`;
	}

	/**
	 * The bestiary schema restricts these two lists to fixed vocabularies. Characters
	 * legitimately carry defences outside them ("resistance to spell damage", "immune
	 * to being surprised"), so unknown values are routed to a trait rather than
	 * emitted as invalid enum members and silently dropped by a validator.
	 */
	static _SCHEMA_DAMAGE_TYPES = new Set([
		"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
		"piercing", "poison", "psychic", "radiant", "slashing", "thunder",
	]);

	static _SCHEMA_CONDITIONS = new Set([
		"blinded", "charmed", "deafened", "disease", "exhaustion", "frightened",
		"grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned",
		"prone", "restrained", "stunned", "unconscious",
	]);

	/**
	 * The item schema is `additionalProperties: false`, and a character-sheet item carries
	 * roughly four times as many properties as the schema allows — sheet-only bookkeeping
	 * (`effects`, `itemPowers`, `damageRiders`, `socketedGemstones`, per-ability
	 * `bonusSavingThrow*` splits, …). Bundling an item therefore means whitelisting, not
	 * cleaning. Pinned against the real schema by
	 * `CharacterSheetNpcExporter.companionItems.test.js`, so schema drift fails loudly.
	 */
	static ITEM_SCHEMA_PROPS = new Set([
		"ability", "ac", "additionalEntries", "additionalSources", "age", "alias", "ammoType",
		"atomicPackContents", "attachedSpells", "barDimensions", "baseItem", "basicRules",
		"basicRules2024", "bonusAbilityCheck", "bonusAc", "bonusProficiencyBonus",
		"bonusSavingThrow", "bonusSavingThrowConcentration", "bonusSpellAttack",
		"bonusSpellDamage", "bonusSpellSaveDc", "bonusWeapon", "bonusWeaponAttack",
		"bonusWeaponCritDamage", "bonusWeaponDamage", "capCargo", "capPassenger",
		"carryingCapacity", "charges", "classFeatures", "conditionImmune", "containerCapacity",
		"crew", "crewMax", "crewMin", "critThreshold", "curse", "detail1", "detail2",
		"dexterityMax", "dmg1", "dmg2", "dmgType", "entries", "firearm", "focus", "grantsLanguage",
		"grantsProficiency", "group", "hasFluff", "hasFluffImages", "hasRefs", "immune", "legacy",
		"light", "lootTables", "mastery", "miscTags", "modifySpeed", "name", "optionalfeatures",
		"otherSources", "packContents", "page", "poison", "poisonTypes", "property", "range",
		"rarity", "reach", "recharge", "rechargeAmount", "referenceSources", "reload",
		"reprintedAs", "reqAttune", "reqAttuneAlt", "reqAttuneAltTags", "reqAttuneTags", "resist",
		"scfType", "seeAlsoDeck", "seeAlsoVehicle", "sentient", "shippingCost", "source", "speed",
		"spellScrollLevel", "srd", "srd52", "staff", "stealth", "strength", "tattoo", "tier",
		"travelCost", "type", "typeAlt", "value", "valueMult", "valueRarity", "vehAc",
		"vehDmgThresh", "vehHp", "vehSpeed", "vulnerable", "weaponCategory", "weight",
		"weightMult", "weightNote", "wondrous",
	]);

	/**
	 * The sheet stores several fields under its own names. `typeCode` is the important one:
	 * the sheet's `type` is a human-readable word ("weapon") that is NOT a legal item type
	 * code, while the real code ("M") sits in `typeCode`. Whitelisting alone would happily
	 * ship the invalid value, so the rename has to win over the incumbent.
	 */
	static _ITEM_PROP_RENAMES = {
		typeCode: "type",
		requiresAttunement: "reqAttune",
		properties: "property",
		damage: "dmg1",
	};

	static _isSchemaDefenseValue (value, isCondition) {
		const raw = String(value || "").toLowerCase().trim();
		if (!raw) return false;
		// The schema enums are exact — a compound like "nonmagical bludgeoning" is not a
		// member, so it belongs in prose rather than in the typed list.
		return (isCondition ? this._SCHEMA_CONDITIONS : this._SCHEMA_DAMAGE_TYPES).has(raw);
	}

	static _getSanitizedDefenseList (values, {isCondition = false, rejected = null, bucket = null} = {}) {
		if (!Array.isArray(values)) return [];
		const out = values
			.filter(it => it != null && typeof it !== "object")
			.map(it => String(it || "").split("|")[0])
			.map(it => it.replace(/^damage:/i, "").replace(/^condition:/i, ""))
			.map(it => this._getSafeInlineText(it, {maxLen: 40}).toLowerCase())
			// The sheet stores the adjective; the schema enum is the noun.
			.map(it => (isCondition && /^diseased?$/.test(it) ? "disease" : it))
			.filter(Boolean);
		const deduped = [...new Set(out)].sort((a, b) => a.localeCompare(b));
		const kept = deduped.filter(it => {
			if (this._isSchemaDefenseValue(it, isCondition)) return true;
			if (rejected) rejected.push({value: it, bucket: bucket || (isCondition ? "conditionImmune" : "resist")});
			return false;
		});
		if (!isCondition) return kept;
		return kept.map(it => it.replace(/\s+/g, " ").trim());
	}

	static _OFF_SCHEMA_DEFENSE_PHRASE = {
		resist: v => `resistance to ${v} damage`,
		immune: v => `immunity to ${v} damage`,
		vulnerable: v => `vulnerability to ${v} damage`,
		conditionImmune: v => `immunity to being ${v}`,
	};

	static _describeOffSchemaDefenses (rejected) {
		const seen = new Set();
		const phrases = [];
		(rejected || []).forEach(({value, bucket}) => {
			const key = `${bucket}|${value}`;
			if (seen.has(key)) return;
			seen.add(key);
			const fmt = this._OFF_SCHEMA_DEFENSE_PHRASE[bucket] || this._OFF_SCHEMA_DEFENSE_PHRASE.resist;
			phrases.push(fmt(value));
		});
		return phrases;
	}

	static getValidationIssues (monster) {
		const errors = [];
		const warnings = [];
		// Informational, never a defect. Kept apart from `warnings` so a dependency notice
		// cannot trigger the "exported with validation issues" toast — almost every
		// character references some homebrew, and a warning everybody sees is a warning
		// nobody reads.
		const notes = [];

		if (!monster || typeof monster !== "object") {
			return {errors: ["Monster export payload is missing or invalid."], warnings, notes};
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

		// Third-party brew items keep their own source rather than being copied into this
		// payload, so their hovers depend on the reader's install. Say which ones, instead
		// of shipping a statblock whose links quietly fail for everyone else.
		const externalSources = this.getExternalItemSources(monster);
		if (externalSources.length) {
			notes.push(`Item links resolve only for readers who have installed: ${externalSources.join(", ")}.`);
		}

		return {
			errors: [...new Set(errors)],
			warnings: [...new Set(warnings)],
			notes: [...new Set(notes)],
		};
	}

	static _getAcFromLabels (state) {
		const breakdown = state.getAcBreakdown?.();
		const components = breakdown?.components || [];
		const labels = [];
		const usedItemNames = new Set();

		const armorComp = components.find(c => c?.type === "armor" && c?.name);
		if (armorComp?.name) {
			labels.push(this._getSafeInlineText(armorComp.name, {maxLen: 48}));
			usedItemNames.add(String(armorComp.name).toLowerCase());
		}

		const udComp = components.find(c => c?.type === "base" && /unarmored defense/i.test(String(c?.name || "")));
		if (udComp?.name) {
			const subtype = udComp.subtype ? ` (${udComp.subtype})` : "";
			labels.push(this._getSafeInlineText(`${udComp.name}${subtype}`, {maxLen: 48}));
		}

		// A "Special"/natural base is almost always an item or feature formula
		// (Robe of the Archmagi, Unarmored Defense); name its real source.
		if (!labels.length) {
			const formula = (state._data?.acFormulas || []).find(f => f?.sourceName);
			if (formula?.sourceName) {
				labels.push(this._getSafeInlineText(String(formula.sourceName), {maxLen: 48}));
				usedItemNames.add(String(formula.sourceName).toLowerCase());
			}
		}

		const shieldComp = components.find(c => c?.type === "shield" || /shield/i.test(String(c?.name || "")));
		if (shieldComp) {
			const shieldName = String(shieldComp.name || "").trim();
			const isGeneric = !shieldName || /^shield$/i.test(shieldName);
			labels.push(isGeneric ? "shield" : this._getSafeInlineText(shieldName, {maxLen: 48}));
			usedItemNames.add(shieldName.toLowerCase());
		}

		// The breakdown lumps every AC-granting magic item into one "Magic Items" row,
		// so resolve the actual contributors from the inventory.
		if (components.some(c => c?.type === "item" && Number(c?.value) > 0)) {
			(state.getItems?.() || [])
				.filter(it => (it?.equipped || it?.attuned) && Number(it?.bonusAc) > 0)
				.forEach(it => {
					const name = String(it.name || "").trim();
					if (!name || usedItemNames.has(name.toLowerCase())) return;
					usedItemNames.add(name.toLowerCase());
					labels.push(this._getSafeInlineText(name, {maxLen: 48}));
				});
		}

		// Fallback: equipped armor-like items
		if (!labels.length) {
			const armorItem = (state.getItems?.() || []).find(it => it?.equipped && (it.ac || it.armor || ["LA", "MA", "HA"].includes(String(it.type || "").split("|")[0])));
			if (armorItem?.name) labels.push(this._getSafeInlineText(armorItem.name, {maxLen: 48}));
		}

		if (!labels.length) {
			if (state._hasUnarmoredDefense?.()) labels.push("Unarmored Defense");
			// A character with no armor, shield or AC feature is wearing nothing; calling
			// that "natural armor" invents a trait the sheet never granted.
			else labels.push("unarmored");
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

	/**
	 * Item names in the appositive style ("Retaliator, Sword of Mac Lir") read badly
	 * inside a sentence. The part before the comma is the name proper; the rest is a
	 * title, which the attack entry itself still carries in full.
	 */
	static _getShortAttackName (name) {
		const raw = String(name || "").trim();
		const head = raw.split(",")[0].trim();
		return head.length >= 3 ? head : raw;
	}

	static _getMultiattackAction (state, {npcName = "The NPC", attacks = [], attacksPerAction = 1} = {}) {
		if (attacksPerAction < 2) return null;
		const weaponAttacks = (attacks || []).filter(a => a?.name && !this._isDefaultUnarmedAttack(a));
		// The first attack in the sheet's list is often a rider (a Paladin's Radiant
		// Strikes, a species' Horns) that nobody would open with. Multiattack should
		// name whatever actually hits hardest.
		const named = (attacks || []).filter(a => a?.name);
		const bestOf = list => (list.length ? list.reduce((best, cur) => (this._estimateDamageScore(cur) > this._estimateDamageScore(best) ? cur : best)) : null);
		const bestWeapon = bestOf(weaponAttacks);
		const bestAny = bestOf(named);
		// A monk's Unarmed Strike is not the filler an unarmed strike usually is — when it
		// out-damages every weapon carried, it is the attack the NPC opens with.
		const primary = bestWeapon && (!bestAny || this._estimateDamageScore(bestWeapon) >= this._estimateDamageScore(bestAny))
			? bestWeapon
			: bestAny;
		const attackName = this._getSafeInlineText(this._getShortAttackName(primary?.name) || "weapon attack", {maxLen: 48}) || "weapon attack";

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

	/**
	 * Effective initiative, as a bare number when only the bonus is notable, or as
	 * the object form when the character also rolls with advantage/disadvantage
	 * (Feral Instinct grants advantage without changing the bonus at all).
	 * Returns null when there is nothing a reader can't already derive from DEX.
	 * @param {Object} state
	 * @returns {number|Object|null}
	 */
	static _getInitiativeValue (state) {
		let total = null;
		try {
			const breakdown = state.getInitiativeBreakdown?.();
			if (breakdown && Number.isFinite(Number(breakdown.total))) total = Number(breakdown.total);
		} catch (ignored) { /* fall through to the modifier comparison below */ }

		const dexMod = Number(state.getAbilityMod?.("dex"));
		const isNotableBonus = total != null && !(Number.isFinite(dexMod) && total === dexMod);

		let advantageMode = null;
		try {
			const aggregate = state.aggregateModifiers?.("initiative");
			if (aggregate?.advantage && !aggregate?.disadvantage) advantageMode = "adv";
			else if (aggregate?.disadvantage && !aggregate?.advantage) advantageMode = "dis";
		} catch (ignored) { /* advantage is optional detail */ }

		if (!isNotableBonus && !advantageMode) return null;
		if (!advantageMode) return total;

		const out = {advantageMode};
		if (isNotableBonus) out.initiative = total;
		return out;
	}

	static _getSaveBlock (state) {
		const out = {};
		(Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"]).forEach(abv => {
			const isProficient = !!state.hasSaveProficiency?.(abv);
			const value = Number(state.getSaveMod?.(abv));
			if (!Number.isFinite(value)) return;

			// A save is worth printing when it is proficient OR when its effective
			// value differs from the plain ability modifier a reader would otherwise
			// infer from the ability score. Omitting the latter actively misinforms:
			// a wizard with a Staff of Power (+2 to all saves) and STR 8 exports no
			// Strength save at all, so the statblock reads as -1 instead of +1.
			const abilityMod = Number(state.getAbilityMod?.(abv));
			if (!isProficient && Number.isFinite(abilityMod) && value === abilityMod) return;

			out[abv] = this._toSignedStr(value);
		});
		return out;
	}

	/**
	 * Skills whose 5etools `skill` entity lives outside the core PHB/XPHB set.
	 * `Renderer.monster.getSkillsString` runs every key through
	 * `DataUtil.proxy.unpackUid("skill", key, "skill")`, so keying a homebrew skill
	 * as `name|SOURCE` makes it render AND hover like a first-class skill. Bare keys
	 * would render but link nowhere.
	 */
	static _NON_CORE_SKILL_SOURCES = {
		linguistics: "TGTT",
		culture: "TGTT",
		engineering: "TGTT",
		might: "TGTT",
		endurance: "TGTT",
	};

	/** Display labels for every skill the sheet can track, keyed by normalized key. */
	static _SKILL_LABELS = {
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
		// Homebrew / expanded skills the sheet knows about.
		cooking: "cooking",
		culture: "culture",
		endurance: "endurance",
		engineering: "engineering",
		harvesting: "harvesting",
		linguistics: "linguistics",
		might: "might",
	};

	/**
	 * Every skill key this character could meaningfully have a bonus in: the known
	 * label set plus any character-specific custom or lore skills.
	 * @param {Object} state
	 * @returns {Array<{key: string, label: string}>}
	 */
	static _getKnownSkillKeys (state) {
		const seen = new Set();
		const out = [];
		const push = (key, label) => {
			const normalized = String(key || "").toLowerCase().replace(/\s+/g, "");
			if (!normalized || seen.has(normalized)) return;
			seen.add(normalized);
			out.push({key: normalized, label: label || normalized});
		};

		Object.entries(this._SKILL_LABELS).forEach(([key, label]) => push(key, label));
		(state._data?.customSkills || []).forEach(skill => push(skill?.name, skill?.name));
		(state.getLoreSkills?.() || []).forEach(skill => push(skill?.name || skill, skill?.name || skill));

		return out;
	}

	/**
	 * Look up a skill in an exported skill block, tolerating both bare labels and
	 * `label|SOURCE` UID keys (used for homebrew skills so they hover).
	 * @param {Object|null} skills
	 * @param {string} label
	 * @returns {boolean}
	 */
	static _hasSkillEntry (skills, label) {
		if (!skills || !label) return false;
		const wanted = String(label).toLowerCase().replace(/\s+/g, "");
		return Object.keys(skills).some(key => key.split("|")[0].toLowerCase().replace(/\s+/g, "") === wanted);
	}

	static _getSkillBlock (state) {
		return this._getSkillBlockDetail(state).skills;
	}

	/**
	 * Jack of All Trades (and anything shaped like it) adds the same bonus to every
	 * check the character is not proficient in, so every one of the ~25 skills
	 * "differs from its plain ability modifier" and the per-skill filter admits all
	 * of them. Twenty-five rows of the same arithmetic is not a statblock. Detect a
	 * bonus that is genuinely uniform across the non-proficient skills, drop those
	 * rows, and let the caller state the grant once instead.
	 * @param {Object} state
	 * @returns {{skills: Object, uniform: {value: number, feature: Object|null}|null}}
	 */
	static _getSkillBlockDetail (state) {
		const rows = [];
		this._getKnownSkillKeys(state).forEach(({key, label}) => {
			const value = Number(state.getSkillMod?.(key));
			if (!Number.isFinite(value)) return;
			const abilityKey = state._getBaseSkillAbility?.(key);
			const abilityMod = Number(state.getAbilityMod?.(abilityKey));
			rows.push({
				key,
				label,
				value,
				profLevel: state.getSkillProficiency?.(key) || 0,
				delta: Number.isFinite(abilityMod) ? value - abilityMod : null,
			});
		});

		// The bonus counts as uniform when it is the dominant delta across the
		// non-proficient skills. A handful of skills usually carry something extra on
		// top (a specialty, an item, a homebrew grant); those keep their own row and
		// the summary covers the rest, so no bonus is lost either way.
		const nonProf = rows.filter(it => !it.profLevel && it.delta != null);
		const tally = new Map();
		nonProf.forEach(it => tally.set(it.delta, (tally.get(it.delta) || 0) + 1));
		let uniformValue = 0;
		if (nonProf.length >= this._UNIFORM_SKILL_BONUS_MIN_SKILLS) {
			const [delta, count] = [...tally.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
			if (delta > 0 && count >= Math.ceil(nonProf.length * this._UNIFORM_SKILL_BONUS_SHARE)) uniformValue = delta;
		}

		const out = {};
		rows.forEach(({key, label, value, profLevel, delta}) => {
			if (!profLevel && delta === 0) return;
			if (!profLevel && uniformValue && delta === uniformValue) return;
			const source = this._NON_CORE_SKILL_SOURCES[key];
			const outKey = source ? `${label}|${source}` : label;
			out[outKey] = this._toSignedStr(value);
		});

		return {
			skills: out,
			uniform: uniformValue ? {value: uniformValue, feature: this._getUniformSkillBonusFeature(state)} : null,
		};
	}

	static _UNIFORM_SKILL_BONUS_MIN_SKILLS = 8;
	static _UNIFORM_SKILL_BONUS_SHARE = 0.6;

	/**
	 * Name the feature responsible for a uniform skill bonus by reading what the
	 * character actually has, rather than assuming Jack of All Trades — a homebrew
	 * class could grant the same shape under another name. Returns null when nothing
	 * matches, in which case the bonus is stated without attribution.
	 * @param {Object} state
	 * @returns {Object|null}
	 */
	static _getUniformSkillBonusFeature (state) {
		const candidates = [...(state.getFeatures?.() || []), ...(state.getFeats?.() || [])].filter(Boolean);
		return candidates.find(feature => {
			const text = this._getPlainMatchText(feature?.description || "");
			if (!text) return false;
			// Wording varies across editions ("doesn't already include" / "uses a skill
			// proficiency you lack"); both say the same thing — half proficiency on the
			// checks that would otherwise get none.
			return /\bability check\b/.test(text)
				&& /\bproficienc(?:y|ies)\b/.test(text)
				&& /(?:does\S?nt|do not|doesn t)\s+(?:already|otherwise)\s+(?:include|use|add)|proficiency you lack|not(?:\s+\w+){0,2}\s+proficient/.test(text);
		}) || null;
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
			.filter(it => this._isWeaponItem(it))
			.map(it => this._withBaseWeaponFacts(it));

		const activeWeaponByName = new Map(
			activeWeapons
				.map(it => [String(it.name || "").toLowerCase(), it])
				.filter(([name]) => !!name),
		);

		const attacks = [...(state.getAttacks?.() || [])].map(attack => {
			const key = String(attack?.name || "").toLowerCase();
			const item = key ? activeWeaponByName.get(key) : null;
			if (!item) return attack;

			// Use effective bonuses (includes upgrade effects) when available. These are the
			// same totals the auto-weapon branch below reads — the two branches disagreed
			// until v21, so an upgraded weapon exported different numbers depending on
			// whether the sheet happened to carry a hand-added row of the same name.
			const eff = state.getEffectiveItemBonuses?.(item.id);
			let magicAttackBonus;
			let magicDamageBonus;
			if (eff) {
				magicAttackBonus = Number(eff.totalAttackBonus) || 0;
				magicDamageBonus = Number(eff.totalDamageBonus) || 0;
			} else {
				magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			}
			const inheritedMastery = this._getInheritedMasteryFromBaseItem(item, state);
			const itemMastery = item.mastery?.length
				? item.mastery
				: (inheritedMastery ? [`${inheritedMastery}|${Parser.SRC_XPHB}`] : []);
			const masteryProperty = this._getMasteryName(itemMastery[0]);

			// `_getAttackDamageText` renders this row as `abilityMod + damageBonus`, so the
			// standing total has to land in `damageBonus` or the named damage modifiers and
			// weapon-scoped item bonuses the sheet shows are silently dropped.
			const bd = state.getWeaponDisplayDamageBreakdown?.(attack);
			const damageBonus = bd
				? (Number(bd.base) || 0) + (Number(bd.feature) || 0) + (Number(bd.item) || 0)
				: attack.damageBonus;

			return {
				...attack,
				damageBonus,
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: attack.mastery?.length ? attack.mastery : itemMastery,
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
				magicAttackBonus = eff.totalAttackBonus || 0;
				magicDamageBonus = eff.totalDamageBonus || 0;
				damageDieIncrease = eff.damageDieIncrease || 0;
			} else {
				magicAttackBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponAttack) || 0);
				magicDamageBonus = (Number(item.bonusWeapon) || 0) + (Number(item.bonusWeaponDamage) || 0);
			}
			// The die is taken bare. `CharacterSheetUpgrades.increaseDamageDie` returns *only*
			// the die term it matched, so handing it a whole formula ("2d6+15") silently
			// returns "2d8" and drops the flat bonus — which is how Arthur's Cataclysm
			// exported as 2d8+4 against the sheet's +13.
			let damageDie = String(derived.damage).match(/^\s*(\d+d\d+)/)?.[1] || String(derived.damage);
			if (damageDieIncrease > 0 && typeof CharacterSheetUpgrades !== "undefined") {
				damageDie = CharacterSheetUpgrades.increaseDamageDie(damageDie, damageDieIncrease);
			}
			const exportDamage = this._getWeaponStandingDamage({state, item, derived, damageDie, magicDamageBonus});
			const inheritedMastery = this._getInheritedMasteryFromBaseItem(item, state);
			const itemMastery = item.mastery?.length
				? item.mastery
				: (inheritedMastery ? [`${inheritedMastery}|${Parser.SRC_XPHB}`] : []);
			const masteryProperty = this._getMasteryName(itemMastery[0]);
			const props = item.property || item.properties || derived.properties || [];
			const typeAbv = String(item.type || "").split("|")[0];
			const isRangedType = typeAbv === "R" || typeAbv === "RW";
			const isThrown = props.some(p => p === "T" || String(p).startsWith("T|"));
			attacks.push({
				...derived,
				isMelee: !isRangedType,
				properties: props,
				attackBonus: (Number(derived.attackBonus) || 0) + magicAttackBonus,
				// Already carries the ability modifier and every standing bonus.
				damage: exportDamage,
				// `updateAttackFromWeapon` already folds the ability modifier into `damage`.
				// Rows coming straight from `getAttacks()` do not — the sheet adds it at roll
				// time — so the formatter has to be told which is which rather than guessing
				// from the shape of the formula.
				_damageIncludesAbilityMod: true,
				_sourceItem: item,
				weaponKey: `${item.name}|${item.source || Parser.SRC_XPHB}`,
				mastery: itemMastery,
				masteryProperty,
				magicAttackBonus,
				magicDamageBonus,
				// preserve thrown for attack tag selection
				_isThrown: isThrown,
			});
		});

		return attacks;
	}

	/**
	 * The weapon line's standing damage, composed the way the sheet's combat tab composes
	 * it: the ability modifier plus `getWeaponDisplayDamageBreakdown`.
	 *
	 * The exporter used to read this off `updateAttackFromWeapon` — whose only production
	 * caller it is. That helper folds in `customModifiers.damageBonus`, a field with no
	 * writer and no live reader left anywhere in the sheet, while knowing nothing about the
	 * named damage modifiers (Dueling's +2) and weapon-scoped item bonuses the sheet does
	 * show. Nine of the corpus' characters exported a damage number the sheet disagreed
	 * with, wrong in both directions at once.
	 *
	 * Situational damage is deliberately excluded. Rage, Hybrid Transformation and
	 * active-state bonuses are printed as conditional riders on this same line, so folding
	 * them in here would count them twice.
	 */
	static _getWeaponStandingDamage ({state, item, derived, damageDie, magicDamageBonus}) {
		const abilityMod = Number(state.getAbilityMod?.(derived.abilityMod)) || 0;
		// Mirrors the shape the combat tab builds for an auto-generated weapon attack, so the
		// breakdown resolves the same contributions here as it does on the sheet.
		const breakdown = state.getWeaponDisplayDamageBreakdown?.({
			id: `auto_${item.id}`,
			name: item.name,
			abilityMod: derived.abilityMod,
			damageBonus: magicDamageBonus + (Number(item.customDamageBonus) || 0),
			properties: derived.properties,
			range: derived.range,
			sourceItem: item,
		});
		const standing = breakdown
			? (Number(breakdown.base) || 0) + (Number(breakdown.feature) || 0) + (Number(breakdown.item) || 0)
			: magicDamageBonus;
		const flat = abilityMod + standing;
		if (!flat) return damageDie;
		return `${damageDie}${flat > 0 ? "+" : ""}${flat}`;
	}

	static _isActiveItem (item) {
		if (!item?.equipped) return false;
		// An Ioun Stone functions while it orbits. The sheet tracks orbiting separately
		// from the three-item attunement budget, so demanding the attunement flag hid
		// every stone's actual ability behind an accounting detail.
		if (this._isIounStoneItem(item)) return true;
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
		// A sheet-authored item resolves nowhere, so it travels with the statblock as a
		// companion entity under the export's own source. Tag and entity have to agree,
		// which is why the re-sourcing happens here, at the single choke point every
		// `{@item}` tag passes through.
		const source = this._isCompanionItem(item)
			? CharacterSheetNpcExporter._companionItemSource
			: this._getSafeSourceJson(item?.source || "");
		if (!source) return safeName;
		return `{@item ${safeName}|${source}}`;
	}

	/**
	 * The export source in force for the current conversion, so `_getItemTag` can re-source
	 * companion items without threading an argument through six call sites. Reset per
	 * conversion in the same place v19 resets its casting-time lookup.
	 */
	static _companionItemSource = CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;

	/**
	 * `_isCustom` is set only by deliberate paths — the custom-item editor, `replaceItem`,
	 * and a few sheet-synthesized items (Gambler's weapons, Performance of Creation,
	 * unsocketed gemstones). An ordinary catalog add never sets it, so this never fires on
	 * an item that already has a real home.
	 */
	static _isCompanionItem (item) {
		if (!item || typeof item !== "object") return false;
		return item._isCustom === true || String(item.source || "").toLowerCase() === "custom";
	}

	static _rebuildCompanionItemSource (sourceJson) {
		CharacterSheetNpcExporter._companionItemSource = this._getSafeSourceJson(sourceJson);
	}

	/**
	 * Reshape a character-sheet item into a schema-legal brew item.
	 *
	 * The sheet's shape overlaps the schema's only loosely: a custom dagger can carry ~68
	 * properties of which 17 are legal. Because the item schema is
	 * `additionalProperties: false`, this is a whitelist, not a clean-up — anything the
	 * schema does not name is dropped rather than guessed at.
	 */
	static _getSanitizedBrewItem (item, {sourceJson} = {}) {
		if (!item || typeof item !== "object") return null;

		const name = this._getSafeName(item.name);
		if (!name) return null;

		// Renames run first, and win over any incumbent value. The sheet stores a
		// human-readable `type: "weapon"` next to the real code in `typeCode: "M"`; keeping
		// the incumbent would ship a value the schema's type enum rejects.
		const renamed = {};
		Object.entries(item).forEach(([key, value]) => {
			if (key in CharacterSheetNpcExporter._ITEM_PROP_RENAMES) return;
			renamed[key] = value;
		});
		Object.entries(CharacterSheetNpcExporter._ITEM_PROP_RENAMES).forEach(([from, to]) => {
			if (!(from in item)) return;
			const value = item[from];
			if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
			// `damage` is a duplicate spelling of `dmg1`; never let it clobber a real one.
			if (to === "dmg1" && renamed.dmg1) return;
			renamed[to] = value;
		});

		const out = {};
		Object.entries(renamed).forEach(([key, value]) => {
			if (!CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS.has(key)) return;
			if (!this._isMeaningfulItemValue(key, value)) return;
			out[key] = this._getSanitizedItemValue(key, value);
		});

		out.name = name;
		out.source = this._getSafeSourceJson(sourceJson || CharacterSheetNpcExporter._companionItemSource);
		// `name`, `rarity` and `source` are the schema's only required fields.
		if (typeof out.rarity !== "string" || !out.rarity.trim()) out.rarity = "none";

		return out;
	}

	/**
	 * The sheet writes an exhaustive record — every bonus slot present and zeroed, every
	 * unused container empty. Carrying that through would bury the handful of properties
	 * that actually say something about the item.
	 */
	static _isMeaningfulItemValue (key, value) {
		if (value == null || value === "" || value === false) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === "object") return Object.keys(value).length > 0;
		if (typeof value === "number") {
			if (!Number.isFinite(value)) return false;
			// A zeroed bonus or a zero price is the sheet saying "not applicable".
			if (value === 0 && (/^bonus/.test(key) || key === "value" || key === "weight")) return false;
		}
		return true;
	}

	static _getSanitizedItemValue (key, value) {
		if (key === "entries" || key === "additionalEntries") return this._getSanitizedItemEntries(value);
		if (typeof value === "string") return this._stripHtmlTags(value).trim();
		return value;
	}

	static _getSanitizedItemEntries (entries) {
		if (!Array.isArray(entries)) return entries;
		const out = [];
		entries.forEach(entry => {
			if (typeof entry !== "string") {
				if (entry != null) out.push(entry);
				return;
			}
			// A blank line is authored paragraph structure, but `\n` means nothing to the
			// renderer and `_stripHtmlTags` collapses it away — a 800-word magic item would
			// arrive as one unbroken wall. One array element per paragraph is both the
			// idiomatic shape and the only one that actually renders as paragraphs.
			// `{@tag}`s are preserved verbatim; only stray HTML is removed.
			String(entry)
				.split(/\n\s*\n/)
				.map(para => this._stripHtmlTags(para).trim())
				.filter(Boolean)
				.forEach(para => out.push(para));
		});
		return out;
	}

	/**
	 * Collect the companion items a finished statblock refers to.
	 *
	 * Reading the *finished monster* rather than the state is what keeps the bundle and the
	 * statblock from drifting: an item is bundled precisely when a `{@item}` tag mentions
	 * it, so a custom item the statblock never names is not shipped, and a tag can never
	 * point at an entity that is missing.
	 */
	static buildCompanionItems (monster, state, {sourceJson} = {}) {
		const source = this._getSafeSourceJson(sourceJson || monster?.source || CharacterSheetNpcExporter._companionItemSource);
		const tagged = this._collectItemTagNames(monster, source);
		if (!tagged.size) return [];

		const inventory = state?.getInventory?.() || state?._data?.inventory || [];
		const out = [];
		const seen = new Set();

		inventory.forEach(wrapper => {
			const item = wrapper?.item || wrapper;
			if (!this._isCompanionItem(item)) return;

			const tagName = this._getSafeInlineText(item?.name || "Item", {maxLen: 80}) || "Item";
			if (!tagged.has(tagName.toLowerCase())) return;

			const key = tagName.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);

			const sanitized = this._getSanitizedBrewItem(item, {sourceJson: source});
			if (sanitized) out.push(sanitized);
		});

		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Every `{@item Name|SOURCE}` in the monster whose source is `source`, lowercased. */
	static _collectItemTagNames (monster, source) {
		const wanted = String(source || "").toUpperCase();
		const found = new Set();
		const re = /\{@item ([^|}]+)\|([^|}]+)(?:\|[^}]*)?\}/g;

		const walk = (node) => {
			if (node == null) return;
			if (typeof node === "string") {
				let m;
				re.lastIndex = 0;
				while ((m = re.exec(node)) !== null) {
					if (String(m[2]).trim().toUpperCase() === wanted) found.add(m[1].trim().toLowerCase());
				}
				return;
			}
			if (Array.isArray(node)) return node.forEach(walk);
			if (typeof node === "object") return Object.values(node).forEach(walk);
		};

		walk(monster);
		return found;
	}

	/**
	 * Sources referenced by `{@item}` tags that are neither core nor our own. Their hovers
	 * work only for a reader who has that homebrew installed — worth saying out loud, since
	 * copying the items into our payload would launder somebody else's content.
	 */
	static getExternalItemSources (monster) {
		const own = String(monster?.source || "").toUpperCase();
		const re = /\{@item [^|}]+\|([^|}]+)(?:\|[^}]*)?\}/g;
		const found = new Set();

		const walk = (node) => {
			if (node == null) return;
			if (typeof node === "string") {
				let m;
				re.lastIndex = 0;
				while ((m = re.exec(node)) !== null) {
					const src = String(m[1]).trim().toUpperCase();
					if (src && src !== own && !CharacterSheetNpcExporter._CORE_ITEM_SOURCES.has(src)) found.add(src);
				}
				return;
			}
			if (Array.isArray(node)) return node.forEach(walk);
			if (typeof node === "object") return Object.values(node).forEach(walk);
		};

		walk(monster);
		return [...found].sort();
	}

	/** Sources every 5etools install already has, so a tag pointing at them always resolves. */
	static _CORE_ITEM_SOURCES = new Set([
		"PHB", "DMG", "MM", "XPHB", "XDMG", "XMM", "TCE", "XGE", "SCAG", "VGM", "MTF", "MPMM",
		"FTD", "EGW", "MOT", "AI", "GGR", "SCC", "BMT", "BGG", "TDCSR", "ERLW", "RMR", "SAC",
		"DMG-1", "WDMM", "WBTW", "HOTDQ", "SKT", "TOA", "GOS", "IDRotF", "CM", "CRCotN", "JTTRC",
		"SATO", "DSotDQ", "KFTGV", "PABTSO", "LOX", "DODK", "QFTIS", "VEOR", "AATM", "SCREEN",
	]);

	static _getClassResourcesBlock (state, {npcName = "The NPC", coveredPoolNames = new Set()} = {}) {
		const pools = [];
		const seen = new Set();
		const covered = coveredPoolNames instanceof Set
			? coveredPoolNames
			: new Set([...(coveredPoolNames || [])].map(n => String(n).toLowerCase()));

		const isCovered = (name) => {
			const key = String(name || "").toLowerCase().trim();
			if (!key) return false;
			if (covered.has(key)) return true;
			// "Stone's Endurance" covers pool "Stone's Endurance"; also fuzzy includes
			for (const c of covered) {
				if (!c) continue;
				if (key === c || key.includes(c) || c.includes(key)) return true;
			}
			return false;
		};

		const poolNames = [];
		const pushPool = (raw) => {
			if (!raw?.name) return;
			const max = Number(raw.max);
			if (!Number.isFinite(max) || max <= 0) return;
			const key = String(raw.name).toLowerCase();
			if (seen.has(key)) return;
			if (isCovered(raw.name)) return;
			// Stamina is summarized on the Combat Methods trait header when methods exist.
			if (/^stamina(\s+points)?$/i.test(String(raw.name)) && (state.getCombatMethods?.() || []).length) return;
			seen.add(key);
			const recharge = this._getSafeInlineText(raw.recharge || "", {maxLen: 24});
			const displayMax = max >= 999 ? "∞" : String(max);
			const rechargeBit = recharge
				? (/\b(short|long)\b/i.test(recharge) ? `${recharge} rest` : recharge)
				: "day";
			const name = this._getSafeInlineText(raw.name, {maxLen: 60}) || "Resource";
			poolNames.push({name, displayMax, rechargeBit});
			pools.push(`${name} ${displayMax}/${rechargeBit}`);
		};

		const generic = state.getGenericPoolResources?.() || state.getResources?.() || [];
		generic.forEach(pushPool);

		const synthetic = state.getSyntheticCombatResources?.() || [];
		synthetic.forEach(pushPool);

		const staminaMax = Number(state.getStaminaMax?.() || 0);
		if (staminaMax > 0 && !seen.has("stamina") && !seen.has("stamina points")) {
			const cur = Number.isFinite(Number(state.getStaminaCurrent?.()))
				? Number(state.getStaminaCurrent())
				: staminaMax;
			pushPool({name: "Stamina", current: cur, max: staminaMax, recharge: "short"});
		}

		if (!pools.length) return null;
		// A pool that fuels many abilities has no single home block, but "Class Resources"
		// is a dumping ground, not a statblock trait. Name the trait after the pool.
		if (poolNames.length === 1) {
			const only = poolNames[0];
			const rest = /\brest\b/i.test(only.rechargeBit) ? only.rechargeBit : `${only.rechargeBit}`;
			return {
				// The name uses the compact form every other ability name uses; the sentence
				// below still spells it out.
				name: `${only.name} (${only.displayMax}/${this._abbreviateRecharge(rest)})`,
				entries: [
					`${npcName} has ${only.displayMax} ${only.name}, which it spends on the abilities below and regains on a ${this._titleCaseRecharge(rest)}.`,
				],
			};
		}
		const list = pools.slice(0, 16).join("; ");
		return {
			name: "Class Resources",
			entries: [
				`${npcName} has the following limited-use pools: ${list}.`,
			],
		};
	}

	static _titleCaseRecharge (text) {
		return String(text || "")
			.replace(/\b(short|long|day|dawn|dusk)\b/gi, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase())
			.replace(/\brest\b/gi, "Rest");
	}

	static _collectCoveredResourceNames (state, {featureBlocks, customAbilityBlocks, itemUseBlocks, methodsBlock} = {}) {
		const names = new Set();
		const add = (n) => {
			const key = this._normalizeFeatureKey(n);
			if (key) names.add(key);
			const raw = String(n || "").toLowerCase().replace(/\s*\([^)]*\)\s*$/g, "").trim();
			if (raw) names.add(raw);
		};

		const walk = (blocks) => {
			["trait", "action", "bonus", "reaction"].forEach(sec => {
				(blocks?.[sec] || []).forEach(entry => {
					const name = String(entry?.name || "").replace(/\s*\(\d+\/[^)]+\)\s*$/i, "").trim();
					if (name) add(name);
				});
			});
		};
		walk(featureBlocks);
		walk(customAbilityBlocks);
		walk(itemUseBlocks);

		// Features/feats with uses on the state also cover their pools even if classified away
		[...(state.getFeatures?.() || []), ...(state.getFeats?.() || [])].forEach(f => {
			if (f?.uses?.max > 0 && f?.name) add(f.name);
		});

		if (methodsBlock) add("Stamina");
		return names;
	}

	static _collectRepresentedAbilityNames ({featureBlocks, customAbilityBlocks, itemUseBlocks, methodsBlock} = {}) {
		const names = new Set();
		const add = (n) => {
			const key = this._normalizeFeatureKey(n);
			if (key) names.add(key);
		};
		const walk = (blocks) => {
			["trait", "action", "bonus", "reaction"].forEach(sec => {
				(blocks?.[sec] || []).forEach(entry => {
					const name = String(entry?.name || "").replace(/\s*\(\d+\/[^)]+\)\s*$/i, "").trim();
					if (name) add(name);
					// "Gae Bolg — Enemy-Blinding Radiance" also marks gae bolg
					const base = name.split(/\s+[—–-]\s+/)[0];
					if (base) add(base);
				});
			});
		};
		walk(featureBlocks);
		walk(customAbilityBlocks);
		walk(itemUseBlocks);
		if (methodsBlock) add("Combat Methods");
		return names;
	}

	/**
	 * Shape-shifting is the worst offender for scatter on the block: Tignor's Wild Shape
	 * spans a bonus action plus four separate traits (`Circle Forms`,
	 * `Improved Circle Forms`, `Elemental Wild Shape`, …), each restating the rulebook
	 * rather than the character's actual numbers, and the "rules while shifted" clause
	 * arrives decapitated ("Intelligence, Wisdom, and Charisma scores; class features;
	 * …" with no verb).
	 *
	 * This folds the satellites into the one ability that is actually used, resolves the
	 * formulas to numbers, and drops the fragments. `Wild Resurgence` and
	 * `Wild Companion` stay separate — they are independently usable abilities, not
	 * riders on the transformation.
	 */
	static _consolidateShapeshiftEntries (out, state, {npcName = "The NPC"} = {}) {
		const sections = ["trait", "action", "bonus", "reaction"];

		let host = null;
		sections.forEach(section => {
			(out[section] || []).forEach(e => {
				if (!host && /^wild shape\b/i.test(String(e?.name || ""))) host = e;
			});
		});
		if (!host) return;

		const satelliteRe = /^(circle forms|improved circle forms|elemental wild shape|thousand forms)\b/i;
		const absorbed = [];
		sections.forEach(section => {
			if (!out[section]) return;
			out[section] = out[section].filter(e => {
				if (e === host || !satelliteRe.test(String(e?.name || ""))) return true;
				absorbed.push(e);
				return false;
			});
			if (!out[section].length && section !== "trait") delete out[section];
		});

		const druidLevel = Number(state.getClassLevel?.("Druid")) || 0;

		const resolve = txt => {
			let s = String(txt || "");
			// `_resolveDerivedNumbers` already annotated the common "<multiplier> its X
			// level" shapes; only the Wild Shape-specific divisor is left here.
			if (druidLevel) s = s.replace(/Druid level divided by 3 \(round down\)/gi, `Druid level divided by 3 (${Math.floor(druidLevel / 3)})`);
			return s;
		};

		const seen = new Set();
		const merged = [];
		const push = txt => {
			const s = resolve(txt).trim();
			if (!s) return;
			// A clause with no verb is a splitter artefact, not a rule.
			if (this._isDecapitatedClause(s)) return;
			const key = s.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
			if (!key || seen.has(key)) return;
			seen.add(key);
			merged.push(s);
		};

		(host.entries || []).forEach(push);
		absorbed.forEach(e => {
			const body = (e.entries || []).filter(x => typeof x === "string");
			// The lead-in ("… gains the benefits below") is redundant once folded in.
			const label = this._getSafeInlineText(e.name || "", {maxLen: 48}).replace(/\s*\(\d+\/\w+\)\s*$/, "");
			body.forEach((x, i) => {
				if (i === 0 && /\b(benefits? below|following benefits|granting it the benefits)\b/i.test(x)) return;
				// Give an unlabelled satellite body its source feature's name.
				push(/^\{@b /.test(x) ? x : `{@b ${label}.} ${x}`);
			});
		});

		host.entries = merged;
		void npcName;
	}

	/** A clause with no finite verb before its first separator is a splitter artefact. */
	static _isDecapitatedClause (txt) {
		const s = String(txt || "").trim();
		if (!s) return true;
		// A labelled clause is a deliberate stat line ("Known Forms 8, Max CR 1"), not debris.
		if (/^\{@b /.test(s)) return false;
		const head = s.split(/[.;:]/)[0] || "";
		if (head.length > 90) return false;
		return !/\b(is|are|was|were|has|have|had|can|can't|cannot|may|must|gains?|gain|retains?|uses?|use|makes?|make|deals?|deal|adds?|add|equals?|becomes?|takes?|take|gets?|grants?|gives?|gives|counts?|lasts?|ends?|gets|does|doesn't|gaining|shape-shifts?|transforms?|replaces?|assumes?|leaves?|stays?|expends?|summons?|casts?)\b/i.test(head);
	}

	/**
	 * Every magic item the character owns, not only the equipped ones. A statblock is a
	 * loot list as much as a combat aid, and a stowed Pearl of Power or Javelin of
	 * Lightning is exactly the kind of thing a DM reaches for mid-encounter. Consumables
	 * are collapsed onto one trailing line so a pile of potions can't crowd out the
	 * permanent gear.
	 *
	 * Note this is deliberately looser than `_getMagicItemUseBlocks`, which keeps the
	 * equipped-only gate — a stowed item is worth *listing* but grants no ability.
	 */
	static _getSpecialEquipmentBlock (state) {
		const carried = (state.getItems?.() || []).filter(it => !!it);
		const magic = carried.filter(it => this._isMagicItem(it));
		const poisonLine = this._getCarriedPoisonEntries(carried);

		if (!magic.length && !poisonLine) return null;

		const consumables = magic.filter(it => this._isConsumableItem(it));
		// A dozen Ioun Stones would eat the whole equipment list one bullet at a time, and
		// they read as a set anyway. One line keeps every stone hoverable.
		const stones = magic.filter(it => !this._isConsumableItem(it) && this._isIounStoneItem(it));
		const gear = magic.filter(it => !this._isConsumableItem(it) && !(stones.length > 2 && this._isIounStoneItem(it)));

		const entries = gear
			.map(item => {
				const tag = this._getItemTag(item);
				const notes = [];
				const isActive = this._isActiveItem(item);
				if (item.requiresAttunement) notes.push(isActive ? "attuned" : "requires attunement");
				// Ioun stones only confer benefits while orbiting (equipped).
				if (this._isIounStoneItem(item)) notes.push(item.equipped ? "orbiting" : "stowed");
				else if (!item.equipped) notes.push("carried");
				if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
					const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
					notes.push(`${current}/${Number(item.charges)} charges`);
				}
				// Deliberately no `activation:` note — it is the sheet's internal field name,
				// and the item's own ability block already lands in the right action section.
				return `• ${tag}${notes.length ? ` (${notes.join("; ")})` : ""}`;
			})
			.slice(0, 14);

		if (stones.length > 2) {
			const orbiting = stones.filter(it => it.equipped);
			const stowed = stones.filter(it => !it.equipped);
			const fmt = list => list.map(it => this._getItemTag(it)).join(", ");
			if (orbiting.length) entries.push(`• {@b Ioun Stones (orbiting):} ${fmt(orbiting)}.`);
			if (stowed.length) entries.push(`• {@b Ioun Stones (stowed):} ${fmt(stowed)}.`);
		}

		if (consumables.length) {
			const counted = this._getCountedItemTags(consumables);
			if (counted) entries.push(`• {@b Consumables:} ${counted}.`);
		}

		if (poisonLine) entries.push(poisonLine);

		if (!entries.length) return null;

		return {
			name: "Special Equipment",
			entries,
		};
	}

	/**
	 * The printed save can exceed the sheet's own breakdown, because the breakdown is a
	 * display artefact while `getSaveMod` folds in features the breakdown never lists —
	 * Dark Augmentation being the corpus case. Printed without a word of explanation the
	 * block reads as an arithmetic error, so the difference is named where every other
	 * roll modifier already lives.
	 *
	 * Fails closed: an unattributable difference is stated without a source rather than
	 * credited to a guess.
	 *
	 * @param {Object} out monster object (mutated)
	 * @param {Object} state character state
	 * @param {Object} opts
	 * @param {string} opts.npcName creature name
	 */
	static _explainSaveBonusesOnResilience (out, state, {npcName = "The NPC"} = {}) {
		if (!out.save || typeof state?.getSaveBreakdown !== "function") return;

		const byDelta = new Map();
		Object.entries(out.save).forEach(([abv, printed]) => {
			const shown = Number(state.getSaveBreakdown(abv)?.total);
			const delta = Number(printed) - shown;
			if (!Number.isFinite(delta) || delta <= 0) return;
			if (!byDelta.has(delta)) byDelta.set(delta, []);
			byDelta.get(delta).push(abv);
		});
		if (!byDelta.size) return;
		// An aura already states the same number in the entry the DM reads for it; a second
		// telling in the roll-modifier list is noise, not clarity.
		if (/add \+\d+ to saving throws|bonus to (?:its )?saving throws/i.test(JSON.stringify(out.trait || []))) return;

		const calc = state.getFeatureCalculations?.() || {};
		const clauses = [...byDelta.entries()].map(([delta, abvs]) => {
			const names = abvs.map(it => Parser.attAbvToFull?.(it) || it.toUpperCase());
			const list = names.length === 6
				? "every ability"
				: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
			const source = Number(calc.darkAugmentationSaveBonus) === delta && abvs.length === 3 && abvs.every(it => ["str", "dex", "con"].includes(it))
				? " (Dark Augmentation)"
				: "";
			return `${npcName} gains a +${delta} bonus to saving throws it makes with ${list}${source}`;
		});
		if (!clauses.length) return;

		const resilience = (out.trait || []).find(it => /^resilience$/i.test(String(it?.name || "")));
		if (resilience) {
			const cur = String(resilience.entries[0] || "").replace(/\.$/, "");
			if (/bonus to saving throws/i.test(cur)) return;
			resilience.entries[0] = `${cur}; ${clauses.join("; ")}.`;
			return;
		}
		out.trait = out.trait || [];
		out.trait.unshift({name: "Resilience", entries: [`${clauses.join("; ")}.`]});
	}

	/**
	 * A transformation is not a trait; it is a second set of numbers. Left whole, Dzeiy's
	 * `Hybrid Form` is a 900-character paragraph holding an AC bonus, a resistance list, a
	 * whole unarmed attack and two advantage claims — every one of which the DM has to
	 * transcribe onto the stat line by hand, mid-combat, to actually use the form.
	 *
	 * The user rejected a second statblock ("tedious moving between two"), so the deltas go
	 * where they are read: on the AC, in the resistance list, as a real attack entry, and
	 * in the roll-modifier trait. What is left behind is only what a stat line cannot hold.
	 *
	 * Fails closed throughout: a clause this pass cannot confidently place stays in the
	 * trait rather than being moved to the wrong line.
	 *
	 * @param {Object} out monster object (mutated)
	 * @param {Object} opts
	 * @param {string} opts.npcName creature name
	 */
	static _foldFormTraitOntoLines (out, {npcName = "The NPC"} = {}) {
		const form = (out.trait || []).find(it => /\b(?:hybrid|wild|avatar|beast)\s+form$/i.test(String(it?.name || "").trim()));
		if (!form || !Array.isArray(form.entries)) return;
		const labelName = String(form.name).trim();

		const clauses = form.entries
			.filter(it => typeof it === "string")
			.flatMap(line => line.split(/\s+(?=\{@b [^}]+\.\})/g))
			.map(it => it.trim())
			.filter(Boolean);
		if (clauses.length < 2) return;

		const kept = [];
		let changed = false;
		let mintedStrike = false;

		clauses.forEach(clause => {
			const label = /^\{@b [^}]+\.\}/.exec(clause)?.[0] || "";
			const body = clause.slice(label.length).trim();
			// A clause is rarely one claim. Split to sentences, then split a sentence that
			// welds an advantage claim onto an unrelated bonus, so placing one does not
			// silently discard the other.
			const units = body
				.split(/(?<=[.!?])\s+/)
				.flatMap(it => (/\badvantage on\b/i.test(it) ? it.split(/,\s+and\s+(?=(?:it|they|he|she)\s)/i) : [it]))
				.map(it => it.trim())
				.filter(Boolean);

			const leftover = [];
			units.forEach(unit => {
				if (this._placeFormUnit(unit, {out, label: labelName, npcName})) {
					changed = true;
					return;
				}
				if (/\bunarmed strikes?\b/i.test(this._getPlainMatchText(unit)) && /(?:\{@damage |\b\d*d\d+\b)/.test(unit)) {
					const minted = this._mintFormUnarmedStrike(unit, labelName, out, npcName);
					if (minted) {
						out.action = out.action || [];
						if (!out.action.some(it => it.name === minted.name)) out.action.push(minted);
						changed = true;
						mintedStrike = true;
						return;
					}
				}
				// Once the strike is its own action entry, a leftover sentence about that same
				// strike is a second telling of a line the DM is already reading.
				if (mintedStrike && /\bunarmed strikes?\b/i.test(this._getPlainMatchText(unit))) return;
				leftover.push(unit);
			});

			const surviving = mintedStrike
				? leftover.filter(it => !/\bunarmed strikes?\b/i.test(this._getPlainMatchText(it)))
				: leftover;
			if (!surviving.length) return;
			const rejoined = this._restoreClauseSubject(surviving.join(" ").trim(), npcName);
			kept.push(label ? `${label} ${this._ensureSentence(rejoined)}` : this._ensureSentence(rejoined));
		});

		if (!changed) return;
		if (kept.length) form.entries = kept;
		else out.trait = out.trait.filter(it => it !== form);
	}

	/**
	 * Place one form claim on the stat line it belongs to.
	 *
	 * @param {string} unit a single claim
	 * @param {Object} ctx
	 * @param {Object} ctx.out monster object (mutated)
	 * @param {string} ctx.label form name
	 * @returns {boolean} `true` when the claim was placed and should leave the trait
	 */
	static _placeFormUnit (unit, {out, label}) {
		const plain = this._getPlainMatchText(unit);

		const acBonus = /\+(\d+)\s+bonus to (?:its )?ac\b/i.exec(plain);
		if (acBonus && Array.isArray(out.ac) && out.ac.length) {
			const base = Number(out.ac[0]?.ac);
			if (!Number.isFinite(base)) return false;
			if (!out.ac.some(it => (it.from || []).some(f => String(f) === label))) {
				out.ac.push({ac: base + Number(acBonus[1]), from: [...(out.ac[0].from || []), label], condition: `in ${label}`});
			}
			return true;
		}

		const resist = /\bresistance to ([^.]+?)(?:\.|$)/i.exec(plain);
		if (resist) {
			out.resist = out.resist || [];
			if (out.resist.some(it => typeof it === "object" && String(it.note || "").includes(label))) return true;
			out.resist.push({
				resist: [{special: resist[1].replace(/\s+/g, " ").trim()}],
				note: `while in ${label}`,
				cond: true,
			});
			return true;
		}

		if (/\badvantage on\b/i.test(plain) && !/\bdisadvantage\b/i.test(plain)) {
			const claim = /\badvantage on ([^.]+?)(?:\.|$)/i.exec(unit);
			if (!claim) return false;
			const text = `advantage on ${claim[1].trim()} (${label})`;
			const resilience = (out.trait || []).find(it => /^resilience$/i.test(String(it?.name || "")));
			if (resilience) {
				const cur = String(resilience.entries[0] || "").replace(/\.$/, "");
				if (!cur.toLowerCase().includes(claim[1].trim().toLowerCase())) resilience.entries[0] = `${cur}; ${text}.`;
			} else {
				out.trait = out.trait || [];
				out.trait.unshift({name: "Resilience", entries: [`${text.charAt(0).toUpperCase()}${text.slice(1)}.`]});
			}
			return true;
		}

		return false;
	}

	/**
	 * Splitting a welded sentence can leave a fragment opening on a bare pronoun
	 * ("it has a +2 bonus…"). Restore the subject so the surviving clause still reads
	 * as a sentence.
	 *
	 * @param {string} text clause text
	 * @param {string} npcName creature name
	 * @returns {string} the clause with a stated subject
	 */
	static _restoreClauseSubject (text, npcName) {
		const trimmed = String(text).trim();
		if (!/^(?:it|they|he|she)\s/i.test(trimmed)) return trimmed;
		return `${npcName} ${trimmed.replace(/^(?:it|they|he|she)\s+/i, "")}`;
	}

	/**
	 * @param {string} text sentence text
	 * @returns {string} the text with terminal punctuation
	 */
	static _ensureSentence (text) {
		const trimmed = String(text).trim();
		return /[.!?:)"\]}]$/.test(trimmed) ? trimmed : `${trimmed}.`;
	}

	/**
	 * Build the attack entry a form's unarmed-strike clause describes, reusing the
	 * creature's best melee attack bonus so the line is usable without cross-referencing.
	 *
	 * @param {string} clause the form clause
	 * @param {string} label form name
	 * @param {Object} out monster object
	 * @param {string} npcName creature name
	 * @returns {Object|null} attack entry, or `null` when the clause is not specific enough
	 */
	static _mintFormUnarmedStrike (clause, label, out, npcName) {
		const dice = /\{@damage ([^}]+)\}/.exec(clause)?.[1] || /\b(\d*d\d+)\b/.exec(clause)?.[1];
		if (!dice) return null;
		const type = /(?:\}|\d)\s*([a-z]+(?:\s+or\s+[a-z]+)?)\s+damage/i.exec(clause)?.[1] || "bludgeoning";
		const hit = /\{@hit \\?"?([+-]?\d+)/.exec(JSON.stringify(out.action || []))?.[1];
		if (!hit) return null;

		const notes = [];
		if (/\bone additional unarmed strike as a bonus action\b/i.test(clause)) notes.push(`${npcName} can make one additional unarmed strike as a bonus action.`);
		// A rite the form extends to unarmed strikes is damage on this line, not a footnote.
		if (/\bcrimson rite\b/i.test(clause)) notes.push("Its Crimson Rite can be applied to these strikes.");
		if (/\buse dexterity instead of strength\b/i.test(clause)) notes.push("It uses Dexterity for these attack and damage rolls.");
		const extra = notes.length ? ` ${notes.join(" ")}` : "";
		return {
			name: `Unarmed Strike (${label})`,
			entries: [`{@atk mw} {@hit ${hit}} to hit, reach 5 ft., one target. {@h} {@damage ${dice}} ${type} damage.${extra}`],
		};
	}

	/** Standing injury poisons, by name: the save DC and the damage a failed save takes. */
	static _POISON_FACTS = {
		"purple worm poison": {dc: 19, fail: "12d6", success: "6d6"},
		"wyvern poison": {dc: 15, fail: "7d6", success: "3d6"},
		"serpent venom": {dc: 11, fail: "3d6", success: "1d6"},
		"drow poison": {dc: 13, fail: "", success: ""},
		"carrion crawler mucus": {dc: 13, fail: "", success: ""},
		"assassin's blood": {dc: 10, fail: "6", success: "3"},
		"malice": {dc: 15, fail: "", success: ""},
		"midnight tears": {dc: 17, fail: "31d6", success: "15d6"},
		"oil of taggit": {dc: 13, fail: "", success: ""},
		"pale tincture": {dc: 16, fail: "1d6", success: ""},
		"torpor": {dc: 15, fail: "", success: ""},
		"truth serum": {dc: 11, fail: "", success: ""},
		"burnt othur fumes": {dc: 13, fail: "3d6", success: ""},
		"essence of ether": {dc: 15, fail: "", success: ""},
	};

	/**
	 * A carried poison is a whole extra attack the DM can choose to make, and it never
	 * reached the block: a poison is ordinary gear, not a magic item, so the equipment
	 * list filtered it out. It belongs there with its numbers stated, because "it has
	 * purple worm poison" is only useful if the DM also knows it is a {@dc 19} save for
	 * 12d6.
	 *
	 * Numbers come from a table of the published injury poisons; a poison this exporter
	 * does not recognise is still named, just without invented figures.
	 *
	 * @param {Array} items inventory items
	 * @returns {string} a bullet line, or `""` when the creature carries no poison
	 */
	static _getCarriedPoisonEntries (items) {
		const seen = new Map();
		(items || []).forEach(item => {
			const name = String(item?.name || "").trim();
			if (!name || !/\bpoison|venom|tears|tincture|torpor|malice|mucus|fumes|ether\b/i.test(name)) return;
			// A poisoner's kit makes poison; it is not poison.
			if (/\bkit\b|resist|immunity|absorb/i.test(name)) return;
			const key = name.toLowerCase();
			if (!this._POISON_FACTS[key] && !/poison|venom/i.test(name)) return;
			seen.set(key, {item, count: (seen.get(key)?.count || 0) + (Number(item.quantity) || 1)});
		});
		if (!seen.size) return "";

		const parts = [...seen.values()].map(({item, count}) => {
			const tag = this._getItemTag(item);
			const facts = this._POISON_FACTS[String(item.name || "").toLowerCase()];
			const qty = count > 1 ? ` ×${count}` : "";
			if (!facts) return `${tag}${qty}`;
			// Nested parentheses read badly and trip the balance check, so the whole fact
			// stays inside one pair.
			const damage = facts.fail
				? `, {@damage ${facts.fail}} poison damage${facts.success ? `, half as much on a success` : ""}`
				: "";
			return `${tag}${qty} ({@dc ${facts.dc}} Constitution save${damage})`;
		});
		return `• {@b Poisons:} ${parts.join("; ")}. Coating a weapon or piece of ammunition with an injury poison takes an action, and the coating lasts until it hits or 1 minute passes.`;
	}

	/**
	 * Divine Favor reached the block through the residual custom-modifier path, which
	 * flattened structured boons into garbage like "+1 to Advantage checks when judging
	 * the sincerity of an oath, vow, or testimony (While devoted to Zeus, …)". The
	 * homebrew catalog is fully structured and every boon carries a player-facing
	 * `desc`, so the trait is built from the unlocked tiers directly.
	 *
	 * Degrades to today's behaviour (no trait) when the catalog was never loaded, which
	 * is the case in any environment that has not seen the homebrew file.
	 */
	static _getDivineFavorBlock (state, {npcName = "The NPC"} = {}) {
		const favor = state.getDivineFavor?.();
		const god = state.getDivineFavorGodData?.();
		if (!favor?.god || !god?.tiers?.length) return null;

		const earned = Number(favor.favor) || 0;
		const unlocked = god.tiers
			.filter(tier => (Number(tier?.favor) || 0) <= earned)
			.sort((a, b) => (Number(a.favor) || 0) - (Number(b.favor) || 0));
		if (!unlocked.length) return null;

		const entries = [];
		unlocked.forEach(tier => {
			const tierLabel = this._getSafeInlineText(tier.name || "Boon", {maxLen: 48});
			let isFirstOfTier = true;
			(tier.boons || []).forEach(boon => {
				// An ability score boost is already folded into the printed scores.
				if (String(boon?.type || "") === "abilityScoreBoost") return;
				const text = this._prepareFeatureTextForNpc(String(boon?.desc || ""), {npcName});
				if (!text) return;
				// Label once per tier — repeating "Devotee." on every boon is noise.
				entries.push(isFirstOfTier ? `{@b ${tierLabel} (favor ${Number(tier.favor) || 0}).} ${text}` : text);
				isFirstOfTier = false;
			});
		});
		if (!entries.length) return null;

		const godName = this._getSafeInlineText(god.name || "a deity", {maxLen: 48});
		entries.unshift(`${npcName} is devoted to ${godName} (favor ${earned}).`);

		return {name: `Divine Favor (${godName})`, entries};
	}

	/** A one-use item (potion, elixir, scroll, ammunition) — listed, but not itemised. */
	static _isConsumableItem (item) {
		const type = String(item?.type || "").split("|")[0].toUpperCase();
		if (["P", "SC", "A", "AF"].includes(type)) return true;
		return /^(potion|elixir|philter|oil|dust|scroll) /i.test(String(item?.name || ""));
	}

	/** `{@item Potion of Heroism|XDMG} x2, {@item Elixir of Health|XDMG}` */
	static _getCountedItemTags (items) {
		const counts = new Map();
		items.forEach(item => {
			const tag = this._getItemTag(item);
			if (!tag) return;
			const qty = Math.max(1, Number(item.quantity) || 1);
			counts.set(tag, (counts.get(tag) || 0) + qty);
		});
		return [...counts.entries()]
			.slice(0, 10)
			.map(([tag, n]) => (n > 1 ? `${tag} x${n}` : tag))
			.join(", ");
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
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const items = (state.getItems?.() || [])
			.filter(it => !!it)
			.filter(it => this._isActiveItem(it))
			.filter(it => this._isMagicItem(it));
		const spells = state.getItemGrantedSpells?.() || [];
		const ownedItemKeys = new Set(items.map(it => this._normalizeFeatureKey(it?.name)).filter(Boolean));
		const seenNames = new Set();
		const seenBodies = new Set();

		const pushEntry = (section, entry) => {
			const key = this._normalizeFeatureKey(entry?.name);
			if (key && seenNames.has(key)) return;
			const bodySig = this._getEntryBodySignature((entry?.entries || [])[0]);
			// Two items granting the same benefit (Robe "Magic Resistance" vs Necklace
			// "Master Smith's Aegis") should print once.
			if (bodySig && seenBodies.has(bodySig)) return;
			if (key) seenNames.add(key);
			if (bodySig) seenBodies.add(bodySig);
			(out[section] || out.action).push(entry);
		};

		items.forEach(item => {
			const itemName = this._getSafeInlineText(item.name || "Magic Item", {maxLen: 80}) || "Magic Item";
			const namedKids = this._getNamedItemEntryChildren(item);
			let emittedNamed = false;

			namedKids.forEach(child => {
				const section = this._getActivationSectionFromText(child.text) || "trait";
				// Skip pure attack restatements already covered by the weapon action line
				if (this._isItemEntryAttackRestatement(child, item)) return;
				if (this._isItemEntryAlreadyOnBlock(child)) return;
				if (this._isItemEntryBearerAgnostic(child)) return;
				if (this._isItemEntryUnownedVariant(child, item, ownedItemKeys)) return;
				if (this._isStatOnlyItemSnippet(this._stripHtmlTags(child.text || ""))) return;
				const usesBit = this._extractUsesFromItemText(child.text);
				// "Ioun Stone #010, Pearly White Spindle — Stone Effect" is nine words of
				// catalogue index for one ability. The stone's colour is its name.
				const isStone = this._isIounStoneItem(item);
				if (isStone && !/^stone effect$/i.test(child.name)) return;
				// Parenthesised, every stone would share the dedupe key "ioun stone" and
				// eleven of the twelve would vanish; the em-dash form keeps them distinct.
				const baseName = isStone
					? `Ioun Stone \u2014 ${itemName.replace(/^ioun stone\s*#?\d*,?\s*/i, "")}`
					: `${itemName} \u2014 ${child.name}`;
				const displayName = usesBit ? `${baseName} ${usesBit}` : baseName;
				const body = this._prepareFeatureEntriesForNpc(child.text, {npcName});
				if (!body.length) return;
				emittedNamed = true;
				pushEntry(section, {name: displayName, entries: body});
			});

			// Fallback: structured activation without named children
			if (!emittedNamed && item.activation?.length) {
				const activationTypes = new Set(item.activation.map(a => String(a?.type || "").toLowerCase()));
				const snippet = this._getItemUseSnippet(item, {npcName});
				// An item whose whole benefit is a stat increase is already fully expressed
				// by the ability scores, AC and saves it changed — a trait restating it adds
				// nothing. This is the common case for Ioun Stones.
				if (this._isStatOnlyItemSnippet(snippet)) return;
				const itemTag = this._getItemTag(item);
				const entry = {
					name: itemName,
					entries: [`${itemTag}: ${snippet.replace(/\.\s*$/, "")}.`],
				};
				if (activationTypes.has("reaction")) pushEntry("reaction", entry);
				else if (activationTypes.has("bonus")) pushEntry("bonus", entry);
				else pushEntry("action", entry);
			}
		});

		// Group item-granted spells into one entry per item (bestiary style) instead
		// of one action per spell, and never leak raw `name|source` UIDs.
		const spellsByItem = new Map();
		spells.forEach(sp => {
			const itemName = this._getSafeInlineText(sp?.sourceItem || "Magic Item", {maxLen: 80}) || "Magic Item";
			if (!spellsByItem.has(itemName)) spellsByItem.set(itemName, []);
			spellsByItem.get(itemName).push(sp);
		});

		spellsByItem.forEach((itemSpells, itemName) => {
			const byUsage = new Map();
			itemSpells.forEach(sp => {
				const {name: spellName, source: spellSrc} = this._parseSpellUid(sp?.name, sp?.source);
				const usage = this._getItemSpellUsageText(sp) || "";
				if (!byUsage.has(usage)) byUsage.set(usage, []);
				byUsage.get(usage).push(this._formatSpellTag({name: spellName, source: spellSrc}, {showProvenance: false}));
			});

			const clauses = [...byUsage.entries()].map(([usage, tags]) => {
				const list = tags.join(", ");
				return usage ? `${usage} \u2014 ${list}` : list;
			});
			const hasUsage = [...byUsage.keys()].some(Boolean);

			const ownerItem = items.find(it => this._getSafeInlineText(it.name || "", {maxLen: 80}) === itemName);
			const charges = Number(ownerItem?.charges);
			const chargeBit = Number.isFinite(charges) && charges > 0 ? ` (${charges} charges)` : "";

			const entry = {
				name: `${itemName}${chargeBit} — Spells`,
				entries: [hasUsage
					? `${npcName} can cast the following spells from the ${itemName.replace(/^(the|a|an)\s+/i, "").toLowerCase()}: ${clauses.join("; ")}.`
					: `${npcName} can cast ${clauses.join("; ")}.`],
			};

			const activationTypes = new Set((ownerItem?.activation || []).map(a => String(a?.type || "").toLowerCase()));
			if (activationTypes.has("reaction")) pushEntry("reaction", entry);
			else if (activationTypes.has("bonus")) pushEntry("bonus", entry);
			else pushEntry("action", entry);
		});

		return out;
	}

	/**
	 * Item entries that only restate a number already printed elsewhere on the block
	 * (AC, spell save DC, charge regain) are bookkeeping, not statblock content.
	 */
	static _isItemEntryAlreadyOnBlock (child) {
		const name = String(child?.name || "").trim().toLowerCase();
		const text = this._stripHtmlTags(child?.text || "").toLowerCase();
		if (!text) return true;
		const hasActionEconomy = /\b(?:an? action|bonus action|reaction|attack roll|damage roll)\b/.test(text);

		// Charge economy is DM bookkeeping; the charge total is already on the item entry.
		if (/regains?\b[^.]{0,40}\bcharges?\b/.test(text)) return true;
		// Pure AC restatement — already folded into the block's Armor Class.
		if (name === "armor" && /\barmor class\b/.test(text)) return true;
		// Pure caster-stat restatement — already folded into the spellcasting header.
		if (/\bspell save dc\b/.test(text) && /\bspell attack\b/.test(text) && !hasActionEconomy) return true;
		return false;
	}

	/**
	 * The item's entire benefit is a passive stat change, so it is already fully
	 * expressed by the ability scores / AC / saves the sheet folded it into. Requires
	 * *every* sentence to be a stat change — one action, one condition, one anything
	 * else and the item keeps its entry.
	 */
	static _isStatOnlyItemSnippet (snippet) {
		const text = this._stripHtmlTags(snippet || "").trim();
		if (!text) return true;
		// A flat numeric bonus is already inside the attack line, AC or save it modifies,
		// and an extra class level is already inside the whole build.
		// Tags hide the economy words: "{@action Magic|XPHB} action" reads as an action
		// only once the tag is reduced to its display text.
		const plain = text.replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?\}/g, "$1");
		const hasEconomy = /\b(?:once per|bonus action|reaction|magic action|as an action|takes? an? [a-z ]{0,12}action|can'?t be used again|next dawn|casts?|spell|charges?)\b/i.test(plain);
		if (!hasEconomy) {
			if (/\bgains? an? \+\d+ bonus to [^.]{0,80}?\b(?:attack|damage|armor class|\bac\b|saving throws?|ability checks?)\b/i.test(plain)) return true;
		}
		if (/\bgains? one level in one of (?:its|your|their) classes\b/i.test(text)) return true;
		// A manual or tome raises a score over days of downtime; the score already shows it.
		if (/\bspends? \d+ hours\b/i.test(text) && /\bover a period of\b/i.test(text)) return true;
		if (/\b(?:action|reaction|attack|advantage|resistance|immunit|condition|spell|cast|charge|minute|hour|dc \d)\b/i.test(text)) return false;

		return text
			.split(/(?<=\.)\s+/)
			.map(s => s.trim())
			.filter(Boolean)
			.every(sentence => (/\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma|armor class|\bac\b|saving throws?|\bsaves?\b|walking speed|hit point maximum|initiative)\b/i.test(sentence)
				&& /\b(?:increases?|score|bonus|maximum|instead)\b/i.test(sentence))
				// A trailing caveat that only narrows the bonus just granted ("the saving
				// throw bonus doesn't apply to unattended objects") is part of the stat
				// change, not extra content that earns the item its own trait.
				|| /\b(?:bonus|increase)\b[^.]*\bdoes\s?n'?t apply\b/i.test(sentence));
	}

	/**
	 * Some catalogue items document their own upgraded siblings — an Ioun Stone entry
	 * explains what a "super-charged" version of itself would do and links to it. The
	 * character owns the base stone, so that paragraph describes an item that is not on
	 * the sheet and must not reach the statblock.
	 *
	 * @param {Object} child named item entry `{name, text}`
	 * @param {Object} item the owning item
	 * @param {Set<string>} ownedKeys normalized names of every item the character carries
	 * @returns {boolean} true when the entry documents an item the character lacks
	 */
	static _isItemEntryUnownedVariant (child, item, ownedKeys) {
		const text = String(child?.text || "");
		if (!text) return false;
		const refs = [...text.matchAll(/\{@item\s+([^}|]+)(?:\|[^}]*)?\}/g)].map(m => this._normalizeFeatureKey(m[1]));
		if (!refs.length) return false;
		const ownKey = this._normalizeFeatureKey(item?.name);
		const foreign = refs.filter(ref => ref && ref !== ownKey && !ownedKeys.has(ref));
		if (!foreign.length) return false;
		// Only suppress when the entry is *about* that other item, i.e. it restates this
		// item's own benefit at a different value rather than adding a new one.
		return /\binstead\b/i.test(text) || /\bis (?:very rare|legendary|rare|uncommon|artifact)\b/i.test(text);
	}

	/** Wording-insensitive signature so equivalent benefits from two items collapse. */
	static _getEntryBodySignature (text) {
		return String(text || "")
			.replace(/\{@[a-zA-Z]+\s+([^}|]+)(?:\|[^}]*)?\}/g, "$1")
			.toLowerCase()
			.replace(/\b(?:all|other|each|any|the|a|an)\b/g, " ")
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}

	static _getNamedItemEntryChildren (item) {
		const out = [];
		const walk = (entries) => {
			if (!Array.isArray(entries)) return;
			entries.forEach(ent => {
				if (!ent || typeof ent !== "object") return;
				if (ent.type === "entries" && ent.name && Array.isArray(ent.entries)) {
					const text = ent.entries
						.map(e => (typeof e === "string" ? e : (e?.entries || []).map(x => typeof x === "string" ? x : "").join(" ")))
						.join(" ");
					out.push({
						name: this._getSafeInlineText(ent.name, {maxLen: 80}) || "Property",
						text: text || "",
					});
				}
				if (Array.isArray(ent.entries)) walk(ent.entries);
			});
		};
		walk(item?.entries);
		return out.slice(0, 12);
	}

	static _isItemEntryAttackRestatement (child, item) {
		const text = String(child?.text || "").toLowerCase();
		const name = String(child?.name || "").toLowerCase();
		// "Dragon-Bone Spear" style: only attack/damage restatement
		if (!/bonus action|as a reaction|as an action|once used|can't be used again|condition|truesight|initiative|surprised|blind/i.test(text)) {
			if (/attack and damage rolls|instead of its normal damage|magic weapon/.test(text) && item?.bonusWeapon) return true;
			if (/weapon/.test(name) && /damage/.test(text) && !/bonus action|reaction/.test(text)) return true;
		}
		return false;
	}

	static _extractUsesFromItemText (text) {
		const t = String(text || "");
		if (/once used[\s\S]{0,40}next dawn/i.test(t) || /until the next dawn/i.test(t)) return "(1/Dawn)";
		if (/once per day/i.test(t)) return "(1/Day)";
		if (/once per long rest/i.test(t)) return "(1/LR)";
		if (/once per short rest/i.test(t)) return "(1/SR)";
		const m = t.match(/(\d+)\s*(?:charges?|uses?)\b/i);
		if (m) return `(${m[1]})`;
		return "";
	}

	/**
	 * Flatten a mixed HTML/`{@tag}` string to bare prose for pattern matching.
	 * Activation phrasing frequently hides inside a tag — the 2024 books write
	 * "take a {@action Magic|XPHB} action" — so a classifier that only strips HTML
	 * never sees the words it is looking for.
	 * @param {string} text
	 * @returns {string} lower-cased, whitespace-collapsed plain text
	 */
	static _getPlainMatchText (text) {
		return this._getPlainMatchTextCased(text).toLowerCase();
	}

	/**
	 * Same flattening, but proper nouns survive — a gate reading "while siphoning power
	 * from Arch Daemons" is meaningfully different from "arch daemons" on the block.
	 */
	static _getPlainMatchTextCased (text) {
		return String(text || "")
			.replace(/<[^>]*>/g, " ")
			// {@tag display} / {@tag name|source} / {@tag name|source|display}
			.replace(/\{@\w+\s+([^}]*)\}/g, (full, body) => {
				const parts = String(body).split("|");
				return parts.length > 2 && parts[2].trim() ? parts[2] : parts[0];
			})
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * Item-granted spells often carry a full `name|source` UID. Split it so the
	 * spell tag stays two-part — `{@spell a|b|C}` would render `C` as link text.
	 */
	static _parseSpellUid (rawName, rawSource) {
		const parts = String(rawName || "").split("|");
		const bareName = this._getSafeInlineText(parts[0] || "spell", {maxLen: 80}) || "spell";
		const uidSource = parts.length > 1 ? parts[1] : "";
		const source = this._getSafeSourceJson(rawSource || uidSource || Parser.SRC_XPHB) || Parser.SRC_XPHB;
		return {name: this._toDisplayTitleCase(bareName), source};
	}

	static _toDisplayTitleCase (text) {
		const minor = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "with"]);
		return String(text || "")
			.split(/\s+/)
			.map((word, ix) => {
				const lower = word.toLowerCase();
				if (ix > 0 && minor.has(lower)) return lower;
				return lower.replace(/^[a-z]/, c => c.toUpperCase());
			})
			.join(" ");
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

	/**
	 * The item's *own* benefit, not the generic rules for its item class.
	 *
	 * Joining every paragraph and taking the first 240 characters printed pure flavour and
	 * never the mechanic — an Ioun Stone's entries are four paragraphs of shared Ioun Stone
	 * rules ("Roughly marble sized, Ioun Stones are named after Ioun…") followed by the one
	 * line that actually matters ("Your Dexterity increases by 2…"). Preamble paragraphs
	 * are dropped and the benefit-bearing paragraphs kept, in order.
	 */
	static _getItemUseSnippet (item, {npcName = "The NPC"} = {}) {
		const paragraphs = (item.entries || [])
			.map(it => (typeof it === "string" ? it : (it?.entries || []).join(" ")))
			.map(it => String(it || "").trim())
			.filter(Boolean);

		const benefit = paragraphs.filter(p => !this._isGenericItemClassPreamble(p, item));
		const joined = (benefit.length ? benefit : paragraphs).join(" ");
		// The full prose pipeline, not the inline sanitiser: an item benefit is a sentence,
		// so it must keep its {@spell}/{@dice} markup and be cut on a sentence boundary.
		const prose = this._prepareFeatureTextForNpc(joined, {npcName, maxLen: 240});
		if (prose) return prose;

		if (Number.isFinite(Number(item.charges)) && Number(item.charges) > 0) {
			const current = Number.isFinite(Number(item.chargesCurrent)) ? Number(item.chargesCurrent) : Number(item.charges);
			return `Has ${current}/${Number(item.charges)} charges`;
		}

		return "Can be activated";
	}

	/**
	 * A paragraph that describes the item *category* rather than this item. Detected
	 * structurally: it talks about the class in the plural or defines how the category is
	 * used, and states no benefit for the wielder.
	 */
	/**
	 * Item rules split into named sub-sections, and only some of them are about the
	 * creature holding the item. An Ioun Stone ships "General Ioun Stone Rules",
	 * "Orbiting the Stone" and "Capturing and Damaging the Stone" alongside its actual
	 * benefit — rules for *the object*, addressed to no one in particular, which land on
	 * the statblock as three bogus actions the NPC appears to be able to take.
	 *
	 * The reliable tell is grammatical, not a heading vocabulary that would need extending
	 * per item: a benefit is always addressed to the bearer ("you gain…", "while you are
	 * attuned…"), while object rules are written about "a creature" in the abstract.
	 * Requiring both — no second person anywhere, and an explicit third-party subject —
	 * keeps a tersely-worded genuine benefit from being suppressed.
	 *
	 * @param {Object} child named item entry `{name, text}` in its original second person
	 * @returns {boolean} true when the entry is about the object, not its bearer
	 */
	static _isItemEntryBearerAgnostic (child) {
		const text = String(child?.text || "");
		if (!text) return false;
		if (/\byou(?:r|rs|rself)?\b/i.test(text)) return false;
		return /\b(?:a|the|another|each|any) (?:bonded )?creature\b/i.test(text) || /\b(?:the|this|each) (?:stone|item|tattoo|weapon|armor)\b/i.test(text);
	}

	static _isGenericItemClassPreamble (paragraph, item) {
		const text = String(paragraph || "");
		if (!text) return false;

		// A paragraph that grants something is never preamble, however it is phrased.
		const grantsBenefit = /\byou(?:r)?\b[^.]*\b(gain|have|can|increases?|score|regain|add)\b/i.test(text)
			|| /\b(increases? by|bonus to|advantage on|resistance to|immunity to)\b/i.test(text);
		if (grantsBenefit) return false;

		if (this._isIounStoneItem(item)) {
			// Shared Ioun Stone rules: naming/lore, tossing it into orbit, the three-stone
			// cap, the "counts as worn" clause, and seizing/stowing.
			if (/\bIoun Stones\b/i.test(text)) return true;
			if (/orbits? your head/i.test(text) && !/while this/i.test(text)) return true;
		}

		// Generic catalogue lore: "X are named after…", "Many types of X exist…".
		return /\b(are named after|many types of|exist, each|is a category of)\b/i.test(text);
	}

	/**
	 * Situational extra damage that the sheet does NOT fold into an attack's own
	 * damage number — Rage, Demolishing Might, Brutal Strike and any conditional
	 * damage modifier. Without these the statblock understates the character by a
	 * large margin: a raging Barbarian's every hit is short by its rage damage.
	 *
	 * Deliberately excludes unconditional bonuses (Dueling's flat +2), which are
	 * already inside `_getAttackDamageText`; adding them would double-count.
	 *
	 * @param {Object} state
	 * @param {Object} [calculations] result of `getFeatureCalculations()`
	 * @returns {Array<{damage: string, condition: string, meleeOnly: boolean}>}
	 */
	/** Damage type stated by the named feature's own description on this character. */
	/**
	 * A handful of features grant a wholly new attack option rather than modifying an
	 * existing one — Radiant Sun Bolt, Eldritch Blast-alikes, conjured-weapon features.
	 * The sheet models these as prose, so without this pass the statblock advertises "a
	 * ranged spell attack with a range of 30 feet" and then gives a DM no to-hit and no
	 * damage: unusable at the table.
	 *
	 * Everything needed is stated by the feature itself — attack kind, range, governing
	 * ability, damage type and damage die — so this reads the feature rather than guessing
	 * from the class. The one indirection is a die that scales off a class table ("as shown
	 * in the Martial Arts column"), resolved from `getFeatureCalculations()`.
	 *
	 * @param {Object} state
	 * @param {Object} calculations result of `getFeatureCalculations()`
	 * @returns {Array<Object>} statblock action entries
	 */
	/**
	 * A statblock must name one resource, not two. Subclass text written for the 2014
	 * rules says "ki point" while a 2024 Monk's own sheet tracks "Focus Points", so a DM
	 * reading Reggu is told to spend a pool that appears nowhere on the block.
	 *
	 * Only renames when the character actually owns the modern pool and does *not* own the
	 * legacy one — a character who genuinely tracks ki keeps its own terminology.
	 *
	 * @param {Object} out statblock (mutated)
	 * @param {Object} state
	 */
	static _normalizeResourceTerminology (out, state) {
		const owned = new Set(
			[
				...(state.getGenericPoolResources?.() || state.getResources?.() || []),
				...(state.getSyntheticCombatResources?.() || []),
			]
				.map(r => String(r?.name || "").toLowerCase().trim())
				.filter(Boolean),
		);

		// 2014 term -> 2024 term. Extendable, but these are the renames that actually
		// collide inside one character's prose.
		const RENAMES = [
			{legacy: /\bki points?\b/gi, legacyKey: "ki", modern: "Focus Point", modernKey: "focus points"},
			{legacy: /\bki\b/g, legacyKey: "ki", modern: "Focus", modernKey: "focus points"},
		];

		const active = RENAMES.filter(r => [...owned].some(n => n.includes(r.modernKey)) && ![...owned].some(n => n === r.legacyKey));
		if (!active.length) return;

		["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
			(out[section] || []).forEach(entry => {
				if (!Array.isArray(entry?.entries)) return;
				entry.entries = entry.entries.map(it => {
					if (typeof it !== "string") return it;
					let next = it;
					active.forEach(r => {
						next = next.replace(r.legacy, m => (/s$/i.test(m) ? `${r.modern}s` : r.modern));
					});
					return next;
				});
			});
		});
	}

	static _getFeatureGrantedAttacks (state, calculations = {}, {npcName = "The NPC"} = {}) {
		const out = [];
		const pb = state.getProficiencyBonus?.() || 0;

		(state?._data?.features || []).forEach(feature => {
			const raw = this._stripHtmlTags(
				Array.isArray(feature?.entries) ? feature.entries.join(" ") : String(feature?.description || feature?.entries || ""),
			);
			if (!/\bgains? a new attack option\b/i.test(raw)) return;

			const shape = /\bspecial attack is an? (ranged|melee)(?: spell)? attack with a (?:range|reach) of (\d+) feet/i.exec(raw);
			if (!shape) return;
			const isRanged = shape[1].toLowerCase() === "ranged";
			const range = Number(shape[2]);

			const abil = /\badds? (?:your|its) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier to its attack/i.exec(raw)
				|| /\badds? (?:your|its) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\b/i.exec(raw);
			const abbr = abil ? abil[1].slice(0, 3).toLowerCase() : "dex";
			const mod = state.getAbilityMod?.(abbr) ?? 0;

			const dmgType = /\bIts damage is ([a-z]+)\b/i.exec(raw);
			// A die that scales off a class table is stated only as its level-1 value.
			const scaled = /\bas shown in the (Martial Arts|Sneak Attack) column\b/i.test(raw)
				? calculations.martialArtsDie
				: null;
			const literal = /\bdamage die is an? \{?@?damage ?(\d*d\d+)\}?/i.exec(raw) || /\bdamage die is an? (\d*d\d+)\b/i.exec(raw);
			let die = scaled || (literal ? literal[1] : "");
			if (!die) return;
			if (/^d\d+$/i.test(die)) die = `1${die}`;

			const damage = mod ? `${die}${mod >= 0 ? "+" : ""}${mod}` : die;
			const hit = pb + mod;
			// Whatever the feature says beyond the attack's own shape — Radiant Sun Bolt's
			// "spend 1 Focus Point to make the special attack twice" — is a real rider that
			// belongs on the attack. The feature's own entry is dropped downstream as a
			// same-name duplicate, so it has to be carried here or it is lost.
			const rider = (this._prepareFeatureEntriesForNpc(raw, {npcName}) || [])
				.map(line => (typeof line === "string"
					? this._splitIntoClauses(line).filter(s => !this._isDeadStatblockSentence(s)).join(" ")
					: line))
				.filter(line => typeof line !== "string" || line.trim());
			out.push({
				name: this._getSafeInlineText(feature.name, {maxLen: 60}),
				entries: [
					`{@atk ${isRanged ? "rs" : "ms"}} {@hit ${hit >= 0 ? "+" : ""}${hit}} to hit, ${isRanged ? "range" : "reach"} ${range} ft., one target. {@h} {@damage ${damage}} ${(dmgType ? dmgType[1] : "force").toLowerCase()} damage.`,
					...rider,
				],
			});
		});

		return out;
	}

	static _getFeatureStatedDamageType (state, featureName) {
		const key = this._normalizeFeatureKey(featureName);
		const feature = (state?._data?.features || [])
			.find(f => this._normalizeFeatureKey(f?.name) === key);
		if (!feature) return "";
		return this._getStatedRiderDamageType(feature.description || feature.entries || "");
	}

	/**
	 * The damage type a feature states for its own extra damage, including a choice of
	 * two ("Necrotic or Radiant"). Returns `""` when the text names none, so the caller
	 * keeps whatever it already had.
	 */
	static _getStatedRiderDamageType (text) {
		const plain = this._stripHtmlTags(Array.isArray(text) ? text.join(" ") : String(text || ""));
		const types = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
		const both = new RegExp(`\\b(${types})\\s+or\\s+(${types})\\s+damage\\b`, "i").exec(plain);
		if (both) return `${both[1].toLowerCase()} or ${both[2].toLowerCase()}`;
		const one = new RegExp(`\\bextra\\s+(?:\\{@damage [^}]+\\}|[\\dd+ ]+)\\s*(${types})\\s+damage\\b`, "i").exec(plain);
		return one ? one[1].toLowerCase() : "";
	}

	static _getConditionalDamageRiders (state, calculations = {}) {
		const riders = [];
		const push = (damage, condition, {meleeOnly = true, sourceName = "", damageType = "", wholeFeature = false, named = false, appliesTo = "", onlyWeapon = ""} = {}) => {
			const value = String(damage ?? "").trim();
			if (!value || value === "0") return;
			if (riders.some(r => r.condition === condition && r.onlyWeapon === onlyWeapon)) return;
			// One feature can register the same bonus twice under differently-worded
			// conditionals (Dueling does), which reads as two separate riders on the line.
			if (sourceName && riders.some(r => r.sourceName === sourceName && r.damage === value)) return;
			riders.push({damage: value, condition, meleeOnly, sourceName, damageType, wholeFeature, named: named || wholeFeature, appliesTo, onlyWeapon});
		};

		const rage = Number(calculations.rageDamage);
		if (Number.isFinite(rage) && rage > 0) push(String(rage), "while raging", {sourceName: "Rage"});

		push(calculations.demolishingMightConstructDamage, "against Constructs", {sourceName: "Demolishing Might"});
		push(calculations.brutalStrikeDamage, "when forgoing Advantage from Reckless Attack", {sourceName: "Brutal Strike"});

		// Divine Strike and Improved Divine Smite are extra damage on a weapon hit and
		// nothing else, so a trait restating them is pure duplication of the attack line
		// they belong on — `wholeFeature` retires the trait once the rider is printed.
		// The feature's own text is more authoritative about the damage type than the
		// derived calculation, which can lag behind a subclass rebuild.
		push(calculations.divineStrikeDamage, "once per turn", {
			sourceName: "Divine Strike",
			damageType: this._getFeatureStatedDamageType(state, "Divine Strike") || calculations.divineStrikeType || "",
			wholeFeature: true,
		});
		// The 2024 Paladin renamed Improved Divine Smite; same mechanic, same duplication.
		push(calculations.radiantStrikesDamage, "on every melee weapon hit", {
			sourceName: "Radiant Strikes",
			damageType: this._getFeatureStatedDamageType(state, "Radiant Strikes") || "radiant",
			wholeFeature: true,
		});
		push(calculations.improvedDivineSmiteDamage, "on every melee weapon hit", {
			sourceName: "Improved Divine Smite",
			damageType: this._getFeatureStatedDamageType(state, "Improved Divine Smite") || "radiant",
			wholeFeature: true,
		});

		// Primal Strike (Beastheart 8th) — "Once on each of your turns when you hit a
		// creature with a weapon attack" — melee or ranged, so it is not melee-only.
		// The damage type is the player's own pick, stored on the state.
		push(calculations.primalStrikeDamage, "once per turn", {
			sourceName: "Primal Strike",
			meleeOnly: false,
			damageType: calculations.primalStrikeDamageType || "",
			wholeFeature: true,
		});

		// Crimson Rite is the Blood Hunter's signature damage and is applied to a specific		// held weapon, so the attack line is the only place it can honestly be stated.
		push(calculations.crimsonRiteDamage, "while a rite is active on the weapon", {
			sourceName: "Crimson Rite",
		});

		// Sneak Attack is an **anchor**, not a leaf (see `_buildFeatureReferenceGraph`):
		// Cunning Strike spends dice out of it and Assassinate turns a round-1 hit into a
		// critical. So it is `named` — the line attributes it — but never `wholeFeature`,
		// because retiring the trait would present a spendable pool as fixed damage and
		// orphan its dependents. It only rides Finesse or Ranged attacks, so Missy's Claws
		// must not pick it up.
		if (calculations.sneakAttack?.dice) {
			push(String(calculations.sneakAttack.dice), "1/turn", {
				meleeOnly: false,
				sourceName: "Sneak Attack",
				named: true,
				appliesTo: "finesseOrRanged",
			});
		}

		// A conditional damage modifier whose feature ALSO registered an
		// unconditional entry is the gated twin of a bonus already baked into the
		// attack line, so only genuinely stand-alone conditionals become riders.
		const modifiers = state.getNamedModifiers?.() || [];
		const bakedInSources = new Set(modifiers
			.filter(mod => mod?.enabled && /^damage(?:$|:)/.test(String(mod.type || "")) && !mod.conditional)
			.map(mod => mod.sourceFeatureId)
			.filter(Boolean));
		const featuresById = new Map((state._data?.features || []).map(f => [String(f?.id || ""), f]));

		modifiers.forEach(mod => {
			if (!mod?.conditional) return;
			if (mod.enabled === false) return;
			if (!/^damage(?:$|:)/.test(String(mod.type || ""))) return;
			if (/reroll/i.test(String(mod.type || ""))) return;
			if (mod.sourceFeatureId && bakedInSources.has(mod.sourceFeatureId)) return;
			// A bonus that only lands on a *different* attack — Charger's +5 applies to the
			// bonus-action attack it grants, not to the Attack action — must not advertise
			// itself on every printed line. The feature states it where it happens.
			if (/bonus action/i.test(String(mod.conditional || ""))) return;
			const value = Number(mod.value);
			if (!Number.isFinite(value) || value === 0) return;
			const condition = this._normalizeRiderCondition(mod.conditional);
			if (!condition) return;
			push(String(value), condition, {
				meleeOnly: /melee/i.test(String(mod.type || "")),
				sourceName: featuresById.get(String(mod.sourceFeatureId || ""))?.name || mod.name || "",
			});
		});

		return riders;
	}

	/**
	 * A magic weapon's own extra damage is scoped to *that weapon*, so it belongs on that
	 * weapon's attack line and nowhere else. The sheet stores it on the item as
	 * `damageRiders` (a flat extra die) and `conditionalBonuses` (a die against a creature
	 * type), and the exporter read neither — Reggu's Sun Staff lost its 1d8 fire, Mikase's
	 * Silver Dragon Katana lost its 1d4 cold, and Dranan's Sun Blade lost its 1d8 vs undead.
	 *
	 * @param {Array<Object>} attacks export attack records
	 * @returns {Array<Object>} weapon-scoped rider records
	 */
	static _getItemDamageRiders (attacks) {
		const riders = [];
		(attacks || []).forEach(attack => {
			const item = attack?._sourceItem;
			const weapon = String(attack?.name || "").trim();
			if (!item || !weapon) return;

			(item.damageRiders || []).forEach(rider => {
				const dice = String(rider?.dice || "").trim();
				if (!dice) return;
				const label = this._getSafeInlineText(rider?.name || "", {maxLen: 60});
				// A rider named after its own weapon adds nothing the line doesn't say.
				const sourceName = label && this._normalizeFeatureKey(label) !== this._normalizeFeatureKey(weapon) ? label : "";
				riders.push({
					damage: dice,
					damageType: String(rider?.damageType || "").trim(),
					condition: rider?.requiresToggle ? "while active" : "",
					meleeOnly: false,
					onlyWeapon: weapon,
					sourceName,
					mergeLabel: label,
					named: !!sourceName,
					wholeFeature: false,
					appliesTo: "",
				});
			});

			(item.conditionalBonuses || []).forEach(bonus => {
				const dice = String(bonus?.damage || "").trim();
				if (!dice) return;
				riders.push({
					damage: dice,
					damageType: String(bonus?.damageType || "").trim(),
					condition: this._formatItemBonusCondition(bonus),
					meleeOnly: false,
					onlyWeapon: weapon,
					sourceName: "",
					named: false,
					wholeFeature: false,
					appliesTo: "",
				});
			});
		});
		return riders;
	}

	/** "vs Undead" / creatureTypes ["undead"] → "against Undead". */
	static _formatItemBonusCondition (bonus) {
		const types = (bonus?.creatureTypes || []).map(it => String(it).trim()).filter(Boolean);
		if (types.length) return `against ${types.map(it => it.replace(/^./, c => c.toUpperCase())).join(" and ")}`;
		const label = String(bonus?.label || "").trim().replace(/^vs\.?\s+/i, "");
		return label ? `against ${label}` : "";
	}

	// Only an *automatic* on-hit rider may be lifted from prose. "you can cause the target
	// to take" is an optional, usually limited-use power (Lorian's staff) whose cost the
	// line cannot carry, and lifting it would advertise free damage.
	static _ITEM_HIT_TRIGGER = /\b(?:on a hit|when(?:ever)? (?:you|it) hits?|the first time each turn (?:you|it) hits?)\b/i;
	static _ITEM_OPTIONAL_RIDER = /\b(?:you can|it can|can cause|at your option|no action required)\b/i;
	static _ITEM_EXTRA_DAMAGE = /\b(?:deals?|takes?)\s+an?\s+extra\s+\{@damage\s+(\d+d\d+)\}\s*(\w+)?\s*damage/i;
	static _ITEM_FIRST_TIME = /\bthe first time each turn (?:you|it) hits?\s+(?:a creature that is\s+)?([^,;.]{3,40}?)\s*,/i;

	/**
	 * A magic weapon's flat on-hit damage often lives only in its prose, never reaching the
	 * structured `damageRiders` field — Elizabeth's Fang of the Whale Eater lost its 1d6
	 * cold entirely, and Arthur's Cataclysm its 1d4. Mine it, but narrowly: the sentence
	 * must state an on-hit trigger, must not be optional, and must lose to any structured
	 * rider already carrying the same dice.
	 *
	 * @param {Array<Object>} attacks export attack records
	 * @param {Array<Object>} existing riders already emitted, to dedupe against
	 * @returns {Array<Object>} weapon-scoped rider records
	 */
	static _getItemProseDamageRiders (attacks, existing = []) {
		const riders = [];
		const seen = new Set(existing
			.filter(it => it.onlyWeapon)
			.map(it => `${this._normalizeFeatureKey(it.onlyWeapon)}|${it.damage}|${String(it.damageType || "").toLowerCase()}`));

		(attacks || []).forEach(attack => {
			const item = attack?._sourceItem;
			const weapon = String(attack?.name || "").trim();
			if (!item || !weapon) return;
			const weaponKey = this._normalizeFeatureKey(weapon);

			const candidates = [];
			(item.entries || []).forEach(entry => {
				if (typeof entry === "string") candidates.push({label: "", text: entry});
				else (entry?.entries || []).forEach(line => typeof line === "string" && candidates.push({label: entry.name || "", text: line}));
			});
			(item.itemPowers || []).forEach(power => power?.description && candidates.push({label: power.name || "", text: power.description}));

			candidates.forEach(({label, text}) => {
				if (!this._ITEM_HIT_TRIGGER.test(text)) return;
				if (this._ITEM_OPTIONAL_RIDER.test(text)) return;
				const match = this._ITEM_EXTRA_DAMAGE.exec(text);
				if (!match) return;
				const damage = match[1];
				const damageType = String(match[2] || "").toLowerCase();
				const key = `${weaponKey}|${damage}|${damageType}`;
				if (seen.has(key)) return;
				seen.add(key);

				const firstTime = this._ITEM_FIRST_TIME.exec(text);
				const target = firstTime ? this._getSafeInlineText(firstTime[1], {maxLen: 40}) : "";
				const condition = firstTime
					? `${target ? `against ${target} creatures, ` : ""}1/turn`
					: "";
				const name = this._getSafeInlineText(label, {maxLen: 60});
				const sourceName = name && this._normalizeFeatureKey(name) !== weaponKey ? name : "";
				riders.push({
					damage,
					damageType,
					condition,
					meleeOnly: false,
					onlyWeapon: weapon,
					sourceName,
					named: !!sourceName,
					wholeFeature: false,
					appliesTo: "",
				});
			});
		});
		return riders;
	}

	/**
	 * Modifier conditionals are authored in the player's voice and with inconsistent lead-ins
	 * ("when you are wielding", "wielding one melee weapon"). Normalise both so the rider
	 * reads as one clause and never doubles its conjunction.
	 */
	static _normalizeRiderCondition (raw) {
		let text = String(raw || "").trim()
			.replace(/^(?:when|while|if)\s+/i, "")
			.replace(/\byou are\b/gi, "it is")
			.replace(/\byou're\b/gi, "it is")
			.replace(/\byour\b/gi, "its")
			.replace(/\byou\b/gi, "it")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/[.,;]+$/, "");
		text = this._getSafeInlineText(text, {maxLen: 80});
		if (!text) return "";
		// A condition can already carry its own temporal conjunction ("after Dash"), and
		// "when after" reads as an error rather than a nuance.
		if (/^(?:after|before|against|during|vs\b|on (?:a|the|its)\b)/i.test(text)) return text;
		return `when ${text}`;
	}

	/**
	 * Rider clause appended to an attack's damage sentence, filtered to the riders
	 * that can actually modify this attack.
	 * @param {Array} riders
	 * @param {Object} attack
	 * @returns {string}
	 */
	static _formatDamageRidersForAttack (riders, attack) {
		if (!riders?.length) return "";
		const applicable = this._coalesceDamageRiders(riders.filter(rider => this._riderAppliesToAttack(rider, attack)));
		if (!applicable.length) return "";
		return applicable
			.map(rider => {
				const type = rider.damageType ? ` ${rider.damageType}` : "";
				const condition = String(rider.condition || "").trim();
				// A named rider replaces or anchors a trait, so it must name the feature it
				// came from or the DM loses the attribution entirely.
				if (rider.named && rider.sourceName) {
					// A condition that is true of every attack the rider is printed on adds
					// nothing but length — the attack line itself is the condition.
					const isUniversal = this._isUniversalRiderCondition(condition);
					return `, plus {@damage ${rider.damage}}${type} damage (${rider.sourceName}${isUniversal ? "" : `, ${condition}`})`;
				}
				return `, plus {@damage ${rider.damage}}${type} damage${condition ? ` ${condition}` : ""}`;
			})
			.join("");
	}

	/**
	 * Two sources can add the same damage to the same attack — Mikase's Starfire Katana
	 * carries 1d8 radiant and Radiant Strikes adds another — and printed separately the
	 * line says "plus 1d8 radiant damage (Radiant Strikes), plus 1d8 radiant damage",
	 * which a DM has to add up mid-roll. State the total once and name both sources.
	 *
	 * Only riders that share a damage type, a condition and a die size combine; a 1d8 and
	 * a 1d4 are two different rolls and stay two clauses.
	 *
	 * @param {Array<Object>} riders riders already filtered to this attack
	 * @returns {Array<Object>} riders with same-die groups collapsed
	 */
	/** A rider condition that is true of every line it is printed on states nothing. */
	static _isUniversalRiderCondition (condition) {
		const text = String(condition || "").trim();
		return !text || /^on (?:every|each|all) /i.test(text);
	}

	static _coalesceDamageRiders (riders) {
		const order = [];
		const groups = new Map();

		(riders || []).forEach(rider => {
			const die = /^(\d+)d(\d+)$/.exec(String(rider?.damage || "").trim());
			const type = String(rider?.damageType || "").trim().toLowerCase();
			if (!die || !type) return void order.push({single: rider});
			// "on every melee weapon hit" and no condition at all are the same condition on
			// a melee weapon's own line; treating them as different keeps the two apart.
			const gate = this._isUniversalRiderCondition(rider.condition) ? "" : String(rider.condition).trim().toLowerCase();
			const key = `${type}|${gate}|d${die[2]}`;
			if (!groups.has(key)) {
				const slot = {faces: die[2], members: []};
				groups.set(key, slot);
				order.push(slot);
			}
			groups.get(key).members.push({rider, count: Number(die[1])});
		});

		return order.flatMap(slot => {
			if (slot.single) return [slot.single];
			if (slot.members.length === 1) return [slot.members[0].rider];
			const count = slot.members.reduce((acc, it) => acc + it.count, 0);
			const labels = [];
			slot.members.forEach(({rider}) => {
				// A weapon's own rider prints unattributed on its own line, because the line
				// already names the weapon — but once merged the attribution is the only way
				// to see where the bigger number came from.
				const label = rider.sourceName || rider.mergeLabel || "";
				if (label && !labels.includes(label)) labels.push(label);
			});
			return [{
				...slot.members[0].rider,
				damage: `${count}d${slot.faces}`,
				sourceName: labels.join(", "),
				named: !!labels.length,
			}];
		});
	}

	/**
	 * A rider is not universal. Sneak Attack rides only Finesse or Ranged weapons, so
	 * Missy's Claws must not pick it up; an item power rides only its own weapon.
	 *
	 * @param {Object} rider rider record from `_getConditionalDamageRiders`
	 * @param {Object} attack export attack record
	 * @returns {boolean}
	 */
	static _riderAppliesToAttack (rider, attack) {
		if (rider.meleeOnly && !this._isMeleeAttack(attack)) return false;
		if (rider.onlyWeapon && this._normalizeFeatureKey(attack?.name) !== this._normalizeFeatureKey(rider.onlyWeapon)) return false;
		if (rider.appliesTo === "finesseOrRanged" && !this._isFinesseOrRangedAttack(attack)) return false;
		return true;
	}

	/** Weapon properties reach the exporter as codes ("F|XPHB") and as words ("Finesse"). */
	static _isFinesseOrRangedAttack (attack) {
		const props = [...(attack?.properties || []), ...(attack?._sourceItem?.properties || [])]
			.map(it => String(it).split("|")[0].trim().toUpperCase());
		if (props.some(it => it === "F" || it === "FINESSE")) return true;
		if (props.some(it => it === "A" || it === "AMMUNITION" || it === "T" || it === "THROWN")) return true;
		return this._isRangedOnlyAttack(attack);
	}

	static _getActionEntriesFromAttacks (attacks, state, {damageRiders = []} = {}) {
		const actions = attacks.map(a => {
			const toHit = this._toSignedStr(this._getAttackToHit(a, state));
			const range = this._formatAttackRange(a);
			const hitDamage = this._getAttackDamageText(a, state);
			const name = this._getSafeInlineText(a.name || "Attack", {maxLen: 80}) || "Attack";
			const qualifiers = this._getAttackQualifiers(a, state);
			const atkTag = this._getAttackTypeTag(a);
			const riders = this._formatDamageRidersForAttack(damageRiders, a);

			return {
				name,
				entries: [
					`{@atk ${atkTag}} {@hit ${toHit}} to hit, ${range}. {@h} ${hitDamage}${riders}.${qualifiers ? ` ${qualifiers}` : ""}`,
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

	/** Item data stores `dmgType` as a code ("P"/"S"/"B"); statblocks need the full word. */
	static _expandDamageType (damageType) {
		const raw = String(damageType || "").trim();
		if (!raw) return "bludgeoning";
		if (raw.length > 2) return raw.toLowerCase();
		const mapped = CharacterSheetNpcExporter._DMG_TYPE_CODES[raw.toUpperCase()];
		if (mapped) return mapped;
		const full = Parser.dmgTypeToFull?.(raw.toUpperCase());
		if (full && String(full).trim() && String(full).toLowerCase() !== raw.toLowerCase()) {
			return String(full).toLowerCase();
		}
		return raw.toLowerCase();
	}

	static _getAttackDamageText (attack, state) {
		const damageType = this._getSafeInlineText(this._expandDamageType(attack.damageType), {maxLen: 24}) || "bludgeoning";
		const base = this._normalizeDamageFormula(attack.damage || "1");
		if (/^\d+d\d+(?:\s*[+-]\s*\d+)?$/i.test(base)) {
			// Weapon-derived rows arrive with the modifier folded in; feature rows carry the
			// bare die and would silently lose it (a monk's 1d10 unarmed strike is 1d10+5).
			const pending = attack._damageIncludesAbilityMod
				? 0
				: this._getAttackAbilityMod(attack, state) + (Number(attack.damageBonus) || 0);
			return `{@damage ${this._addFlatBonusToDiceFormula(base, pending)}} ${damageType} damage`;
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
		// Bonuses are already folded into {@hit}/{@damage}; note only what the folded
		// numbers cannot convey — that the attack counts as magical.
		if (magicAttackBonus || magicDamageBonus) {
			parts.push("The attack is magical");
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

		if (!parts.length) return "";
		return `${parts.join(". ").replace(/\.\s*$/, "")}.`;
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

	/**
	 * Some features conjure a weapon that never appears in inventory (Shadow
	 * Knight's shadowstuff weapon), so the statblock shows a character who can
	 * attack with something the actions block never lists. The weapon's statistics
	 * are parsed out of the feature prose rather than hardcoded, so any future
	 * "manifest a weapon" feature is picked up automatically.
	 *
	 * @returns {Array<Object>} action entries (possibly empty)
	 */
	static _getFeatureWeaponActions (state, {npcName = "The NPC"} = {}) {
		const features = [...(state.getFeatures?.() || []), ...(state.getFeats?.() || [])];
		const pb = state.getProficiencyBonus?.() || 2;
		const out = [];
		const seen = new Set();
		// The granting feature usually says only "melee weapon"; sibling features are
		// the ones that call it a "shadow weapon", so the corpus is searched as a whole.
		const corpus = features.map(f => this._getPlainMatchText(f?.description || "")).join(" ");

		features.forEach(feature => {
			const text = this._getPlainMatchText(feature?.description || "");
			if (!text) return;
			if (!/\b(?:manifest|summon|conjure|create|form)\w*\s+(?:an?\s+|the\s+)?(?:object|weapon|blade)/i.test(text)) return;

			const dice = /damage die is an?\s+(d\d+)(?:[^.]*?or an?\s+(d\d+)[^.]*?both hands)?/i.exec(text);
			if (!dice) return;
			const damageType = (/\bdeals?\s+(\w+)\s+damage\b/i.exec(text) || [])[1];
			if (!damageType) return;

			const oneHanded = dice[1];
			const twoHanded = dice[2];
			const isFinesse = /\bfinesse\b/i.test(text);

			// "…hitting a target with a shadow weapon…" names the weapon far better
			// than the feature that grants it ("Manifest Shadow"), but the prose also
			// says "melee weapon"/"magic weapon", so generic qualifiers are skipped
			// and the most frequently repeated remaining adjective wins.
			const genericQualifier = /^(?:melee|ranged|simple|martial|magic|magical|physical|nonmagical|improvised|heavy|light|finesse|two|one|single|the|that|this|its|a|an|other|another|new|same)$/i;
			const counts = new Map();
			[...corpus.matchAll(/\b(?:a|an|the|its)\s+([a-z]+)\s+weapon\b/gi)].forEach(match => {
				const word = match[1].toLowerCase();
				if (genericQualifier.test(word)) return;
				counts.set(word, (counts.get(word) || 0) + 1);
			});
			const nameHint = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
			const name = nameHint
				? `${nameHint.replace(/^[a-z]/, c => c.toUpperCase())} Weapon`
				: `${this._getSafeInlineText(feature.name || "Conjured", {maxLen: 40})} Weapon`;
			const key = name.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);

			const strMod = state.getAbilityMod?.("str") || 0;
			const dexMod = state.getAbilityMod?.("dex") || 0;
			const abilityMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
			const toHit = this._toSignedStr(abilityMod + pb);
			const damageOf = die => `{@damage 1${die}${abilityMod ? this._toSignedStr(abilityMod) : ""}} ${damageType.toLowerCase()} damage`;

			const twoHandedText = twoHanded ? `, or ${damageOf(twoHanded)} when wielded with two hands` : "";
			const grantedBy = this._getSafeInlineText(feature.name || "the granting feature", {maxLen: 60});
			const entry = `{@atk mw} {@hit ${toHit}} to hit, reach 5 ft., one target. {@h} ${damageOf(oneHanded)}${twoHandedText}. ${npcName} must first manifest the weapon (see ${grantedBy}).`;

			// A weapon it already carries can often be converted into this weapon,
			// which readers otherwise miss because the two live in separate entries.
			const coating = features.find(other => /\bcoat\s+(?:an?|its|the)\s+(?:physical\s+|held\s+)?weapon/i
				.test(this._getPlainMatchText(other?.description || "")));
			const coatingNote = coating
				? ` ${npcName} can instead convert a weapon it is already holding (see ${this._getSafeInlineText(coating.name || "", {maxLen: 60})}).`
				: "";

			out.push({name, entries: [`${entry}${coatingNote}`]});
		});

		return out;
	}

	static _getSpellcastingBlocks (state, {npcName = "The NPC"} = {}) {
		const blocks = [];
		const classBlock = this._getClassSpellcastingBlock(state, {npcName});
		if (classBlock) blocks.push(classBlock);
		const innateBlock = this._getInnateSpellcastingBlock(state, {npcName});
		if (innateBlock) blocks.push(innateBlock);
		const swappableBlocks = this._getSwappableSpellSetBlocks(state, {npcName});
		blocks.push(...swappableBlocks);
		const powersBlock = this._getPsionicPowersBlock(state, {npcName});
		if (powersBlock) blocks.push(powersBlock);
		return blocks;
	}

	/**
	 * The roster half of the psionics split. Every one of the book's 27 psionic
	 * statblocks routes its utility powers through a `spellcasting` block named
	 * "Powers" rather than minting a trait apiece, and reserves real entries for the
	 * handful of powers that resolve in combat. Before this, a level 20 Talent exported
	 * twenty-four separate entries — sixteen of them actions — for what the book states
	 * as six entries and a two-line roster.
	 *
	 * @param {Object} state character state
	 * @param {Object} opts
	 * @returns {Object|null} a bestiary `spellcasting` block, or null when not a manifester
	 */
	/**
	 * The rostered (non-signature) powers, or `[]`. Shared so that the `Powers` block and
	 * the `Psionic Powers` trait cannot disagree about whether a roster exists.
	 * @param {object} state
	 * @returns {Array<object>}
	 */
	static _getRosteredPsionicPowers (state) {
		if (!state?.getFeatureCalculations?.()?.hasPsionicPowers) return [];
		return (state?.getFeatures?.() || [])
			.filter(f => f?._entityType === "psionicPower" && f?.name)
			.filter(f => !this._isSignaturePsionicPower(f));
	}

	/**
	 * @param {object} state
	 * @returns {boolean} whether a `Powers` roster block will be emitted
	 */
	static _hasPsionicRoster (state) { return !!this._getRosteredPsionicPowers(state).length; }

	static _getPsionicPowersBlock (state, {npcName = "The NPC"} = {}) {
		const calc = state?.getFeatureCalculations?.() || {};
		if (!calc.hasPsionicPowers) return null;

		const powers = this._getRosteredPsionicPowers(state);
		if (!powers.length) return null;

		/** @type {Record<string, Array<string>>} */ const banded = {};
		powers
			.slice()
			.sort((a, b) => (a._psionicOrder || 0) - (b._psionicOrder || 0) || String(a.name).localeCompare(String(b.name)))
			.forEach(power => {
				// Fails closed to at-will: a fabricated limit is worse than none.
				const band = this._getPsionicBand(power._psionicOrder, calc) || "will";
				const mark = this._getEconomyMark(this._getPsionicManifestationTime(power));
				(banded[band] ||= []).push(`{@psionic ${power.name}|${power.source || "TalPsi"}}${mark}`);
			});

		const ability = String(calc.manifestationAbility || "int").toLowerCase();
		const abilityFull = Parser.attAbvToFull(ability) || "Intelligence";
		const dcPart = Number.isFinite(Number(calc.powerSaveDc)) ? ` (power save {@dc ${calc.powerSaveDc}})` : "";

		const block = {
			name: "Powers",
			type: "spellcasting",
			headerEntries: [
				`In addition to the other powers in this stat block, ${npcName} can manifest the following powers, using ${abilityFull} as its manifestation ability${dcPart}:`,
			],
			ability,
		};
		if (banded.will?.length) block.will = banded.will;
		// The book writes a daily band as "3e"/"1e" — N per day *each*, not N shared.
		const daily = {};
		["3/Day", "1/Day"].forEach(key => {
			if (banded[key]?.length) daily[`${key.split("/")[0]}e`] = banded[key];
		});
		if (Object.keys(daily).length) block.daily = daily;

		return block;
	}

	/**
	 * Some subclasses grant one of several mutually-exclusive always-prepared spell
	 * lists and can swap between them on a rest (Daemonologist's Arch Daemon /
	 * Arch Seraph). Folding those into the general list hides both the alternative
	 * and the fact that a swap is possible, so they get a block of their own.
	 *
	 * Generic over any class whose subclass declares two or more `subSubclassSpells`
	 * tables — no subclass is named here.
	 *
	 * @returns {Array<Object>} bestiary `spellcasting` blocks (possibly empty)
	 */
	static _getSwappableSpellSetBlocks (state, {npcName = "The NPC"} = {}) {
		const out = [];
		(state.getClasses?.() || []).forEach(cls => {
			const tables = cls?.subclass?.subSubclassSpells;
			if (!tables || typeof tables !== "object") return;
			const modes = Object.entries(tables).filter(([, refs]) => Array.isArray(refs) && refs.length);
			if (modes.length < 2) return;

			const activeName = String(
				state.getDaemonologistSide?.()?.name
				|| cls.subclass?.activeSubSubclass
				|| "",
			).toLowerCase();

			const subclassName = this._getSafeInlineText(cls.subclass?.name || cls.name || "Subclass", {maxLen: 60});
			const entries = modes.map(([mode, refs]) => {
				const label = this._getSafeInlineText(mode, {maxLen: 48});
				const isActive = !!activeName && label.toLowerCase() === activeName;
				const spellList = refs
					.map(ref => {
						const [name, source] = String(ref).split("|");
						return this._formatSpellTag({name, source}, {showProvenance: false});
					})
					.join(", ");
				return `{@b ${label}${isActive ? " (active)" : ""}.} ${spellList}`;
			});

			out.push({
				type: "spellcasting",
				name: `${subclassName} Spells`,
				headerEntries: [
					`${npcName} always has one of the following spell lists prepared, and they don't count against the number of spells ${npcName} can prepare. ${npcName} can change which list is prepared when it finishes a long rest.`,
				],
				footerEntries: entries,
			});
		});
		return out;
	}

	/**
	 * Lowercased `name|source` keys of every spell that belongs to a swappable
	 * subclass list, so the general spellcasting block can leave them to the
	 * dedicated block instead of listing them twice.
	 * @returns {Set<string>}
	 */
	static _getSwappableSpellKeys (state) {
		const keys = new Set();
		(state.getClasses?.() || []).forEach(cls => {
			const tables = cls?.subclass?.subSubclassSpells;
			if (!tables || typeof tables !== "object") return;
			const modes = Object.values(tables).filter(refs => Array.isArray(refs) && refs.length);
			if (modes.length < 2) return;
			modes.flat().forEach(ref => keys.add(String(ref).split("|")[0].trim().toLowerCase()));
		});
		return keys;
	}

	/**
	 * `state.getSpellcastingAbility()` returns null for multiclass characters whose
	 * first class isn't the caster, and the old fallback of "int" put Intelligence
	 * DC 12 on a level-13 Bard and a level-10 Druid. Derive it from the class that
	 * actually casts — the caster class with the most levels — and only guess from
	 * the ability scores when the class is unrecognised.
	 */
	static _CASTER_CLASS_ABILITY = {
		bard: "cha",
		sorcerer: "cha",
		warlock: "cha",
		paladin: "cha",
		cleric: "wis",
		druid: "wis",
		ranger: "wis",
		wizard: "int",
		artificer: "int",
	};

	static _getPrimaryCasterAbility (state) {
		const classes = state.getClasses?.() || [];
		let best = null;
		let bestLevel = 0;
		classes.forEach(cls => {
			const abv = this._CASTER_CLASS_ABILITY[String(cls?.name || "").trim().toLowerCase()];
			if (!abv) return;
			const lvl = Number(cls?.level) || 0;
			if (lvl > bestLevel) { bestLevel = lvl; best = abv; }
		});
		if (best) return best;
		// Unknown or homebrew class: the casting stat is whichever mental score was
		// actually invested in, which beats defaulting everyone to Intelligence.
		return ["int", "wis", "cha"]
			.map(abv => ({abv, mod: state.getAbilityMod?.(abv) ?? 0}))
			.sort((a, b) => b.mod - a.mod)[0].abv;
	}

	static _getSpellDcAndAttack (state, ability) {
		const spellAbility = this._normalizeAbilityAbv(ability
			|| state.getSpellcastingAbility?.()
			|| this._getPrimaryCasterAbility(state));

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

	/**
	 * Routes that simply mean "the class's own spell list" — annotating these adds
	 * noise, whereas a feat/species/subclass grant is real provenance a DM needs.
	 */
	static _GENERIC_SPELL_SOURCE_RE = /^(?:cantrips?\s+known|spells?\s+known|prepared\s+spells?|(?:\w+\s+)?spellbook|class\s+spells?|spellcasting)$/i;

	static _getSpellProvenanceLabel (spell) {
		const raw = String(spell?.sourceFeature || spell?.grantedBy || "").trim();
		if (!raw) return "";
		if (this._GENERIC_SPELL_SOURCE_RE.test(raw)) return "";
		return this._getSafeInlineText(raw, {maxLen: 48});
	}

	/**
	 * Index of feature name → hover tag, rebuilt at the start of every conversion.
	 * Threading it through the dozen `_formatSpellTag` call sites would obscure them for
	 * no gain; conversion is synchronous and single-threaded, so a scoped index is safe.
	 * @type {Map<string, string>}
	 */
	static _spellProvenanceTags = new Map();

	static _rebuildSpellProvenanceTags (state) {
		this._spellProvenanceTags = new Map();
		[
			...(state?.getFeatures?.() || []),
			...(state?.getFeats?.() || []).map(f => ({...f, featureType: f?.featureType || "Feat"})),
		].forEach(feature => {
			const key = this._normalizeFeatureKey(feature?.name);
			const tag = this._getFeatureHoverTag(feature);
			if (!key || !tag || tag === String(feature?.name || "").trim()) return;
			if (!this._spellProvenanceTags.has(key)) this._spellProvenanceTags.set(key, tag);
		});
	}

	/**
	 * Index of spell name → casting time, rebuilt at the start of every conversion.
	 *
	 * Some spell lines are built from a bare `name|source` reference rather than from
	 * a spell record — subclass mode lists and item-granted spells both are — so they
	 * carry no `castingTime` of their own. The character almost always knows the same
	 * spell elsewhere, and that record does carry it, so one index recovers the mark
	 * for lines that would otherwise read as "could not determine".
	 *
	 * @type {Map<string, string>}
	 */
	static _spellCastingTimes = new Map();

	/** @type {Function|null} */
	static _spellCastingTimeLookup = null;

	static _rebuildSpellCastingTimes (state, spellIndex = null) {
		this._spellCastingTimes = new Map();
		this._spellCastingTimeLookup = this._getSpellIndexLookup(spellIndex);
		(state?.getSpells?.() || []).forEach(spell => {
			const key = String(spell?.name || "").trim().toLowerCase();
			const time = String(spell?.castingTime || "").trim();
			if (!key || !time || this._spellCastingTimes.has(key)) return;
			this._spellCastingTimes.set(key, time);
		});
	}

	/**
	 * A spell attributed to a feature that merely *mentions* it (the sheet's grant
	 * parser is generous) and which the character has neither prepared nor recorded in
	 * a spellbook is not actually castable. Listing it implies an option the DM does
	 * not have — Mikase's "Hallow (Divine Sense)" filed as a level 1 spell.
	 *
	 * @param {Object} spell spell record from state
	 * @returns {boolean} true when the grant should not reach the statblock
	 */
	static _isSpuriousFeatureSpell (spell, state = null) {
		if (!spell || spell.prepared || spell.alwaysPrepared || spell.inSpellbook) return false;
		if (!(Number(spell.level) >= 1)) return false;
		const feature = String(spell.sourceFeature || "").trim();
		if (!feature) return false;
		const key = feature.toLowerCase();
		const match = (state?.getFeatures?.() || []).find(f => String(f?.name || "").trim().toLowerCase() === key);
		// Without the feature there is nothing to contradict the grant.
		if (!match) return false;
		const body = this._stripHtmlTags(match.description || "").toLowerCase();
		if (!body) return false;
		// A feature that grants a spell says so; one that merely names it (Divine Sense
		// mentioning Hallow) leaves the character with a spell it cannot cast.
		return !/\b(?:can (?:innately )?cast|always have[^.]{0,40}prepared|always has[^.]{0,40}prepared|know(?:s)? (?:the|this) spell|learn(?:s)?[^.]{0,30}spell|added to your|spell list)\b/.test(body);
	}

	/**
	 * The sheet carries edition variants of the same spell two ways: under a "5e "
	 * display prefix, and as separate printings of one spell reached by two routes
	 * (a class list and a subclass grant), which differ only by source. Either way
	 * listing both reads as two spells.
	 *
	 * @param {Array<string>} tags formatted spell tags
	 * @returns {Array<string>} tags with redundant edition variants removed
	 */
	static _dropEditionVariantSpellTags (tags, {preferredSource = ""} = {}) {
		const baseNames = new Set();
		tags.forEach(tag => {
			const name = (/\{@spell ([^|}]+)/.exec(tag) || [])[1];
			if (name && !/^5e /i.test(name)) baseNames.add(name.trim().toLowerCase());
		});
		const deprefixed = tags.filter(tag => {
			const name = (/\{@spell ([^|}]+)/.exec(tag) || [])[1] || "";
			if (!/^5e /i.test(name)) return true;
			return !baseNames.has(name.replace(/^5e /i, "").trim().toLowerCase());
		});

		// Same spell, two printings: keep one. A tag carrying a provenance
		// parenthetical says where the spell came from, so it outranks a bare one;
		// otherwise defer to the printing the rest of this character uses.
		const wanted = String(preferredSource || "").toLowerCase();
		const byName = new Map();
		deprefixed.forEach(tag => {
			const key = ((/\{@spell ([^|}]+)/.exec(tag) || [])[1] || tag).trim().toLowerCase();
			const prev = byName.get(key);
			if (prev === undefined) return byName.set(key, tag);
			byName.set(key, this._pickPreferredSpellTag(prev, tag, wanted));
		});
		return [...byName.values()];
	}

	/** @returns {string} whichever of two printings of one spell to keep */
	static _pickPreferredSpellTag (a, b, wanted) {
		const provA = /\)\s*$/.test(a);
		const provB = /\)\s*$/.test(b);
		if (provA !== provB) return provA ? a : b;
		if (wanted) {
			const srcA = ((/\{@spell [^|}]+\|([^|}]+)/.exec(a) || [])[1] || "").toLowerCase();
			const srcB = ((/\{@spell [^|}]+\|([^|}]+)/.exec(b) || [])[1] || "").toLowerCase();
			if (srcA !== srcB) {
				if (srcA === wanted) return a;
				if (srcB === wanted) return b;
			}
		}
		return a;
	}

	/**
	 * A character's spells come from several books; the one they use most is the
	 * printing the statblock should speak in.
	 *
	 * @returns {string} lowercased source abbreviation, or "" when undecidable
	 */
	static _getDominantSpellSource (spells) {
		const counts = new Map();
		(spells || []).forEach(s => {
			const src = String(s?.source || "").trim().toLowerCase();
			if (src) counts.set(src, (counts.get(src) || 0) + 1);
		});
		let best = ""; let bestN = 0;
		counts.forEach((n, src) => {
			if (n > bestN) { bestN = n; best = src; }
		});
		return best;
	}

	/**
	 * "hover when you can" — a feat-granted spell shows `(Fey Touched)` as a live link,
	 * while a class feature with no page-backed target degrades to its plain name.
	 */
	static _getSpellProvenanceDisplay (spell) {
		const label = this._getSpellProvenanceLabel(spell);
		if (!label) return "";
		return this._spellProvenanceTags.get(this._normalizeFeatureKey(label)) || label;
	}

	/**
	 * The action economy, as a hoverable superscript.
	 *
	 * MCDM's statblocks mark economy with a superscript letter rather than a
	 * parenthetical: one glyph instead of a dozen characters, on lines a DM scans
	 * dozens of times a session. `{@sup}` renders natively here, and nesting `{@tip}`
	 * inside it means the mark names itself on hover — so it needs no legend, which is
	 * the thing that normally makes superscript notation fail outside a printed book.
	 *
	 * Long casting times superscript the time itself (`¹ʰʳ`) rather than a code letter.
	 * A DM reading `E` has to hover to learn anything, and hovers do not exist on a
	 * tablet or in a markdown copy; `1hr` is already the answer.
	 *
	 * Every readable time is marked, including a plain action. That is deliberate: it
	 * makes an *unmarked* line mean "the casting time could not be read", so the export
	 * reports its own gaps instead of hiding them among the actions.
	 *
	 * @param {string} raw casting/manifestation time as the sheet stores it — "1 bonus",
	 *   "10 minute", "1 reaction, which you take when …"
	 * @returns {string} a `{@sup …}` mark, or `""` when the time is unreadable
	 */
	/**
	 * Regex source for the v19 superscript economy mark. Any pass that parses a tag
	 * positionally — "a parenthetical directly after a spell tag is provenance" — has
	 * to allow the mark to sit between, and any pass that treats a name as an identity
	 * has to strip it first. The mark is presentation; it is never part of a key.
	 */
	static ECONOMY_MARK_RE_SRC = "(?:\\{@sup \\{@tip [^{}|]+\\|[^{}]+\\}\\})";

	/** @returns {string} `text` with every economy mark removed. */
	static _stripEconomyMarks (text) {
		return String(text || "").replace(new RegExp(this.ECONOMY_MARK_RE_SRC, "g"), "");
	}

	static _getEconomyMark (raw) {
		const time = String(raw || "").trim();
		if (!time) return "";

		if (/^(?:1\s+)?bonus\b/i.test(time)) return this._formatEconomyMark("B", "Bonus Action");
		if (/^(?:1\s+)?reaction\b/i.test(time)) return this._formatEconomyMark("R", "Reaction");
		if (/^(?:1\s+)?action\b/i.test(time)) return this._formatEconomyMark("A", "Action");

		// The sheet stores the unit unpluralised — "10 minute", "24 hour".
		const m = /^(\d+)\s*(minute|hour|round|day)s?\b/i.exec(time);
		if (!m) return "";
		const n = Number(m[1]);
		const unit = m[2].toLowerCase();
		const abbr = {minute: "min", hour: "hr", round: "rd", day: "day"}[unit];
		const full = `${unit.charAt(0).toUpperCase()}${unit.slice(1)}${n === 1 ? "" : "s"}`;
		return this._formatEconomyMark(`${n}${abbr}`, `Takes ${n} ${full}`);
	}

	/** @returns {string} one superscript economy mark that names itself on hover */
	static _formatEconomyMark (glyph, title) {
		return `{@sup {@tip ${glyph}|${title}}}`;
	}

	static _formatSpellTag (spell, {showProvenance = true} = {}) {
		const name = this._getSafeInlineText(spell?.name || "spell", {maxLen: 80}) || "spell";
		const source = this._getSafeSourceJson(spell?.source || Parser.SRC_XPHB || "XPHB");
		// The economy mark binds tightest to the name, ahead of any provenance
		// parenthetical — `_pickPreferredSpellTag` reads a *trailing* `)` as "this tag
		// carries provenance", so a mark placed after the paren would spoof that test.
		const castingTime = spell?.castingTime
			|| this._spellCastingTimes.get(String(spell?.name || "").trim().toLowerCase())
			|| this._spellCastingTimeLookup?.(spell)?.castingTime
			|| "";
		const tag = `{@spell ${name}|${source}}${this._getEconomyMark(castingTime)}`;
		if (!showProvenance) return tag;
		const provenance = this._getSpellProvenanceDisplay(spell);
		return provenance ? `${tag} (${provenance})` : tag;
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
			state.getSpellcastingAbility?.() || state.getSpellcasting?.()?.ability || this._getPrimaryCasterAbility(state),
		);
		const preparedSpells = state.getPreparedSpells?.() || spellsKnown.filter(s => s.prepared || s.alwaysPrepared);
		const isPactCaster = pactMax > 0 && !hasSlotTable;

		// Swappable subclass lists get their own block; listing them here too would
		// imply the character has both modes prepared at once.
		const swappableKeys = this._getSwappableSpellKeys(state);
		const isSwappable = spell => swappableKeys.has(String(spell?.name || "").trim().toLowerCase())
			|| this._isSpuriousFeatureSpell(spell, state);
		const dominantSource = this._getDominantSpellSource([...cantrips, ...spellsKnown]);

		const will = this._dropEditionVariantSpellTags(
			cantrips
				.filter(s => !isSwappable(s))
				.map(s => this._formatSpellTag(s)),
			{preferredSource: dominantSource},
		).sort((a, b) => a.localeCompare(b));

		const spells = {};

		if (isPactCaster) {
			const pactSpells = this._dropEditionVariantSpellTags([...new Set(
				[...preparedSpells, ...spellsKnown]
					.filter(s => Number(s.level) >= 1 && Number(s.level) <= pactLevel && !isSwappable(s))
					.map(s => this._formatSpellTag(s)),
			)], {preferredSource: dominantSource});
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
						.filter(s => Number(s.level) === level && !isSwappable(s))
						.map(s => this._formatSpellTag(s));
					const knownAtLevel = spellsKnown
						.filter(s => Number(s.level) === level && !isSwappable(s))
						.map(s => this._formatSpellTag(s));
					const lvlSpells = this._dropEditionVariantSpellTags(
						[...new Set([...preparedAtLevel, ...knownAtLevel])],
						{preferredSource: dominantSource},
					);
					if (!lvlSpells.length) return;
					spells[level] = {slots: slotInfo.max, spells: lvlSpells};
				});

			// Multiclass warlock: surface pact slots as additional note level if present and not already represented
			if (pactMax > 0 && !spells[pactLevel]) {
				const pactSpells = this._dropEditionVariantSpellTags([...new Set(
					[...preparedSpells, ...spellsKnown]
						.filter(s => Number(s.level) >= 1 && Number(s.level) <= pactLevel && !isSwappable(s))
						.map(s => this._formatSpellTag(s)),
				)], {preferredSource: dominantSource});
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
					// The three turn economies become superscript marks, matching the spell and
					// power rosters. Anything else ("Stance", "Free Action") has no glyph and
					// keeps its parenthetical rather than being silently dropped.
					const actionTypeRaw = m.actionType ? this._getSafeInlineText(m.actionType, {maxLen: 24}) : "Action";
					const economyMark = this._getEconomyMark(actionTypeRaw);
					const actionType = economyMark || (actionTypeRaw ? ` (${actionTypeRaw})` : "");
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

		const stances = methods.filter(m => m?.isStance);
		if (stances.length) {
			// Every stance body repeated the same duration sentence. It is a rule of the
			// subsystem, not of any one stance, so the subsystem states it once.
			entries.push(`{@b Stances.} A stance costs the stamina listed above and lasts until ${npcName} is {@condition incapacitated} or ends it (Bonus Action).`);
		}

		// Expand stance riders so effects aren't name-only. The name is hoverable here
		// exactly as it is in the cost roster above, so the body only has to say what the
		// stance *does* — the full rule is one hover away.
		stances.forEach(m => {
			const safeName = this._getSafeInlineText(m.name, {maxLen: 80}) || "Stance";
			const safeSource = this._getSafeSourceJson(m.source || Parser.SRC_TGTT || Parser.SRC_XPHB);
			const body = this._condenseStanceBody(this._prepareFeatureTextForNpc(m.description || "", {npcName}));
			// A stance whose prose is entirely flavour ("Vern Hollow heightens its senses")
			// tells the DM strictly less than the hoverable name three lines above. Say
			// nothing rather than spend a line saying nothing.
			if (!body) return;
			entries.push(`{@b {@combatmethod ${safeName}|${safeSource}} (Stance).} ${body}`);
		});

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
			protectedFeatureNames = [],
		} = {},
	) {
		const protectedKeys = new Set(protectedFeatureNames.map(name => this._normalizeFeatureKey(name)).filter(Boolean));
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const sourceFeatureIds = new Set((state.getNamedModifiers?.() || [])
			.map(mod => mod?.sourceFeatureId)
			.filter(Boolean));
		const defenses = this._getExportDefenses(state, {defenseMode: "persistent"});
		const speed = this._getSpeedObject(state);
		const skills = this._getSkillBlock(state);
		const resourceIndex = this._buildResourceIndex(state);
		// Expensive and not memoized, so read once for the whole feature pass.
		const psionicCalc = state?.getFeatureCalculations?.() || {};

		// Class/race/etc features + feats (feats live on getFeats(), not getFeatures()).
		const features = [
			...(state.getFeatures?.() || [])
				// Utility powers are rostered in the "Powers" spellcasting block; only
				// powers that resolve in combat earn an entry of their own.
				.filter(f => !(f?._entityType === "psionicPower" && !this._isSignaturePsionicPower(f)))
				.map(f => this._expandPsionicPower(f, psionicCalc))
				.filter(f => f?.name && f?.description)
				.filter(f => !(typeof CharacterSheetClassUtils !== "undefined" && CharacterSheetClassUtils.isCombatMethod?.(f))),
			...(state.getFeats?.() || [])
				.filter(f => f?.name && f?.description)
				.map(f => ({
					...f,
					featureType: f.featureType || "Feat",
					// Feats are combat-relevant by default when they mention action economy
					important: f.important != null ? f.important : true,
				})),
		];

		const selectedSet = new Set((selectedFeatureIds || []).map(String));
		const classified = features
			.map(feature => this._classifyFeatureForStatblock(feature, {
				sourceFeatureIds,
				defenses,
				speed,
				skills,
				resourceIndex,
			}))
			.filter(({feature, classification}) => {
				if (suppressExtraAttack && /\bextra attacks?\b/i.test(String(feature?.name || ""))) return false;
				if (includeFeatures === "manual") {
					const id = String(feature.id || feature.name || "");
					return selectedSet.has(id) || selectedSet.has(String(feature.name || ""));
				}
				if (includeFeatures === "allImportant") return classification === "important" || feature?.important;
				return classification === "important";
			});

		// Prefer activatable / limited-use variants when names collide (e.g. Thunderous Blows + 10th-level upgrade).
		// A level-20 kit genuinely holds more than a level-8 one; a fixed cap silently
		// deleted a fifth of Phirse's class features.
		const totalLevel = Number(state.getTotalLevel?.()) || 0;
		const autoCap = includeFeatures === "manual" ? 24 : Math.min(26, 18 + Math.max(0, totalLevel - 12));
		const deduped = this._dedupeClassifiedFeatures(classified);
		// A feature that owns a limited-use pool is exempt from the cap: dropping it leaves
		// the pool orphaned in Class Resources with nothing on the block to explain it.
		// The same holds for a feature another line already points at by name.
		const poolOwners = new Set(deduped.filter(row => (
			this._resolveFeatureUses(row?.feature, resourceIndex)
			|| protectedKeys.has(this._normalizeFeatureKey(row?.feature?.name))
		)));
		const ranked = deduped
			.filter(row => !poolOwners.has(row))
			.sort((a, b) => this._getFeatureRowPriority(b, resourceIndex) - this._getFeatureRowPriority(a, resourceIndex));
		const keep = new Set([...poolOwners, ...ranked.slice(0, Math.max(0, autoCap - poolOwners.size))]);
		const capped = deduped.filter(row => keep.has(row));

		capped.forEach(({feature, analysis}) => {
			const templated = this._getTemplatedFeatureText(feature, {npcName, analysis, state});
			let entries = templated
				? [templated]
				: this._prepareFeatureEntriesForNpc(feature.description, {npcName});
			const uses = this._resolveFeatureUses(feature, resourceIndex);
			const usesShort = this._formatUsesShort(uses);
			// Drop trailing long-form uses from body when name carries them
			if (usesShort) {
				entries = entries.map(text => String(text || "")
					.replace(/\s*\(\s*\d+\s*\/\s*(?:Long Rest|Short Rest|Short or Long Rest|LR|SR|SR or LR|Day)\s*\)\s*\.?$/i, "")
					.replace(/\s*\(\s*\d+\s*\/\s*(?:LR|SR)\s*\)\s*\.?$/i, "")
					.trim());
			}
			const baseName = this._getSafeInlineText(this._normalizeFeatureDisplayName(feature.name), {maxLen: 72}) || "Feature";
			const name = usesShort ? `${baseName} ${usesShort}` : baseName;
			const attackLine = this._getSynthesizedFeatureAttackLine(feature, {state, npcName});
			const entry = {
				name,
				entries: [attackLine, ...entries].filter(Boolean),
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

	/**
	 * Some subclasses grant an attack in prose rather than as a weapon: Arthur's satellites
	 * are a bonus-action ranged spell attack whose to-hit and damage are buried in two
	 * hundred words of binding rules, so Multiattack referenced an attack the block never
	 * stated. A DM cannot roll prose.
	 *
	 * Keyed on the wording, not the feature name: any feature that says it makes a spell
	 * attack with a stated ability and damage die gets a stat line at the top of its own
	 * entry, which keeps the subsystem in one place.
	 *
	 * @param {Object} feature sheet feature
	 * @param {Object} opts
	 * @param {Object} opts.state character sheet state
	 * @param {string} opts.npcName
	 * @returns {string|null} a leading stat line, or null when the feature grants no attack
	 */
	static _getSynthesizedFeatureAttackLine (feature, {state = null, npcName = "The NPC"} = {}) {
		void npcName;
		const raw = this._stripHtmlTags(feature?.description || "");
		if (!/\bspell attack\b/i.test(raw)) return null;

		const economy = /\buse (?:a|an) (bonus action|action|reaction) to make a (ranged|melee) spell attack\b/i.exec(raw);
		if (!economy) return null;
		const abilityM = /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) is your ability modifier for this attack\b/i.exec(raw);
		const damageM = /\bequal to (\d+d\d+) \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\b/i.exec(raw);
		if (!abilityM || !damageM) return null;

		const mod = Number(state?.getAbilityMod?.(abilityM[1].slice(0, 3).toLowerCase()));
		const pb = Number(state?.getProficiencyBonus?.()) || 0;
		const dmgMod = Number(state?.getAbilityMod?.(damageM[2].slice(0, 3).toLowerCase()));
		if (!Number.isFinite(mod) || !Number.isFinite(dmgMod)) return null;

		// Prose states the level-3 range and then an upgrade; the block should print the
		// range this creature actually has.
		let range = Number(/\bwithin (\d+) feet of you\b/i.exec(raw)?.[1]) || 0;
		const upgrade = /\bWhen you reach (\d+)\w* level in this class, the range of this spell attack increases to (\d+) feet\b/i.exec(raw);
		if (upgrade && (Number(state?.getTotalLevel?.()) || 0) >= Number(upgrade[1])) range = Number(upgrade[2]);

		const types = /\bdeals ([a-z]+(?: or [a-z]+)?) damage\b/i.exec(raw)?.[1] || "force";
		const dmg = dmgMod ? `${damageM[1]}${this._toSignedStr(dmgMod)}` : damageM[1];
		const label = economy[1].toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
		const rangeBit = range ? `range ${range} ft., ` : "";
		return `{@b Attack (${label}).} {@atk ${economy[2].toLowerCase() === "melee" ? "ms" : "rs"}} {@hit ${this._toSignedStr(mod + pb)}} to hit, ${rangeBit}one target. {@h} {@damage ${dmg}} ${types} damage.`;
	}

	static _buildResourceIndex (state) {
		const idx = new Map();
		const add = (raw) => {
			if (!raw?.name) return;
			const key = this._normalizeFeatureKey(raw.name);
			if (!key || idx.has(key)) return;
			const max = Number(raw.max);
			if (!Number.isFinite(max) || max <= 0) return;
			idx.set(key, {
				max,
				recharge: raw.recharge || raw.recovery || "",
			});
		};
		(state.getGenericPoolResources?.() || state.getResources?.() || []).forEach(add);
		(state.getSyntheticCombatResources?.() || []).forEach(add);
		(state.getResources?.() || []).forEach(add);
		return idx;
	}

	static _resolveFeatureUses (feature, resourceIndex = new Map()) {
		if (feature?.uses && Number.isFinite(Number(feature.uses.max)) && Number(feature.uses.max) > 0) {
			return {max: Number(feature.uses.max), recharge: feature.uses.recharge || ""};
		}
		const key = this._normalizeFeatureKey(feature?.name);
		if (key && resourceIndex.has(key)) return resourceIndex.get(key);
		// Fuzzy: resource "Channel Divinity" for feature "Channel Divinity: Destructive Wrath"
		if (key) {
			for (const [rk, val] of resourceIndex.entries()) {
				if (this._featureKeyMatches(key, rk)) return val;
			}
		}
		return null;
	}

	/** Compact uses marker for ability names: (6/LR), (2/SR), (3/Day). */
	static _formatUsesShort (uses) {
		if (!uses || !Number.isFinite(Number(uses.max)) || Number(uses.max) <= 0) return "";
		const max = Number(uses.max);
		if (max >= 999) return "(∞)";
		const recharge = String(uses.recharge || "").toLowerCase();
		if (recharge.includes("short") && recharge.includes("long")) return `(${max}/SR or LR)`;
		if (recharge.includes("short")) return `(${max}/SR)`;
		if (recharge.includes("long")) return `(${max}/LR)`;
		if (recharge.includes("dawn")) return `(${max}/Dawn)`;
		if (recharge.includes("day") || !recharge) return `(${max}/Day)`;
		return `(${max})`;
	}

	static _normalizeFeatureKey (name) {
		return this._stripEconomyMarks(name)
			.toLowerCase()
			.replace(/\s*\([^)]*level[^)]*\)\s*/gi, " ")
			.replace(/\s*\d+(?:st|nd|rd|th)\s*level\s*/gi, " ")
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}

	/**
	 * Substring matching on normalized keys silently corrupts statblocks: "rage" is
	 * inside "aura of cou{rage}" and "master fo{rage}r", and contains "age", so a
	 * Paladin inherited barbarian Rage resistances and a racial flavour trait
	 * inherited Rage's use count. Match whole tokens instead — a resource applies to
	 * a feature when every one of its words appears as a word in that feature's name,
	 * which still links "Channel Divinity" to "Channel Divinity: Destructive Wrath".
	 */
	static _featureKeyMatches (featureKey, resourceKey) {
		const a = String(featureKey || "").split(" ").filter(Boolean);
		const b = String(resourceKey || "").split(" ").filter(Boolean);
		if (!a.length || !b.length) return false;
		const have = new Set(a);
		if (b.every(tok => have.has(tok))) return true;
		const haveB = new Set(b);
		return a.every(tok => haveB.has(tok));
	}

	/**
	 * One-directional counterpart to {@link _featureKeyMatches}: the feature name must
	 * contain every token of the state name. Availability detection cannot use the
	 * bidirectional form, or a subclass feature named "Champion" unlocks "Exalted Champion".
	 */
	static _featureNameCoversState (featureKey, stateKey) {
		const feature = String(featureKey || "").split(" ").filter(Boolean);
		const stateTokens = String(stateKey || "").split(" ").filter(Boolean);
		if (!feature.length || !stateTokens.length) return false;
		const have = new Set(feature);
		return stateTokens.every(tok => have.has(tok));
	}

	static _normalizeFeatureDisplayName (name) {
		return String(name || "")
			.replace(/\s*\([^)]*level[^)]*\)\s*/gi, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	/** Higher wins a slot under the auto cap. */
	static _getFeatureRowPriority (row, resourceIndex) {
		const feature = row?.feature;
		let score = 0;
		if (this._resolveFeatureUses?.(feature, resourceIndex)) score += 5;
		if (Number(feature?.uses?.max || 0) > 0) score += 4;
		if (this._getFeatureActivationSection(feature, row?.analysis)) score += 3;
		if (row?.analysis?.isActivatable) score += 2;
		if (row?.analysis?.hasResourceCost) score += 2;
		if (feature?.important) score += 1;
		// A signature ability is the one that does something measurable. Without this,
		// Phirse's 6d10 Time Pocket lost the cap contest to a passive reroll feature.
		const body = String(feature?.description || "");
		if (/\b\d+d\d+\b/.test(body)) score += 3;
		if (/\bgains? \d+ strain\b|\bexpends? \d+\b|\bspends? \d+\b/i.test(body)) score += 2;
		return score;
	}

	static _dedupeClassifiedFeatures (classified) {
		const byKey = new Map();
		const rank = (row) => {
			const section = this._getFeatureActivationSection(row.feature, row.analysis);
			const uses = Number(row.feature?.uses?.max || 0) > 0 ? 2 : 0;
			const act = section ? 3 : 0;
			const important = row.feature?.important ? 1 : 0;
			const len = String(row.feature?.description || "").length;
			return act + uses + important + Math.min(2, Math.floor(len / 200));
		};

		// "Psychic Boost (two uses)" is a level-12 upgrade *note*, not a distinct feature;
		// left un-merged it outranked the real feature and exported as its own entry
		// restating the use count. Only upgrade-shaped parentheticals fold — "Fighting
		// Style (Defense)" names a genuinely different feature.
		const UPGRADE_PAREN = /\s*\((?:(?:\d+|two|three|four|five) uses?|improved|upgraded|level \d+|\d+(?:st|nd|rd|th) level)\)\s*$/i;
		classified.forEach(row => {
			const key = this._normalizeFeatureKey(String(row.feature?.name || "").replace(UPGRADE_PAREN, ""));
			if (!key) return;
			const prev = byKey.get(key);
			if (!prev || rank(row) >= rank(prev)) byKey.set(key, row);
		});
		return [...byKey.values()];
	}

	/**
	 * Split a feature description into its authored sub-sections.
	 *
	 * Rendered feature HTML marks labelled sub-blocks with
	 * `data-roll-name-ancestor="<Label>"` (Daemonologist's "Arch Daemon Boon",
	 * "Arch Seraph Boon", "Switch Sides", …). Flattening such a feature to one
	 * string and then trimming it at a character budget silently amputates whole
	 * sections — "Borrowed Tongues and Hides" used to end at a bare
	 * "Arch Seraph Boon." with the mechanic gone. Splitting first means each
	 * section gets its own budget and none can be dropped.
	 *
	 * @param {string} description raw feature description (HTML or plain)
	 * @returns {Array<{label: string|null, html: string}>}
	 */
	static _splitFeatureDescriptionSections (description) {
		const raw = String(description || "");
		if (!raw.trim()) return [];

		const markerRe = /<div\b[^>]*\bdata-roll-name-ancestor\s*=\s*"([^"]*)"[^>]*>/gi;
		const markers = [];
		let match;
		while ((match = markerRe.exec(raw)) !== null) {
			markers.push({label: match[1], start: match.index, bodyStart: match.index + match[0].length});
		}
		if (!markers.length) return [{label: null, html: raw}];

		const out = [];
		const pushIfContent = (label, html) => {
			if (this._stripHtmlTags(html).trim()) out.push({label, html});
		};

		pushIfContent(null, raw.slice(0, markers[0].start));

		markers.forEach((marker, ix) => {
			const limit = ix + 1 < markers.length ? markers[ix + 1].start : raw.length;
			// Walk div open/close tags so trailing prose that follows the labelled
			// block (e.g. "Once you use this feature…") is not misattributed to it.
			const sectionEnd = this._findDivCloseIndex(raw, marker.bodyStart, limit);
			// The rendered heading repeats the label; keeping it would print
			// "{@b Switch Sides.} Switch Sides. As a Bonus Action…".
			pushIfContent(marker.label, raw.slice(marker.bodyStart, sectionEnd).replace(/<h\d\b[^>]*>[\s\S]*?<\/h\d>/gi, " "));
			pushIfContent(null, raw.slice(sectionEnd, limit));
		});

		return out;
	}

	/**
	 * Split a chunk of feature HTML on its authored paragraph boundaries.
	 * Statblock `entries` arrays render one paragraph per string, so honouring the
	 * source's own `<p>` breaks both matches the author's intent and keeps every
	 * paragraph inside its own length budget — a single blob was being trimmed at a
	 * sentence boundary, silently discarding later paragraphs (Eternal War Eruption
	 * lost its save-for-half clause, its spell-slot recovery and its recharge).
	 * @param {string} html
	 * @returns {Array<string>}
	 */
	static _splitHtmlParagraphs (html) {
		const raw = String(html || "");
		if (!/<p\b/i.test(raw)) return [raw];

		const parts = [];
		const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
		let match;
		let lastEnd = 0;
		while ((match = re.exec(raw)) !== null) {
			const before = raw.slice(lastEnd, match.index);
			if (this._stripHtmlTags(before).trim()) parts.push(before);
			parts.push(match[1]);
			lastEnd = match.index + match[0].length;
		}
		const tail = raw.slice(lastEnd);
		if (this._stripHtmlTags(tail).trim()) parts.push(tail);
		return parts.length ? parts : [raw];
	}

	/**
	 * Index of the `</div>` that closes the div opened just before `from`.
	 * @param {string} raw
	 * @param {number} from index just past the opening tag
	 * @param {number} limit hard stop
	 * @returns {number}
	 */
	static _findDivCloseIndex (raw, from, limit) {
		const tagRe = /<(\/?)div\b[^>]*>/gi;
		tagRe.lastIndex = from;
		let depth = 1;
		let tag;
		while ((tag = tagRe.exec(raw)) !== null) {
			if (tag.index >= limit) break;
			depth += tag[1] ? -1 : 1;
			if (depth === 0) return tag.index;
		}
		return limit;
	}

	/**
	 * Feature body as an array of statblock entries — one per authored sub-section,
	 * each labelled in bold. Callers that need a single string keep using
	 * `_prepareFeatureTextForNpc`.
	 * @param {string} description
	 * @param {{npcName?: string, maxLen?: number}} [opts]
	 * @returns {Array<string>}
	 */
	static _prepareFeatureEntriesForNpc (description, {npcName = "The NPC", maxLen = 900} = {}) {
		const sections = this._splitFeatureDescriptionSections(description);
		if (!sections.length) return [];

		const out = [];
		sections.forEach(({label, html}) => {
			// Sidebars aimed at the player ("Rules Tip: Forced Movement") explain the general
			// rules, not this creature — they are pure noise on a statblock.
			if (label && /^\s*(?:rules? tip|tip|sidebar|design note)\b/i.test(label)) return;
			const safeLabel = label ? this._getSafeInlineText(label, {maxLen: 64}) : "";
			let isFirstParagraph = true;
			this._splitHtmlParagraphs(html).forEach(paragraph => {
				const body = this._prepareFeatureTextForNpc(paragraph, {npcName, maxLen});
				if (!body) return;
				const prefix = safeLabel && isFirstParagraph ? `{@b ${safeLabel}.} ` : "";
				const deduped = prefix ? this._stripLeadingLabelEcho(body, safeLabel) : body;
				if (!deduped) return;
				isFirstParagraph = false;
				out.push(`${prefix}${prefix ? deduped : this._boldInlineOptionLabel(deduped)}`);
			});
		});
		return out;
	}

	/**
	 * Sources that mark a sub-section with a heading tag are handled by the `<h\d>` strip in
	 * `_splitFeatureDescriptionSections`, but some author the label as ordinary leading
	 * body text. Emitting the bold prefix on top of that prints "{@b Forceful Blow.}
	 * Forceful Blow. The target is pushed…".
	 * @param {string} body
	 * @param {string} label
	 * @returns {string}
	 */
	/**
	 * Features that offer a menu of named options often author them as plain
	 * "Shadowbite: …" paragraphs. Statblocks bold an option name so a DM can scan the
	 * list mid-combat, which is most of what makes a long feature readable.
	 * @param {string} body
	 * @returns {string}
	 */
	static _boldInlineOptionLabel (body) {
		const clean = String(body || "").trim();
		const match = /^([A-Z][^.:;{}]{1,38}):\s+(?=[A-Z"“{])/.exec(clean);
		if (!match) return clean;
		// A colon after a clause ("it gains the following: …") is not an option name.
		if (/\b(?:following|these|below|are|is|include[sd]?)$/i.test(match[1].trim())) return clean;
		return `{@b ${match[1].trim()}.} ${clean.slice(match[0].length)}`;
	}

	static _stripLeadingLabelEcho (body, label) {
		const clean = String(body || "").trim();
		const wanted = String(label || "").trim().replace(/[.:]+$/, "");
		if (!clean || !wanted) return clean;
		const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return clean.replace(new RegExp(`^${escaped}\\s*[.:—-]\\s*`, "i"), "").trim();
	}

	/**
	 * Some rules text addresses the reader with a bare imperative — "Choose one creature
	 * within range, then make a Charisma check" — which the second-to-third person pass
	 * cannot see, because there is no "you" in it. The sentence then survives into the
	 * statblock still ordering the DM around, or is judged flavour and dropped.
	 *
	 * Restore the elided subject rather than conjugating here: once the sentence says
	 * "you choose", every downstream rule (naming, pronouns, conjugation) applies to it
	 * exactly as it does to the rest of the prose.
	 *
	 * @param {string} text
	 * @returns {string} text with sentence-initial imperatives given their subject
	 */
	static _resolveImperativeVoice (text) {
		const VERBS = "choose|select|pick|roll|make|target|designate";
		return String(text || "")
			.replace(new RegExp(`(^|[.:!?]\\s+|<p>)(${VERBS})\\b`, "gi"), (m, pre, verb) => `${pre}you ${verb.toLowerCase()}`)
			// "…, then make a Charisma check" shares the elided subject of the first clause.
			// The verb can carry an adverb ("then psionically weaken the form"), and is only
			// a verb when the word after "then" is not itself a subject or determiner.
			.replace(/\b(,\s*then\s+)((?:\w+ly\s+)?)([a-z]{3,})\b/g, (m, pre, adverb, verb) => (
				this._THEN_NON_VERBS.has(verb) ? m : `${pre}you ${adverb}${verb}`
			));
	}

	/** Words that can follow ", then" without being an elided-subject verb. */
	static _THEN_NON_VERBS = new Set([
		"you", "your", "it", "its", "they", "their", "them", "the", "each", "every", "that", "this", "those", "these",
		"all", "any", "one", "another", "both", "either", "neither", "his", "her", "hers", "she", "him", "himself",
		"herself", "itself", "for", "until", "when", "while", "after", "before", "once", "again", "immediately",
		"and", "but", "there", "here", "creature", "damage",
	]);

	static _prepareFeatureTextForNpc (description, {npcName = "The NPC", maxLen = 900} = {}) {
		const stripped = this._resolveImperativeVoice(this._stripHtmlTags(description));
		const normalized = this._normalizeAbilityTextForNpc(stripped, {npcName, maxLen});
		return this._enrichNpcTags(normalized);
	}

	static _getTemplatedFeatureText (feature, {npcName = "The NPC", analysis = null, state = null} = {}) {
		const name = String(feature?.name || "").toLowerCase();
		const plain = this._stripHtmlTags(feature?.description || "").toLowerCase();

		// Templates are authored in second person and pushed through the normal prose
		// pipeline, so they inherit the same name-then-pronoun and tagging rules.
		const render = (secondPerson) => this._prepareFeatureTextForNpc(secondPerson, {npcName});

		if (name === "rage" || name === "rage (barbarian)") {
			// Resistances are annotated on the resist block as "while raging" — keep prose short.
			return render("You enter a rage as a bonus action (not while wearing heavy armor). While raging, you have advantage on Strength checks and Strength saving throws. The rage ends early if you are knocked unconscious or if your turn ends without you having attacked a hostile creature or taken damage since the last turn.");
		}

		if (/^stone'?s endurance$/.test(name) || /^stone endurance$/.test(name) || (/shrug off harm|reduce the damage/.test(plain) && /reaction/.test(plain) && /d12/.test(plain))) {
			const conMod = state?.getAbilityMod?.("con");
			const conBit = Number.isFinite(Number(conMod))
				? ` and add your Constitution modifier (${this._toSignedStr(conMod)})`
				: " and add your Constitution modifier";
			return render(`When you take damage, you can use a reaction to roll a d12${conBit}, reducing the damage by the total.`);
		}

		// The Talent's class-rules feature is 28,781 characters of player-facing HTML —
		// strain tables, "Learning New Powers" tables and designer commentary — which
		// flattened into an 8,700-character reaction. Everything a DM needs from it is
		// six numbers the sheet already computes.
		if (name === "psionic powers" || name === "psionics") {
			const calc = state?.getFeatureCalculations?.() || {};
			if (!calc.hasPsionicPowers) return null;
			const ability = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"}[String(calc.manifestationAbility || "").toLowerCase()] || "Intelligence";
			const head = [];
			// The Powers block's header states the manifestation ability and save DC, in the
			// book's own words. Repeating them here would say them twice on one page — but a
			// manifester with no roster has no such header, so the facts stay put.
			if (!this._hasPsionicRoster(state)) {
				head.push(`${ability} is ${npcName}'s manifestation ability`);
				if (Number.isFinite(Number(calc.powerSaveDc))) head.push(`power save {@dc ${calc.powerSaveDc}}`);
			}
			if (Number.isFinite(Number(calc.powerAttackBonus))) head.push(`{@hit ${calc.powerAttackBonus}} with power attacks`);
			const tail = [];
			if (calc.manifestationDie) tail.push(`Manifestation die {@dice ${calc.manifestationDie}}`);
			if (Number.isFinite(Number(calc.strainMaximum))) tail.push(`strain maximum ${calc.strainMaximum}`);
			if (Number.isFinite(Number(calc.maxPowerOrder))) tail.push(`knows powers up to ${this._toOrdinal(calc.maxPowerOrder)} order`);
			const sentences = [];
			if (head.length) sentences.push(`${head.join(", ")}.`);
			if (tail.length) sentences.push(`${tail.join("; ")}.`);
			return sentences.join(" ") || null;
		}

		if (/^reckless attack$/.test(name)) {
			return render("At the start of your turn, you can gain advantage on melee weapon attack rolls during that turn, but attack rolls against you have advantage until the start of your next turn.");
		}

		// High-traffic feats. Rulebook phrasing spends three or four sentences on what a
		// statblock states in one clause; the numeric halves are already folded into the
		// block and stripped upstream, so only the behavioural half is templated here.
		const feats = {
			"sentinel": "Creatures it hits with an opportunity attack have their speed reduced to 0 for the turn, and it can make an opportunity attack when a creature within 5 feet attacks someone else.",
			"alert": "It can't be surprised while conscious, and unseen attackers gain no advantage against it.",
			"savage attacker": "Once per turn it can reroll a melee weapon's damage dice and use either result.",
			"war caster": "It has advantage on Constitution saves to maintain concentration, can cast with its hands full, and can cast a spell with a casting time of 1 action in place of an opportunity attack.",
			"shield master": "On a successful Dexterity save it takes no damage instead of half, and it can shove with its shield as a bonus action after the Attack action.",
			"great weapon master": "On a critical hit or a kill with a melee weapon it can make one melee weapon attack as a bonus action.",
			"lucky": "It has luck points it can spend to reroll an attack, ability check or save, or to force an attacker to reroll.",
			"polearm master": "After attacking with a glaive, halberd, quarterstaff or spear it can make a bonus-action attack with the weapon's butt end (1d4 bludgeoning), and it can make an opportunity attack when a creature enters its reach.",
			"mobile": "Difficult terrain costs it no extra movement when it Dashes, and a creature it makes a melee attack against provokes no opportunity attack from it that turn.",
		};
		if (feats[name] && this._isFeatLikeFeature(feature)) return render(feats[name]);

		// Prefer cleaned prose for everything else.
		void analysis;
		return null;
	}

	/**
	 * The template table is keyed on bare names, which a homebrew class feature could
	 * collide with. Only apply a feat template to something the sheet actually files as
	 * a feat.
	 */
	static _isFeatLikeFeature (feature) {
		const type = String(feature?.type || feature?.category || feature?.featureType || "").toLowerCase();
		if (type.includes("feat")) return true;
		return !feature?.className && !feature?.subclassName && !feature?.source?.includes("class");
	}

	static _classifyFeatureForStatblock (
		feature,
		{
			sourceFeatureIds = new Set(),
			defenses = null,
			speed = null,
			skills = null,
			resourceIndex = new Map(),
		} = {},
	) {
		const analysis = CharacterSheetState.analyzeFeature?.(feature) || null;
		const rawText = String(feature?.description || "").toLowerCase();
		const plain = this._stripHtmlTags(feature?.description || "").toLowerCase();

		// A feature whose uses live in a separate resource pool still has limited uses;
		// missing that is what strands pools like Indomitable in Class Resources.
		const hasLimitedUses = Number(feature?.uses?.max || 0) > 0 || !!this._resolveFeatureUses(feature, resourceIndex);
		const hasCombatKeyword = /\b(action|bonus action|reaction|saves?|saving throws?|damage|attacks?|resistance|immunity|advantage|disadvantage)\b/i.test(rawText);
		const isBackgroundFeature = String(feature?.featureType || "").toLowerCase() === "background";

		const isImportant = !!(
			hasLimitedUses
			|| feature?.important
			|| analysis?.isActivatable
			|| analysis?.hasResourceCost
			|| hasCombatKeyword
		);

		const effectTypes = new Set((analysis?.effects || []).map(e => e?.type).filter(Boolean));
		// A statblock has structural room for numeric bumps — they land in AC, HP, speed,
		// the attack lines — so a feature that only produces those is genuinely restated by
		// the numbers. It has **no** room for advantage/disadvantage, so those effect types
		// are never "already applied"; treating them as such is what silently deleted
		// Reckless Attack, Danger Sense, Feral Instinct and Magic Resistance from the block
		// and demoted them to terse "Additional Effects" bullets.
		const statDerivedEffectTypes = new Set([
			"bonus", "penalty", "setMinimum", "setMaximum", "setValue",
			"proficiency", "expertise",
			"setSpeed", "speed", "ac", "hp", "damage", "attack",
		]);
		const allEffectsAreStatDerived = effectTypes.size
			&& [...effectTypes].every(type => statDerivedEffectTypes.has(type))
			// Numeric effects only account for the *numbers*. A feature that also offers
			// named choices (Brutal Strike's Forceful Blow / Hamstring Blow) carries
			// mechanics no stat bump can express, so it still has to be printed.
			&& this._splitFeatureDescriptionSections(feature?.description || "").length <= 1;
		const activationSection = this._getFeatureActivationSection(feature, analysis);

		const fullyInferredOnBlock = this._isFeatureFullyInferredOnBlock(feature, plain, {
			defenses,
			speed,
			skills,
			effectTypes,
		});

		// A feature that produced modifiers is not necessarily *fully* represented by them —
		// Unstoppable emits condition immunities but also grants rage-while-incapacitated.
		// Only treat it as covered when it says nothing else combat-relevant.
		const isAlreadyApplied = !!(
			!activationSection
			&& (
				allEffectsAreStatDerived
				|| fullyInferredOnBlock
				|| (sourceFeatureIds.has(feature?.id) && !hasCombatKeyword)
			)
		);

		if (isBackgroundFeature) {
			return {feature, analysis, classification: "notImportant"};
		}

		if (isAlreadyApplied) return {feature, analysis, classification: "alreadyApplied"};
		if (!isImportant) return {feature, analysis, classification: "notImportant"};
		return {feature, analysis, classification: "important"};
	}

	static _isFeatureFullyInferredOnBlock (feature, plainText, {defenses, speed, skills, effectTypes} = {}) {
		const text = String(plainText || "");
		const name = String(feature?.name || "").toLowerCase();

		// Pure resistance grants already on resist[] (plain strings or cond objects)
		const resistMatch = text.match(/resistance to (\w+) damage/);
		const resistPlain = new Set(
			(defenses?.resist || [])
				.flatMap(r => (typeof r === "string" ? [r] : (r?.resist || [])))
				.map(s => String(s).toLowerCase()),
		);
		if (resistMatch && resistPlain.has(resistMatch[1].toLowerCase())) {
			const withoutResist = text
				.replace(/resistance to \w+ damage\.?/gi, "")
				.replace(/\b(?:also\s+)?naturally acclimate[^.]*\.?/gi, "")
				.replace(/\bthis includes elevations[^.]*\.?/gi, "")
				.trim();
			if (withoutResist.length < 40) return true;
		}

		// Swim/walk speed features already reflected
		if (
			(/swimming speed equal to .* walking speed|swim speed/.test(text) || /fast movement/.test(name))
			&& speed
			&& (Number(speed.swim) > 0 || Number(speed.walk) > 30)
			&& !/\bbonus action\b|\breaction\b|\bas an action\b/.test(text)
		) {
			// Still keep if there is a distinct combat rider (e.g. expend Rage to dash while swimming)
			if (!/\bexpend\b|\brage\b.*\bmove\b|\bdamage\b/.test(text)) return true;
			if (/fast movement/.test(name) && !/\bdamage\b|\battack\b/.test(text)) return true;
		}

		// Skill-only grants already on skill block
		if (effectTypes?.has("proficiency") || effectTypes?.has("expertise") || /proficiency bonus/.test(text)) {
			if (skills && Object.keys(skills).length && !/\baction\b|\breaction\b|\bdamage\b|\battack roll\b/.test(text)) {
				if (sourceIsSkillOnly(text)) return true;
			}
		}

		return false;

		function sourceIsSkillOnly (t) {
			return !/\bhit points\b|\bac\b|\bspeed\b|\brage\b|\bspell\b/.test(t)
				|| (/checks?/.test(t) && !/\bdamage\b|\battack\b/.test(t));
		}
	}

	/**
	 * A psionic power keeps its mechanics in `modes[]`, not in `description`: the
	 * description holds only the Manifestation Time / Range / Duration header. Reading
	 * `description` alone exported seven of Phirse's powers as headers with no effect at
	 * all, which is the worst failure mode a statblock has.
	 *
	 * The mode matching the power's own order supplies the body; an "Increased Order"
	 * mode is the upcast rule and is kept as one trailing sentence. The manifestation
	 * time is not repeated in the body — it decides which section the power is filed
	 * into, which is where a DM looks for it.
	 *
	 * @param {Object} feature sheet feature
	 * @returns {Object} the feature, or a psionic power rewritten with a real body
	 */
	/**
	 * @param {number} n
	 * @returns {string} "1st", "2nd", "3rd", "6th"
	 */
	static _toOrdinal (n) {
		const num = Number(n) || 0;
		const rem100 = num % 100;
		if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
		return `${num}${({1: "st", 2: "nd", 3: "rd"}[num % 10] || "th")}`;
	}

	/**
	 * A power's primary mode is the one matching its own order; "Increased Order" is the
	 * upcast rule, not the effect. Both `_expandPsionicPower` and the signature/roster
	 * classifier must agree on which mode is the body, or a power could be rostered on
	 * the strength of a paragraph that never prints.
	 *
	 * @param {Object} feature sheet feature
	 * @returns {{primary: Object|null, upcast: Object|null}}
	 */
	static _PSIONIC_STRAIN_BUDGET_DIVISOR = 3;

	static _PSIONIC_FREQUENT_THRESHOLD = 3;

	static _getPsionicModes (feature) {
		const modes = (feature?.modes || []).filter(mode => (mode?.entries || []).length);
		if (!modes.length) return {primary: null, upcast: null};
		const orderKey = String(feature.order || "").toLowerCase();
		const upcast = modes.find(mode => /increased order/i.test(String(mode?.name || ""))) || null;
		const primary = modes.find(mode => String(mode?.name || "").toLowerCase() === orderKey)
			|| modes.find(mode => !/increased order/i.test(String(mode?.name || "")))
			|| modes[0];
		return {primary, upcast};
	}

	/**
	 * Strain is the Talent's signature mechanic and the one thing a statblock must not
	 * ask a DM to track — which is why the book's own 27 psionic statblocks convert it
	 * into a flat `N/Day` and never mention strain at all.
	 *
	 * The conversion is exact rather than estimated. A 1st-order power needs no
	 * manifestation test and costs nothing. For order `n` you roll a `dD`: above `n`
	 * costs nothing, exactly `n` costs 1 strain, below `n` costs `n` strain. So
	 *
	 *     E[strain] = n·P(roll < n) + 1·P(roll = n)  =  (n·(n−1) + 1) / D   for n ≤ D
	 *
	 * The day's budget is *not* the strain maximum. Strain effects bite per track and
	 * hard — 5 strain in one track is a −5 penalty to AC or Disadvantage on saves — so a
	 * manifester who spends to their maximum is crippled long before they get there.
	 * One track's worth (`strainMaximum / 3`) is the budget a creature can actually
	 * spend and keep fighting, and it is the divisor that reproduces the book's numbers.
	 *
	 * @param {number} order the power's order
	 * @param {Object} calc feature calculations
	 * @returns {number|null} sustainable manifestations per day; `Infinity` when free,
	 *   `null` when the character's strain economy cannot be read
	 */
	static _getPsionicUsesPerDay (order, calc) {
		const n = Number(order) || 0;
		if (n <= 1) return Infinity;
		const die = Number(/d(\d+)/i.exec(String(calc?.manifestationDie || ""))?.[1]);
		const strainMax = Number(calc?.strainMaximum);
		// Fails closed: a fabricated use limit is worse than none at all.
		if (!Number.isFinite(die) || die <= 0) return null;
		if (!Number.isFinite(strainMax) || strainMax <= 0) return null;
		const pBelow = Math.min(n - 1, die) / die;
		const pEqual = n <= die ? 1 / die : 0;
		const expected = (n * pBelow) + pEqual;
		if (expected <= 0) return Infinity;
		return (strainMax / this._PSIONIC_STRAIN_BUDGET_DIVISOR) / expected;
	}

	/**
	 * The book's 27 statblocks use exactly three frequencies — at-will, 3/Day and 1/Day —
	 * and never anything else, so the model snaps to that vocabulary rather than printing
	 * a computed "8/Day" no published psion has ever had.
	 *
	 * Measured against all 181 roster entries in the book, this reproduces the authors'
	 * own choice 77% of the time, and every one of the 28 at-will powers exactly. The
	 * residual is not modellable: the same power at the same order is filed under 3/Day
	 * in one statblock and 1/Day in another (`read object` is 3/Day for the Pyrokinetic
	 * Expert and 1/Day for the Telepath Expert), so the split is roster-sizing taste, not
	 * a rule.
	 *
	 * @param {number} order
	 * @param {Object} calc
	 * @returns {string|null} "will", "3/Day", "1/Day", or null when unreadable
	 */
	static _getPsionicBand (order, calc) {
		if ((Number(order) || 0) <= 1) return "will";
		const uses = this._getPsionicUsesPerDay(order, calc);
		if (uses == null) return null;
		if (!Number.isFinite(uses)) return "will";
		return uses >= this._PSIONIC_FREQUENT_THRESHOLD ? "3/Day" : "1/Day";
	}

	/**
	 * @param {number} order
	 * @param {Object} calc
	 * @returns {string|null} the use figure for an entry name, or null when at-will
	 */
	static _getPsionicUsesLabel (order, calc) {
		const band = this._getPsionicBand(order, calc);
		return !band || band === "will" ? null : band;
	}

	/**
	 * The book gives a real entry only to powers that resolve in combat — an attack roll,
	 * a forced save, or damage — and rosters the rest. Applied to the Chronopath trio
	 * this reproduces the authors' split exactly: Psionic Bolt, Time Thief, Intuition,
	 * Again, Witness Demise and Ally of Time earn entries; illuminator, shared thoughts,
	 * read object and friends are roster lines.
	 *
	 * @param {Object} feature sheet feature
	 * @returns {boolean} true when the power deserves its own statblock entry
	 */
	static _isSignaturePsionicPower (feature) {
		if (feature?._entityType !== "psionicPower") return false;
		const {primary} = this._getPsionicModes(feature);
		if (!primary) return false;
		const text = (primary.entries || [])
			.map(it => typeof it === "string" ? it : (it?.items || []).filter(x => typeof x === "string").join(" "))
			.join(" ");
		if (/\{@damage\b|\{@dice\b/i.test(text)) return true;
		if (/\bsaving throw\b/i.test(text)) return true;
		if (/\battack roll\b|\bmake an attack\b|\branged power attack\b|\bmelee power attack\b/i.test(text)) return true;
		return false;
	}

	static _expandPsionicPower (feature, calc = {}) {
		if (/^psionic powers?$/i.test(String(feature?.name || ""))) {
			// Class rules, not an ability the creature spends a reaction on.
			return {...feature, _npcEconomy: "trait"};
		}
		if (feature?._entityType !== "psionicPower") return feature;
		const modes = (feature.modes || []).filter(mode => (mode?.entries || []).length);
		if (!modes.length) return feature;

		const orderKey = String(feature.order || "").toLowerCase();
		const primary = modes.find(mode => String(mode?.name || "").toLowerCase() === orderKey)
			|| modes.find(mode => !/increased order/i.test(String(mode?.name || "")))
			|| modes[0];
		const upcast = modes.find(mode => /increased order/i.test(String(mode?.name || "")));

		const paragraphs = [];
		const push = entries => (entries || []).forEach(it => {
			if (typeof it === "string") return void paragraphs.push(`<p>${it}</p>`);
			// The effect of a power is routinely a list ("If the target has immunity to
			// fire damage…"); dropping non-strings left the body ending on a colon.
			const items = (it?.items || []).filter(item => typeof item === "string");
			if (items.length) paragraphs.push(`<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>`);
		});
		push(primary?.entries);
		if (upcast && upcast !== primary) {
			const compressed = this._compressPsionicUpcast(upcast.entries, feature?._psionicOrder, calc?.maxPowerOrder);
			if (compressed == null) push(upcast.entries);
			else if (compressed) paragraphs.push(`<p>${compressed}</p>`);
		}

		const header = (feature.entries || [])
			.filter(it => typeof it === "string")
			.map(it => it.replace(/\{@b ([^}]*)\}/g, "$1").trim())
			.filter(it => !/^manifestation time\s*:/i.test(it))
			// Concentration is stated in the entry's name, so repeating it here spends a
			// line on a fact the DM has already read.
			.map(it => it.replace(/^duration\s*:\s*concentration,?\s*(?:up to\s*)?/i, "Duration: "))
			// "Duration: Instantaneous" is the absence of a duration.
			.filter(it => !/^duration\s*:?\s*(?:instantaneous|concentration)\.?$/i.test(it))
			// Only standalone measurements: "30-foot line" is the house style and stays.
			.map(it => it.replace(/(\d+) feet\b/g, "$1 ft."));
		if (header.length) paragraphs.push(`<p>${header.join(", ").replace(/:/g, "").replace(/\.$/, "")}.</p>`);

		if (!paragraphs.length) return feature;
		// "it can make a ranged power attack with the object" is a roll the DM is left to
		// look up. The bonus is on the sheet, so state it where the roll is called for.
		const attackBonus = Number(calc?.powerAttackBonus);
		const body = Number.isFinite(attackBonus)
			? paragraphs.map(it => it.replace(/\b(a (?:ranged|melee) power attack)\b(?!\s*\()/gi, `$1 ({@hit ${attackBonus}})`))
			: paragraphs;
		return {
			...feature,
			name: this._getPsionicEntryName(feature, primary, calc),
			description: body.join(""),
			_npcEconomy: this._getPsionicEconomy(feature),
		};
	}

	/**
	 * The book states a power's whole economy in its name — `Intuition (3/Day;
	 * 2nd-Order Power; Concentration)` — so a DM never has to look anywhere else for
	 * how often it can be used, how much it costs to push, or whether it competes with
	 * another effect. Every one of the 27 published psionic statblocks does this.
	 *
	 * Order is always stated; the use figure only when the power is not at-will, which
	 * matches `Psionic Bolt (1st-Order Power)`.
	 *
	 * @param {Object} feature sheet feature
	 * @param {Object|null} primary the mode supplying the body
	 * @param {Object} calc feature calculations
	 * @returns {string} the entry name
	 */
	/**
	 * "When Phirse manifests this power, it can increase its order by 1 or more. For each
	 * increase of 1, the damage increases by 2d10" is two paragraphs asking a DM to do
	 * arithmetic the sheet already knows the answer to. A manifester who knows powers up
	 * to 6th order has exactly four orders of headroom on a 2nd-order power, so the
	 * ceiling is a number we can state.
	 *
	 * Fails closed in both directions: no headroom drops the paragraph outright, and an
	 * upcast shape we cannot read keeps its original prose rather than guessing.
	 *
	 * @param {Array} upcastEntries the "Increased Order" mode's entries
	 * @param {number} order the power's own order
	 * @param {number} maxOrder the highest order the character can manifest
	 * @returns {string|null} the compressed sentence, `""` to drop, `null` to keep as-is
	 */
	static _compressPsionicUpcast (upcastEntries, order, maxOrder) {
		const own = Number(order) || 0;
		const max = Number(maxOrder) || 0;
		if (!own || !max) return null;
		const headroom = max - own;
		// Nothing to upcast into: the paragraph is pure noise for this creature.
		if (headroom <= 0) return "";

		const text = (upcastEntries || []).filter(it => typeof it === "string").join(" ");
		if (!text) return "";
		const clauses = [];

		const damage = /(?:each|every) increase of 1,[^.]*?damage increases by \{@damage (\d+)d(\d+)\}/i.exec(text);
		if (damage) clauses.push(`{@damage ${Number(damage[1]) * headroom}d${damage[2]}} more damage`);

		if (/increase of 1,[^.]*?targets? (?:one|1) additional/i.test(text)) {
			clauses.push(`up to ${headroom} more target${headroom === 1 ? "" : "s"}`);
		}

		const distance = /(?:each|every) increase of 1, the (radius|length|range)[^.]*?increases by (\d+) f(?:ee|oo)t/i.exec(text);
		if (distance) clauses.push(`+${Number(distance[2]) * headroom} ft. ${distance[1].toLowerCase()}`);

		if (!clauses.length) return null;
		return `{@b Increased Order.} At ${this._toOrdinal(max)} order: ${clauses.join(", ")}.`;
	}

	static _getPsionicEntryName (feature, primary, calc) {
		const name = String(feature?.name || "");
		// A name that already carries a parenthetical must not gain a nested one.
		if (!name || /\)\s*$/.test(name)) return name;
		const order = Number(feature?._psionicOrder) || 0;
		if (!order) return name;

		const parts = [];
		const uses = this._getPsionicUsesLabel(order, calc);
		if (uses) parts.push(uses);
		parts.push(`${this._toOrdinal(order)}-Order Power`);
		if (this._psionicPowerConcentrates(feature, primary)) parts.push("Concentration");

		// A bonus-action or reaction power is already filed under the matching section
		// heading, so marking it there would restate the heading. A power that takes
		// minutes has no section that says so, and needs the mark.
		const time = this._getPsionicManifestationTime(feature);
		const mark = this._isTurnEconomyTime(time) ? "" : this._getEconomyMark(time);
		return `${name}${mark} (${parts.join("; ")})`;
	}

	/**
	 * Concentration is a property of the mode manifested, not of the power, so the flag
	 * is read off the chosen mode first and only then off the power's Duration header.
	 *
	 * @param {Object} feature
	 * @param {Object|null} primary
	 * @returns {boolean}
	 */
	static _psionicPowerConcentrates (feature, primary) {
		if (primary?.concentration) return true;
		const duration = (feature?.entries || [])
			.filter(it => typeof it === "string")
			.find(it => /^\{@b\s*Duration:?\}?/i.test(it) || /duration/i.test(it)) || "";
		return /concentration/i.test(duration);
	}

	/**
	 * "Manifestation Time: 1 bonus action" is the power's cost, stated in a header rather
	 * than in prose, so the ordinary text scan never sees it.
	 * @param {Object} feature
	 * @returns {string|null} "action" | "bonus" | "reaction" | null
	 */
	/**
	 * @param {Object} feature psionic power feature
	 * @returns {string} the raw Manifestation Time header — "1 bonus action", "10 minutes"
	 */
	static _getPsionicManifestationTime (feature) {
		const line = (feature?.entries || [])
			.filter(it => typeof it === "string")
			.find(it => /^\{@b\s*Manifestation Time:?\s*\}/i.test(it)) || "";
		return line.replace(/^\{@b[^}]*\}\s*/i, "").trim();
	}

	/** @returns {boolean} true when the time is one a statblock section already states */
	static _isTurnEconomyTime (raw) {
		return /^(?:1\s+)?(?:action|bonus|reaction)\b/i.test(String(raw || "").trim());
	}

	static _getPsionicEconomy (feature) {
		const line = (feature?.entries || [])
			.filter(it => typeof it === "string")
			.find(it => /manifestation time/i.test(it)) || "";
		if (/\breaction\b/i.test(line)) return "reaction";
		if (/\bbonus action\b/i.test(line)) return "bonus";
		if (/\baction\b/i.test(line)) return "action";
		return null;
	}

	static _getFeatureActivationSection (feature, analysis = null) {
		// A psionic power states its cost in a header the prose scan cannot see.
		if (feature?._npcEconomy) return feature._npcEconomy;
		const textSection = this._getActivationSectionFromText(feature?.description || "");

		const info = analysis?.activationInfo;
		const activationAction = String(info?.activationAction || "").toLowerCase();
		const mapped = {bonus: "bonus", reaction: "reaction", action: "action", attack: "action"}[activationAction] || null;
		if (mapped && this._isSelfDerivedActivation(feature, info, textSection)) return mapped;
		return textSection;
	}

	/**
	 * The sheet's toggle detection routinely matches a feature to a *different* ability's
	 * active state (Unstoppable → Rage), and its custom analyzer guesses an action cost
	 * from weak signals. Neither means the feature itself costs that action, so only trust
	 * `activationAction` when it is corroborated by the feature's own name or prose.
	 */
	static _isSelfDerivedActivation (feature, info, textSection) {
		if (!info) return false;
		const featureKey = this._normalizeFeatureKey(feature?.name);
		const stateKey = this._normalizeFeatureKey(info.stateType?.name || info.stateTypeId || "");
		if (info.matchedBy === "pattern" && stateKey && featureKey && stateKey !== featureKey) return false;
		if (info.isCustom && !textSection) return false;
		return true;
	}

	/**
	 * The single activation classifier. Features and magic-item entries once used two
	 * separate implementations that drifted apart — items never learned the 2024
	 * "takes a Reaction" phrasing, which is why Retaliator's Answer the Blow filed
	 * itself as a trait. Keep this the only one.
	 */
	static _getActivationSectionFromText (text) {
		// Concessive and parenthetical clauses cite *other* abilities' action costs
		// ("…can still use a bonus action to enter a rage"), so drop them before matching.
		const cleaned = this._getPlainMatchText(text)
			.replace(/\([^()]*\)/g, " ")
			.replace(/\b(?:even if|can still|instead of|rather than)\b[^.;]*/gi, " ")
			// "…and it can move only by ending the effect as a bonus action" states how the
			// effect stops, not how it starts; matching it filed a reaction as a bonus action.
			.replace(/\b(?:by |to )?end(?:ing|s)? (?:the effect|it|this|them)\b[^.;]*/gi, " ");
		if (/\bas a bonus action\b|\b(?:uses?|takes?|spends?) (?:a|your|its) bonus action\b|^\s*bonus action\b/.test(cleaned)) return "bonus";
		if (/\bas a reaction\b|\b(?:uses?|takes?|spends?|expends?) (?:a|your|its) reaction\b|^\s*reaction\b/.test(cleaned)) return "reaction";
		// 2024 features spend a named action ("As a Magic action, you summon…"); the
		// 2014 corpus says "as an action". Both belong in the action section.
		if (/\bas an action\b|\b(?:uses?|takes?) (?:an|your|its) action\b|^\s*action\b|\b(?:as|takes?) an? (?:magic|attack|utilize|study|influence|search) action\b/.test(cleaned)) return "action";
		return null;
	}

	/**
	 * "Long Rest" on a name, "long rest" in a sentence — the name is an index entry and
	 * wants the same compact form the per-feature uses annotation uses.
	 */
	static _abbreviateRecharge (rest) {
		const t = String(rest || "").toLowerCase();
		if (t.includes("short") && t.includes("long")) return "SR or LR";
		if (t.includes("short")) return "SR";
		if (t.includes("long")) return "LR";
		if (t.includes("dawn")) return "Dawn";
		if (t.includes("day")) return "Day";
		return this._titleCaseRecharge(rest);
	}

	static _getFeatureUsesText (feature) {
		const uses = feature?.uses;
		if (!uses || !Number.isFinite(Number(uses.max)) || Number(uses.max) <= 0) return "";
		const max = Number(uses.max);
		const recharge = String(uses.recharge || "").toLowerCase();
		// Match the compact form the rest of the exporter uses; two spellings for one
		// concept makes a statblock look machine-assembled.
		if (recharge.includes("short") && recharge.includes("long")) return `(${max}/SR or LR)`;
		if (recharge.includes("short")) return `(${max}/SR)`;
		if (recharge.includes("long")) return `(${max}/LR)`;
		if (recharge.includes("day") || !recharge) return `(${max}/Day)`;
		return `(${max}; recharges on ${this._getSafeInlineText(uses.recharge, {maxLen: 24})})`;
	}

	static _getCustomAbilityBlocks (state, {npcName = "The NPC"} = {}) {
		const out = {trait: [], action: [], bonus: [], reaction: []};
		const abilities = state.getCustomAbilities?.() || [];
		if (!abilities.length) return out;

		const passiveEntries = [];
		abilities.forEach(ability => {
			const safeName = this._getSafeInlineText(ability?.name || "Custom Ability", {maxLen: 80}) || "Custom Ability";
			const description = this._prepareFeatureTextForNpc(ability?.description || "", {npcName});
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

	/** Flattened prose of every ability already on the block, for redundancy checks. */
	static _collectDescribedEffectTexts ({featureBlocks = {}, customAbilityBlocks = {}, itemUseBlocks = {}, extraBlocks = null} = {}) {
		const out = [];
		[featureBlocks, customAbilityBlocks, itemUseBlocks, extraBlocks].forEach(blocks => {
			["trait", "action", "bonus", "reaction"].forEach(section => {
				(blocks?.[section] || []).forEach(e => {
					const body = (e?.entries || []).filter(x => typeof x === "string").join(" ");
					if (body) out.push(`${e?.name || ""} ${body}`);
				});
			});
		});
		return out;
	}

	static _getNamedModifierTrait (state, {npcName = "The NPC", representedAbilityNames = new Set(), describedEffects = []} = {}) {
		const modifiers = state.getNamedModifiers?.() || [];
		if (!modifiers.length) return null;

		const defenses = this._getExportDefenses(state, {defenseMode: "persistent"});
		const speed = this._getSpeedObject(state);
		const skills = this._getSkillBlock(state);

		const residual = modifiers.filter(mod => this._isResidualNamedModifier(mod, {
			defenses,
			speed,
			skills,
			representedAbilityNames,
			bakedInKeys: this._getBakedInModifierKeys(modifiers),
		}));
		// bonusAction types are promoted to real bonus entries separately
		const leftover = residual.filter(mod => !/bonusAction|bonus action/i.test(String(mod.type || "")));
		if (!leftover.length) return null;

		const byName = new Map();
		leftover.forEach(mod => {
			const name = this._getSafeInlineText(mod?.name || "modifier", {maxLen: 80}) || "modifier";
			if (!byName.has(name)) byName.set(name, []);
			byName.get(name).push(mod);
		});

		const entries = [...byName.entries()]
			.slice(0, 12)
			.map(([name, mods]) => {
				const prose = this._formatResidualModifierProse(mods, {npcName, modName: name});
				if (!prose) return "";
				// A leftover bullet that merely restates an ability already on the block is noise.
				if (this._isEffectAlreadyDescribed(prose, describedEffects)) return "";
				return `• {@b ${name}.} ${prose}`;
			})
			.filter(Boolean);

		if (!entries.length) return null;
		return {
			name: "Additional Effects",
			entries,
		};
	}

	static _EFFECT_STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "on", "in", "is", "are", "has", "have", "with", "against", "all", "other", "its", "it", "this", "that", "for", "from", "by", "can", "when", "while", "at", "as", "be", "than", "any", "each"]);

	/** Content-word fingerprint so "Advantage on saving throws against magic" ≈ "…against all other spells and magical effects". */
	static _getEffectFingerprint (text) {
		return new Set(
			String(text || "")
				.replace(/\{@[^}]*\}/g, " ")
				.toLowerCase()
				.replace(/[^a-z\s]/g, " ")
				.split(/\s+/)
				// Crude stemming so "magical"/"magically" collapse onto "magic".
				.map(w => w.replace(/(?:ally|ly|al)$/, "").replace(/(?:es|s)$/, ""))
				.filter(w => w.length > 2 && !this._EFFECT_STOPWORDS.has(w)),
		);
	}

	static _isEffectAlreadyDescribed (prose, describedEffects = []) {
		const want = this._getEffectFingerprint(prose);
		if (want.size < 2) return false;
		return (describedEffects || []).some(text => {
			const have = this._getEffectFingerprint(text);
			if (!have.size) return false;
			let hits = 0;
			want.forEach(w => { if (have.has(w)) hits++; });
			return hits / want.size >= 0.8;
		});
	}

	/** Promote named-mod bonusAction stubs (e.g. Polearm Master) into real bonus entries when no feat covered them. */
	static _getPromotedBonusActionBlocks (state, {npcName = "The NPC", representedAbilityNames = new Set(), attacks = []} = {}) {
		const out = [];
		const seen = new Set();
		const mods = state.getNamedModifiers?.() || [];
		mods.forEach(mod => {
			if (!mod || mod.enabled === false) return;
			const type = String(mod.type || "");
			if (!/bonusAction|bonus action/i.test(type) && !/bonus action/i.test(mod.note || "")) return;
			const name = this._getSafeInlineText(mod.name || "Bonus Action", {maxLen: 80}) || "Bonus Action";
			const key = this._normalizeFeatureKey(name);
			if (key && representedAbilityNames.has(key)) return;
			if (key && seen.has(key)) return;
			if (key) seen.add(key);

			const damage = mod.damage || "1d4+mod";
			const note = this._getSafeInlineText(mod.note || "", {maxLen: 120});
			let body;
			if (/polearm|butt-end|butt end/i.test(`${name} ${note}`)) {
				// The butt-end swing is the *same weapon*, so it must inherit the sheet's own
				// to-hit and damage bonus — recomputing from ability mods produces a statblock
				// that contradicts itself (e.g. +12 on the haft, +15 on the butt).
				const source = this._getPolearmSourceAttack(attacks);
				const strMod = state.getAbilityMod?.("str") ?? 0;
				const dexMod = state.getAbilityMod?.("dex") ?? 0;
				const abilMod = Math.max(strMod, dexMod);
				const pb = state.getProficiencyBonus?.() ?? 2;
				const dmgBonus = source ? this._getDamageBonusFromExpression(source.damage) : null;
				const effectiveMod = dmgBonus == null ? abilMod : dmgBonus;
				const toHit = this._toSignedStr(source ? Number(source.attackBonus) || 0 : pb + abilMod);
				const dmg = String(damage).replace(/\+mod\b/i, this._toSignedStr(effectiveMod).replace(/^\+/, "+"));
				body = `After taking the Attack action with a polearm, ${npcName} can make one melee weapon attack with the opposite end as a bonus action: {@atk mw} {@hit ${toHit}} to hit, reach 5 ft., one target. {@h} {@damage ${dmg}} bludgeoning damage.`;
			} else {
				body = this._enrichNpcTags(
					this._normalizeAbilityTextForNpc(
						note || `${npcName} can take a special bonus action (${type}).`,
						{npcName, maxLen: 280},
					),
				);
			}
			out.push({name, entries: [body]});
		});
		return out.slice(0, 6);
	}

	/** The two-handed melee attack a polearm feat actually keys off, preferring reach weapons. */
	static _getPolearmSourceAttack (attacks = []) {
		const melee = (attacks || []).filter(a => a && !/unarmed/i.test(String(a.name || "")) && Number(a.attackBonus));
		if (!melee.length) return null;
		const polearm = melee.find(a => /glaive|halberd|pike|quarterstaff|spear|lance|bolg/i.test(String(a.name || "")));
		if (polearm) return polearm;
		return melee.reduce((best, a) => (Number(a.attackBonus) > Number(best.attackBonus) ? a : best), melee[0]);
	}

	/** Trailing flat bonus of a damage expression: "4d10+7" → 7, "1d8" → 0. */
	static _getDamageBonusFromExpression (expr) {
		const m = /([+-]\s*\d+)\s*$/.exec(String(expr || ""));
		if (!m) return /\d*d\d+/.test(String(expr || "")) ? 0 : null;
		return Number(m[1].replace(/\s+/g, ""));
	}

	static _formatResidualModifierProse (mods, {npcName = "The NPC", modName = ""} = {}) {
		const collapsed = this._collapseRedundantModifiers(mods || []);
		const clauses = collapsed
			.map(mod => this._formatResidualModifierClause(mod, {npcName, modName}))
			.filter(Boolean);
		const deduped = [...new Set(clauses)];
		if (!deduped.length) return "";
		const joined = deduped.join("; ");
		const capped = joined.charAt(0).toUpperCase() + joined.slice(1);
		return /[.!?]$/.test(capped) ? capped : `${capped}.`;
	}

	/**
	 * A single effect is often recorded twice — once generically (`damage`) and once with
	 * its real restriction (`damage:melee:oneHanded`). Keep only the most specific record.
	 */
	static _collapseRedundantModifiers (mods) {
		const byBucket = new Map();
		(mods || []).forEach(mod => {
			const type = String(mod?.type || "");
			const head = type.split(":")[0] || type;
			const bucket = `${head}|${this._getModifierValueSummary(mod)}`;
			const prev = byBucket.get(bucket);
			if (!prev) return void byBucket.set(bucket, mod);
			const prevDepth = String(prev.type || "").split(":").length;
			const curDepth = type.split(":").length;
			const prevHasCond = !!String(prev.conditional || "").trim();
			const curHasCond = !!String(mod.conditional || "").trim();
			if (curDepth > prevDepth || (curDepth === prevDepth && curHasCond && !prevHasCond)) byBucket.set(bucket, mod);
		});
		return [...byBucket.values()];
	}

	static _formatResidualModifierClause (mod, {npcName = "The NPC", modName = ""} = {}) {
		const desc = this._describeModifierType(String(mod?.type || "ac"));
		const grantsAdvantage = !!mod?.advantage || desc.advantage;
		const grantsDisadvantage = !!mod?.disadvantage || desc.disadvantage;

		let core;
		if (grantsAdvantage) core = `advantage on ${desc.label}`;
		else if (grantsDisadvantage) core = `disadvantage on ${desc.label}`;
		else {
			const value = this._getModifierValueSummary(mod);
			if (!value || value === "contextual") core = desc.label;
			else if (/^[+-]/.test(value)) core = `${value} to ${desc.label}`;
			else core = `${desc.label} ${value}`;
		}

		const qualifier = this._getResidualQualifierPhrase(mod, {npcName, modName, typeScope: desc.scope});
		return qualifier ? `${core} ${qualifier}` : core;
	}

	/**
	 * Prefer the modifier's own conditional, fall back to its note, and only then to the
	 * scope encoded in the registry key — the three overlap, so printing all of them
	 * repeats the same restriction two or three times.
	 */
	static _getResidualQualifierPhrase (mod, {npcName = "The NPC", modName = "", typeScope = ""} = {}) {
		const conditional = this._getSafeInlineText(mod?.conditional || "", {maxLen: 90});
		const note = this._cleanResidualNote(mod?.note, modName);
		let phrase = conditional || note;
		if (phrase && conditional && note) {
			const a = conditional.toLowerCase();
			const b = note.toLowerCase();
			phrase = a.includes(b) || b.includes(a) ? conditional : `${conditional} (${note})`;
		}
		if (!phrase) phrase = typeScope ? `against ${typeScope}` : "";
		if (!phrase) return "";

		phrase = this._normalizeAbilityTextForNpc(phrase, {npcName, maxLen: 110}).replace(/[.\s]+$/, "");
		if (!phrase) return "";
		// This is a mid-sentence fragment, so undo the normalizer's sentence-casing
		// unless the leading word is a proper noun (e.g. the NPC's own name).
		if (!phrase.startsWith(npcName)) phrase = phrase.replace(/^([A-Z])(?![A-Z])/, (m) => m.toLowerCase());
		if (/^(against|with|without|while|when|vs\.?|versus|on|in|for|from|under|within|during|unless|if|to)\b/i.test(phrase)) return phrase;
		if (/^\w+ing\b/i.test(phrase)) return `while ${phrase}`;
		return `when ${phrase}`;
	}

	/** Drop "From <ModName>" bookkeeping prefixes that just restate the bullet's own name. */
	static _cleanResidualNote (note, modName = "") {
		let text = this._getSafeInlineText(note || "", {maxLen: 120});
		if (!text) return "";
		text = text.replace(/\s*\((?:grants\s+)?(?:advantage|disadvantage)\)\s*$/i, "").trim();
		const escaped = String(modName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (escaped) text = text.replace(new RegExp(`^from\\s+${escaped}\\s*(?:[-–—:]\\s*)?`, "i"), "").trim();
		text = text.replace(/^from\s+[^-–—:]{1,60}[-–—:]\s*/i, "").trim();
		if (/^from\s+/i.test(text)) return "";
		// Stripping the "From <name>" lead can leave the provenance parenthetical behind
		// ("(combat method, reaction)"), which is sheet bookkeeping and re-parenthesises
		// into "((…))" downstream.
		const unwrapped = /^\((.*)\)$/.exec(text);
		if (unwrapped) text = unwrapped[1].trim();
		if (this._isProvenanceOnlyNote(text)) return "";
		return text;
	}

	/** A note that only names where the sheet stored the modifier, not what it does. */
	static _isProvenanceOnlyNote (text) {
		const parts = String(text || "").split(/\s*,\s*/).map(it => it.trim().toLowerCase()).filter(Boolean);
		if (!parts.length) return false;
		const provenance = /^(?:combat method|combat tradition|class feature|subclass feature|subclass|class|feat|feature|item|magic item|species|race|lineage|background|spell|specialty|action|bonus action|reaction|passive|free action|legendary action)$/;
		return parts.every(part => provenance.test(part));
	}

	/** Turn a registry key (`save:advantage:magic`, `damage:melee:oneHanded`) into readable parts. */
	static _describeModifierType (type) {
		const parts = String(type || "").split(":").map(it => it.trim()).filter(Boolean);
		if (!parts.length) return {label: "effects", scope: "", advantage: false, disadvantage: false};
		const head = parts[0];
		const rest = parts.slice(1);

		if (head === "skill") {
			return {label: `${this._toDisplayTitleCase(rest[0] || "")} checks`.trim(), scope: "", advantage: false, disadvantage: false};
		}

		let advantage = false;
		let disadvantage = false;
		const abilities = [];
		const scopes = [];
		rest.forEach(seg => {
			const low = seg.toLowerCase();
			if (low === "advantage") return void (advantage = true);
			if (low === "disadvantage") return void (disadvantage = true);
			if (CharacterSheetNpcExporter._ABILITY_CODES[low]) return void abilities.push(CharacterSheetNpcExporter._ABILITY_CODES[low]);
			if (low === "all" || low === "any") return;
			scopes.push(this._humanizeRegistryWord(low));
		});

		const abilityText = abilities.length ? `${abilities.join(" and ")} ` : "";
		let label;
		if (head === "save") label = `${abilityText}saving throws`;
		else if (head === "check") label = abilityText ? `${abilityText}checks` : "ability checks";
		else label = CharacterSheetNpcExporter._MOD_TYPE_LABELS[head] || this._humanizeRegistryWord(head);

		return {label, scope: scopes.join(" "), advantage, disadvantage};
	}

	static _humanizeRegistryWord (word) {
		const raw = String(word || "").trim();
		if (!raw) return "";
		const mapped = CharacterSheetNpcExporter._MOD_SCOPE_WORDS[raw.toLowerCase()];
		if (mapped != null) return mapped;
		return raw
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/[_-]+/g, " ")
			.toLowerCase()
			.trim();
	}

	/**
	 * The sheet registers a fighting style **twice**: once unconditionally — which is what
	 * gets summed into the printed AC or damage — and once as a gated twin carrying the
	 * prose condition. Wisp's Dueling is `damage +2` *and* `damage:melee:oneHanded +2`;
	 * Defense is `ac +1` *and* `ac +1 while wearing armor`.
	 *
	 * The conditional twin is therefore already inside the printed number. Restating it as
	 * an `Additional Effects` bullet invites the DM to add it a second time.
	 * `_getConditionalDamageRiders` has always applied this test to keep the +2 off the
	 * attack line; this is the same test, shared, so the bullet list learns it too.
	 *
	 * @param {Array<Object>} modifiers named modifiers from the sheet
	 * @returns {Set<string>} `sourceFeatureId|typeFamily|value` keys already folded into a number
	 */
	static _getBakedInModifierKeys (modifiers) {
		return new Set((modifiers || [])
			.filter(mod => mod?.enabled !== false && !mod?.conditional && mod?.sourceFeatureId)
			.map(mod => this._getBakedInModifierKey(mod))
			.filter(Boolean));
	}

	static _getBakedInModifierKey (mod) {
		const family = String(mod?.type || "").split(":")[0];
		const value = Number(mod?.value);
		if (!family || !Number.isFinite(value) || !mod?.sourceFeatureId) return "";
		return `${mod.sourceFeatureId}|${family}|${value}`;
	}

	/**
	 * A conditional AC modifier with **no** unconditional twin is a gate the sheet silently
	 * folded into the printed number. Elizabeth's AC 15 contains Dual Wielder's +1, so 15 is
	 * only true while she has two weapons out — drop one and it is 14. That gate is
	 * load-bearing and belongs on the number, exactly as rage resistances are annotated,
	 * rather than in a bullet the DM cannot connect to the AC.
	 *
	 * @param {Object} state character state
	 * @param {number} ac printed armour class
	 * @param {Array<string>} acFrom source labels for the printed AC
	 * @returns {Array<Object>} the `ac` array for the statblock
	 */
	static _getAcEntries (state, ac, acFrom) {
		const base = [{ac, from: acFrom}];
		const modifiers = state.getNamedModifiers?.() || [];
		if (!modifiers.length) return base;

		const bakedInKeys = this._getBakedInModifierKeys(modifiers);
		const featuresById = new Map((state._data?.features || []).map(f => [String(f?.id || ""), f]));

		const gates = modifiers.filter(mod => mod?.enabled !== false
			&& mod?.conditional
			&& /^ac(?:$|:)/.test(String(mod.type || ""))
			&& Number.isFinite(Number(mod.value))
			&& Number(mod.value) > 0
			&& !bakedInKeys.has(this._getBakedInModifierKey(mod)));
		if (!gates.length) return base;

		const total = gates.reduce((acc, mod) => acc + Number(mod.value), 0);
		const ungated = ac - total;
		if (!(ungated > 0) || ungated >= ac) return base;

		const conditions = [...new Set(gates.map(mod => {
			const clause = this._negateGateCondition(mod.conditional);
			const feature = featuresById.get(String(mod.sourceFeatureId || ""));
			const label = this._getFeatureHoverTag(feature) || this._getSafeInlineText(mod.name || "", {maxLen: 60});
			return label ? `${clause} (${label})` : clause;
		}).filter(Boolean))];
		if (!conditions.length) return base;

		return [...base, {ac: ungated, condition: conditions.join(" or ")}];
	}

	/** "while dual wielding two melee weapons" → "when not dual wielding two melee weapons". */
	static _negateGateCondition (raw) {
		const text = String(raw || "").trim()
			.replace(/^(?:when|while|if)\s+/i, "")
			.replace(/\byou are\b/gi, "it is")
			.replace(/\byour\b/gi, "its")
			.replace(/\byou\b/gi, "it")
			.replace(/\s+/g, " ")
			.replace(/[.,;]+$/, "");
		if (!text) return "otherwise";
		return `when not ${text}`;
	}

	static _PRINTED_NUMBER_FAMILIES = new Set(["ac", "attack", "damage", "spellDc", "spellAttack"]);

	static _isResidualNamedModifier (mod, {defenses = null, speed = null, skills = null, representedAbilityNames = new Set(), bakedInKeys = null} = {}) {
		if (!mod || mod.enabled === false) return false;
		const type = String(mod.type || "");
		const nameKey = this._normalizeFeatureKey(mod.name);

		// Already exported as a real ability / feat / item line
		if (nameKey && representedAbilityNames.has(nameKey)) return false;

		// Already folded into defenses (permanent or conditional annotations)
		if (type.startsWith("conditionImmunity:")) return false;
		if (type.startsWith("damageResistance:") || type.startsWith("resist:")) return false;
		if (type.startsWith("damageImmunity:") || type.startsWith("immune:")) return false;
		if (type.startsWith("damageVulnerability:") || type.startsWith("vulnerable:")) return false;

		// Speed already on block
		if (type.startsWith("speed:") || type === "speed") {
			if (speed && (Number(speed.walk) || Number(speed.swim) || Number(speed.fly) || Number(speed.climb))) return false;
		}

		// Flat HP already in average HP
		if (type === "hp" || type === "hit points") return false;

		// Skill/check PB already reflected in skill block when present
		if (type.startsWith("skill:") || type.endsWith(" checks") || /checks$/i.test(this._getModifierTargetLabel(type))) {
			const skillKey = type.startsWith("skill:") ? type.slice(6) : null;
			if (skillKey && this._hasSkillEntry(skills, skillKey)) return false;
			const label = this._getModifierTargetLabel(type);
			const m = /^(.*?)\s+checks$/i.exec(label);
			if (m && this._hasSkillEntry(skills, m[1])) return false;
		}

		// Ability-score swaps and pure initiative advantage are sheet chrome for PCs
		if (type.startsWith("abilitySwap:")) return false;
		if (type === "initiative" && (mod.advantage || mod.disadvantage) && !mod.conditional) return false;

		// Keep conditional combat riders and true custom AC/attack/damage notes
		if (mod.conditional) {
			// …unless an unconditional sibling from the same feature already put this exact
			// bonus inside the printed number (see _getBakedInModifierKeys).
			if (bakedInKeys?.has(this._getBakedInModifierKey(mod))) return false;
			return true;
		}

		// A flat, ungated bonus to a number the block already prints — AC, attack, damage,
		// spell save DC, spell attack — is *inside* that number by construction. Wisp's
		// Defense +1 is part of AC 22; printing it again invites the DM to add it twice.
		// Only a note carrying its own gate survives, because that gate is not in the number.
		const family = type.split(":")[0];
		if (this._PRINTED_NUMBER_FAMILIES.has(family) && Number.isFinite(Number(mod.value))) {
			return !!(mod.note && /while|when|if |until /i.test(mod.note));
		}

		if (["ac", "attack", "damage", "spellDc", "spellAttack", "d20"].includes(type)) return true;
		if (type.startsWith("save:")) return true;
		if (mod.note && /while|when|if |until /i.test(mod.note)) return true;

		// Bonus-action weapon riders promoted separately — still residual if promotion skipped
		if (/bonusAction|bonus action/i.test(type) || /bonus action/i.test(mod.note || "")) return true;

		// Default: drop sheet bookkeeping
		void defenses;
		return false;
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

	/**
	 * The statblock title already carries the full name, and each entry is normalized on
	 * its own, so a full name reaches the reader once per entry — "Phirse Jeet" 49 times
	 * across one block, which reads unlike any published statblock. Refer to the NPC by
	 * its given name in body text; an honorific or article is not a given name, so a
	 * leading one is carried along with the word it qualifies.
	 */
	static _NAME_LEAD_WORDS = new Set([
		"the", "sir", "lady", "lord", "dame", "master", "mistress", "captain",
		"commander", "doctor", "dr", "dr.", "mr", "mr.", "ms", "ms.", "mrs",
		"mrs.", "saint", "st", "st.", "king", "queen", "prince", "princess",
	]);

	static _getNpcReferenceName (name) {
		const safeName = this._getSafeInlineText(name || "", {maxLen: 80});
		if (!safeName) return "The NPC";
		// A tagged or punctuated name is not a plain given-name/surname pair; leave it be.
		if (/[{}(),|]/.test(safeName)) return safeName;
		const words = safeName.split(/\s+/).filter(Boolean);
		if (words.length < 2) return safeName;
		const take = this._NAME_LEAD_WORDS.has(words[0].toLowerCase()) ? 2 : 1;
		if (words.length <= take) return safeName;
		const short = words.slice(0, take).join(" ");
		// A one-or-two-letter fragment is an initial, not a name a reader can follow.
		return /^[\w'’-]{3,}$/u.test(words[take - 1]) ? short : safeName;
	}

	static _stashTags (text) {
		const tagStore = [];
		// Unique prefix so nested stash/restore passes cannot clobber each other.
		const prefix = `§§T${CharacterSheetNpcExporter._tagStashSeq = (CharacterSheetNpcExporter._tagStashSeq || 0) + 1}G`;
		const stashed = String(text || "").replace(/\{@[^{}]+\}/g, (m) => {
			const idx = tagStore.length;
			tagStore.push(m);
			return `${prefix}${idx}§§`;
		});
		return {stashed, tagStore, prefix};
	}

	static _restoreTags (text, tagStore = [], prefix = null) {
		const restored = prefix
			? String(text || "").replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)§§`, "g"), (_, n) => tagStore[Number(n)] || "")
			// Fallback: restore any stash marker shape
			: String(text || "").replace(/§§T\d+G(\d+)§§/g, (_, n) => tagStore[Number(n)] || "");
		// A cut that lands inside a marker leaves halves no restore rule can match, and
		// they read as line noise in the statblock. Drop any remnant rather than print it.
		// Strip only an *orphan* half-marker — one with no closing delimiter, which a cut
		// through the middle of a marker leaves behind. A complete marker belonging to an
		// outer, still-stashed pass must survive untouched, and the subject placeholders
		// (`§§SUBJ§§`) share the delimiter and are live at some call sites.
		return restored.replace(/§§T\d+G\d*(?!\d*§§)/g, "");
	}

	static _normalizeAbilityTextForNpc (text, {npcName = "The NPC", maxLen = 420} = {}) {
		let s = String(text || "");
		if (!s) return "";

		// Protect existing {@tags} from internal rewrite/sanitize damage
		const stash = this._stashTags(s);
		s = stash.stashed;

		s = s
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		// Strip player progression / prerequisite fluff
		s = s
			// Trailing scaling qualifiers ("…twice before a rest starting at level 13") are
			// stale for an export pinned to one level — the printed uses are authoritative.
			.replace(/,?\s*(?:and|or)?\s*(?:starting|beginning)\s+at (?:level \d+|\d+(?:st|nd|rd|th) level)\b/gi, "")
			.replace(/\b(?:Also,?\s+)?(?:Starting|Beginning)\s+at (?:level \d+|\d+(?:st|nd|rd|th) level),?\s*/gi, "")
			// A scaling chain ("increases to +2 at 11th level and to +3 at 18th level") needs
			// its level qualifiers to survive this pass; `_collapseScalingBonusSentences`
			// resolves it later, where the character's level is known.
			.replace(/\b(?:Also,?\s+)?[Aa]t (?:level \d+|\d+(?:st|nd|rd|th) level),?\s*/gi, (m, offset, str) => (/\b(?:to|by) \+?\d{1,2},?\s*$/.test(str.slice(0, offset)) ? m : ""))
			// Acquisition history — when and how the character picked its options — is
			// player-facing bookkeeping. A statblock states what the creature has.
			.replace(/(?:^|(?<=[.;]))\s*[^.;]*\b(?:you|it)\s+learns?\s+(?:one|an|a)\s+additional\b[^.;]*[.;]/gi, " ")
			.replace(/(?:^|(?<=[.;]))\s*[^.;]*\bEach time\b[^.;]*\breplace it with\b[^.;]*[.;]/gi, " ")
			.replace(/,?\s*detailed in the\s*"?\s*[^".;]{2,40}\s*"?\s*section at the end of the class description/gi, "")
			.replace(/\bWhen you (?:choose|gain) this (?:path|feature|subclass)[^.]*\.\s*/gi, "")
			// "When you reach 9th level, you gain …" / "When you reach 3rd level, this
			// ability grows:" — the level has already been reached, so only the benefit is
			// news. Runs before the pronoun rewrite, hence second person here.
			.replace(/\bWhen you reach(?:es)? (?:level \d+|\d+(?:st|nd|rd|th) level),\s*(?:this (?:ability|feature) (?:grows|improves)[^:.]*[:.]\s*)?/gi, "")
			// A prerequisite may be its own unterminated paragraph ("Prerequisite: 6th
			// level"), so the sentence terminator has to be optional.
			.replace(/\bPrerequisite:\s*[^.\n]*(?:\.|$)\s*/gim, "")
			.replace(/\bthe number of times shown for your \w+ level in the \w+ column\b[^.]*\.?/gi, "")
			.replace(/\bshown for your \w+ level\b[^.]*\.?/gi, "")
			.replace(/\bin the Rages column\b[^.]*\.?/gi, "")
			// Book cross-references ("Rules Tip: Forced Movement p166") are player-facing noise.
			.replace(/\s*(?:Rules?\s+Tip|See(?:\s+also)?)\s*:?[^.]*?\bp\.?\s*\d+\.?/gi, "")
			// Use-count scaling sentences are redundant once the name carries "(N/LR)",
			// and become self-contradictory after the level qualifiers are stripped.
			.replace(/(?:^|(?<=[.;]))\s*[^.;]*\bcan use (?:this feature|this|it)\b[^.;]*\b(?:once|twice|three times|four times|five times|\d+ times)\b[^.;]*[.;]/gi, " ")
			// Repair punctuation orphaned by the strips above.
			.replace(/([.;:])\s*[,;]\s*/g, "$1 ")
			.replace(/\s+([,.;:])/g, "$1")
			.replace(/^\s*[,;]\s*/, "")
			// Run last: earlier clause-strips can leave a dangling "Starting"/"Beginning".
			.replace(/^\s*(?:Also,?\s+)?(?:Starting|Beginning)[,\s]+(?=[A-Za-z])/, "")
			.trim();

		const possessive = /s$/i.test(npcName) ? `${npcName}'` : `${npcName}'s`;
		const SUBJ = "§§SUBJ§§";
		const POSS = "§§POSS§§";
		const REFL = "§§REFL§§";

		// Rewrite second person to neutral tokens first, so pronoun choice and verb
		// agreement are each decided once, after every substitution has landed.
		s = s
			.replace(/\byou['’]re\b/gi, `${SUBJ} is`)
			.replace(/\byou['’]ve\b/gi, `${SUBJ} has`)
			.replace(/\byou['’]ll\b/gi, `${SUBJ} will`)
			.replace(/\byou['’]d\b/gi, `${SUBJ} would`)
			.replace(/\byourself\b/gi, REFL)
			// "yours" is the independent possessive: "larger than yours" needs "than its own",
			// not the dangling "than its".
			.replace(/\byours\b/gi, /['’]s$/.test(POSS) ? POSS : `${POSS} own`)
			.replace(/\byour\b/gi, POSS)
			.replace(/\byou\b/gi, SUBJ);

		// User-authored prose (custom abilities, homebrew feature text) is routinely written
		// about the character in the third person — "he can use DEX for his unarmed
		// strikes". A statblock has no gender, and the same normalization the second person
		// gets must apply here or the block reads as someone else's character sheet.
		// Only leading, subject-position pronouns are rewritten: a rider about a *target*
		// ("the creature drops what she is holding") is rare in this corpus and would be
		// wrong to reassign, so the pronoun must not be preceded by a foreign subject noun.
		s = s
			.replace(/\b(?:he|she)['’]s\b/gi, `${SUBJ} is`)
			.replace(/\bhimself\b|\bherself\b/gi, REFL)
			.replace(/\bhers\b/gi, POSS)
			.replace(/(^|[.;:!?]\s+|,\s+|\s\b(?:and|but|or|then|while|when|if|so|because|as)\s+)(he|she)\b/gi, (m, lead) => `${lead}${SUBJ}`)
			.replace(/\b(?:his|her)\b(?=\s+[a-z])/gi, POSS)
			.replace(/\b(?:against|to|from|by|for|with|at|on|upon|toward|towards|beside|near|around)\s+(?:him|her)\b/gi, m => m.replace(/(?:him|her)$/i, SUBJ));

		s = this._conjugateAfterSubject(s, SUBJ);
		s = this._supplyImperativeSubject(s, SUBJ, POSS);

		// Name on first mention, pronouns thereafter — repeating the name in every clause
		// reads nothing like a bestiary entry.
		let isFirstMention = true;
		s = s.replace(new RegExp(`${SUBJ}|${POSS}|${REFL}`, "g"), (match) => {
			if (match === REFL) return "itself";
			const isPossessive = match === POSS;
			if (isFirstMention) {
				isFirstMention = false;
				return isPossessive ? possessive : npcName;
			}
			return isPossessive ? "its" : "it";
		});

		// Spacing / punctuation cleanup
		s = s
			.replace(/\s*\[\s*[–—-]\s*\]\s*/g, ". ")
			.replace(/\s+([.,;:!?])/g, "$1")
			.replace(/([.!?])[\s.]*\1+/g, "$1")
			.replace(/([.,;:!?])(?=\S)/g, "$1 ")
			// An emptied parenthetical ("(at 5th level)" with its contents stripped) leaves a
			// bare or dangling bracket that renders as broken punctuation.
			.replace(/\(\s*\)/g, "")
			.replace(/\(\s*(?=[.,;:!?])/g, "")
			.replace(/\(\s*\(/g, "(")
			.replace(/\)\s*\)/g, ")")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/\s*\($/, "")
			.replace(/^[,;:]\s*/, "")
			// A parenthetical is not a sentence start: "(its choice)" mid-sentence must not
			// be capitalized. Only a paren that opens the string or follows a full stop is.
			.replace(/(^|[.!?]\s+|["“]\s*|:\s+)(\(\s*)?(it|its)\b/g, (m, lead, paren, word) => `${lead}${paren || ""}${word[0].toUpperCase()}${word.slice(1)}`)
			// Verb agreement after the singular subject. The source text is written for a
			// plural "you", so any verb the pronoun rewrite left bare reads as a typo.
			.replace(/\b(it) (make|take|gain|deal|have|do|use|cause|regain|move|choose|know|die|fall|roll|spend|drop|become|reduce|add)\b(?!\s+(?:a |an |the )?\w+ (?:action|damage)\b)/g, (m, subj, verb) => `${subj} ${verb === "have" ? "has" : verb === "do" ? "does" : `${verb}s`}`)
			.replace(/\b(unconscious\}? or) die\b/g, "$1 dies")
			// The same shape reaches past "unconscious": any "it is <state> or die" is a
			// coordinated predicate that needs the singular verb.
			.replace(/\b(it is [^.,;]{0,60}? or) die\b/g, "$1 dies")
			// A coordinated list sharing an earlier singular subject ("until it uses Wild
			// Shape again, have the incapacitated condition, or die") loses agreement on
			// every verb but the first. Scoped to an `until/while/unless it <verb>s` clause.
			// A modal earlier in the clause ("it can spend a die, roll the die, and deal…")
			// governs everything after it, and there the bare form is the correct one.
			.replace(/\b(?:until|while|unless|when|after|before) it \w+s\b[^.;]*/g, clause => clause
				.replace(/(,\s+(?:or\s+)?)(have|die|fall|drop|gain|take|use|regain|become|end|lose|reach|leave|move|roll|spend)\b/g,
					(m, lead, verb, offset) => (/\b(?:can|can't|can’t|cannot|could|may|might|must|shall|should|will|would)\b/i.test(clause.slice(0, offset))
						? m
						: `${lead}${verb === "have" ? "has" : `${verb}s`}`)))
			// The sheet's own guidance voice ("might cause your character to…") has no place
			// in a statblock; the creature *is* the character.
			.replace(/\bits character\b/g, "it")
			.replace(/^([a-z])/, (m) => m.toUpperCase());

		// Sentence-boundary length limit (on plain text; tags restored after)
		if (s.length > maxLen) {
			const slice = s.slice(0, maxLen);
			const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
			if (lastStop >= Math.floor(maxLen * 0.45)) {
				s = slice.slice(0, lastStop + 1).trim();
			} else {
				// No sentence ends in range — a colon-introduced list is the usual cause.
				// Cutting at the character limit splits whatever sits there, including a
				// stash marker, whose halves then survive `_restoreTags` as visible noise.
				// Fall back to the last complete list item or word and close the sentence:
				// a statblock line that trails off in an ellipsis cannot be read aloud.
				let cut = slice.replace(/§§T\d+G\d*$/, "").replace(/§+$/, "");
				// Back up to the last word boundary only — losing more than the word the
				// cut landed in changes what downstream passes see.
				const boundary = cut.lastIndexOf(" ");
				if (boundary > Math.floor(maxLen * 0.5)) cut = cut.slice(0, boundary);
				s = `${cut.trim().replace(/[,;:\s]+$/, "")}.`;
			}
			// Cutting mid-parenthetical leaves the rest of the entry inside a paren that
			// never closes, which reads as a broken statblock.
			const unclosed = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
			if (unclosed > 0) s += ")".repeat(unclosed);
		}

		s = this._restoreTags(s, stash.tagStore, stash.prefix);
		return this._getSafeInlineTextKeepTags(s, {maxLen: maxLen + 80});
	}

	static _THIRD_PERSON_IRREGULARS = {
		"have": "has",
		"do": "does",
		"be": "is",
		"go": "goes",
		"are": "is",
		"were": "was",
		"aren't": "isn't",
		"aren’t": "isn't",
		"weren't": "wasn't",
		"weren’t": "wasn't",
		"don't": "doesn't",
		"don’t": "doesn't",
		"haven't": "hasn't",
		"haven’t": "hasn't",
	};

	// Words that must never be conjugated when they follow the subject token:
	// modals, auxiliaries, conjunctions and prepositions.
	static _SUBJECT_FOLLOWERS_KEEP = new Set([
		"can", "can't", "can’t", "cannot", "could", "couldn't", "may", "might", "must",
		"needn't", "needn’t", "mustn't", "mustn’t", "mightn't", "mightn’t", "oughtn't", "oughtn’t",
		"shall", "should", "shouldn't", "will", "won't", "would", "wouldn't",
		"is", "isn't", "was", "wasn't",
		"has", "hasn't", "had", "does", "doesn't", "did", "didn't",
		"and", "or", "but", "nor", "if", "when", "while", "as", "at", "in", "on",
		"of", "to", "for", "with", "from", "by", "than", "then", "that", "who",
		"which", "whose", "no", "not", "only", "either", "neither", "both",
		// Determiners, quantifiers and prepositions that can follow a subject token
		// in object position and must never be treated as verbs.
		"the", "a", "an", "its", "their", "this", "these", "those", "such",
		"beyond", "since", "until", "unless", "during", "against", "about",
		"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
		// Prepositions and adverbs that read as verbs to a naive conjugator: "it can
		// hear it within 30 feet" became "withins", "doesn't kill it outright" became
		// "outrights".
		"within", "without", "throughout", "toward", "towards", "onto", "into", "upon",
		"beneath", "below", "above", "across", "along", "around", "behind", "beside",
		"between", "near", "over", "under", "off", "out", "up", "down",
		"outright", "otherwise", "instead", "together", "apart", "aside", "ahead",
		"forward", "away", "back", "upward", "downward", "inward", "outward",
		"thereafter", "meanwhile", "anew", "alike", "alone", "again", "once", "twice",
	]);

	// Irregular past tenses. The `-ed` guard catches regular past tense, but a source
	// sentence can legitimately be in the past ("if it chose to make a melee attack",
	// "regains any hit points it lost"), and inflecting those produces "choses"/"losts".
	// Base forms that double as past tense (hit, cast, cost, set, put, let, cut, shut,
	// read, spread) are deliberately absent: they must still conjugate.
	static _PAST_TENSE_KEEP = new Set([
		"chose", "lost", "made", "took", "gave", "held", "saw", "went", "came", "knew",
		"found", "left", "felt", "kept", "said", "told", "spent", "sent", "built",
		"meant", "drew", "threw", "fell", "rose", "broke", "spoke", "wrote", "drove",
		"struck", "stood", "sat", "won", "began", "brought", "bought", "caught",
		"taught", "thought", "sought", "fought", "heard", "led", "met", "paid", "ran",
		"sang", "sank", "shook", "shot", "slept", "spun", "sprang", "stole", "swore",
		"swam", "swung", "tore", "wore", "woke", "wound", "flew", "grew", "hung",
	]);

	// A bare subject token governs the following verb unless it sits in object
	// position — i.e. directly after a preposition or a transitive verb
	// ("makes you unstoppable", "attack rolls against you").
	static _SUBJECT_OBJECT_MARKERS = new Set([
		"against", "from", "to", "with", "for", "on", "in", "at", "by", "near",
		"toward", "towards", "within", "around", "of", "into", "onto", "upon",
		"beside", "behind", "between", "beyond", "past", "through", "over", "under",
		"makes", "make", "made", "allows", "allow", "gives", "give", "grants",
		"grant", "forces", "force", "lets", "let", "considers", "consider",
		"targets", "target", "helps", "help", "sees", "see", "causes", "cause",
		"affects", "affect", "hits", "hit", "attacks", "attack", "moves", "surrounds",
	]);

	// Adverbs that can sit between the subject and its verb without breaking agreement.
	static _SUBJECT_ADVERBS = [
		"now", "also", "then", "still", "immediately", "instead", "already", "never",
		"always", "again", "further", "automatically", "magically", "otherwise",
		"successfully", "normally", "currently", "simply", "later", "first",
		"either", "neither", "both", "only", "typically", "usually",
	];

	static _conjugateAfterSubject (text, subjectToken) {
		// Any `-ly` word is an adverb here, so the verb to conjugate may sit several
		// words after the subject ("Duralin narrowly avoids an attack").
		const adverbs = this._getAdverbAlternation();
		const re = new RegExp(`(^|[^\\s]*)(\\s*)${subjectToken}((?:\\s+(?:${adverbs}))*)\\s+([a-z][a-z'’]*(?:-[a-z'’]+)*)`, "g");
		let out = String(text || "").replace(re, (match, before, gap, adverbRun, word, offset, whole) => {
			const head = `${before}${gap}${subjectToken}${adverbRun} `;
			if (this._isSubjectInObjectPosition(before, whole, offset)) return `${head}${word}`;
			return `${head}${this._conjugateThirdPerson(word)}`;
		});
		out = this._conjugateImpliedSubjects(out);
		return out;
	}

	// A plural word like "attacks" is both a verb and a noun. As a verb it takes the
	// subject as its object ("the spell attacks Onger"); at the head of a clause it is
	// a noun and the subject belongs to a reduced relative ("attacks Onger makes").
	static _AMBIGUOUS_NOUN_MARKERS = new Set(["attacks", "hits", "targets", "moves", "saves", "checks", "rolls"]);

	static _isSubjectInObjectPosition (precedingWord, whole = "", offset = 0) {
		const prev = String(precedingWord || "").trim();
		if (!prev) return false;
		if (/[.,;:!?(]$/.test(prev)) return false;
		const bare = prev.replace(/[^a-z'’]/gi, "").toLowerCase();
		if (!this._SUBJECT_OBJECT_MARKERS.has(bare)) return false;
		if (this._AMBIGUOUS_NOUN_MARKERS.has(bare)) {
			const lead = String(whole || "").slice(0, offset).trimEnd();
			// Clause-initial → the marker is the noun, not a verb governing the subject.
			if (!lead || /[.,;:!?(]$/.test(lead)) return false;
		}
		return true;
	}

	/**
	 * Coordinated clauses drop their subject ("…while your rage is active and don't
	 * die outright"), so the verb never sits next to the subject token. The creature
	 * is always singular here, so conjugate those — unless the clause is governed by
	 * a modal ("can reroll … and use"), where the bare form is correct, or the
	 * nearest preceding noun is plural.
	 */
	// "…saving throws it makes to avoid or end the condition" — the bare form is
	// correct inside an infinitive.
	static _INFINITIVE_CLAUSE = /\bto\s+[a-z]+\s*$/i;

	// Words that mark the next token as a noun ("an attack", "its turn"), so a
	// verb/noun homograph in the lead-in must not be mistaken for a bare verb.
	static _NOUN_MARKERS = new Set([
		"a", "an", "the", "this", "that", "these", "those", "one", "each", "any",
		"no", "some", "every", "another", "its", "their", "his", "her", "your",
		"my", "our", "of", "with", "without",
	]);

	/**
	 * Words that are nouns far more often than verbs when they follow a coordinator
	 * in rules text ("Strength checks and attack rolls", "size or shape"). Everything
	 * else is treated as a verb, so an unfamiliar verb is conjugated rather than left
	 * in second person — the failure mode of the old verb whitelist.
	 */
	static _NOUN_HOMOGRAPHS = new Set([
		"attack", "attacks", "action", "actions", "damage", "shape", "size", "turn",
		"turns", "save", "saves", "check", "checks", "range", "speed", "level",
		"levels", "form", "forms", "type", "types", "hit", "hits", "advantage",
		"disadvantage", "spell", "spells", "weapon", "weapons", "condition",
		"conditions", "effect", "effects", "target", "targets", "ally", "allies",
		"enemy", "enemies", "creature", "creatures", "round", "rounds", "minute",
		"minutes", "hour", "hours", "die", "dice", "bonus", "point", "points",
		"reaction", "reactions", "movement", "state", "states", "half", "double",
	]);

	static _MODAL_WORDS = new Set([
		"can", "can't", "cannot", "could", "couldn't", "may", "might", "must",
		"shall", "should", "shouldn't", "will", "won't", "would", "wouldn't",
		"do", "does", "doesn't", "don't", "did", "didn't",
	]);

	// Subjects that can govern a finite verb in this text. `§§SUBJ§§` is the
	// placeholder the second-person rewrite leaves behind.
	static _CLAUSE_SUBJECT_RE = /(?:§§SUBJ§§|\bit|\bhe|\bshe|\bwhich|\bwho|\bthat|\bcreature|\btarget)\s+((?:(?:also|then|still|immediately|instead|already|never|always|again|either|neither|both|only|[a-z]+ly)\s+)*)([a-z][a-z'’]*)/gi;

	/**
	 * A coordinated verb ("…and become aware") shares its subject with the finite
	 * verb governing the clause, so it must share that verb's agreement. Reporting
	 * whether the governor is finite (third-person singular) or bare is a purely
	 * structural test — no verb vocabulary is needed, and every gap in the old
	 * whitelist silently left a second-person verb in the output.
	 * @returns {"finite"|"bare"|null} null when no governing subject is present.
	 */
	static _getClauseGovernor (lead) {
		const re = new RegExp(this._CLAUSE_SUBJECT_RE.source, "gi");
		let last = null;
		let m;
		// An adverb only counts as the governing verb's modifier when a verb follows it.
		// "…manifest it again, or have…" ends a clause on the adverb, and reading "again"
		// as the governor makes an ordinary finite clause look bare.
		const ADJUNCT = /^(?:also|then|still|immediately|instead|already|never|always|again|either|neither|both|only|so|not|[a-z]+ly)$/;
		while ((m = re.exec(lead)) !== null) {
			if (ADJUNCT.test(m[2].toLowerCase())) continue;
			last = m;
		}
		if (!last) return null;

		const verb = last[2].toLowerCase().replace(/’/g, "'");
		// "it does so" is a pro-verb standing in for a finite clause, not a modal.
		if (verb === "does" && /^\s*so\b/.test(lead.slice(last.index + last[0].length))) return "finite";
		if (this._MODAL_WORDS.has(verb)) return "bare";
		// A modal appearing after the governor takes over the rest of the clause.
		const tail = lead.slice(last.index + last[0].length);
		if (/\b(?:can|can't|can’t|cannot|could|may|might|must|shall|should|will|won't|won’t|would)\b/i.test(tail)) return "bare";
		if (this._INFINITIVE_CLAUSE.test(lead)) return "bare";
		if (/^(?:is|was|has)$/.test(verb)) return "finite";
		// Third-person singular inflection: "-s" but not "-ss" (possess, across).
		return /[^s]s$/.test(verb) ? "finite" : "bare";
	}

	/**
	 * Coordinated verbs are recognised by vocabulary *and* by the structural governor
	 * test below. The vocabulary is load-bearing: in rules text the word after a
	 * coordinator is very often an adjective or noun ("Strength checks and Strength
	 * saving throws", "an infernal or celestial countenance"), and a purely structural
	 * rule conjugates those into nonsense. The safer failure mode is to leave an
	 * unlisted verb alone rather than to corrupt a noun phrase.
	 */
	static _IMPLIED_SUBJECT_VERBS = new Set([
		"do", "don't", "don’t", "have", "are", "were", "aren't", "don",
		"use", "cast", "deal", "add", "take", "make", "gain", "move", "regain",
		"roll", "choose", "expend", "push", "pull", "drop", "leave", "turn",
		"end", "start", "begin", "reduce", "ignore", "avoid", "succeed", "fail",
		"attack", "hit", "grant", "learn", "summon", "study", "activate", "finish",
		"become", "know", "throw", "focus", "restore", "force", "teleport",
		"spend", "regains", "shove", "knock", "impose", "remove", "apply",
		"manifest", "revert", "recover",
	]);

	static _getLeadClause (whole, offset) {
		const before = String(whole).slice(0, offset);
		const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"));
		return cut === -1 ? before : before.slice(cut + 1);
	}

	/**
	 * Player-facing rules address the reader directly, so an instruction can be a bare
	 * imperative with no subject at all ("Add your Wisdom modifier to any saving throw").
	 * Read as a statblock that becomes an order to the DM. When the imperative's own
	 * object refers back to the character, the subject is unambiguous — supply it.
	 *
	 * Gated on the object being a subject reference: "Roll 1d8" or "Choose one creature"
	 * are genuine instructions to whoever is resolving the ability and must stay bare.
	 */
	static _supplyImperativeSubject (text, subjectToken, possessiveToken) {
		const escape = (token) => String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// `\b` cannot follow the placeholder — `§` is a non-word character, so there is no
		// boundary between it and the following space.
		const re = new RegExp(`(^|[.!?]\\s+)([A-Z][a-z'’]*)(\\s+)(?=(?:${escape(possessiveToken)}|${escape(subjectToken)})(?:\\s|$))`, "g");
		return String(text || "").replace(re, (match, lead, word, gap) => {
			const low = word.toLowerCase().replace(/’/g, "'");
			if (!this._IMPLIED_SUBJECT_VERBS.has(low)) return match;
			if (this._NOUN_HOMOGRAPHS.has(low)) return match;
			const fixed = this._THIRD_PERSON_IRREGULARS[low] || this._conjugateThirdPerson(low);
			if (fixed === low) return match;
			return `${lead}${subjectToken} ${fixed}${gap}`;
		});
	}

	static _conjugateImpliedSubjects (text) {
		// An adverb can sit between the conjunction and the verb it governs ("and already
		// have an item"), so the verb is not always the next word.
		const adverbRun = `(?:(?:${this._getAdverbAlternation()})\\s+)*`;
		// Supply missing subjects first: a bare imperative ("When it does so, roll…")
		// reads as a modal clause to the governor test, so every verb coordinated with it
		// is judged bare and left in the player's voice.
		let out = this._resolveImperativeLeftovers(String(text || "")).replace(
			new RegExp(String.raw`\b(and|or|but)\s+(${adverbRun})([a-z][a-z'’]*)\b`, "g"),
			(match, conj, adverbs, verb, offset, whole) => {
				const low = verb.toLowerCase().replace(/’/g, "'");
				if (!this._IMPLIED_SUBJECT_VERBS.has(low)) return match;
				// Verb/noun homographs ("…checks and attack rolls") must stay nouns.
				if (this._NOUN_HOMOGRAPHS.has(low)) return match;
				if (this._getClauseGovernor(this._getLeadClause(whole, offset)) !== "finite") return match;
				const fixed = this._THIRD_PERSON_IRREGULARS[low] || this._conjugateThirdPerson(verb);
				if (fixed === verb) return match;
				return `${conj} ${adverbs}${fixed}`;
			},
		);
		out = this._conjugateCoordinatedListItems(out);
		out = this._resolveImperativeLeftovers(out);
		return out;
	}

	/**
	 * Player-voice text gives instructions ("Each time it uses this feature, choose which
	 * effect to create"). A statblock describes what the NPC does, so the instruction
	 * needs its subject back.
	 */
	static _SENTENCE_LEAD_SUBORDINATORS = "Each time|Whenever|When|While|If|After|Before|Once|On|At|During";

	static _CLAUSE_MODAL_RE = /\b(?:can|could|may|might|must|shall|should|will|would|does|do)\b/;

	/**
	 * A sentence that opens with a subordinate clause routinely drops the subject of the
	 * main clause, because player-facing rules address the reader: "If it hits, add the
	 * Superiority Die". Read as a statblock that becomes an order to the DM.
	 *
	 * Scanned comma by comma rather than by one regex: the first comma is often internal
	 * to the subordinate clause ("When it manifests this power, and as its action…,
	 * choose…"), and a single match would consume the sentence before reaching the real
	 * clause boundary. Skipped entirely when a modal governs the sentence — under a modal
	 * ("it can expend a die, roll it, and regain…") the bare form is already correct.
	 */
	static _supplySubordinateClauseSubject (sentence) {
		const text = String(sentence);
		if (!new RegExp(String.raw`^\s*(?:${this._SENTENCE_LEAD_SUBORDINATORS})\b`).test(text)) return text;
		// The sentence has to be about the NPC: either it refers back to it, or the
		// subordinate clause names it outright ("Whenever Talna finishes a Long Rest, …").
		const namesSubject = new RegExp(String.raw`^\s*(?:${this._SENTENCE_LEAD_SUBORDINATORS})\s+[A-Z]`).test(text);
		if (!/\bits?\b/.test(text) && !namesSubject) return text;

		const re = /,\s+([a-z][a-z'’]*)\b/g;
		let match;
		while ((match = re.exec(text)) !== null) {
			const low = match[1].toLowerCase().replace(/’/g, "'");
			if (!this._IMPLIED_SUBJECT_VERBS.has(low)) continue;
			if (this._NOUN_HOMOGRAPHS.has(low)) continue;
			// A comma-separated noun list looks identical to a bare imperative from the
			// left ("acid, cold, fire, force, lightning, or thunder damage"). A list item
			// is followed by another separator; a verb is followed by its object.
			if (/^\s*(?:[,;]|or\b|and\b)/.test(text.slice(match.index + match[0].length))) continue;
			// Only the text governing this candidate matters. A modal further along the
			// sentence ("…that it can see within range") governs a different clause.
			if (this._CLAUSE_MODAL_RE.test(text.slice(0, match.index))) continue;
			const fixed = this._THIRD_PERSON_IRREGULARS[low] || this._conjugateThirdPerson(low);
			if (fixed === low) continue;
			return `${text.slice(0, match.index)}, it ${fixed}${text.slice(match.index + match[0].length)}`;
		}
		return text;
	}

	static _resolveImperativeLeftovers (text) {
		return String(text || "")
			.replace(/[^.;!?]+[.;!?]*/g, sentence => this._supplySubordinateClauseSubject(sentence))
			.replace(
				/\b(Each time|Whenever|When|If) (it|its)([^,.;]{0,70}), (choose|roll|pick|select|decide)\b/g,
				(match, lead, subject, mid, verb) => `${lead} ${subject}${mid}, it ${this._conjugateThirdPerson(verb)}`,
			)
			// A temporal adverbial can carry the same bare imperative without naming a
			// subject at all ("On each of its turns, take a Bonus Action to Dash").
			.replace(
				/\b((?:On|At|During|After|Before|Once|Each)\b[^.;!?]{0,70}\bturns?,\s+)([a-z][a-z'’]*)\b/g,
				(match, lead, verb) => {
					const low = verb.toLowerCase().replace(/’/g, "'");
					if (!this._IMPLIED_SUBJECT_VERBS.has(low)) return match;
					if (this._NOUN_HOMOGRAPHS.has(low)) return match;
					const fixed = this._THIRD_PERSON_IRREGULARS[low] || this._conjugateThirdPerson(low);
					return fixed === low ? match : `${lead}it ${fixed}`;
				},
			)
			// "must succeed on a save or die" takes a singular subject unless the sentence
			// is talking about several creatures at once.
			.replace(/[^.;]*\bor die\b[^.;]*/g, clause => (/\b(creatures|targets|they|each of them)\b/i.test(clause) ? clause : clause.replace(/\bor die\b/, "or dies")));
	}

	/**
	 * Verb phrases can also be coordinated with commas ("…makes an attack roll, deal
	 * damage, or casts a spell"). Once the final item has been conjugated the earlier
	 * items are provably parallel to it, so they can be conjugated too.
	 */
	static _conjugateCoordinatedListItems (text) {
		// The verb directly after a subordinate clause is the main clause's own verb, not
		// a coordinated list item — "When it does so, roll its die, and regain…" needs a
		// subject supplied ("it rolls"), and conjugating it in place hides that.
		const MAIN_CLAUSE = /\b(?:Each time|Whenever|When|If)\s+(?:it|its|§§SUBJ§§)[^,.;]{0,70},\s*$/;
		return String(text || "").replace(
			/,\s+([a-z][a-z'’]*)(\s+)(?=[^.!?;]*?,\s+(?:and|or)\s+[a-z][a-z'’]*s\b)/g,
			(match, word, gap, offset, whole) => {
				const low = word.toLowerCase().replace(/’/g, "'");
				if (!this._IMPLIED_SUBJECT_VERBS.has(low)) return match;
				if (this._NOUN_HOMOGRAPHS.has(low)) return match;
				const lead = this._getLeadClause(whole, offset);
				if (MAIN_CLAUSE.test(`${lead},`)) return match;
				if (this._getClauseGovernor(lead) !== "finite") return match;
				const fixed = this._THIRD_PERSON_IRREGULARS[low] || this._conjugateThirdPerson(word);
				if (fixed === word) return match;
				return `, ${fixed}${gap}`;
			},
		);
	}

	/** Verbs whose base form ends in `-ed`, which the past-tense guard would otherwise skip. */
	static _ED_BASE_FORM_VERBS = new Set(["shed", "shred", "embed", "wed", "spread", "thread", "tread", "dread"]);

	/**
	 * Base forms that collide with the adverb (`-ly`) and participle (`-ing`) guards.
	 * Without these, "Dzeiy apply this curse" is read as an adverb and left in the
	 * player's voice.
	 */
	static _LY_ING_BASE_FORM_VERBS = new Set([
		"apply", "supply", "imply", "reply", "comply", "multiply", "rely", "fly",
		"ally", "rally", "tally", "bring", "sing", "ring", "cling", "fling",
		"spring", "swing", "string", "sting",
	]);

	/**
	 * `-ly` is treated as an adverb marker when scanning for the verb after a subject,
	 * but a handful of verbs end that way. Excluding them keeps "it apply this curse"
	 * from parsing as "it <adverb> apply".
	 */
	static _getAdverbAlternation () {
		const lyVerbs = [...this._LY_ING_BASE_FORM_VERBS].filter(word => word.endsWith("ly"));
		return `${this._SUBJECT_ADVERBS.join("|")}|(?!(?:${lyVerbs.join("|")})\\b)[a-z]+ly`;
	}

	static _conjugateThirdPerson (word) {
		const raw = String(word || "");
		if (!raw) return word;
		// A hyphenated verb inflects on its final element: "shape-shift" → "shape-shifts".
		if (raw.includes("-")) {
			const parts = raw.split("-");
			const tail = this._conjugateThirdPerson(parts[parts.length - 1]);
			return tail === parts[parts.length - 1] ? raw : [...parts.slice(0, -1), tail].join("-");
		}
		const low = raw.toLowerCase();

		const irregular = this._THIRD_PERSON_IRREGULARS[low];
		if (irregular) return irregular;
		if (this._SUBJECT_FOLLOWERS_KEEP.has(low)) return raw;
		if (this._PAST_TENSE_KEEP.has(low)) return raw;
		// Past tense / participles, adverbs and already-inflected forms are left alone.
		// `-eed` verbs (succeed, exceed, proceed) are base forms, not past tense, as are
		// the handful of base forms that merely end in `-ed` ("shed dim light").
		if (/(?:ing|ly)$/.test(low) && !this._LY_ING_BASE_FORM_VERBS.has(low)) return raw;
		if (/ed$/.test(low) && !/eed$/.test(low) && !this._ED_BASE_FORM_VERBS.has(low)) return raw;
		if (/[^aeious]s$/.test(low)) return raw;

		if (/(?:ss|sh|ch|x|z|o)$/.test(low)) return `${raw}es`;
		// "gas" needs "-es"; "perceives" is already third person and must be left alone.
		if (/[^aeiou]es$/.test(low)) return raw;
		if (/[aeiou]s$/.test(low)) return `${raw}es`;
		if (/[^aeiou]y$/.test(low)) return `${raw.slice(0, -1)}ies`;
		return `${raw}s`;
	}

	static _getSafeInlineTextKeepTags (text, {maxLen = 500} = {}) {
		if (text == null) return "";
		const stash = this._stashTags(text);
		let s = stash.stashed
			// Deliberate control-character sanitization for text bound for JSON/HTML.
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (s.length > maxLen) s = s.slice(0, maxLen).trim();
		return this._restoreTags(s, stash.tagStore, stash.prefix);
	}

	static _enrichNpcTags (text, {spellVocabulary = this._activeSpellVocabulary} = {}) {
		if (!text) return "";
		let s = this._sanitizeInboundTags(text);
		const outer = this._stashTags(s);
		s = outer.stashed;

		const conditions = [
			"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
			"incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
			"restrained", "stunned", "unconscious",
		];
		conditions.forEach(cond => {
			const re = new RegExp(`\\b(${cond})\\b`, "gi");
			s = s.replace(re, (m) => `{@condition ${m.toLowerCase()}}`);
		});

		// Homebrew prose states its dice bare ("the creature takes 6d10 psychic damage"),
		// so nothing was clickable on powers that are nothing but damage. Tags are stashed
		// above, so an already-tagged expression cannot be reached here.
		const DAMAGE_TYPES = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
		s = s.replace(
			new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)(\\s+(?:${DAMAGE_TYPES})\\s+damage)`, "gi"),
			(m, dice, tail) => `{@damage ${dice.replace(/\s+/g, "")}}${tail}`,
		);
		s = s.replace(
			/\b(\d+d\d+)(\s+temporary hit points)/gi,
			(m, dice, tail) => `{@dice ${dice}}${tail}`,
		);

		// Wisdom (Perception) / Strength (Athletics) patterns
		s = s.replace(
			/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*\(\s*([A-Za-z][A-Za-z\s']{1,30}?)\s*\)/g,
			(m, abl, skill) => `${abl} ({@skill ${skill.trim()}})`,
		);

		// Stash tags created above before standalone skill pass (avoid double-wrap)
		const mid = this._stashTags(s);
		s = mid.stashed;
		const skills = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History",
			"Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception",
			"Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival",
		];
		// `Nature`, `Insight`, `Perception`… are common nouns as well as skills; blind
		// tagging produces nonsense like "a {@skill Nature} spirit" or "the {@skill
		// Nature} of the intervention". These require a skill-check context.
		const ambiguous = new Set(["Nature", "Insight", "Perception", "Performance", "Medicine", "History", "Survival"]);
		// Unambiguous skills first, so an ambiguous name can recognise a list it belongs to.
		skills.filter(sk => !ambiguous.has(sk)).forEach(skill => {
			s = s.replace(new RegExp(`\\b(${skill.replace(/\s+/g, "\\s+")})\\b`, "gi"), () => `{@skill ${skill}}`);
		});
		skills.filter(sk => ambiguous.has(sk)).forEach(skill => {
			const re = new RegExp(`\\b(${skill.replace(/\s+/g, "\\s+")})\\b`, "gi");
			s = s.replace(re, (m, _g, offset, whole) => {
				const after = whole.slice(offset + m.length, offset + m.length + 40);
				const before = whole.slice(Math.max(0, offset - 30), offset);
				const isCheckContext = /^\s*(\(|\)?\s*(check|checks|score|scores)\b)/i.test(after)
					|| /\b(skill|check|checks|proficiency|proficient(?:\s+in)?|expertise)\b[^.]{0,24}$/i.test(before)
					|| /\(\s*$/.test(before)
					// A member of a comma/or list of skills, e.g. "chosen from Insight, Persuasion, or Religion".
					|| /^\s*,?\s*(and|or)?\s*\{@skill /i.test(after)
					|| /\{@skill [^}]*\}\s*,?\s*(and|or)?\s*$/i.test(before);
				return isCheckContext ? `{@skill ${skill}}` : m;
			});
		});
		s = this._restoreTags(s, mid.tagStore, mid.prefix);

		// Spell names mentioned in feature prose ("it learns the misty step spell") are
		// prime hover targets, but blind tagging invents links. Tag only names the
		// character actually knows, so the source is always right.
		if (spellVocabulary?.size) {
			const spellStash = this._stashTags(s);
			s = spellStash.stashed;
			// One combined pass, longest name first: a single `replace` cannot match
			// inside its own output, so "Cure Wounds" can never nest inside the
			// "{@spell Mass Cure Wounds}" tag emitted moments earlier.
			const names = [...spellVocabulary.keys()].sort((a, b) => b.length - a.length);
			const alternation = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
			const re = new RegExp(`\\b(?:${alternation})\\b`, "gi");
			s = s.replace(re, (m, offset, whole) => {
				const hit = spellVocabulary.get(m.toLowerCase().replace(/\s+/g, " "));
				if (!hit) return m;
				if (hit.strict && !this._isStandaloneSpellMention(m, offset, whole)) return m;
				return `{@spell ${hit.name}${hit.source ? `|${hit.source}` : ""}}`;
			});
			s = this._restoreTags(s, spellStash.tagStore, spellStash.prefix);
		}

		// A feature can name a spell the character does not itself know ("it can use an
		// action to cast the darkness spell"), so the vocabulary pass above never sees it.
		// "the <name> spell" is unambiguous enough to tag without a source — 5etools
		// resolves a sourceless spell tag by name — and a hover is the whole point.
		{
			const tailStash = this._stashTags(s);
			s = tailStash.stashed;
			const NOT_A_SPELL = /^(?:same|following|chosen|higher[- ]level|lower[- ]level|other|another|first|second|third|next|new|selected|appropriate|corresponding|original|resulting|entire|whole|only|single|artificer|barbarian|bard|cleric|druid|fighter|monk|paladin|ranger|rogue|sorcerer|warlock|wizard)$/i;
			// A spell name is a noun phrase. When conversion mangles a sentence the
			// pattern can span a clause boundary and mint a spell out of grammar —
			// "{@spell Attack Or}", "{@spell Metamagic Affects Any}". Any conjunction,
			// determiner or finite verb inside the candidate proves it is not a name.
			const NOT_IN_A_NAME = new Set([
				"or", "and", "but", "nor", "any", "all", "each", "some", "that", "which",
				"it", "its", "this", "these", "those", "affects", "affect", "casts", "cast",
				"deals", "deal", "takes", "take", "makes", "make", "gains", "gain", "uses",
				"has", "have", "can", "must", "is", "are", "was", "were", "be", "been",
			]);
			// A name never trails off in a function word. "the staff absorbs the magic of
			// the spell" offered "magic of the" and minted a hover to a spell that does
			// not exist; the giveaway is the dangling determiner, not the vocabulary.
			const DANGLING_TAIL = /\b(?:of|the|a|an|in|on|to|from|with|for|by|at)$/i;
			// The name may be written either way: item prose says "the darkness spell",
			// class prose says "cast the Find Familiar spell". Match both and normalise
			// case below, but never let "the Wizard spell slots" mint a spell — a
			// following bookkeeping noun means the word before it was a qualifier. The
			// possessive is the same trap one word earlier: "the absorbed spell's level"
			// is describing a spell, not naming one.
			s = s.replace(/\bthe ([a-zA-Z][a-zA-Z'’]*(?: [a-zA-Z][a-zA-Z'’]*){0,2}) spell\b(?!['’]s)(?!\s+(?:slots?|save|attack|list|level|scroll))/g, (m, name) => {
				const words = name.split(" ").map(w => w.toLowerCase());
				if (NOT_A_SPELL.test(words[0])) return m;
				if (words.some(w => NOT_IN_A_NAME.has(w))) return m;
				if (DANGLING_TAIL.test(name)) return m;
				const titled = name.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
					.replace(/\b(Of|The|And|From|In|On|To)\b/g, w => w.toLowerCase());
				// Prefer the source the character's own list already proves.
				const known = spellVocabulary?.get(name.toLowerCase().replace(/\s+/g, " "));
				return `the {@spell ${titled}${known?.source ? `|${known.source}` : ""}} spell`;
			});
			s = this._restoreTags(s, tailStash.tagStore, tailStash.prefix);
		}

		// Homebrew item data often writes `{@spell moonbeam}` in lower case. The link
		// still resolves, but a statblock prints spell names as the proper nouns they are.
		// This has to run *after* the outer restore, or every tag is still a placeholder.
		return this._qualifyCoreActionTags(this._titleCaseSpellTags(this._restoreTags(s, outer.tagStore, outer.prefix)));
	}

	/**
	 * Homebrew and item text writes `{@action Dodge}` with no source. That resolves to
	 * the 2014 action, which the rest of a 2024-era statblock does not use. Qualify the
	 * actions the current edition actually defines and leave everything else alone —
	 * a wrong source is worse than none.
	 */
	static _qualifyCoreActionTags (text) {
		const XPHB_ACTIONS = new Set([
			"attack", "dash", "disengage", "dodge", "help", "hide", "influence", "magic",
			"ready", "search", "study", "utilize", "opportunity attack",
		]);
		return String(text || "").replace(/\{@action ([^}|]+)\}/g, (m, name) => {
			const key = name.trim().toLowerCase();
			if (!XPHB_ACTIONS.has(key)) return m;
			const canonical = key.replace(/\b[a-z]/g, c => c.toUpperCase());
			return canonical === name.trim() ? `{@action ${canonical}|XPHB}` : `{@action ${canonical}|XPHB|${name.trim()}}`;
		});
	}

	static _titleCaseSpellTags (text) {
		return String(text || "").replace(/\{@spell ([^}|]+)((?:\|[^}]*)?)\}/g, (m, name, rest) => {
			if (/[A-Z]/.test(name)) return m;
			const titled = name.replace(/\b[a-z]/g, c => c.toUpperCase())
				.replace(/\b(Of|The|And|From|In|On|To)\b/g, w => w.toLowerCase());
			return `{@spell ${titled}${rest}}`;
		});
	}

	/** Conditions 5etools will actually resolve a `{@condition}` hover for. */
	static _HOVERABLE_CONDITIONS = new Set([
		"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
		"incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
		"restrained", "stunned", "unconscious",
	]);

	/**
	 * 5etools files these as `{@status}`, not `{@condition}` — `surprised` and
	 * `concentration` are states a creature is in but not entries in the condition
	 * glossary, so a `{@condition}` tag on either renders as a failed lookup.
	 */
	static _HOVERABLE_STATUSES = new Set(["surprised", "concentration"]);

	/** Actions 5etools will actually resolve an `{@action}` hover for. */
	static _HOVERABLE_ACTIONS = new Set([
		"attack", "dash", "disengage", "dodge", "help", "hide", "influence", "magic",
		"ready", "search", "study", "utilize", "opportunity attack", "improvise",
	]);

	/**
	 * Source data mistags game terms by kind, and a tag of the wrong kind renders as a
	 * failed lookup rather than a hover — worse for the reader than plain text. Remap
	 * where the right kind is unambiguous ({@condition Dash} is plainly the action),
	 * and demote to the tag's own display text otherwise ({@condition hidden},
	 * {@action Bonus Action}), which reads correctly and never dead-links.
	 *
	 * @param {string} text entry text
	 * @returns {string} text with every condition/action tag resolvable
	 */
	static _sanitizeTagKinds (text) {
		return String(text || "").replace(/\{@(condition|action) ([^}|]+)((?:\|[^}]*)?)\}/g, (m, kind, name, rest) => {
			const key = name.trim().toLowerCase();
			const display = (rest.split("|")[2] || name).trim();
			if (kind === "condition") {
				if (this._HOVERABLE_CONDITIONS.has(key)) return m;
				if (this._HOVERABLE_STATUSES.has(key)) return display === key ? `{@status ${key}}` : `{@status ${key}||${display}}`;
				if (this._HOVERABLE_ACTIONS.has(key)) {
					const canonical = key.replace(/\b[a-z]/g, c => c.toUpperCase());
					return canonical === display ? `{@action ${canonical}|XPHB}` : `{@action ${canonical}|XPHB|${display}}`;
				}
				return display;
			}
			if (this._HOVERABLE_ACTIONS.has(key)) return m;
			if (this._HOVERABLE_CONDITIONS.has(key)) return `{@condition ${key}|XPHB|${display}}`;
			return display;
		});
	}

	/**
	 * Lower-cased spell name → canonical `{name, source}` for every spell on the sheet.
	 * Single-word names ("Shield", "Light", "Fly") are ordinary English and are marked
	 * `strict`, so they only link when the surrounding text proves a spell is meant.
	 */
	/** Set for the duration of one conversion so every prose path gets spell hovers. */
	static _activeSpellVocabulary = null;

	/**
	 * A single-word spell name is a real spell reference when it is followed by the
	 * word "spell", or when it stands alone as a capitalised term (not part of a
	 * larger proper name such as "Shield Master" or "Light Armor").
	 */
	static _isStandaloneSpellMention (match, offset, whole) {
		const after = String(whole).slice(offset + match.length);
		if (/^\s+spell\b/i.test(after)) return true;
		if (!/^[A-Z]/.test(match)) return false;
		if (/^[\s-]+[A-Z]/.test(after)) return false;
		const before = String(whole).slice(0, offset);
		if (/[A-Za-z][\s-]+$/.test(before) && /\b[A-Z][a-z']*[\s-]+$/.test(before)) return false;
		return true;
	}

	static _getSpellVocabulary (state) {
		const out = new Map();
		const add = sp => {
			const raw = String(sp?.name || sp || "").trim();
			if (!raw) return;
			const {name, source} = this._parseSpellUid(raw, sp?.source);
			const key = String(name).toLowerCase();
			if (!out.has(key)) out.set(key, {name, source, strict: !/\s/.test(name)});
		};
		[
			state?.getSpells?.(),
			state?.getCantrips?.(),
			state?.getKnownSpells?.(),
			state?.getPreparedSpells?.(),
			state?.getInnateSpells?.(),
			state?.getItemGrantedSpells?.(),
		].forEach(list => (Array.isArray(list) ? list : []).forEach(add));
		return out;
	}

	/**
	 * Tags harvested from sheet HTML carry sources and quick-reference plumbing that
	 * break hovers in a bestiary context. Normalize them before enrichment.
	 */
	static _CORE_CONDITIONS = new Set([
		"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
		"incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
		"restrained", "stunned", "unconscious", "concentration", "surprised",
	]);

	static _sanitizeInboundTags (text) {
		let s = String(text || "");

		// {@quickref Advantage and Disadvantage|PHB|2|0|disadvantage} → "disadvantage"
		s = s.replace(/\{@quickref\s+([^}]*)\}/g, (m, body) => {
			const parts = body.split("|").map(p => p.trim()).filter(Boolean);
			return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
		});

		// Core conditions are not defined by homebrew sources, so a source segment
		// (e.g. `|TGTT`) yields a dead hover. Strip it and normalize casing.
		s = s.replace(/\{@condition\s+([^}|]+)(\|[^}]*)?\}/gi, (m, name) => {
			const clean = String(name).trim();
			if (!this._CORE_CONDITIONS.has(clean.toLowerCase())) return m;
			return `{@condition ${clean.toLowerCase()}}`;
		});

		return s;
	}

	/** Strip HTML only; preserve {@tag} wrappers for hoverability. */
	static _stripHtmlTags (text) {
		if (!text) return "";
		const stash = this._stashTags(this._flattenOptionTables(this._collapseLevelTables(this._coerceEntriesDescription(text))));
		const cleaned = stash.stashed
			// A list carries its meaning in the item boundaries. Stripping the markup
			// blind ran the rows together — Elizabeth's damage-type lookup read
			// "Abjuration - Force damage Conjuration or Transmutation - …", mapping the
			// wrong school to the wrong damage. Keep the boundary the markup encoded.
			.replace(/<\/li>\s*(?=<li)/gi, "; ")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return this._restoreTags(cleaned, stash.tagStore, stash.prefix);
	}

	/**
	 * A rendered level-progression table survives tag-stripping as word soup
	 * ("Druid Level Known Forms Max CR 2 4 1/4 No 4 6 1/2 No"). Only one row can ever
	 * apply to a finished character, so replace the whole table with that row.
	 * Tables without a level column are left alone — they are not progressions.
	 */
	static _collapseLevelTables (html) {
		const raw = String(html || "");
		if (!/<table[\s>]/i.test(raw)) return raw;

		return raw.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (match, body) => {
			const caption = (body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "")
				.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
			const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
				.map(m => [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
					.map(c => c[1].replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()));
			if (rows.length < 2) return match;

			const headers = rows[0];
			const levelCol = headers.findIndex(h => /\blevels?\b/i.test(h));
			if (levelCol === -1) return match;

			const level = this._getContextLevelForHeader(headers[levelCol]);
			if (!level) return match;

			let best = null;
			const applicable = [];
			rows.slice(1).forEach(row => {
				const rowLevel = Number(String(row[levelCol] || "").replace(/[^\d]/g, ""));
				if (Number.isFinite(rowLevel) && rowLevel > 0 && rowLevel <= level) { best = row; applicable.push(row); }
			});
			if (!best) return " ";

			const cells = headers
				.map((h, i) => {
					if (i === levelCol || !h) return null;
					const values = applicable.map(r => (r[i] || "").trim()).filter(Boolean);
					if (!values.length) return null;
					// Spell/feature lists accumulate as the character levels; scalar
					// progressions ("Max CR", "Known Forms") are replaced by the latest row.
					const isList = values.some(v => v.includes(",") || v.split(/\s+/).length > 2);
					const value = isList ? [...new Set(values)].join(", ") : values[values.length - 1];
					// A list column ("Prepared Spells") is content; only scalar config
					// columns are form-field chrome needing a rewrite.
					return isList ? `${h} ${value}` : this._formatProgressionCell(h, value);
				})
				.filter(Boolean);
			if (!cells.length) return " ";
			// The caption is known to be a caption here, so bold it directly rather than
			// leaving `_boldInlineOptionLabel` to infer it from a `Label: ` shape the
			// rewritten cells no longer have.
			return ` ${caption ? `{@b ${caption}.} ` : ""}${cells.join(", ")}. `;
		});
	}

	/**
	 * A progression cell is a form-field label paired with a raw value, and pasting the two
	 * together gives sheet chrome rather than English: Wild Shape collapsed to
	 * `Known Forms 8, Max CR 3, Fly Speed Yes`. `Fly Speed Yes` is a boolean config field
	 * printed verbatim, and it duplicated the sentence directly above it.
	 *
	 * Boolean columns are dropped — whatever they gate is always stated in the feature's
	 * prose — and a count reads as a count.
	 *
	 * @param {string} header column header
	 * @param {string} value selected row value
	 * @returns {string|null} readable clause, or null to omit the column
	 */
	static _formatProgressionCell (header, value) {
		const h = String(header || "").trim();
		const v = String(value || "").trim();
		if (!h || !v) return null;
		if (/^(?:yes|no|true|false|—|-|n\/a)$/i.test(v)) return null;
		// Acronyms ("CR", "DC", "HP") are meaningful only in caps; ordinary words are not.
		const lower = h.split(/\s+/).map(w => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
		if (/s$/i.test(h) && /^[\d/]+$/.test(v)) return `${v} ${lower}`;
		return `${lower} ${v}`;
	}

	/**
	 * lookup ("Spellsword Technique") has every row live at once, so the row-selecting
	 * collapse above declines it — and generic tag-stripping then destroyed it, leaving
	 * Nessa's Font of Magic as the bare header row with the data gone. A DM could not
	 * use the feature at all.
	 *
	 * Renders what survives as one compact line: the column names once, then every row
	 * as a slash-joined tuple. Nothing is lost and it costs a single line.
	 *
	 * @param {string} html rendered feature description
	 * @returns {string} description with remaining tables rendered inline
	 */
	static _flattenOptionTables (html) {
		const raw = String(html || "");
		if (!/<table[\s>]/i.test(raw)) return raw;

		return raw.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (match, body) => {
			const clean = cell => cell.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
			const caption = clean(body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
			const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
				.map(m => [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => clean(c[1])));
			if (rows.length < 2) return match;

			const headers = rows[0];
			const data = rows.slice(1).filter(row => row.some(Boolean));
			if (!data.length || !headers.some(Boolean)) return match;
			// Beyond this a statblock line stops being readable, and the table was
			// probably reference material rather than something to run from.
			if (data.length > 12) return match;

			// Two columns read best as a mapping; more are clearer as a labelled tuple.
			const label = caption ? `${caption} — ` : "";
			if (headers.length === 2) {
				const pairs = data.map(row => `${row[0]}: ${row[1]}`).join("; ");
				return ` ${label}${pairs}. `;
			}
			const cols = headers.filter(Boolean).join(" / ");
			const tuples = data.map(row => row.join("/")).join("; ");
			return ` ${label}${cols}: ${tuples}. `;
		});
	}

	/** "Druid Level" → this character's druid level; a bare "Level" → total level. */
	static _getContextLevelForHeader (header) {
		const ctx = this._activeLevelContext;
		if (!ctx) return 0;
		const label = String(header || "").replace(/\blevels?\b/i, "").trim().toLowerCase();
		if (label && ctx.byClass[label] != null) return ctx.byClass[label];
		if (label) return 0;
		return ctx.total;
	}

	/**
	 * Some feature descriptions are stored as a JSON string of an entries object
	 * (e.g. `{"entries":["…", {"type":"entries","name":"X","entries":[…]}]}`).
	 * Flatten those to prose so raw JSON never reaches the statblock. Also
	 * recovers text from JSON that was truncated before it could be parsed.
	 */
	static _coerceEntriesDescription (text) {
		const raw = String(text ?? "");
		const trimmed = raw.trim();
		if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
		if (!/["']entries["']\s*:/.test(trimmed) && !trimmed.startsWith("[")) return raw;

		try {
			return this._flattenEntriesValue(JSON.parse(trimmed)).trim() || raw;
		} catch (e) {
			// Truncated / malformed JSON — salvage the quoted string literals in order.
			const salvaged = [];
			const re = /"((?:[^"\\]|\\.)*)"\s*(?:,|\]|$)/g;
			let m;
			while ((m = re.exec(trimmed)) !== null) {
				let piece;
				try { piece = JSON.parse(`"${m[1]}"`); } catch (e2) { piece = m[1]; }
				// Skip structural keys such as "entries" / "type" / "name".
				if (/^(entries|type|name|items|style|caption)$/i.test(piece)) continue;
				if (piece.trim()) salvaged.push(piece.trim());
			}
			return salvaged.length ? salvaged.join(" ") : raw;
		}
	}

	static _flattenEntriesValue (value, depth = 0) {
		if (value == null || depth > 8) return "";
		if (typeof value === "string") return value;
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		if (Array.isArray(value)) {
			return value.map(it => this._flattenEntriesValue(it, depth + 1)).filter(Boolean).join(" ");
		}
		if (typeof value !== "object") return "";

		const parts = [];
		if (value.name) parts.push(`${String(value.name).trim().replace(/[.:]\s*$/, "")}.`);
		if (value.entry) parts.push(this._flattenEntriesValue(value.entry, depth + 1));
		if (value.entries) parts.push(this._flattenEntriesValue(value.entries, depth + 1));
		if (value.items) parts.push(this._flattenEntriesValue(value.items, depth + 1));
		return parts.filter(Boolean).join(" ");
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

	static _estimateCr ({totalLevel, hp, ac, attacks, attacksPerAction = 1, spellcastingBlocks = [], state = null, defenses = null, spellIndex = null}) {
		const effectiveHp = this._getEffectiveHpForCr(hp, state, defenses)
			* this._getEvasiveDefenseMultiplier(state);
		const defensiveCr = this._crFromHpAndAc(effectiveHp, this._getEffectiveAcForCr(ac, state));
		const dpr = this._estimateDpr({attacks, attacksPerAction, spellcastingBlocks, state, spellIndex});
		const offensiveCr = this._crFromDprAndAttack(dpr, attacks, state, spellcastingBlocks);

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
			breakdown: `CR estimate: defensive ${defensiveCr} / offensive ${offensiveCr} (effective HP ~${Math.round(effectiveHp)}, DPR ~${Math.round(dpr)}) → ${cr}`,
		};
	}

	/**
	 * Resistance that the creature can switch on (Rage, a stance) still roughly
	 * doubles its staying power against the damage it covers, so it must count
	 * toward defensive CR — discounted, because it is not always active.
	 */
	static _getEffectiveHpForCr (hp, state, defenses = null) {
		const base = Number(hp) || 0;
		if (!base || !state) return base;

		// Use every resistance the creature can bring to bear, including the ones
		// gated behind Rage or a stance — those never appear in persistent defenses
		// but are exactly what inflates staying power.
		const active = state.getEffectiveDefenses?.() || {};
		const persistent = state._data || {};
		const folds = this._getNamedModifierDefenseFolds(state) || {};
		const resistances = []
			.concat(active.resistances || [], persistent.resistances || [], folds.resist || [], defenses?.resist || [])
			.flatMap(r => (Array.isArray(r?.resist) ? r.resist : [r]))
			.map(r => String(r?.type || r?.name || r || "").toLowerCase())
			.filter(Boolean);
		if (!resistances.length) return base;

		const physical = ["bludgeoning", "piercing", "slashing"];
		const coversPhysical = physical.every(t => resistances.some(r => r.includes(t)));
		if (coversPhysical) return base * 1.4;
		if (new Set(resistances).size >= 3) return base * 1.25;
		return base * 1.1;
	}

	/**
	 * Resistance is not the only way a creature survives longer than its hit points say.
	 * A rogue halves the biggest attack of the round with Uncanny Dodge, takes nothing at
	 * all from most area effects with Evasion, and from level 18 denies attackers
	 * Advantage outright — three effects the resistance fold is completely blind to, which
	 * is why the corpus rated a level 20 Rogue below a level 9 Fighter.
	 *
	 * Sized deliberately below the physical-resistance fold: each covers a narrower slice
	 * of incoming damage than "all weapon damage halved" does.
	 *
	 * @param {Object} state character sheet state
	 * @returns {number} multiplier to apply to effective HP
	 */
	static _getEvasiveDefenseMultiplier (state) {
		const calc = state?.getFeatureCalculations?.() || {};
		const names = new Set((state?.getFeatures?.() || [])
			.map(it => String(it?.name || "").toLowerCase().trim())
			.filter(Boolean));
		const has = (key, label) => !!calc[key] || names.has(label);

		let out = 1;
		// One attack per round halved is worth roughly a sixth of a martial's incoming
		// damage across a typical three-attacker round.
		if (has("hasUncannyDodge", "uncanny dodge")) out *= 1.15;
		// Half damage becomes none, and full becomes half, on the saves that matter most.
		if (has("hasEvasion", "evasion")) out *= 1.12;
		// Denying Advantage is worth about a 15% drop in incoming accuracy.
		if (has("hasElusive", "elusive")) out *= 1.12;
		return out;
	}

	/**
	 * A rogue's damage is not its round-in-round-out average; it is the round it chooses.
	 * Assassinate turns the opening round's Sneak Attack into a critical, Death Strike
	 * doubles an entire opening hit, and Cunning Strike converts Sneak Attack dice into
	 * conditions the DMG would price as riders. None of that reaches a per-round average,
	 * so the offensive rating sees a rogue as a single-attack skirmisher.
	 *
	 * @param {Object} state character sheet state
	 * @param {number} riderDamage once-per-turn rider damage already counted
	 * @returns {number} extra damage-per-round credit
	 */
	static _estimateBurstDamageCredit (state, riderDamage) {
		const rider = Number(riderDamage) || 0;
		if (!rider) return 0;
		const calc = state?.getFeatureCalculations?.() || {};
		const names = new Set((state?.getFeatures?.() || [])
			.map(it => String(it?.name || "").toLowerCase().trim())
			.filter(Boolean));
		const has = (key, label) => !!calc[key] || names.has(label);

		let credit = 0;
		// A guaranteed critical on the opening turn doubles the rider dice, amortised
		// across the encounter rather than counted at full value.
		if (has("hasAssassinate", "assassinate")) credit += rider * 0.35;
		// Death Strike doubles the whole hit, not just the rider, but only on a failed save.
		if (has("hasDeathStrike", "death strike")) credit += rider * 0.35;
		// Conditions bought with Sneak Attack dice are worth roughly what the dice were.
		if (has("hasCunningStrike", "cunning strike")) credit += rider * 0.15;
		return credit;
	}

	/**
	 * Printed AC is what the caster stands at, not what an attacker faces. A sorcerer
	 * holding Shield is AC +5 for the round that matters, and one who wears no armor
	 * because Mage Armor covers it is not really AC 12. Both are spells the character
	 * demonstrably knows, so the defensive rating should see them.
	 */
	static _getEffectiveAcForCr (ac, state) {
		let out = Number(ac) || 10;
		const known = new Set([
			...(state?.getCantripsKnown?.() || []),
			...(state?.getSpellsKnown?.() || []),
		].map(sp => String(sp?.name || "").toLowerCase().trim()));
		if (!known.size) return out;

		if (known.has("mage armor")) {
			const dex = Number(state?.getAbilityMod?.("dex")) || 0;
			out = Math.max(out, 13 + dex);
		}
		// Not the full +5: Shield covers the attacks that would have landed, not every
		// round of the fight.
		if (known.has("shield")) out += 4;
		return out;
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

	static _crFromDprAndAttack (dpr, attacks, state, spellcastingBlocks = []) {
		const table = CharacterSheetNpcExporter._CR_DPR_THRESHOLDS;
		let ix = 0;
		for (let i = 0; i < table.length; i++) {
			if (dpr <= table[i].dpr) { ix = i; break; }
			ix = i;
		}
		const attackBonuses = (attacks || []).map(a => this._getAttackToHit(a, state));
		let avgAtk = attackBonuses.length
			? attackBonuses.reduce((a, b) => a + b, 0) / attackBonuses.length
			: 0;
		// A caster threatens with its spell attack bonus, not with the dagger it never swings.
		if (spellcastingBlocks?.length) {
			const spellAtk = Number(state?.getSpellAttackBonus?.()) || 0;
			if (spellAtk) avgAtk = Math.max(avgAtk, spellAtk);
		}
		const atkAdj = Math.round((avgAtk - 3) / 2);
		ix = Math.max(0, Math.min(table.length - 1, ix + Math.max(-2, Math.min(2, atkAdj))));
		return table[ix].cr;
	}

	static _estimateDpr ({attacks = [], attacksPerAction = 1, spellcastingBlocks = [], state = null, spellIndex = null}) {
		const perHit = attacks.length
			? Math.max(...attacks.map(a => this._estimateDamageScore(a, state)))
			: 5;
		// Every swing carries the character's standing riders, and a martial build's
		// bonus action is another attack — leaving both out rated a level-13 monk at CR 6.
		const rider = this._estimatePerHitRiderDamage(state);
		const swings = Math.max(1, attacksPerAction) + this._getBonusActionAttackCount(state, attacksPerAction);
		const oncePerTurn = this._estimateOncePerTurnRiderDamage(state);
		const weaponDpr = ((perHit + rider) * swings)
			+ oncePerTurn
			+ this._estimateBurstDamageCredit(state, oncePerTurn);

		const spellDpr = spellcastingBlocks?.length
			? this._estimateSpellDpr({state, spellcastingBlocks, spellIndex})
			: 0;
		const psionicDpr = this._estimatePsionicDpr(state);
		return Math.max(weaponDpr, spellDpr * 0.75, psionicDpr * 0.75);
	}

	/**
	 * Slot level alone cannot tell a blaster from a diplomat — a wizard scores identically
	 * whether its 9th-level slot holds Meteor Swarm or Wish. Score the spells the character
	 * actually knows instead.
	 *
	 * With a `spellIndex` (built by the dialog from the site's spell data) this is exact.
	 * Offline the school of each spell stands in for its role, which still separates an
	 * evocation-heavy caster from a control/utility one.
	 */
	static _estimateSpellDpr ({state = null, spellcastingBlocks = [], spellIndex = null}) {
		const pb = state?.getProficiencyBonus?.() || 2;
		const cantripDice = pb >= 6 ? 4 : pb >= 4 ? 3 : pb >= 3 ? 2 : 1;
		const highestSlot = this._getHighestSpellSlotLevel(state, spellcastingBlocks);

		const known = [
			...(state?.getCantripsKnown?.() || []),
			...(state?.getSpellsKnown?.() || []),
		].filter(sp => sp?.name);
		if (!known.length) return Math.max(cantripDice * 5.5, highestSlot > 0 ? (highestSlot * 9) + 4 : 0);

		const lookup = this._getSpellIndexLookup(spellIndex);
		let cantripFloor = cantripDice * 5.5;
		// Best score available at each slot level, so slot scarcity can be applied below.
		const bestByLevel = new Map();

		known.forEach(spell => {
			const level = Number(spell.level) || 0;
			const entry = lookup?.(spell) || null;
			const score = entry
				? this._getIndexedSpellThreat(entry, level)
				: this._getHeuristicSpellThreat(spell, level);
			if (level === 0) {
				cantripFloor = Math.max(cantripFloor, score);
				return;
			}
			if (highestSlot > 0 && level > highestSlot) return;
			bestByLevel.set(level, Math.max(bestByLevel.get(level) || 0, score));
		});

		if (!bestByLevel.size) return cantripFloor;

		// The DMG rates a monster on its first three rounds. A single Meteor Swarm is not a
		// sustained 105 damage per round, so spend the real slots highest-first and let the
		// cantrip cover any round with nothing left to cast.
		const slots = this._getSpellSlotCounts(state, [...bestByLevel.keys()]);
		const rounds = [];
		for (let round = 0; round < 3; ++round) {
			let picked = cantripFloor;
			for (let level = highestSlot || 9; level >= 1; --level) {
				if (!(slots.get(level) > 0)) continue;
				const score = bestByLevel.get(level) || 0;
				if (score <= picked) continue;
				picked = score;
				slots.set(level, slots.get(level) - 1);
				break;
			}
			rounds.push(picked);
		}

		return rounds.reduce((a, b) => a + b, 0) / rounds.length;
	}

	/**
	 * Slot counts as a level → remaining map. Characters whose slots are unreadable are
	 * assumed to have one of each level they know a spell at, which keeps the three-round
	 * model meaningful rather than collapsing it to cantrips.
	 */
	static _getSpellSlotCounts (state, knownLevels = []) {
		const out = new Map();
		const slots = state?.getSpellSlots?.() || state?._data?.spellcasting?.spellSlots || null;
		if (slots) {
			Object.entries(slots).forEach(([level, slot]) => {
				const max = Number(slot?.max ?? slot?.total ?? slot);
				if (Number.isFinite(max) && max > 0) out.set(Number(level) || 0, max);
			});
		}
		if (!out.size) knownLevels.forEach(level => out.set(level, 1));
		return out;
	}

	static _getSpellIndexLookup (spellIndex) {
		if (!spellIndex) return null;
		const get = spellIndex instanceof Map
			? key => spellIndex.get(key)
			: key => spellIndex[key];
		return spell => {
			const name = String(spell?.name || "").trim().toLowerCase();
			if (!name) return null;
			const source = String(spell?.source || "").trim().toLowerCase();
			return get(`${name}|${source}`) || get(name) || null;
		};
	}

	/**
	 * Conditions that end a turn outright are worth roughly as much to an encounter as a
	 * big damage roll, which is how 5e's own CR guidance treats them.
	 */
	static _INCAPACITATING_CONDITIONS = new Set([
		"paralyzed", "petrified", "stunned", "unconscious", "incapacitated",
		"restrained", "banished", "charmed", "frightened", "blinded",
	]);

	static _getIndexedSpellThreat (entry, level) {
		let score = Number(entry?.avgDamage) || 0;
		const conditions = entry?.conditionInflict || [];
		const isControl = conditions.some(c => this._INCAPACITATING_CONDITIONS.has(String(c).toLowerCase()));
		if (isControl) score = Math.max(score, 12 + (5 * level));
		if (entry?.isAoe) score *= 1.5;
		else if (entry?.isMultiTarget) score *= 1.25;
		return score;
	}

	static _getHeuristicSpellThreat (spell, level) {
		const base = (level * 8) + 4;
		const school = String(spell?.school || "").toUpperCase();
		// V=Evocation, C=Conjuration, N=Necromancy carry most of the direct damage;
		// E=Enchantment and I=Illusion mostly control; A/D/T are largely utility.
		const weight = "VCN".includes(school) ? 1 : "EI".includes(school) ? 0.75 : 0.4;
		return base * weight;
	}

	/**
	 * Fold the site's spell data into the compact shape `_estimateSpellDpr` needs, so the
	 * converter itself stays pure and synchronous and can be exercised without any data
	 * files present.
	 *
	 * @param {Array<Object>} spells raw 5etools spell entities
	 * @returns {Object<string, {level: number, avgDamage: number, isAoe: boolean, isMultiTarget: boolean, conditionInflict: string[]}>}
	 */
	static buildSpellThreatIndex (spells) {
		const out = {};
		(spells || []).forEach(spell => {
			const name = String(spell?.name || "").trim().toLowerCase();
			if (!name) return;
			const source = String(spell?.source || "").trim().toLowerCase();
			// A spell with no damage type does no damage, whatever dice appear in its prose —
			// otherwise Wish's incidental 1d10 reads as artillery.
			const dealsDamage = !!(spell.damageInflict || []).length;
			const dice = dealsDamage ? this._getLargestDamageDice(spell.entries) : null;
			const avgDamage = dice ? dice.count * ((dice.faces + 1) / 2) : 0;
			const areaTags = (spell.areaTags || []).map(it => String(it).toUpperCase());
			// "ST" is the only genuinely single-target tag. "MT" (several separate targets,
			// e.g. Chain Lightning) multiplies damage but less than a true area, and every
			// other tag — S/C/Y/W/N/Q/L/R/H — is a shape that can catch a whole group.
			const isAoe = areaTags.some(tag => tag !== "ST" && tag !== "MT");
			// 5etools stores `[{number: 1, unit: "bonus"}]`, which stringifies to exactly
			// the shape the character sheet saves ("1 bonus"), so one parser serves both.
			const timeEnt = (spell.time || [])[0];
			const castingTime = timeEnt ? `${Number(timeEnt.number) || 1} ${String(timeEnt.unit || "").trim()}` : "";
			const entry = {
				level: Number(spell.level) || 0,
				castingTime,
				avgDamage,
				isAoe,
				isMultiTarget: !isAoe && areaTags.includes("MT"),
				conditionInflict: (spell.conditionInflict || []).map(it => String(it).toLowerCase()),
			};
			out[`${name}|${source}`] = entry;
			if (!out[name]) out[name] = entry;
		});
		return out;
	}

	static _getLargestDamageDice (entries) {
		let best = null;
		const text = JSON.stringify(entries || []);
		for (const match of text.matchAll(/\{@(?:damage|dice) (\d+)d(\d+)/g)) {
			const count = Number(match[1]);
			const faces = Number(match[2]);
			const avg = count * ((faces + 1) / 2);
			if (!best || avg > best.count * ((best.faces + 1) / 2)) best = {count, faces};
		}
		return best;
	}

	static _getHighestSpellSlotLevel (state, spellcastingBlocks = []) {
		let highest = 0;

		const slots = state?.getSpellSlots?.() || state?._data?.spellcasting?.spellSlots || null;
		if (slots) {
			Object.entries(slots).forEach(([level, slot]) => {
				const max = Number(slot?.max ?? slot?.total ?? slot);
				if (Number.isFinite(max) && max > 0) highest = Math.max(highest, Number(level) || 0);
			});
		}

		// Fall back to the levels actually printed in the spellcasting block.
		spellcastingBlocks.forEach(block => {
			Object.keys(block?.spells || {}).forEach(level => {
				const n = Number(level);
				if (Number.isFinite(n)) highest = Math.max(highest, n);
			});
		});

		return highest;
	}

	static _estimateDamageScore (attack, state = null) {
		const damage = this._normalizeDamageFormula(attack.damage || "");
		const m = damage.match(/(\d+)d(\d+)(?:([+-])(\d+))?/i);
		if (m) {
			const count = Number(m[1]) || 1;
			const die = Number(m[2]) || 6;
			const avg = count * (die + 1) / 2;
			const bonus = m[4] ? (m[3] === "-" ? -Number(m[4]) : Number(m[4])) : 0;
			// A raw `getAttacks()` row stores the bare die and lets the sheet add the
			// ability modifier at roll time; scoring it as printed undersells the attack.
			const pending = attack._damageIncludesAbilityMod || !state
				? 0
				: this._getAttackAbilityMod(attack, state);
			return avg + bonus + pending;
		}

		return Number(damage) || 5;
	}

	/**
	 * Riders that fire once a turn regardless of how many times the character swings —
	 * Sneak Attack and Divine Smite are the whole offence of a rogue and much of a
	 * paladin's, and leaving them out rated a level 20 rogue at CR 8.
	 *
	 * @param {Object} state character state
	 * @returns {number} average damage added once per turn
	 */
	static _estimateOncePerTurnRiderDamage (state) {
		const calc = state?.getFeatureCalculations?.();
		if (!calc) return 0;
		const avgOf = value => {
			if (value == null) return 0;
			if (typeof value === "number") return value;
			if (typeof value === "object") return Number(value.avgDamage) || this._averageOfDiceExpression(value.dice);
			return this._averageOfDiceExpression(value);
		};
		// The two keys are two spellings of the same rider; a class that ever populates
		// both must not have its Sneak Attack counted twice.
		let total = Math.max(avgOf(calc.sneakAttack), avgOf(calc.sneakAttackDamage));
		// A paladin spends slots on smites; the base smite is the sustainable one.
		if (calc.hasDivineSmite) total += avgOf(calc.smiteBaseDamage);
		return total;
	}

	/**
	 * Average of a dice expression such as "10d6" or "2d10 + 4"; 0 when unparseable.
	 *
	 * @param {string|number} expression dice expression
	 * @returns {number} average damage
	 */
	static _averageOfDiceExpression (expression) {
		if (expression == null) return 0;
		if (typeof expression === "number") return expression;
		const text = String(expression);
		let total = 0;
		let matched = false;
		text.replace(/(\d*)d(\d+)/gi, (m, count, faces) => {
			matched = true;
			total += (Number(count) || 1) * ((Number(faces) || 6) + 1) / 2;
			return m;
		});
		const flat = /(?:^|[+-])\s*(\d+)(?!\s*d)/i.exec(text.replace(/\d*d\d+/gi, ""));
		if (flat) total += Number(flat[1]);
		return matched || flat ? total : 0;
	}

	/**
	 * Psionics is a whole offence the spell path never sees — a Talent has no spell
	 * slots, so without this a level 20 psion rated below a level 5 fighter.
	 *
	 * @param {Object} state character state
	 * @returns {number} best sustainable psionic damage per round
	 */
	static _estimatePsionicDpr (state) {
		const calc = state?.getFeatureCalculations?.();
		if (!calc?.hasPsionicPowers) return 0;
		let best = 0;
		Object.entries(calc).forEach(([key, value]) => {
			if (!/damage$/i.test(key) || typeof value !== "string") return;
			best = Math.max(best, this._averageOfDiceExpression(value));
		});
		(state?.getFeatures?.() || []).forEach(feature => {
			if (feature?._entityType !== "psionicPower" && !/psionic|power/i.test(String(feature?.featureType || ""))) return;
			// A power's `description` is only its Manifestation Time/Range headers — the
			// effect lives in `modes`. Reading the wrong field credited a level 20 Talent
			// with none of its powers, and rated it three steps below the book's own
			// Master tier despite better HP and equal AC.
			const {primary} = this._getPsionicModes(feature);
			const body = this._stripHtmlTags(
				[...(primary?.entries || []), feature?.description || ""]
					.map(it => (typeof it === "string" ? it : JSON.stringify(it?.items || "")))
					.join(" "),
			);
			const dice = body.match(/\b\d+d\d+\b/g) || [];
			if (!dice.length) return;
			// DMG practice: an effect that catches an area is rated against two targets.
			const targets = /\beach creature\b|\b\d+-f(?:oo|ee)t (?:radius|cone|line|cube|sphere)/i.test(body) ? 2 : 1;
			dice.forEach(die => { best = Math.max(best, this._averageOfDiceExpression(die) * targets); });
		});
		// A manifestation is one action; the strain economy stops it every round.
		return best;
	}

	/**
	 * Damage the character adds to *every* qualifying hit — Rage, Divine Strike, a
	 * Crimson Rite, Sneak Attack and friends. The DMG counts these toward offensive CR,
	 * and omitting them is what rated martial builds two to three steps too low.
	 */
	static _estimatePerHitRiderDamage (state) {
		const calc = state?.getFeatureCalculations?.();
		if (!calc) return 0;

		const avgOf = value => {
			if (value == null) return 0;
			if (typeof value === "number") return value;
			const text = String(value);
			const dice = text.match(/(\d*)d(\d+)/i);
			if (dice) return (Number(dice[1]) || 1) * ((Number(dice[2]) || 6) + 1) / 2;
			const flat = text.match(/[+-]?\d+/);
			return flat ? Number(flat[0]) : 0;
		};

		// Once-per-turn riders count once; per-hit riders scale with the attack routine,
		// but crediting them once each keeps the estimate conservative.
		const keys = [
			"rageDamage", "divineStrikeDamage", "crimsonRiteDamage", "sneakAttackDamage",
			"primalStrikeDamage",
			"improvedDivineSmiteDamage", "hexbladeCurseDamage", "brutalStrikeDamage",
			"martialArtsBonusDamage", "huntersMarkDamage", "radiantStrikesDamage",
		];
		return keys.reduce((total, key) => total + avgOf(calc[key]), 0);
	}

	/**
	 * A build whose Bonus Action is another attack (Flurry of Blows, two-weapon fighting,
	 * Polearm Master) swings more times per round than its Multiattack says.
	 */
	static _getBonusActionAttackCount (state, attacksPerAction = 1) {
		const texts = [];
		[...(state?.getFeatures?.() || []), ...(state?.getCustomAbilities?.() || [])].forEach(f => {
			const body = `${f?.name || ""} ${this._stripHtmlTags(f?.description || "")}`;
			if (body.trim()) texts.push(body);
		});
		if (!texts.length) return 0;

		let extra = 0;
		const WORDS = {one: 1, two: 2, three: 3, four: 4};
		const PATTERNS = [
			// "as a Bonus Action, make two Unarmed Strikes"
			/\bbonus action\b[^.]{0,120}?\bmake (one|two|three|four|\d+)\b[^.]{0,60}?\b(?:attacks?|strikes?)\b/i,
			// "…make two Unarmed Strikes as a Bonus Action."
			/\bmake (one|two|three|four|\d+)\b[^.]{0,80}?\b(?:attacks?|strikes?)\b[^.]{0,60}?\bas a bonus action\b/i,
		];
		texts.forEach(body => {
			for (const re of PATTERNS) {
				const m = re.exec(body);
				if (!m) continue;
				const n = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
				if (Number.isFinite(n)) extra = Math.max(extra, n);
				break;
			}
		});
		// A single Bonus Action cannot beat the Attack action itself.
		return Math.min(extra, Math.max(1, attacksPerAction));
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
