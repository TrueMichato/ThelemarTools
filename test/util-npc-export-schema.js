import fs from "fs";
import path from "path";

import {Uf} from "5etools-utils";
import {UtilAjv} from "5etools-utils/lib/UtilAjv.js";

/**
 * Real-schema validation for the character sheet's NPC-companion export, following the
 * same registration pattern as `util-combatmethods-schema.js`: compile the schema shipped
 * in the installed `5etools-utils` package itself (not a repo-owned copy, and not a
 * hand-written property-list proxy), with every sibling schema registered so internal
 * `$ref`s resolve.
 *
 * A companion export document is shaped exactly like the site's own bestiary/item data
 * files (`{monster: [...], _meta}` / `{item: [...], _meta}`), so the top-level schemas
 * validate a whole exported document directly — no per-entity wrapping needed.
 */
const UTILS_SCHEMA_DIR = "node_modules/5etools-utils/schema/site";
const BESTIARY_SCHEMA_PATH = `${UTILS_SCHEMA_DIR}/bestiary/bestiary.json`;
const ITEM_SCHEMA_PATH = `${UTILS_SCHEMA_DIR}/items.json`;

const _VALIDATORS = {};

function _getValidator (schemaPath) {
	if (_VALIDATORS[schemaPath]) return _VALIDATORS[schemaPath];

	const ajv = UtilAjv.getValidator();
	const selfRelative = path.relative(UTILS_SCHEMA_DIR, schemaPath).replace(/\\/g, "/");
	for (const filePath of Uf.listJsonFiles(UTILS_SCHEMA_DIR)) {
		const relativeFilePath = path.relative(UTILS_SCHEMA_DIR, filePath).replace(/\\/g, "/");
		if (relativeFilePath === selfRelative) continue;
		ajv.addSchema(JSON.parse(fs.readFileSync(filePath, "utf8")), relativeFilePath);
	}

	const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	_VALIDATORS[schemaPath] = ajv.compile(schema);
	return _VALIDATORS[schemaPath];
}

function getBestiaryValidator () {
	return _getValidator(BESTIARY_SCHEMA_PATH);
}

function getItemValidator () {
	return _getValidator(ITEM_SCHEMA_PATH);
}

/**
 * @param {object} data A whole document, e.g. `{monster: [...]}` or `{item: [...]}`.
 * @param {string} filePath Label used only to prefix error messages.
 * @param {"bestiary"|"item"} kind
 * @returns {string[]} Human-readable errors; empty when the document is schema-legal.
 */
function getNpcExportSchemaErrors ({data, filePath, kind}) {
	const validate = kind === "bestiary" ? getBestiaryValidator() : getItemValidator();
	if (validate(data)) return [];
	return (validate.errors || [])
		.map(error => `${filePath}${error.instancePath || "/"} ${error.message}`);
}

export {
	BESTIARY_SCHEMA_PATH,
	ITEM_SCHEMA_PATH,
	getBestiaryValidator,
	getItemValidator,
	getNpcExportSchemaErrors,
};
