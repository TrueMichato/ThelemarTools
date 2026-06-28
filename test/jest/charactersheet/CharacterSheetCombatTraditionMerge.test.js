/**
 * Bug #3 — a subclass Combat Traditions CHOICE clobbers already-picked traditions.
 *
 * Root cause: `setCombatTraditions` REPLACES the stored list. The build /
 * level-up call sites pass only the *newly* selected or subclass-granted codes:
 *   - builder.js  → setCombatTraditions([...selected])
 *   - levelup.js  → setCombatTraditions([...selectedCombatTraditions])  (this is
 *                   pre-seeded only with subclass-granted codes at level-up, NOT
 *                   the character's existing stored traditions)
 *   - quickbuild  → merged base + subclass picks (no union with existing entries)
 * So a character with [AM, BZ, RE, SK] who gains an Arcane-Archer-style tradition
 * choice would have the existing four wiped, and methods management loses them.
 *
 * Fix (KEEP setter replace semantics): a `mergeCombatTraditions` state helper
 * unions the new picks with the existing stored traditions and normalizes to
 * canonical `{code, name}` entries (deduped, no string/object mix). All three
 * call sites route through it.
 *
 * These tests drive the REAL `CharacterSheetState` methods that the runtime call
 * sites now invoke, pre-seeded with the repro character's [AM, BZ, RE, SK].
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const REPRO_TRADITIONS = ["AM", "BZ", "RE", "SK"]; // Fighter 9 Arcane Archer repro

function seededState () {
	const state = new CharacterSheetState();
	state.setCombatTraditions(REPRO_TRADITIONS);
	return state;
}

describe("Bug #3 — combat tradition merge retention", () => {
	it("seeds the repro traditions as clean canonical entries", () => {
		const state = seededState();
		expect(state.getCombatTraditions().sort()).toEqual([...REPRO_TRADITIONS].sort());
		// Stored value is always an array of {code, name} — never a string/object mix.
		const entries = state.getCombatTraditionEntries();
		expect(entries).toHaveLength(4);
		entries.forEach(e => {
			expect(typeof e).toBe("object");
			expect(typeof e.code).toBe("string");
			expect(typeof e.name).toBe("string");
		});
	});

	it("DEMONSTRATES the bug: setCombatTraditions(replace) with only the new pick wipes existing", () => {
		const state = seededState();
		// Old call-site behaviour (level-up subclass-granted pick only).
		state.setCombatTraditions(["GH"]);
		expect(state.getCombatTraditions()).toEqual(["GH"]);
		// The four already-picked traditions are GONE — the bug.
		REPRO_TRADITIONS.forEach(code => expect(state.getCombatTraditions()).not.toContain(code));
	});

	it("FIX: mergeCombatTraditions retains ALL existing traditions and adds the new one", () => {
		const state = seededState();
		const result = state.mergeCombatTraditions(["GH"]);
		expect(result.sort()).toEqual(["AM", "BZ", "GH", "RE", "SK"].sort());
		REPRO_TRADITIONS.forEach(code => expect(state.getCombatTraditions()).toContain(code));
		expect(state.getCombatTraditions()).toContain("GH");
	});

	it("merge keeps the stored array clean (no string/object mix) and deduped", () => {
		const state = seededState();
		// Mixed input: object entries AND string codes, including a duplicate.
		state.mergeCombatTraditions([{code: "GH", name: "Gallant Heart"}, "AM", "TI"]);
		const entries = state.getCombatTraditionEntries();
		// AM was already present (dedup), GH + TI added → 6 total, all objects.
		expect(entries).toHaveLength(6);
		entries.forEach(e => {
			expect(typeof e).toBe("object");
			expect(typeof e.code).toBe("string");
		});
		const codes = state.getCombatTraditions();
		expect(new Set(codes).size).toBe(codes.length); // no duplicates
		expect(codes).toEqual(expect.arrayContaining(["AM", "BZ", "RE", "SK", "GH", "TI"]));
	});

	it("simulates the QuickBuild call-site normalization (entries + strings) without clobbering", () => {
		const state = seededState();
		// Mirror quickbuild's merge: base picks (strings) + subclass-choice picks
		// normalized to code strings, then merged with existing stored.
		const basePicks = ["AM", "BZ", "RE", "SK"]; // re-seeded base picks
		const subclassChoicePicks = ["GH"]; // Arcane-Archer-style choice
		const toCode = t => (typeof t === "string" ? t : t?.code);
		const merged = [...new Set([...basePicks, ...subclassChoicePicks].map(toCode).filter(Boolean))];
		state.mergeCombatTraditions(merged);
		expect(state.getCombatTraditions().sort()).toEqual(["AM", "BZ", "GH", "RE", "SK"].sort());
	});

	it("merge from an empty state behaves like a plain set (creation flow safety)", () => {
		const state = new CharacterSheetState();
		state.mergeCombatTraditions(["AM", "BZ"]);
		expect(state.getCombatTraditions().sort()).toEqual(["AM", "BZ"]);
	});

	it("merge tolerates null / non-array input without throwing or wiping", () => {
		const state = seededState();
		expect(() => state.mergeCombatTraditions(null)).not.toThrow();
		expect(state.getCombatTraditions().sort()).toEqual([...REPRO_TRADITIONS].sort());
	});

	it("REMOVAL/REBUILD flow still works: setCombatTraditions (replace) deselects a tradition", () => {
		// The management/rebuild UI and the level-1 builder picker persist via the
		// REPLACE setter so a user can DESELECT. Merge is additive-only and must NOT
		// be used there. Prove replace still removes a tradition (guardrail #1).
		const state = seededState();
		// User deselects "RE" → rebuild with the remaining three.
		state.setCombatTraditions(["AM", "BZ", "SK"]);
		expect(state.getCombatTraditions().sort()).toEqual(["AM", "BZ", "SK"]);
		expect(state.getCombatTraditions()).not.toContain("RE");
		// Full clear is also possible via replace.
		state.setCombatTraditions([]);
		expect(state.getCombatTraditions()).toEqual([]);
	});
});
