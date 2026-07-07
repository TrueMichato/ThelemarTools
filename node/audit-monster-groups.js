/*
 * Audit the `group` field across every bestiary data file and print:
 *   1. All distinct group labels + member count
 *   2. Ungrouped monsters that likely SHOULD be grouped (by name pattern)
 *   3. Label variants that only differ by pluralization / casing
 *
 * Usage:
 *   node node/audit-monster-groups.js
 *   node node/audit-monster-groups.js --json  (machine-readable output)
 */
import fs from "fs";
import path from "path";

const BESTIARY_DIR = "./data/bestiary";

const isJsonOut = process.argv.includes("--json");

// Ungrouped-candidate detection: name substring => canonical group label.
// Ordered — first match wins.
const NAME_PATTERN_TO_GROUP = [
	// Yugoloths — every -loth / yugoloth
	[/(^|\W)(arcana|mezzo|nyca|ultro|cano|dherg|hydro|merren|oino|yagn|baerna)loth\b/i, "Yugoloths"],
	[/\byugoloth/i, "Yugoloths"],

	// Slaadi — must be a slaad, not a name coincidence
	[/\bslaad\b/i, "Slaadi"],

	// Modrons
	[/\b(mono|duo|tri|quadr|penta|hexa|hepta|octo|nona|deca)drone\b/i, "Modrons"],
	[/\b(base modron|modron)\b/i, "Modrons"],

	// Elementals (element-specific first, generic last)
	[/\b(fire elemental|fire snake|fire mephit|salamander|azer|magmin)\b/i, "Fire Elementals"],
	[/\b(water elemental|water mephit|water weird)\b/i, "Water Elementals"],
	[/\b(air elemental|air mephit|dust mephit|invisible stalker)\b/i, "Air Elementals"],
	[/\b(earth elemental|earth mephit|xorn)\b/i, "Earth Elementals"],

	// Gith
	[/\bgithyanki\b/i, "Githyanki"],
	[/\bgithzerai\b/i, "Githzerai"],

	// Myconids
	[/\bmyconid\b/i, "Myconids"],

	// Kuo-toa
	[/\bkuo-?toa\b/i, "Kuo-Toa"],

	// Sahuagin
	[/\bsahuagin\b/i, "Sahuagin"],

	// Gnolls
	[/\bgnoll\b/i, "Gnolls"],

	// Hobgoblins — distinct from goblins / bugbears
	[/\bhobgoblin\b/i, "Hobgoblins"],

	// Bugbears
	[/\bbugbear\b/i, "Bugbears"],

	// Goblins — after hobgoblin/bugbear so those match first
	[/\bgoblin\b/i, "Goblins"],

	// Oozes (very common word — require the type to also be ooze; done below)
	[/\b(gray ooze|ochre jelly|black pudding|gelatinous cube|slithering tracker|magma ooze)\b/i, "Oozes"],

	// Trolls (only actual trolls — not "troll hunter" NPCs by luck)
	[/\b(troll|dire troll|rot troll|spirit troll|venom troll|giant troll)\b/i, "Trolls"],
];

function shouldSkip (m) {
	// Skip _copy children — they inherit `group` from the parent monster at
	// load time; a fresh direct tag on the child would be double-bookkeeping.
	if (m._copy) return true;
	if (m._isCopy) return true;
	if (m.isNpc) return true;
	if (m.isNamedCreature) return true;
	return false;
}

function normalizeLabelForCollision (s) {
	return s.toLowerCase().replace(/s$/i, "").trim();
}

function loadBestiary () {
	const files = fs.readdirSync(BESTIARY_DIR)
		.filter(f => /^bestiary-.*\.json$/.test(f))
		.map(f => path.join(BESTIARY_DIR, f));

	const monsters = [];
	for (const f of files) {
		try {
			const raw = JSON.parse(fs.readFileSync(f, "utf-8"));
			for (const m of (raw.monster || [])) {
				monsters.push({...m, _file: path.basename(f)});
			}
		} catch (e) {
			process.stderr.write(`Failed to parse ${f}: ${e.message}\n`);
		}
	}
	return monsters;
}

function audit () {
	const monsters = loadBestiary();

	// 1. Distinct group labels + members
	const labelToMembers = new Map();
	for (const m of monsters) {
		const g = m.group;
		if (!g || !Array.isArray(g)) continue;
		for (const label of g) {
			if (!labelToMembers.has(label)) labelToMembers.set(label, []);
			labelToMembers.get(label).push(`${m.name}|${m.source}`);
		}
	}

	// 2. Collisions — labels whose plural/singular form matches
	const normalizedGroups = new Map();
	for (const label of labelToMembers.keys()) {
		const key = normalizeLabelForCollision(label);
		if (!normalizedGroups.has(key)) normalizedGroups.set(key, []);
		normalizedGroups.get(key).push(label);
	}
	const collisions = [...normalizedGroups.entries()]
		.filter(([, labels]) => labels.length > 1)
		.map(([key, labels]) => ({key, labels: labels.map(l => ({label: l, count: labelToMembers.get(l).length}))}));

	// 3. Ungrouped candidates
	const ungroupedCandidates = new Map(); // groupName -> [monster refs]
	for (const m of monsters) {
		if (shouldSkip(m)) continue;
		const existing = new Set(m.group || []);
		for (const [pattern, groupName] of NAME_PATTERN_TO_GROUP) {
			if (!pattern.test(m.name)) continue;
			// Ooze special-case — verify actual ooze type
			if (groupName === "Oozes") {
				const typeStr = JSON.stringify(m.type || "").toLowerCase();
				if (!typeStr.includes("ooze")) continue;
			}
			if (existing.has(groupName)) continue;
			if (!ungroupedCandidates.has(groupName)) ungroupedCandidates.set(groupName, []);
			ungroupedCandidates.get(groupName).push(`${m.name}|${m.source}|${m._file}`);
		}
	}

	if (isJsonOut) {
		console.log(JSON.stringify({
			labels: [...labelToMembers.entries()].map(([label, members]) => ({label, count: members.length})).sort((a, b) => b.count - a.count),
			collisions,
			ungroupedCandidates: [...ungroupedCandidates.entries()].map(([g, members]) => ({group: g, count: members.length, members})).sort((a, b) => b.count - a.count),
		}, null, 2));
		return;
	}

	console.log(`\n=== Monster Group Audit ===\n`);
	console.log(`Total monsters scanned: ${monsters.length}`);
	console.log(`Distinct group labels: ${labelToMembers.size}\n`);

	console.log(`--- Existing labels (by member count) ---`);
	[...labelToMembers.entries()]
		.sort((a, b) => b[1].length - a[1].length)
		.forEach(([label, members]) => console.log(`  ${String(members.length).padStart(4)}  ${label}`));

	console.log(`\n--- Label collisions (plural/singular drift) ---`);
	if (!collisions.length) console.log(`  (none)`);
	else {
		collisions.forEach(({key, labels}) => {
			console.log(`  [${key}]`);
			labels.forEach(({label, count}) => console.log(`      ${String(count).padStart(4)}  ${label}`));
		});
	}

	console.log(`\n--- Ungrouped-monster candidates (would be added by heuristic) ---`);
	[...ungroupedCandidates.entries()]
		.sort((a, b) => b[1].length - a[1].length)
		.forEach(([g, members]) => {
			console.log(`  [${g}] — ${members.length} candidates`);
			members.slice(0, 40).forEach(mref => console.log(`      ${mref}`));
			if (members.length > 40) console.log(`      … +${members.length - 40} more`);
		});

	console.log(`\n=== end ===\n`);
}

audit();
