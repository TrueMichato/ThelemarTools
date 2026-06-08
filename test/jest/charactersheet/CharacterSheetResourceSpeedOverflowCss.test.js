/**
 * Display-overflow fixes (round 5, Bugs 3 + 14) — generic Resources panel,
 * inline speed display, and lore-skill names.
 *
 * Symptoms (screenshot-confirmed):
 *   - #3a the inline Speed stat box clipped the trailing unit ("60 ft." → "60 f")
 *     at larger [data-textsize] settings because the speed value carries a unit
 *     and rendered at the same oversized 3xl tier as AC/Initiative inside an
 *     overflow:hidden box.
 *   - #3b Resources-panel names wrapped MID-WORD ("Stamina" → "Stamin a") because
 *     the name used overflow-wrap:anywhere + min-width:0, collapsing its min size
 *     to a single character and letting it be crushed by the fixed uses block.
 *   - #14 lore-skill names truncated to an ellipsis ("…") and were illegible.
 *
 * These are presentation/CSS fixes; jsdom cannot measure real pixels, so — like
 * the existing CharacterSheetSpeedModalLayout test — these lock in the CSS rules
 * at the source level (the correct properties on the correct selectors).
 */

import fs from "fs";
import path from "path";

const cssSrc = fs.readFileSync(
	path.resolve(process.cwd(), "css/charactersheet.css"),
	"utf8",
);

/**
 * Extract the declaration block (between the matching braces) for the first rule
 * whose selector text exactly contains `selector`. Returns the inner body text.
 */
function ruleBody (selector) {
	// Find a "<selector> {" occurrence (allowing whitespace before the brace).
	const re = new RegExp(`(^|[\\n}])\\s*${selector.replace(/[.*+?^${}()|[\]\\#-]/g, "\\$&")}\\s*\\{`, "m");
	const m = re.exec(cssSrc);
	if (!m) return null;
	const open = cssSrc.indexOf("{", m.index);
	const close = cssSrc.indexOf("}", open);
	expect(close).toBeGreaterThan(open);
	return cssSrc.slice(open + 1, close);
}

/**
 * Concatenate the bodies of EVERY rule whose selector exactly matches `selector`
 * (some selectors carry more than one rule block across the file).
 */
function allRuleBodies (selector) {
	const esc = selector.replace(/[.*+?^${}()|[\]\\#-]/g, "\\$&");
	const re = new RegExp(`(^|[\\n}])\\s*${esc}\\s*\\{`, "mg");
	let m;
	const bodies = [];
	while ((m = re.exec(cssSrc)) !== null) {
		const open = cssSrc.indexOf("{", m.index);
		const close = cssSrc.indexOf("}", open);
		bodies.push(cssSrc.slice(open + 1, close));
	}
	return bodies.join("\n");
}

describe("#3a — inline speed display no longer clips its unit", () => {
	test("the speed value renders at a smaller tier than the 3xl AC/Initiative numbers", () => {
		const body = ruleBody(".charsheet__combat-stat-value#charsheet-disp-speed");
		expect(body).toBeTruthy();
		// 2xl (1.5rem) rather than the base/[data-textsize] 3xl (2rem) bump.
		expect(body).toMatch(/font-size:\s*var\(--cs-text-2xl/);
		expect(body).not.toMatch(/font-size:\s*var\(--cs-text-3xl/);
	});

	test("the speed value can shrink/wrap inside its clipped box instead of overflowing", () => {
		const body = ruleBody(".charsheet__combat-stat-value#charsheet-disp-speed");
		expect(body).toMatch(/min-width:\s*0/);
		expect(body).toMatch(/max-width:\s*100%/);
		expect(body).toMatch(/box-sizing:\s*border-box/);
		// Still wraps multi-segment (walk/fly/climb) values onto new lines.
		expect(body).toMatch(/flex-wrap:\s*wrap/);
	});

	test("the speed box trims its horizontal padding (speed-scoped; AC/Init untouched)", () => {
		const body = allRuleBodies(".charsheet__combat-stat--speed");
		// A speed-scoped padding rule exists (separate from the shared stat padding).
		expect(body).toMatch(/padding-(left|right):/);
	});
});

describe("#3b — Resources panel names wrap cleanly, never mid-word", () => {
	test("the resource name breaks at word boundaries, not anywhere", () => {
		const body = ruleBody(".charsheet__resource-name");
		expect(body).toBeTruthy();
		// The mid-word-break culprits are gone...
		expect(body).not.toMatch(/overflow-wrap:\s*anywhere/);
		expect(body).not.toMatch(/word-break:\s*break-word/);
		// ...replaced with a last-resort break-word and removal of min-width:0 so
		// the name can't be squeezed below its longest word.
		expect(body).toMatch(/overflow-wrap:\s*break-word/);
		expect(body).not.toMatch(/min-width:\s*0/);
	});

	test("the row wraps so the uses block drops to a second line under pressure", () => {
		const body = ruleBody(".charsheet__resource-row");
		expect(body).toMatch(/flex-wrap:\s*wrap/);
		expect(body).toMatch(/row-gap:/);
	});

	test("the uses block does not shrink (so it can't crush the name)", () => {
		const body = ruleBody(".charsheet__resource-uses");
		expect(body).toMatch(/flex:\s*0 0 auto/);
	});

	test("the resources list keeps its bounded scroll", () => {
		const body = ruleBody(".charsheet__resources-list");
		expect(body).toMatch(/max-height:\s*200px/);
		expect(body).toMatch(/overflow-y:\s*auto/);
	});

	test("the combat-tab resource name has a defensive clean-wrap rule", () => {
		const body = ruleBody(".charsheet__combat-resource-name");
		expect(body).toBeTruthy();
		expect(body).toMatch(/overflow-wrap:\s*break-word/);
		expect(body).toMatch(/min-width:\s*0/);
	});
});

describe("#14 — lore-skill names wrap and are legible (no ellipsis truncation)", () => {
	test("the name wraps instead of truncating to an ellipsis", () => {
		const body = ruleBody(".charsheet__lore-skill-name");
		expect(body).toBeTruthy();
		expect(body).not.toMatch(/text-overflow:\s*ellipsis/);
		expect(body).not.toMatch(/white-space:\s*nowrap/);
		expect(body).not.toMatch(/overflow:\s*hidden/);
		expect(body).toMatch(/white-space:\s*normal/);
		expect(body).toMatch(/overflow-wrap:\s*break-word/);
	});

	test("the reorder bump buttons stay fixed-size against a wrapped name", () => {
		const body = ruleBody(".charsheet__lore-skill-bump");
		expect(body).toMatch(/flex-shrink:\s*0/);
	});
});
