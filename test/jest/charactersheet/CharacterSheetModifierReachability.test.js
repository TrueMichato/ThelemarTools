/**
 * Modifier reachability.
 *
 * A modifier is registered with one string (`modType`) and read with another (the
 * roll type a caller passes to `getModifiersForType`). Nothing forced those two
 * vocabularies to meet, so a modifier could be authored, commented, rendered in a
 * feature list and covered by a passing test while being unreachable from every
 * roll in the sheet.
 *
 * That is exactly what happened to Keen Senses ("check:advantage:perception") and
 * Synchronized Stealth ("check:advantage:stealth"). Two locally-correct decisions
 * composed into a silent hole: the ability-match branch compares a sub-type against
 * "wis"/"dex", and `_isConditionalSaveSubtype` deliberately excludes standard skill
 * names because a skill is a selector rather than a condition. Neither is wrong;
 * together they left the skill-selected modifiers with no path at all.
 *
 * These tests assert reachability PER TYPE rather than per category. A guard keyed
 * on a category cannot see a hole inside it — "check:*" had a home, while
 * "check:advantage:perception" reached it through nothing.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const makeState = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Ranger", source: "PHB", level: 14});
	return state;
};

const withModifier = (type, {conditional = "test condition"} = {}) => {
	const state = makeState();
	state._data.namedModifiers.push({
		name: "PROBE", type, value: 1, enabled: true, conditional, sourceType: "class",
	});
	return state;
};

const offeredNames = (state, query) => {
	const agg = state.aggregateModifiers(query);
	return [...(agg.conditionalsAvailable || []), ...(agg.sources || [])]
		.map(m => m.name || m.source || "");
};

describe("skill-selected modifiers reach the roll that should read them", () => {
	// Anti-vacuity control. Every assertion below is of the form "the probe was
	// found"; if the harness could not surface ANY modifier, they would all be
	// meaningless. A condition-sub-typed save has always worked, so it pins that
	// the measuring instrument itself is live.
	it("control: a condition sub-typed save modifier is surfaced (harness is live)", () => {
		const state = withModifier("save:advantage:paralyzed");
		expect(state.getModifiersForType("save:con").some(m => m.name === "PROBE")).toBe(true);
	});

	it.each([
		["perception", "skill:perception"],
		["stealth", "skill:stealth"],
		["athletics", "skill:athletics"],
		["animal handling", "skill:animal handling"],
	])("a check:<%s> modifier is reachable from %s", (skill, query) => {
		const state = withModifier(`check:advantage:${skill}`);
		expect(state.getModifiersForType(query).some(m => m.name === "PROBE")).toBe(true);
	});

	it("is offered as an opt-in conditional, never applied automatically", () => {
		const state = withModifier("check:advantage:perception");
		const agg = state.aggregateModifiers("skill:perception");

		expect((agg.conditionalsAvailable || []).some(m => m.name === "PROBE")).toBe(true);
		expect(agg.advantage).toBe(false);
	});

	it("a skill-selected modifier without a conditional still resolves to its skill", () => {
		const state = withModifier("check:perception", {conditional: null});
		expect(state.getModifiersForType("skill:perception").some(m => m.name === "PROBE")).toBe(true);
	});

	it("does not leak onto sibling skills, plain checks, saves or attacks", () => {
		const state = withModifier("check:advantage:perception");

		["skill:stealth", "skill:survival", "check:wis", "save:wis", "attack"].forEach(query => {
			expect(state.getModifiersForType(query).some(m => m.name === "PROBE")).toBe(false);
		});
	});

	it("still routes an ability-selected check modifier to every skill of that ability", () => {
		const state = withModifier("check:wis", {conditional: null});

		expect(state.getModifiersForType("skill:perception").some(m => m.name === "PROBE")).toBe(true);
		expect(state.getModifiersForType("skill:survival").some(m => m.name === "PROBE")).toBe(true);
		expect(state.getModifiersForType("skill:athletics").some(m => m.name === "PROBE")).toBe(false);
	});
});

describe("the skill-key normaliser is the single spelling rule", () => {
	it.each([
		["Animal Handling", "animalhandling"],
		["animal handling", "animalhandling"],
		["animalhandling", "animalhandling"],
		["Sleight-of-Hand", "sleightofhand"],
	])("normalises %s", (input, expected) => {
		expect(CharacterSheetState._normalizeSkillKey(input)).toBe(expected);
	});

	// `_isConditionalSaveSubtype` and the skill-match branch both decide what
	// counts as "a skill". If they disagree, a two-word skill is a condition to
	// one and a selector to the other. Routing both through the normaliser is what
	// keeps them from drifting, so pin the agreement rather than the implementation.
	it.each(["perception", "Animal Handling", "animal handling", "Sleight-of-Hand"])(
		"treats %s as a skill selector, not a condition",
		skill => {
			expect(CharacterSheetState._isConditionalSaveSubtype(skill)).toBe(false);
		},
	);

	it("still treats a genuine condition as a condition", () => {
		["frightened", "poisoned", "disease", "magic"].forEach(condition => {
			expect(CharacterSheetState._isConditionalSaveSubtype(condition)).toBe(true);
		});
	});
});

describe("every registered skill-selected modType has a roll that can read it", () => {
	// The generalising guard. Rather than naming today's two features, walk the
	// registry: any `check:<standard skill>` modType that no `skill:<skill>` query
	// can surface fails here, the moment it is authored.
	const SKILLS = [
		"athletics", "acrobatics", "sleight of hand", "stealth", "arcana", "history",
		"investigation", "nature", "religion", "animal handling", "insight", "medicine",
		"perception", "survival", "deception", "intimidation", "performance", "persuasion",
	];

	it.each(SKILLS)("check:advantage:%s is reachable", skill => {
		const state = withModifier(`check:advantage:${skill}`);
		const query = `skill:${skill}`;

		expect(state.getModifiersForType(query).some(m => m.name === "PROBE")).toBe(true);
		expect(offeredNames(state, query)).toContain("PROBE");
	});

	it("the skill list is non-empty (the walk above cannot pass vacuously)", () => {
		expect(SKILLS.length).toBeGreaterThan(10);
	});
});
