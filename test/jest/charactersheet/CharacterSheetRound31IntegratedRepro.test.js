/**
 * ROUND 31 — INTEGRATED anti-false-green proof.
 *
 * Prior rounds repeatedly reported these TGTT Fighter / Arcane Archer bugs "fixed with
 * green tests" while the user kept seeing them, because the fixes touched helper functions
 * NOT on the real runtime path and never MIGRATED the stale baked save data. This suite
 * LOADS the genuine repro character (D_kaios_Petri_2.json — Fighter 9 TGTT, Arcane Archer,
 * classes[0].subclass = null but AA features embedded) through the production `loadFromJson`
 * path and asserts that EVERY Round 31 bug's real mechanics are corrected SIMULTANEOUSLY on
 * the one save — then proves idempotency (load → toJson → load must not resurrect anything).
 *
 * It also proves the two CROSS-SESSION chains that no single session test covers on its own:
 *   - #14b (S6) surfacing  →  #14 (S5) consume: the catalog-gated combat-method marker repair
 *     re-surfaces the malformed "Doubleshot" feature, and the REAL activation→damage path then
 *     folds the extra weapon die — with NO in-test marker stamping (S5's own test stamps the
 *     markers by hand because it doesn't own surfacing; here S6's repair does it for real).
 *
 * Bug map (Round 31 numbering):
 *   #5/#6/#15  subclass repair → hasArcaneShot / Arcane Shot pool / methods cap
 *   #7/#8      High Ground / Flanking stale attack modifiers stripped
 *   #9         Grasping Arrow stale −10 walk speed stripped
 *   #13        duplicate generic resource rows stripped; Indomitable max 1; reroll +level
 *   #3         combat traditions retained (not clobbered)
 *   #14b/#14   Doubleshot surfaces (catalog repair) and consumes on the next ranged damage roll
 *   #11        quiver auto-place backfill
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures/D_kaios_Petri_2.json");

/** A faithful slice of the TGTT combat-method catalog (what the page feeds the state). */
const COMBAT_METHOD_CATALOG = [
	{name: "Shrug It Off", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Reaction (2 Stamina Points). You defy weakness."]},
	{name: "Warding Wield", source: "TGTT", tradition: "Adamant Mountain", degree: 1, staminaCost: 1, actionType: "bonus action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Bonus Action (1 Stamina Point). Your AC increases by 2."]},
	{name: "Doubleshot", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Bonus Action (1 Stamina Point). The next ranged weapon attack you make uses two missiles instead of one. On a hit, you deal an additional weapon damage die."]},
	{name: "Covering Fire", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Bonus Action (1 Stamina Point)."]},
	{name: "Quickdraw", source: "TGTT", tradition: "Razor's Edge", degree: 1, staminaCost: 1, actionType: "free", _entityType: "combatMethod", optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], entries: ["Free."]},
];

/** Fresh load of the repro through the production migration path. */
function loadRepro () {
	const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
	const state = new CharacterSheetState();
	state.loadFromJson(json);
	return state;
}

const lc = s => String(s || "").toLowerCase();

// =====================================================================================
// MIGRATION-DIRECT mechanics — everything that must be true the instant the save loads.
// =====================================================================================
describe("R31 integrated repro — subclass repair (#5/#6/#15)", () => {
	it("repairs classes[0].subclass = null to the embedded Arcane Archer subclass", () => {
		const state = loadRepro();
		const cls = state.getClasses()[0];
		expect(cls.subclass).toBeTruthy();
		expect(cls.subclass.shortName).toBe("Arcane Archer");
		expect(cls.subclass.source).toBe("TGTT");
		expect(state.getEffectiveSubclassForClass(cls)?.shortName).toBe("Arcane Archer");
	});

	it("hasArcaneShot() is true and the pool size equals the proficiency bonus (L9 → 4)", () => {
		const state = loadRepro();
		expect(state.hasArcaneShot()).toBe(true);
		expect(state.getProficiencyBonus()).toBe(4);
		expect(state.getArcaneShotMax()).toBe(4);
		const synth = (state.getSyntheticCombatResources() || []).find(r => r.kind === "arcaneShot");
		expect(synth).toBeTruthy();
		expect(synth.max).toBe(4);
	});
});

describe("R31 integrated repro — stale passive modifiers stripped (#7/#8/#9)", () => {
	it("High Ground and Flanking no longer contribute to attack modifiers", () => {
		const state = loadRepro();
		const attackNames = state.getModifiersForType("attack").map(m => m.name);
		expect(attackNames).not.toContain("High Ground");
		expect(attackNames).not.toContain("Flanking");
		for (const isMelee of [true, false]) {
			const contribs = state.getAttackModifierContributions({isMelee});
			expect(contribs.some(c => /^(From )?(High Ground|Flanking)$/.test(c.name || ""))).toBe(false);
		}
	});

	it("the legit feat-sourced Archery ranged modifier SURVIVES the strip", () => {
		const state = loadRepro();
		const archery = state.getModifiersForType("attack:ranged").find(m => m.name === "Archery");
		expect(archery).toBeTruthy();
		expect(archery.value).toBe(2);
		expect(archery.sourceType).toBe("feat");
	});

	it("Grasping Arrow no longer drags walk speed down (30, not 20)", () => {
		const state = loadRepro();
		expect(state.getModifiersForType("speed:walk").map(m => m.name)).not.toContain("Grasping Arrow");
		expect(state.getWalkSpeed()).toBe(30);
	});
});

describe("R31 integrated repro — duplicate resource rows + Indomitable (#13)", () => {
	it("strips the duplicate generic Second Wind / Arcane Shot / Indomitable rows", () => {
		const state = loadRepro();
		const names = state.getResources().map(r => lc(r.name));
		expect(names).not.toContain("second wind");
		expect(names).not.toContain("arcane shot");
		expect(names).not.toContain("indomitable");
	});

	it("Indomitable max is 1 (not the stale 2) and the reroll adds the Fighter level (TGTT → 9)", () => {
		const state = loadRepro();
		expect(state.getIndomitableMax()).toBe(1);
		expect(state.getIndomitableRerollBonus()).toBe(9);
	});
});

describe("R31 integrated repro — combat traditions retained (#3)", () => {
	it("keeps all four already-picked traditions (not clobbered), normalized to codes", () => {
		const state = loadRepro();
		expect(state.getCombatTraditions().slice().sort()).toEqual(["AM", "BZ", "RE", "SK"]);
	});
});

// =====================================================================================
// CROSS-SESSION CHAIN — #14b (S6 catalog repair surfaces Doubleshot) → #14 (S5 consume).
// =====================================================================================
describe("R31 integrated repro — Doubleshot surfacing → consume chain (#14b → #14)", () => {
	const PER_DIE = {"1d8": 5, "1d6": 4};

	function mkCombat (state) {
		const captured = [];
		const parseCalls = [];
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._page = {
			showDiceResult: (args) => { captured.push(args); },
			pAnimateDamageDice: () => {},
			_saveCurrentCharacter: () => {},
			_renderCharacter: () => {},
			_features: {_renderResources: () => {}},
		};
		combat._parseDamage = (dice, isCrit) => {
			parseCalls.push({dice, isCrit: !!isCrit});
			const total = PER_DIE[dice] ?? (/^\d+$/.test(String(dice).trim()) ? Number(dice) : 0);
			return {total, sides: 8, rolls: [total]};
		};
		combat._pushDiceGroup = () => {};
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;
		return {combat, captured, parseCalls};
	}

	const mkAutoLongbow = () => ({
		id: "auto_longbow",
		name: "Longbow",
		isMelee: false,
		abilityMod: "dex",
		range: "150/600",
		damage: "1d8",
		damageType: "Piercing",
		properties: ["A|XPHB", "H|XPHB", "2H|XPHB"],
		isAutoGenerated: true,
	});

	function activateMethodAsUi (combat, method) {
		const btn = {
			dataset: {cost: String(method.staminaCost ?? 1)},
			classList: {add () {}, remove () {}},
			closest: () => ({_methodData: method}),
		};
		combat._activateMethodAfterPayment(btn, `${method.name}-1`, method.staminaCost ?? 1, "stamina");
	}

	it("BEFORE the catalog is set, the malformed Doubleshot feature does NOT surface (the bug)", () => {
		const state = loadRepro();
		const ds = state._data.features.find(f => f.name === "Doubleshot");
		expect(ds).toBeTruthy();
		expect(CharacterSheetClassUtils.isCombatMethod(ds)).toBe(false); // malformed: no markers
		expect((state.getCombatMethods() || []).some(m => m.name === "Doubleshot")).toBe(false);
	});

	it("AFTER catalog + _repairCombatMethodMarkers, Doubleshot surfaces with real markers (S6)", () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		state._repairCombatMethodMarkers();

		const ds = state._data.features.find(f => f.name === "Doubleshot");
		expect(CharacterSheetClassUtils.isCombatMethod(ds)).toBe(true);
		expect(ds._entityType).toBe("combatMethod");
		expect(ds.staminaCost).toBe(1);

		const surfaced = (state.getCombatMethods() || []).find(m => m.name === "Doubleshot");
		expect(surfaced).toBeTruthy();
		expect(surfaced.methodCategory).toBe("rangedExtraDie");
	});

	it("the surfaced Doubleshot ARMS via the real activation path and folds the die into the next ranged roll (S5)", async () => {
		const state = loadRepro();
		state.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		state._repairCombatMethodMarkers();
		const method = (state.getCombatMethods() || []).find(m => m.name === "Doubleshot");
		expect(method).toBeTruthy(); // surfaced WITHOUT any in-test stamping

		const {combat, captured, parseCalls} = mkCombat(state);
		combat._cachedAttacks = [mkAutoLongbow()];

		activateMethodAsUi(combat, method);
		expect(combat._pendingDoubleshot).toEqual({name: "Doubleshot"});

		await combat._rollDamage("auto_longbow", false);

		// The longbow die (1d8) is parsed once for the weapon and AGAIN for the rider.
		expect(parseCalls.filter(c => c.dice === "1d8").length).toBe(2);
		expect(captured.length).toBe(1);
		expect(captured[0].subtitle).toMatch(/Doubleshot/i);
		const dexMod = state.getAbilityMod("dex");
		expect(captured[0].total).toBe(5 + 5 + dexMod);
		expect(combat._pendingDoubleshot).toBeNull(); // one-shot
	});
});

// =====================================================================================
// QUIVER (#11) — the repro carries an (unequipped) quiver + dart; equipping backfills.
// =====================================================================================
describe("R31 integrated repro — quiver auto-place backfill (#11)", () => {
	it("equipping the quiver pulls the loose ammo into it", () => {
		const state = loadRepro();
		const quiver = state.getItems().find(i => state.isQuiver(i));
		expect(quiver).toBeTruthy();
		state.setItemEquipped(quiver.id, true);
		state.autoPlaceAmmunitionInQuiver(quiver.id);

		const contents = state.getQuiverAmmunition(quiver.id).map(a => a.name);
		// The Sleep Dart ammo lands in the quiver (arrows + darts coexist — #11).
		expect(contents.some(n => /dart/i.test(n))).toBe(true);
		expect(state.getEquippedQuiver()?.id).toBe(quiver.id);
	});
});

// =====================================================================================
// IDEMPOTENCY — the definitive anti-false-green guard: a round-trip must NOT resurrect
// any stripped modifier / resource, nor undo the subclass repair or tradition retention.
// =====================================================================================
describe("R31 integrated repro — idempotency (load → toJson → load)", () => {
	it("does not resurrect stripped passive modifiers / duplicate resources, and keeps repairs", () => {
		const first = loadRepro();
		const round = new CharacterSheetState();
		round.loadFromJson(first.toJson());

		// subclass repair persists
		expect(round.getClasses()[0].subclass?.shortName).toBe("Arcane Archer");
		expect(round.hasArcaneShot()).toBe(true);
		expect(round.getArcaneShotMax()).toBe(4);

		// stale passive mods stay stripped
		const attackNames = round.getModifiersForType("attack").map(m => m.name);
		expect(attackNames).not.toContain("High Ground");
		expect(attackNames).not.toContain("Flanking");
		expect(round.getWalkSpeed()).toBe(30);

		// duplicate resources stay stripped; Indomitable stays correct
		const resNames = round.getResources().map(r => lc(r.name));
		expect(resNames).not.toContain("second wind");
		expect(resNames).not.toContain("arcane shot");
		expect(resNames).not.toContain("indomitable");
		expect(round.getIndomitableMax()).toBe(1);
		expect(round.getIndomitableRerollBonus()).toBe(9);

		// traditions retained
		expect(round.getCombatTraditions().slice().sort()).toEqual(["AM", "BZ", "RE", "SK"]);

		// the legit Archery survivor is still present (not stripped by the round-trip)
		expect(round.getModifiersForType("attack:ranged").some(m => m.name === "Archery")).toBe(true);
	});

	it("a re-equipped quiver does not DUPLICATE its contained ammo across a round-trip", () => {
		const first = loadRepro();
		const quiver = first.getItems().find(i => first.isQuiver(i));
		first.setItemEquipped(quiver.id, true);
		first.autoPlaceAmmunitionInQuiver(quiver.id);
		const before = first.getQuiverAmmunition(quiver.id).map(a => a.id).sort();

		const round = new CharacterSheetState();
		round.loadFromJson(first.toJson());
		round.autoPlaceAmmunitionInQuiver(quiver.id); // idempotent re-run

		const after = round.getQuiverAmmunition(quiver.id).map(a => a.id).sort();
		expect(after).toEqual(before);
	});
});
