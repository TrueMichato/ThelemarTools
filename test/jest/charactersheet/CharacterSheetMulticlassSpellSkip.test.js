/**
 * Bug #6 — Multiclass spell selection is skippable / deferrable.
 *
 * Symptom (pre-fix): when multiclassing into a caster class, the LevelUp
 * "Level 1 Choices" modal (`_pShowMulticlassChoices`) BLOCKED its Confirm
 * button until the player had selected every granted spell and cantrip — even
 * though the spell-picker rendered inside that very modal already told the
 * player "You can skip this and choose spells later on the Spells tab." Every
 * other progression flow (regular LevelUp spell step, Builder level-1 step,
 * QuickBuild aggregate step) is non-gating; the multiclass modal was the
 * outlier.
 *
 * Desired behaviour: the multiclass spell/cantrip pick is optional. Skipping
 *   1. completes the multiclass (the class is added),
 *   2. leaves the class's known/prepared count at 0 against its progression max
 *      (room to fill later — NOT a corrupted/zeroed max),
 *   3. grants NO phantom spells (raw spell/cantrip arrays stay empty), and
 *   4. is completable later (adding a spell stamped with the class raises the
 *      per-class count toward the same max).
 *
 * These tests drive the REAL `_applyMulticlass` skip path (empty selection
 * arrays — exactly what the now-ungated Confirm passes through) so they pin the
 * mechanics, not level counts. A focused source-guard at the bottom pins the
 * removal of the confirm-handler gate so a future edit can't silently
 * reintroduce it.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// --- progression tables (only index 0 is exercised at multiclass level 1) ---
const BARD_KNOWN = [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22];
const BARD_CANTRIP = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const DRUID_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const DRUID_CANTRIP = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const WIZARD_CANTRIP = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

// A page stub providing only what `_applyMulticlass` touches.
const makePage = (state) => ({
	getState: () => state,
	saveCharacter: async () => {},
	renderCharacter: () => {},
	getSpells: () => [],
	getFilteredSpellData: () => [],
});

const cardFor = (state, displayName) =>
	state.getSpellcastingClassBreakdown().find((c) => c.displayName === displayName);

/**
 * Build a Fighter-5 base (non-caster, so the only spell card is the
 * multiclassed-in class) and a LevelUp controller wired to it.
 */
const makeBaseFighter = () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 16);
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("int", 16);
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return {state, lu: new CharacterSheetLevelUp(makePage(state))};
};

describe("Bug #6 — multiclass spell pick is skippable (known caster: Bard)", () => {
	let state; let lu;
	const bard = {
		name: "Bard",
		source: "PHB",
		spellsKnownProgression: BARD_KNOWN,
		cantripProgression: BARD_CANTRIP,
		casterProgression: "full",
		spellcastingAbility: "cha",
	};

	beforeEach(async () => {
		({state, lu} = makeBaseFighter());
		// Skip: empty spell + cantrip arrays — exactly what the ungated Confirm passes.
		await lu._applyMulticlass(bard, [], {}, {}, [], [], []);
	});

	test("skipping still completes the multiclass (class is added)", () => {
		expect(state.getClasses().some((c) => c.name === "Bard")).toBe(true);
		expect(state.getTotalLevel()).toBe(6); // Fighter 5 + Bard 1
	});

	test("leaves the correct deferred room: count 0 against the progression max", () => {
		const card = cardFor(state, "Bard");
		expect(card).toBeTruthy();
		expect(card.spellsCount).toBe(0);
		expect(card.spellsMax).toBe(BARD_KNOWN[0]); // 4 — max intact, NOT zeroed
		expect(card.cantripsCount).toBe(0);
		expect(card.cantripsMax).toBe(BARD_CANTRIP[0]); // 2
	});

	test("grants NO phantom spells (raw known/cantrip arrays stay empty)", () => {
		expect(state.getSpellsKnown()).toHaveLength(0);
		expect(state.getCantripsKnown()).toHaveLength(0);
	});

	test("the deferred pick is completable later via the Spells tab (stamped adds)", () => {
		// Simulate the Spells-tab per-class chip adding spells later (sourceClass stamp).
		state.addSpell({name: "Charm Person", source: "PHB", level: 1, school: "E", sourceFeature: "Spells Known", sourceClass: "Bard"});
		state.addSpell({name: "Vicious Mockery", source: "PHB", level: 0, sourceFeature: "Cantrips Known", sourceClass: "Bard", isCantrip: true});

		const card = cardFor(state, "Bard");
		expect(card.spellsCount).toBe(1);
		expect(card.cantripsCount).toBe(1);
		// Room is preserved (max never moved), so the rest can still be filled.
		expect(card.spellsMax).toBe(BARD_KNOWN[0]);
		expect(card.cantripsMax).toBe(BARD_CANTRIP[0]);
		expect(card.spellsCount).toBeLessThan(card.spellsMax);
	});

	test("preserves the round-2 multiclass history entry (multiclassProficiencies)", () => {
		const entry = state.getLevelHistory().find((h) => h.class && h.class.name === "Bard");
		expect(entry).toBeTruthy();
		expect(entry.choices).toBeTruthy();
		expect("multiclassProficiencies" in entry.choices).toBe(true);
	});
});

describe("Bug #6 — partial pick leaves the remaining room (Bard, 2 of 4)", () => {
	test("picking some-but-not-all spells defers only the remainder", async () => {
		const {state, lu} = makeBaseFighter();
		const bard = {
			name: "Bard",
			source: "PHB",
			spellsKnownProgression: BARD_KNOWN,
			cantripProgression: BARD_CANTRIP,
			casterProgression: "full",
			spellcastingAbility: "cha",
		};
		const twoSpells = [
			{name: "Healing Word", source: "PHB", level: 1, school: "V"},
			{name: "Faerie Fire", source: "PHB", level: 1, school: "V"},
		];
		await lu._applyMulticlass(bard, [], {}, {}, [], twoSpells, []);

		const card = cardFor(state, "Bard");
		expect(card.spellsCount).toBe(2);
		expect(card.spellsMax).toBe(BARD_KNOWN[0]); // 4 — still room for 2 more
		expect(card.spellsCount).toBeLessThan(card.spellsMax);
		// No phantom cantrips were inserted to "fill" the empty cantrip pool.
		expect(card.cantripsCount).toBe(0);
		expect(card.cantripsMax).toBe(BARD_CANTRIP[0]);
	});
});

describe("Bug #6 — multiclass spell pick is skippable (prepared caster: Druid)", () => {
	let state; let lu;
	const druid = {
		name: "Druid",
		source: "XPHB",
		preparedSpellsProgression: DRUID_PREPARED,
		cantripProgression: DRUID_CANTRIP,
		casterProgression: "full",
		spellcastingAbility: "wis",
	};

	beforeEach(async () => {
		({state, lu} = makeBaseFighter());
		await lu._applyMulticlass(druid, [], {}, {}, [], [], []);
	});

	test("completes, no phantom spells, and shows room (count 0 < max)", () => {
		expect(state.getClasses().some((c) => c.name === "Druid")).toBe(true);
		expect(state.getSpellsKnown()).toHaveLength(0);
		expect(state.getCantripsKnown()).toHaveLength(0);

		const card = cardFor(state, "Druid");
		expect(card.spellsCount).toBe(0);
		expect(card.spellsMax).toBeGreaterThan(0); // prepared max intact
		expect(card.cantripsCount).toBe(0);
		expect(card.cantripsMax).toBe(DRUID_CANTRIP[0]);
	});

	test("completable later: a stamped prepared spell raises the count", () => {
		state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, school: "V", sourceFeature: "Prepared Spells", sourceClass: "Druid"});
		const card = cardFor(state, "Druid");
		expect(card.spellsCount).toBe(1);
	});
});

describe("Bug #6 — multiclass spell pick is skippable (Wizard spellbook)", () => {
	test("skip leaves an empty spellbook (uncapped) and is completable later", async () => {
		const {state, lu} = makeBaseFighter();
		const wizard = {
			name: "Wizard",
			source: "PHB",
			cantripProgression: WIZARD_CANTRIP,
			casterProgression: "full",
			spellcastingAbility: "int",
		};
		await lu._applyMulticlass(wizard, [], {}, {}, [], [], []);

		expect(state.getClasses().some((c) => c.name === "Wizard")).toBe(true);
		expect(state.getSpellsKnown()).toHaveLength(0);

		const card = cardFor(state, "Wizard");
		expect(card.mechanic).toBe("spellbook");
		expect(card.spellsMax).toBeNull(); // spellbook is uncapped — count only
		expect(card.spellsCount).toBe(0);

		// Complete later: scribe a spell into the spellbook.
		state.addSpell({name: "Magic Missile", source: "PHB", level: 1, school: "V", sourceFeature: "Wizard Spellbook", sourceClass: "Wizard", inSpellbook: true});
		expect(cardFor(state, "Wizard").spellsCount).toBe(1);
	});
});

describe("Bug #6 — cantrip-only and spell-only multiclass gains defer cleanly", () => {
	test("cantrip-only class: skip adds no cantrips, leaves room", async () => {
		const {state, lu} = makeBaseFighter();
		const cantripOnly = {
			name: "Bard",
			source: "PHB",
			spellsKnownProgression: [0, 0, 0], // no leveled spells at L1
			cantripProgression: BARD_CANTRIP,
			casterProgression: "full",
			spellcastingAbility: "cha",
		};
		await lu._applyMulticlass(cantripOnly, [], {}, {}, [], [], []);
		const card = cardFor(state, "Bard");
		expect(card.cantripsCount).toBe(0);
		expect(card.cantripsMax).toBe(BARD_CANTRIP[0]);
		expect(state.getCantripsKnown()).toHaveLength(0);
	});

	test("spell-only class: skip adds no spells, leaves room", async () => {
		const {state, lu} = makeBaseFighter();
		const spellOnly = {
			name: "Bard",
			source: "PHB",
			spellsKnownProgression: BARD_KNOWN,
			cantripProgression: [0, 0, 0], // no cantrips
			casterProgression: "full",
			spellcastingAbility: "cha",
		};
		await lu._applyMulticlass(spellOnly, [], {}, {}, [], [], []);
		const card = cardFor(state, "Bard");
		expect(card.spellsCount).toBe(0);
		expect(card.spellsMax).toBe(BARD_KNOWN[0]);
		expect(state.getSpellsKnown()).toHaveLength(0);
	});
});

describe("Bug #6 — confirm-handler gate is gone (source guard, all flows)", () => {
	const LEVELUP = read("js/charactersheet/charactersheet-levelup.js");
	const BUILDER = read("js/charactersheet/charactersheet-builder.js");
	const QUICKBUILD = read("js/charactersheet/charactersheet-quickbuild.js");

	test("LevelUp multiclass Confirm no longer returns on under-filled spell pools", () => {
		// The exact pre-fix gate: a length comparison against the gain that
		// `return`s out of the Confirm handler with a "Please select N spell(s)"
		// warning toast. Both spell and cantrip variants must be gone.
		expect(LEVELUP).not.toMatch(/selectedMulticlassSpells\.length\s*<\s*multiclassSpellGain/);
		expect(LEVELUP).not.toMatch(/selectedMulticlassCantrips\.length\s*<\s*multiclassCantripGain/);
		expect(LEVELUP).not.toMatch(/Please select \$\{multiclassSpellGain\}/);
		expect(LEVELUP).not.toMatch(/Please select \$\{multiclassCantripGain\}/);
	});

	test("Builder level-1 spell step remains non-gating", () => {
		// Builder is level-1 single-class only; its Spells step must not pop a
		// "Skip Spell Selection?" gate.
		expect(BUILDER).not.toMatch(/Skip Spell Selection\?/);
	});

	test("QuickBuild aggregate spell step remains non-gating", () => {
		const m = QUICKBUILD.match(/_validateSpellsStep\s*\([^)]*\)\s*\{([\s\S]*?)\n\t\}/);
		expect(m).not.toBeNull();
		expect(m[1]).toMatch(/return true;\s*$/);
	});
});
