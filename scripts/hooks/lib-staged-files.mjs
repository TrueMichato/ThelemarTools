// Shared helpers for git pre-commit / pre-push hooks.
// Plain Node, no extra deps — keeps hooks fast and cross-platform.

import {execSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

export const getStagedFiles = () => {
	try {
		const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		return out.split("\n").map(s => s.trim()).filter(Boolean);
	} catch (e) {
		console.error("[hooks] Failed to read staged files:", e.message);
		return [];
	}
};

export const filterExisting = (files) => files.filter(f => {
	try { return fs.existsSync(path.join(REPO_ROOT, f)); }
	catch { return false; }
});

const DOC_PATTERNS = [
	/^docs\//,
	/^\.agents\//,
	/\.md$/i,
	/^LICENSE/i,
	/^README/i,
	/^bugs[^/]*\.md$/i,
	/^NOTES_[A-Z_]+\.md$/i,
	/^CHARACTERSHEET_TEST_AUDIT\.md$/i,
	/^LEVELUP_REFACTOR_MAP\.md$/i,
	/^CONTRIBUTING\.md$/i,
	/^ISSUE_TEMPLATE\.md$/i,
];

const isDocFile = (f) => DOC_PATTERNS.some(re => re.test(f));

export const classifyFiles = (files) => {
	const out = {
		all: files,
		docsOnly: files.length > 0 && files.every(isDocFile),
		js: files.filter(f => /\.(c|m)?js$/i.test(f)),
		scss: files.filter(f => /\.scss$/i.test(f)),
		dataJson: files.filter(f => /^data\/.*\.json$/i.test(f)),
		tgttFilterTouched:
			files.some(f => f === "js/tgtt-filter.js")
			|| files.some(f => /test\/jest\/charactersheet\/.*TGTT.*\.test\.js$/i.test(f)),
		charsheetSrcTouched: files.some(f => /^js\/charactersheet\//.test(f)),
		dmscreenSrcTouched: files.some(f => /^js\/dmscreen\//.test(f)),
	};
	return out;
};

export {REPO_ROOT};
