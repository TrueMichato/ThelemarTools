/**
 * Character Sheet Portrait Focal-Point / Zoom - Unit Tests
 * Covers the two new appearance fields (defaults + serialization round-trip)
 * and the object-position / zoom sanitizers used before applying/persisting.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheet portrait focal-point / zoom", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("appearance defaults", () => {
		it("defaults portraitObjectPosition to 'center center'", () => {
			expect(state.getAppearance("portraitObjectPosition")).toBe("center center");
		});

		it("defaults portraitZoom to 1", () => {
			expect(state.getAppearance("portraitZoom")).toBe(1);
		});
	});

	describe("serialization round-trip", () => {
		it("persists the new fields through toJson/loadFromJson", () => {
			state.setAppearance("portraitUrl", "data:image/png;base64,abc123");
			state.setAppearance("portraitObjectPosition", "35% 40%");
			state.setAppearance("portraitZoom", 1.75);

			const json = state.toJson();
			const restored = new CharacterSheetState();
			restored.loadFromJson(json);

			expect(restored.getAppearance("portraitObjectPosition")).toBe("35% 40%");
			expect(restored.getAppearance("portraitZoom")).toBe(1.75);
		});

		it("loads a legacy save lacking the new fields using defaults", () => {
			const legacy = state.toJson();
			// Simulate an older save with no framing fields.
			delete legacy.appearance.portraitObjectPosition;
			delete legacy.appearance.portraitZoom;

			const restored = new CharacterSheetState();
			restored.loadFromJson(legacy);

			expect(restored.getAppearance("portraitObjectPosition")).toBe("center center");
			expect(restored.getAppearance("portraitZoom")).toBe(1);
		});
	});

	describe("sanitizers", () => {
		let pm;
		beforeEach(() => {
			pm = new CharacterSheetPlayMode({getState: () => state});
		});

		it("accepts valid percentage positions and clamps to 0-100", () => {
			expect(pm._sanitizePortraitPosition("35% 40%")).toBe("35% 40%");
			expect(pm._sanitizePortraitPosition("150% -10%")).toBe("center center"); // negative token invalid
			expect(pm._sanitizePortraitPosition("120% 40%")).toBe("100% 40%");
		});

		it("accepts keyword positions", () => {
			expect(pm._sanitizePortraitPosition("left top")).toBe("left top");
			expect(pm._sanitizePortraitPosition("center")).toBe("center center");
		});

		it("rejects unsafe position strings", () => {
			expect(pm._sanitizePortraitPosition("url(x);background:red")).toBe("center center");
			expect(pm._sanitizePortraitPosition("50%;expression(alert(1))")).toBe("center center");
			expect(pm._sanitizePortraitPosition(null)).toBe("center center");
			expect(pm._sanitizePortraitPosition(42)).toBe("center center");
		});

		it("clamps zoom to the 1-3 range and coerces invalid values", () => {
			expect(pm._sanitizePortraitZoom(1.5)).toBe(1.5);
			expect(pm._sanitizePortraitZoom(0.2)).toBe(1);
			expect(pm._sanitizePortraitZoom(9)).toBe(3);
			expect(pm._sanitizePortraitZoom("abc")).toBe(1);
			expect(pm._sanitizePortraitZoom(NaN)).toBe(1);
			expect(pm._sanitizePortraitZoom(2.005)).toBe(2.01);
		});
	});
});
