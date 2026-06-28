/**
 * BUG #3 (Round 35) — Per-weapon ACTIVE AMMUNITION SELECTOR.
 *
 * The R33 "🏹 Special Arrow" button only TOASTED an arrow's bonus on the damage
 * roll — it was never folded into the rolled damage, and an arrow's ATTACK bonus
 * could never apply (to-hit was already rolled). This replaces it with a
 * per-weapon active ammunition selector whose chosen ammo:
 *   - applies its bonuses to BOTH the attack roll AND the damage roll;
 *   - is consumed EXACTLY ONCE, on the DAMAGE roll (never on the attack roll);
 *   - reverts the weapon to "Regular" when its stack is depleted.
 * "Regular" (no selection) = no bonus, no special consumption.
 *
 * ANTI-FALSE-GREEN: loads the real save `fixtures/D_kaios_Petri_2_v2.json`
 * (Fighter 9 TGTT Arcane Archer; equipped Longbow `ammoType: "arrow|xphb"`;
 * quiver holds Healing Arrow + Sleep Dart(5); `settings.ammunitionTracking =
 * false`). The fixture's Healing Arrow carries NO numeric bonus, so the numeric
 * proofs synthesize a +1 ammo (`bonusWeapon: "+1"`) and an entries-text
 * extra-dice ammo and place them in the equipped quiver. Each sub-change below is
 * written to FAIL when its fix is reverted:
 *   (i)   selecting an ammo PERSISTS across toJson → reload (default Regular).
 *   (ii)  `_rollAttack` adds the ammo attack bonus to the to-hit total AND does
 *         NOT decrement the stack.
 *   (iii) `_rollDamage` folds the ammo damage bonus into the total AND decrements
 *         the stack by exactly one AND saves + re-renders.
 *   (iv)  selecting "Regular" applies no bonus and does not consume.
 *   (v)   depleting the selected ammo reverts the weapon to Regular.
 */

import "./setup.js";
import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "D_kaios_Petri_2_v2.json");

const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	rapier: "3afea0fa-6c63-49e4-b4e9-5187154632d5",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
};

function loadCharacter () {
	const state = new CharacterSheetState();
	state.loadFromJson(JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")));
	return state;
}

/** Bare combat module bound to a state + a page stub spying save / inventory render. */
function mkCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._weaponRiderEnabled = {};
	combat._selectedCunningStrikes = [];
	combat._battleTacticToggles = {};
	combat.renderAttacks = () => {};
	combat.renderCombatQuiver = () => {};
	const calls = {save: 0, invRender: 0};
	combat._page = {
		saveCharacter: () => { calls.save++; },
		_inventory: {render: () => { calls.invRender++; }},
	};
	combat.__calls = calls;
	return combat;
}

/** An attack the way `renderAttacks` builds it (sourceItem = flat weapon). */
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

/**
 * Inject a synthetic arrow into inventory AND the equipped quiver so the real
 * state machinery (selection, consume, quiver lookup) operates on it end-to-end.
 */
function addQuiverArrow (state, {id, name, quantity = 5, bonusWeapon, bonusWeaponDamage, entries}) {
	const item = {
		name,
		type: "gear",
		baseItem: "arrow|xphb",
		arrow: true,
		weapon: false,
		rarity: "uncommon",
	};
	if (bonusWeapon != null) item.bonusWeapon = bonusWeapon;
	if (bonusWeaponDamage != null) item.bonusWeaponDamage = bonusWeaponDamage;
	if (entries) item.entries = entries;

	state._data.inventory.push({id, item, quantity, equipped: false, attuned: false});

	const quiver = state._data.inventory.find(i => i.id === ID.quiver);
	quiver.item.containedItems = quiver.item.containedItems || [];
	quiver.item.containedItems.push(id);
}

// ===========================================================================
// (i) Selection persists across toJson → reload (default is Regular)
// ===========================================================================

describe("Bug #3 (i) — active-ammo selection persists across save/reload", () => {
	test("default is Regular (null) before any selection", () => {
		const state = loadCharacter();
		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
	});

	test("setSelectedAmmoId round-trips through toJson → loadFromJson", () => {
		const state = loadCharacter();
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);
		expect(state.getSelectedAmmoId(ID.longbow)).toBe(ID.healingArrow);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		// If the persistence (state default + getter/setter) is reverted, the
		// reloaded selection is lost and this is null — RED.
		expect(reloaded.getSelectedAmmoId(ID.longbow)).toBe(ID.healingArrow);
	});

	test("clearing a selection (Regular) deletes the entry and round-trips as null", () => {
		const state = loadCharacter();
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);
		state.setSelectedAmmoId(ID.longbow, null);
		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.getSelectedAmmoId(ID.longbow)).toBeNull();
	});

	test("old saves lacking `selectedAmmo` default every weapon to Regular", () => {
		const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
		delete raw.selectedAmmo; // simulate a pre-Bug#3 save
		const state = new CharacterSheetState();
		state.loadFromJson(raw);
		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
	});
});

// ===========================================================================
// Selector render (replaces the removed Special Arrow button)
// ===========================================================================

describe("Bug #3 — ammo selector render + R33 surface removed", () => {
	test("the old Special Arrow handlers are GONE", () => {
		expect(CharacterSheetCombat.prototype._pPickSpecialArrowDamage).toBeUndefined();
		expect(CharacterSheetCombat.prototype._pApplySpecialArrow).toBeUndefined();
		expect(CharacterSheetCombat.prototype._renderSpecialArrowButton).toBeUndefined();
	});

	test("the new selector helpers ARE present", () => {
		expect(typeof CharacterSheetCombat.prototype._isAmmoSelectorEligible).toBe("function");
		expect(typeof CharacterSheetCombat.prototype._renderAmmoSelector).toBe("function");
		expect(typeof CharacterSheetCombat.prototype._getSelectedAmmoForWeapon).toBe("function");
	});

	test("renders a <select> with Regular + each quiver ammo (count), for the ranged Longbow only", () => {
		const state = loadCharacter();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});
		const combat = mkCombat(state);
		const html = combat._renderAmmoSelector(mkWeaponAttack(state, ID.longbow), false);
		expect(html).toMatch(/charsheet__attack-ammo-select/);
		expect(html).toMatch(/<option value="" selected>Regular<\/option>/);
		expect(html).toMatch(/\+1 Arrow \(×7\)/);
		// Not for a melee weapon.
		expect(combat._renderAmmoSelector(mkWeaponAttack(state, ID.rapier, {isMelee: true}), true)).toBe("");
	});

	test("the current selection is reflected as the selected <option>", () => {
		const state = loadCharacter();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});
		state.setSelectedAmmoId(ID.longbow, "plus1");
		const combat = mkCombat(state);
		const html = combat._renderAmmoSelector(mkWeaponAttack(state, ID.longbow), false);
		expect(html).toMatch(/<option value="plus1" selected>/);
	});
});

// ===========================================================================
// (ii) Attack roll folds in the ammo attack bonus; no consume on attack
// ===========================================================================

describe("Bug #3 (ii) — attack roll folds in the ammo attack bonus, never consumes", () => {
	function mkAttackCombat (state) {
		const combat = mkCombat(state);
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
		return combat;
	}

	test("a selected +1 ammo adds +1 to the to-hit total and is itemized; stack untouched", () => {
		const state = loadCharacter();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});

		const consumeSpy = [];
		const realConsume = state.consumeAmmunition.bind(state);
		state.consumeAmmunition = (id, n) => { consumeSpy.push([id, n]); return realConsume(id, n); };

		// Baseline (Regular).
		const base = mkAttackCombat(state);
		base._rollAttack(`auto_${ID.longbow}`, null);
		const regularModifier = base.__captured.modifier;

		// With +1 ammo selected.
		state.setSelectedAmmoId(ID.longbow, "plus1");
		const withAmmo = mkAttackCombat(state);
		withAmmo._rollAttack(`auto_${ID.longbow}`, null);

		// (a) The to-hit bonus is exactly +1 higher than Regular.
		expect(withAmmo.__captured.modifier).toBe(regularModifier + 1);
		// (b) The bonus is itemized in the roll title.
		expect(withAmmo.__captured.title).toMatch(/\+1 Arrow \+1/);
		// (c) The attack roll NEVER consumes ammo (no decrement on either run).
		expect(consumeSpy.length).toBe(0);
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(7);
	});
});

// ===========================================================================
// (iii) Damage roll folds in the ammo damage bonus + consumes exactly one
// ===========================================================================

describe("Bug #3 (iii) — damage roll folds in ammo damage and consumes exactly one round", () => {
	function mkDamageCombat (state) {
		const combat = mkCombat(state);
		const captured = {};
		combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
		// Deterministic dice: every component rolls a constant 3 so totals are stable.
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = (o) => { Object.assign(captured, o); return {}; };
		combat.__captured = captured;
		return combat;
	}

	test("a +1 (flat) ammo adds +1 to the damage total and decrements the stack by one + saves/re-renders", async () => {
		const state = loadCharacter();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});

		// Baseline (Regular).
		const base = mkDamageCombat(state);
		await base._rollDamage(`auto_${ID.longbow}`);
		const regularTotal = base.__captured.total;
		expect(typeof regularTotal).toBe("number");

		// With +1 ammo selected.
		state.setSelectedAmmoId(ID.longbow, "plus1");
		const combat = mkDamageCombat(state);
		await combat._rollDamage(`auto_${ID.longbow}`);

		// (a) damage total is exactly +1 higher (flat bonus rides weapon type).
		expect(combat.__captured.total).toBe(regularTotal + 1);
		expect(combat.__captured.subtitle).toMatch(/\+ 1 \(\+1 Arrow\)/);
		// (b) exactly one round consumed.
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(6);
		// (c) persisted + re-rendered the Inventory tab.
		expect(combat.__calls.save).toBe(1);
		expect(combat.__calls.invRender).toBe(1);
	});

	test("an entries-text extra-dice ammo adds its dice as a typed rider (crit pipeline)", async () => {
		const state = loadCharacter();
		addQuiverArrow(state, {
			id: "fireArrow",
			name: "Flame Arrow",
			quantity: 4,
			entries: ["On a hit the target takes an extra 2d6 fire damage."],
		});

		const base = mkDamageCombat(state);
		await base._rollDamage(`auto_${ID.longbow}`);
		const regularRoll = base.__captured.roll;

		state.setSelectedAmmoId(ID.longbow, "fireArrow");
		const combat = mkDamageCombat(state);
		await combat._rollDamage(`auto_${ID.longbow}`);

		// The ammo's extra dice ride the riderParts pipeline (rolled, constant 3 here),
		// so the rolled-dice total is higher than Regular and the fire rider shows.
		expect(combat.__captured.roll).toBe(regularRoll + 3);
		expect(combat.__captured.subtitle).toMatch(/Flame Arrow 2d6 fire/);
		// One round consumed.
		expect(state.getItems().find(i => i.id === "fireArrow").quantity).toBe(3);
	});
});

// ===========================================================================
// (iv) Regular = no bonus, no consume
// ===========================================================================

describe("Bug #3 (iv) — Regular applies nothing and never consumes", () => {
	test("with no selection, the damage roll is unchanged and nothing is consumed", async () => {
		const state = loadCharacter();
		addQuiverArrow(state, {id: "plus1", name: "+1 Arrow", quantity: 7, bonusWeapon: "+1"});

		const combat = mkCombat(state);
		const captured = {};
		combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = (o) => { Object.assign(captured, o); return {}; };

		const consumeSpy = [];
		const realConsume = state.consumeAmmunition.bind(state);
		state.consumeAmmunition = (id, n) => { consumeSpy.push([id, n]); return realConsume(id, n); };

		// Regular (no selection).
		await combat._rollDamage(`auto_${ID.longbow}`);

		expect(consumeSpy.length).toBe(0);
		expect(state.getItems().find(i => i.id === "plus1").quantity).toBe(7);
		// No ammo line in the subtitle.
		expect(captured.subtitle).not.toMatch(/Arrow/);
		// Regular adds no flat ammo bonus + no save/inventory churn from the ammo path.
		expect(combat.__calls.save).toBe(0);
		expect(combat.__calls.invRender).toBe(0);
	});
});

// ===========================================================================
// (v) Depleting the selected ammo reverts the weapon to Regular
// ===========================================================================

describe("Bug #3 (v) — depletion reverts the weapon to Regular", () => {
	test("firing the last round clears the selection back to Regular", async () => {
		const state = loadCharacter();
		// Quantity 1 → one shot left.
		addQuiverArrow(state, {id: "lastArrow", name: "Last Arrow", quantity: 1, bonusWeapon: "+1"});
		state.setSelectedAmmoId(ID.longbow, "lastArrow");
		expect(state.getSelectedAmmoId(ID.longbow)).toBe("lastArrow");

		const combat = mkCombat(state);
		combat._cachedAttacks = [mkWeaponAttack(state, ID.longbow)];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = () => ({});

		await combat._rollDamage(`auto_${ID.longbow}`);

		// Stack emptied → the item is removed and the selection reverts to Regular.
		expect(state.getItems().find(i => i.id === "lastArrow")).toBeUndefined();
		expect(state.getSelectedAmmoId(ID.longbow)).toBeNull();
	});
});
