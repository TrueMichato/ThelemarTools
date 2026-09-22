import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
let CharacterSheetPage;

const FLASH_UID = CharacterSheetState.EFA_FLASH_OF_GENIUS_UID;
const MOVEMENT_UID = CharacterSheetState.INGENIOUS_MOVEMENT_FEATURE_UID;
const MOVEMENT_HOOK_ID = CharacterSheetState.INGENIOUS_MOVEMENT_HOOK_ID;

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

function makeCharacter ({
	className = "Artificer",
	classSource = "EFA",
	level = 9,
	subclassName = "Cartographer",
	subclassSource = "EFA",
} = {}) {
	const state = new CharacterSheetState();
	state.setCharacterName("Mira");
	state.setAbilityBase("int", 18);
	state.addClass({
		name: className,
		source: classSource,
		level,
		subclass: subclassName
			? {name: subclassName, shortName: subclassName, source: subclassSource}
			: null,
	});
	if (className === "Artificer" && classSource === "EFA" && level >= 7) {
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

function makePage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = {render: jest.fn()};
	page._features = {_renderResources: jest.fn(), render: jest.fn()};
	page._saveCurrentCharacter = jest.fn(async () => {});
	page._renderResources = jest.fn();
	page._renderActiveStates = jest.fn();
	page._renderCharacter = jest.fn();
	return page;
}

function validCreatureConfirmation (committedFlashResult, overrides = {}) {
	return {
		committedFlashResult,
		targetType: "creature",
		targetName: "Thorn",
		targetWilling: true,
		targetVisible: true,
		targetDistanceFeet: 30,
		teleportDistanceFeet: 30,
		destinationVisible: true,
		destinationUnoccupied: true,
		...overrides,
	};
}

describe("EFA Cartographer Ingenious Movement eligibility", () => {
	it("publishes the exact level-9 source-qualified calculation contract", () => {
		const below = makeCharacter({level: 8});
		const eligible = makeCharacter({level: 9});

		expect(below.getFeatureCalculations().hasIngeniousMovement).toBeUndefined();
		expect(eligible.getFeatureCalculations()).toMatchObject({
			hasIngeniousMovement: true,
			ingeniousMovementRange: 30,
			ingeniousMovementSourceFeatureUid: MOVEMENT_UID,
		});
		expect(eligible.hasEfaCartographerIngeniousMovementFeature()).toBe(true);
	});

	it.each([
		["wrong class", {className: "Wizard", classSource: "EFA"}],
		["wrong base source", {classSource: "TCE"}],
		["wrong subclass", {subclassName: "Alchemist"}],
		["same-label wrong subclass source", {subclassSource: "TCE"}],
		["below exact level", {level: 8}],
	])("does not register for %s", (_label, input) => {
		const state = makeCharacter(input);
		state.addFeature({
			name: "Ingenious Movement",
			source: input.subclassSource === "TCE" ? "TCE" : "EFA",
			className: "Artificer",
			classSource: input.classSource || "EFA",
			subclassName: "Cartographer",
			subclassSource: input.subclassSource || "EFA",
			level: 9,
		});

		expect(state.hasEfaCartographerIngeniousMovementFeature()).toBe(false);
		expect(state.registerEfaCartographerIngeniousMovementHook(jest.fn())).toBeNull();
		expect(state.getFeatureCalculations().hasIngeniousMovement).toBeUndefined();
	});

	it("stops registering after level or subclass removal", () => {
		const levelRemoved = makeCharacter();
		levelRemoved.getClasses()[0].level = 8;
		expect(levelRemoved.registerEfaCartographerIngeniousMovementHook(jest.fn())).toBeNull();

		const subclassRemoved = makeCharacter();
		subclassRemoved.setSubclass("Artificer", {name: "Alchemist", shortName: "Alchemist", source: "EFA"});
		expect(subclassRemoved.registerEfaCartographerIngeniousMovementHook(jest.fn())).toBeNull();
	});
});

describe("EFA Cartographer Ingenious Movement transaction", () => {
	it("runs only after a successful Flash commit and charges Reaction/resource once", async () => {
		const state = makeCharacter();
		state.startCombat();
		const resource = getFlashResource(state);
		const before = resource.current;
		const consumeActionType = jest.spyOn(state, "consumeActionType");
		const observed = [];
		const unregister = state.registerEfaCartographerIngeniousMovementHook(committedFlashResult => {
			observed.push({
				reactionAvailable: state.isActionTypeAvailable("reaction"),
				remainingUses: getFlashResource(state).current,
			});
			return state.resolveEfaCartographerIngeniousMovement(validCreatureConfirmation(committedFlashResult));
		});

		const result = await state.pUseFlashOfGenius({
			rollType: "savingThrow",
			isFailed: true,
			targetType: "self",
		});
		unregister();

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			remainingUses: before - 1,
			followUpFailed: false,
		}));
		expect(result.followUps).toHaveLength(1);
		expect(result.followUps[0]).toMatchObject({
			hookId: MOVEMENT_HOOK_ID,
			ok: true,
			value: {
				ok: true,
				resolved: true,
				applied: false,
				kind: "ingeniousMovement",
				timing: "sameReaction",
				sourceFeatureUid: MOVEMENT_UID,
				triggerFeatureUid: FLASH_UID,
			},
		});
		expect(observed).toEqual([{reactionAvailable: false, remainingUses: before - 1}]);
		expect(consumeActionType).toHaveBeenCalledTimes(1);
		expect(consumeActionType).toHaveBeenCalledWith("reaction");
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(getFlashResource(state).current).toBe(before - 1);
	});

	it.each([
		[{cancelled: true}, "cancelled"],
		[{rollType: "attack", isFailed: true}, "invalidRollType"],
		[{rollType: "abilityCheck", isFailed: false}, "rollDidNotFail"],
	])("emits no Ingenious result for uncommitted Flash %#", async (input, reason) => {
		const state = makeCharacter();
		const hook = jest.fn();
		const unregister = state.registerEfaCartographerIngeniousMovementHook(hook);
		const before = getFlashResource(state).current;

		const result = await state.pUseFlashOfGenius(input);
		unregister();

		expect(result).toEqual(expect.objectContaining({ok: false, committed: false, reason}));
		expect(result.followUps).toBeUndefined();
		expect(hook).not.toHaveBeenCalled();
		expect(getFlashResource(state).current).toBe(before);
		expect(state.isActionTypeAvailable("reaction")).toBe(true);
	});

	it("returns an immutable relocation instruction without coordinates or cross-sheet mutation", async () => {
		const state = makeCharacter();
		const flash = await state.pUseFlashOfGenius({rollType: "abilityCheck", isFailed: true});
		const before = state.toJson();
		const result = state.resolveEfaCartographerIngeniousMovement(validCreatureConfirmation(flash));

		expect(result).toEqual({
			ok: true,
			resolved: true,
			applied: false,
			kind: "ingeniousMovement",
			sourceFeatureUid: MOVEMENT_UID,
			triggerFeatureUid: FLASH_UID,
			timing: "sameReaction",
			target: {
				type: "creature",
				name: "Thorn",
				willing: true,
				visibleToCartographer: true,
				distanceFromCartographerFeet: 30,
			},
			teleport: {
				status: "requires-external-relocation",
				applied: false,
				distanceFeet: 30,
				maxDistanceFeet: 30,
				destinationVisibleToCartographer: true,
				destinationUnoccupied: true,
				requiresExternalRelocation: true,
			},
			instruction: "Teleport Thorn 30 feet to the confirmed unoccupied space you can see.",
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.target)).toBe(true);
		expect(Object.isFrozen(result.teleport)).toBe(true);
		expect(result.teleport.coordinates).toBeUndefined();
		expect(state.toJson()).toEqual(before);
		expect(JSON.stringify(state.toJson())).not.toContain("ingeniousMovement");
	});

	it.each([
		["uncommitted Flash", {committedFlashResult: {ok: false, committed: false}}, "uncommittedFlash"],
		["unnamed target", {targetName: ""}, "invalidTarget"],
		["unwilling target", {targetWilling: false}, "targetNotWilling"],
		["unseen target", {targetVisible: false}, "targetNotVisible"],
		["out-of-range target", {targetDistanceFeet: 31}, "targetOutOfRange"],
		["zero-distance destination", {teleportDistanceFeet: 0}, "destinationOutOfRange"],
		["out-of-range destination", {teleportDistanceFeet: 31}, "destinationOutOfRange"],
		["unseen destination", {destinationVisible: false}, "destinationNotVisible"],
		["occupied destination", {destinationUnoccupied: false}, "destinationOccupied"],
	])("rejects %s with an explicit immutable failure", async (_label, override, reason) => {
		const state = makeCharacter();
		const flash = await state.pUseFlashOfGenius({rollType: "abilityCheck", isFailed: true});
		const result = state.resolveEfaCartographerIngeniousMovement(validCreatureConfirmation(flash, override));

		expect(result).toMatchObject({
			ok: false,
			resolved: false,
			applied: false,
			kind: "ingeniousMovement",
			reason,
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("marks a failed follow-up without rolling back the committed Flash", async () => {
		const state = makeCharacter();
		state.startCombat();
		const resource = getFlashResource(state);
		const before = resource.current;
		const unregister = state.registerEfaCartographerIngeniousMovementHook(committedFlashResult =>
			state.resolveEfaCartographerIngeniousMovement(validCreatureConfirmation(committedFlashResult, {
				targetWilling: false,
			})));

		const result = await state.pUseFlashOfGenius({rollType: "savingThrow", isFailed: true});
		unregister();

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			followUpFailed: true,
			remainingUses: before - 1,
		}));
		expect(result.followUps).toEqual([{
			hookId: MOVEMENT_HOOK_ID,
			ok: false,
			value: expect.objectContaining({ok: false, reason: "targetNotWilling"}),
		}]);
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(getFlashResource(state).current).toBe(before - 1);
	});

	it("surfaces a thrown hook failure without rolling back the committed Flash", async () => {
		const state = makeCharacter();
		state.startCombat();
		const before = getFlashResource(state).current;
		const unregister = state.registerEfaCartographerIngeniousMovementHook(() => {
			throw new Error("Ingenious Movement UI failed");
		});

		const result = await state.pUseFlashOfGenius({rollType: "savingThrow", isFailed: true});
		unregister();

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			followUpFailed: true,
			remainingUses: before - 1,
		}));
		expect(result.followUps).toEqual([{
			hookId: MOVEMENT_HOOK_ID,
			ok: false,
			error: "Ingenious Movement UI failed",
		}]);
		expect(state.isActionTypeAvailable("reaction")).toBe(false);
		expect(getFlashResource(state).current).toBe(before - 1);
	});

	it.each(["not-created", "invalidated", "destroyed"])("does not invent an Atlas-holder gate for %s Atlas state", async atlasState => {
		const state = makeCharacter();
		if (atlasState !== "not-created") {
			state._data.adventurersAtlas = {
				version: 1,
				generation: 1,
				createdAt: 1,
				capacityAtCreation: 2,
				invalidatedReason: atlasState === "invalidated" ? "test" : null,
				holders: [
					{id: "self", name: "Mira", isSelf: true, status: atlasState === "destroyed" ? "destroyed" : "active", destroyedBy: atlasState === "destroyed" ? "test" : null, destroyedAt: atlasState === "destroyed" ? 1 : null},
					{id: "ally", name: "Thorn", isSelf: false, status: "active", destroyedBy: null, destroyedAt: null},
				],
			};
		}
		const flash = await state.pUseFlashOfGenius({rollType: "abilityCheck", isFailed: true});
		const result = state.resolveEfaCartographerIngeniousMovement(validCreatureConfirmation(flash));
		expect(result).toMatchObject({ok: true, resolved: true});
	});
});

describe("EFA Cartographer Ingenious Movement UI integration", () => {
	it("registers one post-commit follow-up on the canonical Flash path and returns the structured result", async () => {
		const state = makeCharacter();
		state.startCombat();
		const page = makePage(state);
		const before = getFlashResource(state).current;
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean")
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		const enumSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserEnum").mockResolvedValue("self");
		const numberSpy = jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValue(20);
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast");

		try {
			const result = await page._pCommitEfaFlashOfGenius({
				rollType: "abilityCheck",
				isFailed: true,
				targetType: "self",
			});
			expect(result).toEqual(expect.objectContaining({
				ok: true,
				committed: true,
				followUpFailed: false,
				remainingUses: before - 1,
			}));
			expect(result.followUps).toHaveLength(1);
			expect(result.followUps[0]).toMatchObject({
				hookId: MOVEMENT_HOOK_ID,
				ok: true,
				value: {
					ok: true,
					resolved: true,
					target: {type: "self", name: "Mira"},
					teleport: {distanceFeet: 20, requiresExternalRelocation: true},
				},
			});
			expect(state.isActionTypeAvailable("reaction")).toBe(false);
			expect(getFlashResource(state).current).toBe(before - 1);
			expect(state._committedFeatureUseHooks.get(FLASH_UID)?.has(MOVEMENT_HOOK_ID)).not.toBe(true);
			expect(toastSpy).toHaveBeenCalledWith({
				type: "success",
				content: "Flash of Genius added +4 to your roll. Ingenious Movement: Teleport yourself 20 feet to the confirmed unoccupied space you can see.",
			});
		} finally {
			boolSpy.mockRestore();
			enumSpy.mockRestore();
			numberSpy.mockRestore();
			toastSpy.mockRestore();
		}
	});

	it("keeps the committed Flash spend when the follow-up is declined", async () => {
		const state = makeCharacter();
		state.startCombat();
		const page = makePage(state);
		const before = getFlashResource(state).current;
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast");

		try {
			const result = await page._pCommitEfaFlashOfGenius({
				rollType: "savingThrow",
				isFailed: true,
				targetType: "self",
			});
			expect(result).toEqual(expect.objectContaining({
				ok: true,
				committed: true,
				followUpFailed: false,
				remainingUses: before - 1,
			}));
			expect(result.followUps).toEqual([{
				hookId: MOVEMENT_HOOK_ID,
				ok: true,
				value: expect.objectContaining({
					ok: true,
					resolved: false,
					declined: true,
					reason: "declined",
				}),
			}]);
			expect(state.isActionTypeAvailable("reaction")).toBe(false);
			expect(getFlashResource(state).current).toBe(before - 1);
			expect(toastSpy).toHaveBeenCalledWith({
				type: "success",
				content: "Flash of Genius added +4 to your roll. Ingenious Movement was skipped; the Flash use remains committed.",
			});
		} finally {
			boolSpy.mockRestore();
			toastSpy.mockRestore();
		}
	});

	it("surfaces an invalid post-commit destination without refunding Flash", async () => {
		const state = makeCharacter();
		state.startCombat();
		const page = makePage(state);
		const before = getFlashResource(state).current;
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean")
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const enumSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserEnum").mockResolvedValue("self");
		const numberSpy = jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValue(20);
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast");

		try {
			const result = await page._pCommitEfaFlashOfGenius({
				rollType: "savingThrow",
				isFailed: true,
				targetType: "self",
			});
			expect(result).toEqual(expect.objectContaining({
				ok: true,
				committed: true,
				followUpFailed: true,
				remainingUses: before - 1,
			}));
			expect(result.followUps).toEqual([{
				hookId: MOVEMENT_HOOK_ID,
				ok: false,
				value: expect.objectContaining({
					ok: false,
					reason: "destinationNotVisible",
				}),
			}]);
			expect(state.isActionTypeAvailable("reaction")).toBe(false);
			expect(getFlashResource(state).current).toBe(before - 1);
			expect(toastSpy).toHaveBeenCalledWith({
				type: "warning",
				content: "Flash of Genius added +4 to your roll, but Ingenious Movement could not be resolved. The Flash use remains committed.",
			});
		} finally {
			boolSpy.mockRestore();
			enumSpy.mockRestore();
			numberSpy.mockRestore();
			toastSpy.mockRestore();
		}
	});

	it("does not prompt or emit Ingenious Movement after the eligible subclass is removed", async () => {
		const state = makeCharacter();
		state.setSubclass("Artificer", {name: "Alchemist", shortName: "Alchemist", source: "EFA"});
		const page = makePage(state);
		const promptSpy = jest.spyOn(page, "_pResolveEfaCartographerIngeniousMovement");

		const result = await page._pCommitEfaFlashOfGenius({
			rollType: "abilityCheck",
			isFailed: true,
			targetType: "self",
		});

		expect(result).toEqual(expect.objectContaining({ok: true, committed: true, followUps: []}));
		expect(promptSpy).not.toHaveBeenCalled();
	});
});
