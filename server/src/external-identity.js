const PROVIDER_RE = /^[a-z][a-z0-9-]{0,31}$/;

function getTextLength (value) {
	return Array.from(value).length;
}

function getOptionalMetadata (value, label) {
	if (value == null) return null;
	if (typeof value !== "string") throw new TypeError(`${label} must be a string or null.`);
	const normalized = value.trim();
	if (!normalized) return null;
	if (getTextLength(normalized) > 100) throw new TypeError(`${label} must be at most 100 characters.`);
	return normalized;
}

export function getExternalIdentityKey ({provider, subject}) {
	return JSON.stringify([provider, subject]);
}

export function normalizeExternalIdentity ({
	provider,
	subject = null,
	providerSubject = null,
	displayName = null,
	handle = null,
	login = null,
}) {
	if (typeof provider !== "string" || !PROVIDER_RE.test(provider)) {
		throw new TypeError(`Identity provider must be a lower-case registry slug.`);
	}
	const normalizedSubject = subject ?? providerSubject;
	if (
		typeof normalizedSubject !== "string"
		|| normalizedSubject !== normalizedSubject.trim()
		|| !normalizedSubject
		|| getTextLength(normalizedSubject) > 255
	) {
		throw new TypeError(`Identity subject must be a non-blank string of at most 255 characters without surrounding whitespace.`);
	}
	return {
		provider,
		subject: normalizedSubject,
		displayName: getOptionalMetadata(displayName, "Identity display name"),
		handle: getOptionalMetadata(handle ?? login, "Identity handle"),
	};
}

export function getAccountDisplayName (identity) {
	return identity.displayName || identity.handle || "Campaign Hub player";
}
