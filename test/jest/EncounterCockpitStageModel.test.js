import {getEncounterDerived} from "../../js/encounterworkspace/encounterworkspace-derived.js";
import {applyEncounterEffect, withEncounterDraft} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {applyEncounterCondition} from "../../js/encounterworkspace/encounterworkspace-conditions-rules.js";
import {ENCOUNTER_ZERO_HP_SOURCE} from "../../js/encounterworkspace/encounterworkspace-deathsaves.js";
import {withEncounterBattlefieldEntry} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {
	getCockpitDcAbility,
	getCockpitHeldBy,
	getCockpitIsSpellDc,
	getCockpitReminders,
	getCockpitRollChange,
	getCockpitRollChipKind,
	getCockpitStageDeltaText,
	getCockpitStageDeltas,
	getCockpitStatblockTags,
	withCockpitRevived,
} from "../../js/encounterworkspace/cockpit/stage-model.js";
import {getCockpitInstance as get, getCockpitUid, pGetCockpitState} from "./helpers/encounter-cockpit-fixtures.js";

const fnUid = getCockpitUid("s");
const effect = (state, targetIds, def, opts = {}) => withEncounterDraft(state, draft => applyEncounterEffect(draft, {targetIds, def, fnUid, ...opts})).state;

describe("Encounter cockpit stage model", () => {
	it("styles statblock dice links by what they roll", () => {
		const kind = (type, subType) => getCockpitRollChipKind({toRoll: "1d20+4", subType, context: type ? {type} : undefined});
		expect(kind("hit")).toBe("hit");
		expect(kind("savingThrow")).toBe("save");
		expect(kind("skillCheck")).toBe("skill");
		expect(kind("abilityCheck")).toBe("skill");
		expect(kind("initiative")).toBe("init");
		expect(kind(null, "damage")).toBe("dmg");
		expect(kind(null)).toBe("dice");
	});

	describe("effect-modified numbers", () => {
		it("leaves an untouched bonus alone", () => {
			expect(getCockpitRollChange({base: 4, summary: {flat: 0, dice: [], mode: null}})).toEqual({text: "+4", isChanged: false, title: null, marks: []});
		});

		it("shows Bless as a +1d4 mark with base → modified in the title", async () => {
			const state = effect(await pGetCockpitState(), ["encounter-1"], "bless");
			const derived = getEncounterDerived(state, get(state, "encounter-1"));
			const out = getCockpitRollChange({base: 4, summary: derived.attack, label: "to hit"});
			expect(out.isChanged).toBe(true);
			expect(out.text).toBe("+4");
			expect(out.marks).toEqual([{cls: "is-plus", text: "+1d4", title: "+1d4 to the roll"}]);
			expect(out.title).toMatch(/^Roll to hit — base \+4 → \+4 \+1d4/);
			expect(out.title).toContain("Bless");
		});

		it("adds flat bonuses to the number and flags disadvantage and auto-fail", () => {
			const out = getCockpitRollChange({
				base: -1,
				label: "Strength save",
				summary: {flat: 2, dice: [], mode: "dis", disadvantage: [{label: "Poisoned"}], autoFail: [{label: "Paralyzed"}], bonuses: [{label: "Elite", value: 2}]},
			});
			expect(out.text).toBe("+1");
			expect(out.marks.map(it => it.cls)).toEqual(["is-fail", "is-dis"]);
			expect(out.title).toBe("Roll Strength save — base -1 → +1 (Elite +2; Automatically fails (Paralyzed); Disadvantage (Poisoned))");
		});
	});

	describe("DC chips", () => {
		it("finds the save ability after the DC (2014) or before it (2024)", () => {
			expect(getCockpitDcAbility(" Dexterity saving throw, taking 54 (12d8) acid damage")).toBe("dex");
			expect(getCockpitDcAbility(" Wisdom saving throw or become frightened")).toBe("wis");
			expect(getCockpitDcAbility(", range 120 ft.", "Necrotic Ray. Constitution Saving Throw: ")).toBe("con");
			expect(getCockpitDcAbility(". Strength checks are made at disadvantage")).toBeNull();
			expect(getCockpitDcAbility(" (escape)", "grappled")).toBeNull();
		});

		it("recognises spell save DCs in both statblock styles", () => {
			// The text before the chip, as rendered: "(spell save {@dc 14}" and "spell save DC is {@dc 17}" both end in "DC ".
			expect(getCockpitIsSpellDc("using Intelligence as the spellcasting ability (spell save DC ")).toBe(true);
			expect(getCockpitIsSpellDc("Intelligence (spell save DC is DC ")).toBe(true);
			expect(getCockpitIsSpellDc("Intelligence (spell save ")).toBe(true);
			expect(getCockpitIsSpellDc("must make a DC ")).toBe(false);
		});
	});

	describe("active-effects delta line", () => {
		it("folds a bonus every save shares into one entry", async () => {
			const state = effect(await pGetCockpitState(), ["encounter-1"], "bless");
			const deltas = getCockpitStageDeltas(getEncounterDerived(state, get(state, "encounter-1")));
			expect(getCockpitStageDeltaText(deltas)).toBe("attacks +1d4 · all saves +1d4");
		});

		it("shows AC base → modified and per-save entries when saves differ", async () => {
			let state = effect(await pGetCockpitState(), ["encounter-1"], "shield-of-faith");
			state = withEncounterDraft(state, draft => applyEncounterCondition(draft, {targetIds: ["encounter-1"], condition: "paralyzed"})).state;
			const text = getCockpitStageDeltaText(getCockpitStageDeltas(getEncounterDerived(state, get(state, "encounter-1"))));
			expect(text).toContain("AC 15 → 17");
			expect(text).toContain("STR save ✗ auto");
			expect(text).toContain("DEX save ✗ auto");
			expect(text).not.toContain("all saves");
			expect(text).not.toContain("WIS save");
		});

		it("is empty for an unaffected creature", async () => {
			const state = await pGetCockpitState();
			expect(getCockpitStageDeltas(getEncounterDerived(state, get(state, "encounter-1")))).toEqual([]);
		});
	});

	it("lists effects held up by another creature's concentration", async () => {
		const state = effect(await pGetCockpitState(), ["encounter-1", "pc-1"], "bless", {casterId: "pc-1"});
		expect(getCockpitHeldBy(get(state, "encounter-1"))).toEqual([{effectId: expect.any(String), casterId: "pc-1", label: "Bless"}]);
		expect(getCockpitHeldBy(get(state, "pc-1"))).toEqual([]); // the caster's own Bless is not "held by" anyone else
		expect(getCockpitHeldBy(get(effect(await pGetCockpitState(), ["encounter-1"], "bless"), "encounter-1"))).toEqual([]);
	});

	it("tags templates, items, transformations and other edits", () => {
		const instance = {
			templates: [{name: "Elite", operationIds: ["op-1"]}],
			statblockOperations: [
				{id: "op-1", type: "setProp"},
				{id: "op-2", type: "applyItem", data: {item: {name: "Cloak of Protection"}}},
				{id: "op-3", type: "applyCreatureTransformation", data: {resolved: {identity: {name: "Brown Bear"}}}},
				{id: "op-4", type: "setProp"},
				{id: "op-5", type: "setProp"},
			],
		};
		expect(getCockpitStatblockTags(instance)).toEqual([
			{kind: "tpl", text: "⟳ Elite", title: "Template: Elite"},
			{kind: "item", text: "✦ Cloak of Protection", title: "Item applied: Cloak of Protection"},
			{kind: "transformed", text: "⟳ transformed", title: "Transformed: Brown Bear"},
			{kind: "edited", text: "✎ edited", title: "2 statblock edits"},
		]);
		expect(getCockpitStatblockTags({statblockOperations: []})).toEqual([]);
	});

	it("collects lair and reminder entries that reach the creature, not battlefield effects", async () => {
		let state = await pGetCockpitState();
		state = withEncounterBattlefieldEntry(state, {rule: "lair-actions", note: "Roll on the lair table"}).state;
		state = withEncounterBattlefieldEntry(state, {rule: "custom", name: "Collapsing ceiling", scope: "selection", ids: ["pc-1"], rounds: 2}).state;
		state = withEncounterBattlefieldEntry(state, {rule: "desecrated-dmg"}).state;
		expect(getCockpitReminders(state, get(state, "encounter-1"))).toEqual([{id: expect.any(String), name: "Lair actions", note: "Roll on the lair table", rounds: null}]);
		expect(getCockpitReminders(state, get(state, "pc-1")).map(it => [it.name, it.rounds])).toEqual([["Lair actions", null], ["Collapsing ceiling", 2]]);
	});

	describe("Revive", () => {
		it("brings a defeated creature back at 1 HP and clears the 0 HP Unconscious", async () => {
			const out = withEncounterDraft(await pGetCockpitState(), (draft, {log}) => {
				const goblin = get(draft, "encounter-1");
				goblin.hp = {...goblin.hp, current: 0};
				goblin.defeated = true;
				applyEncounterCondition(draft, {targetIds: ["encounter-1"], condition: "unconscious", source: ENCOUNTER_ZERO_HP_SOURCE});
				return withCockpitRevived(draft, "encounter-1", {log, name: "Goblin 1"});
			});
			const goblin = get(out.state, "encounter-1");
			expect(out.result).toBe(true);
			expect(goblin).toMatchObject({defeated: false, deathSaves: null, hp: {current: 1}});
			expect(goblin.conditions).not.toContain("unconscious");
			expect(goblin.conditions).toContain("prone"); // standing up still costs movement
			expect(out.logs.map(it => it[1])).toContain("Goblin 1 is back in the fight.");
		});

		it("does nothing to a creature that is up", async () => {
			const out = withEncounterDraft(await pGetCockpitState(), draft => withCockpitRevived(draft, "encounter-1"));
			expect(out.result).toBe(false);
		});
	});
});
