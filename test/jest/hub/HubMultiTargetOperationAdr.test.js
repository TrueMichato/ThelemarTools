import fs from "node:fs";
import pg from "pg";

const adr = fs.readFileSync(
	new URL("../../../docs/hub/adr/0020-consented-multi-target-operations.md", import.meta.url),
	"utf8",
);
const normalizedAdr = adr.replace(/\s+/g, " ");
const proofSql = fs.readFileSync(
	new URL("../../fixtures/hub/adr-0020-multi-target-set-shaping.sql", import.meta.url),
	"utf8",
);
const apiReference = fs.readFileSync(new URL("../../../docs/hub/api-reference.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const eventCatalog = fs.readFileSync(new URL("../../../docs/hub/event-catalog.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const security = fs.readFileSync(new URL("../../../docs/hub/security.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const migrations = fs.readFileSync(new URL("../../../docs/hub/migrations.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const testing = fs.readFileSync(new URL("../../../docs/hub/testing.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

describe("Campaign Hub multi-target operation ADR contract", () => {
	it("records an accepted design-only contract and narrows the prior ADRs", () => {
		expect(adr).toMatch(/^Status: Accepted design contract; Wave A0 proof only, not implemented \(2026-09-21\)$/m);
		expect(normalizedAdr).toContain("extends ADR 0012");
		expect(normalizedAdr).toContain("supersedes ADR 0012's self-target rule");
		expect(normalizedAdr).toContain("extends ADR 0016");
		expect(normalizedAdr).toContain("narrowly supersedes ADR 0016's blanket prohibition");
		expect(normalizedAdr).toContain("This design-only PR contains no production migration");
		expect(normalizedAdr).toContain("requires future additive migration `0010_multi_target_semantic_operations.sql`");
		expect(normalizedAdr).toContain("must remain unmerged until the coordinator records the physical game-day GO/NO-GO");
	});

	it("fixes the target set and separates consent from one atomic finalization", () => {
		for (const anchor of [
			"minimum of 1 and maximum of 8 ordered, unique",
			"The candidate set is immutable.",
			"Each target owner approves/rejects each invitation independently.",
			"Source-owned legs do not create a separate response command.",
			"explicit decline for every deselected source-owned leg",
			"There is no reservation",
			"zero selected targets as explicit cancellation",
			"one source cost plus all selected target legs in one atomic transaction",
			"`collecting_responses`",
			"`awaiting_source_selection`",
			"`FINALIZATION_SELECTION_INVALID`",
			"globally unique target-leg address",
		]) expect(normalizedAdr).toContain(anchor);
		expect(normalizedAdr).toContain("\"maxTargets\": 8");
		for (const limit of [
			"at most 3 live collection operations per source character",
			"at most 5 live collection operations per source account",
			"at most 50 live collection operations per campaign",
			"at most 20 pending invitations per target owner",
			"`429 RATE_LIMITED`",
			"oldest-pending-first cursor pagination",
			"advisory-lock seed 10",
		]) expect(normalizedAdr).toContain(limit);
		expect(normalizedAdr).toContain("source account and every distinct target-owner account in ascending account UUID order");
		expect(normalizedAdr.indexOf("quota advisory locks (seed 10)")).toBeLessThan(normalizedAdr.indexOf("campaign advisory lock (seed 6)"));
	});

	it("requires normalized migration 0010 tables and concrete constraints", () => {
		expect(normalizedAdr).toContain("Migration `0010_multi_target_semantic_operations.sql` is required");
		expect(normalizedAdr).toContain("`hub.semantic_operation_targets`");
		expect(normalizedAdr).toContain("`semantic_operation_finalizations`");
		expect(normalizedAdr).toContain("`hub.semantic_multi_target_usage`");
		expect(normalizedAdr).toContain("`target_set_version integer`");
		for (const constraint of [
			"PK `(operation_id,target_character_id)`",
			"unique `(operation_id,ordinal)`",
			"globally unique `invitation_id`",
			"one invitation/response per target leg",
			"one finalization row per operation",
			"`ON DELETE RESTRICT`",
			"`phase: \"expand\"`",
			"`previousAppCompatible: true`",
		]) expect(normalizedAdr).toContain(constraint);
		expect(normalizedAdr).toContain("legacy rows have `target_set_version IS NULL`");
		expect(normalizedAdr).toContain("Every current singular read must be explicitly rewritten");
		expect(normalizedAdr).toContain("no foreign key to semantic-operation or campaign history");
		expect(normalizedAdr).toContain("`ON CONFLICT DO NOTHING`");
		expect(normalizedAdr).toContain("Normal cleanup never deletes or rewrites `hub.semantic_multi_target_usage`");
	});

	it("pins lock, event, privacy, reconciliation, and rollback ordering", () => {
		for (const anchor of [
			"command advisory lock (seed 9)",
			"campaign advisory lock (seed 6)",
			"membership rows in ascending account UUID order",
			"target child rows ordered by `(operation_id, target_character_id)`",
			"unique character advisory locks (seed 2)",
			"compute every next document/leg/event before any canonical write",
			"emit a source cost/combined event first to source owner plus DM/co-DM",
			"emit one target applied event per selected invitation in proposal ordinal order",
			"one collapsed metadata-only projection invalidation",
			"accepted base, live state, latest-submitted state, durable recovery queue, or visible state",
			"Unrelated users receive no workflow event.",
			"protocol 6",
			"Every protocol `<6`, explicitly 3, 4, and 5, fails closed",
			"capability is disabled",
			"No ordinary rollback drops columns/tables or reverses applied character state",
			"Opposing source/target UUID order",
			"parent semantic operation rows in ascending operation UUID order",
			"`ORDER BY collection_closes_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`",
			"command advisory lock -> global quota locks ascending by account UUID (proposal only) -> campaign advisory/row",
		]) expect(normalizedAdr).toContain(anchor);
		expect(normalizedAdr).toContain("global quota locks ascending by account UUID");
	});

	it("fences true pre-0010 rollback after the irreversible first-use marker", () => {
		for (const anchor of [
			"`previousAppCompatible: true` only for the schema-before-use state",
			"usage marker is absent",
			"After the first accepted multi-target proposal sets `hub.semantic_multi_target_usage`",
			"operational rollback to a true pre-0010 binary is permanently forbidden",
			"bridge/r10+ release",
			"current parent/child counts are diagnostic only",
			"separately reviewed destructive history/event/outbox/recovery export-and-purge procedure",
			"Deleting the usage marker is the final irreversible step",
		]) expect(normalizedAdr).toContain(anchor);
		expect(migrations).toContain("true pre-0010 rollback is blocked whenever the marker exists");
	});

	it("serializes global cross-campaign quotas before campaign authority", () => {
		for (const anchor of [
			"dedicated global multi-target quota namespace",
			"source account and every distinct target-owner account",
			"before acquiring the campaign lifecycle lock",
			"Cross-campaign proposal tests",
			"exactly one quota-lock winner at the final slot",
			"one `COLLECTION_LIMIT_REACHED` loser",
		]) expect(normalizedAdr).toContain(anchor);
		expect(security).toContain("dedicated seed-10 quota advisory-lock namespace");
		expect(apiReference).toContain("different campaigns produce one committed winner");
	});

	it("pins bounded event audiences and cross-target privacy across current docs", () => {
		for (const text of [normalizedAdr, eventCatalog]) {
			expect(text).toContain("source owner plus DM/co-DM");
			expect(text).toContain("target owner");
			expect(text).toContain("source owner");
			expect(text).toContain("DM/co-DM");
		}
		expect(normalizedAdr).toContain("No target-owner payload exposes a co-target identity, decision");
		expect(eventCatalog).toContain("no rationale, hidden target truth, or co-target identity/decision");
		expect(security).toContain("target-owner views never expose a co-target identity or decision");
		expect(normalizedAdr).toContain("DM/co-DM observation is intentional");
	});

	it("closes every multi-target surface to protocols 3, 4, and 5", () => {
		for (const surface of [
			"create",
			"respond",
			"finalize",
			"cancel",
			"inbox",
			"detail",
			"outgoing",
			"WebSocket",
			"resync",
			"replay",
		]) expect(normalizedAdr).toContain(surface);
		expect(normalizedAdr).toContain("Protocol 6 is the first successful version.");
		expect(apiReference).toContain("Protocol 3/4/5 fails closed");
		expect(security).toContain("every protocol 3/4/5");
	});

	it("covers the required race and lifecycle hazards", () => {
		for (const hazard of [
			"Two owners respond concurrently",
			"Same owner, two targets",
			"Response vs collection expiry",
			"Finalize vs late response",
			"Target move/removal/archive",
			"Source cost spent/restored",
			"Duplicate finalization",
			"Source-as-target",
			"Duplicate resolved target",
			"Source lifecycle loss",
			"Rules/template change",
			"Permitted full-HP target",
			"Rejected finalization",
			"Reconnect/replay",
		]) expect(adr).toContain(hazard);
	});

	it("pins the reviewed privacy-preserving healing no-op exception", () => {
		for (const anchor of [
			"`allowTargetNoOp=true`",
			"already at its applicable maximum HP is valid",
			"`applied` with `changed=false`",
			"one source cost is still consumed",
			"source sees only that the selected set applied",
			"all-changed, some-full, or all-full",
			"Generic failure and re-proposal for full-HP healing",
			"Disclose full-HP targets to the source",
		]) expect(normalizedAdr).toContain(anchor);
	});

	it("enumerates every singular implementation path that A3 must rewrite", () => {
		for (const method of [
			"`pListPendingActions`",
			"`pListCharacterPendingActions`",
			"`_pExpireSemanticOperations`",
			"`_pCancelSemanticOperationsForLifecycle`",
			"response/finalization discovery and authorization",
			"account purge",
			"campaign purge",
		]) expect(adr).toContain(method);
		expect(normalizedAdr).toContain("Purge must delete command/finalization/target rows");
	});

	it("records the A1-A5 implementation handoff", () => {
		for (const handoff of [
			"A1 — DM typed effects",
			"A2 — source-cost authority",
			"A3 — server state machine",
			"A4 — Character Sheet UX and reconciliation",
			"A5 — Healing Word and Mass Healing Word templates",
		]) expect(adr).toContain(handoff);
	});

	it("keeps the PostgreSQL set-shaping example read-only and deterministic", () => {
		expect(proofSql).toContain("candidate_targets");
		expect(proofSql).toContain("selected_targets");
		expect(proofSql).toContain("array_agg(target_index ORDER BY target_index)");
		expect(proofSql).toContain("array_agg(character_id ORDER BY character_id)");
		expect(proofSql).toContain("target_set_unique");
		expect(proofSql).toContain("selection_is_subset");
		expect(proofSql).toContain("self_target_collapsed");
		expect(proofSql).toContain("duplicate_target_detected");
		expect(proofSql).toContain("gapped_ordinal_detected");
		expect(proofSql).not.toContain("FOR UPDATE");
		expect(proofSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|LOCK)\b/i);
		expect(testing).toContain("ascending UUID set-shaping/order");
		expect(testing).toContain("It is not a lock proof");
	});
});

describePostgres("Campaign Hub multi-target set-shaping example (real PostgreSQL)", () => {
	it("proves valid shapes and detects duplicate/gapped invalid shapes", async () => {
		const pool = new pg.Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 1,
		});
		const client = await pool.connect();
		try {
			await client.query("BEGIN READ ONLY");
			const result = await client.query(proofSql);
			expect(result.rows).toEqual([{
				target_set_unique: true,
				candidate_order_contiguous: true,
				selection_is_subset: true,
				selection_unique: true,
				stable_unique_character_order: true,
				self_target_collapsed: true,
				duplicate_target_detected: true,
				gapped_ordinal_detected: true,
			}]);
			await client.query("ROLLBACK");
		} finally {
			client.release();
			await pool.end();
		}
	});
});
