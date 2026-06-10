/**
 * Verifies the Spells tab is re-rendered when a feat grants FIXED (non-choice)
 * spells, so granted cantrips/innate spells appear without a page reload.
 */
import "./setup.js"; // Import first to set up mocks
import {jest} from "@jest/globals";

// CharacterSheetFeatures' constructor wires a global click listener.
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}};
}

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

/**
 * Minimal mock spell DB so granted spells can be enriched during addFeat.
 */
const MOCK_SPELLS = [
	{name: "Shillelagh", source: "PHB", level: 0, school: "T", time: [{number: 1, unit: "bonus"}], range: {type: "point", distance: {type: "touch"}}, components: {v: true, s: true}, duration: [{type: "timed", duration: {type: "minute", amount: 1}}], entries: ["..."]},
	{name: "Mend Plants", source: "HumblewoodTales", level: 0, school: "T", time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "feet", amount: 30}}, components: {v: true, s: true}, duration: [{type: "instant"}], entries: ["..."]},
	{name: "Barkskin", source: "PHB", level: 2, school: "T", time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "touch"}}, components: {v: true, s: true, m: "oak bark"}, duration: [{type: "timed", duration: {type: "hour", amount: 1}, concentration: true}], entries: ["..."]},
	{name: "Spike Growth", source: "PHB", level: 2, school: "T", time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "feet", amount: 150}}, components: {v: true, s: true}, duration: [{type: "timed", duration: {type: "minute", amount: 10}, concentration: true}], entries: ["..."]},
];

const PLANTMENDER_FEAT = {
	name: "Plantmender",
	source: "HumblewoodTales",
	additionalSpells: [{
		ability: "wis",
		known: {"_": ["shillelagh#c", "mend plants|HumblewoodTales#c"]},
		innate: {"_": {daily: {"1": ["barkskin", "spike growth"]}}},
	}],
};

/**
 * Builds a CharacterSheetFeatures wired to a real state with a mocked page.
 * The instance `render()` (Features tab) is stubbed to avoid DOM work; we only
 * care about the Spells-tab render call triggered after the feat is added.
 */
function makeFeatures () {
	const state = new CharacterSheetState();
	const spellsRenderSpy = jest.fn();

	const page = {
		getState: () => state,
		getSpells: () => MOCK_SPELLS,
		saveCharacter: jest.fn(),
		_renderAbilityScores: jest.fn(),
		_renderAbilitiesDetailed: jest.fn(),
		_renderSavingThrows: jest.fn(),
		_renderSkills: jest.fn(),
		_spells: {render: spellsRenderSpy},
	};

	const features = new CharacterSheetFeatures(page);
	// Avoid Features-tab DOM rendering during the test.
	features.render = jest.fn();

	return {features, state, page, spellsRenderSpy};
}

describe("Feat-granted spells reactive render", () => {
	test("adding a fixed-grant feat re-renders the Spells tab immediately", async () => {
		const {features, spellsRenderSpy} = makeFeatures();

		await features._addFeat(PLANTMENDER_FEAT);

		// The Spells tab must be refreshed without waiting for a page reload.
		expect(spellsRenderSpy).toHaveBeenCalledTimes(1);
	});

	test("granted cantrips and innate spells are queryable immediately after add", async () => {
		const {features, state} = makeFeatures();

		await features._addFeat(PLANTMENDER_FEAT);

		const cantrips = state.getCantrips();
		expect(cantrips.find(c => c.name === "Shillelagh")).toBeTruthy();
		expect(cantrips.find(c => c.name === "Mend Plants")).toBeTruthy();

		const innate = state.getInnateSpells();
		expect(innate.find(s => s.name === "Barkskin")).toBeTruthy();
		expect(innate.find(s => s.name === "Spike Growth")).toBeTruthy();

		// Fixed grants must not leave pending spell choices (would route to modal path).
		expect(state.hasPendingSpellChoices()).toBe(false);
	});

	test("Spells render observes the granted spells already present in state", async () => {
		const {features, state, spellsRenderSpy} = makeFeatures();

		// Proves render fires AFTER the state mutation, not before — otherwise the
		// tab would still paint stale data.
		spellsRenderSpy.mockImplementation(() => {
			expect(state.getCantrips().some(c => c.name === "Shillelagh")).toBe(true);
			expect(state.getInnateSpells().some(s => s.name === "Barkskin")).toBe(true);
		});

		await features._addFeat(PLANTMENDER_FEAT);

		expect(spellsRenderSpy).toHaveBeenCalledTimes(1);
	});

	test("adding a fixed-grant feat does not require a Spells tab controller", async () => {
		const {features, page} = makeFeatures();
		delete page._spells; // optional chaining must keep this from throwing

		await expect(features._addFeat(PLANTMENDER_FEAT)).resolves.toBeUndefined();
	});
});
