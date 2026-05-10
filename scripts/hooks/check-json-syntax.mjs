#!/usr/bin/env node
// Fast JSON syntax check for staged data/**/*.json files.
// Used by lint-staged on pre-commit; full schema validation lives in pre-push.

import fs from "node:fs";

const files = process.argv.slice(2);
let failed = 0;

for (const f of files) {
	try {
		const raw = fs.readFileSync(f, "utf8");
		JSON.parse(raw);
	} catch (e) {
		console.error(`\n[hooks] Invalid JSON in ${f}:`);
		console.error(`        ${e.message}`);
		failed++;
	}
}

if (failed > 0) {
	console.error(`\n[hooks] ${failed} file(s) failed JSON syntax check.`);
	process.exit(1);
}
