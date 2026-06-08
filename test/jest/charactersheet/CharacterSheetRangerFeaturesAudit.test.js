/**
 * Character Sheet — TGTT Ranger feature audit (round 2, Group D)
 *
 * Verifies curated use-tracking overrides for TGTT Ranger features whose limited-use
 * cadence the generic parser reads wrongly (or not at all), the TGTT source gating of
 * those overrides, and that situational/passive reminder features are NOT given a
 * misleading use counter.
 *
 * Assertions check the actual stored feature.uses, not level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function buildTgttRanger (level, {wis = 16} = {}) {
	const s = new CharacterSheetState();
	s.setRace({name: "Human", source: "PHB"});
	s.addClass({name: "Ranger", source: "TGTT", level, subclass: level >= 3 ? {name: "Hunter"} : undefined});
	s.setAbilityBase("str", 14);
	s.setAbilityBase("dex", 16);
	s.setAbilityBase("con", 14);
	s.setAbilityBase("int", 10);
	s.setAbilityBase("wis", wis);
	s.setAbilityBase("cha", 10);
	return s;
}

function findFeature (s, name) {
	return s._data.features.find(f => (f.name || "").toLowerCase() === name.toLowerCase());
}

const DESC = {
	healingSalves: "Once per long rest, spend 1 hour to create a healing salve with uses equal to 1 + your Wisdom modifier. As an action, a use restores 1d4 hit points. Expires after 24 hours.",
	ephemeralInsight: "After observing, reading, or questioning a creature, environment, or process for 1 hour, gain proficiency in one relevant skill or tool until you finish a long rest or use this feature again.",
	poisons: "Once per long rest, after 1 hour of searching with a DC 10 Wisdom (Survival) check, spend 10 minutes to create 3 doses of basic poison; or spend 1 hour to create one dose of antitoxin from the same plants.",
	expertForaging: "Once per long rest, take 1 minute to collect edible plants and grubs equal to your proficiency bonus. A creature can use an action to eat one to restore 1 hit point. They spoil after 1 hour.",
	earToGround: "If you remain still for 1 minute, you gain tremorsense with a range of 30 feet until you move or take an action.",
	uncannyTracker: "When you succeed on a Wisdom (Survival) check to track, gain one additional degree of success.",
};

describe("TGTT Ranger feature audit — curated use-tracking", () => {
	it("Healing Salves tracks the once/long-rest CREATION (max 1), not the 1+WIS doses the parser would read", () => {
		const s = buildTgttRanger(6, {wis: 16}); // WIS +3 → parser would yield 4
		s.addFeature({name: "Healing Salves", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1, description: DESC.healingSalves});
		const f = findFeature(s, "Healing Salves");
		expect(f.uses).toBeTruthy();
		expect(f.uses.max).toBe(1);
		expect(f.uses.recharge).toBe("long");
	});

	it("Ephemeral Insight gets a curated 1/long-rest tracker even though the parser finds no count", () => {
		const s = buildTgttRanger(8);
		s.addFeature({name: "Ephemeral Insight", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 8, description: DESC.ephemeralInsight});
		const f = findFeature(s, "Ephemeral Insight");
		expect(f.uses).toBeTruthy();
		expect(f.uses.max).toBe(1);
		expect(f.uses.recharge).toBe("long");
	});

	it("Poisons and Antidotes is tracked as once/long rest", () => {
		const s = buildTgttRanger(6);
		s.addFeature({name: "Poisons and Antidotes", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1, description: DESC.poisons});
		const f = findFeature(s, "Poisons and Antidotes");
		expect(f.uses).toBeTruthy();
		expect(f.uses.max).toBe(1);
		expect(f.uses.recharge).toBe("long");
	});

	it("source gating: a same-named feature from another source is NOT curated (parser applies instead)", () => {
		const s = buildTgttRanger(6, {wis: 16}); // WIS +3
		s.addFeature({name: "Healing Salves", className: "Druid", classSource: "PHB", source: "PHB", level: 1, description: DESC.healingSalves});
		const f = findFeature(s, "Healing Salves");
		// Non-TGTT → curated map skipped → parser reads "1 + your Wisdom modifier" = 4.
		expect(f.uses).toBeTruthy();
		expect(f.uses.max).toBe(4);
	});

	it("situational/passive reminder features get NO misleading use counter", () => {
		const s = buildTgttRanger(6);
		s.addFeature({name: "Ear to the Ground", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1, description: DESC.earToGround});
		s.addFeature({name: "Uncanny Tracker", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 5, description: DESC.uncannyTracker});
		expect(findFeature(s, "Ear to the Ground").uses).toBeUndefined();
		expect(findFeature(s, "Uncanny Tracker").uses).toBeUndefined();
	});

	it("Expert Foraging tracks the once/long-rest creation (max 1), not the proficiency-bonus yield", () => {
		const s = buildTgttRanger(6); // proficiency bonus 3
		s.addFeature({name: "Expert Foraging", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1, description: DESC.expertForaging});
		const f = findFeature(s, "Expert Foraging");
		expect(f.uses).toBeTruthy();
		expect(f.uses.max).toBe(1);
		expect(f.uses.recharge).toBe("long");
	});

	it("a later resource recalculation does not re-inflate a curated tracker", () => {
		const s = buildTgttRanger(6, {wis: 16}); // WIS +3 → parser would read 4
		s.addFeature({name: "Healing Salves", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1, description: DESC.healingSalves});
		expect(findFeature(s, "Healing Salves").uses.max).toBe(1);

		// Bump WIS, then force a recalculation — curated override must still win.
		s.setAbilityBase("wis", 20); // WIS +5
		s.recalculateResourceMaximums();
		expect(findFeature(s, "Healing Salves").uses.max).toBe(1);
	});
});
