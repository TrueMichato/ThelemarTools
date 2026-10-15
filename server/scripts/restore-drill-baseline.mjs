import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {getPgEnv} from "./pg-env.mjs";
import {R11F_MIGRATION_LEDGER_SHA256} from "../src/recovery-evidence.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required.`);
const phase = process.argv[2];
if (!["before", "after"].includes(phase)) {
	throw new Error(`Usage: node server/scripts/restore-drill-baseline.mjs <before|after>`);
}

const query = `
	WITH migration_rows AS (
		SELECT version, filename, checksum
		FROM hub.schema_migrations
		ORDER BY version
	),
	fixture_collision AS (
		SELECT EXISTS (
			SELECT 1
			FROM hub.external_identities
			WHERE provider = 'hub-test'
				OR (provider = 'github' AND provider_subject = '101')
				OR (provider = 'discord' AND provider_subject = '202')
		) AS found
	),
	structural AS (
		SELECT json_build_object(
			'accounts', (SELECT count(*) FROM hub.accounts),
			'campaigns', (SELECT count(*) FROM hub.campaigns),
			'memberships', (SELECT count(*) FROM hub.memberships),
			'characters', (SELECT count(*) FROM hub.characters),
			'auditEntries', (SELECT count(*) FROM hub.audit_entries),
			'domainEvents', (SELECT count(*) FROM hub.domain_events),
			'outboxEntries', (SELECT count(*) FROM hub.outbox_entries),
			'semanticOperations', (SELECT count(*) FROM hub.semantic_operations),
			'commandReceipts', (SELECT count(*) FROM hub.command_receipts)
		) AS counts
	)
	SELECT json_build_object(
		'migrations', (
			SELECT COALESCE(json_agg(to_json(migration_rows) ORDER BY migration_rows.version), '[]'::json)
			FROM migration_rows
		),
		'fixtureCollision', (SELECT found FROM fixture_collision),
		'unvalidatedConstraintCount', (
			SELECT count(*) FROM pg_catalog.pg_constraint
			WHERE connamespace = 'hub'::regnamespace AND NOT convalidated
		),
		'counts', (SELECT counts FROM structural)
	)::text;
`;

const result = spawnSync("psql", [
	"--no-psqlrc",
	"--quiet",
	"--tuples-only",
	"--no-align",
	"--set=ON_ERROR_STOP=1",
], {
	input: query,
	encoding: "utf8",
	timeout: 15_000,
	maxBuffer: 1024 * 1024,
	env: getPgEnv({databaseUrl}),
});
if (result.error || result.status !== 0) {
	throw new Error(`Restore baseline query failed.`);
}

let snapshot;
try {
	snapshot = JSON.parse(result.stdout.trim());
} catch {
	throw new Error(`Restore baseline query returned invalid output.`);
}

const expectedVersions = Array.from({length: 9}, (_, index) => `000${index + 1}`);
const versions = Array.isArray(snapshot.migrations) ? snapshot.migrations.map(row => row.version) : [];
if (JSON.stringify(versions) !== JSON.stringify(expectedVersions)) {
	throw new Error(`Restore target is not exactly at r11f migrations 0001-0009.`);
}
if (Number(snapshot.unvalidatedConstraintCount) !== 0) {
	throw new Error(`Restore target has unvalidated constraints.`);
}
if (phase === "before" && snapshot.fixtureCollision === true) {
	throw new Error(`Restore target collides with fixed r11f test fixtures.`);
}

const migrationLedgerSha256 = crypto.createHash("sha256")
	.update(JSON.stringify(snapshot.migrations))
	.digest("hex");
if (migrationLedgerSha256 !== R11F_MIGRATION_LEDGER_SHA256) {
	throw new Error(`Restore target migration filenames/checksums do not match the exact r11f source.`);
}
process.stdout.write(`${JSON.stringify({
	phase,
	status: "ready",
	capturedAt: new Date().toISOString(),
	protocolVersion: 5,
	appliedMigrationVersions: versions,
	pendingMigrationVersions: [],
	migrationLedgerSha256,
	fixtureCollisionChecked: phase === "before",
	fixtureCollision: snapshot.fixtureCollision === true,
	unvalidatedConstraintCount: Number(snapshot.unvalidatedConstraintCount),
	structuralCounts: snapshot.counts,
})}\n`);
