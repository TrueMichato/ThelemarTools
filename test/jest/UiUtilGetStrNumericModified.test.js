import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {InitiativeTrackerRowUtil} from "../../js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-consts.js";

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

describe("InitiativeTrackerRowUtil.getHalvedDelta (5e save-for-half)", () => {
	// 5e PHB p.196: "half as much damage on a successful one".
	// PHB p.7 rounding rule: round down. No "minimum 1" for saves.
	it("halves large signed damage with floor", () => {
		expect(InitiativeTrackerRowUtil.getHalvedDelta(-30)).toBe(-15);
		expect(InitiativeTrackerRowUtil.getHalvedDelta(-7)).toBe(-3);
	});
	it("halves healing (positive) the same way", () => {
		expect(InitiativeTrackerRowUtil.getHalvedDelta(12)).toBe(6);
		expect(InitiativeTrackerRowUtil.getHalvedDelta(5)).toBe(2);
	});
	it("halves 1 to 0 (no minimum-1 rule for save-for-half)", () => {
		expect(InitiativeTrackerRowUtil.getHalvedDelta(1)).toBe(0);
		expect(InitiativeTrackerRowUtil.getHalvedDelta(-1)).toBe(0);
	});
	it("returns 0 for 0", () => {
		expect(InitiativeTrackerRowUtil.getHalvedDelta(0)).toBe(0);
	});
	it("returns 0 for non-finite input", () => {
		expect(InitiativeTrackerRowUtil.getHalvedDelta(NaN)).toBe(0);
		expect(InitiativeTrackerRowUtil.getHalvedDelta(Infinity)).toBe(0);
	});
});

describe("InitiativeTrackerRowUtil.isNonCombatantRow (marker-row predicate)", () => {
	it("returns false for regular rows", () => {
		expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x", entity: {name: "Goblin", hpCurrent: 5}})).toBe(false);
	});
	it("returns true for rows with entity.isLairMarker (lair-actions PR canonical flag)", () => {
		expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x", entity: {isLairMarker: true}})).toBe(true);
	});
	it("null-safe against missing entity or missing row", () => {
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(null)).toBe(false);
		expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x"})).toBe(false);
		expect(InitiativeTrackerRowUtil.isNonCombatantRow(undefined)).toBe(false);
	});
	it("respects the shared NON_COMBATANT_FLAGS allow-list (extension contract)", () => {
		// New marker types opt out of combat operations by pushing their flag
		// name onto NON_COMBATANT_FLAGS; this test guards that contract.
		InitiativeTrackerRowUtil.NON_COMBATANT_FLAGS.push("isFogMarker");
		try {
			expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x", entity: {isFogMarker: true}})).toBe(true);
			expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x", entity: {isLairMarker: true}})).toBe(true);
			expect(InitiativeTrackerRowUtil.isNonCombatantRow({id: "x", entity: {name: "PC"}})).toBe(false);
		} finally {
			// Restore the shared list so we don't leak state into other suites.
			const ix = InitiativeTrackerRowUtil.NON_COMBATANT_FLAGS.indexOf("isFogMarker");
			if (~ix) InitiativeTrackerRowUtil.NON_COMBATANT_FLAGS.splice(ix, 1);
		}
	});
});
