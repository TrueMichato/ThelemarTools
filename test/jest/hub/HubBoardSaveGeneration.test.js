import {jest} from "@jest/globals";

import {
	hasPendingDmScreenSave,
	markDmScreenSavePending,
	pDoDmScreenWorkspaceSave,
} from "../../../js/dmscreen/dmscreen-workspace-persistence.js";

describe("cloud Board navigation guard", () => {
	it("keeps a newer edit pending when an older save settles", async () => {
		let resolveFirst;
		const firstSave = new Promise(resolve => resolveFirst = resolve);
		const board = {
			_isPersistenceFenced: false,
			_saveGeneration: 0,
			_savedGeneration: 0,
			_workspaceRepository: {
				pSet: jest.fn()
					.mockImplementationOnce(() => firstSave)
					.mockResolvedValueOnce(undefined),
			},
			getSaveableState: jest.fn(() => ({panels: []})),
		};

		expect(markDmScreenSavePending({board})).toBe(true);
		const pendingFirst = pDoDmScreenWorkspaceSave({board, saveGeneration: board._saveGeneration});
		expect(hasPendingDmScreenSave({board})).toBe(true);

		expect(markDmScreenSavePending({board})).toBe(true);
		resolveFirst();
		await pendingFirst;
		expect(hasPendingDmScreenSave({board})).toBe(true);

		await pDoDmScreenWorkspaceSave({board, saveGeneration: board._saveGeneration});
		expect(hasPendingDmScreenSave({board})).toBe(false);
		expect(board._workspaceRepository.pSet).toHaveBeenCalledTimes(2);
	});

	it("rejects new pending work after private persistence is fenced", () => {
		const board = {
			_isPersistenceFenced: true,
			_saveGeneration: 2,
			_savedGeneration: 1,
		};

		expect(markDmScreenSavePending({board})).toBe(false);
		expect(board._saveGeneration).toBe(2);
		expect(hasPendingDmScreenSave({board})).toBe(false);
	});
});
