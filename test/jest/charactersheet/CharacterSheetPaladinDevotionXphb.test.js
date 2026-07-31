import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALADIN_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../data/class/class-paladin.json"), "utf8"));
const DEVOTION = PALADIN_DATA.subclass.find(it => it.name === "Oath of Devotion" && it.source === "XPHB");
const DEVOTION_FEATURES = PALADIN_DATA.subclassFeature.filter(it =>
	it.className === "Paladin"
	&& it.classSource === "XPHB"
	&& it.subclassShortName === "Devotion"
	&& it.subclassSource === "XPHB");
const CHANNEL_DIVINITY = PALADIN_DATA.classFeature.find(it =>
	it.name === "Channel Divinity"
	&& it.className === "Paladin"
	&& it.source === "XPHB");

const getFeatureData = name => DEVOTION_FEATURES.find(it => it.name === name);
const flattenEntries = entries => JSON.stringify(entries || []);

function getDevotionState (level, {cha = 18, source = "XPHB", addFeatures = false} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state.addClass({
		name: "Paladin",
		source,
		level,
		subclass: source === "XPHB"
			? DEVOTION
			: {name: "Oath of Devotion", shortName: "Devotion", source: "PHB"},
	});
	if (addFeatures && source === "XPHB") {
		for (const feature of DEVOTION_FEATURES.filter(it => it.level <= level && it.name !== "Oath of Devotion")) {
			state.addFeature({
				...feature,
				description: flattenEntries(feature.entries),
			});
		}
	}
	return state;
}

describe("Oath of Devotion (XPHB) — complete mechanics", () => {
	it("uses the authoritative 2024 progression without leaking removed 2014 features", () => {
		const l3 = getDevotionState(3).getFeatureCalculations();
		const l7 = getDevotionState(7).getFeatureCalculations();
		const l14 = getDevotionState(14).getFeatureCalculations();
		const l15 = getDevotionState(15).getFeatureCalculations();

		expect(l3).toMatchObject({hasSacredWeapon: true, sacredWeaponBonus: 4});
		expect(l3.hasTurnTheUnholy).toBeFalsy();
		expect(l7).toMatchObject({hasAuraOfDevotion: true, auraOfDevotionRadius: 10});
		expect(l14.hasSmiteOfProtection).toBeFalsy();
		expect(l15).toMatchObject({
			hasSmiteOfProtection: true,
			smiteOfProtectionAcBonus: 2,
			smiteOfProtectionDexSaveBonus: 2,
			smiteOfProtectionRadius: 10,
		});
		expect(l15.hasPurityOfSpirit).toBeFalsy();
	});

	it("preserves the 2014 Devotion progression", () => {
		const calc = getDevotionState(15, {source: "PHB"}).getFeatureCalculations();
		expect(calc).toMatchObject({
			hasTurnTheUnholy: true,
			hasAuraOfDevotion: true,
			hasPurityOfSpirit: true,
		});
		expect(calc.hasSmiteOfProtection).toBeFalsy();
	});

	it("expands the XPHB Channel Divinity pool from two to three uses at Paladin 11", () => {
		const state = getDevotionState(3);
		state.addFeature({
			...CHANNEL_DIVINITY,
			description: flattenEntries(CHANNEL_DIVINITY.entries),
		});
		expect(state.getResource("Channel Divinity")).toMatchObject({current: 2, max: 2});

		state._data.classes[0].level = 11;
		state.recalculateResourceMaximums();

		expect(state.getResource("Channel Divinity")).toMatchObject({current: 3, max: 3});
	});

	it("recovers one XPHB Paladin Channel Divinity use on a Short Rest and all uses on a Long Rest", () => {
		const state = getDevotionState(11);
		state.addFeature({
			...CHANNEL_DIVINITY,
			description: flattenEntries(CHANNEL_DIVINITY.entries),
		});
		const resource = state.getResource("Channel Divinity");
		state.setResourceCurrent(resource.id, 0);

		state.onShortRest();
		expect(state.getResource("Channel Divinity")).toMatchObject({current: 1, max: 3});
		expect(state.getFeatures().find(it => it.name === "Channel Divinity").uses.current).toBe(1);

		state.onLongRest();
		expect(state.getResource("Channel Divinity")).toMatchObject({current: 3, max: 3});
	});

	it.each([
		[3, ["Protection from Evil and Good", "Shield of Faith"]],
		[5, ["Aid", "Zone of Truth"]],
		[9, ["Beacon of Hope", "Dispel Magic"]],
		[13, ["Freedom of Movement", "Guardian of Faith"]],
		[17, ["Commune", "Flame Strike"]],
	])("always prepares every oath-spell tier at Paladin %i", (level, newlyAvailable) => {
		const state = getDevotionState(level);
		const names = state.getSubclassAlwaysPreparedSpells(state.getClasses()[0]).map(it => it.name.toLowerCase());
		for (const name of newlyAvailable) expect(names).toContain(name.toLowerCase());
	});

	it("expands the real level-3 wrapper into rich child features idempotently", () => {
		const state = getDevotionState(3);
		const wrapper = getFeatureData("Oath of Devotion");
		state.addFeature({...wrapper, description: flattenEntries(wrapper.entries)});
		state.setClassFeatureCatalog(PALADIN_DATA.classFeature || [], PALADIN_DATA.subclassFeature || []);

		expect(state.reconcileSubclassFeatureEntries()).toBeGreaterThan(0);
		for (const name of ["Oath of Devotion Spells", "Sacred Weapon"]) {
			const feature = state.getFeatures().find(it => it.name === name);
			expect(feature?.entries?.length).toBeGreaterThan(0);
			expect(feature?.description).toBeTruthy();
		}
		expect(state.reconcileSubclassFeatureEntries()).toBe(0);
	});

	it("classifies Sacred Weapon as a weapon-scoped Channel Divinity state", () => {
		const state = getDevotionState(3);
		state.addFeature({
			name: "Channel Divinity",
			source: "XPHB",
			className: "Paladin",
			classSource: "XPHB",
			uses: {max: 2, current: 2, recharge: "short"},
			description: "You can channel divine energy twice.",
		});
		const sacred = getFeatureData("Sacred Weapon");
		state.addFeature({...sacred, description: flattenEntries(sacred.entries)});

		const activatable = state.getActivatableFeatures().find(it => it.feature.name === "Sacred Weapon");
		expect(activatable.resource.name).toBe("Channel Divinity");
		expect(activatable.activationInfo).toMatchObject({
			stateTypeId: "sacredWeapon",
			interactionMode: "toggle",
			needsWeaponChoice: true,
			weaponFilter: "melee",
			activationAction: "attack",
		});
	});

	it("applies Sacred Weapon only to its chosen weapon, with minimum +1 and Radiant choice", () => {
		const state = getDevotionState(3, {cha: 8});
		state.activateState("sacredWeapon", {
			customEffects: [
				{type: "bonus", target: "attack", abilityMod: "cha", minimum: 1, weaponId: "sword"},
				{type: "damageTypeChoice", choices: ["weapon", "radiant"], weaponId: "sword"},
			],
		});

		expect(state.getBonusFromStates("attack", {weaponId: "sword"})).toBe(1);
		expect(state.getBonusFromStates("attack", {weaponId: "axe"})).toBe(0);
		expect(state.getWeaponDamageTypeChoices("sword", "slashing")).toEqual(["slashing", "radiant"]);
		expect(state.getWeaponDamageTypeChoices("axe", "slashing")).toEqual(["slashing"]);
	});

	it("ends Sacred Weapon when the chosen weapon leaves inventory", () => {
		const state = getDevotionState(3);
		state.addItem({name: "Longsword", source: "XPHB", type: "M", weapon: true}, 1, true);
		const weapon = state.getItems().find(it => it.name === "Longsword");
		state.activateState("sacredWeapon", {
			customEffects: [{
				type: "bonus",
				target: "attack",
				abilityMod: "cha",
				weaponId: `auto_${weapon.id}`,
				inventoryItemId: weapon.id,
			}],
		});

		state.removeItem(weapon.id);
		expect(state.isStateTypeActive("sacredWeapon")).toBe(false);
	});

	it("makes Aura of Devotion a real Charmed immunity", () => {
		const state = getDevotionState(7);
		state.applyClassFeatureEffects();
		expect(state.getConditionImmunities()).toContain("charmed");
	});

	it("triggers Half Cover only after committed XPHB Divine Smite and expires next round", () => {
		const state = getDevotionState(15);
		const acBefore = state.getArmorClass();
		const dexSaveBefore = state.getSaveMod("dex");
		state.startCombat();

		expect(state.applyCommittedSpellCastTriggers({name: "Divine Smite", source: "PHB"})).toEqual([]);
		expect(state.isStateTypeActive("smiteOfProtection")).toBe(false);
		expect(state.applyCommittedSpellCastTriggers({name: "Divine Smite", source: "XPHB"})).toEqual(["Smite of Protection"]);
		expect(state.getArmorClass()).toBe(acBefore + 2);
		expect(state.getSaveMod("dex")).toBe(dexSaveBefore + 2);

		state.advanceRound();
		expect(state.isStateTypeActive("smiteOfProtection")).toBe(false);
	});

	it("implements every Holy Nimbus benefit and its level-5-slot recovery", () => {
		const state = getDevotionState(20, {cha: 18, addFeatures: true});
		const holy = state.getFeatures().find(it => it.name === "Holy Nimbus");
		const resource = state.getResources().find(it => it.name === "Holy Nimbus");
		expect(resource).toMatchObject({current: 1, max: 1, recharge: "long"});
		expect(state.getFeatureCalculations()).toMatchObject({
			hasHolyNimbus: true,
			holyNimbusDamage: 10,
			holyNimbusUses: 1,
		});

		state.setResourceCurrent(resource.id, 0);
		state.setSpellSlots(5, 1, 1);
		expect(state.restoreFeatureUseWithSpellSlot(holy.id, 5)).toBe(true);
		expect(state.getSpellSlotsCurrent(5)).toBe(0);
		expect(state.getResources().find(it => it.id === resource.id).current).toBe(1);

		state.activateState("holyNimbus");
		expect(state.getEnemyTurnStartDamageEffects()).toEqual([{
			source: "Holy Nimbus",
			damage: 10,
			damageType: "radiant",
			radius: 30,
		}]);
		const gated = state.aggregateModifiers("save:wis");
		expect(gated.advantage).toBe(false);
		expect(gated.conditionalsAvailable).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Holy Nimbus",
				conditional: "when the save is forced by a Fiend or Undead",
				advantage: true,
			}),
		]));
		const ids = new Set(gated.conditionalsAvailable.map(it => it.id));
		expect(state.aggregateModifiers("save:wis", {appliedConditionalIds: ids}).advantage).toBe(true);
	});
});
