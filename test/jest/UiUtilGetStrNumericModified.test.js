import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";

// Bulk-apply / initiative-tracker HP delta parser lives in
// `UiUtil.getStrNumericModified`; this suite covers the same grammar the
// single-row HP input relies on, so a regression here would silently break
// both the tracker's row inputs and the multi-select apply bar.

describe("UiUtil.getStrNumericModified", () => {
	it("returns fallback for empty input when null is not allowed", () => {
		const out = UiUtil.getStrNumericModified("", 10, {});
		expect(out).toEqual({mode: "set", next: 0, delta: null});
	});

	it("returns null for empty input when isAllowNull", () => {
		const out = UiUtil.getStrNumericModified("", 10, {isAllowNull: true});
		expect(out).toEqual({mode: "empty", next: null, delta: null});
	});

	it("treats bare number as absolute (set)", () => {
		const out = UiUtil.getStrNumericModified("42", 10, {});
		expect(out).toEqual({mode: "set", next: 42, delta: null});
	});

	it("`=X` is always set, even when prev is populated", () => {
		const out = UiUtil.getStrNumericModified("=15", 50, {});
		expect(out).toEqual({mode: "set", next: 15, delta: null});
	});

	it("`+X` adds to prev", () => {
		const out = UiUtil.getStrNumericModified("+12", 50, {});
		expect(out.mode).toBe("delta");
		expect(out.next).toBe(62);
		expect(out.delta).toBe(12);
	});

	it("`-X` subtracts from prev", () => {
		const out = UiUtil.getStrNumericModified("-6", 50, {});
		expect(out.mode).toBe("delta");
		expect(out.next).toBe(44);
		expect(out.delta).toBe(-6);
	});

	it("`*X` multiplies prev", () => {
		const out = UiUtil.getStrNumericModified("*2", 20, {});
		expect(out.mode).toBe("delta");
		expect(out.next).toBe(40);
		expect(out.delta).toBe(20);
	});

	it("`/X` divides prev", () => {
		const out = UiUtil.getStrNumericModified("/2", 20, {isInt: true});
		expect(out.mode).toBe("delta");
		expect(out.next).toBe(10);
		expect(out.delta).toBe(-10);
	});

	it("treats leading `-` as absolute value when prev is already negative", () => {
		// Matches single-row historical rule so successive `-N` entries don't
		// keep compounding into runaway negatives.
		const out = UiUtil.getStrNumericModified("-5", -3, {});
		expect(out.mode).toBe("set");
		expect(out.next).toBe(-5);
	});

	it("supports dice expressions in the delta payload (deterministic when constant)", () => {
		// `-1d1+2` collapses to `-(1+2)` = -3, but Renderer.dice.lang parses
		// the whole `${prev}-1d1+2` expression; we only require that the
		// result is numeric and the mode is delta, since real dice roll.
		const out = UiUtil.getStrNumericModified("-1d1+2", 50, {isInt: true});
		expect(out.mode).toBe("delta");
		expect(Number.isFinite(out.next)).toBe(true);
		// prev - (1d1 + 2) with 1d1=1 => 50 - 3 = 47
		expect(out.next).toBe(47);
	});

	it("returns fallbackOnNaN for garbage input", () => {
		const out = UiUtil.getStrNumericModified("gibberish", 10, {fallbackOnNaN: -1});
		expect(out.mode).toBe("set");
		expect(out.next).toBe(-1);
	});

	it("respects min/max clamps on set", () => {
		const out = UiUtil.getStrNumericModified("999", 0, {max: 100});
		expect(out.next).toBe(100);
	});

	it("`isInt` rounds non-integer dice results", () => {
		const out = UiUtil.getStrNumericModified("2.7", 0, {isInt: true});
		expect(out.next).toBe(3);
	});

	it("null prevValue is treated as 0 for delta math", () => {
		const out = UiUtil.getStrNumericModified("+5", null, {});
		expect(out.mode).toBe("delta");
		expect(out.next).toBe(5);
		expect(out.delta).toBe(5);
	});
});
