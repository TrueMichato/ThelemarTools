import {readdir, readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
	CAMPAIGN_CONTENT_RULE_IDS,
	canonicalizeCampaignSourceId,
	canonicalizeCampaignSpeciesUid,
	getCampaignContentPolicy,
	getCharacterCampaignContentCompliance,
	getCharacterCampaignContentMutationCompliance,
	isCampaignContentPolicyRestrictive,
} from "../../js/hub/hub-content-policy.js";
import {getCampaignRulesContentPolicy} from "../../js/hub/hub-campaign-rules.js";
import {HubStoreError} from "./hub-store-error.js";

const _DATA_ROOT = fileURLToPath(new URL("../../data/", import.meta.url));
const _LOCAL_BREW_ROOT = fileURLToPath(new URL("../../homebrew/", import.meta.url));
const _LOCAL_BREW_INDEX_PATH = fileURLToPath(new URL("../../homebrew/index.json", import.meta.url));
const _SITE_CATALOG_PATH = fileURLToPath(new URL("../data/campaign-content-site-catalog.json", import.meta.url));
const _ROOT_CONTENT_FILES = [
	"backgrounds.json",
	"crafting.json",
	"feats.json",
	"homecrafts.json",
	"items-base.json",
	"items.json",
	"items-variant-components-ar8.json",
	"magicvariants.json",
	"optionalfeatures.json",
	"races.json",
];
const _SOURCE_EDITION_OVERRIDES = Object.freeze({
	Ar8: "2014",
	Arcadia11: "2014",
	COMCRAF: "2014",
	HHbH: "2014",
	HHHVI: "2014",
	HHHVII: "2014",
	HHHVIII: "2014",
	TGTT: "2024",
	"TGTT-2014": "2014",
	"TGTT-2024": "2024",
});
const _MAX_CAMPAIGN_CATALOG_CACHE_ENTRIES = 64;
let _siteCatalogPromise = null;
const _campaignCatalogCache = new Map();

function walk (value, fnVisit) {
	if (Array.isArray(value)) {
		for (const item of value) walk(item, fnVisit);
		return;
	}
	if (!value || typeof value !== "object") return;
	fnVisit(value);
	for (const child of Object.values(value)) walk(child, fnVisit);
}

function getEdition (value) {
	if (value === "classic" || value === "2014") return "2014";
	if (value === "one" || value === "2024") return "2024";
	return null;
}

function addDocumentToCatalog (catalog, document, {
	fnGetSourceEdition = null,
	defaultEdition = null,
	protectedSources = null,
	protectedSourceIdsByLower = null,
} = {}) {
	catalog.sourceIdsByLower ||= new Map([...catalog.sources].map(source => [source.toLowerCase(), source]));
	const protectedIdsByLower = protectedSourceIdsByLower
		|| (protectedSources && new Map([...protectedSources].map(source => [source.toLowerCase(), source])));
	const documentEdition = getEdition(document?._meta?.edition);
	const addSource = (value, {metadata = null, isDeclaration = false} = {}) => {
		const id = canonicalizeCampaignSourceId(value);
		if (!id) return null;
		const edition = getEdition(metadata?.edition)
			|| fnGetSourceEdition?.(id)
			|| documentEdition
			|| defaultEdition;
		const protectedId = protectedIdsByLower?.get(id.toLowerCase());
		if (protectedId) {
			if (isDeclaration) {
				throw new HubStoreError("BREW_INVALID", `Campaign homebrew cannot redeclare an official source.`);
			}
			return protectedId;
		}
		const existingId = catalog.sourceIdsByLower.get(id.toLowerCase());
		const canonicalId = existingId || id;
		const existingEdition = catalog.sourceEditions.get(canonicalId);
		if (protectedSources && existingEdition && edition && existingEdition !== edition) {
			throw new HubStoreError("BREW_INVALID", `Campaign homebrew contains conflicting editions for one source.`);
		}
		catalog.sources.add(canonicalId);
		catalog.sourceIdsByLower.set(canonicalId.toLowerCase(), canonicalId);
		if (edition) catalog.sourceEditions.set(canonicalId, edition);
		return canonicalId;
	};
	for (const source of document?._meta?.sources || []) {
		addSource(source?.json, {metadata: source, isDeclaration: true});
	}
	walk(document, entity => {
		addSource(entity.source);
	});
	const getSubraceName = (raceName, subraceName) => {
		if (!subraceName) return raceName;
		const match = /^(.*?)(\(.*?\))$/i.exec(raceName || "");
		if (!match) return `${raceName} (${subraceName})`;
		return `${match[1]}(${match[2].slice(1, -1)}; ${subraceName})`;
	};
	const addSpecies = (name, source) => {
		const canonicalSource = addSource(source);
		if (!canonicalSource) return;
		const uid = canonicalizeCampaignSpeciesUid(`${name || ""}|${canonicalSource}`);
		if (uid) catalog.species.add(uid);
	};
	const addVersions = entity => {
		for (const version of entity?._versions || []) {
			if (version?.name) {
				addSpecies(version.name, version.source || entity.source);
				continue;
			}
			const abstract = version?._abstract;
			for (const implementation of version?._implementations || []) {
				let name = abstract?.name;
				for (const [key, value] of Object.entries(implementation?._variables || {})) {
					name = name?.replaceAll(`{{${key}}}`, `${value}`);
				}
				addSpecies(name, abstract?.source || entity.source);
			}
		}
	};
	const subracesByParent = new Map();
	for (const subrace of document?.subrace || []) {
		const raceName = subrace.raceName || subrace._copy?.raceName;
		const raceSource = subrace.raceSource || subrace._copy?.raceSource;
		if (!raceName || !raceSource) continue;
		const key = `${raceName.toLowerCase()}|${raceSource.toLowerCase()}`;
		const entries = subracesByParent.get(key) || [];
		entries.push(subrace);
		subracesByParent.set(key, entries);
	}
	for (const race of document?.race || []) {
		const key = `${`${race.name || ""}`.toLowerCase()}|${`${race.source || ""}`.toLowerCase()}`;
		const subraces = [...(race.subraces || []), ...(subracesByParent.get(key) || [])];
		const baseName = subraces.some(subrace => !subrace.name)
			? `${race.name} (Base)`
			: race.name;
		addSpecies(baseName, race.source);
		addVersions(race);
		for (const subrace of subraces) {
			if (!subrace.name) continue;
			addSpecies(getSubraceName(race.name, subrace.name), race.source);
			addVersions(subrace);
		}
	}
	for (const subrace of document?.subrace || []) {
		if (!subrace.name) continue;
		const raceName = subrace.raceName || subrace._copy?.raceName;
		const raceSource = subrace.raceSource || subrace._copy?.raceSource;
		addSpecies(raceName ? getSubraceName(raceName, subrace.name) : subrace.name, raceSource);
		addVersions(subrace);
	}
}

async function pReadJson (path) {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function pBuildCampaignContentSiteCatalog () {
	await import("../../js/parser.js");
	const threshold = new Date(globalThis.Parser.sourceJsonToDate(globalThis.Parser.SRC_XPHB));
	const catalog = {sources: new Set(), species: new Set(), sourceEditions: new Map(), sourceIdsByLower: new Map()};
	const classFiles = (await readdir(`${_DATA_ROOT}/class`))
		.filter(name => /^class-.*\.json$/.test(name))
		.map(name => `${_DATA_ROOT}/class/${name}`);
	const spellFiles = (await readdir(`${_DATA_ROOT}/spells`))
		.filter(name => /^spells-.*\.json$/.test(name))
		.map(name => `${_DATA_ROOT}/spells/${name}`);
	const localBrewIndex = await pReadJson(_LOCAL_BREW_INDEX_PATH);
	const localBrewFiles = (localBrewIndex?.toImport || [])
		.filter(name => typeof name === "string" && /^[^/\\]+\.json$/i.test(name))
		.map(name => `${_LOCAL_BREW_ROOT}/${name}`);
	const documents = await Promise.all([
		..._ROOT_CONTENT_FILES.map(name => pReadJson(`${_DATA_ROOT}/${name}`)),
		...classFiles.map(pReadJson),
		...spellFiles.map(pReadJson),
		...localBrewFiles.map(pReadJson),
	]);
	for (const document of documents) {
		addDocumentToCatalog(catalog, document, {
			fnGetSourceEdition: source => {
				if (_SOURCE_EDITION_OVERRIDES[source]) return _SOURCE_EDITION_OVERRIDES[source];
				const date = globalThis.Parser.sourceJsonToDate(source);
				if (!date) return null;
				return new Date(date) < threshold ? "2014" : "2024";
			},
			defaultEdition: "2014",
		});
	}
	return {
		version: 1,
		sources: [...catalog.sources].sort((a, b) => a.localeCompare(b)),
		species: [...catalog.species].sort((a, b) => a.localeCompare(b)),
		sourceEditions: Object.fromEntries([...catalog.sourceEditions].sort(([a], [b]) => a.localeCompare(b))),
	};
}

async function pGetSiteCatalog () {
	if (!_siteCatalogPromise) {
		_siteCatalogPromise = (async () => {
			const generated = await pReadJson(_SITE_CATALOG_PATH);
			if (
				generated?.version !== 1
				|| !Array.isArray(generated.sources)
				|| !Array.isArray(generated.species)
				|| !generated.sourceEditions
				|| typeof generated.sourceEditions !== "object"
			) {
				throw new HubStoreError("CONTENT_CATALOG_INVALID", `Campaign content catalog is invalid.`, {status: 503});
			}
			return {
				sources: new Set(generated.sources),
				species: new Set(generated.species),
				sourceEditions: new Map(Object.entries(generated.sourceEditions)),
				sourceIdsByLower: new Map(generated.sources.map(source => [source.toLowerCase(), source])),
			};
		})();
	}
	const catalog = await _siteCatalogPromise;
	return {
		sources: new Set(catalog.sources),
		species: new Set(catalog.species),
		sourceEditions: new Map(catalog.sourceEditions),
		sourceIdsByLower: new Map(catalog.sourceIdsByLower),
	};
}

function getCatalogOutput (catalog) {
	return {
		version: 1,
		sources: [...catalog.sources].sort((a, b) => a.localeCompare(b)),
		species: [...catalog.species].sort((a, b) => a.localeCompare(b)),
		sourceEditions: Object.fromEntries([...catalog.sourceEditions].sort(([a], [b]) => a.localeCompare(b))),
	};
}

function getCachedCampaignCatalog (contentHash) {
	if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(contentHash)) return null;
	const cached = _campaignCatalogCache.get(contentHash);
	if (!cached) return null;
	_campaignCatalogCache.delete(contentHash);
	_campaignCatalogCache.set(contentHash, cached);
	return structuredClone(cached);
}

function setCachedCampaignCatalog (contentHash, catalog) {
	if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(contentHash)) return;
	_campaignCatalogCache.delete(contentHash);
	_campaignCatalogCache.set(contentHash, structuredClone(catalog));
	while (_campaignCatalogCache.size > _MAX_CAMPAIGN_CATALOG_CACHE_ENTRIES) {
		_campaignCatalogCache.delete(_campaignCatalogCache.keys().next().value);
	}
}

export async function pGetCampaignContentCatalog ({brewBundle = null} = {}) {
	const cached = getCachedCampaignCatalog(brewBundle?.contentHash);
	if (cached) return cached;
	const catalog = await pGetSiteCatalog();
	const protectedSources = new Set(catalog.sources);
	const protectedSourceIdsByLower = new Map(catalog.sourceIdsByLower);
	for (const document of brewBundle?.content || []) {
		addDocumentToCatalog(catalog, document?.body || document, {
			defaultEdition: "2014",
			protectedSources,
			protectedSourceIdsByLower,
		});
	}
	const output = getCatalogOutput(catalog);
	setCachedCampaignCatalog(brewBundle?.contentHash, output);
	return output;
}

export async function pGetCampaignContentEnforcement ({rulesVersion = null, brewBundle = null} = {}) {
	return {
		activeRulesVersionId: rulesVersion?.id || null,
		contentPolicy: rulesVersion
			? getCampaignRulesContentPolicy({
				schemaVersion: rulesVersion.schemaVersion,
				rules: rulesVersion.rules,
			})
			: getCampaignContentPolicy(null),
		contentCatalog: await pGetCampaignContentCatalog({brewBundle}),
	};
}

export function assertCampaignContentPolicyCatalog ({policy, contentCatalog}) {
	const contentPolicy = getCampaignContentPolicy(policy);
	for (const source of contentPolicy.sources) {
		if (!canonicalizeCampaignSourceId(source, {knownSources: contentCatalog.sources})) {
			throw new HubStoreError("RULES_PARAMETER_INVALID", `Allowed sources contains an unavailable source identity.`, {
				details: {ruleId: CAMPAIGN_CONTENT_RULE_IDS.sources},
			});
		}
	}
	for (const species of contentPolicy.species) {
		if (!canonicalizeCampaignSpeciesUid(species, {
			knownSpecies: contentCatalog.species,
			knownSources: contentCatalog.sources,
		})) {
			throw new HubStoreError("RULES_PARAMETER_INVALID", `Allowed species contains an unavailable species identity.`, {
				details: {ruleId: CAMPAIGN_CONTENT_RULE_IDS.species},
			});
		}
	}
	return contentPolicy;
}

export function assertCampaignContentPolicyVersion ({contentPolicy, activeRulesVersionId, rulesVersionId}) {
	if (!isCampaignContentPolicyRestrictive(contentPolicy)) return;
	if (rulesVersionId === activeRulesVersionId) return;
	throw new HubStoreError("RULES_VERSION_STALE", `Campaign content policy changed before this character update.`, {
		status: 409,
		details: {activeRulesVersionId},
	});
}

export function assertNewCharacterCampaignContent ({
	contentPolicy,
	character,
	contentCatalog,
	rulesVersionId,
}) {
	const report = getCharacterCampaignContentMutationCompliance({
		contentPolicy,
		before: {},
		after: character,
		availableSources: contentCatalog.sources,
		availableSpecies: contentCatalog.species,
		sourceEditions: contentCatalog.sourceEditions,
		rulesVersionId,
	});
	assertContentReport(report);
	return report;
}

export function assertCharacterCampaignContentMutation ({
	contentPolicy,
	before,
	after,
	contentCatalog,
	rulesVersionId,
}) {
	const report = getCharacterCampaignContentMutationCompliance({
		contentPolicy,
		before,
		after,
		availableSources: contentCatalog.sources,
		availableSpecies: contentCatalog.species,
		sourceEditions: contentCatalog.sourceEditions,
		rulesVersionId,
	});
	assertContentReport(report);
	return report;
}

export function getLegacyCharacterCampaignContentReport ({
	contentPolicy,
	character,
	contentCatalog,
	rulesVersionId,
}) {
	return getCharacterCampaignContentCompliance({
		contentPolicy,
		character,
		availableSources: contentCatalog.sources,
		availableSpecies: contentCatalog.species,
		sourceEditions: contentCatalog.sourceEditions,
		rulesVersionId,
	});
}

function assertContentReport (report) {
	if (!report.total) return;
	throw new HubStoreError("CONTENT_POLICY_VIOLATION", `This update adds content that is not allowed by the active campaign policy.`, {
		status: 409,
		details: {report},
	});
}
