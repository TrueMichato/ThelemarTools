/**
 * Active-States Classification Hygiene (round-5 #10, generic portion — session S1).
 *
 * Asserts REAL classification mechanics, not level counts / existence-only:
 *  - Combat methods (CTM optional features + combatMethod entities) are NEVER surfaced
 *    in the GENERIC active-states list (getActivatableFeatures), but remain reachable
 *    via their dedicated combat-methods surface (getCombatMethods).
 *  - Arcane Shot OPTIONS and the descriptive "Arcane Shot" feature are NEVER surfaced in
 *    the generic list, but options remain reachable via getKnownArcaneShots.
 *  - GENERIC framework: single-use / limited-use INNATE abilities (finite use pool,
 *    instantaneous effect) classify as `interactionMode:"limited"` resources, NOT toggle
 *    states — even when their text has toggle-ish language but no sustained-state signal.
 *  - Regression guards: genuine sustained toggles (Rage, Bladesong, and a uses-bearing
 *    "for 1 minute / while active" homebrew toggle) stay toggles.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// CTM combat methods exactly as Lunaria (Ranger/Druid) carries them — picked optional
// features with CTM:1..5 codes. These were the four leaking into the generic list.
function makeCtmMethod (name) {
	return {
		name,
		source: "TGTT",
		featureType: "Optional Feature",
		optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
		description: `<p>As a bonus action while you have stamina, you adopt the ${name}. While in this stance you gain a benefit. (1 Stamina Point)</p>`,
		entries: [`${name} effect`],
	};
}

// A combatMethod ENTITY (the newer representation): tradition/degree/staminaCost.
const COMBAT_METHOD_ENTITY = {
	name: "Legion Stance",
	source: "TGTT",
	tradition: "Arcane Knight",
	degree: 2,
	staminaCost: 1,
	actionType: "bonus action",
	_entityType: "combatMethod",
	description: "<p>As a bonus action you enter the Legion Stance. While in this stance, allies gain a benefit.</p>",
	entries: ["Legion Stance effect"],
};

function activatableNames (state) {
	return state.getActivatableFeatures().map(a => a.feature?.name);
}

describe("Active-states classification — combat methods excluded from generic list", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("the four Lunaria CTM combat methods never appear in getActivatableFeatures", () => {
		const methods = ["Perceptive Stance", "Practiced Roll", "Deflect Strike", "Wounding Strike"];
		methods.forEach(m => state.addFeature(makeCtmMethod(m)));

		const names = activatableNames(state);
		methods.forEach(m => expect(names).not.toContain(m));
	});

	test("a CTM stance is excluded from the generic list but present in getCombatMethods", () => {
		state.addFeature(makeCtmMethod("Perceptive Stance"));

		// Sanity: it really is a combat method.
		const feature = state.getFeatures().find(f => f.name === "Perceptive Stance");
		expect(CharacterSheetClassUtils.isCombatMethod(feature)).toBe(true);

		// Excluded from the generic active-states feeder...
		expect(activatableNames(state)).not.toContain("Perceptive Stance");
		// ...but still reachable via its dedicated combat-methods surface.
		expect(state.getCombatMethods().map(m => m.name)).toContain("Perceptive Stance");
	});

	test("a combatMethod ENTITY (tradition/degree/staminaCost) is also excluded", () => {
		state.addFeature(COMBAT_METHOD_ENTITY);

		const feature = state.getFeatures().find(f => f.name === "Legion Stance");
		expect(CharacterSheetClassUtils.isCombatMethod(feature)).toBe(true);
		expect(activatableNames(state)).not.toContain("Legion Stance");
		expect(state.getCombatMethods().map(m => m.name)).toContain("Legion Stance");
	});

	test("non-combat-method activatables are unaffected by the exclusion", () => {
		state.addFeature(makeCtmMethod("Perceptive Stance"));
		state.addFeature({
			name: "Mystic Veil",
			source: "TGTT",
			description: "<p>As a bonus action you cloak yourself for 1 minute. While this effect is active, you gain advantage on Stealth checks.</p>",
		});

		const names = activatableNames(state);
		expect(names).not.toContain("Perceptive Stance");
		expect(names).toContain("Mystic Veil");
	});
});

describe("Active-states classification — Arcane Shots excluded from generic list", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	function addArcaneShotOption (name) {
		state.addFeature({
			name,
			source: "XGE",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["AS"],
			description: `<p>As part of the attack, you can use 1 ${name} effect. The target must make a saving throw.</p>`,
			entries: [`${name} effect`],
		});
	}

	test("isArcaneShotActivatable truth table", () => {
		expect(CharacterSheetState.isArcaneShotActivatable({name: "Grasping Arrow", optionalFeatureTypes: ["AS"]})).toBe(true);
		expect(CharacterSheetState.isArcaneShotActivatable({name: "Arcane Shot"})).toBe(true);
		expect(CharacterSheetState.isArcaneShotActivatable({name: "arcane shot "})).toBe(true);
		expect(CharacterSheetState.isArcaneShotActivatable({name: "Grasping Arrow"})).toBe(false);
		expect(CharacterSheetState.isArcaneShotActivatable({name: "Maneuver", optionalFeatureTypes: ["MV:B"]})).toBe(false);
		expect(CharacterSheetState.isArcaneShotActivatable(null)).toBe(false);
	});

	test("Arcane Shot options are excluded from the generic list but present in getKnownArcaneShots", () => {
		addArcaneShotOption("Grasping Arrow");
		addArcaneShotOption("Banishing Arrow");

		const names = activatableNames(state);
		expect(names).not.toContain("Grasping Arrow");
		expect(names).not.toContain("Banishing Arrow");

		const known = state.getKnownArcaneShots().map(s => s.name);
		expect(known).toContain("Grasping Arrow");
		expect(known).toContain("Banishing Arrow");
	});

	test("the generic descriptive 'Arcane Shot' feature is excluded from the generic list", () => {
		state.addFeature({
			name: "Arcane Shot",
			source: "XGE",
			description: "<p>You learn to unleash special magical effects with your arrows. As a bonus action you can use one Arcane Shot option you know.</p>",
		});
		expect(activatableNames(state)).not.toContain("Arcane Shot");
	});
});

describe("Active-states classification — limited-use innate abilities are resources, not toggles", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	const HEALING_HANDS_TEXT = "As an action, you can touch a creature and roll a number of d4s equal to your proficiency bonus. The creature regains a number of hit points equal to the total rolled. Once you use this trait, you can't use it again until you finish a long rest.";

	test("Healing Hands (1/long-rest, with uses) classifies as a limited-use resource, not a toggle", () => {
		const feature = {name: "Healing Hands", description: `<p>${HEALING_HANDS_TEXT}</p>`, uses: {current: 1, max: 1, recharge: "long"}};
		const info = CharacterSheetState.detectActivatableFeature(feature);

		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBe("Healing Hands");
		expect(info.resourceCost).toBe(1);
	});

	test("isLimitedUseResourceAbility predicate truth table", () => {
		const healingHands = {name: "Healing Hands", description: `<p>${HEALING_HANDS_TEXT}</p>`, uses: {max: 1}};
		expect(CharacterSheetState.isLimitedUseResourceAbility(healingHands)).toBe(true);

		// No use pool → not a tracked resource ability.
		expect(CharacterSheetState.isLimitedUseResourceAbility({name: "Passive Trait", description: "<p>You always gain a benefit.</p>"})).toBe(false);

		// Sustained toggle with uses → NOT a limited-use resource ability.
		const rage = {name: "Rage", description: "<p>You can enter a rage as a bonus action for 1 minute.</p>", uses: {max: 3}};
		expect(CharacterSheetState.isLimitedUseResourceAbility(rage)).toBe(false);

		// Accepts a pre-computed activationInfo (no second detection pass).
		expect(CharacterSheetState.isLimitedUseResourceAbility(healingHands, {isToggle: false})).toBe(true);
		expect(CharacterSheetState.isLimitedUseResourceAbility(healingHands, {isToggle: true})).toBe(false);
	});

	test("HARDENING: a uses-bearing ability with toggle-ish text but NO sustained signal stays limited", () => {
		// "activate this feature" trips the generic toggle analysis (confidence >= 5), but the
		// finite use pool + absence of any sustained-state signal must route it to a resource.
		const feature = {
			name: "Spirit Surge",
			description: "<p>As a bonus action you can activate this feature. You gain 5 temporary hit points.</p>",
			uses: {current: 1, max: 1, recharge: "long"},
		};
		const info = CharacterSheetState.detectActivatableFeature(feature);
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("limited");
	});

	test("REGRESSION: a uses-bearing sustained toggle ('for 1 minute / while active') stays a toggle", () => {
		const feature = {
			name: "Mystic Ward",
			description: "<p>As a bonus action you activate this feature for 1 minute. While this effect is active, you gain +1 to AC.</p>",
			uses: {current: 2, max: 2, recharge: "long"},
		};
		const info = CharacterSheetState.detectActivatableFeature(feature);
		expect(info.isToggle).toBe(true);
		expect(info.interactionMode).not.toBe("limited");
	});
});

describe("Active-states classification — genuine toggles still surface (regression)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("Rage is still classified as a toggle and surfaces for a Barbarian", () => {
		const info = CharacterSheetState.detectActivatableFeature({name: "Rage", description: "<p>On your turn, you can enter a rage as a bonus action.</p>"});
		expect(info.isToggle).toBe(true);

		state.addClass({name: "Barbarian", source: "PHB", level: 3});
		state.addFeature({name: "Rage", description: "<p>On your turn, you can enter a rage as a bonus action.</p>"});
		expect(activatableNames(state)).toContain("Rage");
	});

	test("Bladesong is still classified as a toggle", () => {
		const info = CharacterSheetState.detectActivatableFeature({name: "Bladesong", description: "<p>You can invoke an elven magic called the Bladesong as a bonus action. It lasts for 1 minute.</p>"});
		expect(info.isToggle).toBe(true);
		expect(info.stateTypeId).toBe("bladesong");
	});
});
