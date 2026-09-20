export const ACCOUNT_IDENTITY_LINKING_CAPABILITY = "account.identity_linking.v1";
export const ACCOUNT_IDENTITY_LINK_TTL_SECONDS = 5 * 60;

const PROVIDER_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function normalizeIdentityRetentionRequiredProviders (
	providers,
	{configuredProviders = null} = {},
) {
	const values = typeof providers === "string"
		? providers.split(",").map(value => value.trim()).filter(Boolean)
		: providers;
	if (!Array.isArray(values) || !values.length) {
		throw new TypeError(`At least one identity retention provider is required.`);
	}
	const normalized = [...new Set(values)];
	if (
		normalized.length !== values.length
		|| normalized.some(provider => typeof provider !== "string" || !PROVIDER_RE.test(provider))
	) {
		throw new TypeError(`Identity retention providers must be unique lower-case registry slugs.`);
	}
	if (
		configuredProviders
		&& normalized.some(provider => !configuredProviders.has(provider))
	) {
		throw new TypeError(`Identity retention providers must be configured authentication providers.`);
	}
	return normalized;
}

export function getIdentityUnlinkBlock ({
	accountStatus,
	identities,
	identityId,
	reauthenticatedIdentityId,
	retentionRequiredProviders,
	availableProviders = identities.map(identity => identity.provider),
}) {
	if (accountStatus !== "active") return "ACCOUNT_LIFECYCLE_BLOCKED";
	const identity = identities.find(candidate => candidate.id === identityId);
	if (!identity) return "IDENTITY_NOT_FOUND";
	if (identities.length <= 1) return "LAST_IDENTITY_PROTECTED";
	if (identity.id === reauthenticatedIdentityId) return "REAUTHENTICATION_IDENTITY_CONFLICT";
	const retentionProviders = new Set(retentionRequiredProviders);
	const available = new Set(availableProviders);
	if (!identities.some(candidate => candidate.id !== identity.id && available.has(candidate.provider))) {
		return "LAST_IDENTITY_PROTECTED";
	}
	if (
		retentionProviders.has(identity.provider)
		&& !identities.some(candidate => (
			candidate.id !== identity.id
			&& retentionProviders.has(candidate.provider)
			&& available.has(candidate.provider)
		))
	) return "IDENTITY_RETENTION_REQUIRED";
	return null;
}

export function getPublicExternalIdentity ({
	identity,
	accountStatus,
	identities,
	currentSessionIdentityId,
	providerStatus,
	retentionRequiredProviders,
	availableProviders,
}) {
	const reason = getIdentityUnlinkBlock({
		accountStatus,
		identities,
		identityId: identity.id,
		reauthenticatedIdentityId: currentSessionIdentityId,
		retentionRequiredProviders,
		availableProviders,
	});
	return {
		id: identity.id,
		provider: identity.provider,
		handle: identity.handle,
		displayName: identity.displayName,
		linkedAt: identity.createdAt,
		lastAuthenticatedAt: identity.lastAuthenticatedAt,
		isCurrentSessionIdentity: identity.id === currentSessionIdentityId,
		providerStatus,
		canUnlink: reason == null,
		unlinkBlockedReason: reason,
	};
}
