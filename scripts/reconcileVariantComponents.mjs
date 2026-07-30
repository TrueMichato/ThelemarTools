import fs from "fs";
import path from "path";

/**
 * Reconciles a supplied variant-component table (CSV) against the converted Arcadia 8 file.
 *
 * The table is largely a re-export of Arcadia 8, but writes component names with possessives
 * ("Glabrezu's Horn") where the converted file does not ("Glabrezu Horn"). Matching naively would
 * silently duplicate ~40 components, so everything here keys off a possessive-stripped, case-folded
 * name.
 *
 * Usage:
 *   node scripts/reconcileVariantComponents.mjs <table.csv> [--json <out.json>]
 */

const AR8_PATH = "data/items-variant-components-ar8.json";

/* -------------------------------------------- */
/* CSV                                          */
/* -------------------------------------------- */

/** Minimal RFC-4180 parser — the table contains quoted fields with embedded newlines and commas. */
function parseCsv (text) {
	const rows = [];
	let row = [];
	let field = "";
	let isQuoted = false;

	for (let i = 0; i < text.length; ++i) {
		const ch = text[i];

		if (isQuoted) {
			if (ch !== `"`) { field += ch; continue; }
			if (text[i + 1] === `"`) { field += `"`; ++i; continue; }
			isQuoted = false;
			continue;
		}

		switch (ch) {
			case `"`: isQuoted = true; break;
			case ",": row.push(field); field = ""; break;
			case "\r": break;
			case "\n": row.push(field); rows.push(row); row = []; field = ""; break;
			default: field += ch;
		}
	}

	if (field.length || row.length) { row.push(field); rows.push(row); }
	return rows;
}

/* -------------------------------------------- */
/* Cleaning                                     */
/* -------------------------------------------- */

/** Repairs introduced by the export: double-encoded UTF-8, smart punctuation, a reversed spell name. */
const TEXT_REPAIRS = [
	[/Ã—/g, "\u00d7"],
	[/Ã©/g, "\u00e9"],
	[/Â/g, ""],
	[/[\u2018\u2019]/g, "'"],
	[/[\u201c\u201d]/g, `"`],
	[/\u2013/g, "-"],
	[/\u2014/g, "\u2014"],
	// "it's area of effect" — possessive, not a contraction
	[/\bit's (area|damage|range|duration|maximum|effects?)\b/g, "its $1"],
];

const cleanText = (str) => TEXT_REPAIRS
	.reduce((acc, [re, to]) => acc.replace(re, to), `${str ?? ""}`)
	.replace(/\s+/g, " ")
	.trim();

/** "Arcane MIrage" is Mirage Arcane, reversed and typo'd. */
const SPELL_REPAIRS = {
	"arcane mirage": "Mirage Arcane",
	"black tentacles": "Evard's Black Tentacles",
	"hunter's mark": "Hunter's Mark",
};

const cleanSpell = (str) => {
	const clean = cleanText(str);
	return SPELL_REPAIRS[clean.toLowerCase()] ?? clean;
};

/**
 * Several "Spell" cells are not spell names but match *descriptors* — the table writes
 * "A Spell That Deals Psychic Damage" where the converted data uses
 * `match: {damageType: "psychic"}`. Resolve those to the same shape so they can be compared.
 *
 * @returns {?{damageType?: string, spellTag?: string, any?: boolean}}
 */
function toMatchDescriptor (spell) {
	const s = cleanText(spell).toLowerCase();
	if (!/^(a |any |the )?(spell|damaging spell)\b|^spell that\b/.test(s)) return null;

	if (/^any (damaging )?spell$/.test(s)) return {any: true};

	const mDamage = /deals? ([a-z]+) damage/.exec(s);
	if (mDamage) return {damageType: mDamage[1]};

	if (/restore hit points|regains? hit points/.test(s)) return {spellTag: "healing"};
	if (/become charmed|charm/.test(s)) return {spellTag: "charm"};
	if (/deals? damage/.test(s)) return {any: true};

	return {any: true};
}

/**
 * Rows often qualify a real spell with a targeting rider — "Invisibility On Only Yourself",
 * "Regenerate On Yourself", "Enlarge/Reduce On A Small, Medium, Large, Or Huge Creature". The
 * spell is everything before the rider.
 */
const stripSpellRider = (spell) => cleanText(spell)
	.replace(/\s+on\s+(only\s+)?(yourself|a\b.*|an\b.*|the\b.*)$/i, "")
	.trim();

/**
 * Match key: case-folded, possessive-stripped, punctuation-normalised.
 * "Glabrezu's Horn" and "Glabrezu Horn" must collide; "Will-o'-Wisp's Wisp" must survive its
 * internal apostrophe, so only *trailing* possessives are stripped from each word.
 */
export const toMatchKey = (name) => cleanText(name)
	.toLowerCase()
	.replace(/(\w)'s\b/g, "$1")
	.replace(/(\w)s'\b/g, "$1s")
	.replace(/[^a-z0-9]+/g, " ")
	.trim();

/** Words that carry no identity — the two sources disagree on them freely. */
const NOISE_WORDS = new Set(["of", "the", "a", "an", "breath", "from", "piece", "pieces", "gland"]);

const singularise = (word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

/**
 * Order- and plurality-insensitive key. The sources invert word order freely — the table writes
 * "Mindkiller's Piece of Brain" where Arcadia 8 writes "Piece of Mindkiller Brain" — and disagree
 * on plurals ("Virtue's Vocal Cords" vs "Virtue Vocal Cord").
 */
const toBagKey = (name) => toMatchKey(name)
	.split(" ")
	.map(singularise)
	.filter(w => w && !NOISE_WORDS.has(w))
	.sort()
	.join(" ");

/** Age qualifiers Arcadia 8 expands into separate items, which the table sometimes inlines. */
const AGE_WORDS = ["wyrmling", "young", "adult", "ancient"];

/** Strip a parenthetical or a leading "Adult or Ancient " so tiered families collapse to one stem. */
const toStemKey = (name) => {
	const base = cleanText(name).replace(/\s*\(.*?\)\s*/g, " ");
	const words = toMatchKey(base).split(" ").filter(w => w && !AGE_WORDS.includes(w) && w !== "or");
	return words.map(singularise).filter(w => w && !NOISE_WORDS.has(w)).sort().join(" ");
};

/* -------------------------------------------- */
/* Junk detection                               */
/* -------------------------------------------- */

/**
 * Rows the export produced that cannot be imported as-is. Each is reported rather than silently
 * dropped, so the reconciliation stays auditable.
 */
function classifyJunk (rec) {
	if (!rec.component) return "no component name";
	// A bare single letter is a truncated component name, not a component
	if (rec.component.length <= 1) return `truncated component name "${rec.component}"`;
	if (!rec.spell && !rec.effect) return "no spell and no effect (spreadsheet fill-down)";
	if (!rec.spell) return "no spell";
	if (!rec.effect) return "no effect";
	return null;
}

/* -------------------------------------------- */
/* Main                                         */
/* -------------------------------------------- */

function loadAr8Index () {
	const data = JSON.parse(fs.readFileSync(AR8_PATH, "utf-8"));
	const items = (data.item || []).filter(it => it.variantComponent);

	const byKey = new Map();
	const byBag = new Map();
	const byStem = new Map();

	const add = (map, key, item) => {
		if (!key) return;
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(item);
	};

	for (const item of items) {
		add(byKey, toMatchKey(item.name), item);
		add(byBag, toBagKey(item.name), item);
		add(byStem, toStemKey(item.name), item);
	}

	return {items, byKey, byBag, byStem};
}

/** What an Arcadia 8 component already matches on, for detecting genuinely new effects. */
function getCoverage (item) {
	const spells = new Set();
	const damageTypes = new Set();
	const tags = new Set();
	let isAny = false;

	for (const se of item.variantComponent?.spellEffects || []) {
		if (se.match?.spell) spells.add(se.match.spell.split("|")[0].toLowerCase());
		if (se.match?.damageType) damageTypes.add(se.match.damageType.toLowerCase());
		if (se.match?.spellTag) tags.add(se.match.spellTag.toLowerCase());
		if (se.match?.any) isAny = true;
	}

	return {spells, damageTypes, tags, isAny};
}

/** Does this Arcadia 8 component already cover what the table row describes? */
function isCovered (rec, items) {
	const descriptor = toMatchDescriptor(rec.spell);
	const spellName = stripSpellRider(rec.spell).toLowerCase();

	return items.some(item => {
		const cov = getCoverage(item);
		if (cov.isAny) return true;

		if (descriptor) {
			if (descriptor.any) return cov.isAny;
			if (descriptor.damageType) return cov.damageTypes.has(descriptor.damageType);
			if (descriptor.spellTag) return cov.tags.has(descriptor.spellTag) || cov.damageTypes.size > 0 || cov.tags.size > 0;
			return false;
		}

		return cov.spells.has(spellName) || [...cov.spells].some(sp => sp.includes(spellName) || spellName.includes(sp));
	});
}

/**
 * Resolve a table row to its Arcadia 8 counterpart, most precise first:
 * exact name → order/plurality-insensitive → age-tier stem.
 */
function resolveAr8 (component, index) {
	const exact = index.byKey.get(toMatchKey(component));
	if (exact) return {items: exact, how: "exact"};

	const bag = index.byBag.get(toBagKey(component));
	if (bag) return {items: bag, how: "reordered"};

	const stem = index.byStem.get(toStemKey(component));
	if (stem) return {items: stem, how: "tiered"};

	return null;
}

function main () {
	const [csvPath, ...rest] = process.argv.slice(2);
	if (!csvPath) {
		// eslint-disable-next-line no-console
		console.error(`Usage: node scripts/reconcileVariantComponents.mjs <table.csv> [--json <out.json>]`);
		process.exit(1);
	}

	const ixJson = rest.indexOf("--json");
	const jsonOut = ~ixJson ? rest[ixJson + 1] : null;

	const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
	const [header, ...body] = rows;

	const ixOf = (label) => header.findIndex(h => cleanText(h).toLowerCase() === label);
	const ixComponent = ixOf("component");
	const ixValue = ixOf("gold value");
	const ixSpell = ixOf("spell");
	const ixEffect = ixOf("effect");
	const ixExtra = ixOf("extra info");

	const ar8 = loadAr8Index();

	const records = [];
	const junk = [];
	const seen = new Set();
	let nDuplicates = 0;

	for (const row of body) {
		if (!row.some(cell => cleanText(cell))) continue;

		const rec = {
			component: cleanText(row[ixComponent]),
			valueGp: Number(cleanText(row[ixValue]).replace(/,/g, "")) || null,
			spell: cleanSpell(row[ixSpell]),
			effect: cleanText(row[ixEffect]),
			extra: cleanText(row[ixExtra]),
		};

		const reason = classifyJunk(rec);
		if (reason) { junk.push({...rec, reason}); continue; }

		// Byte-identical repeats (the export duplicated the Dragon Glands / Breath Weapon pair)
		const dupeKey = `${toMatchKey(rec.component)}::${rec.spell.toLowerCase()}::${rec.effect}`;
		if (seen.has(dupeKey)) { ++nDuplicates; continue; }
		seen.add(dupeKey);

		const resolved = resolveAr8(rec.component, ar8);
		rec.ar8Names = resolved ? resolved.items.map(it => it.name) : null;
		rec.matchHow = resolved?.how ?? null;

		// An existing component gaining a spell it doesn't yet cover is an *edit*, not a new item
		if (resolved) rec.isNewEffect = !isCovered(rec, resolved.items);

		records.push(rec);
	}

	/* ----- Report ----- */

	const matched = records.filter(r => r.ar8Names && !r.isNewEffect);
	const newEffects = records.filter(r => r.ar8Names && r.isNewEffect);
	const novel = records.filter(r => !r.ar8Names);
	const priced = records.filter(r => r.valueGp != null);

	const byComponent = (recs) => [...new Set(recs.map(r => r.component))].sort();

	// eslint-disable-next-line no-console
	const log = console.log;

	log(`\nVariant component reconciliation\n${"=".repeat(34)}`);
	log(`  Rows parsed                    ${body.length}`);
	log(`  Usable records                 ${records.length}`);
	log(`  Dropped as junk                ${junk.length}`);
	log(`  Dropped as duplicates          ${nDuplicates}`);
	log(`\n  Already in Arcadia 8           ${matched.length} rows / ${byComponent(matched).length} components`);
	log(`  New effect on an Ar8 component ${newEffects.length} rows / ${byComponent(newEffects).length} components`);
	log(`  Not in Arcadia 8 at all        ${novel.length} rows / ${byComponent(novel).length} components`);
	log(`  Carry a gold value             ${priced.length} rows / ${byComponent(priced).length} components`);

	const nReordered = records.filter(r => r.matchHow === "reordered").length;
	const nTiered = records.filter(r => r.matchHow === "tiered").length;
	log(`\n  Matched only after reordering  ${nReordered} rows (would have duplicated)`);
	log(`  Matched via an age-tier stem   ${nTiered} rows`);

	log(`\n--- Dropped rows ---`);
	junk.forEach(j => log(`  \u2022 ${j.reason}${j.component ? ` \u2014 "${j.component}"` : ""}${j.spell ? ` / ${j.spell}` : ""}`));

	log(`\n--- Gold values (merge into ${AR8_PATH}) ---`);
	const valueByComponent = new Map();
	priced.forEach(r => { if (!valueByComponent.has(r.component)) valueByComponent.set(r.component, r); });
	[...valueByComponent.values()]
		.sort((a, b) => a.valueGp - b.valueGp)
		.forEach(r => {
			const where = r.ar8Names ? `Ar8: ${r.ar8Names.join(", ")}` : "NEW \u2014 author in TGTT";
			log(`  ${`${r.valueGp} gp`.padStart(10)}  ${r.component.padEnd(34)} ${where}`);
		});

	log(`\n--- New effects on existing Arcadia 8 components (merge into their spellEffects) ---`);
	newEffects.forEach(r => log(`  \u2022 ${r.component.padEnd(38)} \u2192 ${r.spell}   [${r.ar8Names.join(", ")}]`));

	log(`\n--- Components not in Arcadia 8 (author in TGTT) ---`);
	byComponent(novel).forEach(name => {
		const spells = novel.filter(r => r.component === name).map(r => r.spell);
		log(`  \u2022 ${name.padEnd(38)} \u2192 ${spells.join(", ")}`);
	});

	log("");

	if (jsonOut) {
		fs.mkdirSync(path.dirname(jsonOut), {recursive: true});
		fs.writeFileSync(jsonOut, `${JSON.stringify({records, junk, nDuplicates}, null, "\t")}\n`, "utf-8");
		log(`Wrote ${jsonOut}\n`);
	}
}

main();
