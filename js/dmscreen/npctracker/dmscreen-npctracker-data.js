const _SKILL_PAGE = "skill";

let _referenceDataPromise = null;

export function getNpcTrackerFallbackReferenceData () {
	return {
		conditions: Parser.CONDITIONS.map(name => ({
			id: name,
			name,
			label: name.toTitleCase(),
			source: null,
			color: null,
		})),
		skills: Object.entries(Parser.SKILL_TO_ATB_ABV).map(([name, ability]) => ({
			id: getNpcTrackerNormalizedSkillName(name),
			name,
			label: name.toTitleCase(),
			source: null,
			ability,
		})),
	};
}

export function pGetNpcTrackerReferenceData () {
	return _referenceDataPromise ||= _pLoadNpcTrackerReferenceData();
}

export function resetNpcTrackerReferenceDataCache () {
	_referenceDataPromise = null;
}

export function getNpcTrackerNormalizedSkillName (value) {
	return `${value ?? ""}`.trim().toLowerCase().replace(/\s+/g, "");
}

export function getNpcTrackerSkillUid ({name, source = null}) {
	const normalizedName = getNpcTrackerNormalizedSkillName(name);
	if (!normalizedName) return "";
	return source ? `${normalizedName}|${`${source}`.trim().toLowerCase()}` : normalizedName;
}

export function getNpcTrackerSkillKeyMeta (key) {
	const [name = "", source = null] = `${key ?? ""}`.split("|");
	return {
		name: name.trim(),
		source: source?.trim() || null,
	};
}

export function getNpcTrackerSkillDescriptors ({skillCatalog = [], monsters = []} = {}) {
	const out = [];
	const seenNames = new Set();

	const add = ({name, label = null, source = null, ability = null}) => {
		const normalizedName = getNpcTrackerNormalizedSkillName(name);
		if (!normalizedName || seenNames.has(normalizedName)) return;
		seenNames.add(normalizedName);
		out.push({
			id: getNpcTrackerSkillUid({name, source}),
			name: `${name}`.trim(),
			label: label || `${name}`.trim().toTitleCase(),
			source,
			ability: Parser.ABIL_ABVS.includes(ability) ? ability : null,
		});
	};

	Object.entries(Parser.SKILL_TO_ATB_ABV).forEach(([name, ability]) => add({name, ability}));
	skillCatalog.forEach(add);
	monsters.forEach(monster => Object.keys(monster?.skill || {}).forEach(key => {
		const {name, source} = getNpcTrackerSkillKeyMeta(key);
		const fromCatalog = _getSkillCatalogMatch({skillCatalog, name, source});
		add(fromCatalog || {name, label: name, source, ability: null});
	}));

	return out;
}

export function getNpcTrackerMonsterSkillMeta ({monster, skill}) {
	const entries = Object.entries(monster?.skill || {});
	const exactUid = getNpcTrackerSkillUid(skill);
	const normalizedName = getNpcTrackerNormalizedSkillName(skill?.name);

	const exact = entries.find(([key]) => {
		const keyMeta = getNpcTrackerSkillKeyMeta(key);
		return getNpcTrackerSkillUid(keyMeta) === exactUid;
	});
	if (exact) return {key: exact[0], bonus: exact[1]};

	const bare = entries.find(([key]) => {
		const keyMeta = getNpcTrackerSkillKeyMeta(key);
		return !keyMeta.source && getNpcTrackerNormalizedSkillName(keyMeta.name) === normalizedName;
	});
	if (bare) return {key: bare[0], bonus: bare[1]};

	const sameName = entries.find(([key]) => {
		const keyMeta = getNpcTrackerSkillKeyMeta(key);
		return getNpcTrackerNormalizedSkillName(keyMeta.name) === normalizedName;
	});
	return sameName ? {key: sameName[0], bonus: sameName[1]} : null;
}

async function _pLoadNpcTrackerReferenceData () {
	const fallback = getNpcTrackerFallbackReferenceData();
	const [conditions, skills] = await Promise.all([
		_pLoadConditions(fallback.conditions),
		_pLoadSkills(fallback.skills),
	]);
	return {conditions, skills};
}

async function _pLoadConditions (fallback) {
	try {
		const site = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_CONDITIONS_DISEASES) || [];
		const brew = await _pLoadBrew(UrlUtil.PG_CONDITIONS_DISEASES);
		const entities = [...site, ...brew]
			.filter(entity => entity?.__prop === "condition" || entity?.__prop === "status")
			.map(entity => ({
				id: `${entity.name}`.trim().toLowerCase(),
				name: `${entity.name}`.trim().toLowerCase(),
				label: entity.name,
				source: entity.source || null,
				color: entity.color || null,
			}));
		return _getDedupedByName([...fallback, ...entities]);
	} catch (e) {
		_showLoadWarning("NPC Manager could not load condition reference data. Standard conditions remain available.");
		return fallback;
	}
}

async function _pLoadSkills (fallback) {
	try {
		const site = await DataLoader.pCacheAndGetAllSite(_SKILL_PAGE) || [];
		const brew = await _pLoadBrew(_SKILL_PAGE);
		const entities = [...site, ...brew]
			.filter(entity => entity?.__prop === "skill" || (entity?.name && entity?.ability))
			.map(entity => ({
				id: getNpcTrackerSkillUid(entity),
				name: entity.name,
				label: entity.name,
				source: entity.source || null,
				ability: entity.ability || null,
			}));
		return _getDedupedSkills([...fallback, ...entities]);
	} catch (e) {
		_showLoadWarning("NPC Manager could not load skill reference data. Standard skills remain available.");
		return fallback;
	}
}

async function _pLoadBrew (page) {
	try {
		return await DataLoader.pCacheAndGetAllBrew(page) || [];
	} catch (e) {
		_showLoadWarning(`NPC Manager could not load installed homebrew for "${page}".`);
		return [];
	}
}

function _getDedupedByName (entities) {
	const byName = new Map();
	entities.forEach(entity => {
		const key = `${entity?.name ?? ""}`.trim().toLowerCase();
		if (!key) return;
		const existing = byName.get(key);
		if (!existing || (existing.source == null && entity.source != null)) byName.set(key, entity);
	});
	return [...byName.values()].sort((a, b) => SortUtil.ascSortLower(a.label, b.label));
}

function _getDedupedSkills (entities) {
	const byName = new Map();
	entities.forEach(entity => {
		const key = getNpcTrackerNormalizedSkillName(entity?.name);
		if (!key) return;
		const existing = byName.get(key);
		if (!existing || (existing.source == null && entity.source != null)) byName.set(key, entity);
	});
	return [...byName.values()].sort((a, b) => SortUtil.ascSortLower(a.label, b.label));
}

function _showLoadWarning (content) {
	JqueryUtil.doToast({type: "warning", content});
}

function _getSkillCatalogMatch ({skillCatalog, name, source}) {
	const uid = getNpcTrackerSkillUid({name, source});
	const normalizedName = getNpcTrackerNormalizedSkillName(name);
	return skillCatalog.find(skill => source && getNpcTrackerSkillUid(skill) === uid)
		|| skillCatalog.find(skill => getNpcTrackerNormalizedSkillName(skill.name) === normalizedName)
		|| null;
}
