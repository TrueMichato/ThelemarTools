import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

async function loadStoreVariant ({name, mutate = source => source}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-entitlement-mutation-${name}-`));
	const sourceDir = path.join(root, "server", "src");
	await fs.mkdir(path.dirname(sourceDir), {recursive: true});
	await fs.cp(path.resolve("server/src"), sourceDir, {recursive: true});
	await fs.mkdir(path.join(root, "server", "data"), {recursive: true});
	await fs.copyFile(
		path.resolve("server/data/campaign-content-site-catalog.json"),
		path.join(root, "server", "data", "campaign-content-site-catalog.json"),
	);
	await fs.mkdir(path.join(root, "js"), {recursive: true});
	await fs.cp(path.resolve("js/hub"), path.join(root, "js", "hub"), {recursive: true});
	for (const fileName of [
		"parser.js",
		"utils.js",
		"charactersheet/charactersheet-state.js",
		"charactersheet/charactersheet-class-utils.js",
	]) {
		const target = path.join(root, "js", fileName);
		await fs.mkdir(path.dirname(target), {recursive: true});
		await fs.copyFile(path.resolve("js", fileName), target);
	}
	await fs.symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
	await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
	const storePath = path.join(sourceDir, "memory-hub-store.js");
	const source = await fs.readFile(storePath, "utf8");
	const mutated = mutate(source);
	if (mutated === source && name !== "baseline") throw new Error(`${name} mutation did not match source.`);
	await fs.writeFile(storePath, mutated);
	return {
		MemoryHubStore: (await import(`${pathToFileURL(storePath).href}?variant=${encodeURIComponent(name)}`)).MemoryHubStore,
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

async function pCreateFixture (MemoryHubStore, {fnBeforeSensitiveCommit = null} = {}) {
	let now = new Date("2026-09-20T10:00:00.000Z");
	const store = new MemoryHubStore({
		fnNow: () => new Date(now),
		fnBeforeSensitiveCommit,
		isAccountEntitlementsEnabled: true,
	});
	const operator = await store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: `operator-${crypto.randomUUID()}`,
		displayName: "Operator",
	});
	const target = await store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: `target-${crypto.randomUUID()}`,
		displayName: "Target",
	});
	await store.pReconcileConfiguredOperatorEntitlements({accountIds: [operator.id]});
	const [identity] = await store.pListExternalIdentities({accountId: operator.id});
	const session = await store.pCreateSession({
		accountId: operator.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(now.getTime() + 60 * 60_000),
		authenticatedViaIdentityId: identity.id,
		recentReauthenticatedAt: now,
	});
	return {
		store,
		operator,
		target,
		session,
		advancePastFreshness: () => {
			now = new Date(now.getTime() + 5 * 60_000 + 1);
		},
	};
}

async function expectCode (promise, code) {
	let error = null;
	try {
		await promise;
	} catch (caught) {
		error = caught;
	}
	assert.equal(error?.code, code);
}

async function probeFreshness (MemoryHubStore) {
	let advancePastFreshness;
	const fixture = await pCreateFixture(MemoryHubStore, {
		fnBeforeSensitiveCommit: async () => advancePastFreshness(),
	});
	advancePastFreshness = fixture.advancePastFreshness;
	await expectCode(fixture.store.pGrantAccountEntitlement({
		accountId: fixture.operator.id,
		sessionId: fixture.session.id,
		targetAccountId: fixture.target.id,
		entitlementName: "campaign:create",
		idempotencyKey: "freshness-probe",
	}), "REAUTHENTICATION_REQUIRED");
}

async function probeLastOperator (MemoryHubStore) {
	const fixture = await pCreateFixture(MemoryHubStore);
	await expectCode(fixture.store.pRevokeAccountEntitlement({
		accountId: fixture.operator.id,
		sessionId: fixture.session.id,
		targetAccountId: fixture.operator.id,
		entitlementName: "platform:operate",
		idempotencyKey: "last-operator-probe",
	}), "LAST_OPERATOR_PROTECTED");
}

const variants = [
	{
		name: "baseline",
		mutate: source => source,
		expected: "pass",
	},
	{
		name: "missing-commit-time-freshness",
		mutate: source => source.replace(
			/(\t\tconst concurrentPrior = this\._getReceipt\(\{accountId, idempotencyKey\}\);\n\t\tif \(concurrentPrior\) return concurrentPrior;\n\t\tthis\._assertActiveOperator\(accountId\);\n)\t\tthis\._assertFreshReauthentication\(\{accountId, sessionId\}\);(\n\t\tlet entitlement)/,
			"$1$2",
		),
		expected: "fail",
		probe: probeFreshness,
	},
	{
		name: "missing-last-operator-guard",
		mutate: source => source.replaceAll(")).length <= 1", ")).length < 1"),
		expected: "fail",
		probe: probeLastOperator,
	},
];

let killed = 0;
for (const variant of variants) {
	const loaded = await loadStoreVariant(variant);
	try {
		const probes = variant.probe ? [variant.probe] : [probeFreshness, probeLastOperator];
		let failure = null;
		try {
			for (const probe of probes) await probe(loaded.MemoryHubStore);
		} catch (error) {
			failure = error;
		}
		if (variant.expected === "pass") {
			if (failure) throw failure;
			process.stdout.write(`PASS ${variant.name}\n`);
			continue;
		}
		if (!failure) throw new Error(`${variant.name} survived its entitlement probe.`);
		killed++;
		process.stdout.write(`KILLED ${variant.name}: ${failure.message}\n`);
	} finally {
		await loaded.cleanup();
	}
}

assert.equal(killed, variants.length - 1);
process.stdout.write(`Killed ${killed}/${variants.length - 1} account-entitlement mutants.\n`);
