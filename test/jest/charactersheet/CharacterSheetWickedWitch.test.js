/**
 * Wicked Witch Sorcerous Origin (Arcadia 8) — mechanical-effect coverage.
 *
 * The subclass reaches the sheet as a `_copy` in `homebrew/TravelersGuidetoThelemar.json`
 * that re-parents an Ar8 origin written for `classSource: "PHB"` onto the TGTT Sorcerer
 * chassis, where Sorcerous Origin is a LEVEL 3 feature and Font of Magic a level 1 one.
 * Both facts are asserted here, because both are easy to get silently wrong.
 *
 * Every test asserts an OBSERVABLE consequence — a language on the sheet, a skill
 * proficiency, an aggregated save advantage, a Sorcery Point balance, a flying speed, a
 * condition immunity — never the bare presence of a `hasXxx` flag.
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** The four subclass features, with the Ar8 prose the parsers see. */
const WICKED_WITCH_FEATURES = [
	{
		level: 1,
		name: "Granny's Gifts",
		description: "You learn additional spells when you reach certain levels in this class. These spells count as sorcerer spells for you, but they don't count against the number of sorcerer spells you know. Additionally, whenever you finish a long rest, you can choose yourself or one creature you can see within 30 feet of you. The target has advantage on saving throws against being charmed or frightened until the end of your next long rest or until you die.",
	},
	{
		level: 1,
		name: "Hag Ancestor",
		description: "Choose the kind of hag you are descended from. Your choice grants you a language, a skill proficiency, and a magic specialty. In addition, you have advantage on Charisma checks made to influence hags.",
	},
	{
		level: 6,
		name: "Clever Little Witch",
		description: "When a creature you can see targets you or an ally within 15 feet of you with a spell of 1st level or higher, you can use your reaction to cast that spell back at the caster, spending a number of sorcery points equal to the spell's level. If the spell is from your ancestor's specialty school, it instead costs half that number of sorcery points, rounded down.",
		consumes: {name: "Sorcery Point", amountMin: 1, amountMax: 9},
	},
	{
		level: 14,
		name: "Fly, My Pretty",
		description: "When you finish a long rest, you can touch a Small or Medium object and enchant it to fly. When you ride the object and speak its command word as an action or bonus action, it hovers with a flying speed of 60 feet. While flying on the object, you can't be charmed or frightened.",
	},
	{
		level: 18,
		name: "Coven Calling",
		description: "When you use Clever Little Witch, you can instead cast any spell of 1st level or higher that you saw the triggering creature cast in the last minute. In addition, you can spend 2 sorcery points as an action to conjure two duplicates of yourself in the guise of hags.",
		consumes: {name: "Sorcery Point", amount: 2},
	},
];

/**
 * Build a Wicked Witch sorcerer on the TGTT chassis (the shipping configuration), with
 * exactly the subclass features a sorcerer of `level` would carry.
 *
 * @param {number} level
 * @param {object} [opts]
 * @param {string} [opts.source="TGTT"] class source; "PHB" reproduces the raw Ar8 chassis.
 * @param {?string} [opts.ancestor="Green"] the Hag Ancestor pick, or null for "not chosen".
 * @param {boolean} [opts.withFeatures=true]
 */
function makeWitch (level = 20, {source = "TGTT", ancestor = "Green", withFeatures = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state._data.classes = [{
		name: "Sorcerer",
		source,
		level,
		subclass: {name: "Wicked Witch Sorcerous Origin", shortName: "Wicked Witch", source: "TGTT-AR"},
	}];
	state._data.saveProficiencies = ["cha", "con"];
	state.setHp(60, 60);

	// The TGTT chassis grants the origin at 3; the raw Ar8 chassis at 1.
	const subclassLevel = source === "TGTT" || source === "XPHB" ? 3 : 1;
	if (withFeatures) {
		for (const f of WICKED_WITCH_FEATURES) {
			const gainedAt = f.level === 1 ? subclassLevel : f.level;
			if (level < gainedAt) continue;
			state.addFeature({...f, level: gainedAt, source: "Ar8"});
		}
		if (ancestor && level >= subclassLevel) {
			state._recordChosenSubfeature({
				parent: "Hag Ancestor",
				parentSource: "Ar8",
				parentClass: "Sorcerer",
				level: subclassLevel,
				name: CharacterSheetState.getHagAncestorOptionName(ancestor),
				source: "Ar8",
			});
		}
	}
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

describe("Wicked Witch — the chassis it actually ships on", () => {
	it("gains the origin at LEVEL 3 on the TGTT chassis, not level 1", () => {
		expect(makeWitch(2).getFeatureCalculations().hasGrannysGifts).toBeFalsy();
		expect(makeWitch(3).getFeatureCalculations().hasGrannysGifts).toBe(true);
		// The raw Ar8 chassis (classSource PHB) still gains it at 1.
		expect(makeWitch(1, {source: "PHB"}).getFeatureCalculations().hasGrannysGifts).toBe(true);
	});

	it("uses the TGTT Sorcery Point ladder (level + 1, from level 1)", () => {
		// Font of Magic is a level 1 TGTT feature, so the pool exists a level earlier and
		// is one point larger than the PHB ladder at every level.
		expect(makeWitch(1).getSorceryPoints().max).toBe(2);
		expect(makeWitch(3).getSorceryPoints().max).toBe(4);
		expect(makeWitch(11).getSorceryPoints().max).toBe(12);
		expect(makeWitch(20).getSorceryPoints().max).toBe(21);
		// The PHB chassis gives `level` from level 2 — verifying the branch, not the table.
		expect(makeWitch(1, {source: "PHB"}).getSorceryPoints().max).toBe(0);
		expect(makeWitch(20, {source: "PHB"}).getSorceryPoints().max).toBe(20);
	});

	it("gates each tier at the level it is actually granted", () => {
		const at = (lvl) => makeWitch(lvl).getFeatureCalculations();
		expect(at(5).hasCleverLittleWitch).toBeFalsy();
		expect(at(6).hasCleverLittleWitch).toBe(true);
		expect(at(13).hasFlyMyPretty).toBeFalsy();
		expect(at(14).hasFlyMyPretty).toBe(true);
		expect(at(17).hasCovenCalling).toBeFalsy();
		expect(at(18).hasCovenCalling).toBe(true);
	});
});

describe("Hag Ancestor — a real choice with real grants", () => {
	it("offers exactly the three ancestries, each with a distinct specialty", () => {
		const opts = CharacterSheetState.getHagAncestorOptions();
		expect(opts.map(o => o.name)).toEqual(["Green Hag Ancestor", "Night Hag Ancestor", "Sea Hag Ancestor"]);
		const specialties = Object.values(CharacterSheetState.HAG_ANCESTOR_KINDS).map(d => d.specialty);
		expect(new Set(specialties).size).toBe(3);
		expect(specialties).toEqual(["illusion", "enchantment", "transmutation"]);
	});

	it("surfaces the ancestry pick as a pending choice all three wizards drain", () => {
		const state = makeWitch(3, {ancestor: null});
		// Both readers seed, because Builder / Level-Up / Quick Build reach the queue
		// through `processPendingFeatureChoices` → `hasPendingFeatureChoices`.
		expect(state.hasPendingFeatureChoices()).toBe(true);
		const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Hag Ancestor");
		expect(choice).toBeTruthy();
		expect(choice.kind).toBe("subfeature");
		expect(choice.options).toHaveLength(3);
		// Idempotent: a second drain must not stack a duplicate prompt.
		state.hasPendingFeatureChoices();
		expect(state.getPendingFeatureChoices().filter(c => c.featureName === "Hag Ancestor")).toHaveLength(1);
	});

	it("stops offering the pick once an ancestry is chosen", () => {
		const state = makeWitch(3, {ancestor: null});
		const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Hag Ancestor");
		expect(state.fulfillFeatureChoice(choice.id, {name: "Night Hag Ancestor", source: "Ar8"})).toBe(true);
		expect(state.getHagAncestorKind()).toBe("Night");
		expect(state.getPendingFeatureChoices().some(c => c.featureName === "Hag Ancestor")).toBe(false);
	});

	it("grants the ancestry's language and skill proficiency on the sheet", () => {
		const green = makeWitch(3, {ancestor: "Green"});
		expect(green.getLanguages()).toContain("Sylvan");
		expect(green.getSkillProficiency("deception")).toBeGreaterThanOrEqual(1);
		expect(green.getSkillProficiency("insight")).toBe(0);

		const night = makeWitch(3, {ancestor: "Night"});
		expect(night.getLanguages()).toContain("Abyssal");
		expect(night.getSkillProficiency("insight")).toBeGreaterThanOrEqual(1);

		const sea = makeWitch(3, {ancestor: "Sea"});
		expect(sea.getLanguages()).toContain("Primordial (Aquan)");
		expect(sea.getSkillProficiency("intimidation")).toBeGreaterThanOrEqual(1);
	});

	it("grants no language or skill until an ancestry is actually chosen", () => {
		const undecided = makeWitch(3, {ancestor: null});
		expect(undecided.getLanguages()).not.toContain("Sylvan");
		expect(undecided.getSkillProficiency("deception")).toBe(0);
		expect(undecided.getFeatureCalculations().hagAncestorSpecialty).toBeUndefined();
	});

	it("offers advantage on Charisma checks to influence hags as a gated conditional", () => {
		const state = makeWitch(3);
		const agg = state.aggregateModifiers("check:cha");
		const entry = agg.conditionalsAvailable.find(c => c.name === "Hag Ancestor");
		expect(entry).toBeTruthy();
		expect(entry.advantage).toBe(true);
		expect(entry.conditional).toMatch(/hag/i);
		// Default-off: it must NOT silently apply to every Charisma check.
		expect(agg.advantage).toBe(false);
		expect(state.aggregateModifiers("check:cha", {appliedConditionalIds: new Set([entry.id])}).advantage).toBe(true);
	});
});

describe("Granny's Gifts — the long-rest ward", () => {
	it("installs precisely-typed save advantage when you ward yourself", () => {
		const state = makeWitch(3);
		expect(state.setGrannysWardTarget("self")).toMatchObject({ok: true, isSelf: true});

		const charmed = state.aggregateModifiers("save:charmed").conditionalsAvailable
			.find(c => c.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME);
		const frightened = state.aggregateModifiers("save:frightened").conditionalsAvailable
			.find(c => c.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME);
		expect(charmed?.advantage).toBe(true);
		expect(frightened?.advantage).toBe(true);
		expect(state.aggregateModifiers("save:charmed", {appliedConditionalIds: new Set([charmed.id])}).advantage).toBe(true);
	});

	it("does not touch your own saves when the ward goes to an ally", () => {
		const state = makeWitch(3);
		expect(state.setGrannysWardTarget("Vex")).toMatchObject({ok: true, isSelf: false, target: "Vex"});
		expect(state.getGrannysWard().target).toBe("Vex");
		expect(state.getNamedModifiers().some(m => m.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME)).toBe(false);
	});

	it("enforces the 30 ft reach", () => {
		const state = makeWitch(3);
		expect(state.setGrannysWardTarget("Vex", {distance: 30})).toMatchObject({ok: true, target: "Vex"});
		expect(state.setGrannysWardTarget("Vex", {distance: 45})).toMatchObject({ok: false, range: 30});
		// The refused call must not have torn down the ward that was already up.
		expect(state.getGrannysWard()).toMatchObject({target: "Vex", distance: 30});
		// Warding yourself has no distance to check.
		expect(state.setGrannysWardTarget("self", {distance: 999})).toMatchObject({ok: true, isSelf: true});
	});

	it("replaces rather than stacks when re-targeted", () => {
		const state = makeWitch(3);
		state.setGrannysWardTarget("self");
		state.setGrannysWardTarget("self");
		const wardMods = state.getNamedModifiers().filter(m => m.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME);
		expect(wardMods).toHaveLength(2); // charmed + frightened, once each
		state.setGrannysWardTarget("Vex");
		expect(state.getNamedModifiers().filter(m => m.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME)).toHaveLength(0);
	});

	it("targets the ward precisely, not as a blanket save:all conditional", () => {
		const state = makeWitch(3);
		expect(state.aggregateModifiers("save:charmed").advantage).toBe(false);
		state.setGrannysWardTarget("self");
		const charmed = state.aggregateModifiers("save:charmed");
		expect(charmed.advantage).toBe(true);
		expect(charmed.sources).toContain(CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME);
		expect(state.aggregateModifiers("save:frightened").advantage).toBe(true);
		// Precisely typed, so an unrelated save is untouched — the prose parser's blanket
		// `save:all` reading of the same feature would have lit this up too.
		expect(state.aggregateModifiers("save:dex").advantage).toBe(false);
	});

	it("is cleared by a long rest, because RAW re-chooses it every rest", () => {
		const state = makeWitch(3);
		state.setGrannysWardTarget("self");
		expect(state.getGrannysWard()).toBeTruthy();
		state.onLongRest();
		expect(state.getGrannysWard()).toBeNull();
		expect(state.getNamedModifiers().some(m => m.name === CharacterSheetState.GRANNYS_WARD_MODIFIER_NAME)).toBe(false);
	});

	it("refuses when the character doesn't have the feature", () => {
		const state = makeWitch(2);
		expect(state.setGrannysWardTarget("self")).toMatchObject({ok: false});
	});
});

describe("Clever Little Witch — the specialty discount is the whole point", () => {
	it("costs the spell's level, halved and floored for the specialty school", () => {
		const green = makeWitch(6, {ancestor: "Green"}); // illusion
		expect(green.getCleverLittleWitchCost(5, "evocation")).toBe(5);
		expect(green.getCleverLittleWitchCost(5, "illusion")).toBe(2);
		expect(green.getCleverLittleWitchCost(1, "illusion")).toBe(0);
		expect(green.getCleverLittleWitchCost(9, "illusion")).toBe(4);
		// Spell records on the sheet carry 5etools single-letter school codes.
		expect(green.getCleverLittleWitchCost(4, "I")).toBe(2);
		expect(green.getCleverLittleWitchCost(4, "V")).toBe(4);
		// Out of range.
		expect(green.getCleverLittleWitchCost(0, "illusion")).toBeNull();
		expect(green.getCleverLittleWitchCost(10, "illusion")).toBeNull();
	});

	it("follows the ancestry, so a different pick discounts a different school", () => {
		expect(makeWitch(6, {ancestor: "Night"}).getCleverLittleWitchCost(6, "enchantment")).toBe(3);
		expect(makeWitch(6, {ancestor: "Night"}).getCleverLittleWitchCost(6, "illusion")).toBe(6);
		expect(makeWitch(6, {ancestor: "Sea"}).getCleverLittleWitchCost(6, "transmutation")).toBe(3);
		// No ancestry chosen → no discount at all.
		expect(makeWitch(6, {ancestor: null}).getCleverLittleWitchCost(6, "illusion")).toBe(6);
	});

	it("actually spends Sorcery Points through the production path", () => {
		const state = makeWitch(6); // 7 SP
		expect(state.getSorceryPoints().current).toBe(7);
		const res = state.useCleverLittleWitch({spellLevel: 4, school: "evocation"});
		expect(res).toMatchObject({ok: true, cost: 4, discounted: false});
		expect(state.getSorceryPoints().current).toBe(3);
		expect(res.spellSaveDc).toBe(state.getSpellSaveDc());
		expect(res.spellAttackBonus).toBe(state.getSpellAttackBonus());
	});

	it("charges the discounted price, and nothing at all for a 1st-level specialty spell", () => {
		const state = makeWitch(6, {ancestor: "Green"});
		const before = state.getSorceryPoints().current;
		expect(state.useCleverLittleWitch({spellLevel: 1, school: "illusion"})).toMatchObject({ok: true, cost: 0, discounted: true});
		expect(state.getSorceryPoints().current).toBe(before);
		expect(state.useCleverLittleWitch({spellLevel: 7, school: "illusion"})).toMatchObject({ok: true, cost: 3});
		expect(state.getSorceryPoints().current).toBe(before - 3);
	});

	it("refuses out-of-range allies, missing points, and the feature being absent", () => {
		expect(makeWitch(5).useCleverLittleWitch({spellLevel: 1})).toMatchObject({ok: false});
		expect(makeWitch(6).useCleverLittleWitch({spellLevel: 3, distance: 40})).toMatchObject({ok: false});
		const poor = makeWitch(6);
		poor.setSorceryPoints({current: 1, max: 7});
		expect(poor.useCleverLittleWitch({spellLevel: 5, school: "evocation"})).toMatchObject({ok: false});
		expect(poor.getSorceryPoints().current).toBe(1);
	});

	it("only allows the Coven Calling recall from level 18", () => {
		expect(makeWitch(17).useCleverLittleWitch({spellLevel: 2, recalled: true})).toMatchObject({ok: false});
		expect(makeWitch(18).useCleverLittleWitch({spellLevel: 2, recalled: true})).toMatchObject({ok: true, recalled: true});
	});
});

describe("Coven Calling — two duplicates, both spending real points", () => {
	it("conjures two duplicates for 2 Sorcery Points", () => {
		const state = makeWitch(18); // 19 SP
		expect(state.conjureCovenDuplicates()).toMatchObject({ok: true, count: 2, sorceryPointsRemaining: 17});
		expect(state.getCovenDuplicates()).toMatchObject({count: 2, remaining: 2, maxSpellLevel: 3});
	});

	it("spends one duplicate's action per cast, at the spell's level in points", () => {
		const state = makeWitch(18);
		state.conjureCovenDuplicates();
		expect(state.castCovenDuplicateSpell(3)).toMatchObject({ok: true, cost: 3, duplicatesRemaining: 1, sorceryPointsRemaining: 14});
		expect(state.castCovenDuplicateSpell(1)).toMatchObject({ok: true, cost: 1, duplicatesRemaining: 0, sorceryPointsRemaining: 13});
		// Both duplicates have acted.
		expect(state.castCovenDuplicateSpell(1)).toMatchObject({ok: false});
	});

	it("enforces the 1st–3rd level ceiling", () => {
		const state = makeWitch(18);
		state.conjureCovenDuplicates();
		const before = state.getSorceryPoints().current;
		expect(state.castCovenDuplicateSpell(4)).toMatchObject({ok: false});
		expect(state.castCovenDuplicateSpell(0)).toMatchObject({ok: false});
		expect(state.getSorceryPoints().current).toBe(before);
		expect(state.getCovenDuplicates().remaining).toBe(2);
	});

	it("refuses below level 18, and when the points aren't there", () => {
		expect(makeWitch(17).conjureCovenDuplicates()).toMatchObject({ok: false});
		const poor = makeWitch(18);
		poor.setSorceryPoints({current: 1, max: 19});
		expect(poor.conjureCovenDuplicates()).toMatchObject({ok: false});
		expect(poor.getCovenDuplicates()).toBeNull();
	});

	it("does not survive a long rest", () => {
		const state = makeWitch(18);
		state.conjureCovenDuplicates();
		state.onLongRest();
		expect(state.getCovenDuplicates()).toBeNull();
	});
});

describe("Fly, My Pretty — the enchanted object", () => {
	it("enchants exactly one object at a time", () => {
		const state = makeWitch(14);
		expect(state.enchantFlyingItem({item: "Broom", commandWord: "Zoom"})).toMatchObject({ok: true, item: "Broom", commandWord: "Zoom", flySpeed: 60, replaced: null});
		expect(state.enchantFlyingItem({item: "Cauldron"})).toMatchObject({ok: true, item: "Cauldron", replaced: "Broom"});
		expect(state.getFlyingItem().item).toBe("Cauldron");
	});

	it("grants a 60 ft flying speed and charm/fear immunity only while ridden", () => {
		const state = makeWitch(14);
		state.enchantFlyingItem({item: "Broom"});
		expect(state.getSpeed("fly")).toBe(0);
		expect(state.getConditionImmunities()).not.toContain("charmed");

		state.activateState("flyMyPretty");
		expect(state.getSpeed("fly")).toBe(60);
		expect(state.getConditionImmunities()).toEqual(expect.arrayContaining(["charmed", "frightened"]));

		state.deactivateState("flyMyPretty");
		expect(state.getSpeed("fly")).toBe(0);
		expect(state.getConditionImmunities()).not.toContain("charmed");
	});

	it("dismounts you when the ride ends via a new enchantment or a long rest", () => {
		const state = makeWitch(14);
		state.enchantFlyingItem({item: "Broom"});
		state.activateState("flyMyPretty");
		state.enchantFlyingItem({item: "Cauldron"});
		expect(state.isStateActive("flyMyPretty")).toBe(false);

		state.activateState("flyMyPretty");
		state.onLongRest();
		expect(state.isStateActive("flyMyPretty")).toBe(false);
	});

	it("refuses before level 14", () => {
		const state = makeWitch(13);
		expect(state.enchantFlyingItem({item: "Broom"})).toMatchObject({ok: false});
		expect(state.getFlyingItem()).toBeNull();
	});
});

describe("Wicked Witch — every ability is reachable from the sheet", () => {
	it("classifies each active ability so it renders with a Use affordance", () => {
		const state = makeWitch(20);
		for (const name of ["Granny's Gifts", "Clever Little Witch", "Fly, My Pretty", "Coven Calling"]) {
			const feature = state.getFeature(name);
			expect(feature).toBeTruthy();
			const info = CharacterSheetState.detectActivatableFeature(feature);
			expect(info).toBeTruthy();
			expect(info.interactionMode).toBe("limited");
		}
		// Hag Ancestor is purely passive — it must NOT leak into the activatable surface.
		expect(CharacterSheetState.detectActivatableFeature(state.getFeature("Hag Ancestor"))).toBeNull();
	});

	it("round-trips its bookkeeping through save/load", () => {
		const state = makeWitch(20);
		state.setGrannysWardTarget("Vex");
		state.enchantFlyingItem({item: "Broom", commandWord: "Zoom"});
		state.conjureCovenDuplicates();

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.getGrannysWard()).toMatchObject({target: "Vex", isSelf: false});
		expect(reloaded.getFlyingItem()).toMatchObject({item: "Broom", commandWord: "Zoom"});
		expect(reloaded.getCovenDuplicates()).toMatchObject({remaining: 2});
		expect(reloaded.getHagAncestorKind()).toBe("Green");
		expect(reloaded.getCleverLittleWitchCost(5, "illusion")).toBe(2);
	});
});
