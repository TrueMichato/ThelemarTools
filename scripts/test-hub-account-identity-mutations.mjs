import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

async function loadStoreVariant ({name, mutate = files => files}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-identity-mutation-${name}-`));
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
	const policyPath = path.join(sourceDir, "account-identities.js");
	const originals = {
		store: await fs.readFile(storePath, "utf8"),
		policy: await fs.readFile(policyPath, "utf8"),
	};
	const mutated = mutate(originals);
	if (
		name !== "baseline"
		&& mutated.store === originals.store
		&& mutated.policy === originals.policy
	) throw new Error(`${name} mutation did not match source.`);
	await fs.writeFile(storePath, mutated.store);
	await fs.writeFile(policyPath, mutated.policy);
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
	});
	const account = await store.pUpsertOAuthAccount({
		provider: "github",
		providerSubject: `github-${crypto.randomUUID()}`,
		displayName: "Identity mutation account",
	});
	const [githubIdentity] = await store.pListExternalIdentities({accountId: account.id});
	const googleIdentity = {
		id: crypto.randomUUID(),
		accountId: account.id,
		provider: "google",
		subject: `google-${crypto.randomUUID()}`,
		handle: null,
		displayName: "Google identity",
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		lastAuthenticatedAt: now.toISOString(),
	};
	store._externalIdentities.set(googleIdentity.id, googleIdentity);
	store._identityToAccount.set(JSON.stringify([googleIdentity.provider, googleIdentity.subject]), account.id);
	const session = await store.pCreateSession({
		accountId: account.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(now.getTime() + 60 * 60_000),
		authenticatedViaIdentityId: googleIdentity.id,
		recentReauthenticatedAt: now,
	});
	return {
		store,
		account,
		githubIdentity,
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
	await expectCode(fixture.store.pUnlinkExternalIdentity({
		accountId: fixture.account.id,
		currentSessionId: fixture.session.id,
		identityId: fixture.githubIdentity.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(Date.now() + 60 * 60_000),
		idempotencyKey: "freshness-probe",
		retentionRequiredProviders: ["google"],
	}), "REAUTHENTICATION_REQUIRED");
}

async function probeRetention (MemoryHubStore) {
	const fixture = await pCreateFixture(MemoryHubStore);
	await expectCode(fixture.store.pUnlinkExternalIdentity({
		accountId: fixture.account.id,
		currentSessionId: fixture.session.id,
		identityId: fixture.githubIdentity.id,
		tokenHash: crypto.randomBytes(32).toString("hex"),
		expiresAt: new Date(Date.now() + 60 * 60_000),
		idempotencyKey: "retention-probe",
		retentionRequiredProviders: ["github"],
	}), "IDENTITY_RETENTION_REQUIRED");
}

const variants = [
	{
		name: "baseline",
		mutate: files => files,
		expected: "pass",
	},
	{
		name: "missing-unlink-commit-freshness",
		mutate: files => ({
			...files,
			store: files.store.replace(
				/(\t\t\t\t\tawait this\._pBeforeSensitiveCommit\(\);\n)\t\t\t\t\tthis\._assertFreshReauthentication\(\{accountId, sessionId: currentSessionId\}\);(\n\t\t\t\t\tconst currentIdentities)/,
				"$1$2",
			),
		}),
		expected: "fail",
		probe: probeFreshness,
	},
	{
		name: "missing-retention-guard",
		mutate: files => ({
			...files,
			policy: files.policy.replace(
				"retentionProviders.has(identity.provider)",
				"false",
			),
		}),
		expected: "fail",
		probe: probeRetention,
	},
];

let killed = 0;
for (const variant of variants) {
	const loaded = await loadStoreVariant(variant);
	try {
		const probes = variant.probe ? [variant.probe] : [probeFreshness, probeRetention];
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
		if (!failure) throw new Error(`${variant.name} survived its account-identity probe.`);
		killed++;
		process.stdout.write(`KILLED ${variant.name}: ${failure.message}\n`);
	} finally {
		await loaded.cleanup();
	}
}

assert.equal(killed, variants.length - 1);
process.stdout.write(`Killed ${killed}/${variants.length - 1} account-identity mutants.\n`);
