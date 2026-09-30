const REVIEW_CHASSIS = [
	{field: "ac", reason: "Recheck AC after changing defenses or creature type."},
	{field: "hp", reason: "Recheck hit points and Hit Dice after changing type or abilities."},
	{field: "attacks", reason: "Recheck attacks, damage, and save DCs against the retained chassis."},
	{field: "cr", reason: "Recalculate challenge rating and experience after all changes."},
	{field: "characterLevel", reason: "Resolve character-level prerequisites for an NPC without a character level."},
];

const DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
const CONDITION_TYPES = new Set(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);
const CREATURE_TYPES = new Set(["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"]);
const SENSES = new Set(["darkvision", "blindsight", "tremorsense", "truesight"]);
const SPEEDS = new Set(["walk", "fly", "swim", "climb", "burrow"]);
const ENTRY_SECTIONS = new Set(["trait", "action", "bonus", "reaction", "legendary"]);
const ENTRY_ROLES = new Set(["breathWeapon", "bite", "healingTouch", "angelicWeapons"]);
const REVIEW_FIELDS = new Set(["ac", "hp", "attacks", "cr", "characterLevel", "eligibility", "abilities", "traits", "spellcasting", "other"]);

const copy = value => structuredClone(value);
const getId = (kind, {name, source}) => `${kind}:${name.toLowerCase()}|${source.toLowerCase()}`;
const assertIdentity = (entity) => {
	if (typeof entity?.name !== "string" || !entity.name.trim() || typeof entity?.source !== "string" || !entity.source.trim()) {
		throw new Error("Creature transformation requires a nonempty name and source.");
	}
};
const isEntry = entry => {
	if (Object.keys(entry || {}).sort().join(",") !== "entries,name,source" || !Array.isArray(entry.entries) || !entry.entries.length) return false;
	return typeof entry.name === "string" && !!entry.name.trim()
		&& typeof entry.source === "string" && !!entry.source.trim()
		&& entry.entries.every(it => typeof it === "string" && !!it.trim());
};
const isEntryMatch = match => {
	const keys = Object.keys(match || {}).sort().join(",");
	return (keys === "name,source" && typeof match.name === "string" && !!match.name.trim() && typeof match.source === "string" && !!match.source.trim())
		|| (keys === "role,source" && ENTRY_ROLES.has(match.role) && typeof match.source === "string" && !!match.source.trim());
};
const assertReview = reviews => {
	if (!Array.isArray(reviews) || !reviews.every(it => REVIEW_FIELDS.has(it?.field) && typeof it.reason === "string" && !!it.reason.trim() && Object.keys(it).sort().join(",") === "field,reason")) {
		throw new Error("Transformation manualReview must contain typed, nonempty DM review items.");
	}
};
const assertEligibility = eligibility => {
	if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) throw new Error("Transformation eligibility must be an object.");
	const allowed = new Set(["types", "sizes", "minCr", "maxCr", "minInt", "maxInt", "requiresTrait", "dmApproval"]);
	if (Object.keys(eligibility).some(key => !allowed.has(key))) throw new Error("Unknown transformation eligibility constraint.");
	if (eligibility.types && (!Array.isArray(eligibility.types) || !eligibility.types.length || eligibility.types.some(it => !CREATURE_TYPES.has(it)))) throw new Error("Invalid creature-type eligibility.");
	if (eligibility.sizes && (!Array.isArray(eligibility.sizes) || !eligibility.sizes.length || eligibility.sizes.some(it => !["T", "S", "M", "L", "H", "G"].includes(it)))) throw new Error("Invalid size eligibility.");
	if (["minCr", "maxCr"].some(key => eligibility[key] != null && (!Number.isFinite(eligibility[key]) || eligibility[key] < 0))) throw new Error("Invalid CR eligibility.");
	if (["minInt", "maxInt"].some(key => eligibility[key] != null && (!Number.isInteger(eligibility[key]) || eligibility[key] < 1 || eligibility[key] > 30))) throw new Error("Invalid Intelligence eligibility.");
	if (eligibility.requiresTrait != null && (typeof eligibility.requiresTrait !== "string" || !eligibility.requiresTrait.trim())) throw new Error("Invalid trait eligibility.");
	if (eligibility.dmApproval != null && typeof eligibility.dmApproval !== "boolean") throw new Error("Invalid DM approval eligibility.");
};
const assertChanges = changes => {
	if (!Array.isArray(changes)) throw new Error("Transformation changes must be an array.");
	for (const step of changes) {
		const props = Object.keys(step || {}).sort().join(",");
		const valid = (() => {
			switch (step?.op) {
				case "setType": return props === "op,value" && CREATURE_TYPES.has(step.value);
				case "setAbility":
				case "minimumAbility":
				case "maximumAbility": return props === "ability,op,value" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && Number.isInteger(step.value) && step.value >= 1 && step.value <= 30;
				case "adjustAbility": return props === "ability,amount,floor,op" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && Number.isInteger(step.amount) && step.amount >= -30 && step.amount <= 30 && step.floor === 1;
				case "scaleAbility": return props === "ability,factor,floor,op,round" && ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability) && step.factor === 0.5 && step.floor === 1 && step.round === "down";
				case "grantResistance":
				case "grantImmunity":
				case "grantVulnerability": return props === "op,value" && DAMAGE_TYPES.has(step.value);
				case "grantConditionImmunity": return props === "op,value" && CONDITION_TYPES.has(step.value);
				case "grantSense": return props === "op,range,sense" && SENSES.has(step.sense) && Number.isInteger(step.range) && step.range > 0;
				case "grantSpeed": return props === "feet,mode,op" && SPEEDS.has(step.mode) && Number.isInteger(step.feet) && step.feet >= 0;
				case "grantLanguage": return props === "op,value" && typeof step.value === "string" && !!step.value.trim();
				case "grantConditionalDefense": return props === "kind,op,value,when" && ["resistance", "immunity"].includes(step.kind) && DAMAGE_TYPES.has(step.value) && ["nonmagical", "nonmagicalUnsilvered", "dimLightOrDarkness"].includes(step.when);
				case "addEntry": return props === "entry,op,section" && ENTRY_SECTIONS.has(step.section) && isEntry(step.entry);
				case "removeEntry": return props === "match,op,section" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match);
				case "replaceEntry": return props === "entry,match,onMissing,op,section" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match) && isEntry(step.entry) && ["error", "skip"].includes(step.onMissing);
				case "replaceDamageType": return props === "from,match,onMissing,op,section,to" && ENTRY_SECTIONS.has(step.section) && isEntryMatch(step.match) && Array.isArray(step.from) && step.from.length > 0 && new Set(step.from).size === step.from.length && step.from.every(it => DAMAGE_TYPES.has(it)) && DAMAGE_TYPES.has(step.to) && ["error", "skip"].includes(step.onMissing);
				default: return false;
			}
		})();
		if (!valid) throw new Error(`Invalid transformation change: ${step?.op || "(missing op)"}`);
	}
};

const getRaceRecipe = race => {
	const changes = [];
	const manualReview = copy(REVIEW_CHASSIS);
	const addDamage = (key, op) => {
		for (const value of race[key] || []) {
			if (typeof value === "string" && DAMAGE_TYPES.has(value)) changes.push({op, value});
			else manualReview.push({field: "traits", reason: `Resolve the ${key} choice or nonstandard resistance for this species.`});
		}
	};
	const addConditions = () => {
		for (const value of race.conditionImmune || []) {
			if (typeof value === "string" && CONDITION_TYPES.has(value)) changes.push({op: "grantConditionImmunity", value});
			else manualReview.push({field: "traits", reason: "Resolve this species' conditional condition immunity."});
		}
	};

	if (race.creatureTypes?.length === 1 && CREATURE_TYPES.has(race.creatureTypes[0])) changes.push({op: "setType", value: race.creatureTypes[0]});
	else if (race.creatureTypes?.length) manualReview.push({field: "eligibility", reason: "Choose the species' creature type with the DM."});
	else if (!race.creatureTypes) changes.push({op: "setType", value: "humanoid"});
	addDamage("resist", "grantResistance");
	addDamage("immune", "grantImmunity");
	addConditions();
	if (Number.isInteger(race.darkvision) && race.darkvision > 0) changes.push({op: "grantSense", sense: "darkvision", range: race.darkvision});
	if (typeof race.speed === "number" && Number.isInteger(race.speed) && race.speed >= 0) changes.push({op: "grantSpeed", mode: "walk", feet: race.speed});
	else if (race.speed && typeof race.speed === "object") {
		for (const mode of SPEEDS) {
			if (Number.isInteger(race.speed[mode]) && race.speed[mode] >= 0) changes.push({op: "grantSpeed", mode, feet: race.speed[mode]});
			else if (race.speed[mode] != null) manualReview.push({field: "traits", reason: `Resolve conditional ${mode} speed for this species.`});
		}
	}
	if (race.ability?.length) manualReview.push({field: "abilities", reason: "Choose whether ancestry ability adjustments apply to an NPC's existing scores."});
	if (race.entries?.length) manualReview.push({field: "traits", reason: "Review species traits, proficiencies, and choices; they are not executable changes."});
	if (race.additionalSpells?.length) manualReview.push({field: "spellcasting", reason: "Resolve spells, spell level, and casting ability for this NPC."});
	if (race.size?.length) manualReview.push({field: "other", reason: "Confirm size against the selected chassis; the adapter does not replace it."});

	return {
		kind: "race",
		id: getId("race", race),
		identity: {name: race.name, source: race.source},
		baseIdentity: race._baseName ? {name: race._baseName, source: race._baseSource} : null,
		provenance: {edition: race.edition || "unverified", ...race.page ? {page: race.page} : {}},
		eligibility: {dmApproval: true},
		prerequisites: [],
		changes,
		optionGroups: [],
		manualReview,
	};
};

/**
 * DataUtil.race already merges separate subraces using Renderer.race.mergeSubraces.
 * The loader also supplies same-source base races; expand inline _versions separately.
 */
function getCreatureTransformationCandidates ({catalog, races, getVersions}) {
	if (!Array.isArray(catalog?.creatureTransformation) || !Array.isArray(races)) throw new Error("Transformation catalog and resolved races are required.");
	const seen = new Set();
	const result = [];
	const append = candidate => {
		assertIdentity(candidate.identity);
		if (
			!candidate.provenance
			|| !["classic", "one", "unverified"].includes(candidate.provenance.edition)
			|| (candidate.provenance.page != null && (!Number.isInteger(candidate.provenance.page) || candidate.provenance.page < 1))
		) throw new Error(`Invalid transformation provenance: ${candidate.id}`);
		assertEligibility(candidate.eligibility);
		assertReview(candidate.manualReview);
		if (!Array.isArray(candidate.prerequisites) || candidate.prerequisites.some(it => typeof it !== "string" || !it.trim())) throw new Error(`Invalid transformation prerequisites: ${candidate.id}`);
		assertChanges(candidate.changes);
		if (!Array.isArray(candidate.optionGroups)) throw new Error(`Invalid transformation option groups: ${candidate.id}`);
		const groupIds = new Set();
		for (const group of candidate.optionGroups) {
			if (!group.id || groupIds.has(group.id)) throw new Error(`Duplicate or missing option group in ${candidate.id}.`);
			groupIds.add(group.id);
			if (!["one", "any"].includes(group.selection) || !Array.isArray(group.options) || !group.options.length) throw new Error(`Invalid option group in ${candidate.id}.`);
			const ids = new Set();
			for (const option of group.options) {
				if (!option.id || ids.has(option.id)) throw new Error(`Duplicate or missing option in ${candidate.id}/${group.id}.`);
				ids.add(option.id);
				assertChanges(option.changes);
				assertReview(option.manualReview);
				if (option.eligibility) assertEligibility(option.eligibility);
			}
		}
		for (const group of candidate.optionGroups) {
			if (!group.appliesTo) continue;
			const parent = candidate.optionGroups.find(it => it.id === group.appliesTo.group);
			if (!parent?.options.some(it => it.id === group.appliesTo.option) || group.required) throw new Error(`Invalid conditional option group in ${candidate.id}/${group.id}.`);
		}
		if (seen.has(candidate.id)) throw new Error(`Duplicate creature transformation identity: ${candidate.id}`);
		seen.add(candidate.id);
		result.push(candidate);
	};

	for (const recipe of catalog.creatureTransformation) {
		assertIdentity(recipe);
		append({
			...copy(recipe),
			kind: "catalog",
			id: getId("catalog", recipe),
			identity: {name: recipe.name, source: recipe.source},
			manualReview: [...copy(REVIEW_CHASSIS), ...copy(recipe.manualReview)],
		});
	}
	for (const race of races) {
		assertIdentity(race);
		const recipe = getRaceRecipe(race);
		if (race._isBaseRace) recipe.manualReview.push({field: "eligibility", reason: "Select a playable subrace or lineage if required by this species."});
		append(recipe);
		if (!race._versions?.length) continue;
		if (typeof getVersions !== "function") throw new Error(`Race versions cannot be resolved: ${race.name}|${race.source}`);
		for (const [ix, version] of getVersions({...race, __prop: "race"}).entries()) {
			assertIdentity(version);
			const versionRecipe = getRaceRecipe({...version, _baseName: race.name, _baseSource: race.source});
			versionRecipe.id = `${versionRecipe.id}~v:${race.name.toLowerCase()}|${race.source.toLowerCase()}:${ix + 1}`;
			append(versionRecipe);
		}
	}
	return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function pLoadCreatureTransformationCandidates ({dataUtil = globalThis.DataUtil} = {}) {
	if (!dataUtil?.race || !dataUtil?.generic?.getVersions) throw new Error("DataUtil.race and DataUtil.generic.getVersions are required.");
	const [catalog, site, prerelease, brew] = await Promise.all([
		dataUtil.loadJSON("data/creature-transformations.json"),
		dataUtil.race.loadJSON({isAddBaseRaces: true}),
		dataUtil.race.loadPrerelease({isAddBaseRaces: true}),
		dataUtil.race.loadBrew({isAddBaseRaces: true}),
	]);
	if (!Array.isArray(site?.race)) throw new Error("Site race source is unavailable or malformed.");
	for (const [name, data] of [["prerelease", prerelease], ["homebrew", brew]]) {
		if (!data || typeof data !== "object" || (data.race != null && !Array.isArray(data.race))) throw new Error(`${name} race source is malformed.`);
	}
	return getCreatureTransformationCandidates({
		catalog,
		races: [...(site?.race || []), ...(prerelease?.race || []), ...(brew?.race || [])],
		getVersions: race => dataUtil.generic.getVersions(race, {isExternalApplicationIdentityOnly: false}),
	});
}

function resolveCreatureTransformation ({candidates, id, selections = {}}) {
	const candidate = candidates?.find(it => it.id === id);
	if (!candidate || candidates.filter(it => it.id === id).length !== 1) throw new Error(`Unavailable or ambiguous transformation: ${id}`);
	if (selections == null || Array.isArray(selections) || typeof selections !== "object") throw new Error("Selections must be keyed by option group.");
	const groupIds = new Set(candidate.optionGroups.map(it => it.id));
	for (const key of Object.keys(selections)) if (!groupIds.has(key)) throw new Error(`Unknown transformation option group: ${key}`);
	const changes = copy(candidate.changes);
	const manualReview = copy(candidate.manualReview);
	const eligibility = [copy(candidate.eligibility)];
	const selectedOptions = {};
	for (const group of candidate.optionGroups) {
		const chosen = selections[group.id] || [];
		if (!Array.isArray(chosen) || (group.selection === "one" && chosen.length > 1) || (group.required && !chosen.length) || new Set(chosen).size !== chosen.length) {
			throw new Error(`Invalid selection for ${group.id}.`);
		}
		if (chosen.length && group.appliesTo && !selections[group.appliesTo.group]?.includes(group.appliesTo.option)) throw new Error(`Option group ${group.id} requires ${group.appliesTo.group}/${group.appliesTo.option}.`);
		selectedOptions[group.id] = [...chosen];
		for (const optionId of chosen) {
			const option = group.options.find(it => it.id === optionId);
			if (!option) throw new Error(`Unknown transformation option: ${group.id}/${optionId}`);
			changes.push(...copy(option.changes));
			manualReview.push(...copy(option.manualReview));
			if (option.eligibility) eligibility.push(copy(option.eligibility));
		}
	}
	assertChanges(changes);
	assertReview(manualReview);
	return {
		id: candidate.id,
		kind: candidate.kind,
		identity: copy(candidate.identity),
		provenance: copy(candidate.provenance),
		eligibility,
		prerequisites: copy(candidate.prerequisites),
		selectedOptions,
		changes,
		manualReview,
	};
}

export {getCreatureTransformationCandidates, pLoadCreatureTransformationCandidates, resolveCreatureTransformation};
