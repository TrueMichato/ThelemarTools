import fs from "fs";
import * as ut from "../util.js";

/**
 * Resolves creature names found in harvest tables against the bestiary, so materials can be
 * filtered by creature type and CR.
 *
 * Sources are ranked so the "canonical" printing wins when a creature appears in several books.
 */

const SOURCE_PRIORITY = ["MM", "XMM", "MPMM", "VGM", "MTF", "FTD", "TCE", "DMG", "XDMG"];

/** Creature names in the handbooks that don't match a bestiary entry verbatim. */
const NAME_ALIASES = {
	"hooked horror": "hook horror",
	"alpha grick": "grick alpha",
	"galeb-duhr": "galeb duhr",
	"will-o-wisp": "will-o'-wisp",
	"drow favoured consort": "drow favored consort",
	"firenewt warlock": "firenewt warlock of imix",
	"succubus/incubus": "succubus",
	"lizardfolk king queen": "lizardfolk sovereign",
	"gnome, deep": "deep gnome (svirfneblin)",
	"deep gnome": "deep gnome (svirfneblin)",
	"dragon, shadow": "shadow dragon",
	"half dragon": "half-red dragon veteran",
	"half-ogre": "half-ogre (ogrillon)",
	"yuan-ti malison": "yuan-ti malison (type 1)",
	"ochre residue": "ochre jelly",
	"displacer beast kitten": "displacer beast",
};

/** Age/size qualifiers that can be dropped as a last resort, e.g. "Ancient Dracolich" → "Dracolich". */
const QUALIFIER_PREFIXES = ["adult", "ancient", "young", "elder", "greater", "lesser", "alpha", "wyrmling"];

/**
 * Names that describe a category rather than a specific stat block. Resolving these would be
 * misleading, so they are skipped and reported separately from genuine misses.
 */
const GENERIC_NAMES = new Set([
	"devil", "demon", "mephit", "fiend", "fiend generic", "lycanthropes", "lycanthrope",
	"wyrmling", "dragon", "elemental", "golem", "hag", "sphinx",
	"adult dragon", "ancient dragon", "young dragon", "gemstone dragon", "faerie dragon",
]);

/** Parenthetical qualifiers that mark a whole class of creatures rather than one stat block. */
const GENERIC_PATTERN = /\((?:any|cr[\s\d]|generic)/i;

const _stripTags = (name) => `${name}`.replace(/\{@[a-z]+ ([^}|]+)(\|[^}]*)?\}/gi, "$1");

const _normalise = (name) => `${name}`
	.toLowerCase()
	.replace(/[\u2019\u2018]/g, "'")
	.replace(/[^a-z0-9' /,()-]/g, " ")
	.replace(/\s+/g, " ")
	.trim();

const _key = (name) => `${name}`
	.toLowerCase()
	.replace(/[\u2019\u2018]/g, "'")
	.replace(/[^a-z0-9' -]/g, " ")
	.replace(/\s+/g, " ")
	.trim();

/**
 * Generate the plausible bestiary spellings of a handbook creature name, most specific first.
 *
 * The handbooks use several naming conventions the bestiary does not:
 *   `"Brass Dragon (Adult)"` → `"Adult Brass Dragon"`
 *   `"Naga, Bone"`           → `"Bone Naga"`
 *   `"Drow Favoured Consort"` → `"Drow Favored Consort"`
 */
function _getCandidates (rawName) {
	const base = _normalise(_stripTags(rawName));
	const out = [base];

	// "Brass Dragon (Adult)" → "adult brass dragon", and the bare "brass dragon"
	const mParen = /^(.*?)\s*\((.+?)\)\s*$/.exec(base);
	if (mParen) {
		out.push(`${mParen[2]} ${mParen[1]}`.trim());
		out.push(mParen[1].trim());
	}

	// "Naga, Bone" → "bone naga"
	const mComma = /^([^,]+),\s*(.+)$/.exec(base);
	if (mComma) out.push(`${mComma[2]} ${mComma[1]}`.trim());

	// "Succubus/Incubus" → each half
	if (base.includes("/")) out.push(...base.split("/").map(it => it.trim()));

	// en-GB → en-US
	const usSpelling = base
		.replace(/\bfavoured\b/g, "favored")
		.replace(/\barmour\b/g, "armor")
		.replace(/\bcolour/g, "color")
		.replace(/\bgrey\b/g, "gray");
	if (usSpelling !== base) out.push(usSpelling);

	// Hyphens are inconsistent across books
	if (base.includes("-")) out.push(base.replace(/-/g, " "));
	if (base.includes(" ")) out.push(base.replace(/ /g, "-"));

	// Trailing plural
	if (base.endsWith("s")) out.push(base.slice(0, -1));

	// Last resort: drop an age/size qualifier, e.g. "ancient dracolich" → "dracolich"
	for (const candidate of [...out]) {
		const words = candidate.split(" ");
		if (words.length > 1 && QUALIFIER_PREFIXES.includes(words[0])) out.push(words.slice(1).join(" "));
	}

	return [...new Set(out.map(_key))].filter(Boolean);
}

const _getCr = (mon) => {
	const cr = mon.cr;
	if (cr == null) return null;
	if (typeof cr === "number") return cr;
	if (typeof cr === "object") return _crStringToNumber(cr.cr);
	return _crStringToNumber(cr);
};

const _crStringToNumber = (cr) => {
	if (cr == null) return null;
	if (typeof cr === "number") return cr;
	const text = `${cr}`.trim();
	if (text === "Unknown") return null;
	if (text.includes("/")) {
		const [num, den] = text.split("/").map(Number);
		return den ? num / den : null;
	}
	const num = Number(text);
	return isFinite(num) ? num : null;
};

const _getCreatureType = (mon) => {
	const type = mon.type;
	if (type == null) return null;
	if (typeof type === "string") return type.toLowerCase();
	if (typeof type === "object") {
		if (typeof type.type === "string") return type.type.toLowerCase();
		if (typeof type.type === "object" && type.type.choose?.length) return `${type.type.choose[0]}`.toLowerCase();
	}
	return null;
};

/**
 * @returns {(name: string) => ({name: string, source: string, creatureType: ?string, cr: ?number}|null)}
 */
export function buildCreatureResolver () {
	const index = ut.readJson("./data/bestiary/index.json");
	/** @type {Map<string, object[]>} */
	const byName = new Map();

	for (const [source, filename] of Object.entries(index)) {
		const filePath = `./data/bestiary/${filename}`;
		if (!fs.existsSync(filePath)) continue;

		let data;
		try {
			data = ut.readJson(filePath);
		} catch (e) {
			continue;
		}

		for (const mon of data.monster || []) {
			if (!mon.name) continue;
			const key = _key(mon.name);
			const entry = {
				name: mon.name,
				source: mon.source || source,
				creatureType: _getCreatureType(mon),
				cr: _getCr(mon),
			};
			if (!byName.has(key)) byName.set(key, []);
			byName.get(key).push(entry);
		}
	}

	const pick = (candidates) => {
		if (!candidates?.length) return null;
		const sorted = [...candidates].sort((a, b) => {
			const ixA = SOURCE_PRIORITY.indexOf(a.source);
			const ixB = SOURCE_PRIORITY.indexOf(b.source);
			return (~ixA ? ixA : Number.MAX_SAFE_INTEGER) - (~ixB ? ixB : Number.MAX_SAFE_INTEGER);
		});
		// Prefer a printing that actually carries type/CR metadata (`_copy` stubs often don't)
		return sorted.find(it => it.creatureType && it.cr != null) || sorted[0];
	};

	const cache = new Map();

	const resolve = (rawName) => {
		if (!rawName) return null;
		if (cache.has(rawName)) return cache.get(rawName);

		const candidates = _getCandidates(rawName);
		if (GENERIC_PATTERN.test(`${rawName}`)) {
			cache.set(rawName, null);
			return null;
		}

		let resolved = null;
		for (const candidate of candidates) {
			if (GENERIC_NAMES.has(candidate)) break;

			resolved = pick(byName.get(candidate));
			if (resolved) break;

			const alias = NAME_ALIASES[candidate];
			if (alias) {
				resolved = pick(byName.get(_key(alias)));
				if (resolved) break;
			}
		}

		cache.set(rawName, resolved || null);
		return resolved || null;
	};

	/** `true` when the name describes a category rather than a specific stat block. */
	resolve.isGeneric = (rawName) => GENERIC_PATTERN.test(`${rawName}`) || _getCandidates(rawName).some(candidate => GENERIC_NAMES.has(candidate));

	return resolve;
}

/**
 * Build the `harvest.creature` block, keeping the handbook's own wording as `label` whenever it
 * differs from the bestiary spelling (e.g. "Brass Dragon (Adult)" → "Adult Brass Dragon").
 */
export function toCreatureRef (rawName, resolved) {
	if (!rawName) return null;
	const name = resolved?.name ?? rawName;
	return {
		name,
		source: resolved?.source ?? null,
		...(name !== rawName ? {label: rawName} : {}),
	};
}
