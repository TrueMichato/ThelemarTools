import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import {
	decodeSignedState,
	encodeSignedState,
	getCsrfToken,
	getDeterministicToken,
	getPkceChallenge,
	getRandomToken,
	getSha256,
	isConstantTimeEqual,
} from "./security.js";
import {HubStoreError} from "./hub-store-error.js";
import {
	CAMPAIGN_RULES_SCHEMA_VERSION,
	getCampaignBrewHash,
	normalizeCampaignRules,
	validateCampaignBrewBundle,
} from "./campaign-content.js";
import {HubOutboxDispatcher, HubRealtime} from "./realtime.js";
import {getSafeRequestId, HubMetrics} from "./observability.js";
import crypto from "node:crypto";

const SESSION_COOKIE = "__Host-hub_session";
const OAUTH_COOKIE = "__Host-hub_oauth";
const HUB_PROTOCOL_VERSION = "1";
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
	const appOrigin = new URL(config.appOrigin).origin;
	return {
		sessionTtlSeconds: 60 * 60 * 24 * 30,
		oauthStateTtlSeconds: 10 * 60,
		isSecure: new URL(appOrigin).protocol === "https:",
		allowedOAuthSubjects: [],
		trustProxy: false,
		metricsToken: null,
		...config,
		appOrigin,
	};
}

function getSafeReturnTo ({rawReturnTo, appOrigin}) {
	if (typeof rawReturnTo !== "string") return "/hub.html";
	try {
		const url = new URL(rawReturnTo, appOrigin);
		if (url.origin !== appOrigin) return "/hub.html";
		if (url.pathname.startsWith("//")) return "/hub.html";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/hub.html";
	}
}

export async function createHubApp ({
	store,
	oauthProvider,
	config: rawConfig,
	logger = false,
	realtime: realtimeOverride = null,
	isStartOutboxDispatcher = false,
	metrics: metricsOverride = null,
}) {
	if (!store) throw new TypeError(`store is required.`);
	if (!oauthProvider) throw new TypeError(`oauthProvider is required.`);
	const config = validateConfig(rawConfig);
	const metrics = metricsOverride || new HubMetrics();
	const app = Fastify({
		logger,
		trustProxy: config.trustProxy,
		bodyLimit: 2 * 1024 * 1024,
		genReqId: request => getSafeRequestId(request) || crypto.randomUUID(),
	});
	await app.register(cookie, {secret: config.cookieSecret});
	await app.register(websocket, {options: {maxPayload: 16 * 1024}});
	await app.register(rateLimit, {
		global: false,
		max: 30,
		timeWindow: "1 minute",
	});
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
	const realtime = realtimeOverride || new HubRealtime({store});
	const outboxDispatcher = new HubOutboxDispatcher({store, realtime});
	app.decorate("hubRealtime", realtime);
	app.decorate("hubOutboxDispatcher", outboxDispatcher);
	app.decorate("hubMetrics", metrics);
	if (isStartOutboxDispatcher) outboxDispatcher.start();
	app.addHook("onClose", async () => outboxDispatcher.stop());
	app.setErrorHandler((error, request, reply) => {
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
		});
	});

	app.get("/auth/github/start", {
		config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
	}, async (request, reply) => {
		const state = getRandomToken();
		const verifier = getRandomToken(48);
		const returnTo = getSafeReturnTo({
			rawReturnTo: request.query?.returnTo,
			appOrigin: config.appOrigin,
		});
		const oauthState = encodeSignedState({
			state,
			verifier,
			returnTo,
			expiresAt: Date.now() + config.oauthStateTtlSeconds * 1000,
		});
		reply.setCookie(OAUTH_COOKIE, oauthState, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.oauthStateTtlSeconds,
		}));
		return reply.redirect(oauthProvider.getAuthorizationUrl({
			state,
			codeChallenge: getPkceChallenge(verifier),
			redirectUri: `${config.appOrigin}/auth/github/callback`,
		}));
	});

	app.get("/auth/github/callback", {
		config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
	}, async (request, reply) => {
		const encodedState = getSignedCookie(request, OAUTH_COOKIE);
		if (!encodedState) return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
		let oauthState;
		try {
			oauthState = decodeSignedState(encodedState);
		} catch {
			return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
		}
		if (oauthState.expiresAt <= Date.now() || request.query?.state !== oauthState.state || !request.query?.code) {
			return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
		}

		const identity = await oauthProvider.pExchangeCode({
			code: request.query.code,
			codeVerifier: oauthState.verifier,
			redirectUri: `${config.appOrigin}/auth/github/callback`,
		});
		const isAllowed = config.allowedOAuthSubjects.includes(`${identity.provider}:${identity.providerSubject}`);
		if (!isAllowed) return reply.code(403).send({error: "ACCOUNT_NOT_ALLOWED"});

		const priorAuth = await pGetAuth(request);
		const account = await store.pUpsertOAuthAccount(identity);
		const token = getRandomToken();
		await store.pCreateSession({
			accountId: account.id,
			tokenHash: getSha256(token),
			expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000),
			userAgent: request.headers["user-agent"] || null,
		});
		if (priorAuth) {
			await store.pRevokeSession({sessionId: priorAuth.session.id});
			realtime.closeSession({sessionId: priorAuth.session.id});
		}
		reply.clearCookie(OAUTH_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		reply.setCookie(SESSION_COOKIE, token, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.sessionTtlSeconds,
		}));
		return reply.redirect(oauthState.returnTo);
	});

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

	app.get("/api/campaigns/:campaignId/snapshot", {
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
	}, async request => ({
		events: await store.pListVisibleEvents({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			afterSequence: request.query.afterSequence,
			limit: request.query.limit,
		}),
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
		preHandler: requireAuth,
	}, async request => ({
		actions: await store.pListPendingActions({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/actions", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["targetCharacterId", "effect"],
				additionalProperties: false,
				properties: {
					targetCharacterId: {type: "string", format: "uuid"},
					effect: {
						type: "object",
						required: ["type"],
						additionalProperties: true,
						properties: {type: {type: "string"}},
					},
				},
			},
		},
	}, async (request, reply) => {
		const created = await store.pCreateStructuredAction({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			targetCharacterId: request.body.targetCharacterId,
			effect: request.body.effect,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/actions/:actionId/resolve", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["decision"],
				additionalProperties: false,
				properties: {decision: {type: "string", enum: ["accept", "reject"]}},
			},
		},
	}, async request => store.pResolveStructuredAction({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		actionId: request.params.actionId,
		decision: request.body.decision,
		idempotencyKey: getIdempotencyKey(request),
	}));

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
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			body: {
				type: "object",
				required: ["item"],
				additionalProperties: false,
				properties: {
					item: {type: "object"},
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
										quantity: {type: "number", exclusiveMinimum: 0},
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

	app.get("/api/characters", {preHandler: requireAuth}, async request => ({
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
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		character: await store.pGetCharacter({
			accountId: request.hubAuth.account.id,
			characterId: request.params.characterId,
		}),
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
