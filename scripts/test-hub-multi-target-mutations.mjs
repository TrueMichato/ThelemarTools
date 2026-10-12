import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const MUTATIONS = [
	{
		name: "protocol-5-admitted",
		file: "server/src/multi-target-operation-authority.js",
		from: "`$" + "{protocolVersion}` !== MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION",
		to: "![\"5\", MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION].includes(`$" + "{protocolVersion}`)",
		pattern: "fails protocol 5",
	},
	{
		name: "partial-target-commit",
		file: "server/src/memory-hub-store.js",
		from: "const changedCharacterIds = [...nextDataByCharacterId.keys()].sort();",
		to: "const changedCharacterIds = [...nextDataByCharacterId.keys()].filter(id => id === source.id).sort();",
		pattern: "keeps two invitations",
	},
	{
		name: "target-audience-candidate-count-leak",
		file: "server/src/memory-hub-store.js",
		from: "targetDisplaySnapshot: copy(row.targetDisplaySnapshot),\n\t\t\t\t\tpresentation: getMultiTargetInvitationPresentation({operation, target: row}),\n\t\t\t\t\tcollectionClosesAt: operation.collectionClosesAt,",
		to: "targetDisplaySnapshot: copy(row.targetDisplaySnapshot),\n\t\t\t\t\tpresentation: getMultiTargetInvitationPresentation({operation, target: row}),\n\t\t\t\t\tcandidateCount: targets.length,\n\t\t\t\t\tcollectionClosesAt: operation.collectionClosesAt,",
		pattern: "does not reveal co-target",
	},
	{
		name: "ordinary-cleanup-deletes-usage-marker",
		file: "server/src/memory-hub-store.js",
		from: "_deleteCampaignData (campaignId) {\n\t\tthis._campaigns.delete(campaignId);",
		to: "_deleteCampaignData (campaignId) {\n\t\tthis._semanticMultiTargetUsage = null;\n\t\tthis._campaigns.delete(campaignId);",
		pattern: "keeps the irreversible first-use marker",
	},
	{
		name: "target-summary-count-leak",
		file: "server/src/memory-hub-store.js",
		from: "delete summary.candidateCount;\n\t\t\tdelete summary.counts;",
		to: "void summary.candidateCount;\n\t\t\tvoid summary.counts;",
		pattern: "omits aggregate candidate",
	},
	{
		name: "target-authority-drift-terminalized",
		file: "server/src/memory-hub-store.js",
		from: "if (!privateFailureCode && isTargetAuthorityInvalid) {\n\t\t\t\tthrow new HubStoreError(\"FINALIZATION_SELECTION_INVALID\", `The final selection is invalid.`, {status: 409});\n\t\t\t}",
		to: "if (!privateFailureCode && isTargetAuthorityInvalid) privateFailureCode = \"SOURCE_COST_UNAVAILABLE\";",
		pattern: "rejects target authority drift",
	},
	{
		name: "omitted-declined-leg-event",
		file: "server/src/memory-hub-store.js",
		from: "declinedTargets.push(target);",
		to: "void target;",
		pattern: "emits a deterministic declined",
	},
	{
		name: "cleaned-campaign-protocol-marker",
		file: "server/src/memory-hub-store.js",
		from: "this._multiTargetCampaignUsage.add(campaignId);",
		to: "void campaignId;",
		pattern: "cleans bounded 90-day",
	},
	{
		name: "blocking-parent-lock-allows-child-first-stall",
		file: "server/src/postgres-hub-store.js",
		from: "LIMIT 1\n\t\t\t\t\t\tFOR UPDATE SKIP LOCKED",
		to: "LIMIT 1\n\t\t\t\t\t\tFOR UPDATE",
		test: "test/jest/hub/HubMultiTargetLockOrder.test.js",
		pattern: "locks the due parent nonblocking",
	},
	{
		name: "source-event-envelope-target-oracle",
		file: "server/src/memory-hub-store.js",
		from: "sanitized.aggregateType = \"semantic_operation\";\n\t\t\t\tsanitized.aggregateId = operation?.id || sanitized.payload.operationId;\n\t\t\t\tsanitized.aggregateRevision = null;",
		to: "void sanitized.aggregateType;\n\t\t\t\tvoid sanitized.aggregateId;\n\t\t\t\tvoid sanitized.aggregateRevision;",
		pattern: "permits a reviewed target no-op",
	},
	{
		name: "failed-finalization-selects-leg",
		file: "server/src/memory-hub-store.js",
		from: "if (privateFailureCode) {\n\t\t\t\toperation.status = \"failed\";",
		to: "if (privateFailureCode) {\n\t\t\t\tselectedTargets[0].selectionState = \"selected\";\n\t\t\t\toperation.status = \"failed\";",
		replaceLast: true,
		pattern: "permanently invalidates consent",
	},
	{
		name: "candidate-membership-delete-guard-removed",
		file: "server/migrations/0011_multi_target_semantic_operations.sql",
		from: "BEFORE INSERT OR DELETE ON hub.semantic_operation_targets",
		to: "BEFORE UPDATE ON hub.semantic_operation_targets",
		test: "test/jest/hub/HubMigrationContract.test.js",
		pattern: "adds normalized schema-before-use multi-target authority",
	},
	{
		name: "live-parent-delete-guard-removed",
		file: "server/migrations/0011_multi_target_semantic_operations.sql",
		from: "BEFORE UPDATE OR DELETE ON hub.semantic_operations",
		to: "BEFORE UPDATE ON hub.semantic_operations",
		test: "test/jest/hub/HubMigrationContract.test.js",
		pattern: "adds normalized schema-before-use multi-target authority",
	},
	{
		name: "unreviewed-no-op-made-retryable",
		file: "server/src/memory-hub-store.js",
		from: "privateFailureCode = getPrivateAcceptanceFailureCode(error, {leg: \"target\"});\n\t\t\t\t\tif (!privateFailureCode) throw error;",
		to: "throw new HubStoreError(\"FINALIZATION_SELECTION_INVALID\", `The final selection is invalid.`, {status: 409});",
		replaceLast: true,
		pattern: "terminally fails an unreviewed target no-op",
	},
	{
		name: "retained-target-audience-discriminator-removed",
		file: "server/src/memory-hub-store.js",
		from: "_sourceOwnerAccountId: accountId,\n\t\t\t\t\t\t\t_targetOwnerAccountId: target.targetOwnerAccountIdAtProposal,",
		to: "_sourceOwnerAccountId: null,\n\t\t\t\t\t\t\t_targetOwnerAccountId: null,",
		replaceLast: true,
		pattern: "cleans bounded 90-day",
	},
	{
		name: "purge-deletes-live-parent-without-cancelling",
		file: "server/src/memory-hub-store.js",
		from: "this._cancelMultiTargetOperationForLifecycle({\n\t\t\t\t\t\t\toperation,\n\t\t\t\t\t\t\tactorAccountId: account.id,\n\t\t\t\t\t\t\tisAll: true,\n\t\t\t\t\t\t});",
		to: "void operation;",
		replaceLast: true,
		pattern: "purging one target owner",
	},
	{
		name: "immediate-ready-event-omitted-from-receipt",
		file: "server/src/memory-hub-store.js",
		from: "const readyEvent = this._refreshMultiTargetReadiness({operation, actorAccountId: accountId});\n\t\tif (readyEvent) eventIds.push(readyEvent.id);",
		to: "this._refreshMultiTargetReadiness({operation, actorAccountId: accountId});",
		pattern: "immediately-ready proposal event",
	},
	{
		name: "inline-expiry-events-omitted-from-finalization-receipt",
		file: "server/src/memory-hub-store.js",
		from: "const eventIds = [...elapsedEventIds];",
		to: "const eventIds = [];",
		pattern: "inline expiry and readiness events",
	},
	{
		name: "responded-invitation-omitted-from-recovery",
		file: "server/src/memory-hub-store.js",
		from: "return isMultiTargetLiveStatus(operation.status)\n\t\t\t\t\t|| (operation.resolvedAt && new Date(operation.resolvedAt) >= terminalCutoff);",
		to: "return target.responseState === \"pending\" && isMultiTargetLiveStatus(operation.status);",
		pattern: "keeps two invitations",
	},
	{
		name: "invitation-safe-presentation-omitted",
		file: "server/src/multi-target-operation-authority.js",
		from: "sourceName: effectPresentation?.sourceName || \"A party member\",",
		to: "sourceName: \"\",",
		pattern: "keeps two invitations",
	},
	{
		name: "source-operation-leg-key-omitted",
		file: "server/src/memory-hub-store.js",
		from: "operationLegKey: `$" + "{operationId}/$" + "{sourceIsSelected ? \"combined\" : \"source\"}`,",
		to: "operationLegKey: null,",
		pattern: "keeps two invitations",
	},
	{
		name: "source-result-event-sequence-omitted",
		file: "server/src/memory-hub-store.js",
		from: "eventSequence: this._semanticOperationFinalizations.get(operation.id)?.sourceLegEventSequence,",
		to: "eventSequence: null,",
		pattern: "keeps two invitations",
	},
	{
		name: "target-no-op-event-sequence-omitted",
		file: "server/src/multi-target-operation-authority.js",
		from: "eventSequence: target.legEventSequence,",
		to: "eventSequence: null,",
		pattern: "permits a reviewed target no-op",
	},
	{
		name: "owner-target-ref-omitted",
		file: "server/src/multi-target-operation-authority.js",
		from: "return target.targetRef;",
		to: "return null;",
		pattern: "binds duplicate-named",
	},
	{
		name: "source-current-visibility-bypassed",
		file: "server/src/multi-target-operation-authority.js",
		from: "const peerName = isSource\n\t\t? computePeerProfile({character: currentCharacter})?.data?.identity?.name\n\t\t: null;",
		to: "const peerName = isSource ? target.targetDisplaySnapshot?.identity?.name : null;",
		pattern: "shapes source workflow",
	},
	{
		name: "inbox-membership-recheck-omitted",
		file: "server/src/memory-hub-store.js",
		from: "const currentMembership = this._getMembership({\n\t\t\taccountId,\n\t\t\tcampaignId,\n\t\t\troles: [\"dm\", \"co_dm\", \"player\"],\n\t\t\tisRequireActiveCampaign: false,\n\t\t});",
		to: "const currentMembership = membership;",
		pattern: "rechecks membership",
	},
	{
		name: "proposal-replay-current-shaping-omitted",
		file: "server/src/multi-target-operation-authority.js",
		from: "out.presentation = structuredClone(currentTarget.presentation);",
		to: "void currentTarget.presentation;",
		pattern: "reprojects exact proposal replay",
	},
	{
		name: "command-replay-current-authority-omitted",
		file: "server/src/memory-hub-store.js",
		from: "if (!isParticipant && ![\"dm\", \"co_dm\"].includes(membership.role)) {",
		to: "if (false && !isParticipant && ![\"dm\", \"co_dm\"].includes(membership.role)) {",
		pattern: "denies exact response and cancel replay",
	},
	{
		name: "detail-shared-campaign-advisory-omitted",
		file: "server/src/postgres-hub-store.js",
		from: "await client.query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 6))`, [campaignId]);",
		to: "void campaignId;",
		replaceLast: true,
		test: "test/jest/hub/HubMultiTargetLockOrder.test.js",
		pattern: "takes the shared campaign advisory",
	},
	{
		name: "replay-substitutes-later-operation-outcome",
		file: "server/src/multi-target-operation-authority.js",
		from: "const storedOperation = projected?.operation;",
		to: "projected.operation = structuredClone(currentOperation);\n\tconst storedOperation = projected?.operation;",
		pattern: "replays the original proposal and approval outcomes",
	},
	{
		name: "multi-replay-command-row-lock-restored",
		file: "server/src/postgres-hub-store.js",
		from: "isLockRow: false,",
		to: "isLockRow: true,",
		test: "test/jest/hub/HubMultiTargetLockOrder.test.js",
		pattern: "does not lock multi-target command rows",
	},
	{
		name: "cleanup-campaign-advisory-omitted",
		file: "server/src/postgres-hub-store.js",
		from: "const {campaign_id: campaignId, id: operationId} = candidate.rows[0];\n\t\t\t\t\tattemptedOperationIds.push(operationId);\n\t\t\t\t\tawait client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 6))`, [campaignId]);",
		to: "const {campaign_id: campaignId, id: operationId} = candidate.rows[0];\n\t\t\t\t\tattemptedOperationIds.push(operationId);",
		test: "test/jest/hub/HubMultiTargetLockOrder.test.js",
		pattern: "locks retained-history campaigns",
	},
];

async function copyTree (root) {
	for (const entry of ["js", "server", "test/jest"]) {
		await fs.cp(path.join(ROOT, entry), path.join(root, entry), {recursive: true});
	}
	for (const file of ["package.json", "jest.config.json"]) {
		await fs.copyFile(path.join(ROOT, file), path.join(root, file));
	}
	await fs.mkdir(path.join(root, "deploy/hub"), {recursive: true});
	await fs.copyFile(
		path.join(ROOT, "deploy/hub/migration-policy.json"),
		path.join(root, "deploy/hub/migration-policy.json"),
	);
	await fs.symlink(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
}

function runProbe ({root, test = "test/jest/hub/HubMultiTargetOperations.test.js", pattern}) {
	const result = spawnSync(process.execPath, [
		"--localstorage-file", "test/localstorage.tmp",
		"--experimental-vm-modules",
		"node_modules/jest/bin/jest.js",
		test,
		"--runInBand",
		"--no-coverage",
		"--forceExit",
		"--testNamePattern", pattern,
	], {
		cwd: root,
		encoding: "utf8",
		env: {...process.env, FORCE_COLOR: "0"},
	});
	return result.status === 0;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-multi-target-mutations-"));
try {
	await copyTree(root);
	const baseline = new Map();
	for (const mutation of MUTATIONS) {
		if (!baseline.has(mutation.file)) {
			baseline.set(mutation.file, await fs.readFile(path.join(root, mutation.file), "utf8"));
		}
		assert.equal(runProbe({
			root,
			test: mutation.test,
			pattern: mutation.pattern,
		}), true, `Baseline probe failed: ${mutation.name}`);
	}

	const survivors = [];
	for (const mutation of MUTATIONS) {
		const source = baseline.get(mutation.file);
		const matchIndex = mutation.replaceLast
			? source.lastIndexOf(mutation.from)
			: source.indexOf(mutation.from);
		assert.notEqual(matchIndex, -1, `${mutation.name} mutation did not match ${mutation.file}`);
		const changed = `${source.slice(0, matchIndex)}${mutation.to}${source.slice(matchIndex + mutation.from.length)}`;
		assert.notEqual(changed, source, `${mutation.name} mutation did not match ${mutation.file}`);
		await fs.writeFile(path.join(root, mutation.file), changed);
		const survived = runProbe({
			root,
			test: mutation.test,
			pattern: mutation.pattern,
		});
		await fs.writeFile(path.join(root, mutation.file), source);
		if (survived) {
			survivors.push(mutation.name);
			process.stderr.write(`SURVIVED ${mutation.name}\n`);
		} else {
			process.stdout.write(`KILLED ${mutation.name}\n`);
		}
	}

	assert.deepEqual(survivors, [], `Mutation survivors: ${survivors.join(", ")}`);
	process.stdout.write(`${MUTATIONS.length}/${MUTATIONS.length} multi-target authority mutants killed.\n`);
} finally {
	await fs.rm(root, {recursive: true, force: true});
}
