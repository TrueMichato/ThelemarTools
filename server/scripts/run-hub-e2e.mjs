import {spawn} from "node:child_process";
import crypto from "node:crypto";
import https from "node:https";
import net from "node:net";

const runId = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const projectName = `hub-e2e-${runId}`;
const composeArgs = ["compose", "--project-name", projectName, "-f", "compose.hub.yml", "-f", "compose.hub.test.yml"];
const externalBaseImage = process.env.HUB_TEST_BASE_IMAGE?.trim() || null;
const baseImage = externalBaseImage || `thelemartools-hub-bff:e2e-${runId}`;
const testBffImage = `${projectName}-test-bff:latest`;
const productionSmokeName = `${projectName}-production-smoke`;
const env = {
	...process.env,
	HUB_POSTGRES_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_RUNTIME_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_BACKUP_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_OPERATIONS_DB_PASSWORD: crypto.randomBytes(24).toString("base64url"),
	HUB_COOKIE_SECRET: crypto.randomBytes(48).toString("base64url"),
	HUB_CSRF_SECRET: crypto.randomBytes(48).toString("base64url"),
	HUB_METRICS_TOKEN: crypto.randomBytes(32).toString("base64url"),
	HUB_BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
	HUB_ALLOWED_OAUTH_SUBJECTS: "github:101,discord:202,google:google-e2e-303",
	HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS: "*",
	HUB_TEST_AUTH_SECRET: crypto.randomBytes(32).toString("base64url"),
	GITHUB_CLIENT_ID: "hub-e2e",
	GITHUB_CLIENT_SECRET: crypto.randomBytes(24).toString("base64url"),
	DISCORD_CLIENT_ID: "hub-e2e",
	DISCORD_CLIENT_SECRET: crypto.randomBytes(24).toString("base64url"),
	GOOGLE_CLIENT_ID: "hub-e2e",
	GOOGLE_CLIENT_SECRET: crypto.randomBytes(24).toString("base64url"),
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

function pGetAvailableLoopbackPort () {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.once("error", reject);
		server.listen({host: "127.0.0.1", port: 0}, () => {
			const address = server.address();
			server.close(error => {
				if (error) return reject(error);
				if (!address || typeof address === "string") return reject(new Error(`Could not allocate a loopback port.`));
				resolve(`${address.port}`);
			});
		});
	});
}

function getIpv4Range (cidr) {
	const [address, prefixRaw] = `${cidr}`.split("/");
	const octets = address?.split(".").map(Number);
	const prefix = Number(prefixRaw);
	if (octets?.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
	const value = octets.reduce((out, octet) => ((out << 8) | octet) >>> 0, 0);
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	const start = (value & mask) >>> 0;
	return {start, end: (start | (~mask >>> 0)) >>> 0};
}

function isIpv4RangeOverlap (left, right) {
	return left.start <= right.end && right.start <= left.end;
}

async function pAssignPrivateNetwork () {
	const networkIds = (await getOutput("docker", ["network", "ls", "--format", "{{.ID}}"]))
		.split(/\s+/g)
		.filter(Boolean);
	const existingRanges = [];
	if (networkIds.length) {
		const output = await getOutput("docker", [
			"network",
			"inspect",
			"--format",
			"{{range .IPAM.Config}}{{println .Subnet}}{{end}}",
			...networkIds,
		]);
		for (const subnet of output.split(/\s+/g).filter(Boolean)) {
			const range = getIpv4Range(subnet);
			if (range) existingRanges.push(range);
		}
	}

	const candidateCount = 40 * 256;
	const startIndex = crypto.randomInt(candidateCount);
	for (let offset = 0; offset < candidateCount; offset++) {
		const index = (startIndex + offset) % candidateCount;
		const secondOctet = 200 + Math.floor(index / 256);
		const thirdOctet = index % 256;
		const subnet = `10.${secondOctet}.${thirdOctet}.0/24`;
		const range = getIpv4Range(subnet);
		if (existingRanges.some(existing => isIpv4RangeOverlap(existing, range))) continue;
		env.HUB_PRIVATE_SUBNET = subnet;
		env.HUB_EDGE_PRIVATE_IP = `10.${secondOctet}.${thirdOctet}.10`;
		env.HUB_TRUST_PROXY = env.HUB_EDGE_PRIVATE_IP;
		return;
	}
	throw new Error(`No non-overlapping private Docker subnet is available for Campaign Hub E2E.`);
}

async function pAssignLoopbackPorts () {
	const [edgePort, postgresPort] = await Promise.all([
		pGetAvailableLoopbackPort(),
		pGetAvailableLoopbackPort(),
	]);
	env.HUB_EDGE_PORT = edgePort;
	env.HUB_APP_ORIGIN = `https://localhost:${edgePort}`;
	env.HUB_E2E_ORIGIN = env.HUB_APP_ORIGIN;
	env.HUB_TEST_POSTGRES_PORT = postgresPort;
}

async function pWaitForReady ({timeoutMs = 180_000} = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const isReady = await new Promise(resolve => {
			const request = https.get(`${env.HUB_APP_ORIGIN}/api/ready`, {rejectUnauthorized: false}, response => {
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

async function pCheckProductionProviderMetadata ({name}) {
	const output = await getOutput("docker", [
		"exec",
		name,
		"node",
		"--input-type=module",
		"--eval",
		`const response = await fetch("http://127.0.0.1:5052/api/meta"); if (!response.ok) process.exit(2); process.stdout.write(JSON.stringify(await response.json()));`,
	]);
	const metadata = JSON.parse(output);
	const statuses = Object.fromEntries((metadata.authProviders || []).map(provider => [provider.slug, provider.status]));
	if (statuses.github !== "available" || statuses.discord !== "available" || statuses.google !== "available") {
		throw new Error(`Production provider metadata smoke failed.`);
	}
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
	await pAssignLoopbackPorts();
	await pAssignPrivateNetwork();
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
	if (externalBaseImage) {
		await run("docker", ["image", "tag", baseImage, `${projectName}-migrate:latest`]);
		await run("docker", ["image", "tag", baseImage, `${projectName}-grant-roles:latest`]);
		await run("docker", ["image", "tag", testBffImage, `${projectName}-bff:latest`]);
		await run("docker", [...composeArgs, "build", "static"]);
		await run("docker", [...composeArgs, "up", "--no-build", "-d"]);
	} else {
		await run("docker", [...composeArgs, "up", "--build", "-d"]);
	}
	await pWaitForReady();
	await run("docker", [...composeArgs, "--profile", "backup", "run", "--rm", "backup"]);
	Object.assign(env, {
		DATABASE_URL: `postgresql://hub_runtime:${env.HUB_RUNTIME_DB_PASSWORD}@db:5432/hub`,
		HUB_DATABASE_SSL: "false",
		HUB_HOST: "0.0.0.0",
		HUB_TEST_POSTGRES_URL: `postgresql://hub_runtime:${env.HUB_RUNTIME_DB_PASSWORD}@127.0.0.1:${env.HUB_TEST_POSTGRES_PORT}/hub`,
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
		"--env", "HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS",
		"--env", "HUB_AUTH_PROVIDERS=github,discord,google",
		"--env", "GITHUB_CLIENT_ID",
		"--env", "GITHUB_CLIENT_SECRET",
		"--env", "DISCORD_CLIENT_ID",
		"--env", "DISCORD_CLIENT_SECRET",
		"--env", "GOOGLE_CLIENT_ID",
		"--env", "GOOGLE_CLIENT_SECRET",
		"--env", "HUB_HOST",
		baseImage,
	]);
	await pWaitForContainerHealthy({name: productionSmokeName});
	await pCheckProductionProviderMetadata({name: productionSmokeName});
	await run("node", [
		"--experimental-vm-modules",
		"./node_modules/jest/bin/jest.js",
		"test/jest/hub/HubSemanticOperationsPostgres.test.js",
		"test/jest/hub/HubInventoryPostgres.test.js",
		"test/jest/hub/HubMultiProviderIdentityPostgres.test.js",
		"test/jest/hub/HubRulesPolicyPostgres.test.js",
		"--runInBand",
		"--no-coverage",
		"--forceExit",
	]);
	exitCode = await run("npx", [
		"playwright",
		"test",
		"--config",
		"playwright.hub.config.ts",
		...process.argv.slice(2),
	], {isAllowFailure: true});
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
