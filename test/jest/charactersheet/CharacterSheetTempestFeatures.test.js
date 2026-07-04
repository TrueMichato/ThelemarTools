/**
 * Character Sheet — Tempest Domain (Cleric) feature-surfacing tests.
 *
 * These assert the REAL, player-facing surfaces the app uses, NOT internal calc flags.
 *
 * In the running app a Tempest cleric's domain features are STORED features (added by the
 * Builder / level-up from data/class/class-cleric.json, carrying their full rules text).
 * The generic stored-feature pipeline then surfaces them:
 *   • Wrath of the Storm            → a WIS-mod / long-rest use pool (resource) AND a
 *                                     Reaction entry in getActivatableFeatures().
 *   • Channel Divinity: Destructive → a spendable Channel-Divinity option in
 *     Wrath                           getActivatableFeatures() (channelDivinityCost) against
 *                                     the shared Channel Divinity resource.
 *   • Thunderbolt Strike            → a passive on-hit rider, visible verbatim in the
 *                                     Features panel (getFeatures), correctly NOT activatable.
 *
 * The three `has*` calculation flags are an alternate representation that nothing consumes;
 * these tests also lock in that the effect-aggregator no longer emits inert placeholder
 * effect objects (reaction / channelDivinityOption / pushRider) for them.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Verbatim (plain-text) rules from class-cleric.json, as the Builder renders `entries` into
// `description` before calling addFeature.
const TEMPEST_FEATURE_DESCRIPTIONS = {
	"Wrath of the Storm":
		"When a creature within 5 feet of you that you can see hits you with an attack, you can use your reaction to cause the creature to make a Dexterity saving throw. The creature takes 2d8 lightning or thunder damage (your choice) on a failed saving throw, and half as much damage on a successful one. You can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.",
	"Channel Divinity: Destructive Wrath":
		"You can use your Channel Divinity to wield the power of the storm with unchecked ferocity. When you roll lightning or thunder damage, you can use your Channel Divinity to deal maximum damage, instead of rolling.",
	"Thunderbolt Strike":
		"When you deal lightning damage to a Large or smaller creature, you can also push it up to 10 feet away from you.",
};

const CHANNEL_DIVINITY_DESCRIPTION =
	"You gain the ability to channel divine energy directly from your deity. You can use your Channel Divinity twice between rests. You regain expended uses when you finish a short or long rest.";

/** Build a Tempest cleric and store its domain features the way the Builder / level-up does. */
function mkStoredTempest (level, {wis = 16} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", wis);
	state.addClass({
		name: "Cleric",
		source: "PHB",
		level,
		subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"},
	});

	const store = (name, featLevel) => state.addFeature({
		name,
		source: "PHB",
		level: featLevel,
		className: "Cleric",
		classSource: "PHB",
		subclassShortName: "Tempest",
		isSubclassFeature: true,
		description: TEMPEST_FEATURE_DESCRIPTIONS[name],
	});

	// Wrath of the Storm is L1; Destructive Wrath is a L2 Channel Divinity option; Thunderbolt
	// Strike is L6. Store the base Channel Divinity class feature so its shared resource exists.
	store("Wrath of the Storm", 1);
	if (level >= 2) {
		state.addFeature({
			name: "Channel Divinity",
			source: "PHB",
			level: 2,
			className: "Cleric",
			classSource: "PHB",
			description: CHANNEL_DIVINITY_DESCRIPTION,
		});
		store("Channel Divinity: Destructive Wrath", 2);
	}
	if (level >= 6) store("Thunderbolt Strike", 6);
	return state;
}

const findResource = (state, name) =>
	(state.getResources() || []).find(r => (r.name || "").toLowerCase() === name.toLowerCase());
const findActivatable = (state, name) =>
	(state.getActivatableFeatures?.() || []).find(a => (a.feature?.name || a.name) === name);
const activationActionOf = (af) => af?.activationInfo?.activationAction || af?.activationAction;
const cdCostOf = (af) => af?.activationInfo?.channelDivinityCost ?? af?.channelDivinityCost;

describe("Tempest Domain — real feature surfaces", () => {
	describe("Wrath of the Storm (L1)", () => {
		it("mints a trackable use pool sized to the Wisdom modifier, recharging on a long rest", () => {
			const state = mkStoredTempest(1, {wis: 16}); // WIS 16 => +3
			const feature = state.getFeatures().find(f => f.name === "Wrath of the Storm");
			expect(feature).toBeTruthy();
			expect(feature.uses).toMatchObject({max: 3, recharge: "long"});

			const resource = findResource(state, "Wrath of the Storm");
			expect(resource).toBeTruthy();
			expect(resource.max).toBe(3);
			expect(resource.recharge).toBe("long");
		});

		it("uses a minimum of one use even with a non-positive Wisdom modifier", () => {
			const state = mkStoredTempest(1, {wis: 8}); // WIS 8 => -1 => min 1
			const resource = findResource(state, "Wrath of the Storm");
			expect(resource).toBeTruthy();
			expect(resource.max).toBeGreaterThanOrEqual(1);
		});

		it("surfaces as a usable Reaction in getActivatableFeatures", () => {
			const state = mkStoredTempest(1);
			const af = findActivatable(state, "Wrath of the Storm");
			expect(af).toBeTruthy();
			expect(activationActionOf(af)).toBe("reaction");
		});
	});

	describe("Channel Divinity: Destructive Wrath (L2)", () => {
		it("is absent before level 2", () => {
			const state = mkStoredTempest(1);
			expect(findActivatable(state, "Channel Divinity: Destructive Wrath")).toBeFalsy();
		});

		it("shares the Channel Divinity resource (no parallel pool of its own)", () => {
			const state = mkStoredTempest(2);
			expect(findResource(state, "Channel Divinity")).toBeTruthy();
			expect(findResource(state, "Destructive Wrath")).toBeFalsy();
			expect(findResource(state, "Channel Divinity: Destructive Wrath")).toBeFalsy();
		});

		it("surfaces as a spendable Channel-Divinity option (channelDivinityCost >= 1)", () => {
			const state = mkStoredTempest(2);
			const af = findActivatable(state, "Channel Divinity: Destructive Wrath");
			expect(af).toBeTruthy();
			expect(cdCostOf(af)).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Thunderbolt Strike (L6)", () => {
		it("is absent before level 6", () => {
			const state = mkStoredTempest(2);
			expect(state.getFeatures().some(f => f.name === "Thunderbolt Strike")).toBe(false);
		});

		it("is a passive on-hit rider: visible in the Features panel, correctly NOT activatable", () => {
			const state = mkStoredTempest(6);
			const feature = state.getFeatures().find(f => f.name === "Thunderbolt Strike");
			expect(feature).toBeTruthy();
			expect(feature.description).toMatch(/push it up to 10 feet/i);
			// It has no activation cost / action, so it must not appear as an activatable ability.
			expect(findActivatable(state, "Thunderbolt Strike")).toBeFalsy();
		});
	});

	describe("no inert placeholder effects are emitted", () => {
		it("the effect aggregator never produces reaction / channelDivinityOption / pushRider objects", () => {
			const state = mkStoredTempest(17);
			const effects = state._aggregateFeatureEffects(state.getFeatureCalculations());
			const inertTypes = new Set(["reaction", "channelDivinityOption", "pushRider"]);
			expect(effects.some(e => inertTypes.has(e.type))).toBe(false);
		});
	});
});

describe("Tempest Domain — still-functional calc-derived effects", () => {
	it("emits the Tempest bonus proficiencies (martial weapons + heavy armor)", () => {
		const state = mkStoredTempest(1);
		const effects = state._aggregateFeatureEffects(state.getFeatureCalculations());
		expect(effects.some(e => e.type === "weaponProficiency" && /martial/i.test(e.weapon))).toBe(true);
		expect(effects.some(e => e.type === "armorProficiency" && /heavy/i.test(e.armor))).toBe(true);
	});

	it("emits Stormborn as an equal-to-walk fly speed at L17", () => {
		const state = mkStoredTempest(17);
		const effects = state._aggregateFeatureEffects(state.getFeatureCalculations());
		const storm = effects.find(e => e.type === "speed" && e.speedType === "fly");
		expect(storm).toBeTruthy();
		expect(storm.equalToWalk).toBe(true);
	});

	it("does not throw when applying class-feature effects for a full Tempest build", () => {
		const state = mkStoredTempest(17);
		expect(() => state.applyClassFeatureEffects?.()).not.toThrow();
	});
});
