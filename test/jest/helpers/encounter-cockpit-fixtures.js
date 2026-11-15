import {EncounterWorkspaceState, getEncounterPartyMonster} from "../../../js/encounterworkspace/encounterworkspace-state.js";

/** A goblin-ish statblock with the numbers the cockpit rules read (AC, saves, skills, speed). */
export const getCockpitMonster = (name = "Goblin") => ({
	name,
	source: "MM",
	cr: "1/4",
	ac: [{ac: 15, from: ["leather armor", "shield"]}],
	hp: {average: 7, formula: "2d6"},
	speed: {walk: 30},
	str: 8,
	dex: 14,
	con: 10,
	int: 10,
	wis: 8,
	cha: 8,
	save: {dex: "+4"},
	skill: {stealth: "+6"},
	action: [{name: "Scimitar", entries: ["Hit."]}],
});

/** A validated v8 encounter: `count` goblins (encounter-1…) plus, optionally, party member "pc-1" (Vex). */
export const pGetCockpitState = async ({count = 2, party = true} = {}) => {
	let ix = 0;
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "list-1", items: [{h: "goblin_mm", c: count}]},
		pResolveItem: async () => ({entity: getCockpitMonster()}),
		fnUid: () => `encounter-${++ix}`,
	});
	if (!party) return state;
	const pc = {
		...state.instances[0],
		id: "pc-1",
		hash: "party:vex",
		kind: "party",
		monster: getEncounterPartyMonster({name: "Vex", ac: 15, hpMax: 33, initBonus: 4}),
		party: {characterId: null, ac: 15, passive: 14, speed: 30, initBonus: 4},
		hp: {current: 33, max: 33, temp: 0},
		resources: {spellSlots: {}, abilities: [], recharges: [], concentration: {active: false, label: ""}},
	};
	return EncounterWorkspaceState.validate({...state, instances: [...state.instances, pc]});
};

export const getCockpitInstance = (state, id) => state.instances.find(it => it.id === id);

/** Deterministic uid generator for effect/saved-effect ids. */
export const getCockpitUid = (prefix = "u") => {
	let ix = 0;
	return () => `${prefix}${++ix}`;
};
