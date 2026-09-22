import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
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

function makeRest (state, pageOverrides = {}) {
	const rest = Object.create(Rest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
		getMaterialsModule: () => null,
		...pageOverrides,
	};
	rest._state = state;
	rest._page = page;
	rest._showUndoRestAffordance = jest.fn();
	rest._showGamblerPreparedRollModal = jest.fn();
	rest._showScribingMemorizeModal = jest.fn();
	return {rest, page};
}

function makeEfaReplacementState () {
	const state = new State();
	state.loadFromJson({
		abilities: {int: 18},
		classes: [{
			name: "Artificer",
			source: "EFA",
			level: 3,
			subclass: {name: "Battle Smith", shortName: "Battle Smith", source: "EFA"},
		}],
	});
	const companionId = state.addCompanion({
		name: "Steel Defender",
		source: "EFA",
		type: State.COMPANION_TYPES.CLASS_SUMMON,
		origin: "Battle Smith",
		hp: {max: 20, current: 0, temp: 0},
		featureGrant: {uid: State.EFA_BATTLE_SMITH_FEATURE_UIDS.STEEL_DEFENDER},
		lifecycle: {status: "dead", generation: 2, diedAtGameMinute: 0, timingKnown: true},
	});
	state.reconcileFeatureOwnedCompanion(companionId, {
		summonerContext: state.getFeatureCompanionSummonerContext(State.EFA_BATTLE_SMITH_FEATURE_UIDS.STEEL_DEFENDER),
	});
	const toolItemId = "smith-tools-row";
	state.addItem({id: toolItemId, name: "Smith's Tools", source: "XPHB", type: "AT"}, 1);
	return {state, companionId, toolItemId};
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
	test("stages an optional exact-tool Steel Defender replacement without mutating state", () => {
		const {state, companionId, toolItemId} = makeEfaReplacementState();
		const before = state.toJson();
		const {rest} = makeRest(state);
		const replacement = rest._buildEfaSteelDefenderReplacementSection();

		expect(replacement).toMatchObject({companionId});
		expect(replacement.section.tag).toBe("fieldset");
		expect(replacement.section.children[0]).toMatchObject({
			tag: "legend",
			textContent: "Steel Defender — Optional Replacement",
		});
		expect(replacement.getRequest()).toBeNull();
		const toolSelect = replacement.section.children[2].children[1];
		const inHand = replacement.section.children[3].children[0];
		const status = replacement.section.children[4];
		expect(status._attrs).toMatchObject({role: "status", "aria-live": "polite", "aria-atomic": "true"});
		expect(toolSelect.children.map(option => option.value)).toEqual(["", toolItemId]);
		expect(inHand.disabled).toBe(true);

		toolSelect.value = toolItemId;
		toolSelect._handlers.change();
		expect(inHand.disabled).toBe(false);
		expect(replacement.getRequest()).toEqual({
			companionId,
			toolItemId,
			inHandConfirmed: false,
		});
		inHand.checked = true;
		inHand._handlers.change();
		expect(replacement.getRequest()).toEqual({
			companionId,
			toolItemId,
			inHandConfirmed: true,
		});
		expect(status.textContent).toMatch(/generation 3.*after canonical rest processing/i);
		expect(state.toJson()).toEqual(before);
	});

	test("commits selected replacement only after canonical Long Rest time and keeps cancellation non-mutating", async () => {
		const first = makeEfaReplacementState();
		const cancelledBefore = first.state.toJson();
		const cancelled = makeRest(first.state);
		const firstModal = globalThis.e_({tag: "div"});
		const firstClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValueOnce({eleModalInner: firstModal, doClose: firstClose});
		await cancelled.rest._showLongRestDialog();
		const cancelledFieldset = createdElements.find(element =>
			element._clazz?.includes("charsheet__steel-defender-replacement"),
		);
		const cancelledSelect = cancelledFieldset.children[2].children[1];
		const cancelledInHand = cancelledFieldset.children[3].children[0];
		cancelledSelect.value = first.toolItemId;
		cancelledSelect._handlers.change();
		cancelledInHand.checked = true;
		cancelledInHand._handlers.change();
		firstClose(false);
		expect(first.state.toJson()).toEqual(cancelledBefore);
		expect(cancelled.page.saveCharacter).not.toHaveBeenCalled();

		createdElements.length = 0;
		const second = makeEfaReplacementState();
		const commitReplacement = jest.fn(request => {
			expect(second.state.getGameTimeMinutes()).toBe(480);
			expect(second.state.toJson().gameTime.lastLongRestMinute).toBe(480);
			return second.state.replaceFeatureCompanionAfterLongRest(request);
		});
		const committed = makeRest(second.state, {
			commitFeatureCompanionReplacementAfterLongRest: commitReplacement,
		});
		const secondModal = globalThis.e_({tag: "div"});
		const secondClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValueOnce({eleModalInner: secondModal, doClose: secondClose});
		await committed.rest._showLongRestDialog();
		const fieldset = createdElements.find(element =>
			element._clazz?.includes("charsheet__steel-defender-replacement"),
		);
		const toolSelect = fieldset.children[2].children[1];
		const inHand = fieldset.children[3].children[0];
		toolSelect.value = second.toolItemId;
		toolSelect._handlers.change();
		inHand.checked = true;
		inHand._handlers.change();
		createdElements.find(element => element.textContent === "🌙 Finish Long Rest").click();

		expect(commitReplacement).toHaveBeenCalledWith({
			companionId: second.companionId,
			toolItemId: second.toolItemId,
			inHandConfirmed: true,
		});
		expect(second.state.getCompanion(second.companionId)).toMatchObject({
			active: true,
			hp: {current: 20, max: 20},
			lifecycle: {
				status: "alive",
				generation: 3,
				lastReplacementLongRestMinute: 480,
			},
		});
		expect(committed.page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(committed.page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(secondClose).toHaveBeenCalledWith(true);
	});

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
