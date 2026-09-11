import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {CharacterSheetItemUtils} from "../../../js/charactersheet/charactersheet-item-utils.js";
import {CharacterSheetItemTransfer} from "../../../js/charactersheet/charactersheet-item-transfer.js";
import {CharacterSheetState} from "../../../js/charactersheet/charactersheet-state.js";

function getStorage (characters = []) {
	const data = new Map([["charsheet-characters", MiscUtil.copyFast(characters)]]);
	return {
		data,
		async pGet (key) {
			return data.has(key) ? MiscUtil.copyFast(data.get(key)) : null;
		},
		async pSet (key, value) {
			data.set(key, MiscUtil.copyFast(value));
		},
	};
}

describe("CharacterSheetItemUtils", () => {
	it("normalizes catalog weapons without losing attunement or mechanics", () => {
		const state = new CharacterSheetState();
		const normalized = CharacterSheetItemUtils.getNormalizedCatalogItem({
			state,
			item: {
				name: "Test Blade",
				source: "TST",
				type: "M",
				weaponCategory: "martial",
				property: ["V"],
				dmg1: "1d8",
				dmg2: "1d10",
				dmgType: "S",
				reqAttune: true,
				bonusWeapon: "+2",
				entries: ["A test weapon."],
			},
		});

		expect(normalized).toMatchObject({
			name: "Test Blade",
			source: "TST",
			type: "weapon",
			typeCode: "M",
			weapon: true,
			requiresAttunement: true,
			properties: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			bonusWeapon: 2,
			equipped: false,
			attuned: false,
		});
	});

	it("uses canonical composition data instead of projected preview values", () => {
		const state = new CharacterSheetState();
		const normalized = CharacterSheetItemUtils.getNormalizedCatalogItem({
			state,
			item: {
				name: "Projected Sword",
				source: "TST",
				dmg1: "2d8",
				_compositionRaw: {
					name: "Authored Sword",
					source: "TST",
					type: "M",
					dmg1: "1d8",
					dmgType: "S",
					material: {name: "Mithril", source: "TGTT"},
				},
			},
		});

		expect(normalized.name).toBe("Authored Sword");
		expect(normalized.dmg1).toBe("1d8");
		expect(normalized.material).toEqual({name: "Mithril", source: "TGTT"});
	});
});

describe("CharacterSheetItemTransfer", () => {
	it("queues, applies, and acknowledges a transfer exactly once", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar", classes: [{name: "Fighter", level: 5}]}]);
		const transfer = await CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "char-1",
			item: {
				name: "Longsword +1",
				source: "DMG",
				type: "M",
				dmg1: "1d8",
				dmgType: "S",
				reqAttune: true,
				bonusWeapon: "+1",
			},
		});

		const state = new CharacterSheetState();
		const first = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});
		const second = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(first.applied).toHaveLength(1);
		expect(second.applied).toHaveLength(0);
		expect(state.getItems()).toEqual([
			expect.objectContaining({
				name: "Longsword +1",
				quantity: 1,
				equipped: false,
				attuned: false,
				requiresAttunement: true,
				weapon: true,
			}),
		]);

		await CharacterSheetItemTransfer.pAcknowledge({
			storage,
			transferIds: [transfer.id],
		});
		expect(await storage.pGet(CharacterSheetItemTransfer.STORAGE_KEY)).toEqual([]);
	});

	it("uses the sheet's existing stacking rules for separate transfers", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		const item = {name: "Arrow", source: "PHB", type: "A"};
		await CharacterSheetItemTransfer.pQueue({storage, characterId: "char-1", item});
		await CharacterSheetItemTransfer.pQueue({storage, characterId: "char-1", item});

		const state = new CharacterSheetState();
		const result = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(result.applied).toHaveLength(2);
		expect(state.getItems()).toEqual([
			expect.objectContaining({name: "Arrow", quantity: 2}),
		]);
	});

	it("preserves state-owned vestige detection through a transfer", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		await CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "char-1",
			item: {
				name: "Blade of Broken Mirrors (Dormant)",
				source: "EGW",
				type: "M",
			},
		});

		const state = new CharacterSheetState();
		await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(state.getItems()).toEqual([
			expect.objectContaining({
				name: "Blade of Broken Mirrors (Dormant)",
				vestigeTier: "dormant",
			}),
		]);
	});

	it("preserves state-owned spell-storing detection through a transfer", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		await CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "char-1",
			item: {
				name: "Ring of Spell Storing",
				source: "DMG",
				type: "RG",
			},
		});

		const state = new CharacterSheetState();
		await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state,
		});

		expect(state.getItems()).toEqual([
			expect.objectContaining({
				name: "Ring of Spell Storing",
				maxSpellLevels: 5,
			}),
		]);
	});

	it("keeps a queued transfer idempotent after a saved-state round trip", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		await CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "char-1",
			item: {name: "Rope", source: "PHB", type: "G"},
		});

		const firstState = new CharacterSheetState();
		const first = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state: firstState,
		});
		expect(first.applied).toHaveLength(1);

		const reloadedState = new CharacterSheetState();
		reloadedState.loadFromJson(firstState.toJson());
		const retry = await CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state: reloadedState,
		});

		expect(retry.applied).toHaveLength(0);
		expect(retry.acknowledgeIds).toHaveLength(1);
		expect(reloadedState.getItems()).toEqual([
			expect.objectContaining({name: "Rope", quantity: 1}),
		]);
	});

	it("rejects a character which no longer exists", async () => {
		const storage = getStorage([]);
		await expect(CharacterSheetItemTransfer.pQueue({
			storage,
			characterId: "missing",
			item: {name: "Rope", source: "PHB", type: "G"},
		})).rejects.toThrow("no longer exists");
	});

	it("does not queue after the target is deleted while waiting for the transfer lock", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		let releaseLock;
		Object.defineProperty(globalThis, "navigator", {value: {}, configurable: true});
		CharacterSheetItemTransfer._pFallbackLock = new Promise(resolve => { releaseLock = resolve; });

		try {
			const pQueue = CharacterSheetItemTransfer.pQueue({
				storage,
				characterId: "char-1",
				item: {name: "Rope", source: "PHB", type: "G"},
			});
			storage.data.set("charsheet-characters", []);
			releaseLock();

			await expect(pQueue).rejects.toThrow("no longer exists");
			expect(await storage.pGet(CharacterSheetItemTransfer.STORAGE_KEY)).toBeNull();
		} finally {
			CharacterSheetItemTransfer._pFallbackLock = Promise.resolve();
			Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
		}
	});

	it("surfaces malformed transfer storage instead of silently discarding it", async () => {
		const storage = getStorage([{id: "char-1", name: "Aelar"}]);
		storage.data.set(CharacterSheetItemTransfer.STORAGE_KEY, {bad: true});

		await expect(CharacterSheetItemTransfer.pApplyPendingToState({
			storage,
			characterId: "char-1",
			state: new CharacterSheetState(),
		})).rejects.toThrow("malformed");
	});

	it("formats character labels with multiclass totals", () => {
		expect(CharacterSheetItemTransfer.getCharacterLabel({
			name: "Bree",
			classes: [{name: "Rogue", level: 3}, {name: "Wizard", level: 2}],
		})).toBe("Bree — Rogue/Wizard 5");
	});
});
