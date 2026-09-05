import fs from "node:fs";
import "../../js/parser.js";
import "../../js/utils.js";

describe("UrlUtil table-page hash builders", () => {
	const getBuilder = page => UrlUtil.URL_TO_HASH_BUILDER[page];
	const getFlattenedTables = groups => groups
		.map(group => group.tables.map(tbl => {
			const out = MiscUtil.copyFast(group);
			delete out.tables;
			Object.assign(out, MiscUtil.copyFast(tbl));
			return out;
		}))
		.flat();
	const getCollisionDiagnostics = ({builder, entities}) => {
		const entitiesByHash = {};
		entities.forEach(ent => (entitiesByHash[builder(ent)] ||= []).push({
			name: ent.name,
			source: ent.source,
			option: ent.option,
			minlvl: ent.minlvl,
			maxlvl: ent.maxlvl,
			caption: ent.caption,
			captionPrefix: ent.captionPrefix,
			captionSuffix: ent.captionSuffix,
		}));
		return Object.entries(entitiesByHash)
			.filter(([, ents]) => ents.length > 1)
			.map(([hash, ents]) => ({hash, entities: ents}));
	};
	const expectUniqueHashes = ({page, entities}) => {
		const collisions = getCollisionDiagnostics({builder: getBuilder(page), entities});
		if (collisions.length) throw new Error(`Hash collisions for ${page}:\n${JSON.stringify(collisions, null, 2)}`);
	};

	it("registers deterministic, URL-safe builders for both table pages", () => {
		const nameBuilder = getBuilder(UrlUtil.PG_NAMES);
		const encounterBuilder = getBuilder(UrlUtil.PG_ENCOUNTERGEN);

		expect(nameBuilder).toEqual(expect.any(Function));
		expect(encounterBuilder).toEqual(expect.any(Function));

		const nameTable = {name: "Gith", source: "MTF", option: "Githyanki, Female"};
		const encounterTable = {
			name: "Forgotten Realms Encounters",
			source: "FRAiF",
			caption: "Baldur's Gate Encounters",
		};

		expect(nameBuilder(nameTable)).toBe(nameBuilder(nameTable));
		expect(encounterBuilder(encounterTable)).toBe(encounterBuilder(encounterTable));
		expect(nameBuilder(nameTable)).toBe(UrlUtil.encodeArrayForHash("Gith", "MTF", "Githyanki, Female"));
		expect(encounterBuilder(encounterTable)).toBe(
			UrlUtil.encodeArrayForHash("Forgotten Realms Encounters", "FRAiF", "0-0-Baldur's Gate Encounters"),
		);
		expect(nameBuilder(nameTable)).not.toMatch(/[\s,#?]/);
		expect(encounterBuilder(encounterTable)).not.toMatch(/[\s,#?]/);
	});

	it("distinguishes name tables with the same name and source by option", () => {
		const builder = getBuilder(UrlUtil.PG_NAMES);
		const female = {name: "Dragonborn", source: "XGE", option: "Female"};
		const male = {...female, option: "Male"};

		expect(builder(female)).not.toBe(builder(male));
		expect(builder(female)).toBe(UrlUtil.encodeArrayForHash("Dragonborn", "XGE", "Female"));
		expect(builder(male)).toBe(UrlUtil.encodeArrayForHash("Dragonborn", "XGE", "Male"));
	});

	it("uses an empty option component when a name table omits its option", () => {
		const builder = getBuilder(UrlUtil.PG_NAMES);
		expect(builder({name: "Nameless", source: "TST"})).toBe(UrlUtil.encodeArrayForHash("Nameless", "TST", ""));
	});

	it("distinguishes encounter tables by level range and caption", () => {
		const builder = getBuilder(UrlUtil.PG_ENCOUNTERGEN);
		const arcticTier1 = {name: "Arctic", source: "XGE", minlvl: 1, maxlvl: 4};
		const arcticTier2 = {...arcticTier1, minlvl: 5, maxlvl: 10};
		const forgottenRealms = {name: "Forgotten Realms Encounters", source: "FRAiF"};
		const baldursGate = {...forgottenRealms, caption: "Baldur's Gate Encounters"};
		const calimDesert = {...forgottenRealms, caption: "Calim Desert Encounters"};

		expect(builder(arcticTier1)).not.toBe(builder(arcticTier2));
		expect(builder(arcticTier1)).toBe(UrlUtil.encodeArrayForHash("Arctic", "XGE", "1-4-"));
		expect(builder(arcticTier2)).toBe(UrlUtil.encodeArrayForHash("Arctic", "XGE", "5-10-"));

		expect(builder(baldursGate)).not.toBe(builder(calimDesert));
		expect(builder(baldursGate)).toBe(
			UrlUtil.encodeArrayForHash("Forgotten Realms Encounters", "FRAiF", "0-0-Baldur's Gate Encounters"),
		);
		expect(builder(calimDesert)).toBe(
			UrlUtil.encodeArrayForHash("Forgotten Realms Encounters", "FRAiF", "0-0-Calim Desert Encounters"),
		);
	});

	it("distinguishes encounter tables by caption prefix and suffix", () => {
		const builder = getBuilder(UrlUtil.PG_ENCOUNTERGEN);
		const planar = {name: "Planar Encounters", source: "MPP"};
		const chaotic = {...planar, captionPrefix: "Chaotic"};
		const lawful = {...planar, captionPrefix: "Lawful"};
		const sigil = {name: "Sigil", source: "SatO"};
		const clerksWard = {...sigil, captionSuffix: "Clerks' Ward"};
		const hiveWard = {...sigil, captionSuffix: "Hive Ward"};

		expect(builder(chaotic)).not.toBe(builder(lawful));
		expect(builder(clerksWard)).not.toBe(builder(hiveWard));
		expect(builder(chaotic)).toBe(UrlUtil.encodeArrayForHash("Planar Encounters", "MPP", "0-0-", "Chaotic", ""));
		expect(builder(clerksWard)).toBe(UrlUtil.encodeArrayForHash("Sigil", "SatO", "0-0-", "", "Clerks' Ward"));
	});

	it("generates unique hashes for every table in the names and encounters datasets", () => {
		const names = JSON.parse(fs.readFileSync("data/names.json", "utf8"));
		const encounters = JSON.parse(fs.readFileSync("data/encounters.json", "utf8"));
		const nameTables = getFlattenedTables(names.name);
		const encounterTables = getFlattenedTables(encounters.encounter);

		expect(nameTables).toHaveLength(61);
		expect(encounterTables).toHaveLength(93);
		expectUniqueHashes({page: UrlUtil.PG_NAMES, entities: nameTables});
		expectUniqueHashes({page: UrlUtil.PG_ENCOUNTERGEN, entities: encounterTables});
	});
});
