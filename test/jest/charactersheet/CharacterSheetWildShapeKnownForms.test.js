/**
 * Druid 2024 Wild Shape — "Known Forms" roster (Bug #9) — MECHANICS.
 *
 * The official 2024 PHB Wild Shape model: the druid curates a PERSISTENT,
 * per-character roster of learned Beast forms (within level-gated CR / Fly
 * limits) and at transform time picks FROM that roster (no fresh bestiary
 * search each time). These tests pin the data model + state API end-to-end:
 *  - Edition gating (`usesKnownFormsWildShape`): PHB → no; XPHB / TGTT(-family) → yes.
 *  - `getFeatureCalculations` limits (Known Forms cap, max CR, Fly/Swim gating).
 *  - `addKnownWildShapeForm` legality is enforced IN STATE (beast-only, CR cap,
 *    Fly gating, roster cap, duplicate `{name, source}`), not only in the picker.
 *  - Persist + load round-trip, and OLD-save backward compat (field absent → []).
 *  - `transformIntoKnownForm` atomic: spends exactly one use, creates one fresh
 *    WILD_SHAPE companion (id distinct from the knownFormId), replaces the prior
 *    form, blocked at 0 uses / unknown id; a damaged transform never writes HP
 *    back into the stored template.
 *  - Level-down: over-limit roster forms persist but are NOT transformable.
 *  - The module surfaces the roster via `getCombatSummary` + builds the hover
 *    name / stat line via the SHARED class-utils helpers.
 *  - Zodiac independence is preserved.
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

let CharacterSheetState;
let CharacterSheetClassUtils;
let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;

	// The setup.js Parser mock omits crToNumber; the Known Forms CR gating needs
	// faithful fraction handling ("1/4" → 0.25), so provide a realistic shim.
	const CR_MAP = {"0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5};
	globalThis.Parser.crToNumber = (cr) => {
		if (cr == null) return 0;
		const s = String(cr);
		if (s in CR_MAP) return CR_MAP[s];
		const n = Number(s);
		return Number.isFinite(n) ? n : 0;
	};
});

/** A Druid with a Wild Shape uses resource. `source` drives the edition gate. */
function makeDruid (level = 2, {current = 2, max = 2, source = "TGTT"} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Druid", source, level});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current, max, recharge: "short"}});
	return state;
}

/** Minimal bestiary beast fixtures (only fields the parser reads). */
const WOLF = {name: "Wolf", source: "MM", type: "beast", cr: "1/4", ac: [{ac: 13}], hp: {average: 11}, speed: {walk: 40}, str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6, senses: ["darkvision 60 ft."], trait: [{name: "Pack Tactics", entries: ["Advantage when an ally is near."]}]};
const GIANT_BADGER = {name: "Giant Badger", source: "MM", type: "beast", cr: "1/4", ac: [{ac: 10}], hp: {average: 13}, speed: {walk: 30, burrow: 10}, str: 13, dex: 10, con: 15, int: 2, wis: 12, cha: 5};
const OWL = {name: "Owl", source: "MM", type: "beast", cr: "0", ac: [{ac: 11}], hp: {average: 1}, speed: {walk: 5, fly: 60}, str: 3, dex: 13, con: 8, int: 2, wis: 12, cha: 7};
const BROWN_BEAR = {name: "Brown Bear", source: "MM", type: "beast", cr: "1", ac: [{ac: 11}], hp: {average: 34}, speed: {walk: 40, climb: 30}, str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7};
const COMMONER = {name: "Commoner", source: "MM", type: "humanoid", cr: "0", ac: [{ac: 10}], hp: {average: 4}, speed: {walk: 30}, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};

const WS = () => CharacterSheetState.COMPANION_TYPES.WILD_SHAPE;

describe("usesKnownFormsWildShape — edition gating", () => {
	it("is FALSE for a genuine 2014 PHB druid (legacy free-pick path)", () => {
		expect(makeDruid(2, {source: "PHB"}).usesKnownFormsWildShape()).toBe(false);
	});
	it("is TRUE for an XPHB druid", () => {
		expect(makeDruid(2, {source: "XPHB"}).usesKnownFormsWildShape()).toBe(true);
	});
	it("is TRUE for a TGTT druid", () => {
		expect(makeDruid(2, {source: "TGTT"}).usesKnownFormsWildShape()).toBe(true);
	});
	it("is TRUE for a TGTT-family SUB-SOURCE druid (e.g. TGTT-2024)", () => {
		expect(makeDruid(2, {source: "TGTT-2024"}).usesKnownFormsWildShape()).toBe(true);
	});
	it("is FALSE when there is no Druid class", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Ranger", source: "TGTT", level: 6});
		expect(state.usesKnownFormsWildShape()).toBe(false);
	});
});

describe("getFeatureCalculations — Known Forms limits by level (2024 Beast Shapes table)", () => {
	const calcAt = (level) => makeDruid(level, {source: "TGTT"}).getFeatureCalculations();

	it("Level 2: 4 forms, CR 1/4, no Fly, Swim allowed", () => {
		const c = calcAt(2);
		expect(c.wildShapeUsesKnownForms).toBe(true);
		expect(c.wildShapeKnownFormsMax).toBe(4);
		expect(c.wildShapeCr).toBe(0.25);
		expect(c.wildShapeCanFly).toBe(false);
		expect(c.wildShapeCanSwim).toBe(true);
	});
	it("Level 4: 6 forms, CR 1/2, no Fly", () => {
		const c = calcAt(4);
		expect(c.wildShapeKnownFormsMax).toBe(6);
		expect(c.wildShapeCr).toBe(0.5);
		expect(c.wildShapeCanFly).toBe(false);
	});
	it("Level 8: 8 forms, CR 1, Fly allowed", () => {
		const c = calcAt(8);
		expect(c.wildShapeKnownFormsMax).toBe(8);
		expect(c.wildShapeCr).toBe(1);
		expect(c.wildShapeCanFly).toBe(true);
	});
	it("a 2014 PHB druid does NOT get the Known Forms cap", () => {
		const c = makeDruid(8, {source: "PHB"}).getFeatureCalculations();
		expect(c.wildShapeUsesKnownForms).toBeUndefined();
		expect(c.wildShapeKnownFormsMax).toBeUndefined();
	});
});

describe("addKnownWildShapeForm — legality enforced in STATE", () => {
	it("learns a legal beast and returns a stable id; roster grows", () => {
		const state = makeDruid(2);
		expect(state.getKnownWildShapeForms()).toHaveLength(0);
		const id = state.addKnownWildShapeForm(WOLF);
		expect(typeof id).toBe("string");
		const forms = state.getKnownWildShapeForms();
		expect(forms).toHaveLength(1);
		expect(forms[0].id).toBe(id);
		expect(forms[0].name).toBe("Wolf");
		expect(forms[0].source).toBe("MM");
		expect(forms[0].crNumber).toBe(0.25);
		// Templates store hp.max only — never live current HP.
		expect(forms[0].hp).toEqual({max: 11});
		expect(forms[0].hp.current).toBeUndefined();
	});

	it("rejects a NON-beast creature", () => {
		const state = makeDruid(2);
		expect(state.addKnownWildShapeForm(COMMONER)).toBeNull();
		expect(state.getKnownWildShapeForms()).toHaveLength(0);
	});

	it("rejects a beast OVER the level CR limit (Brown Bear CR 1 at L2)", () => {
		const state = makeDruid(2);
		expect(state.addKnownWildShapeForm(BROWN_BEAR)).toBeNull();
		expect(state.getKnownWildShapeForms()).toHaveLength(0);
	});

	it("rejects a flyer when Fly is not yet unlocked (Owl at L2), but allows it at L8", () => {
		const low = makeDruid(2);
		expect(low.addKnownWildShapeForm(OWL)).toBeNull();
		expect(low.getKnownWildShapeForms()).toHaveLength(0);

		const high = makeDruid(8);
		expect(typeof high.addKnownWildShapeForm(OWL)).toBe("string");
		expect(high.getKnownWildShapeForms()).toHaveLength(1);
	});

	it("rejects a DUPLICATE {name, source}", () => {
		const state = makeDruid(2);
		expect(typeof state.addKnownWildShapeForm(WOLF)).toBe("string");
		expect(state.addKnownWildShapeForm({...WOLF})).toBeNull();
		expect(state.getKnownWildShapeForms()).toHaveLength(1);
	});

	it("rejects beyond the level-gated cap (4 at L2)", () => {
		const state = makeDruid(2);
		// Four distinct legal CR-1/4 beasts fill the cap.
		const beasts = [WOLF, GIANT_BADGER,
			{...WOLF, name: "Panther"}, {...WOLF, name: "Boar"}];
		for (const b of beasts) expect(typeof state.addKnownWildShapeForm(b)).toBe("string");
		expect(state.getKnownWildShapeForms()).toHaveLength(4);
		expect(state.canAddKnownWildShapeForm()).toBe(false);
		// Fifth is rejected.
		expect(state.addKnownWildShapeForm({...WOLF, name: "Elk"})).toBeNull();
		expect(state.getKnownWildShapeForms()).toHaveLength(4);
	});

	it("getKnownWildShapeFormsMax reflects the level (0 for a non-2024 druid)", () => {
		expect(makeDruid(2, {source: "TGTT"}).getKnownWildShapeFormsMax()).toBe(4);
		expect(makeDruid(8, {source: "XPHB"}).getKnownWildShapeFormsMax()).toBe(8);
	});

	it("rejects adds and treats forms as illegal when Known Forms is not active (druid level 1)", () => {
		// A level-1 2024 druid has no Known Forms cap / CR limit yet. Adds are
		// rejected and any (improperly present) form is not transformable.
		const state = makeDruid(1, {current: 1, max: 1, source: "XPHB"});
		expect(state.getFeatureCalculations().wildShapeCr).toBeUndefined();
		expect(state.addKnownWildShapeForm(WOLF)).toBeNull();
		// Force a form into the roster to exercise the legality guard directly.
		state._data.wildShapeKnownForms.push({id: "x", name: "Wolf", source: "MM", crNumber: 0.25, hasFly: false, hp: {max: 11}});
		expect(state.isKnownWildShapeFormLegalNow(state.getKnownWildShapeForm("x"))).toBe(false);
		expect(state.transformIntoKnownForm("x")).toBeNull();
	});

	it("removeKnownWildShapeForm drops the form", () => {
		const state = makeDruid(2);
		const id = state.addKnownWildShapeForm(WOLF);
		expect(state.removeKnownWildShapeForm(id)).toBe(true);
		expect(state.getKnownWildShapeForms()).toHaveLength(0);
		expect(state.removeKnownWildShapeForm("nope")).toBe(false);
	});
});

describe("persistence — round-trip + backward compat", () => {
	it("round-trips the Known Forms roster through toJson/loadFromJson", () => {
		const state = makeDruid(4);
		const id = state.addKnownWildShapeForm(WOLF);
		state.addKnownWildShapeForm(BROWN_BEAR); // legal at L4? CR 1 > 0.5 → rejected, stays 1
		expect(state.getKnownWildShapeForms()).toHaveLength(1);

		const json = JSON.parse(JSON.stringify(state.toJson()));
		const reload = new CharacterSheetState();
		reload.loadFromJson(json);

		const forms = reload.getKnownWildShapeForms();
		expect(forms).toHaveLength(1);
		expect(forms[0].id).toBe(id);
		expect(forms[0].name).toBe("Wolf");
		expect(forms[0].crNumber).toBe(0.25);
	});

	it("an OLD save with no wildShapeKnownForms field loads cleanly to an empty roster", () => {
		const state = makeDruid(2);
		const json = JSON.parse(JSON.stringify(state.toJson()));
		delete json.wildShapeKnownForms; // simulate a pre-feature save
		const reload = new CharacterSheetState();
		expect(() => reload.loadFromJson(json)).not.toThrow();
		expect(reload.getKnownWildShapeForms()).toEqual([]);
	});
});

describe("transformIntoKnownForm — atomic transform", () => {
	it("spends exactly one use and creates one fresh WILD_SHAPE companion (id != knownFormId)", () => {
		const state = makeDruid(2, {current: 2, max: 2});
		const formId = state.addKnownWildShapeForm(WOLF);

		const companionId = state.transformIntoKnownForm(formId);
		expect(typeof companionId).toBe("string");
		expect(companionId).not.toBe(formId);

		// Exactly one use spent.
		expect(state.getWildShapeResource().current).toBe(1);

		// One WILD_SHAPE companion, sourced from the template, with fresh full HP.
		const ws = state.getCompanionsByType(WS());
		expect(ws).toHaveLength(1);
		expect(ws[0].id).toBe(companionId);
		expect(ws[0].name).toBe("Wolf");
		expect(ws[0].type).toBe("wild_shape");
		expect(ws[0].hp.current).toBe(ws[0].hp.max);

		// The roster template is untouched (still 1 form, still no live HP).
		const forms = state.getKnownWildShapeForms();
		expect(forms).toHaveLength(1);
		expect(forms[0].hp.current).toBeUndefined();
	});

	it("replaces the prior Wild Shape companion (one form at a time)", () => {
		const state = makeDruid(2, {current: 2, max: 2});
		const wolfId = state.addKnownWildShapeForm(WOLF);
		const badgerId = state.addKnownWildShapeForm(GIANT_BADGER);

		const c1 = state.transformIntoKnownForm(wolfId);
		const c2 = state.transformIntoKnownForm(badgerId);
		expect(c1).not.toBe(c2);

		const ws = state.getCompanionsByType(WS());
		expect(ws).toHaveLength(1);
		expect(ws[0].name).toBe("Giant Badger");
		// Two transforms → two uses spent.
		expect(state.getWildShapeResource().current).toBe(0);
	});

	it("is BLOCKED (null, no mutation) when no uses remain", () => {
		const state = makeDruid(2, {current: 0, max: 2});
		const formId = state.addKnownWildShapeForm(WOLF);
		expect(state.transformIntoKnownForm(formId)).toBeNull();
		expect(state.getCompanionsByType(WS())).toHaveLength(0);
		expect(state.getWildShapeResource().current).toBe(0);
	});

	it("is BLOCKED for an unknown form id (no use spent)", () => {
		const state = makeDruid(2, {current: 2, max: 2});
		expect(state.transformIntoKnownForm("does-not-exist")).toBeNull();
		expect(state.getWildShapeResource().current).toBe(2);
		expect(state.getCompanionsByType(WS())).toHaveLength(0);
	});

	it("a damaged transform NEVER writes HP back into the stored template", () => {
		const state = makeDruid(2, {current: 2, max: 2});
		const formId = state.addKnownWildShapeForm(WOLF);
		const companionId = state.transformIntoKnownForm(formId);

		// Damage the active companion directly.
		const companion = state.getCompanions().find(c => c.id === companionId);
		companion.hp.current = 1;

		// Template is a separate object: max preserved, no current leaked in.
		const form = state.getKnownWildShapeForm(formId);
		expect(form.hp.max).toBe(11);
		expect(form.hp.current).toBeUndefined();

		// Re-transforming yields a FRESH full-HP companion.
		state.restoreWildShapeUse(1);
		state.transformIntoKnownForm(formId);
		const ws = state.getCompanionsByType(WS());
		expect(ws).toHaveLength(1);
		expect(ws[0].hp.current).toBe(ws[0].hp.max);
	});
});

describe("level-down — over-limit forms persist but are not transformable", () => {
	it("isKnownWildShapeFormLegalNow flips to false and transform is blocked", () => {
		// Learn an Owl (flyer) at L8 (legal), then drop to L2 where Fly is gated.
		const state = makeDruid(8, {current: 2, max: 2});
		const owlId = state.addKnownWildShapeForm(OWL);
		expect(state.isKnownWildShapeFormLegalNow(state.getKnownWildShapeForm(owlId))).toBe(true);

		// Simulate a level-down by editing the class level in place.
		state._data.classes.find(c => c.name === "Druid").level = 2;

		// Form is RETAINED (never auto-deleted)...
		expect(state.getKnownWildShapeForms()).toHaveLength(1);
		// ...but is now illegal and cannot be transformed into.
		expect(state.isKnownWildShapeFormLegalNow(state.getKnownWildShapeForm(owlId))).toBe(false);
		expect(state.transformIntoKnownForm(owlId)).toBeNull();
		expect(state.getCompanionsByType(WS())).toHaveLength(0);
		expect(state.getWildShapeResource().current).toBe(2); // no use spent
	});
});

describe("module — combat summary + shared-helper hover markup", () => {
	const makeModule = (state) => new CharacterSheetDruidResources({getState: () => state});

	it("getCombatSummary surfaces the Known Forms roster (additive fields)", () => {
		const state = makeDruid(2, {current: 2, max: 2});
		state.addKnownWildShapeForm(WOLF);
		const s = makeModule(state).getCombatSummary();
		expect(s.wildShape.usesKnownForms).toBe(true);
		expect(s.wildShape.knownFormsMax).toBe(4);
		expect(s.wildShape.canAddForm).toBe(true);
		expect(s.wildShape.knownForms).toHaveLength(1);
		expect(s.wildShape.knownForms[0].name).toBe("Wolf");
		expect(s.wildShape.knownForms[0].knownFormId).toBeTruthy();
		expect(s.wildShape.knownForms[0].isLegalNow).toBe(true);
	});

	it("a 2014 PHB druid summary does NOT use Known Forms", () => {
		const state = makeDruid(2, {current: 2, max: 2, source: "PHB"});
		const s = makeModule(state).getCombatSummary();
		expect(s.wildShape.usesKnownForms).toBe(false);
		expect(s.wildShape.knownForms).toEqual([]);
		expect(s.wildShape.knownFormsMax).toBe(0);
	});

	it("builds the hover name + stat line via the SHARED class-utils helpers", () => {
		const state = makeDruid(2);
		state.addKnownWildShapeForm(WOLF);
		const model = makeModule(state).getCombatSummary().wildShape.knownForms[0];

		const nameHtml = CharacterSheetClassUtils.buildCreatureHoverNameHtml(model, "ve-bold");
		expect(typeof nameHtml).toBe("string");
		expect(nameHtml).toContain("Wolf");

		const statHtml = CharacterSheetClassUtils.buildCreatureStatLineHtml(model);
		expect(statHtml).toContain("AC");
		expect(statHtml).toContain("HP");
		// Template HP shows max only (no live "current/max").
		expect(statHtml).toContain("11");
		expect(statHtml).not.toContain("/11");
	});

	it("escapes a hostile creature name in the hover markup (no raw injection)", () => {
		const state = makeDruid(2);
		state.addKnownWildShapeForm({...WOLF, name: "<script>x</script>"});
		const model = makeModule(state).getCombatSummary().wildShape.knownForms[0];
		const nameHtml = CharacterSheetClassUtils.buildCreatureHoverNameHtml(model);
		expect(nameHtml).not.toContain("<script>");
		expect(nameHtml).toContain("&lt;script&gt;");
	});
});

describe("Zodiac independence — unaffected by the roster", () => {
	it("activating + dismissing a Zodiac Form works with a roster present", () => {
		const state = makeDruid(3, {current: 3, max: 3});
		state.addKnownWildShapeForm(WOLF);
		const def = state.activateZodiacFormUsingWildShape("cat");
		expect(def).toBeTruthy();
		expect(state.getActiveZodiacForm()).toBeTruthy();
		// Spending a use on Zodiac did not touch the roster.
		expect(state.getKnownWildShapeForms()).toHaveLength(1);
		state.deactivateState("zodiacForm");
		expect(state.getActiveZodiacForm()).toBeNull();
		expect(state.getKnownWildShapeForms()).toHaveLength(1);
	});
});

describe("picker select-mode — source guard (charactersheet.js)", () => {
	it("_pShowBeastPicker routes a chosen creature to onSelectCreature and SKIPS addCompanionFromBestiary", () => {
		const src = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		// The select-mode branch must exist and return before the default add path.
		expect(src).toMatch(/onSelectCreature\s*=\s*null/);
		expect(src).toMatch(/if\s*\(typeof onSelectCreature === "function"\)\s*\{\s*\n\s*onSelectCreature\(selectedCreature\);\s*\n\s*return;/);
		// The default path still calls addCompanionFromBestiary positionally.
		expect(src).toMatch(/addCompanionFromBestiary\?\.\(selectedCreature, type, origin\)/);
	});
});
