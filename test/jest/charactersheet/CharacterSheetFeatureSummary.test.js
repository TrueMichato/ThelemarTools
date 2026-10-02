import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import {installFeatureSummaryDom} from "./fixtures/feature-summary-dom.js";

const dom = installFeatureSummaryDom();
await import("../../../js/charactersheet/charactersheet-features.js");
dom.restore();

const ClassUtils = globalThis.CharacterSheetClassUtils;
const Features = globalThis.CharacterSheetFeatures;
const State = globalThis.CharacterSheetState;
const rangerData = JSON.parse(fs.readFileSync("data/class/class-ranger.json", "utf8"));
const barbarianData = JSON.parse(fs.readFileSync("data/class/class-barbarian.json", "utf8"));
const optionalData = JSON.parse(fs.readFileSync("data/optionalfeatures.json", "utf8")).optionalfeature;
const colossus = rangerData.subclassFeature.find(f => f.name === "Colossus Slayer" && f.source === "PHB");
const shadows = optionalData.find(f => f.name === "Armor of Shadows" && f.source === "PHB");
const makeRow = (name, opts = {}) => ({id: name, name, source: "PHB", description: `<p>${name} details</p>`, ...opts});
const classRow = (name, opts = {}) => makeRow(name, {featureType: "Class", className: "Ranger", classSource: "PHB", level: 3, ...opts});
const optionalRow = (name, opts = {}) => classRow(name, {featureType: "Optional Feature", optionalFeatureTypes: ["EI"], ...opts});

let containers;
let modalInner;
let showModal;
let closeModal;
let toast;
let originalDocument;

beforeEach(() => {
	originalDocument = globalThis.document;
	containers = new Map([
		"charsheet-features-summary",
		"charsheet-class-features",
		"charsheet-race-features",
		"charsheet-background-features",
	].map(id => [id, dom.createElement()]));
	globalThis.document = {getElementById: id => containers.get(id), addEventListener () {}};
	modalInner = dom.createElement();
	closeModal = jest.fn();
	showModal = jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose: closeModal});
	toast = jest.spyOn(JqueryUtil, "doToast");
});

afterEach(() => {
	jest.restoreAllMocks();
	globalThis.document = originalDocument;
});

function makeFeatures (rows, {classes = [{name: "Ranger", source: "PHB", level: 3}], race = null, classFeatures = [], subclassFeatures = [], optionalFeatures = []} = {}) {
	const state = new State();
	state._data.classes = structuredClone(classes);
	state._data.race = race;
	state._data.background = {name: "Sage", source: "PHB"};
	state._data.features = structuredClone(rows);
	state.getFeatureCalculations = () => ({});
	const page = {
		getState: () => state,
		getClassFeatures: () => classFeatures,
		getSubclassFeatures: () => subclassFeatures,
		getOptionalFeatures: () => optionalFeatures,
		_getFeatureHoverLink: feature => `<a data-source="${feature.source}">${feature.name}</a>`,
		_renderFavouriteStar: () => null,
	};
	return {features: new Features(page), state};
}

const summaryHtml = () => containers.get("charsheet-features-summary").innerHTML;
const summaryRows = () => containers.get("charsheet-features-summary").children
	.filter(el => el.outerHTML.includes("class=\"charsheet__feature-summary-item\""));
const modalRows = () => modalInner.children[0]?.children || [];
const modalNames = () => modalRows().map(el => el.outerHTML.match(/<strong>(.*?)<\/strong>/)[1]);

describe("CS-BUG-113 feature summary and expanded class list", () => {
	test("renders mixed Class, Optional Feature, and untyped subclass rows without mutating them", async () => {
		expect(colossus).toBeDefined();
		expect(shadows.featureType).toEqual(["EI"]);
		const optional = ClassUtils.buildFeatureStateObject(shadows, {featureType: "Optional Feature", className: "Warlock", classSource: "PHB", level: 2});
		const {features, state} = makeFeatures([
			classRow("Second Wind", {uses: {current: 1, max: 2}}),
			{...optional, id: "shadows", important: true},
			{...colossus, id: "colossus", important: true},
			classRow("Bear", {featureType: "Subclass", subclassShortName: "Totem Warrior", important: true}),
			optionalRow("Aimed Spell", {important: true}),
		]);
		const before = state.toJson();
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(5);
		for (const name of ["Second Wind", "Armor of Shadows", "Colossus Slayer", "Bear", "Aimed Spell"]) {
			expect(summaryHtml()).toContain(`>${name}</a>`);
		}
		expect(summaryHtml()).toContain("(1/2)");
		await features._pShowMoreFeaturesModal("Class");
		expect(showModal).toHaveBeenCalledWith(expect.objectContaining({title: "All Class Features"}));
		expect(modalNames()).toEqual(["Second Wind", "Armor of Shadows", "Colossus Slayer", "Bear", "Aimed Spell"]);
		expect(modalRows()[0].outerHTML).toContain("(1/2 uses)");
		expect(modalRows()[1].outerHTML).toContain("without expending a spell slot");
		expect(modalRows()[2].outerHTML).toContain("extra {@damage 1d8} damage");
		expect(state.toJson()).toEqual(before);
		modalInner.children[1].querySelector("button").click();
		expect(closeModal).toHaveBeenCalledWith(false);
	});

	test("a real Totem Spirit choice writer's Subclass row reaches both displays", async () => {
		const spirit = barbarianData.subclassFeature.find(f => f.name === "Totem Spirit" && f.source === "PHB" && f.level === 3);
		expect(spirit).toBeDefined();
		const {features, state} = makeFeatures([], {classes: [{name: "Barbarian", source: "PHB", level: 3}]});
		state.setClassFeatureCatalog(barbarianData.classFeature, barbarianData.subclassFeature, []);
		state.addFeature(spirit);
		ClassUtils.seedSubclassFeatureChoices(state, [spirit], {});
		const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Totem Spirit");
		expect(choice?.options.find(o => o.name === "Bear")?.subclassShortName).toBe("Totem Warrior");
		expect(state.fulfillFeatureChoice(choice.id, {name: "Bear", source: "PHB"})).toBe(true);
		const bear = state.getFeatures().find(f => f.name === "Bear");
		expect(bear.featureType).toBe("Subclass");
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain(">Bear</a>");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toContain("Bear");
		expect(modalRows().find(el => el.outerHTML.includes("<strong>Bear</strong>")).outerHTML).toContain("resistance");
	});

	test("caps important class rows at five, counts mixed kinds, and expands the complete list in stored order", async () => {
		const rows = [
			classRow("First", {important: true}),
			optionalRow("Second", {important: true}),
			classRow("Third", {featureType: "Subclass", important: true}),
			classRow("Fourth", {important: true, featureType: undefined, subclassShortName: "Hunter"}),
			optionalRow("Fifth", {important: true}),
			optionalRow("Sixth", {important: true}),
			classRow("Seventh", {featureType: "Subclass", important: true}),
			classRow("Reference Only"),
		];
		const {features} = makeFeatures(rows);
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(5);
		expect(summaryHtml()).toContain("+2 more class features");
		expect(summaryHtml()).toContain("data-feature-type=\"Class\"");
		expect(summaryHtml()).not.toContain(">Sixth</a>");
		expect(summaryHtml()).not.toContain(">Reference Only</a>");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(rows.map(f => f.name));
	});

	test("fallback samples optional/subclass rows and keeps capped rows reachable", async () => {
		const {features} = makeFeatures([
			optionalRow("One"), classRow("Two", {featureType: "Subclass"}),
			classRow("Three", {featureType: undefined}), optionalRow("Four"),
			optionalRow("Five"), optionalRow("Six"),
		]);
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(3);
		expect(summaryHtml()).toContain(">One</a>");
		expect(summaryHtml()).toContain(">Two</a>");
		expect(summaryHtml()).toContain(">Three</a>");
		expect(summaryHtml()).toContain("+3 more class features");
		expect(summaryHtml()).toContain("data-feature-type=\"Class\"");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["One", "Two", "Three", "Four", "Five", "Six"]);
	});

	test("retains species/race/subrace and background categories, excluding feat/manual/unknown rows from Class", async () => {
		const {features} = makeFeatures([
			classRow("Class Control", {important: true}),
			makeRow("Species Control", {featureType: "Species", className: "Ranger", level: 3, important: true}),
			makeRow("Race Control", {featureType: "Race", important: true}),
			makeRow("Subrace Control", {featureType: "Subrace", important: true}),
			makeRow("Species Extra", {featureType: "Species", important: true}),
			makeRow("Background Control", {featureType: "Background", classSource: "PHB", important: true}),
			makeRow("Feat Control", {featureType: "Feat", className: "Ranger", important: true}),
			makeRow("Manual Control", {featureType: "Feature", className: "Ranger", level: 3, important: true}),
			makeRow("Unknown Control", {level: 3, important: true}),
		], {race: {name: "Elf", source: "PHB"}});
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain("<strong>Species</strong>");
		expect(summaryHtml()).toContain(">Race Control</a>");
		expect(summaryHtml()).toContain(">Background Control</a>");
		expect(summaryHtml()).toContain("+1 more species features");
		expect(summaryHtml()).toContain("data-feature-type=\"Species\"");
		for (const name of ["Feat Control", "Manual Control", "Unknown Control"]) expect(summaryHtml()).not.toContain(name);
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Class Control"]);
		modalInner = dom.createElement();
		showModal.mockResolvedValue({eleModalInner: modalInner, doClose: closeModal});
		await features._pShowMoreFeaturesModal("Species");
		expect(modalNames()).toEqual(["Species Control", "Race Control", "Subrace Control", "Species Extra"]);
		features._renderClassFeatures();
		const classHtml = containers.get("charsheet-class-features").innerHTML;
		expect(classHtml).toContain("Class Control");
		for (const name of ["Species Control", "Background Control", "Feat Control", "Manual Control", "Unknown Control"]) expect(classHtml).not.toContain(name);
		features._renderRaceFeatures();
		expect(containers.get("charsheet-race-features").innerHTML).toContain("Subrace Control");
		features._renderBackgroundFeatures();
		expect(containers.get("charsheet-background-features").innerHTML).toContain("Background Control");
	});

	test.each(["Class Feature", "Subclass Feature", "classFeature", "subclassFeature"])("supports the existing legacy %s label on all class displays", async featureType => {
		const {features} = makeFeatures([makeRow("Legacy", {featureType, important: true})]);
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain(">Legacy</a>");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Legacy"]);
		features._renderClassFeatures();
		expect(containers.get("charsheet-class-features").innerHTML).toContain("Legacy");
	});

	test("uses exact source-aware catalog identity for untyped rows, not a numeric level or name alone", async () => {
		const catalog = [classRow("Catalog Match", {source: "XPHB", entries: ["As a reaction, protect an ally."]})];
		const {features} = makeFeatures([
			makeRow("Catalog Match", {source: "xphb", description: "", level: 3}),
			makeRow("Catalog Match", {source: "PHB", description: "", level: 3}),
		], {classFeatures: catalog});
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(1);
		expect(summaryHtml()).toContain("data-source=\"xphb\"");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalRows()).toHaveLength(1);
		expect(modalRows()[0].outerHTML).toContain("protect an ally");
	});

	test("uses entries and source-qualified optional catalog descriptions for importance and expanded bodies", async () => {
		const {features} = makeFeatures([
			optionalRow("Entries Only", {description: "", entries: ["As a bonus action, move."]}),
			optionalRow("Catalog Only", {source: "XPHB", description: ""}),
		], {optionalFeatures: [
			{name: "Catalog Only", source: "PHB", entries: ["Wrong edition body."]},
			{name: "Catalog Only", source: "XPHB", entries: ["As a reaction, defend."]},
		]});
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain("<strong>Class</strong>");
		expect(summaryRows()).toHaveLength(2);
		await features._pShowMoreFeaturesModal("Class");
		expect(modalRows()[0].outerHTML).toContain("As a bonus action, move.");
		expect(modalRows()[1].outerHTML).toContain("As a reaction, defend.");
		expect(modalInner.innerHTML).not.toContain("Wrong edition body.");
	});

	test("preserves same-named distinct sources and applies the existing display-equivalent merge before caps/counts", async () => {
		const rows = [
			classRow("Duplicate Name", {source: "PHB", important: true}),
			classRow("Duplicate Name", {source: "XPHB", important: true}),
			classRow("Different Name", {important: true}),
			classRow("Fourth", {important: true}),
			classRow("Potent Spellcasting", {source: "XPHB", className: "Cleric", level: 7, parentFeature: "Blessed Strikes", important: true}),
			classRow("Potent Spellcasting", {source: "TGTT", className: "Cleric", level: 8, subclassShortName: "Time", important: true}),
			optionalRow("Sixth", {important: true}),
		];
		const {features, state} = makeFeatures(rows);
		const before = state.toJson();
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(5);
		expect(summaryHtml()).toContain("+1 more class features");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Duplicate Name", "Duplicate Name", "Different Name", "Fourth", "Sixth", "Potent Spellcasting"]);
		expect(modalRows()[0].outerHTML).toContain("Duplicate Name details");
		features._renderClassFeatures();
		expect(containers.get("charsheet-class-features").innerHTML.match(/>Potent Spellcasting<\/a>/g)).toHaveLength(1);
		expect(state.toJson()).toEqual(before);
		expect(state.getFeatures().filter(f => f.name === "Potent Spellcasting")).toHaveLength(2);
	});

	test("main class rendering retains optional groups and untyped subclass descriptions", () => {
		const {features} = makeFeatures([
			classRow("Regular"),
			ClassUtils.buildFeatureStateObject(shadows, {featureType: "Optional Feature", className: "Warlock", classSource: "PHB", level: 2}),
			{...colossus, id: "colossus", description: "<p>Colossus stored body</p>"},
		]);
		features._renderClassFeatures();
		const html = containers.get("charsheet-class-features").innerHTML;
		expect(html).toContain("Regular");
		expect(html).toContain("Eldritch Invocations");
		expect(html).toContain("Armor of Shadows");
		expect(html).toContain("without expending a spell slot");
		expect(html).toContain("Colossus Slayer");
		expect(html).toContain("Colossus stored body");
	});

	test("real metamagic and untyped subclass prose qualify for Overview without an important flag", async () => {
		const quickened = optionalData.find(f => f.name === "Quickened Spell" && f.source === "PHB");
		const giantKiller = rangerData.subclassFeature.find(f => f.name === "Giant Killer" && f.source === "PHB");
		expect(quickened).toBeDefined();
		expect(giantKiller).toBeDefined();
		const {features} = makeFeatures([
			ClassUtils.buildFeatureStateObject(quickened, {featureType: "Optional Feature", className: "Sorcerer", classSource: "PHB", level: 3}),
			{...giantKiller, id: "giant-killer"},
		]);
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain("<strong>Class</strong>");
		expect(summaryHtml()).toContain(">Quickened Spell</a>");
		expect(summaryHtml()).toContain(">Giant Killer</a>");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Quickened Spell", "Giant Killer"]);
		expect(modalRows()[1].outerHTML).toContain("use your reaction");
	});

	test("exact condensed caps do not produce a more count, and rerender does not retain stale rows", () => {
		const {features, state} = makeFeatures([
			...Array.from({length: 5}, (_, i) => optionalRow(`Class ${i}`, {important: true})),
			...Array.from({length: 3}, (_, i) => makeRow(`Species ${i}`, {featureType: "Species", important: true})),
			...Array.from({length: 3}, (_, i) => makeRow(`Background ${i}`, {featureType: "Background", important: true})),
		]);
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(10);
		expect(summaryHtml()).not.toContain("more class features");
		expect(summaryHtml()).not.toContain("more species features");
		expect(summaryHtml()).not.toContain("Background 2");
		state._data.features = [optionalRow("Replacement", {important: true})];
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(1);
		expect(summaryHtml()).toContain(">Replacement</a>");
		expect(summaryHtml()).not.toContain("Class 0");
	});

	test("fallback includes legacy Race and backgrounds and expands capped species in original order", async () => {
		const {features} = makeFeatures([
			makeRow("Legacy Race", {featureType: "Race"}),
			makeRow("Subrace", {featureType: "Subrace"}),
			makeRow("Species", {featureType: "Species"}),
			makeRow("Background", {featureType: "Background"}),
		], {classes: [], race: {name: "Elf", source: "PHB"}});
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(3);
		expect(summaryHtml()).toContain(">Legacy Race</a>");
		expect(summaryHtml()).toContain(">Subrace</a>");
		expect(summaryHtml()).toContain(">Background</a>");
		expect(summaryHtml()).toContain("+1 more species features");
		await features._pShowMoreFeaturesModal("Species");
		expect(modalNames()).toEqual(["Legacy Race", "Subrace", "Species"]);
	});

	test("keeps repeated stored rows as well as distinct names/sources unless the existing display merge applies", async () => {
		const {features, state} = makeFeatures([
			optionalRow("Repeated", {id: "one", description: "<p>First acquisition.</p>", important: true}),
			optionalRow("Repeated", {id: "two", description: "<p>Second acquisition.</p>", important: true}),
			optionalRow("Distinct", {source: "XPHB", important: true}),
		]);
		const before = state.toJson();
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(3);
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Repeated", "Repeated", "Distinct"]);
		expect(modalRows()[0].outerHTML).toContain("First acquisition.");
		expect(modalRows()[1].outerHTML).toContain("Second acquisition.");
		expect(state.toJson()).toEqual(before);
	});

	test("does not borrow descriptions from another source, owner, or ambiguous catalog identity", async () => {
		const {features} = makeFeatures([
			classRow("Missing Source", {source: undefined, description: ""}),
			classRow("Owner Match", {classSource: "PHB", description: ""}),
			classRow("Ambiguous", {className: undefined, classSource: undefined, level: undefined, description: ""}),
		], {classFeatures: [
			classRow("Missing Source", {entries: ["Wrong source body."]}),
			classRow("Owner Match", {classSource: "XPHB", entries: ["Wrong owner body."]}),
			classRow("Ambiguous", {className: "Ranger", entries: ["Ambiguous ranger body."]}),
			classRow("Ambiguous", {className: "Fighter", entries: ["Ambiguous fighter body."]}),
		]});
		await features._pShowMoreFeaturesModal("Class");
		expect(modalRows()).toHaveLength(3);
		expect(modalInner.innerHTML).not.toMatch(/Wrong|Ambiguous (ranger|fighter) body/);
	});

	test("retains supported legacy source attribution without sweeping in unattributed manual rows", async () => {
		const {features} = makeFeatures([
			makeRow("Legacy Class", {source: "Ranger feature"}),
			makeRow("Legacy Species", {source: "Elf trait"}),
			makeRow("Legacy Background", {source: "Sage feature"}),
			makeRow("Manual", {source: "PHB"}),
		], {race: {name: "Elf", source: "PHB"}});
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(3);
		expect(summaryHtml()).not.toContain(">Manual</a>");
		await features._pShowMoreFeaturesModal("Class");
		expect(modalNames()).toEqual(["Legacy Class"]);
	});

	test("fallback total counts use classified display rows, not unrelated manual/feat rows", () => {
		const {features} = makeFeatures([
			...Array.from({length: 6}, (_, i) => optionalRow(`Reference ${i}`)),
			makeRow("Manual", {featureType: "Feature", source: "Ranger manual", className: "Ranger", level: 3}),
			makeRow("Unattributed", {level: 3}),
			makeRow("Feat", {featureType: "Feat"}),
		]);
		features._renderFeaturesSummary();
		expect(summaryRows()).toHaveLength(3);
		expect(summaryHtml()).toContain("View all 6 features in Features tab");
		expect(summaryHtml()).not.toContain("View all 9");
		expect(summaryHtml()).toContain("+3 more class features");
	});

	test("empty character, empty feature list, and empty expanded category remain explicit", async () => {
		const emptyCharacter = makeFeatures([], {classes: []});
		emptyCharacter.features._renderFeaturesSummary();
		expect(summaryHtml()).toContain("Build your character to see features");
		const {features} = makeFeatures([]);
		features._renderFeaturesSummary();
		expect(summaryHtml()).toContain("No features yet");
		await features._pShowMoreFeaturesModal("Class");
		expect(toast).toHaveBeenCalledWith({type: "info", content: "No class features found."});
		expect(showModal).not.toHaveBeenCalled();
		await features._pShowMoreFeaturesModal("Background");
		expect(showModal).not.toHaveBeenCalled();
	});
});
