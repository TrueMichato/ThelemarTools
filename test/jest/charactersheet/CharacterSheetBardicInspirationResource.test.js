/**
 * Bardic Inspiration resource tests (Bug 3, Session C)
 *
 * Bardic Inspiration must be surfaced as a use-tracked RESOURCE:
 *   - pool size = max(1, Charisma modifier)
 *   - regained on a LONG rest
 *   - additionally regained on a SHORT rest once Bard level >= 5 (Font of Inspiration)
 *   - updates when Charisma or Bard level changes
 *   - appears in getResources() AND getGenericPoolResources() (the Resources panel feed),
 *     exactly like Channel Divinity, without double-surfacing as a persistent toggle.
 *
 * Root cause fixed: Bardic Inspiration was missing from the activationPatterns roster in
 * detectActivatableFeature(), so it fell through to the generic `featureUses` fallback
 * (isInstant:true). isActivatableAbilityEntry() treats that as an activatable ability, so
 * getGenericPoolResources() excluded it. Registering it alongside the other class
 * resource pools (Channel Divinity, Lay on Hands, Hex Curse) classifies it as
 * matchedBy:"description" / isInstant:false, so it surfaces as a tracked resource.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// Faithful PHB Bardic Inspiration uses text — the phrases FeatureUsesParser keys on.
const BI_DESC_PHB =
	"You can inspire others through stirring words or music. To do so, you use a bonus "
	+ "action on your turn to choose one creature other than yourself within 60 feet of you "
	+ "who can hear you. That creature gains one Bardic Inspiration die, a d6. You can use this "
	+ "feature a number of times equal to your Charisma modifier (a minimum of once). You "
	+ "regain any expended uses when you finish a long rest.";

// XPHB phrasing (same feature name, 2024 wording).
const BI_DESC_XPHB =
	"You can supernaturally inspire others through words, music, or dance. This inspiration "
	+ "is represented by your Bardic Inspiration die, which is a d6. You can use this die a "
	+ "number of times equal to your Charisma modifier (minimum of once). You regain all "
	+ "expended uses when you finish a Long Rest.";

function makeBard ({level = 1, cha = 16, source = "PHB", desc = BI_DESC_PHB} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Bard", source, level});
	state.setAbilityBase("cha", cha);
	state.addFeature({
		name: "Bardic Inspiration",
		source,
		className: "Bard",
		classSource: source,
		level: 1,
		featureType: "Class",
		description: desc,
	});
	return state;
}

describe("Bardic Inspiration resource (Bug 3)", () => {
	describe("pool size = max(1, Charisma modifier)", () => {
		it.each([
			[8, 1], // -1 mod → floor at 1
			[10, 1], // +0 mod → floor at 1
			[11, 1], // +0 mod → floor at 1
			[14, 2], // +2
			[16, 3], // +3
			[20, 5], // +5
		])("Cha %i → max %i", (cha, expectedMax) => {
			const state = makeBard({cha});
			expect(state.getResource("Bardic Inspiration").max).toBe(expectedMax);
		});

		it("starts full (current === max)", () => {
			const state = makeBard({cha: 16});
			const res = state.getResource("Bardic Inspiration");
			expect(res.current).toBe(res.max);
			expect(res.current).toBe(3);
		});

		it("derives the same pool from XPHB (2024) wording", () => {
			const state = makeBard({cha: 18, source: "XPHB", desc: BI_DESC_XPHB});
			expect(state.getResource("Bardic Inspiration").max).toBe(4); // +4
		});
	});

	describe("recharge cadence", () => {
		it("recharges on a LONG rest at levels 1-4", () => {
			const state = makeBard({level: 3, cha: 16});
			expect(state.getResource("Bardic Inspiration").recharge).toBe("long");
		});

		it("does NOT restore on a short rest before level 5", () => {
			const state = makeBard({level: 4, cha: 16});
			expect(state.getResource("Bardic Inspiration").recharge).toBe("long");
			state.useResourceCharge("Bardic Inspiration", 3);
			expect(state.getResource("Bardic Inspiration").current).toBe(0);

			state.onShortRest();
			expect(state.getResource("Bardic Inspiration").current).toBe(0);
		});

		it("restores on a LONG rest", () => {
			const state = makeBard({level: 1, cha: 16});
			state.useResourceCharge("Bardic Inspiration", 3);
			expect(state.getResource("Bardic Inspiration").current).toBe(0);

			state.onLongRest();
			expect(state.getResource("Bardic Inspiration").current).toBe(3);
		});

		it("flips to SHORT recharge and restores on a short rest at Bard level 5 (Font of Inspiration)", () => {
			const state = makeBard({level: 5, cha: 16});
			CharacterSheetClassUtils.updateClassResources(
				state,
				{name: "Bard", source: "PHB"},
				5,
				{name: "Bard", source: "PHB"},
			);
			expect(state.getResource("Bardic Inspiration").recharge).toBe("short");

			state.useResourceCharge("Bardic Inspiration", 3);
			expect(state.getResource("Bardic Inspiration").current).toBe(0);

			state.onShortRest();
			expect(state.getResource("Bardic Inspiration").current).toBe(3);
		});

		it("keeps LONG recharge at Bard level 4 (short rest is a no-op)", () => {
			const state = makeBard({level: 4, cha: 16});
			CharacterSheetClassUtils.updateClassResources(
				state,
				{name: "Bard", source: "PHB"},
				4,
				{name: "Bard", source: "PHB"},
			);
			expect(state.getResource("Bardic Inspiration").recharge).toBe("long");
		});
	});

	describe("updates when Charisma changes", () => {
		it("recomputes max on ability-score change via recalculateResourceMaximums", () => {
			const state = makeBard({cha: 16});
			expect(state.getResource("Bardic Inspiration").max).toBe(3);

			state.setAbilityBase("cha", 20); // +5
			state.recalculateResourceMaximums();
			expect(state.getResource("Bardic Inspiration").max).toBe(5);
		});

		it("never drops below 1 even at negative Charisma modifier", () => {
			const state = makeBard({cha: 16});
			state.setAbilityBase("cha", 8); // -1
			state.recalculateResourceMaximums();
			expect(state.getResource("Bardic Inspiration").max).toBe(1);
		});
	});

	describe("surfaces in the Resources panel", () => {
		it("appears in getResources()", () => {
			const state = makeBard({cha: 16});
			expect(state.getResources().some(r => r.name === "Bardic Inspiration")).toBe(true);
		});

		it("appears in getGenericPoolResources() (the Resources panel feed) — the display fix", () => {
			const state = makeBard({cha: 16});
			const res = state.getResource("Bardic Inspiration");
			const genericBis = state.getGenericPoolResources().filter(r => r.name === "Bardic Inspiration");
			// Exactly one canonical pool row, linked to the feature-derived resource.
			expect(genericBis).toHaveLength(1);
			expect(genericBis[0].id).toBe(res.id);
			expect(genericBis[0]).toMatchObject({max: 3, current: 3, recharge: "long"});
		});

		it("is not classified as an activatable ability entry by the Resources-panel filter", () => {
			// getGenericPoolResources() decides inclusion by calling
			// isActivatableAbilityEntry({feature, activationInfo, interactionMode})
			// with interactionMode = info.interactionMode. Replicate that exact input
			// to lock in WHY Bardic Inspiration now passes the filter (matchedBy
			// "description" / not the featureUses fallback → isInstant:false).
			const state = makeBard({cha: 16});
			const feature = state.getFeatures().find(f => f.name === "Bardic Inspiration");
			const info = CharacterSheetState.detectActivatableFeature(feature);
			expect(info).not.toBeNull();
			expect(info.matchedBy).not.toBe("featureUses");
			expect(info.isInstant).toBe(false);
			expect(info.isToggle).toBe(false);
			const isAbility = CharacterSheetState.isActivatableAbilityEntry({
				feature,
				activationInfo: info,
				interactionMode: info.interactionMode,
			});
			expect(isAbility).toBe(false);
		});

		it("anchored pattern does not over-match features that merely reference Bardic Inspiration", () => {
			// Font of Inspiration changes Bardic Inspiration's recharge but is not itself
			// a Bardic Inspiration pool; the anchored /^bardic inspiration$/i pattern must
			// not classify it as a resource-pool ability.
			const info = CharacterSheetState.detectActivatableFeature({
				name: "Font of Inspiration",
				description: "You regain all expended uses of Bardic Inspiration when you finish a Short Rest or a Long Rest.",
			});
			const matchedAsBiPool = !!info
				&& info.stateTypeId === "custom"
				&& info.matchedBy === "description"
				&& info.isInstant === false
				&& info.isToggle === false;
			expect(matchedAsBiPool).toBe(false);
		});
	});

	describe("Features-tab use stays synced with the resource", () => {
		it("keeps feature.uses in lockstep with the resource pool via the Overview Use path", () => {
			const state = makeBard({cha: 16});
			const feature = state.getFeatures().find(f => f.name === "Bardic Inspiration");
			expect(feature.uses).toMatchObject({max: 3, current: 3});

			// The Overview Resources panel spends a charge via setResourceCurrent(id, ...),
			// which syncs the linked feature's uses.
			const res = state.getResource("Bardic Inspiration");
			state.setResourceCurrent(res.id, res.current - 1);

			const after = state.getFeatures().find(f => f.name === "Bardic Inspiration");
			expect(after.uses.current).toBe(2);
			expect(state.getResource("Bardic Inspiration").current).toBe(2);
		});
	});
});
