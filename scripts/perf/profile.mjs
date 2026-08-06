#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * CPU-profile a page load and report the functions with the highest self time.
 *
 * `measure.mjs` tells you *whether* a change helped. This tells you *where to look next* — it is
 * what identified the two largest wins found so far (a full-payload MD5 on every page load, and a
 * quadratic `_copy` parent search).
 *
 * Usage:
 *   node scripts/perf/profile.mjs --serve --page items
 *   node scripts/perf/profile.mjs --url https://truemichato.github.io/ThelemarTools/bestiary.html
 *
 * Read the output as: anything with a high *self* time is doing the work itself, and is a
 * candidate. `(program)` is native work (JSON parsing, compilation, GC) and `(idle)` is waiting on
 * the network — neither is directly actionable.
 */
import {spawn} from "child_process";
import {chromium} from "playwright";

const argv = process.argv.slice(2);
const getArg = (name, dflt = null) => {
	const ix = argv.indexOf(`--${name}`);
	return ix === -1 ? dflt : argv[ix + 1];
};
const hasFlag = name => argv.includes(`--${name}`);

const PORT = 5099;
const isServe = hasFlag("serve");
const top = Number(getArg("top", 30));
const url = getArg("url") || `http://localhost:${PORT}/${getArg("page", "items")}.html`;

let server = null;
if (isServe) {
	server = spawn("npx", ["http-server", "-p", String(PORT), "-c", "600", "--silent"], {stdio: "ignore", detached: false});
	await new Promise(resolve => setTimeout(resolve, 4000));
}

const browser = await chromium.launch();
try {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.setDefaultTimeout(300000);

	const cdp = await ctx.newCDPSession(page);
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", {interval: 200});
	await cdp.send("Profiler.start");

	await page.goto(url, {waitUntil: "load", timeout: 300000});

	// Wait for the list to stop growing, so the profile covers the whole load.
	let rows = -1;
	let stable = 0;
	for (let i = 0; i < 1200; ++i) {
		const n = await page.evaluate("document.querySelectorAll('.ve-lst__row').length");
		if (n > 0 && n === rows) { if (++stable > 5) break; } else stable = 0;
		rows = n;
		await page.waitForTimeout(50);
	}

	const {profile} = await cdp.send("Profiler.stop");

	const byNode = new Map(profile.nodes.map(n => [n.id, n]));
	const self = new Map();
	for (const sample of profile.samples) {
		const node = byNode.get(sample);
		if (!node) continue;
		const {functionName, url: fnUrl, lineNumber} = node.callFrame;
		const file = (fnUrl || "").replace(/^https?:\/\/[^/]+\//, "");
		const key = `${functionName || "(anonymous)"}  @ ${file}:${lineNumber + 1}`;
		self.set(key, (self.get(key) || 0) + 1);
	}

	const spanMs = (profile.endTime - profile.startTime) / 1000;
	const nSamples = profile.samples.length;

	console.log(`\n${url}`);
	console.log(`rows=${rows}  profile span=${spanMs.toFixed(0)}ms  samples=${nSamples}\n`);
	console.log("  self%      self   function");
	console.log("  -----   -------   --------");
	[...self.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, top)
		.forEach(([name, count]) => {
			const ms = (count / nSamples) * spanMs;
			const pct = (count / nSamples) * 100;
			console.log(`  ${pct.toFixed(1).padStart(5)}%   ${`${ms.toFixed(0)}ms`.padStart(7)}   ${name}`);
		});
	console.log("");
} finally {
	await browser.close();
	if (server) process.kill(-server.pid < 0 ? server.pid : server.pid);
}
