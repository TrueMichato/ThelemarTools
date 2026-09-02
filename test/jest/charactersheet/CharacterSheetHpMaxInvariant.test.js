import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const FIGHTER_5 = Object.freeze({
	name: "Invariant Probe",
	classes: [{name: "Fighter", level: 5, subclass: null}],
	abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8},
});

function load (doc) {
	const state = new CharacterSheetState();
	state.loadFromJson(doc);
	return state;
}

describe("Hit point maximum document invariant", () => {
	describe("_migrateHpMax repairs a non-positive stored maximum", () => {
		it("repairs a save that omits hp.max entirely", () => {
			const state = load({...FIGHTER_5, hp: {current: 25, temp: 0}});

			// The bug: the sheet displayed a healthy maximum while serializing zero.
			expect(state.getMaxHp()).toBeGreaterThan(0);
			expect(state.toJson().hp.max).toBe(state.getMaxHp());
			// Repair must not disturb the player's current hit points.
			expect(state.toJson().hp.current).toBe(25);
		});

		it.each([
			["zero", 0],
			["negative", -12],
			["non-finite", Number.NaN],
			["non-numeric", "many"],
		])("repairs a stored maximum that is %s", (_label, max) => {
			const state = load({...FIGHTER_5, hp: {current: 20, max, temp: 0}});

			expect(state.toJson().hp.max).toBe(state.getMaxHp());
			expect(state.toJson().hp.max).toBeGreaterThan(0);
		});

		it("is a no-op when a positive maximum is already stored", () => {
			const state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});
			state.setMaxHp(120);

			state._migrateHpMax();

			expect(state.toJson().hp.max).toBe(120);
		});

		it("preserves current hit points when the maximum depends on a class feature", () => {
			// Regression: repairing the maximum mid-load, before `_clearClassFeatureEffects()`
			// re-mints feature HP modifiers, computes an understated maximum and clamps current
			// hit points down to it. Draconic Resilience is +1 HP per Sorcerer level.
			const state = load({
				name: "Draconic",
				classes: [{name: "Sorcerer", level: 5, subclass: {name: "Draconic Sorcery"}}],
				abilities: {str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16},
				hp: {current: 37, max: 0, temp: 0},
			});

			const doc = state.toJson();
			expect(doc.hp.max).toBe(doc.hp.effectiveMax);
			expect(doc.hp.current).toBe(37);
		});

		it("preserves current hit points above the effective maximum while repairing the base", () => {
			// Psionic body strain halves the maximum without touching the current total, and the
			// monotonic heal rule exists precisely so that state survives. Repairing the cache must
			// not clamp, or opening and saving a strained character silently deletes hit points.
			const state = load({
				name: "Strained",
				classes: [{name: "Talent", level: 10, subclass: null}],
				abilities: {str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 16},
				hp: {current: 60, max: 0, temp: 0},
				psionicStrain: {body: 7, mind: 0, soul: 0},
			});

			const doc = state.toJson();
			expect(doc.hp.current).toBe(60);
			expect(doc.hp.max).toBeGreaterThan(0);
			// Strain halves the applicable maximum, so current legitimately exceeds it.
			expect(doc.hp.effectiveMax).toBe(state.getMaxHp());
			expect(doc.hp.effectiveMax).toBeLessThan(doc.hp.current);
		});

		it("leaves a level-less blank character untouched", () => {
			const state = new CharacterSheetState();

			expect(state.getTotalLevel()).toBe(0);
			expect(state.toJson().hp.max).toBe(0);
		});

		it("repairs the cache without touching current hit points", () => {
			// The migration's job is the cache, not policing current HP. Capping here is what
			// destroyed hit points for strain-halved characters; the normal reconcile path still
			// caps when a cap is actually warranted (see "live adoption preserves hit points").
			const state = load({...FIGHTER_5, hp: {current: 9999, max: 0, temp: 0}});

			const doc = state.toJson();
			expect(doc.hp.max).toBe(doc.hp.effectiveMax);
			expect(doc.hp.current).toBe(9999);
		});
	});

	describe("hp.effectiveMax materialises the applicable maximum", () => {
		it("mirrors getMaxHp() for a calculated maximum", () => {
			const state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});

			expect(state.toJson().hp.effectiveMax).toBe(state.getMaxHp());
		});

		it("mirrors getMaxHp() through a maximum-HP reduction", () => {
			const state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});
			const unreduced = state.getMaxHp();

			state.setMaxHpReduction(10);

			expect(state.getMaxHp()).toBe(unreduced - 10);
			expect(state.toJson().hp.effectiveMax).toBe(state.getMaxHp());
		});

		it("mirrors getMaxHp() for an explicitly-set maximum", () => {
			const state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});

			state.setMaxHp(80);

			expect(state.toJson().hp.effectiveMax).toBe(80);
			expect(state.toJson().hp.effectiveMax).toBe(state.getMaxHp());
		});

		it("mirrors getMaxHp() while current hit points exceed the maximum", () => {
			// The server must still see a usable maximum in this state; the heal path relies on
			// it to stay monotonic rather than clamping the character downwards.
			const state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});
			state.setMaxHp(20);
			state._data.hp.current = 30;

			expect(state.toJson().hp.effectiveMax).toBe(20);
			expect(state.toJson().hp.effectiveMax).toBe(state.getMaxHp());
		});

		it("stays positive even for a level-less blank character", () => {
			// getMaxHp() floors at 1, so the field is never a clamp target of zero.
			expect(new CharacterSheetState().toJson().hp.effectiveMax).toBeGreaterThan(0);
		});
	});

	describe("effectiveMax is a one-way projection", () => {
		it("is stripped on load and never becomes a stored maximum", () => {
			const state = load({...FIGHTER_5, hp: {current: 30, max: 0, temp: 0, effectiveMax: 9999}});

			expect(state.toJson().hp.max).not.toBe(9999);
			expect(state.getMaxHp()).not.toBe(9999);
			expect(state.toJson().hp.max).toBe(state.getMaxHp());
		});

		it("rematerialises deterministically across repeated load -> toJson cycles", () => {
			// A derived value stored as an input would compound (item bonuses re-added each pass).
			let state = load({...FIGHTER_5, hp: {current: 30, max: 44, temp: 0}});
			const generations = [];
			for (let i = 0; i < 4; ++i) {
				const doc = state.toJson();
				generations.push({max: doc.hp.max, effectiveMax: doc.hp.effectiveMax, live: state.getMaxHp()});
				state = load(doc);
			}

			for (const generation of generations) {
				expect(generation).toEqual(generations[0]);
				expect(generation.effectiveMax).toBe(generation.live);
			}
		});
	});

	describe("live adoption preserves hit points", () => {
		const STRAINED_TALENT = Object.freeze({
			name: "Strained Talent",
			classes: [{name: "Talent", level: 10, subclass: null}],
			abilities: {str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 16},
			hp: {current: 60, max: 0, temp: 0},
			psionicStrain: {body: 7, mind: 0, soul: 0},
		});

		// Mirrors `CharacterSheet._adoptHubLiveCharacterData` and the post-save rebase, both of
		// which run `loadFromJson(F)` and then `_reconcileClassFeatures()`; the step inside that
		// reconcile which touches hit points is `applyClassFeatureEffects()`.
		function adopt (doc) {
			const state = new CharacterSheetState();
			state.loadFromJson(doc);
			state.applyClassFeatureEffects();
			return state;
		}

		it("retains current hit points above a strain-halved maximum across repeated adoption", () => {
			// Otherwise live state diverges from the adopted document and the next save persists
			// the accidental loss canonically.
			let doc = STRAINED_TALENT;
			for (let i = 0; i < 3; ++i) {
				const state = adopt(doc);
				doc = state.toJson();
				expect(doc.hp.current).toBe(60);
				expect(doc.hp.max).toBeGreaterThan(0);
				expect(doc.hp.effectiveMax).toBe(state.getMaxHp());
				expect(doc.hp.effectiveMax).toBeLessThan(doc.hp.current);
			}
		});

		it("still caps current hit points when no strain is halving the maximum", () => {
			const state = adopt({
				name: "Overfull",
				classes: [{name: "Fighter", level: 5, subclass: null}],
				abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8},
				hp: {current: 9999, max: 0, temp: 0},
			});

			const doc = state.toJson();
			expect(doc.hp.current).toBe(doc.hp.effectiveMax);
		});
	});

	describe("the current-HP cap uses the unhalved applicable maximum", () => {
		function strainedTalent () {
			const state = new CharacterSheetState();
			state.loadFromJson({
				name: "Strained Talent",
				classes: [{name: "Talent", level: 10, subclass: null}],
				abilities: {str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 16},
				hp: {current: 60, max: 0, temp: 0},
				psionicStrain: {body: 7, mind: 0, soul: 0},
			});
			return state;
		}

		it("enforces a permanent maximum reduction taken while strained, so a later heal cannot drop HP", () => {
			// Exempting strain from the cap entirely leaves current above the reduced maximum:
			// the sheet reads 60/42 once the halving ends, and the next ordinary heal silently
			// collapses it to 42. The reduction must bite when it is applied.
			const state = strainedTalent();
			const unhalvedBefore = state.getUnhalvedMaxHp();

			state.setMaxHpReduction(20);

			expect(state.getUnhalvedMaxHp()).toBe(unhalvedBefore - 20);
			expect(state.getCurrentHp()).toBe(state.getUnhalvedMaxHp());

			// Strain drops below the halving tier (body >= 4); nothing further may change.
			const afterReduction = state.getCurrentHp();
			state.removeStrain(4, "body");
			expect(state.getMaxHp()).toBe(afterReduction);
			expect(state.getCurrentHp()).toBe(afterReduction);

			state.heal(1);
			expect(state.getCurrentHp()).toBe(afterReduction);
		});

		it("does not cap merely because strain halves the maximum", () => {
			const state = strainedTalent();

			state._recalculateMaxHp();

			expect(state.getMaxHp()).toBeLessThan(60);
			expect(state.getCurrentHp()).toBe(60);
		});

		it("counts item max-HP bonuses in the unhalved maximum used for the cap", () => {
			const state = strainedTalent();
			state.addItem({
				id: "healthy-charm-hb",
				name: "Healthy Charm",
				source: "HB",
				effects: [{type: "maxHpBonus", value: 10, name: "Health"}],
				equipped: true,
				attuned: true,
				quantity: 1,
			});
			const withItem = state.getUnhalvedMaxHp();
			state.setHp(withItem, undefined, undefined);

			state._recalculateMaxHp();

			// The item bonus is part of the applicable maximum, so it must not be capped away.
			expect(state.getCurrentHp()).toBe(withItem);
			expect(withItem).toBeGreaterThan(state.getMaxHp());
		});
	});
});
