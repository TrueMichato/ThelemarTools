import fs from "node:fs";
import path from "node:path";
import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-spell-picker.js";
import "../../../js/charactersheet/charactersheet-artificer-plans.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;
const SpellPicker = globalThis.CharacterSheetSpellPicker;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const bardData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-bard.json"), "utf8")).class;
const tgttBard = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "homebrew/TravelersGuidetoThelemar.json"), "utf8"))
	.class.find(cls => cls.name === "Bard" && cls.source === "TGTT");

const spell = (name, source, level, className) => ({
	name,
	source,
	level,
	school: "A",
	classes: {fromClassList: [{name: className, source: "XPHB"}]},
});
const SPELLS = [
	spell("Spirit Guardians", "XPHB", 3, "Cleric"),
	spell("Conjure Animals", "TGTT", 3, "Druid"),
	spell("Shield", "XPHB", 1, "Wizard"),
	spell("Heal", "XPHB", 6, "Cleric"),
	spell("Fire Bolt", "XPHB", 0, "Wizard"),
	spell("Bardic Song", "XPHB", 1, "Bard"),
	spell("Higher Song", "XPHB", 5, "Bard"),
	spell("Vicious Mockery", "XPHB", 0, "Bard"),
];

function makeQuickBuild ({classData = tgttBard, startLevel = 8, targetLevel = 10, subclass = null, spells = SPELLS} = {}) {
	const qb = Object.create(QuickBuild.prototype);
	qb._state = {
		getClasses: () => [{name: classData.name, source: classData.source, level: startLevel, subclass}],
		getSpells: () => [],
		getCantripsKnown: () => [],
	};
	qb._page = {
		getClasses: () => [classData],
		getFilteredSpellData: () => spells,
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		buildSpellHoverLinkFn: () => () => "",
	};
	qb._classAllocations = [{
		className: classData.name,
		classSource: classData.source,
		classData,
		currentLevel: startLevel,
		targetLevel,
	}];
	qb._fromLevel = startLevel;
	qb._targetLevel = targetLevel;
	qb._getLevelFeatures = () => [];
	qb._getOptionalFeatureGains = () => [];
	qb._getFeatureOptionsForLevel = () => [];
	qb._getExpertiseGrantsForLevel = () => [];
	qb._getLanguageGrantsForLevel = () => [];
	qb._getWeaponMasteryGains = () => ({newSlots: 0});
	qb._renderLevelBreakdownPanel = () => e_({tag: "div"});
	qb._resetSelections();
	qb._buildWizardSteps();
	return {qb, info: qb._steps.find(step => step.id === "spells")?.data.knownCasterInfo};
}

function pickerOptions (args) {
	return args.allSpells
		.filter(candidate => candidate.level <= args.maxSpellLevel
			&& (candidate.level ? args.spellCount : args.cantripCount)
			&& ClassUtils.spellIsAvailableForClass(candidate, {
				className: args.className,
				subclass: args.subclass,
				subclassChoice: args.subclassChoice,
				additionalClassNames: candidate.level ? args.additionalLeveledClassNames : args.additionalClassNames,
			}))
		.map(({name, source}) => `${name}|${source}`);
}

describe("Quick Build known-spell acquisition levels", () => {
	let renderPicker;
	beforeEach(() => {
		renderPicker = jest.spyOn(SpellPicker, "renderKnownSpellPicker").mockImplementation(() => e_({tag: "div"}));
	});
	afterEach(() => renderPicker.mockRestore());

	test.each(["TGTT", "XPHB"])("%s Bard L8→10 offers Magical Secrets only in its level-10 slot", source => {
		const classData = source === "TGTT" ? tgttBard : bardData.find(cls => cls.name === "Bard" && cls.source === source);
		const {qb, info} = makeQuickBuild({classData});
		expect(info).toBeTruthy();
		expect(qb._levelAnalysis.map(a => [a.classLevel, a.knownSpellsGainAtLevel, a.knownCantripsGainAtLevel]))
			.toEqual([[9, 2, 0], [10, 1, 1]]);

		const step = e_({tag: "div"});
		qb._renderKnownSpellPicker(step, info);
		const atNine = renderPicker.mock.lastCall[0];
		expect(atNine.spellCount).toBe(2);
		expect(atNine.maxSpellLevel).toBe(5);
		expect(pickerOptions(atNine)).not.toContain("Spirit Guardians|XPHB");

		atNine.onSelect([SPELLS[5]], []);
		const selector = step._children.find(child => child._clazz.includes("charsheet__qb-known-level-select"));
		selector.value = "10";
		selector._handlers.change();
		const atTen = renderPicker.mock.lastCall[0];
		expect(atTen.spellCount).toBe(1);
		expect(atTen.cantripCount).toBe(1);
		expect(pickerOptions(atTen)).toContain("Spirit Guardians|XPHB");
		expect(pickerOptions(atTen)).toContain("Conjure Animals|TGTT");
		expect(pickerOptions(atTen)).toContain("Shield|XPHB");
		expect(pickerOptions(atTen)).not.toContain("Heal|XPHB");
		expect(pickerOptions(atTen)).not.toContain("Fire Bolt|XPHB");

		atTen.onSelect([SPELLS[0]], [SPELLS[7]]);
		expect(qb._selections.knownSpells.map(s => `${s.name}|${s.source}`))
			.toEqual(["Bardic Song|XPHB", "Spirit Guardians|XPHB"]);
		const [nine, ten] = qb._levelAnalysis.map(level => qb._buildHistoryEntry(level, `${level.className}_${level.classLevel}`));
		expect(nine.choices.knownSpells).toEqual([{name: "Bardic Song", source: "XPHB", level: 1}]);
		expect(nine.choices.knownCantrips).toBeUndefined();
		expect(ten.choices.knownSpells).toEqual([{name: "Spirit Guardians", source: "XPHB", level: 3}]);
		expect(ten.choices.knownCantrips).toEqual([{name: "Vicious Mockery", source: "XPHB", level: 0}]);
		expect(qb._getKnownSpellSelectionIssue(qb._levelAnalysis, SPELLS)).toBeNull();
	});

	test("skipping a level-9 pick does not move the level-10 secret back into level 9", () => {
		const {qb, info} = makeQuickBuild();
		qb._activeKnownSpellCharacterLevel = 10;
		qb._renderKnownSpellPicker(e_({tag: "div"}), info);
		renderPicker.mock.lastCall[0].onSelect([SPELLS[0]], []);
		const [nine, ten] = qb._levelAnalysis.map(level => qb._buildHistoryEntry(level, `${level.className}_${level.classLevel}`));
		expect(nine.choices.knownSpells).toBeUndefined();
		expect(ten.choices.knownSpells).toEqual([{name: "Spirit Guardians", source: "XPHB", level: 3}]);
	});

	test("reanalysis removes only now-ineligible level picks and warns before continuing", () => {
		const {qb, info} = makeQuickBuild();
		qb._activeKnownSpellCharacterLevel = 10;
		qb._renderKnownSpellPicker(e_({tag: "div"}), info);
		renderPicker.mock.lastCall[0].onSelect([SPELLS[0]], []);
		qb._selections.knownSpellsByLevel[9] = {
			className: "Bard",
			classSource: "TGTT",
			classLevel: 9,
			spells: [SPELLS[5]],
			cantrips: [],
		};
		qb._classAllocations[0].targetLevel = 9;
		qb._targetLevel = 9;
		const toast = jest.spyOn(JqueryUtil, "doToast");
		try {
			qb._buildWizardSteps();
			expect(qb._selections.knownSpellsByLevel[10]).toBeUndefined();
			expect(qb._selections.knownSpellsByLevel[9].spells).toEqual([SPELLS[5]]);
			expect(qb._selections.knownSpells).toEqual([SPELLS[5]]);
			expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "warning"}));
		} finally {
			toast.mockRestore();
		}
	});

	test("a level-2 Bard cannot assign a 5th-level spell; other levels cannot repeat an exact spell", () => {
		const {qb, info} = makeQuickBuild({startLevel: 1});
		qb._renderKnownSpellPicker(e_({tag: "div"}), info);
		const atTwo = renderPicker.mock.lastCall[0];
		expect(atTwo.maxSpellLevel).toBe(1);
		expect(pickerOptions(atTwo)).not.toContain("Higher Song|XPHB");
		atTwo.onSelect([SPELLS[5]], []);
		qb._activeKnownSpellCharacterLevel = 3;
		qb._renderKnownSpellPicker(e_({tag: "div"}), info);
		expect(renderPicker.mock.lastCall[0].knownSpellIds).toContain("Bardic Song|XPHB");
		renderPicker.mock.lastCall[0].onSelect([SPELLS[5]], []);
		expect(qb._getKnownSpellSelectionIssue(qb._levelAnalysis, SPELLS)).toMatch(/not available/);
		qb._selections.knownSpellsByLevel[3].spells = [SPELLS[3]];
		expect(qb._getKnownSpellSelectionIssue(qb._levelAnalysis, SPELLS)).toMatch(/not available/);
	});

	test("Divine Soul keeps its own Cleric list for spells and cantrips", () => {
		const classData = {
			name: "Sorcerer",
			source: "XPHB",
			spellcastingAbility: "cha",
			casterProgression: "full",
			preparedSpellsProgression: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
			cantripProgression: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3],
		};
		const {qb, info} = makeQuickBuild({
			classData,
			startLevel: 9,
			subclass: {name: "Divine Soul", shortName: "Divine Soul", source: "XGE"},
		});
		qb._renderKnownSpellPicker(e_({tag: "div"}), info);
		const args = renderPicker.mock.lastCall[0];
		expect(args.additionalClassNames).toContain("Cleric");
		expect(args.additionalLeveledClassNames).toContain("Cleric");
		expect(pickerOptions(args)).toContain("Spirit Guardians|XPHB");
		expect(pickerOptions(args)).not.toContain("Fire Bolt|XPHB");
	});

	test("PHB Bard and non-Bard known casters never gain the 2024 Bard lists", () => {
		for (const classData of [
			bardData.find(cls => cls.name === "Bard" && cls.source === "PHB"),
			{name: "Sorcerer", source: "XPHB", spellcastingAbility: "cha", casterProgression: "full", preparedSpellsProgression: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], cantripProgression: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3]},
		]) {
			const {qb, info} = makeQuickBuild({classData, startLevel: 9});
			qb._renderKnownSpellPicker(e_({tag: "div"}), info);
			expect(pickerOptions(renderPicker.mock.lastCall[0])).not.toContain("Spirit Guardians|XPHB");
		}
	});
});
