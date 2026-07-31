import {defineConfig, devices} from "@playwright/test";

/**
 * Playwright configuration for Character Sheet E2E tests
 * @see https://playwright.dev/docs/test-configuration
 *
 * Tunable via environment variables:
 *   PW_WORKERS        — parallel worker count (default 3, CI 1).
 *                       3 is the safe local default. 5–6 works well
 *                       after the Phase-2 concurrent-webserver swap
 *                       below; 8+ requires per-worker port fan-out
 *                       (not implemented). Raising past available
 *                       RAM/600 MB causes Chromium thrash.
 *   PW_TIMEOUT_MS     — per-test timeout (default 60_000). Bump to
 *                       90_000 when running at higher worker counts
 *                       so the slowest specs aren't false-flagged
 *                       under heavier contention.
 *   PW_EXPECT_TIMEOUT_MS — expect.toPass / poll cap (default 5_000).
 *
 * Example commands:
 *   npx playwright test                                  # defaults
 *   PW_WORKERS=5 PW_TIMEOUT_MS=90000 npx playwright test # faster
 *   PW_WORKERS=1 npx playwright test                     # CI-style
 */
const PW_WORKERS = process.env.CI ? 1 : Number(process.env.PW_WORKERS ?? 3);
const PW_TIMEOUT_MS = Number(process.env.PW_TIMEOUT_MS ?? 60_000);
const PW_EXPECT_TIMEOUT_MS = Number(process.env.PW_EXPECT_TIMEOUT_MS ?? 5_000);
// Shared dev machines sometimes already have an unrelated static server
// bound to :8080 (e.g. a different worktree's checkout). Since
// `reuseExistingServer` happily reuses ANY server already answering on
// that port — even one serving completely different source — allow an
// override so a run can point at a guaranteed-fresh port for this
// worktree instead of silently testing someone else's files.
const PW_PORT = Number(process.env.PW_PORT ?? 8080);

export default defineConfig({
	testDir: "./test/e2e/specs",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: PW_WORKERS,
	reporter: "html",
	timeout: PW_TIMEOUT_MS,
	expect: {timeout: PW_EXPECT_TIMEOUT_MS},
	// IMPORTANT: keep Playwright's per-run cleanup confined to a
	// subfolder of test-results/. The default `outputDir` is
	// `test-results/` itself, which Playwright wipes at the start of
	// every run — that destroyed `test-results/exports-for-validation/`
	// (the `_exportCharacterForValidation` artifacts spec authors load
	// by hand to validate open bugs). Sibling subfolder keeps exports
	// untouched across runs; individual export files are overwritten
	// per-test by the export hook itself.
	outputDir: "./test-results/playwright-output",
	use: {
		baseURL: `http://localhost:${PW_PORT}`,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {...devices["Desktop Chrome"]},
		},
	],
	/*
	 * Concurrent static webserver for E2E. Previously this used
	 * `python3 -m http.server 8080`, which is single-threaded and
	 * serialized every request — turning workers > 3 into queueing
	 * thrash and false 60 s timeouts. The Node `http-server` package
	 * (already a devDependency) is libuv-concurrent and handles 5–6
	 * parallel workers cleanly with no other config changes.
	 *   -p 8080   — same port as before, no spec changes needed
	 *   -c-1      — disable Cache-Control so spec edits take effect
	 *   --silent  — keep Playwright's reporter output clean
	 */
	webServer: {
		command: `npx http-server -p ${PW_PORT} -c-1 --silent .`,
		url: `http://localhost:${PW_PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
