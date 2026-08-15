import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";
import {
	getGemstoneDescriptor,
	getUpgradeDescriptor,
	resetItemUpgradeCatalog,
	setItemUpgradeCatalog,
} from "../../../js/itembuilder/itembuilder-upgrade-rules.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

describe("source-agnostic Item Builder mechanics", () => {
	const upgrades = [
		{
			name: "Planar Edge",
			source: "OTH",
			upgradeType: ["WU:1"],
			bonusWeaponAttack: 2,
			effects: [{type: "note", note: "Planar Edge"}],
		},
		{
			name: "Wayfarer",
			source: "OTH",
			upgradeType: ["GS:R"],
			effects: [{type: "speedBonus", speed: "walk", value: 5}],
		},
		{
			name: "Balanced",
			source: "OTH",
			upgradeType: ["WU:1"],
			bonusWeaponAttack: 4,
		},
	];

	afterEach(() => {
		resetItemUpgradeCatalog();
	});

	test("qualifies built-in mechanics by source and resolves structured Brew mechanics", () => {
		setItemUpgradeCatalog(upgrades);

		expect(getUpgradeDescriptor({name: "Balanced", source: "TCAH"}).bonusWeaponAttack).toBe(1);
		expect(getUpgradeDescriptor({name: "Balanced", source: "OTH"}).bonusWeaponAttack).toBe(4);
		expect(getUpgradeDescriptor({name: "Balanced", source: "UNKNOWN"})).toBeNull();
		expect(getUpgradeDescriptor({name: "Planar Edge", source: "OTH"}).bonusWeaponAttack).toBe(2);
		expect(getGemstoneDescriptor({name: "Wayfarer", source: "OTH"}).effects).toEqual([
			{type: "speedBonus", speed: "walk", value: 5},
		]);
	});

	test("lets structured data replace, rather than duplicate, a built-in numeric mechanic", () => {
		setItemUpgradeCatalog([{name: "Balanced", source: "TCAH", bonusWeaponAttack: 3}]);

		expect(getUpgradeDescriptor({name: "Balanced", source: "TCAH"}).bonusWeaponAttack).toBe(3);
	});

	test("uses the preview catalog instead of a stale sheet catalog", () => {
		setItemUpgradeCatalog([{
			name: "Wayfarer",
			source: "OTH",
			upgradeType: ["GS:R"],
			effects: [{type: "speedBonus", speed: "walk", value: 10}],
		}]);
		const draft = ItemBuilderCore.applyPreset(
			ItemBuilderCore.createDraft({source: "HB"}),
			{name: "Ring", source: "DMG", type: "RG"},
			{source: "HB"},
		);
		draft.gemstone = {name: "Wayfarer", source: "OTH"};

		const preview = ItemBuilderCore.projectForPreview(draft, {upgrades});

		expect(preview.effects).toContainEqual({type: "speedBonus", speed: "walk", value: 5});
		expect(preview.effects).not.toContainEqual({type: "speedBonus", speed: "walk", value: 10});
	});

	test("keeps non-TGTT references lean and applies material, upgrade, and gem mechanics once after reload", () => {
		const catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S"}],
			materials: [{name: "Voidglass", source: "OTH", appliesTo: ["weapon"], damage: 1}],
			upgrades,
		};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), catalogs.items[0], {source: "HB"});
		draft.item.name = "Elsewhere Blade";
		draft.material = {name: "Voidglass", source: "OTH"};
		draft.upgrades = [{name: "Planar Edge", source: "OTH"}];
		draft.gemstone = {name: "Wayfarer", source: "OTH"};

		const firstPreview = ItemBuilderCore.projectForPreview(draft, catalogs);
		const secondPreview = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(firstPreview).toEqual(secondPreview);
		expect(firstPreview).toEqual(expect.objectContaining({dmg1: "1d10", bonusWeaponAttack: 2}));
		expect(firstPreview.effects).toEqual(expect.arrayContaining([
			{type: "note", note: "Planar Edge"},
			{type: "speedBonus", speed: "walk", value: 5},
		]));

		const canonical = ItemBuilderCore.serialize(draft, catalogs);
		expect(canonical).toEqual(expect.objectContaining({
			material: {name: "Voidglass", source: "OTH"},
			appliedUpgrades: [{name: "Planar Edge", source: "OTH"}],
			socketedGemstones: [{name: "Wayfarer", source: "OTH"}],
		}));
		expect(canonical.dmg1).toBe("1d8");
		expect(canonical).not.toHaveProperty("bonusWeaponAttack");
		expect(canonical).not.toHaveProperty("effects");

		CharacterSheetUpgrades.setUpgradeCatalog(catalogs.upgrades);
		const state = new CharacterSheetState();
		state.setItemMaterialCatalog(catalogs.materials);
		state.addItem(canonical, 1, true, false);
		const added = state.getItems()[0];
		expect(added.dmg1).toBe("1d10");
		expect(state.getEffectiveItemBonuses(added.id).bonusWeaponAttack).toBe(2);
		expect(state.getGemstoneSpeedBonus()).toBe(5);

		const saved = state.toJson();
		CharacterSheetUpgrades.resetUpgradeCatalog();
		CharacterSheetUpgrades.setUpgradeCatalog(catalogs.upgrades);
		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		restored.setItemMaterialCatalog(catalogs.materials);
		const roundTripped = restored.getItems()[0];
		expect(roundTripped.dmg1).toBe("1d10");
		expect(restored.getEffectiveItemBonuses(roundTripped.id).bonusWeaponAttack).toBe(2);
		expect(restored.getGemstoneSpeedBonus()).toBe(5);
		expect(roundTripped.effects || []).not.toEqual(expect.arrayContaining([
			expect.objectContaining({type: "speedBonus"}),
		]));
	});
});
