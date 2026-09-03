import {createHubApp, SESSION_COOKIE} from "../../../server/src/app.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";
import {
	getCsrfToken,
	getRandomToken,
	getSha256,
	isConstantTimeEqual,
} from "../../../server/src/security.js";

if (process.env.NODE_ENV !== "test" || process.env.HUB_TEST_AUTH_ENABLED !== "true") {
	throw new Error(`Hub test authentication can run only with NODE_ENV=test and HUB_TEST_AUTH_ENABLED=true.`);
}

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}.`);
	return value;
}

const appOrigin = requireEnv("HUB_APP_ORIGIN");
const cookieSecret = requireEnv("HUB_COOKIE_SECRET");
const csrfSecret = requireEnv("HUB_CSRF_SECRET");
const testAuthSecret = requireEnv("HUB_TEST_AUTH_SECRET");
const semanticOperationRegistry = createSemanticOperationRegistry({
	templates: [{
		sourceEntity: {type: "ability", uid: "steadying word|tst", version: "tst-v1"},
		effectTemplateId: "ability.steadying-word.heal",
		cost: "none",
		display: {label: "Steadying Word"},
		normalizeChoice: choice => {
			if (
				!choice
				|| Object.keys(choice).some(key => key !== "amount")
				|| !Number.isInteger(choice.amount)
				|| choice.amount < 1
				|| choice.amount > 10
			) throw new Error("Invalid Campaign Hub E2E effect choice.");
			return {amount: choice.amount};
		},
		deriveOperation: ({choice}) => ({kind: "hp.heal", arguments: {amount: choice.amount}}),
	}],
});
const store = PostgresHubStore.fromConnectionString({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL !== "false",
	semanticOperationRegistry,
});
await store.pCheckHealth();
const trustedProxies = (process.env.HUB_TRUST_PROXY || "").split(",").map(it => it.trim()).filter(Boolean);

const app = await createHubApp({
	store,
	oauthProvider: {getAuthorizationUrl: () => "", pExchangeCode: async () => { throw new Error("OAuth is disabled in the test BFF."); }},
	logger: false,
	isStartOutboxDispatcher: true,
	config: {
		appOrigin,
		cookieSecret,
		csrfSecret,
		allowedOAuthSubjects: [],
		trustProxy: trustedProxies.length ? trustedProxies : false,
		metricsToken: requireEnv("HUB_METRICS_TOKEN"),
	},
});

app.post("/auth/__test/session", {
	schema: {
		body: {
			type: "object",
			required: ["providerSubject", "displayName"],
			additionalProperties: false,
			properties: {
				providerSubject: {type: "string", minLength: 1, maxLength: 100},
				displayName: {type: "string", minLength: 1, maxLength: 100},
			},
		},
	},
}, async (request, reply) => {
	if (!isConstantTimeEqual(request.headers["x-hub-test-auth"], testAuthSecret)) {
		return reply.code(404).send({error: "NOT_FOUND"});
	}
	const account = await store.pUpsertOAuthAccount({
		provider: "hub-test",
		providerSubject: request.body.providerSubject,
		displayName: request.body.displayName,
	});
	const token = getRandomToken();
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: getSha256(token),
		expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		userAgent: request.headers["user-agent"] || "Hub E2E",
	});
	reply.setCookie(SESSION_COOKIE, token, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: true,
		signed: true,
		maxAge: 60 * 60,
	});
	return {
		signedIn: true,
		account,
		csrfToken: getCsrfToken({csrfSecret, sessionId: session.id}),
	};
});

await app.listen({
	host: process.env.HUB_HOST || "0.0.0.0",
	port: Number(process.env.HUB_PORT || 5052),
});

const pClose = async signal => {
	app.log.info({signal}, "Stopping Campaign Hub test BFF");
	await app.close();
	await store.pClose();
	process.exit(0);
};

process.once("SIGINT", () => void pClose("SIGINT"));
process.once("SIGTERM", () => void pClose("SIGTERM"));
