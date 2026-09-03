/**
 * Campaign-rules teardown must actually remove campaign rules (ADR 0013, `teardown-rules`).
 *
 * The Character Sheet re-applies `setCampaignSettingsOverlay(this._hubContext?.rulesVersion?.rules)`
 * on every character load and on reset. Clearing the overlay alone is therefore NOT a teardown: a
 * retained `_hubContext` silently reinstalls the torn-down campaign rules on the next character
 * load. These tests pin the exclusive teardown owners and that leak specifically.
 */
import "./setup.js";

const CAMPAIGN_RULES = {variantEncumbrance: true, criticalHitTables: true};

let CharacterSheetPage;
let originalCopyFast;

beforeAll(async () => {
	// `charactersheet.js` registers a `load` listener at module scope, and the Jest environment is
	// `node`. Stub just enough of `window` before importing it.
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		removeEventListener: () => {},
		location: {search: "", href: "http://localhost/charactersheet.html"},
	};
	// The shared setup stub round-trips through JSON and so throws on `undefined`, which the real
	// `MiscUtil.copyFast` tolerates. The overlay records `undefined` for absent settings keys.
	originalCopyFast = globalThis.MiscUtil.copyFast;
	globalThis.MiscUtil.copyFast = value => (value === undefined ? undefined : originalCopyFast(value));
	({CharacterSheetPage} = await import("../../../js/charactersheet/charactersheet.js"));
});

afterAll(() => {
	if (originalCopyFast) globalThis.MiscUtil.copyFast = originalCopyFast;
});

/** Build a page without running `pInit`, then attach only the hub state these owners touch. */
function makePage () {
	const page = new CharacterSheetPage({characterRepository: {}});
	page._hubContext = {rulesVersion: {rules: CAMPAIGN_RULES}};
	page._state.setCampaignSettingsOverlay(page._hubContext.rulesVersion.rules);
	return page;
}

describe("Character Sheet hub teardown owners", () => {
	it("applies campaign rules as a settings overlay while the context is active", () => {
		const page = makePage();
		expect(page._state.getSettings().variantEncumbrance).toBe(true);
	});

	it("clears campaign rules and drops the context so a later load cannot reinstall them", () => {
		const page = makePage();

		page._clearHubRules();

		expect(page._hubContext).toBeNull();
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();

		// This is the exact re-application performed by `_pLoadCharacter` / `_createNewCharacter`.
		page._state.clearCampaignSettingsOverlay();
		page._state.setCampaignSettingsOverlay(page._hubContext?.rulesVersion?.rules);
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();
	});

	it("is idempotent", () => {
		const page = makePage();
		page._clearHubRules();
		expect(() => page._clearHubRules()).not.toThrow();
		expect(page._state.getSettings().variantEncumbrance).toBeUndefined();
	});

	it("keeps each teardown owner exclusive so no stage does another stage's work", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		const order = [];
		page._hubRealtime = {detach: () => order.push("realtime")};
		page._hubEffects = {deactivate: () => order.push("effects")};
		page._partyInventory = {detach: () => order.push("partyInventory")};
		page._characterRepository = {clearRealtimeReconciliation: () => order.push("reconciliation")};

		const generationBefore = page._hubRealtimeGeneration;
		page._fenceHubGeneration();
		expect(page._hubRealtimeGeneration).toBe(generationBefore + 1);
		expect(order).toEqual([]);

		page._detachHubRealtimeClient();
		// The realtime owner touches only the realtime client.
		expect(order).toEqual(["realtime"]);

		page._detachHubProjections();
		expect(order).toEqual(["realtime", "partyInventory", "effects", "reconciliation"]);
	});

	it("keeps the composed detach helper covering every non-rules owner exactly once", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		const order = [];
		page._hubRealtime = {detach: () => order.push("realtime")};
		page._hubEffects = {deactivate: () => order.push("effects")};
		page._partyInventory = {detach: () => order.push("partyInventory")};
		page._characterRepository = {clearRealtimeReconciliation: () => order.push("reconciliation")};

		page._detachHubRealtime();

		expect(order).toEqual(["realtime", "partyInventory", "effects", "reconciliation"]);
		for (const stage of ["realtime", "partyInventory", "effects", "reconciliation"]) {
			expect(order.filter(entry => entry === stage)).toHaveLength(1);
		}
	});

	it("leaves teardown owners safe when the hub subsystems were never created", () => {
		const page = new CharacterSheetPage({characterRepository: {}});
		expect(() => {
			page._fenceHubGeneration();
			page._detachHubRealtimeClient();
			page._detachHubProjections();
			page._clearHubRules();
		}).not.toThrow();
	});
});
