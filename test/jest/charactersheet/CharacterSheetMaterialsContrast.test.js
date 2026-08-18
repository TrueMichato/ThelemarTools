import {describe, it, expect} from "@jest/globals";
import fs from "fs";
import path from "path";

/**
 * Contrast regression guard for the item-materials status colours.
 *
 * Every material status the sheet can show — magic-capacity overload, a worn or
 * destroyed item, the two risk tiers in the picker — is a coloured chip: semantic
 * ink on a tint of its own hue. That construction fails silently. Nudge
 * `--cs-danger` a shade for a fill somewhere else on the sheet and the chip's text
 * and its background move *together*, so the pair keeps looking deliberate while
 * quietly dropping under AA.
 *
 * These assertions read the real token values out of the real stylesheet, so a
 * future palette change that breaks a materials chip fails here rather than in
 * someone's eyes.
 */

const CSS_DIR = path.resolve(process.cwd(), "css");
const MODERN = fs.readFileSync(path.join(CSS_DIR, "charactersheet-modern.css"), "utf8");

const _hexToRgb = (hex) => {
	const h = hex.replace("#", "").trim();
	const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
	return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};

const _relLuminance = (rgb) => {
	const [r, g, b] = rgb.map(c => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (fg, bg) => {
	const a = _relLuminance(fg); const b = _relLuminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** `color-mix(in srgb, <fg> <pct>%, transparent)` composited over an opaque backdrop. */
const mixOver = (tint, pct, backdrop) => tint.map((c, i) => Math.round((c * pct / 100) + (backdrop[i] * (1 - pct / 100))));

/**
 * Token values are theme-scoped by selector: night lives in the bare `:root`,
 * day in `:root:not(.ve-night-mode)`. Slice the block, then read the token.
 */
const _readToken = (theme, token) => {
	const startPat = theme === "night" ? /^:root \{$/m : /^:root:not\(\.ve-night-mode\) \{$/m;
	const start = MODERN.search(startPat);
	if (start < 0) throw new Error(`Could not find the ${theme} token block`);
	const block = MODERN.slice(start, MODERN.indexOf("\n}", start));
	const hit = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
	if (!hit) throw new Error(`Token --${token} is not defined for ${theme}. Chips that read it will fall through to the fill hue and lose contrast.`);
	return _hexToRgb(hit[1]);
};

// The surfaces a materials chip can actually sit on. `bg-elevated` is the modal —
// the harder of the two, and where every material picker chip lives.
const SURFACES = ["cs-bg-surface", "cs-bg-elevated"];

// Each entry: the ink token, the hue tinted behind it, and the tint strength the
// stylesheet uses. Kept in step with `css/charactersheet.css` by hand — a mismatch
// here is itself worth catching in review.
const CHIPS = [
	{what: "magic capacity — overloaded", ink: "cs-danger-text", tint: "cs-danger", pct: 12},
	{what: "degradation badge — destroyed", ink: "cs-danger-text", tint: "cs-danger", pct: 14},
	{what: "degradation badge — worn", ink: "cs-warning-text", tint: "cs-warning", pct: 12},
	{what: "picker risk flag — destroys", ink: "cs-danger-text", tint: "cs-danger", pct: 12},
	{what: "picker risk flag — degrades", ink: "cs-warning-text", tint: "cs-warning", pct: 12},
	{what: "magic capacity — within capacity", ink: "cs-success-text", tint: "cs-success", pct: 12},
];

// Untinted ink, for the degradation line in the item modal.
const PLAIN_TEXT = [
	{what: "degradation line — destroyed", ink: "cs-danger-text"},
	{what: "degradation line — worn", ink: "cs-warning-text"},
];

const AA = 4.5;

describe("materials status colours meet WCAG AA", () => {
	for (const theme of ["night", "day"]) {
		describe(theme, () => {
			for (const surface of SURFACES) {
				for (const chip of CHIPS) {
					it(`${chip.what} on ${surface}`, () => {
						const backdrop = _readToken(theme, surface);
						const ratio = contrastRatio(
							_readToken(theme, chip.ink),
							mixOver(_readToken(theme, chip.tint), chip.pct, backdrop),
						);
						expect(ratio).toBeGreaterThanOrEqual(AA);
					});
				}

				for (const line of PLAIN_TEXT) {
					it(`${line.what} on ${surface}`, () => {
						const ratio = contrastRatio(_readToken(theme, line.ink), _readToken(theme, surface));
						expect(ratio).toBeGreaterThanOrEqual(AA);
					});
				}
			}
		});
	}

	it("keeps the ink token distinct from the fill token it sits on", () => {
		// The failure this whole file exists to prevent: someone "simplifies" the
		// `var(--cs-danger-text, var(--cs-danger))` chain down to one token, and the
		// text becomes the same hue as its own background tint.
		for (const theme of ["night", "day"]) {
			for (const pair of [["cs-danger-text", "cs-danger"], ["cs-warning-text", "cs-warning"], ["cs-success-text", "cs-success"]]) {
				expect(_readToken(theme, pair[0])).not.toEqual(_readToken(theme, pair[1]));
			}
		}
	});
});
