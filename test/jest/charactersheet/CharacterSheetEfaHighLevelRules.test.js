import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const FLASH_UID = "Flash of Genius|Artificer|EFA";

let Rest;
let Page;
let createdElements;

beforeAll(async () => {
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	const originalE = globalThis.e_;
	createdElements = [];
	globalThis.e_ = opts => {
		const element = originalE(opts);
		element._attrs = {};
		element.setAttribute = (name, value) => { element._attrs[name] = String(value); };
		if (opts?.click) element._handlers.click = opts.click;
		createdElements.push(element);
		return element;
	};
	Rest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
	await import("../../../js/charactersheet/charactersheet.js");
	Page = globalThis.CharacterSheetPage;
});

beforeEach(() => {
	createdElements.length = 0;
	jest.restoreAllMocks();
});

function makeEfa (level = 20, {intelligence = 18} = {}) {
	const state = new State();
	state.setAbilityBase("int", intelligence);
	state.addClass({name: "Artificer", source: "EFA", level});
	if (level >= 7) {
		state.addFeature({
			name: "Flash of Genius",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			level: 7,
		});
	}
	state.setMaxHp(100);
	state.setCurrentHp(100);
	return state;
}

function getFlash (state) {
	return state.getResources().find(resource => resource.featureUid === FLASH_UID);
}

function makeRest (state) {
	const rest = Object.create(Rest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: jest.fn(),
		renderCharacter: jest.fn(),
		rollDice: jest.fn(() => 1),
		getMaterialsModule: () => null,
	};
	rest._state = state;
	rest._page = page;
	rest._showUndoRestAffordance = jest.fn();
	rest._removeUndoRestAffordance = jest.fn();
	rest._showGamblerPreparedRollModal = jest.fn();
	return {rest, page};
}

function makePage (state) {
	const page = Object.create(Page.prototype);
	page._state = state;
	page._saveCurrentCharacter = jest.fn();
	page._renderHp = jest.fn();
	page._renderConditions = jest.fn();
	page._renderResources = jest.fn();
	page._features = {render: jest.fn()};
	page._rollHistory = {addRoll: jest.fn()};
	return page;
}

function addReplica (
	state,
	{
		name = "Replicated Item",
		rarity = "uncommon",
		owner = State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
		lifecycleState = "active",
		expiryRecords = [],
	} = {},
) {
	const created = state.createGeneratedFeatureItem({
		item: {name, source: "TST", type: "W", rarity},
		owner,
		metadata: {sourceFeatureUid: owner.featureUid, temporary: true},
		creation: {
			order: state.getGeneratedFeatureItemRows(owner).length + 1,
			receiptId: `receipt-${name}`,
			event: "test",
			batchId: null,
		},
		lifecycle: {
			version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
			state: lifecycleState,
			deathExpiryDaysRemaining: null,
			deathExpiryAssignedReceiptId: null,
			expiryRecords,
			callbacks: {
				onLongRest: "retain",
				onDeath: "expire-after-1d4-days",
				onLifecycleDay: "decrement-expiry",
			},
			metadata: {},
		},
	});
	expect(created.ok).toBe(true);
	return created.itemId;
}

function dropToZero (state, damage = 10) {
	state.setMaxHp(100);
	state.setCurrentHp(10);
	state.takeDamage(damage);
	return state.getPendingZeroHpIntervention();
}

function getCheatDeath (state) {
	return state.getPendingZeroHpIntervention()?.interventions
		.find(intervention => intervention.id === "efaArtificerCheatDeath");
}

function getExpiryRecords (state, itemId) {
	return state.getInventory().find(row => row.id === itemId)
		?.item?._generatedItemProvenance?.lifecycle?.expiryRecords || [];
}

describe("EFA high-level source ownership", () => {
	it.each([
		[9, 3],
		[10, 4],
		[14, 5],
		[18, 6],
		[20, 6],
	])("uses the exact EFA attunement cap at level %i", (level, expected) => {
		const state = makeEfa(level);
		expect(state.getMaxAttunement()).toBe(expected);
		expect(state.getFeatureCalculations().magicItemAttunementLimit).toBe(expected);
	});

	it("does not project EFA/TCE high-level mechanics onto an unrelated Artificer source", () => {
		const state = new State();
		state.addClass({name: "Artificer", source: "TST", level: 20});
		const calculations = state.getFeatureCalculations();

		expect(state.getMaxAttunement()).toBe(3);
		expect(calculations.magicItemAttunementLimit).toBeUndefined();
		expect(calculations.hasMagicItemSavant).toBeUndefined();
		expect(calculations.magicItemSavantIgnoreRequirements).toBeUndefined();
		expect(calculations.hasSoulOfArtifice).toBeUndefined();
		expect(calculations.hasEfaSoulOfArtifice).toBeUndefined();
	});

	it("keeps the EFA capstone free of TCE requirement bypass and save bonuses", () => {
		const efa = makeEfa(20);
		const efaCalculations = efa.getFeatureCalculations();
		expect(efaCalculations.magicItemSavantIgnoreRequirements).toBe(false);
		expect(efaCalculations.hasSoulOfArtifice).toBeUndefined();
		expect(efaCalculations.soulOfArtificeSaveBonus).toBeUndefined();

		const tce = new State();
		tce.addClass({name: "Artificer", source: "TCE", level: 20});
		expect(tce.getFeatureCalculations()).toEqual(expect.objectContaining({
			magicItemAttunementLimit: 6,
			magicItemSavantIgnoreRequirements: true,
			hasSoulOfArtifice: true,
			soulOfArtificeSaveBonus: 6,
		}));
	});
});

describe("Magic Item Adept crafting-time contribution", () => {
	const expectedDescriptor = {
		id: "efa-artificer-magic-item-adept-crafting",
		owner: {
			kind: "classFeature",
			name: "Magic Item Adept",
			source: "EFA",
			uid: "Magic Item Adept|Artificer|EFA|10|EFA",
		},
		multiplier: 0.25,
		filter: {
			recipeCategories: ["item", "potion"],
			rarities: ["common", "uncommon"],
		},
	};

	it("publishes the exact descriptor only from Artificer|EFA level 10+", () => {
		expect(makeEfa(9).getFeatureCalculations().craftingTimeModifiers || []).not.toContainEqual(expectedDescriptor);
		expect(makeEfa(10).getFeatureCalculations().craftingTimeModifiers).toContainEqual(expectedDescriptor);

		const other = new State();
		other.addClass({name: "Artificer", source: "TCE", level: 20});
		expect(other.getFeatureCalculations().craftingTimeModifiers || []).not.toContainEqual(expectedDescriptor);
	});

	it("normalizes rarity and applies quantity before the multiplier without rounding fractions", () => {
		const state = makeEfa(10);
		const commonPotion = state.getCraftingTimeCalculation({
			recipe: {name: "Common Potion", recipeCategory: "potion", itemType: "P", rarity: "COMMON"},
		});
		expect(commonPotion).toMatchObject({
			baselineWorkweeks: 0.5,
			effectiveWorkweeks: 0.125,
			multiplier: 0.25,
		});

		const uncommonItem = state.getCraftingTimeCalculation({
			recipe: {name: "Uncommon Item", recipeCategory: "item", itemType: "G", rarity: " Uncommon "},
		});
		expect(uncommonItem).toMatchObject({
			baselineWorkweeks: 2,
			effectiveWorkweeks: 0.5,
			multiplier: 0.25,
		});

		const quantity = state.getCraftingTimeCalculation({
			baseWorkweeks: 0.5,
			quantity: 3,
			recipe: {name: "Common Potion", recipeCategory: "potion", itemType: "P", rarity: "common"},
		});
		expect(quantity.baselineWorkweeks).toBe(1.5);
		expect(quantity.effectiveWorkweeks).toBe(0.375);
	});

	it("ANDs filter keys, ORs values within each key, and leaves unrelated recipes unchanged", () => {
		const state = makeEfa(10);
		for (const [recipeCategory, rarity] of [["item", "common"], ["potion", "uncommon"]]) {
			expect(state.getCraftingTimeCalculation({
				baseWorkweeks: 4,
				recipe: {name: "Match", recipeCategory, itemType: "G", rarity},
			}).effectiveWorkweeks).toBe(1);
		}
		for (const [recipeCategory, rarity] of [["item", "rare"], ["dish", "common"]]) {
			expect(state.getCraftingTimeCalculation({
				baseWorkweeks: 4,
				recipe: {name: "Control", recipeCategory, itemType: "G", rarity},
			}).effectiveWorkweeks).toBe(4);
		}
	});

	it.each([
		[[]],
		[[null]],
		[[""]],
		[["common", {}]],
	])("rejects an invalid rarity filter explicitly: %j", rarities => {
		expect(() => State.getApplicableCraftingTimeModifiers([{
			...expectedDescriptor,
			filter: {...expectedDescriptor.filter, rarities},
		}], {
			recipe: {recipeCategory: "item", rarity: "common"},
		})).toThrow(TypeError);
	});

	it("re-derives the descriptor after save/load and drops it immediately on source loss", () => {
		const original = makeEfa(10);
		const restored = new State();
		restored.loadFromJson(original.toJson());
		expect(restored.getFeatureCalculations().craftingTimeModifiers).toContainEqual(expectedDescriptor);
		expect(restored.toJson()).not.toHaveProperty("craftingTimeModifiers");

		restored.removeClass("Artificer", "EFA");
		expect(restored.getFeatureCalculations().craftingTimeModifiers || []).not.toContainEqual(expectedDescriptor);
	});
});

describe("Advanced Artifice and Magical Guidance short rests", () => {
	it("restores exactly one L14 Flash use through state, capped at maximum", () => {
		const state = makeEfa(14);
		const resource = getFlash(state);
		state.setResourceCurrent(resource.id, 1);
		state.onShortRest();
		expect(getFlash(state).current).toBe(2);

		state.setResourceCurrent(resource.id, resource.max);
		state.onShortRest();
		expect(getFlash(state).current).toBe(resource.max);
	});

	it("uses the L14 fallback at L20 unless an actually attuned valid magic item exists", () => {
		const state = makeEfa(20);
		const resource = getFlash(state);
		state.addItem({name: "Ordinary Spoon", source: "TST", type: "G", rarity: "none"});
		const spoon = state.getInventory().find(row => row.item.name === "Ordinary Spoon");
		state.setItemAttuned(spoon.id, true);
		state.setResourceCurrent(resource.id, 0);
		state.onShortRest();
		expect(getFlash(state).current).toBe(1);

		state.addItem({name: "Proof Ring", source: "TST", type: "RG", rarity: "uncommon", requiresAttunement: true});
		const ring = state.getInventory().find(row => row.item.name === "Proof Ring");
		state.setItemAttuned(ring.id, true);
		state.setResourceCurrent(resource.id, 0);
		state.onShortRest();
		expect(getFlash(state).current).toBe(resource.max);
	});

	it("does not treat mundane or inactive generated rows as valid magic-item attunements", () => {
		const state = makeEfa(20);
		const resource = getFlash(state);
		const mundaneGenerated = addReplica(state, {
			name: "Clockwork Trinket",
			rarity: "none",
			owner: State.EFA_TINKERS_MAGIC_OWNER,
		});
		state.setItemAttuned(mundaneGenerated, true);
		state.setResourceCurrent(resource.id, 0);
		state.onShortRest();
		expect(getFlash(state).current).toBe(1);

		const inactiveReplica = addReplica(state, {
			name: "Inactive Replicate",
			rarity: "uncommon",
			lifecycleState: "unresolved",
		});
		state.setItemAttuned(inactiveReplica, true);
		state.setResourceCurrent(resource.id, 0);
		state.onShortRest();
		expect(getFlash(state).current).toBe(1);
	});

	it("commits the real Short Rest UI exactly once, cancels without mutation, and undo restores spent uses", async () => {
		const state = makeEfa(14);
		state.setCurrentHp(50);
		const resource = getFlash(state);
		state.setResourceCurrent(resource.id, 1);
		const {rest, page} = makeRest(state);
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({
			eleModalInner: globalThis.e_({tag: "div"}),
			doClose,
		});

		await rest._showShortRestDialog();
		createdElements.find(element => element.textContent === "Cancel").click();
		expect(getFlash(state).current).toBe(1);
		expect(page.saveCharacter).not.toHaveBeenCalled();

		createdElements.length = 0;
		await rest._showShortRestDialog();
		createdElements.find(element => element.textContent === "✓ Finish Short Rest").click();
		expect(getFlash(state).current).toBe(2);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		expect(rest._onUndoRest()).toBe(true);
		expect(getFlash(state).current).toBe(1);
	});
});

describe("Soul of Artifice Cheat Death transaction", () => {
	it("offers exact-owner active Uncommon/Rare rows and commits one or many atomically", () => {
		const state = makeEfa(20);
		const uncommon = addReplica(state, {name: "Uncommon", rarity: "Uncommon"});
		const rare = addReplica(state, {name: "Rare", rarity: "RARE"});
		const common = addReplica(state, {name: "Common", rarity: "common"});
		const veryRare = addReplica(state, {name: "Very Rare", rarity: "very rare"});
		dropToZero(state);

		const intervention = getCheatDeath(state);
		expect(intervention).toMatchObject({
			available: true,
			selectionCost: {
				type: "inventoryRows",
				minSelections: 1,
				hpPerSelection: 20,
			},
		});
		expect(intervention.selectionCost.options.map(option => option.itemId)).toEqual([uncommon, rare]);

		const result = state.applyZeroHpIntervention("efaArtificerCheatDeath", {
			selectedItemIds: [uncommon, rare],
		});
		expect(result).toEqual(expect.objectContaining({
			applied: true,
			success: true,
			selectedCount: 2,
			hp: 40,
		}));
		expect(state.getInventory().map(row => row.id)).toEqual(expect.arrayContaining([common, veryRare]));
		expect(state.getInventory().map(row => row.id)).not.toEqual(expect.arrayContaining([uncommon, rare]));
		expect(state.getDeathSaves()).toEqual({successes: 0, failures: 0});
		expect(state.isDead()).toBe(false);
	});

	it("caps restored HP at max HP", () => {
		const state = makeEfa(20);
		state.setMaxHp(30);
		const one = addReplica(state, {name: "One"});
		const two = addReplica(state, {name: "Two", rarity: "rare"});
		state.setCurrentHp(10);
		state.takeDamage(10);

		const result = state.applyZeroHpIntervention("efaArtificerCheatDeath", {selectedItemIds: [one, two]});
		expect(result.hp).toBe(30);
	});

	it("does not offer Cheat Death for non-EFA Artificers or outright death", () => {
		const other = new State();
		other.addClass({name: "Artificer", source: "TCE", level: 20});
		other.setMaxHp(100);
		other.setCurrentHp(10);
		addReplica(other);
		other.takeDamage(10);
		expect(other.getPendingZeroHpIntervention()).toBeNull();

		const massive = makeEfa(20);
		const itemId = addReplica(massive);
		massive.setMaxHp(20);
		massive.setCurrentHp(10);
		massive.takeDamage(30);
		expect(getCheatDeath(massive)).toEqual(expect.objectContaining({
			available: false,
			unavailableReason: expect.stringMatching(/dying outright/i),
		}));
		expect(getExpiryRecords(massive, itemId)).toHaveLength(1);
	});

	it.each([
		["zero selection", state => [], "select"],
		["rarity changed to Common", (state, itemId) => {
			state.getInventory().find(row => row.id === itemId).item.rarity = "common";
			return [itemId];
		}, "eligible"],
		["rarity changed to Very Rare", (state, itemId) => {
			state.getInventory().find(row => row.id === itemId).item.rarity = "very rare";
			return [itemId];
		}, "eligible"],
		["lifecycle became inactive", (state, itemId) => {
			state.getInventory().find(row => row.id === itemId).item._generatedItemProvenance.lifecycle.state = "unresolved";
			return [itemId];
		}, "eligible"],
		["owner became foreign", (state, itemId) => {
			state.getInventory().find(row => row.id === itemId).item._generatedItemProvenance.owner = {
				featureUid: "Replicate Magic Item|Artificer|TCE|2",
				classUid: "Artificer|TCE",
				subclassUid: null,
				featureSource: "TCE",
			};
			return [itemId];
		}, "eligible"],
		["owner became stale", (state, itemId) => {
			state.getInventory().find(row => row.id === itemId).item._generatedItemProvenance.owner.featureSource = "TCE";
			return [itemId];
		}, "eligible"],
	])("rejects %s without changing HP or consuming the row", (_label, select, reason) => {
		const state = makeEfa(20);
		const itemId = addReplica(state);
		dropToZero(state);
		const selectedItemIds = select(state, itemId);

		const result = state.applyZeroHpIntervention("efaArtificerCheatDeath", {selectedItemIds});
		expect(result).toEqual(expect.objectContaining({
			applied: false,
			success: false,
			reason: expect.stringMatching(new RegExp(reason, "i")),
		}));
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getInventory().some(row => row.id === itemId)).toBe(true);
	});

	it("rejects copied generated identity and an already-expired row", () => {
		const copied = makeEfa(20);
		const copiedId = addReplica(copied);
		const duplicate = structuredClone(copied.getInventory().find(row => row.id === copiedId));
		duplicate.id = "copied-wrapper";
		copied._data.inventory.push(duplicate);
		dropToZero(copied);
		expect(getCheatDeath(copied)?.available).toBe(false);

		const expired = makeEfa(20);
		const expiredId = addReplica(expired);
		dropToZero(expired);
		const lifecycle = expired.getInventory().find(row => row.id === expiredId).item._generatedItemProvenance.lifecycle;
		lifecycle.expiryRecords = [{
			version: State.GENERATED_FEATURE_ITEM_EXPIRY_VERSION,
			policyId: "expire-after-1d4-days",
			trigger: "death",
			assignedReceiptId: "expired",
			roll: {formula: "1d4", result: 1},
			assignedMinute: 0,
			expiryMinute: 0,
			minutesRemaining: 0,
			daysRemaining: 0,
		}];
		const result = expired.applyZeroHpIntervention("efaArtificerCheatDeath", {selectedItemIds: [expiredId]});
		expect(result).toEqual(expect.objectContaining({applied: false, success: false}));
		expect(expired.getInventory().some(row => row.id === expiredId)).toBe(true);
	});

	it("rolls every selected removal back if any removal fails", () => {
		const state = makeEfa(20);
		const first = addReplica(state, {name: "First"});
		const second = addReplica(state, {name: "Second", rarity: "rare"});
		dropToZero(state);
		const removeItem = state.removeItem.bind(state);
		jest.spyOn(state, "removeItem").mockImplementation(itemId => {
			if (itemId === second) return;
			return removeItem(itemId);
		});

		const result = state.applyZeroHpIntervention("efaArtificerCheatDeath", {
			selectedItemIds: [first, second],
		});
		expect(result).toEqual(expect.objectContaining({
			applied: false,
			success: false,
			reason: expect.stringMatching(/remove/i),
		}));
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getInventory().map(row => row.id)).toEqual(expect.arrayContaining([first, second]));
	});

	it("defers M3B death expiry while pending, averts it on success, and finalizes it on decline/invalid commit", () => {
		const success = makeEfa(20);
		const selected = addReplica(success, {name: "Selected"});
		const survivor = addReplica(success, {name: "Survivor", rarity: "rare"});
		dropToZero(success);
		success.setDeathSaveFailures(3);
		expect(getExpiryRecords(success, survivor)).toEqual([]);
		success.applyZeroHpIntervention("efaArtificerCheatDeath", {selectedItemIds: [selected]});
		expect(getExpiryRecords(success, survivor)).toEqual([]);

		const declined = makeEfa(20);
		const declinedItem = addReplica(declined);
		dropToZero(declined);
		declined.setDeathSaveFailures(3);
		expect(getExpiryRecords(declined, declinedItem)).toEqual([]);
		declined.clearPendingZeroHpIntervention();
		expect(getExpiryRecords(declined, declinedItem)).toHaveLength(1);

		const invalid = makeEfa(20);
		const invalidItem = addReplica(invalid);
		dropToZero(invalid);
		invalid.setDeathSaveFailures(3);
		invalid.applyZeroHpIntervention("efaArtificerCheatDeath", {selectedItemIds: []});
		expect(getExpiryRecords(invalid, invalidItem)).toHaveLength(1);
	});

	it("keeps pending state ephemeral and removes availability cleanly on EFA source loss", () => {
		const state = makeEfa(20);
		addReplica(state);
		dropToZero(state);
		expect(getCheatDeath(state)?.available).toBe(true);
		const saved = state.toJson();
		expect(saved).not.toHaveProperty("_pendingZeroHpIntervention");

		const restored = new State();
		restored.loadFromJson(saved);
		expect(restored.getPendingZeroHpIntervention()).toBeNull();

		state.removeClass("Artificer", "EFA");
		expect(state.getPendingZeroHpIntervention()).toBeNull();
		expect(state.getFeatureCalculations().hasEfaSoulOfArtifice).toBeUndefined();
	});
});

describe("generic custom-selection damage UI", () => {
	it("uses the generic selection descriptor and commits the chosen rows", async () => {
		const state = makeEfa(20);
		const itemId = addReplica(state);
		dropToZero(state);
		state.setDeathSaveFailures(3);
		const page = makePage(state);
		page._pSelectZeroHpInterventionCost = jest.fn(async selectionCost => [selectionCost.options[0].itemId]);

		await page._pOfferZeroHpIntervention();

		expect(page._pSelectZeroHpInterventionCost).toHaveBeenCalledWith(
			expect.objectContaining({type: "inventoryRows"}),
			expect.objectContaining({name: "Cheat Death"}),
		);
		expect(state.getCurrentHp()).toBe(20);
		expect(state.getInventory().some(row => row.id === itemId)).toBe(false);
	});

	it("treats selection cancellation as a non-consuming decline and finalizes death expiry", async () => {
		const state = makeEfa(20);
		const itemId = addReplica(state);
		dropToZero(state);
		state.setDeathSaveFailures(3);
		const page = makePage(state);
		page._pSelectZeroHpInterventionCost = jest.fn(async () => null);

		await page._pOfferZeroHpIntervention();

		expect(state.getCurrentHp()).toBe(0);
		expect(state.getInventory().some(row => row.id === itemId)).toBe(true);
		expect(getExpiryRecords(state, itemId)).toHaveLength(1);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("renders a labelled keyboard-native multi-select with live eligibility text", async () => {
		const state = makeEfa(20);
		addReplica(state, {name: "Selectable"});
		dropToZero(state);
		const page = makePage(state);
		const descriptor = getCheatDeath(state);
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({
			eleModalInner: globalThis.e_({tag: "div"}),
			doClose,
		});

		const resultPromise = page._pSelectZeroHpInterventionCost(descriptor.selectionCost, descriptor);
		await Promise.resolve();

		const fieldset = createdElements.find(element => element.tag === "fieldset");
		const status = createdElements.find(element => element._attrs?.role === "status");
		const checkbox = createdElements.find(element => element.tag === "input" && element.type === "checkbox");
		const confirm = createdElements.find(element => element.textContent === "Disintegrate Selected Items");
		expect(fieldset).toBeDefined();
		expect(status?._attrs).toMatchObject({role: "status", "aria-live": "polite"});
		expect(status.textContent).toMatch(/select at least 1/i);
		expect(confirm.disabled).toBe(true);

		checkbox.checked = true;
		checkbox._handlers.change();
		expect(confirm.disabled).toBe(false);
		expect(status.textContent).toMatch(/20 hit points/i);
		confirm.click();
		await expect(resultPromise).resolves.toEqual([descriptor.selectionCost.options[0].itemId]);
		expect(doClose).toHaveBeenCalledWith(true);
	});
});
