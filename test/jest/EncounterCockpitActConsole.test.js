import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterEffectPresets} from "../../js/encounterworkspace/encounterworkspace-fx.js";
import {getCockpitInstanceLabels} from "../../js/encounterworkspace/cockpit/model.js";
import {
	COCKPIT_CONSOLE_CHEATSHEET,
	COCKPIT_CONSOLE_EXAMPLES,
	COCKPIT_CONSOLE_HISTORY_MAX,
	getCockpitConsoleCommand,
	getCockpitConsoleEffects,
	getCockpitConsoleHandle,
	getCockpitConsoleHistoryStep,
	getCockpitConsoleHistoryWith,
	getCockpitConsolePreview,
	getCockpitConsoleSaveOutcome,
	getCockpitCritExpr,
} from "../../js/encounterworkspace/cockpit/features/act-console-model.js";
import {pGetCockpitState} from "./encounter-cockpit-fixtures.js";

const pGetCtx = async () => {
	const state = await pGetCockpitState([["Goblin", 2], ["Mage", 1], ["Skeleton", 1]]);
	const labels = getCockpitInstanceLabels(state.instances);
	const effects = getCockpitConsoleEffects(getEncounterEffectPresets(state));
	return {state, labels, effects};
};

const run = (ctx, text, opts = {}) => {
	const parsed = getCockpitConsoleCommand(text, {state: ctx.state, effects: ctx.effects, dockTargetIds: [], ...opts});
	return {parsed, preview: getCockpitConsolePreview(parsed, {state: ctx.state, labels: ctx.labels, effects: ctx.effects})};
};

describe("Encounter cockpit Act — command console", () => {
	test("history keeps the latest copy of a line, caps its length, and steps ↑/↓ back to the draft", () => {
		let history = [];
		["7 fire", "heal 5", "7 fire", "  "].forEach(line => { history = getCockpitConsoleHistoryWith(history, line); });
		expect(history).toEqual(["heal 5", "7 fire"]);
		for (let i = 0; i < 40; ++i) history = getCockpitConsoleHistoryWith(history, `${i}`);
		expect(history).toHaveLength(COCKPIT_CONSOLE_HISTORY_MAX);
		const h = ["a", "b"];
		let step = getCockpitConsoleHistoryStep({history: h, index: null, draft: "typing"}, -1);
		expect(step).toEqual({index: 1, text: "b"});
		step = getCockpitConsoleHistoryStep({history: h, index: step.index, draft: "typing"}, -1);
		expect(step).toEqual({index: 0, text: "a"});
		expect(getCockpitConsoleHistoryStep({history: h, index: 0, draft: "typing"}, -1)).toEqual({index: 0, text: "a"});
		expect(getCockpitConsoleHistoryStep({history: h, index: 1, draft: "typing"}, 1)).toEqual({index: null, text: "typing"});
	});

	test("with no @ the command applies to the dock targets; with none at all it explains how to target", async () => {
		const ctx = await pGetCtx();
		expect(run(ctx, "7 fire", {dockTargetIds: ["c1"], selectedIds: ["c1"]}).parsed).toMatchObject({ids: ["c1"], error: null});
		expect(run(ctx, "7 fire").parsed.error).toMatch(/No targets/);
		expect(run(ctx, "").parsed.cmd).toBeNull();
		expect(run(ctx, "@nobody 7").parsed.error).toBe("No creature matches @nobody.");
		expect(run(ctx, "flibber").parsed.error).toMatch(/Didn’t understand/);
	});

	test("damage previews show exact HP after typed defenses (the skeleton is vulnerable to bludgeoning)", async () => {
		const ctx = await pGetCtx();
		const skeleton = ctx.state.instances.find(it => it.id === "c4");
		const {parsed, preview} = run(ctx, "@skel 4 bludgeoning");
		expect(parsed.ids).toEqual(["c4"]);
		expect(preview.title).toBe("4 bludgeoning damage");
		expect(preview.rows).toEqual([{id: "c4", label: ctx.labels.get("c4"), text: `−8 (vulnerable) → ${skeleton.hp.current - 8}`}]);
		const goblin = ctx.state.instances.find(it => it.id === "c1");
		expect(run(ctx, "@gob 7 fire").preview.rows.map(it => it.text)).toEqual([
			`−7 → ${Math.max(0, goblin.hp.current - 7)}`,
			`−7 → ${Math.max(0, goblin.hp.current - 7)}`,
		]);
		expect(run(ctx, "@skel 2d6 slashing").preview.rows[0].text).toMatch(/rolled on Enter/);
	});

	test("temp HP absorbs damage first in the preview", async () => {
		const ctx = await pGetCtx();
		ctx.state = EncounterWorkspaceState.validate({...ctx.state, instances: ctx.state.instances.map(it => it.id === "c1" ? {...it, hp: {...it.hp, temp: 5}} : it)});
		const hp = ctx.state.instances.find(it => it.id === "c1").hp;
		expect(run(ctx, "@goblin1 3").preview.rows[0].text).toBe(`−3 → ${hp.current} +2`);
	});

	test("effects, conditions and saves preview what happens and to whom; a caster is resolved with `by`", async () => {
		const ctx = await pGetCtx();
		const bless = run(ctx, "@gob bless 1 min by @mage");
		expect(bless.parsed.casterId).toBe("c3");
		expect(bless.preview.title).toBe(`Bless · 1 min · cast by ${ctx.labels.get("c3")}`);
		expect(bless.preview.rows.map(it => it.text)).toEqual(["+ Bless", "+ Bless"]);
		expect(run(ctx, "@gob bless by @xyz").parsed.error).toMatch(/No caster/);
		expect(run(ctx, "@gob bless by @gob").parsed.error).toMatch(/matches 2 creatures/);
		const prone = run(ctx, "@mage prone 2r");
		expect(prone.preview.title).toBe("Prone · 2 rounds");
		const save = run(ctx, "@all save dex 14 8d6 fire half prone");
		expect(save.preview).toMatchObject({isRoll: true, title: "Dex save · DC 14 · 8d6 fire (half on a pass) · prone on a fail"});
		expect(save.preview.rows).toHaveLength(4);
		expect(run(ctx, "@gob check stealth adv dc 12").preview.title).toBe("Stealth (Dex) with advantage · DC 12");
		expect(run(ctx, "@gob -bless").preview.rows.map(it => it.text)).toEqual(["doesn't have it", "doesn't have it"]);
	});

	test("every cheat-sheet and docked example chip parses without an error", async () => {
		const ctx = await pGetCtx();
		[...COCKPIT_CONSOLE_CHEATSHEET.flatMap(it => it.items), ...COCKPIT_CONSOLE_EXAMPLES].forEach(example => {
			const {parsed} = run(ctx, example, {dockTargetIds: ["c1"], selectedIds: ["c1"], activeId: "c1", chipGroups: [{name: "Goblins", ids: ["c1", "c2"]}]});
			expect({example, error: parsed.error}).toEqual({example, error: null});
		});
	});

	test("a crit doubles every die and a save command carries its outcome to the tray", () => {
		expect(getCockpitCritExpr("2d6+3")).toBe("4d6+3");
		expect(getCockpitCritExpr("d8+1d4")).toBe("2d8+2d4");
		const {cmd} = getCockpitConsoleCommand("save dex 14 8d6 fire half prone 2r", {state: {instances: [{id: "c1"}]}, dockTargetIds: ["c1"]});
		expect(getCockpitConsoleSaveOutcome(cmd)).toEqual({damage: {expr: "8d6", amount: null}, damageType: "fire", halfOnSuccess: true, condition: "prone", rounds: 2});
		expect(getCockpitConsoleSaveOutcome({verb: "save", damage: null, condition: null})).toBeNull();
	});

	test("the row ›_ handle resolves back to exactly that creature, multi-word and numbered names included", async () => {
		const state = await pGetCockpitState([["Goblin", 2], ["Young Red Dragon", 1], ["Giant Spider", 2], ["Bandit Captain", 1]]);
		const labels = getCockpitInstanceLabels(state.instances);
		state.instances.forEach(it => {
			const handle = getCockpitConsoleHandle(labels.get(it.id));
			expect({handle, ids: getCockpitConsoleCommand(`${handle} 5`, {state, dockTargetIds: []}).ids}).toEqual({handle, ids: [it.id]});
		});
	});
});
