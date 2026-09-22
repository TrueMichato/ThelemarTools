import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const EFA_STEEL_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const EFA_TOOLS_UID = "Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_STEEL_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const REANIMATOR_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";

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

const makeClass = (source = "EFA") => ({
	name: "Artificer",
	source,
	level: 3,
	subclass: {
		name: "Battle Smith",
		shortName: "Battle Smith",
		source,
	},
});

const makeSteelFeature = (source = "EFA") => ({
	name: "Steel Defender",
	source,
	className: "Artificer",
	classSource: source,
	subclassName: "Battle Smith",
	subclassShortName: "Battle Smith",
	subclassSource: source,
	level: 3,
	featureType: "Subclass",
	isSubclassFeature: true,
});

const makeToolsFeature = () => ({
	name: "Tools of the Trade",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	subclassName: "Battle Smith",
	subclassShortName: "Battle Smith",
	subclassSource: "EFA",
	level: 3,
	featureType: "Subclass",
	isSubclassFeature: true,
	description: "You gain proficiency with Smith's Tools. If you already have this proficiency, you gain proficiency with one other type of Artisan's Tools of your choice.",
});

const makeEfaState = ({preknowSmithsTools = false} = {}) => {
	const state = new CharacterSheetState();
	if (preknowSmithsTools) state.addToolProficiency("Smith's Tools");
	state.addClass(makeClass("EFA"));
	state.addFeature(makeToolsFeature());
	state.addFeature(makeSteelFeature("EFA"));
	return state;
};

const completeSetup = (state, overrides = {}) => {
	state.reconcileFeatureCompanionGrants({reason: "test"});
	return state.completeFeatureCompanionSetup(EFA_STEEL_UID, {
		nickname: "Rivet",
		appearance: "A broad-shouldered iron hound with etched brass plates.",
		locomotion: "fourLegs",
		...overrides,
	});
};

const getFeature = (state, uid) => state.getFeatures()
	.find(feature => CharacterSheetState.getSourceAwareFeatureUid(feature).toLowerCase() === uid.toLowerCase());

const switchExactBattleSmithSource = (state, source) => {
	for (const feature of [...state.getFeatures()]) {
		const uid = CharacterSheetState.getSourceAwareFeatureUid(feature);
		if ([EFA_STEEL_UID, EFA_TOOLS_UID, TCE_STEEL_UID].some(expected => expected.toLowerCase() === uid.toLowerCase())) {
			state.removeFeature(feature.id);
		}
	}
	const cls = state.getClasses()[0];
	cls.source = source;
	cls.subclass = {name: "Battle Smith", shortName: "Battle Smith", source};
	if (source === "EFA") state.addFeature(makeToolsFeature());
	state.addFeature(makeSteelFeature(source));
};

describe("EFA Battle Smith acquisition and setup", () => {
	test("registers only the exact EFA Tools of the Trade fallback and Steel Defender setup owner", () => {
		const fallback = CharacterSheetState.getFixedProficiencyFallbackDefinition(EFA_TOOLS_UID);
		expect(fallback).toMatchObject({
			ownerUid: EFA_TOOLS_UID,
			proficiencyType: "tool",
			fixedProficiency: "Smith's Tools",
			fallbackCatalog: "artisan",
			grantKey: "fixedToolProficiencyFallback",
		});
		expect(CharacterSheetState.getFeatureCompanionGrantDefinition(EFA_STEEL_UID)).toMatchObject({
			featureUid: EFA_STEEL_UID,
			fixedProficiencyOwnerUid: EFA_TOOLS_UID,
			compatibleFeatureUids: [TCE_STEEL_UID],
		});
		expect(CharacterSheetState.getFixedProficiencyFallbackDefinition(
			"Tools of the Trade|Artificer|TCE|Battle Smith|TCE|3|TCE",
		)).toBeNull();
		expect(CharacterSheetState.getFeatureCompanionGrantDefinition(REANIMATOR_UID)).toBeNull();
	});

	test("preserves fixed Smith's Tools or records the shared alternate artisan-tool transaction", () => {
		const fixed = makeEfaState();
		expect(fixed.getFeatureCompanionSetupToolState(EFA_STEEL_UID)).toEqual({
			status: "fixed",
			label: "Smith's Tools",
			options: [],
		});
		expect(fixed.hasToolProficiency("Smith's Tools")).toBe(true);

		const fallback = makeEfaState({preknowSmithsTools: true});
		const toolState = fallback.getFeatureCompanionSetupToolState(EFA_STEEL_UID);
		expect(toolState).toMatchObject({status: "pending"});
		expect(toolState.options).toContain("Tinker's Tools");
		expect(fallback.fulfillFeatureChoice(toolState.choiceId, "Tinker's Tools", [])).toBe(true);
		expect(fallback.getFeatureCompanionSetupToolState(EFA_STEEL_UID)).toEqual({
			status: "alternate",
			label: "Tinker's Tools",
			options: [],
		});
		expect(fallback.hasToolProficiency("Tinker's Tools")).toBe(true);
	});

	test("Finish later persists only entered setup data and creates no companion", () => {
		const state = makeEfaState();
		const acquisition = state.reconcileFeatureCompanionGrants({reason: "levelUpFinalization"});
		expect(acquisition).toMatchObject({needsPrompt: true, changed: true});
		expect(state.getCompanions()).toEqual([]);

		state.deferFeatureCompanionSetup(EFA_STEEL_UID, {appearance: "A steel bird."});
		expect(state.getFeatureCompanionSetupRecord(EFA_STEEL_UID)).toEqual({
			version: 1,
			ownerUid: EFA_STEEL_UID,
			status: "pending",
			eligibility: "active",
			choices: {appearance: "A steel bird."},
			companionId: null,
		});
		expect(state.getCompanions()).toEqual([]);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getFeatureCompanionSetupRecord(EFA_STEEL_UID))
			.toEqual(state.getFeatureCompanionSetupRecord(EFA_STEEL_UID));
		expect(restored.getCompanions()).toEqual([]);
	});

	test("validates required choices and creates one stable, idempotent feature-owned companion", () => {
		const state = makeEfaState();
		state.reconcileFeatureCompanionGrants({reason: "builderFinalization"});
		expect(() => state.completeFeatureCompanionSetup(EFA_STEEL_UID, {appearance: "Iron hound"}))
			.toThrow(/two legs or four legs/i);

		const first = completeSetup(state);
		expect(first).toMatchObject({
			name: "Steel Defender",
			source: "EFA",
			customName: "Rivet",
			featureGrant: {uid: EFA_STEEL_UID},
			setup: {
				nickname: "Rivet",
				appearance: "A broad-shouldered iron hound with etched brass plates.",
				locomotion: "fourLegs",
			},
			lifecycle: {status: "alive"},
		});
		expect(first.hp.current).toBe(first.hp.max);
		const stableId = first.id;

		state.reconcileFeatureCompanionGrants({reason: "load"});
		state.reconcileFeatureCompanionGrants({reason: "quickBuildFinalization"});
		const completedAgain = state.completeFeatureCompanionSetup(EFA_STEEL_UID, {
			appearance: "A polished iron hound.",
			locomotion: "fourLegs",
		});
		expect(completedAgain.id).toBe(stableId);
		expect(state.getFeatureOwnedCompanions(EFA_STEEL_UID)).toHaveLength(1);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		restored.reconcileFeatureCompanionGrants({reason: "load"});
		expect(restored.getFeatureOwnedCompanions(EFA_STEEL_UID)).toHaveLength(1);
		expect(restored.getFeatureOwnedCompanions(EFA_STEEL_UID)[0].id).toBe(stableId);
		expect(restored.getFeatureCompanionSetupRecord(EFA_STEEL_UID).status).toBe("complete");
	});

	test("repeated reconciliation never creates a duplicate companion record", () => {
		const state = makeEfaState();
		const companion = completeSetup(state);
		state.reconcileFeatureCompanionGrants({reason: "builderFinalization"});
		state.reconcileFeatureCompanionGrants({reason: "levelUpFinalization"});
		state.reconcileFeatureCompanionGrants({reason: "load"});
		expect(state.getFeatureOwnedCompanions(EFA_STEEL_UID).map(it => it.id)).toEqual([companion.id]);
	});

	test("setup synchronization preserves a dead companion's lifecycle and inactive state across reconcile/load", () => {
		const state = makeEfaState();
		const companion = completeSetup(state);
		companion.hp.current = 0;
		companion.active = false;
		companion.lifecycle = {
			status: "dead",
			generation: 4,
			diedAtGameMinute: 720,
			customLifecycleMarker: "preserve",
		};
		state.updateFeatureCompanionSetup(EFA_STEEL_UID, {
			nickname: "Bolts",
			appearance: "A compact iron hound with a cracked brass crest.",
			locomotion: "fourLegs",
		}, {status: "complete", eligibility: "active"});

		state.reconcileFeatureCompanionGrants({reason: "load"});
		const reconciled = state.getCompanion(companion.id);
		expect(reconciled.id).toBe(companion.id);
		expect(reconciled.customName).toBe("Bolts");
		expect(reconciled.active).toBe(false);
		expect(reconciled.hp.current).toBe(0);
		expect(reconciled.setup).toEqual({
			nickname: "Bolts",
			appearance: "A compact iron hound with a cracked brass crest.",
			locomotion: "fourLegs",
		});
		expect(reconciled.lifecycle).toEqual({
			status: "dead",
			generation: 4,
			diedAtGameMinute: 720,
			customLifecycleMarker: "preserve",
		});

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		restored.reconcileFeatureCompanionGrants({reason: "load"});
		const reloaded = restored.getCompanion(companion.id);
		expect(reloaded.id).toBe(companion.id);
		expect(reloaded.customName).toBe("Bolts");
		expect(reloaded.active).toBe(false);
		expect(reloaded.hp.current).toBe(0);
		expect(reloaded.lifecycle).toEqual({
			status: "dead",
			generation: 4,
			diedAtGameMinute: 720,
			customLifecycleMarker: "preserve",
		});
	});

	test("keeps EFA, TCE, and mixed-source Reanimator owners isolated when they coexist", () => {
		const state = makeEfaState();
		state.addClass(makeClass("TCE"));
		state.addFeature(makeSteelFeature("TCE"));
		const efa = completeSetup(state);
		const tceId = state.addCompanion({
			name: "Steel Defender",
			source: "TCE",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			origin: "Battle Smith",
			featureGrant: {uid: TCE_STEEL_UID},
		});
		const reanimatorId = state.addCompanion({
			name: "Reanimated Companion",
			source: "RHW",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			origin: "Reanimator",
			featureGrant: {uid: REANIMATOR_UID},
		});

		state.reconcileFeatureCompanionGrants({reason: "coexistence"});
		expect(state.getFeatureOwnedCompanions(EFA_STEEL_UID).map(it => it.id)).toEqual([efa.id]);
		expect(state.getFeatureOwnedCompanions(TCE_STEEL_UID).map(it => it.id)).toEqual([tceId]);
		expect(state.getFeatureOwnedCompanions(REANIMATOR_UID).map(it => it.id)).toEqual([reanimatorId]);
	});

	test("does not acquire EFA setup from the same-label TCE subclass feature", () => {
		const state = new CharacterSheetState();
		state.addClass(makeClass("TCE"));
		state.addFeature(makeSteelFeature("TCE"));

		const result = state.reconcileFeatureCompanionGrants({reason: "exactSourceGate"});
		expect(result.needsPrompt).toBe(false);
		expect(state.getFeatureCompanionSetupRecord(EFA_STEEL_UID)).toBeNull();
		expect(state.getFeatureOwnedCompanions(EFA_STEEL_UID)).toEqual([]);
	});

	test("load does not synthesize EFA pending setup for a compatible-only TCE defender", () => {
		const state = new CharacterSheetState();
		state.addClass(makeClass("TCE"));
		state.addFeature(makeSteelFeature("TCE"));
		const companionId = state.addCompanion({
			name: "Steel Defender",
			source: "TCE",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			origin: "Battle Smith",
			featureGrant: {uid: TCE_STEEL_UID},
			lifecycle: {status: "alive", generation: 1},
		});
		expect(state.getFeatureCompanionSetupRecord(TCE_STEEL_UID)).toBeNull();

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getCompanion(companionId)).toMatchObject({
			id: companionId,
			featureGrant: {uid: TCE_STEEL_UID},
		});
		expect(restored.getFeatureCompanionSetupRecord(TCE_STEEL_UID)).toBeNull();
		expect(restored.getFeatureCompanionSetupRecord(EFA_STEEL_UID)).toBeNull();
		expect(restored.getPendingFeatureCompanionSetups()).toEqual([]);
	});
});

describe("Battle Smith setup UI and lifecycle integration", () => {
	test("renders the persistent incomplete card and modal contract through CharacterSheetPage", () => {
		const page = Object.create(CharacterSheetPage.prototype);
		const html = page._getFeatureCompanionSetupIncompleteHtml({
			ownerUid: EFA_STEEL_UID,
			missingChoices: ["appearance", "two legs or four legs"],
		});
		expect(html).toContain(`role="status"`);
		expect(html).toContain("Battle Smith setup incomplete");
		expect(html).toContain("Missing: appearance, two legs or four legs.");
		expect(html).toContain("Finish setup");
		expect(html).toContain(`data-feature-companion-setup="${EFA_STEEL_UID}"`);
		expect(html).toContain(`aria-describedby=`);
		expect(html).toContain(`aria-atomic="true"`);

		const modalSource = CharacterSheetPage.prototype._pShowFeatureCompanionSetupModal.toString();
		for (const contract of [
			"Create your Steel Defender",
			"Finish later",
			"Create defender",
			"Appearance",
			"Nickname",
			"Two legs",
			"Four legs",
			"there is no statistical difference",
			"aria-live",
			"aria-required",
			"aria-describedby",
			"CharacterSheetModal.focusFirst",
			"getFocusRestoreTarget",
			"!appearance.value.trim()",
			"[name=steel-defender-locomotion]",
			"No unsaved choices were applied",
		]) expect(modalSource).toContain(contract);

		const pageSource = fs.readFileSync("js/charactersheet/charactersheet.js", "utf8");
		const htmlSource = fs.readFileSync("charactersheet.html", "utf8");
		const mobileCss = fs.readFileSync("css/charactersheet-mobile.css", "utf8");
		expect(pageSource).toContain("pShowFeatureCompanionSetup(featureUid");
		expect(htmlSource).toContain(`id="charsheet-companion-interaction-status"`);
		expect(htmlSource).toContain(`aria-live="polite"`);
		expect(mobileCss).toContain(".charsheet__feature-companion-setup .btn-feature-companion-setup");
		expect(mobileCss).toContain("min-height: 44px");
	});

	test("routes setup persistence and rendering through one public Page operation", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		const focusRestoreTarget = {id: "setup-trigger"};
		const replacementFocusTarget = {id: "replacement-trigger", isConnected: true, focus: jest.fn()};
		const getFocusRestoreTarget = jest.fn(() => replacementFocusTarget);
		page._pShowFeatureCompanionSetupModal = jest.fn(async () => "deferred");
		page.saveCharacter = jest.fn(async () => {});
		page.renderCharacter = jest.fn();
		page._announceCompanionInteraction = jest.fn();

		await expect(page.pShowFeatureCompanionSetup(EFA_STEEL_UID, {
			focusRestoreTarget,
			getFocusRestoreTarget,
		})).resolves.toBe("deferred");

		expect(page._pShowFeatureCompanionSetupModal).toHaveBeenCalledWith(EFA_STEEL_UID, {
			focusRestoreTarget,
			getFocusRestoreTarget,
		});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(page._announceCompanionInteraction).toHaveBeenCalledWith(
			"Steel Defender setup saved for later. No defender was created.",
			{type: "info", isToast: true},
		);
		await Promise.resolve();
		expect(replacementFocusTarget.focus).toHaveBeenCalledTimes(1);
	});

	test("reacquires setup focus at the pending trigger or created companion operation", () => {
		const page = Object.create(CharacterSheetPage.prototype);
		const pending = {
			getAttribute: name => name === "data-feature-companion-setup" ? EFA_STEEL_UID : null,
		};
		const operation = {id: "rend"};
		const card = {
			getAttribute: name => name === "data-companion-id" ? "defender-1" : null,
			querySelector: jest.fn(() => operation),
		};
		const previousDocument = globalThis.document;
		globalThis.document = {querySelectorAll: selector => selector === "[data-feature-companion-setup]" ? [pending] : [card]};
		try {
			expect(page.getFeatureCompanionSetupFocusTarget(EFA_STEEL_UID)).toBe(pending);
			globalThis.document.querySelectorAll = selector => selector === "[data-feature-companion-setup]" ? [] : [card];
			page._state = {getFeatureCompanionSetupRecord: () => ({companionId: "defender-1"})};
			expect(page.getFeatureCompanionSetupFocusTarget(EFA_STEEL_UID)).toBe(operation);
			expect(card.querySelector).toHaveBeenCalledWith(expect.stringContaining("[data-companion-operation-key]"));
		} finally {
			globalThis.document = previousDocument;
		}
	});

	test("reports setup persistence errors without rendering a success state", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._pShowFeatureCompanionSetupModal = jest.fn(async () => "complete");
		page.saveCharacter = jest.fn(async () => { throw new Error("Save failed"); });
		page.renderCharacter = jest.fn();
		page._announceCompanionInteraction = jest.fn();

		await expect(page.pShowFeatureCompanionSetup(EFA_STEEL_UID)).rejects.toThrow("Save failed");
		expect(page.renderCharacter).not.toHaveBeenCalled();
		expect(page._announceCompanionInteraction).toHaveBeenCalledWith(
			"Save failed",
			{type: "danger", isToast: true},
		);
	});

	test("keeps Play Mode setup on the shared Page operation and suppresses the exact EFA legacy route", () => {
		const source = fs.readFileSync("js/charactersheet/charactersheet-playmode.js", "utf8");
		expect(source).toContain("getPendingFeatureCompanionSetups");
		expect(source).toContain("pShowFeatureCompanionSetup");
		expect(source).toContain("getFeatureCompanionSetupFocusTarget");
		expect(source).toContain("EFA_BATTLE_SMITH_FEATURE_UIDS?.STEEL_DEFENDER");
		expect(source).toContain("&& !hasEfaSteelDefenderSetup");
	});

	test("prompts immediately when allowed and leaves deferred setup pending", async () => {
		const state = makeEfaState();
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = state;
		page._pShowFeatureCompanionSetupModal = jest.fn(async featureUid => {
			state.deferFeatureCompanionSetup(featureUid);
			return "deferred";
		});

		const result = await page.reconcileFeatureCompanionGrants({
			state,
			reason: "levelUpFinalization",
			allowPrompt: true,
		});
		expect(page._pShowFeatureCompanionSetupModal).toHaveBeenCalledWith(EFA_STEEL_UID);
		expect(result.needsPrompt).toBe(true);
		expect(state.getCompanions()).toEqual([]);
	});

	test("wires the shared operation through Builder, Level Up, Quick Build, load, and Respec", () => {
		const contracts = [
			["js/charactersheet/charactersheet-builder.js", "builderFinalization"],
			["js/charactersheet/charactersheet-levelup.js", "levelUpFinalization"],
			["js/charactersheet/charactersheet-quickbuild.js", "quickBuildFinalization"],
			["js/charactersheet/charactersheet.js", "classFeatureReconcile"],
			["js/charactersheet/charactersheet-respec.js", "respecCandidate"],
			["js/charactersheet/charactersheet-respec-engine.js", "respecApply"],
		];
		for (const [path, reason] of contracts) {
			const source = fs.readFileSync(path, "utf8");
			expect(source).toContain("reconcileFeatureCompanionGrants");
			expect(source).toContain(reason);
		}
	});
});

describe("Battle Smith Respec isolation and exact-source rebinding", () => {
	test("rebinds compatible EFA/TCE ownership without changing the companion ID, then marks a lost grant vanished", () => {
		const state = makeEfaState();
		const companion = completeSetup(state);

		switchExactBattleSmithSource(state, "TCE");
		state.reconcileFeatureCompanionGrants({reason: "respecCandidate"});
		expect(state.getFeatureOwnedCompanions(TCE_STEEL_UID)).toHaveLength(1);
		expect(state.getFeatureOwnedCompanions(TCE_STEEL_UID)[0].id).toBe(companion.id);
		expect(state.getFeatureCompanionSetupRecord(TCE_STEEL_UID)).toMatchObject({
			status: "complete",
			companionId: companion.id,
		});

		switchExactBattleSmithSource(state, "EFA");
		state.reconcileFeatureCompanionGrants({reason: "respecCandidate"});
		expect(state.getFeatureOwnedCompanions(EFA_STEEL_UID)[0].id).toBe(companion.id);

		const steel = getFeature(state, EFA_STEEL_UID);
		const tools = getFeature(state, EFA_TOOLS_UID);
		state.removeFeature(steel.id);
		state.removeFeature(tools.id);
		state.getClasses()[0].subclass = {name: "Alchemist", shortName: "Alchemist", source: "EFA"};
		state.reconcileFeatureCompanionGrants({reason: "respecCandidate"});
		expect(state.getCompanion(companion.id)).toMatchObject({
			id: companion.id,
			active: false,
			lifecycle: {status: "vanished"},
		});
		expect(state.getFeatureCompanionSetupRecord(EFA_STEEL_UID).eligibility).toBe("inactive");
	});

	test("keeps candidate mutation isolated and reconciles exact ownership again on atomic Apply", async () => {
		const live = makeEfaState();
		const companion = completeSetup(live);
		const before = live.toJson();

		const page = {
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getClasses: () => [],
			getFeats: () => [],
			getSkillsList: () => [],
			getSpells: () => [],
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
		};
		const engine = new CharacterSheetRespecEngine({page, state: live});
		engine.begin();
		await engine.stageCandidateMutation(({state}) => {
			switchExactBattleSmithSource(state, "TCE");
			state.reconcileFeatureCompanionGrants({reason: "respecCandidate"});
		});

		expect(live.toJson()).toEqual(before);
		expect(live.getFeatureOwnedCompanions(EFA_STEEL_UID)[0]).toMatchObject({
			id: companion.id,
			active: true,
		});
		expect(live.getFeatureOwnedCompanions(TCE_STEEL_UID)).toEqual([]);

		engine.getValidation = () => ({isValid: true, errors: []});
		await engine.apply();

		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(live.getFeatureOwnedCompanions(EFA_STEEL_UID)).toEqual([]);
		expect(live.getFeatureOwnedCompanions(TCE_STEEL_UID)[0]).toMatchObject({
			id: companion.id,
			active: true,
			featureGrant: {uid: TCE_STEEL_UID},
		});
	});
});
