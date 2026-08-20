#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-push orchestrator. The heavyweight regression net.
//   1. full eslint     (npm run test:js)
//   2. full stylelint  (npm run test:css:lint)
//   3. full jest       (npm run test:unit)
//   4. data validation (npm run test:data)
//   5. optional E2E smoke (RUN_E2E=1) or full E2E (RUN_E2E_FULL=1)
//
// These run against a throwaway worktree checked out at the commit being pushed —
// NOT against the working tree. See `withPushedTree` below for why.
//
// Bypass: `git push --no-verify` or `HUSKY=0 git push`.

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const log = (...a) => console.log("[hooks:pre-push]", ...a);

/**
 * The commit this push would put on the remote.
 *
 * git feeds pre-push one line per ref on stdin: `<local ref> <local sha> <remote ref> <remote sha>`.
 * An all-zero local sha is a branch *deletion*, which has no tree to test.
 * Falls back to HEAD when there is no stdin (someone ran this script by hand).
 */
const getPushedSha = () => {
	if (process.stdin.isTTY) return "HEAD";

	let raw = "";
	try {
		raw = fs.readFileSync(0, "utf8");
	} catch {
		return "HEAD";
	}

	const shas = raw
		.split("\n")
		.filter(Boolean)
		.map(line => line.split(/\s+/)[1])
		.filter(sha => sha && !/^0+$/.test(sha));

	if (shas.length) return shas[shas.length - 1];
	return raw.trim() ? null : "HEAD";
};

const git = (...args) => spawnSync("git", args, {cwd: REPO_ROOT, encoding: "utf8"});

/**
 * Local-only inputs the gates need, which are deliberately not in git.
 *
 * These are *environment*, not content: linking them keeps the worktree run as powerful as a
 * working-tree run. Getting this wrong is expensive and silent — `npc-exports/` alone carries
 * **759 of the suite's tests** (`CharacterSheetNpcExporter.realsaves.test.js` filters its corpus
 * on `existsSync`), so a worktree without it reports a green 16,359 instead of a green 17,118
 * and nobody notices the gate got weaker.
 */
const LOCAL_INPUTS = [
	"node_modules", // installing per-push would cost minutes; the worktree only reads these
	".cache", // crafting source-book cache; without it CraftingDataFreshness tries to refetch
	"npc-exports", // the untracked NPC corpus behind the exporter's real-save tests
];

/**
 * Run `fn` against a throwaway worktree checked out at `sha`, and clean it up afterwards.
 *
 * This repo is worked in shared checkouts — several sessions edit one working tree at once.
 * `eslint .` and `jest` both walk the *tree*, not the push, so one session's half-written file
 * fails a gate and blocks *everybody's* push, including pushes whose own commits are clean.
 * That happened three times in one session, and again across two sessions afterwards.
 *
 * The previous mitigation passed `--ignore-pattern` for each dirty file. That scoped only eslint
 * — jest and stylelint still walked the working tree — and where it did apply it *under*-tested:
 * a file with a committed change that you then kept editing was skipped entirely, so the very
 * version being pushed went unlinted.
 *
 * Testing the pushed commit instead fixes both directions at once: no session can break another
 * session's push, and nothing being pushed goes untested. Note this deliberately excludes
 * untracked *source* files — a test file you have not committed is not part of this push and
 * will not run here. Untracked *inputs* are a different thing; see `LOCAL_INPUTS`.
 *
 * `git worktree` is safe under concurrency in a way `git stash` emphatically is not: it never
 * touches the shared working tree or the index.
 */
const withPushedTree = (sha, fn) => {
	git("worktree", "prune");

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-"));
	const tree = path.join(dir, "t");

	const added = git("worktree", "add", "--detach", "-q", tree, sha);
	if (added.status !== 0) {
		log("⚠ could not create a worktree for the pushed commit; falling back to the working tree.");
		log(`  (${(added.stderr || "").trim()})`);
		log("  A dirty file from another session may block this push.");
		fs.rmSync(dir, {recursive: true, force: true});
		return fn(REPO_ROOT);
	}

	for (const rel of LOCAL_INPUTS) {
		const src = path.join(REPO_ROOT, rel);
		if (!fs.existsSync(src)) {
			log(`⚠ ${rel}/ is absent, so tests that depend on it will skip — this gate is weaker than usual.`);
			continue;
		}
		try {
			fs.symlinkSync(src, path.join(tree, rel), "dir");
		} catch (e) {
			log(`⚠ could not link ${rel} into the worktree: ${e.message}`);
		}
	}

	try {
		return fn(tree);
	} finally {
		git("worktree", "remove", "--force", tree);
		fs.rmSync(dir, {recursive: true, force: true});
		git("worktree", "prune");
	}
};

/**
 * Thrown rather than exiting on the spot: `process.exit()` skips `finally`, which would leak the
 * throwaway worktree on every *failing* push — the exact case where it happens most.
 */
class GateFailure extends Error {
	constructor (label, code) {
		super(`${label} failed (exit ${code})`);
		this.code = code ?? 1;
	}
}

const run = (label, cmd, args, cwd = REPO_ROOT) => {
	log(`▶ ${label}`);
	const r = spawnSync(cmd, args, {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (r.status !== 0) {
		log(`✗ ${label} failed (exit ${r.status})`);
		throw new GateFailure(label, r.status);
	}
	log(`✓ ${label}`);
};

const sha = getPushedSha();

try {
	if (sha === null) {
		log("nothing to test (branch deletion only).");
	} else {
		withPushedTree(sha, tree => {
			if (tree !== REPO_ROOT) log(`testing the pushed commit ${sha.slice(0, 8)} in an isolated worktree`);

			run("eslint", "npm", ["run", "test:js"], tree);
			run("stylelint", "npm", ["run", "test:css:lint"], tree);
			run("jest (full)", "npm", ["run", "test:unit", "--", "--no-coverage"], tree);
			// run("data validation", "npm", ["run", "test:data"], tree);

			if (process.env.RUN_E2E_FULL === "1") {
				run("playwright (full suite)", "npx", ["playwright", "test"], tree);
			} else if (process.env.RUN_E2E === "1") {
				run("playwright (smoke subset)", "node", ["scripts/hooks/run-e2e-smoke.mjs"], tree);
			} else {
				log("E2E skipped — set RUN_E2E=1 for the smoke subset or RUN_E2E_FULL=1 for the full Playwright suite.");
			}
		});
	}
} catch (e) {
	if (e instanceof GateFailure) process.exit(e.code);
	throw e;
}

log("All pre-push checks passed.");
