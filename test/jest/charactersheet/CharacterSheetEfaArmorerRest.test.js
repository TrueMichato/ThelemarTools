import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetRest} from "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetState = globalThis.CharacterSheetState;
const DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const ITEMS = JSON.parse(fs.readFileSync("data/items-base.json", "utf8")).baseitem;
const REST_SOURCE = fs.readFileSync("js/charactersheet/charactersheet-rest.js", "utf8");

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

function getEfaOption (name) {
	const feature = DATA.subclassFeature.find(it =>
		it.name === name
		&& it.source === "EFA"
		&& it.className === "Artificer"
		&& it.classSource === "EFA"
		&& it.subclassShortName === "Armorer"
		&& it.subclassSource === "EFA"
		&& Number(it.level) === 3);
	if (!feature) throw new Error(`Missing exact EFA Armor Model option ${name}`);
	return {
		...copy(feature),
		ref: `${name}|Artificer|EFA|Armorer|EFA|3|EFA`,
		type: "subclassFeature",
		refType: "subclassFeature",
	};
}

function getPage (state, {subclassFeatures = DATA.subclassFeature} = {}) {
	return {
		_lastRestSnapshot: null,
		getState: () => state,
		getClasses: () => DATA.class,
		getClassFeatures: () => DATA.classFeature,
		getSubclassFeatures: () => subclassFeatures,
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
		processPendingFeatureChoices: jest.fn().mockResolvedValue(undefined),
	};
}

function makeRest (state, opts) {
	const page = getPage(state, opts);
	const rest = Object.create(CharacterSheetRest.prototype);
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

function addInventoryItem (state, item, equipped = false) {
	state.addItem(item, 1, equipped, false);
	const row = state.getItems().find(candidate =>
		candidate.name === item.name
		&& candidate.source === item.source);
	if (!row) throw new Error(`Inventory row was not added for ${item.name}|${item.source}`);
	return row;
}

function seedEfaArmorer ({model = "Guardian", bind = true} = {}) {
	const state = new CharacterSheetState();
	const classData = DATA.class.find(it => it.name === "Artificer" && it.source === "EFA");
	const subclassData = DATA.subclass.find(it =>
		it.name === "Armorer"
		&& it.source === "EFA"
		&& it.className === "Artificer"
		&& it.classSource === "EFA");
	state.addClass({
		...copy(classData),
		level: 3,
		subclass: copy(subclassData),
	});
	for (let classLevel = 1; classLevel <= 3; ++classLevel) {
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel,
			choices: classLevel === 3
				? {subclass: {name: "Armorer", shortName: "Armorer", source: "EFA"}}
				: {},
			complete: true,
		});
	}
	state.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
	const page = getPage(state);
	CharacterSheetClassUtils.replaceStructuredFeatureChoice({
		state,
		page,
		characterLevel: 3,
		classLevel: 3,
		className: "Artificer",
		classSource: "EFA",
		subclassName: "Armorer",
		subclassShortName: "Armorer",
		subclassSource: "EFA",
		parentFeature: "Armor Model",
		parentSource: "EFA",
		choiceIndex: 0,
		newOption: getEfaOption(model),
		catalogs: {
			classFeatures: DATA.classFeature,
			subclassFeatures: DATA.subclassFeature,
			optionalFeatures: [],
		},
		persistHistory: true,
		recalculate: true,
		syncCanonical: true,
	});

	state.addToolProficiency("Smith's Tools");
	const tools = addInventoryItem(state, getBaseItem("Smith's Tools"));
	const armor = addInventoryItem(state, getBaseItem("Plate Armor"), true);
	if (bind) expect(state.bindEfaArcaneArmor(armor.id)).toMatchObject({ok: true});
	return {state, armor, tools};
}

function getGeneratedRows (state) {
	return state.getItems()
		.filter(item => item._efaArmorerWeaponId)
		.sort((a, b) => a._efaArmorerWeaponId.localeCompare(b._efaArmorerWeaponId));
}

function expectOneModelEverywhere (state, modelName) {
	expect(state.getEfaArmorerModel()).toMatchObject({name: modelName, source: "EFA"});
	expect(state.getFeatures().filter(feature =>
		feature.parentFeature === "Armor Model"
		&& feature.source === "EFA"
		&& MODEL_NAMES.includes(feature.name),
	)).toEqual([expect.objectContaining({name: modelName})]);
	expect(state.getChosenSubfeatures().filter(record =>
		record.parent === "Armor Model"
		&& record.parentSource === "EFA"
		&& record.parentClass === "Artificer"
		&& record.parentClassSource === "EFA"
		&& Number(record.level) === 3,
	)).toEqual([expect.objectContaining({name: modelName, source: "EFA"})]);

	const history = state.getLevelHistory().find(entry =>
		entry.class?.name === "Artificer"
		&& entry.class?.source === "EFA"
		&& Number(entry.classLevel) === 3);
	expect(history.choices.featureChoices.filter(choice => choice.featureName === "Armor Model")).toEqual([
		expect.objectContaining({
			choice: modelName,
			source: "EFA",
			ref: `${modelName}|Artificer|EFA|Armorer|EFA|3|EFA`,
		}),
	]);
	expect(history.choices.replayData.featureChoices.filter(choice => choice.parentFeature === "Armor Model")).toEqual([
		expect.objectContaining({name: modelName, source: "EFA"}),
	]);
	expect(history.decisions.find(decision =>
		decision.type === "featureChoice"
		&& decision.sourceKey === "Armor Model",
	)).toMatchObject({
		semanticKey: "artificer|efa:cl3:featurechoice:armor-model:slot0",
		status: "resolved",
		selection: [expect.objectContaining({choice: modelName, source: "EFA"})],
		receipt: {
			effects: expect.arrayContaining([
				expect.objectContaining({
					type: "materialized",
					features: [expect.objectContaining({name: modelName, source: "EFA"})],
				}),
			]),
		},
	});
}

describe("EFA Armorer Armor Model rest switching", () => {
	it("wires the same staged helper into both Short and Long Rest confirmation paths", () => {
		expect(REST_SOURCE).toContain("this._buildEfaArmorModelSection({restType: \"short\"})");
		expect(REST_SOURCE).toContain("this._buildEfaArmorModelSection({restType: \"long\"})");
		expect(REST_SOURCE.match(/armorModelSwitch\?\.apply\(\)/g)).toHaveLength(2);
	});

	it.each([
		["short", "Dreadnaught"],
		["long", "Infiltrator"],
	])("stages and commits an exact canonical model on %s rest", (restType, targetModel) => {
		const {state, armor} = seedEfaArmorer();
		const {rest} = makeRest(state);
		const before = copy(state.toJson());
		const speedBefore = state.getWalkSpeed();
		const staged = rest._buildEfaArmorModelSection({restType});

		expect(staged).toBeTruthy();
		expect(state.toJson()).toEqual(before);
		staged.control.value = targetModel;
		expect(state.toJson()).toEqual(before);

		const outcome = staged.apply();
		expect(outcome).toEqual({
			changed: true,
			oldLabel: "Guardian",
			newLabel: targetModel,
			boundName: "Plate Armor",
			error: null,
		});
		expectOneModelEverywhere(state, targetModel);
		if (targetModel === "Infiltrator") {
			expect(state.getWalkSpeed()).toBe(speedBefore + 5);
			expect(state.getAdvantageState("skill:stealth")).toMatchObject({cancelled: true});
			expect(state._data.namedModifiers.filter(modifier => modifier.type === "speed:walk")).toEqual([
				expect.objectContaining({
					name: expect.stringContaining("Powered Steps"),
					value: 5,
					sourceType: "item",
				}),
			]);
			state.setItemEquipped(armor.id, false);
			expect(state.getWalkSpeed()).toBe(speedBefore);
		}
		expect(CharacterSheetRest.getEfaArmorModelRestFeedback(outcome)).toEqual({
			successSuffix: ` Armor Model changed from Guardian to ${targetModel} on Plate Armor.`,
			warning: null,
		});
	});

	it("keeps cancel/staging read-only and treats the current model as a valid no-op", () => {
		const {state} = seedEfaArmorer();
		const {rest} = makeRest(state);
		const before = copy(state.toJson());
		const staged = rest._buildEfaArmorModelSection({restType: "short"});

		staged.control.value = "Dreadnaught";
		expect(state.toJson()).toEqual(before);
		staged.control.value = "Guardian";
		expect(staged.apply()).toEqual({
			changed: false,
			oldLabel: "Guardian",
			newLabel: "Guardian",
			boundName: "Plate Armor",
			error: null,
		});
		expect(state.toJson()).toEqual(before);
	});

	it.each([
		[
			"missing binding",
			({state}) => state.clearEfaArcaneArmorBinding(),
			"arcane-armor-not-bound",
			"Bind Arcane Armor",
			false,
		],
		[
			"missing proficiency",
			({state}) => state.removeToolProficiency("Smith's Tools"),
			"missing-smiths-tools-proficiency",
			"Smith's Tools proficiency",
			true,
		],
		[
			"missing canonical tools item",
			({state, tools}) => state.removeItem(tools.id),
			"missing-smiths-tools-item",
			"canonical Smith's Tools item",
			true,
		],
	])("keeps the section visible but disables switching for %s", (_label, mutate, code, statusText, bindingStaysActive) => {
		const setup = seedEfaArmorer();
		mutate(setup);
		if (bindingStaysActive) {
			expect(setup.state.getEfaArcaneArmorBindingStatus()).toMatchObject({
				boundItemId: setup.armor.id,
				active: true,
				suspended: false,
			});
		}
		const {rest} = makeRest(setup.state);
		const staged = rest._buildEfaArmorModelSection({restType: "long"});

		expect(staged).toBeTruthy();
		expect(staged.control.disabled).toBe(true);
		expect(staged.statusLine.textContent).toContain(statusText);
		staged.control.value = "Infiltrator";
		expect(staged.apply()).toMatchObject({
			changed: false,
			oldLabel: "Guardian",
			newLabel: "Guardian",
			error: {code},
		});
		expectOneModelEverywhere(setup.state, "Guardian");
	});

	it("allows switching while the bound armor is doffed and preserves its wrapper binding", () => {
		const {state, armor} = seedEfaArmorer();
		state.setItemEquipped(armor.id, false);
		const {rest} = makeRest(state);
		const staged = rest._buildEfaArmorModelSection({restType: "short"});

		expect(staged.control.disabled).toBe(false);
		expect(staged.currentLine.textContent).toContain("doffed; binding persists");
		expect(staged.statusLine.textContent).toContain("benefits resume when it is worn");
		staged.control.value = "Dreadnaught";
		expect(staged.apply()).toMatchObject({changed: true, newLabel: "Dreadnaught"});
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({
			boundItemId: armor.id,
			active: false,
			suspended: true,
		});
	});

	it("revalidates stale prerequisites at confirm and returns explicit warning feedback", () => {
		const {state, tools} = seedEfaArmorer();
		const {rest} = makeRest(state);
		const staged = rest._buildEfaArmorModelSection({restType: "long"});
		expect(staged.control.disabled).toBe(false);
		staged.control.value = "Infiltrator";

		state.removeItem(tools.id);
		expect(state.getEfaArcaneArmorBindingStatus()).toMatchObject({active: true, suspended: false});
		const outcome = staged.apply();

		expect(outcome).toMatchObject({
			changed: false,
			oldLabel: "Guardian",
			newLabel: "Guardian",
			error: {code: "missing-smiths-tools-item"},
		});
		expect(CharacterSheetRest.getEfaArmorModelRestFeedback(outcome).warning)
			.toBe("Rest completed, but Armor Model remained Guardian: A canonical Smith's Tools item from PHB or XPHB must be in inventory.");
		expectOneModelEverywhere(state, "Guardian");
	});

	it("rebuilds the replacement receipt from live state without reducing resource effects", () => {
		const {state} = seedEfaArmorer();
		const subclassFeatures = DATA.subclassFeature.map(feature =>
			feature.name === "Dreadnaught"
			&& feature.source === "EFA"
			&& feature.className === "Artificer"
			&& feature.classSource === "EFA"
			&& feature.subclassShortName === "Armorer"
				? {
					...copy(feature),
					uses: {max: 2, current: 2, recharge: "long"},
				}
				: feature);
		const stampSpy = jest.spyOn(CharacterSheetProgression, "_stampAcquisitionReceipts");
		const {rest} = makeRest(state, {subclassFeatures});
		const staged = rest._buildEfaArmorModelSection({restType: "short"});
		staged.control.value = "Dreadnaught";

		expect(staged.apply()).toMatchObject({changed: true, newLabel: "Dreadnaught"});
		expect(stampSpy).toHaveBeenCalled();
		const decision = state.getLevelHistoryEntry(3).decisions.find(item =>
			item.type === "featureChoice"
			&& item.sourceKey === "Armor Model");
		const materialized = decision.receipt.effects.find(effect => effect.type === "materialized");
		expect(materialized).toMatchObject({
			features: [expect.objectContaining({name: "Dreadnaught", source: "EFA"})],
			resources: [expect.objectContaining({
				name: "Dreadnaught",
				sourceDecisionKey: decision.semanticKey,
			})],
		});
		stampSpy.mockRestore();
	});

	it("preserves binding/generated row identities and customization through switch and save/load", () => {
		const {state, armor} = seedEfaArmorer();
		const initialIds = Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]));
		const guardian = getGeneratedRows(state)
			.find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		state.replaceItem(guardian.id, {
			...guardian,
			name: "Customized Thunder Knuckle",
			customAttackBonus: 2,
		});
		const {rest} = makeRest(state);
		const staged = rest._buildEfaArmorModelSection({restType: "short"});
		staged.control.value = "Infiltrator";

		expect(staged.apply()).toMatchObject({changed: true, newLabel: "Infiltrator"});
		expectOneModelEverywhere(state, "Infiltrator");
		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBe(armor.id);
		expect(Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(getGeneratedRows(state).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian))
			.toMatchObject({name: "Customized Thunder Knuckle", customAttackBonus: 2});

		const restored = new CharacterSheetState();
		restored.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
		expect(restored.loadFromJson(copy(state.toJson()))).not.toBe(false);
		restored.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
		expectOneModelEverywhere(restored, "Infiltrator");
		expect(restored.getEfaArcaneArmorBindingStatus().boundItemId).toBe(armor.id);
		expect(Object.fromEntries(getGeneratedRows(restored)
			.map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(getGeneratedRows(restored).find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian))
			.toMatchObject({name: "Customized Thunder Knuckle", customAttackBonus: 2});
	});

	it("Undo Rest restores the previous canonical model and active generated row", () => {
		const {state, armor} = seedEfaArmorer();
		const initialIds = Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]));
		const {rest, page} = makeRest(state);
		rest._captureRestSnapshot("short");
		const staged = rest._buildEfaArmorModelSection({restType: "short"});
		staged.control.value = "Dreadnaught";
		expect(staged.apply()).toMatchObject({changed: true});
		expectOneModelEverywhere(state, "Dreadnaught");

		expect(rest._onUndoRest()).toBe(true);
		expectOneModelEverywhere(state, "Guardian");
		expect(state.getEfaArcaneArmorBindingStatus().boundItemId).toBe(armor.id);
		expect(Object.fromEntries(getGeneratedRows(state)
			.map(item => [item._efaArmorerWeaponId, item.id]))).toEqual(initialIds);
		expect(state.getFeatureGrantedAttacks()
			.filter(attack => attack._efaArmorerWeaponId)
			.map(attack => attack._efaArmorerWeaponId)).toEqual([MODEL_IDS.Guardian]);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});

	it.each([
		["TCE Armorer", "TCE", "TCE", "Armorer"],
		["same-name subclass collision", "EFA", "EFA", "Armorist"],
	])("does not surface for %s", (_label, classSource, subclassSource, subclassName) => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Artificer",
			source: classSource,
			level: 3,
			subclass: {
				name: subclassName,
				shortName: subclassName,
				source: subclassSource,
			},
		});
		const {rest} = makeRest(state);
		expect(rest._buildEfaArmorModelSection({restType: "short"})).toBeNull();
	});

	it("uses exact model data rather than editable generated weapon names", () => {
		const {state} = seedEfaArmorer();
		const guardian = getGeneratedRows(state)
			.find(item => item._efaArmorerWeaponId === MODEL_IDS.Guardian);
		state.replaceItem(guardian.id, {...guardian, name: "Renamed Gauntlet"});
		const {rest} = makeRest(state);
		const staged = rest._buildEfaArmorModelSection({restType: "long"});

		expect(staged.control.children.map(option => option.textContent)).toEqual(MODEL_NAMES);
		expect(staged.control.children.map(option => option.value)).toEqual(MODEL_NAMES);
	});

	it("updates the durable model preview on native change without mutating state", () => {
		const {state} = seedEfaArmorer();
		const {rest} = makeRest(state);
		const before = copy(state.toJson());
		const staged = rest._buildEfaArmorModelSection({restType: "long"});

		expect(staged.previewLine.textContent)
			.toBe("Selected model: Guardian. Thunder Pulse (melee); Defensive Field while Bloodied.");
		for (const [model, preview] of [
			["Dreadnaught", "Selected model: Dreadnaught. Force Demolisher (melee, Reach); Giant Stature."],
			["Infiltrator", "Selected model: Infiltrator. Lightning Launcher (90/300); +5 Speed and Stealth Advantage."],
		]) {
			staged.control.value = model;
			staged.control._handlers.change();
			expect(staged.previewLine.textContent).toBe(preview);
		}
		expect(state.toJson()).toEqual(before);
	});

	it("renders a native labeled full-width select with described current, preview, and disabled states", () => {
		const {state} = seedEfaArmorer();
		state.clearEfaArcaneArmorBinding();
		const {rest} = makeRest(state);
		const staged = rest._buildEfaArmorModelSection({restType: "short"});

		expect(staged.section.children[0].textContent).toBe("Armor Model");
		expect(staged.control.tag).toBe("select");
		expect(staged.control._clazz).toContain("w-100");
		expect(staged.label.htmlFor).toBe(staged.control.id);
		expect(staged.previewLine.id).toBeTruthy();
		expect(staged.control.ariaDescribedBy)
			.toBe(`${staged.currentLine.id} ${staged.previewLine.id} ${staged.statusLine.id}`);
		expect(staged.control.disabled).toBe(true);
		expect(staged.statusLine.textContent).toContain("Bind Arcane Armor");
	});
});
