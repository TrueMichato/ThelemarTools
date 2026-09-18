import "./setup.js";
import {jest} from "@jest/globals";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

let CharacterSheetPage;
let CharacterSheetState;

const getDeferred = () => {
	let resolve;
	const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
	return {promise, resolve};
};

beforeAll(async () => {
	globalThis.window = {
		addEventListener: () => {},
		location: new URL("http://test/charactersheet.html"),
		history: {replaceState: jest.fn()},
	};
	globalThis.document = globalThis.document || {
		getElementById: () => null,
		querySelector: () => null,
		addEventListener: () => {},
	};
	CharacterSheetState = (await import(`${REPO_ROOT}js/charactersheet/charactersheet-state.js`)).CharacterSheetState;
	CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
});

describe("CharacterSheetPage transfer controller", () => {
	it("loads a character with no repairs or new transfers without using the obsolete item-only result", async () => {
		const originalPGet = globalThis.StorageUtil.pGet;
		globalThis.StorageUtil.pGet = jest.fn(async key => key === "charsheet-characters"
			? [{id: "char-a", name: "A"}]
			: null);

		const page = Object.create(CharacterSheetPage.prototype);
		page._state = new CharacterSheetState();
		page._readActiveCharacterMirror = jest.fn(() => null);
		page._pApplyPendingCharacterTransfers = jest.fn(async () => [{
			config: {kind: "item"},
			result: {applied: [], acknowledgeIds: [], failed: []},
		}]);
		page._reconcileClassFeatures = jest.fn(() => ({added: 0, backfilled: 0}));
		page._ensureLinguisticsSkillIfNeeded = jest.fn();
		page._renderCharacter = jest.fn();
		page._pAcknowledgeCharacterTransfers = jest.fn(async () => {});
		page._saveCurrentCharacter = jest.fn(async () => true);
		page._clearActiveCharacterMirror = jest.fn();
		page._applyBackgroundTheme = jest.fn();
		page._updateThemePickerSelection = jest.fn();
		page._layout = null;
		page._playMode = null;

		try {
			await expect(page._pLoadCharacter("char-a")).resolves.toBeUndefined();
			expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(page._pAcknowledgeCharacterTransfers).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.StorageUtil.pGet = originalPGet;
		}
	});

	it("keeps an older load isolated when its delayed transfer finishes after a newer character loads", async () => {
		const originalPGet = globalThis.StorageUtil.pGet;
		globalThis.StorageUtil.pGet = jest.fn(async key => key === "charsheet-characters"
			? [{id: "char-a", name: "A"}, {id: "char-b", name: "B"}]
			: null);

		const page = Object.create(CharacterSheetPage.prototype);
		page._state = new CharacterSheetState();
		page._readActiveCharacterMirror = jest.fn(() => null);
		page._reconcileClassFeatures = jest.fn(() => ({added: 0, backfilled: 0}));
		page._ensureLinguisticsSkillIfNeeded = jest.fn();
		page._saveCurrentCharacter = jest.fn(async () => true);
		page._clearActiveCharacterMirror = jest.fn();
		page._applyBackgroundTheme = jest.fn();
		page._updateThemePickerSelection = jest.fn();
		page._layout = null;
		page._playMode = null;

		let pendingTransfers = [{id: "transfer-a", characterId: "char-a"}];
		const Transfer = {
			pAcknowledge: jest.fn(async ({transferIds}) => {
				pendingTransfers = pendingTransfers.filter(transfer => !transferIds.includes(transfer.id));
			}),
		};
		const applicationStarted = getDeferred();
		const releaseApplication = getDeferred();
		page._pApplyPendingCharacterTransfers = jest.fn(async ({characterId, state}) => {
			if (characterId === "char-a") {
				applicationStarted.resolve();
				await releaseApplication.promise;
				state.addItem({name: "Rope", source: "PHB", type: "gear"}, 1);
				return [{
					config: {
						kind: "item",
						labelPlural: "items",
						Transfer,
						fnGetName: transfer => transfer.item?.name || "Item",
					},
					result: {
						applied: [{id: "transfer-a", item: {name: "Rope"}}],
						acknowledgeIds: ["transfer-a"],
						failed: [],
					},
				}];
			}
			return [{
				config: {
					kind: "item",
					labelPlural: "items",
					Transfer,
					fnGetName: transfer => transfer.item?.name || "Item",
				},
				result: {applied: [], acknowledgeIds: [], failed: []},
			}];
		});
		const renderedNames = [];
		page._renderCharacter = jest.fn(() => renderedNames.push(page._state.getName()));

		try {
			const loadA = page._pLoadCharacter("char-a");
			await applicationStarted.promise;
			const loadB = page._pLoadCharacter("char-b");
			await loadB;
			releaseApplication.resolve();
			await loadA;

			expect(page._currentCharacterId).toBe("char-b");
			expect(page._state.getName()).toBe("B");
			expect(page._state.getItems()).toEqual([]);
			expect(renderedNames).toEqual(["B"]);
			expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(Transfer.pAcknowledge.mock.calls.some(([arg]) => arg.transferIds.includes("transfer-a"))).toBe(false);
			expect(pendingTransfers).toEqual([{id: "transfer-a", characterId: "char-a"}]);
		} finally {
			globalThis.StorageUtil.pGet = originalPGet;
		}
	});

	it("keeps the notified character ID while waiting for serialized live processing", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._currentCharacterId = "char-a";
		page._state = new CharacterSheetState();
		page._pApplyPendingCharacterTransfers = jest.fn();

		const previous = getDeferred();
		page._pLiveCharacterTransferLock = previous.promise;
		const processing = page._pApplyLiveCharacterTransfers({characterId: "char-a"});
		page._currentCharacterId = "char-b";
		page._state.loadFromJson({id: "char-b", name: "B"});
		previous.resolve();

		await processing;
		expect(page._pApplyPendingCharacterTransfers).not.toHaveBeenCalled();
		expect(page._state.getName()).toBe("B");
	});

	it("does not mutate, render, save, or acknowledge after a character switch during transfer application", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._currentCharacterId = "char-a";
		page._state = new CharacterSheetState();
		page._state.loadFromJson({id: "char-a", name: "A"});
		page._renderCharacter = jest.fn();
		page._saveCurrentCharacter = jest.fn(async () => true);

		let pendingTransfers = [{id: "transfer-a", characterId: "char-a"}];
		const Transfer = {
			pAcknowledge: jest.fn(async ({transferIds}) => {
				pendingTransfers = pendingTransfers.filter(transfer => !transferIds.includes(transfer.id));
			}),
		};
		const applicationStarted = getDeferred();
		const releaseApplication = getDeferred();
		page._pApplyPendingCharacterTransfers = jest.fn(async ({state}) => {
			applicationStarted.resolve();
			await releaseApplication.promise;
			state.addItem({name: "Rope", source: "PHB", type: "gear"}, 1);
			return [{
				config: {
					kind: "item",
					labelPlural: "items",
					Transfer,
					fnGetName: transfer => transfer.item?.name || "Item",
				},
				result: {
					applied: [{id: "transfer-a", item: {name: "Rope"}}],
					acknowledgeIds: ["transfer-a"],
					failed: [],
				},
			}];
		});

		const processing = page._pApplyLiveCharacterTransfers({characterId: "char-a"});
		await applicationStarted.promise;
		page._currentCharacterId = "char-b";
		page._state.loadFromJson({id: "char-b", name: "B"});
		releaseApplication.resolve();
		await processing;

		expect(page._state.getName()).toBe("B");
		expect(page._state.getItems()).toEqual([]);
		expect(page._renderCharacter).not.toHaveBeenCalled();
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(Transfer.pAcknowledge).not.toHaveBeenCalled();
		expect(pendingTransfers).toEqual([{id: "transfer-a", characterId: "char-a"}]);
	});

	it("rebases a delayed live transfer onto same-character edits and acknowledges it once", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._currentCharacterId = "char-a";
		page._characterLoadGeneration = 4;
		page._state = new CharacterSheetState();
		page._state.loadFromJson({id: "char-a", name: "A"});
		page._renderCharacter = jest.fn();
		page._saveCurrentCharacter = jest.fn(async () => true);

		let pendingTransfers = [{id: "transfer-a", characterId: "char-a"}];
		const Transfer = {
			pAcknowledge: jest.fn(async ({transferIds}) => {
				pendingTransfers = pendingTransfers.filter(transfer => !transferIds.includes(transfer.id));
			}),
		};
		const applicationStarted = getDeferred();
		const releaseApplication = getDeferred();
		let applyCount = 0;
		page._pApplyPendingCharacterTransfers = jest.fn(async ({state}) => {
			applyCount++;
			if (applyCount === 1) {
				applicationStarted.resolve();
				await releaseApplication.promise;
			}
			state.addItem({name: "Rope", source: "PHB", type: "gear"}, 1);
			return [{
				config: {
					kind: "item",
					labelPlural: "items",
					Transfer,
					fnGetName: transfer => transfer.item?.name || "Item",
				},
				result: {
					applied: [{id: "transfer-a", item: {name: "Rope"}}],
					acknowledgeIds: ["transfer-a"],
					failed: [],
				},
			}];
		});

		const processing = page._pApplyLiveCharacterTransfers({characterId: "char-a"});
		await applicationStarted.promise;
		page._state.setName("A edited");
		releaseApplication.resolve();
		await processing;

		expect(page._pApplyPendingCharacterTransfers).toHaveBeenCalledTimes(2);
		expect(page._state.getName()).toBe("A edited");
		expect(page._state.getItems()).toHaveLength(1);
		expect(page._state.getItems()[0].name).toBe("Rope");
		expect(page._renderCharacter).toHaveBeenCalledTimes(1);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(Transfer.pAcknowledge).toHaveBeenCalledTimes(1);
		expect(Transfer.pAcknowledge).toHaveBeenCalledWith(expect.objectContaining({transferIds: ["transfer-a"]}));
		expect(pendingTransfers).toEqual([]);
	});

	it("leaves a live transfer pending and surfaces retry semantics after repeated edit conflicts", async () => {
		const originalDoToast = globalThis.JqueryUtil.doToast;
		globalThis.JqueryUtil.doToast = jest.fn();

		const page = Object.create(CharacterSheetPage.prototype);
		page._currentCharacterId = "char-a";
		page._characterLoadGeneration = 2;
		page._state = new CharacterSheetState();
		page._state.loadFromJson({id: "char-a", name: "A"});
		page._renderCharacter = jest.fn();
		page._saveCurrentCharacter = jest.fn(async () => true);

		const pendingTransfers = [{id: "transfer-a", characterId: "char-a"}];
		const Transfer = {pAcknowledge: jest.fn()};
		let applyCount = 0;
		page._pApplyPendingCharacterTransfers = jest.fn(async ({state}) => {
			applyCount++;
			state.addItem({name: "Rope", source: "PHB", type: "gear"}, 1);
			page._state.setName(`Edit ${applyCount}`);
			return [{
				config: {
					kind: "item",
					labelPlural: "items",
					Transfer,
					fnGetName: transfer => transfer.item?.name || "Item",
				},
				result: {
					applied: [{id: "transfer-a", item: {name: "Rope"}}],
					acknowledgeIds: ["transfer-a"],
					failed: [],
				},
			}];
		});

		try {
			await page._pApplyLiveCharacterTransfers({characterId: "char-a"});

			expect(page._pApplyPendingCharacterTransfers).toHaveBeenCalledTimes(4);
			expect(page._state.getName()).toBe("Edit 4");
			expect(page._state.getItems()).toEqual([]);
			expect(page._renderCharacter).not.toHaveBeenCalled();
			expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
			expect(Transfer.pAcknowledge).not.toHaveBeenCalled();
			expect(pendingTransfers).toEqual([{id: "transfer-a", characterId: "char-a"}]);
			expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringContaining("remains queued"),
			}));
		} finally {
			globalThis.JqueryUtil.doToast = originalDoToast;
		}
	});

	it("does not save or acknowledge the transfer if the character switches during persistence", async () => {
		const originalPGet = globalThis.StorageUtil.pGet;
		const originalPSet = globalThis.StorageUtil.pSet;
		const persistenceStarted = getDeferred();
		const releasePersistence = getDeferred();
		globalThis.StorageUtil.pGet = jest.fn(async key => {
			if (key !== "charsheet-characters") return null;
			persistenceStarted.resolve();
			await releasePersistence.promise;
			return [{id: "char-a", name: "A"}, {id: "char-b", name: "B"}];
		});
		globalThis.StorageUtil.pSet = jest.fn(async () => {});

		const page = Object.create(CharacterSheetPage.prototype);
		page._currentCharacterId = "char-a";
		page._state = new CharacterSheetState();
		page._state.loadFromJson({id: "char-a", name: "A"});
		page._renderCharacter = jest.fn();
		page._updateSaveIndicator = jest.fn();
		page._writeActiveCharacterMirror = jest.fn();
		page._clearActiveCharacterMirror = jest.fn();

		let pendingTransfers = [{id: "transfer-a", characterId: "char-a"}];
		const Transfer = {
			pAcknowledge: jest.fn(async ({transferIds}) => {
				pendingTransfers = pendingTransfers.filter(transfer => !transferIds.includes(transfer.id));
			}),
		};
		page._pApplyPendingCharacterTransfers = jest.fn(async ({state}) => {
			state.addItem({name: "Rope", source: "PHB", type: "gear"}, 1);
			return [{
				config: {
					kind: "item",
					labelPlural: "items",
					Transfer,
					fnGetName: transfer => transfer.item?.name || "Item",
				},
				result: {
					applied: [{id: "transfer-a", item: {name: "Rope"}}],
					acknowledgeIds: ["transfer-a"],
					failed: [],
				},
			}];
		});

		try {
			const processing = page._pApplyLiveCharacterTransfers({characterId: "char-a"});
			await persistenceStarted.promise;
			page._currentCharacterId = "char-b";
			page._state.loadFromJson({id: "char-b", name: "B"});
			releasePersistence.resolve();
			await processing;

			expect(page._state.getName()).toBe("B");
			expect(page._state.getItems()).toEqual([]);
			expect(page._renderCharacter).toHaveBeenCalledTimes(1);
			expect(globalThis.StorageUtil.pSet).not.toHaveBeenCalled();
			expect(Transfer.pAcknowledge).not.toHaveBeenCalled();
			expect(pendingTransfers).toEqual([{id: "transfer-a", characterId: "char-a"}]);
		} finally {
			globalThis.StorageUtil.pGet = originalPGet;
			globalThis.StorageUtil.pSet = originalPSet;
		}
	});
});
