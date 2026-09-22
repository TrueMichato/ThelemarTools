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
			expect(item).not.toHaveProperty("dmg1");
			expect(item).not.toHaveProperty("range");
			expect(item).not.toHaveProperty("abilityMod");
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
