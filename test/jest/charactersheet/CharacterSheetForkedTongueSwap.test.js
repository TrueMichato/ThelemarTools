/**
 * Character Sheet — Forked Tongue language-swap menu tests (bugs #3b, #8).
 *
 * Bug #8: the long-rest / on-demand Forked Tongue swap menu must offer ONLY TGTT
 * (Traveler's Guide to Thelemar) languages, excluding ones the character already
 * knows — not a generic spread of D&D languages.
 *
 * Bug #3b: there must be a stable, standalone entry point
 * (`openForkedTongueLanguageSwapModal`) the Foundation session routes the "Use
 * Forked Tongue" ability click to, so the swap UI is reachable on demand (not just
 * buried inside the long-rest dialog).
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRest = globalThis.CharacterSheetRest;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

const TGTT_LANGUAGES = [
	"Common", "Lexalian", "Olympian", "Jaknian", "Clairnian", "Hubian", "Old Common", "Stygian",
	"Mictlanian", "Jotunn", "Skyspeak", "Gob", "Trunkodon", "Felis", "Minotaur", "Draconic",
	"Sylvan", "Primordial", "Celestial",
];

const makeCtx = (state, languagesData) => ({
	_page: {
		getState: () => state,
		_languagesData: languagesData,
		saveCharacter: () => {},
		renderCharacter: () => {},
	},
	_state: state,
});

const getCandidates = (state, languagesData) =>
	CharacterSheetRest.prototype._getForkedTongueReplacementCandidates.call(makeCtx(state, languagesData));

describe("Forked Tongue language-swap menu (bugs #3b, #8)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		state.applyClassFeatureEffects(); // grants Mictlanian
	});

	describe("#8 — candidate replacement languages are TGTT-only and exclude known", () => {
		it("sources candidates from loaded TGTT homebrew data", () => {
			const languagesData = [
				...TGTT_LANGUAGES.map(name => ({name, source: "TGTT"})),
				// Non-TGTT noise that must NOT appear as candidates.
				{name: "Abyssal", source: "PHB"},
				{name: "Goblin", source: "PHB"},
				{name: "Undercommon", source: "XPHB"},
			];

			const candidates = getCandidates(state, languagesData);
			// Every candidate is a TGTT language.
			candidates.forEach(c => expect(TGTT_LANGUAGES).toContain(c));
			// Generic D&D languages are excluded.
			expect(candidates).not.toContain("Abyssal");
			expect(candidates).not.toContain("Goblin");
			expect(candidates).not.toContain("Undercommon");
		});

		it("excludes languages the character already knows (incl. the Mictlanian grant)", () => {
			const languagesData = TGTT_LANGUAGES.map(name => ({name, source: "TGTT"}));

			// Mictlanian is auto-granted; add Stygian explicitly.
			state.addLanguage("Stygian");
			const known = new Set(state.getLanguages().map(l => l.toLowerCase()));
			const candidates = getCandidates(state, languagesData);

			expect(candidates.map(c => c.toLowerCase())).not.toContain("mictlanian");
			expect(candidates.map(c => c.toLowerCase())).not.toContain("stygian");
			candidates.forEach(c => expect(known.has(c.toLowerCase())).toBe(false));
		});

		it("falls back to the canonical TGTT list when no homebrew data is loaded", () => {
			const candidates = getCandidates(state, []); // no languagesData

			expect(candidates.length).toBeGreaterThan(0);
			candidates.forEach(c => expect(TGTT_LANGUAGES).toContain(c));
			// Still excludes the auto-granted Mictlanian.
			expect(candidates.map(c => c.toLowerCase())).not.toContain("mictlanian");
		});

		it("does not offer the legacy generic D&D languages", () => {
			const candidates = getCandidates(state, []).map(c => c.toLowerCase());
			// These were in the old hardcoded STANDARD_LANGUAGES list but are not TGTT languages.
			["aquan", "auran", "dwarvish", "elvish", "gnomish", "halfling", "ignan", "orc", "terran", "deep speech", "undercommon", "abyssal"]
				.forEach(l => expect(candidates).not.toContain(l));
		});
	});

	describe("#3b — stable standalone swap-modal entry point", () => {
		it("exposes `openForkedTongueLanguageSwapModal` as a method", () => {
			expect(typeof CharacterSheetRest.prototype.openForkedTongueLanguageSwapModal).toBe("function");
		});
	});

	describe("source-level guards", () => {
		const REST_SRC = read("js/charactersheet/charactersheet-rest.js");

		it("filters TGTT languages by source so the list stays in sync", () => {
			expect(REST_SRC).toMatch(/_getForkedTongueReplacementCandidates\s*\(/);
			expect(REST_SRC).toMatch(/l\.source === "TGTT"/);
		});

		it("removed the legacy generic STANDARD_LANGUAGES swap list", () => {
			expect(REST_SRC).not.toMatch(/const STANDARD_LANGUAGES = \[/);
		});

		it("keeps the stable entry-point name for the Foundation session to route to", () => {
			expect(REST_SRC).toMatch(/async openForkedTongueLanguageSwapModal\s*\(/);
			// The long-rest section + its name must remain stable too.
			expect(REST_SRC).toMatch(/_buildForkedTongueLanguageSwapSection\s*\(/);
		});

		it("both the long-rest section and the modal share the candidate helper", () => {
			const sectionIdx = REST_SRC.indexOf("_buildForkedTongueLanguageSwapSection (");
			const sectionBody = REST_SRC.slice(sectionIdx, sectionIdx + 2500);
			expect(sectionBody).toMatch(/this\._getForkedTongueReplacementCandidates\(\)/);

			const modalIdx = REST_SRC.indexOf("async openForkedTongueLanguageSwapModal (");
			const modalBody = REST_SRC.slice(modalIdx, modalIdx + 3500);
			expect(modalBody).toMatch(/this\._getForkedTongueReplacementCandidates\(\)/);
		});
	});
});
