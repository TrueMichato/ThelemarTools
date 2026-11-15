import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {rollEncounterChecks, rollEncounterSaves} from "../../js/encounterworkspace/encounterworkspace-massroll.js";
import {getCockpitContributorGetter} from "../../js/encounterworkspace/cockpit/rules.js";
import {withEncounterBattlefieldEntry} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {
	getCockpitAnsweredRoll,
	getCockpitOutcomeSteps,
	getCockpitOutcomeText,
	getCockpitRollModeFromEvent,
	getCockpitRollQuery,
	getCockpitRollQueryLabel,
	getCockpitRollQuestions,
	getCockpitRollRequest,
	getCockpitSkillMatches,
	getCockpitTrayCounts,
	getCockpitTrayRows,
	getCockpitEmptyRollForm,
	getCockpitWhoRolls,
} from "../../js/encounterworkspace/cockpit/features/act-roll-model.js";
import {applyEncounterEffect, getEncounterEffectPreset, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getD20Rng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

describe("Encounter cockpit Act — roll tab and tray", () => {
	test("Shift rolls with advantage and Ctrl/⌘ with disadvantage; otherwise the chosen mode", () => {
		expect(getCockpitRollModeFromEvent({shiftKey: true})).toBe("advantage");
		expect(getCockpitRollModeFromEvent({ctrlKey: true})).toBe("disadvantage");
		expect(getCockpitRollModeFromEvent({metaKey: true})).toBe("disadvantage");
		expect(getCockpitRollModeFromEvent({}, "disadvantage")).toBe("disadvantage");
		expect(getCockpitRollModeFromEvent(null)).toBe("normal");
	});

	test("the form validates into a save / check / skill request with an optional outcome", () => {
		const base = getCockpitEmptyRollForm();
		expect(getCockpitRollRequest({...base, dc: "14"})).toMatchObject({ok: true, title: "Dex save DC 14", request: {kind: "save", ability: "dex", dc: 14}, outcome: null});
		expect(getCockpitRollRequest({...base, kind: "skill", skill: "stealth", dc: ""})).toMatchObject({ok: true, title: "Stealth (Dex)", request: {kind: "check", skill: "stealth", ability: "dex", dc: null}});
		expect(getCockpitRollRequest({...base, kind: "check", ability: "str", dc: "12"}).title).toBe("Str check DC 12");
		expect(getCockpitRollRequest({...base, dc: "x"})).toMatchObject({ok: false, field: "dc"});
		expect(getCockpitRollRequest({...base, damage: "8d6"})).toMatchObject({ok: false, field: "dc"});
		expect(getCockpitRollRequest({...base, dc: "14", damage: "8 dragons"})).toMatchObject({ok: false, field: "damage"});
		const fireball = getCockpitRollRequest({...base, dc: "14", damage: "8d6", damageType: "fire", isHalf: true, condition: "prone", rounds: "2"});
		expect(fireball.outcome).toEqual({damage: {expr: "8d6", amount: null}, damageType: "fire", halfOnSuccess: true, condition: "prone", rounds: 2});
		expect(getCockpitOutcomeText(fireball.outcome)).toBe("8d6 fire (half on a pass) · Prone on a fail (2 rounds)");
		expect(getCockpitRollQueryLabel({kind: "check", skill: "sleight of hand", ability: "dex"})).toBe("Sleight Of Hand (Dex)");
	});

	test("tray rows keep the higher die with advantage, strike the other, and carry contributor sources", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withEncounterDraft(state, draft => { applyEncounterEffect(draft, {targetIds: ["c1"], def: getEncounterEffectPreset(state, "bless")}); }).state;
		const rolled = rollEncounterSaves({
			state,
			ids: ["c1", "c2"],
			ability: "dex",
			dc: 14,
			forcedMode: "advantage",
			rng: getD20Rng(5, 15, 1, 9, 12, 4),
			getContributors: getCockpitContributorGetter(state, {}),
		});
		const rows = getCockpitTrayRows(rolled, {sort: "order", orderIds: ["c2", "c1"]});
		expect(rows.map(it => it.id)).toEqual(["c2", "c1"]);
		const c1 = rows.find(it => it.id === "c1");
		expect(c1.dice.map(it => [it.value, it.isKept])).toEqual([[5, false], [15, true]]);
		expect(c1.lines[0].label).toBe("d20 (advantage)");
		const bless = c1.lines.find(it => it.label === "Bless");
		expect(bless.value).toMatch(/^1d4→\d$/);
		expect(bless.source).toBeTruthy();
		expect(c1.verdict).toBe("pass");
		expect(getCockpitTrayRows(rolled, {sort: "total"})[0].total).toBeGreaterThanOrEqual(getCockpitTrayRows(rolled, {sort: "total"})[1].total);
		expect(getCockpitTrayCounts(rolled)).toMatchObject({total: 2});
	});

	test("checks without a DC have no verdict", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const rolled = rollEncounterChecks({state, ids: ["c1"], skill: "stealth", rng: getD20Rng(10)});
		const [row] = getCockpitTrayRows(rolled);
		expect(row).toMatchObject({verdict: null, natural: 10, total: 16});
		expect(getCockpitTrayCounts(rolled)).toEqual({total: 1, passed: 0, failed: 0, skipped: 0});
	});

	test("outcome steps: full damage + condition on a fail, half on a pass, nothing for a minion on a pass", async () => {
		let state = await pGetCockpitState([["Goblin", 3]]);
		state = EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => it.id === "c3" ? {...it, templates: [{key: "minion"}]} : it)});
		const rolled = {results: [{id: "c1", success: false}, {id: "c2", success: true}, {id: "c3", success: true}]};
		const outcome = {damage: {expr: "8d6", amount: null}, damageType: "fire", halfOnSuccess: true, condition: "prone", rounds: 2};
		expect(getCockpitOutcomeSteps(state, rolled, outcome, {amount: 27})).toEqual([
			{kind: "damage", ids: ["c1"], amount: 27, isHalf: false},
			{kind: "damage", ids: ["c2"], amount: 13, isHalf: true},
			{kind: "condition", ids: ["c1"], condition: "prone", rounds: 2},
		]);
		expect(getCockpitOutcomeSteps(state, rolled, {...outcome, halfOnSuccess: false, condition: null}, {amount: 27})).toEqual([
			{kind: "damage", ids: ["c1"], amount: 27, isHalf: false},
		]);
		// Creatures removed since the roll are skipped.
		expect(getCockpitOutcomeSteps(state, {results: [{id: "gone", success: false}]}, outcome, {amount: 5})).toEqual([]);
	});

	test("who-rolls preview names the modifier, dice bonuses and the source of advantage before rolling", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withEncounterDraft(state, draft => {
			applyEncounterEffect(draft, {targetIds: ["c1"], def: getEncounterEffectPreset(state, "bless")});
			applyEncounterEffect(draft, {targetIds: ["c2"], def: getEncounterEffectPreset(state, "haste")});
		}).state;
		const labels = new Map([["c1", "Goblin 1"], ["c2", "Goblin 2"]]);
		const request = getCockpitRollRequest({...getCockpitEmptyRollForm(), dc: "12"}).request;
		const rows = getCockpitWhoRolls(state, ["c1", "c2"], request, {getContributors: getCockpitContributorGetter(state, {}), labels});
		expect(rows[0]).toMatchObject({label: "Goblin 1", text: "Dex +2 +1d4", mode: "normal"});
		expect(rows[1]).toMatchObject({label: "Goblin 2", text: "Dex +2", mode: "advantage", from: "Haste"});
		const forced = getCockpitWhoRolls(state, ["c1"], {...request, mode: "disadvantage"}, {getContributors: getCockpitContributorGetter(state, {}), labels});
		expect(forced[0].mode).toBe("disadvantage");
	});

	test("skill search filters chips by name fragment or ability, and an empty query lists all", () => {
		const skills = ["acrobatics", "animal handling", "perception", "sleight of hand", "stealth", "insight"];
		expect(getCockpitSkillMatches(skills, "").map(it => it.skill)).toEqual(skills);
		expect(getCockpitSkillMatches(skills, "  PERC ")).toEqual([{skill: "perception", label: "Perception", ability: "wis"}]);
		expect(getCockpitSkillMatches(skills, "dex").map(it => it.skill)).toEqual(["acrobatics", "sleight of hand", "stealth"]);
		expect(getCockpitSkillMatches(skills, "wisdom").map(it => it.skill)).toEqual(["animal handling", "perception", "insight"]);
		expect(getCockpitSkillMatches(skills, "of  hand").map(it => it.skill)).toEqual(["sleight of hand"]);
		expect(getCockpitSkillMatches(skills, "zzz")).toEqual([]);
	});

	test("roll-time prompt asks about scene-dependent sources once each, and its answers drop sources or creatures", async () => {
		let state = await pGetCockpitState([["Goblin", 3]]);
		state = EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => it.id === "c3" ? it : {...it, conditions: ["frightened"]})});
		state = withEncounterBattlefieldEntry(state, {rule: "heavy-precipitation-xdmg", id: "rain"}).state;
		state = withEncounterDraft(state, draft => { applyEncounterEffect(draft, {targetIds: ["c1"], def: getEncounterEffectPreset(state, "bless")}); }).state;
		const getContributors = getCockpitContributorGetter(state, {});
		const labels = new Map([["c1", "Goblin 1"], ["c2", "Goblin 2"], ["c3", "Goblin 3"]]);
		const ids = ["c1", "c2", "c3"];
		const perception = getCockpitRollQuery({kind: "check", skill: "perception", dc: 12});
		const questions = getCockpitRollQuestions({state, ids, query: perception, getContributors, labels});
		expect(questions.map(it => [it.key, it.names])).toEqual([
			["condition:frightened", ["Goblin 1", "Goblin 2"]],
			["battlefield:rain", ["Goblin 1", "Goblin 2", "Goblin 3"]],
		]);
		expect(questions[1].question).toMatch(/heavy rain or heavy snow/);
		expect(questions[1].cite).toMatch(/XDMG/);
		// A Dex save touches neither: frightened affects checks, the rain only Perception; Bless always applies.
		const dexSave = getCockpitRollQuery({kind: "save", ability: "dex"});
		expect(getContributors(state.instances[0], dexSave).bonuses.map(it => it.label)).toEqual(["Bless"]);
		expect(getCockpitRollQuestions({state, ids, query: getCockpitRollQuery({kind: "save", ability: "dex"}), getContributors, labels})).toEqual([]);

		const all = {"condition:frightened": "yes", "battlefield:rain": "yes"};
		expect(getCockpitAnsweredRoll({ids, questions, answers: all, getContributors}).getContributors).toBe(getContributors);
		const noFear = getCockpitAnsweredRoll({ids, questions, answers: {...all, "condition:frightened": "no"}, getContributors});
		const c1 = state.instances.find(it => it.id === "c1");
		expect(getContributors(c1, perception).disadvantage.map(it => it.source)).toEqual(expect.arrayContaining(["condition:frightened", "battlefield:rain"]));
		expect(noFear.getContributors(c1, perception).disadvantage.map(it => it.source)).toEqual(["battlefield:rain"]);
		expect(noFear.ids).toEqual(ids);
		const cancelFear = getCockpitAnsweredRoll({ids, questions, answers: {...all, "condition:frightened": "cancel"}, getContributors});
		expect(cancelFear.ids).toEqual(["c3"]);
	});
});
