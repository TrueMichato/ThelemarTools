/**
 * Character Sheet Export Filename Tests
 *
 * Regression for the `name.json.json` double-extension bug.
 *
 * `DataUtil.userDownload(filename, …)` (js/utils.js) appends `.json` to the
 * filename it receives. Any charactersheet caller that pre-appends `.json`
 * itself produces `name.json.json`. This test enforces the invariant by
 * scanning every charactersheet source file for a `DataUtil.userDownload(`
 * call whose first argument literal/template ends with `.json`.
 */

import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHARSHEET_DIR = path.resolve(__dirname, "../../../js/charactersheet");

/**
 * Yield every charactersheet .js file (excluding .bak* archives).
 */
function* walkCharsheetSources () {
	const entries = fs.readdirSync(CHARSHEET_DIR, {withFileTypes: true});
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith(".js")) continue;
		if (entry.name.includes(".bak")) continue;
		yield path.join(CHARSHEET_DIR, entry.name);
	}
}

/**
 * Extract the first argument expression of every `DataUtil.userDownload(...)`
 * invocation in `source`. Returns the raw argument substring (unparsed).
 * Handles balanced parens / brackets / template-literal expressions inside
 * the first argument so we don't false-match on `,` inside a `${...}`.
 */
function extractUserDownloadFirstArgs (source) {
	const results = [];
	const callRe = /DataUtil\.userDownload\s*\(/g;
	let match;
	while ((match = callRe.exec(source))) {
		const start = callRe.lastIndex;
		let depth = 1;
		let inSingle = false; let inDouble = false; let inTemplate = false;
		let templateDepth = 0;
		let i = start;
		let firstArgEnd = -1;
		for (; i < source.length; i++) {
			const ch = source[i];
			const prev = source[i - 1];
			if (inSingle) { if (ch === "'" && prev !== "\\") inSingle = false; continue; }
			if (inDouble) { if (ch === "\"" && prev !== "\\") inDouble = false; continue; }
			if (inTemplate) {
				if (ch === "`" && prev !== "\\" && templateDepth === 0) { inTemplate = false; continue; }
				if (ch === "$" && source[i + 1] === "{") { templateDepth++; i++; continue; }
				if (ch === "}" && templateDepth > 0) { templateDepth--; continue; }
				continue;
			}
			if (ch === "'") { inSingle = true; continue; }
			if (ch === "\"") { inDouble = true; continue; }
			if (ch === "`") { inTemplate = true; continue; }
			if (ch === "(" || ch === "{" || ch === "[") { depth++; continue; }
			if (ch === ")" || ch === "}" || ch === "]") {
				depth--;
				if (depth === 0) break;
				continue;
			}
			if (ch === "," && depth === 1) {
				if (firstArgEnd === -1) firstArgEnd = i;
			}
		}
		const argEnd = firstArgEnd !== -1 ? firstArgEnd : i;
		results.push(source.slice(start, argEnd).trim());
	}
	return results;
}

describe("Charactersheet export filename invariants", () => {
	const violations = [];

	for (const filePath of walkCharsheetSources()) {
		const source = fs.readFileSync(filePath, "utf8");
		const args = extractUserDownloadFirstArgs(source);
		for (const arg of args) {
			// The arg is the raw expression. Bug shape: the literal/template
			// ends with `.json"` / `.json'` / `.json\``. We allow the bare
			// suffix `.json` only when it's clearly a path constant inside
			// a non-userDownload context (we already scoped to userDownload
			// first args, so any `.json` ending is a violation).
			if (/\.json["'`]\s*$/.test(arg)) {
				violations.push({file: path.basename(filePath), arg});
			}
		}
	}

	it("no DataUtil.userDownload call passes a `.json`-suffixed basename", () => {
		// `DataUtil.userDownload` already appends `.json` (js/utils.js). Pre-
		// appending it produces `name.json.json` (the bug). If this fails,
		// drop the `.json` from the call and keep any user-facing toast text
		// composing it separately.
		expect(violations).toEqual([]);
	});

	it("scans at least one charactersheet source file", () => {
		// Sanity: ensures the walker is actually finding files. Without this,
		// a future refactor that moves the directory would silently make the
		// invariant test pass-by-default.
		const fileCount = [...walkCharsheetSources()].length;
		expect(fileCount).toBeGreaterThan(5);
	});

	it("finds at least one DataUtil.userDownload call to scan", () => {
		// Sanity: ensures the regex / arg extractor still matches real
		// callers. If this fails, the API was renamed and the invariant
		// above no longer protects anything.
		let total = 0;
		for (const filePath of walkCharsheetSources()) {
			const source = fs.readFileSync(filePath, "utf8");
			total += extractUserDownloadFirstArgs(source).length;
		}
		expect(total).toBeGreaterThan(0);
	});
});
