import "./setup.js";
import {jest} from "@jest/globals";

let CharacterSheetPage;
let CharacterSheetSpells;
let CharacterSheetModal;
let originalWindow;

beforeAll(async () => {
	originalWindow = globalThis.window;
	globalThis.window = {addEventListener: jest.fn()};
	CharacterSheetPage = (await import("../../../js/charactersheet/charactersheet.js")).CharacterSheetPage;
	CharacterSheetSpells = (await import("../../../js/charactersheet/charactersheet-spells.js")).CharacterSheetSpells;
	CharacterSheetModal = (await import("../../../js/charactersheet/charactersheet-modal.js")).CharacterSheetModal;
});

afterAll(() => {
	if (originalWindow === undefined) delete globalThis.window;
	else globalThis.window = originalWindow;
});

describe("character-scoped async companion pickers", () => {
	it("does not open or mutate from a beast load after the originating character changes", async () => {
		let resolveCandidates;
		const candidates = new Promise(resolve => resolveCandidates = resolve);
		let isCurrent = true;
		const addCompanionFromBestiary = jest.fn();
		const originalGetUserEnum = globalThis.InputUiUtil.pGetUserEnum;
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async () => "Wolf (CR 1/4)");
		const host = {
			_pGetWildShapeBeastCandidates: async () => candidates,
			_getCharacterScopeSnapshot: () => ({characterId: "character-a", loadGeneration: 1, accessMode: "owner"}),
			_isCharacterScopeSnapshotCurrent: () => isCurrent,
			_state: {addCompanionFromBestiary},
		};

		try {
			const pending = CharacterSheetPage.prototype._pShowBeastPicker.call(host);
			isCurrent = false;
			resolveCandidates([{name: "Wolf", cr: "1/4"}]);
			await pending;

			expect(globalThis.InputUiUtil.pGetUserEnum).not.toHaveBeenCalled();
			expect(addCompanionFromBestiary).not.toHaveBeenCalled();
		} finally {
			globalThis.InputUiUtil.pGetUserEnum = originalGetUserEnum;
		}
	});

	it("does not open a familiar picker after its bestiary load becomes stale", async () => {
		let resolveBestiary;
		const bestiary = new Promise(resolve => resolveBestiary = resolve);
		let isCurrent = true;
		const originalDataLoader = globalThis.DataLoader;
		const originalGetShow = CharacterSheetModal.pGetShow;
		globalThis.DataLoader = {pCacheAndGetAllSite: jest.fn(async () => bestiary)};
		CharacterSheetModal.pGetShow = jest.fn();
		const host = {
			_page: {
				_getCharacterScopeSnapshot: () => ({characterId: "character-a", loadGeneration: 1, accessMode: "owner"}),
				_isCharacterScopeSnapshotCurrent: () => isCurrent,
			},
			_state: {getFeatureCalculations: () => ({})},
		};

		try {
			const pending = CharacterSheetSpells.prototype._pShowFamiliarPicker.call(host);
			isCurrent = false;
			resolveBestiary([]);
			await pending;

			expect(globalThis.DataLoader.pCacheAndGetAllSite).toHaveBeenCalledTimes(1);
			expect(CharacterSheetModal.pGetShow).not.toHaveBeenCalled();
		} finally {
			if (originalDataLoader === undefined) delete globalThis.DataLoader;
			else globalThis.DataLoader = originalDataLoader;
			CharacterSheetModal.pGetShow = originalGetShow;
		}
	});

	it("does not mutate when a retained familiar selection belongs to a stale scope", async () => {
		const state = {
			getCompanionsByType: jest.fn(),
			removeCompanion: jest.fn(),
			addCompanionFromBestiary: jest.fn(),
		};
		const page = {
			_isCharacterScopeSnapshotCurrent: () => false,
			saveCharacter: jest.fn(),
		};

		await CharacterSheetSpells.prototype._selectFamiliar.call({_state: state, _page: page}, {name: "Owl"}, {
			characterScope: {characterId: "character-a", loadGeneration: 1, accessMode: "owner"},
		});

		expect(state.getCompanionsByType).not.toHaveBeenCalled();
		expect(state.removeCompanion).not.toHaveBeenCalled();
		expect(state.addCompanionFromBestiary).not.toHaveBeenCalled();
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});
});
