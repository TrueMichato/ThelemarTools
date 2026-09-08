import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const releaseScript = path.join(repoRoot, "deploy/hub/release.sh");
const helper = path.join(repoRoot, "deploy/hub/release-helper.py");

function makeTempDir () {
	return fs.mkdtempSync(path.join(os.tmpdir(), "hub-release-test-"));
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

function runGitShell (script, baseEnv = process.env) {
	return spawnSync("bash", ["-c", script], {encoding: "utf8", env: getIsolatedGitEnv(baseEnv)});
}

function getShellExpansion (expression) {
	return "$" + `{${expression}}`;
}

function runImagePreservationScenario ({body, failTagTarget = ""}) {
	const dir = makeTempDir();
	const state = path.join(dir, "state.tsv");
	const imageState = path.join(dir, "images.tsv");
	const oldMigrate = `sha256:${"1".repeat(64)}`;
	const oldBff = `sha256:${"2".repeat(64)}`;
	const candidateMigrate = `sha256:${"3".repeat(64)}`;
	const candidateBff = `sha256:${"4".repeat(64)}`;
	fs.writeFileSync(imageState, `hub-migrate\t${oldMigrate}\nhub-bff\t${oldBff}\n`);
	const result = spawnSync("bash", ["-c", [
		`source ${JSON.stringify(releaseScript)}`,
		`STATE_FILE=${JSON.stringify(state)}`,
		`TEST_IMAGE_STATE=${JSON.stringify(imageState)}`,
		`RELEASE_ID=${JSON.stringify("20260907T230000Z-hub-test-123")}`,
		": >\"$STATE_FILE\"",
		"CANDIDATE_IMAGE_REFS=(hub-migrate hub-bff)",
		`PREBUILD_IMAGE_IDS=(${oldMigrate} ${oldBff})`,
		`TEST_FAIL_TAG_TARGET=${JSON.stringify(failTagTarget)}`,
		"test_get_image () {",
		"  awk -F '\\t' -v ref=\"$1\" '$1 == ref {print $2; found = 1; exit} END {if (!found) exit 1}' \"$TEST_IMAGE_STATE\"",
		"}",
		"test_set_image () {",
		`  awk -F '\\t' -v ref="$1" '$1 != ref' "$TEST_IMAGE_STATE" >"${getShellExpansion("TEST_IMAGE_STATE")}.new"`,
		`  printf '%s\\t%s\\n' "$1" "$2" >>"${getShellExpansion("TEST_IMAGE_STATE")}.new"`,
		`  mv "${getShellExpansion("TEST_IMAGE_STATE")}.new" "$TEST_IMAGE_STATE"`,
		"}",
		"test_remove_image () {",
		"  test_get_image \"$1\" >/dev/null || return 1",
		`  awk -F '\\t' -v ref="$1" '$1 != ref' "$TEST_IMAGE_STATE" >"${getShellExpansion("TEST_IMAGE_STATE")}.new"`,
		`  mv "${getShellExpansion("TEST_IMAGE_STATE")}.new" "$TEST_IMAGE_STATE"`,
		"}",
		"docker () {",
		`  local operation="${getShellExpansion("1:-")} ${getShellExpansion("2:-")}"`,
		"  case \"$operation\" in",
		"    \"image inspect\")",
		`      local ref="${getShellExpansion("!#")}"`,
		"      local image_id",
		"      image_id=\"$(test_get_image \"$ref\")\" || return 1",
		"      if [[ \" $* \" == *\" --format \"* ]]; then",
		"        printf '%s\\n' \"$image_id\"",
		"      else",
		"        printf '{}\\n'",
		"      fi",
		"      ;;",
		"    \"image ls\")",
		`      local ref="${getShellExpansion("!#")}"`,
		"      test_get_image \"$ref\" 2>/dev/null || return 0",
		"      ;;",
		"    \"image tag\")",
		"      local source_ref=\"$3\"",
		"      local target_ref=\"$4\"",
		"      local image_id",
		"      image_id=\"$(test_get_image \"$source_ref\")\" || return 1",
		"      [[ \"$target_ref\" != \"$TEST_FAIL_TAG_TARGET\" ]] || return 91",
		"      test_set_image \"$target_ref\" \"$image_id\"",
		"      ;;",
		"    \"image rm\")",
		"      local ref=\"$3\"",
		"      test_remove_image \"$ref\"",
		"      ;;",
		"    *) return 99 ;;",
		"  esac",
		"}",
		`OLD_MIGRATE=${oldMigrate}`,
		`OLD_BFF=${oldBff}`,
		`CANDIDATE_MIGRATE=${candidateMigrate}`,
		`CANDIDATE_BFF=${candidateBff}`,
		body,
	].join("\n")], {encoding: "utf8"});
	return {
		...result,
		dir,
		state: fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "",
	};
}

function runSimulation ({
	dir,
	failPhase,
	failStep,
	rollbackCompatible = true,
	deployRollbackCompatible,
	plannedMigrations = "0004",
	holdSeconds,
	lockFile = path.join(dir, "release.lock"),
}) {
	const evidenceDir = path.join(dir, "evidence");
	const env = {
		...process.env,
		HUB_RELEASE_TEST_MODE: "1",
		HUB_RELEASE_SIMULATE: "1",
		HUB_RELEASE_LOCK_FILE: lockFile,
		HUB_RELEASE_EVIDENCE_DIR: evidenceDir,
		HUB_RELEASE_TEST_ROLLBACK_COMPATIBLE: `${rollbackCompatible}`,
		HUB_RELEASE_TEST_PLANNED_MIGRATIONS: plannedMigrations,
		...(deployRollbackCompatible == null
			? {}
			: {HUB_RELEASE_TEST_DEPLOY_ROLLBACK_COMPATIBLE: `${deployRollbackCompatible}`}),
		...(failPhase ? {HUB_RELEASE_TEST_FAIL_PHASE: failPhase} : {}),
		...(failStep ? {HUB_RELEASE_TEST_FAIL_STEP: failStep} : {}),
		...(holdSeconds ? {HUB_RELEASE_TEST_HOLD_LOCK_SECONDS: `${holdSeconds}`} : {}),
	};
	const result = spawnSync("bash", [releaseScript, "--yes", "hub-test-2026-09-01"], {env, encoding: "utf8"});
	const releaseDirs = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : [];
	const releaseDir = releaseDirs.length ? path.join(evidenceDir, releaseDirs[0]) : null;
	return {
		...result,
		releaseDir,
		trace: releaseDir ? fs.readFileSync(path.join(releaseDir, "phases.log"), "utf8") : "",
		evidence: releaseDir && fs.existsSync(path.join(releaseDir, "evidence.json"))
			? JSON.parse(fs.readFileSync(path.join(releaseDir, "evidence.json"), "utf8"))
			: null,
	};
}

describe("Campaign Hub deliberate release automation", () => {
	it("isolates disposable Git fixtures from hostile inherited config", () => {
		const hostileEnv = {
			...process.env,
			GIT_ALLOW_PROTOCOL: "https:ssh",
			GIT_CONFIG: "/tmp/hostile-git-config",
			GIT_CONFIG_PARAMETERS: "'protocol.file.allow'='never'",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "protocol.file.allow",
			GIT_CONFIG_VALUE_0: "never",
			GIT_CONFIG_KEY_9: "core.hooksPath",
			GIT_CONFIG_VALUE_9: "/tmp/hostile-hooks",
			GIT_PROTOCOL_FROM_USER: "0",
		};
		const isolated = getIsolatedGitEnv(hostileEnv);

		expect(isolated).toMatchObject({
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "protocol.file.allow",
			GIT_CONFIG_VALUE_0: "always",
		});
		for (const key of [
			"GIT_ALLOW_PROTOCOL",
			"GIT_CONFIG",
			"GIT_CONFIG_PARAMETERS",
			"GIT_CONFIG_KEY_9",
			"GIT_CONFIG_VALUE_9",
			"GIT_PROTOCOL_FROM_USER",
		]) expect(isolated).not.toHaveProperty(key);

		const dir = makeTempDir();
		try {
			const remote = path.join(dir, "remote.git");
			const checkout = path.join(dir, "checkout");
			expect(runGit(["init", "--bare", remote], {env: hostileEnv}).status).toBe(0);
			expect(runGit(["init", checkout], {env: hostileEnv}).status).toBe(0);
			for (const args of [
				["-C", checkout, "config", "user.name", "Release Test"],
				["-C", checkout, "config", "user.email", "release@example.invalid"],
				["-C", checkout, "remote", "add", "origin", remote],
			]) expect(runGit(args, {env: hostileEnv}).status).toBe(0);
			fs.writeFileSync(path.join(checkout, "file"), "release\n");
			expect(runGit(["-C", checkout, "add", "file"], {env: hostileEnv}).status).toBe(0);
			expect(runGit(["-C", checkout, "commit", "-m", "release"], {env: hostileEnv}).status).toBe(0);
			expect(runGit(["-C", checkout, "push", "origin", "HEAD"], {env: hostileEnv}).status).toBe(0);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("refuses ambient simulation without test mode and creates no release evidence", () => {
		const dir = makeTempDir();
		try {
			const evidenceDir = path.join(dir, "evidence");
			const result = spawnSync("bash", [releaseScript, "--yes", "hub-test-ambient"], {
				env: {
					...process.env,
					HUB_RELEASE_SIMULATE: "1",
					HUB_RELEASE_LOCK_FILE: path.join(dir, "lock"),
					HUB_RELEASE_EVIDENCE_DIR: evidenceDir,
				},
				encoding: "utf8",
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/available only with HUB_RELEASE_TEST_MODE=1/);
			expect(fs.existsSync(evidenceDir)).toBe(false);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("marks a successful test simulation explicitly without production-shaped success evidence", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir});
			expect(result.status).toBe(0);
			expect(result.evidence).toMatchObject({
				status: "simulated",
				simulation: "true",
				traffic_mutated: "simulated",
				schema_mutated: "simulated",
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("uses a non-blocking process lock and refuses concurrent release", async () => {
		const dir = makeTempDir();
		try {
			const lockFile = path.join(dir, "release.lock");
			const env = {
				...process.env,
				HUB_RELEASE_TEST_MODE: "1",
				HUB_RELEASE_SIMULATE: "1",
				HUB_RELEASE_LOCK_FILE: lockFile,
				HUB_RELEASE_EVIDENCE_DIR: path.join(dir, "first"),
				HUB_RELEASE_TEST_HOLD_LOCK_SECONDS: "2",
			};
			const first = spawn("bash", [releaseScript, "--yes", "hub-test-lock"], {env, stdio: "ignore"});
			await new Promise(resolve => setTimeout(resolve, 300));
			const second = runSimulation({dir, lockFile});
			expect(second.status).toBe(75);
			expect(second.stderr).toMatch(/another Campaign Hub release holds/);
			await new Promise(resolve => first.once("exit", resolve));
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	}, 15_000);

	it("repairs only explicit backup UID/GID keys for the Oracle ubuntu 1001 mapping", () => {
		const dir = makeTempDir();
		try {
			const envFile = path.join(dir, ".env.hub");
			fs.writeFileSync(envFile, "HUB_COOKIE_SECRET=test-secret\nHUB_BACKUP_UID=1000\n");
			fs.chmodSync(envFile, 0o600);
			const result = spawnSync(helper, [
				"set-backup-ids",
				"--file", envFile,
				"--uid", "1001",
				"--gid", "1001",
			], {encoding: "utf8"});
			expect(result.status).toBe(0);
			expect(fs.readFileSync(envFile, "utf8")).toBe(
				"HUB_" + "COOKIE_SECRET=test-secret\nHUB_BACKUP_UID=1001\nHUB_BACKUP_GID=1001\n",
			);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("accepts only an immutable annotated origin tag and exposes its full SHA", () => {
		const dir = makeTempDir();
		try {
			const remote = path.join(dir, "remote.git");
			const checkout = path.join(dir, "checkout");
			expect(runGit(["init", "--bare", remote]).status).toBe(0);
			expect(runGit(["init", checkout]).status).toBe(0);
			for (const args of [
				["-C", checkout, "config", "user.name", "Release Test"],
				["-C", checkout, "config", "user.email", "release@example.invalid"],
				["-C", checkout, "remote", "add", "origin", remote],
			]) expect(runGit(args).status).toBe(0);
			fs.writeFileSync(path.join(checkout, "file"), "release\n");
			expect(runGit(["-C", checkout, "add", "file"]).status).toBe(0);
			expect(runGit(["-C", checkout, "commit", "-m", "release"]).status).toBe(0);
			expect(runGit(["-C", checkout, "tag", "-a", "hub-test", "-m", "verified"]).status).toBe(0);
			expect(runGit(["-C", checkout, "push", "origin", "HEAD", "refs/tags/hub-test"]).status).toBe(0);
			const expectedSha = runGit(["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim();
			const script = `source ${JSON.stringify(releaseScript)}; resolve_remote_tag ${JSON.stringify(checkout)} hub-test`;
			const result = runGitShell(script);
			expect(result.status).toBe(0);
			expect(result.stdout.trim().split("\t")).toEqual([expect.stringMatching(/^[0-9a-f]{40}$/), expectedSha]);

			expect(runGit(["-C", checkout, "tag", "hub-lightweight"]).status).toBe(0);
			expect(runGit(["-C", checkout, "push", "origin", "refs/tags/hub-lightweight"]).status).toBe(0);
			const mismatch = runGitShell(
				`source ${JSON.stringify(releaseScript)}; resolve_remote_tag ${JSON.stringify(checkout)} hub-lightweight`,
			);
			expect(mismatch.status).not.toBe(0);
			expect(mismatch.stderr).toMatch(/must be an annotated tag/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects services outside the dedicated Hub Compose scope", () => {
		const allowed = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  [[ \"$*\" == \"--profile * config --services\" ]] && printf '%s\\n' db migrate grant-roles bff static edge maintenance backup",
			"}",
			"assert_compose_safe",
		].join("\n")], {encoding: "utf8"});
		expect(allowed.status).toBe(0);

		const unrelated = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  [[ \"$*\" == \"--profile * config --services\" ]] && printf '%s\\n' db bff unrelated-service",
			"}",
			"assert_compose_safe",
		].join("\n")], {encoding: "utf8"});
		expect(unrelated.status).not.toBe(0);
		expect(unrelated.stderr).toMatch(/non-Hub service: unrelated-service/);

		const enumerationFailure = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  return 42",
			"}",
			"assert_compose_safe",
		].join("\n")], {encoding: "utf8"});
		expect(enumerationFailure.status).not.toBe(0);
		expect(enumerationFailure.stderr).toMatch(/could not enumerate the complete Hub Compose service scope/);
	});

	it("rejects dirty release source and local/origin tag identity drift", () => {
		const dir = makeTempDir();
		try {
			const remote = path.join(dir, "remote.git");
			const checkout = path.join(dir, "checkout");
			expect(runGit(["init", "--bare", remote]).status).toBe(0);
			expect(runGit(["init", checkout]).status).toBe(0);
			for (const args of [
				["-C", checkout, "config", "user.name", "Release Test"],
				["-C", checkout, "config", "user.email", "release@example.invalid"],
				["-C", checkout, "remote", "add", "origin", remote],
			]) expect(runGit(args).status).toBe(0);
			fs.writeFileSync(path.join(checkout, "file"), "one\n");
			expect(runGit(["-C", checkout, "add", "file"]).status).toBe(0);
			expect(runGit(["-C", checkout, "commit", "-m", "one"]).status).toBe(0);
			expect(runGit(["-C", checkout, "tag", "-a", "hub-test", "-m", "one"]).status).toBe(0);
			expect(runGit(["-C", checkout, "push", "origin", "HEAD", "refs/tags/hub-test"]).status).toBe(0);
			const originalObject = runGit(["-C", checkout, "rev-parse", "refs/tags/hub-test"], {encoding: "utf8"}).stdout.trim();

			fs.writeFileSync(path.join(checkout, "dirty"), "untracked\n");
			const dirty = runGitShell(
				`source ${JSON.stringify(releaseScript)}; ROOT=${JSON.stringify(checkout)}; assert_clean_root`,
			);
			expect(dirty.status).not.toBe(0);
			expect(dirty.stderr).toMatch(/deployment checkout is dirty/);
			fs.rmSync(path.join(checkout, "dirty"));

			fs.writeFileSync(path.join(checkout, "file"), "two\n");
			expect(runGit(["-C", checkout, "commit", "-am", "two"]).status).toBe(0);
			expect(runGit(["-C", checkout, "tag", "-fa", "hub-test", "-m", "two"]).status).toBe(0);
			expect(runGit(["-C", checkout, "push", "--force", "origin", "refs/tags/hub-test"]).status).toBe(0);
			const script = [
				`source ${JSON.stringify(releaseScript)}`,
				`pair="$(resolve_remote_tag ${JSON.stringify(checkout)} hub-test)"`,
				`remote_object="\${pair%%$'\\t'*}"`,
				`[[ "$remote_object" == ${JSON.stringify(originalObject)} ]] || fail "local and origin tag identities do not match"`,
			].join("; ");
			const mismatch = runGitShell(script);
			expect(mismatch.status).not.toBe(0);
			expect(mismatch.stderr).toMatch(/local and origin tag identities do not match/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("stops before traffic mutation when backup fails", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir, failPhase: "backup"});
			const phases = result.trace.trim().split("\n");
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("failure:backup");
			expect(phases).not.toContain("rollback");
			expect(result.evidence.traffic_mutated).toBe("false");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("refuses migration incompatibility before deploy", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir, rollbackCompatible: false});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("failure:migration-plan");
			expect(result.trace).not.toContain("deploy");
			expect(result.evidence.rollback_compatible).toBe("false");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("evaluates real expand and contract migration policy fail-closed", () => {
		const dir = makeTempDir();
		try {
			const plan = path.join(dir, "plan.json");
			const policy = path.join(dir, "policy.json");
			const output = path.join(dir, "summary.json");
			fs.writeFileSync(plan, JSON.stringify({
				pending: [{version: "0004", filename: "0004_expand.sql", action: "apply"}],
			}));
			fs.writeFileSync(policy, JSON.stringify({
				migrations: {"0004": {phase: "expand", previousAppCompatible: true}},
			}));
			const expand = spawnSync(helper, [
				"migration",
				"--plan", plan,
				"--policy", policy,
				"--output", output,
			], {encoding: "utf8"});
			expect(expand.status).toBe(0);
			expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
				pendingVersions: ["0004"],
				rollbackCompatible: true,
			});

			fs.writeFileSync(policy, JSON.stringify({
				migrations: {"0004": {phase: "contract", previousAppCompatible: false}},
			}));
			const contract = spawnSync(helper, [
				"migration",
				"--plan", plan,
				"--policy", policy,
				"--output", output,
			], {encoding: "utf8"});
			expect(contract.status).not.toBe(0);
			expect(contract.stderr).toMatch(/contract-phase.*manual break-glass/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("automatically rolls back only the app after a compatible post-deploy health failure", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir, failPhase: "verify", rollbackCompatible: true});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("deploy");
			expect(result.trace).toContain("failure:verify");
			expect(result.trace).toContain("rollback");
			expect(result.evidence.rollback_result).toBe("simulated-compatible");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("records applied schema changes and leaves the compatible old app running when grants fail", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir, failStep: "grant-roles"});
			const phases = result.trace.trim().split("\n");
			expect(result.status).not.toBe(0);
			expect(result.evidence).toMatchObject({
				status: "failed",
				schema_mutated: "true",
				traffic_mutated: "false",
				migrations_planned: "0004",
				migrations_applied: "0004",
				failure_action: "previous-compatible-app-remains",
			});
			expect(phases).toContain("schema-migrated");
			expect(phases).toContain("schema-compatible-old-app-remains");
			expect(phases).not.toContain("rollback");
			expect(phases).not.toContain("isolate");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("keeps schema false when grants fail after a no-op migration apply", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failStep: "grant-roles",
				plannedMigrations: "none",
			});
			const phases = result.trace.trim().split("\n");
			expect(result.status).not.toBe(0);
			expect(result.evidence).toMatchObject({
				status: "failed",
				schema_mutated: "false",
				traffic_mutated: "false",
				migrations_planned: "none",
				migrations_applied: "none",
				failure_action: "database-unchanged-old-app-remains",
			});
			expect(phases).toContain("database-unchanged-old-app-remains");
			expect(phases).not.toContain("schema-migrated");
			expect(phases).not.toContain("schema-compatible-old-app-remains");
			expect(phases).not.toContain("rollback");
			expect(phases).not.toContain("isolate");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("records conservative schema evidence before failed-apply status parsing", () => {
		const dir = makeTempDir();
		try {
			const state = path.join(dir, "state.tsv");
			const plan = path.join(dir, "migration-plan.json");
			fs.writeFileSync(state, "schema_mutated\tfalse\n");
			fs.writeFileSync(plan, JSON.stringify({applied: []}));
			const script = [
				`source ${JSON.stringify(releaseScript)}`,
				`RELEASE_DIR=${JSON.stringify(dir)}`,
				`STATE_FILE=${JSON.stringify(state)}`,
				`PLANNED_MIGRATIONS=0004`,
				`SCHEMA_MUTATED=false`,
				`APPLIED_MIGRATIONS=none`,
				`compose_release () { printf 'not-json'; }`,
				`record_failed_migration_apply ${JSON.stringify(plan)}`,
			].join("; ");
			const result = spawnSync("bash", ["-c", script], {encoding: "utf8"});
			expect(result.status).toBe(0);
			expect(fs.readFileSync(state, "utf8")).toContain("schema_mutated\ttrue");
			expect(fs.readFileSync(state, "utf8")).toContain("migrations_applied\tunknown");
			expect(result.stdout).toMatch(/retaining conservative schema_mutated=true/);

			const source = fs.readFileSync(releaseScript, "utf8");
			const failedApply = source.slice(
				source.indexOf("record_failed_migration_apply ()"),
				source.indexOf("rollback_application ()"),
			);
			expect(failedApply.indexOf("replace_record schema_mutated true"))
				.toBeLessThan(failedApply.indexOf("compose_release run --rm --no-deps migrate"));
			const successfulApply = source.slice(
				source.indexOf("phase_deploy ()"),
				source.indexOf("phase_verify ()"),
			);
			expect(successfulApply.indexOf("replace_record schema_mutated true"))
				.toBeLessThan(successfulApply.indexOf("replace_record migrations_planned"));
			expect(successfulApply.indexOf("record migration_apply_sha256"))
				.toBeLessThan(successfulApply.indexOf("APPLIED_MIGRATIONS=\"$(python3"));
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("preserves schema evidence when pre-cutover migration status fails", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir, failStep: "pre-cutover-status"});
			const phases = result.trace.trim().split("\n");
			expect(result.status).not.toBe(0);
			expect(result.evidence).toMatchObject({
				schema_mutated: "true",
				traffic_mutated: "false",
				migrations_planned: "0004",
				migrations_applied: "0004",
				failure_action: "previous-compatible-app-remains",
			});
			expect(phases).not.toContain("rollback");
			expect(phases).not.toContain("isolate");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("isolates instead of rolling back an incompatible post-deploy failure", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				deployRollbackCompatible: false,
			});
			const phases = result.trace.trim().split("\n");
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("isolate");
			expect(phases).not.toContain("rollback");
			expect(result.evidence.rollback_result).toBe("forbidden-schema-incompatible");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("redacts credentials from human and machine evidence", () => {
		const dir = makeTempDir();
		try {
			const state = path.join(dir, "state.tsv");
			const json = path.join(dir, "evidence.json");
			const text = path.join(dir, "evidence.txt");
			fs.writeFileSync(state, [
				"status\tsucceeded",
				"message\tAuthorization: Bearer super-secret-token",
				"database\tpostgresql://hub:db-password@db:5432/hub",
				"detail\tHUB_COOKIE_SECRET=another-secret",
			].join("\n"));
			const result = spawnSync(helper, ["evidence", "--state", state, "--json", json, "--text", text], {encoding: "utf8"});
			expect(result.status).toBe(0);
			const combined = fs.readFileSync(json, "utf8") + fs.readFileSync(text, "utf8");
			expect(combined).toContain("[REDACTED]");
			expect(combined).not.toMatch(/super-secret-token|db-password|another-secret/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("preserves previous images and verifies every hold before restoring mutable tags", () => {
		const result = runImagePreservationScenario({body: [
			"preserve_candidate_image_tags",
			`first_hold="${getShellExpansion("PREBUILD_IMAGE_PRESERVATION_REFS[0]")}"`,
			`second_hold="${getShellExpansion("PREBUILD_IMAGE_PRESERVATION_REFS[1]")}"`,
			"test_set_image hub-migrate \"$CANDIDATE_MIGRATE\"",
			"test_set_image hub-bff \"$CANDIDATE_BFF\"",
			"restore_candidate_image_tags",
			"printf 'migrate=%s\\nbff=%s\\n' \"$(test_get_image hub-migrate)\" \"$(test_get_image hub-bff)\"",
			"! test_get_image \"$first_hold\" >/dev/null",
			"! test_get_image \"$second_hold\" >/dev/null",
		].join("\n")});
		try {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain(`migrate=sha256:${"1".repeat(64)}`);
			expect(result.stdout).toContain(`bff=sha256:${"2".repeat(64)}`);
			expect(result.state).toContain("previous_images_preserved\tfalse");
			expect(result.state).toContain("previous_image_0_preservation_ref\thub-migrate:hub-release-preserve-");
			expect(result.state).toContain("previous_image_1_preservation_ref\thub-bff:hub-release-preserve-");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("does not partially restore mutable tags when any preserved image is missing", () => {
		const result = runImagePreservationScenario({body: [
			"preserve_candidate_image_tags",
			`first_hold="${getShellExpansion("PREBUILD_IMAGE_PRESERVATION_REFS[0]")}"`,
			`second_hold="${getShellExpansion("PREBUILD_IMAGE_PRESERVATION_REFS[1]")}"`,
			"test_set_image hub-migrate \"$CANDIDATE_MIGRATE\"",
			"test_set_image hub-bff \"$CANDIDATE_BFF\"",
			"test_remove_image \"$second_hold\"",
			"if restore_candidate_image_tags; then exit 80; fi",
			"printf 'migrate=%s\\nbff=%s\\nfirst_hold=%s\\n' \\",
			"  \"$(test_get_image hub-migrate)\" \"$(test_get_image hub-bff)\" \"$(test_get_image \"$first_hold\")\"",
		].join("\n")});
		try {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain(`migrate=sha256:${"3".repeat(64)}`);
			expect(result.stdout).toContain(`bff=sha256:${"4".repeat(64)}`);
			expect(result.stdout).toContain(`first_hold=sha256:${"1".repeat(64)}`);
			expect(result.state).toContain("previous_images_preserved\ttrue");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("removes partial preservation tags when preservation creation fails", () => {
		const failedTarget = "hub-bff:hub-release-preserve-20260907T230000Z-hub-test-123";
		const result = runImagePreservationScenario({
			failTagTarget: failedTarget,
			body: [
				"if preserve_candidate_image_tags; then exit 80; fi",
				`first_hold="hub-migrate:hub-release-preserve-${getShellExpansion("RELEASE_ID")}"`,
				"! test_get_image \"$first_hold\" >/dev/null",
				"printf 'partial_cleanup=passed\\n'",
			].join("\n"),
		});
		try {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("partial_cleanup=passed");
			expect(result.stderr).toMatch(/could not preserve current release image: hub-bff/);
			expect(result.state).not.toContain("previous_images_preserved\ttrue");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("treats already-absent preservation tags as cleaned", () => {
		const result = runImagePreservationScenario({body: [
			"preserve_candidate_image_tags",
			`first_hold="${getShellExpansion("PREBUILD_IMAGE_PRESERVATION_REFS[0]")}"`,
			"test_remove_image \"$first_hold\"",
			"remove_candidate_image_preservation_tags",
			`[[ "${getShellExpansion("#PREBUILD_IMAGE_PRESERVATION_REFS[@]")}" == 0 ]]`,
			"printf 'idempotent_cleanup=passed\\n'",
		].join("\n")});
		try {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("idempotent_cleanup=passed");
			expect(result.stderr).toBe("");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("records successful first-use recovery after a partial preservation failure cleans itself", () => {
		const failedTarget = "hub-bff:hub-release-preserve-20260907T230000Z-hub-test-123";
		const result = runImagePreservationScenario({
			failTagTarget: failedTarget,
			body: [
				"ROOT=/deployment",
				`PREVIOUS_SHA=${"a".repeat(40)}`,
				"SOURCE_CHECKED_OUT=true",
				"SIMULATE=0",
				"TRAFFIC_MUTATED=false",
				"SCHEMA_MUTATED=false",
				"CURRENT_PHASE=record-rollback",
				"TRACE_FILE=",
				"render_evidence () { :; }",
				"git () {",
				"  [[ \"$*\" == \"-C /deployment checkout --detach $PREVIOUS_SHA\" ]]",
				"}",
				"if preserve_candidate_image_tags; then exit 80; fi",
				"handle_failure 41",
			].join("\n"),
		});
		try {
			expect(result.status).toBe(41);
			expect(result.state).toContain("pretraffic_recovery\tsucceeded");
			expect(result.state).not.toContain("pretraffic_recovery\tfailed");
			expect(result.stderr).not.toMatch(/Failed to restore the previous checkout\/image tags/);
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("pins Hub-only release scope and never tears down the environment or reverses migrations", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "deploy/hub/migration-policy.json"), "utf8"));
		const releaseCompose = fs.readFileSync(path.join(repoRoot, "compose.hub.release.yml"), "utf8");
		expect(source).toContain("flock -n 9");
		expect(source).toContain("git -C \"$ROOT\" verify-tag");
		expect(source.match(/assert_compose_safe/g)?.length).toBeGreaterThanOrEqual(3);
		expect(source.match(/assert_release_compose_safe/g)?.length).toBeGreaterThanOrEqual(3);
		expect(source).toContain("release Compose configuration contains non-Hub service");
		expect(source).toContain("preserve_candidate_image_tags");
		expect(source).toContain("restore_candidate_image_tags");
		expect(source).toContain("wait_for_public_ready");
		expect(source).toContain("assert_candidate_images");
		expect(source).toContain("compose_release up -d --no-deps --force-recreate --wait bff static");
		expect(source).toContain("compose_release up -d --no-deps --force-recreate edge");
		expect(source).toContain("compose_current stop bff");
		for (const variable of [
			"HUB_RELEASE_MIGRATE_IMAGE",
			"HUB_RELEASE_GRANT_ROLES_IMAGE",
			"HUB_RELEASE_BFF_IMAGE",
			"HUB_RELEASE_STATIC_IMAGE",
			"HUB_RELEASE_BACKUP_IMAGE",
		]) expect(releaseCompose).toContain(`\${${variable}:?`);
		expect(releaseCompose).toContain("build: !reset null");
		expect(source).toContain("contract migration");
		expect(source).toContain("never run a down migration");
		expect(source).not.toMatch(/compose_(?:current|release)\s+(?:down|rm)\b/);
		expect(source).not.toMatch(/docker\s+compose[\s\S]{0,120}\bdown\b/);
		expect(source).not.toMatch(/docker\s+volume\s+(?:rm|prune)\b/);
		expect(source).not.toMatch(/Foundry|HUB_FOUNDRY_PORT|30000/i);
		expect(source).not.toMatch(/^\s*chown\b/m);
		const finalization = source.slice(source.indexOf("phase_finalize ()"), source.indexOf("run_phase ()"));
		expect(finalization).not.toContain("remove_candidate_image_preservation_tags");
		expect(Object.values(policy.migrations).every(entry => ["expand", "contract"].includes(entry.phase))).toBe(true);
	});
});
