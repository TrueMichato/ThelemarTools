/**
 * R26 #3 — Staff of Healing cast affordance (inventory module helpers).
 *
 * The inventory module recognizes a Staff of Healing and exposes a "Cast" affordance that
 * spends charges to cast healing spells. These tests pin the PURE helpers behind that UI:
 *   - `_isHealingStaff`           : recognition by name OR attached healing spells
 *   - `_getHealingStaffSpellMenu` : the cast menu (kind/label/minCost)
 *   - `_getHealingStaffAbilityMod`: wielder's spellcasting ability mod (fallback 0)
 *   - `_rollStaffHealing`         : healing dice math (NdM + ability mod), Thelemar max-dice
 * The charge spend + dawn recharge are pinned at the state level elsewhere.
 */

import "./setup.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function makeInventory (state) {
	return new CharacterSheetInventory({getState: () => state});
}

function clericState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Cleric", source: "PHB", level: 9});
	state.setAbilityBase("wis", 18); // +4
	state._data.spellcasting.ability = "wis"; // ensure a casting ability is set
	return state;
}

function healingStaff (extra = {}) {
	return {
		name: "Staff of Healing",
		source: "DMG",
		staff: true,
		charges: 10,
		chargesCurrent: 10,
		recharge: "dawn",
		rechargeAmount: "{@dice 1d6 + 4}",
		equipped: true,
		attuned: true,
		_isCustom: true,
		...extra,
	};
}

describe("R26 #3 — Staff of Healing helpers", () => {
	describe("_isHealingStaff", () => {
		it("recognizes the canonical Staff of Healing by name", () => {
			const inv = makeInventory(clericState());
			expect(inv._isHealingStaff(healingStaff())).toBe(true);
		});

		it("is case-insensitive on the name", () => {
			const inv = makeInventory(clericState());
			expect(inv._isHealingStaff(healingStaff({name: "staff of HEALING"}))).toBe(true);
		});

		it("recognizes a look-alike charged item that attaches a known healing spell", () => {
			const inv = makeInventory(clericState());
			const item = {
				name: "Rod of Mending",
				attachedSpells: {charges: {1: ["Cure Wounds"], 2: ["Lesser Restoration"]}},
			};
			expect(inv._isHealingStaff(item)).toBe(true);
		});

		it("does not recognize an unrelated staff", () => {
			const inv = makeInventory(clericState());
			expect(inv._isHealingStaff({name: "Staff of Fire", staff: true, charges: 10})).toBe(false);
		});

		it("returns false for null/undefined", () => {
			const inv = makeInventory(clericState());
			expect(inv._isHealingStaff(null)).toBe(false);
			expect(inv._isHealingStaff(undefined)).toBe(false);
		});
	});

	describe("_getHealingStaffSpellMenu", () => {
		it("lists the three healing options with their minimum charge costs", () => {
			const inv = makeInventory(clericState());
			const menu = inv._getHealingStaffSpellMenu();
			const byKind = Object.fromEntries(menu.map(m => [m.kind, m.minCost]));
			expect(byKind.cureWounds).toBe(1);
			expect(byKind.lesserRestoration).toBe(2);
			expect(byKind.massCureWounds).toBe(5);
		});
	});

	describe("_getHealingStaffAbilityMod", () => {
		it("returns the spellcasting ability modifier when set", () => {
			const inv = makeInventory(clericState()); // WIS 18 → +4
			expect(inv._getHealingStaffAbilityMod()).toBe(4);
		});

		it("falls back to 0 when there is no spellcasting ability", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state._data.spellcasting.ability = null;
			const inv = makeInventory(state);
			expect(inv._getHealingStaffAbilityMod()).toBe(0);
		});
	});

	describe("_rollStaffHealing", () => {
		it("rolls NdM and adds the flat modifier", () => {
			const inv = makeInventory(clericState());
			const origRandom = Math.random;
			Math.random = () => 0.999999; // each die rolls max
			try {
				const res = inv._rollStaffHealing("3d8", 4);
				expect(res.total).toBe(3 * 8 + 4); // 28
				expect(res.rolls).toHaveLength(3);
				expect(res.formula).toBe("3d8 + 4");
			} finally {
				Math.random = origRandom;
			}
		});

		it("never returns a negative total", () => {
			const inv = makeInventory(clericState());
			const origRandom = Math.random;
			Math.random = () => 0; // each die rolls 1
			try {
				const res = inv._rollStaffHealing("1d8", 0);
				expect(res.total).toBeGreaterThanOrEqual(1);
			} finally {
				Math.random = origRandom;
			}
		});

		it("uses max dice under the Thelemar item-utilization house rule", () => {
			const state = clericState();
			state.setSetting("thelemar_itemUtilization", true);
			const inv = makeInventory(state);
			const res = inv._rollStaffHealing("4d8", 4);
			expect(res.total).toBe(4 * 8 + 4); // 36, deterministic max
		});
	});

	// (R27 #4) Repeat report: the Staff of Healing silently healed the WIELDER, with no way
	// to direct the healing to an ally (healing SPELLS offer an apply-to-self choice). The
	// cast must NOT auto-heal: it rolls the amount, spends the charge, and surfaces a
	// non-blocking "Apply to Self" affordance so the value can go to an ally or to self.
	describe("R27 #4 — cast does not auto-heal; offers apply-to-self", () => {
		it("casting Cure Wounds spends a charge but leaves the wielder's HP unchanged", async () => {
			const state = clericState();
			state._data.hp = {current: 1, max: 30};
			state.addItem(healingStaff(), 1, true, true);
			const id = state.getItems().find((i) => i.name === "Staff of Healing").id;
			state.setItemCharges(id, 10);
			const inv = makeInventory(state);

			let toastContent = null;
			const origToast = globalThis.JqueryUtil.doToast;
			globalThis.JqueryUtil.doToast = (o) => { toastContent = o?.content; };
			const origEnum = globalThis.InputUiUtil.pGetUserEnum;
			globalThis.InputUiUtil.pGetUserEnum = async () => 0; // Cure Wounds, then Level 1
			try {
				await inv._pCastHealingStaff(id);
			} finally {
				globalThis.JqueryUtil.doToast = origToast;
				globalThis.InputUiUtil.pGetUserEnum = origEnum;
			}

			// The crux: HP must be UNCHANGED — the cast no longer auto-heals the wielder.
			expect(state._data.hp.current).toBe(1);
			// A Level-1 Cure Wounds costs 1 charge (spent at cast time).
			const staff = state.getItems().find((i) => i.name === "Staff of Healing");
			expect(staff.chargesCurrent ?? staff.charges).toBe(9);
			// The result toast advertises the apply-to-self affordance.
			const html = typeof toastContent === "string"
				? toastContent
				: (toastContent?._html || toastContent?.html?.() || "");
			expect(html).toMatch(/Apply\b[^<]*HP to Self/i);
			expect(html).toMatch(/btn-staff-heal-self/);
		});

		it("Lesser Restoration (no healing roll) does not offer an apply-to-self button", async () => {
			const state = clericState();
			state._data.hp = {current: 5, max: 30};
			state.addItem(healingStaff(), 1, true, true);
			const id = state.getItems().find((i) => i.name === "Staff of Healing").id;
			state.setItemCharges(id, 10);
			const inv = makeInventory(state);

			let toastContent = null;
			const origToast = globalThis.JqueryUtil.doToast;
			globalThis.JqueryUtil.doToast = (o) => { toastContent = o?.content; };
			const origEnum = globalThis.InputUiUtil.pGetUserEnum;
			globalThis.InputUiUtil.pGetUserEnum = async () => 1; // Lesser Restoration
			try {
				await inv._pCastHealingStaff(id);
			} finally {
				globalThis.JqueryUtil.doToast = origToast;
				globalThis.InputUiUtil.pGetUserEnum = origEnum;
			}

			expect(state._data.hp.current).toBe(5); // unchanged
			const html = typeof toastContent === "string"
				? toastContent
				: (toastContent?._html || toastContent?.html?.() || "");
			expect(html).not.toMatch(/btn-staff-heal-self/);
		});
	});
});
