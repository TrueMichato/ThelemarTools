import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

async function loadVariant ({name, mutations = {}}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-content-mutation-${name}-`));
	await Promise.all([
		fs.cp(path.resolve("js/hub"), path.join(root, "js/hub"), {recursive: true}),
		fs.cp(path.resolve("server/src"), path.join(root, "server/src"), {recursive: true}),
		fs.mkdir(path.join(root, "js/charactersheet"), {recursive: true}),
	]);
	await Promise.all([
		fs.copyFile(
			path.resolve("js/charactersheet/charactersheet.js"),
			path.join(root, "js/charactersheet/charactersheet.js"),
		),
		fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"})),
	]);
	for (const [relativePath, mutate] of Object.entries(mutations)) {
		const filePath = path.join(root, relativePath);
		const source = await fs.readFile(filePath, "utf8");
		const mutated = mutate(source);
		if (mutated === source) throw new Error(`${name} mutation did not match ${relativePath}.`);
		await fs.writeFile(filePath, mutated);
	}
	return {
		root,
		pImport: relativePath => import(`${pathToFileURL(path.join(root, relativePath)).href}?variant=${encodeURIComponent(name)}`),
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

async function probeFiltering (variant) {
	const {filterCampaignContentEntities} = await variant.pImport("js/hub/hub-content-policy.js");
	const entities = [
		{name: "Allowed", source: "PHB", edition: "classic", __prop: "spell"},
		{name: "Denied", source: "XPHB", edition: "one", __prop: "spell"},
	];
	const filtered = filterCampaignContentEntities({
		contentPolicy: {version: 1, sources: ["PHB"], species: [], editions: ["2014"]},
		entities,
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.deepEqual(filtered.map(entity => entity.name), ["Allowed"], "a disallowed picker candidate survived filtering");
}

async function probeGrandfathering (variant) {
	const {getCharacterCampaignContentMutationCompliance} = await variant.pImport("js/hub/hub-content-policy.js");
	const spell = {name: "Legacy spell", source: "XPHB", edition: "one"};
	const before = {spellcasting: {spellsKnown: [{...spell, alwaysPrepared: true}]}};
	const after = {spellcasting: {spellsKnown: [{...spell}]}};
	const report = getCharacterCampaignContentMutationCompliance({
		contentPolicy: {version: 1, sources: ["PHB"], species: [], editions: ["2014"]},
		before,
		after,
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.equal(report.total, 0, "mutable client provenance turned grandfathered content into a new admission");
}

async function probeVersionFence (variant) {
	const {assertCampaignContentPolicyVersion} = await variant.pImport("server/src/campaign-content-policy.js");
	assert.throws(
		() => assertCampaignContentPolicyVersion({
			contentPolicy: {version: 1, sources: ["PHB"], species: [], editions: ["2014"]},
			activeRulesVersionId: "rules-current",
			rulesVersionId: "rules-stale",
		}),
		error => error?.code === "RULES_VERSION_STALE",
		"a stale policy pin was accepted",
	);
}

function getCharacterSheetLifecycleMethods (source) {
	const connectionStart = source.indexOf("\t_onHubRealtimeConnectionState (");
	const connectionEnd = source.indexOf("\n\n\t_applyHubContext (", connectionStart);
	const refreshStart = source.indexOf("\t_onHubCampaignContextChanged (", connectionEnd);
	const refreshEnd = source.indexOf("\n\n\t_onHubRealtimeDeliveryError (", refreshStart);
	if ([connectionStart, connectionEnd, refreshStart, refreshEnd].some(index => index < 0)) {
		throw new Error("Character Sheet campaign content lifecycle methods could not be extracted.");
	}
	return `${source.slice(connectionStart, connectionEnd)},\n${source.slice(refreshStart, refreshEnd)}`;
}

async function probeTeardownFence (variant) {
	const source = await fs.readFile(path.join(variant.root, "js/charactersheet/charactersheet.js"), "utf8");
	const methods = getCharacterSheetLifecycleMethods(source);
	// eslint-disable-next-line no-new-func
	const lifecycle = Function("JqueryUtil", `"use strict"; return ({${methods}});`)({doToast: () => {}});
	const refresh = new Promise(() => {});
	const page = {
		...lifecycle,
		_hubCampaignContext: {pRefresh: () => refresh},
		_hubContext: {rulesVersion: {id: "old"}},
		_hubContextGeneration: 0,
		_hubContextRefreshActiveGeneration: null,
		_isHubContextRefreshing: false,
		_isHubContextUnavailable: false,
		_isHubContextRevalidationRequired: false,
		_hubRealtimeGeneration: 0,
		_campaign: {render: () => {}},
		_characterRepository: {clearRealtimeReconciliation: () => {}},
		_currentCharacterId: "private-character",
		_clearHubRules ({isUnavailable = false} = {}) {
			this._hubContext = null;
			this._isHubContextUnavailable = isUnavailable;
		},
		_applyHubContext (context) {
			this._hubContext = context;
		},
		_renderCharacter: () => {},
	};
	page._onHubCampaignContextChanged();
	page._onHubRealtimeConnectionState({state: "closed"});
	assert.equal(page._hubContext, null, "a stale refresh restored policy after disconnect");
	assert.equal(page._isHubContextRefreshing, false, "disconnect left content filtering permanently refresh-locked");
	assert.equal(page._hubContextRefreshActiveGeneration, null, "disconnect retained a stale refresh generation");
}

const MUTANTS = [
	{
		name: "picker-filter-bypassed",
		probe: probeFiltering,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				"return entities.filter(entity => evaluateCampaignContentEntity({",
				"return entities.filter(entity => !evaluateCampaignContentEntity({",
			),
		},
	},
	{
		name: "grandfathering-trusts-client-provenance",
		probe: probeGrandfathering,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				"return `" + "$" + "{entry.kind}\\u0000" + "$" + "{normalizeComparable(entry.uid)}`;",
				"return `" + "$" + "{entry.kind}\\u0000" + "$" + "{entry.provenance}\\u0000" + "$" + "{normalizeComparable(entry.uid)}`;",
			),
		},
	},
	{
		name: "disconnect-refresh-lock-retained",
		probe: probeTeardownFence,
		mutations: {
			"js/charactersheet/charactersheet.js": source => source.replace(
				"\t\tthis._hubContextRefreshActiveGeneration = null;\n\t\tthis._isHubContextRefreshing = false;\n\t\tthis._characterRepository?.clearRealtimeReconciliation?.",
				"\t\tthis._characterRepository?.clearRealtimeReconciliation?.",
			),
		},
	},
	{
		name: "restrictive-policy-version-fence-removed",
		probe: probeVersionFence,
		mutations: {
			"server/src/campaign-content-policy.js": source => source.replace(
				"\tif (rulesVersionId === activeRulesVersionId) return;",
				"\treturn;",
			),
		},
	},
];

for (const mutant of MUTANTS) {
	const baseline = await loadVariant({name: `baseline-${mutant.name}`});
	try {
		await mutant.probe(baseline);
	} finally {
		await baseline.cleanup();
	}

	const variant = await loadVariant(mutant);
	try {
		let killed = false;
		try {
			await mutant.probe(variant);
		} catch {
			killed = true;
		}
		if (!killed) throw new Error(`${mutant.name} survived.`);
		process.stdout.write(`${mutant.name}: KILLED\n`);
	} finally {
		await variant.cleanup();
	}
}

process.stdout.write(`${MUTANTS.length}/${MUTANTS.length} campaign content policy mutants killed.\n`);
