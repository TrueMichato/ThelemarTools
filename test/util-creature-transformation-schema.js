import fs from "node:fs";

import Ajv from "ajv/dist/2020.js";
import {getCreatureTransformationCandidates} from "../js/creature-transformations.js";
import {getSporeShadowProfile} from "../js/creature-transformation-spore-shadow.js";
import {getLycanthropeProfile} from "../js/creature-transformation-lycanthrope.js";

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
		if (recipe.automation?.profile === "half-dragon") {
			try {
				getCreatureTransformationCandidates({catalog: {creatureTransformation: [recipe]}, races: []});
			} catch (error) {
				errors.push(`${filePath}: ${error.message}`);
			}
		}
		const m7 = ["spore-servant", "shadow-dragon-mm", "shadow-dragon-beg"].includes(recipe.automation?.profile);
		if (m7 && getSporeShadowProfile(`catalog:${id}`) !== recipe.automation.profile) errors.push(`${filePath}: M7 automation requires its exact source-qualified Spore/Shadow identity`);
		if (recipe.automation?.profile === "vampire" && id !== "vampire|mm") errors.push(`${filePath}: M8 automation is limited to Vampire|MM`);
		const m9 = ["lycanthropy", "wereshark"].includes(recipe.automation?.profile);
		if (m9 && getLycanthropeProfile(`catalog:${id}`) !== recipe.automation.profile) errors.push(`${filePath}: M9 automation requires its exact source-qualified Lycanthropy/Wereshark identity`);
		if (recipe.automation && !m7 && !m9 && !["zombie-numerics", "half-dragon", "skeleton", "skeletal-wyrmling", "vampire"].includes(recipe.automation.profile)) {
			const changes = recipe.automation.changes;
			const names = new Set(Array.isArray(changes) ? changes.map(it => it?.entry?.name) : []);
			if (id !== "dracolich|mm" || names.size !== 2 || !names.has("Magic Resistance") || !names.has("Undead Nature")) {
				errors.push(`${filePath}: staged automation requires Dracolich|MM and its complete pair of sourced traits`);
			}
		}
		if (recipe.automation?.profile === "zombie-numerics" && id !== "zombie|dmg") errors.push(`${filePath}: staged numeric automation is limited to Zombie|DMG`);
		if (recipe.automation?.profile === "skeleton" && id !== "skeleton|dmg") errors.push(`${filePath}: staged skeleton automation is limited to Skeleton|DMG`);
		if (recipe.automation?.profile === "skeletal-wyrmling" && id !== "skeletal wyrmling|ar8") errors.push(`${filePath}: staged wyrmling automation is limited to Skeletal Wyrmling|Ar8`);
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
