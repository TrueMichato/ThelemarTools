import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));
let Rest;
const elements = [];

beforeAll(async () => {
	const original = globalThis.e_;
	globalThis.e_ = options => {
		const element = original(options);
		if (options.click) element._handlers.click = options.click;
		element.focus = jest.fn();
		elements.push(element);
		return element;
	};
	Rest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

afterEach(() => {
	elements.length = 0;
	jest.restoreAllMocks();
});

function makeOwner () {
	const owner = new State();
	owner.setId("rest-original");
	owner.setName("Rest Original");
	owner.addClass({name: "Wizard", source: "PHB", level: 7, spellcastingAbility: "int"});
	owner.setAbilityBase("int", 18);
	owner.recalculateHp({syncCurrent: true});
	owner.setSpellcastingAbility("int");
	owner.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard", sourceClassSource: "PHB"}, true);
	owner.addResource({id: "ice-pool", name: "Ice Pool", current: 0, max: 3, recharge: "long"});
	owner.addInnateSpell({name: "Misty Step", source: "PHB", level: 2, sourceFeature: "Winter Gift", uses: {current: 0, max: 1}, recharge: "long"});
	owner.setCurrency("pp", 100);
	owner.setCurrency("gp", 7);
	owner.setCurrency("sp", 3);
	owner.setCurrency("cp", 9);
	return owner;
}

function addCopy (owner, spellSource = "XPHB", creatorActorId = undefined) {
	const prepared = owner.prepareSimulacrumSnapshot({spellSource, ...(creatorActorId ? {creatorActorId} : {})});
	expect(prepared.ok).toBe(true);
	const id = owner.addCompanion(prepared.companionData);
	const hydrated = owner.hydrateCompanionActor(id);
	const {actor} = hydrated;
	actor.setSpellSlots(1, actor.getSpellSlotsMax(1), 0);
	actor.setResourceCurrent("ice-pool", 0);
	actor._data.spellcasting.innateSpells[0].uses.current = 0;
	actor.addCondition("poisoned");
	actor.addConcentration({kind: "spell", name: "Haste", spellName: "Haste"});
	actor.setHp(actor.getMaxHp() - 3, actor.getMaxHp(), 2);
	expect(owner.commitCompanionActor(id, hydrated).ok).toBe(true);
	return id;
}

function makeRest (owner, overrides = {}) {
	const rest = Object.create(Rest.prototype);
	const saves = [];
	const page = {
		_currentCharacterId: owner.getId(),
		_characterLoadGeneration: 1,
		_lastRestSnapshot: null,
		getState: () => owner,
		saveCharacter: jest.fn(() => { saves.push(copy(owner.toJson())); }),
		renderCharacter: jest.fn(),
		getMaterialsModule: () => null,
		...overrides,
	};
	rest._state = owner;
	rest._page = page;
	rest._showUndoRestAffordance = jest.fn();
	rest._removeUndoRestAffordance = jest.fn();
	return {rest, page, saves};
}

async function openRest (rest, options = {}) {
	const modal = globalThis.e_({tag: "div"});
	const doClose = jest.fn();
	jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValueOnce({eleModalInner: modal, doClose});
	let repairs;
	const build = rest._buildSimulacrumLongRestRepairSection.bind(rest);
	jest.spyOn(rest, "_buildSimulacrumLongRestRepairSection").mockImplementation(args => {
		repairs = build(args);
		return repairs;
	});
	await rest._showLongRestDialog(options);
	const confirm = elements.findLast(element => element.textContent === "🌙 Finish Long Rest");
	const cancel = elements.findLast(element => element.textContent === "Cancel");
	return {repairs, confirm, cancel, doClose};
}

function selectRepair (repairs, amount, withinFiveFeet = true, index = 0) {
	const row = repairs.rows[index];
	row.amount.value = String(amount);
	row.proximity.checked = withinFiveFeet;
	row.amount._handlers.input();
	return row;
}

function tracked (owner, id) {
	return {
		hp: copy(owner.getHp()),
		minute: owner.getGameTimeMinutes(),
		currency: owner.getCurrency(),
		slots: copy(owner.getSpellSlots()),
		actor: copy(owner.getCompanion(id).actorSnapshot),
	};
}

describe("owner Long Rest XPHB Simulacrum paid repair", () => {
	test("stages optional numeric/proximity controls without mutation and focuses only the requested copy", async () => {
		const owner = makeOwner();
		addCopy(owner, "PHB");
		const id = addCopy(owner);
		const before = copy(owner.toJson());
		const {rest} = makeRest(owner);
		const {repairs} = await openRest(rest, {focusSimulacrum: id});
		expect(repairs.section.tag).toBe("fieldset");
		expect(repairs.rows).toHaveLength(1);
		expect(repairs.rows[0].companionId).toBe(id);
		expect(repairs.rows[0].amount.focus).toHaveBeenCalledTimes(1);
		expect(repairs.getRequests()).toEqual([]);
		expect(repairs.isValid()).toBe(true);
		expect(owner.toJson()).toEqual(before);
	});

	test("an ordinary owner Long Rest leaves an unselected XPHB actor's HP and exhausted pools unchanged", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		owner.setHp(3, owner.getMaxHp(), 0);
		owner.setSpellSlots(1, owner.getSpellSlotsMax(1), 0);
		const actorBefore = copy(owner.getCompanion(id).actorSnapshot);
		const currencyBefore = owner.getCurrency();
		const {rest, page} = makeRest(owner);
		const {confirm, doClose} = await openRest(rest);
		await confirm._handlers.click();
		expect(owner.getHp().current).toBe(owner.getMaxHp());
		expect(owner.getSpellSlotsCurrent(1)).toBe(owner.getSpellSlotsMax(1));
		expect(owner.getCompanion(id).actorSnapshot).toEqual(actorBefore);
		expect(owner.getCurrency()).toEqual(currencyBefore);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).toHaveBeenCalledWith(true);
	});

	test("PHB copies do not get Long Rest repair controls or recover through their owner's rest", async () => {
		const owner = makeOwner();
		const id = addCopy(owner, "PHB");
		const before = copy(owner.getCompanion(id).actorSnapshot);
		const {rest} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		expect(repairs).toBeNull();
		await confirm._handlers.click();
		expect(owner.getCompanion(id).actorSnapshot).toEqual(before);
		expect(owner.getGameTimeMinutes()).toBe(480);
	});

	test("requires proximity and sufficient funds, reports the capped actual HP cost, and allows opting out", async () => {
		const owner = makeOwner();
		addCopy(owner);
		const {rest} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		const row = selectRepair(repairs, 20, false);
		expect(confirm.disabled).toBe(true);
		selectRepair(repairs, 20);
		expect(confirm.disabled).toBe(false);
		expect(row.status.textContent).toContain("3 HP restored for 300 gp");
		owner.setCurrency("pp", 0);
		selectRepair(repairs, 20);
		expect(confirm.disabled).toBe(true);
		expect(row.status.textContent).not.toContain("3 HP restored");
		selectRepair(repairs, 0);
		expect(confirm.disabled).toBe(false);
	});

	test("checks combined repair costs rather than independently approving two unaffordable payments", async () => {
		const owner = makeOwner();
		addCopy(owner);
		addCopy(owner);
		owner.setCurrency("pp", 0);
		owner.setCurrency("gp", 250);
		const {rest} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 2, true, 0);
		selectRepair(repairs, 2, true, 1);
		expect(confirm.disabled).toBe(true);
		expect(repairs.section.children.at(-1).textContent).toContain("Insufficient funds for the selected repairs");
		selectRepair(repairs, 0, true, 1);
		expect(confirm.disabled).toBe(false);
	});

	test.each(["", "-1", "1.5", "not-a-number"])("rejects invalid staged amount %j without mutating state", async amount => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const before = tracked(owner, id);
		const {rest, page} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, amount);
		await confirm._handlers.click();
		expect(confirm.disabled).toBe(true);
		expect(tracked(owner, id)).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	test("cancelling selected repairs does not spend gold, heal, advance time, rest, or save", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const before = tracked(owner, id);
		const {rest, page} = makeRest(owner);
		const {repairs, confirm, cancel, doClose} = await openRest(rest);
		selectRepair(repairs, 2);
		cancel._handlers.click();
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(doClose).toHaveBeenCalledWith(false);
	});

	test("commits genuine repair after owner recovery, charges only actual HP, persists and undoes HP/currency without refilling copy pools", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const phb = addCopy(owner, "PHB");
		owner.setHp(3, owner.getMaxHp(), 0);
		owner.setSpellSlots(1, owner.getSpellSlotsMax(1), 0);
		const before = tracked(owner, id);
		const phbBefore = copy(owner.getCompanion(phb).actorSnapshot);
		const repair = jest.spyOn(owner, "repairSimulacrum");
		const {rest, page, saves} = makeRest(owner);
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 20);
		await confirm._handlers.click();

		expect(owner.getGameTimeMinutes()).toBe(480);
		expect(owner.getHp().current).toBe(owner.getMaxHp());
		expect(owner.getSpellSlotsCurrent(1)).toBe(owner.getSpellSlotsMax(1));
		expect(owner.getTotalGold()).toBeCloseTo(707.39);
		const afterActor = owner.getCompanion(id).actorSnapshot;
		expect(afterActor.state.hp.current).toBe(before.actor.state.hp.current + 3);
		expect(afterActor.state.spellcasting).toEqual(before.actor.state.spellcasting);
		expect(afterActor.state.resources).toEqual(before.actor.state.resources);
		expect(afterActor.state.conditions).toEqual(before.actor.state.conditions);
		expect(afterActor.state.concentrations).toEqual(before.actor.state.concentrations);
		expect(repair).toHaveBeenCalledWith(id, {amount: 20, ownerLongRest: true, withinFiveFeet: true});
		expect(owner.getCompanion(phb).actorSnapshot).toEqual(phbBefore);
		expect(saves[0].companions.find(entry => entry.id === id).actorSnapshot).toEqual(afterActor);
		expect(doClose).toHaveBeenCalledWith(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		expect(rest._onUndoRest()).toBe(true);
		expect(tracked(owner, id)).toEqual(before);
		expect(saves[1].currency).toEqual(before.currency);
		expect(saves[1].companions.find(entry => entry.id === id).actorSnapshot).toEqual(before.actor);
	});

	test("repairs only after the canonical Long Rest time transition", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const {rest} = makeRest(owner);
		const repair = owner.repairSimulacrum.bind(owner);
		jest.spyOn(owner, "repairSimulacrum").mockImplementation((companionId, options) => {
			expect(owner.getGameTimeMinutes()).toBe(480);
			expect(owner.getHp().current).toBe(owner.getMaxHp());
			return repair(companionId, options);
		});
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 1);
		await confirm._handlers.click();
		expect(owner.getCompanion(id).actorSnapshot.state.hp.current).toBe(owner.getCompanion(id).actorSnapshot.state.hp.max - 2);
	});

	test("save failure rolls back the entire rest, exact denominations, companion pools and previous Undo snapshot", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		owner.setHp(3, owner.getMaxHp(), 0);
		const before = tracked(owner, id);
		const {rest, page} = makeRest(owner);
		const previousSnapshot = {restType: "short", json: copy(owner.toJson())};
		page._lastRestSnapshot = previousSnapshot;
		const saves = [];
		page._saveCurrentCharacter = jest.fn(async () => {
			saves.push(copy(owner.toJson()));
			return saves.length > 1;
		});
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 2);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(page._lastRestSnapshot).toBe(previousSnapshot);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(2);
		expect(saves[0].currency).not.toEqual(before.currency);
		expect(saves[1].currency).toEqual(before.currency);
		expect(saves[1].companions.find(entry => entry.id === id).actorSnapshot).toEqual(before.actor);
		expect(doClose).not.toHaveBeenCalledWith(true);
		expect(rest._showUndoRestAffordance).toHaveBeenCalledWith("short");
	});

	test.each(["payment", "projection"])("%s failure rolls back all owner rest changes and actor resources", async failure => {
		const owner = makeOwner();
		const id = addCopy(owner);
		owner.setHp(3, owner.getMaxHp(), 0);
		const before = tracked(owner, id);
		if (failure === "payment") jest.spyOn(owner, "deductGold").mockReturnValue(false);
		else jest.spyOn(owner, "commitCompanionActor").mockReturnValue({ok: false, message: "Projection failed"});
		const {rest} = makeRest(owner);
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 2);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(doClose).not.toHaveBeenCalledWith(true);
	});

	test("failure on a later repair rolls back an earlier copy's committed HP and payment with the owner rest", async () => {
		const owner = makeOwner();
		const first = addCopy(owner);
		const second = addCopy(owner);
		const before = tracked(owner, first);
		const secondBefore = copy(owner.getCompanion(second).actorSnapshot);
		const repair = owner.repairSimulacrum.bind(owner);
		jest.spyOn(owner, "repairSimulacrum").mockImplementation((id, options) => id === second
			? {ok: false, message: "Second projection failed"}
			: repair(id, options));
		const {rest} = makeRest(owner);
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 2, true, 0);
		selectRepair(repairs, 2, true, 1);
		await confirm._handlers.click();
		expect(tracked(owner, first)).toEqual(before);
		expect(owner.getCompanion(second).actorSnapshot).toEqual(secondBefore);
		expect(doClose).not.toHaveBeenCalledWith(true);
	});

	test("rejects a foreign creator even when this owner has enough gold and is within 5 feet", async () => {
		const owner = makeOwner();
		const id = addCopy(owner, "XPHB", "other-caster");
		const before = tracked(owner, id);
		const {rest, page} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 2);
		expect(confirm.disabled).toBe(true);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a staged repair refuses a changed actor revision rather than paying for stale input", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const {rest, page} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 1);
		owner.setCompanionTempHp(id, 4);
		const before = tracked(owner, id);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(repairs.rows[0].status.textContent).toContain("changed while Long Rest was open");
	});

	test("duplicate confirmation while persistence is pending cannot pay or rest twice", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const {rest, page} = makeRest(owner);
		let resolveSave;
		page._saveCurrentCharacter = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 1);
		const first = confirm._handlers.click();
		const once = tracked(owner, id);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(once);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		resolveSave(true);
		await first;
	});

	test("closing the modal during persistence rolls the repair and rest back before keeping a save", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		owner.setHp(3, owner.getMaxHp(), 0);
		const before = tracked(owner, id);
		const {rest, page} = makeRest(owner);
		let resolveSave;
		page._saveCurrentCharacter = jest.fn()
			.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }))
			.mockResolvedValue(true);
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 1);
		const pending = confirm._handlers.click();
		CharacterSheetModal.pGetShow.mock.calls.at(-1)[0].cbClose(false);
		resolveSave(true);
		await pending;
		expect(tracked(owner, id)).toEqual(before);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(2);
		expect(doClose).not.toHaveBeenCalledWith(true);
	});

	test.each(["identity", "selection", "generation"])("stale owner %s before confirmation prevents repair and recovery", async change => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const {rest, page} = makeRest(owner);
		const {repairs, confirm} = await openRest(rest);
		selectRepair(repairs, 1);
		if (change === "identity") owner.setId("successor");
		else if (change === "selection") page._currentCharacterId = "successor";
		else page._characterLoadGeneration++;
		const before = tracked(owner, id);
		await confirm._handlers.click();
		expect(tracked(owner, id)).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a failed pending save cannot roll the old rest snapshot into a newly loaded character", async () => {
		const owner = makeOwner();
		addCopy(owner);
		const {rest, page} = makeRest(owner);
		let resolveSave;
		page._saveCurrentCharacter = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
		const {repairs, confirm, doClose} = await openRest(rest);
		selectRepair(repairs, 1);
		const pending = confirm._handlers.click();
		owner.reset();
		owner.setId("successor");
		owner.setName("Successor must survive");
		page._currentCharacterId = "successor";
		page._characterLoadGeneration++;
		const successor = copy(owner.toJson());
		resolveSave(false);
		await pending;
		expect(owner.toJson()).toEqual(successor);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).not.toHaveBeenCalledWith(true);
	});

	test("a character change while the modal opens discards the stale dialog before offering controls", async () => {
		const owner = makeOwner();
		const id = addCopy(owner);
		const {rest, page} = makeRest(owner);
		let resolveModal;
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockImplementation(() => new Promise(resolve => { resolveModal = resolve; }));
		const pending = rest._showLongRestDialog({focusSimulacrum: id});
		page._characterLoadGeneration++;
		const before = tracked(owner, id);
		resolveModal({eleModalInner: globalThis.e_({tag: "div"}), doClose});
		await pending;
		expect(tracked(owner, id)).toEqual(before);
		expect(doClose).toHaveBeenCalledWith(false);
		expect(elements.some(element => element._clazz?.includes("charsheet__simulacrum-repairs"))).toBe(false);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});
});
