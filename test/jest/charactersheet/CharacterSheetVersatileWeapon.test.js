import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const LONGSWORD = {
	id: "longsword-1",
	name: "Longsword",
	source: "PHB",
	type: "M",
	weapon: true,
	dmg1: "1d8",
	dmg2: "1d10",
	dmgType: "S",
	property: ["V"],
};

describe("canonical versatile weapon damage die", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("defaults old/unset hand state to the one-handed die", () => {
		expect(state.getWeaponDamageDie(LONGSWORD)).toBe("1d8");
		expect(state.getWeaponDamageDie({...LONGSWORD, handsUsed: 0})).toBe("1d8");
		expect(state.getWeaponDamageDie({...LONGSWORD, handsUsed: "bad"})).toBe("1d8");
	});

	it("uses dmg2 for two or more hands and ignores handsUsed on non-versatile weapons", () => {
		expect(state.getWeaponDamageDie({...LONGSWORD, handsUsed: 2})).toBe("1d10");
		expect(state.getWeaponDamageDie({...LONGSWORD, handsUsed: 3})).toBe("1d10");
		expect(state.getWeaponDamageDie({dmg1: "1d6", handsUsed: 2})).toBe("1d6");
	});

	it("persists handsUsed on the backing item rather than a flattened copy", () => {
		state.addItem(LONGSWORD, 1, true);
		const flattened = state.getItems()[0];
		flattened.handsUsed = 2;
		expect(state.getItems()[0].handsUsed).toBeUndefined();

		expect(state.setItemHandsUsed(LONGSWORD.id, 2)).toBe(true);
		expect(state.getInventory()[0].item.handsUsed).toBe(2);
		expect(state.getItems()[0].handsUsed).toBe(2);
	});

	it("survives a save-load-save roundtrip and old saves still resolve one-handed", () => {
		state.addItem(LONGSWORD, 1, true);
		state.setItemHandsUsed(LONGSWORD.id, 2);

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		const savedAgain = reloaded.toJson();
		expect(savedAgain.inventory[0].item.handsUsed).toBe(2);
		expect(reloaded.getWeaponDamageDie(reloaded.getItems()[0])).toBe("1d10");

		delete savedAgain.inventory[0].item.handsUsed;
		const legacyReload = new CharacterSheetState();
		legacyReload.loadFromJson(savedAgain);
		expect(legacyReload.getWeaponDamageDie(legacyReload.getItems()[0])).toBe("1d8");
	});

	it("routes state weapon conversion through the selected die", () => {
		state.setAbilityBase("str", 16);
		const attack = state.updateAttackFromWeapon({...LONGSWORD, handsUsed: 2});
		expect(attack.damage).toMatch(/^1d10\+/);
	});
});

describe("inventory normalization", () => {
	it("retains both versatile dice and initializes one-handed state", () => {
		let added = null;
		const priorDmgTypeToFull = globalThis.Parser.dmgTypeToFull;
		globalThis.Parser.dmgTypeToFull = type => type;
		const inventory = Object.create(CharacterSheetInventory.prototype);
		inventory._state = {
			addItem: item => { added = item; },
			getWeaponDamageDie: item => item.handsUsed >= 2 ? item.dmg2 : item.dmg1,
		};
		inventory._page = {saveCharacter: jest.fn()};
		inventory._getItemType = () => "weapon";
		inventory._parseBonus = () => 0;
		inventory._renderItemList = jest.fn();
		inventory._updateEncumbrance = jest.fn();
		inventory._refreshCombatAmmoViews = jest.fn();

		try {
			inventory._addItem(LONGSWORD);
			expect(added).toMatchObject({dmg1: "1d8", dmg2: "1d10", handsUsed: 1});
		} finally {
			globalThis.Parser.dmgTypeToFull = priorDmgTypeToFull;
		}
	});
});

describe("combat versatile weapon integration", () => {
	const makeCombat = (stateOverrides = {}) => {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {
			getWeaponDamageDie: item => item.handsUsed >= 2 ? item.dmg2 : item.dmg1,
			isMonkWeapon: () => false,
			getFeatureCalculations: () => ({}),
			getEffectiveItemBonuses: () => ({}),
			...stateOverrides,
		};
		return combat;
	};

	it("keeps monk Martial Arts and Superior upgrade increases on top of the selected base die", () => {
		const previousUpgrades = globalThis.CharacterSheetUpgrades;
		globalThis.CharacterSheetUpgrades = {
			increaseDamageDie: (die, steps) => `${die}+upgrade${steps}`,
		};
		try {
			const combat = makeCombat({
				isMonkWeapon: () => true,
				getFeatureCalculations: () => ({martialArtsDie: "1d12"}),
				getEffectiveItemBonuses: () => ({damageDieIncrease: 1}),
			});
			expect(combat._getEffectiveWeaponDamageDie({...LONGSWORD, handsUsed: 2})).toBe("1d12+upgrade1");
		} finally {
			globalThis.CharacterSheetUpgrades = previousUpgrades;
		}
	});

	it("rolls the selected two-handed die even when the cached attack still says one-handed", async () => {
		const sourceItem = {...LONGSWORD, handsUsed: 2};
		const attack = {
			id: "auto_longsword-1",
			name: "Longsword",
			damage: "1d8",
			damageType: "slashing",
			abilityMod: "str",
			isMelee: true,
			isAutoGenerated: true,
			sourceItem,
		};
		const combat = makeCombat({
			getAttacks: () => [attack],
			getTemporaryAttacks: () => [],
			getActiveStateAttacks: () => [],
			getWeaponAbilityMod: () => 3,
			getNamedModifiersByType: () => [],
			getItemWeaponScopedDamageContributions: () => [],
			getExtraDamageFromStates: () => [],
		});
		combat._page = {showDiceResult: jest.fn(), pAnimateDamageDice: jest.fn()};
		combat._parseDamage = dice => ({total: dice === "1d10" ? 10 : 8, sides: 10, rolls: [10]});
		combat._promptUseCombatMethod = async () => null;
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._getSelectedAmmoForWeapon = () => null;

		await combat._rollDamage(attack.id);
		expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			total: 13,
			subtitle: expect.stringContaining("1d10"),
		}));
	});

	it("renders an accessible toggle only for versatile source-item attacks", () => {
		const combat = makeCombat();
		const html = combat._renderHandsUsedToggle({
			name: "Longsword",
			sourceItem: {...LONGSWORD, handsUsed: 2},
		});
		expect(html).toContain("role=\"group\"");
		expect(html).toContain("aria-label=\"Longsword: hands used\"");
		expect(html).toContain("data-hands-used=\"2\"");
		expect(html).toContain("aria-pressed=\"true\"");
		expect(combat._renderHandsUsedToggle({sourceItem: {id: "club", name: "Club", dmg1: "1d4"}})).toBe("");
	});
});
