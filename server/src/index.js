import {createHubApp} from "./app.js";
import {createAuthProviderConfiguration} from "./auth-provider-config.js";
import {getClientIpHeader} from "./client-ip.js";
import {PostgresHubStore} from "./postgres-hub-store.js";
import {getSafeRequestLog, HUB_LOG_REDACT_PATHS} from "./observability.js";

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}.`);
	return value;
}

function getCsv (name) {
	return (process.env[name] || "")
		.split(",")
		.map(it => it.trim())
		.filter(Boolean);
}

function getTrustProxy () {
	const proxies = getCsv("HUB_TRUST_PROXY");
	return proxies.length ? proxies : false;
}

const clientIpHeader = getClientIpHeader(process.env.HUB_CLIENT_IP_HEADER);
const store = PostgresHubStore.fromConnectionString({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL !== "false",
});
await store.pCheckHealth();
const {authProviderRegistry, allowedOAuthSubjects} = createAuthProviderConfiguration({
	onConfigurationError: ({slug, code}) => {
		process.stderr.write(`Authentication provider ${slug} configuration failed (${code}).\n`);
	},
});
const app = await createHubApp({
	store,
	authProviderRegistry,
	logger: {
		level: process.env.HUB_LOG_LEVEL || "info",
		redact: {paths: [...HUB_LOG_REDACT_PATHS], censor: "[REDACTED]"},
		serializers: {req: request => getSafeRequestLog(request, {clientIpHeader})},
	},
	isStartOutboxDispatcher: true,
	config: {
		appOrigin: requireEnv("HUB_APP_ORIGIN"),
		cookieSecret: requireEnv("HUB_COOKIE_SECRET"),
		csrfSecret: requireEnv("HUB_CSRF_SECRET"),
		allowedOAuthSubjects,
		trustProxy: getTrustProxy(),
		metricsToken: requireEnv("HUB_METRICS_TOKEN"),
		clientIpHeader,
	},
});

const port = Number(process.env.HUB_PORT || 5052);
await app.listen({host: process.env.HUB_HOST || "127.0.0.1", port});

const pClose = async signal => {
	app.log.info({signal}, "Stopping campaign hub");
	await app.close();
	await store.pClose();
	process.exit(0);
};

process.once("SIGINT", () => void pClose("SIGINT"));
process.once("SIGTERM", () => void pClose("SIGTERM"));
