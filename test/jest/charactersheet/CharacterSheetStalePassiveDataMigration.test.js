/**
 * S2 — Stale passive-data save/load migration (TGTT Fighter bugs #7, #8, #9, #13).
 *
 * The repro character (committed fixture, Fighter 9 TGTT / Arcane Archer) was saved by
 * OLD code that baked passive data the current creation path no longer produces. Because
 * `loadFromJson` restores `namedModifiers` and `resources` verbatim, the leaks survived
 * every round-trip and the player still saw them:
 *
 *   #7 High Ground  — namedModifier {type:'attack', value:2} from a BT optional feature →
 *                     getModifiersForType('attack') / getAttackModifierContributions add
 *                     +2 to EVERY attack.
 *   #8 Flanking     — second {type:'attack', value:2} BT modifier → another +2 to all.
 *   #9 Grasping Arrow — {type:'speed:walk', value:-10} from an AS optional feature →
 *                     permanent -10 walk speed.
 *   #13 Indomitable — a generic _data.resources row {max:2} (plus duplicate Second Wind /
 *                     Arcane Shot rows) SHADOWS the synthetic combat resource, so the combat
 *                     panel shows 2 Indomitable uses at L9 instead of 1. The TGTT reroll
 *                     bonus was also 0 because the 2024 predicate omitted TGTT.
 *
 * FIX: `_migrateStalePassiveData()` runs on load — it strips the BT/AS passive named
 * modifiers (conservatively: never feat/itemUpgrade sourced) and removes the duplicate
 * generic resource rows owned by the synthetic system; `getIndomitableRerollBonus` now
 * treats TGTT as 2024. These tests drive the REAL serialize→load path against the fixture
 * and assert the corrected runtime mechanics + idempotency.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;

const FIXTURE = resolve(__dirname, "fixtures", "s2-fighter9-tgtt-arcane-archer.json");

function rawSave () {
	return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function loadRealChar () {
	const state = new CharacterSheetState();
	state.loadFromJson(rawSave());
	return state;
}

const lc = s => (s || "").toLowerCase();

describe("S2 stale passive-data migration — fixture preconditions (anti-false-green)", () => {
	// Assert the STALE artifacts genuinely exist in the committed save, so the
	// post-load assertions below prove the migration did real work (not a no-op
	// against already-clean data).
	const raw = rawSave();

	test("save bakes the BT/AS passive named modifiers the migration must strip", () => {
		const mods = raw.namedModifiers || [];
		const byName = n => mods.find(m => m.name === n);

		const highGround = byName("High Ground");
		expect(highGround).toMatchObject({type: "attack", value: 2, enabled: true});
		expect(highGround.sourceType).toBeUndefined();

		const flanking = byName("Flanking");
		expect(flanking).toMatchObject({type: "attack", value: 2, enabled: true});
		expect(flanking.sourceType).toBeUndefined();

		const grasping = byName("Grasping Arrow");
		expect(grasping).toMatchObject({type: "speed:walk", value: -10, enabled: true});
		expect(grasping.sourceType).toBeUndefined();

		// And their source features really are BT/AS optional features.
		const feats = raw.features || [];
		const srcOf = id => feats.find(f => f.id === id);
		expect(srcOf(highGround.sourceFeatureId).optionalFeatureTypes).toContain("BT");
		expect(srcOf(flanking.sourceFeatureId).optionalFeatureTypes).toContain("BT");
		expect(srcOf(grasping.sourceFeatureId).optionalFeatureTypes).toContain("AS");
	});

	test("save bakes the duplicate generic Fighter resource rows the migration must remove", () => {
		const names = (raw.resources || []).map(r => lc(r.name));
		expect(names).toContain("second wind");
		expect(names).toContain("arcane shot");
		expect(names).toContain("indomitable");
		// The stale Indomitable row claims max 2 (the wrong, shadowing value at L9).
		expect((raw.resources || []).find(r => lc(r.name) === "indomitable").max).toBe(2);
	});

	test("save preserves a legit feat-sourced attack modifier we must NOT strip", () => {
		const archery = (raw.namedModifiers || []).find(m => m.name === "Archery");
		expect(archery).toMatchObject({type: "attack:ranged", sourceType: "feat"});
	});
});

describe("S2 stale passive-data migration — #7/#8 attack modifiers", () => {
	test("High Ground and Flanking no longer apply to attacks after load", () => {
		const s = loadRealChar();
		const attackModNames = s.getModifiersForType("attack").map(m => m.name);
		expect(attackModNames).not.toContain("High Ground");
		expect(attackModNames).not.toContain("Flanking");
	});

	test("attack contributions carry no +2 from High Ground / Flanking", () => {
		const s = loadRealChar();
		for (const isMelee of [true, false]) {
			const contribs = s.getAttackModifierContributions({isMelee});
			expect(contribs.some(c => c.name === "High Ground")).toBe(false);
			expect(contribs.some(c => c.name === "Flanking")).toBe(false);
			expect(contribs.some(c => /From (High Ground|Flanking)/.test(c.name || ""))).toBe(false);
		}
	});

	test("the legit feat-sourced Archery ranged modifier survives the migration", () => {
		const s = loadRealChar();
		const ranged = s.getModifiersForType("attack:ranged");
		const archery = ranged.find(m => m.name === "Archery");
		expect(archery).toBeTruthy();
		expect(archery.value).toBe(2);
		expect(archery.sourceType).toBe("feat");
	});

	test("conservative: non-BT/AS passive mods and feat mods are preserved", () => {
		const s = loadRealChar();
		const mods = s._data.namedModifiers || [];
		// Warding Wield is a type:'ac' passive modifier (an AC kind in the stale set) but its
		// source feature is NOT a BT/AS optional feature, so the migration must NOT strip it.
		expect(mods.some(m => /^Warding Wield/.test(m.name || "") && m.type === "ac")).toBe(true);
		// Stamina Enthusiast (resource:stamina) — type outside the passive set — survives.
		expect(mods.some(m => m.name === "Stamina Enthusiast")).toBe(true);
		// Feat-sourced mods are never swept (they carry sourceType).
		expect(mods.some(m => m.name === "Archery" && m.sourceType === "feat")).toBe(true);
		expect(mods.some(m => m.name === "Crossbow Expert" && m.sourceType === "feat")).toBe(true);
	});
});

describe("S2 stale passive-data migration — #9 Grasping Arrow walk speed", () => {
	test("Grasping Arrow no longer present in speed:walk modifiers", () => {
		const s = loadRealChar();
		const walkMods = s.getModifiersForType("speed:walk").map(m => m.name);
		expect(walkMods).not.toContain("Grasping Arrow");
	});

	test("walk speed is the normal 30 (no permanent -10 leak)", () => {
		const s = loadRealChar();
		expect(s.getWalkSpeed()).toBe(30);
	});
});

describe("S2 stale passive-data migration — #13 Indomitable / duplicate trackers", () => {
	test("generic Second Wind / Arcane Shot / Indomitable resource rows are removed", () => {
		const s = loadRealChar();
		const names = s.getResources().map(r => lc(r.name));
		expect(names).not.toContain("second wind");
		expect(names).not.toContain("arcane shot");
		expect(names).not.toContain("indomitable");
	});

	test("synthetic Indomitable is the single source of truth with max 1 at L9", () => {
		const s = loadRealChar();
		expect(s.getIndomitableMax()).toBe(1);
		const synthetic = s.getSyntheticCombatResources();
		const indom = synthetic.find(r => r.kind === "indomitable");
		expect(indom).toBeTruthy();
		expect(indom.max).toBe(1);
		// Second Wind surfaces ONLY via the synthetic resource (subclass-independent).
		expect(synthetic.some(r => r.kind === "secondWind")).toBe(true);
	});

	test("once the Arcane Archer subclass is detected, Arcane Shot surfaces ONLY synthetically (no duplicate)", () => {
		// Arcane Shot's synthetic row is gated on `hasArcaneShot()`, which keys off the
		// Fighter subclass shortName — repaired by S1's `_migrateRepairSubclass`. Simulate
		// that repair here so this suite can verify, in isolation, that S2's migration left
		// NO generic duplicate behind and the synthetic pool is the single tracker.
		const s = loadRealChar();
		const fighter = s._data.classes.find(c => c.name === "Fighter");
		fighter.subclass = {...(fighter.subclass || {}), shortName: "Arcane Archer", name: "Arcane Archer"};
		expect(s.hasArcaneShot()).toBe(true);
		expect(s.getResources().some(r => lc(r.name) === "arcane shot")).toBe(false);
		expect(s.getSyntheticCombatResources().some(r => r.kind === "arcaneShot")).toBe(true);
	});

	test("Indomitable reroll adds the Fighter level (TGTT treated as 2024)", () => {
		const s = loadRealChar();
		expect(s.getIndomitableRerollBonus()).toBe(9);
	});
});

describe("S2 stale passive-data migration — idempotency", () => {
	test("load → toJson → loadFromJson does NOT resurrect stripped modifiers/resources", () => {
		const first = loadRealChar();
		const round = new CharacterSheetState();
		round.loadFromJson(first.toJson());

		const attackModNames = round.getModifiersForType("attack").map(m => m.name);
		expect(attackModNames).not.toContain("High Ground");
		expect(attackModNames).not.toContain("Flanking");

		expect(round.getModifiersForType("speed:walk").map(m => m.name)).not.toContain("Grasping Arrow");
		expect(round.getWalkSpeed()).toBe(30);

		const resNames = round.getResources().map(r => lc(r.name));
		expect(resNames).not.toContain("second wind");
		expect(resNames).not.toContain("arcane shot");
		expect(resNames).not.toContain("indomitable");

		expect(round.getIndomitableMax()).toBe(1);
		expect(round.getIndomitableRerollBonus()).toBe(9);

		// The preserved feat modifier still survives a second round-trip.
		expect(round.getModifiersForType("attack:ranged").some(m => m.name === "Archery")).toBe(true);
	});
});

describe("S2 creation guard — addFeature never mints a duplicate synthetic-tracked row", () => {
	test("isSyntheticTrackedResourceFeature identifies the three Fighter pools", () => {
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("Second Wind")).toBe(true);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("arcane shot")).toBe(true);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("INDOMITABLE")).toBe(true);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("Action Surge")).toBe(false);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature(null)).toBe(false);
	});

	test("adding an Indomitable feature with parsed uses creates no generic resource row", () => {
		const s = new CharacterSheetState();
		s.addFeature({
			name: "Indomitable",
			source: "XPHB",
			featureType: "Class",
			description: "You can reroll a saving throw that you fail. You can use this feature twice.",
		});
		expect(s.getResources().some(r => lc(r.name) === "indomitable")).toBe(false);
	});
});

/**
 * CS-BUG-112 — the classic (2014) PHB Fighter models each use-count upgrade as a
 * SEPARATE feature with an `(N uses)` suffix:
 *
 *   data/class/class-fighter.json  "Indomitable (two uses)"    L13
 *                                  "Indomitable (three uses)"  L17
 *                                  "Action Surge (two uses)"   L17
 *
 * `isSyntheticTrackedResourceFeature` matched by EXACT name against
 * {second wind, arcane shot, indomitable}, so those upgrade rows slipped past every
 * gate the predicate feeds — both creation guards, both `_migrateStalePassiveData`
 * arms, and the render gate at charactersheet-combat.js:6697. The player saw TWO
 * Indomitable trackers: the correct synthetic pool plus a stale generic pool literally
 * named "Indomitable (two uses)". XPHB repeats the plain name at 9/13/17, which is why
 * no XPHB/TGTT-chassis character ever reproduced it.
 *
 * The population is provably three (grep -rhoE '"name": "[^"]*\([a-z0-9]+ uses?\)"'
 * over data/ + homebrew/), and `Action Surge (two uses)` canonicalises to "action
 * surge" — deliberately NOT synthetically tracked — so it is the control below.
 *
 * The descriptions used here are the REAL entries text. This matters: a paraphrase
 * does not reach the uses parser, and an earlier version of this probe was green on
 * BOTH trees because of it.
 */
describe("CS-BUG-112 — classic-PHB '(N uses)' upgrades are the same synthetic pool", () => {
	// Real `entries` text from data/class/class-fighter.json (PHB).
	const PHB_FIGHTER_FEATURES = [
		["Second Wind", 1, "You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level. Once you use this feature, you must finish a short or long rest before you can use it again."],
		["Action Surge", 2, "Starting at 2nd level, you can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action. Once you use this feature, you must finish a short or long rest before you can use it again. Starting at 17th level, you can use it twice before a rest, but only once on the same turn."],
		["Indomitable", 9, "Beginning at 9th level, you can reroll a saving throw that you fail. If you do so, you must use the new roll, and you can't use this feature again until you finish a long rest. You can use this feature twice between long rests starting at 13th level and three times between long rests starting at 17th level."],
		["Indomitable (two uses)", 13, "At 13th level, you can use Indomitable twice between long rests."],
		["Action Surge (two uses)", 17, "At 17th level, you can use Action Surge twice before a rest, but only once on the same turn."],
		["Indomitable (three uses)", 17, "At 17th level, you can use Indomitable three times between long rests."],
	];

	function phbFighter17 () {
		const s = new CharacterSheetState();
		s.addClass({name: "Fighter", source: "PHB", level: 17});
		PHB_FIGHTER_FEATURES.forEach(([name, level, description]) => s.addFeature({name, source: "PHB", featureType: "Class", level, description}));
		return s;
	}

	/**
	 * The player-facing pool list is the UNION of the two panels: the Overview
	 * Resources panel renders `getGenericPoolResources()`, the Combat panel renders
	 * `getSyntheticCombatResources()`. Asserting either alone misses the duplicate,
	 * because the two rows live one in each.
	 */
	function renderedPoolNames (s) {
		return [...s.getGenericPoolResources(), ...s.getSyntheticCombatResources()].map(r => lc(r.name));
	}

	test("PREMISE: the fixture really does carry the upgrade features with parsed uses", () => {
		const byName = new Map(phbFighter17().getFeatures().map(f => [f.name, f]));
		expect(byName.has("Indomitable (two uses)")).toBe(true);
		// If this ever parses to null the probe stops discriminating — an earlier
		// paraphrased description did exactly that and was green on both trees.
		expect(byName.get("Indomitable (two uses)").uses?.max).toBe(2);
	});

	test("the canonicaliser folds the upgrade suffix, and ONLY for tracked pools", () => {
		expect(CharacterSheetState.canonicalSyntheticTrackedResourceName("Indomitable (two uses)")).toBe("indomitable");
		expect(CharacterSheetState.canonicalSyntheticTrackedResourceName("Indomitable (three uses)")).toBe("indomitable");
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("Indomitable (two uses)")).toBe(true);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("Indomitable (three uses)")).toBe(true);
		// CONTROL: Action Surge is not synthetically tracked, so neither is its upgrade.
		// This bounds the blast radius to exactly two features.
		expect(CharacterSheetState.canonicalSyntheticTrackedResourceName("Action Surge (two uses)")).toBe(null);
		expect(CharacterSheetState.isSyntheticTrackedResourceFeature("Action Surge (two uses)")).toBe(false);
	});

	test("CREATION: a PHB Fighter 17 renders exactly ONE Indomitable pool", () => {
		const names = renderedPoolNames(phbFighter17());
		expect(names.filter(n => n.includes("indomitable"))).toEqual(["indomitable"]);
		expect(names).not.toContain("indomitable (two uses)");
	});

	test("CREATION: the surviving Indomitable pool is the synthetic 3/3, not the stale 2/2", () => {
		const pool = phbFighter17().getSyntheticCombatResources().find(r => lc(r.name) === "indomitable");
		expect(pool).toBeDefined();
		expect(pool.max).toBe(3);
		expect(pool.synthetic).toBe(true);
	});

	test("CONTROL: the Action Surge generic row is left exactly as it was", () => {
		const generic = phbFighter17().getGenericPoolResources().map(r => lc(r.name));
		expect(generic).toContain("action surge");
		expect(generic).not.toContain("action surge (two uses)");
	});

	test("LOAD: a save baked by old code carrying a stale 'Indomitable (two uses)' row is healed", () => {
		// Model a save written BEFORE the fix: the generic row is present in the JSON,
		// exactly as it appears in the failing E2E export artifact for the classic-PHB
		// Shadow Knight Fighter (rawResources: … Indomitable (two uses) 2/2 …).
		const json = phbFighter17().toJson();
		json.resources.push({id: "stale-indom", name: "Indomitable (two uses)", current: 2, max: 2, recharge: "long"});

		const round = new CharacterSheetState();
		round.loadFromJson(json);

		expect(renderedPoolNames(round).filter(n => n.includes("indomitable"))).toEqual(["indomitable"]);
	});

	test("LOAD: the upgrade feature's baked uses are stripped so no second counter renders", () => {
		const json = phbFighter17().toJson();
		const round = new CharacterSheetState();
		round.loadFromJson(json);

		const upgrade = round.getFeatures().find(f => f.name === "Indomitable (two uses)");
		expect(upgrade).toBeDefined();
		expect(upgrade.uses).toBeFalsy();
	});
});
