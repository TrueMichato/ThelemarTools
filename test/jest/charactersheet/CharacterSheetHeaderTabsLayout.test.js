/**
 * Header & tabs compaction (bug #7) + Arcane Shot full-width row (bug #10).
 *
 * Presentation/structure fixes that jsdom can't measure, so — like the existing
 * CharacterSheetCombatTabLayout test — these pin the rules at the source level:
 *  - #7 The header card's bottom margin, header-row vertical padding, the main
 *    tab bar's bottom margin + container top padding, and the tab-link vertical
 *    padding were all trimmed to remove wasted vertical space at the top of the
 *    sheet. The redundant Bootstrap `mb-3` class on the tabs <ul> (overridden by
 *    the higher-specificity #charsheet-tabs margin rule, so visually dead) was
 *    removed to reconcile the stacked declarations.
 *  - #10 The combat-resources grid full-width span group now also lists
 *    .charsheet__arcane-shot-section, so it spans 1 / -1 like its sibling
 *    Sneak Attack / Weapon Riders sections instead of being confined to a single
 *    narrow grid cell (which forced its content to wrap into a column).
 *
 * The [data-textsize] font-size scaling for the header/tabs must remain intact
 * (it scales font-size only; the padding/margin trims are static rem), so we
 * also pin that those scaling rules still exist.
 */

import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const html = fs.readFileSync(path.resolve(REPO_ROOT, "charactersheet.html"), "utf8");
const css = fs.readFileSync(path.resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");

/**
 * Body of the first CSS rule whose selector block STARTS with the literal text
 * `selectorAnchor` (matched verbatim, so multi-selector blocks can be anchored
 * on their first selector). Returns the text between the opening `{` and the
 * next `}` — fine for these flat (non-nested) declaration blocks.
 */
function ruleBodyByAnchor (selectorAnchor) {
	const at = css.indexOf(selectorAnchor);
	if (at === -1) return null;
	const open = css.indexOf("{", at);
	if (open === -1) return null;
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

describe("#7 header & tab bar compaction", () => {
	it("trims the header card bottom margin from cs-space-lg (1.5rem) to cs-space-sm", () => {
		const body = ruleBodyByAnchor(".charsheet__main-header {");
		expect(body).not.toBeNull();
		const mb = body.match(/margin-bottom:\s*([^;]+);/);
		expect(mb).not.toBeNull();
		expect(mb[1].trim()).toBe("var(--cs-space-sm, 0.5rem) !important");
		expect(mb[1]).not.toContain("--cs-space-lg");
		expect(mb[1]).not.toContain("1.5rem");
	});

	it("trims the header-row vertical padding to 0.375rem", () => {
		const body = ruleBodyByAnchor(".charsheet__header-row {");
		expect(body).not.toBeNull();
		const pad = body.match(/padding:\s*([^;]+);/);
		expect(pad).not.toBeNull();
		expect(pad[1].trim()).toBe("0.375rem 0.875rem");
		expect(pad[1]).not.toContain("0.5rem 0.875rem");
	});

	it("trims the tab bar bottom margin from cs-space-lg to cs-space-md and top padding to cs-space-xs", () => {
		const body = ruleBodyByAnchor(".charsheet__main-tabs,");
		expect(body).not.toBeNull();
		const mb = body.match(/margin-bottom:\s*([^;]+);/);
		expect(mb).not.toBeNull();
		expect(mb[1].trim()).toBe("var(--cs-space-md, 1rem) !important");
		expect(mb[1]).not.toContain("--cs-space-lg");
		expect(mb[1]).not.toContain("1.5rem");
		// container padding top trimmed sm -> xs (shorthand: top right bottom)
		const pad = body.match(/padding:\s*([^;]+);/);
		expect(pad).not.toBeNull();
		expect(pad[1].trim()).toBe("var(--cs-space-xs, 0.25rem) var(--cs-space-sm, 0.5rem) 0");
	});

	it("trims the tab-link vertical padding to cs-space-xs (keeps horizontal cs-space-lg)", () => {
		const body = ruleBodyByAnchor("#charsheet-tabs > li > a {");
		expect(body).not.toBeNull();
		const pad = body.match(/padding:\s*([^;]+);/);
		expect(pad).not.toBeNull();
		expect(pad[1].trim()).toBe("var(--cs-space-xs, 0.25rem) var(--cs-space-lg, 1rem)");
		expect(pad[1]).not.toContain("--cs-space-sm, 0.5rem) var(--cs-space-lg");
	});

	it("removes the redundant Bootstrap mb-3 class from the tabs <ul>", () => {
		const m = html.match(/<ul class="([^"]*)" id="charsheet-tabs">/);
		expect(m).not.toBeNull();
		expect(m[1]).toContain("charsheet__main-tabs");
		expect(m[1]).toContain("no-print");
		expect(m[1].split(/\s+/)).not.toContain("mb-3");
	});

	it("keeps the [data-textsize] header/tab font-size scaling rules intact", () => {
		// header scales via font-size only (unaffected by padding trims)
		const headerScale = ruleBodyByAnchor(".charsheet-page[data-textsize] .charsheet__main-header,");
		expect(headerScale).not.toBeNull();
		expect(headerScale).toMatch(/font-size:\s*calc\(1rem \* var\(--cs-text-scale/);
		// tab links still scale font-size
		const tabScale = ruleBodyByAnchor(".charsheet-page[data-textsize] .charsheet__main-tabs a,");
		expect(tabScale).not.toBeNull();
		expect(tabScale).toMatch(/font-size:\s*var\(--cs-text-sm/);
	});
});

describe("#10 Arcane Shot section spans full width like its siblings", () => {
	it("includes .charsheet__arcane-shot-section in the combat-resources grid-column 1/-1 span group", () => {
		const body = ruleBodyByAnchor(".charsheet__combat-resources-list > .ve-muted,");
		expect(body).not.toBeNull();
		expect(body).toContain("grid-column: 1 / -1");

		// the span rule's selector list names the arcane-shot child selector
		// alongside the two siblings it should match
		const at = css.indexOf(".charsheet__combat-resources-list > .ve-muted,");
		const open = css.indexOf("{", at);
		const selectorList = css.slice(at, open);
		expect(selectorList).toContain(
			".charsheet__combat-resources-list > .charsheet__arcane-shot-section",
		);
		expect(selectorList).toContain(
			".charsheet__combat-resources-list > .charsheet__sneak-attack-section",
		);
		expect(selectorList).toContain(
			".charsheet__combat-resources-list > .charsheet__weapon-riders-section",
		);
	});
});
