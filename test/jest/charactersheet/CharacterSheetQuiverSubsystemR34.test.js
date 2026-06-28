/**
 * ROUND 34 — Quiver / ammunition subsystem fix (auto-sync, persistence, full
 * info, full ammo coverage). ANTI-FALSE-GREEN: every sub-change is pinned
 * against the user's REAL save (`fixtures/D_kaios_Petri_2_v2.json`, a Fighter 9
 * TGTT Arcane Archer; equipped Longbow `ammoType: "arrow|xphb"`; quiver holds
 * Healing Arrow + Sleep Dart(5); `settings.ammunitionTracking = false`) and the
 * REAL site ammunition data (`data/items.json` + `data/items-base.json`).
 *
 * Sub-changes pinned here:
 *   (a) #1a — a NEWLY added recognised arrow auto-places into the equipped quiver.
 *   (b) #1b — applying a special arrow PERSISTS (saveCharacter) and re-renders the
 *       Inventory tab (`_page._inventory.render`), not just the quiver.
 *   (c) #2  — the full-quiver display shows the COMPLETE description (every entry),
 *       not just the first sentence.
 *   (d) #3  — the bonus-damage extractor parses extra-damage DICE from `entries`
 *       TEXT (not only `bonusWeaponDamage`), and never invents dice for mundane.
 *   (e) #3  — COVERAGE: over ALL site ammunition, non-mundane ammo surfaces an
 *       effect/damage (never "wasted"); mundane ammo surfaces nothing (no fake).
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
const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");

const ID = {
	longbow: "fdc36263-1226-4643-a92e-5b054371edd2",
	quiver: "9fbd39b4-3188-4412-9a6f-a2f9b80e2e21",
	healingArrow: "1269ba4a-9b0f-4ffd-abec-6bb9d51f4e85",
	sleepDart: "e547e8e3-5e04-4756-a750-b8fcdae6191e",
};

function loadCharacter () {
	const state = new CharacterSheetState();
	state.loadFromJson(JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")));
	return state;
}

/** Bare combat module bound to a state and a (configurable) page stub. */
function mkCombat (state, page) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	// The damage-roll ammo-consume block now re-renders the attack rows (R36 #2);
	// stub it so the DOM-less harness doesn't hit `document` in `renderAttacks`.
	combat.renderAttacks = () => {};
	combat._page = page || {saveCharacter: () => {}};
	return combat;
}

function rawContained (state, containerId) {
	const wrap = state._data.inventory.find(i => i.id === containerId);
	return (wrap?.item?.containedItems || []).slice();
}

// ===========================================================================
// (a) #1a — newly added ammo auto-places into the equipped quiver
// ===========================================================================

describe("R34 (#1a) — adding ammo auto-places it into the equipped quiver", () => {
	it("a NEW recognised arrow lands in the equipped quiver's containedItems", () => {
		const state = loadCharacter();
		expect(state.getEquippedQuiver()?.id).toBe(ID.quiver);

		// Sanity: a brand-new arrow id is NOT yet in the quiver.
		const newId = "r34-new-arrow";
		expect(rawContained(state, ID.quiver)).not.toContain(newId);

		state.addItem({id: newId, name: "Arrow", source: "XPHB", type: "A", quantity: 20});

		const flat = state.getItems().find(i => i.id === newId);
		expect(flat).toBeTruthy();
		// The freshly-added arrow is now inside the equipped quiver.
		expect(rawContained(state, ID.quiver)).toContain(newId);
	});

	it("a NON-ammo item is NOT placed into the quiver", () => {
		const state = loadCharacter();
		const newId = "r34-new-torch";
		state.addItem({id: newId, name: "Torch", source: "XPHB", type: "G", quantity: 1});
		expect(rawContained(state, ID.quiver)).not.toContain(newId);
	});

	it("does not pull ammo already inside another container into the quiver", () => {
		const state = loadCharacter();
		const bagId = "r34-bag";
		const ammoId = "r34-bagged-arrow";
		state.addItem({id: ammoId, name: "Arrow", source: "XPHB", type: "A", quantity: 5});
		state.addItem({id: bagId, name: "Backpack", source: "XPHB", type: "G", quantity: 1});
		// Move the arrow OUT of the quiver (where add auto-placed it) and into the
		// backpack, so it lives in exactly one container before the next trigger.
		const quiver = state._data.inventory.find(i => i.id === ID.quiver);
		quiver.item.containedItems = quiver.item.containedItems.filter(cid => cid !== ammoId);
		const bag = state._data.inventory.find(i => i.id === bagId);
		bag.item.containedItems = [ammoId];

		// Re-trigger auto-place by adding another DISTINCT loose ammo (different
		// name so it does not merge into the bagged "Arrow" stack).
		state.addItem({id: "r34-loose-bolt", name: "Crossbow Bolt", source: "XPHB", type: "A", quantity: 5});

		// The bagged arrow stays in the bag, NOT pulled/duplicated into the quiver.
		expect(rawContained(state, ID.quiver)).not.toContain(ammoId);
		expect(bag.item.containedItems).toContain(ammoId);
		// ...but the genuinely loose new ammo DID auto-place into the quiver.
		expect(rawContained(state, ID.quiver)).toContain("r34-loose-bolt");
	});
});

// ===========================================================================
// (b) #1b — selecting an ammo: the DAMAGE roll persists + re-renders inventory
// ===========================================================================

describe("R34→R35 (#1b) — active-ammo consume on the damage roll persists and re-renders inventory", () => {
	// R35 (Bug #3): re-pointed from `_pApplySpecialArrow` (removed) to the active-ammo
	// `_rollDamage` consume path. Selecting an ammo and rolling damage must decrement
	// the stack by one AND persist (saveCharacter) AND re-render the Inventory tab.
	it("decrements the stack AND invokes saveCharacter AND inventory.render", async () => {
		const saveCalls = [];
		const invRenderCalls = [];
		const page = {
			saveCharacter: () => saveCalls.push(1),
			_inventory: {render: () => invRenderCalls.push(1)},
		};
		const state = loadCharacter();
		state.setSelectedAmmoId(ID.longbow, ID.healingArrow);
		const combat = mkCombat(state, page);
		const weapon = state.getItems().find(i => i.id === ID.longbow);
		combat._cachedAttacks = [{
			id: `auto_${ID.longbow}`,
			name: weapon?.name,
			sourceItem: weapon,
			isSpell: false,
			isMelee: false,
			damage: "1d8",
			damageType: "piercing",
			abilityMod: "dex",
		}];
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._parseDamage = (dice, isCrit) => ({total: 3, sides: 8, rolls: [3], dice, isCrit});
		combat._promptUseCombatMethod = async () => null;
		combat._promptApplyMethodEffect = async () => false;
		combat.renderCombatQuiver = () => {};
		combat._page.pAnimateDamageDice = async () => {};
		combat._page.showDiceResult = () => ({});

		const arrow = state.getQuiverAmmunitionForWeapon(ID.longbow).find(a => a.id === ID.healingArrow);
		expect(arrow).toBeTruthy();
		const before = state.getItems().find(i => i.id === ID.healingArrow).quantity;

		await combat._rollDamage(`auto_${ID.longbow}`);

		const after = state.getItems().find(i => i.id === ID.healingArrow)?.quantity ?? 0;
		expect(after).toBe(before - 1);
		expect(saveCalls.length).toBe(1);
		expect(invRenderCalls.length).toBe(1);
	});
});

// ===========================================================================
// (c) #2 — full-quiver display shows the COMPLETE description
// ===========================================================================

describe("R34 (#2) — full-quiver display shows complete arrow info", () => {
	it("_buildQuiverFullHtml includes the FULL description, not just the first sentence", () => {
		const state = loadCharacter();
		const combat = mkCombat(state);
		const quiver = state.getEquippedQuiver();
		const html = combat._buildQuiverFullHtml(quiver);

		// The Healing Arrow's description has a SECOND entry beyond the first
		// sentence — proving the full description (not just sentence one) is shown.
		expect(html).toMatch(/Arrows are typically stored in a/);
		// Still shows the effective count.
		expect(html).toMatch(/×/);
	});
});

// ===========================================================================
// (d) #3 — bonus-damage extractor reads entries TEXT, never invents dice
// ===========================================================================

describe("R34 (#3) — extra-damage dice parsed from data AND entries text", () => {
	it("parses explicit bonusWeaponDamage dice (unchanged behaviour)", () => {
		const combat = mkCombat(loadCharacter());
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: "2d6"})).toEqual({dice: "2d6", type: ""});
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: "1d6 fire"})).toEqual({dice: "1d6", type: "fire"});
	});

	it("parses extra-damage dice from entries TEXT (plain + tagged forms)", () => {
		const combat = mkCombat(loadCharacter());
		expect(combat._extractAmmoBonusDamage({entries: ["On a hit, the target takes an extra 1d6 fire damage."]}))
			.toEqual({dice: "1d6", type: "fire"});
		expect(combat._extractAmmoBonusDamage({entries: ["The target takes an additional 2d6 poison damage on a hit."]}))
			.toEqual({dice: "2d6", type: "poison"});
		expect(combat._extractAmmoBonusDamage({entries: ["You deal an extra {@damage 1d4} cold damage."]}))
			.toEqual({dice: "1d4", type: "cold"});
	});

	it("returns null for mundane ammo or non-extra-damage text (never invents dice)", () => {
		const combat = mkCombat(loadCharacter());
		expect(combat._extractAmmoBonusDamage({bonusWeaponDamage: 1})).toBeNull();
		expect(combat._extractAmmoBonusDamage({})).toBeNull();
		expect(combat._extractAmmoBonusDamage({entries: ["Arrows are used with a weapon that has the ammunition property."]})).toBeNull();
		// A save-or-condition arrow (no "extra/additional NdM damage") yields no extra dice.
		expect(combat._extractAmmoBonusDamage({entries: ["When you hit a creature, roll 5d8; if it has fewer hit points it falls unconscious."]})).toBeNull();
	});
});

// ===========================================================================
// (e) #3 — site-ammo coverage: no wasted arrows, no fake effects
// ===========================================================================

describe("R34 (#3) — site ammunition coverage (no wasted, no fake)", () => {
	function loadSiteAmmo () {
		const base = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "items-base.json"), "utf8")).baseitem || [];
		const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "items.json"), "utf8")).item || [];
		const state = new CharacterSheetState();
		return [...base, ...items].filter(it => state._isAmmunitionItem(it));
	}

	it("enumerates a meaningful population of site ammunition", () => {
		expect(loadSiteAmmo().length).toBeGreaterThanOrEqual(30);
	});

	it("every NON-mundane ammo surfaces an effect or extra damage (never wasted)", () => {
		const state = new CharacterSheetState();
		const combat = mkCombat(state);
		const ammo = loadSiteAmmo();

		const wasted = [];
		for (const a of ammo) {
			const hasBonus = (a.bonusWeapon && a.bonusWeapon !== "+0")
				|| (a.bonusWeaponDamage && a.bonusWeaponDamage !== "+0");
			const hasEntries = Array.isArray(a.entries) && a.entries.length > 0;
			const isMundane = !hasBonus && !hasEntries;
			if (isMundane) continue;
			const effect = combat._getAmmoEffectText(a);
			const dmg = combat._extractAmmoBonusDamage(a);
			if (!(effect && effect.trim()) && !dmg) wasted.push(`${a.name}|${a.source}`);
		}
		expect(wasted).toEqual([]);
	});

	it("every MUNDANE ammo surfaces nothing (no fake effect, no invented dice)", () => {
		const state = new CharacterSheetState();
		const combat = mkCombat(state);
		const ammo = loadSiteAmmo();

		const faked = [];
		for (const a of ammo) {
			const hasBonus = (a.bonusWeapon && a.bonusWeapon !== "+0")
				|| (a.bonusWeaponDamage && a.bonusWeaponDamage !== "+0");
			const hasEntries = Array.isArray(a.entries) && a.entries.length > 0;
			const isMundane = !hasBonus && !hasEntries;
			if (!isMundane) continue;
			const effect = combat._getAmmoEffectText(a);
			const dmg = combat._extractAmmoBonusDamage(a);
			if ((effect && effect.trim()) || dmg) faked.push(`${a.name}|${a.source}`);
		}
		expect(faked).toEqual([]);
	});
});
