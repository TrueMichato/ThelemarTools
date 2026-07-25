import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

/**
 * Forest Sage is a homebrew half-feat (Humblewood Tales). It:
 *  - grants a +1 ASI (int OR wis) — already handled elsewhere, out of scope here
 *  - lets the player learn TWO druid/wizard spells (additionalSpells choose count:2)
 *  - lets you use your choice of Int or Wis for Animal Handling, Arcana, Nature, Survival
 *
 * These tests also cover the generic mechanisms the fixes introduce:
 *  - SpellGrantParser respecting `count` on choose-blocks
 *  - the `skipAdditionalSpellChoices` opt that prevents double-grant in picker flows
 *  - deriving `description` from `entries` in addFeat
 *  - the "use your choice of A or B to make <skills> checks" abilitySwap text pattern
 *  - itemized named-modifier attribution in the skill breakdown
 */
const FOREST_SAGE_ENTRIES = [
	"The Tenders value diversity of thought and experience.",
	{
		type: "list",
		items: [
			"You can use your choice of Intelligence or Wisdom to make {@skill Animal Handling}, {@skill Arcana}, {@skill Nature}, or {@skill Survival} checks.",
			"You can choose to learn two spells from either the druid or wizard spell list. The spells you learn must be of a level for which you have spell slots.",
		],
	},
];

const makeForestSage = (overrides = {}) => ({
	name: "Forest Sage",
	source: "HumblewoodTales",
	ability: [{choose: {from: ["int", "wis"], amount: 1}}],
	additionalSpells: [{known: {"_": [{choose: "class=druid;wizard", count: 2}]}}],
	entries: FOREST_SAGE_ENTRIES,
	...overrides,
});

describe("Forest Sage — spell choice count (Bug 1a)", () => {
	describe("SpellGrantParser respects `count` on choose-blocks", () => {
		test("choose with count:2 yields TWO pending-choice entries", () => {
			const spells = globalThis.SpellGrantParser
				? globalThis.SpellGrantParser.parseAdditionalSpells(
					[{known: {"_": [{choose: "class=druid;wizard", count: 2}]}}], "Forest Sage")
				: null;
			// SpellGrantParser is internal; if not exposed, fall through to the addFeat assertion below.
			if (spells) {
				const choices = spells.filter(s => s.requiresChoice);
				expect(choices.length).toBe(2);
				choices.forEach(c => expect(c.choiceFilter).toBe("class=druid;wizard"));
			}
		});

		test("choose without count yields ONE pending-choice entry (back-compat)", () => {
			if (!globalThis.SpellGrantParser) return;
			const spells = globalThis.SpellGrantParser.parseAdditionalSpells(
				[{known: {"_": [{choose: "class=wizard"}]}}], "Test");
			expect(spells.filter(s => s.requiresChoice).length).toBe(1);
		});
	});

	test("Features-tab flow (no skip flag): Forest Sage creates 2 pending spell choices", () => {
		const state = new CharacterSheetState();
		state.addFeat(makeForestSage());

		const pending = state.getPendingSpellChoices();
		const forestSagePending = pending.filter(p => p.featureName === "Forest Sage");
		expect(forestSagePending.length).toBe(2);
		forestSagePending.forEach(p => expect(p.filter).toBe("class=druid;wizard"));
	});

	test("Picker flow (skipAdditionalSpellChoices): no pending choose-choices created", () => {
		const state = new CharacterSheetState();
		state.addFeat(makeForestSage(), {skipAdditionalSpellChoices: true});

		const pending = state.getPendingSpellChoices().filter(p => p.featureName === "Forest Sage");
		expect(pending.length).toBe(0);
	});

	test("skip flag suppresses ONLY choose-spells; fixed additionalSpells still granted", () => {
		const state = new CharacterSheetState();
		// Feat with BOTH a fixed grant (mage hand cantrip) and a choose block.
		state.addFeat({
			name: "Mixed Grant Feat",
			source: "TEST",
			additionalSpells: [{
				known: {"_": ["mage hand#c", {choose: "class=wizard", count: 2}]},
			}],
		}, {skipAdditionalSpellChoices: true});

		// Fixed cantrip still granted
		const mageHand = state.getCantrips().find(c => c.name === "Mage Hand");
		expect(mageHand).toBeTruthy();
		expect(mageHand.sourceFeature).toBe("Mixed Grant Feat");

		// But the choose-spells did NOT create pending prompts
		const pending = state.getPendingSpellChoices().filter(p => p.featureName === "Mixed Grant Feat");
		expect(pending.length).toBe(0);
	});

	test("without skip flag, the same mixed feat DOES create 2 pending choose-choices", () => {
		const state = new CharacterSheetState();
		state.addFeat({
			name: "Mixed Grant Feat",
			source: "TEST",
			additionalSpells: [{
				known: {"_": ["mage hand#c", {choose: "class=wizard", count: 2}]},
			}],
		});
		expect(state.getCantrips().find(c => c.name === "Mage Hand")).toBeTruthy();
		expect(state.getPendingSpellChoices().filter(p => p.featureName === "Mixed Grant Feat").length).toBe(2);
	});

	test("hasCollectedInlineSpellChoices gate: true only when inline picks exist", () => {
		const noChoices = makeForestSage();
		expect(CharacterSheetClassUtils.hasCollectedInlineSpellChoices(noChoices)).toBe(false);

		const withFeatChoices = makeForestSage({_featChoices: {spells: [{name: "Magic Missile", source: "PHB", level: 1}], cantrips: []}});
		expect(CharacterSheetClassUtils.hasCollectedInlineSpellChoices(withFeatChoices)).toBe(true);

		const withChoices = makeForestSage({choices: {cantrips: [{name: "Guidance", source: "PHB", level: 0}]}});
		expect(CharacterSheetClassUtils.hasCollectedInlineSpellChoices(withChoices)).toBe(true);
	});

	test("skip flag skips ONLY string-choose; object-choose (e.g. Initiate of High Sorcery innate) still prompts", () => {
		const state = new CharacterSheetState();
		// Shape mirrors Initiate of High Sorcery (DSotDQ): a STRING-choose cantrip
		// (collected by the inline picker → skipped) plus an OBJECT-choose innate
		// daily spell (NOT collected by the inline picker → must remain pending).
		state.addFeat({
			name: "Initiate-Style Feat",
			source: "TEST",
			additionalSpells: [{
				known: {"_": [{choose: "level=0|class=Wizard"}]},
				innate: {"_": {daily: {"1e": [{choose: {from: ["hex", "false life"], count: 2}}]}}},
			}],
		}, {skipAdditionalSpellChoices: true});

		const pending = state.getPendingSpellChoices().filter(p => p.featureName === "Initiate-Style Feat");
		// The string-choose cantrip is suppressed; the object-choose innate spell survives.
		expect(pending.length).toBe(1);
		expect(typeof pending[0].filter).toBe("object");
		expect(pending[0].innate).toBe(true);
	});
});

describe("Forest Sage — Arcana/Nature use Wisdom (Bug 1b)", () => {
	test("abilitySwap modifiers are created for ALL prose-listed skills via addFeat", () => {
		const state = new CharacterSheetState();
		state.addFeat(makeForestSage());

		["arcana", "nature", "animalhandling", "survival"].forEach(skill => {
			const swaps = state.getNamedModifiersByType(`abilitySwap:${skill}`);
			expect(swaps.length).toBeGreaterThan(0);
			// Offers wis as a candidate ability for the int-default skills
			if (skill === "arcana" || skill === "nature") {
				expect(swaps.some(m => m.newAbility === "wis")).toBe(true);
			} else {
				// wis-default skills get int offered
				expect(swaps.some(m => m.newAbility === "int")).toBe(true);
			}
		});
	});

	test("description is derived from entries when only entries are supplied", () => {
		const state = new CharacterSheetState();
		const feat = makeForestSage();
		delete feat.description;
		state.addFeat(feat);
		const stored = state.getFeats().find(f => f.name === "Forest Sage");
		expect(stored).toBeTruthy();
		expect(typeof stored.description).toBe("string");
		expect(stored.description.length).toBeGreaterThan(0);
	});

	test("Arcana uses WIS when WIS > INT (MAX semantics)", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 10; // +0
		state._data.abilities.wis = 18; // +4
		state.addFeat(makeForestSage());

		// Arcana default is INT (+0); swap allows WIS (+4)
		expect(state.getSkillMod("arcana")).toBe(state.getAbilityMod("wis"));
		const breakdown = state.getSkillBreakdown("arcana");
		const abilityComp = breakdown.components.find(c => c.type === "ability");
		expect(abilityComp.name).toContain("WIS");
		expect(abilityComp.name.toLowerCase()).toContain("swapped from int");
	});

	test("Arcana stays INT when INT > WIS (player-favorable MAX)", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 18; // +4
		state._data.abilities.wis = 10; // +0
		state.addFeat(makeForestSage());

		expect(state.getSkillMod("arcana")).toBe(state.getAbilityMod("int"));
		const breakdown = state.getSkillBreakdown("arcana");
		const abilityComp = breakdown.components.find(c => c.type === "ability");
		expect(abilityComp.name).toContain("INT");
		expect(abilityComp.name.toLowerCase()).not.toContain("swapped");
	});

	test("Animal Handling (wis-default) uses INT when INT > WIS", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 18; // +4
		state._data.abilities.wis = 10; // +0
		state.addFeat(makeForestSage());

		expect(state.getSkillMod("animal handling")).toBe(state.getAbilityMod("int"));
	});

	test("unrelated skills (e.g. Stealth) are NOT swapped", () => {
		const state = new CharacterSheetState();
		state._data.abilities.dex = 10;
		state._data.abilities.wis = 18;
		state.addFeat(makeForestSage());
		expect(state.getNamedModifiersByType("abilitySwap:stealth").length).toBe(0);
		expect(state.getSkillMod("stealth")).toBe(state.getAbilityMod("dex"));
	});
});

describe("Skill breakdown attribution for named feature bonuses (Bug 2)", () => {
	const addMagician = (state) => {
		state.addNamedModifier({name: "Magician (Primal Order)", type: "skill:arcana", value: 3, note: "From Magician (Primal Order)"});
		state.addNamedModifier({name: "Magician (Primal Order)", type: "skill:nature", value: 3, note: "From Magician (Primal Order)"});
	};

	test("Magician bonus is itemized by feature name, not 'Custom Modifier'", () => {
		const state = new CharacterSheetState();
		addMagician(state);

		const breakdown = state.getSkillBreakdown("arcana");
		const magicianComp = breakdown.components.find(c => c.name === "Magician (Primal Order)");
		expect(magicianComp).toBeTruthy();
		expect(magicianComp.value).toBe(3);
		// No generic lump for a purely-named contribution
		expect(breakdown.components.find(c => c.name === "Custom Modifier")).toBeFalsy();
	});

	test("breakdown total still equals getSkillMod (invariant preserved)", () => {
		const state = new CharacterSheetState();
		state._data.abilities.int = 16;
		state.setSkillProficiency("arcana", 1);
		addMagician(state);
		expect(state.getSkillBreakdown("arcana").total).toBe(state.getSkillMod("arcana"));
		expect(state.getSkillBreakdown("nature").total).toBe(state.getSkillMod("nature"));
	});

	test("named bonus + a generic Custom Modifier coexist as separate lines, total preserved", () => {
		const state = new CharacterSheetState();
		addMagician(state);
		// A truly-unnamed manual custom modifier on Arcana
		state.addNamedModifier({type: "skill:arcana", value: 1}); // name defaults to "Custom Modifier"

		const breakdown = state.getSkillBreakdown("arcana");
		expect(breakdown.components.find(c => c.name === "Magician (Primal Order)").value).toBe(3);
		expect(breakdown.components.find(c => c.name === "Custom Modifier").value).toBe(1);
		expect(breakdown.total).toBe(state.getSkillMod("arcana"));
	});

	test("skill:all named bonus is itemized too and total preserved", () => {
		const state = new CharacterSheetState();
		state.addNamedModifier({name: "Globetrotter", type: "skill:all", value: 1});
		const breakdown = state.getSkillBreakdown("stealth");
		expect(breakdown.components.find(c => c.name === "Globetrotter").value).toBe(1);
		expect(breakdown.total).toBe(state.getSkillMod("stealth"));
	});
});

describe("Regression — official feats keep their effects via addFeat", () => {
	test("entries-derived description does not create spurious abilitySwap modifiers", () => {
		const state = new CharacterSheetState();
		// Skill Expert-like prose (no 'use your choice of X or Y to make ... checks')
		state.addFeat({
			name: "Skill Expert",
			source: "TCE",
			entries: [
				"You have honed your proficiency with particular skills granting you the following benefits:",
				{type: "list",
					items: [
						"Increase one ability score of your choice by 1, to a maximum of 20.",
						"You gain proficiency in one skill of your choice.",
						"Choose one skill in which you have proficiency. You gain expertise with that skill.",
					]},
			],
		});
		// None of the abilitySwap skills should be created
		["arcana", "nature", "animalhandling", "survival", "stealth"].forEach(skill => {
			expect(state.getNamedModifiersByType(`abilitySwap:${skill}`).length).toBe(0);
		});
	});

	test("idempotency: re-processing the same feature's modifiers does not duplicate", () => {
		const state = new CharacterSheetState();
		const feat = makeForestSage();
		state.addFeat(feat);
		const arcanaSwapsAfterFirst = state.getNamedModifiersByType("abilitySwap:arcana").length;

		// Re-run modifier processing for the stored feat (simulates a second pass)
		const stored = state.getFeats().find(f => f.name === "Forest Sage");
		state._processFeatureModifiers(stored, stored.id);
		expect(state.getNamedModifiersByType("abilitySwap:arcana").length).toBe(arcanaSwapsAfterFirst);
	});

	test("progression-flow derived description does NOT fabricate a uses resource", () => {
		// A feat passed with ONLY entries (no `description`) mimics the LevelUp /
		// QuickBuild / Builder flows. Even though its prose says "once per long rest",
		// no generic feat resource should be auto-created — uses-parsing is gated to
		// the originally-supplied description to keep that path's prior behavior.
		const state = new CharacterSheetState();
		state.addFeat({
			name: "Prose Uses Feat",
			source: "TEST",
			entries: ["You can do a special thing once per long rest."],
		});
		expect(state._data.resources.find(r => r.name === "Prose Uses Feat")).toBeUndefined();
		expect(state.getFeats().find(f => f.name === "Prose Uses Feat").uses).toBeUndefined();
	});

	test("Features-tab flow (description supplied) still parses prose uses", () => {
		// When a built description IS supplied (the Features tab path), the generic
		// uses-parser still runs, so a "once per long rest" resource is created.
		const state = new CharacterSheetState();
		state.addFeat({
			name: "Prose Uses Feat 2",
			source: "TEST",
			description: "You can do a special thing once per long rest.",
		});
		const feat = state.getFeats().find(f => f.name === "Prose Uses Feat 2");
		expect(feat.uses).toBeTruthy();
		expect(feat.uses.max).toBe(1);
	});
});

describe("Forest Sage — old-save repair migration (B2)", () => {
	// Build a save that mirrors the Lunaria repro: the Forest Sage FEATURE is present
	// (description text intact) but the abilitySwap modifiers were never minted (the
	// save predates the parser). Achieved by adding the feat, exporting, then stripping
	// every abilitySwap:* row.
	const buildPreParserSave = ({int = 10, wis = 18} = {}) => {
		const seed = new CharacterSheetState();
		seed._data.abilities.int = int;
		seed._data.abilities.wis = wis;
		seed.addFeat(makeForestSage());
		const json = seed.toJson();
		json.namedModifiers = (json.namedModifiers || []).filter(
			m => !(typeof m.type === "string" && m.type.startsWith("abilitySwap:")),
		);
		return json;
	};

	test("loadFromJson re-mints the missing abilitySwap modifiers", () => {
		const save = buildPreParserSave();
		// Sanity: the save really is missing the swaps.
		expect(save.namedModifiers.some(m => m.type === "abilitySwap:arcana")).toBe(false);

		const state = new CharacterSheetState();
		state.loadFromJson(save);

		["arcana", "nature", "animalhandling", "survival"].forEach(skill => {
			const swaps = state.getNamedModifiersByType(`abilitySwap:${skill}`);
			expect(swaps.length).toBeGreaterThan(0);
			// Minted rows are value:0 (feed MAX selection only, never additive totals)
			// and are linked to the still-present Forest Sage feature.
			const feature = state.getFeats().find(f => f.name === "Forest Sage");
			swaps.forEach(m => {
				expect(m.value).toBe(0);
				expect(m.sourceFeatureId).toBe(feature.id);
			});
			if (skill === "arcana" || skill === "nature") {
				expect(swaps.some(m => m.newAbility === "wis")).toBe(true);
			} else {
				expect(swaps.some(m => m.newAbility === "int")).toBe(true);
			}
		});
	});

	test("repaired save now MAXes Arcana to Wisdom (the reported bug)", () => {
		const save = buildPreParserSave({int: 10, wis: 18});
		const state = new CharacterSheetState();
		state.loadFromJson(save);

		// Before the migration Arcana would have stayed on Int (+0); now it MAXes to Wis (+4).
		expect(state.getSkillMod("arcana")).toBe(state.getAbilityMod("wis"));
		const abilityComp = state.getSkillBreakdown("arcana").components.find(c => c.type === "ability");
		expect(abilityComp.name.toLowerCase()).toContain("swapped from int");
	});

	test("idempotent: loading the repaired save again does not duplicate mods", () => {
		const save = buildPreParserSave();
		const state = new CharacterSheetState();
		state.loadFromJson(save);
		const firstCount = state.getNamedModifiersByType("abilitySwap:arcana").length;

		// Re-export (now WITH the minted swaps) and reload — the migration must be a no-op.
		state.loadFromJson(state.toJson());
		expect(state.getNamedModifiersByType("abilitySwap:arcana").length).toBe(firstCount);
	});

	test("no spurious swaps for a feature without the choice-swap prose", () => {
		const seed = new CharacterSheetState();
		seed.addFeat({
			name: "Skill Expert",
			source: "TCE",
			entries: [
				"You have honed your proficiency with particular skills:",
				{type: "list", items: ["You gain proficiency in one skill of your choice."]},
			],
		});
		const state = new CharacterSheetState();
		state.loadFromJson(seed.toJson());
		["arcana", "nature", "animalhandling", "survival", "stealth"].forEach(skill => {
			expect(state.getNamedModifiersByType(`abilitySwap:${skill}`).length).toBe(0);
		});
	});

	test("an orphaned swap (feature removed) is NOT re-minted", () => {
		// A stale abilitySwap row whose source feature no longer exists. The orphan strip
		// removes it first; the repair pass then finds no matching feature and mints nothing.
		const state = new CharacterSheetState();
		state.loadFromJson({
			features: [],
			feats: [],
			namedModifiers: [
				{id: "x1", name: "Forest Sage", type: "abilitySwap:arcana", value: 0, newAbility: "wis", oldAbility: "int", enabled: true, sourceFeatureId: "missing-feature-id"},
			],
		});
		expect(state.getNamedModifiersByType("abilitySwap:arcana").length).toBe(0);
	});

	test("a properly-minted feat swap survives reload unchanged (no strip+re-mint churn)", () => {
		const seed = new CharacterSheetState();
		seed.addFeat(makeForestSage());
		const before = seed.getNamedModifiersByType("abilitySwap:arcana");
		expect(before.length).toBe(1);
		const beforeId = before[0].id;

		const state = new CharacterSheetState();
		state.loadFromJson(seed.toJson());
		const after = state.getNamedModifiersByType("abilitySwap:arcana");
		// Same single row, same id, still enabled — the orphan strip no longer deletes
		// feat-sourced mods, so the migration is a genuine no-op here.
		expect(after.length).toBe(1);
		expect(after[0].id).toBe(beforeId);
		expect(after[0].enabled).not.toBe(false);
	});

	test("a legacy unlinked swap is backfilled with sourceFeatureId and then removable via removeFeat", () => {
		const seed = new CharacterSheetState();
		seed.addFeat(makeForestSage());
		const json = seed.toJson();
		const feat = json.feats.find(f => f.name === "Forest Sage");
		// Simulate a very old row minted before sourceFeatureId tracking: strip the link,
		// keep the "From <name>" note.
		json.namedModifiers.forEach(m => {
			if (typeof m.type === "string" && m.type.startsWith("abilitySwap:")) {
				delete m.sourceFeatureId;
				m.note = "From Forest Sage";
			}
		});

		const state = new CharacterSheetState();
		state.loadFromJson(json);

		// Backfilled (not duplicated) — exactly one arcana swap, now linked to the feat.
		const arcana = state.getNamedModifiersByType("abilitySwap:arcana");
		expect(arcana.length).toBe(1);
		expect(arcana[0].sourceFeatureId).toBe(feat.id);

		// Removing the feat now cleans up the swap (previously it leaked forever).
		state.removeFeat("Forest Sage", "HumblewoodTales");
		expect(state.getNamedModifiersByType("abilitySwap:arcana").length).toBe(0);
	});
});

describe("Lore skill display reflects exhaustion (B5)", () => {
	test("getSkillBreakdown(lore).total drops with exhaustion while getSkillMod stays intrinsic", () => {
		const state = new CharacterSheetState();
		state.setExhaustionRules("2024"); // flat -N per level d20 penalty
		state.addLoreSkill("Herbalism Lore", 2);
		const loreKey = "herbalismlore";

		const intrinsic = state.getSkillMod(loreKey);
		const beforeTotal = state.getSkillBreakdown(loreKey).total;
		expect(beforeTotal).toBe(intrinsic); // no exhaustion yet

		state.setExhaustion(2);
		// Intrinsic display (and passive) is unchanged — exhaustion is a d20 roll penalty.
		expect(state.getSkillMod(loreKey)).toBe(intrinsic);
		// The effective total shown on the row now reflects the -2 penalty.
		const breakdown = state.getSkillBreakdown(loreKey);
		expect(breakdown.total).toBe(intrinsic - 2);
		expect(breakdown.components.some(c => c.type === "penalty" && c.value === -2)).toBe(true);
	});

	test("no exhaustion → lore total equals intrinsic mod (regression guard)", () => {
		const state = new CharacterSheetState();
		state.addLoreSkill("History Lore", 3);
		const loreKey = "historylore";
		expect(state.getSkillBreakdown(loreKey).total).toBe(state.getSkillMod(loreKey));
	});

	test("source-pin: lore row renders breakdown.total as the mod, intrinsic getSkillMod for passive", () => {
		// Guards the charactersheet.js display fix from silent reversion. The lore row must
		// show the exhaustion-aware effective total, while the passive stays on the intrinsic
		// (exhaustion-free) getSkillMod — matching standard-skill passives.
		const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const m = SOURCE.match(/loreSkills\.forEach\(skill => \{[\s\S]*?const passive = [^\n]*\n/);
		expect(m).not.toBeNull();
		const body = m[0];
		expect(body).toMatch(/const breakdown = this\._state\.getSkillBreakdown\(skillKey\);/);
		expect(body).toMatch(/const mod = breakdown\.total;/);
		expect(body).toMatch(/const passive = 10 \+ this\._state\.getSkillMod\(skillKey\);/);
	});
});
