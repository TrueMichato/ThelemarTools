import fs from "node:fs";

import Ajv from "ajv/dist/2020.js";

const SCHEMA_PATH = "schema/site/creature-transformation.json";
const DATA_PATH = "data/creature-transformations.json";
let _validator;

function getCreatureTransformationValidator () {
	_validator ||= new Ajv({allErrors: true}).compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")));
	return _validator;
}

function getCreatureTransformationSchemaErrors ({data, filePath, validate = getCreatureTransformationValidator()}) {
	if (validate(data)) return [];
	return (validate.errors || []).map(error => `${filePath}${error.instancePath || "/"} ${error.message}`);
}

function getCreatureTransformationIdentityErrors ({data, filePath}) {
	const seen = new Set();
	const errors = [];
	for (const recipe of data.creatureTransformation || []) {
		const id = `${recipe.name}|${recipe.source}`.toLowerCase();
		if (seen.has(id)) errors.push(`${filePath}: duplicate creature transformation identity ${id}`);
		seen.add(id);
		const groupIds = new Set();
		for (const group of recipe.optionGroups || []) {
			if (groupIds.has(group.id)) errors.push(`${filePath}: duplicate group ${id}/${group.id}`);
			groupIds.add(group.id);
			const optionIds = new Set();
			for (const option of group.options || []) {
				if (optionIds.has(option.id)) errors.push(`${filePath}: duplicate option ${id}/${group.id}/${option.id}`);
				optionIds.add(option.id);
			}
		}
		for (const group of recipe.optionGroups || []) {
			if (!group.appliesTo) continue;
			const parent = recipe.optionGroups.find(it => it.id === group.appliesTo.group);
			if (!parent?.options.some(it => it.id === group.appliesTo.option)) errors.push(`${filePath}: unknown conditional option ${id}/${group.id}`);
		}
	}
	return errors;
}

function getCreatureTransformationCorpusErrors () {
	const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
	return [
		...getCreatureTransformationSchemaErrors({data, filePath: DATA_PATH}),
		...getCreatureTransformationIdentityErrors({data, filePath: DATA_PATH}),
	];
}

export {DATA_PATH, SCHEMA_PATH, getCreatureTransformationValidator, getCreatureTransformationSchemaErrors, getCreatureTransformationIdentityErrors, getCreatureTransformationCorpusErrors};
