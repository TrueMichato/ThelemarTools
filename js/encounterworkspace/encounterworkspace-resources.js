export const MAX_ENCOUNTER_RESOURCE_COUNT = 9999;
export const MAX_ENCOUNTER_RESOURCE_ENTRIES = 200;

const SECTIONS = ["trait", "action", "bonus", "reaction", "legendary", "mythic"];
const isRecord = value => value != null && typeof value === "object" && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_ENCOUNTER_RESOURCE_COUNT;
const isName = value => typeof value === "string" && !!value.trim() && value === value.trim() && value.length <= 120;
const isId = value => typeof value === "string" && !!value.trim() && value === value.trim() && value.length <= 180;
const hasKeys = (value, keys) => isRecord(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const getCount = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_ENCOUNTER_RESOURCE_COUNT ? value : null;

function getEntryText (entry) {
	if (typeof entry === "string") return entry;
	if (Array.isArray(entry)) return entry.map(getEntryText).join(" ");
	if (!isRecord(entry)) return "";
	return getEntryText(entry.entries || entry.entry || "");
}

export function getEncounterResourceDefaults (monster) {
	const spellSlots = {};
	for (const spellcasting of Array.isArray(monster?.spellcasting) ? monster.spellcasting : []) {
		for (const [level, details] of Object.entries(spellcasting?.spells || {})) {
			if (!/^[1-9]$/.test(level)) continue;
			const max = getCount(details?.slots);
			if (max && (!spellSlots[level] || spellSlots[level].max < max)) spellSlots[level] = {current: max, max};
		}
	}
	const abilities = [];
	const recharges = [];
	for (const section of SECTIONS) {
		(Array.isArray(monster?.[section]) ? monster[section] : []).forEach((entry, index) => {
			if (!isName(entry?.name)) return;
			const name = entry.name.trim();
			const recharge = `${name} ${getEntryText(entry.entries)}`.match(/\{@recharge(?:\s+([2-6]))?\s*}/i);
			if (recharge) {
				recharges.push({
					id: `auto:recharge:${section}:${index}`,
					name: name.replace(/\s*\{@recharge(?:\s+[2-6])?\s*}/gi, "").trim() || "Recharge ability",
					min: recharge[1] ? Number(recharge[1]) : 6,
					ready: true,
				});
				return;
			}
			const daily = name.match(/\((\d+)\/Day(?:\)|, or \d+\/Day in Lair\))/i);
			const max = daily ? getCount(Number(daily[1])) : null;
			if (max) abilities.push({id: `auto:ability:${section}:${index}`, name, current: max, max});
		});
	}
	const actions = getCount(monster?.legendaryActions)
		|| (Array.isArray(monster?.legendaryHeader)
			? getCount(Number(getEntryText(monster.legendaryHeader).match(/\bcan take (\d+) legendary actions\b/i)?.[1]))
			: null);
	if (actions) abilities.push({id: "auto:legendary-actions", name: "Legendary Actions", current: actions, max: actions});
	const equipment = monster?.specialEquipment;
	const seenEquipment = new Set();
	(Array.isArray(equipment) ? equipment : equipment == null ? [] : [equipment]).forEach((entry, index) => {
		const max = getCount(entry?.charges);
		if (max) {
			const name = isName(entry.name) ? entry.name.trim() : "Special Equipment";
			seenEquipment.add(name.toLowerCase());
			abilities.push({
				id: `auto:equipment:${index}`,
				name,
				current: max,
				max,
			});
		}
	});
	(Array.isArray(monster?.trait) ? monster.trait : [])
		.filter(entry => /^special equipment$/i.test(entry?.name?.trim()))
		.forEach((entry, index) => {
			const text = getEntryText(entry.entries);
			const re = /\b(?:the|an?)\s+([a-z][a-z0-9 '’-]{0,50}?)\s+(?:has|with)\s+(\d+)\s+charges?\b/gi;
			let match;
			while ((match = re.exec(text))) {
				const name = match[1].trim();
				const max = getCount(Number(match[2]));
				if (!max || seenEquipment.has(name.toLowerCase())) continue;
				seenEquipment.add(name.toLowerCase());
				abilities.push({id: `auto:equipment-trait:${index}:${match.index}`, name, current: max, max});
			}
		});
	return {spellSlots, abilities, recharges, concentration: {active: false, label: ""}};
}

export function validateEncounterResources (resources) {
	const invalid = () => { throw new Error("The saved encounter contains invalid combat resources. It has not been changed."); };
	if (!hasKeys(resources, ["spellSlots", "abilities", "recharges", "concentration"])
		|| !isRecord(resources.spellSlots) || !Array.isArray(resources.abilities)
		|| resources.abilities.length > MAX_ENCOUNTER_RESOURCE_ENTRIES
		|| !Array.isArray(resources.recharges) || resources.recharges.length > MAX_ENCOUNTER_RESOURCE_ENTRIES
		|| !hasKeys(resources.concentration, ["active", "label"])
		|| typeof resources.concentration.active !== "boolean"
		|| typeof resources.concentration.label !== "string" || resources.concentration.label.length > 120
		|| (!resources.concentration.active && resources.concentration.label)) invalid();
	for (const [level, slots] of Object.entries(resources.spellSlots)) {
		if (!/^[1-9]$/.test(level) || !hasKeys(slots, ["current", "max"])
			|| !isCount(slots.max) || !slots.max || !isCount(slots.current) || slots.current > slots.max) invalid();
	}
	const ids = new Set();
	for (const ability of resources.abilities) {
		if (!hasKeys(ability, ["id", "name", "current", "max"])
			|| !isId(ability.id) || ids.has(ability.id) || !isName(ability.name)
			|| !isCount(ability.max) || !ability.max || !isCount(ability.current) || ability.current > ability.max) invalid();
		ids.add(ability.id);
	}
	for (const recharge of resources.recharges) {
		if (!hasKeys(recharge, ["id", "name", "min", "ready"])
			|| !isId(recharge.id) || ids.has(recharge.id) || !isName(recharge.name)
			|| !Number.isInteger(recharge.min) || recharge.min < 2 || recharge.min > 6
			|| typeof recharge.ready !== "boolean") invalid();
		ids.add(recharge.id);
	}
}
