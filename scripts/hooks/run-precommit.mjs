#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-commit orchestrator. Fast checks only.
//   1. classify staged files; bail early on docs-only commits (lint-staged still runs)
//   2. lint-staged (eslint/stylelint/JSON parse on staged files)
//   3. jest --findRelatedTests for staged JS (+ TGTT pattern when relevant)
//
// Bypass: `git commit --no-verify` or `HUSKY=0 git commit`.

import {spawnSync} from "node:child_process";
import {getStagedFiles, classifyFiles, REPO_ROOT} from "./lib-staged-files.mjs";

const log = (...a) => console.log("[hooks:pre-commit]", ...a);

const run = (cmd, args, label) => {
	log(`▶ ${label}`);
	const r = spawnSync(cmd, args, {cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32"});
	if (r.status !== 0) {
		log(`✗ ${label} failed (exit ${r.status})`);
		return r.status ?? 1;
	}
	log(`✓ ${label}`);
	return 0;
};

const staged = getStagedFiles();
if (staged.length === 0) {
	log("No staged files. Nothing to check.");
	process.exit(0);
}

const cls = classifyFiles(staged);

log(`Staged files: ${staged.length} (js=${cls.js.length}, scss=${cls.scss.length}, dataJson=${cls.dataJson.length}, docsOnly=${cls.docsOnly})`);

// 1. lint-staged always runs (covers eslint/stylelint/JSON parse on the staged set)
let code = run("npx", ["--no-install", "lint-staged"], "lint-staged");
if (code !== 0) process.exit(code);

// 2. Docs-only commits skip jest entirely
if (cls.docsOnly) {
	log("Docs-only commit — skipping jest (use pre-push for a full sweep).");
	process.exit(0);
}

// 3. Jest --findRelatedTests for staged JS
code = run("node", ["scripts/hooks/run-related-jest.mjs"], "jest --findRelatedTests");
if (code !== 0) process.exit(code);

log("All pre-commit checks passed.");
process.exit(0);
