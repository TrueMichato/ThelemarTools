function getRoleIdentifier (role, label) {
	if (typeof role !== "string" || !/^[a-z_][a-z0-9_]*$/.test(role)) {
		throw new Error(`${label} must be a lowercase PostgreSQL role identifier.`);
	}
	return `"${role}"`;
}

async function pEnsureRoleExists ({client, role, password, label}) {
	const result = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
	if (result.rowCount) return false;
	if (!password) throw new Error(`${label} "${role}" does not exist and no creation password was supplied.`);
	await client.query(`SELECT set_config('hub.role_password', $1, true)`, [password]);
	await client.query(`
		DO $role$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
				EXECUTE format(
					'CREATE ROLE %I LOGIN PASSWORD %L',
					'${role}',
					current_setting('hub.role_password')
				);
			END IF;
		END
		$role$
	`);
	return true;
}

export async function pGrantHubDatabaseRoles ({
	client,
	runtimeRole,
	runtimePassword = null,
	backupRole = null,
	backupPassword = null,
	operationsRole = null,
	operationsPassword = null,
}) {
	const runtime = getRoleIdentifier(runtimeRole, "Runtime role");
	const backup = backupRole == null ? null : getRoleIdentifier(backupRole, "Backup role");
	const operations = operationsRole == null ? null : getRoleIdentifier(operationsRole, "Operations role");

	await client.query("BEGIN");
	try {
		await pEnsureRoleExists({client, role: runtimeRole, password: runtimePassword, label: "Runtime role"});
		if (backupRole != null) await pEnsureRoleExists({client, role: backupRole, password: backupPassword, label: "Backup role"});
		if (operationsRole != null) await pEnsureRoleExists({client, role: operationsRole, password: operationsPassword, label: "Operations role"});
		await client.query(`REVOKE CREATE ON SCHEMA hub FROM PUBLIC`);
		await client.query(`GRANT USAGE ON SCHEMA hub TO ${runtime}`);
		await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hub TO ${runtime}`);
		await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA hub TO ${runtime}`);
		await client.query(`REVOKE CREATE ON SCHEMA hub FROM ${runtime}`);
		await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA hub GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`);
		await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA hub GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}`);

		if (backup) {
			await client.query(`GRANT USAGE ON SCHEMA hub TO ${backup}`);
			await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA hub TO ${backup}`);
			await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA hub TO ${backup}`);
			await client.query(`REVOKE CREATE ON SCHEMA hub FROM ${backup}`);
			await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA hub GRANT SELECT ON TABLES TO ${backup}`);
			await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA hub GRANT SELECT ON SEQUENCES TO ${backup}`);
		}
		if (operations) {
			await client.query(`GRANT USAGE ON SCHEMA hub TO ${operations}`);
			await client.query(`GRANT SELECT, INSERT ON hub.operational_runs TO ${operations}`);
			await client.query(`REVOKE CREATE ON SCHEMA hub FROM ${operations}`);
		}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
	return {runtimeRole, backupRole, operationsRole};
}
