import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const quarterstaff = JSON.parse(fs.readFileSync("data/items-base.json", "utf8")).baseitem.find(item => item.name === "Quarterstaff" && item.source === "PHB");
const makeFighter = (level = 12) => {
	const state = new State({isDetached: true});
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setAbilityBase("str", 20);
	return state;
};

describe.each(["complete", "compact"])("canonical weapon export (%s)", presentationMode => {
	const exportState = state => Exporter.convertStateToMonster(state, {presentationMode});
	const getLine = (state, name) => exportState(state).action.find(entry => entry.name === name).entries[0];

	it("F26: honors a UI weapon's canonical ranged type without inventing thrown reach", () => {
		const state = makeFighter();
		state.setAbilityBase("dex", 18);
		state.addItem({name: "Crossbow", type: "weapon", typeCode: "R|XPHB", source: "TEST", dmg1: "1d8", dmgType: "P", range: "80/320", equipped: true});
		const item = state.getItems()[0];
		expect(state.buildAutoAttackFromWeapon(item)).toMatchObject({isMelee: false, abilityMod: "dex"});
		const line = getLine(state, "Crossbow");
		expect(line).toContain("{@atk rw}");
		expect(line).not.toContain("reach");
		expect(line).toContain("{@damage 1d8+4}");
	});

	it("F27: a raw weapon property does not grant mastery permission", () => {
		const state = makeFighter();
		state.addItem({name: "Sickle", source: "XPHB", type: "M", dmg1: "1d4", dmgType: "S", mastery: ["Nick|XPHB"], equipped: true});
		expect(getLine(state, "Sickle")).not.toContain("Mastery:");
	});

	it("F27: uses a selected base-weapon mastery for a differently named magic weapon", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "XPHB", level: 5});
		state.setWeaponMasteries(["Longsword|XPHB"]);
		state.addItem({name: "Named Sword", source: "TEST", type: "M", baseItem: "longsword|PHB", dmg1: "1d8", dmgType: "S", equipped: true});
		expect(getLine(state, "Named Sword")).toContain("Mastery: {@itemMastery Sap|XPHB}");
		state.setWeaponMasteries(["Battleaxe|XPHB"]);
		expect(getLine(state, "Named Sword")).not.toContain("Mastery:");
	});

	it("F47: recovers a known quarterstaff's missing canonical dice before a stale display fallback, on attack and item", () => {
		const state = makeFighter();
		expect(quarterstaff).toBeDefined();
		state.setItemCatalog([quarterstaff]);
		state.addItem({name: "Heartstone Aegis", source: "CUSTOM", type: "weapon", typeCode: "M", weapon: true, baseItem: "quarterstaff|PHB", damage: "1d4 bludgeoning", bonusWeapon: 1, rarity: "rare", equipped: true});
		const monster = exportState(state);
		expect(JSON.stringify(monster.action)).toContain("{@damage 1d6+6}");
		const [item] = Exporter.buildCompanionItems(monster, state);
		expect(item).toMatchObject({dmg1: "1d6", dmg2: "1d8"});
	});

	it("F47: preserves genuinely declared custom staff dice rather than replacing them with base facts", () => {
		const state = makeFighter();
		state.setItemCatalog([quarterstaff]);
		state.addItem({name: "Custom Staff", source: "CUSTOM", type: "M", weapon: true, baseItem: "quarterstaff|PHB", dmg1: "2d6", dmg2: "2d8", dmgType: "B", rarity: "rare", equipped: true});
		const monster = exportState(state);
		expect(JSON.stringify(monster.action)).toContain("{@damage 2d6+5}");
		expect(Exporter.buildCompanionItems(monster, state)[0]).toMatchObject({dmg1: "2d6", dmg2: "2d8"});
	});

	it("does not mistake the inventory's base die for a Monk's combat die", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Monk", source: "TGTT", level: 13});
		state.addItem({name: "Sun Staff", source: "TEST", type: "M", weaponCategory: "simple", dmg1: "1d6", dmg2: "1d8", dmgType: "B", equipped: true});
		const item = state.getItems()[0];
		expect(state.getEffectiveWeaponDamage(item.id).dice).toBe("1d6");
		expect(state.buildAutoAttackFromWeapon(item).damage).toBe("1d10");
		expect(getLine(state, "Sun Staff")).toContain("{@damage 1d10");
	});

	it("F40: uses Battle Ready's Intelligence for both an automatic weapon and a saved matching row", () => {
		for (const savedRow of [false, true]) {
			const state = new State({isDetached: true});
			state.addClass({name: "Artificer", source: "TCE", level: 20, subclass: {name: "Battle Smith", shortName: "Battle Smith", source: "TCE"}});
			state.setAbilityBase("str", 8);
			state.setAbilityBase("int", 26);
			state.applyClassFeatureEffects();
			state.addItem({name: "Sun-Eye", source: "TEST", type: "M", weapon: true, weaponCategory: "martial", dmg1: "1d8", dmg2: "1d10", dmgType: "B", bonusWeapon: 2, rarity: "rare", equipped: true});
			if (savedRow) state.addAttack({name: "Sun-Eye", abilityMod: "str", isMelee: true, damage: "1d8", damageType: "bludgeoning", attackBonus: 2, damageBonus: 2});
			const line = getLine(state, "Sun-Eye");
			expect(line).toContain("{@hit +16}");
			expect(line).toContain("{@damage 1d8+10}");
		}
	});

	it("F40: includes Dexterity, proficiency, Archery, and the bow bonus exactly once", () => {
		const state = makeFighter(20);
		state.setAbilityBase("dex", 24);
		state.addNamedModifier({name: "Archery", type: "attack:ranged", value: 2});
		state.addItem({name: "Gnarl", source: "TEST", type: "weapon", typeCode: "R|XPHB", dmg1: "1d8", dmgType: "P", range: "150/600", bonusWeapon: 3, equipped: true});
		const line = getLine(state, "Gnarl");
		expect(line).toContain("{@hit +18}");
		expect(line).toContain("{@damage 1d8+10}");
	});

	it("F41: an occupied shield hand prevents the two-handed versatile die without changing saved preferences", () => {
		const state = makeFighter();
		state.addItem({name: "Sword", source: "TEST", type: "M", dmg1: "1d8", dmg2: "1d10", dmgType: "S", handsUsed: 2, equipped: true});
		state.setShield({name: "Shield", ac: 2, equipped: true});
		const item = state.getItems()[0];
		expect(state.getWeaponDamageDie(item)).toBe("1d8");
		expect(getLine(state, "Sword")).toContain("{@damage 1d8+5}");
		expect(item.handsUsed).toBe(2);
		state.setShield(false);
		expect(getLine(state, "Sword")).toContain("{@damage 1d10+5}");
	});

	it("F28: a hybrid strike uses its own canonical attack and current die, never the first magical weapon", () => {
		const state = new State({isDetached: true});
		state.setName("Hunter");
		state.addClass({name: "Blood Hunter", source: "MM", level: 13, subclass: {name: "Order of the Lycan", shortName: "Lycan", source: "MM"}});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 20);
		state.addItem({name: "Overpowered Sword", source: "TEST", type: "M", dmg1: "1d8", dmgType: "S", bonusWeapon: 7, equipped: true});
		state.addFeature({name: "Hybrid Transformation", source: "MM", className: "Blood Hunter", classSource: "MM", description: "As a bonus action, you transform into a hybrid form for 1 hour. Your unarmed strikes deal 1d6 slashing damage. You can use Dexterity instead of Strength for these attack and damage rolls. You can make one additional unarmed strike as a bonus action."});
		const calc = state.getFeatureCalculations();
		expect(calc.hybridNaturalWeaponDamage).toBe("1d8");
		const monster = exportState(state);
		const strike = [...(monster.action || []), ...(monster.bonus || [])].find(entry => /(?:Unarmed Strike \(Hybrid|Predatory Strike)/.test(entry.name));
		expect(strike).toBeDefined();
		expect(JSON.stringify(strike)).toContain("{@hit +12}");
		expect(JSON.stringify(strike)).toContain("{@damage 1d8+7}");
	});
});
