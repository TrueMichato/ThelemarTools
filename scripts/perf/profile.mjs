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
import {chromium} from "playwright";
import {installInstrumentation, collectLogicalLists} from "./browser-harness.mjs";
import {startLocalServer} from "./server.mjs";
import {compactLogicalLists, READINESS_VERSION} from "./results.mjs";
import {observeErrors} from "./errors.mjs";

const argv = process.argv.slice(2);
const getArg = (name, dflt = null) => {
	const ix = argv.indexOf(`--${name}`);
	return ix === -1 ? dflt : argv[ix + 1];
};
const hasFlag = name => argv.includes(`--${name}`);

const isServe = hasFlag("serve");
const top = Number(getArg("top", 30));
const cpuThrottle = Number(getArg("cpu-throttle", 1));
const viewport = {width: Number(getArg("width", 1440)), height: Number(getArg("height", 1000))};
const server = isServe ? await startLocalServer({port: Number(getArg("port", 0))}) : null;
const url = getArg("url") || `${server?.origin || "http://localhost:5050"}/${getArg("page", "items")}.html`;

let browser;
try {
	browser = await chromium.launch();
	const ctx = await browser.newContext({viewport, serviceWorkers: "block"});
	await ctx.addInitScript(installInstrumentation);
	const page = await ctx.newPage();
	page.setDefaultTimeout(300000);
	const observed = observeErrors(page, {isLocal: isServe});

	const cdp = await ctx.newCDPSession(page);
	await cdp.send("Network.clearBrowserCache");
	await cdp.send("Emulation.setCPUThrottlingRate", {rate: cpuThrottle});
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", {interval: 200});
	await cdp.send("Profiler.start");

	await page.goto(url, {waitUntil: "load", timeout: 300000});

	await page.waitForFunction(() => globalThis.__perfHarness?.listReadyMs != null);

	const {profile} = await cdp.send("Profiler.stop");
	const logical = compactLogicalLists(await page.evaluate(collectLogicalLists));
	const instrumentation = await page.evaluate(() => ({
		reach: globalThis.__perfHarness.reach,
		errors: globalThis.__perfHarness.errors,
		toolsLoadedMs: globalThis.__perfHarness.toolsLoadedMs,
		listReadyMs: globalThis.__perfHarness.listReadyMs,
		rowBuilderCalls: globalThis.__perfHarness.rowBuilderCalls,
		brewCalls: globalThis.__perfHarness.brew.calls,
	}));
	const errors = [...observed.consoleErrors, ...observed.requestErrors, ...instrumentation.errors];
	errors.push(...Object.entries(instrumentation.reach).filter(([, reached]) => !reached).map(([name]) => `Instrumentation not reached: ${name}`));
	if (!instrumentation.rowBuilderCalls || !instrumentation.brewCalls) errors.push("Row-builder/homebrew hooks were installed but not called");
	if (!logical.counter.ok) errors.push("UI counter differs from logical lists");
	for (const list of logical.lists) if (list.duplicateIdentities.length) errors.push(`Duplicate identities in ${list.id}`);

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
	console.log(`${READINESS_VERSION}  Chromium ${browser.version()}  ${viewport.width}x${viewport.height}  CPU ${cpuThrottle}x`);
	console.log(`logical loaded=${logical.lists.reduce((n, l) => n + l.loadedCount, 0)}  matching=${logical.lists.reduce((n, l) => n + l.matchingCount, 0)}  mounted=${logical.lists.reduce((n, l) => n + l.mountedRows, 0)}`);
	console.log(`matching digest=${logical.matchingDigest}  ready=${instrumentation.listReadyMs.toFixed(0)}ms`);
	console.log(`profile span=${spanMs.toFixed(0)}ms  samples=${nSamples}\n`);
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
	if (observed.warnings.length) console.warn(`Optional development resource warnings:\n${observed.warnings.join("\n")}`);
	if (errors.length) {
		console.error(`Profile validation failures:\n${errors.join("\n")}`);
		process.exitCode = 1;
	}
} finally {
	await browser?.close();
	server?.stop();
}
