#!/usr/bin/env node
/* eslint-disable no-console */
// Run jest only on tests related to staged JS files.
// Also triggers a TGTT-pattern run when js/tgtt-filter.js or any TGTT test file
// is staged, since tgtt-filter is brittle and worth re-running broadly.

import {spawnSync} from "node:child_process";
import path from "node:path";
import {getStagedFiles, filterExisting, classifyFiles, REPO_ROOT} from "./lib-staged-files.mjs";

const log = (...a) => console.log("[hooks:jest]", ...a);

const runJest = (extraArgs, label) => {
	log(`Running jest: ${label}`);
	const env = {
		...process.env,
		NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-vm-modules"]
			.filter(Boolean).join(" "),
	};
	const result = spawnSync(
		process.execPath,
		[
			"--localstorage-file", "test/localstorage.tmp",
			"node_modules/jest/bin/jest.js",
			"--no-coverage",
			"--bail",
			"--passWithNoTests",
			...extraArgs,
		],
		{cwd: REPO_ROOT, stdio: "inherit", env},
	);
	return result.status ?? 1;
};

const main = () => {
	const staged = getStagedFiles();
	const cls = classifyFiles(staged);

	if (cls.js.length === 0 && !cls.tgttFilterTouched) {
		log("No staged JS files; skipping related-tests pass.");
		return 0;
	}

	let exit = 0;

	const stagedJsExisting = filterExisting(cls.js)
		.map(f => path.resolve(REPO_ROOT, f));

	if (stagedJsExisting.length > 0) {
		const code = runJest(
			["--findRelatedTests", ...stagedJsExisting],
			`--findRelatedTests over ${stagedJsExisting.length} staged JS file(s)`,
		);
		if (code !== 0) exit = code;
	}

	if (exit === 0 && cls.tgttFilterTouched) {
		log("TGTT surface touched — running TGTT pattern pass.");
		const code = runJest(
			["--testPathPattern=TGTT"],
			"--testPathPattern=TGTT",
		);
		if (code !== 0) exit = code;
	}

	return exit;
};

process.exit(main());
