import "./setup.js";
import {readFileSync} from "node:fs";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

let CharacterSheetState;
let CharacterSheetInventory;
let jesterMask;

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetInventory = (await import("../../../js/charactersheet/charactersheet-inventory.js")).CharacterSheetInventory;

	const itemData = JSON.parse(readFileSync(new URL("../../../data/items.json", import.meta.url), "utf8"));
	jesterMask = itemData.item.find(item => item.name === "Jester's Mask" && item.source === "BMT");
});

const getHarness = (className) => {
	const state = new CharacterSheetState();
	state.addClass({name: className, source: "PHB", level: 5});
	state.setAbilityBase("cha", 16);
	state.setSpellcastingAbility("cha");

	const page = {
		getState: () => state,
		renderCharacter () {},
		saveCharacter () {},
	};
	const inventory = new CharacterSheetInventory(page);
	inventory._renderItemList = () => {};
	inventory._updateEncumbrance = () => {};
	inventory._refreshCombatAmmoViews = () => {};
	inventory.setItems([jesterMask]);

	return {state, inventory};
};

const addActiveMask = ({state, inventory}) => {
	inventory._addItem(jesterMask);
	const mask = state.getItems().find(item => item.name === "Jester's Mask" && item.source === "BMT");
	state.setItemEquipped(mask.id, true);
	state.setItemAttuned(mask.id, true);
	inventory.syncItemDerivedState();
	return mask.id;
};

describe("Jester's Mask spellcasting bonuses", () => {
	it("uses the canonical BMT page-36 entity and normalizes both authored bonuses to 3", () => {
		expect(jesterMask).toMatchObject({
			name: "Jester's Mask",
			source: "BMT",
			page: 36,
			bonusSpellAttack: "+3",
			bonusSpellSaveDc: "+3",
		});

		const harness = getHarness("Sorcerer");
		const maskId = addActiveMask(harness);
		expect(harness.state.getItemRaw(maskId)).toMatchObject({
			bonusSpellAttack: 3,
			bonusSpellSaveDc: 3,
		});
		expect(harness.state.getItemBonuses()).toMatchObject({
			spellAttack: 3,
			spellSaveDc: 3,
		});
	});

	it.each(["Sorcerer", "Warlock"])(
		"adds exactly +3 to %s class-derived spell attack and save DC",
		(className) => {
			const harness = getHarness(className);
			const before = harness.state.getFeatureCalculations();
			addActiveMask(harness);
			const after = harness.state.getFeatureCalculations();

			expect(after.spellAttackBonus).toBe(before.spellAttackBonus + 3);
			expect(after.spellSaveDc).toBe(before.spellSaveDc + 3);
			expect(after.spellAttackBonus).toBe(harness.state.getSpellAttackBonusForAbility("cha"));
			expect(after.spellSaveDc).toBe(harness.state.getSpellSaveDcForAbility("cha"));
		},
	);

	it("keeps the Bard class card on the same canonical Charisma accessors", () => {
		const harness = getHarness("Bard");
		const before = harness.state.getSpellcastingClassBreakdown()[0];
		addActiveMask(harness);
		const after = harness.state.getSpellcastingClassBreakdown()[0];

		expect(after.attackBonus).toBe(before.attackBonus + 3);
		expect(after.saveDc).toBe(before.saveDc + 3);
		expect(after.attackBonus).toBe(harness.state.getSpellAttackBonusForAbility("cha"));
		expect(after.saveDc).toBe(harness.state.getSpellSaveDcForAbility("cha"));
	});

	it("removes and restores the bonus exactly once when unequipped and re-equipped", () => {
		const harness = getHarness("Sorcerer");
		const baseline = harness.state.getFeatureCalculations();
		const maskId = addActiveMask(harness);

		expect(harness.state.getFeatureCalculations().spellAttackBonus).toBe(baseline.spellAttackBonus + 3);
		expect(harness.state.getFeatureCalculations().spellSaveDc).toBe(baseline.spellSaveDc + 3);

		harness.state.setItemEquipped(maskId, false);
		harness.inventory.syncItemDerivedState();
		expect(harness.state.getFeatureCalculations().spellAttackBonus).toBe(baseline.spellAttackBonus);
		expect(harness.state.getFeatureCalculations().spellSaveDc).toBe(baseline.spellSaveDc);

		harness.state.setItemEquipped(maskId, true);
		harness.inventory.syncItemDerivedState();
		expect(harness.state.getFeatureCalculations().spellAttackBonus).toBe(baseline.spellAttackBonus + 3);
		expect(harness.state.getFeatureCalculations().spellSaveDc).toBe(baseline.spellSaveDc + 3);
	});
});
