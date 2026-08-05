/**
 * Item-sourced CONDITIONAL modifiers — narrowly-scoped bonuses on worn/attuned gear must
 * reach the per-roll opt-in picker, and nothing else may.
 *
 * Measured on the shipping code before this change, three separate defects combined to
 * make "+N to saving throws against X" on an item worth exactly nothing:
 *
 *   1. `_extractCondition` recognised only CREATURE TYPES after "against" (aberrations,
 *      beasts, …). So "+1 to saving throws against poison" — and the canonical 5e
 *      phrasing "+1 to saving throws against spells" — both parsed as
 *      `conditional: null`, i.e. indistinguishable from an unconditional bonus. This is
 *      a generic parser bug: it affects official items, not just homebrew.
 *   2. The numeric save patterns had NO third-party guard, so prose that buffs somebody
 *      else ("each of your other orbiting Ioun Stones has … a +2 bonus to saving
 *      throws") granted the bonus to the wearer.
 *   3. Nothing fed item prose into the modifier registry at all: the only two
 *      item->`parseModifiers` callers keep `isProficiency` / `isSpellSlot` respectively
 *      and discard every other modifier.
 *
 * The tests below pin all three, plus the two guards that keep the new path from
 * over-reporting: an item's BASELINE state ("while wearing", "while it orbits your
 * head") is not a condition, and prose must lose to a structured prop that already
 * expresses the same bonus.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

/** Verbatim prose from the stones/items each test is derived from. */
const PROSE = {
	// Ioun Stone #046, Green Star
	poison: "You gain a +1 bonus to saving throws against poison and the Poisoned condition while this green star orbits your head.",
	// Ioun Stone #059, Pale Aquamarine Prism
	frightened: "You gain a +2 bonus to saving throws against the Frightened condition while this pale aquamarine prism orbits your head.",
	// Ioun Stone #088, Yellow Ellipsoid
	disease: "You gain a +2 bonus to saving throws against disease and lycanthropy while this yellow ellipsoid orbits your head.",
	// Canonical 5e phrasing, present on official items (Mantle of Spell Resistance et al.)
	spells: "You gain a +1 bonus to saving throws against spells while you wear this cloak.",
	// Negative control: genuinely unconditional
	unconditional: "You gain a +1 bonus to saving throws while this stone orbits your head.",
	// Ioun Stone #057 — the bonus lands on OTHER stones, not on the character
	thirdParty: "Each of your other orbiting Ioun Stones has a +2 bonus to saving throws while this stone orbits your head.",
	// Ioun Stone #050 — third party via "its"
	thirdPartyIts: "Each magic item in your possession gains a +1 bonus to its saving throws while this stone orbits your head.",
};

function makeItemRow (itemData, {equipped = true, attuned = true} = {}) {
	return {
		id: `test-${itemData.name}`,
		item: itemData,
		quantity: 1,
		equipped,
		attuned,
		requiresAttunement: !!itemData.requiresAttunement,
	};
}

function makeStateWithItems (items) {
	const state = new CharacterSheetState();
	state._data.inventory = items.map(it => makeItemRow(it.data ?? it, it.opts));
	state._itemConditionalModifierCache = null;
	return state;
}

function stone (name, text, extra = {}) {
	return {name, source: "MECIounStones", requiresAttunement: true, entries: [text], ...extra};
}

describe("_extractCondition — 'against <qualifier>' is a real condition", () => {
	// REGRESSION PIN. Before the fix every one of these returned `conditional: null`,
	// so a bonus scoped to poison was applied to EVERY saving throw the character made.
	it.each([
		["damage type", PROSE.poison, "against poison"],
		["named condition", PROSE.frightened, "against the frightened condition"],
		["effect category", PROSE.disease, "against disease"],
		["spells (canonical 5e phrasing)", PROSE.spells, "against spells"],
	])("captures a %s qualifier", (_label, text, expected) => {
		const mods = FeatureModifierParser.parseModifiers(text, "Test Item", {isItem: true});
		const save = mods.find(m => m.type?.startsWith("save"));
		expect(save).toBeDefined();
		expect(save.conditional).toBe(expected);
	});

	it("leaves a genuinely unconditional save bonus unconditional", () => {
		// The guard against over-gating: widening `_extractCondition` must not invent a
		// condition where the prose states none, or an always-on bonus silently becomes
		// an opt-in the player has to remember to tick.
		const mods = FeatureModifierParser.parseModifiers(PROSE.unconditional, "Test Item", {isItem: true});
		const save = mods.find(m => m.type?.startsWith("save"));
		expect(save).toBeDefined();
		expect(save.conditional).toBeNull();
	});
});

describe("third-party subjects never buff the wearer", () => {
	const judge = text => FeatureModifierParser.isThirdPartySaveSubject(text, text.indexOf("bonus to saving throws"));

	it("recognises a possessive third-party subject ('each of your other …')", () => {
		expect(judge(PROSE.thirdParty)).toBe(true);
	});

	it("still recognises the 'its' form", () => {
		// NB: the possessive-pronoun form is suppressed one layer EARLIER — "bonus to
		// its saving throws" does not match the numeric save patterns at all, so the
		// subject guard is never consulted. Pinned here so the mechanism is on record:
		// if the patterns are ever widened to accept an intervening pronoun, the guard
		// must start covering this case and this expectation must flip to `true`.
		expect(judge(PROSE.thirdPartyIts)).toBe(false);
		expect(PROSE.thirdPartyIts).toContain("bonus to its saving throws");
	});

	it("does not misfire on a plain self-buff", () => {
		expect(judge(PROSE.unconditional)).toBe(false);
		expect(judge(PROSE.poison)).toBe(false);
	});

	it.each([
		["possessive form", PROSE.thirdParty],
		["'its' form", PROSE.thirdPartyIts],
	])("produces no save modifier for the %s", (_label, text) => {
		// REGRESSION PIN: the numeric save patterns previously had no guard at all, so
		// the possessive form granted the character a flat +2 to every save.
		const mods = FeatureModifierParser.parseModifiers(text, "Test Item", {isItem: true});
		expect(mods.filter(m => m.type?.startsWith("save"))).toHaveLength(0);
	});
});

describe("_getPassiveClauses — activated abilities are not passive properties", () => {
	it("keeps a passive orbiting clause", () => {
		expect(CharacterSheetState._getPassiveClauses(PROSE.poison)).toContain("against poison");
	});

	it.each([
		["once per day", "Once per day, you gain a +2 bonus to saving throws against poison."],
		["magic action", "As a Magic action, you gain a +2 bonus to saving throws against poison."],
		["charge expenditure", "You can expend 1 charge to gain a +2 bonus to saving throws against poison."],
	])("drops an activated clause (%s)", (_label, text) => {
		expect(CharacterSheetState._getPassiveClauses(text)).toBe("");
	});

	it("keeps only the passive sentence when both appear", () => {
		const mixed = `${PROSE.poison} Once per day, you can reroll a failed saving throw against disease.`;
		const passive = CharacterSheetState._getPassiveClauses(mixed);
		expect(passive).toContain("against poison");
		expect(passive).not.toContain("reroll");
	});
});

describe("_hasStructuredEquivalent — prose loses to a structured prop", () => {
	it("reports structured for a real non-zero value", () => {
		expect(CharacterSheetState._hasStructuredEquivalent({bonusAc: "+1"}, "ac")).toBe(true);
		expect(CharacterSheetState._hasStructuredEquivalent({bonusSavingThrow: "+2"}, "save:all")).toBe(true);
		expect(CharacterSheetState._hasStructuredEquivalent({ability: {str: 2}}, "ability:str")).toBe(true);
	});

	it("treats the inventory normaliser's literal 0 as absent", () => {
		// REGRESSION PIN. `_addItem` materialises every `bonus*` prop onto the row, so a
		// `!= null` test reports "structured" for EVERY item and suppresses every prose
		// conditional. Measured: this made the whole feature silently inert.
		const normalised = {bonusAc: 0, bonusSavingThrow: 0, bonusWeapon: 0, bonusWeaponAttack: 0};
		expect(CharacterSheetState._hasStructuredEquivalent(normalised, "ac")).toBe(false);
		expect(CharacterSheetState._hasStructuredEquivalent(normalised, "save:all")).toBe(false);
		expect(CharacterSheetState._hasStructuredEquivalent(normalised, "attack")).toBe(false);
	});

	it("ignores an unrelated modifier type", () => {
		expect(CharacterSheetState._hasStructuredEquivalent({bonusAc: "+1"}, "save:all")).toBe(false);
	});
});

describe("_getItemConditionalModifiers", () => {
	it("surfaces a conditional save bonus from an equipped, attuned item", () => {
		const state = makeStateWithItems([stone("Ioun Stone #046, Green Star", PROSE.poison)]);
		const mods = state._getItemConditionalModifiers();
		expect(mods).toHaveLength(1);
		expect(mods[0]).toMatchObject({
			type: "save:all",
			value: 1,
			conditional: "against poison",
			name: "Ioun Stone #046, Green Star",
			enabled: false,
		});
	});

	it("ignores an item that is not equipped", () => {
		const state = makeStateWithItems([{data: stone("Ioun Stone #046, Green Star", PROSE.poison), opts: {equipped: false}}]);
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});

	it("ignores an attunement item that is not attuned", () => {
		const state = makeStateWithItems([{data: stone("Ioun Stone #046, Green Star", PROSE.poison), opts: {attuned: false}}]);
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});

	it("returns ONLY conditional modifiers, never unconditional ones", () => {
		// Unconditional item save bonuses already flow through `bonusSavingThrow` and
		// `_getItemProseSaveBonus`. Returning only the conditional subset makes
		// double-counting impossible by construction rather than by guard.
		const state = makeStateWithItems([stone("Plain Stone", PROSE.unconditional)]);
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});

	it("does not treat an item's baseline state as a condition", () => {
		// "while wearing" is the normal way to say the item is in use — not a narrowing
		// qualifier. Treating it as one would demote Bracers of Archery and every piece
		// of dragon scale mail into a per-roll opt-in prompt.
		const bracers = {
			name: "Bracers of Archery",
			entries: ["You gain a +2 bonus to damage rolls with ranged weapons while wearing these bracers."],
		};
		const state = makeStateWithItems([bracers]);
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});

	it("suppresses a prose modifier the item already expresses structurally", () => {
		// Pariah's Shield carries BOTH `bonusAc: "+1"` and prose the parser reads as a
		// conditional +1 AC. Without the guard the structured bonus applies always AND
		// the prose one is offered as an opt-in that stacks a second +1 on top.
		const shield = {
			name: "Pariah's Shield",
			bonusAc: "+1",
			entries: ["You have a +1 bonus to Armor Class while within 5 feet of an ally."],
		};
		const state = makeStateWithItems([shield]);
		expect(state._getItemConditionalModifiers().filter(m => m.type === "ac")).toHaveLength(0);
	});

	it("drops a third-party bonus even from an equipped, attuned item", () => {
		const state = makeStateWithItems([stone("Ioun Stone #057", PROSE.thirdParty)]);
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});

	it("memoises against equip/attune state and recomputes when it changes", () => {
		const state = makeStateWithItems([stone("Ioun Stone #046, Green Star", PROSE.poison)]);
		const first = state._getItemConditionalModifiers();
		expect(state._getItemConditionalModifiers()).toBe(first); // same array instance

		state._data.inventory[0].attuned = false;
		expect(state._getItemConditionalModifiers()).toHaveLength(0);
	});
});

describe("end-to-end — aggregateModifiers gating and opt-in", () => {
	function greenStarState () {
		return makeStateWithItems([stone("Ioun Stone #046, Green Star", PROSE.poison)]);
	}

	it("does NOT apply the conditional bonus by default", () => {
		const result = greenStarState().aggregateModifiers("save");
		expect(result.bonus).toBe(0);
	});

	it("surfaces it as an available conditional for the roll handlers", () => {
		const result = greenStarState().aggregateModifiers("save");
		const available = result.conditionalsAvailable || [];
		expect(available).toHaveLength(1);
		expect(available[0].conditional).toBe("against poison");
		expect(available[0].id).toContain("Ioun Stone #046, Green Star");
	});

	it("applies it once opted in, attributed to the item", () => {
		const state = greenStarState();
		const ids = (state.aggregateModifiers("save").conditionalsAvailable || []).map(c => c.id);
		// NB: must be a Set — `aggregateModifiers` ignores a plain array.
		const result = state.aggregateModifiers("save", {appliedConditionalIds: new Set(ids)});
		expect(result.bonus).toBe(1);
		expect(result.sources).toContain("Ioun Stone #046, Green Star");
	});

	it("offers nothing when the stone is stowed", () => {
		const state = greenStarState();
		state._data.inventory[0].equipped = false;
		state._itemConditionalModifierCache = null;
		expect(state.aggregateModifiers("save").conditionalsAvailable || []).toHaveLength(0);
	});
});
