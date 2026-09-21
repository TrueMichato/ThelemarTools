import fs from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {HUB_PROTOCOL_VERSION} from "../../../server/src/app.js";
import {HUB_REQUIRED_MIGRATION_VERSION} from "../../../server/src/migration-version.js";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Hub CI and real-stack test contract", () => {
	const workflow = read(".github/workflows/hub.yml");
	const productionDockerfile = read("server/Dockerfile");
	const testDockerfile = read("server/test.Dockerfile");
	const testServer = read("test/e2e/hub/test-server.mjs");
	const composeOverride = read("compose.hub.test.yml");
	const e2eRunner = read("server/scripts/run-hub-e2e.mjs");
	const provenanceWriter = read("server/scripts/write-ci-provenance.mjs");
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
		expect(workflow).toContain("HUB_MIN_PCRE2_VERSION: 10.42-1+deb12u1");
		expect(workflow).toContain("dpkg-query");
		expect(workflow).toContain("dpkg \"$HUB_BFF_IMAGE\" --compare-versions");
		expect(workflow).toContain("github.run_attempt");
		expect(workflow).toContain("overwrite: true");
		expect(provenanceWriter).toContain("packageLockSha256");
		expect(provenanceWriter).toContain("archiveSha256");
		expect(provenanceWriter).toContain("registryDigest: null");
		// Provenance must be derived from the runtime constants, so it cannot drift from
		// what the server enforces.
		expect(provenanceWriter).toContain("protocol: HUB_PROTOCOL_VERSION");
		expect(provenanceWriter).toContain("migration: HUB_REQUIRED_MIGRATION_VERSION");
		expect(provenanceWriter).not.toMatch(/protocol: "\d+"/);
		expect(provenanceWriter).not.toMatch(/migration: "\d+"/);
		expect(HUB_PROTOCOL_VERSION).toBe("6");
		expect(HUB_REQUIRED_MIGRATION_VERSION).toBe("0011");
	});

	it("isolates every E2E Compose run and records success evidence", () => {
		expect(e2eRunner).toContain(`"--project-name", projectName`);
		expect(e2eRunner).toContain(`process.once(signal`);
		expect(e2eRunner).toContain(`cleanup();`);
		expect(e2eRunner).toContain(`HUB_E2E_TIMEOUT_MS`);
		expect(e2eRunner).toContain(`HUB_E2E_CHILD_TIMEOUT_MS`);
		expect(e2eRunner).toContain(`terminating the active child and cleaning up`);
		expect(e2eRunner).toContain(`process.exit(124)`);
		expect(e2eRunner).toContain(`type: "hub_e2e_timeout"`);
		expect(e2eRunner).toContain(`type: "hub_e2e_cleanup_complete"`);
		expect(e2eRunner).toContain(`runId,`);
		expect(e2eRunner).toContain(`projectName,`);
		expect(e2eRunner).toContain(`phase: activePhase`);
		expect(e2eRunner).toContain(`spec: activeSpec`);
		expect(e2eRunner).toContain(`process: activeProcess`);
		expect(e2eRunner).toContain(`artifactPaths`);
		expect(e2eRunner).toContain(`scope: "child"`);
		expect(e2eRunner).toContain(`playwright-report/`);
		expect(e2eRunner).toContain(`test-results/hub-playwright-results.json`);
		expect(e2eRunner).toContain(`test-results/hub-playwright-output/`);
		expect(e2eRunner).toContain(`sanitizeProcessDescription`);
		expect(e2eRunner).toContain(`Campaign Hub E2E timeout: runId=`);
		expect(e2eRunner).toContain(`productionSmokeName`);
		expect(e2eRunner).toContain(`pCheckProductionProviderMetadata`);
		expect(e2eRunner).toMatch(
			/await pCheckProductionProviderMetadata\(\{name: productionSmokeName\}\);\s+await pRemoveProductionSmoke\(\);\s+setActivePhase\("postgresql-parity"[\s\S]*?await run\("node"/,
		);
		expect(e2eRunner).toMatch(/catch \(error\)[\s\S]*?composeArgs, "ps", "--all"[\s\S]*?composeArgs, "logs", "--tail=200"/);
		expect(playwrightConfig).toContain("hub-playwright-results.json");
		expect(workflow).toContain("test-results/hub-playwright-results.json");
		expect(workflow).toContain("if-no-files-found: error");
		expect(workflow).toMatch(/real-stack-e2e:[\s\S]*timeout-minutes: 60/);
		expect(workflow).toMatch(/Run disposable multi-context Hub E2E[\s\S]*timeout-minutes: 50/);
		expect(workflow).toContain(`HUB_E2E_TIMEOUT_MS: "2700000"`);
		expect(workflow).toContain(`HUB_E2E_CHILD_TIMEOUT_MS: "2700000"`);
	});

	it("fails the CI contract if the real-stack job or runner child loses its timeout", () => {
		const assertTimeoutContract = ({workflowSource, runnerSource}) => {
			expect(workflowSource).toMatch(/real-stack-e2e:[\s\S]*?runs-on: ubuntu-latest\s+timeout-minutes: 60/);
			expect(runnerSource).toContain("HUB_E2E_CHILD_TIMEOUT_MS");
			expect(runnerSource).toContain(`writeTimeoutDiagnostic({scope: "child"`);
		};
		const withoutJobTimeout = workflow.replace(/(\s+real-stack-e2e:[\s\S]*?runs-on: ubuntu-latest)\s+timeout-minutes: 60/, "$1");
		const withoutChildTimeout = e2eRunner.replace(/const childTimeoutMs = getBoundedTimeoutMs\([\s\S]*?\n\}\);/, "");

		expect(() => assertTimeoutContract({workflowSource: workflow, runnerSource: e2eRunner})).not.toThrow();
		expect(() => assertTimeoutContract({workflowSource: withoutJobTimeout, runnerSource: e2eRunner})).toThrow();
		expect(() => assertTimeoutContract({workflowSource: workflow, runnerSource: withoutChildTimeout})).toThrow();
	});

	it("exits 124 after a required child timeout, structured evidence, and cleanup", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-e2e-timeout-"));
		const binDir = path.join(dir, "bin");
		fs.mkdirSync(binDir);
		fs.writeFileSync(path.join(binDir, "docker"), `#!/bin/sh
if [ "$1 $2" = "network ls" ]; then
  sleep 30
fi
exit 0
`, {mode: 0o755});

		try {
			const result = spawnSync(process.execPath, ["server/scripts/run-hub-e2e.mjs"], {
				cwd: new URL("../../../", import.meta.url),
				encoding: "utf8",
				timeout: 10_000,
				env: {
					...process.env,
					NODE_ENV: "test",
					PATH: `${binDir}:${process.env.PATH}`,
					HUB_E2E_ALLOW_SHORT_TIMEOUTS: "true",
					HUB_E2E_CHILD_TIMEOUT_MS: "50",
					HUB_E2E_TIMEOUT_MS: "5000",
				},
			});

			expect(result.error).toBeUndefined();
			expect(result.status).toBe(124);
			const diagnostic = result.stdout.split("\n")
				.map(line => {
					try {
						return JSON.parse(line);
					} catch {
						return null;
					}
				})
				.find(value => value?.type === "hub_e2e_timeout");
			expect(diagnostic).toMatchObject({
				type: "hub_e2e_timeout",
				scope: "child",
				timeoutMs: 50,
				phase: "environment",
				spec: "loopback ports and isolated Docker network",
				process: "docker network ls --format {{.ID}}",
				artifactPaths: [
					"playwright-report/",
					"test-results/hub-playwright-results.json",
					"test-results/hub-playwright-output/",
				],
			});
			expect(diagnostic.runId).toMatch(/^\d+-[0-9a-f]{8}$/);
			expect(diagnostic.projectName).toBe(`hub-e2e-${diagnostic.runId}`);
			expect(result.stderr).toContain("Campaign Hub E2E timeout:");
			expect(result.stderr).toContain("phase=environment");
			expect(result.stderr).toContain("evidence=playwright-report/");
			const cleanupEvidence = result.stdout.split("\n")
				.map(line => {
					try {
						return JSON.parse(line);
					} catch {
						return null;
					}
				})
				.find(value => value?.type === "hub_e2e_cleanup_complete");
			expect(cleanupEvidence).toEqual({
				type: "hub_e2e_cleanup_complete",
				runId: diagnostic.runId,
				projectName: diagnostic.projectName,
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("scans each Hub credential class for hard-coded assignments", () => {
		for (const name of [
			"DATABASE_URL",
			"DISCORD_CLIENT_SECRET",
			"GITHUB_CLIENT_SECRET",
			"GOOGLE_CLIENT_SECRET",
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
		expect(testServer).toContain(`isInviteAccountAdmissionEnabled: true`);
		expect(testServer).toMatch(/deterministicProviderDefinitions\.filter\(\(\{slug\}\) => slug !== "google"\)[\s\S]*pUpsertOAuthAccount/);
		expect(testServer).toMatch(/createSemanticOperationRegistry\(\{\s*additionalTemplates:/);
		expect(testServer).not.toMatch(/createSemanticOperationRegistry\(\{\s*templates:/);
		expect(composeOverride).toContain(`NODE_ENV: test`);
		expect(composeOverride).toContain(`HUB_TEST_AUTH_ENABLED: "true"`);
	});

	it("runs source-cost and account-entitlement PostgreSQL parity before browser journeys", () => {
		expect(e2eRunner).toContain("HubSourceCostAdapterAuthorityPostgres.test.js");
		expect(e2eRunner).toContain("HubAccountEntitlementsPostgres.test.js");
	});
});
