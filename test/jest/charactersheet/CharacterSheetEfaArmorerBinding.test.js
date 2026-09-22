import "./setup.js";
import fs from "node:fs";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ITEMS = JSON.parse(fs.readFileSync("data/items-base.json", "utf8")).baseitem;
const ARTIFICER_DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));

const MODEL_NAMES = ["Dreadnaught", "Guardian", "Infiltrator"];
const MODEL_IDS = {
	Dreadnaught: "efa-armorer:dreadnaught:force-demolisher",
	Guardian: "efa-armorer:guardian:thunder-pulse",
	Infiltrator: "efa-armorer:infiltrator:lightning-launcher",
};
const MODEL_STATS = {
	Dreadnaught: {
		name: "Force Demolisher",
		type: "M",
		isMelee: true,
		damage: "1d10",
		damageType: "force",
		dmgType: "O",
		properties: ["R"],
		range: "10 ft.",
		reach: 10,
	},
	Guardian: {
		name: "Thunder Pulse",
		type: "M",
		isMelee: true,
		damage: "1d8",
		damageType: "thunder",
		dmgType: "T",
		properties: [],
		range: "5 ft.",
		reach: 5,
	},
	Infiltrator: {
		name: "Lightning Launcher",
		type: "R",
		isMelee: false,
		damage: "1d6",
		damageType: "lightning",
		dmgType: "L",
		properties: [],
		range: "90/300",
		reach: null,
	},
};

const copy = value => JSON.parse(JSON.stringify(value));

function getBaseItem (name, source = "XPHB") {
	const item = ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing test item ${name}|${source}`);
	return copy(item);
}

function setCanonicalModel (state, name) {
	const characterLevel = 3;
	const ref = `${name}|Artificer|EFA|Armorer|EFA|3|EFA`;
	state._data.chosenSubfeatures = (state._data.chosenSubfeatures || [])
		.filter(record => !(record.parent === "Armor Model" && record.parentSource === "EFA"));
	state._data.chosenSubfeatures.push({
		parent: "Armor Model",
		parentSource: "EFA",
		parentClass: "Artificer",
		parentClassSource: "EFA",
		level: 3,
		characterLevel,
		name,
		source: "EFA",
		sourceDecisionKey: "artificer|efa:cl3:featurechoice:armor-model:slot0",
	});

	const history = state._data.levelHistory.find(entry =>
		entry.class?.name === "Artificer"
		&& entry.class?.source === "EFA"
		&& Number(entry.classLevel) === 3);
	history.choices ||= {};
	history.choices.featureChoices = [{
		featureName: "Armor Model",
		choice: name,
		source: "EFA",
		acquisitionLevel: 3,
		ref,
		type: "subclassFeature",
	}];
	history.choices.replayData = {
		...(history.choices.replayData || {}),
		featureChoices: [{
			name,
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Armorer",
			subclassSource: "EFA",
			level: 3,
			parentFeature: "Armor Model",
			acquisitionLevel: 3,
			ref,
		}],
	};
	history.decisions = [{
		type: "featureChoice",
		label: "Armor Model",
		sourceKey: "Armor Model",
		required: true,
		count: 1,
		status: "resolved",
		selection: [{choice: name, source: "EFA", ref}],
	}];
	history.complete = true;
	state.getFeatureCalculations();
}

function addEfaArmorer (state, {classSource = "EFA", subclassSource = "EFA", subclassName = "Armorer"} = {}) {
	const classData = ARTIFICER_DATA.class.find(it => it.name === "Artificer" && it.source === classSource);
	const subclassData = ARTIFICER_DATA.subclass.find(it =>
		(it.shortName || it.name) === subclassName
		&& it.source === subclassSource
		&& it.className === "Artificer"
		&& it.classSource === classSource);
	state.addClass({
		...(classData ? copy(classData) : {name: "Artificer", source: classSource}),
		level: 3,
		subclass: {
			...(subclassData ? copy(subclassData) : {
				name: subclassName,
				shortName: subclassName,
				source: subclassSource,
			}),
			className: "Artificer",
			classSource,
		},
	});
	for (let classLevel = 1; classLevel <= 3; ++classLevel) {
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Artificer", source: classSource},
			classLevel,
			choices: classLevel === 3
				? {subclass: {name: subclassName, shortName: subclassName, source: subclassSource}}
				: {},
			complete: true,
		});
	}
}

function addInventoryItem (state, item, equipped = false) {
	state.addItem(item, 1, equipped);
	const row = state.getItems().find(candidate =>
		candidate.name === item.name
		&& candidate.source === item.source);
	if (!row) throw new Error(`Inventory row was not added for ${item.name}|${item.source}`);
	return row;
}

function buildState ({
	model = "Guardian",
	addProficiency = true,
	addTools = true,
	addArmor = true,
	classSource = "EFA",
	subclassSource = "EFA",
	subclassName = "Armorer",
} = {}) {
	const state = new CharacterSheetState();
	addEfaArmorer(state, {classSource, subclassSource, subclassName});
	if (model && classSource === "EFA") setCanonicalModel(state, model);
	if (addProficiency) state.addToolProficiency("Smith's Tools");
	const tools = addTools ? addInventoryItem(state, getBaseItem("Smith's Tools"), false) : null;
	const armor = addArmor ? addInventoryItem(state, getBaseItem("Plate Armor"), true) : null;
	return {state, armor, tools};
}

function getGeneratedRows (state) {
	return state.getItems()
		.filter(item => item._efaArmorerWeaponId)
		.sort((a, b) => a._efaArmorerWeaponId.localeCompare(b._efaArmorerWeaponId));
}

function getActiveModelAttack (state) {
	const attacks = state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId);
	expect(attacks).toHaveLength(1);
	return attacks[0];
}

function getAttackRollCalculations (state, attack) {
	return {
		ability: state.resolveAttackAbilityKey(attack.abilityMod),
		attackBonus: state.getWeaponAbilityMod(attack) + state.getProficiencyBonus() + (attack.attackBonus || 0),
		damageBonus: state.getWeaponAbilityMod(attack) + state.getWeaponDisplayDamageBonus(attack),
	};
}

function setHeavyArmorStealthSnapshot (state) {
	state.setArmor({
		name: "Plate Armor",
		source: "XPHB",
		ac: 18,
		type: "heavy",
		stealth: true,
	});
}

describe("EFA Armorer Arcane Armor binding", () => {
	it("binds one eligible equipped armor wrapper and exposes an explicit active status", () => {
		const {state, armor} = buildState();

		expect(state.getEfaArcaneArmorEligibleItems().map(item => item.id)).toEqual([armor.id]);
		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true, changed: true});
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			available: true,
			boundItemId: armor.id,
			active: true,
			suspended: false,
			model: {name: "Guardian", source: "EFA"},
		});
		expect(state.getEfaArcaneArmorBinding()).toMatchObject({id: armor.id, name: "Plate Armor"});
		expect(state.toJson().efaArmorer.arcaneArmorItemId).toBe(armor.id);
	});

	it("rejects binding without Smith's Tools proficiency", () => {
		const {state, armor} = buildState({addProficiency: false});

		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({
			ok: false,
			code: "missing-smiths-tools-proficiency",
		});
	});

	it("rejects binding without an actual canonical Smith's Tools inventory item", () => {
		const {state, armor} = buildState({addTools: false});
		addInventoryItem(state, {
			name: "Smith's Tools",
			source: "Custom",
			type: "AT",
			_isCustom: true,
		}, false);

		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({
			ok: false,
			code: "missing-smiths-tools-item",
		});
	});

	it("keeps Arcane Armor active after the transformation tools are no longer available", () => {
		const {state, armor, tools} = buildState({model: "Infiltrator"});
		state.setAbilityBase("str", 16);
		const baseSpeed = state.getWalkSpeed();
		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(true);

		state.removeItem(tools.id);
		state.removeToolProficiency("Smith's Tools");

		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: true,
			suspended: false,
			reasons: [],
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([
			expect.objectContaining({id: MODEL_IDS.Infiltrator}),
		]);
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(true);
		expect(state.getEfaArcaneArmorEligibleItems()).toEqual([]);
	});

	it("rejects a shield even when it is equipped", () => {
		const {state} = buildState({addArmor: false});
		const shield = addInventoryItem(state, getBaseItem("Shield"), true);

		expect(state.bindEfaArcaneArmor(shield.id)).toMatchObject({
			ok: false,
			code: "not-body-armor",
		});
	});

	it("preserves the wrapper binding while doffed and suspends every model attack", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);

		state.setItemEquipped(armor.id, false);

		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: false,
			suspended: true,
			reasons: expect.arrayContaining(["bound-armor-not-equipped"]),
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it("routes the equip/unequip aliases through the same binding reconciliation", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);

		state.unequip(armor.id);
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: false,
		});

		state.equip(armor.id);
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: true,
		});

		const other = addInventoryItem(state, getBaseItem("Leather Armor"), false);
		state.equip(other.id);
		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
	});

	it("clears the binding when another body armor is equipped", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);
		const other = addInventoryItem(state, getBaseItem("Leather Armor"), false);

		state.setItemEquipped(other.id, true);

		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
	});

	it.each([
		["removed", (state, armor) => state.removeItem(armor.id)],
		["replaced by a non-armor payload", (state, armor) => state.replaceItem(armor.id, {
			name: "Arcane Coat",
			source: "Custom",
			type: "G",
			_isCustom: true,
		})],
	])("clears the binding when the bound row is %s", (_label, mutate) => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);

		mutate(state, armor);

		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
	});

	it("clears the binding on death", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);

		state.setDeathSaveFailures(3);

		expect(state.isDead()).toBe(true);
		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
	});

	it("clears the binding and owned rows when the exact EFA subclass is lost", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);
		expect(getGeneratedRows(state)).toHaveLength(3);

		state.removeClass("Artificer", "EFA");

		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
		expect(getGeneratedRows(state)).toEqual([]);
	});

	it("clears the binding and leaves existing rows dormant when the canonical model is lost", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);
		state._data.chosenSubfeatures = [];
		state._data.levelHistory[2].choices.featureChoices = [];
		state._data.levelHistory[2].choices.replayData.featureChoices = [];
		state._data.levelHistory[2].decisions = [];

		state.getFeatureCalculations();

		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();
		expect(getGeneratedRows(state)).toHaveLength(3);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it("round-trips the wrapper binding and ignores editable armor names", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);
		state.replaceItem(armor.id, {
			...getBaseItem("Plate Armor"),
			name: "Aegis of the Last Watch",
			_isCustom: true,
		});
		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBe(armor.id);

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);

		expect(restored.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: true,
		});
		expect(restored.getItems().find(item => item.id === armor.id)?.name).toBe("Aegis of the Last Watch");
	});

	it("clears an unknown stale binding on load but preserves a doffed existing row", () => {
		const stale = buildState();
		stale.state.bindEfaArcaneArmor(stale.armor.id);
		const staleJson = copy(stale.state.toJson());
		staleJson.efaArmorer.arcaneArmorItemId = "missing-wrapper-id";
		const staleRestored = new CharacterSheetState();
		staleRestored.loadFromJson(staleJson);
		expect(staleRestored.getEfaArcaneArmorBindingStatus().boundItemId).toBeNull();

		const doffed = buildState();
		doffed.state.bindEfaArcaneArmor(doffed.armor.id);
		doffed.state.setItemEquipped(doffed.armor.id, false);
		const doffedRestored = new CharacterSheetState();
		doffedRestored.loadFromJson(copy(doffed.state.toJson()));
		expect(doffedRestored.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: doffed.armor.id,
			active: false,
			suspended: true,
		});
	});
});

describe("EFA Armorer stable generated model weapons", () => {
	it("creates exactly one row per permanent model identity and reconciles idempotently", () => {
		const {state} = buildState();
		const initial = getGeneratedRows(state);
		expect(initial.map(item => item._efaArmorerWeaponId)).toEqual(Object.values(MODEL_IDS).sort());
		expect(new Set(initial.map(item => item.id)).size).toBe(3);
		for (const item of initial) {
			const model = MODEL_NAMES.find(name => MODEL_IDS[name] === item._efaArmorerWeaponId);
			const expected = MODEL_STATS[model];
			expect(item).toMatchObject({
				type: expected.type,
				weapon: true,
				weaponCategory: "simple",
				isMelee: expected.isMelee,
				dmg1: expected.damage,
				dmgType: expected.dmgType,
				property: expected.properties,
				range: expected.range,
				abilityMod: "int",
				_generatedItemBase: {
					type: expected.type,
					weaponCategory: "simple",
					isMelee: expected.isMelee,
					dmg1: expected.damage,
					dmgType: expected.dmgType,
					property: expected.properties,
					range: expected.range,
					abilityMod: "int",
				},
			});
		}
		state.addItem({
			...initial[0],
			id: undefined,
			name: "Duplicate Generated Row",
			_isCustom: true,
		}, 1, true);

		for (let i = 0; i < 3; ++i) state.getFeatureCalculations();

		expect(getGeneratedRows(state)).toHaveLength(3);
		expect(getGeneratedRows(state).map(item => ({
			id: item.id,
			stableId: item._efaArmorerWeaponId,
		}))).toEqual(initial.map(item => ({
			id: item.id,
			stableId: item._efaArmorerWeaponId,
		})));
	});

	it("derives generated weapon equip state from the active selected model", () => {
		const {state, armor} = buildState({model: "Guardian"});
		expect(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.equipped])).toEqual([
			[MODEL_IDS.Dreadnaught, false],
			[MODEL_IDS.Guardian, false],
			[MODEL_IDS.Infiltrator, false],
		]);

		state.bindEfaArcaneArmor(armor.id);

		expect(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.equipped])).toEqual([
			[MODEL_IDS.Dreadnaught, false],
			[MODEL_IDS.Guardian, true],
			[MODEL_IDS.Infiltrator, false],
		]);
		expect(getActiveModelAttack(state).id).toBe(MODEL_IDS.Guardian);
	});

	it("self-corrects generated weapon equip toggles without changing active mechanics", () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.bindEfaArcaneArmor(armor.id);
		const guardian = getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		const dreadnaught = getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Dreadnaught);

		state.setItemEquipped(guardian.id, false);
		state.setItemEquipped(dreadnaught.id, true);

		expect(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.equipped])).toEqual([
			[MODEL_IDS.Dreadnaught, false],
			[MODEL_IDS.Guardian, true],
			[MODEL_IDS.Infiltrator, false],
		]);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([
			expect.objectContaining({id: MODEL_IDS.Guardian}),
		]);
	});

	it("transitions derived equip state across doff, don, and model switches", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.bindEfaArcaneArmor(armor.id);
		const initialIds = Object.fromEntries(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.id]));
		expect(getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Infiltrator).equipped).toBe(true);

		state.setItemEquipped(armor.id, false);
		expect(getGeneratedRows(state).every(item => !item.equipped)).toBe(true);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);

		state.setItemEquipped(armor.id, true);
		expect(getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Infiltrator).equipped).toBe(true);

		setCanonicalModel(state, "Dreadnaught");
		expect(Object.fromEntries(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.equipped])).toEqual([
			[MODEL_IDS.Dreadnaught, true],
			[MODEL_IDS.Guardian, false],
			[MODEL_IDS.Infiltrator, false],
		]);
		expect(getActiveModelAttack(state).id).toBe(MODEL_IDS.Dreadnaught);
	});

	it("upgrades accepted stat-less rows without replacing custom names or effects", () => {
		const {state} = buildState({model: "Infiltrator"});
		for (const wrapper of state._data.inventory.filter(row => row.item?._efaArmorerWeaponId)) {
			delete wrapper.item._generatedItemBase;
			delete wrapper.item.dmg1;
			delete wrapper.item.dmgType;
			delete wrapper.item.property;
			delete wrapper.item.range;
			delete wrapper.item.abilityMod;
			delete wrapper.item.effects;
		}
		const guardian = state._data.inventory.find(row => row.item?._efaArmorerWeaponId === MODEL_IDS.Guardian);
		guardian.item.name = "Player-Named Thunder Fist";
		guardian.item.effects = [{type: "ac", value: 1, name: "Player Effect"}];

		state.getFeatureCalculations();

		for (const model of MODEL_NAMES) {
			const item = getGeneratedRows(state).find(row => row._efaArmorerWeaponId === MODEL_IDS[model]);
			const expected = MODEL_STATS[model];
			expect(item).toMatchObject({
				dmg1: expected.damage,
				dmgType: expected.dmgType,
				property: expected.properties,
				range: expected.range,
				abilityMod: "int",
			});
		}
		expect(getGeneratedRows(state).find(row => row._efaArmorerWeaponId === MODEL_IDS.Guardian)).toMatchObject({
			name: "Player-Named Thunder Fist",
			effects: [{type: "ac", value: 1, name: "Player Effect"}],
		});
		expect(getGeneratedRows(state).find(row => row._efaArmorerWeaponId === MODEL_IDS.Infiltrator).effects)
			.toEqual(expect.arrayContaining([
				expect.objectContaining({_generatedEffectId: "efa-armorer:infiltrator:powered-steps"}),
				expect.objectContaining({_generatedEffectId: "efa-armorer:infiltrator:dampening-field"}),
			]));
	});

	it("preserves each model row and customization across model switches and save/load", () => {
		const {state} = buildState();
		const initialIds = Object.fromEntries(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.id]));
		const guardian = getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		state.replaceItem(guardian.id, {
			...guardian,
			name: "Customized Thunder Knuckle",
			customAttackBonus: 2,
		});

		setCanonicalModel(state, "Dreadnaught");
		const switched = getGeneratedRows(state);
		expect(Object.fromEntries(switched.map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(switched.find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian)).toMatchObject({
			name: "Customized Thunder Knuckle",
			customAttackBonus: 2,
		});

		const restored = new CharacterSheetState();
		restored.loadFromJson(copy(state.toJson()));
		expect(Object.fromEntries(getGeneratedRows(restored).map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(getGeneratedRows(restored).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian)).toMatchObject({
			name: "Customized Thunder Knuckle",
			customAttackBonus: 2,
		});
	});

	it("preserves direct mechanical overrides, notes, bonuses, effects, and wrapper identity", () => {
		const {state, armor} = buildState({model: "Guardian"});
		state.setAbilityBase("cha", 16);
		state.bindEfaArcaneArmor(armor.id);
		const guardian = getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		state.replaceItem(guardian.id, {
			...guardian,
			name: "Resonant Diplomat",
			weaponCategory: "martial",
			dmg1: "2d8",
			dmgType: "R",
			property: ["F"],
			range: "15 ft.",
			abilityMod: "cha",
			customAttackBonus: 2,
			customDamageBonus: 3,
			entries: ["A player-authored note on the weapon."],
			effects: [{type: "ac", value: 2, name: "Player Effect"}],
			playerMetadata: {keep: true},
		});
		state.updateItemNote(guardian.id, "Wrapper note survives");

		setCanonicalModel(state, "Dreadnaught");
		expect(state.getCustomModifier("ac")).toBe(0);
		setCanonicalModel(state, "Guardian");

		let attack = getActiveModelAttack(state);
		expect(attack).toMatchObject({
			id: MODEL_IDS.Guardian,
			name: "Resonant Diplomat",
			weaponCategory: "martial",
			abilityMod: "cha",
			attackBonus: 2,
			damage: "2d8",
			damageType: "radiant",
			damageBonus: 3,
			properties: ["F"],
			range: "15 ft.",
			reach: 15,
		});
		expect(state.getCustomModifier("ac")).toBe(2);

		const restored = new CharacterSheetState();
		restored.loadFromJson(copy(state.toJson()));
		const restoredGuardian = getGeneratedRows(restored).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		expect(restoredGuardian).toMatchObject({
			id: guardian.id,
			name: "Resonant Diplomat",
			weaponCategory: "martial",
			dmg1: "2d8",
			dmgType: "R",
			property: ["F"],
			range: "15 ft.",
			abilityMod: "cha",
			customAttackBonus: 2,
			customDamageBonus: 3,
			entries: ["A player-authored note on the weapon."],
			effects: [{type: "ac", value: 2, name: "Player Effect"}],
			playerMetadata: {keep: true},
		});
		expect(restored.getItemNote(guardian.id)).toBe("Wrapper note survives");
		attack = getActiveModelAttack(restored);
		expect(attack.id).toBe(MODEL_IDS.Guardian);
		expect(restored.getCustomModifier("ac")).toBe(2);
		expect(getAttackRollCalculations(restored, attack)).toEqual({
			ability: "cha",
			attackBonus: 7,
			damageBonus: 6,
		});
	});

	it("exposes only the selected active model attack and suppresses inactive item effects", () => {
		const {state, armor} = buildState();
		state.bindEfaArcaneArmor(armor.id);
		const rows = getGeneratedRows(state);
		const guardian = rows.find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		const dreadnaught = rows.find(item => item._efaArmorerWeaponId === MODEL_IDS.Dreadnaught);
		state.replaceItem(dreadnaught.id, {
			...dreadnaught,
			effects: [{type: "ac", value: 2}],
		});

		expect(state.isItemAttackAvailable(guardian)).toBe(true);
		expect(state.isItemAttackAvailable(dreadnaught)).toBe(false);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([
			expect.objectContaining({
				id: MODEL_IDS.Guardian,
				_efaArmorerWeaponId: MODEL_IDS.Guardian,
				sourceItem: expect.objectContaining({id: guardian.id}),
			}),
		]);
		expect(state.getCustomModifier("ac")).toBe(0);
	});

	it.each(MODEL_NAMES)("uses the permanent %s identity for the generated attack", model => {
		const {state, armor} = buildState({model});
		state.bindEfaArcaneArmor(armor.id);

		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([
			expect.objectContaining({
				id: MODEL_IDS[model],
				_efaArmorerWeaponId: MODEL_IDS[model],
			}),
		]);
	});

	it.each(MODEL_NAMES)("resolves exact active-bound %s descriptors and Intelligence roll math", model => {
		const {state, armor} = buildState({model});
		state.setAbilityBase("int", 18);
		state.setAbilityBase("str", 20);
		state.setAbilityBase("dex", 20);
		state.bindEfaArcaneArmor(armor.id);

		const attack = getActiveModelAttack(state);
		const expected = MODEL_STATS[model];
		expect(attack).toMatchObject({
			id: MODEL_IDS[model],
			_efaArmorerWeaponId: MODEL_IDS[model],
			name: expected.name,
			isMelee: expected.isMelee,
			weaponCategory: "simple",
			abilityMod: "int",
			attackBonus: 0,
			damage: expected.damage,
			damageType: expected.damageType,
			damageBonus: 0,
			properties: expected.properties,
			range: expected.range,
		});
		expect(state.getAttackReach(attack)).toBe(expected.reach);
		expect(getAttackRollCalculations(state, attack)).toEqual({
			ability: "int",
			attackBonus: 6,
			damageBonus: 4,
		});

		const calc = state.getFeatureCalculations();
		expect(calc).toMatchObject({
			hasArcaneArmor: true,
			hasEfaArmorer: true,
			efaArmorerSource: "EFA",
			efaArmorerModel: model,
			efaArmorerBindingActive: true,
			efaArmorerModelWeaponActive: true,
			efaArmorerModelWeaponId: MODEL_IDS[model],
		});
		expect(!!calc.hasEfaForceDemolisher).toBe(model === "Dreadnaught");
		expect(!!calc.hasEfaThunderPulse).toBe(model === "Guardian");
		expect(!!calc.hasEfaLightningLauncher).toBe(model === "Infiltrator");
		expect(!!calc.hasEfaPoweredSteps).toBe(model === "Infiltrator");
		expect(!!calc.hasEfaDampeningField).toBe(model === "Infiltrator");
		expect(calc).not.toHaveProperty("improvedArsenalBonus");
	});

	it("applies Infiltrator speed and Stealth advantage only while the binding is active", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.setAbilityBase("str", 16);
		const baseSpeed = state.getWalkSpeed();

		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: false,
			disadvantage: false,
		});
		state.bindEfaArcaneArmor(armor.id);
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);
		expect(state.getSpeed("walk")).toBe(baseSpeed + 5);
		expect(state.getSpeedBreakdown("walk").components).toEqual(expect.arrayContaining([
			expect.objectContaining({name: expect.stringContaining("Powered Steps"), value: 5}),
		]));
		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: true,
			disadvantage: false,
			cancelled: false,
		});

		setHeavyArmorStealthSnapshot(state);
		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: false,
			disadvantage: false,
			cancelled: true,
			sources: expect.arrayContaining(["Armor"]),
		});

		state.setItemEquipped(armor.id, false);
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: false,
			suspended: true,
		});
		expect(state.getWalkSpeed()).toBe(baseSpeed);
		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: false,
			disadvantage: true,
			cancelled: false,
		});
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);

		state.setItemEquipped(armor.id, true);
		state.clearEfaArcaneArmorBinding();
		expect(state.getWalkSpeed()).toBe(baseSpeed);
		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: false,
			disadvantage: true,
		});
	});

	it("suspends Infiltrator passives when the bound Arcane Armor is doffed", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		const baseSpeed = buildState({model: "Guardian"}).state.getWalkSpeed();
		state.bindEfaArcaneArmor(armor.id);
		state.setItemEquipped(armor.id, false);

		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: false,
			suspended: true,
		});
		expect(state.getWalkSpeed()).toBe(baseSpeed);
		expect(state.getAdvantageState("skill:stealth")).toMatchObject({
			advantage: false,
			disadvantage: false,
		});
	});

	it("switches attack and passive mechanics without activating multiple models", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.setAbilityBase("str", 16);
		state.bindEfaArcaneArmor(armor.id);
		const baseSpeed = state.getWalkSpeed() - 5;
		expect(getActiveModelAttack(state).id).toBe(MODEL_IDS.Infiltrator);
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(true);

		setCanonicalModel(state, "Guardian");

		expect(state.getWalkSpeed()).toBe(baseSpeed);
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(false);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([
			expect.objectContaining({id: MODEL_IDS.Guardian}),
		]);
		const calc = state.getFeatureCalculations();
		expect(calc.hasEfaThunderPulse).toBe(true);
		expect(calc.hasEfaLightningLauncher).toBeUndefined();
		expect(calc.hasEfaPoweredSteps).toBeUndefined();
		expect(calc.hasEfaDampeningField).toBeUndefined();
	});

	it.each([
		["death", state => state.setDeathSaveFailures(3)],
		["subclass loss", state => state.removeClass("Artificer", "EFA")],
		["model ambiguity", state => {
			state._data.chosenSubfeatures.push({
				parent: "Armor Model",
				parentSource: "EFA",
				parentClass: "Artificer",
				parentClassSource: "EFA",
				level: 3,
				name: "Guardian",
				source: "EFA",
			});
			state.getFeatureCalculations();
		}],
	])("removes active attacks and passives on %s", (_label, deactivate) => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.setAbilityBase("str", 16);
		const baseSpeed = state.getWalkSpeed();
		state.bindEfaArcaneArmor(armor.id);
		expect(state.getWalkSpeed()).toBe(baseSpeed + 5);

		deactivate(state);

		expect(state.getWalkSpeed()).toBe(baseSpeed);
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(false);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});

	it("round-trips the active Infiltrator attack and passive mechanics", () => {
		const {state, armor} = buildState({model: "Infiltrator"});
		state.setAbilityBase("str", 16);
		const baseSpeed = state.getWalkSpeed();
		state.bindEfaArcaneArmor(armor.id);
		const ids = Object.fromEntries(getGeneratedRows(state).map(item => [item._efaArmorerWeaponId, item.id]));

		const restored = new CharacterSheetState();
		restored.loadFromJson(copy(state.toJson()));

		expect(Object.fromEntries(getGeneratedRows(restored).map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(ids);
		expect(getActiveModelAttack(restored).id).toBe(MODEL_IDS.Infiltrator);
		expect(restored.getWalkSpeed()).toBe(baseSpeed + 5);
		expect(restored.getAdvantageState("skill:stealth").advantage).toBe(true);
	});

	it("keeps TCE and mixed-source Armorer mechanics isolated from EFA binding", () => {
		const tce = buildState({
			classSource: "TCE",
			subclassSource: "TCE",
			model: null,
		});
		const tceCalc = tce.state.getFeatureCalculations();
		expect(tceCalc).toMatchObject({
			hasArcaneArmor: true,
			thunderGauntletsDamage: "1d8",
			defensiveFieldTempHp: 3,
			lightningLauncherDamage: "1d6",
			lightningLauncherBonusDamage: "1d6",
			infiltratorSpeedBonus: 5,
		});
		expect(tceCalc.hasEfaArmorer).toBeUndefined();
		expect(getGeneratedRows(tce.state)).toEqual([]);

		const mixed = buildState({
			classSource: "EFA",
			subclassSource: "TCE",
			model: "Guardian",
		});
		expect(mixed.state.bindEfaArcaneArmor(mixed.armor.id)).toMatchObject({
			ok: false,
			code: "efa-armorer-unavailable",
		});
		expect(mixed.state.getFeatureCalculations().hasEfaArmorer).toBeUndefined();
		expect(getGeneratedRows(mixed.state)).toEqual([]);
	});

	it.each([
		["TCE Artificer and TCE Armorer", "TCE", "TCE", "Armorer"],
		["EFA Artificer and TCE Armorer", "EFA", "TCE", "Armorer"],
		["EFA Artificer and a same-source name collision", "EFA", "EFA", "Armorist"],
	])("never activates for %s", (_label, classSource, subclassSource, subclassName) => {
		const {state, armor} = buildState({
			classSource,
			subclassSource,
			subclassName,
			model: classSource === "EFA" ? "Guardian" : null,
		});

		expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({
			ok: false,
			code: "efa-armorer-unavailable",
		});
		expect(getGeneratedRows(state)).toEqual([]);
		expect(state.getFeatureGrantedAttacks().filter(attack => attack._efaArmorerWeaponId)).toEqual([]);
	});
});
