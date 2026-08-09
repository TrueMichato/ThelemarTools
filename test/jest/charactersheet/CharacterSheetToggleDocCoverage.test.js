/**
 * Drift guard for `docs/charactersheet/08-toggle-abilities.md`.
 *
 * The doc's "Supported Toggle Abilities" section covers 32 of the 73 entries in
 * `ACTIVE_STATE_TYPES`. That is a documentation gap, not a capability gap — every
 * one of the 41 is implemented — but a section titled "Supported …" that lists
 * 44% of what exists actively misleads: a reader concludes an implemented state
 * is unsupported and reimplements it.

 * The counts above are prose and WILL rot; the assertions below read the runtime
 * object and the doc, so they stay correct regardless.
 *
 * Rather than freeze a hand-copied list that rots at state 74, this asserts the
 * undocumented set is EXACTLY the set declared in the doc's TOGGLE_DOC_GAP block.
 * Both directions fail loudly:
 *   - add a state without documenting it   -> it is undocumented but undeclared
 *   - document one, forget the list        -> it is declared but no longer missing
 *
 * Two things make this honest rather than decorative:
 *
 *   1. It reads the RUNTIME object, not a regex over source. The object is the
 *      only authority for WHICH KEYS EXIST.
 *
 *      CORRECTION (2026-08-03, found by the `lunar-sorcery-sorcerer` session):
 *      an earlier note here said a prior estimate returned 41 rather than 43
 *      "because substring matching over-matched the generic words `dodge` and
 *      `prone`". The keys were right; the mechanism was not. The cause is
 *      CASE-FOLDING, not substring width. Measured against the doc as it stood
 *      at `f0bc5ab8`, before the gap block existed:
 *
 *        plain substring, exact case   -> 43 missing
 *        plain substring, case-folded  -> 41 missing   flip: [dodge, prone]
 *        THIS predicate, exact case    -> 43 missing
 *        THIS predicate, with `i`      -> 41 missing   flip: [dodge, prone]
 *        controls: doc has `Dodge` x1, `Prone` x2, and ZERO lowercase
 *                  `dodge`/`prone`; `doc.includes("rage")` -> true
 *
 *      Two consequences the old wording hid. First, the `\b` anchoring below is
 *      IRRELEVANT to this distinction — exact-case substring and the anchored
 *      regex both give 43, so anchoring is not what protects the count. What
 *      protects it is the DELIBERATE ABSENCE OF THE `i` FLAG: the prose says
 *      `Dodge` the action and `Prone` the condition, capitalised, and only
 *      case-folding collapses those onto the state keys. Second, the old
 *      wording named a failure that `\b` appears to fix, which invites the one
 *      edit that reintroduces it — a later reader hitting a case mismatch on
 *      some other key adds `i` and silently restores the 41.
 *
 *      That edit is survivable, and only because the assertion is bidirectional
 *      rather than a bare count. Verified by making it: adding `i` to the
 *      predicate below turns this file RED with
 *      `staleDeclarations: ["dodge", "prone"]` (2 of 3 tests fail). The guard
 *      catches the regression its own former comment would have invited —
 *      which is the property to preserve if this predicate is ever rewritten.
 *
 *   2. It STRIPS the gap block before deciding what counts as documented.
 *      Without that, listing the 43 keys in the doc makes all 43 match, the
 *      missing set collapses to empty, and the guard passes forever while
 *      measuring nothing — the exact "correct code wired to the wrong input"
 *      shape this suite keeps finding elsewhere. `documents the gap block
 *      itself is not counted as documentation` pins it.
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

import fs from "fs";
import path from "path";

const CharacterSheetState = globalThis.CharacterSheetState;

const DOC_PATH = path.join(process.cwd(), "docs/charactersheet/08-toggle-abilities.md");
const GAP_START = "<!-- TOGGLE_DOC_GAP:START";
const GAP_END = "<!-- TOGGLE_DOC_GAP:END -->";

const readDoc = () => fs.readFileSync(DOC_PATH, "utf8");

/** The doc with the declared-gap block removed, so the list cannot document itself. */
const getProseOnly = (doc) => {
	const from = doc.indexOf(GAP_START);
	const to = doc.indexOf(GAP_END);
	if (from === -1 || to === -1) throw new Error("TOGGLE_DOC_GAP markers missing from 08-toggle-abilities.md");
	return doc.slice(0, from) + doc.slice(to + GAP_END.length);
};

/** Keys named inside the declared-gap block. */
const getDeclaredGap = (doc) => {
	const from = doc.indexOf(GAP_START);
	const to = doc.indexOf(GAP_END);
	const block = doc.slice(from, to);
	return [...block.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map(m => m[1]);
};

const isDocumented = (key, prose) => new RegExp(`\`${key}\`|\\b${key}\\b`).test(prose);

describe("08-toggle-abilities.md coverage guard", () => {
	test("the doc declares exactly the states it does not document", () => {
		const doc = readDoc();
		const prose = getProseOnly(doc);
		const keys = Object.keys(CharacterSheetState.ACTIVE_STATE_TYPES);

		expect(keys.length).toBeGreaterThan(0);

		const undocumented = keys.filter(k => !isDocumented(k, prose)).sort();
		const declared = getDeclaredGap(doc).sort();

		const undeclaredGaps = undocumented.filter(k => !declared.includes(k));
		const staleDeclarations = declared.filter(k => !undocumented.includes(k));

		expect({undeclaredGaps, staleDeclarations}).toEqual({undeclaredGaps: [], staleDeclarations: []});
	});

	test("every declared gap is a real state, not a typo", () => {
		const declared = getDeclaredGap(readDoc());
		const known = Object.keys(CharacterSheetState.ACTIVE_STATE_TYPES);
		expect(declared.filter(k => !known.includes(k))).toEqual([]);
	});

	test("documenting the gap block itself is not counted as documentation", () => {
		// Positive control for concern (2) above. Every declared key appears
		// verbatim in the raw doc; none may survive the strip.
		const doc = readDoc();
		const prose = getProseOnly(doc);
		const declared = getDeclaredGap(doc);

		expect(declared.length).toBeGreaterThan(0);
		expect(declared.every(k => isDocumented(k, doc))).toBe(true);
		expect(declared.filter(k => isDocumented(k, prose))).toEqual([]);
	});
});
