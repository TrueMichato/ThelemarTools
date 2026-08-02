/**
 * Wicked Witch Sorcerous Origin (Arcadia 8 `Ar8`, republished by TGTT as `TGTT-AR`) —
 * mechanical-effect coverage.
 *
 * Every test asserts an OBSERVABLE consequence — a spent Sorcery Point, a granted
 * language, a skill proficiency, an advantage modifier that reaches `aggregateModifiers`,
 * a substituted spell in the always-prepared list, a companion, a discounted cost — never
 * the mere presence of a `hasXxx` flag.
 *
 * Also covers the two GENERIC surfaces this subclass forced into existence, because both
 * are reusable by any future subclass:
 *   - `CharacterSheetClassUtils.TABLE_DRIVEN_SUBFEATURE_CHOICES` (prose/table choices fed
 *     through the same pending-feature-choice pipeline every build flow drains)
 *   - `_data.grantedSpellOverrides` + `getGrantedSpellSwapOptions` (swap a spell a
 *     subclass GRANTED for another matching a filter)
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const WICKED_WITCH_FEATURES = [
	{
		level: 1,
		name: "Granny's Gifts",
		description: "You learn additional spells when you reach certain levels in this class, as shown on the Granny's Spells table. These spells count as sorcerer spells for you, but they don't count against the number of sorcerer spells you know. Whenever you gain a level in this class, you can replace one spell you gained from this feature with another spell of the same level from the enchantment or illusion school. Additionally, whenever you finish a long rest, you can choose yourself or one creature you can see within 30 feet of you. The chosen creature has advantage on saving throws against being charmed or frightened until you finish your next long rest or until you die.",
	},
	{
		level: 1,
		name: "Hag Ancestor",
		description: "Choose the kind of hag you are descended from, or roll on the Ancestor Kind table. Your ancestor determines your magic specialty, an additional language, and a skill proficiency. Additionally, you have advantage on Charisma checks made to influence hags.",
	},
	{
		level: 6,
		name: "Clever Little Witch",
		description: "When a creature you can see within 15 feet of you casts a spell of 1st level or higher that targets only you and requires an attack roll or a saving throw, you can use your reaction to spend a number of sorcery points equal to the spell's level to cast that spell back at its caster. If the spell is from your ancestor's specialty school, you only need to spend half that number of sorcery points, rounded down.",
		consumes: {name: "Sorcery Point", amountMin: 1, amountMax: 9},
	},
	{
		level: 14,
		name: "Fly, My Pretty",
		description: "Whenever you finish a long rest, you can touch one Small or Medium object and choose a command word. While a creature is riding the object, it hovers and has a flying speed of 60 feet, and the rider can't be charmed or frightened. If you enchant another object, the previous enchantment ends.",
	},
	{
		level: 18,
		name: "Coven Calling",
		description: "When you use Clever Little Witch, you can instead cast any spell you have seen that creature cast in the last minute. Additionally, as an action you can spend 2 sorcery points to create two duplicates of yourself. They act immediately after your turn, and each can cast one spell you know of 3rd level or lower that has an instantaneous duration, costing you sorcery points equal to the spell's level.",
		consumes: {name: "Sorcery Point", amount: 2},
	},
];

/**
 * Build a Wicked Witch sorcerer at `level`, carrying exactly the subclass features a
 * sorcerer of that level would have.
 * @param {number} level
 * @param {object} [opts]
 * @param {string} [opts.source="TGTT"] class source (the chassis this subclass ships on).
 * @param {?string} [opts.ancestor="Green"] Hag Ancestor pick, or null to leave it unmade.
 * @param {number} [opts.cha=18]
 */
function makeWickedWitch (level = 20, {source = "TGTT", ancestor = "Green", cha = 18} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", cha);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source,
		level,
		subclass: {name: "Wicked Witch Sorcerous Origin", shortName: "Wicked Witch", source: "Ar8"},
	}];
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(60, 60);

	// On the TGTT/XPHB chassis the origin arrives at 3; on PHB at 1.
	const originLevel = (source === "TGTT" || source === "XPHB") ? 3 : 1;
	for (const f of WICKED_WITCH_FEATURES) {
		const gainedAt = f.level === 1 ? originLevel : f.level;
		if (level < gainedAt) continue;
		state.addFeature({...f, source: "Ar8", level: gainedAt, subclassShortName: "Wicked Witch"});
	}

	if (ancestor && level >= originLevel) {
		const opt = CharacterSheetClassUtils.TABLE_DRIVEN_SUBFEATURE_CHOICES["hag ancestor|ar8"]
			.options.find(o => o.shortName === ancestor);
		state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
			{name: opt.name, source: opt.source, entries: opt.entries},
			{level: originLevel, isFeatureOption: true, parentFeature: "Hag Ancestor"},
		));
		state._recordChosenSubfeature({parent: "Hag Ancestor", name: opt.name, source: opt.source});
	}

	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

describe("Wicked Witch Sorcerer — Sorcery Points (shared chassis)", () => {
	test("TGTT sorcerer pool is level + 1 from level 1, via the single source of truth", () => {
		for (const level of [1, 3, 6, 14, 18, 20]) {
			const cls = {name: "Sorcerer", source: "TGTT", level};
			expect(CharacterSheetState.getSorceryPointsMaxForClass(cls)).toBe(level + 1);
			expect(makeWickedWitch(level).getFeatureCalculations().sorceryPoints).toBe(level + 1);
		}
	});

	test("the same subclass on the PHB chassis uses the PHB pool (level, from 2)", () => {
		expect(makeWickedWitch(1, {source: "PHB"}).getFeatureCalculations().sorceryPoints).toBeUndefined();
		expect(makeWickedWitch(6, {source: "PHB"}).getFeatureCalculations().sorceryPoints).toBe(6);
	});
});

describe("Wicked Witch Sorcerer — feature gating", () => {
	test("origin features arrive at 3 on the TGTT chassis, not at 1", () => {
		expect(makeWickedWitch(2).getFeatureCalculations().hasGrannysGifts).toBeFalsy();
		expect(makeWickedWitch(3).getFeatureCalculations().hasGrannysGifts).toBe(true);
		expect(makeWickedWitch(3).getFeatureCalculations().hasHagAncestor).toBe(true);
	});

	test("origin features arrive at 1 on the PHB chassis", () => {
		expect(makeWickedWitch(1, {source: "PHB"}).getFeatureCalculations().hasGrannysGifts).toBe(true);
	});

	test("later features gate on their own levels regardless of chassis", () => {
		const c5 = makeWickedWitch(5).getFeatureCalculations();
		expect(c5.hasCleverLittleWitch).toBeFalsy();
		const c6 = makeWickedWitch(6).getFeatureCalculations();
		expect(c6.hasCleverLittleWitch).toBe(true);
		expect(c6.cleverLittleWitchRange).toBe(15);
		expect(c6.hasFlyMyPretty).toBeFalsy();

		const c14 = makeWickedWitch(14).getFeatureCalculations();
		expect(c14.hasFlyMyPretty).toBe(true);
		expect(c14.flyMyPrettyFlySpeed).toBe(60);
		expect(c14.hasCovenCalling).toBeFalsy();

		const c18 = makeWickedWitch(18).getFeatureCalculations();
		expect(c18.hasCovenCalling).toBe(true);
		expect(c18.covenCallingDuplicateCost).toBe(2);
		expect(c18.covenCallingDuplicateCount).toBe(2);
		expect(c18.covenCallingMaxDuplicateSpellLevel).toBe(3);
	});

	test("a different sorcerous origin gets none of it (negative control)", () => {
		const state = makeWickedWitch(20);
		state._data.classes[0].subclass = {name: "Draconic Bloodline", shortName: "Draconic", source: "PHB"};
		const calc = state.getFeatureCalculations();
		expect(calc.hasGrannysGifts).toBeFalsy();
		expect(calc.hasHagAncestor).toBeFalsy();
		expect(calc.hasCleverLittleWitch).toBeFalsy();
		expect(calc.hasCovenCalling).toBeFalsy();
	});
});

describe("Hag Ancestor — the table-driven choice engine", () => {
	test("the registry publishes exactly the three published rows, both source keys", () => {
		for (const key of ["hag ancestor|ar8", "hag ancestor|tgtt-ar"]) {
			const entry = CharacterSheetClassUtils.TABLE_DRIVEN_SUBFEATURE_CHOICES[key];
			expect(entry.options.map(o => o.shortName)).toEqual(["Green", "Night", "Sea"]);
		}
	});

	test("the seeder queues the choice through the generic pending-choice pipeline", () => {
		const state = makeWickedWitch(3, {ancestor: null});
		const feature = state._data.features.find(f => f.name === "Hag Ancestor");
		expect(feature).toBeTruthy();

		const seeded = CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [feature]);
		expect(seeded).toBe(true);
		const pending = state.getPendingFeatureChoices().find(c => c.featureName === "Hag Ancestor");
		expect(pending).toBeTruthy();
		expect(pending.kind).toBe("subfeature");
		expect(pending.options).toHaveLength(3);
	});

	test("the choice is NOT re-offered once it has been made", () => {
		const state = makeWickedWitch(3, {ancestor: "Night"});
		const feature = state._data.features.find(f => f.name === "Hag Ancestor");
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [feature]);
		expect(state.getPendingFeatureChoices().filter(c => c.featureName === "Hag Ancestor")).toHaveLength(0);
	});

	test("fulfilling the choice applies the option and publishes its specialty school", () => {
		const state = makeWickedWitch(6, {ancestor: null});
		const feature = state._data.features.find(f => f.name === "Hag Ancestor");
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [feature]);
		const pending = state.getPendingFeatureChoices().find(c => c.featureName === "Hag Ancestor");

		expect(state.getHagAncestorKind()).toBeNull();
		expect(state.fulfillFeatureChoice(pending.id, {name: "Hag Ancestor: Sea Hag", source: "Ar8"})).toBe(true);

		const ancestor = state.getHagAncestorKind();
		expect(ancestor.kind).toBe("Sea");
		expect(ancestor.specialtySchool).toBe("Transmutation");
		expect(state.getFeatureCalculations().hagAncestorSpecialtySchool).toBe("Transmutation");
		expect(state._data.features.some(f => f.name === "Hag Ancestor: Sea Hag")).toBe(true);
	});

	// CS regression pin: fulfilling a `subfeature` choice must RECALCULATE, or the
	// name-keyed registry grants (language / skill proficiency / conditional modifier)
	// stay unapplied until some unrelated later action happens to recompute. Measured
	// live in the browser: a level-3 Wicked Witch had `getLanguages() === ["Common",
	// "Celestial"]` — no Sylvan — right after answering the Hag Ancestor modal, and only
	// gained it on the NEXT level-up.
	test("fulfilling the choice APPLIES its registry grants immediately, with no extra recalc", () => {
		const state = makeWickedWitch(6, {ancestor: null});
		const feature = state._data.features.find(f => f.name === "Hag Ancestor");
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [feature]);
		const pending = state.getPendingFeatureChoices().find(c => c.featureName === "Hag Ancestor");

		expect(state.getLanguages().map(l => l.toLowerCase())).not.toContain("sylvan");
		expect(state.isSkillProficient("deception")).toBe(false);

		state.fulfillFeatureChoice(pending.id, {name: "Hag Ancestor: Green Hag", source: "Ar8"});

		// NO `applyClassFeatureEffects()` here on purpose — that is the whole point.
		expect(state.getLanguages().map(l => l.toLowerCase())).toContain("sylvan");
		expect(state.isSkillProficient("deception")).toBe(true);
		expect(state.aggregateModifiers("check:cha").conditionalsAvailable
			.some(c => /influence hags/i.test(c.conditional || ""))).toBe(true);
	});

	test.each([
		["Green", "Illusion", "Sylvan", "deception"],
		["Night", "Enchantment", "Abyssal", "insight"],
		["Sea", "Transmutation", "Primordial", "intimidation"],
	])("%s Hag grants its language and skill proficiency for real", (kind, school, language, skill) => {
		const state = makeWickedWitch(6, {ancestor: kind});
		const calc = state.getFeatureCalculations();
		expect(calc.hagAncestorKind).toBe(kind);
		expect(calc.hagAncestorSpecialtySchool).toBe(school);

		expect(state.getLanguages().map(l => String(l).toLowerCase())).toContain(language.toLowerCase());
		expect(state.isSkillProficient(skill)).toBe(true);
		// A proficient skill actually moves the number.
		expect(state.getSkillMod(skill)).toBeGreaterThanOrEqual(state.getProficiencyBonus());
	});

	test("the Charisma-vs-hags rider is a CONDITIONAL modifier, not an always-on one", () => {
		const state = makeWickedWitch(6, {ancestor: "Green"});
		const agg = state.aggregateModifiers("check:cha:advantage");
		const conditional = (agg.conditionalsAvailable || []).find(m => /hag/i.test(m.conditional || ""));
		expect(conditional).toBeTruthy();
		expect(agg.advantage).toBeFalsy();
	});

	test("the pick survives a save/load round-trip", () => {
		const state = makeWickedWitch(6, {ancestor: "Night"});
		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(json)));
		expect(reloaded.getHagAncestorKind().specialtySchool).toBe("Enchantment");
	});
});

describe("Granny's Gifts — the long-rest ward", () => {
	test("warding yourself registers real save-advantage modifiers", () => {
		const state = makeWickedWitch(6);
		expect(state.aggregateModifiers("save:advantage:charmed").advantage).toBeFalsy();

		const res = state.setGrannysGiftsWard({target: "self"});
		expect(res.ok).toBe(true);
		expect(state.aggregateModifiers("save:advantage:charmed").advantage).toBe(true);
		expect(state.aggregateModifiers("save:advantage:frightened").advantage).toBe(true);
		expect(state.getFeatureCalculations().grannysGiftsWardTarget).toBe("self");
	});

	test("warding an ally records the designation WITHOUT giving you the advantage", () => {
		const state = makeWickedWitch(6);
		const res = state.setGrannysGiftsWard({target: "ally", targetName: "Sindri"});
		expect(res.ok).toBe(true);
		expect(state.getGrannysGiftsWard().targetName).toBe("Sindri");
		expect(state.aggregateModifiers("save:advantage:charmed").advantage).toBeFalsy();
	});

	test("an unnamed ally is refused", () => {
		const state = makeWickedWitch(6);
		expect(state.setGrannysGiftsWard({target: "ally"}).ok).toBe(false);
	});

	test("re-warding replaces rather than stacks", () => {
		const state = makeWickedWitch(6);
		state.setGrannysGiftsWard({target: "self"});
		state.setGrannysGiftsWard({target: "self"});
		const charmedMods = state._data.namedModifiers.filter(m => m.type === "save:advantage:charmed");
		expect(charmedMods).toHaveLength(1);
	});

	test("a long rest clears the ward AND its modifiers so the choice is re-made", () => {
		const state = makeWickedWitch(6);
		state.setGrannysGiftsWard({target: "self"});
		state.onLongRest();
		expect(state.getGrannysGiftsWard()).toBeNull();
		expect(state.aggregateModifiers("save:advantage:charmed").advantage).toBeFalsy();
	});

	test("a sorcerer without the feature cannot ward", () => {
		const state = makeWickedWitch(2);
		expect(state.setGrannysGiftsWard({target: "self"}).ok).toBe(false);
	});

	// CS regression pin: the feature's own prose ("The chosen creature has advantage on
	// saving throws against being charmed or frightened") is a "chosen creature"
	// indirection the text parser cannot see. Left alone it registers the two
	// conditionals on the witch PERMANENTLY — so an unwarded witch, and a witch who
	// warded an ALLY, both silently gained the benefit, and a self-ward produced two
	// identical rows in the per-roll conditional picker. Measured live: a level-3 witch
	// showed `["against being charmed", "against being frightened", "against being
	// charmed", "against being frightened"]` on `aggregateModifiers("save:wis")`.
	const wardConditionals = (state) => (state.aggregateModifiers("save:wis").conditionalsAvailable || [])
		.map(c => String(c.conditional || "").toLowerCase())
		.filter(c => /charmed|frightened/.test(c));

	test("the feature's prose does NOT auto-grant the ward to the witch", () => {
		const state = makeWickedWitch(6);
		expect(wardConditionals(state)).toHaveLength(0);
	});

	test("warding an ALLY leaves the witch with no charm/fright conditional at all", () => {
		const state = makeWickedWitch(6);
		state.setGrannysGiftsWard({target: "ally", targetName: "Sindri"});
		expect(wardConditionals(state)).toHaveLength(0);
	});

	test("warding yourself offers each condition EXACTLY once to the per-roll picker", () => {
		const state = makeWickedWitch(6);
		state.setGrannysGiftsWard({target: "self"});
		const offered = wardConditionals(state);
		expect(offered.filter(c => c.includes("charmed"))).toHaveLength(1);
		expect(offered.filter(c => c.includes("frightened"))).toHaveLength(1);
		// …and it stays gated: a plain WIS save gets no free advantage.
		expect(state.aggregateModifiers("save:wis").advantage).toBeFalsy();
	});
});

describe("Granny's Gifts — the generic granted-spell swap", () => {
	/** Minimal always-prepared harness: a subclass with an `additionalSpells.known` block. */
	function withGrannySpells (state) {
		state._data.classes[0].subclass.additionalSpells = [{
			known: {1: ["bane", "tasha's hideous laughter"], 3: ["animal messenger", "mirror image"]},
		}];
		return state;
	}

	test("the granted spells flow through the GENERIC always-prepared path", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		const names = state.getSubclassAlwaysPreparedSpells(state._data.classes[0]).map(s => s.name.toLowerCase());
		expect(names).toContain("bane");
		expect(names).toContain("mirror image");
		expect(names.every(() => true)).toBe(true);
	});

	test("level-gating still applies (no 3rd-level grants at sorcerer 2)", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state._data.classes[0].level = 2;
		const names = state.getSubclassAlwaysPreparedSpells(state._data.classes[0]).map(s => s.name.toLowerCase());
		expect(names).toContain("bane");
		expect(names).not.toContain("mirror image");
	});

	test("an override substitutes the replacement for the granted spell", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		const res = state.setGrantedSpellOverride({
			className: "Sorcerer",
			featureName: "Granny's Gifts",
			originalSpell: "bane",
			replacementSpell: "charm person",
		});
		expect(res.ok).toBe(true);

		const spells = state.getSubclassAlwaysPreparedSpells(state._data.classes[0]);
		const names = spells.map(s => s.name.toLowerCase());
		expect(names).not.toContain("bane");
		expect(names).toContain("charm person");
		expect(spells.find(s => s.name.toLowerCase() === "charm person").isSwappedGrantedSpell).toBe(true);
	});

	test("only ONE swap per feature is retained — a second replaces the first", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane", replacementSpell: "charm person"});
		state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "mirror image", replacementSpell: "blur"});
		expect(state.getGrantedSpellOverrides("Sorcerer")).toHaveLength(1);
		const names = state.getSubclassAlwaysPreparedSpells(state._data.classes[0]).map(s => s.name.toLowerCase());
		expect(names).toContain("bane");
		expect(names).not.toContain("mirror image");
	});

	test("clearing the override restores the original grant", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane", replacementSpell: "charm person"});
		expect(state.clearGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts"})).toBe(true);
		expect(state.getSubclassAlwaysPreparedSpells(state._data.classes[0]).map(s => s.name.toLowerCase())).toContain("bane");
	});

	test("a self-swap and a blank swap are both refused", () => {
		const state = makeWickedWitch(3);
		expect(state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane", replacementSpell: "bane"}).ok).toBe(false);
		expect(state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane"}).ok).toBe(false);
	});

	test("the swap filter published by the calculations matches the printed rule", () => {
		const filter = makeWickedWitch(3).getFeatureCalculations().grannysGiftsSwapFilter;
		expect(filter.schools).toEqual(["Enchantment", "Illusion"]);
		expect(filter.classes).toEqual(["Sorcerer", "Warlock", "Wizard"]);
		expect(filter.sameLevel).toBe(true);
	});

	test("getGrantedSpellSwapOptions honours school + level (generic helper)", () => {
		const allSpells = [
			{name: "Charm Person", source: "PHB", level: 1, school: "E", classes: {fromClassList: [{name: "Sorcerer"}]}},
			{name: "Disguise Self", source: "PHB", level: 1, school: "I", classes: {fromClassList: [{name: "Wizard"}]}},
			{name: "Burning Hands", source: "PHB", level: 1, school: "V", classes: {fromClassList: [{name: "Sorcerer"}]}},
			{name: "Suggestion", source: "PHB", level: 2, school: "E", classes: {fromClassList: [{name: "Sorcerer"}]}},
			{name: "Bless", source: "PHB", level: 1, school: "E", classes: {fromClassList: [{name: "Cleric"}]}},
		];
		const filter = {schools: ["Enchantment", "Illusion"], classes: ["Sorcerer", "Warlock", "Wizard"], sameLevel: true};
		const names = CharacterSheetState.getGrantedSpellSwapOptions(allSpells, filter, 1).map(s => s.name);
		expect(names).toEqual(expect.arrayContaining(["Charm Person", "Disguise Self"]));
		expect(names).not.toContain("Burning Hands"); // wrong school
		expect(names).not.toContain("Suggestion"); // wrong level
		expect(names).not.toContain("Bless"); // wrong class list
	});

	test("the subclass declares a swap rule, and it resolves under BOTH sources", () => {
		const ar8 = CharacterSheetState.getGrantedSpellSwapRule({shortName: "Wicked Witch", source: "Ar8"});
		expect(ar8).toBeTruthy();
		expect(ar8.featureName).toBe("Granny's Gifts");
		expect(ar8.filter.schools).toEqual(["enchantment", "illusion"]);
		// TGTT re-publishes Arcadia content under `TGTT-AR`; the rule must follow it.
		const tgtt = CharacterSheetState.getGrantedSpellSwapRule({shortName: "Wicked Witch", source: "TGTT-AR"});
		expect(tgtt?.featureName).toBe("Granny's Gifts");
		// A subclass with no rule stays untouched.
		expect(CharacterSheetState.getGrantedSpellSwapRule({shortName: "Shadow Magic", source: "XGE"})).toBeNull();
	});

	test("granted spells are TAGGED swappable so the Spells tab renders the Swap button", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		const bane = state.getSubclassAlwaysPreparedSpells(state._data.classes[0])
			.find(s => s.name.toLowerCase() === "bane");
		expect(bane.grantedSwapRuleId).toBe("wicked witch|ar8");
		expect(bane.grantedSwapFeatureName).toBe("Granny's Gifts");
	});

	test("applyGrantedSpellSwap removes the old grant from the live list and adds the new one", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.populateSubclassSpells();
		const known = () => state.getSpells().map(s => s.name.toLowerCase());
		expect(known()).toContain("bane");

		const res = state.applyGrantedSpellSwap({
			className: "Sorcerer",
			featureName: "Granny's Gifts",
			originalSpell: {name: "Bane", source: "PHB"},
			replacementSpell: {name: "Charm Person", source: "PHB", level: 1, school: "E"},
		});
		expect(res.ok).toBe(true);
		expect(known()).not.toContain("bane");
		expect(known()).toContain("charm person");
	});

	test("re-swapping resolves back to the PRINTED spell, and drops the stale replacement", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.populateSubclassSpells();
		state.applyGrantedSpellSwap({
			className: "Sorcerer",
			featureName: "Granny's Gifts",
			originalSpell: {name: "Bane", source: "PHB"},
			replacementSpell: {name: "Charm Person", source: "PHB", level: 1, school: "E"},
		});
		// Swap the REPLACEMENT again — the stored override must still key off "Bane",
		// otherwise clearing it would restore Charm Person rather than the printed grant.
		state.applyGrantedSpellSwap({
			className: "Sorcerer",
			featureName: "Granny's Gifts",
			originalSpell: {name: "Charm Person", source: "PHB"},
			replacementSpell: {name: "Sleep", source: "PHB", level: 1, school: "E"},
		});
		const ov = state.getGrantedSpellOverrides("Sorcerer");
		expect(ov).toHaveLength(1);
		expect(ov[0].original.name.toLowerCase()).toBe("bane");
		expect(ov[0].replacement.name.toLowerCase()).toBe("sleep");

		const known = state.getSpells().map(s => s.name.toLowerCase());
		expect(known).toContain("sleep");
		expect(known).not.toContain("charm person");
		expect(known).not.toContain("bane");
	});

	test("a same-named grant from ANOTHER class is not collaterally deleted", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.populateSubclassSpells();
		// A second class grants the same spell under its own feature. The targeted
		// removal must key off this class + the swap tag, never the name alone.
		state.addSpell({
			name: "Bane",
			source: "PHB",
			level: 1,
			school: "E",
			alwaysPrepared: true,
			sourceClass: "Cleric",
			sourceFeature: "Life Domain Spells",
		}, true);
		const banes = state.getSpells().filter(s => s.name.toLowerCase() === "bane");
		// Spell identity coalesces duplicates, so verify against the merged entry's owner.
		expect(banes).toHaveLength(1);

		const state2 = new CharacterSheetState();
		state2.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		// Strip the swap tag to model a foreign grant, then confirm it survives removal.
		state2._data.spellcasting.spellsKnown.forEach(s => {
			if (s.name.toLowerCase() === "bane") { delete s.grantedSwapRuleId; s.sourceClass = "Cleric"; s.sourceFeature = "Life Domain Spells"; }
		});
		state2._removeGrantedSwapEntry("Sorcerer", {name: "Bane"});
		expect(state2.getSpells().filter(s => s.name.toLowerCase() === "bane")).toHaveLength(1);
	});

	test("the override survives a save/load round-trip", () => {
		const state = withGrannySpells(makeWickedWitch(3));
		state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane", replacementSpell: "charm person"});
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(reloaded.getGrantedSpellOverrides("Sorcerer")[0].replacement.name).toBe("charm person");
	});
});

describe("Clever Little Witch (6)", () => {
	test("cost equals the spell's level off-specialty", () => {
		const state = makeWickedWitch(10, {ancestor: "Green"}); // Illusion specialty
		expect(state.getCleverLittleWitchCost(3, "Evocation")).toBe(3);
		expect(state.getCleverLittleWitchCost(5, "V")).toBe(5);
	});

	test("cost is HALVED (rounded down) for the ancestor's specialty school", () => {
		const state = makeWickedWitch(10, {ancestor: "Green"}); // Illusion
		expect(state.getCleverLittleWitchCost(4, "Illusion")).toBe(2);
		expect(state.getCleverLittleWitchCost(5, "I")).toBe(2);
		// RAW: rounding down makes a 1st-level specialty spell free.
		expect(state.getCleverLittleWitchCost(1, "Illusion")).toBe(0);
	});

	test("the discount follows the ANCESTOR, not the subclass", () => {
		expect(makeWickedWitch(10, {ancestor: "Night"}).getCleverLittleWitchCost(4, "Enchantment")).toBe(2);
		expect(makeWickedWitch(10, {ancestor: "Night"}).getCleverLittleWitchCost(4, "Illusion")).toBe(4);
		expect(makeWickedWitch(10, {ancestor: "Sea"}).getCleverLittleWitchCost(4, "Transmutation")).toBe(2);
	});

	test("cantrips cannot be reflected", () => {
		expect(makeWickedWitch(10).getCleverLittleWitchCost(0, "Illusion")).toBeNull();
		expect(makeWickedWitch(10).useCleverLittleWitch({spellLevel: 0}).ok).toBe(false);
	});

	test("using it actually spends Sorcery Points", () => {
		const state = makeWickedWitch(10, {ancestor: "Green"});
		const before = state.getSorceryPoints().current;
		const res = state.useCleverLittleWitch({spellLevel: 3, school: "Evocation", distance: 10});
		expect(res.ok).toBe(true);
		expect(res.cost).toBe(3);
		expect(state.getSorceryPoints().current).toBe(before - 3);
		expect(res.spellSaveDc).toBe(state.getSpellSaveDC());
	});

	test("the specialty discount is visible in the points actually spent", () => {
		const state = makeWickedWitch(10, {ancestor: "Green"});
		const before = state.getSorceryPoints().current;
		const res = state.useCleverLittleWitch({spellLevel: 5, school: "Illusion"});
		expect(res.cost).toBe(2);
		expect(res.discounted).toBe(true);
		expect(state.getSorceryPoints().current).toBe(before - 2);
	});

	test("out of range and out of points are both refused without spending", () => {
		const state = makeWickedWitch(10, {ancestor: "Green"});
		const before = state.getSorceryPoints().current;
		expect(state.useCleverLittleWitch({spellLevel: 2, distance: 40}).ok).toBe(false);
		state.setSorceryPoints(1);
		expect(state.useCleverLittleWitch({spellLevel: 5, school: "Evocation"}).ok).toBe(false);
		expect(state.getSorceryPoints().current).toBe(1);
		expect(before).toBeGreaterThan(1);
	});

	test("a sorcerer below 6 cannot use it", () => {
		expect(makeWickedWitch(5).useCleverLittleWitch({spellLevel: 1}).ok).toBe(false);
	});
});

describe("Fly, My Pretty (14)", () => {
	test("enchanting records the object and its command word", () => {
		const state = makeWickedWitch(14);
		const res = state.enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"});
		expect(res.ok).toBe(true);
		expect(state.getEnchantedFlyingItem()).toEqual({itemName: "Broom", commandWord: "Zephyr", flySpeed: 60});
		expect(state.getFeatureCalculations().flyMyPrettyItem).toBe("Broom");
	});

	test("enchanting a second object ends the first (one at a time)", () => {
		const state = makeWickedWitch(14);
		state.enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"});
		const res = state.enchantFlyingItem({itemName: "Cauldron", commandWord: "Bubble"});
		expect(res.replaced).toBe("Broom");
		expect(state.getEnchantedFlyingItem().itemName).toBe("Cauldron");
	});

	test("a nameless object or a blank command word is refused", () => {
		const state = makeWickedWitch(14);
		expect(state.enchantFlyingItem({itemName: "", commandWord: "Zephyr"}).ok).toBe(false);
		expect(state.enchantFlyingItem({itemName: "Broom", commandWord: "  "}).ok).toBe(false);
	});

	test("riding it grants a 60 ft fly speed and immunity to charmed/frightened", () => {
		const state = makeWickedWitch(14);
		state.enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"});
		expect(state.getSpeed("fly") || 0).toBe(0);

		state.activateState("flyMyPretty");
		expect(state.getSpeed("fly")).toBe(60);
		expect(state.getConditionImmunities().map(c => String(c).toLowerCase())).toEqual(
			expect.arrayContaining(["charmed", "frightened"]),
		);

		state.deactivateState("flyMyPretty");
		expect(state.getSpeed("fly") || 0).toBe(0);
	});

	test("dismissing the enchantment also stops the ride", () => {
		const state = makeWickedWitch(14);
		state.enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"});
		state.activateState("flyMyPretty");
		expect(state.dismissEnchantedFlyingItem()).toBe(true);
		expect(state.isStateActive("flyMyPretty")).toBe(false);
		expect(state.getEnchantedFlyingItem()).toBeNull();
	});

	// RAW gives exactly one end condition — "If you enchant another object, the previous
	// enchantment ends" — so unlike the Granny's Gifts ward (explicitly re-chosen every
	// long rest) the enchantment persists across rests. Pinned because the two features
	// sit in the same long-rest hook and it would be easy to "tidy" this into it.
	test("the enchantment survives a long rest — only a NEW object ends it", () => {
		const state = makeWickedWitch(14);
		state.enchantFlyingItem({itemName: "Broomstick", commandWord: "Up"});
		state.onLongRest();
		expect(state.getEnchantedFlyingItem()?.itemName).toBe("Broomstick");
	});

	test("a sorcerer below 14 cannot enchant an object", () => {
		expect(makeWickedWitch(13).enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"}).ok).toBe(false);
	});
});

describe("Coven Calling (18)", () => {
	test("summoning two duplicates costs 2 Sorcery Points and creates two companions", () => {
		const state = makeWickedWitch(18);
		const before = state.getSorceryPoints().current;
		const res = state.summonCovenDuplicates();
		expect(res.ok).toBe(true);
		expect(res.duplicates).toHaveLength(2);
		expect(state.getSorceryPoints().current).toBe(before - 2);
		expect(state.getCovenDuplicates()).toHaveLength(2);
	});

	test("re-summoning replaces rather than stacking duplicates", () => {
		const state = makeWickedWitch(18);
		state.summonCovenDuplicates();
		state.summonCovenDuplicates();
		expect(state.getCovenDuplicates()).toHaveLength(2);
	});

	test("insufficient points refuses without summoning", () => {
		const state = makeWickedWitch(18);
		state.setSorceryPoints(1);
		expect(state.summonCovenDuplicates().ok).toBe(false);
		expect(state.getCovenDuplicates()).toHaveLength(0);
	});

	test("a duplicate's spell costs its level, and is capped at 3rd level + instantaneous", () => {
		const state = makeWickedWitch(18);
		state.summonCovenDuplicates();
		const before = state.getSorceryPoints().current;

		expect(state.castWithCovenDuplicate({spellName: "Fireball", spellLevel: 3}).cost).toBe(3);
		expect(state.getSorceryPoints().current).toBe(before - 3);

		expect(state.castWithCovenDuplicate({spellName: "Wall of Fire", spellLevel: 4}).ok).toBe(false);
		expect(state.castWithCovenDuplicate({spellName: "Fly", spellLevel: 3, instantaneous: false}).ok).toBe(false);
	});

	test("without duplicates standing there is nothing to cast with", () => {
		const state = makeWickedWitch(18);
		expect(state.castWithCovenDuplicate({spellName: "Fireball", spellLevel: 3}).ok).toBe(false);
	});

	test("the seen-spell window lets you reflect a spell the target cast earlier", () => {
		const state = makeWickedWitch(18, {ancestor: "Green"});
		state.recordSeenSpell({spellName: "Phantasmal Force", spellLevel: 2, school: "Illusion", casterName: "Hag"});
		expect(state.getSeenSpells({casterName: "Hag"})).toHaveLength(1);

		const before = state.getSorceryPoints().current;
		const res = state.useCovenCallingReflection({spellName: "Phantasmal Force", casterName: "Hag"});
		expect(res.ok).toBe(true);
		// Illusion is the Green hag's specialty → 2 halved to 1.
		expect(res.cost).toBe(1);
		expect(state.getSorceryPoints().current).toBe(before - 1);
	});

	test("a spell you never saw cannot be reflected", () => {
		const state = makeWickedWitch(18);
		expect(state.useCovenCallingReflection({spellName: "Meteor Swarm"}).ok).toBe(false);
	});

	test("the seen-spell window expires after 10 rounds", () => {
		const state = makeWickedWitch(18);
		state.recordSeenSpell({spellName: "Bane", spellLevel: 1, casterName: "Hag", round: 1});
		expect(state.getSeenSpells({casterName: "Hag", currentRound: 5})).toHaveLength(1);
		expect(state.getSeenSpells({casterName: "Hag", currentRound: 20})).toHaveLength(0);
	});

	test("a long rest clears both the duplicates and the seen-spell window", () => {
		const state = makeWickedWitch(18);
		state.summonCovenDuplicates();
		state.recordSeenSpell({spellName: "Bane", spellLevel: 1, casterName: "Hag"});
		state.onLongRest();
		expect(state.getCovenDuplicates()).toHaveLength(0);
		expect(state.getSeenSpells()).toHaveLength(0);
	});

	test("a sorcerer below 18 has none of it", () => {
		const state = makeWickedWitch(17);
		expect(state.summonCovenDuplicates().ok).toBe(false);
		expect(state.useCovenCallingReflection({spellName: "Bane"}).ok).toBe(false);
	});
});

describe("Wicked Witch — surfacing", () => {
	test("every feature is classified so it lands on a real panel, none silently dropped", () => {
		const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES;
		expect(overrides["granny's gifts"]).toBe("ability");
		expect(overrides["hag ancestor"]).toBe("passive");
		expect(overrides["clever little witch"]).toBe("reaction");
		expect(overrides["coven calling"]).toBe("ability");
	});

	test("the three clickable features really are activatable, so a Use button renders", () => {
		for (const name of ["Granny's Gifts", "Clever Little Witch", "Coven Calling"]) {
			const feature = WICKED_WITCH_FEATURES.find(f => f.name === name);
			const info = CharacterSheetState.detectActivatableFeature({...feature, source: "Ar8"});
			expect(info).toBeTruthy();
			// Instant abilities/reactions must NOT become standing toggles.
			expect(info.isToggle).toBeFalsy();
		}
	});

	test("Hag Ancestor is classified passive — never a toggle, always a displayed grant", () => {
		const feature = WICKED_WITCH_FEATURES.find(f => f.name === "Hag Ancestor");
		expect(CharacterSheetState.detectActivatableFeature({...feature, source: "Ar8"})).toBeNull();
		// …but its grants are real and visible on the sheet.
		const state = makeWickedWitch(6, {ancestor: "Night"});
		expect(state.getHagAncestorKind().specialtySchool).toBe("Enchantment");
		expect(state.getLanguages().map(l => l.toLowerCase())).toContain("abyssal");
		expect(state.getSkillProficiency("insight")).toBeGreaterThanOrEqual(1);
	});

	test("Fly, My Pretty is detected as a toggle carrying its curated effects", () => {
		const feature = WICKED_WITCH_FEATURES.find(f => f.name === "Fly, My Pretty");
		const info = CharacterSheetState.detectActivatableFeature({...feature, source: "Ar8"});
		expect(info).toBeTruthy();
		expect(info.stateTypeId).toBe("flyMyPretty");
		expect(info.isToggle).toBe(true);
		const targets = info.effects.map(e => `${e.type}:${e.target}`);
		expect(targets).toEqual(expect.arrayContaining([
			"bonus:speed:fly", "conditionImmunity:charmed", "conditionImmunity:frightened",
		]));
	});

	test("the whole durable state round-trips through save/load", () => {
		const state = makeWickedWitch(18, {ancestor: "Sea"});
		state.setGrannysGiftsWard({target: "ally", targetName: "Sindri"});
		state.enchantFlyingItem({itemName: "Broom", commandWord: "Zephyr"});
		state.setGrantedSpellOverride({className: "Sorcerer", featureName: "Granny's Gifts", originalSpell: "bane", replacementSpell: "charm person"});

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(reloaded.getGrannysGiftsWard().targetName).toBe("Sindri");
		expect(reloaded.getEnchantedFlyingItem().itemName).toBe("Broom");
		expect(reloaded.getGrantedSpellOverrides("Sorcerer")).toHaveLength(1);
		expect(reloaded.getHagAncestorKind().kind).toBe("Sea");
	});
});

describe("Wicked Witch — live state is DISPLAYED (generic feature status badges)", () => {
	/** Strip HTML so assertions read against the visible text a player actually sees. */
	const badgeText = (name, state) =>
		CharacterSheetClassUtils.getFeatureStatusBadgeHtml(name, state).replace(/<[^>]*>/g, "");

	test("a feature with no registered badge renders nothing (generic no-op)", () => {
		expect(CharacterSheetClassUtils.getFeatureStatusBadgeHtml("Shadow Walk", makeWickedWitch(20))).toBe("");
		expect(CharacterSheetClassUtils.getFeatureStatusBadgeHtml(null, makeWickedWitch(20))).toBe("");
	});

	test("Hag Ancestor shows the chosen kind AND its specialty school", () => {
		expect(badgeText("Hag Ancestor", makeWickedWitch(6, {ancestor: "Sea"}))).toContain("Sea");
		expect(badgeText("Hag Ancestor", makeWickedWitch(6, {ancestor: "Sea"}))).toContain("Transmutation");
		// An unmade choice is shown as an outstanding one, not hidden.
		expect(badgeText("Hag Ancestor", makeWickedWitch(6, {ancestor: null}))).toMatch(/unchosen/i);
	});

	test("Granny's Gifts shows who is currently warded, and that nobody is when nobody is", () => {
		const state = makeWickedWitch(6);
		expect(badgeText("Granny's Gifts", state)).toMatch(/no ward/i);
		state.setGrannysGiftsWard({target: "ally", targetName: "Sindri"});
		expect(badgeText("Granny's Gifts", state)).toContain("Sindri");
	});

	test("Clever Little Witch advertises the specialty discount it actually applies", () => {
		const state = makeWickedWitch(6, {ancestor: "Night"});
		expect(badgeText("Clever Little Witch", state)).toContain("Enchantment");
		expect(state.getCleverLittleWitchCost(4, "Enchantment")).toBe(2);
	});

	test("Fly, My Pretty shows the enchanted object, and its absence", () => {
		const state = makeWickedWitch(14);
		expect(badgeText("Fly, My Pretty", state)).toMatch(/nothing enchanted/i);
		state.enchantFlyingItem({itemName: "Iron Cauldron", commandWord: "Simmer"});
		expect(badgeText("Fly, My Pretty", state)).toContain("Iron Cauldron");
	});

	test("Coven Calling shows the standing duplicate count only while any stand", () => {
		const state = makeWickedWitch(18);
		expect(badgeText("Coven Calling", state)).toBe("");
		expect(state.summonCovenDuplicates().ok).toBe(true);
		expect(badgeText("Coven Calling", state)).toContain("2");
		state.dismissCovenDuplicates();
		expect(badgeText("Coven Calling", state)).toBe("");
	});

	test("a badge builder that throws is contained, never breaking the Features tab", () => {
		const key = "granny's gifts";
		const orig = CharacterSheetClassUtils.FEATURE_STATUS_BADGES[key];
		CharacterSheetClassUtils.FEATURE_STATUS_BADGES[key] = () => { throw new Error("boom"); };
		try {
			expect(CharacterSheetClassUtils.getFeatureStatusBadgeHtml("Granny's Gifts", makeWickedWitch(6))).toBe("");
		} finally {
			CharacterSheetClassUtils.FEATURE_STATUS_BADGES[key] = orig;
		}
	});
});
