/*
 * Apply monster-group normalization (Phase A) and expansion (Phase B) to
 * every data/bestiary/*.json file in-place.
 *
 *   Phase A — rename inconsistent labels to canonical plural form:
 *     "Chromatic Dragon"      -> "Chromatic Dragons"
 *     "Metallic Dragon"       -> "Metallic Dragons"
 *     "Nymph"                 -> "Nymphs"
 *     "Incarnation of Nature" -> "Incarnations of Nature"
 *
 *   Phase B — add group tags to ungrouped monsters using name heuristics
 *   documented in NAME_PATTERN_TO_GROUP below. Skips existing group
 *   membership (idempotent).
 *
 * Usage:
 *   node node/apply-monster-groups.js            # apply + write
 *   node node/apply-monster-groups.js --dry-run  # report only
 */
import fs from "fs";
import path from "path";

const BESTIARY_DIR = "./data/bestiary";
const isDry = process.argv.includes("--dry-run");
// Phase gate — allow producing a "renames only" or "adds only" commit for
// review hygiene. Default runs both phases in one pass.
const phaseArg = process.argv.find(a => a.startsWith("--phase="));
const phase = phaseArg ? phaseArg.split("=")[1] : "all"; // "a" | "b" | "all"

// Match the repo's non-ASCII escaping convention (see js/utils.js
// `CleanUtil.STR_REPLACEMENTS`) so a rewrite doesn't churn every em-dash /
// en-dash / minus-sign / non-breaking-space back to literal Unicode.
const STR_REPLACEMENTS = {
	"\u2014": "\\u2014", // em-dash
	"\u2013": "\\u2013", // en-dash
	"\u2011": "\\u2011", // non-breaking hyphen
	"\u2212": "\\u2212", // minus sign
	"\u00A0": "\\u00A0", // NO-BREAK SPACE
	"\u2007": "\\u2007", // FIGURE SPACE
};
const STR_REPLACEMENTS_REGEX = new RegExp(Object.keys(STR_REPLACEMENTS).join("|"), "g");

function serializeJson (raw) {
	const str = `${JSON.stringify(raw, null, "\t")}\n`;
	return str.replace(STR_REPLACEMENTS_REGEX, (m) => STR_REPLACEMENTS[m]);
}

const RENAMES = new Map([
	["Chromatic Dragon", "Chromatic Dragons"],
	["Metallic Dragon", "Metallic Dragons"],
	["Gem Dragon", "Gem Dragons"],
	["Nymph", "Nymphs"],
	["Incarnation of Nature", "Incarnations of Nature"],
]);

// Ordered — first match wins. Add-group is skipped if EXCLUDE_NAMES matches
// or the group tag already exists on the monster.
const NAME_PATTERN_TO_GROUP = [
	// Yugoloths
	[/(^|\W)(arcana|mezzo|nyca|ultro|cano|dherg|hydro|merren|oino|yagn|baerna)loth\b/i, "Yugoloths"],
	[/\byugoloth/i, "Yugoloths"],

	// Slaadi
	[/\bslaad\b/i, "Slaadi"],

	// Modrons
	[/\b(mono|duo|tri|quadr|penta|hexa|hepta|octo|nona|deca|septo)(n|)drone\b/i, "Modrons"],
	[/\b(base modron|modron)\b/i, "Modrons"],
	[/\b(hexton|septon|octon|nonaton|decaton) modron\b/i, "Modrons"],

	// Elementals — element-specific
	[/\b(fire elemental|fire snake|fire mephit|salamander|azer|magmin)\b/i, "Fire Elementals"],
	[/\b(water elemental|water mephit|water weird)\b/i, "Water Elementals"],
	[/\b(air elemental|air mephit|dust mephit|invisible stalker)\b/i, "Air Elementals"],
	[/\b(earth elemental|earth mephit|xorn)\b/i, "Earth Elementals"],

	// Gith
	[/\bgithyanki\b/i, "Githyanki"],
	[/\bgithzerai\b/i, "Githzerai"],

	// Myconids
	[/\bmyconid\b/i, "Myconids"],

	// Kuo-toa (variant spellings)
	[/\bkuo-?toa\b/i, "Kuo-Toa"],

	// Sahuagin
	[/\bsahuagin\b/i, "Sahuagin"],

	// Gnolls
	[/\bgnoll\b/i, "Gnolls"],

	// Hobgoblins (before goblins so it wins) — also tagged Goblinoids
	[/\bhobgoblin\b/i, "Hobgoblins"],
	[/\bhobgoblin\b/i, "Goblinoids"],

	// Bugbears — also tagged Goblinoids
	[/\bbugbear\b/i, "Bugbears"],
	[/\bbugbear\b/i, "Goblinoids"],

	// Goblins — also tagged Goblinoids
	[/\bgoblin\b/i, "Goblins"],
	[/\bgoblin\b/i, "Goblinoids"],

	// Oozes — matched only when type includes "ooze" (checked at apply time)
	[/\b(black pudding|gelatinous cube|gray ooze|ochre jelly|slithering tracker|magma ooze)\b/i, "Oozes"],

	// Trolls — actual troll variants only; type must include giant
	[/\btroll\b/i, "Trolls"],

	// Beholderkin — additions to existing Beholders group
	[/\b(beholder zombie|reduced-threat beholder|death kiss|gauth|gazer)\b/i, "Beholders"],
];

// Explicit exclusion overrides
const EXCLUDE_NAMES = new Map([
	// Cold-elemental salamander is not Fire — WotC-canonical strict inclusion
	["Fire Elementals", new Set(["Frost Salamander"])],
	// "Troll" false-positive names (none currently — all _copy children inherit)
	["Trolls", new Set(["Troll Warren Cook"])],
]);

function shouldSkip (m) {
	if (m._isCopy) return true;
	return false;
}

function isOozeType (m) {
	return JSON.stringify(m.type || "").toLowerCase().includes("ooze");
}

function isTrollType (m) {
	// Trolls are all Large giants — require the type to be giant
	const t = m.type;
	if (!t) return false;
	if (typeof t === "string") return t.toLowerCase() === "giant";
	if (typeof t === "object") return String(t.type || "").toLowerCase() === "giant";
	return false;
}

function isCandidateGroup (m, groupName) {
	const excl = EXCLUDE_NAMES.get(groupName);
	if (excl && excl.has(m.name)) return false;
	if (groupName === "Oozes" && !isOozeType(m)) return false;
	if (groupName === "Trolls" && !isTrollType(m)) return false;
	return true;
}

function processMonster (m, stats) {
	let changed = false;
	const nameSrc = `${m.name}|${m.source}`;

	// Phase A: rename existing labels
	if ((phase === "a" || phase === "all") && Array.isArray(m.group)) {
		const renamed = m.group.map(g => {
			if (RENAMES.has(g)) {
				stats.renames.push(`${nameSrc}: "${g}" -> "${RENAMES.get(g)}"`);
				changed = true;
				return RENAMES.get(g);
			}
			return g;
		});
		// De-duplicate (in case rename creates duplicates)
		m.group = [...new Set(renamed)];
	}

	if (shouldSkip(m)) return changed;
	if (phase === "a") return changed;

	// Phase B: add group tags via name heuristics
	const existing = new Set(m.group || []);
	const toAdd = new Set();
	for (const [pattern, groupName] of NAME_PATTERN_TO_GROUP) {
		if (existing.has(groupName)) continue;
		if (!pattern.test(m.name)) continue;
		if (!isCandidateGroup(m, groupName)) continue;
		toAdd.add(groupName);
	}
	if (toAdd.size) {
		m.group = [...(m.group || []), ...toAdd];
		toAdd.forEach(g => stats.adds.push(`${nameSrc}: +${g}`));
		changed = true;
	}
	return changed;
}

function apply () {
	const files = fs.readdirSync(BESTIARY_DIR)
		.filter(f => /^bestiary-.*\.json$/.test(f))
		.map(f => path.join(BESTIARY_DIR, f));

	const stats = {renames: [], adds: [], filesTouched: 0};

	for (const f of files) {
		let raw;
		try {
			raw = JSON.parse(fs.readFileSync(f, "utf-8"));
		} catch (e) {
			process.stderr.write(`Failed to parse ${f}: ${e.message}\n`);
			continue;
		}
		let fileChanged = false;
		for (const m of (raw.monster || [])) {
			if (processMonster(m, stats)) fileChanged = true;
		}
		if (fileChanged) {
			stats.filesTouched++;
			if (!isDry) {
				// Preserve tab-indented JSON style used across the repo
				fs.writeFileSync(f, serializeJson(raw), "utf-8");
			}
		}
	}

	console.log(`\n=== Apply Monster Groups ${isDry ? "(DRY RUN)" : ""} ===`);
	console.log(`Files touched: ${stats.filesTouched}`);
	console.log(`Renames: ${stats.renames.length}`);
	console.log(`Adds:    ${stats.adds.length}`);
	if (isDry || process.argv.includes("--verbose")) {
		console.log(`\n--- Renames ---`);
		stats.renames.forEach(l => console.log(`  ${l}`));
		console.log(`\n--- Adds ---`);
		stats.adds.forEach(l => console.log(`  ${l}`));
	}
}

apply();
