/**
 * S-A FOUNDATION — feature granting / classification / surfacing regression tests.
 *
 * These guard the bugs that prior rounds falsely marked green by verifying with synthetic
 * Jest features instead of the real TGTT `_copy` Illrigger. The dominant trap is the
 * dual-brew `_copy` shape: a TGTT subclass's features resolve from the BASE brew
 * (IllriggerRevised), so a granted feature's `source` legitimately differs from the
 * character's stored subclass source (TGTT-IllR). Assertions read real mechanics
 * (granting, classification, computed summaries), never `getTotalLevel()`.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// ---------------------------------------------------------------------------
// TGTT `_copy` Illrigger mock: class sourced TGTT-IllR, but its class/subclass
// FEATURES are sourced from the base IllriggerRevised brew (the `_copy` reality).
// ---------------------------------------------------------------------------

const mockIllriggerTgtt = {
	name: "Illrigger",
	source: "TGTT-IllR",
	classFeatures: [
		"Baleful Interdict|Illrigger|IllriggerRevised|1",
		"Forked Tongue|Illrigger|IllriggerRevised|1",
		"Weapon Mastery|Illrigger|TGTT-IllR|2",
		"Purge Toxins|Illrigger|IllriggerRevised|9",
	],
	subclasses: [
		{
			name: "Hellspeaker",
			shortName: "Hellspeaker",
			source: "TGTT-IllR",
			className: "Illrigger",
			// String refs whose FEATURE source (part[4]) is the base brew, differing from the
			// stored subclass source TGTT-IllR — the exact `_copy` mismatch that caused
			// prior false-greens.
			subclassFeatures: [
				"Moloch's Interdiction|Illrigger|IllriggerRevised|Hellspeaker|IllriggerRevised|7",
				"Intransigent|Illrigger|IllriggerRevised|Hellspeaker|IllriggerRevised|11",
				"Let's Make a Deal|Illrigger|IllriggerRevised|Hellspeaker|IllriggerRevised|11",
				"Quid Pro Quo|Illrigger|IllriggerRevised|Hellspeaker|IllriggerRevised|15",
			],
		},
	],
};

const mockClassFeaturesRegistry = [
	{name: "Baleful Interdict", className: "Illrigger", source: "IllriggerRevised", level: 1, entries: ["Place a seal."]},
	// Forked Tongue: canonical class feature WITH entries (the source of the backfill).
	{name: "Forked Tongue", className: "Illrigger", source: "IllriggerRevised", level: 1, entries: ["You speak Infernal and can swap a language on a long rest."]},
	{name: "Weapon Mastery", className: "Illrigger", source: "TGTT-IllR", level: 2, entries: ["You gain mastery with two kinds of weapons of your choice."]},
	{name: "Purge Toxins", className: "Illrigger", source: "IllriggerRevised", level: 9, entries: ["You are resistant to poison damage. As an action you can spend 2 stamina to end one poison or disease affecting a creature you touch."]},
];

const mockSubclassFeaturesRegistry = [
	{name: "Moloch's Interdiction", className: "Illrigger", subclassShortName: "Hellspeaker", source: "IllriggerRevised", level: 7, entries: ["You learn free interdict boons."]},
	{name: "Intransigent", className: "Illrigger", subclassShortName: "Hellspeaker", source: "IllriggerRevised", level: 11, entries: ["You and chosen creatures are immune to the charmed condition."]},
	{name: "Let's Make a Deal", className: "Illrigger", subclassShortName: "Hellspeaker", source: "IllriggerRevised", level: 11, entries: ["As an action, you can offer a creature a deal: it gains advantage in exchange for a price you name."]},
	{name: "Quid Pro Quo", className: "Illrigger", subclassShortName: "Hellspeaker", source: "IllriggerRevised", level: 15, entries: ["As a bonus action, you can force a creature to make a Charisma saving throw against your Interdict DC."]},
];

const buildOpts = () => ({
	getClassData: (name, source) => (name === "Illrigger" && source === "TGTT-IllR" ? mockIllriggerTgtt : null),
	classFeatures: mockClassFeaturesRegistry,
	subclassFeatures: mockSubclassFeaturesRegistry,
});

function makeIllrigger15 () {
	const state = new CharacterSheetState();
	["str", "dex", "con", "int", "wis", "cha"].forEach(k => state.setAbilityBase(k, k === "cha" ? 18 : 12));
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 15, subclass: {name: "Hellspeaker", source: "TGTT-IllR"}});
	return state;
}

// ---------------------------------------------------------------------------
// #13 / #7 — Foundation: TGTT `_copy` subclass features get granted WITH entries,
// even though their source differs from the stored subclass source.
// ---------------------------------------------------------------------------

describe("#13 reconcile grants TGTT _copy subclass features (source-mismatch safe)", () => {
	test("L7/L11/L15 Hellspeaker features are granted WITH entries despite IllriggerRevised source", () => {
		const state = makeIllrigger15();
		const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());

		expect(result.classesProcessed).toBe(1);
		expect(result.added).toBeGreaterThan(0);

		for (const name of ["Moloch's Interdiction", "Intransigent", "Let's Make a Deal", "Quid Pro Quo"]) {
			const feat = state.getFeatures().find(f => f.name === name);
			expect(feat).toBeDefined();
			expect(feat.isSubclassFeature).toBe(true);
			expect(Array.isArray(feat.entries) && feat.entries.length).toBeTruthy();
		}
	});

	test("the L15 feature respects the character level gate (none above level 15)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 11, subclass: {name: "Hellspeaker", source: "TGTT-IllR"}});
		CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
		const names = state.getFeatures().map(f => f.name);
		expect(names).toContain("Let's Make a Deal"); // L11
		expect(names).not.toContain("Quid Pro Quo"); // L15 — gated out
	});

	test("granted subclass features classify as usable abilities (Let's Make a Deal / Quid Pro Quo)", () => {
		const state = makeIllrigger15();
		CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
		for (const name of ["Let's Make a Deal", "Quid Pro Quo"]) {
			const feat = state.getFeatures().find(f => f.name === name);
			const info = CharacterSheetState.detectActivatableFeature(feat);
			expect(info).not.toBeNull();
			expect(info.isToggle).not.toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// #7 — Entries backfill: a stored feature persisted with description-only (no
// structured entries) gets its canonical entries re-attached on reconcile.
// ---------------------------------------------------------------------------

describe("#7 reconcile backfills canonical entries onto a description-only stored feature", () => {
	function seedStaleForkedTongue (state) {
		// Mirror the real stale save: Forked Tongue stored with HTML description, no entries.
		state.addFeature({
			name: "Forked Tongue",
			source: "IllriggerRevised",
			className: "Illrigger",
			classSource: "IllriggerRevised",
			featureType: "Class",
			level: 1,
			description: "<p>You speak Infernal.</p>",
		});
		// Strip entries to simulate the legacy save (addFeature may not add any, but be sure).
		const stored = state._data.features.find(f => f.name === "Forked Tongue");
		delete stored.entries;
	}

	test("Forked Tongue gains structured entries from the catalog (hover/use text restored)", () => {
		const state = makeIllrigger15();
		seedStaleForkedTongue(state);

		const before = state._data.features.find(f => f.name === "Forked Tongue");
		expect(before.entries).toBeUndefined();

		const result = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
		expect(result.backfilled).toBeGreaterThan(0);

		const after = state._data.features.find(f => f.name === "Forked Tongue");
		expect(Array.isArray(after.entries) && after.entries.length).toBeTruthy();
		expect(after.entries[0]).toMatch(/swap a language/i);
		// Must NOT duplicate the feature.
		expect(state.getFeatures().filter(f => f.name === "Forked Tongue").length).toBe(1);
	});

	test("backfill is idempotent — a second reconcile reports zero backfills", () => {
		const state = makeIllrigger15();
		seedStaleForkedTongue(state);
		CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
		const second = CharacterSheetClassUtils.reconcileClassFeatures(state, buildOpts());
		expect(second.backfilled).toBe(0);
	});

	test("backfill never crosses the class/subclass boundary for same-named features", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 1});
		// A SUBCLASS feature stored without entries must not be backfilled from a CLASS-level
		// canonical of the same name (and vice versa).
		state.addFeature({name: "Forked Tongue", source: "X", className: "Illrigger", featureType: "Class", level: 1, isSubclassFeature: true, subclassName: "Hellspeaker", description: "sub"});
		const stored = state._data.features.find(f => f.name === "Forked Tongue");
		delete stored.entries;

		const canonicalClassFeature = mockClassFeaturesRegistry.find(f => f.name === "Forked Tongue");
		const patched = state.backfillFeatureContentFromCanonical(canonicalClassFeature, {className: "Illrigger", level: 1});
		expect(patched).toBe(false);
		expect(state._data.features.find(f => f.name === "Forked Tongue").entries).toBeUndefined();
	});

	test("backfill never patches a same-named non-class (race/background/custom) feature", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 1});
		// A race/background/custom feature sharing a class feature's name must keep its own
		// (empty) entries — class-feature text must not bleed onto it.
		state.addFeature({name: "Forked Tongue", source: "RaceBrew", featureType: "Race", description: "a serpentfolk trait"});
		const stored = state._data.features.find(f => f.name === "Forked Tongue");
		delete stored.entries;

		const canonicalClassFeature = mockClassFeaturesRegistry.find(f => f.name === "Forked Tongue");
		const patched = state.backfillFeatureContentFromCanonical(canonicalClassFeature, {className: "Illrigger", level: 1});
		expect(patched).toBe(false);
		expect(state._data.features.find(f => f.name === "Forked Tongue").entries).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// #3 — Purge Toxins is an ABILITY, never a toggle active-state.
// ---------------------------------------------------------------------------

describe("#3 Purge Toxins classifies as a limited-use ability (not a toggle state)", () => {
	const purgeToxins = {
		name: "Purge Toxins",
		source: "IllriggerRevised",
		className: "Illrigger",
		featureType: "Class",
		level: 9,
		description: "You are resistant to poison damage. As an action you can spend 2 stamina to end one poison or disease affecting a creature you touch.",
	};

	test("detectActivatableFeature returns a non-toggle, instant ability", () => {
		const info = CharacterSheetState.detectActivatableFeature(purgeToxins);
		expect(info).not.toBeNull();
		expect(info.isToggle).not.toBe(true);
		expect(info.interactionMode === "limited" || info.isInstant === true).toBeTruthy();
	});

	test("it does NOT surface in the interactive Active-States (toggle) list", () => {
		const state = makeIllrigger15();
		state.addFeature(purgeToxins);
		const activatable = state.getActivatableFeatures();
		const entry = activatable.find(a => a.feature?.name === "Purge Toxins");
		// If present at all, it must be an ability entry — never a toggle.
		if (entry) {
			expect(CharacterSheetState.isActivatableAbilityEntry(entry)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// #14 — Quid Pro Quo surfaces its save DC (= Interdict DC) on the feature card.
// ---------------------------------------------------------------------------

describe("#14 Quid Pro Quo effect summary surfaces the Interdict DC", () => {
	const state = new CharacterSheetState();
	const qpq = {name: "Quid Pro Quo", source: "IllriggerRevised", className: "Illrigger", featureType: "Class", level: 15};

	test("returns 'Save DC <n>' when quidProQuoDc is computed", () => {
		const summary = state.getFeatureEffectSummary(qpq, {quidProQuoDc: 18});
		expect(summary).toBe("Save DC 18 (= Interdict DC)");
	});

	test("returns empty string (no 'undefined') when the DC is not computed", () => {
		const summary = state.getFeatureEffectSummary(qpq, {});
		expect(summary).toBe("");
	});
});

// ---------------------------------------------------------------------------
// #1 — Weapon Mastery count includes the classFeature fallback (Illrigger grants
// mastery via a feature, not a table column). QuickBuild delegates to this util.
// ---------------------------------------------------------------------------

describe("#1 getWeaponMasteryCountAtLevel uses the classFeature fallback (no table column)", () => {
	test("Illrigger L2 mastery count parses 'two kinds' from the feature (returns 2, not 0)", () => {
		// Table-only path: Illrigger has no mastery column → 0 (the old QuickBuild result).
		expect(CharacterSheetClassUtils.getWeaponMasteryCountFromTable(mockIllriggerTgtt, 2)).toBe(0);
		// Combined path with the classFeature fallback → 2.
		const count = CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(mockIllriggerTgtt, 2, mockClassFeaturesRegistry);
		expect(count).toBe(2);
	});

	test("level-up gain detection fires at the grant level (L2)", () => {
		const gain = CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(mockIllriggerTgtt, 1, 2, mockClassFeaturesRegistry);
		expect(gain).toEqual({count: 2});
	});
});
