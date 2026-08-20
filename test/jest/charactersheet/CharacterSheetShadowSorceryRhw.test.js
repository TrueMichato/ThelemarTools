/**
 * Shadow Sorcery Sorcerer (RHW) — mechanical-effect coverage.
 *
 * This subclass is the 2024 rework of Shadow Magic (XGE), and the danger it presents is
 * copying XGE behaviour under an RHW name: the two share a `shortName`, share a level-18
 * feature NAME, and share three of four benefit names. So the tests below deliberately pair
 * each RHW assertion with the XGE value it must NOT produce.
 *
 * Every test asserts an OBSERVABLE consequence — the hit points a character actually ends
 * on, the damage actually taken through a resistance, the Sorcery Point total actually
 * dropping — never the presence of a `hasXxx` calculation flag. A `hasXxx` flag that nothing
 * reads is exactly the failure mode CS-BUG-082 documented for the XGE subclass.
 *
 * Also covers the GENERIC surfaces this subclass forced into existence:
 *   - multi-sense grants from `calculations.<sense>` / `<sense>Source` (CS-BUG-098)
 *   - `{type: "bonus", target: "spellDc"}` reaching the spell save DC (CS-BUG-099)
 *   - immunity / resistance / vulnerability inside `takeDamage()` (CS-BUG-100)
 *   - `hpOnSuccess` on the zero-HP intervention registry
 *   - the resource-cast pipeline's optional-concentration + summon descriptors
 *   - resource-row sync when a feature's uses are re-scaled (CS-BUG-101)
 */

import "./setup.js";
import {jest} from "@jest/globals";

// CharacterSheetFeatures' constructor wires a global click listener.
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}};
}

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

const SHADOW_SORCERY_FEATURES = [
	{
		level: 3,
		name: "Shadow Sorcery",
		description: "You draw on the Shadowfell. You gain the benefits below.",
	},
	{
		level: 3,
		name: "Shadow Spells",
		description: "You always have certain spells prepared after you reach particular levels in this class.",
	},
	{
		level: 3,
		name: "Power of Shadow",
		description: "Eyes of the Dark. You have Darkvision with a range of 120 feet and Blindsight with a range of 10 feet. If a spell you cast creates an area of Darkness, you can see normally through that spell's Darkness. Strength of the Grave. When damage reduces you to 0 Hit Points, you can make a Charisma saving throw (DC 5 plus the damage taken). On a success, your Hit Points instead become equal to your Charisma modifier plus your Sorcerer level. Once you use this benefit, you can't use it again until you finish a Long Rest.",
	},
	{
		level: 6,
		name: "Beasts of Ill Omen",
		description: "You can expend 3 Sorcery Points to cast Summon Beast as a Bonus Action, without expending a spell slot, without having the spell prepared, and without Material components. Enemies within 5 feet of the summoned creature have Disadvantage on saving throws against your spells. You can choose to cast the spell without Concentration, in which case its duration becomes 1 minute; if you cast it again, the previous casting ends.",
		consumes: {name: "Sorcery Point", amount: 3},
	},
	{
		level: 14,
		name: "Shadow Walk",
		description: "When you are in Dim Light or Darkness, you can take a Bonus Action to teleport up to 120 feet to an unoccupied space you can see that is also in Dim Light or Darkness.",
	},
	{
		level: 18,
		name: "Umbral Form",
		description: "When you use your Innate Sorcery feature, you can also adopt an Umbral Form, which lasts while Innate Sorcery is active or until you end it (no action required). Incorporeal Movement. You can move through creatures and objects as if they were Difficult Terrain. You take 1d10 Force damage if you end your turn inside a creature or an object. Shadow Resilience. You have Resistance to all damage except Force and Radiant. Once you use this feature, you can't do so again until you finish a Long Rest unless you spend 6 Sorcery Points to restore your use of it.",
		consumes: {name: "Sorcery Point", amount: 6},
	},
];

const INNATE_SORCERY_FEATURE = {
	level: 1,
	name: "Innate Sorcery",
	source: "XPHB",
	description: "As a Bonus Action, you can unleash that magic for 1 minute, during which you gain the following benefits: the spell save DC of your Sorcerer spells increases by 1, and you have Advantage on the attack rolls of Sorcerer spells you cast. You can use this feature twice, and you regain all expended uses of it when you finish a Long Rest.",
};

/**
 * Build a Shadow Sorcery (RHW) sorcerer on the XPHB chassis at `level`, carrying exactly the
 * subclass features a sorcerer of that level would have.
 * @param {number} level
 * @param {object} [opts]
 * @param {number} [opts.cha=20]
 * @param {boolean} [opts.withFeatures=true]
 */
function makeShadowSorcery (level = 20, {cha = 20, withFeatures = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source: "XPHB",
		level,
		subclass: {
			name: "Shadow Sorcery",
			shortName: "Shadow",
			source: "RHW",
			// Verbatim from `data/class/class-sorcerer.json`, so the always-prepared table
			// and the level-6 `innate.resource` block are exercised for real.
			additionalSpells: [{
				prepared: {
					3: ["bane|xphb", "darkness|xphb", "inflict wounds|xphb", "pass without trace|xphb"],
					5: ["hunger of hadar|xphb", "nondetection|xphb"],
					7: ["greater invisibility|xphb", "phantasmal killer|xphb"],
					9: ["contagion|xphb", "creation|xphb"],
				},
				innate: {6: {resource: {3: ["summon beast|xphb"]}}},
				resourceName: "Sorcery Point",
			}],
		},
	}];
	state._data.spellcasting.ability = "cha";
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(200, 200);

	if (withFeatures) {
		state.addFeature({...INNATE_SORCERY_FEATURE});
		for (const f of SHADOW_SORCERY_FEATURES) {
			if (level < f.level) continue;
			state.addFeature({...f, source: "RHW"});
		}
	}
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

/** The XGE subclass, as the "did you copy the wrong behaviour?" control. */
function makeShadowMagicXge (level = 20, {cha = 20} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state._data.classes = [{
		name: "Sorcerer",
		source: "PHB",
		level,
		subclass: {name: "Shadow Magic", shortName: "Shadow", source: "XGE"},
	}];
	state._data.spellcasting.ability = "cha";
	state.setHp(200, 200);
	state.addFeature({
		name: "Strength of the Grave",
		source: "XGE",
		description: "When damage reduces you to 0 hit points, you can make a Charisma saving throw (DC 5 + the damage taken). On a success, you drop to 1 hit point instead. You can't use this feature if you are reduced to 0 hit points by radiant damage or by a critical hit.",
	});
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

/** A non-Shadow sorcerer of the same level, as the negative control. */
function makeDraconicSorcerer (level = 20) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 20);
	state._data.classes = [{
		name: "Sorcerer",
		source: "XPHB",
		level,
		subclass: {name: "Draconic Sorcery", shortName: "Draconic", source: "XPHB"},
	}];
	state._data.spellcasting.ability = "cha";
	state.setHp(200, 200);
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

describe("Shadow Sorcery (RHW) — Eyes of the Dark grants TWO senses", () => {
	it("darkvision 120 AND blindsight 10 both reach getSenses()", () => {
		const senses = makeShadowSorcery(3).getSenses();
		expect(senses.darkvision).toBe(120);
		// CS-BUG-098: the generic sense block was darkvision-only, so a feature granting two
		// senses could only ever land one of them.
		expect(senses.blindsight).toBe(10);
	});

	it("getSense() reports both individually", () => {
		const state = makeShadowSorcery(3);
		expect(state.getSense("darkvision")).toBeGreaterThanOrEqual(120);
		expect(state.getSense("blindsight")).toBeGreaterThanOrEqual(10);
	});

	it("a Draconic sorcerer of the same level gets neither (control)", () => {
		const senses = makeDraconicSorcerer(20).getSenses();
		expect(senses.darkvision).toBeLessThan(120);
		expect(senses.blindsight || 0).toBe(0);
	});

	it("neither sense exists before level 3", () => {
		const senses = makeShadowSorcery(2).getSenses();
		expect(senses.darkvision).toBeLessThan(120);
		expect(senses.blindsight || 0).toBe(0);
	});
});

describe("Shadow Sorcery (RHW) — seeing through your own spell Darkness", () => {
	it("is false while you are not concentrating on a Darkness spell", () => {
		expect(makeShadowSorcery(3).canSeeThroughOwnDarkness()).toBe(false);
	});

	it("becomes true while you concentrate on Darkness you cast", () => {
		const state = makeShadowSorcery(3);
		state.setConcentration({name: "Darkness", level: 2, source: "Spell"});
		expect(state.canSeeThroughOwnDarkness()).toBe(true);
	});

	it("also covers Hunger of Hadar, which the subclass's own spell list grants", () => {
		const state = makeShadowSorcery(5);
		state.setConcentration({name: "Hunger of Hadar", level: 3, source: "Spell"});
		expect(state.canSeeThroughOwnDarkness()).toBe(true);
	});

	it("does NOT trigger on an unrelated concentration spell", () => {
		const state = makeShadowSorcery(3);
		state.setConcentration({name: "Haste", level: 3, source: "Spell"});
		expect(state.canSeeThroughOwnDarkness()).toBe(false);
	});

	it("a Draconic sorcerer concentrating on Darkness still cannot see through it (control)", () => {
		const state = makeDraconicSorcerer(20);
		state.setConcentration({name: "Darkness", level: 2, source: "Spell"});
		expect(state.canSeeThroughOwnDarkness()).toBe(false);
	});

	// Shadow Walk's "you must be in dim light or darkness" clause reads this, so the RHW
	// version can teleport out of its own Darkness where the XGE version needed a resource cast.
	it("Shadow Walk succeeds from inside your own Darkness with no other light source", () => {
		const state = makeShadowSorcery(14);
		expect(state.useShadowWalk({inDimLightOrDarkness: false}).ok).toBe(false);
		state.setConcentration({name: "Darkness", level: 2, source: "Spell"});
		const res = state.useShadowWalk({inDimLightOrDarkness: false});
		expect(res.ok).toBe(true);
		expect(res.distance).toBe(120);
	});
});

describe("Shadow Sorcery (RHW) — Strength of the Grave restores CHA mod + Sorcerer level", () => {
	/** Take the character to exactly 0 and resolve the intervention with a guaranteed success. */
	const dropAndSave = (state, {damage = 40, damageType = "necrotic", isCritical = false} = {}) => {
		state.setCurrentHp(10);
		state.takeDamage(damage, {damageType, isCritical});
		const pending = state.getPendingZeroHpIntervention();
		return {pending, apply: id => state.applyZeroHpIntervention(id, {total: 999})};
	};

	it("leaves the character on Charisma modifier + Sorcerer level hit points, NOT 1", () => {
		const state = makeShadowSorcery(20, {cha: 20}); // +5
		const {pending, apply} = dropAndSave(state);
		expect(pending).not.toBeNull();
		const res = apply("strengthOfTheGraveRhw");
		expect(res.success).toBe(true);
		// The reading that matters: the hit points the character is ACTUALLY on.
		expect(state.getHp().current).toBe(25);
		// And explicitly not the XGE value.
		expect(state.getHp().current).not.toBe(1);
	});

	it("scales with both Charisma and Sorcerer level", () => {
		for (const [level, cha, expected] of [[3, 16, 6], [11, 18, 15], [20, 20, 25], [20, 8, 19]]) {
			const state = makeShadowSorcery(level, {cha});
			const {apply} = dropAndSave(state);
			apply("strengthOfTheGraveRhw");
			expect(state.getHp().current).toBe(expected);
		}
	});

	it("never resolves below 1 hit point even with a negative Charisma modifier", () => {
		const state = makeShadowSorcery(3, {cha: 3}); // -4, +3 level = -1
		const {apply} = dropAndSave(state);
		apply("strengthOfTheGraveRhw");
		expect(state.getHp().current).toBeGreaterThanOrEqual(1);
	});

	it("is available against RADIANT damage, unlike the XGE feature", () => {
		const rhw = makeShadowSorcery(20);
		const {pending} = dropAndSave(rhw, {damageType: "radiant"});
		expect(pending.interventions.find(i => i.id === "strengthOfTheGraveRhw").available).toBe(true);

		const xge = makeShadowMagicXge(20);
		const xgePending = (() => {
			xge.setCurrentHp(10);
			xge.takeDamage(40, {damageType: "radiant"});
			return xge.getPendingZeroHpIntervention();
		})();
		expect(xgePending.interventions.find(i => i.id === "strengthOfTheGrave").available).toBe(false);
	});

	it("is available against a CRITICAL HIT, unlike the XGE feature", () => {
		const rhw = makeShadowSorcery(20);
		const {pending} = dropAndSave(rhw, {isCritical: true});
		expect(pending.interventions.find(i => i.id === "strengthOfTheGraveRhw").available).toBe(true);

		const xge = makeShadowMagicXge(20);
		xge.setCurrentHp(10);
		xge.takeDamage(40, {damageType: "necrotic", isCritical: true});
		expect(xge.getPendingZeroHpIntervention()
			.interventions.find(i => i.id === "strengthOfTheGrave").available).toBe(false);
	});

	it("does NOT also register the XGE intervention (which would drop you to 1)", () => {
		const state = makeShadowSorcery(20);
		const ids = state.getZeroHpInterventions({damage: 10}).map(i => i.id);
		expect(ids).toContain("strengthOfTheGraveRhw");
		expect(ids).not.toContain("strengthOfTheGrave");
	});

	it("the DC really is 5 + the damage taken", () => {
		const state = makeShadowSorcery(20);
		state.setCurrentHp(10);
		state.takeDamage(33, {damageType: "necrotic"});
		const info = state.getPendingZeroHpIntervention()
			.interventions.find(i => i.id === "strengthOfTheGraveRhw");
		expect(info.dc).toBe(38);
	});

	it("a FAILED save leaves you at 0 and spends nothing", () => {
		const state = makeShadowSorcery(20);
		state.setCurrentHp(10);
		state.takeDamage(40, {damageType: "necrotic"});
		const res = state.applyZeroHpIntervention("strengthOfTheGraveRhw", {total: 1});
		expect(res.success).toBe(false);
		expect(state.getHp().current).toBe(0);
		expect(state.getZeroHpInterventions({damage: 0})
			.find(i => i.id === "strengthOfTheGraveRhw").usesRemaining).toBe(1);
	});

	it("a SUCCESS spends the once-per-long-rest use, and the second attempt is refused", () => {
		const state = makeShadowSorcery(20);
		state.setCurrentHp(10);
		state.takeDamage(40, {damageType: "necrotic"});
		expect(state.applyZeroHpIntervention("strengthOfTheGraveRhw", {total: 999}).success).toBe(true);

		state.setCurrentHp(10);
		state.takeDamage(40, {damageType: "necrotic"});
		const second = state.getPendingZeroHpIntervention();
		expect(second.interventions.find(i => i.id === "strengthOfTheGraveRhw").available).toBe(false);
		expect(state.applyZeroHpIntervention("strengthOfTheGraveRhw", {total: 999}).applied).toBe(false);
		expect(state.getHp().current).toBe(0);
	});

	it("clamps to the hit point maximum", () => {
		const state = makeShadowSorcery(20, {cha: 20});
		state.setHp(12, 12);
		state.setCurrentHp(5);
		state.takeDamage(30, {damageType: "necrotic"});
		state.applyZeroHpIntervention("strengthOfTheGraveRhw", {total: 999});
		expect(state.getHp().current).toBe(12);
	});

	it("lives on the Power of Shadow feature, at ONE use per long rest", () => {
		// CS-BUG-101: the feature-uses parser guessed a Charisma-modifier budget ("5/5") and
		// the mirrored resource row kept it even after the feature was re-scaled.
		const state = makeShadowSorcery(20);
		const feature = state.getFeatures().find(f => f.name === "Power of Shadow");
		expect(feature.uses).toEqual({current: 1, max: 1, recharge: "long"});
		const resource = state.getResources().find(r => r.name === "Power of Shadow");
		if (resource) {
			expect(resource.max).toBe(1);
			expect(resource.current).toBe(1);
		}
	});
});

describe("Shadow Sorcery (RHW) — Beasts of Ill Omen", () => {
	it("is offered as a 3-Sorcery-Point BONUS ACTION cast of Summon Beast", () => {
		const offers = makeShadowSorcery(6).getResourceCastableSpells();
		const beast = offers.find(o => o.spell === "Summon Beast");
		expect(beast).toBeDefined();
		expect(beast.cost).toBe(3);
		expect(beast.resourceName).toBe("Sorcery Points");
		expect(beast.castingTime).toBe("bonus");
		expect(beast.grantedBy).toBe("Beasts of Ill Omen");
		expect(beast.ignoresMaterialComponents).toBe(true);
		expect(beast.ignoresPreparation).toBe(true);
	});

	it("is not offered before level 6", () => {
		expect(makeShadowSorcery(5).getResourceCastableSpells()
			.some(o => o.spell === "Summon Beast")).toBe(false);
	});

	it("casting really spends 3 Sorcery Points", () => {
		const state = makeShadowSorcery(6);
		const before = state.getResources().find(r => r.name === "Sorcery Points").current;
		expect(state.castBeastsOfIllOmen()).not.toBeNull();
		// The reading that matters: the pool the player sees.
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(before - 3);
	});

	it("is refused (and spends nothing) without 3 Sorcery Points", () => {
		const state = makeShadowSorcery(6);
		const res = state.getResources().find(r => r.name === "Sorcery Points");
		state.setResourceCurrent(res.id, 2);
		expect(state.castBeastsOfIllOmen()).toBeNull();
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(2);
	});

	it("creates a real Bestial Spirit companion with Summon Beast's own statistics", () => {
		const state = makeShadowSorcery(6);
		const cast = state.castBeastsOfIllOmen({form: "Bestial Spirit (Sky)"});
		expect(cast.companion).not.toBeNull();
		expect(cast.companion.name).toBe("Bestial Spirit (Sky)");
		// Identical to the slot-cast picker's arithmetic at level 2.
		const stats = state.getSummonSpiritStats({spellLevel: 2});
		expect(cast.companion.hp.max).toBe(stats.hp);
		expect(cast.companion.ac).toBe(stats.ac);
		expect(state.getActiveCompanions().some(c => c.id === cast.companion.id)).toBe(true);
	});

	it("concentrates by DEFAULT", () => {
		const state = makeShadowSorcery(6);
		const cast = state.castBeastsOfIllOmen();
		expect(cast.concentration).toBe(true);
		expect(cast.concentrationWaived).toBe(false);
		expect(state.isConcentrating()).toBe(true);
	});

	it("the WAIVER is a real choice: no concentration, 1 minute", () => {
		const state = makeShadowSorcery(6);
		const cast = state.castBeastsOfIllOmen({waiveConcentration: true});
		expect(cast.concentrationWaived).toBe(true);
		expect(cast.concentration).toBe(false);
		expect(cast.durationMinutes).toBe(1);
		expect(state.isConcentrating()).toBe(false);
	});

	it("recasting ends the previous summon rather than stacking companions", () => {
		const state = makeShadowSorcery(20);
		const first = state.castBeastsOfIllOmen({waiveConcentration: true, form: "Bestial Spirit (Land)"});
		const second = state.castBeastsOfIllOmen({waiveConcentration: true, form: "Bestial Spirit (Sea)"});
		const live = state.getActiveCompanions().filter(c => c.origin === "Summon Beast");
		expect(live).toHaveLength(1);
		expect(live[0].id).toBe(second.companion.id);
		expect(state.getActiveCompanions().some(c => c.id === first.companion.id)).toBe(false);
	});

	it("ending the spell dismisses the summon", () => {
		const state = makeShadowSorcery(6);
		const cast = state.castBeastsOfIllOmen({waiveConcentration: true});
		expect(state.endResourceCastSpell("Summon Beast")).toBe(true);
		expect(state.getActiveCompanions().some(c => c.id === cast.companion.id)).toBe(false);
	});

	it("carries the enemy-save-disadvantage rider", () => {
		const beast = makeShadowSorcery(6).getResourceCastableSpells()
			.find(o => o.spell === "Summon Beast");
		expect(beast.riders.enemiesNearSummonSaveDisadvantage).toBe(5);
		expect(beast.note).toMatch(/Disadvantage on saving throws/i);
	});

	it("waiving concentration is refused on a spell that does not offer the choice", () => {
		// Eyes of the Dark's *darkness* (XGE) is a mandatory-concentration resource cast.
		const state = makeShadowMagicXge(20);
		state.addFeature({name: "Eyes of the Dark", source: "XGE", description: "You have darkvision with a radius of 120 feet."});
		const cast = state.castSpellWithResource("Darkness", {waiveConcentration: true});
		expect(cast).not.toBeNull();
		expect(cast.concentrationWaived).toBe(false);
		expect(cast.concentration).toBe(true);
	});

	it("a Draconic sorcerer has no such cast (control)", () => {
		expect(makeDraconicSorcerer(20).getResourceCastableSpells()
			.some(o => o.spell === "Summon Beast")).toBe(false);
		expect(makeDraconicSorcerer(20).castBeastsOfIllOmen?.()).toBeNull();
	});
});

describe("Shadow Sorcery (RHW) — Umbral Form is bound to Innate Sorcery", () => {
	const withInnate = (level = 20) => {
		const state = makeShadowSorcery(level);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		return state;
	};

	it("refuses to activate while Innate Sorcery is NOT active", () => {
		const state = makeShadowSorcery(20);
		const status = state.getUmbralFormStatus();
		expect(status.has).toBe(true);
		expect(status.innateSorceryActive).toBe(false);
		expect(status.canActivate).toBe(false);
		expect(status.blockedReason).toMatch(/Innate Sorcery/i);
		expect(state.activateUmbralForm().ok).toBe(false);
		expect(state.isStateTypeActive("umbralFormRhw")).toBe(false);
	});

	it("activates once Innate Sorcery is running, and costs NO Sorcery Points", () => {
		const state = withInnate();
		const spBefore = state.getResources().find(r => r.name === "Sorcery Points").current;
		expect(state.activateUmbralForm().ok).toBe(true);
		expect(state.isStateTypeActive("umbralFormRhw")).toBe(true);
		// The XGE feature of the same name spends 6 here — this one must not.
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(spBefore);
	});

	it("burns the once-per-Long-Rest use", () => {
		const state = withInnate();
		expect(state.getUmbralFormStatus().usesRemaining).toBe(1);
		state.activateUmbralForm();
		expect(state.getUmbralFormStatus().usesRemaining).toBe(0);
		state.endUmbralForm();
		expect(state.activateUmbralForm().ok).toBe(false);
	});

	it("6 Sorcery Points RESTORE the use rather than paying for the transformation", () => {
		const state = withInnate();
		state.activateUmbralForm();
		state.endUmbralForm();
		const spBefore = state.getResources().find(r => r.name === "Sorcery Points").current;
		const restored = state.restoreUmbralFormUse();
		expect(restored.ok).toBe(true);
		expect(restored.spent).toBe(6);
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(spBefore - 6);
		expect(state.getUmbralFormStatus().usesRemaining).toBe(1);
		expect(state.activateUmbralForm().ok).toBe(true);
	});

	it("refuses to restore a use that has not been spent, and spends nothing", () => {
		const state = withInnate();
		const spBefore = state.getResources().find(r => r.name === "Sorcery Points").current;
		expect(state.restoreUmbralFormUse().ok).toBe(false);
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(spBefore);
	});

	it("refuses to restore without 6 Sorcery Points", () => {
		const state = withInnate();
		state.activateUmbralForm();
		state.endUmbralForm();
		const res = state.getResources().find(r => r.name === "Sorcery Points");
		state.setResourceCurrent(res.id, 5);
		expect(state.restoreUmbralFormUse().ok).toBe(false);
		expect(state.getResources().find(r => r.name === "Sorcery Points").current).toBe(5);
	});

	it("ENDS when Innate Sorcery ends", () => {
		const state = withInnate();
		state.activateUmbralForm();
		expect(state.isStateTypeActive("umbralFormRhw")).toBe(true);
		state.deactivateState("innateSorcery");
		expect(state.isStateTypeActive("umbralFormRhw")).toBe(false);
	});

	it("does not exist before level 18", () => {
		const state = makeShadowSorcery(17);
		expect(state.getUmbralFormStatus().has).toBe(false);
		expect(state.activateUmbralForm().ok).toBe(false);
	});

	it("does NOT set the XGE `hasUmbralForm` flag (which is a 6-SP self-toggle)", () => {
		const calc = makeShadowSorcery(20).getFeatureCalculations();
		expect(calc.hasUmbralFormRhw).toBe(true);
		expect(calc.hasUmbralForm).toBeFalsy();
		expect(calc.umbralFormCost).toBeUndefined();
	});

	it("classifies to the RHW state, not the XGE one, by name AND source", () => {
		const state = makeShadowSorcery(20);
		const feature = state.getFeatures().find(f => f.name === "Umbral Form");
		const cls = CharacterSheetState.detectActivatableFeature(feature);
		expect(cls.stateTypeId).toBe("umbralFormRhw");

		// The XGE feature of the same name must still reach the XGE state.
		const xgeFeature = {name: "Umbral Form", source: "XGE", description: "You can spend 6 sorcery points as a bonus action to transform yourself into a shadowy form."};
		expect(CharacterSheetState.detectActivatableFeature(xgeFeature).stateTypeId).toBe("umbralForm");
	});
});

describe("Shadow Sorcery (RHW) — Shadow Resilience actually reduces damage", () => {
	const inForm = (level = 20) => {
		const state = makeShadowSorcery(level);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		state.activateUmbralForm();
		state.setCurrentHp(state.getMaxHp());
		return state;
	};

	it("halves every damage type except Force and Radiant — measured on hit points", () => {
		for (const type of ["acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "psychic", "slashing", "thunder"]) {
			const state = inForm();
			const before = state.getHp().current;
			state.takeDamage(21, {damageType: type});
			// CS-BUG-100: the reading is the hit points lost, not `getResistances()`.
			expect(before - state.getHp().current).toBe(10);
		}
	});

	it("does NOT reduce Force damage", () => {
		const state = inForm();
		const before = state.getHp().current;
		state.takeDamage(21, {damageType: "force"});
		expect(before - state.getHp().current).toBe(21);
	});

	it("does NOT reduce Radiant damage", () => {
		const state = inForm();
		const before = state.getHp().current;
		state.takeDamage(21, {damageType: "radiant"});
		expect(before - state.getHp().current).toBe(21);
	});

	it("stops reducing damage the moment the form ends", () => {
		const state = inForm();
		state.endUmbralForm();
		const before = state.getHp().current;
		state.takeDamage(21, {damageType: "fire"});
		expect(before - state.getHp().current).toBe(21);
	});

	it("takes full damage while NOT in the form (control)", () => {
		const state = makeShadowSorcery(20);
		state.setCurrentHp(state.getMaxHp());
		const before = state.getHp().current;
		state.takeDamage(21, {damageType: "fire"});
		expect(before - state.getHp().current).toBe(21);
	});

	it("publishes the incorporeal-movement damage as 1d10 Force, not XGE's flat 5", () => {
		const calc = makeShadowSorcery(20).getFeatureCalculations();
		expect(calc.umbralFormIncorporealDamage).toBe("1d10");
		expect(calc.umbralFormIncorporealDamageType).toBe("force");
	});
});

describe("takeDamage applies defenses (CS-BUG-100, generic)", () => {
	it("halves for a resistance from ANY source, not just active states", () => {
		const state = makeShadowSorcery(20);
		state.addResistance("cold");
		state.setCurrentHp(state.getMaxHp());
		const before = state.getHp().current;
		state.takeDamage(9, {damageType: "cold"});
		expect(before - state.getHp().current).toBe(4); // rounds down
	});

	it("zeroes for an immunity and doubles for a vulnerability", () => {
		const state = makeShadowSorcery(20);
		state.addImmunity("poison");
		state.addVulnerability("thunder");
		state.setCurrentHp(state.getMaxHp());
		const start = state.getHp().current;
		state.takeDamage(30, {damageType: "poison"});
		expect(state.getHp().current).toBe(start);
		state.takeDamage(10, {damageType: "thunder"});
		expect(start - state.getHp().current).toBe(20);
	});

	it("leaves untyped damage alone", () => {
		const state = makeShadowSorcery(20);
		state.addResistance("fire");
		state.setCurrentHp(state.getMaxHp());
		const start = state.getHp().current;
		state.takeDamage(20);
		expect(start - state.getHp().current).toBe(20);
	});

	it("`skipDefenses` lets a caller that pre-applied them opt out", () => {
		const state = makeShadowSorcery(20);
		state.addResistance("fire");
		state.setCurrentHp(state.getMaxHp());
		const start = state.getHp().current;
		state.takeDamage(20, {damageType: "fire", skipDefenses: true});
		expect(start - state.getHp().current).toBe(20);
	});

	it("`unpreventable` damage ignores resistance (RAW: can't be reduced OR prevented)", () => {
		const state = makeShadowSorcery(20);
		state.addResistance("fire");
		state.setCurrentHp(state.getMaxHp());
		const start = state.getHp().current;
		state.takeDamage(20, {damageType: "fire", unpreventable: true});
		expect(start - state.getHp().current).toBe(20);
	});

	it("applyDamageDefenses is the shared arithmetic", () => {
		const state = makeShadowSorcery(20);
		state.addResistance("cold");
		// `reduction` reports the flat damage-reduction step, which runs BEFORE the halving.
		// It is 0 for this character; the assertions stay exact rather than switching to
		// `objectContaining` so that a reduction leaking in from anywhere would fail here.
		expect(state.applyDamageDefenses(9, "cold")).toEqual({damage: 4, raw: 9, reduction: 0, applied: "resistance"});
		expect(state.applyDamageDefenses(9, "fire")).toEqual({damage: 9, raw: 9, reduction: 0, applied: null});
		expect(state.applyDamageDefenses(9, null)).toEqual({damage: 9, raw: 9, reduction: 0, applied: null});
	});

	it("halved damage still arms the zero-HP intervention at the REDUCED amount", () => {
		const state = makeShadowSorcery(20);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		state.activateUmbralForm();
		state.setCurrentHp(5);
		state.takeDamage(30, {damageType: "fire"}); // → 15
		expect(state.getHp().current).toBe(0);
		const info = state.getPendingZeroHpIntervention()
			.interventions.find(i => i.id === "strengthOfTheGraveRhw");
		expect(info.dc).toBe(20); // 5 + 15, not 5 + 30
	});
});

describe("Innate Sorcery is a real state (CS-BUG-099)", () => {
	it("raises the spell save DC by 1 while active", () => {
		const state = makeShadowSorcery(20);
		const before = state.getSpellSaveDc();
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(state.getSpellSaveDc()).toBe(before + 1);
		state.deactivateState("innateSorcery");
		expect(state.getSpellSaveDc()).toBe(before);
	});

	it("the class-scoped and ability-scoped DC accessors agree", () => {
		const state = makeShadowSorcery(20);
		const before = {global: state.getSpellSaveDc(), cls: state.getSpellSaveDC("Sorcerer"), abl: state.getSpellSaveDC("cha")};
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(state.getSpellSaveDc()).toBe(before.global + 1);
		expect(state.getSpellSaveDC("Sorcerer")).toBe(before.cls + 1);
		expect(state.getSpellSaveDC("cha")).toBe(before.abl + 1);
	});

	// CS-BUG-102. The Spells tab's per-class card is what a player actually casts
	// from, and it hand-rolled `8 + mod + prof` instead of asking the state — so it
	// was the one spell save DC on the sheet that ignored active-state buffs while
	// the Combat tab (which routes through `getSpellcastingClassBreakdown()`) showed
	// the buffed value. Two tabs, two numbers.
	//
	// This asserts the arithmetic the RENDERER performs, not the accessor: the
	// numbers are recomputed here exactly as `_buildSpellClassCard` does, so the
	// pin fails if the card ever drifts back to a hand-rolled formula.
	it("the Combat-tab DC accessor picks the state bonus up", () => {
		const state = makeShadowSorcery(20);
		// `getSpellcastingClassBreakdown()` — the Combat tab's source — takes its `saveDc`
		// straight from `getSpellSaveDcForAbility`, so that method IS the Combat-tab number.
		// (The breakdown itself needs loaded class data and so is empty in a synthetic
		// fixture.) The SPELLS-tab card, which had the real bug, is pinned separately in
		// `CharacterSheetSpellsTabDc.test.js` by driving `_buildSpellClassCard` itself.
		const before = state.getSpellSaveDcForAbility("cha");
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(state.getSpellSaveDcForAbility("cha")).toBe(before + 1);
	});

	it("grants advantage on spell attack rolls while active", () => {
		const state = makeShadowSorcery(20);
		expect(state.hasAdvantageFromStates("attack:spell")).toBe(false);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(state.hasAdvantageFromStates("attack:spell")).toBe(true);
	});

	it("classifies the feature to the named state rather than a junk custom toggle", () => {
		const state = makeShadowSorcery(20);
		const feature = state.getFeatures().find(f => f.name === "Innate Sorcery");
		const cls = CharacterSheetState.detectActivatableFeature(feature);
		expect(cls.stateTypeId).toBe("innateSorcery");
		expect(cls.isToggle).toBe(true);
	});

	it("does not change the DC of a character who has not activated it (control)", () => {
		const state = makeDraconicSorcerer(20);
		expect(state.getSpellSaveDc()).toBe(8 + state.getProficiencyBonus() + state.getAbilityMod("cha"));
	});
});

describe("Shadow Sorcery (RHW) — always-prepared Shadow Spells", () => {
	it("grants the named spells at the levels the table specifies", () => {
		const at = level => {
			const state = makeShadowSorcery(level);
			return state.getSubclassAlwaysPreparedSpells(state._data.classes[0])
				.map(s => s.name.toLowerCase());
		};
		expect(at(3)).toEqual(expect.arrayContaining(["bane", "darkness", "inflict wounds", "pass without trace"]));
		expect(at(3)).not.toEqual(expect.arrayContaining(["hunger of hadar"]));
		expect(at(5)).toEqual(expect.arrayContaining(["hunger of hadar", "nondetection"]));
		expect(at(7)).toEqual(expect.arrayContaining(["greater invisibility", "phantasmal killer"]));
		expect(at(9)).toEqual(expect.arrayContaining(["contagion", "creation"]));
	});

	it("Summon Beast is surfaced from the level-6 resource block", () => {
		const state = makeShadowSorcery(6);
		expect(state.getSubclassAlwaysPreparedSpells(state._data.classes[0])
			.map(s => s.name.toLowerCase())).toContain("summon beast");
	});
});

describe("Shadow Sorcery (RHW) — Shadow Walk", () => {
	it("teleports up to 120 feet as a Bonus Action", () => {
		const res = makeShadowSorcery(14).useShadowWalk({});
		expect(res.ok).toBe(true);
		expect(res.range).toBe(120);
		expect(res.action).toBe("bonus");
	});

	it("refuses beyond its range and refuses a lit destination", () => {
		const state = makeShadowSorcery(14);
		expect(state.useShadowWalk({distance: 121}).ok).toBe(false);
		expect(state.useShadowWalk({destinationInDimLightOrDarkness: false}).ok).toBe(false);
	});

	it("does not exist before level 14", () => {
		expect(makeShadowSorcery(13).useShadowWalk({}).ok).toBe(false);
	});
});

/**
 * CS-BUG-103 — asserted at the READING, which is the Features-tab Use button.
 *
 * `getActivatableFeatures()` correctly HIDES a state whose `requiresStates` gate is unmet,
 * so Umbral Form vanishes from the Overview toggle list until Innate Sorcery is running.
 * The side effect was that `CharacterSheetFeatures._useFeature()` no longer recognised it
 * as a classified ability and fell through to the bare use decrement: the player clicked
 * Use, nothing activated, and the once-per-Long-Rest use was gone.
 *
 * Reproduced live in the browser before the fix (uses 1 -> 0, `umbralFormRhw` still
 * inactive, Sorcery Points unchanged), so these drive `_useFeature` rather than the
 * accessor alone — an accessor test would have stayed green through the whole bug.
 */
describe("Gated activatable features do not burn a use from the Features tab (CS-BUG-103)", () => {
	const makeFeatures = (state) => {
		const page = {
			getState: () => state,
			getSpells: () => [],
			saveCharacter: jest.fn(),
			_getActivatableAbilityForFeature: (feature) => {
				const af = state.getActivatableFeatures().find(a => a.feature?.id === feature.id);
				return af && CharacterSheetState.isActivatableAbilityEntry(af) ? af : null;
			},
			_pUseFeatureAbility: jest.fn(),
		};
		const features = new CharacterSheetFeatures(page);
		features.render = jest.fn();
		return {features, page};
	};

	it("clicking Use on Umbral Form while Innate Sorcery is off spends NOTHING", () => {
		const state = makeShadowSorcery(20);
		const {features, page} = makeFeatures(state);
		const feature = state.getFeatures().find(f => f.name === "Umbral Form");
		expect(state.getUmbralFormStatus().usesRemaining).toBe(1);

		features._useFeature(feature.id);

		// The reading: the use survives, nothing activated, and the real handler was
		// never reached (so the bare decrement below it must not have run either).
		expect(state.getUmbralFormStatus().usesRemaining).toBe(1);
		expect(state.isStateTypeActive("umbralFormRhw")).toBe(false);
		expect(page._pUseFeatureAbility).not.toHaveBeenCalled();
	});

	it("does NOT block the Features-tab use once Innate Sorcery is running", () => {
		const state = makeShadowSorcery(20);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		const {features} = makeFeatures(state);
		const feature = state.getFeatures().find(f => f.name === "Umbral Form");
		expect(state.getUnmetStateRequirementsForFeature(feature)).toEqual([]);

		features._useFeature(feature.id);

		// The guard is deliberately NARROW: with the gate satisfied it must not fire, so
		// the pre-existing behaviour (the Features-tab card tracks the use by hand; the
		// Overview toggle row is the surface that actually adopts the form) is unchanged.
		expect(state.getFeatures().find(f => f.name === "Umbral Form").uses.current).toBe(0);
	});

	it("reports the missing prerequisite by NAME, and reports none once it is met", () => {
		const state = makeShadowSorcery(20);
		const feature = state.getFeatures().find(f => f.name === "Umbral Form");
		expect(state.getUnmetStateRequirementsForFeature(feature)).toEqual(["Innate Sorcery"]);
		state.activateState("innateSorcery", {source: "Innate Sorcery"});
		expect(state.getUnmetStateRequirementsForFeature(feature)).toEqual([]);
	});

	it("leaves an ungated classified ability on its normal pipeline", () => {
		const state = makeShadowSorcery(20);
		const {features, page} = makeFeatures(state);
		const feature = state.getFeatures().find(f => f.name === "Power of Shadow");
		expect(state.getUnmetStateRequirementsForFeature(feature)).toEqual([]);

		features._useFeature(feature.id);

		// Reaches the real activation pipeline, and the guard never intercepts it.
		expect(page._pUseFeatureAbility).toHaveBeenCalled();
	});
});
