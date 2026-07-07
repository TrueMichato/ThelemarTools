import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-config.js";
import "../../js/bestiary/bestiary-compare.js";

const monA = {
	name: "Sample Beast",
	source: "MM",
	size: ["M"],
	type: "beast",
	alignment: ["N"],
	ac: [{ac: 12, from: ["natural armor"]}],
	hp: {average: 10, formula: "2d8 + 2"},
	speed: {walk: 30},
	str: 12,
	dex: 14,
	con: 12,
	int: 6,
	wis: 10,
	cha: 6,
	senses: ["darkvision 30 ft."],
	passive: 10,
	languages: ["Common"],
	cr: "1/4",
	trait: [
		{name: "Keen Hearing", entries: ["The beast has advantage on Wisdom (Perception) checks that rely on hearing."]},
		{name: "Nimble", entries: ["The beast can dash as a bonus action."]},
	],
	action: [
		{name: "Bite", entries: ["{@atk mw} {@hit 3} to hit, reach 5 ft., one target. {@h}4 ({@damage 1d6 + 1}) piercing damage."]},
	],
};

const monB = {
	name: "Sample Fiend",
	source: "MM",
	size: ["M"],
	type: "fiend",
	alignment: ["C", "E"],
	ac: [{ac: 15, from: ["natural armor"]}],
	hp: {average: 22, formula: "4d8 + 4"},
	speed: {walk: 30},
	str: 16,
	dex: 14,
	con: 14,
	int: 8,
	wis: 12,
	cha: 10,
	senses: ["darkvision 60 ft."],
	passive: 11,
	languages: ["Common"],
	cr: "2",
	trait: [
		// Same body as monA's "Keen Hearing" — should surface as SAME.
		{name: "Keen Hearing", entries: ["The beast has advantage on Wisdom (Perception) checks that rely on hearing."]},
		// New trait only on monB — should surface as MISSING on monA.
		{name: "Regeneration", entries: ["The fiend regains 5 hit points at the start of its turn."]},
	],
	action: [
		{name: "Bite", entries: ["{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}6 ({@damage 1d8 + 2}) piercing damage."]},
		{name: "Claw", entries: ["{@atk mw} {@hit 5} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) slashing damage."]},
	],
};

const findRow = (rows, key) => rows.find(r => r.key === key);
const findSub = (rows, sectionKey, subLabel) => rows.find(r => r.sectionKey === sectionKey && r.subLabel === subLabel);

describe("CompareCreaturesDiff", () => {
	describe("getRows contract", () => {
		it("returns empty when given fewer than two creatures", () => {
			expect(CompareCreaturesDiff.getRows([])).toEqual([]);
			expect(CompareCreaturesDiff.getRows([monA])).toEqual([]);
		});

		it("emits rows in a stable order beginning with size/type/alignment then AC then HP", () => {
			const rows = CompareCreaturesDiff.getRows([monA, monB]);
			const keys = rows.map(r => r.key);
			const ixSize = keys.indexOf("sizeTypeAlignment");
			const ixAc = keys.indexOf("ac");
			const ixHp = keys.indexOf("hp");
			expect(ixSize).toBeGreaterThanOrEqual(0);
			expect(ixAc).toBeGreaterThan(ixSize);
			expect(ixHp).toBeGreaterThan(ixAc);
		});
	});

	describe("simple field comparisons", () => {
		const rows = CompareCreaturesDiff.getRows([monA, monB]);

		it("marks AC as diff (12 vs 15)", () => {
			const row = findRow(rows, "ac");
			expect(row).toBeDefined();
			expect(row.isAllSame).toBe(false);
			expect(row.cells).toHaveLength(2);
			row.cells.forEach(c => expect(c.status).toBe(CompareCreaturesDiff.STATUS_DIFF));
			expect(row.cells[0].value).toBe(12);
			expect(row.cells[1].value).toBe(15);
		});

		it("marks Speed as same (both 30 ft.)", () => {
			const row = findRow(rows, "speed");
			expect(row).toBeDefined();
			expect(row.isAllSame).toBe(true);
			row.cells.forEach(c => expect(c.status).toBe(CompareCreaturesDiff.STATUS_SAME));
		});

		it("marks HP as diff (10 vs 22) with numeric values populated", () => {
			const row = findRow(rows, "hp");
			expect(row.isAllSame).toBe(false);
			expect(row.cells[0].value).toBe(10);
			expect(row.cells[1].value).toBe(22);
		});

		it("marks Languages as same when both list ['Common']", () => {
			const row = findRow(rows, "languages");
			expect(row.isAllSame).toBe(true);
		});
	});

	describe("ability scores", () => {
		const rows = CompareCreaturesDiff.getRows([monA, monB]);

		it("emits one row per ability (STR/DEX/CON/INT/WIS/CHA)", () => {
			["str", "dex", "con", "int", "wis", "cha"].forEach(ab => {
				expect(findRow(rows, `ability_${ab}`)).toBeDefined();
			});
		});

		it("STR row is a diff (12 vs 16) with an ability delta signalling above/below mean", () => {
			const row = findRow(rows, "ability_str");
			expect(row.isAllSame).toBe(false);
			expect(row.cells[0].value).toBe(12);
			expect(row.cells[1].value).toBe(16);
			// Mean = 14, so cell0 delta = -2, cell1 delta = +2.
			expect(row.cells[0].abilityDelta).toBeCloseTo(-2, 5);
			expect(row.cells[1].abilityDelta).toBeCloseTo(2, 5);
		});

		it("DEX row is same (both 14)", () => {
			const row = findRow(rows, "ability_dex");
			expect(row.isAllSame).toBe(true);
			row.cells.forEach(c => expect(c.abilityDelta).toBeCloseTo(0, 5));
		});
	});

	describe("trait section (name-keyed sub-rows)", () => {
		const rows = CompareCreaturesDiff.getRows([monA, monB]);

		it("emits a section header for traits", () => {
			const hdr = rows.find(r => r.isSectionHeader && r.sectionKey === "trait");
			expect(hdr).toBeDefined();
			expect(hdr.subRowsCount).toBeGreaterThanOrEqual(2);
		});

		it("collapses the shared 'Keen Hearing' trait to isAllSame=true (identical bodies)", () => {
			const sub = findSub(rows, "trait", "Keen Hearing");
			expect(sub).toBeDefined();
			expect(sub.isAllPresent).toBe(true);
			expect(sub.isAllSame).toBe(true);
			sub.cells.forEach(c => expect(c.status).toBe(CompareCreaturesDiff.STATUS_SAME));
		});

		it("marks the 'Nimble' trait (only on monA) as missing on monB", () => {
			const sub = findSub(rows, "trait", "Nimble");
			expect(sub).toBeDefined();
			expect(sub.isAllPresent).toBe(false);
			expect(sub.cells[0].status).toBe(CompareCreaturesDiff.STATUS_DIFF);
			expect(sub.cells[1].status).toBe(CompareCreaturesDiff.STATUS_MISSING);
		});

		it("marks the 'Regeneration' trait (only on monB) as missing on monA", () => {
			const sub = findSub(rows, "trait", "Regeneration");
			expect(sub).toBeDefined();
			expect(sub.cells[0].status).toBe(CompareCreaturesDiff.STATUS_MISSING);
			expect(sub.cells[1].status).toBe(CompareCreaturesDiff.STATUS_DIFF);
		});
	});

	describe("action section", () => {
		const rows = CompareCreaturesDiff.getRows([monA, monB]);

		it("marks the shared 'Bite' action as differing (different hit bonuses / damage dice)", () => {
			const sub = findSub(rows, "action", "Bite");
			expect(sub).toBeDefined();
			expect(sub.isAllPresent).toBe(true);
			expect(sub.isAllSame).toBe(false);
			sub.cells.forEach(c => expect(c.status).toBe(CompareCreaturesDiff.STATUS_DIFF));
		});

		it("marks the 'Claw' action (only on monB) as missing on monA", () => {
			const sub = findSub(rows, "action", "Claw");
			expect(sub).toBeDefined();
			expect(sub.cells[0].status).toBe(CompareCreaturesDiff.STATUS_MISSING);
			expect(sub.cells[1].status).toBe(CompareCreaturesDiff.STATUS_DIFF);
		});
	});
});
