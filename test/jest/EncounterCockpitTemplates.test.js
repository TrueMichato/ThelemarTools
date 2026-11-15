import fs from "node:fs";
import "../../js/parser.js";
import "../../js/utils.js";
import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	ENCOUNTER_TEMPLATES,
	getEncounterCreatureTypeTemplateOptions,
	getEncounterTemplateChips,
	getEncounterTemplateContributors,
	getEncounterTemplateDcDelta,
	previewEncounterCreatureTypeTemplate,
	withEncounterCreatureTypeTemplate,
	withEncounterTemplate,
	withoutEncounterTemplate,
} from "../../js/encounterworkspace/encounterworkspace-templates.js";
import {getEncounterAcBreakdown, getEncounterContributorGetter, getEncounterRollBreakdown} from "../../js/encounterworkspace/encounterworkspace-rollbreakdown.js";
import {applyEncounterSaveOutcome, rollEncounterSaves} from "../../js/encounterworkspace/encounterworkspace-massroll.js";
import {byId, getD20Rng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const getContributorsFor = state => getEncounterContributorGetter(state, [getEncounterTemplateContributors]);
const withHp = (state, id, current) => EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => it.id === id ? {...it, hp: {...it.hp, current}} : it)});

describe("Encounter Cockpit templates", () => {
	it("makes Elite actually change attack rolls, AC and HP, labelled as a named bonus", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		const applied = withEncounterTemplate(state, {key: "elite", ids: ["c1"]});
		state = applied.state;
		expect(applied.appliedIds).toEqual(["c1"]);
		expect(byId(state, "c1").templates).toEqual([{key: "elite", name: "Elite", kind: "tier", operationIds: ["template:elite"], abilityIds: []}]);
		expect(byId(state, "c1").hp).toMatchObject({current: 14, max: 14});
		expect(getEncounterEffectiveMonster(byId(state, "c1")).hp.average).toBe(14);

		const getContributors = getContributorsFor(state);
		const elite = getEncounterRollBreakdown({instance: byId(state, "c1"), query: {kind: "attack", attackName: "Scimitar"}, rng: getD20Rng(11), getContributors});
		expect(elite.text).toBe("17 (11 +2 +2 +2)");
		expect(elite.parts.map(it => it.text)).toEqual(["DEX mod +2", "Proficiency +2", "Elite +2"]);
		expect(elite.parts.at(-1).source).toBe("template:elite");
		const normal = getEncounterRollBreakdown({instance: byId(state, "c2"), query: {kind: "attack", attackName: "Scimitar"}, rng: getD20Rng(11), getContributors});
		expect(normal.total).toBe(15);
		expect(getEncounterAcBreakdown({instance: byId(state, "c1"), getContributors}).total).toBe(17);
		expect(getEncounterTemplateDcDelta(byId(state, "c1"))).toBe(2);
		// Templates aren't saves: Elite leaves saving throws alone.
		expect(getContributors(byId(state, "c1"), {kind: "save", ability: "dex"}).bonuses).toEqual([]);
		expect(getEncounterTemplateChips(byId(state, "c1"))).toEqual([{key: "elite", name: "Elite", description: ENCOUNTER_TEMPLATES[0].description}]);
		expect(byId(state, "c1").effects).toEqual([]);
	});

	it("removes a template exactly, keeping damage taken, and Weak replaces Elite", async () => {
		let state = await pGetCockpitState([["Goblin", 1]]);
		state = withEncounterTemplate(state, {key: "elite", ids: ["c1"]}).state;
		state = withHp(state, "c1", 10);
		const removed = withoutEncounterTemplate(state, {key: "elite", ids: ["c1"]});
		expect(removed.removedIds).toEqual(["c1"]);
		expect(byId(removed.state, "c1")).toMatchObject({templates: [], statblockOperations: [], hp: {current: 3, max: 7}});

		const weak = withEncounterTemplate(state, {key: "weak", ids: ["c1"]});
		expect(weak.replaced).toEqual([{id: "c1", key: "elite"}]);
		expect(byId(weak.state, "c1").templates.map(it => it.key)).toEqual(["weak"]);
		expect(byId(weak.state, "c1").hp).toMatchObject({current: 0, max: 3});
		expect(getEncounterRollBreakdown({instance: byId(weak.state, "c1"), query: {kind: "attack", attackName: "Scimitar"}, rng: getD20Rng(11), getContributors: getContributorsFor(weak.state)}).text).toBe("13 (11 +2 +2 -2)");
		expect(withEncounterTemplate(weak.state, {key: "weak", ids: ["c1"]}).skipped).toEqual([{id: "c1", reason: "already Weak"}]);
	});

	it("applies Minion as the real Flee, Mortals! conversion that mass saves respect", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		state = withEncounterTemplate(state, {key: "minion", ids: ["c1"]}).state;
		const minion = byId(state, "c1");
		expect(minion.statblockOperations.map(it => [it.id, it.type])).toEqual([["template:minion", "minion"]]);
		expect(getEncounterEffectiveMonster(minion).trait.some(it => it.name === "Minion")).toBe(true);
		expect(withEncounterTemplate(state, {key: "minion", ids: ["c1"]}).skipped).toEqual([{id: "c1", reason: "already Minion"}]);

		const rolled = rollEncounterSaves({state, ids: ["c1", "c2"], ability: "dex", dc: 10, rng: getD20Rng(15, 15)});
		const outcome = applyEncounterSaveOutcome(state, rolled, {amount: 6, halfOnSuccess: true, source: "Fireball"});
		expect([byId(outcome.state, "c1").hp.current, byId(outcome.state, "c2").hp.current]).toEqual([minion.hp.current, 4]);

		state = withoutEncounterTemplate(state, {key: "minion", ids: ["c1"]}).state;
		expect(byId(state, "c1")).toMatchObject({templates: [], statblockOperations: [], hp: {max: 7}});
	});

	it("adds and removes tracked Legendary uses, skipping already-legendary statblocks", async () => {
		let state = await pGetCockpitState([["Goblin", 1], ["Lich", 1]]);
		const applied = withEncounterTemplate(state, {key: "legendary", ids: ["c1", "c2"]});
		expect(applied.skipped).toEqual([{id: "c2", reason: "already legendary"}]);
		state = applied.state;
		expect(byId(state, "c1").resources.abilities.filter(it => it.id.startsWith("template:")).map(it => [it.name, it.max])).toEqual([["Legendary Actions", 3], ["Legendary Resistance (3/Day)", 3]]);
		state = withoutEncounterTemplate(state, {key: "legendary", ids: ["c1"]}).state;
		expect(byId(state, "c1").resources.abilities.some(it => it.id.startsWith("template:"))).toBe(false);
		expect(byId(state, "c1").templates).toEqual([]);
	});

	it("brings back the creature-type templates from the transformation catalogue, applied and removed as one template", async () => {
		const options = getEncounterCreatureTypeTemplateOptions({catalog});
		expect(options.map(it => it.name)).toEqual(expect.arrayContaining(["Zombie", "Skeleton", "Vampire", "Half-Dragon", "Lycanthropy"]));
		expect(options.find(it => it.name === "Zombie")).toMatchObject({key: "type:catalog:zombie|dmg", source: "DMG"});

		let state = await pGetCockpitState([["Bugbear", 2]]);
		const preview = previewEncounterCreatureTypeTemplate(state, {catalog, catalogId: "catalog:zombie|dmg", ids: ["c1"]});
		expect(preview.batch.skipped).toEqual([]);
		const applied = withEncounterCreatureTypeTemplate(state, {catalogId: "catalog:zombie|dmg", name: preview.name, batch: preview.batch});
		state = applied.state;
		const zombie = byId(state, "c1");
		expect(zombie.templates).toEqual([{key: "type:catalog:zombie|dmg", name: "Zombie", kind: "creatureType", catalogId: "catalog:zombie|dmg", operationIds: ["type:catalog:zombie|dmg"], abilityIds: []}]);
		expect(getEncounterEffectiveMonster(zombie).type).toBe("undead");
		expect(getEncounterEffectiveMonster(byId(state, "c2")).type).not.toBe("undead");
		expect(() => withEncounterCreatureTypeTemplate(state, {catalogId: "catalog:zombie|dmg", name: "Zombie", batch: preview.batch})).toThrow("already has the Zombie template");

		state = withoutEncounterTemplate(state, {key: "type:catalog:zombie|dmg", ids: ["c1"]}).state;
		expect(byId(state, "c1")).toMatchObject({templates: [], statblockOperations: []});
		expect(EncounterWorkspaceState.validate(state)).toEqual(state);
	});

	it("never templates party members", async () => {
		const state = await pGetCockpitState([["Goblin", 1]]);
		const withParty = EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => ({...it, kind: "party", hash: "party:p1", party: {ac: 15, passive: 12, speed: 30, initBonus: 2}}))});
		expect(withEncounterTemplate(withParty, {key: "elite", ids: ["c1"]}).skipped).toEqual([{id: "c1", reason: "party members can't take creature templates"}]);
	});
});
