/**
 * CS-BUG-102 — the Spells-tab per-class card is the surface a player casts from, and it
 * hand-rolled its own `8 + mod + prof`. Every other spell save DC on the sheet routes
 * through `getSpellSaveDcForAbility()`, which includes active-state bonuses, so a character
 * under any `{type: "bonus", target: "spellDc"}` buff (Innate Sorcery, a homebrew ability,
 * a custom toggle) saw the BUFFED DC on the Combat tab and the UNBUFFED one on the Spells
 * tab. Two tabs, two numbers, and the lower one on the tab that matters.
 *
 * This file drives `_buildSpellClassCard()` itself rather than recomputing the formula.
 * An earlier version of this pin lived in `CharacterSheetShadowSorceryRhw.test.js` and
 * asserted `8 + mod + prof + getBonusFromStates("spellDc")` by hand — it stayed GREEN with
 * the production fix neutralized, which is exactly the "correct calculation that nothing
 * reads" failure it was supposed to rule out.
 *
 * `charactersheet-spells.js` captures `e_` at module load (`const {e_, ee} = globalThis`),
 * and jest runs on the `node` environment with no DOM, so the DOM stub must be installed
 * BEFORE the module is imported — hence the dynamic import below.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Selector → stub node, so the test can read what the card actually wrote. */
let renderedNodes = {};

const makeStubNode = () => ({
	textContent: "",
	innerHTML: "",
	title: "",
	style: {},
	dataset: {},
	classList: {add () {}, remove () {}, toggle () {}, contains () { return false; }},
	addEventListener () {},
	setAttribute () {},
	append () {},
	appendChild () {},
	querySelector (sel) { return renderedNodes[sel] || (renderedNodes[sel] = makeStubNode()); },
	querySelectorAll () { return []; },
});

globalThis.e_ = () => makeStubNode();
globalThis.ee = () => makeStubNode();

await import("../../../js/charactersheet/charactersheet-spells.js");
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

/** A level-20 XPHB Sorcerer, so Innate Sorcery's `spellDc` bonus has somewhere to land. */
function makeSorcerer () {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 20);
	state.setAbilityBase("con", 14);
	state._data.classes = [{name: "Sorcerer", source: "XPHB", level: 20}];
	state._data.spellcasting.ability = "cha";
	state.setHp(150, 150);
	state.addFeature({
		level: 1,
		name: "Innate Sorcery",
		source: "XPHB",
		description: "As a Bonus Action, you can unleash that magic for 1 minute, during which you gain the following benefits: the spell save DC of your Sorcerer spells increases by 1, and you have Advantage on the attack rolls of Sorcerer spells you cast. You can use this feature twice, and you regain all expended uses of it when you finish a Long Rest.",
	});
	state.applyClassFeatureEffects();
	return state;
}

/** Build the card and return the Save DC it rendered. */
function renderCardDc (state) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._page = {
		_formatModWithEffective: (canonical, effective) => (canonical === effective ? String(canonical) : `${canonical} (${effective})`),
	};
	renderedNodes = {};
	spells._buildSpellClassCard(
		{className: "Sorcerer", classSource: "XPHB", displayName: "Sorcerer", ability: "cha", abilityLabel: "CHA"},
		true,
		state.getFeatureCalculations(),
	);
	return Number(renderedNodes[".charsheet__spell-dc"].textContent);
}

describe("Spells-tab class card renders the same spell save DC as the rest of the sheet (CS-BUG-102)", () => {
	it("matches the canonical accessor with no buff running", () => {
		const state = makeSorcerer();
		expect(renderCardDc(state)).toBe(state.getSpellSaveDcForAbility("cha"));
	});

	it("rises with an active-state spellDc bonus, and keeps matching the accessor", () => {
		const state = makeSorcerer();
		const before = renderCardDc(state);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(renderCardDc(state)).toBe(before + 1);
		expect(renderCardDc(state)).toBe(state.getSpellSaveDcForAbility("cha"));
	});

	it("picks up a generic custom-ability spellDc bonus, not just Innate Sorcery", () => {
		const state = makeSorcerer();
		const before = renderCardDc(state);
		state.activateState("custom", {
			source: "Probe Buff",
			name: "Probe Buff",
			customEffects: [{type: "bonus", target: "spellDc", value: 3}],
		});
		expect(renderCardDc(state)).toBe(before + 3);
		expect(renderCardDc(state)).toBe(state.getSpellSaveDcForAbility("cha"));
	});

	it("returns to the unbuffed DC when the state ends (control)", () => {
		const state = makeSorcerer();
		const before = renderCardDc(state);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		state.deactivateState("innateSorcery");
		expect(renderCardDc(state)).toBe(before);
	});
});
