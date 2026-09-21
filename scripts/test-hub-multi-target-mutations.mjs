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
		from: "targetDisplaySnapshot: copy(row.targetDisplaySnapshot),\n\t\t\t\t\tcollectionClosesAt: operation.collectionClosesAt,",
		to: "targetDisplaySnapshot: copy(row.targetDisplaySnapshot),\n\t\t\t\t\tcandidateCount: targets.length,\n\t\t\t\t\tcollectionClosesAt: operation.collectionClosesAt,",
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
		from: "if (operation.targetSetVersion === 1 && isMultiTargetLiveStatus(operation.status)) {\n\t\t\t\t\t\tthis._cancelMultiTargetOperationForLifecycle({\n\t\t\t\t\t\t\toperation,\n\t\t\t\t\t\t\tactorAccountId: account.id,\n\t\t\t\t\t\t\tisAll: true,\n\t\t\t\t\t\t});\n\t\t\t\t\t}",
		to: "void operation;",
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
