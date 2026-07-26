import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, "../../js/render-bestiary.js"), "utf-8");

// Build a `${name}` template-interpolation needle without writing a literal `${` (which trips
// the `no-template-curly-in-string` lint rule).
const interp = name => `$${"{"}${name}}`;

/**
 * RC-1 regression tripwire for the Bestiary "Two Columns" toggle (tracker #1200 / 5ET-1080).
 *
 * The two-column CSS keys off `.ve-stats--two-col > tbody.mon__body-cols-wrap`. The main-pane
 * render (`RenderBestiary._getRenderedCreature`, classic + 2024) must emit exactly that wrapper
 * tbody around the trait/action/legendary body sections — otherwise clicking "Two Columns" toggles
 * the button active but nothing reflows (the original bug). A full DOM render can't run in the
 * node test environment (no jsdom), so this guards the structural contract at the source level:
 * both implementations must return through `_getRenderedCreatureFromTbodies` with a
 * `mon__body-cols-wrap` tbody.
 */
describe("RenderBestiary main-pane two-column structure (RC-1 guard)", () => {
	it("emits a `mon__body-cols-wrap` tbody in exactly two impls (classic + 2024)", () => {
		const count = (SRC.match(/^\t+<tbody class="mon__body-cols-wrap">/gm) || []).length;
		expect(count).toBe(2);
	});

	it("routes both renders through the tbody-extraction helper", () => {
		const count = (SRC.match(/_getRenderedCreatureFromTbodies\(ee`<table>/g) || []).length;
		expect(count).toBe(2);
	});

	it("keeps the name row OUT of the body-cols wrap (header stays full-width)", () => {
		// The wrap must appear AFTER the closing of the header tbody, never enclosing `htmlPtName`.
		for (const chunk of SRC.split("_getRenderedCreatureFromTbodies(ee`<table>").slice(1)) {
			const wrapIdx = chunk.indexOf(`<tbody class="mon__body-cols-wrap">`);
			const nameIdx = chunk.indexOf(interp("htmlPtName"));
			expect(wrapIdx).toBeGreaterThan(-1);
			expect(nameIdx).toBeGreaterThan(-1);
			expect(nameIdx).toBeLessThan(wrapIdx);
		}
	});

	it("encloses the trait/action body sections INSIDE the wrap (so they reflow into columns)", () => {
		for (const chunk of SRC.split("_getRenderedCreatureFromTbodies(ee`<table>").slice(1)) {
			const wrapOpen = chunk.indexOf(`<tbody class="mon__body-cols-wrap">`);
			// The first `</tbody>` after the wrap opens is the wrap's own close.
			const wrapClose = chunk.indexOf("</tbody>", wrapOpen);
			expect(wrapOpen).toBeGreaterThan(-1);
			expect(wrapClose).toBeGreaterThan(wrapOpen);
			for (const part of [interp("htmlPtTraits"), interp("htmlPtActions")]) {
				const idx = chunk.indexOf(part);
				expect(idx).toBeGreaterThan(wrapOpen);
				expect(idx).toBeLessThan(wrapClose);
			}
		}
	});
});
