import {
	CAMPAIGN_RULES_SCHEMA_VERSION,
	DEFAULT_CAMPAIGN_RULES,
	getCampaignBrewHash,
	normalizeCampaignRules,
	validateCampaignBrewBundle,
} from "../../../server/src/campaign-content.js";

const brew = ({source = "CMP", name = "Campaign Spell"} = {}) => [{
	head: {filename: "campaign.json"},
	body: {
		_meta: {sources: [{json: source, abbreviation: source, full: source}]},
		spell: [{name, source, level: 1, entries: ["Safe text."]}],
	},
}];

describe("campaign content validation", () => {
	it("hashes equivalent object-key order identically", () => {
		const first = brew();
		const second = structuredClone(first);
		second[0].body = {spell: second[0].body.spell, _meta: second[0].body._meta};
		expect(getCampaignBrewHash(first)).toBe(getCampaignBrewHash(second));
	});

	it("accepts closed dependency bundles and reports their manifest", () => {
		const docs = [
			...brew({source: "BASE"}),
			{
				head: {filename: "dependent.json"},
				body: {
					_meta: {
						sources: [{json: "DEP", abbreviation: "DEP", full: "Dependent"}],
						dependencies: {spell: ["BASE"]},
					},
				},
			},
		];
		expect(validateCampaignBrewBundle(docs)).toEqual(expect.objectContaining({
			documentCount: 2,
			sources: ["BASE", "DEP"],
		}));
	});

	it("rejects missing dependencies, blocklists, raw HTML, and scripts", () => {
		const missing = brew();
		missing[0].body._meta.dependencies = {spell: ["MISSING"]};
		expect(() => validateCampaignBrewBundle(missing)).toThrow(expect.objectContaining({code: "BREW_DEPENDENCY_MISSING"}));

		const blocklist = brew();
		blocklist[0].body.blocklist = [{hash: "*"}];
		expect(() => validateCampaignBrewBundle(blocklist)).toThrow(expect.objectContaining({code: "BREW_BLOCKLIST_FORBIDDEN"}));

		const wrapped = brew();
		wrapped[0].body.spell[0].entries = [{type: "wrappedHtml", html: "<b>unsafe</b>"}];
		expect(() => validateCampaignBrewBundle(wrapped)).toThrow(expect.objectContaining({code: "BREW_RAW_HTML_FORBIDDEN"}));

		const script = brew();
		script[0].body.spell[0].entries = ["<img src=x onerror=alert(1)>"];
		expect(() => validateCampaignBrewBundle(script)).toThrow(expect.objectContaining({code: "BREW_RAW_HTML_FORBIDDEN"}));
	});

	it.each([
		"javascript:alert(1)",
		"java\nscript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"vbscript:msgbox(1)",
	])("rejects unsafe URL schemes: %s", url => {
		const docs = brew();
		docs[0].body.spell[0].entries = [{type: "link", text: "unsafe", href: {type: "external", url}}];
		expect(() => validateCampaignBrewBundle(docs)).toThrow(expect.objectContaining({
			code: expect.stringMatching(/BREW_(?:URL|RAW_HTML)_FORBIDDEN/),
		}));
	});

	it("rejects prototype-polluting keys", () => {
		const docs = brew();
		docs[0].body._meta.otherSources = JSON.parse("{\"__proto__\":{\"polluted\":true}}");
		expect(() => validateCampaignBrewBundle(docs)).toThrow(expect.objectContaining({code: "BREW_KEY_FORBIDDEN"}));
		expect({}.polluted).toBeUndefined();
	});

	it("rejects entity-encoded and attribute-breaking source URLs", () => {
		const docs = brew();
		docs[0].body._meta.sources[0].url = "jav&#x61;script:alert(1)\" target=\"_self";
		expect(() => validateCampaignBrewBundle(docs)).toThrow(expect.objectContaining({code: "BREW_URL_FORBIDDEN"}));
	});
});

describe("campaign rules", () => {
	it("fills defaults and exposes an explicit schema version", () => {
		expect(CAMPAIGN_RULES_SCHEMA_VERSION).toBe(1);
		expect(normalizeCampaignRules({enableTgtt: false})).toEqual({
			...DEFAULT_CAMPAIGN_RULES,
			enableTgtt: false,
		});
	});

	it("rejects unknown and incorrectly typed rules", () => {
		expect(() => normalizeCampaignRules({unknown: true})).toThrow(expect.objectContaining({code: "RULES_INVALID"}));
		expect(() => normalizeCampaignRules({thelemar_jumping: "yes"})).toThrow(expect.objectContaining({code: "RULES_INVALID"}));
		expect(() => normalizeCampaignRules({exhaustionRules: "custom"})).toThrow(expect.objectContaining({code: "RULES_INVALID"}));
	});
});
