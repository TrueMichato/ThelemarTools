import {
	cellToEntries,
	entriesToText,
	extractItemRefs,
	findNamedEntry,
	joinCreatureAndMaterialName,
	parseDc,
	parseNameAndQuantity,
	parseValueToCopper,
	parseWeightToPounds,
} from "./crafting-utils.js";
import {toCreatureRef} from "./resolve-creatures.js";

/**
 * Extracts harvestable materials from Hamund's Harvesting Handbook I/II/III.
 *
 * Every harvestable creature gets one table whose `name` is the creature and whose columns are
 * always `DC / Item / Description / Value / Weight / Crafting`. Anything else in `table`
 * (trinket tables, rules tables, spell lists) is ignored.
 */

const HARVEST_COL_LABELS = ["DC", "Item", "Description", "Value", "Weight", "Crafting"];

const _isHarvestTable = (table) => {
	const labels = table.colLabels || [];
	return labels.length === HARVEST_COL_LABELS.length
		&& labels.every((label, i) => label === HARVEST_COL_LABELS[i]);
};

/**
 * Tables whose name is not a creature — the handbooks reuse the harvest layout for a handful of
 * environmental/plant sections.
 */
const NON_CREATURE_TABLE_NAMES = new Set([
	"gems and minerals",
	"minerals",
	"plants",
	"trees",
]);

/**
 * @param {object[]} bookDatas Parsed Hamund handbook JSON.
 * @param {object} opts
 * @param {(ctx: object) => string[]} opts.fnDeriveEffectTags
 * @param {(name: string) => object|null} opts.fnResolveCreature
 * @param {object} opts.report Mutable collector for coverage diagnostics.
 * @returns {object[]} `craftingMaterial` entities.
 */
export function extractHamundMaterials (bookDatas, {fnDeriveEffectTags, fnResolveCreature, report}) {
	const out = [];

	for (const bookData of bookDatas) {
		for (const table of bookData.table || []) {
			if (!_isHarvestTable(table)) continue;

			const tableName = (table.name || "").trim();
			const isCreatureTable = !NON_CREATURE_TABLE_NAMES.has(tableName.toLowerCase());
			const creature = isCreatureTable ? fnResolveCreature(tableName) : null;
			if (isCreatureTable && !creature && !fnResolveCreature.isGeneric(tableName)) report.unresolvedCreatures.add(`${tableName} (${table.source})`);

			for (const row of table.rows || []) {
				if (!Array.isArray(row) || row.length < HARVEST_COL_LABELS.length) {
					report.skippedRows.push(`${table.source} \u2014 ${tableName}: malformed row`);
					continue;
				}

				const [cellDc, cellItem, cellDesc, cellValue, cellWeight, cellCrafting] = row;

				const {name: rawMaterialName, quantity, quantityRoll} = parseNameAndQuantity(cellItem);
				if (!rawMaterialName) {
					report.skippedRows.push(`${table.source} \u2014 ${tableName}: unnamed row`);
					continue;
				}

				// "[Type]" is the handbooks' placeholder for the creature variant the table covers.
				// Resolving it keeps age-graded materials ("Adult Dragon Tooth" vs "Ancient Dragon
				// Tooth") distinct instead of colliding on one name.
				const name = /^\[Type\]/i.test(rawMaterialName)
					? joinCreatureAndMaterialName(tableName, rawMaterialName.replace(/^\[Type\]\s*/i, ""))
					: rawMaterialName;

				const entries = cellToEntries(cellDesc);
				const usedIn = extractItemRefs(cellCrafting);
				const craftingText = entriesToText(cellCrafting);
				const useEntry = findNamedEntry(entries, /^Use\b/i);

				const ent = {
					name,
					source: table.source,
					page: table.page,
					materialCategory: isCreatureTable ? "creature part" : "mineral",
					harvest: {
						dc: parseDc(cellDc),
						quantity,
						...(quantityRoll ? {quantityRoll} : {}),
						...(isCreatureTable
							? {
								creature: toCreatureRef(tableName, creature),
								...(creature?.creatureType ? {creatureType: creature.creatureType} : {}),
								...(creature?.cr != null ? {cr: creature.cr} : {}),
							}
							: {}),
					},
					entries,
					usedIn,
					hasUseEffect: !!useEntry,
				};

				const value = parseValueToCopper(cellValue);
				if (value != null) ent.value = value;

				const weight = parseWeightToPounds(cellWeight);
				if (weight != null) ent.weight = weight;

				ent.effectTags = fnDeriveEffectTags({
					name: ent.name,
					source: ent.source,
					entries,
					extraText: craftingText,
				});

				out.push(ent);
			}
		}
	}

	return out;
}

/**
 * Extracts the "Craftable Item / Harvesting Material / Crafter" index tables, which give a
 * second, independent view of the material → craftable graph.
 *
 * @returns {{craftable: string, materials: string, crafter: string, source: string}[]}
 */
export function extractHamundCraftIndex (bookDatas) {
	const out = [];
	for (const bookData of bookDatas) {
		for (const table of bookData.table || []) {
			const labels = table.colLabels || [];
			if (labels.length !== 3 || labels[0] !== "Craftable Item" || labels[1] !== "Harvesting Material") continue;
			for (const row of table.rows || []) {
				if (!Array.isArray(row) || row.length < 3) continue;
				out.push({
					craftable: entriesToText(row[0]),
					craftableRefs: extractItemRefs(row[0]),
					materials: entriesToText(row[1]),
					crafter: entriesToText(row[2]),
					source: table.source,
				});
			}
		}
	}
	return out;
}
