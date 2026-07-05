/**
 * Character Sheet — Principles of Devotion (Cleric TGTT): opt-in / changeable / removable.
 *
 * R44 Bug 9. Principles of Devotion used to be a FORCED structured choice with no skip/none
 * and no way to change or clear it. It is now:
 *   - OPT-IN: never auto-seeded as a mandatory pending choice (seedSubclassFeatureChoices skips it).
 *   - Overview-managed via getPrinciplesOfDevotionState + set/change/removeChosenSubfeature.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ---- Fixtures: the Principles parent + two principle options -------------
const F_PRINCIPLES = {
	name: "Principles of Devotion",
	source: "TGTT",
	level: 2,
	className: "Cleric",
	classSource: "TGTT",
	entries: [
		"You pledge to uphold certain standards of behavior in return for a boon.",
		{
			type: "options",
			count: 1,
			entries: [
				{type: "refClassFeature", classFeature: "Chaste|Cleric|TGTT|2"},
				{type: "refClassFeature", classFeature: "Merciful|Cleric|TGTT|2"},
			],
		},
	],
};
const F_CHASTE = {
	name: "Chaste",
	source: "TGTT",
	level: 2,
	className: "Cleric",
	classSource: "TGTT",
	entries: ["You abstain from carnal pleasures. You gain a boon of clarity."],
};
const F_MERCIFUL = {
	name: "Merciful",
	source: "TGTT",
	level: 2,
	className: "Cleric",
	classSource: "TGTT",
	entries: ["You show mercy to the defeated. You gain a boon of grace."],
};

function mkClericWithPrinciples () {
	const state = new CharacterSheetState();
	state.addClass({name: "Cleric", source: "TGTT", level: 2});
	state.setClassFeatureCatalog([F_PRINCIPLES, F_CHASTE, F_MERCIFUL], []);
	return state;
}

describe("Principles of Devotion — opt-in (not force-seeded)", () => {
	it("does NOT auto-seed a pending subfeature choice for Principles of Devotion", () => {
		const state = mkClericWithPrinciples();
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [F_PRINCIPLES]);
		const pending = state.getPendingFeatureChoices?.() || [];
		const principlesChoice = pending.find(c =>
			String(c.featureName || "").toLowerCase() === "principles of devotion");
		expect(principlesChoice).toBeFalsy();
	});

	it("still auto-seeds OTHER structured choices (guard is Principles-specific)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Cleric", source: "XPHB", level: 1});
		const F_DIVINE_ORDER = {
			name: "Divine Order",
			source: "XPHB",
			level: 1,
			className: "Cleric",
			classSource: "XPHB",
			entries: [{type: "options",
				count: 1,
				entries: [
					{type: "refClassFeature", classFeature: "Protector|Cleric|XPHB|1|XPHB"},
					{type: "refClassFeature", classFeature: "Thaumaturge|Cleric|XPHB|1|XPHB"},
				]}],
		};
		state.setClassFeatureCatalog([F_DIVINE_ORDER,
			{name: "Protector", source: "XPHB", level: 1, className: "Cleric", classSource: "XPHB", entries: ["prof"]},
			{name: "Thaumaturge", source: "XPHB", level: 1, className: "Cleric", classSource: "XPHB", entries: ["cantrip"]},
		], []);
		CharacterSheetClassUtils.seedSubclassFeatureChoices(state, [F_DIVINE_ORDER]);
		const pending = state.getPendingFeatureChoices?.() || [];
		expect(pending.find(c => String(c.featureName || "").toLowerCase() === "divine order")).toBeTruthy();
	});
});

describe("Principles of Devotion — Overview state", () => {
	it("exposes the parent scope + options + null current when unset", () => {
		const state = mkClericWithPrinciples();
		const info = state.getPrinciplesOfDevotionState();
		expect(info).toBeTruthy();
		expect(info.parentInfo.parent).toBe("Principles of Devotion");
		expect(info.parentInfo.parentClass).toBe("Cleric");
		expect(info.options.map(o => o.name)).toEqual(expect.arrayContaining(["Chaste", "Merciful"]));
		expect(info.current).toBeNull();
	});

	it("returns null for a non-TGTT cleric / no Principles feature", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Cleric", source: "PHB", level: 2});
		state.setClassFeatureCatalog([], []);
		expect(state.getPrinciplesOfDevotionState()).toBeNull();
	});

	it("(Bug 5a) does NOT leak onto a non-Cleric whose catalog merely contains the feature", () => {
		// A pure Rogue in a TGTT catalog: the cleric Principles feature is present in the
		// loaded class-feature catalog, but the character has no Cleric level, so the
		// Overview manager must stay hidden (getPrinciplesOfDevotionState → null).
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "TGTT", level: 5});
		state.setClassFeatureCatalog([F_PRINCIPLES, F_CHASTE, F_MERCIFUL], []);
		expect(state.getClassLevel("Cleric")).toBe(0);
		expect(state.getPrinciplesOfDevotionState()).toBeNull();
	});

	it("(Bug 5b) surfaces the already-chosen principle as current even without a resolvable option group", () => {
		// A Cleric whose STORED Principles parent feature carries no re-resolvable options
		// (e.g. its option refs point outside the loaded catalog), but a principle was picked
		// at level-up (stored in chosenSubfeatures). The Overview must still show it as current.
		const state = new CharacterSheetState();
		state.addClass({name: "Cleric", source: "TGTT", level: 2});
		state.addFeature({
			name: "Principles of Devotion",
			source: "TGTT",
			level: 2,
			className: "Cleric",
			classSource: "TGTT",
			description: "You pledge to uphold certain standards of behavior.",
		});
		state._recordChosenSubfeature({parent: "Principles of Devotion", parentClass: "Cleric", level: 2, name: "Chaste", source: "TGTT"});

		const info = state.getPrinciplesOfDevotionState();
		expect(info).toBeTruthy();
		expect(info.current?.name).toBe("Chaste");
	});
});

describe("Principles of Devotion — set / change / remove", () => {
	function parentInfo (state) {
		return state.getPrinciplesOfDevotionState().parentInfo;
	}
	function optByName (state, name) {
		return state.getPrinciplesOfDevotionState().options.find(o => o.name === name);
	}

	it("setChosenSubfeature applies the principle feature and records it durably", () => {
		const state = mkClericWithPrinciples();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Chaste"));

		expect(state.getFeatures().some(f => f.name === "Chaste" && f.isFeatureOption)).toBe(true);
		const recs = state.getChosenSubfeatures();
		expect(recs.some(r => r.parent === "Principles of Devotion" && r.name === "Chaste")).toBe(true);
		expect(state.getPrinciplesOfDevotionState().current.name).toBe("Chaste");
	});

	it("changeChosenSubfeature swaps the principle feature AND the durable record", () => {
		const state = mkClericWithPrinciples();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Chaste"));
		state.changeChosenSubfeature(parentInfo(state), optByName(state, "Merciful"));

		const features = state.getFeatures().map(f => f.name);
		expect(features).toContain("Merciful");
		expect(features).not.toContain("Chaste");

		const recNames = state.getChosenSubfeatures().filter(r => r.parent === "Principles of Devotion").map(r => r.name);
		expect(recNames).toEqual(["Merciful"]);
	});

	it("removeChosenSubfeature clears BOTH the stored feature and the chosen record", () => {
		const state = mkClericWithPrinciples();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Chaste"));
		state.removeChosenSubfeature("Principles of Devotion");

		expect(state.getFeatures().some(f => f.name === "Chaste")).toBe(false);
		expect(state.getChosenSubfeatures().some(r => r.parent === "Principles of Devotion")).toBe(false);
		expect(state.getPrinciplesOfDevotionState().current).toBeNull();
	});

	it("remove is idempotent and safe when nothing is chosen", () => {
		const state = mkClericWithPrinciples();
		expect(() => state.removeChosenSubfeature("Principles of Devotion")).not.toThrow();
		expect(state.getChosenSubfeatures()).toHaveLength(0);
	});
});
