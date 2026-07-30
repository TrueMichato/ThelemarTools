import fs from "fs";
import path from "path";

/**
 * Locates and loads the homebrew source books the crafting generator depends on.
 *
 * Remote books are resolved from `homebrew/index.json` so the generated data always matches
 * what the running site actually imports. Downloads are cached under a gitignored `.cache/`
 * directory so repeat runs (and offline runs) are cheap.
 */

const CACHE_DIR = path.join(".cache", "crafting");

/**
 * Each source book the crafting hub draws from.
 *
 * `match` is tested against the entries in `homebrew/index.json`; `local` short-circuits the
 * lookup for books that live in this repo.
 */
export const CRAFTING_SOURCE_BOOKS = [
	{key: "hamundI", sourceJson: "HHHVI", match: "Hamund's%20Harvesting%20Handbook%20I.json"},
	{key: "hamundII", sourceJson: "HHHVII", match: "Hamund's%20Harvesting%20Handbook%20II.json"},
	{key: "hamundIII", sourceJson: "HHHVIII", match: "Hamund's%20Harvesting%20Handbook%20III.json"},
	{key: "herbalism", sourceJson: "HHbH", match: "Hamund's%20Herbalism%20Handbook.json"},
	{key: "arcadia8", sourceJson: "Ar8", match: "Arcadia%20Issue%208.json"},
	{key: "arcadia11", sourceJson: "Arcadia11", match: "Arcadia%20Issue%2011.json"},
	{key: "completeCrafter", sourceJson: "COMCRAF", local: "homebrew/complete_crafter.json"},
	{key: "thelemar", sourceJson: "TGTT", local: "homebrew/TravelersGuidetoThelemar.json"},
];

class CraftingSourceLoadError extends Error {}

const _readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf-8"));

const _getBrewIndexUrls = () => {
	const index = _readJson("homebrew/index.json");
	return index.toImport.filter(it => typeof it === "string" && it.startsWith("http"));
};

const _getCachePath = (key) => path.join(CACHE_DIR, `${key}.json`);

const _pDownload = async (url, cachePath) => {
	const resp = await fetch(url);
	if (!resp.ok) throw new CraftingSourceLoadError(`Failed to download "${url}" \u2014 HTTP ${resp.status} ${resp.statusText}`);
	const text = await resp.text();
	// Parse before writing, so a truncated/HTML error response never poisons the cache
	const json = JSON.parse(text);
	fs.mkdirSync(path.dirname(cachePath), {recursive: true});
	fs.writeFileSync(cachePath, text, "utf-8");
	return json;
};

/**
 * @param {object} [opts]
 * @param {boolean} [opts.isRefresh] Re-download even if a cached copy exists.
 * @param {boolean} [opts.isOffline] Never hit the network; fail if a book is not cached.
 * @returns {Promise<Record<string, object>>} Keyed by `CRAFTING_SOURCE_BOOKS[].key`.
 */
export async function pLoadCraftingSourceBooks ({isRefresh = false, isOffline = false} = {}) {
	const urls = _getBrewIndexUrls();
	const out = {};
	const errors = [];

	for (const book of CRAFTING_SOURCE_BOOKS) {
		try {
			if (book.local) {
				if (!fs.existsSync(book.local)) throw new CraftingSourceLoadError(`Expected local source book at "${book.local}", but it does not exist`);
				out[book.key] = _readJson(book.local);
				continue;
			}

			const cachePath = _getCachePath(book.key);
			const hasCache = fs.existsSync(cachePath);

			if (hasCache && (isOffline || !isRefresh)) {
				out[book.key] = _readJson(cachePath);
				continue;
			}

			if (isOffline) throw new CraftingSourceLoadError(`No cached copy at "${cachePath}" and running in offline mode`);

			const url = urls.find(it => it.endsWith(book.match));
			if (!url) throw new CraftingSourceLoadError(`Could not find an entry ending in "${book.match}" in homebrew/index.json`);

			out[book.key] = await _pDownload(url, cachePath);
		} catch (e) {
			errors.push(`  \u2022 ${book.key} (${book.sourceJson}): ${e.message}`);
		}
	}

	if (errors.length) throw new CraftingSourceLoadError(`Could not load ${errors.length} crafting source book(s):\n${errors.join("\n")}`);

	// Sanity-check that each book actually contains the source we expect
	const mismatches = CRAFTING_SOURCE_BOOKS
		.filter(book => !(out[book.key]?._meta?.sources || []).some(src => src.json === book.sourceJson))
		.map(book => `  \u2022 ${book.key}: expected _meta.sources to contain "${book.sourceJson}"`);
	if (mismatches.length) throw new CraftingSourceLoadError(`Crafting source book shape changed:\n${mismatches.join("\n")}`);

	return out;
}

/** The already-structured Arcadia 8 variant components, which the character sheet also consumes. */
export function getVariantComponents () {
	return _readJson("data/items-variant-components-ar8.json");
}

/** Hand-curated effect-tag corrections, keyed by `name|source`. */
export function getEffectTagOverrides () {
	const filePath = "data/crafting-effect-overrides.json";
	if (!fs.existsSync(filePath)) return {};
	return _readJson(filePath).overrides || {};
}
