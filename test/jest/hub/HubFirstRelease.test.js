import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const firstReleaseScript = path.join(repoRoot, "deploy/hub/first-release.sh");
const releaseScript = path.join(repoRoot, "deploy/hub/release.sh");

function makeTempDir () {
	return fs.mkdtempSync(path.join(os.tmpdir(), "hub-first-release-test-"));
}

function getIsolatedGitEnv (baseEnv = process.env) {
	const env = {...baseEnv};
	const exactKeys = new Set([
		"GIT_ALLOW_PROTOCOL",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_COMMON_DIR",
		"GIT_CONFIG",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_NOSYSTEM",
		"GIT_CONFIG_PARAMETERS",
		"GIT_CONFIG_SYSTEM",
		"GIT_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_PREFIX",
		"GIT_PROTOCOL_FROM_USER",
		"GIT_WORK_TREE",
	]);
	for (const key of Object.keys(env)) {
		if (exactKeys.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
	}
	env.GIT_CONFIG_NOSYSTEM = "1";
	env.GIT_CONFIG_GLOBAL = os.devNull;
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
	env.GIT_CONFIG_VALUE_0 = "always";
	return env;
}

function runGit (args, options = {}) {
	const {env = process.env, ...spawnOptions} = options;
	return spawnSync("git", args, {...spawnOptions, env: getIsolatedGitEnv(env)});
}

function createTaggedFixture (dir) {
	const checkout = path.join(dir, "checkout");
	expect(runGit(["init", checkout]).status).toBe(0);
	for (const args of [
		["-C", checkout, "config", "user.name", "Release Test"],
		["-C", checkout, "config", "user.email", "release@example.invalid"],
	]) expect(runGit(args).status).toBe(0);
	fs.writeFileSync(path.join(checkout, "file"), "legacy\n");
	expect(runGit(["-C", checkout, "add", "file"]).status).toBe(0);
	expect(runGit(["-C", checkout, "commit", "-m", "legacy"]).status).toBe(0);
	const previousSha = runGit(["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim();
	expect(runGit(["-C", checkout, "tag", "-a", "hub-legacy", "-m", "legacy"]).status).toBe(0);
	fs.writeFileSync(path.join(checkout, "file"), "candidate\n");
	expect(runGit(["-C", checkout, "commit", "-am", "candidate"]).status).toBe(0);
	const targetSha = runGit(["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim();
	expect(runGit(["-C", checkout, "tag", "-a", "hub-candidate", "-m", "candidate"]).status).toBe(0);
	return {checkout, previousSha, targetSha};
}

describe("Campaign Hub first initialized release", () => {
	it("keeps the wrapper limited to immutable identity capture and release handoff", () => {
		const source = fs.readFileSync(firstReleaseScript, "utf8");
		expect(source.indexOf("flock -n 9")).toBeLessThan(source.indexOf("git -C \"$ROOT\" checkout --detach \"$TARGET_SHA\""));
		expect(source).toContain("deployment already contains release.sh");
		expect(source).toContain("compose_current ps -q bff");
		expect(source).toContain("compose_current ps -q static");
		expect(source).toContain("running BFF image revision does not match the legacy checkout");
		expect(source).toContain("backup image revision does not match the legacy checkout");
		expect(source).toContain("HUB_RELEASE_PREVIOUS_BACKUP_IMAGE_ID");
		expect(source).toContain("HUB_RELEASE_PREVIOUS_CONFIG_SHA256");
		expect(source).toContain("exec env");
		expect(source).not.toMatch(/--yes|docker\s+(?:build|pull)|compose_current\s+(?:build|up|down|rm)|docker\s+volume|^\s*chown\b/m);
	});

	it("rejects incomplete or ambient first-release handoff variables", () => {
		const incomplete = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"FIRST_USE=1",
			"INHERITED_LOCK_FD=9",
			"validate_first_use_environment",
		].join("\n")], {encoding: "utf8"});
		expect(incomplete.status).not.toBe(0);
		expect(incomplete.stderr).toMatch(/handoff is incomplete/);

		const ambient = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"FIRST_USE=0",
			"FIRST_USE_PREVIOUS_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"validate_first_use_environment",
		].join("\n")], {encoding: "utf8"});
		expect(ambient.status).not.toBe(0);
		expect(ambient.stderr).toMatch(/require HUB_RELEASE_FIRST_USE=1/);
	});

	it("uses the legacy Git tree hash for first-use previous-config evidence", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const wrapper = fs.readFileSync(firstReleaseScript, "utf8");
		expect(wrapper).toContain("git -C \"$ROOT\" ls-tree \"$PREVIOUS_SHA\"");
		expect(wrapper).toContain("HUB_RELEASE_PREVIOUS_CONFIG_SHA256=\"$previous_config_sha256\"");
		expect(source).toContain("record previous_config_sha256 \"$FIRST_USE_PREVIOUS_CONFIG_SHA256\"");
		expect(source).toContain("git-ls-tree:compose.hub.yml,compose.hub.public.yml,deploy/hub/Caddyfile.public");
	});

	it("binds the candidate checkout to an annotated ancestor rollback tag", () => {
		const dir = makeTempDir();
		try {
			const {checkout, previousSha, targetSha} = createTaggedFixture(dir);
			const result = spawnSync("bash", ["-c", [
				`source ${JSON.stringify(releaseScript)}`,
				`ROOT=${JSON.stringify(checkout)}`,
				`TARGET_SHA=${JSON.stringify(targetSha)}`,
				"FIRST_USE=1",
				`FIRST_USE_PREVIOUS_SHA=${JSON.stringify(previousSha)}`,
				"FIRST_USE_PREVIOUS_TAG=hub-legacy",
				"configure_previous_release_identity",
				"printf '%s\\n' \"$PREVIOUS_SHA\" \"$PREVIOUS_TAG\" \"$SOURCE_CHECKED_OUT\"",
			].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
			expect(result.status).toBe(0);
			expect(result.stdout.trim().split("\n")).toEqual([previousSha, "hub-legacy", "true"]);

			const stale = spawnSync("bash", ["-c", [
				`source ${JSON.stringify(releaseScript)}`,
				`ROOT=${JSON.stringify(checkout)}`,
				`TARGET_SHA=${JSON.stringify(targetSha)}`,
				"FIRST_USE=1",
				`FIRST_USE_PREVIOUS_SHA=${JSON.stringify(targetSha)}`,
				"FIRST_USE_PREVIOUS_TAG=hub-legacy",
				"configure_previous_release_identity",
			].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
			expect(stale.status).not.toBe(0);
			expect(stale.stderr).toMatch(/previous SHA matches the candidate/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects running-image drift after the wrapper captures the handoff", () => {
		const imageA = `sha256:${"a".repeat(64)}`;
		const imageB = `sha256:${"b".repeat(64)}`;
		const imageC = `sha256:${"c".repeat(64)}`;
		const drift = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"FIRST_USE=1",
			`FIRST_USE_PREVIOUS_BFF_IMAGE_ID=${imageA}`,
			`FIRST_USE_PREVIOUS_STATIC_IMAGE_ID=${imageB}`,
			`FIRST_USE_PREVIOUS_BACKUP_IMAGE_ID=${imageC}`,
			`validate_first_use_image_handoff ${imageA} ${imageB} sha256:${"d".repeat(64)}`,
		].join("\n")], {encoding: "utf8"});
		expect(drift.status).not.toBe(0);
		expect(drift.stderr).toMatch(/backup image changed/);
	});

	it("restores the legacy checkout when a first-use preflight fails", () => {
		const dir = makeTempDir();
		try {
			const {checkout, previousSha} = createTaggedFixture(dir);
			const state = path.join(dir, "state.tsv");
			const trace = path.join(dir, "trace.log");
			fs.writeFileSync(state, "status\trunning\n");
			fs.writeFileSync(trace, "");
			const result = spawnSync("bash", ["-c", [
				`source ${JSON.stringify(releaseScript)}`,
				`ROOT=${JSON.stringify(checkout)}`,
				`PREVIOUS_SHA=${JSON.stringify(previousSha)}`,
				"SOURCE_CHECKED_OUT=true",
				"TRAFFIC_MUTATED=false",
				"SCHEMA_MUTATED=false",
				"SIMULATE=0",
				"CURRENT_PHASE=preflight",
				`STATE_FILE=${JSON.stringify(state)}`,
				`TRACE_FILE=${JSON.stringify(trace)}`,
				"restore_candidate_image_tags () { return 0; }",
				"render_evidence () { return 0; }",
				"handle_failure 1",
			].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
			expect(result.status).toBe(1);
			expect(runGit(["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim()).toBe(previousSha);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("arms first-use checkout recovery before handoff validation and release setup", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const earlyTrap = source.indexOf("trap early_first_use_cleanup EXIT");
		const validation = source.indexOf("validate_first_use_environment", source.indexOf("main ()"));
		const fullTrap = source.indexOf("trap cleanup EXIT");
		expect(earlyTrap).toBeGreaterThan(-1);
		expect(earlyTrap).toBeLessThan(validation);
		expect(validation).toBeLessThan(fullTrap);
	});

	it("restores the legacy checkout when setup fails before full evidence cleanup exists", () => {
		const dir = makeTempDir();
		try {
			const {checkout, previousSha} = createTaggedFixture(dir);
			const result = spawnSync("bash", ["-c", [
				`source ${JSON.stringify(releaseScript)}`,
				"FIRST_USE=1",
				`ROOT=${JSON.stringify(checkout)}`,
				`PREVIOUS_SHA=${JSON.stringify(previousSha)}`,
				"trap early_first_use_cleanup EXIT",
				"false",
			].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
			expect(result.status).toBe(1);
			expect(runGit(["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim()).toBe(previousSha);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("pins prerelease backup to an immutable image with no build or pull path", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const releaseCompose = fs.readFileSync(path.join(repoRoot, "compose.hub.release.yml"), "utf8");
		expect(releaseCompose).toContain("HUB_RELEASE_BACKUP_IMAGE");
		expect(releaseCompose).toContain("build: !reset null");
		expect(source).toContain("compose_release --profile backup run --interactive=false -T --rm --no-deps --pull never backup");
		expect(source).toContain("compose_current build migrate grant-roles bff static backup");
		expect(source).toContain("export HUB_RELEASE_BACKUP_IMAGE=\"$" + "{CANDIDATE_IMAGE_IDS[4]}\"");
		expect(source).not.toContain("compose_current --profile backup run");
	});
});
