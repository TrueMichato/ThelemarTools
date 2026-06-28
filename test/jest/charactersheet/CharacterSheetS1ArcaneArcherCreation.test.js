/**
 * S1 — Arcane Archer CREATION path (non-migration) guard.
 *
 * The `_migrateRepairSubclass` load migration heals stale saves whose
 * `cls.subclass === null`. This suite guards against the migration MASKING a
 * live creation bug: it proves that
 *   (a) freshly-created in-memory state (never passed through `loadFromJson`,
 *       so the migration never runs) resolves the Arcane Archer subclass and
 *       lights up `hasArcaneShot()`; and
 *   (b) the real creation code (builder + level-up wizard) writes
 *       `cls.subclass` when the subclass is chosen.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let CharacterSheetState;

const BUILDER_SRC = readFileSync(resolve(__dirname, "../../../js/charactersheet/charactersheet-builder.js"), "utf8");
const LEVELUP_SRC = readFileSync(resolve(__dirname, "../../../js/charactersheet/charactersheet-levelup.js"), "utf8");

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("S1 Arcane Archer creation path (non-migration)", () => {
	// =========================================================================
	// (a) Fresh state — no loadFromJson, so the migration cannot run
	// =========================================================================
	it("sets cls.subclass via the real setSubclass API and lights up hasArcaneShot", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9, hitDice: "d10"});
		state.setAbilityBase("con", 16);

		// Real product API the wizard/respec use to assign a subclass.
		state.setSubclass("Fighter", {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"});

		const cls = state.getClasses()[0];
		expect(cls.subclass).toBeTruthy();
		expect(cls.subclass.shortName).toBe("Arcane Archer");
		// The migration never ran (no loadFromJson) — the detector works purely
		// off the live cls.subclass write.
		expect(state.hasArcaneShot()).toBe(true);
		expect(state.getArcaneShotMax()).toBe(state.getProficiencyBonus());
	});

	it("the effective-subclass resolver returns the live cls.subclass unchanged", () => {
		const state = new CharacterSheetState();
		const sub = {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"};
		state.addClass({name: "Fighter", source: "TGTT", level: 3, subclass: sub});
		expect(state.getEffectiveSubclassForClass(state.getClasses()[0])).toBe(sub);
	});

	// =========================================================================
	// (b) Live creation code writes cls.subclass when chosen
	// =========================================================================
	it("the builder writes cls.subclass from the selected subclass", () => {
		// The builder constructs the class entry with `subclass: this._selectedSubclass ? {…} : null`.
		expect(BUILDER_SRC).toMatch(/subclass:\s*this\._selectedSubclass\s*\?\s*\{/);
	});

	it("the level-up wizard writes targetClass.subclass when a subclass is selected", () => {
		// _applyLevelUp must, when selectedSubclass is truthy, assign targetClass.subclass.
		const applyIdx = LEVELUP_SRC.indexOf("async _applyLevelUp (");
		expect(applyIdx).toBeGreaterThan(-1);
		const applyBody = LEVELUP_SRC.slice(applyIdx, applyIdx + 4000);
		expect(applyBody).toMatch(/if\s*\(selectedSubclass\)\s*\{/);
		expect(applyBody).toMatch(/targetClass\.subclass\s*=\s*\{/);
	});
});
