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
		const beforeInventory = structuredClone(state.toJson().inventory);
		const {rest, page} = makeRest(state);
		const modalInner = globalThis.e_({tag: "div"});
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose});

		await rest._showLongRestDialog();
		const confirm = createdElements.find(element => element.textContent === "🌙 Finish Long Rest");
		expect(confirm).toBeDefined();
		confirm.click();

		expect(state.getCurrentHp()).toBe(state.getMaxHp());
		expect(state.toJson().inventory).toEqual(beforeInventory);
		expect(commitProduction).toHaveBeenCalledWith({selections: []});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).toHaveBeenCalledWith(true);
	});
});
