export const ENCOUNTER_ROLL_PRESETS = [
	{
		presetId: "desecrated-dmg",
		name: "Desecrated Ground (DMG p. 110)",
		source: "DMG",
		page: 110,
		edition: "classic",
		description: "Undead standing on desecrated ground have advantage on saving throws.",
		eligibility: "undead",
		scopes: ["save"],
		mode: "advantage",
		bonus: 0,
	},
	{
		presetId: "desecrated-house",
		name: "Desecrated Ground (house rule)",
		source: "House rule",
		page: null,
		edition: null,
		description: "Undead standing here have advantage on saves and checks, including skills and initiative. Not the DMG rule.",
		eligibility: "undead",
		scopes: ["check", "save"],
		mode: "advantage",
		bonus: 0,
	},
	{
		presetId: "heavy-precipitation-xdmg",
		name: "Heavy Precipitation",
		source: "XDMG",
		page: 69,
		edition: "one",
		description: "Creatures in heavy rain or heavy snow have disadvantage on Wisdom (Perception) checks.",
		eligibility: "any",
		scopes: ["skill"],
		skill: "perception",
		contextQuestion: "Is this creature in heavy rain or heavy snow for this Perception check?",
		mode: "disadvantage",
		bonus: 0,
	},
	{
		presetId: "blizzard-idrotf",
		name: "Blizzard (ranged weapons)",
		source: "IDRotF",
		page: 10,
		edition: "classic",
		description: "A blizzard imposes disadvantage on ranged weapon attack rolls. Its sight/hearing Perception clauses are not included.",
		eligibility: "any",
		scopes: ["attack"],
		contextQuestion: "Is this a ranged weapon attack made in the blizzard?",
		mode: "disadvantage",
		bonus: 0,
	},
	{
		presetId: "ioun-dark-blue-rhomboid",
		name: "Dark Blue Rhomboid Ioun Stone #016",
		source: "MECIounStones",
		page: 18,
		edition: null,
		description: "While orbiting its owner, this homebrew stone gives advantage on initiative and Wisdom (Perception) checks.",
		eligibility: "any",
		scopes: ["initiative", "skill"],
		skill: "perception",
		contextQuestion: "Is this creature bonded to the stone, and is it orbiting their head now?",
		mode: "advantage",
		bonus: 0,
	},
];

const MODIFIER_SCOPES = ["check", "skill", "save", "initiative", "attack"];
const MODIFIER_MODES = ["normal", "advantage", "disadvantage"];
const PRESET_FIELDS = ["id", "presetId", "name", "scopes", "mode", "bonus", "source", "page", "edition"];
const LEGACY_PRESET_FIELDS = PRESET_FIELDS.slice(0, 6);
const LEGACY_PRESET_IDS = new Set(["desecrated-dmg", "desecrated-house"]);

export function getEncounterIsLegacyPresetId (presetId) { return LEGACY_PRESET_IDS.has(presetId); }

export function getEncounterIsUndead (monster) {
	const type = typeof monster?.type === "string" ? monster.type : monster?.type?.type;
	return typeof type === "string" && type.trim().toLowerCase() === "undead";
}

export function getEncounterPreset (presetId) {
	const preset = ENCOUNTER_ROLL_PRESETS.find(it => it.presetId === presetId);
	if (!preset) throw new Error("Choose a known Roll effects preset.");
	return preset;
}

export function getEncounterModifierForPreset (presetId) {
	const preset = getEncounterPreset(presetId);
	const {name, scopes, mode, bonus, source, page, edition} = preset;
	return {id: `preset:${presetId}`, presetId, name, scopes: [...scopes], mode, bonus, source, page, edition};
}

export function getEncounterPresetCitation (preset) {
	return preset.page == null ? preset.source : `${preset.source} p. ${preset.page}${preset.edition ? ` (${preset.edition === "one" ? "2024" : "2014"})` : ""}`;
}

export function getEncounterModifierAppliesToRoll (modifier, {rollType, key}) {
	const scope = {ability: "check", skill: "skill", save: "save", initiative: "initiative", attack: "attack"}[rollType];
	if (!scope) throw new Error(`Unsupported roll effect scope: ${rollType}.`);
	if (!modifier.scopes.includes(scope) && !(modifier.scopes.includes("check") && ["skill", "initiative"].includes(scope))) return false;
	const preset = modifier.presetId ? getEncounterPreset(modifier.presetId) : null;
	return !preset?.skill || rollType !== "skill" || key?.toLowerCase() === preset.skill;
}

export function validateEncounterAreaNote (note) {
	if (
		typeof note?.id !== "string" || !note.id.trim()
		|| !["trait", "lair"].includes(note.kind)
		|| typeof note.name !== "string" || !note.name.trim()
		|| typeof note.description !== "string" || !note.description.trim()
	) throw new Error("An area note needs an ID, a name, a description, and a valid kind.");
}

export function validateEncounterModifier (modifier) {
	if (
		typeof modifier?.id !== "string" || !modifier.id.trim()
		|| typeof modifier.name !== "string" || !modifier.name.trim()
		|| !Array.isArray(modifier.scopes) || !modifier.scopes.length
		|| modifier.scopes.some(scope => !MODIFIER_SCOPES.includes(scope))
		|| new Set(modifier.scopes).size !== modifier.scopes.length
		|| !MODIFIER_MODES.includes(modifier.mode)
		|| !Number.isSafeInteger(modifier.bonus)
		|| (modifier.mode === "normal" && modifier.bonus === 0)
	) throw new Error("A roll effect needs a name, valid check/skill/save/initiative/attack scope, mode, and exact whole-number bonus.");
	if (modifier.presetId == null) return;
	const preset = getEncounterModifierForPreset(modifier.presetId);
	const isLegacy = getEncounterIsLegacyPresetId(modifier.presetId)
		&& !["source", "page", "edition"].some(field => Object.hasOwn(modifier, field));
	const fields = isLegacy ? LEGACY_PRESET_FIELDS : PRESET_FIELDS;
	if (
		Object.keys(modifier).some(field => !fields.includes(field))
		|| fields.some(field => field === "scopes"
			? modifier.scopes.length !== preset.scopes.length || modifier.scopes.some(scope => !preset.scopes.includes(scope))
			: modifier[field] !== preset[field])
	) throw new Error("The saved Roll effects preset does not match its cited source.");
}

export function getEncounterEffectTargets (state, {targetIds = state.selectedIds, presetId = null} = {}) {
	if (!Array.isArray(targetIds) || !targetIds.length || new Set(targetIds).size !== targetIds.length) {
		throw new Error("Select at least one distinct monster.");
	}
	const preset = presetId == null ? null : getEncounterPreset(presetId);
	const targets = new Set(targetIds);
	if (state.instances.filter(it => targets.has(it.id)).length !== targets.size) {
		throw new Error("An encounter target no longer exists.");
	}
	const eligibleIds = [];
	const skippedIds = [];
	state.instances.forEach(instance => {
		if (!targets.has(instance.id)) return;
		(!preset || preset.eligibility !== "undead" || getEncounterIsUndead(instance.monster) ? eligibleIds : skippedIds).push(instance.id);
	});
	return {eligibleIds, skippedIds};
}
