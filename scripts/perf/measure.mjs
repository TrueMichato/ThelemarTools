#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Page-load performance harness.
 *
 * Loads a set of content pages in a real Chromium browser and records the numbers we use to
 * decide whether a performance change actually helped:
 *
 *   - lifecycle/logical-list readiness followed by a two-frame response boundary
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
import {chromium} from "playwright";
import {installInstrumentation, collectLogicalLists} from "./browser-harness.mjs";
import {startLocalServer, REPO_ROOT} from "./server.mjs";
import {SCHEMA_VERSION, READINESS_VERSION, compactLogicalLists, compatibilityErrors, correctnessErrors} from "./results.mjs";
import {observeErrors} from "./errors.mjs";
import {measureInteractions} from "./interactions.mjs";

const DEFAULT_PAGES = ["bestiary", "spells", "items", "classes", "crafting"];
const DEFAULT_ORIGIN = "http://localhost:5050";

/** Port zero atomically acquires a unique port, without reusing a running dev server. */
const SERVE_PORT = 0;

/** GitHub Pages serves everything with `max-age=600` and that cannot be configured. Matching it
 * locally keeps `--serve` measurements comparable with production ones. */
const SERVE_MAX_AGE_SECONDS = 600;

/** Hosts that serve homebrew from outside our own origin. Counted separately because they are
 * uncacheable by our service worker and sit on the critical path. */
const REMOTE_BREW_HOST_RE = /githubusercontent\.com|(?:^|\/\/)(?:www\.)?github\.com/;

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
		port: SERVE_PORT,
		viewport: {width: 1440, height: 1000},
		cpuThrottle: 1,
		interactions: false,
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
			case "--port": out.port = Number(next()); break;
			case "--width": out.viewport.width = Number(next()); break;
			case "--height": out.viewport.height = Number(next()); break;
			case "--cpu-throttle": out.cpuThrottle = Number(next()); break;
			case "--interactions": out.interactions = true; break;
			case "--help": case "-h": printHelpAndExit(); break;
			default: throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error(`--runs must be a positive integer`);
	if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error("--port must be 0..65535");
	if (out.cpuThrottle < 1 || !Number.isFinite(out.cpuThrottle)) throw new Error("--cpu-throttle must be >= 1");
	if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) throw new Error("--timeout must be positive");
	if (!Number.isFinite(out.noisePct) || out.noisePct < 0) throw new Error("--noise must be nonnegative");
	if (!out.pages.length) throw new Error("--pages must contain at least one page");
	if (Object.values(out.viewport).some(it => !Number.isInteger(it) || it < 1)) throw new Error("Viewport dimensions must be positive integers");
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
  --port <n>          Local server port; 0 (default) acquires a unique free port.
  --width <px>        Viewport width (1440).
  --height <px>       Viewport height (1000).
  --cpu-throttle <n>  Chromium CPU slowdown factor (1).
  --interactions     Also exercise search/clear/sort/source/scroll/far reveal on items/spells/feats.
`.trim());
	process.exit(0);
}

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
		toolsLoadedMs: H.toolsLoadedMs == null ? null : Math.round(H.toolsLoadedMs),
		rowBuilderMs: Math.round(H.rowBuilderMs),
		rowBuilderCalls: H.rowBuilderCalls,
		instrumentation: H.reach,
		loadPhases: H.phases,
		instrumentationErrors: H.errors,
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

async function measureOnce ({context, url, timeoutMs, cpuThrottle = 1, isClearCache = false, isLocal = false, interactions = false, pageName}) {
	const page = await context.newPage();
	const {consoleErrors, requestErrors, warnings} = observeErrors(page, {isLocal});

	try {
		// Explicitly clear the HTTP cache; do not infer cache state from context creation.
		const cdp = await context.newCDPSession(page);
		if (isClearCache) await cdp.send("Network.clearBrowserCache");
		await cdp.send("Emulation.setCPUThrottlingRate", {rate: cpuThrottle});

		await page.goto(url, {waitUntil: "commit", timeout: timeoutMs});

		let timedOut = false;
		try {
			await page.waitForFunction(
				`globalThis.__perfHarness && globalThis.__perfHarness.listReadyMs != null`,
				null,
				{timeout: timeoutMs},
			);
		} catch (e) {
			if (e.name !== "TimeoutError") throw e;
			timedOut = true;
		}

		// Let any tail work settle so long-task totals aren't truncated mid-task.
		await page.waitForTimeout(500);

		const result = await page.evaluate(COLLECT_FN);
		const logical = compactLogicalLists(await page.evaluate(collectLogicalLists));
		const failures = [
			...logical.errors,
			...Object.entries(result.instrumentation).filter(([, reached]) => !reached).map(([key]) => `Instrumentation not reached: ${key}`),
			...requestErrors,
			...consoleErrors,
			...logical.lists.flatMap(list => list.duplicateIdentities.map(id => `Duplicate identity in ${list.id}: ${id}`)),
		];
		if (timedOut) failures.push("Readiness timed out");
		if (!logical.counter.ok) failures.push("UI count does not match logical rows");
		if (!result.rowBuilderCalls) failures.push("No row-builder calls observed");
		if (!result.brewProcessedCalls || result.brewRawMs == null) failures.push("Homebrew hooks installed but not called");
		if (result.brewProps?.__error || !result.brewProps) failures.push("Homebrew correctness collection failed");
		let interactionResults = null;
		if (interactions && !failures.length) {
			try {
				interactionResults = await measureInteractions(page, {pageName, timeoutMs});
				failures.push(...requestErrors, ...consoleErrors);
			} catch (e) {
				interactionResults = {error: e.message};
				failures.push(`Interaction failed: ${e.message}`);
			}
		}
		const sum = key => logical.lists.reduce((n, list) => n + (list[key] || 0), 0);
		return {
			...result,
			logical,
			timedOut,
			consoleErrors,
			requestErrors,
			failures,
			warnings,
			interactions: interactionResults,
			listRows: sum("mountedRows"),
			logicalLoadedRows: sum("loadedCount"),
			logicalMatchingRows: sum("matchingCount"),
			materializedRows: logical.lists.some(list => list.materializedRows == null) ? null : sum("materializedRows"),
		};
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
	"toolsLoadedMs", "logicalLoadedRows", "logicalMatchingRows", "materializedRows", "rowBuilderMs", "rowBuilderCalls",
];

function summarise (runs) {
	const summary = {};
	for (const metric of MEDIAN_METRICS) summary[metric] = median(runs.map(r => r[metric]));

	// Correctness data is taken from the last successful run; it should be identical across runs.
	const withProps = [...runs].reverse().find(r => r.brewProps);
	summary.brewProps = withProps ? withProps.brewProps : null;
	summary.logical = runs.at(-1)?.logical;
	summary.runs = runs;
	summary.failures = [...new Set(runs.flatMap(r => r.failures))];
	for (const run of runs) summary.failures.push(...correctnessErrors(runs[0], run).map(error => `Run-to-run drift: ${error}`));
	summary.interactions = (runs[0]?.interactions?.scenarios || []).map(scenario => ({
		name: scenario.name,
		skipped: scenario.skipped ?? null,
		responseMs: median(runs.map(run => run.interactions?.scenarios?.find(it => it.name === scenario.name)?.responseMs)),
	}));

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
	const header = ["page", "phase", "firstRow", "ready-v2", "longTasks", "maxTask", "brewProc", "reqs", "remoteBrew", "transfer", "loaded", "matching", "mounted"];
	const rows = [header];

	for (const [pageName, phases] of Object.entries(results.pages)) {
		for (const [phaseName, s] of Object.entries(phases)) {
			rows.push([
				pageName, phaseName, fmtMs(s.firstRowMs), fmtMs(s.listReadyMs), fmtMs(s.longTaskTotalMs), fmtMs(s.longTaskMaxMs),
				fmtMs(s.brewProcessedMs), fmtNum(s.requestCount), fmtNum(s.remoteBrewRequestCount),
				fmtMb(s.bytesTransferred), fmtNum(s.logicalLoadedRows), fmtNum(s.logicalMatchingRows), fmtNum(s.listRows),
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

const COMPARED_METRICS = ["listReadyMs", "longTaskTotalMs", "longTaskMaxMs", "brewProcessedMs", "requestCount", "remoteBrewRequestCount", "bytesTransferred"];

function printComparison (baseline, current, noisePct) {
	const incompatibilities = compatibilityErrors(baseline, current);
	if (incompatibilities.length) {
		console.error(`\nComparison refused:\n${incompatibilities.join("\n")}`);
		return incompatibilities.length;
	}
	console.log(`\nComparison vs baseline (${baseline.label || baseline.startedAt}); ignoring deltas below ${noisePct}%\n`);

	const rows = [["page", "phase", "metric", "before", "after", "delta"]];
	let regressions = 0;

	for (const [pageName, phases] of Object.entries(current.pages)) {
		for (const [phaseName, after] of Object.entries(phases)) {
			const before = baseline.pages?.[pageName]?.[phaseName];
			if (!before) continue;
			const errors = correctnessErrors(before.runs?.[0] || before, after.runs?.[0] || after);
			regressions += errors.length;
			for (const error of errors) console.error(`${pageName} ${phaseName}: ${error}`);

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
			for (const scenario of after.interactions || []) {
				const previous = before.interactions?.find(it => it.name === scenario.name);
				if (!previous?.responseMs || scenario.responseMs == null) continue;
				const pct = 100 * (scenario.responseMs - previous.responseMs) / previous.responseMs;
				if (Math.abs(pct) < noisePct) continue;
				if (pct > 0) regressions++;
				rows.push([pageName, phaseName, `interaction:${scenario.name}`, fmtMs(previous.responseMs), fmtMs(scenario.responseMs), `${pct.toFixed(1)}% ${pct > 0 ? "WORSE" : "better"}`]);
			}
		}
	}

	if (rows.length === 1) console.log(`No metric moved by more than ${noisePct}%.`);
	else printTable(rows);

	if (printCorrectnessDiff(baseline, current)) regressions++;
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
 * Main
 * ------------------------------------------------------------------------------------------ */

async function main () {
	const opts = parseArgs(process.argv.slice(2));

	const server = opts.serve ? await startLocalServer({port: opts.port}) : null;
	if (server) opts.origin = server.origin;

	console.log(`Measuring ${opts.origin}`);
	console.log(`Pages: ${opts.pages.join(", ")}  |  runs per phase: ${opts.runs}\n`);

	let browser;
	try {
		browser = await chromium.launch({headless: !opts.headed});
	} catch (e) {
		server?.stop();
		throw e;
	}
	const results = {
		label: opts.label,
		origin: opts.origin,
		startedAt: new Date().toISOString(),
		runsPerPhase: opts.runs,
		schemaVersion: SCHEMA_VERSION,
		readinessVersion: READINESS_VERSION,
		viewport: opts.viewport,
		cpuThrottle: opts.cpuThrottle,
		browserVersion: browser.version(),
		localServer: opts.serve,
		interactionsEnabled: opts.interactions,
		storagePolicy: "fresh-context-per-cold-run; warm-context-primed-once; service-workers-blocked",
		pages: {},
	};

	try {
		for (const pageName of opts.pages) {
			const url = `${opts.origin}/${pageName}.html`;
			results.pages[pageName] = {};

			// Cold runs each get fresh origin storage plus an explicit HTTP-cache clear.
			const phases = opts.coldOnly ? ["cold"] : ["cold", "warm"];
			for (const phase of phases) {
				const newContext = async () => {
					const context = await browser.newContext({viewport: opts.viewport, serviceWorkers: "block"});
					await context.addInitScript(installInstrumentation);
					return context;
				};
				const context = await newContext();

				try {
					let prime = null;
					// The warm phase gets one unmeasured priming load to populate the HTTP cache.
					if (phase === "warm") {
						prime = await measureOnce({context, url, timeoutMs: opts.timeoutMs, cpuThrottle: opts.cpuThrottle, isLocal: opts.serve});
						if (prime.failures.length) console.error(`Warm priming failures: ${prime.failures.join("; ")}`);
					}

					const runs = [];
					for (let i = 0; i < opts.runs; ++i) {
						process.stdout.write(`  ${pageName} ${phase} run ${i + 1}/${opts.runs}\r`);
						const runContext = phase === "cold" ? await newContext() : context;
						try {
							runs.push(await measureOnce({
								context: runContext,
								url,
								timeoutMs: opts.timeoutMs,
								cpuThrottle: opts.cpuThrottle,
								isClearCache: phase === "cold",
								isLocal: opts.serve,
								interactions: opts.interactions,
								pageName,
							}));
						} finally {
							if (phase === "cold") await runContext.close();
						}
					}

					results.pages[pageName][phase] = summarise(runs);
					if (prime?.failures.length) results.pages[pageName][phase].failures.push(...prime.failures.map(it => `Warm priming: ${it}`));
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
	for (const [pageName, phases] of Object.entries(results.pages)) {
		for (const [phase, summary] of Object.entries(phases)) {
			if (!summary.failures.length) continue;
			regressions += summary.failures.length;
			console.error(`\n${pageName} ${phase} failures:\n${summary.failures.join("\n")}`);
		}
	}
	if (opts.baseline) {
		const baselinePath = path.resolve(REPO_ROOT, opts.baseline);
		if (!fs.existsSync(baselinePath)) throw new Error(`Baseline file not found: ${baselinePath}`);
		regressions += printComparison(JSON.parse(fs.readFileSync(baselinePath, "utf8")), results, opts.noisePct);
	}

	if (opts.out) {
		const outPath = path.resolve(REPO_ROOT, opts.out);
		fs.mkdirSync(path.dirname(outPath), {recursive: true});
		fs.writeFileSync(outPath, JSON.stringify(results, null, "\t"), "utf8");
		console.log(`\nResults written to ${outPath}`);
	}

	if (regressions) {
		console.log(`\n${regressions} validation/comparison failure(s), including metrics regressing by more than ${opts.noisePct}%.`);
		process.exitCode = 1;
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
