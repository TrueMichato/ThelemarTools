import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
const matches = (node, selector) => selector.startsWith(".")
	? node.className?.split(" ").includes(selector.slice(1))
	: node.tag === selector;
const descendants = node => node._children.flatMap(child => typeof child === "string" ? [] : [child, ...descendants(child)]);
const baseElement = globalThis.e_;
globalThis.e_ = opts => {
	const node = baseElement(opts);
	node.className = opts.clazz || "";
	node.attrs = {...opts.attrs};
	node.type = opts.type;
	node.setAttribute = (name, value) => { node.attrs[name] = value; };
	node.querySelectorAll = selectors => descendants(node).filter(child => selectors.split(",").some(selector => matches(child, selector.trim())));
	node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
	node.click = () => node.disabled ? undefined : node._handlers.click?.({preventDefault () {}});
	Object.defineProperty(node, "innerHTML", {
		get () { return this._html; },
		set (value) { this._html = value; this._children = []; },
	});
	return node;
};

const {CharacterSheetSimulacrum: Ui} = await import("../../../js/charactersheet/charactersheet-simulacrum.js");

function makeOwner () {
	const state = new State();
	state.setId("owner");
	state.setName("Original Caster");
	state.addClass({name: "Wizard", source: "PHB", level: 5, spellcastingAbility: "int"});
	state.addClass({name: "Warlock", source: "PHB", level: 3, spellcastingAbility: "cha"});
	state.setAbilityBase("int", 18);
	state.recalculateHp({syncCurrent: true});
	state.addSpell({name: "Shield", source: "PHB", level: 1}, true);
	state.addCantrip({name: "Fire Bolt", source: "PHB", level: 0});
	state.setSpellSlots(1, 0, 4);
	state.setSpellSlots(2, 0, 3);
	state.setCurrency("gp", 5000);
	return {
		state,
		page: {
			getState: () => state,
			_currentCharacterId: "owner",
			_characterLoadGeneration: 1,
			_saveCurrentCharacter: jest.fn(async () => true),
			_renderCompanions: jest.fn(),
			_renderCurrency: jest.fn(),
			getConditionsList: () => [{name: "Blinded", source: "PHB"}],
		},
	};
}

function addCopy (state, source = "PHB") {
	const preparation = state.prepareSimulacrumSnapshot({spellSource: source});
	expect(preparation.ok).toBe(true);
	return state.addCompanion(preparation.companionData);
}

let modal;
let modalSpy;
let rendererBefore;
beforeAll(() => {
	rendererBefore = globalThis.Renderer.monster;
	globalThis.Renderer.monster = {getCompactRenderedString: jest.fn(() => "<tr><td>Rendered companion</td></tr>")};
	modalSpy = jest.spyOn(CharacterSheetModal, "pGetShow").mockImplementation(async options => {
		modal = {
			root: globalThis.e_({tag: "div"}),
			options,
			close: jest.fn(() => options.cbClose?.()),
		};
		return {eleModalInner: modal.root, doClose: modal.close};
	});
});
afterAll(() => {
	modalSpy.mockRestore();
	globalThis.Renderer.monster = rendererBefore;
});
beforeEach(() => {
	globalThis.JqueryUtil.doToast.mockClear?.();
});

describe("Simulacrum creation preview", () => {
	test("previews a real sanitized snapshot and cancellation changes neither original nor existing copy", async () => {
		const {state, page} = makeOwner();
		const existingId = addCopy(state);
		const before = copy(state._data);
		const promise = Ui.pPrepareCreation({ownerPage: page, spellSource: "PHB"});
		await flush();
		expect(globalThis.Renderer.monster.getCompactRenderedString).toHaveBeenLastCalledWith(
			expect.objectContaining({type: {type: "construct"}, name: expect.stringContaining("Simulacrum")}),
			{isShowScalers: false},
		);
		expect(descendants(modal.root).some(node => node._html.includes("Specific creature") && node._html.includes("disabled"))).toBe(true);
		modal.close();
		await expect(promise).resolves.toBeNull();
		expect(state._data).toEqual(before);
		expect(state.getCompanion(existingId).actorSnapshot.lifecycle).toBe("active");
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test("confirmation returns staged data and replacement identity without adding or destroying a copy", async () => {
		const {state, page} = makeOwner();
		const existingId = addCopy(state);
		const before = copy(state._data);
		const promise = Ui.pPrepareCreation({ownerPage: page, spellSource: "XPHB"});
		await flush();
		modal.root.querySelector(".cs-simulacrum__create").click();
		const result = await promise;
		expect(result.companionData.actorSnapshot.spell.source).toBe("XPHB");
		expect(result.replacedActorIds).toEqual([state.getCompanion(existingId).actorSnapshot.actorId]);
		expect(result.context.state).toBe(state);
		expect(state._data).toEqual(before);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test.each(["original edit", "character switch"])("rejects a stale preview after %s", async change => {
		const {state, page} = makeOwner();
		const promise = Ui.pPrepareCreation({ownerPage: page, spellSource: "PHB"});
		await flush();
		if (change === "original edit") state.setName("Edited Original");
		else page._characterLoadGeneration++;
		const confirm = modal.root.querySelector(".cs-simulacrum__create");
		confirm.click();
		expect(confirm.disabled).toBe(true);
		expect(modal.root.querySelector(".cs-simulacrum__status").textContent).toContain("changed");
		expect(state.getCompanions()).toHaveLength(0);
		modal.close();
		await expect(promise).resolves.toBeNull();
	});
});

describe("Simulacrum companion surfaces", () => {
	test.each(["sheet", "play"])("%s card exposes repair and actor controls without an editable HP or fake bestiary link", mode => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const parent = globalThis.e_({tag: "div"});
		const card = Ui.renderCard({ownerPage: page, companion: state.getCompanion(id), parent, mode});
		expect(card.attrs["data-companion-kind"]).toBe("simulacrum");
		expect(card.querySelector(".btn-companion-heal").textContent).toBe("Repair");
		expect(card.querySelector(".btn-companion-view").textContent).toBe("Manage / cast");
		expect(card.querySelectorAll("input")).toHaveLength(0);
		expect(descendants(card).map(node => node._html).join("")).not.toContain("bestiary.html");
	});

	test("a terminal card disables repair and damage but leaves statblock and dismissal available", () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		state.getCompanion(id).actorSnapshot.lifecycle = "destroyed";
		const card = Ui.renderCard({ownerPage: page, companion: state.getCompanion(id), parent: globalThis.e_({tag: "div"})});
		expect(card.querySelector(".btn-companion-heal").disabled).toBe(true);
		expect(card.querySelector(".btn-companion-damage").disabled).toBe(true);
		expect(card.querySelector(".btn-companion-view").disabled).toBe(false);
		expect(card.querySelector(".btn-companion-dismiss").disabled).toBe(false);
	});

	test("keeps same-level ordinary and Pact options separate and carries selected pool and target into the bridge", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const cast = jest.fn(async () => ({ok: true}));
		const previousRuntime = globalThis.CharacterSheetCompanionActor;
		globalThis.CharacterSheetCompanionActor = class {
			constructor ({actor}) { this.actor = actor; }
			getState () { return this.actor; }
			castSpell (...args) { return cast(...args); }
			dispose () {}
		};
		try {
			await Ui.pShow({ownerPage: page, companionId: id});
			const slot = modal.root.querySelector(".cs-simulacrum__slot");
			expect(slot).toBeTruthy();
			expect(slot.children.map(option => option.value)).toEqual(expect.arrayContaining(["slot:2", "pact:2"]));
			slot.value = "pact:2";
			modal.root.querySelector(".cs-simulacrum__target").value = "owner";
			const rows = modal.root.querySelectorAll(".cs-simulacrum__spell");
			expect(rows.some(row => row._html.includes("Fire Bolt"))).toBe(true);
			const shieldRow = rows.find(row => row.attrs["data-spell-id"] === state.getSpells().find(spell => spell.name === "Shield").id);
			const castButton = shieldRow.querySelectorAll("button").find(button => button.textContent === "Cast");
			castButton.click();
			await flush();
			expect(cast).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({targetActorId: "owner", decision: {castAsRitual: false, slotLevel: 2, isPact: true}}),
			);
			expect(state.getSpellSlotsCurrent(2)).toBe(0);
			modal.close();
		} finally {
			globalThis.CharacterSheetCompanionActor = previousRuntime;
		}
	});

	test("invalid snapshots surface an unavailable error rather than an original-character runtime", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		state.getCompanion(id).actorSnapshot.version = 99;
		const runtimeSpy = jest.fn();
		const previousRuntime = globalThis.CharacterSheetCompanionActor;
		globalThis.CharacterSheetCompanionActor = runtimeSpy;
		try {
			await Ui.pShow({ownerPage: page, companionId: id});
			expect(modal.root.querySelector(".cs-simulacrum__status").textContent).toBeTruthy();
			expect(runtimeSpy).not.toHaveBeenCalled();
			modal.close();
		} finally {
			globalThis.CharacterSheetCompanionActor = previousRuntime;
		}
	});

	test("a corrupt envelope with no spell identity renders an unavailable card instead of throwing", () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		delete state.getCompanion(id).actorSnapshot.spell;
		const card = Ui.renderCard({ownerPage: page, companion: state.getCompanion(id), parent: globalThis.e_({tag: "div"})});
		expect(card.querySelector(".btn-companion-heal").disabled).toBe(true);
		expect(card._html).toContain("Unavailable");
		expect(card._html).toContain("Unknown edition");
	});
});

describe("field-scoped repair failure compensation", () => {
	function stageRepairReceipt (state, id) {
		const companion = state.getCompanion(id);
		companion.hp.current = 10;
		companion.actorSnapshot.state.hp.current = 10;
		const before = Ui._captureRepairFields(state, id);
		companion.hp.current += 4;
		companion.actorSnapshot.state.hp.current += 4;
		companion.actorSnapshot.revision++;
		expect(state.deductGold(400)).toEqual({success: true});
		const after = Ui._captureRepairFields(state, id);
		return {before, after, receipt: {ok: true, actualHp: 4, costGp: 400}};
	}

	test("restores exact untouched companion/currency fields without rolling back unrelated owner edits", () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		state.setCurrency("pp", 7);
		state.setCurrency("sp", 9);
		state.setCurrency("cp", 3);
		const {before, after, receipt} = stageRepairReceipt(state, id);
		state._data.notes.notes = "Keep this concurrent note.";
		Ui._restoreRepairFields(Ui._captureOwner(page), before, after, receipt);
		expect(state.getCompanion(id)).toEqual(before.companion);
		expect(state.getCurrency()).toEqual(before.currency);
		expect(state._data.notes.notes).toBe("Keep this concurrent note.");
	});

	test("compensates only repaired HP and paid gold after a newer actor revision and another currency spend", () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const {before, after, receipt} = stageRepairReceipt(state, id);
		const current = state.hydrateCompanionActor(id);
		current.actor.setSpellSlotCurrent(1, 3, {isExpenditure: true});
		current.actor.setHp(12);
		expect(state.commitCompanionActor(id, current).ok).toBe(true);
		expect(state.deductGold(3)).toEqual({success: true});
		state._data.notes.notes = "Newer note.";
		Ui._restoreRepairFields(Ui._captureOwner(page), before, after, receipt);
		const restored = state.hydrateCompanionActor(id).actor;
		expect(restored.getHp().current).toBe(8);
		expect(restored.getSpellSlotsCurrent(1)).toBe(3);
		expect(state.getCurrency().gp).toBe(4997);
		expect(state._data.notes.notes).toBe("Newer note.");
	});
});
