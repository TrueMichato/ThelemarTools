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

import {readFileSync} from "fs";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";

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

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ALL_SKILLS = [
	"athletics", "acrobatics", "sleight of hand", "stealth", "arcana", "history",
	"investigation", "nature", "religion", "animal handling", "insight", "medicine",
	"perception", "survival", "deception", "intimidation", "performance", "persuasion",
];
const ROLL_QUERIES = [
	"attack", "attack:melee", "attack:ranged", "attack:spell", "damage", "damage:melee",
	"damage:ranged", "damage:cantrip", "initiative", "deathSave", "concentration", "d20:all",
	"ac", "speed", "healing", "hitDice", "passive:perception", "passive:investigation",
	"spellcasting", "unarmed", "ranged", "resistance", "reroll", "critDie", "spell",
	...ABILITIES.map(a => `save:${a}`), ...ABILITIES.map(a => `check:${a}`),
	...ALL_SKILLS.map(s => `skill:${s}`),
];

const isRollReachable = type => {
	const state = withModifier(type, {conditional: null});
	return ROLL_QUERIES.some(query => state.getModifiersForType(query).some(m => m.name === "PROBE"));
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

/**
 * The consumption manifest.
 *
 * `EFFECT_HANDLING` in charactersheet-materials.js exists because a material
 * effect that nothing consumes is invisible rather than loud. Feature modifiers
 * had no equivalent, so a registered `modType` with no consumer looked exactly
 * like one with a consumer — which is how Keen Senses and Synchronized Stealth
 * stayed dead behind a passing test.
 *
 * Every registered modType is classified here:
 *
 *   roll      - reachable from at least one roll query via getModifiersForType.
 *   named     - has a dedicated consumer that reads it by name (carry capacity,
 *               armor stealth penalty, medium-armor Dex cap, ...).
 *   reference - deliberately NOT delivered by the sheet. The feature text is
 *               shown to the player and the DM adjudicates it. Ignoring cover,
 *               ritual casting and charge riders depend on positional or
 *               narrative state the sheet does not model.
 *
 * "reference" is a decision, not an absence. Listing a type here is how that
 * decision gets recorded; a type that is merely forgotten fails the
 * completeness test instead of sitting silently in the registry.
 */
const MODIFIER_CONSUMERS = {
	"ac": "roll",
	"ac:ally:reaction": "reference",
	"ac:mediumArmorMaxDex": "named",
	"armor:medium:noStealthDisadvantage": "named",
	"attack:advantage:grappled": "reference",
	"attack:heavy": "reference",
	"attack:ranged": "roll",
	"carryCapacity": "named",
	"check:advantage:deception:impersonation": "roll",
	"check:advantage:forcedmovement": "roll",
	"check:advantage:int:lore": "roll",
	"check:advantage:perception": "roll",
	"check:advantage:performance:impersonation": "roll",
	"check:advantage:stealth": "roll",
	"check:cha:advantage": "roll",
	"check:wis:advantage": "roll",
	"concentration": "roll",
	"critDie:melee:extra": "reference",
	"damage:bonus:surprised": "reference",
	"damage:bonus:vs-larger": "reference",
	"damage:charge": "reference",
	"damage:heavy": "reference",
	"damage:heavy:bonusOnCritOrKill": "reference",
	"damage:melee:oneHanded": "roll",
	"damage:offhand:addAbility": "reference",
	"damage:ranged": "roll",
	"damage:reroll:interdicted:1or2": "reference",
	"damage:reroll:melee": "reference",
	"damage:reroll:twoHanded:1or2": "reference",
	"deathSave:advantage": "roll",
	"healing:healerKit": "reference",
	"hitDice:longRestRecovery": "reference",
	"hitDice:minimumRoll": "reference",
	"initiative": "roll",
	"initiative:advantage": "roll",
	"passive:investigation": "roll",
	"passive:perception": "roll",
	"ranged:ignoreCover": "reference",
	"ranged:noDisdvantageInMelee": "named",
	"ranged:noLongRangeDisadvantage": "reference",
	"reach:melee:bonus": "named",
	"reroll:1:ability": "reference",
	"reroll:1:attack": "named",
	"reroll:1:save": "reference",
	"resistance:all-except-psychic": "reference",
	"resistance:chosen": "reference",
	"save:advantage:cha:magic": "roll",
	"save:advantage:charmed": "roll",
	"save:advantage:disease": "roll",
	"save:advantage:forcedmovement": "roll",
	"save:advantage:frightened": "roll",
	"save:advantage:int:magic": "roll",
	"save:advantage:magic": "roll",
	"save:advantage:poisoned": "roll",
	"save:advantage:spell:adjacent": "roll",
	"save:advantage:wis": "roll",
	"save:advantage:wis:magic": "roll",
	"save:all": "roll",
	"save:cha:advantage": "roll",
	"save:dex:advantage": "roll",
	"save:dex:shield": "roll",
	"save:int:advantage": "roll",
	"save:wis:advantage": "roll",
	"skill:advantage:history:psychometry": "roll",
	"skill:advantage:perception:senses": "roll",
	"skill:advantage:survival:tracking": "roll",
	"skill:animal handling:advantage": "roll",
	"skill:athletics": "roll",
	"skill:athletics:advantage": "roll",
	"skill:perception": "roll",
	"spell:ignoreCover": "reference",
	"spell:rangeDouble": "reference",
	"spellcasting:ritual": "reference",
	"unarmed:damage": "reference",
};

describe("every registered modType declares how it is consumed", () => {
	const REGISTERED = (() => {
		const path = resolve(dirname(fileURLToPath(import.meta.url)), "../../../js/charactersheet/charactersheet-state.js");
		// Skip comment lines: the JSDoc for the modifier shape carries a
		// `modType: "ac|attack|damage|..."` placeholder that is documentation,
		// not a registration, and an extractor that cannot tell them apart
		// reports a type that does not exist.
		const body = readFileSync(path, "utf8").split("\n").filter(l => !/^\s*(\*|\/\/)/.test(l)).join("\n");
		return [...new Set([...body.matchAll(/modType:\s*"([^"]+)"/g)].map(m => m[1]))].sort();
	})();

	it("extracts a plausible number of registrations (the walk is not vacuous)", () => {
		expect(REGISTERED.length).toBeGreaterThan(60);
		expect(REGISTERED).not.toContain("ac|attack|damage|...");
	});

	it("classifies every registered modType", () => {
		const undeclared = REGISTERED.filter(t => !MODIFIER_CONSUMERS[t]);
		expect(undeclared).toEqual([]);
	});

	it("declares nothing that is no longer registered", () => {
		const stale = Object.keys(MODIFIER_CONSUMERS).filter(t => !REGISTERED.includes(t));
		expect(stale).toEqual([]);
	});

	it("every type declared reachable by roll actually is", () => {
		const broken = Object.entries(MODIFIER_CONSUMERS)
			.filter(([, consumer]) => consumer === "roll")
			.filter(([type]) => !isRollReachable(type))
			.map(([type]) => type);

		expect(broken).toEqual([]);
	});

	// The mirror of the assertion above, and the one that keeps the manifest
	// honest. Without it a type could be downgraded to "reference" to silence a
	// failure, which is how a bug becomes a documented feature.
	it("every type declared reference-only is genuinely not delivered", () => {
		const delivered = Object.entries(MODIFIER_CONSUMERS)
			.filter(([, consumer]) => consumer === "reference")
			.filter(([type]) => isRollReachable(type))
			.map(([type]) => type);

		// If this fails, the sheet started delivering something the manifest
		// says it does not. Reclassify it as "roll" rather than deleting the case.
		expect(delivered).toEqual([]);
	});

	it("each classification is actually used (no bucket is empty)", () => {
		const counts = Object.values(MODIFIER_CONSUMERS).reduce((acc, c) => ({...acc, [c]: (acc[c] || 0) + 1}), {});
		expect(counts.roll).toBeGreaterThan(0);
		expect(counts.named).toBeGreaterThan(0);
		expect(counts.reference).toBeGreaterThan(0);
		expect(Object.keys(counts).sort()).toEqual(["named", "reference", "roll"]);
	});
});
