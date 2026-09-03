/**
 * Carrying-capacity (Bug #3) — TGTT Thelemar "passive Might" rule and the
 * standard-5e rule, plus the itemized breakdown that backs the carry tooltip.
 *
 * ROOT-CAUSE NOTE: the reported symptom ("TGTT Tortle STR 8 → 400 base / 800
 * push/drag/lift") was the OLD `Math.max(50, 50 + 25*mightMod)` formula, already
 * replaced by `passiveMight * 10` (commit c0a39b1, in the branch base). These
 * tests lock the CORRECT values across a spread of STR scores, size multipliers,
 * Powerful Build, the standard path, and a flat bonus — and explicitly regress the
 * STR-8 Tortle case to 90 / 180 (NOT 400 / 800). They also pin the new
 * `getCarryingCapacityBreakdown()` so the carry tooltip can render math that
 * actually adds up to the total it shows.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;

function mkChar ({str = 10, thelemar = true, level = 6} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setSetting("thelemar_carryWeight", thelemar);
	state.setAbilityBase("str", str);
	return state;
}

describe("Carrying capacity — Thelemar passive-Might rule", () => {
	it.each([
		[8, 90], // STR 8 → mod -1 → passive Might 9 → 90
		[10, 100], // STR 10 → mod 0 → passive Might 10 → 100
		[14, 120], // STR 14 → mod +2 → passive Might 12 → 120
		[20, 150], // STR 20 → mod +5 → passive Might 15 → 150
	])("STR %i → base %i lb. (push/drag/lift = 2×)", (str, expected) => {
		const state = mkChar({str});
		expect(state.getCarryingCapacity()).toBe(expected);
		expect(state.getCarryingCapacityBreakdown().pushDragLift).toBe(expected * 2);
	});

	it("REGRESSION: a TGTT Tortle with STR 8 is 90 / 180, NOT 400 / 800", () => {
		const state = mkChar({str: 8});
		state.setRace({name: "Tortle", source: "TGTT"});
		const cap = state.getCarryingCapacity();
		expect(cap).toBe(90);
		expect(cap * 2).toBe(180);
		// The old broken magnitudes must never come back.
		expect(cap).not.toBe(400);
		expect(cap * 2).not.toBe(800);
	});

	it("Might proficiency raises passive Might (and thus capacity) by the proficiency bonus", () => {
		const state = mkChar({str: 8, level: 6}); // prof +3
		state.setSkillProficiency("might", 1);
		// passive Might = 10 + (-1 + 3) = 12 → 120
		expect(state.getCarryingCapacity()).toBe(120);
	});
});

describe("Carrying capacity — standard 5e rule (flag off) is unchanged", () => {
	it.each([
		[15, 225],
		[8, 120],
		[20, 300],
	])("STR %i → %i lb. (STR × 15)", (str, expected) => {
		const state = mkChar({str, thelemar: false});
		expect(state.getCarryingCapacity()).toBe(expected);
	});
});

describe("Carrying capacity — Powerful Build, size, and flat bonus factors", () => {
	it("Powerful Build doubles capacity (Thelemar)", () => {
		const state = mkChar({str: 14});
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature"});
		state.applyClassFeatureEffects();
		// base 120 × ccMultiplier 2 = 240
		expect(state.getCarryingCapacity()).toBe(240);
		expect(state.getCarryingCapacityBreakdown().carryMultiplier).toBe(2);
	});

	it("Powerful Build doubles capacity (standard 5e too)", () => {
		const state = mkChar({str: 16, thelemar: false});
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature"});
		state.applyClassFeatureEffects();
		// base 240 × 2 = 480
		expect(state.getCarryingCapacity()).toBe(480);
	});

	it("Large size doubles capacity; Powerful Build + Large size stacks to ×4", () => {
		const state = mkChar({str: 14});
		state.setSize("large");
		expect(state.getSizeCarryMultiplier()).toBe(2);
		expect(state.getCarryingCapacity()).toBe(240); // 120 × 2 (size)

		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature"});
		state.applyClassFeatureEffects();
		// 120 × 2 (Powerful Build) × 2 (size) = 480 — acts as two size steps larger
		expect(state.getCarryingCapacity()).toBe(480);
	});

	it("Tiny size halves capacity", () => {
		const state = mkChar({str: 14});
		state.setSize("tiny");
		expect(state.getCarryingCapacity()).toBe(60); // 120 × 0.5
	});

	it("flat carry-capacity bonus is added before multipliers", () => {
		const state = mkChar({str: 14});
		state.setCustomModifier("carryCapacity", 10);
		state.setCustomModifier("carryCapacityMultiplier", 2);
		// (120 + 10) × 2 = 260
		const b = state.getCarryingCapacityBreakdown();
		expect(b.flatBonus).toBe(10);
		expect(b.carryMultiplier).toBe(2);
		expect(b.total).toBe(260);
		expect(state.getCarryingCapacity()).toBe(260);
	});
});

describe("Carrying-capacity breakdown — backs a tooltip whose math adds up", () => {
	it("exposes every factor and a total equal to getCarryingCapacity()", () => {
		const state = mkChar({str: 14});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.rule).toBe("thelemar");
		expect(b.sourceValue).toBe(12); // passive Might
		expect(b.perPoint).toBe(10);
		expect(b.base).toBe(120);
		expect(b.flatBonus).toBe(0);
		expect(b.carryMultiplier).toBe(1);
		expect(b.sizeMultiplier).toBe(1);
		expect(b.total).toBe(state.getCarryingCapacity());
		expect(b.pushDragLift).toBe(b.total * 2);
	});

	it("standard rule reports STR × 15 in the breakdown", () => {
		const state = mkChar({str: 15, thelemar: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.rule).toBe("standard");
		expect(b.sourceValue).toBe(15);
		expect(b.perPoint).toBe(15);
		expect(b.base).toBe(225);
		expect(b.total).toBe(225);
	});

	it("breakdown.total always equals (base + flat) × carryMult × sizeMult", () => {
		const state = mkChar({str: 14});
		state.setSize("large");
		state.setCustomModifier("carryCapacity", 30);
		state.setCustomModifier("carryCapacityMultiplier", 2);
		const b = state.getCarryingCapacityBreakdown();
		expect(b.total).toBe((b.base + b.flatBonus) * b.carryMultiplier * b.sizeMultiplier);
	});

	it("the all-factors case exposes concrete, non-drifting numbers (the tooltip's hardest case)", () => {
		// Thelemar STR 14 → passive Might 12 → base 120; +30 flat; ×2 build; ×2 (large) size.
		// total = (120 + 30) × 2 × 2 = 600; push/drag/lift = 1200. This is the exact scenario
		// the OLD tooltip mis-rendered as "passive Might 12 × 10 = 600" (base == total — false).
		const state = mkChar({str: 14});
		state.setSize("large");
		state.setCustomModifier("carryCapacity", 30);
		state.setCustomModifier("carryCapacityMultiplier", 2);
		const b = state.getCarryingCapacityBreakdown();
		expect(b.rule).toBe("thelemar");
		expect(b.sourceValue).toBe(12);
		expect(b.base).toBe(120);
		expect(b.flatBonus).toBe(30);
		expect(b.carryMultiplier).toBe(2);
		expect(b.sizeMultiplier).toBe(2);
		expect(b.total).toBe(600);
		expect(b.pushDragLift).toBe(1200);
		// base and total are genuinely DIFFERENT here — the old tooltip conflated them.
		expect(b.base).not.toBe(b.total);
	});
});

describe("Bug #11 — Powerful Build dedupe (registry + text-parse must not double-count)", () => {
	// A real TGTT Tortle's "Powerful Build" trait is captured by BOTH the feat registry
	// (register("Powerful Build")) AND its description text-parse ("count as one size
	// larger ... for ... carrying capacity"), producing two carryCapacity sizeIncrease
	// modifiers. Before the fix each doubled capacity → ×4. They must collapse to ×2.
	const PB_DESC = "You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift.";

	it("a Tortle whose Powerful Build has the carry description is ×2, NOT ×4 (standard rule)", () => {
		const state = mkChar({str: 10, thelemar: false}); // base 150
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature", description: PB_DESC});
		state.applyClassFeatureEffects();
		const b = state.getCarryingCapacityBreakdown();
		expect(b.carryMultiplier).toBe(2); // collapsed, not 4
		expect(b.total).toBe(300); // 150 × 2 — the user's "400" was a typo
	});

	it("a Tortle whose Powerful Build has the carry description is ×2, NOT ×4 (Thelemar rule)", () => {
		const state = mkChar({str: 10, thelemar: true}); // passive Might 10 → base 100
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature", description: PB_DESC});
		state.applyClassFeatureEffects();
		const b = state.getCarryingCapacityBreakdown();
		expect(b.carryMultiplier).toBe(2);
		expect(b.total).toBe(200); // 100 × 2
	});

	it("a Goliath relying on the registry alone (no parseable description) stays ×2", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addFeature({name: "Powerful Build", source: "PHB", sourceType: "raceFeature"});
		state.applyClassFeatureEffects();
		const b = state.getCarryingCapacityBreakdown();
		expect(b.carryMultiplier).toBe(2);
		expect(b.total).toBe(300);
	});

	it("two genuinely distinct carry-size sources still stack (dedupe is by source, not blanket)", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature", description: PB_DESC});
		state.addFeature({name: "Titanic Frame", source: "HB", sourceType: "raceFeature", description: "You count as one size larger when determining your carrying capacity."});
		state.applyClassFeatureEffects();
		const b = state.getCarryingCapacityBreakdown();
		// Powerful Build (collapsed ×2) × Titanic Frame (×2) = ×4
		expect(b.carryMultiplier).toBe(4);
		expect(b.total).toBe(600);
	});
});

describe("Bug #5 — Bag of Holding: counts toward carry total, but NEVER inflates push/drag/lift", () => {
	function bagOfHolding ({equipped = true, quantity = 1} = {}) {
		return {
			name: "Bag of Holding",
			source: "XDMG",
			_isCustom: false,
			weight: 15,
			containerCapacity: {weight: [500], weightless: true},
			equipped,
			attuned: false,
			quantity,
		};
	}

	it("an equipped Bag of Holding adds +500 lb of EXTERNAL capacity to the combined total (not size/PB-multiplied)", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.bodyCapacity).toBe(150);
		expect(b.externalCapacity).toBe(500);
		expect(b.total).toBe(650); // 150 body + 500 extradimensional
	});

	it("CORE FIX: equipping a Bag of Holding does NOT change push/drag/lift (body ×2 only)", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		const before = state.getCarryingCapacityBreakdown();
		expect(before.pushDragLift).toBe(300); // 150 × 2
		state.addItem(bagOfHolding({equipped: true}));
		const after = state.getCarryingCapacityBreakdown();
		// Carry total grows (storage), but the physical push/drag/lift limit is unchanged.
		expect(after.total).toBe(650);
		expect(after.pushDragLift).toBe(300);
		expect(after.pushDragLift).toBe(before.pushDragLift);
		expect(after.pushDragLift).not.toBe(800); // the old (body×2 + external) bug
	});

	it("an UNEQUIPPED Bag of Holding contributes nothing", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: false}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.externalCapacity).toBe(0);
		expect(b.total).toBe(150);
		expect(b.pushDragLift).toBe(300);
	});

	it("equipping then unequipping a Bag of Holding adds then reverts the external capacity (push/drag/lift stays put)", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: false}));
		const itemId = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(0);
		expect(state.getCarryingCapacityBreakdown().pushDragLift).toBe(300);
		state.setItemEquipped(itemId, true);
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(500);
		expect(state.getCarryingCapacityBreakdown().pushDragLift).toBe(300); // unchanged by the bag
		state.setItemEquipped(itemId, false);
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(0);
		expect(state.getCarryingCapacityBreakdown().pushDragLift).toBe(300);
	});

	it("two equipped Bags of Holding stack their external capacity by quantity (push/drag/lift still body-only)", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true, quantity: 2}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.externalCapacity).toBe(1000);
		expect(b.total).toBe(1150);
		expect(b.pushDragLift).toBe(300);
	});

	it("two SEPARATE equipped weightless containers each contribute (summed across entries)", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true})); // +500
		state.addItem({
			name: "Heward's Handy Haversack",
			source: "XDMG",
			_isCustom: true,
			weight: 5,
			containerCapacity: {weight: [120], weightless: true},
			equipped: true,
			quantity: 1,
		}); // +120
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(620);
	});

	it("CRITICAL: Powerful Build doubles the BODY only — (150×2)+500 = 800 total, push/drag/lift 600", () => {
		const state = mkChar({str: 10, thelemar: false}); // base 150
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature", description: "You count as one size larger when determining your carrying capacity."});
		state.applyClassFeatureEffects();
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.carryMultiplier).toBe(2);
		expect(b.bodyCapacity).toBe(300); // 150 × 2
		expect(b.externalCapacity).toBe(500);
		// Body (300) is doubled; the bag's 500 is added AFTER, undoubled.
		expect(b.total).toBe(800);
		expect(b.total).not.toBe(1300); // (150 + 500) × 2 would be the bug
		// push/drag/lift doubles ONLY the body (300×2=600); the bag adds nothing.
		expect(b.pushDragLift).toBe(600);
		expect(b.pushDragLift).not.toBe(1100); // body×2 + external (old bug)
		expect(b.pushDragLift).not.toBe(1600); // total×2 would wrongly double the bag
	});

	it("the bag's contents are weightless but the empty bag's own weight still counts", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true})); // 15 lb
		const bagId = state.getItems()[0].id;
		state.addItem({name: "Anvil", source: "PHB", weight: 100, quantity: 1, equipped: false});
		const anvilId = state.getItems()[1].id;
		// Before stowing: both the bag (15) and the anvil (100) count.
		expect(state.getTotalWeight()).toBe(115);
		const stow = state.putItemInContainer(anvilId, bagId);
		expect(stow.success).toBe(true);
		// After stowing in the weightless bag: only the bag's own 15 lb counts.
		expect(state.getTotalWeight()).toBe(15);
	});

	it("Thelemar rule + Bag of Holding: total = body+external, push/drag/lift body-only, fill-bag-first split", () => {
		const state = mkChar({str: 10, thelemar: true}); // passive Might 10 → body 100
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.rule).toBe("thelemar");
		expect(b.bodyCapacity).toBe(100);
		expect(b.externalCapacity).toBe(500);
		expect(b.bagCapacity).toBe(500);
		expect(b.total).toBe(600);
		expect(b.pushDragLift).toBe(200); // 100 × 2, bag excluded
		// 120 lb of loose gear notionally fills the 500 lb bag FIRST, so only the
		// bag's own 15 lb rides on the body — well under the 100 body capacity.
		state.addItem({name: "Boulder", source: "PHB", weight: 120, quantity: 1, equipped: false});
		const after = state.getCarryingCapacityBreakdown();
		expect(after.bagLoad).toBe(120);
		expect(after.bodyLoad).toBe(15); // just the empty bag's own weight
		expect(state.getEncumbranceLevel()).toBe("normal");
	});

	it("OVERFLOW beyond bag capacity lands on the body and CAN cause over_capacity", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem(bagOfHolding({equipped: true})); // 500 lb bag, 15 lb own weight
		// 700 lb of loose gear: 500 fills the bag, 200 overflow + 15 bag weight = 215 on body.
		state.addItem({name: "Cargo", source: "PHB", weight: 700, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.bagLoad).toBe(500); // capped at capacity
		expect(b.bodyLoad).toBe(215); // 200 overflow + 15 bag weight
		expect(b.bodyLoad).toBeGreaterThan(b.bodyCapacity);
		expect(state.getEncumbranceLevel()).toBe("over_capacity");
	});

	it("encumbrance is judged on the BODY load — WORN gear cannot be stowed, so a bag cannot mask it", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem(bagOfHolding({equipped: true})); // a roomy bag is equipped
		// 200 lb of EQUIPPED (worn/wielded) gear stays on the body — you can't cram
		// what you're wearing into a sack — so the bag cannot rescue the overload.
		state.addItem({name: "Adamantine Plate", source: "PHB", weight: 200, quantity: 1, equipped: true});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.bagLoad).toBe(0); // nothing stowable
		expect(b.bodyLoad).toBe(215); // 200 worn + 15 bag weight
		expect(state.getEncumbranceLevel()).toBe("over_capacity");
	});

	it("a mundane (non-weightless) container does NOT grant external capacity", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem({
			name: "Backpack",
			source: "PHB",
			weight: 5,
			containerCapacity: {weight: [30], weightless: false},
			equipped: true,
		});
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(0);
	});
});

describe("Bug #2 — implicit Bag-of-Holding carry split (fill bag first, two separate bars)", () => {
	function bagOfHolding ({equipped = true, quantity = 1, weight = 15, capacity = 500} = {}) {
		return {
			name: "Bag of Holding",
			source: "XDMG",
			_isCustom: false,
			weight,
			containerCapacity: {weight: [capacity], weightless: true},
			equipped,
			attuned: false,
			quantity,
		};
	}

	it("the breakdown exposes the full split shape", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true}));
		state.addItem({name: "Rope", source: "PHB", weight: 50, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		for (const key of [
			"rule", "sourceValue", "perPoint", "base", "flatBonus", "carryMultiplier",
			"sizeMultiplier", "bodyCapacity", "externalCapacity", "bagCapacity",
			"grossWeight", "fillableWeight", "bagLoad", "bodyLoad", "hasExtradimensional",
			"total", "pushDragLift",
		]) {
			expect(b).toHaveProperty(key);
		}
		expect(b.bagCapacity).toBe(b.externalCapacity);
		expect(b.hasExtradimensional).toBe(true);
	});

	it("NO bag: bodyLoad == total carried weight, bag is not present (no bag bar)", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem({name: "Anvil", source: "PHB", weight: 60, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.hasExtradimensional).toBe(false);
		expect(b.bagCapacity).toBe(0);
		expect(b.bagLoad).toBe(0);
		expect(b.fillableWeight).toBe(0); // not computed when there is no bag
		expect(b.bodyLoad).toBe(state.getTotalWeight());
		expect(b.bodyLoad).toBe(60);
	});

	it("bag with load UNDER capacity: bagLoad == fillable, body holds only the bag's own weight", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem(bagOfHolding({equipped: true})); // 15 lb own weight, 500 cap
		state.addItem({name: "Loot", source: "PHB", weight: 80, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.fillableWeight).toBe(80);
		expect(b.bagLoad).toBe(80); // all of it fits
		expect(b.bodyLoad).toBe(15); // just the empty bag
		expect(b.grossWeight).toBe(95); // 80 loot + 15 bag
		expect(state.getEncumbranceLevel()).toBe("normal");
	});

	it("bag OVERFILLED: bagLoad caps at capacity, overflow lands on the body, encumbrance judged on body", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		state.addItem(bagOfHolding({equipped: true, capacity: 100})); // small 100 lb bag
		state.addItem({name: "Ore", source: "PHB", weight: 300, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.bagCapacity).toBe(100);
		expect(b.fillableWeight).toBe(300);
		expect(b.bagLoad).toBe(100); // capped
		expect(b.bodyLoad).toBe(215); // 200 overflow + 15 bag weight
		expect(state.getEncumbranceLevel()).toBe("over_capacity");
	});

	it("the bag's OWN weight always stays on the body (never stowed in itself)", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true, weight: 15})); // only the bag, nothing else
		const b = state.getCarryingCapacityBreakdown();
		expect(b.fillableWeight).toBe(0); // the bag cannot stow itself
		expect(b.bagLoad).toBe(0);
		expect(b.bodyLoad).toBe(15); // the bag's own 15 lb rides on the body
	});

	it("push/drag/lift is unchanged by the split (Strength-only, body ×2)", () => {
		const state = mkChar({str: 10, thelemar: false}); // body 150
		const before = state.getCarryingCapacityBreakdown().pushDragLift;
		state.addItem(bagOfHolding({equipped: true}));
		state.addItem({name: "Crates", source: "PHB", weight: 400, quantity: 1, equipped: false});
		const after = state.getCarryingCapacityBreakdown();
		expect(before).toBe(300);
		expect(after.pushDragLift).toBe(300); // body ×2, never inflated by the bag or its load
	});

	it("Thelemar-rule character with a Bag of Holding splits correctly", () => {
		const state = mkChar({str: 10, thelemar: true}); // passive Might 10 → body 100
		state.addItem(bagOfHolding({equipped: true}));
		state.addItem({name: "Supplies", source: "PHB", weight: 250, quantity: 1, equipped: false});
		const b = state.getCarryingCapacityBreakdown();
		expect(b.rule).toBe("thelemar");
		expect(b.bodyCapacity).toBe(100);
		expect(b.bagLoad).toBe(250); // 250 ≤ 500 cap
		expect(b.bodyLoad).toBe(15); // just the bag
		expect(b.pushDragLift).toBe(200); // 100 × 2
		expect(state.getEncumbranceLevel()).toBe("normal");
	});

	it("getFillableWeight excludes equipped gear and the bag, includes loose gear", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true})); // bag itself: excluded
		state.addItem({name: "Worn Armor", source: "PHB", weight: 40, quantity: 1, equipped: true}); // excluded
		state.addItem({name: "Loose Gold", source: "PHB", weight: 30, quantity: 2, equipped: false}); // 60, included
		expect(state.getFillableWeight()).toBe(60);
	});
});

describe("Carry tooltip source — itemized, base != total under multipliers", () => {
	const charsheetSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

	// Extract the _buildCarryTooltip body and the physical-stats wiring so we pin the
	// CORRECTED behavior, not mere presence of a method name. The controller isn't
	// node-importable (`window is not defined`), hence source-pinning.
	const tooltipBody = (() => {
		const m = charsheetSrc.match(/static _buildCarryTooltip\s*\(b\)\s*\{[\s\S]*?\n\t\}/);
		return m ? m[0] : "";
	})();

	it("the carry tooltip is wired from the itemized breakdown and set as the title", () => {
		expect(charsheetSrc).toMatch(/const carryBreakdown = this\._state\.getCarryingCapacityBreakdown\(\)/);
		expect(charsheetSrc).toMatch(/_buildCarryTooltip\(carryBreakdown\)/);
	});

	it("_buildCarryTooltip itemizes every body factor (base, flat, build, size) and the body subtotal", () => {
		expect(tooltipBody.length).toBeGreaterThan(0);
		expect(tooltipBody).toContain("b.base");
		expect(tooltipBody).toContain("b.flatBonus");
		expect(tooltipBody).toContain("b.carryMultiplier");
		expect(tooltipBody).toContain("b.sizeMultiplier");
		expect(tooltipBody).toContain("b.bodyCapacity");
		expect(tooltipBody).toContain("b.pushDragLift");
		// Factors are only appended when actually in play (so the math stays honest).
		expect(tooltipBody).toMatch(/if \(b\.flatBonus\)/);
		expect(tooltipBody).toMatch(/b\.carryMultiplier !== 1/);
		expect(tooltipBody).toMatch(/b\.sizeMultiplier !== 1/);
	});

	it("the body equation resolves to the BODY subtotal, not the combined total", () => {
		// The Strength-based equation must end at b.bodyCapacity — the combined total
		// (incl. extradimensional storage) is shown on its own line, never as the body sum.
		expect(tooltipBody).toMatch(/= \$\{b\.bodyCapacity\} lb\./);
		// And the old misleading template that equated base with the final capacity is gone.
		expect(charsheetSrc).not.toContain("× 10 = $" + "{carryCapacity}");
		expect(charsheetSrc).not.toContain("× 15 = $" + "{carryCapacity}");
	});

	it("Bug #2: the bag is a SEPARATE labelled bar and push/drag/lift is flagged Strength-only", () => {
		// The implicit split must render the bag as its own additive line (not a body
		// equation term), describing fill-bag-first, with the combined total distinct.
		expect(tooltipBody).toContain("b.bagLoad");
		expect(tooltipBody).toContain("b.bagCapacity");
		expect(tooltipBody).toContain("b.bodyLoad");
		expect(tooltipBody).toMatch(/if \(b\.hasExtradimensional\)/);
		expect(tooltipBody).toMatch(/Bag of Holding/);
		expect(tooltipBody).toMatch(/On the body/);
		expect(tooltipBody).toMatch(/Total carrying capacity: \$\{b\.total\} lb\./);
		// The external term is NOT folded into the body equation as "(containers)".
		expect(tooltipBody).not.toMatch(/\(containers\)/);
		// Push/drag/lift line states it excludes extradimensional storage.
		expect(tooltipBody).toMatch(/Push\/Drag\/Lift: \$\{b\.pushDragLift\} lb\./);
		expect(tooltipBody).toMatch(/Strength only/);
	});
});

describe("Carry display reads route through state helpers (no local recompute)", () => {
	const charsheetSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const inventorySrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-inventory.js"), "utf8");

	it("the overview carry panel reads weight / push / capacity from state, not a local items.reduce", () => {
		// On-body load comes from the breakdown's bodyLoad (the fill-bag-first split),
		// never recomputed locally.
		expect(charsheetSrc).toMatch(/const bodyLoad = carryBreakdown\.bodyLoad/);
		// Push/drag/lift comes from the breakdown, never recomputed as carry × 2 here.
		expect(charsheetSrc).toMatch(/const pushDragLift = carryBreakdown\.pushDragLift/);
		expect(charsheetSrc).not.toMatch(/const pushDragLift = carryCapacity \* 2/);
		// The old local weight reduce in the physical-stats render is gone.
		expect(charsheetSrc).not.toMatch(/const currentWeight = items\.reduce/);
		// The separate Bag-of-Holding bar is driven from bagLoad / bagCapacity.
		expect(charsheetSrc).toMatch(/charsheet-carry-bar-bagfill/);
		expect(charsheetSrc).toMatch(/carryBreakdown\.hasExtradimensional/);
	});

	it("the inventory encumbrance panel reads the split from the breakdown and judges overload vs body capacity", () => {
		expect(inventorySrc).toMatch(/const bodyLoad = carryBreakdown\.bodyLoad/);
		expect(inventorySrc).toMatch(/const bodyCapacity = carryBreakdown\.bodyCapacity/);
		expect(inventorySrc).not.toMatch(/const totalWeight = items\.reduce/);
		// Overload is now judged by the shared contract, which compares bodyLoad against
		// bodyCapacity for exactly the reason this test was written: extradimensional storage
		// must never mask physical overload. The panel consumes the verdict instead of
		// recomputing it, which is also what stopped it disagreeing with play mode and the PDF.
		expect(inventorySrc).toMatch(/carryBreakdown\.status === "over_capacity"/);
		expect(inventorySrc).not.toMatch(/strScore \* 5/);
		// The separate Bag-of-Holding bar is present and gated on hasExtradimensional.
		expect(inventorySrc).toMatch(/charsheet-carrying-bagfill/);
		expect(inventorySrc).toMatch(/carryBreakdown\.hasExtradimensional/);
	});
});

describe("Encumbrance tiers — the rule source, and the toggle over it", () => {
	// PHB variant Encumbrance defines its tiers on the STRENGTH SCORE: "in excess of 5 times
	// your Strength score... in excess of 10 times your Strength score". "Size and Strength"
	// scales carrying capacity and push/drag/lift and says nothing about these tiers, so
	// anything that changes capacity must leave them where they are.
	it("standard tiers are STR x 5 / STR x 10 and do not move with capacity", () => {
		const state = mkChar({str: 16, thelemar: false});
		expect(state.getCarryProfile().thresholds).toEqual({encumbered: 80, heavilyEncumbered: 160});

		state.setSize("large");
		expect(state.getCarryingCapacity()).toBe(480); // capacity doubled
		expect(state.getCarryProfile().thresholds).toEqual({encumbered: 80, heavilyEncumbered: 160});
	});

	it("Thelemar tiers default ON as a house extension, proportional to capacity", () => {
		const state = mkChar({str: 16, thelemar: true});
		const profile = state.getCarryProfile();
		// TGTT publishes no tiers of its own; these mirror the RAW proportions so a Thelemar
		// character still gets a warning before they are simply over their maximum.
		expect(profile.thresholdRuleId).toBe("thelemar-proportional");
		expect(profile.thresholds.encumbered).toBeCloseTo(profile.bodyCapacity / 3, 6);
		expect(profile.thresholds.heavilyEncumbered).toBeCloseTo((profile.bodyCapacity * 2) / 3, 6);
	});

	it("turning the tiers off leaves only the consequence TGTT actually states", () => {
		const state = mkChar({str: 16, thelemar: true});
		state.setSetting("thelemar_encumbranceTiers", false);
		const profile = state.getCarryProfile();
		expect(profile.thresholdRuleId).toBe("capacity-only");
		expect(profile.thresholds).toBeNull();

		// Comfortably loaded: no tier applies, so nothing is reported...
		state.addItem({name: "Load", weight: profile.bodyCapacity - 1});
		expect(state.getEncumbranceLevel()).toBe("normal");
		// ...until the maximum itself is exceeded.
		state.addItem({name: "Straw", weight: 5});
		expect(state.getEncumbranceLevel()).toBe("over_capacity");
	});

	it("the toggle does not touch the standard rule, which has tiers of its own", () => {
		const state = mkChar({str: 16, thelemar: false});
		state.setSetting("thelemar_encumbranceTiers", false);
		expect(state.getCarryProfile().thresholdRuleId).toBe("phb-variant");
	});

	it("defaults to ON for a character saved before the setting existed", () => {
		const state = mkChar({str: 16, thelemar: true});
		delete state._data.settings.thelemar_encumbranceTiers;
		expect(state.getCarryProfile().thresholdRuleId).toBe("thelemar-proportional");
	});

	it("survives a save/load round-trip in both positions", () => {
		for (const value of [true, false]) {
			const state = mkChar({str: 16, thelemar: true});
			state.setSetting("thelemar_encumbranceTiers", value);
			const restored = new CharacterSheetState();
			restored.loadFromJson(state.toJson());
			expect(restored.getSettings().thelemar_encumbranceTiers).toBe(value);
			expect(restored.getCarryProfile().thresholdRuleId).toBe(value ? "thelemar-proportional" : "capacity-only");
		}
	});

	it("is reachable from the settings modal, play mode, and the campaign rule catalog", () => {
		// A setting nobody can find is not a setting. Pin every surface that exposes it.
		const charsheet = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		expect(charsheet).toContain("settings-thelemar-encumbrance-tiers");
		expect(charsheet).toContain(`setSetting("thelemar_encumbranceTiers"`);
		// ...and it participates in the "Enable All Thelemar Rules" master toggle.
		expect(charsheet).toContain(`"#settings-thelemar-encumbrance-tiers",`);

		const playmode = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-playmode.js"), "utf8");
		expect(playmode).toContain("thelemar_encumbranceTiers");

		const campaignRules = readFileSync(resolve(REPO_ROOT, "server/src/campaign-content.js"), "utf8");
		expect(campaignRules).toContain("thelemar_encumbranceTiers");
	});
});
