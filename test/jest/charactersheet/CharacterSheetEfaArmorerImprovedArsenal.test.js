import "./setup.js";
import fs from "node:fs";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ITEMS = JSON.parse(fs.readFileSync("data/items-base.json", "utf8")).baseitem;
const ARTIFICER_DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));

const MODEL_IDS = {
	Dreadnaught: "efa-armorer:dreadnaught:force-demolisher",
	Guardian: "efa-armorer:guardian:thunder-pulse",
	Infiltrator: "efa-armorer:infiltrator:lightning-launcher",
};

const copy = value => JSON.parse(JSON.stringify(value));

function getBaseItem (name, source = "XPHB") {
	const item = ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing test item ${name}|${source}`);
	return copy(item);
}

function addInventoryItem (state, item, equipped = false) {
	const beforeIds = new Set(state.getItems().map(candidate => candidate.id));
	state.addItem(item, 1, equipped);
	const row = state.getItems().find(candidate =>
		!beforeIds.has(candidate.id)
		&& candidate.name === item.name
		&& candidate.source === item.source);
	if (!row) throw new Error(`Inventory row was not added for ${item.name}|${item.source}`);
	return row;
}

function setCanonicalModel (state, name) {
	state._data.chosenSubfeatures = (state._data.chosenSubfeatures || [])
		.filter(record => !(record.parent === "Armor Model" && record.parentSource === "EFA"));
	if (name) {
		state._data.chosenSubfeatures.push({
			parent: "Armor Model",
			parentSource: "EFA",
			parentClass: "Artificer",
			parentClassSource: "EFA",
			level: 3,
			characterLevel: 3,
			name,
			source: "EFA",
			sourceDecisionKey: "artificer|efa:cl3:featurechoice:armor-model:slot0",
		});
	}
	state.reconcileEfaArmorerState({cause: "test-model-change"});
}

function addArmorer (state, {
	level = 9,
	classSource = "EFA",
	subclassSource = "EFA",
} = {}) {
	const classData = ARTIFICER_DATA.class.find(it => it.name === "Artificer" && it.source === classSource);
	const subclassData = ARTIFICER_DATA.subclass.find(it =>
		(it.shortName || it.name) === "Armorer"
		&& it.source === subclassSource);
	state.addClass({
		...(classData ? copy(classData) : {name: "Artificer", source: classSource}),
		level,
		subclass: {
			...(subclassData ? copy(subclassData) : {
				name: "Armorer",
				shortName: "Armorer",
				source: subclassSource,
			}),
			className: "Artificer",
			classSource,
		},
	});
}

function buildState ({
	model = "Guardian",
	level = 9,
	classSource = "EFA",
	subclassSource = "EFA",
	bind = true,
} = {}) {
	const state = new CharacterSheetState();
	addArmorer(state, {level, classSource, subclassSource});
	const isExactEfaArmorer = classSource === "EFA" && subclassSource === "EFA";
	if (model && isExactEfaArmorer) setCanonicalModel(state, model);
	state.addArmorProficiency("Heavy Armor");
	state.addToolProficiency("Smith's Tools");
	addInventoryItem(state, getBaseItem("Smith's Tools"));
	const armor = addInventoryItem(state, getBaseItem("Plate Armor"), true);
	if (bind && isExactEfaArmorer) {
		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
	}
	return {state, armor};
}

function getGeneratedRows (state) {
	return state.getItems()
		.filter(item => item._efaArmorerWeaponId)
		.sort((a, b) => a._efaArmorerWeaponId.localeCompare(b._efaArmorerWeaponId));
}

function getModelRow (state, model) {
	const row = getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS[model]);
	if (!row) throw new Error(`Missing generated ${model} weapon row`);
	return row;
}

function getActiveAttack (state) {
	const attacks = state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId);
	expect(attacks).toHaveLength(1);
	return attacks[0];
}

function setArtificerLevel (state, level) {
	const current = state.getClasses().find(cls => cls.name === "Artificer" && cls.source === "EFA");
	if (!current) throw new Error("Missing EFA Artificer class");
	state.addClass({...copy(current), level});
	state.reconcileEfaArmorerState({cause: "test-level-change"});
}

function getAttackModifiers (state, attack) {
	return {
		attack: state.getWeaponAbilityMod(attack) + state.getProficiencyBonus() + Number(attack.attackBonus || 0),
		damage: state.getWeaponAbilityMod(attack) + state.getWeaponDisplayDamageBonus(attack),
	};
}

describe("EFA Armorer Improved Arsenal", () => {
	it.each(Object.keys(MODEL_IDS))(
		"adds exactly +1 attack and +1 damage to the active %s weapon at level 9",
		model => {
			const {state} = buildState({model, level: 8});
			const rowAtEight = getModelRow(state, model);
			const wrapperId = rowAtEight.id;
			const attackAtEight = getActiveAttack(state);
			const bonusesAtEight = state.getEffectiveItemBonuses(rowAtEight.id);
			expect(bonusesAtEight.totalAttackBonus).toBe(0);
			expect(bonusesAtEight.totalDamageBonus).toBe(0);
			expect(attackAtEight).toMatchObject({attackBonus: 0, damageBonus: 0});
			expect(getAttackModifiers(state, attackAtEight)).toEqual({
				attack: state.getAbilityMod("int") + state.getProficiencyBonus(),
				damage: state.getAbilityMod("int"),
			});

			setArtificerLevel(state, 9);

			const rowAtNine = getModelRow(state, model);
			const attackAtNine = getActiveAttack(state);
			const bonusesAtNine = state.getEffectiveItemBonuses(rowAtNine.id);
			expect(rowAtNine.id).toBe(wrapperId);
			expect(bonusesAtNine.totalAttackBonus).toBe(1);
			expect(bonusesAtNine.totalDamageBonus).toBe(1);
			expect(attackAtNine).toMatchObject({
				id: MODEL_IDS[model],
				attackBonus: 1,
				damageBonus: 1,
			});
			expect(getAttackModifiers(state, attackAtNine)).toEqual({
				attack: state.getAbilityMod("int") + state.getProficiencyBonus() + 1,
				damage: state.getAbilityMod("int") + 1,
			});
		},
	);

	it("follows stable generated identity through rename and moves immediately on a model switch", () => {
		const {state} = buildState({model: "Guardian"});
		const initialIds = Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]));
		const guardian = getModelRow(state, "Guardian");
		state.replaceItem(guardian.id, {
			...guardian,
			name: "Resonant Knuckle",
			customAttackBonus: 2,
			customDamageBonus: 3,
		});

		expect(getActiveAttack(state)).toMatchObject({
			id: MODEL_IDS.Guardian,
			name: "Resonant Knuckle",
			attackBonus: 3,
			damageBonus: 4,
		});

		setCanonicalModel(state, "Dreadnaught");

		expect(Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(state.getEffectiveItemBonuses(guardian.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(getModelRow(state, "Guardian")).toMatchObject({
			id: guardian.id,
			name: "Resonant Knuckle",
			customAttackBonus: 2,
			customDamageBonus: 3,
		});
		expect(state.getEffectiveItemBonuses(getModelRow(state, "Dreadnaught").id)).toMatchObject({
			totalAttackBonus: 1,
			totalDamageBonus: 1,
		});
		expect(getActiveAttack(state)).toMatchObject({
			id: MODEL_IDS.Dreadnaught,
			attackBonus: 1,
			damageBonus: 1,
		});
	});

	it("suspends while doffed or unbound and returns after donning or rebinding", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		const row = getModelRow(state, "Infiltrator");

		state.setItemEquipped(armor.id, false);
		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);

		state.setItemEquipped(armor.id, true);
		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 1,
			totalDamageBonus: 1,
		});

		state.clearEfaArcaneArmorBinding();
		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 1,
			totalDamageBonus: 1,
		});
	});

	it("is inert when Arcane Armor has never been bound", () => {
		const {state} = buildState({model: "Guardian", bind: false});
		const row = getModelRow(state, "Guardian");

		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it("never publishes the bonus from inactive generated rows or same-named user items", () => {
		const {state} = buildState({model: "Guardian"});
		expect(state.getEffectiveItemBonuses(getModelRow(state, "Guardian").id)).toMatchObject({
			totalAttackBonus: 1,
			totalDamageBonus: 1,
		});
		for (const model of ["Dreadnaught", "Infiltrator"]) {
			expect(state.getEffectiveItemBonuses(getModelRow(state, model).id)).toMatchObject({
				totalAttackBonus: 0,
				totalDamageBonus: 0,
			});
		}

		const lookalike = addInventoryItem(state, {
			name: "Thunder Pulse",
			source: "EFA",
			type: "M",
			weapon: true,
			weaponCategory: "simple",
			dmg1: "1d8",
			dmgType: "T",
			abilityMod: "int",
			_isCustom: true,
		}, true);
		expect(state.getEffectiveItemBonuses(lookalike.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
	});

	it.each([
		["a dead character", state => state.setDeathSaveFailures(3)],
		["an unresolved model", state => setCanonicalModel(state, null)],
		["a lost binding", state => state.clearEfaArcaneArmorBinding()],
	])("is inert for %s", (_label, invalidate) => {
		const {state} = buildState({model: "Dreadnaught"});
		const row = getModelRow(state, "Dreadnaught");

		invalidate(state);

		expect(state.getEffectiveItemBonuses(row.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it("composes with player item bonuses and custom attack/damage without mutating stored fields", () => {
		const {state} = buildState({model: "Guardian"});
		const guardian = getModelRow(state, "Guardian");
		state.replaceItem(guardian.id, {
			...guardian,
			name: "Player-Tuned Pulse",
			bonusWeapon: "+2",
			bonusWeaponAttack: "+3",
			bonusWeaponDamage: "+4",
			customAttackBonus: 5,
			customDamageBonus: 6,
		});

		expect(state.getEffectiveItemBonuses(guardian.id)).toMatchObject({
			totalAttackBonus: 6,
			totalDamageBonus: 7,
		});
		expect(getActiveAttack(state)).toMatchObject({
			attackBonus: 11,
			damageBonus: 13,
		});

		setArtificerLevel(state, 8);
		expect(state.getEffectiveItemBonuses(guardian.id)).toMatchObject({
			totalAttackBonus: 5,
			totalDamageBonus: 6,
		});
		expect(getActiveAttack(state)).toMatchObject({
			attackBonus: 10,
			damageBonus: 12,
		});
		expect(getModelRow(state, "Guardian")).toMatchObject({
			id: guardian.id,
			name: "Player-Tuned Pulse",
			bonusWeapon: "+2",
			bonusWeaponAttack: "+3",
			bonusWeaponDamage: "+4",
			customAttackBonus: 5,
			customDamageBonus: 6,
		});

		setArtificerLevel(state, 9);
		expect(state.getEffectiveItemBonuses(guardian.id)).toMatchObject({
			totalAttackBonus: 6,
			totalDamageBonus: 7,
		});
		expect(getModelRow(state, "Guardian")).toMatchObject({
			id: guardian.id,
			bonusWeapon: "+2",
			bonusWeaponAttack: "+3",
			bonusWeaponDamage: "+4",
			customAttackBonus: 5,
			customDamageBonus: 6,
		});
	});

	it("round-trips active bonuses, stable wrapper identity, and customization through save/load", () => {
		const {state} = buildState({model: "Infiltrator"});
		const infiltrator = getModelRow(state, "Infiltrator");
		state.replaceItem(infiltrator.id, {
			...infiltrator,
			name: "Storm Needle",
			bonusWeapon: "+2",
			customAttackBonus: 1,
			customDamageBonus: 2,
		});

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		const restoredRow = getModelRow(restored, "Infiltrator");
		expect(restoredRow).toMatchObject({
			id: infiltrator.id,
			name: "Storm Needle",
			bonusWeapon: "+2",
			customAttackBonus: 1,
			customDamageBonus: 2,
		});
		expect(restored.getEffectiveItemBonuses(restoredRow.id)).toMatchObject({
			totalAttackBonus: 3,
			totalDamageBonus: 3,
		});
		expect(getActiveAttack(restored)).toMatchObject({
			id: MODEL_IDS.Infiltrator,
			name: "Storm Needle",
			attackBonus: 4,
			damageBonus: 5,
		});
	});

	it("tears down on Respec-style subclass loss and exact EFA class-source loss", () => {
		const subclassLoss = buildState({model: "Guardian"}).state;
		subclassLoss.setSubclass("Artificer", {
			name: "Artillerist",
			shortName: "Artillerist",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
		});
		subclassLoss.reconcileEfaArmorerState({cause: "test-respec-subclass-loss"});
		expect(getGeneratedRows(subclassLoss)).toEqual([]);
		expect(subclassLoss.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);

		const sourceLoss = buildState({model: "Guardian"}).state;
		sourceLoss.removeClass("Artificer", "EFA");
		sourceLoss.reconcileEfaArmorerState({cause: "test-source-loss"});
		expect(getGeneratedRows(sourceLoss)).toEqual([]);
		expect(sourceLoss.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it.each([
		["TCE Armorer", "TCE", "TCE"],
		["EFA Artificer with TCE Armorer", "EFA", "TCE"],
		["TCE Artificer with EFA Armorer", "TCE", "EFA"],
	])("does not project Improved Arsenal onto %s", (_label, classSource, subclassSource) => {
		const {state} = buildState({
			classSource,
			subclassSource,
			model: null,
			bind: false,
		});
		const collision = addInventoryItem(state, {
			name: "Force Demolisher",
			source: "EFA",
			type: "M",
			weapon: true,
			dmg1: "1d10",
			dmgType: "O",
			abilityMod: "int",
			_isCustom: true,
		}, true);

		expect(state._getEfaArmorerImprovedArsenalBonus({
			_efaArmorerWeaponId: MODEL_IDS.Dreadnaught,
		})).toBe(0);
		expect(state.getEffectiveItemBonuses(collision.id)).toMatchObject({
			totalAttackBonus: 0,
			totalDamageBonus: 0,
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});
});
