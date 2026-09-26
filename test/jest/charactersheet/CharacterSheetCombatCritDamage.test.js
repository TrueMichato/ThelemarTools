import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const savedDocument = globalThis.document;
globalThis.document = {readyState: "complete", querySelector: () => null};
await import("../../../js/charactersheet/charactersheet-mobile.js");
globalThis.document = savedDocument;
const CharacterSheetMobile = globalThis.CharacterSheetMobile;

function makeCombat () {
	const attack = {
		id: "bow",
		name: "Longbow",
		damage: "1d8",
		damageType: "piercing",
		abilityMod: "dex",
		isRanged: true,
		sourceItem: {id: "bow-item", name: "Longbow"},
	};
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = {
		getAttacks: () => [attack],
		getWeaponAbilityMod: () => 3,
		getFeatureCalculations: () => ({}),
		getNamedModifiersByType: () => [],
		getEffectiveItemBonuses: () => ({
			damageRiders: [
				{id: "always", dice: "1d6", damageType: "fire", name: "Flames"},
				{id: "crit-only", dice: "1d4", damageType: "fire", name: "Critical flare", conditions: {criticalOnly: true}},
			],
		}),
	};
	const results = [];
	combat._page = {
		rollDice: jest.fn(() => 4),
		showDiceResult: result => { results.push(result); },
		pAnimateDamageDice: jest.fn(),
	};
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
	combat._promptUseCombatMethod = async () => null;
	combat._stagePostAttackOffers = jest.fn();
	return {combat, results};
}

describe("Combat critical damage intent", () => {
	it("doubles ordinary dice once, includes crit-only dice once, and never manufactures an attack-roll offer", async () => {
		const {combat, results} = makeCombat();

		await combat._rollDamage("bow");
		expect(results[0].total).toBe("7 piercing + 4 fire = 11");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(2);
		expect(results[0].subtitle).not.toContain("Critical flare");

		await combat._rollDamage("bow", true);
		expect(results[1].total).toBe("11 piercing + 8 fire + 4 fire = 23");
		expect(results[1].subtitle).toContain("1d8 (crit)");
		expect(results[1].subtitle).toContain("Critical flare 1d4");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(7);
		expect(combat._stagePostAttackOffers).not.toHaveBeenCalled();
	});

	it("exposes a critical-damage action on the touch attack menu through the same Shift-click gesture", () => {
		const mobile = Object.create(CharacterSheetMobile.prototype);
		const damageButton = {click: jest.fn(), dispatchEvent: jest.fn()};
		const attackButton = {click: jest.fn()};
		const row = {
			matches: selector => selector === ".charsheet__attack-item",
			querySelector: selector => selector === ".charsheet__attack-roll" ? attackButton : selector === ".charsheet__attack-damage" ? damageButton : null,
		};

		const menu = mobile._getContextMenuItems(row);
		menu.find(item => item.label === "Roll Damage").action();
		const criticalAction = menu.find(item => item.label === "Roll Critical Damage");
		expect(criticalAction).toBeDefined();
		const previousMouseEvent = globalThis.MouseEvent;
		globalThis.MouseEvent = class {
			constructor (type, options) { Object.assign(this, {type}, options); }
		};
		try {
			criticalAction.action();
			expect(damageButton.click).toHaveBeenCalledTimes(1);
			expect(damageButton.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
				type: "click",
				bubbles: true,
				shiftKey: true,
			}));
		} finally {
			globalThis.MouseEvent = previousMouseEvent;
		}
	});
});
