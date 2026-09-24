import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const FIRE_BOLT = {
	name: "Fire Bolt",
	source: "XPHB",
	level: 0,
	sourceClass: "Artificer",
	sourceClassSource: "EFA",
	entries: ["Make a ranged spell attack. On a hit, the target takes {@damage 1d10} fire damage."],
	damageInflict: ["fire"],
};
const MENDING = {
	name: "Mending",
	source: "XPHB",
	level: 0,
	sourceClass: "Artificer",
	sourceClassSource: "EFA",
	entries: ["This spell repairs a single break or tear."],
};

function makeState ({classSource = "EFA", subclassSource = "EFA", level = 5} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: {
			name: "Artillerist",
			shortName: "Artillerist",
			source: subclassSource,
		},
	});
	return state;
}

function addItem (state, {
	id,
	name,
	source = "XPHB",
	type,
	weapon = false,
	weaponCategory = null,
	property = null,
	isMelee = null,
	equipped = true,
	quantity = 1,
} = {}) {
	state.addItem({
		id,
		name,
		source,
		type,
		weapon,
		...(weaponCategory ? {weaponCategory} : {}),
		...(property ? {property} : {}),
		...(isMelee != null ? {isMelee} : {}),
		quantity,
		equipped,
		_isCustom: true,
	});
	state.setItemEquipped(id, equipped);
	return state.getInventory().find(row => row.id === id);
}

function addEligibleFirearm (state, overrides = {}) {
	return addItem(state, {
		id: "arcane-firearm-row",
		name: "Longbow",
		type: "R",
		weapon: true,
		weaponCategory: "martial",
		property: ["A"],
		isMelee: false,
		...overrides,
	});
}

async function publishReceipt (state, {focusRow, spell = FIRE_BOLT, classSource = "EFA"} = {}) {
	return state.pPublishCommittedSpellCast({
		spell: {...spell, sourceClassSource: classSource},
		spellData: spell,
		focusInventoryRow: focusRow,
		focusRequirement: state.getSpellCastFocusRequirement({...spell, sourceClassSource: classSource}),
		cast: {
			type: "cantrip",
			slotLevel: 0,
			focusInventoryItemId: focusRow?.id || null,
		},
	});
}

describe("EFA Arcane Firearm exact-owner existing-item binding", () => {
	it.each([
		["rod", {id: "rod", name: "Rod", type: "RD"}, true],
		["staff", {id: "staff", name: "Staff", type: "ST"}, true],
		["wand", {id: "wand", name: "Wand", type: "WD"}, true],
		["martial ranged weapon", {id: "longbow", name: "Longbow", type: "R", weapon: true, weaponCategory: "martial", property: ["A"], isMelee: false}, true],
		["source-qualified martial ranged weapon", {id: "source-longbow", name: "Longbow", type: "R|XPHB", weapon: true, weaponCategory: "martial", property: ["A"], isMelee: false}, true],
		["simple ranged weapon", {id: "shortbow", name: "Shortbow", type: "R", weapon: true, weaponCategory: "simple", property: ["A"], isMelee: false}, false],
		["martial melee weapon", {id: "greatsword", name: "Greatsword", type: "M", weapon: true, weaponCategory: "martial", isMelee: true}, false],
		["nonweapon", {id: "rope", name: "Rope", type: "G"}, false],
	])("matches the EFA eligibility matrix for %s", (_label, item, expected) => {
		const state = makeState();
		const row = addItem(state, item);
		expect(state.isEfaArcaneFirearmEligibleItem(row.item)).toBe(expected);
		expect(state.getEfaArcaneFirearmEligibleInventoryRows().some(candidate => candidate.id === row.id)).toBe(expected);
	});

	it("isolates exact EFA ownership from TCE and same-name source mismatches", () => {
		const tceState = makeState({classSource: "TCE", subclassSource: "TCE"});
		const mixedState = makeState({classSource: "EFA", subclassSource: "TCE"});
		const tceRow = addEligibleFirearm(tceState);
		const mixedRow = addEligibleFirearm(mixedState);

		expect(tceState.setEfaArcaneFirearmBinding(tceRow.id)).toEqual(expect.objectContaining({ok: false, code: "sourceMismatch"}));
		expect(mixedState.setEfaArcaneFirearmBinding(mixedRow.id)).toEqual(expect.objectContaining({ok: false, code: "sourceMismatch"}));
		expect(tceState.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({available: false, code: "sourceMismatch"}));
	});

	it("uses stable wrapper identity across rename and clears missing or ineligible replacements without falling back by name", () => {
		const state = makeState();
		const row = addEligibleFirearm(state);
		expect(state.setEfaArcaneFirearmBinding(row.id).ok).toBe(true);

		state.replaceItem(row.id, {
			name: "Renamed Longbow",
			source: "HB",
			type: "R",
			weapon: true,
			weaponCategory: "martial",
			property: ["A"],
			isMelee: false,
		});
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			active: true,
			item: expect.objectContaining({id: row.id, name: "Renamed Longbow"}),
		}));

		state.replaceItem(row.id, {name: "Renamed Longbow", source: "HB", type: "G"});
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			active: false,
			code: "ineligibleItem",
			binding: null,
		}));

		const sameName = addEligibleFirearm(state, {id: "different-wrapper", name: "Renamed Longbow"});
		expect(sameName.id).not.toBe(row.id);
		expect(state.getEfaArcaneFirearmStatus().binding).toBeNull();

		expect(state.setEfaArcaneFirearmBinding(sameName.id).ok).toBe(true);
		state.removeItem(sameName.id);
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({code: "missingItem", binding: null}));
	});

	it("round-trips valid bindings while old saves gain no fabricated selection", () => {
		const state = makeState();
		const row = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(row.id);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			active: true,
			binding: expect.objectContaining({inventoryItemId: row.id}),
		}));

		const legacy = state.toJson();
		delete legacy.inventoryItemBindings;
		const legacyLoaded = new CharacterSheetState();
		legacyLoaded.loadFromJson(legacy);
		expect(legacyLoaded.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			code: "unbound",
			binding: null,
		}));
	});

	it("keeps Respec candidate mutations isolated and restores the binding on undo", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const page = {
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
		};
		const engine = new CharacterSheetRespecEngine({page, state});
		const candidate = engine.begin();
		engine.getValidation = () => ({isValid: true, errors: []});
		candidate.removeItem(firearm.id);

		expect(candidate.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({binding: null}));
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			binding: expect.objectContaining({inventoryItemId: firearm.id}),
		}));

		await engine.apply();
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({binding: null}));
		await engine.undo();
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({
			binding: expect.objectContaining({inventoryItemId: firearm.id}),
		}));
	});
});

describe("EFA Arcane Firearm focus authorization", () => {
	it("adds the live equipped binding as an exact candidate and prefers it only for damaging spells", () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		const tools = addItem(state, {id: "tools", name: "Tinker's Tools", source: "XPHB", type: "AT"});
		state.addToolProficiency("Tinker's Tools");
		state.setEfaArcaneFirearmBinding(firearm.id);

		const damageRequirement = state.getSpellCastFocusRequirement(FIRE_BOLT);
		expect(damageRequirement.filter.inventoryItemIds).toEqual([firearm.id]);
		expect(damageRequirement.filter.preferredInventoryItemIds).toEqual([firearm.id]);
		expect(state.getEligibleSpellCastFocusInventoryRows(damageRequirement).map(row => row.id)).toEqual(
			expect.arrayContaining([firearm.id, tools.id]),
		);

		const nondamageRequirement = state.getSpellCastFocusRequirement(MENDING);
		expect(nondamageRequirement.filter.inventoryItemIds).toEqual([firearm.id]);
		expect(nondamageRequirement.filter.preferredInventoryItemIds).toEqual([]);
	});

	it("defaults the cast picker to the firearm while allowing another legal focus", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		const tools = addItem(state, {id: "tools", name: "Tinker's Tools", source: "XPHB", type: "AT"});
		state.addToolProficiency("Tinker's Tools");
		state.setEfaArcaneFirearmBinding(firearm.id);
		const manager = Object.create(CharacterSheetSpells.prototype);
		manager._state = state;
		const pickerSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserEnum")
			.mockImplementation(async opts => {
				expect(opts.default?.id).toBe(firearm.id);
				return opts.values.find(row => row.id === tools.id);
			});

		try {
			const result = await manager._pResolveSpellCastFocus({spell: FIRE_BOLT});
			expect(result).toEqual(expect.objectContaining({
				cancelled: false,
				focusInventoryRow: expect.objectContaining({id: tools.id}),
				focusReference: expect.objectContaining({inventoryItemId: tools.id}),
			}));
		} finally {
			pickerSpy.mockRestore();
		}
	});

	it("excludes unequipped, zero-quantity, missing, waived, non-EFA, and other-focus bindings", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		const tools = addItem(state, {id: "tools", name: "Tinker's Tools", source: "XPHB", type: "AT"});
		state.addToolProficiency("Tinker's Tools");
		state.setEfaArcaneFirearmBinding(firearm.id);

		state.setItemEquipped(firearm.id, false);
		expect(state.getSpellCastFocusRequirement(FIRE_BOLT).filter.inventoryItemIds).toEqual([]);
		state.setItemEquipped(firearm.id, true);
		expect(state.getSpellCastFocusRequirement({...FIRE_BOLT, ignoresMaterialComponents: true})).toBeNull();
		expect(state.getSpellCastFocusRequirement({...FIRE_BOLT, sourceClassSource: "TCE"})).toBeNull();

		const toolReceipt = await publishReceipt(state, {focusRow: tools});
		expect(state.getEfaArcaneFirearmDamageEligibility({receipt: toolReceipt, damageResult: {total: 7}}))
			.toEqual(expect.objectContaining({ok: false, code: "otherFocus"}));

		state.setItemQuantity(firearm.id, 0);
		expect(state.getEfaArcaneFirearmStatus()).toEqual(expect.objectContaining({active: false, binding: null}));
	});
});

describe("EFA Arcane Firearm committed damage and turn receipts", () => {
	it("adds one deterministic d8 once per committed cast, persists exact receipts, and resetTurnEconomy releases them", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const firstReceipt = await publishReceipt(state, {focusRow: firearm});
		const secondReceipt = await publishReceipt(state, {focusRow: firearm});

		const applied = state.commitEfaArcaneFirearmDamage({
			receipt: firstReceipt,
			damageResult: {total: 13, dice: [{count: 2, sides: 6}]},
			firearmRoll: 5,
		});
		expect(applied).toEqual(expect.objectContaining({
			ok: true,
			baseTotal: 13,
			firearmRoll: 5,
			total: 18,
			sourceFeatureUid: "Arcane Firearm|Artificer|EFA|Artillerist|EFA|5|EFA",
		}));
		expect(state.queryEfaArcaneFirearmTurnReceipt({castReceiptId: firstReceipt.receiptId})).toEqual(expect.objectContaining({used: true}));
		expect(state.commitEfaArcaneFirearmDamage({receipt: secondReceipt, damageResult: {total: 4, dice: "1d4"}, firearmRoll: 8}))
			.toEqual(expect.objectContaining({ok: true, total: 12}));
		expect(state.commitEfaArcaneFirearmDamage({receipt: firstReceipt, damageResult: {total: 4, dice: "1d4"}, firearmRoll: 8}))
			.toEqual(expect.objectContaining({ok: false, code: "alreadyAppliedToCast"}));

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.queryEfaArcaneFirearmTurnReceipt({castReceiptId: firstReceipt.receiptId})).toEqual(expect.objectContaining({used: true}));
		expect(loaded.queryEfaArcaneFirearmTurnReceipt({castReceiptId: secondReceipt.receiptId})).toEqual(expect.objectContaining({used: true}));
		loaded.resetTurnEconomy();
		expect(loaded.queryEfaArcaneFirearmTurnReceipt({castReceiptId: firstReceipt.receiptId})).toEqual(expect.objectContaining({used: false}));
		expect(loaded.queryEfaArcaneFirearmTurnReceipt({castReceiptId: secondReceipt.receiptId})).toEqual(expect.objectContaining({used: false}));
	});

	it("rolls back exact receipts and prunes only the Arcane Firearm receipt on item removal", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const receipt = await publishReceipt(state, {focusRow: firearm});
		const applied = state.commitEfaArcaneFirearmDamage({receipt, damageResult: {total: 6, dice: "1d6"}, firearmRoll: 4});
		expect(state.rollbackEfaArcaneFirearmTurnReceipt(applied.turnReceipt)).toEqual(expect.objectContaining({rolledBack: true}));

		const unrelated = state.commitTurnReceipt({
			key: "other",
			ownerUid: "other|owner",
			sourceUid: "other|source",
			actionUid: "other|action",
		});
		expect(unrelated.ok).toBe(true);
		state.commitEfaArcaneFirearmDamage({receipt, damageResult: {total: 6, dice: "1d6"}, firearmRoll: 4});
		state.removeItem(firearm.id);
		expect(state.queryEfaArcaneFirearmTurnReceipt().used).toBe(false);
		expect(state.queryTurnReceipt("other").used).toBe(true);
	});

	it("does not apply to nondamage, uncommitted, non-EFA, or unequipped casts", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const receipt = await publishReceipt(state, {focusRow: firearm});

		expect(state.commitEfaArcaneFirearmDamage({receipt, damageResult: null, firearmRoll: 4}))
			.toEqual(expect.objectContaining({ok: false, code: "noDamageRoll"}));
		expect(state.commitEfaArcaneFirearmDamage({receipt, damageResult: {total: 3, dice: []}, firearmRoll: 4}))
			.toEqual(expect.objectContaining({ok: false, code: "noDamageRoll"}));
		expect(state.commitEfaArcaneFirearmDamage({receipt: null, damageResult: {total: 3, dice: "1d6"}, firearmRoll: 4}))
			.toEqual(expect.objectContaining({ok: false, code: "uncommittedCast"}));

		const tceReceipt = {...receipt, castingClassUid: "Artificer|TCE"};
		expect(state.commitEfaArcaneFirearmDamage({receipt: tceReceipt, damageResult: {total: 3, dice: "1d6"}, firearmRoll: 4}))
			.toEqual(expect.objectContaining({ok: false, code: "wrongClass"}));

		state.setItemEquipped(firearm.id, false);
		expect(state.commitEfaArcaneFirearmDamage({receipt, damageResult: {total: 3, dice: "1d6"}, firearmRoll: 4}))
			.toEqual(expect.objectContaining({ok: false, code: "unequipped"}));
	});
});

describe("EFA Arcane Firearm spell feedback transaction", () => {
	function makeManager (state, {saveResult = true} = {}) {
		const manager = Object.create(CharacterSheetSpells.prototype);
		manager._state = state;
		manager._page = {
			rollDice: jest.fn(() => 6),
			pAnimateDiceSpec: jest.fn(async () => {}),
			_rollHistory: {addRoll: jest.fn()},
			_saveCurrentCharacter: jest.fn(async () => saveResult),
			saveCharacter: jest.fn(),
		};
		return manager;
	}

	it("adds one d8 to the aggregate damage result with visible exact-source feedback", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const receipt = await publishReceipt(state, {focusRow: firearm});
		const manager = makeManager(state);
		const castResult = {damageResult: {total: 21, dice: [{count: 3, sides: 8}, {count: 1, sides: 6}]}};
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast").mockImplementation(() => {});

		const result = await manager._pApplyCommittedEfaArcaneFirearmDamage({receipt, spell: FIRE_BOLT, castResult});

		expect(result).toEqual(expect.objectContaining({ok: true, firearmRoll: 6, baseTotal: 21, total: 27}));
		expect(castResult.damageResult).toEqual(expect.objectContaining({
			total: 27,
			arcaneFirearm: expect.objectContaining({die: "1d8", roll: 6, sourceFeatureUid: "Arcane Firearm|Artificer|EFA|Artillerist|EFA|5|EFA"}),
		}));
		expect(manager._page.pAnimateDiceSpec).toHaveBeenCalledWith({groups: [{sides: 8, values: [6]}]});
		expect(manager._page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({
			total: 27,
			breakdown: expect.stringContaining("Arcane Firearm|EFA"),
		}));
		expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining("1d8 (6)"),
		}));
	});

	it("rolls back the receipt and leaves damage unchanged when persistence fails", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const receipt = await publishReceipt(state, {focusRow: firearm});
		const manager = makeManager(state, {saveResult: false});
		const castResult = {damageResult: {total: 9, dice: [{count: 1, sides: 10}]}};

		expect(await manager._pApplyCommittedEfaArcaneFirearmDamage({receipt, spell: FIRE_BOLT, castResult}))
			.toEqual(expect.objectContaining({ok: false, code: "saveFailed"}));
		expect(castResult.damageResult.total).toBe(9);
		expect(castResult.damageResult.arcaneFirearm).toBeUndefined();
		expect(state.queryEfaArcaneFirearmTurnReceipt().used).toBe(false);
		expect(manager._page._rollHistory.addRoll).not.toHaveBeenCalled();
	});

	it("carries the committed cast and focus into deferred weapon-channel damage", async () => {
		const state = makeState();
		const firearm = addEligibleFirearm(state);
		state.setEfaArcaneFirearmBinding(firearm.id);
		const receipt = await publishReceipt(state, {focusRow: firearm});
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {
			rollDice: jest.fn(() => 7),
			_saveCurrentCharacter: jest.fn(async () => true),
		};
		combat._pendingSpellRider = {
			attackId: "weapon-attack",
			spellName: "Booming Blade",
			dice: "1d8",
			damageType: "thunder",
		};

		expect(combat.attachCommittedSpellCastToPendingChannelRider(receipt)).toBe(true);
		const result = await combat._pApplyEfaArcaneFirearmToChannelRider({
			channelSpell: combat._pendingSpellRider,
			channelSpellDamage: 5,
		});

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			baseTotal: 5,
			firearmRoll: 7,
			total: 12,
		}));
		expect(state.queryEfaArcaneFirearmTurnReceipt({castReceiptId: receipt.receiptId}).used).toBe(true);
		expect(combat._page._saveCurrentCharacter).toHaveBeenCalledWith({isReturnStatus: true});
	});
});
