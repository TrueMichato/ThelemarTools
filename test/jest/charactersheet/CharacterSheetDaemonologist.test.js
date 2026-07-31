import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

const SUBCLASS = {
	name: "Daemonologist",
	shortName: "Daemonologist",
	source: "GrimHollowPG24",
	className: "Wizard",
	classSource: "XPHB",
	additionalSpells: [
		{name: "Arch Daemon", prepared: {"3": ["Bane|XPHB", "Toll the Dead|XPHB"], "5": ["Fear|XPHB"], "7": ["Dark Sacrament|GrimHollowPG24"], "9": ["Geas|XPHB"]}},
		{name: "Arch Seraph", prepared: {"3": ["Aid|XPHB", "Bless|XPHB", "Word of Radiance|XPHB"], "5": ["Revivify|XPHB"], "7": ["Guardian of Faith|XPHB"], "9": ["Greater Restoration|XPHB"]}},
	],
	subSubclassSpells: {
		"Arch Daemon": ["Bane|XPHB", "Toll the Dead|XPHB", "Fear|XPHB", "Dark Sacrament|GrimHollowPG24", "Geas|XPHB"],
		"Arch Seraph": ["Aid|XPHB", "Bless|XPHB", "Word of Radiance|XPHB", "Revivify|XPHB", "Guardian of Faith|XPHB", "Greater Restoration|XPHB"],
	},
	optionalfeatureProgression: [{name: "Eldritch Invocation", featureType: ["EI"], progression: {"3": 1, "6": 2, "14": 3}}],
};

const SPELLS = [
	["Bane", "XPHB", 1],
	["Toll the Dead", "XPHB", 0],
	["Fear", "XPHB", 3],
	["Dark Sacrament", "GrimHollowPG24", 4],
	["Geas", "XPHB", 5],
	["Aid", "XPHB", 2],
	["Bless", "XPHB", 1],
	["Word of Radiance", "XPHB", 0],
	["Revivify", "XPHB", 3],
	["Guardian of Faith", "XPHB", 4],
	["Greater Restoration", "XPHB", 5],
].map(([name, source, level]) => ({name, source, level, school: "A"}));

function addSubclassFeature (state, name, level, description) {
	state.addFeature({
		name,
		source: "GrimHollowPG24",
		className: "Wizard",
		classSource: "XPHB",
		subclassName: "Daemonologist",
		subclassShortName: "Daemonologist",
		subclassSource: "GrimHollowPG24",
		level,
		description,
	});
}

function makeState (level = 14, side = "Arch Daemon") {
	const state = new CharacterSheetState();
	state.setSpellData(SPELLS);
	state.setAbilityBase("int", 18);
	state.addClass({name: "Wizard", source: "XPHB", level, subclass: structuredClone(SUBCLASS)});
	state.setSubclassChoice("Wizard", side);
	if (level >= 6) addSubclassFeature(state, "Borrowed Tongues and Hides", 6, "As a Bonus Action, switch sides. Once you switch, you can't do so again until you finish a Long Rest.");
	if (level >= 10) addSubclassFeature(state, "Unearthly Countenance", 10, "As a Bonus Action, adopt a countenance for 10 minutes. Once used, regain it after a Long Rest.");
	if (level >= 14) addSubclassFeature(state, "Eternal War Eruption", 14, "As a Magic action, erupt once, regaining the use after a Long Rest.");
	state.applyClassFeatureEffects();
	return state;
}

describe("Wizard Daemonologist", () => {
	it.each([
		["Arch Daemon", ["Bane", "Toll the Dead"], "necrotic", "fiend"],
		["Arch Seraph", ["Aid", "Bless", "Word of Radiance"], "radiant", "celestial"],
	])("gates spells and Borrowed Tongues and Hides for %s", (side, expectedSpells, resistance, creatureType) => {
		const state = makeState(6, side);
		const grants = state.getSpells().filter(spell => spell.isSubclassChoiceSpell).map(spell => spell.name);
		expect(grants).toEqual(expect.arrayContaining(expectedSpells));
		const opposite = side === "Arch Daemon" ? ["Aid", "Bless"] : ["Bane", "Toll the Dead"];
		expect(grants).toEqual(expect.not.arrayContaining(opposite));

		const calculations = state.getFeatureCalculations();
		expect(calculations.daemonologistSide).toBe(side);
		expect(calculations.daemonologistResistance).toBe(resistance);
		expect(state.getResistances()).toContain(resistance);
		expect(state.canCommunicateWithCreatureType(creatureType)).toBe(true);
		expect(state.canCommunicateWithCreatureType(creatureType === "fiend" ? "celestial" : "fiend")).toBe(false);
	});

	it("switches sides once per long rest and reconciles spells and resistance", () => {
		const state = makeState(6);
		expect(state.switchDaemonologistSide()).toBe(true);
		expect(state.getDaemonologistSide().name).toBe("Arch Seraph");
		expect(state.getSpells().filter(spell => spell.isSubclassChoiceSpell).map(spell => spell.name)).toContain("Bless");
		expect(state.getResistances()).toContain("radiant");
		expect(state.getResistances()).not.toContain("necrotic");
		expect(state.switchDaemonologistSide()).toBe(false);
	});

	it("preserves a colliding player-owned spell when switching sides", () => {
		const state = makeState(6);
		state.addSpell({name: "Bless", source: "XPHB", level: 1, sourceFeature: "Magic Initiate", prepared: false});
		state.setDaemonologistSide("Arch Seraph");
		state.setDaemonologistSide("Arch Daemon");

		const bless = state.getSpells().find(spell => spell.name === "Bless");
		expect(bless).toMatchObject({sourceFeature: "Magic Initiate", prepared: false});
		expect(bless.isSubclassChoiceSpell).not.toBe(true);
	});

	it("removes side-gated spells when level-down removes the subclass", () => {
		const state = makeState(3);
		const historyEntry = {
			level: 3,
			class: {name: "Wizard", source: "XPHB"},
			choices: {subclass: structuredClone(SUBCLASS), subclassChoice: {key: "arch daemon", name: "Arch Daemon"}},
		};
		state._data.levelHistory = [historyEntry];

		expect(state._removeLevelEntry(historyEntry).success).toBe(true);
		expect(state.getClasses()[0].subclass).toBeNull();
		expect(state.getSpells().some(spell => spell.isSubclassChoiceSpell)).toBe(false);
		expect(state.getSpells().map(spell => spell.name)).not.toEqual(expect.arrayContaining(["Bane", "Toll the Dead"]));
	});

	it("threads Daemonologist prerequisite aliases through Quick Build", () => {
		const src = fs.readFileSync(path.resolve(process.cwd(), "js/charactersheet/charactersheet-quickbuild.js"), "utf8");
		expect(src).toMatch(/levelPrerequisiteClassAliases:\s*CharacterSheetClassUtils\.getOptionalFeaturePrerequisiteClassAliases\(activeSubclass,\s*gain\.featureTypes\)/);
	});

	it("uses Wizard level for EI level prerequisites and applies invocation mechanics character-wide", () => {
		const context = {
			classes: [{name: "Wizard", source: "XPHB", level: 6}],
			totalLevel: 6,
			cantrips: [{name: "Eldritch Blast", sourceClass: "Wizard", level: 0}],
			levelPrerequisiteClassAliases: CharacterSheetClassUtils.getOptionalFeaturePrerequisiteClassAliases(SUBCLASS, ["EI"]),
		};
		expect(CharacterSheetClassUtils.checkPrerequisites([{level: {level: 5, class: {name: "Warlock", source: "XPHB"}}}], context)).toEqual({met: true, reasons: []});
		expect(CharacterSheetClassUtils.checkPrerequisites([{spell: [{choose: "level=0|class=Warlock"}]}], context)).toEqual({met: true, reasons: []});

		const state = makeState(6);
		state.addFeature({
			name: "Devil's Sight",
			source: "XPHB",
			className: "Wizard",
			optionalFeatureTypes: ["EI"],
			featureType: "Optional Feature",
		});
		state.applyClassFeatureEffects();
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDevilsSight).toBe(true);
		expect(calculations.invocationCastingAbility).toBe("int");
		expect(state.getSenses().darkvision).toBeGreaterThanOrEqual(120);
	});

	it("casts invocation-granted spells with Intelligence", () => {
		const state = makeState(6);
		state.setSpellData([...SPELLS, {name: "Disguise Self", source: "XPHB", level: 1, school: "I"}]);
		state.addFeature({
			name: "Mask of Many Faces",
			source: "XPHB",
			className: "Wizard",
			optionalFeatureTypes: ["EI"],
			featureType: "Optional Feature",
			additionalSpells: [{innate: {"_": ["Disguise Self|XPHB"]}}],
		});
		const spell = state.getInnateSpells().find(it => it.name === "Disguise Self");
		expect(spell.spellcastingAbility).toBe("int");
		expect(state.getSpellcastingAbilityForSpell(spell)).toBe("int");
	});

	it("replays EI replacement history and restores the old invocation after level-down", () => {
		const state = makeState(6);
		state._data.levelHistory = [
			{
				level: 3,
				class: {name: "Wizard", source: "XPHB"},
				choices: {
					optionalFeatures: [{name: "Devil's Sight", source: "XPHB", type: "EI"}],
					replayData: {optionalFeatures: [{name: "Devil's Sight", source: "XPHB", type: "EI", optionalFeatureTypes: ["EI"]}]},
				},
			},
			{
				level: 6,
				class: {name: "Wizard", source: "XPHB"},
				choices: {
					optionalFeatures: [{name: "Eldritch Mind", source: "XPHB", type: "EI", _replaces: {name: "Devil's Sight", source: "XPHB"}}],
					replayData: {optionalFeatures: [{name: "Eldritch Mind", source: "XPHB", type: "EI", optionalFeatureTypes: ["EI"], _replaces: {name: "Devil's Sight", source: "XPHB"}}]},
				},
			},
		];
		state._reapplyHistoryOptionalFeatures();
		expect(state.getFeature("Devil's Sight", "XPHB")).toBeNull();
		expect(state.getFeature("Eldritch Mind", "XPHB")).not.toBeNull();
		expect(state._removeLevelEntry(state._data.levelHistory[1]).success).toBe(true);
		expect(state.getFeature("Eldritch Mind", "XPHB")).toBeNull();
		expect(state.getFeature("Devil's Sight", "XPHB")).not.toBeNull();
	});

	it("activates Unearthly Countenance and applies every effect", () => {
		const state = makeState(10);
		expect(state.activateUnearthlyCountenance()).toBe(true);
		expect(state.getAdvantageState("check:cha").advantage).toBe(true);
		expect(state.getSpeedBonusFromStates("fly")).toBe(60);
		expect(state.getDaemonologistEffectiveCastLevel({name: "Bane", source: "XPHB"}, 1)).toBe(2);
		expect(state.getDaemonologistEffectiveCastLevel({name: "Fireball", source: "XPHB"}, 3)).toBe(3);
	});

	it("restores Unearthly Countenance by consuming one level 5+ slot", () => {
		const state = makeState(10);
		expect(state.activateUnearthlyCountenance()).toBe(true);
		state.deactivateState("unearthlyCountenance");
		state.setSpellSlots(5, 1, 1);
		expect(state.restoreUnearthlyCountenanceUse(5)).toBe(true);
		expect(state.getSpellSlotsCurrent(5)).toBe(0);
		expect(state.getFeatureUses("Unearthly Countenance")).toBe(1);
		expect(state.restoreUnearthlyCountenanceUse(4)).toBe(false);
	});

	it("uses Eternal War Eruption with Wizard DC, slot restoration, and optional side switch", () => {
		const state = makeState(14);
		state.setSpellSlots(5, 2, 1);
		const calculations = state.getFeatureCalculations();
		expect(calculations.eternalWarEruptionDc).toBe(17);
		expect(calculations.eternalWarEruptionNecroticDamage).toBe("4d10");
		expect(calculations.eternalWarEruptionRadiantDamage).toBe("4d10");
		expect(state.useEternalWarEruption({restoreSlotLevel: 5, switchSides: true})).toBe(true);
		expect(state.getSpellSlotsCurrent(5)).toBe(2);
		expect(state.getDaemonologistSide().name).toBe("Arch Seraph");
		expect(state.getFeatureUses("Eternal War Eruption")).toBe(0);
		expect(state.useEternalWarEruption()).toBe(false);
	});
});
