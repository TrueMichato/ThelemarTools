export const ACCOUNT_ENTITLEMENTS_CAPABILITY = "account.entitlements.v1";
export const CAMPAIGN_CREATE_ENTITLEMENT = "campaign:create";
export const PLATFORM_OPERATE_ENTITLEMENT = "platform:operate";
export const ACCOUNT_ENTITLEMENT_NAMES = Object.freeze([
	CAMPAIGN_CREATE_ENTITLEMENT,
	PLATFORM_OPERATE_ENTITLEMENT,
]);
export const REAUTHENTICATION_MAX_AGE_MS = 5 * 60 * 1_000;

const ACCOUNT_ENTITLEMENT_NAME_SET = new Set(ACCOUNT_ENTITLEMENT_NAMES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountEntitlementName (entitlementName) {
	return ACCOUNT_ENTITLEMENT_NAME_SET.has(entitlementName);
}

export function parseOperatorAccountIds (rawValue) {
	const values = Array.isArray(rawValue)
		? rawValue
		: `${rawValue || ""}`.split(",");
	const seen = new Set();
	const accountIds = [];
	for (const rawAccountId of values) {
		const accountId = `${rawAccountId}`.trim().toLowerCase();
		if (!accountId) continue;
		if (!UUID_RE.test(accountId)) throw new TypeError(`Configured operator account identifier is invalid.`);
		if (seen.has(accountId)) throw new TypeError(`Duplicate configured operator account identifier.`);
		seen.add(accountId);
		accountIds.push(accountId);
	}
	return accountIds;
}

export function isFreshReauthentication ({recentReauthenticatedAt, now = new Date()}) {
	if (!recentReauthenticatedAt) return false;
	const authenticatedAt = new Date(recentReauthenticatedAt);
	const ageMs = now.getTime() - authenticatedAt.getTime();
	return Number.isFinite(authenticatedAt.getTime())
		&& ageMs >= 0
		&& ageMs <= REAUTHENTICATION_MAX_AGE_MS;
}

export function redactEntitlementAuditForAccount ({audit, accountId}) {
	if (!`${audit?.action || ""}`.startsWith("account.entitlement.")) return audit;
	const details = structuredClone(audit.details || {});
	for (const key of Object.keys(details)) {
		if (!/accountid$/i.test(key)) continue;
		if (details[key] !== accountId) delete details[key];
	}
	return {
		...audit,
		...(Object.hasOwn(audit, "actorAccountId")
			? {actorAccountId: audit.actorAccountId === accountId ? accountId : null}
			: {}),
		...(Object.hasOwn(audit, "actor_account_id")
			? {actor_account_id: audit.actor_account_id === accountId ? accountId : null}
			: {}),
		details,
	};
}

export function redactEntitlementForAccount ({entitlement}) {
	const {
		grantedByAccountId: _grantedByAccountId,
		revokedByAccountId: _revokedByAccountId,
		...safe
	} = entitlement;
	return safe;
}
