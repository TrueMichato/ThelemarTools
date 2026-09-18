import "./setup.js";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetState = globalThis.CharacterSheetState;

const rawSpell = name => ({
	name,
	source: "PHB",
	level: 3,
	school: "V",
	time: [{number: 1, unit: "action"}],
	duration: [{type: "instant"}],
	components: {v: true},
	range: {type: "point", distance: {type: "self"}},
});

const addWizardSpell = (state, spell, {prepared = false} = {}) => {
	const stored = CharacterSheetClassUtils.buildSpellStateObject(spell, {
		sourceFeature: "Wizard Spellbook",
		sourceClass: "Wizard",
		inSpellbook: true,
		prepared,
	});
	state.addSpell(stored);
	return stored;
};

const makeState = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 20});
	return state;
};

const makeSpellsModule = (state, allSpells, castResult = {}) => {
	const page = {
		_currentCharacterId: "character-a",
		_characterLoadGeneration: 1,
		_currentCharacterAccess: "owner",
		_state: state,
		getState: () => state,
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_renderInventory: jest.fn(),
		_renderActiveStates: jest.fn(),
		_renderCompanions: jest.fn(),
		_renderHp: jest.fn(),
		_renderOverviewMetamagic: jest.fn(),
		_renderCurrency: jest.fn(),
		_combat: {
			renderCombatStates: jest.fn(),
			renderCombatEffects: jest.fn(),
			renderCombatMetamagic: jest.fn(),
			renderCombatLunar: jest.fn(),
			renderCombatSpells: jest.fn(),
		},
		saveCharacter: jest.fn(),
		_saveCurrentCharacter: jest.fn(),
		_rollHistory: {addRoll: jest.fn()},
	};
	const module = new CharacterSheetSpells(page);
	module._allSpells = allSpells;
	module._resolveMetamagicChoice = jest.fn().mockResolvedValue(null);
	module._pHandleCastingConstraints = jest.fn().mockResolvedValue(true);
	module._resolveVariantComponentChoice = jest.fn().mockResolvedValue(null);
	module._pConsumeMaterialComponent = jest.fn().mockResolvedValue(undefined);
	module._showCastResult = jest.fn().mockResolvedValue(castResult);
	module.renderSlots = jest.fn();
	module._refreshSorceryPointUI = jest.fn();
	module._updateConcentrationUI = jest.fn();
	return module;
};

describe("Wizard Signature Spells", () => {
	test("stores two distinct spellbook spells and round-trips uses through JSON", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		expect(state.setSignatureSpells([fireball, counterspell])).toBe(true);
		expect(state.useSignatureSpell(fireball)).toBe(true);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSignatureSpells()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fireball", usesCurrent: 0, usesMax: 1, recharge: "short"}),
			expect.objectContaining({name: "Counterspell", usesCurrent: 1, usesMax: 1, recharge: "short"}),
		]));
	});

	test("rejects duplicates and non-Wizard-spellbook entries", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		expect(state.setSignatureSpells([fireball, fireball])).toBe(false);
		expect(state.setSignatureSpells([fireball, {...rawSpell("Spirit Guardians"), sourceClass: "Cleric", inSpellbook: true}])).toBe(false);
	});

	test("signature spells are always prepared and excluded from the prepared count", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		const haste = addWizardSpell(state, rawSpell("Haste"), {prepared: true});
		state.setSignatureSpells([fireball, counterspell]);

		expect(state.getPreparedSpells().map(it => it.name)).toEqual(expect.arrayContaining(["Fireball", "Counterspell", "Haste"]));
		expect(CharacterSheetClassUtils.countPreparedSpells(state.getSpells()).current).toBe(1);
	});

	test("free cast spends its own use, preserves the slot, and blocks at zero", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		state.setSpellSlots(3, 3, 3);
		const spells = makeSpellsModule(state, [fireballData, counterspellData]);

		const fireballId = state.getSpells().find(it => it.name === "Fireball").id;
		await spells._castSpell(fireballId, {withMetamagic: false});
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(0);
		expect(state.getSpellSlotsCurrent(3)).toBe(3);

		state.setSpellSlots(3, 0, 0);
		await spells._castSpell(fireballId, {withMetamagic: false, decision: {slotLevel: 3}});
		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
	});

	test("ordinary higher-level casting still spends a slot, not the free use", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		state.setSpellSlots(4, 2, 2);
		const spells = makeSpellsModule(state, [fireballData, counterspellData]);

		await spells._castSpell(state.getSpells().find(it => it.name === "Fireball").id, {withMetamagic: false, decision: {slotLevel: 4}});

		expect(state.getSpellSlotsCurrent(4)).toBe(1);
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);
		expect(globalThis.__csState).toBe(state);
	});

	test("cancelled free cast refunds the Signature use", async () => {
		const fireballData = rawSpell("Fireball");
		const counterspellData = rawSpell("Counterspell");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		const counterspell = addWizardSpell(state, counterspellData);
		state.setSignatureSpells([fireball, counterspell]);
		const spells = makeSpellsModule(state, [fireballData, counterspellData], {cancelled: true});

		await spells._castSpell(state.getSpells().find(it => it.name === "Fireball").id, {withMetamagic: false});

		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);
	});

	test("scope-cancelled Signature cast restores metamagic, component, and prior concentration atomically", async () => {
		const originalInputUiUtil = globalThis.InputUiUtil;
		globalThis.InputUiUtil = {
			...originalInputUiUtil,
			pGetUserBoolean: jest.fn(async () => true),
		};
		const spellData = {
			...rawSpell("Fireball"),
			duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
		};
		const state = makeState();
		const fireball = addWizardSpell(state, spellData);
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		state.setSignatureSpells([fireball, counterspell]);
		state.setSorceryPoints({current: 3, max: 5});
		state.setConcentration("Haste", 3);
		state._data.inventory = [{
			id: "component-1",
			item: {name: "Focused Ember", source: "Ar8", type: "G"},
			quantity: 1,
			equipped: false,
			attuned: false,
		}];
		const before = state.toJson();
		const spells = makeSpellsModule(state, [spellData, rawSpell("Counterspell")], {characterScopeCancelled: true});
		spells._resolveMetamagicChoice = jest.fn(async () => ({
			cancelled: false,
			metamagic: {key: "quickened", name: "Quickened Spell", cost: 2},
		}));
		spells._resolveVariantComponentChoice = jest.fn(async () => ({
			cancelled: false,
			variantComponent: {itemId: "component-1", effects: []},
		}));

		await spells._castSpell(state.getSpells().find(it => it.name === "Fireball").id, {withMetamagic: true});

		expect(state.toJson()).toEqual(before);
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
		globalThis.InputUiUtil = originalInputUiUtil;
	});

	test("scope cancellation never restores source cast state over a newly loaded character", async () => {
		const fireballData = rawSpell("Fireball");
		const state = makeState();
		const fireball = addWizardSpell(state, fireballData);
		state.setSpellSlots(3, 2, 2);
		const fireballId = state.getSpells().find(it => it.name === "Fireball").id;
		const spells = makeSpellsModule(state, [fireballData]);
		const livePage = spells._page;
		const targetState = new CharacterSheetState();
		targetState.addClass({name: "Rogue", source: "PHB", level: 3});
		const targetJson = targetState.toJson();
		globalThis.__csState = state;
		spells._showCastResult = jest.fn(async () => {
			livePage._currentCharacterId = "character-b";
			livePage._characterLoadGeneration++;
			livePage._state.loadFromJson(targetJson);
			return {characterScopeCancelled: true};
		});

		await spells._castSpell(fireballId, {
			withMetamagic: false,
			decision: {slotLevel: 3},
		});

		expect(spells._showCastResult).toHaveBeenCalledTimes(1);
		expect(livePage._state).toBe(state);
		expect(state.getClasses()).toEqual([
			expect.objectContaining({name: "Rogue", source: "PHB", level: 3}),
		]);
		expect(state.getClasses()).not.toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Wizard"}),
		]));
		expect(globalThis.__csState).toBe(state);
		expect(livePage.saveCharacter).not.toHaveBeenCalled();
	});

	test("staged familiar effects defer both save paths and roll logs until final approval", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		let releaseSave;
		const saveGate = new Promise(resolve => releaseSave = resolve);
		let notifySaveStarted;
		const saveStarted = new Promise(resolve => notifySaveStarted = resolve);
		spells._page.saveCharacter.mockImplementationOnce((...args) => {
			notifySaveStarted(args);
			return saveGate;
		});
		const activity = {type: "spell.cast", detail: {delivery: "familiar"}};
		const roll = {title: "Spell Attack: Shocking Grasp", total: 21};
		const toastEl = {};
		let pApplyDeferredEffect;

		const transaction = spells._pRunCastTransaction({
			fn: async stagedModule => {
				await stagedModule._page._saveCurrentCharacter({activity: null});
				await stagedModule._page.saveCharacter({activity});
				stagedModule._page._rollHistory.addRoll(roll);
				stagedModule._replacePriorApplyToSelfToast(toastEl);
				pApplyDeferredEffect = async () => {
					stagedModule._state.setName("Deferred Effect Applied");
					await stagedModule._page._saveCurrentCharacter({activity: {type: "spell.effect"}});
				};
				return true;
			},
		});
		await saveStarted;

		expect(spells._page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(spells._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(spells._page.saveCharacter).toHaveBeenCalledWith({activity});
		expect(spells._page._rollHistory.addRoll).toHaveBeenCalledTimes(1);
		expect(spells._page._rollHistory.addRoll).toHaveBeenCalledWith(roll);
		expect(spells.renderSlots).toHaveBeenCalledTimes(1);
		expect(spells._activeApplyToSelfToastEl).toBe(toastEl);

		await pApplyDeferredEffect();
		expect(state.getName()).toBe("Deferred Effect Applied");
		expect(spells._page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(spells._page._saveCurrentCharacter).toHaveBeenCalledWith({activity: {type: "spell.effect"}});

		releaseSave(true);
		await expect(transaction).resolves.toBe(true);
	});

	test("scope-lost casts discard deferred saves and local or Hub roll-log work", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);

		await expect(spells._pRunCastTransaction({
			fn: async stagedModule => {
				await stagedModule._page._saveCurrentCharacter({activity: null});
				await stagedModule._page.saveCharacter({activity: {type: "spell.cast"}});
				stagedModule._page._rollHistory.addRoll({title: "Spell Damage: Fireball", total: 28});
				stagedModule.renderSlots();
				stagedModule._refreshSorceryPointUI();
				stagedModule._updateConcentrationUI();
				stagedModule._page._combat.renderCombatSpells();
				stagedModule._page._combat.renderCombatStates();
				spells._page._characterLoadGeneration++;
				return true;
			},
		})).resolves.toBe(false);

		expect(spells._page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
		expect(spells._page._rollHistory.addRoll).not.toHaveBeenCalled();
		expect(spells.renderSlots).not.toHaveBeenCalled();
		expect(spells._refreshSorceryPointUI).not.toHaveBeenCalled();
		expect(spells._updateConcentrationUI).not.toHaveBeenCalled();
		expect(spells._page._combat.renderCombatSpells).not.toHaveBeenCalled();
		expect(spells._page._combat.renderCombatStates).not.toHaveBeenCalled();
	});

	test("same-character authoritative adoption cancels a stale staged cast", async () => {
		const state = makeState();
		state.setName("Before Cast");
		const spells = makeSpellsModule(state, []);
		let releaseChoice;
		const choiceGate = new Promise(resolve => releaseChoice = resolve);

		const transaction = spells._pRunCastTransaction({
			fn: async stagedModule => {
				stagedModule._state.setName("Staged Cast");
				await stagedModule._page.saveCharacter({activity: {type: "spell.cast"}});
				await choiceGate;
				return true;
			},
		});
		await Promise.resolve();

		state.setName("Authoritative Realtime Effect");
		spells._page._characterDocumentGeneration = 1;
		releaseChoice();

		await expect(transaction).resolves.toBe(false);
		expect(state.getName()).toBe("Authoritative Realtime Effect");
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
		expect(spells.renderSlots).not.toHaveBeenCalled();
	});

	test("a second cast cannot stage against the same live character transaction", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		let releaseFirst;
		const firstGate = new Promise(resolve => releaseFirst = resolve);
		const firstFn = jest.fn(async stagedModule => {
			stagedModule._state.setName("First Cast");
			await firstGate;
			return true;
		});
		const secondFn = jest.fn(async stagedModule => {
			stagedModule._state.setName("Second Cast");
			return true;
		});

		const first = spells._pRunCastTransaction({fn: firstFn});
		await Promise.resolve();
		await expect(spells._pRunCastTransaction({fn: secondFn})).resolves.toBe(false);
		expect(secondFn).not.toHaveBeenCalled();

		releaseFirst();
		await expect(first).resolves.toBe(true);
		expect(state.getName()).toBe("First Cast");
	});

	test("private-only staged saves are subsumed by the item caller's final save", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);

		await expect(spells._pRunCastTransaction({
			fn: async stagedModule => {
				await stagedModule._page._saveCurrentCharacter({activity: {type: "spell.trigger"}});
				return true;
			},
		})).resolves.toBe(true);

		expect(spells._page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a pending cast never redirects the live spell module away from a newly loaded character", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		const livePage = spells._page;
		const targetState = new CharacterSheetState();
		targetState.addClass({name: "Rogue", source: "PHB", level: 3});
		const targetJson = targetState.toJson();
		globalThis.__csState = state;
		let release;
		const gate = new Promise(resolve => release = resolve);

		const transaction = spells._pRunCastTransaction({
			fn: async stagedModule => {
				expect(stagedModule).not.toBe(spells);
				await gate;
				return true;
			},
		});
		await Promise.resolve();

		expect(spells._state).toBe(state);
		expect(spells._page).toBe(livePage);
		livePage._currentCharacterId = "character-b";
		livePage._characterLoadGeneration++;
		state.loadFromJson(targetJson);
		spells.renderSlots();
		expect(spells.renderSlots).toHaveBeenCalledTimes(1);
		expect(spells._state.getClasses()).toEqual([
			expect.objectContaining({name: "Rogue", source: "PHB", level: 3}),
		]);

		release();
		await expect(transaction).resolves.toBe(false);
		expect(spells._state).toBe(state);
		expect(spells._page).toBe(livePage);
		expect(state.getClasses()).toEqual([
			expect.objectContaining({name: "Rogue", source: "PHB", level: 3}),
		]);
		expect(globalThis.__csState).toBe(state);
	});

	test("successful weapon-channel casts commit attack context and rider on the live combat module", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		const combat = spells._page._combat;
		combat._pendingSpellRider = null;
		combat._lastAttackContext = null;
		combat._turnActionUsage = {action: false};
		const diceResultEl = {};
		let cleanupDiceResult;
		spells._page.pAnimateD20 = jest.fn();
		spells._page.showDiceResult = jest.fn(function () {
			this._lastDiceResultEl = diceResultEl;
			cleanupDiceResult = () => {
				if (this._lastDiceResultEl === diceResultEl) this._lastDiceResultEl = null;
			};
			return diceResultEl;
		});
		spells._page._offerGuidedStrikePostAttack = jest.fn();
		combat.pPrepareChannelSpellFromCast = jest.fn(async choice => ({attackId: "attack-1", choice, event: {}}));
		let commitPage;
		let pApplyDeferredCombatEffect;
		combat.commitPreparedChannelSpellFromCast = jest.fn(prepared => {
			commitPage = combat._page;
			commitPage.pAnimateD20({roll: 17});
			const shownResult = commitPage.showDiceResult({total: 24});
			commitPage._offerGuidedStrikePostAttack({resultEl: shownResult, total: 24});
			combat._state.setName("Attack State Applied");
			combat._turnActionUsage.action = true;
			combat._lastAttackContext = {attackId: prepared.attackId, rollId: 1};
			combat._pendingSpellRider = {attackId: prepared.attackId, spellName: prepared.choice.spell.name};
			pApplyDeferredCombatEffect = async () => {
				commitPage._state.setName("Deferred Combat Effect Applied");
				await commitPage._saveCurrentCharacter({activity: {type: "combat.followup"}});
			};
			return true;
		});
		combat.pChannelSpellFromCast = jest.fn(async function (choice) {
			this._turnActionUsage.action = true;
			this._lastAttackContext = {attackId: "staged-attack", rollId: 1};
			this._pendingSpellRider = {attackId: "staged-attack", spellName: choice.spell.name};
			return true;
		});
		const choice = {spell: {name: "Booming Blade"}, spellData: {name: "Booming Blade"}};

		await expect(spells._pRunCastTransaction({
			fn: async stagedModule => {
				if (!await stagedModule._page._combat.pChannelSpellFromCast(choice)) return false;
				await stagedModule._page.saveCharacter({activity: {type: "spell.cast"}});
				return true;
			},
		})).resolves.toBe(true);

		expect(combat.pPrepareChannelSpellFromCast).toHaveBeenCalledWith(choice, undefined);
		expect(combat.commitPreparedChannelSpellFromCast).toHaveBeenCalledTimes(1);
		expect(commitPage).not.toBe(spells._page);
		expect(spells._page.pAnimateD20).toHaveBeenCalledWith({roll: 17});
		expect(spells._page.showDiceResult).toHaveBeenCalledWith({total: 24});
		expect(spells._page._offerGuidedStrikePostAttack).toHaveBeenCalledWith({resultEl: diceResultEl, total: 24});
		expect(spells._page._lastDiceResultEl).toBe(diceResultEl);
		expect(state.getName()).toBe("Attack State Applied");
		expect(combat._turnActionUsage.action).toBe(true);
		expect(combat._lastAttackContext).toEqual({attackId: "attack-1", rollId: 1});
		expect(combat._pendingSpellRider).toEqual({attackId: "attack-1", spellName: "Booming Blade"});

		await pApplyDeferredCombatEffect();
		expect(state.getName()).toBe("Deferred Combat Effect Applied");
		expect(spells._page._saveCurrentCharacter).toHaveBeenCalledWith({activity: {type: "combat.followup"}});
		cleanupDiceResult();
		expect(spells._page._lastDiceResultEl).toBeNull();
	});

	test("scope-cancelled weapon-channel casts leave live combat transients untouched", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		const combat = spells._page._combat;
		combat._pendingSpellRider = null;
		combat._lastAttackContext = null;
		combat._turnActionUsage = {action: false};
		combat.pPrepareChannelSpellFromCast = jest.fn(async choice => ({attackId: "attack-1", choice, event: {}}));
		combat.commitPreparedChannelSpellFromCast = jest.fn(() => true);
		combat.pChannelSpellFromCast = jest.fn(async function (choice) {
			this._turnActionUsage.action = true;
			this._lastAttackContext = {attackId: "staged-attack", rollId: 1};
			this._pendingSpellRider = {attackId: "staged-attack", spellName: choice.spell.name};
			return true;
		});
		const choice = {spell: {name: "Green-Flame Blade"}, spellData: {name: "Green-Flame Blade"}};

		await expect(spells._pRunCastTransaction({
			fn: async stagedModule => {
				if (!await stagedModule._page._combat.pChannelSpellFromCast(choice)) return false;
				spells._page._characterLoadGeneration++;
				return true;
			},
		})).resolves.toBe(false);

		expect(combat.pPrepareChannelSpellFromCast).toHaveBeenCalledWith(choice, undefined);
		expect(combat.commitPreparedChannelSpellFromCast).not.toHaveBeenCalled();
		expect(combat._turnActionUsage).toEqual({action: false});
		expect(combat._lastAttackContext).toBeNull();
		expect(combat._pendingSpellRider).toBeNull();
	});

	test("weapon-channel staging fails closed without invoking the legacy async channel path", async () => {
		const state = makeState();
		const spells = makeSpellsModule(state, []);
		const combat = spells._page._combat;
		delete combat.pPrepareChannelSpellFromCast;
		delete combat.commitPreparedChannelSpellFromCast;
		combat.pChannelSpellFromCast = jest.fn(async () => {
			combat._pendingSpellRider = {attackId: "late-legacy-attack"};
			return true;
		});
		const choice = {spell: {name: "Booming Blade"}, spellData: {name: "Booming Blade"}};

		await expect(spells._pRunCastTransaction({
			fn: stagedModule => stagedModule._page._combat.pChannelSpellFromCast(choice),
		})).resolves.toBe(false);

		expect(combat.pChannelSpellFromCast).not.toHaveBeenCalled();
		expect(combat._pendingSpellRider).toBeUndefined();
	});

	test("scope-cancelled casts restore ordinary slots and no-slot feature resources", async () => {
		const fireballData = rawSpell("Fireball");
		const slotState = makeState();
		const slotSpell = addWizardSpell(slotState, fireballData);
		slotState.setSpellSlots(3, 2, 2);
		const slotBefore = slotState.toJson();
		const slotSpells = makeSpellsModule(slotState, [fireballData], {characterScopeCancelled: true});

		await slotSpells._castSpell(slotSpell.id, {
			withMetamagic: false,
			decision: {slotLevel: 3},
		});

		expect(slotState.toJson()).toEqual(slotBefore);

		const resourceState = makeState();
		const resourceSpell = addWizardSpell(resourceState, fireballData);
		resourceState.addResource({name: "Arcane Charge", current: 1, max: 1, recharge: "long"});
		const resource = resourceState.getResources().find(it => it.name === "Arcane Charge");
		resourceState.getNoSlotCastResourcesForSpell = () => [{
			resourceId: resource.id,
			name: resource.name,
			current: resource.current,
			max: resource.max,
			castLevel: 3,
		}];
		const resourceBefore = resourceState.toJson();
		const resourceSpells = makeSpellsModule(resourceState, [fireballData], {characterScopeCancelled: true});

		await resourceSpells._castSpell(resourceSpell.id, {withMetamagic: false});

		expect(resourceState.toJson()).toEqual(resourceBefore);
	});

	test("both short and long rests restore each spell's free cast", () => {
		const state = makeState();
		const fireball = addWizardSpell(state, rawSpell("Fireball"));
		const counterspell = addWizardSpell(state, rawSpell("Counterspell"));
		state.setSignatureSpells([fireball, counterspell]);

		state.useSignatureSpell(fireball);
		state.onShortRest();
		expect(state.getSignatureSpellCastInfo(fireball).usesCurrent).toBe(1);

		state.useSignatureSpell(fireball);
		state.useSignatureSpell(counterspell);
		state.onLongRest();
		expect(state.getSignatureSpells().map(it => it.usesCurrent)).toEqual([1, 1]);
	});
});
