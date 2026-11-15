import "../../js/parser.js";
import "../../js/utils.js";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {withEncounterPartyMembers} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {
	getCockpitDifficulty,
	getCockpitDifficultyAriaLabel,
	getCockpitFoeIds,
	getCockpitPartyLevels,
	getCockpitRerollToast,
	getCockpitTurnRecharges,
	withCockpitRechargeRolls,
} from "../../js/encounterworkspace/cockpit/topbar-model.js";
import {byId, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const withParty = (state, count, {prefix = "p", linked = count} = {}) => {
	let ix = 0;
	const members = Array.from({length: count}, (_, i) => ({name: `Hero ${i + 1}`, hpMax: 10, characterId: i < linked ? `char-${i + 1}` : null}));
	return withEncounterPartyMembers(state, {members, fnUid: () => `${prefix}${++ix}`}).state;
};
const levels = (...pairs) => new Map(pairs);
const allLevel = (count, level) => levels(...Array.from({length: count}, (_, i) => [`char-${i + 1}`, level]));

describe("Cockpit difficulty badge", () => {
	test("rates four goblins against four 1st-level heroes with the 2014 and 2024 budgets", async () => {
		const state = withParty(await pGetCockpitState([["Goblin", 4]]), 4);
		const classic = getCockpitDifficulty(state, {ruleset: "phb", levelsByCharacterId: allLevel(4, 1)});
		// 200 XP × 2 (four monsters) = 400 adjusted ≥ the party's Deadly threshold of 400.
		expect(classic).toMatchObject({tier: "deadly", word: "Deadly", cls: "is-deadly", totalXp: 200, adjustedXp: 400, foeCount: 4, partyCount: 4, perMember: 50});
		const one = getCockpitDifficulty(state, {ruleset: "xphb", levelsByCharacterId: allLevel(4, 1)});
		// 2024: 200 XP against a Low budget of 4 × 50.
		expect(one).toMatchObject({tier: "low", word: "Low", cls: "is-easy", adjustedXp: 200});
		expect(getCockpitDifficulty(state, {ruleset: "tgtt", levelsByCharacterId: allLevel(4, 1)}).edition).toBe("classic");
	});

	test("rates only the foes still standing, and counts the defeated as earned", async () => {
		let state = withParty(await pGetCockpitState([["Goblin", 4]]), 4);
		state = EncounterWorkspaceState.withHp(state, {id: "c1", prop: "current", value: 0});
		state = EncounterWorkspaceState.withHp(state, {id: "c2", prop: "current", value: 0});
		const diff = getCockpitDifficulty(state, {levelsByCharacterId: allLevel(4, 1)});
		// Two goblins: 100 XP × 1.5 = 150 → Easy (100–199).
		expect(diff).toMatchObject({tier: "easy", word: "Easy", remainingXp: 100, totalXp: 200, earnedXp: 100, remainingCount: 2});
		expect(diff.defeated.map(it => it.id)).toEqual(["c1", "c2"]);
		expect(getCockpitDifficultyAriaLabel(diff)).toBe("Difficulty Easy, 100 XP; 100 XP earned so far");
	});

	test("has no rating without a party or any known level, and says why", async () => {
		const solo = await pGetCockpitState([["Goblin", 2]]);
		expect(getCockpitDifficulty(solo)).toMatchObject({tier: null, word: null, reason: "no-party", totalXp: 100});
		expect(getCockpitDifficultyAriaLabel(getCockpitDifficulty(solo))).toBe("Encounter XP: 100 XP; 0 XP earned so far");
		const unlinked = withParty(solo, 2, {linked: 0});
		expect(getCockpitDifficulty(unlinked, {levelsByCharacterId: allLevel(2, 5)})).toMatchObject({word: null, reason: "no-levels"});
	});

	test("assumes the average known level for party members without a saved character", async () => {
		const state = withParty(await pGetCockpitState([["Goblin", 1]]), 3, {linked: 2});
		expect(getCockpitPartyLevels(state, levels(["char-1", 3], ["char-2", 6]))).toEqual({levels: [3, 6, 5], assumedCount: 1, unknownCount: 0});
		expect(getCockpitDifficulty(state, {levelsByCharacterId: levels(["char-1", 3], ["char-2", 6])}).assumedLevelCount).toBe(1);
	});
});

describe("Cockpit recharge at the start of a turn", () => {
	const pDragonTurn = async () => {
		let state = await pGetCockpitState([["Young Red Dragon", 1], ["Goblin", 1]]);
		const breath = byId(state, "c1").resources.recharges[0];
		state = EncounterWorkspaceState.withRechargeReady(state, {id: "c1", rechargeId: breath.id, ready: false});
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "c1", total: 20}, {id: "c2", total: 5}]);
		return {state: EncounterWorkspaceState.withTurn(state, "start"), breath};
	};

	test("finds the active creature's spent recharges, and none for a creature without them", async () => {
		const {state, breath} = await pDragonTurn();
		expect(breath).toMatchObject({name: "Fire Breath", min: 5});
		expect(getCockpitTurnRecharges(state)).toEqual([{id: "c1", recharge: {...breath, ready: false}}]);
		expect(getCockpitTurnRecharges(EncounterWorkspaceState.withTurn(state, "next"))).toEqual([]);
		expect(getCockpitTurnRecharges(await pGetCockpitState([["Young Red Dragon", 1]]))).toEqual([]);
	});

	test("a roll at the minimum recharges the ability; below it stays spent; both are logged", async () => {
		const {state, breath} = await pDragonTurn();
		const lines = [];
		const log = (kind, text) => lines.push([kind, text]);
		const hit = withCockpitRechargeRolls(state, [{id: "c1", rechargeId: breath.id, roll: 5}], {log});
		expect(hit.readyCount).toBe(1);
		expect(byId(hit.state, "c1").resources.recharges[0].ready).toBe(true);
		const miss = withCockpitRechargeRolls(state, [{id: "c1", rechargeId: breath.id, roll: 4}], {log});
		expect(miss.readyCount).toBe(0);
		expect(miss.state).toBe(state);
		expect(lines).toEqual([
			["resource", "Young Red Dragon: Fire Breath recharged (rolled 5, needs 5+)."],
			["resource", "Young Red Dragon: Fire Breath still spent (rolled 4, needs 5+)."],
		]);
	});
});

describe("Cockpit foe initiative re-roll", () => {
	test("targets foes still in the fight, never the party", async () => {
		let state = withParty(await pGetCockpitState([["Goblin", 3]]), 2);
		state = EncounterWorkspaceState.withHp(state, {id: "c2", prop: "current", value: 0});
		expect(getCockpitFoeIds(state)).toEqual(["c1", "c3"]);
	});

	test("names the roll mode in the toast", () => {
		expect(getCockpitRerollToast("normal")).toBe("Foe initiative re-rolled.");
		expect(getCockpitRerollToast("advantage")).toBe("Foe initiative re-rolled with advantage.");
	});
});
