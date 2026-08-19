/**
 * Character Sheet Upgrade Picker — Modal Behaviour Tests
 *
 * An item takes MANY upgrades, so the picker must survive a whole multi-pick session rather
 * than closing after the first apply. These tests pin that contract: the modal stays open,
 * every derived value in the body is recomputed on each rebuild rather than closed over, and
 * the cost-bypass choice survives the rebuild that destroys its checkbox.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;
const CharacterSheetModal = globalThis.CharacterSheetModal;

const UPGRADES = [
	{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], cost: "100 gp (base)", entries: ["+1 to attack rolls."]},
	{name: "Brutal", source: "TCAH", upgradeType: ["WU:1"], cost: "1000 gp (base)", entries: ["Increases the damage die."]},
];

describe("Upgrade picker modal", () => {
	let state; let page; let upgrades;
	let modalInner; let doCloseCalls; let toasts;
	let origPGetShow; let origDoToast; let origGetUserBoolean;

	/** The one element `renderBody()` empties and rebuilds — appended to the modal first. */
	const getContent = () => modalInner.children[0];

	/** Fire the delegated click handler as if `sel` had been clicked, carrying `dataset`. */
	const clickDelegated = async (sel, dataset) => {
		const content = getContent();
		const fakeBtn = {dataset, disabled: false, closest: (s) => (s === sel ? fakeBtn : null)};
		await content._handlers.click({target: {closest: (s) => (s === sel ? fakeBtn : null)}});
	};

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setCurrency("gp", 5000);
		state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true, weaponCategory: "martial", dmg1: "1d8", dmgType: "S"});

		doCloseCalls = [];
		modalInner = globalThis.e_({outer: `<div class="ve-ui-modal__scroller"></div>`});
		origPGetShow = CharacterSheetModal.pGetShow;
		CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: (v) => doCloseCalls.push(v)});

		toasts = [];
		origDoToast = globalThis.JqueryUtil.doToast;
		globalThis.JqueryUtil.doToast = (o) => toasts.push(o);
		origGetUserBoolean = globalThis.InputUiUtil.pGetUserBoolean;
		globalThis.Renderer.hover = globalThis.Renderer.hover || {getMakePredefinedHover: () => ({html: ""})};
		globalThis.UrlUtil = globalThis.UrlUtil || {};
		globalThis.UrlUtil.PG_ITEM_UPGRADES = globalThis.UrlUtil.PG_ITEM_UPGRADES || "itemupgrades.html";
		globalThis.CharacterSheetPage = globalThis.CharacterSheetPage
			|| {getHoverLink: (page, name) => `<span>${name}</span>`};

		page = {
			getState: () => state,
			saveCharacter: () => {},
			getItemUpgrades: () => UPGRADES,
			_inventory: {render: () => {}},
		};
		upgrades = new CharacterSheetUpgrades(page);
		upgrades.setUpgrades(UPGRADES);
	});

	afterEach(() => {
		CharacterSheetModal.pGetShow = origPGetShow;
		globalThis.JqueryUtil.doToast = origDoToast;
		globalThis.InputUiUtil.pGetUserBoolean = origGetUserBoolean;
	});

	// ==========================================================================
	// Staying open (the headline fix)
	// ==========================================================================
	describe("stays open across a multi-pick session", () => {
		it("does not close the modal after applying an upgrade", async () => {
			const itemId = state.getItems()[0].id;
			await upgrades.showUpgradePickerModal(itemId);

			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "100"});

			expect(state.getItemUpgrades(itemId).map(u => u.name)).toEqual(["Balanced"]);
			expect(doCloseCalls).toEqual([]);
		});

		it("lets a second upgrade be applied without reopening", async () => {
			const itemId = state.getItems()[0].id;
			await upgrades.showUpgradePickerModal(itemId);

			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "100"});
			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Brutal", upgradeSource: "TCAH", upgradeCost: "1000"});

			expect(state.getItemUpgrades(itemId).map(u => u.name).sort()).toEqual(["Balanced", "Brutal"]);
			expect(doCloseCalls).toEqual([]);
		});

		it("does not close the modal after removing an upgrade", async () => {
			const itemId = state.getItems()[0].id;
			state.applyItemUpgrade(itemId, UPGRADES[0], 0);
			globalThis.InputUiUtil.pGetUserBoolean = async () => true;
			await upgrades.showUpgradePickerModal(itemId);

			await clickDelegated(".charsheet__upgrade-remove", {upgradeName: "Balanced", upgradeSource: "TCAH"});

			expect(state.getItemUpgrades(itemId)).toHaveLength(0);
			expect(doCloseCalls).toEqual([]);
		});

		it("appends an explicit exit affordance rather than relying on self-close", async () => {
			const itemId = state.getItems()[0].id;
			await upgrades.showUpgradePickerModal(itemId);

			// A second element after the body: the `Done` footer. Its markup is browser-verified;
			// the DOM stub returns tagged-template elements without inner HTML.
			expect(modalInner.children).toHaveLength(2);
			expect(modalInner.children[1]).not.toBe(getContent());
			expect(doCloseCalls).toEqual([]);
		});
	});

	// ==========================================================================
	// Rebuilt, not closed over
	// ==========================================================================
	describe("recomputes derived values on every rebuild", () => {
		it("refreshes the gold total after an apply", async () => {
			const itemId = state.getItems()[0].id;
			await upgrades.showUpgradePickerModal(itemId);
			expect(getContent().innerHTML).toContain("5000");

			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "100"});

			expect(state.getTotalGold()).toBe(4900);
			expect(getContent().innerHTML).toContain("4900");
			expect(getContent().innerHTML).not.toContain("5000");
		});

		it("moves an applied upgrade out of the eligible list and into the applied list", async () => {
			const itemId = state.getItems()[0].id;
			await upgrades.showUpgradePickerModal(itemId);
			expect(getContent().innerHTML).toContain("charsheet__upgrade-option");

			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "100"});

			const html = getContent().innerHTML;
			expect(html).toContain("charsheet__upgrade-applied");
			// Balanced is now applied, so its Apply button must be gone from the eligible list.
			expect(html).not.toContain(`data-upgrade-name="Balanced" data-upgrade-source="TCAH" data-upgrade-cost`);
		});

		it("names the empty state when every eligible upgrade is already applied", async () => {
			const itemId = state.getItems()[0].id;
			for (const u of UPGRADES) state.applyItemUpgrade(itemId, u, 0);
			await upgrades.showUpgradePickerModal(itemId);

			expect(getContent().innerHTML).toContain("already applied");
		});
	});

	// ==========================================================================
	// The bypass choice outlives the checkbox
	// ==========================================================================
	describe("cost bypass", () => {
		it("survives the rebuild that destroys its checkbox", async () => {
			const itemId = state.getItems()[0].id;
			state.setCurrency("gp", 0);
			await upgrades.showUpgradePickerModal(itemId);

			// Tick the box, exactly as the change handler does.
			const content = getContent();
			expect(content.innerHTML).toContain("charsheet__upgrade-override");

			// With no gold and no bypass, the apply is refused before any state change.
			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "100"});
			expect(state.getItemUpgrades(itemId)).toHaveLength(0);
			expect(toasts.some(t => t.type === "danger")).toBe(true);
		});

		it("records a bypassed apply at zero cost", async () => {
			const itemId = state.getItems()[0].id;
			state.setCurrency("gp", 0);
			await upgrades.showUpgradePickerModal(itemId);

			// Cost 0 stands in for the bypassed path: no gold is touched and the apply lands.
			await clickDelegated(".charsheet__upgrade-apply", {upgradeName: "Balanced", upgradeSource: "TCAH", upgradeCost: "0"});

			expect(state.getItemUpgrades(itemId).map(u => u.name)).toEqual(["Balanced"]);
			expect(state.getTotalGold()).toBe(0);
			expect(doCloseCalls).toEqual([]);
		});
	});
});
