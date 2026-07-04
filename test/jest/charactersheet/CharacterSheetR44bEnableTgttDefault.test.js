/**
 * Bug 2 (R44-b) — `enableTgtt` master flag default + load migration.
 *
 * Divine Favor (and other TGTT-gated subsystems) render only when
 * `settings.enableTgtt` is truthy. The flag was absent from the default state and
 * `loadFromJson` gives `settings` no nested default merge, so both new sheets and
 * old saves had `enableTgtt` undefined → falsy → Divine Favor never appeared.
 *
 * This verifies the state-layer root fix:
 *   - new sheets default `enableTgtt: true`;
 *   - loading a save that lacks the key backfills it to `true`;
 *   - an explicit opt-out (`false`) is preserved.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Bug 2 — enableTgtt default + migration", () => {
	test("a fresh character defaults settings.enableTgtt to true", () => {
		const state = new CharacterSheetState();
		expect(state.getSettings().enableTgtt).toBe(true);
	});

	test("loading a save WITHOUT enableTgtt backfills it to true", () => {
		const state = new CharacterSheetState();
		// A legacy save: settings present (TGTT-ish) but predating the master flag.
		state.loadFromJson({
			name: "Legacy Thelemar Hero",
			settings: {
				exhaustionRules: "thelemar",
				prioritySources: ["TGTT"],
				thelemar_linguisticsBonus: true,
			},
		});
		expect(state.getSettings().enableTgtt).toBe(true);
	});

	test("loading a save WITHOUT any settings object still defaults enableTgtt to true", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({name: "No Settings"});
		expect(state.getSettings().enableTgtt).toBe(true);
	});

	test("an explicit enableTgtt:false opt-out is preserved on load", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			name: "Non-TGTT Character",
			settings: {exhaustionRules: "2024", enableTgtt: false},
		});
		expect(state.getSettings().enableTgtt).toBe(false);
	});

	test("the migration is idempotent (explicit true stays true)", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({settings: {enableTgtt: true}});
		state._migrateEnableTgttDefault();
		state._migrateEnableTgttDefault();
		expect(state.getSettings().enableTgtt).toBe(true);
	});
});
