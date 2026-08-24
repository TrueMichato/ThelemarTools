import fs from "node:fs";

const source = fs.readFileSync(new URL("../../../js/dmscreen.js", import.meta.url), "utf8");

describe("cloud Board navigation guard", () => {
	it("tracks save generations rather than a racy pending boolean", () => {
		expect(source).toContain("this._saveGeneration++");
		expect(source).toContain("this._savedGeneration = Math.max(this._savedGeneration, saveGeneration)");
		expect(source).toContain("return this._savedGeneration < this._saveGeneration");
		expect(source).not.toContain("_isSaveDebouncedPending");
	});
});
