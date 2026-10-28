import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;

describe("actor-scoped headless spell service", () => {
	let originalDocument;
	let originalStorage;
	const storageKey = Spells._SPELL_VIEW_MODE_STORAGE_KEY;

	beforeEach(() => {
		originalDocument = globalThis.document;
		originalStorage = globalThis.localStorage;
		const storage = new Map();
		globalThis.localStorage = {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, `${value}`),
			removeItem: key => storage.delete(key),
		};
		globalThis.document = {
			addEventListener: jest.fn(),
			getElementById: jest.fn(() => null),
			querySelector: jest.fn(() => null),
			querySelectorAll: jest.fn(() => []),
		};
	});

	afterEach(() => {
		globalThis.document = originalDocument;
		globalThis.localStorage = originalStorage;
		jest.restoreAllMocks();
	});

	function createService (options) {
		const state = new State();
		const hook = jest.spyOn(state, "registerCommittedSpellCastHook");
		const service = new Spells({getState: () => state}, options);
		return {state, service, hook};
	}

	it("keeps gameplay hooks on the supplied actor without installing player listeners", () => {
		const {state, service, hook} = createService({isHeadless: true});
		expect(service._state).toBe(state);
		expect(hook).toHaveBeenCalledWith(
			State.EFA_ARTIFICER_CLASS_UID,
			expect.any(Function),
			{hookId: "efa-alchemical-eruption"},
		);
		expect(document.addEventListener).not.toHaveBeenCalled();
	});

	it("does not render into player surfaces or recalculate pools during refresh", () => {
		const {state, service} = createService({isHeadless: true});
		const calculateSlots = jest.spyOn(state, "calculateSpellSlots");
		service.render();
		service.renderSlots();
		service._renderSpellList();
		service._renderSpellcastingStats();
		service._renderSpellTrackingUI();
		service._renderSpellViewToggle();
		service._renderArcaneRecoveryStatus();
		service._renderMetamagic();
		expect(document.getElementById).not.toHaveBeenCalled();
		expect(document.querySelector).not.toHaveBeenCalled();
		expect(document.querySelectorAll).not.toHaveBeenCalled();
		expect(calculateSlots).not.toHaveBeenCalled();
	});

	it("keeps companion view choices independent of the player's saved preference", () => {
		localStorage.setItem(storageKey, "known");
		const {service} = createService({isHeadless: true});
		expect(service._getSpellViewMode()).toBe("current");
		service._setSpellViewMode("prepared");
		expect(service._getSpellViewMode()).toBe("prepared");
		expect(localStorage.getItem(storageKey)).toBe("known");
		expect(document.getElementById).not.toHaveBeenCalled();
	});

	it("retains normal player listeners and saved preferences by default", () => {
		localStorage.setItem(storageKey, "known");
		const {service} = createService();
		expect(document.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
		expect(service._getSpellViewMode()).toBe("known");
		service._setSpellViewMode("prepared");
		expect(localStorage.getItem(storageKey)).toBe("prepared");
		expect(document.getElementById).toHaveBeenCalledWith("charsheet-spell-lists");
	});
});
