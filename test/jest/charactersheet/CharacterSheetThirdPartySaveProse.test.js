/**
 * Third-party save prose — a feature that buffs SOMEBODY ELSE must not buff the
 * character whose sheet this is (CS-BUG-092).
 *
 * `FeatureModifierParser` turns prose like "advantage on saving throws against being
 * charmed" into an opt-in conditional modifier on the character. The pattern is
 * subject-blind, so a feature that grants the benefit to a *target* — "you can choose
 * yourself or one creature within 30 feet of you. **The target has** advantage on saving
 * throws against being charmed or frightened" (Granny's Gifts, Wicked Witch Sorcerer) —
 * parsed as a permanent self-buff.
 *
 * Two distinct player-visible consequences, both measured on the shipping code before
 * the fix:
 *   1. A witch who has warded NOBODY, and a witch who warded an ALLY, were both offered
 *      the advantage on their own saves. The ward's only cost is giving it away; that
 *      cost was refunded silently.
 *   2. A witch who warded HERSELF got each condition offered TWICE in the per-roll
 *      conditional picker — once from the ward's real named modifier, once from the
 *      prose.
 *
 * The tests below pin the reading surface (`aggregateModifiers(...).conditionalsAvailable`
 * — what the roll handlers actually show the player), plus the generic parser behaviour
 * with self-buff negative controls so the guard cannot be widened into a regression.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

/** The Ar8 Granny's Gifts prose, verbatim, as the parsers see it. */
const GRANNYS_GIFTS_PROSE = "You learn additional spells when you reach certain levels in this class. These spells count as sorcerer spells for you, but they don't count against the number of sorcerer spells you know. Additionally, whenever you finish a long rest, you can choose yourself or one creature you can see within 30 feet of you. The target has advantage on saving throws against being charmed or frightened until the end of your next long rest or until you die.";

function makeWitch () {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state._data.classes = [{
		name: "Sorcerer",
		source: "TGTT",
		level: 20,
		subclass: {name: "Wicked Witch Sorcerous Origin", shortName: "Wicked Witch", source: "TGTT-AR"},
	}];
	state.setHp(60, 60);
	state.addFeature({level: 3, source: "Ar8", name: "Granny's Gifts", description: GRANNYS_GIFTS_PROSE});
	state.applyClassFeatureEffects();
	return state;
}

/**
 * What the per-roll conditional picker would offer on a broad save roll.
 *
 * Deliberately queried with a BROAD type (`save:wis`) rather than the exact sub-type:
 * `getModifiersForType("save:charmed")` hits the `baseType === type` branch, which marks
 * the modifier as matched and skips the synthesized-conditional block entirely, so it
 * would read as unconditionally applied. Broad types are what the roll handlers use.
 */
const offered = state => (state.aggregateModifiers("save:wis").conditionalsAvailable || [])
	.map(c => String(c.conditional || c.note || "").toLowerCase());

describe("Granny's Gifts — the ward buffs its TARGET, never the witch by default", () => {
	it("a witch who has warded nobody is offered NO charm/fright conditional", () => {
		expect(offered(makeWitch())).toHaveLength(0);
	});

	it("warding an ALLY leaves the witch with nothing — the whole point of giving it away", () => {
		const state = makeWitch();
		expect(state.setGrannysWardTarget("Bramble", {distance: 10}).ok).toBe(true);
		expect(offered(state)).toHaveLength(0);
	});

	it("warding YOURSELF offers each condition exactly once, not twice", () => {
		const state = makeWitch();
		expect(state.setGrannysWardTarget("self").ok).toBe(true);
		const rows = offered(state);
		expect(rows.filter(r => r.includes("charmed"))).toHaveLength(1);
		expect(rows.filter(r => r.includes("frightened"))).toHaveLength(1);
	});

	it("the self-ward stays OPT-IN — it is never auto-applied to a save", () => {
		const state = makeWitch();
		state.setGrannysWardTarget("self");
		expect(state.aggregateModifiers("save:wis").advantage).toBeFalsy();
	});
});

describe("FeatureModifierParser.isThirdPartySaveSubject — the generic guard", () => {
	const at = (text, phrase = "advantage on saving throws") => text.indexOf(phrase);
	const judge = text => FeatureModifierParser.isThirdPartySaveSubject(text, at(text));

	// ---- suppressed: the sentence is about somebody else ----
	it.each([
		["The target has advantage on saving throws against being charmed."],
		["The creature has advantage on saving throws against being frightened."],
		["This creature has advantage on saving throws against being poisoned."],
		["For the duration, the target has advantage on saving throws against being poisoned."],
		["One ally you can see has advantage on saving throws against being stunned."],
		["One creature you can see within 30 feet of you has advantage on saving throws against being charmed."],
	])("treats %j as a third-party buff", text => {
		expect(judge(text)).toBe(true);
	});

	// ---- kept: the sentence is about the character ----
	it.each([
		["You have advantage on saving throws against being charmed."],
		["You and your allies within 10 feet have advantage on saving throws against being frightened."],
		["While raging, you have advantage on saving throws against being poisoned."],
		["You or an ally within 30 feet of you has advantage on saving throws against being charmed."],
		["Your companion and you have advantage on saving throws against being stunned."],
		// No "you" anywhere AND no third-party subject — these exist only to exercise the
		// subject regex on its own. Without them, every negative control short-circuits on
		// the `you` test and a guard that skipped the subject check entirely stays green.
		["Dwarves have advantage on saving throws against being poisoned."],
		["Elves have advantage on saving throws against being charmed."],
		["While transformed, the wearer gains advantage on saving throws against being frightened."],
	])("leaves %j alone", text => {
		expect(judge(text)).toBe(false);
	});

	it("judges each sentence separately — a self-buff followed by a target buff keeps the self-buff", () => {
		const text = "You have advantage on saving throws against being charmed. In addition, the target has advantage on saving throws against being frightened.";
		expect(FeatureModifierParser.isThirdPartySaveSubject(text, text.indexOf("advantage"))).toBe(false);
		expect(FeatureModifierParser.isThirdPartySaveSubject(text, text.lastIndexOf("advantage on saving throws"))).toBe(true);
	});

	it("a self-buff feature still reaches the sheet unchanged (end-to-end negative control)", () => {
		const state = new CharacterSheetState();
		state._data.classes = [{name: "Barbarian", source: "PHB", level: 3}];
		state.setHp(30, 30);
		state.addFeature({
			level: 3,
			source: "PHB",
			name: "Iron Nerve",
			description: "You have advantage on saving throws against being frightened.",
		});
		state.applyClassFeatureEffects();
		expect(offered(state).some(r => r.includes("frightened"))).toBe(true);
	});
});
