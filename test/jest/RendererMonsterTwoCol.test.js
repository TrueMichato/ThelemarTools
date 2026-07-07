import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-config.js";
import "../../js/render.js";

/**
 * Smoke tests for the two-column statblock toggle (tracker #1200 / 5ET-1080).
 *
 * The full `Renderer.monster.getCompactRenderedString` pipeline pulls in browser-only globals
 * (PrereleaseUtil, BrewUtil2, DOM utilities, ...) which are not available in the node-env jest
 * runner used by this repo. These tests therefore cover the pieces of the toggle contract that
 * are pure and testable at the API surface: the page-wide default-mode state machine and the
 * per-statblock button helper string. Visual regressions across the render surfaces
 * (bestiary main pane, hover popouts, book view, DM Screen initiative viewer, character-sheet
 * creature-refs, print) remain a manual QA responsibility — see plan.md.
 */

describe("Two-column statblock default-mode state machine", () => {
	beforeEach(() => {
		Renderer.monster.setDefaultTwoColMode("single");
	});

	it("Defaults to single column", () => {
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("single");
		expect(Renderer.monster.isDefaultTwoCol()).toBe(false);
	});

	it("Accepts 'double' and reports as two-column", () => {
		Renderer.monster.setDefaultTwoColMode("double");
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("double");
		expect(Renderer.monster.isDefaultTwoCol()).toBe(true);
	});

	it("Round-trips back to single", () => {
		Renderer.monster.setDefaultTwoColMode("double");
		Renderer.monster.setDefaultTwoColMode("single");
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("single");
		expect(Renderer.monster.isDefaultTwoCol()).toBe(false);
	});

	it("Sanitises unknown values back to 'single' (defensive against corrupt storage)", () => {
		Renderer.monster.setDefaultTwoColMode("double");
		Renderer.monster.setDefaultTwoColMode("garbage");
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("single");

		Renderer.monster.setDefaultTwoColMode(null);
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("single");

		Renderer.monster.setDefaultTwoColMode(undefined);
		expect(Renderer.monster.getDefaultTwoColMode()).toBe("single");
	});
});

describe("Per-statblock toggle button HTML", () => {
	it("Includes the marker class the CSS targets", () => {
		const html = Renderer.utils.getBtnToggleTwoColHtml();
		expect(html).toContain("ve-stats__btn-two-col");
	});

	it("Is print-hidden and image-export-hidden so it does not leak into exports", () => {
		const html = Renderer.utils.getBtnToggleTwoColHtml();
		expect(html).toContain("no-print");
		expect(html).toContain("ve-lst-is-exporting-image__hidden");
	});

	it("Wires up the DOM-only class-toggle click handler", () => {
		const html = Renderer.utils.getBtnToggleTwoColHtml();
		expect(html).toContain("Renderer.utils._handleBtnToggleTwoCol");
	});

	it("Exposes a stable title so extensions / accessibility tooling can find it", () => {
		const html = Renderer.utils.getBtnToggleTwoColHtml();
		expect(html).toContain(`title="Toggle Two-Column Layout"`);
	});
});
