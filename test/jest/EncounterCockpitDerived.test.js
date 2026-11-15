import {applyEncounterCondition, setEncounterExhaustion} from "../../js/encounterworkspace/encounterworkspace-conditions-rules.js";
import {
	getEncounterBaseSpeed,
	getEncounterCheckBase,
	getEncounterContributors,
	getEncounterDerived,
	getEncounterDerivedDamage,
	getEncounterSaveBase,
	mergeEncounterContributors,
	summarizeEncounterContributors,
} from "../../js/encounterworkspace/encounterworkspace-derived.js";
import {applyEncounterEffect, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getCockpitInstance as get, getCockpitMonster, getCockpitUid, pGetCockpitState} from "./helpers/encounter-cockpit-fixtures.js";

const fnUid = getCockpitUid("d");
const effect = (state, targetIds, def, opts = {}) => withEncounterDraft(state, draft => applyEncounterEffect(draft, {targetIds, def, fnUid, ...opts})).state;
const condition = (state, targetIds, name, opts = {}) => withEncounterDraft(state, draft => applyEncounterCondition(draft, {targetIds, condition: name, ...opts})).state;
const labels = list => list.map(it => it.label);

describe("Encounter cockpit derived numbers", () => {
	describe("contributor contract", () => {
		it("merges partial contributor objects", () => {
			const merged = mergeEncounterContributors([
				{bonuses: [{label: "Bless", value: "1d4", source: "effect:a"}]},
				null,
				{advantage: [{label: "Faerie Fire", source: "effect:b"}], notes: [{label: "n", source: "x"}]},
				{bonuses: [{label: "Cover", value: 2, source: "effect:c"}], autoCrit: [{label: "c", source: "y"}]},
			]);
			expect(merged).toEqual({
				bonuses: [{label: "Bless", value: "1d4", source: "effect:a"}, {label: "Cover", value: 2, source: "effect:c"}],
				advantage: [{label: "Faerie Fire", source: "effect:b"}],
				disadvantage: [],
				autoFail: [],
				autoCrit: [{label: "c", source: "y"}],
				notes: [{label: "n", source: "x"}],
			});
			expect(mergeEncounterContributors()).toEqual(mergeEncounterContributors([]));
		});

		it("combines effects, conditions and injected providers, and survives a provider that throws", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "bless");
			state = condition(state, ["encounter-1"], "poisoned");
			const itemProvider = (_, instance, query) => query.kind === "attack" && instance.id === "encounter-1" ? {bonuses: [{label: "+1 Scimitar", value: 1, source: "item:scimitar"}]} : {};
			const broken = () => { throw new Error("boom"); };
			const out = getEncounterContributors(state, get(state, "encounter-1"), {kind: "attack"}, [itemProvider, broken]);
			expect(out.bonuses.map(it => [it.label, it.value])).toEqual([["Bless", "1d4"], ["+1 Scimitar", 1]]);
			expect(labels(out.disadvantage)).toEqual(["Poisoned"]);
			expect(out.notes).toContainEqual({label: "A modifier source failed: boom", source: "error"});
		});

		it("summarizes flat bonuses, dice and an advantage/disadvantage cancel", () => {
			const summary = summarizeEncounterContributors({
				bonuses: [{label: "a", value: 2}, {label: "b", value: "+1d4"}, {label: "c", value: -1}],
				advantage: [{label: "Help"}],
				disadvantage: [{label: "Poisoned"}],
			}, 3);
			expect(summary).toMatchObject({base: 3, flat: 1, total: 4, dice: ["1d4"], mode: "normal", cancelled: true});
			expect(summarizeEncounterContributors({advantage: [{label: "x"}]}).mode).toBe("adv");
		});
	});

	describe("base numbers", () => {
		it("reads saves and skills from the statblock and falls back to ability modifiers", () => {
			const goblin = getCockpitMonster();
			expect(getEncounterSaveBase(goblin, "dex")).toBe(4);
			expect(getEncounterSaveBase(goblin, "wis")).toBe(-1);
			expect(getEncounterCheckBase(goblin, "Stealth")).toBe(6);
			expect(getEncounterCheckBase(goblin, "acrobatics")).toBe(2);
			expect(getEncounterCheckBase(goblin, "str")).toBe(-1);
			expect(getEncounterBaseSpeed({kind: "monster"}, {speed: {walk: {number: 40, condition: "(in bear form)"}}})).toBe(40);
		});
	});

	describe("getEncounterDerived", () => {
		it("shows AC with a breakdown from Shield of Faith and cover", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "shield-of-faith");
			state = effect(state, ["encounter-1"], "half-cover");
			const {ac, saves} = getEncounterDerived(state, get(state, "encounter-1"));
			expect(ac).toMatchObject({value: 19, base: 15});
			expect(ac.breakdown.map(it => [it.label, it.value])).toEqual([["Shield of Faith", 2], ["Half cover", 2]]);
			expect(saves.dex).toMatchObject({base: 4, total: 6});
			expect(saves.wis.total).toBe(-1);
		});

		it("party members use their tracked AC, speed and initiative", async () => {
			const state = effect(await pGetCockpitState(), ["pc-1"], "haste");
			const d = getEncounterDerived(state, get(state, "pc-1"));
			expect(d.ac.value).toBe(17);
			expect(d.speed).toMatchObject({base: 30, walk: 60});
			expect(d.initiative.total).toBe(4);
			expect(d.saves.dex).toMatchObject({base: 4, mode: "adv"});
		});

		it("adds Bless dice to attacks and saves and shows Bane as negative dice", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "bless");
			state = effect(state, ["encounter-2"], "bane");
			const blessed = getEncounterDerived(state, get(state, "encounter-1"));
			expect(blessed.attack.dice).toEqual(["1d4"]);
			expect(blessed.saves.con.dice).toEqual(["1d4"]);
			expect(blessed.checkFor("stealth").dice).toEqual([]);
			expect(getEncounterDerived(state, get(state, "encounter-2")).attack.dice).toEqual(["-1d4"]);
		});

		it("applies speed changes in order: multipliers, then flat, then half, then zero", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "haste");
			state = effect(state, ["encounter-1"], {name: "Longstrider", mods: [{target: "speed", kind: "flat", value: 10}]});
			expect(getEncounterDerived(state, get(state, "encounter-1")).speed.walk).toBe(70);
			const slowed = condition(state, ["encounter-1"], "slowed");
			expect(getEncounterDerived(slowed, get(slowed, "encounter-1")).speed.walk).toBe(70);
			expect(getEncounterDerived(slowed, get(slowed, "encounter-1"), {ruleset: "tgtt"}).speed).toMatchObject({walk: 35, reasons: expect.arrayContaining([{label: "slowed", source: "condition", text: "half"}])});
			const restrained = condition(state, ["encounter-1"], "restrained");
			expect(getEncounterDerived(restrained, get(restrained, "encounter-1")).speed.walk).toBe(0);
		});

		it("exhaustion slows per ruleset", async () => {
			const state = withEncounterDraft(await pGetCockpitState(), draft => setEncounterExhaustion(draft, {targetIds: ["encounter-1"], level: 2})).state;
			const goblin = get(state, "encounter-1");
			expect(getEncounterDerived(state, goblin).speed.walk).toBe(15);
			expect(getEncounterDerived(state, goblin, {ruleset: "xphb"}).speed.walk).toBe(20);
			const tgtt = getEncounterDerived(state, goblin, {ruleset: "tgtt"});
			expect(tgtt.speed.walk).toBe(30);
			expect(tgtt.spellDcDelta).toBe(-2);
			expect(tgtt.saves.wis.total).toBe(-3);
		});

		it("shows what attackers get against the creature", async () => {
			let state = condition(await pGetCockpitState(), ["encounter-1"], "unconscious");
			state = effect(state, ["encounter-2"], "faerie-fire");
			const sleeping = getEncounterDerived(state, get(state, "encounter-1")).attacked;
			expect(labels(sleeping.advantage)).toEqual(["Unconscious", "Prone"]);
			expect(labels(sleeping.autoCrit)).toEqual(["Hit within 5 ft. is a critical (Unconscious)"]);
			expect(labels(getEncounterDerived(state, get(state, "encounter-2")).attacked.advantage)).toEqual(["Faerie Fire"]);
			expect(getEncounterDerived(state, get(state, "pc-1")).attackAgainst("encounter-1").mode).toBe("adv");
		});

		it("reports incapacitation, petrified resistances and damage adjustments", async () => {
			let state = condition(await pGetCockpitState(), ["encounter-1"], "petrified");
			state = effect(state, ["encounter-2"], "resist-fire");
			state = effect(state, ["encounter-2"], {name: "Frost brand", vulnerable: ["cold"], immune: ["acid"], mods: []});
			const stone = getEncounterDerived(state, get(state, "encounter-1"));
			expect(stone).toMatchObject({incapacitated: ["petrified"], resistAll: ["petrified"], immune: ["poison"]});
			expect(getEncounterDerivedDamage(stone, 9, "slashing")).toEqual({amount: 4, notes: ["resisted"]});
			expect(getEncounterDerivedDamage(stone, 9, "poison")).toEqual({amount: 0, notes: ["immune"]});
			const warded = getEncounterDerived(state, get(state, "encounter-2"));
			expect(getEncounterDerivedDamage(warded, 9, "fire")).toEqual({amount: 4, notes: ["resisted"]});
			expect(getEncounterDerivedDamage(warded, 9, "cold")).toEqual({amount: 18, notes: ["vulnerable"]});
			expect(getEncounterDerivedDamage(warded, 9, "acid").amount).toBe(0);
			expect(getEncounterDerivedDamage(warded, 9, null).amount).toBe(9);
		});

		it("reports concentration with TGTT poisoned disadvantage", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "bless", {casterId: "pc-1"});
			state = condition(state, ["pc-1"], "poisoned");
			const vex = get(state, "pc-1");
			expect(getEncounterDerived(state, vex).concentration).toMatchObject({label: "Bless", disadvantage: []});
			const tgtt = getEncounterDerived(state, vex, {ruleset: "tgtt"}).concentration;
			expect(labels(tgtt.disadvantage)).toEqual(["Poisoned (concentration)"]);
			expect(tgtt.save.mode).toBe("dis");
			expect(getEncounterDerived(state, get(state, "encounter-1")).concentration).toBeNull();
		});

		it("reports bloodied, death-save state and condition notes", async () => {
			let state = withEncounterDraft(await pGetCockpitState(), draft => {
				get(draft, "encounter-1").hp.current = 3;
				get(draft, "pc-1").hp.current = 0;
				get(draft, "pc-1").deathSaves = {successes: 1, failures: 0, stable: false, dead: false};
			}).state;
			state = condition(state, ["encounter-2"], "charmed");
			expect(getEncounterDerived(state, get(state, "encounter-1"))).toMatchObject({bloodied: true, deathSaves: {uses: false, status: null}});
			expect(getEncounterDerived(state, get(state, "encounter-1"), {monsterDeathSaves: true}).deathSaves.uses).toBe(true);
			expect(getEncounterDerived(state, get(state, "pc-1"))).toMatchObject({bloodied: false, deathSaves: {uses: true, status: "dying", value: {successes: 1}}});
			expect(getEncounterDerived(state, get(state, "encounter-2")).notes.map(it => it.label)).toEqual([expect.stringMatching(/^Charmed: Can't attack the charmer/)]);
		});
	});
});
