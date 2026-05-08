/**
 * Character Sheet Play Mode - Unit Tests
 * Tests for play mode state fields (viewMode, favorites) and state management helpers.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetPlayMode", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// View Mode
	// ==========================================================================
	describe("View Mode", () => {
		it("should default to 'full' view mode", () => {
			expect(state.getViewMode()).toBe("full");
		});

		it("should set and get view mode", () => {
			state.setViewMode("play");
			expect(state.getViewMode()).toBe("play");
		});

		it("should reset to full when set to null/undefined", () => {
			state.setViewMode("play");
			state.setViewMode(null);
			expect(state.getViewMode()).toBe("full");
		});

		it("should persist view mode through serialization", () => {
			state.setViewMode("play");
			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getViewMode()).toBe("play");
		});

		it("should default to full when loading old save without viewMode", () => {
			const json = state.toJson();
			delete json.viewMode;
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getViewMode()).toBe("full");
		});
	});

	// ==========================================================================
	// Favorites
	// ==========================================================================
	describe("Favorites", () => {
		const makeFav = (type, name) => ({
			id: `${type}:${name}`,
			type,
			name,
			icon: "⚡",
		});

		it("should default to empty favorites", () => {
			expect(state.getFavorites()).toEqual([]);
		});

		it("should return a copy from getFavorites, not a reference", () => {
			state.addFavorite(makeFav("attack", "longbow"));
			const favs1 = state.getFavorites();
			const favs2 = state.getFavorites();
			expect(favs1).toEqual(favs2);
			expect(favs1).not.toBe(favs2);
		});

		describe("addFavorite", () => {
			it("should add a favorite", () => {
				const result = state.addFavorite(makeFav("attack", "longbow"));
				expect(result).toBe(true);
				expect(state.getFavorites()).toHaveLength(1);
				expect(state.getFavorites()[0].name).toBe("longbow");
			});

			it("should not add duplicate favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.addFavorite(makeFav("attack", "longbow"));
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(1);
			});

			it("should respect max favorites limit", () => {
				for (let i = 0; i < 8; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`));
				}
				const result = state.addFavorite(makeFav("attack", "weapon8"));
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(8);
			});

			it("should allow custom max limit", () => {
				for (let i = 0; i < 4; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`), {max: 4});
				}
				const result = state.addFavorite(makeFav("attack", "weapon4"), {max: 4});
				expect(result).toBe(false);
				expect(state.getFavorites()).toHaveLength(4);
			});
		});

		describe("removeFavorite", () => {
			it("should remove an existing favorite", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.removeFavorite("attack:longbow");
				expect(result).toBe(true);
				expect(state.getFavorites()).toHaveLength(0);
			});

			it("should return false when removing non-existent favorite", () => {
				const result = state.removeFavorite("attack:nonexistent");
				expect(result).toBe(false);
			});
		});

		describe("isFavorite", () => {
			it("should return true for existing favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				expect(state.isFavorite("attack", "longbow")).toBe(true);
			});

			it("should return false for non-favorites", () => {
				expect(state.isFavorite("attack", "longbow")).toBe(false);
			});

			it("should distinguish by type", () => {
				state.addFavorite(makeFav("attack", "fireball"));
				expect(state.isFavorite("attack", "fireball")).toBe(true);
				expect(state.isFavorite("spell", "fireball")).toBe(false);
			});
		});

		describe("toggleFavorite", () => {
			it("should add when not present", () => {
				const result = state.toggleFavorite(makeFav("attack", "longbow"));
				expect(result).toBe("added");
				expect(state.getFavorites()).toHaveLength(1);
			});

			it("should remove when already present", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				const result = state.toggleFavorite(makeFav("attack", "longbow"));
				expect(result).toBe("removed");
				expect(state.getFavorites()).toHaveLength(0);
			});

			it("should return null when at max and trying to add", () => {
				for (let i = 0; i < 8; i++) {
					state.addFavorite(makeFav("attack", `weapon${i}`));
				}
				const result = state.toggleFavorite(makeFav("attack", "weapon8"));
				expect(result).toBeNull();
			});
		});

		describe("setFavorites", () => {
			it("should replace all favorites", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				state.setFavorites([makeFav("spell", "fireball")]);
				expect(state.getFavorites()).toHaveLength(1);
				expect(state.getFavorites()[0].name).toBe("fireball");
			});

			it("should clear favorites when set to empty", () => {
				state.addFavorite(makeFav("attack", "longbow"));
				state.setFavorites([]);
				expect(state.getFavorites()).toHaveLength(0);
			});
		});

		it("should persist favorites through serialization", () => {
			state.addFavorite(makeFav("attack", "longbow"));
			state.addFavorite(makeFav("spell", "fireball"));

			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);

			expect(restored.getFavorites()).toHaveLength(2);
			expect(restored.isFavorite("attack", "longbow")).toBe(true);
			expect(restored.isFavorite("spell", "fireball")).toBe(true);
		});

		it("should default to empty when loading old save without favorites", () => {
			const json = state.toJson();
			delete json.favorites;
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);
			expect(restored.getFavorites()).toEqual([]);
		});
	});
});
