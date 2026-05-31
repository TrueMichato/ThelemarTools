/**
 * End-to-end probe: does TGTT brew _copy resolution produce the expected
 * `additionalSpells` on TGTT-2014 Chronurgy (so the spell picker can offer
 * Gift of Alacrity)? And does the spell picker logic accept Guidance for
 * Divine Soul Sorcerer?
 *
 * This is the test that proves Bug 5 either is or isn't fixed end-to-end.
 */

import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const repo = path.resolve(process.cwd());

function loadLocal (relPath) {
	const full = path.join(repo, relPath);
	return JSON.parse(fs.readFileSync(full, "utf8"));
}

beforeAll(() => {
	const DataUtil = globalThis.DataUtil;
	DataUtil.loadJSON = async (url) => {
		const m = String(url).replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
		const full = path.join(repo, m);
		if (fs.existsSync(full)) return JSON.parse(fs.readFileSync(full, "utf8"));
		return null;
	};
	if (DataUtil.loadRawJSON) DataUtil.loadRawJSON = DataUtil.loadJSON;
	// Stub prerelease/brew loader to return empty for unresolved sources so
	// pDoMetaMerge doesn't reject when Ar1/IllriggerRevised aren't loaded
	DataUtil.pLoadPrereleaseBySource = async () => null;
	DataUtil.pLoadBrewBySource = async () => null;
	DataUtil._pLoadByMeta_pGetPrereleaseBrew = async () => ({});
	// Stub browser-only Hist global for URL_TO_HASH_BUILDER.subclass
	globalThis.Hist = globalThis.Hist || {util: {getCleanHash: (s) => String(s).replace(/\s+/g, "%20").toLowerCase()}};
});

describe("Bug 5: TGTT subclass spell resolution end-to-end", () => {
	let mergedBrew;

	beforeAll(async () => {
		const DataUtil = globalThis.DataUtil;
		const brew = loadLocal("homebrew/TravelersGuidetoThelemar.json");
		const chronOnly = brew.subclass?.find(sc =>
			sc.source === "TGTT-2014"
			&& sc._copy?.shortName === "Chronurgy"
			&& sc._copy?.source === "EGW",
		);
		const wiz = brew.class?.find(c => c.name === "Wizard" && c.source === "TGTT");
		const egwSpells = loadLocal("data/spells/spells-egw.json");
		const filtered = {
			class: wiz ? [wiz] : [],
			subclass: chronOnly ? [chronOnly] : [],
			spell: egwSpells.spell || [],
			_meta: {
				dependencies: {},
				internalCopies: ["subclass"],
			},
		};
		const wizardClassFile = loadLocal("data/class/class-wizard.json");
		const egwChron = wizardClassFile.subclass.find(sc =>
			sc.shortName === "Chronurgy" && sc.source === "EGW",
		);
		console.log("Pre-merge filtered.subclass count:", filtered.subclass.length);
		console.log("TGTT-2014 Chron _copy:", JSON.stringify(chronOnly?._copy));
		if (egwChron) filtered.subclass.push(egwChron);
		await DataUtil.pDoMetaMerge("tgtt-probe", filtered, {isSkipMetaMergeCache: true});
		console.log("Post-merge filtered.subclass:", filtered.subclass.map(s =>
			`name=${s.name}|short=${s.shortName}|src=${s.source}|hasAdditional=${!!s.additionalSpells}|len=${s.additionalSpells?.length || 0}`));
		mergedBrew = filtered;
	});

	it("TGTT-2014 Chronurgy inherits additionalSpells via _copy from EGW Chronurgy", () => {
		const chron = mergedBrew.subclass.find(sc =>
			sc.shortName === "Chronurgy" && sc.source === "TGTT-2014",
		);
		expect(chron).toBeTruthy();
		console.log("Chronurgy additionalSpells:", JSON.stringify(chron.additionalSpells));
		console.log("Chronurgy _copy after merge?", !!chron._copy);
		expect(chron.additionalSpells).toBeTruthy();
		expect(chron.additionalSpells.length).toBeGreaterThan(0);
	});

	it("Spell picker logic accepts Gift of Alacrity (EGW) for a Chronurgy Wizard at level 2", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const chron = mergedBrew.subclass.find(sc =>
			sc.shortName === "Chronurgy" && sc.source === "TGTT-2014",
		);
		const gift = {name: "Gift of Alacrity", source: "EGW", level: 1};
		const ok = CharacterSheetClassUtils.subclassAdditionalSpellsIncludeSpell(gift, chron);
		console.log("Includes Gift of Alacrity?", ok);
		expect(ok).toBe(true);
	});
});

describe("Bug 5 Divine Soul: Guidance should be available regardless of affinity choice", () => {
	let divineSoul;

	beforeAll(() => {
		const sorc = loadLocal("data/class/class-sorcerer.json");
		divineSoul = sorc.subclass.find(sc => sc.shortName === "Divine Soul");
	});

	it("Divine Soul subclass found and has additionalSpells", () => {
		expect(divineSoul).toBeTruthy();
		expect(divineSoul.additionalSpells).toBeTruthy();
	});

	it("getAdditionalSpellListClasses returns ['Cleric'] regardless of affinity choice", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const result = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: divineSoul,
			subclassChoice: null,
		});
		console.log("Divine Soul classes (no affinity):", result);
		expect(result).toContain("Cleric");
	});

	it("spellIsAvailableForClass accepts Guidance regardless of affinity (via Cleric additionalClassNames path)", () => {
		// Guidance is NOT in Divine Soul's additionalSpells — it's accessible via
		// the Cleric spell list that "Divine Magic" grants. The picker resolves
		// this through `spellIsAvailableForClass(spell, {additionalClassNames})`,
		// where additionalClassNames comes from `getAdditionalSpellListClasses`.
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const guidance = {
			name: "Guidance",
			source: "PHB",
			level: 0,
			classes: {fromClassList: [{name: "Cleric", source: "PHB"}]},
		};
		const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: divineSoul,
			subclassChoice: null,
		});
		const ok = CharacterSheetClassUtils.spellIsAvailableForClass(guidance, {
			className: "Sorcerer",
			subclass: divineSoul,
			subclassChoice: null,
			additionalClassNames,
		});
		console.log("Divine Soul picker accepts Guidance (no affinity)?", ok);
		expect(ok).toBe(true);
	});
});
