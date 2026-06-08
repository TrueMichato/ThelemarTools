/**
 * Bug 2 — Divine Soul affinity spell is swappable (only for a Cleric spell).
 *
 * A Divine Soul Sorcerer gains one always-prepared spell determined by their
 * alignment affinity (Good → cure wounds, Law → bless, …). The rules let the
 * player change THAT one spell for another Cleric spell, but the sheet locked
 * it like every other subclass-granted spell.
 *
 * Fix: model the effective grant through a single helper
 * (`getEffectiveDivineSoulSpell`), tag the entry `isDivineSoulAffinity`, and add
 * a targeted `swapDivineSoulAffinitySpell` that records a per-class override and
 * repopulates. These tests assert the computed spell list / flags / persistence,
 * not UI text.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;
let state;

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const DIVINE_SOUL_SUBCLASS = {
	name: "Divine Soul",
	shortName: "Divine Soul",
	source: "TGTT",
	additionalSpells: [
		{name: "Good", known: {"1": ["cure wounds|PHB"]}},
		{name: "Evil", known: {"1": ["inflict wounds|PHB"]}},
		{name: "Law", known: {"1": ["bless|PHB"]}},
		{name: "Chaos", known: {"1": ["bane|PHB"]}},
		{name: "Neutrality", known: {"1": ["protection from evil and good|PHB"]}},
	],
};

// Minimal Cleric-list spell DB so levels resolve and the swap picker restriction
// (Cleric, level 1) is exercisable.
const SPELL_DB = [
	{name: "Cure Wounds", source: "PHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}, {name: "Bard"}]}},
	{name: "Bless", source: "PHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}, {name: "Paladin"}]}},
	{name: "Healing Word", source: "PHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}, {name: "Bard"}]}},
	{name: "Guiding Bolt", source: "PHB", level: 1, school: "V", classes: {fromClassList: [{name: "Cleric"}]}},
	{name: "Fireball", source: "PHB", level: 3, school: "V", classes: {fromClassList: [{name: "Sorcerer"}, {name: "Wizard"}]}},
];

function makeDivineSoul (affinity = "Good") {
	state = new CharacterSheetState();
	state.setSpellData(SPELL_DB);
	state.addClass({name: "Sorcerer", source: "TGTT", level: 3, subclass: {...DIVINE_SOUL_SUBCLASS}});
	state.setSubclassChoice("Sorcerer", affinity);
	state.populateSubclassSpells();
	return state;
}

const findAffinity = (st) => st.getSpells().find(s => s.isDivineSoulAffinity);

describe("Bug 2 — Divine Soul affinity spell swap", () => {
	test("affinity spell is populated, always-prepared, and tagged swappable", () => {
		makeDivineSoul("Good");
		const affinity = findAffinity(state);
		expect(affinity).toBeDefined();
		expect(affinity.name).toBe("Cure Wounds");
		expect(affinity.alwaysPrepared).toBe(true);
		expect(affinity.isDivineSoulAffinity).toBe(true);
	});

	test("effective grant defaults to the affinity-derived spell", () => {
		makeDivineSoul("Law");
		const eff = state.getDivineSoulKnownSpell("Sorcerer");
		expect(eff.name.toLowerCase()).toBe("bless");
		expect(findAffinity(state).name).toBe("Bless");
	});

	test("swap replaces the affinity spell and removes the old one", () => {
		makeDivineSoul("Good");
		const ok = state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "PHB", level: 1});
		expect(ok).toBe(true);

		const names = state.getSpells().map(s => s.name);
		expect(names).toContain("Healing Word");
		expect(names).not.toContain("Cure Wounds");

		const affinity = findAffinity(state);
		expect(affinity.name).toBe("Healing Word");
		expect(affinity.alwaysPrepared).toBe(true);
		expect(affinity.isDivineSoulAffinity).toBe(true);
		// Exactly one affinity entry — no duplicates left behind.
		expect(state.getSpells().filter(s => s.isDivineSoulAffinity).length).toBe(1);
	});

	test("effective grant follows the override after a swap", () => {
		makeDivineSoul("Good");
		state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Guiding Bolt", source: "PHB", level: 1});
		expect(state.getDivineSoulKnownSpell("Sorcerer").name.toLowerCase()).toBe("guiding bolt");
	});

	test("swap is idempotent under repopulate (no duplicate grants)", () => {
		makeDivineSoul("Good");
		state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "PHB", level: 1});
		state.populateSubclassSpells();
		state.populateSubclassSpells();
		const affinityEntries = state.getSpells().filter(s => s.isDivineSoulAffinity);
		expect(affinityEntries.length).toBe(1);
		expect(affinityEntries[0].name).toBe("Healing Word");
	});

	test("swap does NOT delete a colliding non-affinity always-prepared spell", () => {
		makeDivineSoul("Good");
		// Inject an unrelated always-prepared spell from a different feature that
		// happens to share NOTHING with the affinity — must survive the targeted swap.
		state._data.spellcasting.spellsKnown.push({
			name: "Bless",
			source: "PHB",
			level: 1,
			alwaysPrepared: true,
			sourceFeature: "Some Other Feature",
			sourceClass: "Cleric",
		});
		state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "PHB", level: 1});
		const blessEntries = state.getSpells().filter(s => s.name === "Bless");
		expect(blessEntries.length).toBe(1);
		expect(blessEntries[0].sourceFeature).toBe("Some Other Feature");
	});

	test("changing affinity clears a prior override", () => {
		makeDivineSoul("Good");
		state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "PHB", level: 1});
		const cls = state.getClasses().find(c => c.name === "Sorcerer");
		expect(cls.divineSoulSpellOverride).toBeDefined();

		state.setSubclassChoice("Sorcerer", "Law");
		expect(cls.divineSoulSpellOverride).toBeUndefined();
		state.populateSubclassSpells();
		expect(findAffinity(state).name).toBe("Bless"); // Law default, not the old override
	});

	test("override + tag persist across toJson/load", () => {
		makeDivineSoul("Good");
		state.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "PHB", level: 1});
		const json = state.toJson();

		const reloaded = new CharacterSheetState();
		reloaded.setSpellData(SPELL_DB);
		reloaded.loadFromJson(json);
		reloaded.populateSubclassSpells();

		const cls = reloaded.getClasses().find(c => c.name === "Sorcerer");
		expect(cls.divineSoulSpellOverride?.name).toBe("Healing Word");
		const affinity = reloaded.getSpells().find(s => s.isDivineSoulAffinity);
		expect(affinity?.name).toBe("Healing Word");
		expect(reloaded.getDivineSoulKnownSpell("Sorcerer").name.toLowerCase()).toBe("healing word");
	});

	test("legacy save (untagged affinity spell) gains the swap tag on populate", () => {
		state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state.addClass({name: "Sorcerer", source: "TGTT", level: 3, subclass: {...DIVINE_SOUL_SUBCLASS}});
		state.setSubclassChoice("Sorcerer", "Good");
		// Simulate a pre-fix save: affinity spell present, always-prepared, but NOT tagged.
		state._data.spellcasting.spellsKnown.push({
			name: "Cure Wounds",
			source: "PHB",
			level: 1,
			alwaysPrepared: true,
			prepared: true,
			sourceFeature: "Divine Soul Spells",
			sourceClass: "Sorcerer",
		});
		state.populateSubclassSpells();
		const affinity = state.getSpells().find(s => s.name === "Cure Wounds");
		expect(affinity.isDivineSoulAffinity).toBe(true);
	});

	test("swap removes the old affinity even when enrichment rewrote its source", () => {
		// DB only has Cure Wounds under XPHB; the affinity ref defaults to PHB. The
		// populated entry is tagged with source XPHB, so removal must match by name.
		const xphbDb = [
			{name: "Cure Wounds", source: "XPHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}]}},
			{name: "Healing Word", source: "XPHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}]}},
		];
		const st = new CharacterSheetState();
		st.setSpellData(xphbDb);
		st.addClass({name: "Sorcerer", source: "TGTT", level: 3, subclass: {...DIVINE_SOUL_SUBCLASS}});
		st.setSubclassChoice("Sorcerer", "Good");
		st.populateSubclassSpells();
		expect(st.getSpells().some(s => s.name === "Cure Wounds")).toBe(true);

		st.swapDivineSoulAffinitySpell("Sorcerer", {name: "Healing Word", source: "XPHB", level: 1});
		const cureEntries = st.getSpells().filter(s => s.name === "Cure Wounds");
		expect(cureEntries.length).toBe(0);
		expect(st.getSpells().filter(s => s.isDivineSoulAffinity).length).toBe(1);
	});

	test("switching away from Divine Soul removes the orphaned affinity spell", () => {
		makeDivineSoul("Good");
		expect(state.getSpells().some(s => s.name === "Cure Wounds")).toBe(true);
		state.setSubclass("Sorcerer", {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"});
		expect(state.getSpells().some(s => s.isDivineSoulAffinity)).toBe(false);
		expect(state.getSpells().some(s => s.name === "Cure Wounds")).toBe(false);
		const cls = state.getClasses().find(c => c.name === "Sorcerer");
		expect(cls.divineSoulSpellOverride).toBeUndefined();
	});
});
