/**
 * Wave 9 — condensate instabilities become a mechanic.
 *
 * Two defects are pinned here:
 *
 * 1. Instabilities that BITE THE CARRIER (Vitriol Crystal, Stormprism, Magmaheart, Skyshard)
 *    existed only as `condensateInstability` prose. No roll read them.
 *
 * 2. The `damageTaken` degradation trigger was matched by `isDegradationTriggered` but fired
 *    by nothing — `getDegradationCandidates` had exactly one caller, which only ever passed
 *    `attackRoll`. Rimeglass's authored fire degradation was dead code.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BREW = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const MATERIALS = BREW.itemMaterial;
const byName = (name) => MATERIALS.find(m => m.name === name);

const NAT_1 = {type: "attackRoll", natural: 1, isCrit: false};

describe("Instability vocabulary", () => {
	it("returns null for a material with no authored instability", () => {
		expect(CharacterSheetMaterials.getInstabilitySpec(byName("Steel"))).toBeNull();
		expect(CharacterSheetMaterials.getInstabilitySpec(null)).toBeNull();
		expect(CharacterSheetMaterials.getInstabilitySpec({})).toBeNull();
	});

	it("never fires without a trigger", () => {
		expect(CharacterSheetMaterials.isInstabilityTriggered(byName("Vitriol Crystal"), null)).toBe(false);
	});

	it("fires Vitriol Crystal on a natural 1 and not on a natural 2", () => {
		const mat = byName("Vitriol Crystal");
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, NAT_1)).toBe(true);
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, {type: "attackRoll", natural: 2})).toBe(false);
	});

	it("does not fire a natural-1 instability on a damageTaken trigger", () => {
		expect(CharacterSheetMaterials.isInstabilityTriggered(
			byName("Stormprism"), {type: "damageTaken", damageType: "lightning"},
		)).toBe(false);
	});

	it("fires Magmaheart on cold damage only", () => {
		const mat = byName("Magmaheart");
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, {type: "damageTaken", damageType: "cold"})).toBe(true);
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, {type: "damageTaken", damageType: "Cold"})).toBe(true);
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, {type: "damageTaken", damageType: "fire"})).toBe(false);
		expect(CharacterSheetMaterials.isInstabilityTriggered(mat, NAT_1)).toBe(false);
	});

	it("authors Skyshard as a save, not as damage", () => {
		const spec = CharacterSheetMaterials.getInstabilitySpec(byName("Skyshard"));
		expect(spec.trigger).toEqual({on: "damageTaken", damageType: "thunder"});
		expect(spec.effect).toMatchObject({type: "save", ability: "str", dc: 13});
	});

	it("gives every authored instability a trigger, an effect and a note", () => {
		const authored = MATERIALS.filter(m => m.instability);
		expect(authored.length).toBeGreaterThanOrEqual(4);
		for (const m of authored) {
			expect(m.instability.trigger?.on).toBeTruthy();
			expect(["selfDamage", "save"]).toContain(m.instability.effect?.type);
			expect(typeof m.instability.note).toBe("string");
			if (m.instability.effect.type === "selfDamage") {
				expect(m.instability.effect.damage).toMatch(/^\d+d\d+/);
				expect(m.instability.effect.damageType).toBeTruthy();
			}
		}
	});

	it("only authors an instability for a material whose prose describes one", () => {
		for (const m of MATERIALS.filter(m => m.instability)) {
			const prose = (m.effects || []).find(fx => fx.type === "condensateInstability");
			expect(prose).toBeTruthy();
		}
	});
});

describe("Shared trigger matcher", () => {
	it("is the same function for degradation and instability", () => {
		// Both must agree about what a natural 1 is; a second copy would drift.
		const fake = {degradation: {trigger: {on: "attackRoll", natural: [1]}}, instability: {trigger: {on: "attackRoll", natural: [1]}}};
		expect(CharacterSheetMaterials.isDegradationTriggered(fake, NAT_1)).toBe(true);
		expect(CharacterSheetMaterials.isInstabilityTriggered(fake, NAT_1)).toBe(true);
	});

	it("still honours alsoOnCriticalHit for degradation", () => {
		const glass = MATERIALS.find(m => m.degradation?.trigger?.alsoOnCriticalHit);
		if (!glass) return;
		expect(CharacterSheetMaterials.isDegradationTriggered(glass, {type: "attackRoll", natural: 12, isCrit: true})).toBe(true);
	});

	it("matches an untyped damageTaken trigger against any damage type", () => {
		const fake = {instability: {trigger: {on: "damageTaken"}}};
		expect(CharacterSheetMaterials.isInstabilityTriggered(fake, {type: "damageTaken", damageType: "psychic"})).toBe(true);
	});

	it("rejects an unknown trigger verb", () => {
		expect(CharacterSheetMaterials.isInstabilityTriggered({instability: {trigger: {on: "sunrise"}}}, NAT_1)).toBe(false);
	});
});

describe("Reactive damage types", () => {
	it("reports Magmaheart's cold and Skyshard's thunder", () => {
		expect(CharacterSheetMaterials.getReactiveDamageTypes(byName("Magmaheart"))).toEqual(["cold"]);
		expect(CharacterSheetMaterials.getReactiveDamageTypes(byName("Skyshard"))).toEqual(["thunder"]);
	});

	it("reports Rimeglass's fire, which comes from its degradation block", () => {
		expect(CharacterSheetMaterials.getReactiveDamageTypes(byName("Rimeglass"))).toEqual(["fire"]);
	});

	it("reports nothing for a nat-1 instability, which no damage type provokes", () => {
		expect(CharacterSheetMaterials.getReactiveDamageTypes(byName("Vitriol Crystal"))).toEqual([]);
	});

	it("reports nothing for an ordinary material", () => {
		expect(CharacterSheetMaterials.getReactiveDamageTypes(byName("Steel"))).toEqual([]);
	});
});

describe("State candidate accessors", () => {
	let st;

	const addMaterialItem = (materialName, {type = "M", name = "Test Blade"} = {}) => {
		st.addItem({quantity: 1, name, source: "TGTT", type, material: {name: materialName, source: "TGTT"}});
		return st.getItems().slice(-1)[0].id;
	};

	beforeEach(() => {
		st = new CharacterSheetState();
		st.setItemMaterialCatalog(MATERIALS);
		if (st._data.settings) st._data.settings.enableMaterials = true;
	});

	it("returns [] when material degradation is disabled", () => {
		addMaterialItem("Vitriol Crystal");
		st.isMaterialDegradationEnabled = () => false;
		expect(st.getInstabilityCandidates(NAT_1)).toEqual([]);
		expect(st.getMaterialReactiveDamageTypes()).toEqual([]);
	});

	it("finds a Vitriol Crystal weapon on a natural 1", () => {
		const id = addMaterialItem("Vitriol Crystal");
		const found = st.getInstabilityCandidates(NAT_1, {itemId: id});
		expect(found).toHaveLength(1);
		expect(found[0].material.name).toBe("Vitriol Crystal");
		expect(found[0].spec.effect.damageType).toBe("acid");
	});

	it("scopes an attack trigger to the weapon actually swung", () => {
		addMaterialItem("Vitriol Crystal", {name: "Sheathed Dagger"});
		const swung = addMaterialItem("Steel", {name: "Swung Sword"});
		expect(st.getInstabilityCandidates(NAT_1, {itemId: swung})).toEqual([]);
	});

	it("sweeps everything carried on a damageTaken trigger", () => {
		addMaterialItem("Magmaheart", {name: "Stowed Rod", type: "G"});
		const found = st.getInstabilityCandidates({type: "damageTaken", damageType: "cold"});
		expect(found).toHaveLength(1);
		expect(found[0].name).toBe("Stowed Rod");
	});

	it("skips a destroyed item", () => {
		const id = addMaterialItem("Vitriol Crystal");
		st.getItemRaw(id).material.isDestroyed = true;
		expect(st.getInstabilityCandidates(NAT_1, {itemId: id})).toEqual([]);
	});

	it("returns [] for an ordinary inventory with no materials", () => {
		st.addItem({quantity: 1, name: "Plain Sword", source: "PHB", type: "M"});
		expect(st.getInstabilityCandidates(NAT_1)).toEqual([]);
		expect(st.getMaterialReactiveDamageTypes()).toEqual([]);
	});

	it("unions reactive damage types across carried items", () => {
		addMaterialItem("Magmaheart", {name: "Rod"});
		addMaterialItem("Rimeglass", {name: "Shard"});
		expect(st.getMaterialReactiveDamageTypes().sort()).toEqual(["cold", "fire"]);
	});

	it("REGRESSION: Rimeglass's damageTaken degradation is now reachable", () => {
		// The bug: `getDegradationCandidates` had one caller, passing only `attackRoll`.
		// This trigger shape was matched and never fired.
		addMaterialItem("Rimeglass", {name: "Rimeglass Blade"});
		const found = st.getDegradationCandidates({type: "damageTaken", damageType: "fire"});
		expect(found).toHaveLength(1);
		expect(found[0].material.name).toBe("Rimeglass");
	});
});

/**
 * The two cross-type gates in `_matchesTrigger` (charactersheet-materials.js:900 and :906)
 * were each measured deletable against the FULL suite: 17,130 tests, zero red, either one.
 *
 * Two tests above look like they already cover this -- "does not fire a natural-1 instability
 * on a damageTaken trigger", and the Magmaheart `NAT_1` leg. Both stay green with the gates
 * removed, because the checks AFTER each gate independently reject a *plain* cross-type
 * trigger: a damageTaken event carries no `natural`, an attackRoll event carries no
 * `damageType`, so the fallthrough answers `false` for its own reasons.
 *
 *     A fixture on the wrong side of a gate only tests that gate if the code after it would
 *     answer differently. Otherwise it passes through a redundant gate, green either way.
 *
 * The discriminating fixture is an ENRICHED cross-type trigger -- one carrying the *other*
 * shape's field. Measured with the gates removed, both of the negatives below return `true`.
 *
 * Latent, not live: all three trigger construction sites in product code
 * (charactersheet-combat.js:1915 and :1962, charactersheet.js:12524) build the disjoint
 * shapes the docstring at charactersheet-materials.js:840 promises. These gates are what
 * stands between that comment and a wrongly-fired instability should either shape ever gain
 * a field -- `damageType` on an attack roll being the plausible one, for a material that
 * cares about the damage you deal.
 */
describe("the cross-type trigger gates, pinned with a fixture that can reach them", () => {
	it("control: each material still fires on its own trigger shape", () => {
		// Without this, the negatives below pass just as well when the matcher is broken
		// outright and nothing fires at all.
		expect(CharacterSheetMaterials.isInstabilityTriggered(byName("Stormprism"), NAT_1)).toBe(true);
		expect(CharacterSheetMaterials.isInstabilityTriggered(
			byName("Magmaheart"), {type: "damageTaken", damageType: "cold"},
		)).toBe(true);
	});

	it("an attackRoll instability ignores a damageTaken event carrying a `natural`", () => {
		// Stormprism fires on a natural 1; this is a damage event that happens to carry one.
		expect(CharacterSheetMaterials.isInstabilityTriggered(
			byName("Stormprism"), {type: "damageTaken", damageType: "lightning", natural: 1},
		)).toBe(false);
	});

	it("a damageTaken instability ignores an attackRoll carrying a `damageType`", () => {
		// Magmaheart bites when its carrier TAKES cold damage -- not when they swing a
		// cold-damage weapon.
		expect(CharacterSheetMaterials.isInstabilityTriggered(
			byName("Magmaheart"), {type: "attackRoll", natural: 7, isCrit: false, damageType: "cold"},
		)).toBe(false);
	});

	it("the same two gates guard degradation, which shares the matcher", () => {
		// `_matchesTrigger` is shared so instability and degradation can never drift apart
		// about what a natural 1 is. That sharing also means one missing fixture leaves
		// BOTH subsystems unguarded, which is why this leg exists on the degradation side.
		expect(CharacterSheetMaterials.isDegradationTriggered(
			byName("Rimeglass"), {type: "attackRoll", natural: 7, isCrit: false, damageType: "fire"},
		)).toBe(false);
	});
});
