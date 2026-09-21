import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const MUTATIONS = [
	{
		name: "skip-current-role-recheck",
		file: "server/src/memory-hub-store.js",
		from: "if (![\"dm\", \"co_dm\"].includes(membership.role)) {",
		to: "if (false) {",
		test: "test/jest/hub/HubSemanticOperations.test.js",
		pattern: "allows co-DM direct operations",
	},
	{
		name: "event-before-canonical-revision",
		file: "server/src/memory-hub-store.js",
		from: "this._setCharacterData({character: target, data});\n\t\t\ttarget.revision++;\n\t\t\ttarget.updatedAt = now.toISOString();",
		to: "this._setCharacterData({character: target, data});\n\t\t\ttarget.updatedAt = now.toISOString();",
		test: "test/jest/hub/HubSemanticOperations.test.js",
		pattern: "applies DM operations atomically",
	},
	{
		name: "changed-body-idempotency",
		file: "server/src/memory-hub-store.js",
		from: "if (prior.actorAccountId !== accountId || prior.requestHash !== normalized.requestHash) {",
		to: "if (prior.actorAccountId !== accountId) {",
		test: "test/jest/hub/HubSemanticOperations.test.js",
		pattern: "applies DM operations atomically",
	},
	{
		name: "projected-fields-in-invalidation",
		file: "server/src/memory-hub-store.js",
		from: "type: \"character.projection.invalidated\",\n\t\t\taggregateType: \"campaign\",\n\t\t\taggregateId: character.campaignId,\n\t\t\taggregateRevision: null,\n\t\t\tvisibility: \"explicit_accounts\",\n\t\t\tvisibleAccountIds,\n\t\t\tpayload: {},",
		to: "type: \"character.projection.invalidated\",\n\t\t\taggregateType: \"campaign\",\n\t\t\taggregateId: character.campaignId,\n\t\t\taggregateRevision: null,\n\t\t\tvisibility: \"explicit_accounts\",\n\t\t\tvisibleAccountIds,\n\t\t\tpayload: {characterId: character.id},",
		test: "test/jest/hub/HubSemanticOperations.test.js",
		pattern: "applies DM operations atomically",
	},
	{
		name: "apply-with-unknown-coverage",
		file: "js/hub/hub-character-operation-reconciler.js",
		from: "if (!Number.isInteger(revision)) return TRACK_DECISION.RESYNC;",
		to: "if (!Number.isInteger(revision)) return TRACK_DECISION.APPLY;",
		test: "test/jest/hub/HubCharacterOperationReconciler.test.js",
		pattern: "requires a resync when any single track",
	},
	{
		name: "omit-live-track",
		file: "js/hub/hub-http-character-repository.js",
		from: "if (liveData !== undefined) tracks.live = {data: liveData, coverage: book.live};",
		to: "if (false && liveData !== undefined) tracks.live = {data: liveData, coverage: book.live};",
		test: "test/jest/hub/HubCharacterOperationReconciliation.test.js",
		pattern: "advances the accepted base and the live document together",
	},
	{
		name: "adopt-unchanged-live-track",
		file: "js/hub/hub-http-character-repository.js",
		from: "if (Object.hasOwn(plan.staged, \"live\") && plan.changedTracks?.live !== false && typeof fnAdoptLive === \"function\") {",
		to: "if (Object.hasOwn(plan.staged, \"live\") && typeof fnAdoptLive === \"function\") {",
		test: "test/jest/hub/HubCharacterOperationReconciliation.test.js",
		pattern: "advances no-op coverage without adopting an unchanged live document",
	},
	{
		name: "omit-latest-submitted-track",
		file: "js/hub/hub-http-character-repository.js",
		from: "if (this._latestSubmitted.has(canonicalId)) tracks.latestSubmitted = {data: this._latestSubmitted.get(canonicalId), coverage: book.latestSubmitted};",
		to: "if (false) tracks.latestSubmitted = {data: this._latestSubmitted.get(canonicalId), coverage: book.latestSubmitted};",
		test: "test/jest/hub/HubCharacterOperationReconciliation.test.js",
		pattern: "carries a target leg through the in-flight latest-submitted track",
	},
	{
		name: "omit-recovery-track",
		file: "js/hub/hub-http-character-repository.js",
		from: "for (const [index, command] of (recoveryQueueEntry?.queue || []).entries()) {\n\t\t\tworking[this._getRecoveryCommandTrackName({index, part: \"base\"})]",
		to: "for (const [index, command] of [].entries()) {\n\t\t\tworking[this._getRecoveryCommandTrackName({index, part: \"base\"})]",
		test: "test/jest/hub/HubCharacterOperationReconciliation.test.js",
		pattern: "advances every queued command through a multi-operation resync",
	},
	{
		name: "omit-post-await-character-fence",
		file: "js/charactersheet/charactersheet.js",
		from: "if (\n\t\t\t\t\tcharacterId !== this._currentCharacterId\n\t\t\t\t\t|| generation !== this._characterLoadGeneration\n\t\t\t\t\t|| realtimeGeneration !== this._hubRealtimeGeneration\n\t\t\t\t) return false;",
		to: "if (false) return false;",
		test: "test/jest/charactersheet/CharacterSheetRealtimeApply.test.js",
		pattern: "fences a queued approval response after realtime access is lost",
	},
	{
		name: "duplicate-render-and-notice",
		file: "js/charactersheet/charactersheet.js",
		from: "case \"suppressed\":\n\t\t\t\tif (event.leg !== \"source\") this._hubEffects?.onAuthoritativeCoverage({operationId: event.operationId});",
		to: "case \"suppressed\":\n\t\t\t\tif (event.payload?.operation) this._hubEffects?.onApplied({operation: event.payload.operation});",
		test: "test/jest/charactersheet/CharacterSheetRealtimeApply.test.js",
		pattern: "deduplicates an approval response when its socket edge wins the race",
	},
];

async function copyTree (root) {
	for (const entry of ["js", "server", "test/jest"]) {
		await fs.cp(path.join(ROOT, entry), path.join(root, entry), {recursive: true});
	}
	for (const file of ["package.json", "jest.config.json"]) {
		await fs.copyFile(path.join(ROOT, file), path.join(root, file));
	}
	await fs.symlink(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
}

function runProbe ({root, mutation}) {
	const result = spawnSync(process.execPath, [
		"--localstorage-file", "test/localstorage.tmp",
		"--experimental-vm-modules",
		"node_modules/jest/bin/jest.js",
		mutation.test,
		"--runInBand",
		"--no-coverage",
		"--forceExit",
		"--testNamePattern", mutation.pattern,
	], {
		cwd: root,
		encoding: "utf8",
		env: {...process.env, FORCE_COLOR: "0"},
	});
	return result.status === 0;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-semantic-mutations-"));
try {
	await copyTree(root);
	const baseline = new Map();
	for (const mutation of MUTATIONS) {
		if (!baseline.has(mutation.file)) {
			baseline.set(mutation.file, await fs.readFile(path.join(root, mutation.file), "utf8"));
		}
		assert.equal(runProbe({root, mutation}), true, `Baseline probe failed: ${mutation.name}`);
	}

	const survivors = [];
	for (const mutation of MUTATIONS) {
		const source = baseline.get(mutation.file);
		const changed = source.replace(mutation.from, mutation.to);
		assert.notEqual(changed, source, `${mutation.name} mutation did not match ${mutation.file}`);
		await fs.writeFile(path.join(root, mutation.file), changed);
		const survived = runProbe({root, mutation});
		await fs.writeFile(path.join(root, mutation.file), source);
		if (survived) {
			survivors.push(mutation.name);
			process.stderr.write(`SURVIVED ${mutation.name}\n`);
		} else {
			process.stdout.write(`KILLED ${mutation.name}\n`);
		}
	}

	assert.deepEqual(survivors, [], `Mutation survivors: ${survivors.join(", ")}`);
	process.stdout.write(`${MUTATIONS.length}/${MUTATIONS.length} high-risk semantic-operation mutants killed.\n`);
} finally {
	await fs.rm(root, {recursive: true, force: true});
}
