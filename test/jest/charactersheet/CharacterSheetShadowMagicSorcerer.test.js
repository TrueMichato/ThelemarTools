/**
 * Shadow Magic Sorcerer (XGE) — mechanical-effect coverage.
 *
 * Every test here asserts an OBSERVABLE consequence (a sense range, a hit-point value, a
 * resistance list, a spent resource, a companion stat), never the mere presence of a
 * `hasXxx` calculation flag. The `hasXxx` flags existed for this subclass long before this
 * suite and were pure dead code — see CS-BUG-082.
 *
 * Also covers the GENERIC base-class surfaces this subclass forced into existence, because
 * four more Sorcerer subclasses depend on them:
 *   - `CharacterSheetState.getSorceryPointsMaxForClass` / `_ensureSorceryPoints` (CS-BUG-080)
 *   - the zero-HP intervention registry (`ZERO_HP_INTERVENTIONS`)
 *   - `scaling.tempHpPerLevel` on CLASS_SUMMON companions
 *   - `calculations.resourceCastSpells`
 *   - `noNameDetect` on programmatically-applied active states (CS-BUG-083)
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const SHADOW_MAGIC_FEATURES = [
	{
		level: 1,
		name: "Eyes of the Dark",
		description: "You have darkvision with a radius of 120 feet. When you reach 3rd level in this class, you learn the darkness spell, which doesn't count against your number of sorcerer spells known. In addition, you can cast it by spending 2 sorcery points or by expending a spell slot. If you cast it with sorcery points, you can see through any darkness created by the spell.",
	},
	{
		level: 1,
		name: "Strength of the Grave",
		description: "When damage reduces you to 0 hit points, you can make a Charisma saving throw (DC 5 + the damage taken). On a success, you drop to 1 hit point instead. You can't use this feature if you are reduced to 0 hit points by radiant damage or by a critical hit. After the saving throw succeeds, you can't use this feature again until you finish a long rest.",
	},
	{
		level: 6,
		name: "Hound of Ill Omen",
		description: "As a bonus action, you can spend 3 sorcery points to summon a hound of ill omen to target one creature you can see within 120 feet of you.",
		consumes: {name: "Sorcery Point", amount: 3},
	},
	{
		level: 14,
		name: "Shadow Walk",
		description: "When you are in dim light or darkness, as a bonus action, you can teleport up to 120 feet to an unoccupied space you can see that is also in dim light or darkness.",
	},
	{
		level: 18,
		name: "Umbral Form",
		description: "You can spend 6 sorcery points as a bonus action to transform yourself into a shadowy form. In this form, you have resistance to all damage except force and radiant damage, and you can move through other creatures and objects as if they were difficult terrain.",
		consumes: {name: "Sorcery Point", amount: 6},
	},
];

/**
 * Build a Shadow Magic sorcerer at `level`, carrying exactly the subclass features that a
 * sorcerer of that level would have.
 * @param {number} level
 * @param {object} [opts]
 * @param {string} [opts.source="PHB"] class source (use "TGTT" for the homebrew chassis).
 * @param {number} [opts.cha=18]
 * @param {boolean} [opts.withFeatures=true]
 */
function makeShadowSorcerer (level = 20, {source = "PHB", cha = 18, withFeatures = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source,
		level,
		subclass: {name: "Shadow Magic", shortName: "Shadow", source: "XGE"},
	}];
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(60, 60);

	if (withFeatures) {
		for (const f of SHADOW_MAGIC_FEATURES) {
			if (level < f.level) continue;
			state.addFeature({...f, source: "XGE"});
		}
	}
	state.applyClassFeatureEffects();
	// Mint the resource pools the level-up wizard would have created.
	state.getResources();
	return state;
}

/** A non-Shadow sorcerer of the same level, as the negative control. */
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

describe("Shadow Magic Sorcerer — base-class Sorcery Point machinery (CS-BUG-080)", () => {
	it("has ONE source of truth for the pool size across every chassis", () => {
		const f = (source, level) => CharacterSheetState.getSorceryPointsMaxForClass({name: "Sorcerer", source, level});
		// PHB/XPHB: Font of Magic at 2.
		expect(f("PHB", 1)).toBe(0);
		expect(f("PHB", 2)).toBe(2);
		expect(f("PHB", 20)).toBe(20);
		expect(f("XPHB", 1)).toBe(0);
		expect(f("XPHB", 5)).toBe(5);
		// TGTT: Font of Magic at 1 and its class table starts at 2 → `level + 1`
		// (CS-BUG-084 — CS-BUG-018 resolved the same disagreement the other way and
		// made the writer one point stingy at every level).
		expect(f("TGTT", 1)).toBe(2);
		expect(f("TGTT", 3)).toBe(4);
		expect(f("TGTT", 20)).toBe(21);
		// Not a sorcerer → nothing.
		expect(f("PHB", 20) && CharacterSheetState.getSorceryPointsMaxForClass({name: "Wizard", source: "PHB", level: 20})).toBe(0);
	});

	it("the calculation now matches the pool actually rendered (CS-BUG-080 regression)", () => {
		for (const [source, level, expected] of [["TGTT", 3, 4], ["PHB", 3, 3], ["PHB", 1, 0], ["XPHB", 11, 11]]) {
			const state = makeShadowSorcerer(level, {source});
			expect(state.getFeatureCalculations().sorceryPoints ?? 0).toBe(expected);
			// The two used to disagree by exactly one on the TGTT chassis.
			expect(state.getFeatureCalculations().sorceryPoints ?? 0)
				.toBe(state.getSorceryPoints()?.max ?? 0);
		}
	});

	it("mints the pool for a Sorcerer that never went through the level-up wizard", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("cha", 16);
		state._data.classes = [{name: "Sorcerer", source: "PHB", level: 7}];
		// No `updateClassResources`, no wizard — exactly the `spawn`/legacy-save shape.
		expect(state.getSorceryPoints()).toEqual({current: 7, max: 7});
		expect(state.getResources().some(r => r.name === "Sorcery Points")).toBe(true);
	});

	it("mints nothing for a level-1 PHB Sorcerer, who has no Font of Magic yet", () => {
		const state = makeShadowSorcerer(1);
		expect(state.getResources().some(r => r.name === "Sorcery Points")).toBe(false);
	});

	it("never clobbers an existing pool — tuning and explicit overrides both survive", () => {
		const state = makeShadowSorcerer(6);
		expect(state.getSorceryPoints().max).toBe(6);
		state.useSorceryPoint(4);
		// Reading the resource list must not refund the spend or re-raise the max.
		state.getResources();
		expect(state.getSorceryPoints()).toEqual({current: 2, max: 6});

		state.setSorceryPoints({current: 1, max: 3});
		state.getResources();
		expect(state.getSorceryPoints()).toEqual({current: 1, max: 3});
	});
});

describe("Shadow Magic Sorcerer — Eyes of the Dark (level 1)", () => {
	it("actually grants 120 ft darkvision to the character's senses (CS-BUG-082)", () => {
		const state = makeShadowSorcerer(1);
		expect(state.getSense("darkvision")).toBe(120);
		expect(state.getSenses().darkvision).toBe(120);
	});

	it("does not shrink a species darkvision, and is not granted to other origins", () => {
		const state = makeShadowSorcerer(1);
		state.setSense("darkvision", 60);
		state.applyClassFeatureEffects();
		expect(state.getSense("darkvision")).toBe(120);

		expect(makeDraconicSorcerer(20).getSense("darkvision")).toBe(0);
	});

	it("offers darkness as a 2-Sorcery-Point cast only from sorcerer level 3", () => {
		expect(makeShadowSorcerer(2).getResourceCastableSpells()).toEqual([]);

		const state = makeShadowSorcerer(3);
		const offers = state.getResourceCastableSpells();
		expect(offers).toHaveLength(1);
		expect(offers[0]).toMatchObject({
			spell: "Darkness",
			cost: 2,
			resourceName: "Sorcery Points",
			grantedBy: "Eyes of the Dark",
			available: true,
			concentration: true,
		});
	});

	it("spends 2 Sorcery Points, starts concentration and lets you see through your own darkness", () => {
		const state = makeShadowSorcerer(5);
		expect(state.canSeeThroughOwnDarkness()).toBe(false);

		const res = state.castSpellWithResource("Darkness");
		expect(res).toMatchObject({spent: 2, resourceRemaining: 3});
		expect(state.getSorceryPoints().current).toBe(3);
		expect(state.canSeeThroughOwnDarkness()).toBe(true);
		expect(state.getConcentration()?.spellName).toBe("Darkness");

		expect(state.endResourceCastSpell("Darkness")).toBe(true);
		expect(state.canSeeThroughOwnDarkness()).toBe(false);
	});

	it("refuses the cast when Sorcery Points are short", () => {
		const state = makeShadowSorcerer(3);
		expect(state.useSorceryPoint(2)).toBe(true); // 3 -> 1
		expect(state.getResourceCastableSpells()[0].available).toBe(false);
		expect(state.castSpellWithResource("Darkness")).toBeNull();
		expect(state.getSorceryPoints().current).toBe(1);
	});

	it("is not hijacked by the TGTT Shadow Knight state of the same name (CS-BUG-083)", () => {
		const state = makeShadowSorcerer(3);
		const feature = state.getFeatures().find(f => f.name === "Eyes of the Dark");
		const info = CharacterSheetState.detectActivatableFeature(feature);
		// The Shadow Knight's "Eyes of the Dark" grants FOUR ALLIES 60 ft Dark Gaze; the
		// sorcerer's grants the sorcerer 120 ft. Matching it would render the wrong toggle.
		expect(info?.stateTypeId).not.toBe("eyesOfTheDark");
		expect(info?.matchedBy).toBe("classificationOverride");
	});
});

describe("Shadow Magic Sorcerer — Strength of the Grave (level 1)", () => {
	/** Drop the character to exactly 0 hit points with `damage`. */
	const dropToZero = (state, damage = 20, opts = {}) => {
		state.setHp(damage, 60);
		return state.takeDamage(damage, opts);
	};

	it("arms a real save-based intervention when damage takes you to 0", () => {
		const state = makeShadowSorcerer(1);
		expect(state.getPendingZeroHpIntervention()).toBeNull();

		dropToZero(state, 12);
		expect(state.getCurrentHp()).toBe(0);

		const pending = state.getPendingZeroHpIntervention();
		expect(pending).not.toBeNull();
		const sotg = pending.interventions.find(i => i.id === "strengthOfTheGrave");
		expect(sotg).toMatchObject({
			available: true,
			saveAbility: "cha",
			dc: 17, // 5 + 12 damage taken
			usesRemaining: 1,
		});
		// The save modifier is the character's real CHA save (+4 CHA, proficient, PB +2).
		expect(sotg.saveModifier).toBe(state.getSaveMod("cha"));
	});

	it("drops you to 1 hit point on a successful save and spends the use", () => {
		const state = makeShadowSorcerer(1);
		dropToZero(state, 10); // DC 15
		const res = state.applyZeroHpIntervention("strengthOfTheGrave", {total: 15});
		expect(res).toMatchObject({applied: true, success: true, dc: 15});
		expect(state.getCurrentHp()).toBe(1);
		expect(state.getZeroHpInterventions().find(i => i.id === "strengthOfTheGrave").usesRemaining).toBe(0);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});

	it("leaves you at 0 on a failed save WITHOUT spending the use", () => {
		const state = makeShadowSorcerer(1);
		dropToZero(state, 10); // DC 15
		const res = state.applyZeroHpIntervention("strengthOfTheGrave", {total: 14});
		expect(res).toMatchObject({applied: true, success: false, dc: 15});
		expect(state.getCurrentHp()).toBe(0);
		// RAW: "After the saving throw SUCCEEDS, you can't use this feature again".
		expect(state.getZeroHpInterventions().find(i => i.id === "strengthOfTheGrave").usesRemaining).toBe(1);
	});

	it("is unavailable against radiant damage", () => {
		const state = makeShadowSorcerer(1);
		dropToZero(state, 10, {damageType: "radiant"});
		const sotg = state.getPendingZeroHpIntervention().interventions[0];
		expect(sotg.available).toBe(false);
		expect(sotg.unavailableReason).toMatch(/radiant/i);
		expect(state.applyZeroHpIntervention("strengthOfTheGrave", {total: 30})).toMatchObject({applied: false});
		expect(state.getCurrentHp()).toBe(0);
	});

	it("is unavailable against a critical hit", () => {
		const state = makeShadowSorcerer(1);
		dropToZero(state, 10, {isCritical: true});
		const sotg = state.getPendingZeroHpIntervention().interventions[0];
		expect(sotg.available).toBe(false);
		expect(sotg.unavailableReason).toMatch(/critical/i);
		expect(state.applyZeroHpIntervention("strengthOfTheGrave", {total: 30})).toMatchObject({applied: false});
		expect(state.getCurrentHp()).toBe(0);
	});

	it("recharges on a long rest", () => {
		const state = makeShadowSorcerer(1);
		dropToZero(state, 10);
		state.applyZeroHpIntervention("strengthOfTheGrave", {total: 20});
		expect(state.getZeroHpInterventions().find(i => i.id === "strengthOfTheGrave").usesRemaining).toBe(0);

		state.onLongRest();
		expect(state.getZeroHpInterventions().find(i => i.id === "strengthOfTheGrave").usesRemaining).toBe(1);
	});

	it("is not offered to a sorcerer without the feature", () => {
		const state = makeDraconicSorcerer(20);
		state.setHp(10, 60);
		state.takeDamage(10);
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getZeroHpInterventions()).toEqual([]);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});

	it("does not fire when temporary hit points absorb the blow", () => {
		const state = makeShadowSorcerer(1);
		state.setHp(10, 60);
		state.setTempHp(15);
		state.takeDamage(12);
		expect(state.getCurrentHp()).toBe(10);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});
});

describe("Shadow Magic Sorcerer — Hound of Ill Omen (level 6)", () => {
	it("spends 3 Sorcery Points and registers a scaled CLASS_SUMMON companion", () => {
		const state = makeShadowSorcerer(6);
		expect(state.getSorceryPoints().current).toBe(6);

		const res = state.summonHoundOfIllOmen();
		expect(res.ok).toBe(true);
		expect(state.getSorceryPoints().current).toBe(3);

		const hound = state.getHoundOfIllOmen();
		expect(hound).not.toBeNull();
		expect(hound.type).toBe(CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON);
		// RAW deltas from the dire wolf: Medium, monstrosity.
		expect(hound.size).toBe("M");
		expect(hound.creatureType).toBe("monstrosity");
		// …everything else is the dire wolf's.
		expect(hound.ac).toBe(14);
		expect(hound.hp.max).toBe(37);
		expect(hound.speed.walk).toBe(50);
		expect(hound.attacks[0]).toMatchObject({name: "Bite", attackBonus: 5, damage: "2d6+3", damageType: "piercing"});
	});

	it("appears with temporary hit points equal to HALF the sorcerer level, declaratively", () => {
		const l6 = makeShadowSorcerer(6);
		l6.summonHoundOfIllOmen();
		expect(l6.getHoundOfIllOmen().hp.temp).toBe(3);

		const l20 = makeShadowSorcerer(20);
		l20.summonHoundOfIllOmen();
		expect(l20.getHoundOfIllOmen().hp.temp).toBe(10);

		// The number is produced by the GENERIC scaling pass, not a bespoke branch.
		expect(l20.getHoundOfIllOmen().scaling).toEqual({className: "Sorcerer", tempHpPerLevel: 0.5});
	});

	it("re-scales its temporary hit points through recalculateCompanion on level-up", () => {
		const state = makeShadowSorcerer(7);
		state.summonHoundOfIllOmen();
		const hound = state.getHoundOfIllOmen();
		expect(hound.hp.temp).toBe(3);

		state._data.classes[0].level = 17;
		state.recalculateCompanion(hound.id);
		expect(state.getHoundOfIllOmen().hp.temp).toBe(8);
	});

	it("refuses when Sorcery Points are short, and never half-spends", () => {
		const state = makeShadowSorcerer(6);
		state.useSorceryPoint(4); // 2 left
		const res = state.summonHoundOfIllOmen();
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/3 Sorcery Points/);
		expect(state.getSorceryPoints().current).toBe(2);
		expect(state.getHoundOfIllOmen()).toBeNull();
	});

	it("replaces a running hound rather than stacking two", () => {
		const state = makeShadowSorcerer(20);
		state.summonHoundOfIllOmen();
		const first = state.getHoundOfIllOmen().id;
		const res = state.summonHoundOfIllOmen();
		expect(res.replaced).toBe("Hound of Ill Omen");
		expect(state.getCompanions().filter(c => c.name === "Hound of Ill Omen")).toHaveLength(1);
		expect(state.getHoundOfIllOmen().id).not.toBe(first);
		expect(state.getSorceryPoints().current).toBe(14);
	});

	it("can be dismissed", () => {
		const state = makeShadowSorcerer(20);
		state.summonHoundOfIllOmen();
		expect(state.dismissHoundOfIllOmen()).toBe(true);
		expect(state.getHoundOfIllOmen()).toBeNull();
		expect(state.dismissHoundOfIllOmen()).toBe(false);
	});

	it("is unavailable before level 6", () => {
		const state = makeShadowSorcerer(5);
		expect(state.summonHoundOfIllOmen()).toMatchObject({ok: false});
		expect(state.getHoundOfIllOmen()).toBeNull();
	});

	// CS-BUG-089. The hound declares its Bite structurally (`attacks: [{attackBonus,
	// damage, damageType}]`), but every surface that renders an attack button or rolls
	// one reads `companion.actions` and parses 5etools prose out of `entries`:
	//   charactersheet.js:4853  attack-button filter   — /\{@atk/ over actions[].entries
	//   charactersheet.js:5705  the same filter again
	//   charactersheet.js:5797  _rollCompanionAttack   — {@hit N} / {@damage X} over entries
	//   charactersheet.js:5963  companion attack list
	// so the hound arrived with a fully specified attack and NOTHING to roll. These pins
	// assert the tokens those four consumers actually parse, not that a field exists.
	it("exposes its structured Bite as a rollable prose action (CS-BUG-089)", () => {
		const state = makeShadowSorcerer(6);
		state.summonHoundOfIllOmen();
		const hound = state.getHoundOfIllOmen();

		// The render predicate at charactersheet.js:4853, applied verbatim.
		const attackActions = (hound.actions || []).filter(a =>
			a.entries?.some(e => typeof e === "string" && /\{@atk/.test(e)),
		);
		expect(attackActions).toHaveLength(1);
		expect(attackActions[0].name).toBe("Bite");

		// The roller at charactersheet.js:5805/:5809 reads exactly these two tokens.
		const entry = attackActions[0].entries.find(e => typeof e === "string");
		expect(entry.match(/\{@hit\s*(-?\d+)\}/)[1]).toBe("5");
		expect([...entry.matchAll(/\{@damage\s+([^}]+)\}/g)].map(m => m[1].trim())).toEqual(["2d6+3"]);
		expect(entry).toMatch(/piercing/);
		// The prone rider is not lost in translation.
		expect(entry).toMatch(/Strength saving throw or be knocked prone/);

		// The structured source of truth is untouched — the translation is additive.
		expect(hound.attacks[0]).toMatchObject({name: "Bite", attackBonus: 5, damage: "2d6+3"});
	});

	it("does not clobber a companion's own prose action of the same name (CS-BUG-089)", () => {
		const state = makeShadowSorcerer(6);
		const id = state.addCompanion({
			name: "Test Summon",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			actions: [{name: "Bite", entries: ["{@atk mw} {@hit 9} to hit, reach 10 ft. {@h}{@damage 4d8} authored damage."]}],
			attacks: [{name: "Bite", attackBonus: 5, damage: "2d6+3", damageType: "piercing"}],
		});
		const comp = state.getCompanion(id);

		// Authored prose wins; no duplicate "Bite" row is synthesised beside it.
		expect(comp.actions.filter(a => a.name === "Bite")).toHaveLength(1);
		const entry = comp.actions[0].entries[0];
		expect(entry).toMatch(/\{@hit 9\}/);
		expect(entry).toMatch(/authored damage/);
		expect(entry).not.toMatch(/2d6\+3/);
	});
});

describe("Shadow Magic Sorcerer — Shadow Walk (level 14)", () => {
	it("teleports up to 120 feet as a bonus action", () => {
		const state = makeShadowSorcerer(14);
		expect(state.useShadowWalk()).toMatchObject({ok: true, distance: 120, range: 120, action: "bonus"});
		expect(state.useShadowWalk({distance: 60})).toMatchObject({ok: true, distance: 60});
	});

	it("enforces the lighting gate at BOTH ends", () => {
		const state = makeShadowSorcerer(14);
		expect(state.useShadowWalk({inDimLightOrDarkness: false})).toMatchObject({ok: false});
		expect(state.useShadowWalk({inDimLightOrDarkness: false}).error).toMatch(/dim light or darkness/i);
		expect(state.useShadowWalk({destinationInDimLightOrDarkness: false})).toMatchObject({ok: false});
	});

	it("counts your own Sorcery-Point darkness as cover for the origin end", () => {
		const state = makeShadowSorcerer(14);
		state.castSpellWithResource("Darkness");
		expect(state.useShadowWalk({inDimLightOrDarkness: false})).toMatchObject({ok: true});
	});

	it("refuses more than 120 feet, and is unavailable before level 14", () => {
		const state = makeShadowSorcerer(14);
		expect(state.useShadowWalk({distance: 121})).toMatchObject({ok: false});
		expect(makeShadowSorcerer(13).useShadowWalk()).toMatchObject({ok: false});
	});
});

describe("Shadow Magic Sorcerer — Umbral Form (level 18)", () => {
	const ALL_BUT_FORCE_AND_RADIANT = [
		"acid", "bludgeoning", "cold", "fire", "lightning", "necrotic",
		"piercing", "poison", "psychic", "slashing", "thunder",
	];

	it("classifies as a toggleable state despite its `consumes` cost marker", () => {
		const state = makeShadowSorcerer(18);
		const feature = state.getFeatures().find(f => f.name === "Umbral Form");
		const info = CharacterSheetState.detectActivatableFeature(feature);
		expect(info).toMatchObject({stateTypeId: "umbralForm", isToggle: true});
		// The curated resistances — not whatever the prose parser makes of
		// "resistance to all damage except force and radiant".
		expect(info.effects).toHaveLength(11);
		expect(info.effects.every(e => e.type === "resistance" && e.target.startsWith("damage:"))).toBe(true);
	});

	it("grants resistance to every damage type EXCEPT force and radiant (CS-BUG-050)", () => {
		const state = makeShadowSorcerer(18);
		expect(state.getResistances()).toEqual([]);

		state.activateState("umbralForm");
		const resistances = state.getResistances();
		for (const t of ALL_BUT_FORCE_AND_RADIANT) expect(resistances).toContain(t);
		expect(resistances).not.toContain("force");
		expect(resistances).not.toContain("radiant");
		expect(resistances).toHaveLength(11);
	});

	it("drops every resistance when the form ends", () => {
		const state = makeShadowSorcerer(18);
		state.activateState("umbralForm");
		expect(state.getResistances()).toHaveLength(11);
		state.deactivateState("umbralForm");
		expect(state.getResistances()).toEqual([]);
	});

	it("costs 6 Sorcery Points through the generic activatable pipeline", () => {
		const state = makeShadowSorcerer(18);
		const entry = state.getActivatableFeatures().find(a => a.feature.name === "Umbral Form");
		expect(entry).toBeDefined();
		expect(entry.resource).toMatchObject({name: "Sorcery Points", cost: 6});
	});

	it("is unavailable before level 18", () => {
		const state = makeShadowSorcerer(17);
		expect(state.getFeatureCalculations().hasUmbralForm).toBeFalsy();
		expect(state.getActivatableFeatures().some(a => a.feature.name === "Umbral Form")).toBe(false);
	});
});
