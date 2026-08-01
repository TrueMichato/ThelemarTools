/**
 * College of Creation Bard (TCE) — MECHANICAL EFFECT tests.
 *
 * `CharacterSheetBard.test.js` PART 8 already pins the derived numbers that
 * `getFeatureCalculations()` exposes. This file pins the things that actually
 * *happen* — the acceptance bar for the subclass is that every feature does
 * something observable through the state APIs, not that it renders as text:
 *
 *   Mote of Potential (3)       — three distinct mode-dependent riders, and a
 *                                 hard guarantee that resolving one does NOT
 *                                 spend a second Bardic Inspiration use.
 *   Performance of Creation (3) — mints a real inventory item under gp / size /
 *                                 count caps, spending either the long-rest use
 *                                 or a 2nd+ level spell slot.
 *   Animating Performance (6)   — registers a Dancing Item through the GENERIC
 *                                 `CLASS_SUMMON` companion machinery, which
 *                                 re-scales on level-up and survives a save.
 *   Creative Crescendo (14)     — raises the item count and drops the gp cap.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureUsesParser = globalThis.FeatureUsesParser;

/** Build a College of Creation bard at `level` with CHA 20 (mod +5). */
function makeCreationBard (level, {cha = 20} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Gnome", source: "PHB"});
	state.addClass({
		name: "Bard",
		source: "PHB",
		level,
		subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
	});
	state.setAbilityBase("cha", cha);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	return state;
}

/**
 * Level the bard up through the real `addClass` path (which is what the
 * level-up wizard uses), so companion re-scaling is exercised end-to-end.
 */
function levelBardTo (state, level) {
	state.addClass({
		name: "Bard",
		source: "PHB",
		level,
		subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
	});
}

/**
 * The features the sheet gets from the data files aren't available in Jest, so
 * mirror what `addFeature` would have produced: a 1/long-rest pool for each of
 * the two actions, plus its mirrored resource.
 */
function addCreationFeatures (state) {
	for (const name of ["Performance of Creation", "Animating Performance"]) {
		state.addFeature({
			name,
			source: "TCE",
			uses: {current: 1, max: 1, recharge: "long"},
			description: `${name} test fixture.`,
		});
	}
	return state;
}

// ==========================================================================
// PART 1: the parser bug that minted a bogus 20-use pool
// ==========================================================================
describe("FeatureUsesParser — 'N times <noun>' is multiplication, not a use count", () => {
	const profBonus = () => 3;
	const abilityMod = () => 4;

	it("does not read Performance of Creation's gp formula as 20 uses", () => {
		const text = "You can use your musical performance to create one nonmagical item. "
			+ "The gp value of the item can't be more than 20 times your bard level. "
			+ "Once you create an item with this feature, you can't do so again until you "
			+ "finish a long rest, unless you expend a spell slot of 2nd level or higher.";
		const parsed = FeatureUsesParser.parseUses(text, abilityMod, profBonus);
		expect(parsed).not.toBeNull();
		expect(parsed.max).toBe(1);
		expect(parsed.recharge).toBe("long");
	});

	it("does not read the Dancing Item HP formula as a use count", () => {
		const text = "The item has AC 16 and a number of hit points equal to 10 plus five times "
			+ "your bard level. Once you animate an object, you can't do so again until you "
			+ "finish a long rest, unless you expend a spell slot of 3rd level or higher.";
		const parsed = FeatureUsesParser.parseUses(text, abilityMod, profBonus);
		expect(parsed.max).toBe(1);
	});

	it("still reads a genuine frequency ('3 times per day')", () => {
		const parsed = FeatureUsesParser.parseUses(
			"You can use this 3 times per day, and you regain all expended uses when you finish a long rest.",
			abilityMod,
			profBonus,
		);
		expect(parsed.max).toBe(3);
	});

	it("still reads '2 uses' followed by a rest clause", () => {
		const parsed = FeatureUsesParser.parseUses(
			"This feature has 2 uses. You regain all expended uses when you finish a short rest.",
			abilityMod,
			profBonus,
		);
		expect(parsed.max).toBe(2);
		expect(parsed.recharge).toBe("short");
	});
});

// ==========================================================================
// PART 2: Mote of Potential
// ==========================================================================
describe("Mote of Potential (Bard 3)", () => {
	it("offers exactly the three riders, with the numbers already resolved", () => {
		const state = makeCreationBard(3);
		const modes = state.getMoteOfPotentialModes();
		expect(modes.map(m => m.id)).toEqual(["check", "attack", "save"]);
		expect(modes.every(m => m.die === "1d6")).toBe(true);
		// Attack mode saves against the bard's own spell save DC (8 + 2 prof + 5 CHA).
		expect(modes.find(m => m.id === "attack").dc).toBe(15);
		expect(modes.find(m => m.id === "attack").save).toBe("con");
		expect(modes.find(m => m.id === "save").tempHpBonus).toBe(5);
	});

	it("returns no modes for a bard without the subclass", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 3, subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"}});
		expect(state.getMoteOfPotentialModes()).toEqual([]);
	});

	it("Ability Check mode rolls the die twice and keeps the higher", () => {
		const state = makeCreationBard(5);
		const res = state.rollMoteOfPotential("check", {roll: 2, secondRoll: 7});
		expect(res.rolls).toEqual([2, 7]);
		expect(res.result).toBe(7);
	});

	it("Attack mode returns thunder damage plus the CON save DC", () => {
		const state = makeCreationBard(5);
		const res = state.rollMoteOfPotential("attack", {roll: 6});
		expect(res.damage).toBe(6);
		expect(res.damageType).toBe("thunder");
		expect(res.save).toBe("con");
		expect(res.dc).toBe(state.getSpellSaveDcForAbility("cha"));
	});

	it("Saving Throw mode grants die + CHA temporary hit points (minimum 1)", () => {
		const state = makeCreationBard(5); // CHA +5
		const res = state.rollMoteOfPotential("save", {roll: 3});
		expect(res.tempHp).toBe(8);
		expect(res.applied).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it("Saving Throw mode can apply its temporary hit points to the bard, never lowering existing temp HP", () => {
		const state = makeCreationBard(5);
		state.rollMoteOfPotential("save", {roll: 3, applyTempHpToSelf: true});
		expect(state.getTempHp()).toBe(8);
		// A worse roll must not overwrite a better pool (5e temp-HP stacking rule).
		state.rollMoteOfPotential("save", {roll: 1, applyTempHpToSelf: true});
		expect(state.getTempHp()).toBe(8);
	});

	it("clamps a forced roll into the die's range", () => {
		const state = makeCreationBard(3); // d6
		expect(state.rollMoteOfPotential("attack", {roll: 99}).damage).toBe(6);
		expect(state.rollMoteOfPotential("attack", {roll: -4}).damage).toBe(1);
	});

	it("returns null for an unknown mode", () => {
		expect(makeCreationBard(3).rollMoteOfPotential("nonsense")).toBeNull();
	});

	it("does NOT spend a Bardic Inspiration use — the die was already handed out", () => {
		const state = makeCreationBard(5);
		state.addFeature({name: "Bardic Inspiration", source: "PHB", uses: {current: 5, max: 5, recharge: "long"}});
		const before = state.getFeatureUses("Bardic Inspiration");
		state.rollMoteOfPotential("check");
		state.rollMoteOfPotential("attack");
		state.rollMoteOfPotential("save", {applyTempHpToSelf: true});
		expect(state.getFeatureUses("Bardic Inspiration")).toBe(before);
	});

	it("scales its die with Bardic Inspiration", () => {
		expect(makeCreationBard(3).getMoteOfPotentialModes()[0].die).toBe("1d6");
		expect(makeCreationBard(5).getMoteOfPotentialModes()[0].die).toBe("1d8");
		expect(makeCreationBard(10).getMoteOfPotentialModes()[0].die).toBe("1d10");
		expect(makeCreationBard(15).getMoteOfPotentialModes()[0].die).toBe("1d12");
	});
});

// ==========================================================================
// PART 3: Performance of Creation
// ==========================================================================
describe("Performance of Creation (Bard 3)", () => {
	it("puts a real item into the inventory and spends the long-rest use", () => {
		const state = addCreationFeatures(makeCreationBard(3));
		const res = state.createPerformanceOfCreationItem({name: "Silk Rope", size: "Medium", valueGp: 25});
		expect(res.ok).toBe(true);
		expect(res.spent).toBe("use");
		expect(state.getFeatureUses("Performance of Creation")).toBe(0);

		const items = state.getPerformanceOfCreationItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("Silk Rope");
		// 5etools item values are copper pieces.
		expect(items[0].value).toBe(2500);
		expect(items[0]._createdSize).toBe("Medium");
		// It is a genuine inventory row, not a parallel ledger.
		expect(state.getInventory().some(i => i.item.name === "Silk Rope")).toBe(true);
	});

	it("rejects an item above the level-scaled gp cap", () => {
		const state = addCreationFeatures(makeCreationBard(3)); // cap = 3 * 20 = 60 gp
		const res = state.createPerformanceOfCreationItem({name: "Gilded Harp", valueGp: 61});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/60 gp/);
		// A rejected creation must not consume the use.
		expect(state.getFeatureUses("Performance of Creation")).toBe(1);
		expect(state.getPerformanceOfCreationItems()).toHaveLength(0);
	});

	it("rejects an item above the level-scaled size cap", () => {
		const state = addCreationFeatures(makeCreationBard(3)); // Medium
		const res = state.createPerformanceOfCreationItem({name: "Siege Ladder", size: "Large", valueGp: 1});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/Medium/);
		expect(state.getFeatureUses("Performance of Creation")).toBe(1);
	});

	it("allows Large at 6 and Huge at 14", () => {
		expect(addCreationFeatures(makeCreationBard(6))
			.createPerformanceOfCreationItem({name: "Cart", size: "Large", valueGp: 1}).ok).toBe(true);
		expect(addCreationFeatures(makeCreationBard(14))
			.createPerformanceOfCreationItem({name: "Statue", size: "Huge", valueGp: 1}).ok).toBe(true);
	});

	it("can spend a 2nd+ level spell slot instead of the long-rest use", () => {
		const state = addCreationFeatures(makeCreationBard(5));
		state.setFeatureUses(state.getFeature("Performance of Creation").id, 0);
		const slotsBefore = state.getSpellSlots()[2].current;

		const res = state.createPerformanceOfCreationItem({name: "Lantern", valueGp: 5, spellSlotLevel: 2});
		expect(res.ok).toBe(true);
		expect(res.spent).toBe("slot2");
		expect(state.getSpellSlots()[2].current).toBe(slotsBefore - 1);
	});

	it("refuses a spell slot below the feature's minimum level", () => {
		const state = addCreationFeatures(makeCreationBard(5));
		const res = state.createPerformanceOfCreationItem({name: "Lantern", valueGp: 5, spellSlotLevel: 1});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/level 2 or higher/);
		expect(state.getSpellSlots()[1].current).toBe(state.getSpellSlots()[1].max);
	});

	it("explains how to keep going once the long-rest use is spent", () => {
		const state = addCreationFeatures(makeCreationBard(3));
		state.createPerformanceOfCreationItem({name: "Rope", valueGp: 1});
		const res = state.createPerformanceOfCreationItem({name: "Pole", valueGp: 1});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/spell slot/);
	});

	it("vanishes the oldest item when the simultaneous-item cap is exceeded", () => {
		const state = addCreationFeatures(makeCreationBard(5)); // cap = 1 before level 14
		state.createPerformanceOfCreationItem({name: "Rope", valueGp: 1});
		const res = state.createPerformanceOfCreationItem({name: "Pole", valueGp: 1, spellSlotLevel: 2});
		expect(res.ok).toBe(true);
		expect(res.replaced).toEqual(["Rope"]);
		expect(state.getPerformanceOfCreationItems().map(i => i.name)).toEqual(["Pole"]);
	});

	it("names the item's duration in proficiency-bonus hours", () => {
		const state = addCreationFeatures(makeCreationBard(5)); // PB 3
		state.createPerformanceOfCreationItem({name: "Rope", valueGp: 1});
		const [item] = state.getPerformanceOfCreationItems();
		expect(item._createdExpiresHours).toBe(3);
		expect(state.getFeatureCalculations().createdItemDuration).toBe("3 hours");
	});

	it("dismisses created items without touching the rest of the inventory", () => {
		const state = addCreationFeatures(makeCreationBard(14));
		state.addItem({name: "Backpack", source: "PHB", type: "G"});
		state.createPerformanceOfCreationItem({name: "Rope", valueGp: 1});
		expect(state.dismissPerformanceOfCreationItems()).toBe(1);
		expect(state.getPerformanceOfCreationItems()).toHaveLength(0);
		expect(state.getInventory().some(i => i.item.name === "Backpack")).toBe(true);
	});

	it("clears every created item on a long rest (they last only PB hours)", () => {
		const state = addCreationFeatures(makeCreationBard(14));
		state.createPerformanceOfCreationItem({name: "Rope", valueGp: 1});
		expect(state.getPerformanceOfCreationItems()).toHaveLength(1);
		state.onLongRest();
		expect(state.getPerformanceOfCreationItems()).toHaveLength(0);
		expect(state.getFeatureUses("Performance of Creation")).toBe(1);
	});

	it("is unavailable to a bard of another college", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 5, subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"}});
		const res = state.createPerformanceOfCreationItem({name: "Rope"});
		expect(res.ok).toBe(false);
	});
});

// ==========================================================================
// PART 4: Animating Performance
// ==========================================================================
describe("Animating Performance (Bard 6)", () => {
	it("summons a Dancing Item through the generic CLASS_SUMMON machinery", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		const res = state.animateDancingItem({itemName: "Broom"});
		expect(res.ok).toBe(true);
		expect(res.spent).toBe("use");

		const item = state.getDancingItem();
		expect(item).not.toBeNull();
		expect(item.type).toBe(CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON);
		expect(item.origin).toBe("Animating Performance");
		expect(item.customName).toBe("Broom");
		expect(item.hp.max).toBe(40); // 10 + 5 × 6
		expect(item.ac).toBe(16);
		// It shows up as a normal companion, so the Companions panel renders it.
		expect(state.getActiveCompanions().some(c => c.id === item.id)).toBe(true);
	});

	it("gives the Dancing Item a Force-Empowered Slam scaled off the bard", () => {
		const state = addCreationFeatures(makeCreationBard(6)); // PB 3, CHA +5
		state.animateDancingItem({itemName: "Broom"});
		const slam = state.getDancingItem().actions.find(a => a.name === "Force-Empowered Slam");
		expect(slam).toBeDefined();
		expect(slam.entries[0]).toContain("+8 to hit"); // 3 prof + 5 CHA
		expect(slam.entries[0]).toContain("1d10 + 3 force damage");
	});

	it("re-scales HP and to-hit on level-up without a bespoke companion case", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.animateDancingItem({itemName: "Broom"});
		levelBardTo(state, 12);
		state.recalculateAllCompanions();

		const item = state.getDancingItem();
		expect(item.hp.max).toBe(70); // 10 + 5 × 12
		expect(item.hp.current).toBe(70); // was at full, stays at full
		expect(item.actions.find(a => a.name === "Force-Empowered Slam").entries[0]).toContain("+9 to hit");
	});

	it("does not heal a damaged Dancing Item when it re-scales", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.animateDancingItem({itemName: "Broom"});
		state.getDancingItem().hp.current = 12;
		levelBardTo(state, 12);
		state.recalculateAllCompanions();
		expect(state.getDancingItem().hp.current).toBe(12);
		expect(state.getDancingItem().hp.max).toBe(70);
	});

	it("only one object can be animated at a time", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.animateDancingItem({itemName: "Broom"});
		state.setFeatureUses(state.getFeature("Animating Performance").id, 1);
		const res = state.animateDancingItem({itemName: "Chair"});
		expect(res.replaced).toBe("Broom");
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON)).toHaveLength(1);
		expect(state.getDancingItem().customName).toBe("Chair");
	});

	it("can spend a 3rd+ level spell slot instead of the long-rest use", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.setFeatureUses(state.getFeature("Animating Performance").id, 0);
		const before = state.getSpellSlots()[3].current;
		const res = state.animateDancingItem({itemName: "Broom", spellSlotLevel: 3});
		expect(res.ok).toBe(true);
		expect(state.getSpellSlots()[3].current).toBe(before - 1);
	});

	it("refuses a 2nd-level slot", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		const res = state.animateDancingItem({itemName: "Broom", spellSlotLevel: 2});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/level 3 or higher/);
	});

	it("is unavailable before level 6", () => {
		const state = addCreationFeatures(makeCreationBard(5));
		expect(state.animateDancingItem({itemName: "Broom"}).ok).toBe(false);
		expect(state.getDancingItem()).toBeNull();
	});

	it("becomes inanimate on a long rest and can be dismissed by hand", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.animateDancingItem({itemName: "Broom"});
		expect(state.dismissDancingItem()).toBe(true);
		expect(state.getDancingItem()).toBeNull();

		state.setFeatureUses(state.getFeature("Animating Performance").id, 1);
		state.animateDancingItem({itemName: "Broom"});
		state.onLongRest();
		expect(state.getDancingItem()).toBeNull();
	});

	it("survives a save/load round-trip with its scaling descriptor intact", () => {
		const state = addCreationFeatures(makeCreationBard(6));
		state.animateDancingItem({itemName: "Broom"});

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		const item = reloaded.getDancingItem();
		expect(item).not.toBeNull();
		expect(item.scaling.attackAbility).toBe("cha");
		levelBardTo(reloaded, 14);
		reloaded.recalculateAllCompanions();
		expect(reloaded.getDancingItem().hp.max).toBe(80);
	});
});

// ==========================================================================
// PART 5: Creative Crescendo
// ==========================================================================
describe("Creative Crescendo (Bard 14)", () => {
	it("removes the gp cap entirely", () => {
		const state = addCreationFeatures(makeCreationBard(14));
		expect(state.getFeatureCalculations().createdItemMaxGp).toBeNull();
		const res = state.createPerformanceOfCreationItem({name: "Golden Throne", size: "Small", valueGp: 100000});
		expect(res.ok).toBe(true);
	});

	it("raises the simultaneous-item count to the Charisma modifier (minimum 2)", () => {
		expect(addCreationFeatures(makeCreationBard(14)).getFeatureCalculations().createdItemMaxCount).toBe(5);
		expect(addCreationFeatures(makeCreationBard(14, {cha: 10})).getFeatureCalculations().createdItemMaxCount).toBe(2);
		// The pre-14 cap is still a single item.
		expect(addCreationFeatures(makeCreationBard(13)).getFeatureCalculations().createdItemMaxCount).toBe(1);
	});

	it("keeps several items alive at once instead of replacing them", () => {
		const state = addCreationFeatures(makeCreationBard(14)); // cap 5
		state.createPerformanceOfCreationItem({name: "Rope", size: "Tiny", valueGp: 1});
		state.createPerformanceOfCreationItem({name: "Pole", size: "Tiny", valueGp: 1, spellSlotLevel: 2});
		state.createPerformanceOfCreationItem({name: "Lamp", size: "Small", valueGp: 1, spellSlotLevel: 2});
		expect(state.getPerformanceOfCreationItems().map(i => i.name)).toEqual(["Rope", "Pole", "Lamp"]);
	});

	it("allows only ONE of the simultaneous items to be at the maximum size", () => {
		const state = addCreationFeatures(makeCreationBard(14));
		expect(state.createPerformanceOfCreationItem({name: "Statue", size: "Huge", valueGp: 1}).ok).toBe(true);
		const res = state.createPerformanceOfCreationItem({name: "Obelisk", size: "Huge", valueGp: 1, spellSlotLevel: 2});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/Only one created item can be Huge/);
		// The rejected creation must not have spent the slot.
		expect(state.getSpellSlots()[2].current).toBe(state.getSpellSlots()[2].max);
	});
});

// ==========================================================================
// PART 6: use-pool repair for characters saved before the parser fix
// ==========================================================================
describe("College of Creation use-pool repair", () => {
	it("clamps a bogus 20-use Performance of Creation pool down to 1/long rest", () => {
		const state = addCreationFeatures(makeCreationBard(5));
		const feature = state.getFeature("Performance of Creation");
		// Reproduce the shape a pre-fix save carries, on BOTH the feature and its
		// mirrored resource, before anything reads them back.
		feature.uses = {current: 20, max: 20, recharge: "long"};
		const stale = state._data.resources.find(r => r.featureId === feature.id);
		if (stale) { stale.max = 20; stale.current = 20; }

		const repaired = state.getResources().find(r => r.featureId === feature.id);
		expect(state.getFeature("Performance of Creation").uses).toEqual({current: 1, max: 1, recharge: "long"});
		if (repaired) expect(repaired.max).toBe(1);
	});

	it("preserves a spent use while repairing the pool", () => {
		const state = addCreationFeatures(makeCreationBard(5));
		const feature = state.getFeature("Performance of Creation");
		feature.uses = {current: 3, max: 20, recharge: "long"};
		state.getResources();
		expect(state.getFeature("Performance of Creation").uses.current).toBe(0);
	});

	it("leaves a non-Creation bard's feature pools alone", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 5, subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"}});
		state.addFeature({name: "Performance of Creation", source: "TCE", uses: {current: 20, max: 20, recharge: "long"}});
		state.getResources();
		expect(state.getFeature("Performance of Creation").uses.max).toBe(20);
	});
});
