/**
 * Arcane Archer — "Arcane Archer Lore" prose-choice parsing (round-5 bug #6).
 *
 * The feature is PURE PROSE granting two player CHOICES, not fixed bonuses:
 *   "You choose to gain proficiency in either the {@skill Arcana} or the
 *    {@skill Nature} skill, and you choose to learn either the
 *    {@spell prestidigitation} or the {@spell druidcraft} cantrip."
 *
 * Asserts REAL mechanics:
 *  - FeatureChoiceParser extracts BOTH choices (skill + cantrip) generically.
 *  - addFeature queues pending choices instead of greedily granting everything.
 *  - Identity-based suppression: the greedy proficiency/spell parsers do NOT
 *    auto-grant the choice options (no double-grant, no silent loss).
 *  - Fulfilling a choice grants ONLY the chosen option (one skill, one cantrip
 *    at level 0 — never both, never as a level-1 known spell).
 *  - removeFeature undoes the chosen cantrip and clears pending choices.
 *  - Genericity: "either A or B" without "the", and N-way choices.
 */

import "./setup.js";

let CharacterSheetState;
let FeatureChoiceParser;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	FeatureChoiceParser = globalThis.FeatureChoiceParser;
});

beforeEach(() => {
	state = new CharacterSheetState();
});

function loreFeature () {
	return {
		name: "Arcane Archer Lore",
		source: "XGE",
		className: "Fighter",
		level: 3,
		featureType: "Subclass",
		entries: [
			"You choose to gain proficiency in either the {@skill Arcana} or the {@skill Nature} skill, and you choose to learn either the {@spell prestidigitation} or the {@spell druidcraft} cantrip.",
		],
		description: "You choose to gain proficiency in either the Arcana or the Nature skill, and you choose to learn either the prestidigitation or the druidcraft cantrip.",
	};
}

describe("FeatureChoiceParser.extractChoices", () => {
	it("extracts both the skill-proficiency and the cantrip choice from Lore prose", () => {
		const {skillChoices, cantripChoices} = FeatureChoiceParser.extractChoices(loreFeature());

		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].options.sort()).toEqual(["arcana", "nature"]);
		expect(skillChoices[0].count).toBe(1);

		expect(cantripChoices).toHaveLength(1);
		const names = cantripChoices[0].options.map(o => o.name.toLowerCase()).sort();
		expect(names).toEqual(["druidcraft", "prestidigitation"]);
	});

	it("handles 'either A or B' phrasing without the interspersed 'the'", () => {
		const feature = {
			name: "Generic Lore",
			entries: ["You gain proficiency in either {@skill Stealth} or {@skill Perception}."],
		};
		const {skillChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].options.sort()).toEqual(["perception", "stealth"]);
	});

	it("returns no choice for a plain fixed grant (no 'either')", () => {
		const feature = {
			name: "Fixed Grant",
			entries: ["You gain proficiency in the {@skill Arcana} skill."],
		};
		const {skillChoices, cantripChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(skillChoices).toHaveLength(0);
		expect(cantripChoices).toHaveLength(0);
	});

	it("ignores a single-option clause (needs at least two options to be a choice)", () => {
		const feature = {
			name: "Single",
			entries: ["You learn either {@spell guidance} cantrip."],
		};
		const {cantripChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(cantripChoices).toHaveLength(0);
	});
});

describe("addFeature(Arcane Archer Lore) queues choices instead of granting", () => {
	beforeEach(() => {
		state.addFeature(loreFeature());
	});

	it("queues exactly one skill choice and one cantrip choice", () => {
		const pending = state.getPendingFeatureChoices();
		expect(pending).toHaveLength(2);
		expect(pending.some(c => c.kind === "skill")).toBe(true);
		expect(pending.some(c => c.kind === "cantrip")).toBe(true);
		expect(state.hasPendingFeatureChoices()).toBe(true);
	});

	it("does NOT auto-grant either skill (suppressed — they are a choice)", () => {
		expect(state.getSkillProficiency("arcana")).toBe(0);
		expect(state.getSkillProficiency("nature")).toBe(0);
	});

	it("does NOT auto-grant either cantrip, and never as a level-1 known spell", () => {
		expect(state.getCantripsKnown()).toHaveLength(0);
		const known = state.getSpellsKnown().map(s => s.name.toLowerCase());
		expect(known).not.toContain("prestidigitation");
		expect(known).not.toContain("druidcraft");
	});

	it("dedupes a replayed add (respec/level-up) — no stacked prompts", () => {
		state.addFeature(loreFeature());
		// addFeature dedups the feature itself; even if re-processed, choice signatures dedupe.
		const skillChoices = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(skillChoices).toHaveLength(1);
	});
});

describe("fulfillFeatureChoice grants only the chosen option", () => {
	let skillChoiceId;
	let cantripChoiceId;

	beforeEach(() => {
		state.addFeature(loreFeature());
		const pending = state.getPendingFeatureChoices();
		skillChoiceId = pending.find(c => c.kind === "skill").id;
		cantripChoiceId = pending.find(c => c.kind === "cantrip").id;
	});

	it("grants only the chosen skill (Arcana), not the alternative (Nature)", () => {
		expect(state.fulfillFeatureChoice(skillChoiceId, "arcana")).toBe(true);
		expect(state.getSkillProficiency("arcana")).toBe(1);
		expect(state.getSkillProficiency("nature")).toBe(0);
		// Resolved choice is dequeued.
		expect(state.getPendingFeatureChoices().some(c => c.id === skillChoiceId)).toBe(false);
	});

	it("grants the chosen cantrip at level 0, not as a level-1 spell, and not the alternative", () => {
		const ok = state.fulfillFeatureChoice(cantripChoiceId, {name: "Prestidigitation", source: "PHB"});
		expect(ok).toBe(true);

		const cantrips = state.getCantripsKnown().map(c => c.name.toLowerCase());
		expect(cantrips).toContain("prestidigitation");
		expect(cantrips).not.toContain("druidcraft");

		// Never leaks into the level-1+ known-spell list.
		const known = state.getSpellsKnown().map(s => s.name.toLowerCase());
		expect(known).not.toContain("prestidigitation");
		expect(known).not.toContain("druidcraft");
	});
});

describe("removeFeature undoes the chosen cantrip and clears pending choices", () => {
	it("removes the choice-granted cantrip and any unresolved choices", () => {
		state.addFeature(loreFeature());
		const cantripChoiceId = state.getPendingFeatureChoices().find(c => c.kind === "cantrip").id;
		state.fulfillFeatureChoice(cantripChoiceId, {name: "Prestidigitation", source: "PHB"});
		expect(state.getCantripsKnown().map(c => c.name.toLowerCase())).toContain("prestidigitation");

		state.removeFeature("Arcane Archer Lore", "XGE");

		expect(state.getCantripsKnown().map(c => c.name.toLowerCase())).not.toContain("prestidigitation");
		expect(state.hasPendingFeatureChoices()).toBe(false);
	});
});
