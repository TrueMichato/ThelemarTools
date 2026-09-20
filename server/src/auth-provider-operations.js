function normalizeProviderSet (providers) {
	if (!Array.isArray(providers) || !providers.length) throw new TypeError(`At least one rollback authentication provider is required.`);
	const normalized = [...new Set(providers)];
	if (normalized.some(provider => typeof provider !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(provider))) {
		throw new TypeError(`Rollback authentication providers must be lower-case registry slugs.`);
	}
	return normalized;
}

export async function pGetAuthProviderRollbackBlockers ({
	queryable,
	supportedProviders,
	allowedSubjects,
}) {
	if (!queryable?.query) throw new TypeError(`A queryable PostgreSQL client is required.`);
	const providers = normalizeProviderSet(supportedProviders);
	if (!Array.isArray(allowedSubjects) || !allowedSubjects.length) {
		throw new TypeError(`At least one legacy rollback provider subject is required.`);
	}
	const admitted = [...new Set(allowedSubjects)];
	const result = await queryable.query(`
		SELECT count(*)::bigint AS blocked_accounts
		FROM hub.accounts account
		WHERE account.status <> 'deleted'
			AND NOT EXISTS (
				SELECT 1
				FROM hub.external_identities identity
				WHERE identity.account_id = account.id
					AND identity.provider = ANY($1::text[])
					AND identity.provider || ':' || identity.provider_subject = ANY($2::text[])
			)
	`, [providers, admitted]);
	return {blockedAccounts: Number(result.rows[0]?.blocked_accounts || 0)};
}
