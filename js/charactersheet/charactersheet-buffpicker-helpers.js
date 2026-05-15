"use strict";

/**
 * Pure helpers for the Apply-Buff picker modal.
 *
 * Lives in its own module so the helper-only Jest suite can import it without
 * pulling the full `charactersheet.js` tree (which is intentionally avoided in
 * the unit tests — see test/jest/charactersheet/CharacterSheetLanguageFiltering.test.js
 * for the established pattern).
 *
 * `CharacterSheetPage` re-exposes these on its prototype / as statics so the
 * existing call-sites continue to read naturally; this module is the source
 * of truth.
 */

export const BUFF_CATEGORY_ORDER = ["defense", "offense", "healing", "movement", "utility"];

export const BUFF_CATEGORY_META = {
	defense: {label: "Defenses", icon: "🛡️"},
	offense: {label: "Offense", icon: "⚔️"},
	healing: {label: "Healing & HP", icon: "❤️"},
	movement: {label: "Movement", icon: "🏃"},
	utility: {label: "Utility", icon: "✨"},
};

/**
 * Bucket a SPELL_BUFF_REGISTRY entry into a single category. First match wins
 * in a fixed priority order so each spell appears in exactly one group of the
 * picker; explicit `spec.category` (if ever added) wins over derivation.
 */
export function categoriseBuffEntry (spec) {
	if (spec?.category && BUFF_CATEGORY_META[spec.category]) return spec.category;

	const effects = Array.isArray(spec?.selfEffects) ? spec.selfEffects : [];
	const matches = (predicate) => effects.some(predicate);

	// Healing first — keeps Aid / Heroes' Feast out of the Defense bucket
	// even though +HP is defensively useful.
	if (matches(e => e.type === "hpMaxIncrease" || e.type === "maxHealing")) return "healing";

	if (matches(e =>
		(e.type === "bonus" && e.target === "ac")
		|| e.type === "setAc"
		|| e.type === "minAc"
		|| e.type === "tempHp"
		|| e.type === "resistance"
		|| e.type === "immunity"
		|| e.type === "deathWard"
		|| e.type === "sanctuaryProtection"
		|| e.type === "mirrorImage"
		|| (e.type === "advantage" && typeof e.target === "string" && e.target.startsWith("save")),
	)) return "defense";

	if (matches(e =>
		(e.type === "rollBonus" && (e.target === "attack" || e.target === "damage"))
		|| (e.type === "bonus" && (e.target === "attack" || e.target === "damage"))
		|| e.type === "extraDamage"
		|| (e.type === "advantage" && typeof e.target === "string" && e.target.startsWith("attack")),
	)) return "offense";

	if (matches(e =>
		e.type === "speedMultiplier"
		|| e.type === "flySpeed"
		|| e.type === "sizeIncrease",
	)) return "movement";

	return "utility";
}

/**
 * Turn one effect entry into an `{icon, label, tone}` chip — or null when
 * the effect doesn't surface as a chip. `tone` matches the category palette.
 */
export function buildBuffEffectChip (eff) {
	if (!eff || !eff.type) return null;
	switch (eff.type) {
		case "hpMaxIncrease": return {icon: "❤️", label: `+${eff.value} max HP`, tone: "healing"};
		case "tempHp": return {icon: "🩹", label: `${eff.value} temp HP`, tone: "healing"};
		case "maxHealing": return {icon: "❤️", label: `Max healing`, tone: "healing"};
		case "bonus":
			if (eff.target === "ac") return {icon: "🛡️", label: `+${eff.value} AC`, tone: "defense"};
			if (eff.target === "attack") return {icon: "⚔️", label: `+${eff.value} attack`, tone: "offense"};
			if (eff.target === "damage") return {icon: "💥", label: `+${eff.value} damage`, tone: "offense"};
			return {icon: "➕", label: `+${eff.value} ${eff.target}`, tone: "utility"};
		case "rollBonus":
			if (eff.target === "attack") return {icon: "⚔️", label: `+${eff.dice} atk`, tone: "offense"};
			if (eff.target === "damage") return {icon: "💥", label: `+${eff.dice} dmg`, tone: "offense"};
			return {icon: "🎲", label: `+${eff.dice} ${eff.target}`, tone: "utility"};
		case "rollPenalty": return {icon: "🎲", label: `−${eff.dice} ${eff.target}`, tone: "utility"};
		case "setAc": return {icon: "🛡️", label: `AC = ${eff.baseAc}${eff.addDex ? "+DEX" : ""}`, tone: "defense"};
		case "minAc": return {icon: "🛡️", label: `AC ≥ ${eff.value}`, tone: "defense"};
		case "advantage": {
			const tgt = String(eff.target || "");
			if (tgt.startsWith("save")) return {icon: "⚡", label: `Adv ${tgt.replace(/^save:?/, "save ")}`.trim(), tone: "defense"};
			if (tgt.startsWith("attack")) return {icon: "⚡", label: `Adv attack`, tone: "offense"};
			return {icon: "⚡", label: `Adv ${tgt}`, tone: "utility"};
		}
		case "disadvantage": return {icon: "⚠️", label: `Disadv ${eff.target}`, tone: "utility"};
		case "resistance": return {icon: "🔥", label: `Resist ${String(eff.target || "").replace(/^damage:/, "")}`, tone: "defense"};
		case "immunity": return {icon: "🛡️", label: `Immune ${eff.target}`, tone: "defense"};
		case "speedMultiplier": return {icon: "🏃", label: `Speed ×${eff.value}`, tone: "movement"};
		case "flySpeed": return {icon: "🪽", label: `Fly ${eff.value} ft`, tone: "movement"};
		case "sizeIncrease": return {icon: "📏", label: `Size +${eff.value || 1}`, tone: "movement"};
		case "extraDamage": return {icon: "💥", label: `+${eff.dice}${eff.damageType ? ` ${eff.damageType}` : ""}`, tone: "offense"};
		case "sense": return {icon: "👁️", label: `${eff.target} ${eff.value} ft`, tone: "utility"};
		case "deathWard": return {icon: "💀", label: `Death Ward`, tone: "defense"};
		case "sanctuaryProtection": return {icon: "🛡️", label: `Sanctuary`, tone: "defense"};
		case "mirrorImage": return {icon: "🪞", label: `Mirror Image`, tone: "defense"};
		case "note": return eff.value ? {icon: "📝", label: String(eff.value).slice(0, 24), tone: "utility", title: eff.value} : null;
		default: return {icon: "✨", label: eff.type, tone: "utility"};
	}
}

/** Cap visible chips at 3, fold the rest into a "+N more" overflow chip. */
export function getBuffEffectChips (spec) {
	const effects = Array.isArray(spec?.selfEffects) ? spec.selfEffects : [];
	const chips = [];
	for (const eff of effects) {
		const chip = buildBuffEffectChip(eff);
		if (chip) chips.push(chip);
	}
	const MAX_VISIBLE = 3;
	if (chips.length <= MAX_VISIBLE) return chips;
	const visible = chips.slice(0, MAX_VISIBLE);
	const overflow = chips.length - MAX_VISIBLE;
	visible.push({
		icon: "➕",
		label: `${overflow} more`,
		tone: "utility",
		title: chips.slice(MAX_VISIBLE).map(c => `${c.icon} ${c.label}`).join("\n"),
	});
	return visible;
}

/** Standardised duration string for the picker row. */
export function formatBuffDuration (duration, concentration) {
	if (!duration) return concentration ? "Concentration" : "—";
	if (typeof duration === "object" && duration.amount && duration.unit) {
		const unitLabel = duration.amount === 1 ? duration.unit : `${duration.unit}s`;
		const base = `${duration.amount} ${unitLabel}`;
		return concentration ? `Conc., up to ${base}` : base;
	}
	return concentration ? `Conc., ${duration}` : String(duration);
}

/** True when an isSpellEffect active state with the same name is currently active. */
export function isBuffSpellActive (displayName, activeStates) {
	if (!displayName || !Array.isArray(activeStates)) return false;
	const target = displayName.toLowerCase();
	return activeStates.some(s => s?.active && s.isSpellEffect && (s.name || "").toLowerCase() === target);
}

const exportsObj = {
	BUFF_CATEGORY_ORDER,
	BUFF_CATEGORY_META,
	categoriseBuffEntry,
	buildBuffEffectChip,
	getBuffEffectChips,
	formatBuffDuration,
	isBuffSpellActive,
};

if (typeof globalThis !== "undefined") {
	globalThis.CharacterSheetBuffPickerHelpers = exportsObj;
}

export default exportsObj;
