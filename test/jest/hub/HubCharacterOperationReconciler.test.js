import {jest} from "@jest/globals";
import {
	BoundedIdSet,
	RECONCILE_STATUS,
	TRACK_DECISION,
	classifyTrack,
	createCoverage,
	deserializeCoverage,
	planAppliedOperation,
	serializeCoverage,
	validateDeliveredOperation,
} from "../../../js/hub/hub-character-operation-reconciler.js";
import {applySemanticOperation} from "../../../js/hub/hub-semantic-operations.js";
import {diffJson} from "../../../js/hub/hub-json-patch.js";

const makeCharacter = ({current = 10, max = 20, temp = 0, conditions = [], slots = null} = {}) => ({
	name: "Mira",
	hp: {current, max, temp},
	conditions: structuredClone(conditions),
	spellcasting: {spellSlots: structuredClone(slots || {1: {current: 2, max: 2}})},
});

const makeOperation = ({kind = "hp.damage", args = {amount: 3}, operationId = "operation-1"} = {}) => ({
	operationId,
	kind,
	version: 1,
	targetCharacterId: "character-1",
	arguments: args,
});

const planOne = ({tracks, operation, resultingCharacterRevision = 5, ...rest}) => planAppliedOperation({
	tracks,
	operation,
	resultingCharacterRevision,
	...rest,
});

describe("Semantic operation applicator", () => {
	it("absorbs damage with temporary hit points before current hit points", () => {
		const out = applySemanticOperation({
			data: makeCharacter({current: 10, temp: 4}),
			operation: makeOperation({kind: "hp.damage", args: {amount: 6}}),
		});
		expect(out.hp.temp).toBe(0);
		expect(out.hp.current).toBe(8);
	});

	it("floors current hit points at zero without going negative", () => {
		const out = applySemanticOperation({
			data: makeCharacter({current: 3, temp: 1}),
			operation: makeOperation({kind: "hp.damage", args: {amount: 50}}),
		});
		expect(out.hp).toMatchObject({current: 0, temp: 0});
	});

	it("clamps healing to the stored maximum", () => {
		const out = applySemanticOperation({
			data: makeCharacter({current: 18, max: 20}),
			operation: makeOperation({kind: "hp.heal", args: {amount: 9}}),
		});
		expect(out.hp.current).toBe(20);
	});

	it("preserves unknown hit-point keys byte-for-byte instead of deriving them", () => {
		const data = makeCharacter({current: 5});
		data.hp.maxHpReduction = 3;
		data.hp.effectiveMax = 42;
		const out = applySemanticOperation({data, operation: makeOperation({kind: "hp.heal", args: {amount: 2}})});
		expect(out.hp.maxHpReduction).toBe(3);
		expect(out.hp.effectiveMax).toBe(42);
	});

	it("dedupes an added condition against a legacy bare-string condition", () => {
		const out = applySemanticOperation({
			data: makeCharacter({conditions: ["Poisoned"]}),
			operation: makeOperation({kind: "condition.add", args: {condition: {name: "poisoned", source: "XPHB"}}}),
		});
		expect(out.conditions).toHaveLength(1);
	});

	it("removes every entry matching the normalized condition identity", () => {
		const out = applySemanticOperation({
			data: makeCharacter({conditions: ["Poisoned", {name: "Poisoned", source: "xphb"}, {name: "Prone", source: "XPHB"}]}),
			operation: makeOperation({kind: "condition.remove", args: {condition: {name: "Poisoned", source: "XPHB"}}}),
		});
		expect(out.conditions).toEqual([{name: "Prone", source: "XPHB"}]);
	});

	it("spends and restores spell slots at the requested level", () => {
		const spent = applySemanticOperation({
			data: makeCharacter({slots: {1: {current: 2, max: 2}, 3: {current: 1, max: 3}}}),
			operation: makeOperation({kind: "spell_slot.spend", args: {level: 3, amount: 1}}),
		});
		expect(spent.spellcasting.spellSlots[3].current).toBe(0);
		expect(spent.spellcasting.spellSlots[1].current).toBe(2);

		const restored = applySemanticOperation({
			data: spent,
			operation: makeOperation({kind: "spell_slot.restore", args: {level: 3, amount: 9}}),
		});
		expect(restored.spellcasting.spellSlots[3].current).toBe(3);
	});

	it("refuses to overspend spell slots", () => {
		expect(() => applySemanticOperation({
			data: makeCharacter({slots: {1: {current: 0, max: 2}}}),
			operation: makeOperation({kind: "spell_slot.spend", args: {level: 1, amount: 1}}),
		})).toThrow(/Not enough spell slots/);
	});
});

describe("Delivered operation validation", () => {
	it("rejects a kind outside the closed catalog even though the coordinator allows any string", () => {
		const result = validateDeliveredOperation(makeOperation({kind: "hp.adjust", args: {amount: 3}}));
		expect(result.error).toMatchObject({code: "OPERATION_INVALID"});
		expect(result.operation).toBeUndefined();
	});

	it("rejects an unsupported semantic version", () => {
		const result = validateDeliveredOperation({...makeOperation(), version: 2});
		expect(result.error).toMatchObject({code: "OPERATION_VERSION_UNSUPPORTED"});
	});

	it.each([
		["negative amount", {amount: -1}],
		["zero amount", {amount: 0}],
		["non-finite amount", {amount: Number.POSITIVE_INFINITY}],
		["unsupported field", {amount: 2, sneaky: true}],
	])("rejects malformed arguments: %s", (_label, args) => {
		expect(validateDeliveredOperation(makeOperation({args})).error).toBeTruthy();
	});
});

describe("Per-track coverage classification", () => {
	it.each([
		["already-applied operation id", createCoverage({revision: 1, appliedOperationIds: ["operation-1"]}), TRACK_DECISION.COVERED],
		["revision beyond the operation", createCoverage({revision: 6}), TRACK_DECISION.COVERED],
		["revision exactly at the operation", createCoverage({revision: 5}), TRACK_DECISION.COVERED],
		["revision immediately before the operation", createCoverage({revision: 4}), TRACK_DECISION.APPLY],
		["revision with an intervening gap", createCoverage({revision: 2}), TRACK_DECISION.RESYNC],
		["unknown revision", createCoverage(), TRACK_DECISION.RESYNC],
	])("classifies %s", (_label, coverage, expected) => {
		expect(classifyTrack({coverage, operationId: "operation-1", resultingCharacterRevision: 5})).toBe(expected);
	});

	it("round-trips coverage through serialization", () => {
		const coverage = createCoverage({revision: 4, acceptedSequence: 11, appliedOperationIds: ["a", "b"]});
		const restored = deserializeCoverage(serializeCoverage(coverage));
		expect(restored.revision).toBe(4);
		expect(restored.acceptedSequence).toBe(11);
		expect(restored.appliedOperationIds.has("a")).toBe(true);
		expect(restored.appliedOperationIds.has("b")).toBe(true);
	});

	it("evicts the oldest ids beyond its bound while keeping the newest", () => {
		const ids = new BoundedIdSet({ids: [], limit: 3});
		["a", "b", "c", "d"].forEach(id => ids.add(id));
		expect(ids.has("a")).toBe(false);
		expect(ids.has("d")).toBe(true);
	});
});

describe("B/L -> R/F transition", () => {
	it("produces the ADR worked example: base 10, local 8, heal 5 -> R 15, F 13", () => {
		const plan = planOne({
			tracks: {
				accepted: {data: makeCharacter({current: 10, max: 20}), coverage: createCoverage({revision: 4})},
				live: {data: makeCharacter({current: 8, max: 20}), coverage: createCoverage({revision: 4})},
			},
			operation: makeOperation({kind: "hp.heal", args: {amount: 5}}),
		});

		expect(plan.status).toBe(RECONCILE_STATUS.APPLIED);
		expect(plan.staged.accepted.hp.current).toBe(15);
		expect(plan.staged.live.hp.current).toBe(13);
		expect(diffJson(plan.staged.accepted, plan.staged.live)).toEqual([
			{op: "replace", path: "/hp/current", value: 13},
		]);
	});

	it("keeps an unrelated unsaved local edit while applying the operation", () => {
		const live = makeCharacter({current: 10, max: 20});
		live.name = "Mira the Bold";
		const plan = planOne({
			tracks: {
				accepted: {data: makeCharacter({current: 10, max: 20}), coverage: createCoverage({revision: 4})},
				live: {data: live, coverage: createCoverage({revision: 4})},
			},
			operation: makeOperation({kind: "hp.damage", args: {amount: 4}}),
		});
		expect(plan.staged.live).toMatchObject({name: "Mira the Bold", hp: {current: 6}});
		expect(plan.staged.accepted.name).toBe("Mira");
	});

	it("composes two operations in revision order rather than arrival order", () => {
		// Order matters only where a clamp bites: healing first wastes the overheal against the maximum.
		const start = makeCharacter({current: 18, max: 20, temp: 0});
		const damage = makeOperation({kind: "hp.damage", args: {amount: 6}, operationId: "op-damage"});
		const heal = makeOperation({kind: "hp.heal", args: {amount: 4}, operationId: "op-heal"});

		const forward = applySemanticOperation({data: applySemanticOperation({data: start, operation: damage}), operation: heal});
		const reverse = applySemanticOperation({data: applySemanticOperation({data: start, operation: heal}), operation: damage});

		expect(forward.hp.current).toBe(16);
		expect(reverse.hp.current).toBe(14);
	});

	it("applies to a stale live track even when the accepted track already covers the operation", () => {
		// This is the reload case: `pGet` stores freshly fetched canonical truth that already contains the
		// operation, then hands back an older recovery draft as live state.
		const plan = planOne({
			tracks: {
				accepted: {data: makeCharacter({current: 6, max: 20}), coverage: createCoverage({revision: 5})},
				live: {data: makeCharacter({current: 10, max: 20}), coverage: createCoverage({revision: 4})},
			},
			operation: makeOperation({kind: "hp.damage", args: {amount: 4}}),
		});
		expect(plan.status).toBe(RECONCILE_STATUS.APPLIED);
		expect(plan.staged.accepted).toBeUndefined();
		expect(plan.staged.live.hp.current).toBe(6);
	});

	it("requires a resync when any single track cannot prove its coverage", () => {
		const plan = planOne({
			tracks: {
				accepted: {data: makeCharacter(), coverage: createCoverage({revision: 4})},
				live: {data: makeCharacter(), coverage: createCoverage()},
			},
			operation: makeOperation(),
		});
		expect(plan.status).toBe(RECONCILE_STATUS.RESYNC_REQUIRED);
		expect(plan.staged).toBeUndefined();
	});

	it("suppresses a duplicate by event id and by operation id without staging anything", () => {
		const tracks = {accepted: {data: makeCharacter(), coverage: createCoverage({revision: 4})}};
		expect(planOne({tracks, operation: makeOperation(), eventId: "event-1", appliedEventIds: new BoundedIdSet({ids: ["event-1"]})}).status)
			.toBe(RECONCILE_STATUS.SUPPRESSED);
		expect(planOne({tracks, operation: makeOperation(), appliedOperationIds: new BoundedIdSet({ids: ["operation-1"]})}).status)
			.toBe(RECONCILE_STATUS.SUPPRESSED);
	});

	it("blocks without staging when the operation cannot be applied to a track", () => {
		const plan = planOne({
			tracks: {
				accepted: {data: makeCharacter({slots: {1: {current: 0, max: 2}}}), coverage: createCoverage({revision: 4})},
			},
			operation: makeOperation({kind: "spell_slot.spend", args: {level: 1, amount: 1}}),
		});
		expect(plan.status).toBe(RECONCILE_STATUS.BLOCKED);
		expect(plan.error).toMatchObject({code: "RESOURCE_INSUFFICIENT"});
		expect(plan.staged).toBeUndefined();
	});

	it("rejects an invalid resulting revision before touching any track", () => {
		const plan = planAppliedOperation({
			tracks: {accepted: {data: makeCharacter(), coverage: createCoverage({revision: 4})}},
			operation: makeOperation(),
			resultingCharacterRevision: null,
		});
		expect(plan.status).toBe(RECONCILE_STATUS.REJECTED);
	});

	it("never mutates the documents it was given", () => {
		const accepted = makeCharacter({current: 10});
		const live = makeCharacter({current: 8});
		const acceptedBefore = structuredClone(accepted);
		const liveBefore = structuredClone(live);
		planOne({
			tracks: {
				accepted: {data: accepted, coverage: createCoverage({revision: 4})},
				live: {data: live, coverage: createCoverage({revision: 4})},
			},
			operation: makeOperation({kind: "hp.damage", args: {amount: 5}}),
		});
		expect(accepted).toEqual(acceptedBefore);
		expect(live).toEqual(liveBefore);
	});
});
