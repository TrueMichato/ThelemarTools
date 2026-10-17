import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {
	R11F_MIGRATION_LEDGER_SHA256,
	validateCompletedRestoreDrill,
	getRestoreDrillCompletionMetrics,
} from "../../../server/src/recovery-evidence.js";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const restoreBaseline = path.join(repoRoot, "server/scripts/restore-drill-baseline.mjs");
const R11F_MIGRATIONS = [
	["0001", "0001_hub_core.sql", "52a76455ec4a6ecc9706a5c18f9b2ea53f8c3621f89ac0b7b95186e097c833f2"],
	["0002", "0002_lifecycle_administration.sql", "6e9c57cbe25767d0e1eee3f3e8844dd08f834fca642f4e6e21627aaec8435f47"],
	["0003", "0003_operational_runs.sql", "bd3bc4c1643f77f37955d71cb18217afcd67d54705c07c87d657fbd25a7f5e05"],
	["0004", "0004_character_projection_policy.sql", "fb9c15d74c25c32a9f581f746b2bd9f252a08b2b7fb6ecf42b35e7dcd7855b4d"],
	["0005", "0005_semantic_character_operations.sql", "6462fc7510a1a4b331fdbeaf9ce3b5ae050390e3b3b5e7cc62e1a141e65c18a4"],
	["0006", "0006_multi_provider_identity.sql", "7a5a5018280bb1c264423f13f2fcaeb2bcf6c514ae76be43a867644819fb0fb5"],
	["0007", "0007_peer_source_costs.sql", "d9136beb09bc774a6b9b0ce33edaedb130b0ea5d7101341cc9041f5382a1d266"],
	["0008", "0008_invite_gated_first_access.sql", "83eaab54c6f34c84ad4672681c1ac017ec0e0dfc3a9cae1bb5d59a3c45ee3771"],
	["0009", "0009_account_entitlements.sql", "7894877510e44a73efcc84d32eb0df95013add0b593ab15756e5952caee8c5128"],
].map(([version, filename, checksum]) => ({version, filename, checksum}));

function getRestoreEvidence () {
	const migrationLedgerSha256 = R11F_MIGRATION_LEDGER_SHA256;
	const structuralCounts = {
		accounts: 2,
		campaigns: 1,
		memberships: 1,
		characters: 1,
		auditEntries: 2,
		domainEvents: 3,
		outboxEntries: 0,
		semanticOperations: 0,
		commandReceipts: 1,
	};
	const migrations = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"];
	const snapshot = (phase, capturedAt, counts, fixtureCollisionChecked, fixtureCollision) => ({
		phase,
		status: "ready",
		capturedAt,
		protocolVersion: 5,
		appliedMigrationVersions: migrations,
		pendingMigrationVersions: [],
		migrationLedgerSha256,
		fixtureCollisionChecked,
		fixtureCollision,
		unvalidatedConstraintCount: 0,
		structuralCounts: counts,
	});
	return {
		schemaVersion: 1,
		drillId: "restore-r11f-20261015",
		operator: "operator",
		startedAt: "2026-10-15T10:00:00.000Z",
		archiveCreatedAt: "2026-10-15T09:00:00.000Z",
		restoreCompletedAt: "2026-10-15T10:03:00.000Z",
		fixtureStartedAt: "2026-10-15T10:06:00.000Z",
		workflowsCompletedAt: "2026-10-15T10:15:00.000Z",
		testServicesStoppedAt: "2026-10-15T10:16:00.000Z",
		exactReleaseReturnedAt: "2026-10-15T10:21:00.000Z",
		cleanupCompletedAt: "2026-10-15T10:25:00.000Z",
		safeFailures: [],
		archiveFilename: "hub-20261015T090000Z.dump.enc",
		archiveSha256: "a".repeat(64),
		releaseSourceSha: "4578c8671a7b05066fb9a19411cb8a31cdd753ef",
		testHarnessSourceSha: "4578c8671a7b05066fb9a19411cb8a31cdd753ef",
		evidenceFinalizerSourceSha: "9".repeat(40),
		evidenceFinalizerImageId: `sha256:${"8".repeat(64)}`,
		recoveryOperationsSourceSha: "9".repeat(40),
		protocolVersion: 5,
		requiredMigrationVersion: "0009",
		appliedMigrationVersions: migrations,
		pendingMigrationVersions: [],
		images: {
			bff: "sha256:7dc84ccefba2d58f6f0dc8fc3a47551d0ba8bcd75f847b9742a90cb769aac231",
			static: "sha256:6318106691636a821735b0b025478846d4fdce1827e5078ea4566dee6fdc3254",
			testHarness: `sha256:${"e".repeat(64)}`,
			edge: `sha256:${"7".repeat(64)}`,
			recoveryOperations: `sha256:${"8".repeat(64)}`,
			bffSourceSha: "4578c8671a7b05066fb9a19411cb8a31cdd753ef",
			testHarnessSourceSha: "4578c8671a7b05066fb9a19411cb8a31cdd753ef",
			recoveryOperationsSourceSha: "9".repeat(40),
		},
		fixtureMode: "new-synthetic",
		fixtureCollisionChecked: true,
		fixtureCollision: false,
		exactVersionImages: true,
		authHarnessUnmodified: true,
		restoredAccountContinuity: false,
		realProviderContinuity: false,
		migrationLedgerSha256,
		preFixtureBaseline: snapshot("before", "2026-10-15T10:05:00.000Z", structuralCounts, true, false),
		postFixtureSnapshot: snapshot("after", "2026-10-15T10:23:00.000Z", {
			...structuralCounts,
			accounts: 5,
			campaigns: 3,
			memberships: 4,
			characters: 3,
			auditEntries: 5,
			domainEvents: 8,
			outboxEntries: 0,
			semanticOperations: 1,
			commandReceipts: 4,
		}, false, true),
		checks: {
			structural: true,
			readiness: true,
			authenticatedSession: true,
			campaignReadWrite: true,
			characterReadWrite: true,
			inventoryInteraction: true,
			crossCharacterEffect: true,
			authorizationDenial: true,
			returnToExactRelease: true,
			testServicesStopped: true,
			cleanup: true,
			temporaryCredentialsRemoved: true,
		},
	};
}

function runBaseline ({phase = "before", collision = false, migrationVersions, counts = {accounts: 2}} = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-restore-baseline-"));
	try {
		const binDir = path.join(dir, "bin");
		fs.mkdirSync(binDir);
		const migrations = migrationVersions
			? migrationVersions.map(version => ({version, filename: `${version}_migration.sql`, checksum: "a".repeat(64)}))
			: R11F_MIGRATIONS;
		const snapshot = {
			migrations,
			fixtureCollision: collision,
			unvalidatedConstraintCount: 0,
			counts,
		};
		const fakePsql = path.join(binDir, "psql");
		fs.writeFileSync(fakePsql, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(snapshot)}'\n`);
		fs.chmodSync(fakePsql, 0o700);
		return spawnSync("node", [restoreBaseline, phase], {
			encoding: "utf8",
			env: {
				...process.env,
				DATABASE_URL: "postgresql://example.invalid/hub",
				PATH: `${binDir}:${process.env.PATH}`,
			},
		});
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
}

describe("Campaign Hub recovery evidence", () => {
	it("accepts only the narrow exact-r11f new-synthetic restore claim", () => {
		const evidence = getRestoreEvidence();
		const result = validateCompletedRestoreDrill({
			evidence,
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		});
		expect(result).toMatchObject({
			protocolVersion: 5,
			requiredMigrationVersion: "0009",
			rpoSeconds: 3600,
			rpoMilliseconds: 3_600_000,
			elapsedBeforeFinalizationSeconds: 1800,
			fixtureMutationCounts: {
				accounts: 3,
				campaigns: 2,
				memberships: 3,
				characters: 2,
				auditEntries: 3,
				domainEvents: 5,
				outboxEntries: 0,
				semanticOperations: 1,
				commandReceipts: 3,
			},
		});
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, realProviderContinuity: true},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/continuity must remain explicitly unclaimed/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, appliedMigrationVersions: ["0001", "0009"]},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/exactly r11f migrations 0001-0009/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, images: {...evidence.images, recoveryOperationsSourceSha: evidence.releaseSourceSha}},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/does not match its pinned source/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, releaseSourceSha: "a".repeat(40)},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/not pinned to exact r11f source/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, images: {...evidence.images, bff: `sha256:${"c".repeat(64)}`}},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/exact r11f BFF image/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, migrationLedgerSha256: "a".repeat(64)},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/filenames\/checksums do not match the exact r11f source/i);
		const substitutedMigrationLedgerSha256 = "a".repeat(64);
		expect(() => validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				migrationLedgerSha256: substitutedMigrationLedgerSha256,
				preFixtureBaseline: {
					...evidence.preFixtureBaseline,
					migrationLedgerSha256: substitutedMigrationLedgerSha256,
				},
				postFixtureSnapshot: {
					...evidence.postFixtureSnapshot,
					migrationLedgerSha256: substitutedMigrationLedgerSha256,
				},
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/filenames\/checksums do not match the exact r11f source/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				preFixtureBaseline: {
					...evidence.preFixtureBaseline,
					capturedAt: "2026-10-15T10:02:00.000Z",
				},
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/captured out of order/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				postFixtureSnapshot: {
					...evidence.postFixtureSnapshot,
					capturedAt: "2026-10-15T10:31:00.000Z",
				},
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/captured after finalization/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {...evidence, archiveCreatedAt: "2026-10-14T09:59:59.999Z"},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/older than the 24-hour RPO/i);
		expect(() => getRestoreDrillCompletionMetrics({
			startedAt: evidence.startedAt,
			completedAt: "2026-10-15T14:00:00.001Z",
		})).toThrow(/RTO exceeded four hours/i);
		expect(getRestoreDrillCompletionMetrics({
			startedAt: evidence.startedAt,
			completedAt: "2026-10-15T14:00:00.000Z",
		})).toEqual({rtoSeconds: 14_400});
		expect(validateCompletedRestoreDrill({
			evidence,
			now: Date.parse("2026-10-15T13:59:59.999Z"),
		}).elapsedBeforeFinalizationSeconds).toBe(14_400);
		expect(() => validateCompletedRestoreDrill({
			evidence,
			now: Date.parse("2026-10-15T13:59:59.999Z"),
		})).not.toThrow();
		expect(() => validateCompletedRestoreDrill({
			evidence,
			now: Date.parse("2026-10-15T14:00:00.001Z"),
		})).toThrow(/continuous four-hour RTO budget/i);
		expect(validateCompletedRestoreDrill({
			evidence,
			now: Date.parse("2026-10-15T14:00:00.000Z"),
		}).elapsedBeforeFinalizationMilliseconds).toBe(14_400_000);
		expect(validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				safeFailures: [
					{phase: "restore", code: "RESTORE_FAILED", at: "2026-10-15T10:02:00.000Z"},
				],
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		}).safeFailures).toEqual([
			{phase: "restore", code: "RESTORE_FAILED", at: "2026-10-15T10:02:00.000Z"},
		]);
		expect(() => validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				safeFailures: [{phase: "restore", code: "private failure text", at: "2026-10-15T10:02:00.000Z"}],
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/failure code is invalid/i);
		expect(() => validateCompletedRestoreDrill({
			evidence: {
				...evidence,
				safeFailures: [{
					phase: "restore",
					code: "RESTORE_FAILED",
					at: "2026-10-15T10:02:00.000Z",
					message: "do not persist raw errors",
				}],
			},
			now: Date.parse("2026-10-15T10:30:00.000Z"),
		})).toThrow(/unsupported fields/i);
	});

	it("captures exact r11f structural counts and blocks fixed-fixture collisions before startup", () => {
		const ready = runBaseline({counts: {accounts: 2, campaigns: 1}});
		expect(ready.status).toBe(0);
		expect(JSON.parse(ready.stdout)).toMatchObject({
			phase: "before",
			status: "ready",
			protocolVersion: 5,
			appliedMigrationVersions: ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"],
			pendingMigrationVersions: [],
			fixtureCollisionChecked: true,
			fixtureCollision: false,
			structuralCounts: {accounts: 2, campaigns: 1},
		});

		const collision = runBaseline({collision: true});
		expect(collision.status).not.toBe(0);
		expect(collision.stderr).toMatch(/collides with fixed r11f test fixtures/i);
		expect(collision.stdout).toBe("");
	});

	it("rejects non-r11f schemas before reporting restore readiness", () => {
		const result = runBaseline({migrationVersions: ["0001", "0009"]});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/not exactly at r11f migrations 0001-0009/i);
		expect(result.stdout).toBe("");
	});

	it("rejects altered r11f migration checksums before reporting restore readiness", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-restore-baseline-"));
		try {
			const binDir = path.join(dir, "bin");
			fs.mkdirSync(binDir);
			const altered = R11F_MIGRATIONS.map(row => ({...row}));
			altered[0].checksum = "a".repeat(64);
			const fakePsql = path.join(binDir, "psql");
			fs.writeFileSync(fakePsql, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
				migrations: altered,
				fixtureCollision: false,
				unvalidatedConstraintCount: 0,
				counts: {accounts: 1},
			})}'\n`);
			fs.chmodSync(fakePsql, 0o700);
			const result = spawnSync("node", [restoreBaseline, "before"], {
				encoding: "utf8",
				env: {
					...process.env,
					DATABASE_URL: "postgresql://example.invalid/hub",
					PATH: `${binDir}:${process.env.PATH}`,
				},
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/filenames\/checksums do not match the exact r11f source/i);
			expect(result.stdout).toBe("");
		} finally {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
});
