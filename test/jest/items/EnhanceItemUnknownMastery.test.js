import fs from "node:fs";

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";

const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));
const ropeDart = brew.item.find(it => it.name === "Rope Dart" && it.source === "TGTT");

describe("Rope Dart mastery without the optional Grim Hollow brew", () => {
	beforeEach(() => BrewDiagnostics.clear());

	it("keeps the item usable and reports the missing mastery instead of linking a phantom rule", () => {
		const item = JSON.parse(JSON.stringify(ropeDart));
		expect(() => Renderer.item.enhanceItem(item, {
			styleHint: "classic",
			diagnosticContext: {origin: "brew", filename: "TravelersGuidetoThelemar.json"},
		})).not.toThrow();
		expect(item._isEnhanced).toBe(true);
		expect(JSON.stringify(item._fullEntries || item.entries)).toContain("All attacks with this weapon use its thrown property.");
		expect(BrewDiagnostics.getRecords().filter(it => it.target?.kind === "itemMastery")).toEqual([
			expect.objectContaining({
				code: BrewDiagnostics.CODES.REFERENCE_MISSING,
				severity: "warning",
				target: expect.objectContaining({kind: "itemMastery", uid: "Entangling|GrimHollowPG24"}),
				owner: {prop: "item", name: "Rope Dart", source: "TGTT"},
				fieldPath: "mastery[0]",
			}),
		]);
		const masteryHtml = Renderer.item.getRenderedMastery(item, {renderer: {render: text => text}});
		expect(masteryHtml).toContain("Entangling");
		expect(masteryHtml).toContain("Mastery definition unavailable");
		expect(masteryHtml).not.toContain("data-vet-page");
	});

	it("uses the real external UID for the mastery link when its definition is installed", () => {
		Renderer.item._addMastery({
			name: "Entangling",
			source: "GrimHollowPG24",
			entries: ["Test definition."],
		});
		const item = JSON.parse(JSON.stringify(ropeDart));
		Renderer.item.enhanceItem(item, {styleHint: "classic"});
		expect(BrewDiagnostics.getRecords().some(it => it.target?.kind === "itemMastery")).toBe(false);
		expect(JSON.stringify(item._fullEntries)).toContain("Mastery: Entangling");
		const masteryHtml = Renderer.item.getRenderedMastery(item, {renderer: {render: text => text}});
		expect(masteryHtml).toContain("Entangling");
		expect(masteryHtml).toContain("GrimHollowPG24");
		expect(masteryHtml).toContain("{@itemMastery Entangling|GrimHollowPG24}");
	});
});
