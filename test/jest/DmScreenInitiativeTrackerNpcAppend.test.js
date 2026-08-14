import "../../js/parser.js";
import "../../js/utils.js";
import {jest} from "@jest/globals";
import {InitiativeTrackerRowDataSerializer} from "../../js/dmscreen/initiativetracker/dmscreen-initiativetracker-serial.js";

globalThis.RenderableCollectionAsyncGenericRows = class {};
globalThis.RenderableCollectionGenericRows = class {};
globalThis.BaseComponent = class {};
globalThis.ListUtilEntity = class {};
const {InitiativeTracker} = await import("../../js/dmscreen/initiativetracker/dmscreen-initiativetracker.js");

describe("Initiative Tracker NPC append API", () => {
	it("appends atomically through the canonical row builder", async () => {
		const tracker = Object.create(InitiativeTracker.prototype);
		tracker._state = {
			isLocked: false,
			rows: [],
			sort: "NUMBER",
			dir: "DESC",
		};
		tracker._rowStateBuilderActive = {
			pGetNewRowState: jest.fn(async meta => ({
				id: `row-${meta.customName}`,
				entity: {
					name: meta.name,
					customName: meta.customName,
					initiative: meta.initiative,
					hpCurrent: meta.hpCurrent,
					hpMax: meta.hpMax,
					hpTemp: meta.hpTemp,
					conditions: meta.conditions,
				},
			})),
		};

		const result = await tracker.pDoAppendNpcTrackerEntries({
			entries: [{
				alias: "Vale",
				monster: {name: "Court Mage", source: "TST"},
				hp: {current: 17, max: 27, temp: 4},
				conditions: ["poisoned"],
				initiative: 19,
			}],
		});

		expect(result).toEqual({ok: true, count: 1});
		expect(tracker._rowStateBuilderActive.pGetNewRowState).toHaveBeenCalledWith(expect.objectContaining({
			customName: "Vale",
			hpCurrent: 17,
			hpMax: 27,
			hpTemp: 4,
			initiative: 19,
		}));
		expect(tracker._state.rows[0].entity.conditions[0].entity).toMatchObject({
			name: "Poisoned",
			color: Parser.CONDITION_TO_COLOR.Poisoned,
		});
	});

	it("rejects locked trackers without constructing rows", async () => {
		const tracker = Object.create(InitiativeTracker.prototype);
		tracker._state = {isLocked: true, rows: []};
		tracker._rowStateBuilderActive = {pGetNewRowState: jest.fn()};

		await expect(tracker.pDoAppendNpcTrackerEntries({entries: [{}]})).resolves.toEqual({
			ok: false,
			message: "Initiative Tracker is locked.",
		});
		expect(tracker._rowStateBuilderActive.pGetNewRowState).not.toHaveBeenCalled();
	});

	it("does not mutate the tracker when any row cannot be constructed", async () => {
		const rows = [{id: "existing", entity: {name: "Existing"}}];
		const tracker = Object.create(InitiativeTracker.prototype);
		tracker._state = {isLocked: false, rows, sort: "NUMBER", dir: "DESC"};
		tracker._rowStateBuilderActive = {
			pGetNewRowState: jest.fn()
				.mockResolvedValueOnce({id: "first", entity: {initiative: 20}})
				.mockResolvedValueOnce(null),
		};

		const result = await tracker.pDoAppendNpcTrackerEntries({
			entries: [
				{monster: {name: "First", source: "TST"}, initiative: 20},
				{monster: {name: "Second", source: "TST"}, initiative: 10},
			],
		});

		expect(result).toEqual({ok: false, message: "Could not add \"Second\"."});
		expect(tracker._state.rows).toBe(rows);
	});

	it("round-trips temporary HP through row serialization", () => {
		const monster = {name: "Court Mage", source: "TST", dex: 14};
		const serialized = InitiativeTrackerRowDataSerializer.toSerial({
			id: "row",
			entity: {
				name: "Court Mage",
				source: "TST",
				monster,
				hpCurrent: 17,
				hpMax: 27,
				hpTemp: 4,
				conditions: [],
				rowStatColData: [],
			},
		});
		expect(serialized.ht).toBe(4);
		expect(serialized.mon).toEqual(monster);
		expect(InitiativeTrackerRowDataSerializer.fromSerial(serialized).entity).toMatchObject({hpTemp: 4, monster});
	});

	it("consumes temporary HP before current HP and restores both on undo", () => {
		globalThis.UiUtil = {
			getStrNumericModified: () => ({mode: "delta", next: -10, delta: -10}),
		};
		const tracker = Object.create(InitiativeTracker.prototype);
		tracker._state = {
			isLocked: false,
			rows: [{id: "npc", entity: {hpCurrent: 20, hpMax: 20, hpTemp: 4}}],
		};
		tracker._selectedRowIds = new Set(["npc"]);
		tracker._hpApplyUndoStack = [];
		tracker._selectionBarRefs = null;

		expect(tracker._applyHpToSelection({raw: "10", isHalf: false})).toEqual({ok: true, count: 1});
		expect(tracker._state.rows[0].entity).toMatchObject({hpCurrent: 14, hpTemp: 0});

		expect(tracker._undoLastHpApply()).toEqual({ok: true, count: 1});
		expect(tracker._state.rows[0].entity).toMatchObject({hpCurrent: 20, hpTemp: 4});
	});
});
