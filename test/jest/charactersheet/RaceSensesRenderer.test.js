/**
 * Race popout Senses attribute item — Renderer.race._getRaceRenderableEntriesMeta_senses.
 * Guards the "Grimlock's structured blindsight is now visible in the popout"
 * fix and the canonical sense render order.
 *
 * Tracker: 5ET-1226
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-ui.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const Renderer = globalThis.Renderer;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("Renderer.race race-senses attribute item (5ET-1226)", () => {
	test("returns null when no structured senses are set", () => {
		const out = Renderer.race._getRaceRenderableEntriesMeta_senses({ent: {name: "Human", source: "PHB"}});
		expect(out).toBeNull();
	});

	test("surfaces darkvision-only races (existing behaviour preserved)", () => {
		const out = Renderer.race._getRaceRenderableEntriesMeta_senses({ent: {name: "Elf", source: "PHB", darkvision: 60}});
		expect(out).toEqual({type: "item", name: "Senses:", entry: "Darkvision 60 ft."});
	});

	test("surfaces Grimlock's structured blindsight (was previously invisible in the popout)", () => {
		const out = Renderer.race._getRaceRenderableEntriesMeta_senses({ent: {name: "Grimlock", source: "DMG", blindsight: 30}});
		expect(out).toEqual({type: "item", name: "Senses:", entry: "Blindsight 30 ft."});
	});

	test("renders all four senses in canonical order (darkvision, blindsight, tremorsense, truesight)", () => {
		const out = Renderer.race._getRaceRenderableEntriesMeta_senses({
			ent: {
				name: "Sensory Test",
				source: "TST",
				// Intentionally provide keys in shuffled order to prove ordering is
				// enforced by the helper, not by object-key insertion order.
				truesight: 30,
				tremorsense: 60,
				darkvision: 120,
				blindsight: 15,
			},
		});
		expect(out).toEqual({
			type: "item",
			name: "Senses:",
			entry: "Darkvision 120 ft., Blindsight 15 ft., Tremorsense 60 ft., Truesight 30 ft.",
		});
	});

	test("emits only populated senses", () => {
		const out = Renderer.race._getRaceRenderableEntriesMeta_senses({
			ent: {name: "Partial", source: "TST", darkvision: 60, truesight: 30},
		});
		expect(out).toEqual({
			type: "item",
			name: "Senses:",
			entry: "Darkvision 60 ft., Truesight 30 ft.",
		});
	});

	test("Renderer.race._RACE_SENSE_KEYS matches CharacterSheetClassUtils.SENSE_DISPLAY_ORDER order", () => {
		expect(Renderer.race._RACE_SENSE_KEYS).toEqual(CharacterSheetClassUtils.SENSE_DISPLAY_ORDER);
	});
});
