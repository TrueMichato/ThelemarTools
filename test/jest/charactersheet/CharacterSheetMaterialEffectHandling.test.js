/**
 * The authoring ↔ consumption contract for material effects.
 *
 * The bug this test exists to prevent: a material effect could be authored in the brew,
 * normalised by `getMaterialEffects`, described in tidy prose by `getMaterialNotes` — and
 * then do nothing at all. Silently. Forever. 34 of 72 materials were in that state, and
 * nothing distinguished "deliberately a table call" from "someone forgot to wire it up".
 *
 * `EFFECT_HANDLING` is the declaration; this is its enforcement.
 */

import "../../../js/charactersheet/charactersheet-materials.js";
import {readFileSync, readdirSync} from "fs";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const VALID_CONSUMERS = new Set(["projection", "modifier", "power", "roll", "reference"]);

function loadBrewMaterials () {
	const raw = readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8");
	return JSON.parse(raw).itemMaterial || [];
}

describe("Material effect handling registry", () => {
	const materials = loadBrewMaterials();

	it("finds the brew's materials", () => {
		expect(materials.length).toBeGreaterThan(0);
	});

	it("declares a handling entry for every effect type authored in the brew", () => {
		const undeclared = new Map();
		for (const mat of materials) {
			for (const fx of mat.effects || []) {
				if (CharacterSheetMaterials.EFFECT_HANDLING[fx.type]) continue;
				if (!undeclared.has(fx.type)) undeclared.set(fx.type, []);
				undeclared.get(fx.type).push(mat.name);
			}
		}

		const report = [...undeclared.entries()]
			.map(([type, names]) => `  "${type}" — authored by ${names.join(", ")}`)
			.join("\n");

		expect(report ? `Effect types with no declared consumer:\n${report}` : "").toBe("");
	});

	it("gives every declared type a valid consumer and a note", () => {
		for (const [type, spec] of Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)) {
			expect(VALID_CONSUMERS.has(spec.consumer)).toBe(true);
			expect(typeof spec.note).toBe("string");
			expect(spec.note.length).toBeGreaterThan(0);
			// A type declared but never authored is fine; a type declared with no name is not.
			expect(type.length).toBeGreaterThan(0);
		}
	});

	it("declares nothing the normaliser cannot understand", () => {
		// Every registry key must survive `getMaterialEffects` without hitting the `default`
		// branch — otherwise the registry is promising a consumer for a type that is dropped
		// before any consumer could see it.
		const item = {name: "Test", type: "M", weapon: true};
		for (const type of Object.keys(CharacterSheetMaterials.EFFECT_HANDLING)) {
			const material = {name: "Probe", category: "metal", effects: [{type, value: 1, text: "x", name: "x", dice: 1, damageType: "fire", properties: [], damageTypes: []}]};
			expect(() => CharacterSheetMaterials.getMaterialEffects(item, material)).not.toThrow();
		}
	});

	it("keeps `reference` a deliberate minority", () => {
		// If this ever grows large, the sheet has quietly given up on automating materials.
		const referenced = Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)
			.filter(([, spec]) => spec.consumer === "reference");
		expect(referenced.length).toBeLessThanOrEqual(7);
	});

	/**
	 * `consumer` is a CATEGORY, so every assertion keyed on it is blind to a hole inside the
	 * category. `condensateInstability` declares `consumer: "power"`; the power channel existed
	 * and was well tested; and the instability reached it through nothing at all. A guard that
	 * asks "does this category have a home?" answers yes and tells you nothing.
	 *
	 * So this asks the narrower question per type: does the effect key appear in code that is
	 * not the authoring file itself? `charactersheet-materials.js` declares, normalises and
	 * describes every type, so a type mentioned only there has been authored and never
	 * delivered — which is the entire defect class `EFFECT_HANDLING` exists to prevent, applied
	 * to `EFFECT_HANDLING` itself.
	 */
	it("gives every non-reference type a consumer outside the authoring file", () => {
		const jsFiles = [];
		const walk = (dir) => {
			for (const entry of readdirSync(dir, {withFileTypes: true})) {
				const full = resolve(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (full.endsWith(".js") && !full.endsWith("charactersheet-materials.js")) jsFiles.push(full);
			}
		};
		walk(resolve(REPO_ROOT, "js"));
		const corpus = jsFiles.map(f => readFileSync(f, "utf8"));

		const undelivered = Object.entries(CharacterSheetMaterials.EFFECT_HANDLING)
			.filter(([, spec]) => spec.consumer !== "reference")
			.filter(([type]) => !corpus.some(src => src.includes(type)))
			.map(([type, spec]) => `  "${type}" — declared consumer "${spec.consumer}", but no file outside charactersheet-materials.js mentions it`);

		expect(undelivered.length ? `Effect types authored but never delivered:\n${undelivered.join("\n")}` : "").toBe("");
	});

	/**
	 * The narrowest version of the same question, for the one channel where the miss actually
	 * happened. A condensate's instability is the PRICE of its affinity. Surfacing the benefit
	 * without the cost is worse than surfacing neither, because the player applies the half they
	 * saw and a material designed as "strong option, real vulnerability" silently becomes
	 * strictly better.
	 */
	it("carries a condensate's instability alongside the affinity it pays for", () => {
		const stateSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-state.js"), "utf8");
		const card = stateSrc.match(/id: "mat:affinity",[\s\S]{0,2000}?\n\t{5}\}\);/)?.[0] || "";

		expect(card).toBeTruthy();
		expect(card).toContain("description: condensate.affinity");
		expect(card).toContain("instability");
	});
});

describe("Material effect coverage across the brew", () => {
	const materials = loadBrewMaterials();

	it("leaves no material whose every effect is reference-only prose", () => {
		// A material with mechanics in its rules text but nothing but `reference` handling is
		// the exact failure mode this whole pass fixed. `note`-only materials are legitimate
		// (pure flavour), so they are exempt.
		//
		// A handful of materials genuinely make only a table call:
		// - Adamant and Heart Stone promise nothing but indestructibility, and whether a
		//   given effect could damage an object is not a number the sheet can compute.
		// - Ioun Sand doubles numeric properties granted by an intact Ioun Stone SET IN THE
		//   MATRIX, and explicitly not ordinary enchantments or loose fragments. The sheet
		//   models Ioun Stones as their own subsystem rather than as material sockets, so
		//   which of an item's numbers qualify is a question only the table can answer.
		//
		// Those are allowed, but ONLY by name, so that a new material joining this list is a
		// deliberate decision someone had to write down rather than an accident nobody
		// noticed.
		const REFERENCE_ONLY_BY_DESIGN = new Set(["Adamant", "Heart Stone", "Ioun Sand"]);

		const offenders = [];
		for (const mat of materials) {
			const types = (mat.effects || []).map(fx => fx.type);
			if (!types.length) continue;
			if (types.every(t => t === "note")) continue;
			if (REFERENCE_ONLY_BY_DESIGN.has(mat.name)) continue;
			const allReference = types.every(t => CharacterSheetMaterials.EFFECT_HANDLING[t]?.consumer === "reference");
			if (allReference) offenders.push(`${mat.name} (${types.join(", ")})`);
		}
		expect(offenders).toEqual([]);
	});
});

/**
 * The picker's "What do these numbers mean?" legend is in-app help, and it drifted: for two
 * days it described Penetration as "ignores that much of a target's non-magical damage
 * resistance" — a completely different mechanic from the one the sheet implements. Nobody
 * noticed, and a second author read that string, believed it, and carried the wrong
 * mechanic into a design review before it was caught.
 *
 * Help text that contradicts the code is worse than no help text, because it is believed.
 * So the legend is pinned against the combat tooltip that resolves the actual roll: the two
 * must agree on what Penetration does, and neither may describe it as a resistance effect.
 */
describe("Picker legend agrees with the mechanic it explains", () => {
	const materialsSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-materials.js"), "utf8");
	const combatSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

	const legendPen = materialsSrc.match(/<dt>Pen<\/dt><dd>([^<]*)<\/dd>/)?.[1] || "";
	const tooltipPen = combatSrc.match(/title="Penetration \$\{pen\}: ([^"]*)"/)?.[1] || "";

	it("finds both the legend entry and the combat tooltip", () => {
		expect(legendPen).toBeTruthy();
		expect(tooltipPen).toBeTruthy();
	});

	it("describes Penetration as a near-miss against AC in both places", () => {
		for (const text of [legendPen, tooltipPen]) {
			expect(text.toLowerCase()).toMatch(/miss(ed)? by/);
		}
	});

	it("never describes Penetration as piercing damage resistance", () => {
		// The exact drift that happened. `resistance` has no business in either string.
		for (const text of [legendPen, tooltipPen]) {
			expect(text.toLowerCase()).not.toContain("resistance");
		}
	});

	it("keeps every legend entry non-empty and tag-balanced", () => {
		const entries = [...materialsSrc.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*(?:<b>[^<]*<\/b>[^<]*)*)<\/dd>/g)];
		expect(entries.length).toBeGreaterThanOrEqual(7);
		for (const [, term, def] of entries) {
			expect(term.trim()).not.toBe("");
			expect(def.trim().length).toBeGreaterThan(10);
		}
	});
});
