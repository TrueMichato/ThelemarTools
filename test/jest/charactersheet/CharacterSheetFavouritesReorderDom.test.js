/**
 * Bug #1 — Manual drag-reorder of Favourites: DOM → state persistence bridge.
 *
 * The Overview favourites list is reordered by dragging tiles. On drop the
 * controller moves the dragged tile in the DOM, reads the new visible order
 * off the `data-fav-id` attributes, and pushes it into
 * `CharacterSheetState.reorderFavorites`. These tests exercise that real
 * DOM → state path against a live state instance.
 *
 * The project's Jest runs in the `node` environment (no real DOM — see
 * `jest.config.json`), so we drive a minimal ordered-container shim that
 * supports the exact surface the controller's DOM reader touches
 * (`querySelectorAll('.charsheet__favourite-tile[data-fav-id]')` →
 * `getAttribute('data-fav-id')`). The state side is the real implementation.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Pinned replica of charactersheet.js `_readFavouriteDomOrder`.
function readFavouriteDomOrder (container) {
	return Array.from(container.querySelectorAll(".charsheet__favourite-tile[data-fav-id]"))
		.map(el => el.getAttribute("data-fav-id"))
		.filter(Boolean);
}

// Minimal ordered-container shim mirroring the relevant DOM behaviour: tiles
// keep insertion order, a "noise" node without a data-fav-id is skipped by the
// reader, and a tile can be moved (the drop outcome).
function buildList (ids) {
	const tiles = ids.map(id => ({_favId: id, getAttribute: (n) => (n === "data-fav-id" ? id : null)}));
	return {
		_tiles: tiles,
		querySelectorAll () { return this._tiles.filter(t => t._favId); },
		move (favId, beforeFavId) {
			const from = this._tiles.findIndex(t => t._favId === favId);
			const [moved] = this._tiles.splice(from, 1);
			const to = beforeFavId == null ? this._tiles.length : this._tiles.findIndex(t => t._favId === beforeFavId);
			this._tiles.splice(to < 0 ? this._tiles.length : to, 0, moved);
		},
		addNoise () { this._tiles.push({_favId: null, getAttribute: () => null}); },
	};
}

function makeState (ids) {
	const state = new CharacterSheetState();
	state.setFavorites(ids.map(id => ({id, type: id.split(":")[0], name: id})));
	return state;
}

describe("Favourites drag-reorder — DOM → state bridge", () => {
	it("reads tile order from the DOM and persists it to state", () => {
		const state = makeState(["attack:a", "attack:b", "attack:c"]);
		const container = buildList(["attack:a", "attack:b", "attack:c"]);

		// Simulate a drop that moves tile `c` to the front.
		container.move("attack:c", "attack:a");

		const order = readFavouriteDomOrder(container);
		expect(order).toEqual(["attack:c", "attack:a", "attack:b"]);

		const changed = state.reorderFavorites(order);
		expect(changed).toBe(true);
		expect(state.getFavorites().map(f => f.id)).toEqual(["attack:c", "attack:a", "attack:b"]);
	});

	it("ignores attribute-less nodes (e.g. empty-state placeholder) when reading order", () => {
		const container = buildList(["attack:a", "attack:b"]);
		container.addNoise();
		expect(readFavouriteDomOrder(container)).toEqual(["attack:a", "attack:b"]);
	});

	it("a drop that does not change order yields no state mutation", () => {
		const state = makeState(["attack:a", "attack:b", "attack:c"]);
		const container = buildList(["attack:a", "attack:b", "attack:c"]);
		const changed = state.reorderFavorites(readFavouriteDomOrder(container));
		expect(changed).toBe(false);
		expect(state.getFavorites().map(f => f.id)).toEqual(["attack:a", "attack:b", "attack:c"]);
	});

	it("persists DOM order even when hidden orphans exist only in state", () => {
		// State has an orphan `x` that is never rendered; the DOM only carries
		// the live tiles. After persisting, the orphan is kept at the end.
		const state = makeState(["attack:a", "attack:x", "attack:b"]);
		const container = buildList(["attack:b", "attack:a"]); // user dragged b before a

		const changed = state.reorderFavorites(readFavouriteDomOrder(container));
		expect(changed).toBe(true);
		expect(state.getFavorites().map(f => f.id)).toEqual(["attack:b", "attack:a", "attack:x"]);
	});
});
