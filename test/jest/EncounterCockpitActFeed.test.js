import {withEncounterTemplate} from "../../js/encounterworkspace/encounterworkspace-templates.js";
import {getEncounterRollBreakdown} from "../../js/encounterworkspace/encounterworkspace-rollbreakdown.js";
import {getCockpitContributorGetter} from "../../js/encounterworkspace/cockpit/rules.js";
import {
	getCockpitAttackVerdicts,
	getCockpitFeedAmount,
	getCockpitFeedD20Parts,
	getCockpitFeedLogText,
	getCockpitFeedStageText,
	getCockpitStatblockDamage,
	getCockpitStatblockRollQuery,
} from "../../js/encounterworkspace/cockpit/features/act-feed-model.js";
import {getD20Rng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const byId = (state, id) => state.instances.find(it => it.id === id);

describe("Cockpit statblock roll feed — model", () => {
	test("maps statblock d20 links to roll-breakdown queries", () => {
		expect(getCockpitStatblockRollQuery({rollType: "attack", key: "Attack roll", baseBonus: 4}, {attackName: "Scimitar"})).toEqual({kind: "attack", bonus: 4, attackName: "Scimitar"});
		expect(getCockpitStatblockRollQuery({rollType: "save", key: "dex"})).toEqual({kind: "save", ability: "dex"});
		expect(getCockpitStatblockRollQuery({rollType: "ability", key: "str"})).toEqual({kind: "check", ability: "str"});
		expect(getCockpitStatblockRollQuery({rollType: "skill", key: "stealth"})).toEqual({kind: "check", skill: "stealth"});
		expect(getCockpitStatblockRollQuery({rollType: "initiative", key: "dex"})).toEqual({kind: "initiative"});
		expect(getCockpitStatblockRollQuery({rollType: "recharge"})).toBeNull();
	});

	test("reads the damage expression and the type written after the link", () => {
		expect(getCockpitStatblockDamage({type: "dice", toRoll: "1d6 + 2", subType: "damage"}, ") piercing damage.")).toEqual({expr: "1d6+2", damageType: "piercing"});
		expect(getCockpitStatblockDamage({toRoll: "2d6", subType: "damage"}, ") Fire damage")).toEqual({expr: "2d6", damageType: "fire"});
		expect(getCockpitStatblockDamage({toRoll: "4d6", subType: "damage"}, " plus")).toEqual({expr: "4d6", damageType: null});
		// Not damage, or not something we can roll exactly: leave it to the native roller.
		expect(getCockpitStatblockDamage({toRoll: "1d20+5", subType: "d20"}, "")).toBeNull();
		expect(getCockpitStatblockDamage({toRoll: "1d6", subType: "damage"}, "")).toEqual({expr: "1d6", damageType: null});
		expect(getCockpitStatblockDamage({toRoll: "2d6 + #$prompt_number:title=Level$#", subType: "damage"}, "")).toBeNull();
		expect(getCockpitStatblockDamage(null, "")).toBeNull();
	});

	test("½ and ×2 round down and never go negative", () => {
		expect(getCockpitFeedAmount({total: 13, mult: 0.5})).toBe(6);
		expect(getCockpitFeedAmount({total: 13, mult: 2})).toBe(26);
		expect(getCockpitFeedAmount({total: 13, mult: 1})).toBe(13);
		expect(getCockpitFeedAmount({total: -2, mult: 1})).toBe(0);
	});

	test("an Elite creature's statblock attack names the +2 and checks it against each target's AC", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withEncounterTemplate(state, {key: "elite", ids: ["c1"]}).state;
		const getContributors = getCockpitContributorGetter(state, {});
		const query = getCockpitStatblockRollQuery({rollType: "attack", key: "Attack roll", baseBonus: 4}, {attackName: "Scimitar"});
		const roll = getEncounterRollBreakdown({instance: byId(state, "c1"), query, rng: getD20Rng(11), getContributors});
		expect(roll.text).toBe("17 (11 +2 +2 +2)");
		expect(getCockpitFeedD20Parts(roll)).toEqual([
			{text: "+2", label: "DEX mod", source: "statblock"},
			{text: "+2", label: "Proficiency", source: "statblock"},
			{text: "+2", label: "Elite", source: "template:elite"},
		]);
		expect(getCockpitAttackVerdicts(roll, [{id: "c2", label: "Goblin 2", ac: 15}, {id: "x", label: "Knight", ac: 18}, {id: "y", label: "?", ac: null}]))
			.toEqual([{id: "c2", label: "Goblin 2", ac: 15, isHit: true}, {id: "x", label: "Knight", ac: 18, isHit: false}]);
		expect(getCockpitAttackVerdicts({...roll, total: 3, crit: true, fumble: false}, [{id: "x", ac: 18}])[0].isHit).toBe(true);
		expect(getCockpitAttackVerdicts({...roll, total: 30, crit: false, fumble: true}, [{id: "x", ac: 18}])[0].isHit).toBe(false);
	});

	test("stages the multiplied amount in console grammar, addressed to the selection", () => {
		const card = {kind: "damage", total: 9, mult: 0.5, damageType: "fire", expr: "2d6", rolls: [4, 5], who: "Hell Hound", label: "Fire Breath"};
		expect(getCockpitFeedStageText(card, ["@goblin1", "@goblin2"])).toBe("@goblin1,goblin2 4 fire");
		expect(getCockpitFeedStageText({...card, damageType: null, mult: 1})).toBe("9");
		expect(getCockpitFeedLogText(card)).toBe("Hell Hound · Fire Breath: 9 fire damage (2d6 → 4, 5)");
		expect(getCockpitFeedLogText({kind: "attack", who: "Goblin 1", label: "Scimitar", roll: {text: "17 (11 +6)", mode: "advantage"}})).toBe("Goblin 1 · Scimitar: 17 (11 +6) (advantage)");
	});
});
