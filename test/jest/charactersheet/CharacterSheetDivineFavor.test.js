/**
 * Divine Favor subsystem (TGTT — Bug 9).
 *
 * A character picks a Thelemar god and sets favour/malice; tiered boons are
 * reconciled imperatively/idempotently onto the generic effect channels
 * (innate spells, named modifiers, customModifiers ability channels).
 *
 * Covered here:
 *   - Pan loads from the homebrew and the catalog is set on state;
 *   - favour-tier and malice-tier computation;
 *   - Devotee (favour 3): Animal Friendship as a limited-cast innate spell with
 *     uses = max(1, WIS mod) per long rest, WIS spellcasting ability, and a
 *     conditional Persuasion-vs-animals advantage modifier;
 *   - Votary (favour 10): Conjure Animals 1/long-rest;
 *   - Apostle (favour 50): +2 to a chosen score (WIS/CHA) AND +2 to its maximum;
 *   - save/load round-trip of `_data.divineFavor`;
 *   - apply/clear idempotency (re-apply never double-counts);
 *   - Bug 4: limited/granted casts also mint a tracked `Divine Favor: <Spell>`
 *     resource (Resources + Combat panels) cross-linked to the mirroring innate
 *     spell, so spend/restore stays in lockstep across tabs; resource idempotency;
 *     and a real-character (Lorian, Pan favour 100) load check.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const BREW_PATH = path.join(__dirnameLocal, "..", "..", "..", "homebrew", "TravelersGuidetoThelemar.json");

let PAN;

beforeAll(() => {
	const brew = JSON.parse(fs.readFileSync(BREW_PATH, "utf8"));
	PAN = (brew.divineFavor || []).find(g => g.name === "Pan" && g.source === "TGTT");
});

function makeState (catalog = [PAN]) {
	const s = new CharacterSheetState();
	s.setDivineFavorCatalog(catalog);
	return s;
}

function innate (state, name) {
	return (state._data.spellcasting?.innateSpells || []).find(sp => sp.name === name);
}

describe("Divine Favor — data + catalog", () => {
	test("Pan is present in the homebrew divineFavor array", () => {
		expect(PAN).toBeDefined();
		expect(Array.isArray(PAN.tiers)).toBe(true);
		expect(PAN.tiers.map(t => t.favor)).toEqual([3, 10, 25, 50]);
	});

	test("catalog resolves the selected god by name|source UID", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		expect(s.getDivineFavorGodData()?.name).toBe("Pan");
	});

	test("expected/maliced acts are carried through as display data", () => {
		expect(PAN.expectedActs.length).toBeGreaterThan(0);
		expect(PAN.malicedActs.length).toBeGreaterThan(0);
	});
});

describe("Divine Favor — tier computation", () => {
	test.each([
		[0, null],
		[2, null],
		[3, "Devotee"],
		[9, "Devotee"],
		[10, "Votary"],
		[24, "Votary"],
		[25, "Disciple"],
		[49, "Disciple"],
		[50, "Apostle"],
		[100, "Apostle"],
	])("favour %i → tier %s", (favor, tierName) => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(favor);
		expect(s.getDivineFavorTier()?.name || null).toBe(tierName);
	});

	test.each([
		[0, null],
		[4, null],
		[5, "Divine Disfavour"],
		[19, "Divine Disfavour"],
		[20, "Divine Displeasure"],
		[45, "Divine Ire"],
		[75, "Divine Fury"],
		[100, "Divine Wrath"],
	])("malice %i → malice tier %s", (malice, tierName) => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorMalice(malice);
		expect(s.getDivineFavorMaliceTier()?.name || null).toBe(tierName);
	});
});

describe("Divine Favor — Devotee boons (favour 3)", () => {
	test("Animal Friendship granted with uses = max(1, WIS mod), WIS ability", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16); // +3
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(3);

		const af = innate(s, "Animal Friendship");
		expect(af).toBeDefined();
		expect(af.source).toBe("PHB");
		expect(af.spellcastingAbility).toBe("wis");
		expect(af.uses).toEqual({current: 3, max: 3});
		expect(af.recharge).toBe("long");
	});

	test("minimum of one use even with a non-positive WIS modifier", () => {
		const s = makeState();
		s.setAbilityBase("wis", 8); // -1
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(3);

		expect(innate(s, "Animal Friendship").uses).toEqual({current: 1, max: 1});
	});

	test("Persuasion-vs-animals advantage is a conditional (opt-in) modifier", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(3);

		const gated = s.aggregateModifiers("skill:persuasion");
		// Default-off: not auto-applied.
		expect(gated.advantage).toBe(false);
		const avail = gated.conditionalsAvailable.find(c => /animal/i.test(c.conditional || ""));
		expect(avail).toBeDefined();
		expect(avail.advantage).toBe(true);

		// Opting in surfaces the advantage.
		const opted = s.aggregateModifiers("skill:persuasion", {appliedConditionalIds: new Set([avail.id])});
		expect(opted.advantage).toBe(true);
	});

	test("below favour 3 grants nothing", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(2);
		expect(innate(s, "Animal Friendship")).toBeUndefined();
		expect(s.getActiveDivineFavorBoons()).toHaveLength(0);
	});
});

describe("Divine Favor — Votary boons (favour 10)", () => {
	test("Conjure Animals granted 1/long-rest with WIS ability", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const ca = innate(s, "Conjure Animals");
		expect(ca).toBeDefined();
		expect(ca.spellcastingAbility).toBe("wis");
		expect(ca.uses).toEqual({current: 1, max: 1});
		expect(ca.recharge).toBe("long");

		// Devotee boons still present at the higher tier.
		expect(innate(s, "Animal Friendship")).toBeDefined();
	});
});

// (Bug 1) A `type:"narrative"` boon reaches no mechanical channel (spell / modifier /
// ability-score), so it must be surfaced as a real FEATURE in the Features tab or it is
// silently dropped. Pan → Disciple (favour 25) grants the narrative boon "Attunement to
// Nature". applyDivineFavorEffects adds it via addFeature tagged `_divineFavor:true`, and the
// strip pass removes it on the next reconcile (idempotent).
function dfFeatures (state, name) {
	return (state.getFeatures() || []).filter(f => f.name === name);
}

describe("Divine Favor — Bug 1: narrative boons surface as features (favour 25)", () => {
	test("Attunement to Nature appears in getFeatures() at Disciple tier", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25);

		const feats = dfFeatures(s, "Attunement to Nature");
		expect(feats).toHaveLength(1);
		const f = feats[0];
		expect(f._divineFavor).toBe(true);
		expect(f.sourceFeature).toBe("Divine Favor: Pan — Disciple");
		expect(f.description).toMatch(/attune to the natural world/i);
		// No featureType / parentFeature / combat-method marker → renders through the generic
		// (unmarked) feature path in the Features tab.
		expect(f.featureType).toBeUndefined();
		expect(f.parentFeature).toBeUndefined();
		expect(f._entityType).toBeUndefined();
	});

	test("below favour 25 the narrative boon is absent", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(24);
		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(0);
	});

	test("re-applying does not duplicate the narrative feature or leak a resource", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25);

		s.applyDivineFavorEffects();
		s.applyDivineFavorEffects();

		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(1);
		// The narrative boon has no use count → it must not mint a stray tracked resource.
		expect((s._data.resources || []).filter(r => r.name === "Attunement to Nature")).toHaveLength(0);
		// Exactly one _divineFavor-tagged feature.
		expect((s._data.features || []).filter(f => f._divineFavor)).toHaveLength(1);
	});

	test("lowering favour below the tier removes the narrative feature", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25);
		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(1);

		s.setDivineFavorLevel(10);
		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(0);
		expect((s._data.features || []).filter(f => f._divineFavor)).toHaveLength(0);
	});

	test("clearing the god removes the narrative feature", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25);
		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(1);

		s.setDivineFavorGod(null);
		expect(dfFeatures(s, "Attunement to Nature")).toHaveLength(0);
	});

	test("survives a toJson/loadFromJson round-trip without duplicating", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25);

		const json = s.toJson();
		expect((json.features || []).filter(f => f.name === "Attunement to Nature")).toHaveLength(1);

		const s2 = makeState();
		s2.loadFromJson(json);
		s2.applyDivineFavorEffects(); // controller runs this post-load once the catalog is set
		expect(dfFeatures(s2, "Attunement to Nature")).toHaveLength(1);
	});
});

describe("Divine Favor — Apostle boon (favour 50): +2 score & +2 max", () => {
	test("boost is withheld until the player chooses a score", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(50);
		// No choice yet → no boost.
		expect(s.getAbilityScore("wis")).toBe(10);
		expect(s.getAbilityScoreMax("wis")).toBe(20);
	});

	test("choosing WIS applies +2 score and +2 to its maximum", () => {
		const s = makeState();
		s.setAbilityBase("wis", 15);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(50);
		s.setDivineFavorBoonChoice("pan-apostle-asi", "wis");

		expect(s.getAbilityScore("wis")).toBe(17);
		expect(s.getAbilityScoreMax("wis")).toBe(22);
		// CHA untouched.
		expect(s.getAbilityScoreMax("cha")).toBe(20);
	});

	test("switching the chosen score moves the boost cleanly (no double-count)", () => {
		const s = makeState();
		s.setAbilityBase("wis", 15);
		s.setAbilityBase("cha", 13);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(50);

		s.setDivineFavorBoonChoice("pan-apostle-asi", "wis");
		expect(s.getAbilityScore("wis")).toBe(17);

		s.setDivineFavorBoonChoice("pan-apostle-asi", "cha");
		expect(s.getAbilityScore("wis")).toBe(15); // reverted
		expect(s.getAbilityScoreMax("wis")).toBe(20);
		expect(s.getAbilityScore("cha")).toBe(15);
		expect(s.getAbilityScoreMax("cha")).toBe(22);
	});
});

describe("Divine Favor — idempotency", () => {
	test("re-applying does not duplicate innate spells or modifiers", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const spellsBefore = s._data.spellcasting.innateSpells.filter(sp => (sp.sourceFeature || "").startsWith("Divine Favor:")).length;
		const modsBefore = s._data.namedModifiers.filter(m => m._divineFavor).length;

		s.applyDivineFavorEffects();
		s.applyDivineFavorEffects();

		const spellsAfter = s._data.spellcasting.innateSpells.filter(sp => (sp.sourceFeature || "").startsWith("Divine Favor:")).length;
		const modsAfter = s._data.namedModifiers.filter(m => m._divineFavor).length;

		expect(spellsAfter).toBe(spellsBefore);
		expect(modsAfter).toBe(modsBefore);
	});

	test("lowering favour strips the now-ineligible boons", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);
		expect(innate(s, "Conjure Animals")).toBeDefined();

		s.setDivineFavorLevel(0);
		expect(innate(s, "Conjure Animals")).toBeUndefined();
		expect(innate(s, "Animal Friendship")).toBeUndefined();
		expect(s._data.namedModifiers.filter(m => m._divineFavor)).toHaveLength(0);
	});

	test("clearing the god removes all divine-favor contributions", () => {
		const s = makeState();
		s.setAbilityBase("wis", 15);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(50);
		s.setDivineFavorBoonChoice("pan-apostle-asi", "wis");
		expect(s.getAbilityScore("wis")).toBe(17);

		s.setDivineFavorGod(null);
		expect(s.getAbilityScore("wis")).toBe(15);
		expect(s._data.namedModifiers.filter(m => m._divineFavor)).toHaveLength(0);
		expect(s._data.spellcasting.innateSpells.filter(sp => (sp.sourceFeature || "").startsWith("Divine Favor:"))).toHaveLength(0);
	});
});

describe("Divine Favor — save/load round-trip", () => {
	test("selection persists through toJson/loadFromJson and re-applies", () => {
		const s = makeState();
		s.setAbilityBase("wis", 15);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(50);
		s.setDivineFavorBoonChoice("pan-apostle-asi", "wis");

		const json = s.toJson();
		expect(json.divineFavor.god).toBe("Pan|TGTT");
		expect(json.divineFavor.favor).toBe(50);
		expect(json.divineFavor.chosenBoons["pan-apostle-asi"]).toBe("wis");

		const s2 = makeState();
		s2.setAbilityBase("wis", 15);
		s2.loadFromJson(json);
		s2.applyDivineFavorEffects(); // controller runs this post-load once catalog is set

		expect(s2.getDivineFavor().god).toBe("Pan|TGTT");
		expect(s2.getDivineFavorTier()?.name).toBe("Apostle");
		expect(s2.getAbilityScore("wis")).toBe(17);
		expect(s2.getAbilityScoreMax("wis")).toBe(22);
		expect(innate(s2, "Animal Friendship")).toBeDefined();
	});

	test("an old save with no divineFavor field defaults cleanly", () => {
		const s = makeState();
		s.loadFromJson({}); // legacy save
		const df = s.getDivineFavor();
		expect(df.god).toBeNull();
		expect(df.favor).toBe(0);
		expect(df.malice).toBe(0);
		expect(() => s.applyDivineFavorEffects()).not.toThrow();
	});
});

// (Bug 4) Limited/granted-cast boons must also surface as TRACKED RESOURCES (Resources tab +
// Combat "Combat Resources" panel), kept in lockstep with the mirroring innate spell so a
// cast/spend in any tab agrees. The resource is minted in applyDivineFavorEffects and linked
// to the innate spell via linkedInnateSpellId / linkedResourceId.
function dfResource (state, spellName) {
	return (state._data.resources || []).find(r => r._divineFavor && r.name === `Divine Favor: ${spellName}`);
}

describe("Divine Favor — Bug 4: limited casts become tracked resources", () => {
	test("each limited/granted cast mints a linked, tagged resource", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16); // +3 → Animal Friendship 3 uses
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10); // Devotee + Votary

		const af = dfResource(s, "Animal Friendship");
		const ca = dfResource(s, "Conjure Animals");
		expect(af).toBeDefined();
		expect(af.max).toBe(3);
		expect(af.current).toBe(3);
		expect(af.recharge).toBe("long");
		expect(ca).toBeDefined();
		expect(ca.max).toBe(1);
		expect(ca.recharge).toBe("long");

		// Cross-linked to the mirroring innate spell (single logical tracker).
		expect(af.linkedInnateSpellId).toBe(innate(s, "Animal Friendship").id);
		expect(innate(s, "Animal Friendship").linkedResourceId).toBe(af.id);
	});

	test("the resource surfaces in the generic pool (Resources + Combat panels)", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const pool = s.getGenericPoolResources().map(r => r.name);
		expect(pool).toContain("Divine Favor: Animal Friendship");
		expect(pool).toContain("Divine Favor: Conjure Animals");
	});

	test("casting from the Spells tab decrements the linked resource", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const innateCa = innate(s, "Conjure Animals");
		s.useInnateSpell(innateCa.id);

		expect(innate(s, "Conjure Animals").uses.current).toBe(0);
		expect(dfResource(s, "Conjure Animals").current).toBe(0);
	});

	test("restoring an innate-spell use (Spells-tab pip) mirrors onto the linked resource", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16); // Animal Friendship 3 uses
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const af = innate(s, "Animal Friendship");
		s.useInnateSpell(af.id); // 3 → 2 (mirrors resource)
		s.useInnateSpell(af.id); // 2 → 1
		expect(innate(s, "Animal Friendship").uses.current).toBe(1);
		expect(dfResource(s, "Animal Friendship").current).toBe(1);

		// Clicking a "used" pip in the Spells tab routes through restoreInnateSpell.
		s.restoreInnateSpell(af.id); // 1 → 2, resource mirrors
		expect(innate(s, "Animal Friendship").uses.current).toBe(2);
		expect(dfResource(s, "Animal Friendship").current).toBe(2);

		// Never exceeds max.
		s.restoreInnateSpell(af.id); // 2 → 3
		s.restoreInnateSpell(af.id); // clamp at 3
		expect(innate(s, "Animal Friendship").uses.current).toBe(3);
		expect(dfResource(s, "Animal Friendship").current).toBe(3);
	});

	test("spending the resource (Resources/Combat) decrements the linked innate spell", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16); // 3 uses
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		const res = dfResource(s, "Animal Friendship");
		s.setResourceCurrent(res.id, 1);

		expect(dfResource(s, "Animal Friendship").current).toBe(1);
		expect(innate(s, "Animal Friendship").uses.current).toBe(1);
	});

	test("re-applying does not duplicate resources and preserves spent uses", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		// Spend one Conjure Animals use, then force a reconcile.
		s.setResourceCurrent(dfResource(s, "Conjure Animals").id, 0);
		s.applyDivineFavorEffects();

		const cas = (s._data.resources || []).filter(r => r.name === "Divine Favor: Conjure Animals");
		expect(cas).toHaveLength(1); // no dupes
		expect(cas[0].current).toBe(0); // spent state preserved
		expect(innate(s, "Conjure Animals").uses.current).toBe(0); // and mirrored
	});

	test("a long rest recharges the innate spell and the resource in lockstep", () => {
		const s = makeState();
		s.setAbilityBase("wis", 16); // Animal Friendship 3 uses
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);

		// Spend from both surfaces: cast (Spells tab) + pip (Resources/Combat).
		s.useInnateSpell(innate(s, "Animal Friendship").id); // 3 → 2 (mirrors resource)
		s.setResourceCurrent(dfResource(s, "Conjure Animals").id, 0); // 1 → 0 (mirrors innate)
		expect(dfResource(s, "Animal Friendship").current).toBe(2);
		expect(innate(s, "Conjure Animals").uses.current).toBe(0);

		// Both trackers recharge on a long rest via their independent recharge paths.
		s.restoreInnateSpells("long");
		s.recoverResources("long");

		expect(innate(s, "Animal Friendship").uses.current).toBe(3);
		expect(dfResource(s, "Animal Friendship").current).toBe(3);
		expect(innate(s, "Conjure Animals").uses.current).toBe(1);
		expect(dfResource(s, "Conjure Animals").current).toBe(1);
	});

	test("lowering favour / clearing the god strips the resources", () => {
		const s = makeState();
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(10);
		expect(dfResource(s, "Conjure Animals")).toBeDefined();

		s.setDivineFavorLevel(0);
		expect((s._data.resources || []).filter(r => r._divineFavor)).toHaveLength(0);
	});
});

describe("Divine Favor — Bug 4: real character (Lorian, Pan favour 100)", () => {
	test("granted casts appear as innate spells AND tracked resources on load", () => {
		const raw = fs.readFileSync(
			path.join(__dirnameLocal, "fixtures", "lorian-tempest-cleric.json"), "utf8");
		const s = makeState();
		s.loadFromJson(JSON.parse(raw));
		s.applyDivineFavorEffects(); // controller runs this post-load once the catalog is set

		// Spells tab surface.
		expect(innate(s, "Animal Friendship")).toBeDefined();
		expect(innate(s, "Conjure Animals")).toBeDefined();

		// Resources / Combat surface (via the generic pool both panels read).
		const pool = s.getGenericPoolResources().map(r => r.name);
		expect(pool).toContain("Divine Favor: Animal Friendship");
		expect(pool).toContain("Divine Favor: Conjure Animals");

		// Uses = WIS mod (WIS boosted by the Apostle +2 boon) for the ability-mod cast.
		const wisMod = s.getAbilityMod("wis");
		expect(dfResource(s, "Animal Friendship").max).toBe(Math.max(1, wisMod));
	});
});
