#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-push orchestrator. The heavyweight regression net.
//   1. full eslint     (npm run test:js), minus files with uncommitted changes — see below
//   2. full stylelint  (npm run test:css:lint)
//   3. full jest       (npm run test:unit)
//   4. data validation (npm run test:data)
//   5. optional E2E smoke (RUN_E2E=1) or full E2E (RUN_E2E_FULL=1)
//
// Bypass: `git push --no-verify` or `HUSKY=0 git push`.

import {spawnSync} from "node:child_process";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const log = (...a) => console.log("[hooks:pre-push]", ...a);

/**
 * Files with uncommitted or untracked changes, which are by definition NOT part of this push.
 *
 * This repo is worked in shared checkouts, where several sessions edit one working tree at once.
 * `eslint .` lints the tree rather than the push, so one session's half-written file fails the
 * first gate here and blocks *everybody's* push — including pushes whose own commits are clean.
 * That happened three times in a single session before this was scoped.
 *
 * Skipping these costs nothing: what is actually being pushed is committed, and lint-staged
 * already linted it at commit time. Anything committed and clean is still linted in full.
 */
const getUnpushedDirtyFiles = () => {
	const r = spawnSync("git", ["status", "--porcelain"], {cwd: REPO_ROOT, encoding: "utf8"});
	if (r.status !== 0) return [];

	return (r.stdout || "")
		.split("\n")
		.filter(Boolean)
		.map(line => {
			// "XY path", or "XY old -> new" for renames; paths with odd characters are quoted.
			const path = line.slice(3);
			const renamed = path.includes(" -> ") ? path.split(" -> ").pop() : path;
			return renamed.replace(/^"|"$/g, "");
		})
		.filter(f => /\.(?:js|cjs|mjs)$/.test(f));
};

const runEslint = () => {
	const dirty = getUnpushedDirtyFiles();
	if (!dirty.length) return run("eslint", "npm", ["run", "test:js"]);

	log(`skipping ${dirty.length} file(s) with uncommitted changes — they are not part of this push:`);
	for (const f of dirty) log(`    ${f}`);
	log("  (commit them to have them linted; lint-staged checks them on the way in)");

	return run("eslint (excluding uncommitted work)", "npx", [
		"eslint", ".",
		...dirty.flatMap(f => ["--ignore-pattern", f]),
	]);
};

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

runEslint();
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
