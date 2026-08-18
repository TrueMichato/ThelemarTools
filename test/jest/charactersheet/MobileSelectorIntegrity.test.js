/**
 * Mobile selector integrity
 *
 * The mobile layer does not own any `charsheet__*` class. It only *reaches into*
 * markup that the desktop modules and `charactersheet.html` render. That makes
 * every `charsheet__*` selector in the mobile layer a silent dependency: rename
 * the element on the desktop side, or invent a selector that was never real, and
 * the mobile code fails without an error, a warning or a visible symptom. It
 * simply stops finding things.
 *
 * That is not hypothetical. The long-press menu shipped with branches pointed at
 * `.charsheet__inventory-item`, `.charsheet__resource-item`,
 * `.charsheet__inventory-equip`, `.charsheet__inventory-remove`,
 * `.charsheet__inventory-name`, `.charsheet__resource-reset`,
 * `.charsheet__resource-edit` and `.charsheet__resource-decrement` — eight class
 * names that exist nowhere in the product. The menu quietly rendered nothing.
 * The mobile CSS invented a horizontally-scrolling `.charsheet__spell-slots-grid`
 * that styled no element on any screen.
 *
 * Hence this test. It is a dependency check, not a behaviour test: every
 * `charsheet__*` token the mobile layer names must be findable in source that
 * actually produces it.
 *
 * ── Why the corpus includes the HTML ──────────────────────────────────────────
 * A first pass at this audit scanned only `js/charactersheet/` and wrongly
 * condemned `.charsheet__combat-stat--clickable` as dead. It is real — authored
 * directly in `charactersheet.html` on `#charsheet-box-initiative`. A scan that
 * misses the static markup manufactures false positives and invites someone to
 * "fix" working code. The HTML is not optional context here; it is a first-class
 * source of truth alongside the JS.
 */

import {describe, expect, it} from "@jest/globals";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

const PATH_MOBILE_JS = path.join(ROOT, "js/charactersheet/charactersheet-mobile.js");
const PATH_MOBILE_CSS = path.join(ROOT, "css/charactersheet-mobile.css");
const DIR_CHARSHEET_JS = path.join(ROOT, "js/charactersheet");
const PATH_HTML = path.join(ROOT, "charactersheet.html");

/** Anything matching `charsheet__foo-bar`, the project's BEM-ish block prefix. */
const RE_CLASS_TOKEN = /charsheet__[a-z0-9-]+/g;

/**
 * Everything that legitimately *produces* `charsheet__*` markup: the desktop
 * character-sheet modules plus the static page. The mobile files are excluded on
 * purpose — a selector that appears only in the mobile layer is precisely the
 * defect being hunted, so letting mobile vouch for itself would defeat the test.
 */
function readProducerCorpus () {
	const parts = fs.readdirSync(DIR_CHARSHEET_JS)
		.filter(it => it.endsWith(".js"))
		.filter(it => !it.includes("charactersheet-mobile"))
		.map(it => fs.readFileSync(path.join(DIR_CHARSHEET_JS, it), "utf8"));

	// The static markup is a first-class producer, not a footnote. See the header.
	parts.push(fs.readFileSync(PATH_HTML, "utf8"));

	return parts.join("\n");
}

/**
 * Collect class tokens, minus those the file itself defines.
 *
 * A CSS file naturally *declares* selectors; the interesting question for the
 * mobile stylesheet is the same as for the JS — does the thing it is styling
 * exist? So both are treated as consumers.
 */
function extractClassTokens (source) {
	return [...new Set(source.match(RE_CLASS_TOKEN) || [])].sort();
}

describe("Mobile selector integrity", () => {
	const corpus = readProducerCorpus();

	it("names only classes that non-mobile source actually produces (JS)", () => {
		const tokens = extractClassTokens(fs.readFileSync(PATH_MOBILE_JS, "utf8"));

		// A sanity floor: if the extraction silently stops matching, an empty list
		// would pass every assertion below and the guard would rot into a no-op.
		expect(tokens.length).toBeGreaterThan(20);

		const orphans = tokens.filter(it => !corpus.includes(it));
		expect(orphans).toEqual([]);
	});

	it("styles only classes that non-mobile source actually produces (CSS)", () => {
		const tokens = extractClassTokens(fs.readFileSync(PATH_MOBILE_CSS, "utf8"));

		expect(tokens.length).toBeGreaterThan(20);

		const orphans = tokens.filter(it => !corpus.includes(it));
		expect(orphans).toEqual([]);
	});

	it("keeps the long-press trigger and the menu builder on one selector list", () => {
		const source = fs.readFileSync(PATH_MOBILE_JS, "utf8");

		// The two halves of the gesture once held separate, drifting copies of the
		// same list. Requiring the constant to be the only spelling keeps them
		// honest: the trigger and the menu can never again disagree about which
		// rows are long-pressable.
		expect(source).toContain("static LONG_PRESS_SELECTOR");
		expect(source).toContain("closest(CharacterSheetMobile.LONG_PRESS_SELECTOR)");
	});
});

describe("Long-press action-label derivation", () => {
	/*
	 * `_buildRowActionItems` discovers a row's real buttons rather than hardcoding
	 * them, because the two row types that use it name their controls
	 * incompatibly: inventory buttons are icon-only glyphicons carrying a `title`,
	 * while resource buttons are text-labelled ("Use", "+") with no `title` at
	 * all — and resource rows are rendered from at least five separate call sites.
	 * Discovery covers all of them and survives renames.
	 *
	 * The cost of discovery is that labels must be *derived*, which is what these
	 * two pure statics do. They are the part most likely to produce something
	 * user-visible and wrong, so they are tested directly.
	 */
	const CharacterSheetMobile = (() => {
		globalThis.document = globalThis.document || {
			readyState: "complete",
			querySelector: () => null,
			addEventListener: () => {},
		};
		globalThis.window = globalThis;
		globalThis.navigator = globalThis.navigator || {};
		return null;
	})();

	let Cls;

	beforeAll(async () => {
		await import("../../../js/charactersheet/charactersheet-mobile.js");
		Cls = globalThis.CharacterSheetMobile;
	});

	/** Minimal button stand-in — the statics only read these four properties. */
	const mkBtn = ({title, ariaLabel, text, className} = {}) => ({
		getAttribute: (name) => {
			if (name === "title") return title ?? null;
			if (name === "aria-label") return ariaLabel ?? null;
			return null;
		},
		textContent: text ?? "",
		className: className ?? "",
	});

	it("prefers the title attribute, which touch users can never hover to read", () => {
		expect(Cls.deriveActionLabel(mkBtn({title: "Equip item", text: "⚔"}))).toBe("Equip item");
	});

	it("falls back to aria-label when there is no title", () => {
		expect(Cls.deriveActionLabel(mkBtn({ariaLabel: "Remove item", text: "✕"}))).toBe("Remove item");
	});

	it("uses visible text when it is actually a word", () => {
		expect(Cls.deriveActionLabel(mkBtn({text: "Use"}))).toBe("Use");
	});

	it("rejects glyph-only text that would render as a meaningless menu row", () => {
		// "+" and "✕" are legible as buttons in context but useless as menu labels.
		expect(Cls.deriveActionLabel(mkBtn({text: "+", className: "charsheet__resource-restore-btn"})))
			.toBe("Restore");
		expect(Cls.deriveActionLabel(mkBtn({text: "✕", className: "charsheet__item-remove"})))
			.toBe("Remove");
	});

	it("derives a readable label from the class name as a last resort", () => {
		expect(Cls.deriveLabelFromClassName("charsheet__resource-restore-btn")).toBe("Restore");
		expect(Cls.deriveLabelFromClassName("charsheet__item-equip")).toBe("Equip");
		expect(Cls.deriveLabelFromClassName("charsheet__spell-remove")).toBe("Remove");
	});

	it("returns null for an unlabelable button so the caller can drop it", () => {
		// `_buildRowActionItems` skips falsy labels. A nameless menu row would be
		// worse than no row: the button is still tappable directly in the row, but
		// a blank entry in the menu is undecidable.
		expect(Cls.deriveActionLabel(mkBtn({text: "", className: ""}))).toBeNull();
	});
});
