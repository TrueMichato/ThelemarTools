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
 *   - apply/clear idempotency (re-apply never double-counts).
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
