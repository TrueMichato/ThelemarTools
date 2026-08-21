import fs from "fs";

import {
	ITEM_COMPOSITION_KEYS,
	getDataWithoutItemComposition,
	getItemComposition,
	getItemCompositionErrors,
	getItemCompositionValidator,
	listJsonFiles,
} from "./util-item-composition-schema.js";

const FIXTURE_FILES = [
	{filePath: "test/data/item-composition/valid.json", isValidExpected: true},
	{filePath: "test/data/item-composition/invalid.json", isValidExpected: false},
];

function testFixtures ({validate}) {
	const errors = [];

	for (const {filePath, isValidExpected} of FIXTURE_FILES) {
		const {cases} = JSON.parse(fs.readFileSync(filePath, "utf8"));

		for (const testCase of cases) {
			const isValid = validate(testCase.value);
			if (isValid === isValidExpected) continue;

			const details = (validate.errors || [])
				.map(error => `${error.instancePath || "/"} ${error.message}`)
				.join("; ");
			errors.push(`${filePath} :: "${testCase.name}" unexpectedly ${isValid ? "passed" : `failed: ${details}`}`);
		}
	}

	return errors;
}

function testData ({validate}) {
	const errors = [];
	const compositionPattern = new RegExp(`"(${ITEM_COMPOSITION_KEYS.join("|")})"\\s*:`);

	for (const filePath of listJsonFiles("data")) {
		const raw = fs.readFileSync(filePath, "utf8");
		if (!compositionPattern.test(raw)) continue;

		const data = JSON.parse(raw);
		errors.push(...getItemCompositionErrors({data, filePath, validate}));
	}

	return errors;
}

async function main () {
	const validate = getItemCompositionValidator();
	const errors = [
		...testFixtures({validate}),
		...testData({validate}),
	];

	if (errors.length) {
		console.error(`Item composition schema errors:`);
		errors.forEach(error => console.error(`\t${error}`));
		return false;
	}

	const validFixture = JSON.parse(fs.readFileSync(FIXTURE_FILES[0].filePath, "utf8")).cases[1].value;
	if (!Object.keys(getItemComposition(validFixture)).length) {
		console.error(`Item composition fixture did not contain composition data.`);
		return false;
	}

	const itemData = {item: [{name: "Test Item", source: "TST", ...validFixture}]};
	const {data: itemDataSanitized, isModified} = getDataWithoutItemComposition(itemData);
	if (
		!isModified
		|| ITEM_COMPOSITION_KEYS.some(prop => Object.hasOwn(itemDataSanitized.item[0], prop))
		|| !ITEM_COMPOSITION_KEYS.some(prop => Object.hasOwn(itemData.item[0], prop))
	) {
		console.error(`Item composition could not be isolated from upstream schema validation.`);
		return false;
	}

	console.log(`##### Item Composition Schema Tests Passed #####`);
	return true;
}

const pMain = main();

if (import.meta.main && !(await pMain)) process.exitCode = 1;

export default pMain;
