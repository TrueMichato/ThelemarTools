/**
 * Character Sheet — Tempest subclass empty-stub reconciliation (R45 Bug 3).
 *
 * A homebrew subclass defined as a `_copy` of a base subclass whose own level features are
 * themselves feature-level `_copy` stubs (TGTT-2014 "Tempest Domain" → XPHB-attached PHB
 * Tempest) is STORED on the character with EMPTY features — no entries, no description, no
 * uses. With no text nothing surfaces: no use pool, no activation classification, blank panels.
 *
 * `reconcileSubclassFeatureEntries()` backfills those stored stubs from the same flat catalog,
 * which DOES contain the PHB-sourced features WITH real entries (source- and level-lenient),
 * then re-mints uses. detectActivatableFeature classifies live, so once text is present the
 * generic pipelines surface everything.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const DESTRUCTIVE_WRATH_TEXT =
	"You can use your Channel Divinity to wield the power of the storm with unchecked ferocity. When you roll lightning or thunder damage, you can use your Channel Divinity to deal maximum damage, instead of rolling.";
const THUNDERBOLT_STRIKE_TEXT =
	"When you deal lightning damage to a Large or smaller creature, you can also push it up to 10 feet away from you.";
const CHANNEL_DIVINITY_TEXT =
	"You gain the ability to channel divine energy directly from your deity. You can use your Channel Divinity twice between rests. You regain expended uses when you finish a short or long rest.";

/**
 * Build a Cleric 10 whose Tempest (TGTT-2014) subclass features are stored as EMPTY STUBS,
 * exactly as the real saved character has them, plus a catalog carrying the PHB-sourced
 * features WITH entries under a DIFFERENT source and level (mirroring the base-class data).
 */
function mkStubbedTempest () {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 16); // WIS +3
	state.addClass({
		name: "Cleric",
		source: "TGTT-2014",
		level: 10,
		subclass: {name: "Tempest Domain", shortName: "Tempest", source: "TGTT-2014"},
	});

	// --- Empty stubs (what the store path persisted) ---
	const stub = (name, level) => state.addFeature({
		name,
		source: "TGTT-2014",
		level,
		className: "Cleric",
		classSource: "TGTT-2014",
		subclassShortName: "Tempest",
		subclassSource: "TGTT-2014",
		isSubclassFeature: true,
		description: "",
	});
	// Base Channel Divinity so the shared resource exists.
	state.addFeature({
		name: "Channel Divinity",
		source: "PHB",
		level: 2,
		className: "Cleric",
		classSource: "PHB",
		description: CHANNEL_DIVINITY_TEXT,
	});
	stub("Channel Divinity: Destructive Wrath", 3);
	stub("Thunderbolt Strike", 6);

	// --- Catalog with the PHB-sourced canonical features (WITH entries), different source/level ---
	const canonical = [
		{
			name: "Channel Divinity: Destructive Wrath",
			source: "PHB",
			level: 2,
			className: "Cleric",
			classSource: "PHB",
			subclassShortName: "Tempest",
			subclassSource: "PHB",
			isSubclassFeature: true,
			entries: [DESTRUCTIVE_WRATH_TEXT],
		},
		{
			name: "Thunderbolt Strike",
			source: "PHB",
			level: 6,
			className: "Cleric",
			classSource: "PHB",
			subclassShortName: "Tempest",
			subclassSource: "PHB",
			isSubclassFeature: true,
			entries: [THUNDERBOLT_STRIKE_TEXT],
		},
	];
	state.setClassFeatureCatalog([], canonical);
	return state;
}

const findActivatable = (state, name) =>
	(state.getActivatableFeatures?.() || []).find(a => (a.feature?.name || a.name) === name);
const cdCostOf = (af) => af?.activationInfo?.channelDivinityCost ?? af?.channelDivinityCost;

describe("Tempest subclass empty-stub reconciliation (Bug 3)", () => {
	it("stored stubs start blank (no entries / description) before reconcile", () => {
		const state = mkStubbedTempest();
		const dw = state.getFeatures().find(f => f.name === "Channel Divinity: Destructive Wrath");
		expect(dw).toBeTruthy();
		expect(dw.description || "").toBe("");
		expect(Array.isArray(dw.entries) && dw.entries.length).toBeFalsy();
		// With no text, it cannot classify as a Channel-Divinity option.
		expect(findActivatable(state, "Channel Divinity: Destructive Wrath")).toBeFalsy();
	});

	it("backfills entries/description from the source-lenient catalog", () => {
		const state = mkStubbedTempest();
		const repaired = state.reconcileSubclassFeatureEntries();
		expect(repaired).toBeGreaterThanOrEqual(2);

		const dw = state.getFeatures().find(f => f.name === "Channel Divinity: Destructive Wrath");
		expect(dw.description).toMatch(/maximum damage/i);
		const ts = state.getFeatures().find(f => f.name === "Thunderbolt Strike");
		expect(ts.description).toMatch(/push it up to 10 feet/i);
	});

	it("Destructive Wrath surfaces as a spendable Channel-Divinity option after reconcile", () => {
		const state = mkStubbedTempest();
		state.reconcileSubclassFeatureEntries();
		const af = findActivatable(state, "Channel Divinity: Destructive Wrath");
		expect(af).toBeTruthy();
		expect(cdCostOf(af)).toBeGreaterThanOrEqual(1);
	});

	it("Thunderbolt Strike is a passive rider (visible text, correctly NOT activatable)", () => {
		const state = mkStubbedTempest();
		state.reconcileSubclassFeatureEntries();
		expect(findActivatable(state, "Thunderbolt Strike")).toBeFalsy();
	});

	it("is idempotent — a second reconcile repairs nothing", () => {
		const state = mkStubbedTempest();
		expect(state.reconcileSubclassFeatureEntries()).toBeGreaterThanOrEqual(2);
		expect(state.reconcileSubclassFeatureEntries()).toBe(0);
	});
});

const WRATH_OF_THE_STORM_TEXT =
	"Also at 1st level, you can thunderously rebuke attackers. When a creature within 5 feet of you that you can see hits you with an attack, you can use your reaction to deal lightning damage to the creature. The lightning damage equals your Wisdom modifier (minimum of 1). You can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.";

/**
 * (R45 Bug 3, revised) A backfilled subclass wrapper ("Tempest Domain") whose canonical
 * entries END with `refSubclassFeature` refs must GRANT the referenced features
 * ("Wrath of the Storm", "Bonus Proficiencies") as their own stored rows — at the wrapper's
 * level — so their use pools / reaction text surface.
 */
function mkTempestWithRefs () {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 16); // WIS +3
	state.addClass({
		name: "Cleric",
		source: "TGTT-2014",
		level: 10,
		subclass: {name: "Tempest Domain", shortName: "Tempest", source: "TGTT-2014"},
	});

	// Empty "Tempest Domain" wrapper stub stored at the character's real level 3.
	state.addFeature({
		name: "Tempest Domain",
		source: "TGTT-2014",
		level: 3,
		className: "Cleric",
		classSource: "TGTT-2014",
		subclassShortName: "Tempest",
		subclassSource: "TGTT-2014",
		isSubclassFeature: true,
		description: "",
	});

	// Catalog: the canonical Tempest Domain wrapper (entries END with refs), plus the
	// standalone referenced features WITH entries — mirroring the PHB base-class data.
	const canonical = [
		{
			name: "Tempest Domain",
			source: "PHB",
			level: 1,
			className: "Cleric",
			classSource: "PHB",
			subclassShortName: "Tempest",
			subclassSource: "PHB",
			isSubclassFeature: true,
			entries: [
				"You can manipulate the power of storm and thunder.",
				{type: "refSubclassFeature", subclassFeature: "Bonus Proficiencies|Cleric||Tempest||1"},
				{type: "refSubclassFeature", subclassFeature: "Wrath of the Storm|Cleric||Tempest||1"},
			],
		},
		{
			name: "Bonus Proficiencies",
			source: "PHB",
			level: 1,
			className: "Cleric",
			classSource: "PHB",
			subclassShortName: "Tempest",
			subclassSource: "PHB",
			isSubclassFeature: true,
			entries: ["You gain proficiency with martial weapons and heavy armor."],
		},
		{
			name: "Wrath of the Storm",
			source: "PHB",
			level: 1,
			className: "Cleric",
			classSource: "PHB",
			subclassShortName: "Tempest",
			subclassSource: "PHB",
			isSubclassFeature: true,
			entries: [WRATH_OF_THE_STORM_TEXT],
		},
	];
	state.setClassFeatureCatalog([], canonical);
	return state;
}

describe("Tempest refSubclassFeature expansion (Bug 3 revised)", () => {
	it("grants Wrath of the Storm + Bonus Proficiencies referenced by the wrapper's entries", () => {
		const state = mkTempestWithRefs();
		state.reconcileSubclassFeatureEntries();
		const wots = state.getFeatures().find(f => f.name === "Wrath of the Storm");
		const bp = state.getFeatures().find(f => f.name === "Bonus Proficiencies");
		expect(wots).toBeTruthy();
		expect(bp).toBeTruthy();
	});

	it("grants them at the wrapper's stored level, not the ref-encoded base level", () => {
		const state = mkTempestWithRefs();
		state.reconcileSubclassFeatureEntries();
		const wots = state.getFeatures().find(f => f.name === "Wrath of the Storm");
		expect(wots.level).toBe(3);
	});

	it("Wrath of the Storm carries reaction text + a WIS-mod/long-rest use pool (surfaces in Combat)", () => {
		const state = mkTempestWithRefs();
		state.reconcileSubclassFeatureEntries();
		const wots = state.getFeatures().find(f => f.name === "Wrath of the Storm");
		expect(`${wots.description}`).toMatch(/use your reaction/i);
		expect(wots.uses).toBeTruthy();
		expect(wots.uses.max).toBe(state.getAbilityMod("wis"));
		expect(wots.uses.recharge).toBe("long");
	});

	it("is idempotent — a second reconcile grants no duplicates", () => {
		const state = mkTempestWithRefs();
		state.reconcileSubclassFeatureEntries();
		expect(state.getFeatures().filter(f => f.name === "Wrath of the Storm").length).toBe(1);
		expect(state.reconcileSubclassFeatureEntries()).toBe(0);
		expect(state.getFeatures().filter(f => f.name === "Wrath of the Storm").length).toBe(1);
	});
});
