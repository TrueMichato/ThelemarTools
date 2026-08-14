import "../charactersheet/setup.js";
import {jest} from "@jest/globals";
import {ItemBuilderHandoff} from "../../../js/itembuilder/itembuilder-handoff.js";

function getStorage (initial = null) {
	let value = initial;
	return {
		pGet: jest.fn(async () => value),
		pSet: jest.fn(async (key, next) => {
			value = structuredClone(next);
		}),
		pRemove: jest.fn(async () => {
			value = null;
		}),
		get value () { return value; },
	};
}

describe("ItemBuilderHandoff", () => {
	test("stores a normalized draft and consumes it exactly once", async () => {
		const storage = getStorage();
		const draft = {
			preset: {name: "Longsword", source: "PHB"},
			material: {name: "Starsteel", source: "TGTT"},
			upgrades: [{name: "Balanced", source: "TCAH"}],
			gemstone: {name: "Journey", source: "TGTT"},
			item: {
				name: "Wayfarer's Blade",
				source: "HB",
				type: "M",
				entries: ["Advanced description."],
				bonusAc: 2,
				uniqueId: "dm-panel-id",
			},
		};

		await ItemBuilderHandoff.pStore({draft, storage});
		expect(storage.pSet).toHaveBeenCalledWith(
			ItemBuilderHandoff.STORAGE_KEY,
			expect.objectContaining({version: ItemBuilderHandoff.VERSION}),
		);
		expect(storage.value.draft.item).not.toHaveProperty("uniqueId");

		const consumed = await ItemBuilderHandoff.pConsume({storage});
		expect(consumed).toEqual(expect.objectContaining({
			status: "success",
			draft: expect.objectContaining({
				preset: draft.preset,
				material: draft.material,
				upgrades: draft.upgrades,
				gemstone: draft.gemstone,
				item: expect.objectContaining({
					name: "Wayfarer's Blade",
					entries: ["Advanced description."],
					bonusAc: 2,
				}),
			}),
		}));
		expect(storage.pRemove).toHaveBeenCalledTimes(1);
		await expect(ItemBuilderHandoff.pConsume({storage})).resolves.toEqual({status: "empty"});
	});

	test.each([
		["malformed", {version: ItemBuilderHandoff.VERSION, draft: "bad"}, /malformed/i],
		["unsupported", {version: ItemBuilderHandoff.VERSION + 1, draft: {item: {}}}, /not supported/i],
	])("removes a %s handoff and returns recovery guidance", async (name, stored, message) => {
		const storage = getStorage(stored);

		const result = await ItemBuilderHandoff.pConsume({storage});

		expect(result.status).toBe("error");
		expect(result.message).toMatch(message);
		expect(result.message).toMatch(/DM Screen/i);
		expect(storage.pRemove).toHaveBeenCalledTimes(1);
		expect(storage.value).toBeNull();
	});
});
