/**
 * Language proficiency UID resolution (round 5, Bug 15)
 *
 * BUG: A TGTT homebrew language is keyed in `languageProficiencies` by its
 * 5etools entity UID ("tabaxi|tgtt"). The builder title-cased that raw key, so
 * the character's language list showed the broken, non-hoverable text
 * "Tabaxi|Tgtt" (pipe and source included) instead of the language name.
 *
 * FIX:
 *   - `CharacterSheetClassUtils.resolveLanguageProficiencyName(key)` strips any
 *     `|source` suffix and title-cases the name part (generic — works for any
 *     homebrew language UID, not just Tabaxi).
 *   - every builder/respec/levelup language-grant call site uses it.
 *   - `CharacterSheetState.addLanguage` defensively resolves a UID that slips
 *     through any other path, so a raw pipe can never be stored.
 */

import "./setup.js";
import fs from "fs";
import path from "path";

let CharacterSheetClassUtils;
let CharacterSheetState;

beforeAll(async () => {
	({CharacterSheetClassUtils} = await import("../../../js/charactersheet/charactersheet-class-utils.js"));
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("resolveLanguageProficiencyName helper", () => {
	test("resolves a homebrew UID key to its clean language name", () => {
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("tabaxi|tgtt")).toBe("Tabaxi");
	});

	test("never leaks the pipe or source for any homebrew UID", () => {
		const out = CharacterSheetClassUtils.resolveLanguageProficiencyName("deep speech|tgtt");
		expect(out).not.toContain("|");
		expect(out.toLowerCase()).not.toContain("tgtt");
		expect(out).toBe("Deep Speech");
	});

	test("title-cases a plain (non-UID) language key", () => {
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("common")).toBe("Common");
	});

	test("is idempotent on an already-resolved name", () => {
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("Elvish")).toBe("Elvish");
	});

	test("handles a key that was already (wrongly) title-cased with the pipe intact", () => {
		// This is exactly the legacy bug output reaching the helper.
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("Tabaxi|Tgtt")).toBe("Tabaxi");
	});

	test("is null/empty-safe", () => {
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName(null)).toBe("");
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("")).toBe("");
	});
});

describe("addLanguage defensively resolves a UID", () => {
	test("stores the clean name when handed a raw UID", () => {
		const state = new CharacterSheetState();
		state.addLanguage("tabaxi|tgtt");
		expect(state.getLanguages()).toContain("Tabaxi");
		expect(state.getLanguages().join(",")).not.toContain("|");
	});

	test("stores the clean name when handed the legacy title-cased-with-pipe form", () => {
		const state = new CharacterSheetState();
		state.addLanguage("Tabaxi|Tgtt");
		expect(state.getLanguages()).toContain("Tabaxi");
		expect(state.getLanguages().join(",")).not.toContain("Tgtt");
	});

	test("leaves a plain language name untouched", () => {
		const state = new CharacterSheetState();
		state.addLanguage("Common");
		expect(state.getLanguages()).toEqual(["Common"]);
	});

	test("does not double-store the same resolved language", () => {
		const state = new CharacterSheetState();
		state.addLanguage("tabaxi|tgtt");
		state.addLanguage("Tabaxi");
		expect(state.getLanguages().filter(l => l === "Tabaxi")).toHaveLength(1);
	});
});

describe("call sites use the resolver (regression guard)", () => {
	const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

	test("the builder no longer title-cases a raw language KEY for addLanguage", () => {
		const src = read("js/charactersheet/charactersheet-builder.js");
		// No surviving `addLanguage(x.toTitleCase())` pattern — all go through the resolver.
		expect(src).not.toMatch(/addLanguage\(\([^)]*\)\.toTitleCase\(\)\)/);
		expect(src).toMatch(/addLanguage\(CharacterSheetClassUtils\.resolveLanguageProficiencyName\(/);
	});
});
