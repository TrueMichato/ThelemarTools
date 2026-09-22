import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheet movement economy", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setSpeed("walk", 30);
	});

	it("records source-tagged atomic spends against live walking Speed", () => {
		const result = state.spendMovement(10, {
			source: "test:walk",
			metadata: {destination: "door"},
		});

		expect(result).toMatchObject({
			ok: true,
			receipt: {
				kind: "spend",
				source: "test:walk",
				scope: null,
				amount: 10,
				metadata: {destination: "door"},
			},
			movement: {speed: 30, allowance: 30, used: 10, remaining: 20},
		});
		expect(state.getMovementEconomyState().receipts).toHaveLength(1);
	});

	it("rejects insufficient movement without writing a receipt", () => {
		expect(state.spendMovement(31, {source: "test:too-far"})).toEqual({
			ok: false,
			reason: "insufficient-movement",
			requested: 31,
			available: 30,
			allowance: 30,
		});
		expect(state.getMovementEconomyState()).toMatchObject({used: 0, remaining: 30, receipts: []});
	});

	it("treats Speed 0 as no movement instead of falling back to 30 feet", () => {
		state.setSpeed("walk", 0);

		expect(state.getMovementEconomyState()).toMatchObject({speed: 0, allowance: 0, used: 0, remaining: 0});
		expect(state.spendMovement(1, {source: "test:immobile"})).toMatchObject({
			ok: false,
			reason: "insufficient-movement",
			available: 0,
		});
	});

	it("recalculates remaining movement after base and temporary Speed changes", () => {
		const spend = state.spendMovement(10, {source: "test:walk"});
		expect(spend.ok).toBe(true);

		state.addActiveState("custom", {
			name: "Longstrider",
			customEffects: [{type: "bonus", target: "speed", value: 10}],
		});
		expect(state.getMovementEconomyState()).toMatchObject({speed: 40, allowance: 40, used: 10, remaining: 30});

		state.setSpeed("walk", 20);
		expect(state.getMovementEconomyState()).toMatchObject({speed: 30, allowance: 30, used: 10, remaining: 20});
	});

	it("refunds and rolls back one receipt without disturbing other spends", () => {
		const first = state.spendMovement(5, {source: "test:first"});
		const second = state.spendMovement(10, {source: "test:second"});

		expect(state.refundMovement(first.receipt.id)).toMatchObject({
			ok: true,
			receipt: {source: "test:first", amount: 5},
			movement: {used: 10, remaining: 20},
		});
		expect(state.rollbackMovement(second.receipt.id)).toMatchObject({
			ok: true,
			receipt: {source: "test:second", amount: 10},
			movement: {used: 0, remaining: 30},
		});
	});

	it("resets movement and action receipts together for a new turn", () => {
		state.spendMovement(15, {source: "test:walk"});
		state.consumeActionType("action");

		state.resetTurnEconomy({round: 7});

		expect(state.getMovementEconomyState()).toMatchObject({round: 7, used: 0, remaining: 30, receipts: []});
		expect(state.getActionEconomyState()).toEqual({action: true, bonus: true, reaction: true});
	});

	it("resets movement receipts when combat advances to the next turn", () => {
		state.startCombat();
		state.spendMovement(15, {source: "test:combat"});
		state.consumeActionType("reaction");

		state.advanceRound();

		expect(state.getMovementEconomyState()).toMatchObject({round: 2, used: 0, remaining: 30, receipts: []});
		expect(state.getActionEconomyState()).toEqual({action: true, bonus: true, reaction: true});
	});

	it("persists movement receipts through save/load", () => {
		state.spendMovement(12, {source: "test:persist"});
		const restored = new CharacterSheetState();

		restored.loadFromJson(state.toJson());
		expect(restored.getMovementEconomyState()).toMatchObject({
			speed: 30,
			allowance: 30,
			used: 12,
			remaining: 18,
			receipts: [expect.objectContaining({source: "test:persist", amount: 12})],
		});
	});

	it("migrates legacy Chained Fury movement into scoped generic receipts", () => {
		const legacy = state.toJson();
		delete legacy.movementEconomyUsage;
		legacy.chainedMovementUsage = {
			round: 3,
			movementUsed: 12,
			bonusActionUsed: true,
			doubled: true,
		};
		const restored = new CharacterSheetState();

		restored.loadFromJson(legacy);
		expect(restored.getMovementEconomyState()).toMatchObject({
			round: 3,
			allowance: 30,
			used: 12,
			remaining: 18,
		});
		expect(restored.getChainedMovementState()).toMatchObject({
			round: 3,
			allowance: 60,
			used: 12,
			remaining: 48,
			doubled: true,
			bonusActionUsed: true,
		});
		expect(restored.isActionTypeAvailable("bonus")).toBe(false);
		expect(restored.toJson()).not.toHaveProperty("chainedMovementUsage");
	});

	it("rejects invalid spends and resets malformed persisted usage explicitly", () => {
		expect(state.spendMovement(-5, {source: "test:invalid"})).toEqual({
			ok: false,
			reason: "invalid-movement-spend",
		});
		const malformed = state.toJson();
		malformed.movementEconomyUsage = {
			round: 1,
			receipts: [{id: "bad", kind: "spend", source: "test", amount: -1}],
		};
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const restored = new CharacterSheetState();

		try {
			restored.loadFromJson(malformed);
			expect(warn).toHaveBeenCalledWith("[CharSheet State] Reset malformed movement economy usage.");
			expect(restored.getMovementEconomyState()).toMatchObject({round: null, used: 0, remaining: 30, receipts: []});
		} finally {
			warn.mockRestore();
		}
	});

	it("resets malformed legacy Chained Fury usage without consuming its stale bonus action", () => {
		const malformed = state.toJson();
		delete malformed.movementEconomyUsage;
		malformed.chainedMovementUsage = {
			round: 1,
			movementUsed: "not-a-distance",
			bonusActionUsed: true,
			doubled: true,
		};
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const restored = new CharacterSheetState();

		try {
			restored.loadFromJson(malformed);
			expect(warn).toHaveBeenCalledWith("[CharSheet State] Reset malformed movement economy usage.");
			expect(restored.getMovementEconomyState()).toMatchObject({round: null, used: 0, remaining: 30, receipts: []});
			expect(restored.getActionEconomyState().bonus).toBe(true);
		} finally {
			warn.mockRestore();
		}
	});
});
