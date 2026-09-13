import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;

describe("TGTT Time Domain mechanics", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("feature interaction descriptors", () => {
		it.each([
			["Chronological Interference", "initiativeSwap", "bonus", "Chronological Interference"],
			["Channel Divinity: Temporal Manipulation", "externalRollMode", "reaction", "Channel Divinity"],
			["Eyes of the Future Past", "temporalVision", "bonus", "Eyes of the Future Past"],
		])("classifies %s", (name, interactionKind, activationAction, resourceName) => {
			const feature = {
				name,
				source: "TGTT",
				subclassShortName: "Time",
				entries: [`Use ${name} as a ${activationAction} action.`],
			};

			expect(CharacterSheetState.detectActivatableFeature(feature)).toMatchObject({
				interactionKind,
				activationAction,
				resourceName,
			});
		});

		it("does not apply Time descriptors to a same-named feature from another source", () => {
			expect(CharacterSheetState.getFeatureInteractionDescriptor({
				name: "Chronological Interference",
				source: "HB",
				subclassShortName: "Time",
			})).toBeNull();
		});

		it("exposes Temporal Mastery as a utility action rather than an activatable state", () => {
			expect(CharacterSheetState.getFeatureInteractionDescriptor({
				name: "Temporal Mastery",
				source: "TGTT",
				subclassShortName: "Time",
			})).toMatchObject({
				utilityAction: "magicalAging",
				utilityLabel: "Resolve Magical Aging…",
			});
		});
	});

	describe("Chronological Interference turn order", () => {
		it("swaps two unacted creatures and their initiative values", () => {
			const firstId = state.upsertCombatTurnOrderParticipant({name: "Ancient Red Dragon", initiative: 22});
			state.upsertCombatTurnOrderParticipant({name: "Time Cleric", initiative: 17});
			const secondId = state.upsertCombatTurnOrderParticipant({name: "Fighter", initiative: 11});
			state.startCombat();

			const result = state.swapCombatTurnOrderParticipants(firstId, secondId);

			expect(result.ok).toBe(true);
			expect(state.getCombatTurnOrder().map(it => [it.name, it.initiative])).toEqual([
				["Fighter", 22],
				["Time Cleric", 17],
				["Ancient Red Dragon", 11],
			]);
		});

		it("rejects duplicate, missing, acted, and out-of-combat targets without mutation", () => {
			const firstId = state.upsertCombatTurnOrderParticipant({name: "A", initiative: 20});
			const secondId = state.upsertCombatTurnOrderParticipant({name: "B", initiative: 10});
			const original = state.getCombatTurnOrder();

			expect(state.swapCombatTurnOrderParticipants(firstId, secondId).ok).toBe(false);
			state.startCombat();
			expect(state.swapCombatTurnOrderParticipants(firstId, firstId).ok).toBe(false);
			expect(state.swapCombatTurnOrderParticipants(firstId, "missing").ok).toBe(false);
			state.markCombatTurnOrderParticipantActed(firstId);
			expect(state.swapCombatTurnOrderParticipants(firstId, secondId).ok).toBe(false);
			expect(state.getCombatTurnOrder().map(({id, name, initiative}) => ({id, name, initiative})))
				.toEqual(original.map(({id, name, initiative}) => ({id, name, initiative})));
		});

		it("resets acted markers at the start of each round", () => {
			const id = state.upsertCombatTurnOrderParticipant({name: "A", initiative: 20, hasActed: true});
			state.startCombat();
			expect(state.getCombatTurnOrder().find(it => it.id === id).hasActed).toBe(false);
			state.markCombatTurnOrderParticipantActed(id);
			state.advanceRound();
			expect(state.getCombatTurnOrder().find(it => it.id === id).hasActed).toBe(false);
		});

		it("persists the roster and normalizes duplicate or malformed rows on load", () => {
			const save = state.toJson();
			save.combatTurnOrder = [
				{id: "a", name: "A", initiative: 20, hasActed: true},
				{id: "a", name: "Duplicate", initiative: 10, hasActed: false},
				{id: "b", name: "B", initiative: "not-a-number", hasActed: 1},
			];
			state.loadFromJson(save);
			expect(state.getCombatTurnOrder()).toEqual([
				{id: "a", name: "A", initiative: 20, hasActed: true},
				{id: "b", name: "B", initiative: 0, hasActed: true},
			]);
		});
	});

	describe("Eyes of the Future Past", () => {
		const getBlinded = () => state.getConditions().some(it => (it.name || it).toLowerCase() === "blinded");

		it("tracks direction, offset, round choices, duration, and Blinded cleanup", () => {
			state.startCombat();
			state.activateState("eyesOfFuturePast", {
				sourceFeatureId: "eyes-feature",
				temporalView: {
					direction: "past",
					offsetHours: 1,
					roundDecision: null,
					decisionPending: false,
				},
			});
			const active = state.getActiveStates().find(it => it.stateTypeId === "eyesOfFuturePast");

			expect(active).toMatchObject({
				roundsRemaining: 10,
				temporalView: {direction: "past", offsetHours: 1, decisionPending: false},
			});
			expect(getBlinded()).toBe(true);

			state.advanceRound();
			expect(active.temporalView.decisionPending).toBe(true);
			expect(state.resolveTemporalViewRoundChoice("hold")).toBe(true);
			expect(active.temporalView.offsetHours).toBe(1);

			state.advanceRound();
			expect(state.resolveTemporalViewRoundChoice("advance")).toBe(true);
			expect(active.temporalView.offsetHours).toBe(2);

			for (let i = 0; i < 8; i++) state.advanceRound();
			expect(active.active).toBe(false);
			expect(active.roundsRemaining).toBe(0);
			expect(getBlinded()).toBe(false);
		});

		it("migrates an active legacy custom state without inventing a direction", () => {
			const save = state.toJson();
			save.activeStates = [{
				id: "legacy-eyes",
				stateTypeId: "custom",
				name: "Eyes of the Future Past",
				active: true,
				duration: "1 minute",
				roundsRemaining: 7,
				addsConditions: ["blinded"],
			}];

			state.loadFromJson(save);
			expect(state.getActiveStates()[0]).toMatchObject({
				stateTypeId: "eyesOfFuturePast",
				roundsRemaining: 7,
				temporalView: {
					direction: null,
					offsetHours: 1,
					decisionPending: true,
				},
			});
		});

		it("removes its owned state and Blinded condition when the feature is removed", () => {
			state.addFeature({
				name: "Eyes of the Future Past",
				source: "TGTT",
				className: "Cleric",
				subclassShortName: "Time",
				level: 6,
			});
			const feature = state.getFeature("Eyes of the Future Past");
			state.activateState("eyesOfFuturePast", {
				sourceFeatureId: feature.id,
				temporalView: {direction: "future", offsetHours: 1, decisionPending: false},
			});
			expect(getBlinded()).toBe(true);

			state.removeFeature(feature.id);
			expect(state.getActiveStates().some(it => it.stateTypeId === "eyesOfFuturePast")).toBe(false);
			expect(getBlinded()).toBe(false);
		});
	});

	describe("Right on Time migration", () => {
		it("keeps the dynamic Wisdom row and removes the obsolete numeric twin", () => {
			const save = state.toJson();
			save.namedModifiers = [
				{name: "Right on Time", type: "initiative", value: 0, abilityMod: "wisdom", note: "From Right on Time"},
				{name: "Right on Time", type: "initiative", value: 3, sourceType: "classFeature", note: "From Right on Time"},
			];
			state.loadFromJson(save);
			const rows = state.getNamedModifiers().filter(it => it.type === "initiative" && /right on time/i.test(it.name));
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({value: 0, abilityMod: "wisdom"});
		});
	});

	describe("Temporal Mastery age resolution", () => {
		it("adjusts a valid age and rejects invalid results", () => {
			state.setAppearance("age", "42");
			expect(state.adjustAge(-1)).toEqual({ok: true, previous: 42, current: 41});
			expect(state.getAppearance("age")).toBe("41");

			state.setAppearance("age", "1");
			expect(state.adjustAge(-1)).toEqual({ok: false, error: "Age must remain at least 1 year."});
			expect(state.getAppearance("age")).toBe("1");
		});

		it("can ignore or accept magical aging", () => {
			state.setAppearance("age", "42");
			expect(state.resolveMagicalAging({years: 10, ignore: true})).toMatchObject({ok: true, ignored: true, current: 42});
			expect(state.getAppearance("age")).toBe("42");
			expect(state.resolveMagicalAging({years: 10, ignore: false})).toMatchObject({ok: true, ignored: false, current: 52});
			expect(state.getAppearance("age")).toBe("52");
		});

		it("rest undo restores the age captured before a Temporal Mastery shift", () => {
			const rest = Object.create(CharacterSheetRest.prototype);
			rest._state = state;
			rest._page = {saveCharacter: () => {}, renderCharacter: () => {}, _lastRestSnapshot: null};
			state.setAppearance("age", "42");
			rest._captureRestSnapshot("long");
			state.adjustAge(1);
			expect(state.getAppearance("age")).toBe("43");
			expect(rest._onUndoRest()).toBe(true);
			expect(state.getAppearance("age")).toBe("42");
		});
	});
});
