import fs from "fs";
import path from "path";

import Ajv2020 from "ajv/dist/2020.js";

const ITEM_COMPOSITION_KEYS = [
	"material",
	"appliedUpgrades",
	"socketedGemstones",
];

const ITEM_COLLECTION_KEYS = [
	"item",
	"baseitem",
];

const ITEM_COMPOSITION_SCHEMA_PATH = "schema/site/item-composition.json";

function getItemComposition (item) {
	return Object.fromEntries(
		ITEM_COMPOSITION_KEYS
			.filter(prop => Object.hasOwn(item, prop))
			.map(prop => [prop, item[prop]]),
	);
}

function hasItemComposition (item) {
	return ITEM_COMPOSITION_KEYS.some(prop => Object.hasOwn(item, prop));
}

function getItemCompositionValidator () {
	const schema = JSON.parse(fs.readFileSync(ITEM_COMPOSITION_SCHEMA_PATH, "utf8"));
	return new Ajv2020({allErrors: true}).compile(schema);
}

function getItemCompositionErrors ({data, filePath, validate}) {
	const errors = [];

	for (const prop of ITEM_COLLECTION_KEYS) {
		for (const item of data[prop] || []) {
			const composition = getItemComposition(item);
			if (!Object.keys(composition).length || validate(composition)) continue;

			const identity = `${item.name || "(Unnamed)"}|${item.source || "(No source)"}`;
			const details = validate.errors
				.map(error => `${error.instancePath || "/"} ${error.message}`)
				.join("; ");
			errors.push(`${filePath} :: ${prop} "${identity}": ${details}`);
		}
	}

	return errors;
}

function getDataWithoutItemComposition (data) {
	const isModified = ITEM_COLLECTION_KEYS
		.some(prop => (data[prop] || []).some(item => hasItemComposition(item)));
	if (!isModified) return {data, isModified};

	const out = structuredClone(data);

	for (const prop of ITEM_COLLECTION_KEYS) {
		for (const item of out[prop] || []) {
			for (const compositionProp of ITEM_COMPOSITION_KEYS) {
				if (!Object.hasOwn(item, compositionProp)) continue;
				delete item[compositionProp];
			}
		}
	}

	return {data: out, isModified};
}

function listJsonFiles (dir) {
	return fs.readdirSync(dir, {withFileTypes: true})
		.flatMap(entry => {
			const filePath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listJsonFiles(filePath);
			return entry.isFile() && entry.name.endsWith(".json") ? [filePath] : [];
		});
}

export {
	ITEM_COMPOSITION_KEYS,
	ITEM_COMPOSITION_SCHEMA_PATH,
	getDataWithoutItemComposition,
	getItemComposition,
	getItemCompositionErrors,
	getItemCompositionValidator,
	hasItemComposition,
	listJsonFiles,
};
