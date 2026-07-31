/**
 * Bug #6 — Booming Blade / Green-Flame Blade reimplementation (spells side).
 *
 * These tests cover the pure detection + damage-split logic and the standalone
 * "cast alone = secondary/movement damage only" behaviour, plus the cast-options
 * menu builder (`_buildCastOptionItems`) that backs the right-click / long-press
 * cast menu (Bug #7).
 *
 * They drive static + instance methods on a `CharacterSheetSpells` prototype shell
 * with mock `_state`/`_page`, so the real logic runs without the page bootstrap.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

// --- Spell data fixtures (mirrors data/spells/spells-tce.json shape) ----------

const BOOMING_BLADE = {
	name: "Booming Blade",
	source: "TCE",
	level: 0,
	damageInflict: ["thunder"],
	entries: [
		"You brandish the weapon used in the spell's casting and make a melee attack with it against one creature within 5 feet of you. On a hit, the target suffers the weapon attack's normal effects and then becomes sheathed in booming energy until the start of your next turn.",
	],
	scalingLevelDice: [
		{label: "thunder damage on moving", scaling: {1: "1d8", 5: "2d8", 11: "3d8", 17: "4d8"}},
		{label: "thunder damage on hit", scaling: {5: "1d8", 11: "2d8", 17: "3d8"}},
	],
};

const GREEN_FLAME_BLADE = {
	name: "Green-Flame Blade",
	source: "TCE",
	level: 0,
	damageInflict: ["fire"],
	entries: [
		"You brandish the weapon used in the spell's casting and make a melee attack with it against one creature within 5 feet of you. On a hit, the target suffers the weapon attack's normal effects, and you cause green fire to leap.",
	],
	scalingLevelDice: [
		{label: "fire damage to secondary creature", scaling: {1: "{{spellcasting_mod}}", 5: "1d8 + {{spellcasting_mod}}", 11: "2d8 + {{spellcasting_mod}}", 17: "3d8 + {{spellcasting_mod}}"}},
		{label: "fire damage on hit", scaling: {5: "1d8", 11: "2d8", 17: "3d8"}},
	],
};

const FIRE_BOLT = {
	name: "Fire Bolt",
	source: "XPHB",
	level: 0,
	damageInflict: ["fire"],
	entries: ["You hurl a mote of fire at a creature or object within range. Make a ranged spell attack."],
	scalingLevelDice: [{label: "fire damage", scaling: {1: "1d10", 5: "2d10", 11: "3d10", 17: "4d10"}}],
};

function makeSpellsShell (stateOverrides = {}) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = {
		getTotalLevel: () => 5,
		getSpellcastingAbility: () => "int",
		getSpellcastingAbilityForSpell: () => null,
		getAbilityMod: () => 3,
		getItemBonus: () => 0,
		...stateOverrides,
	};
	spells._page = {pAnimateDamageDice: () => {}};
	spells._allSpells = [BOOMING_BLADE, GREEN_FLAME_BLADE, FIRE_BOLT];
	return spells;
}

// --- Detection ----------------------------------------------------------------

describe("Blade cantrip detection (getWeaponChannelCantripInfo)", () => {
	it("detects Booming Blade with on-hit + secondary split", () => {
		const info = CharacterSheetSpells.getWeaponChannelCantripInfo(BOOMING_BLADE);
		expect(info).not.toBeNull();
		expect(info.onHitScaling.label).toMatch(/on hit/i);
		expect(info.secondaryScaling.label).toMatch(/moving/i);
		expect(info.onHitDamageType).toBe("thunder");
		expect(info.secondaryDamageType).toBe("thunder");
	});

	it("detects Green-Flame Blade", () => {
		const info = CharacterSheetSpells.getWeaponChannelCantripInfo(GREEN_FLAME_BLADE);
		expect(info).not.toBeNull();
		expect(info.onHitDamageType).toBe("fire");
		expect(info.secondaryScaling.label).toMatch(/secondary creature/i);
	});

	it("does NOT detect a normal attack cantrip (Fire Bolt — no melee-attack text / single scaling)", () => {
		expect(CharacterSheetSpells.getWeaponChannelCantripInfo(FIRE_BOLT)).toBeNull();
	});

	it("returns null for non-cantrips and missing data", () => {
		expect(CharacterSheetSpells.getWeaponChannelCantripInfo({...BOOMING_BLADE, level: 1})).toBeNull();
		expect(CharacterSheetSpells.getWeaponChannelCantripInfo(null)).toBeNull();
		expect(CharacterSheetSpells.getWeaponChannelCantripInfo({level: 0})).toBeNull();
	});
});

// --- Scaling resolution + mod templating --------------------------------------

describe("resolveScalingDiceForLevel", () => {
	const scaling = {1: "1d8", 5: "2d8", 11: "3d8", 17: "4d8"};

	it("picks the highest keyed tier at or below the character level", () => {
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(scaling, 1)).toBe("1d8");
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(scaling, 4)).toBe("1d8");
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(scaling, 5)).toBe("2d8");
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(scaling, 16)).toBe("3d8");
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(scaling, 20)).toBe("4d8");
	});

	it("returns null below the lowest keyed tier (on-hit absent before L5)", () => {
		const onHit = {5: "1d8", 11: "2d8", 17: "3d8"};
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(onHit, 4)).toBeNull();
		expect(CharacterSheetSpells.resolveScalingDiceForLevel(onHit, 5)).toBe("1d8");
	});
});

describe("applySpellcastingModTemplate", () => {
	it("substitutes a bare template with just the modifier", () => {
		expect(CharacterSheetSpells.applySpellcastingModTemplate("{{spellcasting_mod}}", 3)).toBe("3");
	});

	it("collapses 'NdM + {{spellcasting_mod}}' into a signed expression", () => {
		expect(CharacterSheetSpells.applySpellcastingModTemplate("1d8 + {{spellcasting_mod}}", 3)).toBe("1d8 + 3");
		expect(CharacterSheetSpells.applySpellcastingModTemplate("2d8 + {{spellcasting_mod}}", 0)).toBe("2d8");
		expect(CharacterSheetSpells.applySpellcastingModTemplate("1d8 + {{spellcasting_mod}}", -1)).toBe("1d8 - 1");
	});

	it("passes through dice with no template", () => {
		expect(CharacterSheetSpells.applySpellcastingModTemplate("2d8", 3)).toBe("2d8");
	});
});

// --- Per-character resolution -------------------------------------------------

describe("getWeaponChannelCantripForCharacter", () => {
	it("Booming Blade at L1: secondary 1d8, NO on-hit yet", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 1});
		const ch = spells.getWeaponChannelCantripForCharacter({name: "Booming Blade", source: "TCE"}, BOOMING_BLADE);
		expect(ch.secondaryDice).toBe("1d8");
		expect(ch.onHitDice).toBeNull();
		expect(ch.onHitDamageType).toBe("thunder");
	});

	it("Booming Blade at L5: secondary 2d8, on-hit 1d8", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 5});
		const ch = spells.getWeaponChannelCantripForCharacter({name: "Booming Blade", source: "TCE"}, BOOMING_BLADE);
		expect(ch.secondaryDice).toBe("2d8");
		expect(ch.onHitDice).toBe("1d8");
	});

	it("Green-Flame Blade at L1: secondary is the bare spellcasting mod, no on-hit", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 1, getAbilityMod: () => 4});
		const ch = spells.getWeaponChannelCantripForCharacter({name: "Green-Flame Blade", source: "TCE"}, GREEN_FLAME_BLADE);
		expect(ch.secondaryDice).toBe("4");
		expect(ch.onHitDice).toBeNull();
	});

	it("Green-Flame Blade at L5: secondary '1d8 + mod', on-hit '1d8'", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 5, getAbilityMod: () => 4});
		const ch = spells.getWeaponChannelCantripForCharacter({name: "Green-Flame Blade", source: "TCE"}, GREEN_FLAME_BLADE);
		expect(ch.secondaryDice).toBe("1d8 + 4");
		expect(ch.onHitDice).toBe("1d8");
	});
});

// --- Standalone cast = secondary-only -----------------------------------------

describe("_rollWeaponChannelSecondary (cast alone rolls ONLY secondary/movement damage)", () => {
	it("rolls the secondary dice and flags isWeaponChannel + on-hit note", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 5});
		spells._rollDamageDiceDetailed = (dice) => ({total: 9, groups: [{dice, values: [4, 5]}]});
		const ch = spells.getWeaponChannelCantripForCharacter({name: "Booming Blade", source: "TCE"}, BOOMING_BLADE);
		const res = spells._rollWeaponChannelSecondary(BOOMING_BLADE, ch);
		expect(res.isWeaponChannel).toBe(true);
		expect(res.dice).toBe("2d8");
		expect(res.total).toBe(9);
		expect(res.damageType).toBe("thunder");
		expect(res.text).toMatch(/rides your weapon attack/i);
	});

	it("returns a zero-total note when there is no secondary damage to roll", () => {
		const spells = makeSpellsShell();
		const res = spells._rollWeaponChannelSecondary(BOOMING_BLADE, {secondaryDice: null, secondaryDamageType: "thunder"});
		expect(res.total).toBe(0);
		expect(res.isWeaponChannel).toBe(true);
		expect(res.text).toMatch(/rides your weapon attack/i);
	});

	it("_rollSpellDamage intercepts blade cantrips → secondary-only path", () => {
		const spells = makeSpellsShell({getTotalLevel: () => 5});
		spells._rollDamageDiceDetailed = (dice) => ({total: 7, groups: [{dice, values: [7]}]});
		const res = spells._rollSpellDamage(BOOMING_BLADE, 0, 0, null, {name: "Booming Blade", source: "TCE"});
		expect(res.isWeaponChannel).toBe(true);
		expect(res.dice).toBe("2d8");
	});

	it("applies an armed typed maximizer and damage-triggered effects to secondary damage", () => {
		const consume = jest.fn(() => true);
		const spells = makeSpellsShell({
			canApplyPendingDamageMaximization: type => type === "thunder",
			consumePendingDamageMaximization: consume,
			getTriggeredDamageEffects: type => type === "thunder" ? [{type: "forcedMovement", distance: 10, direction: "away", maxTargetSize: "Large"}] : [],
		});
		spells._rollDamageDiceDetailed = (dice, {maximize}) => ({total: maximize ? 16 : 2, groups: [{dice, values: maximize ? [8, 8] : [1, 1]}]});
		const res = spells._rollSpellDamage(BOOMING_BLADE, 0, 0, null, {name: "Booming Blade", source: "TCE"});
		expect(res).toMatchObject({total: 16, damageType: "thunder", maximized: true});
		expect(res.triggeredEffects).toHaveLength(1);
		expect(res.text).toMatch(/Thunderbolt Strike/i);
		expect(consume).toHaveBeenCalledWith("thunder");
	});
});

// --- getKnownWeaponChannelCantrips --------------------------------------------

describe("getKnownWeaponChannelCantrips", () => {
	it("returns only known blade cantrips paired with their data", () => {
		const spells = makeSpellsShell();
		spells._state.getSpells = () => [
			{name: "Booming Blade", source: "TCE", level: 0},
			{name: "Fire Bolt", source: "XPHB", level: 0},
		];
		const known = spells.getKnownWeaponChannelCantrips();
		expect(known).toHaveLength(1);
		expect(known[0].spell.name).toBe("Booming Blade");
	});
});

// --- Cast-options menu builder (Bug #7) ---------------------------------------

describe("_buildCastOptionItems", () => {
	function makeMenuShell (stateOverrides = {}) {
		const spells = makeSpellsShell({
			getSpellSlotsCurrent: () => 0,
			getCastableActiveMetamagics: () => [],
			canCastAsRitual: () => false,
			getAttunedItems: () => [],
			getMatchingVariantComponents: () => [],
			...stateOverrides,
		});
		return spells;
	}

	it("leveled spell: basic cast + upcast entries per available higher slot", () => {
		const spells = makeMenuShell({
			getSpellSlotsCurrent: (lvl) => (lvl === 4 || lvl === 5 ? 2 : 0),
		});
		const items = spells._buildCastOptionItems({id: "s1", name: "Fireball", source: "XPHB", level: 3}, {level: 3});
		const labels = items.map(i => i.label);
		expect(labels[0]).toMatch(/Cast \(level 3\)/);
		expect(labels.some(l => /Upcast to level 4/.test(l))).toBe(true);
		expect(labels.some(l => /Upcast to level 5/.test(l))).toBe(true);
		expect(labels.some(l => /Upcast to level 6/.test(l))).toBe(false);
	});

	it("offers available metamagics + a fallback picker entry", () => {
		const spells = makeMenuShell({
			getCastableActiveMetamagics: () => [
				{key: "quickened", name: "Quickened Spell", cost: 2, isAvailable: true},
				{key: "twinned", name: "Twinned Spell", cost: 3, isAvailable: false},
			],
		});
		const items = spells._buildCastOptionItems({id: "s1", name: "Fireball", source: "XPHB", level: 3}, {level: 3});
		const labels = items.map(i => i.label);
		expect(labels).toContain("🌀 Quickened Spell");
		expect(labels).not.toContain("🌀 Twinned Spell");
		expect(labels).toContain("🌀 Cast with Metamagic…");
	});

	it("shows ritual / components entries only when applicable (Feywild requires a metamagic)", () => {
		const spells = makeMenuShell({
			canCastAsRitual: () => true,
			getAttunedItems: () => [{item: {name: "Feywild Shard"}}],
			getMatchingVariantComponents: () => [{invItem: {}, spellEffect: {}}],
		});
		const items = spells._buildCastOptionItems({id: "s1", name: "Detect Magic", source: "XPHB", level: 1}, {level: 1});
		const labels = items.map(i => i.label);
		expect(labels.some(l => /Cast as Ritual/.test(l))).toBe(true);
		expect(labels.some(l => /Cast with components/.test(l))).toBe(true);
		// No metamagic available → Feywild Shard is NOT offered as a standalone entry.
		expect(labels.some(l => /Feywild Shard/.test(l))).toBe(false);
	});

	it("offers a Feywild Shard discharge variant per metamagic when the shard is attuned", () => {
		const spells = makeMenuShell({
			getAttunedItems: () => [{item: {name: "Feywild Shard"}}],
			getCastableActiveMetamagics: () => [{key: "twinned", name: "Twinned Spell", cost: 2, isAvailable: true}],
		});
		const items = spells._buildCastOptionItems({id: "s1", name: "Fireball", source: "XPHB", level: 3}, {level: 3});
		const labels = items.map(i => i.label);
		expect(labels).toContain("🌀 Twinned Spell");
		expect(labels.some(l => /Twinned Spell \+ ✨ Feywild Shard/.test(l))).toBe(true);
	});

	it("basic cast + upcast + metamagic items resolve slot/ritual up front (no chained prompts)", () => {
		const spells = makeMenuShell({
			getSpellSlotsCurrent: (lvl) => (lvl === 3 || lvl === 4 ? 2 : 0),
			getCastableActiveMetamagics: () => [
				{key: "quickened", name: "Quickened Spell", cost: 2, isAvailable: true},
			],
			canCastAsRitual: () => true,
		});
		const calls = [];
		spells._castSpell = (id, opts) => calls.push(opts);
		const items = spells._buildCastOptionItems({id: "s1", name: "Detect Magic", source: "XPHB", level: 3}, {level: 3});

		const basic = items.find(i => /Cast \(level 3\)/.test(i.label));
		basic.onSelect();
		expect(calls[0].decision).toMatchObject({autoSlot: true, castAsRitual: false, skipComponentPrompt: true});

		const upcast = items.find(i => /Upcast to level 4/.test(i.label));
		upcast.onSelect();
		expect(calls[1].decision).toMatchObject({slotLevel: 4, castAsRitual: false, skipComponentPrompt: true});

		const meta = items.find(i => i.label === "🌀 Quickened Spell");
		meta.onSelect();
		expect(calls[2].decision).toMatchObject({autoSlot: true, castAsRitual: false, skipComponentPrompt: true});
		expect(calls[2].decision.metamagic).toMatchObject({key: "quickened"});
	});

	it("blade cantrip: only offers the standalone secondary roll (weapon button is primary)", () => {
		const spells = makeMenuShell();
		const items = spells._buildCastOptionItems({id: "bb", name: "Booming Blade", source: "TCE", level: 0}, BOOMING_BLADE);
		expect(items).toHaveLength(1);
		expect(items[0].label).toMatch(/Roll/);
		expect(items[0].sublabel).toMatch(/rides your weapon attack/i);
	});
});

// --- Apply-to-self gating (Bug #7 non-blocking affordance) ---------------------

describe("resolveSelfTargetingMode (apply-to-self gating)", () => {
	it("offers the opt-in affordance for a non-self-only beneficial spell", () => {
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: false}, {healing: {dice: "1d8"}})).toBe("offer");
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: false}, {buffs: [{target: "ac", value: 2}]})).toBe("offer");
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: false}, {tempHp: {amount: 5}})).toBe("offer");
	});

	it("auto-applies a self-only spell (no opt-in needed)", () => {
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: true}, {buffs: [{target: "ac", value: 2}]})).toBe("auto");
		// Self-only with no beneficial payload still auto-targets self.
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: true}, {})).toBe("auto");
	});

	it("returns 'none' for damage / enemy-targeted spells with no beneficial payload", () => {
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: false}, {})).toBe("none");
		expect(CharacterSheetSpells.resolveSelfTargetingMode({selfOnly: false}, {damage: {dice: "8d6"}})).toBe("none");
	});
});

// --- Apply-to-self toast replace-don't-stack (Bug #7 note 1) -------------------

describe("_replacePriorApplyToSelfToast (rapid casts replace, don't stack)", () => {
	// Minimal fake toast node: tracks whether its `.toast` ancestor was removed.
	function makeFakeToast () {
		const ancestor = {removed: false, remove () { this.removed = true; }};
		return {ancestor, closest: (sel) => (sel === ".toast" ? ancestor : null)};
	}

	it("removes the prior apply-to-self toast when a new one is shown", () => {
		const spells = Object.create(CharacterSheetSpells.prototype);
		const first = makeFakeToast();
		const second = makeFakeToast();
		spells._replacePriorApplyToSelfToast(first);
		expect(first.ancestor.removed).toBe(false); // nothing prior to remove
		spells._replacePriorApplyToSelfToast(second);
		expect(first.ancestor.removed).toBe(true); // prior removed
		expect(second.ancestor.removed).toBe(false); // current kept
		expect(spells._activeApplyToSelfToastEl).toBe(second);
	});

	it("does not remove the node it is currently tracking (idempotent)", () => {
		const spells = Object.create(CharacterSheetSpells.prototype);
		const only = makeFakeToast();
		spells._replacePriorApplyToSelfToast(only);
		spells._replacePriorApplyToSelfToast(only);
		expect(only.ancestor.removed).toBe(false);
		expect(spells._activeApplyToSelfToastEl).toBe(only);
	});
});
