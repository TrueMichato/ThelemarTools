/**
 * Character Sheet — Battle-Tactic / Arcane-Shot passive-parser skip (Round 30 #7, #8, #9)
 *
 * Battle Tactics (optionalFeatureTypes "BT") and Arcane Shots ("AS") must NOT be
 * text-parsed by _processFeatureModifiers into always-on named modifiers:
 *  - #7 High Ground / Sweeping Blows / Hammer and Anvil prose ("you gain a +2 bonus
 *    to hit ...") would otherwise register an always-on, un-scoped attack modifier
 *    that applies regardless of the combat-tab toggle AND bleeds onto melee attacks.
 *  - #8 Flanking's note ("+2 to hit when flanking in melee") would likewise add a
 *    static +2 the Battle Tactic must NOT auto-grant.
 *  - #9 Grasping Arrow ("its speed is reduced by 10 feet") targets the ENEMY, not the
 *    archer — parsing it would permanently slow the character.
 *
 * The toggle-gated path (getConditionalAttackModifiers) and the real Arcane Shot
 * resource must remain intact.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Real homebrew prose (the strings that previously tripped the passive parser).
const HIGH_GROUND_DESC = "When standing 5 feet or more above an enemy, you gain a +2 bonus to hit with ranged attacks against said enemy.";
const SWEEPING_BLOWS_DESC = "When attacking in melee an enemy that is 5 feet or more higher than you, you gain a +2 bonus to hit.";
const HAMMER_ANVIL_DESC = "When attacking an enemy that cannot retreat, you gain a +2 bonus to hit against them.";
const FLANKING_DESC = "When attacking a flanked enemy, you can use an opportunity attack against the flanked enemy at the start of their turn. This ability allows the user to benefit from a +2 to hit when flanking in melee.";
const GRASPING_ARROW_DESC = "When this arrow strikes its target, grasping brambles wrap around the target. The creature hit takes an extra 2d6 poison damage, its speed is reduced by 10 feet, and it takes 2d6 slashing damage the first time on each turn it moves.";

function buildTgttFighter (level = 9) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({name: "Fighter", source: "TGTT", level});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 16);
	state.setAbilityBase("con", 14);
	return state;
}

function addTactic (state, name, description) {
	state.addFeature({name, source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["BT"], description});
}

describe("Battle Tactic prose is NOT parsed into always-on attack modifiers (#7, #8)", () => {
	function buildWithTactics () {
		const state = buildTgttFighter(9);
		addTactic(state, "High Ground", HIGH_GROUND_DESC);
		addTactic(state, "Sweeping Blows", SWEEPING_BLOWS_DESC);
		addTactic(state, "Hammer and Anvil", HAMMER_ANVIL_DESC);
		addTactic(state, "Flanking", FLANKING_DESC);
		return state;
	}

	const tacticNames = ["High Ground", "Sweeping Blows", "Hammer and Anvil", "Flanking"];

	it("adds NO always-on melee attack contribution from any battle tactic", () => {
		const contributions = buildWithTactics().getAttackModifierContributions({isMelee: true});
		for (const name of tacticNames) {
			expect(contributions.some(c => c.name === name)).toBe(false);
		}
	});

	it("adds NO always-on ranged attack contribution from any battle tactic", () => {
		const contributions = buildWithTactics().getAttackModifierContributions({isMelee: false});
		for (const name of tacticNames) {
			expect(contributions.some(c => c.name === name)).toBe(false);
		}
	});

	it("does not register a generic +2 'attack' named modifier from tactic prose", () => {
		const mods = buildWithTactics().getModifiersForType("attack:ranged");
		for (const name of tacticNames) {
			expect(mods.some(m => (m.name === name || m.note === name) && !m.conditional)).toBe(false);
		}
	});

	it("STILL exposes High Ground via the toggle-gated conditional path (intact)", () => {
		const mods = buildWithTactics().getConditionalAttackModifiers("ranged");
		expect(mods.some(m => m.source === "High Ground" && m.value === 2)).toBe(true);
	});
});

describe("Arcane Shot prose does NOT slow the character (#9)", () => {
	it("Grasping Arrow leaves the archer's walking speed unchanged", () => {
		const baseline = buildTgttFighter(9).getWalkSpeed();
		const state = buildTgttFighter(9);
		state.addFeature({name: "Grasping Arrow", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["AS"], description: GRASPING_ARROW_DESC});
		expect(state.getWalkSpeed()).toBe(baseline);
	});

	it("featureType array form (['AS']) is also skipped", () => {
		const baseline = buildTgttFighter(9).getWalkSpeed();
		const state = buildTgttFighter(9);
		state.addFeature({name: "Grasping Arrow", source: "TGTT", featureType: ["AS"], description: GRASPING_ARROW_DESC});
		expect(state.getWalkSpeed()).toBe(baseline);
	});
});
