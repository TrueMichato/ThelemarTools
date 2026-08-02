/**
 * CS-BUG-108 — the level-up "Swap a Known Spell" list was empty for every known caster,
 * because `_renderSpellSwapSection` filtered its candidates with `!s.sourceFeature` while
 * every spell the player picks carries a POSITIVE attribution ("Spells Known", "Wizard
 * Spellbook", …). The fix moved the rule into `CharacterSheetClassUtils.isSwappableKnownSpell`.
 *
 * `CharacterSheetSpellSwapCandidates.test.js` pins that predicate — but it re-derives the
 * filter locally (`spells.filter(s => ClassUtils.isSwappableKnownSpell(s))`) and asserts the
 * coupling to the renderer only in a COMMENT. Restore `!s.sourceFeature` at the call site,
 * or drop the call entirely, and the predicate stays correct while every one of those tests
 * stays green — the original bug, undetected. That is the same shape as CS-BUG-102 (state
 * API fixed, renderer kept its own copy of the formula).
 *
 * So this file drives the real `_renderSpellSwapSection` and reads what it actually wrote
 * into the DOM: either the rendered swap rows, or the "No swappable spells known."
 * empty-state that players were shown for levels 2-20.
 *
 * `charactersheet-levelup.js` captures `e_`/`CharacterSheetClassUtils` from `globalThis` at
 * module load (line 11), and jest runs on `node` with no DOM, so the stubs must be installed
 * BEFORE the module is imported — hence the dynamic import below.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

/** A DOM stub that records what production code wrote, rather than discarding it. */
function makeStubNode (outerHtml = "") {
	/** @type {*} */
	const node = {
		outerHtml,
		html: "",
		appended: [],
		style: {},
		dataset: {},
		classList: {add () {}, remove () {}, toggle () {}, contains () { return false; }},
		addEventListener () {},
		setAttribute () {},
		_bySelector: {},
		set innerHTML (v) { this.html = v; },
		get innerHTML () { return this.html; },
		insertAdjacentHTML (_pos, html) { this.html += html; },
		append (child) { this.appended.push(child); },
		appendChild (child) { this.appended.push(child); },
		querySelector (sel) { return this._bySelector[sel] || (this._bySelector[sel] = makeStubNode()); },
		querySelectorAll () { return []; },
	};
	return node;
}

globalThis.e_ = (/** @type {*} */ opts) => makeStubNode(opts?.outer || "");
globalThis.ee = () => makeStubNode();

await import("../../../js/charactersheet/charactersheet-levelup.js");
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

const SWAP_LIST_SEL = ".charsheet__levelup-spell-swap-list";

/**
 * Invoke the production render method with a minimal `this`. Only `this._state` is
 * reachable on the initial render — `this._page` is used solely by the replacement
 * picker, which opens on click.
 */
function renderSwapSection (knownSpells) {
	const section = CharacterSheetLevelUp.prototype._renderSpellSwapSection.call(
		{_state: {getSpellsKnown: () => knownSpells}},
		{
			classEntry: {name: "Sorcerer", source: "PHB", level: 4},
			newLevel: 4,
			knownMaxSpellLevel: 2,
			selectedSubclass: null,
			selectedSubclassChoice: null,
			onSwap: () => {},
		},
	);
	const list = section.querySelector(SWAP_LIST_SEL);
	return {
		section,
		emptyStateText: list.innerHTML,
		rowHtml: list.appended.map((/** @type {*} */ r) => r.outerHtml).join("\n"),
	};
}

const PLAYER_PICKED = [
	{name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known"},
	{name: "Shield", source: "PHB", level: 1, sourceFeature: "Spells Known"},
];

describe("Level-up spell swap — the rendered section (CS-BUG-108)", () => {
	it("renders a swappable row for each player-picked spell, not the empty state", () => {
		const {emptyStateText, rowHtml} = renderSwapSection(PLAYER_PICKED);

		// The regression: this is what every known caster saw at levels 2-20.
		expect(emptyStateText).not.toContain("No swappable spells known.");

		expect(rowHtml).toContain("Magic Missile");
		expect(rowHtml).toContain("Shield");
		// Each row must carry a live Swap control, or there is nothing to click.
		expect(rowHtml.match(/charsheet__spell-swap-btn/g) || []).toHaveLength(2);
	});

	it("still shows the empty state when nothing is swappable, so the assertion above is not vacuous", () => {
		const {emptyStateText, rowHtml} = renderSwapSection([
			{name: "Call Lightning", source: "PHB", level: 3, sourceFeature: "Storm Sorcery", alwaysPrepared: true},
			{name: "Fire Bolt", source: "PHB", level: 0, sourceFeature: "Cantrips Known"},
		]);

		expect(emptyStateText).toContain("No swappable spells known.");
		expect(rowHtml).toBe("");
	});

	it("offers player picks while withholding subclass grants from the same list", () => {
		const {rowHtml} = renderSwapSection([
			...PLAYER_PICKED,
			{name: "Call Lightning", source: "PHB", level: 3, sourceFeature: "Storm Sorcery", alwaysPrepared: true},
		]);

		expect(rowHtml).toContain("Magic Missile");
		expect(rowHtml).not.toContain("Call Lightning");
	});
});
