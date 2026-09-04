import fs from "node:fs";

const adr = fs.readFileSync(
	new URL("../../../docs/hub/adr/0016-atomic-peer-source-costs.md", import.meta.url),
	"utf8",
);
const normalizedAdr = adr.replace(/\s+/g, " ");
const adr0012 = fs.readFileSync(
	new URL("../../../docs/hub/adr/0012-idempotent-semantic-character-operations.md", import.meta.url),
	"utf8",
);
const normalizedAdr0012 = adr0012.replace(/\s+/g, " ");

describe("Campaign Hub peer source-cost ADR contract", () => {
	it("records the complete first Cure Wounds slice without claiming broader targeting", () => {
		expect(adr).toMatch(/^Status: Accepted; first protocol-4 Cure Wounds client\/server slice implemented \(2026-09-04\)$/m);
		expect(normalizedAdr).toContain("This ADR extends ADR 0012");
		expect(normalizedAdr).toContain("The first implementation slice includes");
		expect(normalizedAdr).toContain("original protocol-v3 substrate deliberately admitted only");
		expect(normalizedAdr).toContain("Multi-target orchestration, party/NPC targets, generic effects");
	});

	it("supersedes ADR 0012's reservation direction with one unambiguous model", () => {
		expect(normalizedAdr).toContain("explicitly supersedes ADR 0012's earlier follow-up requirement");
		expect(normalizedAdr).toContain("only the acceptance transaction may consume the source cost");
		expect(normalizedAdr0012).toContain("source-cost reservation superseded by ADR 0016");
		expect(normalizedAdr0012).toContain(
			"[ADR 0016](0016-atomic-peer-source-costs.md) supersedes this section's earlier direction",
		);
		expect(normalizedAdr0012).toContain("performs no pre-approval reservation or mutation");
		expect(normalizedAdr0012).not.toContain("requires an atomic reservation contract");
	});

	it("binds stable command, request, operation, event, and leg identities", () => {
		for (const identity of [
			"`proposalCommandId`",
			"`operationId`",
			"`resolutionCommandId`",
			"`sourceCharacterId`",
			"`targetCharacterId`",
			"`targetOwnerAccountIdAtProposal`",
			"`sourceCost`",
			"`targetOperation`",
			"`effectResolutionSeed`",
			"`eventId`",
			"`operationLegKey`",
		]) expect(adr).toContain(identity);
		expect(normalizedAdr).toContain("The semantic operation row is the request.");
		expect(normalizedAdr).toContain("there is no mutable `approvalId`");
	});

	it("chooses no reservation and one atomic approval-time transaction", () => {
		expect(normalizedAdr).toContain("### No reservation before acceptance");
		expect(normalizedAdr).toContain("it mutates no character");
		expect(normalizedAdr).toContain("The first committed source spend wins.");
		expect(normalizedAdr).toContain("Commit once");
		expect(normalizedAdr).toContain("No case uses a best-effort compensating");
		expect(normalizedAdr).toContain("It never rerolls");
	});

	it("locks the complete authority set in one deterministic order", () => {
		for (const lock of [
			"semantic command advisory lock",
			"campaign lifecycle advisory lock",
			"membership rows in ascending account UUID order",
			"`semantic_operations` request row `FOR UPDATE`",
			"ascending character UUID order",
			"ascending `(resource kind, row UUID)` order",
			"character lease rows in the same character order",
		]) expect(normalizedAdr).toContain(lock);
		expect(normalizedAdr).toContain("rules activation and semantic/lifecycle paths");
	});

	it.each([
		"spell_slot",
		"item_charge",
		"inventory_quantity",
		"feature_use",
	])("defines the closed version-1 resource kind %s", kind => {
		expect(normalizedAdr).toContain(`\`${kind}\``);
	});

	it("uses a versioned union and rejects open client-authored paths", () => {
		expect(normalizedAdr).toContain("versioned discriminated union");
		expect(normalizedAdr).toContain("is not an open plugin registry");
		expect(normalizedAdr).toContain("`additionalProperties: false`");
		expect(normalizedAdr).toContain("No client request may contain");
		expect(normalizedAdr).toContain("JSON Pointer/path");
		expect(normalizedAdr).toContain("unknown kinds/versions fail");
	});

	it("defines all-or-none failures and a stable terminal failed state", () => {
		for (const status of ["`applied`", "`rejected`", "`cancelled`", "`expired`", "`failed`"]) {
			expect(normalizedAdr).toContain(status);
		}
		for (const caseText of [
			"Source cost missing, malformed, insufficient, spent, replaced, or unsupported at accept",
			"Target effect invalid, inapplicable, or a version-1 no-op",
			"Active campaign/rules/brew/template/capability pin changed",
			"Two accepts or accept vs reject/cancel/expiry",
			"Commit succeeds but HTTP response is lost",
			"Outbox publish fails after commit",
		]) expect(normalizedAdr).toContain(caseText);
	});

	it("increments each unique character once and combines self-targeting", () => {
		expect(normalizedAdr).toContain("Distinct characters each increment exactly once.");
		expect(normalizedAdr).toContain("A self-target increments its one aggregate exactly once");
		expect(normalizedAdr).toContain("`leg: \"combined\"`");
		expect(normalizedAdr).toContain("`sourceCostEventId` is null");
	});

	it("keeps source cost private while reconciling both document legs", () => {
		expect(normalizedAdr).toContain("`character.operation.source_cost_consumed`");
		expect(normalizedAdr).toContain("visible only to the source owner and DM/co-DM");
		expect(normalizedAdr).toContain("Target-owner projection omits `sourceResult`");
		expect(normalizedAdr).toContain("distinct source: sourceAccepted := C(sourceB)");
		expect(normalizedAdr).toContain("distinct target: targetAccepted := E(targetB)");
		expect(normalizedAdr).toContain("self target: accepted := E(C(B))");
		expect(normalizedAdr).toContain("blocks cloud autosave");
		expect(normalizedAdr).toContain("it omits `sourceEntity`, `choice`, `sourceCost`");
		expect(normalizedAdr).toContain("target-side failures remain generic");
		expect(normalizedAdr).toContain("source-side failures remain generic");
	});

	it("requires protocol, migration, capability, rollback, and full verification evidence", () => {
		expect(normalizedAdr).toContain("require Hub protocol 4");
		expect(normalizedAdr).toContain("`NNNN_peer_source_costs.sql`");
		expect(normalizedAdr).toContain("\"peerSourceCosts\"");
		expect(normalizedAdr).toContain("The capability defaults off");
		expect(normalizedAdr).toContain("No rollback drops columns");
		expect(normalizedAdr).toContain("retention-safe `ON DELETE RESTRICT`");
		for (let ix = 1; ix <= 20; ++ix) expect(adr).toMatch(new RegExp(`^${ix}\\. `, "m"));
	});
});
