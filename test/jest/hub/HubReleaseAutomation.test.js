import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {getIsolatedGitEnv} from "./git-test-utils.js";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const releaseScript = path.join(repoRoot, "deploy/hub/release.sh");
const helper = path.join(repoRoot, "deploy/hub/release-helper.py");

const D_E_MIGRATION_POLICY_SHA256 = "73c675edb2af163aa418f6a13ecf15ec5109e4b46887070dc7ebad65b8dce41e";
const D_E_MIGRATION_HASHES = Object.freeze({
	"0001_hub_core.sql": "52a76455ec4a6ecc9706a5c18f9b2ea53f8c3621f89ac0b7b95186e097c833f2",
	"0002_lifecycle_administration.sql": "6e9c57cbe25767d0e1eee3f3e8844dd08f834fca642f4e6e21627aaec8435f47",
	"0003_operational_runs.sql": "bd3bc4c1643f77f37955d71cb18217afcd67d54705c07c87d657fbd25a7f5e05",
	"0004_character_projection_policy.sql": "fb9c15d74c25c32a9f581f746b2bd9f252a08b2b7fb6ecf42b35e7dcd7855b4d",
	"0005_semantic_character_operations.sql": "6462fc7510a1a4b331fdbeaf9ce3b5ae050390e3b3b5e7cc62e1a141e65c18a4",
	"0006_multi_provider_identity.sql": "7a5a5018280bb1c264423f13f2fcaeb2bcf6c514ae76be43a867644819fb0fb5",
	"0007_peer_source_costs.sql": "d9136beb09bc774a6b9b0ce33edaedb130b0ea5d7101341cc9041f5382a1d266",
	"0008_invite_gated_first_access.sql": "83eaab54c6f34c84ad4672681c1ac017ec0e0dfc3a9cae1bb5d59a3c45ee3771",
	"0009_account_entitlements.sql": "789487751e44a73efcc84d32eb0df95013add0b593ab15756e5952caee8c5128",
});

function getReleaseTreeDescriptor (root = repoRoot) {
	const protocolSource = fs.readFileSync(path.join(root, "js/hub/hub-capabilities.js"), "utf8");
	const migrationVersionSource = fs.readFileSync(path.join(root, "server/src/migration-version.js"), "utf8");
	const migrationPolicyBytes = fs.readFileSync(path.join(root, "deploy/hub/migration-policy.json"));
	const migrationDirectory = path.join(root, "server/migrations");
	const migrationFiles = fs.readdirSync(migrationDirectory)
		.filter(file => /^\d{4}_.+\.sql$/.test(file))
		.sort();
	const migrationHashes = Object.fromEntries(migrationFiles.map(file => [
		file,
		crypto.createHash("sha256").update(fs.readFileSync(path.join(migrationDirectory, file))).digest("hex"),
	]));
	const migrationPolicy = JSON.parse(migrationPolicyBytes.toString("utf8"));
	return {
		protocolVersion: protocolSource.match(/^\s*export const HUB_PROTOCOL_VERSION = "([^"]+)";$/m)?.[1],
		requiredMigrationVersion: migrationVersionSource.match(/^\s*export const HUB_REQUIRED_MIGRATION_VERSION = "([^"]+)";$/m)?.[1],
		migrationPolicySha256: crypto.createHash("sha256").update(migrationPolicyBytes).digest("hex"),
		migrationVersions: migrationFiles.map(file => file.slice(0, 4)),
		migrationHashes,
		migrationPolicy,
		migration0011Sql: migrationFiles.includes("0011_multi_target_semantic_operations.sql")
			? fs.readFileSync(path.join(migrationDirectory, "0011_multi_target_semantic_operations.sql"), "utf8")
			: "",
		migration0014Sql: migrationFiles.includes("0014_semantic_event_reference_indexes.sql")
			? fs.readFileSync(path.join(migrationDirectory, "0014_semantic_event_reference_indexes.sql"), "utf8")
			: "",
		releaseSource: fs.readFileSync(path.join(root, "deploy/hub/release.sh"), "utf8"),
	};
}

function classifyReleaseTreeProfile (descriptor) {
	const dMigrationVersions = Object.keys(D_E_MIGRATION_HASHES).map(file => file.slice(0, 4));
	if (
		descriptor.protocolVersion === "5"
		&& descriptor.requiredMigrationVersion === "0009"
		&& descriptor.migrationPolicySha256 === D_E_MIGRATION_POLICY_SHA256
		&& JSON.stringify(descriptor.migrationVersions) === JSON.stringify(dMigrationVersions)
		&& JSON.stringify(descriptor.migrationHashes) === JSON.stringify(D_E_MIGRATION_HASHES)
	) return "D/E";

	const mMigrationVersions = Array.from({length: 14}, (_unused, index) => `${index + 1}`.padStart(4, "0"));
	const mPolicyVersions = Object.keys(descriptor.migrationPolicy?.migrations || {}).sort();
	const migration0011Policy = descriptor.migrationPolicy?.migrations?.["0011"];
	const migration0014Policy = descriptor.migrationPolicy?.migrations?.["0014"];
	if (
		descriptor.protocolVersion === "6"
		&& descriptor.requiredMigrationVersion === "0014"
		&& JSON.stringify(descriptor.migrationVersions) === JSON.stringify(mMigrationVersions)
		&& JSON.stringify(mPolicyVersions) === JSON.stringify(mMigrationVersions)
		&& migration0011Policy?.phase === "expand"
		&& migration0011Policy.previousAppCompatible === true
		&& /schema-before-use only/i.test(migration0011Policy.notes || "")
		&& /semantic_multi_target_usage/.test(migration0011Policy.notes || "")
		&& /CREATE TABLE hub\.semantic_multi_target_usage\s*\(/.test(descriptor.migration0011Sql || "")
		&& /Irreversible schema-use high-water marker\. Normal retention never updates or deletes this singleton\./.test(descriptor.migration0011Sql || "")
		&& migration0014Policy?.phase === "expand"
		&& migration0014Policy.previousAppCompatible === true
		&& /partial campaign\/event lookup indexes/i.test(migration0014Policy.notes || "")
		&& /CREATE INDEX semantic_operations_created_event_idx/.test(descriptor.migration0014Sql || "")
		&& /rollback-marker-check/.test(descriptor.releaseSource)
		&& /USAGE_MARKER_PRESENT/.test(descriptor.releaseSource)
	) return "M";

	return null;
}

function getActualReleaseTreeProfile (root = repoRoot) {
	const descriptor = getReleaseTreeDescriptor(root);
	const profile = classifyReleaseTreeProfile(descriptor);
	if (!profile) throw new Error("Unsupported or mismatched release tree; refusing an unverified test profile.");
	return {id: profile, descriptor};
}

function makeTempDir () {
	return fs.mkdtempSync(path.join(os.tmpdir(), "hub-release-test-"));
}

function runGit (args, options = {}) {
	const {env = process.env, ...spawnOptions} = options;
	return spawnSync("git", args, {...spawnOptions, env: getIsolatedGitEnv(env)});
}

function runGitShell (script, baseEnv = process.env) {
	return spawnSync("bash", ["-c", script], {encoding: "utf8", env: getIsolatedGitEnv(baseEnv)});
}

function runReleaseHelper (args, options = {}) {
	const {env = process.env, ...spawnOptions} = options;
	return spawnSync(helper, args, {encoding: "utf8", ...spawnOptions, env: getIsolatedGitEnv(env)});
}

function spawnReleaseHelper (args, options = {}) {
	const {env = process.env, ...spawnOptions} = options;
	return spawn("python3", [helper, ...args], {...spawnOptions, env: getIsolatedGitEnv(env)});
}

function getShellExpansion (expression) {
	return "$" + `{${expression}}`;
}

function runImagePreservationScenario ({body, failTagTarget = "", failRemoveTarget = ""}) {
	const dir = makeTempDir();
	const state = path.join(dir, "state.tsv");
	const imageState = path.join(dir, "images.tsv");
	const deploymentRoot = path.join(dir, "deployment");
	const monitorScript = path.join(deploymentRoot, "deploy/hub/monitor-host.sh");
	const oldMigrate = `sha256:${"1".repeat(64)}`;
	const oldBff = `sha256:${"2".repeat(64)}`;
	const candidateMigrate = `sha256:${"3".repeat(64)}`;
	const candidateBff = `sha256:${"4".repeat(64)}`;
	fs.writeFileSync(imageState, `hub-migrate\t${oldMigrate}\nhub-bff\t${oldBff}\n`);
	fs.mkdirSync(path.dirname(monitorScript), {recursive: true});
	fs.writeFileSync(monitorScript, "#!/usr/bin/env bash\nprintf 'monitor:passed\\n'\n");
	fs.chmodSync(monitorScript, 0o700);
	const result = spawnSync("bash", ["-c", [
		`source ${JSON.stringify(releaseScript)}`,
		`STATE_FILE=${JSON.stringify(state)}`,
		`TEST_IMAGE_STATE=${JSON.stringify(imageState)}`,
		`TEST_DEPLOYMENT_ROOT=${JSON.stringify(deploymentRoot)}`,
		`RELEASE_ID=${JSON.stringify("20260907T230000Z-hub-test-123")}`,
		": >\"$STATE_FILE\"",
		"CANDIDATE_IMAGE_REFS=(hub-migrate hub-bff)",
		`PREBUILD_IMAGE_IDS=(${oldMigrate} ${oldBff})`,
		`TEST_FAIL_TAG_TARGET=${JSON.stringify(failTagTarget)}`,
		`TEST_FAIL_REMOVE_TARGET=${JSON.stringify(failRemoveTarget)}`,
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
		"      [[ \"$ref\" != \"$TEST_FAIL_REMOVE_TARGET\" ]] || return 92",
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
	].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
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
	multiTargetUsageMarkerPresent = false,
	schemaHasMigration0011,
	previousMigrationVersion = "0010",
	recoveryRequired = false,
	recoveryQualified = false,
	recoveryCompatible = false,
	recoveryPreflightFailure = false,
	recoveryFailureAfterStart = false,
	quiesceFail = false,
	quiesceMode,
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
		HUB_RELEASE_TEST_MULTI_TARGET_USAGE_MARKER_PRESENT: `${multiTargetUsageMarkerPresent}`,
		HUB_RELEASE_TEST_PREVIOUS_MIGRATION_VERSION: previousMigrationVersion,
		HUB_RELEASE_TEST_RECOVERY_REQUIRED: `${recoveryRequired}`,
		HUB_RELEASE_TEST_RECOVERY_QUALIFIED: `${recoveryQualified}`,
		HUB_RELEASE_TEST_RECOVERY_COMPATIBLE: `${recoveryCompatible}`,
		HUB_RELEASE_TEST_RECOVERY_PREFLIGHT_FAILURE: `${recoveryPreflightFailure}`,
		HUB_RELEASE_TEST_RECOVERY_FAILURE_AFTER_START: `${recoveryFailureAfterStart}`,
		HUB_RELEASE_TEST_QUIESCE_FAIL: `${quiesceFail}`,
		...(quiesceMode == null ? {} : {HUB_RELEASE_TEST_QUIESCE_MODE: quiesceMode}),
		...(schemaHasMigration0011 == null
			? {}
			: {HUB_RELEASE_TEST_SCHEMA_HAS_MIGRATION_0011: `${schemaHasMigration0011}`}),
		...(deployRollbackCompatible == null
			? {}
			: {HUB_RELEASE_TEST_DEPLOY_ROLLBACK_COMPATIBLE: `${deployRollbackCompatible}`}),
		...(failPhase ? {HUB_RELEASE_TEST_FAIL_PHASE: failPhase} : {}),
		...(failStep ? {HUB_RELEASE_TEST_FAIL_STEP: failStep} : {}),
		...(holdSeconds ? {HUB_RELEASE_TEST_HOLD_LOCK_SECONDS: `${holdSeconds}`} : {}),
	};
	const result = spawnSync("bash", [releaseScript, "--yes", "hub-test-2026-09-01"], {
		env: getIsolatedGitEnv(env),
		encoding: "utf8",
	});
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

async function waitForFile (filePath, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) return;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error(`timed out waiting for ${path.basename(filePath)}`);
}

function expectFallbackTrace (result, expected) {
	assert.ok(
		result.trace.includes(expected),
		[
			`Expected fallback trace stage: ${expected}`,
			`child shell: ${result.childShellVersion.slice(0, 120)}`,
			`child exit status: ${result.status ?? "unknown"}`,
			`safe trace:\n${getSafeFallbackDiagnostics(result)}`,
		].join("\n"),
	);
}

function getSafeFallbackDiagnostics (result) {
	const traceLines = result.trace.split(/\r?\n/)
		.filter(line => /^(?:failure:|rollback-|recovery-|fallback-|image-tag:|isolate$)/.test(line))
		.map(line => line.slice(0, 180));
	const logLines = `${result.stdout}\n${result.stderr}`
		.split(/\r?\n/)
		.filter(line => /^\[hub-release\] (?:ERROR|CRITICAL): /.test(line))
		.map(line => line.slice(0, 180));
	return [...traceLines, ...logLines].slice(-24).join("\n") || "(no safe stage diagnostics captured)";
}

function createFallbackControlRepo (repo) {
	fs.mkdirSync(repo, {recursive: true});
	const emptyHooksPath = path.join(repo, "empty-hooks");
	fs.mkdirSync(emptyHooksPath);
	const run = args => {
		const result = runGit(args, {cwd: repo, encoding: "utf8"});
		assert.equal(result.status, 0, `temporary Git command failed: git ${args.join(" ")}`);
		return result.stdout.trim();
	};
	run(["init", "--quiet"]);
	run(["config", "user.name", "Recovery Fixture"]);
	run(["config", "user.email", "recovery-fixture@example.invalid"]);
	run(["config", "commit.gpgsign", "false"]);
	run(["config", "core.hooksPath", emptyHooksPath]);
	const controlDir = path.join(repo, "deploy/hub");
	fs.mkdirSync(controlDir, {recursive: true});
	fs.copyFileSync(releaseScript, path.join(controlDir, "release.sh"));
	fs.copyFileSync(helper, path.join(controlDir, "release-helper.py"));
	fs.chmodSync(path.join(controlDir, "release.sh"), 0o755);
	fs.chmodSync(path.join(controlDir, "release-helper.py"), 0o644);
	fs.writeFileSync(path.join(repo, "control-marker"), "preserved control\n");
	run(["add", "--", "."]);
	run(["commit", "--quiet", "-m", "preserved control engine"]);
	const controlSha = run(["rev-parse", "HEAD"]);
	fs.writeFileSync(path.join(repo, "candidate-marker"), "candidate checkout\n");
	run(["add", "--", "candidate-marker"]);
	run(["commit", "--quiet", "-m", "candidate checkout"]);
	const candidateSha = run(["rev-parse", "HEAD"]);
	assert.equal(run(["rev-parse", "HEAD"]), candidateSha);
	assert.notEqual(candidateSha, controlSha);
	return {controlSha, candidateSha};
}

function expectFallbackFixtureIsolation (result) {
	expect(result.controlRepoPath).toBe(path.join(result.dir, "control-repo"));
	expect(result.controlRepoPath).not.toBe(repoRoot);
	expect(result.authorHeadAfter).toBe(result.authorHeadBefore);
}

function runFallbackStartFailure (options = {}) {
	const dir = makeTempDir();
	try {
		return runFallbackStartFailureInDir(dir, options);
	} catch (error) {
		fs.rmSync(dir, {recursive: true, force: true});
		throw error;
	}
}

function runFallbackStartFailureInDir (dir, {quiesceFallback = false, failImageTag = false, failStatePath = false} = {}) {
	const controlRepoPath = path.join(dir, "control-repo");
	const stateDir = path.join(dir, ".local/state/thelemar-hub/recovery");
	const evidenceDir = path.join(dir, "evidence");
	const releaseDir = path.join(evidenceDir, "release");
	fs.mkdirSync(releaseDir, {recursive: true});
	const statePath = path.join(releaseDir, "state.tsv");
	const tracePath = path.join(releaseDir, "phases.log");
	const authorHeadBefore = runGit(["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).stdout.trim();
	const {controlSha, candidateSha} = createFallbackControlRepo(controlRepoPath);
	fs.writeFileSync(statePath, "");
	if (failStatePath) {
		fs.mkdirSync(stateDir, {recursive: true});
		fs.mkdirSync(path.join(stateDir, "active-fallback.tsv"));
	}
	const script = [
		`source ${JSON.stringify(releaseScript)}`,
		`ROOT=${JSON.stringify(controlRepoPath)}`,
		`HOME=${JSON.stringify(dir)}`,
		`HELPER=${JSON.stringify(helper)}`,
		`RELEASE_DIR=${JSON.stringify(releaseDir)}`,
		`STATE_FILE=${JSON.stringify(statePath)}`,
		`TRACE_FILE=${JSON.stringify(tracePath)}`,
		"CURRENT_PHASE=\"verify\"",
		"RELEASE_ID=\"recovery-test\"",
		`CONTROL_SHA=${JSON.stringify(controlSha)}`,
		"EXECUTING_ENGINE_SOURCE_SHA=\"$CONTROL_SHA\"",
		`EXECUTING_ENGINE_TREE_SHA="$(git -C "$ROOT" rev-parse "${getShellExpansion("CONTROL_SHA")}^{tree}")"`,
		`EXECUTING_ENGINE_SCRIPT_SHA256="${crypto.createHash("sha256").update(fs.readFileSync(releaseScript)).digest("hex")}"`,
		`EXECUTING_ENGINE_HELPER_SHA256="${crypto.createHash("sha256").update(fs.readFileSync(helper)).digest("hex")}"`,
		`AUTHOR_REPO_ROOT=${JSON.stringify(repoRoot)}`,
		"git () {",
		"  if [[ \"$1\" == -C && \"$2\" == \"$AUTHOR_REPO_ROOT\" && \"$3\" == checkout ]]; then",
		"    printf 'fixture-safety: refused checkout of author worktree\\n' >&2",
		"    return 97",
		"  fi",
		"  command git \"$@\"",
		"}",
		"SOURCE_CHECKED_OUT=\"true\"",
		"TRAFFIC_MUTATED=\"true\"",
		"RECOVERY_REQUIRED=\"true\"",
		"RECOVERY_B_STARTED=\"false\"",
		"BFF_QUIESCED=\"true\"",
		"ROLLBACK_COMPATIBLE=\"true\"",
		`RECOVERY_B_SOURCE_SHA="${"1".repeat(40)}"`,
		`RECOVERY_B_SOURCE_TREE_SHA="${"a".repeat(40)}"`,
		"RECOVERY_B_TAG_NAME=\"hub-fallback-test\"",
		`RECOVERY_B_TAG_OBJECT_SHA="${"b".repeat(40)}"`,
		"RECOVERY_B_PROTOCOL_VERSION=\"6\"",
		"RECOVERY_B_REQUIRED_MIGRATION_VERSION=\"0014\"",
		"RECOVERY_B_SCHEMA_COMPATIBLE_THROUGH=\"0014\"",
		`RECOVERY_B_BFF_IMAGE_ID="sha256:${"2".repeat(64)}"`,
		`RECOVERY_B_STATIC_IMAGE_ID="sha256:${"3".repeat(64)}"`,
		`RECOVERY_B_OPERATIONS_IMAGE_ID="sha256:${"4".repeat(64)}"`,
		`RECOVERY_B_CONFIGURATION_SHA256="${"c".repeat(64)}"`,
		`RECOVERY_B_MANIFEST_SHA256="${"d".repeat(64)}"`,
		`RECOVERY_B_QUALIFICATION_SHA256="${"e".repeat(64)}"`,
		`RECOVERY_TEST_B_QUIESCES=${quiesceFallback}`,
		`RECOVERY_TEST_FAIL_IMAGE_TAG=${failImageTag}`,
		"CANDIDATE_IMAGE_IDS=(one two three four five)",
		"compose_recovery () {",
		"  [[ \"$1 $2 $3\" == 'config --format json' ]] || return 99",
		"  trace recovery-config-rendered",
		"  printf '%s\\n' '{\"name\":\"thelemartools-hub\",\"services\":{\"bff\":{\"build\":{\"context\":\".\"}},\"static\":{\"build\":{\"context\":\".\"}},\"backup\":{\"image\":\"thelemartools-hub-backup\",\"build\":null},\"maintenance\":{\"image\":\"thelemartools-hub-bff\"}}}'",
		"}",
		"revalidate_recovery_fallback_binding () { return 0; }",
		"export_monitor_environment () { return 0; }",
		"wait_for_public_ready () { trace fallback-readiness-failed; return 1; }",
		"compose_release () {",
		"  if [[ \"$1\" == run ]]; then printf '%s\\n' '{\"target\":\"qualified-full-workflow-fallback\",\"compatible\":true,\"blockers\":[]}'; return 0; fi",
		"  if [[ \"$1\" == up ]]; then trace \"fallback-started:$*\"; return 0; fi",
		"  return 99",
		"}",
		"compose_current () {",
		"  case \"$1\" in",
		"    stop) [[ \"$RECOVERY_TEST_B_QUIESCES\" == true ]] && return 0; return 1 ;;",
		"    ps) printf 'fallback-container\\n'; return 0 ;;",
		"    *) return 99 ;;",
		"  esac",
		"}",
		"docker () {",
		"  case \"$1 $2\" in",
		"    'image tag')",
		"      [[ \"$RECOVERY_TEST_FAIL_IMAGE_TAG\" != true ]] || return 93",
		"      trace \"image-tag:$3:$4\"; return 0 ;;",
		"    'image inspect')",
		"      case \"$5\" in",
		`        thelemartools-hub-bff) printf '%s\\n' "sha256:${"2".repeat(64)}" ;;`,
		`        thelemartools-hub-static) printf '%s\\n' "sha256:${"3".repeat(64)}" ;;`,
		`        thelemartools-hub-backup) printf '%s\\n' "sha256:${"4".repeat(64)}" ;;`,
		"        sha256:*) printf '%s\\n' \"$5\" ;;",
		"        *) return 1 ;;",
		"      esac",
		"      return 0 ;;",
		"    'inspect --format')",
		"      [[ \"$3\" == '{{.State.Running}} {{.State.Restarting}}' && \"$4\" == fallback-container ]] || return 94",
		"      if [[ \"$RECOVERY_TEST_B_QUIESCES\" == true ]]; then printf 'false false\\n'; else printf 'true false\\n'; fi",
		"      return 0 ;;",
		"    'stop --time')",
		"      [[ \"$3\" == 10 && \"$4\" == fallback-container ]] || return 95",
		"      trace \"fallback-docker-stop:$3:$4\"",
		"      [[ \"$RECOVERY_TEST_B_QUIESCES\" == true ]] && return 0; return 1 ;;",
		"    *) return 99 ;;",
		"  esac",
		"}",
		"handle_failure 1",
	].join("\n");
	const result = spawnSync("bash", ["-c", script], {encoding: "utf8", env: getIsolatedGitEnv()});
	const childShellVersion = spawnSync("bash", ["--version"], {encoding: "utf8"}).stdout.split(/\r?\n/, 1)[0];
	const authorHeadAfter = runGit(["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).stdout.trim();
	const fixtureHeadAfter = runGit(["rev-parse", "HEAD"], {cwd: controlRepoPath, encoding: "utf8"}).stdout.trim();
	const evidencePath = path.join(releaseDir, "evidence.json");
	return {
		...result,
		childShellVersion,
		dir,
		controlRepoPath,
		controlSha,
		candidateSha,
		fixtureHeadAfter,
		authorHeadBefore,
		authorHeadAfter,
		trace: fs.existsSync(tracePath) ? fs.readFileSync(tracePath, "utf8") : "",
		evidence: fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) : null,
		recoveryStateDir: stateDir,
	};
}

describe("Campaign Hub deliberate release automation", () => {
	it("returns the worktree to the preserved release engine after application recovery", () => {
		const dir = makeTempDir();
		const releaseEngine = path.join(dir, "release.sh");
		const repo = path.join(dir, "repo");
		fs.mkdirSync(repo);
		fs.copyFileSync(releaseScript, releaseEngine);
		fs.chmodSync(releaseEngine, 0o700);
		try {
			for (const [args, cwd] of [
				[["init"], repo],
				[["config", "user.name", "Recovery Test"], repo],
				[["config", "user.email", "recovery@example.invalid"], repo],
			]) {
				const result = runGit(args, {cwd});
				expect(result.status).toBe(0);
			}
			fs.writeFileSync(path.join(repo, "application"), "fallback\n");
			let result = runGit(["add", "."], {cwd: repo});
			expect(result.status).toBe(0);
			result = runGit(["commit", "-m", "fallback"], {cwd: repo});
			expect(result.status).toBe(0);
			fs.mkdirSync(path.join(repo, "deploy/hub"), {recursive: true});
			fs.copyFileSync(releaseEngine, path.join(repo, "deploy/hub/release.sh"));
			fs.copyFileSync(helper, path.join(repo, "deploy/hub/release-helper.py"));
			fs.writeFileSync(path.join(repo, "engine"), "release engine\n");
			result = runGit(["add", "."], {cwd: repo});
			expect(result.status).toBe(0);
			result = runGit(["commit", "-m", "control engine"], {cwd: repo});
			expect(result.status).toBe(0);
			const controlSha = runGit(["rev-parse", "HEAD"], {cwd: repo}).stdout.toString("utf8").trim();
			const engineScriptSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "deploy/hub/release.sh"))).digest("hex");
			const engineHelperSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "deploy/hub/release-helper.py"))).digest("hex");
			fs.writeFileSync(path.join(repo, "candidate"), "next release\n");
			result = runGit(["add", "."], {cwd: repo});
			expect(result.status).toBe(0);
			result = runGit(["commit", "-m", "candidate"], {cwd: repo});
			expect(result.status).toBe(0);

			const tracePath = path.join(dir, "trace.log");
			const checkout = runGitShell([
				`source ${JSON.stringify(releaseEngine)}`,
				`ROOT=${JSON.stringify(repo)}`,
				`CONTROL_SHA=${JSON.stringify(controlSha)}`,
				`TRACE_FILE=${JSON.stringify(tracePath)}`,
				`HELPER=${JSON.stringify(helper)}`,
				`EXECUTING_ENGINE_SCRIPT_SHA256=${JSON.stringify(engineScriptSha)}`,
				`EXECUTING_ENGINE_HELPER_SHA256=${JSON.stringify(engineHelperSha)}`,
				"SOURCE_CHECKED_OUT=\"true\"",
				"restore_control_engine_checkout",
			].join("\n"));
			expect(checkout.status).toBe(0);
			expect(runGit(["rev-parse", "HEAD"], {cwd: repo}).stdout.toString("utf8").trim()).toBe(controlSha);
			expect(fs.readFileSync(tracePath, "utf8")).toContain("rollback-control-engine-restore");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("isolates disposable Git fixtures from hostile inherited config", () => {
		const hostileEnv = {
			PATH: process.env.PATH,
			HOME: "/synthetic/home",
			HUB_TEST_COMPOSE_CONFIG: "{\"services\":{\"bff\":{\"image\":\"fixture\"}}}",
			GIT_ALLOW_PROTOCOL: "https:ssh",
			GIT_ALTERNATE_OBJECT_DIRECTORIES: "/synthetic/alternate-objects",
			GIT_COMMON_DIR: "/synthetic/common",
			GIT_CONFIG: "/synthetic/git-config",
			GIT_CONFIG_PARAMETERS: "'protocol.file.allow'='never'",
			GIT_CONFIG_COUNT: "3",
			GIT_CONFIG_GLOBAL: "/synthetic/global-config",
			GIT_CONFIG_NOSYSTEM: "0",
			GIT_CONFIG_SYSTEM: "/synthetic/system-config",
			GIT_CONFIG_KEY_0: "core.hooksPath",
			GIT_CONFIG_VALUE_0: "/synthetic/hooks",
			GIT_CONFIG_KEY_1: "protocol.file.allow",
			GIT_CONFIG_VALUE_1: "never",
			GIT_CONFIG_KEY_9: "core.hooksPath",
			GIT_CONFIG_VALUE_9: "/synthetic/hooks",
			GIT_DIR: "/synthetic/git-dir",
			GIT_INDEX_FILE: "/synthetic/index",
			GIT_OBJECT_DIRECTORY: "/synthetic/objects",
			GIT_PREFIX: "synthetic-prefix",
			GIT_PROTOCOL_FROM_USER: "0",
			GIT_WORK_TREE: "/synthetic/work-tree",
		};
		const originalEnv = {...hostileEnv};
		const isolated = getIsolatedGitEnv(hostileEnv);

		expect(hostileEnv).toEqual(originalEnv);
		expect(isolated).toMatchObject({
			PATH: hostileEnv.PATH,
			HOME: hostileEnv.HOME,
			HUB_TEST_COMPOSE_CONFIG: hostileEnv.HUB_TEST_COMPOSE_CONFIG,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "protocol.file.allow",
			GIT_CONFIG_VALUE_0: "always",
		});
		for (const key of [
			"GIT_ALLOW_PROTOCOL",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_COMMON_DIR",
			"GIT_CONFIG",
			"GIT_CONFIG_PARAMETERS",
			"GIT_CONFIG_KEY_1",
			"GIT_CONFIG_VALUE_1",
			"GIT_CONFIG_KEY_9",
			"GIT_CONFIG_VALUE_9",
			"GIT_DIR",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_PREFIX",
			"GIT_PROTOCOL_FROM_USER",
			"GIT_WORK_TREE",
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
				env: getIsolatedGitEnv({
					...process.env,
					HUB_RELEASE_SIMULATE: "1",
					HUB_RELEASE_LOCK_FILE: path.join(dir, "lock"),
					HUB_RELEASE_EVIDENCE_DIR: evidenceDir,
				}),
				encoding: "utf8",
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/available only with HUB_RELEASE_TEST_MODE=1/);
			expect(fs.existsSync(evidenceDir)).toBe(false);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects an ambient peer source-cost allowlist before Compose can override .env.hub", () => {
		const result = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS=11111111-1111-4111-8111-111111111111",
			"assert_no_peer_source_cost_ambient_override",
		].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/configured only in \.env\.hub/);
	});

	it("rejects an ambient multi-target allowlist before Compose can override .env.hub", () => {
		const result = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			"HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS=11111111-1111-4111-8111-111111111111",
			"assert_no_multi_target_ambient_override",
		].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/configured only in \.env\.hub/);
	});

	it.each([
		"HUB_ACCOUNT_ENTITLEMENTS_ENABLED",
		"HUB_ACCOUNT_IDENTITY_LINKING_ENABLED",
		"HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS",
		"HUB_INVITE_ACCOUNT_ADMISSION_ENABLED",
		"HUB_OPERATOR_ACCOUNT_IDS",
	])("rejects ambient %s before Compose can override .env.hub", name => {
		const result = spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			`export ${name}=unexpected`,
			"assert_no_account_entitlement_ambient_override",
		].join("\n")], {encoding: "utf8", env: getIsolatedGitEnv()});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/configured only in \.env\.hub/);
	});

	it("fails release preflight when invite admission bypasses entitlement rollout", () => {
		const dir = makeTempDir();
		try {
			const envFile = path.join(dir, ".env.hub");
			const runCheck = contents => {
				fs.writeFileSync(envFile, contents);
				return runGitShell([
					`source ${JSON.stringify(releaseScript)}`,
					`ENV_FILE=${JSON.stringify(envFile)}`,
					"assert_account_entitlement_config",
				].join("\n"));
			};
			const bypass = runCheck([
				"HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=true",
				"HUB_ACCOUNT_ENTITLEMENTS_ENABLED=false",
				"HUB_OPERATOR_ACCOUNT_IDS=",
			].join("\n"));
			expect(bypass.status).not.toBe(0);
			expect(bypass.stderr).toMatch(/requires HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true/);

			const operatorMissing = runCheck([
				"HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false",
				"HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true",
				"HUB_OPERATOR_ACCOUNT_IDS=",
			].join("\n"));
			expect(operatorMissing.status).not.toBe(0);
			expect(operatorMissing.stderr).toMatch(/requires HUB_OPERATOR_ACCOUNT_IDS/);

			const retentionMissing = runCheck([
				"HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false",
				"HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true",
				"HUB_ACCOUNT_IDENTITY_LINKING_ENABLED=true",
				"HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS=",
				"HUB_OPERATOR_ACCOUNT_IDS=11111111-1111-4111-8111-111111111111",
			].join("\n"));
			expect(retentionMissing.status).not.toBe(0);
			expect(retentionMissing.stderr).toMatch(/requires HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS/);

			expect(runCheck([
				"HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false",
				"HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true",
				"HUB_ACCOUNT_IDENTITY_LINKING_ENABLED=false",
				"HUB_OPERATOR_ACCOUNT_IDS=11111111-1111-4111-8111-111111111111",
			].join("\n")).status).toBe(0);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("marks a successful test simulation explicitly without production-shaped success evidence", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({dir});
			const expectedEngineIdentity = {
				release_engine_source_sha: runGit(["-C", repoRoot, "rev-parse", "HEAD"]).stdout.toString("utf8").trim(),
				release_engine_source_tree_sha: runGit(["-C", repoRoot, "rev-parse", "HEAD^{tree}"]).stdout.toString("utf8").trim(),
				release_engine_script_sha256: crypto.createHash("sha256").update(fs.readFileSync(releaseScript)).digest("hex"),
				release_engine_helper_sha256: crypto.createHash("sha256").update(fs.readFileSync(helper)).digest("hex"),
				release_engine_helper_snapshot: "before-candidate-checkout",
			};
			expect(result.status).toBe(0);
			expect(result.evidence).toMatchObject({
				status: "simulated",
				simulation: "true",
				traffic_mutated: "simulated",
				schema_mutated: "simulated",
				...expectedEngineIdentity,
			});
			expect(fs.readFileSync(path.join(result.releaseDir, "release-helper.py"), "utf8"))
				.toBe(fs.readFileSync(helper, "utf8"));
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
			const first = spawn("bash", [releaseScript, "--yes", "hub-test-lock"], {
				env: getIsolatedGitEnv(env),
				stdio: "ignore",
			});
			await new Promise(resolve => setTimeout(resolve, 300));
			const second = runSimulation({dir, lockFile});
			expect(second.status).toBe(75);
			expect(second.stderr).toMatch(/another Campaign Hub release holds/);
			await new Promise(resolve => first.once("exit", resolve));
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	}, 15_000);

	it("does not persist rendered Compose secrets on successful or rejected recovery resolution", () => {
		const dir = makeTempDir();
		const releaseDir = path.join(dir, "release-evidence");
		fs.mkdirSync(releaseDir);
		const canary = "compose-secret-canary-do-not-persist";
		const candidateSha = runGit(["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).stdout.trim();
		const validConfig = {
			services: {
				bff: {
					environment: {
						HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS: "",
						HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS: "",
						HUB_AUTH_PROVIDERS: "github",
						HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS: "",
						HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS: "github",
						HUB_COOKIE_SECRET: canary,
					},
				},
			},
		};
		const revalidate = config => spawnSync("bash", ["-c", [
			`source ${JSON.stringify(releaseScript)}`,
			`HELPER=${JSON.stringify(helper)}`,
			`ROOT=${JSON.stringify(repoRoot)}`,
			`TARGET_SHA=${JSON.stringify(candidateSha)}`,
			`RELEASE_DIR=${JSON.stringify(releaseDir)}`,
			`HOME=${JSON.stringify(dir)}`,
			"compose_current () { printf '%s\\n' \"$HUB_TEST_COMPOSE_CONFIG\"; }",
			"revalidate_recovery_fallback_binding",
		].join("\n")], {
			encoding: "utf8",
			env: getIsolatedGitEnv({...process.env, HUB_TEST_COMPOSE_CONFIG: JSON.stringify(config)}),
		});
		try {
			const acceptedConfig = structuredClone(validConfig);
			acceptedConfig.services.bff.environment.HUB_COOKIE_SECRET = canary;
			const accepted = revalidate(acceptedConfig);
			expect(accepted.status).not.toBe(0);
			expect(accepted.stderr).toMatch(/qualified-fallback\.json/i);
			expect(`${accepted.stdout}${accepted.stderr}`).not.toContain(canary);

			const invalidConfig = structuredClone(validConfig);
			invalidConfig.services.bff.environment.HUB_AUTH_PROVIDERS = canary;
			const rejected = revalidate(invalidConfig);
			expect(rejected.status).not.toBe(0);
			expect(`${rejected.stdout}${rejected.stderr}`).not.toContain(canary);
			for (const file of fs.readdirSync(releaseDir)) {
				expect(fs.readFileSync(path.join(releaseDir, file), "utf8")).not.toContain(canary);
			}
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("repairs only explicit backup UID/GID keys for the Oracle ubuntu 1001 mapping", () => {
		const dir = makeTempDir();
		try {
			const envFile = path.join(dir, ".env.hub");
			fs.writeFileSync(envFile, "HUB_COOKIE_SECRET=test-secret\nHUB_BACKUP_UID=1000\n");
			fs.chmodSync(envFile, 0o600);
			const result = runReleaseHelper([
				"set-backup-ids",
				"--file", envFile,
				"--uid", "1001",
				"--gid", "1001",
			]);
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
		const allowed = runGitShell([
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  [[ \"$*\" == \"--profile * config --services\" ]] && printf '%s\\n' db migrate grant-roles bff static edge maintenance backup",
			"}",
			"assert_compose_safe",
		].join("\n"));
		expect(allowed.status).toBe(0);

		const unrelated = runGitShell([
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  [[ \"$*\" == \"--profile * config --services\" ]] && printf '%s\\n' db bff unrelated-service",
			"}",
			"assert_compose_safe",
		].join("\n"));
		expect(unrelated.status).not.toBe(0);
		expect(unrelated.stderr).toMatch(/non-Hub service: unrelated-service/);

		const enumerationFailure = runGitShell([
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () {",
			"  [[ \"$*\" == \"--profile * config --quiet\" ]] && return 0",
			"  return 42",
			"}",
			"assert_compose_safe",
		].join("\n"));
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
			const expand = runReleaseHelper([
				"migration",
				"--plan", plan,
				"--policy", policy,
				"--output", output,
			]);
			expect(expand.status).toBe(0);
			expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
				pendingVersions: ["0004"],
				rollbackCompatible: true,
			});

			fs.writeFileSync(policy, JSON.stringify({
				migrations: {"0004": {phase: "contract", previousAppCompatible: false}},
			}));
			const contract = runReleaseHelper([
				"migration",
				"--plan", plan,
				"--policy", policy,
				"--output", output,
			]);
			expect(contract.status).not.toBe(0);
			expect(contract.stderr).toMatch(/contract-phase.*manual break-glass/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("recognizes only exact D/E and current M trees without environment-selected profiles", () => {
		const dProfile = {
			protocolVersion: "5",
			requiredMigrationVersion: "0009",
			migrationPolicySha256: D_E_MIGRATION_POLICY_SHA256,
			migrationVersions: Object.keys(D_E_MIGRATION_HASHES).map(file => file.slice(0, 4)),
			migrationHashes: D_E_MIGRATION_HASHES,
		};
		expect(classifyReleaseTreeProfile(dProfile)).toBe("D/E");
		expect(classifyReleaseTreeProfile({...dProfile, migrationPolicySha256: "0".repeat(64)})).toBeNull();
		expect(classifyReleaseTreeProfile({
			...dProfile,
			migrationHashes: {...D_E_MIGRATION_HASHES, "0009_account_entitlements.sql": "0".repeat(64)},
		})).toBeNull();
		expect(classifyReleaseTreeProfile({...dProfile, migrationVersions: [...dProfile.migrationVersions, "0010"]})).toBeNull();

		const mVersions = Array.from({length: 14}, (_unused, index) => `${index + 1}`.padStart(4, "0"));
		const mPolicy = Object.fromEntries(mVersions.map(version => [version, {phase: "expand", previousAppCompatible: true, notes: ""}]));
		mPolicy["0011"] = {
			phase: "expand",
			previousAppCompatible: true,
			notes: "Schema-before-use only; the irreversible semantic_multi_target_usage marker forbids pre-0011 rollback after first use.",
		};
		mPolicy["0014"] = {
			phase: "expand",
			previousAppCompatible: true,
			notes: "Adds partial campaign/event lookup indexes.",
		};
		const mProfile = {
			protocolVersion: "6",
			requiredMigrationVersion: "0014",
			migrationVersions: mVersions,
			migrationPolicy: {migrations: mPolicy},
			migration0011Sql: [
				"CREATE TABLE hub.semantic_multi_target_usage (",
				"COMMENT ON TABLE hub.semantic_multi_target_usage IS",
				"'Irreversible schema-use high-water marker. Normal retention never updates or deletes this singleton.';",
			].join("\n"),
			migration0014Sql: "CREATE INDEX semantic_operations_created_event_idx",
			releaseSource: "rollback-marker-check USAGE_MARKER_PRESENT",
		};
		expect(classifyReleaseTreeProfile(mProfile)).toBe("M");
		expect(classifyReleaseTreeProfile({...mProfile, protocolVersion: "5"})).toBeNull();
		expect(classifyReleaseTreeProfile({...mProfile, requiredMigrationVersion: "0009"})).toBeNull();
		expect(classifyReleaseTreeProfile({...mProfile, migration0011Sql: ""})).toBeNull();
		expect(classifyReleaseTreeProfile({...mProfile, releaseSource: ""})).toBeNull();
		const mPolicyWithout0014 = {...mPolicy};
		delete mPolicyWithout0014["0014"];
		expect(classifyReleaseTreeProfile({...mProfile, migrationPolicy: {migrations: mPolicyWithout0014}})).toBeNull();

		const actual = getActualReleaseTreeProfile();
		expect(["D/E", "M"]).toContain(actual.id);
		const overrideName = "HUB_RELEASE_TEST_TREE_PROFILE";
		const hadOverride = Object.prototype.hasOwnProperty.call(process.env, overrideName);
		const previousOverride = process.env[overrideName];
		process.env[overrideName] = actual.id === "M" ? "D/E" : "M";
		try {
			expect(getActualReleaseTreeProfile().id).toBe(actual.id);
		} finally {
			if (hadOverride) process.env[overrideName] = previousOverride;
			else delete process.env[overrideName];
		}
	});

	it("validates the active tree migration profile without importing later policy", () => {
		const {id, descriptor} = getActualReleaseTreeProfile();
		const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "deploy/hub/migration-policy.json"), "utf8"));
		const rollbackRunbook = fs.readFileSync(path.join(repoRoot, "docs/hub/runbooks/rollback.md"), "utf8");
		expect(rollbackRunbook).toMatch(/later M\/qualified-image context/i);
		expect(rollbackRunbook).toMatch(/not available in E's inherited D\s+package/i);
		if (id === "D/E") {
			expect(descriptor.migrationPolicySha256).toBe(D_E_MIGRATION_POLICY_SHA256);
			expect(descriptor.migrationHashes).toEqual(D_E_MIGRATION_HASHES);
			expect(descriptor.migrationVersions).toEqual(Object.keys(D_E_MIGRATION_HASHES).map(file => file.slice(0, 4)));
			expect(policy.migrations).not.toHaveProperty("0010");
			expect(policy.migrations).not.toHaveProperty("0011");
			expect(policy.migrations).not.toHaveProperty("0014");
		} else {
			expect(policy.migrations["0011"]).toMatchObject({
				phase: "expand",
				previousAppCompatible: true,
			});
			expect(policy.migrations["0011"].notes).toMatch(/schema-before-use only/i);
			expect(policy.migrations["0011"].notes).toMatch(/semantic_multi_target_usage/);
			expect(rollbackRunbook).toContain("hub:check-multi-target-rollback");
			expect(rollbackRunbook).toContain("HUB_MULTI_TARGET_ROLLBACK_TARGET=pre-0011");
			expect(rollbackRunbook).toContain("HUB_MULTI_TARGET_ROLLBACK_TARGET=bridge");
		}
	});

	it.each([
		["compatible result", 0, {target: "pre-0011", compatible: true, blockers: []}, "compatible"],
		["usage marker", 2, {target: "pre-0011", compatible: false, blockers: ["USAGE_MARKER_PRESENT"]}, "multi-target-usage-marker-present"],
		["retained history", 2, {target: "pre-0011", compatible: false, blockers: ["MULTI_TARGET_HISTORY_PRESENT"]}, "multi-target-history-present"],
		["infrastructure failure", 1, null, "multi-target-rollback-preflight-failed"],
		["malformed result", 2, {compatible: false}, "multi-target-rollback-preflight-failed"],
		["contradictory compatible blockers", 0, {target: "pre-0011", compatible: true, blockers: ["USAGE_MARKER_PRESENT"]}, "multi-target-rollback-preflight-failed"],
		["incompatible result without blockers", 2, {target: "pre-0011", compatible: false, blockers: []}, "multi-target-rollback-preflight-failed"],
		["incompatible result with unknown blocker", 2, {target: "pre-0011", compatible: false, blockers: ["UNKNOWN"]}, "multi-target-rollback-preflight-failed"],
	])("classifies multi-target rollback preflight %s truthfully", (_label, status, body, expected) => {
		const dir = makeTempDir();
		try {
			const resultFile = path.join(dir, "preflight.json");
			fs.writeFileSync(resultFile, body == null ? "" : JSON.stringify(body));
			const result = runGitShell([
				`source ${JSON.stringify(releaseScript)}`,
				`classify_multi_target_rollback_preflight ${JSON.stringify(resultFile)} ${status}`,
			].join("\n"));
			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe(expected);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("does not treat a restarting Compose BFF as quiesced", () => {
		const restarting = runGitShell([
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () { printf '%s\\n' bff-container; }",
			"docker () { printf '%s\\n' 'false true'; }",
			"is_bff_quiesced",
		].join("\n"));
		expect(restarting.status).not.toBe(0);

		const stopped = runGitShell([
			`source ${JSON.stringify(releaseScript)}`,
			"compose_current () { printf '%s\\n' bff-container; }",
			"docker () { printf '%s\\n' 'false false'; }",
			"is_bff_quiesced",
		].join("\n"));
		expect(stopped.status).toBe(0);
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

	it("blocks automatic pre-0011 rollback after the irreversible usage marker is present", () => {
		const dir = makeTempDir();
		try {
			const source = fs.readFileSync(releaseScript, "utf8");
			expect(source).toContain("HUB_MULTI_TARGET_ROLLBACK_TARGET=pre-0011");
			expect(source).toContain("node server/scripts/check-multi-target-rollback.mjs");
			expect(source).toContain("is_bff_quiesced");
			expect(source).toContain("docker stop --time 10");
			expect(source).toContain("{{.State.Running}} {{.State.Restarting}}");
			const failureHandler = source.slice(
				source.indexOf("handle_failure ()"),
				source.indexOf("export_monitor_environment ()"),
			);
			expect(failureHandler.indexOf("compose_current stop bff"))
				.toBeLessThan(failureHandler.indexOf("node server/scripts/check-multi-target-rollback.mjs"));
			expect(failureHandler.indexOf("node server/scripts/check-multi-target-rollback.mjs"))
				.toBeLessThan(failureHandler.indexOf("rollback_application ||"));
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "0011",
				multiTargetUsageMarkerPresent: true,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("deploy");
			expect(result.trace.indexOf("rollback-quiesce"))
				.toBeLessThan(result.trace.indexOf("rollback-marker-check"));
			expect(result.trace).toContain("rollback-marker-blocked");
			expect(result.trace).toContain("isolate");
			expect(result.trace).not.toContain("\nrollback\n");
			expect(result.evidence).toMatchObject({
				rollback_compatible: "false",
				rollback_incompatibility: "multi-target-usage-marker-present",
				rollback_result: "forbidden-schema-incompatible",
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("quiesces candidate writes before a compatible pre-0011 rollback check and rollback", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "0011",
				multiTargetUsageMarkerPresent: false,
			});
			expect(result.status).not.toBe(0);
			const quiesce = result.trace.indexOf("rollback-quiesce");
			const markerCheck = result.trace.indexOf("rollback-marker-check");
			const rollback = result.trace.indexOf("\nrollback\n");
			expect(quiesce).toBeGreaterThanOrEqual(0);
			expect(markerCheck).toBeGreaterThan(quiesce);
			expect(rollback).toBeGreaterThan(markerCheck);
			expect(result.evidence.rollback_result).toBe("simulated-compatible");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("runs the marker check on a retry where 0011 was applied by an earlier attempt", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "none",
				schemaHasMigration0011: true,
				previousMigrationVersion: "0010",
				multiTargetUsageMarkerPresent: true,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("rollback-quiesce");
			expect(result.trace).toContain("rollback-marker-check");
			expect(result.trace).toContain("rollback-marker-blocked");
			expect(result.trace).toContain("isolate");
			expect(result.trace).not.toContain("\nrollback\n");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it.each([
		["first Compose stop fails and the second succeeds", "first-fail-second-success", false],
		["both Compose stops fail and the exact BFF container fallback succeeds", "both-fail-fallback-success", true],
	])("verifies BFF isolation when %s", (_label, quiesceMode, isExpectFallback) => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "0011",
				schemaHasMigration0011: true,
				previousMigrationVersion: "0010",
				multiTargetUsageMarkerPresent: true,
				quiesceMode,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("rollback-quiesce-attempt-1");
			expect(result.trace).toContain("rollback-quiesce-attempt-2");
			if (isExpectFallback) expect(result.trace).toContain("rollback-quiesce-fallback");
			else expect(result.trace).not.toContain("rollback-quiesce-fallback");
			expect(result.trace).toContain("rollback-marker-check");
			expect(result.trace).toContain("isolate");
			expect(result.evidence).toMatchObject({
				rollback_candidate_quiesced: "true",
				rollback_result: "forbidden-schema-incompatible",
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("reports a critical fence failure instead of claiming isolation when BFF quiescing fails", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "0011",
				schemaHasMigration0011: true,
				previousMigrationVersion: "0010",
				quiesceFail: true,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("rollback-quiesce-failed");
			expect(result.trace).toContain("fence-failed");
			expect(result.trace).not.toContain("isolate");
			expect(result.trace).not.toContain("\nrollback\n");
			expect(result.evidence).toMatchObject({
				rollback_incompatibility: "multi-target-quiesce-failed",
				rollback_result: "quiesce-failed-candidate-may-be-live",
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("allows rollback to a marker-aware previous application without the pre-0011 fence", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				plannedMigrations: "none",
				schemaHasMigration0011: true,
				previousMigrationVersion: "0011",
				multiTargetUsageMarkerPresent: true,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).not.toContain("rollback-marker-check");
			expect(result.trace).toContain("rollback");
			expect(result.evidence.rollback_result).toBe("simulated-compatible");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("requires an independent full-workflow fallback before a protocol-6 release", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				recoveryRequired: true,
				recoveryQualified: false,
				plannedMigrations: "0011,0012,0013,0014",
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).not.toContain("deploy");
			expect(result.trace).not.toContain("rollback-qualified-fallback");
			expect(result.evidence).toMatchObject({traffic_mutated: "false"});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("uses only the qualified full-workflow fallback after quiescing a protocol-6 candidate", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				rollbackCompatible: true,
				deployRollbackCompatible: false,
				recoveryRequired: true,
				recoveryQualified: true,
				recoveryCompatible: true,
				plannedMigrations: "0011,0012,0013,0014",
			});
			expect(result.status).not.toBe(0);
			const quiesce = result.trace.indexOf("rollback-quiesce");
			const compatibility = result.trace.indexOf("rollback-recovery-check");
			const fallback = result.trace.indexOf("rollback-qualified-fallback");
			expect(quiesce).toBeGreaterThanOrEqual(0);
			expect(compatibility).toBeGreaterThan(quiesce);
			expect(fallback).toBeGreaterThan(compatibility);
			expect(result.trace).not.toContain("\nrollback\n");
			expect(result.trace).not.toContain("isolate");
			expect(result.evidence).toMatchObject({
				rollback_result: "qualified-full-workflow-fallback",
				rollback_incompatibility: "qualified-full-workflow-fallback-selected",
				recovery_fallback_result: "simulated-compatible",
			});
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("never claims isolation when a started qualified fallback cannot be quiesced", () => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				recoveryRequired: true,
				recoveryQualified: true,
				recoveryCompatible: true,
				recoveryFailureAfterStart: true,
				quiesceMode: "first-success-rest-fail",
			});
			expect(result.status).not.toBe(0);
			expect(result.trace.indexOf("rollback-qualified-fallback")).toBeGreaterThan(
				result.trace.indexOf("rollback-recovery-check"),
			);
			expect(result.trace).toContain("fallback-quiesce-failed");
			expect(result.trace).not.toContain("isolate");
			expect(result.trace).not.toContain("\nrollback\n");
			expect(result.evidence).toMatchObject({
				rollback_result: "fallback-b-may-still-accept-writes",
				rollback_incompatibility: "fallback-b-quiesce-failed",
				fallback_b_quiesced: "false",
				fallback_b_may_still_accept_writes: "true",
			});
			expect(result.stdout).toContain("CRITICAL: the qualified fallback BFF may still accept writes");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("holds release admission for the entire foreground scheduled-job lifetime", async () => {
		const dir = makeTempDir();
		const admissionLock = path.join(dir, "release.lock");
		const startedPath = path.join(dir, "job-started.json");
		const releasePath = path.join(dir, "allow-job-exit");
		const jobArgs = [
			"recovery-job-run",
			"--state", path.join(dir, "missing-state.tsv"),
			"--env", path.join(dir, "missing-state.env"),
			"--blocked", path.join(dir, "missing-state.blocked"),
			"--admission-lock", admissionLock,
			"--job-lock", path.join(dir, "backup.lock"),
			"--",
			process.execPath,
			"-e",
			"const fs=require('node:fs'); fs.writeFileSync(process.argv[1], JSON.stringify([process.env.HUB_RECOVERY_BFF_IMAGE ?? null, process.env.HUB_RECOVERY_BACKUP_IMAGE ?? null])); const timer=setInterval(()=>{ if (fs.existsSync(process.argv[2])) { clearInterval(timer); process.exit(0); } }, 10);",
			startedPath,
			releasePath,
		];
		const child = spawnReleaseHelper(jobArgs, {
			env: {
				...process.env,
				HUB_RECOVERY_BFF_IMAGE: "stale-bff-tag",
				HUB_RECOVERY_BACKUP_IMAGE: "stale-backup-tag",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
		child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
		const childResult = new Promise(resolve => child.once("close", (code, signal) => resolve({code, signal})));
		try {
			await waitForFile(startedPath);
			expect(JSON.parse(fs.readFileSync(startedPath, "utf8"))).toEqual(["", ""]);

			const blockedJob = runReleaseHelper([...jobArgs.slice(0, jobArgs.indexOf("--job-lock") + 1),
				path.join(dir, "maintenance.lock"), "--", process.execPath, "-e", "process.exit(0)"]);
			expect(blockedJob.status).not.toBe(0);
			expect(blockedJob.stderr).toMatch(/release admission lock is already held/);

			const overlappingJobArgs = [...jobArgs];
			overlappingJobArgs[8] = path.join(dir, "other-release.lock");
			const blockedDuplicate = runReleaseHelper(overlappingJobArgs);
			expect(blockedDuplicate.status).not.toBe(0);
			expect(blockedDuplicate.stderr).toMatch(/scheduled job lock is already held/);

			const release = runSimulation({dir, lockFile: admissionLock});
			expect(release.status).toBe(75);
			expect(release.stderr).toMatch(/another Campaign Hub release holds/);
			expect(release.trace).toBe("");
			expect(release.evidence).toBeNull();
			fs.writeFileSync(releasePath, "finish\n");
			const result = await childResult;
			expect(result).toEqual({code: 0, signal: null});
			expect(stdout).toContain("admitted in normal mode");
			expect(stderr).toBe("");
		} finally {
			if (child.exitCode == null && child.signalCode == null) {
				fs.writeFileSync(releasePath, "finish\n");
				await childResult;
			}
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("records a critical fence failure after the real fallback-start path fails readiness", () => {
		const result = runFallbackStartFailure();
		try {
			expectFallbackFixtureIsolation(result);
			expect(result.fixtureHeadAfter).toBe(result.candidateSha);
			expect(result.status).not.toBe(0);
			expectFallbackTrace(result, "rollback-qualified-fallback");
			expectFallbackTrace(result, "recovery-config-rendered");
			expectFallbackTrace(result, `image-tag:sha256:${"2".repeat(64)}:thelemartools-hub-bff`);
			expectFallbackTrace(result, `image-tag:sha256:${"3".repeat(64)}:thelemartools-hub-static`);
			expectFallbackTrace(result, `image-tag:sha256:${"4".repeat(64)}:thelemartools-hub-backup`);
			expectFallbackTrace(result, "fallback-started:up -d --no-deps --pull never --force-recreate --wait bff static");
			expectFallbackTrace(result, "fallback-readiness-failed");
			expectFallbackTrace(result, "fallback-quiesce-failed");
			expectFallbackTrace(result, "fallback-docker-stop:10:fallback-container");
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.blocked"), "utf8").trim()).toBe("starting");
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.tsv"), "utf8")).toContain("status\tstarting");
			expect(result.trace).not.toContain("\nisolate\n");
			expect(result.evidence).toMatchObject({
				rollback_result: "fallback-b-may-still-accept-writes",
				rollback_incompatibility: "fallback-b-quiesce-failed",
				fallback_b_quiesced: "false",
				fallback_b_may_still_accept_writes: "true",
			});
			expect(result.stdout).toContain("CRITICAL: the qualified fallback BFF may still accept writes");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("restores the control checkout before recording the blocked job state", () => {
		const result = runFallbackStartFailure({quiesceFallback: true});
		try {
			expectFallbackFixtureIsolation(result);
			expect(result.fixtureHeadAfter).toBe(result.controlSha);
			expect(result.candidateSha).not.toBe(result.controlSha);
			expect(result.status).not.toBe(0);
			const checkoutRestore = result.trace.indexOf("rollback-control-engine-restore");
			const blockedState = result.trace.indexOf("recovery-mode-status:blocked");
			expect(checkoutRestore).toBeGreaterThanOrEqual(0);
			expect(blockedState).toBeGreaterThan(checkoutRestore);
			expectFallbackTrace(result, "fallback-readiness-failed");
			expectFallbackTrace(result, "isolate");
			expect(result.evidence).toMatchObject({
				recovery_control_engine_restored: "true",
				recovery_jobs_blocked: "true",
				rollback_result: "forbidden-full-workflow-fallback",
			});
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.tsv"), "utf8")).toContain("status\tblocked");
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.blocked"), "utf8").trim()).toBe("blocked");
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("does not start fallback after a recovery-image retag failure and leaves jobs fenced", () => {
		const result = runFallbackStartFailure({failImageTag: true});
		try {
			expectFallbackFixtureIsolation(result);
			expect(result.fixtureHeadAfter).toBe(result.candidateSha);
			expect(result.status).not.toBe(0);
			expectFallbackTrace(result, "recovery-mode-status:starting");
			expect(result.trace).not.toContain("fallback-started:");
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.blocked"), "utf8").trim()).toBe("starting");
			const jobState = runReleaseHelper([
				"recovery-job-state",
				"--state", path.join(result.recoveryStateDir, "active-fallback.tsv"),
				"--env", path.join(result.recoveryStateDir, "active-fallback.env"),
				"--blocked", path.join(result.recoveryStateDir, "active-fallback.blocked"),
			]);
			expect(jobState.status).not.toBe(0);
			expect(jobState.stderr).toMatch(/transition is fenced/i);
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it("does not start fallback when durable recovery state cannot be written", () => {
		const result = runFallbackStartFailure({failStatePath: true});
		try {
			expectFallbackFixtureIsolation(result);
			expect(result.fixtureHeadAfter).toBe(result.candidateSha);
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("recovery-mode-status:starting");
			expect(result.trace).not.toContain("fallback-started:");
			expect(fs.readFileSync(path.join(result.recoveryStateDir, "active-fallback.blocked"), "utf8").trim()).toBe("starting");
			expect(result.stdout).toMatch(/state or job environment path is not a regular file/i);
		} finally {
			fs.rmSync(result.dir, {recursive: true, force: true});
		}
	});

	it.each([
		["unsupported history", false, false, "history-incompatible"],
		["preflight failure", true, false, "recovery-preflight-failed"],
	])("keeps protocol-6 recovery isolated on %s", (_label, preflightFailure, recoveryCompatible, reason) => {
		const dir = makeTempDir();
		try {
			const result = runSimulation({
				dir,
				failPhase: "verify",
				recoveryRequired: true,
				recoveryQualified: true,
				recoveryCompatible,
				recoveryPreflightFailure: preflightFailure,
			});
			expect(result.status).not.toBe(0);
			expect(result.trace).toContain("rollback-recovery-check");
			expect(result.trace).toContain("isolate");
			expect(result.trace).not.toContain("rollback-qualified-fallback");
			expect(result.trace).not.toContain("\nrollback\n");
			expect(result.evidence).toMatchObject({
				rollback_result: "forbidden-full-workflow-fallback",
				recovery_fallback_result: reason,
			});
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
			const result = runGitShell(script);
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
			expect(successfulApply.indexOf("check-peer-source-cost-rollout.mjs"))
				.toBeLessThan(successfulApply.indexOf("TRAFFIC_MUTATED=\"true\""));
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
			const result = runReleaseHelper(["evidence", "--state", state, "--json", json, "--text", text]);
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
			"restore_candidate_image_tags_and_cleanup",
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

	it("continues post-cutover rollback when only preservation-tag cleanup fails", () => {
		const failedTarget = "hub-migrate:hub-release-preserve-20260907T230000Z-hub-test-123";
		const result = runImagePreservationScenario({
			failRemoveTarget: failedTarget,
			body: [
				"preserve_candidate_image_tags",
				"test_set_image hub-migrate \"$CANDIDATE_MIGRATE\"",
				"test_set_image hub-bff \"$CANDIDATE_BFF\"",
				"ROOT=\"$TEST_DEPLOYMENT_ROOT\"",
				`PREVIOUS_SHA=${"a".repeat(40)}`,
				`CONTROL_SHA=${"a".repeat(40)}`,
				"PREVIOUS_TAG=hub-previous",
				"TRACE_FILE=",
				"git () {",
				"  [[ \"$*\" == \"-C $ROOT checkout --detach $PREVIOUS_SHA\" ]]",
				"}",
				"compose_current () { printf 'compose:%s\\n' \"$*\"; }",
				"export_monitor_environment () { :; }",
				"wait_for_public_ready () { :; }",
				"rollback_application",
				"printf 'migrate=%s\\nbff=%s\\n' \"$(test_get_image hub-migrate)\" \"$(test_get_image hub-bff)\"",
			].join("\n"),
		});
		try {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("compose:up -d --no-deps --force-recreate --wait bff static");
			expect(result.stdout).toContain("compose:up -d --no-deps --force-recreate edge");
			expect(result.stdout).toContain("monitor:passed");
			expect(result.stdout).toContain(`migrate=sha256:${"1".repeat(64)}`);
			expect(result.stdout).toContain(`bff=sha256:${"2".repeat(64)}`);
			expect(result.stdout).toMatch(/preservation-tag cleanup failed/);
			expect(result.state).toContain("rollback_preservation_cleanup\tfailed");
			expect(result.state).toContain("rollback_result\tsucceeded");
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
				`CONTROL_SHA=${"a".repeat(40)}`,
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

	it("restores the first-use control checkout when validation fails before release evidence setup", () => {
		const dir = makeTempDir();
		const repo = path.join(dir, "repo");
		fs.mkdirSync(path.join(repo, "deploy/hub"), {recursive: true});
		try {
			for (const args of [
				["init"],
				["config", "user.name", "First Use Recovery Test"],
				["config", "user.email", "first-use@example.invalid"],
			]) expect(runGit(args, {cwd: repo}).status).toBe(0);
			fs.copyFileSync(releaseScript, path.join(repo, "deploy/hub/release.sh"));
			fs.copyFileSync(helper, path.join(repo, "deploy/hub/release-helper.py"));
			expect(runGit(["add", "."], {cwd: repo}).status).toBe(0);
			expect(runGit(["commit", "-m", "preserved control"], {cwd: repo}).status).toBe(0);
			const controlSha = runGit(["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).stdout.trim();
			expect(runGit(["tag", "-a", "hub-previous", "-m", "preserved control"], {cwd: repo}).status).toBe(0);
			fs.writeFileSync(path.join(repo, "candidate"), "candidate source\n");
			expect(runGit(["add", "."], {cwd: repo}).status).toBe(0);
			expect(runGit(["commit", "-m", "candidate"], {cwd: repo}).status).toBe(0);
			const candidateSha = runGit(["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).stdout.trim();
			const imageId = `sha256:${"1".repeat(64)}`;
			const result = spawnSync("bash", [
				path.join(repo, "deploy/hub/release.sh"),
				"--yes",
				"hub-candidate",
			], {
				encoding: "utf8",
				env: getIsolatedGitEnv({
					...process.env,
					HUB_RELEASE_FIRST_USE: "1",
					HUB_RELEASE_INHERITED_LOCK_FD: "9",
					HUB_RELEASE_PREVIOUS_SHA: controlSha,
					HUB_RELEASE_PREVIOUS_TAG: "hub-previous",
					HUB_RELEASE_PREVIOUS_BFF_IMAGE_ID: imageId,
					HUB_RELEASE_PREVIOUS_STATIC_IMAGE_ID: imageId,
					HUB_RELEASE_PREVIOUS_BACKUP_IMAGE_ID: imageId,
					HUB_RELEASE_PREVIOUS_CONFIG_SHA256: "2".repeat(64),
					HUB_RELEASE_SIMULATE: "1",
				}),
			});
			expect(result.status).toBe(2);
			expect(result.stderr).toMatch(/HUB_RELEASE_SIMULATE is available only with HUB_RELEASE_TEST_MODE=1/);
			expect(runGit(["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).stdout.trim()).toBe(controlSha);
			expect(candidateSha).not.toBe(controlSha);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("pins Hub-only release scope and never tears down the environment or reverses migrations", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "deploy/hub/migration-policy.json"), "utf8"));
		const releaseCompose = fs.readFileSync(path.join(repoRoot, "compose.hub.release.yml"), "utf8");
		const recoveryOverlay = fs.readFileSync(path.join(repoRoot, "compose.hub.recovery-mode.yml"), "utf8");
		const backupUnit = fs.readFileSync(path.join(repoRoot, "deploy/hub/systemd/thelemar-hub-backup.service"), "utf8");
		const maintenanceUnit = fs.readFileSync(path.join(repoRoot, "deploy/hub/systemd/thelemar-hub-maintenance.service"), "utf8");
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
		expect(releaseCompose).toMatch(/maintenance:\s+image: \$\{HUB_RELEASE_BFF_IMAGE:-thelemartools-hub-bff\}/);
		expect(recoveryOverlay).toContain("HUB_RECOVERY_BFF_IMAGE");
		expect(backupUnit).toContain("/etc/thelemar-hub/compose.hub.recovery-mode.yml");
		expect(maintenanceUnit).toContain("/etc/thelemar-hub/compose.hub.recovery-mode.yml");
		for (const unit of [backupUnit, maintenanceUnit]) {
			expect(unit).toContain("recovery-job-run");
			expect(unit).toContain("--admission-lock /run/lock/thelemar-hub-release.lock");
			expect(unit).not.toMatch(/^EnvironmentFile=/m);
		}
		expect(backupUnit).toContain("--job-lock /run/thelemar-hub/backup.lock");
		expect(maintenanceUnit).toContain("--job-lock /run/thelemar-hub/maintenance.lock");
		const operationsRunbook = fs.readFileSync(path.join(repoRoot, "docs/hub/runbooks/oracle-operations.md"), "utf8").replace(/\s+/g, " ");
		expect(operationsRunbook).toMatch(/The overlay remains root-owned and outside the source\s+checkout so it survives restoring the narrow E control commit/);
		expect(operationsRunbook).toMatch(/sudo install -d -o root -g root -m 0755 \/etc\/thelemar-hub/);
		expect(operationsRunbook).toMatch(/sudo install -o root -g root -m 0644 compose\.hub\.recovery-mode\.yml/);
		expect(operationsRunbook).toMatch(/sudo sha256sum \/etc\/thelemar-hub\/compose\.hub\.recovery-mode\.yml/);
		expect(operationsRunbook).toMatch(/sudo install -o root -g root -m 0644 deploy\/hub\/systemd\/thelemar-hub-\*/);
		expect(operationsRunbook).toMatch(/not an\s+unlocked precheck/i);
		expect(operationsRunbook).toMatch(
			/recovery-job-run[\s\S]*?retains both locks\s+until the foreground Compose command\s+exits/i,
		);
		expect(operationsRunbook).toContain("HUB_RECOVERY_BFF_IMAGE:-thelemartools-hub-bff");
		expect(operationsRunbook).toMatch(/source\s+review or E preparation does not authorize any of them/i);
		const promotionRunbook = fs.readFileSync(path.join(repoRoot, "docs/hub/runbooks/deploy-promote.md"), "utf8").replace(/\s+/g, " ");
		for (const asset of [
			"deploy/hub/release.sh",
			"deploy/hub/release-helper.py",
			"compose.hub.release.yml",
			"compose.hub.recovery-mode.yml",
			"deploy/hub/systemd/thelemar-hub-backup.service",
			"deploy/hub/systemd/thelemar-hub-maintenance.service",
			"test/jest/hub/HubReleaseAutomation.test.js",
			"test/jest/hub/HubReleaseHelper.test.js",
			"test/jest/hub/git-test-utils.js",
			"docs/hub/runbooks/deploy-promote.md",
			"docs/hub/runbooks/oracle-operations.md",
			"docs/hub/runbooks/rollback.md",
		]) expect(promotionRunbook).toContain(asset);
		expect(promotionRunbook).toContain("These twelve paths are the complete D-to-E source-preparation allowlist");
		expect(promotionRunbook).toContain("All other D paths must remain byte- and mode-identical.");
		expect(promotionRunbook).toContain("Keep all five required release-image");
		expect(promotionRunbook).toContain("backup.build: !reset null");
		expect(promotionRunbook).toContain("The first transition is executed by D's already-running in-memory release engine/helper");
		expect(promotionRunbook).toContain("no environment variable selects a profile");
		const rollbackRunbook = fs.readFileSync(path.join(repoRoot, "docs/hub/runbooks/rollback.md"), "utf8").replace(/\s+/g, " ");
		expect(rollbackRunbook).toMatch(/later M\/qualified-image context/i);
		expect(rollbackRunbook).toMatch(/not available in E's inherited D\s+package/i);
		expect(rollbackRunbook).toContain("D's already-running release engine/helper executes the first transition");
		expect(source).toContain("production release lock must match the scheduled-job admission lock");
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
