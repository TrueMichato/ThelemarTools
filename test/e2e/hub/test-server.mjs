import {createHubApp, SESSION_COOKIE} from "../../../server/src/app.js";
import {AuthProviderRegistry} from "../../../server/src/auth-provider-registry.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";
import {
	getCsrfToken,
	getPkceChallenge,
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
const deterministicProviderDefinitions = Object.freeze([
	{slug: "github", label: "GitHub", subject: "101", pkce: "S256", oidcNonce: false},
	{slug: "discord", label: "Discord", subject: "202", pkce: false, oidcNonce: false},
	{slug: "google", label: "Google", subject: "google-e2e-303", pkce: "S256", oidcNonce: true},
]);
const pendingCodes = new Map();
const deterministicProviders = deterministicProviderDefinitions.map(definition => ({
	slug: definition.slug,
	label: definition.label,
	startPath: `/auth/${definition.slug}/start`,
	callbackPath: `/auth/${definition.slug}/callback`,
	capabilities: {pkce: definition.pkce, oidcNonce: definition.oidcNonce},
	getAuthorizationUrl: ({state, codeChallenge, nonce, redirectUri}) => {
		const code = `hub-e2e-${definition.slug}-code-${getRandomToken(8)}`;
		pendingCodes.set(code, {codeChallenge, nonce, redirectUri});
		const url = new URL(`/auth/__test/${definition.slug}/authorize`, appOrigin);
		url.searchParams.set("state", state);
		url.searchParams.set("code", code);
		url.searchParams.set("redirect_uri", redirectUri);
		if (codeChallenge) url.searchParams.set("code_challenge", codeChallenge);
		if (nonce) url.searchParams.set("nonce", nonce);
		return url.href;
	},
	pExchangeCodeForIdentity: async ({code, codeVerifier, nonce, redirectUri}) => {
		const pending = pendingCodes.get(code);
		pendingCodes.delete(code);
		if (
			!pending
			|| pending.redirectUri !== redirectUri
			|| redirectUri !== `${appOrigin}/auth/${definition.slug}/callback`
			|| (definition.pkce === "S256" && getPkceChallenge(codeVerifier) !== pending.codeChallenge)
			|| (definition.pkce === false && (codeVerifier != null || pending.codeChallenge != null))
			|| (definition.oidcNonce && (nonce !== pending.nonce || !nonce))
			|| (!definition.oidcNonce && (nonce != null || pending.nonce != null))
		) throw new Error("Invalid deterministic provider exchange.");
		return {
			provider: definition.slug,
			subject: definition.subject,
			handle: definition.slug === "google" ? null : `hub-e2e-${definition.slug}`,
			displayName: `Hub E2E ${definition.label}`,
		};
	},
}));
const authProviderRegistry = new AuthProviderRegistry({
	registrations: deterministicProviders.map(provider => ({status: "available", provider})),
});

const app = await createHubApp({
	store,
	authProviderRegistry,
	logger: false,
	isStartOutboxDispatcher: true,
	config: {
		appOrigin,
		cookieSecret,
		csrfSecret,
		allowedOAuthSubjects: requireEnv("HUB_ALLOWED_OAUTH_SUBJECTS").split(",").map(it => it.trim()).filter(Boolean),
		trustProxy: trustedProxies.length ? trustedProxies : false,
		metricsToken: requireEnv("HUB_METRICS_TOKEN"),
	},
});

for (const definition of deterministicProviderDefinitions) {
	app.get(`/auth/__test/${definition.slug}/authorize`, {
		schema: {
			querystring: {
				type: "object",
				required: [
					"state",
					"code",
					"redirect_uri",
					...(definition.pkce ? ["code_challenge"] : []),
					...(definition.oidcNonce ? ["nonce"] : []),
				],
				additionalProperties: false,
				properties: {
					state: {type: "string", minLength: 1, maxLength: 512},
					code: {type: "string", minLength: 1, maxLength: 200},
					redirect_uri: {type: "string", const: `${appOrigin}/auth/${definition.slug}/callback`},
					...(definition.pkce ? {code_challenge: {type: "string", minLength: 43, maxLength: 128}} : {}),
					...(definition.oidcNonce ? {nonce: {type: "string", minLength: 32, maxLength: 512}} : {}),
				},
			},
		},
	}, async (request, reply) => {
		const callback = new URL(request.query.redirect_uri);
		callback.searchParams.set("code", request.query.code);
		callback.searchParams.set("state", request.query.state);
		return reply.redirect(callback.href);
	});
}

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
