import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Hub CI and real-stack test contract", () => {
	const workflow = read(".github/workflows/hub.yml");
	const productionDockerfile = read("server/Dockerfile");
	const testDockerfile = read("server/test.Dockerfile");
	const testServer = read("test/e2e/hub/test-server.mjs");
	const composeOverride = read("compose.hub.test.yml");
	const provenanceWriter = read("server/scripts/write-ci-provenance.mjs");
	const e2eRunner = read("server/scripts/run-hub-e2e.mjs");
	const playwrightConfig = read("playwright.hub.config.ts");
	const secretScanner = read("server/scripts/check-secrets.mjs");

	it("pins every third-party workflow action to an immutable SHA", () => {
		const uses = [...workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
		expect(uses.length).toBeGreaterThan(0);
		for (const [, action, ref] of uses) {
			expect(action).toMatch(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);
			expect(ref).toMatch(/^[0-9a-f]{40}$/);
		}
	});

	it("runs locked unit, lint, PWA, audit, secret, SBOM, image scan, and real-stack E2E gates", () => {
		for (const command of [
			"npm ci --ignore-scripts",
			"npm run test:hub",
			"npm run test:js",
			"npm run build:sw",
			"npx stylelint",
			"npm audit --omit=dev --audit-level=high",
			"npm run hub:check-secrets",
			"npm sbom",
			"npm run hub:migrate",
			"npm run hub:grant-roles",
			"npm run test:hub:e2e:stack",
		]) expect(workflow).toContain(command);
		expect(workflow).toContain("aquasecurity/trivy-action@");
		expect(workflow).toContain("anchore/sbom-action@");
		expect(workflow).toContain("postgres:17.6-bookworm");
		expect(workflow).toContain("CharacterSheetRepositorySeam.test.js");
		expect(workflow).toContain("DmScreenJourneyTracker.test.js");
		expect(workflow.match(/node-version: 24\.20\.0/g)).toHaveLength(4);
		expect(workflow).not.toContain("node-version: 24.7.0");
	});

	it("exports one immutable image with SBOM and provenance evidence", () => {
		expect(workflow).toContain("docker save --output hub-bff-image.tar");
		expect(workflow).toContain("docker load --input hub-bff-image.tar");
		expect(workflow).toContain("HUB_TEST_BASE_IMAGE: thelemartools-hub-bff:");
		expect(workflow).toContain("server/scripts/write-ci-provenance.mjs");
		expect(workflow).toContain("hub-node-sbom.json");
		expect(workflow).toContain("hub-image-sbom.spdx.json");
		expect(workflow).toContain("hub-ci-provenance.json");
		expect(workflow).toContain("hub-trivy-results.json");
		expect(workflow).toContain("upload-artifact: false");
		expect(workflow).toContain("github.run_attempt");
		expect(workflow).toContain("overwrite: true");
		expect(provenanceWriter).toContain("packageLockSha256");
		expect(provenanceWriter).toContain("archiveSha256");
		expect(provenanceWriter).toContain("registryDigest: null");
		expect(provenanceWriter).toContain(`migration: "0003"`);
	});

	it("isolates every E2E Compose run and records success evidence", () => {
		expect(e2eRunner).toContain(`"--project-name", projectName`);
		expect(e2eRunner).toContain(`process.once(signal`);
		expect(e2eRunner).toContain(`cleanup();`);
		expect(e2eRunner).toContain(`productionSmokeName`);
		expect(e2eRunner).toMatch(/catch \(error\)[\s\S]*?composeArgs, "ps", "--all"[\s\S]*?composeArgs, "logs", "--tail=200"/);
		expect(playwrightConfig).toContain("hub-playwright-results.json");
		expect(workflow).toContain("test-results/hub-playwright-results.json");
		expect(workflow).toContain("if-no-files-found: error");
	});

	it("scans each Hub credential class for hard-coded assignments", () => {
		for (const name of [
			"DATABASE_URL",
			"GITHUB_CLIENT_SECRET",
			"HUB_BACKUP_ENCRYPTION_KEY",
			"HUB_COOKIE_SECRET",
			"HUB_CSRF_SECRET",
			"HUB_METRICS_TOKEN",
			"HUB_RUNTIME_DB_PASSWORD",
			"HUB_TEST_AUTH_SECRET",
		]) expect(secretScanner).toContain(`"${name}"`);
		expect(secretScanner).toContain("hard-coded");
	});

	it("keeps synthetic authentication out of the production BFF image", () => {
		expect(productionDockerfile).not.toContain("test-server.mjs");
		expect(testDockerfile).toContain("test/e2e/hub/test-server.mjs");
		expect(testDockerfile).toContain("FROM $" + "{HUB_TEST_BASE_IMAGE}");
		expect(testServer).toContain(`process.env.NODE_ENV !== "test"`);
		expect(testServer).toContain(`HUB_TEST_AUTH_ENABLED`);
		expect(testServer).toContain(`HUB_TEST_AUTH_SECRET`);
		expect(composeOverride).toContain(`NODE_ENV: test`);
		expect(composeOverride).toContain(`HUB_TEST_AUTH_ENABLED: "true"`);
	});
});
