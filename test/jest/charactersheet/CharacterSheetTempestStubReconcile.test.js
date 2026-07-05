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
