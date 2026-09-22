import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCompanionRules = globalThis.CharacterSheetCompanionRules;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_SRC = readFileSync(resolve(__dirname, "../../../css/charactersheet.css"), "utf8");
const MOBILE_CSS_SRC = readFileSync(resolve(__dirname, "../../../css/charactersheet-mobile.css"), "utf8");
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(subclass =>
	subclass.name === "Reanimator"
	&& subclass.source === "RHW"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);

const FEATURE_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const EFA_STEEL_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_STEEL_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";

const copy = value => JSON.parse(JSON.stringify(value));

let CharacterSheetPage;
const savedWindow = globalThis.window;

beforeAll(async () => {
	globalThis.window = {
		...(savedWindow || {}),
		addEventListener: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterAll(() => {
	globalThis.window = savedWindow;
});

function subclassSnapshot (source = "RHW") {
	return {
		name: REANIMATOR.name,
		shortName: REANIMATOR.shortName,
		source,
		casterProgression: REANIMATOR.casterProgression,
		spellcastingAbility: REANIMATOR.spellcastingAbility,
		additionalSpells: copy(REANIMATOR.additionalSpells || []),
	};
}

function makeState ({
	level = 3,
	classSource = "EFA",
	subclassSource = "RHW",
	intelligence = 16,
	withSpellSlots = true,
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		spellcastingAbility: "int",
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: level >= 3 ? subclassSnapshot(subclassSource) : null,
	});
	if (withSpellSlots) {
		state.setSpellSlots(1, 4, 4);
		state.setSpellSlots(2, 3, 3);
	} else {
		for (let level = 1; level <= 9; level++) state.setSpellSlots(level, 0, 0);
		state.setPactSlots({current: 0, max: 0, level: 0});
	}
	return state;
}

function addTool (state, {
	id = "reanimator-tool",
	name = "Tinker's Tools",
	source = "XPHB",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({id, name, source, type: `AT|${source}`, quantity: 1, _isCustom: true});
	state.setItemEquipped(id, equipped);
	if (proficient) state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function makePage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page.saveCharacter = jest.fn().mockResolvedValue(undefined);
	page.renderCharacter = jest.fn();
	return page;
}

function getCreationModel (page) {
	return page._getFeatureCompanionCreationModels()
		.find(model => model.ownerUid === FEATURE_UID);
}

function getCreationPayload (page, selectedOptionIds = [], {
	paymentIndex = 0,
	toolIndex = 0,
	appearance = "A stitched brass hound",
} = {}) {
	const model = getCreationModel(page);
	return CharacterSheetPage._buildFeatureCompanionCreationPayload({
		model,
		focusReference: model.boundary.focus.eligibleReferences[toolIndex],
		payment: model.paymentOptions[paymentIndex].payment,
		selectedOptionIds,
		appearance,
	});
}

async function createCompanion (state, selectedOptionIds = []) {
	const page = makePage(state);
	const result = await state.pCreateFeatureCompanion(getCreationPayload(page, selectedOptionIds));
	expect(result).toMatchObject({ok: true, committed: true});
	return state.getCompanion(result.companionId);
}

function makeButtonStub () {
	const attributes = new Map();
	return {
		disabled: false,
		setAttribute: (name, value) => attributes.set(name, value),
		removeAttribute: name => attributes.delete(name),
		getAttribute: name => attributes.get(name),
	};
}

function makeBoundCreationSurfaceStub (ownerUid = FEATURE_UID) {
	const button = makeButtonStub();
	const status = {textContent: ""};
	let clickHandler = null;
	const getAttribute = button.getAttribute;
	button.getAttribute = name => name === "data-feature-companion-create"
		? ownerUid
		: getAttribute(name);
	button.addEventListener = (type, handler) => {
		if (type === "click") clickHandler = handler;
	};
	button.closest = selector => selector === "[data-feature-companion-create-owner]"
		? {querySelector: childSelector => childSelector === "[role=status]" ? status : null}
		: null;
	return {
		button,
		status,
		root: {
			querySelectorAll: selector => selector === "[data-feature-companion-create]" ? [button] : [],
		},
		pClick: async () => clickHandler?.(),
	};
}

function makeFeatureCompanionRecord ({id, ownerUid, descriptor, resolved}) {
	return {
		id,
		type: "class_summon",
		name: descriptor.identity.name,
		source: descriptor.identity.source,
		creatureName: descriptor.identity.name,
		creatureSource: descriptor.identity.source,
		active: true,
		featureGrant: {uid: ownerUid},
		scaling: {featureUid: ownerUid, resolved},
		lifecycle: {status: "active", generation: 1},
		hp: {current: 30, max: 30},
		ac: resolved.statistics?.ac || 15,
		hitDice: {current: 5, max: 5, die: "d8"},
		speed: {walk: 40},
		senses: ["darkvision 60 ft."],
		turnUsage: {action: false, reaction: false},
		setup: {appearance: ""},
	};
}

describe("Reanimator R5a descriptor-driven Manager", () => {
	test("renders exact RHW identity, dense status/provenance, and no Steel Defender copy", async () => {
		const state = makeState({level: 9, intelligence: 18});
		addTool(state);
		const companion = await createCompanion(state, ["arcaneConduit", "bloated"]);
		companion.scaling.resolved.operations.command.status = "executable";
		const page = makePage(state);
		page.getCompanionOperationAvailability = jest.fn().mockReturnValue({
			companionId: companion.id,
			ownerUid: FEATURE_UID,
			status: {actionAvailable: true, reactionAvailable: true},
		});

		const model = page._getFeatureCompanionManagerModel(companion);
		const html = page._getFeatureCompanionManagerHtml(model, 0);

		expect(model).toMatchObject({
			expectedOwnerUid: FEATURE_UID,
			status: {key: "active", label: "Active"},
			source: "RHW",
			stats: {
				ac: 14,
				hitDice: "9/9 d8",
				movement: expect.any(String),
				senses: "Blindsight 60 ft.",
			},
			modifications: ["Arcane Conduit", "Bloated"],
			provenance: {
				tool: "Tinker's Tools (XPHB)",
				payment: "Free creation",
				appearance: "A stitched brass hound",
			},
			readiness: {action: "Available", reaction: "Available"},
			readinessSource: "canonicalOperationStatus",
			isOverviewOnly: true,
		});
		expect(page.getCompanionOperationAvailability)
			.toHaveBeenCalledWith(companion.id, "action", {actionKey: "dodge"});
		expect(html).toContain("Reanimated Companion (RHW)");
		expect(html).not.toContain("Steel Defender operations");
		expect(html).toContain(`role="group" aria-label="Read-only turn availability"`);
	});

	test.each([
		["dead burst-emitted", {active: false, hp: {current: 0}, lifecycle: {status: "dead", deathBurstEmitted: true}}, "dead", "Dead · Death Burst emitted"],
		["expired", {active: false, lifecycle: {status: "expired"}}, "expired", "Expired"],
	])("surfaces %s lifecycle state", async (_label, patch, expectedKey, expectedLabel) => {
		const state = makeState();
		addTool(state);
		const companion = await createCompanion(state);
		Object.assign(companion, patch);
		if (patch.hp) companion.hp = {...companion.hp, ...patch.hp};
		if (patch.lifecycle) companion.lifecycle = {...companion.lifecycle, ...patch.lifecycle};

		const model = makePage(state)._getFeatureCompanionManagerModel(companion);
		expect(model.status).toEqual(expect.objectContaining({key: expectedKey, label: expectedLabel}));
		expect(model.readiness).toEqual({action: "Unavailable", reaction: "Unavailable"});
	});

	test("diagnoses exact source and immutable setup mismatches instead of adopting them", async () => {
		const state = makeState({level: 5});
		addTool(state);
		const companion = await createCompanion(state, ["ferocity"]);
		companion.source = "TST";
		companion.setup.choices.modifications.ownerUid = "Reanimated Companion|Artificer|EFA|Reanimator|TST|3|TST";

		const model = makePage(state)._getFeatureCompanionManagerModel(companion);
		expect(model.status).toMatchObject({key: "invalid", label: "Invalid setup"});
		expect(model.diagnostics).toEqual(expect.arrayContaining([
			expect.stringMatching(/Expected companion source RHW/),
			expect.stringMatching(/different source-qualified owner/),
		]));
		expect(model.isOverviewOnly).toBe(true);
		expect(makePage(state)._getFeatureCompanionManagerHtml(model, 0)).toContain("Source or setup mismatch");
	});

	test("derives executable readiness from canonical receipts instead of legacy turn flags", async () => {
		const state = makeState({withSpellSlots: false});
		addTool(state);
		const companion = await createCompanion(state);
		companion.scaling.resolved.operations.command.status = "executable";
		companion.turnUsage = {action: false, reaction: true};
		state.startCombat();

		const committed = state.commandCompanionAction({
			companionId: companion.id,
			actionKey: "dodge",
		});
		expect(committed).toMatchObject({ok: true, committed: true});
		expect(state.getCompanionOperationAvailability(companion.id, "action", {actionKey: "dodge"}))
			.toMatchObject({
				reason: "companionActionSpent",
				status: {actionAvailable: false, reactionAvailable: true},
			});

		const page = makePage(makeState());
		page._state = state;
		expect(page._getFeatureCompanionManagerModel(companion)).toMatchObject({
			readiness: {action: "Unavailable", reaction: "Available"},
			readinessSource: "canonicalOperationStatus",
		});
		expect(companion.turnUsage).toEqual({action: false, reaction: true});

		state.resetTurnEconomy();
		expect(page._getFeatureCompanionManagerModel(companion)).toMatchObject({
			readiness: {action: "Available", reaction: "Available"},
			readinessSource: "canonicalOperationStatus",
		});
		expect(companion.turnUsage).toEqual({action: false, reaction: true});
	});

	test("keeps deferred R4a readiness on the explicit legacy fallback", async () => {
		const state = makeState({level: 9});
		addTool(state);
		const companion = await createCompanion(state, ["arcaneConduit", "bloated"]);
		companion.turnUsage = {action: true, reaction: false};
		const page = makePage(state);
		page.getCompanionOperationAvailability = jest.fn();

		expect(page._getFeatureCompanionManagerModel(companion)).toMatchObject({
			readiness: {action: "Used", reaction: "Available"},
			readinessSource: "legacyTurnUsage",
			isOverviewOnly: true,
		});
		expect(page.getCompanionOperationAvailability).not.toHaveBeenCalled();
	});

	test("keeps exact EFA/TCE Battle Smith operation cards source-isolated", () => {
		const page = makePage(makeState());
		page.getCompanionOperationAvailability = jest.fn((companionId, _operation, _options) => ({
			companionId,
			ownerUid: companionId === "efa-defender" ? EFA_STEEL_UID : TCE_STEEL_UID,
			status: {actionAvailable: true, reactionAvailable: true},
		}));
		for (const [id, ownerUid, expectedSource] of [
			["efa-defender", EFA_STEEL_UID, "EFA"],
			["tce-defender", TCE_STEEL_UID, "TCE"],
		]) {
			const descriptor = CharacterSheetCompanionRules.getDescriptor(ownerUid);
			const resolved = CharacterSheetCompanionRules.resolve(ownerUid, {
				artificerLevel: 5,
				intelligenceModifier: 4,
				proficiencyBonus: 3,
				spellAttackBonus: 7,
			});
			const companion = makeFeatureCompanionRecord({id, ownerUid, descriptor, resolved});
			const operationUi = page._getFeatureCompanionOperationUiModel(companion, descriptor);
			const model = page._getFeatureCompanionManagerModel(companion);

			expect(operationUi).toEqual({
				heading: "Steel Defender command status",
				summary: "Uncommanded action: Dodge; movement and reaction are autonomous.",
				rendLabel: "Force-Empowered Rend",
				repairLabel: "Repair",
				deflectLabel: "Deflect Attack",
			});
			expect(model).toMatchObject({
				expectedOwnerUid: ownerUid,
				source: expectedSource,
				readinessSource: "canonicalOperationStatus",
				isOverviewOnly: false,
			});
		}
		const sameNameOnly = makeFeatureCompanionRecord({
			id: "name-only",
			ownerUid: EFA_STEEL_UID,
			descriptor: CharacterSheetCompanionRules.getDescriptor(EFA_STEEL_UID),
			resolved: CharacterSheetCompanionRules.resolve(EFA_STEEL_UID, {
				artificerLevel: 5,
				intelligenceModifier: 4,
				proficiencyBonus: 3,
				spellAttackBonus: 7,
			}),
		});
		delete sameNameOnly.featureGrant;
		delete sameNameOnly.scaling.featureUid;
		expect(page._getFeatureCompanionManagerModel(sameNameOnly)).toBeNull();
		expect(CharacterSheetPage.prototype._getFeatureCompanionOperationUiModel.toString())
			.not.toContain("\"Steel Defender");
	});

	test("routes overview-only registry companions away from legacy direct handlers", () => {
		const source = CharacterSheetPage.prototype._renderCompanions.toString();
		const guard = source.indexOf("if (featureCompanionModel?.isOverviewOnly) return;");
		expect(guard).toBeGreaterThan(-1);
		for (const legacyHandler of [
			"this._state.removeCompanion?.(companion.id)",
			"this._state.setCompanionHp?.(companion.id, newHp)",
			"this._useCompanionAction(companion, action)",
		]) expect(source.indexOf(legacyHandler)).toBeGreaterThan(guard);
	});
});

describe("Reanimator R5a creation boundary UI", () => {
	test("isolates the exact EFA/RHW owner and exposes unavailable and pending states", () => {
		const wrongSource = makePage(makeState({classSource: "TCE"}));
		addTool(wrongSource._state);
		expect(wrongSource._getFeatureCompanionCreationModels()).toEqual([]);

		const unavailableState = makeState();
		const unavailablePage = makePage(unavailableState);
		const unavailable = getCreationModel(unavailablePage);
		expect(unavailable).toMatchObject({
			ownerUid: FEATURE_UID,
			canAttempt: false,
			boundary: {reason: "toolUnavailable"},
		});
		expect(unavailablePage._getFeatureCompanionCreationSurfaceHtml(unavailable, 0))
			.toContain("Equip an eligible XPHB Artisan&#39;s Tool");

		const pendingState = makeState({level: 9});
		addTool(pendingState);
		const pendingPage = makePage(pendingState);
		const pending = getCreationModel(pendingPage);
		expect(pending).toMatchObject({
			canAttempt: true,
			boundary: {reason: "missingChoice"},
			setupTransaction: {requiredCount: 2},
		});
		const pendingHtml = pendingPage._getFeatureCompanionCreationSurfaceHtml(pending, 0);
		expect(pendingHtml).toContain("Create Reanimated Companion");
		expect(pendingHtml).toContain(`role="status" aria-live="polite"`);
		expect(pendingHtml).not.toContain("disabled");
	});

	test("builds the exact atomic tool/payment/modification payload from the live transaction", () => {
		const state = makeState({level: 9});
		addTool(state);
		addTool(state, {id: "smith-tools", name: "Smith's Tools"});
		state.setPactSlots({current: 2, max: 2, level: 2});
		const page = makePage(state);
		const model = getCreationModel(page);
		const payment = model.paymentOptions.find(option => option.key === "pact:2").payment;
		const focusReference = model.boundary.focus.eligibleReferences.find(tool => tool.inventoryItemId === "smith-tools");

		const payload = CharacterSheetPage._buildFeatureCompanionCreationPayload({
			model,
			focusReference,
			payment,
			selectedOptionIds: ["arcaneConduit", "bloated"],
			appearance: "  A grave-silver porter  ",
		});

		expect(payload).toEqual({
			featureUid: FEATURE_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			focusReference: expect.objectContaining({
				inventoryItemId: "smith-tools",
				itemUid: "Smith's Tools|XPHB",
			}),
			payment: {type: "spellSlot", pool: "pact", slotLevel: 2},
			setupChoices: {
				transactionId: model.setupTransaction.transactionId,
				selectedOptions: [
					{id: "arcaneConduit", name: "Arcane Conduit", source: "RHW", unlockArtificerLevel: 5},
					{id: "bloated", name: "Bloated", source: "RHW", unlockArtificerLevel: 9},
				],
			},
			appearance: "A grave-silver porter",
		});
	});

	test("blocks creation when the required Magic action is spent and restores it on the next turn", async () => {
		const state = makeState();
		addTool(state);
		state.startCombat();
		expect(state.consumeActionType("action")).toBe(true);

		const page = makePage(state);
		page._pShowFeatureCompanionCreationModal = jest.fn();
		const pCreate = jest.spyOn(state, "pCreateFeatureCompanion");
		const before = JSON.stringify(state.toJson());
		const model = getCreationModel(page);

		expect(model).toMatchObject({
			actionAvailable: false,
			canAttempt: false,
			reason: "actionUnavailable",
			boundary: {reason: null},
		});
		const html = page._getFeatureCompanionCreationSurfaceHtml(model, 0);
		expect(html).toContain("Your Magic action is unavailable right now.");
		expect(html).toMatch(/data-feature-companion-create="[^"]+"\s+disabled/);

		const surface = makeBoundCreationSurfaceStub();
		page._bindFeatureCompanionCreationActions(surface.root);
		await surface.pClick();

		expect(page._pShowFeatureCompanionCreationModal).not.toHaveBeenCalled();
		expect(pCreate).not.toHaveBeenCalled();
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(surface.status.textContent).toBe("Your Magic action is unavailable right now.");

		state.resetTurnEconomy();
		expect(getCreationModel(page)).toMatchObject({
			actionAvailable: true,
			canAttempt: true,
			reason: null,
		});
	});

	test("creates directly only when tool, payment, and modification decisions are deterministic", async () => {
		const state = makeState({withSpellSlots: false});
		addTool(state);
		const page = makePage(state);
		page._pShowFeatureCompanionCreationModal = jest.fn();
		const status = {textContent: ""};
		const button = makeButtonStub();

		const result = await page._pCreateFeatureCompanionFromManager(FEATURE_UID, {button, status});

		expect(result).toMatchObject({ok: true, committed: true});
		expect(page._pShowFeatureCompanionCreationModal).not.toHaveBeenCalled();
		expect(state.getFeatureOwnedCompanions(FEATURE_UID)).toHaveLength(1);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(status.textContent).toBe("Reanimated Companion created.");
	});

	test("cancellation and transaction failure preserve state and report through the live status", async () => {
		const cancelledState = makeState({level: 9});
		addTool(cancelledState);
		const cancelledPage = makePage(cancelledState);
		const cancelledBefore = JSON.stringify(cancelledState.toJson());
		cancelledPage._pShowFeatureCompanionCreationModal = jest.fn().mockResolvedValue(null);
		const cancelledStatus = {textContent: ""};
		const cancelled = await cancelledPage._pCreateFeatureCompanionFromManager(
			FEATURE_UID,
			{status: cancelledStatus},
		);
		expect(cancelled).toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(JSON.stringify(cancelledState.toJson())).toBe(cancelledBefore);
		expect(cancelledPage.saveCharacter).not.toHaveBeenCalled();
		expect(cancelledStatus.textContent).toBe("Creation cancelled. No state changed.");

		const failedState = makeState({withSpellSlots: false});
		addTool(failedState);
		const failedPage = makePage(failedState);
		const failedBefore = JSON.stringify(failedState.toJson());
		jest.spyOn(failedState, "pCreateFeatureCompanion").mockResolvedValue({
			ok: false,
			committed: false,
			reason: "coreCommitFailed",
			error: "injected transaction failure",
		});
		const button = makeButtonStub();
		const failedStatus = {textContent: ""};
		const failed = await failedPage._pCreateFeatureCompanionFromManager(
			FEATURE_UID,
			{button, status: failedStatus},
		);
		expect(failed).toMatchObject({ok: false, committed: false, reason: "coreCommitFailed"});
		expect(JSON.stringify(failedState.toJson())).toBe(failedBefore);
		expect(failedPage.saveCharacter).not.toHaveBeenCalled();
		expect(button.disabled).toBe(false);
		expect(button.getAttribute("aria-busy")).toBeUndefined();
		expect(failedStatus.textContent).toBe("Creation failed during the atomic commit. Nothing was spent.");
	});

	test("uses the shared accessible modal focus contract and an atomic final review", () => {
		const source = CharacterSheetPage.prototype._pShowFeatureCompanionCreationModal.toString();
		for (const contract of [
			"focusRestoreTarget",
			"CharacterSheetModal.focusFirst",
			"aria-live=\"polite\"",
			"Final creation review",
			"Immutable modifications",
			"Nothing is spent until Create is confirmed",
			"CharacterSheetPage._isFeatureCompanionCreationActionAvailable",
			"currentBoundary.executable",
		]) expect(source).toContain(contract);
	});

	test("wraps the desktop creation status onto its own row and preserves the mobile column", () => {
		expect(CSS_SRC).toMatch(/\.charsheet__feature-companion-create\s*\{[^}]*flex-wrap:\s*wrap;/s);
		expect(CSS_SRC).toMatch(/\.charsheet__feature-companion-live\s*\{[^}]*flex-basis:\s*100%;/s);
		expect(MOBILE_CSS_SRC).toMatch(
			/\.charsheet__feature-companion-manager-header,\s*\.charsheet__feature-companion-create\s*\{[^}]*flex-direction:\s*column;/s,
		);
	});
});
