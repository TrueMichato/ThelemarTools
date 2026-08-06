import "../../js/parser.js";
import "../../js/utils.js";

const CryptUtil = globalThis.CryptUtil;

describe("CryptUtil.hashFast", () => {
	it("is deterministic for identical input", () => {
		const json = JSON.stringify({monster: [{name: "Aboleth", source: "MM"}]});
		expect(CryptUtil.hashFast(json)).toBe(CryptUtil.hashFast(json));
	});

	it("distinguishes content that differs only slightly", () => {
		const a = CryptUtil.hashFast(JSON.stringify({name: "Aboleth", source: "MM"}));
		const b = CryptUtil.hashFast(JSON.stringify({name: "Aboleth", source: "MPMM"}));
		const c = CryptUtil.hashFast(JSON.stringify({name: "Abolet", source: "MM"}));
		expect(new Set([a, b, c]).size).toBe(3);
	});

	it("distinguishes transposed characters (the classic weak-hash failure)", () => {
		expect(CryptUtil.hashFast("ab")).not.toBe(CryptUtil.hashFast("ba"));
		expect(CryptUtil.hashFast("abcd")).not.toBe(CryptUtil.hashFast("abdc"));
	});

	it("encodes the input length, so differing lengths can never collide", () => {
		const short = CryptUtil.hashFast("a");
		const long = CryptUtil.hashFast("a".repeat(1000));
		expect(short.split("-")[0]).toBe((1).toString(36));
		expect(long.split("-")[0]).toBe((1000).toString(36));
		expect(short).not.toBe(long);
	});

	it("handles the empty string without throwing", () => {
		expect(typeof CryptUtil.hashFast("")).toBe("string");
	});

	it("respects the seed", () => {
		expect(CryptUtil.hashFast("abc", 0)).not.toBe(CryptUtil.hashFast("abc", 1));
	});

	it("produces no collisions across a large set of realistic entity keys", () => {
		const hashes = new Set();
		const props = ["monster", "item", "spell", "class", "feat", "background"];
		const sources = ["PHB", "XPHB", "MM", "XMM", "DMG", "TCE"];
		let n = 0;
		for (const prop of props) {
			for (const source of sources) {
				for (let i = 0; i < 500; ++i) {
					hashes.add(CryptUtil.hashFast(JSON.stringify({prop, source, name: `Entity ${i}`})));
					++n;
				}
			}
		}
		expect(hashes.size).toBe(n);
	});
});
