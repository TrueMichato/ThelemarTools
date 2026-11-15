import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	ENCOUNTER_BATTLEFIELD_RULES,
	getEncounterBattlefieldContributors,
	getEncounterBattlefieldDisplayName,
	getEncounterBattlefieldHover,
	getEncounterBattlefieldRulesByCategory,
	getEncounterBattlefieldTargets,
	getEncounterBattlefieldTurnRows,
	getEncounterSight,
	withEncounterBattlefieldEntry,
	withEncounterBattlefieldEntryUpdate,
	withEncounterBattlefieldTick,
	withoutEncounterBattlefieldEntry,
} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {getEncounterAcBreakdown, getEncounterContributorGetter, getEncounterRollBreakdown} from "../../js/encounterworkspace/encounterworkspace-rollbreakdown.js";
import {byId, getD20Rng, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const getContributorsFor = state => getEncounterContributorGetter(state, [getEncounterBattlefieldContributors]);

describe("Encounter Cockpit battlefield", () => {
	it("gives every rule one display name, a category and a hover description", () => {
		for (const rule of ENCOUNTER_BATTLEFIELD_RULES) {
			expect(rule.name).toMatch(/\S/);
			expect(rule.description.length).toBeGreaterThan(10);
		}
		expect(new Set(ENCOUNTER_BATTLEFIELD_RULES.map(it => it.rule)).size).toBe(ENCOUNTER_BATTLEFIELD_RULES.length);
		expect(getEncounterBattlefieldRulesByCategory().flatMap(it => it.rules)).toHaveLength(ENCOUNTER_BATTLEFIELD_RULES.length);
		// The v7 roll presets are all represented except the Ioun stone (an item, not a battlefield rule).
		expect(ENCOUNTER_BATTLEFIELD_RULES.map(it => it.rule)).toEqual(expect.arrayContaining(["desecrated-dmg", "desecrated-house", "heavy-precipitation-xdmg", "blizzard-idrotf"]));
	});

	it("makes darkness matter using real senses: darkvision sees dimly, no darkvision is blinded, blindsight sees", async () => {
		let state = await pGetCockpitState([["Goblin", 1], ["Wolf", 1], ["Bat", 1]]);
		({state} = withEncounterBattlefieldEntry(state, {rule: "darkness"}));
		expect(getEncounterSight(state, byId(state, "c1"))).toMatchObject({status: "dim", why: "darkvision treats it as dim light"});
		expect(getEncounterSight(state, byId(state, "c2"))).toMatchObject({status: "blinded", why: "no darkvision"});
		expect(getEncounterSight(state, byId(state, "c3"))).toMatchObject({status: "normal", why: "sees by blindsight"});

		const getContributors = getContributorsFor(state);
		const wolfBite = getEncounterRollBreakdown({instance: byId(state, "c2"), query: {kind: "attack", targetId: "c1"}, rng: getD20Rng(15, 4), getContributors});
		expect(wolfBite.mode).toBe("disadvantage");
		expect(wolfBite.natural).toBe(4);
		expect(wolfBite.disadvantage.map(it => it.label)).toEqual(["Blinded (Darkness)"]);

		const goblinAttacksWolf = getContributors(byId(state, "c1"), {kind: "attack", targetId: "c2"});
		expect(goblinAttacksWolf.advantage.map(it => it.label)).toEqual(["Target can't see (Darkness)"]);
		expect(goblinAttacksWolf.disadvantage).toEqual([]);

		const goblinPerception = getEncounterRollBreakdown({instance: byId(state, "c1"), query: {kind: "check", skill: "perception"}, rng: getD20Rng(12, 9), getContributors});
		expect(goblinPerception.mode).toBe("disadvantage");
		expect(goblinPerception.disadvantage[0].label).toBe("Darkness (darkvision treats it as dim light)");
	});

	it("lets magical darkness defeat darkvision but not blindsight, and the worst light rule wins", async () => {
		let state = await pGetCockpitState([["Goblin", 1], ["Bat", 1]]);
		({state} = withEncounterBattlefieldEntry(state, {rule: "dim-light"}));
		expect(getEncounterSight(state, byId(state, "c1")).status).toBe("normal");
		({state} = withEncounterBattlefieldEntry(state, {rule: "magical-darkness", scope: "selection", ids: ["c1", "c2"]}));
		expect(getEncounterSight(state, byId(state, "c1"))).toMatchObject({status: "blinded", name: "Magical darkness", why: "darkvision can't pierce it"});
		expect(getEncounterSight(state, byId(state, "c2")).status).toBe("normal");
	});

	it("applies cover to AC and Dex saves, and a better cover replaces a worse one in the same scope", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		({state} = withEncounterBattlefieldEntry(state, {rule: "half-cover", scope: "selection", ids: ["c1"]}));
		let ac = getEncounterAcBreakdown({instance: byId(state, "c1"), getContributors: getContributorsFor(state)});
		expect([ac.base, ac.total, ac.parts.map(it => it.text)]).toEqual([15, 17, ["Half cover +2"]]);
		expect(getEncounterAcBreakdown({instance: byId(state, "c2"), getContributors: getContributorsFor(state)}).total).toBe(15);

		const replaced = withEncounterBattlefieldEntry(state, {rule: "three-quarters-cover", scope: "selection", ids: ["c1"]});
		state = replaced.state;
		expect(replaced.replaced.map(it => it.rule)).toEqual(["half-cover"]);
		expect(state.battlefield.map(it => it.rule)).toEqual(["three-quarters-cover"]);
		ac = getEncounterAcBreakdown({instance: byId(state, "c1"), getContributors: getContributorsFor(state)});
		expect(ac.total).toBe(20);

		const save = getEncounterRollBreakdown({instance: byId(state, "c1"), query: {kind: "save", ability: "dex", dc: 15}, rng: getD20Rng(8), getContributors: getContributorsFor(state)});
		expect(save.text).toBe("15 (8 +2 +5)");
		expect(save.success).toBe(true);
		expect(save.parts.map(it => [it.label, it.source])).toEqual([["DEX mod", "statblock"], ["Three-quarters cover", `battlefield:${state.battlefield[0].id}`]]);
	});

	it("ports the v7 roll presets: desecrated ground helps only undead, blizzard only hurts ranged weapon attacks", async () => {
		let state = await pGetCockpitState([["Zombie", 1], ["Goblin", 1]]);
		({state} = withEncounterBattlefieldEntry(state, {rule: "desecrated-dmg"}));
		({state} = withEncounterBattlefieldEntry(state, {rule: "blizzard-idrotf"}));
		const getContributors = getContributorsFor(state);
		expect(getContributors(byId(state, "c1"), {kind: "save", ability: "wis"}).advantage.map(it => it.label)).toEqual(["Desecrated ground"]);
		expect(getContributors(byId(state, "c2"), {kind: "save", ability: "wis"}).advantage).toEqual([]);
		expect(getContributors(byId(state, "c2"), {kind: "attack", ranged: true}).disadvantage.map(it => it.label)).toEqual(["Blizzard"]);
		expect(getContributors(byId(state, "c2"), {kind: "attack"}).disadvantage).toEqual([]);
		expect(getContributors(byId(state, "c2"), {kind: "attack", attackName: "Shortbow"}).disadvantage.map(it => it.label)).toEqual(["Blizzard"]);
		expect(getContributors(byId(state, "c2"), {kind: "attack", attackName: "Scimitar"}).disadvantage).toEqual([]);
		expect(getContributors(byId(state, "c2"), {kind: "attack", ranged: true, spell: true}).disadvantage).toEqual([]);

		// The house-rule variant replaces the DMG one rather than stacking.
		({state} = withEncounterBattlefieldEntry(state, {rule: "desecrated-house"}));
		expect(state.battlefield.map(it => it.rule)).toEqual(["blizzard-idrotf", "desecrated-house"]);
		expect(getContributorsFor(state)(byId(state, "c1"), {kind: "initiative"}).advantage.map(it => it.label)).toEqual(["Desecrated ground (house rule)"]);
	});

	it("scopes entries to everyone, custom groups, view groups or chosen creatures", async () => {
		let state = await pGetCockpitState([["Goblin", 2], ["Wolf", 2]]);
		state = EncounterWorkspaceState.validate({...state, instances: state.instances.map(it => it.id === "c1" ? {...it, customGroup: "Scouts"} : it)});
		let entry;
		({state, entry} = withEncounterBattlefieldEntry(state, {rule: "difficult-terrain", scope: "group", group: "Scouts"}));
		expect(getEncounterBattlefieldTargets(state, entry)).toEqual(["c1"]);
		({state, entry} = withEncounterBattlefieldEntry(state, {rule: "fog", scope: "group", group: "view:c3"}));
		expect(getEncounterBattlefieldTargets(state, entry)).toEqual(["c3", "c4"]);
		({state, entry} = withEncounterBattlefieldEntry(state, {rule: "strong-wind"}));
		expect(getEncounterBattlefieldTargets(state, entry)).toEqual(["c1", "c2", "c3", "c4"]);
		expect(getEncounterBattlefieldHover(state, entry)).toMatchObject({title: "Strong wind", scope: "Everyone", citation: "DMG p. 110"});

		state = withEncounterBattlefieldEntryUpdate(state, entry.id, {scope: "selection", ids: ["c2"], name: "ignored"});
		const updated = state.battlefield.find(it => it.id === entry.id);
		expect([updated.name, getEncounterBattlefieldTargets(state, updated)]).toEqual(["Strong wind", ["c2"]]);
		expect(() => withEncounterBattlefieldEntry(state, {rule: "half-cover", scope: "selection", ids: []})).toThrow("Choose who this applies to.");
		expect(() => withEncounterBattlefieldEntry(state, {rule: "nope"})).toThrow("Unknown battlefield rule");
	});

	it("keeps reminders' own names, adds lair actions on initiative 20 once, and removes entries", async () => {
		let state = await pGetCockpitState([["Goblin", 1]]);
		let reminder;
		({state, entry: reminder} = withEncounterBattlefieldEntry(state, {rule: "custom", name: "  Bridge collapses round 3  ", note: "DC 12 Dex"}));
		expect(getEncounterBattlefieldDisplayName(reminder)).toBe("Bridge collapses round 3");
		({state} = withEncounterBattlefieldEntry(state, {rule: "lair-actions"}));
		expect(getEncounterBattlefieldTurnRows(state)).toEqual([{entryId: "bf:lair-actions:1", name: "Lair actions", initiative: 20, losesTies: true}]);
		expect(() => withEncounterBattlefieldEntry(state, {rule: "lair-actions"})).toThrow("already has lair actions");
		state = withoutEncounterBattlefieldEntry(state, reminder.id);
		expect(state.battlefield.map(it => it.rule)).toEqual(["lair-actions"]);
		expect(EncounterWorkspaceState.validate(state)).toEqual(state);
	});

	it("ticks timed entries each new round, or on the caster's turn, and expires them at zero", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		({state} = withEncounterBattlefieldEntry(state, {rule: "fog", rounds: 2}));
		({state} = withEncounterBattlefieldEntry(state, {rule: "magical-darkness", rounds: 1, casterId: "c2"}));
		({state} = withEncounterBattlefieldEntry(state, {rule: "dim-light"}));

		let tick = withEncounterBattlefieldTick(state, {previousTurn: {round: 1, activeId: "c1"}, nextTurn: {round: 1, activeId: "c2"}});
		expect(tick.ticked).toEqual(["bf:magical-darkness:1"]);
		expect(tick.expired.map(it => it.rule)).toEqual(["magical-darkness"]);
		state = tick.state;

		tick = withEncounterBattlefieldTick(state, {previousTurn: {round: 1, activeId: "c2"}, nextTurn: {round: 2, activeId: "c1"}});
		expect(tick.ticked).toEqual(["bf:fog:1"]);
		expect(tick.state.battlefield.map(it => [it.rule, it.rounds])).toEqual([["fog", 1], ["dim-light", null]]);
		tick = withEncounterBattlefieldTick(tick.state, {previousTurn: {round: 2, activeId: "c1"}, nextTurn: {round: 3, activeId: "c1"}});
		expect(tick.expired.map(it => it.rule)).toEqual(["fog"]);
		expect(tick.state.battlefield.map(it => it.rule)).toEqual(["dim-light"]);

		const idle = withEncounterBattlefieldTick(tick.state, {previousTurn: {round: 3, activeId: "c1"}, nextTurn: {round: 3, activeId: "c2"}});
		expect(idle.state).toBe(tick.state);
	});
});
