/**
 * Character Sheet Item Materials (Thelemar homebrew) — Unit Tests
 *
 * Covers the damage-die ladder, effect resolution, item projection, weight/value
 * derivation, penetration, and the state-level persistence + read-time projection.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

// Minimal, hand-built catalog. The real entities live in the TGTT brew file; these
// mirror their shape so the tests exercise the vocabulary, not the data.
const MATERIALS = [
	{
		name: "Steel",
		source: "TGTT",
		materialCategory: "constructed",
		density: 7.85,
		damage: 1,
		protection: 0,
		critical: 0,
		penetration: 1,
		magicCapacity: 3,
		rarity: "uncommon",
		price: {gp: 1, unit: "lb", display: "1 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [],
	},
	{
		name: "Gold",
		source: "TGTT",
		materialCategory: "metal",
		density: 19.32,
		damage: -1,
		protection: 13,
		critical: -1,
		penetration: 0,
		magicCapacity: 3,
		rarity: "rare",
		price: {gp: 50, unit: "lb", display: "50 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [],
	},
	{
		name: "Darkmetal",
		source: "TGTT",
		materialCategory: "metal",
		density: 15.62,
		damage: 1,
		protection: 19,
		critical: 0,
		penetration: 2,
		magicCapacity: 6,
		rarity: "very rare",
		price: {gp: 550, unit: "lb", display: "550 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [
			{type: "armorForceHeavy"},
			{type: "armorStealthDisadvantage"},
			{type: "armorStrengthRequirementDelta", value: 2},
			{type: "armorDexCapDelta", value: -1},
			{type: "bonusAc", value: 1, appliesTo: ["shield"]},
			{type: "addProperty", properties: ["H"], appliesTo: ["weapon"]},
			{type: "removeProperty", properties: ["L", "F"], appliesTo: ["weapon"]},
		],
	},
	{
		name: "Mithril",
		source: "TGTT",
		materialCategory: "metal",
		density: 0.17,
		damage: 0,
		protection: 18,
		critical: 0,
		penetration: 0,
		magicCapacity: 5,
		rarity: "very rare",
		price: {gp: 700, unit: "lb", display: "700 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [
			{type: "armorNoStealthDisadvantage"},
			{type: "armorNoStrengthRequirement"},
			{type: "armorWearableUnderClothing"},
			{type: "propertyLadder", ladder: {"2H": "V", "_": "L", "L": "F"}, appliesTo: ["weapon"]},
		],
	},
	{
		name: "Adamantine",
		source: "TGTT",
		materialCategory: "constructed",
		density: 9.33,
		damage: 0,
		protection: 21,
		critical: 0,
		penetration: 0,
		magicCapacity: 5,
		rarity: "legendary",
		price: {gp: 1250, unit: "lb", display: "1,250 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [
			{type: "indestructible"},
			{type: "bonusAc", value: 2, appliesTo: ["shield"]},
			{type: "damageReduction", value: 3, armorType: "heavy", damageTypes: ["bludgeoning", "piercing", "slashing"]},
		],
	},
	{
		name: "Lead",
		source: "TGTT",
		materialCategory: "metal",
		density: 11.34,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: "-infinity",
		rarity: "very rare",
		price: {gp: 100, unit: "lb", display: "100 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [{type: "saveAdvantage", conditional: "Against divination magic", schools: ["divination"]}],
	},
	{
		name: "Ordinary Glass",
		source: "TGTT",
		materialCategory: "stone",
		density: 2.5,
		damage: -1,
		protection: "na",
		critical: 1,
		penetration: 1,
		magicCapacity: 2,
		rarity: "common",
		price: {gp: 0.5, unit: "lb", display: "0.5 gp per lb.", isPriceless: false},
		// `protection: "na"` — glass cannot be armour.
		appliesTo: ["weapon", "other"],
		effects: [],
	},
	{
		name: "Common Cloth",
		source: "TGTT",
		materialCategory: "cloth",
		density: null,
		densityVaries: true,
		damage: "na",
		protection: 0,
		critical: "na",
		penetration: "na",
		magicCapacity: 1,
		rarity: "common",
		price: {gp: 0.1, unit: "sqYard", display: "0.1 gp per square yard", isPriceless: false},
		appliesTo: ["armor", "shield", "other"],
		effects: [],
	},
	{
		name: "Desert Ironwood",
		source: "TGTT",
		materialCategory: "wood",
		density: 0.175,
		weightMultiplier: 1.25,
		damage: 0,
		protection: 0,
		critical: 1,
		penetration: 1,
		magicCapacity: 4,
		rarity: "rare",
		price: {gp: 150, unit: "lb", display: "150 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [{type: "rangeMultiplier", value: 1.5, appliesTo: ["weapon"]}],
	},
	{
		name: "Heart Stone",
		source: "TGTT",
		materialCategory: "constructed",
		density: null,
		densityVaries: true,
		damage: -2,
		protection: 25,
		critical: -2,
		penetration: 0,
		magicCapacity: 12,
		rarity: "legendary",
		price: {gp: null, unit: null, display: "Priceless (not normally traded)", isPriceless: true},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [],
	},
	{
		name: "Jadoo",
		source: "TGTT",
		materialCategory: "crystal",
		density: 2.0,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: "infinity",
		rarity: "legendary",
		price: {gp: null, unit: null, display: "Priceless", isPriceless: true},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [],
	},
	{
		name: "Steeline",
		source: "TGTT",
		materialCategory: "metal",
		density: 7.85,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: 2,
		rarity: "rare",
		price: {gp: 200, unit: "lb", display: "200 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		magicCapacityRules: [{type: "dcRiseThreshold", value: 2, note: "Two effects above its Magic Capacity are required before the interference DC increases by 1."}],
		effects: [],
	},
	{
		name: "Rose Gold",
		source: "TGTT",
		materialCategory: "metal",
		density: 15.0,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: 2,
		rarity: "rare",
		price: {gp: 300, unit: "lb", display: "300 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		magicCapacityRules: [{type: "freeEffect", theme: "loyalty and affection"}],
		effects: [],
	},
	{
		name: "Electrum",
		source: "TGTT",
		materialCategory: "metal",
		density: 14.0,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: 2,
		rarity: "uncommon",
		price: {gp: 50, unit: "lb", display: "50 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		magicCapacityRules: [{type: "opposedStatesCountAsOne"}],
		effects: [],
	},
	{
		name: "Plain Iron",
		source: "TGTT",
		materialCategory: "metal",
		density: 7.87,
		damage: 0,
		protection: 0,
		critical: 0,
		penetration: 0,
		magicCapacity: "na",
		rarity: "common",
		price: {gp: 1, unit: "lb", display: "1 gp per lb.", isPriceless: false},
		appliesTo: ["weapon", "armor", "shield", "other"],
		effects: [],
	},
];

const findMat = name => MATERIALS.find(m => m.name === name);

describe("Item Materials", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setItemMaterialCatalog(MATERIALS);
	});

	afterEach(() => {
		delete globalThis.__csMaterialCatalog;
	});

	// ==========================================================================
	// Damage die ladder
	// ==========================================================================
	describe("stepDamageDie", () => {
		it("walks the full 11-step ladder past d12", () => {
			expect(CharacterSheetMaterials.stepDamageDie("1d10", 1)).toBe("1d12");
			expect(CharacterSheetMaterials.stepDamageDie("1d12", 1)).toBe("2d6");
			expect(CharacterSheetMaterials.stepDamageDie("2d6", 1)).toBe("2d8");
			expect(CharacterSheetMaterials.stepDamageDie("2d12", 1)).toBe("3d8");
			expect(CharacterSheetMaterials.stepDamageDie("3d8", 1)).toBe("3d10");
		});

		it("supports negative steps", () => {
			expect(CharacterSheetMaterials.stepDamageDie("1d8", -1)).toBe("1d6");
			expect(CharacterSheetMaterials.stepDamageDie("1d8", -2)).toBe("1d4");
			expect(CharacterSheetMaterials.stepDamageDie("2d6", -1)).toBe("1d12");
		});

		it("clamps at both ends of the ladder", () => {
			expect(CharacterSheetMaterials.stepDamageDie("1d4", -5)).toBe("1d4");
			expect(CharacterSheetMaterials.stepDamageDie("3d10", 5)).toBe("3d10");
		});

		it("maps the off-ladder equivalents the rules call out", () => {
			// 2d4 sits at the 1d12 rung; 3d6 at the 2d12 rung.
			expect(CharacterSheetMaterials.stepDamageDie("2d4", 1)).toBe("2d6");
			expect(CharacterSheetMaterials.stepDamageDie("3d6", 1)).toBe("3d8");
		});

		it("leaves unrecognised or zero-step input alone", () => {
			expect(CharacterSheetMaterials.stepDamageDie("1d7", 1)).toBe("1d7");
			expect(CharacterSheetMaterials.stepDamageDie("1d8", 0)).toBe("1d8");
			expect(CharacterSheetMaterials.stepDamageDie(null, 1)).toBe(null);
		});
	});

	// ==========================================================================
	// Tri-state axes
	// ==========================================================================
	describe("tri-state axes", () => {
		it("treats only real numbers as live values", () => {
			expect(CharacterSheetMaterials.axisValue(2)).toBe(2);
			expect(CharacterSheetMaterials.axisValue(0)).toBe(0);
			expect(CharacterSheetMaterials.axisValue("na")).toBe(null);
			expect(CharacterSheetMaterials.axisValue(null)).toBe(null);
			expect(CharacterSheetMaterials.axisValue("infinity")).toBe(null);
		});

		it("formats the sentinels for display", () => {
			expect(CharacterSheetMaterials.formatAxis("na")).toBe("N/A");
			expect(CharacterSheetMaterials.formatAxis(null)).toBe("Varies");
			expect(CharacterSheetMaterials.formatAxis("infinity")).toBe("\u221E");
			expect(CharacterSheetMaterials.formatAxis("-infinity")).toBe("\u2212\u221E");
			expect(CharacterSheetMaterials.formatAxis(2, {plus: true})).toBe("+2");
		});
	});

	// ==========================================================================
	// Eligibility
	// ==========================================================================
	describe("eligibility", () => {
		it("keeps a material off item kinds its axes rule out", () => {
			const armor = {name: "Breastplate", armor: true, type: "MA", ac: 14};
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8"};
			// Glass has `protection: "na"` — it cannot be armour.
			expect(CharacterSheetMaterials.isEligible(armor, findMat("Ordinary Glass"))).toBe(false);
			expect(CharacterSheetMaterials.isEligible(sword, findMat("Ordinary Glass"))).toBe(true);
			// Cloth has `damage: "na"` — it cannot be a weapon.
			expect(CharacterSheetMaterials.isEligible(sword, findMat("Common Cloth"))).toBe(false);
			expect(CharacterSheetMaterials.isEligible(armor, findMat("Common Cloth"))).toBe(true);
		});
	});

	// ==========================================================================
	// Projection — weapons
	// ==========================================================================
	describe("weapon projection", () => {
		const sword = () => ({name: "Longsword", weapon: true, type: "M", dmg1: "1d8", dmg2: "1d10", property: ["V"], weight: 3, value: 1500});

		it("steps the damage dice by the Damage axis", () => {
			const out = CharacterSheetMaterials.applyToItem(sword(), findMat("Steel"));
			expect(out.dmg1).toBe("1d10");
			expect(out.dmg2).toBe("1d12");
		});

		it("steps damage DOWN for a negative axis", () => {
			const out = CharacterSheetMaterials.applyToItem(sword(), findMat("Gold"));
			expect(out.dmg1).toBe("1d6");
			expect(out.dmg2).toBe("1d8");
		});

		it("applies the Penetration axis to weapons only", () => {
			expect(CharacterSheetMaterials.applyToItem(sword(), findMat("Darkmetal")).penetration).toBe(2);
			const armor = {name: "Breastplate", armor: true, type: "MA", ac: 14};
			expect(CharacterSheetMaterials.applyToItem(armor, findMat("Darkmetal")).penetration).toBeUndefined();
		});

		it("lowers the crit threshold by the Critical axis, clamped", () => {
			const glass = CharacterSheetMaterials.applyToItem(sword(), findMat("Ordinary Glass"));
			expect(glass.critThreshold).toBe(19);
			// Gold's -1 Critical raises the threshold, but never past the natural 20.
			const gold = CharacterSheetMaterials.applyToItem(sword(), findMat("Gold"));
			expect(gold.critThreshold).toBe(20);
		});

		it("adds and removes weapon properties", () => {
			const light = {name: "Dagger", weapon: true, type: "M", dmg1: "1d4", property: ["L", "F", "T"]};
			const out = CharacterSheetMaterials.applyToItem(light, findMat("Darkmetal"));
			expect(out.property).toContain("H");
			expect(out.property).not.toContain("L");
			expect(out.property).not.toContain("F");
			expect(out.property).toContain("T");
		});

		it("walks the Mithril property ladder without cascading two rungs", () => {
			const twoHanded = CharacterSheetMaterials.applyToItem({name: "Greatsword", weapon: true, type: "M", dmg1: "2d6", property: ["2H", "H"]}, findMat("Mithril"));
			expect(twoHanded.property).toContain("V");
			expect(twoHanded.property).not.toContain("2H");

			const lightWeapon = CharacterSheetMaterials.applyToItem({name: "Dagger", weapon: true, type: "M", dmg1: "1d4", property: ["L"]}, findMat("Mithril"));
			expect(lightWeapon.property).toContain("F");
			// The "_" default rung must not also fire for a weapon matched by "L".
			expect(lightWeapon.property.filter(p => p === "L").length).toBe(1);

			const plain = CharacterSheetMaterials.applyToItem({name: "Mace", weapon: true, type: "M", dmg1: "1d6", property: []}, findMat("Mithril"));
			expect(plain.property).toContain("L");
		});

		it("scales ranged weapon range", () => {
			const bow = {name: "Longbow", weapon: true, type: "R", dmg1: "1d8", range: "150/600"};
			expect(CharacterSheetMaterials.applyToItem(bow, findMat("Desert Ironwood")).range).toBe("225/900");
		});
	});

	// ==========================================================================
	// Projection — armour & shields
	// ==========================================================================
	describe("armour and shield projection", () => {
		const breastplate = () => ({name: "Breastplate", armor: true, type: "MA", ac: 14, dexterityMax: 2, strength: 13, stealth: true, weight: 20, value: 40000});
		const shield = () => ({name: "Shield", shield: true, type: "S", acBonus: 2, weight: 6, value: 1000});

		it("sets base AC literally from the Protection axis", () => {
			expect(CharacterSheetMaterials.applyToItem(breastplate(), findMat("Mithril")).ac).toBe(18);
			expect(CharacterSheetMaterials.applyToItem(breastplate(), findMat("Adamantine")).ac).toBe(21);
		});

		it("does not apply Protection to a weapon", () => {
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8"};
			expect(CharacterSheetMaterials.applyToItem(sword, findMat("Mithril")).ac).toBeUndefined();
		});

		it("applies Darkmetal's armour penalties", () => {
			const out = CharacterSheetMaterials.applyToItem(breastplate(), findMat("Darkmetal"));
			expect(out.armorType).toBe("heavy");
			expect(out.stealth).toBe(true);
			expect(out.strength).toBe(15);
			expect(out.dexterityMax).toBe(1);
		});

		it("applies Mithril's armour reliefs", () => {
			const out = CharacterSheetMaterials.applyToItem(breastplate(), findMat("Mithril"));
			expect(out.stealth).toBe(false);
			expect(out.strength).toBe(null);
		});

		it("gates the AC bonus to shields", () => {
			// The user's explicit rule: Darkmetal's +1 AC is for SHIELDS, not armour.
			expect(CharacterSheetMaterials.applyToItem(shield(), findMat("Darkmetal")).acBonus).toBe(3);
			expect(CharacterSheetMaterials.applyToItem(breastplate(), findMat("Darkmetal")).acBonus).toBeUndefined();
			expect(CharacterSheetMaterials.applyToItem(shield(), findMat("Adamantine")).acBonus).toBe(4);
		});
	});

	// ==========================================================================
	// Weight & value
	// ==========================================================================
	describe("weight and value", () => {
		it("derives weight from the density ratio against the metal baseline", () => {
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8", weight: 3};
			// Mithril 0.17 / iron 7.87 -> essentially weightless.
			expect(CharacterSheetMaterials.getEffectiveWeight(sword, findMat("Mithril"))).toBeCloseTo(0.06, 2);
			// Gold 19.32 / 7.87 = 2.455x
			expect(CharacterSheetMaterials.getEffectiveWeight(sword, findMat("Gold"))).toBeCloseTo(7.36, 1);
		});

		it("prefers an explicit weightMultiplier over the density ratio", () => {
			const club = {name: "Club", weapon: true, type: "M", dmg1: "1d4", weight: 2};
			expect(CharacterSheetMaterials.getEffectiveWeight(club, findMat("Desert Ironwood"))).toBe(2.5);
		});

		it("leaves weight alone when density Varies", () => {
			const rod = {name: "Rod", weight: 5};
			expect(CharacterSheetMaterials.getEffectiveWeight(rod, findMat("Heart Stone"))).toBe(5);
		});

		it("recomputes value only for per-pound trade units", () => {
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8", weight: 3, value: 1500};
			// Gold: 7.36 lb x 50 gp = 368 gp, on top of the 15 gp base.
			const value = CharacterSheetMaterials.getEffectiveValue(sword, findMat("Gold"));
			expect(value).toBeGreaterThan(1500);
			expect(Math.round(value / 100)).toBe(383);
		});

		it("leaves value alone for non-pound and priceless trade units", () => {
			const gown = {name: "Gown", weight: 4, value: 500};
			expect(CharacterSheetMaterials.getEffectiveValue(gown, findMat("Common Cloth"))).toBe(500);
			expect(CharacterSheetMaterials.getEffectiveValue(gown, findMat("Heart Stone"))).toBe(500);
		});
	});

	// ==========================================================================
	// Effect resolution
	// ==========================================================================
	describe("effect resolution", () => {
		it("surfaces conditional effects rather than auto-applying them", () => {
			const fx = CharacterSheetMaterials.getMaterialEffects({name: "Helm", armor: true, type: "HA", ac: 18}, findMat("Lead"));
			expect(fx.conditionalModifiers).toHaveLength(1);
			expect(fx.conditionalModifiers[0].kind).toBe("save");
			expect(fx.conditionalModifiers[0].schools).toEqual(["divination"]);
		});

		it("resolves damage reduction with its armour-type gate", () => {
			const fx = CharacterSheetMaterials.getMaterialEffects({name: "Plate", armor: true, type: "HA", ac: 18}, findMat("Adamantine"));
			expect(fx.indestructible).toBe(true);
			expect(fx.damageReduction).toHaveLength(1);
			expect(fx.damageReduction[0].value).toBe(3);
			expect(fx.damageReduction[0].armorType).toBe("heavy");
		});

		it("does not leak a shield-gated bonus onto armour", () => {
			const fx = CharacterSheetMaterials.getMaterialEffects({name: "Plate", armor: true, type: "HA", ac: 18}, findMat("Darkmetal"));
			expect(fx.bonusAc).toBe(0);
		});
	});

	// ==========================================================================
	// State integration
	// ==========================================================================
	describe("state integration", () => {
		const addSword = () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", weight: 3, value: 1500});
			return state.getItems()[0].id;
		};

		it("stores the material as a non-destructive reference", () => {
			const id = addSword();
			expect(state.setItemMaterial(id, findMat("Steel"))).toBe(true);

			const raw = state.getItemRaw(id);
			expect(raw.material).toEqual({name: "Steel", source: "TGTT"});
			// The BASE item is untouched — only the reference was stored.
			expect(raw.dmg1).toBe("1d8");
			expect(raw.weight).toBe(3);
		});

		it("projects the material through getItems()", () => {
			const id = addSword();
			state.setItemMaterial(id, findMat("Steel"));

			const item = state.getItems().find(i => i.id === id);
			expect(item.dmg1).toBe("1d10");
			expect(item.penetration).toBe(1);
		});

		it("restores the base item when the material is cleared", () => {
			const id = addSword();
			state.setItemMaterial(id, findMat("Darkmetal"));
			expect(state.getItems().find(i => i.id === id).dmg1).toBe("1d10");

			expect(state.clearItemMaterial(id)).toBe(true);
			const item = state.getItems().find(i => i.id === id);
			expect(item.dmg1).toBe("1d8");
			expect(item.penetration).toBeUndefined();
			expect(item.material).toBeUndefined();
		});

		it("swaps materials without compounding their effects", () => {
			const id = addSword();
			state.setItemMaterial(id, findMat("Steel"));
			state.setItemMaterial(id, findMat("Steel"));
			state.setItemMaterial(id, findMat("Darkmetal"));
			// Three applications, one net step — the reference is replaced, not stacked.
			expect(state.getItems().find(i => i.id === id).dmg1).toBe("1d10");
		});

		it("counts a material's weight in the carried total", () => {
			const id = addSword();
			const before = state.getTotalWeight();
			state.setItemMaterial(id, findMat("Gold"));
			expect(state.getTotalWeight()).toBeGreaterThan(before);
		});

		it("respects the master toggle", () => {
			const id = addSword();
			state.setItemMaterial(id, findMat("Steel"));
			state.setSetting("enableMaterials", false);
			expect(state.getItems().find(i => i.id === id).dmg1).toBe("1d8");
		});

		it("respects the weight sub-toggle", () => {
			const id = addSword();
			state.setSetting("materials_weightFromDensity", false);
			state.setItemMaterial(id, findMat("Gold"));
			const item = state.getItems().find(i => i.id === id);
			expect(item.weight).toBe(3);
			// The damage axis still applies — only the weight derivation is off.
			expect(item.dmg1).toBe("1d6");
		});

		it("feeds the material's Protection into the equipped armour AC", () => {
			state.addItem({name: "Breastplate", source: "PHB", type: "armor", armor: true, armorType: "medium", ac: 14, dexterityMax: 2, strength: 13, stealth: true, weight: 20});
			const id = state.getItems().find(i => i.name === "Breastplate").id;
			state.equip(id);
			const baseAc = state.getAc();

			state.setItemMaterial(id, findMat("Mithril"));
			// Protection 18 replaces the breastplate's base 14.
			expect(state.getAc()).toBe(baseAc + 4);
		});

		it("lifts the armour Strength requirement via the material", () => {
			// STR 16 wearer, STR 18 armour -> penalised until Mithril removes the requirement.
			state.addItem({name: "Plate", source: "PHB", type: "armor", armor: true, armorType: "heavy", ac: 18, strength: 18, stealth: true, weight: 65});
			const id = state.getItems().find(i => i.name === "Plate").id;
			state.equip(id);
			expect(state.getArmorStrengthPenalty()).toBeTruthy();

			state.setItemMaterial(id, findMat("Mithril"));
			expect(state.getArmorStrengthPenalty()).toBeFalsy();
		});

		it("registers a material's conditional modifier only while equipped", () => {
			state.addItem({name: "Leaded Cloak", source: "Custom", type: "armor", armor: true, ac: 11});
			const id = state.getItems().find(i => i.name === "Leaded Cloak").id;
			state.setItemMaterial(id, findMat("Lead"));

			const own = () => (state.getNamedModifiers?.() || []).filter(m => m.sourceType === "itemMaterial");
			expect(own()).toHaveLength(0);

			state.equip(id);
			expect(own()).toHaveLength(1);
			expect(own()[0].advantage).toBe(true);

			state.unequip(id);
			expect(own()).toHaveLength(0);
		});

		it("round-trips a material through save and load", () => {
			const id = addSword();
			state.setItemMaterial(id, findMat("Darkmetal"));

			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.setItemMaterialCatalog(MATERIALS);
			restored.loadFromJson(JSON.parse(JSON.stringify(json)));

			const item = restored.getItems().find(i => i.name === "Longsword");
			expect(item.material).toEqual({name: "Darkmetal", source: "TGTT"});
			expect(item.dmg1).toBe("1d10");
		});

		it("backfills the material settings for saves that predate them", () => {
			const json = state.toJson();
			delete json.settings.enableMaterials;
			delete json.settings.materials_penetration;

			const restored = new CharacterSheetState();
			restored.loadFromJson(JSON.parse(JSON.stringify(json)));
			expect(restored.getSettings().enableMaterials).toBe(true);
			expect(restored.getSettings().materials_penetration).toBe(true);
		});

		it("preserves a deliberate opt-out across load", () => {
			state.setSetting("enableMaterials", false);
			const json = state.toJson();

			const restored = new CharacterSheetState();
			restored.loadFromJson(JSON.parse(JSON.stringify(json)));
			expect(restored.getSettings().enableMaterials).toBe(false);
		});
	});

	// ==========================================================================
	// Preview
	// ==========================================================================
	describe("preview", () => {
		it("lists only the axes that actually change", () => {
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8", weight: 3, value: 1500};
			const rows = CharacterSheetMaterials.getPreviewRows(sword, findMat("Steel"));
			const labels = rows.map(r => r.label);
			expect(labels).toContain("Damage");
			expect(labels).toContain("Penetration");
			expect(labels).not.toContain("Base AC");
		});

		it("compares against the BASE item, not the current material", () => {
			const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8", material: {name: "Steel", source: "TGTT"}};
			const rows = CharacterSheetMaterials.getPreviewRows(sword, findMat("Gold"));
			const damage = rows.find(r => r.label === "Damage");
			expect(damage.from).toBe("1d8");
			expect(damage.to).toBe("1d6");
		});
	});

	describe("getSummary", () => {
		const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8"};
		const mail = {name: "Chain Mail", armor: true, type: "HA", ac: 16};

		it("lists every axis when no item is supplied", () => {
			const summary = CharacterSheetMaterials.getSummary(findMat("Mithril"));
			expect(summary).toContain("AC");
		});

		it("never promises AC on a weapon", () => {
			// The picker used to advertise "Mithril — AC 18" on a longsword, describing
			// armour the player was not looking at.
			const summary = CharacterSheetMaterials.getSummary(findMat("Mithril"), sword);
			expect(summary).not.toContain("AC");
			expect(summary).toContain("MC");
		});

		it("never promises damage or penetration on armour", () => {
			const summary = CharacterSheetMaterials.getSummary(findMat("Darkmetal"), mail);
			expect(summary).not.toContain("Dmg");
			expect(summary).not.toContain("Pen");
			expect(summary).toContain("AC");
		});

		it("never promises a crit threshold on armour, and does not set one", () => {
			// Nothing rolls against a breastplate's crit threshold, so advertising one
			// would be a promise the projection cannot keep.
			expect(CharacterSheetMaterials.getSummary(findMat("Gold"), mail)).not.toContain("Crit");
			expect(CharacterSheetMaterials.applyToItem(mail, findMat("Gold")).critThreshold).toBeUndefined();
		});

		it("keeps the axes that do apply", () => {
			const summary = CharacterSheetMaterials.getSummary(findMat("Darkmetal"), sword);
			expect(summary).toContain("Dmg");
			expect(summary).toContain("Pen");
		});
	});

	describe("accessible names", () => {
		const sword = {name: "Longsword", weapon: true, type: "M", dmg1: "1d8"};

		it("names the material chip with its effects, not just its noun", () => {
			// The chip renders "⚙ Mithril". A screen reader that only gets the visible
			// text learns the item is made of something, and nothing about why it matters.
			const label = CharacterSheetMaterials.getMaterialBadgeAriaLabel(findMat("Mithril"), sword);
			expect(label).toMatch(/^Material: Mithril\./);
			expect(label).toContain("MC");
		});

		it("respects item-aware axis gating in the chip's name", () => {
			expect(CharacterSheetMaterials.getMaterialBadgeAriaLabel(findMat("Mithril"), sword)).not.toContain("AC");
		});

		it("returns nothing when there is no material to name", () => {
			expect(CharacterSheetMaterials.getMaterialBadgeAriaLabel(null, sword)).toBe("");
		});

		it("spells the capacity ratio out rather than relying on a slash", () => {
			const label = CharacterSheetMaterials.getMagicCapacityAriaLabel(
				{name: "Steel"},
				{count: 2, capacityDisplay: "3", isOverloaded: false},
			);
			expect(label).toBe("Magic Capacity 2 of 3. Open details.");
		});

		it("carries the overage and the interference DC when overloaded", () => {
			const label = CharacterSheetMaterials.getMagicCapacityAriaLabel(
				{name: "Steel"},
				{count: 5, capacityDisplay: "3", isOverloaded: true, overage: 2, dc: 17},
			);
			expect(label).toContain("overloaded by 2");
			expect(label).toContain("Interference DC 17");
		});

		it("names the suppressing and unlimited states distinctly", () => {
			const suppress = CharacterSheetMaterials.getMagicCapacityAriaLabel({name: "Rimeglass"}, {isSuppressing: true, count: 1});
			const unlimited = CharacterSheetMaterials.getMagicCapacityAriaLabel({name: "Adamant"}, {isUnlimited: true, count: 4});
			expect(suppress).toContain("suppresses magic");
			expect(unlimited).toContain("any number of enchantments");
		});

		it("describes the outcome rather than the input device", () => {
			// "Click for details" is fine in a tooltip, which only a mouse ever sees.
			// It is wrong in an accessible name, which a keyboard and a switch also read.
			const label = CharacterSheetMaterials.getMagicCapacityAriaLabel({name: "Steel"}, {count: 1, capacityDisplay: "3"});
			expect(label).not.toMatch(/click/i);
		});

		it("returns nothing when there is no capacity status", () => {
			expect(CharacterSheetMaterials.getMagicCapacityAriaLabel({name: "Steel"}, null)).toBe("");
		});
	});

	describe("getRiskFlag", () => {
		const spec = (over) => ({
			name: "X",
			source: "TGTT",
			materialCategory: "stone",
			density: 2,
			damage: 0,
			protection: 0,
			critical: 0,
			penetration: 0,
			magicCapacity: 1,
			rarity: "common",
			price: {gp: 0, unit: "lb", display: "—"},
			appliesTo: ["weapon"],
			effects: [],
			degradation: over,
		});

		it("says nothing about the sixty-seven materials that never degrade", () => {
			expect(CharacterSheetMaterials.getRiskFlag({name: "Steel"})).toBeNull();
			expect(CharacterSheetMaterials.getRiskFlag(null)).toBeNull();
		});

		it("separates destruction from recoverable wear", () => {
			// Collapsing the two would either cry wolf about Obsidian or under-sell Glass.
			const destroys = CharacterSheetMaterials.getRiskFlag(spec({
				trigger: {on: "attackRoll", natural: [1], alsoOnCriticalHit: true},
				effect: {type: "destroy"},
				destroys: true,
				repair: null,
			}));
			const degrades = CharacterSheetMaterials.getRiskFlag(spec({
				trigger: {on: "attackRoll", natural: [1]},
				effect: {type: "damageStepDelta", value: -1},
				destroys: false,
				repair: {method: "shortRest", tool: "mason's tools"},
			}));
			expect(destroys.tier).toBe("destroys");
			expect(destroys.label).toBe("Can be destroyed");
			expect(destroys.repair).toBeNull();
			expect(degrades.tier).toBe("degrades");
			expect(degrades.repair).toBe("Repaired over a Short Rest with mason's tools.");
		});

		it("names the trigger the player will actually roll", () => {
			expect(CharacterSheetMaterials.getRiskFlag(spec({
				trigger: {on: "attackRoll", natural: [1], alsoOnCriticalHit: true}, destroys: true,
			})).trigger).toBe("on a natural 1 or a critical hit");

			expect(CharacterSheetMaterials.getRiskFlag(spec({
				trigger: {on: "damageTaken", damageType: "fire"},
				effect: {type: "zeroAxes", axes: ["protection"]},
				repair: {method: "manual"},
			})).trigger).toBe("when it takes fire damage");
		});

		it("falls back rather than throwing on an unrecognised trigger", () => {
			expect(CharacterSheetMaterials.getRiskFlag(spec({trigger: {on: "eclipse"}})).trigger).toBe("in use");
			expect(CharacterSheetMaterials.getRiskFlag(spec({})).trigger).toBe("in use");
		});

		it("flags exactly the five degrading materials in the real catalog", () => {
			// Derived from the authored `degradation` block, never from a material's name —
			// so adding a sixth degrading material needs no code change.
			const flagged = MATERIALS.filter(m => CharacterSheetMaterials.getRiskFlag(m));
			expect(flagged.every(m => !!m.degradation)).toBe(true);
			expect(MATERIALS.filter(m => m.degradation).length).toBe(flagged.length);
		});
	});

	describe("material undo", () => {
		let state; let mod; let itemId; let toasts; let restoreToast;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setItemMaterialCatalog(MATERIALS);
			state.addItem({name: "Longsword", type: "M", weight: 3, value: 1500, quantity: 1, dmg1: "1d8"});
			itemId = state.getItems().at(-1).id;
			mod = new CharacterSheetMaterials({getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}});
			toasts = [];
			restoreToast = globalThis.JqueryUtil.doToast;
			globalThis.JqueryUtil.doToast = (opts) => toasts.push(opts);
		});

		afterEach(() => { globalThis.JqueryUtil.doToast = restoreToast; });

		const fireUndo = () => {
			const content = toasts.at(-1).content;
			content._handlers.click({target: {closest: sel => sel === ".charsheet__material-undo" ? {} : null}});
		};

		it("names what it would put back", () => {
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			mod._offerMaterialUndo(itemId, {name: "Gold", source: "TGTT"}, "Steel applied.");
			expect(toasts).toHaveLength(1);
			expect(toasts[0].content.outerHTML).toContain("Revert to Gold");
			expect(toasts[0].content.outerHTML).toContain("Steel applied.");
		});

		it("restores the material it replaced", () => {
			state.setItemMaterial(itemId, {name: "Gold", source: "TGTT"});
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			mod._offerMaterialUndo(itemId, {name: "Gold", source: "TGTT"}, "Steel applied.");
			fireUndo();
			expect(state.getItemRaw(itemId).material.name).toBe("Gold");
		});

		it("acknowledges the revert, since the host toast dismisses itself on the click", () => {
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			mod._offerMaterialUndo(itemId, {name: "Gold", source: "TGTT"}, "Steel applied.");
			fireUndo();
			expect(toasts).toHaveLength(2);
			expect(toasts[1].content).toBe("Reverted to Gold.");
		});

		it("restores the *absence* of a material as faithfully as a previous one", () => {
			// The common case is applying a material to a bare item, so "revert" has to
			// mean "make it bare again", not "leave the newest one in place".
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			mod._offerMaterialUndo(itemId, null, "Steel applied.");
			expect(toasts[0].content.outerHTML).toContain("Revert to no material");
			fireUndo();
			expect(state.getItemRaw(itemId).material).toBeFalsy();
		});

		it("stays silent rather than throwing when there is no toast host", () => {
			const saved = globalThis.JqueryUtil;
			globalThis.JqueryUtil = undefined;
			expect(() => mod._offerMaterialUndo(itemId, null, "x")).not.toThrow();
			globalThis.JqueryUtil = saved;
		});
	});

	// ==========================================================================
	// Magic Capacity
	// ==========================================================================
	describe("countMagicalEffects", () => {
		it("counts nothing on a mundane item", () => {
			expect(CharacterSheetMaterials.countMagicalEffects({name: "Longsword"}).total).toBe(0);
		});

		it("collapses one weapon enchantment expressed three ways into a single effect", () => {
			const {total, breakdown} = CharacterSheetMaterials.countMagicalEffects({
				name: "Longsword", bonusWeapon: "+2", bonusWeaponAttack: "+2", bonusWeaponDamage: "+2",
			});
			expect(total).toBe(1);
			expect(breakdown).toHaveLength(1);
			expect(breakdown[0].label).toBe("Weapon bonus");
		});

		it("counts separate families separately", () => {
			const {total} = CharacterSheetMaterials.countMagicalEffects({
				name: "Plate", bonusAc: "+1", bonusSavingThrow: "+1", bonusSpellAttack: "+1",
			});
			expect(total).toBe(3);
		});

		it("ignores inert zero bonuses", () => {
			expect(CharacterSheetMaterials.countMagicalEffects({name: "Sword", bonusWeapon: "+0", bonusAc: 0}).total).toBe(0);
		});

		it("keeps internal property names out of the breakdown a player reads", () => {
			// The breakdown is shown to someone deciding what to strip off an overloaded item.
			// `bonusWeapon, bonusWeaponAttack` is not an answer to "what is filling my sword up".
			const {breakdown} = CharacterSheetMaterials.countMagicalEffects({
				name: "Longsword",
				bonusWeapon: "+2",
				bonusWeaponDamage: "+2",
				ability: {str: {static: 19}},
				modifySpeed: {equal: {fly: "walk"}},
			});
			const detail = l => breakdown.find(b => b.label === l).detail;
			expect(detail("Weapon bonus")).toBe("attack and damage, damage rolls");
			expect(detail("Ability score set/bonus")).toBe("Strength");
			expect(detail("Speed alteration")).toBe("matched to another speed");
			expect(breakdown.some(b => /bonus[A-Z]|\bstr\b/.test(b.detail || ""))).toBe(false);
		});

		it("shows an unmapped key rather than dropping it", () => {
			// A leaked key is a bug worth seeing; hiding it would make the detail
			// unreconcilable with the count printed beside it.
			const {breakdown} = CharacterSheetMaterials.countMagicalEffects({name: "Idol", ability: {luck: {static: 19}}});
			expect(breakdown.find(b => b.label === "Ability score set/bonus").detail).toBe("luck");
		});

		it("counts upgrades, gems, spells, defences and item flags", () => {
			const {total} = CharacterSheetMaterials.countMagicalEffects({
				name: "Blade",
				appliedUpgrades: [{name: "Keen"}, {name: "Silvered"}],
				socketedGemstones: [{name: "Ruby"}],
				attachedSpells: ["fireball|phb"],
				resist: ["fire"],
				curse: true,
				sentient: true,
			});
			expect(total).toBe(7);
		});

		it("deducts the material's free effect and shows it in the breakdown", () => {
			const item = {name: "Ring", bonusAc: "+1", attachedSpells: ["charm person|phb"]};
			const {total, breakdown} = CharacterSheetMaterials.countMagicalEffects(item, {material: findMat("Rose Gold")});
			expect(total).toBe(1);
			expect(breakdown.find(b => b.count === -1).label).toContain("free effect");
		});

		it("never drops below zero", () => {
			const {total} = CharacterSheetMaterials.countMagicalEffects({name: "Ring"}, {manualAdjust: -5});
			expect(total).toBe(0);
		});

		// `attachedSpells` is a dict roughly four times as often as it is an array —
		// both in the shipped catalog and in what the sheet's own custom-item builder
		// emits — so every usage shape has to count, not just the flat list.
		describe("attachedSpells shapes", () => {
			const countSpells = (attachedSpells) => {
				const {breakdown} = CharacterSheetMaterials.countMagicalEffects({name: "Blade", attachedSpells});
				return breakdown.find(b => b.label === "Attached spells") || {count: 0, detail: ""};
			};

			it.each([
				["flat array", ["fireball|phb", "light"], 2],
				["will", {will: ["thunderwave"]}, 1],
				["other", {other: ["teleport|xphb"]}, 1],
				["ritual", {ritual: ["detect evil and good"]}, 1],
				["daily", {daily: {"1e": ["antimagic field", "augury"]}}, 2],
				["charges", {charges: {"3": ["reverse gravity"]}}, 1],
				["limited", {limited: {"1": ["feather fall", "levitate"]}}, 2],
				["rest", {rest: {"1e": ["meld into stone"]}}, 1],
			])("counts the %s form", (_label, attachedSpells, expected) => {
				expect(countSpells(attachedSpells).count).toBe(expected);
			});

			it("counts across combined usage keys, as the custom-item builder emits them", () => {
				expect(countSpells({will: ["mage hand|phb"], daily: {"1": ["bigby's hand|phb"]}, charges: {"2": ["shatter"]}}).count).toBe(3);
			});

			it("does not mistake the non-spell `ability` key for a spell", () => {
				const res = countSpells({daily: {"1e": ["augury", "polymorph"]}, ability: "int"});
				expect(res.count).toBe(2);
				expect(res.detail).not.toContain("int");
			});

			it("counts a spell offered under two usages only once", () => {
				expect(countSpells({will: ["mage hand"], daily: {"1": ["Mage Hand|PHB"]}}).count).toBe(1);
			});

			it("strips source and cast-level suffixes from the breakdown detail", () => {
				expect(countSpells({will: ["thunderwave#4"], other: ["teleport|xphb"]}).detail).toBe("thunderwave, teleport");
			});

			it("treats a dict holding no spell lists as no spells", () => {
				expect(countSpells({ability: "cha"}).count).toBe(0);
			});
		});
	});

	describe("getMagicCapacityStatus", () => {
		const withMat = (name, extra = {}) => ({name: "Blade", material: {name, source: "TGTT"}, ...extra});

		it("returns null when the material states no capacity", () => {
			expect(CharacterSheetMaterials.getMagicCapacityStatus(withMat("Plain Iron"), findMat("Plain Iron"))).toBeNull();
		});

		it("is not overloaded at exactly capacity", () => {
			const item = withMat("Electrum", {appliedUpgrades: [{name: "A"}, {name: "B"}]});
			const st = CharacterSheetMaterials.getMagicCapacityStatus(item, findMat("Electrum"));
			expect(st.count).toBe(2);
			expect(st.isOverloaded).toBe(false);
			expect(st.dc).toBeNull();
		});

		it("raises the DC by one per effect over capacity", () => {
			const item = withMat("Electrum", {appliedUpgrades: [{name: "A"}, {name: "B"}, {name: "C"}, {name: "D"}]});
			const st = CharacterSheetMaterials.getMagicCapacityStatus(item, findMat("Electrum"));
			expect(st.overage).toBe(2);
			expect(st.dc).toBe(17);
		});

		it("honours Steeline's two-over threshold before the DC climbs", () => {
			const mat = findMat("Steeline");
			const one = CharacterSheetMaterials.getMagicCapacityStatus(withMat("Steeline", {appliedUpgrades: [{name: "A"}, {name: "B"}, {name: "C"}]}), mat);
			expect(one.overage).toBe(1);
			expect(one.dc).toBe(15);

			const two = CharacterSheetMaterials.getMagicCapacityStatus(withMat("Steeline", {appliedUpgrades: [{name: "A"}, {name: "B"}, {name: "C"}, {name: "D"}]}), mat);
			expect(two.overage).toBe(2);
			expect(two.dc).toBe(16);
		});

		it("never overloads an unlimited material", () => {
			const item = withMat("Jadoo", {appliedUpgrades: Array.from({length: 20}, (_, i) => ({name: `U${i}`}))});
			const st = CharacterSheetMaterials.getMagicCapacityStatus(item, findMat("Jadoo"));
			expect(st.isUnlimited).toBe(true);
			expect(st.isOverloaded).toBe(false);
			expect(st.capacityDisplay).toBe("\u221E");
		});

		it("marks a negative-infinity material as suppressing, not overloaded", () => {
			const st = CharacterSheetMaterials.getMagicCapacityStatus(withMat("Lead", {bonusAc: "+1"}), findMat("Lead"));
			expect(st.isSuppressing).toBe(true);
			expect(st.isOverloaded).toBe(false);
			expect(st.capacityDisplay).toBe("\u2212\u221E");
		});

		it("prefers the authored rules text over the fallback", () => {
			const st = CharacterSheetMaterials.getMagicCapacityStatus(withMat("Steeline"), findMat("Steeline"));
			expect(st.notes[0]).toContain("Two effects above its Magic Capacity");
			expect(st.notes[0]).toContain("Already applied to the DC.");
		});

		it("falls back to generated text when the entity carries no note", () => {
			const st = CharacterSheetMaterials.getMagicCapacityStatus(withMat("Electrum"), findMat("Electrum"));
			expect(st.notes[0]).toContain("Electrum");
			expect(st.notes[0]).toContain("opposed states");
		});
	});

	describe("rollMagicalInterference", () => {
		it("passes when the roll MEETS the DC", () => {
			const res = CharacterSheetMaterials.rollMagicalInterference(15, () => 15);
			expect(res.passed).toBe(true);
			expect(res.effect).toBeNull();
		});

		it("fails one below the DC and returns a table entry", () => {
			let call = 0;
			const res = CharacterSheetMaterials.rollMagicalInterference(15, () => (call++ === 0 ? 14 : 3));
			expect(res.passed).toBe(false);
			expect(res.d8).toBe(3);
			expect(res.effect).toBe(CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE[2]);
		});

		it("covers every face of the d8 table", () => {
			for (let face = 1; face <= 8; ++face) {
				let call = 0;
				const res = CharacterSheetMaterials.rollMagicalInterference(15, () => (call++ === 0 ? 1 : face));
				expect(res.effect).toBeTruthy();
				expect(res.effect.name).toBeTruthy();
			}
		});
	});

	describe("magic capacity via state", () => {
		const addBlade = (materialName, extra = {}) => {
			state.addItem({name: `Blade ${state.getItems().length}`, weapon: true, type: "M", dmg1: "1d8", ...extra});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: materialName, source: "TGTT"});
			return id;
		};

		it("returns null for an item with no material", () => {
			state.addItem({name: "Club", weapon: true, type: "M", dmg1: "1d4"});
			expect(state.getMagicCapacityStatus(state.getItems().at(-1).id)).toBeNull();
		});

		it("counts dict-form attached spells, the shape the catalog actually ships", () => {
			const id = addBlade("Electrum", {attachedSpells: {will: ["mage hand|phb"], daily: {"1e": ["fireball|phb"]}}});
			expect(state.getMagicCapacityStatus(id)?.count).toBe(2);
		});

		it("degrades to null rather than throwing when the tally cannot be computed", () => {
			const id = addBlade("Electrum");
			const origStatus = CharacterSheetMaterials.getMagicCapacityStatus;
			const origWarn = console.warn;
			let errors = 0;
			CharacterSheetMaterials.getMagicCapacityStatus = () => { throw new Error("unfamiliar item shape"); };
			console.warn = () => { errors++; };
			try {
				// A single odd item must cost a badge, not the whole inventory render.
				expect(() => state.getMagicCapacityStatus(id)).not.toThrow();
				expect(state.getMagicCapacityStatus(id)).toBeNull();
				expect(() => state.getOverloadedMaterialItems()).not.toThrow();
				expect(errors).toBeGreaterThan(0);
			} finally {
				CharacterSheetMaterials.getMagicCapacityStatus = origStatus;
				console.warn = origWarn;
			}
		});

		it("counts against the RAW item, so a material's own bonus does not eat its capacity", () => {
			state.addItem({name: "Shield", type: "S", ac: 2});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Darkmetal", source: "TGTT"});
			// Darkmetal grants shields +1 AC. That is what the shield IS, not an enchantment.
			expect(state.getItems().find(i => i.id === id).acBonus).toBeTruthy();
			const st = state.getMagicCapacityStatus(id);
			expect(st?.count ?? 0).toBe(0);
		});

		it("round-trips the manual adjustment through save/load", () => {
			const id = addBlade("Electrum");
			expect(state.setMagicCapacityAdjust(id, -1)).toBe(true);
			expect(state.getMagicCapacityAdjust(id)).toBe(-1);

			const restored = new CharacterSheetState();
			restored.setItemMaterialCatalog(MATERIALS);
			restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
			expect(restored.getMagicCapacityAdjust(id)).toBe(-1);
		});

		it("clears the override rather than storing a zero", () => {
			const id = addBlade("Electrum");
			state.setMagicCapacityAdjust(id, 2);
			state.setMagicCapacityAdjust(id, 0);
			expect(state.getItemRaw(id).material.mcAdjust).toBeUndefined();
		});

		it("drops the override when the material is removed", () => {
			const id = addBlade("Electrum");
			state.setMagicCapacityAdjust(id, 2);
			state.clearItemMaterial(id);
			expect(state.getMagicCapacityAdjust(id)).toBe(0);
			expect(state.getMagicCapacityStatus(id)).toBeNull();
		});

		it("respects the sub-toggle", () => {
			const id = addBlade("Electrum");
			expect(state.getMagicCapacityStatus(id)).toBeTruthy();
			state.setSetting("materials_magicCapacity", false);
			expect(state.getMagicCapacityStatus(id)).toBeNull();
		});

		it("lists only overloaded items for the rest re-check", () => {
			addBlade("Electrum");
			const overId = addBlade("Electrum", {appliedUpgrades: [{name: "A"}, {name: "B"}, {name: "C"}]});
			const overloaded = state.getOverloadedMaterialItems();
			expect(overloaded).toHaveLength(1);
			expect(overloaded[0].id).toBe(overId);
			expect(overloaded[0].status.dc).toBe(16);
		});
	});

	describe("getMaterialNotes", () => {
		const weapon = {name: "Blade", weapon: true, type: "M", dmg1: "1d8"};
		const notesFor = (material) => CharacterSheetMaterials.getMaterialNotes(weapon, material);
		const mk = (effects) => ({name: "Testite", source: "TGTT", materialCategory: "metal", appliesTo: ["weapon"], effects});

		it("uses the authored note instead of the generated summary", () => {
			const notes = notesFor(mk([{type: "spellcastingFocus", note: "A weapon with a deep-crystal striking surface can be used as a spellcasting focus."}]));
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toBe("A weapon with a deep-crystal striking surface can be used as a spellcasting focus.");
		});

		it("falls back to the generated summary when no note is authored", () => {
			const notes = notesFor(mk([{type: "spellcastingFocus"}]));
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toBe("Can be used as a spellcasting focus");
		});

		it("surfaces authored notes for effects that generate no summary of their own", () => {
			const notes = notesFor(mk([{type: "rangeMultiplier", value: 1.5, note: "Normal range is multiplied by 1.5."}]));
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toBe("Normal range is multiplied by 1.5.");
		});

		it("does not double up a granted action's note", () => {
			const notes = notesFor(mk([{type: "grantsAction", name: "Snap Shot", note: "Make one attack as a bonus action."}]));
			expect(notes).toHaveLength(1);
			expect(notes[0].label).toBe("Snap Shot");
		});

		it("appends a qualifier note to the generated summary rather than replacing it", () => {
			const notes = notesFor(mk([{type: "noRangedDisadvantageInMelee", note: "While wielding a longbow or shortbow.", noteMode: "qualifier"}]));
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toBe("No disadvantage on ranged attacks while within 5 feet of a hostile creature \u2014 While wielding a longbow or shortbow.");
		});

		it("keeps one note per effect when several carry authored prose", () => {
			const notes = notesFor(mk([
				{type: "indestructible", note: "Cannot be broken."},
				{type: "countsAsSilvered", note: "Treated as silvered."},
			]));
			// Display order is the fixed order in `getMaterialNotes`, not authoring order.
			expect(notes.map(n => n.description)).toEqual(["Treated as silvered.", "Cannot be broken."]);
		});
	});

	describe("condensate roles", () => {
		const EMBERGLASS = {
			name: "Emberglass",
			source: "TGTT",
			materialCategory: "condensate",
			appliesTo: ["weapon", "armor", "shield", "other"],
			roles: ["strikingSurface", "protectiveLayer", "focus"],
			effects: [
				{type: "condensateAffinity", role: "strikingSurface", text: "A weapon made from it can deal fire damage instead of its normal type."},
				{type: "overrideDamageType", damageType: "fire", optional: true, appliesTo: ["weapon"]},
				{type: "condensateInstability", text: "Cold damage suppresses its affinity."},
			],
		};
		const SMOKESTONE = {
			name: "Smokestone",
			source: "TGTT",
			materialCategory: "condensate",
			appliesTo: ["weapon", "armor", "shield", "other"],
			roles: ["strikingSurface", "protectiveLayer", "focus"],
			effects: [
				{type: "condensateAffinity", role: "focus", text: "Create a sphere of smoke."},
				{type: "grantsAction", name: "Smokestone Cloud", actionType: "bonus", note: "Create a 10-foot-radius sphere of smoke."},
				{type: "condensateInstability", text: "Creatures relying on smell have Advantage to locate its carrier."},
			],
		};
		const weapon = {name: "Blade", weapon: true, type: "M", dmg1: "1d8"};
		const rod = {name: "Rod", type: "RD"};

		it("defaults a weapon to its striking surface", () => {
			expect(CharacterSheetMaterials.getActiveRole(weapon, EMBERGLASS)).toBe("strikingSurface");
		});

		it("defaults a non-weapon to focus", () => {
			expect(CharacterSheetMaterials.getActiveRole(rod, SMOKESTONE)).toBe("focus");
		});

		it("offers only the roles the item kind can host", () => {
			expect(CharacterSheetMaterials.getAvailableRoles(weapon, EMBERGLASS)).toEqual(["strikingSurface", "focus"]);
			expect(CharacterSheetMaterials.getAvailableRoles(rod, SMOKESTONE)).toEqual(["focus"]);
		});

		it("applies the affinity's mechanics in its own role", () => {
			const fx = CharacterSheetMaterials.getMaterialEffects(weapon, EMBERGLASS);
			expect(fx.overrideDamageType).toEqual({damageType: "fire", optional: true});
			expect(fx.condensate.isActive).toBe(true);
		});

		it("withholds the mechanics outside that role", () => {
			// A Smokestone blade is a blade of dense smoke-stone; the smoke cloud is a focus
			// property and does not come along for free.
			const fx = CharacterSheetMaterials.getMaterialEffects(weapon, SMOKESTONE);
			expect(fx.grantedActions).toHaveLength(0);
			expect(fx.condensate.isActive).toBe(false);
		});

		it("restores the mechanics when the role is switched", () => {
			const asFocus = {...weapon, material: {name: "Smokestone", source: "TGTT", role: "focus"}};
			const fx = CharacterSheetMaterials.getMaterialEffects(asFocus, SMOKESTONE);
			expect(fx.grantedActions).toHaveLength(1);
			expect(fx.condensate.isActive).toBe(true);
		});

		it("never gates away the instability", () => {
			const fx = CharacterSheetMaterials.getMaterialEffects(weapon, SMOKESTONE);
			expect(fx.condensate.instability).toContain("smell");
		});

		it("marks a dormant affinity in the notes", () => {
			const notes = CharacterSheetMaterials.getMaterialNotes(weapon, SMOKESTONE);
			const affinity = notes.find(n => n.label.includes("Affinity"));
			expect(affinity.label).toContain("dormant");
			expect(affinity.description).toContain("spellcasting focus");
		});

		it("tells a player who *can* reach the role how to reach it", () => {
			// A weapon can host `focus`, so Smokestone's affinity is one role switch away.
			const notes = CharacterSheetMaterials.getMaterialNotes(weapon, SMOKESTONE);
			const affinity = notes.find(n => n.label.includes("Affinity"));
			expect(affinity.description).toContain("switch its role to claim it");
		});

		it("does not dangle an unreachable affinity as if it were claimable", () => {
			// Rootstone's real shape: authored for a protective layer, which a weapon has no
			// slot for. "Applies only while…" would read as a condition the player could go
			// and satisfy; they cannot, and the copy has to say so.
			const ROOTSTONE = {
				...SMOKESTONE,
				name: "Rootstone",
				roles: ["protectiveLayer"],
				effects: [{type: "condensateAffinity", role: "protectiveLayer", text: "Roots grasp at attackers."}],
			};
			const notes = CharacterSheetMaterials.getMaterialNotes(weapon, ROOTSTONE);
			const affinity = notes.find(n => n.label.includes("Affinity"));
			expect(affinity.label).toContain("not available");
			expect(affinity.description).toContain("Never applies on a weapon");
			expect(affinity.description).not.toContain("switch its role");
		});

		it("ignores a stored role the item cannot host", () => {
			const bogus = {...rod, material: {name: "Smokestone", source: "TGTT", role: "strikingSurface"}};
			expect(CharacterSheetMaterials.getActiveRole(bogus, SMOKESTONE)).toBe("focus");
		});

		it("leaves non-condensate materials ungated", () => {
			expect(CharacterSheetMaterials.isRoleScoped(MATERIALS.find(m => m.name === "Steel"))).toBe(false);
		});
	});

	// ==========================================================================
	// Draconic Domain Resonance
	// ==========================================================================
	describe("draconic resonance", () => {
		const DRAGON_BONE = {
			name: "Dragon Bone",
			source: "TGTT",
			materialCategory: "dragon",
			density: null,
			damage: 1,
			protection: 19,
			critical: 0,
			penetration: 1,
			magicCapacity: 5,
			rarity: "very rare",
			price: {gp: 500, unit: "lb", display: "500 gp per lb.", isPriceless: false},
			appliesTo: ["weapon", "armor", "shield", "other"],
			effects: [
				{type: "draconicResonanceSlot", count: 1, text: "May carry 1 Draconic Domain Resonance from its source dragon"},
				{type: "note", text: "Structures reinforced with dragon bone have Resistance to all damage from nonmagical impacts."},
			],
		};
		const RESONANCES = [
			{name: "Ruinous Release", source: "TGTT", kind: "fear", domain: "Cataclysm", entries: ["After a critical hit with the item, creatures other than the user within 5 feet take {@damage 2d6} damage."]},
			{name: "Restorative Shelter", source: "TGTT", kind: "safety", domain: "Sanctuary", entries: ["When the item restores Hit Points, reroll one healing die that rolled a 1 or a 2."]},
		];

		let itemId;

		beforeEach(() => {
			state.setItemMaterialCatalog([...MATERIALS, DRAGON_BONE]);
			state.setDraconicResonanceCatalog(RESONANCES);
			state.addItem({name: "Bone Blade", type: "M", weight: 3, value: 1500, dmg1: "1d8", dmgType: "S", quantity: 1});
			itemId = state.getItems().at(-1).id;
			state.setItemMaterial(itemId, {name: "Dragon Bone", source: "TGTT"});
		});

		afterEach(() => {
			delete globalThis.__csResonanceCatalog;
		});

		it("exposes the slot count through the effect resolver", () => {
			const item = state.getItems().find(i => i.id === itemId);
			const fx = CharacterSheetMaterials.getMaterialEffects(item, DRAGON_BONE);
			expect(fx.draconicResonanceSlots).toBe(1);
		});

		it("resolves a resonance reference from the catalog", () => {
			const res = CharacterSheetMaterials.resolveResonance({material: {resonance: {name: "Ruinous Release", source: "TGTT"}}}, RESONANCES);
			expect(res.domain).toBe("Cataclysm");
		});

		it("resolves case-insensitively", () => {
			const res = CharacterSheetMaterials.resolveResonance({material: {resonance: {name: "ruinous release", source: "tgtt"}}}, RESONANCES);
			expect(res.name).toBe("Ruinous Release");
		});

		it("returns null when no resonance is chosen", () => {
			expect(CharacterSheetMaterials.resolveResonance({material: {name: "Dragon Bone", source: "TGTT"}}, RESONANCES)).toBeNull();
		});

		it("stores a chosen resonance on the material reference", () => {
			expect(state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"})).toBe(true);
			expect(state.getDraconicResonance(itemId).domain).toBe("Cataclysm");
		});

		it("rejects a reference that is not in the catalog", () => {
			expect(state.setDraconicResonance(itemId, {name: "Not A Resonance", source: "TGTT"})).toBe(false);
			expect(state.getDraconicResonance(itemId)).toBeNull();
		});

		it("rejects a resonance when the material grants no slot", () => {
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			expect(state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"})).toBe(false);
			expect(state.getDraconicResonance(itemId)).toBeNull();
		});

		it("replaces the slot note with the chosen resonance", () => {
			state.setDraconicResonance(itemId, {name: "Restorative Shelter", source: "TGTT"});
			const item = state.getItems().find(i => i.id === itemId);
			const notes = CharacterSheetMaterials.getMaterialNotes(item, DRAGON_BONE);
			expect(notes.some(n => /May carry/.test(n.description))).toBe(false);
			const chosen = notes.find(n => n.label === "Sanctuary — Restorative Shelter");
			expect(chosen.description).toContain("reroll one healing die");
		});

		it("labels a fear resonance as a drawback and a safety one as passive", () => {
			state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"});
			let item = state.getItems().find(i => i.id === itemId);
			expect(CharacterSheetMaterials.getMaterialNotes(item, DRAGON_BONE).find(n => n.label.includes("Cataclysm")).type).toBe("drawback");

			state.setDraconicResonance(itemId, {name: "Restorative Shelter", source: "TGTT"});
			item = state.getItems().find(i => i.id === itemId);
			expect(CharacterSheetMaterials.getMaterialNotes(item, DRAGON_BONE).find(n => n.label.includes("Sanctuary")).type).toBe("passive");
		});

		it("restores the slot note when the resonance is cleared", () => {
			state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"});
			expect(state.setDraconicResonance(itemId, null)).toBe(true);
			const item = state.getItems().find(i => i.id === itemId);
			expect(CharacterSheetMaterials.getMaterialNotes(item, DRAGON_BONE).some(n => /May carry/.test(n.description))).toBe(true);
		});

		it("voids the resonance when the material is swapped away", () => {
			state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"});
			state.setItemMaterial(itemId, {name: "Steel", source: "TGTT"});
			expect(state.getDraconicResonance(itemId)).toBeNull();
		});

		it("round-trips the resonance through save and load", () => {
			state.setDraconicResonance(itemId, {name: "Ruinous Release", source: "TGTT"});
			const restored = new CharacterSheetState();
			restored.setItemMaterialCatalog([...MATERIALS, DRAGON_BONE]);
			restored.setDraconicResonanceCatalog(RESONANCES);
			restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
			const restoredId = restored.getItems().find(i => i.name === "Bone Blade").id;
			expect(restored.getDraconicResonance(restoredId).name).toBe("Ruinous Release");
		});
	});

	// ==========================================================================
	// Ioun Sand matrices (Phase 3)
	// ==========================================================================
	describe("ioun sand matrix", () => {
		const IOUN_SAND = {
			name: "Ioun Sand",
			source: "TGTT",
			materialCategory: "crystal",
			density: null,
			damage: "na",
			protection: "na",
			critical: "na",
			penetration: "na",
			magicCapacity: "na",
			rarity: "legendary",
			price: {gp: 0, unit: "lb", display: "Priceless", isPriceless: true},
			appliesTo: ["other"],
			roles: ["focus"],
			effects: [{type: "doubleNumericProperties", note: "Each coherent numerical property granted by an intact Ioun Stone set in the matrix is doubled."}],
		};
		const IOUN_CRYSTAL = {
			name: "Ioun Crystal",
			source: "TGTT",
			materialCategory: "crystal",
			density: null,
			damage: 0,
			protection: 0,
			critical: 0,
			penetration: 0,
			magicCapacity: 2,
			rarity: "legendary",
			price: {gp: 0, unit: "lb", display: "Priceless", isPriceless: true},
			appliesTo: ["other"],
			effects: [],
			magicCapacityRules: [{type: "freeEffect", theme: "aligned resonance", appliesTo: "fragment"}],
		};

		let hostId;
		let stoneId;

		// The ⚙ editor is the only production writer of `iounSettings`; poking the raw row
		// keeps these tests on the state API surface they are actually exercising.
		const setSeats = (id, n) => { state._data.inventory.find(i => i.id === id).item.iounSettings = n; };

		const addStone = (name, props = {}) => {
			state.addItem({name, type: "W", weight: 0, value: 0, quantity: 1, ...props});
			const row = state.getItems().at(-1);
			state.setItemAttuned(row.id, true);
			return row.id;
		};

		beforeEach(() => {
			state.setItemMaterialCatalog([...MATERIALS, IOUN_SAND, IOUN_CRYSTAL]);
			state.addItem({name: "Crystalline Torc", type: "W", weight: 1, value: 0, quantity: 1});
			hostId = state.getItems().at(-1).id;
			state.setItemMaterial(hostId, {name: "Ioun Sand", source: "TGTT"});
			stoneId = addStone("Ioun Stone (Protection)", {bonusAc: 1});
		});

		it("recognises a matrix by its structured effect, not its name", () => {
			const host = state.getItems().find(i => i.id === hostId);
			expect(state.isIounMatrix(host)).toBe(true);

			state.addItem({name: "Ioun Sand Impostor", type: "W", weight: 1, value: 0, quantity: 1});
			const fakeId = state.getItems().at(-1).id;
			state.setItemMaterial(fakeId, {name: "Steel", source: "TGTT"});
			expect(state.isIounMatrix(state.getItems().find(i => i.id === fakeId))).toBe(false);
		});

		it("does not treat a matrix as one when materials are disabled", () => {
			state.setSetting("enableMaterials", false);
			expect(state.isIounMatrix(state.getItems().find(i => i.id === hostId))).toBe(false);
		});

		it("makes the item a host with one matrix seat", () => {
			const policy = state.getIounHostPolicy(state.getItems().find(i => i.id === hostId));
			expect(policy.isHost).toBe(true);
			expect(policy.isMatrix).toBe(true);
			expect(policy.settings).toBe(1);
			expect(policy.perStone).toBe(0);
		});

		it("respects an explicit iounSettings override without inventing a bonus", () => {
			setSeats(hostId, 3);
			const policy = state.getIounHostPolicy(state.getItems().find(i => i.id === hostId));
			expect(policy.settings).toBe(3);
			// Sizing a matrix from the editor must not turn it into an Ioun Blade.
			expect(policy.perStone).toBe(0);
			expect(policy.grants).toEqual([]);
		});

		it("adds no bonus of its own to a seated stone's host", () => {
			setSeats(hostId, 1);
			state.setIounStone(hostId, stoneId);
			const host = state.getItems().find(i => i.id === hostId);
			expect(host.bonusWeapon == null || host.bonusWeapon === 0).toBe(true);
		});

		it("doubles a seated stone's numeric bonuses", () => {
			expect(state.setIounStone(hostId, stoneId).success).toBe(true);
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(2);
		});

		it("restores the pristine value when the stone is pried out", () => {
			state.setIounStone(hostId, stoneId);
			state.unsetIounStone(hostId, stoneId);
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(1);
		});

		it("is idempotent across repeated reconciliation", () => {
			state.setIounStone(hostId, stoneId);
			state.reconcileIounHosts();
			state.reconcileIounHosts();
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(2);
		});

		it("leaves zero and absent props alone", () => {
			state.setIounStone(hostId, stoneId);
			const stone = state.getItems().find(i => i.id === stoneId);
			expect(stone.bonusWeapon == null || stone.bonusWeapon === 0).toBe(true);
		});

		it("does not double a loose fragment", () => {
			const fragId = addStone("Ioun Fragment (Protection)", {bonusAc: 1});
			expect(state.setIounStone(hostId, fragId).success).toBe(true);
			expect(state.getItems().find(i => i.id === fragId).bonusAc).toBe(1);
		});

		it("reports which seated stones are doubled and which are excluded", () => {
			setSeats(hostId, 2);
			const fragId = addStone("Ioun Fragment (Protection)", {bonusAc: 1});
			state.setIounStone(hostId, stoneId);
			state.setIounStone(hostId, fragId);
			const status = state.getIounMatrixStatus(hostId);
			expect(status.isMatrix).toBe(true);
			expect(status.doubled.map(r => r.id)).toEqual([stoneId]);
			expect(status.excluded.map(r => r.id)).toEqual([fragId]);
			expect(status.props).toContain("bonusAc");
		});

		it("leaves exactly one capture when a stone moves matrix to matrix", () => {
			state.addItem({name: "Sand Halo", type: "W", weight: 1, value: 0, quantity: 1});
			const host2Id = state.getItems().at(-1).id;
			state.setItemMaterial(host2Id, {name: "Ioun Sand", source: "TGTT"});

			state.setIounStone(hostId, stoneId);
			expect(state.setIounStone(host2Id, stoneId).success).toBe(true);

			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(2);
			state.unsetIounStone(host2Id, stoneId);
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(1);
		});

		it("un-doubles when the Ioun Sand material is removed", () => {
			state.setIounStone(hostId, stoneId);
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(2);
			state.clearItemMaterial(hostId);
			expect(state.getItems().find(i => i.id === stoneId).bonusAc).toBe(1);
		});

		it("gives the Ioun Crystal free effect to a fragment but not an intact stone", () => {
			const mk = name => {
				state.addItem({name, type: "W", weight: 0, value: 0, quantity: 1, bonusAc: 1});
				const id = state.getItems().at(-1).id;
				state.setItemMaterial(id, {name: "Ioun Crystal", source: "TGTT"});
				return state.getItems().find(i => i.id === id);
			};
			const frag = CharacterSheetMaterials.countMagicalEffects(mk("Ioun Fragment of Warding"), {material: IOUN_CRYSTAL});
			const whole = CharacterSheetMaterials.countMagicalEffects(mk("Ioun Stone of Warding"), {material: IOUN_CRYSTAL});
			expect(whole.total).toBe(1);
			expect(frag.total).toBe(0);
			expect(frag.breakdown.some(b => /free effect/.test(b.label))).toBe(true);
			expect(whole.breakdown.some(b => /free effect/.test(b.label))).toBe(false);
		});
	});

	// ==========================================================================
	// Degradation (P4)
	// ==========================================================================
	describe("material degradation", () => {
		const FLINT = {
			name: "Stone and Flint",
			source: "TGTT",
			materialCategory: "stone",
			density: 2.6,
			damage: -1,
			protection: 0,
			critical: 0,
			penetration: 0,
			magicCapacity: 1,
			rarity: "common",
			price: {gp: 0, unit: "lb", display: "\u2014"},
			appliesTo: ["weapon"],
			effects: [],
			degradation: {
				trigger: {on: "attackRoll", natural: [1]},
				effect: {type: "damageStepDelta", value: -1},
				stacking: true,
				destroys: false,
				repair: {method: "manual", tool: null},
				note: "Its striking edge chips.",
			},
		};
		const GLASS = {
			name: "Ordinary Glass",
			source: "TGTT",
			materialCategory: "glass",
			density: 2.5,
			damage: 0,
			protection: "na",
			critical: 1,
			penetration: 0,
			magicCapacity: 1,
			rarity: "common",
			price: {gp: 1, unit: "lb", display: "1 gp per lb."},
			appliesTo: ["weapon"],
			effects: [],
			degradation: {
				trigger: {on: "attackRoll", natural: [1], alsoOnCriticalHit: true},
				effect: {type: "destroy"},
				stacking: false,
				destroys: true,
				repair: null,
				note: "A glass weapon shatters.",
			},
		};
		const RIME = {
			name: "Rimeglass",
			source: "TGTT",
			materialCategory: "glass",
			density: 0.9,
			damage: 0,
			protection: 16,
			critical: 1,
			penetration: 0,
			magicCapacity: 4,
			rarity: "very rare",
			price: {gp: 400, unit: "lb", display: "400 gp per lb."},
			appliesTo: ["weapon", "armor"],
			effects: [],
			degradation: {
				trigger: {on: "damageTaken", damageType: "fire"},
				effect: {type: "zeroAxes", axes: ["protection", "critical"]},
				stacking: false,
				destroys: false,
				repair: {method: "shortRest", tool: "smith's or glassblower's tools"},
				note: "Fire damage reduces its Protection and Critical to 0.",
			},
		};
		const OBSIDIAN = {
			...FLINT,
			name: "Obsidian",
			degradation: {
				...FLINT.degradation,
				effect: {type: "damageStepDelta", value: -2},
				repair: {method: "shortRest", tool: "appropriate tools"},
			},
		};

		let flintId;
		// The shared `MATERIALS` fixture already carries a degradation-free Ordinary Glass,
		// and `resolveMaterial` takes the FIRST name match — so it has to be displaced, not
		// merely appended to.
		const CATALOG = [...MATERIALS.filter(m => m.name !== "Ordinary Glass"), FLINT, GLASS, RIME, OBSIDIAN];

		beforeEach(() => {
			state.setItemMaterialCatalog(CATALOG);
			state.addItem({name: "Flint Axe", type: "M", weight: 4, value: 100, quantity: 1, dmg1: "1d8", dmg1Type: "S"});
			flintId = state.getItems().at(-1).id;
			state.setItemMaterial(flintId, {name: "Stone and Flint", source: "TGTT"});
		});

		it("recognises only the triggers a material declares", () => {
			const nat1 = {type: "attackRoll", natural: 1, isCrit: false};
			const crit = {type: "attackRoll", natural: 19, isCrit: true};
			const fire = {type: "damageTaken", damageType: "fire"};

			expect(CharacterSheetMaterials.isDegradationTriggered(FLINT, nat1)).toBe(true);
			expect(CharacterSheetMaterials.isDegradationTriggered(FLINT, crit)).toBe(false);
			expect(CharacterSheetMaterials.isDegradationTriggered(GLASS, nat1)).toBe(true);
			expect(CharacterSheetMaterials.isDegradationTriggered(GLASS, crit)).toBe(true);
			expect(CharacterSheetMaterials.isDegradationTriggered(RIME, fire)).toBe(true);
			expect(CharacterSheetMaterials.isDegradationTriggered(RIME, {type: "damageTaken", damageType: "cold"})).toBe(false);
			expect(CharacterSheetMaterials.isDegradationTriggered(RIME, nat1)).toBe(false);
		});

		it("never triggers on a material that declares no degradation", () => {
			const steel = MATERIALS.find(m => m.name === "Steel");
			expect(CharacterSheetMaterials.isDegradationTriggered(steel, {type: "attackRoll", natural: 1})).toBe(false);
			expect(CharacterSheetMaterials.getDegradationSpec(steel)).toBeNull();
		});

		it("reports an intact item as not degraded", () => {
			expect(state.getItemDegradation(flintId)).toBeNull();
			// Stone and Flint is Damage -1 on its own, so the base projection still applies.
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d6");
		});

		it("steps the damage die down further with each stacking event", () => {
			state.degradeItemMaterial(flintId);
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d4");
			state.degradeItemMaterial(flintId);
			// Already at the bottom rung; the ladder clamps rather than going negative.
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d4");
			expect(state.getItemDegradation(flintId).stacks).toBe(2);
			expect(state.getItemDegradation(flintId).damageStepDelta).toBe(-2);
		});

		it("applies a non-stacking effect only once", () => {
			state.addItem({name: "Rime Plate", type: "HA", weight: 40, value: 100, quantity: 1, ac: 14});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Rimeglass", source: "TGTT"});
			expect(state.getItems().find(i => i.id === id).ac).toBe(16);

			state.degradeItemMaterial(id);
			state.degradeItemMaterial(id);
			const status = state.getItemDegradation(id);
			expect(status.stacks).toBe(2);
			expect(status.applied).toBe(1);
			expect(status.zeroedAxes).toEqual(["protection", "critical"]);
			// Protection zeroed => the material no longer overrides the base AC.
			expect(state.getItems().find(i => i.id === id).ac).toBe(14);
		});

		it("zeroes the critical axis without ever raising the threshold above 20", () => {
			state.addItem({name: "Rime Dagger", type: "M", weight: 1, value: 100, quantity: 1, dmg1: "1d4"});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Rimeglass", source: "TGTT"});
			expect(state.getItems().find(i => i.id === id).critThreshold).toBe(19);
			state.degradeItemMaterial(id);
			expect(state.getItems().find(i => i.id === id).critThreshold).toBeUndefined();
		});

		it("marks a destroying material as destroyed", () => {
			state.addItem({name: "Glass Shiv", type: "M", weight: 1, value: 100, quantity: 1, dmg1: "1d4"});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Ordinary Glass", source: "TGTT"});
			const status = state.degradeItemMaterial(id);
			expect(status.isDestroyed).toBe(true);
			expect(CharacterSheetMaterials.getDegradationSummary(state.getItemRaw(id))).toBe("Destroyed");
		});

		it("restores the item on repair", () => {
			state.degradeItemMaterial(flintId);
			expect(state.repairItemMaterial(flintId)).toBe(true);
			expect(state.getItemDegradation(flintId)).toBeNull();
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d6");
			// Nothing to repair the second time.
			expect(state.repairItemMaterial(flintId)).toBe(false);
		});

		it("narrows the attack-roll candidates to the weapon actually swung", () => {
			state.addItem({name: "Obsidian Blade", type: "M", weight: 2, value: 100, quantity: 1, dmg1: "1d6"});
			const obsId = state.getItems().at(-1).id;
			state.setItemMaterial(obsId, {name: "Obsidian", source: "TGTT"});

			const trigger = {type: "attackRoll", natural: 1, isCrit: false};
			expect(state.getDegradationCandidates(trigger).map(c => c.id).sort()).toEqual([flintId, obsId].sort());
			expect(state.getDegradationCandidates(trigger, {itemId: obsId}).map(c => c.id)).toEqual([obsId]);
			expect(state.getDegradationCandidates({type: "attackRoll", natural: 7}, {itemId: obsId})).toEqual([]);
		});

		it("stops offering a destroyed item as a candidate", () => {
			state.addItem({name: "Glass Edge", type: "M", weight: 1, value: 100, quantity: 1, dmg1: "1d4"});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Ordinary Glass", source: "TGTT"});
			const trigger = {type: "attackRoll", natural: 1, isCrit: false};
			expect(state.getDegradationCandidates(trigger, {itemId: id})).toHaveLength(1);
			state.degradeItemMaterial(id);
			expect(state.getDegradationCandidates(trigger, {itemId: id})).toHaveLength(0);
		});

		it("lists only short-rest repairs, and never a destroyed item", () => {
			state.addItem({name: "Obsidian Knife", type: "M", weight: 1, value: 100, quantity: 1, dmg1: "1d6"});
			const obsId = state.getItems().at(-1).id;
			state.setItemMaterial(obsId, {name: "Obsidian", source: "TGTT"});
			state.addItem({name: "Glass Spike", type: "M", weight: 1, value: 100, quantity: 1, dmg1: "1d4"});
			const glassId = state.getItems().at(-1).id;
			state.setItemMaterial(glassId, {name: "Ordinary Glass", source: "TGTT"});

			state.degradeItemMaterial(flintId);
			state.degradeItemMaterial(obsId);
			state.degradeItemMaterial(glassId);

			const repairable = state.getShortRestRepairableItems();
			expect(repairable.map(r => r.id)).toEqual([obsId]);
			expect(repairable[0].tool).toBe("appropriate tools");
		});

		it("honours the materials_degradation sub-toggle", () => {
			state.degradeItemMaterial(flintId);
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d4");

			state.setSetting("materials_degradation", false);
			expect(state.getItemDegradation(flintId)).toBeNull();
			expect(state.getDegradationCandidates({type: "attackRoll", natural: 1})).toEqual([]);
			expect(state.getShortRestRepairableItems()).toEqual([]);
			// The stacks survive; only their effect is suspended.
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d6");

			state.setSetting("materials_degradation", true);
			expect(state.getItems().find(i => i.id === flintId).dmg1).toBe("1d4");
		});

		it("round-trips degradation through save/load", () => {
			state.degradeItemMaterial(flintId);
			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.setItemMaterialCatalog(CATALOG);
			restored.loadFromJson(JSON.parse(JSON.stringify(json)));
			const row = restored.getItems().find(i => i.name === "Flint Axe");
			expect(restored.getItemDegradation(row.id).stacks).toBe(1);
			expect(row.dmg1).toBe("1d4");
		});

		it("summarises each degradation shape for the badge", () => {
			state.degradeItemMaterial(flintId);
			expect(CharacterSheetMaterials.getDegradationSummary(state.getItemRaw(flintId))).toBe("Damage -1 step");
			state.degradeItemMaterial(flintId);
			expect(CharacterSheetMaterials.getDegradationSummary(state.getItemRaw(flintId))).toBe("Damage -2 steps");

			state.addItem({name: "Rime Shield", type: "S", weight: 6, value: 100, quantity: 1});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Rimeglass", source: "TGTT"});
			state.degradeItemMaterial(id);
			expect(CharacterSheetMaterials.getDegradationSummary(state.getItemRaw(id)))
				.toBe("Protection and Critical reduced to 0");
		});

		it("gives the degradation badge an accessible name, not just a tooltip", () => {
			// The badge is "⚠ Damage -1 step" on screen. Everything that makes that
			// actionable — what happened, and how to undo it — lived only in `title`.
			state.degradeItemMaterial(flintId);
			const mod = new CharacterSheetMaterials({getState: () => state, renderCharacter: () => {}});
			const html = mod.getDegradationBadgeHtml(flintId);
			expect(html).toContain(`aria-hidden="true"`);
			expect(html).toContain(`<span class="sr-only">Damaged:</span>`);
			expect(html).toContain("Repaired manually.");
		});

		it("names a destroyed item as destroyed", () => {
			state.addItem({name: "Glass Dagger", type: "M", weight: 1, value: 200, quantity: 1});
			const id = state.getItems().at(-1).id;
			state.setItemMaterial(id, {name: "Ordinary Glass", source: "TGTT"});
			state.degradeItemMaterial(id);
			const mod = new CharacterSheetMaterials({getState: () => state, renderCharacter: () => {}});
			expect(mod.getDegradationBadgeHtml(id)).toContain(`<span class="sr-only">Destroyed:</span>`);
		});
	});
});
