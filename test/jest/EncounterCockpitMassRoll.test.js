import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	applyEncounterDamage,
	applyEncounterSaveOutcome,
	getEncounterFailedIds,
	getEncounterPassedIds,
	getEncounterRolledAmount,
	getEncounterSortedRollResults,
	rollEncounterChecks,
	rollEncounterInitiatives,
	rollEncounterSaves,
	withEncounterInitiativeRolls,
} from "../../js/encounterworkspace/encounterworkspace-massroll.js";
import {byId, getD20Rng, getSequenceRng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const withInstancePatch = (state, id, patch) => EncounterWorkspaceState.validate({
	...state,
	instances: state.instances.map(it => it.id === id ? {...it, ...patch} : it),
});

describe("Encounter Cockpit mass rolls", () => {
	it("rolls saves en masse against a DC, skipping defeated creatures, and selects those who failed", async () => {
		let state = await pGetCockpitState([["Goblin", 3], ["Zombie", 1]]);
		state = withInstancePatch(state, "c3", {defeated: true});
		const rolled = rollEncounterSaves({state, ids: ["c1", "c2", "c3", "c4"], ability: "dex", dc: 13, rng: getD20Rng(11, 10, 14)});
		expect(rolled.results.map(it => [it.label, it.roll.text, it.success])).toEqual([
			["Goblin #1", "13 (11 +2)", true],
			["Goblin #2", "12 (10 +2)", false],
			["Zombie #1", "12 (14 -2)", false],
		]);
		expect(rolled.skipped).toEqual([{id: "c3", reason: "defeated"}]);
		expect(getEncounterFailedIds(rolled)).toEqual(["c2", "c4"]);
		expect(getEncounterPassedIds(rolled)).toEqual(["c1"]);
		expect(() => rollEncounterSaves({state, ids: ["c1"], ability: "luck"})).toThrow("Which save");
	});

	it("applies full damage and a timed condition on failure and half damage on success", async () => {
		const state = await pGetCockpitState([["Orc", 2]]);
		const rolled = rollEncounterSaves({state, ids: ["c1", "c2"], ability: "dex", dc: 13, rng: getD20Rng(18, 2)});
		const out = applyEncounterSaveOutcome(state, rolled, {amount: 9, damageType: "fire", halfOnSuccess: true, conditionOnFail: "prone", rounds: 2});
		expect(byId(out.state, "c1")).toMatchObject({hp: {current: 11}, conditions: []});
		expect(byId(out.state, "c2")).toMatchObject({hp: {current: 6}, conditions: ["prone"], conditionDetails: {prone: {rounds: 2}}});
		expect(out.damage.map(it => [it.id, it.damage])).toEqual([["c2", 9], ["c1", 4]]);
		expect(out.conditionIds).toEqual(["c2"]);
		expect(EncounterWorkspaceState.validate(out.state)).toEqual(out.state);
		const undone = EncounterWorkspaceState.withHpUndo(out.state, out.snapshots);
		expect(undone.instances.map(it => it.hp.current)).toEqual([15, 15]);
	});

	it("routes typed damage through immunity and vulnerability", async () => {
		const state = await pGetCockpitState([["Zombie", 1], ["Skeleton", 1]]);
		const poison = applyEncounterDamage(state, {ids: ["c1", "c2"], amount: 6, damageType: "poison"});
		expect(poison.results.map(it => [it.id, it.damage, it.defenses.immune])).toEqual([["c1", 0, true], ["c2", 0, true]]);
		const club = applyEncounterDamage(state, {ids: ["c2"], amount: 5, damageType: "bludgeoning"});
		expect(club.results[0]).toMatchObject({damage: 10, after: {current: 3}});
		const untyped = applyEncounterDamage(state, {ids: ["c1"], amount: 4});
		expect(untyped.results[0]).toMatchObject({id: "c1", damage: 4, after: {current: 18}});
	});

	it("asks for a ruling on conditional resistance and applies it once decided", async () => {
		const state = await pGetCockpitState([["Fire Elemental", 1]]);
		let error;
		try {
			applyEncounterDamage(state, {ids: ["c1"], amount: 10, damageType: "slashing"});
		} catch (e) { error = e; }
		expect(error.unresolved).toEqual([expect.objectContaining({id: "c1", key: "resist:0"})]);
		const out = applyEncounterDamage(state, {ids: ["c1"], amount: 10, damageType: "slashing", decisions: {c1: {"resist:0": true}}});
		expect(out.results[0].damage).toBe(5);
		expect(applyEncounterDamage(state, {ids: ["c1"], amount: 10, damageType: "slashing", source: "magicalAttack"}).results[0].damage).toBe(10);
	});

	it("gives minions no damage on a successful save", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withInstancePatch(state, "c1", {templates: [{key: "minion"}]});
		const rolled = rollEncounterSaves({state, ids: ["c1", "c2"], ability: "dex", dc: 10, rng: getD20Rng(15, 15)});
		const out = applyEncounterSaveOutcome(state, rolled, {amount: 4, damageType: "fire", halfOnSuccess: true});
		expect(out.state.instances.map(it => it.hp.current)).toEqual([7, 5]);
		expect(() => applyEncounterSaveOutcome(state, rollEncounterSaves({state, ids: ["c1"], ability: "dex", rng: getD20Rng(3)}), {amount: 1})).toThrow("save DC");
	});

	it("rolls skill and ability checks en masse with statblock proficiency", async () => {
		const state = await pGetCockpitState([["Goblin", 1], ["Wolf", 1]]);
		const stealth = rollEncounterChecks({state, ids: ["c1", "c2"], skill: "Stealth", dc: 15, rng: getD20Rng(9, 9)});
		expect(stealth.results.map(it => [it.total, it.success])).toEqual([[15, true], [13, false]]);
		const sorted = getEncounterSortedRollResults(stealth);
		expect(sorted[0].id).toBe("c1");
		const str = rollEncounterChecks({state, ids: ["c1", "c2"], ability: "str", rng: getD20Rng(10, 10)});
		expect(str.results.map(it => it.roll.text)).toEqual(["9 (10 -1)", "11 (10 +1)"]);
		expect(() => rollEncounterChecks({state, ids: ["c1"], skill: "juggling"})).toThrow("Unknown skill");
	});

	it("rolls group initiative once per shared-turn group and stores it", async () => {
		let state = await pGetCockpitState([["Goblin", 2], ["Orc", 1]]);
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["c1", "c2"], id: "gobs"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "gobs", isShared: true, total: 1});
		const rolled = rollEncounterInitiatives({state, rng: getD20Rng(12, 7)});
		expect(rolled.results.map(it => [it.id, it.memberIds, it.total, it.label])).toEqual([
			["gobs", ["c1", "c2"], 14, "Goblin (group)"],
			["c3", ["c3"], 8, "Orc #1"],
		]);
		const next = withEncounterInitiativeRolls(state, rolled);
		expect(next.groups[0].initiative).toBe(14);
		expect(byId(next, "c3").initiative).toBe(8);
	});

	it("rolls a damage expression deterministically", () => {
		expect(getEncounterRolledAmount("2d6+1", getSequenceRng(0.5, 0.5))).toMatchObject({amount: 9});
		expect(getEncounterRolledAmount(7)).toEqual({amount: 7, roll: null});
	});
});
