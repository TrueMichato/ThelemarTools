import {
	applyEncounterEffect,
	getEncounterEffectPresets,
	saveEncounterEffectDef,
	withEncounterDraft,
} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {
	getCockpitActiveEffects,
	getCockpitCasterId,
	getCockpitCasterOptions,
	getCockpitConcentrationWarning,
	getCockpitDefenseOf,
	getCockpitDurationNormalized,
	getCockpitDurationParts,
	getCockpitDurationReadout,
	getCockpitDurationRounds,
	getCockpitDurationStep,
	getCockpitEffectDef,
	getCockpitEffectSummary,
	getCockpitEmptyEffectForm,
	getCockpitFormWithDefense,
	getCockpitFxGroups,
	getCockpitIsPresetOnAll,
	getCockpitModForTarget,
	getCockpitModTargetGroups,
} from "../../js/encounterworkspace/cockpit/features/act-effect-model.js";
import {getCockpitInstanceLabels} from "../../js/encounterworkspace/cockpit/model.js";
import {pGetCockpitState} from "./encounter-cockpit-fixtures.js";

describe("Encounter cockpit Act — effects", () => {
	test("a duration typed by hand accepts a unit in the text, which wins over the unit select", () => {
		expect(getCockpitDurationRounds({amount: "10", unit: "round"})).toMatchObject({ok: true, rounds: 10, unit: "round"});
		expect(getCockpitDurationRounds({amount: "1", unit: "min"})).toMatchObject({ok: true, rounds: 10, unit: "min"});
		expect(getCockpitDurationRounds({amount: "8 h", unit: "round"})).toMatchObject({ok: true, rounds: 4800, unit: "hour"});
		expect(getCockpitDurationRounds({amount: "3r", unit: "hour"})).toMatchObject({ok: true, rounds: 3, unit: "round"});
		expect(getCockpitDurationRounds({amount: "", unit: "until"})).toMatchObject({ok: true, rounds: null});
		expect(getCockpitDurationRounds({amount: "until", unit: "round"})).toMatchObject({ok: true, rounds: null});
		expect(getCockpitDurationRounds({amount: "0", unit: "round"}).ok).toBe(false);
		expect(getCockpitDurationRounds({amount: "2 weeks", unit: "round"}).message).toContain("weeks");
		expect(getCockpitDurationRounds({amount: "1000", unit: "hour"}).ok).toBe(false);
		// Round-trips: the best display unit for a stored duration.
		expect(getCockpitDurationParts(600)).toEqual({amount: "1", unit: "hour"});
		expect(getCockpitDurationParts(100)).toEqual({amount: "10", unit: "min"});
		expect(getCockpitDurationParts(3)).toEqual({amount: "3", unit: "round"});
		expect(getCockpitDurationParts(null)).toEqual({amount: "", unit: "until"});
	});

	test("the duration readout shows rounds and table time; the stepper steps the unit being typed", () => {
		expect(getCockpitDurationReadout(3)).toBe("3 rounds");
		expect(getCockpitDurationReadout(1)).toBe("1 round");
		expect(getCockpitDurationReadout(10)).toBe("10 rounds · 1 min");
		expect(getCockpitDurationReadout(15)).toBe("15 rounds · 1.5 min");
		expect(getCockpitDurationReadout(4800)).toBe("4800 rounds · 8 h");
		expect(getCockpitDurationReadout(null)).toBe("until removed");

		expect(getCockpitDurationStep({amount: "1", unit: "min"}, 1)).toEqual({amount: "2", unit: "min"});
		expect(getCockpitDurationStep({amount: "1", unit: "min"}, -1)).toEqual({amount: "1", unit: "min"});
		expect(getCockpitDurationStep({amount: "8 h", unit: "round"}, -1)).toEqual({amount: "7", unit: "hour"});
		expect(getCockpitDurationStep({amount: "", unit: "until"}, 1)).toEqual({amount: "1", unit: "round"});
		expect(getCockpitDurationStep({amount: "soon", unit: "min"}, 1)).toEqual({amount: "1", unit: "min"});

		expect(getCockpitDurationNormalized({amount: "10 r", unit: "min"})).toEqual({amount: "10", unit: "round"});
		expect(getCockpitDurationNormalized({amount: "1.5 h", unit: "round"})).toEqual({amount: "1.5", unit: "hour"});
		expect(getCockpitDurationNormalized({amount: "∞", unit: "round"})).toEqual({amount: "", unit: "until"});
		expect(getCockpitDurationNormalized({amount: "12", unit: "until"})).toEqual({amount: "12", unit: "round"});
		expect(getCockpitDurationNormalized({amount: "2 weeks", unit: "min"})).toEqual({amount: "2 weeks", unit: "min"});
	});

	test("targeted mods are grouped so Dex saves, one skill, attacks, AC, speed and initiative are each reachable", () => {
		const groups = getCockpitModTargetGroups();
		const all = groups.flatMap(it => it.targets.map(t => t.value));
		["ac", "attack", "save:dex", "saves", "skill", "checks", "speed", "init", "damage"].forEach(value => expect(all).toContain(value));
		expect(groups.find(it => it.label === "Saving throws").targets.map(it => it.value)).toContain("save:wis");
		// Switching target keeps a compatible kind and value; an incompatible one resets to the target's first kind.
		expect(getCockpitModForTarget("save:dex", {target: "ac", kind: "flat", value: "3"})).toMatchObject({target: "save:dex", kind: "flat", value: "3"});
		expect(getCockpitModForTarget("skill", null)).toMatchObject({target: "skill", skill: "perception"});
	});

	test("the builder validates into a stacking custom def; bad rows point at the field to fix", () => {
		let form = getCockpitEmptyEffectForm();
		expect(getCockpitEffectDef(form)).toMatchObject({ok: false, field: "name"});
		form = {...form, name: "  Blessed   ward ", mods: [{target: "save:dex", kind: "flat", value: "2"}, {target: "skill", kind: "adv", value: "", skill: "stealth"}], durationAmount: "1", durationUnit: "min"};
		form = getCockpitFormWithDefense(form, "resist", "fire");
		const out = getCockpitEffectDef(form);
		expect(out.ok).toBe(true);
		expect(out.def).toMatchObject({name: "Blessed ward", duration: 10, resist: ["fire"], conc: false});
		expect(out.def.key).toBeUndefined();
		expect(out.def.mods).toEqual([{target: "save:dex", kind: "flat", value: 2}, {target: "skill", kind: "adv", value: "", skill: "stealth"}]);
		expect(getCockpitEffectSummary(out.def)).toBe("DEX save +2 · Stealth: advantage · resist fire · 1 min");
		expect(getCockpitEffectDef({...form, mods: [{target: "ac", kind: "flat", value: "two"}]})).toMatchObject({ok: false, field: "mod-0"});
		expect(getCockpitEffectDef({...form, durationAmount: "soon"})).toMatchObject({ok: false, field: "duration"});
	});

	test("a damage type lives in one defense list at a time and pressing it again deselects it", () => {
		let form = getCockpitEmptyEffectForm();
		form = getCockpitFormWithDefense(form, "resist", "fire");
		expect(getCockpitDefenseOf(form, "fire")).toBe("resist");
		form = getCockpitFormWithDefense(form, "immune", "fire");
		expect(form.resist).toEqual([]);
		expect(getCockpitDefenseOf(form, "fire")).toBe("immune");
		form = getCockpitFormWithDefense(form, "immune", "fire");
		expect(getCockpitDefenseOf(form, "fire")).toBeNull();
	});

	test("Fx groups put the 12 spells, the two premade cover presets and saved effects in their own sections", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		const def = getCockpitEffectDef({...getCockpitEmptyEffectForm(), name: "Ward", mods: [{target: "ac", kind: "flat", value: "1"}]}).def;
		state = withEncounterDraft(state, draft => { saveEncounterEffectDef(draft, def); }).state;
		const groups = getCockpitFxGroups(getEncounterEffectPresets(state));
		expect(groups.map(it => [it.id, it.items.length])).toEqual([["spells", 12], ["cover", 2], ["saved", 1]]);
		expect(groups[1].items.map(it => [it.name, it.mods.map(m => `${m.target}${m.value}`)])).toEqual([
			["Half cover", ["ac2", "save:dex2"]],
			["Three-quarters cover", ["ac5", "save:dex5"]],
		]);
	});

	test("casting a new concentration spell warns how many creatures lose the old one", async () => {
		let state = await pGetCockpitState([["Goblin", 3], ["Mage", 1]]);
		const labels = getCockpitInstanceLabels(state.instances);
		const presets = getEncounterEffectPresets(state);
		const bless = presets.find(it => it.key === "bless");
		const haste = presets.find(it => it.key === "haste");
		expect(getCockpitConcentrationWarning(state, {casterId: "c4", def: haste, labels})).toBeNull();
		state = withEncounterDraft(state, draft => { applyEncounterEffect(draft, {targetIds: ["c1", "c2"], def: bless, casterId: "c4"}); }).state;
		const warn = getCockpitConcentrationWarning(state, {casterId: "c4", def: haste, labels});
		expect(warn).toMatchObject({current: "Bless", next: "Haste", count: 2});
		expect(warn.text).toBe(`${labels.get("c4")} is concentrating on Bless. Casting Haste ends Bless on 2 creatures.`);
		// Re-casting the same spell or a non-concentration effect needs no warning.
		expect(getCockpitConcentrationWarning(state, {casterId: "c4", def: bless, labels})).toBeNull();
		expect(getCockpitConcentrationWarning(state, {casterId: "c4", def: presets.find(it => it.key === "mage-armor"), labels})).toBeNull();
		// Caster options: nobody, active turn, then creatures.
		const options = getCockpitCasterOptions(state, {labels, activeId: "c4"});
		expect(options.slice(0, 2).map(it => it.value)).toEqual(["", "@turn"]);
		expect(getCockpitCasterId("@turn", {activeId: "c4"})).toBe("c4");
		expect(getCockpitCasterId("", {activeId: "c4"})).toBeNull();
	});

	test("the active list groups one effect across targets and names who has it when not everyone does", async () => {
		let state = await pGetCockpitState([["Goblin", 3]]);
		const labels = getCockpitInstanceLabels(state.instances);
		const presets = getEncounterEffectPresets(state);
		state = withEncounterDraft(state, draft => {
			applyEncounterEffect(draft, {targetIds: ["c1", "c2"], def: presets.find(it => it.key === "bless"), rounds: 10});
			applyEncounterEffect(draft, {targetIds: ["c1"], def: presets.find(it => it.key === "half-cover")});
		}).state;
		const active = getCockpitActiveEffects(state, ["c1", "c2"], {labels});
		expect(active.map(it => [it.name, it.entries.length, it.label])).toEqual([
			["Bless", 2, "all"],
			["Half cover", 1, labels.get("c1")],
		]);
		expect(getCockpitIsPresetOnAll(state, ["c1", "c2"], "bless")).toBe(true);
		expect(getCockpitIsPresetOnAll(state, ["c1", "c2", "c3"], "bless")).toBe(false);
	});
});
