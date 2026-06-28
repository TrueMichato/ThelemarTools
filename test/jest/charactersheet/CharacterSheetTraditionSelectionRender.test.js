/**
 * Tradition-selection render regression (orchestrator BUG #2).
 *
 * The Combat Methods Management modal opened to NOTHING because
 * `_renderTraditionSelection`'s `makeChip` contained a stray duplicate style
 * line `opacity: ${isLocked ? "0.85" : "1"};` — `isLocked` is undefined in
 * that scope (the surrounding code uses `trad.locked`). That bare reference
 * throws a `ReferenceError` while the chip template literal is being evaluated,
 * which aborts the whole tradition-selection render and leaves
 * `_showMethodPicker` showing an empty modal.
 *
 * This test drives the REAL render path: it instantiates `CharacterSheetCombat`,
 * stubs only the data seam (`_getTraditionSelectionModel`), and calls
 * `_renderTraditionSelection` against a real container. The `ReferenceError`
 * is thrown during JS evaluation of the chip's template literal, so it
 * reproduces even though jsdom isn't available in this `node` test env — the
 * setup.js `e_` stub accumulates child HTML into the parent, so we can assert
 * on the rendered markup instead of `querySelectorAll`.
 *
 * RED (with the stray `isLocked` line present): `_renderTraditionSelection`
 *     throws `ReferenceError: isLocked is not defined`.
 * GREEN (after removing it): renders chips; locked/granted chip is
 *     checked + disabled.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// Fighter-9 TGTT Arcane Archer-like shape: Adamant Mountain granted by
// subclass (locked), a few chosen + available traditions.
const makeModel = () => ({
	selected: ["AM", "BZ", "RE"],
	groups: [
		{
			key: "granted",
			label: "Granted by subclass (locked)",
			locked: true,
			traditions: [
				{name: "Adamant Mountain", code: "AM", locked: true, selected: true},
			],
		},
		{
			key: "available",
			label: "Available",
			locked: false,
			traditions: [
				{name: "Biting Zephyr", code: "BZ", locked: false, selected: true},
				{name: "Razor's Edge", code: "RE", locked: false, selected: true},
				{name: "Conniving", code: "CJ", locked: false, selected: false},
			],
		},
	],
	grantedCodes: ["AM"],
	choosableCodes: ["BZ", "RE", "CJ"],
});

const makeCombat = (model) => {
	// Bypass the constructor (it wires DOM event listeners via `document`, which
	// jsdom doesn't provide in this `node` test env) and exercise the real
	// prototype method directly.
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = {};
	combat._page = {};
	combat._getTraditionSelectionModel = () => model;
	return combat;
};

describe("_renderTraditionSelection (Combat Methods Management modal)", () => {
	it("renders without throwing (no stray `isLocked` ReferenceError)", () => {
		const combat = makeCombat(makeModel());
		const container = globalThis.e_({outer: `<div></div>`});

		expect(() => combat._renderTraditionSelection(container, ["AM", "BZ", "RE"], () => {})).not.toThrow();
	});

	it("appends tradition chips with checkbox inputs", () => {
		const combat = makeCombat(makeModel());
		const container = globalThis.e_({outer: `<div></div>`});

		combat._renderTraditionSelection(container, ["AM", "BZ", "RE"], () => {});

		const html = container.innerHTML;
		const checkboxes = (html.match(/type="checkbox"/g) || []).length;
		// AM + BZ + RE + CJ = 4 tradition checkboxes.
		expect(checkboxes).toBeGreaterThan(0);
		expect(checkboxes).toBe(4);
	});

	it("renders locked/granted traditions checked + disabled", () => {
		const combat = makeCombat(makeModel());
		const container = globalThis.e_({outer: `<div></div>`});

		combat._renderTraditionSelection(container, ["AM", "BZ", "RE"], () => {});

		const html = container.innerHTML;
		// The granted (locked) Adamant Mountain chip must be both checked and disabled.
		expect(html).toMatch(/<input type="checkbox"[^>]*checked[^>]*disabled/);
		expect(html).toContain("Adamant Mountain");
	});

	it("keeps chips for traditions not in the model groups out of the count (sanity)", () => {
		const model = makeModel();
		model.groups[1].traditions.pop(); // drop Conniving → 3 chips total
		const combat = makeCombat(model);
		const container = globalThis.e_({outer: `<div></div>`});

		combat._renderTraditionSelection(container, ["AM", "BZ", "RE"], () => {});

		const checkboxes = (container.innerHTML.match(/type="checkbox"/g) || []).length;
		expect(checkboxes).toBe(3);
	});
});
