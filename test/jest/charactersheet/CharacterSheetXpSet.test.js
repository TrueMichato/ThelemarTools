import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetState = globalThis.CharacterSheetState;

if (!globalThis.Parser.LEVEL_XP_REQUIRED) {
	globalThis.Parser.LEVEL_XP_REQUIRED = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
}

/*
 * Bug #4 — XP could only be ADDED. Players now also need to SET total XP.
 *
 * The controller (charactersheet.js) is too global-heavy to import in jest,
 * so we replicate the two handlers byte-faithfully (pinned to source below)
 * and drive them against a real CharacterSheetState plus a stub input. This
 * proves the actual routing: Add increments, Set replaces.
 */

// Byte-faithful replicas of the production handlers (see source-pin tests).
function makeHarness () {
	const state = new CharacterSheetState();
	const ipt = {value: 0};
	const calls = {save: 0, renderXp: 0, renderBanner: 0};

	const ctx = {
		_state: state,
		_getIpt: () => ipt,
		_saveCurrentCharacter () { calls.save++; },
		_renderXpTracking () { calls.renderXp++; },
		_renderLevelUpBanner () { calls.renderBanner++; },

		_onXpAdd () {
			const iptXpAdd = this._getIpt();
			const rawXpToAdd = iptXpAdd.value;
			const xpToAdd = Math.max(0, Math.floor(Number(rawXpToAdd) || 0));
			if (!xpToAdd) return;
			this._state.addXp(xpToAdd);
			iptXpAdd.value = 0;
			this._saveCurrentCharacter();
			this._renderXpTracking();
			this._renderLevelUpBanner();
		},

		_onXpSet () {
			const iptXpAdd = this._getIpt();
			const rawXp = `${iptXpAdd.value}`.trim();
			if (rawXp === "") return;
			const xp = Math.max(0, Math.floor(Number(rawXp) || 0));
			this._state.setXp(xp);
			iptXpAdd.value = 0;
			this._saveCurrentCharacter();
			this._renderXpTracking();
			this._renderLevelUpBanner();
		},
	};

	return {state, ipt, calls, ctx};
}

describe("Bug #4 — Set total XP (in addition to Add)", () => {
	describe("source-pin: production handlers route to the right state mutator", () => {
		const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

		it("_onXpSet exists, guards an empty field BEFORE mutating, and calls state.setXp(xp)", () => {
			const m = SOURCE.match(/_onXpSet\s*\(\)\s*\{[\s\S]*?\n\t\}/);
			expect(m).not.toBeNull();
			const body = m[0];
			// Empty-field guard must run BEFORE the state mutation, and must set the
			// computed `xp` (not a raw/wrong variable) so clamping/flooring applies.
			expect(body).toMatch(/rawXp\s*===\s*""\)\s*return;[\s\S]*?this\._state\.setXp\(xp\)/);
			expect(body).toMatch(/this\._renderXpTracking\(\)/);
			expect(body).toMatch(/this\._renderLevelUpBanner\(\)/);
		});

		it("the Set button exists in charactersheet.html beside the XP input", () => {
			const html = readFileSync(resolve(REPO_ROOT, "charactersheet.html"), "utf8");
			expect(html).toMatch(/id="charsheet-btn-xp-set"/);
			// Keep Add too — both affordances share the same input.
			expect(html).toMatch(/id="charsheet-btn-xp-add"/);
			expect(html).toMatch(/id="charsheet-ipt-xp-add"/);
		});

		it("_onXpAdd still calls state.addXp (Add preserved)", () => {
			const m = SOURCE.match(/_onXpAdd\s*\(\)\s*\{[\s\S]*?\n\t\}/);
			expect(m).not.toBeNull();
			expect(m[0]).toMatch(/this\._state\.addXp\(/);
		});

		it("the Set button is wired to _onXpSet", () => {
			expect(SOURCE).toMatch(/charsheet-btn-xp-set"\)\.addEventListener\("click",\s*\(\)\s*=>\s*this\._onXpSet\(\)\)/);
		});
	});

	describe("behaviour: Add increments, Set replaces", () => {
		it("Set replaces the running total (does NOT add)", () => {
			const {state, ipt, ctx} = makeHarness();
			state.setXp(900);
			expect(state.getXp()).toBe(900);

			ipt.value = 300;
			ctx._onXpSet();

			expect(state.getXp()).toBe(300); // replaced, not 1200
			expect(ipt.value).toBe(0);
		});

		it("Add increments the running total", () => {
			const {state, ipt, ctx} = makeHarness();
			state.setXp(900);

			ipt.value = 300;
			ctx._onXpAdd();

			expect(state.getXp()).toBe(1200);
			expect(ipt.value).toBe(0);
		});

		it("Set to 0 is allowed (explicit clear) and re-renders", () => {
			const {state, ipt, calls, ctx} = makeHarness();
			state.setXp(5000);

			ipt.value = 0;
			ctx._onXpSet();

			expect(state.getXp()).toBe(0);
			expect(calls.save).toBe(1);
			expect(calls.renderXp).toBe(1);
			expect(calls.renderBanner).toBe(1);
		});

		it("Set ignores a truly empty field (no accidental clear)", () => {
			const {state, ipt, calls, ctx} = makeHarness();
			state.setXp(5000);

			ipt.value = "";
			ctx._onXpSet();

			expect(state.getXp()).toBe(5000); // unchanged
			expect(calls.save).toBe(0);
		});

		it("Add ignores a zero/empty field (existing no-op preserved)", () => {
			const {state, ipt, calls, ctx} = makeHarness();
			state.setXp(900);

			ipt.value = 0;
			ctx._onXpAdd();

			expect(state.getXp()).toBe(900);
			expect(calls.save).toBe(0);
		});

		it("Set clamps negatives and floors fractions (via state.setXp)", () => {
			const {state, ipt, ctx} = makeHarness();

			ipt.value = -50;
			ctx._onXpSet();
			expect(state.getXp()).toBe(0);

			ipt.value = 1234.9;
			ctx._onXpSet();
			expect(state.getXp()).toBe(1234);
		});
	});
});
