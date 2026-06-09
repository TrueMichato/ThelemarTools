/**
 * Bug #12 — DEX/CON BASE inflation.
 *
 * ASI and feat ability bonuses are baked into the *base* ability scores via a
 * non-idempotent `setAbilityBase(abl, getAbilityBase(abl) + delta)` write, while the
 * feat/feature records that would expose a second application are dedup-guarded. So a
 * re-run of the apply pass (double-finish, re-analyze, builder→quickbuild handoff)
 * silently DOUBLED the base score while adding the feat/feature exactly once.
 *
 * Repro (Lunaria, Centaur Ranger6/Druid3): a single dex+2 ASI produced base dex 19
 * (15→+2→+2) and a single Resilient(con) feat produced base con 20 (18→+1→+1).
 *
 * The fix gates each non-idempotent base write on a FRESH dedupe result:
 *  - the ASI base writes only apply when the "Ability Score Improvement" tracking
 *    feature is newly added (addFeature() === true);
 *  - the feat bonuses only apply when the feat is newly added (addFeat() === true).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

let CharacterSheetState;
beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/** Build a QuickBuild instance wired to a real state, bypassing the wizard UI. */
function makeQb (state) {
	const qb = Object.create(CharacterSheetQuickBuild.prototype);
	qb._state = state;
	qb._page = {getSpells: () => []};
	return qb;
}

const classEntry = {name: "Ranger", source: "PHB"};
const classData = {source: "PHB"};

describe("#12 QuickBuild ASI/feat base-score idempotency", () => {
	let state; let qb;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Ranger", source: "PHB", level: 4});
		qb = makeQb(state);
	});

	test("pure ASI applies +2 to base exactly once; re-applying is a no-op", () => {
		state.setAbilityBase("dex", 15);
		const asiSel = {mode: "asi", abilityChoices: {dex: 2}};

		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(17);

		// Re-run the SAME slot — the inflation bug doubled this to 19.
		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(17);

		const asiFeatures = state.getFeatures()
			.filter(f => f.isAsiChoice && f.className === "Ranger" && f.level === 4);
		expect(asiFeatures).toHaveLength(1);
	});

	test("feat ability bonus applies once; re-applying does not stack", () => {
		state.setAbilityBase("con", 18);
		const resilient = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}]};
		const asiSel = {mode: "feat", feat: resilient, featChoices: {ability: "con"}};

		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("con")).toBe(19);

		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("con")).toBe(19); // bug doubled this to 20

		expect(state.getFeats().filter(f => f.name === "Resilient")).toHaveLength(1);
	});

	test("Thelemar isBoth (ASI + feat) reproduces the Lunaria numbers and stays stable on re-run", () => {
		// Lunaria: base dex 15, con 18; ASI +2 dex, Resilient(con). Expected dex 17, con 19.
		state.setAbilityBase("dex", 15);
		state.setAbilityBase("con", 18);
		const resilient = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}]};
		const asiSel = {isBoth: true, abilityChoices: {dex: 2}, feat: resilient, featChoices: {ability: "con"}};

		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(17);
		expect(state.getAbilityBase("con")).toBe(19);

		// The reported bug: a second apply pass produced dex 19 / con 20.
		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(17);
		expect(state.getAbilityBase("con")).toBe(19);

		expect(state.getFeats().filter(f => f.name === "Resilient")).toHaveLength(1);
		expect(state.getFeatures().filter(f => f.isAsiChoice && f.level === 4)).toHaveLength(1);
	});

	test("the ASI choice and the feat half-ability are not double-counted against each other", () => {
		// Distinct abilities: an ASI to dex and a Resilient(con). Neither should bleed into
		// the other, and applying the feat must not re-touch the ASI's ability or vice-versa.
		state.setAbilityBase("dex", 13);
		state.setAbilityBase("con", 14);
		const resilient = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}]};
		const asiSel = {isBoth: true, abilityChoices: {dex: 2}, feat: resilient, featChoices: {ability: "con"}};

		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(15);
		expect(state.getAbilityBase("con")).toBe(15);
	});

	test("save → load round-trip does NOT replay levelHistory ASIs onto base", () => {
		state.setAbilityBase("dex", 15);
		state.setAbilityBase("con", 18);
		const resilient = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}]};
		const asiSel = {isBoth: true, abilityChoices: {dex: 2}, feat: resilient, featChoices: {ability: "con"}};
		qb._applyAsiOrFeat(asiSel, classEntry, 4, classData);
		// Record the choice into levelHistory the way the apply flow does.
		state.recordLevelChoice?.({
			level: 4,
			class: {name: "Ranger", source: "PHB"},
			choices: {asi: {dex: 2}, feat: {name: "Resilient", source: "PHB"}},
		});

		const json = JSON.parse(JSON.stringify(state.toJson()));
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		expect(reloaded.getAbilityBase("dex")).toBe(17);
		expect(reloaded.getAbilityBase("con")).toBe(19);
	});

	test("ASIs at DIFFERENT levels of the same class each apply (slot key includes level)", () => {
		// The idempotency gate keys on name+source+className+level, so a 2nd ASI to the SAME
		// ability at a LATER level is a distinct slot and must still apply — the fix must not
		// collapse legitimate multi-level ASIs.
		state.setAbilityBase("dex", 14);
		qb._applyAsiOrFeat({mode: "asi", abilityChoices: {dex: 2}}, classEntry, 4, classData);
		expect(state.getAbilityBase("dex")).toBe(16);
		qb._applyAsiOrFeat({mode: "asi", abilityChoices: {dex: 2}}, classEntry, 8, classData);
		expect(state.getAbilityBase("dex")).toBe(18);

		// Re-running EITHER slot is still a no-op.
		qb._applyAsiOrFeat({mode: "asi", abilityChoices: {dex: 2}}, classEntry, 4, classData);
		qb._applyAsiOrFeat({mode: "asi", abilityChoices: {dex: 2}}, classEntry, 8, classData);
		expect(state.getAbilityBase("dex")).toBe(18);
		expect(state.getFeatures().filter(f => f.isAsiChoice && f.className === "Ranger")).toHaveLength(2);
	});

	test("documents the known limitation: a same-name feat taken twice applies bonuses once", () => {
		// `addFeat` dedupes by name+source only (no level), so a repeatable ability-bonus feat
		// taken at two levels records once and — by design of this fix — applies its bonus
		// once. This is the conservative direction (no silent base inflation); full repeatable
		// feat support is out of scope and tracked separately.
		state.setAbilityBase("con", 14);
		const resilient = {name: "Resilient", source: "PHB", ability: [{choose: {from: ["con"], amount: 1}}]};
		qb._applyAsiOrFeat({mode: "feat", feat: resilient, featChoices: {ability: "con"}}, classEntry, 4, classData);
		qb._applyAsiOrFeat({mode: "feat", feat: resilient, featChoices: {ability: "con"}}, classEntry, 8, classData);
		expect(state.getAbilityBase("con")).toBe(15);
		expect(state.getFeats().filter(f => f.name === "Resilient")).toHaveLength(1);
	});
});

describe("#12 LevelUp main ASI/feat path is gated the same way (source guard)", () => {
	const LEVELUP_SRC = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../../../js/charactersheet/charactersheet-levelup.js"),
		"utf8",
	);

	test("ASI base writes are gated on a fresh addFeature(...) in the main path", () => {
		// The increases loop that calls setAbilityBase must sit INSIDE an addFeature(...) gate.
		expect(LEVELUP_SRC).toMatch(/if \(this\._state\.addFeature\(asiFeature\)\) \{[\s\S]*?setAbilityBase\(abl, Math\.min\(20, currentBase/);
	});

	test("feat bonuses are gated on a fresh addFeat(...) in the main path", () => {
		expect(LEVELUP_SRC).toMatch(/const featAdded = this\._state\.addFeat\([\s\S]*?if \(featAdded\) CharacterSheetClassUtils\.applyFeatBonuses/);
	});
});

describe("#12 addFeature returns a boolean dedupe signal", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("returns true on fresh add and false on a deduped re-add", () => {
		const feature = {
			name: "Ability Score Improvement",
			source: "PHB",
			className: "Ranger",
			level: 4,
			featureType: "Class",
			isAsiChoice: true,
		};
		expect(state.addFeature(feature)).toBe(true);
		expect(state.addFeature({...feature})).toBe(false);
	});
});
