import {PostgresHubStore} from "../src/postgres-hub-store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const limit = Number(process.env.HUB_PURGE_LIMIT || 100);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error(`HUB_PURGE_LIMIT must be an integer from 1 to 1000.`);

const store = PostgresHubStore.fromConnectionString({
	connectionString: databaseUrl,
	ssl: process.env.HUB_DATABASE_SSL !== "false",
	maxConnections: 1,
});
try {
	await store.pCheckHealth();
	const result = await store.pPurgeDueAccounts({limit});
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	await store.pClose();
}
