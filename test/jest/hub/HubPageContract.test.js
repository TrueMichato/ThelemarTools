import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("campaign hub pages", () => {
	const hubHtml = read("hub.html");
	const campaignHtml = read("campaign.html");
	const scss = read("scss/hub.scss");
	const navigation = read("js/navigation.js");

	it("exposes signed-out, loading, error, and signed-in states", () => {
		for (const id of ["hub-loading", "hub-error", "hub-signed-out", "hub-signed-in"]) {
			expect(hubHtml).toContain(`id="${id}"`);
			expect(campaignHtml).toContain(`id="${id}"`);
		}
	});

	it("keeps campaign creation inline and keyboard-addressable", () => {
		expect(hubHtml).toContain("id=\"hub-create-form\"");
		expect(hubHtml).toContain("for=\"hub-campaign-name\"");
		expect(hubHtml).toContain("id=\"hub-create-submit\"");
		expect(hubHtml).not.toContain("<dialog");
	});

	it("loads the same hub client on both surfaces", () => {
		expect(hubHtml).toContain("src=\"js/hub/hub-page.js\"");
		expect(campaignHtml).toContain("src=\"js/hub/hub-page.js\"");
	});

	it("loads localforage before StorageUtil on the campaign page", () => {
		expect(campaignHtml.indexOf("src=\"lib/localforage.js\"")).toBeLessThan(campaignHtml.indexOf("src=\"js/utils.js\""));
		expect(campaignHtml.indexOf("src=\"js/utils.js\"")).toBeLessThan(campaignHtml.indexOf("src=\"js/hub/hub-page.js\""));
	});

	it("preserves the complete hub URL through signed-out OAuth", () => {
		expect(hubHtml).toContain("id=\"hub-sign-in\"");
		const source = read("js/hub/hub-page.js");
		expect(source).toContain("window.location.search");
		expect(source).toContain("sessionStorage.setItem(\"hub-pending-invite\"");
		expect(source).toContain("joinUrl.hash");
		expect(source).not.toContain("searchParams.set(\"invite\"");
	});

	it("clears a pending invite failure without aborting Hub setup", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toMatch(/try\s*\{[\s\S]*pRedeemInvite[\s\S]*\}\s*catch \(error\)\s*\{[\s\S]*renderError[\s\S]*\}\s*finally\s*\{[\s\S]*sessionStorage\.removeItem\("hub-pending-invite"\)/);
		expect(source.indexOf(`sessionStorage.removeItem("hub-pending-invite")`))
			.toBeLessThan(source.indexOf(`const form = document.getElementById("hub-create-form")`));
	});

	it("defines responsive, focus-visible, and reduced-motion behavior", () => {
		expect(scss).toContain("@media (width <= 720px)");
		expect(scss).toContain(":focus-visible");
		expect(scss).toContain("@media (prefers-reduced-motion: reduce)");
	});

	it("makes the campaign hub reachable from global navigation", () => {
		expect(navigation).toContain("page: \"hub.html\", aText: \"Campaign Hub\"");
	});

	it("declares pending-transfer rendering at module scope", () => {
		const source = read("js/hub/hub-page.js");
		expect(source).toMatch(/^async function renderPendingTransfers/m);
		expect(source.indexOf("async function renderPendingTransfers")).toBeLessThan(source.indexOf("async function pInitCampaignForms"));
	});

	it("initializes every rules control from the active campaign version", () => {
		const source = read("js/hub/hub-page.js");
		for (const key of [
			"enableTgtt",
			"exhaustionRules",
			"thelemar_carryWeight",
			"thelemar_jumping",
			"thelemar_linguisticsBonus",
			"thelemar_criticalRolls",
		]) expect(source).toContain(`activeRules.${key}`);
	});
});
