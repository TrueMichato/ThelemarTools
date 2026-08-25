function getRoleIdentifier (role, label) {
	if (typeof role !== "string" || !/^[a-z_][a-z0-9_]*$/.test(role)) {
		throw new Error(`${label} must be a lowercase PostgreSQL role identifier.`);
	}
	return `"${role}"`;
}

async function pAssertRoleExists (client, role, label) {
	const result = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
	if (!result.rowCount) throw new Error(`${label} "${role}" does not exist.`);
}

export async function pGrantHubDatabaseRoles ({client, runtimeRole, backupRole = null}) {
	const runtime = getRoleIdentifier(runtimeRole, "Runtime role");
	const backup = backupRole == null ? null : getRoleIdentifier(backupRole, "Backup role");
	await pAssertRoleExists(client, runtimeRole, "Runtime role");
	if (backupRole != null) await pAssertRoleExists(client, backupRole, "Backup role");

	await client.query("BEGIN");
	try {
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
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
	return {runtimeRole, backupRole};
}
