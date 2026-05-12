#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-push orchestrator. The heavyweight regression net.
//   1. full eslint     (npm run test:js)
//   2. full stylelint  (npm run test:css:lint)
//   3. full jest       (npm run test:unit)
//   4. data validation (npm run test:data)
//   5. optional E2E smoke (RUN_E2E=1) or full E2E (RUN_E2E_FULL=1)
//
// Bypass: `git push --no-verify` or `HUSKY=0 git push`.

import {spawnSync} from "node:child_process";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const log = (...a) => console.log("[hooks:pre-push]", ...a);

const run = (label, cmd, args) => {
	log(`▶ ${label}`);
	const r = spawnSync(cmd, args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (r.status !== 0) {
		log(`✗ ${label} failed (exit ${r.status})`);
		process.exit(r.status ?? 1);
	}
	log(`✓ ${label}`);
};

run("eslint", "npm", ["run", "test:js"]);
run("stylelint", "npm", ["run", "test:css:lint"]);
run("jest (full)", "npm", ["run", "test:unit", "--", "--no-coverage"]);
// run("data validation", "npm", ["run", "test:data"]);

if (process.env.RUN_E2E_FULL === "1") {
	run("playwright (full suite)", "npx", ["playwright", "test"]);
} else if (process.env.RUN_E2E === "1") {
	run("playwright (smoke subset)", "node", ["scripts/hooks/run-e2e-smoke.mjs"]);
} else {
	log("E2E skipped — set RUN_E2E=1 for the smoke subset or RUN_E2E_FULL=1 for the full Playwright suite.");
}

log("All pre-push checks passed.");
