import pg from "pg";
import {pGetAuthProviderRollbackBlockers} from "../src/auth-provider-operations.js";

const {Pool} = pg;

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function getCsv (name, defaultValue = "") {
	return (process.env[name] || defaultValue)
		.split(",")
		.map(value => value.trim())
		.filter(Boolean);
}

const pool = new Pool({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	connectionTimeoutMillis: 5_000,
	query_timeout: 10_000,
	statement_timeout: 10_000,
	max: 2,
});

try {
	const result = await pGetAuthProviderRollbackBlockers({
		queryable: pool,
		supportedProviders: getCsv("HUB_ROLLBACK_SUPPORTED_AUTH_PROVIDERS", "github"),
		allowedSubjects: getCsv("HUB_ALLOWED_OAUTH_SUBJECTS"),
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (result.blockedAccounts) process.exitCode = 2;
} finally {
	await pool.end();
}
