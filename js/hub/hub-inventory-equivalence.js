import {isDeepEqual} from "./hub-json-patch.js";

export function getInventoryItemWithoutDeterministicAliases (item) {
	if (!item || typeof item !== "object" || Array.isArray(item)) return item;
	const out = structuredClone(item);
	const typeBase = String(out.type || out.typeCode || "").split("|")[0];
	if (out.typeCode === out.type) delete out.typeCode;
	if (isDeepEqual(out.properties, out.property)) delete out.properties;
	if (Object.hasOwn(out, "requiresAttunement") && out.reqAttune != null && out.requiresAttunement === !!out.reqAttune) {
		delete out.requiresAttunement;
	}
	for (const [suffix, ability] of [["Str", "str"], ["Dex", "dex"], ["Con", "con"], ["Int", "int"], ["Wis", "wis"], ["Cha", "cha"]]) {
		for (const family of ["bonusSavingThrow", "bonusAbilityCheck"]) {
			const aliasKey = `${family}${suffix}`;
			const canonicalKey = `${family}_${ability}`;
			if (Object.hasOwn(out, aliasKey) && out[aliasKey] === out[canonicalKey]) delete out[aliasKey];
		}
	}
	if (out.shield === (typeBase === "S")) delete out.shield;
	if (out.armor === ["LA", "MA", "HA"].includes(typeBase)) delete out.armor;
	const armorType = typeBase === "HA"
		? "heavy"
		: typeBase === "MA"
			? "medium"
			: typeBase === "LA"
				? "light"
				: null;
	if (armorType && out.armorType === armorType) delete out.armorType;
	if (
		out.weapon === true
		&& (out.type === "weapon" || ["M", "R"].includes(typeBase) || !!out.weaponCategory)
	) delete out.weapon;
	if (typeof out.charges === "number" && out.chargesCurrent === out.charges) delete out.chargesCurrent;
	for (const key of ["appliedUpgrades", "socketedGemstones"]) {
		if (Array.isArray(out[key]) && !out[key].length) delete out[key];
	}
	return out;
}

export function getCharacterDocumentWithoutDeterministicItemAliases (document) {
	if (!document || typeof document !== "object" || Array.isArray(document)) return document;
	const out = structuredClone(document);
	if (!Array.isArray(out.inventory)) return out;
	for (const row of out.inventory) {
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		if (!Object.hasOwn(row, "item")) continue;
		row.item = getInventoryItemWithoutDeterministicAliases(row.item);
	}
	return out;
}
