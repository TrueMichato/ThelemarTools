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

	static parseBonus (bonus) {
		if (bonus == null) return 0;
		if (typeof bonus === "number") return bonus;
		const parsed = parseInt(String(bonus).replace(/\s/g, ""), 10);
		return Number.isNaN(parsed) ? 0 : parsed;
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
