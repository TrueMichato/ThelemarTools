/*
 * Integrity test for the `group` field on monsters (see
 * `schema/site/util.json#/$defs/group`). Catches:
 *
 *   1. Plural/singular label drift (e.g. "Chromatic Dragon" AND
 *      "Chromatic Dragons" both present).
 *   2. Unknown group labels — anything appearing in `mon.group[]` must
 *      be either in the canonical enum below or listed in the escape-
 *      hatch allow-list.
 *
 * Update `CANONICAL_GROUPS` when adding a new group family. The escape
 * hatch (`ALLOW_LEGACY`) exists so obscure ad-hoc groups can survive
 * without forcing a canon entry, but should stay short.
 */
import fs from "fs";
import path from "path";

const BESTIARY_DIR = "./data/bestiary";

// Groups that have full-fledged coverage in the corpus. Adding a new
// group family — even data-only — must add it here.
const CANONICAL_GROUPS = new Set([
	// Dragons (2014 + FTD)
	"Chromatic Dragons",
	"Metallic Dragons",
	"Gem Dragons",
	// Fiends
	"Demons",
	"Devils",
	"Yugoloths",
	"Slaadi",
	// Celestials
	"Angels",
	// Monstrosities / miscellaneous families
	"Beholders",
	"Lycanthropes",
	"Hags",
	"Sphinxes",
	"Titans",
	"Genies",
	"Nymphs",
	"Dinosaurs",
	"Animated Objects",
	"Homunculi",
	"Quori",
	"Incarnations of Nature",
	// Constructs
	"Modrons",
	// Elementals — by element
	"Air Elementals",
	"Earth Elementals",
	"Fire Elementals",
	"Water Elementals",
	// Humanoids
	"Goblinoids",
	"Goblins",
	"Hobgoblins",
	"Bugbears",
	"Gnolls",
	"Sahuagin",
	"Kuo-Toa",
	"Myconids",
	"Githyanki",
	"Githzerai",
	// Giants
	"Trolls",
	// Oozes
	"Oozes",
]);

// Escape hatch for obscure / adventure-specific groupings that don't
// merit a canonical entry. Keep short. If it grows past ~5 entries,
// promote them to CANONICAL_GROUPS.
const ALLOW_LEGACY = new Set([]);

// Normalize a label for collision detection (strip trailing 's',
// lowercase).
function normalize (s) {
	return s.toLowerCase().replace(/s$/i, "").trim();
}

function loadGroups () {
	const files = fs.readdirSync(BESTIARY_DIR)
		.filter(f => /^bestiary-.*\.json$/.test(f))
		.map(f => path.join(BESTIARY_DIR, f));

	const labelToMembers = new Map();
	for (const f of files) {
		let raw;
		try {
			raw = JSON.parse(fs.readFileSync(f, "utf-8"));
		} catch (e) {
			throw new Error(`Failed to parse ${f}: ${e.message}`, {cause: e});
		}
		for (const m of (raw.monster || [])) {
			const g = m.group;
			if (!g || !Array.isArray(g)) continue;
			for (const label of g) {
				if (!labelToMembers.has(label)) labelToMembers.set(label, []);
				labelToMembers.get(label).push(`${m.name}|${m.source}`);
			}
		}
	}
	return labelToMembers;
}

function testMonsterGroups () {
	const errors = [];
	const labelToMembers = loadGroups();

	// 1. Every observed label must be canonical or allow-listed
	for (const label of labelToMembers.keys()) {
		if (CANONICAL_GROUPS.has(label)) continue;
		if (ALLOW_LEGACY.has(label)) continue;
		const members = labelToMembers.get(label);
		errors.push(`Unknown group label "${label}" (${members.length} members: ${members.slice(0, 3).join(", ")}${members.length > 3 ? ", ..." : ""}). Add to CANONICAL_GROUPS in test/test-monster-groups.js, or to ALLOW_LEGACY if this is an obscure adventure-specific tag.`);
	}

	// 2. Plural/singular collisions — labels that normalize to the same
	//    key indicate drift.
	const normalized = new Map();
	for (const label of labelToMembers.keys()) {
		const key = normalize(label);
		if (!normalized.has(key)) normalized.set(key, []);
		normalized.get(key).push(label);
	}
	for (const [, labels] of normalized) {
		if (labels.length <= 1) continue;
		errors.push(`Label collision — these variants all normalize to the same key: ${labels.map(l => `"${l}"`).join(", ")}. Pick one canonical plural form and rewrite the rest.`);
	}

	return errors;
}

async function main () {
	const errors = testMonsterGroups();
	if (errors.length) {
		console.error(`Monster group errors:`);
		errors.forEach(e => console.error(`\t${e}`));
		return false;
	}
	console.log(`##### Monster Group Tests Passed #####`);
	return true;
}

const pMain = main();

if (import.meta.main && !(await pMain)) process.exitCode = 1;

export default pMain;
