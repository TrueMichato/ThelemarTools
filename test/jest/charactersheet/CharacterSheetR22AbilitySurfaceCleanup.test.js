/**
 * R22 — single-canonical-home cleanup for the Illrigger ability surfaces.
 *
 * Round 21 split abilities out of the active-states panel, but several features still
 * leaked into the OTHER generic surfaces (Resources panel, Combat "Abilities" list, Combat
 * Resources, and the features-tab Use button). The user reported, on the real Hochling
 * Illrigger L10:
 *   - Baleful Interdict / Charm Enemy should live ONLY in the Interdiction combat panel.
 *   - The durational interdict boons (Veil of Lies, …) are invoked from that same panel.
 *   - "Forked Tongue Improvement" is a passive rider — not a usable ability at all.
 *   - Genuine abilities (Healing Hands, Guided Strike, Forked Tongue, War God's Blessing)
 *     keep a single working Use button.
 *
 * These statics are the single boundary predicate every generic surface now consults, so
 * the duplication cannot regress. Assertions run against the committed real-character
 * fixture (no synthetic false-greens).
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const FIXTURE = resolve(__dirname, "fixtures", "r21-hochling-illrigger-l10.json");

function loadRealChar () {
	const state = new CharacterSheetState();
	state.loadFromJson(JSON.parse(readFileSync(FIXTURE, "utf8")));
	return state;
}

function featByName (state, name) {
	return (state.getFeatures() || []).find(f => (f.name || "") === name);
}

describe("R22 — interdiction-managed features are hidden from generic surfaces", () => {
	test("Baleful Interdict and Charm Enemy are interdiction-managed", () => {
		const state = loadRealChar();
		const bi = featByName(state, "Baleful Interdict");
		const ce = featByName(state, "Charm Enemy");
		expect(bi).toBeTruthy();
		expect(ce).toBeTruthy();
		expect(CharacterSheetState.isInterdictionManagedFeature(bi)).toBe(true);
		expect(CharacterSheetState.isInterdictionManagedFeature(ce)).toBe(true);
	});

	test("durational interdict boon (Veil of Lies) is interdiction-managed", () => {
		const state = loadRealChar();
		const vol = featByName(state, "Veil of Lies");
		expect(vol).toBeTruthy();
		expect(CharacterSheetState.isInterdictionManagedFeature(vol)).toBe(true);
	});

	test("genuine abilities are NOT interdiction-managed", () => {
		const state = loadRealChar();
		for (const name of ["Healing Hands", "Guided Strike", "Forked Tongue", "War God's Blessing"]) {
			const f = featByName(state, name);
			expect(f).toBeTruthy();
			expect(CharacterSheetState.isInterdictionManagedFeature(f)).toBe(false);
		}
	});
});

describe("R22 — redundant '<X> Improvement' riders", () => {
	test("Forked Tongue Improvement is redundant when Forked Tongue is owned", () => {
		const state = loadRealChar();
		const all = state.getFeatures();
		const imp = featByName(state, "Forked Tongue Improvement");
		expect(imp).toBeTruthy();
		expect(CharacterSheetState.isRedundantImprovementFeature(imp, all)).toBe(true);
	});

	test("an Improvement with no matching base feature is NOT flagged", () => {
		const orphan = {name: "Mystery Improvement"};
		const all = [orphan, {name: "Forked Tongue"}];
		expect(CharacterSheetState.isRedundantImprovementFeature(orphan, all)).toBe(false);
	});

	test("a base feature (no 'Improvement' suffix) is never flagged", () => {
		const all = [{name: "Forked Tongue"}, {name: "Forked Tongue Improvement"}];
		expect(CharacterSheetState.isRedundantImprovementFeature({name: "Forked Tongue"}, all)).toBe(false);
	});
});

describe("R22 — combined hidden-surface predicate", () => {
	test("hides interdiction-managed + redundant riders, keeps real abilities", () => {
		const state = loadRealChar();
		const all = state.getFeatures();
		const hidden = (name) => CharacterSheetState.isHiddenFromGenericAbilitySurfaces(featByName(state, name), all);

		// Hidden — belong only to the Interdiction panel / are passive riders
		expect(hidden("Baleful Interdict")).toBe(true);
		expect(hidden("Charm Enemy")).toBe(true);
		expect(hidden("Veil of Lies")).toBe(true);
		expect(hidden("Forked Tongue Improvement")).toBe(true);

		// Visible — genuine single-home abilities
		expect(hidden("Healing Hands")).toBe(false);
		expect(hidden("Guided Strike")).toBe(false);
		expect(hidden("Forked Tongue")).toBe(false);
		expect(hidden("War God's Blessing")).toBe(false);
	});

	test("null-safe", () => {
		expect(CharacterSheetState.isHiddenFromGenericAbilitySurfaces(null, [])).toBe(false);
		expect(CharacterSheetState.isInterdictionManagedFeature(undefined)).toBe(false);
		expect(CharacterSheetState.isRedundantImprovementFeature({}, null)).toBe(false);
	});
});

describe("R22 #2 — quickbuild interdict-boon level gating contract", () => {
	// The boon pool the quickbuild Class Options step now evaluates with checkPrerequisites
	// (mirroring level-up). Shapes mirror the real MCDM Illrigger ItdBoon prerequisites.
	const BOONS = [
		{name: "Soul Eater", source: "IllriggerRevised", featureType: ["ItdBoon"], prerequisite: [{level: {level: 2, class: {name: "Illrigger", source: "IllriggerRevised"}}}]},
		{name: "Shadow Shroud", source: "IllriggerRevised", featureType: ["ItdBoon"], prerequisite: [{level: {level: 7, class: {name: "Illrigger", source: "IllriggerRevised"}}}]},
		{name: "Hellish Frenzy", source: "IllriggerRevised", featureType: ["ItdBoon"], prerequisite: [{level: {level: 13, class: {name: "Illrigger", source: "IllriggerRevised"}}}]},
	];

	function eligibleAtLevel (illriggerLevel) {
		const prereqContext = {
			classes: [{name: "Illrigger", source: "TGTT", level: illriggerLevel}],
			totalLevel: illriggerLevel,
			existingFeatures: [],
			cantrips: [],
			spells: [],
		};
		return CharacterSheetClassUtils.getEligibleOptionalFeatures(BOONS, {
			featureTypes: ["ItdBoon"],
			prereqContext,
			alreadyKnown: [],
		});
	}

	test("at Illrigger level 7: level-7 boon selectable, level-13 boon NOT", () => {
		const opts = eligibleAtLevel(7);
		const byName = Object.fromEntries(opts.map(o => [o.name, o]));
		expect(byName["Soul Eater"]._selectable).toBe(true);
		expect(byName["Shadow Shroud"]._meetsPrereqs).toBe(true);
		expect(byName["Shadow Shroud"]._selectable).toBe(true);
		expect(byName["Hellish Frenzy"]._meetsPrereqs).toBe(false);
		expect(byName["Hellish Frenzy"]._selectable).toBe(false);
		expect(byName["Hellish Frenzy"]._prereqReasons.join(",")).toMatch(/Illrigger/i);
	});

	test("at Illrigger level 13: all three boons selectable", () => {
		const opts = eligibleAtLevel(13);
		expect(opts.every(o => o._selectable)).toBe(true);
	});

	test("at Illrigger level 2: only the level-2 boon selectable", () => {
		const opts = eligibleAtLevel(2);
		const byName = Object.fromEntries(opts.map(o => [o.name, o]));
		expect(byName["Soul Eater"]._selectable).toBe(true);
		expect(byName["Shadow Shroud"]._selectable).toBe(false);
		expect(byName["Hellish Frenzy"]._selectable).toBe(false);
	});
});

describe("R22 #8 — Moloch's Interdiction free boons surface as known boons", () => {
	test("real Hochling Hellspeaker L10 grants Red Cant (level-7 grant) as a budget-free boon", () => {
		const state = loadRealChar();
		const granted = state.getMolochInterdictionBoons();
		const grantedNames = granted.map(b => b.name);
		expect(grantedNames).toContain("Red Cant");
		// L13/L18 grants not yet reached at level 10
		expect(grantedNames).not.toContain("Slippery Ploy");
		expect(grantedNames).not.toContain("Incontrovertible");

		// granted boons are ItdBoon-shaped + flagged so the render can badge them
		const redCant = granted.find(b => b.name === "Red Cant");
		expect(redCant._molochGranted).toBe(true);
		expect(CharacterSheetState.isInterdictBoonEntry?.({feature: redCant}) ?? true).toBeTruthy();

		// CRITICAL (R21 budget contract): free boons do NOT pollute getInterdictBoons(),
		// which feeds the known-boon budget. They surface separately in the render layer.
		expect(state.getInterdictBoons().map(b => b.name)).not.toContain("Red Cant");
	});

	test("granted boons are deduped against a player-selected boon of the same name", () => {
		const state = loadRealChar();
		// inject a fake selected "Red Cant" into stored features
		state._data.features = state._data.features || [];
		state._data.features.push({name: "Red Cant", featureType: ["ItdBoon"]});
		// getInterdictBoons holds the stored selection (budget-significant)
		expect(state.getInterdictBoons().filter(b => b.name === "Red Cant")).toHaveLength(1);
		// getMolochInterdictionBoons still lists Red Cant; the render dedupes the overlap so
		// only one "Red Cant" row shows (selected wins) — mirror that dedupe here.
		const selected = state.getInterdictBoons();
		const moloch = state.getMolochInterdictionBoons();
		const seen = new Set(selected.map(b => (b.name || "").toLowerCase()));
		const union = [...selected, ...moloch.filter(b => !seen.has((b.name || "").toLowerCase()))];
		expect(union.filter(b => b.name === "Red Cant")).toHaveLength(1);
		expect(union.find(b => b.name === "Red Cant")._molochGranted).toBeFalsy();
	});

	test("non-Hellspeaker / sub-level-7 characters get no free boons", () => {
		const state = loadRealChar();
		const cls = state._data.classes.find(c => c.name === "Illrigger");
		const realSub = cls.subclass;
		// wrong subclass → none
		cls.subclass = {name: "Painkiller", shortName: "Painkiller"};
		expect(state.getMolochInterdictionBoons()).toHaveLength(0);
		// right subclass but below level 7 → none
		cls.subclass = realSub;
		const realLevel = cls.level;
		cls.level = 6;
		expect(state.getMolochInterdictionBoons()).toHaveLength(0);
		cls.level = realLevel;
	});
});

describe("R22 #7 — Hellish Avenger is a real once-per-turn weapon damage rider", () => {
	test("real char (L10) exposes a Hellish Avenger weaponDamageRider of 1d8 fire", () => {
		const state = loadRealChar();
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasHellishAvenger).toBe(true);
		const rider = (calcs.weaponDamageRiders || []).find(r => r.id === "hellishAvenger");
		expect(rider).toBeTruthy();
		expect(rider.dice).toBe("1d8");
		expect(rider.damageType).toBe("fire");
		expect(rider.note).toMatch(/once per turn/i);
	});

	test("scales to 2d8 at Illrigger level 11", () => {
		const state = loadRealChar();
		state._data.classes.find(c => c.name === "Illrigger").level = 11;
		const calcs = state.getFeatureCalculations();
		const rider = (calcs.weaponDamageRiders || []).find(r => r.id === "hellishAvenger");
		expect(rider.dice).toBe("2d8");
	});
});

describe("R22 #10 — Intransigent signals the allied charmed-immunity extension", () => {
	test("the Intransigent summary mentions chosen creatures within range", () => {
		const calcs = {hasIntransigent: true, intransigentRange: 10};
		const summary = CharacterSheetState.ILLRIGGER_FEATURE_SUMMARIES["intransigent"](calcs);
		expect(summary).toMatch(/chosen creatures within 10 ft/i);
		expect(summary).toMatch(/charmed/i);
	});

	test("no summary when the character lacks Intransigent", () => {
		expect(CharacterSheetState.ILLRIGGER_FEATURE_SUMMARIES["intransigent"]({})).toBeNull();
	});
});

describe("R22 #11 — Superior Interdict bonus-action seal regain", () => {
	function l14Hellspeaker () {
		const state = loadRealChar();
		state._data.classes.find(c => c.name === "Illrigger").level = 14;
		return state;
	}

	test("summary surfaces both the resistance bypass and the regain", () => {
		const summary = CharacterSheetState.ILLRIGGER_FEATURE_SUMMARIES["superior interdict"]({hasSuperiorInterdict: true});
		expect(summary).toMatch(/ignores resistance/i);
		expect(summary).toMatch(/regain 1 seal/i);
		expect(summary).toMatch(/long rest/i);
	});

	test("regain is gated: only at L14, only with zero seals, only once per long rest", () => {
		const state = l14Hellspeaker();
		expect(state.hasSuperiorInterdict()).toBe(true);

		// With seals remaining → not allowed
		state._setSealsAvailable(state.getSealsMax());
		expect(state.canRegainSealViaSuperiorInterdict()).toBe(false);
		expect(state.regainSealViaSuperiorInterdict().ok).toBe(false);

		// With zero seals → allowed once
		state._setSealsAvailable(0);
		expect(state.canRegainSealViaSuperiorInterdict()).toBe(true);
		const r = state.regainSealViaSuperiorInterdict();
		expect(r.ok).toBe(true);
		expect(state.getSealsAvailable()).toBe(1);

		// Second use this rest → blocked even at zero seals
		state._setSealsAvailable(0);
		expect(state.canRegainSealViaSuperiorInterdict()).toBe(false);
		expect(state.regainSealViaSuperiorInterdict().ok).toBe(false);

		// Long-rest reset re-enables it
		state.resetSuperiorInterdict();
		state._setSealsAvailable(0);
		expect(state.canRegainSealViaSuperiorInterdict()).toBe(true);
	});

	test("a sub-L14 Illrigger cannot use Superior Interdict", () => {
		const state = loadRealChar(); // L10
		expect(state.hasSuperiorInterdict()).toBe(false);
		state._setSealsAvailable(0);
		expect(state.canRegainSealViaSuperiorInterdict()).toBe(false);
		expect(state.regainSealViaSuperiorInterdict().ok).toBe(false);
	});
});

describe("R22 #9 — Terrorizing Force chosen-type, every-hit weapon rider", () => {
	function l11 () {
		const state = loadRealChar();
		state._data.classes.find(c => c.name === "Illrigger").level = 11;
		return state;
	}

	test("not present below L11", () => {
		const state = loadRealChar(); // L10
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasTerrorizingForce).toBeFalsy();
		expect((calcs.weaponDamageRiders || []).some(r => r.id === "terrorizingForce")).toBe(false);
	});

	test("L11 exposes an every-hit (perTurn:false) 1d8 rider, default fire", () => {
		const state = l11();
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasTerrorizingForce).toBe(true);
		const rider = (calcs.weaponDamageRiders || []).find(r => r.id === "terrorizingForce");
		expect(rider).toBeTruthy();
		expect(rider.dice).toBe("1d8");
		expect(rider.damageType).toBe("fire");
		expect(rider.perTurn).toBe(false);
		expect(rider.damageTypeChoices).toEqual(["cold", "fire", "necrotic", "poison"]);
	});

	test("the damage type is choosable (changeable on a long rest) and flows into the rider", () => {
		const state = l11();
		expect(state.setTerrorizingForceDamageType("necrotic")).toBe("necrotic");
		expect(state.getTerrorizingForceDamageType()).toBe("necrotic");
		const rider = (state.getFeatureCalculations().weaponDamageRiders || []).find(r => r.id === "terrorizingForce");
		expect(rider.damageType).toBe("necrotic");
		expect(rider.note).toMatch(/necrotic/);
		// generic dispatch routes through the setter
		expect(state.setWeaponRiderDamageType("terrorizingForce", "poison")).toBe("poison");
		expect(state.getTerrorizingForceDamageType()).toBe("poison");
	});

	test("invalid damage types are rejected (kept at the last valid value)", () => {
		const state = l11();
		state.setTerrorizingForceDamageType("fire");
		expect(state.setTerrorizingForceDamageType("radiant")).toBe("fire");
		expect(state.getTerrorizingForceDamageType()).toBe("fire");
		expect(state.setWeaponRiderDamageType("unknownRider", "cold")).toBeNull();
	});

	test("scales to 2d8 at Illrigger level 17", () => {
		const state = loadRealChar();
		state._data.classes.find(c => c.name === "Illrigger").level = 17;
		const rider = (state.getFeatureCalculations().weaponDamageRiders || []).find(r => r.id === "terrorizingForce");
		expect(rider.dice).toBe("2d8");
	});
});

// ==========================================================================
// R22 #1 — custom-class-feature / Forked-Tongue / custom-background language
//          choosers use the SAME race-style checkbox-pill picker (search +
//          source filter + counter + max-cap) instead of legacy dropdowns.
// ==========================================================================
describe("R22 #1 — language pickers reuse the race-style pill chooser", () => {
	const BUILDER_SRC = readFileSync(
		resolve(__dirname, "..", "..", "..", "js", "charactersheet", "charactersheet-builder.js"),
		"utf8",
	);

	function methodBody (name) {
		const m = BUILDER_SRC.match(new RegExp(`${name} \\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\}\\n`));
		return m ? m[0] : "";
	}

	test("class-feature language selection routes through the shared pill helper", () => {
		const body = methodBody("_renderClassFeatureLanguageSelection");
		expect(body).not.toBe("");
		expect(body).toMatch(/_renderLanguageCheckboxGroup\s*\(/);
		expect(body).toMatch(/this\._selectedClassFeatureLanguages = selectedNames/);
		// no legacy per-index <select> dropdown construction
		expect(body).not.toMatch(/<select/);
	});

	test("Forked Tongue language selection routes through the shared pill helper and excludes Mictlanian", () => {
		const body = methodBody("_renderForkedTongueLanguageSelection");
		expect(body).not.toBe("");
		expect(body).toMatch(/_renderLanguageCheckboxGroup\s*\(/);
		expect(body).toMatch(/knownLangs\.add\("mictlanian"\)/);
		expect(body).not.toMatch(/<select/);
	});

	test("custom-background creator uses tool chips + the pill language picker sharing one budget", () => {
		expect(BUILDER_SRC).toMatch(/custom-bg-tool-chips/);
		expect(BUILDER_SRC).toMatch(/custom-bg-tool-add/);
		expect(BUILDER_SRC).toMatch(/custom-bg-lang-checkboxes/);
		expect(BUILDER_SRC).toMatch(/_renderLanguageCheckboxGroup\s*\(/);
		// legacy fixed lang1/lang2/extra dropdown ids are gone
		expect(BUILDER_SRC).not.toMatch(/id="custom-bg-lang1"/);
		expect(BUILDER_SRC).not.toMatch(/id="custom-bg-extra"/);
	});
});
