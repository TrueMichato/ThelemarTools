import fs from "node:fs";
import {spawn} from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import {HUB_PROTOCOL_VERSION} from "../../../server/src/app.js";
import {HUB_REQUIRED_MIGRATION_VERSION} from "../../../server/src/migration-version.js";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const root = new URL("../../../", import.meta.url);

const isProcessAlive = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
		return false;
	}
};

async function probeRunnerTimeout ({mode, signal = null, childTimeoutMs = 500, totalTimeoutMs = 5_000, cleanupTimeoutMs = 5_000}) {
	const dir = path.join(root.pathname, "test", `.hub-e2e-timeout-${crypto.randomUUID()}`);
	const binDir = path.join(dir, "bin");
	const pidFile = path.join(dir, "children.jsonl");
	fs.mkdirSync(binDir, {recursive: true});
	fs.writeFileSync(path.join(binDir, "docker"), `#!/bin/sh
if [ "$1 $2" = "network ls" ]; then
  ${mode === "required" ? `printf '{"pid":%s,"args":["network","ls"]}\\n' "$$" >> "${pidFile}"\n  exec /bin/sleep 30` : mode === "cleanup" ? "exit 1" : mode === "success" ? "exit 0" : `exec "${process.execPath}" "${path.join(dir, "blocking.mjs")}" "$@"`}
fi
if [ "$1" = "rm" ] && [ -f "${path.join(dir, "pids.txt")}" ]; then
  while read pid; do
    if kill -0 "$pid" 2>/dev/null; then printf '%s\\n' "$pid" >> "${path.join(dir, "alive-before-cleanup.txt")}"; fi
  done < "${path.join(dir, "pids.txt")}"
fi
if [ "$1" = "rm" ] && { [ "${mode}" = "cleanup" ] || [ "${mode}" = "total-cleanup" ]; }; then
  exec "${process.execPath}" "${path.join(dir, "blocking.mjs")}" "$@"
fi
printf '%s\\n' "$*" >> "${path.join(dir, "commands.txt")}"
if [ "$1" = "inspect" ]; then printf 'running healthy\\n'; fi
if [ "$1" = "exec" ]; then printf '{"authProviders":[{"slug":"github","status":"available"},{"slug":"discord","status":"available"},{"slug":"google","status":"available"}]}\\n'; fi
exit 0
`, {mode: 0o755});
	fs.writeFileSync(path.join(dir, "blocking.mjs"), `
import fs from "node:fs";
import {spawn} from "node:child_process";
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, "initializing-"))} + process.pid, "initializing");
while (!fs.existsSync(${JSON.stringify(path.join(dir, "release-"))} + process.pid)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
const onSignal = signal => {
  const challengePath = ${JSON.stringify(path.join(dir, "challenge-"))} + process.pid;
  const nonce = fs.existsSync(challengePath) ? fs.readFileSync(challengePath, "utf8") : null;
  const receipt = {pid: process.pid, signal, nonce};
  fs.appendFileSync(${JSON.stringify(path.join(dir, "signals.jsonl"))}, JSON.stringify(receipt) + "\\n");
  if (nonce) {
    const ackPath = ${JSON.stringify(path.join(dir, "ack-"))} + nonce;
    fs.writeFileSync(ackPath + ".writing", JSON.stringify(receipt));
    fs.renameSync(ackPath + ".writing", ackPath);
  }
  ${mode === "descendants" ? "if (signal === \"SIGTERM\") process.exit(0);" : ""}
};
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));
fs.appendFileSync(${JSON.stringify(pidFile)}, JSON.stringify({pid: process.pid, args}) + "\\n");
fs.appendFileSync(${JSON.stringify(path.join(dir, "pids.txt"))}, process.pid + "\\n");
${mode === "descendants" ? `spawn(process.execPath, [${JSON.stringify(path.join(dir, "descendant.mjs"))}], {stdio: "inherit", env: {...process.env, HUB_PROBE_GROUP_PID: process.pid}});` : ""}
setInterval(() => {}, 1000);
`);
	fs.writeFileSync(path.join(dir, "descendant.mjs"), `
import fs from "node:fs";
const onSignal = signal => {
  const challengePath = ${JSON.stringify(path.join(dir, "challenge-"))} + process.pid;
  const nonce = fs.existsSync(challengePath) ? fs.readFileSync(challengePath, "utf8") : null;
  const receipt = {pid: process.pid, signal, nonce};
  fs.appendFileSync(${JSON.stringify(path.join(dir, "signals.jsonl"))}, JSON.stringify(receipt) + "\\n");
  if (nonce) {
    const ackPath = ${JSON.stringify(path.join(dir, "ack-"))} + nonce;
    fs.writeFileSync(ackPath + ".writing", JSON.stringify(receipt));
    fs.renameSync(ackPath + ".writing", ackPath);
  }
};
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));
fs.appendFileSync(${JSON.stringify(pidFile)}, JSON.stringify({pid: process.pid, groupPid: Number(process.env.HUB_PROBE_GROUP_PID), args: ["descendant"]}) + "\\n");
fs.appendFileSync(${JSON.stringify(path.join(dir, "pids.txt"))}, process.pid + "\\n");
setInterval(() => {}, 1000);
`);
	fs.writeFileSync(path.join(dir, "resistance-preload.mjs"), `
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const spawn = childProcess.spawn;
const readRecords = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\\n").filter(Boolean).map(line => JSON.parse(line)) : [];
childProcess.spawn = (command, args, options) => {
  const child = spawn(command, args, options);
  const isBlocking = command === "docker" && (
    (args[0] === "network" && args[1] === "ls" && ${mode !== "cleanup"})
    || (args[0] === "rm" && ${mode === "cleanup" || mode === "total-cleanup"})
  );
  if (!isBlocking) return child;
  fs.appendFileSync(${JSON.stringify(path.join(dir, "spawned.jsonl"))}, JSON.stringify({pid: child.pid, args}) + "\\n");
  const deadline = Date.now() + 3000;
  const waitFor = predicate => {
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error("Owned child failed the resistance readiness handshake.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  };
  waitFor(() => fs.existsSync(${JSON.stringify(path.join(dir, "initializing-"))} + child.pid));
  ${mode === "initializing" ? "return child;" : `fs.writeFileSync(${JSON.stringify(path.join(dir, "release-"))} + child.pid, "release");`}
  waitFor(() => readRecords(${JSON.stringify(pidFile)}).filter(record => record.pid === child.pid || record.groupPid === child.pid).length === ${mode === "descendants" ? 2 : 1});
  const children = readRecords(${JSON.stringify(pidFile)}).filter(record => record.pid === child.pid || record.groupPid === child.pid);
  for (const {pid, groupPid} of children) {
    const signal = ${mode === "descendants"} && !groupPid ? "SIGINT" : "SIGTERM";
    const nonce = crypto.randomUUID();
    const challengePath = ${JSON.stringify(path.join(dir, "challenge-"))} + pid;
    const ackPath = ${JSON.stringify(path.join(dir, "ack-"))} + nonce;
    fs.writeFileSync(challengePath, nonce);
    process.kill(pid, signal);
    waitFor(() => fs.existsSync(ackPath));
    const receipt = JSON.parse(fs.readFileSync(ackPath, "utf8"));
    if (receipt.pid !== pid || receipt.signal !== signal || receipt.nonce !== nonce) throw new Error("Invalid resistance acknowledgement.");
    process.kill(pid, 0);
    fs.rmSync(challengePath);
    fs.appendFileSync(${JSON.stringify(path.join(dir, "ready.jsonl"))}, JSON.stringify(receipt) + "\\n");
  }
  return child;
};
syncBuiltinESMExports();
`);
	fs.writeFileSync(path.join(dir, "success-preload.mjs"), `
import childProcess from "node:child_process";
import https from "node:https";
import {EventEmitter} from "node:events";
import {syncBuiltinESMExports} from "node:module";
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (command === "npx" || (command === "node" && args.includes("./node_modules/jest/bin/jest.js"))) return spawn("/usr/bin/true", [], options);
  return spawn(command, args, options);
};
https.get = (url, options, callback) => {
  const request = new EventEmitter();
  request.setTimeout = () => request;
  queueMicrotask(() => callback({statusCode: 200, resume () {}}));
  return request;
};
syncBuiltinESMExports();
`);
	const readRecords = file => fs.existsSync(file)
		? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
		: [];
	const getChildren = () => [...new Map([
		...readRecords(path.join(dir, "spawned.jsonl")),
		...readRecords(pidFile),
	].map(record => [record.pid, record])).values()];
	const killOwnedChildren = () => {
		for (const {pid, groupPid} of getChildren()) {
			try {
				process.kill(process.platform === "win32" ? pid : -(groupPid || pid), "SIGKILL");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		}
	};
	let runner;
	let runnerClosed = false;
	let watchdog;
	let signalPoll;
	try {
		runner = spawn(process.execPath, [
			...mode === "required" ? [] : ["--import", path.join(dir, mode === "success" ? "success-preload.mjs" : "resistance-preload.mjs")],
			"server/scripts/run-hub-e2e.mjs",
		], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				NODE_ENV: "test",
				PATH: `${path.dirname(process.execPath)}:${binDir}:${process.env.PATH}`,
				HUB_E2E_ALLOW_SHORT_TIMEOUTS: "true",
				HUB_E2E_CHILD_TIMEOUT_MS: `${childTimeoutMs}`,
				HUB_E2E_TIMEOUT_MS: `${totalTimeoutMs}`,
				HUB_E2E_CLEANUP_TIMEOUT_MS: `${cleanupTimeoutMs}`,
				HUB_E2E_TERMINATION_GRACE_MS: "100",
			},
		});
		let stdout = "";
		let stderr = "";
		let watchdogTriggered = false;
		runner.stdout.on("data", chunk => stdout += chunk);
		runner.stderr.on("data", chunk => stderr += chunk);
		if (signal) {
			signalPoll = setInterval(() => {
				if (readRecords(path.join(dir, "ready.jsonl")).length < (mode === "descendants" ? 2 : 1)) return;
				clearInterval(signalPoll);
				runner.kill(signal);
			}, 10);
		}
		const result = await new Promise((resolve, reject) => {
			runner.once("error", reject);
			runner.once("close", (status, signal) => {
				runnerClosed = true;
				clearTimeout(watchdog);
				resolve({status, signal});
			});
			watchdog = setTimeout(() => {
				watchdogTriggered = true;
				killOwnedChildren();
				runner.kill("SIGKILL");
			}, 4_000);
		});
		const children = getChildren();
		return {
			...result,
			stdout,
			stderr,
			watchdogTriggered,
			children,
			ready: readRecords(path.join(dir, "ready.jsonl")),
			signals: readRecords(path.join(dir, "signals.jsonl")),
			installedHandlers: readRecords(pidFile),
			initializing: children.filter(({pid}) => fs.existsSync(path.join(dir, `initializing-${pid}`))).map(({pid}) => pid),
			survivingPids: children.filter(({pid}) => isProcessAlive(pid)).map(({pid}) => pid),
			aliveBeforeCleanup: fs.existsSync(path.join(dir, "alive-before-cleanup.txt"))
				? fs.readFileSync(path.join(dir, "alive-before-cleanup.txt"), "utf8").trim().split("\n").map(Number)
				: [],
			diagnostics: stdout.split("\n").flatMap(line => {
				try {
					return [JSON.parse(line)];
				} catch {
					return [];
				}
			}),
			commands: fs.existsSync(path.join(dir, "commands.txt"))
				? fs.readFileSync(path.join(dir, "commands.txt"), "utf8").trim().split("\n").map(line => line.split(" "))
				: [],
		};
	} finally {
		clearTimeout(watchdog);
		clearInterval(signalPoll);
		killOwnedChildren();
		if (runner && !runnerClosed) {
			const closed = new Promise(resolve => runner.once("close", resolve));
			runner.kill("SIGKILL");
			await closed;
		}

		for (let attempt = 0; attempt < 100 && getChildren().some(({pid}) => isProcessAlive(pid)); attempt++) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		const survivors = getChildren().filter(({pid}) => isProcessAlive(pid));
		fs.rmSync(dir, {recursive: true, force: true});
		expect(survivors).toEqual([]);
	}
}

function expectRunnerExit (result, status = 124) {
	if (result.status !== status || result.watchdogTriggered) {
		throw new Error(`Runner expected exit ${status} without the test watchdog; got status=${result.status} signal=${result.signal} watchdog=${result.watchdogTriggered}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	}
}

function expectRunnerCleanup (result, isComplete) {
	const count = result.diagnostics.filter(value => value.type === "hub_e2e_cleanup_complete").length;
	if (count !== (isComplete ? 1 : 0)) {
		throw new Error(`Runner cleanup-complete count expected ${isComplete ? 1 : 0}; got ${count}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	}
}

function expectResistanceReady (result, measuredSignal = "SIGTERM") {
	expect(result.ready).toHaveLength(result.children.length);
	for (const {pid} of result.children) {
		const acknowledgement = result.ready.find(receipt => receipt.pid === pid);
		expect(acknowledgement).toMatchObject({pid, nonce: expect.any(String)});
		expect(result.signals).toContainEqual(acknowledgement);
		expect(result.signals).toContainEqual({pid, signal: measuredSignal, nonce: null});
	}
}

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
		expect(workflow).toContain("HUB_MIN_PERL_BASE_VERSION: 5.36.0-7+deb12u4");
		expect(workflow).toContain("dpkg-query");
		expect(workflow).toContain("dpkg \"$HUB_BFF_IMAGE\" --compare-versions");
		expect(workflow).toContain("libpcre2-8-0)");
		expect(workflow).toContain("perl-base)");
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
		expect(HUB_PROTOCOL_VERSION).toBe("5");
		expect(HUB_REQUIRED_MIGRATION_VERSION).toBe("0010");
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

	it("exits 124 after the existing 50 ms required child timeout, structured evidence, and cleanup", async () => {
		const result = await probeRunnerTimeout({mode: "required", childTimeoutMs: 50});
		expectRunnerExit(result);
		const diagnostic = result.diagnostics.find(value => value?.type === "hub_e2e_timeout");
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
		const cleanupEvidence = result.diagnostics.find(value => value?.type === "hub_e2e_cleanup_complete");
		expectRunnerCleanup(result, true);
		expect(cleanupEvidence).toEqual({
			type: "hub_e2e_cleanup_complete",
			runId: diagnostic.runId,
			projectName: diagnostic.projectName,
		});
	});

	it("bounds a SIGTERM-ignoring required child timeout and awaits real termination before cleanup", async () => {
		const result = await probeRunnerTimeout({mode: "child"});
		expectRunnerExit(result);
		expect(result.children).toHaveLength(1);
		expectResistanceReady(result);
		expect(result.survivingPids).toEqual([]);
		expect(result.aliveBeforeCleanup).toEqual([]);
		expect(result.diagnostics.find(value => value.type === "hub_e2e_timeout")).toMatchObject({scope: "child", timeoutMs: 500, phase: "environment"});
		expectRunnerCleanup(result, true);
	});

	it("bounds initialization before handlers install without claiming resistance or cleanup from readiness", async () => {
		const result = await probeRunnerTimeout({mode: "initializing"});
		expectRunnerExit(result);
		expect(result.children).toHaveLength(1);
		expect(result.initializing).toEqual([result.children[0].pid]);
		expect(result.installedHandlers).toEqual([]);
		expect(result.ready).toEqual([]);
		expect(result.signals).toEqual([]);
		expect(result.survivingPids).toEqual([]);
		expect(result.aliveBeforeCleanup).toEqual([]);
		expect(result.diagnostics.find(value => value.type === "hub_e2e_timeout")).toMatchObject({scope: "child", timeoutMs: 500, phase: "environment"});
		expectRunnerCleanup(result, true);
	});

	it("awaits a SIGTERM-ignoring child on total timeout before isolated cleanup and exit 124", async () => {
		const result = await probeRunnerTimeout({mode: "total", childTimeoutMs: 5_000, totalTimeoutMs: 500});
		expectRunnerExit(result);
		expect(result.children).toHaveLength(1);
		expectResistanceReady(result);
		expect(result.survivingPids).toEqual([]);
		expect(result.aliveBeforeCleanup).toEqual([]);
		expect(result.diagnostics.find(value => value.type === "hub_e2e_timeout")).toMatchObject({scope: "total", timeoutMs: 500, phase: "environment"});
		expectRunnerCleanup(result, true);
		expect(result.commands.find(args => args.includes("down"))).toEqual([
			"compose", "--project-name", result.diagnostics[0].projectName,
			"-f", "compose.hub.yml", "-f", "compose.hub.test.yml",
			"down", "-v", "--remove-orphans", "--rmi", "local",
		]);
	});

	it("kills an ignoring descendant even after its process-group leader exits on SIGTERM", async () => {
		const result = await probeRunnerTimeout({mode: "descendants", signal: "SIGTERM", childTimeoutMs: 5_000});
		expectRunnerExit(result, 143);
		expect(result.children).toHaveLength(2);
		expectResistanceReady(result);
		expect(result.children[1].groupPid).toBe(result.children[0].pid);
		expect(result.survivingPids).toEqual([]);
		expect(result.aliveBeforeCleanup).toEqual([]);
		expectRunnerCleanup(result, true);
	});

	it.each([["SIGINT", 130], ["SIGTERM", 143]])("awaits ignoring children and preserves %s exit %s", async (signal, status) => {
		const result = await probeRunnerTimeout({mode: "child", signal, childTimeoutMs: 5_000});
		expectRunnerExit(result, status);
		expect(result.children).toHaveLength(1);
		expectResistanceReady(result, signal);
		expect(result.survivingPids).toEqual([]);
		expect(result.aliveBeforeCleanup).toEqual([]);
		expect(result.diagnostics.some(value => value.type === "hub_e2e_timeout")).toBe(false);
		expectRunnerCleanup(result, true);
	});

	it("preserves normal success, restart checks, and exactly-once isolated cleanup with only mocked infrastructure", async () => {
		const result = await probeRunnerTimeout({mode: "success", childTimeoutMs: 5_000});
		expectRunnerExit(result, 0);
		expect(result.diagnostics.some(value => value.type === "hub_e2e_timeout")).toBe(false);
		expect(result.commands.filter(args => args.includes("restart")).map(args => args.at(-1))).toEqual(["bff", "db"]);
		expect(result.commands.filter(args => args.includes("down"))).toHaveLength(1);
		expectRunnerCleanup(result, true);
	});

	it.each([
		["normal finally", "cleanup", 5_000],
		["total timeout", "total-cleanup", 500],
	])("bounds SIGTERM-ignoring cleanup after %s without false completion", async (name, mode, totalTimeoutMs) => {
		const result = await probeRunnerTimeout({mode, childTimeoutMs: 5_000, totalTimeoutMs, cleanupTimeoutMs: 300});
		expectRunnerExit(result);
		expect(result.children).toHaveLength(name === "normal finally" ? 1 : 2);
		expectResistanceReady(result);
		expect(result.children.at(-1).args[0]).toBe("rm");
		expect(result.survivingPids).toEqual([]);
		const diagnostic = result.diagnostics.find(value => value.type === "hub_e2e_timeout" && value.scope === "cleanup");
		expect(diagnostic).toMatchObject({
			scope: "cleanup",
			timeoutMs: 300,
			phase: "cleanup",
			process: `docker rm --force ${diagnostic.projectName}-production-smoke`,
		});
		expectRunnerCleanup(result, false);
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

	it("runs retained-roll Sheet regressions in the actual affected-regressions command", () => {
		const step = workflow.match(/- name: Character Sheet Hub seams\s+run: >\s+([\s\S]*?)(?=\n\s+- name:)/)?.[1];
		expect(step).toBeDefined();
		for (const path of ["CharacterSheetHubRollHistory.test.js", "CharacterSheetRealtime.test.js"]) expect(step).toContain(`test/jest/charactersheet/${path}`);
		expect(e2eRunner).toContain(`"test/jest/hub/HubRollHistory.test.js"`);
	});
});
