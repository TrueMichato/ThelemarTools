/**
 * Spellfire Sorcery Sorcerer (FRHoF) — mechanical-effect coverage.
 *
 * Every test asserts an OBSERVABLE consequence — Temp HP actually set, Sorcery Points
 * actually refilled, Hit Point Dice actually expended, a 60 ft fly speed actually reaching
 * getSpeed(), damage actually reduced — never the mere presence of a `hasXxx` flag.
 *
 * The subclass is a 2024 (XPHB chassis) Sorcerer, so its features arrive at L3 and its
 * Sorcery Point pool follows the PHB/XPHB ladder (0 at L1, `level` from L2).
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const SPELLFIRE_FEATURES = [
	{level: 3, name: "Spellfire Sorcery", description: "Your innate power stems from the source of magic itself: the Weave."},
	{level: 3, name: "Spellfire Burst", description: "When you spend at least 1 Sorcery Point as part of the Magic action or a Bonus Action, you can unleash Bolstering Flames or Radiant Fire."},
	{level: 3, name: "Radiant Fire", description: "One creature you can see within 30 feet of yourself takes 1d4 Fire or Radiant damage (your choice)."},
	{level: 3, name: "Bolstering Flames", description: "You or one creature you can see within 30 feet of yourself gains Temporary Hit Points equal to 1d4 plus your Charisma modifier."},
	{level: 6, name: "Absorb Spells", description: "You always have Counterspell prepared. Whenever a target fails the saving throw against a Counterspell you cast, you regain 1d4 Sorcery Points."},
	{level: 14, name: "Honed Spellfire", description: "Your Spellfire Burst improves. You add your Sorcerer level to the Temporary Hit Points, and Radiant Fire deals 1d8 damage."},
	// Full published prose ON PURPOSE: the "spend 5 Sorcery Points ... to restore" clause is the
	// exact text the generic parser mis-reads as an activation cost (CS-BUG-095). Paraphrasing it
	// away makes the regression below inert — the mis-parse has nothing to bite on. See line ~254.
	{level: 18, name: "Crown of Spellfire", description: "When you use Innate Sorcery, you can alter it and infuse yourself with the essence of spellfire, gaining Flight, Spell Avoidance, and Burning Life Force while this use of Innate Sorcery is active. Once you use this feature to alter Innate Sorcery, you can't use it again until you finish a Long Rest unless you spend 5 Sorcery Points (no action required) to restore your use of it."},
];

/**
 * Build a Spellfire sorcerer at `level`, carrying exactly the subclass features a sorcerer
 * of that level would have.
 * @param {number} level
 * @param {object} [opts]
 * @param {number} [opts.cha=18]
 */
function makeSpellfireSorcerer (level = 20, {cha = 18} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source: "XPHB",
		level,
		subclass: {name: "Spellfire Sorcery", shortName: "Spellfire", source: "FRHoF"},
	}];
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(60, 60);

	for (const f of SPELLFIRE_FEATURES) {
		if (level < f.level) continue;
		state.addFeature({...f, source: "FRHoF"});
	}
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

/** A non-Spellfire sorcerer, as the negative control. */
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
	return state;
}

describe("Spellfire Sorcery — calculation gating", () => {
	it("surfaces the L3 features at L3 and not before", () => {
		const l1 = makeSpellfireSorcerer(1);
		const c1 = l1.getFeatureCalculations();
		expect(c1.hasSpellfireBurst).toBeFalsy();
		expect(c1.hasRadiantFire).toBeFalsy();

		const l3 = makeSpellfireSorcerer(3);
		const c3 = l3.getFeatureCalculations();
		expect(c3.hasSpellfireBurst).toBe(true);
		expect(c3.hasRadiantFire).toBe(true);
		expect(c3.hasBolsteringFlames).toBe(true);
		expect(c3.spellfireBurstUsesPerTurn).toBe(1);
		// Not yet: Absorb Spells (6), Honed (14), Crown (18).
		expect(c3.hasAbsorbSpells).toBeFalsy();
		expect(c3.hasHonedSpellfire).toBeFalsy();
		expect(c3.hasCrownOfSpellfire).toBeFalsy();
	});

	it("Radiant Fire scales 1d4 → 1d8 exactly at L14 (Honed Spellfire)", () => {
		expect(makeSpellfireSorcerer(13).getFeatureCalculations().radiantFireDamage).toBe("1d4");
		expect(makeSpellfireSorcerer(14).getFeatureCalculations().radiantFireDamage).toBe("1d8");
	});

	it("Bolstering Flames bonus is CHA mod, then CHA mod + Sorcerer level from L14", () => {
		// CHA 18 → +4.
		expect(makeSpellfireSorcerer(3).getFeatureCalculations().bolsteringFlamesTempHpBonus).toBe(4);
		expect(makeSpellfireSorcerer(13).getFeatureCalculations().bolsteringFlamesTempHpBonus).toBe(4);
		// L14: +4 CHA + 14 level = 18.
		expect(makeSpellfireSorcerer(14).getFeatureCalculations().bolsteringFlamesTempHpBonus).toBe(18);
		expect(makeSpellfireSorcerer(20).getFeatureCalculations().bolsteringFlamesTempHpBonus).toBe(24);
	});

	it("Absorb Spells (6), Crown of Spellfire (18) gate on level", () => {
		expect(makeSpellfireSorcerer(6).getFeatureCalculations().hasAbsorbSpells).toBe(true);
		const c18 = makeSpellfireSorcerer(18).getFeatureCalculations();
		expect(c18.hasCrownOfSpellfire).toBe(true);
		expect(c18.crownOfSpellfireFlySpeed).toBe(60);
		expect(c18.crownOfSpellfireRestoreCost).toBe(5);
		expect(c18.crownBurningLifeForceMaxDice).toBe(4); // CHA 18 → +4
	});

	it("does not leak onto a different subclass", () => {
		const c = makeDraconicSorcerer(20).getFeatureCalculations();
		expect(c.hasSpellfireBurst).toBeFalsy();
		expect(c.hasBolsteringFlames).toBeFalsy();
		expect(c.hasCrownOfSpellfire).toBeFalsy();
	});
});

describe("Bolstering Flames — real Temp HP mutation", () => {
	it("sets Temp HP = die + CHA mod on yourself (the reading, not the calc)", () => {
		const state = makeSpellfireSorcerer(3, {cha: 18}); // +4
		expect(state.getTempHp()).toBe(0);
		const res = state.useBolsteringFlames({target: "self", roll: 3});
		expect(res.ok).toBe(true);
		expect(res.tempHp).toBe(7); // 3 + 4
		expect(res.applied).toBe(true);
		// The consumer: Temp HP actually on the sheet.
		expect(state.getTempHp()).toBe(7);
	});

	it("adds Sorcerer level at L14 (Honed Spellfire) — pinned on getTempHp()", () => {
		const state = makeSpellfireSorcerer(14, {cha: 18}); // +4 + 14
		state.useBolsteringFlames({target: "self", roll: 2});
		expect(state.getTempHp()).toBe(2 + 4 + 14);
	});

	it("does not mutate your own Temp HP when the target is an ally", () => {
		const state = makeSpellfireSorcerer(3);
		const res = state.useBolsteringFlames({target: "ally", roll: 4});
		expect(res.ok).toBe(true);
		expect(res.applied).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it("refuses without the feature", () => {
		expect(makeDraconicSorcerer(20).useBolsteringFlames().ok).toBe(false);
	});
});

describe("Radiant Fire — damage roll & type choice", () => {
	it("rolls the live die and honours the fire/radiant choice", () => {
		const state = makeSpellfireSorcerer(3);
		const fire = state.useRadiantFire({damageType: "fire", roll: 3});
		expect(fire.ok).toBe(true);
		expect(fire.total).toBe(3);
		expect(fire.damage).toBe("1d4");
		expect(fire.damageType).toBe("fire");
		const rad = state.useRadiantFire({damageType: "radiant", roll: 4});
		expect(rad.damageType).toBe("radiant");
		expect(rad.range).toBe(30);
	});

	it("uses 1d8 at L14", () => {
		expect(makeSpellfireSorcerer(14).useRadiantFire({roll: 5}).damage).toBe("1d8");
	});

	it("falls back to a legal damage type when given garbage", () => {
		expect(makeSpellfireSorcerer(3).useRadiantFire({damageType: "necrotic", roll: 1}).damageType).toBe("fire");
	});
});

describe("Spellfire Burst — trigger & once-per-turn gate", () => {
	it("requires spending at least one Sorcery Point", () => {
		const state = makeSpellfireSorcerer(5);
		const res = state.useSpellfireBurst({effect: "radiant", spentSorceryPoint: false, effectOpts: {roll: 2}});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/Sorcery Point/i);
	});

	it("dispatches to Bolstering Flames and marks the turn used", () => {
		const state = makeSpellfireSorcerer(5, {cha: 18});
		const first = state.useSpellfireBurst({effect: "bolstering", effectOpts: {target: "self", roll: 3}});
		expect(first.ok).toBe(true);
		expect(state.getTempHp()).toBe(7); // 3 + 4 — the real mutation flowed through
		// Second use this turn is refused.
		const second = state.useSpellfireBurst({effect: "radiant", effectOpts: {roll: 2}});
		expect(second.ok).toBe(false);
		expect(second.error).toMatch(/already used/i);
		// New turn → allowed again.
		state.resetSpellfireBurstTurn();
		expect(state.useSpellfireBurst({effect: "radiant", effectOpts: {roll: 2}}).ok).toBe(true);
	});
});

describe("Absorb Spells — real Sorcery Point refill", () => {
	it("regains rolled Sorcery Points, clamped to max (the reading)", () => {
		const state = makeSpellfireSorcerer(6); // pool max 6 on XPHB ladder
		expect(state.getSorceryPoints().max).toBe(6);
		state.useSorceryPoint(5); // current 1
		expect(state.getSorceryPoints().current).toBe(1);
		const res = state.regainSorceryPointsFromAbsorbSpells({roll: 3});
		expect(res.ok).toBe(true);
		expect(res.regained).toBe(3);
		expect(state.getSorceryPoints().current).toBe(4); // 1 + 3
	});

	it("never overfills past max", () => {
		const state = makeSpellfireSorcerer(6);
		state.useSorceryPoint(1); // current 5
		const res = state.regainSorceryPointsFromAbsorbSpells({roll: 4});
		expect(state.getSorceryPoints().current).toBe(6);
		expect(res.regained).toBe(1);
	});

	it("refuses below L6", () => {
		expect(makeSpellfireSorcerer(5).regainSorceryPointsFromAbsorbSpells({roll: 2}).ok).toBe(false);
	});
});

describe("Crown of Spellfire — active state, fly speed, restore cost", () => {
	it("grants a 60 ft fly speed to getSpeed() while active", () => {
		const state = makeSpellfireSorcerer(18);
		expect(state.getSpeed("fly") || 0).toBeLessThan(60);
		const id = state.activateState("crownOfSpellfire");
		expect(id).toBeTruthy();
		expect(state.getSpeed("fly")).toBe(60);
		state.deactivateState("crownOfSpellfire");
		expect(state.getSpeed("fly") || 0).toBeLessThan(60);
	});

	it("restore spends exactly 5 Sorcery Points and activates the crown", () => {
		const state = makeSpellfireSorcerer(18);
		const before = state.getSorceryPoints().current;
		const res = state.restoreCrownOfSpellfire();
		expect(res.ok).toBe(true);
		expect(res.cost).toBe(5);
		expect(state.getSorceryPoints().current).toBe(before - 5);
		expect(state.isStateTypeActive("crownOfSpellfire")).toBe(true);
	});

	it("restore fails when Sorcery Points are short", () => {
		const state = makeSpellfireSorcerer(18);
		state.setSorceryPoints({current: 4, max: 18});
		const res = state.restoreCrownOfSpellfire();
		expect(res.ok).toBe(false);
		expect(state.getSorceryPoints().current).toBe(4); // unspent
	});

	// CS-BUG-095 regression. Crown's published prose (see the fixture at line ~29, kept
	// verbatim ON PURPOSE) says "spend 5 Sorcery Points ... to restore your use of it" — a
	// RESTORE cost, handled by restoreCrownOfSpellfire(). The generic parser instead read it
	// as an *activation* cost, so getActivatableFeatures() bound the Crown row to the shared
	// Sorcery-Point / Innate-Sorcery spend pool at cost 5 (matchedBy "name", sorceryPointCost
	// 5). The load-bearing, render-consumed reading is THEREFORE which resource the row binds:
	// broken → "Sorcery Points" (the spend pool the Activate button charges against, disabled
	// when a 2-use Innate Sorcery pool is present at 2 < 5); fixed → at most Crown's OWN
	// 1/Long-Rest use pool ("Crown of Spellfire"). This assertion is asserted FIRST so it is
	// never masked by a leading accessor failure. The accessor checks below corroborate but
	// are not the pin — a broken parse changes both, so the row-binding is the discriminator.
	it("binds Crown's row to its own use pool, never the shared Sorcery-Point spend pool", () => {
		const state = makeSpellfireSorcerer(18);

		// --- render-consumed reading (the pin) ---
		const crownRow = state.getActivatableFeatures().find(a => a.stateTypeId === "crownOfSpellfire");
		expect(crownRow).toBeTruthy();
		const boundName = crownRow.resource ? crownRow.resource.name : null;
		// Must NOT be the Sorcery-Point / Innate-Sorcery spend pool the restore cost mis-bound.
		expect(/sorcer/i.test(boundName || "")).toBe(false);
		// A bound resource is allowed, but only Crown's own 1/Long-Rest use pool.
		expect(boundName == null || /crown of spellfire/i.test(boundName)).toBe(true);
		// And it must be affordable, so the rendered Activate button stays actionable.
		const cost = crownRow.resource ? (crownRow.resource.cost || 1) : 0;
		expect(crownRow.resource == null || crownRow.resource.current >= cost).toBe(true);

		// --- accessor corroboration (not the pin) ---
		const crownFeature = state._data.features.find(f => f.name === "Crown of Spellfire");
		const info = CharacterSheetState.detectActivatableFeature(crownFeature);
		expect(info.stateTypeId).toBe("crownOfSpellfire");
		expect(info.isToggle).toBe(true);
		expect(info.resourceCost).toBe(0);
		// The restore cost must NOT leak in as an activation resource cost.
		expect(info.sorceryPointCost == null).toBe(true);
	});
});

describe("Burning Life Force — real Hit Point Dice expenditure", () => {
	it("expends dice from the pool (not healing) and reduces damage by the rolled total", () => {
		const state = makeSpellfireSorcerer(18, {cha: 18}); // cap = +4 dice
		// Give a known d6 hit-dice pool.
		state._data.hitDice = {d6: {current: 18, max: 18}};
		state.activateState("crownOfSpellfire");
		const hpBefore = state.getHp().current;
		const res = state.useBurningLifeForce({diceToSpend: 3, roll: 11, incomingDamage: 30});
		expect(res.ok).toBe(true);
		expect(res.diceSpent).toBe(3);
		expect(res.reduction).toBe(11);
		// The reading: dice actually left the pool, and it did NOT heal.
		expect(state.getHitDiceByType().d6.current).toBe(15);
		expect(state.getHp().current).toBe(hpBefore);
	});

	it("clamps the reduction to the incoming damage", () => {
		const state = makeSpellfireSorcerer(18);
		state._data.hitDice = {d6: {current: 18, max: 18}};
		state.activateState("crownOfSpellfire");
		const res = state.useBurningLifeForce({diceToSpend: 2, roll: 40, incomingDamage: 7});
		expect(res.reduction).toBe(7);
	});

	it("caps dice at the CHA modifier", () => {
		const state = makeSpellfireSorcerer(18, {cha: 18}); // cap 4
		state._data.hitDice = {d6: {current: 18, max: 18}};
		state.activateState("crownOfSpellfire");
		const res = state.useBurningLifeForce({diceToSpend: 99, roll: 5});
		expect(res.diceSpent).toBe(4);
	});

	it("refuses while the crown is inactive", () => {
		const state = makeSpellfireSorcerer(18);
		state._data.hitDice = {d6: {current: 18, max: 18}};
		expect(state.useBurningLifeForce({diceToSpend: 1, roll: 3}).ok).toBe(false);
	});
});

describe("Spell Avoidance — outcome rewrite while active", () => {
	it("takes no damage on a success and half on a failure while active", () => {
		const state = makeSpellfireSorcerer(18);
		state.activateState("crownOfSpellfire");
		expect(state.resolveSpellAvoidance({saveSuccess: true, damage: 40}).damageTaken).toBe(0);
		expect(state.resolveSpellAvoidance({saveSuccess: false, damage: 40}).damageTaken).toBe(20);
	});

	it("applies the normal save-for-half rule while inactive", () => {
		const state = makeSpellfireSorcerer(18);
		expect(state.resolveSpellAvoidance({saveSuccess: true, damage: 40}).damageTaken).toBe(20);
		expect(state.resolveSpellAvoidance({saveSuccess: false, damage: 40}).damageTaken).toBe(40);
	});
});
