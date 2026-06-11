/**
 * #3 — Save dice customization as named presets.
 *
 * Players can save the current dice look (theme + material + texture +
 * face/number colours + sound volume) as a NAMED preset, then list / apply /
 * delete presets. Presets persist as a `dicePresets` array via the settings
 * bag (`getSettings`/`setSetting`), with a backward-compatible default of `[]`,
 * and must round-trip through `toJson`/`loadFromJson` with NO schema break.
 *
 * The controller (charactersheet.js) is too global-heavy to import in jest, so
 * we drive byte-faithful replicas of the preset methods against a REAL
 * CharacterSheetState, and source-pin them to production.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetState = globalThis.CharacterSheetState;

const DICE_PRESET_KEYS = ["diceTheme", "diceMaterial", "diceTexture", "diceCustomColor", "diceColor", "diceColorText", "diceSoundVolume"];

// Byte-faithful replicas of the production preset methods (see source-pin tests).
function makeHarness () {
	const state = new CharacterSheetState();
	const calls = {save: 0, render: 0};

	const ctx = {
		_state: state,
		_saveCurrentCharacter () { calls.save++; },
		_renderDicePresets () { calls.render++; },

		_getDicePresets () {
			const settings = this._state?.getSettings?.() || {};
			return Array.isArray(settings.dicePresets) ? settings.dicePresets : [];
		},

		_saveDicePreset (rawName) {
			const name = String(rawName || "").trim();
			if (!name) return false;
			const settings = this._state?.getSettings?.() || {};
			const captured = {};
			for (const k of DICE_PRESET_KEYS) captured[k] = settings[k] ?? null;
			const presets = this._getDicePresets().slice();
			const ix = presets.findIndex(p => p && String(p.name).trim().toLowerCase() === name.toLowerCase());
			const entry = {name, settings: captured};
			if (~ix) presets.splice(ix, 1);
			presets.unshift(entry);
			this._state.setSetting("dicePresets", presets);
			this._saveCurrentCharacter();
			this._renderDicePresets();
			return true;
		},

		_applyDicePreset (name) {
			const preset = this._getDicePresets().find(p => p && String(p.name).trim().toLowerCase() === String(name || "").trim().toLowerCase());
			if (!preset || !preset.settings) return false;
			for (const k of DICE_PRESET_KEYS) {
				this._state.setSetting(k, preset.settings[k] ?? null);
			}
			this._saveCurrentCharacter();
			return true;
		},

		_deleteDicePreset (name) {
			const presets = this._getDicePresets();
			const next = presets.filter(p => !(p && String(p.name).trim().toLowerCase() === String(name || "").trim().toLowerCase()));
			if (next.length === presets.length) return false;
			this._state.setSetting("dicePresets", next);
			this._saveCurrentCharacter();
			this._renderDicePresets();
			return true;
		},
	};

	return {state, calls, ctx};
}

describe("#3 — dice customization presets", () => {
	test("getDicePresets defaults to [] (backward-compatible for old saves)", () => {
		const {ctx} = makeHarness();
		expect(ctx._getDicePresets()).toEqual([]);
	});

	test("saveDicePreset captures the current dice look", () => {
		const {state, ctx, calls} = makeHarness();
		state.setSetting("diceTheme", "dragon");
		state.setSetting("diceMaterial", "metal");
		state.setSetting("diceTexture", "dragon");
		state.setSetting("diceCustomColor", true);
		state.setSetting("diceColor", "#ff3300");
		state.setSetting("diceColorText", "#ffffff");
		state.setSetting("diceSoundVolume", 0.5);

		expect(ctx._saveDicePreset("Fire Drake")).toBe(true);
		const presets = ctx._getDicePresets();
		expect(presets.length).toBe(1);
		expect(presets[0].name).toBe("Fire Drake");
		expect(presets[0].settings).toEqual({
			diceTheme: "dragon",
			diceMaterial: "metal",
			diceTexture: "dragon",
			diceCustomColor: true,
			diceColor: "#ff3300",
			diceColorText: "#ffffff",
			diceSoundVolume: 0.5,
		});
		expect(calls.save).toBe(1);
		expect(calls.render).toBe(1);
	});

	test("empty/whitespace names are rejected", () => {
		const {ctx} = makeHarness();
		expect(ctx._saveDicePreset("")).toBe(false);
		expect(ctx._saveDicePreset("   ")).toBe(false);
		expect(ctx._getDicePresets()).toEqual([]);
	});

	test("saving the same name (case-insensitive) upserts rather than duplicating", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceColor", "#ff0000");
		ctx._saveDicePreset("Crimson");
		state.setSetting("diceColor", "#00ff00");
		ctx._saveDicePreset("crimson"); // same name, different case
		const presets = ctx._getDicePresets();
		expect(presets.length).toBe(1);
		expect(presets[0].name).toBe("crimson");
		expect(presets[0].settings.diceColor).toBe("#00ff00");
	});

	test("new presets are PREPENDED (newest-first ordering)", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceColor", "#111111");
		ctx._saveDicePreset("First");
		ctx._saveDicePreset("Second");
		ctx._saveDicePreset("Third");
		expect(ctx._getDicePresets().map(p => p.name)).toEqual(["Third", "Second", "First"]);
	});

	test("re-saving an existing name moves it to the TOP (upsert + reorder)", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceColor", "#111111");
		ctx._saveDicePreset("A");
		ctx._saveDicePreset("B");
		ctx._saveDicePreset("C");
		expect(ctx._getDicePresets().map(p => p.name)).toEqual(["C", "B", "A"]);

		// Re-save "A" with a new colour: it should jump to the top, not duplicate.
		state.setSetting("diceColor", "#222222");
		ctx._saveDicePreset("a"); // case-insensitive match
		const presets = ctx._getDicePresets();
		expect(presets.map(p => p.name)).toEqual(["a", "C", "B"]);
		expect(presets.length).toBe(3);
		expect(presets[0].settings.diceColor).toBe("#222222");
	});

	test("applyDicePreset restores every captured setting", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceTheme", "toxic");
		state.setSetting("diceMaterial", "metal");
		state.setSetting("diceCustomColor", true);
		state.setSetting("diceColor", "#76c000");
		ctx._saveDicePreset("Ooze");

		// Mutate the live settings away from the preset.
		state.setSetting("diceTheme", "standard");
		state.setSetting("diceMaterial", null);
		state.setSetting("diceCustomColor", false);
		state.setSetting("diceColor", null);

		expect(ctx._applyDicePreset("Ooze")).toBe(true);
		const s = state.getSettings();
		expect(s.diceTheme).toBe("toxic");
		expect(s.diceMaterial).toBe("metal");
		expect(s.diceCustomColor).toBe(true);
		expect(s.diceColor).toBe("#76c000");
	});

	test("applyDicePreset returns false for an unknown name", () => {
		const {ctx} = makeHarness();
		expect(ctx._applyDicePreset("nope")).toBe(false);
	});

	test("deleteDicePreset removes by name and reports whether anything changed", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceColor", "#111111");
		ctx._saveDicePreset("A");
		ctx._saveDicePreset("B");
		expect(ctx._getDicePresets().length).toBe(2);

		expect(ctx._deleteDicePreset("A")).toBe(true);
		expect(ctx._getDicePresets().map(p => p.name)).toEqual(["B"]);

		expect(ctx._deleteDicePreset("does-not-exist")).toBe(false);
		expect(ctx._getDicePresets().length).toBe(1);
	});

	test("presets round-trip through toJson / loadFromJson with no schema break", () => {
		const {state, ctx} = makeHarness();
		state.setSetting("diceTheme", "astral");
		state.setSetting("diceCustomColor", true);
		state.setSetting("diceColor", "#3355ff");
		ctx._saveDicePreset("Starlight");

		const json = state.toJson();

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		const presets = reloaded.getSettings().dicePresets;
		expect(Array.isArray(presets)).toBe(true);
		expect(presets.length).toBe(1);
		expect(presets[0].name).toBe("Starlight");
		expect(presets[0].settings.diceTheme).toBe("astral");
		expect(presets[0].settings.diceColor).toBe("#3355ff");
	});

	test("a save with NO dicePresets field still loads (default [])", () => {
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson({}); // legacy / empty payload
		const settings = reloaded.getSettings();
		const presets = Array.isArray(settings.dicePresets) ? settings.dicePresets : [];
		expect(presets).toEqual([]);
	});
});

describe("#3 — source-pin: production methods exist", () => {
	const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

	test.each([
		"_getDicePresets ()",
		"_saveDicePreset (",
		"_applyDicePreset (",
		"_deleteDicePreset (",
		"_renderDicePresets ()",
	])("charactersheet.js defines %s", (sig) => {
		expect(SOURCE).toContain(sig);
	});

	test("the preset key list matches the harness", () => {
		expect(SOURCE).toContain(`_DICE_PRESET_KEYS = ["diceTheme", "diceMaterial", "diceTexture", "diceCustomColor", "diceColor", "diceColorText", "diceSoundVolume"]`);
	});

	test("presets persist under the 'dicePresets' settings key", () => {
		expect(SOURCE).toContain(`setSetting("dicePresets"`);
	});

	test("saveDicePreset PREPENDS new presets (unshift, not push)", () => {
		// The save path must drop any same-name entry then unshift, so the newest
		// preset lands at the TOP of the list and re-saves move to the top too.
		expect(SOURCE).toContain(`if (~ix) presets.splice(ix, 1);`);
		expect(SOURCE).toContain(`presets.unshift(entry);`);
		expect(SOURCE).not.toContain(`else presets.push(entry);`);
	});
});
