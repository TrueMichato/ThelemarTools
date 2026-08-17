import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {
	NpcTrackerSerializer,
	getNpcTrackerVitalsDefaults,
	removeNpcTrackerGroup,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js";
import {
	getNpcTrackerDetailModel,
	getNpcTrackerDeathSaveState,
	getNpcTrackerDisplayName,
	getNpcTrackerProficiencyBonusText,
	getNpcTrackerSignedNumber,
	hasNpcTrackerAttackRoll,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js";
import {getNpcTrackerImportedMonsters} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roster.js";
import {
	getNpcTrackerInitiativeHandoff,
	getNpcTrackerNpcsForScope,
	getNpcTrackerRollBonus,
	getNpcTrackerConditionRollMeta,
	getNpcTrackerRollLabel,
	sortNpcTrackerBatchResults,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {
	getNpcTrackerHpAfterOperation,
	getNpcTrackerHpInputValue,
	getNpcTrackerHpOperation,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-hp.js";
import {
	getNpcTrackerCanonicalConditionName,
	getNpcTrackerConditionHoverMeta,
	getNpcTrackerConditionsAfterUpdate,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {
	getNpcTrackerAttackBonus,
	getNpcTrackerChargeDefaults,
	getNpcTrackerLegendaryActionDefault,
	getNpcTrackerLegendaryResistanceDefault,
	getNpcTrackerRechargeDefaults,
	getNpcTrackerSpellSlotDefaults,
} from "../../js/dmscreen/npctracker/dmscreen-npctracker-resource.js";

const getLegendaryMonster = () => ({
	name: "Ancient Wyrm",
	source: "TST",
	isNpc: false,
	hp: {average: 200, formula: "16d12"},
	str: 23,
	dex: 10,
	con: 21,
	int: 14,
	wis: 13,
	cha: 17,
	cr: "17",
	legendaryActions: 3,
	trait: [{name: "Legendary Resistance (3/Day)", entries: ["If the wyrm fails a save, it can choose to succeed instead."]}],
	action: [
		{name: "Bite", entries: ["{@atk mw} {@hit +11} to hit."]},
		{name: "Fire Breath {@recharge 5}", entries: ["Each creature makes a {@dc 21} save."]},
	],
	legendary: [
		{name: "Detect", entries: ["The wyrm makes a Perception check."]},
		{name: "Tail Attack", entries: ["The wyrm makes a tail attack."]},
	],
});

const getMonster = () => ({
	name: "Court Mage",
	source: "TST",
	isNpc: true,
	hp: {average: 27, formula: "6d8"},
	str: 9,
	dex: 14,
	con: 10,
	int: 17,
	wis: 12,
	cha: 13,
	cr: "5",
	save: {int: "+5"},
	skill: {arcana: "+5", history: "+5"},
	trait: [{name: "Courtier", entries: ["The mage knows court protocol."]}],
	spellcasting: [{name: "Spellcasting", type: "spellcasting", will: ["{@spell mage hand}"]}],
	action: [
		{name: "Dagger", entries: ["{@atk mw} {@hit +4} to hit."]},
		{name: "Command", entries: ["An ally moves."]},
	],
});

describe("NPC Tracker serialization", () => {
	it("round-trips complete snapshots and mutable instance state", () => {
		const monster = getMonster();
		const npc = NpcTrackerSerializer.createNpc({
			monster,
			fluff: {entries: ["A patient adviser."]},
			alias: "Magister Vale",
		});

		npc.hp.current = 11;
		npc.hp.temp = 4;
		npc.groupId = "court";
		npc.conditions = ["poisoned", "prone"];

		const saved = NpcTrackerSerializer.serialize({
			version: 2,
			settings: {selectedId: npc.id, isIncludeAllCreatures: true, isUnsortedCollapsed: true},
			groups: [{id: "court", name: "Town Council", isCollapsed: true}],
			npcs: [npc],
		});
		const restored = NpcTrackerSerializer.deserialize(saved);

		expect(saved.v).toBe(5);
		expect(restored.settings).toEqual({
			selectedId: npc.id,
			isIncludeAllCreatures: true,
			isUnsortedCollapsed: true,
			textSize: "normal",
		});
		expect(restored.groups).toEqual([{id: "court", name: "Town Council", isCollapsed: true}]);
		expect(restored.npcs[0]).toMatchObject({
			id: npc.id,
			alias: "Magister Vale",
			groupId: "court",
			hp: {current: 11, max: 27, temp: 4},
			conditions: ["poisoned", "prone"],
			monster,
			fluff: {entries: ["A patient adviser."]},
		});
	});

	it("keeps duplicate creatures independent and repairs invalid selection", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster()});
		first.hp.current = 2;

		const restored = NpcTrackerSerializer.deserialize({
			s: {sel: "missing"},
			n: [
				NpcTrackerSerializer.serialize({settings: {selectedId: first.id}, npcs: [first]}).n[0],
				NpcTrackerSerializer.serialize({settings: {selectedId: second.id}, npcs: [second]}).n[0],
			],
		});

		expect(first.id).not.toBe(second.id);
		expect(restored.npcs.map(it => it.hp.current)).toEqual([2, 27]);
		expect(restored.settings.selectedId).toBe(first.id);
	});

	it("defaults malformed or empty state safely", () => {
		expect(NpcTrackerSerializer.deserialize(null)).toEqual(NpcTrackerSerializer.getDefaultState());
		expect(NpcTrackerSerializer.deserialize({n: [{mon: {name: "Missing source"}}]}).npcs).toEqual([]);
	});

	it("migrates version 1 saves into Unsorted without losing NPC state", () => {
		const restored = NpcTrackerSerializer.deserialize({
			v: 1,
			s: {sel: "legacy", all: true},
			n: [{
				id: "legacy",
				a: "Legacy Mage",
				hp: {c: 9, m: 27, t: 2},
				mon: getMonster(),
				fluff: {entries: ["Preserved lore."]},
			}],
		});

		expect(restored.groups).toEqual([]);
		expect(restored.settings).toEqual({
			selectedId: "legacy",
			isIncludeAllCreatures: true,
			isUnsortedCollapsed: false,
			textSize: "normal",
		});
		expect(restored.npcs[0]).toMatchObject({
			id: "legacy",
			alias: "Legacy Mage",
			groupId: null,
			hp: {current: 9, max: 27, temp: 2},
			conditions: [],
			spellSlots: {},
			charges: [],
			fluff: {entries: ["Preserved lore."]},
		});
	});

	it("migrates version 2 saves with default-safe live-play fields", () => {
		const restored = NpcTrackerSerializer.deserialize({
			v: 2,
			g: [{id: "court", n: "Town Council"}],
			n: [{
				id: "legacy-v2",
				g: "court",
				hp: {c: 12, m: 27, t: 0},
				mon: getMonster(),
			}],
		});

		expect(restored.version).toBe(5);
		expect(restored.npcs[0]).toMatchObject({
			id: "legacy-v2",
			groupId: "court",
			conditions: [],
			spellSlots: {},
			charges: [],
		});
	});

	it("repairs dangling memberships and removes groups without deleting NPCs", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster(), alias: "First"});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster(), alias: "Second"});
		first.groupId = "valid";
		second.groupId = "missing";
		const state = NpcTrackerSerializer.deserialize({
			groups: [{id: "valid", name: "Council"}],
			npcs: [first, second],
		});

		expect(state.npcs.map(npc => npc.groupId)).toEqual(["valid", null]);
		expect(removeNpcTrackerGroup({state, groupId: "valid"})).toBe(true);
		expect(state.groups).toEqual([]);
		expect(state.npcs).toHaveLength(2);
		expect(state.npcs.map(npc => npc.groupId)).toEqual([null, null]);
	});

	it("keeps duplicate monster instances independently assignable", () => {
		const first = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const second = NpcTrackerSerializer.createNpc({monster: getMonster()});
		first.groupId = "a";
		second.groupId = "b";
		const restored = NpcTrackerSerializer.deserialize({
			g: [{id: "a", n: "A"}, {id: "b", n: "B"}],
			n: [
				NpcTrackerSerializer.serialize({groups: [{id: "a", name: "A"}], npcs: [first]}).n[0],
				NpcTrackerSerializer.serialize({groups: [{id: "b", name: "B"}], npcs: [second]}).n[0],
			],
		});

		expect(restored.npcs.map(npc => npc.groupId)).toEqual(["a", "b"]);
		expect(restored.npcs[0].id).not.toBe(restored.npcs[1].id);
	});
});

describe("NPC Tracker conditions", () => {
	it("normalizes standard and homebrew condition names and deduplicates updates", () => {
		expect(getNpcTrackerCanonicalConditionName(" Poisoned ")).toBe("poisoned");
		expect(getNpcTrackerCanonicalConditionName("custom")).toBe("custom");
		expect(getNpcTrackerConditionsAfterUpdate({
			conditions: ["poisoned", "poisoned", "custom"],
			condition: "prone",
			isAdd: true,
		})).toEqual(["poisoned", "custom", "prone"]);
		expect(getNpcTrackerConditionsAfterUpdate({
			conditions: ["poisoned", "prone"],
			condition: "poisoned",
			isAdd: false,
		})).toEqual(["prone"]);
	});

	it("preserves normalized homebrew conditions while dropping empty values", () => {
		const restored = NpcTrackerSerializer.deserialize({
			v: 3,
			n: [{
				id: "conditioned",
				c: ["Poisoned", "poisoned", "made-up", null],
				mon: getMonster(),
			}],
		});

		expect(restored.npcs[0].conditions).toEqual(["poisoned", "made-up"]);
	});

	it("builds hover metadata for site and homebrew catalog conditions only", () => {
		const conditionCatalog = [
			{name: "poisoned", label: "Poisoned", source: "XPHB"},
			{name: "dreambound", label: "Dreambound", source: "HB"},
		];
		expect(getNpcTrackerConditionHoverMeta("Poisoned", {conditionCatalog})).toMatchObject({
			page: UrlUtil.PG_CONDITIONS_DISEASES,
			source: "XPHB",
			hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CONDITIONS_DISEASES]({
				name: "Poisoned",
				source: "XPHB",
			}),
		});
		expect(getNpcTrackerConditionHoverMeta("dreambound", {conditionCatalog})).toMatchObject({source: "HB"});
		expect(getNpcTrackerConditionHoverMeta("custom", {conditionCatalog})).toBeNull();
	});
});

describe("NPC Tracker HP input", () => {
	it("rejects blank and non-numeric values instead of coercing them to zero", () => {
		expect(getNpcTrackerHpInputValue("")).toBeNull();
		expect(getNpcTrackerHpInputValue("   ")).toBeNull();
		expect(getNpcTrackerHpInputValue("not a number")).toBeNull();
		expect(getNpcTrackerHpInputValue("0")).toBe(0);
		expect(getNpcTrackerHpInputValue("-3")).toBe(0);
		expect(getNpcTrackerHpInputValue("12")).toBe(12);
	});

	it("parses damage, healing, set, dice, and half operations", () => {
		expect(getNpcTrackerHpOperation({raw: "12"})).toEqual({ok: true, operation: {mode: "delta", value: -12}});
		expect(getNpcTrackerHpOperation({raw: "+6"})).toEqual({ok: true, operation: {mode: "delta", value: 6}});
		expect(getNpcTrackerHpOperation({raw: "=15"})).toEqual({ok: true, operation: {mode: "set", value: 15}});
		expect(getNpcTrackerHpOperation({raw: "7", isHalf: true})).toEqual({ok: true, operation: {mode: "delta", value: -3}});
		expect(getNpcTrackerHpOperation({raw: "1d1"})).toEqual({ok: true, operation: {mode: "delta", value: -1}});
		expect(getNpcTrackerHpOperation({raw: ""}).ok).toBe(false);
	});

	it("consumes temporary HP before current HP and caps healing at max", () => {
		expect(getNpcTrackerHpAfterOperation({
			hp: {current: 20, max: 30, temp: 5},
			operation: {mode: "delta", value: -8},
		})).toEqual({current: 17, max: 30, temp: 0});
		expect(getNpcTrackerHpAfterOperation({
			hp: {current: 27, max: 30, temp: 2},
			operation: {mode: "delta", value: 8},
		})).toEqual({current: 30, max: 30, temp: 2});
		expect(getNpcTrackerHpAfterOperation({
			hp: {current: 27, max: 30, temp: 2},
			operation: {mode: "set", value: 4},
		})).toEqual({current: 4, max: 30, temp: 2});
	});
});

describe("NPC Tracker batch rolls", () => {
	it("resolves initiative, abilities, saves, and skills with correct fallbacks", () => {
		const rendererOriginal = globalThis.Renderer;
		globalThis.Renderer = {monster: {getInitiativeBonusNumber: () => 7}};
		const npc = {
			monster: {
				...getMonster(),
				dex: 14,
				wis: 12,
				save: {dex: "+6"},
				skill: {perception: "+4"},
			},
		};

		try {
			expect(getNpcTrackerRollBonus({npc, rollType: "initiative"})).toBe(7);
			expect(getNpcTrackerRollBonus({npc, rollType: "ability", key: "dex"})).toBe(2);
			expect(getNpcTrackerRollBonus({npc, rollType: "save", key: "dex"})).toBe(6);
			expect(getNpcTrackerRollBonus({npc, rollType: "save", key: "wis"})).toBe(1);
			expect(getNpcTrackerRollBonus({npc, rollType: "skill", key: "perception"})).toBe(4);
			expect(getNpcTrackerRollBonus({npc, rollType: "skill", key: "insight"})).toBe(1);
			expect(getNpcTrackerRollLabel({rollType: "save", key: "dex"})).toBe("Dexterity save");
		} finally {
			globalThis.Renderer = rendererOriginal;
		}
	});

	it("resolves all, named-group, and Unsorted scopes in roster order", () => {
		const state = {
			npcs: [
				{id: "a", groupId: "g"},
				{id: "b", groupId: null},
				{id: "c", groupId: "g"},
			],
		};

		expect(getNpcTrackerNpcsForScope({state, scope: {type: "all"}}).map(npc => npc.id)).toEqual(["a", "b", "c"]);
		expect(getNpcTrackerNpcsForScope({state, scope: {type: "group", groupId: "g"}}).map(npc => npc.id)).toEqual(["a", "c"]);
		expect(getNpcTrackerNpcsForScope({state, scope: {type: "unsorted"}}).map(npc => npc.id)).toEqual(["b"]);
	});

	it("sorts initiative totals descending with stable roster-order ties", () => {
		const results = [
			{name: "Bravo", total: 15, order: 1},
			{name: "Alpha", total: 18, order: 0},
			{name: "Charlie", total: 15, order: 2},
		];

		expect(sortNpcTrackerBatchResults({
			results,
			sortKey: "total",
			sortDirection: "desc",
		}).map(it => it.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
		expect(sortNpcTrackerBatchResults({
			results,
			sortKey: "order",
			sortDirection: "asc",
		}).map(it => it.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
	});

	it("applies condition roll effects and cancels advantage against disadvantage", () => {
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["poisoned"]},
			rollType: "skill",
			key: "stealth",
		})).toMatchObject({mode: "disadvantage", reasons: ["Poisoned"]});
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["restrained"]},
			rollType: "save",
			key: "dex",
		})).toMatchObject({mode: "disadvantage"});
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["stunned"]},
			rollType: "save",
			key: "str",
		})).toMatchObject({mode: "autoFail"});
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["invisible", "poisoned"]},
			rollType: "attack",
		})).toMatchObject({mode: "normal"});
		expect(getNpcTrackerConditionRollMeta({
			npc: {conditions: ["dreambound"]},
			rollType: "attack",
		})).toEqual({mode: "normal", reasons: [], statusText: ""});
	});

	it("builds complete initiative handoffs and blocks incomplete batches", () => {
		const state = {
			npcs: [
				{...NpcTrackerSerializer.createNpc({monster: getMonster(), alias: "Vale"}), id: "a"},
				{...NpcTrackerSerializer.createNpc({monster: getMonster()}), id: "b"},
			],
		};
		const batch = {
			scope: {type: "all"},
			rollType: "initiative",
			isRolling: false,
			selectedNpcIds: new Set(["a", "b"]),
			results: [{npcId: "a", total: 18}, {npcId: "b", total: 12}],
		};

		const complete = getNpcTrackerInitiativeHandoff({state, batch});
		expect(complete.ok).toBe(true);
		expect(complete.entries).toMatchObject([
			{npcId: "a", alias: "Vale", initiative: 18, conditions: []},
			{npcId: "b", initiative: 12, conditions: []},
		]);

		batch.results.pop();
		expect(getNpcTrackerInitiativeHandoff({state, batch})).toEqual({
			ok: false,
			message: "Roll initiative for every selected NPC before sending it.",
		});
	});
});

describe("NPC Tracker detail model", () => {
	it("selects roleplay, spellcasting, lore, and attack-roll content", () => {
		const model = getNpcTrackerDetailModel(getMonster(), {fluff: {entries: ["A patient adviser."]}});

		expect(model.abilities).toHaveLength(6);
		expect(model.saves).toEqual([{ability: "int", bonus: "+5"}]);
		expect(model.skills).toHaveLength(2);
		expect(model.traits[0].name).toBe("Courtier");
		expect(model.spellcasting[0].name).toBe("Spellcasting");
		expect(model.attacks.map(it => it.name)).toEqual(["Dagger"]);
		expect(model.fluffEntries).toEqual(["A patient adviser."]);
		expect(getNpcTrackerProficiencyBonusText(getMonster())).toBe("+3");
	});

	it("orders Special Equipment first and prefers an explicit PB note", () => {
		const monster = {
			...getMonster(),
			pbNote: "equals its summoner's",
			trait: [
				{name: "Courtier", entries: ["Court protocol."]},
				{name: "SPECIAL EQUIPMENT", entries: ["A charged wand."]},
			],
		};
		expect(getNpcTrackerDetailModel(monster).traits.map(it => it.name)).toEqual(["SPECIAL EQUIPMENT", "Courtier"]);
		expect(getNpcTrackerProficiencyBonusText(monster)).toBe("equals its summoner's");
	});

	it("recognizes attacks and formats roll/display labels", () => {
		expect(hasNpcTrackerAttackRoll({entries: ["{@atk rs} {@hit +7}"]})).toBe(true);
		expect(hasNpcTrackerAttackRoll({entries: ["The NPC speaks."]})).toBe(false);
		expect(getNpcTrackerSignedNumber("+5")).toBe("+5");
		expect(getNpcTrackerSignedNumber(-2)).toBe("-2");
		expect(getNpcTrackerDisplayName({alias: "Vale", monster: {name: "Mage"}})).toBe("Vale");
	});
});

describe("NPC Tracker resources", () => {
	it("derives spell slots and charged Special Equipment", () => {
		const monster = {
			...getMonster(),
			spellcasting: [{
				name: "Spellcasting",
				spells: {
					"0": {spells: ["{@spell light}"]},
					"1": {slots: 4, spells: ["{@spell shield}"]},
					"2": {slots: 2, spells: ["{@spell misty step}"]},
				},
			}],
			trait: [{
				name: "Special Equipment",
				entries: ["The moon wand has 7 charges. It regains charges at dawn."],
			}],
		};
		expect(getNpcTrackerSpellSlotDefaults(monster)).toEqual({
			"1": {current: 4, max: 4},
			"2": {current: 2, max: 2},
		});
		expect(getNpcTrackerChargeDefaults(monster)).toEqual([
			expect.objectContaining({name: "Moon Wand", current: 7, max: 7, isAuto: true}),
		]);
	});

	it("round-trips spent slots, charge trackers, and large text", () => {
		const monster = {
			...getMonster(),
			spellcasting: [{spells: {"1": {slots: 3, spells: ["{@spell shield}"]}}}],
		};
		const npc = NpcTrackerSerializer.createNpc({monster});
		npc.spellSlots["1"].current = 1;
		npc.charges.push({id: "wand", name: "Wand", current: 2, max: 5, isAuto: false});
		const restored = NpcTrackerSerializer.deserialize(NpcTrackerSerializer.serialize({
			settings: {selectedId: npc.id, textSize: "large"},
			npcs: [npc],
		}));
		expect(restored.settings.textSize).toBe("large");
		expect(restored.npcs[0].spellSlots).toEqual({"1": {current: 1, max: 3}});
		expect(restored.npcs[0].charges).toContainEqual({
			id: "wand",
			name: "Wand",
			current: 2,
			max: 5,
			isAuto: false,
		});
	});

	it("extracts attack bonuses without inventing missing rolls", () => {
		expect(getNpcTrackerAttackBonus({entries: ["{@atk mw} {@hit +6} to hit."]})).toBe(6);
		expect(getNpcTrackerAttackBonus({entries: ["The target must save."]})).toBeNull();
	});
});

describe("NPC Tracker text size", () => {
	it("accepts all four tiers and coerces legacy/invalid values", () => {
		const load = ts => NpcTrackerSerializer.deserialize({s: {ts}}).settings.textSize;
		expect(load("normal")).toBe("normal");
		expect(load("large")).toBe("large");
		expect(load("x-large")).toBe("x-large");
		expect(load("xx-large")).toBe("xx-large");
		expect(load("gigantic")).toBe("normal");
		expect(load(undefined)).toBe("normal");
	});

	it("round-trips a new tier via the compressed key", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const saved = NpcTrackerSerializer.serialize({settings: {selectedId: npc.id, textSize: "xx-large"}, npcs: [npc]});
		expect(saved.s.ts).toBe("xx-large");
		expect(NpcTrackerSerializer.deserialize(saved).settings.textSize).toBe("xx-large");
	});
});

describe("NPC Tracker vitals auto-detection", () => {
	it("parses legendary resistance count from the trait", () => {
		expect(getNpcTrackerLegendaryResistanceDefault(getLegendaryMonster())).toEqual({current: 3, max: 3});
		expect(getNpcTrackerLegendaryResistanceDefault(getMonster())).toBeNull();
	});

	it("defaults legendary actions to 3 and honors explicit counts", () => {
		expect(getNpcTrackerLegendaryActionDefault(getLegendaryMonster())).toEqual({current: 3, max: 3});
		expect(getNpcTrackerLegendaryActionDefault({legendary: [{name: "Move"}], legendaryActions: 5})).toEqual({current: 5, max: 5});
		expect(getNpcTrackerLegendaryActionDefault({legendary: [{name: "Move"}]})).toEqual({current: 3, max: 3});
		expect(getNpcTrackerLegendaryActionDefault(getMonster())).toBeNull();
	});

	it("detects recharge abilities and their thresholds", () => {
		const recharges = getNpcTrackerRechargeDefaults(getLegendaryMonster());
		expect(recharges).toHaveLength(1);
		expect(recharges[0]).toMatchObject({name: "Fire Breath", min: 5, isReady: true});

		const bare = getNpcTrackerRechargeDefaults({action: [{name: "Web {@recharge}", entries: ["Restrains."]}]});
		expect(bare[0]).toMatchObject({name: "Web", min: 6});

		expect(getNpcTrackerRechargeDefaults(getMonster())).toEqual([]);
	});
});

describe("NPC Tracker vitals serialization", () => {
	it("derives full vitals from a legendary monster on creation", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getLegendaryMonster()});
		expect(npc.vitals.deathSaves).toEqual({successes: 0, failures: 0});
		expect(npc.vitals.legendaryResistances).toEqual({current: 3, max: 3});
		expect(npc.vitals.legendaryActions).toEqual({current: 3, max: 3});
		expect(npc.vitals.recharges).toHaveLength(1);
		expect(npc.vitals.concentration).toBe("");
		expect(npc.reactionUsed).toBe(false);
	});

	it("round-trips mutated vitals and clamps out-of-range values", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getLegendaryMonster()});
		npc.vitals.deathSaves = {successes: 2, failures: 9};
		npc.vitals.legendaryResistances.current = 1;
		npc.vitals.legendaryActions.current = 2;
		npc.vitals.recharges[0].isReady = false;
		npc.vitals.concentration = "Hold Person";

		const saved = NpcTrackerSerializer.serialize({settings: {selectedId: npc.id}, npcs: [npc]});
		expect(saved.n[0].vi).toMatchObject({ds: {s: 2, f: 3}, lr: {c: 1, m: 3}, la: {c: 2, m: 3}, co: "Hold Person"});
		expect(saved.n[0].vi.rc[0]).toMatchObject({n: "Fire Breath", mn: 5, r: false});

		const restored = NpcTrackerSerializer.deserialize(saved).npcs[0];
		expect(restored.vitals.deathSaves).toEqual({successes: 2, failures: 3});
		expect(restored.vitals.legendaryResistances).toEqual({current: 1, max: 3});
		expect(restored.vitals.recharges[0].isReady).toBe(false);
		expect(restored.vitals.concentration).toBe("Hold Person");
		expect(restored.reactionUsed).toBe(false);
	});

	it("omits absent counters and recharges from the compressed payload", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getMonster()});
		const saved = NpcTrackerSerializer.serialize({settings: {selectedId: npc.id}, npcs: [npc]});
		expect(saved.n[0].vi.lr).toBeUndefined();
		expect(saved.n[0].vi.la).toBeUndefined();
		expect(saved.n[0].vi.rc).toBeUndefined();
	});

	it("does not persist the session-only reaction flag", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getMonster()});
		npc.reactionUsed = true;
		const saved = NpcTrackerSerializer.serialize({settings: {selectedId: npc.id}, npcs: [npc]});
		expect(JSON.stringify(saved.n[0])).not.toContain("reactionUsed");
		expect(NpcTrackerSerializer.deserialize(saved).npcs[0].reactionUsed).toBe(false);
	});

	it("derives vitals from the monster snapshot for legacy v4 saves without a vi key", () => {
		const legacy = {
			v: 4,
			s: {sel: "legacy-v4"},
			n: [{
				id: "legacy-v4",
				hp: {c: 200, m: 200, t: 0},
				mon: getLegendaryMonster(),
			}],
		};
		const restored = NpcTrackerSerializer.deserialize(legacy).npcs[0];
		expect(restored.vitals).toEqual(getNpcTrackerVitalsDefaults(getLegendaryMonster()));
		expect(restored.vitals.legendaryResistances).toEqual({current: 3, max: 3});
		expect(restored.vitals.recharges[0]).toMatchObject({name: "Fire Breath", min: 5, isReady: true});
	});

	it("keeps named manual recharges but drops unresolvable saved entries", () => {
		const npc = NpcTrackerSerializer.createNpc({monster: getLegendaryMonster()});
		const saved = NpcTrackerSerializer.serialize({settings: {selectedId: npc.id}, npcs: [npc]});
		saved.n[0].vi.rc.push({id: "manual", n: "Custom Ability", mn: 6, r: false});
		saved.n[0].vi.rc.push({id: "", n: "", mn: 6, r: true});
		const restored = NpcTrackerSerializer.deserialize(saved).npcs[0];
		expect(restored.vitals.recharges.map(it => it.name)).toEqual(["Fire Breath", "Custom Ability"]);
	});
});

describe("NPC Tracker death saves", () => {
	it("derives stabilize and dead states at three marks", () => {
		expect(getNpcTrackerDeathSaveState({successes: 0, failures: 0})).toMatchObject({isStable: false, isDead: false});
		expect(getNpcTrackerDeathSaveState({successes: 2, failures: 1})).toMatchObject({isStable: false, isDead: false});
		expect(getNpcTrackerDeathSaveState({successes: 3, failures: 1})).toMatchObject({isStable: true, isDead: false});
		expect(getNpcTrackerDeathSaveState({successes: 1, failures: 3})).toMatchObject({isStable: false, isDead: true});
	});

	it("clamps out-of-range and non-numeric marks", () => {
		expect(getNpcTrackerDeathSaveState({successes: 9, failures: -2})).toMatchObject({successes: 3, failures: 0});
		expect(getNpcTrackerDeathSaveState(undefined)).toMatchObject({successes: 0, failures: 0, isStable: false, isDead: false});
	});
});

describe("NPC Tracker JSON import", () => {
	it("accepts direct monsters and bestiary wrappers", () => {
		expect(getNpcTrackerImportedMonsters(getMonster())).toHaveLength(1);
		expect(getNpcTrackerImportedMonsters(JSON.stringify({monster: [getMonster(), getMonster()]}))).toHaveLength(2);
	});

	it("rejects invalid payloads with actionable errors", () => {
		expect(() => getNpcTrackerImportedMonsters("{}")).toThrow("does not contain");
		expect(() => getNpcTrackerImportedMonsters({monster: [{name: "No Source"}]})).toThrow("name and source");
	});
});
