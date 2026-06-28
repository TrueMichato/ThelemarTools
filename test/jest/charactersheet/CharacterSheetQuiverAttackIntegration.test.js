/**
 * ROUND 33 — Quiver UX overhaul (attack-integration redesign).
 *
 * ANTI-FALSE-GREEN coverage for the R33 redesign that REPLACED the R32
 * post-attack quiver popup with an on-demand "🏹 Special Arrow" affordance on
 * each ranged-weapon attack row, and relocated the quiver to a compact summary
 * (top of "Weapons & Attacks") + a full-quiver modal.
 *
 * Loads the user's real save (`fixtures/D_kaios_Petri_2_v2.json` — Fighter 9
 * TGTT Arcane Archer; equipped Longbow `ammoType: "arrow|xphb"`; quiver holds
 * Healing Arrow + Sleep Dart(5); `settings.ammunitionTracking = false`) and
 * asserts REAL mechanics:
 *
 *   (1) the OLD post-attack `quiver` hook + `_pPickQuiverAmmo` are GONE.
 *   (2) the Special Arrow affordance renders for the Longbow (quiver ammo > 0),
 *       and NOT for a melee weapon (Rapier) nor when the quiver holds no
 *       compatible ammo (quiver unequipped).
 *   (3) choosing an arrow rolls the WEAPON's normal damage, consumes EXACTLY one
 *       round, and surfaces the arrow's effect / explicit bonus damage.
 *   (4) static-HTML — standalone `#charsheet-combat-quiver-section` removed; the
 *       🏹 Quiver button + compact-summary container live in "Weapons & Attacks";
 *       the Inventory-tab quiver section is untouched.
 *
 * NOT gated on `isAmmunitionTrackingEnabled` (the quiver is its own always-on
 * feature) — the fixture has tracking OFF and the affordance still fires.
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
const HTML_PATH = path.join(__dirname, "..", "..", "..", "charactersheet.html");

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

/** Bare combat module bound to a state (and a no-op page), mirroring the other quiver specs. */
function mkCombat (state) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	// The damage-roll ammo-consume block now re-renders the attack rows (R36 #2);
	// stub it so the DOM-less harness doesn't hit `document` in `renderAttacks`.
	combat.renderAttacks = () => {};
	combat._page = {saveCharacter: () => {}};
	return combat;
}

/** Build an attack-like object the way `renderAttacks` does (sourceItem = flat weapon). */
function mkWeaponAttack (state, weaponId, {isMelee = false} = {}) {
	const weapon = state.getItems().find(i => i.id === weaponId);
	return {id: `auto_${weaponId}`, name: weapon?.name, sourceItem: weapon, isSpell: false, isMelee};
}

// ===========================================================================
// (1) The OLD post-attack quiver popup flow is GONE
// ===========================================================================

describe("R33 — old post-attack quiver popup removed", () => {
	it("no post-attack hook is registered with id 'quiver'", () => {
		const combat = mkCombat(loadCharacter());
		const ids = combat._getPostAttackHooks().map(h => h.id);
		expect(ids).not.toContain("quiver");
		// Sibling hooks are untouched.
		expect(ids).toContain("arcaneShot");
		expect(ids).toContain("critWeaponRider");
	});

	it("the `_pPickQuiverAmmo` handler no longer exists on the prototype", () => {
		expect(CharacterSheetCombat.prototype._pPickQuiverAmmo).toBeUndefined();
	});

	// R35 (Bug #3): the R33 "Special Arrow" damage-time button is REPLACED by a
	// per-weapon active-ammunition SELECTOR. The old async handlers are gone; the
	// selector helpers take their place.
	it("the R33 Special Arrow handlers are GONE and the active-ammo selector helpers are present", () => {
		expect(CharacterSheetCombat.prototype._pPickSpecialArrowDamage).toBeUndefined();
		expect(CharacterSheetCombat.prototype._pApplySpecialArrow).toBeUndefined();
		expect(CharacterSheetCombat.prototype._renderSpecialArrowButton).toBeUndefined();
		expect(typeof CharacterSheetCombat.prototype._isAmmoSelectorEligible).toBe("function");
		expect(typeof CharacterSheetCombat.prototype._renderAmmoSelector).toBe("function");
		expect(typeof CharacterSheetCombat.prototype._getSelectedAmmoForWeapon).toBe("function");
	});
});

// ===========================================================================
// (2) Special Arrow affordance gating (real fixture)
// ===========================================================================

describe("R33→R35 — active-ammo selector affordance gating", () => {
	// R35 (Bug #3): re-pointed from `_isSpecialArrowEligible`/`_renderSpecialArrowButton`
	// to the active-ammo `_isAmmoSelectorEligible`/`_renderAmmoSelector` surface
	// (same eligibility predicate; selector markup instead of a button).
	it("RENDERS for the Longbow when the equipped quiver holds compatible ammo (tracking OFF)", () => {
		const state = loadCharacter();
		expect(state.isAmmunitionTrackingEnabled()).toBe(false);
		expect(state.getQuiverAmmunitionForWeapon(ID.longbow).length).toBeGreaterThan(0);

		const combat = mkCombat(state);
		const attack = mkWeaponAttack(state, ID.longbow, {isMelee: false});
		expect(combat._isAmmoSelectorEligible(attack, false)).toBe(true);
		const html = combat._renderAmmoSelector(attack, false);
		expect(html).toMatch(/charsheet__attack-ammo-select/);
		expect(html).toMatch(/<option value="" selected>Regular<\/option>/);
		expect(html).toMatch(/Healing Arrow/);
	});

	it("does NOT render for a MELEE weapon (Rapier)", () => {
		const state = loadCharacter();
		const combat = mkCombat(state);
		const attack = mkWeaponAttack(state, ID.rapier, {isMelee: true});
		expect(combat._isAmmoSelectorEligible(attack, true)).toBe(false);
		expect(combat._renderAmmoSelector(attack, true)).toBe("");
	});

	it("does NOT render when the quiver holds no compatible ammo (quiver unequipped)", () => {
		const state = loadCharacter();
		state.setItemEquipped(ID.quiver, false);
		expect(state.getQuiverAmmunitionForWeapon(ID.longbow).length).toBe(0);

		const combat = mkCombat(state);
		const attack = mkWeaponAttack(state, ID.longbow, {isMelee: false});
		expect(combat._isAmmoSelectorEligible(attack, false)).toBe(false);
		expect(combat._renderAmmoSelector(attack, false)).toBe("");
	});

	it("does NOT render for a SPELL attack even when ranged with a sourceItem", () => {
		const state = loadCharacter();
		const combat = mkCombat(state);
		const weapon = state.getItems().find(i => i.id === ID.longbow);
		const spellAttack = {name: "Fire Bolt", isSpell: true, isMelee: false, sourceItem: weapon};
		expect(combat._isAmmoSelectorEligible(spellAttack, false)).toBe(false);
	});
});

// ===========================================================================
// (3) Choosing an arrow: weapon damage + single consume + effect surfaced
// ===========================================================================

describe("R33→R35 — selecting an ammo: damage-roll consumes one, persists, re-renders", () => {
	// R35 (Bug #3): the apply path is no longer a discrete `_pApplySpecialArrow`
	// button; instead the chosen ammo is consumed (exactly one round) on the
	// DAMAGE roll, which then persists + re-renders the Inventory tab. Re-pointed
	// with an equally strong assertion against the real `_rollDamage` path.
	it("the DAMAGE roll consumes EXACTLY one round of the selected ammo, persists, and re-renders the Inventory tab", async () => {
		const state = loadCharacter();
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);

		const combat = mkCombat(state);
		const dmgAttack = mkWeaponAttack(state, ID.longbow, {isMelee: false});
		dmgAttack.damage = "1d8";
		dmgAttack.damageType = "piercing";
		dmgAttack.abilityMod = "dex";
		combat._cachedAttacks = [dmgAttack];
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat.renderCombatQuiver = () => {};
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = () => ({});
		const saveCalls = [];
		const invRenderCalls = [];
		combat._page.saveCharacter = () => saveCalls.push(1);
		combat._page._inventory = {render: () => invRenderCalls.push(1)};

		const before = state.getItems().find(i => i.id === ID.healingArrow).quantity;
		const consumeArgs = [];
		const realConsume = state.consumeAmmunition.bind(state);
		state.consumeAmmunition = (id, n) => { consumeArgs.push([id, n]); return realConsume(id, n); };

		await combat._rollDamage(`auto_${ID.longbow}`);

		// (a) exactly one round consumed (stack-based single decrement).
		expect(consumeArgs).toEqual([[ID.healingArrow, 1]]);
		const after = state.getItems().find(i => i.id === ID.healingArrow)?.quantity ?? 0;
		expect(after).toBe(before - 1);
		// (b) persisted + re-rendered the Inventory tab.
		expect(saveCalls.length).toBe(1);
		expect(invRenderCalls.length).toBe(1);
	});

	it("rolls and adds an arrow's EXPLICIT bonus-damage dice when present", () => {
		const combat = mkCombat(loadCharacter());
		// Pure extractor: dice expression → rolled; flat / mundane → null.
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: "2d6"})).toEqual({dice: "2d6", type: ""});
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: "1d6 fire"})).toEqual({dice: "1d6", type: "fire"});
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: 1})).toBeNull();
		expect(combat._extractAmmoBonusDamage({})).toBeNull();
	});
});

// ===========================================================================
// (4) Static-HTML placement
// ===========================================================================

describe("R33 — Weapons & Attacks placement (static HTML)", () => {
	const html = fs.readFileSync(HTML_PATH, "utf8");

	it("the standalone combat quiver SECTION is REMOVED", () => {
		expect(html.includes(`id="charsheet-combat-quiver-section"`)).toBe(false);
		expect(html.includes(`id="charsheet-combat-quiver"`)).toBe(false);
	});

	it("a 🏹 Quiver header button + compact-summary container live in Weapons & Attacks", () => {
		const waIdx = html.indexOf("Weapons & Attacks");
		const attacksIdx = html.indexOf(`id="charsheet-combat-attacks"`);
		const openBtn = html.indexOf(`id="charsheet-combat-quiver-open"`);
		const summary = html.indexOf(`id="charsheet-combat-quiver-summary"`);

		expect(waIdx).toBeGreaterThan(-1);
		expect(openBtn).toBeGreaterThan(waIdx);
		expect(summary).toBeGreaterThan(waIdx);
		// Compact summary sits ABOVE the attack list.
		expect(summary).toBeLessThan(attacksIdx);
	});

	it("the Inventory-tab quiver section is untouched", () => {
		const invQuiver = html.indexOf(`id="charsheet-inventory-quiver-section"`);
		const inventory = html.indexOf(`id="charsheet-tab-inventory"`);
		const features = html.indexOf(`id="charsheet-tab-features"`);
		expect(invQuiver).toBeGreaterThan(inventory);
		expect(invQuiver).toBeLessThan(features);
	});
});
