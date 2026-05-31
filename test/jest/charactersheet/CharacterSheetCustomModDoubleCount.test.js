/**
 * CharacterSheet bug 6.4 regression — d20:all custom modifier must surface
 * exactly once on every roll surface, not twice on skill checks.
 *
 * The bug: `_recalculateCustomModifiers` case "d20:all" wrote the value into
 * BOTH `cm.abilityChecks[abl]` AND `cm.skills["_all"]`. `getSkillModWithAbility`
 * then summed both (via `getSkillCustomMod` + `getAbilityCheckCustomMod`),
 * surfacing a +1 d20:all mod as +2 on every skill check display and roll.
 *
 * The fix: drop the `cm.skills["_all"]` write in the d20:all case. The
 * `abilityChecks[abl]` write already covers skill reads because skill checks
 * ARE ability checks (the `getSkillModWithAbility` comment at line ~6251
 * explicitly notes this).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Custom modifier d20:all — no double count (bug 6.4)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 14); // +2 mod
		state.setAbilityBase("dex", 14); // +2 mod
		state.setAbilityBase("int", 14); // +2 mod
		state.setAbilityBase("wis", 14); // +2 mod
		state.addClass({name: "Fighter", source: "PHB", level: 1}); // prof = +2
	});

	it("+1 d20:all surfaces exactly +1 on a skill check", () => {
		const before = state.getSkillModWithAbility("athletics", "str");
		state.addNamedModifier({name: "Bardic Inspiration", type: "d20:all", value: 1, enabled: true});
		const after = state.getSkillModWithAbility("athletics", "str");
		expect(after - before).toBe(1);
	});

	it("+1 d20:all surfaces exactly +1 on a saving throw", () => {
		const before = state.getSaveMod("wis");
		state.addNamedModifier({name: "Bardic Inspiration", type: "d20:all", value: 1, enabled: true});
		const after = state.getSaveMod("wis");
		expect(after - before).toBe(1);
	});

	it("+1 d20:all surfaces exactly +1 on initiative", () => {
		const before = state.getInitiative();
		state.addNamedModifier({name: "Bardic Inspiration", type: "d20:all", value: 1, enabled: true});
		const after = state.getInitiative();
		expect(after - before).toBe(1);
	});

	it("+1 d20:all AND +1 skill:all stack to exactly +2 on a skill check", () => {
		const before = state.getSkillModWithAbility("stealth", "dex");
		state.addNamedModifier({name: "Mass Buff", type: "d20:all", value: 1, enabled: true});
		state.addNamedModifier({name: "Boots of Stealth", type: "skill:all", value: 1, enabled: true});
		const after = state.getSkillModWithAbility("stealth", "dex");
		expect(after - before).toBe(2);
	});

	it("+1 d20:all AND +1 check:str stack to exactly +2 on a STR skill check", () => {
		const before = state.getSkillModWithAbility("athletics", "str");
		state.addNamedModifier({name: "Mass Buff", type: "d20:all", value: 1, enabled: true});
		state.addNamedModifier({name: "Belt of Giants", type: "check:str", value: 1, enabled: true});
		const after = state.getSkillModWithAbility("athletics", "str");
		expect(after - before).toBe(2);
	});

	it("+1 d20:all AND +1 skill:stealth stack to exactly +2 on stealth, +1 on other skills", () => {
		const beforeStealth = state.getSkillModWithAbility("stealth", "dex");
		const beforeAthletics = state.getSkillModWithAbility("athletics", "str");
		state.addNamedModifier({name: "Mass Buff", type: "d20:all", value: 1, enabled: true});
		state.addNamedModifier({name: "Stealthy", type: "skill:stealth", value: 1, enabled: true});
		expect(state.getSkillModWithAbility("stealth", "dex") - beforeStealth).toBe(2);
		expect(state.getSkillModWithAbility("athletics", "str") - beforeAthletics).toBe(1);
	});

	it("regression guard: saves are unchanged in magnitude by the fix", () => {
		// All six saves get exactly +1 per d20:all
		state.addNamedModifier({name: "Bless", type: "d20:all", value: 1, enabled: true});
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];
		for (const abl of abilities) {
			const expected = state.getAbilityMod(abl) + (state.hasSaveProficiency(abl) ? state.getProficiencyBonus() : 0) + 1;
			expect(state.getSaveMod(abl)).toBe(expected);
		}
	});
});
