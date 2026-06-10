/**
 * TGTT Combat-Method STANCES — mechanical effect application (Bug #1).
 *
 * Regression coverage for the bug where activating a stance set a UI active-state
 * but applied NO mechanical benefit. Two root causes are exercised:
 *
 *   1. State-level finder predicate only matched the LEGACY `CTM:` optionalFeature
 *      shape and missed pure NEW `combatMethod` entities (no optionalFeatureTypes),
 *      so `_getActiveStanceEffects()` returned null. Fixed by routing all four
 *      finder functions through `_findCombatMethodFeature()` /
 *      `CharacterSheetClassUtils.isCombatMethod()`.
 *
 *   2. The Combat-tab activation bridge (`charactersheet-combat.js::_activateMethodEffect`)
 *      created the `combatStance` active-state but never called
 *      `state.activateStance()`, so `_data.activeStance` stayed null and no bonus
 *      resolved. Fixed by mirroring the Features-tab path.
 *
 * Assertions target the real consumers: passive score, skill mod, save calc,
 * walk speed — and deactivation removing each. Passive Perception follows the
 * established codebase contract (RAW): a stance's "+prof to checks" clause also
 * flows into the passive score, so Perceptive Stance nets passive +3 (explicit
 * clause) + proficiency bonus (skill clause). See CharacterSheetCombatMethodsSurvey.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// --- Stance fixtures ---------------------------------------------------------

// Perceptive Stance — passive Wisdom (Perception) +3 AND +prof to Perception
// checks. Carries BOTH the new entity shape and a legacy `optionalFeatureTypes`
// (matching the repro character, where migrated methods retain both).
const PERCEPTIVE_STANCE = {
	name: "Perceptive Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Razor's Edge",
	degree: 1,
	staminaCost: 1,
	optionalFeatureTypes: ["CTM:1"],
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. As a bonus action, you heighten your senses. While in this stance, your passive Wisdom (Perception) score increases by 3, and you gain a bonus to Wisdom (Perception) checks equal to your proficiency bonus. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

// Pure NEW combatMethod entity — NO optionalFeatureTypes. This is the shape the
// legacy-only finder predicate missed entirely.
const PERCEPTIVE_STANCE_NEW_ONLY = {
	name: "Perceptive Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Razor's Edge",
	degree: 1,
	staminaCost: 1,
	entries: PERCEPTIVE_STANCE.entries,
};

// Heavy Stance — Strength (Athletics) skill +prof AND a save bonus to resist
// being moved/knocked prone (parsed as the `resistMovement` save key).
const HEAVY_STANCE = {
	name: "Heavy Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Adamant Mountain",
	degree: 1,
	staminaCost: 1,
	optionalFeatureTypes: ["CTM:1"],
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. As a bonus action, you enter a heavily-braced stance. While in this stance, you gain a bonus to Strength (Athletics) checks equal to your proficiency bonus, you gain a bonus equal to your proficiency bonus on saving throws made to resist being moved or knocked {@condition prone}, and you ignore the first 10 feet of difficult terrain you move through on your turn. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

// Swift Stance — Speed increases by 5 feet.
const SWIFT_STANCE = {
	name: "Swift Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Tempered Iron",
	degree: 1,
	staminaCost: 1,
	optionalFeatureTypes: ["CTM:1"],
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. You adopt a loose stance that gives you an extra bit of swiftness that can make all the difference in a fight or chase. Your Speed increases by 5 feet. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

// Jovial Stance — Dexterity (Acrobatics) AND Charisma (Performance) +prof.
const JOVIAL_STANCE = {
	name: "Jovial Stance",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Razor's Edge",
	degree: 1,
	staminaCost: 1,
	optionalFeatureTypes: ["CTM:1"],
	entries: [
		"{@b Bonus Action (1 Stamina Point)}. As a bonus action, you adopt a lighthearted and unpredictable stance. While in this stance, you gain a bonus to Dexterity (Acrobatics) and Charisma (Performance) checks equal to your proficiency bonus. This stance lasts until you are {@condition incapacitated|tgtt} or use a bonus action to end it.",
	],
};

function buildState (...stances) {
	const state = new CharacterSheetState();
	// Ranger 6 → proficiency bonus +3
	state.addClass({name: "Ranger", source: "TGTT", level: 6});
	state.setAbilityBase("wis", 14); // +2
	state.setAbilityBase("str", 12); // +1
	state.setAbilityBase("dex", 14); // +2
	state.setAbilityBase("cha", 10); // +0
	for (const s of stances) state.addFeature(s);
	return state;
}

describe("Stance finder matches both legacy and new combatMethod shapes", () => {
	it("isMethodStance resolves a pure new-entity stance with no optionalFeatureTypes", () => {
		const state = buildState(PERCEPTIVE_STANCE_NEW_ONLY);
		expect(state.isMethodStance("Perceptive Stance")).toBe(true);
	});

	it("activateStance succeeds for a pure new-entity stance (legacy predicate would miss it)", () => {
		const state = buildState(PERCEPTIVE_STANCE_NEW_ONLY);
		expect(state.activateStance("Perceptive Stance")).toBe(true);
		expect(state.getActiveStance()).toBe("Perceptive Stance");
		// And the effects actually resolve (the bug: finder returned null → no effects)
		const effects = state._getActiveStanceEffects();
		expect(effects).not.toBeNull();
		expect(effects.passiveBonuses.perception).toBe(3);
	});
});

describe("Perceptive Stance applies passive + skill bonuses", () => {
	it("raises passive Perception and adds proficiency bonus to Perception checks", () => {
		const state = buildState(PERCEPTIVE_STANCE);

		const basePassive = state.getPassivePerception();
		const baseSkill = state.getSkillMod("perception");
		const pb = state.getProficiencyBonus();

		expect(state.activateStance("Perceptive Stance")).toBe(true);

		// Perception checks gain +proficiency bonus (Ranger 6 → +3)
		expect(state.getSkillMod("perception")).toBe(baseSkill + pb);
		// Passive Perception: explicit +3 clause AND the +prof check bonus flows into
		// passive (RAW: passive uses the check modifier) → net +3 + prof.
		expect(state.getPassivePerception()).toBe(basePassive + 3 + pb);

		// getFeatureCalculations surfaces the structured bonuses
		const calcs = state.getFeatureCalculations();
		expect(calcs.activeStance).toBe("Perceptive Stance");
		expect(calcs.stancePassiveBonuses.perception).toBe(3);
		expect(calcs.stanceSkillBonuses.perception).toBe(pb);
	});

	it("deactivation removes the passive and skill bonuses", () => {
		const state = buildState(PERCEPTIVE_STANCE);
		const basePassive = state.getPassivePerception();
		const baseSkill = state.getSkillMod("perception");

		state.activateStance("Perceptive Stance");
		state.deactivateStance();

		expect(state.getActiveStance()).toBeNull();
		expect(state.getPassivePerception()).toBe(basePassive);
		expect(state.getSkillMod("perception")).toBe(baseSkill);
		expect(state.getFeatureCalculations().stancePassiveBonuses).toBeUndefined();
	});
});

describe("Heavy Stance applies a skill bonus and a save bonus", () => {
	it("adds proficiency to Athletics and exposes the resistMovement save bonus", () => {
		const state = buildState(HEAVY_STANCE);
		const baseAthletics = state.getSkillMod("athletics");

		expect(state.activateStance("Heavy Stance")).toBe(true);

		expect(state.getSkillMod("athletics")).toBe(baseAthletics + state.getProficiencyBonus());

		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSaveBonuses.resistMovement).toBe(state.getProficiencyBonus());
	});

	it("deactivation removes the Athletics and save bonuses", () => {
		const state = buildState(HEAVY_STANCE);
		const baseAthletics = state.getSkillMod("athletics");

		state.activateStance("Heavy Stance");
		state.deactivateStance();

		expect(state.getSkillMod("athletics")).toBe(baseAthletics);
		expect(state.getFeatureCalculations().stanceSaveBonuses).toBeUndefined();
	});
});

describe("Swift Stance applies a speed bonus", () => {
	it("increases walking speed by 5 feet while active and reverts on deactivation", () => {
		const state = buildState(SWIFT_STANCE);
		const baseSpeed = state.getWalkSpeed();

		expect(state.activateStance("Swift Stance")).toBe(true);
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);
		expect(state.getFeatureCalculations().stanceSpeedBonus).toBe(5);

		state.deactivateStance();
		expect(state.getWalkSpeed()).toBe(baseSpeed);
	});
});

describe("Jovial Stance applies multi-skill bonuses", () => {
	it("adds proficiency to both Acrobatics and Performance", () => {
		const state = buildState(JOVIAL_STANCE);
		const baseAcro = state.getSkillMod("acrobatics");
		const basePerf = state.getSkillMod("performance");

		expect(state.activateStance("Jovial Stance")).toBe(true);

		const pb = state.getProficiencyBonus();
		expect(state.getSkillMod("acrobatics")).toBe(baseAcro + pb);
		expect(state.getSkillMod("performance")).toBe(basePerf + pb);
	});
});

describe("Switching stances swaps the active effects (new-entity shape)", () => {
	it("activating a second stance clears the first stance's effects and applies the new one", () => {
		const state = buildState(PERCEPTIVE_STANCE_NEW_ONLY, SWIFT_STANCE);
		const baseSpeed = state.getWalkSpeed();
		const basePerception = state.getPassivePerception();

		state.activateStance("Perceptive Stance");
		expect(state.getFeatureCalculations().stancePassiveBonuses?.perception).toBe(3);
		expect(state.getWalkSpeed()).toBe(baseSpeed); // Perceptive grants no speed

		// Switching stance auto-deactivates the previous one (single active stance)
		state.activateStance("Swift Stance");
		expect(state.getActiveStance()).toBe("Swift Stance");
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);
		// Perceptive's passive bonus must be gone
		expect(state.getFeatureCalculations().stancePassiveBonuses).toBeUndefined();
		expect(state.getPassivePerception()).toBe(basePerception);
	});
});

describe("Combat-tab activation bridge wires the stance system", () => {
	let savedDocument;
	beforeAll(() => {
		// CharacterSheetCombat's constructor wires DOM event listeners via
		// document.getElementById(...)?.addEventListener. Provide a minimal stub so
		// the module can be instantiated under the node test environment.
		savedDocument = globalThis.document;
		globalThis.document = {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {}};
	});
	afterAll(() => {
		globalThis.document = savedDocument;
	});

	function buildCombat (state) {
		const page = {
			getState: () => state,
			getNotes: () => null,
			_renderActiveStates: () => {},
			_saveCurrentCharacter: () => {},
			_renderCharacter: () => {},
		};
		const combat = new CharacterSheetCombat(page);
		// Stub DOM-touching renders — we only assert state mutations here.
		combat.renderCombatStates = () => {};
		combat.renderCombatEffects = () => {};
		return combat;
	}

	it("_activateMethodEffect sets _data.activeStance so mechanical effects apply", () => {
		const state = buildState(PERCEPTIVE_STANCE);
		const combat = buildCombat(state);

		const basePassive = state.getPassivePerception();
		const pb = state.getProficiencyBonus();
		const method = state.getCombatMethods().find(m => m.name === "Perceptive Stance");
		const btn = {classList: {add: () => {}, remove: () => {}}};

		combat._activateMethodEffect(btn, "perceptive-stance", method, 1, "stamina");

		// The bug: badge shown but activeStance null → no bonus. Now it must be set
		// AND the mechanical effect must resolve through the real consumer.
		expect(state.getActiveStance()).toBe("Perceptive Stance");
		expect(state.getPassivePerception()).toBe(basePassive + 3 + pb);
		expect(state.getFeatureCalculations().stancePassiveBonuses.perception).toBe(3);
	});

	it("rolls back the combatStance badge when activateStance fails", () => {
		const state = buildState(PERCEPTIVE_STANCE);
		const combat = buildCombat(state);
		const method = state.getCombatMethods().find(m => m.name === "Perceptive Stance");
		const btn = {classList: {add: () => {}, remove: () => {}}};

		// Force activation failure (e.g. method no longer resolvable).
		state.activateStance = () => false;

		combat._activateMethodEffect(btn, "perceptive-stance", method, 1, "stamina");

		// No stale active-state badge should remain.
		expect(state.isStateActive("combatStance")).toBe(false);
		expect(state.getActiveStance()).toBeNull();
	});
});
