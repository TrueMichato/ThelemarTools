/**
 * Speed breakdown modal — overflow + layout fix (round 4, Bug 4)
 *
 * The speed breakdown modal lists walk + fly + swim + climb + burrow, each with several
 * itemized components. With many speeds the content overflowed the modal box because the modal
 * scroller only becomes scrollable for `.ve-w-100` modals, and the speed modal does not use that.
 * The fix:
 *   - marks the content with `charsheet__speed-modal-content` so CSS turns the scroller into a
 *     bounded, scrollable region (mirroring the proven `.ve-w-100` scroller pattern);
 *   - moves the Close button into the pinned footer slot (`hasFooter: true`) so it stays visible;
 *   - replaces the inline `font-size` hack on secondary movement totals with a real modifier
 *     class (`charsheet__ac-modal-total--secondary`).
 *
 * This is a presentation/CSS fix, so — consistent with the repo's existing modal-wiring tests
 * (see CharacterSheetQuickBuildExitModalZIndex) — these assertions lock in the render + CSS
 * plumbing at the source level rather than booting the full page controller in jsdom.
 */

import fs from "fs";
import path from "path";

const charsheetSrc = fs.readFileSync(
	path.resolve(process.cwd(), "js/charactersheet/charactersheet.js"),
	"utf8",
);
const cssSrc = fs.readFileSync(
	path.resolve(process.cwd(), "css/charactersheet.css"),
	"utf8",
);

// Isolate the `_showSpeedBreakdownModal` method body.
function getSpeedModalBody () {
	const start = charsheetSrc.indexOf("async _showSpeedBreakdownModal ()");
	expect(start).toBeGreaterThan(-1);
	// Next method on the class begins at "_showHpBreakdownModal" / "async _showHpBreakdownModal".
	const end = charsheetSrc.indexOf("_showHpBreakdownModal", start);
	expect(end).toBeGreaterThan(start);
	return charsheetSrc.slice(start, end);
}

describe("Speed breakdown modal — overflow + layout fix (Bug 4)", () => {
	let body;
	beforeAll(() => { body = getSpeedModalBody(); });

	test("opens the modal with a pinned footer slot", () => {
		expect(body).toMatch(/hasFooter:\s*true/);
		// And it destructures the footer element to place the Close button there.
		expect(body).toMatch(/eleModalFooter:\s*modalFooter/);
	});

	test("tags the content with the speed-modal marker class used by the scroll CSS", () => {
		expect(body).toMatch(/charsheet__speed-modal-content/);
	});

	test("renders secondary movement totals via a modifier class, not an inline font-size hack", () => {
		expect(body).toMatch(/charsheet__ac-modal-total--secondary/);
		expect(body).not.toMatch(/style="font-size/);
	});

	test("appends the Close button into the footer slot (falls back to inner if absent)", () => {
		expect(body).toMatch(/\(modalFooter\s*\|\|\s*modalInner\)\.append\(closeFooter2\)/);
	});
});

describe("Speed breakdown modal — CSS makes the scroller bounded + scrollable", () => {
	test("scopes a scrollable scroller rule to the speed modal content", () => {
		// The rule must target the scroller :has(.charsheet__speed-modal-content) and enable
		// vertical scrolling with a shrinkable flex item.
		const re = /\.ve-ui-modal__scroller:has\(\.charsheet__speed-modal-content\)\s*\{[^}]*overflow-y:\s*auto[^}]*\}/;
		const match = cssSrc.match(re);
		expect(match).not.toBeNull();
		expect(match[0]).toMatch(/min-height:\s*0/);
		expect(match[0]).toMatch(/flex:\s*1 1 auto/);
	});

	test("defines the secondary movement-total modifier class", () => {
		expect(cssSrc).toMatch(/\.charsheet__ac-modal-total--secondary\s*\{/);
	});
});
