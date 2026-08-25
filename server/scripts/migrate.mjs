import path from "node:path";
import pg from "pg";
import {pRunMigrations} from "../src/migration-runner.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const operation = process.argv[2] || "apply";
const migrationsDir = path.resolve(process.argv[3] || "server/migrations");
const pool = new pg.Pool({
	connectionString: databaseUrl,
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	connectionTimeoutMillis: 5_000,
	max: 1,
});
try {
	const result = await pRunMigrations({
		pool,
		migrationsDir,
		operation,
		appVersion: process.env.npm_package_version || null,
	});
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	await pool.end();
}
