export class CharacterSheetItemUtils {
	static isVariantComponent (item) {
		return !!(item?.variantComponent?.spellEffects?.length);
	}

	static isWeapon (item) {
		const typeBase = item?.type?.split("|")[0];
		return !!(item?.weapon || typeBase === "M" || typeBase === "R" || item?.weaponCategory);
	}

	static getItemType (item) {
		const typeBase = item?.type?.split("|")[0];
		if (this.isVariantComponent(item)) return "component";
		if (this.isWeapon(item)) return "weapon";
		if (item?.armor || ["LA", "MA", "HA"].includes(typeBase)) return "armor";
		if (typeBase === "S") return "armor";
		if (typeBase === "P") return "potion";
		if (typeBase === "SC") return "scroll";
		if (typeBase === "WD") return "wand";
		if (typeBase === "ST" || item?.staff) return "staff";
		if (typeBase === "RD") return "rod";
		if (typeBase === "RG") return "ring";
		if (item?.wondrous) return "wondrous";
		if (typeBase === "AT" || typeBase === "T") return "tool";
		if (typeBase === "G" || typeBase === "SCF") return "gear";
		if (typeBase === "$G" || item?._isEmpoweredGemstone) return "gemstone";
		return "gear";
	}

	/**
	 * Return the stable rules categories used by generated-item capacity and
	 * catalog-backed plan constraints. Generic variants derive their category
	 * from canonical `requires` metadata rather than their editable names.
	 */
	static getCanonicalItemKinds (item) {
		const sourceItem = item?._compositionRaw || item;
		if (!sourceItem || typeof sourceItem !== "object") return [];
		const out = new Set();
		const addType = rawType => {
			const type = String(rawType || "").split("|")[0].trim().toUpperCase();
			if (["M", "R", "AF"].includes(type)) out.add("weapon");
			else if (["LA", "MA", "HA"].includes(type)) out.add("armor");
			else if (type === "S") out.add("shield");
			else if (type === "WD") out.add("wand");
			else if (type === "ST") out.add("staff");
			else if (type === "RD") out.add("rod");
			else if (type === "RG") out.add("ring");
			else if (type === "P") out.add("potion");
			else if (type === "SC") out.add("scroll");
		};

		if (this.isWeapon(sourceItem)) out.add("weapon");
		if (sourceItem.armor) out.add("armor");
		addType(sourceItem.typeCode || sourceItem.type);
		for (const requirement of sourceItem.requires || []) {
			if (requirement?.weapon) out.add("weapon");
			if (requirement?.armor) out.add("armor");
			addType(requirement?.type);
		}
		if (sourceItem.wondrous) out.add("wondrous");
		if (!out.size) out.add("wondrous");
		return [...out];
	}

	static parseBonus (bonus) {
		if (bonus == null) return 0;
		if (typeof bonus === "number") return bonus;
		const parsed = parseInt(String(bonus).replace(/\s/g, ""), 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	static _hasGeneratedFeatureItemMarkers (item) {
		return item?._isGeneratedFeatureItem != null
			|| item?._generatedItemId != null
			|| item?._generatedItemProvenance != null;
	}

	/**
	 * Classify explicit magic facts. Generated feature items fail closed so editable
	 * names, rarity, and bonuses cannot override stale, malformed, or unrelated provenance.
	 *
	 * @param {object} item
	 * @param {object} [opts]
	 * @param {object|null} [opts.generatedItemClassification]
	 * @param {boolean} [opts.isGeneratedMagicItem]
	 * @returns {boolean}
	 */
	static isMagicItem (item, {
		generatedItemClassification = null,
		isGeneratedMagicItem = false,
	} = {}) {
		if (!item || typeof item !== "object") return false;

		if (this._hasGeneratedFeatureItemMarkers(item)) {
			return generatedItemClassification?.status === "valid" && isGeneratedMagicItem === true;
		}

		const typeBase = String(item.typeCode || item.type || "").split("|")[0].toUpperCase();
		const rarity = String(item.rarity || "").trim().toLowerCase();
		const hasMagicRarity = !!rarity && !["none", "unknown", "varies"].includes(rarity);
		const hasMagicBonus = [
			"bonusAc",
			"bonusWeapon",
			"bonusWeaponAttack",
			"bonusWeaponDamage",
			"bonusWeaponCritDamage",
			"bonusSpellAttack",
			"bonusSpellSaveDc",
			"bonusSpellDamage",
			"bonusSavingThrow",
			"bonusSavingThrowStr",
			"bonusSavingThrowDex",
			"bonusSavingThrowCon",
			"bonusSavingThrowInt",
			"bonusSavingThrowWis",
			"bonusSavingThrowCha",
			"bonusAbilityCheck",
			"bonusAbilityCheckStr",
			"bonusAbilityCheckDex",
			"bonusAbilityCheckCon",
			"bonusAbilityCheckInt",
			"bonusAbilityCheckWis",
			"bonusAbilityCheckCha",
			"bonusProficiencyBonus",
			"bonusSavingThrowConcentration",
		].some(prop => this.parseBonus(item[prop]) !== 0);

		return item.magical === true
			|| item.magic === true
			|| item._isMagicItem === true
			|| item._isMagicWeapon === true
			|| hasMagicRarity
			|| hasMagicBonus
			|| item.wondrous === true
			|| item.reqAttune === true
			|| item.requiresAttunement === true
			|| ["WD", "ST", "RG", "RD"].includes(typeBase)
			|| !!item._variantName;
	}

	static isMagicWeapon (item, opts = {}) {
		return this.isWeapon(item) && this.isMagicItem(item, opts);
	}

	static getNormalizedCatalogItem ({item, state}) {
		const sourceItem = item?._compositionRaw || item;
		const itemTypeBase = sourceItem.type?.split("|")[0];
		const isArmor = sourceItem.armor || ["LA", "MA", "HA"].includes(itemTypeBase);
		const armorType = itemTypeBase === "HA"
			? "heavy"
			: itemTypeBase === "MA"
				? "medium"
				: itemTypeBase === "LA"
					? "light"
					: null;
		const isShield = itemTypeBase === "S";

		return {
			name: sourceItem.name,
			source: sourceItem.source,
			quantity: 1,
			equipped: false,
			attuned: false,
			weight: sourceItem.weight || 0,
			value: sourceItem.value || 0,
			type: this.getItemType(sourceItem),
			typeCode: sourceItem.typeCode || sourceItem.type || null,
			scfType: sourceItem.scfType || null,
			requiresAttunement: sourceItem.requiresAttunement ?? sourceItem.reqAttune ?? false,
			weapon: this.isWeapon(sourceItem),
			weaponCategory: sourceItem.weaponCategory,
			baseItem: sourceItem.baseItem || null,
			damage: sourceItem.dmg1 ? `${state.getWeaponDamageDie(sourceItem)} ${Parser.dmgTypeToFull(sourceItem.dmgType)}` : null,
			dmg1: sourceItem.dmg1 || null,
			dmg2: sourceItem.dmg2 || null,
			handsUsed: sourceItem.dmg2 ? (Math.max(1, Math.floor(Number(sourceItem.handsUsed))) || 1) : 1,
			dmgType: sourceItem.dmgType || null,
			properties: sourceItem.properties || sourceItem.property || [],
			mastery: sourceItem.mastery || [],
			range: sourceItem.range ? `${sourceItem.range}` : null,
			reach: sourceItem.reach ?? null,
			bonusWeapon: this.parseBonus(sourceItem.bonusWeapon),
			bonusWeaponAttack: this.parseBonus(sourceItem.bonusWeaponAttack),
			bonusWeaponDamage: this.parseBonus(sourceItem.bonusWeaponDamage),
			magical: sourceItem.magical === true,
			magic: sourceItem.magic === true,
			countsAsMagical: sourceItem.countsAsMagical === true,
			_isMagicItem: sourceItem._isMagicItem === true,
			_isMagicWeapon: sourceItem._isMagicWeapon === true,
			wondrous: sourceItem.wondrous === true,
			armor: !!isArmor,
			armorType,
			ac: sourceItem.ac || null,
			dexterityMax: sourceItem.dexterityMax ?? null,
			stealth: sourceItem.stealth || false,
			strength: sourceItem.strength || null,
			shield: isShield,
			bonusAc: this.parseBonus(sourceItem.bonusAc),
			bonusSpellAttack: this.parseBonus(sourceItem.bonusSpellAttack),
			bonusSpellSaveDc: this.parseBonus(sourceItem.bonusSpellSaveDc),
			bonusSavingThrow: this.parseBonus(sourceItem.bonusSavingThrow),
			bonusSavingThrowStr: this.parseBonus(sourceItem.bonusSavingThrowStr ?? sourceItem.bonusSavingThrow_str),
			bonusSavingThrowDex: this.parseBonus(sourceItem.bonusSavingThrowDex ?? sourceItem.bonusSavingThrow_dex),
			bonusSavingThrowCon: this.parseBonus(sourceItem.bonusSavingThrowCon ?? sourceItem.bonusSavingThrow_con),
			bonusSavingThrowInt: this.parseBonus(sourceItem.bonusSavingThrowInt ?? sourceItem.bonusSavingThrow_int),
			bonusSavingThrowWis: this.parseBonus(sourceItem.bonusSavingThrowWis ?? sourceItem.bonusSavingThrow_wis),
			bonusSavingThrowCha: this.parseBonus(sourceItem.bonusSavingThrowCha ?? sourceItem.bonusSavingThrow_cha),
			bonusAbilityCheck: this.parseBonus(sourceItem.bonusAbilityCheck),
			bonusAbilityCheckStr: this.parseBonus(sourceItem.bonusAbilityCheckStr ?? sourceItem.bonusAbilityCheck_str),
			bonusAbilityCheckDex: this.parseBonus(sourceItem.bonusAbilityCheckDex ?? sourceItem.bonusAbilityCheck_dex),
			bonusAbilityCheckCon: this.parseBonus(sourceItem.bonusAbilityCheckCon ?? sourceItem.bonusAbilityCheck_con),
			bonusAbilityCheckInt: this.parseBonus(sourceItem.bonusAbilityCheckInt ?? sourceItem.bonusAbilityCheck_int),
			bonusAbilityCheckWis: this.parseBonus(sourceItem.bonusAbilityCheckWis ?? sourceItem.bonusAbilityCheck_wis),
			bonusAbilityCheckCha: this.parseBonus(sourceItem.bonusAbilityCheckCha ?? sourceItem.bonusAbilityCheck_cha),
			bonusProficiencyBonus: this.parseBonus(sourceItem.bonusProficiencyBonus),
			bonusSavingThrowConcentration: this.parseBonus(sourceItem.bonusSavingThrowConcentration),
			bonusSpellDamage: this.parseBonus(sourceItem.bonusSpellDamage),
			bonusWeaponCritDamage: this.parseBonus(sourceItem.bonusWeaponCritDamage),
			critThreshold: sourceItem.critThreshold || null,
			resist: sourceItem.resist || null,
			immune: sourceItem.immune || null,
			vulnerable: sourceItem.vulnerable || null,
			conditionImmune: sourceItem.conditionImmune || null,
			modifySpeed: sourceItem.modifySpeed || null,
			senses: sourceItem.senses || null,
			ability: sourceItem.ability || null,
			selectedAbilityChoices: sourceItem.selectedAbilityChoices ? MiscUtil.copyFast(sourceItem.selectedAbilityChoices) : null,
			attachedSpells: sourceItem.attachedSpells || null,
			spellScrollLevel: sourceItem.spellScrollLevel ?? null,
			selectedSpell: sourceItem.selectedSpell ? MiscUtil.copyFast(sourceItem.selectedSpell) : null,
			focus: sourceItem.focus ?? null,
			light: sourceItem.light ? MiscUtil.copyFast(sourceItem.light) : null,
			grantsLanguage: !!sourceItem.grantsLanguage,
			selectedLanguage: sourceItem.selectedLanguage || null,
			charges: sourceItem.charges ?? null,
			chargesCurrent: typeof sourceItem.charges === "number" ? sourceItem.charges : null,
			recharge: sourceItem.recharge || null,
			rechargeAmount: sourceItem.rechargeAmount || null,
			chargeName: sourceItem.chargeName || null,
			bonusDamageDice: sourceItem.bonusDamageDice || null,
			bonusDamageType: sourceItem.bonusDamageType || null,
			damageRiders: sourceItem.damageRiders ? MiscUtil.copyFast(sourceItem.damageRiders) : undefined,
			regeneration: sourceItem.regeneration ? MiscUtil.copyFast(sourceItem.regeneration) : null,
			spellImmunitySlots: sourceItem.spellImmunitySlots ? MiscUtil.copyFast(sourceItem.spellImmunitySlots) : null,
			chosenSpellImmunities: sourceItem.chosenSpellImmunities ? MiscUtil.copyFast(sourceItem.chosenSpellImmunities) : [],
			rarity: sourceItem.rarity,
			curse: sourceItem.curse || false,
			sentient: sourceItem.sentient || false,
			grantsProficiency: sourceItem.grantsProficiency || false,
			containerCapacity: sourceItem.containerCapacity || null,
			containedItems: sourceItem.containedItems ? MiscUtil.copyFast(sourceItem.containedItems) : [],
			vestigeTier: sourceItem.vestigeTier,
			storedSpells: sourceItem.storedSpells ? MiscUtil.copyFast(sourceItem.storedSpells) : [],
			maxSpellLevels: sourceItem.maxSpellLevels,
			material: sourceItem.material ? MiscUtil.copyFast(sourceItem.material) : undefined,
			appliedUpgrades: sourceItem.appliedUpgrades ? MiscUtil.copyFast(sourceItem.appliedUpgrades) : [],
			socketedGemstones: sourceItem.socketedGemstones ? MiscUtil.copyFast(sourceItem.socketedGemstones) : [],
			_variantName: sourceItem._variantName || null,
			_baseSource: sourceItem._baseSource || null,
			_variantSource: sourceItem._variantSource || null,
			iounHost: sourceItem.iounHost ? MiscUtil.copyFast(sourceItem.iounHost) : null,
			iounSettings: sourceItem.iounSettings ?? null,
			iounSet: sourceItem.iounSet ? MiscUtil.copyFast(sourceItem.iounSet) : [],
			iounBaseBonuses: sourceItem.iounBaseBonuses ? MiscUtil.copyFast(sourceItem.iounBaseBonuses) : null,
			variantComponent: sourceItem.variantComponent ? MiscUtil.copyFast(sourceItem.variantComponent) : null,
			effects: sourceItem.effects ? MiscUtil.copyFast(sourceItem.effects) : undefined,
			itemPowers: sourceItem.itemPowers ? MiscUtil.copyFast(sourceItem.itemPowers) : undefined,
			entries: sourceItem.entries ? MiscUtil.copyFast(sourceItem.entries) : null,
		};
	}
}

globalThis.CharacterSheetItemUtils = CharacterSheetItemUtils;
