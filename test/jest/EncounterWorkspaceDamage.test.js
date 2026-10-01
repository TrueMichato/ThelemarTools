import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {getEncounterDamageForMonster} from "../../js/encounterworkspace/encounterworkspace-damage.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";

const goblin = {name: "Goblin", source: "MM", dex: 14, hp: {average: 20, formula: "4d6 + 6"}};

async function create (monsters = [goblin, goblin, goblin]) {
	let id = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "saved", items: monsters.map((_, index) => ({h: `${index}`}))},
		pResolveItem: async ({h}) => ({entity: monsters[Number(h)]}),
		fnUid: () => `creature-${++id}`,
	});
}

describe("Encounter Workspace typed damage", () => {
	it("applies immunity before resistance/vulnerability, halving with floor before doubling", () => {
		const monster = {immune: ["acid"], resist: ["fire", "cold"], vulnerable: ["fire", "acid"]};
		expect(getEncounterDamageForMonster({monster, amount: 5, damageType: "acid"}).damage).toBe(0);
		expect(getEncounterDamageForMonster({monster, amount: 5, damageType: "fire"}).damage).toBe(4);
		expect(getEncounterDamageForMonster({monster, amount: 5, damageType: "cold"}).damage).toBe(2);
		expect(getEncounterDamageForMonster({monster, amount: 5, damageType: "lightning"}).damage).toBe(5);
		expect(getEncounterDamageForMonster({monster: {immune: [{immune: ["Poison"]}]}, amount: 5, damageType: "poison"}).damage).toBe(0);
	});

	it("requires explicit resolution for contextual defenses rather than ignoring them or treating them as always on", async () => {
		const conditional = {resist: ["bludgeoning", "piercing", "slashing"], note: "from nonmagical attacks", cond: true};
		const guarded = {...goblin, resist: [conditional]};
		const current = await create([guarded, guarded]);
		const before = current.instances.map(it => it.hp);
		const bare = getEncounterDamageForMonster({monster: guarded, amount: 9, damageType: "slashing"});
		expect(bare).toMatchObject({damage: null, unresolved: [{key: "resist:0", defense: "resistance", note: "from nonmagical attacks"}]});
		try {
			EncounterWorkspaceState.withTypedDamage(current, {amount: 9, damageType: "slashing"});
			throw new Error("Expected conditional defenses to block the entire batch.");
		} catch (e) {
			expect(e.message).toMatch(/Resolve the named conditional defenses/);
			expect(e.unresolved.map(it => it.id)).toEqual(["creature-1", "creature-2"]);
		}
		expect(current.instances.map(it => it.hp)).toEqual(before);
		const nonmagical = EncounterWorkspaceState.withTypedDamage(current, {
			amount: 9, damageType: "slashing", source: "nonmagicalAttack",
		});
		expect(nonmagical.results.map(it => it.damage)).toEqual([4, 4]);
		const magical = EncounterWorkspaceState.withTypedDamage(current, {
			amount: 9, damageType: "slashing", source: "magicalAttack",
		});
		expect(magical.results.map(it => it.damage)).toEqual([9, 9]);
		const decided = EncounterWorkspaceState.withTypedDamage(current, {
			amount: 9, damageType: "slashing", decisions: {"creature-1": {"resist:0": true}, "creature-2": {"resist:0": false}},
		});
		expect(decided.results.map(it => it.damage)).toEqual([4, 9]);
	});

	it("surfaces nonstandard conditions, accepts per-instance decisions and never infers a defense from prose", async () => {
		const creature = {...goblin, vulnerable: [{vulnerable: ["fire"], note: "(Tree only)", cond: true}]};
		const state = await create([creature, creature]);
		expect(() => EncounterWorkspaceState.withTypedDamage(state, {amount: 3, damageType: "fire", source: "other"}))
			.toThrow(/Resolve the named conditional defenses/);
		const result = EncounterWorkspaceState.withTypedDamage(state, {
			amount: 3,
			damageType: "fire",
			source: "other",
			decisions: {"creature-1": {"vulnerable:0": true}, "creature-2": {"vulnerable:0": false}},
		});
		expect(result.results.map(it => it.damage)).toEqual([6, 3]);
		expect(getEncounterDamageForMonster({monster: {resist: [{special: "See creature's trait."}]}, amount: 4, damageType: "fire"}).unresolved)
			.toEqual([{key: "resist:0", defense: "resistance", note: "See creature's trait."}]);
		expect(() => getEncounterDamageForMonster({
			monster: creature, amount: 3, damageType: "fire", decisions: {"vulnerable:0": "yes"},
		})).toThrow(/conditional damage defense/);
	});

	it("changes only selected instances using their effective edited statblocks and temporary HP, with compatible undo snapshots", async () => {
		const state = await create([{...goblin, resist: ["fire"]}, {...goblin, vulnerable: ["fire"]}, {...goblin, immune: ["fire"]}]);
		const withTemp = EncounterWorkspaceState.withHp(state, {id: "creature-1", prop: "temp", value: 4});
		const concentrating = EncounterWorkspaceState.withConcentration(withTemp, {id: "creature-1", active: true, label: "Shield"});
		const edited = EncounterWorkspaceState.withStatblockChanges(concentrating, [{
			id: "creature-2",
			addOperations: [{id: "resist-edit", ...BestiaryQuickActionsOperations.patch({set: {immune: ["fire"]}})}],
			removeIds: [],
		}]).state;
		expect(getEncounterEffectiveMonster(edited.instances[1]).immune).toEqual(["fire"]);
		const damage = EncounterWorkspaceState.withTypedDamage(edited, {
			amount: 13, damageType: "fire", targetIds: ["creature-1", "creature-2"],
		});
		expect(damage.changedIds).toEqual(["creature-1"]);
		expect(damage.results.map(it => [it.id, it.damage])).toEqual([["creature-1", 6], ["creature-2", 0]]);
		expect(damage.results[0].concentrationDc).toBe(10);
		expect(damage.state.instances.map(it => it.hp)).toEqual([
			{current: 18, max: 20, temp: 0},
			{current: 20, max: 20, temp: 0},
			{current: 20, max: 20, temp: 0},
		]);
		expect(EncounterWorkspaceState.withHpUndo(damage.state, damage.snapshots).instances.map(it => it.hp))
			.toEqual(edited.instances.map(it => it.hp));
		expect(state.instances[0].monster.resist).toEqual(["fire"]);
	});

	it("skips unset HP explicitly and rejects invalid damage even when every target is skipped", async () => {
		const state = await create([{...goblin, hp: {formula: "unknown"}}, goblin]);
		const result = EncounterWorkspaceState.withTypedDamage(state, {amount: 5, damageType: "fire"});
		expect(result.skippedIds).toEqual(["creature-1"]);
		expect(result.state.instances[0].hp.current).toBeNull();
		expect(result.state.instances[1].hp.current).toBe(15);
		expect(() => EncounterWorkspaceState.withTypedDamage(state, {amount: -1, damageType: "fire", targetIds: ["creature-1"]}))
			.toThrow(/non-negative whole-number/);
		expect(() => EncounterWorkspaceState.withTypedDamage(state, {amount: 1, damageType: "untyped", targetIds: ["creature-1"]}))
			.toThrow(/known damage type/);
		expect(() => EncounterWorkspaceState.withTypedDamage(state, {amount: 1, damageType: "fire", source: "magic", targetIds: ["creature-1"]}))
			.toThrow(/known damage source/);
		expect(() => EncounterWorkspaceState.withTypedDamage(state, {amount: 1, damageType: "fire", decisions: null, targetIds: ["creature-1"]}))
			.toThrow(/decisions must be explicit/);
		expect(() => getEncounterDamageForMonster({monster: {resist: "fire"}, amount: 1, damageType: "fire"}))
			.toThrow(/unreadable damage resistance/);
		expect(() => getEncounterDamageForMonster({
			monster: {vulnerable: ["fire"]}, amount: Number.MAX_SAFE_INTEGER, damageType: "fire",
		})).toThrow(/exceeds the supported range/);
	});
});
