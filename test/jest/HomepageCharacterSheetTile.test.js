import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const CHARACTER_SHEET_LINKS = [...HTML.matchAll(/<a\b[^>]*href="charactersheet\.html"[^>]*>[\s\S]*?<\/a>/g)]
	.map(match => ({html: match[0], index: match.index}));

const getClassNames = anchor => anchor.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [];

const getInnerMarkup = anchor => anchor
	.replace(/^<a\b[^>]*>/, "")
	.replace(/<\/a>$/, "")
	.trim();

const getVisibleLabel = anchor => anchor
	.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/)?.[1]
	.replace(/<br\s*\/?>/g, " ")
	.replace(/<[^>]+>/g, "")
	.replace(/\s+/g, " ")
	.trim();

describe("homepage Character Sheet tile", () => {
	it("keeps one desktop copy and one narrow/mobile copy", () => {
		expect(CHARACTER_SHEET_LINKS).toHaveLength(2);

		const classLists = CHARACTER_SHEET_LINKS.map(({html}) => getClassNames(html));
		expect(classLists.filter(classes => classes.includes("home__narrow-hidden"))).toHaveLength(1);
		expect(classLists.filter(classes => classes.includes("home__narrow-visible"))).toHaveLength(1);

		classLists.forEach((classes) => {
			expect(classes).toEqual(expect.arrayContaining([
				"home__btn-page",
				"ve-btn",
				"ve-btn-default",
				"home__btn-player",
			]));
		});
	});

	it("keeps both copies in the Players grid and in the intended responsive order", () => {
		const playersStart = HTML.indexOf("<div class=\"home__split home__split--players");
		const playersEnd = HTML.indexOf("<div class=\"ve-my-4 home__mobile-hidden", playersStart);
		const optionalFeatures = HTML.indexOf("href=\"optionalfeatures.html\"", playersStart);
		const mobileMarker = HTML.indexOf("<!-- mobile only -->", playersStart);
		const mobileBackgrounds = HTML.indexOf("href=\"backgrounds.html\"", mobileMarker);

		expect(playersStart).toBeGreaterThanOrEqual(0);
		expect(playersEnd).toBeGreaterThan(playersStart);

		const desktopLink = CHARACTER_SHEET_LINKS.find(({html}) => getClassNames(html).includes("home__narrow-hidden"));
		const mobileLink = CHARACTER_SHEET_LINKS.find(({html}) => getClassNames(html).includes("home__narrow-visible"));

		expect(desktopLink.index).toBeGreaterThan(optionalFeatures);
		expect(desktopLink.index).toBeLessThan(mobileMarker);
		expect(mobileLink.index).toBeGreaterThan(mobileMarker);
		expect(mobileLink.index).toBeLessThan(mobileBackgrounds);
		expect(CHARACTER_SHEET_LINKS.every(({index}) => index > playersStart && index < playersEnd)).toBe(true);
	});

	it("keeps the two responsive copies visually and accessibly identical", () => {
		expect(getInnerMarkup(CHARACTER_SHEET_LINKS[0].html)).toBe(getInnerMarkup(CHARACTER_SHEET_LINKS[1].html));

		CHARACTER_SHEET_LINKS.forEach(({html: anchor}) => {
			expect(getVisibleLabel(anchor)).toBe("Character Sheet");
			expect(anchor).toMatch(/class="[^"]*\bhome__icn-character-sheet\b[^"]*"\s+aria-hidden="true"/);
			expect(anchor).toMatch(/class="[^"]*\bhome__lbl-page\b[^"]*"/);
		});
	});
});
