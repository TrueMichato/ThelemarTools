import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const SpellGrantParser = globalThis.SpellGrantParser;

const REDUCE_GRAVITY_TEXT = [
	"Also at 3rd level, you can cause the pull of gravity on you to lessen. You learn the {@spell feather fall} and {@spell jump} spells. At 10th level in this class, you also learn the {@spell levitate} spell. When you cast one of these spells, you can target only yourself, and the spell does not require material components. You can cast each of these spells once with this feature, and once you cast a spell in this way, you can not do so again until you finish a long rest.",
	"When you reach 15th level in this class, you can cast the {@spell feather fall} and {@spell jump} spells at will. The spells must still target only yourself.",
].join("\n");

function makeMeteorKnight (level, {int = 16, source = "GriffonsSaddlebag3"} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", int);
	state.addClass({
		name: "Fighter",
		source: "PHB",
		level,
		subclass: {
			name: "Meteor Knight",
			shortName: "Meteor Knight",
			source,
		},
	});
	return state;
}

function setFighterLevel (state, level) {
	state._data.classes.find(c => c.name === "Fighter").level = level;
}

describe("Fighter: Meteor Knight (TGS3) — gating", () => {
	it("is level-gated to Fighter 3", () => {
		expect(makeMeteorKnight(2).getFeatureCalculations().hasMeteorKnight).toBeUndefined();
		expect(makeMeteorKnight(3).getFeatureCalculations().hasMeteorKnight).toBe(true);
	});

	it("is source-gated — a same-named subclass from another brew gets nothing", () => {
		const state = makeMeteorKnight(20, {source: "SomeOtherBrew"});
		expect(state.getFeatureCalculations().hasMeteorKnight).toBeUndefined();
		expect(state.getSatelliteResource()).toBeNull();
		expect(state.hasMeteorKnight()).toBe(false);
	});
});

describe("Meteor Knight: Satellite Mastery (3)", () => {
	it("scales damage and range across the 3/10/18 tiers", () => {
		expect(makeMeteorKnight(3).getFeatureCalculations().satelliteDamage).toBe("1d4");
		expect(makeMeteorKnight(9).getFeatureCalculations().satelliteDamage).toBe("1d4");
		expect(makeMeteorKnight(10).getFeatureCalculations().satelliteDamage).toBe("1d6");
		expect(makeMeteorKnight(17).getFeatureCalculations().satelliteDamage).toBe("1d6");
		expect(makeMeteorKnight(18).getFeatureCalculations().satelliteDamage).toBe("1d8");

		expect(makeMeteorKnight(9).getFeatureCalculations().satelliteRange).toBe(30);
		expect(makeMeteorKnight(10).getFeatureCalculations().satelliteRange).toBe(60);
	});

	it("uses Intelligence + proficiency for the attack and Intelligence for damage", () => {
		const state = makeMeteorKnight(5, {int: 18});
		const calc = state.getFeatureCalculations();
		// Fighter 5 → PB 3; INT 18 → +4
		expect(calc.satelliteAttackBonus).toBe(7);
		expect(calc.satelliteDamageBonus).toBe(4);
		expect(calc.satelliteAbility).toBe("int");

		const profile = state.getSatelliteAttackProfile();
		expect(profile).toMatchObject({
			attackBonus: 7,
			damage: "1d4",
			damageBonus: 4,
			range: 30,
			ability: "int",
			actionType: "bonus",
			ignoresCloseQuartersDisadvantage: true,
		});
	});

	it("surfaces a rollable granted attack that tracks the damage/range tiers", () => {
		const l3 = makeMeteorKnight(3).getFeatureGrantedAttacks();
		expect(l3).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Satellite",
				sourceFeature: "Satellite Mastery",
				abilityMod: "int",
				damage: "1d4",
				range: "30 ft.",
				isRanged: true,
				isSpellAttack: true,
				actionType: "bonus",
				ignoresCloseQuartersDisadvantage: true,
			}),
		]));

		const l18 = makeMeteorKnight(18).getFeatureGrantedAttacks()
			.find(a => a.name === "Satellite");
		expect(l18.damage).toBe("1d8");
		expect(l18.range).toBe("60 ft.");
	});

	it("materialises a Satellites pool sized to the proficiency bonus and re-scales it", () => {
		const state = makeMeteorKnight(3);
		expect(state.getSatellitesMax()).toBe(2);
		expect(state.getSatellitesOrbiting()).toBe(2);

		// Spend one, then level past a PB step: the EXPENDED count is preserved.
		state.fireSatellite();
		expect(state.getSatellitesOrbiting()).toBe(1);
		setFighterLevel(state, 9);
		expect(state.getSatellitesMax()).toBe(4);
		expect(state.getSatellitesOrbiting()).toBe(3);
	});

	it("exposes the pool on the player-facing generic resource surfaces", () => {
		const names = makeMeteorKnight(5).getGenericPoolResources().map(r => r.name);
		expect(names).toContain("Satellites");
	});

	it("launches, binds and recalls satellites", () => {
		const state = makeMeteorKnight(5); // PB 3
		expect(state.getSatellitesMax()).toBe(3);

		expect(state.fireSatellite()).toMatchObject({remaining: 2});
		expect(state.fireSatellite()).toMatchObject({remaining: 1});
		expect(state.fireSatellite()).toMatchObject({remaining: 0});
		expect(state.fireSatellite()).toBeNull();

		expect(state.bindSatellite()).toBe(true);
		expect(state.getSatellitesOrbiting()).toBe(1);

		expect(state.recallSatellites()).toBe(2);
		expect(state.getSatellitesOrbiting()).toBe(3);
		expect(state.bindSatellite()).toBe(false);
	});

	it("restores the pool on a long rest", () => {
		const state = makeMeteorKnight(5);
		state.fireSatellite();
		state.fireSatellite();
		expect(state.getSatellitesOrbiting()).toBe(1);
		state.onLongRest();
		expect(state.getSatellitesOrbiting()).toBe(3);
	});
});

describe("Meteor Knight: Reduce Gravity (3 / 10 / 15)", () => {
	it("reports the learned spell list per tier", () => {
		expect(makeMeteorKnight(3).getFeatureCalculations().reduceGravitySpells)
			.toEqual(["Feather Fall", "Jump"]);
		expect(makeMeteorKnight(10).getFeatureCalculations().reduceGravitySpells)
			.toEqual(["Feather Fall", "Jump", "Levitate"]);
		expect(makeMeteorKnight(14).getFeatureCalculations().reduceGravityAtWillSpells)
			.toEqual([]);
		expect(makeMeteorKnight(15).getFeatureCalculations().reduceGravityAtWillSpells)
			.toEqual(["Feather Fall", "Jump"]);
	});

	it("parses the prose into level-gated tiers instead of one flat grant", () => {
		const parsed = SpellGrantParser.parseSpellsFromText(REDUCE_GRAVITY_TEXT, "Reduce Gravity");
		const byTier = parsed.map(s => [s.name, s.minLevel, !!s.atWill]);
		expect(byTier).toEqual(expect.arrayContaining([
			["Feather Fall", null, false],
			["Jump", null, false],
			["Levitate", 10, false],
			["Feather Fall", 15, true],
			["Jump", 15, true],
		]));
		// The once-per-long-rest tiers keep their tracking.
		const featherFallBase = parsed.find(s => s.name === "Feather Fall" && !s.minLevel);
		expect(featherFallBase).toMatchObject({innate: true, uses: 1, recharge: "long"});
	});

	it("grants only feather fall and jump at level 3 — levitate stays deferred", () => {
		const state = makeMeteorKnight(3);
		state.addFeature({
			name: "Reduce Gravity",
			source: "GriffonsSaddlebag3",
			className: "Fighter",
			level: 3,
			description: REDUCE_GRAVITY_TEXT,
		});
		const names = state.getInnateSpells().map(s => s.name);
		expect(names).toEqual(expect.arrayContaining(["Feather Fall", "Jump"]));
		expect(names).not.toContain("Levitate");
	});

	it("releases levitate on reaching Fighter 10 and upgrades to at-will at 15", () => {
		const state = makeMeteorKnight(3);
		state.addFeature({
			name: "Reduce Gravity",
			source: "GriffonsSaddlebag3",
			className: "Fighter",
			level: 3,
			description: REDUCE_GRAVITY_TEXT,
		});

		setFighterLevel(state, 10);
		expect(state.getInnateSpells().map(s => s.name)).toContain("Levitate");
		const featherFallAt10 = state.getInnateSpells().find(s => s.name === "Feather Fall");
		expect(featherFallAt10.atWill).toBeFalsy();
		expect(featherFallAt10.uses).toMatchObject({max: 1});

		setFighterLevel(state, 15);
		const spells = state.getInnateSpells();
		expect(spells.find(s => s.name === "Feather Fall").atWill).toBe(true);
		expect(spells.find(s => s.name === "Jump").atWill).toBe(true);
		// Levitate is NOT promoted to at-will — only feather fall and jump are.
		expect(spells.find(s => s.name === "Levitate").atWill).toBeFalsy();
		// Exactly one entry per spell — the tiers merged rather than duplicating.
		expect(spells.filter(s => s.name === "Feather Fall")).toHaveLength(1);
	});

	// CS-BUG-066: a stored feature's `description` is already-rendered HTML, in
	// which every {@spell …} tag has become an <a href>. Parsing that string finds
	// nothing, so the whole grant vanished. The raw `entries` must win.
	it("parses prose spell grants from raw entries when the description is rendered HTML", () => {
		const state = makeMeteorKnight(3);
		state.addFeature({
			name: "Reduce Gravity",
			source: "GriffonsSaddlebag3",
			className: "Fighter",
			level: 3,
			description: `<div class="ve-rd__b">Also at 3rd level, you learn the `
				+ `<a href="spells.html#feather%20fall_phb">feather fall</a> and `
				+ `<a href="spells.html#jump_phb">jump</a> spells. You can cast each of `
				+ `these spells once with this feature, and once you cast a spell in this `
				+ `way, you can not do so again until you finish a long rest.</div>`,
			entries: [REDUCE_GRAVITY_TEXT],
		});

		const spells = state.getInnateSpells();
		expect(spells.map(s => s.name)).toEqual(expect.arrayContaining(["Feather Fall", "Jump"]));
		// And the feature-wide "once ... until you finish a long rest" clause still binds.
		expect(spells.find(s => s.name === "Feather Fall")).toMatchObject({
			recharge: "long",
			uses: {max: 1},
		});
	});

	it("still reads the description when a feature carries no tagged entries", () => {
		const state = makeMeteorKnight(3);
		state.addFeature({
			name: "Reduce Gravity",
			source: "GriffonsSaddlebag3",
			className: "Fighter",
			level: 3,
			description: REDUCE_GRAVITY_TEXT,
			entries: [{type: "entries", name: "Reduce Gravity", entries: []}],
		});
		expect(state.getInnateSpells().map(s => s.name))
			.toEqual(expect.arrayContaining(["Feather Fall", "Jump"]));
	});
});

describe("Meteor Knight: Course Correct (7)", () => {
	it("adds proficiency on top of the Intelligence modifier", () => {
		expect(makeMeteorKnight(6, {int: 18}).getCourseCorrectCheckBonus()).toBe(0);
		expect(makeMeteorKnight(6, {int: 18}).getFeatureCalculations().hasCourseCorrect).toBeUndefined();

		// Fighter 7 → PB 3; INT 18 → +4
		const state = makeMeteorKnight(7, {int: 18});
		expect(state.getFeatureCalculations().hasCourseCorrect).toBe(true);
		expect(state.getCourseCorrectCheckBonus()).toBe(7);
		expect(state.getFeatureCalculations().courseCorrectRange).toBe(10);

		// Fighter 17 → PB 6
		expect(makeMeteorKnight(17, {int: 18}).getCourseCorrectCheckBonus()).toBe(10);
	});
});

describe("Meteor Knight: Improved Satellite Mastery (10)", () => {
	it("returns every satellite to orbit when Action Surge is used", () => {
		const state = makeMeteorKnight(10);
		state.addFeature({name: "Action Surge", source: "PHB", className: "Fighter", level: 2});
		state.fireSatellite();
		state.fireSatellite();
		expect(state.getSatellitesOrbiting()).toBe(2); // PB 4 at Fighter 10

		expect(state.useActionSurge()).toBe(true);
		expect(state.getSatellitesOrbiting()).toBe(4);
	});

	it("does NOT recall satellites before level 10", () => {
		const state = makeMeteorKnight(9);
		state.addFeature({name: "Action Surge", source: "PHB", className: "Fighter", level: 2});
		state.fireSatellite();
		const before = state.getSatellitesOrbiting();
		expect(state.useActionSurge()).toBe(true);
		expect(state.getSatellitesOrbiting()).toBe(before);
	});
});

describe("Meteor Knight: Increase Gravity (15)", () => {
	it("grants conditional advantage on checks and saves to resist forced movement", () => {
		const state = makeMeteorKnight(15, {int: 18});
		state.applyClassFeatureEffects();

		const checkAgg = state.aggregateModifiers("check:str");
		const saveAgg = state.aggregateModifiers("save:str");
		const label = /pushed, pulled, or knocked prone/;

		expect(checkAgg.conditionalsAvailable.some(m => label.test(m.conditional || ""))).toBe(true);
		expect(saveAgg.conditionalsAvailable.some(m => label.test(m.conditional || ""))).toBe(true);
		// Gated by default — it must not auto-apply to unrelated Strength rolls.
		expect(checkAgg.advantage).toBe(false);
		expect(saveAgg.advantage).toBe(false);

		// Opting in on a roll turns it on.
		const optIn = state.aggregateModifiers("save:str", {
			appliedConditionalIds: new Set(saveAgg.conditionalsAvailable
				.filter(m => label.test(m.conditional || ""))
				.map(m => m.id)),
		});
		expect(optIn.advantage).toBe(true);
	});

	it("adds the Intelligence modifier to shove checks as an opt-in Athletics bonus", () => {
		const state = makeMeteorKnight(15, {int: 18});
		state.applyClassFeatureEffects();

		const agg = state.aggregateModifiers("skill:athletics");
		const shove = agg.conditionalsAvailable.find(m => /shove/i.test(m.conditional || ""));
		expect(shove).toBeTruthy();
		expect(shove.bonus).toBe(4);
		// Not auto-applied — a plain Athletics check gets no Intelligence.
		expect(agg.bonus).toBe(0);

		const optIn = state.aggregateModifiers("skill:athletics", {
			appliedConditionalIds: new Set([shove.id]),
		});
		expect(optIn.bonus).toBe(4);
	});

	// CS-BUG-065 was filed claiming numeric conditionals were "permanently
	// unreachable" and fixed by storing them `enabled: true`. That was a
	// REGRESSION: `_recalculateCustomModifiers` gates on `enabled` alone and
	// never on `conditional`, so enabling the modifier leaked its value into
	// customModifiers and therefore into the *displayed* skill modifier —
	// Athletics read +INT on every check, not just shoves. These pin the
	// invariant in the surface the player actually sees.
	it("does NOT leak the conditional shove bonus into the plain Athletics modifier", () => {
		const state = makeMeteorKnight(15, {int: 18});
		state.applyClassFeatureEffects();
		// The quick-total map is what getSkillMod() reads; rebuild it the way the
		// live sheet does after features are applied, or this assertion is vacuous.
		state._recalculateCustomModifiers();

		// PREMISE: the conditional modifier really is present and really does
		// carry a non-zero value — otherwise the assertions below are vacuous.
		const shove = state.aggregateModifiers("skill:athletics").conditionalsAvailable
			.find(m => /shove/i.test(m.conditional || ""));
		expect(shove).toBeTruthy();
		expect(shove.bonus).toBe(4);

		// The leak surface: a conditional must contribute 0 to the quick-total.
		expect(state.getSkillCustomMod("athletics")).toBe(0);

		// And the displayed modifier must match an otherwise-identical character
		// who has not yet earned Increase Gravity (PB is 5 at both 14 and 15).
		const control = makeMeteorKnight(14, {int: 18});
		control.applyClassFeatureEffects();
		control._recalculateCustomModifiers();
		expect(state.getSkillMod("athletics")).toBe(control.getSkillMod("athletics"));
	});

	it("keeps the numeric conditional out of the enabled quick-total but still offers it", () => {
		const state = makeMeteorKnight(15, {int: 18});
		state.applyClassFeatureEffects();

		const stored = (state._data.namedModifiers || [])
			.find(m => m.type === "skill:athletics" && /shove/i.test(m.conditional || ""));
		expect(stored).toBeTruthy();
		// Disabled is what keeps it out of _recalculateCustomModifiers…
		expect(stored.enabled).toBe(false);
		// …and it costs nothing: the per-roll picker still sees it.
		expect(state.aggregateModifiers("skill:athletics").conditionalsAvailable
			.some(m => /shove/i.test(m.conditional || ""))).toBe(true);
	});

	it("grants nothing before level 15", () => {
		const state = makeMeteorKnight(14, {int: 18});
		state.applyClassFeatureEffects();
		expect(state.getFeatureCalculations().hasIncreaseGravity).toBeUndefined();
		expect(state.aggregateModifiers("skill:athletics").conditionalsAvailable
			.some(m => /shove/i.test(m.conditional || ""))).toBe(false);
	});
});

describe("Meteor Knight: Satellite Barrage (18)", () => {
	it("caps the barrage at the satellites actually in orbit", () => {
		expect(makeMeteorKnight(17).getSatelliteBarrageMaxAttacks()).toBe(0);

		const state = makeMeteorKnight(18); // PB 6
		expect(state.getFeatureCalculations().hasSatelliteBarrage).toBe(true);
		expect(state.getSatelliteBarrageMaxAttacks()).toBe(6);

		state.fireSatellite();
		state.fireSatellite();
		expect(state.getSatelliteBarrageMaxAttacks()).toBe(4);
	});
});

describe("Level-gated prose spell grants (generic)", () => {
	it("ignores a level mention from a preceding sentence", () => {
		const text = "At 10th level you become resistant to fire. You learn the {@spell shield} spell.";
		const parsed = SpellGrantParser.parseSpellsFromText(text, "Test");
		expect(parsed.find(s => s.name === "Shield").minLevel).toBeNull();
	});

	it("recognises the common gate phrasings", () => {
		const variants = [
			["At 11th level, you learn the {@spell fly} spell.", 11],
			["By 14th level, you learn the {@spell fly} spell.", 14],
			["When you reach 6th level, you learn the {@spell fly} spell.", 6],
			["Upon reaching 9th level, you learn the {@spell fly} spell.", 9],
		];
		for (const [text, expected] of variants) {
			expect(SpellGrantParser.parseSpellsFromText(text, "Test")[0].minLevel).toBe(expected);
		}
	});

	it("gates a deferred grant on the FEATURE's own class level in a multiclass", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 3});
		state.addClass({name: "Rogue", source: "PHB", level: 8});
		state.addFeature({
			name: "Gated Grant",
			source: "Test",
			className: "Fighter",
			level: 3,
			description: "You learn nothing yet. At 6th level in this class, you learn the {@spell fly} spell.",
		});
		expect(state.getInnateSpells().map(s => s.name)).not.toContain("Fly");
		expect(state.getSpells().map(s => s.name)).not.toContain("Fly");

		setFighterLevel(state, 6);
		state.reconcileDeferredFeatureSpells();
		const all = [...state.getInnateSpells(), ...state.getSpells()].map(s => s.name);
		expect(all).toContain("Fly");
	});
});
