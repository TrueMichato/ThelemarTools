import fs from "fs";

import {
	getCombatMethodCorpusErrors,
	getCombatMethodSchemaErrors,
	getCombatMethodValidator,
} from "./util-combatmethods-schema.js";

const FIXTURE_FILES = [
	{filePath: "test/data/combatmethods/valid.json", isValidExpected: true},
	{filePath: "test/data/combatmethods/invalid.json", isValidExpected: false},
];

function testFixtures ({validate}) {
	const errors = [];

	for (const {filePath, isValidExpected} of FIXTURE_FILES) {
		const {cases} = JSON.parse(fs.readFileSync(filePath, "utf8"));

		for (const testCase of cases) {
			const schemaErrors = getCombatMethodSchemaErrors({
				data: testCase.value,
				filePath: `${filePath} :: ${testCase.name}`,
				validate,
			});
			const isValid = !schemaErrors.length;
			if (isValid === isValidExpected) continue;

			if (isValid) errors.push(`${filePath} :: "${testCase.name}" unexpectedly passed.`);
			else errors.push(...schemaErrors);
		}
	}

	return errors;
}

async function main () {
	const validate = getCombatMethodValidator();
	const errors = [
		...testFixtures({validate}),
		...getCombatMethodCorpusErrors(),
	];

	if (errors.length) {
		console.error(`Combat method schema errors:`);
		errors.forEach(error => console.error(`\t${error}`));
		return false;
	}

	console.log(`##### Combat Method Schema Tests Passed #####`);
	return true;
}

const pMain = main();

if (import.meta.main && !(await pMain)) process.exitCode = 1;

export default pMain;
