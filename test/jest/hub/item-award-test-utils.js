export function getCharacterSheetSavedInventory (inventory) {
	const out = structuredClone(inventory);
	for (const row of out) {
		const item = row.item;
		if (!item || typeof item !== "object") continue;
		if (item.typeCode == null && item.type != null) item.typeCode = item.type;
		if (item.requiresAttunement == null && item.reqAttune != null) item.requiresAttunement = !!item.reqAttune;
		if (item.properties == null && Array.isArray(item.property)) item.properties = structuredClone(item.property);
		for (const [suffix, ability] of [["Str", "str"], ["Dex", "dex"], ["Con", "con"], ["Int", "int"], ["Wis", "wis"], ["Cha", "cha"]]) {
			for (const family of ["bonusSavingThrow", "bonusAbilityCheck"]) {
				const storedKey = `${family}${suffix}`;
				const catalogKey = `${family}_${ability}`;
				if (item[storedKey] == null && item[catalogKey] != null) item[storedKey] = item[catalogKey];
			}
		}
		const typeBase = String(item.type || item.typeCode || "").split("|")[0];
		if (item.shield == null) item.shield = typeBase === "S";
		if (item.armor == null) item.armor = ["LA", "MA", "HA"].includes(typeBase);
		if (item.armorType == null && item.armor) {
			if (typeBase === "HA") item.armorType = "heavy";
			else if (typeBase === "MA") item.armorType = "medium";
			else if (typeBase === "LA") item.armorType = "light";
		}
		if (
			item.weapon !== true
			&& (item.type === "weapon" || ["M", "R"].includes(typeBase) || !!item.weaponCategory)
		) item.weapon = true;
		if (item.chargesCurrent == null && typeof item.charges === "number") item.chargesCurrent = item.charges;
		item.appliedUpgrades ||= [];
		item.socketedGemstones ||= [];
	}
	return out;
}
