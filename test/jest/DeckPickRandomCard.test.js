import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";

/**
 * Fabricates a deck matching the post-normalization shape produced by
 * `_pGetDereferencedCardData` — i.e. `count: N` has already been expanded
 * into N duplicate array entries, and `replacement: true` cards carry
 * `_isReplacement: true`.
 */
function makeDeck (cards) {
	return {
		name: "Test Deck",
		source: "TEST",
		cards: cards.map(c => ({
			name: c.name,
			set: c.set || "Test Deck",
			source: c.source || "TEST",
			...(c.isReplacement ? {_isReplacement: true} : {}),
		})),
	};
}

describe("Renderer.deck.pickRandomCard", () => {
	it("returns null for an empty / missing deck", () => {
		expect(Renderer.deck.pickRandomCard(null)).toBeNull();
		expect(Renderer.deck.pickRandomCard({cards: []})).toBeNull();
	});

	it("never picks a drawn (non-replacement) card", () => {
		const deck = makeDeck([
			{name: "A"},
			{name: "B"},
			{name: "C"},
			{name: "D"},
		]);
		const drawn = new Set([0, 1, 2]);
		for (let i = 0; i < 200; ++i) {
			const pick = Renderer.deck.pickRandomCard(deck, drawn);
			expect(pick).not.toBeNull();
			expect(pick.ixCard).toBe(3);
			expect(pick.card.name).toBe("D");
		}
	});

	it("returns null when every non-replacement card is drawn and no replacements exist", () => {
		const deck = makeDeck([
			{name: "A"},
			{name: "B"},
		]);
		const drawn = new Set([0, 1]);
		expect(Renderer.deck.pickRandomCard(deck, drawn)).toBeNull();
	});

	it("still picks a replacement card even when its index is in the drawn set", () => {
		const deck = makeDeck([
			{name: "A"},
			{name: "B", isReplacement: true},
		]);
		const drawn = new Set([0, 1]);
		// Only the replacement card remains eligible.
		for (let i = 0; i < 50; ++i) {
			const pick = Renderer.deck.pickRandomCard(deck, drawn);
			expect(pick).not.toBeNull();
			expect(pick.ixCard).toBe(1);
			expect(pick.card.name).toBe("B");
			expect(pick.card._isReplacement).toBe(true);
		}
	});

	it("weighted decks are handled by pre-normalized duplicates in deck.cards", () => {
		// A card with `count: 3` is expanded into three array entries by the
		// data pipeline. Uniform random over the array therefore realizes the
		// correct weighted draw with no additional weighting logic.
		const deck = makeDeck([
			{name: "Common"},
			{name: "Common"},
			{name: "Common"},
			{name: "Rare"},
		]);

		const drawn = new Set();
		const counts = {Common: 0, Rare: 0};
		// Seed the RNG-adjacent call to be deterministic by stubbing Math.random.
		const originalRandom = Math.random;
		try {
			let seed = 0;
			Math.random = () => {
				// Cycle through values that map uniformly to each index of the 4-card deck.
				seed = (seed + 1) % 4;
				return seed / 4;
			};
			for (let i = 0; i < 400; ++i) {
				const pick = Renderer.deck.pickRandomCard(deck, drawn);
				expect(pick).not.toBeNull();
				counts[pick.card.name]++;
			}
		} finally {
			Math.random = originalRandom;
		}

		// Because we didn't add draws to the set, every draw hits all four
		// indices uniformly — so the "Common" name (3 duplicate entries)
		// receives roughly 3x the picks of "Rare" (1 entry).
		expect(counts.Common).toBeGreaterThan(counts.Rare * 2);
	});

	it("defaults drawnIxSet to empty when omitted", () => {
		const deck = makeDeck([{name: "Solo"}]);
		const pick = Renderer.deck.pickRandomCard(deck);
		expect(pick).not.toBeNull();
		expect(pick.ixCard).toBe(0);
	});
});
