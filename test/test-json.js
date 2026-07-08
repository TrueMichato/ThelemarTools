import fs from "fs";
import path from "path";

import {Um, Uf, JsonTester} from "5etools-utils";

const LOG_TAG = "JSON";
const _IS_FAIL_SLOW = !!process.env.FAIL_SLOW;

const _GENERATED_ALLOWLIST = new Set([
	"bookref-quick.json",
	"gendata-spell-source-lookup.json",
]);

// Data files whose schemas are pending in a companion 5etools-utils PR.
// Each entry pairs a data-file suffix with the schema ID the utils PR
// will register. Once utils lands and node_modules is refreshed, the
// entry auto-removes itself from this skip set (via the existence
// check below) and validation resumes.
const _SCHEMA_PENDING_UTILS = [
	{suffix: "bestiary/monstergroups.json", schemaId: "bestiary/monstergroups.json"},
];

function _hasSchemaOnDisk (schemaId) {
	try {
		const utilsSite = "node_modules/5etools-utils/schema/site";
		return fs.existsSync(path.join(utilsSite, schemaId));
	} catch (e) {
		return false;
	}
}

async function main () {
	const jsonTester = new JsonTester({
		tagLog: LOG_TAG,
		fnGetSchemaId: (filePath) => {
			const relativeFilePath = filePath.replace("data/", "");

			if (relativeFilePath.startsWith("adventure/")) return "adventure/adventure.json";
			if (relativeFilePath.startsWith("book/")) return "book/book.json";

			if (relativeFilePath.startsWith("bestiary/bestiary-")) return "bestiary/bestiary.json";
			if (relativeFilePath.startsWith("bestiary/fluff-bestiary-")) return "bestiary/fluff-bestiary.json";

			if (relativeFilePath.startsWith("class/class-")) return "class/class.json";
			if (relativeFilePath.startsWith("class/fluff-class-")) return "class/fluff-class.json";

			if (relativeFilePath.startsWith("spells/spells-")) return "spells/spells.json";
			if (relativeFilePath.startsWith("spells/fluff-spells-")) return "spells/fluff-spells.json";

			return relativeFilePath;
		},
	});
	await jsonTester.pInit();

	const fileList = Uf.listJsonFiles("data")
		.filter(filePath => {
			if (filePath.includes("data/generated")) return _GENERATED_ALLOWLIST.has(filePath.split("/").at(-1));
			// Skip files whose schema is only shipping in a pending utils PR
			// AND the schema is not (yet) present on disk. Once the utils PR
			// merges and node_modules refreshes, this branch stops matching.
			for (const {suffix, schemaId} of _SCHEMA_PENDING_UTILS) {
				if (filePath.endsWith(suffix) && !_hasSchemaOnDisk(schemaId)) {
					Um.warn(LOG_TAG, `Skipping "${filePath}" — schema "${schemaId}" not yet present in 5etools-utils. Remove entry from _SCHEMA_PENDING_UTILS once utils PR lands.`);
					return false;
				}
			}
			return true;
		});

	const results = await jsonTester.pGetErrorsOnDirsWorkers({
		isFailFast: !_IS_FAIL_SLOW,
		fileList,
	});

	const {errors, errorsFull} = results;

	if (errors.length) {
		if (!process.env.CI) fs.writeFileSync(`test/temp/test-json.error.log`, errorsFull.join("\n\n=====\n\n"));
		console.error(`Schema test failed (${errors.length} failure${errors.length === 1 ? "`" : "s"}).`);
		return false;
	}

	Um.info(LOG_TAG, `All schema tests passed.`);
	return true;
}

const pMain = main();

if (import.meta.main && !(await pMain)) process.exitCode = 1;

export default pMain;
