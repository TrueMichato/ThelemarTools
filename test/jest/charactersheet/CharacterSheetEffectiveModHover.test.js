import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

/*
 * Bug #5 — Hovering the "effective" modifier (the parenthesised value with
 * active mods) must surface the SAME breakdown tooltip as the regular
 * (canonical) modifier.
 *
 * Root cause: `_formatModWithEffective` wraps the effective value in a span
 * that carries its own `title`. A child element's `title` overrides an
 * ancestor's `title` on hover, so the effective span used to show a generic
 * "Effective bonus (with active mods)" hint instead of the row breakdown.
 *
 * Fix: skills / saves / ability-score renderers now pass the full breakdown
 * as `{titleEffective: <breakdown>}` so the effective span carries the same
 * breakdown text as the row/cell.
 *
 * We keep a byte-faithful replica of the helper pinned to the production
 * source (same pattern as CharacterSheetFormatModEffective.test.js).
 */

function _formatModWithEffective (canonical, effective, opts = {}) {
	const kind = opts.kind || "mod";
	const can = Math.trunc(canonical);
	const eff = Math.trunc(effective);
	const fmt = kind === "plain" ? (v) => `${v}` : (v) => (v >= 0 ? `+${v}` : `${v}`);
	const canonicalStr = fmt(can);
	if (can === eff) return canonicalStr;
	const dirClass = eff > can ? "charsheet__mod-effective--positive" : "charsheet__mod-effective--negative";
	const effectiveStr = fmt(eff);
	const title = (opts.titleEffective || "Effective bonus (with active mods)").replace(/"/g, "&quot;");
	return `${canonicalStr}<span class="charsheet__mod-effective ${dirClass}" title="${title}">(${effectiveStr})</span>`;
}

function extractEffectiveTitle (html) {
	const m = html.match(/class="charsheet__mod-effective[^"]*"\s+title="([^"]*)"/);
	return m ? m[1] : null;
}

describe("Bug #5 — effective modifier hover surfaces the breakdown", () => {
	const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

	describe("source-pin: the three d20 renderers pass the breakdown to the effective span", () => {
		it("_renderAbilityScores renders the helper result into modCell and mirrors the tooltip", () => {
			const m = SOURCE.match(/_renderAbilityScores\s*\(\)\s*\{[\s\S]*?\n\t\}/);
			expect(m).not.toBeNull();
			const body = m[0];
			// The titled helper output must actually be the cell's content (not dead code).
			expect(body).toMatch(/modCell\.innerHTML\s*=\s*this\._formatModWithEffective\(canonical,\s*effective,\s*\{titleEffective:\s*tooltip\}\)/);
			expect(body).toMatch(/modCell\.title\s*=\s*tooltip/);
		});

		it("_renderSavingThrows feeds the titled helper output into the rendered row", () => {
			const m = SOURCE.match(/_renderSavingThrows\s*\(\)\s*\{[\s\S]*?\n\t\}/);
			expect(m).not.toBeNull();
			const body = m[0];
			expect(body).toMatch(/const modHtml\s*=\s*this\._formatModWithEffective\(canonical,\s*effective,\s*\{titleEffective:\s*tooltip\}\)/);
			expect(body).toMatch(/\$\{modHtml\}/);
		});

		it("_renderSkills feeds the titled helper output into the rendered row", () => {
			const m = SOURCE.match(/_renderSkills\s*\(\)\s*\{[\s\S]*?\n\t\}/);
			expect(m).not.toBeNull();
			const body = m[0];
			expect(body).toMatch(/const modHtml\s*=\s*this\._formatModWithEffective\(canonical,\s*effective,\s*\{titleEffective:\s*skillTooltip\}\)/);
			expect(body).toMatch(/\$\{modHtml\}/);
		});
	});

	describe("behavioural: effective span carries the breakdown, not the generic hint", () => {
		const breakdown = "🎲 Dex: +3\n🛡️ Proficiency: +2\n─────────\n🎯 Total: +7";

		it("effective span title equals the full breakdown when mods differ", () => {
			const html = _formatModWithEffective(5, 7, {titleEffective: breakdown});
			const effTitle = extractEffectiveTitle(html);
			expect(effTitle).toBe(breakdown);
			// The fix must NOT leave the generic default on the effective span.
			expect(html).not.toMatch(/title="Effective bonus \(with active mods\)"/);
		});

		it("regression guard: WITHOUT the fix the effective span shows the generic hint", () => {
			// Demonstrates the original bug — the inner title overrides the row breakdown.
			const buggy = _formatModWithEffective(5, 7);
			expect(extractEffectiveTitle(buggy)).toBe("Effective bonus (with active mods)");
			expect(extractEffectiveTitle(buggy)).not.toBe(breakdown);
		});

		it("escapes quotes in the breakdown for the effective span attribute", () => {
			const html = _formatModWithEffective(5, 7, {titleEffective: `a "quoted" mod`});
			expect(html).toContain(`title="a &quot;quoted&quot; mod"`);
		});

		it("collapses to a plain canonical value when canonical === effective (no span/title at all)", () => {
			const html = _formatModWithEffective(5, 5, {titleEffective: breakdown});
			expect(html).toBe("+5");
			expect(html).not.toMatch(/<span/);
		});
	});
});
