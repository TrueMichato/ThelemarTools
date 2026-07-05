/**
 * Character Sheet — Principles of Devotion effect application: "Chaste" (R45 Bug 5c).
 *
 * The chosen principle IS stored as a feature with full text, but its mechanical effect
 * ("add your Wisdom modifier to any saving throws made to resist being charmed") never
 * applied, for two reasons this file locks in:
 *   1. FeatureModifierParser emitted the ability bonus under a dead `addAbilityMod` key
 *      that no consumer read → a no-op `save:all +0`. It now emits `abilityMod`.
 *   2. The conditional pattern only matched "against X", not "made to resist being X",
 *      so Chaste registered as an unconditional all-saves +0. It now yields a scoped
 *      `against:charmed` conditional.
 *
 * A loadFromJson migration (_migrateFeatureAbilityModModifiers) repairs the persisted
 * stale modifier on existing saves.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

const CHASTE_TEXT =
	"In exchange for forgoing pleasures of the heart and flesh, you are hardened to the persuasions of others. "
	+ "Add your Wisdom modifier to any saving throws made to resist being charmed. "
	+ "You also gain one skill specialty chosen from Insight, Persuasion, or Religion.";

describe("Chaste effect — parser", () => {
	it("emits an ability-scaled, charm-scoped save modifier (abilityMod, not addAbilityMod)", () => {
		const mods = FeatureModifierParser.parseModifiers(CHASTE_TEXT, "Chaste");
		const save = mods.find(m => m.type === "save:all");
		expect(save).toBeTruthy();
		expect(save.abilityMod).toBe("wis");
		expect(save.addAbilityMod).toBeUndefined();
		expect(save.conditional).toBe("against:charmed");
	});
});

describe("Chaste effect — loadFromJson migration repairs a stale saved modifier", () => {
	function mkStateWithStaleChaste (wis = 18) {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", wis);
		const chaste = {
			id: "chaste-feature-id",
			name: "Chaste",
			source: "TGTT-2014",
			className: "Cleric",
			classSource: "TGTT-2014",
			description: CHASTE_TEXT,
		};
		state._data.features.push(chaste);
		// The pre-fix persisted no-op: value 0, no abilityMod, no conditional, enabled at base.
		state._data.namedModifiers.push({
			id: "chaste-mod-id",
			name: "Chaste",
			type: "save:all",
			value: 0,
			note: "From Chaste",
			enabled: true,
			sourceFeatureId: chaste.id,
		});
		return state;
	}

	it("enriches the stale modifier with abilityMod + conditional and disables the base", () => {
		const state = mkStateWithStaleChaste(18);
		state._migrateFeatureAbilityModModifiers();

		const mod = state._data.namedModifiers.find(m => m.name === "Chaste");
		expect(mod.abilityMod).toBe("wis");
		expect(mod.conditional).toBe("against:charmed");
		expect(mod.enabled).toBe(false); // conditional → only applies in-scope
	});

	it("makes the modifier resolve to the live Wisdom modifier (not +0)", () => {
		const state = mkStateWithStaleChaste(18); // WIS +4
		state._migrateFeatureAbilityModModifiers();
		const mod = state._data.namedModifiers.find(m => m.name === "Chaste");
		expect(state._resolveNamedModifierNumericValue(mod)).toBe(state.getAbilityMod("wis"));
		expect(state._resolveNamedModifierNumericValue(mod)).toBe(4);
	});

	it("surfaces as a conditional save modifier displayed as 'vs Charmed'", () => {
		const state = mkStateWithStaleChaste(18);
		state._migrateFeatureAbilityModModifiers();
		// A conditional modifier is opt-in: enable it to simulate the in-scope situation.
		const mod = state._data.namedModifiers.find(m => m.name === "Chaste");
		mod.enabled = true;
		const list = state.getConditionalModifiersByType("save:all");
		expect(list.some(m => m.name === "Chaste")).toBe(true);
		expect(state.formatConditionalText(mod)).toBe("vs Charmed");
	});

	it("is idempotent — a second migration pass changes nothing", () => {
		const state = mkStateWithStaleChaste(18);
		state._migrateFeatureAbilityModModifiers();
		const before = JSON.stringify(state._data.namedModifiers);
		state._migrateFeatureAbilityModModifiers();
		expect(JSON.stringify(state._data.namedModifiers)).toBe(before);
	});
});
