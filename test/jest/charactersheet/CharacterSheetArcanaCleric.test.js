/**
 * Arcana Domain (SCAG) Cleric — MECHANICAL effect coverage.
 *
 * `CharacterSheetCleric.test.js` Part 12 pins the existence flags this domain sets on
 * `getFeatureCalculations()`. This suite covers the part that actually matters to a
 * player: that each Arcana feature DOES something observable through the state APIs.
 *
 * Two of the mechanics here rest on GENERIC engine fixes with a blast radius far wider
 * than this one domain, so both are exercised on their own terms as well:
 *  - CS-BUG-075 subclass `additionalSpells` `{choose}` blocks were silently dropped, so
 *    NO subclass ever offered a player-chosen spell (Arcane Initiate's two wizard
 *    cantrips, Arcane Mastery's four 6th–9th picks, …).
 *  - CS-BUG-076 `potentSpellcastingBonus` was computed by ~10 subclass branches and read
 *    by nothing, so Potent Spellcasting was pure decoration everywhere it appears.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Verbatim SCAG prose (as rendered to the sheet, tags already resolved).
const TXT_ARCANE_INITIATE = "When you choose this domain at 1st level, you gain proficiency in the Arcana skill, and you gain two cantrips of your choice from the wizard spell list. For you, these cantrips count as cleric cantrips.";
const TXT_ARCANE_ABJURATION = "Starting at 2nd level, you can use your Channel Divinity to abjure otherworldly creatures. As an action, you present your holy symbol, and one celestial, elemental, fey, or fiend of your choice that is within 30 feet of you must make a Wisdom saving throw, provided that the creature can see or hear you. If the creature fails its saving throw, it is turned for 1 minute or until it takes any damage.";
const TXT_SPELL_BREAKER = "Starting at 6th level, when you restore hit points to an ally with a spell of 1st level or higher, you can also end one spell of your choice on that creature. The level of the spell you end must be equal to or lower than the level of the spell slot you use to cast the healing spell.";
const TXT_POTENT_SPELLCASTING = "Starting at 8th level, you add your Wisdom modifier to the damage you deal with any cleric cantrip.";
const TXT_ARCANE_MASTERY = "At 17th level, you choose four spells from the Wizard spell list, one from each of the following levels: 6th, 7th, 8th, and 9th. You add them to your list of domain spells. Like your other domain spells, they are always prepared and count as cleric spells for you.";
// The 2014 Cleric class feature the domain option spends. Note it names no number for the
// level-2 pool — "You must then finish a short or long rest to use your Channel Divinity
// again" — which is exactly the shape CS-BUG-054 had to cover.
const TXT_CHANNEL_DIVINITY = "At 2nd level, you gain the ability to channel divine energy directly from your deity, using that energy to fuel magical effects. When you use your Channel Divinity, you choose which effect to create. You must then finish a short or long rest to use your Channel Divinity again. Some Channel Divinity effects require saving throws. When you use such an effect from this class, the DC equals your cleric spell save DC. Beginning at 6th level, you can use your Channel Divinity twice between rests, and beginning at 18th level, you can use it three times between rests. When you finish a short or long rest, you regain your expended uses.";

// The subclass's real `additionalSpells` block, verbatim from data/class/class-cleric.json.
const ARCANA_ADDITIONAL_SPELLS = [
	{
		known: {1: {_: [{choose: "level=0|class=Wizard", count: 2}]}},
		prepared: {
			1: ["detect magic", "magic missile"],
			3: ["magic weapon", "Nystul's magic aura"],
			5: ["dispel magic", "magic circle"],
			7: ["arcane eye", "Leomund's secret chest"],
			9: ["planar binding", "teleportation circle"],
			17: [
				{choose: "level=6|class=Wizard"},
				{choose: "level=7|class=Wizard"},
				{choose: "level=8|class=Wizard"},
				{choose: "level=9|class=Wizard"},
			],
		},
	},
];

function makeArcanaCleric (level = 20, {wis = 16} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({
		name: "Cleric",
		source: "PHB",
		level,
		subclass: {
			name: "Arcana Domain",
			shortName: "Arcana",
			source: "SCAG",
			className: "Cleric",
			classSource: "PHB",
			additionalSpells: ARCANA_ADDITIONAL_SPELLS,
		},
	});
	state.setAbilityBase("str", 10);
	state.setAbilityBase("dex", 12);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 13);
	state.setAbilityBase("wis", wis);
	state.setAbilityBase("cha", 8);
	state.setSpellcastingAbility("wis");
	return state;
}

/** As above, but with the Channel Divinity class feature actually on the sheet. */
function makeArcanaClericWithCd (level) {
	const state = makeArcanaCleric(level);
	if (level >= 2) {
		state.addFeature({
			name: "Channel Divinity",
			source: "PHB",
			className: "Cleric",
			level: 2,
			description: TXT_CHANNEL_DIVINITY,
		});
	}
	return state;
}

// ==========================================================================
// Arcane Initiate (L1) — a real skill proficiency AND a real pick-list
// ==========================================================================
describe("Arcana — Arcane Initiate grants Arcana proficiency", () => {
	it("parses the proficiency out of the SCAG prose and applies it", () => {
		const state = makeArcanaCleric(1);
		expect(state.getSkillProficiency("arcana")).toBe(0);
		state.addFeature({
			name: "Arcane Initiate",
			source: "SCAG",
			className: "Cleric",
			level: 1,
			description: TXT_ARCANE_INITIATE,
		});
		expect(state.getSkillProficiency("arcana")).toBe(1);
	});
});

describe("Arcana — Arcane Initiate's two wizard cantrips are a real pick-list (CS-BUG-075)", () => {
	it("offers exactly two wizard-cantrip choices at level 1", () => {
		const choices = makeArcanaCleric(1).getPendingSpellChoices();
		expect(choices).toHaveLength(2);
		expect(choices.every(c => c.filter === "level=0|class=Wizard")).toBe(true);
		expect(choices.every(c => c.featureName === "Arcana Domain Spells")).toBe(true);
	});

	it("attributes the picks to the CLERIC, so they count as cleric cantrips", () => {
		expect(makeArcanaCleric(1).getPendingSpellChoices().every(c => c.sourceClass === "Cleric")).toBe(true);
	});

	it("is idempotent — reading the queue repeatedly never stacks duplicates", () => {
		const state = makeArcanaCleric(1);
		state.getPendingSpellChoices();
		state.getPendingSpellChoices();
		state.hasPendingSpellChoices();
		expect(state.getPendingSpellChoices()).toHaveLength(2);
	});

	it("adds a fulfilled pick to the cantrip list, tagged as a cleric cantrip", () => {
		const state = makeArcanaCleric(1);
		const [choice] = state.getPendingSpellChoices();
		state.fulfillSpellChoice(choice.id, {name: "Fire Bolt", source: "PHB", level: 0, school: "V"});

		const cantrip = state.getCantrips().find(c => c.name === "Fire Bolt");
		expect(cantrip).toBeTruthy();
		expect(cantrip.sourceClass).toBe("Cleric");
		expect(cantrip.sourceFeature).toBe("Arcana Domain Spells");
	});

	it("never re-offers a pick that has already been made", () => {
		const state = makeArcanaCleric(1);
		const [choice] = state.getPendingSpellChoices();
		state.fulfillSpellChoice(choice.id, {name: "Fire Bolt", source: "PHB", level: 0, school: "V"});
		expect(state.getPendingSpellChoices()).toHaveLength(1);
		// …and still 1 after further reads (the slot is recorded as filled, not just dequeued).
		state.hasPendingSpellChoices();
		expect(state.getPendingSpellChoices()).toHaveLength(1);
	});

	it("survives a save/load round trip without re-offering fulfilled picks", () => {
		const state = makeArcanaCleric(1);
		state.getPendingSpellChoices().forEach((c, i) => {
			state.fulfillSpellChoice(c.id, {name: `Cantrip ${i}`, source: "PHB", level: 0, school: "V"});
		});
		expect(state.getPendingSpellChoices()).toHaveLength(0);

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.getPendingSpellChoices()).toHaveLength(0);
	});
});

// ==========================================================================
// The generic slot walker — this is engine behaviour, not Arcana behaviour
// ==========================================================================
describe("getSubclassSpellChoiceSlots — generic subclass choose-block walker (CS-BUG-075)", () => {
	it("returns nothing for a subclass whose additionalSpells are all fixed refs", () => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Cleric",
			source: "PHB",
			level: 20,
			subclass: {
				name: "Life Domain",
				shortName: "Life",
				source: "PHB",
				additionalSpells: [{prepared: {1: ["bless", "cure wounds"]}}],
			},
		});
		expect(state.getSubclassSpellChoiceSlots()).toHaveLength(0);
		expect(state.getPendingSpellChoices()).toHaveLength(0);
	});

	it("returns nothing for a subclass with no additionalSpells at all", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 20, subclass: {name: "Champion", shortName: "Champion", source: "PHB"}});
		expect(state.getSubclassSpellChoiceSlots()).toHaveLength(0);
	});

	it("honours `count`, emitting one distinct slot per pick", () => {
		const slots = makeArcanaCleric(1).getSubclassSpellChoiceSlots();
		expect(slots).toHaveLength(2);
		expect(new Set(slots.map(s => s.slotKey)).size).toBe(2);
	});

	it("gates slots by class level — Arcane Mastery is invisible below 17", () => {
		expect(makeArcanaCleric(16).getSubclassSpellChoiceSlots()).toHaveLength(2);
		expect(makeArcanaCleric(17).getSubclassSpellChoiceSlots()).toHaveLength(6);
	});

	it("marks `prepared`-block picks as always prepared and `known`-block picks as not", () => {
		const slots = makeArcanaCleric(17).getSubclassSpellChoiceSlots();
		const cantrips = slots.filter(s => s.filter === "level=0|class=Wizard");
		const mastery = slots.filter(s => s.filter !== "level=0|class=Wizard");
		expect(cantrips.every(s => s.alwaysPrepared === false)).toBe(true);
		expect(mastery.every(s => s.alwaysPrepared === true)).toBe(true);
	});
});

// ==========================================================================
// Channel Divinity: Arcane Abjuration (L2)
// ==========================================================================
describe("Arcana — Arcane Abjuration is a usable Channel Divinity option", () => {
	// The REAL `data/class/class-cleric.json` entry carries NO `consumes` tag — unlike
	// every Paladin oath — so a fixture that adds one proves nothing about the shipped
	// data (CS-BUG-079).
	it("classifies as a limited-use ability that consumes Channel Divinity, with no `consumes` tag in the data (CS-BUG-079)", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Channel Divinity: Arcane Abjuration",
			className: "Cleric",
			subclassShortName: "Arcana",
			subclassSource: "SCAG",
			description: TXT_ARCANE_ABJURATION,
		});
		expect(info).toBeTruthy();
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBe("Channel Divinity");
		expect(info.resourceCost).toBe(1);
		expect(info.activationAction).toBe("action");
	});

	it("still honours an explicit `consumes` tag when the data carries one", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Channel Divinity: Arcane Abjuration",
			className: "Cleric",
			description: TXT_ARCANE_ABJURATION,
			consumes: {name: "Channel Divinity"},
		});
		expect(info.interactionMode).toBe("limited");
		expect(info.resourceName).toBe("Channel Divinity");
	});

	it("leaves an option that owns its own use pool alone (Harness Divine Power)", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Channel Divinity: Harness Divine Power",
			className: "Cleric",
			description: "You can expend a use of your Channel Divinity to fuel your spells. As a bonus action, you regain one expended spell slot.",
			uses: {current: 2, max: 2, recharge: "long"},
		});
		expect(info?.resourceName).not.toBe("Channel Divinity");
	});

	it("parses a real Wisdom saving throw out of the prose", () => {
		const fx = CharacterSheetState._parseCombatActionEffects(TXT_ARCANE_ABJURATION.toLowerCase(), TXT_ARCANE_ABJURATION);
		expect(fx?.rollDice).toEqual(expect.objectContaining({type: "save", saveAbility: "wis"}));
	});

	it("resolves that save to the cleric's real DC, not a hardcoded 10 (CS-BUG-053)", () => {
		const state = makeArcanaCleric(8); // WIS 16 (+3), proficiency +3
		expect(state.getFeatureSaveDc({className: "Cleric"})).toBe(14);
		expect(state.getFeatureCalculations().arcaneAbjurationDc).toBe(14);
	});

	it("moves with Wisdom and proficiency", () => {
		expect(makeArcanaCleric(8, {wis: 20}).getFeatureCalculations().arcaneAbjurationDc).toBe(16);
		expect(makeArcanaCleric(17, {wis: 20}).getFeatureCalculations().arcaneAbjurationDc).toBe(19);
	});

	it("exposes the 30-foot range and 1-minute duration as numbers", () => {
		const calc = makeArcanaCleric(2).getFeatureCalculations();
		expect(calc.arcaneAbjurationRange).toBe(30);
		expect(calc.arcaneAbjurationDuration).toBe(1);
	});

	it("is absent below level 2", () => {
		expect(makeArcanaCleric(1).getFeatureCalculations().hasArcaneAbjuration).toBeFalsy();
		expect(makeArcanaCleric(2).getFeatureCalculations().hasArcaneAbjuration).toBe(true);
	});

	it("does not mint a phantom second ability row from a reference wrapper (CS-BUG-051)", () => {
		// The REAL Arcana Domain L1 umbrella carries prose, a domain-spell table AND a
		// refSubclassFeature, so it must NOT be treated as a pure reference wrapper.
		expect(CharacterSheetState.isReferenceWrapperFeature({
			name: "Arcana Domain",
			entries: [
				"Magic is an energy that suffuses the multiverse…",
				{type: "table", caption: "Arcana Domain Spells", rows: [["1st", "detect magic, magic missile"]]},
				{type: "refSubclassFeature", subclassFeature: "Arcane Initiate|Cleric||Arcana|SCAG|1"},
			],
		})).toBe(false);
	});

	it("suppresses a PURE reference wrapper, so no resource-less ghost row appears (CS-BUG-051)", () => {
		expect(CharacterSheetState.detectActivatableFeature({
			name: "Channel Divinity",
			className: "Cleric",
			entries: [
				"You gain the following Channel Divinity options.",
				{type: "refSubclassFeature", subclassFeature: "Channel Divinity: Arcane Abjuration|Cleric||Arcana|SCAG|2"},
			],
		})).toBeNull();
	});

	it("leaves exactly ONE Channel Divinity pool on a real Arcana sheet", () => {
		const pools = makeArcanaClericWithCd(6).getResources().filter(r => r.name === "Channel Divinity");
		expect(pools).toHaveLength(1);
	});
});

describe("Arcana — the Arcane Banishment CR threshold scales with level", () => {
	it.each([
		[4, undefined],
		[5, 0.5],
		[7, 0.5],
		[8, 1],
		[10, 1],
		[11, 2],
		[13, 2],
		[14, 3],
		[16, 3],
		[17, 4],
		[20, 4],
	])("cleric level %i banishes CR %s", (level, expected) => {
		expect(makeArcanaCleric(level).getFeatureCalculations().arcaneAbjurationBanishCr).toBe(expected);
	});
});

describe("Cleric Channel Divinity pool is capped and scales 1 → 2 → 3 (CS-BUG-054)", () => {
	const usesAt = (level) => {
		const res = makeArcanaClericWithCd(level).getResources().find(r => r.name === "Channel Divinity");
		return res ? res.max : 0;
	};

	it.each([[1, 0], [2, 1], [5, 1], [6, 2], [17, 2], [18, 3], [20, 3]])(
		"level %i → %i use(s)",
		(level, expected) => { expect(usesAt(level)).toBe(expected); },
	);

	it("does not let the L2 feature's own forward references to 6th/18th level inflate the pool (CS-BUG-078)", () => {
		// The PHB Channel Divinity prose that a 2nd-level cleric gains already SAYS
		// "beginning at 6th level, you can use your Channel Divinity twice". `addFeature`'s
		// generic use-parser reads that "twice" and stamped a 2-use pool on a 2nd-level
		// cleric; the level-aware reconciler only ever raised the ceiling, never lowered it.
		const res = makeArcanaClericWithCd(2).getResources().find(r => r.name === "Channel Divinity");
		expect(res.max).toBe(1);
		expect(res.current).toBeLessThanOrEqual(1);
	});

	it("recovers on a short rest", () => {
		const res = makeArcanaClericWithCd(6).getResources().find(r => r.name === "Channel Divinity");
		expect(res.recharge).toBe("short");
	});

	it("is a limited pool, not unlimited", () => {
		const res = makeArcanaClericWithCd(6).getResources().find(r => r.name === "Channel Divinity");
		expect(res.max).toBeGreaterThan(0);
		expect(Number.isFinite(res.max)).toBe(true);
	});
});

// ==========================================================================
// Spell Breaker (L6)
// ==========================================================================
describe("Arcana — Spell Breaker exposes the level of spell it can end", () => {
	it("is gated at level 6", () => {
		expect(makeArcanaCleric(5).getFeatureCalculations().hasSpellBreaker).toBeFalsy();
		expect(makeArcanaCleric(6).getFeatureCalculations().hasSpellBreaker).toBe(true);
	});

	it("caps at the character's highest available spell slot", () => {
		const state = makeArcanaCleric(6);
		state.setSpellSlots(1, 4, 4);
		state.setSpellSlots(3, 3, 3);
		expect(state.getFeatureCalculations().spellBreakerMaxSpellLevel).toBe(3);

		state.setSpellSlots(5, 2, 2);
		expect(state.getFeatureCalculations().spellBreakerMaxSpellLevel).toBe(5);
	});

	it("does NOT count a slot level the character has zero slots of", () => {
		const state = makeArcanaCleric(6);
		const before = state.getFeatureCalculations().spellBreakerMaxSpellLevel;
		state.setSpellSlots(9, 0, 0);
		expect(state.getFeatureCalculations().spellBreakerMaxSpellLevel).toBe(before);
	});

	it("still parses the prose into a displayable feature", () => {
		const state = makeArcanaCleric(6);
		state.addFeature({name: "Spell Breaker", source: "SCAG", className: "Cleric", level: 6, description: TXT_SPELL_BREAKER});
		expect(state.getFeature("Spell Breaker")).toBeTruthy();
	});
});

describe("getHighestSpellSlotLevel — generic helper", () => {
	it("is 0 for a character with no slots", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		expect(state.getHighestSpellSlotLevel()).toBe(0);
	});

	it("counts a warlock pact slot", () => {
		const state = makeArcanaCleric(6);
		state.setSpellSlots(1, 4, 4);
		state.setPactSlots({max: 2, level: 3});
		expect(state.getHighestSpellSlotLevel()).toBe(3);
	});
});

// ==========================================================================
// Potent Spellcasting (L8) — the number must actually reach the damage roll
// ==========================================================================
describe("Arcana — Potent Spellcasting adds WIS to cleric cantrip damage (CS-BUG-076)", () => {
	it("is gated at level 8", () => {
		expect(makeArcanaCleric(7).getFeatureCalculations().hasPotentSpellcasting).toBeFalsy();
		expect(makeArcanaCleric(8).getFeatureCalculations().hasPotentSpellcasting).toBe(true);
	});

	it("reports the granting class so the bonus can be scoped", () => {
		expect(makeArcanaCleric(8).getFeatureCalculations().potentSpellcastingClass).toBe("Cleric");
	});

	it("adds the Wisdom modifier to a cleric cantrip's damage", () => {
		const res = makeArcanaCleric(8).getCantripDamageBonus({name: "Sacred Flame", level: 0, sourceClass: "Cleric"});
		expect(res.bonus).toBe(3);
		expect(res.sources).toEqual([{name: "Potent Spellcasting", value: 3}]);
	});

	it("adds NOTHING before level 8", () => {
		expect(makeArcanaCleric(7).getCantripDamageBonus({name: "Sacred Flame", level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
	});

	it("adds NOTHING to a non-cantrip", () => {
		expect(makeArcanaCleric(8).getCantripDamageBonus({name: "Guiding Bolt", level: 1, sourceClass: "Cleric"}).bonus).toBe(0);
	});

	it("adds NOTHING to a cantrip attributed to another class", () => {
		expect(makeArcanaCleric(8).getCantripDamageBonus({name: "Fire Bolt", level: 0, sourceClass: "Wizard"}).bonus).toBe(0);
	});

	it("moves with Wisdom", () => {
		expect(makeArcanaCleric(8, {wis: 20}).getCantripDamageBonus({name: "Sacred Flame", level: 0, sourceClass: "Cleric"}).bonus).toBe(5);
		expect(makeArcanaCleric(8, {wis: 8}).getCantripDamageBonus({name: "Sacred Flame", level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
	});

	it("APPLIES to an Arcane Initiate wizard cantrip — the whole point of \"count as cleric cantrips\"", () => {
		const state = makeArcanaCleric(8);
		const [choice] = state.getPendingSpellChoices();
		state.fulfillSpellChoice(choice.id, {name: "Fire Bolt", source: "PHB", level: 0, school: "V"});
		const picked = state.getCantrips().find(c => c.name === "Fire Bolt");
		expect(state.getCantripDamageBonus(picked).bonus).toBe(3);
	});

	it("surfaces on the Features tab as a Cantrip Damage stat", () => {
		const state = makeArcanaCleric(8);
		state.addFeature({name: "Potent Spellcasting", source: "SCAG", className: "Cleric", level: 8, description: TXT_POTENT_SPELLCASTING});
		const calc = state.getFeatureCalculations();
		expect(calc.potentSpellcastingBonus).toBe(3);
		expect(calc.potentSpellcastingClass).toBe("Cleric");
	});
});

// ==========================================================================
// Arcane Mastery (L17)
// ==========================================================================
describe("Arcana — Arcane Mastery is a four-part pick-list (CS-BUG-075)", () => {
	it("offers exactly one choice at each of 6th, 7th, 8th and 9th level", () => {
		const state = makeArcanaCleric(17);
		const mastery = state.getPendingSpellChoices().filter(c => c.filter !== "level=0|class=Wizard");
		expect(mastery.map(c => c.filter).sort()).toEqual([
			"level=6|class=Wizard",
			"level=7|class=Wizard",
			"level=8|class=Wizard",
			"level=9|class=Wizard",
		]);
	});

	it("does not offer them at level 16", () => {
		expect(makeArcanaCleric(16).getPendingSpellChoices().filter(c => c.filter !== "level=0|class=Wizard")).toHaveLength(0);
	});

	it("marks the picks as always prepared, so they don't eat the prepared limit", () => {
		const state = makeArcanaCleric(17);
		const choice = state.getPendingSpellChoices().find(c => c.filter === "level=9|class=Wizard");
		state.fulfillSpellChoice(choice.id, {name: "Wish", source: "PHB", level: 9, school: "C"});

		const spell = state.getSpells().find(s => s.name === "Wish");
		expect(spell).toBeTruthy();
		expect(spell.alwaysPrepared).toBe(true);
		expect(spell.prepared).toBe(true);
		expect(spell.sourceClass).toBe("Cleric");
	});

	it("is gated in getFeatureCalculations and reports the four levels", () => {
		expect(makeArcanaCleric(16).getFeatureCalculations().hasArcaneMastery).toBeFalsy();
		expect(makeArcanaCleric(17).getFeatureCalculations().arcaneMasterySpellLevels).toEqual([6, 7, 8, 9]);
	});

	it("still parses the prose into a displayable feature", () => {
		const state = makeArcanaCleric(17);
		state.addFeature({name: "Arcane Mastery", source: "SCAG", className: "Cleric", level: 17, description: TXT_ARCANE_MASTERY});
		expect(state.getFeature("Arcane Mastery")).toBeTruthy();
	});
});
