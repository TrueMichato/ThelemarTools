/**
 * Cloudpearl's Short Rest bonus — Unit Tests
 *
 * Cloudpearl's affinity — *"a creature that spends Hit Dice during a Short Rest while holding
 * Cloudpearl regains additional Hit Points equal to its Proficiency Bonus"* — was free text.
 * It is now an authored `shortRestHealingBonus` effect that any material may carry.
 *
 * ## Why these tests aim where they do
 *
 * The Short Rest modal computes its OWN `totalHealing` and deliberately never calls
 * `useHitDie()` — there is a comment in the confirm handler saying so, to avoid healing twice.
 * A state accessor wired into `useHitDie` would therefore be a real function, correctly
 * computed, reachable by a unit test, and **invisible on the only path a player takes**. That
 * is "delegation after an early return is not delegation" one level out, and it is why the
 * bonus lives in the modal's confirm handler.
 *
 * Which creates the testing problem this file has to be honest about: the Node test
 * environment has no `document`, and `setup.js`'s `e_`/`ee` stubs return objects whose
 * `querySelectorAll` is `() => []` and whose `dispatchEvent` is a no-op. The modal's DOM
 * cannot be driven here at all. So the arithmetic and the mutation were extracted out of the
 * closure into `computeRestBonusHealing` (pure) and `_applyRestBonusHealing` (heals, toasts,
 * logs) — following the precedent `getMemorizeSpellCandidates` sets in the same file, and
 * `charactersheet-buffpicker-helpers.js` sets at module scale.
 *
 * **What that leaves uncovered, stated plainly:** the ~12 lines inside `_showShortRestDialog`
 * that read the checkbox states and hand them over. Everything downstream of that hand-off —
 * the per-rest ruling, the gate, the suppression, the HP movement, the separate toast and
 * roll-history entry — is under test below.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;

/** Cloudpearl as the brew authors it, trimmed to what the effect pipeline reads. */
const CLOUDPEARL = {
	name: "Cloudpearl",
	source: "TGTT",
	_entityType: "itemMaterial",
	materialCategory: "condensate",
	magicCapacity: 5,
	appliesTo: ["weapon", "armor", "shield", "other"],
	roles: ["strikingSurface", "protectiveLayer", "focus"],
	primaryRole: "focus",
	effects: [
		{type: "condensateAffinity", role: "focus", text: "…regains additional Hit Points equal to its Proficiency Bonus."},
		{type: "shortRestHealingBonus", role: "focus", value: "proficiency", requiresHitDice: true},
		{type: "condensateInstability", text: "Cold damage suppresses this benefit…"},
	],
};

/** The same effect with a FLAT, ungated value — proof the type is not Cloudpearl in disguise. */
const TESTPEARL = {
	...CLOUDPEARL,
	name: "Testpearl",
	effects: [{type: "shortRestHealingBonus", role: "focus", value: 2}],
};

describe("Cloudpearl — Short Rest healing bonus", () => {
	let state;

	const addFocus = (material) => {
		if (material) state.setItemMaterialCatalog([material]);
		state.addItem({name: "Pearl Orb", type: "SCF", weight: 1, value: 70000, quantity: 1});
		const id = state.getItems().slice(-1)[0].id;
		state.setItemEquipped(id, true);
		if (material) state.setItemMaterial(id, material);
		return id;
	};

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5}); // PB +3
		state.setMaxHp(60);
		state.setCurrentHp(10);
	});

	// ==========================================================================
	// The accessor: brew data → a resolved, character-specific number
	// ==========================================================================
	describe("getShortRestHealingBonuses", () => {
		it("resolves the authored `proficiency` string against the character", () => {
			addFocus(CLOUDPEARL);
			expect(state.getShortRestHealingBonuses()).toEqual([
				expect.objectContaining({name: "Cloudpearl", value: 3, requiresHitDice: true}),
			]);
		});

		/**
		 * The brew authors a *string*, not a number, precisely so it tracks. A value snapshot
		 * taken at equip time would be right on the day and wrong for the rest of the campaign.
		 */
		it("tracks proficiency rather than snapshotting it", () => {
			addFocus(CLOUDPEARL);
			state.addClass({name: "Fighter", source: "PHB", level: 9}); // → PB +4
			expect(state.getShortRestHealingBonuses()[0].value).toBe(4);
		});

		it("reads a flat authored number, so the effect type is not Cloudpearl-specific", () => {
			addFocus(TESTPEARL);
			expect(state.getShortRestHealingBonuses()).toEqual([
				expect.objectContaining({name: "Testpearl", value: 2, requiresHitDice: false}),
			]);
		});

		/**
		 * "While holding" comes free from the role gate, not from a name check: the effect is
		 * authored `role: "focus"`, and `getMaterialEffects` already suppresses every
		 * non-descriptive effect whose role is not the item's active one.
		 */
		it("is empty when the item is not equipped", () => {
			const id = addFocus(CLOUDPEARL);
			expect(state.getShortRestHealingBonuses()).toHaveLength(1); // control
			state.setItemEquipped(id, false);
			expect(state.getShortRestHealingBonuses()).toEqual([]);
		});

		it("is empty for a material that does not author the effect", () => {
			addFocus({...CLOUDPEARL, name: "Inert", effects: []});
			expect(state.getShortRestHealingBonuses()).toEqual([]);
		});
	});

	// ==========================================================================
	// The ruling: once per rest, gated on spending
	// ==========================================================================
	describe("computeRestBonusHealing", () => {
		const cloudpearl = {name: "Cloudpearl", value: 3, requiresHitDice: true};
		const testpearl = {name: "Testpearl", value: 2, requiresHitDice: false};

		/**
		 * The headline ruling. This function takes no die count *at all*, which is the
		 * structural way to make "once per rest" unfalsifiable-by-accident — there is nothing
		 * for a die count to multiply. Pinning the arity too, so a future refactor that
		 * reintroduces one has to argue with a test.
		 */
		it("pays a bonus once, with no input a die count could scale", () => {
			const opts = {bonuses: [cloudpearl], suppressedNames: new Set(), hasSpentHitDice: true};
			expect(CharacterSheetRest.computeRestBonusHealing(opts).total).toBe(3);
			expect(CharacterSheetRest.computeRestBonusHealing.length).toBe(0); // one destructured, defaulted param
		});

		it("withholds a gated bonus when no Hit Die was spent", () => {
			expect(CharacterSheetRest.computeRestBonusHealing({bonuses: [cloudpearl], hasSpentHitDice: false}).total).toBe(0);
		});

		it("pays an ungated bonus with no Hit Die spent, proving the gate is the flag", () => {
			expect(CharacterSheetRest.computeRestBonusHealing({bonuses: [testpearl], hasSpentHitDice: false}).total).toBe(2);
		});

		it("stacks distinct materials and names each of them", () => {
			const res = CharacterSheetRest.computeRestBonusHealing({bonuses: [cloudpearl, testpearl], hasSpentHitDice: true});
			expect(res.total).toBe(5);
			expect(res.applied.map(it => it.name)).toEqual(["Cloudpearl", "Testpearl"]);
		});

		it("drops a suppressed bonus from both the total and the report", () => {
			const res = CharacterSheetRest.computeRestBonusHealing({
				bonuses: [cloudpearl, testpearl],
				suppressedNames: new Set(["Cloudpearl"]),
				hasSpentHitDice: true,
			});
			expect(res.total).toBe(2);
			expect(res.applied.map(it => it.name)).toEqual(["Testpearl"]);
		});

		it("returns zero for no bonuses at all", () => {
			expect(CharacterSheetRest.computeRestBonusHealing({}).total).toBe(0);
		});
	});

	// ==========================================================================
	// The mutation: HP actually moves, and the player is told why
	// ==========================================================================
	describe("_applyRestBonusHealing", () => {
		let rest; let toasts; let rolls; let origDoToast;

		beforeEach(() => {
			toasts = []; rolls = [];
			origDoToast = globalThis.JqueryUtil.doToast;
			globalThis.JqueryUtil.doToast = (o) => toasts.push(o);

			// `_initEventListeners` reads `document`, which does not exist here; build the
			// instance without running it rather than stubbing a global the module never owns.
			rest = Object.create(CharacterSheetRest.prototype);
			rest._state = state;
			rest._page = {_rollHistory: {addRoll: (r) => rolls.push(r)}};
		});

		afterEach(() => { globalThis.JqueryUtil.doToast = origDoToast; });

		it("heals the character, and reports it separately from the dice", () => {
			addFocus(CLOUDPEARL);
			const applied = rest._applyRestBonusHealing({
				bonuses: state.getShortRestHealingBonuses(),
				suppressedNames: new Set(),
				hasSpentHitDice: true,
			});

			expect(applied).toBe(3);
			expect(state.getHp().current).toBe(13);
			expect(toasts).toEqual([{type: "success", content: "💠 Cloudpearl: +3 HP"}]);
			expect(rolls).toEqual([{title: "Short Rest: Cloudpearl", total: 3, breakdown: "material rest bonus"}]);
		});

		/**
		 * A no-op must be silent as well as free. Healing 0 would still fire a toast reading
		 * "+0 HP" and log a roll of nothing, which is worse than not offering the material.
		 */
		it("does nothing at all when the bonus is withheld", () => {
			addFocus(CLOUDPEARL);
			const applied = rest._applyRestBonusHealing({
				bonuses: state.getShortRestHealingBonuses(),
				suppressedNames: new Set(),
				hasSpentHitDice: false,
			});

			expect(applied).toBe(0);
			expect(state.getHp().current).toBe(10);
			expect(toasts).toEqual([]);
			expect(rolls).toEqual([]);
		});

		it("does not overheal past maximum", () => {
			state.setCurrentHp(59);
			addFocus(CLOUDPEARL);
			rest._applyRestBonusHealing({bonuses: state.getShortRestHealingBonuses(), hasSpentHitDice: true});
			expect(state.getHp().current).toBe(60);
		});
	});

	// ==========================================================================
	// The section is offered, never assumed
	// ==========================================================================
	describe("_buildMaterialRestBonusSection", () => {
		let rest;

		beforeEach(() => {
			rest = Object.create(CharacterSheetRest.prototype);
			rest._state = state;
		});

		it("renders nothing when no material grants a bonus", () => {
			expect(rest._buildMaterialRestBonusSection([], new Set(), () => {})).toBeNull();
		});

		/**
		 * Ticked by default, which inverts the sheet's usual conditional-modifier stance on
		 * purpose. A conditional bonus is offered because the sheet cannot know it applies;
		 * this one applies unless an instability the sheet likewise cannot see suppresses it.
		 */
		it("offers each bonus pre-granted, and unticking suppresses it by name", () => {
			const suppressed = new Set();
			let refreshes = 0;
			const {rows} = rest._buildMaterialRestBonusSection(
				[{name: "Cloudpearl", value: 3, requiresHitDice: true}],
				suppressed,
				() => refreshes++,
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].cb.checked).toBe(true);

			rows[0].cb.checked = false;
			rows[0].cb._handlers.change();

			expect([...suppressed]).toEqual(["Cloudpearl"]);
			expect(refreshes).toBe(1);

			// And back again — the suppression is a toggle, not a one-way door.
			rows[0].cb.checked = true;
			rows[0].cb._handlers.change();
			expect([...suppressed]).toEqual([]);
		});
	});
});
