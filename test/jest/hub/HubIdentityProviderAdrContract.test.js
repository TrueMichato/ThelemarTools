import fs from "node:fs";

const adr = fs.readFileSync(new URL("../../../docs/hub/adr/0014-multi-provider-identity.md", import.meta.url), "utf8");

describe("Campaign Hub multi-provider identity ADR contract", () => {
	it("records the provider registry decision and rollout boundary", () => {
		expect(adr).toMatch(/^Status: Accepted for implementation \(2026-09-01\)$/m);
		expect(adr).toContain("application-owned provider registry");
		expect(adr).toContain("ship Discord and Google together");
		expect(adr).toContain("GET /auth/github/start");
		expect(adr).toContain("GET /auth/discord/start");
		expect(adr).toContain("GET /auth/google/start");
		expect(adr).toContain("There is no catch-all callback");
	});

	it("makes provider and subject authoritative and forbids email linking", () => {
		expect(adr).toContain("Login identity is the normalized pair `(provider, subject)`");
		expect(adr).toMatch(/Never auto-link by email/i);
		expect(adr).toContain("Email is not part of the normalized identity");
		expect(adr).toContain("IDENTITY_ALREADY_LINKED");
		expect(adr).toContain("LAST_USABLE_IDENTITY");
	});

	it("covers admission and the protected link lifecycle", () => {
		for (const required of [
			"private admission policy",
			"A campaign invite never bypasses the Hub allowlist",
			"recent reauthentication",
			"CSRF protection",
			"one-time state",
			"PKCE",
			"OIDC nonce",
			"Provider configuration changes run the same preflight",
		]) expect(adr).toContain(required);
	});

	it("specifies the additive persistence and rollout migration", () => {
		for (const required of [
			"0004_multi_provider_identity.sql",
			"UNIQUE (provider, provider_subject)",
			"authenticated_via_identity_id",
			"hub.oauth_transactions",
			"state hash",
			"apply the additive migration",
			"provider registry with only the GitHub adapter enabled",
			"enable Discord and Google together",
		]) expect(adr).toContain(required);
	});

	it("keeps every account lifecycle surface identity-complete", () => {
		for (const required of [
			"Sessions, export, deletion, and audit",
			"revoke all other sessions",
			"Account export adds `externalIdentities`",
			"deletes all external identities and OAuth transactions during purge",
			"identity.linked",
			"identity.unlinked",
			"lease release",
			"WebSocket closure",
		]) expect(adr).toContain(required);
	});

	it("defines the security and operations contracts", () => {
		for (const required of [
			"OAuth confused deputy or mix-up",
			"Login CSRF",
			"Account takeover through linking",
			"Email or profile takeover/change",
			"Secrets, configuration, and rotation",
			"Rate limits and redacted observability",
			"OAuth state/code/verifier/nonce",
			"Rollback",
		]) expect(adr).toContain(required);
	});

	it("requires cross-provider acceptance evidence", () => {
		expect(adr).toContain("## Acceptance tests");
		expect(adr).toContain("equal or changed emails never link, merge, admit, or select an account");
		expect(adr).toContain("concurrent one-winner behavior");
		expect(adr).toContain("provider-disable and deployment rollback preflight");
		expect(adr).toContain("Discord and Google must pass this shared matrix in the same release candidate");
	});
});
