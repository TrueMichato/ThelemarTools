import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_FILE_RE = /^(?<version>\d{4})_(?<name>[a-z0-9][a-z0-9_-]*)\.sql$/;
const LEDGER_LOCK_KEY = "campaign-hub-schema-migrations";

const BASELINE_TABLES = new Set([
	"accounts",
	"audit_entries",
	"brew_bundle_versions",
	"campaigns",
	"character_leases",
	"characters",
	"command_receipts",
	"dm_workspace_leases",
	"dm_workspaces",
	"domain_events",
	"external_identities",
	"inventory_entries",
	"invites",
	"memberships",
	"outbox_entries",
	"party_inventories",
	"pending_actions",
	"rules_versions",
	"sessions",
	"transfers",
]);

const BASELINE_COLUMNS = new Set([
	"accounts.status",
	"campaigns.next_event_sequence",
	"characters.data",
	"characters.lease_epoch",
	"characters.revision",
	"command_receipts.expires_at",
	"dm_workspaces.lease_epoch",
	"dm_workspaces.revision",
	"domain_events.visibility",
	"outbox_entries.claim_token",
	"outbox_entries.status",
]);

const BASELINE_TRIGGERS = new Set([
	"inventory_entries_character_campaign_check",
	"pending_actions_character_campaign_check",
	"transfers_character_campaign_check",
]);

function getChecksum (sql) {
	return crypto.createHash("sha256").update(sql).digest("hex");
}

export function getMigrationFiles ({migrationsDir}) {
	const migrations = fs.readdirSync(migrationsDir, {withFileTypes: true})
		.filter(entry => entry.isFile())
		.map(entry => {
			const match = MIGRATION_FILE_RE.exec(entry.name);
			if (!match) return null;
			const sql = fs.readFileSync(path.join(migrationsDir, entry.name), "utf8");
			return {
				version: match.groups.version,
				name: match.groups.name,
				filename: entry.name,
				checksum: getChecksum(sql),
				sql,
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.version.localeCompare(b.version));

	if (!migrations.length || migrations[0].version !== "0001") {
		throw new Error(`Migration set must begin with version 0001.`);
	}
	const seen = new Set();
	for (const migration of migrations) {
		if (seen.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}.`);
		seen.add(migration.version);
		if (migration.version !== "0001" && /(?:^|\n)\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(migration.sql)) {
			throw new Error(`${migration.filename} must not contain transaction control; the runner owns it.`);
		}
	}
	return migrations;
}

export function assertBaselineSchema ({tables, columns, triggers}) {
	const missingTables = [...BASELINE_TABLES].filter(name => !tables.has(name));
	const missingColumns = [...BASELINE_COLUMNS].filter(name => !columns.has(name));
	const missingTriggers = [...BASELINE_TRIGGERS].filter(name => !triggers.has(name));
	if (missingTables.length || missingColumns.length || missingTriggers.length) {
		throw new Error(`Existing Hub schema does not match migration 0001 baseline: ${JSON.stringify({
			missingTables,
			missingColumns,
			missingTriggers,
		})}`);
	}
}

export function getMigrationPlan ({migrations, applied, isExistingBaseline = false}) {
	const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
	for (const row of applied) {
		const migration = byVersion.get(row.version);
		if (!migration) throw new Error(`Applied migration ${row.version} is missing from disk.`);
		if (migration.filename !== row.filename) throw new Error(`Applied migration ${row.version} filename changed.`);
		if (migration.checksum !== row.checksum) throw new Error(`Applied migration ${row.version} checksum changed.`);
	}
	const appliedVersions = new Set(applied.map(row => row.version));
	return migrations
		.filter(migration => !appliedVersions.has(migration.version))
		.map(migration => ({
			...migration,
			action: isExistingBaseline && migration.version === "0001" ? "baseline" : "apply",
		}));
}

async function pGetSchemaState (client) {
	const relations = await client.query(`
		SELECT
			to_regclass('hub.accounts') AS accounts_table,
			to_regclass('hub.schema_migrations') AS ledger_table
	`);
	return {
		hasAccounts: relations.rows[0]?.accounts_table === "hub.accounts",
		hasLedger: relations.rows[0]?.ledger_table === "hub.schema_migrations",
	};
}

async function pAssertExistingBaseline (client) {
	const tablesResult = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'hub'`);
	const columnsResult = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'hub'`);
	const triggersResult = await client.query(`SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'hub'`);
	assertBaselineSchema({
		tables: new Set(tablesResult.rows.map(row => row.table_name)),
		columns: new Set(columnsResult.rows.map(row => `${row.table_name}.${row.column_name}`)),
		triggers: new Set(triggersResult.rows.map(row => row.trigger_name)),
	});
}

async function pEnsureLedger (client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS hub.schema_migrations (
			version text PRIMARY KEY,
			filename text NOT NULL UNIQUE,
			checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
			app_version text,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);
}

async function pInsertLedger ({client, migration, appVersion}) {
	await client.query(`
		INSERT INTO hub.schema_migrations (version, filename, checksum, app_version)
		VALUES ($1, $2, $3, $4)
	`, [migration.version, migration.filename, migration.checksum, appVersion || null]);
}

async function pGetApplied (client) {
	const result = await client.query(`
		SELECT version, filename, checksum, app_version, applied_at
		FROM hub.schema_migrations
		ORDER BY version
	`);
	return result.rows;
}

export async function pRunMigrations ({
	pool,
	migrationsDir,
	operation = "apply",
	appVersion = null,
}) {
	if (!["apply", "plan", "status"].includes(operation)) throw new Error(`Unknown migration operation "${operation}".`);
	const migrations = getMigrationFiles({migrationsDir});
	const client = await pool.connect();
	try {
		await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 7))`, [LEDGER_LOCK_KEY]);
		let state = await pGetSchemaState(client);
		let applied = state.hasLedger ? await pGetApplied(client) : [];
		const appliedNow = [];
		const isExistingBaseline = state.hasAccounts && !state.hasLedger;
		if (isExistingBaseline) {
			await pAssertExistingBaseline(client);
			applied = [];
		}
		let plan = getMigrationPlan({migrations, applied, isExistingBaseline});

		if (operation !== "apply") {
			return {
				operation,
				hasLedger: state.hasLedger,
				isExistingBaseline,
				applied,
				pending: plan.map(({sql: _sql, ...migration}) => migration),
			};
		}

		if (!state.hasLedger) {
			if (!state.hasAccounts) {
				const first = plan.find(migration => migration.version === "0001");
				if (!first) throw new Error(`Fresh database is missing migration 0001.`);
				await client.query(first.sql);
				state = await pGetSchemaState(client);
				if (!state.hasAccounts) throw new Error(`Migration 0001 did not create the Hub schema.`);
				appliedNow.push("0001");
			}
			await client.query("BEGIN");
			try {
				await pEnsureLedger(client);
				await pInsertLedger({client, migration: migrations[0], appVersion});
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
			applied = await pGetApplied(client);
			plan = getMigrationPlan({migrations, applied});
		}

		for (const migration of plan) {
			await client.query("BEGIN");
			try {
				await client.query(migration.sql);
				await pInsertLedger({client, migration, appVersion});
				await client.query("COMMIT");
				appliedNow.push(migration.version);
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		}

		return {
			operation,
			baselined: isExistingBaseline,
			appliedNow,
			applied: await pGetApplied(client),
			pending: [],
		};
	} finally {
		try {
			await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 7))`, [LEDGER_LOCK_KEY]);
		} finally {
			client.release();
		}
	}
}
