/**
 * CS-BUG-108 — the level-up "Swap a Known Spell" candidate list was empty for
 * every known caster.
 *
 * `_renderSpellSwapSection` selected candidates with `!s.sourceFeature`, under a
 * comment reading "not feature-granted". Those are not the same predicate. Every
 * spell the player picks is stamped with a POSITIVE attribution — "Spells Known",
 * "Cantrips Known", "Wizard Spellbook", "Prepared Spells" — by the Builder,
 * QuickBuild and LevelUp alike, so `!s.sourceFeature` excluded exactly the spells
 * the picker exists to offer and admitted only orphans. Bards, Rangers, Sorcerers
 * and Warlocks were told "No swappable spells known." at every level from 2 to 20.
 *
 * These tests pin the CANDIDATE SET, not the flag: the predicate is exercised
 * against spells produced the way production produces them, and the three classes
 * of spell (player-chosen, feature-granted, orphan) are asserted separately so a
 * fix that over-corrects — admitting subclass grants into the swap list — is just
 * as red as the original under-correction.
 *
 * They do NOT pin the call site. See the note on `swapCandidates` below, and
 * `CharacterSheetSpellSwapRender.test.js` for the wiring.
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;

/**
 * Applies the production predicate to a state's known-spell list.
 *
 * SCOPE — read before adding a test here. This helper calls
 * `isSwappableKnownSpell` directly; it does NOT drive
 * `_renderSpellSwapSection`, which is what actually filters the UI's candidate
 * list. So these tests pin the PREDICATE and are blind to the WIRING: reverting
 * the level-up call site to the original `!s.sourceFeature` — i.e. reintroducing
 * CS-BUG-108 in full — leaves every test in this file green (measured: 19/19).
 *
 * The wiring is pinned separately by `CharacterSheetSpellSwapRender.test.js`,
 * which drives the real render method and reads what it wrote. A change to the
 * call site needs a test there, not here.
 */
function swapCandidates (state) {
	return (state.getSpellsKnown?.() || [])
		.filter(s => ClassUtils.isSwappableKnownSpell(s));
}

function makeSorcerer (level = 4) {
	const state = new CharacterSheetState();
	state.addClass({name: "Sorcerer", source: "PHB", level});
	return state;
}

describe("CS-BUG-108 — level-up spell swap candidate list", () => {
	describe("player-chosen spells are offered", () => {
		// Every attribution the Builder / QuickBuild / LevelUp actually stamp.
		test.each([
			["Spells Known"],
			["Prepared Spells"],
			["Wizard Spellbook"],
		])("a spell attributed to %s is swappable", (sourceFeature) => {
			const state = makeSorcerer();
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature, sourceClass: "Sorcerer"});

			expect(swapCandidates(state).map(s => s.name)).toEqual(["Magic Missile"]);
		});

		test("a full level-4 known-caster list is entirely swappable", () => {
			const state = makeSorcerer();
			["Magic Missile", "Shield", "Misty Step", "Scorching Ray"].forEach((name, i) => {
				state.addSpell({name, source: "PHB", level: i < 2 ? 1 : 2, sourceFeature: "Spells Known", sourceClass: "Sorcerer"});
			});

			expect(swapCandidates(state).map(s => s.name).sort())
				.toEqual(["Magic Missile", "Misty Step", "Scorching Ray", "Shield"]);
		});
	});

	describe("feature-granted spells are withheld", () => {
		test("a subclass affinity grant is not swappable here", () => {
			const state = makeSorcerer();
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"});
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceFeature: "Divine Soul: Affinity", alwaysPrepared: true, sourceClass: "Sorcerer"});

			expect(swapCandidates(state).map(s => s.name)).toEqual(["Magic Missile"]);
		});

		test("a subclass grant WITHOUT alwaysPrepared is still withheld", () => {
			// The `!s.alwaysPrepared` clause must not be the only thing holding grants
			// back — a grant that omits the flag has to be excluded on attribution.
			const state = makeSorcerer();
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"});
			state.addSpell({name: "Hex", source: "PHB", level: 1, sourceFeature: "Wicked Witch: Hag Ancestor", sourceClass: "Sorcerer"});

			expect(swapCandidates(state).map(s => s.name)).toEqual(["Magic Missile"]);
		});

		test("a racial grant is withheld", () => {
			const state = makeSorcerer();
			state.addSpell({name: "Faerie Fire", source: "PHB", level: 1, sourceFeature: "Drow Magic", sourceClass: "Sorcerer"});

			expect(swapCandidates(state)).toHaveLength(0);
		});
	});

	describe("boundaries preserved", () => {
		test("orphan spells stay swappable so older saves don't regress", () => {
			const state = makeSorcerer();
			state.addSpell({name: "Sleep", source: "PHB", level: 1, sourceClass: "Sorcerer"});

			expect(swapCandidates(state).map(s => s.name)).toEqual(["Sleep"]);
		});

		test("cantrips are excluded — the swap is a levelled-spell allowance", () => {
			// Asserted directly on the predicate. Going through `addSpell` would NOT
			// reach the guard: state routes cantrips to `cantripsKnown`, so
			// `getSpellsKnown()` never yields one and a state-level test here is inert
			// (measured — removing the `level > 0` guard left such a test green).
			expect(ClassUtils.isSwappableKnownSpell({name: "Fire Bolt", level: 0, sourceFeature: "Cantrips Known"})).toBe(false);
			expect(ClassUtils.isSwappableKnownSpell({name: "Fire Bolt", level: 0})).toBe(false);
		});

		test("state routes cantrips away from the known-spell list entirely", () => {
			// The second, independent reason a cantrip can never appear in the swap
			// list. Pinned separately so that if this routing ever changes, the
			// predicate guard above is known to be the only thing left holding.
			const state = makeSorcerer();
			state.addSpell({name: "Fire Bolt", source: "PHB", level: 0, sourceFeature: "Cantrips Known", sourceClass: "Sorcerer"});

			expect(state.getSpellsKnown().map(s => s.name)).toEqual([]);
			expect(state.getCantripsKnown().map(s => s.name)).toEqual(["Fire Bolt"]);
		});

		test("an always-prepared player-attributed spell is still excluded", () => {
			const state = makeSorcerer();
			state.addSpell({name: "Bless", source: "PHB", level: 1, sourceFeature: "Prepared Spells", alwaysPrepared: true, sourceClass: "Sorcerer"});

			expect(swapCandidates(state)).toHaveLength(0);
		});
	});

	describe("the predicate the fix relies on", () => {
		test("isPlayerChosenSpell accepts every attribution production stamps", () => {
			["Spells Known", "Cantrips Known", "Wizard Spellbook", "Prepared Spells", "Spells Prepared"]
				.forEach(sourceFeature => {
					expect(ClassUtils.isPlayerChosenSpell({name: "X", sourceFeature})).toBe(true);
				});
		});

		test("isPlayerChosenSpell rejects grants and orphans", () => {
			expect(ClassUtils.isPlayerChosenSpell({name: "X", sourceFeature: "Divine Soul: Affinity"})).toBe(false);
			expect(ClassUtils.isPlayerChosenSpell({name: "X"})).toBe(false);
			expect(ClassUtils.isPlayerChosenSpell(null)).toBe(false);
		});
	});

	describe("the swap is offered at all, for the classes entitled to it", () => {
		// Guards the other half: a candidate list is worthless if the section never
		// renders. These are the classes `getSpellSwapCount` grants a swap to.
		test.each([["Bard"], ["Ranger"], ["Sorcerer"], ["Warlock"]])(
			"%s is granted a swap from level 2",
			(className) => {
				expect(ClassUtils.getSpellSwapCount(className, "PHB", 1)).toBe(0);
				expect(ClassUtils.getSpellSwapCount(className, "PHB", 2)).toBe(1);
				expect(ClassUtils.getSpellSwapCount(className, "PHB", 20)).toBe(1);
			},
		);

		test("prepared casters get no level-up swap — they re-prepare freely", () => {
			["Cleric", "Druid", "Wizard", "Paladin"].forEach(className => {
				expect(ClassUtils.getSpellSwapCount(className, "PHB", 5)).toBe(0);
			});
		});
	});

	describe("end-to-end: a known caster at level-up has something to swap", () => {
		test("a level-4 Sorcerer built the way production builds one is not told 'no swappable spells'", () => {
			const state = makeSorcerer(4);
			// Exactly the shape LevelUp writes (charactersheet-levelup.js).
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"});
			state.addSpell({name: "Shield", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"});

			const candidates = swapCandidates(state);

			// The bug's exact user-visible symptom was an empty list rendering
			// "No swappable spells known." — assert the negation of that.
			expect(candidates.length).toBeGreaterThan(0);
			expect(ClassUtils.getSpellSwapCount("Sorcerer", "PHB", 5)).toBe(1);
		});
	});
});
