/**
 * Round-5 #5 — Optional-feature / combat-method hover RESOLUTION via catalog
 * source canonicalization.
 *
 * A feature stored on the character can carry a stale or alias source (e.g.
 * "KaW") that differs from the loaded catalog's canonical source (e.g. "TGTT").
 * The hover then queries the DataLoader cache under the wrong source and throws
 * "Failed to load renderable content".
 *
 * `CharacterSheetClassUtils.resolveCatalogEntitySource` canonicalizes the source
 * (uniqueness-guarded) so the hover resolves. These tests register the catalog
 * with the REAL `DataLoader._pCache_addToCache` and assert that the production
 * hover hash (`encodeForHash([name, canonicalSource])`, as `getHoverLink` builds
 * it) resolves against the cache.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/hist.js";
import "../../../js/utils-dataloader.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const UrlUtil = globalThis.UrlUtil;
const DataLoader = globalThis.DataLoader;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const HASH_LIST_SEP = globalThis.HASH_LIST_SEP;

beforeAll(() => {
	globalThis.PrereleaseUtil = globalThis.PrereleaseUtil || {hasSourceJson: () => false, getCacheIteration: () => 0};
	globalThis.BrewUtil2 = globalThis.BrewUtil2 || {hasSourceJson: () => false, getCacheIteration: () => 0};
});

function register (prop, entities) {
	DataLoader._pCache_addToCache({allDataMerged: {[prop]: entities}, propAllowlist: new Set([prop])});
}

/** Mirror `getHoverLink`'s hash construction for the canonicalized source. */
function productionHoverHash (name, source) {
	return UrlUtil.encodeForHash([name, source].join(HASH_LIST_SEP));
}

describe("resolveCatalogEntitySource — uniqueness-guarded canonicalization", () => {
	const catalog = [
		{name: "Iron Will", source: "TGTT", _entityType: "combatMethod"},
		{name: "Deflect Strike", source: "TGTT", _entityType: "combatMethod"},
	];

	test("exact name+source match keeps the stored source", () => {
		const out = CharacterSheetClassUtils.resolveCatalogEntitySource("Iron Will", "TGTT", catalog);
		expect(out).toEqual({source: "TGTT", isInCatalog: true});
	});

	test("single name-only match adopts the catalog source (KaW → TGTT)", () => {
		const out = CharacterSheetClassUtils.resolveCatalogEntitySource("Iron Will", "KaW", catalog);
		expect(out).toEqual({source: "TGTT", isInCatalog: true});
	});

	test("unknown name is reported as not-in-catalog with the source unchanged", () => {
		const out = CharacterSheetClassUtils.resolveCatalogEntitySource("Mystery Move", "KaW", catalog);
		expect(out).toEqual({source: "KaW", isInCatalog: false});
	});

	test("ambiguous same-name entries (no source match) leave the source unchanged", () => {
		const ambiguous = [
			{name: "Parry", source: "TGTT"},
			{name: "Parry", source: "KaW"},
		];
		const out = CharacterSheetClassUtils.resolveCatalogEntitySource("Parry", "XYZ", ambiguous);
		expect(out).toEqual({source: "XYZ", isInCatalog: true});
	});

	test("case-insensitive name match", () => {
		const out = CharacterSheetClassUtils.resolveCatalogEntitySource("iron will", "KaW", catalog);
		expect(out).toEqual({source: "TGTT", isInCatalog: true});
	});

	test("empty / missing name is a safe no-op", () => {
		expect(CharacterSheetClassUtils.resolveCatalogEntitySource("", "TGTT", catalog)).toEqual({source: "TGTT", isInCatalog: false});
		expect(CharacterSheetClassUtils.resolveCatalogEntitySource(null, "TGTT", catalog)).toEqual({source: "TGTT", isInCatalog: false});
	});
});

describe("combat-method hover resolves after canonicalization", () => {
	const ironWill = {name: "Iron Will", source: "TGTT", _entityType: "combatMethod"};

	beforeAll(() => register("combatMethod", [ironWill]));

	test("stored alias source (KaW) canonicalizes and resolves under TGTT", () => {
		const {source: canonical, isInCatalog} = CharacterSheetClassUtils.resolveCatalogEntitySource("Iron Will", "KaW", [ironWill]);
		expect(isInCatalog).toBe(true);
		expect(canonical).toBe("TGTT");

		const hash = productionHoverHash("Iron Will", canonical);
		const resolved = DataLoader.getFromCache(UrlUtil.PG_COMBAT_METHODS, canonical, hash);
		expect(resolved).toBeTruthy();
		expect(resolved.name).toBe("Iron Will");
	});

	test("the un-canonicalized alias source MISSES (pins the bug)", () => {
		const hash = productionHoverHash("Iron Will", "KaW");
		const missed = DataLoader.getFromCache(UrlUtil.PG_COMBAT_METHODS, "KaW", hash);
		expect(missed).toBeFalsy();
	});
});

describe("optional-feature hover resolves after registration", () => {
	const staminaEnthusiast = {name: "Stamina Enthusiast", source: "TGTT"};

	beforeAll(() => register("optionalfeature", [staminaEnthusiast]));

	test("exact source resolves at the production hover hash", () => {
		const {source: canonical} = CharacterSheetClassUtils.resolveCatalogEntitySource("Stamina Enthusiast", "TGTT", [staminaEnthusiast]);
		const hash = productionHoverHash("Stamina Enthusiast", canonical);
		const resolved = DataLoader.getFromCache(UrlUtil.PG_OPT_FEATURES, canonical, hash);
		expect(resolved).toBeTruthy();
		expect(resolved.name).toBe("Stamina Enthusiast");
	});
});
