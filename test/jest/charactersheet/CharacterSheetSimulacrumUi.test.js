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
	: selector.startsWith("[") ? Object.hasOwn(node.attrs || {}, selector.slice(1, -1)) : node.tag === selector;
const descendants = node => node._children.flatMap(child => typeof child === "string" ? [] : [child, ...descendants(child)]);
const baseElement = globalThis.e_;
globalThis.e_ = opts => {
	const node = baseElement(opts);
	node.className = opts.clazz || "";
	node.attrs = {...opts.attrs};
	node.type = opts.type;
	node.tagName = node.tag?.toUpperCase();
	node.getAttribute = name => node.attrs[name] ?? null;
	node.setAttribute = (name, value) => { node.attrs[name] = value; };
	node.focus = () => { globalThis.document.activeElement = node; };
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
await import("../../../js/charactersheet/charactersheet-spells.js");
await import("../../../js/charactersheet/charactersheet-companion-actor.js");

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
			saveCharacter: jest.fn(async () => true),
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
let documentBefore;
beforeAll(() => {
	documentBefore = globalThis.document;
	globalThis.document = {activeElement: null};
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
	globalThis.document = documentBefore;
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
	test("mutation refresh preserves explicit pool, target, search, disclosure and keyboard focus", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		await Ui.pShow({ownerPage: page, companionId: id});
		const slot = modal.root.querySelector(".cs-simulacrum__slot");
		slot.value = "pact:2";
		modal.root.querySelector(".cs-simulacrum__target").value = "owner";
		const search = modal.root.querySelector("input");
		search.value = "Shield";
		search._handlers.input();
		modal.root.querySelector(".cs-simulacrum__rules").open = true;
		slot.focus();
		modal.root.querySelectorAll("button").find(button => button.textContent === "Start combat").click();
		await flush();
		const restored = modal.root.querySelector(".cs-simulacrum__slot");
		expect(restored).not.toBe(slot);
		expect(restored.value).toBe("pact:2");
		expect(modal.root.querySelector(".cs-simulacrum__target").value).toBe("owner");
		expect(modal.root.querySelector("input").value).toBe("Shield");
		expect(modal.root.querySelector(".cs-simulacrum__rules").open).toBe(true);
		expect(globalThis.document.activeElement).toBe(restored);
		const hidden = modal.root.querySelectorAll(".cs-simulacrum__spell").filter(row => row.hidden);
		expect(hidden).toHaveLength(1);
		expect(hidden[0]._html).toContain("Fire Bolt");
		modal.close();
	});

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
			getManualResolutionNotice () { return "Unsupported effects require manual resolution."; }
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

	test.each(["missing kind", "null snapshot", "unavailable marker"])("%s cannot fall through to generic editable companion controls", corruption => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const companion = state.getCompanion(id);
		if (corruption === "missing kind") delete companion.actorSnapshot.kind;
		else if (corruption === "null snapshot") companion.actorSnapshot = null;
		else {
			delete companion.actorSnapshot;
			companion.actorUnavailable = {ok: false};
		}
		expect(Ui.isSimulacrum(companion)).toBe(true);
		const card = Ui.renderCard({ownerPage: page, companion, parent: globalThis.e_({tag: "div"})});
		expect(card.querySelector(".btn-companion-heal").disabled).toBe(true);
		expect(card.querySelector(".btn-companion-damage").disabled).toBe(true);
		expect(card._html).toContain("Unavailable");
	});

	test("real runtime turn controls expire the actor's timed effects without resetting the original's turn", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.activateState("custom", {name: "One-round buff", sourceFeatureId: "test-round-buff", duration: "1 round", customEffects: []});
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		const ownerTurn = copy(state._data.turnReceipts);
		await Ui.pShow({ownerPage: page, companionId: id});
		modal.root.querySelectorAll("button").find(button => button.textContent === "Start combat").click();
		await flush();
		modal.root.querySelectorAll("button").find(button => button.textContent === "Start next turn").click();
		await flush();
		const actor = state.hydrateCompanionActor(id).actor;
		expect(actor.getCombatRound()).toBe(2);
		expect(actor.getActiveStates().some(effect => effect.name === "One-round buff" && effect.active)).toBe(false);
		expect(state._data.turnReceipts).toEqual(ownerTurn);
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		modal.close();
	});

	test("closing controls during an actor save defers disposal until the action has finished", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		let resolveSave;
		page.saveCharacter.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
		await Ui.pShow({ownerPage: page, companionId: id});
		modal.root.querySelectorAll("button").find(button => button.textContent === "Start combat").click();
		await flush();
		modal.close();
		resolveSave(true);
		await flush();
		expect(state.hydrateCompanionActor(id).actor.isInCombat()).toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
	});

	test.each(["Short", "Long"])("PHB %s Rest restores only eligible actor resources, never HP/slots or the original", async type => {
		const {state, page} = makeOwner();
		const {id: resourceId} = state.addResource({name: "Rest Test Pool", max: 2, current: 0, recharge: "short"});
		const id = addCopy(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setResourceCurrent(resourceId, 0);
		hydrated.actor.setHp(hydrated.actor.getHp().current - 3);
		hydrated.actor.setSpellSlotCurrent(1, 3, {isExpenditure: true});
		hydrated.actor.setPactSlotsCurrent(1);
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		const hp = state.getCompanion(id).hp.current;
		const before = copy(state._data);
		const confirmation = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await Ui.pShow({ownerPage: page, companionId: id});
			modal.root.querySelectorAll("button").find(button => button.textContent === `${type} Rest`).click();
			await flush();
			const actor = state.hydrateCompanionActor(id).actor;
			expect(actor.getResources().find(resource => resource.id === resourceId).current).toBe(2);
			expect(actor.getHp().current).toBe(hp);
			expect(actor.getSpellSlotsCurrent(1)).toBe(3);
			expect(actor.getPactSlots().current).toBe(1);
			const {companions: _beforeCompanions, ...ownerBefore} = before;
			const {companions: _afterCompanions, ...ownerAfter} = state._data;
			expect(ownerAfter).toEqual(ownerBefore);
			expect(page.saveCharacter).toHaveBeenCalledTimes(1);
			modal.close();
		} finally {
			confirmation.mockRestore();
		}
	});

	test("a concurrently changed actor disables stale controls without an unhandled re-render rejection", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		await Ui.pShow({ownerPage: page, companionId: id});
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setHp(hydrated.actor.getHp().current - 1);
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		modal.root.querySelectorAll("button").find(button => button.textContent === "Start combat").click();
		await flush();
		expect(modal.root.querySelector(".cs-simulacrum__status").textContent).toContain("Reopen its controls");
		expect(modal.root.querySelectorAll("button")).toHaveLength(0);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		modal.close();
	});

	test("failed dismissal persistence restores a destroyed record, never a living duplicate or the original's concentration", async () => {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		state.setConcentration({name: "Bless", source: "PHB", level: 1});
		const concentration = copy(state.getConcentration());
		page._saveCurrentCharacter.mockResolvedValueOnce(false);
		const confirmation = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(Ui._pDismiss({ownerPage: page, companionId: id})).rejects.toThrow("could not be saved");
			expect(state.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
			expect(state.getCompanion(id).hp.current).toBe(0);
			expect(state.getConcentration()).toEqual(concentration);
			expect(page.saveCharacter).toHaveBeenCalledTimes(1);
			expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(2);
		} finally {
			confirmation.mockRestore();
		}
	});
});

describe("PHB laboratory repair dialog with authoritative State", () => {
	function setupRepair () {
		const {state, page} = makeOwner();
		const id = addCopy(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setHp(hydrated.actor.getHp().max - 3);
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		return {state, page, id};
	}

	async function openRepair ({page, id}) {
		const outcome = Ui.pRepair({ownerPage: page, companionId: id});
		await flush();
		return {
			outcome,
			amount: modal.root.querySelector(".cs-simulacrum__repair-amount"),
			laboratory: modal.root.querySelector(".cs-simulacrum__laboratory"),
			confirm: modal.root.querySelector(".cs-simulacrum__repair-confirm"),
			status: modal.root.querySelector(".cs-simulacrum__status"),
			submit: () => modal.root.querySelector("form")._handlers.submit({preventDefault () {}}),
		};
	}

	function confirmLaboratory (dialog) {
		dialog.laboratory.checked = true;
		dialog.laboratory._handlers.change();
	}

	test("requires a laboratory and pays only for actual missing HP before awaited guarded persistence", async () => {
		const fixture = setupRepair();
		const {state, page, id} = fixture;
		const dialog = await openRepair(fixture);
		expect(dialog.confirm.disabled).toBe(true);
		expect(dialog.amount.attrs.max).toBeUndefined();
		dialog.amount.value = "20";
		confirmLaboratory(dialog);
		expect(dialog.status.textContent).toContain("Restore 3 HP for 300 gp");
		expect(dialog.confirm.disabled).toBe(false);
		await dialog.submit();
		await expect(dialog.outcome).resolves.toBe(true);
		expect(state.getCompanion(id).hp.current).toBe(state.getCompanion(id).hp.max);
		expect(state.getCurrency().gp).toBe(4700);
		expect(page._saveCurrentCharacter).toHaveBeenCalledWith({
			isReturnStatus: true, expectedCharacterId: "owner", expectedLoadGeneration: 1,
		});
	});

	test("cancellation and unaffordable or fractional requests do not change HP/currency", async () => {
		const fixture = setupRepair();
		fixture.state.setCurrency("gp", 1);
		const before = copy(fixture.state._data);
		const dialog = await openRepair(fixture);
		confirmLaboratory(dialog);
		expect(dialog.confirm.disabled).toBe(true);
		dialog.amount.value = "1.5";
		dialog.amount._handlers.input();
		expect(dialog.confirm.disabled).toBe(true);
		modal.close();
		await expect(dialog.outcome).resolves.toBe(false);
		expect(fixture.state._data).toEqual(before);
		expect(fixture.page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	test("rejects a stale selected character before either payment or healing", async () => {
		const fixture = setupRepair();
		const before = copy(fixture.state._data);
		const dialog = await openRepair(fixture);
		confirmLaboratory(dialog);
		fixture.page._characterLoadGeneration++;
		await dialog.submit();
		expect(dialog.status.textContent).toContain("selected character changed");
		expect(fixture.state._data).toEqual(before);
		modal.close();
		await expect(dialog.outcome).resolves.toBe(false);
	});

	test("failed persistence compensates only this repair, preserving newer actor damage, slot use, spending and notes", async () => {
		const fixture = setupRepair();
		const {state, page, id} = fixture;
		const initialHp = state.getCompanion(id).hp.current;
		page._saveCurrentCharacter.mockImplementationOnce(async () => {
			const hydrated = state.hydrateCompanionActor(id);
			hydrated.actor.setHp(hydrated.actor.getHp().current - 2);
			hydrated.actor.setSpellSlotCurrent(1, 3, {isExpenditure: true});
			expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
			state.deductGold(3);
			state._data.notes.notes = "Keep the new note.";
			return false;
		});
		const dialog = await openRepair(fixture);
		confirmLaboratory(dialog);
		await dialog.submit();
		expect(state.getCompanion(id).hp.current).toBe(initialHp - 2);
		expect(state.hydrateCompanionActor(id).actor.getSpellSlotsCurrent(1)).toBe(3);
		expect(state.getCurrency().gp).toBe(4997);
		expect(state._data.notes.notes).toBe("Keep the new note.");
		expect(dialog.status.textContent).toContain("No HP or currency changes were kept");
		modal.close();
		await expect(dialog.outcome).resolves.toBe(false);
	});

	test("closing the header during pending persistence cannot cancel early or prevent exact denomination rollback", async () => {
		const fixture = setupRepair();
		const {state, page} = fixture;
		state.setCurrency("gp", 199);
		state.setCurrency("pp", 11);
		state.setCurrency("sp", 7);
		state.setCurrency("cp", 9);
		const before = copy(state._data);
		let resolveSave;
		page._saveCurrentCharacter.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
		const dialog = await openRepair(fixture);
		confirmLaboratory(dialog);
		const submission = dialog.submit();
		await flush();
		let settled = false;
		dialog.outcome.then(() => { settled = true; });
		modal.close();
		await flush();
		expect(settled).toBe(false);
		expect(dialog.amount.disabled).toBe(true);
		resolveSave(false);
		await submission;
		await expect(dialog.outcome).resolves.toBe(false);
		expect(state.getCurrency()).toEqual(before.currency);
		expect(state._data.companions).toEqual(before.companions);
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
