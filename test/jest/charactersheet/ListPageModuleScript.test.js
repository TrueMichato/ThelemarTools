import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

/**
 * B11: list2.js uses ES `import`, so any page loading it must use type="module".
 * combatmethods.html and itemupgrades.html previously loaded it as
 * type="text/javascript", producing "Cannot use import statement outside a module"
 * and rendering an empty list. These pages must match the feats.html pattern.
 */
describe("list-page list2.js script type", () => {
	const readHtml = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

	const getList2Tag = (html) => {
		const m = html.match(/<script[^>]*\bsrc="js\/list2\.js"[^>]*>/);
		return m ? m[0] : null;
	};

	test.each(["combatmethods.html", "itemupgrades.html", "feats.html"])(
		"%s loads js/list2.js as type=\"module\"",
		(file) => {
			const tag = getList2Tag(readHtml(file));
			expect(tag).toBeTruthy();
			expect(tag).toContain(`type="module"`);
			expect(tag).not.toContain(`type="text/javascript"`);
		},
	);
});
