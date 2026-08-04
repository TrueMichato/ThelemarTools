import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

/**
 * The 3D dice library must be loaded by the page, not on demand.
 *
 * A perf change once removed this `<script>` tag and replaced it with a runtime `pLoadLibrary()` call. Only
 * `pAnimateDiceSpec` awaited that call, so every other entry point -- `canRender()`, `pRoll()`, `pRollMany()` --
 * saw no factory and silently fell back to the legacy CSS animation. Verified in a headed browser against the
 * regressed code: `canRender(20)` false, `pRoll` rejecting with "dice-box-threejs not loaded", zero canvases,
 * and *no page errors*, so nothing surfaced the failure to the user.
 *
 * `defer` does not block parsing, so keeping the tag costs only parse/compile -- far less than the cost of the
 * feature silently disappearing.
 */
describe("charactersheet 3D dice library script", () => {
	const html = fs.readFileSync(path.join(ROOT, "charactersheet.html"), "utf8");

	const getDiceTag = () => {
		const m = html.match(/<script[^>]*\bsrc="lib\/dice-box-threejs\.umd\.js"[^>]*>/);
		return m ? m[0] : null;
	};

	test("charactersheet.html loads lib/dice-box-threejs.umd.js", () => {
		expect(getDiceTag()).toBeTruthy();
	});

	test("it is deferred, so it does not block parsing", () => {
		expect(getDiceTag()).toContain("defer");
	});

	test("it is loaded before the dice roller that consumes it", () => {
		const ixLib = html.indexOf(`src="lib/dice-box-threejs.umd.js"`);
		const ixRoller = html.indexOf(`src="js/charactersheet/charactersheet-dice3d.js"`);
		expect(ixLib).toBeGreaterThan(-1);
		expect(ixRoller).toBeGreaterThan(-1);
		expect(ixLib).toBeLessThan(ixRoller);
	});
});
