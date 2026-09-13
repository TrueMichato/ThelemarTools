import "./setup.js";
import fs from "fs";
import path from "path";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	body: {classList: {add () {}, remove () {}}},
};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};

await import("../../../js/charactersheet/charactersheet-state.js");
await import("../../../js/charactersheet/charactersheet.js");

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetPage = globalThis.CharacterSheetPage;
const brew = JSON.parse(fs.readFileSync(path.resolve("homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const bellyDancerFeatures = brew.subclassFeature.filter(feature =>
	feature.subclassShortName === "Belly Dancer"
	&& feature.className === "Rogue",
);

function entriesToText (entries) {
	const out = [];
	const walk = entry => {
		if (typeof entry === "string") out.push(entry);
		else if (Array.isArray(entry)) entry.forEach(walk);
		else if (entry?.entries) walk(entry.entries);
		else if (entry?.items) walk(entry.items);
	};
	walk(entries);
	return out.join(" ");
}

function makeBellyDancer (level) {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", 18);
	state.setAbilityBase("cha", 16);
	state.setAbilityBase("con", 12);
	state.addClass({
		name: "Rogue",
		source: "PHB",
		level,
		subclass: {name: "The Belly Dancer", shortName: "Belly Dancer", source: "TGTT"},
	});
	bellyDancerFeatures.filter(feature => feature.level <= level).forEach(feature => {
		state.addFeature({
			name: feature.name,
			source: "TGTT",
			featureType: "Subclass",
			level: feature.level,
			description: entriesToText(feature.entries),
			className: "Rogue",
			subclassName: "The Belly Dancer",
			subclassShortName: "Belly Dancer",
		});
	});
	return state;
}

function getActivation (state, featureName) {
	const activatable = state.getActivatableFeatures().find(entry => entry.feature.name === featureName);
	if (!activatable) throw new Error(`Missing activatable feature: ${featureName}`);
	return {
		...activatable,
		stateType: activatable.activationInfo.stateType || CharacterSheetState.ACTIVE_STATE_TYPES[activatable.stateTypeId],
	};
}

function makePage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._saveCurrentCharacter = async () => {};
	page._renderResources = () => {};
	page._renderActiveStates = () => {};
	page._renderCharacter = () => {};
	page._features = null;
	return page;
}

describe("Belly Dancer activation transactions", () => {
	it("cancelling the L17 Dance target picker spends neither a use nor a Bonus Action", async () => {
		const state = makeBellyDancer(17);
		state.startCombat();
		const page = makePage(state);
		const activation = getActivation(state, "Dance of the Country");
		const beforeResource = activation.resource.current;
		let actionAttempts = 0;
		page._combat = {
			_tryConsumeStateToggleAction: () => {
				actionAttempts++;
				return true;
			},
		};
		page._pChooseActiveStateTargets = async () => null;

		await page._activateFeatureState(
			activation.feature,
			activation.stateTypeId,
			activation.stateType,
			activation.resource,
			activation.resource.cost,
			activation.activationInfo,
		);

		expect(state.isStateTypeActive("dancing")).toBe(false);
		expect(state.getResources().find(resource => resource.id === activation.resource.id).current).toBe(beforeResource);
		expect(actionAttempts).toBe(0);
	});

	it("a lost Tantalizing Shivers contest spends the Bonus Action but creates no state", async () => {
		const state = makeBellyDancer(9);
		state.startCombat();
		state.activateState("dancing");
		const page = makePage(state);
		const activation = getActivation(state, "Tantalizing Shivers");
		let actionAttempts = 0;
		page._combat = {
			_tryConsumeStateToggleAction: () => {
				actionAttempts++;
				return true;
			},
		};
		page._pChooseActiveStateTargets = async () => [{
			name: "Bandit Captain",
			source: "Tantalizing Shivers",
			statuses: ["Charmed", "Incapacitated", "Speed 0"],
			grantsAttackAdvantage: true,
		}];
		page._pResolveContestedCheck = async () => false;

		await page._activateFeatureState(
			activation.feature,
			activation.stateTypeId,
			activation.stateType,
			activation.resource,
			activation.resource?.cost ?? 0,
			activation.activationInfo,
		);

		expect(actionAttempts).toBe(1);
		expect(state.isStateTypeActive("tantalizingShivers")).toBe(false);
		expect(state.getActiveStateTargets("tantalizingShivers")).toEqual([]);
	});

	it("drains every persisted end-save prompt and saves each resolution", async () => {
		const state = makeBellyDancer(3);
		state.activateState("dancing");
		state.deactivateState("dancing", {reason: "manual"});
		state.activateState("dancing");
		state.deactivateState("dancing", {reason: "duration"});
		const page = makePage(state);
		const resolvedIds = [];
		let saveCount = 0;
		page._pResolveStateEndSave = async (_stateTypeId, {pendingId}) => {
			resolvedIds.push(pendingId);
			state.resolvePendingStateEndSave(pendingId, 20);
		};
		page._saveCurrentCharacter = async () => { saveCount++; };

		await page._pDrainPendingStateEndSaves();

		expect(resolvedIds).toHaveLength(2);
		expect(new Set(resolvedIds).size).toBe(2);
		expect(saveCount).toBe(2);
		expect(state.getPendingStateEndSaves()).toEqual([]);
	});
});
