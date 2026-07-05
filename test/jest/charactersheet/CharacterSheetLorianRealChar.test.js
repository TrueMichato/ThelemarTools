/**
 * Character Sheet — REAL character acceptance (R45 Bugs 3 & 5).
 *
 * Loads the actual affected saved character (Rogue 2 / Cleric 10 Tempest, source TGTT-2014)
 * and proves the fixes surface against reality, not just against synthetic fixtures:
 *
 *   • Bug 5c: loadFromJson's _migrateFeatureAbilityModModifiers repairs the persisted
 *     no-op "Chaste" save modifier → it now carries abilityMod:"wis" + conditional
 *     "against:charmed" and resolves to the live Wisdom modifier.
 *   • Bug 5a/5b: getPrinciplesOfDevotionState is Cleric-gated and reports the already-chosen
 *     "Chaste" principle as current.
 *   • Bug 3: the three stored empty-stub Tempest features are backfilled from the real cleric
 *     data catalog by reconcileSubclassFeatureEntries, and "Channel Divinity: Destructive
 *     Wrath" then surfaces as a spendable Channel-Divinity option.
 *
 * The fixture is committed under test/jest/charactersheet/fixtures/ so the suite is
 * self-contained (a copy of the mentor-provided lorian-tempest-cleric.json).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;

const REAL_CHAR = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lorian-tempest-cleric.json"), "utf8"));
const CLERIC_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "data", "class", "class-cleric.json"), "utf8"));

function loadReal () {
	const state = new CharacterSheetState();
	state.loadFromJson(JSON.parse(JSON.stringify(REAL_CHAR)));
	return state;
}

describe("Real char — Bug 5c: Chaste effect repaired on load", () => {
	it("enriches the persisted no-op Chaste save modifier with WIS + a charm-scoped conditional", () => {
		const state = loadReal();
		const mod = state.getNamedModifiers().find(m => (m.note || "").includes("Chaste") || m.name === "Chaste");
		expect(mod).toBeTruthy();
		expect(mod.abilityMod).toBe("wis");
		expect(mod.conditional).toBe("against:charmed");
		// Resolves to the live Wisdom modifier instead of the old +0 no-op.
		expect(state._resolveNamedModifierNumericValue(mod)).toBe(state.getAbilityMod("wis"));
		expect(state.formatConditionalText(mod)).toBe("vs Charmed");
	});
});

describe("Real char — Bug 5a/5b: Principles Overview reflects the chosen principle", () => {
	it("is Cleric-gated and reports Chaste as the current principle", () => {
		const state = loadReal();
		expect(state.getClassLevel("Cleric")).toBeGreaterThan(0);
		const info = state.getPrinciplesOfDevotionState();
		expect(info).toBeTruthy();
		expect(info.current?.name).toBe("Chaste");
	});
});

describe("Real char — Bug 3: Tempest empty stubs backfilled from the real catalog", () => {
	function loadWithCatalog () {
		const state = loadReal();
		// Build the subclass-feature catalog from the real cleric data (as _reconcileClassFeatures
		// does at runtime), then run the reconcile pass that repairs the stored stubs.
		state.setClassFeatureCatalog(CLERIC_DATA.classFeature || [], CLERIC_DATA.subclassFeature || []);
		state.reconcileSubclassFeatureEntries();
		return state;
	}

	it("the 3 stored Tempest features start as empty stubs before reconcile", () => {
		const state = loadReal();
		const names = ["Tempest Domain", "Channel Divinity: Destructive Wrath", "Thunderbolt Strike"];
		names.forEach(n => {
			const f = state.getFeatures().find(x => x.name === n);
			expect(f).toBeTruthy();
			const hasText = (f.description && f.description.trim()) || (Array.isArray(f.entries) && f.entries.length);
			expect(hasText).toBeFalsy();
		});
	});

	it("backfills real rules text into all 3 stored stubs", () => {
		const state = loadWithCatalog();
		const dw = state.getFeatures().find(f => f.name === "Channel Divinity: Destructive Wrath");
		expect(dw.description).toMatch(/maximum damage/i);
		const ts = state.getFeatures().find(f => f.name === "Thunderbolt Strike");
		expect(ts.description).toMatch(/push it up to 10 feet/i);
		const td = state.getFeatures().find(f => f.name === "Tempest Domain");
		expect((td.description || "") + JSON.stringify(td.entries || [])).toMatch(/\w/);
	});

	it("Destructive Wrath surfaces as a spendable Channel-Divinity option", () => {
		const state = loadWithCatalog();
		const af = (state.getActivatableFeatures?.() || [])
			.find(a => (a.feature?.name || a.name) === "Channel Divinity: Destructive Wrath");
		expect(af).toBeTruthy();
		const cost = af?.activationInfo?.channelDivinityCost ?? af?.channelDivinityCost;
		expect(cost).toBeGreaterThanOrEqual(1);
	});
});

describe("Real char — Bug 3 (revised): Wrath of the Storm granted via refSubclassFeature", () => {
	function loadWithCatalog () {
		const state = loadReal();
		state.setClassFeatureCatalog(CLERIC_DATA.classFeature || [], CLERIC_DATA.subclassFeature || []);
		state.reconcileSubclassFeatureEntries();
		return state;
	}

	it("neither Wrath of the Storm nor Bonus Proficiencies is stored before reconcile", () => {
		const state = loadReal();
		const names = state.getFeatures().map(f => f.name);
		expect(names).not.toContain("Wrath of the Storm");
		expect(names).not.toContain("Bonus Proficiencies");
	});

	it("grants Wrath of the Storm as a reaction with a WIS-mod/long-rest use pool at the wrapper's level", () => {
		const state = loadWithCatalog();
		const wots = state.getFeatures().find(f => f.name === "Wrath of the Storm");
		expect(wots).toBeTruthy();
		// Granted at the character's real Tempest Domain level (3), not the ref-encoded level 1.
		const td = state.getFeatures().find(f => f.name === "Tempest Domain");
		expect(wots.level).toBe(td.level);
		expect(Array.isArray(wots.entries) && wots.entries.length).toBeTruthy();
		// Requirements that make combat.js renderCombatActions surface it as a usable action:
		//   hasActionEconomy (reaction text) + hasLimitedUses (uses.max > 0).
		expect(`${wots.description}`).toMatch(/use your reaction/i);
		expect(wots.uses).toBeTruthy();
		expect(wots.uses.max).toBe(state.getAbilityMod("wis"));
		expect(wots.uses.recharge).toBe("long");
	});

	it("Wrath of the Storm passes combat.js renderCombatActions' exclusion gates (surfaces live)", () => {
		const state = loadWithCatalog();
		const features = state.getFeatures();
		const wots = features.find(f => f.name === "Wrath of the Storm");
		// Not hidden by a Divine-Favor / improvement-rider surface suppressor.
		expect(CharacterSheetState.isHiddenFromGenericAbilitySurfaces(wots, features)).toBeFalsy();
		// Not a toggle (would be filtered as an always-on stance).
		expect(CharacterSheetState.detectActivatableFeature(wots)?.isToggle).toBeFalsy();
		// The final renderCombatActions predicate: reaction economy + a real use pool → include.
		const desc = `${wots.description}`;
		const hasActionEconomy = /\b(as a reaction|use your reaction)\b/i.test(desc);
		const hasLimitedUses = wots.uses && wots.uses.max > 0;
		expect(hasActionEconomy && hasLimitedUses).toBeTruthy();
	});

	it("grants Bonus Proficiencies as its own stored feature", () => {
		const state = loadWithCatalog();
		const bp = state.getFeatures().find(f => f.name === "Bonus Proficiencies");
		expect(bp).toBeTruthy();
		expect(`${bp.description}`).toMatch(/martial weapons and heavy armor/i);
	});

	it("is idempotent — a second reconcile grants nothing new", () => {
		const state = loadWithCatalog();
		const countAfterFirst = state.getFeatures().filter(f => f.name === "Wrath of the Storm").length;
		expect(countAfterFirst).toBe(1);
		const added = state.reconcileSubclassFeatureEntries();
		expect(added).toBe(0);
		expect(state.getFeatures().filter(f => f.name === "Wrath of the Storm").length).toBe(1);
	});
});
