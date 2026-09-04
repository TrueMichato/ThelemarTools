import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import {
	getCsrfToken,
	getDeterministicToken,
	getPkceChallenge,
	getRandomToken,
	getSha256,
	isConstantTimeEqual,
} from "./security.js";
import {HubStoreError} from "./hub-store-error.js";
import {AuthProviderError} from "./auth-provider-error.js";
import {
	AUTH_PROVIDER_REGISTRY_CAPABILITY,
	getLegacyGitHubAuthProviderRegistry,
} from "./auth-provider-registry.js";
import {PROJECTION_POLICY_VERSION, PROJECTION_PRESET_KEYS} from "./character-projection.js";
import {
	CAMPAIGN_RULES_SCHEMA_VERSION,
	getCampaignBrewHash,
	normalizeCampaignRules,
	normalizeCampaignRulesPolicyForStorage,
	validateCampaignBrewBundle,
} from "./campaign-content.js";
import {
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	getPublicCampaignRulesCatalog,
} from "../../js/hub/hub-campaign-rules.js";
import {HubOutboxDispatcher, HubRealtime} from "./realtime.js";
import {getSafeRequestId, HubMetrics} from "./observability.js";
import {getClientIpHeader, getRequestClientIp} from "./client-ip.js";
import {SAFE_ITEM_SUMMARY_FIELDS} from "./hub-actions.js";
import {ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY} from "./hub-capabilities.js";
import crypto from "node:crypto";

const {normalizeIP} = rateLimit;
const SESSION_COOKIE = "__Host-hub_session";
const OAUTH_COOKIE = "__Host-hub_oauth";
const HUB_PROTOCOL_VERSION = "3";
const SAFE_ITEM_SUMMARY_KEYS = new Set(SAFE_ITEM_SUMMARY_FIELDS);
const getSafeItemSummarySchema = () => ({
	type: "object",
	required: ["name", "source"],
	additionalProperties: false,
	properties: {
		name: {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"},
		source: {type: "string", minLength: 1, maxLength: 50, pattern: "\\S"},
		page: {type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		rarity: {type: "string", maxLength: 80},
		weight: {type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		value: {type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		typeCode: {type: "string", maxLength: 80},
		edition: {type: "string", enum: ["classic", "one"]},
	},
});
const DEFAULT_DM_WORKSPACE = {
	mv: 0,
	w: 3,
	h: 3,
	ctc: false,
	fs: false,
	lk: false,
	sla: "1",
	sls: {"1": {ps: [], ex: []}},
};

function getCookieOptions ({isSecure, maxAge}) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure,
		signed: true,
		maxAge,
	};
}

function getClearCookieOptions ({isSecure}) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure,
	};
}

function getSignedCookie (request, name) {
	const raw = request.cookies[name];
	if (!raw) return null;
	const unsigned = request.unsignCookie(raw);
	return unsigned.valid ? unsigned.value : null;
}

function validateConfig (config) {
	if (!config?.appOrigin) throw new TypeError(`config.appOrigin is required.`);
	if (!config?.cookieSecret || config.cookieSecret.length < 32) throw new TypeError(`config.cookieSecret must be at least 32 characters.`);
	if (!config?.csrfSecret || config.csrfSecret.length < 32) throw new TypeError(`config.csrfSecret must be at least 32 characters.`);
	if (config.metricsToken != null && config.metricsToken.length < 32) throw new TypeError(`config.metricsToken must be at least 32 characters.`);
	const parsedAppOrigin = new URL(config.appOrigin);
	const appOrigin = parsedAppOrigin.origin;
	if (config.appOrigin !== appOrigin) throw new TypeError(`config.appOrigin must be an exact origin.`);
	if (parsedAppOrigin.protocol !== "https:") throw new TypeError(`config.appOrigin must use HTTPS.`);
	const clientIpHeader = getClientIpHeader(config.clientIpHeader);
	if (clientIpHeader && config.trustProxy) {
		throw new TypeError(`clientIpHeader and trustProxy cannot be enabled together.`);
	}
	return {
		sessionTtlSeconds: 60 * 60 * 24 * 30,
		oauthStateTtlSeconds: 10 * 60,
		isSecure: new URL(appOrigin).protocol === "https:",
		allowedOAuthSubjects: [],
		trustProxy: false,
		metricsToken: null,
		...config,
		appOrigin,
		clientIpHeader,
	};
}

function getSafeReturnTo ({rawReturnTo, appOrigin}) {
	if (typeof rawReturnTo !== "string") return "/hub.html";
	try {
		const url = new URL(rawReturnTo, appOrigin);
		if (url.origin !== appOrigin) return "/hub.html";
		if (url.pathname.startsWith("//")) return "/hub.html";
		const returnTo = `${url.pathname}${url.search}${url.hash}`;
		return returnTo.length <= 2_048 ? returnTo : "/hub.html";
	} catch {
		return "/hub.html";
	}
}

export async function createHubApp ({
	store,
	authProviderRegistry = null,
	oauthProvider = null,
	config: rawConfig,
	logger = false,
	realtime: realtimeOverride = null,
	isStartOutboxDispatcher = false,
	metrics: metricsOverride = null,
}) {
	if (!store) throw new TypeError(`store is required.`);
	if (authProviderRegistry && oauthProvider) throw new TypeError(`Provide authProviderRegistry or oauthProvider, not both.`);
	const providerRegistry = authProviderRegistry || getLegacyGitHubAuthProviderRegistry(oauthProvider);
	const config = validateConfig(rawConfig);
	const metrics = metricsOverride || new HubMetrics();
	const app = Fastify({
		logger,
		trustProxy: config.trustProxy,
		bodyLimit: 2 * 1024 * 1024,
		genReqId: request => getSafeRequestId(request) || crypto.randomUUID(),
	});
	await app.register(cookie, {secret: config.cookieSecret});
	let realtime;
	await app.register(websocket, {
		options: {maxPayload: 16 * 1024},
		preClose: async function () {
			realtime?.stop?.();
			const sockets = [...this.websocketServer.clients];
			const closePromises = sockets.map(socket => new Promise(resolve => {
				if (socket.readyState === 3) return resolve();
				socket.once("close", resolve);
				if (socket.readyState === 1) socket.close(1001, "Server shutdown");
			}));
			let timeout;
			await Promise.race([
				Promise.all(closePromises),
				new Promise(resolve => {
					timeout = setTimeout(resolve, 1_000);
					timeout.unref?.();
				}),
			]);
			if (timeout) clearTimeout(timeout);
			for (const socket of sockets) {
				if (socket.readyState !== 3) socket.terminate();
			}
			await new Promise((resolve, reject) => {
				this.websocketServer.close(error => error ? reject(error) : resolve());
			});
		},
	});
	await app.register(rateLimit, {
		global: false,
		max: 30,
		timeWindow: "1 minute",
		keyGenerator: request => normalizeIP(getRequestClientIp({
			request,
			clientIpHeader: config.clientIpHeader,
		})),
	});
	app.decorateRequest("hubClientIp", null);
	app.addHook("onSend", async (request, reply, payload) => {
		reply.header("x-request-id", request.id);
		reply.header("x-content-type-options", "nosniff");
		reply.header("x-frame-options", "DENY");
		reply.header("referrer-policy", "same-origin");
		reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
		if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
			reply.header("cache-control", "no-store");
		}
		return payload;
	});
	app.addHook("onRequest", async request => {
		request.hubRequestStartedAt = performance.now();
		request.hubClientIp = getRequestClientIp({request, clientIpHeader: config.clientIpHeader});
	});
	app.addHook("onResponse", async (request, reply) => {
		metrics.observeRequest({
			method: request.method,
			route: request.routeOptions?.url || "unknown",
			statusCode: reply.statusCode,
			durationMs: performance.now() - request.hubRequestStartedAt,
		});
	});

	app.decorateRequest("hubAuth", null);
	app.decorateRequest("hubRequestStartedAt", 0);
	app.addHook("preValidation", async request => {
		const values = [
			...Object.entries(request.params || {}).filter(([key]) => key.endsWith("Id")),
			...Object.entries(request.query || {}).filter(([key]) => key.endsWith("Id")),
		];
		for (const [, value] of values) {
			if (value == null) continue;
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(`${value}`)) {
				throw new HubStoreError("INVALID_ID", `Invalid identifier.`);
			}
		}
	});
	realtime = realtimeOverride || new HubRealtime({store});
	const outboxDispatcher = new HubOutboxDispatcher({store, realtime});
	app.decorate("hubRealtime", realtime);
	app.decorate("hubOutboxDispatcher", outboxDispatcher);
	app.decorate("hubMetrics", metrics);
	if (isStartOutboxDispatcher) outboxDispatcher.start();
	app.addHook("onClose", async () => {
		outboxDispatcher.stop();
	});
	app.setErrorHandler((error, request, reply) => {
		if (error instanceof AuthProviderError) {
			return reply.code(error.status).send({error: error.code});
		}
		if (error instanceof HubStoreError) {
			return reply.code(error.status).send({
				error: error.code,
				...(error.details == null ? {} : {details: error.details}),
			});
		}
		if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
			return reply.code(413).send({error: "PAYLOAD_TOO_LARGE"});
		}
		if (error.validation) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
			return reply.code(error.statusCode).send({error: error.code || "REQUEST_REJECTED"});
		}
		request.log.error(error);
		return reply.code(500).send({error: "INTERNAL_ERROR"});
	});

	const pGetAuth = async request => {
		if (request.hubAuth) return request.hubAuth;
		const token = getSignedCookie(request, SESSION_COOKIE);
		if (!token) return null;
		request.hubAuth = await store.pGetSessionByTokenHash({tokenHash: getSha256(token)});
		return request.hubAuth;
	};

	const deletionPendingAllowedPaths = new Set([
		"/api/live",
		"/api/ready",
		"/api/metrics",
		"/api/session",
		"/api/account/export",
		"/api/account/deletion",
		"/api/account/deletion/request",
		"/api/account/deletion/cancel",
		"/api/logout",
		"/api/health",
		"/api/meta",
	]);
	app.addHook("preHandler", async (request, reply) => {
		const pathname = request.url.split("?")[0];
		if (["/api/live", "/api/ready", "/api/health", "/api/meta", "/api/metrics"].includes(pathname) || pathname.startsWith("/auth/")) return;
		const auth = await pGetAuth(request);
		if (auth?.account.status !== "deletion_requested") return;
		if (deletionPendingAllowedPaths.has(pathname)) return;
		return reply.code(423).send({error: "ACCOUNT_DELETION_PENDING"});
	});

	const requireAuth = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (auth) return;
		return reply.code(401).send({error: "AUTH_REQUIRED"});
	};

	/**
	 * Reads whose response shape is an ADR 0011 authorization envelope. An older client
	 * would misread these silently rather than failing, so they are version-gated exactly
	 * like mutations.
	 */
	const requireProtocolVersion = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (request.headers["x-hub-protocol-version"] !== HUB_PROTOCOL_VERSION) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
	};

	const requireMutationSecurity = async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		const expected = getCsrfToken({csrfSecret: config.csrfSecret, sessionId: auth.session.id});
		if (!isConstantTimeEqual(request.headers["x-csrf-token"], expected)) {
			return reply.code(403).send({error: "INVALID_CSRF"});
		}
		if (request.headers["x-hub-protocol-version"] !== HUB_PROTOCOL_VERSION) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
	};
	const hasOnlyKeys = (value, allowedKeys) => (
		!!value
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& Object.keys(value).every(key => allowedKeys.has(key))
	);
	const hasStrictSafeItemTypes = item => (
		typeof item.name === "string"
		&& typeof item.source === "string"
		&& (item.page === undefined || (typeof item.page === "number" && Number.isSafeInteger(item.page)))
		&& (item.rarity === undefined || typeof item.rarity === "string")
		&& (item.weight === undefined || (typeof item.weight === "number" && Number.isFinite(item.weight)))
		&& (item.value === undefined || (typeof item.value === "number" && Number.isFinite(item.value)))
		&& (item.typeCode === undefined || typeof item.typeCode === "string")
		&& (item.edition === undefined || typeof item.edition === "string")
	);
	const rejectUnknownAwardFields = async (request, reply) => {
		const body = request.body;
		if (
			!hasOnlyKeys(body, new Set(["source", "targetCharacterIds", "quantity", "note"]))
			|| !Array.isArray(body.targetCharacterIds)
			|| body.targetCharacterIds.some(id => typeof id !== "string")
			|| !Number.isSafeInteger(body.quantity)
			|| (body.note !== undefined && body.note !== null && typeof body.note !== "string")
		) {
			return reply.code(400).send({error: "INVALID_REQUEST"});
		}
		const source = body.source;
		const sourceKeys = source?.kind === "party_inventory"
			? new Set(["kind", "entryId"])
			: new Set(["kind", "item"]);
		if (!hasOnlyKeys(source, sourceKeys)) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (
			typeof source.kind !== "string"
			|| (source.kind === "party_inventory" && typeof source.entryId !== "string")
			|| (
				source.kind !== "party_inventory"
				&& (
					!hasOnlyKeys(source.item, SAFE_ITEM_SUMMARY_KEYS)
					|| !hasStrictSafeItemTypes(source.item)
				)
			)
		) {
			return reply.code(400).send({error: "INVALID_REQUEST"});
		}
	};
	const rejectUnknownLegacyItemGrantFields = async (request, reply) => {
		if (
			!hasOnlyKeys(request.body, new Set(["item", "quantity"]))
			|| !hasOnlyKeys(request.body?.item, SAFE_ITEM_SUMMARY_KEYS)
			|| !hasStrictSafeItemTypes(request.body.item)
			|| (request.body.quantity !== undefined && !Number.isSafeInteger(request.body.quantity))
		) return reply.code(400).send({error: "INVALID_REQUEST"});
	};

	const getIdempotencyKey = request => {
		const idempotencyKey = request.headers["idempotency-key"];
		if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200) {
			throw new HubStoreError("IDEMPOTENCY_KEY_REQUIRED", `A valid idempotency key is required.`);
		}
		const body = request.body && typeof request.body === "object"
			? Object.fromEntries(Object.entries(request.body).filter(([key]) => !["baseRevision", "leaseEpoch"].includes(key)))
			: request.body || null;
		return {
			key: idempotencyKey,
			requestHash: getSha256(JSON.stringify({
				method: request.method,
				route: request.routeOptions?.url || request.url,
				params: request.params || {},
				query: request.query || {},
				body,
			})),
		};
	};
	const getSemanticCommand = request => {
		const idempotencyKey = getIdempotencyKey(request);
		if (idempotencyKey.key !== request.body.commandId) {
			throw new HubStoreError("IDEMPOTENCY_KEY_MISMATCH", `Command ID must match the idempotency key.`);
		}
		return {
			commandId: request.body.commandId,
			requestHash: idempotencyKey.requestHash,
		};
	};

	const requireCampaignRole = roles => async (request, reply) => {
		const membership = await store.pGetMembership({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});
		if (!membership) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		if (!roles.includes(membership.role)) return reply.code(403).send({error: "FORBIDDEN"});
		request.hubMembership = membership;
	};

	const requireWebSocketMembership = async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (auth.account.status !== "active") return reply.code(423).send({error: "ACCOUNT_DELETION_PENDING"});
		const membership = await store.pGetMembership({
			accountId: auth.account.id,
			campaignId: request.params.campaignId,
		});
		if (!membership) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		request.hubMembership = membership;
	};

	app.get("/api/live", async () => ({ok: true}));

	const pHandleReadiness = async (request, reply) => {
		try {
			await store.pCheckHealth();
			return {ok: true};
		} catch {
			return reply.code(503).send({ok: false, error: "DATABASE_UNAVAILABLE"});
		}
	};
	app.get("/api/ready", pHandleReadiness);
	app.get("/api/health", pHandleReadiness);

	app.get("/api/metrics", async (request, reply) => {
		if (!config.metricsToken) return reply.code(404).send({error: "NOT_FOUND"});
		const authorization = request.headers.authorization;
		const supplied = typeof authorization === "string" && authorization.startsWith("Bearer ")
			? authorization.slice(7)
			: null;
		if (!isConstantTimeEqual(supplied, config.metricsToken)) return reply.code(401).send({error: "AUTH_REQUIRED"});
		const operational = await store.pGetOperationalMetrics();
		reply.type("text/plain; version=0.0.4; charset=utf-8");
		return metrics.toPrometheus({
			operational,
			websocketConnections: realtime.getConnectionCount(),
			dispatcher: outboxDispatcher.getStatus(),
		});
	});

	app.get("/api/meta", async () => ({
		protocolVersion: HUB_PROTOCOL_VERSION,
		appVersion: process.env.npm_package_version || null,
		capabilities: [
			AUTH_PROVIDER_REGISTRY_CAPABILITY,
			ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY,
			...(config.isCampaignRulesPolicyEnabled ? [CAMPAIGN_RULES_POLICY_CAPABILITY] : []),
		],
		authProviders: providerRegistry.getPublicMetadata(),
	}));

	app.get("/ws/campaign/:campaignId", {
		websocket: true,
		preValidation: requireWebSocketMembership,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			querystring: {
				type: "object",
				required: ["v"],
				additionalProperties: false,
				properties: {v: {type: "string", enum: [HUB_PROTOCOL_VERSION]}},
			},
		},
	}, (socket, request) => {
		realtime.addConnection({
			socket,
			account: request.hubAuth.account,
			session: request.hubAuth.session,
			membership: request.hubMembership,
			campaignId: request.params.campaignId,
			clientIp: request.hubClientIp,
		});
	});

	for (const provider of providerRegistry.getAvailableProviders()) {
		app.get(provider.startPath, {
			config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
			schema: {
				querystring: {
					type: "object",
					additionalProperties: false,
					properties: {returnTo: {type: "string", minLength: 1, maxLength: 2_048}},
				},
			},
		}, async (request, reply) => {
			const state = getRandomToken();
			const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
			const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			const returnTo = getSafeReturnTo({
				rawReturnTo: request.query?.returnTo,
				appOrigin: config.appOrigin,
			});
			const authorizationUrl = provider.getAuthorizationUrl({
				state,
				codeChallenge: pkceVerifier == null ? null : getPkceChallenge(pkceVerifier),
				nonce: oidcNonce,
				redirectUri,
			});
			const transactionId = crypto.randomUUID();
			await store.pCreateOAuthTransaction({
				id: transactionId,
				stateHash: getSha256(state),
				provider: provider.slug,
				operation: "sign_in",
				redirectUri,
				returnTo,
				pkceVerifier,
				oidcNonce,
				ttlSeconds: config.oauthStateTtlSeconds,
			});
			reply.setCookie(OAUTH_COOKIE, transactionId, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.oauthStateTtlSeconds,
			}));
			metrics.observeAuth?.({provider: provider.slug, outcome: "started"});
			return reply.redirect(authorizationUrl);
		});

		app.get(provider.callbackPath, {
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				querystring: {
					type: "object",
					additionalProperties: true,
					properties: {
						code: {type: "string", minLength: 1, maxLength: 2_048},
						state: {type: "string", minLength: 1, maxLength: 512},
						error: {type: "string", maxLength: 200},
					},
				},
			},
		}, async (request, reply) => {
			const transactionId = getSignedCookie(request, OAUTH_COOKIE);
			reply.clearCookie(OAUTH_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
			if (!transactionId || typeof request.query?.state !== "string") {
				metrics.observeAuth?.({provider: provider.slug, outcome: "invalid_state"});
				return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
			}
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			let transaction;
			try {
				transaction = await store.pConsumeOAuthTransaction({
					id: transactionId,
					stateHash: getSha256(request.query.state),
					provider: provider.slug,
					operation: "sign_in",
					redirectUri,
				});
			} catch (error) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "invalid_state"});
				throw error;
			}
			if (typeof request.query.code !== "string" || request.query.error) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "provider_cancelled"});
				return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
			}

			let identity;
			try {
				identity = await provider.pExchangeCodeForIdentity({
					code: request.query.code,
					codeVerifier: transaction.pkceVerifier,
					nonce: transaction.oidcNonce,
					redirectUri,
				});
			} catch (error) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "provider_error"});
				if (error instanceof AuthProviderError) throw error;
				throw new AuthProviderError();
			}
			const isAllowed = config.allowedOAuthSubjects.includes(`${identity.provider}:${identity.subject}`);
			if (!isAllowed) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "not_allowed"});
				return reply.code(403).send({error: "ACCOUNT_NOT_ALLOWED"});
			}

			const priorAuth = await pGetAuth(request);
			const token = getRandomToken();
			const completed = await store.pCompleteOAuthSignIn({
				identity,
				tokenHash: getSha256(token),
				expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
				userAgent: request.headers["user-agent"] || null,
				priorSessionId: priorAuth?.session.id || null,
			});
			completed.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
			reply.setCookie(SESSION_COOKIE, token, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.sessionTtlSeconds,
			}));
			metrics.observeAuth?.({provider: provider.slug, outcome: "succeeded"});
			return reply.redirect(transaction.returnTo);
		});
	}

	app.get("/api/session", async request => {
		const auth = await pGetAuth(request);
		if (!auth) return {signedIn: false};
		return {
			signedIn: true,
			account: {
				id: auth.account.id,
				displayName: auth.account.displayName,
				status: auth.account.status,
				deletionRequestedAt: auth.account.deletionRequestedAt,
				purgeAfter: auth.account.purgeAfter,
			},
			csrfToken: getCsrfToken({csrfSecret: config.csrfSecret, sessionId: auth.session.id}),
			capabilities: [ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY],
		};
	});

	app.get("/api/account/export", {preHandler: requireAuth}, async (request, reply) => {
		const exported = await store.pExportAccountData({accountId: request.hubAuth.account.id});
		reply.header("cache-control", "no-store");
		reply.header("content-disposition", `attachment; filename="campaign-hub-export.json"`);
		return exported;
	});

	app.get("/api/account/sessions", {preHandler: requireAuth}, async request => ({
		sessions: await store.pListSessions({
			accountId: request.hubAuth.account.id,
			currentSessionId: request.hubAuth.session.id,
		}),
	}));

	app.post("/api/account/sessions/:sessionId/revoke", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["sessionId"],
				additionalProperties: false,
				properties: {sessionId: {type: "string", format: "uuid"}},
			},
		},
	}, async (request, reply) => {
		const response = await store.pRevokeAccountSession({
			accountId: request.hubAuth.account.id,
			sessionId: request.params.sessionId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeSession({sessionId: request.params.sessionId});
		if (request.params.sessionId === request.hubAuth.session.id) reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return response;
	});

	app.post("/api/account/sessions/revoke-others", {preHandler: requireMutationSecurity}, async request => {
		const response = await store.pRevokeOtherSessions({
			accountId: request.hubAuth.account.id,
			currentSessionId: request.hubAuth.session.id,
			idempotencyKey: getIdempotencyKey(request),
		});
		response.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
		return response;
	});

	app.get("/api/account/deletion", {preHandler: requireAuth}, async request => ({
		deletion: await store.pGetAccountDeletion({accountId: request.hubAuth.account.id}),
	}));

	app.post("/api/account/deletion/request", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["confirmation"],
				additionalProperties: false,
				properties: {confirmation: {type: "string", const: "DELETE"}},
			},
		},
	}, async (request, reply) => {
		const response = await store.pRequestAccountDeletion({
			accountId: request.hubAuth.account.id,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: request.hubAuth.account.id, reason: "Account deletion requested"});
		reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return response;
	});

	app.post("/api/account/deletion/cancel", {preHandler: requireMutationSecurity}, async request => store.pCancelAccountDeletion({
		accountId: request.hubAuth.account.id,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/logout", {preHandler: requireMutationSecurity}, async (request, reply) => {
		await store.pRevokeSession({sessionId: request.hubAuth.session.id});
		realtime.closeSession({sessionId: request.hubAuth.session.id});
		reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return {ok: true};
	});

	app.get("/api/campaigns", {preHandler: requireAuth}, async request => ({
		campaigns: await store.pListCampaigns({accountId: request.hubAuth.account.id}),
	}));

	app.get("/api/campaigns/:campaignId", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				additionalProperties: false,
				required: ["campaignId"],
				properties: {
					campaignId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async (request, reply) => {
		const campaign = await store.pGetCampaign({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});

		if (!campaign) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		return {campaign};
	});

	app.post("/api/campaigns/:campaignId/archive", {
		preHandler: requireMutationSecurity,
	}, async request => store.pArchiveCampaign({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/transfer-ownership", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["targetAccountId"],
				additionalProperties: false,
				properties: {targetAccountId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pTransferCampaignOwnership({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		targetAccountId: request.body.targetAccountId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/members", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				additionalProperties: false,
				required: ["campaignId"],
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		members: await store.pListMembers({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.patch("/api/campaigns/:campaignId/members/:membershipId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "membershipId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					membershipId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				required: ["role"],
				additionalProperties: false,
				properties: {role: {type: "string", enum: ["co_dm", "player", "spectator"]}},
			},
		},
	}, async request => store.pChangeMemberRole({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		membershipId: request.params.membershipId,
		role: request.body.role,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.delete("/api/campaigns/:campaignId/members/:membershipId", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "membershipId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					membershipId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => {
		const response = await store.pRemoveMember({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			membershipId: request.params.membershipId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: response.removedAccountId, campaignId: request.params.campaignId, reason: "Membership removed"});
		return response;
	});

	app.post("/api/campaigns/:campaignId/leave", {preHandler: requireMutationSecurity}, async request => {
		const response = await store.pLeaveCampaign({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: request.hubAuth.account.id, campaignId: request.params.campaignId, reason: "Membership left"});
		return response;
	});

	app.get("/api/campaigns/:campaignId/context", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		context: await store.pGetCampaignContext({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/compatibility", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		compatibility: await store.pGetCampaignCompatibility({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/character-projections", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pListCampaignCharacterProjections({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
	}));

	app.get("/api/campaigns/:campaignId/snapshot", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		snapshot: await store.pGetCampaignSnapshot({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/events", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			querystring: {
				type: "object",
				additionalProperties: false,
				properties: {
					afterSequence: {type: "integer", minimum: 0, default: 0},
					limit: {type: "integer", minimum: 1, maximum: 500, default: 200},
				},
			},
		},
	}, async request => store.pListVisibleEventPage({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		afterSequence: request.query.afterSequence,
		limit: request.query.limit,
	}));

	app.post("/api/campaigns/:campaignId/rolls", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["formula", "total", "visibility"],
				additionalProperties: false,
				properties: {
					characterId: {type: ["string", "null"], format: "uuid"},
					formula: {type: "string", minLength: 1, maxLength: 200},
					total: {type: "number"},
					context: {type: "string", maxLength: 100},
					visibility: {type: "string", enum: ["all_members", "dm_only", "actor_and_dm"]},
					detail: {type: "object"},
				},
			},
		},
	}, async request => store.pLogRoll({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.body.characterId || null,
		visibility: request.body.visibility,
		payload: {
			formula: request.body.formula,
			total: request.body.total,
			context: request.body.context || null,
			detail: request.body.detail || {},
		},
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/actions", {
		preHandler: requireProtocolVersion,
	}, async request => ({
		actions: await store.pListPendingActions({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/characters/:characterId/pending-actions", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "characterId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					characterId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => ({
		actions: await store.pListCharacterPendingActions({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			characterId: request.params.characterId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/actions", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				additionalProperties: false,
				properties: {
					commandId: {type: "string", format: "uuid"},
					targetCharacterId: {type: "string", format: "uuid"},
					operation: {
						type: "object",
						required: ["kind", "version", "arguments"],
						additionalProperties: false,
						properties: {
							kind: {type: "string", enum: ["hp.damage", "hp.heal", "condition.add", "condition.remove", "spell_slot.spend", "spell_slot.restore"]},
							version: {type: "integer", const: 1},
							arguments: {
								type: "object",
								additionalProperties: false,
								properties: {
									amount: {type: "number", exclusiveMinimum: 0},
									condition: {
										type: "object",
										required: ["name", "source"],
										additionalProperties: false,
										properties: {
											name: {type: "string", minLength: 1, maxLength: 100},
											source: {type: "string", minLength: 1, maxLength: 20},
										},
									},
									level: {type: "integer", minimum: 1, maximum: 9},
								},
							},
						},
					},
					sourceCharacterId: {type: "string", format: "uuid"},
					sourceEntity: {
						type: "object",
						required: ["type", "uid", "version"],
						additionalProperties: false,
						properties: {
							type: {type: "string", enum: ["spell", "ability"]},
							uid: {type: "string", minLength: 1, maxLength: 200},
							version: {type: "string", minLength: 1, maxLength: 80},
						},
					},
					effectTemplateId: {type: "string", minLength: 1, maxLength: 100},
					choice: {
						type: "object",
						additionalProperties: false,
						maxProperties: 10,
						properties: {
							amount: {type: "integer", minimum: 1, maximum: 10},
						},
					},
					targetRef: {type: "string", format: "uuid"},
				},
				oneOf: [
					{required: ["commandId", "targetCharacterId", "operation"]},
					{required: ["commandId", "sourceCharacterId", "sourceEntity", "effectTemplateId", "choice", "targetRef"]},
				],
			},
		},
	}, async (request, reply) => {
		const command = getSemanticCommand(request);
		const created = await store.pCreateStructuredAction({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			targetCharacterId: request.body.targetCharacterId,
			operation: request.body.operation,
			sourceCharacterId: request.body.sourceCharacterId,
			sourceEntity: request.body.sourceEntity,
			effectTemplateId: request.body.effectTemplateId,
			choice: request.body.choice,
			targetRef: request.body.targetRef,
			commandId: command.commandId,
			requestHash: command.requestHash,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/actions/:actionId/resolve", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["commandId", "decision"],
				additionalProperties: false,
				properties: {
					commandId: {type: "string", format: "uuid"},
					decision: {type: "string", enum: ["accept", "reject", "cancel"]},
				},
			},
		},
	}, async request => {
		const command = getSemanticCommand(request);
		return store.pResolveStructuredAction({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			actionId: request.params.actionId,
			decision: request.body.decision,
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
	});

	app.post("/api/campaigns/:campaignId/characters/:characterId/xp-grants", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			body: {
				type: "object",
				required: ["amount"],
				additionalProperties: false,
				properties: {
					amount: {type: "integer", minimum: 1, maximum: 1000000},
					reason: {type: ["string", "null"], maxLength: 500},
				},
			},
		},
	}, async request => store.pGrantXp({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.params.characterId,
		amount: request.body.amount,
		reason: request.body.reason || null,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/characters/:characterId/item-grants", {
		preValidation: rejectUnknownLegacyItemGrantFields,
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			body: {
				type: "object",
				required: ["item"],
				additionalProperties: false,
				properties: {
					item: getSafeItemSummarySchema(),
					quantity: {type: "integer", minimum: 1, maximum: 100000, default: 1},
				},
			},
		},
	}, async request => store.pGrantItem({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.params.characterId,
		item: request.body.item,
		quantity: request.body.quantity || 1,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/item-awards", {
		preValidation: rejectUnknownAwardFields,
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["source", "targetCharacterIds", "quantity"],
				additionalProperties: false,
				properties: {
					source: {
						oneOf: [
							{
								type: "object",
								required: ["kind", "item"],
								additionalProperties: false,
								properties: {
									kind: {type: "string", enum: ["catalog", "recent", "campaign_item"]},
									item: getSafeItemSummarySchema(),
								},
							},
							{
								type: "object",
								required: ["kind", "entryId"],
								additionalProperties: false,
								properties: {
									kind: {type: "string", const: "party_inventory"},
									entryId: {type: "string", minLength: 1, maxLength: 200},
								},
							},
						],
					},
					targetCharacterIds: {
						type: "array",
						minItems: 1,
						maxItems: 50,
						uniqueItems: true,
						items: {type: "string", format: "uuid"},
					},
					quantity: {type: "integer", minimum: 1, maximum: 100000},
					note: {type: ["string", "null"], maxLength: 500},
				},
			},
		},
	}, async request => store.pAwardItems({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		source: request.body.source,
		targetCharacterIds: request.body.targetCharacterIds,
		quantity: request.body.quantity,
		note: request.body.note ?? null,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/party-inventory", {
		preHandler: requireAuth,
	}, async request => ({
		partyInventory: await store.pGetPartyInventory({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/transfers", {
		preHandler: requireAuth,
	}, async request => ({
		transfers: await store.pListTransfers({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/transfers", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["sourceKind", "sourceId", "targetKind", "targetId", "payload"],
				additionalProperties: false,
				properties: {
					sourceKind: {type: "string", enum: ["character", "party_inventory"]},
					sourceId: {type: "string", format: "uuid"},
					targetKind: {type: "string", enum: ["character", "party_inventory"]},
					targetId: {type: "string", format: "uuid"},
					payload: {
						type: "object",
						additionalProperties: false,
						properties: {
							items: {
								type: "array",
								maxItems: 100,
								items: {
									type: "object",
									required: ["entryId", "quantity"],
									additionalProperties: false,
									properties: {
										entryId: {type: "string", minLength: 1, maxLength: 200},
										quantity: {type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER},
									},
								},
							},
							currency: {
								type: "object",
								additionalProperties: false,
								properties: Object.fromEntries(["cp", "sp", "ep", "gp", "pp"].map(type => [type, {type: "integer", minimum: 0}])),
							},
						},
					},
				},
			},
		},
	}, async (request, reply) => {
		const created = await store.pProposeTransfer({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			...request.body,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/transfers/:transferId/resolve", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["decision"],
				additionalProperties: false,
				properties: {decision: {type: "string", enum: ["accept", "reject"]}},
			},
		},
	}, async request => store.pResolveTransfer({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		transferId: request.params.transferId,
		decision: request.body.decision,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/invites", {
		preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		invites: await store.pListInvites({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/invites", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["role"],
				additionalProperties: false,
				properties: {
					role: {type: "string", enum: ["co_dm", "player", "spectator"]},
					expiresInHours: {type: "integer", minimum: 1, maximum: 720, default: 168},
					maxUses: {type: "integer", minimum: 1, maximum: 20, default: 1},
				},
			},
		},
	}, async (request, reply) => {
		const idempotencyKey = getIdempotencyKey(request);
		const token = getDeterministicToken({
			secret: config.csrfSecret,
			namespace: "invite",
			parts: [request.hubAuth.account.id, request.params.campaignId, idempotencyKey.key],
		});
		const created = await store.pCreateInvite({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			role: request.body.role,
			tokenHash: getSha256(token),
			expiresAt: new Date(Date.now() + (request.body.expiresInHours || 168) * 60 * 60 * 1000),
			maxUses: request.body.maxUses || 1,
			idempotencyKey,
		});
		return reply.code(201).send({...created, token});
	});

	app.post("/api/campaigns/:campaignId/invites/:inviteId/revoke", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "inviteId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					inviteId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pRevokeInvite({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		inviteId: request.params.inviteId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/invites/redeem", {
		preHandler: requireMutationSecurity,
		config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				required: ["token"],
				additionalProperties: false,
				properties: {token: {type: "string", minLength: 32, maxLength: 500}},
			},
		},
	}, async request => store.pRedeemInvite({
		accountId: request.hubAuth.account.id,
		tokenHash: getSha256(request.body.token),
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/brew-versions", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["brewDocs"],
				additionalProperties: false,
				properties: {brewDocs: {type: "array", minItems: 1, maxItems: 100}},
			},
		},
	}, async (request, reply) => {
		const manifest = validateCampaignBrewBundle(request.body.brewDocs);
		const created = await store.pCreateBrewBundleVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			contentHash: getCampaignBrewHash(request.body.brewDocs),
			content: request.body.brewDocs,
			manifest,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/brew-versions/:versionId/activate", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "versionId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					versionId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pActivateBrewBundleVersion({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		brewBundleId: request.params.versionId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/rules-versions", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["rules"],
				additionalProperties: false,
				properties: {rules: {type: "object"}},
			},
		},
	}, async (request, reply) => {
		const created = await store.pCreateRulesVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			schemaVersion: CAMPAIGN_RULES_SCHEMA_VERSION,
			rules: normalizeCampaignRules(request.body.rules),
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/rules-versions/:versionId/activate", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "versionId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					versionId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pActivateRulesVersion({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		rulesVersionId: request.params.versionId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	if (config.isCampaignRulesPolicyEnabled) {
		const rulesPolicyParamsSchema = {
			type: "object",
			required: ["campaignId"],
			additionalProperties: false,
			properties: {campaignId: {type: "string", format: "uuid"}},
		};
		const nullableVersionIdSchema = {
			anyOf: [
				{type: "string", format: "uuid"},
				{type: "null"},
			],
		};

		app.get("/api/campaigns/:campaignId/rules-policy", {
			preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
			schema: {params: rulesPolicyParamsSchema},
		}, async request => ({
			catalog: getPublicCampaignRulesCatalog(),
			management: await store.pGetRulesPolicyManagement({
				accountId: request.hubAuth.account.id,
				campaignId: request.params.campaignId,
			}),
		}));

		app.post("/api/campaigns/:campaignId/rules-policy", {
			preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				params: rulesPolicyParamsSchema,
				body: {
					type: "object",
					required: ["policy", "expectedActiveRulesVersionId"],
					additionalProperties: false,
					properties: {
						policy: {type: "object"},
						expectedActiveRulesVersionId: nullableVersionIdSchema,
					},
				},
			},
		}, async (request, reply) => {
			const policy = normalizeCampaignRulesPolicyForStorage(request.body.policy);
			const result = await store.pCreateAndActivateRulesPolicy({
				accountId: request.hubAuth.account.id,
				campaignId: request.params.campaignId,
				policy,
				expectedActiveRulesVersionId: request.body.expectedActiveRulesVersionId,
				idempotencyKey: getIdempotencyKey(request),
			});
			return reply.code(201).send(result);
		});

		app.post("/api/campaigns/:campaignId/rules-policy/activate", {
			preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				params: rulesPolicyParamsSchema,
				body: {
					type: "object",
					required: ["rulesVersionId", "expectedActiveRulesVersionId"],
					additionalProperties: false,
					properties: {
						rulesVersionId: {type: "string", format: "uuid"},
						expectedActiveRulesVersionId: nullableVersionIdSchema,
					},
				},
			},
		}, async request => store.pActivateRulesPolicyVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			rulesVersionId: request.body.rulesVersionId,
			expectedActiveRulesVersionId: request.body.expectedActiveRulesVersionId,
			idempotencyKey: getIdempotencyKey(request),
		}));
	}

	app.get("/api/campaigns/:campaignId/dm-workspace", {
		preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		workspace: await store.pGetOrCreateDmWorkspace({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			defaultState: DEFAULT_DM_WORKSPACE,
		}),
	}));

	app.post("/api/campaigns/:campaignId/dm-workspace/:workspaceId/lease", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "workspaceId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					workspaceId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				additionalProperties: false,
				properties: {takeover: {type: "boolean", default: false}},
			},
		},
	}, async request => ({
		lease: await store.pAcquireDmWorkspaceLease({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			workspaceId: request.params.workspaceId,
			isTakeover: !!request.body?.takeover,
		}),
	}));

	app.put("/api/campaigns/:campaignId/dm-workspace/:workspaceId", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "workspaceId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					workspaceId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				required: ["baseRevision", "leaseEpoch", "state"],
				additionalProperties: false,
				properties: {
					baseRevision: {type: "integer", minimum: 1},
					leaseEpoch: {type: "integer", minimum: 1},
					state: {type: "object"},
				},
			},
		},
	}, async request => store.pWriteDmWorkspace({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		campaignId: request.params.campaignId,
		workspaceId: request.params.workspaceId,
		baseRevision: request.body.baseRevision,
		leaseEpoch: request.body.leaseEpoch,
		state: request.body.state,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns", {
		preHandler: requireMutationSecurity,
		config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				additionalProperties: false,
				required: ["name"],
				properties: {
					name: {type: "string", minLength: 1, maxLength: 120},
				},
			},
		},
	}, async (request, reply) => {
		const name = request.body.name.trim();
		if (!name) return reply.code(400).send({error: "INVALID_CAMPAIGN_NAME"});
		const created = await store.pCreateCampaign({
			accountId: request.hubAuth.account.id,
			name,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	// Protocol-gated: the response shape changed when the owner's sharing policy stopped
	// being part of a canonical character response.
	app.get("/api/characters", {preHandler: requireProtocolVersion}, async request => ({
		characters: await store.pListCharacters({
			accountId: request.hubAuth.account.id,
			campaignId: request.query?.campaignId || null,
		}),
	}));

	app.post("/api/characters", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["clientImportId", "schemaVersion", "data"],
				additionalProperties: false,
				properties: {
					clientImportId: {type: "string", minLength: 1, maxLength: 200},
					campaignId: {type: ["string", "null"], format: "uuid"},
					schemaVersion: {type: "integer", minimum: 1},
					data: {type: "object"},
				},
			},
		},
	}, async (request, reply) => {
		const created = await store.pCreateCharacter({
			accountId: request.hubAuth.account.id,
			campaignId: request.body.campaignId || null,
			data: request.body.data,
			schemaVersion: request.body.schemaVersion,
			clientImportId: request.body.clientImportId,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.get("/api/characters/:characterId", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		projection: await store.pGetCharacter({
			accountId: request.hubAuth.account.id,
			characterId: request.params.characterId,
		}),
	}));

	app.get("/api/characters/:characterId/projection-policy", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pGetProjectionPolicy({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
	}));

	app.put("/api/characters/:characterId/projection-policy", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["policy", "expectedProjectionRevision"],
				additionalProperties: false,
				properties: {
					expectedProjectionRevision: {type: "integer", minimum: 1},
					policy: {
						type: "object",
						required: ["version", "preset"],
						additionalProperties: false,
						properties: {
							version: {type: "integer", enum: [PROJECTION_POLICY_VERSION]},
							preset: {type: "string", enum: [...PROJECTION_PRESET_KEYS]},
							overrides: {type: "object"},
						},
					},
				},
			},
		},
	}, async request => store.pSetProjectionPolicy({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
		policy: request.body.policy,
		expectedProjectionRevision: request.body.expectedProjectionRevision,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/characters/:characterId/lease", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				additionalProperties: false,
				properties: {takeover: {type: "boolean", default: false}},
			},
		},
	}, async request => ({
		lease: await store.pAcquireCharacterLease({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			characterId: request.params.characterId,
			isTakeover: !!request.body?.takeover,
		}),
	}));

	app.post("/api/characters/:characterId/lease/release", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				additionalProperties: false,
			},
		},
	}, async request => store.pReleaseCharacterLease({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		characterId: request.params.characterId,
	}));

	app.patch("/api/characters/:characterId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["baseRevision", "leaseEpoch", "patches"],
				additionalProperties: false,
				properties: {
					baseRevision: {type: "integer", minimum: 1},
					leaseEpoch: {type: "integer", minimum: 1},
					patches: {
						type: "array",
						maxItems: 500,
						items: {
							type: "object",
							required: ["op", "path"],
							additionalProperties: true,
							properties: {
								op: {type: "string", enum: ["add", "remove", "replace"]},
								path: {type: "string", maxLength: 500},
							},
						},
					},
				},
			},
		},
	}, async request => store.pPatchCharacter({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		characterId: request.params.characterId,
		baseRevision: request.body.baseRevision,
		leaseEpoch: request.body.leaseEpoch,
		patches: request.body.patches,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.delete("/api/characters/:characterId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pArchiveCharacter({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	for (const action of ["clone", "move"]) {
		app.post(`/api/characters/:characterId/${action}`, {
			preHandler: requireMutationSecurity,
			schema: {
				params: {
					type: "object",
					required: ["characterId"],
					additionalProperties: false,
					properties: {characterId: {type: "string", format: "uuid"}},
				},
				body: {
					type: "object",
					required: ["campaignId"],
					additionalProperties: false,
					properties: {campaignId: {type: "string", format: "uuid"}},
				},
			},
		}, async request => store[action === "clone" ? "pCloneCharacter" : "pMoveCharacter"]({
			accountId: request.hubAuth.account.id,
			characterId: request.params.characterId,
			campaignId: request.body.campaignId,
			idempotencyKey: getIdempotencyKey(request),
		}));
	}

	return app;
}

export {SESSION_COOKIE, OAUTH_COOKIE, HUB_PROTOCOL_VERSION};
