import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetRest} from "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

const FLASH_UID = "Flash of Genius|Artificer|EFA";
const CLASS_UID = "Artificer|EFA";

function makeArtificer ({source = "EFA", level = 7, intelligence = 18, withFlashFeature = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
	state.addClass({name: "Artificer", source, level});
	if (source === "EFA" && level >= 7 && withFlashFeature) {
		state.addFeature({
			name: "Flash of Genius",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			level: 7,
			description: "Use your Reaction after a failed ability check or saving throw.",
		});
	}
	return state;
}

function getFlashResource (state) {
	return state.getResources().find(resource => resource.featureUid === FLASH_UID);
}

describe("EFA Artificer Milestone 1 source separation", () => {
	it("keeps TCE-only ritual, Tool Expertise, infusion, Savant, and Soul assumptions off EFA", () => {
		const efa = makeArtificer({level: 20});
		const tce = makeArtificer({source: "TCE", level: 20, withFlashFeature: false});
		const efaCalcs = efa.getFeatureCalculations();
		const tceCalcs = tce.getFeatureCalculations();

		expect(efaCalcs.hasRitualCasting).toBeUndefined();
		expect(efaCalcs.hasToolExpertise).toBeUndefined();
		expect(efaCalcs.infusionSlots).toBeUndefined();
		expect(efaCalcs.infusionsKnown).toBeUndefined();
		expect(efaCalcs.hasSoulOfArtifice).toBeUndefined();
		expect(efaCalcs.soulOfArtificeSaveBonus).toBeUndefined();
		expect(efaCalcs.magicItemSavantIgnoreRequirements).toBe(false);
		expect(efaCalcs.hasEfaSoulOfArtifice).toBe(true);
		expect(efaCalcs.hasMagicalGuidance).toBe(true);

		expect(tceCalcs.hasRitualCasting).toBe(true);
		expect(tceCalcs.hasToolExpertise).toBe(true);
		expect(tceCalcs.infusionSlots).toBe(6);
		expect(tceCalcs.infusionsKnown).toBe(12);
		expect(tceCalcs.hasSoulOfArtifice).toBe(true);
		expect(tceCalcs.soulOfArtificeSaveBonus).toBe(6);
		expect(tceCalcs.magicItemSavantIgnoreRequirements).toBe(true);

		const ritual = {name: "Identify", level: 1, ritual: true, prepared: true};
		expect(efa.canCastAsRitual(ritual)).toBe(false);
		expect(tce.canCastAsRitual(ritual)).toBe(true);
	});

	it("uses source-qualified registry effects for same-named EFA capstones", () => {
		const efa = makeArtificer({level: 20});
		efa.addFeature({name: "Magic Item Savant", source: "EFA", classSource: "EFA"});
		efa.addFeature({name: "Soul of Artifice", source: "EFA", classSource: "EFA"});
		const efaEffects = efa.getFeatureCalculations()._effects;
		expect(efaEffects).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "attunement", maxSlots: 5, ignoreRequirements: false}),
		]));
		expect(efaEffects).not.toEqual(expect.arrayContaining([
			expect.objectContaining({modType: "save:all"}),
		]));

		const tce = makeArtificer({source: "TCE", level: 20, withFlashFeature: false});
		tce.addFeature({name: "Magic Item Savant", source: "TCE", classSource: "TCE"});
		tce.addFeature({name: "Soul of Artifice", source: "TCE", classSource: "TCE"});
		const tceEffects = tce.getFeatureCalculations()._effects;
		expect(tceEffects).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "attunement", maxSlots: 5, ignoreRequirements: true}),
			expect.objectContaining({modType: "save:all", value: "attunedItems"}),
		]));
	});

	it.each([
		[1, 0, 0],
		[2, 4, 2],
		[5, 4, 2],
		[6, 5, 3],
		[9, 5, 3],
		[10, 6, 4],
		[13, 6, 4],
		[14, 7, 5],
		[17, 7, 5],
		[18, 8, 6],
		[20, 8, 6],
	])("projects plans and created-item caps at level %i", (level, plans, itemCap) => {
		const calcs = makeArtificer({level}).getFeatureCalculations();
		expect(calcs.artificerPlansKnown).toBe(plans);
		expect(calcs.artificerCreatedMagicItemsMax).toBe(itemCap);
	});

	it.each([
		[1, ["hasEfaArtificerSpellcasting"]],
		[2, ["hasReplicateMagicItem"]],
		[6, ["hasMagicItemTinker"]],
		[7, ["hasFlashOfGenius"]],
		[10, ["hasMagicItemAdept"]],
		[11, ["hasSpellStoringItem"]],
		[14, ["hasAdvancedArtifice", "hasRefreshedGenius"]],
		[18, ["hasMagicItemMaster"]],
		[20, ["hasEfaSoulOfArtifice", "hasMagicalGuidance"]],
	])("sets applicable EFA level flags at level %i", (level, flags) => {
		const calcs = makeArtificer({level}).getFeatureCalculations();
		for (const flag of flags) expect(calcs[flag]).toBe(true);
	});

	it("uses the exact EFA prepared-spell and cantrip tables for lean class saves", () => {
		const prepared = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
		for (let level = 1; level <= 20; level++) {
			const state = makeArtificer({level});
			expect(state.getMaxPreparedSpells("Artificer")).toBe(prepared[level - 1]);
			expect(state._getClassSpellcastingInfo(state.getClasses()[0])).toEqual(expect.objectContaining({
				preparedMax: prepared[level - 1],
				cantripsKnown: level >= 14 ? 4 : level >= 10 ? 3 : 2,
			}));
		}
	});

	it.each([
		[1, [2, 0, 0, 0, 0]],
		[5, [4, 2, 0, 0, 0]],
		[9, [4, 3, 2, 0, 0]],
		[13, [4, 3, 3, 1, 0]],
		[17, [4, 3, 3, 3, 1]],
		[20, [4, 3, 3, 3, 2]],
	])("uses the rounded-up Artificer slot grid at level %i", (level, expected) => {
		const slots = makeArtificer({level}).getSpellSlots();
		expect(expected.map((_, ix) => slots[ix + 1]?.max || 0)).toEqual(expected);
	});

	it("centralizes maximum Artificer spell level and routes Level Up/Quick Build through it", () => {
		const expected = [
			[0, 0], [1, 1], [4, 1], [5, 2], [8, 2], [9, 3],
			[12, 3], [13, 4], [16, 4], [17, 5], [20, 5],
		];
		for (const [level, spellLevel] of expected) {
			expect(CharacterSheetClassUtils.getMaxArtificerSpellLevel(level)).toBe(spellLevel);
			expect(CharacterSheetClassUtils.getMaxSpellLevelForClass("Artificer", level)).toBe(spellLevel);
			expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", level)).toBe(spellLevel);
		}

		for (const file of [
			"js/charactersheet/charactersheet-levelup.js",
			"js/charactersheet/charactersheet-quickbuild.js",
		]) {
			const source = fs.readFileSync(file, "utf8");
			expect(source).toContain("CharacterSheetClassUtils.getMaxSpellLevelFromProgression");
			expect(source).not.toMatch(/casterProg === "artificer"[\s\S]{0,120}Math\.(?:ceil|floor)/);
		}
	});

	it("routes live failed check/save and direct feature activations through the committed Flash API", () => {
		const source = fs.readFileSync("js/charactersheet/charactersheet.js", "utf8");
		for (const methodStart of [
			"async _rollAbilityCheck (",
			"async _rollSavingThrow (",
			"async _rollSkillCheck (",
		]) {
			const start = source.indexOf(methodStart);
			expect(start).toBeGreaterThan(-1);
			const body = source.slice(start, source.indexOf("\n\t}", start) + 3);
			expect(body).toContain("_pMaybeApplyEfaFlashOfGenius");
		}

		const activationStart = source.indexOf("async _activateFeatureState (");
		const activationBody = source.slice(activationStart, source.indexOf("\n\t}", activationStart) + 3);
		expect(activationBody.indexOf("_pActivateEfaFlashOfGenius")).toBeGreaterThan(-1);
		expect(activationBody.indexOf("_pActivateEfaFlashOfGenius")).toBeLessThan(activationBody.indexOf("_tryConsumeActiveStateToggleAction"));
		expect(source).toContain("this._state.pUseFlashOfGenius(opts)");
	});
});

describe("EFA Flash of Genius committed use", () => {
	it("materializes one canonical source-qualified resource and keeps feature uses synchronized", () => {
		const state = makeArtificer({level: 14});
		const flashResources = state.getResources().filter(resource => resource.featureUid === FLASH_UID);
		expect(flashResources).toHaveLength(1);
		expect(flashResources[0]).toEqual(expect.objectContaining({
			name: "Flash of Genius",
			classUid: CLASS_UID,
			current: 4,
			max: 4,
			recharge: "long",
			shortRestRecovery: 1,
			contextualOnly: true,
			actionLabel: "Reaction",
		}));
		const feature = state.getFeatures().find(it => it.name === "Flash of Genius" && it.source === "EFA");
		expect(feature.uses).toEqual({current: 4, max: 4, recharge: "long", shortRestRecovery: 1});
	});

	it("commits Reaction and one use exactly once, applies the INT bonus, then invokes hooks", async () => {
		const state = makeArtificer({level: 7});
		const observed = [];
		state.registerCommittedFeatureUseHook(FLASH_UID, result => {
			observed.push({
				committed: result.committed,
				reactionAvailable: state.isActionTypeAvailable("reaction"),
				remainingUses: getFlashResource(state).current,
			});
			return "follow-up complete";
		}, {hookId: "probe"});

		const result = await state.pUseFlashOfGenius({
			rollType: "abilityCheck",
			isFailed: true,
			rollTotal: 11,
			targetType: "self",
		});

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			featureUid: FLASH_UID,
			classUid: CLASS_UID,
			actionType: "reaction",
			resourceCost: 1,
			remainingUses: 3,
			followUpFailed: false,
		}));
		expect(result.result).toEqual(expect.objectContaining({bonus: 4, originalTotal: 11, adjustedTotal: 15}));
		expect(result.followUps).toEqual([{hookId: "probe", ok: true, value: "follow-up complete"}]);
		expect(observed).toEqual([{committed: true, reactionAvailable: false, remainingUses: 3}]);
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(getFlashResource(state).current).toBe(3);
	});

	it.each([
		[{cancelled: true}, "cancelled"],
		[{rollType: "attack", isFailed: true}, "invalidRollType"],
		[{rollType: "abilityCheck", isFailed: false}, "rollDidNotFail"],
		[{rollType: "savingThrow", isFailed: true, targetType: "ally", targetName: "Mira"}, "invalidTarget"],
		[{rollType: "savingThrow", isFailed: true, targetType: "creature", targetName: ""}, "invalidTarget"],
		[{rollType: "savingThrow", isFailed: true, targetType: "creature", targetName: "Mira"}, "targetNotVisible"],
		[{rollType: "savingThrow", isFailed: true, targetType: "creature", targetName: "Mira", targetVisible: false}, "targetNotVisible"],
		[{rollType: "savingThrow", isFailed: true, targetType: "creature", targetName: "Mira", targetVisible: true}, "targetOutOfRange"],
		[{rollType: "savingThrow", isFailed: true, targetType: "creature", targetName: "Mira", targetVisible: true, distanceFeet: 31}, "targetOutOfRange"],
	])("rolls back invalid or cancelled use %#", async (input, reason) => {
		const state = makeArtificer({level: 7});
		const hook = jest.fn();
		state.registerCommittedFeatureUseHook(FLASH_UID, hook);
		const before = getFlashResource(state).current;
		const result = await state.pUseFlashOfGenius(input);
		expect(result).toEqual(expect.objectContaining({ok: false, committed: false, reason}));
		expect(getFlashResource(state).current).toBe(before);
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
		expect(hook).not.toHaveBeenCalled();
	});

	it("spends nothing and emits no hook when Reaction or resource is unavailable", async () => {
		const reactionState = makeArtificer({level: 7});
		const reactionHook = jest.fn();
		reactionState.registerCommittedFeatureUseHook(FLASH_UID, reactionHook);
		reactionState.consumeActionType("reaction");
		const reactionUses = getFlashResource(reactionState).current;
		const noReaction = await reactionState.pUseFlashOfGenius({rollType: "savingThrow", isFailed: true});
		expect(noReaction).toEqual(expect.objectContaining({ok: false, committed: false, reason: "actionUnavailable"}));
		expect(getFlashResource(reactionState).current).toBe(reactionUses);
		expect(reactionHook).not.toHaveBeenCalled();

		const resourceState = makeArtificer({level: 7});
		const resourceHook = jest.fn();
		resourceState.registerCommittedFeatureUseHook(FLASH_UID, resourceHook);
		const resource = getFlashResource(resourceState);
		resourceState.setResourceCurrent(resource.id, 0);
		const noResource = await resourceState.pUseFlashOfGenius({rollType: "abilityCheck", isFailed: true});
		expect(noResource).toEqual(expect.objectContaining({ok: false, committed: false, reason: "insufficientResource"}));
		expect(resourceState.isActionTypeAvailable("reaction")).toBe(true);
		expect(resourceHook).not.toHaveBeenCalled();
	});

	it("surfaces post-commit hook failure without rolling back the valid use", async () => {
		const state = makeArtificer({level: 7});
		state.registerCommittedFeatureUseHook(FLASH_UID, () => {
			throw new Error("Ingenious Movement probe failed");
		}, {hookId: "failing-probe"});

		const result = await state.pUseFlashOfGenius({rollType: "savingThrow", isFailed: true});
		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			followUpFailed: true,
			remainingUses: 3,
		}));
		expect(result.followUps).toEqual([{
			hookId: "failing-probe",
			ok: false,
			error: "Ingenious Movement probe failed",
		}]);
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(getFlashResource(state).current).toBe(3);
	});

	it("migrates legacy EFA level 7+ saves at maximum once and remains idempotent", () => {
		const legacy = {
			name: "Legacy Artificer",
			abilities: {str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10},
			classes: [{name: "Artificer", source: "EFA", level: 7}],
			features: [{
				id: "legacy-flash",
				name: "Flash of Genius",
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				level: 7,
			}],
			resources: [],
		};
		const state = new CharacterSheetState();
		state.loadFromJson(legacy);
		expect(state.toJson().migrationFlags.efaFlashOfGeniusResourceV1).toBe(true);
		expect(getFlashResource(state)).toEqual(expect.objectContaining({current: 4, max: 4}));

		const resource = getFlashResource(state);
		state.setResourceCurrent(resource.id, 3);
		const spentSave = state.toJson();
		state.loadFromJson(spentSave);
		state.loadFromJson(state.toJson());
		expect(getFlashResource(state)).toEqual(expect.objectContaining({current: 3, max: 4}));
	});

	it("recovers one use at level 14 and all uses at level 20 only with an attuned item", () => {
		const advanced = makeArtificer({level: 14});
		const advancedResource = getFlashResource(advanced);
		advanced.setResourceCurrent(advancedResource.id, 1);
		advanced.onShortRest();
		expect(getFlashResource(advanced).current).toBe(2);

		advanced.setResourceCurrent(advancedResource.id, 1);
		CharacterSheetRest.prototype._restoreResources.call({_state: advanced}, "short");
		expect(getFlashResource(advanced).current).toBe(2);

		const soul = makeArtificer({level: 20});
		const soulResource = getFlashResource(soul);
		soul.setResourceCurrent(soulResource.id, 0);
		soul.onShortRest();
		expect(getFlashResource(soul).current).toBe(1);

		soul.addItem({name: "Ring of Proof", source: "DMG", requiresAttunement: true});
		const ring = soul.getInventory().find(row => row.item?.name === "Ring of Proof");
		soul.setItemAttuned(ring.id, true);
		soul.setResourceCurrent(soulResource.id, 0);
		soul.onShortRest();
		expect(getFlashResource(soul).current).toBe(4);
	});
});
