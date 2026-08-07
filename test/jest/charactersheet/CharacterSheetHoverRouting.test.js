/**
 * Bug 12 regression — Hover routing for class/subclass features and
 * subclass links must resolve to the CANONICAL classSource, not the
 * homebrew copy source. For TGTT Wizard + Chronurgy Magic the Wizard
 * data lives at source=TGTT but the underlying Chronurgy subclass
 * features all carry classSource="PHB" — using the storedClass.source
 * leak produces unresolvable hashes like
 * `chronal%20shift_wizard_tgtt_chronurgy_egw_2_egw`.
 */
import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("resolveSubclassHoverSources (Bug 12)", () => {
	test("prefers explicit classSource on the subclass entry", () => {
		const subclass = {
			name: "Chronurgy Magic",
			source: "EGW",
			className: "Wizard",
			classSource: "PHB",
			shortName: "Chronurgy",
		};
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(subclass, []);
		expect(out.classSource).toBe("PHB");
		expect(out.source).toBe("EGW");
		expect(out.className).toBe("Wizard");
		expect(out.shortName).toBe("Chronurgy");
	});

	test("looks up classSource from loaded subclass data when stored subclass is missing it", () => {
		const storedSubclass = {name: "Chronurgy Magic", source: "EGW"};
		const loadedSubclasses = [
			{name: "School of Abjuration", source: "PHB", className: "Wizard", classSource: "PHB", shortName: "Abjuration"},
			{name: "Chronurgy Magic", source: "EGW", className: "Wizard", classSource: "PHB", shortName: "Chronurgy"},
		];
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, loadedSubclasses);
		expect(out.classSource).toBe("PHB");
		expect(out.shortName).toBe("Chronurgy");
		expect(out.className).toBe("Wizard");
	});

	test("does NOT leak storedClass.source (TGTT) into classSource when canonical data is available", () => {
		const storedSubclass = {name: "Chronurgy Magic", source: "EGW"};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const loadedSubclasses = [
			{name: "Chronurgy Magic", source: "EGW", className: "Wizard", classSource: "PHB", shortName: "Chronurgy"},
		];
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, loadedSubclasses, storedClass);
		// The hover hash uses classSource — must be the CANONICAL "PHB", not "TGTT".
		expect(out.classSource).toBe("PHB");
	});

	test("falls back to storedClass.source only when nothing better is known", () => {
		const storedSubclass = {name: "Bespoke Mystery", source: "BREW"};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, [], storedClass);
		expect(out.classSource).toBe("TGTT");
		expect(out.source).toBe("BREW");
	});

	test("falls back to PHB when no class info at all", () => {
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources({name: "Mystery", source: "X"}, []);
		expect(out.classSource).toBe("PHB");
	});
});

describe("resolveFeatureHoverSources for subclass features (Bug 12)", () => {
	test("respects explicit feature.classSource (canonical) even when storedClass is homebrew", () => {
		// Chronal Shift in canonical data has classSource="PHB"
		const feature = {
			name: "Chronal Shift",
			className: "Wizard",
			classSource: "PHB",
			source: "EGW",
			subclassName: "Chronurgy Magic",
			subclassSource: "EGW",
			featureType: "Class",
			level: 2,
		};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const out = CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedClass);
		expect(out.classSource).toBe("PHB");
		expect(out.featureSource).toBe("EGW");
	});
});

describe("item hover routing", () => {
	test("Overview auto-attacks retain the source item and use the shared item hover", () => {
		const source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		expect(source).toMatch(/sourceItem:\s*weapon/);
		expect(source).toMatch(/buildItemHoverNameHtml\(attack\.sourceItem \|\| attack\)/);
		expect(source).not.toMatch(/getHoverElementAttributes\(\{page:\s*UrlUtil\.PG_ITEMS/);
	});

	test("all inventory and combat item-name surfaces use the shared item helper", () => {
		for (const file of [
			"js/charactersheet/charactersheet-inventory.js",
			"js/charactersheet/charactersheet-combat.js",
		]) {
			const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
			expect(source).toContain("CharacterSheetClassUtils.buildItemHoverNameHtml");
			expect(source).not.toMatch(/getHoverLink\(UrlUtil\.PG_ITEMS/);
		}
	});

	test("the central normalization hook routes the original hover through the rejection safety helper", () => {
		const source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		expect(source).toMatch(/pCallHoverHandlerSafely\(orig, evt, ele, opts\)/);
	});

	test("the hover safety helper swallows a rejected renderer lookup", async () => {
		const orig = jest.fn().mockRejectedValue(new Error("Failed to load renderable content"));
		await expect(CharacterSheetClassUtils.pCallHoverHandlerSafely(orig, "event", "element")).resolves.toBeUndefined();
		expect(orig).toHaveBeenCalledWith("event", "element");
	});
});
