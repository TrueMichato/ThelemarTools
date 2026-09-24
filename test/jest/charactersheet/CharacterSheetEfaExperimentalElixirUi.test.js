import {jest} from "@jest/globals";

import "./setup.js";

if (!String.prototype.escapeQuotes) {
	String.prototype.escapeQuotes = function () {
		return this.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	};
}
if (!String.prototype.qq) String.prototype.qq = function () { return this.escapeQuotes(); };

globalThis.document = globalThis.document || {
	addEventListener () {},
	removeEventListener () {},
	getElementById () { return null; },
	querySelector () { return null; },
	querySelectorAll () { return []; },
};
globalThis.CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades || {
	isWeapon: () => false,
	isArmor: () => false,
	isShield: () => false,
	getUpgradeEffects: () => ({tags: [], notes: []}),
	getGemstoneSummary: () => "",
};

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-efa-experimental-elixir-ui.js";
import "../../../js/charactersheet/charactersheet-features.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetModal = globalThis.CharacterSheetModal;
const CharacterSheetEfaExperimentalElixirUi = globalThis.CharacterSheetEfaExperimentalElixirUi;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const CharacterSheetRest = globalThis.CharacterSheetRest;

const EXACT_FEATURE = {
	id: "efa-experimental-elixir",
	name: "Experimental Elixir",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	subclassName: "Alchemist",
	subclassShortName: "Alchemist",
	subclassSource: "EFA",
	level: 3,
	featureType: "Class",
	isSubclassFeature: true,
	entries: ["Create experimental elixirs."],
};

function makeState ({
	classSource = "EFA",
	subclassSource = "EFA",
	level = 5,
	slotLevel = 1,
	slotMax = 2,
	slotCurrent = 1,
} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: {
			name: "Alchemist",
			shortName: "Alchemist",
			source: subclassSource,
		},
	});
	state.setMaxHp(30);
	state.setHp(7, 30, 0);
	state.setSpellSlots(slotLevel, slotMax, slotCurrent);
	return state;
}

function addSupplies (state, {
	name = "Alchemist's Supplies",
	source = "XPHB",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({name, source, type: "AT", quantity: 1, _isCustom: true});
	const row = state.getItems().at(-1);
	state.setItemEquipped(row.id, equipped);
	if (proficient) state.addToolProficiency(name);
	return row;
}

function createVial (state, {
	effectKey = "swiftness",
	spentSlotLevel = 1,
} = {}) {
	const created = state.createEfaExperimentalElixirSpellSlotVial({effectKey, spentSlotLevel});
	expect(created.ok).toBe(true);
	return state.getItems().find(row => row.id === created.itemId);
}

function makePage (state) {
	return {
		getState: () => state,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getItemMaterials: () => [],
		getMaterialsModule: () => null,
		getNotes: () => null,
		_getActivatableAbilityForFeature: () => null,
		_getFeatureHoverLink: feature => feature.name,
		_renderFavouriteStar: () => null,
	};
}

function makeFeatures (state) {
	return new CharacterSheetFeatures(makePage(state));
}

function makeInventory (state) {
	return new CharacterSheetInventory(makePage(state));
}

function makeRest (state) {
	const page = makePage(state);
	page._lastRestSnapshot = null;
	const rest = Object.create(CharacterSheetRest.prototype);
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

function normalizeState (state) {
	state.loadFromJson(state.toJson());
	return state.toJson();
}

describe("EFA Experimental Elixir feature status", () => {
	test("renders exact-source status, batch size, focus readiness, and slot-create action", () => {
		const state = makeState({level: 5});
		addSupplies(state);
		createVial(state);
		const html = makeFeatures(state)._renderFeature(EXACT_FEATURE).outerHTML;

		expect(html).toContain("1 valid vial");
		expect(html).toContain("Long Rest: 3");
		expect(html).toContain("Supplies ready");
		expect(html).toContain("Create with Spell Slot");
		expect(html).not.toContain("efa-elixir-create-reason");
	});

	test("explains missing focus, slot, and spent Magic action instead of silently disabling", () => {
		const unavailable = CharacterSheetEfaExperimentalElixirUi.renderFeatureStatusHtml(new CharacterSheetState());
		expect(unavailable.reasonHtml).toContain("Exact EFA Alchemist source is unavailable");

		const noFocus = CharacterSheetEfaExperimentalElixirUi.renderFeatureStatusHtml(makeState());
		expect(noFocus.actionHtml).toContain("disabled");
		expect(noFocus.reasonHtml).toContain("Alchemist's Supplies");

		const noSlotState = makeState({slotCurrent: 0});
		addSupplies(noSlotState);
		noSlotState._data.spellcasting.spellSlots = {};
		const noSlot = CharacterSheetEfaExperimentalElixirUi.renderFeatureStatusHtml(noSlotState);
		expect(noSlot.reasonHtml).toContain("No standard spell slot");

		const noActionState = makeState();
		addSupplies(noActionState);
		noActionState.startCombat();
		noActionState.consumeActionType("action");
		const noAction = CharacterSheetEfaExperimentalElixirUi.renderFeatureStatusHtml(noActionState);
		expect(noAction.reasonHtml).toContain("Magic action");
	});

	test.each([
		["TCE subclass", {...EXACT_FEATURE, subclassSource: "TCE"}],
		["wrong class source", {...EXACT_FEATURE, classSource: "PHB"}],
		["custom same-name feature", {...EXACT_FEATURE, source: "Custom"}],
	])("does not add EFA actions to %s", (_label, feature) => {
		const html = makeFeatures(makeState())._renderFeature(feature).outerHTML;
		expect(html).not.toContain("charsheet__efa-elixir-create");
		expect(html).not.toContain("valid vial");
	});
});

describe("EFA Experimental Elixir modal contracts", () => {
	test("create modal exposes visible effect/slot labels and one live result region", () => {
		const state = makeState({level: 9, slotLevel: 3, slotMax: 2, slotCurrent: 1});
		addSupplies(state);
		const html = CharacterSheetEfaExperimentalElixirUi.renderCreateModalHtml(state);

		expect(html.match(/name="efa-elixir-effect"/g)).toHaveLength(5);
		expect(html).toContain("<legend>Effect</legend>");
		expect(html).toContain("for=\"efa-elixir-slot-level\"");
		expect(html).toContain("Alchemist's Supplies (XPHB)");
		expect(html).toContain("Magic action");
		expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
		expect(html).toContain("Create vial");
		expect(html).toContain("Cancel");
	});

	test("consume modal uses native Self/Other controls with labelled external-target confirmation", () => {
		const state = makeState();
		const vial = createVial(state, {effectKey: "flight"});
		const html = CharacterSheetEfaExperimentalElixirUi.renderConsumeModalHtml(state, vial.id);

		expect(html).toContain("<legend>Recipient</legend>");
		expect(html).toContain("value=\"self\" checked");
		expect(html).toContain("value=\"other\"");
		expect(html).toContain("for=\"efa-elixir-target-name\"");
		expect(html).toContain("within 5 feet");
		expect(html).toContain("does not change external HP or state");
		expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
	});

	test("both flows use CharacterSheetModal, focus the first unresolved native control, and request opener restoration", async () => {
		const state = makeState();
		addSupplies(state);
		const vial = createVial(state);
		const modalInner = globalThis.e_({});
		const pGetShow = jest.spyOn(CharacterSheetModal, "pGetShow")
			.mockResolvedValue({eleModalInner: modalInner, doClose: jest.fn()});
		const focusFirst = jest.spyOn(CharacterSheetModal, "focusFirst").mockReturnValue(null);

		await CharacterSheetEfaExperimentalElixirUi.pShowCreateModal({state, page: makePage(state)});
		await CharacterSheetEfaExperimentalElixirUi.pShowConsumeModal({state, page: makePage(state), itemId: vial.id});

		expect(pGetShow).toHaveBeenNthCalledWith(1, expect.objectContaining({
			title: "Create Experimental Elixir",
			getFocusRestoreTarget: expect.any(Function),
			fnCanClose: expect.any(Function),
		}));
		expect(pGetShow).toHaveBeenNthCalledWith(2, expect.objectContaining({
			title: "Drink or Administer Experimental Elixir",
			getFocusRestoreTarget: expect.any(Function),
			fnCanClose: expect.any(Function),
		}));
		expect(focusFirst).toHaveBeenNthCalledWith(1, modalInner, {preferSelector: "input[name=\"efa-elixir-effect\"]"});
		expect(focusFirst).toHaveBeenNthCalledWith(2, modalInner, {preferSelector: "input[name=\"efa-elixir-target\"]"});
		pGetShow.mockRestore();
		focusFirst.mockRestore();
	});

	test("persistence lock blocks shared close paths while pending and unlocks on failure", async () => {
		const btnCancel = {disabled: false};
		const btnHeaderClose = {disabled: false};
		const wrp = {
			setAttribute: jest.fn(),
			removeAttribute: jest.fn(),
		};
		const lock = CharacterSheetEfaExperimentalElixirUi._createModalPersistenceLock({
			wrp,
			eleModal: {querySelector: jest.fn(() => btnHeaderClose)},
			btnCancel,
		});
		let resolveCommit;
		const pendingCommit = new Promise(resolve => { resolveCommit = resolve; });

		const resultPromise = CharacterSheetEfaExperimentalElixirUi._pRunPersistenceLocked({
			lock,
			operation: () => pendingCommit,
		});

		expect(lock.canClose()).toBe(false);
		expect(btnCancel.disabled).toBe(true);
		expect(btnHeaderClose.disabled).toBe(true);
		expect(wrp.setAttribute).toHaveBeenCalledWith("aria-busy", "true");

		resolveCommit({ok: false, committed: false, code: "save-failed"});
		await expect(resultPromise).resolves.toMatchObject({ok: false, committed: false});
		expect(lock.canClose()).toBe(true);
		expect(btnCancel.disabled).toBe(false);
		expect(btnHeaderClose.disabled).toBe(false);
		expect(wrp.removeAttribute).toHaveBeenCalledWith("aria-busy");
	});

	test("persistence lock stays closed after mechanics success until the success UI unlocks it", async () => {
		const lock = CharacterSheetEfaExperimentalElixirUi._createModalPersistenceLock({
			wrp: {setAttribute: jest.fn(), removeAttribute: jest.fn()},
			eleModal: null,
			btnCancel: {disabled: false},
		});

		await expect(CharacterSheetEfaExperimentalElixirUi._pRunPersistenceLocked({
			lock,
			operation: async () => ({ok: true, committed: true}),
		})).resolves.toMatchObject({ok: true, committed: true});
		expect(lock.canClose()).toBe(false);

		lock.setPending(false);
		expect(lock.canClose()).toBe(true);
	});
});

describe("EFA Experimental Elixir create transaction UI boundary", () => {
	test("commits one slot and in-combat Magic action, saves once, and refreshes all surfaces", async () => {
		const state = makeState({slotLevel: 2});
		addSupplies(state);
		state.startCombat();
		const page = makePage(state);

		const result = await CharacterSheetEfaExperimentalElixirUi.commitCreate({
			state,
			page,
			effectKey: "resilience",
			slotLevel: 2,
		});

		expect(result).toMatchObject({ok: true, committed: true, spentSlotLevel: 2, actionTracked: true});
		expect(state.getSpellSlotsCurrent(2)).toBe(0);
		expect(state.isActionTypeAvailable("action")).toBe(false);
		expect(state.getEfaExperimentalElixirRows()).toHaveLength(1);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});

	test.each([
		["missing focus", state => state, "efa-experimental-elixir-focus-unavailable"],
		["no slot", state => { addSupplies(state); state.setSpellSlots(1, 1, 0); }, "efa-experimental-elixir-spell-slot-unavailable"],
		["spent action", state => { addSupplies(state); state.startCombat(); state.consumeActionType("action"); }, "efa-experimental-elixir-action-unavailable"],
	])("%s leaves slot, action, items, and persistence untouched", async (_label, setup, code) => {
		const state = makeState();
		setup(state);
		const before = state.toJson();
		const page = makePage(state);

		const result = await CharacterSheetEfaExperimentalElixirUi.commitCreate({
			state,
			page,
			effectKey: "healing",
			slotLevel: 1,
		});

		expect(result).toMatchObject({ok: false, committed: false, code});
		expect(state.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
	});

	test("rolls the whole state back if persistence fails after a successful mechanics commit", async () => {
		const state = makeState();
		addSupplies(state);
		const before = normalizeState(state);
		const page = makePage(state);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));

		const result = await CharacterSheetEfaExperimentalElixirUi.commitCreate({
			state,
			page,
			effectKey: "boldness",
			slotLevel: 1,
		});

		expect(result).toMatchObject({ok: false, committed: false, rolledBack: true});
		expect(state.toJson()).toEqual(before);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});
});

describe("EFA Experimental Elixir inventory and consume boundary", () => {
	test("valid exact-owner rows show Drink / Administer with effect, duration, and origin", () => {
		const state = makeState({level: 9});
		const vial = createVial(state, {effectKey: "swiftness", spentSlotLevel: 2});
		const html = makeInventory(state)._renderItemRow(vial).outerHTML;

		expect(html).toContain("Drink / Administer");
		expect(html).toContain("Walking speed increases by 15 feet");
		expect(html).toContain("Spell slot (level 2)");
		expect(html).not.toContain("charsheet__item-use\"");
	});

	test("stale exact-owner rows remain visible, explain repair, and cannot be consumed", () => {
		const state = makeState();
		const vial = createVial(state);
		(vial.item || vial)._generatedItemProvenance.owner.featureUid = "Experimental Elixir|Artificer|EFA|Alchemist|EFA|3";
		const html = makeInventory(state)._renderItemRow(vial).outerHTML;

		expect(html).toContain("Repair required");
		expect(html).toContain("legacy subclass feature uid");
		expect(html).toContain("shared generated-item edit/delete/restore controls");
		expect(html).not.toContain("charsheet__efa-elixir-consume");
		expect(html).not.toContain("charsheet__item-use\"");
	});

	test.each([
		[
			"unsupported metadata schema",
			metadata => { metadata.metadataSchemaVersion = 999; },
			"efa experimental elixir metadata version",
		],
		[
			"invalid effect snapshot",
			metadata => { metadata.value = {...metadata.value, amount: Number(metadata.value?.amount || 0) + 1}; },
			"efa experimental elixir snapshot",
		],
	])("generic-valid %s is still rendered through the shared repair path", (_label, mutate, reasonText) => {
		const state = makeState();
		const vial = createVial(state, {effectKey: "swiftness"});
		const metadata = (vial.item || vial)._generatedItemProvenance.metadata;
		mutate(metadata);

		expect(state.classifyGeneratedFeatureItem(vial).status).toBe("valid");
		expect(state.classifyEfaExperimentalElixir(vial)).toMatchObject({status: "stale", repairRequired: true});
		const html = makeInventory(state)._renderItemRow(vial).outerHTML;

		expect(html).toContain("Repair required");
		expect(html).toContain(reasonText);
		expect(html).not.toContain("charsheet__efa-elixir-consume");
		expect(html).not.toContain("charsheet__item-use\"");
	});

	test("TCE/custom same-name consumables keep ordinary inventory behavior only", () => {
		const state = makeState();
		state.addItem({
			name: "Experimental Elixir",
			source: "TCE",
			type: "P",
			quantity: 1,
			entries: ["A compatibility item."],
		});
		const row = state.getItems().at(-1);
		const html = makeInventory(state)._renderItemRow(row).outerHTML;

		expect(html).toContain("charsheet__item-use");
		expect(html).not.toContain("charsheet__efa-elixir-consume");
		expect(html).not.toContain("Repair required");
	});

	test("Self commits atomically and refreshes save/render surfaces", async () => {
		const state = makeState();
		const vial = createVial(state, {effectKey: "resilience"});
		state.startCombat();
		const page = makePage(state);

		const result = await CharacterSheetEfaExperimentalElixirUi.commitConsume({
			state,
			page,
			itemId: vial.id,
			target: "self",
		});

		expect(result).toMatchObject({ok: true, committed: true, target: "self", actionConsumed: true});
		expect(state.getItems().some(row => row.id === vial.id)).toBe(false);
		expect(state.getEfaExperimentalElixirActiveEffects()).toHaveLength(1);
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});

	test("Other returns an exact copyable handoff without mutating local HP or active effects", async () => {
		const state = makeState();
		const vial = createVial(state, {effectKey: "flight"});
		const hpBefore = state.getCurrentHp();
		const page = makePage(state);

		const preview = state.previewEfaExperimentalElixirOtherHandoff({
			itemId: vial.id,
			targetName: "Mira",
			within5Feet: true,
		});
		expect(preview).toMatchObject({ok: true, committed: false, targetName: "Mira"});
		expect(state.getItems().some(row => row.id === vial.id)).toBe(true);

		const result = await CharacterSheetEfaExperimentalElixirUi.commitConsume({
			state,
			page,
			itemId: vial.id,
			target: "other",
			targetName: "Mira",
			within5Feet: true,
		});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			target: "other",
			result: {
				type: "externalHandoff",
				handoff: {
					kind: "efaExperimentalElixirOther",
					target: {name: "Mira", range: {withinRangeConfirmed: true}},
				},
			},
		});
		expect(state.getCurrentHp()).toBe(hpBefore);
		expect(state.getEfaExperimentalElixirActiveEffects()).toEqual([]);
		expect(state.getItems().some(row => row.id === vial.id)).toBe(false);
	});

	test("invalid or unavailable consume leaves action, item, save, and render untouched", async () => {
		const state = makeState();
		const vial = createVial(state);
		state.startCombat();
		state.consumeActionType("bonus");
		const before = state.toJson();
		const page = makePage(state);

		const result = await CharacterSheetEfaExperimentalElixirUi.commitConsume({
			state,
			page,
			itemId: vial.id,
			target: "self",
		});

		expect(result).toMatchObject({ok: false, committed: false, code: "efa-experimental-elixir-bonus-action-unavailable"});
		expect(state.toJson()).toEqual(before);
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
	});

	test("copy helper reports clipboard success and fallback failure accessibly", async () => {
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.defineProperty(globalThis, "navigator", {value: {clipboard: {writeText}}, configurable: true});
		await expect(CharacterSheetEfaExperimentalElixirUi.copyText("handoff")).resolves.toEqual({ok: true, method: "clipboard"});
		expect(writeText).toHaveBeenCalledWith("handoff");

		Object.defineProperty(globalThis, "navigator", {value: {}, configurable: true});
		const textarea = {
			value: "",
			style: {},
			setAttribute: jest.fn(),
			select: jest.fn(),
			remove: jest.fn(),
		};
		const documentBefore = globalThis.document;
		globalThis.document = {
			...documentBefore,
			body: {append: jest.fn()},
			createElement: jest.fn(() => textarea),
			execCommand: jest.fn(() => false),
		};
		await expect(CharacterSheetEfaExperimentalElixirUi.copyText("fallback")).resolves.toEqual({ok: false, method: "fallback"});
		expect(textarea.value).toBe("fallback");
		expect(textarea.select).toHaveBeenCalled();
		globalThis.document = documentBefore;
	});

	test("successful consume focus restoration falls back after the vial action is removed", () => {
		const searchInput = {id: "charsheet-ipt-inventory-search"};
		const documentBefore = globalThis.document;
		globalThis.document = {
			...documentBefore,
			querySelectorAll: jest.fn(() => []),
			querySelector: jest.fn(selector => selector === "#charsheet-ipt-inventory-search" ? searchInput : null),
		};

		expect(CharacterSheetEfaExperimentalElixirUi.getConsumeFocusRestoreTarget("removed-vial")).toBe(searchInput);

		globalThis.document = documentBefore;
	});
});

describe("EFA Experimental Elixir Long Rest UI transaction", () => {
	test("no-supplies section keeps the rest available and stages an empty replacement", () => {
		const state = makeState({level: 3});
		createVial(state);
		const {rest} = makeRest(state);
		const section = rest._createEfaExperimentalElixirLongRestSection();

		expect(section.element.outerHTML).toContain("Production unavailable");
		expect(section.element.outerHTML).toContain("rest can still finish");
		expect(section.element.outerHTML).toContain("expires 1 supported vial");
		expect(section.getPreparedDraft()).toMatchObject({
			ok: true,
			hasRequiredSupplies: false,
			draft: {requestedDecision: "decline", decision: "decline"},
		});
	});

	test("supplies section exposes explicit Produce/Decline controls and the row-6 resolution contract", () => {
		const state = makeState({level: 15});
		addSupplies(state);
		const {rest} = makeRest(state);
		const section = rest._createEfaExperimentalElixirLongRestSection();

		expect(section.element.outerHTML).toContain("Produce 5 vials");
		expect(section.element.outerHTML).toContain("Decline production");
		expect(section.element.outerHTML).toContain("Every rolled 6 requires an explicit effect choice");
		expect(section.element.outerHTML).toContain("aria-live=\"polite\"");
	});

	test("Produce to Decline to Produce preserves the one staged roll batch", () => {
		const state = makeState({level: 5});
		addSupplies(state);
		const randomiseBefore = globalThis.RollerUtil.randomise;
		const randomise = globalThis.RollerUtil.randomise = jest.fn()
			.mockReturnValueOnce(1)
			.mockReturnValueOnce(3)
			.mockReturnValueOnce(5);
		try {
			const {rest} = makeRest(state);
			const section = rest._createEfaExperimentalElixirLongRestSection();

			section.setDecision("produce");
			const firstRolls = section.getRolls();
			section.setDecision("decline");
			section.setDecision("produce");

			expect(section.getRolls()).toEqual(firstRolls);
			expect(randomise).toHaveBeenCalledTimes(3);
		} finally {
			if (randomiseBefore) globalThis.RollerUtil.randomise = randomiseBefore;
			else delete globalThis.RollerUtil.randomise;
		}
	});

	test("canonical recovery runs exactly once and honors the generic exhaustion checkbox option", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		state.setExhaustion(2);
		const prepared = state.prepareEfaExperimentalElixirLongRestDraft({decision: "decline"});
		const {rest, page} = makeRest(state);
		const onLongRest = jest.spyOn(state, "onLongRest");

		const result = rest._commitLongRestTransaction({
			restOptions: {clearTempHp: true, reduceExhaustion: false},
			experimentalElixirDraft: prepared.draft,
		});

		expect(result.ok).toBe(true);
		expect(onLongRest).toHaveBeenCalledTimes(1);
		expect(onLongRest).toHaveBeenCalledWith({clearTempHp: true, reduceExhaustion: false});
		expect(state.getCurrentHp()).toBe(30);
		expect(state.getExhaustion()).toBe(2);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});

	test("canonical feature-use recovery applies a partial short-rest recovery only once", () => {
		const state = makeState({level: 3});
		state._data.features.push({
			id: "partial-short-rest-feature",
			name: "Partial Recovery",
			uses: {current: 0, max: 3, recharge: "long", shortRestRecovery: 1},
		});

		state.onShortRest();

		expect(state._data.features.at(-1).uses.current).toBe(1);
	});

	test("any modal-choice failure rolls back the one full snapshot with no success/undo boundary", () => {
		const state = makeState({level: 3});
		addSupplies(state);
		const oldVial = createVial(state);
		const before = normalizeState(state);
		const prepared = state.prepareEfaExperimentalElixirLongRestDraft({decision: "decline"});
		const {rest, page} = makeRest(state);

		const result = rest._commitLongRestTransaction({
			experimentalElixirDraft: prepared.draft,
			applyModalChoices: () => {
				state.setCurrentHp(1);
				return {ok: false, code: "forced-atlas-failure", errors: ["Atlas failed."]};
			},
		});

		expect(result).toMatchObject({ok: false, committed: false, restCommitted: false, rolledBack: true});
		expect(state.toJson()).toEqual(before);
		expect(state.getItems().some(row => row.id === oldVial.id)).toBe(true);
		expect(page._lastRestSnapshot).toBeNull();
		expect(page.saveCharacter).not.toHaveBeenCalled();
		expect(page.renderCharacter).not.toHaveBeenCalled();
	});
});
