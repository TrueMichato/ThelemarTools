import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {withEncounterBattlefieldEntry} from "../../js/encounterworkspace/encounterworkspace-battlefield.js";
import {withEncounterPartyMembers} from "../../js/encounterworkspace/encounterworkspace-party.js";
import {
	PREP_QUICK_EDIT_OPERATION_ID,
	assertPrepRoom,
	clampPrepQuantity,
	getNextPrepTab,
	getPrepAddHp,
	getPrepBattlefieldArgs,
	getPrepCrAssumptions,
	getPrepCrNumber,
	getPrepCurrentEffectRows,
	getPrepKinds,
	getPrepMonsterType,
	getPrepMonsterTypes,
	getPrepQuickEditChange,
	getPrepQuickEditCurrent,
	getPrepQuickEditDiff,
	parsePrepRounds,
	searchPrepBestiary,
	validatePrepManualPc,
	validatePrepQuickEdit,
} from "../../js/encounterworkspace/cockpit/features/prep-model.js";
import {byId, getMmMonster, pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const BESTIARY = [
	"Goblin", "Goblin Boss", "Hobgoblin", "Bugbear", "Owlbear", "Adult Red Dragon", "Young Red Dragon", "Red Dragon Wyrmling", "Bandit", "Bandit Captain",
].map(getMmMonster);

describe("Encounter Cockpit prep — model", () => {
	it("cycles the prep tabs both ways", () => {
		expect(getNextPrepTab("creature", 1)).toBe("fx");
		expect(getNextPrepTab("add", 1)).toBe("creature");
		expect(getNextPrepTab("creature", -1)).toBe("add");
		expect(getNextPrepTab("unknown", 1)).toBe("fx");
	});

	it("ranks bestiary matches exact > prefix > word prefix > substring", () => {
		const names = searchPrepBestiary(BESTIARY, {q: "goblin"}).rows.map(it => it.mon.name);
		expect(names).toEqual(["Goblin", "Goblin Boss", "Hobgoblin"]);
		expect(searchPrepBestiary(BESTIARY, {q: "dragon"}).rows.map(it => it.mon.name)).toEqual(["Adult Red Dragon", "Red Dragon Wyrmling", "Young Red Dragon"]);
		expect(searchPrepBestiary(BESTIARY, {q: "captain"}).rows.map(it => it.mon.name)).toEqual(["Bandit Captain"]);
		// A type query finds creatures whose name doesn't match.
		expect(searchPrepBestiary(BESTIARY, {q: "monstrosity"}).rows.map(it => it.mon.name)).toEqual(["Owlbear"]);
		expect(searchPrepBestiary(BESTIARY, {q: "zzz"}).total).toBe(0);
	});

	it("filters by CR band and type, and limits while keeping the total", () => {
		expect(searchPrepBestiary(BESTIARY, {band: "0-0.5"}).rows.map(it => it.mon.name)).toEqual(["Bandit", "Goblin", "Hobgoblin"]);
		expect(searchPrepBestiary(BESTIARY, {band: "11+"}).rows.map(it => it.mon.name)).toEqual(["Adult Red Dragon"]);
		expect(searchPrepBestiary(BESTIARY, {type: "dragon"}).total).toBe(3);
		// A "choose" type (e.g. celestial or fiend) lists and matches each base type, never the compound.
		const chooser = {name: "Choosy", source: "TST", type: {type: {choose: ["celestial", "fiend"]}}, cr: "1"};
		expect(getPrepMonsterTypes([...BESTIARY, chooser])).toEqual(["celestial", "dragon", "fiend", "humanoid", "monstrosity"]);
		expect(searchPrepBestiary([chooser], {type: "fiend"}).total).toBe(1);
		const limited = searchPrepBestiary(BESTIARY, {limit: 2});
		expect(limited.rows).toHaveLength(2);
		expect(limited.total).toBe(BESTIARY.length);
		expect(getPrepMonsterType(getMmMonster("Goblin"))).toBe("humanoid");
		expect(getPrepCrNumber("1/4")).toBe(0.25);
		expect(getPrepCrNumber("Unknown")).toBeNull();
	});

	it("clamps quantity and picks starting HP (average or rolled)", () => {
		expect([clampPrepQuantity("0"), clampPrepQuantity(3.4), clampPrepQuantity(99), clampPrepQuantity("x")]).toEqual([1, 3, 20, 1]);
		const goblin = getMmMonster("Goblin");
		expect(getPrepAddHp(goblin)).toEqual({current: 7, max: 7, temp: 0});
		expect(getPrepAddHp(goblin, {hpMode: "rolled", fnRoll: formula => formula === "2d6" ? 11 : 0})).toEqual({current: 11, max: 11, temp: 0});
		expect(getPrepAddHp({name: "X", hp: {special: "varies"}})).toEqual({current: null, max: null, temp: 0});
	});

	it("refuses to add past the encounter cap", async () => {
		const state = await pGetCockpitState([["Goblin", 2]]);
		expect(assertPrepRoom(state, 5)).toBe(998);
		expect(() => assertPrepRoom({instances: Array.from({length: 1000}, () => ({}))}, 1)).toThrow(/full/);
	});

	it("lists distinct monster kinds for +1, skipping party members", async () => {
		let state = await pGetCockpitState([["Goblin", 2], ["Bugbear", 1]]);
		state = withEncounterPartyMembers(state, {members: [{name: "Aria", ac: 15, hpMax: 30}], fnUid: () => "pc1"}).state;
		expect(getPrepKinds(state).map(it => [it.name, it.count])).toEqual([["Goblin", 2], ["Bugbear", 1]]);
	});

	it("validates quick-edit numbers; blank fields stay unchanged", () => {
		expect(validatePrepQuickEdit({hpMax: "", ac: "  "})).toEqual({values: {}, errors: {}, isEmpty: true});
		const ok = validatePrepQuickEdit({name: " Grak ", hpMax: "20", ac: "16", speed: "40", initBonus: "+3"});
		expect(ok.values).toEqual({name: "Grak", hpMax: 20, ac: 16, speed: 40, initBonus: 3});
		const bad = validatePrepQuickEdit({hpMax: "0", ac: "1.5", speed: "-5"});
		expect(Object.keys(bad.errors).sort()).toEqual(["ac", "hpMax", "speed"]);
		expect(validatePrepQuickEdit({name: "Solo"}, {isSingle: false}).isEmpty).toBe(true);
	});

	it("applies a quick edit as one statblock patch that repeated edits replace", async () => {
		let state = await pGetCockpitState([["Goblin", 2]]);
		const goblin = byId(state, "c1");
		const current = getPrepQuickEditCurrent(goblin, getEncounterEffectiveMonster(goblin));
		expect(current).toEqual({name: "Goblin", hpMax: 7, ac: 15, speed: 30, initBonus: 2});
		expect(getPrepQuickEditDiff([{id: "c1", label: "Goblin 1", current}], {hpMax: 20, ac: 15}))
			.toEqual([{id: "c1", label: "Goblin 1", changes: [{key: "hpMax", label: "Max HP", before: "7", after: "20"}]}]);

		const apply = values => {
			const instance = byId(state, "c1");
			const change = getPrepQuickEditChange(instance, getEncounterEffectiveMonster(instance), values);
			state = EncounterWorkspaceState.withStatblockChanges(state, [change]).state;
		};
		apply({hpMax: 20, ac: 17});
		apply({speed: 40, initBonus: 5});
		const edited = byId(state, "c1");
		expect(edited.statblockOperations.filter(it => it.id === PREP_QUICK_EDIT_OPERATION_ID)).toHaveLength(1);
		const effective = getEncounterEffectiveMonster(edited);
		expect(getPrepQuickEditCurrent(edited, effective)).toEqual({name: "Goblin", hpMax: 20, ac: 17, speed: 40, initBonus: 5});
		expect(effective.ac[0].from).toEqual(getMmMonster("Goblin").ac[0].from);
		expect(edited.hp).toEqual({current: 20, max: 20, temp: 0});
		// The other goblin is untouched.
		expect(byId(state, "c2").statblockOperations).toEqual([]);
		expect(getPrepQuickEditChange(edited, effective, {})).toBeNull();
	});

	it("validates the manual party member form", () => {
		expect(validatePrepManualPc({name: " ", ac: "14", hp: "30", init: "2", passive: "12"}).error).toMatch(/Name/);
		expect(validatePrepManualPc({name: "Aria", ac: "x", hp: "30", init: "2", passive: "12"}).error).toMatch(/AC/);
		expect(validatePrepManualPc({name: "Aria", ac: "14", hp: "0", init: "2", passive: "12"}).error).toMatch(/HP/);
		expect(validatePrepManualPc({name: "Aria", ac: "14", hp: "30", init: "-1", passive: "12"}).member)
			.toEqual({name: "Aria", speed: 30, ac: 14, hpMax: 30, initBonus: -1, passive: 12});
	});

	it("parses edited durations — blank means until removed", () => {
		expect(parsePrepRounds("")).toEqual({rounds: null});
		expect(parsePrepRounds("∞")).toEqual({rounds: null});
		expect(parsePrepRounds(" 3 ")).toEqual({rounds: 3});
		expect(parsePrepRounds("0").error).toBeTruthy();
		expect(parsePrepRounds("2.5").error).toBeTruthy();
	});

	it("lists the effects and conditions on creatures, with casters", async () => {
		const state = await pGetCockpitState([["Goblin", 2]]);
		byId(state, "c1").effects = [{id: "fx:1", key: "bless", name: "Bless", rounds: 4, casterId: "c2"}];
		byId(state, "c2").conditions = ["Prone"];
		byId(state, "c2").conditionDetails = {Prone: {rounds: null}};
		const labels = new Map([["c1", "Goblin 1"], ["c2", "Goblin 2"]]);
		const rows = getPrepCurrentEffectRows(state, null, {labels});
		expect(rows.map(({kind, name, label, rounds, casterLabel}) => ({kind, name, label, rounds, casterLabel}))).toEqual([
			{kind: "fx", name: "Bless", label: "Goblin 1", rounds: 4, casterLabel: "Goblin 2"},
			{kind: "cond", name: "Prone", label: "Goblin 2", rounds: null, casterLabel: null},
		]);
		expect(getPrepCurrentEffectRows(state, ["c2"], {labels})).toHaveLength(1);
	});

	it("turns the battlefield form into entry args the battlefield reducer accepts", async () => {
		const state = await pGetCockpitState([["Goblin", 2]]);
		expect(getPrepBattlefieldArgs({rule: "custom", scope: "all"}).error).toMatch(/Name/);
		expect(getPrepBattlefieldArgs({rule: "dim-light", scope: "selection"}).error).toMatch(/Select/);
		expect(getPrepBattlefieldArgs({rule: "dim-light", scope: "group"}).error).toMatch(/group/);
		expect(getPrepBattlefieldArgs({rule: "dim-light", scope: "all", rounds: "x"}).error).toMatch(/Rounds/);
		const {args} = getPrepBattlefieldArgs({rule: "dim-light", scope: "selection", rounds: "3", note: " fog "}, {selectedIds: ["c1"]});
		expect(args).toEqual({rule: "dim-light", scope: "selection", ids: ["c1"], rounds: 3, note: "fog", casterId: null});
		const {state: next, entry} = withEncounterBattlefieldEntry(state, args);
		expect(next.battlefield).toHaveLength(1);
		expect(entry.rule).toBe("dim-light");
	});
});

describe("getPrepCrAssumptions", () => {
	test("fills a plain AC the inference skips and applies typed overrides", () => {
		const inferred = {hp: 22, ac: null, damageOverThreeRounds: null, attackType: "attack", attackValue: 4};
		const {values, missing} = getPrepCrAssumptions(inferred, {ac: [13]}, {damageOverThreeRounds: "27", attackValue: " "});
		expect(values).toMatchObject({hp: 22, ac: 13, damageOverThreeRounds: 27, attackValue: 4});
		expect(missing).toEqual([]);
	});

	test("reports what is still missing, naming a save DC for save attacks", () => {
		const {missing} = getPrepCrAssumptions({hp: null, ac: null, damageOverThreeRounds: null, attackType: "save", attackValue: null}, {ac: [{ac: 15}, {ac: 17, condition: "with shield"}]});
		expect(missing.map(it => it.label)).toEqual(["HP", "AC", "damage over 3 rounds", "save DC"]);
	});
});
