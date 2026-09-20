import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetModal = globalThis.CharacterSheetModal;

const SHEET_HTML = readFileSync(resolve(process.cwd(), "charactersheet.html"), "utf8");

describe("Combat Defense editor", () => {
	let state;
	let combat;
	let modalInner;
	let originalPGetShow;
	let saveCharacter;
	let renderDefenses;
	let renderOverviewDefenses;
	let renderDamageIntakes;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addResistance("fire");
		state.setItemDefenses({
			resist: [{type: "cold", source: "Ring of Cold Resistance"}],
			immune: [],
			vulnerable: [],
			conditionImmune: [],
		});

		saveCharacter = jest.fn();
		renderDefenses = jest.fn();
		renderOverviewDefenses = jest.fn();
		renderDamageIntakes = jest.fn();
		combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {
			getState: () => state,
			saveCharacter,
			_renderDefenses: renderDefenses,
			_renderOverviewDefenses: renderOverviewDefenses,
			_renderDamageIntakes: renderDamageIntakes,
		};
		combat.renderCombatDefenses = jest.fn();

		modalInner = globalThis.e_({outer: `<div class="ve-ui-modal__scroller"></div>`});
		originalPGetShow = CharacterSheetModal.pGetShow;
		CharacterSheetModal.pGetShow = async () => ({eleModalInner: modalInner, doClose: jest.fn()});
	});

	afterEach(() => {
		CharacterSheetModal.pGetShow = originalPGetShow;
	});

	test("the Combat card exposes an accessible edit control", () => {
		expect(SHEET_HTML).toContain(`id="charsheet-combat-edit-defenses"`);
		expect(SHEET_HTML).toMatch(/id="charsheet-combat-edit-defenses"[^>]+aria-label="Edit defenses"/);
	});

	test("shows manual entries as editable and automatic sources as read-only", async () => {
		state.addManualDefense("resistances", "lightning");

		await combat._showDefenseEditorModal();

		const html = modalInner.children[0].innerHTML;
		expect(html).toContain("Manual defenses");
		expect(html).toContain("Automatic defenses");
		expect(html).toContain("Lightning");
		expect(html).toContain("Ring of Cold Resistance");
		expect(html).toContain("Character feature");
		expect(html).toContain(`data-defense-action="remove"`);
		expect(html).not.toMatch(/data-defense-action="remove"[^>]+data-defense-type="cold"/);
		expect(html).not.toMatch(/data-defense-action="remove"[^>]+data-defense-type="fire"/);
	});

	test("adds and removes manual defenses, saves, and refreshes both views immediately", async () => {
		await combat._showDefenseEditorModal();
		const content = modalInner.children[0];
		content.querySelector = selector => selector === `[data-defense-select="immunities"]`
			? {value: "poison"}
			: null;

		const addButton = {
			dataset: {defenseAction: "add", defenseKind: "immunities"},
			closest: selector => selector === "[data-defense-action]" ? addButton : null,
		};
		await content._handlers.click({target: addButton});

		expect(state.getManualDefenses().immunities).toContain("poison");
		expect(state.getImmunities()).toContain("poison");
		expect(saveCharacter).toHaveBeenCalledTimes(1);
		expect(combat.renderCombatDefenses).toHaveBeenCalledTimes(1);
		expect(renderDefenses).toHaveBeenCalledTimes(1);
		expect(renderOverviewDefenses).toHaveBeenCalledTimes(1);
		expect(renderDamageIntakes).toHaveBeenCalledTimes(1);

		const removeButton = {
			dataset: {defenseAction: "remove", defenseKind: "immunities", defenseType: "poison"},
			closest: selector => selector === "[data-defense-action]" ? removeButton : null,
		};
		await content._handlers.click({target: removeButton});

		expect(state.getManualDefenses().immunities).not.toContain("poison");
		expect(state.getImmunities()).not.toContain("poison");
		expect(saveCharacter).toHaveBeenCalledTimes(2);
	});
});
