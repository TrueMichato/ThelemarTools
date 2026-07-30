import {
	entriesToText,
	findNamedEntryText,
	parseDc,
} from "./crafting-utils.js";

/**
 * Extracts herbs from Hamund's Herbalism Handbook.
 *
 * Herbs are already `item` entries (`type: "Herb"`, `property: ["Hrb"]`) carrying their biome in
 * `customProperties.lcn` and whether they need preparing in `customProperties.prep`. Their
 * mechanical text lives in an `Effect:` sub-entry.
 */
export function extractHerbs (herbalismData, {fnDeriveEffectTags, report}) {
	const out = [];

	for (const item of herbalismData.item || []) {
		const isHerb = item.type === "Herb" || `${item.type}`.startsWith("Herb|") || (item.property || []).includes("Hrb");
		if (!isHerb) continue;

		const cp = item.customProperties || {};

		const ent = {
			name: item.name,
			source: item.source,
			page: item.page,
			materialCategory: "herb",
			harvest: {
				dc: null,
				quantity: 1,
				...(cp.lcn ? {biome: cp.lcn} : {}),
				requiresPreparation: `${cp.prep}`.toLowerCase() === "yes",
			},
			entries: item.entries || [],
			usedIn: [],
		};

		if (item.value != null) ent.value = item.value;
		if (item.weight != null) ent.weight = item.weight;
		if (item.rarity && item.rarity !== "none" && item.rarity !== "unknown") ent.rarity = item.rarity;

		ent.effectTags = fnDeriveEffectTags({
			name: ent.name,
			source: ent.source,
			entries: [
				findNamedEntryText(item.entries, /^Effect/i),
				entriesToText(item.entries),
			].join(" "),
		});

		out.push(ent);
	}

	// The handbook's summary table is the authoritative source for harvest DCs by environment
	_applyHerbTableData(herbalismData, out, report);

	return out;
}

/**
 * The "Herb / Environment / Value / Requires Preparation" summary table backfills anything the
 * item entries leave implicit.
 */
function _applyHerbTableData (herbalismData, herbs, report) {
	const byName = new Map(herbs.map(herb => [herb.name.toLowerCase(), herb]));

	for (const table of herbalismData.table || []) {
		const labels = table.colLabels || [];
		if (labels[0] !== "Herb" || !labels.includes("Environment")) continue;

		const ixEnv = labels.indexOf("Environment");
		const ixPrep = labels.findIndex(it => /Requires Preparation/i.test(it));

		for (const row of table.rows || []) {
			if (!Array.isArray(row)) continue;
			const herbName = entriesToText(row[0]).toLowerCase().trim();
			const herb = byName.get(herbName);
			if (!herb) {
				report.skippedRows.push(`${table.source} \u2014 herb summary table: no item for "${herbName}"`);
				continue;
			}
			if (ixEnv >= 0 && !herb.harvest.biome) herb.harvest.biome = entriesToText(row[ixEnv]);

			// The table abbreviates to "Y"/"N"; anything unrecognised leaves the item's own value alone
			if (ixPrep >= 0) {
				const prepText = entriesToText(row[ixPrep]).trim();
				if (/^y/i.test(prepText)) herb.harvest.requiresPreparation = true;
				else if (/^n/i.test(prepText)) herb.harvest.requiresPreparation = false;
			}
		}
	}
}

/**
 * Extracts Arcadia 11's base cooking ingredients.
 *
 * These are `type: "FD"` items *without* a `SimRep`/`SpeRep` recipe property; their shelf life and
 * harvesting DC live in named sub-entries.
 */
export function extractArcadiaIngredients (arcadia11Data, {fnDeriveEffectTags, report}) {
	const out = [];

	for (const item of arcadia11Data.item || []) {
		if (item.type !== "FD") continue;
		if ((item.property || []).some(prop => prop === "SimRep" || prop === "SpeRep")) continue;

		const shelfLife = findNamedEntryText(item.entries, /^Shelf Life/i).trim();
		const harvestDcText = findNamedEntryText(item.entries, /^Harvesting DC/i);

		const ent = {
			name: item.name,
			source: item.source,
			page: item.page,
			materialCategory: "food ingredient",
			harvest: {
				dc: parseDc(harvestDcText),
				quantity: 1,
				...(shelfLife ? {shelfLife: shelfLife.toLowerCase()} : {}),
			},
			entries: item.entries || [],
			usedIn: [],
		};

		if (item.value != null) ent.value = item.value;
		if (item.weight != null) ent.weight = item.weight;

		ent.effectTags = fnDeriveEffectTags({
			name: ent.name,
			source: ent.source,
			entries: item.entries,
			extraText: "food ingredient cooking",
		});

		out.push(ent);
	}

	return out;
}
