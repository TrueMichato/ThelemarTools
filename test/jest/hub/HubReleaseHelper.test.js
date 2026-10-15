import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {getIsolatedGitEnv} from "./git-test-utils.js";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const releaseHelper = path.join(repoRoot, "deploy/hub/release-helper.py");

function readChildJsonTuple (stdout) {
	const lines = stdout.trim().split(/\r?\n/);
	return JSON.parse(lines[lines.length - 1]);
}

function runGit (args, cwd, options = {}) {
	const {env = process.env, ...spawnOptions} = options;
	const result = spawnSync("git", args, {cwd, encoding: "utf8", ...spawnOptions, env: getIsolatedGitEnv(env)});
	if (result.status !== 0) throw new Error(result.stderr || `git exited ${result.status}`);
	return result.stdout.trim();
}

function makeContract () {
	return {
		peerTemplateRegistryVersions: ["peer-effects-v1"],
		multiTargetTemplateRegistryVersions: ["multi-target-effects-v1"],
		sourceTemplateContracts: [
			...["phb", "xphb"].map(source => ({
				sourceEntity: {type: "spell", uid: `cure wounds|${source}`, version: source === "phb" ? "phb-2014-v1" : "xphb-2024-v1"},
				effectTemplateId: "spell.cure-wounds.heal",
				choice: {kind: "spellSlot", minimumLevel: 1, maximumLevel: 9},
				sourceCost: {version: 1, component: {kind: "spell_slot", pool: "standard", level: "choice.castLevel", amount: 1}},
				targetCount: {minimum: 1, maximum: 1},
			})),
			...["phb", "xphb"].map(source => ({
				sourceEntity: {type: "spell", uid: `healing word|${source}`, version: source === "phb" ? "phb-2014-v1" : "xphb-2024-v1"},
				effectTemplateId: "spell.healing-word.heal",
				choice: {kind: "spellSlot", minimumLevel: 1, maximumLevel: 9},
				sourceCost: {version: 1, component: {kind: "spell_slot", pool: "standard", level: "choice.castLevel", amount: 1}},
				targetCount: {minimum: 1, maximum: 1},
			})),
			...["phb", "xphb"].map(source => ({
				sourceEntity: {type: "spell", uid: `mass healing word|${source}`, version: source === "phb" ? "phb-2014-v1" : "xphb-2024-v1"},
				effectTemplateId: "spell.mass-healing-word.heal",
				choice: {kind: "spellSlot", minimumLevel: 3, maximumLevel: 9},
				sourceCost: {version: 1, component: {kind: "spell_slot", pool: "standard", level: "choice.castLevel", amount: 1}},
				targetCount: {minimum: 1, maximum: 6},
				allowTargetNoOp: true,
			})),
			...["lay on hands|xphb", "lay on hands|paladin|xphb|1"].map(uid => ({
				sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
				effectTemplateId: "ability.lay-on-hands.heal",
				choice: {kind: "integerAmount", minimum: 1, maximum: 100},
				sourceCost: {
					version: 1,
					component: {
						kind: "feature_use",
						resourceId: "exact-persisted-resource",
						featureRef: {uid},
						amount: "choice.amount",
					},
				},
				targetCount: {minimum: 1, maximum: 1},
			})),
		],
		effectTemplateIds: [
			"spell.cure-wounds.heal",
			"spell.healing-word.heal",
			"spell.mass-healing-word.heal",
			"ability.lay-on-hands.heal",
		],
		workflows: {
			healingWord: true,
			layOnHands: true,
			exactReplay: true,
			resourceMirrors: true,
			privacy: true,
			multiTargetLifecycle: true,
			sourceTemplateMatrix: true,
			layOnHandsMinimum: 1,
			layOnHandsMaximum: 100,
			layOnHandsBoundaryCases: [1, 11, 100],
			exactReplayCases: ["healingWordPHB", "healingWordXPHB", "layOnHands11", "layOnHands100"],
			multiTargetMaximum: 6,
		},
		configurationScope: "current-exact-campaign-configuration",
	};
}

function makeActiveFallbackState () {
	const bffImageId = `sha256:${"1".repeat(64)}`;
	const staticImageId = `sha256:${"2".repeat(64)}`;
	const operationsImageId = `sha256:${"3".repeat(64)}`;
	return {
		status: "active",
		source_sha: "1".repeat(40),
		source_tree_sha: "a".repeat(40),
		source_tag_name: "hub-fallback-test",
		source_tag_object_sha: "b".repeat(40),
		protocol_version: "6",
		required_migration_version: "0014",
		schema_compatible_through: "0014",
		bff_image_id: bffImageId,
		static_image_id: staticImageId,
		operations_image_id: operationsImageId,
		bff_image_ref: "thelemartools-hub-bff",
		static_image_ref: "thelemartools-hub-static",
		backup_image_ref: "thelemartools-hub-backup",
		maintenance_image_ref: "thelemartools-hub-bff",
		configuration_sha256: "c".repeat(64),
		manifest_sha256: "d".repeat(64),
		qualification_evidence_sha256: "e".repeat(64),
		executing_engine_source_sha: "4".repeat(40),
		executing_engine_tree_sha: "f".repeat(40),
		control_source_sha: "4".repeat(40),
		control_tree_sha: "f".repeat(40),
		control_release_script_sha256: "5".repeat(64),
		control_helper_sha256: "6".repeat(64),
		control_migrate_image_id: `sha256:${"7".repeat(64)}`,
		control_grant_roles_image_id: `sha256:${"8".repeat(64)}`,
	};
}

function writeRecoveryJobBinding (dir, state = makeActiveFallbackState()) {
	const statePath = path.join(dir, "active-fallback.tsv");
	const envPath = path.join(dir, "active-fallback.env");
	const blockedPath = path.join(dir, "active-fallback.blocked");
	fs.writeFileSync(statePath, `${Object.entries(state).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});
	fs.writeFileSync(envPath, `HUB_RECOVERY_BFF_IMAGE=${state.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${state.operations_image_id}\n`, {mode: 0o600});
	return {statePath, envPath, blockedPath};
}

async function waitForFile (filePath, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) return;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error(`timed out waiting for ${path.basename(filePath)}`);
}

function getResolvedConfig () {
	return {
		services: {
			bff: {
				environment: {
					HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS: "6d35c39f-4aef-4b8a-9586-75a6e9bbaf03",
					HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS: "",
					HUB_AUTH_PROVIDERS: "github",
					HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS: "",
					HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS: "github",
				},
			},
		},
	};
}

function runHelper (args, {input, env = process.env, ...options} = {}) {
	return spawnSync("python3", [releaseHelper, ...args], {
		encoding: "utf8",
		...options,
		env: getIsolatedGitEnv(env),
		...(input == null ? {} : {input}),
	});
}

describe("Campaign Hub release helper recovery binding", () => {
	it("binds an annotated fallback tag, declared source, immutable images, and resolved enrollment", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-manifest-"));
		try {
			runGit(["init"], dir);
			runGit(["config", "user.name", "Recovery Test"], dir);
			runGit(["config", "user.email", "recovery@example.invalid"], dir);
			fs.mkdirSync(path.join(dir, "js/hub"), {recursive: true});
			fs.mkdirSync(path.join(dir, "server/src"), {recursive: true});
			fs.writeFileSync(path.join(dir, "js/hub/hub-capabilities.js"), "export const HUB_PROTOCOL_VERSION = \"6\";\n");
			fs.writeFileSync(path.join(dir, "server/src/migration-version.js"), "export const HUB_REQUIRED_MIGRATION_VERSION = \"0014\";\n");
			runGit(["add", "."], dir);
			runGit(["commit", "-m", "recovery fixture"], dir);
			const sourceSha = runGit(["rev-parse", "HEAD"], dir);
			const sourceTreeSha = runGit(["rev-parse", "HEAD^{tree}"], dir);
			const sourceTagName = "hub-recovery-20261015";
			runGit(["tag", "-a", sourceTagName, "-m", "reviewed recovery source"], dir);
			const sourceTagObjectSha = runGit(["rev-parse", `refs/tags/${sourceTagName}`], dir);
			runGit(["commit", "--allow-empty", "-m", "candidate fixture"], dir);
			const candidateSha = runGit(["rev-parse", "HEAD"], dir);

			const configResult = runHelper(["configuration-fingerprint", "--compose-config", "-"], {
				input: `${JSON.stringify(getResolvedConfig())}\n`,
			});
			expect(configResult.status).toBe(0);
			const configurationBinding = JSON.parse(configResult.stdout);
			expect(configurationBinding).not.toHaveProperty("campaigns");
			expect(configResult.stdout).not.toContain("6d35c39f-4aef-4b8a-9586-75a6e9bbaf03");

			const images = {
				bff: `sha256:${"1".repeat(64)}`,
				static: `sha256:${"2".repeat(64)}`,
				operations: `sha256:${"3".repeat(64)}`,
			};
			const contract = makeContract();
			const evidence = {
				status: "passed",
				type: "isolated-exact-binary",
				sourceSha,
				sourceTreeSha,
				sourceTagName,
				sourceTagObjectSha,
				protocolVersion: "6",
				requiredMigrationVersion: "0014",
				schemaCompatibleThrough: "0014",
				images,
				contract,
				configurationBinding,
			};
			const evidencePath = path.join(dir, "qualification.json");
			const manifestPath = path.join(dir, "manifest.json");
			const evidenceBytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
			fs.writeFileSync(evidencePath, evidenceBytes, {mode: 0o600});
			const manifest = {
				schemaVersion: 1,
				source: {sha: sourceSha, treeSha: sourceTreeSha, tagName: sourceTagName, tagObjectSha: sourceTagObjectSha, protocolVersion: "6", requiredMigrationVersion: "0014"},
				schemaCompatibleThrough: "0014",
				images,
				contract,
				configurationBinding,
				qualification: {
					status: "passed",
					type: "isolated-exact-binary",
					evidenceSha256: crypto.createHash("sha256").update(evidenceBytes).digest("hex"),
				},
			};
			fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {mode: 0o600});
			const args = [
				"recovery-manifest",
				"--manifest", manifestPath,
				"--evidence", evidencePath,
				"--git-root", dir,
				"--candidate-sha", candidateSha,
				"--protocol", "6",
				"--source-migration", "0014",
				"--migration", "0014",
				"--compose-config", "-",
			];
			const result = runHelper(args, {input: `${JSON.stringify(getResolvedConfig())}\n`});
			expect(result.status).toBe(0);
			expect(result.stdout).toContain(`source_sha\t${sourceSha}`);
			expect(result.stdout).toContain(`source_tag_object_sha\t${sourceTagObjectSha}`);
			expect(result.stdout).toContain(`bff_image_id\t${images.bff}`);
			expect(result.stdout).toContain(`configuration_sha256\t${configurationBinding.sha256}`);

			const fingerprintOnlyArgs = args
				.filter((value, index) => value !== "--compose-config" && args[index - 1] !== "--compose-config")
				.concat(["--configuration-sha256", configurationBinding.sha256]);
			const fingerprintOnly = runHelper(fingerprintOnlyArgs);
			expect(fingerprintOnly.status).toBe(0);
			expect(fingerprintOnly.stdout).toContain(`configuration_sha256\t${configurationBinding.sha256}`);

			const changedConfig = getResolvedConfig();
			changedConfig.services.bff.environment.HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS = "";
			const changedEnrollment = runHelper(args, {input: `${JSON.stringify(changedConfig)}\n`});
			expect(changedEnrollment.status).not.toBe(0);
			expect(changedEnrollment.stderr).toMatch(/configuration fingerprint/i);

			const identityOnlyArgs = args.filter((value, index) => value !== "--compose-config" && args[index - 1] !== "--compose-config");
			const identityOnly = runHelper(identityOnlyArgs);
			expect(identityOnly.status).toBe(0);
			runGit(["tag", "-f", "-a", sourceTagName, "-m", "moved recovery source"], dir);
			const movedTag = runHelper(args, {input: `${JSON.stringify(getResolvedConfig())}\n`});
			expect(movedTag.status).not.toBe(0);
			expect(movedTag.stderr).toMatch(/tag object/i);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("resolves all recovery job image references from the build-only Compose model", () => {
		const config = {
			name: "thelemartools-hub",
			services: {
				bff: {build: {context: "."}},
				static: {build: {context: "."}},
				backup: {image: "thelemartools-hub-backup", build: null},
				maintenance: {image: "thelemartools-hub-bff"},
			},
		};
		const result = runHelper(["recovery-image-references", "--compose-config", "-"], {
			input: `${JSON.stringify(config)}\n`,
		});
		expect(result.status).toBe(0);
		expect(result.stdout.trim().split("\n")).toEqual([
			"thelemartools-hub-bff",
			"thelemartools-hub-static",
			"thelemartools-hub-backup",
			"thelemartools-hub-bff",
		]);
	});

	it("keeps scheduled recovery jobs fenced until active state and environment agree", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-job-state-"));
		try {
			const {statePath, envPath, blockedPath} = writeRecoveryJobBinding(dir);
			const args = ["recovery-job-state", "--state", statePath, "--env", envPath, "--blocked", blockedPath];
			expect(runHelper(args).status).toBe(0);

			const state = makeActiveFallbackState();
			fs.writeFileSync(envPath, `HUB_RECOVERY_BFF_IMAGE=${state.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=thelemartools-hub-backup\n`, {mode: 0o600});
			expect(runHelper(args).status).not.toBe(0);
			fs.writeFileSync(envPath, `HUB_RECOVERY_BFF_IMAGE=${state.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${state.operations_image_id}\n`, {mode: 0o600});
			fs.writeFileSync(blockedPath, "starting\n", {mode: 0o600});
			expect(runHelper(args).status).not.toBe(0);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects incomplete, mutable, empty, and symlinked active job projections", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-job-projection-"));
		try {
			const binding = writeRecoveryJobBinding(dir);
			const args = ["recovery-job-state", "--state", binding.statePath, "--env", binding.envPath, "--blocked", binding.blockedPath];
			const validState = makeActiveFallbackState();
			expect(runHelper(args).status).toBe(0);

			for (const invalidState of [
				(({operations_image_id, ...rest}) => rest)(validState),
				{...validState, bff_image_id: ""},
				{...validState, bff_image_id: "thelemartools-hub-bff"},
				{...validState, static_image_id: validState.bff_image_id},
				{...validState, backup_image_ref: validState.bff_image_ref},
				{...validState, protocol_version: "5"},
				{...validState, control_source_sha: "9".repeat(40)},
				{...validState, schema_compatible_through: "0013"},
			]) {
				fs.writeFileSync(binding.statePath, `${Object.entries(invalidState).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});
				expect(runHelper(args).status).not.toBe(0);
			}

			fs.writeFileSync(binding.statePath, `${Object.entries(validState).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${validState.bff_image_id}\n`, {mode: 0o600});
			expect(runHelper(args).status).not.toBe(0);
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${validState.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=sha256:${"9".repeat(64)}\n`, {mode: 0o600});
			expect(runHelper(args).status).not.toBe(0);
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${validState.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${validState.operations_image_id}\n`, {mode: 0o600});
			const realStatePath = path.join(dir, "active-fallback-real.tsv");
			fs.renameSync(binding.statePath, realStatePath);
			fs.symlinkSync(realStatePath, binding.statePath);
			expect(runHelper(args).status).not.toBe(0);
			fs.rmSync(binding.statePath);
			fs.writeFileSync(binding.statePath, `${Object.entries(validState).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});

			const realEnvPath = path.join(dir, "active-fallback-real.env");
			fs.renameSync(binding.envPath, realEnvPath);
			fs.symlinkSync(realEnvPath, binding.envPath);
			expect(runHelper(args).status).not.toBe(0);
			fs.rmSync(binding.envPath);
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${validState.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${validState.operations_image_id}\n`, {mode: 0o600});

			fs.symlinkSync(path.join(dir, "missing-blocked-target"), binding.blockedPath);
			expect(runHelper(args).status).not.toBe(0);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("selects only the locked state binding and clears inherited recovery image values", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-job-run-"));
		try {
			const binding = writeRecoveryJobBinding(dir);
			const admissionLock = path.join(dir, "release.lock");
			const jobLock = path.join(dir, "backup.lock");
			const command = ["recovery-job-run", "--state", binding.statePath, "--env", binding.envPath, "--blocked", binding.blockedPath,
				"--admission-lock", admissionLock, "--job-lock", jobLock, "--", "python3", "-c",
				"import json,os; print(json.dumps([os.environ.get('HUB_RECOVERY_BFF_IMAGE'), os.environ.get('HUB_RECOVERY_BACKUP_IMAGE')]))"];
			const staleEnv = {
				...process.env,
				HUB_RECOVERY_BFF_IMAGE: "thelemartools-hub-bff",
				HUB_RECOVERY_BACKUP_IMAGE: "thelemartools-hub-backup",
			};
			fs.rmSync(binding.statePath);
			fs.rmSync(binding.envPath);
			const normal = runHelper(command, {env: staleEnv});
			expect(normal.status).toBe(0);
			expect(readChildJsonTuple(normal.stdout)).toEqual(["", ""]);

			const state = makeActiveFallbackState();
			fs.writeFileSync(binding.statePath, `${Object.entries(state).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${state.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${state.operations_image_id}\n`, {mode: 0o600});
			const active = runHelper(command, {env: staleEnv});
			expect(active.status).toBe(0);
			expect(readChildJsonTuple(active.stdout)).toEqual([state.bff_image_id, state.operations_image_id]);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("does not inspect or launch against state while a release replaces the active job projection", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-job-interleave-"));
		const binding = writeRecoveryJobBinding(dir);
		const admissionLock = path.join(dir, "release.lock");
		const lockReady = path.join(dir, "writer-holds-lock");
		const releaseWriter = path.join(dir, "allow-writer-exit");
		const writer = spawn("python3", ["-c", [
			"import fcntl, os, sys, time",
			"fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)",
			"fcntl.flock(fd, fcntl.LOCK_EX)",
			"open(sys.argv[2], 'w').close()",
			"while not os.path.exists(sys.argv[3]): time.sleep(0.01)",
		].join("\n"), admissionLock, lockReady, releaseWriter], {stdio: "ignore"});
		const writerResult = new Promise(resolve => writer.once("close", (code, signal) => resolve({code, signal})));
		const jobArgs = [
			"recovery-job-run", "--state", binding.statePath, "--env", binding.envPath, "--blocked", binding.blockedPath,
			"--admission-lock", admissionLock, "--job-lock", path.join(dir, "backup.lock"),
			"--", "python3", "-c", "print('scheduled command launched')",
		];
		try {
			await waitForFile(lockReady);
			fs.writeFileSync(binding.blockedPath, "starting\n", {mode: 0o600});
			fs.writeFileSync(binding.statePath, "incomplete\tprojection\n", {mode: 0o600});
			fs.writeFileSync(binding.envPath, "HUB_RECOVERY_BFF_IMAGE=mutable-alias\n", {mode: 0o600});
			const duringTransition = runHelper(jobArgs);
			expect(duringTransition.status).not.toBe(0);
			expect(duringTransition.stderr).toMatch(/release admission lock is already held/);
			expect(duringTransition.stderr).not.toMatch(/projection|fenced/);
			expect(duringTransition.stdout).not.toContain("scheduled command launched");

			const updatedState = makeActiveFallbackState();
			fs.writeFileSync(binding.statePath, `${Object.entries(updatedState).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`, {mode: 0o600});
			fs.writeFileSync(binding.envPath, `HUB_RECOVERY_BFF_IMAGE=${updatedState.bff_image_id}\nHUB_RECOVERY_BACKUP_IMAGE=${updatedState.operations_image_id}\n`, {mode: 0o600});
			fs.rmSync(binding.blockedPath);
			const stillLocked = runHelper(jobArgs);
			expect(stillLocked.status).not.toBe(0);
			expect(stillLocked.stderr).toMatch(/release admission lock is already held/);

			fs.writeFileSync(releaseWriter, "finish\n");
			expect(await writerResult).toEqual({code: 0, signal: null});
			const afterTransition = runHelper([
				...jobArgs.slice(0, jobArgs.indexOf("--job-lock") + 1),
				path.join(dir, "backup.lock"),
				"--", "python3", "-c",
				"import json,os; print(json.dumps([os.environ['HUB_RECOVERY_BFF_IMAGE'], os.environ['HUB_RECOVERY_BACKUP_IMAGE']]))",
			]);
			expect(afterTransition.status).toBe(0);
			expect(readChildJsonTuple(afterTransition.stdout)).toEqual([updatedState.bff_image_id, updatedState.operations_image_id]);
		} finally {
			if (writer.exitCode == null && writer.signalCode == null) {
				fs.writeFileSync(releaseWriter, "finish\n");
				await writerResult;
			}
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("binds the active fallback to the release engine that actually ran", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-recovery-state-"));
		try {
			runGit(["init"], dir);
			runGit(["config", "user.name", "Recovery Test"], dir);
			runGit(["config", "user.email", "recovery@example.invalid"], dir);
			fs.writeFileSync(path.join(dir, "README"), "deployed baseline\n");
			runGit(["add", "."], dir);
			runGit(["commit", "-m", "deployed baseline"], dir);
			const deployedSha = runGit(["rev-parse", "HEAD"], dir);
			runGit(["checkout", "-b", "fallback"], dir);
			for (const file of [
				"js/hub/hub-capabilities.js",
				"server/src/migration-version.js",
			]) fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
			fs.writeFileSync(path.join(dir, "js/hub/hub-capabilities.js"), "export const HUB_PROTOCOL_VERSION = \"6\";\n");
			fs.writeFileSync(path.join(dir, "server/src/migration-version.js"), "export const HUB_REQUIRED_MIGRATION_VERSION = \"0014\";\n");
			runGit(["add", "."], dir);
			runGit(["commit", "-m", "fallback application"], dir);
			const sourceSha = runGit(["rev-parse", "HEAD"], dir);
			const sourceTreeSha = runGit(["rev-parse", "HEAD^{tree}"], dir);
			const sourceTagName = "hub-recovery-engine-20261015";
			runGit(["tag", "-a", sourceTagName, "-m", "qualified fallback"], dir);
			const sourceTagObjectSha = runGit(["rev-parse", `refs/tags/${sourceTagName}`], dir);
			runGit(["checkout", "-b", "control", deployedSha], dir);
			fs.mkdirSync(path.join(dir, "deploy/hub"), {recursive: true});
			fs.writeFileSync(path.join(dir, "deploy/hub/release.sh"), "release engine source\n");
			fs.writeFileSync(path.join(dir, "deploy/hub/release-helper.py"), "release helper source\n");
			fs.writeFileSync(path.join(dir, "engine-marker"), "engine change\n");
			runGit(["add", "engine-marker"], dir);
			runGit(["add", "deploy"], dir);
			runGit(["commit", "-m", "preserved release engine"], dir);
			const controlSha = runGit(["rev-parse", "HEAD"], dir);
			const controlTreeSha = runGit(["rev-parse", "HEAD^{tree}"], dir);
			runGit(["merge", "--no-ff", "fallback", "-m", "normal A7 and engine merge"], dir);
			const candidateSha = runGit(["rev-parse", "HEAD"], dir);
			runGit(["checkout", "--detach", controlSha], dir);

			const configResult = runHelper(["configuration-fingerprint", "--compose-config", "-"], {
				input: `${JSON.stringify(getResolvedConfig())}\n`,
			});
			expect(configResult.status).toBe(0);
			const configurationBinding = JSON.parse(configResult.stdout);
			const statePath = path.join(dir, "active-fallback.tsv");
			const state = {
				status: "active",
				source_sha: sourceSha,
				source_tree_sha: sourceTreeSha,
				source_tag_name: sourceTagName,
				source_tag_object_sha: sourceTagObjectSha,
				protocol_version: "6",
				required_migration_version: "0014",
				schema_compatible_through: "0014",
				bff_image_id: `sha256:${"1".repeat(64)}`,
				static_image_id: `sha256:${"2".repeat(64)}`,
				operations_image_id: `sha256:${"3".repeat(64)}`,
				bff_image_ref: "hub-bff",
				static_image_ref: "hub-static",
				backup_image_ref: "hub-backup",
				maintenance_image_ref: "hub-maintenance",
				configuration_sha256: configurationBinding.sha256,
				manifest_sha256: "4".repeat(64),
				qualification_evidence_sha256: "5".repeat(64),
				executing_engine_source_sha: controlSha,
				executing_engine_tree_sha: controlTreeSha,
				control_source_sha: controlSha,
				control_tree_sha: controlTreeSha,
				control_release_script_sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "deploy/hub/release.sh"))).digest("hex"),
				control_helper_sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "deploy/hub/release-helper.py"))).digest("hex"),
				control_migrate_image_id: `sha256:${"6".repeat(64)}`,
				control_grant_roles_image_id: `sha256:${"7".repeat(64)}`,
			};
			const writeState = () => fs.writeFileSync(
				statePath,
				`${Object.entries(state).map(([key, value]) => `${key}\t${value}`).join("\n")}\n`,
				{mode: 0o600},
			);
			writeState();
			const args = [
				"recovery-state",
				"--state", statePath,
				"--git-root", dir,
				"--current-sha", controlSha,
				"--candidate-sha", candidateSha,
				"--candidate-protocol", "6",
				"--candidate-migration", "0014",
				"--configuration-sha256", configurationBinding.sha256,
			];
			expect(runHelper(args).status).toBe(0);

			const candidateMissingFallbackArgs = [...args];
			candidateMissingFallbackArgs[candidateMissingFallbackArgs.indexOf("--candidate-sha") + 1] = controlSha;
			const candidateMissingFallback = runHelper(candidateMissingFallbackArgs);
			expect(candidateMissingFallback.status).not.toBe(0);
			expect(candidateMissingFallback.stderr).toMatch(/does not include the active fallback source/i);

			state.executing_engine_source_sha = sourceSha;
			writeState();
			const replacedEngine = runHelper(args);
			expect(replacedEngine.status).not.toBe(0);
			expect(replacedEngine.stderr).toMatch(/does not bind the executing release engine/i);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
});
