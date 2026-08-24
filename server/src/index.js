import {createHubApp} from "./app.js";
import {GitHubOAuthProvider} from "./github-oauth-provider.js";
import {PostgresHubStore} from "./postgres-hub-store.js";

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

const store = PostgresHubStore.fromConnectionString({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL !== "false",
});
await store.pCheckHealth();
const oauthProvider = new GitHubOAuthProvider({
	clientId: requireEnv("GITHUB_CLIENT_ID"),
	clientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
});
const app = await createHubApp({
	store,
	oauthProvider,
	logger: true,
	isStartOutboxDispatcher: true,
	config: {
		appOrigin: requireEnv("HUB_APP_ORIGIN"),
		cookieSecret: requireEnv("HUB_COOKIE_SECRET"),
		csrfSecret: requireEnv("HUB_CSRF_SECRET"),
		allowedOAuthSubjects: getCsv("HUB_ALLOWED_OAUTH_SUBJECTS"),
		trustProxy: getTrustProxy(),
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
