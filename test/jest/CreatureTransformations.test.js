import fs from "node:fs";

import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-config.js";
import "../../js/utils-dataloader.js";

import {getCreatureTransformationCandidates, pLoadCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {
	getCreatureTransformationCorpusErrors,
	getCreatureTransformationIdentityErrors,
	getCreatureTransformationSchemaErrors,
	getCreatureTransformationValidator,
} from "../util-creature-transformation-schema.js";

const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const templates = JSON.parse(fs.readFileSync("data/bestiary/template.json", "utf8")).monsterTemplate;
const byId = (name, source) => catalog.creatureTransformation.find(it => it.name === name && it.source === source);
const options = (name, source, group) => byId(name, source)?.optionGroups.find(it => it.id === group)?.options.map(it => it.id);

describe("app-owned creature transformation schema and source corpus", () => {
	it("accepts the complete curated catalog", () => {
		expect(getCreatureTransformationCorpusErrors()).toEqual([]);
	});

	it("rejects executable, untyped, unsupported, and improperly attributed data", () => {
		const validate = getCreatureTransformationValidator();
		const recipe = byId("Skeleton", "DMG");
		for (const changed of [
			{...recipe, _copy: {name: "Skeleton", source: "MM"}},
			{...recipe, changes: [{op: "setProp", prop: "__proto__.evil", value: 1}]},
			{...recipe, changes: [{op: "grantImmunity", value: "all damage"}]},
			{...recipe, changes: [{op: "removeEntry", section: "action", match: {name: "Bite"}}]},
			{...recipe, provenance: {edition: "classic", evidence: "published"}},
			{...recipe, provenance: {edition: "unverified", evidence: "user-screenshot", page: 12}},
			{...recipe, optionGroups: [{id: "x", name: "x", selection: "one", required: true, options: [{id: "a", name: "a", changes: [], manualReview: [], code: "alert(1)"}]}]},
		]) {
			expect(getCreatureTransformationSchemaErrors({data: {creatureTransformation: [changed]}, filePath: "invalid", validate})).not.toEqual([]);
		}
	});

	it("rejects duplicate source-qualified IDs, groups, and options", () => {
		const data = {creatureTransformation: [byId("Skeleton", "DMG"), {...byId("Skeleton", "DMG"), name: "sKeLeToN"}]};
		expect(getCreatureTransformationIdentityErrors({data, filePath: "fixture"})).toEqual(expect.arrayContaining([expect.stringContaining("duplicate creature transformation identity")]));
		const recipe = structuredClone(byId("Fey Beast", "SCRE"));
		recipe.optionGroups[0].options.push(structuredClone(recipe.optionGroups[0].options[0]));
		expect(getCreatureTransformationIdentityErrors({data: {creatureTransformation: [recipe]}, filePath: "fixture"})).toEqual(expect.arrayContaining([expect.stringContaining("duplicate option")]));
	});

	it("has every requested family with verified page and edition, or an explicit unverified screenshot", () => {
		const requested = [
			["Half-Dragon", "MM", 180], ["Shadow Dragon", "MM", 84], ["Dracolich", "MM", 83],
			["Spore Servant", "MM", 230], ["Vampire", "MM", 297], ["Lycanthropy", "MM", 207],
			["Zombie", "DMG", 282], ["Skeleton", "DMG", 282],
			["Wereshark", "Arcadia27", 13], ["Skeletal Wyrmling", "Ar8", 20], ["Shadow Dragon", "BEG", 25],
			["Undead", "SCRE", null], ["Fey Beast", "SCRE", null], ["Fallen Angel", "SCRE", null],
		];
		for (const [name, source, page] of requested) {
			const recipe = byId(name, source);
			expect(recipe).toBeDefined();
			if (page == null) expect(recipe.provenance).toEqual({edition: "unverified", evidence: "user-screenshot"});
			else {
				expect(recipe.provenance.page).toBe(page);
				expect(recipe.provenance.edition).toBe("classic");
			}
		}
		expect(byId("Shadow Dragon", "BEG").provenance.evidence).toBe("published-example");
	});

	it("locks every depicted option and major official variant against accidental omission", () => {
		expect(options("Half-Dragon", "MM", "ancestry")).toEqual(["black", "blue", "brass", "bronze", "copper", "gold", "green", "red", "silver", "white"]);
		expect(options("Half-Dragon", "MM", "size")).toEqual(["large-or-smaller", "huge", "gargantuan"]);
		expect(options("Lycanthropy", "MM", "form")).toEqual(["werebear", "wereboar", "wererat", "weretiger", "werewolf"]);
		expect(options("Vampire", "MM", "outcome")).toEqual(["vampire", "spawn"]);
		expect(options("Fey Beast", "SCRE", "features")).toEqual(["barkskin", "fey-touched", "entangle", "spike-growth", "natural-camouflage", "plant-stride", "rooted", "tree-stride", "nature-sense", "teleport"]);
		expect(options("Fallen Angel", "SCRE", "allegiance")).toEqual(["fallen", "devilsworn"]);
		expect(options("Undead", "SCRE", "category")).toEqual(["ghostly", "skeletal", "vampiric", "zombie", "ghoulish", "mummified"]);
		expect(options("Undead", "SCRE", "ghostly-strikes")).toEqual(["spectral-strikes", "withering-strikes"]);
		expect(options("Undead", "SCRE", "ghostly-features")).toEqual(["etherealness"]);
		expect(options("Undead", "SCRE", "vampiric-weaknesses")).toEqual(["forbiddance", "running-water", "stake-to-heart", "sunlight"]);
		expect(options("Undead", "SCRE", "ghoulish-features")).toEqual(["ghoulish-strikes", "stench"]);
		expect(options("Undead", "SCRE", "mummified-features")).toEqual(["rotting-strikes"]);
		expect(options("Undead", "SCRE", "miscellaneous")).toEqual([
			"deathly-aura", "detect-life", "ethereal-sight", "headless", "bestow-curse", "chill-touch",
			"magic-resistance", "necrotic-absorption", "overwhelming-necrosis", "shadow-stealth",
			"sunlight-sensitivity", "touch-of-death", "turn-immunity", "turn-resistance", "dreadful-glare",
		]);
	});

	it("only references static monster templates where checked fields agree; never treats them as application instructions", () => {
		for (const recipe of catalog.creatureTransformation.filter(it => it.templateReference)) {
			const template = templates.find(it => it.name === recipe.templateReference.name && it.source === recipe.templateReference.source);
			expect(template).toBeDefined();
			expect(template.source).toBe(recipe.source);
			expect(template.page).toBe(recipe.provenance.page);
			expect(recipe.changes).toContainEqual({op: "setType", value: template.apply._root.type.type});
			const mods = template.apply._mod;
			for (const [prop, op] of [["resist", "grantResistance"], ["immune", "grantImmunity"], ["vulnerable", "grantVulnerability"], ["conditionImmune", "grantConditionImmunity"]]) {
				for (const mod of [mods[prop]].flat().filter(Boolean)) {
					for (const value of [mod.items].flat().filter(Boolean)) expect(recipe.changes).toContainEqual({op, value});
				}
			}
		}
		expect(templates.some(it => it.name === "Large or Smaller Half-Bronze Dragon")).toBe(false);
		expect(byId("Half-Dragon", "MM").optionGroups.flatMap(it => it.options).every(it => !it.templateReference)).toBe(true);
	});

	it("uses bounded entry edits and conditional defenses instead of treating a conditional as unconditional", () => {
		expect(byId("Skeletal Wyrmling", "Ar8").changes).toContainEqual({op: "removeEntry", section: "action", match: {role: "breathWeapon", source: "$chassis"}});
		expect(byId("Wereshark", "Arcadia27").changes).toContainEqual({op: "grantConditionalDefense", kind: "immunity", value: "slashing", when: "nonmagicalUnsilvered"});
		expect(byId("Wereshark", "Arcadia27").changes).toContainEqual(expect.objectContaining({op: "addEntry", section: "action", entry: expect.objectContaining({name: "Bite (Wereshark)", source: "Arcadia27"})}));
		for (const source of ["MM", "BEG"]) {
			const steps = byId("Shadow Dragon", source).changes;
			expect(steps).toContainEqual(expect.objectContaining({op: "replaceDamageType", match: {role: "breathWeapon", source: "$chassis"}, to: "necrotic"}));
			expect(steps).toContainEqual(expect.objectContaining({op: "grantConditionalDefense", when: "dimLightOrDarkness", value: "slashing"}));
			expect(steps).not.toContainEqual({op: "grantImmunity", value: "slashing"});
		}
		expect(byId("Fallen Angel", "SCRE").changes).toContainEqual(expect.objectContaining({op: "replaceEntry", match: {role: "healingTouch", source: "$chassis"}, onMissing: "skip"}));
	});

	it("replaces every supported breath damage type on MM Shadow Dragons, without widening their bite rule", () => {
		const steps = byId("Shadow Dragon", "MM").changes.filter(it => it.op === "replaceDamageType");
		expect(steps.find(it => it.match.role === "breathWeapon")).toEqual({
			op: "replaceDamageType",
			section: "action",
			match: {role: "breathWeapon", source: "$chassis"},
			from: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"],
			to: "necrotic",
			onMissing: "error",
		});
		expect(steps.find(it => it.match.role === "bite").from).toEqual(["acid", "cold", "fire", "lightning", "poison"]);
	});

	it("flags the MM Shadow Breath's lethal Humanoid-to-shadow consequence for DM review", () => {
		const candidates = getCreatureTransformationCandidates({catalog, races: [], getVersions: () => []});
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:shadow dragon|mm"});
		expect(resolved.manualReview).toContainEqual({
			field: "attacks",
			reason: expect.stringMatching(/\bhumanoid\b.*\bshadow\b/i),
		});
	});
});

describe("source-qualified candidate and resolution API", () => {
	const siteRaces = [
		{name: "Elf", source: "PHB", edition: "classic", page: 21, _isBaseRace: true, entries: ["base"]},
		{name: "Elf (High Elf)", source: "PHB", edition: "classic", page: 23, _baseName: "Elf", _baseSource: "PHB", darkvision: 60, resist: ["cold"], entries: ["subrace"]},
		{name: "Dragonborn", source: "XPHB", edition: "one", page: 187, _versions: [{name: "Dragonborn"}], entries: ["base"]},
	];
	const dataUtil = {
		loadJSON: async () => catalog,
		race: {
			loadJSON: async () => ({race: siteRaces}),
			loadPrerelease: async () => ({race: [{name: "Playtest Kin", source: "UA", edition: "one", page: 1}]}),
			loadBrew: async () => ({race: [{name: "Brew Kin", source: "HBR", page: 12, resist: ["fire"], additionalSpells: [{known: {_: ["light#c"]}}]}]}),
		},
		generic: {getVersions: () => [
			{name: "Dragonborn", source: "XPHB", edition: "one", page: 187, creatureTypes: ["humanoid"]},
			{name: "Dragonborn", source: "XPHB", edition: "one", page: 187, resist: ["cold"]},
		]},
	};

	it("loads 2014, 2024, homebrew, prerelease, subrace, and distinct same-name versions", async () => {
		const result = await pLoadCreatureTransformationCandidates({dataUtil});
		expect(result.find(it => it.id === "race:elf (high elf)|phb").baseIdentity).toEqual({name: "Elf", source: "PHB"});
		expect(result.find(it => it.id === "race:elf|phb").manualReview).toEqual(expect.arrayContaining([expect.objectContaining({field: "eligibility"})]));
		expect(result.find(it => it.id === "race:dragonborn|xphb").provenance.edition).toBe("one");
		expect(result.filter(it => it.id.startsWith("race:dragonborn|xphb~v:"))).toHaveLength(2);
		expect(result.find(it => it.id === "race:brew kin|hbr").changes).toContainEqual({op: "grantResistance", value: "fire"});
		expect(result.find(it => it.id === "race:brew kin|hbr").manualReview).toContainEqual(expect.objectContaining({field: "spellcasting"}));
		expect(result.find(it => it.id === "race:playtest kin|ua")).toBeDefined();
		expect(result.find(it => it.id === "catalog:shadow dragon|beg")).toBeDefined();
		expect(result.find(it => it.id === "catalog:shadow dragon|mm")).toBeDefined();
	});

	it("propagates unavailable-source failures instead of silently presenting a partial catalog", async () => {
		await expect(pLoadCreatureTransformationCandidates({
			dataUtil: {...dataUtil, race: {...dataUtil.race, loadBrew: async () => { throw new Error("brew unavailable"); }}},
		})).rejects.toThrow("brew unavailable");
		await expect(pLoadCreatureTransformationCandidates({
			dataUtil: {...dataUtil, race: {...dataUtil.race, loadJSON: async () => ({})}},
		})).rejects.toThrow("Site race source is unavailable");
		await expect(pLoadCreatureTransformationCandidates({
			dataUtil: {...dataUtil, race: {...dataUtil.race, loadPrerelease: async () => null}},
		})).rejects.toThrow("prerelease race source is malformed");
		expect(() => getCreatureTransformationCandidates({catalog, races: [{name: "A", source: "UA", _versions: [{}]}]})).toThrow("versions cannot be resolved");
		expect(() => getCreatureTransformationCandidates({catalog, races: [{name: "A", source: "X"}, {name: "a", source: "x"}], getVersions: () => []})).toThrow("Duplicate");
	});

	it("resolves real site subraces and parameterized 2024 versions with the existing race utilities", () => {
		const raw = JSON.parse(fs.readFileSync("data/races.json", "utf8"));
		const roots = raw.race.filter(it => (it.name === "Elf" && it.source === "PHB") || (it.name === "Dragonborn" && it.source === "XPHB"));
		const subrace = raw.subrace.filter(it => it.name === "High" && it.raceName === "Elf" && it.raceSource === "PHB");
		const merged = DataUtil.race.getPostProcessedSiteJson({race: roots, subrace}, {isAddBaseRaces: true}).race;
		const candidates = getCreatureTransformationCandidates({
			catalog,
			races: merged,
			getVersions: race => DataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
		});
		expect(candidates.find(it => it.id === "race:elf (high)|phb").baseIdentity).toEqual({name: "Elf", source: "PHB"});
		expect(candidates.filter(it => it.id.startsWith("race:dragonborn (") && it.id.includes("~v:dragonborn|xphb:"))).toHaveLength(10);
		expect(candidates.find(it => it.id === "race:dragonborn (red)|xphb~v:dragonborn|xphb:8").changes).toContainEqual({op: "grantResistance", value: "fire"});

		const brewSubraces = DataUtil.race.getPostProcessedPrereleaseBrewJson(
			{race: [roots.find(it => it.name === "Elf")]},
			{subrace: [{name: "Moon", source: "HBR", raceName: "Elf", raceSource: "PHB", entries: [{type: "entries", name: "Moon Trait", entries: ["A new choice."]}]}]},
			{isAddBaseRaces: true},
		).race;
		const withBrew = getCreatureTransformationCandidates({
			catalog,
			races: [...merged, ...brewSubraces],
			getVersions: race => DataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
		});
		expect(withBrew.find(it => it.id === "race:elf (moon)|hbr").baseIdentity).toEqual({name: "Elf", source: "PHB"});
	});

	it("replays the DMG Skeleton's vulnerability and escalates unsupported race vulnerability choices", () => {
		const raw = JSON.parse(fs.readFileSync("data/races.json", "utf8"));
		const skeleton = raw.race.find(it => it.name === "Skeleton" && it.source === "DMG");
		expect(skeleton.vulnerable).toEqual(["bludgeoning"]);
		const candidates = getCreatureTransformationCandidates({
			catalog,
			races: [
				skeleton,
				{...skeleton, name: "Choice Skeleton", vulnerable: ["bludgeoning", {choose: {from: ["fire", "cold"]}}]},
				{...skeleton, name: "Complex Skeleton", vulnerable: {choose: {from: ["fire", "cold"]}}},
			],
			getVersions: () => [],
		});
		const resolved = resolveCreatureTransformation({candidates, id: "race:skeleton|dmg"});
		expect(resolved.changes).toContainEqual({op: "grantVulnerability", value: "bludgeoning"});
		const choice = resolveCreatureTransformation({candidates, id: "race:choice skeleton|dmg"});
		expect(choice.changes).toContainEqual({op: "grantVulnerability", value: "bludgeoning"});
		expect(choice.manualReview).toContainEqual({field: "traits", reason: expect.stringContaining("vulnerable")});
		const complex = resolveCreatureTransformation({candidates, id: "race:complex skeleton|dmg"});
		expect(complex.changes).not.toContainEqual(expect.objectContaining({op: "grantVulnerability"}));
		expect(complex.manualReview).toContainEqual({field: "traits", reason: expect.stringContaining("vulnerable")});
	});

	it("requires at least one Fey Beast feature without limiting additional picks", () => {
		const candidates = getCreatureTransformationCandidates({catalog, races: [], getVersions: () => []});
		const id = "catalog:fey beast|scre";
		expect(() => resolveCreatureTransformation({candidates, id})).toThrow("Invalid selection");
		expect(() => resolveCreatureTransformation({candidates, id, selections: {features: []}})).toThrow("Invalid selection");
		const resolved = resolveCreatureTransformation({candidates, id, selections: {features: ["fey-touched", "rooted"]}});
		expect(resolved.selectedOptions.features).toEqual(["fey-touched", "rooted"]);
		expect(resolved.changes).toContainEqual(expect.objectContaining({op: "addEntry", entry: expect.objectContaining({name: "Fey-Touched"})}));
	});

	it("requires selections, rejects unknown and inappropriate choices, and returns immutable, scoped steps", () => {
		const candidates = getCreatureTransformationCandidates({catalog, races: [], getVersions: () => []});
		const id = "catalog:undead|scre";
		expect(() => resolveCreatureTransformation({candidates, id})).toThrow("Invalid selection");
		expect(() => resolveCreatureTransformation({candidates, id, selections: {category: ["ghostly"], "vampiric-weaknesses": ["sunlight"]}})).toThrow("requires");
		expect(() => resolveCreatureTransformation({candidates, id, selections: {category: ["ghostly", "skeletal"]}})).toThrow("Invalid selection");
		expect(() => resolveCreatureTransformation({candidates, id, selections: {category: ["no-such-category"]}})).toThrow("Unknown transformation option");
		expect(() => resolveCreatureTransformation({candidates, id: "catalog:undead|missing", selections: {category: ["ghostly"]}})).toThrow("Unavailable");
		const resolution = resolveCreatureTransformation({candidates, id, selections: {category: ["vampiric"], "vampiric-weaknesses": ["sunlight"]}});
		expect(resolution.selectedOptions).toEqual(expect.objectContaining({category: ["vampiric"], "vampiric-weaknesses": ["sunlight"]}));
		expect(resolution.changes).toContainEqual({op: "grantConditionalDefense", kind: "resistance", value: "slashing", when: "nonmagical"});
		for (const field of ["ac", "hp", "attacks", "cr", "characterLevel"]) expect(resolution.manualReview.some(it => it.field === field)).toBe(true);
		resolution.changes[0].value = "beast";
		expect(candidates.find(it => it.id === id).changes[0].value).toBe("undead");
	});
});
