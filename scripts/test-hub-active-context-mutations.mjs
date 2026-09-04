import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_B = "44444444-4444-4444-8444-444444444444";

class MemoryStorage {
	constructor () { this._values = new Map(); }
	getItem (key) { return this._values.get(key) ?? null; }
	setItem (key, value) { this._values.set(key, value); }
	removeItem (key) { this._values.delete(key); }
}

class SilentChannel {
	onMessage () { return () => {}; }
	post () {}
	close () {}
}

function getApi ({accountId = ACCOUNT_A, campaigns = {}} = {}) {
	return {
		pGetSession: async () => ({signedIn: true, account: {id: accountId}}),
		pGetCampaign: async ({campaignId}) => {
			const campaign = campaigns[campaignId];
			if (campaign?.then) return campaign;
			if (campaign) return campaign;
			throw Object.assign(new Error("campaign missing"), {code: "CAMPAIGN_NOT_FOUND", status: 404});
		},
		pGetCampaignContext: async () => ({rulesVersion: null, brewBundle: null}),
	};
}

function getContextFactory () {
	return ({context}) => ({
		context,
		pActivate: async () => context,
		dispose: () => {},
	});
}

async function loadCoordinatorVariant ({name, mutate = source => source}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-context-mutation-${name}-`));
	const hubDir = path.join(root, "hub");
	await fs.cp(path.resolve("js/hub"), hubDir, {recursive: true});
	await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
	const coordinatorPath = path.join(hubDir, "hub-active-campaign-coordinator.js");
	const source = await fs.readFile(coordinatorPath, "utf8");
	const mutated = mutate(source);
	if (mutated === source && !name.startsWith("baseline")) throw new Error(`${name} mutation did not match source.`);
	await fs.writeFile(coordinatorPath, mutated);
	const [{HubActiveCampaignCoordinator, TEARDOWN_MARKERS}, {HubActiveCampaignStore}] = await Promise.all([
		import(`${pathToFileURL(coordinatorPath).href}?variant=${encodeURIComponent(name)}`),
		import(pathToFileURL(path.join(hubDir, "hub-active-campaign-store.js")).href),
	]);
	return {
		HubActiveCampaignCoordinator,
		HubActiveCampaignStore,
		TEARDOWN_MARKERS,
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

async function loadModuleVariant ({name, sourcePath, mutate = source => source}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-context-mutation-${name}-`));
	await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
	const sourcePathAbsolute = path.resolve(sourcePath);
	const moduleDir = path.join(root, path.basename(path.dirname(sourcePathAbsolute)));
	await fs.cp(path.dirname(sourcePathAbsolute), moduleDir, {recursive: true});
	const modulePath = path.join(moduleDir, path.basename(sourcePathAbsolute));
	const source = await fs.readFile(modulePath, "utf8");
	const mutated = mutate(source);
	if (mutated === source && !name.startsWith("baseline")) throw new Error(`${name} mutation did not match source.`);
	await fs.writeFile(modulePath, mutated);
	return {
		module: await import(`${pathToFileURL(modulePath).href}?variant=${encodeURIComponent(name)}`),
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

function getCoordinator ({Variant, api, host = {}, storage = new MemoryStorage()}) {
	const store = new Variant.HubActiveCampaignStore({
		storage,
		locks: null,
		writerId: "55555555-5555-4555-8555-555555555555",
		fnDelay: async () => {},
	});
	const coordinator = new Variant.HubActiveCampaignCoordinator({
		api,
		host,
		store,
		channel: new SilentChannel(),
		fnCreateContext: getContextFactory(),
	});
	return {coordinator, store};
}

async function probeGeneration (Variant) {
	let resolveA;
	const pendingA = new Promise(resolve => { resolveA = resolve; });
	let markARequested;
	const isARequested = new Promise(resolve => { markARequested = resolve; });
	const api = getApi({campaigns: {
		[CAMPAIGN_A]: pendingA,
		[CAMPAIGN_B]: {id: CAMPAIGN_B, status: "active", role: "dm"},
	}});
	const pGetCampaign = api.pGetCampaign;
	api.pGetCampaign = args => {
		if (args.campaignId === CAMPAIGN_A) markARequested();
		return pGetCampaign(args);
	};
	const {coordinator} = getCoordinator({
		Variant,
		api,
		host: {
			isContextHost: false,
			getExplicitCampaignId: () => CAMPAIGN_A,
			isResourcePinned: () => false,
		},
	});
	const staleResolve = coordinator.pResolve();
	await isARequested;
	await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
	resolveA({id: CAMPAIGN_A, status: "active", role: "dm"});
	await staleResolve;
	assert.equal(coordinator.activeCampaignId, CAMPAIGN_B, "a stale completion displaced the winning campaign");
	coordinator.dispose();
}

async function probeTeardown (Variant) {
	assert.deepEqual(Variant.TEARDOWN_MARKERS, [
		"teardown-generation",
		"teardown-realtime",
		"teardown-projections",
		"teardown-rules",
		"teardown-brew",
	]);
	const order = [];
	const api = getApi({campaigns: {
		[CAMPAIGN_A]: {id: CAMPAIGN_A, status: "active", role: "dm"},
		[CAMPAIGN_B]: {id: CAMPAIGN_B, status: "active", role: "dm"},
	}});
	const {coordinator} = getCoordinator({
		Variant,
		api,
		host: {
			getExplicitCampaignId: () => CAMPAIGN_A,
			isResourcePinned: () => false,
			pTeardownRealtime: async () => order.push("realtime"),
			pTeardownProjections: async () => order.push("projections"),
			pTeardownRules: async () => order.push("rules"),
			pTeardownBrew: async () => order.push("brew"),
		},
	});
	await coordinator.pResolve();
	await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
	assert.deepEqual(order, ["realtime", "projections", "rules", "brew"]);
	coordinator.dispose();
}

async function probeAccountScope (Variant) {
	const storage = new MemoryStorage();
	const seeded = getCoordinator({
		Variant,
		api: getApi({accountId: ACCOUNT_A}),
		storage,
	});
	await seeded.store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
	seeded.coordinator.dispose();

	const current = getCoordinator({
		Variant,
		api: getApi({accountId: ACCOUNT_B}),
		storage,
	});
	await current.coordinator.pResolve();
	assert.equal(current.coordinator.state, "local");
	assert.deepEqual(current.store.readForAccount(ACCOUNT_B), {
		...current.store.readForAccount(ACCOUNT_B),
		accountId: ACCOUNT_B,
		campaignId: null,
		state: "cleared",
	});
	current.coordinator.dispose();
}

async function probeLocalFallback (Variant) {
	const {coordinator} = getCoordinator({Variant, api: getApi()});
	await coordinator.pResolve();
	assert.equal(coordinator.state, "local");
	assert.equal(coordinator.activeCampaignId, null);
	coordinator.dispose();
}

async function probePinnedReselection (Variant) {
	const api = getApi({campaigns: {
		[CAMPAIGN_A]: {id: CAMPAIGN_A, status: "active", role: "dm"},
		[CAMPAIGN_B]: {id: CAMPAIGN_B, status: "active", role: "dm"},
	}});
	const {coordinator, store} = getCoordinator({
		Variant,
		api,
		host: {
			getExplicitCampaignId: () => CAMPAIGN_A,
			isResourcePinned: () => true,
		},
	});
	await coordinator.pResolve();

	await coordinator.pSwitchTo({campaignId: CAMPAIGN_B});
	await coordinator.pSwitchTo({campaignId: CAMPAIGN_A});
	assert.equal(coordinator.state, "active");
	assert.equal(coordinator.pendingCampaignId, null);
	assert.equal(store.readForAccount(ACCOUNT_A)?.campaignId, CAMPAIGN_A);

	await coordinator.pSwitchToLocal();
	await coordinator.pSwitchTo({campaignId: CAMPAIGN_A});
	assert.equal(coordinator.state, "active");
	assert.equal(coordinator.pendingCampaignId, null);
	assert.equal(store.readForAccount(ACCOUNT_A)?.campaignId, CAMPAIGN_A);
	coordinator.dispose();
}

async function probeCharacterSaveFence (Variant) {
	const sheet = {_currentCharacterId: "private-character", _characterLoadGeneration: 1};
	const saveFence = Variant.getCharacterSaveFence(sheet);
	sheet._characterLoadGeneration++;
	assert.equal(
		Variant.isCharacterSaveFenceCurrent({sheet, saveFence}),
		false,
		"a save fence survived character teardown",
	);
}

async function probeDmScreenSaveFence (Variant) {
	let rejectSave;
	const pendingSave = new Promise((_resolve, reject) => { rejectSave = reject; });
	let promptCount = 0;
	const originals = {
		InputUiUtil: globalThis.InputUiUtil,
		DataUtil: globalThis.DataUtil,
		JqueryUtil: globalThis.JqueryUtil,
		VeCt: globalThis.VeCt,
	};
	globalThis.InputUiUtil = {pGetUserBoolean: async () => { promptCount++; return null; }};
	globalThis.DataUtil = {userDownload: () => {}};
	globalThis.JqueryUtil = {doToast: () => {}};
	globalThis.VeCt = {STR_SEE_CONSOLE: "See console."};
	const board = {
		_workspaceRepository: {
			pSet: async () => pendingSave,
			pResolveConflict: async () => null,
		},
		getSaveableState: () => ({private: true}),
		_saveGeneration: 1,
		_savedGeneration: 0,
		_isPersistenceFenced: false,
	};
	try {
		const operation = Variant.pDoDmScreenWorkspaceSave({board, saveGeneration: 1});
		board._isPersistenceFenced = true;
		const conflict = Object.assign(new Error("conflict"), {
			code: "WORKSPACE_CONFLICT",
			recovery: {local: {private: true}},
		});
		rejectSave(conflict);
		await operation;
		assert.equal(promptCount, 0, "a fenced workspace save opened a conflict prompt");
		assert.equal(board._savedGeneration, 0, "a fenced workspace save mutated saved state");
	} finally {
		globalThis.InputUiUtil = originals.InputUiUtil;
		globalThis.DataUtil = originals.DataUtil;
		globalThis.JqueryUtil = originals.JqueryUtil;
		globalThis.VeCt = originals.VeCt;
	}
}

const coordinatorMutations = [
	{
		name: "generation-fence",
		probe: probeGeneration,
		mutate: source => source.replace(
			"if (!this._isDisposed && generation === this._generation) return true;",
			"if (!this._isDisposed) return true;",
		),
	},
	{
		name: "teardown-order",
		probe: probeTeardown,
		mutate: source => source.replace(
			"\"teardown-realtime\",\n\t\"teardown-projections\",",
			"\"teardown-projections\",\n\t\"teardown-realtime\",",
		),
	},
	{
		name: "account-scope",
		probe: probeAccountScope,
		mutate: source => source.replace(
			"if (stored && stored.accountId !== accountId) {",
			"if (stored && stored.accountId === accountId) {",
		),
	},
	{
		name: "local-fallback",
		probe: probeLocalFallback,
		mutate: source => source.replace("if (!candidate) {", "if (candidate) {"),
	},
	{
		name: "pinned-reselection",
		probe: probePinnedReselection,
		mutate: source => source.replace(
			"if (isRuntimeCampaignActive && isAlreadySelected && this._state === \"active\" && this._pendingCampaignId == null) {",
			"if (isRuntimeCampaignActive) {",
		),
	},
];

const moduleMutations = [
	{
		name: "character-save-fence",
		sourcePath: "js/charactersheet/charactersheet-persistence-fence.js",
		probe: probeCharacterSaveFence,
		mutate: source => source.replace(
			"return sheet._currentCharacterId === saveFence.characterId\n\t\t&& sheet._characterLoadGeneration === saveFence.loadGeneration;",
			"return true;",
		),
	},
	{
		name: "dmscreen-save-fence",
		sourcePath: "js/dmscreen/dmscreen-workspace-persistence.js",
		probe: probeDmScreenSaveFence,
		mutate: source => source.replace(
			"return !board._isPersistenceFenced && saveGeneration === board._saveGeneration;",
			"return true;",
		),
	},
];

const baseline = await loadCoordinatorVariant({name: "baseline"});
try {
	for (const {probe} of coordinatorMutations) await probe(baseline);
} finally {
	await baseline.cleanup();
}

const survivors = [];
for (const mutation of coordinatorMutations) {
	const variant = await loadCoordinatorVariant(mutation);
	try {
		await mutation.probe(variant);
		survivors.push(mutation.name);
		process.stderr.write(`SURVIVED ${mutation.name}\n`);
	} catch {
		process.stdout.write(`KILLED ${mutation.name}\n`);
	} finally {
		await variant.cleanup();
	}
}

for (const mutation of moduleMutations) {
	const baselineModule = await loadModuleVariant({
		name: `baseline-${mutation.name}`,
		sourcePath: mutation.sourcePath,
	});
	try {
		await mutation.probe(baselineModule.module);
	} finally {
		await baselineModule.cleanup();
	}

	const variant = await loadModuleVariant(mutation);
	try {
		await mutation.probe(variant.module);
		survivors.push(mutation.name);
		process.stderr.write(`SURVIVED ${mutation.name}\n`);
	} catch {
		process.stdout.write(`KILLED ${mutation.name}\n`);
	} finally {
		await variant.cleanup();
	}
}

assert.deepEqual(survivors, [], `Mutation survivors: ${survivors.join(", ")}`);
const mutationCount = coordinatorMutations.length + moduleMutations.length;
process.stdout.write(`${mutationCount}/${mutationCount} high-risk active-context mutants killed.\n`);
