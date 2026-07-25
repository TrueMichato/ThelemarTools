/**
 * Tests for the spawner's choice picker and prompt auto-answer layer.
 *
 * These cover the two pieces that decide *what* a spawned character ends up
 * with: `CharacterSheetSpawnPicker` (spec-override-then-seeded-pick precedence)
 * and `CharacterSheetSpawnPrompts` (turning the sheet's interactive prompts into
 * automatic, recorded answers).
 */

import "../../../js/charactersheet/charactersheet-spawn.js";
import "../../../js/charactersheet/charactersheet-spawn-prompts.js";

const CharacterSheetSpawnRng = globalThis.CharacterSheetSpawnRng;
const CharacterSheetSpawnSpec = globalThis.CharacterSheetSpawnSpec;
const CharacterSheetSpawnReport = globalThis.CharacterSheetSpawnReport;
const CharacterSheetSpawnPicker = globalThis.CharacterSheetSpawnPicker;
const CharacterSheetSpawnPrompts = globalThis.CharacterSheetSpawnPrompts;

/**
 * @param {*} specInput
 * @returns {{spec: *, rng: *, report: *, picker: *}}
 */
const mkPicker = (specInput = "fighter/champion/5") => {
	const spec = CharacterSheetSpawnSpec.parse(specInput);
	const rng = new CharacterSheetSpawnRng(spec.seed || "seed");
	const report = new CharacterSheetSpawnReport(spec);
	return {spec, rng, report, picker: new CharacterSheetSpawnPicker({spec, rng, report})};
};

describe("CharacterSheetSpawnPicker", () => {
	describe("precedence", () => {
		it("prefers a spec override over an auto-pick", () => {
			const {picker, report} = mkPicker({classes: [{name: "Fighter", level: 5}], choices: {optionalFeatures: {"FS:F": ["Defense"]}}});
			const chosen = picker.pickOne({
				bucket: "optionalFeatures",
				kind: "optionalFeature",
				key: "FS:F",
				options: [{name: "Archery"}, {name: "Defense"}, {name: "Duelling"}],
			});
			expect(chosen.name).toBe("Defense");
			expect(report.choices[0].from).toBe("spec");
		});

		it("matches overrides loosely (case, punctuation, filler words)", () => {
			const {picker} = mkPicker({classes: [{name: "Druid", level: 3}], choices: {subclasses: ["moon"]}});
			const chosen = picker.pickOne({
				bucket: "subclasses",
				kind: "subclass",
				options: [{name: "Circle of the Land"}, {name: "Circle of the Moon"}],
			});
			expect(chosen.name).toBe("Circle of the Moon");
		});

		it("matches space-free option keys against human-written names", () => {
			const {picker} = mkPicker({classes: [{name: "Rogue", level: 1}], choices: {skills: ["Sleight of Hand"]}});
			const chosen = picker.pickOne({bucket: "skills", kind: "skill", options: ["stealth", "sleightofhand", "acrobatics"]});
			expect(chosen).toBe("sleightofhand");
		});

		it("consumes each override once, so repeated prompts walk the list", () => {
			const {picker} = mkPicker({classes: [{name: "Rogue", level: 1}], choices: {skills: ["Stealth", "Perception"]}});
			const options = ["stealth", "perception", "acrobatics"];
			const first = picker.pickOne({bucket: "skills", kind: "skill", options});
			const second = picker.pickOne({bucket: "skills", kind: "skill", options});
			expect(first).toBe("stealth");
			expect(second).toBe("perception");
		});

		it("falls back to an auto-pick when the override does not match", () => {
			const {picker, report} = mkPicker({classes: [{name: "Fighter", level: 1}], choices: {skills: ["Arcana"]}});
			const chosen = picker.pickOne({bucket: "skills", kind: "skill", options: ["athletics", "intimidation"]});
			expect(["athletics", "intimidation"]).toContain(chosen);
			expect(report.choices[0].from).toBe("auto");
		});
	});

	describe("pickMany", () => {
		it("returns distinct options and fills the remainder automatically", () => {
			const {picker, report} = mkPicker({classes: [{name: "Ranger", level: 1}], choices: {skills: ["Survival"]}});
			const chosen = picker.pickMany({bucket: "skills", kind: "skill", count: 3, options: ["survival", "stealth", "perception", "athletics"]});
			expect(chosen).toHaveLength(3);
			expect(new Set(chosen).size).toBe(3);
			expect(chosen[0]).toBe("survival");
			expect(report.choices.map(c => c.from)).toEqual(["spec", "auto", "auto"]);
		});

		it("flags an unresolved choice when there are not enough options", () => {
			const {picker, report} = mkPicker();
			const chosen = picker.pickMany({bucket: "skills", kind: "skill", count: 3, options: ["stealth"]});
			expect(chosen).toHaveLength(1);
			expect(report.isClean).toBe(false);
			expect(report.unresolved[0]).toMatch(/needed 3/);
		});

		it("flags an unresolved choice when there are no options at all", () => {
			const {picker, report} = mkPicker();
			expect(picker.pickMany({bucket: "skills", kind: "skill", count: 2, options: []})).toEqual([]);
			expect(report.unresolved[0]).toMatch(/no eligible options/);
		});

		it("is a no-op when nothing is being asked for", () => {
			const {picker, report} = mkPicker();
			expect(picker.pickMany({bucket: "skills", kind: "skill", count: 0, options: ["stealth"]})).toEqual([]);
			expect(report.choices).toHaveLength(0);
			expect(report.isClean).toBe(true);
		});
	});

	describe("determinism", () => {
		it("makes identical picks for identical seeds", () => {
			const options = ["a", "b", "c", "d", "e", "f"];
			const run = () => {
				const {picker} = mkPicker("wizard/evocation/7/elf");
				return picker.pickMany({bucket: "skills", kind: "skill", count: 3, options});
			};
			expect(run()).toEqual(run());
		});

		it("makes different picks for different seeds", () => {
			const options = ["a", "b", "c", "d", "e", "f", "g", "h"];
			const run = (/** @type {string} */ seed) => {
				const spec = CharacterSheetSpawnSpec.parse("wizard/evocation/7/elf");
				spec.seed = seed;
				const report = new CharacterSheetSpawnReport(spec);
				const picker = new CharacterSheetSpawnPicker({spec, rng: new CharacterSheetSpawnRng(seed), report});
				return picker.pickMany({bucket: "skills", kind: "skill", count: 3, options}).join(",");
			};
			expect(run("alpha")).not.toBe(run("omega"));
		});
	});

	describe("peekOverride", () => {
		it("returns a raw scalar answer and consumes it", () => {
			const {picker} = mkPicker({classes: [{name: "Fighter", level: 1}], choices: {prompts: {"Choose a Damage Type": ["fire"]}}});
			expect(picker.peekOverride("prompts", "Choose a Damage Type")).toBe("fire");
			expect(picker.peekOverride("prompts", "Choose a Damage Type")).toBeNull();
		});

		it("returns null when there is no override", () => {
			const {picker} = mkPicker();
			expect(picker.peekOverride("prompts", "Anything")).toBeNull();
		});
	});

	describe("reportUnusedOverrides", () => {
		it("warns about an override that never matched anything", () => {
			const {picker, report} = mkPicker({classes: [{name: "Fighter", level: 1}], choices: {skills: ["Arcanaa"]}});
			picker.pickOne({bucket: "skills", kind: "skill", options: ["athletics"]});
			picker.reportUnusedOverrides();
			expect(report.warnings.join(" ")).toMatch(/Arcanaa/);
		});

		it("stays quiet when every override was used", () => {
			const {picker, report} = mkPicker({classes: [{name: "Fighter", level: 1}], choices: {skills: ["Athletics"]}});
			picker.pickOne({bucket: "skills", kind: "skill", options: ["athletics"]});
			picker.reportUnusedOverrides();
			expect(report.warnings).toHaveLength(0);
		});
	});
});

describe("CharacterSheetSpawnPrompts", () => {
	/** @type {*} */ let page;
	/** @type {*} */ let prompts;
	/** @type {*} */ let ctx;

	/**
	 * A stand-in for the parts of the sheet the prompt layer patches.
	 * @param {*} specInput
	 */
	const setup = (specInput = "cleric/tempest/5/dwarf") => {
		ctx = mkPicker(specInput);
		page = {
			_pPickFeatureChoice: async () => "ORIGINAL",
			getFilteredSpellData: () => [
				{name: "Bless", source: "PHB", level: 1},
				{name: "Bane", source: "PHB", level: 1},
				{name: "Misty Step", source: "PHB", level: 2},
			],
			getState: () => ({getSpells: () => [], getInnateSpells: () => [], getClasses: () => []}),
			_spells: {
				showFilteredSpellPicker: async () => { throw new Error("original picker should not run"); },
				_pShowScribingSpellPicker: async () => { throw new Error("original picker should not run"); },
				_parseSpellFilter: (/** @type {*} */ f) => ({level: f?.level}),
				_filterSpellsByCriteria: (/** @type {*} */ spells, /** @type {*} */ criteria) => spells.filter((/** @type {*} */ s) => criteria.level == null || s.level === criteria.level),
				_state: {getSpells: () => [], getInnateSpells: () => [], getClasses: () => []},
			},
		};
		prompts = new CharacterSheetSpawnPrompts({page, picker: ctx.picker, report: ctx.report, spec: ctx.spec});
	};

	beforeEach(() => {
		globalThis.InputUiUtil = {
			pGetUserEnum: async () => { throw new Error("original prompt should not run"); },
			pGetUserMultipleChoice: async () => { throw new Error("original prompt should not run"); },
			pGetUserBoolean: async () => { throw new Error("original prompt should not run"); },
			pGetUserString: async () => { throw new Error("original prompt should not run"); },
			pGetUserNumber: async () => { throw new Error("original prompt should not run"); },
		};
		globalThis.UiUtil = {pGetShowModal: async () => ({eleModalInner: null, doClose: () => {}})};
		setup();
	});

	afterEach(() => {
		prompts?.uninstall();
		delete globalThis.InputUiUtil;
		delete globalThis.UiUtil;
	});

	describe("install/uninstall", () => {
		it("restores every patched method, including inherited ones", async () => {
			class Base { async _pPickFeatureChoice () { return "FROM_PROTOTYPE"; } }
			const protoPage = new Base();
			protoPage._spells = null;
			const p = new CharacterSheetSpawnPrompts({page: protoPage, picker: ctx.picker, report: ctx.report, spec: ctx.spec});
			p.install();
			expect(Object.prototype.hasOwnProperty.call(protoPage, "_pPickFeatureChoice")).toBe(true);
			p.uninstall();
			expect(Object.prototype.hasOwnProperty.call(protoPage, "_pPickFeatureChoice")).toBe(false);
			await expect(protoPage._pPickFeatureChoice()).resolves.toBe("FROM_PROTOTYPE");
		});

		it("is idempotent", () => {
			const original = globalThis.InputUiUtil.pGetUserEnum;
			prompts.install();
			prompts.install();
			prompts.uninstall();
			prompts.uninstall();
			expect(globalThis.InputUiUtil.pGetUserEnum).toBe(original);
		});
	});

	describe("feature choices", () => {
		it("answers a skill choice with the raw skill key", async () => {
			prompts.install();
			const out = await page._pPickFeatureChoice({id: "c1", featureName: "Skillful", kind: "skill", options: ["stealth", "arcana"]});
			expect(["stealth", "arcana"]).toContain(out);
			expect(typeof out).toBe("string");
		});

		it("answers a cantrip choice with a {name, source} object", async () => {
			prompts.install();
			const out = await page._pPickFeatureChoice({id: "c2", featureName: "High Elf", kind: "cantrip", options: [{name: "Fire Bolt", source: "PHB", extra: "drop me"}]});
			expect(out).toEqual({name: "Fire Bolt", source: "PHB"});
		});

		it("honours a spec override for a sub-feature choice", async () => {
			setup({classes: [{name: "Cleric", level: 3}], choices: {featureOptions: {"Divine Order": ["Thaumaturge"]}}});
			prompts.install();
			const out = await page._pPickFeatureChoice({id: "c3", featureName: "Divine Order", kind: "subfeature", options: [{name: "Protector", source: "XPHB"}, {name: "Thaumaturge", source: "XPHB"}]});
			expect(out.name).toBe("Thaumaturge");
			expect(ctx.report.choices.at(-1).from).toBe("spec");
		});

		it("returns null for an empty choice rather than inventing an answer", async () => {
			prompts.install();
			expect(await page._pPickFeatureChoice({id: "c4", kind: "skill", options: []})).toBeNull();
		});
	});

	describe("spell pickers", () => {
		it("picks from the same filtered pool the real picker would offer", async () => {
			prompts.install();
			/** @type {*} */ let selected = null;
			await page._spells.showFilteredSpellPicker({featureName: "Fey Touched", filter: {level: 1}}, async (/** @type {*} */ s) => { selected = s; });
			expect(["Bless", "Bane"]).toContain(selected.name);
		});

		it("honours a spec override for a feature-granted spell", async () => {
			setup({classes: [{name: "Fighter", level: 4}], choices: {spells: ["Bane"]}});
			prompts.install();
			/** @type {*} */ let selected = null;
			await page._spells.showFilteredSpellPicker({featureName: "Fey Touched", filter: {level: 1}}, async (/** @type {*} */ s) => { selected = s; });
			expect(selected.name).toBe("Bane");
		});

		it("records a warning and skips selection when the filter cannot be evaluated", async () => {
			page._spells._parseSpellFilter = () => { throw new Error("bad filter"); };
			prompts.install();
			/** @type {*} */ let selected = null;
			await page._spells.showFilteredSpellPicker({featureName: "Broken", filter: "???"}, async (/** @type {*} */ s) => { selected = s; });
			expect(selected).toBeNull();
			expect(ctx.report.warnings.join(" ")).toMatch(/bad filter/);
		});
	});

	describe("generic input prompts", () => {
		it("resolves an enum to an index by default", async () => {
			prompts.install();
			const ix = await globalThis.InputUiUtil.pGetUserEnum({title: "Choose a Class", values: ["Fighter", "Wizard"]});
			expect([0, 1]).toContain(ix);
		});

		it("resolves an enum to the item when isResolveItem is set", async () => {
			prompts.install();
			const item = await globalThis.InputUiUtil.pGetUserEnum({title: "Choose a Class", values: ["Fighter", "Wizard"], isResolveItem: true});
			expect(["Fighter", "Wizard"]).toContain(item);
		});

		it("honours a spec override keyed on the prompt title, via fnDisplay labels", async () => {
			setup({classes: [{name: "Fighter", level: 1}], choices: {prompts: {"Choose a Damage Type": ["Fire"]}}});
			prompts.install();
			const item = await globalThis.InputUiUtil.pGetUserEnum({
				title: "Choose a Damage Type",
				values: [{k: "cold"}, {k: "fire"}],
				fnDisplay: (/** @type {*} */ v) => v.k.toUpperCase(),
				isResolveItem: true,
			});
			expect(item.k).toBe("fire");
		});

		it("returns extra state alongside the pick when fnGetExtraState is passed", async () => {
			prompts.install();
			const out = await globalThis.InputUiUtil.pGetUserEnum({title: "T", values: ["a"], fnGetExtraState: () => ({flag: 1})});
			expect(out).toEqual({ix: 0, extraState: {flag: 1}});
		});

		it("returns sorted indices for a multiple-choice prompt", async () => {
			prompts.install();
			const idxs = await globalThis.InputUiUtil.pGetUserMultipleChoice({title: "Pick two", values: ["a", "b", "c", "d"], count: 2});
			expect(idxs).toHaveLength(2);
			expect([...idxs].sort((x, y) => x - y)).toEqual(idxs);
		});

		it("always includes required indices and does not double-count them", async () => {
			prompts.install();
			const idxs = await globalThis.InputUiUtil.pGetUserMultipleChoice({title: "Pick two", values: ["a", "b", "c", "d"], count: 2, required: [0]});
			expect(idxs).toContain(0);
			expect(idxs).toHaveLength(2);
		});

		it("flattens valueGroups and can resolve to items", async () => {
			prompts.install();
			const items = await globalThis.InputUiUtil.pGetUserMultipleChoice({
				title: "Pick one",
				valueGroups: [{name: "G1", values: ["a", "b"]}, {name: "G2", values: ["c"]}],
				count: 1,
				isResolveItems: true,
			});
			expect(items).toHaveLength(1);
			expect(["a", "b", "c"]).toContain(items[0]);
		});

		it("answers booleans affirmatively unless the spec says otherwise", async () => {
			prompts.install();
			expect(await globalThis.InputUiUtil.pGetUserBoolean({title: "Apply?"})).toBe(true);

			setup({classes: [{name: "Fighter", level: 1}], choices: {prompts: {"Apply?": ["no"]}}});
			prompts.install();
			expect(await globalThis.InputUiUtil.pGetUserBoolean({title: "Apply?"})).toBe(false);
		});

		it("answers strings and numbers with defaults", async () => {
			prompts.install();
			expect(await globalThis.InputUiUtil.pGetUserString({title: "Name", default: "Bob"})).toBe("Bob");
			expect(await globalThis.InputUiUtil.pGetUserNumber({title: "How many", default: 3})).toBe(3);
			expect(await globalThis.InputUiUtil.pGetUserNumber({title: "How many", min: 2})).toBe(2);
		});

		it("records every prompt answer in the report", async () => {
			prompts.install();
			await globalThis.InputUiUtil.pGetUserBoolean({title: "Apply?"});
			await globalThis.InputUiUtil.pGetUserString({title: "Name", default: "Bob"});
			const kinds = ctx.report.choices.map((/** @type {*} */ c) => c.kind);
			expect(kinds).toEqual(["prompt:boolean", "prompt:string"]);
		});
	});

	describe("unknown-modal watchdog", () => {
		it("records the modal title and closes it instead of hanging", async () => {
			let didClose = false;
			globalThis.UiUtil.pGetShowModal = async () => ({eleModalInner: {}, doClose: () => { didClose = true; }});
			prompts.install();

			const handle = await globalThis.UiUtil.pGetShowModal({title: "Choose a Combat Tradition"});
			expect(ctx.report.unhandledPrompts).toContain("Choose a Combat Tradition");
			expect(ctx.report.isClean).toBe(false);
			await new Promise(resolve => setTimeout(resolve, 1));
			expect(didClose).toBe(true);
			expect(handle).toBeDefined();
		});
	});
});

describe("CharacterSheetSpawnPicker — ability allocation", () => {
	const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

	it("follows the class ability priority instead of the seed", () => {
		const {picker} = mkPicker("warlock/fiend/3");
		picker.setAbilityPriority(["cha", "con", "dex", "wis", "str", "int"]);

		const chosen = picker.pickMany({
			bucket: "options",
			kind: "option",
			key: "+2:",
			count: 2,
			options: ABILITIES,
			nameOf: o => o,
		});

		expect(chosen).toEqual(["Charisma", "Constitution"]);
	});

	it("matches abbreviations and decorated labels", () => {
		const {picker} = mkPicker("wizard/evocation/5");
		picker.setAbilityPriority(["int", "con", "dex", "wis", "cha", "str"]);

		expect(picker.pickOne({bucket: "options", kind: "option", count: 1, options: ["STR", "INT", "CHA"], nameOf: o => o})).toBe("INT");
		expect(picker.pickOne({bucket: "options", kind: "option", count: 1, options: ["Wisdom (+2)", "Intelligence (+2)"], nameOf: o => o})).toBe("Intelligence (+2)");
	});

	it("leaves non-ability lists to the seeded RNG", () => {
		const {picker} = mkPicker("cleric/tempest/9");
		picker.setAbilityPriority(["wis", "con", "dex", "cha", "str", "int"]);

		const chosen = picker.pickOne({
			bucket: "options",
			kind: "option",
			count: 1,
			options: ["Acrobatics", "Insight", "Medicine"],
			nameOf: o => o,
		});
		expect(["Acrobatics", "Insight", "Medicine"]).toContain(chosen);
	});

	it("does not treat a mixed list as an ability allocation", () => {
		const {picker} = mkPicker("cleric/tempest/9");
		picker.setAbilityPriority(["wis", "con", "dex", "cha", "str", "int"]);

		// "Strength" is an ability, "Athletics" is not — so this is a skill list
		// that merely mentions an ability, and must not be reordered.
		const options = ["Athletics", "Strength"];
		const seen = new Set();
		for (let i = 0; i < 8; ++i) {
			const {picker: p} = mkPicker({classes: [{name: "Cleric", level: 9}], seed: `s${i}`});
			p.setAbilityPriority(["str", "con", "dex", "wis", "cha", "int"]);
			seen.add(p.pickOne({bucket: "options", kind: "option", count: 1, options, nameOf: o => o}));
		}
		expect(seen.size).toBe(2);
	});

	it("still honours an explicit spec override", () => {
		const {picker} = mkPicker({classes: [{name: "Warlock", level: 3}], choices: {options: {"+2:": ["Wisdom"]}}});
		picker.setAbilityPriority(["cha", "con", "dex", "wis", "str", "int"]);

		expect(picker.pickOne({bucket: "options", kind: "option", key: "+2:", count: 1, options: ABILITIES, nameOf: o => o})).toBe("Wisdom");
	});
});

describe("CharacterSheetSpawnPicker — source preference", () => {
	/** The Quick Build mastery pool is unfiltered, so it offers XDMG firearms. */
	const MASTERY_POOL = ["Dagger|XPHB", "Shortsword|XPHB", "Laser Rifle|XDMG", "Shotgun|XDMG", "Antimatter Rifle|XDMG"];

	it("keeps picks inside the character's own sources", () => {
		for (let i = 0; i < 12; ++i) {
			const {picker} = mkPicker({classes: [{name: "Rogue", level: 4}], seed: `s${i}`});
			picker.setSourcePreference(["PHB", "XPHB", "TGTT"]);

			const chosen = picker.pickMany({bucket: "options", kind: "option", count: 2, options: MASTERY_POOL, nameOf: o => o});
			expect(chosen).toHaveLength(2);
			chosen.forEach(name => expect(name.endsWith("|XPHB")).toBe(true));
		}
	});

	it("falls back to the full pool rather than starving the pick", () => {
		const {picker} = mkPicker("rogue/thief/4");
		picker.setSourcePreference(["PHB", "XPHB", "TGTT"]);

		// Only one preferred option, but three slots — better an off-source pick than a gap.
		const chosen = picker.pickMany({bucket: "options", kind: "option", count: 3, options: MASTERY_POOL, nameOf: o => o});
		expect(chosen).toHaveLength(3);
	});

	it("leaves source-free pools alone", () => {
		const options = ["Acrobatics", "Insight", "Medicine", "Stealth"];
		const seen = new Set();
		for (let i = 0; i < 10; ++i) {
			const {picker} = mkPicker({classes: [{name: "Rogue", level: 4}], seed: `s${i}`});
			picker.setSourcePreference(["PHB", "XPHB"]);
			seen.add(picker.pickOne({bucket: "options", kind: "option", count: 1, options, nameOf: o => o}));
		}
		expect(seen.size).toBeGreaterThan(1);
	});

	it("reads `source` off object options too", () => {
		const {picker} = mkPicker("rogue/thief/4");
		picker.setSourcePreference(["XPHB"]);

		const options = [{name: "Dagger", source: "XPHB"}, {name: "Laser Rifle", source: "XDMG"}];
		expect(picker.pickOne({bucket: "options", kind: "option", count: 1, options}).name).toBe("Dagger");
	});

	it("does nothing until a preference is set", () => {
		const seen = new Set();
		for (let i = 0; i < 12; ++i) {
			const {picker} = mkPicker({classes: [{name: "Rogue", level: 4}], seed: `s${i}`});
			seen.add(picker.pickOne({bucket: "options", kind: "option", count: 1, options: MASTERY_POOL, nameOf: o => o}));
		}
		expect([...seen].some(name => name.endsWith("|XDMG"))).toBe(true);
	});
});

describe("CharacterSheetSpawnPicker — attempt (controls that silently refuse)", () => {
	it("moves to the next-best option when the best one is inert", () => {
		const {picker} = mkPicker({classes: [{name: "Bard", level: 12}]});
		picker.setAbilityPriority(["cha", "con", "dex", "wis", "int", "str"]);

		// Charisma is capped, so its `+` button does nothing — exactly the ASI step
		// that used to loop the Quick Build wizard forever.
		const capped = new Set(["Charisma"]);
		const chosen = picker.pickOne({
			bucket: "abilities",
			kind: "abilityIncrease",
			count: 1,
			options: ["Charisma", "Constitution", "Dexterity"],
			nameOf: o => o,
			attempt: o => !capped.has(o),
		});
		expect(chosen).toBe("Constitution");
	});

	it("does not report an option that refused", () => {
		const {picker, report} = mkPicker({classes: [{name: "Bard", level: 12}]});
		picker.setAbilityPriority(["cha", "con", "dex", "wis", "int", "str"]);

		picker.pickOne({
			bucket: "abilities",
			kind: "abilityIncrease",
			count: 1,
			options: ["Charisma", "Constitution"],
			nameOf: o => o,
			attempt: o => o !== "Charisma",
		});
		expect(report.choices.map(c => c.chosen)).toEqual(["Constitution"]);
	});

	it("returns nothing when every option refuses", () => {
		const {picker, report} = mkPicker({classes: [{name: "Bard", level: 12}]});

		const chosen = picker.pickOne({
			bucket: "abilities",
			kind: "abilityIncrease",
			count: 1,
			options: ["Charisma", "Constitution"],
			nameOf: o => o,
			attempt: () => false,
		});
		expect(chosen).toBeNull();
		expect(report.choices).toHaveLength(0);
	});

	it("keeps a spec override unconsumed when the control refuses it", () => {
		const {picker} = mkPicker({classes: [{name: "Bard", level: 12}], choices: {abilities: ["Charisma"]}});

		// First control is capped, so the override must survive for the next one.
		expect(picker.pickOne({bucket: "abilities", kind: "abilityIncrease", count: 1, options: ["Charisma", "Constitution"], nameOf: o => o, attempt: () => false})).toBeNull();
		expect(picker.pickOne({bucket: "abilities", kind: "abilityIncrease", count: 1, options: ["Charisma", "Constitution"], nameOf: o => o})).toBe("Charisma");
	});
});
