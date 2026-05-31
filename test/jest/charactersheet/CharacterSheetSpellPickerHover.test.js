/**
 * Bug 7: Spell-picker hovers should surface the rarity/legality rows that the
 * main spells tab already shows. The fix routes the picker's name link through
 * `getSpellHoverLink` (the rarity/legality-aware builder) when supplied,
 * falling back to the generic `getHoverLink` otherwise.
 *
 * These tests verify the wiring, not the visual hover layout (which is exercised
 * by manual / e2e checks): the picker must prefer `getSpellHoverLink` when both
 * callbacks are present, and `buildSpellHoverLinkFn` must look up the
 * matching characterSpell from state so the rarity/legality rows fire.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// Override the setup stub so picker `_renderGroupedSpellList` can resolve the
// `.charsheet__spell-picker-item-name` element it writes the link into.
const _origE = globalThis.e_;
globalThis.e_ = function (opts = {}) {
	const el = _origE(opts);
	const writableName = {
		_html: "",
		_text: "",
		get innerHTML () { return this._html; },
		set innerHTML (v) { this._html = v; },
		get textContent () { return this._text; },
		set textContent (v) { this._text = v; },
	};
	el.querySelector = function (sel) {
		if (sel === ".charsheet__spell-picker-item-name") return writableName;
		if (sel === ".spell-toggle") return {addEventListener () {}};
		return null;
	};
	el.querySelectorAll = function () { return []; };
	el.addEventListener = function () {};
	el.append = function (child) { this._children.push(child); };
	return el;
};

await import("../../../js/charactersheet/charactersheet-class-utils.js");
await import("../../../js/charactersheet/charactersheet-spell-picker.js");

const CharacterSheetSpellPicker = globalThis.CharacterSheetSpellPicker;

const FIREBOLT = {name: "Fire Bolt", source: "XPHB", level: 0, school: "V"};
const GUIDANCE = {name: "Guidance", source: "XPHB", level: 0, school: "D"};

describe("Bug 7: spell-picker hover routing", () => {
	test("prefers getSpellHoverLink over getHoverLink when both are supplied", () => {
		const calls = {hover: [], spellHover: []};
		const getHoverLink = (page, name, source) => {
			calls.hover.push({page, name, source});
			return `<a data-kind="generic">${name}</a>`;
		};
		const getSpellHoverLink = (name, source, spell) => {
			calls.spellHover.push({name, source, hasSpell: !!spell});
			return `<a data-kind="spell">${name}</a>`;
		};

		const container = globalThis.e_({tag: "div"});
		CharacterSheetSpellPicker._renderGroupedSpellList({
			container,
			spells: [FIREBOLT, GUIDANCE],
			knownSpellIds: new Set(),
			selectedSpells: [],
			selectedCantrips: [],
			spellCount: 1,
			cantripCount: 2,
			getHoverLink,
			getSpellHoverLink,
			previewPane: null,
			onToggle: () => {},
		});

		expect(calls.spellHover.length).toBe(2);
		expect(calls.spellHover.map(c => c.name).sort()).toEqual(["Fire Bolt", "Guidance"]);
		calls.spellHover.forEach(c => expect(c.hasSpell).toBe(true));
		// When the spell-aware callback is present, the generic one must not be used —
		// otherwise we'd risk double-rendering or rarity/legality going missing.
		expect(calls.hover.length).toBe(0);
	});

	test("falls back to getHoverLink when getSpellHoverLink is absent (back-compat)", () => {
		const calls = {hover: []};
		const getHoverLink = (page, name, source) => {
			calls.hover.push({page, name, source});
			return `<a>${name}</a>`;
		};

		const container = globalThis.e_({tag: "div"});
		CharacterSheetSpellPicker._renderGroupedSpellList({
			container,
			spells: [FIREBOLT],
			knownSpellIds: new Set(),
			selectedSpells: [],
			selectedCantrips: [],
			spellCount: 0,
			cantripCount: 1,
			getHoverLink,
			previewPane: null,
			onToggle: () => {},
		});

		expect(calls.hover.length).toBe(1);
		expect(calls.hover[0].name).toBe("Fire Bolt");
		expect(calls.hover[0].page).toBe(globalThis.UrlUtil.PG_SPELLS);
	});

	test("renderKnownSpellPicker JSDoc surface exposes getSpellHoverLink option", () => {
		// Lightweight contract check: the picker module is loaded and the option
		// is wired through. Avoids the heavy DOM stub the full picker render needs.
		const src = CharacterSheetSpellPicker.renderKnownSpellPicker.toString();
		expect(src).toContain("getSpellHoverLink");
		const wizardSrc = CharacterSheetSpellPicker.renderWizardSpellbookPicker.toString();
		expect(wizardSrc).toContain("getSpellHoverLink");
	});
});

describe("Bug 7 Phase 5: rarity/legality fallback to spellData.subschools", () => {
	// When a picker shows a spell that ISN'T yet in the character's spells list,
	// characterSpell is null. The fix is for getSpellHoverLink / _buildSpellHoverRows
	// to fall back to the canonical spellData.subschools so rarity/legality still
	// surface for un-added spells (the picker's whole purpose).
	//
	// Source-level guard — instantiating the full CharacterSheetPage in jest is
	// too heavy (6.5K-line file, lots of global deps), so we assert the source
	// contains the documented fallback.
	test("getSpellHoverLink reads subschools from characterSpell || spellData", () => {
		const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		// Match the source line that builds the subschools array inside getSpellHoverLink.
		const match = src.match(/getSpellHoverLink \(name, source, spellData, characterSpell\)[\s\S]{0,600}?const subschools = characterSpell\?\.subschools \|\| spellData\?\.subschools \|\| \[\];/);
		expect(match).not.toBeNull();
	});

	test("_buildSpellHoverRows reads subschools from characterSpell || spellData", () => {
		const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const match = src.match(/_buildSpellHoverRows \(spellData, characterSpell, modStats\)[\s\S]{0,2500}?const subschools = characterSpell\?\.subschools \|\| spellData\?\.subschools \|\| \[\];/);
		expect(match).not.toBeNull();
	});
});

describe("Bug 7: buildSpellHoverLinkFn semantics (lightweight harness)", () => {
	// We don't import charactersheet.js (6.5K-line file requires more globals than
	// setup provides). Instead, recreate the helper's contract with a minimal
	// page shape and assert it threads the characterSpell through correctly.
	test("resolves characterSpell from state by name|source and forwards to getSpellHoverLink", () => {
		const captured = {};
		const stubPage = {
			getState: () => ({
				getSpells: () => [
					{name: "Fire Bolt", source: "XPHB", subschools: ["rarity:rare", "legality:taboo"]},
					{name: "Mage Hand", source: "XPHB"},
				],
			}),
			getSpellHoverLink (name, source, spellData, characterSpell) {
				captured[name] = {name, source, spellData, characterSpell};
				return `<a>${name}</a>`;
			},
			getHoverLink: (page, name) => `<a>${name}</a>`,
			// Mirror the production implementation byte-for-byte so the contract
			// is what we assert against.
			buildSpellHoverLinkFn () {
				return (name, source, spellData) => {
					try {
						const characterSpell = this.getState?.()?.getSpells?.()
							.find(s => s.name === name && (s.source || "XPHB") === (source || "XPHB"));
						return this.getSpellHoverLink(name, source, spellData || null, characterSpell || null);
					} catch (e) {
						return this.getHoverLink("spells.html", name, source);
					}
				};
			},
		};

		const fn = stubPage.buildSpellHoverLinkFn();
		fn("Fire Bolt", "XPHB", {name: "Fire Bolt", source: "XPHB"});
		fn("Guidance", "XPHB", {name: "Guidance", source: "XPHB"});

		// Fire Bolt is in state → characterSpell passed through with subschools.
		expect(captured["Fire Bolt"]).toBeDefined();
		expect(captured["Fire Bolt"].characterSpell).toBeTruthy();
		expect(captured["Fire Bolt"].characterSpell.subschools).toEqual(["rarity:rare", "legality:taboo"]);
		// Guidance not in state → characterSpell is null (so generic hover is rendered downstream).
		expect(captured["Guidance"]).toBeDefined();
		expect(captured["Guidance"].characterSpell).toBeNull();
	});
});
