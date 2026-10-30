import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetCompanionRules as Rules} from "../../../js/charactersheet/charactersheet-companion-rules.js";

const descendants = node => (node._children || []).flatMap(child => typeof child === "string" ? [] : [child, ...descendants(child)]);
const baseElement = globalThis.e_;
globalThis.e_ = (options = {}) => {
	const node = baseElement(options);
	node.className = options.clazz || "";
	node.attrs = {...options.attrs};
	node.type = options.type;
	node.setAttribute = (key, value) => { node.attrs[key] = value; };
	node.getAttribute = key => node.attrs[key];
	node.focus = () => { document.activeElement = node; };
	node.querySelectorAll = selector => descendants(node).filter(child => selector.split(",").some(part => {
		part = part.trim();
		return part.startsWith(".") ? child.className.split(" ").includes(part.slice(1)) : child.tag === part;
	}));
	node.querySelector = selector => {
		if (selector === ".charsheet__dice-result-close" && options.outer?.includes("charsheet__dice-result-close")) {
			node.close ||= globalThis.e_({tag: "button"});
			return node.close;
		}
		return node.querySelectorAll(selector)[0] || null;
	};
	node.click = event => node.disabled ? undefined : node._handlers.click?.({currentTarget: node, ...event});
	node.change = () => node._handlers.change?.({currentTarget: node});
	return node;
};
globalThis.window = {addEventListener () {}};
await import("../../../js/render-dice.js");
await import("../../../js/charactersheet/charactersheet.js");
await import("../../../js/charactersheet/charactersheet-companion-actor.js");
const {CharacterSheetRollHistory: History} = await import("../../../js/charactersheet/charactersheet-rollhistory.js");
const State = globalThis.CharacterSheetState;
const Page = globalThis.CharacterSheetPage;
const copy = value => JSON.parse(JSON.stringify(value));
RollerUtil.randomise ||= sides => Math.floor(Math.random() * sides) + 1;
Array.prototype.sum ||= function () { return this.reduce((sum, value) => sum + value, 0); };

function fixture (data = {}) {
	const owner = new State();
	owner.setId("owner");
	owner.setName("Original");
	owner.setAbilityBase("dex", 20);
	owner.addClass({name: "Wizard", source: "PHB", level: 7});
	const id = owner.addCompanion({
		name: "Moss",
		abilities: {dex: 12, wis: 8},
		profBonus: 2,
		exactStatistics: {initiative: -2, savingThrows: {dex: 7}, skills: {survival: 9}},
		actions: [{name: "Claw", entries: [{type: "entries", entries: ["{@atk mw} {@hit +4|four} to hit. {@h} {@damage 1d6 + 1d4 + 3} slashing damage."]}]}],
		...data,
	});
	const page = Object.create(Page.prototype);
	page._state = owner;
	page._currentCharacterId = "owner";
	page.saveCharacter = jest.fn(async () => true);
	page._renderCompanions = jest.fn();
	page.pAnimateD20 = jest.fn(async () => {});
	page.pAnimateDamageDice = jest.fn(async () => {});
	page._dismissDiceResult = jest.fn();
	page._watchDiceResultPosition = jest.fn();
	page._scheduleDiceResultDismiss = jest.fn();
	page._rollHistory = Object.create(History.prototype);
	Object.assign(page._rollHistory, {_rolls: [], _isOpen: false, _unreadCount: 0, _updateBadge: jest.fn()});
	globalThis.document = {body: globalThis.e_({tag: "body"}), querySelector: () => null};
	return {owner, page, id, companion: owner.getCompanion(id), history: page._rollHistory._rolls};
}

beforeEach(() => {
	jest.spyOn(RollerUtil, "randomise").mockImplementation(() => 10);
	JqueryUtil.doToast.mockClear?.();
});
afterEach(() => jest.restoreAllMocks());

describe("production companion roll surface", () => {
	test("direct native controls roll all skills, exact saves, ability checks and initiative into real history", async () => {
		const {page, companion, history, owner} = fixture();
		const before = copy(owner._data);
		const panel = page._createCompanionRollControls(companion);
		expect(panel.querySelectorAll(".btn-companion-save")).toHaveLength(6);
		const skill = panel.querySelector(".charsheet__companion-roll-skill");
		expect(skill.querySelectorAll("optgroup").map(group => group.attrs.label)).toEqual(["Skills", "Ability checks"]);
		skill.value = "skill:survival";
		skill.change();
		await panel.querySelector(".btn-companion-check").click();
		expect(history[0]).toMatchObject({title: "Moss — Survival", total: 19, rollType: "SKILL"});
		await panel.querySelectorAll(".btn-companion-save").find(button => button.attrs["data-ability"] === "dex").click();
		expect(history[0]).toMatchObject({title: "Moss — DEX Save", total: 17});
		await panel.querySelector(".btn-companion-initiative").click();
		expect(history[0]).toMatchObject({title: "Moss — Initiative", total: 8});
		skill.value = "ability:wis";
		skill.change();
		await panel.querySelector(".btn-companion-check").click();
		expect(history[0]).toMatchObject({title: "Moss — WIS Check", total: 9});
		expect(history).toHaveLength(4);
		expect(owner._data).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.pAnimateD20).toHaveBeenCalledTimes(4);
		const rebuilt = page._createCompanionRollControls(companion);
		expect(rebuilt.querySelector(".charsheet__companion-roll-skill").value).toBe("ability:wis");
	});

	test("touch mode and keyboard modifiers cancel without borrowing owner roll state", async () => {
		const {page, companion, owner, history} = fixture();
		const ownerDice = jest.spyOn(owner, "rollD20");
		RollerUtil.randomise.mockReturnValueOnce(4).mockReturnValueOnce(17);
		await page._rollCompanionSkillCheck(companion, "survival", {mode: "advantage"});
		expect(history[0].total).toBe(26);
		expect(page.pAnimateD20).toHaveBeenLastCalledWith(expect.objectContaining({roll1: 4, roll2: 17, mode: "advantage"}));
		await page._rollCompanionInitiative(companion, {mode: "advantage", event: {ctrlKey: true}});
		expect(page.pAnimateD20).toHaveBeenLastCalledWith(expect.objectContaining({mode: "normal", roll2: null}));
		expect(ownerDice).not.toHaveBeenCalled();
	});

	test("nested signed attacks use only the companion action and critical damage doubles every die, not constants", async () => {
		const {page, companion, owner, history} = fixture();
		RollerUtil.randomise.mockReturnValue(20);
		await page._rollCompanionAttack(companion, "action:0");
		expect(history[0]).toMatchObject({title: "Moss — Claw Attack", total: 24, resultClass: "critical"});
		expect(companion.usedAction).toBe(true);
		expect(owner.isActionTypeAvailable("action")).toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		RollerUtil.randomise.mockImplementation(sides => sides);
		await page._rollCompanionDamage(companion, "action:0", null, true);
		expect(history[0]).toMatchObject({title: "Moss — Claw Damage (Critical)", total: 23});
		expect(page.pAnimateDamageDice).toHaveBeenLastCalledWith([{sides: 6, values: [6, 6]}, {sides: 4, values: [4, 4]}]);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(history).toHaveLength(2);
	});

	test("failed saves restore companion action and publish no success", async () => {
		const {page, companion, history} = fixture();
		page.saveCharacter.mockResolvedValue(false);
		await expect(page._rollCompanionAttack(companion, "action:0")).rejects.toThrow(/saved/);
		expect(companion.usedAction).not.toBe(true);
		expect(history).toHaveLength(0);
		expect(page.pAnimateD20).not.toHaveBeenCalled();
	});

	test.each(["removal", "owner change", "replacement", "edited statistics"])("%s during animation cannot publish a stale result", async change => {
		const {page, owner, companion, history} = fixture();
		page.pAnimateD20.mockImplementation(async () => {
			if (change === "removal") owner.removeCompanion(companion.id);
			else if (change === "owner change") page._state = new State();
			else if (change === "replacement") owner._data.companions[0] = {...companion};
			else owner.updateCompanion(companion.id, {abilities: {...companion.abilities, dex: 18}});
		});
		await expect(page._rollCompanionInitiative(companion)).rejects.toThrow(/changed|available/);
		expect(history).toHaveLength(0);
	});

	test("missing statistics are visibly unavailable rather than an invented zero", async () => {
		const {page, companion, history} = fixture();
		delete companion.abilities.wis;
		companion.exactStatistics = null;
		const panel = page._createCompanionRollControls(companion);
		expect(descendants(panel).some(node => node.textContent.includes("unavailable"))).toBe(true);
		expect(panel.querySelector(".charsheet__companion-roll-skill").value).not.toBe("skill:perception");
		await expect(page._rollCompanionSkillCheck(companion, "survival")).rejects.toThrow(/statistic|available/);
		expect(history).toHaveLength(0);
	});

	test.each(["PHB", "XPHB"])("%s Simulacrum rolls use isolated current passives and commit only actor Action", async source => {
		const {page, owner, history} = fixture();
		jest.spyOn(State.prototype, "rollD20").mockReturnValue(10);
		owner.setAbilityBase("dex", 14);
		owner.addAttack({name: "Fist", damage: "1d4", damageType: "bludgeoning", abilityMod: "str"});
		const prepared = owner.prepareSimulacrumSnapshot({spellSource: source});
		expect(prepared.ok).toBe(true);
		const id = owner.addCompanion(prepared.companionData);
		const companion = owner.getCompanion(id);
		owner.setAbilityBase("dex", 20);
		const ownerBefore = copy(owner._data);
		const revision = companion.actorSnapshot.revision;
		await page._rollCompanionInitiative(companion);
		expect(history[0].total).toBe(12);
		expect(companion.actorSnapshot.revision).toBe(revision);
		expect(owner._data).toEqual(ownerBefore);
		const model = page._getCompanionRollModel(companion.id);
		expect(model.actions.length).toBeGreaterThan(0);
		await page._rollCompanionAttack(companion, model.actions[0].key);
		expect(owner.isActionTypeAvailable("action")).toBe(true);
		expect(owner.hydrateCompanionActor(id).actor.isActionTypeAvailable("action")).toBe(false);
		expect(companion.actorSnapshot.revision).toBe(revision + 1);
		const restored = new State();
		restored.loadFromJson(owner.toJson());
		expect(restored.hydrateCompanionActor(id).actor.isActionTypeAvailable("action")).toBe(false);
		expect(history).toHaveLength(2);
	});

	test.each([true, false])("attack refresh keeps result status and keyboard focus with supported damage: %s", async supported => {
		const {page, companion, history} = fixture();
		if (!supported) companion.actions[0].entries = ["{@hit +4} to hit. Apply damage manually."];
		const panel = page._createCompanionRollControls(companion);
		let replacement;
		page._renderCompanions.mockImplementation(() => {
			replacement = page._createCompanionRollControls(companion);
			document.querySelectorAll = () => [replacement];
			document.activeElement = document.body;
		});
		const attack = panel.querySelector(".btn-companion-attack-roll");
		attack.focus();
		await attack.click();
		expect(history[0]).toMatchObject({total: 14, rollType: "ATTACK"});
		expect(replacement.querySelector(".charsheet__companion-roll-status").textContent).toBe("Claw Attack: 14. Action used.");
		expect(document.activeElement).toBe(replacement.querySelector(supported ? ".btn-companion-damage-roll" : ".btn-companion-initiative"));
	});

	test("legacy attack picker cancellation spends nothing and selected attacks share the real roll/history transaction", async () => {
		const {page, companion, history} = fixture();
		const picker = jest.spyOn(InputUiUtil, "pGetUserEnum").mockResolvedValueOnce(null).mockResolvedValueOnce("action:0");
		await page._useCompanionAction(companion, "attack");
		expect(companion.usedAction).not.toBe(true);
		expect(history).toHaveLength(0);
		await page._useCompanionAction(companion, "attack");
		expect(picker).toHaveBeenLastCalledWith(expect.objectContaining({values: ["action:0"]}));
		expect(history[0]).toMatchObject({total: 14, rollType: "ATTACK"});
		expect(companion.usedAction).toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
	});
});

describe("companion parser and reader regressions", () => {
	test("a real MM familiar exposes its exact skill, hit and untagged fixed damage without owner bonuses", async () => {
		const {page, owner, history} = fixture();
		const owl = JSON.parse(fs.readFileSync(new URL("../../../data/bestiary/bestiary-mm.json", import.meta.url), "utf8")).monster.find(monster => monster.name === "Owl");
		const id = owner.addCompanionFromBestiary(owl, "familiar");
		const companion = owner.getCompanion(id);
		const panel = page._createCompanionRollControls(companion);
		await page._rollCompanionSkillCheck(companion, "perception");
		expect(history[0]).toMatchObject({title: "Owl — Perception", total: 13});
		await panel.querySelector(".btn-companion-attack-roll").click();
		expect(history[0]).toMatchObject({title: "Owl — Talons Attack", total: 13});
		await panel.querySelector(".btn-companion-damage-roll").click();
		expect(history[0]).toMatchObject({title: "Owl — Talons Damage", total: 1, breakdown: expect.stringContaining("slashing")});
		expect(page.pAnimateDamageDice).toHaveBeenLastCalledWith([]);
	});

	test("structured summon attacks reuse State normalization and the same exact damage evaluator", async () => {
		const {page, companion, history} = fixture({actions: [], attacks: [{name: "Hound Bite", attackBonus: 5, damage: "2d6+3", damageType: "piercing"}]});
		await page._rollCompanionAttack(companion, "action:0");
		expect(history[0]).toMatchObject({title: "Moss — Hound Bite Attack", total: 15});
		RollerUtil.randomise.mockImplementation(sides => sides);
		await page._rollCompanionDamage(companion, "action:0");
		expect(history[0]).toMatchObject({total: 15, breakdown: expect.stringContaining("piercing")});
		expect(page.pAnimateDamageDice).toHaveBeenLastCalledWith([{sides: 6, values: [6, 6]}]);
	});

	test.each(["EFA", "TCE", "RHW"])("%s feature statistics stay authoritative and generic attack/damage cannot bypass command transactions", async source => {
		const {owner, page, history} = fixture();
		const isReanimator = source === "RHW";
		const classSource = source === "TCE" ? "TCE" : "EFA";
		const subclass = isReanimator ? "Reanimator" : "Battle Smith";
		owner.addClass({name: "Artificer", source: classSource, level: 9, subclass: {name: subclass, shortName: subclass, source}});
		const uid = `${isReanimator ? "Reanimated Companion" : "Steel Defender"}|Artificer|${classSource}|${subclass}|${source}|3|${source}`;
		const id = owner.addCompanion({name: subclass, source, type: "class_summon", creatureType: isReanimator ? "undead" : "construct", featureGrant: {uid}});
		owner.reconcileFeatureOwnedCompanion(id, {summonerContext: owner.getFeatureCompanionSummonerContext(uid)});
		const companion = owner.getCompanion(id);
		const resolved = companion.scaling.resolved.statistics;
		const model = page._getCompanionRollModel(id);
		expect(model.operationUi).toBeTruthy();
		await page._rollCompanionSavingThrow(companion, "dex");
		expect(history[0].total).toBe(isReanimator ? 10 : 10 + resolved.savingThrows.dex);
		await page._rollCompanionSkillCheck(companion, "athletics");
		expect(history[0].total).toBe(isReanimator ? 10 : 10 + (resolved.skills?.athletics ?? resolved.abilityChecks.str));
		const attack = model.actions.find(action => action.attackBonus != null);
		await expect(page._rollCompanionAttack(companion, attack.key)).rejects.toThrow(/feature command/);
		await expect(page._rollCompanionDamage(companion, attack.key)).rejects.toThrow(/feature command/);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	test("real actor passives apply bonus dice, floors, conditions and exhaustion once without optional resource prompts", async () => {
		const {page, owner, history} = fixture();
		const id = owner.addCompanion(owner.prepareSimulacrumSnapshot({spellSource: "PHB"}).companionData);
		const {runtime} = globalThis.CharacterSheetCompanionActor.hydrate({ownerPage: page, companionId: id});
		await runtime.run(actor => {
			actor.setExhaustionRules("2024");
			actor.setExhaustion(1);
			actor.addNamedModifier({name: "Copy floor", type: "skill:survival", value: 0, setMinimum: 15, enabled: true});
			actor.addActiveState("custom", {name: "Copy blessing", customEffects: [{type: "rollBonus", target: "save", dice: "1d4"}]});
		});
		page.saveCharacter.mockClear();
		const companion = owner.getCompanion(id);
		const before = copy(owner._data);
		jest.spyOn(State.prototype, "rollD20").mockReturnValue(3);
		RollerUtil.randomise.mockImplementation(sides => sides);
		await page._rollCompanionSavingThrow(companion, "dex", {runtime});
		expect(history[0].total).toBe(3 + 5 - 2 + 4);
		expect(page.pAnimateDamageDice).toHaveBeenLastCalledWith([{sides: 4, values: [4]}]);
		await page._rollCompanionSkillCheck(companion, "survival", {runtime});
		expect(history[0]).toMatchObject({total: 13, resultNote: expect.stringContaining("Effective d20 15")});
		expect(owner._data).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		await runtime.run(actor => actor.addCondition("Paralyzed"));
		await page._rollCompanionSavingThrow(companion, "str", {runtime});
		expect(history[0]).toMatchObject({resultClass: "fumble", resultNote: expect.stringContaining("Automatic failure")});
		runtime.dispose();
	});

	test("failed actor attack persistence rolls back the snapshot and publishes no success", async () => {
		const {page, owner, history} = fixture();
		owner.addAttack({name: "Fist", damage: "1d4", damageType: "B", abilityMod: "str"});
		const id = owner.addCompanion(owner.prepareSimulacrumSnapshot({spellSource: "XPHB"}).companionData);
		const companion = owner.getCompanion(id);
		const before = copy(companion);
		const action = page._getCompanionRollModel(id).actions[0];
		page.saveCharacter.mockResolvedValue(false);
		await expect(page._rollCompanionAttack(companion, action.key)).rejects.toThrow(/could not be saved/);
		expect(companion).toEqual(before);
		expect(history).toHaveLength(0);
		expect(page.pAnimateD20).not.toHaveBeenCalled();
	});

	test("duplicate action names use their local action key, and damage controls never use a global timeout", async () => {
		const {page, companion, history} = fixture({actions: [
			{name: "Claw", entries: ["{@atk mw} {@hit 0} to hit. {@h} {@damage 1} slashing damage."]},
			{name: "Claw", entries: ["{@atk mw} {@hit -3} to hit. {@h} {@damage 2} cold damage."]},
		]});
		const timer = jest.spyOn(globalThis, "setTimeout");
		const panel = page._createCompanionRollControls(companion);
		await panel.querySelectorAll(".btn-companion-attack-roll")[1].click();
		expect(history[0].total).toBe(7);
		await panel.querySelectorAll(".btn-companion-damage-roll")[1].click();
		expect(history[0]).toMatchObject({total: 2, breakdown: expect.stringContaining("cold")});
		expect(timer).not.toHaveBeenCalled();
	});

	test("invalid, terminal and empty grouped records disable the actual controls", () => {
		const {page, companion} = fixture({count: 2, hpArray: [{current: 0, max: 1}, {current: 0, max: 1}]});
		let panel = page._createCompanionRollControls(companion);
		expect(panel.querySelectorAll("button").every(button => button.disabled)).toBe(true);
		expect(panel.querySelector(".charsheet__companion-roll-status").textContent).toContain("alive");
		const id = page._state.addCompanion(page._state.prepareSimulacrumSnapshot({spellSource: "PHB"}).companionData);
		const copyRecord = page._state.getCompanion(id);
		copyRecord.actorSnapshot.version = 99;
		panel = page._createCompanionRollControls(copyRecord);
		expect(panel.querySelectorAll("button").every(button => button.disabled)).toBe(true);
		copyRecord.actorSnapshot.version = 1;
		copyRecord.actorSnapshot.lifecycle = "destroyed";
		panel = page._createCompanionRollControls(copyRecord);
		expect(panel.querySelectorAll("button").every(button => button.disabled)).toBe(true);
	});

	test("nested entries, display arguments and compound damage are supported without choosing alternatives", () => {
		const {companion} = fixture();
		const actions = Rules.getRollActions(companion);
		expect(actions[0]).toMatchObject({key: "action:0", attackBonus: 4, damages: [{formula: "1d6 + 1d4 + 3", type: "slashing"}]});
		companion.actions[0].entries = ["{@atk mw} {@hit -2} to hit. {@damage 1d6} slashing, or {@damage 1d8} slashing with two hands."];
		expect(Rules.getRollActions(companion)[0]).toMatchObject({attackBonus: -2, damageReason: expect.stringMatching(/manual|choice/i)});
		companion.actions[0].entries = ["{@dc 14} Dexterity save. {@damage 2d6} fire damage."];
		expect(Rules.getRollActions(companion)[0].attackBonus).toBeNull();
	});

	test("null/empty scaling totals do not mask exact totals, and legacy skill names normalize", () => {
		const {owner, companion} = fixture({skillProficiencies: {"Animal Handling": 2}});
		companion.scaling = {resolved: {statistics: {savingThrows: {dex: null}, abilityChecks: {wis: ""}, skills: {survival: null}}}};
		expect(owner.getCompanionSaveMod(companion.id, "dex")).toBe(7);
		expect(owner.getCompanionSkillMod(companion.id, "survival")).toBe(9);
		expect(owner.getCompanionSkillMod(companion.id, "animalhandling")).toBe(3);
		expect(owner.getCompanionAbilityCheckMod(companion.id, "wis")).toBe(-1);
		companion.scaling.resolved.statistics.skills.survival = "+12";
		expect(owner.getCompanionSkillMod(companion.id, "survival")).toBe(12);
	});
});
