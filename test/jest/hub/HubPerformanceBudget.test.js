import fs from "node:fs";
import {gzipSync} from "node:zlib";
import {validateCampaignBrewBundle} from "../../../server/src/campaign-content.js";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {makeSelectedRecord, serializeActiveCampaignRecord} from "../../../js/hub/hub-active-campaign-record.js";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("hub performance budgets", () => {
	it.each(["hub.html", "campaign.html"])("%s has a lightweight first-party boot graph", page => {
		const html = read(page);
		const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(([, src]) => src);
		expect(scripts).toEqual([
			"js/styleswitch.js",
			"js/hub/hub-page.js",
		]);
		for (const forbidden of [
			"localforage",
			"navigation.js",
			"omnisearch",
			"filter.js",
			"utils-dataloader",
			"utils-font",
			"utils-brew",
			"render.js",
			"elasticlunr",
			"sw-injector",
		]) expect(html).not.toContain(forbidden);
	});

	it("rejects campaign brew above one megabyte", () => {
		const huge = [{
			head: {filename: "huge.json"},
			body: {
				_meta: {sources: [{json: "BIG"}]},
				spell: [{name: "Large", source: "BIG", entries: ["x".repeat(1024 * 1024)]}],
			},
		}];
		expect(() => validateCampaignBrewBundle(huge)).toThrow(expect.objectContaining({code: "BREW_TOO_LARGE"}));
	});

	it("rejects HTTP bodies above two megabytes before route handling", async () => {
		const app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: () => "", pExchangeCode: async () => ({})},
			config: {appOrigin: "https://tools.example", cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32)},
		});
		const response = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {"content-type": "application/json"},
			payload: JSON.stringify({name: "x".repeat(2 * 1024 * 1024 + 1)}),
		});
		expect(response.statusCode).toBe(413);
		await app.close();
	});

	it("keeps the active-context selection modules inside the 8 KiB transfer budget", () => {
		const modules = [
			"js/hub/hub-active-campaign-record.js",
			"js/hub/hub-active-campaign-store.js",
			"js/hub/hub-active-campaign-channel.js",
			"js/hub/hub-active-campaign-coordinator.js",
		];
		// Approximate minification the way a build would: drop comments and leading indentation,
		// which is what the ADR budget is written against.
		const minified = modules
			.map(path => read(path)
				.replace(/\/\*\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "")
				.replace(/^\t+/gm, "")
				.replace(/\n{2,}/g, "\n"))
			.join("\n");
		const gzipped = gzipSync(Buffer.from(minified, "utf8")).length;
		expect(gzipped).toBeLessThanOrEqual(8 * 1024);
	});

	it("keeps the persisted selection record inside the 1 KiB budget", () => {
		const record = makeSelectedRecord({
			accountId: "11111111-1111-4111-8111-111111111111",
			campaignId: "33333333-3333-4333-8333-333333333333",
			revision: Number.MAX_SAFE_INTEGER,
			updatedAt: Number.MAX_SAFE_INTEGER,
			writerId: "55555555-5555-4555-8555-555555555555",
		});
		expect(serializeActiveCampaignRecord(record).length).toBeLessThanOrEqual(1024);
	});

	it("keeps the selection modules free of heavy dependencies", () => {
		for (const path of [
			"js/hub/hub-active-campaign-record.js",
			"js/hub/hub-active-campaign-store.js",
			"js/hub/hub-active-campaign-channel.js",
			"js/hub/hub-active-campaign-coordinator.js",
		]) {
			const source = read(path);
			const imports = [...source.matchAll(/from "([^"]+)"/g)].map(([, specifier]) => specifier);
			for (const specifier of imports) {
				// Everything must resolve inside `js/hub/`, so the lightweight Hub shells stay light.
				expect(specifier.startsWith("./")).toBe(true);
				for (const forbidden of ["utils.js", "utils-brew", "utils-dataloader", "render.js", "filter.js", "navigation.js"]) {
					expect(specifier).not.toContain(forbidden);
				}
			}
		}
	});
});
