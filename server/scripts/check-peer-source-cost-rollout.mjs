import pg from "pg";
import {
	parsePeerSourceCostsCampaignIds,
	pCheckPeerSourceCostsCampaignReadiness,
	PeerSourceCostsRolloutError,
} from "../src/peer-source-cost-rollout.js";

const {Pool} = pg;

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new PeerSourceCostsRolloutError("MISSING_CONFIGURATION", `${name} is required.`);
	return value;
}

const pool = new Pool({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL === "false" ? false : {rejectUnauthorized: true},
	connectionTimeoutMillis: 5_000,
	query_timeout: 10_000,
	statement_timeout: 10_000,
	max: 1,
});

try {
	const campaignIds = parsePeerSourceCostsCampaignIds(
		requireEnv("HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS"),
	);
	const result = await pCheckPeerSourceCostsCampaignReadiness({queryable: pool, campaignIds});
	process.stdout.write(
		`Peer source-cost rollout preflight passed for ${result.readyCampaignCount} exact campaign(s).\n`,
	);
} catch (error) {
	const code = error instanceof PeerSourceCostsRolloutError
		? error.code
		: "DATABASE_CHECK_FAILED";
	process.stderr.write(`Peer source-cost rollout preflight failed (${code}).\n`);
	for (const blocker of error?.details?.blockers || []) {
		process.stderr.write(`- ${blocker.campaignId}: ${blocker.reason}\n`);
	}
	process.exitCode = 2;
} finally {
	await pool.end();
}
