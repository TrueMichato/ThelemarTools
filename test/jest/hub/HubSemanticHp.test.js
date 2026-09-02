import {getHealedHp, resolveApplicableMaxHp} from "../../../js/hub/hub-semantic-hp.js";

describe("resolveApplicableMaxHp", () => {
	it("prefers the applicable maximum over the stored base maximum", () => {
		// The base maximum omits item max-HP effects and strain halving; effectiveMax does not.
		expect(resolveApplicableMaxHp({current: 10, max: 44, effectiveMax: 54})).toBe(54);
	});

	it("falls back to the base maximum for documents stored before effectiveMax existed", () => {
		expect(resolveApplicableMaxHp({current: 10, max: 44})).toBe(44);
	});

	it.each([
		["zero", 0],
		["negative", -1],
		["fractional", 12.5],
		["non-finite", Number.POSITIVE_INFINITY],
		["NaN", Number.NaN],
		["null", null],
		["empty string", ""],
		["boolean", true],
		["beyond the safe range", Number.MAX_SAFE_INTEGER + 2],
	])("ignores an unusable effectiveMax that is %s and falls back", (_label, effectiveMax) => {
		expect(resolveApplicableMaxHp({current: 10, max: 44, effectiveMax})).toBe(44);
	});

	it.each([
		["both non-positive", {current: 10, max: 0, effectiveMax: 0}],
		["only a zero base maximum", {current: 10, max: 0}],
		["a negative base maximum", {current: 10, max: -5}],
		["no maximum at all", {current: 10}],
		["not an object", null],
		["an array", []],
	])("returns null when the document cannot supply a maximum: %s", (_label, hp) => {
		expect(resolveApplicableMaxHp(hp)).toBeNull();
	});
});

describe("getHealedHp", () => {
	it("clamps upward healing to the applicable maximum", () => {
		expect(getHealedHp({current: 10, amount: 100, applicableMax: 44})).toBe(44);
	});

	it("applies healing below the maximum verbatim", () => {
		expect(getHealedHp({current: 10, amount: 5, applicableMax: 44})).toBe(15);
	});

	it("never reduces hit points when the current total already exceeds the maximum", () => {
		// Psionic body strain halves the maximum without lowering the current total; a bare
		// Math.min would silently turn this heal into eleven points of damage.
		expect(getHealedHp({current: 30, amount: 5, applicableMax: 20})).toBe(30);
	});

	it("is monotonic for every amount at a maximum below the current total", () => {
		for (let amount = 1; amount <= 50; ++amount) {
			expect(getHealedHp({current: 30, amount, applicableMax: 20})).toBeGreaterThanOrEqual(30);
		}
	});
});
