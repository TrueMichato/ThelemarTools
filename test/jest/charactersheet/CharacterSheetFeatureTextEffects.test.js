/**
 * Regression tests for CS-BUG-032 — feature text that describes a real mechanical
 * effect but produced none on the sheet.
 *
 * These assert the PLAYER-FACING surface (parsed effects, effect/roll-type matching,
 * state-type detection), not intermediate calculations: every defect below produced
 * a perfectly reasonable-looking internal value that nothing acted on, or acted on
 * in the wrong direction.
 */

import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const parse = (text) => CharacterSheetState.parseEffectsFromDescription(text);
const has = (effects, type, target) => effects.some(e => e.type === type && e.target === target);

describe("parseEffectsFromDescription — 'disadvantage' must not read as 'advantage'", () => {
	// "advantage on attack rolls" is a SUBSTRING of "disadvantage on attack rolls",
	// so an unguarded pattern turned an enemy debuff into a player buff.
	it("does not grant the character advantage from an enemy-facing disadvantage clause", () => {
		const effects = parse(
			"While charmed, the creature's speed is reduced to 0 and it has disadvantage on attack rolls.",
		);
		expect(has(effects, "advantage", "attack")).toBe(false);
	});

	it("does not grant advantage on ability checks from a disadvantage clause", () => {
		expect(has(parse("The target has disadvantage on ability checks."), "advantage", "check")).toBe(false);
	});

	it("does not grant advantage on saving throws from a disadvantage clause", () => {
		expect(has(parse("The target has disadvantage on saving throws."), "advantage", "save")).toBe(false);
	});

	it("still grants advantage from a genuine advantage clause", () => {
		expect(has(parse("You have advantage on attack rolls against the target."), "advantage", "attack")).toBe(true);
	});

	it("keeps the positive half of a mixed clause and drops the negative half", () => {
		const effects = parse(
			"You have advantage on Dexterity saving throws and creatures have disadvantage on attack rolls against you.",
		);
		expect(has(effects, "advantage", "save:dex")).toBe(true);
		expect(has(effects, "advantage", "attack")).toBe(false);
	});
});

describe("parseEffectsFromDescription — untyped ability-check advantage", () => {
	it("parses 'advantage on ability checks' as a category-wide check advantage", () => {
		expect(has(parse("You gain advantage on ability checks until the end of your next turn."), "advantage", "check")).toBe(true);
	});

	it("parses attack advantage when it trails a coordinated list", () => {
		// "advantage on ability checks and attack rolls" — "attack rolls" does not
		// immediately follow "advantage on", so the plain pattern missed it.
		const effects = parse(
			"You can use your reaction to gain advantage on ability checks and attack rolls until the end of your next turn.",
		);
		expect(has(effects, "advantage", "attack")).toBe(true);
		expect(has(effects, "advantage", "check")).toBe(true);
	});
});

describe("parseEffectsFromDescription — AC bonus equal to the proficiency bonus", () => {
	it("parses 'a bonus to AC equal to your proficiency bonus'", () => {
		const effects = parse(
			"You can use this act as a reaction to grant yourself a bonus to AC equal to your proficiency bonus until the start of your next turn.",
		);
		const ac = effects.find(e => e.type === "bonus" && e.target === "ac");
		expect(ac).toBeTruthy();
		expect(ac.useProficiency).toBe(true);
	});

	it("parses the 'add your proficiency bonus to your AC' phrasing", () => {
		const ac = parse("You add your proficiency bonus to your Armor Class.").find(e => e.type === "bonus" && e.target === "ac");
		expect(ac?.useProficiency).toBe(true);
	});

	it("leaves a fixed numeric AC bonus alone", () => {
		const ac = parse("You gain a 2 bonus to your AC.").find(e => e.type === "bonus" && e.target === "ac");
		expect(ac?.value).toBe(2);
		expect(ac?.useProficiency).toBeUndefined();
	});
});

describe("_effectMatchesType — bare category targets", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("applies a bare 'check' target to a specific ability check", () => {
		expect(state._effectMatchesType("check", "check:str")).toBe(true);
	});

	it("applies a bare 'check' target to a skill check", () => {
		expect(state._effectMatchesType("check", "skill:athletics")).toBe(true);
	});

	it("applies a bare 'save' target to a specific saving throw", () => {
		// The concentration check asks for "save:con"; a state granting "advantage on
		// saving throws" was silently missed by it.
		expect(state._effectMatchesType("save", "save:con")).toBe(true);
	});

	it("applies a bare 'attack' target to a scoped attack roll", () => {
		expect(state._effectMatchesType("attack", "attack:melee")).toBe(true);
	});

	it("does not leak across categories", () => {
		expect(state._effectMatchesType("save", "check:str")).toBe(false);
		expect(state._effectMatchesType("check", "save:dex")).toBe(false);
	});

	it("still honours an exact match and a specific subtype", () => {
		expect(state._effectMatchesType("check:str", "check:str")).toBe(true);
		expect(state._effectMatchesType("check:str", "check:dex")).toBe(false);
	});
});

describe("Rage detection must not fire on words that merely contain 'rage'", () => {
	// The XPHB Bard's "Repertoire" flavour sidebar bleeds into the rendered
	// description of Jack of All Trades, and the word "tragedies" contains "rage",
	// so `you can.*rage` classified a passive Bard feature as Barbarian Rage —
	// handing a Bard rage resistances and Strength advantage.
	const ragePatterns = () => CharacterSheetState.ACTIVE_STATE_TYPES.rage.detectPatterns;

	it("does not match 'tragedies'", () => {
		const text = "you can add half your proficiency bonus to any ability check. "
			+ "does your bard recite dramatic monologues from classic tragedies?";
		expect(ragePatterns().some(p => new RegExp(p, "i").test(text))).toBe(false);
	});

	it("does not match other words containing 'rage'", () => {
		for (const text of [
			"you can take the average of the roll",
			"you can inspire courage in your allies",
			"you can store the item in your storage",
		]) {
			expect(ragePatterns().some(p => new RegExp(p, "i").test(text))).toBe(false);
		}
	});

	it("still matches genuine Rage text", () => {
		expect(ragePatterns().some(p => new RegExp(p, "i").test("rage"))).toBe(true);
		expect(ragePatterns().some(p => new RegExp(p, "i").test("you can enter a rage as a bonus action"))).toBe(true);
	});
});

describe("resolveFeatureRef — optionalfeature refs", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setClassFeatureCatalog([], [], [
			{name: "Jester's Agility", source: "TGTT", entries: ["grant yourself a bonus to AC equal to your proficiency bonus"]},
			{name: "Pantomime", source: "TGTT", entries: ["pantomime text"]},
		]);
	});

	it("resolves an option declared as refOptionalfeature to its real rules text", () => {
		// Before: fell through to the class-feature search, resolved to null, and was
		// added as an empty stub — the feature showed on the sheet with no text and
		// therefore no parsed effects.
		const resolved = state.resolveFeatureRef({refType: "optionalfeature", name: "Jester's Agility", source: "TGTT"});
		expect(resolved).toBeTruthy();
		expect(resolved.entries.length).toBeGreaterThan(0);
	});

	it("falls back to a name-only match when the source differs", () => {
		expect(state.resolveFeatureRef({refType: "optionalfeature", name: "Pantomime", source: "PHB"})).toBeTruthy();
	});

	it("returns null for an unknown optional feature", () => {
		expect(state.resolveFeatureRef({refType: "optionalfeature", name: "Nonexistent", source: "TGTT"})).toBeNull();
	});

	it("does not disturb classFeature resolution", () => {
		state.setClassFeatureCatalog([{name: "Second Wind", className: "Fighter", source: "PHB", level: 1}], [], []);
		expect(state.resolveFeatureRef({name: "Second Wind", className: "Fighter"})).toBeTruthy();
	});
});

describe("_buildAbilityActivationInfo — timed limited-use buffs", () => {
	it("carries the parsed duration so a timed self-buff is not stored as Instant", () => {
		const raw = "You can use this act as a reaction to grant yourself a bonus to AC "
			+ "equal to your proficiency bonus until the start of your next turn.";
		const info = CharacterSheetState._buildAbilityActivationInfo(
			{name: "Jester's Agility"}, raw, raw.toLowerCase(),
		);
		expect(info.duration).toBeTruthy();
		expect(info.activationAction).toBe("reaction");
		const ac = (info.effects || []).find(e => e.type === "bonus" && e.target === "ac");
		expect(ac?.useProficiency).toBe(true);
	});
});
