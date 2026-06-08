/**
 * Circle of the Zodiac / Circle of the Stars — Star Map (Guiding Bolt) coverage.
 *
 * Star Map grants slot-free casts of Guiding Bolt. The number of free casts
 * equals the character's Wisdom modifier (minimum 1) for the 2024 (XPHB) and
 * TGTT Zodiac versions, and the proficiency bonus for the 2014 (TCE) version.
 * The uses recharge on a Long Rest.
 *
 * This suite asserts:
 *  - FeatureUsesParser prefers the canonical recovery clause for recharge.
 *  - getFeatureCalculations().guidingBoltFreeUses is edition-correct.
 *  - getFeatureCalculations().noSlotCasts describes the Guiding Bolt cast.
 *  - addFeature creates a Star Map resource with the right max + recharge.
 *  - getNoSlotCastResourcesForSpell resolves the Star Map resource.
 *  - recalculateResourceMaximums tracks Wisdom changes (without clobbering recharge).
 *  - _migrateStarMap fixes legacy saves (recharge short -> long, max clamp).
 *  - A Bard's Bardic Inspiration recharge is NOT clobbered (regression guard).
 */

import "./setup.js";

let CharacterSheetState;
let FeatureUsesParser;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	FeatureUsesParser = globalThis.FeatureUsesParser;
});

// Full XPHB Star Map text — note the recovery clause ("regain all expended
// uses when you finish a Long Rest") precedes the replacement-ceremony clause
// ("performed during a Short Rest or Long Rest"), which previously mis-set the
// recharge to "short".
const STAR_MAP_XPHB_TEXT = "While holding the map, you have the Guidance and Guiding Bolt spells prepared, and you can cast Guiding Bolt without expending a spell slot. You can cast it in that way a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest. If you lose the map, you can perform a 1-hour ceremony to magically create a replacement. This ceremony can be performed during a Short Rest or Long Rest, and it destroys the previous map.";

function makeZodiacDruid (level = 3, wisBase = 16) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: level >= 3
			? {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"}
			: undefined,
	});
	state.setAbilityBase("wis", wisBase);
	return state;
}

describe("Star Map — parser recharge resolution", () => {
	it("parses XPHB Star Map as Wis-mod uses recharging on a Long Rest", () => {
		const getAbilityMod = () => 3; // WIS 16 -> +3
		const getProfBonus = () => 2;
		const parsed = FeatureUsesParser.parseUses(STAR_MAP_XPHB_TEXT, getAbilityMod, getProfBonus);
		expect(parsed).not.toBeNull();
		expect(parsed.max).toBe(3);
		expect(parsed.recharge).toBe("long"); // not "short", despite the ceremony clause
	});

	it("clamps Wis-mod uses to a minimum of 1", () => {
		const getAbilityMod = () => -1; // dumped WIS
		const parsed = FeatureUsesParser.parseUses(STAR_MAP_XPHB_TEXT, getAbilityMod, () => 2);
		expect(parsed.max).toBe(1);
		expect(parsed.recharge).toBe("long");
	});

	it("still honours an explicit recovery clause that names a Short Rest", () => {
		const text = "You can use this feature a number of times equal to your Wisdom modifier, and you regain all expended uses when you finish a Short Rest.";
		const parsed = FeatureUsesParser.parseUses(text, () => 3, () => 2);
		expect(parsed.recharge).toBe("short");
	});
});

describe("Star Map — getFeatureCalculations", () => {
	it("TGTT Zodiac: guidingBoltFreeUses == max(1, wisMod)", () => {
		const state = makeZodiacDruid(3, 16); // +3
		const calc = state.getFeatureCalculations();
		expect(calc.hasStarMap).toBe(true);
		expect(calc.guidingBoltFreeUses).toBe(3);
	});

	it("XPHB official Stars: guidingBoltFreeUses == max(1, wisMod)", () => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Druid",
			source: "XPHB",
			level: 3,
			subclass: {name: "Circle of the Stars", shortName: "Stars", source: "XPHB"},
		});
		state.setAbilityBase("wis", 18); // +4
		const calc = state.getFeatureCalculations();
		expect(calc.guidingBoltFreeUses).toBe(4);
	});

	it("TCE official Stars: guidingBoltFreeUses == proficiency bonus (edition-correct)", () => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 3,
			subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
		});
		state.setAbilityBase("wis", 18); // +4, but TCE uses prof
		const calc = state.getFeatureCalculations();
		// Druid 3 -> proficiency bonus +2
		expect(calc.guidingBoltFreeUses).toBe(2);
	});

	it("emits a data-driven noSlotCasts descriptor for Guiding Bolt", () => {
		const state = makeZodiacDruid(3, 16);
		const calc = state.getFeatureCalculations();
		expect(Array.isArray(calc.noSlotCasts)).toBe(true);
		const desc = calc.noSlotCasts.find(d => d.spell === "Guiding Bolt");
		expect(desc).toBeDefined();
		expect(desc.resourceName).toBe("Star Map");
		expect(desc.castLevel).toBe(1);
		expect(desc.sources).toEqual(expect.arrayContaining(["XPHB", "PHB"]));
	});
});

describe("Star Map — resource creation and Wisdom tracking", () => {
	function addStarMapFeature (state) {
		state.addFeature({
			name: "Star Map",
			source: "XPHB",
			className: "Druid",
			subclassName: "Circle of the Stars",
			level: 3,
			description: STAR_MAP_XPHB_TEXT,
		});
	}

	it("addFeature creates a Star Map resource with Wis-mod max and long recharge", () => {
		const state = makeZodiacDruid(3, 16); // +3
		addStarMapFeature(state);
		const res = state.getResource("Star Map");
		expect(res).not.toBeNull();
		expect(res.max).toBe(3);
		expect(res.recharge).toBe("long");
	});

	it("recalculateResourceMaximums raises Star Map max when Wisdom increases", () => {
		const state = makeZodiacDruid(3, 16); // +3
		addStarMapFeature(state);
		expect(state.getResource("Star Map").max).toBe(3);

		state.setAbilityBase("wis", 20); // +5
		state.recalculateResourceMaximums();
		expect(state.getResource("Star Map").max).toBe(5);
	});

	it("getNoSlotCastResourcesForSpell resolves the Star Map resource for Guiding Bolt", () => {
		const state = makeZodiacDruid(3, 16); // +3
		addStarMapFeature(state);
		const options = state.getNoSlotCastResourcesForSpell({name: "Guiding Bolt", source: "XPHB", level: 1});
		expect(options.length).toBe(1);
		expect(options[0].name).toBe("Star Map");
		expect(options[0].castLevel).toBe(1);
		expect(options[0].current).toBe(3);
	});

	it("getNoSlotCastResourcesForSpell returns nothing when the resource is exhausted", () => {
		const state = makeZodiacDruid(3, 16);
		addStarMapFeature(state);
		const res = state.getResource("Star Map");
		state.setResourceCurrent(res.id, 0);
		const options = state.getNoSlotCastResourcesForSpell({name: "Guiding Bolt", source: "XPHB", level: 1});
		expect(options.length).toBe(0);
	});

	it("getNoSlotCastResourcesForSpell ignores unrelated spells", () => {
		const state = makeZodiacDruid(3, 16);
		addStarMapFeature(state);
		const options = state.getNoSlotCastResourcesForSpell({name: "Fireball", source: "XPHB", level: 3});
		expect(options.length).toBe(0);
	});
});

describe("Star Map — legacy save migration", () => {
	it("_migrateStarMap converts recharge short -> long and clamps max without resetting current", () => {
		const state = makeZodiacDruid(3, 16); // +3 => max should be 3
		// Simulate a legacy save: feature + resource with the old (buggy) shape.
		const featureId = "legacy_star_map";
		state._data.features.push({
			id: featureId,
			name: "Star Map",
			source: "XPHB",
			uses: {current: 2, max: 4, recharge: "short"},
		});
		state._data.resources.push({
			id: "res_legacy_star_map",
			name: "Star Map",
			featureId,
			current: 2,
			max: 4,
			recharge: "short",
		});

		state._migrateStarMap();

		const res = state.getResource("Star Map");
		expect(res.recharge).toBe("long");
		expect(res.max).toBe(3); // clamped to max(1, wisMod)
		expect(res.current).toBe(2); // preserved, not reset up to max

		const feature = state.getFeatures().find(f => f.id === featureId);
		expect(feature.uses.recharge).toBe("long");
		expect(feature.uses.max).toBe(3);
		expect(feature.uses.current).toBe(2);
	});

	it("_migrateStarMap is a no-op when no Star Map feature is present", () => {
		const state = makeZodiacDruid(3, 16);
		// No Star Map feature added.
		expect(() => state._migrateStarMap()).not.toThrow();
		expect(state.getResource("Star Map")).toBeNull();
	});
});

describe("Recharge regression — Bardic Inspiration is not clobbered", () => {
	it("recalculateResourceMaximums leaves a short-rest resource's recharge intact", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Bard", source: "PHB", level: 5});
		state.setAbilityBase("cha", 16);
		// Font of Inspiration (Bard 5) makes Bardic Inspiration recharge on a short rest.
		state.addResource({name: "Bardic Inspiration", max: 3, current: 3, recharge: "short"});

		state.recalculateResourceMaximums();

		const res = state.getResource("Bardic Inspiration");
		expect(res.recharge).toBe("short");
	});
});
