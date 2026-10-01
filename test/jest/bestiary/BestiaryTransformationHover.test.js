import fs from "node:fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import {getCreatureTransformationCandidates} from "../../../js/creature-transformations.js";
import {
	getCreatureTransformationGroupHoverEntries,
	getCreatureTransformationOptionHoverEntries,
} from "../../../js/bestiary/bestiary-transformation-editor.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../../../data/creature-transformations.json", import.meta.url), "utf8"));
const undead = getCreatureTransformationCandidates({catalog, races: [], getVersions: () => []})
	.find(it => it.id === "catalog:undead|scre");
const sourceLabel = source => source;

describe("creature transformation option and group rules hover", () => {
	it("identifies the provenance, selection policy, and both automatic and DM-only category effects", () => {
		const group = undead.optionGroups.find(it => it.id === "category");
		const entries = getCreatureTransformationGroupHoverEntries({candidate: undead, group, sourceLabel});
		expect(entries).toEqual(expect.arrayContaining([
			expect.stringContaining("Page unverified"),
			expect.stringContaining("Source attribution unverified"),
			expect.stringContaining("required before preview"),
			expect.stringContaining("Available choices: Ghostly, Skeletal, Vampiric"),
		]));
		const options = entries.find(it => it.name === "Options").entries;
		expect(options.map(it => it.name)).toEqual(group.options.map(it => it.name));
		const ghostly = options.find(it => it.name === "Ghostly");
		expect(ghostly.entries.find(it => it.name === "Automatic mechanical effects").entries).toContain("Halve Strength, rounding down (minimum 1)");
		expect(ghostly.entries.find(it => it.name?.startsWith("DM review")).entries).toContain("other: Replace movement with flight and hover; do not retain incompatible ground movement.");
	});

	it("keeps source-qualified nested trait text and manual-only notes in separate labeled sections", () => {
		const group = undead.optionGroups.find(it => it.id === "miscellaneous");
		const magic = group.options.find(it => it.id === "magic-resistance");
		const entries = getCreatureTransformationOptionHoverEntries({candidate: undead, group, option: magic, sourceLabel});
		expect(entries).toEqual(expect.arrayContaining([
			expect.stringContaining("Undead (SCRE) · Additional undead features · Magic Resistance"),
			expect.stringContaining("SCRE"),
			expect.stringContaining("DM approval required"),
		]));
		expect(entries.find(it => it.name === "Automatic mechanical effects").entries).toEqual([
			"Add trait Magic Resistance (SCRE)",
			{type: "entries", name: "Magic Resistance (SCRE)", entries: ["The creature has advantage on saving throws against spells and magical effects."]},
		]);
		const aura = getCreatureTransformationOptionHoverEntries({
			candidate: undead,
			group,
			option: group.options.find(it => it.id === "deathly-aura"),
			sourceLabel,
		});
		expect(aura).toContain("No automatic mechanical change.");
		expect(aura.find(it => it.name?.startsWith("DM review")).entries)
			.toContain("traits: Resolve aura range and damage with the DM.");
	});
});
