import {jest} from "@jest/globals";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../js/utils-list.js", import.meta.url), "utf8");

function getManagerTestContext () {
	const stored = {
		state: {
			activeId: "saved-a",
			saves: [{
				id: "saved-a",
				entity: {name: "Saved encounter", saveId: "list-a", manager_isSaved: true, items: [{h: "goblin_mm", c: 2}]},
			}],
		},
	};
	const storage = {
		pGetForPage: jest.fn(async () => stored),
		pSetForPage: jest.fn(async () => {}),
		pRemoveForPage: jest.fn(async () => {}),
	};
	const context = {
		BaseComponent: class {
			constructor () { this._state = {}; }
			setBaseSaveableStateFrom (value) { this._state = value.state; }
			getBaseSaveableState () { return {state: this._state}; }
		},
		RenderableCollectionGenericRows: class {},
		RenderableCollectionBase: class {},
		MiscUtil: {debounce: fn => fn, copyFast: value => structuredClone(value)},
		StorageUtil: storage,
		UrlUtil: {PG_BESTIARY: "bestiary.html"},
		VeCt: {DUR_DEBOUNCE_SAVE: 50},
		CryptUtil: {uid: () => "random-id"},
	};
	vm.runInNewContext("Array.prototype.pSerialAwaitMap = async function (fn) { const out = []; for (const item of this) out.push(await fn(item)); return out; };", context);
	vm.runInNewContext(`${src}\nglobalThis.SaveManager = SaveManager;`, context);
	return {SaveManager: context.SaveManager, stored, storage};
}

describe("Saved Bestiary list selection is storage-read-only", () => {
	it("does not run migrations or mutate source storage while loading", async () => {
		const {SaveManager, stored, storage} = getManagerTestContext();
		const migrate = jest.fn(async value => {
			value.state.saves[0].entity.name = "Migrated";
			return true;
		});
		SaveManager._LEGACY_MIGRATOR.registerLegacyMigration(migrate);

		const manager = new SaveManager({
			isReadOnlyUi: true,
			isStorageReadOnly: true,
			page: "bestiary.html",
		});
		await manager.pMutStateFromStorage();
		expect(await manager.pHasSaves()).toBe(true);
		expect(migrate).not.toHaveBeenCalled();
		expect(stored.state.saves[0].entity.name).toBe("Saved encounter");
		manager._state.saves[0].entity.name = "Session-only edit";
		expect(stored.state.saves[0].entity.name).toBe("Saved encounter");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		await expect(manager.pDoSaveStateToStorage()).rejects.toThrow(/storage-read-only/);
		await expect(manager.pDoRemoveStateFromStorage()).rejects.toThrow(/storage-read-only/);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(storage.pRemoveForPage).not.toHaveBeenCalled();
	});

	it("preserves the normal writable migration path", async () => {
		const {SaveManager, storage} = getManagerTestContext();
		SaveManager._LEGACY_MIGRATOR.registerLegacyMigration(async () => true);
		const manager = new SaveManager({page: "bestiary.html"});
		await manager.pMutStateFromStorage();
		expect(storage.pSetForPage).toHaveBeenCalledWith("listSaveManager", expect.anything(), {page: "bestiary.html"});
	});
});
