/**
 * Druid Resources — Combat-tab panel (round-5 Bug #4) — MECHANICS.
 *
 * The Combat-tab Druid Resources panel is a thin VIEW over the dedicated Druid
 * Resources module. Its data model and action wiring are the single source of
 * truth, so these tests exercise that model/actions DOM-free (the ranger
 * precedent tests the data the render consumes, not the jsdom DOM):
 *  - getCombatSummary(): applicable gating, Wild Shape uses/recharge/in-form,
 *    canTransform / canSummon / canChoose gating on remaining uses, active
 *    Zodiac Form name, and not-applicable for a non-druid.
 *  - Public action wrappers (spendUse / restoreUse) route through state.
 *  - The async picker re-entrancy guard makes Transform single-shot.
 *  - Structural guard: combat.js defines + calls renderCombatDruidResources;
 *    the HTML has the section/container ids; the module exposes the wrappers.
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

let CharacterSheetState;
let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;
});

/** Druid with a Wild Shape feature (auto-creates a featureId-linked resource). */
function makeWildShapeDruid (level = 3, {current = 2, max = 2, recharge = "short"} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: level >= 3 ? {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"} : undefined,
	});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current, max, recharge}});
	return state;
}

/** Minimal page stub: just enough for the module's optional-chained refresh calls. */
function makeModule (state, extra = {}) {
	const page = {getState: () => state, ...extra};
	return new CharacterSheetDruidResources(page);
}

describe("getCombatSummary — Wild Shape", () => {
	it("is applicable and reports current/max/recharge for a Wild Shape druid", () => {
		const druid = makeModule(makeWildShapeDruid(3, {current: 2, max: 2, recharge: "short"}));
		const s = druid.getCombatSummary();
		expect(s.applicable).toBe(true);
		expect(s.wildShape.has).toBe(true);
		expect(s.wildShape.current).toBe(2);
		expect(s.wildShape.max).toBe(2);
		expect(s.wildShape.rechargeLabel).toMatch(/Short or Long Rest/i);
		expect(s.wildShape.canTransform).toBe(true);
	});

	it("blocks Transform / Summon / Choose when no uses remain", () => {
		const druid = makeModule(makeWildShapeDruid(3, {current: 0, max: 2}));
		const s = druid.getCombatSummary();
		expect(s.wildShape.has).toBe(true);
		expect(s.wildShape.canTransform).toBe(false);
		expect(s.wildCompanion.canSummon).toBe(false);
		expect(s.zodiac.canChoose).toBe(false);
	});

	it("reflects the in-form beast when a Wild Shape companion exists", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		state.addCompanion({name: "Dire Wolf", type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, origin: "Wild Shape"});
		const s = makeModule(state).getCombatSummary();
		expect(s.wildShape.inForm).toBe(true);
		expect(s.wildShape.beastName).toBe("Dire Wolf");
	});

	it("is not applicable for a non-druid with no druid resources", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		const s = makeModule(state).getCombatSummary();
		expect(s.applicable).toBe(false);
		expect(s.wildShape.has).toBe(false);
		expect(s.wildCompanion.has).toBe(false);
		expect(s.zodiac.has).toBe(false);
	});
});

describe("getCombatSummary — Wild Companion", () => {
	it("mirrors the feature-calculation flag and gates Summon on remaining uses", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		const calc = state.getFeatureCalculations();
		const druid = makeModule(state);

		const s = druid.getCombatSummary();
		expect(s.wildCompanion.has).toBe(!!calc.hasWildCompanion);
		expect(s.wildCompanion.has).toBe(true); // TGTT (XPHB-edition) druid ≥2 has Wild Companion
		expect(s.wildCompanion.canSummon).toBe(true);

		// Drain the resource → Summon becomes unavailable.
		state.spendWildShapeUse(2);
		expect(druid.getCombatSummary().wildCompanion.canSummon).toBe(false);
	});
});

describe("getCombatSummary — Zodiac Form", () => {
	it("surfaces the active form name once a Zodiac Form is assumed", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		const druid = makeModule(state);

		// No active form yet.
		let s = druid.getCombatSummary();
		expect(s.zodiac.activeFormId).toBeNull();
		expect(s.zodiac.activeFormName).toBeNull();

		const def = state.activateZodiacFormUsingWildShape("cat");
		expect(def).toBeTruthy();

		s = druid.getCombatSummary();
		expect(s.zodiac.has).toBe(true);
		expect(s.zodiac.activeFormId).toBe("cat");
		expect(s.zodiac.activeFormName).toBe(def.name);
	});
});

describe("public action wrappers route through state", () => {
	it("spendUse decrements and restoreUse increments the Wild Shape resource", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		const druid = makeModule(state);

		expect(druid.spendUse()).toBe(true);
		expect(state.getWildShapeResource().current).toBe(0);
		// Nothing left to spend.
		expect(druid.spendUse()).toBe(false);
		expect(state.getWildShapeResource().current).toBe(0);

		expect(druid.restoreUse()).toBe(true);
		expect(state.getWildShapeResource().current).toBe(1);
	});

	it("dismissZodiac clears the active form", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		state.activateZodiacFormUsingWildShape("cat");
		expect(state.getActiveZodiacForm()).toBeTruthy();

		makeModule(state).dismissZodiac();
		expect(state.getActiveZodiacForm()).toBeNull();
	});
});

describe("async picker re-entrancy guard", () => {
	it("pTransform is single-shot: a second call while in flight is a no-op (no double spend)", async () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		let pickerCalls = 0;
		let releasePicker;
		const pickerGate = new Promise((res) => { releasePicker = res; });

		const druid = makeModule(state, {
			_pShowBeastPicker: async () => {
				pickerCalls += 1;
				await pickerGate;
				// Simulate the picker creating exactly one Wild Shape companion.
				state.addCompanion({name: "Bear", type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, origin: "Wild Shape"});
			},
		});

		const first = druid.pTransform(); // starts the picker, sets the guard
		await Promise.resolve();
		const second = druid.pTransform(); // must early-return while in flight

		releasePicker();
		await Promise.all([first, second]);

		expect(pickerCalls).toBe(1); // second call did not re-enter the picker
		// Exactly one use spent (one companion created), not two.
		expect(state.getWildShapeResource().current).toBe(1);
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE).length).toBe(1);
	});
});

describe("Bug #13 — Transform vs Summon create the correct companion type and spend correctly", () => {
	const wolfData = {
		name: "Dire Wolf",
		source: "MM",
		type: "beast",
		ac: [{ac: 14}],
		hp: {average: 37, formula: "5d10 + 10"},
		speed: {walk: 50},
		str: 17,
		dex: 15,
		con: 15,
		int: 3,
		wis: 12,
		cha: 7,
	};
	const owlData = {
		name: "Owl",
		source: "MM",
		type: "beast",
		ac: [{ac: 11}],
		hp: {average: 1, formula: "1d4 - 1"},
		speed: {walk: 5, fly: 60},
		str: 3,
		dex: 13,
		con: 8,
		int: 2,
		wis: 12,
		cha: 7,
	};

	it("Transform spends exactly one Wild Shape use AND creates a WILD_SHAPE companion (NOT a familiar)", async () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		// FAITHFUL picker: routes through the REAL state path the production picker
		// uses (addCompanionFromBestiary with POSITIONAL type/origin), so the test
		// exercises the type/origin contract end-to-end (this is exactly what the
		// #13 regression broke — the old call passed an object as `type`).
		const druid = makeModule(state, {
			_pShowBeastPicker: async (opts) => {
				state.addCompanionFromBestiary(wolfData, opts.type, opts.origin);
			},
		});

		await druid.pTransform();

		// One use spent.
		expect(state.getWildShapeResource().current).toBe(1);
		// A WILD_SHAPE companion exists...
		const wildShapes = state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE);
		expect(wildShapes.length).toBe(1);
		expect(wildShapes[0].name).toBe("Dire Wolf");
		expect(wildShapes[0].type).toBe("wild_shape");
		// ...and crucially it is NOT bucketed as a familiar.
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.FAMILIAR).length).toBe(0);
	});

	it("Transform does NOT spend a use if the picker is cancelled (no companion created)", async () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		const druid = makeModule(state, {
			_pShowBeastPicker: async () => { /* user cancelled — no companion added */ },
		});

		await druid.pTransform();

		expect(state.getWildShapeResource().current).toBe(2);
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE).length).toBe(0);
	});

	it("Summon (Wild Companion) spends one use AND creates a FAMILIAR (NOT a wild_shape companion)", async () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		// The Wild Companion summon routes through the spells module's familiar picker.
		const druid = makeModule(state, {
			_spells: {
				_pShowFamiliarPicker: async () => {
					state.addCompanionFromBestiary(owlData, CharacterSheetState.COMPANION_TYPES.FAMILIAR, "Wild Companion");
				},
			},
		});

		await druid.pSummonWildCompanion();

		// One use spent.
		expect(state.getWildShapeResource().current).toBe(1);
		// A FAMILIAR exists...
		const familiars = state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.FAMILIAR);
		expect(familiars.length).toBe(1);
		expect(familiars[0].type).toBe("familiar");
		// ...and it is NOT bucketed as a Wild Shape form.
		expect(state.getCompanionsByType(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE).length).toBe(0);
	});
});

describe("Combat-tab Druid Resources — structural wiring", () => {
	const combatSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
	const html = fs.readFileSync(path.join(REPO_ROOT, "charactersheet.html"), "utf8");
	const moduleSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-druid-resources.js"), "utf8");

	it("combat.js defines renderCombatDruidResources and calls it from render()", () => {
		expect(combatSrc).toMatch(/renderCombatDruidResources\s*\(\)\s*\{/);
		expect(combatSrc).toMatch(/this\.renderCombatDruidResources\s*\(\)/);
	});

	it("the Combat tab provides the dedicated section + inner container ids", () => {
		expect(html).toMatch(/id="charsheet-combat-druid-section"/);
		expect(html).toMatch(/id="charsheet-combat-druid"/);
	});

	it("the module exposes the public combat-tab entry points", () => {
		for (const fn of ["getCombatSummary", "spendUse", "restoreUse", "pTransform", "endWildShape", "pSummonWildCompanion", "dismissZodiac"]) {
			expect(moduleSrc).toContain(`${fn} (`);
		}
	});

	it("_refreshSheet refreshes the Combat attacks list (so a form-granted attack appears immediately)", () => {
		// Bee Zodiac Form grants a bonus-action attack surfaced via getActiveStateAttacks();
		// the Druid Resources refresh must re-render combat attacks so it shows/hides at once.
		expect(moduleSrc).toMatch(/_combat\?\.renderAttacks\?\.\(\)/);
	});

	it("combat.renderAttacks merges active-state-granted attacks and roll handlers can resolve them", () => {
		expect(combatSrc).toMatch(/getActiveStateAttacks\?\.\(\)/);
		// Both roll paths must fall back to active-state attacks for id resolution.
		const rollAttackIdx = combatSrc.indexOf("_rollAttack (");
		const rollDamageIdx = combatSrc.indexOf("_rollDamage (");
		expect(combatSrc.slice(rollAttackIdx, rollAttackIdx + 1200)).toMatch(/getActiveStateAttacks/);
		expect(combatSrc.slice(rollDamageIdx, rollDamageIdx + 1200)).toMatch(/getActiveStateAttacks/);
	});
});
