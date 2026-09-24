import "./setup.js";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	body: {classList: {add () {}, remove () {}}},
};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};

let CharacterSheetState;
let CharacterSheetPage;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetPage = (await import("../../../js/charactersheet/charactersheet.js")).CharacterSheetPage;
});

const VARIANTS = [
	{classSource: "XPHB", subclass: "Bladesinger", source: "FRHoF", level: 3, bladework: true},
	{classSource: "TGTT", subclass: "Bladesinger", source: "TGTT-2024", level: 3, bladework: true},
	{classSource: "PHB", subclass: "Bladesinging", source: "TCE", level: 2, bladework: false},
	{classSource: "TGTT", subclass: "Bladesinging", source: "TGTT-2014", level: 2, bladework: false},
];

function makeCharacter ({classSource, subclass, source, level}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Wizard",
		source: classSource,
		level,
		subclass: {name: subclass, shortName: subclass, source},
	});
	state.setAbilityBase("str", 8);
	state.setAbilityBase("dex", 16);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 18);
	state.addWeaponProficiency("Longsword");
	return state;
}

function getSword (state) {
	return state.buildAutoAttackFromWeapon({
		id: "sword-1",
		name: "Longsword",
		source: "PHB",
		type: "M",
		weapon: true,
		weaponCategory: "martial",
		dmg1: "1d8",
		dmgType: "S",
		property: [],
	});
}

describe.each(VARIANTS)("$source Bladesong lifecycle", variant => {
	test("grants the authored martial-melee proficiency from the stored Training feature", () => {
		const state = makeCharacter(variant);
		state._data.weaponProficiencies = [];
		state.addFeature({
			name: "Training in War and Song",
			source: variant.source,
			className: "Wizard",
			level: variant.level,
			description: "You gain proficiency with Melee Martial weapons that don't have the Two-Handed or Heavy property.",
		});
		state.applyClassFeatureEffects();
		expect(state._isWeaponProficient(getSword(state).sourceItem)).toBe(variant.bladework);
	});

	test("projects the four authored benefits only while active, preserving the same weapon attack and save/load", () => {
		const state = makeCharacter(variant);
		const sword = getSword(state);
		const baseConcentration = state.getConcentrationSaveBonus();
		const baseAttack = state.getAttackBonusBreakdown(sword);
		expect(state.getAc()).toBe(13);
		expect(state.getWalkSpeed()).toBe(30);
		expect(state.hasAdvantageFromStates("skill:acrobatics")).toBe(false);
		expect(baseAttack.effectiveAbility).toBe(-1);

		state.activateState("bladesong");
		expect(state.getAc()).toBe(17);
		expect(state.getWalkSpeed()).toBe(40);
		expect(state.hasAdvantageFromStates("skill:acrobatics")).toBe(true);
		expect(state.getConcentrationSaveBonus()).toBe(baseConcentration + 4);
		const activeAttack = state.getAttackBonusBreakdown(sword);
		expect(activeAttack.effectiveAbility).toBe(variant.bladework ? 4 : -1);
		expect(activeAttack.abilitySubstitution?.name || null).toBe(variant.bladework ? "Bladesong" : null);
		expect(state.getWeaponAbilityMod(sword)).toBe(activeAttack.effectiveAbility);
		expect(sword.id).toBe("auto_sword-1");

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getAc()).toBe(17);
		expect(loaded.getWalkSpeed()).toBe(40);
		expect(loaded.getAttackBonusBreakdown(sword).effectiveAbility).toBe(activeAttack.effectiveAbility);
		loaded.deactivateState("bladesong");
		expect(loaded.getAc()).toBe(13);
		expect(loaded.getWalkSpeed()).toBe(30);
		expect(loaded.getConcentrationSaveBonus()).toBe(baseConcentration);
		expect(loaded.getAttackBonusBreakdown(sword).effectiveAbility).toBe(baseAttack.effectiveAbility);
	});

	test("rejects invalid armor or shield before activation; ends on donning incompatible equipment", () => {
		const state = makeCharacter(variant);
		state.setArmor({name: "Leather", type: "light", ac: 11});
		expect(!!state.activateState("bladesong")).toBe(!variant.bladework);
		if (!variant.bladework) {
			expect(state.getWalkSpeed()).toBe(40);
			state.setArmor({name: "Scale Mail", type: "medium", ac: 14});
		} else {
			state.setArmor(null);
			state.activateState("bladesong");
			state.setArmor({name: "Leather", type: "light", ac: 11});
		}
		expect(state.isStateTypeActive("bladesong")).toBe(false);
		expect(state.getWalkSpeed()).toBe(30);

		state.setArmor(null);
		state.activateState("bladesong");
		state.setShield({name: "Shield", ac: 2});
		expect(state.isStateTypeActive("bladesong")).toBe(false);
		expect(state.getWalkSpeed()).toBe(30);
		expect(state.activateState("bladesong")).toBeNull();
		state.setShield(false);
		state.setArmor({name: "Chain Mail", type: "heavy", ac: 16});
		expect(state.activateState("bladesong")).toBeNull();
	});

	test("checks all equipped body armor, not just the first AC snapshot", () => {
		const state = makeCharacter(variant);
		state.addItem({id: "leather", name: "Leather", source: "PHB", type: "LA", ac: 11}, 1, true);
		if (variant.bladework) {
			expect(state.activateState("bladesong")).toBeNull();
			return;
		}
		state.activateState("bladesong");
		state.addItem({id: "scale", name: "Scale Mail", source: "PHB", type: "MA", ac: 14}, 1, true);
		expect(state.isStateTypeActive("bladesong")).toBe(false);
		expect(state.getWalkSpeed()).toBe(30);
		expect(state.activateState("bladesong")).toBeNull();
	});
});

test("2024 Bladework excludes nonproficient weapons, spells, and unarmed strikes", () => {
	const state = makeCharacter(VARIANTS[0]);
	state.activateState("bladesong");
	const sword = getSword(state);
	const nonproficient = {...sword,
		id: "auto-greatsword",
		name: "Greatsword",
		sourceItem: {...sword.sourceItem, name: "Greatsword", property: ["2H"]}};
	expect(state.getAttackBonusBreakdown(sword).effectiveAbility).toBe(4);
	expect(state.getAttackBonusBreakdown(nonproficient).effectiveAbility).toBe(-1);
	expect(state.getBladesongWeaponBonus(state.getUnarmedStrike())).toBe(0);
	expect(state.getBladesongWeaponBonus({...sword, isSpell: true})).toBe(0);
});

test("a two-handed weapon attack ends Bladesong before computing its attack and damage", () => {
	const state = makeCharacter(VARIANTS[0]);
	state.activateState("bladesong");
	const sword = getSword(state);
	const twoHanded = {...sword, id: "auto-two-handed", sourceItem: {...sword.sourceItem, property: ["2H"]}, properties: ["2H"]};
	expect(state.getAttackBonusBreakdown(sword).effectiveAbility).toBe(4);
	expect(state.endBladesongForWeaponAttack(twoHanded)).toBe(true);
	expect(state.getAttackBonusBreakdown(twoHanded).effectiveAbility).toBe(-1);
	expect(state.getWeaponAbilityMod(twoHanded)).toBe(-1);
	expect(state.getAc()).toBe(13);
	expect(state.getWalkSpeed()).toBe(30);
	expect(state.endBladesongForWeaponAttack(sword)).toBe(false);
});

test("a versatile weapon ends Bladesong only when the selected attack uses two hands", () => {
	const state = makeCharacter(VARIANTS[1]);
	state.addItem({id: "staff",
		name: "Quarterstaff",
		source: "PHB",
		type: "M",
		weaponCategory: "simple",
		property: ["V"],
		dmg1: "1d6",
		dmg2: "1d8"}, 1, true);
	state.addWeaponProficiency("simple");
	state.activateState("bladesong");
	const getAttack = () => state.buildAutoAttackFromWeapon(state.getItems().find(item => item.id === "staff"));
	const cachedAttack = getAttack();
	expect(cachedAttack.id).toBe("auto_staff");
	expect(state.endBladesongForWeaponAttack(cachedAttack)).toBe(false);
	expect(state.getAttackBonusBreakdown(cachedAttack).effectiveAbility).toBe(4);
	state.setItemHandsUsed("staff", 2);
	const attack = getAttack();
	expect(attack.damage).toBe("1d8");
	expect(attack.id).toBe("auto_staff");
	expect(state.endBladesongForWeaponAttack(cachedAttack)).toBe(true);
	expect(state.getAttackBonusBreakdown(attack).effectiveAbility).toBe(-1);
});

test("a legacy active save with incompatible armor cannot restore Bladesong bonuses", () => {
	const state = makeCharacter(VARIANTS[0]);
	state.activateState("bladesong");
	const saved = state.toJson();
	saved.ac.armor = {name: "Leather", type: "light", ac: 11};
	const loaded = new CharacterSheetState();
	loaded.loadFromJson(saved);
	expect(loaded.isStateTypeActive("bladesong")).toBe(false);
	expect(loaded.getWalkSpeed()).toBe(30);
	expect(loaded.getAc()).toBe(14);
});

test("AC uses the authored minimum +1 even with negative INT", () => {
	const state = makeCharacter(VARIANTS[0]);
	state.setAbilityBase("int", 8);
	state.activateState("bladesong");
	expect(state.getAc()).toBe(14);
});

test("2014 concentration bonus has a +1 floor; 2024 uses the actual INT modifier", () => {
	const old = makeCharacter(VARIANTS[2]);
	const current = makeCharacter(VARIANTS[0]);
	for (const state of [old, current]) state.setAbilityBase("int", 8);
	const oldCon = old.getConcentrationSaveBonus();
	const currentCon = current.getConcentrationSaveBonus();
	old.activateState("bladesong");
	current.activateState("bladesong");
	expect(old.getAc()).toBe(14);
	expect(current.getAc()).toBe(14);
	expect(old.getConcentrationSaveBonus()).toBe(oldCon + 1);
	expect(current.getConcentrationSaveBonus()).toBe(currentCon - 1);
});

test("Overview activation charges one use only on a valid Bladesong toggle", async () => {
	const state = makeCharacter(VARIANTS[1]);
	const resource = state.addResource({name: "Bladesong", current: 2, max: 2, recharge: "long"});
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._saveCurrentCharacter = () => {};
	page._renderResources = () => {};
	page._renderActiveStates = () => {};
	page._renderCharacter = () => {};
	page._pHandleFeatureInteraction = async () => false;
	page._pHandleR20FeatureActivation = async () => false;
	const feature = {id: "bladesong-feature", name: "Bladesong", description: "Invoke Bladesong as a Bonus Action"};
	const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.bladesong;
	const opts = {isToggle: true};
	const current = () => state.getResources().find(row => row.name === "Bladesong").current;

	await page._activateFeatureState(feature, "bladesong", stateType, resource, 1, opts);
	expect(state.isStateTypeActive("bladesong")).toBe(true);
	expect(current()).toBe(1);
	state.setArmor({name: "Leather", type: "light", ac: 11});
	expect(state.isStateTypeActive("bladesong")).toBe(false);

	const previousToast = JqueryUtil.doToast;
	const toasts = [];
	JqueryUtil.doToast = message => toasts.push(message);
	try {
		await page._activateFeatureState(feature, "bladesong", stateType, resource, 1, opts);
		expect(toasts).toEqual([{type: "warning", content: "Remove your armor before activating Bladesong."}]);
		expect(state.isStateTypeActive("bladesong")).toBe(false);
		expect(current()).toBe(1);
	} finally {
		JqueryUtil.doToast = previousToast;
	}
});
