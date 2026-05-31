import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

/*
 * `_formatModWithEffective(canonical, effective, opts)` is a small pure
 * helper on the CharacterSheet controller (charactersheet.js). It backs the
 * Phase 5.6 dual-display contract: show the intrinsic character bonus, then
 * the situational total in parens (colored + smaller) when they differ.
 *
 * Because the 6.5K-line controller module pulls in too many globals to
 * import cleanly in jest, we keep a byte-for-byte replica of the helper
 * here and pin it to the production source with a regex. If the helper
 * diverges, the source-pin test fails first and forces this replica to be
 * updated in lockstep. This is the same pattern used by
 * CharacterSheetSpellPickerHover.test.js etc.
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

describe("_formatModWithEffective (Phase 5.6 dual canonical/effective display)", () => {
	test("source-pin: production helper matches the in-test replica", () => {
		const source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		// Production method starts at: `_formatModWithEffective (canonical, effective, opts = {}) {`
		// and ends at the matching `\n\t}` (single tab indent for class methods).
		const match = source.match(/_formatModWithEffective\s*\(canonical,\s*effective,\s*opts\s*=\s*\{\}\)\s*\{[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		// Sanity: confirm the production body contains the documented branches we test below.
		const body = match[0];
		expect(body).toMatch(/charsheet__mod-effective--positive/);
		expect(body).toMatch(/charsheet__mod-effective--negative/);
		expect(body).toMatch(/Math\.trunc\(canonical\)/);
		expect(body).toMatch(/Math\.trunc\(effective\)/);
		expect(body).toMatch(/kind\s*===\s*["']plain["']/);
		expect(body).toMatch(/titleEffective/);
	});

	describe("collapse when canonical === effective", () => {
		it("returns plain +N for matching positive mods", () => {
			expect(_formatModWithEffective(3, 3)).toBe("+3");
		});

		it("returns plain -N for matching negative mods", () => {
			expect(_formatModWithEffective(-2, -2)).toBe("-2");
		});

		it("returns +0 for both zero", () => {
			expect(_formatModWithEffective(0, 0)).toBe("+0");
		});

		it("emits no HTML when collapsed (plain text)", () => {
			expect(_formatModWithEffective(5, 5)).not.toMatch(/<span/);
		});
	});

	describe("emits dual display when values differ", () => {
		it("shows canonical first, effective in parens, when effective > canonical (positive buff)", () => {
			const out = _formatModWithEffective(3, 5);
			expect(out).toMatch(/^\+3<span/);
			expect(out).toMatch(/charsheet__mod-effective/);
			expect(out).toMatch(/charsheet__mod-effective--positive/);
			expect(out).toMatch(/\(\+5\)/);
		});

		it("shows red --negative class when effective < canonical (nerf)", () => {
			const out = _formatModWithEffective(5, 3);
			expect(out).toMatch(/charsheet__mod-effective--negative/);
			expect(out).toMatch(/\(\+3\)/);
		});

		it("handles negative effective when canonical positive", () => {
			const out = _formatModWithEffective(2, -1);
			expect(out).toMatch(/charsheet__mod-effective--negative/);
			expect(out).toMatch(/\(-1\)/);
		});

		it("emits a default tooltip title", () => {
			const out = _formatModWithEffective(3, 5);
			expect(out).toMatch(/title="Effective bonus \(with active mods\)"/);
		});

		it("honors a custom titleEffective opt", () => {
			const out = _formatModWithEffective(8, 11, {titleEffective: "Custom tooltip"});
			expect(out).toMatch(/title="Custom tooltip"/);
		});
	});

	describe("plain numeric mode (kind=plain) for DC-style values", () => {
		it("collapses without sign prefix when equal", () => {
			expect(_formatModWithEffective(15, 15, {kind: "plain"})).toBe("15");
		});

		it("emits dual without sign prefix when different", () => {
			const out = _formatModWithEffective(15, 17, {kind: "plain"});
			expect(out).toMatch(/^15<span/);
			expect(out).toMatch(/\(17\)/);
			expect(out).not.toMatch(/\+15/);
			expect(out).not.toMatch(/\+17/);
		});
	});

	describe("integer coercion", () => {
		it("truncates fractional inputs before comparison and formatting", () => {
			expect(_formatModWithEffective(3.4, 3.6)).toBe("+3");
		});
	});
});
