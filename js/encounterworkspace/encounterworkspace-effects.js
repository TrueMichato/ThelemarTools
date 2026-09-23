export const ENCOUNTER_DESECRATED_PRESETS = [
	{
		presetId: "desecrated-dmg",
		name: "Desecrated Ground (DMG p. 110)",
		description: "Undead here have advantage on saving throws.",
		scopes: ["save"],
		mode: "advantage",
		bonus: 0,
	},
	{
		presetId: "desecrated-house",
		name: "Desecrated Ground (house rule)",
		description: "Undead here have advantage on saving throws and ability checks, including skills.",
		scopes: ["check", "save"],
		mode: "advantage",
		bonus: 0,
	},
];

const MODIFIER_SCOPES = ["check", "save"];
const MODIFIER_MODES = ["normal", "advantage", "disadvantage"];

export function getEncounterIsUndead (monster) {
	const type = typeof monster?.type === "string" ? monster.type : monster?.type?.type;
	return typeof type === "string" && type.trim().toLowerCase() === "undead";
}

export function getEncounterModifierForPreset (presetId) {
	const preset = ENCOUNTER_DESECRATED_PRESETS.find(it => it.presetId === presetId);
	if (!preset) throw new Error("Choose a known Desecrated Ground rule.");
	const {description, ...modifier} = preset;
	return {...modifier, id: `preset:${presetId}`, scopes: [...preset.scopes]};
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
	) throw new Error("A roll modifier needs a name, check/save scope, valid mode, and an exact whole-number bonus.");
	if (modifier.presetId == null) return;
	const preset = getEncounterModifierForPreset(modifier.presetId);
	if (
		modifier.id !== preset.id
		|| modifier.name !== preset.name
		|| modifier.mode !== preset.mode
		|| modifier.bonus !== preset.bonus
		|| modifier.scopes.length !== preset.scopes.length
		|| modifier.scopes.some(scope => !preset.scopes.includes(scope))
	) throw new Error("The saved Desecrated Ground rule does not match its source.");
}

export function getEncounterEffectTargets (state, {targetIds = state.selectedIds, presetId = null} = {}) {
	if (!Array.isArray(targetIds) || !targetIds.length || new Set(targetIds).size !== targetIds.length) {
		throw new Error("Select at least one distinct monster.");
	}
	if (presetId != null) getEncounterModifierForPreset(presetId);
	const targets = new Set(targetIds);
	if (state.instances.filter(it => targets.has(it.id)).length !== targets.size) {
		throw new Error("An encounter target no longer exists.");
	}
	const eligibleIds = [];
	const skippedIds = [];
	state.instances.forEach(instance => {
		if (!targets.has(instance.id)) return;
		(presetId == null || getEncounterIsUndead(instance.monster) ? eligibleIds : skippedIds).push(instance.id);
	});
	return {eligibleIds, skippedIds};
}
