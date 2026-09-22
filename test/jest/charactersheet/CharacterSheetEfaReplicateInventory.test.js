import "./setup.js";

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
});
