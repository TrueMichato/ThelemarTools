export const CAMPAIGN_CONTENT_POLICY_VERSION = 1;

export const CAMPAIGN_CONTENT_RULE_IDS = Object.freeze({
	sources: "content.sources.allowed",
	species: "content.species.allowed",
	editions: "content.editions.allowed",
});

export const CAMPAIGN_CONTENT_EDITIONS = Object.freeze(["2014", "2024"]);

const _SOURCE_ALIASES = Object.freeze({
	PHB14: "PHB",
	PHB2014: "PHB",
	DMG14: "DMG",
	DMG2014: "DMG",
	MM14: "MM",
	MM2014: "MM",
	PHB24: "XPHB",
	PHB2024: "XPHB",
	DMG24: "XDMG",
	DMG2024: "XDMG",
	MM24: "XMM",
	MM2024: "XMM",
	MM2025: "XMM",
	TGTT24: "TGTT-2024",
	TGTT2024: "TGTT-2024",
	TGTT14: "TGTT-2014",
	TGTT2014: "TGTT-2014",
});

const _SOURCE_EDITIONS = Object.freeze({
	PHB: "2014",
	DMG: "2014",
	MM: "2014",
	XPHB: "2024",
	XDMG: "2024",
	XMM: "2024",
	TGTT: "2024",
	"TGTT-2014": "2014",
	"TGTT-2024": "2024",
});

const _KIND_ORDER = Object.freeze([
	"species",
	"class",
	"subclass",
	"background",
	"feat",
	"optionalFeature",
	"spell",
	"item",
	"content",
]);

function copy (value) {
	return value == null ? value : structuredClone(value);
}

function getSelection (policy, ruleId) {
	return policy?.rules?.find(rule => rule?.id === ruleId) || null;
}

function normalizeComparable (value) {
	return `${value || ""}`.trim().toLowerCase();
}

function getKnownCanonical (value, knownValues) {
	if (!knownValues) return value;
	const map = knownValues instanceof Map
		? knownValues
		: new Map([...knownValues].map(it => [normalizeComparable(it), it]));
	return map.get(normalizeComparable(value)) || null;
}

export function canonicalizeCampaignSourceId (value, {knownSources = null} = {}) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) return null;
	const aliasKey = trimmed.replaceAll(/[-_.\s]/g, "").toUpperCase();
	const aliased = _SOURCE_ALIASES[aliasKey] || trimmed;
	return getKnownCanonical(aliased, knownSources) || (knownSources ? null : aliased);
}

export function canonicalizeCampaignSpeciesUid (value, {knownSpecies = null, knownSources = null} = {}) {
	if (typeof value !== "string" || value.length > 180) return null;
	const parts = value.split("|");
	if (parts.length !== 2) return null;
	const name = parts[0].trim();
	const source = canonicalizeCampaignSourceId(parts[1], {knownSources});
	// eslint-disable-next-line no-control-regex
	if (!name || name.length > 120 || /[\u0000-\u001f<>|]/.test(name) || !source) return null;
	const uid = `${name}|${source}`;
	return getKnownCanonical(uid, knownSpecies) || (knownSpecies ? null : uid);
}

export function getCampaignEntityEdition (entity, {sourceEditions = null} = {}) {
	if (!entity || typeof entity !== "object") return null;
	if (entity.edition === "classic" || entity.edition === "2014") return "2014";
	if (entity.edition === "one" || entity.edition === "2024") return "2024";
	if (entity.edition != null) return null;
	const source = canonicalizeCampaignSourceId(entity.source);
	const sourceEdition = sourceEditions instanceof Map
		? sourceEditions.get(source)
		: sourceEditions?.[source];
	return sourceEdition || _SOURCE_EDITIONS[source] || null;
}

export function getCampaignEntityUid (entity) {
	if (!entity || typeof entity !== "object") return null;
	const name = typeof entity.name === "string" ? entity.name.trim() : "";
	const source = canonicalizeCampaignSourceId(entity.source);
	// eslint-disable-next-line no-control-regex
	if (!name || name.length > 200 || /[\u0000-\u001f<>|]/.test(name) || !source) return null;
	return `${name}|${source}`;
}

export function getCampaignSpeciesUid (entity, {knownSpecies = null} = {}) {
	if (!entity || typeof entity !== "object") return null;
	const name = typeof entity.name === "string" ? entity.name.trim() : "";
	const baseName = typeof entity._baseName === "string" ? entity._baseName.trim() : "";
	const source = canonicalizeCampaignSourceId(entity._baseSource || entity.source);
	if (!name || !source) return null;
	const candidates = [];
	if (baseName) {
		const mergedName = name === baseName
			? `${baseName} (Base)`
			: name.startsWith(`${baseName} (`) ? name : `${baseName} (${name})`;
		candidates.push(`${mergedName}|${source}`);
	}
	if (entity._isBaseRace) candidates.push(`${entity._rawName || name} (Base)|${source}`);
	candidates.push(`${name}|${source}`);
	if (knownSpecies) {
		for (const candidate of candidates) {
			const canonical = getKnownCanonical(candidate, knownSpecies);
			if (canonical) return canonical;
		}
	}
	return candidates[0];
}

export function inferCampaignContentKind (entity, fallback = "content") {
	const prop = `${entity?.__prop || ""}`.toLowerCase();
	if (prop === "race" || prop === "subrace" || entity?._baseName || entity?._isSubRace) return "species";
	if (prop === "class") return "class";
	if (prop === "subclass") return "subclass";
	if (prop === "background") return "background";
	if (prop === "feat") return "feat";
	if (prop === "spell") return "spell";
	if (prop === "item") return "item";
	return fallback;
}

export function getCampaignContentPolicy (policy) {
	if (policy?.version === CAMPAIGN_CONTENT_POLICY_VERSION && Array.isArray(policy.sources) && Array.isArray(policy.species) && Array.isArray(policy.editions)) {
		return copy(policy);
	}
	if (policy?.contentPolicy?.version === CAMPAIGN_CONTENT_POLICY_VERSION) return copy(policy.contentPolicy);
	const sources = getSelection(policy, CAMPAIGN_CONTENT_RULE_IDS.sources)?.parameters?.sources || [];
	const species = getSelection(policy, CAMPAIGN_CONTENT_RULE_IDS.species)?.parameters?.species || [];
	const editions = getSelection(policy, CAMPAIGN_CONTENT_RULE_IDS.editions)?.parameters?.editions || CAMPAIGN_CONTENT_EDITIONS;
	return {
		version: CAMPAIGN_CONTENT_POLICY_VERSION,
		sources: [...sources],
		species: [...species],
		editions: [...editions],
	};
}

export function isCampaignContentPolicyRestrictive (policy) {
	const normalized = getCampaignContentPolicy(policy);
	return !!normalized.sources.length
		|| !!normalized.species.length
		|| normalized.editions.length !== CAMPAIGN_CONTENT_EDITIONS.length;
}

export function evaluateCampaignContentEntity ({
	contentPolicy,
	entity,
	kind = null,
	availableSources = null,
	availableSpecies = null,
	sourceEditions = null,
}) {
	const policy = getCampaignContentPolicy({contentPolicy});
	const resolvedKind = kind || inferCampaignContentKind(entity);
	const uid = resolvedKind === "species"
		? getCampaignSpeciesUid(entity, {knownSpecies: availableSpecies})
		: getCampaignEntityUid(entity);
	const source = canonicalizeCampaignSourceId(resolvedKind === "species" ? entity?._baseSource || entity?.source : entity?.source);
	const edition = getCampaignEntityEdition(entity, {sourceEditions});
	const violations = [];

	if (!uid || !source) {
		violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.sources, code: "CONTENT_ID_INVALID"});
	} else if (availableSources && !getKnownCanonical(source, availableSources)) {
		violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.sources, code: "CONTENT_SOURCE_UNKNOWN"});
	} else if (policy.sources.length && !policy.sources.some(it => normalizeComparable(it) === normalizeComparable(source))) {
		violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.sources, code: "CONTENT_SOURCE_NOT_ALLOWED"});
	}

	if (!edition) {
		violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.editions, code: "CONTENT_EDITION_UNKNOWN"});
	} else if (!policy.editions.includes(edition)) {
		violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.editions, code: "CONTENT_EDITION_NOT_ALLOWED"});
	}

	if (resolvedKind === "species" && uid) {
		if (availableSpecies && !getKnownCanonical(uid, availableSpecies)) {
			violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.species, code: "CONTENT_SPECIES_UNKNOWN"});
		} else if (policy.species.length && !policy.species.some(it => normalizeComparable(it) === normalizeComparable(uid))) {
			violations.push({ruleId: CAMPAIGN_CONTENT_RULE_IDS.species, code: "CONTENT_SPECIES_NOT_ALLOWED"});
		}
	}

	return {
		isAllowed: !violations.length,
		entity: {uid, source, edition, kind: resolvedKind},
		violations,
	};
}

export function filterCampaignContentEntities ({
	contentPolicy,
	entities,
	kind = null,
	availableSources = null,
	availableSpecies = null,
	sourceEditions = null,
}) {
	if (!contentPolicy || !Array.isArray(entities)) return entities;
	const knownSources = availableSources && !(availableSources instanceof Map)
		? new Map([...availableSources].map(it => [normalizeComparable(it), it]))
		: availableSources;
	const knownSpecies = availableSpecies && !(availableSpecies instanceof Map)
		? new Map([...availableSpecies].map(it => [normalizeComparable(it), it]))
		: availableSpecies;
	return entities.filter(entity => evaluateCampaignContentEntity({
		contentPolicy,
		entity,
		kind: kind || inferCampaignContentKind(entity),
		availableSources: knownSources,
		availableSpecies: knownSpecies,
		sourceEditions,
	}).isAllowed);
}

function getSpellProvenance (spell, fallback = "user_choice") {
	if (
		spell?.alwaysPrepared
		|| spell?.atWill
		|| spell?.uses
		|| (spell?.sourceFeature && !/^(?:spells known|spells prepared)$/i.test(spell.sourceFeature))
	) return "intrinsic_grant";
	return fallback;
}

export function extractCharacterCampaignContent (character) {
	const out = [];
	const add = (entity, kind, provenance = "user_choice") => {
		const uid = getCampaignEntityUid(entity);
		if (!entity) return;
		out.push({entity, kind, provenance, uid});
	};
	const addAll = (entities, kind, fnProvenance = null) => {
		for (const entity of Array.isArray(entities) ? entities : []) {
			add(entity, kind, fnProvenance ? fnProvenance(entity) : "user_choice");
		}
	};

	add(character?.race, "species");
	add(character?.subrace, "species");
	add(character?.background, "background");
	for (const cls of character?.classes || []) {
		add(cls, "class");
		add(cls?.subclass, "subclass");
	}
	addAll(character?.feats, "feat");
	addAll(
		(character?.features || []).filter(feature => feature?.featureType === "Optional Feature"),
		"optionalFeature",
	);
	for (const row of character?.inventory || []) add(row?.item, "item");

	const spellcasting = character?.spellcasting || {};
	addAll(spellcasting.spellsKnown, "spell", spell => getSpellProvenance(spell));
	addAll(spellcasting.cantripsKnown, "spell", spell => getSpellProvenance(spell));
	addAll(spellcasting.innateSpells, "spell", () => "intrinsic_grant");
	addAll(spellcasting.spellMasterySpells, "spell");
	addAll(spellcasting.signatureSpells, "spell");
	addAll(spellcasting.scribingSpellbook, "spell");
	return out;
}

function getContentCountKey (entry) {
	return `${entry.kind}\u0000${normalizeComparable(entry.uid)}`;
}

function sortFindings (findings) {
	return findings.sort((a, b) => {
		const kindDiff = _KIND_ORDER.indexOf(a.entity.kind) - _KIND_ORDER.indexOf(b.entity.kind);
		return kindDiff || `${a.entity.uid}`.localeCompare(`${b.entity.uid}`) || a.code.localeCompare(b.code);
	});
}

function getBoundedReport ({findings, rulesVersionId = null, limit = 10}) {
	const sorted = sortFindings(findings);
	return {
		version: CAMPAIGN_CONTENT_POLICY_VERSION,
		rulesVersionId,
		total: sorted.length,
		findings: sorted.slice(0, limit),
		isTruncated: sorted.length > limit,
	};
}

export function getCharacterCampaignContentCompliance ({
	contentPolicy,
	character,
	availableSources = null,
	availableSpecies = null,
	sourceEditions = null,
	rulesVersionId = null,
	limit = 10,
}) {
	const knownSources = availableSources && !(availableSources instanceof Map)
		? new Map([...availableSources].map(it => [normalizeComparable(it), it]))
		: availableSources;
	const knownSpecies = availableSpecies && !(availableSpecies instanceof Map)
		? new Map([...availableSpecies].map(it => [normalizeComparable(it), it]))
		: availableSpecies;
	const findings = extractCharacterCampaignContent(character).flatMap(entry => {
		const result = evaluateCampaignContentEntity({
			contentPolicy,
			entity: entry.entity,
			kind: entry.kind,
			availableSources: knownSources,
			availableSpecies: knownSpecies,
			sourceEditions,
		});
		return result.violations.map(violation => ({
			...violation,
			entity: result.entity,
			provenance: entry.provenance,
			disposition: "grandfathered",
		}));
	});
	return getBoundedReport({findings, rulesVersionId, limit});
}

export function getCharacterCampaignContentMutationCompliance ({
	contentPolicy,
	before,
	after,
	availableSources = null,
	availableSpecies = null,
	sourceEditions = null,
	rulesVersionId = null,
	limit = 10,
}) {
	const knownSources = availableSources && !(availableSources instanceof Map)
		? new Map([...availableSources].map(it => [normalizeComparable(it), it]))
		: availableSources;
	const knownSpecies = availableSpecies && !(availableSpecies instanceof Map)
		? new Map([...availableSpecies].map(it => [normalizeComparable(it), it]))
		: availableSpecies;
	const beforeCounts = new Map();
	for (const entry of extractCharacterCampaignContent(before)) {
		const key = getContentCountKey(entry);
		beforeCounts.set(key, (beforeCounts.get(key) || 0) + 1);
	}
	const seenAfter = new Map();
	const findings = [];
	for (const entry of extractCharacterCampaignContent(after)) {
		const key = getContentCountKey(entry);
		const count = (seenAfter.get(key) || 0) + 1;
		seenAfter.set(key, count);
		if (count <= (beforeCounts.get(key) || 0)) continue;
		const result = evaluateCampaignContentEntity({
			contentPolicy,
			entity: entry.entity,
			kind: entry.kind,
			availableSources: knownSources,
			availableSpecies: knownSpecies,
			sourceEditions,
		});
		findings.push(...result.violations.map(violation => ({
			...violation,
			entity: result.entity,
			provenance: entry.provenance,
			disposition: "blocking",
		})));
	}
	return getBoundedReport({findings, rulesVersionId, limit});
}
