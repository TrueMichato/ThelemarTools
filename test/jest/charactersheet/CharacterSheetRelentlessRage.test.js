import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const barbarianData = JSON.parse(fs.readFileSync(new URL("../../../data/class/class-barbarian.json", import.meta.url)));
const tgttData = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));

const makeBarbarian = (source, level = 11) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("con", 16);
	state.addClass({name: "Barbarian", source, level});
	state._data.saveProficiencies = ["con"];
	const feature = barbarianData.classFeature.find(it =>
		it.name === "Relentless Rage" && it.source === (source === "TGTT" ? "XPHB" : source),
	);
	state.addFeature({...feature, description: feature.entries.join(" ")});
	state.setHp(10, 70);
	return state;
};

const finishRest = (state, type) => {
	const rest = Object.create(CharacterSheetRest.prototype);
	rest._state = state;
	rest._restoreResources(type);
};

describe("Relentless Rage from PHB, XPHB and TGTT", () => {
	it("uses the exact class feature UIDs and has no per-rest use pool or Use button", () => {
		for (const source of ["PHB", "XPHB", "TGTT"]) {
			const classData = source === "TGTT" ? tgttData.class : barbarianData.class;
			const cls = classData.find(it => it.name === "Barbarian" && it.source === source);
			expect(cls.classFeatures).toContain(`Relentless Rage|Barbarian|${source === "PHB" ? "" : "XPHB"}|11`);
			const granted = CharacterSheetClassUtils.getLevelFeatures(
				cls, 11, null, barbarianData.classFeature,
			).find(it => it.name === "Relentless Rage");
			expect(granted).toMatchObject({
				name: "Relentless Rage",
				className: "Barbarian",
				classSource: source === "PHB" ? "PHB" : "XPHB",
				source: source === "PHB" ? "PHB" : "XPHB",
				level: 11,
			});
			const state = makeBarbarian(source);
			expect(state.getFeatures().find(it => it.name === "Relentless Rage").uses).toBeUndefined();
			expect(state.getResources().filter(it => it.name === "Relentless Rage")).toEqual([]);
			expect(state.getActivatableFeatures().some(it => it.feature.name === "Relentless Rage")).toBe(false);
		}
	});

	it.each([
		["PHB", 1],
		["XPHB", 22],
		["TGTT", 22],
	])("%s offers a CON save only while raging and recovers to %i HP", (source, hp) => {
		const state = makeBarbarian(source);
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(10);
		state.takeDamage(10);
		expect(state.getPendingZeroHpIntervention()).toBeNull();

		state.setHp(10, 70);
		state.activateState("rage");
		state.takeDamage(10);
		const offer = state.getPendingZeroHpIntervention().interventions.find(it => it.id === "relentlessRage");
		expect(offer).toMatchObject({available: true, saveAbility: "con", dc: 10, hpOnSuccess: hp, usesMax: null});
		const result = state.applyZeroHpIntervention("relentlessRage", {total: 10});
		expect(result).toMatchObject({committed: true, success: true, hp});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(15);
		expect(state.getResources().filter(it => it.name === "Relentless Rage")).toEqual([]);
	});

	it("raises the DC after each attempt, including a failure, without consuming a use", () => {
		const state = makeBarbarian("XPHB");
		state.activateState("rage");
		state.takeDamage(10);
		expect(state.applyZeroHpIntervention("relentlessRage", {total: 10}).hp).toBe(22);
		state.setHp(10, 70);
		state.takeDamage(10);
		expect(state.getPendingZeroHpIntervention().interventions.find(it => it.id === "relentlessRage").dc).toBe(15);
		expect(state.applyZeroHpIntervention("relentlessRage", {total: 14})).toMatchObject({success: false, hp: 0});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(20);
		expect(state.isStateTypeActive("rage")).toBe(false);
		expect(state.getFeatures().find(it => it.name === "Relentless Rage").uses).toBeUndefined();
	});

	it("does not offer a save on outright death, and a declined offer does not raise the DC", () => {
		const state = makeBarbarian("PHB");
		state.activateState("rage");
		state.takeDamage(80);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(10);

		const declining = makeBarbarian("PHB");
		declining.activateState("rage");
		declining.takeDamage(10);
		expect(declining.getPendingZeroHpIntervention()).not.toBeNull();
		declining.cancelZeroHpIntervention("relentlessRage");
		expect(declining.isStateTypeActive("rage")).toBe(false);
		expect(declining.getFeatureCalculations().relentlessRageDc).toBe(10);
	});

	it("persists the rising DC across saves and resets on both short and long rests", () => {
		const state = makeBarbarian("TGTT");
		state.activateState("rage");
		state.takeDamage(10);
		state.applyZeroHpIntervention("relentlessRage", {total: 10});
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getFeatureCalculations().relentlessRageDc).toBe(15);
		finishRest(restored, "short");
		expect(restored.getFeatureCalculations().relentlessRageDc).toBe(10);
		restored.setHp(10, 70);
		restored.activateState("rage");
		restored.takeDamage(10);
		restored.applyZeroHpIntervention("relentlessRage", {total: 10});
		finishRest(restored, "long");
		expect(restored.getFeatureCalculations().relentlessRageDc).toBe(10);
	});

	it("resets the rising DC through both committed state rest APIs, not just the rest dialog", () => {
		const state = makeBarbarian("XPHB");
		state.activateState("rage");
		state.takeDamage(10);
		state.applyZeroHpIntervention("relentlessRage", {total: 10});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(15);
		expect(state.onShortRest()).toMatchObject({ok: true});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(10);
		state.setHp(10, 70);
		state.activateState("rage");
		state.takeDamage(10);
		state.applyZeroHpIntervention("relentlessRage", {total: 10});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(15);
		expect(state.onLongRest()).toMatchObject({ok: true});
		expect(state.getFeatureCalculations().relentlessRageDc).toBe(10);
	});

	it("permits a short rest to reset the DC even at full HP with no Hit Dice left", async () => {
		const state = makeBarbarian("XPHB");
		state.activateState("rage");
		state.takeDamage(10);
		state.applyZeroHpIntervention("relentlessRage", {total: 10});
		state.heal(1000);
		state.getHitDice = () => [];
		expect(state.getHp().current).toBe(state.getHp().max);
		const modal = jest.spyOn(CharacterSheetModal, "pGetShow").mockRejectedValue(new Error("rest dialog reached"));
		try {
			const rest = Object.create(CharacterSheetRest.prototype);
			rest._state = state;
			await expect(rest._showShortRestDialog()).rejects.toThrow("rest dialog reached");
		} finally {
			modal.mockRestore();
		}
	});

	it("does not borrow a same-named feature from the wrong Barbarian edition", () => {
		const state = makeBarbarian("XPHB");
		const feature = state._data.features.find(it => it.name === "Relentless Rage");
		feature.source = "PHB";
		feature.classSource = "PHB";
		state.activateState("rage");
		state.takeDamage(10);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});

	it("migrates only the spurious Relentless Rage use and resource from old saves", () => {
		const state = makeBarbarian("TGTT");
		const old = state.toJson();
		const feature = old.features.find(it => it.name === "Relentless Rage");
		feature.uses = {current: 1, max: 2, recharge: "short"};
		old.resources.push({id: "legacy-rage", featureId: feature.id, name: "Relentless Rage", current: 1, max: 2});
		old.resources.push({id: "unrelated", name: "Other Rage", current: 1, max: 2});
		old.resources.push({id: "foreign-rage", featureId: "foreign", name: "Relentless Rage", current: 1, max: 2});
		const restored = new CharacterSheetState();
		restored.loadFromJson(old);
		expect(restored.getFeatures().find(it => it.id === feature.id).uses).toBeUndefined();
		expect(restored.getResources().map(it => it.id)).not.toContain("legacy-rage");
		expect(restored.getResources().map(it => it.id)).toContain("unrelated");
		expect(restored.getResources().map(it => it.id)).toContain("foreign-rage");
	});

	it.each([
		["missing", undefined],
		["null", null],
		["empty", ""],
		["blank", "   "],
	])("preserves unowned resources when the legacy Relentless Rage feature ID is %s", (_, legacyId) => {
		const old = makeBarbarian("TGTT").toJson();
		const feature = old.features.find(it => it.name === "Relentless Rage");
		if (legacyId === undefined) delete feature.id;
		else feature.id = legacyId;
		feature.uses = {current: 1, max: 2, recharge: "short"};
		old.resources.push(
			{id: "ambiguous-rage", featureId: legacyId, name: "Relentless Rage", current: 1, max: 2},
			{id: "unowned-rage", name: "Relentless Rage", current: 1, max: 2},
			{id: "unowned-custom", name: "Custom Mana", current: 4, max: 4},
			{id: "unowned-null", featureId: null, name: "Other Pool", current: 3, max: 3},
			{id: "foreign-rage", featureId: "different-owner", name: "Relentless Rage", current: 1, max: 2},
		);
		const oldResourceIds = old.resources.map(it => it.id);

		const restored = new CharacterSheetState();
		restored.loadFromJson(old);
		expect(restored.getFeatures().find(it => it.name === "Relentless Rage").uses).toBeUndefined();
		expect(restored.getResources().map(it => it.id)).toEqual(expect.arrayContaining(oldResourceIds));
	});
});
