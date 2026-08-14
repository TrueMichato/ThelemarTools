import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Item Builder character-sheet compatibility", () => {
	test("adds and round-trips an emitted item with composition provenance", () => {
		const catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S"}],
			materials: [{name: "Starsteel", source: "TGTT", appliesTo: ["weapon"], damage: 1}],
			upgrades: [
				{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Gain +1 to attack rolls."]},
				{name: "Journey", source: "TGTT", upgradeType: ["GS:R"]},
			],
		};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), catalogs.items[0], {source: "HB"});
		draft.item.name = "Star Road";
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};
		const item = ItemBuilderCore.serialize(draft, catalogs);
		const preview = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(item.dmg1).toBe("1d8");
		expect(item).not.toHaveProperty("bonusWeaponAttack");
		expect(item).not.toHaveProperty("effects");
		expect(preview).toEqual(expect.objectContaining({dmg1: "1d10", bonusWeaponAttack: 1}));
		expect(preview.effects).toContainEqual(expect.objectContaining({type: "speedBonus", value: 10}));

		const state = new CharacterSheetState();
		state.setItemMaterialCatalog(catalogs.materials);
		state.addItem(item, 1, true, false);
		const added = state.getItems()[0];
		expect(added).toEqual(expect.objectContaining({
			name: "Star Road",
			type: "M|PHB",
			dmg1: "1d10",
		}));
		expect(state.getEffectiveItemBonuses(added.id).bonusWeaponAttack).toBe(1);
		expect(state.getGemstoneSpeedBonus()).toBe(10);
		expect(added.appliedUpgrades[0].name).toBe("Balanced");
		expect(added.socketedGemstones[0].name).toBe("Journey");

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		restored.setItemMaterialCatalog(catalogs.materials);
		const roundTripped = restored.getItems()[0];
		expect(roundTripped.dmg1).toBe("1d10");
		expect(restored.getEffectiveItemBonuses(roundTripped.id).bonusWeaponAttack).toBe(1);
		expect(restored.getGemstoneSpeedBonus()).toBe(10);
		expect(roundTripped.material).toEqual({name: "Starsteel", source: "TGTT"});
		expect(roundTripped.appliedUpgrades[0]).toEqual(expect.objectContaining({name: "Balanced", source: "TCAH"}));
		expect(roundTripped.socketedGemstones[0]).toEqual(expect.objectContaining({name: "Journey", source: "TGTT"}));
		expect(roundTripped.effects || []).not.toContainEqual(expect.objectContaining({type: "speedBonus"}));
	});
});
