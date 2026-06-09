/**
 * Zodiac Form picker view (round-5 Bug #8) — MECHANICS.
 *
 * Previously BOTH combat-tab Druid buttons ("Choose Zodiac Form…" and a
 * redundant "Manage Druid Resources") called druid.openModal(), which renders
 * the WHOLE Druid Resources panel (Wild Shape + Wild Companion + Zodiac). The
 * fix:
 *  - openZodiacPicker() opens a FOCUSED view (`_modalMode === "zodiac"`) that
 *    renders ONLY the constellation section — distinct from the full panel.
 *  - the combat-tab "Choose Zodiac Form…" button is wired to openZodiacPicker().
 *  - the redundant combat-tab "Manage Druid Resources" button is REMOVED (the
 *    full panel stays reachable from the header / features-tab entry points).
 *
 * The modal open path needs live modal infra (UiUtil), so these tests drive the
 * render branch directly: _renderModalBody honours _modalMode, rendering only
 * the zodiac section in "zodiac" mode and the full set in "full" mode.
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirnameLocal, "../../..");

let CharacterSheetState;
let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;
});

function makeZodiacDruid (level = 3) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
	});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current: 2, max: 2, recharge: "short"}});
	return state;
}

function makeModule (state, extra = {}) {
	const page = {getState: () => state, ...extra};
	return new CharacterSheetDruidResources(page);
}

/** A controllable stand-in for the modal body element. */
function makeFakeBody () {
	const appended = [];
	return {
		appended,
		innerHTML: "x",
		appendChild (node) { appended.push(node); },
	};
}

describe("#8 — openZodiacPicker yields a zodiac-only view distinct from full-manage", () => {
	it("exposes openZodiacPicker as a public method", () => {
		const druid = makeModule(makeZodiacDruid(3));
		expect(typeof druid.openZodiacPicker).toBe("function");
	});

	it("in zodiac mode, _renderModalBody renders ONLY the zodiac section", () => {
		const druid = makeModule(makeZodiacDruid(3));
		const zodiacSentinel = {__section: "zodiac"};
		let wildShapeCalled = false;
		let wildCompanionCalled = false;
		druid._renderWildShapeSection = () => { wildShapeCalled = true; return {__section: "wildshape"}; };
		druid._renderWildCompanionSection = () => { wildCompanionCalled = true; return {__section: "wildcompanion"}; };
		druid._renderZodiacSection = () => zodiacSentinel;

		const body = makeFakeBody();
		druid._modalBody = body;
		druid._modalMode = "zodiac";
		druid._renderModalBody();

		// Only the zodiac section was appended; Wild Shape / Wild Companion were NOT.
		expect(body.appended).toEqual([zodiacSentinel]);
		expect(wildShapeCalled).toBe(false);
		expect(wildCompanionCalled).toBe(false);
	});

	it("in full mode, _renderModalBody renders Wild Shape + Wild Companion + Zodiac", () => {
		const druid = makeModule(makeZodiacDruid(3));
		let wildShapeCalled = false;
		let zodiacCalled = false;
		druid._renderWildShapeSection = () => { wildShapeCalled = true; return {__section: "wildshape"}; };
		druid._renderZodiacSection = () => { zodiacCalled = true; return {__section: "zodiac"}; };
		druid._renderWildCompanionSection = () => ({__section: "wildcompanion"});

		const body = makeFakeBody();
		druid._modalBody = body;
		druid._modalMode = "full";
		druid._renderModalBody();

		// The full view includes the Wild Shape section AND the zodiac section.
		expect(wildShapeCalled).toBe(true);
		expect(zodiacCalled).toBe(true);
		expect(body.appended.length).toBeGreaterThanOrEqual(2);
		expect(body.appended).toContainEqual({__section: "wildshape"});
		expect(body.appended).toContainEqual({__section: "zodiac"});
	});

	it("openModal sets full mode and openZodiacPicker sets zodiac mode (source contract)", () => {
		// Verified structurally — the open* methods need live modal infra (UiUtil)
		// that isn't available DOM-free; the mode flag is the behavioural contract.
		const moduleSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-druid-resources.js"), "utf8");
		expect(moduleSrc).toMatch(/openModal\s*\(\)\s*\{[\s\S]*?this\._modalMode\s*=\s*"full"/);
		expect(moduleSrc).toMatch(/openZodiacPicker\s*\(\)\s*\{[\s\S]*?this\._modalMode\s*=\s*"zodiac"/);
	});
});

describe("#8 — combat-tab wiring: zodiac-choose → picker, manage button removed", () => {
	const combatSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

	it("the redundant 'Manage Druid Resources' combat button is gone", () => {
		expect(combatSrc).not.toMatch(/charsheet__combat-druid-manage/);
	});

	it("the Choose Zodiac Form… button routes to openZodiacPicker(), NOT openModal()", () => {
		// The zodiac-choose click handler calls openZodiacPicker.
		expect(combatSrc).toMatch(/charsheet__combat-druid-zodiac-choose"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*druid\.openZodiacPicker\(\)\)/);
		// And there is no longer a combat-tab listener that opens the full modal.
		expect(combatSrc).not.toMatch(/druid\.openModal\(\)/);
	});
});
