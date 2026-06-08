/**
 * Overview senses display + optional emoji speed labels (round 3).
 *
 * Covers the pure display helpers on CharacterSheetClassUtils (the testable
 * mechanics behind the Overview render):
 *  - parseSpeedString / buildSpeedDisplayParts: emoji-vs-word label mapping driven
 *    by the setting, lossless word-mode round-trip, exhaustion-suffix handling,
 *    multi-speed ordering, unknown-type fallback.
 *  - buildSensesDisplay: generic iteration over getSenses() output, zero/empty
 *    handling, canonical ordering, unknown-key safety (inert text).
 * Plus the settings contract for the new speedEmojiLabels flag: default ON when
 * absent, and a setSetting → toJson → loadFromJson round-trip.
 *
 * The DOM render methods (_renderSpeedDisplay / _renderSenses) are thin mappers
 * over these helpers and are exercised indirectly; the label/parse logic that
 * decides emoji-vs-word lives entirely in the pure helpers asserted here.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

describe("parseSpeedString", () => {
	test("walk-only string is a single walk segment", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("40 ft.")).toEqual([
			{type: "walk", value: "40 ft."},
		]);
	});

	test("multi-speed string parses each type with the word prefix stripped", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("40 ft., fly 60 ft., swim 30 ft.")).toEqual([
			{type: "walk", value: "40 ft."},
			{type: "fly", value: "60 ft."},
			{type: "swim", value: "30 ft."},
		]);
	});

	test("climb and burrow prefixes are recognised", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("30 ft., climb 30 ft., burrow 10 ft.")).toEqual([
			{type: "walk", value: "30 ft."},
			{type: "climb", value: "30 ft."},
			{type: "burrow", value: "10 ft."},
		]);
	});

	test("exhaustion suffix on the walk segment is preserved in the value", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("35 ft. (-5), fly 60 ft.")).toEqual([
			{type: "walk", value: "35 ft. (-5)"},
			{type: "fly", value: "60 ft."},
		]);
	});

	test("halved annotation is preserved", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("15 ft. (halved)")).toEqual([
			{type: "walk", value: "15 ft. (halved)"},
		]);
	});

	test("empty / nullish input yields no segments", () => {
		expect(CharacterSheetClassUtils.parseSpeedString("")).toEqual([]);
		expect(CharacterSheetClassUtils.parseSpeedString(null)).toEqual([]);
		expect(CharacterSheetClassUtils.parseSpeedString(undefined)).toEqual([]);
	});
});

describe("buildSpeedDisplayParts", () => {
	test("word mode reproduces the original string exactly when rejoined", () => {
		const input = "40 ft., fly 60 ft., swim 30 ft.";
		const parts = CharacterSheetClassUtils.buildSpeedDisplayParts(input, {useEmoji: false});
		expect(parts.map(p => p.text).join(", ")).toBe(input);
	});

	test("word mode round-trips a walk-only string with an exhaustion suffix", () => {
		const input = "35 ft. (-5)";
		const parts = CharacterSheetClassUtils.buildSpeedDisplayParts(input, {useEmoji: false});
		expect(parts.map(p => p.text).join(", ")).toBe(input);
	});

	test("emoji mode swaps each label for its icon and keeps the word for a11y", () => {
		const parts = CharacterSheetClassUtils.buildSpeedDisplayParts("40 ft., fly 60 ft.", {useEmoji: true});
		expect(parts[0]).toMatchObject({type: "walk", emoji: "🚶", word: "Walk", value: "40 ft.", text: "🚶 40 ft.", title: "Walk speed"});
		expect(parts[1]).toMatchObject({type: "fly", emoji: "🦅", word: "Fly", value: "60 ft.", text: "🦅 60 ft."});
	});

	test("default opts (no useEmoji) behaves as word mode", () => {
		const parts = CharacterSheetClassUtils.buildSpeedDisplayParts("40 ft., climb 20 ft.");
		expect(parts.map(p => p.text).join(", ")).toBe("40 ft., climb 20 ft.");
	});

	test("the same value produces different labels purely from the setting flag", () => {
		const word = CharacterSheetClassUtils.buildSpeedDisplayParts("40 ft.", {useEmoji: false})[0];
		const emoji = CharacterSheetClassUtils.buildSpeedDisplayParts("40 ft.", {useEmoji: true})[0];
		expect(word.label).toBe("Walk");
		expect(emoji.label).toBe("🚶");
		expect(word.value).toBe(emoji.value); // value is identical; only the label differs
	});

	test("every known movement type has a distinct emoji", () => {
		const meta = CharacterSheetClassUtils.SPEED_DISPLAY_META;
		const emojis = ["walk", "fly", "climb", "swim", "burrow"].map(t => meta[t].emoji);
		expect(new Set(emojis).size).toBe(emojis.length);
	});
});

describe("buildSensesDisplay", () => {
	test("renders only senses with a positive range", () => {
		const out = CharacterSheetClassUtils.buildSensesDisplay({
			darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0,
		});
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({type: "darkvision", range: 60, label: "Darkvision", emoji: "🌙", text: "Darkvision 60 ft."});
	});

	test("renders multiple senses in canonical order regardless of object key order", () => {
		const out = CharacterSheetClassUtils.buildSensesDisplay({
			truesight: 30, darkvision: 120, blindsight: 10,
		});
		expect(out.map(s => s.type)).toEqual(["darkvision", "blindsight", "truesight"]);
		expect(out.map(s => s.range)).toEqual([120, 10, 30]);
	});

	test("empty object yields no rows (render shows Normal vision fallback)", () => {
		expect(CharacterSheetClassUtils.buildSensesDisplay({})).toEqual([]);
	});

	test("all-zero senses (e.g. a fresh character) yield no rows", () => {
		expect(CharacterSheetClassUtils.buildSensesDisplay({
			darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0,
		})).toEqual([]);
	});

	test("nullish / non-object input is handled safely", () => {
		expect(CharacterSheetClassUtils.buildSensesDisplay(null)).toEqual([]);
		expect(CharacterSheetClassUtils.buildSensesDisplay(undefined)).toEqual([]);
	});

	test("unknown sense keys surface generically after known senses, sorted, humanised", () => {
		const out = CharacterSheetClassUtils.buildSensesDisplay({
			darkvision: 60, echolocation: 30, heatSight: 20,
		});
		expect(out.map(s => s.type)).toEqual(["darkvision", "echolocation", "heatSight"]);
		const echo = out.find(s => s.type === "echolocation");
		expect(echo.label).toBe("Echolocation");
		const heat = out.find(s => s.type === "heatSight");
		expect(heat.label).toBe("Heat Sight"); // camelCase humanised
	});

	test("non-finite / negative ranges are ignored", () => {
		const out = CharacterSheetClassUtils.buildSensesDisplay({
			darkvision: -10, blindsight: NaN, tremorsense: Infinity, truesight: 15,
		});
		expect(out.map(s => s.type)).toEqual(["truesight"]);
	});

	test("malicious-looking sense keys are returned as inert text (DOM render uses textContent)", () => {
		const out = CharacterSheetClassUtils.buildSensesDisplay({
			"<img src=x onerror=alert(1)>": 30,
		});
		expect(out).toHaveLength(1);
		// The helper returns plain strings; the render path assigns them via
		// textContent / createElement, so the markup is never interpreted.
		expect(typeof out[0].label).toBe("string");
		expect(out[0].range).toBe(30);
	});
});

describe("speedEmojiLabels setting", () => {
	test("default state seeds speedEmojiLabels = true (ON)", () => {
		const state = new CharacterSheetState();
		expect(state.getSettings().speedEmojiLabels).toBe(true);
	});

	test("absent key reads as ON via the !== false contract", () => {
		const state = new CharacterSheetState();
		delete state._data.settings.speedEmojiLabels;
		expect(state.getSettings().speedEmojiLabels !== false).toBe(true);
	});

	test("setSetting(false) persists and round-trips through toJson/loadFromJson", () => {
		const state = new CharacterSheetState();
		state.setSetting("speedEmojiLabels", false);
		expect(state.getSettings().speedEmojiLabels).toBe(false);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		expect(reloaded.getSettings().speedEmojiLabels).toBe(false);
		expect(reloaded.getSettings().speedEmojiLabels !== false).toBe(false); // OFF after reload
	});

	test("re-enabling round-trips back to ON", () => {
		const state = new CharacterSheetState();
		state.setSetting("speedEmojiLabels", false);
		state.setSetting("speedEmojiLabels", true);
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.getSettings().speedEmojiLabels).toBe(true);
	});
});
