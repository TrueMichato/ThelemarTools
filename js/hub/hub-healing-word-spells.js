const _TABLE_RULES = "At the table, check 60-foot range, caster sight, bonus-action and verbal casting eligibility. These rules are not checked by the server; sharing and consent do not prove eligibility. A5 Hub Healing Word/Mass Healing Word convention: after the casting modifier, healing cannot fall below the selected dice expression's minimum (2d4: 2 HP; 4d4: 4 HP). This is not an authored RAW minimum or a rule for other spells.";
const _PHB_TABLE_RULES = `${_TABLE_RULES} PHB healing has no effect on undead or constructs; check creature type at the table.`;

export const REVIEWED_HEALING_WORD_SPELLS = Object.freeze([
	...["PHB", "XPHB"].flatMap(source => [
		{name: "Healing Word", source, level: 1, maxTargets: 1, dice: source === "PHB" ? 1 : 2, dicePerHigherLevel: source === "PHB" ? 1 : 2, effectTemplateId: "spell.healing-word.heal"},
		{name: "Mass Healing Word", source, level: 3, maxTargets: 6, dice: source === "PHB" ? 1 : 2, dicePerHigherLevel: 1, effectTemplateId: "spell.mass-healing-word.heal"},
	]).map(definition => Object.freeze({
		...definition,
		sourceEntity: Object.freeze({
			type: "spell",
			uid: `${definition.name}|${definition.source}`.toLowerCase(),
			version: definition.source === "PHB" ? "phb-2014-v1" : "xphb-2024-v1",
		}),
		tableRules: definition.source === "PHB" ? _PHB_TABLE_RULES : _TABLE_RULES,
	})),
]);

export function resolveReviewedHealingWordSpell ({spell, selectedSlot, hasMetamagic = false, hasVariantComponent = false} = {}) {
	const definition = REVIEWED_HEALING_WORD_SPELLS.find(candidate =>
		candidate.name.toLowerCase() === String(spell?.name || "").trim().toLowerCase()
		&& candidate.source === spell?.source
		&& candidate.level === spell?.level,
	);
	if (
		!definition
		|| !Number.isInteger(selectedSlot?.level)
		|| selectedSlot.level < definition.level
		|| selectedSlot.level > 9
		|| selectedSlot.isPact
		|| selectedSlot.isNoSlotResource
		|| selectedSlot.isWizardCapstone
		|| hasMetamagic
		|| hasVariantComponent
	) return null;
	return {
		sourceEntity: definition.sourceEntity,
		effectTemplateId: definition.effectTemplateId,
		choice: {castLevel: selectedSlot.level},
		maxTargets: definition.maxTargets,
		tableRules: definition.tableRules,
	};
}
