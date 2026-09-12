import {ListVirtualLayout} from "../../../js/list2/list2-virtual.js";

describe("ListVirtualLayout", () => {
	it("keeps empty and boundary lookups within the logical result set", () => {
		const layout = new ListVirtualLayout();
		expect(layout.total).toBe(0);
		expect(layout.indexAt(0)).toBe(-1);
		layout.reset([16, 30, 44]);
		expect([0, 1, 2, 3].map(index => layout.offset(index))).toEqual([0, 16, 46, 90]);
		expect([-1, 0, 15, 16, 45, 46, 90, 1000].map(offset => layout.indexAt(offset))).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
	});

	it("accounts for preview expansion and collapse without changing item indices", () => {
		const layout = new ListVirtualLayout([16, 30, 44]);
		expect(layout.setHeight(1, 630)).toBe(true);
		expect(layout.offset(2)).toBe(646);
		expect(layout.total).toBe(690);
		expect(layout.indexAt(645)).toBe(1);
		expect(layout.indexAt(646)).toBe(2);
		expect(layout.setHeight(1, 630)).toBe(false);
		layout.setHeight(1, 30);
		expect(layout.offset(2)).toBe(46);
		expect(layout.total).toBe(90);
	});

	it("matches a linear oracle after many independent height changes", () => {
		const heights = Array.from({length: 14_285}, (_, i) => 16 + (i % 3) * 14);
		const layout = new ListVirtualLayout(heights);
		for (let i = 0; i < heights.length; i += 13) {
			heights[i] = 16 + (i % 500);
			layout.setHeight(i, heights[i]);
		}
		let offset = 0;
		for (let i = 0; i < heights.length; ++i) {
			expect(layout.offset(i)).toBe(offset);
			expect(layout.indexAt(offset)).toBe(i);
			expect(layout.indexAt(offset + heights[i] - 0.5)).toBe(i);
			offset += heights[i];
		}
		expect(layout.total).toBe(offset);
	});

	it.each([0, -1, Infinity, NaN])("rejects invalid measured heights (%s)", height => {
		expect(() => new ListVirtualLayout([16]).setHeight(0, height)).toThrow("Invalid virtual row height");
	});
});
