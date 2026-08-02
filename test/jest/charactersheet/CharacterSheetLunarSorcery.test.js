/**
 * Lunar Sorcery Sorcerer (DSotDQ) — mechanical-effect coverage.
 *
 * Every test asserts an OBSERVABLE consequence — a granted spell, a resistance list, a
 * skill-advantage flag, a sorcery-point balance, a discounted metamagic cost — never the
 * mere presence of a `hasXxx` calculation flag. Before this suite the subclass set six
 * bare `hasXxx` flags with ZERO consumers anywhere in the codebase.
 *
 * Three corrections to the commonly-repeated summary of this subclass, all verified
 * against `data/class/class-sorcerer.json:3162-3408`, are pinned here as tests:
 *   1. The phases are Full Moon / New Moon / Crescent Moon. Moon Fire is NOT a phase —
 *      it is a separate 1st-level feature granting Sacred Flame.
 *   2. Lunar Empowerment (14th) adds no damage. It grants phase-gated passives.
 *   3. The phase does NOT gate spell knowledge — RAW you learn all fifteen Lunar Spells.
 *
 * Also covers the two GENERIC mechanisms this subclass forced into existence, because
 * future subclasses depend on them:
 *   - `CharacterSheetState.FEATURE_SPELL_GRANTS` / `getFeatureGrantedSpells` — declarative
 *     level-gated grants for spell lists that live in a `type: "table"` entry, which
 *     `SpellGrantParser.getFeatureSpellText` never visits.
 *   - `CharacterSheetClassUtils.hasSubclassChoicePrompt` / `getSubclassChoiceOptions` /
 *     `getSubclassChoicePrompt` — the wizard-prompt predicate, split away from the
 *     spell-block-gating `hasNamedSubclassChoice`.
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const LUNAR_SUBCLASS = {name: "Lunar Sorcery", shortName: "Lunar", source: "DSotDQ"};

/**
 * Build a Lunar Sorcery sorcerer.
 * @param {number} level
 * @param {object} [opts]
 * @param {string} [opts.source="PHB"] class chassis source.
 * @param {string} [opts.phase] initial phase (as the wizards would have recorded it).
 */
function makeLunarSorcerer (level = 20, {source = "PHB", phase = null} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source,
		level,
		subclass: {...LUNAR_SUBCLASS},
		...(phase ? {subclassChoice: phase} : {}),
	}];
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(60, 60);
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

/** A non-Lunar sorcerer of the same level, as the negative control. */
function makeDraconicSorcerer (level = 20) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state._data.classes = [{
		name: "Sorcerer",
		source: "PHB",
		level,
		subclass: {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"},
	}];
	state.setHp(60, 60);
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

const spellNames = (state) => (state._data.spellcasting.spellsKnown || []).map(s => s.name);
const cantripNames = (state) => (state._data.spellcasting.cantripsKnown || []).map(s => s.name);

// ===========================================================================
// Generic mechanism A — declarative spell grants
// ===========================================================================

describe("generic: FEATURE_SPELL_GRANTS declarative spell grants", () => {
	it("grants nothing for a class with no registry entry", () => {
		const draconic = makeDraconicSorcerer(20);
		expect(CharacterSheetState.getFeatureGrantedSpells(draconic._data.classes[0])).toEqual([]);
		expect(spellNames(draconic)).not.toContain("Shield");
	});

	it("resolves a subclass by EITHER shortName or name", () => {
		const byShort = CharacterSheetState.getFeatureGrantedSpells({name: "Sorcerer", level: 20, subclass: {shortName: "Lunar"}});
		const byName = CharacterSheetState.getFeatureGrantedSpells({name: "Sorcerer", level: 20, subclass: {name: "Lunar"}});
		expect(byShort.length).toBe(16);
		expect(byName.length).toBe(16);
	});

	it("gates each grant on its own minLevel against the CLASS level", () => {
		const at = (level) => CharacterSheetState.getFeatureGrantedSpells({name: "Sorcerer", level, subclass: {shortName: "Lunar"}}).map(g => g.name);
		// Sacred Flame (no minLevel → 1) plus the three 1st-level rows.
		expect(at(1).sort()).toEqual(["Color Spray", "Ray of Sickness", "Sacred Flame", "Shield"]);
		expect(at(2).length).toBe(4);
		expect(at(3).length).toBe(7);
		expect(at(4).length).toBe(7);
		expect(at(5).length).toBe(10);
		expect(at(7).length).toBe(13);
		expect(at(9).length).toBe(16);
		expect(at(20).length).toBe(16);
	});

	it("de-duplicates a spell declared under both the shortName and name key", () => {
		const key = "Sorcerer|Dupe";
		CharacterSheetState.FEATURE_SPELL_GRANTS[key] = [
			{name: "Shield", source: "PHB"},
			{name: "Shield", source: "PHB"},
		];
		try {
			const got = CharacterSheetState.getFeatureGrantedSpells({name: "Sorcerer", level: 20, subclass: {shortName: "Dupe", name: "Dupe"}});
			expect(got.map(g => g.name)).toEqual(["Shield"]);
		} finally {
			delete CharacterSheetState.FEATURE_SPELL_GRANTS[key];
		}
	});

	it("survives a subclass that has NO additionalSpells block at all", () => {
		// This is the regression that matters: `getSubclassAlwaysPreparedSpells` used to
		// `return []` the moment `additionalSpells` was missing, which would have thrown
		// every declarative grant away.
		const state = makeLunarSorcerer(20);
		expect(state._data.classes[0].subclass.additionalSpells).toBeUndefined();
		expect(spellNames(state)).toContain("Shield");
	});

	it("attributes each grant to the FEATURE that gives it, not a generic bucket", () => {
		const state = makeLunarSorcerer(20);
		const sacredFlame = (state._data.spellcasting.cantripsKnown || []).find(c => c.name === "Sacred Flame");
		const shield = (state._data.spellcasting.spellsKnown || []).find(s => s.name === "Shield");
		expect(sacredFlame.sourceFeature).toBe("Moon Fire");
		expect(shield.sourceFeature).toBe("Lunar Embodiment");
	});
});

// ===========================================================================
// Generic mechanism B — the wizard-prompt predicate split
// ===========================================================================

describe("generic: subclass choice PROMPT vs spell-block GATING", () => {
	it("Lunar needs a wizard prompt but must NOT gate its spell blocks", () => {
		expect(CharacterSheetClassUtils.hasSubclassChoicePrompt(LUNAR_SUBCLASS)).toBe(true);
		// The narrow predicate stays false — this is the whole point of the split.
		// If it were true, `getSubclassAlwaysPreparedSpells` would grant only the
		// single named `additionalSpells` block (Full Moon) and drop ten spells.
		expect(CharacterSheetClassUtils.hasNamedSubclassChoice(LUNAR_SUBCLASS)).toBe(false);
	});

	it("offers exactly the three lunar phases, in book order", () => {
		const options = CharacterSheetClassUtils.getSubclassChoiceOptions(LUNAR_SUBCLASS);
		expect(options.map(o => o.name)).toEqual(["Full Moon", "New Moon", "Crescent Moon"]);
		expect(CharacterSheetClassUtils.getSubclassChoicePrompt(LUNAR_SUBCLASS).title).toBe("Lunar Embodiment");
	});

	it("returns a defensive copy so a wizard cannot mutate the shared option list", () => {
		const first = CharacterSheetClassUtils.getSubclassChoiceOptions(LUNAR_SUBCLASS);
		first[0].name = "MUTATED";
		expect(CharacterSheetClassUtils.getSubclassChoiceOptions(LUNAR_SUBCLASS)[0].name).toBe("Full Moon");
	});

	it("leaves Divine Soul and Daemonologist behaviour unchanged", () => {
		const divineSoul = {name: "Divine Soul", shortName: "Divine Soul", source: "XGE"};
		expect(CharacterSheetClassUtils.hasSubclassChoicePrompt(divineSoul)).toBe(true);
		expect(CharacterSheetClassUtils.hasNamedSubclassChoice(divineSoul)).toBe(true);
		expect(CharacterSheetClassUtils.getSubclassChoiceOptions(divineSoul))
			.toEqual(CharacterSheetClassUtils.getNamedSubclassChoiceOptions(divineSoul));
		expect(CharacterSheetClassUtils.getSubclassChoicePrompt(divineSoul).title).toBe("Divine Soul Affinity");
	});

	it("a subclass needing no pick is unaffected", () => {
		const draconic = {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"};
		expect(CharacterSheetClassUtils.hasSubclassChoicePrompt(draconic)).toBe(false);
		expect(CharacterSheetClassUtils.getSubclassChoiceOptions(draconic)).toEqual([]);
		expect(CharacterSheetClassUtils.getSubclassChoicePrompt(draconic)).toBeNull();
	});

	it("setSubclass PRESERVES subclassChoice for Lunar (it seeds the phase)", () => {
		const state = makeLunarSorcerer(5, {phase: "New Moon"});
		state.setSubclass("Sorcerer", {...LUNAR_SUBCLASS});
		expect(state._data.classes[0].subclassChoice).toBeTruthy();
		// ...and clears it when switching to a subclass that needs no pick.
		state.setSubclass("Sorcerer", {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"});
		expect(state._data.classes[0].subclassChoice).toBeNull();
	});
});

// ===========================================================================
// Lunar Embodiment — the spell table
// ===========================================================================

describe("Lunar Embodiment — the Lunar Spells table", () => {
	it("grants ALL FIFTEEN table spells, not just the shipped Full Moon column", () => {
		const state = makeLunarSorcerer(20);
		const known = spellNames(state);
		for (const name of [
			"Shield", "Ray of Sickness", "Color Spray",
			"Lesser Restoration", "Blindness/Deafness", "Alter Self",
			"Dispel Magic", "Vampiric Touch", "Phantom Steed",
			"Death Ward", "Confusion", "Hallucinatory Terrain",
			"Rary's Telepathic Bond", "Hold Monster", "Mislead",
		]) expect(known).toContain(name);
	});

	it("the granted set is IDENTICAL in every phase — the phase gates other things", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		const before = spellNames(state).slice().sort();
		state.setLunarPhase("crescent moon", {free: true});
		state.applyClassFeatureEffects();
		expect(spellNames(state).slice().sort()).toEqual(before);
	});

	it("is level-gated on the class level, one table row at a time", () => {
		expect(spellNames(makeLunarSorcerer(1))).toEqual(["Shield", "Ray of Sickness", "Color Spray"]);
		expect(spellNames(makeLunarSorcerer(3))).toContain("Alter Self");
		expect(spellNames(makeLunarSorcerer(3))).not.toContain("Dispel Magic");
		expect(spellNames(makeLunarSorcerer(5))).toContain("Dispel Magic");
		expect(spellNames(makeLunarSorcerer(5))).not.toContain("Death Ward");
		expect(spellNames(makeLunarSorcerer(9))).toContain("Mislead");
	});

	it("every granted spell is always prepared", () => {
		const state = makeLunarSorcerer(20);
		const shield = state._data.spellcasting.spellsKnown.find(s => s.name === "Shield");
		expect(shield.alwaysPrepared).toBe(true);
		expect(shield.prepared).toBe(true);
	});
});

// ===========================================================================
// Moon Fire — NOT a phase
// ===========================================================================

describe("Lunar Spells do not count against spells known", () => {
	// The codebase has no `doesNotCountAgainstKnown` field — verified by
	// `git grep doesNotCountAgainstKnown -- js/` returning nothing. The convention
	// that IS consumed is `alwaysPrepared` + `sourceFeature`, which is what the
	// Level-Up spell-swap list filters on (`charactersheet-levelup.js:4218`:
	// `s.level > 0 && !s.alwaysPrepared && !s.sourceFeature`). So that is the
	// invariant asserted here — a new flag with no reader would be exactly the
	// dead-`hasXxx` anti-pattern this whole suite exists to eliminate.
	const swappableKnown = (st) => (st._data.spellcasting.spellsKnown || [])
		.filter(s => !s.alwaysPrepared && !s.sourceFeature);

	it("marks every granted Lunar spell with the flags the known-count filter reads", () => {
		const state = makeLunarSorcerer(20);
		const lunar = (state._data.spellcasting.spellsKnown || [])
			.filter(s => s.sourceFeature === "Lunar Embodiment");
		expect(lunar).toHaveLength(15);
		lunar.forEach(sp => {
			expect(sp.alwaysPrepared).toBe(true);
			expect(sp.sourceFeature).toBe("Lunar Embodiment");
		});
	});

	it("leaves the sorcerer's own spells-known budget untouched", () => {
		expect(swappableKnown(makeLunarSorcerer(20))).toHaveLength(swappableKnown(makeDraconicSorcerer(20)).length);
	});

	it("attributes Sacred Flame to Moon Fire so the cantrip pickers dedupe it", () => {
		// Cantrip entries deliberately drop `alwaysPrepared` (a cantrip is always
		// castable, so the flag is meaningless there). `sourceFeature` is the flag
		// that IS read — `charactersheet-class-utils.js:3259` filters granted cantrips
		// by it, and Level-Up feeds `getCantripsKnown()` into the picker's
		// already-known exclusion list (`charactersheet-levelup.js:617, 1045, 1099`).
		const state = makeLunarSorcerer(20);
		const granted = (state.getCantripsKnown() || []).find(c => c.name === "Sacred Flame");
		expect(granted).toBeTruthy();
		expect(granted.sourceFeature).toBe("Moon Fire");
		expect(granted.sourceClass).toBe("Sorcerer");
	});
});

describe("Moon Fire", () => {
	it("is a separate feature granting Sacred Flame as a cantrip, not a lunar phase", () => {
		const state = makeLunarSorcerer(20);
		expect(cantripNames(state)).toContain("Sacred Flame");
		// Sacred Flame is a CANTRIP grant, so it must not appear in spellsKnown.
		expect(spellNames(state)).not.toContain("Sacred Flame");
		// And "Moon Fire" is not one of the phases.
		expect(Object.keys(CharacterSheetState.LUNAR_PHASES)).toEqual(["full moon", "new moon", "crescent moon"]);
	});

	it("publishes the two-target rider as real numbers", () => {
		const calc = makeLunarSorcerer(20).getFeatureCalculations();
		expect(calc.moonFireCantrip).toBe("Sacred Flame");
		expect(calc.moonFireTargets).toBe(2);
		expect(calc.moonFireTargetSpacingFt).toBe(5);
	});

	it("is not surfaced before the subclass is taken on the 2024 chassis", () => {
		// On the XPHB chassis a sorcerer has no subclass at all until 3rd level, so
		// nothing lunar exists; and even with the subclass artificially attached at
		// 2nd level the feature flags stay dark.
		const noSubclass = new CharacterSheetState();
		noSubclass._data.classes = [{name: "Sorcerer", source: "XPHB", level: 2}];
		noSubclass.applyClassFeatureEffects();
		expect(cantripNames(noSubclass)).not.toContain("Sacred Flame");

		const state = makeLunarSorcerer(2, {source: "XPHB"});
		expect(state.getFeatureCalculations().hasMoonFire).toBeFalsy();
		expect(state.getFeatureCalculations().hasLunarEmbodiment).toBeFalsy();
	});

	it("is not double-granted when the real Moon Fire feature object is also added", () => {
		// The declarative registry grants Sacred Flame; the PROSE of the shipped Moon
		// Fire feature ALSO says "You learn the {@spell sacred flame} spell", which
		// `SpellGrantParser.parseSpellsFromText` reads. Both paths must converge on a
		// single cantrip row.
		const state = makeLunarSorcerer(20);
		state.addFeature({
			name: "Moon Fire",
			source: "DSotDQ",
			className: "Sorcerer",
			subclassShortName: "Lunar",
			level: 1,
			entries: [
				"{@i 1st-Level Lunar Sorcery Feature}",
				"You can call down the radiant light of the moon on command. You learn the {@spell sacred flame} spell, which doesn't count against the number of sorcerer cantrips you know. When you cast the spell, you can target one creature as normal or target two creatures within range that are within 5 feet of each other.",
			],
		});
		const sacredFlames = cantripNames(state).filter(n => n.toLowerCase() === "sacred flame");
		expect(sacredFlames).toHaveLength(1);
	});

	it("does not double-grant the table spells when the real Lunar Embodiment feature is added", () => {
		// Lunar Embodiment's spell list lives entirely inside a `type: "table"` entry,
		// which `SpellGrantParser.getFeatureSpellText` never visits (it walks only
		// `entries` and `items`). This is exactly why the declarative registry exists —
		// and it means adding the real feature must add nothing at all.
		const state = makeLunarSorcerer(20);
		const before = spellNames(state).length;
		state.addFeature({
			name: "Lunar Embodiment",
			source: "DSotDQ",
			className: "Sorcerer",
			subclassShortName: "Lunar",
			level: 1,
			entries: [
				"You learn additional spells when you reach certain levels in this class, as shown on the Lunar Spells table.",
				{
					type: "table",
					caption: "Lunar Spells",
					colLabels: ["Sorcerer Level", "Full Moon Spell", "New Moon Spell", "Crescent Moon Spell"],
					rows: [["1st", "{@spell shield}", "{@spell ray of sickness}", "{@spell color spray}"]],
				},
			],
		});
		expect(spellNames(state)).toHaveLength(before);
		expect(spellNames(state).filter(n => n === "Shield")).toHaveLength(1);
	});
});

// ===========================================================================
// The lunar phase — a real, switchable state
// ===========================================================================

describe("lunar phase — live switchable state", () => {
	it("seeds from the subclassChoice the wizards recorded", () => {
		expect(makeLunarSorcerer(5, {phase: "New Moon"}).getLunarPhase().key).toBe("new moon");
		expect(makeLunarSorcerer(5, {phase: "Crescent Moon"}).getLunarPhase().key).toBe("crescent moon");
		// No recorded pick → a deterministic default rather than "no phase".
		expect(makeLunarSorcerer(5).getLunarPhase().key).toBe("full moon");
	});

	it("normalizes every spelling a caller might reasonably use", () => {
		const f = CharacterSheetState.normalizeLunarPhaseKey;
		expect(f("Full Moon")).toBe("full moon");
		expect(f("full")).toBe("full moon");
		expect(f("lunarPhaseCrescent")).toBe("crescent moon");
		expect(f({name: "New Moon"})).toBe("new moon");
		expect(f("gibbous")).toBeNull();
		expect(f(null)).toBeNull();
	});

	it("exactly one phase is ever active — they are mutually exclusive", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		state.setLunarPhase("new moon", {free: true});
		const ids = ["lunarPhaseFull", "lunarPhaseNew", "lunarPhaseCrescent"];
		expect(ids.filter(id => state.isStateTypeActive(id))).toEqual(["lunarPhaseNew"]);
		state.setLunarPhase("crescent moon", {free: true});
		expect(ids.filter(id => state.isStateTypeActive(id))).toEqual(["lunarPhaseCrescent"]);
	});

	it("a mid-adventure switch is NOT undone by a later re-derivation", () => {
		// `subclassChoice` seeds the phase; it must never override a live switch.
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		state.setLunarPhase("crescent moon", {free: true});
		state.applyClassFeatureEffects();
		state.getResources();
		expect(state.getLunarPhase().key).toBe("crescent moon");
	});

	it("rejects an unknown phase without mutating anything", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		const res = state.setLunarPhase("waning gibbous");
		expect(res.success).toBe(false);
		expect(state.getLunarPhase().key).toBe("new moon");
	});

	it("returns null for a sorcerer of another subclass", () => {
		expect(makeDraconicSorcerer(20).getLunarPhase()).toBeNull();
	});

	it("drops orphaned phase states when the subclass is swapped away", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		expect(state.isStateTypeActive("lunarPhaseNew")).toBe(true);
		state.setSubclass("Sorcerer", {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"});
		state.getResources();
		expect(state.isStateTypeActive("lunarPhaseNew")).toBe(false);
	});
});

// ===========================================================================
// Waxing and Waning — the bonus-action switch
// ===========================================================================

describe("Waxing and Waning (6th)", () => {
	it("spends exactly one sorcery point to switch as a bonus action", () => {
		const state = makeLunarSorcerer(10, {phase: "Full Moon"});
		const before = state.getSorceryPoints().current;
		const res = state.setLunarPhase("new moon", {bonusAction: true});
		expect(res.success).toBe(true);
		expect(res.sorceryPointsSpent).toBe(1);
		expect(state.getSorceryPoints().current).toBe(before - 1);
		expect(state.getLunarPhase().key).toBe("new moon");
	});

	it("refuses below 6th level, and does not spend a point", () => {
		const state = makeLunarSorcerer(5, {phase: "Full Moon"});
		const before = state.getSorceryPoints().current;
		const res = state.setLunarPhase("new moon", {bonusAction: true});
		expect(res.success).toBe(false);
		expect(state.getSorceryPoints().current).toBe(before);
		expect(state.getLunarPhase().key).toBe("full moon");
	});

	it("refuses with no sorcery points left, and leaves the phase alone", () => {
		const state = makeLunarSorcerer(10, {phase: "Full Moon"});
		state.setSorceryPoints({current: 0, max: state.getSorceryPoints().max});
		const res = state.setLunarPhase("new moon", {bonusAction: true});
		expect(res.success).toBe(false);
		expect(state.getLunarPhase().key).toBe("full moon");
	});

	it("the free (long-rest) switch costs nothing at any level", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		const before = state.getSorceryPoints().current;
		expect(state.setLunarPhase("crescent moon", {free: true}).sorceryPointsSpent).toBe(0);
		expect(state.getSorceryPoints().current).toBe(before);
	});

	it("never open-codes the sorcery point pool", () => {
		for (const [source, level] of [["PHB", 10], ["XPHB", 10], ["TGTT", 10]]) {
			const state = makeLunarSorcerer(level, {source});
			expect(state.getSorceryPoints().max)
				.toBe(CharacterSheetState.getSorceryPointsMaxForClass({name: "Sorcerer", source, level}));
		}
	});
});

// ===========================================================================
// Lunar Embodiment free casts
// ===========================================================================

describe("Lunar Embodiment free casts", () => {
	it("before 6th level only the CURRENT phase's spell is free", () => {
		const state = makeLunarSorcerer(5, {phase: "New Moon"});
		const casts = state.getLunarFreeCasts();
		expect(casts.filter(c => c.available).map(c => c.phase)).toEqual(["new moon"]);
		expect(casts.find(c => c.phase === "new moon").spell.name).toBe("Ray of Sickness");
	});

	it("from 6th level Waxing and Waning makes one free cast available PER phase", () => {
		const casts = makeLunarSorcerer(6, {phase: "Full Moon"}).getLunarFreeCasts();
		expect(casts.filter(c => c.available).map(c => c.spell.name))
			.toEqual(["Shield", "Ray of Sickness", "Color Spray"]);
	});

	it("spending one phase's free cast does not spend another's", () => {
		const state = makeLunarSorcerer(10, {phase: "Full Moon"});
		expect(state.useLunarFreeCast("full moon").spell.name).toBe("Shield");
		const casts = state.getLunarFreeCasts();
		expect(casts.find(c => c.phase === "full moon").available).toBe(false);
		expect(casts.find(c => c.phase === "new moon").available).toBe(true);
	});

	it("switching phase cannot re-spend a phase's already-used free cast", () => {
		const state = makeLunarSorcerer(10, {phase: "Full Moon"});
		state.useLunarFreeCast("full moon");
		state.setLunarPhase("new moon", {bonusAction: true});
		state.setLunarPhase("full moon", {bonusAction: true});
		expect(state.useLunarFreeCast("full moon").success).toBe(false);
	});

	it("defaults to the current phase when none is named", () => {
		const state = makeLunarSorcerer(10, {phase: "Crescent Moon"});
		expect(state.useLunarFreeCast().spell.name).toBe("Color Spray");
	});

	it("a long rest restores every phase's free cast", () => {
		const state = makeLunarSorcerer(10, {phase: "Full Moon"});
		state.useLunarFreeCast("full moon");
		state.useLunarFreeCast("new moon");
		state.onLongRest();
		expect(state.getLunarFreeCasts().filter(c => c.available).length).toBe(3);
	});
});

// ===========================================================================
// Lunar Boons — the metamagic discount
// ===========================================================================

describe("Lunar Boons (6th)", () => {
	it("mints a proficiency-bonus-sized long-rest pool at 6th level and not before", () => {
		expect(makeLunarSorcerer(5).getLunarBoonsResource()).toBeNull();
		const state = makeLunarSorcerer(6);
		expect(state.getLunarBoonsResource()).toMatchObject({max: state.getProficiencyBonus(), recharge: "long"});
		expect(makeLunarSorcerer(20).getLunarBoonsResource().max).toBe(6);
	});

	it("discounts by exactly 1 for the current phase's two schools ONLY", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		// Full Moon = Abjuration + Divination.
		expect(state.getLunarBoonsDiscountedCost(3, "A")).toMatchObject({cost: 2, discounted: true, saved: 1});
		expect(state.getLunarBoonsDiscountedCost(3, "D")).toMatchObject({cost: 2, discounted: true});
		expect(state.getLunarBoonsDiscountedCost(3, "N")).toMatchObject({cost: 3, discounted: false});
		expect(state.getLunarBoonsDiscountedCost(3, "V")).toMatchObject({cost: 3, discounted: false});
	});

	it("the discounted school pair FOLLOWS the phase", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.getLunarBoonsDiscountedCost(3, "N").discounted).toBe(false);
		state.setLunarPhase("new moon", {free: true});
		// New Moon = Enchantment + Necromancy.
		expect(state.getLunarBoonsDiscountedCost(3, "N").discounted).toBe(true);
		expect(state.getLunarBoonsDiscountedCost(3, "A").discounted).toBe(false);
		state.setLunarPhase("crescent moon", {free: true});
		// Crescent Moon = Illusion + Transmutation.
		expect(state.getLunarBoonsDiscountedCost(3, "I").discounted).toBe(true);
		expect(state.getLunarBoonsDiscountedCost(3, "T").discounted).toBe(true);
		expect(state.getLunarBoonsDiscountedCost(3, "N").discounted).toBe(false);
	});

	it("accepts a school NAME as well as a code", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		expect(state.getLunarBoonsDiscountedCost(2, "Necromancy").discounted).toBe(true);
		expect(state.getLunarBoonsDiscountedCost(2, "necromancy").discounted).toBe(true);
		expect(state.getLunarBoonsDiscountedCost(2, "Evocation").discounted).toBe(false);
	});

	it("never drops a cost below zero and never discounts a zero-cost metamagic", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.getLunarBoonsDiscountedCost(1, "A").cost).toBe(0);
		expect(state.getLunarBoonsDiscountedCost(0, "A")).toMatchObject({cost: 0, discounted: false});
	});

	it("stops discounting once the pool is exhausted, and resumes after a long rest", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		const max = state.getLunarBoonsResource().max;
		for (let i = 0; i < max; ++i) expect(state.consumeLunarBoon()).toBe(true);
		expect(state.consumeLunarBoon()).toBe(false);
		expect(state.getLunarBoonsDiscountedCost(3, "A")).toMatchObject({cost: 3, discounted: false});
		state.onLongRest();
		expect(state.getLunarBoonsDiscountedCost(3, "A").discounted).toBe(true);
	});

	it("does nothing below 6th level, and nothing for a non-Lunar sorcerer", () => {
		expect(makeLunarSorcerer(5, {phase: "Full Moon"}).getLunarBoonsDiscountedCost(3, "A").discounted).toBe(false);
		expect(makeDraconicSorcerer(20).getLunarBoonsDiscountedCost(3, "A").discounted).toBe(false);
	});

	it("flows through getMetamagicCost when the caller knows the spell's school", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		const key = Object.keys(CharacterSheetState.TGTT_METAMAGIC)
			.find(k => typeof CharacterSheetState.TGTT_METAMAGIC[k].cost === "number"
				&& CharacterSheetState.TGTT_METAMAGIC[k].cost > 0);
		const base = state.getMetamagicCost(key, 3);
		expect(state.getMetamagicCost(key, 3, {school: "N"})).toBe(base - 1);
		expect(state.getMetamagicCost(key, 3, {school: "A"})).toBe(base);
		// No school supplied → the undiscounted cost, so nothing silently changes
		// for the callers that predate Lunar Sorcery.
		expect(state.getMetamagicCost(key, 3)).toBe(base);
	});
});

// ===========================================================================
// Lunar Empowerment (14th) — phase-gated PASSIVES, not damage
// ===========================================================================

describe("Lunar Empowerment (14th)", () => {
	it("adds NO damage rider anywhere", () => {
		const calc = makeLunarSorcerer(20, {phase: "Full Moon"}).getFeatureCalculations();
		expect(calc.lunarEmpowermentDamage).toBeUndefined();
		expect(calc.lunarEmpowermentDamageDice).toBeUndefined();
	});

	it("Crescent Moon grants real necrotic and radiant resistance", () => {
		const state = makeLunarSorcerer(20, {phase: "Crescent Moon"});
		const resist = state.getResistances();
		expect(resist).toContain("necrotic");
		expect(resist).toContain("radiant");
	});

	it("that resistance is gone in any other phase", () => {
		const state = makeLunarSorcerer(20, {phase: "Crescent Moon"});
		expect(state.getResistances()).toContain("necrotic");
		state.setLunarPhase("full moon", {free: true});
		expect(state.getResistances()).not.toContain("necrotic");
		expect(state.getResistances()).not.toContain("radiant");
	});

	it("that resistance is gone below 14th level", () => {
		expect(makeLunarSorcerer(13, {phase: "Crescent Moon"}).getResistances()).not.toContain("necrotic");
		expect(makeLunarSorcerer(14, {phase: "Crescent Moon"}).getResistances()).toContain("necrotic");
	});

	it("New Moon grants real Stealth advantage, level- and phase-gated", () => {
		expect(makeLunarSorcerer(20, {phase: "New Moon"}).getSkillAdvantageState("stealth").advantage).toBe(true);
		expect(makeLunarSorcerer(13, {phase: "New Moon"}).getSkillAdvantageState("stealth").advantage).toBe(false);
		expect(makeLunarSorcerer(20, {phase: "Full Moon"}).getSkillAdvantageState("stealth").advantage).toBe(false);
	});

	it("reaching 14th level lights the passive up without a re-toggle", () => {
		const state = makeLunarSorcerer(13, {phase: "Crescent Moon"});
		expect(state.getResistances()).not.toContain("necrotic");
		state._data.classes[0].level = 14;
		state.applyClassFeatureEffects();
		state.getResources();
		expect(state.getResistances()).toContain("necrotic");
	});

	it("publishes the phase's empowerment text so the sheet can display it", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		expect(state.getFeatureCalculations().lunarEmpowermentText).toMatch(/Stealth/);
		state.setLunarPhase("crescent moon", {free: true});
		expect(state.getFeatureCalculations().lunarEmpowermentText).toMatch(/necrotic and radiant/);
	});

	it("Full Moon's moonlight is a real bonus-action toggle granting real advantage", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.getSkillAdvantageState("investigation").advantage).toBe(false);
		state.activateState("lunarMoonlight");
		expect(state.isStateTypeActive("lunarMoonlight")).toBe(true);
		// Changing phase must take the moonlight down with it.
		state.setLunarPhase("new moon", {free: true});
		expect(state.isStateTypeActive("lunarMoonlight")).toBe(false);
	});
});

// ===========================================================================
// Lunar Phenomenon (18th)
// ===========================================================================

describe("Lunar Phenomenon (18th)", () => {
	it("is unavailable below 18th level", () => {
		expect(makeLunarSorcerer(17).useLunarPhenomenon().success).toBe(false);
		expect(makeLunarSorcerer(17).getLunarPhenomenonResource()).toBeNull();
	});

	it("returns the CURRENT phase's payload and the real spell save DC", () => {
		const state = makeLunarSorcerer(20, {phase: "New Moon"});
		const res = state.useLunarPhenomenon();
		expect(res.success).toBe(true);
		expect(res.phenomenon.damageDice).toBe("3d10");
		expect(res.phenomenon.damageType).toBe("necrotic");
		expect(res.phenomenon.save).toBe("dex");
		expect(res.saveDc).toBe(state.getSpellSaveDC("Sorcerer"));
	});

	it("each phase has its own once-per-long-rest use", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.useLunarPhenomenon().sorceryPointsSpent).toBe(0);
		// Same phase again → falls back to the 5-sorcery-point route.
		const second = state.useLunarPhenomenon();
		expect(second.success).toBe(true);
		expect(second.sorceryPointsSpent).toBe(5);
		// A different phase still has its own free use.
		state.setLunarPhase("crescent moon", {free: true});
		expect(state.useLunarPhenomenon().sorceryPointsSpent).toBe(0);
	});

	it("the pool decrements as free uses are spent and refills on a long rest", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.getLunarPhenomenonResource().current).toBe(3);
		state.useLunarPhenomenon();
		expect(state.getLunarPhenomenonResource().current).toBe(2);
		state.onLongRest();
		expect(state.getLunarPhenomenonResource().current).toBe(3);
		expect(state.useLunarPhenomenon().sorceryPointsSpent).toBe(0);
	});

	it("refuses the sorcery-point route with fewer than 5 points, spending nothing", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		state.setSorceryPoints({current: 4, max: state.getSorceryPoints().max});
		const res = state.useLunarPhenomenon({spendSorceryPoints: true});
		expect(res.success).toBe(false);
		expect(state.getSorceryPoints().current).toBe(4);
		// The free use is untouched — a failed paid attempt must not burn it.
		expect(state.getLunarPhenomenonResource().current).toBe(3);
	});

	it("Crescent Moon teleports rather than dealing damage", () => {
		const res = makeLunarSorcerer(20, {phase: "Crescent Moon"}).useLunarPhenomenon();
		expect(res.phenomenon.teleportFeet).toBe(60);
		expect(res.phenomenon.damageDice).toBeUndefined();
	});
});

// ===========================================================================
// Calculations surface — what the sheet renders
// ===========================================================================

describe("calculations surface", () => {
	it("publishes nothing before the subclass is taken", () => {
		const calc = makeLunarSorcerer(2, {source: "XPHB"}).getFeatureCalculations();
		expect(calc.hasLunarEmbodiment).toBeFalsy();
		expect(calc.lunarPhase).toBeUndefined();
	});

	it("gates each feature at its own level", () => {
		const at = (level) => makeLunarSorcerer(level).getFeatureCalculations();
		expect(at(1).hasLunarEmbodiment).toBe(true);
		expect(at(1).hasLunarBoons).toBeUndefined();
		expect(at(6).hasLunarBoons).toBe(true);
		expect(at(6).hasWaxingAndWaning).toBe(true);
		expect(at(13).hasLunarEmpowerment).toBeUndefined();
		expect(at(14).hasLunarEmpowerment).toBe(true);
		expect(at(17).hasLunarPhenomenon).toBeUndefined();
		expect(at(18).hasLunarPhenomenon).toBe(true);
	});

	it("publishes the Lunar Spells row count, three per unlocked row", () => {
		const at = (level) => makeLunarSorcerer(level).getFeatureCalculations().lunarSpellsKnownCount;
		expect(at(1)).toBe(3);
		expect(at(2)).toBe(3);
		expect(at(3)).toBe(6);
		expect(at(5)).toBe(9);
		expect(at(7)).toBe(12);
		expect(at(9)).toBe(15);
		expect(at(20)).toBe(15);
	});

	it("every flag is backed by a real number or object the UI can render", () => {
		const calc = makeLunarSorcerer(20, {phase: "New Moon"}).getFeatureCalculations();
		expect(calc.lunarPhaseName).toBe("New Moon");
		expect(calc.lunarFreeSpell.name).toBe("Ray of Sickness");
		expect(calc.lunarBoonsSchoolNames).toEqual(["Enchantment", "Necromancy"]);
		expect(calc.lunarBoonsMax).toBe(6);
		expect(calc.lunarBoonsDiscount).toBe(1);
		expect(calc.waxingAndWaningCost).toBe(1);
		expect(calc.lunarPhenomenonSorceryPointCost).toBe(5);
		expect(calc.lunarPhenomenonSaveDc).toBeGreaterThan(0);
		expect(calc.lunarPhenomenonEffect.name).toMatch(/New Moon/);
		expect(calc.lunarPhaseOptions.map(o => o.name)).toEqual(["Full Moon", "New Moon", "Crescent Moon"]);
	});

	it("recomputes the phase-dependent numbers when the phase changes", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		expect(state.getFeatureCalculations().lunarFreeSpell.name).toBe("Shield");
		state.setLunarPhase("crescent moon", {free: true});
		expect(state.getFeatureCalculations().lunarFreeSpell.name).toBe("Color Spray");
		expect(state.getFeatureCalculations().lunarBoonsSchoolNames).toEqual(["Illusion", "Transmutation"]);
	});
});

// ===========================================================================
// Persistence
// ===========================================================================

describe("save / load", () => {
	it("round-trips the phase, the spent free casts and the spent boons", () => {
		const state = makeLunarSorcerer(20, {phase: "Full Moon"});
		state.setLunarPhase("new moon", {free: true});
		state.useLunarFreeCast("new moon");
		state.consumeLunarBoon();
		state.useLunarPhenomenon();

		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

		expect(restored.getLunarPhase().key).toBe("new moon");
		expect(restored.getLunarFreeCasts().find(c => c.phase === "new moon").available).toBe(false);
		expect(restored.getLunarBoonsResource().current).toBe(restored.getLunarBoonsResource().max - 1);
		expect(restored.getLunarPhenomenonResource().current).toBe(2);
	});

	it("a save that predates this feature still gets a phase (backward compatibility)", () => {
		const state = makeLunarSorcerer(20, {phase: "Crescent Moon"});
		const json = JSON.parse(JSON.stringify(state.toJson()));
		// Strip every trace of the phase machinery, as an older save would have.
		json.activeStates = (json.activeStates || []).filter(s => !String(s.stateTypeId).startsWith("lunar"));
		delete json.lunarEmbodiment;
		delete json.lunarPhenomenon;

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.getLunarPhase().key).toBe("crescent moon");
		expect(restored.getLunarFreeCasts().filter(c => c.available).length).toBe(3);
	});
});
