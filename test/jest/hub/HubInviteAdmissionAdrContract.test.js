import fs from "node:fs";

const adr = fs.readFileSync(new URL("../../../docs/hub/adr/0018-invite-gated-first-access.md", import.meta.url), "utf8");

describe("Campaign Hub invite admission ADR contract", () => {
	it("defines atomic invite-gated first access and existing-account behavior", () => {
		for (const required of [
			"An existing `(provider, subject)` signs in normally",
			"account, external identity, session, campaign membership, invite use",
			"already-active member succeeds without consuming another invite use",
			"Joining any later campaign remains",
			"`deletion_requested` accounts may sign in",
		]) expect(adr).toContain(required);
	});

	it("keeps raw invite material out of OAuth and browser persistence", () => {
		for (const required of [
			"`POST /api/auth/invite-contexts`",
			"hash-only retry",
		]) expect(adr).toContain(required);
		expect(adr).toMatch(/no raw invite or context identifier enters return paths, OAuth state,\s+cookies, referrers, or history/);
		expect(adr).toMatch(/The bound\s+context is not reusable/);
	});

	it("records migration, lock order, lifecycle, and rollout boundaries", () => {
		for (const required of [
			"`0008_invite_gated_first_access.sql`",
			"campaign advisory lock",
			"campaign row lock",
			"invite row lock",
			"`HUB_INVITE_ACCOUNT_ADMISSION_ENABLED`",
			"not deployable with new",
			"`campaign:create` entitlement",
			"fresh reauthentication",
		]) expect(adr).toContain(required);
	});
});
