/**
 * Mobile status strip — policy tests.
 *
 * The strip's DOM plumbing is deliberately thin; what carries judgement is
 * which slot level it offers and how a current/max pair reads at a glance.
 * Those two decisions are pure statics precisely so they can be tested here,
 * in the repo's DOM-less node environment.
 *
 * The module has a load-time DOM guard, so stub the globals before importing.
 */

globalThis.document = {
	addEventListener: () => {},
	removeEventListener: () => {},
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	createElement: () => ({style: {}, classList: {add: () => {}, remove: () => {}, toggle: () => {}}, dataset: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}}),
	body: {classList: {add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false}},
	documentElement: {style: {}},
};
globalThis.window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	matchMedia: () => ({matches: false, addEventListener: () => {}, addListener: () => {}}),
	innerWidth: 1280,
};
globalThis.navigator = {maxTouchPoints: 0, userAgent: "node"};

await import("../../../js/charactersheet/charactersheet-mobile.js");
const CharacterSheetMobile = globalThis.CharacterSheetMobile;

describe("CharacterSheetMobile.pickSlotLevel", () => {
	it("offers the lowest level that still has a slot, keeping high slots in reserve", () => {
		const pick = CharacterSheetMobile.pickSlotLevel([
			{level: "1", open: 0, total: 4},
			{level: "2", open: 2, total: 3},
			{level: "3", open: 3, total: 3},
		]);
		expect(pick.level).toBe("2");
	});

	it("returns null when every slot is spent — a Champion Fighter and an exhausted Wizard look the same to the strip", () => {
		expect(CharacterSheetMobile.pickSlotLevel([
			{level: "1", open: 0, total: 4},
			{level: "2", open: 0, total: 3},
		])).toBeNull();
	});

	it("returns null for a class with no slots at all", () => {
		expect(CharacterSheetMobile.pickSlotLevel([])).toBeNull();
		expect(CharacterSheetMobile.pickSlotLevel(null)).toBeNull();
	});

	it("picks pact slots by the same rule — Warlocks need no special case", () => {
		const pick = CharacterSheetMobile.pickSlotLevel([
			{level: "pact", open: 2, total: 2},
		]);
		expect(pick.level).toBe("pact");
	});

	it("skips a malformed level rather than throwing", () => {
		const pick = CharacterSheetMobile.pickSlotLevel([null, undefined, {level: "1", open: 1, total: 1}]);
		expect(pick.level).toBe("1");
	});
});

describe("CharacterSheetMobile.readVitalState", () => {
	it("reads healthy above half", () => {
		expect(CharacterSheetMobile.readVitalState(40, 50)).toEqual({ratio: 0.8, state: null});
	});

	it("warns at exactly half — the boundary belongs to the warning", () => {
		expect(CharacterSheetMobile.readVitalState(25, 50).state).toBe("warn");
	});

	it("treats 0 HP as its own situation, not merely the bottom of the gradient", () => {
		const v = CharacterSheetMobile.readVitalState(0, 50);
		expect(v.state).toBe("critical");
		expect(v.ratio).toBe(0);
	});

	it("clamps negative HP rather than rendering a negative bar", () => {
		const v = CharacterSheetMobile.readVitalState(-12, 50);
		expect(v.ratio).toBe(0);
		expect(v.state).toBe("critical");
	});

	it("clamps overheal so the bar cannot exceed its track", () => {
		expect(CharacterSheetMobile.readVitalState(80, 50).ratio).toBe(1);
	});

	it("yields nothing when the numbers are not usable, so the segment hides instead of showing NaN", () => {
		expect(CharacterSheetMobile.readVitalState(NaN, 50)).toBeNull();
		expect(CharacterSheetMobile.readVitalState(10, 0)).toBeNull();
		expect(CharacterSheetMobile.readVitalState(10, NaN)).toBeNull();
	});
});

describe("status strip segment order", () => {
	it("declares HP first — the strip exists for the HP glance", () => {
		const keys = CharacterSheetMobile._STATUS_SEGMENTS.map(s => s.key);
		expect(keys[0]).toBe("hp");
		expect(keys).toEqual(["hp", "ac", "slots", "resource"]);
	});

	it("gives every segment a read(), so a missing source hides the segment rather than erroring", () => {
		CharacterSheetMobile._STATUS_SEGMENTS.forEach(seg => {
			expect(typeof seg.read).toBe("function");
			expect(seg.read()).toBeNull();
		});
	});
});
