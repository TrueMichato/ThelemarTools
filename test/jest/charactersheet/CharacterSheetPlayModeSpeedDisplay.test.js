/**
 * Play-mode speed display — speed is always in feet, so the redundant "ft"
 * suffix is dropped everywhere a speed VALUE is shown. Covers the _fmtSpeed
 * single-source-of-truth helper and the production _renderVitals path (which
 * must hand the vital-chip renderer a unitless speed value).
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const makePlayMode = (state) => new CharacterSheetPlayMode({getState: () => state});

describe("Play mode speed display", () => {
	describe("_fmtSpeed", () => {
		let pm;
		beforeEach(() => { pm = makePlayMode(new CharacterSheetState()); });

		it("renders a bare number with no unit suffix", () => {
			expect(pm._fmtSpeed(30)).toBe("30");
			expect(pm._fmtSpeed(30)).not.toMatch(/ft/i);
		});

		it("renders zero speed as '0' (never an empty or fallback value)", () => {
			expect(pm._fmtSpeed(0)).toBe("0");
		});

		it("returns an empty string for null/undefined", () => {
			expect(pm._fmtSpeed(undefined)).toBe("");
			expect(pm._fmtSpeed(null)).toBe("");
		});

		it("defensively strips a trailing ft/ft. if a pre-formatted value arrives", () => {
			expect(pm._fmtSpeed("30 ft.")).toBe("30");
			expect(pm._fmtSpeed("25ft")).toBe("25");
		});
	});

	describe("_renderVitals", () => {
		// Capture the values handed to the vital-chip renderer without needing a
		// real DOM (the suite runs in the node environment).
		const renderVitalsCapture = (state) => {
			const pm = makePlayMode(state);
			const chips = [];
			pm._ce = () => ({});
			pm._renderHpBar = () => {};
			pm._renderVitalChip = (parent, icon, value, label) => chips.push({icon, value, label});
			pm._renderVitals({});
			return chips;
		};

		it("passes the walk speed as a unitless number to the Speed chip", () => {
			const state = new CharacterSheetState();
			state.setSpeed("walk", 30);
			const chips = renderVitalsCapture(state);

			const speedChip = chips.find(c => c.label === "Speed");
			expect(speedChip).toBeTruthy();
			expect(speedChip.value).toBe("30");
			expect(speedChip.value).not.toMatch(/ft/i);
		});

		it("passes additional speed types (fly) without a unit suffix", () => {
			const state = new CharacterSheetState();
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 60);
			const chips = renderVitalsCapture(state);

			const flyChip = chips.find(c => c.label === "Fly");
			expect(flyChip).toBeTruthy();
			expect(flyChip.value).toBe("60");
			expect(flyChip.value).not.toMatch(/ft/i);
		});

		it("never hands any vital chip a value containing 'ft'", () => {
			const state = new CharacterSheetState();
			state.setSpeed("walk", 25);
			state.setSpeed("swim", 25);
			const chips = renderVitalsCapture(state);
			chips.forEach(c => expect(String(c.value)).not.toMatch(/ft/i));
		});
	});

	describe("_showBreakdown('speed') toast", () => {
		let prevJqueryUtil;
		let toast;
		beforeEach(() => {
			prevJqueryUtil = globalThis.JqueryUtil;
			toast = jest.fn();
			globalThis.JqueryUtil = {doToast: toast};
		});
		afterEach(() => { globalThis.JqueryUtil = prevJqueryUtil; });

		it("always lists Walk (even at the default) and uses no 'ft' unit", () => {
			const state = new CharacterSheetState();
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 60);
			const pm = makePlayMode(state);

			pm._showBreakdown("speed");

			expect(toast).toHaveBeenCalledTimes(1);
			const content = toast.mock.calls[0][0].content;
			expect(content).toContain("Walk: 30");
			expect(content).toContain("Fly: 60");
			expect(content).not.toMatch(/ft/i);
		});

		it("still shows a Walk line for a default character (no empty toast)", () => {
			const state = new CharacterSheetState(); // walk unset → getSpeed('walk') === 0
			const pm = makePlayMode(state);

			pm._showBreakdown("speed");

			expect(toast).toHaveBeenCalledTimes(1);
			expect(toast.mock.calls[0][0].content).toContain("Walk: 30");
		});
	});
});
