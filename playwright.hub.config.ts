import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
	testDir: "./test/e2e/hub",
	fullyParallel: false,
	forbidOnly: true,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI
		? [["list"], ["json", {outputFile: "test-results/hub-playwright-results.json"}]]
		: [["list"], ["html", {open: "never"}]],
	timeout: 90_000,
	outputDir: "./test-results/hub-playwright-output",
	use: {
		baseURL: "https://localhost:8443",
		ignoreHTTPSErrors: true,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [{
		name: "hub-chromium",
		use: {...devices["Desktop Chrome"]},
	}],
});
