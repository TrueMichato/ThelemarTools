/**
 * 5ET-843 — `skillToolLanguageProficiencies` (and siblings) on `subclassFeature`.
 *
 * Before this fix, `subclassFeature` could not declare structured
 * `skillProficiencies` / `toolProficiencies` / `languageProficiencies` grants;
 * subclasses that gave extra skills/tools/languages relied on prose parsing or
 * `_copy` workarounds. The char sheet also silently dropped these fields even
 * when present, because `addFeature` never processed them directly
 * (`FeatureEffectRegistry.parseDataEffects` is only invoked for features with
 * `entryData` / `resist` / `immune` / `conditionImmune`).
 *
 * FIX:
 *   1. `_processFeatureProficiencyGrants` on state applies fixed skill/tool/language
 *      grants declared directly on any feature, bookkept via `_trackGrantedProficiency`.
 *   2. `addFeature` calls it alongside `_processFeatureModifiers`.
 *   3. `_buildGrantedRefFeature` (refSubclassFeature resolver) forwards the four
 *      proficiency fields onto the expanded stub so ref-linked subclass features
 *      aren't stripped of their grants.
 *   4. `_migrateSubclassFeatureProficiencyGrants` re-applies grants on load for
 *      saves that pre-date the fix. Idempotent via _trackGrantedProficiency.
 *
 * Coverage below:
 *   - Fixed skillProficiencies on a subclassFeature apply through addFeature.
 *   - Fixed toolProficiencies (object AND bare-string forms) apply.
 *   - Fixed languageProficiencies apply.
 *   - `choose` / `any` meta-keys are skipped (player-choice, no auto-grant).
 *   - Existing higher levels (expertise) are NEVER downgraded to plain proficient.
 *   - Save round-trip: profs persist through toJson → loadFromJson without
 *     double-application (skill level stays 1, not bumped to 2).
 *   - Save migration: a save with the feature but missing grants is repaired on
 *     load; a second load leaves state unchanged (idempotency).
 *   - `skillToolLanguageProficiencies` (any-shaped) does NOT crash addFeature and
 *     does NOT auto-grant (documents player-choice semantics).
 */

import "./setup.js";

// Import the class-utils module first — it registers CharacterSheetClassUtils on
// globalThis, which the state module reaches for during construction. Also import
// the state module so `CharacterSheetState` is available on globalThis for the
// existing global-based tests, though we take it off the module export here.
import "../../../js/charactersheet/charactersheet-class-utils.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

function makeState () {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 14);
	state.setAbilityBase("cha", 14);
	state.addClass({name: "Cleric", source: "TGTT", level: 3});
	return state;
}

/** Synthetic Lust Domain "Bonus Proficiencies" L3 subclass feature. */
function makeLustBonusProficiencies () {
	return {
		name: "Bonus Proficiencies",
		source: "TGTT",
		className: "Cleric",
		classSource: "TGTT",
		subclassShortName: "Lust",
		subclassSource: "TGTT",
		subclassName: "Lust",
		level: 3,
		isSubclassFeature: true,
		skillProficiencies: [{deception: true, persuasion: true}],
	};
}

describe("5ET-843: subclassFeature skill/tool/language proficiency grants", () => {
	it("applies fixed skillProficiencies via addFeature", () => {
		const state = makeState();
		state.addFeature(makeLustBonusProficiencies());
		const skills = state.getSkillProficiencies();
		expect(skills.deception).toBe(1);
		expect(skills.persuasion).toBe(1);
	});

	it("applies fixed toolProficiencies (object form) via addFeature", () => {
		const state = makeState();
		state.addFeature({
			name: "Domain Tools",
			source: "TGTT",
			className: "Cleric",
			subclassShortName: "Lust",
			level: 3,
			isSubclassFeature: true,
			toolProficiencies: [{"lute": true, "poisoner's kit": true}],
		});
		const tools = state.getToolProficiencies().map(t => t.toLowerCase());
		expect(tools).toEqual(expect.arrayContaining(["lute", "poisoner's kit"]));
	});

	it("applies fixed toolProficiencies (bare string form) via addFeature", () => {
		const state = makeState();
		state.addFeature({
			name: "Domain Tool",
			source: "TGTT",
			className: "Cleric",
			subclassShortName: "Lust",
			level: 3,
			isSubclassFeature: true,
			toolProficiencies: ["Disguise Kit"],
		});
		expect(state.getToolProficiencies().map(t => t.toLowerCase()))
			.toEqual(expect.arrayContaining(["disguise kit"]));
	});

	it("applies fixed languageProficiencies via addFeature", () => {
		const state = makeState();
		state.addFeature({
			name: "Divine Tongue",
			source: "TGTT",
			className: "Cleric",
			subclassShortName: "Lust",
			level: 3,
			isSubclassFeature: true,
			languageProficiencies: [{celestial: true, infernal: true}],
		});
		const langs = state.getLanguages().map(l => l.toLowerCase());
		expect(langs).toEqual(expect.arrayContaining(["celestial", "infernal"]));
	});

	it("respects value=2 / 'expertise' as an expertise grant", () => {
		const state = makeState();
		state.addFeature({
			name: "Expert Deceiver",
			source: "TGTT",
			className: "Cleric",
			subclassShortName: "Lust",
			level: 3,
			isSubclassFeature: true,
			skillProficiencies: [{deception: 2}],
		});
		expect(state.getSkillProficiencies().deception).toBe(2);
	});

	it("skips `choose` / `any` / `anyStandard` meta-keys (player-choice)", () => {
		const state = makeState();
		state.addFeature({
			name: "Pick One",
			source: "TGTT",
			className: "Cleric",
			subclassShortName: "Lust",
			level: 3,
			isSubclassFeature: true,
			skillProficiencies: [{choose: {from: ["deception", "persuasion"], count: 1}}],
			toolProficiencies: [{anyArtisansTool: 1}],
			languageProficiencies: [{anyStandard: 1}],
		});
		// Nothing auto-granted from meta-keys.
		expect(state.getSkillProficiencies().deception).toBeFalsy();
		expect(state.getSkillProficiencies().persuasion).toBeFalsy();
		expect(state.getToolProficiencies()).toEqual([]);
	});

	it("never downgrades an existing expertise to plain proficiency", () => {
		const state = makeState();
		// Simulate an earlier grant of expertise from a different source.
		state._data.skillProficiencies.deception = 2;
		state.addFeature(makeLustBonusProficiencies());
		expect(state.getSkillProficiencies().deception).toBe(2);
	});

	it("does not crash on skillToolLanguageProficiencies (player-choice; no auto-grant)", () => {
		const state = makeState();
		expect(() => {
			state.addFeature({
				name: "Trade Slots",
				source: "TGTT",
				className: "Cleric",
				subclassShortName: "Lust",
				level: 3,
				isSubclassFeature: true,
				skillToolLanguageProficiencies: [{anySkill: 1, anyTool: 1, anyLanguage: 1}],
			});
		}).not.toThrow();
		// No fixed grants → no changes to skill/tool/language state.
		expect(Object.keys(state.getSkillProficiencies())).toHaveLength(0);
		expect(state.getToolProficiencies()).toEqual([]);
	});

	it("survives a save round-trip without double-applying", () => {
		const state = makeState();
		state.addFeature(makeLustBonusProficiencies());
		const before = state.getSkillProficiencies().deception;
		expect(before).toBe(1);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		// Same level, not bumped to expertise by re-application.
		expect(reloaded.getSkillProficiencies().deception).toBe(1);
		expect(reloaded.getSkillProficiencies().persuasion).toBe(1);
	});

	it("migrates a pre-fix save: feature stored but grants missing", () => {
		// Build a state, add the feature, then simulate a "pre-fix" save by
		// stripping the grants from _data (as if addFeature never applied them).
		const state = makeState();
		state.addFeature(makeLustBonusProficiencies());
		const json = state.toJson();
		delete json.skillProficiencies.deception;
		delete json.skillProficiencies.persuasion;
		if (json.grantedProficiencies?.skills) {
			delete json.grantedProficiencies.skills.deception;
			delete json.grantedProficiencies.skills.persuasion;
		}

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		expect(reloaded.getSkillProficiencies().deception).toBe(1);
		expect(reloaded.getSkillProficiencies().persuasion).toBe(1);

		// Second load leaves state unchanged (idempotency).
		const json2 = reloaded.toJson();
		const reloaded2 = new CharacterSheetState();
		reloaded2.loadFromJson(json2);
		expect(reloaded2.getSkillProficiencies().deception).toBe(1);
		expect(reloaded2.getSkillProficiencies().persuasion).toBe(1);
	});

	it("applies savingThrowProficiencies (string form)", () => {
		const state = makeState();
		state.addFeature({
			name: "Unearthly Manifestation",
			source: "TGTT",
			className: "Warlock",
			subclassShortName: "The Horror",
			level: 6,
			isSubclassFeature: true,
			savingThrowProficiencies: ["con"],
		});
		expect(state.getSaveProficiencies?.() || state.getSaveProficiencies()).toEqual(expect.arrayContaining(["con"]));
	});

	it("applies savingThrowProficiencies (object form)", () => {
		const state = makeState();
		state.addFeature({
			name: "Con Grant",
			source: "TGTT",
			className: "Warlock",
			subclassShortName: "The Horror",
			level: 6,
			isSubclassFeature: true,
			savingThrowProficiencies: [{con: true}],
		});
		expect(state.getSaveProficiencies?.() || state.getSaveProficiencies()).toEqual(expect.arrayContaining(["con"]));
	});

	it("refSubclassFeature expansion forwards proficiency fields onto the granted stub", () => {
		// End-to-end verification of round-1's _buildGrantedRefFeature patch.
		// A subclass "wrapper" feature carries a refSubclassFeature pointer in
		// entries. The pool provides the canonical target, which carries
		// skillProficiencies. reconcileSubclassFeatureEntries triggers
		// _expandStoredSubclassFeatureRefs → _buildGrantedRefFeature → addFeature,
		// which should apply the canonical's fixed skill grants.
		const state = makeState();

		// Store the wrapper feature with a refSubclassFeature pointer but NO text
		// of its own (so reconcile's hasText check runs the expansion path).
		state.addFeature({
			name: "Lust Domain",
			source: "TGTT",
			className: "Cleric",
			classSource: "TGTT",
			subclassShortName: "Lust",
			subclassSource: "TGTT",
			subclassName: "Lust",
			level: 3,
			isSubclassFeature: true,
			entries: [
				{
					type: "refSubclassFeature",
					subclassFeature: "Bonus Proficiencies|Cleric|TGTT|Lust|TGTT|3",
				},
			],
		});

		// Seed a subclass-feature catalog with the canonical "Bonus Proficiencies"
		// carrying skillProficiencies. This is the shape _copy-based homebrew
		// subclasses land on after their _copy resolves — text and prof fields on
		// a separate canonical feature that the wrapper references.
		state.setClassFeatureCatalog([], [
			{
				name: "Bonus Proficiencies",
				source: "TGTT",
				className: "Cleric",
				classSource: "TGTT",
				subclassShortName: "Lust",
				subclassSource: "TGTT",
				subclassName: "Lust",
				level: 3,
				isSubclassFeature: true,
				skillProficiencies: [{deception: true, persuasion: true}],
				entries: [
					"You gain proficiency in the Deception and Persuasion skills.",
				],
			},
		]);

		// Reconcile pulls the canonical, mints a granted-ref feature (via
		// _buildGrantedRefFeature), and addFeature applies its prof grants.
		state.reconcileSubclassFeatureEntries();

		expect(state.getSkillProficiencies().deception).toBe(1);
		expect(state.getSkillProficiencies().persuasion).toBe(1);
	});

	// -------------------------------------------------------------------------
	// Idempotency / tracker-shape smoke test (round-2 reviewer ask).
	//
	// Mimics loading a "real save" that pre-dates this PR: the feature is
	// present on the character with the new structured `skillProficiencies`
	// field, and the migration re-runs `_processFeatureProficiencyGrants` on
	// every load. Verifies:
	//   1. After addFeature, `grantedProficiencies.skills[<key>]` contains
	//      EXACTLY ONE tracker entry (`"feature:<id>"`), NOT multiple.
	//   2. After a save round-trip, the tracker still has exactly one entry —
	//      the migration ran but bumped nothing (idempotent by construction).
	//   3. After a SECOND reload, still one entry — no accumulation over
	//      arbitrary load counts.
	//   4. A pre-existing higher level (expertise=2 from a different source)
	//      is preserved across all three passes — never downgraded, never
	//      upgraded by the migration.
	// -------------------------------------------------------------------------
	it("tracker-idempotency smoke test: one source entry per grant across many reloads", () => {
		const state = makeState();
		// User has manually earned Expertise in Deception (from, e.g., a Rogue
		// expertise pick on an earlier multiclass level). Simulate that pre-state.
		state._data.skillProficiencies.deception = 2;

		state.addFeature(makeLustBonusProficiencies());

		// #1: exactly one tracker entry per skill after addFeature.
		const featureId = state._data.features.find(f => f.name === "Bonus Proficiencies").id;
		const trackerAfterAdd = state._data.grantedProficiencies?.skills || {};
		expect(trackerAfterAdd.deception).toEqual([`feature:${featureId}`]);
		expect(trackerAfterAdd.persuasion).toEqual([`feature:${featureId}`]);
		// Expertise on Deception preserved; Persuasion is fresh at 1.
		expect(state.getSkillProficiencies().deception).toBe(2);
		expect(state.getSkillProficiencies().persuasion).toBe(1);

		// #2: save round-trip. Migration re-runs on load and should not
		// duplicate the tracker entry.
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		const reloadedFeatureId = reloaded._data.features.find(f => f.name === "Bonus Proficiencies").id;
		const trackerAfterReload = reloaded._data.grantedProficiencies?.skills || {};
		expect(trackerAfterReload.deception).toEqual([`feature:${reloadedFeatureId}`]);
		expect(trackerAfterReload.persuasion).toEqual([`feature:${reloadedFeatureId}`]);
		expect(reloaded.getSkillProficiencies().deception).toBe(2); // expertise preserved
		expect(reloaded.getSkillProficiencies().persuasion).toBe(1);

		// #3: second reload — still no accumulation.
		const reloadedTwice = new CharacterSheetState();
		reloadedTwice.loadFromJson(reloaded.toJson());
		const trackerAfter2 = reloadedTwice._data.grantedProficiencies?.skills || {};
		expect(trackerAfter2.deception).toHaveLength(1);
		expect(trackerAfter2.persuasion).toHaveLength(1);
		expect(reloadedTwice.getSkillProficiencies().deception).toBe(2);
		expect(reloadedTwice.getSkillProficiencies().persuasion).toBe(1);
	});
});
