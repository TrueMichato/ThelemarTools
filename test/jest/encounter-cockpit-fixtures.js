import fs from "node:fs";
import path from "node:path";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";

const MM = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/bestiary/bestiary-mm.json"), "utf-8")).monster;

export const getMmMonster = name => {
	const monster = MM.find(it => it.name === name);
	if (!monster) throw new Error(`No MM monster named ${name}`);
	return structuredClone(monster);
};

export const getMmHash = name => `${name.toLowerCase()}_mm`;

/** Builds a real v8 encounter from Monster Manual creatures; `roster` is `[[name, count], ...]`. */
export async function pGetCockpitState (roster = [["Goblin", 2]], {prefix = "c"} = {}) {
	let ix = 0;
	const byHash = new Map(roster.map(([name]) => [getMmHash(name), name]));
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Cockpit fixture", saveId: "fixture", items: roster.map(([name, count]) => ({h: getMmHash(name), c: count}))},
		pResolveItem: async item => ({entity: getMmMonster(byHash.get(item.h))}),
		fnUid: () => `${prefix}${++ix}`,
	});
}

/** A deterministic RNG that replays the given d20 faces (1–20), then repeats the last one. */
export const getD20Rng = (...faces) => {
	let ix = 0;
	return () => {
		const face = faces[Math.min(ix++, faces.length - 1)];
		return (face - 1) / 20 + 0.001;
	};
};

/** A deterministic RNG that replays raw values in [0, 1). */
export const getSequenceRng = (...values) => {
	let ix = 0;
	return () => values[Math.min(ix++, values.length - 1)];
};

export const byId = (state, id) => state.instances.find(it => it.id === id);
