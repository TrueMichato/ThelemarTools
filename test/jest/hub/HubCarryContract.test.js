import {
	CARRY_STATUS,
	ENCUMBRANCE_THRESHOLD_RULES,
	getCarryDelta,
	getCarryEnforcement,
	getCarryProfile,
	getCarryStatus,
	getCoinWeight,
	getEncumbranceThresholds,
	getPartyCarryAggregate,
	getSizeCarryMultiplier,
	normalizeCarryInput,
	SIZE_CARRY_MULTIPLIERS,
} from "../../../js/hub/hub-carry-contract.js";

/** A Small/Medium character with no modifiers, under standard rules. */
function getStandard (overrides = {}) {
	return getCarryProfile({rule: "standard", sourceValue: 16, thresholdSourceValue: 16, ...overrides});
}

/** A Thelemar character; `sourceValue` is passive Might, thresholds still key off STR. */
function getThelemar (overrides = {}) {
	return getCarryProfile({rule: "thelemar", sourceValue: 15, thresholdSourceValue: 16, ...overrides});
}

describe("capacity — standard rule", () => {
	it("is STR score × 15 for a Small/Medium character", () => {
		expect(getStandard().bodyCapacity).toBe(240);
	});

	it("push/drag/lift is twice body capacity", () => {
		expect(getStandard().pushDragLift).toBe(480);
	});

	it("applies flat bonus before the multipliers, not after", () => {
		// (240 + 10) × 2 = 500. Applying the bonus after would give 240 × 2 + 10 = 490.
		expect(getStandard({flatBonus: 10, carryMultiplier: 2}).bodyCapacity).toBe(500);
	});

	it("Powerful Build doubles capacity", () => {
		expect(getStandard({carryMultiplier: 2}).bodyCapacity).toBe(480);
	});

	it("Powerful Build and Large size stack multiplicatively", () => {
		expect(getStandard({carryMultiplier: 2, size: "large"}).bodyCapacity).toBe(960);
	});
});

describe("capacity — Thelemar rule matches the TGTT Carrying Capacity (Passive Might) table", () => {
	// The published table: Tiny ×5, Small/Medium ×10, Large ×20, Huge ×40, Gargantuan ×80,
	// with Drag/Lift/Push at exactly twice the Carry column.
	it.each([
		["tiny", 5, 10],
		["small", 10, 20],
		["medium", 10, 20],
		["large", 20, 40],
		["huge", 40, 80],
		["gargantuan", 80, 160],
	])("%s carries Might × %i and drags Might × %i", (size, carryPerPoint, dragPerPoint) => {
		const passiveMight = 15;
		const profile = getThelemar({sourceValue: passiveMight, size});
		expect(profile.bodyCapacity).toBe(passiveMight * carryPerPoint);
		expect(profile.pushDragLift).toBe(passiveMight * dragPerPoint);
	});
});

describe("size multipliers", () => {
	it("matches the RAW ladder", () => {
		expect(SIZE_CARRY_MULTIPLIERS).toEqual({tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8});
	});

	it("a carry-only size step shifts the multiplier without needing a different size", () => {
		// Aurochs Zodiac Form: "count as one size larger" for carrying only.
		expect(getSizeCarryMultiplier("medium", 1)).toBe(2);
	});

	it("clamps at both ends rather than falling off the ladder", () => {
		expect(getSizeCarryMultiplier("gargantuan", 5)).toBe(8);
		expect(getSizeCarryMultiplier("tiny", -5)).toBe(0.5);
	});

	it("falls back to Medium for an unknown size instead of producing NaN", () => {
		expect(getCarryProfile({sourceValue: 10, size: "colossal"}).sizeMultiplier).toBe(1);
	});
});

describe("encumbrance thresholds are decoupled from capacity", () => {
	// The PHB variant rule defines the tiers on the STRENGTH SCORE — "in excess of 5 times
	// your Strength score" — while "Size and Strength" scales only carrying capacity and
	// push/drag/lift. Anything that changes capacity must therefore leave the tiers alone.
	it("phb-variant tiers are STR × 5 and STR × 10", () => {
		expect(getStandard().thresholds).toEqual({encumbered: 80, heavilyEncumbered: 160});
	});

	it.each([
		["Large size", {size: "large"}],
		["Powerful Build", {carryMultiplier: 2}],
		["a flat bonus", {flatBonus: 100}],
		["a DM capacity override", {capacityOverride: 999}],
		["a carry-only size step", {carrySizeSteps: 1}],
	])("%s changes capacity but must NOT move the phb-variant tiers", (_label, overrides) => {
		const baseline = getStandard();
		const modified = getStandard(overrides);
		expect(modified.bodyCapacity).not.toBe(baseline.bodyCapacity);
		expect(modified.thresholds).toEqual(baseline.thresholds);
	});

	it("thelemar-proportional tiers DO track capacity, being defined as fractions of it", () => {
		const profile = getThelemar({size: "large"});
		expect(profile.bodyCapacity).toBe(300);
		expect(profile.thresholds.encumbered).toBeCloseTo(100, 6);
		expect(profile.thresholds.heavilyEncumbered).toBeCloseTo(200, 6);
	});

	it("capacity-only and none define no tiers at all", () => {
		expect(getEncumbranceThresholds(normalizeCarryInput({thresholdRuleId: "capacity-only"}), 240)).toBeNull();
		expect(getEncumbranceThresholds(normalizeCarryInput({thresholdRuleId: "none"}), 240)).toBeNull();
	});

	it("defaults each capacity rule to its own policy", () => {
		expect(getStandard().thresholdRuleId).toBe("phb-variant");
		expect(getThelemar().thresholdRuleId).toBe("thelemar-proportional");
	});

	it("exposes exactly the four documented policies", () => {
		expect(Object.keys(ENCUMBRANCE_THRESHOLD_RULES).sort())
			.toEqual(["capacity-only", "none", "phb-variant", "thelemar-proportional"]);
	});
});

describe("status boundaries", () => {
	// "In excess of" is strictly greater than, so sitting exactly on a threshold is not yet
	// the next tier.
	it.each([
		[79, CARRY_STATUS.normal],
		[80, CARRY_STATUS.normal],
		[81, CARRY_STATUS.encumbered],
		[160, CARRY_STATUS.encumbered],
		[161, CARRY_STATUS.heavilyEncumbered],
		[240, CARRY_STATUS.heavilyEncumbered],
		[241, CARRY_STATUS.overCapacity],
	])("a body load of %i lb is %s", (grossWeight, expected) => {
		expect(getStandard({grossWeight}).status).toBe(expected);
	});

	it("capacity-only reports nothing between normal and over capacity", () => {
		expect(getStandard({thresholdRuleId: "capacity-only", grossWeight: 200}).status).toBe(CARRY_STATUS.normal);
		expect(getStandard({thresholdRuleId: "capacity-only", grossWeight: 241}).status).toBe(CARRY_STATUS.overCapacity);
	});
});

describe("extradimensional containers", () => {
	const withBag = (overrides = {}) => getStandard({externalCapacity: 500, ...overrides});

	it("adds to the combined total but never to push/drag/lift", () => {
		const profile = withBag();
		expect(profile.total).toBe(740);
		expect(profile.pushDragLift).toBe(480);
	});

	it("is not scaled by size or Powerful Build — a bag holds the same for anyone", () => {
		const profile = withBag({carryMultiplier: 2, size: "large"});
		expect(profile.externalCapacity).toBe(500);
		expect(profile.total).toBe(960 + 500);
	});

	it("fills the bag first, so stowable gear does not strain the body", () => {
		const profile = withBag({grossWeight: 300, fillableWeight: 300});
		expect(profile.bagLoad).toBe(300);
		expect(profile.bodyLoad).toBe(0);
		expect(profile.status).toBe(CARRY_STATUS.normal);
	});

	it("overflow beyond bag capacity lands on the body and can still overload it", () => {
		const profile = withBag({grossWeight: 900, fillableWeight: 900});
		expect(profile.bagLoad).toBe(500);
		expect(profile.bodyLoad).toBe(400);
		expect(profile.status).toBe(CARRY_STATUS.overCapacity);
	});

	it("worn gear cannot be stowed, so a bag cannot mask heavy armour", () => {
		// 300 lb carried but only 20 lb is stowable: the rest is worn.
		const profile = withBag({grossWeight: 300, fillableWeight: 20});
		expect(profile.bagLoad).toBe(20);
		expect(profile.bodyLoad).toBe(280);
		expect(profile.status).toBe(CARRY_STATUS.overCapacity);
	});

	it("without a container the split is a no-op", () => {
		const profile = getStandard({grossWeight: 100, fillableWeight: 100});
		expect(profile.hasExtradimensional).toBe(false);
		expect(profile.bagLoad).toBe(0);
		expect(profile.bodyLoad).toBe(100);
	});
});

describe("coins", () => {
	it("weighs 50 coins to the pound", () => {
		expect(getCoinWeight({gp: 1000})).toBe(20);
		expect(getCoinWeight({pp: 10, gp: 10, ep: 10, sp: 10, cp: 10})).toBe(1);
	});

	it("is reported but NOT counted by default, so no existing character gains weight", () => {
		const profile = getStandard({grossWeight: 100, coinCounts: {gp: 1000}});
		expect(profile.coinWeight).toBe(20);
		expect(profile.isCoinWeightCounted).toBe(false);
		expect(profile.bodyLoad).toBe(100);
	});

	it("is counted once opted in", () => {
		const profile = getStandard({grossWeight: 100, coinCounts: {gp: 1000}, isCoinWeightCounted: true});
		expect(profile.bodyLoad).toBe(120);
	});

	it("ignores malformed coin input rather than producing NaN", () => {
		expect(getCoinWeight({gp: "many", sp: null, cp: NaN})).toBe(0);
		expect(getCoinWeight(null)).toBe(0);
	});
});

describe("unknown and malformed input", () => {
	it("an unknown stack weight makes the profile indeterminate, never a confident normal", () => {
		const profile = getStandard({grossWeight: 50, unknownStackCount: 2});
		expect(profile.isIndeterminate).toBe(true);
		expect(profile.status).toBe(CARRY_STATUS.unknown);
	});

	it("but a known load already over capacity is still reported as over capacity", () => {
		// The known weight is a lower bound, so exceeding capacity is safe to assert.
		const profile = getStandard({grossWeight: 500, unknownStackCount: 2});
		expect(profile.status).toBe(CARRY_STATUS.overCapacity);
	});

	it.each([
		["NaN", NaN],
		["Infinity", Infinity],
		["negative", -50],
		["a string", "heavy"],
		["null", null],
		["a boolean", true],
	])("rejects %s weight rather than propagating it", (_label, grossWeight) => {
		const profile = getStandard({grossWeight});
		expect(Number.isFinite(profile.bodyLoad)).toBe(true);
		expect(profile.bodyLoad).toBe(0);
	});

	it("rejects a zero or negative multiplier, which would collapse capacity to nothing", () => {
		expect(getStandard({carryMultiplier: 0}).bodyCapacity).toBe(240);
		expect(getStandard({carryMultiplier: -2}).bodyCapacity).toBe(240);
	});

	it("preserves fractional weights rather than rounding them away", () => {
		const profile = getStandard({grossWeight: 0.75});
		expect(profile.bodyLoad).toBeCloseTo(0.75, 6);
	});

	it("normalizes an entirely absent input into a usable profile", () => {
		const profile = getCarryProfile();
		expect(profile.bodyCapacity).toBe(150);
		expect(profile.status).toBe(CARRY_STATUS.normal);
	});
});

describe("capacity override", () => {
	it("replaces the derived capacity but still yields a status", () => {
		const profile = getStandard({capacityOverride: 50, grossWeight: 60});
		expect(profile.bodyCapacity).toBe(50);
		expect(profile.isCapacityOverridden).toBe(true);
		expect(profile.status).toBe(CARRY_STATUS.overCapacity);
	});

	it("an override of zero is honoured, not treated as absent", () => {
		expect(getStandard({capacityOverride: 0}).bodyCapacity).toBe(0);
	});
});

describe("transfer deltas", () => {
	it("reports the load change and the threshold crossing", () => {
		const delta = getCarryDelta({
			before: getStandard({grossWeight: 200}),
			after: getStandard({grossWeight: 50}),
		});
		expect(delta.loadDelta).toBe(-150);
		expect(delta.before.level).toBe(CARRY_STATUS.heavilyEncumbered);
		expect(delta.after.level).toBe(CARRY_STATUS.normal);
		expect(delta.crossesThreshold).toBe(true);
	});

	it("flags newly becoming over capacity", () => {
		const delta = getCarryDelta({
			before: getStandard({grossWeight: 100}),
			after: getStandard({grossWeight: 300}),
		});
		expect(delta.becomesOverCapacity).toBe(true);
		expect(delta.relievesOverCapacity).toBe(false);
	});

	it("flags relief from over capacity", () => {
		const delta = getCarryDelta({
			before: getStandard({grossWeight: 300}),
			after: getStandard({grossWeight: 100}),
		});
		expect(delta.relievesOverCapacity).toBe(true);
	});
});

describe("party aggregate", () => {
	const known = getStandard({grossWeight: 100});
	const indeterminate = getStandard({grossWeight: 100, unknownStackCount: 1});
	const overloaded = getStandard({grossWeight: 300});

	it("buckets members and never blends an unavailable one into the totals", () => {
		const aggregate = getPartyCarryAggregate({
			members: [
				{profile: known},
				{profile: indeterminate},
				{profile: overloaded},
				{state: "unavailable", profile: null},
			],
			stashWeight: 42,
		});
		expect(aggregate.memberCount).toBe(4);
		expect(aggregate.knownCount).toBe(2);
		expect(aggregate.indeterminateCount).toBe(1);
		expect(aggregate.unavailableCount).toBe(1);
		expect(aggregate.overCapacityCount).toBe(1);
		// Only the three resolvable members contribute; the excluded one adds nothing at all,
		// so no hidden load can be recovered by subtracting the total.
		expect(aggregate.totalBodyLoad).toBe(500);
		expect(aggregate.totalBodyCapacity).toBe(720);
		expect(aggregate.stashWeight).toBe(42);
	});

	it("marks the totals partial whenever any member is unavailable or indeterminate", () => {
		expect(getPartyCarryAggregate({members: [{profile: known}]}).isTotalPartial).toBe(false);
		expect(getPartyCarryAggregate({members: [{profile: indeterminate}]}).isTotalPartial).toBe(true);
		expect(getPartyCarryAggregate({members: [{state: "unavailable"}]}).isTotalPartial).toBe(true);
	});

	it("handles an empty party without dividing by zero", () => {
		const aggregate = getPartyCarryAggregate({members: []});
		expect(aggregate.memberCount).toBe(0);
		expect(aggregate.totalBodyLoad).toBe(0);
		expect(aggregate.isTotalPartial).toBe(false);
	});
});

describe("enforcement", () => {
	it("is advisory and never blocking, even when over capacity", () => {
		const enforcement = getCarryEnforcement({profile: getStandard({grossWeight: 300})});
		expect(enforcement.disposition).toBe("advisory");
		expect(enforcement.isBlocking).toBe(false);
		expect(enforcement.reasons).toContain("over_capacity");
	});

	it("an enforced policy is reported unavailable rather than blocking, since no evaluator exists", () => {
		const enforcement = getCarryEnforcement({
			profile: getStandard({grossWeight: 300}),
			policy: {mode: "enforced"},
		});
		expect(enforcement.disposition).toBe("unavailable");
		expect(enforcement.isBlocking).toBe(false);
	});
});

describe("immutability", () => {
	it("returns frozen results and does not mutate its input", () => {
		const input = {rule: "standard", sourceValue: 16, grossWeight: 10};
		const profile = getCarryProfile(input);
		expect(Object.isFrozen(profile)).toBe(true);
		expect(input).toEqual({rule: "standard", sourceValue: 16, grossWeight: 10});
	});

	it("getCarryStatus tolerates a partial profile", () => {
		expect(getCarryStatus({}).level).toBe(CARRY_STATUS.normal);
		expect(getCarryStatus(null).level).toBe(CARRY_STATUS.normal);
	});
});
