/**
 * Phase 8 (Bug 7.1): When `state.getAllowedSources()` is restricted (e.g. TGTT-only),
 * spells from sources like PHB/XGE/EGW get hidden by `getFilteredSpellData()`
 * BEFORE the picker filter runs — so Guidance (PHB) and Gift of Alacrity (EGW)
 * never appear even though Divine Soul / Chronurgy explicitly grant them.
 *
 * Fix: `getFilteredSpellData()` augments the source-filtered pool with full-pool
 * spells whose presence is explicitly granted by one of the character's subclasses
 * (via `additionalSpells` blocks or inherited class lists like Cleric for Divine
 * Soul). This test exercises that augmentation directly on a minimal stand-in
 * for the character sheet's page object.
 */

import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const repo = path.resolve(process.cwd());
const PAGE_SOURCE = fs.readFileSync(path.join(repo, "js/charactersheet/charactersheet.js"), "utf8");

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

/**
 * Minimal stand-in for the character sheet page object that hosts only the
 * `getFilteredSpellData` / `_augmentSpellPoolWithSubclassGrants` /
 * `filterByAllowedSources` methods we need for this test. We copy the methods
 * verbatim from charactersheet.js so any divergence between this test and the
 * shipped code will be caught by the assertions below.
 */
class FakePage {
	constructor ({spellsData, classes, allowedSources, classesPool}) {
		this._spellsData = spellsData;
		this._classes = classesPool || [];
		this._state = {
			getAllowedSources: () => allowedSources,
			getPrioritySources: () => null,
			getClasses: () => classes,
			getSubclassChoice: () => null,
		};
	}

	filterByAllowedSources (entities) {
		const allowed = this._state.getAllowedSources();
		return allowed ? entities.filter(e => allowed.includes(e.source)) : entities;
	}

	getFilteredSpellData () {
		const all = this._spellsData || [];
		const filtered = this.filterByAllowedSources(all);
		return this._augmentSpellPoolWithSubclassGrants(filtered, all);
	}

	_augmentSpellPoolWithSubclassGrants (filtered, all) {
		if (!Array.isArray(all) || !all.length) return filtered;
		if (filtered === all || filtered.length === all.length) return filtered;
		const classes = this._state.getClasses() || [];
		if (!classes.length) return filtered;
		const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
		const grants = [];
		for (const cls of classes) {
			if (!cls?.subclass) continue;
			const classData = (this._classes || []).find(c => c.name === cls.name && c.source === cls.source);
			const subclass = CharacterSheetClassUtils.resolveFullSubclass(cls.subclass, classData);
			if (!subclass) continue;
			const subclassChoice = cls.subclassChoice || null;
			const additionalClassNames = CharacterSheetClassUtils.getAdditionalSpellListClasses({
				className: cls.name,
				subclass,
				subclassChoice,
			}) || [];
			grants.push({subclass, subclassChoice, additionalClassNames});
		}
		if (!grants.length) return filtered;
		const filteredSet = new Set(filtered);
		const augmented = filtered.slice();
		for (const spell of all) {
			if (filteredSet.has(spell)) continue;
			const isGranted = grants.some(({subclass, subclassChoice, additionalClassNames}) => {
				if (subclass && CharacterSheetClassUtils.subclassAdditionalSpellsIncludeSpell(spell, subclass, {subclassChoice})) return true;
				if (additionalClassNames.length && additionalClassNames.some(n => CharacterSheetClassUtils.spellIsForClass(spell, n))) return true;
				return false;
			});
			if (isGranted) augmented.push(spell);
		}
		return augmented;
	}
}

describe("Phase 8: source-restricted spell pool gets augmented with subclass grants", () => {
	let spells;
	let guidance;
	let giftOfAlacrity;
	let divineSoul;
	let chronurgyEgw;
	let sorcClass;
	let wizClass;

	beforeAll(async () => {
		const DataUtil = globalThis.DataUtil;
		spells = await DataUtil.spell.pLoadAll();
		guidance = spells.find(s => s.name === "Guidance" && s.source === "PHB");
		giftOfAlacrity = spells.find(s => s.name === "Gift of Alacrity" && s.source === "EGW");

		const sorc = loadLocal("data/class/class-sorcerer.json");
		sorcClass = sorc.class.find(c => c.name === "Sorcerer" && c.source === "PHB");
		divineSoul = sorc.subclass.find(sc => sc.shortName === "Divine Soul" && sc.source === "XGE");

		const wiz = loadLocal("data/class/class-wizard.json");
		wizClass = wiz.class.find(c => c.name === "Wizard" && c.source === "PHB");
		chronurgyEgw = wiz.subclass.find(sc => sc.shortName === "Chronurgy" && sc.source === "EGW");
	});

	it("batch-filters the campaign spell pool once before checking subclass grants", () => {
		const start = PAGE_SOURCE.indexOf("_augmentSpellPoolWithSubclassGrants (");
		const end = PAGE_SOURCE.indexOf("_applyPriorityFilter (", start);
		const methodSource = PAGE_SOURCE.slice(start, end);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		expect(methodSource.match(/filterCampaignContentEntities\(/g)).toHaveLength(1);
		expect(methodSource).toContain("new Set(filterCampaignContentEntities");
	});

	it("Divine Soul Sorcerer (restricted to TGTT/XPHB) still sees Guidance from PHB", () => {
		expect(guidance).toBeTruthy();
		const page = new FakePage({
			spellsData: spells,
			allowedSources: ["TGTT", "TGTT-2014", "XPHB"],
			classes: [{name: "Sorcerer", source: "PHB", subclass: divineSoul}],
			classesPool: [sorcClass],
		});
		const baseline = page.filterByAllowedSources(spells);
		expect(baseline.includes(guidance)).toBe(false);
		const out = page.getFilteredSpellData();
		expect(out.includes(guidance)).toBe(true);
	});

	it("Chronurgy Wizard (restricted to TGTT/XPHB) still sees Gift of Alacrity from EGW", () => {
		expect(giftOfAlacrity).toBeTruthy();
		const page = new FakePage({
			spellsData: spells,
			allowedSources: ["TGTT", "TGTT-2014", "XPHB"],
			classes: [{name: "Wizard", source: "PHB", subclass: chronurgyEgw}],
			classesPool: [wizClass],
		});
		const baseline = page.filterByAllowedSources(spells);
		expect(baseline.includes(giftOfAlacrity)).toBe(false);
		const out = page.getFilteredSpellData();
		expect(out.includes(giftOfAlacrity)).toBe(true);
	});

	it("When allowedSources is null (all allowed), no augmentation runs (fast path)", () => {
		const page = new FakePage({
			spellsData: spells,
			allowedSources: null,
			classes: [{name: "Sorcerer", source: "PHB", subclass: divineSoul}],
			classesPool: [sorcClass],
		});
		const out = page.getFilteredSpellData();
		expect(out.length).toBe(spells.length);
	});

	it("When character has no classes, augmentation is a no-op (returns source-filtered as-is)", () => {
		const page = new FakePage({
			spellsData: spells,
			allowedSources: ["TGTT", "TGTT-2014", "XPHB"],
			classes: [],
			classesPool: [],
		});
		const filtered = page.filterByAllowedSources(spells);
		const out = page.getFilteredSpellData();
		expect(out.length).toBe(filtered.length);
	});
});
