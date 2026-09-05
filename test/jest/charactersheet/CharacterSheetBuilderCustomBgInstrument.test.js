/**
 * Bug #2 — creating a CUSTOM background and adding a "Musical Instrument" (or
 * "Gaming Set") tool proficiency gave no way to choose WHICH instrument/set in
 * the creation screen; the concrete pick only surfaced AFTER creation in the
 * preview's `anyMusicalInstrument` picker.
 *
 * ROOT CAUSE: the creator stored the category string ("Musical Instrument") into
 * `_customBackgroundData.tools` with no sub-pick, and `_buildCustomBackground()`
 * mapped it to a `{anyMusicalInstrument: 1}` choice key.
 *
 * FIX: the creator now renders an inline sub-picker for category tools and stores
 * the concrete choice in `_customBackgroundData.toolChoices`. `_buildCustomBackground`
 * emits a FIXED tool proficiency (e.g. `{lute: true}`) when a concrete pick exists,
 * and otherwise falls back to the choice key (so the post-creation preview picker
 * still works — no regression).
 *
 * The builder is light enough to drive directly via `Object.create`, so these
 * tests exercise the REAL `_buildCustomBackground` behavior. A handful of
 * source-pins guard the creator UI wiring (jsdom-free env can't spin the form).
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const BUILDER_SRC = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-builder.js"), "utf8");

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

function buildBg (customBackgroundData) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._customBackgroundData = customBackgroundData;
	return builder._buildCustomBackground();
}

// Flatten all toolProficiencies entries into one lookup of key -> value.
function flattenTools (bg) {
	return (bg.toolProficiencies || []).reduce((acc, set) => Object.assign(acc, set), {});
}

const BASE = {
	name: "Custom",
	skills: ["Performance", "Persuasion"],
	tools: [],
	languages: [],
};

describe("Custom background instrument sub-picker (Bug #2)", () => {
	test("a picked musical instrument is persisted as a FIXED proficiency", () => {
		const bg = buildBg({...BASE, tools: ["Musical Instrument"], toolChoices: {"Musical Instrument": "lute"}});
		const tools = flattenTools(bg);
		expect(tools.lute).toBe(true);
		// The unresolved category choice-key must NOT linger.
		expect(tools.anyMusicalInstrument).toBeUndefined();
		const allKeys = (bg.toolProficiencies || []).flatMap((s) => Object.keys(s));
		expect(allKeys).not.toContain("anyMusicalInstrument");
	});

	test("an unpicked musical instrument falls back to the choice key (no regression)", () => {
		const bg = buildBg({...BASE, tools: ["Musical Instrument"], toolChoices: {}});
		const tools = flattenTools(bg);
		expect(tools.anyMusicalInstrument).toBe(1);
		expect(tools.lute).toBeUndefined();
	});

	test("a picked gaming set is persisted as a FIXED proficiency", () => {
		const bg = buildBg({...BASE, tools: ["Gaming Set"], toolChoices: {"Gaming Set": "dice set"}});
		const tools = flattenTools(bg);
		expect(tools["dice set"]).toBe(true);
		expect(tools.anyGamingSet).toBeUndefined();
	});

	test("an unpicked gaming set falls back to the choice key", () => {
		const bg = buildBg({...BASE, tools: ["Gaming Set"], toolChoices: {}});
		expect(flattenTools(bg).anyGamingSet).toBe(1);
	});

	test("resolved category merges alongside genuinely fixed tools", () => {
		const bg = buildBg({
			...BASE,
			tools: ["Smith's Tools", "Musical Instrument"],
			toolChoices: {"Musical Instrument": "flute"},
		});
		const tools = flattenTools(bg);
		expect(tools["smith's tools"]).toBe(true);
		expect(tools.flute).toBe(true);
		expect(tools.anyMusicalInstrument).toBeUndefined();
	});

	test("backward compatible with saved data that predates `toolChoices`", () => {
		// No `toolChoices` key at all — must not throw and must keep choice-key behavior.
		const bg = buildBg({...BASE, tools: ["Musical Instrument"]});
		expect(flattenTools(bg).anyMusicalInstrument).toBe(1);
	});

	test("does not mutate `tools` (sub-pick must not affect the 2-prof budget)", () => {
		const data = {...BASE, tools: ["Musical Instrument"], toolChoices: {"Musical Instrument": "viol"}};
		buildBg(data);
		expect(data.tools).toEqual(["Musical Instrument"]);
	});

	test("keeps local custom backgrounds but blocks campaign-disallowed custom content", () => {
		const background = buildBg(BASE);
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._page = {_hubContext: null};
		expect(builder._isCampaignCustomBackgroundAllowed(background)).toBe(true);

		builder._page = {_hubContext: {}, isCampaignContentEntityAllowed: () => false};
		expect(builder._isCampaignCustomBackgroundAllowed(background)).toBe(false);
		builder._page.isCampaignContentEntityAllowed = () => true;
		expect(builder._isCampaignCustomBackgroundAllowed(background)).toBe(true);
	});
});

describe("Custom background creator — sub-picker wiring (Bug #2 source-pin)", () => {
	// Isolate the creator method so pins can't accidentally match the unrelated
	// preview picker (`_renderBackgroundToolProficiencies`) elsewhere in the file.
	const CREATOR_WINDOW = (() => {
		const start = BUILDER_SRC.indexOf("_showCustomBackgroundCreator (preview) {");
		const end = BUILDER_SRC.indexOf("_updateCustomBgSkills (", start);
		return start > -1 && end > start ? BUILDER_SRC.slice(start, end) : "";
	})();

	test("creator method window was located", () => {
		expect(CREATOR_WINDOW.length).toBeGreaterThan(0);
	});

	test("creator defaults `toolChoices` (incl. back-compat for existing data)", () => {
		expect(CREATOR_WINDOW).toMatch(/toolChoices:\s*\{\}/);
		expect(CREATOR_WINDOW).toMatch(/if \(!this\._customBackgroundData\.toolChoices\) this\._customBackgroundData\.toolChoices = \{\};/);
	});

	test("renders a category sub-picker fed by the renderer's instrument & gaming-set lists", () => {
		const m = CREATOR_WINDOW.match(/categorySubPickers\s*=\s*\{[\s\S]*?\};/);
		expect(m).not.toBeNull();
		expect(m[0]).toMatch(/Renderer\.generic\.FEATURE__TOOLS_MUSICAL_INSTRUMENTS/);
		expect(m[0]).toMatch(/Renderer\.generic\.FEATURE__TOOLS_GAMING_SETS/);
		expect(CREATOR_WINDOW).toMatch(/custom-bg-tool-subpick/);
	});

	test("the sub-picker's `change` handler persists the pick to `toolChoices`", () => {
		expect(CREATOR_WINDOW).toMatch(/selectEl\.addEventListener\("change"/);
		expect(CREATOR_WINDOW).toMatch(/if \(e\.target\.value\) this\._customBackgroundData\.toolChoices\[tool\] = e\.target\.value;/);
		expect(CREATOR_WINDOW).toMatch(/else delete this\._customBackgroundData\.toolChoices\[tool\];/);
	});

	test("the chip remove handler clears the tool AND its `toolChoices` entry, then re-renders", () => {
		const m = CREATOR_WINDOW.match(/custom-bg-tool-remove"\)\?\.addEventListener\("click",[\s\S]*?renderLangPicker\(\);\n\t\t\t\t\}\);/);
		expect(m).not.toBeNull();
		expect(m[0]).toMatch(/this\._customBackgroundData\.tools = this\._customBackgroundData\.tools\.filter/);
		expect(m[0]).toMatch(/delete this\._customBackgroundData\.toolChoices\[tool\]/);
		expect(m[0]).toMatch(/renderToolChips\(\)/);
	});

	test("adding a tool still re-renders the chips (so a new category gets its sub-picker)", () => {
		const m = CREATOR_WINDOW.match(/toolAddEl\.addEventListener\("change",[\s\S]*?renderLangPicker\(\);\n\t\t\}\);/);
		expect(m).not.toBeNull();
		expect(m[0]).toMatch(/this\._customBackgroundData\.tools\.push\(val\)/);
		expect(m[0]).toMatch(/renderToolChips\(\)/);
	});
});
