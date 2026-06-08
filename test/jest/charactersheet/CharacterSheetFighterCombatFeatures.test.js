/**
 * Character Sheet — Fighter Combat Features (bugs #11 + #10-Fighter)
 *
 * Verifies the mechanics behind the dedicated Combat-tab Fighter section:
 * - Second Wind / Action Surge / Tactical Mind / Stamina Enthusiast are NOT mis-classified
 *   as activatable toggle states (they have their own section + usable controls).
 * - Removing the broad /second wind/i + /action surge/i activation patterns no longer
 *   produces text-match false positives on unrelated features.
 * - ensureFighterFeatureUses re-scales Second Wind / Action Surge maxima with level and
 *   keeps the mirrored resource in sync (fixing the stale grant-time max).
 * - use/restore semantics for Second Wind (HP + Stamina Enthusiast stamina mode) and
 *   Action Surge.
 * - Stamina Enthusiast: +2 stamina maximum and PB-sized stamina regain.
 * - Battle Tactics (TGTT) surfacing data: shape, conditional bonuses, and level-gated
 *   reactions.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const SECOND_WIND_DESC = "You have a limited well of stamina you can draw on. On your turn, "
	+ "you can use a Bonus Action to regain Hit Points equal to 1d10 plus your Fighter level. "
	+ "You can use this feature twice. You regain all expended uses when you finish a Short or Long Rest.";
const ACTION_SURGE_DESC = "On your turn, you can take one additional action. Once you use this "
	+ "feature, you must finish a Short or Long Rest before you can use it again.";
const TACTICAL_MIND_DESC = "When you fail an ability check, you can expend a use of your Second "
	+ "Wind to add 1d10 to the check, potentially turning a failure into a success.";
const STAMINA_ENTHUSIAST_DESC = "You gain an additional 2 stamina points. When you use your "
	+ "Second Wind feature, you can choose to regain a number of stamina points equal to your "
	+ "proficiency bonus instead of hit points.";

function buildFighter (level, source = "XPHB") {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({name: "Fighter", source, level});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("con", 14);
	return state;
}

function addSecondWind (state, source = "XPHB") {
	state.addFeature({name: "Second Wind", source, className: "Fighter", level: 1, description: SECOND_WIND_DESC});
}
function addActionSurge (state, source = "XPHB") {
	state.addFeature({name: "Action Surge", source, className: "Fighter", level: 2, description: ACTION_SURGE_DESC});
}

// ==========================================================================
// PART 1: Classification — no Active-State leak
// ==========================================================================
describe("Fighter action features are not activatable toggle states", () => {
	let state;
	beforeEach(() => {
		state = buildFighter(10, "XPHB");
		addSecondWind(state);
		addActionSurge(state);
		state.addFeature({name: "Tactical Mind", source: "XPHB", className: "Fighter", level: 2, description: TACTICAL_MIND_DESC});
		state.addFeature({name: "Stamina Enthusiast", source: "TGTT", className: "Fighter", level: 1, description: STAMINA_ENTHUSIAST_DESC});
	});

	it("routes Second Wind to the combat tab, not the Active-States panel", () => {
		const info = CharacterSheetState.detectActivatableFeature(state.getFeature("Second Wind"));
		// "combat" interactionMode → handled by the dedicated Fighter section, and
		// getActivatableFeatures() skips it (asserted below). It is never a toggle state.
		expect(info?.interactionMode).toBe("combat");
		expect(info?.isToggle).toBe(false);
	});

	it("routes Action Surge to the combat tab, not the Active-States panel", () => {
		const info = CharacterSheetState.detectActivatableFeature(state.getFeature("Action Surge"));
		expect(info?.interactionMode).toBe("combat");
		expect(info?.isToggle).toBe(false);
	});

	it("classifies Tactical Mind and Stamina Enthusiast as passive (override)", () => {
		expect(CharacterSheetState.detectActivatableFeature(state.getFeature("Tactical Mind"))).toBeNull();
		expect(CharacterSheetState.detectActivatableFeature(state.getFeature("Stamina Enthusiast"))).toBeNull();
	});

	it("does not surface any of the four in getActivatableFeatures", () => {
		const names = state.getActivatableFeatures().map(a => a.feature?.name);
		expect(names).not.toContain("Second Wind");
		expect(names).not.toContain("Action Surge");
		expect(names).not.toContain("Tactical Mind");
		expect(names).not.toContain("Stamina Enthusiast");
	});

	it("excludes Fighter-owned features from the generic Overview Actions list", () => {
		// The Overview Actions list renders every "combat"/"reaction"-classified feature.
		// Second Wind / Action Surge are "combat" but must be excluded there so the dedicated
		// Fighter section is their only interactive surface (with correct heal/stamina logic).
		const Combat = globalThis.CharacterSheetCombat;
		expect(Combat).toBeDefined();
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		const names = combat.getCombatClassifiedFeatures().map(f => f.name);
		expect(names).not.toContain("Second Wind");
		expect(names).not.toContain("Action Surge");
	});

	it("no longer mis-detects unrelated features that merely mention 'second wind' in prose", () => {
		// Before the fix, the broad /second wind/i pattern flagged ANY feature whose
		// description contained the phrase as an activatable custom state.
		const benign = {
			name: "Inspiring Resolve",
			source: "HB",
			description: "You are steadied by the second wind of battle, granting your allies courage.",
		};
		expect(CharacterSheetState.detectActivatableFeature(benign)).toBeNull();
	});
});

// ==========================================================================
// PART 2: hasFighterFeatures gate
// ==========================================================================
describe("hasFighterFeatures gate", () => {
	it("is true for a Fighter", () => {
		expect(buildFighter(1).hasFighterFeatures()).toBe(true);
	});

	it("is false for a non-Fighter without Battle Tactics", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		expect(state.hasFighterFeatures()).toBe(false);
	});

	it("is true for any class that has learned a Battle Tactic", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		state.addFeature({name: "High Ground", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["BT"], description: "Gain a bonus when above your enemy."});
		expect(state.hasFighterFeatures()).toBe(true);
	});
});

// ==========================================================================
// PART 3: Uses scaling (ensureFighterFeatureUses)
// ==========================================================================
describe("Second Wind / Action Surge uses scale with level", () => {
	it("re-scales a stale grant-time Second Wind max (parsed 2) up to 4 at level 10", () => {
		const state = buildFighter(10, "XPHB");
		addSecondWind(state);
		// Grant-time parse stored max 2 (the "twice" wording).
		expect(state.getFeature("Second Wind").uses.max).toBe(2);
		// Reading remaining triggers the idempotent ensure, fixing the max.
		expect(state.getSecondWindUsesMax()).toBe(4);
		expect(state.getSecondWindUsesRemaining()).toBe(4);
		expect(state.getFeature("Second Wind").uses.max).toBe(4);
	});

	it("keeps the mirrored resource in sync with the corrected max", () => {
		const state = buildFighter(10, "XPHB");
		addSecondWind(state);
		state.getSecondWindUsesRemaining(); // trigger ensure
		const resource = state.getResources().find(r => r.name === "Second Wind");
		expect(resource).toBeDefined();
		expect(resource.max).toBe(4);
		expect(resource.current).toBe(4);
	});

	it("scales Action Surge to 2 uses at level 17", () => {
		const state = buildFighter(17, "XPHB");
		addActionSurge(state);
		expect(state.getActionSurgeUsesMax()).toBe(2);
		expect(state.getActionSurgeUsesRemaining()).toBe(2);
	});

	it("preserves partially-spent uses when the max later increases", () => {
		const state = buildFighter(4, "XPHB"); // Second Wind max 3 at level 4
		addSecondWind(state);
		expect(state.getSecondWindUsesMax()).toBe(3);
		// Spend two uses (1 remaining).
		state.useSecondWind("hp");
		state.useSecondWind("hp");
		expect(state.getSecondWindUsesRemaining()).toBe(1);
		// Level up to 10 (max 4); the single remaining use is preserved, not refilled.
		state.addClass({name: "Fighter", source: "XPHB", level: 10});
		expect(state.getSecondWindUsesMax()).toBe(4);
		expect(state.getSecondWindUsesRemaining()).toBe(1);
	});

	it("PHB Second Wind stays at a single use", () => {
		const state = buildFighter(10, "PHB");
		addSecondWind(state, "PHB");
		expect(state.getSecondWindUsesMax()).toBe(1);
		expect(state.getSecondWindUsesRemaining()).toBe(1);
	});
});

// ==========================================================================
// PART 4: use / restore semantics
// ==========================================================================
describe("Second Wind / Action Surge use and restore", () => {
	it("useSecondWind decrements and returns false when exhausted", () => {
		const state = buildFighter(1, "XPHB"); // 2 uses
		addSecondWind(state);
		expect(state.useSecondWind("hp")).toBe(true);
		expect(state.useSecondWind("hp")).toBe(true);
		expect(state.getSecondWindUsesRemaining()).toBe(0);
		expect(state.useSecondWind("hp")).toBe(false);
	});

	it("useActionSurge decrements and returns false when exhausted", () => {
		const state = buildFighter(2, "XPHB"); // 1 use
		addActionSurge(state);
		expect(state.useActionSurge()).toBe(true);
		expect(state.getActionSurgeUsesRemaining()).toBe(0);
		expect(state.useActionSurge()).toBe(false);
	});

	it("restoreSecondWind / restoreActionSurge refill to the level-correct max", () => {
		const state = buildFighter(17, "XPHB"); // SW 5, AS 2
		addSecondWind(state);
		addActionSurge(state);
		state.useSecondWind("hp");
		state.useActionSurge();
		state.useActionSurge();
		expect(state.getSecondWindUsesRemaining()).toBe(4);
		expect(state.getActionSurgeUsesRemaining()).toBe(0);
		state.restoreSecondWind();
		state.restoreActionSurge();
		expect(state.getSecondWindUsesRemaining()).toBe(5);
		expect(state.getActionSurgeUsesRemaining()).toBe(2);
	});
});

// ==========================================================================
// PART 5: Stamina Enthusiast (TGTT)
// ==========================================================================
describe("Stamina Enthusiast", () => {
	function buildStaminaFighter (level = 5) {
		const state = buildFighter(level, "TGTT");
		state.addCombatTradition("AM"); // enables the stamina/combat system
		state.addFeature({name: "Stamina Enthusiast", source: "TGTT", className: "Fighter", level: 1, description: STAMINA_ENTHUSIAST_DESC});
		addSecondWind(state, "XPHB");
		return state;
	}

	it("reports hasStaminaEnthusiast and a PB-sized stamina gain", () => {
		const state = buildStaminaFighter(5);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasStaminaEnthusiast).toBe(true);
		expect(calcs.staminaEnthusiastStaminaGain).toBe(state.getProficiencyBonus());
	});

	it("adds +2 to the stamina maximum", () => {
		const state = buildStaminaFighter(5);
		state.ensureStaminaInitialized();
		// Base stamina max is 2 × proficiency bonus; Stamina Enthusiast adds +2.
		expect(state.getStaminaMax()).toBe(2 * state.getProficiencyBonus() + 2);
	});

	it("stamina-mode Second Wind regains proficiency-bonus stamina and spends a use", () => {
		const state = buildStaminaFighter(5);
		state.ensureStaminaInitialized();
		state.setStaminaCurrent(0);
		const before = state.getStaminaCurrent();
		const usesBefore = state.getSecondWindUsesRemaining();
		expect(state.useSecondWind("stamina")).toBe(true);
		expect(state.getStaminaCurrent()).toBe(before + state.getProficiencyBonus());
		expect(state.getSecondWindUsesRemaining()).toBe(usesBefore - 1);
	});
});

// ==========================================================================
// PART 6: Tactical Mind reminder availability
// ==========================================================================
describe("Tactical Mind", () => {
	it("is available for an XPHB Fighter at level 2+", () => {
		expect(buildFighter(1, "XPHB").getFeatureCalculations().hasTacticalMind).toBeFalsy();
		expect(buildFighter(2, "XPHB").getFeatureCalculations().hasTacticalMind).toBe(true);
	});

	it("is available for a TGTT Fighter at level 2+", () => {
		expect(buildFighter(2, "TGTT").getFeatureCalculations().hasTacticalMind).toBe(true);
	});

	it("is not granted to a classic PHB Fighter", () => {
		expect(buildFighter(5, "PHB").getFeatureCalculations().hasTacticalMind).toBeFalsy();
	});
});

// ==========================================================================
// PART 7: Battle Tactics surfacing data (bug #11)
// ==========================================================================
describe("Battle Tactics", () => {
	function buildBattleMaster (level = 7) {
		const state = buildFighter(level, "TGTT");
		state.addFeature({name: "High Ground", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["BT"], description: "When attacking from 5+ ft above an enemy, gain a bonus to the attack."});
		state.addFeature({name: "Eye of the Storm", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["BT"], description: "When flanked, a reaction makes one flanking enemy attack with disadvantage."});
		return state;
	}

	it("reports hasBattleTactics", () => {
		expect(buildBattleMaster().hasBattleTactics()).toBe(true);
	});

	it("returns tactic shape with mechanical effects", () => {
		const tactics = buildBattleMaster().getBattleTactics();
		const highGround = tactics.find(t => t.name === "High Ground");
		expect(highGround).toBeDefined();
		expect(highGround.attackBonus).toBe(2);
		expect(highGround.attackType).toBe("ranged");
	});

	it("exposes conditional attack modifiers from passive tactics", () => {
		const mods = buildBattleMaster().getConditionalAttackModifiers("ranged");
		expect(mods.some(m => m.source === "High Ground" && m.value === 2)).toBe(true);
	});

	it("gates reaction tactics behind the required Fighter level", () => {
		const low = buildBattleMaster(5); // Eye of the Storm requires level 7
		expect(low.meetsBattleTacticPrerequisite(7)).toBe(false);
		expect(low.getAvailableCombatReactions().some(r => r.source === "Eye of the Storm")).toBe(false);

		const high = buildBattleMaster(7);
		expect(high.meetsBattleTacticPrerequisite(7)).toBe(true);
		expect(high.getAvailableCombatReactions().some(r => r.source === "Eye of the Storm")).toBe(true);
	});
});
