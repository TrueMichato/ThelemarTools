#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Page-load performance harness.
 *
 * Loads a set of content pages in a real Chromium browser and records the numbers we use to
 * decide whether a performance change actually helped:
 *
 *   - time to a populated list (the moment the page becomes usable)
 *   - total main-thread long-task time, and the largest single long task
 *   - request count, bytes transferred, and how many requests went to remote homebrew hosts
 *   - how long `BrewUtil2` spent fetching / processing homebrew
 *   - per-prop homebrew entity counts, used as a correctness check rather than a perf metric
 *
 * Results are written to JSON so two runs can be diffed with `--baseline`.
 *
 * Usage:
 *   node scripts/perf/measure.mjs --origin https://truemichato.github.io/ThelemarTools
 *   node scripts/perf/measure.mjs --out before.json
 *   node scripts/perf/measure.mjs --baseline before.json --out after.json
 *
 * See `scripts/perf/README.md` for the full workflow.
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {spawn} from "child_process";
import {chromium} from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_PAGES = ["bestiary", "spells", "items", "classes", "crafting"];
const DEFAULT_ORIGIN = "http://localhost:5050";

/** Port used by `--serve`. Deliberately not 5050 so it can't collide with a dev server. */
const SERVE_PORT = 5099;

/** GitHub Pages serves everything with `max-age=600` and that cannot be configured. Matching it
 * locally keeps `--serve` measurements comparable with production ones. */
const SERVE_MAX_AGE_SECONDS = 600;

/** Hosts that serve homebrew from outside our own origin. Counted separately because they are
 * uncacheable by our service worker and sit on the critical path. */
const REMOTE_BREW_HOST_RE = /githubusercontent\.com|(?:^|\/\/)(?:www\.)?github\.com/;

/** Rows only appear once the list has been built, so this is our "page is usable" signal.
 * Pages differ hugely in row count (classes has 33, items has 5734), so rather than a fixed
 * threshold we wait for the count to stop growing. */
const LIST_ROW_SELECTOR = ".ve-lst__row";

/** How long the row count must hold steady before we call the list built. */
const LIST_STABLE_MS = 250;

/* ---------------------------------------------------------------------------------------------
 * Argument parsing
 * ------------------------------------------------------------------------------------------ */

function parseArgs (argv) {
	const out = {
		origin: DEFAULT_ORIGIN,
		pages: [...DEFAULT_PAGES],
		runs: 3,
		timeoutMs: 90_000,
		out: null,
		baseline: null,
		label: null,
		headed: false,
		coldOnly: false,
		serve: false,
		noisePct: 5,
	};

	for (let i = 0; i < argv.length; ++i) {
		const arg = argv[i];
		const next = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`Missing value for ${arg}`);
			return v;
		};

		switch (arg) {
			case "--origin": out.origin = next().replace(/\/+$/, ""); break;
			case "--pages": out.pages = next().split(",").map(it => it.trim()).filter(Boolean); break;
			case "--runs": out.runs = Number(next()); break;
			case "--timeout": out.timeoutMs = Number(next()); break;
			case "--out": out.out = next(); break;
			case "--baseline": out.baseline = next(); break;
			case "--label": out.label = next(); break;
			case "--headed": out.headed = true; break;
			case "--cold-only": out.coldOnly = true; break;
			case "--serve": out.serve = true; break;
			case "--noise": out.noisePct = Number(next()); break;
			case "--help": case "-h": printHelpAndExit(); break;
			default: throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!Number.isFinite(out.runs) || out.runs < 1) throw new Error(`--runs must be a positive integer`);
	return out;
}

function printHelpAndExit () {
	console.log(`
Page-load performance harness.

  --origin <url>      Origin to measure. Default: ${DEFAULT_ORIGIN}
  --pages <a,b,c>     Comma-separated page names (no .html). Default: ${DEFAULT_PAGES.join(",")}
  --runs <n>          Measured runs per page; the median is reported. Default: 3
  --timeout <ms>      Per-run timeout waiting for the list. Default: 90000
  --out <file>        Write results JSON here.
  --baseline <file>   Compare against a previous results file and print a delta table.
  --label <text>      Free-text label stored in the results (e.g. the branch name).
  --headed            Run with a visible browser window.
  --cold-only         Skip the warm-cache pass.
  --serve             Start a local server on this checkout (port ${SERVE_PORT}, max-age=${SERVE_MAX_AGE_SECONDS})
                      and measure that instead of --origin. Use this to measure code changes.
  --noise <pct>       Ignore deltas smaller than this percentage. Default: 5
`.trim());
	process.exit(0);
}

/* ---------------------------------------------------------------------------------------------
 * In-page instrumentation
 *
 * This runs before any application script, so it can wrap BrewUtil2 as soon as it appears and
 * observe long tasks from the very start of the load.
 * ------------------------------------------------------------------------------------------ */

const INIT_SCRIPT = `
(() => {
	const H = globalThis.__perfHarness = {
		longTasks: [],
		brew: {rawMs: null, processedMs: null, calls: 0},
		firstRowMs: null,
		listReadyMs: null,
		listRows: 0,
	};

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) H.longTasks.push({start: entry.startTime, duration: entry.duration});
		}).observe({entryTypes: ["longtask"]});
	} catch (ignored) { /* longtask unsupported */ }

	// BrewUtil2 is created during module evaluation, so poll for it rather than racing the import.
	const wrapBrew = () => {
		const B = globalThis.BrewUtil2;
		if (!B || B.__perfWrapped) return !!B;
		B.__perfWrapped = true;

		const wrap = (methodName, bucket) => {
			const original = B[methodName];
			if (typeof original !== "function") return;
			B[methodName] = async function (...args) {
				const t0 = performance.now();
				try { return await original.apply(this, args); } finally {
					H.brew[bucket] = (H.brew[bucket] || 0) + (performance.now() - t0);
					if (bucket === "processedMs") H.brew.calls++;
				}
			};
		};

		wrap("_pGetBrewRaw_", "rawMs");
		wrap("_pGetBrewProcessed_", "processedMs");
		return true;
	};

	const brewPoll = setInterval(() => { if (wrapBrew()) clearInterval(brewPoll); }, 5);
	setTimeout(() => clearInterval(brewPoll), 30000);

	// Wait for the row count to appear and then stop changing, rather than for a fixed row count:
	// pages legitimately range from 33 rows (classes) to 5734 (items).
	let lastCount = 0;
	let stableSince = null;
	const listPoll = setInterval(() => {
		const n = document.querySelectorAll(${JSON.stringify(LIST_ROW_SELECTOR)}).length;

		if (n === 0) return;
		if (H.firstRowMs == null) H.firstRowMs = performance.now();

		if (n !== lastCount) { lastCount = n; stableSince = performance.now(); return; }
		if (stableSince == null) { stableSince = performance.now(); return; }

		if (performance.now() - stableSince >= ${LIST_STABLE_MS}) {
			H.listReadyMs = stableSince;
			H.listRows = n;
			clearInterval(listPoll);
		}
	}, 25);
	setTimeout(() => clearInterval(listPoll), 120000);
})();
`;

/* ---------------------------------------------------------------------------------------------
 * Collection
 * ------------------------------------------------------------------------------------------ */

/** Read everything the instrumentation gathered, plus resource timings, out of the page.
 * Written as an immediately-invoked expression because Playwright evaluates string scripts as
 * expressions rather than calling them. */
const COLLECT_FN = `(async () => {
	const H = globalThis.__perfHarness || {};
	const resources = performance.getEntriesByType("resource");

	const remoteBrew = resources.filter(r => ${REMOTE_BREW_HOST_RE.toString()}.test(r.name));
	const bytesTransferred = resources.reduce((acc, r) => acc + (r.transferSize || 0), 0);
	const bytesDecoded = resources.reduce((acc, r) => acc + (r.decodedBodySize || 0), 0);
	const servedFromCache = resources.filter(r => r.transferSize === 0 && r.decodedBodySize > 0).length;

	const longTasks = H.longTasks || [];
	const nav = performance.getEntriesByType("navigation")[0];

	// Per-prop homebrew entity counts. Purely a correctness signal: these must not change.
	let brewProps = null;
	try {
		const B = globalThis.BrewUtil2;
		if (B && typeof B.pGetBrewProcessed === "function") {
			const processed = await B.pGetBrewProcessed();
			brewProps = {};
			for (const [prop, value] of Object.entries(processed || {})) {
				if (prop.startsWith("_")) continue;
				if (Array.isArray(value)) brewProps[prop] = value.length;
			}
		}
	} catch (e) { brewProps = {__error: String(e && e.message || e)}; }

	return {
		firstRowMs: H.firstRowMs == null ? null : Math.round(H.firstRowMs),
		listReadyMs: H.listReadyMs == null ? null : Math.round(H.listReadyMs),
		listRows: H.listRows || 0,
		longTaskTotalMs: Math.round(longTasks.reduce((acc, t) => acc + t.duration, 0)),
		longTaskCount: longTasks.length,
		longTaskMaxMs: longTasks.length ? Math.round(Math.max(...longTasks.map(t => t.duration))) : 0,
		brewRawMs: H.brew && H.brew.rawMs != null ? Math.round(H.brew.rawMs) : null,
		brewProcessedMs: H.brew && H.brew.processedMs != null ? Math.round(H.brew.processedMs) : null,
		brewProcessedCalls: H.brew ? H.brew.calls : 0,
		requestCount: resources.length,
		remoteBrewRequestCount: remoteBrew.length,
		remoteBrewLastEndMs: remoteBrew.length ? Math.round(Math.max(...remoteBrew.map(r => r.responseEnd))) : 0,
		servedFromCacheCount: servedFromCache,
		bytesTransferred,
		bytesDecoded,
		domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
		brewProps,
	};
})()`;

async function measureOnce ({context, url, timeoutMs, isClearCache = false}) {
	const page = await context.newPage();
	const consoleErrors = [];
	page.on("pageerror", err => consoleErrors.push(String(err?.message ?? err)));
	page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

	try {
		// Browser contexts share Chromium's HTTP cache, so a fresh context is *not* a cold cache.
		// Clear it explicitly, otherwise every page after the first measures as warm.
		if (isClearCache) {
			const cdp = await context.newCDPSession(page);
			await cdp.send("Network.clearBrowserCache");
			await cdp.detach();
		}

		await page.goto(url, {waitUntil: "commit", timeout: timeoutMs});

		let timedOut = false;
		try {
			await page.waitForFunction(
				`globalThis.__perfHarness && globalThis.__perfHarness.listReadyMs != null`,
				null,
				{timeout: timeoutMs},
			);
		} catch (e) { timedOut = true; }

		// Let any tail work settle so long-task totals aren't truncated mid-task.
		await page.waitForTimeout(500);

		const result = await page.evaluate(COLLECT_FN);
		return {...result, timedOut, consoleErrors: consoleErrors.slice(0, 10)};
	} finally {
		await page.close();
	}
}

/* ---------------------------------------------------------------------------------------------
 * Stats helpers
 * ------------------------------------------------------------------------------------------ */

function median (values) {
	const nums = values.filter(v => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
	if (!nums.length) return null;
	const mid = nums.length >> 1;
	return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

const MEDIAN_METRICS = [
	"firstRowMs", "listReadyMs", "listRows", "longTaskTotalMs", "longTaskCount", "longTaskMaxMs",
	"brewRawMs", "brewProcessedMs", "requestCount", "remoteBrewRequestCount",
	"remoteBrewLastEndMs", "servedFromCacheCount", "bytesTransferred", "bytesDecoded",
	"domContentLoadedMs",
];

function summarise (runs) {
	const summary = {};
	for (const metric of MEDIAN_METRICS) summary[metric] = median(runs.map(r => r[metric]));

	// Correctness data is taken from the last successful run; it should be identical across runs.
	const withProps = [...runs].reverse().find(r => r.brewProps);
	summary.brewProps = withProps ? withProps.brewProps : null;

	summary.timedOutRuns = runs.filter(r => r.timedOut).length;
	summary.consoleErrors = [...new Set(runs.flatMap(r => r.consoleErrors || []))].slice(0, 10);
	return summary;
}

/* ---------------------------------------------------------------------------------------------
 * Reporting
 * ------------------------------------------------------------------------------------------ */

const fmtMs = v => v == null ? "-" : `${(v / 1000).toFixed(2)}s`;
const fmtMb = v => v == null ? "-" : `${(v / 1048576).toFixed(2)}MB`;
const fmtNum = v => v == null ? "-" : String(v);

function printResults (results) {
	const header = ["page", "phase", "firstRow", "usable", "longTasks", "maxTask", "brewProc", "reqs", "remoteBrew", "transfer", "rows"];
	const rows = [header];

	for (const [pageName, phases] of Object.entries(results.pages)) {
		for (const [phaseName, s] of Object.entries(phases)) {
			rows.push([
				pageName, phaseName, fmtMs(s.firstRowMs), fmtMs(s.listReadyMs), fmtMs(s.longTaskTotalMs), fmtMs(s.longTaskMaxMs),
				fmtMs(s.brewProcessedMs), fmtNum(s.requestCount), fmtNum(s.remoteBrewRequestCount),
				fmtMb(s.bytesTransferred), fmtNum(s.listRows),
			]);
		}
	}

	printTable(rows);
}

function printTable (rows) {
	const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
	rows.forEach((row, ix) => {
		console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
		if (ix === 0) console.log(widths.map(w => "-".repeat(w)).join("  "));
	});
}

/** Metrics where a lower number is an improvement. */
const LOWER_IS_BETTER = new Set([
	"firstRowMs", "listReadyMs", "longTaskTotalMs", "longTaskMaxMs", "brewProcessedMs", "brewRawMs",
	"requestCount", "remoteBrewRequestCount", "remoteBrewLastEndMs", "bytesTransferred",
]);

const COMPARED_METRICS = ["firstRowMs", "listReadyMs", "longTaskTotalMs", "longTaskMaxMs", "brewProcessedMs", "requestCount", "remoteBrewRequestCount", "bytesTransferred"];

function printComparison (baseline, current, noisePct) {
	console.log(`\nComparison vs baseline (${baseline.label || baseline.startedAt}); ignoring deltas below ${noisePct}%\n`);

	const rows = [["page", "phase", "metric", "before", "after", "delta"]];
	let regressions = 0;

	for (const [pageName, phases] of Object.entries(current.pages)) {
		for (const [phaseName, after] of Object.entries(phases)) {
			const before = baseline.pages?.[pageName]?.[phaseName];
			if (!before) continue;

			for (const metric of COMPARED_METRICS) {
				const b = before[metric];
				const a = after[metric];
				if (b == null || a == null || b === 0) continue;

				const pct = ((a - b) / b) * 100;
				if (Math.abs(pct) < noisePct) continue;

				const better = LOWER_IS_BETTER.has(metric) ? a < b : a > b;
				if (!better) regressions++;

				const fmt = metric === "bytesTransferred" ? fmtMb : (metric.endsWith("Ms") ? fmtMs : fmtNum);
				rows.push([
					pageName, phaseName, metric, fmt(b), fmt(a),
					`${pct > 0 ? "+" : ""}${pct.toFixed(1)}%  ${better ? "better" : "WORSE"}`,
				]);
			}
		}
	}

	if (rows.length === 1) console.log(`No metric moved by more than ${noisePct}%.`);
	else printTable(rows);

	printCorrectnessDiff(baseline, current);
	return regressions;
}

/**
 * Per-prop homebrew entity counts must be byte-identical before and after. Any difference means
 * content was lost or duplicated, which is a correctness failure regardless of the timings.
 */
function printCorrectnessDiff (baseline, current) {
	console.log(`\nCorrectness check (homebrew entity counts per prop)\n`);
	let anyDiff = false;

	for (const [pageName, phases] of Object.entries(current.pages)) {
		for (const [phaseName, after] of Object.entries(phases)) {
			const before = baseline.pages?.[pageName]?.[phaseName];
			if (!before?.brewProps || !after?.brewProps) continue;

			const props = [...new Set([...Object.keys(before.brewProps), ...Object.keys(after.brewProps)])].sort();
			const diffs = props
				.filter(p => (before.brewProps[p] ?? 0) !== (after.brewProps[p] ?? 0))
				.map(p => `${p}: ${before.brewProps[p] ?? 0} -> ${after.brewProps[p] ?? 0}`);

			if (diffs.length) {
				anyDiff = true;
				console.log(`  ${pageName} (${phaseName}): ${diffs.join(", ")}`);
			}
		}
	}

	if (!anyDiff) console.log("  No differences. Homebrew content is unchanged.");
	return anyDiff;
}

/* ---------------------------------------------------------------------------------------------
 * Local server (--serve)
 * ------------------------------------------------------------------------------------------ */

/**
 * Serve this checkout with production-like cache headers so local measurements of code changes
 * are comparable with measurements of the deployed site.
 */
async function startLocalServer () {
	const child = spawn(
		process.execPath,
		[
			path.join(REPO_ROOT, "node_modules", "http-server", "bin", "http-server"),
			REPO_ROOT,
			"-p", String(SERVE_PORT),
			"-c", String(SERVE_MAX_AGE_SECONDS),
			"--cors",
			"--silent",
		],
		{cwd: REPO_ROOT, stdio: "ignore"},
	);

	const origin = `http://localhost:${SERVE_PORT}`;
	const deadline = Date.now() + 20_000;

	for (;;) {
		if (child.exitCode != null) throw new Error(`Local server exited with code ${child.exitCode}`);
		try {
			const res = await fetch(`${origin}/bestiary.html`, {method: "HEAD"});
			if (res.ok) break;
		} catch (ignored) { /* not up yet */ }

		if (Date.now() > deadline) {
			child.kill();
			throw new Error(`Local server did not start on port ${SERVE_PORT} within 20s`);
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}

	console.log(`Started local server on ${origin} (max-age=${SERVE_MAX_AGE_SECONDS})`);
	return {origin, stop: () => child.kill()};
}

/* ---------------------------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------------------------ */

async function main () {
	const opts = parseArgs(process.argv.slice(2));

	const server = opts.serve ? await startLocalServer() : null;
	if (server) opts.origin = server.origin;

	console.log(`Measuring ${opts.origin}`);
	console.log(`Pages: ${opts.pages.join(", ")}  |  runs per phase: ${opts.runs}\n`);

	const browser = await chromium.launch({headless: !opts.headed});
	const results = {
		label: opts.label,
		origin: opts.origin,
		startedAt: new Date().toISOString(),
		runsPerPhase: opts.runs,
		pages: {},
	};

	try {
		for (const pageName of opts.pages) {
			const url = `${opts.origin}/${pageName}.html`;
			results.pages[pageName] = {};

			// A fresh context per phase gives us a genuinely empty HTTP cache for the cold pass.
			const phases = opts.coldOnly ? ["cold"] : ["cold", "warm"];
			for (const phase of phases) {
				const context = await browser.newContext();
				await context.addInitScript(INIT_SCRIPT);

				try {
					// The warm phase gets one unmeasured priming load to populate the HTTP cache.
					if (phase === "warm") await measureOnce({context, url, timeoutMs: opts.timeoutMs});

					const runs = [];
					for (let i = 0; i < opts.runs; ++i) {
						process.stdout.write(`  ${pageName} ${phase} run ${i + 1}/${opts.runs}\r`);
						runs.push(await measureOnce({context, url, timeoutMs: opts.timeoutMs, isClearCache: phase === "cold"}));
					}

					results.pages[pageName][phase] = summarise(runs);
				} finally {
					await context.close();
				}
			}

			process.stdout.write(`${" ".repeat(60)}\r`);
			console.log(`  ${pageName}: done`);
		}
	} finally {
		await browser.close();
		if (server) server.stop();
	}

	console.log("");
	printResults(results);

	let regressions = 0;
	if (opts.baseline) {
		const baselinePath = path.resolve(REPO_ROOT, opts.baseline);
		if (!fs.existsSync(baselinePath)) throw new Error(`Baseline file not found: ${baselinePath}`);
		regressions = printComparison(JSON.parse(fs.readFileSync(baselinePath, "utf8")), results, opts.noisePct);
	}

	if (opts.out) {
		const outPath = path.resolve(REPO_ROOT, opts.out);
		fs.mkdirSync(path.dirname(outPath), {recursive: true});
		fs.writeFileSync(outPath, JSON.stringify(results, null, "\t"), "utf8");
		console.log(`\nResults written to ${outPath}`);
	}

	if (regressions) {
		console.log(`\n${regressions} metric(s) regressed by more than ${opts.noisePct}%.`);
		process.exitCode = 1;
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
