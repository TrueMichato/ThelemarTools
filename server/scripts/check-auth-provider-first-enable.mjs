import {pathToFileURL} from "node:url";

const REQUIRED_PROVIDERS = Object.freeze(["discord", "google"]);
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

class PreflightError extends Error {
	constructor (code) {
		super(code);
		this.code = code;
	}
}

function getExactOrigin (value) {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "https:" || parsed.origin !== value) throw new Error();
		return parsed.origin;
	} catch {
		throw new PreflightError("INVALID_APP_ORIGIN");
	}
}

async function pFetchBoundedText ({fnFetch, url, headers = {}}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fnFetch(url, {headers, redirect: "manual", signal: controller.signal});
		if (!response || response.status !== 200 || response.redirected) throw new PreflightError("REQUEST_FAILED");
		const contentLength = Number(response.headers?.get?.("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new PreflightError("REQUEST_FAILED");
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new PreflightError("REQUEST_FAILED");
		return text;
	} catch (error) {
		if (error instanceof PreflightError) throw error;
		throw new PreflightError("REQUEST_FAILED");
	} finally {
		clearTimeout(timer);
	}
}

async function pGetProviderStatuses ({fnFetch, appOrigin}) {
	const text = await pFetchBoundedText({fnFetch, url: `${appOrigin}/api/meta`});
	let metadata;
	try {
		metadata = JSON.parse(text);
	} catch {
		throw new PreflightError("INVALID_METADATA");
	}
	if (!Array.isArray(metadata?.authProviders)) throw new PreflightError("INVALID_METADATA");
	return new Map(metadata.authProviders.map(provider => [provider?.slug, provider?.status]));
}

async function pGetSuccessCounters ({fnFetch, appOrigin, metricsToken}) {
	const text = await pFetchBoundedText({
		fnFetch,
		url: `${appOrigin}/api/metrics`,
		headers: {authorization: `Bearer ${metricsToken}`},
	});
	const counters = new Map(REQUIRED_PROVIDERS.map(provider => [provider, 0]));
	for (const line of text.split("\n")) {
		const isRelevantMetric = /^hub_auth_outcomes_total\{provider="(?:discord|google)",outcome="succeeded"\}/.test(line.trim());
		const match = /^hub_auth_outcomes_total\{provider="(discord|google)",outcome="succeeded"\} ([0-9]+)$/.exec(line.trim());
		if (!match) {
			if (isRelevantMetric) throw new PreflightError("INVALID_METRICS");
			continue;
		}
		const count = Number(match[2]);
		if (!Number.isSafeInteger(count)) throw new PreflightError("INVALID_METRICS");
		counters.set(match[1], count);
	}
	return counters;
}

export async function pCheckAuthProviderFirstEnable ({
	appOrigin: rawAppOrigin,
	metricsToken,
	fnFetch = fetch,
	timeoutMs = 10 * 60_000,
	pollIntervalMs = 2_000,
	fnWrite = value => process.stdout.write(value),
	fnSleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
	const appOrigin = getExactOrigin(rawAppOrigin);
	if (typeof metricsToken !== "string" || metricsToken.length < 32) throw new PreflightError("INVALID_METRICS_TOKEN");
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new PreflightError("INVALID_TIMEOUT");
	if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) throw new PreflightError("INVALID_POLL_INTERVAL");

	const statuses = await pGetProviderStatuses({fnFetch, appOrigin});
	if (REQUIRED_PROVIDERS.some(provider => statuses.get(provider) !== "available")) {
		throw new PreflightError("PROVIDERS_NOT_AVAILABLE");
	}
	const baseline = await pGetSuccessCounters({fnFetch, appOrigin, metricsToken});
	fnWrite(`Complete both staging sign-ins after this baseline:\n`);
	for (const provider of REQUIRED_PROVIDERS) {
		fnWrite(`${provider}: ${appOrigin}/auth/${provider}/start?returnTo=%2Fhub.html\n`);
	}

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await fnSleep(pollIntervalMs);
		const currentStatuses = await pGetProviderStatuses({fnFetch, appOrigin});
		if (REQUIRED_PROVIDERS.some(provider => currentStatuses.get(provider) !== "available")) {
			throw new PreflightError("PROVIDER_BECAME_UNAVAILABLE");
		}
		const current = await pGetSuccessCounters({fnFetch, appOrigin, metricsToken});
		if (REQUIRED_PROVIDERS.some(provider => current.get(provider) < baseline.get(provider))) {
			throw new PreflightError("METRICS_RESET");
		}
		if (REQUIRED_PROVIDERS.every(provider => current.get(provider) > baseline.get(provider))) {
			fnWrite(`Paired provider first-enable preflight passed.\n`);
			return {ok: true};
		}
	}
	throw new PreflightError("PREFLIGHT_TIMEOUT");
}

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new PreflightError(`MISSING_${name}`);
	return value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await pCheckAuthProviderFirstEnable({
			appOrigin: requireEnv("HUB_APP_ORIGIN"),
			metricsToken: requireEnv("HUB_METRICS_TOKEN"),
			timeoutMs: Number(process.env.HUB_AUTH_FIRST_ENABLE_TIMEOUT_MS || 10 * 60_000),
		});
	} catch (error) {
		process.stderr.write(`Authentication provider first-enable preflight failed (${error?.code || "PREFLIGHT_FAILED"}).\n`);
		process.exitCode = 2;
	}
}
