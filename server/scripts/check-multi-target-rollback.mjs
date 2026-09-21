import pg from "pg";
import {pGetMultiTargetRollbackPreflight} from "../src/multi-target-rollback-preflight.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const target = process.env.HUB_MULTI_TARGET_ROLLBACK_TARGET;
if (!target) throw new Error(`HUB_MULTI_TARGET_ROLLBACK_TARGET is required.`);
const supportedTemplateRegistryVersions = (process.env.HUB_MULTI_TARGET_SUPPORTED_TEMPLATE_REGISTRY_VERSIONS || "")
	.split(",")
	.map(value => value.trim())
	.filter(Boolean);

const pool = new pg.Pool({
	connectionString: databaseUrl,
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	connectionTimeoutMillis: 5_000,
	query_timeout: 10_000,
	statement_timeout: 10_000,
	max: 1,
});

try {
	const result = await pGetMultiTargetRollbackPreflight({
		queryable: pool,
		target,
		supportedTemplateRegistryVersions,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.compatible) process.exitCode = 2;
} finally {
	await pool.end();
}
