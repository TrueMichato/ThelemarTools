import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-ui.js";
import "../../../js/render.js";
import {compileCreatureTransformation, getCreatureTransformationCandidates, resolveCreatureTransformation} from "../../../js/creature-transformations.js";
import {compileCreatureTransformationStats} from "../../../js/creature-transformation-stats.js";
import {estimateCreatureTransformationCr} from "../../../js/creature-transformation-cr.js";
import {createFrozenCreatureTransformation} from "../../../js/creature-transformation-forms.js";
import {normalizeCreatureTransformation} from "../../../js/bestiary/bestiary-transformation-catalog-adapter.js";
import {inspectCreatureTransformationSourceInputs, previewCreatureTransformationSourceInputs, compileCreatureTransformationSourceInputs, SOURCE_ESTIMATE_MODE} from "../../../js/bestiary/bestiary-transformation-source-inputs.js";
import {renderGuidedTarget} from "../../../js/bestiary/bestiary-transformation-editor-guided.js";
import * as workflow from "../../../js/bestiary/bestiary-transformation-workflow.js";
import {BestiaryQuickActionsOperations, BestiaryQuickActionsRegistry, BestiaryQuickActionsUtil} from "../../../js/bestiary/bestiary-quick-actions-engine.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore, getEncounterEffectiveMonster} from "../../../js/encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "../../../js/encounterworkspace/encounterworkspace-quick-actions.js";

const create = jest.fn(workflow.createCreatureTransformationChanges);
jest.unstable_mockModule("../../../js/bestiary/bestiary-transformation-workflow.js", () => ({...workflow, createCreatureTransformationChanges: create}));
const {pRenderCreatureTransformationEditor} = await import("../../../js/bestiary/bestiary-transformation-editor.js");
const {BestiaryQuickActionsUi} = await import("../../../js/bestiary/bestiary-quick-actions-ui.js");
const oldWindow = globalThis.window;
globalThis.window = {addEventListener: jest.fn()};
const {EncounterWorkspacePage} = await import("../../../js/encounterworkspace.js");
globalThis.window = oldWindow;
const catalog = JSON.parse(fs.readFileSync("data/creature-transformations.json", "utf8"));
const monsters = JSON.parse(fs.readFileSync("data/bestiary/bestiary-mm.json", "utf8")).monster;
const table = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
const candidates = getCreatureTransformationCandidates({catalog, races: []});
const source = name => structuredClone(monsters.find(it => it.name === name));

// Only the DOM surface is a facade; compilation, workflow, consumers and Store remain real.
class Node {
	constructor (tag = "") {
		this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
		this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.className = ""; this.value = ""; this.disabled = false;
		this.classList = {add: (...names) => { this.className += ` ${names.join(" ")}`; },
			remove: name => { this.className = this.className.split(" ").filter(it => it !== name).join(" "); }};
	}
	get isConnected () { return this === document.body || !!this.parentElement?.isConnected; }
	get options () { return this.children.filter(it => it.tagName === "OPTION"); }
	get textContent () { return this.text || this.children.map(it => it.textContent).join(""); }
	set textContent (text) { this.replaceChildren(); this.text = String(text); }
	get validity () {
		return {valid: !this.required || this.value !== ""};
	}
	getElementById (id) { return this.children.find(it => it.id === id) || this.children.map(it => it.getElementById(id)).find(Boolean); }
	setAttribute (name, value) {
		this.attributes[name] = String(value);
		if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
	}
	append (...nodes) { nodes.forEach(node => { node.remove(); this.children.push(node); node.parentElement = this; }); }
	add (option) { this.append(option); }
	remove () { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(it => it !== this); this.parentElement = null; }
	replaceChildren (...nodes) { this.children.forEach(it => { it.parentElement = null; }); this.children = []; this.text = ""; this.append(...nodes); }
	contains (node) { return this === node || this.children.some(it => it.contains(node)); }
	matches (selector) {
		const attribute = selector.match(/\[([-\w]+)(?:="([^"]*)")?\]/);
		const base = selector.replace(/\[.*?\]/g, "");
		const [tag, clazz] = base.split(".");
		return (!tag || this.tagName === tag.toUpperCase()) && (!clazz || this.className.split(" ").includes(clazz))
			&& (!attribute || (attribute[1].startsWith("data-")
				? this.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined
				: this[attribute[1]] !== undefined));
	}
	querySelectorAll (selector) { return this.children.flatMap(it => [...selector.split(",").some(sel => it.matches(sel.trim())) ? [it] : [], ...it.querySelectorAll(selector)]); }
	querySelector (selector) { return this.querySelectorAll(selector)[0] || null; }
	addEventListener (event, fn, capture = false) { this.listeners.set(event, [...this.listeners.get(event) || [], {fn, capture}]); }
	focus () { document.activeElement = this; }
	scrollIntoView (options) { this.scrollOptions = options; this.scrolledAfterFocus = document.activeElement === this; }
	async emit (type) {
		const path = [];
		for (let node = this; node; node = node.parentElement) path.push(node);
		const event = {target: this, preventDefault () {}, stopPropagation () {}};
		for (const node of [...path].reverse()) for (const listener of node.listeners.get(type) || []) if (listener.capture) await listener.fn(event);
		for (const node of path) for (const listener of node.listeners.get(type) || []) if (!listener.capture) await listener.fn(event);
	}
}
const originalGlobals = {document: globalThis.document, Option: globalThis.Option, DataUtil: globalThis.DataUtil};
let mount;
beforeEach(() => {
	globalThis.document = {body: new Node("body"),
		createElement: tag => new Node(tag),
		createTextNode: text => Object.assign(new Node(), {text}),
		getElementById: id => {
			let node = document.body.getElementById(id);
			if (!node) { node = new Node("div"); node.id = id; document.body.append(node); }
			return node;
		}};
	globalThis.Option = class extends Node { constructor (text, value) { super("option"); this.text = text; this.value = value; } };
	globalThis.DataUtil = {...originalGlobals.DataUtil,
		loadJSON: jest.fn(async path => path.includes("msbcr") ? {cr: structuredClone(table)}
			: path.includes("legendarygroups") ? JSON.parse(fs.readFileSync("data/bestiary/legendarygroups.json", "utf8")) : structuredClone(catalog)),
		generic: {...originalGlobals.DataUtil.generic, getVersions: () => []},
		race: {loadJSON: async () => ({race: []}), loadPrerelease: async () => ({}), loadBrew: async () => ({})}};
	jest.spyOn(Renderer.hover, "getMakePredefinedHover").mockReturnValue({mouseOver () {}, mouseMove () {}, mouseLeave () {}, touchStart () {}, show () {}});
	jest.spyOn(Renderer.monster, "getCompactRenderedString").mockReturnValue("<tr><td>Rendered separately in the browser phase</td></tr>");
	jest.spyOn(Renderer.get(), "render").mockImplementation(entry => JSON.stringify(entry));
	mount = document.createElement("main"); document.body.append(mount); create.mockClear();
});

// Synthetic kernel-only bundle; no source-defined family producer is implied.
function savedFixture ({withdraw = false, prefixStrength = false} = {}) {
	const base = {name: "Kernel-only frozen forms",
		source: "MM",
		type: "humanoid",
		size: ["M"],
		cr: "1",
		str: 15,
		dex: 12,
		con: 12,
		int: 10,
		wis: 10,
		cha: 8,
		profBonus: 2,
		hp: {average: 33, formula: "6d8 + 6"},
		ac: [13],
		action: [{name: "Claw", entries: ["{@hit +4} to hit. 5 ({@damage 1d6 + 2}) slashing damage."]}]};
	const patch = (id, set) => ({id, ...BestiaryQuickActionsOperations.patch({set})});
	let prefix = patch("prefix", {languages: ["Common"]});
	if (prefixStrength) {
		const resolved = {id: "catalog:prefix|tst", kind: "catalog", identity: {name: "Kernel-only prefix", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 14}], manualReview: []};
		const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: [], resolved});
		prefix = {id: "prefix", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: [], preview})};
	}
	const current = BestiaryQuickActionsUtil.applyOperations({baseCreature: base, operations: [prefix]});
	const pending = resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
	const profiles = [0, 1].map(index => {
		const rating = estimateCreatureTransformationCr({current: {...current, hp: {average: index ? 45 : 39}, ac: [index ? 17 : 14]},
			table,
			assumptions: {
				defense: {expectedCr: "1", hpBoundary: null, acIndex: 0, acAdjustment: 0, hpAdjustment: 0, resistance: "none", vulnerability: false, regeneration: 0, note: "Kernel-only fixture."},
				routines: [{id: "kernel", rounds: [8, 8, 8].map(value => ({value, proficiency: 0})), accuracy: {kind: "attack", value: 4, proficiency: 1}, note: "Kernel-only fixture."}],
				routine: "kernel",
				review: "Synthetic kernel fixture.",
				override: {cr: index ? "5" : "2", reason: "Kernel-only override."},
				zeroXp: false,
				proficiencyAnswer: null,
			}});
		const root = compileCreatureTransformation({resolved: pending, current});
		return {id: index ? "test-b" : "test-a",
			label: `Kernel-only fixture ${index ? "B" : "A"}`,
			resolved: {...root,
				selectedOptions: {...root.selectedOptions, "automation-bindings": ["zombie-dmg-m2b"], "automation-cr": ["zombie-dmg-m3"]},
				changes: [
					...root.changes.filter(it => !["setAbility", "setHitPoints", "setSaveBonus", "setSkillBonus", "setPassivePerception"].includes(it.op)),
					...compileCreatureTransformationStats({current, abilities: {str: index && withdraw ? 15 : index ? 18 : 16, con: index ? 16 : 14}, hp: {mode: "constitution"}})
						.filter(it => !(index && withdraw && it.op === "setAbility" && it.ability === "str")),
					{op: "setProficiencyBonus", value: rating.receipt.proficiency.after}, {op: "setArmorClass", value: [index ? 17 : 14]},
					{op: "setEntryNumbers", section: "action", match: {name: "Claw", source: "MM"}, entries: [`{@hit +${index ? 6 : 5}} to hit. ${index ? 7 : 6} ({@damage 1d6 + ${index ? 4 : 3}}) slashing damage. Kernel-only rider.`]}, rating,
				]}};
	});
	const resolved = normalizeCreatureTransformation(createFrozenCreatureTransformation({profiles, activeForm: "test-a", baseline: BestiaryQuickActionsUtil.getCreatureTransformationBaseline({baseCreature: base, operations: [prefix]})}));
	const conflictDecisions = prefixStrength ? {str: "incoming"} : {};
	const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: [prefix], resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions});
	const owner = {id: "form-owner", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: [prefix], preview, conflictDecisions})};
	return {base, prefix, owner, suffix: patch("suffix", {wis: 19}), patch};
}

describe("C2 saved native controls (Node DOM facade, not browser acceptance)", () => {
	const picker = () => mount.querySelector("select[data-saved-form]");
	const switchButton = () => findButton(mount, "Switch form");
	const confirmEffects = async () => {
		const node = all(mount, "input").find(it => it.type === "checkbox");
		expect(node).toBeDefined(); node.checked = true; await node.emit("change");
	};
	async function renderSaved (fixture, registry, options = {}) {
		await BestiaryQuickActionsUi._pRenderTransformation({content: mount, monster: fixture.base, registry, isCurrent: () => true, savedOperationId: fixture.owner.id, ...options});
	}
	function noLoads () {
		DataUtil.loadJSON.mockImplementation(() => { throw new Error("No catalog/table available"); });
		DataUtil.race.loadJSON = jest.fn(() => { throw new Error("No races available"); });
		jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
	}

	it("forwards the full exclusive proposal through actual Quick Actions -> Registry for A/B/A/B, stable owner/order/values and no-op/removal", async () => {
		const fixture = savedFixture();
		const {base, prefix, owner, suffix} = fixture;
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({monster: base, addOperations: [prefix, owner, suffix]});
		const apply = jest.spyOn(registry, "applyChanges");
		const notified = jest.fn(); registry.subscribe(notified);
		noLoads();
		await renderSaved(fixture, registry);
		expect(picker().options.map(it => it.textContent)).toEqual(["Kernel-only fixture A", "Kernel-only fixture B"]);
		expect(mount.textContent).toContain("Zombie (DMG)");
		expect(mount.textContent).toContain("position 2 of 3");
		expect(switchButton().disabled).toBe(true);
		await switchButton().emit("click");
		expect(apply).not.toHaveBeenCalled();
		for (const form of ["test-b", "test-a", "test-b"]) {
			const before = registry.getOperations({monster: base});
			await edit(picker(), form);
			expect(mount.textContent).toContain(form === "test-b" ? "45" : "39");
			await switchButton().emit("click");
			const history = registry.getOperations({monster: base});
			expect(history.map(it => it.id)).toEqual(["prefix", "form-owner", "suffix"]);
			expect(JSON.stringify([history[0], history[2]])).toBe(JSON.stringify([prefix, suffix]));
			expect(history[1].data.resolved.frozenForms.activeForm).toBe(form);
			expect(registry.getCreature({monster: base})).toMatchObject({
				str: form === "test-b" ? 18 : 16,
				con: form === "test-b" ? 16 : 14,
				wis: 19,
				hp: {average: form === "test-b" ? 45 : 39, formula: form === "test-b" ? "6d8 + 18" : "6d8 + 12"},
				ac: [form === "test-b" ? 17 : 14],
				cr: {cr: form === "test-b" ? "5" : "2", xp: form === "test-b" ? 1800 : 450}});
			expect(registry.getCreature({monster: base}).action[0].entries[0]).toBe(form === "test-b"
				? "{@hit +6} to hit. 7 ({@damage 1d6 + 4}) slashing damage. Kernel-only rider."
				: "{@hit +5} to hit. 6 ({@damage 1d6 + 3}) slashing damage. Kernel-only rider.");
			const forwarded = apply.mock.calls.at(-1)[0];
			expect(forwarded).toEqual({monster: base, id: "current", addOperations: [], removeIds: [], replaceOperation: {operationId: owner.id, expectedIntegrity: before[1].data.integrity, operation: history[1]}});
			expect(history[1].data.resolved.frozenForms.profiles).toEqual(owner.data.resolved.frozenForms.profiles);
			expect(document.activeElement).toBe(picker());
		}
		expect(notified).toHaveBeenCalledTimes(3);
		expect(DataUtil.loadJSON).not.toHaveBeenCalled();
		expect(DataUtil.race.loadJSON).not.toHaveBeenCalled();
		registry.removeOperation({monster: base, operationId: owner.id});
		expect(registry.getCreature({monster: base})).toEqual({...base, languages: ["Common"], wis: 19});
	});

	it("reaches actual Encounter callbacks -> adapter -> State -> real Store with slot-100 replacement, exact consequence review, rejected-write retry and reload", async () => {
		const fixture = savedFixture();
		const {base, prefix, owner, suffix, patch} = fixture;
		let next = 0;
		let state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "C2 kernel-only", items: [{h: "kernel_mm", c: 3}]}, pResolveItem: async () => ({entity: base}), fnUid: () => `one-${++next}`});
		const history = [prefix, owner, suffix, ...Array.from({length: 97}, (_, i) => patch(`extra-${i}`, {wis: 19}))];
		state = EncounterWorkspaceState.withStatblockChanges(state, state.instances.map((it, i) => ({id: it.id, addOperations: i ? [prefix, owner, suffix] : history, removeIds: []}))).state;
		state = EncounterWorkspaceState.withHp(state, {id: "one-1", prop: "current", value: 4});
		state = EncounterWorkspaceState.withHp(state, {id: "one-1", prop: "temp", value: 6});
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["one-1", "one-2", "one-3"], id: "shared-kernel"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "shared-kernel", isShared: true, total: 16});
		state = EncounterWorkspaceState.withTurn(state, "start");
		const storage = {pSetForPage: jest.fn(async (key, value) => { storage.saved = structuredClone(value); }), pGetForPage: async () => storage.saved};
		const store = new EncounterWorkspaceStore({storage});
		await store.pSave(state); storage.pSetForPage.mockClear();
		const page = Object.create(EncounterWorkspacePage.prototype);
		Object.assign(page, {_state: state,
			_store: store,
			_hpUndo: [[{id: "one-1"}], [{id: "one-2"}]],
			_setBusy: jest.fn(),
			_render: jest.fn(),
			_clearInitiativeMove: jest.fn(),
			_clearRollResults: jest.fn(),
			_setStatus: jest.fn(),
			_setError: jest.fn(),
			_getTargetNames: () => "Kernel fixture"});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one-1", getState: () => page._state, pCommit: result => page._pCommitStatblockEdit(result)});
		const apply = jest.spyOn(adapter, "applyChanges");
		const notified = jest.fn(); adapter.subscribe(notified);
		noLoads();
		const callbacks = page._getTransformationEditorCallbacks("one-1");
		expect(() => callbacks.validateOperation({target: {baseCreature: base, operations: history}, operation: patch("append", {wis: 19})})).toThrow(/100-operation/);
		expect(() => callbacks.validateChange({target: {baseCreature: base}, operations: [patch("large", {languages: ["x".repeat(200_001)]})]})).toThrow(/invalid statblock operation/i);
		await renderSaved(fixture, adapter, callbacks);
		await switchButton().emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		await edit(picker(), "test-b"); await switchButton().emit("click");
		const review = all(mount, "div").find(it => it.attributes["aria-label"] === "Encounter consequences to review");
		expect(review.hidden).toBe(false); expect(document.activeElement).toBe(review);
		expect(storage.pSetForPage).not.toHaveBeenCalled(); expect(notified).not.toHaveBeenCalled();
		expect(page._state).toBe(state); expect(page._hpUndo).toHaveLength(2);
		const reviewedText = review.textContent;
		page._state = EncounterWorkspaceState.withGroupSplit(page._state, {id: "one-3"});
		await confirmEffects(); await switchButton().emit("click");
		expect(review.textContent).toBe(reviewedText);
		expect(all(mount, "input")[0].checked).toBe(false);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		const before = page._state;
		storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
		await confirmEffects(); await switchButton().emit("click");
		expect(mount.textContent).toContain("Storage full");
		expect(page._state).toBe(before); expect(page._hpUndo).toHaveLength(2);
		expect(adapter.getOperations()).toEqual(history);
		expect(notified).not.toHaveBeenCalled(); expect(page._render).not.toHaveBeenCalled(); expect(JqueryUtil.doToast).not.toHaveBeenCalled();
		let release; let onStarted;
		const started = new Promise(resolve => { onStarted = resolve; });
		storage.pSetForPage.mockImplementationOnce(async (key, value) => {
			await new Promise(resolve => { release = resolve; onStarted(); });
			storage.saved = structuredClone(value);
		});
		const pending = switchButton().emit("click");
		await started;
		expect(picker().disabled).toBe(true); expect(switchButton().disabled).toBe(true);
		release(); await pending;
		expect(storage.pSetForPage).toHaveBeenCalledTimes(2); expect(notified).toHaveBeenCalledTimes(1);
		expect(page._hpUndo).toEqual([[{id: "one-2"}]]); expect(page._clearInitiativeMove).toHaveBeenCalledTimes(1);
		const reloaded = await store.pLoad(); page._state = reloaded;
		expect(reloaded.instances[0].hp).toEqual({current: 45, max: 45, temp: 6});
		expect(reloaded.instances[0].monster).toEqual(base);
		expect(reloaded.instances[0].statblockOperations).toHaveLength(100);
		expect(reloaded.instances[0].statblockOperations.map(it => it.id)).toEqual(history.map(it => it.id));
		expect(JSON.stringify(reloaded.instances[0].statblockOperations.slice(2))).toBe(JSON.stringify(history.slice(2)));
		expect(getEncounterEffectiveMonster(reloaded.instances[0])).toMatchObject({str: 18, ac: [17], cr: {cr: "5", xp: 1800}});
		expect(apply.mock.calls.at(-1)[0]).toEqual({monster: base, id: "current", addOperations: [], removeIds: [], replaceOperation: {operationId: owner.id, expectedIntegrity: owner.data.integrity, operation: reloaded.instances[0].statblockOperations[1]}});
		expect(reloaded.groups).toEqual([{id: "shared-kernel", memberIds: ["one-2"], sharedTurn: true, initiative: 16}]);
		expect(reloaded.turn).toEqual({round: 1, activeId: "shared-kernel"});
		await renderSaved(fixture, adapter, callbacks);
		await edit(picker(), "test-a"); await switchButton().emit("click"); await confirmEffects();
		page._render.mockImplementationOnce(() => { throw new Error("Refresh unavailable"); });
		await switchButton().emit("click");
		expect(mount.textContent).toContain("were saved"); expect(mount.textContent).toContain("Reload");
		expect(mount.textContent).not.toContain("was not switched"); expect(switchButton().disabled).toBe(true);
		page._state = await store.pLoad();
		expect(getEncounterEffectiveMonster(page._state.instances[0]).str).toBe(16);
		await adapter.removeOperation({operationId: owner.id});
		page._state = await store.pLoad();
		expect(adapter.getCreature()).toEqual({...base, languages: ["Common"], wis: 19});
		expect(page._state.instances[0].hp).toEqual({current: 33, max: 33, temp: 6});
		expect(DataUtil.loadJSON).not.toHaveBeenCalled();
	});

	it.each([false, true])("blocks changed or disappearing downstream conflicts in native preview (withdraw=%s)", async withdraw => {
		const fixture = savedFixture({withdraw});
		const {base, prefix, owner} = fixture;
		const resolved = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later kernel-only", source: "TST"}, provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 20}], manualReview: []};
		const preview = BestiaryQuickActionsUtil.previewCreatureTransformation({baseCreature: base, operations: [prefix, owner], resolved, conflictDecisions: {str: "existing"}});
		const later = {id: "later", ...BestiaryQuickActionsUtil.createCreatureTransformationOperation({baseCreature: base, operations: [prefix, owner], preview, conflictDecisions: {str: "existing"}})};
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({monster: base, addOperations: [prefix, owner, later]});
		const apply = jest.spyOn(registry, "applyChanges");
		noLoads(); await renderSaved(fixture, registry); await edit(picker(), "test-b");
		expect(mount.textContent).toMatch(/conflict.*changed/i); expect(switchButton().disabled).toBe(true);
		await switchButton().emit("click");
		expect(apply).not.toHaveBeenCalled(); expect(registry.getOperations({monster: base})).toEqual([prefix, owner, later]);
	});

	it("requires owner conflict winners, clears them on form edits and fences a changed suffix before a write", async () => {
		const fixture = savedFixture({prefixStrength: true});
		const {base, prefix, owner, suffix, patch} = fixture;
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({monster: base, addOperations: [prefix, owner, suffix]});
		noLoads(); await renderSaved(fixture, registry);
		await edit(picker(), "test-b");
		expect(switchButton().disabled).toBe(true);
		let winner = all(mount, "select").find(it => it.dataset.conflictPath === "str");
		await edit(winner, "incoming");
		expect(document.activeElement.dataset.conflictPath).toBe("str");
		expect(switchButton().disabled).toBe(false);
		await edit(picker(), "test-a"); await edit(picker(), "test-b");
		winner = all(mount, "select").find(it => it.dataset.conflictPath === "str");
		expect(winner.value).toBe("");
		await edit(winner, "incoming");
		registry.applyChanges({monster: base, addOperations: [patch("new-suffix", {languages: ["Common", "Elvish"]})]});
		const apply = jest.spyOn(registry, "applyChanges");
		await switchButton().emit("click");
		expect(mount.textContent).toContain("whole history changed");
		expect(apply).not.toHaveBeenCalled();
		expect(registry.getOperations({monster: base})[1]).toEqual(owner);
	});

	it("opens from real saved history before loading, restores cancel/save focus, and invalidates a closed modal", async () => {
		const fixture = savedFixture();
		const {base, prefix, owner, suffix} = fixture;
		const registry = new BestiaryQuickActionsRegistry();
		registry.applyChanges({monster: base, addOperations: [prefix, owner, suffix]});
		noLoads();
		const parent = document.createElement("div");
		const inner = document.createElement("div"); const footer = document.createElement("div");
		parent.append(inner, footer); document.body.append(parent);
		let close;
		jest.spyOn(UiUtil, "getShowModal").mockImplementation(({cbClose}) => {
			close = cbClose; return {eleModalInner: inner, eleModalFooter: footer, doClose: () => close()};
		});
		jest.spyOn(BestiaryQuickActionsUi, "_pRenderMinion").mockResolvedValue();
		await BestiaryQuickActionsUi.pOpen({monster: base, registry});
		mount = inner.querySelector(".bqa__content");
		const historyAction = () => inner.querySelector("button[data-saved-operation-id]");
		expect(historyAction().attributes["aria-label"]).toContain("Zombie (DMG)");
		await historyAction().emit("click");
		expect(document.activeElement).toBe(picker());
		expect(picker().scrollOptions).toEqual({block: "nearest", inline: "nearest"});
		expect(picker().scrolledAfterFocus).toBe(true);
		await findButton(mount, "Cancel").emit("click");
		expect(document.activeElement).toBe(historyAction());
		expect(historyAction().scrollOptions).toEqual({block: "nearest", inline: "nearest"});
		expect(historyAction().scrolledAfterFocus).toBe(true);
		await historyAction().emit("click"); await edit(picker(), "test-b"); await switchButton().emit("click");
		expect(picker().value).toBe("test-b"); expect(document.activeElement).toBe(picker());
		expect(picker().scrollOptions).toEqual({block: "nearest", inline: "nearest"});
		expect(picker().scrolledAfterFocus).toBe(true);
		expect(inner.textContent).toContain("Saved form: Kernel-only fixture B");
		await edit(picker(), "test-a");
		const stale = switchButton();
		await findButton(historyAction().parentElement.parentElement, "Remove").emit("click");
		expect(registry.getCreature({monster: base})).toEqual({...base, languages: ["Common"], wis: 19});
		expect(registry.getOperations({monster: base}).map(it => it.id)).toEqual(["prefix", "suffix"]);
		expect(mount.textContent).toContain("no longer exists");
		const apply = jest.spyOn(registry, "applyChanges");
		await findButton(footer, "Done").emit("click"); await stale.emit("click");
		expect(apply).not.toHaveBeenCalled(); expect(DataUtil.loadJSON).not.toHaveBeenCalled();
	});
});
afterEach(() => { jest.restoreAllMocks(); Object.assign(globalThis, originalGlobals); });

const all = (root, tag) => root.querySelectorAll(tag);
const findButton = (root, text) => all(root, "button").find(it => it.textContent === text);
const findField = (root, label) => all(root, "label").find(it => it.children[0]?.textContent === label)?.children[1];
const edit = async (node, value) => { expect(node).toBeDefined(); node.value = String(value); await node.emit(node.tagName === "SELECT" ? "change" : "input"); };
const choose = async (id = "catalog:zombie|dmg") => {
	const picker = all(mount, "select").find(it => it.attributes["aria-label"] === "Creature transformation");
	if (!picker?.options.some(it => it.value === id)) throw new Error(`Missing candidate ${id}: ${mount.textContent}`);
	await edit(picker, id);
};
const target = (baseCreature = source("Bugbear")) => ({id: "current", label: baseCreature.name, baseCreature, operations: []});
async function open ({subject = target(), registry = new BestiaryQuickActionsRegistry(), load = async () => candidates, ...options} = {}) {
	const getTargets = () => [{...subject, operations: registry.getOperations({monster: subject.baseCreature})}];
	await pRenderCreatureTransformationEditor({mount,
		automationVersion: 2,
		getTargets,
		pLoadCandidates: load,
		pApply: changes => registry.applyChanges({monster: subject.baseCreature, ...changes[0]}),
		...options});
	return {subject, registry, getTargets};
}

async function fillBindings (root, entries, current, {sourceStage = false} = {}) {
	const armor = findField(root, "Armor policy");
	if (armor) await edit(armor, "retain");
	if (sourceStage && findField(root, "Declare a current source PB?")) {
		await edit(findField(root, "Declare a current source PB?"), "declare");
		await edit(findField(root, "Current source PB"), String(Parser.crToPb(current.cr?.cr ?? current.cr)));
	}
	for (const entry of entries.filter(it => it.needsBinding)) {
		const panel = all(root, "details").find(it => it.children[0]?.textContent === `${entry.section}: ${entry.match.name} (${entry.match.source})`);
		expect(panel).toBeDefined();
		const policy = findField(panel, "Entry policy");
		if (policy) await edit(policy, entry.supported ? "bind" : "retain");
		if (!entry.supported) continue;
		for (const [i, row] of panel.querySelectorAll(".bqa__transformation-resolution-row").entries()) {
			const interpretation = findField(row, "Token interpretation");
			if (!interpretation) continue;
			const token = entry.tokens[i];
			if (!sourceStage || entry.section !== "action") await edit(interpretation, "fixed");
			else {
				await edit(interpretation, "ability");
				await edit(findField(row, "Governing ability"), "str");
				const multiplier = token.kind === "hit" ? 1 : 0;
				await edit(findField(row, "Token PB multiplier"), String(multiplier));
				await edit(findField(row, "Fixed non-ability / non-PB contribution"), String(token.value - Parser.getAbilityModNumber(current.str) - multiplier * Parser.crToPb(current.cr?.cr ?? current.cr)));
			}
		}
	}
}

async function fillEstimate (root, form, {attack = "Morningstar", fixedDamage = null} = {}) {
	await fillBindings(root, form.entries, form.current);
	await edit(findField(root, "Post-source armor reason"), "Retain the actual post-source armor.");
	for (const section of ["save", "skill"]) {
		for (const [name, value] of Object.entries(form.current[section] || {})) {
			const input = findField(root, `${section}: ${name}, observed ${value} - PB multiplier`);
			if (input) await edit(input, name === "stealth" ? "2" : "1");
		}
	}
	for (const node of all(root, "label")) {
		if (node.children[0]?.textContent.endsWith("review (including absence / conditions)")) {
			await edit(node.children[1], "Reviewed the actual post-source defense, conditions and absent alternatives.");
		}
	}
	for (const [label, value] of [
		["Expected CR band (deliberately adopt or edit)", "1"], ["AC alternative to evaluate", "0"], ["Effective resistance policy", "none"],
		["Prevalent multiple vulnerabilities?", "no"], ["Applicable regeneration per round", "0"], ["Estimate-only effective HP adjustment", "0"], ["Estimate-only effective AC adjustment", "0"],
		["Defense policy and reviewed feature adjustments", "No relevant multipliers or regeneration; all features reviewed."],
	]) await edit(findField(root, label), value);
	const selected = form.entries.find(entry => entry.match.name === attack && entry.section === "action");
	const coverage = all(root, "details").find(it => it.children[0]?.textContent === "Entry and numeric-token accounting");
	for (const entry of form.entries) {
		const panel = all(coverage, "details").find(it => it.children[0]?.textContent === `${entry.section}: ${entry.match.name} (${entry.match.source})`);
		await edit(findField(panel, "Entry contribution to estimate"), entry === selected && fixedDamage === null ? "represented" : "excluded");
		await edit(findField(panel, `${entry.match.name} coverage reason`), entry === selected ? "Included attack and every damage rider." : "Reviewed exclusion from this encounter routine; source rules remain present.");
		if (entry.tokens.length) await findButton(panel, "Use this entry decision and reason for its unreviewed tokens").emit("click");
	}
	await findButton(root, "Add alternative routine").emit("click");
	const accuracy = selected?.tokens.find(token => ["hit", "dc"].includes(token.kind));
	await edit(findField(root, "Predominant attack / save accuracy"), fixedDamage === null && accuracy ? accuracy.id : "fixed");
	if (fixedDamage !== null || !accuracy) {
		await edit(findField(root, "Fixed accuracy kind"), "attack");
		await edit(findField(root, "Fixed accuracy value"), "0");
		await edit(findField(root, "Fixed accuracy reason"), "No attack or save in this explicitly adjudicated routine.");
	}
	await edit(findField(root, "Predominant / mixed-accuracy explanation"), "Morningstar attack.");
	await edit(findField(root, "Routine source and schedule explanation"), "One melee attack per round.");
	const damage = fixedDamage === null ? selected.tokens.filter(token => token.kind === "damage") : [null];
	for (const token of damage) {
		await findButton(root, "Add contribution").emit("click");
		const row = root.querySelectorAll("fieldset").filter(it => it.className === "bqa__transformation-resolution-row").at(-1);
		await edit(findField(row, "Damage contribution"), token?.id ?? "fixed");
		if (!token) {
			await edit(findField(row, "Fixed per-use value"), String(fixedDamage));
			await edit(findField(row, "Fixed contribution reason"), "Actual form has no damage actions in this routine.");
		}
		await edit(findField(row, "Timing / use restriction"), "normal");
		await edit(findField(row, "Contribution schedule reason"), "One attack, one target.");
		for (let i = 1; i <= 3; ++i) {
			await edit(findField(row, `Round ${i} uses`), "1");
			await edit(findField(row, `Round ${i} targets`), "1");
		}
	}
	await edit(findField(root, "Routine selection policy"), "highest-damage");
	await edit(findField(root, "Final CR0 no-threat 0 XP policy?"), "no");
	await edit(findField(root, "All relevant effects and complete alternatives reviewed?"), "yes");
	await edit(findField(root, "Completeness explanation (never auto-authored)"), "All effects and alternatives deliberately reviewed.");
}

async function fillBugbear (root = mount.querySelector(".bqa__transformation-resolution"), subject = target()) {
	const resolved = resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
	const model = inspectCreatureTransformationSourceInputs({target: subject, resolved});
	const sourceRoot = all(root, "details").find(it => it.children[0]?.textContent === "Source choices");
	await fillBindings(sourceRoot, model.entries, model.current, {sourceStage: true});
	await edit(findField(sourceRoot, "Armor and numeric declarations source reason"), "Zombie retains equipment.");
	const control = model.controls.find(control => control.path[0] === "bindings");
	const sourceBindings = {armor: {mode: "retain"},
		proficiencyBonus: Parser.crToPb(model.current.cr?.cr ?? model.current.cr),
		entries: model.entries.filter(entry => entry.needsBinding).map(entry => ({section: entry.section,
			match: entry.match,
			...entry.supported ? {mode: "bind",
				numbers: entry.tokens.map(token => ({
					paragraph: token.paragraph,
					kind: token.kind,
					token: token.token,
					...token.dice ? {dice: token.dice} : {},
					...entry.section === "action" ? {mode: "ability",
						ability: "str",
						proficiency: token.kind === "hit" ? 1 : 0,
						fixed: token.value - Parser.getAbilityModNumber(model.current.str) - (token.kind === "hit" ? sourceBindingsPb(model.current) : 0)}
						: {mode: "fixed", value: token.value},
				}))} : {mode: "retain"}}))};
	const preview = previewCreatureTransformationSourceInputs({target: subject, resolved, answers: {mode: SOURCE_ESTIMATE_MODE, targetKey: model.targetKey, source: {[control.id]: {value: sourceBindings, reason: "Zombie retains equipment."}}}});
	expect(preview.requirements).toEqual([]);
	await fillEstimate(all(root, "details").find(it => it.dataset.estimateForm === "default"), preview.forms[0]);
}
const sourceBindingsPb = current => Parser.crToPb(current.cr?.cr ?? current.cr);
async function consent () {
	const apply = findButton(mount, "Apply transformation");
	if (!apply) throw new Error(`No Apply: ${mount.querySelector(".bqa__transformation-error")?.textContent}; ${mount.querySelector(".bqa__transformation-resolution-error")?.textContent}`);
	await apply.emit("click");
	for (const node of mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input")) { node.checked = true; await node.emit("change"); }
}

async function fillSourceControl (root, control, model, resolved) {
	const [namespace, key = namespace] = control.path;
	if (!control.required) {
		if (key !== "bindings") return;
		await edit(all(root, "select")[0], "declare");
	}
	if (key === "bindings") {
		const armor = findField(root, "Armor policy");
		if (armor) await edit(armor, "retain");
		const pb = findField(root, "Current source PB");
		if (pb && !findField(root, "Declare a current source PB?")) await edit(pb, sourceBindingsPb(model.current));
		for (const label of all(root, "label")) if (label.children[0]?.textContent === "Entry policy") await edit(label.children[1], "retain");
	} else if (key === "physiology" || key === "breaths") {
		for (const entry of control.facts.filter(entry => key === "physiology" || /\bbreath\b/i.test(entry.match.name))) {
			await edit(findField(root, `${entry.match.name} policy`), key === "breaths" || entry.match.name === "Amphibious" ? "remove" : "retain");
		}
	} else if (["batEntries", "hybrid", "animal"].includes(key)) {
		if (key !== "batEntries") {
			await edit(findField(root, "Form equipment AC policy"), "retain");
			await edit(findField(root, "Form armor reason"), "Explicitly retained source equipment.");
		}
		for (const label of all(root, "label")) {
			if (label.children[0]?.textContent === "Requires speech?") await edit(label.children[1], "no");
			if (label.children[0]?.textContent === "Equipment in this form") await edit(label.children[1], "not-required");
		}
	} else {
		const values = {age: "adult",
			trueDragon: "yes",
			shadowDragon: "no",
			lair: "retain",
			donor: "actual",
			wyrmling: "yes",
			adaptation: resolved.automation.profile === "wereshark" ? "arcadia27-template" : "sidebar-npc",
			embrace: "no",
			legendaryResistance: "grant",
			shadowfell: "years"};
		if (key === "stealth") {
			await edit(findField(root, "Current Stealth PB multiplier"), "1");
			await edit(findField(root, "Current Stealth non-PB residual"), "0");
		} else if (["proficiencyBonus", "grappleDc"].includes(key)) await edit(all(root, "input")[0], key === "grappleDc" ? 14 : sourceBindingsPb(model.current));
		else if (values[key] !== undefined) await edit(all(root, "select")[0], values[key]);
		else throw new Error(`Missing native fixture decision: ${control.path.join(".")}`);
	}
	await edit(all(root, "textarea").at(-1), "Deliberately reviewed this actual source clause and target.");
}

describe("M13b finite shared native source controls", () => {
	it.each([
		["half-dragon|mm", "Bugbear", {ancestry: ["red"], size: ["large-or-smaller"]}],
		["shadow dragon|mm", "Young Black Dragon", {}], ["dracolich|mm", "Adult Black Dragon", {}],
		["spore servant|mm", "Bugbear", {}], ["vampire|mm", "Bugbear", {outcome: ["vampire"]}],
		["lycanthropy|mm", "Bugbear", {form: ["werewolf"]}], ["skeleton|dmg", "Bugbear", {}],
		["zombie|dmg", "Bugbear", {}], ["wereshark|arcadia27", "Bugbear", {}],
		["skeletal wyrmling|ar8", "Black Dragon Wyrmling", {}], ["shadow dragon|beg", "Young Black Dragon", {}],
		["fey beast|scre", "Wolf", {features: ["barkskin"]}], ["fallen angel|scre", "Deva", {allegiance: ["fallen"]}],
		["undead|scre", "Bugbear", {category: ["zombie"]}],
	])("%s renders finite controls that compile actual source forms", async (uid, name, selections) => {
		const subject = target(source(name));
		const resolved = resolveCreatureTransformation({candidates, id: `catalog:${uid}`, selections, automationVersion: 2});
		const groups = JSON.parse(fs.readFileSync("data/bestiary/legendarygroups.json", "utf8")).legendaryGroup;
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => groups});
		panel.read();
		for (const control of panel.model.controls) {
			const root = all(mount, "details").find(node => node.dataset.sourceControl === control.id);
			await fillSourceControl(root, control, panel.model, resolved);
		}
		const preview = previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read(), legendaryGroups: groups});
		expect(preview.requirements).toEqual([]);
		expect(preview.status).toBe("source-ready");
		expect(all(mount, "details").filter(node => node.dataset.estimateForm).map(node => node.dataset.estimateForm)).toEqual(preview.forms.map(form => form.id));
		expect(preview.source.changes?.length || preview.source.frozenForms?.profiles.length).toBeGreaterThan(0);
		for (const node of all(mount, "label").filter(node => node.children[0]?.textContent === "All relevant effects and complete alternatives reviewed?")) expect(node.children[1].value).toBe("");
		if (uid.startsWith("spore servant")) expect(JSON.stringify(preview.forms[0].current.action)).toContain("1d8 + 2");
		if (uid.startsWith("skeletal wyrmling")) expect(preview.forms[0].current.action.some(entry => /Breath/.test(entry.name))).toBe(false);
		if (uid.startsWith("shadow dragon")) expect(preview.forms[0].sourceProficiencies.skill.stealth).toBe(2);
		console.log(`NATIVE SOURCE ${uid}: real finite controls -> compiler; forms=${preview.forms.map(form => form.id).join(",")}; no review or consent auto-confirmed.`);
	});

	it("keeps all Devilsworn riders meaningful; zero uses, omitted rows and unlinked fixed totals cannot claim representation", async () => {
		const subject = target(source("Planetar"));
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:fallen angel|scre", selections: {allegiance: ["devilsworn"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		const forms = previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()}).forms;
		await fillEstimate(all(mount, "details").find(node => node.dataset.estimateForm), forms[0], {attack: "Greatsword"});
		const run = () => compileCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read(), table});
		expect(run().estimates[0].receipt.damagePerRound).toBe(43);
		const rows = () => mount.querySelectorAll("fieldset").filter(node => node.className === "bqa__transformation-resolution-row");
		const rider = rows().at(-1);
		for (let i = 1; i <= 3; i++) await edit(findField(rider, `Round ${i} uses`), 0);
		expect(run().requirements[0].reason).toMatch(/represented damage.*positive use|represented damage.*adjudication/i);
		await findButton(rider, "Remove contribution").emit("click");
		expect(run().status).toBe("needs-answers");
		await findButton(mount, "Add contribution").emit("click");
		const fixed = rows().at(-1);
		await edit(findField(fixed, "Damage contribution"), "fixed");
		for (const [label, value] of [["Fixed per-use value", 22], ["Fixed contribution reason", "Exact source fire rider."], ["Timing / use restriction", "normal"],
			["Contribution schedule reason", "One positive use per round."]]) await edit(findField(fixed, label), value);
		for (let i = 1; i <= 3; i++) {
			await edit(findField(fixed, `Round ${i} uses`), 1);
			await edit(findField(fixed, `Round ${i} targets`), 1);
		}
		expect(run().status).toBe("needs-answers");
		const link = all(fixed, "label").find(node => /Accounts for Greatsword .*damage 2\?$/.test(node.children[0]?.textContent));
		await edit(link.children[1], "yes");
		expect(run().estimates[0].receipt.damagePerRound).toBe(43);
	});

	it("completes inactive Vampire bat/mist estimates and discards dependent judgments, not typing focus, after a source value changes", async () => {
		const subject = target();
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:vampire|mm", selections: {outcome: ["vampire"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		for (const control of panel.model.controls) await fillSourceControl(all(mount, "details").find(node => node.dataset.sourceControl === control.id), control, panel.model, resolved);
		const sourcePreview = () => previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		const forms = sourcePreview().forms;
		const compile = () => compileCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read(), table});
		expect(forms.map(form => form.id)).toEqual(["true", "bat", "mist"]);
		for (const form of forms) {
			await fillEstimate(all(mount, "details").find(node => node.dataset.estimateForm === form.id), form,
				form.id === "mist" ? {fixedDamage: 0} : {attack: "Bite (Bat or Vampire Form Only)"});
			if (form.id !== "mist") expect(compile().status).toBe("needs-answers");
		}
		const complete = compile();
		expect(complete.status).toBe("ready");
		expect(complete.estimates.map(estimate => estimate.form)).toEqual(["true", "bat", "mist"]);
		expect(complete.estimates[2].receipt.damagePerRound).toBe(0);
		const oldReview = findField(all(mount, "details").find(node => node.dataset.estimateForm === "bat"), "All relevant effects and complete alternatives reviewed?");
		const dc = findField(mount, "Fixed grapple escape DC (no source formula is defined)");
		dc.focus();
		await edit(dc, 15);
		expect(document.activeElement).toBe(dc);
		expect(dc.isConnected).toBe(true);
		expect(oldReview.isConnected).toBe(false);
		expect(compile().status).toBe("needs-answers");
		expect(findField(all(mount, "details").find(node => node.dataset.estimateForm === "bat"), "All relevant effects and complete alternatives reviewed?").value).toBe("");
	});

	it("binds Spore's actual cleaned dice and independently classifies a nonphysical equipment rider", async () => {
		const current = source("Bugbear");
		current.action[0].entries[0] = current.action[0].entries[0].replace("piercing damage.", "piercing damage plus 3 ({@damage 1d6}) fire damage.");
		const subject = target(current);
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:spore servant|mm", automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		panel.read();
		const equipment = panel.model.controls.find(control => control.path[1] === "equipmentDamage");
		const equipmentRoot = all(mount, "details").find(node => node.dataset.sourceControl === equipment.id);
		await edit(all(equipmentRoot, "select")[0], "declare");
		await edit(all(equipmentRoot, "select")[1], "no");
		await edit(all(equipmentRoot, "textarea").at(-1), "The fire rider is not equipment damage.");
		const bindings = panel.model.controls.find(control => control.path[1] === "bindings");
		const bindingsRoot = all(mount, "details").find(node => node.dataset.sourceControl === bindings.id);
		await fillSourceControl(bindingsRoot, bindings, panel.model, resolved);
		expect(bindingsRoot.textContent).toContain("1d8");
		expect(bindingsRoot.textContent).not.toContain("2d8, printed");
		const melee = all(bindingsRoot, "details").find(node => node.children[0]?.textContent === "action: Morningstar (MM)");
		await edit(findField(melee, "Entry policy"), "bind");
		for (const row of melee.querySelectorAll(".bqa__transformation-resolution-row")) await edit(findField(row, "Token interpretation"), "fixed");
		const preview = previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		expect(preview.requirements).toEqual([]);
		expect(preview.forms[0].current.action[0].entries[0]).toContain("6 ({@damage 1d8 + 2})");
		expect(preview.forms[0].current.action[0].entries[0]).not.toContain("fire damage");
	});

	it("does not mistake unanswered optional Undead clause decisions for deliberate exclusions", async () => {
		const subject = target();
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:undead|scre", selections: {category: ["zombie"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		for (const control of panel.model.controls) await fillSourceControl(all(mount, "details").find(node => node.dataset.sourceControl === control.id), control, panel.model, resolved);
		const control = panel.model.controls.find(control => control.path[1] === "additionalTraits");
		const body = all(mount, "details").find(node => node.dataset.sourceControl === control.id);
		const preview = () => previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		expect(preview().status).toBe("source-ready");
		await edit(all(body, "select")[0], "declare");
		await edit(all(body, "textarea").at(-1), "Each additional source clause is deliberately declined.");
		const decisions = all(body, "select").slice(1);
		await edit(decisions[0], "no");
		expect(preview().status).toBe("needs-answers");
		for (const select of decisions.slice(1)) await edit(select, "no");
		expect(preview().status).toBe("source-ready");
	});

	it("makes an unresolved Undead movement branch actionable and retains its real conditional alternative", async () => {
		const current = source("Bugbear");
		current.speed = {walk: {number: 30, condition: "while corporeal"}, swim: 20, alternate: {walk: [{number: 40, condition: "on moonlit ground"}]}};
		const subject = target(current);
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:undead|scre", selections: {category: ["ghostly"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		const declare = async (key, value) => {
			const control = panel.model.controls.find(control => control.path[1] === key);
			const body = all(mount, "details").find(node => node.dataset.sourceControl === control.id);
			await edit(all(body, "select")[0], "declare");
			await edit(all(body, "select")[1], value);
			await edit(all(body, "textarea").at(-1), "Reviewed the actual source clause and conditional branch.");
		};
		for (const control of panel.model.controls) await fillSourceControl(all(mount, "details").find(node => node.dataset.sourceControl === control.id), control, panel.model, resolved);
		await declare("ghostAbility", "str");
		await declare("ghostDamage", "force");
		const weapons = all(mount, "details").find(node => node.dataset.sourceControl === panel.model.controls.find(control => control.path[1] === "ghostWeapons").id);
		await edit(all(weapons, "select")[0], "declare");
		for (const input of all(weapons, "select").slice(1)) await edit(input, "yes");
		await edit(all(weapons, "textarea").at(-1), "Convert every physical weapon component to force.");
		const preview = () => previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		let result = preview();
		expect(result.status).toBe("needs-answers");
		expect(result.requirements[0].reason).toContain("ghostFlight");
		panel.update(result);
		const flight = panel.model.controls.find(control => control.path[1] === "ghostFlight");
		const body = all(mount, "details").find(node => node.dataset.sourceControl === flight.id);
		body.open = false;
		panel.focus();
		expect(body.open).toBe(true);
		expect(document.activeElement).toBe(all(body, "select")[0]);
		await declare("ghostFlight", JSON.stringify({mode: "walk", alternate: 0}));
		result = preview();
		expect(result.requirements).toEqual([]);
		expect(result.forms[0].current.speed).toEqual({walk: 0, fly: 20, canHover: true, alternate: {fly: [{number: 40, condition: "on moonlit ground"}]}});
	});

	it("exposes finite ambiguous Fallen weapon components and preserves declared Healing Touch rest usage", async () => {
		const current = source("Deva");
		current.trait.find(entry => entry.name === "Angelic Weapons").entries.push("Its separate aura deals 3 ({@damage 1d6}) radiant damage.");
		current.action.find(entry => entry.name.startsWith("Healing Touch")).name = "Healing Touch";
		const subject = target(current);
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:fallen angel|scre", selections: {allegiance: ["devilsworn"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		const controlRoot = key => all(mount, "details").find(node => node.dataset.sourceControl === panel.model.controls.find(control => control.path[1] === key).id);
		const weapons = controlRoot("weapons");
		await edit(findField(weapons, "Angelic Weapons trait"), "0");
		await edit(findField(weapons, "Actual radiant trait component"), JSON.stringify({trait: 0, token: 0}));
		for (const input of all(weapons, "select").slice(2)) await edit(input, "yes");
		await edit(all(weapons, "textarea").at(-1), "Convert the actual weapon rider, not the independent aura.");
		const healing = controlRoot("healing");
		await edit(findField(healing, "Actual Healing Touch"), "0");
		await edit(findField(healing, "Original Healing Touch usage"), "shortRest");
		await edit(findField(healing, "Original uses (day or rest)"), "2");
		await edit(all(healing, "textarea").at(-1), "The current action is usable twice per short rest.");
		const preview = previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		expect(preview.requirements).toEqual([]);
		expect(preview.forms[0].current.action.some(entry => entry.name.startsWith("Corrupting Touch (2/Short Rest)"))).toBe(true);
		expect(JSON.stringify(preview.forms[0].current.trait.find(entry => entry.name === "Hellish Weapons"))).toContain("{@damage 1d6}) radiant damage");
	});

	it("asks opaque Fallen spell exceptions only for deliberate innate casting, including constant-list exceptions", async () => {
		const current = source("Deva");
		current.spellcasting = [{name: "Custom Magic",
			type: "spellcasting",
			headerEntries: ["The angel uses Charisma to cast its spells."],
			will: ["{@spell detect evil and good|PHB}"],
			constant: ["Opaque Dispel Evil and Good"],
			daily: {"1": ["Opaque Dispel Evil and Good", "Opaque Detect Evil and Good"]},
			ability: "cha"}];
		const subject = target(current);
		const resolved = resolveCreatureTransformation({candidates, id: "catalog:fallen angel|scre", selections: {allegiance: ["fallen"]}, automationVersion: 2});
		let panel;
		panel = renderGuidedTarget({parent: mount, target: subject, resolved, onChange: () => panel.read(), getLegendaryGroups: () => []});
		const control = panel.model.controls.find(control => control.path[1] === "innate");
		const body = all(mount, "details").find(node => node.dataset.sourceControl === control.id);
		const innate = findField(body, "Is this casting innate?");
		const exceptions = all(body, "select").slice(1);
		const preview = () => previewCreatureTransformationSourceInputs({target: subject, resolved, answers: panel.read()});
		await edit(all(body, "textarea").at(-1), "Classify the current casting and each opaque source exception.");
		await edit(innate, "no");
		expect(preview().requirements).toEqual([]);
		expect(exceptions.every(input => input.parentElement.parentElement.disabled)).toBe(true);
		await edit(innate, "yes");
		expect(preview().status).toBe("needs-answers");
		expect(exceptions).toHaveLength(3);
		for (const [i, input] of exceptions.entries()) await edit(input, i === 2 ? "no" : "yes");
		const result = preview();
		expect(result.requirements).toEqual([]);
		expect(result.forms[0].current.spellcasting[0]).toMatchObject({
			will: current.spellcasting[0].will,
			constant: ["Opaque Dispel Evil and Good"],
			daily: {"1": ["Opaque Dispel Evil and Good"]},
		});
	});
});

describe("C1 native staged editor against production workflow/consumers", () => {
	it("routes explicit v2 Skeleton and Half-Dragon to source choices and post-source estimate controls", async () => {
		await open();
		await choose("catalog:skeleton|dmg");
		expect(mount.textContent).toContain("Source choices");
		expect(mount.textContent).not.toContain("Unsupported staged identity");
		expect(DataUtil.loadJSON).toHaveBeenCalledWith("data/msbcr.json");
		await choose("catalog:half-dragon|mm");
		for (const [group, value] of [["ancestry", "red"], ["size", "large-or-smaller"]]) {
			const node = all(mount, "input").find(it => it.value === value);
			expect(node).toBeDefined(); node.checked = true; await node.emit("change");
		}
		expect(mount.textContent).toContain("Post-source");
		expect(findField(mount, "All relevant effects and complete alternatives reviewed?").value).toBe("");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
	});

	it("requires deliberate native source/form answers, calculates DPR12, forwards fresh arguments and applies complete Zombie rules", async () => {
		const {subject, registry} = await open();
		await choose(); await Promise.resolve();
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		expect(findField(mount, "Round 1 uses")).toBeUndefined();
		await findButton(mount, "Review answers for Bugbear").emit("click");
		expect(document.activeElement).toBe(findField(mount, "Armor policy"));
		await fillBugbear();
		expect(mount.textContent).toContain("DPR 12");
		expect(mount.textContent).toContain("12 per use");
		expect(mount.textContent).toContain("Changed Morningstar (MM)");
		const node = findField(mount, "Completeness explanation (never auto-authored)");
		node.focus();
		await edit(node, "All effects and alternatives reviewed again.");
		expect(document.activeElement).toBe(node);
		await consent(); await findButton(mount, "Apply transformation").emit("click");
		expect(create).toHaveBeenCalledTimes(1);
		const args = create.mock.calls[0][0];
		expect(args).toEqual(expect.objectContaining({resolved: expect.any(Object), guidedAnswers: expect.any(Object), crTable: table, generation: expect.any(Number), conflictDecisions: {}}));
		expect(args.guidedAnswers).not.toBe(args.batch.guidedAnswers);
		expect(JSON.stringify(args.guidedAnswers)).toContain("reviewed again");
		expect(args.guidedAnswers.current.mode).toBe(SOURCE_ESTIMATE_MODE);
		expect(args.batch.guidedModels[0].estimates[0].receipt.damagePerRound).toBe(12);
		const result = registry.getCreature({monster: subject.baseCreature});
		expect(result).toMatchObject({str: 16, hp: {average: 32, formula: "5d8 + 10"}, cr: {cr: "1", xp: 200}});
		expect(result.action[0].entries[0]).toContain("{@hit 5}");
		expect(result.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(result.trait.some(entry => entry.name === "Undead Fortitude")).toBe(true);
		const [operation] = registry.getOperations({monster: subject.baseCreature});
		const reopened = await open({registry});
		await choose(); await fillBugbear(undefined, reopened.getTargets()[0]);
		const paths = all(mount, "select").filter(it => it.dataset.conflictPath).map(it => it.dataset.conflictPath);
		expect(paths).toContain("con");
		for (const path of paths) await edit(all(mount, "select").find(it => it.dataset.conflictPath === path), "existing");
		expect(mount.textContent).toContain("Incoming estimate not applied - existing numerical group retained");
		expect(findButton(mount, "Apply transformation")).toBeDefined();
		await edit(findField(mount, "Contribution schedule reason"), "Same arithmetic, newly reviewed reason.");
		expect(all(mount, "select").filter(it => it.dataset.conflictPath).every(it => it.value === "")).toBe(true);
		expect(findField(mount, "Armor and numeric declarations source reason").value).toBe("Zombie retains equipment.");
		registry.removeOperation({monster: subject.baseCreature, operationId: operation.id});
		expect(registry.getCreature({monster: subject.baseCreature})).toEqual(subject.baseCreature);
	});

	it("fences raw-only async edits, stale histories, closed editors and changed tables without saving", async () => {
		let release;
		let reload = false;
		const load = async () => { if (reload) await new Promise(resolve => { release = resolve; }); return candidates; };
		let targets = [target()];
		const apply = jest.fn();
		await open({getTargets: () => targets, pApply: apply, load});
		await choose(); await fillBugbear(); await consent();
		reload = true;
		const pending = findButton(mount, "Apply transformation").emit("click");
		await Promise.resolve();
		await edit(findField(mount, "Completeness explanation (never auto-authored)"), "Same arithmetic, different explanation.");
		await edit(findField(mount, "Round 1 uses"), "2");
		await edit(findField(mount, "Round 2 uses"), "0");
		expect(mount.textContent).toContain("DPR 12");
		release(); await pending;
		expect(apply).not.toHaveBeenCalled();
		expect(mount.textContent).toContain("changed");
		expect(mount.querySelector(".bqa__transformation-confirm").hidden).toBe(true);
		reload = false;
		await consent();
		globalThis.DataUtil.loadJSON.mockResolvedValueOnce({cr: table.map((it, i) => i ? it : {...it, ac: it.ac + 1})});
		await findButton(mount, "Apply transformation").emit("click");
		expect(apply).not.toHaveBeenCalled();
		targets = [{...target(), operations: [{id: "same-value", type: "patch", data: {patch: {set: {str: 15}}}}]}];
		await edit(findField(mount, "Completeness explanation (never auto-authored)"), "Preserve draft under changed history.");
		expect(mount.textContent).toContain("Stale draft");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		await findButton(mount, "Discard stale draft and start new answers").emit("click");
		expect(findField(mount, "Armor policy").value).toBe("");
		expect(document.activeElement).toBe(findField(mount, "Armor policy"));
		await open({load, pApply: apply});
		await choose(); await fillBugbear(); await consent();
		reload = true;
		const closing = findButton(mount, "Apply transformation").emit("click");
		await Promise.resolve(); mount.replaceChildren(); release(); await closing;
		expect(apply).not.toHaveBeenCalled();
	});

	it("surfaces and retries a CR-table load failure without inventing a ready estimate", async () => {
		globalThis.DataUtil.loadJSON.mockRejectedValueOnce(new Error("Table offline"));
		await open(); await choose();
		expect(mount.textContent).toContain("Table offline");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		await findButton(mount, "Retry CR table load").emit("click");
		expect(mount.textContent).not.toContain("Table offline");
		expect(findField(mount, "Armor and numeric declarations source reason").value).toBe("");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
	});

	it("requires deliberate review of fresh staged HP resets and incompatible-group consequences before any Store write", async () => {
		let ix = 0;
		let state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "Consequence review", items: [{h: "bugbear_mm", c: 3}]},
			pResolveItem: async () => ({entity: source("Bugbear")}),
			fnUid: () => `one-${++ix}`});
		state = EncounterWorkspaceState.withHp(state, {id: "one-1", prop: "current", value: 4});
		state = EncounterWorkspaceState.withHp(state, {id: "one-1", prop: "temp", value: 6});
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["one-1", "one-2", "one-3"], id: "shared-bugbears"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "shared-bugbears", isShared: true, total: 16});
		state = EncounterWorkspaceState.withTurn(state, "start");
		const storage = {pSetForPage: jest.fn(async (key, value) => { storage.saved = structuredClone(value); }), pGetForPage: async () => storage.saved};
		const store = new EncounterWorkspaceStore({storage});
		const page = Object.create(EncounterWorkspacePage.prototype);
		Object.assign(page, {_state: state,
			_store: store,
			_hpUndo: [],
			_setBusy: jest.fn(),
			_render: jest.fn(),
			_clearInitiativeMove: jest.fn(),
			_clearRollResults: jest.fn(),
			_setStatus: jest.fn(),
			_setError: jest.fn(),
			_getTargetNames: () => "Bugbear"});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one-1", getState: () => page._state, pCommit: result => page._pCommitStatblockEdit(result)});
		const notified = jest.fn();
		adapter.subscribe(notified);
		jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		await BestiaryQuickActionsUi._pRenderTransformation({content: mount,
			monster: source("Bugbear"),
			registry: adapter,
			isCurrent: () => true,
			automationVersion: 2,
			...page._getTransformationEditorCallbacks("one-1")});
		await choose(); await fillBugbear(); await consent();
		await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(page._state).toBe(state);
		expect(page._state.instances[0].hp).toEqual({current: 4, max: 27, temp: 6});
		expect(page._state.groups[0].memberIds).toEqual(["one-1", "one-2", "one-3"]);
		expect(notified).not.toHaveBeenCalled();
		expect(page._render).not.toHaveBeenCalled();
		expect(JqueryUtil.doToast).not.toHaveBeenCalled();
		const review = all(mount, "div").find(node => node.attributes["aria-label"] === "Encounter consequences to review");
		expect(review.hidden).toBe(false);
		expect(document.activeElement).toBe(review);
		expect(review.textContent).toContain("HP will reset for Bugbear");
		expect(review.textContent).toContain("Bugbear will leave");
		expect(mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input").every(node => !node.checked)).toBe(true);

		await edit(findField(mount, "Completeness explanation (never auto-authored)"), "Same arithmetic, newly reviewed raw reason.");
		expect(review.hidden).toBe(true);
		expect(findField(mount, "Armor and numeric declarations source reason").value).toBe("Zombie retains equipment.");
		await consent(); await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(review.hidden).toBe(false);
		const reviewedText = review.textContent;

		// The effect IDs/text stay the same; the actual group membership has changed.
		const revised = EncounterWorkspaceState.withGroupSplit(page._state, {id: "one-3"});
		page._state = revised;
		await consent(); await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(page._state).toBe(revised);
		expect(page._state.instances[0].hp).toEqual({current: 4, max: 27, temp: 6});
		expect(page._state.groups[0].memberIds).toEqual(["one-1", "one-2"]);
		expect(review.hidden).toBe(false);
		expect(review.textContent).toBe(reviewedText);
		expect(mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input").every(node => !node.checked)).toBe(true);
		expect(notified).not.toHaveBeenCalled();

		await consent(); await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
		expect(notified).toHaveBeenCalledTimes(1);
		expect(page._render).toHaveBeenCalledTimes(1);
		expect(JqueryUtil.doToast).toHaveBeenCalledTimes(1);
		const reloaded = await store.pLoad();
		expect(reloaded.instances[0].hp).toEqual({current: 32, max: 32, temp: 6});
		expect(reloaded.instances[0].statblockOperations).toHaveLength(1);
		expect(reloaded.groups).toEqual([{id: "shared-bugbears", memberIds: ["one-2"], sharedTurn: true, initiative: 16}]);
		expect(reloaded.turn).toEqual({round: 1, activeId: "shared-bugbears"});
	});

	it("uses actual Encounter individual preflight/adapter/Store; rejected save preserves state, retry and reload preserve the frozen result", async () => {
		let state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "C1", items: [{h: "bugbear_mm", c: 1}]}, pResolveItem: async () => ({entity: source("Bugbear")}), fnUid: () => "one"});
		const before = state;
		const storage = {pSetForPage: jest.fn().mockRejectedValueOnce(new Error("Storage full")).mockImplementation(async (key, value) => { storage.saved = structuredClone(value); }), pGetForPage: async () => storage.saved};
		const store = new EncounterWorkspaceStore({storage});
		const page = Object.create(EncounterWorkspacePage.prototype);
		Object.assign(page, {_state: state, _store: store, _hpUndo: [], _setBusy: jest.fn(), _render: jest.fn(), _clearRollResults: jest.fn(), _setStatus: jest.fn(), _setError: jest.fn(), _getTargetNames: () => "Bugbear"});
		const adapter = new EncounterWorkspaceQuickActionsAdapter({id: "one", getState: () => page._state, pCommit: result => page._pCommitStatblockEdit(result)});
		jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		await BestiaryQuickActionsUi._pRenderTransformation({content: mount, monster: source("Bugbear"), registry: adapter, isCurrent: () => true, automationVersion: 2, ...page._getTransformationEditorCallbacks("one")});
		await choose(); await fillBugbear(); await consent();
		await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		await consent();
		await findButton(mount, "Apply transformation").emit("click");
		expect(mount.textContent).toContain("Storage full");
		expect(all(mount, "div").find(node => node.attributes["aria-label"] === "Encounter consequences to review").hidden).toBe(false);
		expect(page._state).toBe(before);
		expect(adapter.getOperations()).toEqual([]);
		page._render.mockImplementationOnce(() => { throw new Error("Render broke"); });
		await findButton(mount, "Apply transformation").emit("click");
		expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
		expect(mount.textContent).toContain("were saved");
		expect(mount.textContent).toContain("Reload");
		expect(mount.textContent).not.toContain("Transformation was not applied");
		state = await store.pLoad();
		expect(getEncounterEffectiveMonster(state.instances[0]).hp.average).toBe(32);
		expect(state.instances[0].monster).toEqual(source("Bugbear"));
		expect(state.instances[0].statblockOperations).toHaveLength(1);
	});

	it("keeps complete schedules and fixed adjudications typed, retains an independent override, and locks native inputs during the actual commit", async () => {
		let release;
		const {registry, subject} = await open({pApply: async changes => {
			await new Promise(resolve => { release = resolve; });
			registry.applyChanges({monster: subject.baseCreature, ...changes[0]});
		}});
		await choose(); await fillBugbear();
		await edit(findField(mount, "Override estimated CR?"), "declare");
		await edit(findField(mount, "Final CR override"), "2");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		await edit(findField(mount, "CR override reason"), "Reviewed DM adjudication.");
		expect(mount.textContent).toContain("Estimated CR 1");
		expect(mount.textContent).toContain("Final CR 2, 450 XP");
		const routine = all(mount, "details").find(it => it.children[0]?.textContent === "routine-1");
		await findButton(routine, "Add contribution").emit("click");
		await all(routine, "button").filter(it => it.textContent === "Remove contribution").at(-1).emit("click");
		expect(document.activeElement).toBe(findButton(routine, "Add contribution"));
		await findButton(routine, "Add contribution").emit("click");
		const row = routine.querySelectorAll("fieldset").filter(it => it.className === "bqa__transformation-resolution-row").at(-1);
		await edit(findField(row, "Damage contribution"), "fixed");
		for (const [label, value] of [["Fixed per-use value", "3"], ["Adjudication source name", "Reviewed donor"], ["Adjudication source code", "MM"],
			["Fixed contribution reason", "Source-fixed, no PB."], ["Timing / use restriction", "conditional"], ["Contribution schedule reason", "One middle-round use."]]) await edit(findField(row, label), value);
		for (let i = 1; i <= 3; ++i) {
			await edit(findField(row, `Round ${i} uses`), i === 2 ? "1" : "0");
			await edit(findField(row, `Round ${i} targets`), "1");
		}
		await consent();
		const pending = findButton(mount, "Apply transformation").emit("click");
		for (let i = 0; i < 10; ++i) {
			if (release) break;
			await Promise.resolve();
		}
		expect(release).toEqual(expect.any(Function));
		expect(findField(mount, "Round 1 uses").disabled).toBe(true);
		expect(create.mock.calls[0][0].batch.guidedModels[0].estimates[0].receipt.assumptions.routines[0].rounds).toEqual([
			{value: 12, proficiency: 0}, {value: 15, proficiency: 0}, {value: 12, proficiency: 0},
		]);
		release(); await pending;
		const operation = registry.getOperations({monster: subject.baseCreature})[0];
		expect(operation.data.resolved.changes.find(it => it.type === "setChallengeRating").receipt.assumptions.override).toEqual({cr: "2", reason: "Reviewed DM adjudication."});
	});

	it("preflights the real mixed bulk set, asks approval of storage skips, then saves the reviewed eligible siblings once", async () => {
		let ix = 0;
		const state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "C1 bulk", items: [{h: "bugbear", c: 4}, {h: "elemental", c: 1}]},
			pResolveItem: async item => ({entity: source(item.h === "bugbear" ? "Bugbear" : "Fire Elemental")}),
			fnUid: () => `target-${++ix}`});
		state.instances[2].statblockOperations = Array.from({length: 100}, (_, i) => ({id: `old-${i}`, type: "patch", data: {patch: {set: {str: 23}}}}));
		const storage = {pSetForPage: jest.fn().mockImplementation(async (key, value) => { storage.saved = structuredClone(value); }), pGetForPage: async () => storage.saved};
		const store = new EncounterWorkspaceStore({storage});
		const page = Object.create(EncounterWorkspacePage.prototype);
		Object.assign(page, {_state: state,
			_store: store,
			_hpUndo: [],
			_setBusy: jest.fn(),
			_render: jest.fn(),
			_clearRollResults: jest.fn(),
			_setStatus: jest.fn(),
			_setError: jest.fn(),
			_getTargetNames: ids => ids.join(","),
			_selBulkType: {value: "transformation"},
			_selBulkChoice: new Node("select"),
			_btnBulkPreview: new Node("button"),
			_eleBulkTransformation: mount});
		await page._pRenderBulkChoices({automationVersion: 2}); await choose();
		for (const [i, panel] of mount.querySelectorAll(".bqa__transformation-resolution").entries()) {
			if (i >= 3) break;
			const instance = state.instances[i];
			await fillBugbear(panel, {id: instance.id, label: panel.children[0].textContent, baseCreature: instance.monster, operations: instance.statblockOperations});
		}
		expect(mount.textContent).toContain("3 eligible");
		const apply = () => all(mount, "button").find(it => it.textContent.startsWith("Apply to"));
		await apply().emit("click");
		for (const node of mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input")) node.checked = true;
		await apply().emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(mount.textContent).toContain("100-operation");
		expect(mount.textContent).toContain("2 eligible");
		expect(mount.querySelector(".bqa__transformation-confirm").hidden).toBe(true);
		await apply().emit("click");
		for (const node of mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input")) node.checked = true;
		await apply().emit("click");
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		expect(mount.textContent).toContain("Encounter consequences need fresh review");
		for (const node of mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input")) node.checked = true;
		await apply().emit("click");
		expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
		const reloaded = await store.pLoad();
		expect(reloaded.instances.map(it => it.statblockOperations.length)).toEqual([1, 1, 100, 0, 0]);
		expect(getEncounterEffectiveMonster(reloaded.instances[0]).type).toEqual({type: "undead", tags: ["goblinoid"]});
		expect(reloaded.instances[0].monster.type).toEqual({type: "humanoid", tags: ["goblinoid"]});
	});

	it("keeps defaults legacy, enables the Skeleton source model, and requires DM consent for complete v2 estimates", async () => {
		await open({automationVersion: 1});
		await choose();
		expect(mount.querySelector(".bqa__transformation-resolution")).toBeNull();
		expect(mount.textContent).not.toContain("Staged numerical preview");
		await open();
		await choose("catalog:skeleton|dmg");
		expect(mount.textContent).toContain("Source choices");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		const {registry, subject} = await open();
		await choose();
		await fillBugbear();
		const apply = findButton(mount, "Apply transformation");
		if (!apply) throw new Error(mount.querySelector(".bqa__transformation-error").textContent);
		await apply.emit("click");
		const checks = mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input");
		expect(checks.at(-1).parentElement.hidden).toBe(false);
		expect(checks.at(-1).checked).not.toBe(true);
		expect(registry.getOperations({monster: subject.baseCreature})).toEqual([]);
	});
});
