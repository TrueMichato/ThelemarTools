/**
 * Cross-surface parity: the Character Sheet, the DM Screen Party Tracker, and the server
 * projection must describe the same character the same way.
 *
 * This is the regression that stops the five implementations re-diverging. Before the shared
 * contract each of these surfaces computed capacity itself, and they disagreed in ways a user
 * could see: an inventory bar reading "Encumbered" beside a play-mode panel reading "normal",
 * and a DM Screen showing a Goliath a capacity their own sheet never showed them.
 */

import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {PartyTrackerCharacter} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-character.js";
import {PartyTrackerCharacterSerializer} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-serial.js";
import {buildCharacterViewModel} from "../../../server/src/character-projection.js";
import {resolveCarryAuthority} from "../../../js/hub/hub-carry-authority.js";
import {readFileSync} from "fs";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;

function mkSheet ({str = 16, size = "medium", thelemar = false, powerfulBuild = false, carried = 0} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setSetting("thelemar_carryWeight", thelemar);
	state.setAbilityBase("str", str);
	state.setSize(size);
	if (powerfulBuild) state.addCustomModifier?.({type: "carryCapacityMultiplier", value: 2});
	if (powerfulBuild) state._data.customModifiers.carryCapacityMultiplier = 2;
	if (carried) state.addItem({name: "Ballast", weight: carried});
	return state;
}

/** The Party Tracker's own view of the same character, entered manually. */
function mkTracker (sheet, {size = "medium", powerfulBuild = false} = {}) {
	const profile = sheet.getCarryProfile();
	const settings = PartyTrackerCharacterSerializer.deserializeSettings({
		et: true,
		tcw: profile.rule === "thelemar",
	});
	const data = PartyTrackerCharacterSerializer.deserialize({
		ab: {str: sheet.getAbilityScore("str"), dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		sz: size,
		pb: powerfulBuild,
		cw: profile.bodyLoad,
	});
	return new PartyTrackerCharacter(data, settings);
}

/** What the server would project for this sheet's document. */
function projectFrom (sheet) {
	const data = sheet.toJson();
	const expectedBasis = sheet.getCarryAuthorityBasis();
	// Sanity: the parity claim is meaningless if the authority itself is unusable.
	expect(resolveCarryAuthority({data, expectedBasis})).not.toBeNull();
	return buildCharacterViewModel(data, {expectedBasis}).carrySummary;
}

describe("sheet and server projection agree", () => {
	it.each([
		["standard, unmodified", {}],
		["standard, Large", {size: "large"}],
		["standard, Powerful Build", {powerfulBuild: true}],
		["standard, Tiny", {size: "tiny"}],
		["Thelemar, unmodified", {thelemar: true}],
		["Thelemar, Large", {thelemar: true, size: "large"}],
		["Thelemar, Huge + Powerful Build", {thelemar: true, size: "huge", powerfulBuild: true}],
		["loaded", {carried: 90}],
	])("%s", (_label, options) => {
		const sheet = mkSheet(options);
		const profile = sheet.getCarryProfile();
		expect(projectFrom(sheet)).toEqual({
			carried: profile.bodyLoad,
			capacity: profile.bodyCapacity,
		});
	});

	it("projects the SHEET's capacity, not one derived from Strength", () => {
		// The old projector computed STR x 15 x (powerfulBuild ? 2 : 1). A Thelemar Large
		// character is the case where that is most obviously wrong.
		const sheet = mkSheet({str: 16, thelemar: true, size: "large"});
		const summary = projectFrom(sheet);
		expect(summary.capacity).toBe(sheet.getCarryProfile().bodyCapacity);
		expect(summary.capacity).not.toBe(16 * 15);
	});
});

describe("sheet and Party Tracker agree", () => {
	it.each([
		["standard, unmodified", {}, {}],
		["standard, Large", {size: "large"}, {size: "large"}],
		["standard, Powerful Build", {powerfulBuild: true}, {powerfulBuild: true}],
		["Thelemar, unmodified", {thelemar: true}, {}],
		["Thelemar, Large", {thelemar: true, size: "large"}, {size: "large"}],
	])("%s", (_label, sheetOptions, trackerOptions) => {
		const sheet = mkSheet(sheetOptions);
		const tracker = mkTracker(sheet, trackerOptions);
		expect(tracker.getCarryCapacity()).toBe(sheet.getCarryProfile().bodyCapacity);
	});

	it("the Party Tracker now honours creature size, which it previously ignored entirely", () => {
		const sheet = mkSheet({str: 16, size: "large"});
		const withSize = mkTracker(sheet, {size: "large"});
		const withoutSize = mkTracker(sheet, {size: "medium"});
		expect(withSize.getCarryCapacity()).toBe(480);
		// The old behaviour: a Large character silently measured as Medium.
		expect(withoutSize.getCarryCapacity()).toBe(240);
	});

	it("agrees on the encumbrance level, not merely on capacity", () => {
		const sheet = mkSheet({str: 16, carried: 100});
		const tracker = mkTracker(sheet);
		expect(sheet.getEncumbranceLevel()).toBe("encumbered");
		expect(tracker.getCarryState().level).toBe("encumbered");
	});
});

describe("the sheet no longer contradicts itself", () => {
	// The historical bug: `_updateEncumbrance()` judged the inventory bar on STR x 5 while
	// `getEncumbranceLevel()` -- which play mode and the PDF read -- used 50% of capacity.
	// At STR 16 with 100 lb carried, the bar said "Encumbered" and play mode said "normal".
	it("the inventory bar, play mode, and the PDF report the same level", () => {
		const sheet = mkSheet({str: 16, carried: 100});
		const breakdown = sheet.getCarryingCapacityBreakdown();

		// The inventory bar renders `breakdown.status`; play mode and the PDF call
		// `getEncumbranceLevel()`. One source now backs both.
		expect(breakdown.status).toBe("encumbered");
		expect(sheet.getEncumbranceLevel()).toBe(breakdown.status);
	});

	it("no consumer recomputes thresholds from the Strength score any more", () => {
		const inventorySrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-inventory.js"), "utf8");
		expect(inventorySrc).not.toMatch(/strScore\s*\*\s*5/);
		expect(inventorySrc).not.toMatch(/strScore\s*\*\s*10/);
		expect(inventorySrc).toContain("carryBreakdown.status");
	});

	it("the Party Tracker no longer carries its own capacity formula", () => {
		const trackerSrc = readFileSync(resolve(REPO_ROOT, "js/dmscreen/partytracker/dmscreen-partytracker-character.js"), "utf8");
		expect(trackerSrc).not.toMatch(/\*\s*15\s*\*\s*mult/);
		expect(trackerSrc).not.toMatch(/passiveMight\s*\*\s*10/);
		expect(trackerSrc).toContain("getCarryProfile");
	});
});

describe("privacy", () => {
	it("the projection exposes only the body pair, never formula factors", () => {
		const sheet = mkSheet({str: 18, thelemar: true, size: "large", powerfulBuild: true, carried: 40});
		expect(Object.keys(projectFrom(sheet)).sort()).toEqual(["capacity", "carried"]);
	});

	it("a Bag of Holding does not leak through the projection", () => {
		const sheet = mkSheet({str: 16});
		sheet.addItem({
			name: "Bag of Holding",
			source: "XDMG",
			weight: 15,
			containerCapacity: {weight: [500], weightless: true},
			equipped: true,
			quantity: 1,
		});

		const summary = projectFrom(sheet);
		const profile = sheet.getCarryProfile();
		expect(profile.hasExtradimensional).toBe(true);
		// The body pair is internally coherent and says nothing about the container: a peer
		// cannot tell from `{carried, capacity}` that this character owns one.
		expect(summary).toEqual({carried: profile.bodyLoad, capacity: profile.bodyCapacity});
		expect(summary.capacity).not.toBe(profile.total);
	});

	it("the carry authority block carries no item names", () => {
		const sheet = mkSheet({str: 16});
		sheet.addItem({name: "Letter of Marque", weight: 1});
		expect(JSON.stringify(sheet.toJson().carry)).not.toContain("Letter of Marque");
	});
});
