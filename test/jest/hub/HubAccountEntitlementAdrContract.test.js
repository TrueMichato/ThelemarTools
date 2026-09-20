import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Campaign Hub account entitlement ADR contract", () => {
	const adr = read("docs/hub/adr/0019-provider-neutral-account-entitlements.md");
	const api = read("docs/hub/api-reference.md");
	const domain = read("docs/hub/domain-model.md");
	const operations = read("docs/hub/operations.md");
	const permissionMatrix = read("docs/hub/permission-matrix.md");
	const rollback = read("docs/hub/runbooks/rollback.md");
	const security = read("docs/hub/security.md");

	it("keeps creator and operator authority provider-neutral", () => {
		expect(adr).toContain("`campaign:create`");
		expect(adr).toContain("`platform:operate`");
		expect(adr).toMatch(/Provider subject, email, handle, login, display name, DM role, and co-DM role[\s\S]*must not become creator or operator authority/);
		expect(domain).toContain("`account_entitlements`");
	});

	it("requires provider-bound session-rotating reauthentication", () => {
		expect(adr).toMatch(/operation\s+`reauthenticate`/);
		expect(adr).toMatch(/current account, current session[\s\S]*concrete provider/);
		expect(adr).toMatch(/creates a replacement session[\s\S]*five-minute freshness window/);
		expect(api).toContain("POST /api/account/reauthentication/:provider");
		expect(security).toMatch(/callback[\s\S]*identity already linked to that account[\s\S]*rotates the session/);
	});

	it("locks transactional enforcement and last-operator protection", () => {
		expect(adr).toMatch(/checks active `campaign:create` inside the authoritative transaction/);
		expect(adr).toContain("CAMPAIGN_CREATE_NOT_ENTITLED");
		expect(adr).toMatch(/last operator cannot revoke[\s\S]*or request account deletion/);
		expect(adr).toMatch(/idempotency advisory lock;[\s\S]*operator namespace advisory lock;[\s\S]*entitlement row;[\s\S]*account row/);
	});

	it("keeps operator administration hidden and campaign-event free", () => {
		expect(permissionMatrix).toContain("Hidden 404");
		expect(api).toContain("GET /api/operator/accounts");
		expect(adr).toMatch(/account-scoped audit only:[\s\S]*never allocate a campaign/);
	});

	it("documents additive rollout and application-only rollback", () => {
		expect(operations).toContain("HUB_ACCOUNT_ENTITLEMENTS_ENABLED=false");
		expect(operations).toContain("HUB_OPERATOR_ACCOUNT_IDS");
		expect(rollback).toMatch(/leaves\s+`hub\.account_entitlements` in place and disables enforcement/);
	});
});
