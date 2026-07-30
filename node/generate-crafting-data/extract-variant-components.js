import {
	entriesToText,
	extractCreatureRefs,
	extractSpellRefs,
	parseDc,
	parseNameAndQuantity,
} from "./crafting-utils.js";
import {toCreatureRef} from "./resolve-creatures.js";

/**
 * Extracts Arcadia 8 variant spell components.
 *
 * `data/items-variant-components-ar8.json` is the character sheet's source of truth for these and
 * is only ever *read* here — it already carries a structured `variantComponent` block. The Arcadia
 * 8 book itself supplies the per-creature component tables, which we use to backfill quantities
 * and harvest times for anything the converted file is missing.
 */

const COMPONENT_COL_LABELS = ["Monster", "Component", "Quantity Available", "Harvesting DC"];

const _isComponentTable = (table) => {
	const labels = table.colLabels || [];
	return labels.length === COMPONENT_COL_LABELS.length
		&& labels.every((label, i) => label === COMPONENT_COL_LABELS[i]);
};

/** DC → harvesting time, from the Arcadia 8 "Harvesting Time Table". */
function _buildHarvestTimeLookup (arcadia8Data) {
	const table = (arcadia8Data.table || []).find(it => it.name === "Harvesting Time Table");
	if (!table) return () => null;

	const bands = (table.rows || [])
		.map(row => {
			const rangeText = entriesToText(row[0]);
			const m = /(\d+)\s*[–-]\s*(\d+)/.exec(rangeText) || /^(\d+)\+?$/.exec(rangeText.trim());
			if (!m) return null;
			return {min: Number(m[1]), max: m[2] != null ? Number(m[2]) : Infinity, time: entriesToText(row[1])};
		})
		.filter(Boolean);

	return (dc) => (dc == null ? null : bands.find(band => dc >= band.min && dc <= band.max)?.time ?? null);
}

/**
 * Row-level metadata from the Arcadia 8 component tables, keyed by a loose
 * `<creature>::<component>` signature so it can be matched against the converted item names.
 */
function _buildTableMeta (arcadia8Data) {
	const out = new Map();
	for (const table of arcadia8Data.table || []) {
		if (!_isComponentTable(table)) continue;
		const creatureType = (table.name || "").replace(/\s*Components$/i, "").trim();
		for (const row of table.rows || []) {
			if (!Array.isArray(row) || row.length < 4) continue;
			const creatureRefs = extractCreatureRefs(row[0]);
			const creatureName = creatureRefs[0]?.name || entriesToText(row[0]);
			const component = entriesToText(row[1]).trim();
			const {quantity} = parseNameAndQuantity(entriesToText(row[2]));
			out.set(`${creatureName.toLowerCase()}::${component.toLowerCase()}`, {
				creature: creatureRefs[0] || {name: creatureName, source: null},
				creatureType: creatureType.toLowerCase(),
				quantity: Number(entriesToText(row[2]).trim()) || quantity || 1,
				dc: parseDc(row[3]),
			});
		}
	}
	return out;
}

/**
 * Converted component names read like `"Piece of Aboleth Brain"` / `"Aboleth Eye"`, while the book
 * table splits them into `Aboleth` + `Piece of Brain`. Rebuild the table key from both.
 */
function _findTableMeta (tableMeta, {name, harvestSource}) {
	if (!harvestSource) return null;
	const creature = harvestSource.toLowerCase();

	const direct = tableMeta.get(`${creature}::${name.toLowerCase()}`);
	if (direct) return direct;

	// Strip the creature name out of the component name: "Piece of Aboleth Brain" → "Piece of Brain"
	const stripped = name
		.replace(new RegExp(harvestSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
		.replace(/\s+/g, " ")
		.trim();
	return tableMeta.get(`${creature}::${stripped.toLowerCase()}`) || null;
}

/**
 * @param {object[]} componentSources Any parsed sources carrying `variantComponent`-bearing items —
 *   `data/items-variant-components-ar8.json` and any homebrew that adds its own components.
 * @param {object} arcadia8Data Parsed Arcadia Issue 8 homebrew, for the harvest-time table.
 */
export function extractVariantComponents (componentSources, arcadia8Data, {fnDeriveEffectTags, fnResolveCreature, report}) {
	const fnGetHarvestTime = _buildHarvestTimeLookup(arcadia8Data);
	const tableMeta = _buildTableMeta(arcadia8Data);

	const out = [];

	const items = componentSources
		.flatMap(src => src?.item || [])
		.filter(item => item.variantComponent?.spellEffects?.length);

	for (const item of items) {
		const vc = item.variantComponent || {};
		const meta = _findTableMeta(tableMeta, {name: item.name, harvestSource: vc.harvestSource});

		const creatureName = vc.harvestSource || meta?.creature?.name || null;
		const resolved = creatureName ? fnResolveCreature(creatureName) : null;
		if (creatureName && !resolved && !fnResolveCreature.isGeneric(creatureName)) report.unresolvedCreatures.add(`${creatureName} (${item.source})`);

		const dc = vc.harvestDC ?? meta?.dc ?? null;

		// Arcadia 8 writes some quantities as prose ("5 vials"); keep the count numeric and the
		// unit alongside it, so the page can render "5 vials" without the filters seeing a string.
		const rawQuantity = vc.harvestQuantity ?? meta?.quantity ?? 1;
		const mQuantity = typeof rawQuantity === "string" ? /^\s*(\d+)\s*(.*)$/.exec(rawQuantity) : null;
		const quantity = mQuantity ? Number(mQuantity[1]) : (typeof rawQuantity === "number" ? rawQuantity : 1);
		const quantityUnit = mQuantity?.[2]?.trim() || null;

		const ent = {
			name: item.name,
			source: item.source,
			page: item.page,
			materialCategory: "spell component",
			harvest: {
				dc,
				quantity,
				...(quantityUnit ? {quantityUnit} : {}),
				time: vc.harvestTime || fnGetHarvestTime(dc),
				...(creatureName
					? {
						creature: toCreatureRef(creatureName, resolved),
						...(resolved?.creatureType ? {creatureType: resolved.creatureType} : {}),
						...(resolved?.cr != null ? {cr: resolved.cr} : {}),
					}
					: {}),
			},
			entries: item.entries || [],
			usedIn: [],
			variantComponent: item.variantComponent,
			spells: (vc.spellEffects || [])
				.map(se => se.match?.spell)
				.filter(Boolean)
				.map(uid => {
					const [name, source] = `${uid}`.split("|");
					return {name, source: source || "PHB"};
				}),
		};

		if (!ent.spells.length) {
			const inline = extractSpellRefs(item.entries);
			if (inline.length) ent.spells = inline;
		}

		if (item.value != null) ent.value = item.value;
		if (item.weight != null) ent.weight = item.weight;

		ent.effectTags = fnDeriveEffectTags({
			name: ent.name,
			source: ent.source,
			entries: item.entries,
			variantComponent: item.variantComponent,
		});

		out.push(ent);
	}

	return out;
}
