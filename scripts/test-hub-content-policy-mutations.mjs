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
		fs.cp(path.resolve("server/data"), path.join(root, "server/data"), {recursive: true}),
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

async function probeEditionSpoofing (variant) {
	const {evaluateCampaignContentEntity} = await variant.pImport("js/hub/hub-content-policy.js");
	const result = evaluateCampaignContentEntity({
		contentPolicy: {version: 1, sources: [], species: [], editions: ["2014"]},
		entity: {name: "Spoofed feat", source: "XPHB", edition: "classic"},
		kind: "feat",
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.equal(result.isAllowed, false, "client edition metadata overrode the authoritative source catalog");
}

async function probeCaseVariantSource (variant) {
	const {evaluateCampaignContentEntity} = await variant.pImport("js/hub/hub-content-policy.js");
	const result = evaluateCampaignContentEntity({
		contentPolicy: {version: 1, sources: [], species: [], editions: ["2024"]},
		entity: {name: "Case-variant feat", source: "phb", edition: "one"},
		kind: "feat",
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.equal(result.isAllowed, false, "a case-variant source bypassed canonical edition lookup");
}

async function probeSourceBearingFeature (variant) {
	const {getCharacterCampaignContentMutationCompliance} = await variant.pImport("js/hub/hub-content-policy.js");
	const report = getCharacterCampaignContentMutationCompliance({
		contentPolicy: {version: 1, sources: ["XPHB"], species: [], editions: ["2024"]},
		before: {features: []},
		after: {features: [{name: "Action Surge", source: "PHB", edition: "classic", featureType: "Class"}]},
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.ok(report.total > 0, "a source-bearing non-optional feature bypassed admission");
}

async function probeDerivedFeatureLevelFence (variant) {
	const {getCharacterCampaignContentMutationCompliance} = await variant.pImport("js/hub/hub-content-policy.js");
	const before = {classes: [{name: "Fighter", source: "XPHB", level: 1}], features: []};
	const getReport = after => getCharacterCampaignContentMutationCompliance({
		contentPolicy: {version: 1, sources: ["PHB"], species: [], editions: ["2014"]},
		before,
		after,
		availableSources: ["PHB", "XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.equal(getReport({
		classes: [{name: "Fighter", source: "XPHB", level: 1}],
		features: [{name: "Fighting Style", source: "XPHB", edition: "one", featureType: "Class"}],
	}).total, 0, "an unchanged legacy class could not persist deterministic feature repair");
	assert.ok(getReport({
		classes: [{name: "Fighter", source: "XPHB", level: 2}],
		features: [{name: "Action Surge", source: "XPHB", edition: "one", featureType: "Class"}],
	}).total > 0, "a legacy class level-up inherited the old feature exemption");
}

async function probeOfficialSourceProtection (variant) {
	const {pGetCampaignContentCatalog} = await variant.pImport("server/src/campaign-content-policy.js");
	const catalog = await pGetCampaignContentCatalog({
		brewBundle: {
			content: [{
				body: {
					_meta: {edition: "one"},
					feat: [{name: "Campaign feat referencing PHB", source: "PHB"}],
				},
			}],
		},
	});
	assert.equal(catalog.sourceEditions.PHB, "2014", "campaign brew overwrote an official source edition");
}

async function probeGrandfatheredReplacement (variant) {
	const {getCharacterCampaignContentMutationCompliance} = await variant.pImport("js/hub/hub-content-policy.js");
	const before = {race: {name: "High", source: "PHB", _baseName: "Elf", _baseSource: "PHB"}};
	const after = structuredClone(before);
	after.race._baseSource = "XPHB";
	const report = getCharacterCampaignContentMutationCompliance({
		contentPolicy: {version: 1, sources: ["PHB"], species: [], editions: ["2014"]},
		before,
		after,
		availableSources: ["PHB", "XPHB"],
		availableSpecies: ["Elf (High)|PHB", "Elf (High)|XPHB"],
		sourceEditions: {PHB: "2014", XPHB: "2024"},
	});
	assert.ok(report.total > 0, "a species identity replacement inherited the old content exemption");
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

async function probeAccessLossTeardown (variant) {
	const source = await fs.readFile(path.join(variant.root, "js/charactersheet/charactersheet.js"), "utf8");
	const methods = getCharacterSheetLifecycleMethods(source);
	// eslint-disable-next-line no-new-func
	const lifecycle = Function("JqueryUtil", `"use strict"; return ({${methods}});`)({doToast: () => {}});
	let teardownCalls = 0;
	const page = {
		...lifecycle,
		_hubEffects: null,
		_peerTargeting: null,
		_hubCampaignId: "campaign-1",
		_hubActiveCampaign: {
			pHandleAccessLoss: async ({campaignId}) => {
				assert.equal(campaignId, "campaign-1");
				teardownCalls++;
			},
		},
		_teardownHubRules: () => {},
	};
	page._onHubRealtimeConnectionState({state: "access_lost"});
	await Promise.resolve();
	assert.equal(teardownCalls, 1, "realtime access loss skipped authoritative campaign teardown");
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
				"\t\tentry.kind,\n\t\tnormalizeComparable(result.entity.uid)",
				"\t\tentry.kind,\n\t\tentry.provenance,\n\t\tnormalizeComparable(result.entity.uid)",
			),
		},
	},
	{
		name: "client-edition-overrides-catalog",
		probe: probeEditionSpoofing,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				"\tif (authoritativeEdition && declaredEdition && authoritativeEdition !== declaredEdition) return null;\n\treturn authoritativeEdition || declaredEdition;",
				"\treturn declaredEdition || authoritativeEdition;",
			),
		},
	},
	{
		name: "case-variant-source-skips-catalog",
		probe: probeCaseVariantSource,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				"\tconst source = getKnownCanonical(rawSource, availableSources) || rawSource;",
				"\tconst source = rawSource;",
			),
		},
	},
	{
		name: "source-bearing-feature-omitted",
		probe: probeSourceBearingFeature,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				/\tfor \(const feature of character\?\.features \|\| \[\]\) \{[\s\S]*?\n\t\}/,
				"\taddAll((character?.features || []).filter(feature => feature?.featureType === \"Optional Feature\"), \"optionalFeature\");",
			),
		},
	},
	{
		name: "derived-feature-level-fence-removed",
		probe: probeDerivedFeatureLevelFence,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				"\n\t\t\t&& Number(clsBefore.level || 0) === Number(clsAfter.level || 0),",
				",",
			),
		},
	},
	{
		name: "campaign-brew-overwrites-official-edition",
		probe: probeOfficialSourceProtection,
		mutations: {
			"server/src/campaign-content-policy.js": source => source.replace(
				/\t\tif \(protectedId\) \{[\s\S]*?\n\t\t\}/,
				"\t\tif (protectedId) {\n\t\t\tif (edition) catalog.sourceEditions.set(protectedId, edition);\n\t\t\treturn protectedId;\n\t\t}",
			),
		},
	},
	{
		name: "grandfathering-ignores-species-identity",
		probe: probeGrandfatheredReplacement,
		mutations: {
			"js/hub/hub-content-policy.js": source => source.replace(
				/function getContentCountKey \(\{entry, result\}\) \{[\s\S]*?\n\}\n\nfunction sortFindings/,
				"function getContentCountKey ({entry}) {\n\treturn `" + "$" + "{entry.kind}\\u0000" + "$" + "{normalizeComparable(entry.uid)}`;\n}\n\nfunction sortFindings",
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
		name: "access-loss-full-teardown-skipped",
		probe: probeAccessLossTeardown,
		mutations: {
			"js/charactersheet/charactersheet.js": source => source.replace(
				"\t\t\tif (this._hubActiveCampaign?.pHandleAccessLoss) {",
				"\t\t\tif (false && this._hubActiveCampaign?.pHandleAccessLoss) {",
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
