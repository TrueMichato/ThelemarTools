import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";

/**
 * Two sessions independently concluded "material damage reduction is broken" by loading a real
 * save into a bare harness and reading an empty array. It was not broken. The material catalog
 * had never been loaded, so `resolveMaterial` returned `null` for every item, which is
 * indistinguishable from "this item has no material" -- every effect silently evaporated.
 *
 * These tests pin both halves of that lesson: the diagnostic that now makes the empty catalog
 * audible, and a real end-to-end measurement against the authored brew so the working behaviour
 * has a witness that cannot be mistaken for a harness artifact.
 */

const BREW = JSON.parse(fs.readFileSync(path.resolve("homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const MATERIALS = BREW.itemMaterial || [];

const Materials = globalThis.CharacterSheetMaterials;

const ADAMANTINE_PLATE = {
	name: "Angelic Plate",
	source: "CUSTOM",
	type: "armor",
	armor: true,
	armorType: "heavy",
	ac: 18,
	material: {name: "Adamantine", source: "TGTT"},
};

describe("Unresolved material references are audible", () => {
	beforeEach(() => {
		Materials.clearUnresolvedReferences();
		globalThis.__csMaterialCatalog = [];
	});

	afterEach(() => {
		Materials.clearUnresolvedReferences();
		globalThis.__csMaterialCatalog = MATERIALS;
	});

	it("records an unresolved reference when the catalog is empty", () => {
		expect(Materials.resolveMaterial(ADAMANTINE_PLATE)).toBeNull();

		const unresolved = Materials.getUnresolvedReferences();
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0]).toMatchObject({kind: "material", name: "Adamantine", source: "TGTT", poolSize: 0});
	});

	it("distinguishes an empty catalog from a bad reference, because the fixes are opposite", () => {
		Materials.resolveMaterial(ADAMANTINE_PLATE);
		expect(Materials.getUnresolvedReferences()[0].poolSize).toBe(0);

		Materials.clearUnresolvedReferences();
		Materials.resolveMaterial({...ADAMANTINE_PLATE, material: {name: "Definitely Not A Material"}}, MATERIALS);

		const [bad] = Materials.getUnresolvedReferences();
		expect(bad.name).toBe("Definitely Not A Material");
		expect(bad.poolSize).toBe(MATERIALS.length);
	});

	it("stays silent for an item that simply has no material", () => {
		expect(Materials.resolveMaterial({name: "Plain Plate", type: "armor"})).toBeNull();
		expect(Materials.getUnresolvedReferences()).toEqual([]);
	});

	it("warns once per unique reference rather than on every render", () => {
		const warnings = [];
		const original = globalThis.console.warn;
		globalThis.console.warn = (msg) => warnings.push(msg);
		try {
			for (let i = 0; i < 5; ++i) Materials.resolveMaterial(ADAMANTINE_PLATE);
		} finally {
			globalThis.console.warn = original;
		}

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("catalog is empty");
	});

	it("records nothing once the catalog can actually supply the material", () => {
		expect(Materials.resolveMaterial(ADAMANTINE_PLATE, MATERIALS)?.name).toBe("Adamantine");
		expect(Materials.getUnresolvedReferences()).toEqual([]);
	});
});

describe("Adamantine damage reduction, measured against the authored brew", () => {
	/** @returns {object} A state with the real catalog loaded and the plate equipped. */
	const buildWearer = () => {
		const st = new globalThis.CharacterSheetState();
		st.setItemMaterialCatalog(MATERIALS);
		globalThis.__csMaterialCatalog = MATERIALS;
		st.addItem({...ADAMANTINE_PLATE});
		const id = st.getItems().slice(-1)[0].id;
		st._data.inventory.find(i => i.id === id).equipped = true;
		st._recalculateMaterialModifiers();
		return st;
	};

	it("reaches getNamedModifiersByType on a CUSTOM-built heavy armour", () => {
		const dr = buildWearer().getNamedModifiersByType("damageReduction");

		expect(dr).toHaveLength(1);
		expect(dr[0]).toMatchObject({
			name: "Adamantine (damage reduction)",
			value: 3,
			sourceType: "itemMaterial",
			sourceLabel: "Angelic Plate",
		});
		expect(dr[0].damageTypes.sort()).toEqual(["bludgeoning", "piercing", "slashing"]);
	});

	it("picks the heavy row, not the medium one, for heavy armour", () => {
		const fx = Materials.getMaterialEffects(ADAMANTINE_PLATE, Materials.resolveMaterial(ADAMANTINE_PLATE, MATERIALS));
		const heavy = fx.damageReduction.find(d => d.armorType === "heavy");
		const medium = fx.damageReduction.find(d => d.armorType === "medium");

		expect(heavy.value).toBe(3);
		expect(medium.value).toBe(2);
		expect(buildWearer().getNamedModifiersByType("damageReduction")[0].value).toBe(heavy.value);
	});

	it("yields nothing when the same material is on a weapon rather than armour", () => {
		const st = new globalThis.CharacterSheetState();
		st.setItemMaterialCatalog(MATERIALS);
		st.addItem({name: "Adamantine Sword", type: "M", weapon: true, material: {name: "Adamantine", source: "TGTT"}});
		const id = st.getItems().slice(-1)[0].id;
		st._data.inventory.find(i => i.id === id).equipped = true;
		st._recalculateMaterialModifiers();

		expect(st.getNamedModifiersByType("damageReduction")).toEqual([]);
	});
});

describe("A late-arriving catalog clears stale complaints", () => {
	it("forgets references that only failed because nothing was loaded yet", () => {
		Materials.clearUnresolvedReferences();
		globalThis.__csMaterialCatalog = [];

		Materials.resolveMaterial(ADAMANTINE_PLATE);
		expect(Materials.getUnresolvedReferences()).toHaveLength(1);

		new globalThis.CharacterSheetState().setItemMaterialCatalog(MATERIALS);
		expect(Materials.getUnresolvedReferences()).toEqual([]);
	});

	it("keeps complaining when the catalog arrives but still lacks the material", () => {
		Materials.clearUnresolvedReferences();
		new globalThis.CharacterSheetState().setItemMaterialCatalog(MATERIALS);
		Materials.resolveMaterial({material: {name: "Unobtainium"}});

		expect(Materials.getUnresolvedReferences().map(r => r.name)).toEqual(["Unobtainium"]);
	});
});
