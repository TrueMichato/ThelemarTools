import fs from "node:fs";
import {getPgEnv} from "../../../server/scripts/pg-env.mjs";

describe("PostgreSQL operations credential handling", () => {
	it("moves credentials into libpq environment variables", () => {
		const env = getPgEnv({
			databaseUrl: "postgresql://user:p%40ss@db.example:5544/hub?sslmode=require",
			env: {PATH: "/bin"},
		});
		expect(env).toEqual(expect.objectContaining({
			PGHOST: "db.example",
			PGPORT: "5544",
			PGUSER: "user",
			PGPASSWORD: "p@ss",
			PGDATABASE: "hub",
			PGSSLMODE: "require",
		}));
	});

	it("does not place DATABASE_URL in pg command arguments", () => {
		for (const file of ["backup.mjs", "restore.mjs"]) {
			const source = fs.readFileSync(new URL(`../../../server/scripts/${file}`, import.meta.url), "utf8");
			expect(source).not.toMatch(/--dbname=\$\{databaseUrl\}/);
			expect(source).toContain("getPgEnv({databaseUrl})");
		}
		const migrate = fs.readFileSync(new URL("../../../server/scripts/migrate.mjs", import.meta.url), "utf8");
		expect(migrate).not.toContain("spawn");
		expect(migrate).toContain("connectionString: databaseUrl");
	});

	it("rejects URLs without an explicit database name", () => {
		expect(() => getPgEnv({databaseUrl: "postgresql://user:secret@db.example"}))
			.toThrow("explicit database name");
	});
});
