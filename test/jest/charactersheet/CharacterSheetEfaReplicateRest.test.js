import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
let Rest;
let createdElements;

beforeAll(async () => {
	const originalE = globalThis.e_;
	createdElements = [];
	globalThis.e_ = opts => {
		const element = originalE(opts);
		element._attrs = {};
		element.setAttribute = (name, value) => { element._attrs[name] = String(value); };
		createdElements.push(element);
		return element;
	};
	Rest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

beforeEach(() => {
	createdElements.length = 0;
	jest.clearAllMocks();
});

function makeRest (state) {
	const rest = Object.create(Rest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
		getMaterialsModule: () => null,
	};
	rest._state = state;
	rest._page = page;
	rest._showUndoRestAffordance = jest.fn();
	rest._showGamblerPreparedRollModal = jest.fn();
	rest._showScribingMemorizeModal = jest.fn();
	return {rest, page};
}

function mockProductionOptions (state) {
	jest.spyOn(state, "getGeneratedFeatureItemRows").mockReturnValue([]);
	jest.spyOn(state, "getEfaReplicateMagicItemProductionOptions").mockReturnValue({
		available: true,
		classLevel: 2,
		maxCreatedItems: 2,
		tinkersToolsItemId: "tools",
		unresolvedPlans: [],
		unavailableReason: null,
		plans: [
			{
				ok: true,
				code: "resolved-plan-item",
				plan: {
					slotId: "plan-bag",
					selection: {
						name: "Bag of Holding",
						source: "XDMG",
						itemUid: "Bag of Holding|XDMG",
						displayName: "Bag of Holding",
					},
				},
				options: [{
					itemUid: "Bag of Holding|XDMG",
					name: "Bag of Holding",
					source: "XDMG",
					requiresAttunement: true,
				}],
			},
			{
				ok: true,
				code: "specific-variant-selection-required",
				plan: {
					slotId: "plan-weapon",
					selection: {
						name: "+1 Weapon",
						source: "XDMG",
						itemUid: "+1 Weapon|XDMG",
						displayName: "Weapon +1",
					},
				},
				options: [
					{
						itemUid: "Battleaxe +1|XDMG",
						name: "Battleaxe +1",
						source: "XDMG",
						requiresAttunement: false,
					},
					{
						itemUid: "Longsword +1|XDMG",
						name: "Longsword +1",
						source: "XDMG",
						requiresAttunement: false,
					},
				],
			},
		],
	});
}

describe("EFA Replicate Magic Item long-rest interaction", () => {
	test("builds a keyboard-native optional picker with labelled rows, live validation, and a non-mutating blank default", () => {
		const state = new State();
		mockProductionOptions(state);
		const {rest} = makeRest(state);
		const production = rest._buildEfaReplicateMagicItemProductionSection();

		expect(production.section.tag).toBe("fieldset");
		expect(production.rows).toHaveLength(2);
		expect(production.section.children[0]).toMatchObject({
			tag: "legend",
			textContent: "Replicate Magic Item — Optional Production",
		});
		const status = production.section.children.at(-1);
		expect(status._attrs).toMatchObject({role: "status", "aria-live": "polite"});
		expect(production.getRequest()).toEqual({selections: []});
		expect(production.getValidation()).toEqual({isValid: true, issues: []});

		const weaponRow = production.rows[0];
		weaponRow.planSelect.value = "plan-weapon";
		weaponRow.planSelect._handlers.change();
		expect(weaponRow.itemSelect.disabled).toBe(false);
		weaponRow.itemSelect.value = "Longsword +1|XDMG";
		weaponRow.itemSelect._handlers.change();
		expect(production.getRequest()).toEqual({
			selections: [{
				slotId: "plan-weapon",
				resolvedItemUid: "Longsword +1|XDMG",
				attune: false,
			}],
		});

		const duplicateRow = production.rows[1];
		duplicateRow.planSelect.value = "plan-weapon";
		duplicateRow.planSelect._handlers.change();
		expect(production.getValidation()).toMatchObject({
			isValid: false,
			issues: expect.arrayContaining([expect.stringMatching(/different known plan/i)]),
		});
		expect(status.textContent).toMatch(/long rest will still finish/i);
	});

	test("the actual Finish Long Rest handler commits recovery and calls production with an empty request without changing inventory", async () => {
		const state = new State();
		state.addClass({name: "Artificer", source: "EFA", level: 2});
		state.setMaxHp(20);
		state.setCurrentHp(5);
		state.addItem({id: "control-item", name: "Control Item", source: "TST", type: "G"});
		mockProductionOptions(state);
		const commitProduction = jest.spyOn(state, "commitEfaReplicateMagicItemsAtLongRest")
			.mockReturnValue({ok: true, code: "replicate-production-skipped", resolved: []});
		const advanceMinutes = jest.spyOn(state, "advanceGameTimeMinutes");
		const advanceDays = jest.spyOn(state, "advanceGeneratedFeatureItemLifecycleDays");
		const beforeInventory = structuredClone(state.toJson().inventory);
		const {rest, page} = makeRest(state);
		const modalInner = globalThis.e_({tag: "div"});
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose});

		await rest._showLongRestDialog();
		const confirm = createdElements.find(element => element.textContent === "🌙 Finish Long Rest");
		expect(confirm).toBeDefined();
		await confirm._handlers.click();

		expect(state.getCurrentHp()).toBe(state.getMaxHp());
		expect(state.getGameTimeMinutes()).toBe(480);
		expect(state.toJson().inventory).toEqual(beforeInventory);
		expect(commitProduction).toHaveBeenCalledWith({selections: []});
		expect(advanceMinutes).toHaveBeenCalledWith(480, {
			reason: "long-rest",
			identity: "CharacterSheetRest.finishLongRest",
		});
		expect(advanceDays).not.toHaveBeenCalled();
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).toHaveBeenCalledWith(true);
	});

	test("protects the selected Arcane Firearm wrapper while committing Replicate production", async () => {
		const state = new State();
		state.addClass({
			name: "Artificer",
			source: "EFA",
			level: 5,
			subclass: {name: "Artillerist", shortName: "Artillerist", source: "EFA"},
		});
		const firearmId = "replicated-firearm";
		state.addItem({
			id: firearmId,
			name: "Carved Wand",
			source: "XPHB",
			type: "WD",
			quantity: 1,
			equipped: true,
			_isCustom: true,
		});
		state.setItemEquipped(firearmId, true);
		expect(state.setEfaArcaneFirearmBinding(firearmId).ok).toBe(true);
		mockProductionOptions(state);
		const commitProduction = jest.spyOn(state, "commitEfaReplicateMagicItemsAtLongRest")
			.mockReturnValue({ok: true, code: "replicate-production-skipped", resolved: []});
		const {rest} = makeRest(state);
		const modalInner = globalThis.e_({tag: "div"});
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose: jest.fn()});

		await rest._showLongRestDialog();
		const confirm = createdElements.find(element => element.textContent === "🌙 Finish Long Rest");
		await confirm._handlers.click();

		expect(commitProduction).toHaveBeenCalledWith({
			selections: [],
			protectedInventoryItemIds: [firearmId],
		});
	});

	test("failed Long Rest persistence restores the previous undo snapshot and affordance", async () => {
		const state = new State();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.setMaxHp(20);
		state.setCurrentHp(5);
		const {rest, page} = makeRest(state);
		const previousSnapshot = {
			restType: "short",
			json: structuredClone(state.toJson()),
		};
		page._lastRestSnapshot = previousSnapshot;
		page._saveCurrentCharacter = jest.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const modalInner = globalThis.e_({tag: "div"});
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose: jest.fn()});

		await rest._showLongRestDialog();
		const confirm = createdElements.find(element => element.textContent === "🌙 Finish Long Rest");
		await confirm._handlers.click();

		expect(state.getCurrentHp()).toBe(5);
		expect(page._lastRestSnapshot).toBe(previousSnapshot);
		expect(rest._showUndoRestAffordance).toHaveBeenCalledWith("short");
	});

	test("opening and cancelling a short rest is non-mutating, while Finish Short Rest commits 60 minutes", async () => {
		const state = new State();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.setMaxHp(12);
		state.setCurrentHp(6);
		const advanceMinutes = jest.spyOn(state, "advanceGameTimeMinutes");
		const {rest, page} = makeRest(state);
		const modalInner = globalThis.e_({tag: "div"});
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose});

		await rest._showShortRestDialog();
		expect(state.getGameTimeMinutes()).toBe(0);
		doClose(false);
		expect(state.getGameTimeMinutes()).toBe(0);
		expect(page.saveCharacter).not.toHaveBeenCalled();

		const confirm = createdElements.find(element => element.textContent === "✓ Finish Short Rest");
		expect(confirm).toBeDefined();
		confirm.click();

		expect(state.getGameTimeMinutes()).toBe(60);
		expect(advanceMinutes).toHaveBeenCalledWith(60, {
			reason: "short-rest",
			identity: "CharacterSheetRest.finishShortRest",
		});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});
});
