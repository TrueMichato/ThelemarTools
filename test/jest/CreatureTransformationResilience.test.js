import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {getCreatureTransformationCandidates, pLoadCreatureTransformationCandidates, resolveCreatureTransformation} from "../../js/creature-transformations.js";
import {previewCreatureTransformationTargets, createCreatureTransformationChanges} from "../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsUtil} from "../../js/bestiary/bestiary-quick-actions-engine.js";

const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const healthy = getCreatureTransformationCandidates({catalog, races: []});
const makeLoader = (data, races = []) => ({
	loadJSON: async () => data,
	race: {loadJSON: async () => ({race: races}), loadPrerelease: async () => ({}), loadBrew: async () => ({})},
	generic: {getVersions: () => []},
});
const broken = changes => ({...structuredClone(catalog.creatureTransformation[0]), name: "Broken fixture", changes});

describe("runtime creature recipe isolation", () => {
	let warn;
	beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => {}); });
	afterEach(() => warn.mockRestore());

	it.each([
		["missing entry", null],
		["missing identity", {...broken([]), name: null}],
		["missing review", {...broken([]), manualReview: undefined}],
		["malformed group", {...broken([]), optionGroups: [null]}],
		["broken operation", broken([{op: "brokenOperation"}])],
		["broken option", {...broken([]), optionGroups: [{id: "x", selection: "one", options: [{id: "y", changes: [{op: "brokenOption"}], manualReview: []}]}]}],
	])("keeps all healthy recipes unchanged around a %s and warns with context", async (_label, invalid) => {
		const mixed = {creatureTransformation: [catalog.creatureTransformation[0], invalid, ...catalog.creatureTransformation.slice(1)]};
		expect(() => getCreatureTransformationCandidates({catalog: mixed, races: []})).toThrow();
		const warnings = [];
		const result = await pLoadCreatureTransformationCandidates({dataUtil: makeLoader(mixed), onWarning: it => warnings.push(it)});
		expect(result).toEqual(healthy);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({kind: "catalog", index: 1, reason: expect.any(String)});
		expect(warnings[0].reason.length).toBeGreaterThan(10);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(warnings[0].reason), warnings[0]);
		if (invalid?.name) expect(warnings[0].name).toBe(invalid.name);
	});

	it("reports all-invalid catalogs rather than fabricating a healthy candidate", async () => {
		const warnings = [];
		expect(await pLoadCreatureTransformationCandidates({
			dataUtil: makeLoader({creatureTransformation: [null, broken([{op: "bad"}])]}),
			onWarning: it => warnings.push(it),
		})).toEqual([]);
		expect(warnings).toHaveLength(2);
	});

	it("does not partially admit a species when one of its versions is invalid", async () => {
		const dataUtil = makeLoader(catalog, [{name: "Broken species", source: "TST", _versions: [{}]}]);
		dataUtil.generic.getVersions = () => [{name: "Valid version", source: "TST"}, {name: null, source: "TST"}];
		expect(await pLoadCreatureTransformationCandidates({dataUtil})).toEqual(healthy);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Broken species"), expect.objectContaining({kind: "race"}));
	});

	it("keeps source/envelope, ambiguous identity, unexpected programming and copy errors hard", async () => {
		const unavailable = makeLoader(catalog);
		unavailable.race.loadBrew = async () => { throw new Error("Source unavailable"); };
		await expect(pLoadCreatureTransformationCandidates({dataUtil: unavailable})).rejects.toThrow("Source unavailable");
		await expect(pLoadCreatureTransformationCandidates({dataUtil: makeLoader({})})).rejects.toThrow("catalog");
		await expect(pLoadCreatureTransformationCandidates({dataUtil: makeLoader({creatureTransformation: [catalog.creatureTransformation[0], catalog.creatureTransformation[0]]})})).rejects.toThrow("Duplicate");
		const unexpected = makeLoader(catalog, [{name: "Versions", source: "TST", _versions: [{}]}]);
		unexpected.generic.getVersions = () => { throw new TypeError("Unexpected programming fault"); };
		await expect(pLoadCreatureTransformationCandidates({dataUtil: unexpected})).rejects.toThrow("Unexpected programming fault");
		const copy = makeLoader(catalog, [{name: "Child", source: "TST", _copy: {name: "Missing", source: "TST"}}]);
		copy.race.pMergeCopy = async () => { throw new Error("Missing copy parent"); };
		await expect(pLoadCreatureTransformationCandidates({dataUtil: copy})).rejects.toThrow("Missing copy parent");
		expect(warn).not.toHaveBeenCalled();
	});

	it("previews and applies a surviving real recipe with exact mechanics and strict saved-operation validation", async () => {
		const candidates = await pLoadCreatureTransformationCandidates({dataUtil: makeLoader({creatureTransformation: [broken([{op: "bad"}]), ...catalog.creatureTransformation]})});
		const monster = {name: "Fixture", source: "MM", type: "humanoid", size: ["M"], int: 10, cha: 10, str: 10, dex: 10, con: 10, wis: 10, speed: {walk: 30}, cr: "1", hp: {average: 10}};
		const original = structuredClone(monster);
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:skeleton|dmg"});
		const targets = [{id: "one", label: monster.name, baseCreature: monster, operations: []}];
		const batch = previewCreatureTransformationTargets({targets, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
		expect(monster).toEqual(original);
		expect(batch.previews[0].preview.proposed).toMatchObject({type: "undead", int: 6, vulnerable: ["bludgeoning"]});
		const operation = createCreatureTransformationChanges({batch, targets})[0].addOperations[0];
		expect(BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [operation]})).toMatchObject({type: "undead", int: 6, vulnerable: ["bludgeoning"]});
		const invalid = structuredClone(operation);
		invalid.data.resolved.changes.push({type: "brokenSavedOperation"});
		expect(() => BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations: [invalid]})).toThrow();
	});
});
