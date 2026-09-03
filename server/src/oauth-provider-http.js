import {AuthProviderError} from "./auth-provider-error.js";

export const OAUTH_PROVIDER_HTTP_TIMEOUT_MS = 5_000;
export const OAUTH_PROVIDER_JSON_MAX_BYTES = 32 * 1024;
export const OAUTH_PROVIDER_JWKS_MAX_BYTES = 64 * 1024;

function isJsonContentType (value) {
	if (typeof value !== "string") return false;
	const mediaType = value.split(";", 1)[0].trim().toLowerCase();
	return mediaType === "application/json" || mediaType.endsWith("+json");
}

async function pReadBoundedBody ({response, maxBytes}) {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new AuthProviderError();
	if (!response.body || typeof response.body.getReader !== "function") throw new AuthProviderError();

	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	try {
		while (true) {
			const {done, value} = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new AuthProviderError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8", {fatal: true}).decode(body);
}

export async function pFetchProviderJson ({
	fnFetch = fetch,
	url,
	options = {},
	maxBytes = OAUTH_PROVIDER_JSON_MAX_BYTES,
	timeoutMs = OAUTH_PROVIDER_HTTP_TIMEOUT_MS,
}) {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol !== "https:") throw new AuthProviderError();
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new AuthProviderError();
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new AuthProviderError();

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fnFetch(parsedUrl.href, {
				...options,
				redirect: "manual",
				signal: controller.signal,
			});
			if (
				!response
				|| response.status < 200
				|| response.status >= 300
				|| response.redirected
				|| !isJsonContentType(response.headers?.get?.("content-type"))
			) throw new AuthProviderError();

			const body = await pReadBoundedBody({response, maxBytes});
			const parsed = JSON.parse(body);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuthProviderError();
			return parsed;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		throw new AuthProviderError();
	}
}
