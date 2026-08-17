const _RE_SPECIAL_EQUIPMENT = /special equipment/i;

export function getNpcTrackerSpecialEquipmentEntries (monster) {
	const direct = _getDirectSpecialEquipmentEntries(monster?.specialEquipment);
	const traits = Array.isArray(monster?.trait) ? monster.trait : [];
	const specialTraits = traits.filter(entry => _RE_SPECIAL_EQUIPMENT.test(`${entry?.name ?? ""}`));
	const otherTraits = traits.filter(entry => !_RE_SPECIAL_EQUIPMENT.test(`${entry?.name ?? ""}`));
	return [...direct, ...specialTraits, ...otherTraits];
}

export function getNpcTrackerSpellSlotDefaults (monster) {
	const out = {};
	(monster?.spellcasting || []).forEach(spellcasting => {
		Object.entries(spellcasting?.spells || {}).forEach(([level, meta]) => {
			const levelNumber = Number(level);
			const slots = Number(meta?.slots);
			if (!Number.isInteger(levelNumber) || levelNumber < 1 || !Number.isFinite(slots) || slots < 1) return;
			const max = Math.floor(slots);
			if (!out[level] || out[level].max < max) out[level] = {current: max, max};
		});
	});
	return out;
}

export function getNpcTrackerChargeDefaults (monster) {
	const out = [];
	const seen = new Set();
	const add = ({name, max}) => {
		const cleanName = `${name ?? ""}`.replace(/\s+/g, " ").trim().replace(/^(?:a|an|the|his|her|its)\s+/i, "");
		const cleanMax = Math.floor(Number(max));
		if (!cleanName || !Number.isFinite(cleanMax) || cleanMax < 1) return;
		const key = cleanName.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		out.push({
			id: `auto:${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${cleanMax}`,
			name: cleanName.toTitleCase(),
			current: cleanMax,
			max: cleanMax,
			isAuto: true,
		});
	};

	const direct = monster?.specialEquipment;
	(Array.isArray(direct) ? direct : direct == null ? [] : [direct]).forEach(entry => {
		if (entry && typeof entry === "object" && entry.charges != null) add({name: entry.name || "Item", max: entry.charges});
	});

	const text = getNpcTrackerSpecialEquipmentEntries(monster)
		.filter(entry => _RE_SPECIAL_EQUIPMENT.test(`${entry?.name ?? ""}`))
		.flatMap(entry => _getEntryStrings(entry?.entries ?? entry))
		.map(it => Renderer.stripTags(it))
		.join(" ");
	const reCharges = /(?:^|[.;]\s*|\b(?:a|an|the|his|her|its)\s+)([a-z][a-z0-9 '\u2019-]{0,50}?)\s+(?:has|with)\s+(\d+)\s+charges?\b/gi;
	let match;
	while ((match = reCharges.exec(text))) add({name: match[1], max: match[2]});
	return out;
}

export function getNpcTrackerLegendaryResistanceDefault (monster) {
	const traits = Array.isArray(monster?.trait) ? monster.trait : [];
	for (const trait of traits) {
		const name = `${trait?.name ?? ""}`;
		if (!/legendary resistance/i.test(name)) continue;
		const match = name.match(/\(\s*(\d+)\s*\/\s*day\s*\)/i)
			|| Renderer.stripTags(_getEntryStrings(trait?.entries ?? trait).join(" ")).match(/(\d+)\s*\/\s*day/i);
		const max = match ? Math.floor(Number(match[1])) : 3;
		if (Number.isFinite(max) && max >= 1) return {current: max, max};
	}
	return null;
}

export function getNpcTrackerLegendaryActionDefault (monster) {
	if (!Array.isArray(monster?.legendary) || !monster.legendary.length) return null;
	const max = Math.floor(Number(monster?.legendaryActions));
	const clean = Number.isFinite(max) && max >= 1 ? max : 3;
	return {current: clean, max: clean};
}

export function getNpcTrackerRechargeDefaults (monster) {
	const out = [];
	const seen = new Set();
	const props = ["action", "trait", "legendary", "bonus", "reaction", "mythic"];
	const reRecharge = /\{@recharge\s*(\d?)[^}]*}/i;
	props.forEach(prop => {
		(Array.isArray(monster?.[prop]) ? monster[prop] : []).forEach(entry => {
			const haystack = `${entry?.name ?? ""} ${_getEntryStrings(entry?.entries ?? []).join(" ")}`;
			const match = haystack.match(reRecharge);
			if (!match) return;
			const min = match[1] ? Math.floor(Number(match[1])) : 6;
			if (!Number.isFinite(min) || min < 1 || min > 6) return;
			const cleanName = `${entry?.name ?? ""}`
				.replace(/\{@recharge\s*\d?[^}]*}/gi, "")
				.replace(/\s+/g, " ")
				.trim()
				|| "Recharge ability";
			const key = cleanName.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			out.push({
				id: `auto:recharge:${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${min}`,
				name: cleanName,
				min,
				isReady: true,
			});
		});
	});
	return out;
}

export function getNpcTrackerAttackBonus (entry) {
	const match = JSON.stringify(entry?.entries || []).match(/\{@hit\s+([+-]?\d+)(?:\|[^}]*)?}/i);
	if (!match) return null;
	const bonus = Number(match[1]);
	return Number.isFinite(bonus) ? bonus : null;
}

function _getDirectSpecialEquipmentEntries (specialEquipment) {
	if (specialEquipment == null) return [];
	return (Array.isArray(specialEquipment) ? specialEquipment : [specialEquipment])
		.map(entry => {
			if (typeof entry === "string") return {name: "Special Equipment", entries: [entry]};
			if (!entry || typeof entry !== "object") return null;
			if (entry.entries) return {...entry, name: entry.name || "Special Equipment"};
			return {name: entry.name || "Special Equipment", entries: [entry]};
		})
		.filter(Boolean);
}

function _getEntryStrings (entry) {
	if (typeof entry === "string") return [entry];
	if (Array.isArray(entry)) return entry.flatMap(_getEntryStrings);
	if (!entry || typeof entry !== "object") return [];
	return Object.values(entry).flatMap(_getEntryStrings);
}
