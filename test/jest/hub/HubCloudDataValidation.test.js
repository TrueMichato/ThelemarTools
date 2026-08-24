import {
	MAX_CLOUD_CHARACTER_BYTES,
	validateCloudCharacterData,
	validateCloudValue,
} from "../../../server/src/cloud-data-validation.js";

describe("cross-user cloud data validation", () => {
	it("preserves renderer markup while stripping executable character HTML", () => {
		const data = {
			name: "Sanitized",
			features: [{
				name: "Feature",
				description: `<div class="ve-rd__b" style="background:url(javascript:alert(1))"><p><strong>Safe</strong><span class="ve-roller" data-packed-dice="{&quot;toRoll&quot;:&quot;1d20&quot;}">1d20</span><img src=x onerror=alert(1)><script>alert(2)</script></p></div>`,
			}],
		};
		validateCloudCharacterData(data);
		expect(data.features[0].description).toBe(`<div class="ve-rd__b"><p><strong>Safe</strong><span class="ve-roller">1d20</span>&lt;img /&gt;&lt;script&gt;alert(2)&lt;/script&gt;</p></div>`);
		expect(data.features[0].description).not.toMatch(/<(?:img|script)\b|onerror=|style=|data-packed-dice=/i);
	});

	it("rejects renderer-link unsafe schemes", () => {
		expect(() => validateCloudValue({
			description: "{@link click|javascript:alert(document.domain)}",
		})).toThrow(expect.objectContaining({code: "CLOUD_URL_FORBIDDEN"}));
	});

	it("rejects prototype-polluting object keys", () => {
		const value = JSON.parse("{\"safe\":{\"__proto__\":{\"polluted\":true}}}");
		expect(() => validateCloudValue(value)).toThrow(expect.objectContaining({code: "CLOUD_KEY_FORBIDDEN"}));
		expect({}.polluted).toBeUndefined();
	});

	it("allows ordinary prose containing data colon", () => {
		expect(() => validateCloudCharacterData({backstory: "My data: hometown notes"})).not.toThrow();
	});

	it("preserves hand-written comparison prose that is not complete HTML", () => {
		const data = {
			notes: "If STR <dex use dex",
			pseudoTag: "Roll 1d8<slashing> damage",
			malformed: "<img src=x onerror=alert(1)",
		};
		validateCloudCharacterData(data);
		expect(data.notes).toBe("If STR <dex use dex");
		expect(data.pseudoTag).toBe("Roll 1d8&lt;slashing&gt; damage");
		expect(data.malformed).toBe("&lt;img src=x onerror=alert(1)");
	});

	it("does not confuse 5etools filter syntax with an event handler", () => {
		expect(() => validateCloudValue({filter: "{@filter Mountain|bestiary|environment=mountain}"})).not.toThrow();
	});

	it("rejects canonical characters over the serialized-byte ceiling", () => {
		expect(() => validateCloudCharacterData({notes: "x".repeat(MAX_CLOUD_CHARACTER_BYTES)}))
			.toThrow(expect.objectContaining({code: "CHARACTER_TOO_LARGE", status: 413}));
	});
});
