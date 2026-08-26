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
		BrewDiagnostics.clear();
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
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[5et:brew-diagnostics]"),
			expect.objectContaining({
				code: "item.missingProperty",
				target: expect.objectContaining({uid: "ADV_DIS"}),
			}),
		);
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
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("ADV_TRIP"),
			expect.objectContaining({
				origin: "unknown",
				owner: {prop: "item", name: "Homebrew Blade", source: "HB"},
				fieldPath: "property[0].uid",
			}),
		);
	});

	it("keeps separate diagnostics for separate entities using the same missing property", () => {
		[
			{name: "Blade One", source: "HB", property: ["ADV_DBL"]},
			{name: "Blade Two", source: "HB", property: ["ADV_DBL"]},
		].forEach(item => Renderer.item.enhanceItem(item, {styleHint: "classic", diagnosticContext: {origin: "brew", filename: "items.json"}}));

		expect(BrewDiagnostics.getRecords()).toEqual([
			expect.objectContaining({owner: expect.objectContaining({name: "Blade One"})}),
			expect.objectContaining({owner: expect.objectContaining({name: "Blade Two"})}),
		]);
	});
});

// Regression coverage: external homebrew referencing an unregistered item TYPE (e.g. `armor`)
// must degrade gracefully — a once-only console warning, no uncaught throw, no danger toast.
// Mirrors the getProperty hardening; previously getType did doToast(danger) + a deferred throw,
// which crashed the renderer on managebrew hover for third-party brews.
describe("Renderer.item.getType — unknown type handling", () => {
	let warnSpy;
	let toastSpy;

	beforeEach(() => {
		BrewDiagnostics.clear();
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		toastSpy = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		toastSpy.mockRestore();
	});

	it("returns undefined and warns exactly once for a missing type (no toast, no throw)", () => {
		expect(() => Renderer.item.getType("armor")).not.toThrow();
		expect(Renderer.item.getType("armor")).toBeUndefined();

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[5et:brew-diagnostics]"),
			expect.objectContaining({
				code: "item.missingType",
				target: expect.objectContaining({uid: "armor"}),
			}),
		);
		expect(toastSpy).not.toHaveBeenCalled();
	});

	it("does not warn when isIgnoreMissing is passed", () => {
		expect(Renderer.item.getType("armor", {isIgnoreMissing: true})).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("enhanceItem does not throw when an item references an unregistered type", () => {
		const item = {
			name: "Homebrew Armor",
			source: "HB",
			type: "armor|someHomebrew",
			entries: ["SENTINEL armor entry."],
		};

		expect(() => Renderer.item.enhanceItem(item, {styleHint: "classic"})).not.toThrow();
		expect(item._isEnhanced).toBe(true);
		const merged = JSON.stringify(item._fullEntries || item.entries);
		expect(merged).toContain("SENTINEL armor entry.");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("armor"),
			expect.objectContaining({
				origin: "unknown",
				owner: {prop: "item", name: "Homebrew Armor", source: "HB"},
				fieldPath: "type",
			}),
		);
		expect(toastSpy).not.toHaveBeenCalled();
	});
});
