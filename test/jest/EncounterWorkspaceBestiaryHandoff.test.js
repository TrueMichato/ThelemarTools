import {jest} from "@jest/globals";
import {
	stageBestiaryEncounterHandoff,
	takeBestiaryEncounterHandoff,
} from "../../js/encounterworkspace/encounterworkspace-bestiary-handoff.js";

const getStorage = () => {
	const values = new Map();
	return {
		pending: () => values.get("bestiaryEncounterHandoff"),
		setItem: jest.fn((key, value) => values.set(key, value)),
		getItem: jest.fn(key => values.get(key)),
		removeItem: jest.fn(key => values.delete(key)),
	};
};

describe("Bestiary encounter one-shot handoff", () => {
	it("carries an unsaved roster with exact counts and variant hashes, but no unrelated builder state", () => {
		const storage = getStorage();
		const token = stageBestiaryEncounterHandoff({
			storage,
			token: "first",
			exportedSublist: {
				items: [{h: "goblin_mm", c: 2}, {h: "goblin_mm", c: 1, customHashId: "goblin__mm__2__"}],
				statePartyComps: {private: "not part of the roster"},
			},
		});
		expect(token).toBe("first");
		expect(takeBestiaryEncounterHandoff({storage, token})).toEqual({
			name: "Current Bestiary Encounter",
			saveId: "",
			items: [{h: "goblin_mm", c: 2}, {h: "goblin_mm", c: 1, customHashId: "goblin__mm__2__"}],
		});
		expect(storage.pending()).toBeUndefined();
		expect(() => takeBestiaryEncounterHandoff({storage, token})).toThrow(/missing or has already been opened/);
	});

	it("keeps a saved active encounter's name and ID while using its live, possibly edited roster", () => {
		const storage = getStorage();
		stageBestiaryEncounterHandoff({
			storage,
			token: "saved",
			exportedSublist: {name: "Goblin Ambush", saveId: "save-1", items: [{h: "goblin_mm", c: 3}]},
		});
		expect(takeBestiaryEncounterHandoff({storage, token: "saved"})).toMatchObject({
			name: "Goblin Ambush", saveId: "save-1", items: [{h: "goblin_mm", c: 3}],
		});
	});

	it("never opens a stale token or deletes a newer encounter staged in the same tab", () => {
		const storage = getStorage();
		const exportedSublist = {items: [{h: "goblin_mm"}]};
		stageBestiaryEncounterHandoff({storage, token: "old", exportedSublist});
		stageBestiaryEncounterHandoff({storage, token: "new", exportedSublist});
		expect(() => takeBestiaryEncounterHandoff({storage, token: "old"})).toThrow(/no longer current/);
		expect(takeBestiaryEncounterHandoff({storage, token: "new"}).items).toHaveLength(1);
	});

	it("rejects empty, invalid, or damaged handoffs without presenting an empty success", () => {
		const storage = getStorage();
		expect(() => stageBestiaryEncounterHandoff({storage, token: "empty", exportedSublist: {items: []}})).toThrow(/Add creatures/);
		expect(() => stageBestiaryEncounterHandoff({
			storage,
			token: "invalid",
			exportedSublist: {items: [{h: "goblin_mm", c: "no count"}]},
		})).toThrow(/unsupported creature/);
		expect(storage.setItem).not.toHaveBeenCalled();
		storage.setItem("bestiaryEncounterHandoff", "{broken");
		expect(() => takeBestiaryEncounterHandoff({storage, token: "invalid"})).toThrow(/damaged/);
		expect(storage.pending()).toBeUndefined();
		storage.setItem("bestiaryEncounterHandoff", JSON.stringify({version: 99, token: "invalid", exportedSublist: {items: []}}));
		expect(() => takeBestiaryEncounterHandoff({storage, token: "invalid"})).toThrow(/incomplete or unsupported/);
	});

	it("reports unavailable tab storage and leaves navigation to the caller", () => {
		const storage = getStorage();
		storage.setItem.mockImplementation(() => { throw new Error("Storage blocked"); });
		expect(() => stageBestiaryEncounterHandoff({
			storage, token: "blocked", exportedSublist: {items: [{h: "goblin_mm"}]},
		})).toThrow("Storage blocked");
	});
});
