import "./setup.js";
import {jest} from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

if (!String.prototype.escapeQuotes) {
	String.prototype.escapeQuotes = function () {
		return this.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	};
}
if (!String.prototype.qq) String.prototype.qq = function () { return this.escapeQuotes(); };

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

if (typeof globalThis.CharacterSheetUpgrades === "undefined") {
	globalThis.CharacterSheetUpgrades = {
		isWeapon: () => false,
		isArmor: () => false,
		isShield: () => false,
		getUpgradeEffects: () => ({tags: [], notes: []}),
		getGemstoneSummary: () => "",
	};
}

import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const State = globalThis.CharacterSheetState;
const Inventory = globalThis.CharacterSheetInventory;

function makeInventory (state) {
	const inventory = new Inventory({getState: () => state});
	inventory._page = {
		getState: () => state,
		getItemMaterials: () => state.getItemMaterialCatalog(),
		getMaterialsModule: () => null,
		renderCharacter () {},
		saveCharacter () {},
	};
	return inventory;
}

describe("EFA Replicate Magic Item inventory status", () => {
	test("shows source-plan, temporary, stable-order, and repair status without dropping the row", () => {
		const state = new State();
		const created = state.createGeneratedFeatureItem({
			item: {name: "Bag of Holding", source: "XDMG", type: "W", wondrous: true},
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			metadata: {
				sourceFeatureUid: State.EFA_REPLICATE_MAGIC_ITEM_FEATURE_UID,
				temporary: true,
			},
			catalog: {
				plan: {
					slotId: "efa-replicate-plan-1",
					selection: {
						name: "Bag of Holding",
						displayName: "Bag of Holding",
						source: "XDMG",
						planUid: "Bag of Holding|XDMG",
						itemUid: "Bag of Holding|XDMG",
					},
				},
				resolvedItem: {
					name: "Bag of Holding",
					source: "XDMG",
					itemUid: "Bag of Holding|XDMG",
				},
			},
			creation: {
				order: 7,
				receiptId: "creation-receipt",
				event: "long-rest",
				batchId: "batch",
			},
			lifecycle: {
				version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
				state: "active",
				deathExpiryDaysRemaining: null,
				deathExpiryAssignedReceiptId: null,
				callbacks: {},
				metadata: {},
			},
		});
		const inventory = makeInventory(state);
		const getHtml = () => inventory._renderItemRow(state.getItems().find(item => item.id === created.itemId)).outerHTML;

		expect(getHtml()).toContain("⌛ Temporary");
		expect(getHtml()).toContain("Plan: Bag of Holding");
		expect(getHtml()).toContain("Created #7");
		expect(getHtml()).not.toContain("Repair required");

		state.getInventory().find(row => row.id === created.itemId)
			.item._generatedItemProvenance.lifecycle.state = "unresolved";
		expect(getHtml()).toContain("Repair required");
		expect(state.getInventory().find(row => row.id === created.itemId)).toBeDefined();
	});

	test("keeps legacy managed generated markers out of provenance repair management and rendering", () => {
		const state = new State();
		state.addItem({
			id: "spectral-chains",
			name: "Spectral Chains",
			source: "TGTT",
			type: "M",
			weapon: true,
			_isCustom: true,
			_isGeneratedFeatureItem: true,
			_generatedItemId: "tgtt-chained-fury-spectral-chains",
			_generatedItemProvenance: {
				sourceType: "subclassFeature",
				sourceFeature: "Manifest Chains",
				source: "TGTT",
				className: "Barbarian",
				classSource: "TGTT",
				subclassShortName: "Chained Fury",
				subclassSource: "TGTT",
			},
		}, 1, true);
		const item = state.getItems().find(row => row.id === "spectral-chains");
		const classification = state.classifyGeneratedFeatureItem(item);
		const html = makeInventory(state)._renderItemRow(item).outerHTML;

		expect(classification).toEqual({
			status: "ordinary",
			repairRequired: false,
			reason: "malformed-generated-metadata",
		});
		expect(state.getGeneratedFeatureItemManagementRows()).toEqual([]);
		expect(html).not.toContain("Repair required");
	});

	test("renders an accessible responsive lifecycle-management surface with explicit expiry details", () => {
		const state = new State();
		globalThis.RollerUtil.randomise = () => 2;
		const created = state.createGeneratedFeatureItem({
			item: {name: "Bag of Holding", source: "XDMG", type: "W"},
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			catalog: {
				plan: {selection: {name: "Bag of Holding", source: "XDMG"}},
				resolvedItem: {name: "Bag of Holding", source: "XDMG"},
			},
			creation: {order: 4, receiptId: "created", event: "test", batchId: null},
			lifecycle: {
				version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION,
				state: "active",
				callbacks: {onDeath: "expire-after-1d4-days", onLifecycleDay: "decrement-expiry"},
				metadata: {},
			},
		});
		state.setDeathSaveFailures(3);
		const html = makeInventory(state)._getGeneratedItemManagementHtml();
		const css = fs.readFileSync(path.resolve(process.cwd(), "css/charactersheet.css"), "utf8");

		expect(created.ok).toBe(true);
		expect(html).toContain("aria-label=\"Generated item lifecycle management\"");
		expect(html).toContain("role=\"status\"");
		expect(html).toContain("aria-live=\"polite\"");
		expect(html).toContain("Long rests do not advance lifecycle days");
		expect(html).toContain("Replicate Magic Item");
		expect(html).toContain("Known plan");
		expect(html).toContain("Resolved item");
		expect(html).toContain("Creation order");
		expect(html).toContain("#4");
		expect(html).toContain("Rolled 1d4 = 2; 2 days remaining");
		expect(html).toContain("data-action=\"advance-generated-item-day\"");
		expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.charsheet__generated-item-facts\s*\{[\s\S]*?grid-template-columns: 1fr;/);
		expect(css).toContain(".ve-night-mode .charsheet__generated-item-card");
		delete globalThis.RollerUtil.randomise;
	});

	test("cancels lifecycle-day advancement without mutation and reports confirmed results", async () => {
		const state = new State();
		const inventory = makeInventory(state);
		const advance = jest.spyOn(state, "advanceGeneratedFeatureItemLifecycleDays")
			.mockReturnValue({ok: true, daysAdvanced: 1, updated: [], removed: []});
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		inventory._renderItemList = jest.fn();
		inventory._renderEquippedItems = jest.fn();
		inventory._renderAttunedItems = jest.fn();
		inventory._updateArmorClass = jest.fn();
		inventory._page.saveCharacter = jest.fn();

		expect(await inventory._pAdvanceGeneratedItemLifecycleDaysFromUi(1)).toMatchObject({
			ok: false,
			code: "lifecycle-day-advance-cancelled",
		});
		expect(advance).not.toHaveBeenCalled();

		expect(await inventory._pAdvanceGeneratedItemLifecycleDaysFromUi(1)).toMatchObject({
			ok: true,
			message: expect.stringContaining("1 day advanced"),
		});
		expect(advance).toHaveBeenCalledWith(1);
		expect(inventory._page.saveCharacter).toHaveBeenCalledTimes(1);
	});
});
