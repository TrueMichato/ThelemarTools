import "./setup.js";
import fs from "node:fs";
import {beforeAll, beforeEach, jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const State = globalThis.CharacterSheetState;
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
let Page;
let Features;
let elements;
let cards;

beforeAll(async () => {
	const originalElement = globalThis.e_;
	globalThis.e_ = opts => {
		const element = originalElement(opts);
		if (opts.outer?.includes("class=\"charsheet__feat charsheet__feature\"")) {
			const children = new Map([
				[".charsheet__feature-body", originalElement()],
				[".charsheet__feature-toggle", originalElement()],
				[".charsheet__feat-remove", originalElement()],
			]);
			element.querySelector = selector => children.get(selector) || null;
			cards.push(element);
		}
		return element;
	};
	globalThis.window = {
		addEventListener: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false}),
	};
	globalThis.document = {addEventListener: () => {}, querySelector: () => null};
	await import("../../../js/charactersheet/charactersheet-features.js");
	await import("../../../js/charactersheet/charactersheet.js");
	Page = globalThis.CharacterSheetPage;
	Features = globalThis.CharacterSheetFeatures;
});

beforeEach(() => {
	cards = [];
	elements = new Map([
		["charsheet-disp-initiative", {innerHTML: ""}],
		["charsheet-box-initiative", {setAttribute (name, value) { this[name] = value; }}],
		["charsheet-feats-list", {innerHTML: "", append: jest.fn()}],
	]);
	globalThis.document = {
		addEventListener: () => {},
		getElementById: id => elements.get(id) || null,
	};
});

function makeFeatures () {
	const state = new State();
	state.addClass({name: "Fighter", source: "XPHB", level: 5});
	state.setAbilityBase("dex", 14);
	const page = Object.create(Page.prototype);
	Object.assign(page, {
		_state: state,
		getSpells: () => [],
		saveCharacter: jest.fn(),
		getHoverLink: undefined,
		_renderFavouriteStar: undefined,
		_renderAbilityScores: jest.fn(),
		_renderAbilitiesDetailed: jest.fn(),
		_renderSavingThrows: jest.fn(),
		_renderSkills: jest.fn(),
		_renderCombatStats: jest.fn(() => page._renderInitiativeStat()),
	});
	const features = new Features(page);
	features.render = jest.fn();
	page._renderInitiativeStat();
	return {state, page, features};
}

describe("feat acquisition and removal refresh dependent stats", () => {
	test.each([["PHB", 5], ["XPHB", 3]])("adding authored Alert|%s updates the real initiative renderer immediately", async (source, value) => {
		const {state, page, features} = makeFeatures();
		const feat = feats.find(entry => entry.name === "Alert" && entry.source === source);
		await expect(features._addFeat(feat)).resolves.toBe(true);
		expect(state.getInitiative()).toBe(2 + value);
		expect(page._renderCombatStats).toHaveBeenCalledTimes(1);
		expect(elements.get("charsheet-box-initiative").title).toContain(`Alert: +${value}`);
		expect(elements.get("charsheet-box-initiative").title).not.toContain("Custom Modifier");
		expect(elements.get("charsheet-disp-initiative").innerHTML).toContain(`(+${2 + value})`);
	});

	test.each(["PHB", "XPHB"])("the bound Alert|%s remove button restores initiative and score-dependent sections", async source => {
		const {state, page, features} = makeFeatures();
		await features._addFeat(feats.find(entry => entry.name === "Alert" && entry.source === source));
		for (const name of ["_renderAbilityScores", "_renderAbilitiesDetailed", "_renderSavingThrows", "_renderSkills", "_renderCombatStats"]) page[name].mockClear();
		features._renderFeats();
		expect(cards).toHaveLength(1);
		cards[0].querySelector(".charsheet__feat-remove")._handlers.click({stopPropagation: jest.fn()});
		expect(state.getFeats()).toHaveLength(0);
		expect(state.getInitiative()).toBe(2);
		for (const name of ["_renderAbilityScores", "_renderAbilitiesDetailed", "_renderSavingThrows", "_renderSkills", "_renderCombatStats"]) expect(page[name]).toHaveBeenCalledTimes(1);
		expect(elements.get("charsheet-box-initiative").title).not.toContain("Alert");
		expect(elements.get("charsheet-box-initiative").title).toContain("Total: +2");
		expect(elements.get("charsheet-disp-initiative").innerHTML).toBe("+2");
	});

	test("a rejected duplicate does not refresh or register another contribution", async () => {
		const {state, page, features} = makeFeatures();
		const feat = feats.find(entry => entry.name === "Alert" && entry.source === "XPHB");
		await features._addFeat(feat);
		await expect(features._addFeat(feat)).resolves.toBe(false);
		expect(state.getFeats()).toHaveLength(1);
		expect(page._renderCombatStats).toHaveBeenCalledTimes(1);
		expect(state.getInitiative()).toBe(5);
	});
});
