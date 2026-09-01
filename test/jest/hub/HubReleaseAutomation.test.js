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
			expect(spawnSync("git", ["init", "--bare", remote]).status).toBe(0);
			expect(spawnSync("git", ["init", checkout]).status).toBe(0);
			for (const args of [
				["-C", checkout, "config", "user.name", "Release Test"],
				["-C", checkout, "config", "user.email", "release@example.invalid"],
				["-C", checkout, "remote", "add", "origin", remote],
			]) expect(spawnSync("git", args).status).toBe(0);
			fs.writeFileSync(path.join(checkout, "file"), "release\n");
			expect(spawnSync("git", ["-C", checkout, "add", "file"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "commit", "-m", "release"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "tag", "-a", "hub-test", "-m", "verified"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "push", "origin", "HEAD", "refs/tags/hub-test"]).status).toBe(0);
			const expectedSha = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout.trim();
			const script = `source ${JSON.stringify(releaseScript)}; resolve_remote_tag ${JSON.stringify(checkout)} hub-test`;
			const result = spawnSync("bash", ["-c", script], {encoding: "utf8"});
			expect(result.status).toBe(0);
			expect(result.stdout.trim().split("\t")).toEqual([expect.stringMatching(/^[0-9a-f]{40}$/), expectedSha]);

			expect(spawnSync("git", ["-C", checkout, "tag", "hub-lightweight"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "push", "origin", "refs/tags/hub-lightweight"]).status).toBe(0);
			const mismatch = spawnSync("bash", ["-c",
				`source ${JSON.stringify(releaseScript)}; resolve_remote_tag ${JSON.stringify(checkout)} hub-lightweight`,
			], {encoding: "utf8"});
			expect(mismatch.status).not.toBe(0);
			expect(mismatch.stderr).toMatch(/must be an annotated tag/);
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it("rejects dirty release source and local/origin tag identity drift", () => {
		const dir = makeTempDir();
		try {
			const remote = path.join(dir, "remote.git");
			const checkout = path.join(dir, "checkout");
			expect(spawnSync("git", ["init", "--bare", remote]).status).toBe(0);
			expect(spawnSync("git", ["init", checkout]).status).toBe(0);
			for (const args of [
				["-C", checkout, "config", "user.name", "Release Test"],
				["-C", checkout, "config", "user.email", "release@example.invalid"],
				["-C", checkout, "remote", "add", "origin", remote],
			]) expect(spawnSync("git", args).status).toBe(0);
			fs.writeFileSync(path.join(checkout, "file"), "one\n");
			expect(spawnSync("git", ["-C", checkout, "add", "file"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "commit", "-m", "one"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "tag", "-a", "hub-test", "-m", "one"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "push", "origin", "HEAD", "refs/tags/hub-test"]).status).toBe(0);
			const originalObject = spawnSync("git", ["-C", checkout, "rev-parse", "refs/tags/hub-test"], {encoding: "utf8"}).stdout.trim();

			fs.writeFileSync(path.join(checkout, "dirty"), "untracked\n");
			const dirty = spawnSync("bash", ["-c",
				`source ${JSON.stringify(releaseScript)}; ROOT=${JSON.stringify(checkout)}; assert_clean_root`,
			], {encoding: "utf8"});
			expect(dirty.status).not.toBe(0);
			expect(dirty.stderr).toMatch(/deployment checkout is dirty/);
			fs.rmSync(path.join(checkout, "dirty"));

			fs.writeFileSync(path.join(checkout, "file"), "two\n");
			expect(spawnSync("git", ["-C", checkout, "commit", "-am", "two"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "tag", "-fa", "hub-test", "-m", "two"]).status).toBe(0);
			expect(spawnSync("git", ["-C", checkout, "push", "--force", "origin", "refs/tags/hub-test"]).status).toBe(0);
			const script = [
				`source ${JSON.stringify(releaseScript)}`,
				`pair="$(resolve_remote_tag ${JSON.stringify(checkout)} hub-test)"`,
				`remote_object="\${pair%%$'\\t'*}"`,
				`[[ "$remote_object" == ${JSON.stringify(originalObject)} ]] || fail "local and origin tag identities do not match"`,
			].join("; ");
			const mismatch = spawnSync("bash", ["-c", script], {encoding: "utf8"});
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

	it("pins expand/deploy/contract rules and never mutates Foundry or reverses migrations", () => {
		const source = fs.readFileSync(releaseScript, "utf8");
		const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "deploy/hub/migration-policy.json"), "utf8"));
		const releaseCompose = fs.readFileSync(path.join(repoRoot, "compose.hub.release.yml"), "utf8");
		expect(source).toContain("flock -n 9");
		expect(source).toContain("git -C \"$ROOT\" verify-tag");
		expect(source.match(/assert_compose_safe/g)?.length).toBeGreaterThanOrEqual(3);
		expect(source).toContain("restore_candidate_image_tags");
		expect(source).toContain("wait_for_public_ready");
		expect(source).toContain("assert_candidate_images");
		for (const variable of [
			"HUB_RELEASE_MIGRATE_IMAGE",
			"HUB_RELEASE_GRANT_ROLES_IMAGE",
			"HUB_RELEASE_BFF_IMAGE",
			"HUB_RELEASE_STATIC_IMAGE",
		]) expect(releaseCompose).toContain(`\${${variable}:?`);
		expect(source).toContain("contract migration");
		expect(source).toContain("never run a down migration");
		expect(source).not.toMatch(/docker compose[\s\S]{0,120}\bdown\b/);
		expect(source).not.toMatch(/systemctl\s+(?:stop|restart)\s+foundry/i);
		expect(source).not.toMatch(/^\s*chown\b/m);
		expect(Object.values(policy.migrations).every(entry => ["expand", "contract"].includes(entry.phase))).toBe(true);
	});
});
