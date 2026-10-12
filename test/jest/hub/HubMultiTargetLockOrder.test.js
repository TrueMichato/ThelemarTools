import fs from "node:fs";

const source = fs.readFileSync(
	new URL("../../../server/src/postgres-hub-store.js", import.meta.url),
	"utf8",
);

function getMethodSource (name, nextName) {
	const start = source.indexOf(`async ${name} (`);
	const end = source.indexOf(`async ${nextName} (`, start + 1);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

describe("multi-target PostgreSQL lock-order canaries", () => {
	it("locks global account quotas before campaign authority during proposal", () => {
		const method = getMethodSource("pCreateMultiTargetOperation", "pRespondMultiTargetInvitation");
		const quotaLock = method.indexOf("hashtextextended($1, 10)");
		const campaignLock = method.indexOf("hashtextextended($1, 6)");
		expect(quotaLock).toBeGreaterThanOrEqual(0);
		expect(campaignLock).toBeGreaterThan(quotaLock);
	});

	it("locks the due parent nonblocking before any child row in maintenance", () => {
		const method = getMethodSource("pExpireMultiTargetOperations", "pCleanupMultiTargetHistory");
		const campaignTryLock = method.indexOf("pg_try_advisory_xact_lock");
		const parentQuery = method.indexOf("FROM hub.semantic_operations", campaignTryLock);
		const parentSkipLocked = method.indexOf("FOR UPDATE SKIP LOCKED", parentQuery);
		const childLock = method.indexOf("_pGetMultiTargetTargets");
		expect(campaignTryLock).toBeGreaterThanOrEqual(0);
		expect(parentQuery).toBeGreaterThan(campaignTryLock);
		expect(parentSkipLocked).toBeGreaterThan(campaignTryLock);
		expect(childLock).toBeGreaterThan(parentSkipLocked);
	});

	it("takes the shared campaign advisory before detail membership and character shares", () => {
		const method = getMethodSource("pGetMultiTargetOperation", "pExpireMultiTargetOperations");
		const campaignLock = method.indexOf("pg_advisory_xact_lock_shared(hashtextextended($1, 6))");
		const membershipLock = method.indexOf("_pGetMembershipForShare");
		const characterLock = method.indexOf("FOR SHARE");
		expect(campaignLock).toBeGreaterThanOrEqual(0);
		expect(membershipLock).toBeGreaterThan(campaignLock);
		expect(characterLock).toBeGreaterThan(membershipLock);
		expect(method).not.toMatch(/FROM hub\.campaigns[\s\S]*FOR (?:NO KEY )?UPDATE|FOR SHARE OF campaign/);
	});

	it("does not lock multi-target command rows before campaign lifecycle authority", () => {
		for (const [name, nextName] of [
			["pCreateMultiTargetOperation", "pRespondMultiTargetInvitation"],
			["pRespondMultiTargetInvitation", "pFinalizeMultiTargetOperation"],
			["pFinalizeMultiTargetOperation", "pCancelMultiTargetOperation"],
			["pCancelMultiTargetOperation", "pListMultiTargetInbox"],
		]) {
			const method = getMethodSource(name, nextName);
			expect(method).toContain("isLockRow: false");
		}
	});

	it("locks retained-history campaigns before parent rows and aggregate deletion", () => {
		const method = getMethodSource("pCleanupMultiTargetHistory", "_pExpireSemanticOperations");
		const campaignLock = method.indexOf("pg_advisory_xact_lock(hashtextextended($1, 6))");
		const parentLock = method.indexOf("FOR UPDATE", campaignLock);
		const commandDelete = method.indexOf("DELETE FROM hub.semantic_operation_commands", parentLock);
		expect(campaignLock).toBeGreaterThanOrEqual(0);
		expect(parentLock).toBeGreaterThan(campaignLock);
		expect(commandDelete).toBeGreaterThan(parentLock);
	});
});
