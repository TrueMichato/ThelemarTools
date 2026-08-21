import fs from "fs";
import path from "path";

import {Um, Uf, JsonTester} from "5etools-utils";
import {
	ITEM_COMPOSITION_KEYS,
	getDataWithoutItemComposition,
	getItemCompositionErrors,
	getItemCompositionValidator,
} from "./util-item-composition-schema.js";
import {
	COMBAT_METHOD_DATA_PATH,
	getCombatMethodCorpusErrors,
} from "./util-combatmethods-schema.js";

const LOG_TAG = "JSON";
const _IS_FAIL_SLOW = !!process.env.FAIL_SLOW;

const _GENERATED_ALLOWLIST = new Set([
	"bookref-quick.json",
	"gendata-spell-source-lookup.json",
]);

const _ITEM_COMPOSITION_TEMP_DIR = path.resolve("test/temp/item-composition-upstream");

// Repository-specific data files which predate local schema ownership.
// Entries automatically resume upstream validation if a matching schema
// appears in the installed 5etools-utils package.
const _SCHEMA_UNAVAILABLE = [
	{
		suffix: "bestiary/monstergroups.json",
		schemaId: "bestiary/monstergroups.json",
		reason: "schema is pending in a companion 5etools-utils change",
	},
	{
		suffix: "crafting-effect-overrides.json",
		schemaId: "crafting-effect-overrides.json",
		reason: "repository-owned crafting override data has no upstream schema",
	},
	{
		suffix: "crafting.json",
		schemaId: "crafting.json",
		reason: "generated crafting data has dedicated generator and corpus tests",
	},
	{
		suffix: "items-variant-components-ar8.json",
		schemaId: "items-variant-components-ar8.json",
		reason: "repository-owned variant component data has no upstream schema",
	},
	{
		suffix: "itemupgrades.json",
		schemaId: "itemupgrades.json",
		reason: "repository-owned item upgrade data has no upstream schema",
	},
	{
		suffix: "loading-tips.json",
		schemaId: "loading-tips.json",
		reason: "repository-owned loading tip data has no upstream schema",
	},
];

function _hasSchemaOnDisk (schemaId) {
	try {
		const utilsSite = "node_modules/5etools-utils/schema/site";
		return fs.existsSync(path.join(utilsSite, schemaId));
	} catch (e) {
		return false;
	}
}

const _getSchemaId = (filePath) => {
	const normalized = filePath.replace(/\\/g, "/");
	const ixData = normalized.lastIndexOf("/data/");
	const relativeFilePath = ixData >= 0
		? normalized.slice(ixData + "/data/".length)
		: normalized.replace(/^data\//, "");

	if (relativeFilePath.startsWith("adventure/")) return "adventure/adventure.json";
	if (relativeFilePath.startsWith("book/")) return "book/book.json";

	if (relativeFilePath.startsWith("bestiary/bestiary-")) return "bestiary/bestiary.json";
	if (relativeFilePath.startsWith("bestiary/fluff-bestiary-")) return "bestiary/fluff-bestiary.json";

	if (relativeFilePath.startsWith("class/class-")) return "class/class.json";
	if (relativeFilePath.startsWith("class/fluff-class-")) return "class/fluff-class.json";

	if (relativeFilePath.startsWith("spells/spells-")) return "spells/spells.json";
	if (relativeFilePath.startsWith("spells/fluff-spells-")) return "spells/fluff-spells.json";

	return relativeFilePath;
};

function _getFileListWithLocalItemComposition ({fileList}) {
	const validate = getItemCompositionValidator();
	const errors = [];

	const fileListOut = fileList.map(filePath => {
		const raw = fs.readFileSync(filePath, "utf8");
		if (!ITEM_COMPOSITION_KEYS.some(prop => raw.includes(`"${prop}"`))) return filePath;

		const data = JSON.parse(raw);
		const {data: dataSanitized, isModified} = getDataWithoutItemComposition(data);
		if (!isModified) return filePath;

		errors.push(...getItemCompositionErrors({data, filePath, validate}));

		const filePathOut = path.join(_ITEM_COMPOSITION_TEMP_DIR, "data", path.relative("data", filePath));
		fs.mkdirSync(path.dirname(filePathOut), {recursive: true});
		fs.writeFileSync(filePathOut, JSON.stringify(dataSanitized, null, "\t"));
		return filePathOut;
	});

	return {errors, fileList: fileListOut};
}

async function main () {
	fs.rmSync(_ITEM_COMPOSITION_TEMP_DIR, {recursive: true, force: true});

	const errorsCombatMethods = getCombatMethodCorpusErrors();
	if (errorsCombatMethods.length) {
		errorsCombatMethods.forEach(error => Um.error(LOG_TAG, error));
		console.error(`Combat method schema test failed (${errorsCombatMethods.length} failure${errorsCombatMethods.length === 1 ? "" : "s"}).`);
		return false;
	}

	const jsonTester = new JsonTester({
		tagLog: LOG_TAG,
		fnGetSchemaId: _getSchemaId,
	});
	await jsonTester.pInit();

	const fileListRaw = Uf.listJsonFiles("data")
		.filter(filePath => {
			if (filePath.includes("data/generated")) return _GENERATED_ALLOWLIST.has(filePath.split("/").at(-1));
			if (filePath.replace(/\\/g, "/").endsWith(COMBAT_METHOD_DATA_PATH)) return false;
			for (const {suffix, schemaId, reason} of _SCHEMA_UNAVAILABLE) {
				if (filePath.endsWith(suffix) && !_hasSchemaOnDisk(schemaId)) {
					Um.warn(LOG_TAG, `Skipping "${filePath}" — ${reason}. Add a local schema or install upstream schema "${schemaId}" to enable validation.`);
					return false;
				}
			}
			return true;
		});

	try {
		const {errors: errorsComposition, fileList} = _getFileListWithLocalItemComposition({fileList: fileListRaw});
		if (errorsComposition.length) {
			errorsComposition.forEach(error => Um.error(LOG_TAG, error));
			console.error(`Item composition schema test failed (${errorsComposition.length} failure${errorsComposition.length === 1 ? "" : "s"}).`);
			return false;
		}

		const results = await jsonTester.pGetErrorsOnDirsWorkers({
			isFailFast: !_IS_FAIL_SLOW,
			fileList,
		});

		const {errors, errorsFull} = results;

		if (errors.length) {
			if (!process.env.CI) fs.writeFileSync(`test/temp/test-json.error.log`, errorsFull.join("\n\n=====\n\n"));
			console.error(`Schema test failed (${errors.length} failure${errors.length === 1 ? "" : "s"}).`);
			return false;
		}
	} finally {
		fs.rmSync(_ITEM_COMPOSITION_TEMP_DIR, {recursive: true, force: true});
	}

	Um.info(LOG_TAG, `All schema tests passed.`);
	return true;
}

const pMain = main();

if (import.meta.main && !(await pMain)) process.exitCode = 1;

export default pMain;
