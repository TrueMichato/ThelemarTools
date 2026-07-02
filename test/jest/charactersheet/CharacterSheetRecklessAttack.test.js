/**
 * S2 Bug #7 — Reckless Attack roll button (combat attack rows).
 *
 * A Barbarian's attack rows gain a "⚡ Reckless" button that (a) ensures the
 * persistent `recklessAttack` active state is on, then (b) rolls the attack
 * through the NORMAL `_rollAttack` path so the state's advantage flows through
 * `hasAdvantageFromStates` and still cancels with any disadvantage — we never
 * force raw advantage. The state is left ON afterwards (Reckless lasts until the
 * character's next turn), matching the existing quick-toggle.
 *
 * Also guards the root-cause scoping fix in `_rollAttack`: Reckless's advantage
 * is scoped to melee-Strength attacks. It must NOT leak onto ranged rolls (the
 * old `|| hasAdvantageFromStates("attack")` fallback wrongly bubbled the
 * specific `attack:melee:str` effect onto every roll), and a "finesse" weapon
 * used with Strength must correctly pick up the melee-STR advantage.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// ---------------------------------------------------------------------------
// Real-state pipeline harness — drives the genuine `_rollAttack` /
// `_rollRecklessAttack` code against a real Barbarian state, capturing the
// d20 `mode` the pipeline asks for (advantage / disadvantage / normal).
// ---------------------------------------------------------------------------
function mkRecklessCombat ({str = 18, dex = 12} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source: "PHB", level: 2});
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", dex);

	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._battleTacticToggles = {};
	combat._flankingEnabled = false;
	combat._state = state;

	const rollModes = [];
	const refreshCounts = {save: 0, renderStates: 0, quickButtons: 0, activeStates: 0};
	combat._page = {
		rollD20: (opts = {}) => { rollModes.push(opts.mode); return {roll: 10, mode: opts.mode || "normal"}; },
		getModeLabel: () => "",
		formatD20Breakdown: () => "",
		pAnimateD20: () => {},
		showDiceResult: () => null,
		getModifierString: (n) => `${n >= 0 ? "+" : ""}${n}`,
		_offerGuidedStrikePostAttack: () => {},
		_renderActiveStates: () => { refreshCounts.activeStates += 1; },
		_saveCurrentCharacter: () => { refreshCounts.save += 1; },
		saveCharacter: () => {},
	};
	// Stub the post-roll side effects that touch DOM / unrelated subsystems.
	combat._renderSneakAttackToggle = () => {};
	combat._isSneakAttackAvailableThisTurn = () => false;
	combat._runPostAttackHooks = async () => {};
	combat._consumeOnAttackStates = () => {};
	combat._clearPendingSpellRider = () => {};
	// Reckless-refresh stubs (mirror the dodge/rage quick-toggle path).
	combat.renderCombatStates = () => { refreshCounts.renderStates += 1; };
	combat.renderCombatEffects = () => {};
	combat.renderCombatDefenses = () => {};
	combat._updateQuickButtonStates = () => { refreshCounts.quickButtons += 1; };

	return {state, combat, rollModes, refreshCounts};
}

const MELEE_STR = {id: "sword", name: "Longsword", isMelee: true, type: "melee", abilityMod: "str", range: "melee", damage: "1d8", damageType: "slashing"};
const RANGED_DEX = {id: "bow", name: "Longbow", isRanged: true, abilityMod: "dex", range: "150/600", damage: "1d8", damageType: "piercing"};
const FINESSE = {id: "dagger", name: "Dagger", isMelee: true, type: "melee", abilityMod: "finesse", range: "melee", damage: "1d4", damageType: "piercing"};

describe("#7 _rollRecklessAttack — activates state then rolls with scoped advantage", () => {
	it("activates recklessAttack when off, persists once, and rolls a melee-STR attack with advantage", () => {
		const {state, combat, rollModes, refreshCounts} = mkRecklessCombat();
		state.addAttack(MELEE_STR);

		expect(state.isStateTypeActive("recklessAttack")).toBe(false);

		const ok = combat._rollRecklessAttack("sword", null);

		expect(ok).toBe(true);
		// State was flipped on and left on.
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		// The melee-STR roll asked the d20 for advantage.
		expect(rollModes).toEqual(["advantage"]);
		// Persist + refresh happened exactly once (the activation path).
		expect(refreshCounts.save).toBe(1);
		expect(refreshCounts.renderStates).toBe(1);
		expect(refreshCounts.quickButtons).toBe(1);
		expect(refreshCounts.activeStates).toBe(1);
	});

	it("is idempotent when already reckless — rolls again with advantage but does NOT re-persist/re-render", () => {
		const {state, combat, rollModes, refreshCounts} = mkRecklessCombat();
		state.addAttack(MELEE_STR);
		state.activateState("recklessAttack");

		const ok = combat._rollRecklessAttack("sword", null);

		expect(ok).toBe(true);
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		expect(rollModes).toEqual(["advantage"]);
		// Already active → the activation/save/refresh block is skipped entirely.
		expect(refreshCounts.save).toBe(0);
		expect(refreshCounts.renderStates).toBe(0);
		expect(refreshCounts.quickButtons).toBe(0);
	});

	it("does NOT leak advantage onto a RANGED attack even while reckless is active", () => {
		const {state, combat, rollModes} = mkRecklessCombat();
		state.addAttack(RANGED_DEX);

		const ok = combat._rollRecklessAttack("bow", null);

		expect(ok).toBe(true);
		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		// Reckless only helps melee-STR: the ranged roll must be a NORMAL roll.
		expect(rollModes).toEqual([undefined]);
	});

	it("applies melee-STR advantage to a FINESSE weapon when Strength is the better mod", () => {
		// STR 18 (+4) ≥ DEX 12 (+1) → the finesse weapon uses Strength, so reckless applies.
		const {state, combat, rollModes} = mkRecklessCombat({str: 18, dex: 12});
		state.addAttack(FINESSE);

		combat._rollRecklessAttack("dagger", null);

		expect(rollModes).toEqual(["advantage"]);
	});

	it("does NOT apply advantage to a FINESSE weapon wielded with Dexterity (DEX is the better mod)", () => {
		// DEX 18 (+4) > STR 12 (+1) → the finesse weapon uses Dexterity, so reckless (melee-STR) does NOT apply.
		const {state, combat, rollModes} = mkRecklessCombat({str: 12, dex: 18});
		state.addAttack(FINESSE);

		combat._rollRecklessAttack("dagger", null);

		expect(rollModes).toEqual([undefined]); // normal roll (reckless doesn't apply)
	});

	it("real-state: reckless advantage still CANCELS with a disadvantage source (Prone) on the melee-STR roll", () => {
		// Prone contributes a generic `attack` disadvantage; Reckless contributes
		// `attack:melee:str` advantage. Through the normal pipeline they must cancel
		// to a NORMAL roll — we never force raw advantage.
		const {state, combat, rollModes} = mkRecklessCombat();
		state.addAttack(MELEE_STR);
		state.activateState("prone");

		combat._rollRecklessAttack("sword", null);

		expect(state.isStateTypeActive("recklessAttack")).toBe(true);
		expect(rollModes).toEqual([undefined]); // adv + disadv → normal
	});

	it("bails without touching state for an unknown attackId (never flips reckless on with no roll)", () => {
		const {state, combat, rollModes, refreshCounts} = mkRecklessCombat();
		state.addAttack(MELEE_STR);

		const ok = combat._rollRecklessAttack("does-not-exist", null);

		expect(ok).toBe(false);
		expect(state.isStateTypeActive("recklessAttack")).toBe(false);
		expect(rollModes.length).toBe(0);
		expect(refreshCounts.save).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Advantage/disadvantage still CANCELS through the normal pipeline (rules-correct
// semantics: we never force raw advantage). Uses a mock state so we can assert
// the exact adv+disadv → normal resolution independent of any specific source.
// ---------------------------------------------------------------------------
describe("#7 _rollAttack — reckless advantage still cancels with disadvantage", () => {
	function mkModeCombat ({advantage, disadvantage}) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		const rollModes = [];
		combat._state = {
			getAttacks: () => [MELEE_STR],
			getTemporaryAttacks: () => [],
			getActiveStateAttacks: () => [],
			getWeaponAbilityMod: () => 4,
			getProficiencyBonus: () => 2,
			getAbilityMod: () => 4,
			getAttackModifierContributions: () => [],
			getBonusFromStates: () => 0,
			getCriticalRange: () => 20,
			getFeatureCalculations: () => ({}),
			hasAdvantageFromStates: () => advantage,
			hasDisadvantageFromStates: () => disadvantage,
		};
		combat._page = {
			rollD20: (opts = {}) => { rollModes.push(opts.mode); return {roll: 10, mode: opts.mode || "normal"}; },
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: () => null,
			_offerGuidedStrikePostAttack: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};
		combat._getSelectedAmmoForWeapon = () => null;
		combat._getCombatLocalAttackBonus = () => ({bonus: 0, parts: []});
		return {combat, rollModes};
	}

	it("advantage alone → the d20 rolls with advantage", () => {
		const {combat, rollModes} = mkModeCombat({advantage: true, disadvantage: false});
		expect(combat._rollAttack("sword", null)).toBe(true);
		expect(rollModes).toEqual(["advantage"]);
	});

	it("advantage AND disadvantage → they cancel to a normal roll (no forced advantage)", () => {
		const {combat, rollModes} = mkModeCombat({advantage: true, disadvantage: true});
		expect(combat._rollAttack("sword", null)).toBe(true);
		expect(rollModes).toEqual([undefined]); // normal — neither adv nor disadv
	});
});

// ---------------------------------------------------------------------------
// Render gating — the reckless button only appears on a Barbarian's WEAPON
// attack rows (not spell-attack rows, not for non-barbarians).
// ---------------------------------------------------------------------------
describe("#7 _renderAttackItem — reckless button gating", () => {
	function mkRenderCombat ({barbarianLevel = 2, recklessActive = false} = {}) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {
			getWeaponAbilityMod: () => 4,
			getProficiencyBonus: () => 2,
			getAttackModifierContributions: () => [],
			getCriticalRange: () => 20,
			getActiveCombatMethodEffects: () => [],
			getClassLevel: (cls) => (cls === "Barbarian" ? barbarianLevel : 0),
			isStateTypeActive: () => recklessActive,
			getAttackNote: () => null,
		};
		// Stub the heavy sub-renderers so we exercise only the gating + template.
		combat._getAttackRollKind = () => ({isMelee: true});
		combat._formatProperty = () => "";
		combat._formatMasteryLink = () => "";
		combat._buildAttackRangeDisplay = () => ({rangeHtml: ""});
		combat._renderAmmoSelector = () => "";
		combat._renderChannelSpellButton = () => "";
		return combat;
	}

	const WEAPON = {id: "w1", name: "Greataxe", damage: "1d12", damageType: "slashing", mastery: []};
	const SPELL_ATTACK = {id: "s1", name: "Fire Bolt", isSpell: true, damage: "1d10", damageType: "fire"};

	const renderHtml = (combat, attack) => combat._renderAttackItem(attack).outerHTML;

	it("renders the reckless button on a Barbarian L2 weapon attack row", () => {
		const html = renderHtml(mkRenderCombat({barbarianLevel: 2}), WEAPON);
		expect(html).toContain("charsheet__attack-reckless");
		expect(html).toContain("Reckless");
	});

	it("does NOT render the reckless button for a non-barbarian", () => {
		const html = renderHtml(mkRenderCombat({barbarianLevel: 0}), WEAPON);
		expect(html).not.toContain("charsheet__attack-reckless");
	});

	it("does NOT render the reckless button on a spell-attack row", () => {
		const html = renderHtml(mkRenderCombat({barbarianLevel: 2}), SPELL_ATTACK);
		expect(html).not.toContain("charsheet__attack-reckless");
	});

	it("reflects the active state with the ve-btn-warning class when reckless is on", () => {
		const html = renderHtml(mkRenderCombat({barbarianLevel: 2, recklessActive: true}), WEAPON);
		expect(html).toContain("charsheet__attack-reckless");
		expect(html).toMatch(/ve-btn-warning[^"]*charsheet__attack-reckless/);
	});
});
