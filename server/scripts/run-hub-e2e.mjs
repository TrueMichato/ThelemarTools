import {spawn} from "node:child_process";
import crypto from "node:crypto";
import https from "node:https";

const runId = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const projectName = `hub-e2e-${runId}`;
const composeArgs = ["compose", "--project-name", projectName, "-f", "compose.hub.yml", "-f", "compose.hub.test.yml"];
const externalBaseImage = process.env.HUB_TEST_BASE_IMAGE?.trim() || null;
const baseImage = externalBaseImage || `thelemartools-hub-bff:e2e-${runId}`;
const testBffImage = `${projectName}-test-bff:latest`;
const productionSmokeName = `${projectName}-production-smoke`;
const postgresPort = `${20_000 + crypto.randomInt(10_000)}`;
const env = {
	...process.env,
	HUB_APP_ORIGIN: "https://localhost:8443",
	HUB_TRUST_PROXY: "172.30.0.10",
	HUB_POSTGRES_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_RUNTIME_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_BACKUP_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_OPERATIONS_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_COOKIE_SECRET: crypto.randomBytes(48).toString("base64url"),
	HUB_CSRF_SECRET: crypto.randomBytes(48).toString("base64url"),
	HUB_METRICS_TOKEN: crypto.randomBytes(32).toString("base64url"),
	HUB_BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
	HUB_ALLOWED_OAUTH_SUBJECTS: "github:0",
	HUB_TEST_AUTH_SECRET: crypto.randomBytes(32).toString("base64url"),
	HUB_TEST_POSTGRES_PORT: postgresPort,
	GITHUB_CLIENT_ID: "hub-e2e",
	GITHUB_CLIENT_SECRET: crypto.randomBytes(24).toString("base64url"),
	HUB_IMAGE_VERSION: "e2e",
	HUB_VCS_REF: process.env.GITHUB_SHA || "local-e2e",
	HUB_NPM_REGISTRY: process.env.HUB_NPM_REGISTRY || process.env.npm_config_registry || "https://registry.npmjs.org/",
	HUB_TEST_BASE_IMAGE: baseImage,
};

let activeChild = null;
let isStopping = false;
let cleanupPromise = null;

function pRun (command, args, {isAllowFailure = false, isCapture = false, isCleanup = false} = {}) {
	if (isStopping && !isCleanup) return Promise.reject(new Error(`Campaign Hub E2E run is stopping.`));
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			stdio: isCapture ? ["ignore", "pipe", "pipe"] : "inherit",
			detached: process.platform !== "win32",
		});
		if (!isCleanup) activeChild = child;
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", chunk => stdout += chunk);
		child.stderr?.on("data", chunk => stderr += chunk);
		child.once("error", reject);
		child.once("close", (status, signal) => {
			if (activeChild === child) activeChild = null;
			const exitStatus = status ?? 1;
			if (!isAllowFailure && exitStatus !== 0) {
				return reject(new Error(`${command} exited with status ${exitStatus}${signal ? ` (${signal})` : ""}${stderr.trim() ? `: ${stderr.trim()}` : ""}.`));
			}
			resolve({status: exitStatus, stdout: stdout.trim()});
		});
	});
}

async function run (command, args, options) {
	return (await pRun(command, args, options)).status;
}

async function getOutput (command, args) {
	return (await pRun(command, args, {isCapture: true})).stdout;
}

async function pWaitForReady ({timeoutMs = 180_000} = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const isReady = await new Promise(resolve => {
			const request = https.get("https://localhost:8443/api/ready", {rejectUnauthorized: false}, response => {
				response.resume();
				resolve(response.statusCode === 200);
			});
			request.on("error", () => resolve(false));
			request.setTimeout(2_000, () => {
				request.destroy();
				resolve(false);
			});
		});
		if (isReady) return;
		await new Promise(resolve => setTimeout(resolve, 1_000));
	}
	throw new Error(`Campaign Hub E2E stack did not become ready.`);
}

async function pWaitForContainerHealthy ({name, timeoutMs = 60_000}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const status = await getOutput("docker", ["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", name]);
		if (status === "running healthy") return;
		if (status.startsWith("exited ") || status.startsWith("dead ")) {
			await run("docker", ["logs", name], {isAllowFailure: true});
			throw new Error(`Production BFF smoke container stopped before becoming healthy.`);
		}
		await new Promise(resolve => setTimeout(resolve, 1_000));
	}
	await run("docker", ["logs", name], {isAllowFailure: true});
	throw new Error(`Production BFF smoke container did not become healthy.`);
}

function cleanup () {
	if (cleanupPromise) return cleanupPromise;
	cleanupPromise = (async () => {
		await run("docker", ["rm", "--force", productionSmokeName], {isAllowFailure: true, isCleanup: true});
		await run("docker", [...composeArgs, "down", "-v", "--remove-orphans", "--rmi", "local"], {isAllowFailure: true, isCleanup: true});
		await run("docker", ["image", "rm", "--force", testBffImage], {isAllowFailure: true, isCleanup: true});
		if (!externalBaseImage) {
			await run("docker", ["image", "rm", "--force", baseImage], {isAllowFailure: true, isCleanup: true});
		}
	})();
	return cleanupPromise;
}

function stopActiveChild (signal) {
	if (!activeChild?.pid) return;
	try {
		if (process.platform === "win32") activeChild.kill(signal);
		else process.kill(-activeChild.pid, signal);
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
	process.once(signal, () => {
		isStopping = true;
		stopActiveChild(signal);
		void cleanup().finally(() => process.exit(exitCode));
	});
}

let exitCode = 0;
try {
	if (externalBaseImage) {
		await getOutput("docker", ["image", "inspect", baseImage]);
	} else {
		await run("docker", [
			"build",
			"-f", "server/Dockerfile",
			"--build-arg", `NPM_REGISTRY=${env.HUB_NPM_REGISTRY}`,
			"--build-arg", `VERSION=${env.HUB_IMAGE_VERSION}`,
			"--build-arg", `VCS_REF=${env.HUB_VCS_REF}`,
			"-t", baseImage,
			".",
		]);
	}
	await run("docker", [
		"build",
		"-f", "server/test.Dockerfile",
		"--build-arg", `HUB_TEST_BASE_IMAGE=${baseImage}`,
		"-t", testBffImage,
		".",
	]);
	await run("docker", [...composeArgs, "up", "--build", "-d"]);
	await pWaitForReady();
	await run("docker", [...composeArgs, "--profile", "backup", "run", "--rm", "backup"]);
	Object.assign(env, {
		DATABASE_URL: `postgresql://hub_runtime:${env.HUB_RUNTIME_DB_PASSWORD}@db:5432/hub`,
		HUB_DATABASE_SSL: "false",
		HUB_HOST: "0.0.0.0",
		HUB_TEST_POSTGRES_URL: `postgresql://hub_runtime:${env.HUB_RUNTIME_DB_PASSWORD}@127.0.0.1:${postgresPort}/hub`,
	});
	await run("docker", [
		"run", "--detach",
		"--name", productionSmokeName,
		"--network", `${projectName}_hub-private`,
		"--read-only",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
		"--health-interval", "2s",
		"--health-timeout", "2s",
		"--health-start-period", "1s",
		"--health-retries", "15",
		"--env", "DATABASE_URL",
		"--env", "HUB_DATABASE_SSL",
		"--env", "HUB_APP_ORIGIN",
		"--env", "HUB_COOKIE_SECRET",
		"--env", "HUB_CSRF_SECRET",
		"--env", "HUB_METRICS_TOKEN",
		"--env", "HUB_ALLOWED_OAUTH_SUBJECTS",
		"--env", "GITHUB_CLIENT_ID",
		"--env", "GITHUB_CLIENT_SECRET",
		"--env", "HUB_HOST",
		baseImage,
	]);
	await pWaitForContainerHealthy({name: productionSmokeName});
	await run("node", [
		"--experimental-vm-modules",
		"./node_modules/jest/bin/jest.js",
		"test/jest/hub/HubSemanticOperationsPostgres.test.js",
		"test/jest/hub/HubInventoryPostgres.test.js",
		"test/jest/hub/HubMultiProviderIdentityPostgres.test.js",
		"--runInBand",
		"--no-coverage",
		"--forceExit",
	]);
	exitCode = await run("npx", ["playwright", "test", "--config", "playwright.hub.config.ts"], {isAllowFailure: true});
	if (exitCode === 0) {
		await run("docker", [...composeArgs, "restart", "bff"]);
		await pWaitForReady();
		await run("docker", [...composeArgs, "restart", "db"]);
		await pWaitForReady();
	}
	if (exitCode !== 0) await run("docker", [...composeArgs, "logs", "--tail=200"], {isAllowFailure: true});
} catch (error) {
	if (!isStopping) {
		await run("docker", [...composeArgs, "ps", "--all"], {isAllowFailure: true});
		await run("docker", [...composeArgs, "logs", "--tail=200"], {isAllowFailure: true});
		throw error;
	}
} finally {
	await cleanup();
}
if (!isStopping) process.exit(exitCode);
