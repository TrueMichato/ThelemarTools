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
import {readFileSync} from "fs";
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
		expect(referenced.length).toBeLessThanOrEqual(5);
	});
});

describe("Material effect coverage across the brew", () => {
	const materials = loadBrewMaterials();

	it("leaves no material whose every effect is reference-only prose", () => {
		// A material with mechanics in its rules text but nothing but `reference` handling is
		// the exact failure mode this whole pass fixed. `note`-only materials are legitimate
		// (pure flavour), so they are exempt.
		//
		// A handful of materials genuinely make only a table call — Adamant and Heart Stone
		// promise nothing but indestructibility, and whether a given effect could damage an
		// object is not a number the sheet can compute. Those are allowed, but ONLY by name,
		// so that a new material joining this list is a deliberate decision someone had to
		// write down rather than an accident nobody noticed.
		const REFERENCE_ONLY_BY_DESIGN = new Set(["Adamant", "Heart Stone"]);

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
