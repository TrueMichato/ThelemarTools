#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Spawn one or more test characters from the command line.
 *
 *   npm run spawn -- "cleric/tempest/9/dwarf"
 *   npm run spawn -- "fighter/champion/5+warlock/fiend/3" --seed 42 --out char.json
 *   npm run spawn -- --file specs.txt --out-dir out/
 *
 * Boots the same static server the e2e suite uses, drives the real Builder and
 * Quick Build engines in a headless browser, and prints `{spec, report, character}`.
 * Exits non-zero if any spawn left a choice unresolved, so this can gate CI.
 */

import {chromium} from "playwright";
import {spawn} from "child_process";
import fs from "fs";
import path from "path";

const PORT = Number(process.env.SPAWN_PORT || 8080);
const BASE = `http://localhost:${PORT}`;

/** @param {string[]} argv */
function parseArgs (argv) {
	/** @type {{specs: string[], seed: ?string, name: ?string, out: ?string, outDir: ?string, strict: boolean, quiet: boolean, json: boolean}} */
	const out = {specs: [], seed: null, name: null, out: null, outDir: null, strict: false, quiet: false, json: false};
	for (let i = 0; i < argv.length; ++i) {
		const arg = argv[i];
		switch (arg) {
			case "--seed": out.seed = argv[++i]; break;
			case "--name": out.name = argv[++i]; break;
			case "--out": out.out = argv[++i]; break;
			case "--out-dir": out.outDir = argv[++i]; break;
			case "--strict": out.strict = true; break;
			case "--quiet": out.quiet = true; break;
			case "--json": out.json = true; break;
			case "--file": {
				const lines = fs.readFileSync(argv[++i], "utf8").split("\n")
					.map(l => l.trim())
					.filter(l => l && !l.startsWith("#"));
				out.specs.push(...lines);
				break;
			}
			default:
				if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
				out.specs.push(arg);
		}
	}
	if (!out.specs.length) throw new Error(`Usage: npm run spawn -- "cleric/tempest/9/dwarf" [--seed s] [--out file.json] [--file specs.txt] [--out-dir dir] [--strict] [--json]`);
	return out;
}

async function isServerUp () {
	try {
		const res = await fetch(`${BASE}/charactersheet.html`, {method: "HEAD"});
		return res.ok;
	} catch (e) {
		return false;
	}
}

/** Reuse a running server when there is one; otherwise start (and later stop) our own. */
async function ensureServer () {
	if (await isServerUp()) return null;

	const proc = spawn("npx", ["http-server", "-p", String(PORT), "-c-1", "--silent", "."], {stdio: "ignore", detached: false});
	for (let i = 0; i < 60; ++i) {
		await new Promise(resolve => setTimeout(resolve, 500));
		if (await isServerUp()) return proc;
	}
	proc.kill();
	throw new Error(`Static server did not come up on ${BASE}`);
}

async function main () {
	const args = parseArgs(process.argv.slice(2));
	const server = await ensureServer();
	const browser = await chromium.launch();

	/** @type {*[]} */ const results = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", e => console.error(`[page] ${e.message}`));
		await page.goto(`${BASE}/charactersheet.html`, {waitUntil: "domcontentloaded"});
		await page.waitForFunction(() => globalThis.charSheet?.spawn, null, {timeout: 120_000});

		for (const spec of args.specs) {
			const result = await page.evaluate(async ({spec, seed, name}) => {
				try {
					const report = await globalThis.charSheet.spawn(spec, {seed, name, save: false});
					const state = globalThis.charSheet._state;
					return {
						ok: true,
						report: report.toJson(),
						character: state.toJson(),
						summary: {
							name: state.getName(),
							level: state.getTotalLevel(),
							classes: state.getClasses().map((/** @type {*} */ c) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass.name})` : ""}`),
							race: state.getRace()?.name || null,
							background: state.getBackground()?.name || null,
						},
					};
				} catch (e) {
					return {ok: false, error: (/** @type {*} */ (e)).message};
				}
			}, {spec, seed: args.seed, name: args.name});

			result.spec = spec;
			results.push(result);

			if (!args.quiet) {
				if (!result.ok) console.error(`✗ ${spec}: ${result.error}`);
				else {
					const issues = (result.report.unresolved || []).length + (result.report.unhandledPrompts || []).length;
					console.error(`${issues ? "⚠" : "✓"} ${spec} → ${result.summary.classes.join(" / ")}, ${result.summary.race || "?"}${issues ? ` (${issues} issue(s))` : ""}`);
					for (const u of result.report.unresolved || []) console.error(`    ✗ ${u}`);
					for (const u of result.report.unhandledPrompts || []) console.error(`    ? unhandled prompt: ${u}`);
				}
			}
		}
	} finally {
		await browser.close();
		server?.kill();
	}

	if (args.outDir) {
		fs.mkdirSync(args.outDir, {recursive: true});
		results.forEach((result, i) => {
			const slug = String(result.spec).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || `spawn-${i}`;
			fs.writeFileSync(path.join(args.outDir, `${slug}.json`), JSON.stringify(result, null, "\t"));
		});
	}

	const payload = results.length === 1 ? results[0] : results;
	if (args.out) fs.writeFileSync(args.out, JSON.stringify(payload, null, "\t"));
	// A full character is tens of thousands of lines of rendered HTML — only dump it when
	// someone can actually consume it (a pipe, or an explicit `--json`). An interactive run
	// gets the readable choice report instead.
	else if (!args.outDir && (args.json || !process.stdout.isTTY)) console.log(JSON.stringify(payload, null, "\t"));
	else if (!args.outDir && !args.quiet) results.filter(r => r.ok).forEach(r => console.log(r.report.text || ""));

	const failed = results.some(r => !r.ok);
	const dirty = results.some(r => r.ok && ((r.report.unresolved || []).length || (r.report.unhandledPrompts || []).length));
	process.exit(failed || (args.strict && dirty) ? 1 : 0);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
