import pg from "pg";
import {pGrantHubDatabaseRoles} from "../src/database-roles.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const runtimeRole = process.env.HUB_RUNTIME_DB_ROLE;
if (!runtimeRole) throw new Error(`HUB_RUNTIME_DB_ROLE is required.`);

const pool = new pg.Pool({
	connectionString: databaseUrl,
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	connectionTimeoutMillis: 5_000,
	query_timeout: 30_000,
	statement_timeout: 30_000,
	max: 1,
});
try {
	const client = await pool.connect();
	try {
		const result = await pGrantHubDatabaseRoles({
			client,
			runtimeRole,
			backupRole: process.env.HUB_BACKUP_DB_ROLE || null,
		});
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} finally {
		client.release();
	}
} finally {
	await pool.end();
}
