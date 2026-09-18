/**
 * Round 8 spell bugs:
 *   #4 — Ranger (and the other canonical known casters) classify as "known", not "prepared",
 *        in BOTH editions. The state classifier and QuickBuild detection share one resolver.
 *   #5 — The spell badge shows the SOURCE (feature/feat/class/subclass/item) with a fallback
 *        chain, and the Prepare button only renders for prepared-caster-owned spells.
 *   #7 — The Plantmender feat grants its two always-known cantrips, attributed to the feat.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// _renderSpellItem reads Parser.spSchoolAbvToFull for the school label.
globalThis.Parser = globalThis.Parser || {};
globalThis.Parser.spSchoolAbvToFull = globalThis.Parser.spSchoolAbvToFull || ((abv) => abv);

// Realistic 2024-style progressions (counts in preparedSpellsProgression for ALL casters).
const RANGER_PREPARED = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
const DRUID_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const BARD_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const DRUID_CANTRIP = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

const makeRangerTGTT = (over = {}) => ({
	name: "Ranger",
	source: "TGTT",
	level: 6,
	subclass: {name: "Hunter", source: "TGTT-2024"},
	preparedSpellsProgression: RANGER_PREPARED,
	casterProgression: "artificer",
	spellcastingAbility: "wis",
	...over,
});
const makeRangerXPHB = (over = {}) => ({
	name: "Ranger",
	source: "XPHB",
	level: 6,
	preparedSpellsProgression: RANGER_PREPARED,
	casterProgression: "artificer",
	spellcastingAbility: "wis",
	...over,
});
const makeRangerPHB = (over = {}) => ({
	name: "Ranger",
	source: "PHB",
	level: 6,
	spellsKnownProgression: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
	casterProgression: "1/2",
	spellcastingAbility: "wis",
	...over,
});
const makeDruidXPHB = (over = {}) => ({
	name: "Druid",
	source: "XPHB",
	level: 3,
	preparedSpellsProgression: DRUID_PREPARED,
	cantripProgression: DRUID_CANTRIP,
	casterProgression: "full",
	spellcastingAbility: "wis",
	...over,
});

describe("#4 getClassSpellcastingModel resolver", () => {
	const model = (opts) => CharacterSheetClassUtils.getClassSpellcastingModel(opts);

	test("canonical known casters classify as known in BOTH editions", () => {
		// 2024 (data carries preparedSpellsProgression but they are still known casters)
		expect(model({name: "Ranger", source: "TGTT", classData: makeRangerTGTT()})).toBe("known");
		expect(model({name: "Ranger", source: "XPHB", classData: makeRangerXPHB()})).toBe("known");
		expect(model({name: "Bard", source: "XPHB", classData: {name: "Bard", preparedSpellsProgression: BARD_PREPARED, casterProgression: "full"}})).toBe("known");
		expect(model({name: "Sorcerer", source: "XPHB", classData: {name: "Sorcerer", preparedSpellsProgression: BARD_PREPARED}})).toBe("known");
		expect(model({name: "Warlock", source: "XPHB", classData: {name: "Warlock", preparedSpellsProgression: BARD_PREPARED, casterProgression: "pact"}})).toBe("known");
		// 2014 (explicit spellsKnownProgression)
		expect(model({name: "Ranger", source: "PHB", classData: makeRangerPHB()})).toBe("known");
		expect(model({name: "Bard", source: "PHB", classData: {name: "Bard", spellsKnownProgression: BARD_PREPARED}})).toBe("known");
	});

	test("genuine prepared casters classify as prepared in BOTH editions", () => {
		expect(model({name: "Druid", source: "XPHB", classData: makeDruidXPHB()})).toBe("prepared");
		expect(model({name: "Cleric", source: "XPHB", classData: {name: "Cleric", preparedSpellsProgression: DRUID_PREPARED}})).toBe("prepared");
		expect(model({name: "Paladin", source: "XPHB", classData: {name: "Paladin", preparedSpellsProgression: RANGER_PREPARED}})).toBe("prepared");
		expect(model({name: "Wizard", source: "XPHB", classData: {name: "Wizard", preparedSpellsProgression: DRUID_PREPARED, spellsKnownProgressionFixed: [6]}})).toBe("prepared");
		// 2014 formula-based prepared casters
		expect(model({name: "Cleric", source: "PHB", classData: {name: "Cleric", preparedSpells: "<$level$> + <$wis_mod$>", casterProgression: "full"}})).toBe("prepared");
	});

	test("non-casters classify as none", () => {
		expect(model({name: "Fighter", source: "XPHB", classData: {name: "Fighter"}})).toBe("none");
		expect(model({name: "Barbarian", source: "PHB", classData: {name: "Barbarian"}})).toBe("none");
	});

	test("shared known-caster name constant is reused (no drift)", () => {
		expect(CharacterSheetClassUtils.KNOWN_CASTER_NAMES).toEqual(
			expect.arrayContaining(["Bard", "Ranger", "Sorcerer", "Warlock"]),
		);
	});
});

describe("#4 getKnownSpellsAtLevel is model-aware", () => {
	test("2024 known caster reads its count from preparedSpellsProgression", () => {
		// TGTT Ranger L6 → 6 (NOT the 2014 Ranger-known table value of 4)
		expect(CharacterSheetClassUtils.getKnownSpellsAtLevel(makeRangerTGTT(), "Ranger", 6)).toBe(RANGER_PREPARED[5]);
		expect(CharacterSheetClassUtils.getKnownSpellsAtLevel(makeRangerXPHB(), "Ranger", 6)).toBe(6);
	});

	test("2014 known caster reads its count from spellsKnownProgression", () => {
		expect(CharacterSheetClassUtils.getKnownSpellsAtLevel(makeRangerPHB(), "Ranger", 6)).toBe(4);
	});

	test("prepared casters return null (not a known-spell count source)", () => {
		expect(CharacterSheetClassUtils.getKnownSpellsAtLevel(makeDruidXPHB(), "Druid", 3)).toBeNull();
		expect(CharacterSheetClassUtils.getKnownSpellsAtLevel({name: "Cleric", preparedSpellsProgression: DRUID_PREPARED}, "Cleric", 3)).toBeNull();
	});
});

describe("#4 state classification (_getClassSpellcastingInfo / getSpellcastingInfo)", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("single-class TGTT Ranger is known with max from preparedSpellsProgression", () => {
		state.addClass(makeRangerTGTT());
		const info = state.getSpellcastingInfo();
		expect(info.type).toBe("known");
		expect(info.max).toBe(RANGER_PREPARED[5]); // 6
		expect(info.spellsKnownMax).toBe(RANGER_PREPARED[5]);
	});

	test("single-class XPHB Ranger is also known (2024 terminology only)", () => {
		state.addClass(makeRangerXPHB());
		expect(state.getSpellcastingInfo().type).toBe("known");
	});

	test("single-class XPHB Druid stays prepared", () => {
		state.addClass(makeDruidXPHB());
		const info = state.getSpellcastingInfo();
		expect(info.type).toBe("prepared");
		expect(info.max).toBe(DRUID_PREPARED[2]); // L3 → 6
	});

	test("Ranger(known) + Druid(prepared) multiclass aggregates to mixed", () => {
		state.addClass(makeRangerTGTT());
		state.addClass(makeDruidXPHB());
		expect(state.getSpellcastingInfo().type).toBe("mixed");
	});

	test("breakdown keeps Ranger spellsMax=6 / spellsCount=2 (Lunaria-like)", () => {
		state.addClass(makeRangerTGTT());
		state.addClass(makeDruidXPHB());
		state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Ranger"});
		state.addSpell({name: "Pass without Trace", source: "PHB", level: 2, sourceFeature: "Spells Known", sourceClass: "Ranger"});
		const cards = state.getSpellcastingClassBreakdown();
		const ranger = cards.find(c => c.className === "Ranger");
		expect(ranger.mechanic).toBe("known");
		expect(ranger.spellsMax).toBe(RANGER_PREPARED[5]);
		expect(ranger.spellsCount).toBe(2);
	});
});

describe("duplicate spell ownership attribution", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({
			name: "Cleric",
			source: "PHB",
			level: 3,
			casterProgression: "full",
			spellcastingAbility: "wis",
			preparedSpells: "<$level$> + <$wis_mod$>",
		});
		state.addClass({
			name: "Sorcerer",
			source: "PHB",
			level: 3,
			casterProgression: "full",
			spellcastingAbility: "cha",
			spellsKnownProgression: [2, 3, 4],
			subclass: {name: "Divine Soul", shortName: "Divine Soul", source: "XGE"},
		});
	});

	test("preserves Cleric ownership and casting ability when Charisma-granted duplicates arrive", () => {
		state.addSpell({
			name: "Bless",
			source: "PHB",
			level: 1,
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
		}, true);
		state.addSpell({
			name: "Bless",
			source: "PHB",
			level: 1,
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
			spellcastingAbility: "cha",
			alwaysPrepared: true,
		}, true);
		state.addCantrip({
			name: "Guidance",
			source: "PHB",
			level: 0,
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
		});
		state.addCantrip({
			name: "Guidance",
			source: "PHB",
			level: 0,
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
			spellcastingAbility: "cha",
		});

		const [bless] = state.getSpellsKnown().filter(spell => spell.name === "Bless" && spell.source === "PHB");
		expect(bless).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
			sourceSubclass: null,
			spellcastingAbility: null,
			alwaysPrepared: true,
			prepared: true,
		});
		expect(state.getSpellcastingCardForSpell(bless)?.className).toBe("Cleric");
		expect(state.getSpellcastingAbilityForSpell(bless)).toBe("wis");

		const [guidance] = state.getCantripsKnown().filter(spell => spell.name === "Guidance" && spell.source === "PHB");
		expect(guidance).toMatchObject({
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
			sourceSubclass: null,
			spellcastingAbility: null,
		});
		expect(state.getSpellcastingCardForSpell(guidance)?.className).toBe("Cleric");
		expect(state.getSpellcastingAbilityForSpell(guidance)).toBe("wis");
	});

	test("adopts the complete incoming tuple only when the existing spell is unattributed", () => {
		state.addSpell({name: "Bless", source: "PHB", level: 1});
		state.addSpell({
			name: "Bless",
			source: "PHB",
			level: 1,
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
			spellcastingAbility: "cha",
		});

		const [bless] = state.getSpellsKnown().filter(spell => spell.name === "Bless" && spell.source === "PHB");
		expect(bless).toMatchObject({
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
			spellcastingAbility: "cha",
		});
		expect(state.getSpellcastingCardForSpell(bless)?.className).toBe("Sorcerer");
		expect(state.getSpellcastingAbilityForSpell(bless)).toBe("cha");
	});

	test("keeps first-stored ownership when load-time coalescing selects a richer duplicate", () => {
		const [bless] = state._coalesceSpellDuplicates([
			{
				name: "Bless",
				source: "PHB",
				level: 1,
				sourceFeature: "Prepared Spells",
				sourceClass: "Cleric",
				sourceSubclass: null,
			},
			{
				name: "bless",
				source: "phb",
				level: 1,
				school: "E",
				castingTime: "1 action",
				sourceFeature: "Divine Soul Spells",
				sourceClass: "Sorcerer",
				sourceSubclass: "Divine Soul",
				spellcastingAbility: "cha",
			},
		]);

		expect(bless).toMatchObject({
			school: "E",
			castingTime: "1 action",
			sourceFeature: "Prepared Spells",
			sourceClass: "Cleric",
			sourceSubclass: null,
			spellcastingAbility: null,
		});
		expect(state.getSpellcastingCardForSpell(bless)?.className).toBe("Cleric");
		expect(state.getSpellcastingAbilityForSpell(bless)).toBe("wis");
	});

	test("load-time coalescing adopts the incoming tuple for a truly unattributed spell", () => {
		const [bless] = state._coalesceSpellDuplicates([
			{name: "Bless", source: "PHB", level: 1},
			{
				name: "bless",
				source: "phb",
				level: 1,
				school: "E",
				sourceFeature: "Divine Soul Spells",
				sourceClass: "Sorcerer",
				sourceSubclass: "Divine Soul",
				spellcastingAbility: "cha",
			},
		]);

		expect(bless).toMatchObject({
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
			sourceSubclass: "Divine Soul",
			spellcastingAbility: "cha",
		});
		expect(state.getSpellcastingCardForSpell(bless)?.className).toBe("Sorcerer");
		expect(state.getSpellcastingAbilityForSpell(bless)).toBe("cha");
	});
});

describe("#5 source badge + Prepare-button gating", () => {
	let state;
	let spells;
	const makeSpells = (st) => {
		const s = Object.create(CharacterSheetSpells.prototype);
		s._page = {getState: () => st};
		s._state = st;
		s._allSpells = [];
		return s;
	};
	beforeEach(() => {
		state = new CharacterSheetState();
		spells = makeSpells(state);
	});

	describe("_getSpellSourceLabel fallback chain", () => {
		test("prefers sourceFeature, then fromFeat, then sourceClass, then item, else Manual", () => {
			expect(spells._getSpellSourceLabel({sourceFeature: "Circle of the Zodiac Spells", sourceClass: "Druid"})).toBe("Circle of the Zodiac Spells");
			expect(spells._getSpellSourceLabel({fromFeat: "Magic Initiate", sourceClass: "Wizard"})).toBe("Magic Initiate");
			expect(spells._getSpellSourceLabel({sourceClass: "Druid"})).toBe("Druid");
			expect(spells._getSpellSourceLabel({sourceSubclass: "Gambler"})).toBe("Gambler");
			expect(spells._getSpellSourceLabel({sourceItem: "Staff of the Woodlands"})).toBe("Staff of the Woodlands");
			expect(spells._getSpellSourceLabel({})).toBe("Manual");
		});
	});

	describe("_shouldShowPrepareToggle by owner spellcasting model", () => {
		test("known-caster-owned spell never shows toggle, even with legacy prepared:true", () => {
			state.addClass(makeRangerTGTT());
			expect(spells._shouldShowPrepareToggle({name: "Cure Wounds", level: 1, sourceClass: "Ranger", prepared: true, sourceFeature: "Prepared Spells"})).toBe(false);
			expect(spells._shouldShowPrepareToggle({name: "Hail of Thorns", level: 1, sourceClass: "Ranger"})).toBe(false);
		});

		test("prepared-caster-owned spell shows the toggle", () => {
			state.addClass(makeDruidXPHB());
			expect(spells._shouldShowPrepareToggle({name: "Entangle", level: 1, sourceClass: "Druid"})).toBe(true);
		});

		test("Gambler-attributed spells (rolled-prepared subclass) show the toggle", () => {
			state.addClass({name: "Rogue", source: "TGTT", level: 3, subclass: {name: "Gambler", shortName: "Gambler", source: "TGTT"}});
			expect(spells._shouldShowPrepareToggle({name: "Hex", level: 1, sourceClass: "Gambler"})).toBe(true);
			expect(spells._shouldShowPrepareToggle({name: "Hex", level: 1, sourceClass: "Warlock", prepared: true})).toBe(false);
		});

		test("cantrips and always-prepared spells never show the toggle", () => {
			state.addClass(makeDruidXPHB());
			expect(spells._shouldShowPrepareToggle({name: "Druidcraft", level: 0, sourceClass: "Druid"})).toBe(false);
			expect(spells._shouldShowPrepareToggle({name: "Goodberry", level: 1, sourceClass: "Druid", alwaysPrepared: true})).toBe(false);
		});

		test("feat/item-granted leveled spell (unknown owner, no legacy flags) hides the toggle", () => {
			state.addClass(makeRangerTGTT());
			expect(spells._shouldShowPrepareToggle({name: "Barkskin", level: 2, sourceFeature: "Plantmender"})).toBe(false);
		});

		test("orphan legacy prepared spell (unknown owner) hides the toggle", () => {
			state.addClass(makeDruidXPHB());
			expect(spells._shouldShowPrepareToggle({name: "Mystery", level: 1, prepared: true})).toBe(false);
		});
	});

	describe("_renderSpellItem HTML", () => {
		test("renders a source badge from the feature name", () => {
			state.addClass(makeDruidXPHB());
			const el = spells._renderSpellItem({name: "Faerie Fire", source: "PHB", level: 1, school: "V", sourceFeature: "Circle of the Zodiac Spells", sourceClass: "Druid"});
			expect(el.outerHTML).toContain("charsheet__spell-source-badge");
			expect(el.outerHTML).toContain("Source: Circle of the Zodiac Spells");
		});

		test("known-caster spell renders NO Prepare button", () => {
			state.addClass(makeRangerTGTT());
			const el = spells._renderSpellItem({name: "Cure Wounds", source: "PHB", level: 1, school: "V", sourceClass: "Ranger", prepared: true, sourceFeature: "Spells Known"});
			expect(el.outerHTML).not.toContain("charsheet__spell-prepared");
			expect(el.outerHTML).not.toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
			// Still shows a source badge
			expect(el.outerHTML).toContain("charsheet__spell-source-badge");
		});

		test("prepared-caster spell renders the Prepare button", () => {
			state.addClass(makeDruidXPHB());
			const el = spells._renderSpellItem({name: "Entangle", source: "PHB", level: 1, school: "C", sourceClass: "Druid", prepared: true});
			expect(el.outerHTML).toContain("charsheet__spell-prepared");
			expect(el.outerHTML).toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
		});

		test("always-prepared known-caster grants keep their badge/lock without green prepared styling", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			const el = spells._renderSpellItem({
				name: "Bless",
				source: "PHB",
				level: 1,
				school: "E",
				sourceClass: "Sorcerer",
				sourceFeature: "Divine Soul Spells",
				prepared: true,
				alwaysPrepared: true,
			});
			const rowClasses = el.outerHTML.match(/<div class="([^"]*charsheet__spell-item[^"]*)"/)?.[1].split(/\s+/) || [];
			expect(el.outerHTML).toContain("charsheet__spell-always-prepared");
			expect(rowClasses).toContain("always-prepared");
			expect(rowClasses).not.toContain("prepared");
			expect(el.outerHTML).toContain("Locked");
		});

		test("multiclass prepared styling follows each spell's class attribution", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			const wizard = spells._renderSpellItem({name: "Shield", source: "PHB", level: 1, school: "A", sourceClass: "Wizard", prepared: true});
			const sorcerer = spells._renderSpellItem({name: "Magic Missile", source: "PHB", level: 1, school: "V", sourceClass: "Sorcerer", prepared: true});
			expect(wizard.outerHTML).toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
			expect(sorcerer.outerHTML).not.toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
		});

		test("Gambler styling requires Gambler attribution, not a raw Warlock-list owner", () => {
			state.addClass({name: "Rogue", source: "TGTT", level: 5, subclass: {name: "Gambler", shortName: "Gambler", source: "TGTT"}});
			const gambler = spells._renderSpellItem({name: "Hex", source: "PHB", level: 1, school: "E", sourceClass: "Gambler", prepared: true});
			const rawWarlock = spells._renderSpellItem({name: "Armor of Agathys", source: "PHB", level: 1, school: "A", sourceClass: "Warlock", prepared: true});
			expect(gambler.outerHTML).toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
			expect(rawWarlock.outerHTML).not.toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
			expect(rawWarlock.outerHTML).not.toContain("charsheet__spell-prepared");
		});

		test("unattributed prepared flags do not create a green row", () => {
			state.addClass(makeDruidXPHB());
			const el = spells._renderSpellItem({name: "Mystery", source: "PHB", level: 1, school: "I", prepared: true});
			expect(el.outerHTML).not.toMatch(/charsheet__spell-item[^"]*\bprepared\b/);
		});
	});
});

describe("#7 Plantmender feat grants its two cantrips (attributed to the feat)", () => {
	const PLANTMENDER = {
		name: "Plantmender",
		source: "HumblewoodTales",
		page: 172,
		prerequisite: [{ability: [{wis: 13}]}],
		additionalSpells: [{
			ability: "wis",
			known: {_: ["shillelagh#c", "mend plants|HumblewoodTales#c"]},
			innate: {_: {daily: {1: ["barkskin", "spike growth"]}}},
		}],
	};

	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "XPHB", level: 3, preparedSpellsProgression: DRUID_PREPARED, cantripProgression: DRUID_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
		state.setAbilityBase("wis", 16);
	});

	test("both always-known cantrips appear, attributed to Plantmender", () => {
		state.addFeat(PLANTMENDER);
		const cantrips = state.getCantripsKnown();
		const names = cantrips.map(c => c.name.toLowerCase());
		expect(names).toContain("shillelagh");
		expect(names).toContain("mend plants");

		const shillelagh = cantrips.find(c => c.name.toLowerCase() === "shillelagh");
		const mendPlants = cantrips.find(c => c.name.toLowerCase() === "mend plants");
		expect(shillelagh.sourceFeature).toBe("Plantmender");
		expect(mendPlants.sourceFeature).toBe("Plantmender");

		// getSpells() is the render source — it normalizes cantrips to level 0.
		const rendered = state.getSpells();
		const renderedShillelagh = rendered.find(s => s.name.toLowerCase() === "shillelagh");
		expect(renderedShillelagh.level).toBe(0);
	});

	test("granted cantrips never show a Prepare toggle (#5 interaction)", () => {
		state.addFeat(PLANTMENDER);
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._page = {getState: () => state};
		spells._state = state;
		const renderedShillelagh = state.getSpells().find(s => s.name.toLowerCase() === "shillelagh");
		expect(spells._shouldShowPrepareToggle(renderedShillelagh)).toBe(false);
		expect(spells._getSpellSourceLabel(renderedShillelagh)).toBe("Plantmender");
	});

	test("the 1/day innate spells are not added as cantrips", () => {
		state.addFeat(PLANTMENDER);
		const cantripNames = state.getCantripsKnown().map(c => c.name.toLowerCase());
		expect(cantripNames).not.toContain("barkskin");
		expect(cantripNames).not.toContain("spike growth");
	});

	test("re-adding the feat does not duplicate the cantrips", () => {
		state.addFeat(PLANTMENDER);
		state.addFeat(PLANTMENDER); // duplicate add is rejected
		const shillelaghCount = state.getCantripsKnown().filter(c => c.name.toLowerCase() === "shillelagh").length;
		expect(shillelaghCount).toBe(1);
	});
});
