/**
 * Bug 5: Full runtime path test.
 *
 * The prior `CharacterSheetSpellPickerMergeRegression.test.js` proved that
 * `_copy` resolution + `subclassAdditionalSpellsIncludeSpell` works with
 * SYNTHETIC spell objects. This test exercises the COMPLETE pipeline:
 *
 *   1. Load real spell data via DataUtil.spell.pLoadAll (which hydrates
 *      `classes.fromClassList` and `classes.fromSubclass` from the generated
 *      source lookup).
 *   2. Find a real `Guidance` spell and a real `Gift of Alacrity` spell.
 *   3. Run them through `spellIsAvailableForClass` with the exact arguments
 *      the picker uses.
 *   4. Verify both pass.
 *
 * If this test passes, the bug is somewhere in the brew loading path or in
 * a different runtime state (allowed-sources filter, stored character data).
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
	DataUtil.pLoadPrereleaseBySource = async () => null;
	DataUtil.pLoadBrewBySource = async () => null;
	DataUtil._pLoadByMeta_pGetPrereleaseBrew = async () => ({});
	globalThis.Hist = globalThis.Hist || {util: {getCleanHash: (s) => String(s).replace(/\s+/g, "%20").toLowerCase()}};
});

describe("Bug 5 full-runtime: spells hydrated via pLoadAll reach the picker correctly", () => {
	let spells;
	let guidance;
	let giftOfAlacrity;
	let divineSoul;
	let chronurgyEgw;

	beforeAll(async () => {
		const DataUtil = globalThis.DataUtil;
		spells = await DataUtil.spell.pLoadAll();
		guidance = spells.find(s => s.name === "Guidance" && s.source === "PHB");
		giftOfAlacrity = spells.find(s => s.name === "Gift of Alacrity" && s.source === "EGW");

		const sorc = loadLocal("data/class/class-sorcerer.json");
		divineSoul = sorc.subclass.find(sc => sc.shortName === "Divine Soul" && sc.source === "XGE");

		const wiz = loadLocal("data/class/class-wizard.json");
		chronurgyEgw = wiz.subclass.find(sc => sc.shortName === "Chronurgy" && sc.source === "EGW");
	});

	it("Guidance is loaded and hydrated with classes.fromClassList", () => {
		expect(guidance).toBeTruthy();
		console.log("Guidance.classes:", JSON.stringify(guidance.classes, null, 2));
		expect(guidance.classes).toBeTruthy();
		expect(guidance.classes.fromClassList).toBeTruthy();
		const clericEntry = guidance.classes.fromClassList.find(c => c.name === "Cleric");
		expect(clericEntry).toBeTruthy();
	});

	it("Gift of Alacrity is loaded and hydrated with classes.fromSubclass", () => {
		expect(giftOfAlacrity).toBeTruthy();
		console.log("Gift of Alacrity.classes:", JSON.stringify(giftOfAlacrity.classes, null, 2));
		expect(giftOfAlacrity.classes).toBeTruthy();
		expect(giftOfAlacrity.classes.fromSubclass).toBeTruthy();
		const chronEntry = giftOfAlacrity.classes.fromSubclass.find(e =>
			(e.subclass?.shortName || "").toLowerCase() === "chronurgy",
		);
		expect(chronEntry).toBeTruthy();
	});

	it("spellIsAvailableForClass accepts Guidance for Divine Soul Sorcerer (full subclass object)", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: divineSoul,
			subclassChoice: null,
		});
		console.log("additionalClassNames:", additionalClassNames);
		const ok = CharacterSheetClassUtils.spellIsAvailableForClass(guidance, {
			className: "Sorcerer",
			subclass: divineSoul,
			subclassChoice: null,
			additionalClassNames,
		});
		console.log("Guidance available for Divine Soul Sorcerer?", ok);
		expect(ok).toBe(true);
	});

	it("spellIsAvailableForClass accepts Gift of Alacrity for Chronurgy Wizard (canonical EGW subclass)", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const ok = CharacterSheetClassUtils.spellIsAvailableForClass(giftOfAlacrity, {
			className: "Wizard",
			subclass: chronurgyEgw,
			subclassChoice: null,
		});
		console.log("Gift of Alacrity available for Chronurgy Wizard (EGW)?", ok);
		expect(ok).toBe(true);
	});

	it("spellIsAvailableForClass accepts Gift of Alacrity for TGTT-2014 Chronurgy Wizard (merged brew subclass)", async () => {
		const DataUtil = globalThis.DataUtil;
		const brew = loadLocal("homebrew/TravelersGuidetoThelemar.json");
		const chronOnly = brew.subclass.find(sc =>
			sc.source === "TGTT-2014" && sc._copy?.shortName === "Chronurgy",
		);
		const wiz = brew.class.find(c => c.name === "Wizard" && c.source === "TGTT");
		const wizardClassFile = loadLocal("data/class/class-wizard.json");
		const egwChron = wizardClassFile.subclass.find(sc =>
			sc.shortName === "Chronurgy" && sc.source === "EGW",
		);
		const filtered = {
			class: wiz ? [wiz] : [],
			subclass: [chronOnly, egwChron],
			_meta: {dependencies: {}, internalCopies: ["subclass"]},
		};
		await DataUtil.pDoMetaMerge("tgtt-probe", filtered, {isSkipMetaMergeCache: true});
		const mergedChron = filtered.subclass.find(sc =>
			sc.shortName === "Chronurgy" && sc.source === "TGTT-2014",
		);
		console.log("Merged TGTT-2014 Chron name:", mergedChron?.name);
		console.log("Merged TGTT-2014 Chron has additionalSpells?", !!mergedChron?.additionalSpells);

		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const ok = CharacterSheetClassUtils.spellIsAvailableForClass(giftOfAlacrity, {
			className: "Wizard",
			subclass: mergedChron,
			subclassChoice: null,
		});
		console.log("Gift of Alacrity available for TGTT-2014 Chronurgy Wizard?", ok);
		expect(ok).toBe(true);
	});

	it("DIAGNOSTIC: which path accepts Guidance for Divine Soul Sorcerer?", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const direct = CharacterSheetClassUtils.spellIsForClass(guidance, "Sorcerer", {subclass: divineSoul});
		console.log("  spellIsForClass(Guidance, Sorcerer, {subclass: DivineSoul}) =", direct);
		const cleric = CharacterSheetClassUtils.spellIsForClass(guidance, "Cleric");
		console.log("  spellIsForClass(Guidance, Cleric) =", cleric);
		const subclassAdd = CharacterSheetClassUtils.subclassAdditionalSpellsIncludeSpell(guidance, divineSoul, {});
		console.log("  subclassAdditionalSpellsIncludeSpell(Guidance, DivineSoul) =", subclassAdd);
	});

	it("DIAGNOSTIC: which path accepts Gift of Alacrity for canonical EGW Chronurgy?", () => {
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const direct = CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard", {subclass: chronurgyEgw});
		console.log("  spellIsForClass(GiftOfAlacrity, Wizard, {subclass: ChronurgyEGW}) =", direct);
		const subclassAdd = CharacterSheetClassUtils.subclassAdditionalSpellsIncludeSpell(giftOfAlacrity, chronurgyEgw, {});
		console.log("  subclassAdditionalSpellsIncludeSpell(GiftOfAlacrity, ChronurgyEGW) =", subclassAdd);
	});
});
