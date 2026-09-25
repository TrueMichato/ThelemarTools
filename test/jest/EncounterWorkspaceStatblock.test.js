import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import {
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	getEncounterEffectiveMonster,
} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../js/encounterworkspace/encounterworkspace-quick-actions.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {BestiaryQuickActionsUi} from "../../js/bestiary/bestiary-quick-actions-ui.js";
import {getEncounterHandoffSnapshot} from "../../js/encounterworkspace/encounterworkspace-handoff.js";
import {getEncounterRollFromPackedDice, pRollEncounterSelection} from "../../js/encounterworkspace/encounterworkspace-roll.js";

const priorWindow = globalThis.window;
globalThis.window = {addEventListener: jest.fn()};
const {EncounterWorkspacePage} = await import("../../js/encounterworkspace.js");
globalThis.window = priorWindow;

const monster = {
	name: "Goblin",
	source: "MM",
	size: ["S"],
	type: "humanoid",
	alignment: ["N", "E"],
	ac: [{ac: 15}],
	hp: {average: 7, formula: "2d6"},
	speed: {walk: 30},
	str: 8,
	dex: 14,
	con: 10,
	int: 10,
	wis: 8,
	cha: 8,
	cr: "1/4",
	action: [{name: "Scimitar", entries: ["{@atk mw} {@hit +4} to hit, reach 5 ft., one target. {@h} 5 ({@damage 1d6 + 2}) slashing damage."]}],
};
const makeState = async () => {
	let ix = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "saved", items: [{h: "goblin_mm", c: 2}]},
		pResolveItem: async () => ({entity: monster}),
		fnUid: () => `goblin-${++ix}`,
	});
};
const withOp = (state, id, operation) => EncounterWorkspaceState.withStatblockChanges(state, [{
	id,
	addOperations: [{id: `op-${Math.random()}`, ...operation}],
	removeIds: [],
}]);

describe("Encounter Workspace instance statblock edits", () => {
	it("replays different edits on duplicate instances after reload without altering their snapshots or Bestiary", async () => {
		const values = new Map();
		const storage = {
			pGetForPage: jest.fn(async key => values.get(key)),
			pSetForPage: jest.fn(async (key, value) => values.set(key, value)),
		};
		const store = new EncounterWorkspaceStore({storage});
		const original = await makeState();
		const first = withOp(original, "goblin-1", BestiaryQuickActionsOperations.patch({set: {dex: 18, "hp.average": 12}}));
		const second = withOp(first.state, "goblin-2", BestiaryQuickActionsOperations.addEntry({
			section: "legendary", entry: {name: "Shadow Step", entries: ["The goblin moves 10 feet."]},
		}));
		await store.pSave(second.state);
		const restored = await store.pLoad();
		expect(restored.instances.map(it => getEncounterEffectiveMonster(it).dex)).toEqual([18, 14]);
		expect(restored.instances.map(it => getEncounterEffectiveMonster(it).legendary?.[0]?.name)).toEqual([undefined, "Shadow Step"]);
		expect(restored.instances.map(it => it.monster)).toEqual([monster, monster]);
		expect(Object.isFrozen(restored.instances[0].monster.action[0])).toBe(true);
		expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
		expect(storage.pSetForPage.mock.calls[0][0]).toBe("encounterWorkspaceState");
	});

	it("resets precisely when the effective HP average changes; preserves temp and unrelated HP undo", async () => {
		const state = await makeState();
		const hp = EncounterWorkspaceState.withHp(state, {id: "goblin-1", prop: "current", value: 2});
		const temp = EncounterWorkspaceState.withHp(hp, {id: "goblin-1", prop: "temp", value: 3});
		const unchanged = withOp(temp, "goblin-1", BestiaryQuickActionsOperations.patch({set: {dex: 18}}));
		expect(unchanged.resetHpIds).toEqual([]);
		expect(unchanged.state.instances[0].hp).toEqual({current: 2, max: 7, temp: 3});
		const changed = withOp(unchanged.state, "goblin-1", BestiaryQuickActionsOperations.patch({set: {"hp.average": 13}}));
		expect(changed.resetHpIds).toEqual(["goblin-1"]);
		expect(changed.state.instances.map(it => it.hp)).toEqual([
			{current: 13, max: 13, temp: 3},
			{current: 7, max: 7, temp: 0},
		]);
		const removeId = changed.state.instances[0].statblockOperations.at(-1).id;
		const removed = EncounterWorkspaceState.withStatblockChanges(changed.state, [{
			id: "goblin-1", addOperations: [], removeIds: [removeId],
		}]);
		expect(removed.state.instances[0].hp).toEqual({current: 7, max: 7, temp: 3});
		const minion = withOp(removed.state, "goblin-1", BestiaryQuickActionsOperations.minion());
		expect(minion.state.instances[0].hp).toEqual({current: null, max: null, temp: 3});
		expect(getEncounterEffectiveMonster(minion.state.instances[0]).hp.special).toBe("6");
	});

	it("previews named per-target skips and commits only valid bulk targets in one state", async () => {
		const state = await makeState();
		const first = withOp(state, "goblin-1", BestiaryQuickActionsOperations.addEntry({
			section: "legendary", entry: {name: "Shadow Step", entries: ["Move."]},
		})).state;
		const operation = {id: "bulk-step",
			...BestiaryQuickActionsOperations.addEntry({
				section: "legendary", entry: {name: "Shadow Step", entries: ["Move ten feet."]},
			})};
		const preview = EncounterWorkspaceState.previewBulkStatblockOperation(first, {operation});
		expect(preview.changedIds).toEqual(["goblin-2"]);
		expect(preview.skipped).toEqual([{id: "goblin-1", reason: "legendary entry already exists"}]);
		expect(getEncounterEffectiveMonster(preview.state.instances[0]).legendary[0].entries).toEqual(["Move."]);
		expect(getEncounterEffectiveMonster(preview.state.instances[1]).legendary[0].entries).toEqual(["Move ten feet."]);
		const minion = EncounterWorkspaceState.previewBulkStatblockOperation(state, {
			operation: {id: "minion", ...BestiaryQuickActionsOperations.minion()},
		});
		expect(minion.changedIds).toHaveLength(2);
		const alreadyMinion = EncounterWorkspaceState.previewBulkStatblockOperation(minion.state, {
			operation: {id: "minion-again", ...BestiaryQuickActionsOperations.minion()},
		});
		expect(alreadyMinion.skipped).toEqual([
			{id: "goblin-1", reason: "already a minion"},
			{id: "goblin-2", reason: "already a minion"},
		]);
	});

	it("skips a failed bulk conversion by instance while saving valid targets together", async () => {
		const state = withOp(await makeState(), "goblin-1", BestiaryQuickActionsOperations.patch({set: {cr: "99"}})).state;
		const preview = EncounterWorkspaceState.previewBulkStatblockOperation(state, {
			operation: {id: "convert", ...BestiaryQuickActionsOperations.minion()},
		});
		expect(preview.changedIds).toEqual(["goblin-2"]);
		expect(preview.skipped).toEqual([{
			id: "goblin-1",
			reason: expect.stringContaining("Challenge rating \"99\" is not supported"),
		}]);
		const storage = {pSetForPage: jest.fn(async () => {})};
		const saved = await new EncounterWorkspaceStore({storage}).pSave(preview.state);
		expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
		expect(saved.instances[0].statblockOperations).toHaveLength(1);
		expect(saved.instances[0].hp).toEqual({current: 7, max: 7, temp: 0});
		expect(saved.instances[1].statblockOperations).toHaveLength(1);
		expect(saved.instances[1].hp).toEqual({current: null, max: null, temp: 0});
	});

	it("reuses Quick Actions rules for actual area traits and lair groups", async () => {
		const state = await makeState();
		const trait = {
			name: "Rockbreaker",
			source: "FleeMortals",
			_areaName: "Cave",
			entries: ["The creature gains a burrowing speed."],
		};
		const area = BestiaryQuickActionsUi.getAreaTraitOperation({trait});
		const applied = EncounterWorkspaceState.previewBulkStatblockOperation(state, {operation: area});
		expect(applied.changedIds).toEqual(["goblin-1", "goblin-2"]);
		expect(applied.state.instances.map(it => getEncounterEffectiveMonster(it).speed.burrow)).toEqual([30, 30]);
		expect(applied.state.instances[0].monster.speed.burrow).toBeUndefined();
		const repeated = EncounterWorkspaceState.previewBulkStatblockOperation(applied.state, {
			operation: {...area, id: "another-id"},
		});
		expect(repeated.skipped).toEqual([
			{id: "goblin-1", reason: "area trait already applied"},
			{id: "goblin-2", reason: "area trait already applied"},
		]);
		const group = {name: "The Cave", source: "FleeMortals", lairActions: ["The ground trembles."]};
		const lair = EncounterWorkspaceState.previewBulkStatblockOperation(applied.state, {
			operation: {id: "lair", ...BestiaryQuickActionsOperations.setLegendaryGroup(group)},
		});
		expect(lair.skipped).toEqual([]);
		expect(lair.state.instances.map(it => getEncounterEffectiveMonster(it).legendaryGroup.name)).toEqual(["The Cave", "The Cave"]);
		expect(EncounterWorkspaceState.previewBulkStatblockOperation(lair.state, {
			operation: {id: "repeat-lair", ...BestiaryQuickActionsOperations.setLegendaryGroup(group)},
		}).skipped).toEqual([
			{id: "goblin-1", reason: "lair group already applied"},
			{id: "goblin-2", reason: "lair group already applied"},
		]);
	});

	it("rejects malformed history and migrates v1-v4 in memory without writes or losing notes and modifiers", async () => {
		const state = await makeState();
		const writes = jest.fn(async () => {});
		let saved;
		const store = new EncounterWorkspaceStore({storage: {
			pGetForPage: async () => saved,
			pSetForPage: writes,
		}});
		for (const version of [1, 2, 3, 4]) {
			saved = structuredClone(state);
			saved.version = version;
			delete saved.instances[0].statblockOperations;
			delete saved.instances[1].statblockOperations;
			if (version < 4) {
				delete saved.turn;
				saved.instances.forEach(it => { delete it.hp; delete it.initiative; });
			}
			if (version < 3) saved.instances.forEach(it => { delete it.areaNotes; delete it.modifiers; });
			if (version < 2) saved.instances.forEach(it => { delete it.conditions; });
			if (version >= 3) {
				saved.instances[0].areaNotes = [{id: "note", kind: "lair", name: "Bell", description: "Reminder only."}];
				saved.instances[0].modifiers = [{id: "bonus", name: "Fog", scopes: ["save"], mode: "advantage", bonus: 0}];
			}
			const loaded = await store.pLoad();
			expect(loaded.version).toBe(6);
			expect(loaded.instances[0].statblockOperations).toEqual([]);
			if (version >= 3) {
				expect(loaded.instances[0].areaNotes[0].kind).toBe("lair");
				expect(loaded.instances[0].modifiers[0].name).toBe("Fog");
			}
		}
		expect(writes).not.toHaveBeenCalled();
		saved = structuredClone(state);
		saved.instances[0].statblockOperations = [{id: "bad", type: "patch", patch: {set: {"__proto__.polluted": true}}}];
		await expect(store.pLoad()).rejects.toThrow(/invalid statblock edit/);
		saved.instances[0].statblockOperations = [{id: "bad", type: "unknown", data: {}}];
		await expect(store.pLoad()).rejects.toThrow(/invalid statblock operation/);
		expect(writes).not.toHaveBeenCalled();
	});

	it("uses edited stats in rendered blocks, batch rolls, clicked-link context, and handoff v1", async () => {
		const state = await makeState();
		const edited = withOp(state, "goblin-1", BestiaryQuickActionsOperations.patch({
			set: {
				dex: 18,
				action: [{name: "Scimitar", entries: ["{@atk mw} {@hit +8} to hit, reach 5 ft., one target. {@h} 8 ({@damage 1d10 + 3}) slashing damage."]}],
			},
		})).state;
		expect(getEncounterEffectiveMonster(edited.instances[0]).action[0].name).toBe("Scimitar");
		const previousConfig = globalThis.VetoolsConfig;
		const previousScaler = globalThis.ScaleCreature;
		const previousPrerelease = globalThis.PrereleaseUtil;
		const previousBrew = globalThis.BrewUtil2;
		globalThis.VetoolsConfig = {get: () => "classic"};
		globalThis.ScaleCreature = {isCrInScaleRange: () => false};
		globalThis.PrereleaseUtil = globalThis.BrewUtil2 = {hasSourceJson: () => false};
		let rendered;
		let renderedAction;
		try {
			rendered = Renderer.monster.getCompactRenderedString(structuredClone(getEncounterEffectiveMonster(edited.instances[0])), {isShowScalers: false});
			renderedAction = Renderer.get().render({type: "entries", entries: getEncounterEffectiveMonster(edited.instances[0]).action});
		} finally {
			globalThis.VetoolsConfig = previousConfig;
			globalThis.ScaleCreature = previousScaler;
			globalThis.PrereleaseUtil = previousPrerelease;
			globalThis.BrewUtil2 = previousBrew;
		}
		expect(rendered).toContain("18 (+4)");
		expect(renderedAction).toContain("Scimitar");
		expect(renderedAction).toContain("+8");
		expect(renderedAction).toContain("1d10");
		const die = jest.fn(async ({bonus}) => ({die: 10, total: 10 + bonus, mode: "normal", statusText: ""}));
		const result = await pRollEncounterSelection({state: edited, rollType: "ability", key: "dex", pRoll: die});
		expect(result.results.map(it => it.baseBonus)).toEqual([4, 2]);
		const clicked = getEncounterRollFromPackedDice({subType: "d20", context: {type: "hit"}, toRoll: "1d20+8"});
		expect(clicked).toMatchObject({rollType: "attack", baseBonus: 8});
		const readied = EncounterWorkspaceState.withInitiativeResults(edited, [
			{id: "goblin-1", total: 15}, {id: "goblin-2", total: 12},
		]);
		const handoff = getEncounterHandoffSnapshot({state: readied, id: "handoff", createdAt: "2026-01-01T00:00:00.000Z"});
		expect(handoff.version).toBe(1);
		expect(handoff.entries.map(it => it.monster.dex)).toEqual([18, 14]);
		expect(handoff.entries.map(it => it.instanceId)).toEqual(["goblin-1", "goblin-2"]);
		expect(handoff.entries[0].monster.action[0].entries[0]).toContain("{@hit +8}");
	});

	it("keeps prior page state, UI notifications and history intact when the encounter save fails", async () => {
		let state = await makeState();
		const onSaved = jest.fn();
		const storage = {
			pSetForPage: jest.fn().mockRejectedValueOnce(new Error("Storage full")).mockResolvedValue(undefined),
		};
		const store = new EncounterWorkspaceStore({storage});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({
			id: "goblin-1",
			getState: () => state,
			pCommit: async result => { state = await store.pSave(result.state); onSaved(result); },
		});
		const changed = jest.fn();
		adapter.subscribe(changed);
		const operation = {id: "hp-change", ...BestiaryQuickActionsOperations.patch({set: {"hp.average": 12}})};
		await expect(adapter.addOperation({operation})).rejects.toThrow("Storage full");
		expect(adapter.getOperations()).toEqual([]);
		expect(state.instances[0].hp.current).toBe(7);
		expect(changed).not.toHaveBeenCalled();
		await adapter.addOperation({operation});
		expect(adapter.getOperations()).toEqual([operation]);
		expect(state.instances[0].hp.current).toBe(12);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({resetHpIds: ["goblin-1"]}));
	});

	it("clears only HP undo entries touching a reset instance after a successful page save", async () => {
		const state = await makeState();
		const edit = withOp(state, "goblin-1", BestiaryQuickActionsOperations.patch({set: {"hp.average": 12}}));
		const storage = {pSetForPage: jest.fn().mockRejectedValueOnce(new Error("Storage full")).mockResolvedValue(undefined)};
		const page = Object.create(EncounterWorkspacePage.prototype);
		page._state = state;
		page._store = new EncounterWorkspaceStore({storage});
		page._hpUndo = [
			[{id: "goblin-1", before: {current: 7, max: 7, temp: 0}, after: {current: 6, max: 7, temp: 0}}],
			[{id: "goblin-2", before: {current: 7, max: 7, temp: 0}, after: {current: 6, max: 7, temp: 0}}],
		];
		page._setBusy = jest.fn();
		page._setError = jest.fn();
		page._setStatus = jest.fn();
		page._render = jest.fn();
		page._clearRollResults = jest.fn();
		await expect(page._pCommitStatblockEdit(edit)).rejects.toThrow("Storage full");
		expect(page._state).toBe(state);
		expect(page._hpUndo).toHaveLength(2);
		expect(page._render).not.toHaveBeenCalled();
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("not saved"));
		await page._pCommitStatblockEdit(edit);
		expect(page._state.instances[0].hp.current).toBe(12);
		expect(page._hpUndo).toEqual([[{
			id: "goblin-2",
			before: {current: 7, max: 7, temp: 0},
			after: {current: 6, max: 7, temp: 0},
		}]]);
		expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("Reset current and maximum HP for Goblin #1"));
		expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
	});

	it("resolves bulk area and lair rules by source-qualified identity after list reorder, and rejects removed rules", async () => {
		const originalDocument = globalThis.document;
		const originalOption = globalThis.Option;
		const controls = new Map();
		globalThis.document = {getElementById: id => {
			if (!controls.has(id)) controls.set(id, {hidden: false});
			return controls.get(id);
		}};
		globalThis.Option = class {
			constructor (text, value = "") { this.text = text; this.value = value; }
		};
		const areaA = {name: "Rockbreaker", source: "FleeMortals", _areaName: "Cave", entries: ["The creature burrows."]};
		const areaB = {name: "Shadow Blend", source: "FleeMortals", _areaName: "Cave", entries: ["The creature hides."]};
		const lairA = {name: "Cave", source: "FleeMortals", lairActions: ["The ground trembles."]};
		const lairB = {name: "Cave", source: "OtherBook", lairActions: ["Vines grow."]};
		const loadArea = jest.spyOn(BestiaryQuickActionsUi, "_pLoadAreaTraits");
		const loadLair = jest.spyOn(BestiaryQuickActionsUi, "_pLoadLegendaryGroups");
		const confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const page = Object.create(EncounterWorkspacePage.prototype);
			page._state = await makeState();
			page._selBulkType = {value: "area"};
			page._selBulkChoice = {
				options: [],
				value: "",
				hidden: false,
				replaceChildren (...options) { this.options = options; this.value = options[0]?.value ?? ""; },
				add (option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; },
			};
			page._isBusy = false;
			page._eleStatus = {textContent: ""};
			page._setBusy = jest.fn(value => page._isBusy = value);
			page._setStatus = jest.fn(text => page._eleStatus.textContent = text);
			page._setError = jest.fn(text => page._eleStatus.textContent = text);
			page._pCommitStatblockEdit = jest.fn(async result => { page._state = result.state; page._eleStatus.textContent = "Saved"; });

			loadArea.mockResolvedValueOnce([areaA, areaB])
				.mockResolvedValueOnce([areaB, areaA])
				.mockResolvedValueOnce([areaB, areaA]);
			await page._pRenderBulkChoices();
			expect(page._selBulkChoice.options.map(it => it.value)).toEqual(["", "rockbreaker|fleemortals", "shadow blend|fleemortals"]);
			page._selBulkChoice.value = "rockbreaker|fleemortals";
			await page._pRenderBulkChoices();
			expect(page._selBulkChoice.value).toBe("rockbreaker|fleemortals");
			expect(page._selBulkChoice.options.map(it => it.value)).toEqual(["", "shadow blend|fleemortals", "rockbreaker|fleemortals"]);
			await page._pPreviewBulkStatblock();
			expect(page._pCommitStatblockEdit).toHaveBeenCalledTimes(1);
			expect(page._state.instances.map(it => getEncounterEffectiveMonster(it).speed.burrow)).toEqual([30, 30]);
			expect(confirm.mock.calls[0][0].htmlDescription).toContain("Rockbreaker (FleeMortals)");
			expect(confirm.mock.calls[0][0].htmlDescription).not.toContain("Shadow Blend");

			page._selBulkType.value = "lair";
			loadLair.mockResolvedValueOnce([lairA, lairB]).mockResolvedValueOnce([lairB, lairA]);
			await page._pRenderBulkChoices();
			expect(page._selBulkChoice.options.map(it => it.value)).toEqual(["", "cave|fleemortals", "cave|otherbook"]);
			page._selBulkChoice.value = "cave|fleemortals";
			await page._pPreviewBulkStatblock();
			expect(page._state.instances.map(it => getEncounterEffectiveMonster(it).legendaryGroup.name)).toEqual(["Cave", "Cave"]);
			expect(page._state.instances.map(it => getEncounterEffectiveMonster(it).legendaryGroup.source)).toEqual(["FleeMortals", "FleeMortals"]);
			expect(confirm.mock.calls[1][0].htmlDescription).toContain("Cave (FleeMortals)");

			page._selBulkType.value = "area";
			loadArea.mockResolvedValueOnce([areaA, areaB]).mockResolvedValueOnce([areaB]);
			await page._pRenderBulkChoices();
			page._selBulkChoice.value = "rockbreaker|fleemortals";
			await page._pPreviewBulkStatblock();
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("rule is no longer available"));
			expect(page._pCommitStatblockEdit).toHaveBeenCalledTimes(2);
			expect(confirm).toHaveBeenCalledTimes(2);

			loadArea.mockResolvedValueOnce([areaA, areaA]);
			await page._pRenderBulkChoices();
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Multiple loaded rules share the identity"));
		} finally {
			loadArea.mockRestore();
			loadLair.mockRestore();
			confirm.mockRestore();
			globalThis.document = originalDocument;
			globalThis.Option = originalOption;
		}
	});

	it("keeps saved/reload warnings after a post-save render failure in bulk and the shared editor", async () => {
		const state = await makeState();
		const storage = {pSetForPage: jest.fn(async () => {})};
		const page = Object.create(EncounterWorkspacePage.prototype);
		page._state = state;
		page._store = new EncounterWorkspaceStore({storage});
		page._isBusy = false;
		page._hpUndo = [];
		page._selBulkType = {value: "minion"};
		page._eleStatus = {textContent: ""};
		page._setBusy = jest.fn(value => page._isBusy = value);
		page._setStatus = jest.fn(text => page._eleStatus.textContent = text);
		page._setError = jest.fn(text => page._eleStatus.textContent = text);
		page._render = jest.fn(() => { throw new Error("Renderer unavailable"); });
		page._clearRollResults = jest.fn();
		const confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		try {
			await page._pPreviewBulkStatblock();
			expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
			expect(page._state.instances[0].statblockOperations[0].type).toBe("minion");
			expect(page._eleStatus.textContent).toMatch(/saved, but the page could not refresh.*Reload this page/);
			expect(page._eleStatus.textContent).not.toMatch(/unchanged|not applied/);
			expect(page._setError).toHaveBeenCalledTimes(1);
			const adapter = new EncounterWorkspaceQuickActionsAdapter({
				id: "goblin-1",
				getState: () => page._state,
				pCommit: result => page._pCommitStatblockEdit(result),
			});
			const applied = await BestiaryQuickActionsUi._pApplyChange({
				registry: adapter,
				monster: state.instances[0].monster,
				addOperations: [{id: "after-render", ...BestiaryQuickActionsOperations.patch({set: {dex: 18}})}],
			});
			expect(applied).toBe(false);
			expect(page._state.instances[0].statblockOperations).toHaveLength(2);
			expect(toast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringMatching(/saved.*reload/i),
			}));
			expect(toast.mock.calls[0][0].content).not.toMatch(/failed|not saved/);
		} finally {
			confirm.mockRestore();
			toast.mockRestore();
		}
	});
});
