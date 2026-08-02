import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const SpellGrantParser = globalThis.SpellGrantParser;

const BIRD_CALLER_TEXT = "Also at 3rd level, you learn to identify common birds by their calls, and you have advantage on Wisdom ({@skill Animal Handling}) checks when interacting with any beast that has an innate flying speed. In addition, you gain the ability to cast the {@spell animal messenger} spell, but only as a ritual and only targeting a beast that has an innate flying speed.";

function makeSteelHawk (level, {str = 16, source = "GriffonsSaddlebag2"} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("wis", 12);
	state.addClass({
		name: "Fighter",
		source: "PHB",
		level,
		subclass: {name: "Steel Hawk", shortName: "Steel Hawk", source},
	});
	return state;
}

function setFighterLevel (state, level) {
	state._data.classes.find(c => c.name === "Fighter").level = level;
}

// ===========================================================================
// Gating
// ===========================================================================
describe("Fighter: Steel Hawk (TGS2) — gating", () => {
	it("is level-gated to Fighter 3", () => {
		expect(makeSteelHawk(2).getFeatureCalculations().hasSteelHawk).toBeUndefined();
		expect(makeSteelHawk(3).getFeatureCalculations().hasSteelHawk).toBe(true);
	});

	it("is SOURCE-gated: a same-named subclass from another book does not qualify", () => {
		const impostor = makeSteelHawk(10, {source: "SomeOtherBrew"});
		expect(impostor.getFeatureCalculations().hasSteelHawk).toBeUndefined();
		expect(impostor.getLaunchResource()).toBeNull();
	});

	it("exposes a static identity predicate", () => {
		expect(CharacterSheetState.isSteelHawkSubclass({shortName: "Steel Hawk", source: "GriffonsSaddlebag2"})).toBe(true);
		expect(CharacterSheetState.isSteelHawkSubclass({shortName: "Steel Hawk", source: "PHB"})).toBe(false);
		expect(CharacterSheetState.isSteelHawkSubclass(null)).toBe(false);
	});
});

// ===========================================================================
// Launch — tiers and pool
// ===========================================================================
describe("Steel Hawk — Launch tiers", () => {
	it("scales uses 3 → 4 (7th) → 5 (15th)", () => {
		expect(makeSteelHawk(3).getFeatureCalculations().launchUses).toBe(3);
		expect(makeSteelHawk(6).getFeatureCalculations().launchUses).toBe(3);
		expect(makeSteelHawk(7).getFeatureCalculations().launchUses).toBe(4);
		expect(makeSteelHawk(14).getFeatureCalculations().launchUses).toBe(4);
		expect(makeSteelHawk(15).getFeatureCalculations().launchUses).toBe(5);
		expect(makeSteelHawk(20).getFeatureCalculations().launchUses).toBe(5);
	});

	it("scales leap distance 15 ft → 30 ft at 7th", () => {
		expect(makeSteelHawk(3).getFeatureCalculations().launchDistance).toBe(15);
		expect(makeSteelHawk(6).getFeatureCalculations().launchDistance).toBe(15);
		expect(makeSteelHawk(7).getFeatureCalculations().launchDistance).toBe(30);
		expect(makeSteelHawk(20).getFeatureCalculations().launchDistance).toBe(30);
	});

	it("scales the momentum die 1d8 → 1d10 (10th) → 1d12 (18th)", () => {
		expect(makeSteelHawk(3).getFeatureCalculations().launchBonusDamage).toBe("1d8");
		expect(makeSteelHawk(9).getFeatureCalculations().launchBonusDamage).toBe("1d8");
		expect(makeSteelHawk(10).getFeatureCalculations().launchBonusDamage).toBe("1d10");
		expect(makeSteelHawk(17).getFeatureCalculations().launchBonusDamage).toBe("1d10");
		expect(makeSteelHawk(18).getFeatureCalculations().launchBonusDamage).toBe("1d12");
	});

	it("creates a short-rest Launch pool whose max tracks the tier", () => {
		const state = makeSteelHawk(3);
		const pool = state.getLaunchResource();
		expect(pool.max).toBe(3);
		expect(pool.current).toBe(3);
		expect(pool.recharge).toBe("short");

		setFighterLevel(state, 7);
		expect(state.getLaunchUsesMax()).toBe(4);
		setFighterLevel(state, 15);
		expect(state.getLaunchUsesMax()).toBe(5);
	});

	it("preserves EXPENDED uses across a level-up rather than silently refilling", () => {
		const state = makeSteelHawk(3);
		state.setLaunchUsesRemaining(1); // 2 expended of 3
		setFighterLevel(state, 7);
		expect(state.getLaunchUsesMax()).toBe(4);
		expect(state.getLaunchUsesRemaining()).toBe(2); // still 2 expended
	});

	it("removes the pool entirely when the subclass goes away", () => {
		const state = makeSteelHawk(3);
		expect(state.getLaunchResource()).not.toBeNull();
		state._data.classes[0].subclass = null;
		expect(state.getLaunchResource()).toBeNull();
		expect((state._data.resources || []).some(r => r.resourceType === "steelHawkLaunch")).toBe(false);
	});
});

// ===========================================================================
// Launch — spending and the momentum rider
// ===========================================================================
describe("Steel Hawk — useLaunch()", () => {
	it("spends a use and arms the momentum state", () => {
		const state = makeSteelHawk(3);
		const res = state.useLaunch();
		expect(res).not.toBeNull();
		expect(res.distance).toBe(15);
		expect(res.bonusDamage).toBe("1d8");
		expect(res.remaining).toBe(2);
		expect(state.getLaunchUsesRemaining()).toBe(2);
		expect(state.hasLaunchMomentum()).toBe(true);
	});

	it("refuses at 0 uses and at speed 0", () => {
		const state = makeSteelHawk(3);
		state.setLaunchUsesRemaining(0);
		expect(state.useLaunch()).toBeNull();

		const speedless = makeSteelHawk(3);
		speedless.setSpeed("walk", 0);
		expect(speedless.getSpeed("walk")).toBe(0);
		expect(speedless.useLaunch()).toBeNull();
		expect(speedless.getLaunchUsesRemaining()).toBe(3);
	});

	it("grants ADVANTAGE on melee attacks while armed — on BOTH aggregators", () => {
		const state = makeSteelHawk(3);
		// `hasAdvantageFromStates` is the path `_rollAttack` takes; `getAdvantageState`
		// is the path the UI badge takes. They must agree.
		expect(state.hasAdvantageFromStates("attack:melee:str")).toBe(false);
		expect(state.getAdvantageState("attack:melee:str").advantage).toBe(false);
		state.useLaunch();
		expect(state.hasAdvantageFromStates("attack:melee:str")).toBe(true);
		expect(state.hasAdvantageFromStates("attack:melee:dex")).toBe(true);
		expect(state.getAdvantageState("attack:melee:str").advantage).toBe(true);
		// …and it is SCOPED to melee: a ranged attack gets nothing.
		expect(state.hasAdvantageFromStates("attack:ranged:dex")).toBe(false);
		expect(state.getAdvantageState("attack:ranged:dex").advantage).toBe(false);
	});

	it("emits the tier-correct extra damage die, scoped melee-only", () => {
		const l3 = makeSteelHawk(3);
		l3.useLaunch();
		const e3 = l3.getExtraDamageFromStates().find(e => e.source === "Launch Momentum");
		expect(e3).toBeDefined();
		expect(e3.dice).toBe("1d8");
		expect(e3.meleeOnly).toBe(true);

		const l10 = makeSteelHawk(10);
		l10.useLaunch();
		expect(l10.getExtraDamageFromStates().find(e => e.source === "Launch Momentum").dice).toBe("1d10");

		const l18 = makeSteelHawk(18);
		l18.useLaunch();
		expect(l18.getExtraDamageFromStates().find(e => e.source === "Launch Momentum").dice).toBe("1d12");
	});

	it("does NOT widen the critical range before Eagle Eye, and DOES from 10th", () => {
		const l3 = makeSteelHawk(3);
		l3.useLaunch();
		expect(l3.getCriticalRange()).toBe(20);

		const l10 = makeSteelHawk(10);
		expect(l10.getCriticalRange()).toBe(20);
		l10.useLaunch();
		expect(l10.getCriticalRange()).toBe(19);
	});
});

// ===========================================================================
// Steel Grace (7)
// ===========================================================================
describe("Steel Hawk — Steel Grace (7)", () => {
	function equipStealthArmor (state) {
		state._data.ac.armor = {name: "Half Plate", type: "medium", ac: 15, stealth: true};
	}

	it("armor stops imposing Stealth disadvantage from 7th level", () => {
		const l6 = makeSteelHawk(6);
		equipStealthArmor(l6);
		expect(l6.hasArmorStealthDisadvantage()).toBe(true);

		const l7 = makeSteelHawk(7);
		equipStealthArmor(l7);
		expect(l7.getFeatureCalculations().ignoresArmorStealthDisadvantage).toBe(true);
		expect(l7.hasArmorStealthDisadvantage()).toBe(false);
	});

	it("useLaunchEvasion() halves damage on a failed Dex save and negates it on a success", () => {
		const state = makeSteelHawk(7);
		expect(state.useLaunchEvasion({success: true, damage: 22})).toEqual({damage: 0, spent: true});
		expect(state.getLaunchUsesRemaining()).toBe(3);

		expect(state.useLaunchEvasion({success: false, damage: 22})).toEqual({damage: 11, spent: true});
		expect(state.getLaunchUsesRemaining()).toBe(2);
	});

	it("is unavailable before 7th level and at 0 uses", () => {
		expect(makeSteelHawk(6).useLaunchEvasion({success: true, damage: 10})).toBeNull();
		const drained = makeSteelHawk(7);
		drained.setLaunchUsesRemaining(0);
		expect(drained.useLaunchEvasion({success: true, damage: 10})).toBeNull();
	});
});

// ===========================================================================
// Eagle Eye (10)
// ===========================================================================
describe("Steel Hawk — Eagle Eye (10)", () => {
	it("grants Perception proficiency automatically", () => {
		const l9 = makeSteelHawk(9);
		l9.applyClassFeatureEffects();
		expect(l9.getSkillProficiency("perception")).toBe(0);

		const l10 = makeSteelHawk(10);
		l10.applyClassFeatureEffects();
		expect(l10.getSkillProficiency("perception")).toBe(1);
	});

	it("computes the save DC as 8 + PB + STR", () => {
		// Fighter 10 → PB 4; STR 16 → +3.
		expect(makeSteelHawk(10).getFeatureCalculations().steelHawkSaveDc).toBe(15);
		// Fighter 18 → PB 6; STR 20 → +5.
		expect(makeSteelHawk(18, {str: 20}).getFeatureCalculations().steelHawkSaveDc).toBe(19);
	});

	it("subtracts the exhaustion penalty from the DC exactly once", () => {
		const state = makeSteelHawk(10);
		const base = state.getFeatureCalculations().steelHawkSaveDc;
		state.addExhaustion(1);
		const penalty = state._getExhaustionD20Penalty();
		expect(penalty).toBeGreaterThan(0);
		expect(state.getFeatureCalculations().steelHawkSaveDc).toBe(base - penalty);
	});

	it("the sight toggle MOVES the displayed Perception modifier by the proficiency bonus", () => {
		const state = makeSteelHawk(10);
		state.applyClassFeatureEffects();
		const before = state.getSkillMod("perception");
		expect(state.setEagleEyeSightActive(true)).toBe(true);
		expect(state.isEagleEyeSightActive()).toBe(true);
		expect(state.getSkillMod("perception")).toBe(before + state.getProficiencyBonus());

		state.setEagleEyeSightActive(false);
		expect(state.isEagleEyeSightActive()).toBe(false);
		expect(state.getSkillMod("perception")).toBe(before);
	});

	it("adds nothing on top of existing Perception EXPERTISE (already doubled)", () => {
		const state = makeSteelHawk(10);
		state.applyClassFeatureEffects();
		state.setSkillProficiency("perception", 2);
		const before = state.getSkillMod("perception");
		state.setEagleEyeSightActive(true);
		expect(state.getSkillMod("perception")).toBe(before);
	});

	it("the toggle is unavailable before 10th level", () => {
		const state = makeSteelHawk(9);
		expect(state.setEagleEyeSightActive(true)).toBe(false);
		expect(state.isEagleEyeSightActive()).toBe(false);
	});
});

// ===========================================================================
// Predatory Instinct (15)
// ===========================================================================
describe("Steel Hawk — Predatory Instinct (15)", () => {
	it("grants advantage on initiative", () => {
		const l14 = makeSteelHawk(14);
		l14.applyClassFeatureEffects();
		expect(l14.getInitiativeRollMode().advantage).toBe(false);

		const l15 = makeSteelHawk(15);
		l15.applyClassFeatureEffects();
		expect(l15.getInitiativeRollMode().advantage).toBe(true);
	});

	it("regains exactly one Launch use on initiative — but only when empty", () => {
		const state = makeSteelHawk(15);
		state.setLaunchUsesRemaining(0);
		expect(state.restoreLaunchOnInitiative()).toBe(1);
		expect(state.getLaunchUsesRemaining()).toBe(1);

		// Idempotent: a second roll with a use in hand regains nothing.
		expect(state.restoreLaunchOnInitiative()).toBe(0);
		expect(state.getLaunchUsesRemaining()).toBe(1);
	});

	it("does nothing before 15th level", () => {
		const state = makeSteelHawk(14);
		state.setLaunchUsesRemaining(0);
		expect(state.restoreLaunchOnInitiative()).toBe(0);
		expect(state.getLaunchUsesRemaining()).toBe(0);
	});
});

// ===========================================================================
// Improved Launch (18)
// ===========================================================================
describe("Steel Hawk — Improved Launch (18)", () => {
	it("spends a Launch use, its own once-per-rest use, and a level of exhaustion", () => {
		const state = makeSteelHawk(18);
		expect(state.getExhaustion()).toBe(0);
		const res = state.useLaunch({improved: true});
		expect(res).not.toBeNull();
		expect(res.improved).toBe(true);
		expect(res.distance).toBe(90);
		expect(res.ignoresFallDamage).toBe(true);
		expect(state.getExhaustion()).toBe(1);
		expect(state.getLaunchUsesRemaining()).toBe(4);
		expect(state.canUseImprovedLaunch()).toBe(false); // once-per-rest budget spent
	});

	it("is blocked at two or more levels of exhaustion", () => {
		const state = makeSteelHawk(18);
		state.addExhaustion(2);
		expect(state.canUseImprovedLaunch()).toBe(false);
		expect(state.useLaunch({improved: true})).toBeNull();
		// The plain Launch is still available.
		expect(state.useLaunch()).not.toBeNull();
	});

	it("a blocked Improved Launch spends NOTHING", () => {
		const state = makeSteelHawk(18);
		state.addExhaustion(2);
		const usesBefore = state.getLaunchUsesRemaining();
		state.useLaunch({improved: true});
		expect(state.getLaunchUsesRemaining()).toBe(usesBefore);
		expect(state.getExhaustion()).toBe(2);
	});

	it("has no once-per-rest pool below 18th level", () => {
		const state = makeSteelHawk(17);
		expect(state.canUseImprovedLaunch()).toBe(false);
		expect((state._data.resources || []).some(r => r.resourceType === "steelHawkImprovedLaunch")).toBe(false);
	});
});

// ===========================================================================
// Nimble Lancer (3)
// ===========================================================================
describe("Steel Hawk — Nimble Lancer (3)", () => {
	const LANCE = {name: "Lance", dmg1: "1d12", dmgType: "P"};

	it("gives a lance a versatile profile it does not print", () => {
		const state = makeSteelHawk(3);
		expect(state.getNimbleLancerLanceDamage(LANCE)).toEqual({oneHanded: "1d8", twoHanded: "1d12"});
		expect(state.getEffectiveWeaponDamageProfile(LANCE)).toEqual({dmg1: "1d8", dmg2: "1d12"});
	});

	it("MOVES the resolved damage die by hand count", () => {
		const state = makeSteelHawk(3);
		expect(state.getWeaponDamageDie({...LANCE, handsUsed: 1})).toBe("1d8");
		expect(state.getWeaponDamageDie({...LANCE, handsUsed: 2})).toBe("1d12");
	});

	it("leaves non-lances and non-Steel-Hawks alone", () => {
		const state = makeSteelHawk(3);
		const longsword = {name: "Longsword", dmg1: "1d8", dmg2: "1d10"};
		expect(state.getNimbleLancerLanceDamage(longsword)).toBeNull();
		expect(state.getEffectiveWeaponDamageProfile(longsword)).toEqual({dmg1: "1d8", dmg2: "1d10"});

		const plainFighter = new CharacterSheetState();
		plainFighter.addClass({name: "Fighter", source: "PHB", level: 5});
		expect(plainFighter.getNimbleLancerLanceDamage(LANCE)).toBeNull();
		expect(plainFighter.getWeaponDamageDie({...LANCE, handsUsed: 1})).toBe("1d12");
	});
});

// ===========================================================================
// Bird Caller (3)
// ===========================================================================
describe("Steel Hawk — Bird Caller (3)", () => {
	it("parses the animal messenger grant as RITUAL ONLY, not a 1/day innate", () => {
		const spells = SpellGrantParser.parseSpellsFromText(BIRD_CALLER_TEXT, "Bird Caller");
		const messenger = spells.find(s => /animal messenger/i.test(s.name));
		expect(messenger).toBeDefined();
		expect(messenger.ritualOnly).toBe(true);
		expect(messenger.innate).toBe(true);
		// A ritual-only grant has no per-rest budget — the limiter is the casting time.
		expect(messenger.uses).toBeNull();
	});

	it("persists ritualOnly onto the stored innate spell", () => {
		const state = makeSteelHawk(3);
		state.addInnateSpell({name: "Animal Messenger", source: "PHB", level: 2, atWill: true, ritualOnly: true, sourceFeature: "Bird Caller"});
		const stored = state.getInnateSpells().find(s => s.name === "Animal Messenger");
		expect(stored).toBeDefined();
		expect(stored.ritualOnly).toBe(true);
	});

	it("registers CONDITIONAL advantage on Animal Handling (not an unconditional grant)", () => {
		const state = makeSteelHawk(3);
		state.applyClassFeatureEffects();
		const mod = (state._data.namedModifiers || []).find(m =>
			m.type === "skill:animal handling:advantage" && /bird caller/i.test(m.name || m.source || ""));
		expect(mod).toBeDefined();
		expect(mod.conditional).toMatch(/flying/i);
	});

	it("the conditional advantage does NOT leak a phantom +1 onto Animal Handling", () => {
		const plain = makeSteelHawk(2);
		plain.applyClassFeatureEffects();
		const before = plain.getSkillMod("animal handling");

		const hawk = makeSteelHawk(3);
		hawk.applyClassFeatureEffects();
		expect(hawk.getSkillMod("animal handling")).toBe(before);
	});
});

// ===========================================================================
// CS-BUG-086 — active-state `skill:<name>` bonuses were silently dropped
// ===========================================================================
describe("CS-BUG-086: active-state bonuses targeting skill:<name>", () => {
	function makeRogue () {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 14);
		state.addClass({name: "Rogue", source: "PHB", level: 1});
		return state;
	}

	it("Pass Without Trace's +10 reaches the displayed Stealth modifier", () => {
		const state = makeRogue();
		const before = state.getSkillMod("stealth");
		state.activateState("custom", {
			name: "Pass Without Trace",
			sourceFeatureId: "spell_pass_without_trace_1",
			customEffects: [{type: "bonus", target: "skill:stealth", value: 10}],
			isSpellEffect: true,
		});
		expect(state.getSkillMod("stealth")).toBe(before + 10);
	});

	it("skill:all applies to every skill", () => {
		const state = makeRogue();
		const beforeArcana = state.getSkillMod("arcana");
		const beforeStealth = state.getSkillMod("stealth");
		state.activateState("custom", {
			name: "Omnicompetence",
			sourceFeatureId: "test_skill_all",
			customEffects: [{type: "bonus", target: "skill:all", value: 3}],
		});
		expect(state.getSkillMod("arcana")).toBe(beforeArcana + 3);
		expect(state.getSkillMod("stealth")).toBe(beforeStealth + 3);
	});

	it("a skill:<name> bonus is SCOPED — it does not leak to other skills", () => {
		const state = makeRogue();
		const beforeArcana = state.getSkillMod("arcana");
		state.activateState("custom", {
			name: "Pass Without Trace",
			sourceFeatureId: "spell_pwt_scope",
			customEffects: [{type: "bonus", target: "skill:stealth", value: 10}],
		});
		expect(state.getSkillMod("arcana")).toBe(beforeArcana);
	});

	it("the bonus survives an ability SWAP on the skill (skill: targets ignore ability)", () => {
		const state = makeRogue();
		const before = state.getSkillModWithAbility("stealth", "str");
		state.activateState("custom", {
			name: "Pass Without Trace",
			sourceFeatureId: "spell_pwt_swap",
			customEffects: [{type: "bonus", target: "skill:stealth", value: 10}],
		});
		expect(state.getSkillModWithAbility("stealth", "str")).toBe(before + 10);
	});

	it("drops the bonus again the moment the state is deactivated", () => {
		const state = makeRogue();
		const before = state.getSkillMod("stealth");
		state.activateState("custom", {
			name: "Pass Without Trace",
			sourceFeatureId: "spell_pwt_teardown",
			customEffects: [{type: "bonus", target: "skill:stealth", value: 10}],
		});
		expect(state.getSkillMod("stealth")).toBe(before + 10);
		const inst = state.getActiveStates().find(s => s.name === "Pass Without Trace");
		state.removeActiveState(inst.id);
		expect(state.getSkillMod("stealth")).toBe(before);
	});
});
