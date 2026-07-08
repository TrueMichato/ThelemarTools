import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/utils-config.js";

// Smoke tests for the magic-items Cost column.
//
// The column is powered by two mechanisms shared with the (already-shipped) mundane
// Cost column:
//   1. Display  — Parser.itemValueToFullMultiCurrency formats item.value (copper).
//   2. Sorting  — a numeric `cost: item.value || 0` ListItem value, ordered via
//                 SortUtil.ascSort (the default comparator behind data-sort="cost").
//
// We test those two mechanisms directly. Rendering the actual DOM row is not
// covered — items.js pulls in the browser environment wholesale and mundane's
// identical rendering path has shipped for years.

describe("Magic-item Cost column", () => {
	describe("value → display string", () => {
		it("formats a priced magic item (value: 50000 cp) as '500 gp'", () => {
			const s = Parser.itemValueToFullMultiCurrency({value: 50000}, {isShortForm: true});
			expect(s).toMatch(/500\s*gp/i);
		});

		it("returns empty string for an unpriced magic item", () => {
			const s = Parser.itemValueToFullMultiCurrency({}, {isShortForm: true});
			expect(s).toBe("");
		});
	});

	describe("sort key ordering", () => {
		// Simulates the ListItem `values.cost` used by data-sort="cost".
		const costOf = item => item.value || 0;

		it("orders a priced item after an unpriced item ascending", () => {
			const priced = {name: "Bag of Holding", value: 50000};
			const unpriced = {name: "Wand of Wonder"};

			const rows = [priced, unpriced].sort((a, b) => SortUtil.ascSort(costOf(a), costOf(b)));

			expect(rows[0]).toBe(unpriced);
			expect(rows[1]).toBe(priced);
		});

		it("orders a priced item before an unpriced item descending", () => {
			const priced = {name: "Bag of Holding", value: 50000};
			const unpriced = {name: "Wand of Wonder"};

			const rows = [unpriced, priced].sort((a, b) => SortUtil.ascSort(costOf(b), costOf(a)));

			expect(rows[0]).toBe(priced);
			expect(rows[1]).toBe(unpriced);
		});

		it("orders two priced items by numeric cost, not string", () => {
			const cheap = {value: 10000}; // 100 gp
			const pricey = {value: 500000}; // 5,000 gp

			const rows = [cheap, pricey].sort((a, b) => SortUtil.ascSort(costOf(a), costOf(b)));

			expect(rows[0]).toBe(cheap);
			expect(rows[1]).toBe(pricey);
		});
	});
});
