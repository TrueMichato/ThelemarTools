import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	assertBaselineSchema,
	getMigrationFiles,
	getMigrationPlan,
} from "../../../server/src/migration-runner.js";

function pWithMigrations (files, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-migrations-"));
	try {
		for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
		return fn(dir);
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
}

describe("Hub migration runner", () => {
	it("loads ordered checksummed migrations and rejects duplicate/transaction-owned files", () => {
		pWithMigrations({
			"0002_second.sql": "CREATE TABLE second_table (id integer);",
			"0001_first.sql": "BEGIN; CREATE TABLE first_table (id integer); COMMIT;",
		}, dir => {
			const migrations = getMigrationFiles({migrationsDir: dir});
			expect(migrations.map(it => it.version)).toEqual(["0001", "0002"]);
			expect(migrations[0].checksum).toMatch(/^[0-9a-f]{64}$/);
		});
		pWithMigrations({
			"0001_first.sql": "SELECT 1;",
			"0002_bad.sql": "BEGIN; SELECT 2; COMMIT;",
		}, dir => expect(() => getMigrationFiles({migrationsDir: dir})).toThrow(/must not contain transaction control/));
	});

	it("fails closed when an applied filename or checksum changes", () => {
		pWithMigrations({"0001_first.sql": "SELECT 1;"}, dir => {
			const migrations = getMigrationFiles({migrationsDir: dir});
			expect(() => getMigrationPlan({
				migrations,
				applied: [{version: "0001", filename: "0001_first.sql", checksum: "0".repeat(64)}],
			})).toThrow(/checksum changed/);
		});
	});

	it("marks an existing pre-ledger 0001 schema for baselining", () => {
		pWithMigrations({
			"0001_first.sql": "SELECT 1;",
			"0002_second.sql": "SELECT 2;",
		}, dir => {
			const plan = getMigrationPlan({
				migrations: getMigrationFiles({migrationsDir: dir}),
				applied: [],
				isExistingBaseline: true,
			});
			expect(plan.map(it => [it.version, it.action])).toEqual([
				["0001", "baseline"],
				["0002", "apply"],
			]);
		});
	});

	it("requires the critical 0001 tables, columns, and tenant triggers before baselining", () => {
		expect(() => assertBaselineSchema({
			tables: new Set(),
			columns: new Set(),
			triggers: new Set(),
		})).toThrow(/does not match migration 0001 baseline/);
	});
});
