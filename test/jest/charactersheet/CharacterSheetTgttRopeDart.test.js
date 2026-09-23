import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));
const ropeDart = brew.item.find(item => item.name === "Rope Dart" && item.source === "TGTT");
const special = "All attacks with this weapon use its thrown property. For attacks at ranges up to 15 feet, you retain your hold on the rope and can pull the blade back as a free action. Following an attack beyond 15 feet, the weapon can be retrieved anywhere along the last 15 feet of its trajectory.";

function equipRopeDart (state) {
	state.addItem(ropeDart, 1, true);
	return state.getItems().find(item => item.name === "Rope Dart");
}

describe("TGTT Rope Dart", () => {
	it("declares the requested catalog stats and exact Special rule", () => {
		expect(ropeDart).toMatchObject({
			name: "Rope Dart",
			source: "TGTT",
			type: "M",
			weaponCategory: "martial",
			rarity: "none",
			dmg1: "1d6",
			dmgType: "P",
			weight: 3,
			value: 2000,
			range: "15/30",
			property: ["F", "2H", "T", "S"],
			mastery: ["Entangling|GrimHollowPG24"],
		});
		expect(brew._meta.sources).toEqual(expect.arrayContaining([expect.objectContaining({json: "TGTT"})]));
		expect(ropeDart.entries).toEqual([{type: "entries", name: "Special", entries: [special]}]);
		expect(CharacterSheetState.getWeaponMasteryEffect(ropeDart)).toBeNull();
	});

	it("projects an adjacent hit as a ranged throw with finesse, not a melee strike", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 14);
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.addWeaponProficiency("martial");
		const item = equipRopeDart(state);
		const attack = state.buildAutoAttackFromWeapon(item);
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;

		expect(item).toMatchObject({type: "M", weapon: true, range: "15/30", property: ["F", "2H", "T", "S"]});
		expect(state.isWeaponAlwaysThrown(item)).toBe(true);
		expect(attack).toMatchObject({
			name: "Rope Dart",
			isMelee: false,
			isRanged: true,
			isThrown: true,
			abilityMod: "finesse",
			range: "15/30",
			damage: "1d6",
			damageType: "piercing",
			mastery: ["Entangling|GrimHollowPG24"],
		});
		expect(state.getAttackClassification(attack)).toMatchObject({kind: "weapon", isMelee: false, isRanged: true, isThrown: true});
		expect(combat._getAttackRollKind(attack)).toEqual({isMelee: false, isRanged: true});
		expect(combat._isStrictRanged(attack)).toBe(true);
		expect(combat._isStrictMelee(attack)).toBe(false);
		expect(state.getAttackReach(attack)).toBeNull();
		expect(state.getWeaponAbilityMod(attack)).toBe(4);
		expect(state.getAttackBonusBreakdown(attack).total).toBe(6);
		expect(state.updateAttackFromWeapon(item)).toMatchObject({abilityMod: "str", attackBonus: 6, range: "15/30"});
		expect(state.getAttackRiderNotes(attack)).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "ropeRetrieval", description: special.slice(special.indexOf("For attacks"))}),
		]));
	});

	it("retains thrown finesse math and its reminder after loading a saved character", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 18);
		const item = equipRopeDart(state);
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.serialize());
		const stored = restored.getItems().find(it => it.id === item.id);
		const attack = restored.buildAutoAttackFromWeapon(stored);

		expect(attack).toMatchObject({isMelee: false, isRanged: true, abilityMod: "finesse", range: "15/30"});
		expect(restored.getWeaponAbilityMod(attack)).toBe(4);
		expect(restored.getAttackRiderNotes(attack).map(it => it.id)).toContain("ropeRetrieval");
	});

	it("uses ranged modifiers on an actual adjacent attack roll, never melee modifiers", async () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 14);
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.addWeaponProficiency("martial");
		state.addNamedModifier({name: "Archery", type: "attack:ranged", value: 2});
		state.addNamedModifier({name: "Melee only", type: "attack:melee", value: 5});
		const attack = state.buildAutoAttackFromWeapon(equipRopeDart(state));
		const combat = Object.create(CharacterSheetCombat.prototype);
		const results = [];
		combat._state = state;
		combat._cachedAttacks = [attack];
		combat._flankingEnabled = false;
		combat._page = {
			rollD20: () => ({roll: 10, mode: "normal"}),
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: result => { results.push(result); return null; },
			getModifierString: n => `${n >= 0 ? "+" : ""}${n}`,
			_offerGuidedStrikePostAttack: () => {},
			saveCharacter: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		await combat._rollAttack(attack.id, null);

		expect(results).toHaveLength(1);
		expect(results[0].modifier).toBe(8);
		expect(results[0].title).toContain("Archery +2");
		expect(results[0].title).not.toContain("Melee only");
		expect(results[0].title).toContain("Rope Dart Attack");
	});

	it("does not turn an ordinary thrown melee weapon into a ranged-only attack", () => {
		const state = new CharacterSheetState();
		const handaxe = {...ropeDart, name: "Handaxe", source: "PHB", property: ["T"], entries: [], range: "20/60"};
		state.addItem(handaxe, 1, true);
		const attack = state.buildAutoAttackFromWeapon(state.getItems()[0]);
		expect(state.isWeaponAlwaysThrown(handaxe)).toBe(false);
		expect(state.getAttackClassification(attack)).toMatchObject({isMelee: true, isRanged: false, isThrown: true});
	});
});
