import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

/*
 * Two console-error regressions reported against a stale cached build and the
 * respec level-history renderer:
 *
 * 1) `getHoverLink` warning — a hover target is keyed by page + source + hash.
 *    When a caller (e.g. a level-history feature-choice pill in
 *    charactersheet-respec.js, whose `fc.source` can be undefined) passes no
 *    source, `Renderer.hover.getHoverElementAttributes` throws on `source.qq()`.
 *    The old code caught that and logged `[CharSheet] getHoverLink error` on
 *    EVERY render. The fix degrades to a plain, non-hover label BEFORE the
 *    attribute build, so nothing is thrown or logged and the visible output is
 *    unchanged.
 *
 * 2) `_mergeBrewData` crash — `this._draconicResonancesData is not iterable`.
 *    The homebrew-only brew catalogs are spread inside `_mergeBrewData`; they
 *    must be initialized before that runs. They are now also initialized in the
 *    constructor (not only in `_pLoadData`) so the spreads can never hit an
 *    undefined value regardless of call order.
 *
 * Source-pin style (matches CharacterSheetEffectiveModHover / FormatModEffective):
 * charactersheet.js is a ~20k-line browser module that is not unit-instantiable
 * here, so we pin the exact guards to the production source.
 */

const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

describe("getHoverLink degrades to plain text when no source is available", () => {
	const m = SOURCE.match(/static getHoverLink \([\s\S]*?\n\t\}/);

	test("the getHoverLink method is present", () => {
		expect(m).not.toBeNull();
	});

	test("guards a missing source and returns a plain label before building hover attributes", () => {
		const body = m[0];
		// The general `!source` guard must exist and return a plain escaped label...
		expect(body).toMatch(/if\s*\(\s*!source\s*\)/);
		expect(body).toMatch(/return\s+displayName\s*\|\|\s*CharacterSheetClassUtils\.escapeHtml\(name\);/);
		// ...and the guard must come BEFORE the attribute build that dereferences source.
		const idxGuard = body.indexOf("if (!source)");
		const idxAttrs = body.indexOf("Renderer.hover.getHoverElementAttributes(");
		expect(idxGuard).toBeGreaterThan(-1);
		expect(idxAttrs).toBeGreaterThan(-1);
		expect(idxGuard).toBeLessThan(idxAttrs);
	});
});

describe("homebrew-only brew catalogs are initialized in the constructor", () => {
	// Pin the constructor body (from `constructor (` up to the first `pInit (`).
	const ctor = SOURCE.slice(SOURCE.indexOf("constructor ("), SOURCE.indexOf("async pInit ("));

	test.each([
		"_itemMaterialsData",
		"_brewMonstersData",
		"_draconicResonancesData",
		"_divineFavorData",
	])("%s is initialized to [] before _pLoadData / _mergeBrewData runs", (field) => {
		expect(ctor).toMatch(new RegExp(`this\\.${field}\\s*=\\s*\\[\\];`));
	});
});
