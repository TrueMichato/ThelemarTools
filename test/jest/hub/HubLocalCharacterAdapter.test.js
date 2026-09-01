import {pGetLocalCharacters} from "../../../js/hub/hub-local-character-adapter.js";

describe("Hub local character adapter", () => {
	it("reads the Character Sheet collection without loading the general utility stack", async () => {
		let requestedKey = null;
		const getItem = async key => {
			requestedKey = key;
			return [{id: "local-1", name: "Rowan"}];
		};

		await expect(pGetLocalCharacters({storage: {getItem}}))
			.resolves.toEqual([{id: "local-1", name: "Rowan"}]);
		expect(requestedKey).toBe("charsheet-characters");
	});

	it("rejects malformed local storage instead of treating it as an empty list", async () => {
		await expect(pGetLocalCharacters({storage: {getItem: async () => ({name: "invalid"})}}))
			.rejects.toThrow("Local character storage contains invalid data.");
	});
});
