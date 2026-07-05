/**
 * Character Sheet — Divine Order (2024 / XPHB Cleric L1): read-only state getter.
 *
 * R47 Bug 2. Divine Order is a ONE-TIME level-1 build choice (role: Protector / Thaumaturge). It is
 * NO LONGER a mid-play-changeable Overview field of its own — it is displayed READ-ONLY inside the
 * "Specialties & Feats" surface as its own group (see CharacterSheetOverviewSpecialtiesExclusion).
 * `getDivineOrderState` remains a read-only accessor mirroring `getPrinciplesOfDevotionState`
 * (Cleric-gated, catalog fallback, current-first resolution); these tests pin that getter's
 * behaviour. The set/change/remove state primitives it exercises are still used by the builder and
 * level-up flows (where the one-time choice is actually made), so they remain under test here.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ---- Fixtures: the Divine Order parent + two role options -----------------
const F_DIVINE_ORDER = {
	name: "Divine Order",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: [
		"You have dedicated yourself to one of the following sacred roles of your choice.",
		{
			type: "options",
			count: 1,
			entries: [
				{type: "refClassFeature", classFeature: "Protector|Cleric|XPHB|1|XPHB"},
				{type: "refClassFeature", classFeature: "Thaumaturge|Cleric|XPHB|1|XPHB"},
			],
		},
	],
};
const F_PROTECTOR = {
	name: "Protector",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: ["You gain proficiency with Martial weapons and Heavy armor."],
};
const F_THAUMATURGE = {
	name: "Thaumaturge",
	source: "XPHB",
	level: 1,
	className: "Cleric",
	classSource: "XPHB",
	entries: ["You know one extra cantrip from the Cleric spell list."],
};

function mkClericWithDivineOrder () {
	const state = new CharacterSheetState();
	state.addClass({name: "Cleric", source: "XPHB", level: 1});
	state.setClassFeatureCatalog([F_DIVINE_ORDER, F_PROTECTOR, F_THAUMATURGE], []);
	return state;
}

describe("Divine Order — Overview state", () => {
	it("exposes the parent scope + options + null current when unset", () => {
		const state = mkClericWithDivineOrder();
		const info = state.getDivineOrderState();
		expect(info).toBeTruthy();
		expect(info.parentInfo.parent).toBe("Divine Order");
		expect(info.parentInfo.parentClass).toBe("Cleric");
		expect(info.options.map(o => o.name)).toEqual(expect.arrayContaining(["Protector", "Thaumaturge"]));
		expect(info.current).toBeNull();
	});

	it("returns null for a character with no Divine Order feature", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Cleric", source: "PHB", level: 1});
		state.setClassFeatureCatalog([], []);
		expect(state.getDivineOrderState()).toBeNull();
	});

	it("does NOT leak onto a non-Cleric whose catalog merely contains the feature", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "XPHB", level: 5});
		state.setClassFeatureCatalog([F_DIVINE_ORDER, F_PROTECTOR, F_THAUMATURGE], []);
		expect(state.getClassLevel("Cleric")).toBe(0);
		expect(state.getDivineOrderState()).toBeNull();
	});

	it("surfaces an already-chosen role as current even without a resolvable option group", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Cleric", source: "XPHB", level: 1});
		state.addFeature({
			name: "Divine Order",
			source: "XPHB",
			level: 1,
			className: "Cleric",
			classSource: "XPHB",
			description: "You have dedicated yourself to one of the following sacred roles.",
		});
		state._recordChosenSubfeature({parent: "Divine Order", parentClass: "Cleric", level: 1, name: "Protector", source: "XPHB"});

		const info = state.getDivineOrderState();
		expect(info).toBeTruthy();
		expect(info.current?.name).toBe("Protector");
	});
});

describe("Divine Order — set / change / remove", () => {
	function parentInfo (state) {
		return state.getDivineOrderState().parentInfo;
	}
	function optByName (state, name) {
		return state.getDivineOrderState().options.find(o => o.name === name);
	}

	it("setChosenSubfeature applies the role feature and records it durably", () => {
		const state = mkClericWithDivineOrder();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Protector"));

		expect(state.getFeatures().some(f => f.name === "Protector" && f.isFeatureOption)).toBe(true);
		const recs = state.getChosenSubfeatures();
		expect(recs.some(r => r.parent === "Divine Order" && r.name === "Protector")).toBe(true);
		expect(state.getDivineOrderState().current.name).toBe("Protector");
	});

	it("changeChosenSubfeature swaps the role feature AND the durable record", () => {
		const state = mkClericWithDivineOrder();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Protector"));
		state.changeChosenSubfeature(parentInfo(state), optByName(state, "Thaumaturge"));

		const features = state.getFeatures().map(f => f.name);
		expect(features).toContain("Thaumaturge");
		expect(features).not.toContain("Protector");

		const recNames = state.getChosenSubfeatures().filter(r => r.parent === "Divine Order").map(r => r.name);
		expect(recNames).toEqual(["Thaumaturge"]);
	});

	it("removeChosenSubfeature clears BOTH the stored feature and the chosen record", () => {
		const state = mkClericWithDivineOrder();
		state.setChosenSubfeature(parentInfo(state), optByName(state, "Protector"));
		state.removeChosenSubfeature("Divine Order");

		expect(state.getFeatures().some(f => f.name === "Protector")).toBe(false);
		expect(state.getChosenSubfeatures().some(r => r.parent === "Divine Order")).toBe(false);
		expect(state.getDivineOrderState().current).toBeNull();
	});
});
