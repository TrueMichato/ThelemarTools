import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import {jest} from "@jest/globals";

// Regression coverage: external homebrew referencing an unregistered item property (e.g. `ADV_DIS`)
// must degrade gracefully — a once-only console warning, no uncaught throw, no danger toast.
describe("Renderer.item.getProperty — unknown property handling", () => {
	let warnSpy;
	let toastSpy;

	beforeEach(() => {
		Renderer.item._ERRORS_LOGGED_MISSING_PROPERTY = {};
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		toastSpy = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		toastSpy.mockRestore();
	});

	it("returns undefined and warns exactly once for a missing property (no toast, no throw)", () => {
		expect(() => Renderer.item.getProperty("ADV_DIS")).not.toThrow();
		expect(Renderer.item.getProperty("ADV_DIS")).toBeUndefined();

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ADV_DIS"));
		expect(toastSpy).not.toHaveBeenCalled();
	});

	it("does not warn when isIgnoreMissing is passed (char-sheet inventory path)", () => {
		expect(Renderer.item.getProperty("ADV_MON", {isIgnoreMissing: true})).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("resolves a registered property without warning", () => {
		Renderer.item._addProperty({abbreviation: "TSTPROP", source: "PHB", name: "Test Prop", entries: ["Test entry."]});

		const out = Renderer.item.getProperty("TSTPROP|PHB");
		expect(out).toBeTruthy();
		expect(out.entries).toEqual(["Test entry."]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("enhanceItem does not throw when an item references an unregistered property", () => {
		const item = {
			name: "Homebrew Blade",
			source: "HB",
			property: [{uid: "ADV_TRIP|someHomebrew"}],
			entries: ["SENTINEL base entry."],
		};

		expect(() => Renderer.item.enhanceItem(item, {styleHint: "classic"})).not.toThrow();
		expect(item._isEnhanced).toBe(true);
		// The unknown property must contribute NO entries — only the sentinel base entry remains.
		const merged = JSON.stringify(item._fullEntries || item.entries);
		expect(merged).toContain("SENTINEL base entry.");
		expect(merged).not.toContain("ADV_TRIP");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ADV_TRIP"));
	});
});
