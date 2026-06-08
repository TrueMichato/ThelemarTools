/**
 * Flanking invariant (#1 + #10): the two "Flanking" meanings stay SEPARATE.
 *
 * 1. The optional Flanking RULE — a transient combat-tab quick-button toggle
 *    (`_flankingEnabled`) that feeds `_getCombatLocalAttackBonus()` → `_rollAttack`.
 *    This is the ONLY path that grants the situational +2 melee to-hit.
 * 2. The TGTT Fighter Battle Tactic NAMED "Flanking" — a reminder/reaction feature.
 *    It must NEVER grant or advertise an automatic +2.
 *
 * These tests prove a Fighter who has learned the Battle Tactic "Flanking" gets the
 * +2 ONLY when the quick button is active, and never from the tactic itself.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

let CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

function makeFighterWithFlankingTactic () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"});
	state.addFeature({
		name: "Flanking",
		source: "TGTT",
		featureType: "Optional Feature",
		optionalFeatureTypes: ["BT"],
	});
	return state;
}

// A combat module is just a behavioural shell here — `_getCombatLocalAttackBonus`
// depends only on `_flankingEnabled` + `_isStrictMelee`, not on state.
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._flankingEnabled = false;
	combat._state = state;
	return combat;
}

describe("Flanking invariant — the Battle Tactic never grants the +2", () => {
	let state;
	beforeEach(() => { state = makeFighterWithFlankingTactic(); });

	it("the Battle Tactic 'Flanking' exposes NO conditional attack modifier", () => {
		expect(state.getConditionalAttackModifiers("melee").some(m => m.source === "Flanking")).toBe(false);
		expect(state.getConditionalAttackModifiers(null).some(m => m.source === "Flanking")).toBe(false);
	});

	it("the Battle Tactic 'Flanking' does NOT advertise a flankingBonus in feature calculations", () => {
		const calcs = state.getFeatureCalculations();
		expect(calcs.flankingBonus).toBeUndefined();
		expect(calcs.hasFlanking).toBeUndefined();
	});

	it("the Battle Tactic 'Flanking' STILL provides its Flanking Opportunity reaction", () => {
		const reactions = state.getAvailableCombatReactions();
		const flanking = reactions.find(r => r.source === "Flanking");
		expect(flanking).toBeDefined();
		expect(flanking.name).toBe("Flanking Opportunity");
	});

	it("the +2 melee to-hit comes ONLY from the quick-button toggle, never the tactic", () => {
		const combat = makeCombat(state);
		const melee = {name: "Longsword", isMelee: true};

		// Tactic learned, but the quick button is OFF → no +2 from anywhere.
		expect(combat._flankingEnabled).toBe(false);
		expect(combat._getCombatLocalAttackBonus({attack: melee}).bonus).toBe(0);

		// Turning the quick button ON is the sole way to gain the +2.
		combat._flankingEnabled = true;
		const res = combat._getCombatLocalAttackBonus({attack: melee});
		expect(res.bonus).toBe(2);
		expect(res.parts).toEqual([{label: "Flanking", value: 2}]);
	});

	it("the quick-button +2 is melee-only even with the tactic learned", () => {
		const combat = makeCombat(state);
		combat._flankingEnabled = true;
		expect(combat._getCombatLocalAttackBonus({attack: {name: "Longbow", isRanged: true}}).bonus).toBe(0);
	});
});
