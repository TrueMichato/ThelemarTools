import {jest} from "@jest/globals";
import "./setup.js";
import fs from "node:fs";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const TGTT = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const ACTS = new Map(
	TGTT.optionalfeature
		.filter(feature => feature.featureType?.includes("JA"))
		.map(feature => [feature.name, feature]),
);
const JESTER = TGTT.subclass.find(sc => sc.name === "College of Jesters" && sc.source === "TGTT");

let CharacterSheetPage;

beforeAll(async () => {
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

function addAct (state, name) {
	const act = ACTS.get(name);
	state.addFeature({...act, featureType: "Optional Feature", optionalFeatureTypes: ["JA"]});
	return state.getFeature(name);
}

function makePage () {
	const state = new globalThis.CharacterSheetState();
	state.addClass({name: "Bard", source: "TGTT", level: 14, subclass: JESTER});
	const toasts = [];
	globalThis.JqueryUtil = {doToast: payload => toasts.push(payload)};

	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._combatModule = null;
	page._features = {_renderResources: jest.fn(), render: jest.fn()};
	page._spells = {render: jest.fn()};
	page._saveCurrentCharacter = jest.fn(async () => {});
	page._renderResources = jest.fn();
	page._renderActiveStates = jest.fn();
	page._renderCompanions = jest.fn();
	page._renderCharacter = jest.fn();
	return {page, state, toasts};
}

describe("College of Jesters controller activation", () => {
	it("turns a free target-facing Act Use into an observable resolution", async () => {
		const {page, state} = makePage();
		const feature = addAct(state, "Pantomime");
		const row = state.getActivatableFeatures().find(it => it.feature.id === feature.id);
		const present = jest.spyOn(page, "_pPresentTargetResolution");

		await page._activateFeatureState(feature, row.stateTypeId, row.activationInfo.stateType, row.resource, 0, row.activationInfo);

		expect(present).toHaveBeenCalledWith(feature, expect.objectContaining({
			saveAbility: "wis",
			summary: expect.stringMatching(/charmed/i),
		}), {dc: expect.any(Number)});
		expect(state.getActiveStates().some(it => it.sourceFeatureId === feature.id)).toBe(false);
	});

	it("activates Jester's Agility with its duration and AC effect", async () => {
		const {page, state} = makePage();
		const feature = addAct(state, "Jester's Agility");
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});
		const before = state.getResources().find(it => it.name === "Bardic Inspiration").current;
		const row = state.getActivatableFeatures().find(it => it.feature.id === feature.id);

		state.startCombat();
		await page._activateFeatureState(feature, row.stateTypeId, row.activationInfo.stateType, row.resource, 1, row.activationInfo);

		const active = state.getActiveStates().find(it => it.sourceFeatureId === feature.id);
		expect(active).toMatchObject({
			name: "Jester's Agility",
			duration: "until the start of your next turn",
			roundsRemaining: 1,
		});
		expect(active.customEffects).toContainEqual(expect.objectContaining({type: "bonus", target: "ac", useProficiency: true}));
		expect(state.getResources().find(it => it.name === "Bardic Inspiration").current).toBe(before - 1);
		expect(state.getAC()).toBeGreaterThan(10);
		state.advanceRound();
		expect(state.getActiveStates().some(it => it.sourceFeatureId === feature.id && it.active)).toBe(false);
	});

	it("casts Jester's Jaunt through the generic resource-cast spell pipeline", async () => {
		const {page, state} = makePage();
		const feature = addAct(state, "Jester's Jaunt");
		state.setSpellData([
			{name: "Mirror Image", source: "PHB", level: 2, time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "self"}}, duration: [{type: "timed", duration: {type: "minute", amount: 1}}], components: {v: true, s: true}},
		]);
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});

		await page._pUseFeatureAbility(feature);

		expect(state.getResources().find(it => it.name === "Bardic Inspiration").current).toBe(4);
		expect(state.getActiveResourceCastSpells()).toContainEqual(expect.objectContaining({
			spell: "Mirror Image",
			grantedBy: "Jester's Jaunt",
		}));
	});

	it("arms Laughing Lunge as a one-shot next-attack rider", async () => {
		const {page, state} = makePage();
		const feature = addAct(state, "Laughing Lunge");
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});
		const row = state.getActivatableFeatures().find(it => it.feature.id === feature.id);

		await page._activateFeatureState(feature, row.stateTypeId, row.activationInfo.stateType, row.resource, row.resourceCost, row.activationInfo);

		expect(state.getResources().find(it => it.name === "Bardic Inspiration").current).toBe(4);
		expect(state.getPendingAttackRiders()).toEqual([
			expect.objectContaining({
				source: "Laughing Lunge",
				advantage: true,
				damageDice: "1d6",
				damageType: "psychic",
			}),
		]);
	});

	it("does not spend Bardic Inspiration when the rider picker is cancelled", async () => {
		const {page, state} = makePage();
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});
		addAct(state, "Fool's Folly");
		const bi = state.getResources().find(it => it.name === "Bardic Inspiration");
		page._pChooseResourceUseAugment = jest.fn(async () => null);

		await page._pUseResource(bi.id);

		expect(state.getResources().find(it => it.name === "Bardic Inspiration").current).toBe(5);
	});

	it("uses one Bardic Inspiration and one Jester's Privilege use in one transaction", async () => {
		const {page, state} = makePage();
		const privilege = TGTT.subclassFeature.find(feature => feature.name === "Jester's Privilege");
		state.addFeature({
			...privilege,
			description: privilege.entries.join(" "),
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});
		const bi = state.getResources().find(it => it.name === "Bardic Inspiration");
		const augment = state.getResourceUseAugments("Bardic Inspiration").find(it => it.feature.name === "Jester's Privilege");
		page._pChooseResourceUseAugment = jest.fn(async () => augment);
		page._pResolveRolledSaveDc = jest.fn(async () => ({dc: 19}));
		const present = jest.spyOn(page, "_pPresentTargetResolution");

		await page._pUseResource(bi.id, {preselectedAugmentId: augment.feature.id});

		expect(state.getResources().find(it => it.id === bi.id).current).toBe(4);
		expect(state.getFeatureUses("Jester's Privilege")).toBe(0);
		expect(present).toHaveBeenCalledWith(augment.feature, expect.objectContaining({
			saveAbility: "wis",
			summary: expect.stringMatching(/charmed/i),
		}), {dc: 19});
	});
});
