import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import {jest} from "@jest/globals";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

const DAEMONOLOGIST = {
	name: "Daemonologist",
	shortName: "Daemonologist",
	source: "GrimHollowPG24",
	className: "Wizard",
	classSource: "XPHB",
};

const ELDRITCH_ADEPT = {
	name: "Eldritch Adept",
	source: "TCE",
	optionalfeatureProgression: [{
		name: "Eldritch Invocation",
		featureType: ["EI"],
		progression: {"1": 1},
	}],
};

describe("QuickBuild feat optional-feature choices", () => {
	beforeEach(() => {
		globalThis.CharacterSheetPage = {getHoverLink: () => ""};
		globalThis.UrlUtil.PG_FEATS = "feats.html";
		globalThis.MiscUtil.debounce = fn => fn;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("renders the ASI feat list without referencing an out-of-scope progression gain", () => {
		const stateClass = {
			name: "Wizard",
			source: "XPHB",
			level: 4,
			subclass: DAEMONOLOGIST,
		};
		const state = {
			getClasses: () => [stateClass],
			getFeatures: () => [],
			getFeats: () => [],
			getTotalLevel: () => 4,
			getSettings: () => ({}),
			getCantripsKnown: () => [],
			getSpellsKnown: () => [],
			getToolProficiencies: () => [],
		};
		const page = {
			filterByAllowedSources: values => values,
			getClasses: () => [{...stateClass, subclasses: [DAEMONOLOGIST]}],
			getFeats: () => [ELDRITCH_ADEPT],
			getOptionalFeatures: () => [],
		};
		const quickBuild = Object.create(CharacterSheetQuickBuild.prototype);
		quickBuild._state = state;
		quickBuild._page = page;
		quickBuild._targetLevel = 4;
		quickBuild._classAllocations = [{
			className: "Wizard",
			classSource: "XPHB",
			targetLevel: 4,
			subclass: DAEMONOLOGIST,
		}];
		quickBuild._selections = {subclasses: {}};

		const aliasSpy = jest.spyOn(CharacterSheetClassUtils, "getOptionalFeaturePrerequisiteClassAliases");
		const selection = {feat: null};

		expect(() => quickBuild._renderFeatSelector(
			"Wizard_4",
			selection,
			false,
			null,
			null,
			null,
			{className: "Wizard", classSource: "XPHB", totalLevel: 4},
		)).not.toThrow();
		expect(aliasSpy).toHaveBeenCalledWith(expect.objectContaining({name: "Daemonologist"}), ["EI"]);
		expect(selection.featChoices.optionalFeatures).toEqual([]);
	});
});
