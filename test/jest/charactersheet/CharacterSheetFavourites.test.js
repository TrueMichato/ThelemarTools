/**
 * Character Sheet Favourites — Resolver + Orphan Cleanup
 *
 * The base favourites surface (add / remove / toggle / max-cap / serialization)
 * is covered by `CharacterSheetPlayMode.test.js`. This file covers the
 * Overview-tab additions:
 *   - `_resolveFavorite(fav)` for every supported type (positive + negative)
 *   - `getOrphanedFavorites()`  → only entries that no longer resolve
 *   - `cleanupOrphanedFavorites()` → removes orphans + returns count
 *   - `isFavoriteResolved(fav)` convenience wrapper
 *   - JSON round-trip preserves the extended types
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const fav = (type, idOrName, extras = {}) => ({
	id: `${type}:${idOrName}`,
	type,
	name: extras.name || idOrName,
	icon: extras.icon || "⭐",
	...extras,
});

describe("CharacterSheetFavourites — Resolver", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	describe("attack type", () => {
		it("resolves an attack favourite by id", () => {
			state._data.attacks = [{id: "atk-1", name: "Longbow", attackBonus: 5}];
			state.addFavorite(fav("attack", "atk-1"));
			const res = state._resolveFavorite(fav("attack", "atk-1"));
			expect(res.found).toBe(true);
			expect(res.entity.name).toBe("Longbow");
		});
		it("resolves an attack favourite by name when id absent", () => {
			state._data.attacks = [{name: "Longbow"}];
			const res = state._resolveFavorite(fav("attack", "Longbow"));
			expect(res.found).toBe(true);
		});
		it("returns not-found when attack removed", () => {
			const res = state._resolveFavorite(fav("attack", "missing"));
			expect(res.found).toBe(false);
		});
	});

	describe("spell type", () => {
		it("resolves a spell favourite by name", () => {
			state._data.spellcasting.spellsKnown = [{name: "Fireball", source: "PHB", level: 3, prepared: true}];
			const res = state._resolveFavorite(fav("spell", "Fireball"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("Level 3");
		});
		it("resolves a cantrip with Cantrip detail", () => {
			state._data.spellcasting.cantripsKnown = [{name: "Fire Bolt", source: "PHB"}];
			const res = state._resolveFavorite(fav("spell", "Fire Bolt"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("Cantrip");
		});
		it("returns not-found for unknown spell", () => {
			expect(state._resolveFavorite(fav("spell", "Wish")).found).toBe(false);
		});
	});

	describe("feature type", () => {
		it("resolves a feature with uses display detail", () => {
			state._data.features = [{id: "f1", name: "Action Surge", uses: {current: 1, max: 2}}];
			const res = state._resolveFavorite(fav("feature", "f1"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("1/2");
		});
		it("resolves a feature without uses (no detail)", () => {
			state._data.features = [{id: "f2", name: "Extra Attack"}];
			const res = state._resolveFavorite(fav("feature", "f2"));
			expect(res.found).toBe(true);
			expect(res.detail).toBeNull();
		});
		it("returns not-found when feature was removed", () => {
			expect(state._resolveFavorite(fav("feature", "ghost")).found).toBe(false);
		});
	});

	describe("customAbility type", () => {
		it("resolves a custom ability", () => {
			state._data.customAbilities = [{id: "ca-1", name: "House Boon", mode: "free"}];
			const res = state._resolveFavorite(fav("customAbility", "ca-1"));
			expect(res.found).toBe(true);
			expect(res.entity.name).toBe("House Boon");
		});
		it("returns not-found for missing ability", () => {
			expect(state._resolveFavorite(fav("customAbility", "nope")).found).toBe(false);
		});
	});

	describe("resource type", () => {
		it("resolves a resource and reports current/max detail", () => {
			state._data.resources = [{id: "r1", name: "Channel Divinity", current: 1, max: 2, recharge: "short"}];
			const res = state._resolveFavorite(fav("resource", "r1"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("1/2");
		});
		it("falls back to name lookup when id missing", () => {
			state._data.resources = [{name: "Rage", current: 3, max: 3, recharge: "long"}];
			const res = state._resolveFavorite(fav("resource", "Rage"));
			expect(res.found).toBe(true);
		});
	});

	describe("item type", () => {
		it("resolves an inventory entry by id", () => {
			state._data.inventory = [{id: "i-1", item: "Potion of Healing", quantity: 3}];
			const res = state._resolveFavorite(fav("item", "i-1"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("×3");
		});
		it("omits quantity detail for single items", () => {
			state._data.inventory = [{id: "i-2", item: "Longsword", quantity: 1}];
			const res = state._resolveFavorite(fav("item", "i-2"));
			expect(res.found).toBe(true);
			expect(res.detail).toBeNull();
		});
		it("returns not-found for missing item", () => {
			expect(state._resolveFavorite(fav("item", "ghost")).found).toBe(false);
		});
	});

	describe("optionalFeature type", () => {
		it("resolves via feats array", () => {
			state._data.feats = [{id: "ef-1", name: "Eldritch Sight"}];
			const res = state._resolveFavorite(fav("optionalFeature", "ef-1"));
			expect(res.found).toBe(true);
		});
		it("resolves via features array", () => {
			state._data.features = [{id: "mv-1", name: "Riposte"}];
			const res = state._resolveFavorite(fav("optionalFeature", "mv-1"));
			expect(res.found).toBe(true);
		});
		it("returns not-found when present in neither", () => {
			expect(state._resolveFavorite(fav("optionalFeature", "ghost")).found).toBe(false);
		});
	});

	describe("combatTradition type", () => {
		it("resolves by code", () => {
			state._data.combatTraditions = [{code: "AM", name: "Arcane Might"}];
			const res = state._resolveFavorite(fav("combatTradition", "AM"));
			expect(res.found).toBe(true);
			expect(res.detail).toBe("AM");
		});
		it("returns not-found for unknown tradition", () => {
			expect(state._resolveFavorite(fav("combatTradition", "ZZ")).found).toBe(false);
		});
	});

	describe("feat type", () => {
		it("resolves a known feat", () => {
			state._data.feats = [{id: "ft-1", name: "Tough"}];
			const res = state._resolveFavorite(fav("feat", "ft-1"));
			expect(res.found).toBe(true);
		});
		it("returns not-found for missing feat", () => {
			expect(state._resolveFavorite(fav("feat", "missing")).found).toBe(false);
		});
	});

	describe("invalid input", () => {
		it("returns not-found for null", () => {
			expect(state._resolveFavorite(null).found).toBe(false);
		});
		it("returns not-found for unknown type", () => {
			expect(state._resolveFavorite(fav("zzz", "x")).found).toBe(false);
		});
	});
});

describe("CharacterSheetFavourites — Orphan handling", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("getOrphanedFavorites returns only unresolved entries", () => {
		state._data.attacks = [{id: "a1", name: "Bow"}];
		state.addFavorite(fav("attack", "a1"));
		state.addFavorite(fav("attack", "ghost-attack"));
		state.addFavorite(fav("spell", "ghost-spell"));

		const orphans = state.getOrphanedFavorites();
		expect(orphans).toHaveLength(2);
		expect(orphans.map(o => o.id).sort()).toEqual(["attack:ghost-attack", "spell:ghost-spell"]);
	});

	it("returns no orphans when everything resolves", () => {
		state._data.attacks = [{id: "a1", name: "Bow"}];
		state.addFavorite(fav("attack", "a1"));
		expect(state.getOrphanedFavorites()).toHaveLength(0);
	});

	it("cleanupOrphanedFavorites removes only orphans, returns count", () => {
		state._data.attacks = [{id: "a1", name: "Bow"}];
		state.addFavorite(fav("attack", "a1"));
		state.addFavorite(fav("attack", "ghost-1"));
		state.addFavorite(fav("spell", "ghost-2"));

		const removed = state.cleanupOrphanedFavorites();
		expect(removed).toBe(2);
		expect(state.getFavorites()).toHaveLength(1);
		expect(state.getFavorites()[0].id).toBe("attack:a1");
	});

	it("cleanupOrphanedFavorites returns 0 when none orphaned", () => {
		state._data.attacks = [{id: "a1", name: "Bow"}];
		state.addFavorite(fav("attack", "a1"));
		expect(state.cleanupOrphanedFavorites()).toBe(0);
	});

	it("isFavoriteResolved is a convenience wrapper around _resolveFavorite", () => {
		state._data.features = [{id: "f1", name: "Rage"}];
		expect(state.isFavoriteResolved(fav("feature", "f1"))).toBe(true);
		expect(state.isFavoriteResolved(fav("feature", "missing"))).toBe(false);
	});
});

describe("CharacterSheetFavourites — Round-trip", () => {
	it("preserves extended-type favourites through serialization", () => {
		const state = new CharacterSheetState();
		state._data.resources = [{id: "r1", name: "Channel Divinity", current: 2, max: 2, recharge: "short"}];
		state._data.inventory = [{id: "i1", item: {name: "Potion of Healing"}, quantity: 1}];
		state._data.customAbilities = [{id: "ca1", name: "House Rule", mode: "free"}];
		state.addFavorite(fav("resource", "r1"));
		state.addFavorite(fav("item", "i1"));
		state.addFavorite(fav("customAbility", "ca1"));

		const json = state.toJson();
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.getFavorites()).toHaveLength(3);
		expect(restored.isFavorite("resource", "r1")).toBe(true);
		expect(restored.isFavorite("item", "i1")).toBe(true);
		expect(restored.isFavorite("customAbility", "ca1")).toBe(true);
	});
});
