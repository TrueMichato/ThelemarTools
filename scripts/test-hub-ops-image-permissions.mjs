import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ops-image-permissions-"));
const imageTag = `thelemartools-hub-ops-permissions-test:${process.pid}-${Date.now()}`;

function run (command, args, {capture = false, expectFailure = false} = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: capture ? "pipe" : "inherit",
	});
	if (result.error) throw result.error;
	if (!expectFailure && result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status}.`);
	}
	if (expectFailure && result.status === 0) {
		throw new Error(`${command} unexpectedly succeeded.`);
	}
	return result;
}

function copyRestrictiveScripts () {
	const serverDir = path.join(tempDir, "server");
	const scriptsDir = path.join(serverDir, "scripts");
	fs.mkdirSync(serverDir, {recursive: true});
	fs.copyFileSync(path.join(repoRoot, "server", "ops.Dockerfile"), path.join(serverDir, "ops.Dockerfile"));
	fs.cpSync(path.join(repoRoot, "server", "scripts"), scriptsDir, {recursive: true});

	const makeRestrictive = filePath => {
		const stat = fs.lstatSync(filePath);
		if (stat.isDirectory()) {
			for (const entry of fs.readdirSync(filePath)) makeRestrictive(path.join(filePath, entry));
			fs.chmodSync(filePath, 0o700);
			return;
		}
		if (stat.isFile()) fs.chmodSync(filePath, 0o600);
	};
	makeRestrictive(scriptsDir);

	const entryMode = fs.statSync(path.join(scriptsDir, "backup-encrypted.mjs")).mode & 0o777;
	if (entryMode !== 0o600) throw new Error(`Restrictive source fixture has mode ${entryMode.toString(8)}, expected 600.`);
}

const permissionProbe = String.raw`
	import fs from "node:fs";
	import path from "node:path";

	let fileCount = 0;
	function inspectTree (current) {
		const stat = fs.statSync(current);
		const mode = stat.mode & 0o777;
		if (stat.isDirectory()) {
			if (mode !== 0o755) throw new Error("Directory " + current + " has mode " + mode.toString(8) + ", expected 755.");
			for (const entry of fs.readdirSync(current)) inspectTree(path.join(current, entry));
			return;
		}
		if (!stat.isFile()) return;
		fileCount++;
		if (mode !== 0o644) throw new Error("File " + current + " has mode " + mode.toString(8) + ", expected 644.");
		fs.readFileSync(current);
		try {
			fs.accessSync(current, fs.constants.W_OK);
			throw new Error("UID 1001 can write " + current + ".");
		} catch (error) {
			if (error.code !== "EACCES") throw error;
		}
	}

	inspectTree("/app/server/scripts");
	if (!fileCount) throw new Error("No operations scripts were inspected.");
	console.log("Validated " + fileCount + " read-only operations scripts as UID 1001.");
`;

try {
	run("docker", ["version"]);
	copyRestrictiveScripts();
	run("docker", [
		"build",
		"--file", path.join(tempDir, "server", "ops.Dockerfile"),
		"--tag", imageTag,
		tempDir,
	]);
	run("docker", [
		"run",
		"--rm",
		"--network", "none",
		"--user", "1001:1001",
		"--entrypoint", "node",
		imageTag,
		"--input-type=module",
		"--eval", permissionProbe,
	]);

	const moduleLoad = run("docker", [
		"run",
		"--rm",
		"--network", "none",
		"--user", "1001:1001",
		"--entrypoint", "node",
		imageTag,
		"server/scripts/backup-encrypted.mjs",
	], {capture: true, expectFailure: true});
	const output = `${moduleLoad.stdout}\n${moduleLoad.stderr}`;
	if (/EACCES|permission denied/i.test(output)) {
		throw new Error(`Backup module load was blocked by image permissions:\n${output}`);
	}
	if (!output.includes("DATABASE_URL is required")) {
		throw new Error(`Backup module did not reach its expected configuration guard:\n${output}`);
	}
	process.stdout.write("Backup entrypoint and transitive imports are readable as UID 1001; scripts remain non-writable.\n");
} finally {
	spawnSync("docker", ["image", "rm", "--force", imageTag], {cwd: repoRoot, stdio: "ignore"});
	fs.rmSync(tempDir, {recursive: true, force: true});
}
