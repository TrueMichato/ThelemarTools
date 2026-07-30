import {
	entriesToText,
	extractCreatureRefs,
	extractItemRefs,
	parseValueToCopper,
} from "./crafting-utils.js";
import {toCreatureRef} from "./resolve-creatures.js";

/**
 * Extracts crafting materials and creature-part mappings from The Complete Crafter.
 *
 * Complete Crafter is entirely `variantrule`-shaped: named materials live as nested entries under
 * "Crafting Material Descriptions", and the creature → parts mapping lives in tables nested under
 * "Parts by Creature".
 */

/** Group name → `materialCategory`. */
const GROUP_TO_CATEGORY = {
	"Creature Materials": "creature part",
	"Minerals": "mineral",
	"Non-Mineral Materials": "mineral",
	"Plants and Herbs": "herb",
};

const _findRule = (data, name) => (data.variantrule || []).find(it => it.name === name);

/**
 * Named materials — "Bone", "Adamantine", "Darkwood", … — each described with `{@b Unit value:}`,
 * `{@b Armor:}`, `{@b Weapon:}` and `{@b Other:}` lines.
 */
export function extractCompleteCrafterMaterials (completeCrafterData, {fnDeriveEffectTags, report}) {
	const rule = _findRule(completeCrafterData, "Crafting Material Descriptions");
	if (!rule) {
		report.errors.push(`Complete Crafter: could not find the "Crafting Material Descriptions" rule`);
		return [];
	}

	const out = [];

	for (const group of rule.entries || []) {
		if (typeof group !== "object" || !group.name) continue;
		const materialCategory = GROUP_TO_CATEGORY[group.name] || "other";

		for (const material of group.entries || []) {
			if (typeof material !== "object") continue;

			// The "Plants and Herbs" group is a summary table rather than a list of named entries
			if (material.type === "table") {
				out.push(..._extractPlantTable(material, {source: rule.source, page: rule.page, fnDeriveEffectTags, report}));
				continue;
			}

			if (!material.name) continue;

			const text = entriesToText(material.entries);
			const ent = {
				name: material.name,
				source: rule.source,
				page: rule.page,
				materialCategory,
				harvest: {
					dc: null,
					quantity: 1,
					...(/Determined by the creature's CR/i.test(text) ? {valueByCr: true} : {}),
				},
				entries: material.entries || [],
				usedIn: extractItemRefs(material.entries),
			};

			const value = parseValueToCopper(_getLabelledLine(material.entries, /Unit value/i));
			if (value != null) ent.value = value;

			ent.effectTags = fnDeriveEffectTags({
				name: ent.name,
				source: ent.source,
				entries: material.entries,
				extraText: "crafting material",
			});

			out.push(ent);
		}
	}

	return out;
}

function _extractPlantTable (table, {source, page, fnDeriveEffectTags, report}) {
	const labels = table.colLabels || [];
	const ixValue = labels.findIndex(it => /Unit Value/i.test(it));
	const ixUse = labels.findIndex(it => /Alchemy Use/i.test(it));

	return (table.rows || [])
		.map(row => {
			if (!Array.isArray(row)) return null;
			const name = entriesToText(row[0]).trim();
			if (!name) return null;

			const useText = ixUse >= 0 ? entriesToText(row[ixUse]) : "";
			const entries = useText && useText !== "—" ? [`{@b Alchemy Use:} ${entriesToText(row[ixUse])}`] : [];

			const ent = {
				name,
				source,
				page,
				materialCategory: "herb",
				harvest: {dc: null, quantity: 1},
				entries,
				usedIn: ixUse >= 0 ? extractItemRefs(row[ixUse]) : [],
			};

			const value = ixValue >= 0 ? parseValueToCopper(row[ixValue]) : null;
			if (value != null) ent.value = value;

			ent.effectTags = fnDeriveEffectTags({
				name,
				source,
				entries,
				extraText: `${useText} crafting material alchemy`,
			});

			return ent;
		})
		.filter(Boolean);
}

/**
 * Maps a raw part name from "Parts by Creature" onto the Complete Crafter material it feeds into,
 * so these entries connect to the "Crafting Material Descriptions" rules.
 */
const PART_NAME_TO_MATERIAL = [
	[/\bbones?\b|\bskeleton\b|\bskull\b|\bhorns?\b|\bantlers?\b|\btusks?\b|\bteeth\b|\btooth\b|\bclaws?\b|\bfangs?\b|\bstingers?\b|\bspines?\b|\bbeak\b/i, "Bone"],
	[/\bchitin\b|\bcarapace\b|\bshells?\b|\bexoskeleton\b/i, "Chitin"],
	[/\bscales?\b/i, "Monster Scales"],
	[/\bfeathers?\b|\bplumage\b|\bwings?\b/i, "Monster Feathers"],
	[/\bhides?\b|\bskin\b|\bleather\b|\bpelt\b|\bfur\b/i, "Ellond Hide"],
	[/\bsilk\b|\bwebbing\b|\bweb\b/i, "Shadowsilk"],
	[/\bessence\b|\bectoplasm\b|\bichor\b|\bsoul\b/i, "Creature Essence"],
];

const _getPartMaterial = (partName) => PART_NAME_TO_MATERIAL.find(([re]) => re.test(partName))?.[1] ?? null;

function _getLabelledLine (entries, labelPattern) {
	for (const entry of entries || []) {
		if (typeof entry !== "string") continue;
		if (labelPattern.test(entry)) return entry;
	}
	return null;
}

/**
 * The "Parts by Creature" tables, which map a creature to a free-text list of harvestable parts
 * such as `"1 brain; 4 hide; 1 mucous; 1 tail; 1d4 teeth; 3 tentacles"`.
 *
 * @returns {object[]} `craftingMaterial` entities, one per creature/part pair.
 */
export function extractCompleteCrafterCreatureParts (completeCrafterData, {fnDeriveEffectTags, fnResolveCreature, report}) {
	const rule = _findRule(completeCrafterData, "Parts by Creature");
	if (!rule) {
		report.errors.push(`Complete Crafter: could not find the "Parts by Creature" rule`);
		return [];
	}

	const out = [];

	for (const group of rule.entries || []) {
		if (typeof group !== "object" || !group.name) continue;

		for (const table of group.entries || []) {
			if (table?.type !== "table") continue;
			const labels = table.colLabels || [];
			if (labels[0] !== "Creature" || !labels.some(it => /Harvestable Parts/i.test(it))) continue;

			for (const row of table.rows || []) {
				if (!Array.isArray(row) || row.length < 2) continue;

				const creatureRefs = extractCreatureRefs(row[0]);
				const creatureName = creatureRefs[0]?.name || entriesToText(row[0]).trim();
				if (!creatureName) continue;

				const resolved = fnResolveCreature(creatureName);
				if (!resolved && !fnResolveCreature.isGeneric(creatureName)) report.unresolvedCreatures.add(`${creatureName} (${rule.source})`);

				const partsText = entriesToText(row[1]).trim();
				if (!partsText || partsText === "—") continue;

				for (const part of _parseParts(partsText)) {
					const materialKind = _getPartMaterial(part.name);
					// Book prose is lowercase ("1 brain; 4 hide"); title-case so these read
					// consistently alongside the handbooks' named materials.
					const partName = part.name.toTitleCase();

					const ent = {
						name: `${creatureName} ${partName}`.replace(/\s+/g, " "),
						source: rule.source,
						page: rule.page,
						materialCategory: "creature part",
						...(materialKind ? {materialKind} : {}),
						harvest: {
							dc: null,
							quantity: part.quantity,
							...(part.quantityRoll ? {quantityRoll: part.quantityRoll} : {}),
							creature: toCreatureRef(creatureName, resolved),
							...(resolved?.creatureType ? {creatureType: resolved.creatureType} : {}),
							...(resolved?.cr != null ? {cr: resolved.cr} : {}),
						},
						entries: [
							`${part.quantityLabel} ${part.name} harvestable from {@creature ${resolved?.name ?? creatureName}${resolved?.source ? `|${resolved.source}` : ""}}.`,
							...(materialKind ? [`Counts as {@b ${materialKind}} for the {@variantrule Crafting Material Descriptions|COMCRAF} rules.`] : []),
						],
						usedIn: [],
						hasUseEffect: false,
					};

					ent.effectTags = fnDeriveEffectTags({
						name: ent.name,
						source: ent.source,
						entries: ent.entries,
						extraText: `crafting material harvested part ${materialKind || ""}`,
					});
					out.push(ent);
				}
			}
		}
	}

	return out;
}

/** `"1 brain; 4 hide; 1d4 teeth"` → `[{name: "brain", quantity: 1}, …]` */
function _parseParts (partsText) {
	return partsText
		.split(/\s*;\s*/)
		.map(part => part.trim())
		.filter(part => part && part !== "—")
		.map(part => {
			const mRoll = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(.*)$/i.exec(part);
			if (mRoll) return {name: mRoll[2].trim(), quantity: null, quantityRoll: mRoll[1].replace(/\s+/g, ""), quantityLabel: mRoll[1]};

			const mNum = /^(\d+)\s+(.*)$/.exec(part);
			if (mNum) return {name: mNum[2].trim(), quantity: Number(mNum[1]), quantityRoll: null, quantityLabel: mNum[1]};

			return {name: part, quantity: 1, quantityRoll: null, quantityLabel: "1"};
		})
		.filter(part => part.name);
}
