/**
 * Per-class multiclass spellcasting tests.
 *
 * Covers the new state layer that powers the redesigned Spells tab:
 *  - getSpellcastingAbilityForClass / getSpellcastingAbilityForSpell
 *  - getSpellSaveDcForAbility / getSpellAttackBonusForAbility (and that the
 *    no-arg legacy getters still delegate to identical values)
 *  - getSpellcastingClassBreakdown (per-class ability/DC/attack, player-chosen
 *    vs feature-granted counts, displayName headings, spellbook cap, matchKeys)
 *  - getUnattributedSpellCounts (Other / orphan bucket)
 *
 * Also a regression guard that getSpellcastingInfo() keeps its legacy shape.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// --- progression tables (only the indices we touch matter) -----------------
const RANGER_PREPARED = [2, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 11, 12, 13, 13, 14, 14, 15, 15];
const DRUID_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const DRUID_CANTRIP = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const WIZARD_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const WIZARD_CANTRIP = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
const CLERIC_CANTRIP = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

const makeRanger = (over = {}) => ({
	name: "Ranger",
	source: "TGTT",
	level: 6,
	subclass: {name: "Hunter", source: "TGTT-2024"},
	preparedSpellsProgression: RANGER_PREPARED,
	casterProgression: "artificer",
	spellcastingAbility: "wis",
	...over,
});
const makeDruid = (over = {}) => ({
	name: "Druid",
	source: "XPHB",
	level: 3,
	subclass: {name: "Circle of the Zodiac", source: "TGTT"},
	preparedSpellsProgression: DRUID_PREPARED,
	cantripProgression: DRUID_CANTRIP,
	casterProgression: "full",
	spellcastingAbility: "wis",
	...over,
});

const card = (cards, displayName) => cards.find(c => c.displayName === displayName);

describe("getSpellcastingAbilityForClass", () => {
	const state = new CharacterSheetState();
	test("reads spellcastingAbility off the class entry", () => {
		expect(state.getSpellcastingAbilityForClass({name: "Druid", spellcastingAbility: "wis"})).toBe("wis");
	});
	test("falls back to the static name map", () => {
		expect(state.getSpellcastingAbilityForClass({name: "Wizard"})).toBe("int");
		expect(state.getSpellcastingAbilityForClass({name: "Bard"})).toBe("cha");
	});
	test("subclass casters override the base ability", () => {
		expect(state.getSpellcastingAbilityForClass({name: "Fighter", subclass: {name: "Eldritch Knight"}})).toBe("int");
		expect(state.getSpellcastingAbilityForClass({name: "Rogue", subclass: {name: "Arcane Trickster"}})).toBe("int");
		expect(state.getSpellcastingAbilityForClass({name: "Rogue", subclass: {name: "Gambler"}})).toBe("cha");
		expect(state.getSpellcastingAbilityForClass({name: "Illrigger", subclass: {name: "Architect of Ruin"}})).toBe("cha");
	});
	test("returns null for a non-caster", () => {
		expect(state.getSpellcastingAbilityForClass({name: "Barbarian"})).toBeNull();
	});
});

describe("getSpellcastingAbilityForSpell", () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("int", 10);
	state.addClass(makeRanger());
	state.addClass({name: "Wizard", source: "XPHB", level: 3, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});

	test("routes a spell by its sourceClass", () => {
		expect(state.getSpellcastingAbilityForSpell({name: "Cure Wounds", sourceClass: "Ranger"})).toBe("wis");
		expect(state.getSpellcastingAbilityForSpell({name: "Magic Missile", sourceClass: "Wizard"})).toBe("int");
	});
	test("matches Gambler spells by subclass key", () => {
		const s = new CharacterSheetState();
		s.addClass({name: "Rogue", source: "TGTT", level: 5, subclass: {name: "Gambler", source: "TGTT"}});
		expect(s.getSpellcastingAbilityForSpell({name: "Hex", sourceClass: "Gambler", sourceSubclass: "Gambler"})).toBe("cha");
	});
});

describe("getSpellSaveDcForAbility / getSpellAttackBonusForAbility", () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", 18); // +4
	state.setAbilityBase("wis", 14); // +2
	state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
	state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
	// Total level 8 => proficiency +3

	test("computes per-ability DC", () => {
		expect(state.getProficiencyBonus()).toBe(3);
		expect(state.getSpellSaveDcForAbility("int")).toBe(8 + 3 + 4); // 15
		expect(state.getSpellSaveDcForAbility("wis")).toBe(8 + 3 + 2); // 13
	});
	test("computes per-ability attack bonus", () => {
		expect(state.getSpellAttackBonusForAbility("int")).toBe(3 + 4); // 7
		expect(state.getSpellAttackBonusForAbility("wis")).toBe(3 + 2); // 5
	});
});

describe("getSpellcastingClassBreakdown — Wizard/Cleric (different abilities)", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("int", 18);
		state.setAbilityBase("wis", 14);
		state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
		state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
	});

	test("each class gets its own ability, DC and attack", () => {
		const cards = state.getSpellcastingClassBreakdown();
		expect(cards.length).toBe(2);

		const wiz = card(cards, "Wizard");
		const cle = card(cards, "Cleric");
		expect(wiz.ability).toBe("int");
		expect(cle.ability).toBe("wis");
		expect(wiz.saveDc).toBe(15);
		expect(cle.saveDc).toBe(13);
		expect(wiz.attackBonus).toBe(7);
		expect(cle.attackBonus).toBe(5);
		// DCs/attacks genuinely differ — not collapsed to one number.
		expect(wiz.saveDc).not.toBe(cle.saveDc);
		expect(wiz.attackBonus).not.toBe(cle.attackBonus);
	});

	test("Wizard is a spellbook caster with no fixed spells cap", () => {
		const wiz = card(state.getSpellcastingClassBreakdown(), "Wizard");
		expect(wiz.mechanic).toBe("spellbook");
		expect(wiz.spellsMax).toBeNull();
	});
});

describe("getSpellcastingClassBreakdown — Ranger/Druid (Lunaria-like)", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("wis", 16); // +3
		state.addClass(makeRanger());
		state.addClass(makeDruid());

		// Ranger prepared spells (player-chosen)
		state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceFeature: "Prepared Spells", sourceClass: "Ranger"});
		state.addSpell({name: "Pass without Trace", source: "PHB", level: 2, sourceFeature: "Prepared Spells", sourceClass: "Ranger"});
		// Druid prepared spells (player-chosen)
		state.addSpell({name: "Faerie Fire", source: "PHB", level: 1, sourceFeature: "Prepared Spells", sourceClass: "Druid"});
		state.addSpell({name: "Healing Word", source: "PHB", level: 1, sourceFeature: "Prepared Spells", sourceClass: "Druid"});
		// Druid subclass-granted always-prepared spell (NOT player-chosen)
		state.addSpell({name: "Guiding Bolt", source: "PHB", level: 1, sourceFeature: "Circle of the Zodiac Spells", sourceClass: "Druid", alwaysPrepared: true}, true);
		// Druid cantrips: 2 chosen + 1 granted
		state.addSpell({name: "Druidcraft", source: "XPHB", level: 0, sourceFeature: "Cantrips Known", sourceClass: "Druid"});
		state.addSpell({name: "Mold Earth", source: "XGE", level: 0, sourceFeature: "Cantrips Known", sourceClass: "Druid"});
		state.addSpell({name: "Guidance", source: "PHB", level: 0, sourceFeature: "Circle of the Zodiac Spells", sourceClass: "Druid"});
	});

	test("both classes share WIS so DC and attack match", () => {
		const cards = state.getSpellcastingClassBreakdown();
		const ranger = card(cards, "Ranger");
		const druid = card(cards, "Druid");
		expect(ranger.ability).toBe("wis");
		expect(druid.ability).toBe("wis");
		expect(ranger.saveDc).toBe(druid.saveDc);
		expect(ranger.attackBonus).toBe(druid.attackBonus);
	});

	test("per-class spell counts attribute by sourceClass", () => {
		const cards = state.getSpellcastingClassBreakdown();
		const ranger = card(cards, "Ranger");
		const druid = card(cards, "Druid");

		expect(ranger.spellsCount).toBe(2); // chosen Ranger spells
		expect(ranger.spellsGranted).toBe(0);
		expect(ranger.spellsMax).toBe(RANGER_PREPARED[5]); // level 6 => 6

		expect(druid.spellsCount).toBe(2); // chosen Druid spells (Guiding Bolt is granted)
		expect(druid.spellsGranted).toBe(1);
		expect(druid.spellsMax).toBe(DRUID_PREPARED[2]); // level 3 => 6
	});

	test("per-class cantrip counts split chosen vs granted", () => {
		const druid = card(state.getSpellcastingClassBreakdown(), "Druid");
		expect(druid.cantripsCount).toBe(2); // Druidcraft + Mold Earth
		expect(druid.cantripsGranted).toBe(1); // Guidance (subclass)
		expect(druid.cantripsMax).toBe(DRUID_CANTRIP[2]); // 2
	});

	test("Hunter/Zodiac subclasses are headed by class name", () => {
		const cards = state.getSpellcastingClassBreakdown();
		expect(card(cards, "Ranger")).toBeTruthy();
		expect(card(cards, "Druid")).toBeTruthy();
	});
});

describe("subclass-headed display names + Other bucket", () => {
	test("Gambler / Eldritch Knight are headed by subclass name", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("int", 16);
		state.addClass({name: "Rogue", source: "TGTT", level: 5, subclass: {name: "Gambler", source: "TGTT"}});
		state.addClass({name: "Fighter", source: "PHB", level: 4, subclass: {name: "Eldritch Knight", source: "PHB"}});
		const cards = state.getSpellcastingClassBreakdown();
		expect(card(cards, "Gambler")).toBeTruthy();
		expect(card(cards, "Eldritch Knight")).toBeTruthy();
	});

	test("spells with unmatched sourceClass land in the Other bucket", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16);
		state.addClass(makeDruid());
		state.addSpell({name: "Faerie Fire", source: "PHB", level: 1, sourceFeature: "Prepared Spells", sourceClass: "Druid"});
		// Orphan: no sourceClass at all
		state.addSpell({name: "Mystery Spell", source: "HB", level: 2});
		const other = state.getUnattributedSpellCounts();
		expect(other.spellsCount).toBe(1);
	});
});

describe("legacy back-compat", () => {
	test("no-arg getSpellSaveDc / getSpellAttackBonus still use the global ability", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16); // +3
		state.addClass({name: "Cleric", source: "PHB", level: 5, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
		state.setSpellcastingAbility("wis");
		expect(state.getSpellSaveDc()).toBe(8 + 3 + 3); // prof +3 at level 5
		expect(state.getSpellAttackBonus()).toBe(3 + 3);
	});

	test("getSpellcastingInfo keeps its byClass shape", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16);
		state.addClass(makeRanger());
		state.addClass(makeDruid());
		const info = state.getSpellcastingInfo();
		expect(info.isMulticlass).toBe(true);
		expect(Array.isArray(info.byClass)).toBe(true);
		expect(info.byClass.length).toBe(2);
		expect(info.byClass.find(c => c.className === "Ranger")).toBeTruthy();
		expect(info.byClass.find(c => c.className === "Druid")).toBeTruthy();
	});
});

describe("getSpellcastingCardForSpell — per-class favourite resolution (Bug #11)", () => {
	test("routes a spell to its owning class card by sourceClass (distinct DC/attack/ability)", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("int", 18); // +4
		state.setAbilityBase("wis", 14); // +2
		state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
		state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
		// Total level 8 => proficiency +3

		const wizCard = state.getSpellcastingCardForSpell({name: "Magic Missile", level: 1, sourceClass: "Wizard"});
		const cleCard = state.getSpellcastingCardForSpell({name: "Guiding Bolt", level: 1, sourceClass: "Cleric"});

		expect(wizCard.displayName).toBe("Wizard");
		expect(wizCard.ability).toBe("int");
		expect(wizCard.saveDc).toBe(15); // 8 + 3 + 4
		expect(wizCard.attackBonus).toBe(7); // 3 + 4

		expect(cleCard.displayName).toBe("Cleric");
		expect(cleCard.ability).toBe("wis");
		expect(cleCard.saveDc).toBe(13); // 8 + 3 + 2
		expect(cleCard.attackBonus).toBe(5); // 3 + 2

		// The two favourited spells genuinely resolve to different numbers.
		expect(wizCard.saveDc).not.toBe(cleCard.saveDc);
		expect(wizCard.attackBonus).not.toBe(cleCard.attackBonus);
	});

	test("routes cantrips the same way as leveled spells", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("int", 18);
		state.setAbilityBase("wis", 14);
		state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
		state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});

		const fireBolt = state.getSpellcastingCardForSpell({name: "Fire Bolt", level: 0, sourceClass: "Wizard"});
		const sacredFlame = state.getSpellcastingCardForSpell({name: "Sacred Flame", level: 0, sourceClass: "Cleric"});
		expect(fireBolt.ability).toBe("int");
		expect(sacredFlame.ability).toBe("wis");
		expect(fireBolt.attackBonus).toBe(7);
		expect(sacredFlame.saveDc).toBe(13);
	});

	test("Ranger/Druid (Lunaria-like, both WIS): each spell resolves its own class card", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16); // +3
		state.addClass(makeRanger());
		state.addClass(makeDruid());

		const rangerCard = state.getSpellcastingCardForSpell({name: "Cure Wounds", level: 1, sourceClass: "Ranger"});
		const druidCard = state.getSpellcastingCardForSpell({name: "Faerie Fire", level: 1, sourceClass: "Druid"});

		expect(rangerCard.displayName).toBe("Ranger");
		expect(druidCard.displayName).toBe("Druid");
		// Both use WIS so the numbers match, but the cards are the correct identities.
		expect(rangerCard.ability).toBe("wis");
		expect(druidCard.ability).toBe("wis");
		expect(rangerCard.saveDc).toBe(druidCard.saveDc);
		expect(rangerCard.attackBonus).toBe(druidCard.attackBonus);
		expect(rangerCard).not.toBe(druidCard);
	});

	test("subclass attribution wins, and Gambler spells match by subclass key", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("cha", 16); // +3
		state.setAbilityBase("int", 16);
		state.addClass({name: "Rogue", source: "TGTT", level: 5, subclass: {name: "Gambler", source: "TGTT"}});
		state.addClass({name: "Fighter", source: "PHB", level: 4, subclass: {name: "Eldritch Knight", source: "PHB"}});

		const gamblerCard = state.getSpellcastingCardForSpell({name: "Hex", level: 1, sourceClass: "Gambler", sourceSubclass: "Gambler"});
		expect(gamblerCard.displayName).toBe("Gambler");
		// The Gambler has no spellcasting ability - it rolls a Gambling Modifier
		// per cast - so the card must report that rather than inventing a stat.
		expect(gamblerCard.ability).toBeNull();
		expect(gamblerCard.abilityLabel).toBe("Rolled");
		expect(gamblerCard.saveDc).toBeNull();
		expect(gamblerCard.attackBonus).toBeNull();
		expect(gamblerCard.saveDcFormula).toBe("8 + 4 + 1d6");

		const ekCard = state.getSpellcastingCardForSpell({name: "Shield", level: 1, sourceClass: "Fighter", sourceSubclass: "Eldritch Knight"});
		expect(ekCard.displayName).toBe("Eldritch Knight");
		expect(ekCard.ability).toBe("int");
	});

	test("card DC/attack reflect item + custom modifiers (effective, not canonical)", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("int", 18); // +4
		state.setAbilityBase("wis", 14); // +2
		state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
		state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});
		state._data.itemBonuses = {...(state._data.itemBonuses || {}), spellSaveDc: 1, spellAttack: 1};

		const wizCard = state.getSpellcastingCardForSpell({name: "Magic Missile", level: 1, sourceClass: "Wizard"});
		expect(wizCard.saveDc).toBe(16); // 15 + 1 item
		expect(wizCard.attackBonus).toBe(8); // 7 + 1 item
	});

	test("unattributed favourite resolves the lone caster card, but is ambiguous (null) when multiclass", () => {
		// Single caster: an un-stamped (legacy) favourite still gets that card.
		const solo = new CharacterSheetState();
		solo.setAbilityBase("wis", 16);
		solo.addClass(makeDruid());
		const soloCard = solo.getSpellcastingCardForSpell({name: "Legacy Spell", level: 1});
		expect(soloCard).toBeTruthy();
		expect(soloCard.displayName).toBe("Druid");

		// Single caster, but an EXPLICIT stamp that matches no caster class stays
		// ambiguous (null) — we don't blindly attribute a mis-stamped spell.
		expect(solo.getSpellcastingCardForSpell({name: "Vicious Mockery", level: 0, sourceClass: "Bard"})).toBeNull();

		// Multiclass: an un-stamped favourite cannot be attributed → null (caller
		// omits the per-class stats line rather than guessing).
		const multi = new CharacterSheetState();
		multi.setAbilityBase("wis", 16);
		multi.addClass(makeRanger());
		multi.addClass(makeDruid());
		expect(multi.getSpellcastingCardForSpell({name: "Legacy Spell", level: 1})).toBeNull();
		// Also null when the stamp matches no caster class.
		expect(multi.getSpellcastingCardForSpell({name: "Legacy Spell", level: 1, sourceClass: "Bard"})).toBeNull();
	});

	test("same spell name resolves by its owner stamp, not by spell-list availability", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("int", 18);
		state.setAbilityBase("wis", 14);
		state.addClass({name: "Wizard", source: "XPHB", level: 5, preparedSpellsProgression: WIZARD_PREPARED, cantripProgression: WIZARD_CANTRIP, casterProgression: "full", spellcastingAbility: "int"});
		state.addClass({name: "Cleric", source: "PHB", level: 3, cantripProgression: CLERIC_CANTRIP, casterProgression: "full", spellcastingAbility: "wis"});

		// "Detect Magic" is on both lists; the stamp decides the owning class.
		const asWizard = state.getSpellcastingCardForSpell({name: "Detect Magic", level: 1, sourceClass: "Wizard"});
		const asCleric = state.getSpellcastingCardForSpell({name: "Detect Magic", level: 1, sourceClass: "Cleric"});
		expect(asWizard.displayName).toBe("Wizard");
		expect(asWizard.saveDc).toBe(15);
		expect(asCleric.displayName).toBe("Cleric");
		expect(asCleric.saveDc).toBe(13);
	});

	test("returns null when the character has no spellcasting classes", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "PHB", level: 3});
		expect(state.getSpellcastingCardForSpell({name: "Anything", level: 1, sourceClass: "Barbarian"})).toBeNull();
	});
});
