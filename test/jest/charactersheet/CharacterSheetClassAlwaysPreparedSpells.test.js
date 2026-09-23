/**
 * R48 Bug 1 — Class-level always-prepared spells.
 *
 * The base CLASS object (not the subclass) can carry structured `additionalSpells`
 * — e.g. the TGTT Cleric ALWAYS prepares Ceremony + Thaumaturgy, the TGTT Ranger
 * ALWAYS prepares Hunter's Mark. Before this fix the character sheet applied
 * `additionalSpells` for race / feat / subclass only, silently dropping the
 * class-level grant.
 *
 * These tests drive the state-level mechanism directly (setClassCatalog +
 * applyClassFeatureEffects) — the same wiring the page performs in
 * `_reconcileClassFeatures()` — and separately assert that wiring line exists.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// Minimal spell DB so class-granted spells get enriched with real level/school
// (without it, entries keep `level: null` and the level-grouped list drops them).
const SPELL_DB = [
	{name: "Ceremony", source: "XPHB", level: 1, school: "A"},
	{name: "Thaumaturgy", source: "XPHB", level: 0, school: "T"},
	{name: "Hunter's Mark", source: "XPHB", level: 1, school: "D"},
	{name: "Speak with Animals", source: "XPHB", level: 1, school: "D"},
	{name: "Power Word Heal", source: "XPHB", level: 9, school: "E"},
	{name: "Power Word Kill", source: "XPHB", level: 9, school: "E"},
];

const BARD_DATA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/class/class-bard.json"), "utf8"));
const TGTT_DATA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8"));

function getRealBard (source) {
	const data = source === "TGTT" ? TGTT_DATA : BARD_DATA;
	return data.class.find(cls => cls.name === "Bard" && cls.source === source);
}

function getWordsOfCreationRefs (cls) {
	return (cls.additionalSpells || [])
		.flatMap(block => block.prepared?.["20"] || []);
}

/** The real TGTT Cleric class object carries `additionalSpells` at the class level. */
function tgttClericCatalogEntry () {
	return {
		name: "Cleric",
		source: "TGTT",
		additionalSpells: [{prepared: {1: ["thaumaturgy|xphb", "ceremony|xphb"]}}],
	};
}

/** The real TGTT Ranger class object — Hunter's Mark is always prepared at level 1. */
function tgttRangerCatalogEntry () {
	return {
		name: "Ranger",
		source: "TGTT",
		additionalSpells: [{prepared: {1: ["hunter's mark|xphb"]}}],
	};
}

function newClericState ({level = 10} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(SPELL_DB);
	state._data.classes = [{name: "Cleric", source: "TGTT", level, subclass: null}];
	return state;
}

const lc = arr => arr.map(s => (s.name || "").toLowerCase());
const powerWords = state => state.getSpellsKnown()
	.filter(spell => /^power word (heal|kill)$/i.test(spell.name));

describe("Class-level always-prepared spells — grant", () => {
	test("TGTT Cleric always prepares Ceremony + Thaumaturgy, tagged, not counted vs limit", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		const known = state.getSpellsKnown();
		const cantrips = state.getCantripsKnown();

		// Ceremony (level 1) is a leveled always-prepared spell.
		const ceremony = known.find(s => s.name.toLowerCase() === "ceremony");
		expect(ceremony).toBeTruthy();
		expect(ceremony.alwaysPrepared).toBe(true);
		expect(ceremony.grantedByClass).toBe(true);
		expect(ceremony.sourceFeature).toBe("Cleric Spells");
		expect(ceremony.sourceClass).toBe("Cleric");
		expect(ceremony.level).toBe(1);

		// Thaumaturgy is a cantrip — routed to cantripsKnown, tagged.
		const thaum = cantrips.find(s => s.name.toLowerCase() === "thaumaturgy");
		expect(thaum).toBeTruthy();
		expect(thaum.grantedByClass).toBe(true);
		expect(thaum.sourceFeature).toBe("Cleric Spells");

		// Always-prepared class spells must NOT count against the prepared limit:
		// their sourceFeature is not a player-chosen tag.
		const ClassUtils = globalThis.CharacterSheetClassUtils;
		expect(ClassUtils.isPlayerChosenSpell(ceremony)).toBe(false);
		expect(ClassUtils.isPlayerChosenSpell(thaum)).toBe(false);
	});

	test("re-applying is idempotent (no duplicate class spells)", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();
		state.applyClassFeatureEffects();

		const ceremonies = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		const thaums = state.getCantripsKnown().filter(s => s.name.toLowerCase() === "thaumaturgy");
		expect(ceremonies).toHaveLength(1);
		expect(thaums).toHaveLength(1);
	});

	test("no-ops until the class catalog is provided", () => {
		const state = newClericState();
		// No setClassCatalog → populateClassSpells early-returns.
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");
		expect(lc(state.getCantripsKnown())).not.toContain("thaumaturgy");
	});

	test("classes without class-level additionalSpells no-op cleanly", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Fighter", source: "TGTT", level: 5, subclass: null}];
		state.setClassCatalog([{name: "Fighter", source: "TGTT"}]);
		expect(() => state.applyClassFeatureEffects()).not.toThrow();
		expect(state.getSpellsKnown()).toHaveLength(0);
	});
});

describe("Class-level always-prepared spells — level gating", () => {
	test("a 1-level Cleric multiclass dip still gets the level-1 class spells", () => {
		const state = newClericState({level: 1});
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("ceremony");
		expect(lc(state.getCantripsKnown())).toContain("thaumaturgy");
	});

	test("a higher-level grant is withheld below its level then added on level-up", () => {
		// Druid: speak with animals at class level 1.
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Druid", source: "TGTT", level: 1, subclass: null}];
		const druidCatalog = [{
			name: "Druid",
			source: "TGTT",
			additionalSpells: [{prepared: {1: ["speak with animals|xphb"], 3: ["hunter's mark|xphb"]}}],
		}];
		state.setClassCatalog(druidCatalog);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("speak with animals");
		// hunter's mark requires class level 3 — withheld at level 1.
		expect(lc(state.getSpellsKnown())).not.toContain("hunter's mark");

		// Level up to 3 → the higher grant appears.
		state._data.classes[0].level = 3;
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("hunter's mark");
	});
});

describe("Class-level always-prepared spells — genericity (non-Cleric)", () => {
	test("TGTT Ranger always prepares Hunter's Mark at class level 1", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Ranger", source: "TGTT", level: 1, subclass: null}];
		state.setClassCatalog([tgttRangerCatalogEntry()]);
		state.applyClassFeatureEffects();

		const hm = state.getSpellsKnown().find(s => s.name.toLowerCase() === "hunter's mark");
		expect(hm).toBeTruthy();
		expect(hm.alwaysPrepared).toBe(true);
		expect(hm.grantedByClass).toBe(true);
		expect(hm.sourceFeature).toBe("Ranger Spells");
		expect(hm.sourceClass).toBe("Ranger");
	});
});

describe("Class-level always-prepared spells — Bard Words of Creation", () => {
	const wordsCatalog = [
		getRealBard("PHB"),
		getRealBard("XPHB"),
		getRealBard("TGTT"),
		{name: "Rogue", source: "XPHB"},
	];

	function getWordsState (classes) {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = classes;
		state.setClassCatalog(wordsCatalog);
		state.applyClassFeatureEffects();
		return state;
	}

	test("TGTT and XPHB Bard data define the same level-20 grant", () => {
		expect(getWordsOfCreationRefs(getRealBard("TGTT"))).toEqual(
			getWordsOfCreationRefs(getRealBard("XPHB")),
		);
		expect(getWordsOfCreationRefs(getRealBard("TGTT"))).toEqual([
			"power word heal|xphb",
			"power word kill|xphb",
		]);
	});

	test.each(["XPHB", "TGTT"])("%s Bard 20 owns both Power Words as always prepared", source => {
		const state = getWordsState([{name: "Bard", source, level: 20, subclass: null}]);
		expect(powerWords(state)).toHaveLength(2);
		for (const spell of powerWords(state)) {
			expect(spell).toMatchObject({
				source: "XPHB",
				level: 9,
				alwaysPrepared: true,
				prepared: true,
				grantedByClass: true,
				sourceFeature: "Bard Spells",
				sourceClass: "Bard",
				classGrantOwners: [`bard|${source.toLowerCase()}`],
			});
		}
	});

	test.each([
		["XPHB Bard 19", [{name: "Bard", source: "XPHB", level: 19, subclass: null}]],
		["XPHB Bard 19 / Rogue 1", [
			{name: "Bard", source: "XPHB", level: 19, subclass: null},
			{name: "Rogue", source: "XPHB", level: 1, subclass: null},
		]],
		["XPHB Bard 17 / Rogue 3", [
			{name: "Bard", source: "XPHB", level: 17, subclass: null},
			{name: "Rogue", source: "XPHB", level: 3, subclass: null},
		]],
		["PHB Bard 20", [{name: "Bard", source: "PHB", level: 20, subclass: null}]],
	])("%s does not receive Words of Creation spells", (_label, classes) => {
		expect(powerWords(getWordsState(classes))).toHaveLength(0);
	});

	test("legacy load repair and repeated recalculation remain idempotent", () => {
		const legacy = new CharacterSheetState();
		legacy._data.classes = [{name: "Bard", source: "TGTT", level: 20, subclass: null}];

		const loaded = new CharacterSheetState();
		loaded.setSpellData(SPELL_DB);
		loaded.setClassCatalog(wordsCatalog);
		expect(loaded.loadFromJson(legacy.toJson())).not.toBe(false);
		loaded.applyClassFeatureEffects();
		loaded.applyClassFeatureEffects();

		expect(powerWords(loaded)).toHaveLength(2);
		expect(new Set(powerWords(loaded).map(spell => `${spell.name}|${spell.source}`.toLowerCase())).size).toBe(2);

		const reloaded = new CharacterSheetState();
		reloaded.setSpellData(SPELL_DB);
		reloaded.setClassCatalog(wordsCatalog);
		expect(reloaded.loadFromJson(loaded.toJson())).not.toBe(false);
		expect(powerWords(reloaded)).toHaveLength(2);
	});

	test("a manual overlay round-trips through save/load and still restores exactly", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Bard", source: "XPHB", level: 20, subclass: null}];
		state.addSpell({
			name: "Power Word Heal",
			source: "XPHB",
			level: 9,
			school: "E",
			sourceFeature: "Spells Prepared",
			sourceClass: "Bard",
		}, false);
		state.setClassCatalog(wordsCatalog);
		state.applyClassFeatureEffects();

		const loaded = new CharacterSheetState();
		loaded.setSpellData(SPELL_DB);
		loaded.setClassCatalog(wordsCatalog);
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		loaded._data.classes[0].level = 19;
		loaded.applyClassFeatureEffects();

		const heal = loaded.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			alwaysPrepared: false,
			prepared: false,
			sourceFeature: "Spells Prepared",
			sourceClass: "Bard",
		});
		expect(heal.classGrantOwners).toBeUndefined();
		expect(heal.classGrantOriginalMetadata).toBeUndefined();
	});

	test("an exact manual copy is temporarily always prepared, then restored on 20 to 19", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Bard", source: "XPHB", level: 20, subclass: null}];
		state.addSpell({
			name: "Power Word Heal",
			source: "XPHB",
			level: 9,
			school: "E",
			sourceFeature: "Spells Known",
			sourceClass: "Wizard",
		}, false);
		state.setClassCatalog(wordsCatalog);
		state.applyClassFeatureEffects();

		let heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			alwaysPrepared: true,
			prepared: true,
			grantedByClass: false,
			sourceFeature: "Bard Spells",
			sourceClass: "Wizard",
			classGrantOwners: ["bard|xphb"],
			classGrantOriginalMetadata: {
				alwaysPrepared: false,
				prepared: false,
				sourceFeature: "Spells Known",
				sourceClass: "Wizard",
			},
		});

		state._data.classes[0].level = 19;
		state.applyClassFeatureEffects();
		heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			alwaysPrepared: false,
			prepared: false,
			grantedByClass: false,
			sourceFeature: "Spells Known",
			sourceClass: "Wizard",
		});
		expect(heal.classGrantOwners).toBeUndefined();
		expect(heal.classGrantOriginalMetadata).toBeUndefined();
	});

	test("an already-prepared manual copy survives teardown without provenance loss", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Bard", source: "TGTT", level: 20, subclass: null}];
		state.addSpell({
			name: "Power Word Kill",
			source: "XPHB",
			level: 9,
			school: "E",
			sourceFeature: "Spells Prepared",
			sourceClass: "Bard",
		}, true);
		state.setClassCatalog(wordsCatalog);
		state.applyClassFeatureEffects();
		state._data.classes[0].level = 19;
		state.applyClassFeatureEffects();

		const kill = state.getSpellsKnown().find(spell => spell.name === "Power Word Kill");
		expect(kill).toMatchObject({
			alwaysPrepared: false,
			prepared: true,
			grantedByClass: false,
			sourceFeature: "Spells Prepared",
			sourceClass: "Bard",
		});
	});

	test("source-qualified owners retain a manual copy until the last class grant is removed", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [
			{name: "Alpha", source: "A", level: 1, subclass: null},
			{name: "Beta", source: "B", level: 1, subclass: null},
		];
		state.addSpell({
			name: "Power Word Heal",
			source: "XPHB",
			level: 9,
			school: "E",
			sourceFeature: "Spells Known",
			sourceClass: "Wizard",
		}, false);
		state.setClassCatalog([
			{name: "Alpha", source: "A", additionalSpells: [{prepared: {1: ["power word heal|xphb"]}}]},
			{name: "Beta", source: "B", additionalSpells: [{prepared: {1: ["power word heal|xphb"]}}]},
		]);
		state.applyClassFeatureEffects();

		let heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal.classGrantOwners).toEqual(["alpha|a", "beta|b"]);
		expect(heal.sourceClass).toBe("Wizard");

		state._data.classes = state._data.classes.filter(cls => cls.name !== "Alpha");
		state.applyClassFeatureEffects();
		heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal.classGrantOwners).toEqual(["beta|b"]);
		expect(heal.alwaysPrepared).toBe(true);

		state._data.classes = [];
		state.applyClassFeatureEffects();
		heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			prepared: false,
			alwaysPrepared: false,
			sourceFeature: "Spells Known",
			sourceClass: "Wizard",
		});
		expect(heal.classGrantOwners).toBeUndefined();
	});
});

describe("Class-level always-prepared spells — collision ownership", () => {
	test("a later Respec spell choice converts a pure class grant into a reversible player-owned overlay", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{name: "Bard", source: "XPHB", level: 20, subclass: null}];
		state.setClassCatalog([getRealBard("PHB"), getRealBard("XPHB"), getRealBard("TGTT")]);
		state.applyClassFeatureEffects();
		const selection = {name: "Power Word Heal", source: "XPHB", level: 9};
		state.claimProgressionOwnership("spells", selection, "preparedSpells:Bard:19");
		state.addSpell({
			...selection,
			school: "E",
			sourceFeature: "Prepared Spells",
			sourceClass: "Bard",
			prepared: true,
		}, true);

		let heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			grantedByClass: false,
			alwaysPrepared: true,
			prepared: true,
			sourceFeature: "Bard Spells",
			classGrantOriginalMetadata: {
				alwaysPrepared: false,
				prepared: true,
				sourceFeature: "Prepared Spells",
				sourceClass: "Bard",
			},
		});

		state._data.classes[0].level = 19;
		state.applyClassFeatureEffects();
		heal = state.getSpellsKnown().find(spell => spell.name === "Power Word Heal");
		expect(heal).toMatchObject({
			grantedByClass: false,
			alwaysPrepared: false,
			prepared: true,
			sourceFeature: "Prepared Spells",
			sourceClass: "Bard",
		});
		expect(state._getProgressionOwnershipEntry("spells", selection)?.sources).toContain("preparedSpells:Bard:19");
	});

	test("a player-chosen cantrip is temporarily class-granted and restored on teardown", () => {
		const state = newClericState({level: 1});
		state.addCantrip({
			name: "Thaumaturgy",
			source: "XPHB",
			level: 0,
			school: "T",
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
		});
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		let thaumaturgy = state.getCantripsKnown().find(spell => spell.name === "Thaumaturgy");
		expect(thaumaturgy).toMatchObject({
			sourceFeature: "Cleric Spells",
			sourceClass: "Cleric",
			classGrantOwners: ["cleric|tgtt"],
			classGrantOriginalMetadata: {
				sourceFeature: "Cantrips Known",
				sourceClass: "Cleric",
			},
		});

		state._data.classes = [];
		state.applyClassFeatureEffects();
		thaumaturgy = state.getCantripsKnown().find(spell => spell.name === "Thaumaturgy");
		expect(thaumaturgy).toMatchObject({
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
		});
		expect(thaumaturgy.classGrantOwners).toBeUndefined();
	});

	test("a later Respec cantrip choice converts a pure class grant into a reversible player-owned overlay", () => {
		const state = newClericState({level: 1});
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		const selection = {name: "Thaumaturgy", source: "XPHB", level: 0};
		state.claimProgressionOwnership("cantrips", selection, "cantrips:Cleric:1");
		state.addCantrip({
			...selection,
			school: "T",
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
		});

		let thaumaturgy = state.getCantripsKnown().find(spell => spell.name === "Thaumaturgy");
		expect(thaumaturgy).toMatchObject({
			grantedByClass: false,
			sourceFeature: "Cleric Spells",
			classGrantOriginalMetadata: {
				sourceFeature: "Cantrips Known",
				sourceClass: "Cleric",
			},
		});

		state._data.classes = [];
		state.applyClassFeatureEffects();
		thaumaturgy = state.getCantripsKnown().find(spell => spell.name === "Thaumaturgy");
		expect(thaumaturgy).toMatchObject({
			grantedByClass: false,
			sourceFeature: "Cantrips Known",
			sourceClass: "Cleric",
		});
		expect(state._getProgressionOwnershipEntry("cantrips", selection)?.sources).toContain("cantrips:Cleric:1");
	});

	test("a colliding subclass grant keeps its attribution so subclass teardown can remove it", () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state._data.classes = [{
			name: "Cleric",
			source: "TGTT",
			level: 1,
			subclass: {
				name: "Test Domain",
				shortName: "Test",
				source: "TGTT",
				additionalSpells: [{prepared: {1: ["ceremony|xphb"]}}],
			},
		}];
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		let ceremony = state.getSpellsKnown().find(spell => spell.name === "Ceremony");
		expect(ceremony).toMatchObject({
			alwaysPrepared: true,
			sourceFeature: "Test Domain Spells",
			sourceClass: "Cleric",
			classGrantOwners: ["cleric|tgtt"],
		});

		state.removeSubclassSpells("Test Domain Spells");
		state._data.classes[0].subclass = null;
		state.applyClassFeatureEffects();
		ceremony = state.getSpellsKnown().find(spell => spell.name === "Ceremony");
		expect(ceremony).toMatchObject({
			alwaysPrepared: true,
			grantedByClass: true,
			sourceFeature: "Cleric Spells",
			sourceClass: "Cleric",
		});
		expect(state.getSpellsKnown().filter(spell => spell.name === "Ceremony")).toHaveLength(1);
	});
});

describe("Class-level always-prepared spells — teardown on removal / level-down", () => {
	test("removing the class tears down its class-granted spells", () => {
		const state = newClericState();
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();
		expect(lc(state.getSpellsKnown())).toContain("ceremony");

		// Remove the Cleric class and re-reconcile.
		state._data.classes = [];
		state.applyClassFeatureEffects();

		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");
		expect(lc(state.getCantripsKnown())).not.toContain("thaumaturgy");
	});

	test("a same-named PLAYER-OWNED spell is NOT deleted when the class is removed", () => {
		const state = newClericState();
		// Player independently learned Ceremony (their own copy, different source, player tag).
		state.addSpell({name: "Ceremony", source: "PHB", level: 1, school: "A", sourceFeature: "Spells Known", sourceClass: "Cleric"}, true);
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		// Both exist now: the class-granted XPHB one + the player's PHB one.
		const ceremonies = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		expect(ceremonies.length).toBeGreaterThanOrEqual(2);

		// Remove the class.
		state._data.classes = [];
		state.applyClassFeatureEffects();

		const remaining = state.getSpellsKnown().filter(s => s.name.toLowerCase() === "ceremony");
		expect(remaining).toHaveLength(1);
		const survivor = remaining[0];
		expect(survivor.source).toBe("PHB");
		expect(survivor.grantedByClass).toBeFalsy();
		expect(survivor.sourceFeature).toBe("Spells Known");
	});
});

describe("Class-level always-prepared spells — existing save auto-fix on load", () => {
	const FIXTURE = path.join(__dirname, "fixtures", "lorian-tempest-cleric.json");

	test("a stored L10 TGTT Cleric gains Ceremony/Thaumaturgy WITHOUT editing the save", () => {
		const raw = fs.readFileSync(FIXTURE, "utf8");
		const before = JSON.parse(raw);

		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state.loadFromJson(before);

		// Before catalog wiring the class spells are absent (stored save predates the fix).
		expect(lc(state.getSpellsKnown())).not.toContain("ceremony");

		// Drive the exact page wiring: catalog then re-apply.
		state.setClassCatalog([tgttClericCatalogEntry()]);
		state.applyClassFeatureEffects();

		expect(lc(state.getSpellsKnown())).toContain("ceremony");
		expect(lc(state.getCantripsKnown())).toContain("thaumaturgy");
		const ceremony = state.getSpellsKnown().find(s => s.name.toLowerCase() === "ceremony");
		expect(ceremony.alwaysPrepared).toBe(true);
		expect(ceremony.grantedByClass).toBe(true);

		// The on-disk save file is untouched (auto-fix is derived on load).
		expect(fs.readFileSync(FIXTURE, "utf8")).toBe(raw);
	});

	test("the page wires setClassCatalog + applyClassFeatureEffects in the reconcile block", () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		expect(src).toMatch(/this\._state\.setClassCatalog\(this\._classes\b/);
		// The reconcile block re-applies effects so populate runs with the catalog available.
		const idxCatalog = src.indexOf("setClassCatalog(this._classes");
		const idxApply = src.indexOf("applyClassFeatureEffects()", idxCatalog);
		expect(idxCatalog).toBeGreaterThan(-1);
		expect(idxApply).toBeGreaterThan(idxCatalog);
	});

	test("page initialization installs the merged class catalog before loading or building a character", () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const pInit = src.match(/async pInit \(\)\s*\{[\s\S]*?\n\t\}/)?.[0] || "";
		const idxData = pInit.indexOf("await this._pLoadData()");
		const idxSpells = pInit.indexOf("this._state.setSpellData(this._spellsData)");
		const idxClasses = pInit.indexOf("this._state.setClassCatalog(this._classes || [])");
		const idxUrlLoad = pInit.indexOf("await this._pLoadCharacter(charId)");
		expect(idxData).toBeGreaterThan(-1);
		expect(idxSpells).toBeGreaterThan(idxData);
		expect(idxClasses).toBeGreaterThan(idxSpells);
		expect(idxUrlLoad).toBeGreaterThan(idxClasses);
	});
});
