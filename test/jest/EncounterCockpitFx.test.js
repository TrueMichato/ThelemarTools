import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	ENCOUNTER_BUFF_PRESETS,
	ENCOUNTER_COVER_PRESETS,
	ENCOUNTER_MOD_TARGETS,
	applyEncounterEffect,
	deleteEncounterSavedEffect,
	encounterEffectsProvider,
	endEncounterConcentration,
	fmtEncounterDuration,
	getEncounterConcentration,
	getEncounterConcentrationDc,
	getEncounterConcentrationTargets,
	getEncounterEffectPreset,
	getEncounterEffectPresets,
	getEncounterNormalizedMod,
	getEncounterPresetSpellRef,
	removeEncounterEffect,
	saveEncounterEffectDef,
	setEncounterEffectRounds,
	startEncounterConcentration,
	tickEncounterEffectDurations,
	toEncounterRounds,
	updateEncounterEffect,
	validateEncounterMod,
	withEncounterDraft,
} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getCockpitInstance as get, getCockpitUid, pGetCockpitState} from "./helpers/encounter-cockpit-fixtures.js";

const fnUid = getCockpitUid("e");
const apply = (state, opts) => withEncounterDraft(state, (draft, {log}) => applyEncounterEffect(draft, {fnUid, log, ...opts}));

describe("Encounter cockpit effects", () => {
	describe("durations", () => {
		it("converts minutes and hours to rounds and formats them back", () => {
			expect(toEncounterRounds(1, "min")).toBe(10);
			expect(toEncounterRounds(8, "hour")).toBe(4800);
			expect(toEncounterRounds(3)).toBe(3);
			expect(toEncounterRounds(5, "until")).toBeNull();
			expect(toEncounterRounds("")).toBeNull();
			expect(() => toEncounterRounds("soon", "min")).toThrow(/duration/);
			expect(fmtEncounterDuration(null)).toBe("until removed");
			expect(fmtEncounterDuration(1)).toBe("1 round");
			expect(fmtEncounterDuration(10)).toBe("10 rounds · 1 min");
			expect(fmtEncounterDuration(600)).toBe("600 rounds · 1 h");
			expect(fmtEncounterDuration(7)).toBe("7 rounds");
		});

		it("lets a duration be typed by hand, counts it down each round and removes it when it expires", async () => {
			let {state, result} = apply(await pGetCockpitState(), {targetIds: ["encounter-1", "encounter-2"], def: "bless"});
			const id = result.effectIds["encounter-1"];
			expect(get(state, "encounter-1").effects[0]).toMatchObject({name: "Bless", rounds: 10, totalRounds: 10});

			({state} = withEncounterDraft(state, draft => setEncounterEffectRounds(draft, {instanceId: "encounter-1", effectId: id, rounds: "2"})));
			expect(get(state, "encounter-1").effects[0]).toMatchObject({rounds: 2, totalRounds: 10});

			let ended;
			({state, result: ended} = withEncounterDraft(state, draft => tickEncounterEffectDurations(draft)));
			expect(ended).toEqual([]);
			expect(get(state, "encounter-1").effects[0].rounds).toBe(1);
			expect(get(state, "encounter-2").effects[0].rounds).toBe(9);

			const out = withEncounterDraft(state, (draft, {log}) => tickEncounterEffectDurations(draft, {log}));
			expect(out.result).toEqual([{instanceId: "encounter-1", effectId: id, name: "Bless"}]);
			expect(get(out.state, "encounter-1").effects).toEqual([]);
			expect(out.logs[0][1]).toMatch(/Bless ended on Goblin/);
		});

		it("raises the total when a duration is extended and supports 'until removed'", async () => {
			let {state, result} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: "bless", rounds: 3});
			const effectId = result.effectIds["encounter-1"];
			({state} = withEncounterDraft(state, draft => setEncounterEffectRounds(draft, {instanceId: "encounter-1", effectId, rounds: 20})));
			expect(get(state, "encounter-1").effects[0]).toMatchObject({rounds: 20, totalRounds: 20});
			({state} = withEncounterDraft(state, draft => setEncounterEffectRounds(draft, {instanceId: "encounter-1", effectId, rounds: null})));
			expect(get(state, "encounter-1").effects[0]).toMatchObject({rounds: null, totalRounds: null});
			({state} = withEncounterDraft(state, draft => tickEncounterEffectDurations(draft)));
			expect(get(state, "encounter-1").effects).toHaveLength(1);
		});
	});

	describe("presets", () => {
		it("links buff presets to their real spells for the active ruleset", () => {
			const bless = getEncounterEffectPreset(null, "bless");
			expect(getEncounterPresetSpellRef(bless)).toEqual({name: "bless", source: "PHB"});
			expect(getEncounterPresetSpellRef(bless, {ruleset: "xphb"})).toEqual({name: "bless", source: "XPHB"});
			expect(getEncounterPresetSpellRef(getEncounterEffectPreset(null, "hunters-mark"))).toEqual({name: "hunter's mark", source: "PHB"});
			expect(getEncounterPresetSpellRef(getEncounterEffectPreset(null, "leadership"))).toBeNull();
			ENCOUNTER_BUFF_PRESETS.forEach(preset => preset.mods.forEach(mod => expect(validateEncounterMod(mod)).toBeTruthy()));
		});

		it("models cover as premade effects that add AC and Dex saves", async () => {
			expect(ENCOUNTER_COVER_PRESETS.map(it => it.key)).toEqual(["half-cover", "three-quarters-cover"]);
			const {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: "three-quarters-cover"});
			const goblin = get(state, "encounter-1");
			expect(goblin.effects[0]).toMatchObject({kind: "cover", cover: true, rounds: null});
			expect(encounterEffectsProvider(state, goblin, {kind: "ac"}).bonuses).toEqual([{label: "Three-quarters cover", source: `effect:${goblin.effects[0].id}`, value: 5}]);
			expect(encounterEffectsProvider(state, goblin, {kind: "save", ability: "dex"}).bonuses.map(it => it.value)).toEqual([5]);
			expect(encounterEffectsProvider(state, goblin, {kind: "save", ability: "wis"}).bonuses).toEqual([]);
		});

		it("replaces a re-applied preset instead of stacking it, but custom effects stack", async () => {
			let {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: "bless"});
			({state} = apply(state, {targetIds: ["encounter-1"], def: "bless", rounds: 4}));
			expect(get(state, "encounter-1").effects.map(it => [it.name, it.rounds])).toEqual([["Bless", 4]]);
			const custom = {name: "Rally", mods: [{target: "attack", kind: "flat", value: 1}]};
			({state} = apply(state, {targetIds: ["encounter-1"], def: custom}));
			({state} = withEncounterDraft(state, draft => applyEncounterEffect(draft, {targetIds: ["encounter-1"], def: custom, fnUid: () => "other"})));
			expect(get(state, "encounter-1").effects.map(it => it.name)).toEqual(["Bless", "Rally", "Rally"]);
		});

		it("refuses templates, unknown keys and empty selections", async () => {
			const state = await pGetCockpitState();
			expect(getEncounterEffectPresets(state).some(it => /template|elite/i.test(it.key))).toBe(false);
			expect(() => apply(state, {targetIds: ["encounter-1"], def: "elite"})).toThrow(/Choose an effect/);
			expect(() => apply(state, {targetIds: [], def: "bless"})).toThrow(/Select at least one/);
			expect(() => apply(state, {targetIds: ["nobody"], def: "bless"})).toThrow(/no longer exists/);
		});
	});

	describe("custom effects", () => {
		it("targets a specific save, check or skill with flat, dice, adv or dis modifiers", async () => {
			const def = {
				name: "Wind ward",
				kind: "buff",
				mods: [
					{target: "save:dex", kind: "flat", value: "2"},
					{target: "check:str", kind: "adv"},
					{target: "skill", kind: "dice", value: "1d4", skill: "Stealth"},
					{target: "saves", kind: "dis"},
				],
			};
			const {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def, rounds: 5});
			const goblin = get(state, "encounter-1");
			expect(goblin.effects[0].mods).toEqual([
				{target: "save:dex", kind: "flat", value: 2},
				{target: "check:str", kind: "adv", value: ""},
				{target: "skill", kind: "dice", value: "1d4", skill: "stealth"},
				{target: "saves", kind: "dis", value: ""},
			]);
			const dex = encounterEffectsProvider(state, goblin, {kind: "save", ability: "dex"});
			expect(dex.bonuses.map(it => it.value)).toEqual([2]);
			expect(dex.disadvantage).toHaveLength(1);
			expect(encounterEffectsProvider(state, goblin, {kind: "save", ability: "con"}).bonuses).toEqual([]);
			expect(encounterEffectsProvider(state, goblin, {kind: "check", ability: "str"}).advantage).toHaveLength(1);
			expect(encounterEffectsProvider(state, goblin, {kind: "check", skill: "athletics"}).advantage).toHaveLength(1);
			expect(encounterEffectsProvider(state, goblin, {kind: "check", skill: "stealth"}).bonuses.map(it => it.value)).toEqual(["1d4"]);
			expect(encounterEffectsProvider(state, goblin, {kind: "check", skill: "perception"}).bonuses).toEqual([]);
		});

		it("rejects modifiers that don't fit their target", () => {
			expect(() => validateEncounterMod({target: "nowhere", kind: "flat", value: 1})).toThrow(/what the modifier affects/);
			expect(() => validateEncounterMod({target: "ac", kind: "adv"})).toThrow(/can't take/);
			expect(() => validateEncounterMod({target: "attack", kind: "flat", value: "1.5"})).toThrow(/whole-number/);
			expect(() => validateEncounterMod({target: "attack", kind: "dice", value: "lots"})).toThrow(/dice/);
			expect(() => validateEncounterMod({target: "skill", kind: "adv", skill: "juggling"})).toThrow(/skill/);
			expect(() => validateEncounterMod({target: "speed", kind: "mult", value: 0})).toThrow(/positive/);
			expect(ENCOUNTER_MOD_TARGETS.map(it => it.value)).toEqual(expect.arrayContaining(["save:dex", "check:wis", "attacked", "init"]));
		});

		it("edits an effect in place and keeps the state valid", async () => {
			let {state, result} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: {name: "Odd", mods: []}});
			const effectId = result.effectIds["encounter-1"];
			({state} = withEncounterDraft(state, draft => updateEncounterEffect(draft, {instanceId: "encounter-1", effectId, patch: {name: "Stoneskin", kind: "buff", resist: ["slashing"], mods: [{target: "ac", kind: "flat", value: 1}], rounds: 6}})));
			expect(get(state, "encounter-1").effects[0]).toMatchObject({name: "Stoneskin", kind: "buff", resist: ["slashing"], rounds: 6, mods: [{target: "ac", kind: "flat", value: 1}]});
			expect(() => withEncounterDraft(state, draft => updateEncounterEffect(draft, {instanceId: "encounter-1", effectId, patch: {name: " "}}))).toThrow(/Name/);
			expect(() => withEncounterDraft(state, draft => updateEncounterEffect(draft, {instanceId: "encounter-1", effectId: "nope", patch: {}}))).toThrow(/no longer exists/);
		});

		it("removes effects by id or by key across creatures", async () => {
			let {state, result} = apply(await pGetCockpitState(), {targetIds: ["encounter-1", "encounter-2"], def: "bane"});
			({state} = withEncounterDraft(state, draft => removeEncounterEffect(draft, {effectId: result.effectIds["encounter-1"]})));
			expect(get(state, "encounter-1").effects).toEqual([]);
			expect(get(state, "encounter-2").effects).toHaveLength(1);
			const out = withEncounterDraft(state, draft => removeEncounterEffect(draft, {key: "bane"}));
			expect(out.result).toHaveLength(1);
			expect(get(out.state, "encounter-2").effects).toEqual([]);
			expect(() => withEncounterDraft(state, draft => removeEncounterEffect(draft, {}))).toThrow(/Choose an effect/);
		});
	});

	describe("saved custom effects", () => {
		it("saves, reuses, replaces by name and deletes custom definitions", async () => {
			const fnUid = getCockpitUid("s");
			let {state, result: saved} = withEncounterDraft(await pGetCockpitState(), draft => saveEncounterEffectDef(draft, {name: "Rune ward", mods: [{target: "save:wis", kind: "adv"}], duration: 10}, {fnUid}));
			expect(saved).toMatchObject({key: "saved-s1", saved: true, duration: 10});
			expect(state.savedEffects).toHaveLength(1);
			expect(getEncounterEffectPresets(state).at(-1).key).toBe("saved-s1");

			let applied;
			({state, result: applied} = apply(state, {targetIds: ["encounter-2"], def: "saved-s1"}));
			expect(get(state, "encounter-2").effects[0]).toMatchObject({name: "Rune ward", source: "saved", rounds: 10});
			expect(applied.effectIds["encounter-2"]).toMatch(/^fx:/);

			({state} = withEncounterDraft(state, draft => saveEncounterEffectDef(draft, {name: "rune WARD", mods: []}, {fnUid})));
			expect(state.savedEffects.map(it => [it.key, it.name])).toEqual([["saved-s2", "rune WARD"]]);
			const del = withEncounterDraft(state, draft => deleteEncounterSavedEffect(draft, "saved-s2"));
			expect(del.result).toBe(true);
			expect(del.state.savedEffects).toEqual([]);
		});
	});

	describe("contributors", () => {
		it("reads v7-migrated bonus mods with their v7 scope names", async () => {
			const state = await pGetCockpitState();
			const goblin = {
				...get(state, "encounter-1"),
				effects: [{
					id: "fx:v7:a",
					key: null,
					name: "Old luck",
					kind: "buff",
					rounds: null,
					casterId: null,
					mods: [
						{target: "save", kind: "bonus", value: 2},
						{target: "check", kind: "adv", value: ""},
						{target: "skill", kind: "bonus", value: "1d4"},
						{target: "initiative", kind: "bonus", value: "+3"},
					],
				}],
			};
			const valid = EncounterWorkspaceState.validate({...state, instances: [goblin, ...state.instances.slice(1)]});
			const inst = get(valid, "encounter-1");
			expect(getEncounterNormalizedMod({target: "save", kind: "bonus", value: "1d4"})).toEqual({target: "saves", kind: "dice", value: "1d4"});
			expect(encounterEffectsProvider(valid, inst, {kind: "save", ability: "wis"}).bonuses.map(it => it.value)).toEqual([2]);
			expect(encounterEffectsProvider(valid, inst, {kind: "check", skill: "stealth"})).toMatchObject({bonuses: [{value: "1d4"}], advantage: [{label: "Old luck"}]});
			expect(encounterEffectsProvider(valid, inst, {kind: "initiative"}).bonuses.map(it => it.value)).toEqual([3]);
		});

		it("uses the best 'set AC' effect plus Dex only when it beats the base AC", async () => {
			let {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1", "pc-1"], def: "mage-armor"});
			// Goblin: AC 15 base beats 13 + 2 → no bonus. Vex: AC 15, Dex 18 → 13 + 4 = 17.
			expect(encounterEffectsProvider(state, get(state, "encounter-1"), {kind: "ac"}).bonuses).toEqual([]);
			expect(encounterEffectsProvider(state, get(state, "pc-1"), {kind: "ac"}).bonuses).toMatchObject([{label: "Mage Armor (AC 17)", value: 2}]);
			({state} = apply(state, {targetIds: ["pc-1"], def: "shield-of-faith"}));
			expect(encounterEffectsProvider(state, get(state, "pc-1"), {kind: "ac"}).bonuses.map(it => it.value)).toEqual([2, 2]);
		});

		it("gives attackers the target's 'attacks against it' modifiers", async () => {
			const {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-2"], def: "faerie-fire"});
			const out = encounterEffectsProvider(state, get(state, "pc-1"), {kind: "attack", targetId: "encounter-2"});
			expect(out.advantage).toEqual([{label: "Faerie Fire (target)", source: expect.stringMatching(/^effect:fx:/)}]);
			expect(encounterEffectsProvider(state, get(state, "pc-1"), {kind: "attack", targetId: "encounter-1"}).advantage).toEqual([]);
		});
	});

	describe("concentration", () => {
		it("computes the concentration DC as half the damage, minimum 10", () => {
			expect(getEncounterConcentrationDc(0)).toBeNull();
			expect(getEncounterConcentrationDc(7)).toBe(10);
			expect(getEncounterConcentrationDc(22)).toBe(11);
			expect(getEncounterConcentrationDc(45)).toBe(22);
		});

		it("links a caster's concentration effect to every target and starts concentrating", async () => {
			const {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1", "encounter-2"], def: "bless", casterId: "pc-1"});
			const vex = get(state, "pc-1");
			expect(getEncounterConcentration(vex)).toBe("Bless");
			expect(vex.resources.concentration).toEqual({active: true, label: "Bless"});
			expect(vex.conditions).toContain("concentrating");
			expect(get(state, "encounter-1").effects[0]).toMatchObject({casterId: "pc-1", concOn: "Bless", conc: true});
			expect(getEncounterConcentrationTargets(state, "pc-1")).toEqual(["encounter-1", "encounter-2"]);
		});

		it("switching concentration removes the previous spell's effects from every creature", async () => {
			let {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1", "encounter-2"], def: "bless", casterId: "pc-1"});
			({state} = apply(state, {targetIds: ["encounter-1"], def: "shield-of-faith"}));
			const out = apply(state, {targetIds: ["pc-1"], def: "haste", casterId: "pc-1"});
			expect(out.result.ended).toEqual({spell: "Bless", ended: ["encounter-1", "encounter-2"]});
			expect(get(out.state, "encounter-1").effects.map(it => it.name)).toEqual(["Shield of Faith"]);
			expect(get(out.state, "encounter-2").effects).toEqual([]);
			expect(get(out.state, "pc-1").effects.map(it => it.name)).toEqual(["Haste"]);
			expect(get(out.state, "pc-1").resources.concentration.label).toBe("Haste");
			expect(out.logs.some(([, text]) => /Bless ended on 2 creatures/.test(text))).toBe(true);
		});

		it("a non-concentration spell from the same caster leaves concentration alone", async () => {
			let {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: "bless", casterId: "pc-1"});
			({state} = apply(state, {targetIds: ["pc-1"], def: "mage-armor", casterId: "pc-1"}));
			expect(get(state, "encounter-1").effects.map(it => it.name)).toEqual(["Bless"]);
			expect(get(state, "pc-1").effects[0]).toMatchObject({name: "Mage Armor", casterId: "pc-1", concOn: null});
		});

		it("ending concentration removes linked effects and clears the marker", async () => {
			let {state} = apply(await pGetCockpitState(), {targetIds: ["encounter-1"], def: "bless", casterId: "pc-1"});
			const out = withEncounterDraft(state, (draft, {log}) => endEncounterConcentration(draft, "pc-1", {reason: "failed concentration", log}));
			expect(out.result).toEqual({spell: "Bless", ended: ["encounter-1"]});
			expect(get(out.state, "encounter-1").effects).toEqual([]);
			expect(get(out.state, "pc-1").resources.concentration).toEqual({active: false, label: ""});
			expect(get(out.state, "pc-1").conditions).not.toContain("concentrating");
			expect(out.logs[0][1]).toMatch(/Vex failed concentration/);
		});

		it("marks concentration on a spell with no sheet effect, and re-marking the same spell is a no-op", async () => {
			let {state} = withEncounterDraft(await pGetCockpitState(), draft => startEncounterConcentration(draft, "encounter-1", "Fog Cloud"));
			expect(get(state, "encounter-1").resources.concentration).toEqual({active: true, label: "Fog Cloud"});
			const again = withEncounterDraft(state, (draft, {log}) => startEncounterConcentration(draft, "encounter-1", "Fog Cloud", {log}));
			expect(again.result).toEqual({spell: null, ended: []});
			expect(again.logs).toEqual([]);
		});
	});
});
