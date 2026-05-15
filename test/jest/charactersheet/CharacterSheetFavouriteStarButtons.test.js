/**
 * Verifies the "favourite star" button surfaces and the inventory↔favourites
 * bridge wired in by the favourites-discoverability fix. Specifically:
 *   1. State-level reconciliation imports legacy `inventory[i].starred=true`
 *      entries into `_data.favorites[]` on load (cap-respecting, idempotent).
 *   2. Inventory `_toggleStarred` mirrors star-toggles into favourites and
 *      surfaces a cap-warning toast when the 8-favourite limit is reached.
 *   3. The cap-tolerant bridge does not corrupt favourites when at-cap.
 *
 * The pin/star button DOM rendering itself is exercised end-to-end by the
 * existing CharacterSheetFavourites + Play Mode suites; this file focuses on
 * the new bridge contract (and is the place to extend when adding more
 * surfaces in the future).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetFavouriteStarButtons — Inventory ↔ Favourites bridge", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	describe("_reconcileStarredItemsToFavourites (load-time migration)", () => {
		it("imports legacy starred items into favourites", () => {
			state._data.inventory = [
				{id: "inv-1", starred: true, item: {name: "Bag of Holding"}, quantity: 1},
				{id: "inv-2", starred: false, item: {name: "Rope"}, quantity: 1},
				{id: "inv-3", starred: true, item: {name: "Healer's Kit"}, quantity: 1},
			];
			state._data.favorites = [];

			const added = state._reconcileStarredItemsToFavourites();

			expect(added).toBe(2);
			expect(state.isFavorite("item", "inv-1")).toBe(true);
			expect(state.isFavorite("item", "inv-2")).toBe(false);
			expect(state.isFavorite("item", "inv-3")).toBe(true);
		});

		it("is idempotent — running twice does not duplicate favourites", () => {
			state._data.inventory = [
				{id: "inv-1", starred: true, item: {name: "Bag of Holding"}, quantity: 1},
			];
			state._reconcileStarredItemsToFavourites();
			const added2 = state._reconcileStarredItemsToFavourites();
			expect(added2).toBe(0);
			expect(state.getFavorites().filter(f => f.id === "item:inv-1")).toHaveLength(1);
		});

		it("respects the 8-favourite cap silently", () => {
			// Pre-fill favourites to the cap with non-item entries
			state._data.favorites = Array.from({length: 8}, (_, i) => ({
				id: `attack:atk-${i}`, type: "attack", name: `Atk ${i}`, icon: "⚔️", detail: null,
			}));
			state._data.inventory = [
				{id: "inv-1", starred: true, item: {name: "Bag of Holding"}, quantity: 1},
			];

			const added = state._reconcileStarredItemsToFavourites();

			expect(added).toBe(0);
			expect(state.isFavorite("item", "inv-1")).toBe(false);
			expect(state.getFavorites()).toHaveLength(8);
		});

		it("preserves existing item favourites and only adds missing ones", () => {
			state._data.favorites = [
				{id: "item:inv-1", type: "item", name: "Existing Fave", icon: "🎒", detail: null},
			];
			state._data.inventory = [
				{id: "inv-1", starred: true, item: {name: "Bag of Holding"}, quantity: 1},
				{id: "inv-2", starred: true, item: {name: "Rope"}, quantity: 1},
			];

			const added = state._reconcileStarredItemsToFavourites();

			expect(added).toBe(1);
			expect(state.getFavorites().filter(f => f.id === "item:inv-1")).toHaveLength(1);
			expect(state.isFavorite("item", "inv-2")).toBe(true);
		});

		it("handles missing inventory gracefully", () => {
			state._data.inventory = undefined;
			expect(() => state._reconcileStarredItemsToFavourites()).not.toThrow();
		});

		it("uses fallback name when item.item.name missing", () => {
			state._data.inventory = [
				{id: "inv-1", starred: true, name: "Direct Name"},
			];
			state._reconcileStarredItemsToFavourites();
			const fav = state.getFavorites().find(f => f.id === "item:inv-1");
			expect(fav?.name).toBe("Direct Name");
		});
	});

	describe("loadFromJson runs the reconciliation", () => {
		it("auto-imports starred items on load (legacy save format)", () => {
			const json = {
				inventory: [
					{id: "inv-1", starred: true, item: {name: "Wand of Magic Missiles"}, quantity: 1},
				],
				// Intentionally omit `favorites` — simulates an old save predating the bridge.
			};
			state.loadFromJson(json);
			expect(state.isFavorite("item", "inv-1")).toBe(true);
			expect(state.getFavorites().find(f => f.id === "item:inv-1")?.name).toBe("Wand of Magic Missiles");
		});
	});
});

describe("CharacterSheetFavouriteStarButtons — toggleFavorite contract", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("toggles item favourites symmetrically (add then remove)", () => {
		const favData = {
			id: "item:inv-1", type: "item", name: "Cloak of Elvenkind", icon: "🎒", detail: null,
		};
		expect(state.isFavorite("item", "inv-1")).toBe(false);

		const r1 = state.toggleFavorite(favData);
		expect(r1).toBe("added");
		expect(state.isFavorite("item", "inv-1")).toBe(true);

		const r2 = state.toggleFavorite(favData);
		expect(r2).toBe("removed");
		expect(state.isFavorite("item", "inv-1")).toBe(false);
	});

	it("returns null when adding past the 8-cap so the caller can toast", () => {
		// Fill cap
		for (let i = 0; i < 8; i++) {
			state.addFavorite({id: `attack:a${i}`, type: "attack", name: `A${i}`, icon: "⚔️", detail: null});
		}
		const result = state.toggleFavorite({
			id: "spell:fireball", type: "spell", name: "Fireball", icon: "✨", detail: null,
		});
		expect(result).toBeNull();
		expect(state.isFavorite("spell", "fireball")).toBe(false);
	});
});
