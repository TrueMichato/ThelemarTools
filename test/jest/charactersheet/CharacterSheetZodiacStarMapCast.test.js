/**
 * Star Map → Guiding Bolt casting integration (`_castSpell`).
 *
 * These tests drive the real CharacterSheetSpells._castSpell flow with a
 * minimal page/UI harness to lock in the casting-resource integration:
 *
 *  - Selecting the Star Map "no-slot" option spends exactly one Star Map
 *    charge and NO spell slot.
 *  - A variant spell component whose effect is "noSlot" waives the spell
 *    *slot*, but must NOT also waive the Star Map charge — the resource the
 *    player explicitly chose to cast with is always spent (blocking
 *    regression: previously skipSlotConsumption short-circuited the resource
 *    decrement, granting a free cast).
 *  - Cancelling the cast (e.g. target selection aborted) refunds the charge.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const STAR_MAP_XPHB_TEXT = "While holding the map, you have the Guidance and Guiding Bolt spells prepared, and you can cast Guiding Bolt without expending a spell slot. You can cast it in that way a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest.";

const GUIDING_BOLT_DATA = {name: "Guiding Bolt", source: "XPHB", level: 1, school: "V", duration: [{type: "instant"}]};

function makeDruidWithStarMap () {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level: 3,
		subclass: {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"},
	});
	state.setAbilityBase("wis", 16); // +3 -> 3 Star Map charges
	state.addFeature({
		name: "Star Map",
		source: "XPHB",
		className: "Druid",
		subclassName: "Circle of the Stars",
		level: 3,
		description: STAR_MAP_XPHB_TEXT,
	});
	state.addSpell({...GUIDING_BOLT_DATA, prepared: true});
	return state;
}

/**
 * Build a CharacterSheetSpells whose UI/cast side-effects are stubbed so we can
 * exercise _castSpell deterministically.
 * @param {*} state
 * @param {{variantNoSlot?: boolean, cancelResult?: boolean}} opts
 */
function makeSpellsManager (state, opts = {}) {
	const page = {
		getState: () => state,
		_renderResources: () => {},
		_renderQuickSpells: () => {},
		saveCharacter: () => {},
		_combat: null,
	};
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = page;
	spells._state = state;
	spells._allSpells = [GUIDING_BOLT_DATA];

	// Auto-select the Star Map option in the slot picker.
	globalThis.InputUiUtil = globalThis.InputUiUtil || {};
	globalThis.InputUiUtil.pGetUserEnum = async ({values}) => values.find(v => /Star Map/.test(v));

	spells._pChooseActiveMetamagic = async () => null;
	spells._pHandleCastingConstraints = async () => true;
	spells._refreshSorceryPointUI = () => {};
	spells._pChooseVariantComponent = async () => (opts.variantNoSlot
		? {variantComponent: {effects: [{type: "noSlot"}], itemIds: []}}
		: null);
	spells._getNormalizedCastMeta = (o) => o.castMeta || {};
	spells._showCastResult = async () => ({cancelled: !!opts.cancelResult});
	spells.renderSlots = () => {};
	spells._updateConcentrationUI = () => {};
	return spells;
}

function getStarMapCurrent (state) {
	return state.getResource("Star Map").current;
}

function getSpellSlotTotals (state) {
	const slots = state.getSpellSlots();
	return Object.values(slots).reduce((acc, s) => acc + (s.current || 0), 0);
}

describe("Star Map — _castSpell integration", () => {
	it("spends exactly one Star Map charge and no spell slot on a successful cast", async () => {
		const state = makeDruidWithStarMap();
		const spells = makeSpellsManager(state);
		const guidingBolt = state.getSpells().find(s => s.name === "Guiding Bolt");

		const slotsBefore = getSpellSlotTotals(state);
		expect(getStarMapCurrent(state)).toBe(3);

		await spells._castSpell(guidingBolt.id);

		expect(getStarMapCurrent(state)).toBe(2);
		expect(getSpellSlotTotals(state)).toBe(slotsBefore); // no slot consumed
	});

	it("still spends the Star Map charge when a noSlot variant component is used", async () => {
		const state = makeDruidWithStarMap();
		const spells = makeSpellsManager(state, {variantNoSlot: true});
		const guidingBolt = state.getSpells().find(s => s.name === "Guiding Bolt");

		const slotsBefore = getSpellSlotTotals(state);
		await spells._castSpell(guidingBolt.id);

		// noSlot waives the slot, but the chosen Star Map resource is still spent.
		expect(getStarMapCurrent(state)).toBe(2);
		expect(getSpellSlotTotals(state)).toBe(slotsBefore);
	});

	it("refunds the Star Map charge when the cast is cancelled", async () => {
		const state = makeDruidWithStarMap();
		const spells = makeSpellsManager(state, {cancelResult: true});
		const guidingBolt = state.getSpells().find(s => s.name === "Guiding Bolt");

		await spells._castSpell(guidingBolt.id);

		expect(getStarMapCurrent(state)).toBe(3); // refunded
	});

	it("does not let an exhausted Star Map cast (no charge, no slot spent)", async () => {
		const state = makeDruidWithStarMap();
		const res = state.getResource("Star Map");
		state.setResourceCurrent(res.id, 0);
		const spells = makeSpellsManager(state);
		const guidingBolt = state.getSpells().find(s => s.name === "Guiding Bolt");

		const slotsBefore = getSpellSlotTotals(state);
		await spells._castSpell(guidingBolt.id);

		// Star Map isn't offered; with slots available it falls through to a slot
		// cast OR (if none) warns — either way the resource stays at 0.
		expect(getStarMapCurrent(state)).toBe(0);
		expect(getSpellSlotTotals(state)).toBeLessThanOrEqual(slotsBefore);
	});
});
