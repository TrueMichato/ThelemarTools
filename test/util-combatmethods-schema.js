import fs from "fs";
import path from "path";

import {Uf} from "5etools-utils";
import {UtilAjv} from "5etools-utils/lib/UtilAjv.js";

const COMBAT_METHOD_SCHEMA_PATH = "schema/site/combatmethods.json";
const COMBAT_METHOD_DATA_PATH = "data/combatmethods.json";
const COMBAT_METHOD_BREW_PATH = "homebrew/TravelersGuidetoThelemar.json";
const UTILS_SCHEMA_DIR = "node_modules/5etools-utils/schema/site";

let _VALIDATE = null;

function getCombatMethodValidator () {
	if (_VALIDATE) return _VALIDATE;

	const ajv = UtilAjv.getValidator();
	for (const filePath of Uf.listJsonFiles(UTILS_SCHEMA_DIR)) {
		const relativeFilePath = path.relative(UTILS_SCHEMA_DIR, filePath).replace(/\\/g, "/");
		if (relativeFilePath === "combatmethods.json") continue;
		ajv.addSchema(JSON.parse(fs.readFileSync(filePath, "utf8")), relativeFilePath);
	}

	const schema = JSON.parse(fs.readFileSync(COMBAT_METHOD_SCHEMA_PATH, "utf8"));
	_VALIDATE = ajv.compile(schema);
	return _VALIDATE;
}

function getCombatMethodSchemaErrors ({data, filePath, validate = getCombatMethodValidator()}) {
	if (validate(data)) return [];

	return (validate.errors || [])
		.map(error => `${filePath}${error.instancePath || "/"} ${error.message}`);
}

function getCombatMethodIdentityErrors ({data, filePath}) {
	const seen = new Set();
	const errors = [];

	for (const method of data.combatMethod || []) {
		const uid = `${method.name || ""}|${method.source || ""}`.toLowerCase();
		if (!seen.has(uid)) {
			seen.add(uid);
			continue;
		}
		errors.push(`${filePath} contains duplicate combat method UID "${method.name}|${method.source}".`);
	}

	return errors;
}

function getCombatMethodCorpusErrors () {
	const validate = getCombatMethodValidator();
	const dataSite = JSON.parse(fs.readFileSync(COMBAT_METHOD_DATA_PATH, "utf8"));
	const dataBrewRaw = JSON.parse(fs.readFileSync(COMBAT_METHOD_BREW_PATH, "utf8"));
	const dataBrew = {combatMethod: dataBrewRaw.combatMethod || []};

	return [
		...getCombatMethodSchemaErrors({data: dataSite, filePath: COMBAT_METHOD_DATA_PATH, validate}),
		...getCombatMethodIdentityErrors({data: dataSite, filePath: COMBAT_METHOD_DATA_PATH}),
		...getCombatMethodSchemaErrors({data: dataBrew, filePath: `${COMBAT_METHOD_BREW_PATH}#combatMethod`, validate}),
		...getCombatMethodIdentityErrors({data: dataBrew, filePath: `${COMBAT_METHOD_BREW_PATH}#combatMethod`}),
	];
}

export {
	COMBAT_METHOD_DATA_PATH,
	COMBAT_METHOD_SCHEMA_PATH,
	getCombatMethodCorpusErrors,
	getCombatMethodIdentityErrors,
	getCombatMethodSchemaErrors,
	getCombatMethodValidator,
};
