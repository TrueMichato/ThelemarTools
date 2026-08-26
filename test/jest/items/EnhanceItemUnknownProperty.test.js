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
		BrewDiagnostics.setConsoleVerbose(true);
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		toastSpy = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	});

	afterEach(() => {
		BrewDiagnostics.setConsoleVerbose(false);
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
		BrewDiagnostics.setConsoleVerbose(true);
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		toastSpy = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	});

	afterEach(() => {
		BrewDiagnostics.setConsoleVerbose(false);
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

	// Regression: `enhanceItem` internally builds the item's type display text via
	// `getRenderableTypeEntriesMeta` -> `getItemTypeName`, which used to re-report the missing type
	// WITHOUT owner context -- producing a second, context-less duplicate record that surfaced as a
	// noisy "(Unknown document)" row in the Homebrew Issues finder. The display-name lookup must now
	// stay silent, leaving exactly one fully-attributed record.
	it("emits exactly one attributed missing-type record for an enhanced item (no context-less duplicate)", () => {
		const item = {name: "Ghost Blade", source: "HB", type: "PHANTOMTYPE|hb", entries: []};

		Renderer.item.enhanceItem(item, {styleHint: "classic", diagnosticContext: {origin: "brew", filename: "ghosts.json"}});

		const typeRecords = BrewDiagnostics.getRecords().filter(r => r.code === "item.missingType");
		expect(typeRecords).toHaveLength(1);
		expect(typeRecords[0].owner).toEqual({prop: "item", name: "Ghost Blade", source: "HB"});
		// No context-less (null-owner) duplicate.
		expect(typeRecords.some(r => !r.owner?.name)).toBe(false);
	});

	it("emits exactly one attributed missing-property record for an enhanced item (no context-less duplicate from display text)", () => {
		const item = {name: "Ghost Wand", source: "HB", property: ["PHANTOMPROP"], entries: []};

		Renderer.item.enhanceItem(item, {styleHint: "classic", diagnosticContext: {origin: "brew", filename: "ghosts.json"}});
		// Render the property display text (the path that used to double-report without context).
		Renderer.item._getPropertyText({item, property: "PHANTOMPROP", valsUsed: {}, renderer: Renderer.get()});

		const propRecords = BrewDiagnostics.getRecords().filter(r => r.code === "item.missingProperty");
		expect(propRecords).toHaveLength(1);
		expect(propRecords[0].owner).toEqual({prop: "item", name: "Ghost Wand", source: "HB"});
		expect(propRecords.some(r => !r.owner?.name)).toBe(false);
	});
});
