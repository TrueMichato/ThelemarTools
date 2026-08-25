import {PostgresHubStore} from "../src/postgres-hub-store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const batchSize = Number(process.env.HUB_MAINTENANCE_BATCH_SIZE || 1_000);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
	throw new Error(`HUB_MAINTENANCE_BATCH_SIZE must be an integer from 1 to 10000.`);
}

const store = PostgresHubStore.fromConnectionString({
	connectionString: databaseUrl,
	ssl: process.env.HUB_DATABASE_SSL !== "false",
	maxConnections: 4,
});
try {
	await store.pCheckHealth();
	const result = await store.pRunMaintenance({batchSize});
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	await store.pClose();
}
