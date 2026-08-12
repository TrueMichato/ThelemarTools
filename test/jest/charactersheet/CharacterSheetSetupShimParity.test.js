/**
 * Guards the `Parser` shims in `test/jest/charactersheet/setup.js` against drift from
 * their production counterparts in `js/parser.js`.
 *
 * The shims only apply where the real `Parser` was not imported (`globalThis.Parser =
 * globalThis.Parser || {...}`), so a divergence means the SAME string can resolve to
 * different values in two suites — a silent, green-test failure mode.
 *
 * `textToNumber` is the load-bearing case: two of the three call sites in
 * `js/scalecreature/scalecreature-scaler-summon-class.js` capture an unbounded
 * `(?<perLevel>\d+|[a-z]+)`, so a summon reading "5 + fifteen times your level" reaches
 * this function with a word the narrow shim did not know. That is the Beastheart
 * companion-scaling path.
 */

import "./setup.js";

describe("setup.js Parser shims — parity with js/parser.js", () => {
	describe("textToNumber", () => {
		// Extracted from js/parser.js:139-169. Kept as data so a mismatch names the word.
		// Extracted from js/parser.js:139-169, as [synonyms, value] so a mismatch names
		// the exact word. Grouped rather than one flat object to stay readable.
		const EXPECTED_GROUPS = [
			[["zero"], 0],
			[["one", "a", "an", "first"], 1],
			[["two", "double", "second"], 2],
			[["three", "triple", "third"], 3],
			[["four", "quadruple", "fourth"], 4],
			[["five", "fifth"], 5],
			[["six", "sixth"], 6],
			[["seven", "seventh"], 7],
			[["eight", "eighth"], 8],
			[["nine", "ninth"], 9],
			[["ten", "tenth"], 10],
			[["eleven"], 11],
			[["twelve"], 12],
			[["thirteen"], 13],
			[["fourteen"], 14],
			[["fifteen"], 15],
			[["sixteen"], 16],
			[["seventeen"], 17],
			[["eighteen"], 18],
			[["nineteen"], 19],
			[["twenty"], 20],
			[["thirty"], 30],
			[["forty"], 40],
			[["fifty"], 50],
			[["sixty"], 60],
			[["seventy"], 70],
			[["eighty"], 80],
			[["ninety"], 90],
		];
		const EXPECTED = EXPECTED_GROUPS.flatMap(([words, val]) => words.map(w => [w, val]));

		it("resolves every word production resolves, to the same value", () => {
			const mismatches = EXPECTED
				.map(([word, want]) => ({word, want, got: globalThis.Parser.textToNumber(word)}))
				.filter(r => r.got !== r.want);
			expect(mismatches).toEqual([]);
		});

		it("covers the tens and teens the summon scaler can emit through its unbounded capture", () => {
			// The regression that prompted this file: the shim stopped at twelve, so these
			// yielded NaN into a companion HP string while production yielded a number.
			["thirteen", "fifteen", "twenty", "thirty", "ninety"].forEach(word => {
				expect(Number.isNaN(globalThis.Parser.textToNumber(word))).toBe(false);
			});
			expect(globalThis.Parser.textToNumber("fifteen")).toBe(15);
			expect(globalThis.Parser.textToNumber("ninety")).toBe(90);
		});

		it("has NO ordinals above tenth, matching production exactly", () => {
			// Production stops adding ordinal spellings after "tenth". A shim that
			// accepted them would pass a test that fails against the real Parser.
			["eleventh", "twelfth", "thirteenth", "twentieth"].forEach(word => {
				expect(Number.isNaN(globalThis.Parser.textToNumber(word))).toBe(true);
			});
		});

		it("passes numerals straight through and rejects unknown words", () => {
			expect(globalThis.Parser.textToNumber("7")).toBe(7);
			expect(globalThis.Parser.textToNumber(" Three ")).toBe(3);
			expect(Number.isNaN(globalThis.Parser.textToNumber("banana"))).toBe(true);
		});
	});
});
