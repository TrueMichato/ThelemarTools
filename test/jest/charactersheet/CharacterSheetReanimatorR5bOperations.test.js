import {readFileSync} from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCompanionRules = globalThis.CharacterSheetCompanionRules;
const ARTIFICER_DATA = JSON.parse(readFileSync(
	new URL("../../../data/class/class-artificer.json", import.meta.url),
	"utf8",
));
const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(subclass =>
	subclass.name === "Reanimator"
	&& subclass.source === "RHW"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);

const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const COMPANION_UID = "Reanimated Companion|RHW";
const OWNER_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
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

afterEach(() => {
	jest.restoreAllMocks();
});

function makeState ({level = 9, intelligence = 18} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", intelligence);
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level,
		spellcastingAbility: "int",
		casterProgression: EFA_ARTIFICER.casterProgression,
		preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
		cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
		subclass: {
			name: REANIMATOR.name,
			shortName: REANIMATOR.shortName,
			source: "RHW",
			casterProgression: REANIMATOR.casterProgression,
			spellcastingAbility: REANIMATOR.spellcastingAbility,
			additionalSpells: copy(REANIMATOR.additionalSpells || []),
		},
	});
	state.setSpellSlots(1, 4, 4);
	state.setSpellSlots(2, 3, 3);
	state.addItem({
		id: "reanimator-tool",
		name: "Tinker's Tools",
		source: "XPHB",
		type: "AT|XPHB",
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped("reanimator-tool", true);
	state.addToolProficiency("Tinker's Tools");
	return state;
}

function getSetupChoices (state, selectedOptionIds) {
	const boundary = state.getFeatureCompanionCreationBoundary(OWNER_UID, {
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		payment: {type: "freeCreation"},
	});
	return {
		transactionId: boundary.setupChoices.transaction.transactionId,
		selectedOptions: selectedOptionIds.map(id =>
			copy(boundary.setupChoices.transaction.options.find(option => option.id === id))),
	};
}

async function createCompanion (state, selectedOptionIds = []) {
	const focusRow = state.getInventory().find(row => row.id === "reanimator-tool");
	const result = await state.pCreateFeatureCompanion({
		featureUid: OWNER_UID,
		classUid: CLASS_UID,
		subclassUid: SUBCLASS_UID,
		focusReference: state.getSpellCastFocusReference(focusRow),
		payment: {type: "freeCreation"},
		setupChoices: getSetupChoices(state, selectedOptionIds),
		appearance: "A stitched brass hound",
	});
	expect(result).toMatchObject({ok: true, committed: true});
	return state.getCompanion(result.companionId);
}

function makePage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._spells = null;
	page._playMode = {render: jest.fn(), _refreshOpenDrawer: jest.fn(), _logActivity: jest.fn()};
	page.saveCharacter = jest.fn().mockResolvedValue(undefined);
	page._renderCompanions = jest.fn();
	page._announceCompanionInteraction = jest.fn();
	page._showCompanionOperationResult = jest.fn();
	return page;
}

function deathBurstResolution (level = 9) {
	return {
		targets: [{id: "ogre", name: "Ogre", distanceFeet: 5, dexSaveTotal: 8}],
		rolls: {damageDice: level >= 9 ? [1, 2, 3, 4] : [2, 3]},
	};
}

function spellReceipt ({
	rolls = [{
		rollId: "damage:0",
		kind: "damage",
		damageType: "necrotic",
		total: 7,
		status: "resolved",
	}],
} = {}) {
	return {
		receiptVersion: 1,
		receiptId: "spell-r5b",
		ok: true,
		committed: true,
		castingClassUid: CLASS_UID,
		spellUid: "Blight|XPHB",
		spell: {name: "Blight", source: "XPHB", level: 4, school: "N"},
		castType: "slot",
		cast: {rolls},
	};
}

function makeNode (tag = "div", className = "") {
	return {
		tag,
		className,
		children: [],
		attributes: {},
		style: {},
		textContent: "",
		disabled: false,
		appendChild (child) { this.children.push(child); return child; },
		setAttribute (name, value) { this.attributes[name] = String(value); },
		getAttribute (name) { return this.attributes[name] ?? null; },
		removeAttribute (name) { delete this.attributes[name]; },
		addEventListener (name, handler) { this[`on${name}`] = handler; },
		click () { return this.onclick?.(); },
	};
}

describe("Reanimator R5b shared live-operation surface", () => {
	test("builds one exact RHW operation model with canonical costs and never adopts by name", async () => {
		const state = makeState({level: 15});
		const companion = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		const page = makePage(state);
		const model = page.getFeatureCompanionOperationSurfaceModel(companion);

		expect(model).toMatchObject({
			kind: "rhwReanimator",
			renderInManager: true,
			companionId: companion.id,
			ownerUid: OWNER_UID,
			heading: "Operate Reanimated Companion",
			modeLabel: "RHW · live",
		});
		expect(model.statusText).toContain("Action ready");
		expect(model.statusText).toContain("Companion Reaction ready");
		expect(model.statusText).toContain("Owner Magic Action ready");
		expect(model.statusText).toContain("Owner Bonus Action ready");
		expect(model.statusText).toContain("Owner Reaction ready");
		expect(model.costText).toContain("Bonus Action");
		expect(model.controls.map(control => control.operation)).toEqual([
			"action",
			"dreadfulSwipe",
			"damage",
			"gaunt",
			"moist",
			"arcaneConduit",
			"lifeTransfer",
			"dismiss",
		]);
		expect(page._getFeatureCompanionManagerModel(companion)).toMatchObject({
			isOverviewOnly: true,
			operationUi: {kind: "rhwReanimator"},
		});

		const nameOnly = copy(companion);
		delete nameOnly.featureGrant;
		delete nameOnly.scaling.featureUid;
		expect(page.getFeatureCompanionOperationSurfaceModel(nameOnly)).toBeNull();

		const wrongSource = copy(companion);
		wrongSource.featureGrant.uid = OWNER_UID.replaceAll("RHW", "TCE");
		expect(page.getFeatureCompanionOperationSurfaceModel(wrongSource)).toBeNull();

		const malformedOwned = copy(companion);
		malformedOwned.source = "TCE";
		expect(page.isRhwReanimatorFeatureOwnedCompanion(malformedOwned)).toBe(true);
		expect(page.getFeatureCompanionOperationSurfaceModel(malformedOwned)).toBeNull();
	});

	test("routes every RHW control through one exact State dispatcher and accepted R4b APIs", async () => {
		const state = makeState({level: 15});
		const calls = {
			companion: jest.spyOn(state, "performCompanionOperation").mockReturnValue({ok: true, operation: "action"}),
			damage: jest.spyOn(state, "applyFeatureCompanionDamage").mockReturnValue({ok: true, operation: "damage"}),
			burst: jest.spyOn(state, "resolveFeatureCompanionDeathBurst").mockReturnValue({ok: true, operation: "deathBurst"}),
			gaunt: jest.spyOn(state, "resolveRhwReanimatorGauntTrigger").mockReturnValue({ok: true, operation: "gaunt"}),
			moist: jest.spyOn(state, "resolveRhwReanimatorMoistTrigger").mockReturnValue({ok: true, operation: "moist"}),
			conduit: jest.spyOn(state, "applyRhwArcaneConduitDamageRider").mockReturnValue({ok: true, operation: "arcaneConduit"}),
			transfer: jest.spyOn(state, "performRhwLifeTransfer").mockReturnValue({ok: true, operation: "lifeTransfer"}),
			dismiss: jest.spyOn(state, "pDismissFeatureOwnedCompanion").mockResolvedValue({ok: true, operation: "dismiss"}),
		};

		for (const operation of ["action", "dreadfulSwipe", "damage", "deathBurst", "gaunt", "moist", "arcaneConduit", "lifeTransfer", "dismiss"]) {
			await expect(state.pDispatchFeatureCompanionOperation({
				featureUid: OWNER_UID,
				companionId: "companion-1",
				operation,
				marker: operation,
			})).resolves.toMatchObject({ok: true});
		}
		expect(calls.companion).toHaveBeenNthCalledWith(1, expect.objectContaining({operation: "action", marker: "action"}));
		expect(calls.companion).toHaveBeenNthCalledWith(2, expect.objectContaining({operation: "dreadfulSwipe", marker: "dreadfulSwipe"}));
		expect(calls.damage).toHaveBeenCalledWith(expect.objectContaining({featureUid: OWNER_UID, marker: "damage"}));
		expect(calls.burst).toHaveBeenCalledWith(expect.objectContaining({featureUid: OWNER_UID, marker: "deathBurst"}));
		expect(calls.gaunt).toHaveBeenCalledWith(expect.objectContaining({marker: "gaunt"}));
		expect(calls.moist).toHaveBeenCalledWith(expect.objectContaining({marker: "moist"}));
		expect(calls.conduit).toHaveBeenCalledWith(expect.objectContaining({marker: "arcaneConduit"}));
		expect(calls.transfer).toHaveBeenCalledWith(expect.objectContaining({
			featureUid: CharacterSheetState.RHW_REANIMATOR_FEATURE_UIDS.REFINED_REANIMATION,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			marker: "lifeTransfer",
		}));
		expect(calls.dismiss).toHaveBeenCalledWith(expect.objectContaining({featureUid: OWNER_UID, marker: "dismiss"}));
		await expect(state.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID.replaceAll("RHW", "TCE"),
			companionId: "companion-1",
			operation: "damage",
		})).resolves.toMatchObject({ok: false, reason: "invalidFeature"});
	});

	test("binds Manager and Play Mode buttons to identical Page dispatch requests", async () => {
		const state = makeState();
		const page = makePage(state);
		page.pUseFeatureCompanionOperation = jest.fn().mockResolvedValue({ok: true});
		const managerButton = makeNode("button");
		managerButton.attributes = {
			"data-feature-companion-operation": "damage",
			"data-feature-companion-id": "companion-1",
			"data-feature-companion-owner": OWNER_UID,
			"data-companion-operation-key": "companion-1::damage::",
		};
		const managerStatus = {textContent: "", isConnected: true};
		managerButton.closest = () => ({querySelector: () => managerStatus});
		managerButton.isConnected = true;
		page._bindFeatureCompanionOperationActions({
			querySelectorAll: () => [managerButton],
		});
		await managerButton.click();

		const pm = new CharacterSheetPlayMode(page);
		pm._ce = (tag, className, parent) => {
			const node = makeNode(tag, className);
			parent?.appendChild(node);
			return node;
		};
		const card = makeNode();
		pm._renderRhwReanimatorOperations(card, {
			kind: "rhwReanimator",
			companionId: "companion-1",
			ownerUid: OWNER_UID,
			heading: "Operate Reanimated Companion",
			summary: "Default Dodge.",
			statusText: "Action ready.",
			costText: "Bonus Action available.",
			rangeText: "Confirm range.",
			controls: [{
				operation: "damage",
				label: "Damage / Lightning",
				available: true,
				reason: null,
				description: "Apply typed damage.",
			}],
		});
		const playButton = card.children[1].children
			.find(child => child.className?.includes("pm-companion-operations__controls"))
			.children[0];
		await playButton.click();

		expect(page.pUseFeatureCompanionOperation).toHaveBeenNthCalledWith(1, {
			featureUid: OWNER_UID,
			companionId: "companion-1",
			operation: "damage",
			focusKey: "companion-1::damage::",
		});
		expect(page.pUseFeatureCompanionOperation).toHaveBeenNthCalledWith(2, {
			featureUid: OWNER_UID,
			companionId: "companion-1",
			operation: "damage",
			focusKey: "companion-1::damage::",
		});
	});

	test("commands Dreadful Swipe through the shared Page/State seam and resets only at the turn boundary", async () => {
		const state = makeState({level: 5});
		const companion = await createCompanion(state, ["ferocity"]);
		state.startCombat();
		state.setViewMode("play");
		const page = makePage(state);
		jest.spyOn(globalThis.InputUiUtil, "pGetUserString").mockResolvedValue("Ogre");
		jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		jest.spyOn(globalThis.InputUiUtil, "pGetUserEnum").mockResolvedValue("hit");
		page.rollDice = jest.fn()
			.mockReturnValueOnce(12)
			.mockReturnValueOnce(6);

		const result = await page.pUseFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: companion.id,
			operation: "dreadfulSwipe",
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			operation: "dreadfulSwipe",
			costs: {ownerAction: "bonus", companionAction: true},
			rolls: {
				attack: {d20: 12},
				damage: {dieRolls: [6], type: "necrotic"},
			},
		});
		expect(state.getCompanionOperationAvailability(companion.id, "action", {actionKey: "dodge"}))
			.toMatchObject({available: false, reason: "companionActionSpent"});
		expect(state.isActionTypeAvailable("bonus", {trackOnlyInCombat: true})).toBe(false);
		expect(page._playMode._refreshOpenDrawer).toHaveBeenCalledWith("companions");

		page.resetTurnEconomy();
		expect(state.getCompanionOperationAvailability(companion.id, "dreadfulSwipe"))
			.toMatchObject({available: true});
		expect(state.isActionTypeAvailable("bonus", {trackOnlyInCombat: true})).toBe(true);
		expect(page._playMode._refreshOpenDrawer).toHaveBeenLastCalledWith("companions");
	});

	test("keeps cancellation and a late Life Transfer failure atomic through the dispatcher", async () => {
		const state = makeState({level: 15});
		const companion = await createCompanion(state, ["arcaneConduit", "gaunt", "moist"]);
		state.startCombat();
		const beforeCancel = JSON.stringify(state.toJson());
		await expect(state.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: companion.id,
			operation: "damage",
			amount: 5,
			damageType: "fire",
			cancelled: true,
		})).resolves.toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(JSON.stringify(state.toJson())).toBe(beforeCancel);

		const beforeFailure = JSON.stringify(state.toJson());
		jest.spyOn(state, "killFeatureOwnedCompanion").mockReturnValue({
			ok: false,
			committed: false,
			reason: "forcedLateFailure",
		});
		await expect(state.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: companion.id,
			operation: "lifeTransfer",
			trigger: {
				confirmed: true,
				eventId: "late-failure",
				target: "summoner",
				damageAmount: 4,
			},
			deathBurstResolution: deathBurstResolution(15),
		})).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "transactionRolledBack",
			rollback: {summonerHp: true, reaction: true, companion: true},
		});
		expect(JSON.stringify(state.toJson())).toBe(beforeFailure);
	});

	test("resolves Gaunt, Moist, Lightning Absorption, damage death, and pending Death Burst canonically", async () => {
		const triggerState = makeState({level: 9});
		const triggerCompanion = await createCompanion(triggerState, ["gaunt", "moist"]);
		await expect(triggerState.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: triggerCompanion.id,
			operation: "gaunt",
			target: {id: "guard", name: "Guard", chosen: true, startedTurn: true, isCreature: true},
			rangeFeet: 5,
			wisdomSaveTotal: 4,
		})).resolves.toMatchObject({
			ok: true,
			committed: false,
			condition: {condition: "frightened", manualResolution: true},
		});
		await expect(triggerState.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: triggerCompanion.id,
			operation: "moist",
			attacker: {id: "guard", name: "Guard", isCreature: true},
			attackHit: true,
			rangeFeet: 5,
		})).resolves.toMatchObject({
			ok: true,
			committed: false,
			damage: {type: "acid", manualApplication: true},
			costs: {companionReaction: false, turnReceipt: false},
		});

		triggerCompanion.hp.current = 5;
		await expect(triggerState.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: triggerCompanion.id,
			operation: "damage",
			amount: 3,
			damageType: "lightning",
		})).resolves.toMatchObject({
			ok: true,
			committed: true,
			actualDamage: 0,
			absorptionApplied: true,
			healing: {requested: 3},
		});

		const deathState = makeState({level: 9});
		const deathCompanion = await createCompanion(deathState, ["bloated", "ferocity"]);
		await expect(deathState.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: deathCompanion.id,
			operation: "damage",
			amount: deathCompanion.hp.current,
			damageType: "fire",
			deathBurstResolution: deathBurstResolution(9),
		})).resolves.toMatchObject({
			ok: true,
			committed: true,
			death: {
				deathBurstResult: {operation: "deathBurst"},
			},
		});

		const pendingState = makeState({level: 9});
		const pendingCompanion = await createCompanion(pendingState, ["bloated", "ferocity"]);
		expect(pendingState.killFeatureOwnedCompanion(pendingCompanion.id, {
			featureUid: OWNER_UID,
			cause: "manual-test",
		})).toMatchObject({ok: true, committed: true});
		await expect(pendingState.pDispatchFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: pendingCompanion.id,
			operation: "deathBurst",
			...deathBurstResolution(9),
		})).resolves.toMatchObject({
			ok: true,
			committed: true,
			result: {operation: "deathBurst"},
		});
	});

	test("casts Arcane Conduit through the normal spell seam and preserves its generation receipt across save/load", async () => {
		const state = makeState({level: 9});
		const companion = await createCompanion(state, ["arcaneConduit", "ferocity"]);
		const page = makePage(state);
		page._getRhwArcaneConduitCastableSpells = jest.fn(() => [{
			id: "blight-known",
			name: "Blight",
			source: "XPHB",
			level: 4,
		}]);
		const enums = ["companion", "blight-known"];
		jest.spyOn(globalThis.InputUiUtil, "pGetUserEnum").mockImplementation(async () => enums.shift());
		jest.spyOn(globalThis.InputUiUtil, "pGetUserNumber").mockResolvedValue(30);
		let hook;
		let registeredHookId;
		jest.spyOn(state, "registerCommittedSpellCastHook").mockImplementation((classUid, fn, {hookId}) => {
			expect(classUid).toBe(CLASS_UID);
			hook = fn;
			registeredHookId = hookId;
			return jest.fn();
		});
		page._spells = {
			_castSpell: jest.fn(async spellId => {
				expect(spellId).toBe("blight-known");
				const receipt = spellReceipt();
				const value = await hook(receipt);
				return {...receipt, followUps: [{hookId: registeredHookId, ok: value.ok !== false, value}]};
			}),
		};

		const result = await page.pUseFeatureCompanionOperation({
			featureUid: OWNER_UID,
			companionId: companion.id,
			operation: "arcaneConduit",
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			operation: "arcaneConduitDamageRider",
			originId: "companion",
			application: {before: 7, bonus: 4, after: 11},
		});
		const receiptKey = companion.scaling.resolved.modifications.effects.arcaneConduit.damageRider.turnReceipt.key;
		expect(state.queryTurnReceipt(receiptKey)).toMatchObject({used: true});
		expect(page.saveCharacter).toHaveBeenCalled();

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		const loadedCompanion = loaded.getCompanion(companion.id);
		const loadedPage = makePage(loaded);
		loadedPage._getRhwArcaneConduitCastableSpells = jest.fn(() => [{id: "blight-known"}]);
		expect(loadedPage.getFeatureCompanionOperationSurfaceModel(loadedCompanion).controls
			.find(control => control.operation === "arcaneConduit"))
			.toMatchObject({available: false, reason: expect.stringMatching(/already modified/i)});
		loaded.resetTurnEconomy();
		expect(loadedPage.getFeatureCompanionOperationSurfaceModel(loadedCompanion).controls
			.find(control => control.operation === "arcaneConduit"))
			.toMatchObject({available: true});
	});

	test("gates dead, inactive, expired, and source-invalid records while keeping pending Death Burst reachable", async () => {
		const state = makeState({level: 9});
		const companion = await createCompanion(state, ["bloated", "ferocity"]);
		const page = makePage(state);
		expect(state.killFeatureOwnedCompanion(companion.id, {
			featureUid: OWNER_UID,
			cause: "manual-test",
		})).toMatchObject({ok: true, committed: true});
		const deadModel = page.getFeatureCompanionOperationSurfaceModel(companion);
		expect(deadModel.controls.find(control => control.operation === "deathBurst")).toMatchObject({available: true});
		expect(deadModel.controls
			.filter(control => control.operation !== "deathBurst")
			.every(control => control.available === false)).toBe(true);
		expect(page.getFeatureCompanionLifecycleSurfaceCompanions()).toContain(companion);

		companion.lifecycle.deathBurstResolved = true;
		companion.lifecycle.status = "expired";
		expect(page.getFeatureCompanionLifecycleSurfaceCompanions()).not.toContain(companion);
		expect(page.getFeatureCompanionOperationSurfaceModel(companion).controls
			.every(control => control.available === false)).toBe(true);

		companion.source = "TCE";
		expect(page.getFeatureCompanionOperationSurfaceModel(companion)).toBeNull();
	});

	test("keeps RHW Play Mode structurally separated from legacy HP, damage, dismissal, and turnUsage handlers", () => {
		const source = CharacterSheetPlayMode.prototype._renderCompanionsDrawer.toString();
		expect(source).toContain("this._page.isRhwReanimatorFeatureOwnedCompanion?.(comp) === true");
		expect(source).toContain("if (!isRhwReanimator)");
		expect(source).toContain("this._renderFeatureCompanionOperations(card, comp, featureOperationModel)");
		expect(source).not.toContain("turnUsage");

		const operationSource = CharacterSheetPlayMode.prototype._renderRhwReanimatorOperations.toString();
		expect(operationSource).toContain("this._page.pUseFeatureCompanionOperation");
		for (const forbidden of [
			"removeCompanion",
			"setCompanionHp",
			"damageCompanion",
			"turnUsage",
		]) expect(operationSource).not.toContain(forbidden);
	});

	test("preserves exact EFA and TCE Steel Defender models and rejects them at the RHW dispatcher", async () => {
		const state = makeState();
		const page = makePage(state);
		for (const ownerUid of [EFA_STEEL_UID, TCE_STEEL_UID]) {
			const descriptor = CharacterSheetCompanionRules.getDescriptor(ownerUid);
			const resolved = CharacterSheetCompanionRules.resolve(ownerUid, {
				artificerLevel: 5,
				intelligenceModifier: 4,
				proficiencyBonus: 3,
				spellAttackBonus: 7,
			});
			const companion = {
				id: ownerUid,
				name: descriptor.identity.name,
				source: descriptor.identity.source,
				creatureName: descriptor.identity.name,
				creatureSource: descriptor.identity.source,
				active: true,
				featureGrant: {uid: ownerUid},
				scaling: {featureUid: ownerUid, resolved},
				lifecycle: {status: "active", generation: 1},
			};
			expect(page.getFeatureCompanionOperationSurfaceModel(companion)).toEqual({
				heading: "Steel Defender command status",
				summary: "Uncommanded action: Dodge; movement and reaction are autonomous.",
				rendLabel: "Force-Empowered Rend",
				repairLabel: "Repair",
				deflectLabel: "Deflect Attack",
			});
			await expect(state.pDispatchFeatureCompanionOperation({
				featureUid: ownerUid,
				companionId: companion.id,
				operation: "damage",
			})).resolves.toMatchObject({ok: false, reason: "invalidFeature"});
		}
	});
});
