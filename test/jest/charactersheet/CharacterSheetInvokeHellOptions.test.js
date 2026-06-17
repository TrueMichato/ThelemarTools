/**
 * S4 / bug #16 — Nested refSubclassFeature expansion for Invoke Hell options.
 *
 * The Hellspeaker subclass surfaces its "Invoke Hell" OPTIONS (Honey-Sweet Blades,
 * Turncoat) through a TWO-level wrapper chain:
 *
 *   Hellspeaker (wrapper) --refSubclassFeature--> Invoke Hell (subclass)
 *                          --refSubclassFeature--> Honey-Sweet Blades / Turncoat
 *
 * Two data hazards broke this before the fix:
 *   1. The expansion was single-pass, so options nested under a freshly-expanded
 *      wrapper ("Invoke Hell") were never reached.
 *   2. The subclass "Invoke Hell" wrapper collides by name+level with the
 *      class-level "Invoke Hell" feature, so the dedupe guard skipped it — and with
 *      it, its child options.
 *
 * getLevelFeatures must now recurse into each referenced feature's OWN entries (even
 * when the wrapper itself is skipped as a duplicate) so the options always surface,
 * carrying their `consumes: {name: "Invoke Hell"}` activation marker.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const CLASS_DATA = {
	name: "Illrigger",
	source: "TGTT-IllR",
	// Class-level "Invoke Hell" wrapper — collides by name+level with the subclass one.
	classFeatures: ["Invoke Hell|Illrigger|TGTT-IllR|3"],
};

const CLASS_FEATURES = [
	{
		name: "Invoke Hell",
		className: "Illrigger",
		source: "TGTT-IllR",
		level: 3,
		entries: ["Your diabolic connection allows you to channel infernal energy."],
	},
];

const SUBCLASS = {
	name: "Hellspeaker",
	shortName: "Hellspeaker",
	source: "TGTT-IllR",
	className: "Illrigger",
	classSource: "TGTT-IllR",
	subclassFeatures: ["Hellspeaker|Illrigger|TGTT-IllR|Hellspeaker|TGTT-IllR|3"],
};

const SUBCLASS_FEATURES = [
	{
		name: "Hellspeaker",
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		subclassShortName: "Hellspeaker",
		subclassSource: "TGTT-IllR",
		level: 3,
		entries: [
			"Flavor text about Moloch.",
			{type: "refSubclassFeature", subclassFeature: "Invoke Hell|Illrigger|TGTT-IllR|Hellspeaker|TGTT-IllR|3"},
		],
	},
	{
		name: "Invoke Hell",
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		subclassShortName: "Hellspeaker",
		subclassSource: "TGTT-IllR",
		level: 3,
		entries: [
			"You gain the following two Invoke Hell options:",
			{
				type: "entries",
				entries: [
					{type: "refSubclassFeature", subclassFeature: "Honey-Sweet Blades|Illrigger|TGTT-IllR|Hellspeaker|TGTT-IllR|3"},
					{type: "refSubclassFeature", subclassFeature: "Turncoat|Illrigger|TGTT-IllR|Hellspeaker|TGTT-IllR|3"},
				],
			},
		],
	},
	{
		name: "Honey-Sweet Blades",
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		subclassShortName: "Hellspeaker",
		subclassSource: "TGTT-IllR",
		level: 3,
		header: 2,
		consumes: {name: "Invoke Hell"},
		entries: ["When you make a weapon attack against an interdicted creature, you can gain advantage."],
	},
	{
		name: "Turncoat",
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		subclassShortName: "Hellspeaker",
		subclassSource: "TGTT-IllR",
		level: 3,
		header: 2,
		consumes: {name: "Invoke Hell"},
		entries: ["As an action, you wield your manipulative tongue against your enemies."],
	},
];

describe("getLevelFeatures — nested Invoke Hell option expansion (S4 / #16)", () => {
	let features;

	beforeEach(() => {
		features = CharacterSheetClassUtils.getLevelFeatures(CLASS_DATA, 3, SUBCLASS, CLASS_FEATURES, SUBCLASS_FEATURES);
	});

	it("surfaces both Invoke Hell options two wrapper-levels deep", () => {
		const names = features.map(f => f.name);
		expect(names).toContain("Honey-Sweet Blades");
		expect(names).toContain("Turncoat");
	});

	it("preserves the `consumes: {name: 'Invoke Hell'}` marker on each option", () => {
		const honey = features.find(f => f.name === "Honey-Sweet Blades");
		const turncoat = features.find(f => f.name === "Turncoat");
		expect(honey.consumes).toEqual({name: "Invoke Hell"});
		expect(turncoat.consumes).toEqual({name: "Invoke Hell"});
		expect(honey.isSubclassFeature).toBe(true);
	});

	it("does NOT add a duplicate passive 'Invoke Hell' wrapper despite the name collision", () => {
		const invokeHells = features.filter(f => f.name === "Invoke Hell");
		// Only the class-level Invoke Hell stays; the colliding subclass wrapper is skipped,
		// but its child options were still expanded.
		expect(invokeHells).toHaveLength(1);
		expect(invokeHells[0].classSource).toBe("TGTT-IllR");
	});

	it("still works when the colliding class-level wrapper is absent (options surface once)", () => {
		const noCollision = CharacterSheetClassUtils.getLevelFeatures(
			{name: "Illrigger", source: "TGTT-IllR", classFeatures: []},
			3,
			SUBCLASS,
			[],
			SUBCLASS_FEATURES,
		);
		const names = noCollision.map(f => f.name);
		expect(names.filter(n => n === "Honey-Sweet Blades")).toHaveLength(1);
		expect(names.filter(n => n === "Turncoat")).toHaveLength(1);
	});
});
