import "./setup.js";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

/**
 * TGTT homebrew `optionalfeatureProgression` cumulative-authoring guard.
 *
 * 5etools convention (and both picker readers — quickbuild
 * `_getOptionalFeatureGains` and class-utils `getOptionalFeatureGains`) treat an
 * object-form `progression` as CUMULATIVE running totals ("highest key <= level =
 * total you have"). Authoring it INCREMENTALLY (how many you gain at each level)
 * makes the reader compute a non-positive delta after the first grant, so the
 * picker offers too few / no new choices past the first level.
 *
 * Three TGTT progressions were authored incrementally and fixed to cumulative:
 *   - Fighter "Battle Tactics"        {2:2,7:1,10:1,15:1} -> {2:2,7:3,10:4,15:5}
 *   - Monk  "Precise Strike Methods"  {3:3,6:1,11:1,17:1} -> {3:3,6:4,11:5,17:6}
 *   - Bard  "Jester's Acts"           {3:3,6:1,14:1}      -> {3:3,6:4,14:5}
 *
 * This suite is a GENERAL guard: every object-form progression in the file must
 * be monotonically non-decreasing (a cumulative total can never drop). It also
 * pins the two progressions fixed in this pass with their exact corrected values.
 */
describe("TGTT optionalfeatureProgression — cumulative authoring guard", () => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const tgtt = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));

	/** Walk the whole homebrew tree and collect every object-form progression with a label. */
	function collectProgressions () {
		const out = [];
		const walk = (node, ownerName) => {
			if (Array.isArray(node)) { node.forEach(n => walk(n, ownerName)); return; }
			if (node && typeof node === "object") {
				const nextOwner = (node.name && (node.className || node.classSource || node.subclassShortName || node.featureType))
					? node.name
					: ownerName;
				if (node.optionalfeatureProgression) {
					const ofp = Array.isArray(node.optionalfeatureProgression)
						? node.optionalfeatureProgression
						: [node.optionalfeatureProgression];
					for (const p of ofp) {
						const prog = p.progression;
						if (prog && typeof prog === "object" && !Array.isArray(prog)) {
							out.push({label: `${p.name || "?"} (owner: ${nextOwner || "?"})`, progression: prog});
						}
					}
				}
				for (const k in node) walk(node[k], nextOwner);
			}
		};
		walk(tgtt, null);
		return out;
	}

	const progressions = collectProgressions();

	it("finds the known object-form progressions (sanity)", () => {
		// Guard against the walker silently collecting nothing (which would make the
		// monotonic assertion vacuously pass).
		expect(progressions.length).toBeGreaterThanOrEqual(10);
	});

	it("every progression is monotonically non-decreasing (cumulative, never drops)", () => {
		const offenders = [];
		for (const {label, progression} of progressions) {
			const keys = Object.keys(progression)
				.filter(k => /^\d+$/.test(k)) // ignore wildcard "*" keys (always-N form)
				.map(Number)
				.sort((a, b) => a - b);
			const vals = keys.map(k => progression[String(k)]);
			for (let i = 1; i < vals.length; ++i) {
				if (vals[i] < vals[i - 1]) {
					offenders.push(`${label}: {${keys.map(k => `${k}:${progression[String(k)]}`).join(", ")}}`);
					break;
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	// ---- Explicit pins for the two progressions corrected in this pass ----

	const progByName = (name) => progressions.find(p => p.label.startsWith(`${name} `))?.progression;

	it("Monk 'Precise Strike Methods' is cumulative {3:3, 6:4, 11:5, 17:6}", () => {
		expect(progByName("Precise Strike Methods")).toEqual({3: 3, 6: 4, 11: 5, 17: 6});
	});

	it("Bard 'Jester's Acts' is cumulative {3:3, 6:4, 14:5}", () => {
		expect(progByName("Jester's Acts")).toEqual({3: 3, 6: 4, 14: 5});
	});

	it("Fighter 'Battle Tactics' remains cumulative {2:2, 7:3, 10:4, 15:5} (no regression)", () => {
		expect(progByName("Battle Tactics")).toEqual({2: 2, 7: 3, 10: 4, 15: 5});
	});
});
