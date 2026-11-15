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

const getTagDisplay = inner => {
	const parts = inner.split("|");
	return (parts[2] || parts[0]).trim();
};

/** The display name of one entry in a spellcasting `daily` list, e.g. "Fireball" for "{@spell Fireball|XPHB} (level 4 version)". */
export function getEncounterDailySpellName (spell) {
	const text = typeof spell === "string" ? spell : spell?.entry;
	if (typeof text !== "string") return null;
	const tag = text.match(/\{@spell\s+([^}]*)}/i);
	const name = tag ? getTagDisplay(tag[1]) : text.replace(/\{@\w+\s+([^}]*)}/g, (_, inner) => getTagDisplay(inner)).trim();
	return name ? name.slice(0, 100) : null;
}

export const getEncounterDailySpellLabel = (name, max) => `${name.charAt(0).toUpperCase()}${name.slice(1)} (${max}/day)`;

/** `"3"` → 3/day, `"2e"` → 2/day each. Both give every spell in the row its own pips. */
export function getEncounterDailyUses (key) {
	const match = /^(\d+)(e?)$/.exec(key);
	const max = match ? getCount(Number(match[1])) : null;
	return max ? {max, isEach: !!match[2]} : null;
}

function getDailySpellAbilities (monster) {
	const abilities = [];
	(Array.isArray(monster?.spellcasting) ? monster.spellcasting : []).forEach((spellcasting, casterIndex) => {
		const daily = spellcasting?.daily;
		if (!isRecord(daily)) return;
		// A hidden list renders only as a named block, e.g. "Misty Step (3/Day).", so it gets one tracker on that heading.
		if (Array.isArray(spellcasting.hidden) && spellcasting.hidden.includes("daily")) {
			const name = isName(spellcasting.name?.trim?.()) ? spellcasting.name.trim() : null;
			const uses = Object.keys(daily).map(getEncounterDailyUses).filter(Boolean);
			const max = getCount(Number(name?.match(/\((\d+)\/Day\)/i)?.[1])) || (uses.length === 1 ? uses[0].max : null);
			if (name && max) abilities.push({id: `auto:daily-entry:${casterIndex}`, name, current: max, max});
			return;
		}
		// Highest uses first, matching the order the statblock lists them in.
		const rows = Object.entries(daily).map(([key, list]) => ({key, list, uses: getEncounterDailyUses(key)}))
			.filter(it => it.uses && Array.isArray(it.list))
			.sort((a, b) => b.uses.max - a.uses.max);
		for (const {key, list, uses} of rows) {
			list.filter(spell => !spell?.hidden).forEach((spell, index) => {
				const name = getEncounterDailySpellName(spell);
				if (name) abilities.push({id: `auto:daily:${casterIndex}:${key}:${index}`, name: getEncounterDailySpellLabel(name, uses.max), current: uses.max, max: uses.max});
			});
		}
	});
	return abilities;
}

/** Adds daily-spell trackers to resources saved before they existed, unless the instance already tracks any. */
export function withEncounterDailySpellDefaults (resources, monster) {
	if (resources.abilities.some(it => it.id.startsWith("auto:daily"))) return resources;
	const taken = new Set([...resources.abilities, ...resources.recharges].map(it => it.id));
	const added = getDailySpellAbilities(monster).filter(it => !taken.has(it.id));
	if (!added.length) return resources;
	return {...resources, abilities: [...resources.abilities, ...added].slice(0, MAX_ENCOUNTER_RESOURCE_ENTRIES)};
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
	// Like the site renderer, a legendary section with no count or header means the standard 3 uses (almost all MM/XMM data).
	const hasLegendary = Array.isArray(monster?.legendary) && monster.legendary.length > 0;
	const actions = getCount(monster?.legendaryActions)
		|| (Array.isArray(monster?.legendaryHeader)
			? getCount(Number(getEntryText(monster.legendaryHeader).match(/\bcan take (\d+) legendary actions\b/i)?.[1]))
			: hasLegendary && monster.legendaryActions == null ? 3 : null);
	if (actions) abilities.push({id: "auto:legendary-actions", name: "Legendary Actions", current: actions, max: actions});
	abilities.push(...getDailySpellAbilities(monster));
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
	return {spellSlots, abilities: abilities.slice(0, MAX_ENCOUNTER_RESOURCE_ENTRIES), recharges, concentration: {active: false, label: ""}};
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

export function getEncounterResourceSummary (resources) {
	const entries = [
		...(resources.concentration.active ? [`Concentrating${resources.concentration.label ? `: ${resources.concentration.label}` : ""}`] : []),
		...Object.entries(resources.spellSlots).map(([level, slots]) => `L${level} slots ${slots.current}/${slots.max}`),
		...resources.abilities.map(ability => `${ability.name} ${ability.current}/${ability.max}`),
		...resources.recharges.map(recharge => `${recharge.name}: ${recharge.ready ? "ready" : "spent"}`),
	];
	return [...entries.slice(0, 3), ...(entries.length > 3 ? [`+${entries.length - 3} more`] : [])].join(" · ");
}
