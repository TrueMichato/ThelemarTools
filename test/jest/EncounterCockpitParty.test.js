import "../../js/parser.js";
import "../../js/utils.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterMonsterXp} from "../../js/encounterworkspace/encounterworkspace-assessment.js";
import {
	getEncounterCombatSummary,
	getEncounterPartyStatsFromCharacter,
	pGetEncounterSavedCharacters,
	withEncounterAppliedCr,
	withEncounterCombatEnded,
	withEncounterPartyMembers,
	withoutEncounterAppliedCr,
} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {byId, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

// Shape of a raw `CharacterSheetState#toJson()` record as stored under "charsheet-characters".
const getCharacter = (overrides = {}) => ({
	id: "char-aria",
	_savedAt: 200,
	name: "Aria",
	classes: [{name: "Fighter", source: "XPHB", level: 4}, {name: "Rogue", source: "XPHB", level: 1}],
	abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8},
	abilityBonuses: {dex: 2, wis: 1},
	customModifiers: {initiative: 1, speed: {walk: 5}},
	hp: {current: 30, max: 44, temp: 3},
	ac: {base: 10, armor: {ac: 14, type: "medium"}, shield: true, bonuses: [{value: 1}], itemBonus: 0},
	speed: {walk: 30},
	skillProficiencies: {perception: 2},
	...overrides,
});

const newIds = () => {
	let ix = 0;
	return () => `p${++ix}`;
};

describe("Encounter Cockpit party", () => {
	it("reads encounter stats from a saved character record", () => {
		const stats = getEncounterPartyStatsFromCharacter(getCharacter());
		// dex 16 (+3), wis 13 (+1), level 5 → PB 3, Perception expertise.
		expect(stats).toMatchObject({
			characterId: "char-aria",
			name: "Aria",
			level: 5,
			ac: 14 + 2 + 2 + 1,
			hpMax: 44,
			hpCurrent: 30,
			hpTemp: 3,
			speed: 35,
			initBonus: 4,
			passive: 10 + 1 + 6,
			approximate: ["ac", "initBonus", "passive"],
		});
		const live = getEncounterPartyStatsFromCharacter(getCharacter(), {derived: {ac: 20, passive: 18}});
		expect(live).toMatchObject({ac: 20, passive: 18, approximate: ["initBonus"]});
		expect(getEncounterPartyStatsFromCharacter({hp: {}}).name).toBe("Unnamed Character");
	});

	it("lists saved characters newest first and tolerates an empty store", async () => {
		const storage = {pGet: async key => key === "charsheet-characters" ? [getCharacter(), getCharacter({id: "char-b", name: "Bram", _savedAt: 900, classes: []})] : null};
		const list = await pGetEncounterSavedCharacters({storage});
		expect(list.map(it => it.label)).toEqual(["Bram", "Aria — Fighter/Rogue 5"]);
		expect(await pGetEncounterSavedCharacters({storage: {pGet: async () => null}})).toEqual([]);
		await expect(pGetEncounterSavedCharacters({storage: {pGet: async () => ({})}})).rejects.toThrow("malformed");
	});

	it("adds saved and manual party members as valid party instances, skipping duplicates", async () => {
		let state = await pGetCockpitState([["Goblin", 1]]);
		const fnUid = newIds();
		const saved = getEncounterPartyStatsFromCharacter(getCharacter());
		const result = withEncounterPartyMembers(state, {members: [saved, {name: "Guest", ac: 12, hpMax: 9, speed: 25, initBonus: 1, passive: 11}], fnUid});
		state = result.state;
		expect(result.addedIds).toEqual(["p1", "p2"]);
		const aria = byId(state, "p1");
		expect(aria).toMatchObject({
			kind: "party",
			hash: "party:char-aria",
			customGroup: "Party",
			hp: {current: 30, max: 44, temp: 3},
			party: {characterId: "char-aria", ac: 19, passive: 17, speed: 35, initBonus: 4},
		});
		expect(getEncounterEffectiveMonster(aria)).toMatchObject({name: "Aria", ac: [19], dex: 18});
		expect(byId(state, "p2")).toMatchObject({hash: "party:guest", hp: {current: 9, max: 9}, party: {characterId: null}});
		expect(state.selectedIds).toEqual(["c1"]);

		const again = withEncounterPartyMembers(state, {members: [saved, {name: "Guest", hpMax: 5}], fnUid, group: null});
		expect(again.skipped).toEqual([{name: "Aria", reason: "already in the encounter"}]);
		expect(byId(again.state, again.addedIds[0])).toMatchObject({hash: "party:guest-2", customGroup: null});
		expect(() => EncounterWorkspaceState.validate(again.state)).not.toThrow();
	});

	it("summarises combat, awards XP for defeated foes per party member and ends combat", async () => {
		let state = await pGetCockpitState([["Goblin", 3]]);
		state = withEncounterPartyMembers(state, {members: [{name: "A", hpMax: 10}, {name: "B", hpMax: 10}], fnUid: newIds()}).state;
		state = EncounterWorkspaceState.validate({
			...state,
			turn: {...state.turn, round: 3, activeId: "c3"},
			instances: state.instances.map(it => it.id === "c3" ? {...it, initiative: 12} : it.id === "c1" ? {...it, hp: {...it.hp, current: 0}} : it.id === "c2" ? {...it, defeated: true} : it.id === "p2" ? {...it, hp: {...it.hp, current: 0}} : it),
		});
		const summary = getEncounterCombatSummary(state, {labels: new Map([["c1", "Goblin 1"]])});
		expect(summary).toMatchObject({
			rounds: 3,
			xp: 100,
			perMember: 50,
			unratedCount: 0,
			remaining: ["Goblin"],
			party: [{id: "p1", down: false}, {id: "p2", down: true}],
		});
		expect(summary.defeated.map(it => [it.label, it.xp])).toEqual([["Goblin 1", 50], ["Goblin", 50]]);

		const ended = withEncounterCombatEnded(state);
		expect(ended.state.combat.status).toBe("ended");
		expect(ended.text).toBe("Combat ended after 3 rounds. 100 XP awarded — 50 each.");
		expect(withEncounterCombatEnded(state, {award: false}).text).toBe("Combat ended after 3 rounds. No XP awarded.");
	});

	it("applies an estimated CR (changing XP), replaces it on re-apply and undoes it", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		const xp = id => getEncounterMonsterXp(getEncounterEffectiveMonster(byId(state, id)));
		expect(xp("c1")).toBe(50);
		state = withEncounterAppliedCr(state, {ids: ["c1"], cr: "1"}).state;
		expect(xp("c1")).toBe(200);
		expect(xp("c2")).toBe(50);
		state = withEncounterAppliedCr(state, {ids: ["c1"], cr: "1/2"}).state;
		expect(xp("c1")).toBe(100);
		expect(byId(state, "c1").statblockOperations.filter(it => it.id === "apply-cr")).toHaveLength(1);
		state = withoutEncounterAppliedCr(state, {ids: ["c1"]}).state;
		expect(xp("c1")).toBe(50);
		expect(() => withEncounterAppliedCr(state, {ids: ["c1"], cr: "banana"})).toThrow("valid challenge rating");
	});
});
