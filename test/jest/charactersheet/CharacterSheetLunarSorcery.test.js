/**
 * Lunar Sorcery (DSotDQ Sorcerer) — mechanical tests.
 *
 * The bar for this subclass is that the lunar phase is a REAL, recurring player
 * choice with derived consequences, not a note. So these tests assert values and
 * state transitions, never the mere presence of a `has*` flag:
 *
 *  - the phase is settable, exclusive, and survives into the active-state pipeline;
 *  - Lunar Empowerment's resistances / advantage actually reach `getResistances()`
 *    and `getAdvantageState()`;
 *  - Lunar Boons really shaves a sorcery point off a metamagic, only for the
 *    phase's schools, only while uses remain, and burns a use when spent;
 *  - Waxing and Waning really charges a sorcery point;
 *  - the free lunar cast is once per phase per long rest;
 *  - Lunar Phenomenon spends its free use before falling back to 5 points.
 *
 * Chassis: PHB (2014) sorcerer, where the subclass comes online at level 1 and
 * `getSorceryPointsMaxForClass` gives `level` points from level 2 (ZERO at 1).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const SUBCLASS = {name: "Lunar Sorcery", source: "DSotDQ"};

function makeLunarSorcerer (level = 1, {source = "PHB"} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({name: "Sorcerer", source, level, subclass: SUBCLASS});
	state.setAbilityBase("str", 8);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 16); // +3
	return state;
}

describe("Lunar Sorcery — gating", () => {
	it("is offline for a sorcerer without the subclass", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 20});
		expect(state.hasLunarSorcery()).toBe(false);
		expect(state.getLunarPhase()).toBeNull();
		expect(state.getLunarPhases()).toEqual([]);
		expect(state.getLunarFreeCastOptions()).toEqual([]);
		expect(state.getLunarPhenomenon()).toBeNull();
		expect(state.getMoonFireInfo()).toBeNull();
	});

	it("comes online at level 1 on the PHB chassis", () => {
		const state = makeLunarSorcerer(1);
		expect(state.getLunarSubclassLevel()).toBe(1);
		expect(state.hasLunarSorcery()).toBe(true);
		expect(state.getLunarSorceryLevel()).toBe(1);
	});

	it("is pinned to level 3 on the XPHB chassis", () => {
		const early = makeLunarSorcerer(2, {source: "XPHB"});
		expect(early.getLunarSubclassLevel()).toBe(3);
		expect(early.hasLunarSorcery()).toBe(false);

		const online = makeLunarSorcerer(3, {source: "XPHB"});
		expect(online.hasLunarSorcery()).toBe(true);
		expect(online.getLunarPhase()).toBe("full");
	});
});

describe("Lunar Embodiment — the phase choice", () => {
	it("defaults to Full Moon and offers all three phases", () => {
		const state = makeLunarSorcerer(1);
		expect(state.getLunarPhase()).toBe("full");
		expect(state.getLunarPhases().map(p => p.id)).toEqual(["full", "new", "crescent"]);
	});

	it("changes phase and reports the previous one", () => {
		const state = makeLunarSorcerer(1);
		const res = state.chooseLunarPhaseOnRest("crescent");
		expect(res).toMatchObject({ok: true, phase: "crescent", previousPhase: "full", spent: 0});
		expect(state.getLunarPhase()).toBe("crescent");
	});

	it("accepts a phase name as well as an id, and rejects nonsense", () => {
		const state = makeLunarSorcerer(1);
		expect(state.setLunarPhase("New Moon").ok).toBe(true);
		expect(state.getLunarPhase()).toBe("new");
		expect(state.setLunarPhase("gibbous")).toMatchObject({ok: false});
		expect(state.getLunarPhase()).toBe("new");
	});

	it("keeps exactly one phase active-state lit, and swaps on change", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("new");
		const lit = CharacterSheetState.LUNAR_PHASE_STATE_IDS.filter(id => state.isStateTypeActive(id));
		expect(lit).toEqual(["lunarPhaseNew"]);

		state.setLunarPhase("crescent");
		expect(CharacterSheetState.LUNAR_PHASE_STATE_IDS.filter(id => state.isStateTypeActive(id))).toEqual(["lunarPhaseCrescent"]);
	});

	it("exposes the phase and its schools through getFeatureCalculations", () => {
		const state = makeLunarSorcerer(6);
		state.setLunarPhase("new");
		const calc = state.getFeatureCalculations();
		expect(calc.lunarPhase).toBe("new");
		expect(calc.lunarPhaseName).toBe("New Moon");
		expect(calc.lunarPhaseSchools).toEqual(["E", "N"]);
	});
});

describe("Lunar Spells table", () => {
	it("unlocks rows by sorcerer level", () => {
		expect(makeLunarSorcerer(1).getLunarSpellTable().map(r => r.level)).toEqual([1]);
		expect(makeLunarSorcerer(4).getLunarSpellTable().map(r => r.level)).toEqual([1, 3]);
		expect(makeLunarSorcerer(9).getLunarSpellTable().map(r => r.level)).toEqual([1, 3, 5, 7, 9]);
	});

	it("returns one column per phase", () => {
		const state = makeLunarSorcerer(9);
		expect(state.getLunarSpellsForPhase("full")).toEqual(["Shield", "Lesser Restoration", "Dispel Magic", "Death Ward", "Rary's Telepathic Bond"]);
		expect(state.getLunarSpellsForPhase("new")).toEqual(["Ray of Sickness", "Blindness/Deafness", "Vampiric Touch", "Confusion", "Hold Monster"]);
		expect(state.getLunarSpellsForPhase("crescent")).toEqual(["Color Spray", "Alter Self", "Phantom Steed", "Hallucinatory Terrain", "Mislead"]);
	});
});

describe("Lunar Embodiment — the free lunar cast", () => {
	it("offers only the current phase's spell before level 6", () => {
		const state = makeLunarSorcerer(5);
		const opts = state.getLunarFreeCastOptions();
		expect(opts).toHaveLength(1);
		expect(opts[0]).toMatchObject({phase: "full", spell: "Shield", available: true});
	});

	it("offers all three from level 6, but only the current phase is castable", () => {
		const state = makeLunarSorcerer(6);
		const opts = state.getLunarFreeCastOptions();
		expect(opts).toHaveLength(3);
		expect(opts.filter(o => o.available).map(o => o.phase)).toEqual(["full"]);
		expect(state.castLunarFreeSpell("Ray of Sickness")).toMatchObject({ok: false});
	});

	it("burns the use, and only that phase's use", () => {
		const state = makeLunarSorcerer(6);
		expect(state.castLunarFreeSpell("Shield")).toMatchObject({ok: true, spell: "Shield", slotSpent: false});
		expect(state.castLunarFreeSpell("Shield")).toMatchObject({ok: false});

		state.setLunarPhase("new");
		expect(state.castLunarFreeSpell("Ray of Sickness")).toMatchObject({ok: true, phase: "new"});
	});

	it("recovers every free cast on a long rest", () => {
		const state = makeLunarSorcerer(6);
		state.castLunarFreeSpell("Shield");
		expect(state.getLunarFreeCastOptions().find(o => o.phase === "full").used).toBe(true);
		state.onLongRest();
		expect(state.getLunarFreeCastOptions().every(o => !o.used)).toBe(true);
	});
});

describe("Moon Fire", () => {
	it("grants sacred flame with a two-target split", () => {
		const state = makeLunarSorcerer(1);
		expect(state.getMoonFireInfo()).toMatchObject({spell: "Sacred Flame", maxTargets: 2, targetSeparation: 5});
		const calc = state.getFeatureCalculations();
		expect(calc.moonFireTargetCount).toBe(2);
		expect(calc.moonFireTargetSeparation).toBe(5);
	});
});

describe("Waxing and Waning (6)", () => {
	it("is refused below level 6", () => {
		const state = makeLunarSorcerer(5);
		expect(state.changeLunarPhase("new")).toMatchObject({ok: false});
		expect(state.getLunarPhase()).toBe("full");
	});

	it("spends exactly one sorcery point and costs a bonus action", () => {
		const state = makeLunarSorcerer(6);
		const before = state.getSorceryPoints().current;
		expect(before).toBe(6);
		const res = state.changeLunarPhase("new");
		expect(res).toMatchObject({ok: true, phase: "new", spent: 1, action: "bonus"});
		expect(state.getSorceryPoints().current).toBe(before - 1);
	});

	it("refuses without the point, leaving the phase alone", () => {
		const state = makeLunarSorcerer(6);
		state.setSorceryPoints(0);
		expect(state.changeLunarPhase("new")).toMatchObject({ok: false});
		expect(state.getLunarPhase()).toBe("full");
	});

	it("refuses a no-op shift so the point is never wasted", () => {
		const state = makeLunarSorcerer(6);
		const before = state.getSorceryPoints().current;
		expect(state.changeLunarPhase("full")).toMatchObject({ok: false});
		expect(state.getSorceryPoints().current).toBe(before);
	});
});

describe("Lunar Boons (6)", () => {
	it("has no pool before level 6", () => {
		const state = makeLunarSorcerer(5);
		expect(state.getLunarBoonUses()).toEqual({current: 0, max: 0});
		expect(state.getLunarBoonDiscount("A").applies).toBe(false);
	});

	it("scales its pool with the proficiency bonus", () => {
		expect(makeLunarSorcerer(6).getLunarBoonUses().max).toBe(3);
		expect(makeLunarSorcerer(13).getLunarBoonUses().max).toBe(5);
		expect(makeLunarSorcerer(20).getLunarBoonUses().max).toBe(6);
	});

	it("discounts only the current phase's schools", () => {
		const state = makeLunarSorcerer(6); // Full Moon: abjuration, divination
		expect(state.getLunarBoonDiscount("A")).toMatchObject({applies: true, reduction: 1});
		expect(state.getLunarBoonDiscount("divination")).toMatchObject({applies: true, reduction: 1});
		expect(state.getLunarBoonDiscount("N").applies).toBe(false);

		state.setLunarPhase("new"); // enchantment, necromancy
		expect(state.getLunarBoonDiscount("N")).toMatchObject({applies: true, reduction: 1});
		expect(state.getLunarBoonDiscount("A").applies).toBe(false);

		state.setLunarPhase("crescent"); // illusion, transmutation
		expect(state.getLunarBoonDiscount("T")).toMatchObject({applies: true, reduction: 1});
		expect(state.getLunarBoonDiscount("I")).toMatchObject({applies: true, reduction: 1});
		expect(state.getLunarBoonDiscount("E").applies).toBe(false);
	});

	it("stops discounting once the pool is empty, and recovers on a long rest", () => {
		const state = makeLunarSorcerer(6);
		expect(state.getLunarBoonUses().max).toBe(3);
		for (let i = 0; i < 3; ++i) expect(state.consumeLunarBoon("A")).toBe(true);
		expect(state.getLunarBoonUses().current).toBe(0);
		expect(state.consumeLunarBoon("A")).toBe(false);
		expect(state.getLunarBoonDiscount("A")).toMatchObject({applies: false});

		state.onLongRest();
		expect(state.getLunarBoonUses().current).toBe(3);
		expect(state.getLunarBoonDiscount("A").applies).toBe(true);
	});

	it("never consumes a use for a school it does not discount", () => {
		const state = makeLunarSorcerer(6);
		expect(state.consumeLunarBoon("N")).toBe(false);
		expect(state.getLunarBoonUses().current).toBe(3);
	});

	it("reduces the reported metamagic cost for a phase-school spell", () => {
		const state = makeLunarSorcerer(6);
		// Metamagic is "known" through Optional Feature entries, and PHB/XPHB-sourced
		// ones are filtered out of `getKnownMetamagicKeys` on purpose — so the fixture
		// has to use a non-core source.
		state.addFeature({name: "Twinned Spell", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["MM"]});
		expect(state.getKnownMetamagicKeys()).toContain("twinned");

		const baseline = state.getCastableActiveMetamagics({slotLevel: 1}).find(m => m.key === "twinned");
		expect(baseline.cost).toBeGreaterThan(0);

		const discounted = state.getCastableActiveMetamagics({slotLevel: 1, spellData: {school: "A"}}).find(m => m.key === "twinned");
		expect(discounted.baseCost).toBe(baseline.cost);
		expect(discounted.cost).toBe(baseline.cost - 1);
		expect(discounted.lunarBoonApplied).toBe(true);
		expect(discounted.lunarBoonSchool).toBe("A");

		const unrelated = state.getCastableActiveMetamagics({slotLevel: 1, spellData: {school: "N"}}).find(m => m.key === "twinned");
		expect(unrelated.cost).toBe(baseline.cost);
		expect(unrelated.lunarBoonApplied).toBe(false);
	});

	it("stops discounting the metamagic once the boons are spent", () => {
		const state = makeLunarSorcerer(6);
		state.addFeature({name: "Twinned Spell", source: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["MM"]});
		const costFor = school => state.getCastableActiveMetamagics({slotLevel: 1, spellData: {school}}).find(m => m.key === "twinned").cost;
		const base = state.getCastableActiveMetamagics({slotLevel: 1}).find(m => m.key === "twinned").cost;

		expect(costFor("A")).toBe(base - 1);
		while (state.getLunarBoonUses().current > 0) state.consumeLunarBoon("A");
		expect(costFor("A")).toBe(base);
	});
});

describe("Lunar Empowerment (14)", () => {
	it("produces no phase effects below 14", () => {
		const state = makeLunarSorcerer(13);
		state.setLunarPhase("crescent");
		expect(state.getResistances()).not.toContain("necrotic");
	});

	it("Crescent Moon grants necrotic and radiant resistance", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("crescent");
		const res = state.getResistances();
		expect(res).toContain("necrotic");
		expect(res).toContain("radiant");
	});

	it("drops the resistance the moment the phase changes", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("crescent");
		expect(state.getResistances()).toContain("radiant");
		state.setLunarPhase("full");
		expect(state.getResistances()).not.toContain("radiant");
	});

	it("New Moon grants Stealth advantage", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("new");
		expect(state.getAdvantageState("skill:stealth").advantage).toBe(true);
		expect(state.getAdvantageState("skill:perception").advantage).toBe(false);
	});

	it("New Moon's disadvantage-against-you is gated on being entirely in darkness", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("new");
		const hasDisadvantageAgainst = () => (state.getActiveStateEffects() || [])
			.some(e => e.type === "disadvantage" && e.target === "attacksAgainst");

		expect(hasDisadvantageAgainst()).toBe(false);
		state.setLunarInDarkness(true);
		expect(state.isLunarInDarkness()).toBe(true);
		expect(hasDisadvantageAgainst()).toBe(true);
		state.setLunarInDarkness(false);
		expect(hasDisadvantageAgainst()).toBe(false);
	});

	it("Full Moon's Investigation/Perception advantage is gated on the shed moonlight", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("full");
		expect(state.getAdvantageState("skill:perception").advantage).toBe(false);

		const lit = state.toggleLunarMoonlight(true);
		expect(lit).toMatchObject({ok: true, shed: true, brightRadius: 10, dimRadius: 20, action: "bonus"});
		expect(state.getAdvantageState("skill:perception").advantage).toBe(true);
		expect(state.getAdvantageState("skill:investigation").advantage).toBe(true);

		state.toggleLunarMoonlight(false);
		expect(state.getAdvantageState("skill:perception").advantage).toBe(false);
	});

	it("refuses to shed moonlight outside Full Moon, and douses it on a phase change", () => {
		const state = makeLunarSorcerer(14);
		state.toggleLunarMoonlight(true);
		expect(state.isLunarMoonlightShed()).toBe(true);
		state.setLunarPhase("new");
		expect(state.isLunarMoonlightShed()).toBe(false);
		expect(state.toggleLunarMoonlight(true)).toMatchObject({ok: false});
	});

	it("refuses to shed moonlight below level 14", () => {
		const state = makeLunarSorcerer(13);
		expect(state.toggleLunarMoonlight(true)).toMatchObject({ok: false});
		expect(state.isLunarMoonlightShed()).toBe(false);
	});

	it("summarises the current phase's empowerment in getFeatureCalculations", () => {
		const state = makeLunarSorcerer(14);
		state.setLunarPhase("crescent");
		expect(state.getFeatureCalculations().lunarEmpowermentResistances).toEqual(["necrotic", "radiant"]);
		state.setLunarPhase("full");
		expect(state.getFeatureCalculations().lunarMoonlightRadius).toBe(10);
	});
});

describe("Lunar Phenomenon (18)", () => {
	it("is absent below level 18", () => {
		expect(makeLunarSorcerer(17).getLunarPhenomenon()).toBeNull();
	});

	it("reports the current phase's burst, with a CHA save DC", () => {
		const state = makeLunarSorcerer(18);
		const full = state.getLunarPhenomenon();
		expect(full).toMatchObject({phase: "full", range: 30, saveAbility: "con", healing: "3d8", action: "bonus", usesMax: 1});
		expect(full.saveDc).toBe(state.getSpellSaveDc());

		state.setLunarPhase("new");
		expect(state.getLunarPhenomenon()).toMatchObject({damage: "3d10", damageType: "necrotic", saveAbility: "dex"});

		state.setLunarPhase("crescent");
		const crescent = state.getLunarPhenomenon();
		expect(crescent).toMatchObject({teleport: 60, allyRange: 5});
		expect(crescent.saveDc).toBeNull();
	});

	it("spends the free use first, then 5 sorcery points", () => {
		const state = makeLunarSorcerer(18);
		const sp = state.getSorceryPoints().current;

		expect(state.useLunarPhenomenon()).toMatchObject({ok: true, usedFreeUse: true, spentSorceryPoints: 0});
		expect(state.getSorceryPoints().current).toBe(sp);
		expect(state.getLunarPhenomenon().usesRemaining).toBe(0);

		expect(state.useLunarPhenomenon()).toMatchObject({ok: true, usedFreeUse: false, spentSorceryPoints: 5});
		expect(state.getSorceryPoints().current).toBe(sp - 5);
	});

	it("can be forced onto points while a free use remains", () => {
		const state = makeLunarSorcerer(18);
		const sp = state.getSorceryPoints().current;
		expect(state.useLunarPhenomenon({forcePoints: true})).toMatchObject({ok: true, spentSorceryPoints: 5});
		expect(state.getSorceryPoints().current).toBe(sp - 5);
		expect(state.getLunarPhenomenon().usesRemaining).toBe(1);
	});

	it("refuses when neither the use nor the points are there", () => {
		const state = makeLunarSorcerer(18);
		state.useLunarPhenomenon();
		state.setSorceryPoints(4);
		expect(state.getLunarPhenomenon().available).toBe(false);
		expect(state.useLunarPhenomenon()).toMatchObject({ok: false});
	});

	it("recovers the free use on a long rest", () => {
		const state = makeLunarSorcerer(18);
		state.useLunarPhenomenon();
		expect(state.getLunarPhenomenon().usesRemaining).toBe(0);
		state.onLongRest();
		expect(state.getLunarPhenomenon().usesRemaining).toBe(1);
	});
});

describe("Lunar Sorcery — persistence", () => {
	it("round-trips the phase and its derived effects through save/load", () => {
		const state = makeLunarSorcerer(18);
		state.setLunarPhase("crescent");
		state.castLunarFreeSpell("Color Spray");
		state.consumeLunarBoon("I");

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

		expect(loaded.getLunarPhase()).toBe("crescent");
		expect(loaded.getResistances()).toContain("necrotic");
		expect(loaded.getLunarFreeCastOptions().find(o => o.phase === "crescent").used).toBe(true);
		expect(loaded.getLunarBoonUses().current).toBe(state.getLunarBoonUses().current);
	});
});
