/**
 * Bug #6 — Booming Blade / Green-Flame Blade reimplementation (combat side).
 *
 * Covers the transient on-hit rider mechanism:
 *  - the ✨ button arms the rider AFTER rolling the weapon attack,
 *  - the rider attaches to the NEXT matching weapon damage roll (crit-doubled),
 *  - a fresh attack roll discards an un-consumed rider,
 *  - the rider only applies to its own weapon and only when it has on-hit dice.
 *
 * Drives `CharacterSheetCombat` prototype methods with mock `_state`/`_page`.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeCombat (overrides = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._pendingSpellRider = null;
	combat._state = {
		getCombatRound: () => 1,
		...overrides.state,
	};
	combat._page = {
		_spells: {
			getWeaponChannelCantripForCharacter: () => ({
				onHitDice: "1d8",
				onHitDamageType: "thunder",
				secondaryDice: "2d8",
				secondaryDamageType: "thunder",
				secondaryLabel: "thunder damage on moving",
			}),
		},
		...overrides.page,
	};
	// Avoid touching the (absent) DOM — the section render is exercised elsewhere.
	combat.renderCombatChanneledSpell = jest.fn();
	// Deterministic damage parse: total = sum of dice faces, doubled on crit.
	combat._parseDamage = (dice, isCrit) => {
		const m = /^(\d+)d(\d+)/.exec(dice) || [];
		const n = Number(m[1] || 0) * Number(m[2] || 0);
		return {total: isCrit ? n * 2 : n, dice, values: [n]};
	};
	return combat;
}

describe("_armChannelSpellRider", () => {
	it("arms a transient rider with the on-hit dice for the given weapon", () => {
		const combat = makeCombat();
		combat._armChannelSpellRider("atk-1", {spell: {name: "Booming Blade"}, spellData: {}});
		expect(combat._pendingSpellRider).toMatchObject({
			attackId: "atk-1",
			spellName: "Booming Blade",
			dice: "1d8",
			damageType: "thunder",
		});
		expect(combat.renderCombatChanneledSpell).toHaveBeenCalled();
	});

	it("does nothing when the character can't resolve the channel", () => {
		const combat = makeCombat({page: {_spells: {getWeaponChannelCantripForCharacter: () => null}}});
		combat._armChannelSpellRider("atk-1", {spell: {name: "Booming Blade"}, spellData: {}});
		expect(combat._pendingSpellRider).toBeNull();
	});
});

describe("_resolveChannelRiderDamage (rider attaches to next damage roll)", () => {
	it("returns the rider damage for the matching weapon attack", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", spellName: "Booming Blade", dice: "1d8", damageType: "thunder"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.channelSpell).not.toBeNull();
		expect(res.channelSpellDamage).toBe(8);
	});

	it("crit-doubles the on-hit dice", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8", damageType: "thunder"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", true);
		expect(res.channelSpellDamage).toBe(16);
	});

	it("does NOT attach to a different weapon", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-OTHER", false);
		expect(res.channelSpell).toBeNull();
		expect(res.channelSpellDamage).toBe(0);
	});

	it("does NOT attach to a spell attack", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: true}, "atk-1", false);
		expect(res.channelSpell).toBeNull();
	});

	it("does NOT attach when the rider has no on-hit dice (below level 5)", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: null};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.channelSpell).toBeNull();
	});

	it("reports riderMatched=true for the matching weapon even below level 5 (no dice)", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: null};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.riderMatched).toBe(true);
		expect(res.channelSpellDamage).toBe(0);
	});

	it("reports riderMatched=false for a non-matching weapon", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-OTHER", false);
		expect(res.riderMatched).toBe(false);
	});
});

describe("_clearPendingSpellRider (discard)", () => {
	it("clears the rider and refreshes the section", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._clearPendingSpellRider();
		expect(combat._pendingSpellRider).toBeNull();
		expect(combat.renderCombatChanneledSpell).toHaveBeenCalled();
	});
});

describe("fresh attack roll discards an un-consumed rider", () => {
	it("_rollAttack clears a pending rider before rolling", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._cachedAttacks = [];
		combat._state.getAttacks = () => [{id: "atk-1", name: "Sword", range: "5 ft."}];
		combat._state.getTemporaryAttacks = () => [];
		combat._state.getActiveStateAttacks = () => [];
		// Throw right AFTER the discard guard (which runs before any bonus math) so we
		// don't have to mock the whole roll pipeline; the clear must already have happened.
		combat._state.getWeaponAbilityMod = () => { throw new Error("stop"); };
		expect(() => combat._rollAttack("atk-1", {})).toThrow("stop");
		expect(combat._pendingSpellRider).toBeNull();
	});
});

describe("_onChannelSpellButton arms AFTER rolling the attack", () => {
	it("calls _rollAttack first, then arms the rider (so its own roll isn't self-cleared)", async () => {
		const combat = makeCombat();
		const order = [];
		combat._channelCantripsCache = [{spell: {name: "Booming Blade"}, spellData: {}}];
		combat._rollAttack = jest.fn(() => order.push("attack"));
		combat._armChannelSpellRider = jest.fn(() => order.push("arm"));
		await combat._onChannelSpellButton("atk-1", {});
		expect(order).toEqual(["attack", "arm"]);
	});
});
