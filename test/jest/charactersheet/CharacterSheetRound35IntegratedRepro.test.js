/**
 * ROUND 35 — INTEGRATED repro (orchestrator cross-cut).
 *
 * Two isolated R35 fixes were authored separately and cherry-picked together onto
 * `character-sheet-wip`:
 *   #1/#2  Combat-methods PICKER. (#1) combat-method ATTRIBUTION now persists:
 *          `_addCombatMethod` stores the structured markers
 *          (`_entityType/tradition/degree/staminaCost/actionType`) and
 *          `_repairCombatMethodMarkers` backfills any MISSING markers on
 *          already-recognised methods instead of skipping them — so the four
 *          tradition-less CTM methods in the real save (Lean Into It, Blindshot,
 *          Missile Volley, Countershot) regain their tradition on load. (#2) the
 *          combat-tab tradition picker is ADDITIVE — a Fighter subclass's pool/
 *          grants no longer REPLACE the base "all traditions" list, so an Arcane
 *          Archer can still pick AM/SK.
 *   #3     Per-weapon ACTIVE AMMUNITION SELECTOR. The selected ammo's bonus rides
 *          BOTH the attack roll and the damage roll, is consumed EXACTLY ONCE on
 *          the damage roll (never on attack), and reverts to "Regular" on
 *          depletion. The selection persists across save/reload.
 *
 * This suite proves the two independent fixes COEXIST under a SINGLE real
 * `loadFromJson` of the user's actual save, drive their respective state/render
 * paths on the SAME combat instance, and survive a serialize→load round-trip
 * (idempotency). It is the orchestrator's guarantee that the cherry-pick landed
 * both fixes without regressing either.
 *
 * RED proof (each fix independently):
 *   - strip the structured-marker persist from `_addCombatMethod` OR restore the
 *     `_repairCombatMethodMarkers` blanket-skip → the #1 attribution tests fail;
 *   - restore `if (pool.replacesBase) continue;` in `_getTraditionSelectionModel`
 *     → the #2 additive-tradition test fails;
 *   - drop the ammo attack/damage fold-in or the damage-roll consume → the #3
 *     ammo tests fail.
 * With all fixes in place every test below is GREEN.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const ClassUtils = globalThis.CharacterSheetClassUtils;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "D_kaios_Petri_2_v2.json");

// Stable ids from the real save.
const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	rapier: "3afea0fa-6c63-49e4-b4e9-5187154632d5",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
};

// Faithful subset of the real TGTT combat-method catalog (verbatim tradition / degree /
// staminaCost / actionType from homebrew/TravelersGuidetoThelemar.json .combatMethod),
// tagged with `_entityType` exactly as the page does in setCombatMethodCatalog.
const RAW_CATALOG = [
	{name: "Lean Into It", source: "TGTT", tradition: "Adamant Mountain", degree: 1, staminaCost: 2, actionType: "action"},
	{name: "Shrug It Off", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Warding Wield", source: "TGTT", tradition: "Adamant Mountain", degree: 2, staminaCost: 1, actionType: "bonus action"},
	{name: "Covering Fire", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "action"},
	{name: "Doubleshot", source: "TGTT", tradition: "Biting Zephyr", degree: 1, staminaCost: 1, actionType: "bonus action"},
	{name: "Countershot", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 1, actionType: "reaction"},
	{name: "Quickdraw", source: "TGTT", tradition: "Biting Zephyr", degree: 2, staminaCost: 2, actionType: "reaction"},
	{name: "Blindshot", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 1, actionType: "bonus action"},
	{name: "Missile Volley", source: "TGTT", tradition: "Biting Zephyr", degree: 3, staminaCost: 2, actionType: "action"},
];
const CATALOG = RAW_CATALOG.map(m => ({...m, _entityType: "combatMethod"}));

// A real-shaped combat-method NOT already known by the fixture (Unerring Hawk → UH).
const NEW_METHOD = {
	name: "Singular Focus",
	source: "TGTT",
	_entityType: "combatMethod",
	tradition: "Unerring Hawk",
	degree: 3,
	staminaCost: 2,
	actionType: "bonus action",
	featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
	entries: ["Choose a creature you can see; you gain advantage on attacks against it."],
};

// The four methods stored RECOGNISED (CTM oft + _entityType) but with NO tradition.
const UNATTRIBUTED = [
	{name: "Lean Into It", trad: "AM"},
	{name: "Blindshot", trad: "BZ"},
	{name: "Missile Volley", trad: "BZ"},
	{name: "Countershot", trad: "BZ"},
];

function readFixture () {
	return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

/** Mirror production load order: load -> set catalog -> repair -> reconcile. */
function loadState (json) {
	const state = new CharacterSheetState();
	state.loadFromJson(json || readFixture());
	state.setCombatMethodCatalog(CATALOG);
	state._repairCombatMethodMarkers();
	state.reconcileGrantedCombatMethods();
	return state;
}

const findFeature = (state, name) => (state._data.features || []).find(f => f.name === name);
const hasMethod = (state, name) => state.getCombatMethods().some(m => m.name === name);

/**
 * One combat controller bound to the real state, wired for BOTH surfaces:
 *  - `_page.saveCharacter` captures a deep `state.toJson()` snapshot (persistence),
 *  - `_page._inventory.render` is counted (the ammo damage-roll re-render),
 *  - `_page.getClasses` returns the fixture's Fighter/Arcane Archer WITH the CTM
 *    progression so `_getTraditionSelectionModel` resolves the base list.
 */
function makeCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	const saves = [];
	const invRenders = [];
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._battleTacticToggles = {};
	combat.renderAttacks = () => {};
	combat.renderCombatQuiver = () => {};
	combat._page = {
		saveCharacter: jest.fn(() => { saves.push(JSON.parse(JSON.stringify(state.toJson()))); }),
		_inventory: {render: jest.fn(() => { invRenders.push(1); })},
		getOptionalFeatures: () => [],
		getClassFeatures: () => [],
		getClasses: () => [{
			name: "Fighter",
			source: "TGTT",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
			optionalfeatureProgression: [{name: "Combat Methods", featureType: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"], progression: {"1": 1}}],
		}],
	};
	combat._saves = saves;
	combat._invRenders = invRenders;
	return combat;
}

/** Attack the way `renderAttacks` builds it (sourceItem = flat weapon). */
function mkWeaponAttack (state, weaponId, over = {}) {
	const weapon = state.getItems().find(i => i.id === weaponId);
	return {
		id: `auto_${weaponId}`,
		name: weapon?.name,
		sourceItem: weapon,
		isSpell: false,
		isMelee: false,
		damage: "1d8",
		damageType: "piercing",
		abilityMod: "dex",
		...over,
	};
}

/** Inject a synthetic arrow into inventory AND the equipped quiver. */
function addQuiverArrow (state, {id, name, quantity = 5, bonusWeapon, entries}) {
	const item = {name, type: "gear", baseItem: "arrow|xphb", arrow: true, weapon: false, rarity: "uncommon"};
	if (bonusWeapon != null) item.bonusWeapon = bonusWeapon;
	if (entries) item.entries = entries;
	state._data.inventory.push({id, item, quantity, equipped: false, attuned: false});
	const quiver = state._data.inventory.find(i => i.id === ID.quiver);
	quiver.item.containedItems = quiver.item.containedItems || [];
	quiver.item.containedItems.push(id);
}

function wireAttack (combat, state) {
	const captured = {};
	combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
	combat._page.rollD20 = () => ({roll: 10, mode: "normal"});
	combat._page.getModeLabel = () => "";
	combat._page.formatD20Breakdown = () => "";
	combat._page.pAnimateD20 = () => {};
	combat._page.showDiceResult = (o) => { Object.assign(captured, o); return {}; };
	combat._page._offerGuidedStrikePostAttack = () => {};
	combat._renderSneakAttackToggle = () => {};
	combat._runPostAttackHooks = async () => {};
	combat.__captured = captured;
	return captured;
}

function wireDamage (combat, state) {
	const captured = {};
	combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
	combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
	combat._promptUseCombatMethod = async () => null;
	combat._promptApplyMethodEffect = async () => false;
	combat._page.pAnimateDamageDice = async () => {};
	combat._page.showDiceResult = (o) => { Object.assign(captured, o); return {}; };
	combat.__captured = captured;
	return captured;
}

// ===========================================================================
// Preconditions — one real save exercises all three surfaces
// ===========================================================================

describe("R35 integrated — preconditions (anti-false-green)", () => {
	test("raw fixture: the four CTM methods load recognised but tradition-less", () => {
		const state = new CharacterSheetState();
		state.loadFromJson(readFixture());
		for (const {name} of UNATTRIBUTED) {
			const f = findFeature(state, name);
			expect(f).toBeDefined();
			expect(ClassUtils.isCombatMethod(f)).toBe(true);
			expect(ClassUtils.getMethodTraditionCode(f)).toBeNull();
		}
		expect(hasMethod(loadState(readFixture()), NEW_METHOD.name)).toBe(false);
	});

	test("fixture: an equipped quiver holds ammo usable by the ranged Longbow", () => {
		const state = loadState();
		expect(state.getEquippedQuiver()?.id).toBe(ID.quiver);
		expect((state.getQuiverAmmunitionForWeapon?.(ID.longbow) || []).length).toBeGreaterThan(0);
		// Default ammo selection is Regular.
		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
	});
});

// ===========================================================================
// #1 — combat-method attribution persists (repair backfill + add)
// ===========================================================================

describe("R35 integrated — #1 attribution backfills on load and persists on add", () => {
	test("the four tradition-less methods resolve their catalog tradition after load", () => {
		const state = loadState();
		for (const {name, trad} of UNATTRIBUTED) {
			expect(ClassUtils.getMethodTraditionCode(findFeature(state, name))).toBe(trad);
		}
		// Every surfaced method ends up attributed.
		expect(state.getCombatMethods().every(m => m.tradition && m.tradition !== "Unknown")).toBe(true);
	});

	test("an already-attributed method's tradition is never overwritten", () => {
		const state = loadState();
		expect(ClassUtils.getMethodTraditionCode(findFeature(state, "Warding Wield"))).toBe("AM");
		expect(ClassUtils.getMethodTraditionCode(findFeature(state, "Quickdraw"))).toBe("BZ");
	});

	test("a learned method via _addCombatMethod keeps its tradition through toJson→reload", () => {
		const state = loadState();
		const combat = makeCombat(state);
		combat._addCombatMethod(NEW_METHOD);
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);

		const stored = findFeature(state, NEW_METHOD.name);
		expect(stored._entityType).toBe("combatMethod");
		expect(ClassUtils.getMethodTraditionCode(stored)).toBe("UH");

		// Survives a bare reload WITHOUT the catalog re-attributing it.
		const captured = combat._saves[combat._saves.length - 1];
		const bare = new CharacterSheetState();
		bare.loadFromJson(captured);
		expect(ClassUtils.getMethodTraditionCode(bare._data.features.find(f => f.name === NEW_METHOD.name))).toBe("UH");
	});
});

// ===========================================================================
// #2 — combat-tab tradition picker is additive for Fighter subclasses
// ===========================================================================

describe("R35 integrated — #2 additive Fighter subclass tradition picker", () => {
	test("Arcane Archer can choose AM/SK alongside the BZ/RE/UW/UH pool", () => {
		const state = loadState();
		const combat = makeCombat(state);
		const model = combat._getTraditionSelectionModel(["BZ", "RE", "AM", "SK"]);
		expect(model.choosableCodes).toEqual(expect.arrayContaining(["BZ", "RE", "UW", "UH", "AM", "SK"]));
		// The full base list (every tradition) is choosable, not just the 4-code pool.
		expect(model.choosableCodes.length).toBe(ClassUtils.getAllTraditions().length);
	});
});

// ===========================================================================
// #3 — active-ammo selector folds into attack + damage, consumes on damage
// ===========================================================================

describe("R35 integrated — #3 active-ammo selector", () => {
	test("the R33 special-arrow surface is gone; the selector helpers exist", () => {
		expect(CharacterSheetCombat.prototype._pApplySpecialArrow).toBeUndefined();
		expect(CharacterSheetCombat.prototype._renderSpecialArrowButton).toBeUndefined();
		expect(typeof CharacterSheetCombat.prototype._renderAmmoSelector).toBe("function");
		expect(typeof CharacterSheetCombat.prototype._getSelectedAmmoForWeapon).toBe("function");
	});

	test("a selected +1 ammo adds +1 to the to-hit total and never consumes on attack", () => {
		const state = loadState();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});
		const consumeSpy = [];
		const realConsume = state.consumeAmmunition.bind(state);
		state.consumeAmmunition = (id, n) => { consumeSpy.push([id, n]); return realConsume(id, n); };

		const base = makeCombat(state);
		const baseCap = wireAttack(base, state);
		base._rollAttack(`auto_${ID.longbow}`, null);

		state.setSelectedAmmoId(ID.longbow, "plus1");
		const withAmmo = makeCombat(state);
		const cap = wireAttack(withAmmo, state);
		withAmmo._rollAttack(`auto_${ID.longbow}`, null);

		expect(cap.modifier).toBe(baseCap.modifier + 1);
		expect(consumeSpy.length).toBe(0);
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(7);
	});

	test("the damage roll folds in the +1 and consumes exactly one round + saves + re-renders", async () => {
		const state = loadState();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});

		const base = makeCombat(state);
		wireDamage(base, state);
		await base._rollDamage(`auto_${ID.longbow}`);
		const regularTotal = base.__captured.total;

		state.setSelectedAmmoId(ID.longbow, "plus1");
		const combat = makeCombat(state);
		wireDamage(combat, state);
		await combat._rollDamage(`auto_${ID.longbow}`);

		expect(combat.__captured.total).toBe(regularTotal + 1);
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(6);
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(combat._invRenders.length).toBe(1);
	});

	test("selection persists across toJson→reload", () => {
		const state = loadState();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});
		state.setSelectedAmmoId(ID.longbow, "plus1");
		const reloaded = loadState(JSON.parse(JSON.stringify(state.toJson())));
		expect(reloaded.getSelectedAmmoId(ID.longbow)).toBe("plus1");
	});
});

// ===========================================================================
// Coexistence + round-trip idempotency — all three on ONE instance/load
// ===========================================================================

describe("R35 integrated — coexistence + round-trip idempotency", () => {
	test("a single session can attribute methods, learn a method, AND consume selected ammo, all surviving reload", async () => {
		const state = loadState();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});
		const combat = makeCombat(state);
		wireDamage(combat, state);

		// #1 — learn a new method on this instance.
		combat._addCombatMethod(NEW_METHOD);

		// #3 — select ammo and consume it on a damage roll, same instance.
		state.setSelectedAmmoId(ID.longbow, "plus1");
		await combat._rollDamage(`auto_${ID.longbow}`);

		const captured = combat._saves[combat._saves.length - 1];
		const reloaded = loadState(captured);

		// #1 attribution: the four repaired methods stay attributed, the learned one too.
		for (const {name, trad} of UNATTRIBUTED) {
			expect(ClassUtils.getMethodTraditionCode(findFeature(reloaded, name))).toBe(trad);
		}
		expect(ClassUtils.getMethodTraditionCode(findFeature(reloaded, NEW_METHOD.name))).toBe("UH");
		// #3 ammo: the selection and the consumed round both survived.
		expect(reloaded.getSelectedAmmoId(ID.longbow)).toBe("plus1");
		expect(reloaded.getItems().find(i => i.id === "plus1").quantity).toBe(6);

		// Idempotency: a further toJson→load preserves every fact.
		const again = loadState(JSON.parse(JSON.stringify(reloaded.toJson())));
		expect(ClassUtils.getMethodTraditionCode(findFeature(again, NEW_METHOD.name))).toBe("UH");
		expect(again.getSelectedAmmoId(ID.longbow)).toBe("plus1");
		expect(again.getItems().find(i => i.id === "plus1").quantity).toBe(6);
		expect(again.getEquippedQuiver()?.id).toBe(ID.quiver);

		// No duplicate Singular Focus after the round-trip.
		const dupes = (again._data.features || []).filter(f => f.name === NEW_METHOD.name && ClassUtils.isCombatMethod(f)).length;
		expect(dupes).toBe(1);
	});
});
