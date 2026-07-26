import {BestiaryWideModeUtil} from "../../js/bestiary/bestiary-wide-mode-util.js";

describe("BestiaryWideModeUtil.isWideModeActive", () => {
	it("is active only when toggled on AND the viewport is wide", () => {
		expect(BestiaryWideModeUtil.isWideModeActive({isToggledOn: true, isViewportWide: true})).toBe(true);
	});

	it("is inactive when toggled off", () => {
		expect(BestiaryWideModeUtil.isWideModeActive({isToggledOn: false, isViewportWide: true})).toBe(false);
	});

	it("is inactive when the viewport is too narrow", () => {
		expect(BestiaryWideModeUtil.isWideModeActive({isToggledOn: true, isViewportWide: false})).toBe(false);
	});

	it("coerces falsy inputs to a boolean false", () => {
		expect(BestiaryWideModeUtil.isWideModeActive({isToggledOn: undefined, isViewportWide: undefined})).toBe(false);
	});
});

describe("BestiaryWideModeUtil.getButtonState", () => {
	it("is off + not muted with the default tooltip when the toggle is off", () => {
		const state = BestiaryWideModeUtil.getButtonState({isToggledOn: false, isViewportWide: true, hasFluff: true});
		expect(state.isActive).toBe(false);
		expect(state.isMuted).toBe(false);
		expect(state.title).toContain("side-by-side");
	});

	it("is active + not muted when on, wide, and the creature has fluff", () => {
		const state = BestiaryWideModeUtil.getButtonState({isToggledOn: true, isViewportWide: true, hasFluff: true});
		expect(state.isActive).toBe(true);
		expect(state.isMuted).toBe(false);
	});

	it("is muted with a viewport-width tooltip when on but the viewport is too narrow", () => {
		const state = BestiaryWideModeUtil.getButtonState({isToggledOn: true, isViewportWide: false, hasFluff: true});
		expect(state.isActive).toBe(true);
		expect(state.isMuted).toBe(true);
		expect(state.title).toContain("1600px");
	});

	it("is muted with a no-fluff tooltip when on and wide but the creature has no lore", () => {
		const state = BestiaryWideModeUtil.getButtonState({isToggledOn: true, isViewportWide: true, hasFluff: false});
		expect(state.isActive).toBe(true);
		expect(state.isMuted).toBe(true);
		expect(state.title).toContain("no lore");
	});

	it("prioritises the viewport-width tooltip when both gates fail", () => {
		const state = BestiaryWideModeUtil.getButtonState({isToggledOn: true, isViewportWide: false, hasFluff: false});
		expect(state.isMuted).toBe(true);
		expect(state.title).toContain("1600px");
	});
});
