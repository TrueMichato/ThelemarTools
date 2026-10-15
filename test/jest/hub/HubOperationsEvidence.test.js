import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";
import {pRecordOperationalEvidence} from "../../../server/scripts/operations-evidence.mjs";

const describePostgres = process.env.HUB_TEST_OPERATIONS_DATABASE_URL ? describe : describe.skip;

function withPsqlStub (script, callback) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-operations-evidence-"));
	const bin = path.join(dir, "bin");
	fs.mkdirSync(bin);
	const psqlPath = path.join(bin, "psql");
	fs.writeFileSync(psqlPath, `#!/bin/sh\n${script}\n`);
	fs.chmodSync(psqlPath, 0o700);
	const originalPath = process.env.PATH;
	process.env.PATH = `${bin}${path.delimiter}${originalPath || ""}`;
	try {
		return callback();
	} finally {
		if (originalPath == null) delete process.env.PATH;
		else process.env.PATH = originalPath;
		fs.rmSync(dir, {recursive: true, force: true});
	}
}

function withPsqlOutputDiscarder (callback) {
	const psqlPath = spawnSync("which", ["psql"], {encoding: "utf8"}).stdout.trim();
	if (!psqlPath) throw new Error("A real psql client is required for PostgreSQL operational-evidence tests.");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-operations-evidence-lost-ack-"));
	const bin = path.join(dir, "bin");
	fs.mkdirSync(bin);
	const psqlWrapper = path.join(bin, "psql");
	fs.writeFileSync(psqlWrapper, `#!/bin/sh\nexec ${JSON.stringify(psqlPath)} -o /dev/null "$@"\n`);
	fs.chmodSync(psqlWrapper, 0o700);
	const originalPath = process.env.PATH;
	process.env.PATH = `${bin}${path.delimiter}${originalPath || ""}`;
	try {
		return callback();
	} finally {
		if (originalPath == null) delete process.env.PATH;
		else process.env.PATH = originalPath;
		fs.rmSync(dir, {recursive: true, force: true});
	}
}

describe("Campaign Hub operational evidence acknowledgement", () => {
	it("keeps the completed drill timestamp distinct from the later database acknowledgement", () => {
		const runId = "eb3bd2e0-b650-4f78-9880-9695f01eebcf";
		const completedAt = new Date(Date.now() - 5_000);
		const isoCompletedAt = completedAt.toISOString();
		withPsqlStub(
			`printf '%s\\n' '{"runId":"${runId}","completedAt":"${isoCompletedAt}"}'`,
			() => {
				const result = pRecordOperationalEvidence({
					databaseUrl: "postgresql://hub_operations:test@127.0.0.1/hub",
					jobType: "restore_drill",
					status: "succeeded",
					startedAt: new Date(completedAt.getTime() - 60_000),
					completedAt,
					runId,
					details: {claim: "structural-restore-and-authenticated-new-synthetic-fixtures"},
					maxDurationMs: 4 * 60 * 60 * 1_000,
					timeoutMs: 1_000,
				});
				expect(result.completedAt).toBe(completedAt);
				expect(result.acknowledgedAt.getTime()).toBeGreaterThanOrEqual(completedAt.getTime());
			},
		);
	});

	it("does not return a success-shaped result when the database acknowledgement is lost", () => {
		withPsqlStub("exit 0", () => {
			expect(() => pRecordOperationalEvidence({
				databaseUrl: "postgresql://hub_operations:test@127.0.0.1/hub",
				jobType: "restore_drill",
				status: "succeeded",
				startedAt: new Date(Date.now() - 60_000),
				completedAt: new Date(),
				runId: "eb3bd2e0-b650-4f78-9880-9695f01eebcf",
				details: {},
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 1_000,
			})).toThrow(/not acknowledged/i);
		});
	});

	describePostgres("Campaign Hub operational evidence on disposable PostgreSQL", () => {
		let pool;

		beforeAll(async () => {
			pool = new pg.Pool({
				connectionString: process.env.HUB_TEST_OPERATIONS_DATABASE_URL,
				ssl: process.env.HUB_DATABASE_SSL === "false" ? false : undefined,
				max: 2,
			});
			const identity = await pool.query("SELECT current_user AS role_name");
			expect(identity.rows[0].role_name).toBe("hub_operations");
		});

		afterAll(async () => {
			await pool?.end();
		});

		it("executes the SQL, acknowledges exact replay, rejects changed/future receipts, and resolves a lost ACK by readback", async () => {
			const databaseUrl = process.env.HUB_TEST_OPERATIONS_DATABASE_URL;
			const completedAt = new Date(Date.now() - 5_000);
			const startedAt = new Date(completedAt.getTime() - 60_000);
			const runId = crypto.randomUUID();
			const details = {claim: "disposable-postgresql-operational-evidence"};
			const record = () => pRecordOperationalEvidence({
				databaseUrl,
				jobType: "restore_drill",
				status: "succeeded",
				startedAt,
				completedAt,
				runId,
				details,
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 10_000,
			});

			const first = record();
			expect(first.completedAt).toEqual(completedAt);
			expect(first.acknowledgedAt.getTime()).toBeGreaterThanOrEqual(completedAt.getTime());
			expect(record().runId).toBe(runId);
			expect(() => pRecordOperationalEvidence({
				databaseUrl,
				jobType: "restore_drill",
				status: "succeeded",
				startedAt,
				completedAt,
				runId,
				details: {...details, changed: true},
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 10_000,
			})).toThrow(/not acknowledged/i);

			expect(() => pRecordOperationalEvidence({
				databaseUrl,
				jobType: "restore_drill",
				status: "succeeded",
				startedAt,
				completedAt: new Date(Date.now() + 60_000),
				runId: crypto.randomUUID(),
				details,
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 10_000,
			})).toThrow(/not acknowledged/i);

			const lostAckRunId = crypto.randomUUID();
			expect(() => withPsqlOutputDiscarder(() => pRecordOperationalEvidence({
				databaseUrl,
				jobType: "backup",
				status: "succeeded",
				startedAt,
				completedAt,
				runId: lostAckRunId,
				details,
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 10_000,
			}))).toThrow(/not acknowledged/i);
			const persisted = await pool.query(
				"SELECT id::text, completed_at FROM hub.operational_runs WHERE id = $1::uuid",
				[lostAckRunId],
			);
			expect(persisted.rows).toEqual([{
				id: lostAckRunId,
				completed_at: completedAt,
			}]);
		});
	});

	it("does not return success when the database acknowledgement times out", () => {
		withPsqlStub("exec sleep 2", () => {
			expect(() => pRecordOperationalEvidence({
				databaseUrl: "postgresql://hub_operations:test@127.0.0.1/hub",
				jobType: "restore_drill",
				status: "succeeded",
				startedAt: new Date(Date.now() - 60_000),
				completedAt: new Date(),
				runId: "eb3bd2e0-b650-4f78-9880-9695f01eebcf",
				details: {},
				maxDurationMs: 4 * 60 * 60 * 1_000,
				timeoutMs: 50,
			})).toThrow(/ETIMEDOUT|timed out/i);
		});
	});
});
