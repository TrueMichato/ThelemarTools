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

describe("Bug #10 — Bag of Holding raises carrying capacity (equipped-gated, post-multiplier)", () => {
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

	it("an equipped Bag of Holding adds +500 lb of EXTERNAL capacity (not size/PB-multiplied)", () => {
		const state = mkChar({str: 10, thelemar: false}); // base 150
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.externalCapacity).toBe(500);
		expect(b.total).toBe(650); // 150 + 500
	});

	it("an UNEQUIPPED Bag of Holding contributes nothing", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: false}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.externalCapacity).toBe(0);
		expect(b.total).toBe(150);
	});

	it("equipping then unequipping a Bag of Holding adds then reverts the external capacity", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: false}));
		const itemId = state.getItems()[0].id;
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(0);
		state.setItemEquipped(itemId, true);
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(500);
		state.setItemEquipped(itemId, false);
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(0);
	});

	it("two equipped Bags of Holding stack their external capacity by quantity", () => {
		const state = mkChar({str: 10, thelemar: false});
		state.addItem(bagOfHolding({equipped: true, quantity: 2}));
		expect(state.getCarryingCapacityBreakdown().externalCapacity).toBe(1000);
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

	it("CRITICAL: Powerful Build does NOT double the Bag of Holding — (150×2)+500 = 800, not 1300", () => {
		const state = mkChar({str: 10, thelemar: false}); // base 150
		state.addFeature({name: "Powerful Build", source: "TGTT", sourceType: "raceFeature", description: "You count as one size larger when determining your carrying capacity."});
		state.applyClassFeatureEffects();
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		expect(b.carryMultiplier).toBe(2);
		expect(b.externalCapacity).toBe(500);
		// Body (300) is doubled; the bag's 500 is added AFTER, undoubled.
		expect(b.total).toBe(800);
		expect(b.total).not.toBe(1300); // (150 + 500) × 2 would be the bug
		// push/drag/lift doubles ONLY the body (300×2=600), then adds the undoubled bag (500).
		expect(b.pushDragLift).toBe(1100);
		expect(b.pushDragLift).not.toBe(1600); // total×2 would wrongly double the bag
	});

	it("push/drag/lift doubles only the body capacity, then adds the (undoubled) external capacity", () => {
		const state = mkChar({str: 10, thelemar: false}); // base 150
		state.addItem(bagOfHolding({equipped: true}));
		const b = state.getCarryingCapacityBreakdown();
		// pushDragLift = body(150)×2 + external(500) = 800
		expect(b.pushDragLift).toBe(800);
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

	it("_buildCarryTooltip itemizes every breakdown factor (base, flat, build, size)", () => {
		expect(tooltipBody.length).toBeGreaterThan(0);
		expect(tooltipBody).toContain("b.base");
		expect(tooltipBody).toContain("b.flatBonus");
		expect(tooltipBody).toContain("b.carryMultiplier");
		expect(tooltipBody).toContain("b.sizeMultiplier");
		expect(tooltipBody).toContain("b.pushDragLift");
		// Factors are only appended when actually in play (so the math stays honest).
		expect(tooltipBody).toMatch(/if \(b\.flatBonus\)/);
		expect(tooltipBody).toMatch(/b\.carryMultiplier !== 1/);
		expect(tooltipBody).toMatch(/b\.sizeMultiplier !== 1/);
	});

	it("the displayed equation resolves to the TOTAL, not the pre-multiplier base", () => {
		// The fix: the final "= N lb." must be b.total. The bug was "= <base>" presented as total.
		expect(tooltipBody).toMatch(/= \$\{b\.total\} lb\./);
		// And the old misleading template that equated base with the final capacity is gone.
		expect(charsheetSrc).not.toContain("× 10 = $" + "{carryCapacity}");
		expect(charsheetSrc).not.toContain("× 15 = $" + "{carryCapacity}");
	});

	it("Bug #10: the tooltip surfaces external container capacity as a trailing additive term", () => {
		// Bag of Holding capacity is post-multiplier, so it must render as "+ N lb. (containers)"
		// rather than a scaling factor — otherwise the displayed math wouldn't add up.
		expect(tooltipBody).toContain("b.externalCapacity");
		expect(tooltipBody).toMatch(/if \(b\.externalCapacity\)/);
		expect(tooltipBody).toMatch(/\(containers\)/);
	});
});
