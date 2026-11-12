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
import {inspectCreatureTransformationInputs} from "../../../js/bestiary/bestiary-transformation-inputs.js";
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
		loadJSON: jest.fn(async path => path.includes("msbcr") ? {cr: structuredClone(table)} : structuredClone(catalog)),
		generic: {getVersions: () => []},
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

async function fillBugbear (root = mount.querySelector(".bqa__transformation-resolution"), subject = target()) {
	await edit(findField(root, "Reviewed unchanged armor"), "retain");
	await edit(findField(root, "Reason / source policy"), "Zombie retains equipment.");
	const model = inspectCreatureTransformationInputs({target: subject, resolved: resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2})});
	for (const entry of model.entries.filter(it => it.needsBinding)) {
		const panel = all(root, "details").find(it => it.children[0]?.textContent === `${entry.section}: ${entry.match.name} (${entry.match.source})`);
		await edit(findField(panel, "Entry policy"), "bind");
		for (const row of panel.querySelectorAll(".bqa__transformation-resolution-row")) {
			if (entry.match.name === "Surprise Attack") await edit(findField(row, "Token interpretation"), "fixed");
			else {
				await edit(findField(row, "Token interpretation"), "ability");
				await edit(findField(row, "Governing ability"), "str");
				await edit(findField(row, "Token PB multiplier"), row.children[0].textContent.includes(", hit token") ? "1" : "0");
			}
			await edit(findField(row, "Token interpretation reason"), "Reviewed source contribution.");
			if (entry.match.name !== "Surprise Attack") {
				await findButton(row, "Propose residual").emit("click");
				expect(row.textContent).toContain("Unaccepted proposal");
				await findButton(row, "Adopt this interpretation").emit("click");
			}
		}
	}
	for (const item of model.controls.filter(it => it.kind === "proficiency")) {
		await edit(findField(root, `${item.selector.section}: ${item.selector.name}, observed ${item.facts.total}, ability ${item.facts.ability} - PB multiplier`), item.selector.name === "stealth" ? "2" : "1");
		await edit(findField(root, `${item.selector.name} interpretation reason`), "Reviewed source proficiency.");
	}
	for (const [label, value] of [
		["Expected CR band (deliberately adopt or edit)", "1"], ["AC alternative to evaluate", "0"], ["Effective resistance policy", "none"],
		["Prevalent multiple vulnerabilities?", "no"], ["Applicable regeneration per round", "0"], ["Estimate-only effective HP adjustment", "0"], ["Estimate-only effective AC adjustment", "0"],
		["Defense policy and reviewed feature adjustments", "No relevant multipliers or regeneration; all features reviewed."],
	]) await edit(findField(root, label), value);
	for (const entry of model.entries) {
		await edit(findField(root, `${entry.section}: ${entry.match.name} (${entry.match.source})`), entry.match.name === "Morningstar" ? "represented" : "excluded");
		await edit(findField(root, `${entry.match.name} coverage reason`), entry.match.name === "Brute" ? "Baked into weapon dice." : "Reviewed no surprise or ranged alternative.");
	}
	await findButton(root, "Add alternative routine").emit("click");
	await edit(findField(root, "Predominant attack / save accuracy"), model.entries.find(it => it.match.name === "Morningstar").tokens.find(it => it.kind === "hit").id);
	await edit(findField(root, "Predominant / mixed-accuracy explanation"), "Morningstar attack.");
	await edit(findField(root, "Routine source and schedule explanation"), "One melee attack per round.");
	await findButton(root, "Add contribution").emit("click");
	await edit(findField(root, "Damage contribution"), model.entries.find(it => it.match.name === "Morningstar").tokens.find(it => it.kind === "damage").id);
	await edit(findField(root, "Timing / use restriction"), "normal");
	await edit(findField(root, "Contribution schedule reason"), "One attack, one target.");
	for (let i = 1; i <= 3; ++i) {
		await edit(findField(root, `Round ${i} uses`), "1");
		await edit(findField(root, `Round ${i} targets`), "1");
	}
	await edit(findField(root, "Routine selection policy"), "highest-damage");
	await edit(findField(root, "Final CR0 no-threat 0 XP policy?"), "no");
	await edit(findField(root, "All relevant effects and complete alternatives reviewed?"), "yes");
	await edit(findField(root, "Completeness explanation (never auto-authored)"), "All effects and alternatives deliberately reviewed.");
}
async function consent () {
	const apply = findButton(mount, "Apply transformation");
	if (!apply) throw new Error(`No Apply: ${mount.querySelector(".bqa__transformation-error")?.textContent}; ${mount.querySelector(".bqa__transformation-resolution-error")?.textContent}`);
	await apply.emit("click");
	for (const node of mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input")) { node.checked = true; await node.emit("change"); }
}

describe("C1 native staged editor against production workflow/consumers", () => {
	it("requires deliberate native answers and adopts residuals, calculates DPR12, forwards fresh arguments and applies the actual Bugbear producer", async () => {
		const {subject, registry} = await open();
		await choose(); await Promise.resolve();
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		expect(findField(mount, "Round 1 uses")).toBeUndefined();
		await findButton(mount, "Review answers for Bugbear").emit("click");
		expect(document.activeElement).toBe(findField(mount, "Reviewed unchanged armor"));
		await fillBugbear();
		expect(mount.textContent).toContain("DPR 12");
		expect(mount.textContent).toContain("per-use printed average 12");
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
		expect(args.batch.guidedModels[0].estimate.receipt.damagePerRound).toBe(12);
		expect(args.batch.guidedModels[0].automationInputs.cr.assumptions.routines[0].rounds.map(it => it.value)).toEqual([12, 12, 12]);
		const result = registry.getCreature({monster: subject.baseCreature});
		expect(result).toMatchObject({str: 16, hp: {average: 32, formula: "5d8 + 10"}, cr: {cr: "1", xp: 200}});
		expect(result.action[0].entries[0]).toContain("{@hit 5}");
		expect(result.action[0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
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
		expect(findField(mount, "Reason / source policy").value).toBe("Zombie retains equipment.");
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
		expect(findField(mount, "Reviewed unchanged armor").value).toBe("");
		expect(document.activeElement).toBe(findField(mount, "Reviewed unchanged armor"));
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
		expect(findField(mount, "All relevant effects and complete alternatives reviewed?").value).toBe("");
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
		expect(findField(mount, "Reason / source policy").value).toBe("Zombie retains equipment.");
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
		await edit(findField(mount, "Override estimated CR?"), "override");
		await edit(findField(mount, "Final CR override"), "2");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		await edit(findField(mount, "CR override reason"), "Reviewed DM adjudication.");
		expect(mount.textContent).toContain("Estimated CR 1");
		expect(mount.textContent).toContain("Final CR 2, 450 XP");
		const routine = all(mount, "details").find(it => it.children[0]?.textContent === "routine-1");
		await findButton(routine, "Add contribution").emit("click");
		await findButton(routine.querySelectorAll("fieldset").at(-1), "Remove contribution").emit("click");
		expect(document.activeElement).toBe(findButton(routine, "Add contribution"));
		await findButton(routine, "Add contribution").emit("click");
		const row = routine.querySelectorAll("fieldset").at(-1);
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
		expect(create.mock.calls[0][0].batch.guidedModels[0].automationInputs.cr.assumptions.routines[0].rounds).toEqual([
			{value: 12, proficiency: 0}, {value: 15, proficiency: 0}, {value: 12, proficiency: 0},
		]);
		release(); await pending;
		const operation = registry.getOperations({monster: subject.baseCreature})[0];
		expect(operation.data.resolved.changes.find(it => it.type === "setChallengeRating").receipt.assumptions.override).toEqual({cr: "2", reason: "Reviewed DM adjudication."});
	});

	it("preflights the real mixed bulk set, asks approval of storage skips, then saves the reviewed eligible siblings once", async () => {
		let ix = 0;
		const state = await EncounterWorkspaceState.pFromSavedList({exportedSublist: {name: "C1 bulk", items: [{h: "dragon", c: 4}, {h: "bugbear", c: 1}]},
			pResolveItem: async item => ({entity: source(item.h === "dragon" ? "Adult Black Dragon" : "Bugbear")}),
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
		await page._pRenderBulkChoices({automationVersion: 2}); await choose("catalog:dracolich|mm");
		for (const panel of mount.querySelectorAll(".bqa__transformation-resolution").filter((_, i) => i !== 3)) {
			for (const [label, value] of [["Age", "adult"], ["Is this a true dragon?", "yes"], ["Is this a shadow dragon?", "no"],
				["Living physiology review", "amphibious-only"], ["Lair policy", "retain"]]) await edit(findField(panel, label), value);
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
		expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
		const reloaded = await store.pLoad();
		expect(reloaded.instances.map(it => it.statblockOperations.length)).toEqual([1, 1, 100, 0, 0]);
		expect(getEncounterEffectiveMonster(reloaded.instances[0]).type).toBe("undead");
		expect(reloaded.instances[0].monster.type).toBe("dragon");
	});

	it("keeps default and Species legacy, unsupported staged identities explicit, and compiled Dracolich DM consent required", async () => {
		await open({automationVersion: 1});
		await choose();
		expect(mount.querySelector(".bqa__transformation-resolution")).toBeNull();
		expect(mount.textContent).not.toContain("Staged numerical preview");
		await open();
		await choose("catalog:skeleton|dmg");
		expect(mount.textContent).toContain("Unsupported staged identity");
		expect(findButton(mount, "Apply transformation")).toBeUndefined();
		const {registry, subject} = await open({subject: target(source("Adult Black Dragon"))});
		await choose("catalog:dracolich|mm");
		for (const [label, value] of [["Age", "adult"], ["Is this a true dragon?", "yes"], ["Is this a shadow dragon?", "no"],
			["Living physiology review", "amphibious-only"], ["Lair policy", "retain"]]) await edit(findField(mount, label), value);
		const apply = findButton(mount, "Apply transformation");
		if (!apply) throw new Error(mount.querySelector(".bqa__transformation-error").textContent);
		await apply.emit("click");
		const checks = mount.querySelector(".bqa__transformation-confirm").querySelectorAll("input");
		expect(checks.at(-1).parentElement.hidden).toBe(false);
		expect(checks.at(-1).checked).not.toBe(true);
		expect(registry.getOperations({monster: subject.baseCreature})).toEqual([]);
	});
});
