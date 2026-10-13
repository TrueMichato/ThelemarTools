import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();

const MUTATIONS = [
	{
		name: "healing-word-xphb-mass-double-upcast",
		file: "js/hub/hub-healing-word-spells.js",
		from: "dicePerHigherLevel: 1, effectTemplateId: \"spell.mass-healing-word.heal\"",
		to: "dicePerHigherLevel: 2, effectTemplateId: \"spell.mass-healing-word.heal\"",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "matches exact checked-in base/upcast",
	},
	{
		name: "healing-word-mass-eight-targets",
		file: "js/hub/hub-healing-word-spells.js",
		from: "maxTargets: 6",
		to: "maxTargets: 8",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "permits six, rejects seven/eight",
	},
	{
		name: "healing-word-preparation-bypass",
		file: "server/src/semantic-operation-registry.js",
		from: "if (model === \"prepared\") return spell.prepared === true || spell.alwaysPrepared === true;",
		to: "if (model === \"prepared\") return true;",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "fails closed for malformed choices",
	},
	{
		name: "healing-word-mass-singular-route",
		file: "server/src/semantic-operation-registry.js",
		from: "if (template.multiTargetOnly) {",
		to: "if (false && template.multiTargetOnly) {",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "permits six, rejects seven/eight",
	},
	{
		name: "healing-word-wrong-minimum-one-floor",
		file: "server/src/semantic-operation-registry.js",
		from: "return {kind: \"hp.heal\", arguments: {amount: Math.max(count, amount)}};",
		to: "return {kind: \"hp.heal\", arguments: {amount: Math.max(1, amount)}};",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "applies the A5 selected-dice floor",
	},
	{
		name: "healing-word-omit-dice-floor",
		file: "server/src/semantic-operation-registry.js",
		from: "return {kind: \"hp.heal\", arguments: {amount: Math.max(count, amount)}};",
		to: "return {kind: \"hp.heal\", arguments: {amount}};",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "applies the A5 selected-dice floor",
	},
	{
		name: "healing-word-two-slot-cost",
		file: "server/src/semantic-operation-registry.js",
		from: "components: [{kind: \"spell_slot\", pool: \"standard\", level: choice.castLevel, amount: 1}],\n\t\t}),\n\t\tderiveOperation: ({sourceCharacter, choice, effectResolutionSeed}) => {\n\t\t\tconst count = dice",
		to: "components: [{kind: \"spell_slot\", pool: \"standard\", level: choice.castLevel, amount: 2}],\n\t\t}),\n\t\tderiveOperation: ({sourceCharacter, choice, effectResolutionSeed}) => {\n\t\t\tconst count = dice",
		test: "test/jest/hub/HubHealingWordTemplates.test.js",
		pattern: "matches exact checked-in base/upcast",
	},
	{
		name: "healing-word-browser-eight-targets",
		file: "js/charactersheet/charactersheet-peer-targeting.js",
		from: "const maxTargets = Math.min(descriptor.maxTargets || 8, 8);",
		to: "const maxTargets = 8;",
		test: "test/jest/charactersheet/CharacterSheetMultiTarget.test.js",
		pattern: "routes production.*six-candidate limit",
	},
	{
		name: "healing-word-mass-fenced-local-fallback",
		file: "js/charactersheet/charactersheet-peer-targeting.js",
		from: "&& (isSupportedSpellShape || descriptor)",
		to: "&& isSupportedSpellShape",
		test: "test/jest/charactersheet/CharacterSheetMultiTarget.test.js",
		pattern: "installed-authority fence",
	},
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
		from: "fnDeliver: () => {\n\t\t\t\tif (!_isHubOperationScopeCurrent(this, scope)) return false;\n\t\t\t\tconst isAuthorityStale",
		to: "fnDeliver: () => {\n\t\t\t\tconst isAuthorityStale",
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
	{
		name: "source-cost-mutate-before-resolve",
		file: "js/hub/hub-source-costs.js",
		from: "const resolved = resolveSourceCost({data, sourceCost});\n\tconst out = structuredClone(data);",
		to: "const out = structuredClone(data);\n\tconst resolved = {sourceCost: normalizeSourceCost(sourceCost), footprint: getSourceCostMutationFootprint(sourceCost)};",
		test: "test/jest/hub/HubSourceCosts.test.js",
		pattern: "resolves every component before staging any mutation",
	},
	{
		name: "source-cost-allow-ambiguous-entry",
		file: "js/hub/hub-source-costs.js",
		from: "if (matches.length !== 1) failUnavailable();",
		to: "if (!matches.length) failUnavailable();",
		test: "test/jest/hub/HubSourceCosts.test.js",
		pattern: "binds item costs to one exact entry",
	},
	{
		name: "source-cost-allow-unsafe-zero-removal",
		file: "js/hub/hub-source-costs.js",
		from: "if (quantity === component.amount && hasUnsafeZeroQuantityLink({data, entry})) failUnavailable();",
		to: "if (false && quantity === component.amount && hasUnsafeZeroQuantityLink({data, entry})) failUnavailable();",
		test: "test/jest/hub/HubSourceCosts.test.js",
		pattern: "allows safe full-stack consumption",
	},
	{
		name: "source-cost-omit-feature-mirror-validation",
		file: "js/hub/hub-source-costs.js",
		from: "if (featurePool.current !== pool.current || featurePool.max !== pool.max) failUnavailable();",
		to: "if (false) failUnavailable();",
		test: "test/jest/hub/HubSourceCosts.test.js",
		pattern: "requires one exact feature resource",
	},
	{
		name: "source-cost-omit-innate-mirror",
		file: "js/hub/hub-source-costs.js",
		from: "if (innateSpell) innateSpell.uses.current = resource.current;",
		to: "if (false && innateSpell) innateSpell.uses.current = resource.current;",
		test: "test/jest/hub/HubSourceCosts.test.js",
		pattern: "requires one exact feature resource",
	},
	{
		name: "source-cost-remove-permanent-invalidation",
		file: "server/src/memory-hub-store.js",
		from: "if (hasSourceCostBindingChanged({\n\t\t\t\tbeforeData: character.data,",
		to: "if (false && hasSourceCostBindingChanged({\n\t\t\t\tbeforeData: character.data,",
		test: "test/jest/hub/HubPeerSourceCostsAuthority.test.js",
		pattern: "permanently invalidates consent",
	},
	{
		name: "source-cost-skip-rederivation-check",
		file: "server/src/memory-hub-store.js",
		from: "!isCanonicalEqual(derived.operation, expectedOperation)",
		to: "false",
		test: "test/jest/hub/HubPeerSourceCostsAuthority.test.js",
		pattern: "rederives the pinned effect",
	},
	{
		name: "source-cost-leak-to-target-event",
		file: "server/src/memory-hub-store.js",
		from: "...(operation.sourceCost ? {leg: \"target\"} : {}),",
		to: "...(operation.sourceCost ? {leg: \"target\", sourceCost: copy(operation.sourceCost)} : {}),",
		test: "test/jest/hub/HubPeerSourceCostsAuthority.test.js",
		pattern: "atomically spends one slot",
	},
	{
		name: "omit-post-commit-authorization-teardown",
		file: "js/hub/hub-page.js",
		from: "if (campaignAuthorizationErrorHandler?.(refreshError)) return;",
		to: "",
		test: "test/jest/hub/HubDmEffectSubmission.test.js",
		pattern: "fences private campaign data",
	},
];

async function copyTree (root) {
	for (const entry of ["js", "server", "test/jest"]) {
		await fs.cp(path.join(ROOT, entry), path.join(root, entry), {recursive: true});
	}
	for (const file of ["package.json", "jest.config.json"]) {
		await fs.copyFile(path.join(ROOT, file), path.join(root, file));
	}
	await fs.mkdir(path.join(root, "data/spells"), {recursive: true});
	await fs.mkdir(path.join(root, "data/class"), {recursive: true});
	await fs.copyFile(path.join(ROOT, "data/class/class-paladin.json"), path.join(root, "data/class/class-paladin.json"));
	for (const source of ["phb", "xphb"]) {
		await fs.copyFile(path.join(ROOT, `data/spells/spells-${source}.json`), path.join(root, `data/spells/spells-${source}.json`));
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
	if (mutation.name === "omit-post-await-character-fence" && result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		process.stdout.write(output);
		assert.match(output, /expect\(jest\.fn\(\)\)\.not\.toHaveBeenCalled\(\)/, "The immediate scope-fence mutant must fail at the actual call-through repository spy.");
		assert.match(output, /Received number of calls:\s+[1-9]\d*/, "The immediate scope-fence mutant must reach the actual repository executor.");
	}
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
		const matches = source.split(mutation.from).length - 1;
		assert.equal(matches, mutation.expectedMatches ?? 1, `${mutation.name} has stale or ambiguous reach in ${mutation.file}`);
		process.stdout.write(`MATCHED ${mutation.name} ${matches} exact production occurrence(s).\n`);
		const changed = source.replaceAll(mutation.from, mutation.to);
		assert.notEqual(changed, source, `${mutation.name} mutation did not match ${mutation.file}`);
		let survived;
		try {
			await fs.writeFile(path.join(root, mutation.file), changed);
			survived = runProbe({root, mutation});
		} finally {
			await fs.writeFile(path.join(root, mutation.file), source);
			assert.equal(await fs.readFile(path.join(root, mutation.file), "utf8"), source, `${mutation.name} did not restore the candidate bytes`);
		}
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
