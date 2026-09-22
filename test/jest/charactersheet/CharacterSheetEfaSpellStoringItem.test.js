import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;
const Inventory = globalThis.CharacterSheetInventory;
let Rest;
let createdElements = [];

const SPELLS = [
	{
		name: "Arcane Lock",
		source: "XPHB",
		level: 2,
		school: "A",
		time: [{number: 1, unit: "action"}],
		components: {v: true, s: true, m: {text: "gold dust worth 25 gp, which the spell consumes", cost: 2500, consume: true}},
		duration: [{type: "permanent"}],
		classes: {fromClassList: [{name: "Artificer", source: "EFA"}]},
	},
	{
		name: "Cure Wounds",
		source: "XPHB",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "action"}],
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		entries: ["A creature regains a number of hit points equal to {@dice 2d8} plus your spellcasting ability modifier."],
		miscTags: ["HL"],
		classes: {fromClassList: [{name: "Artificer", source: "EFA"}]},
	},
	{
		name: "Faerie Fire",
		source: "PHB",
		level: 1,
		school: "V",
		time: [{number: 1, unit: "action"}],
		components: {v: true},
		duration: [{type: "timed", concentration: true, duration: {amount: 1, type: "minute"}}],
		classes: {fromClassList: [{name: "Artificer", source: "EFA"}]},
	},
	{
		name: "Cure Wounds",
		source: "TCE",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "action"}],
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		classes: {fromClassList: [{name: "Artificer", source: "TCE"}]},
	},
	{
		name: "Cure Wounds",
		source: "TST",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "action"}],
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		classes: {fromClassList: [{name: "Cleric", source: "PHB"}]},
	},
	{
		name: "Bonus Spell",
		source: "EFA",
		level: 1,
		school: "V",
		time: [{number: 1, unit: "bonus"}],
		components: {v: true},
		duration: [{type: "instant"}],
		classes: {fromClassList: [{name: "Artificer", source: "EFA"}]},
	},
];

function makeState ({level = 11, source = "EFA"} = {}) {
	const state = new State();
	state.setId("character-artificer");
	state.setName("Ada");
	state.addClass({name: "Artificer", source, level});
	state.setAbilityBase("int", 18);
	state.setSpellData(SPELLS);
	state.addItem({
		id: "host-longsword",
		name: "Longsword",
		source: "XPHB",
		type: "M",
		weapon: true,
		weaponCategory: "martial",
		_isCustom: true,
	});
	state.setItemEquipped("host-longsword", true);
	state.addItem({
		id: "host-tools",
		name: "Smith's Tools",
		source: "XPHB",
		type: "AT",
		_isCustom: true,
	});
	state.addToolProficiency("Smith's Tools");
	state.setItemEquipped("host-tools", true);
	return state;
}

function makeSpells (state, {cancelled = false} = {}) {
	const spells = Object.create(Spells.prototype);
	spells._state = state;
	spells._allSpells = SPELLS;
	spells._page = {
		_saveCurrentCharacter: jest.fn(),
		_renderActiveStates: jest.fn(),
		_combat: {renderCombatStates: jest.fn()},
		_renderHp: jest.fn(),
	};
	spells._showCastResult = jest.fn(async () => cancelled ? {cancelled: true} : {cancelled: false});
	spells._updateConcentrationUI = jest.fn();
	return spells;
}

beforeAll(async () => {
	globalThis.CharacterSheetUpgrades ||= {
		isWeapon: item => !!item?.weapon || ["M", "R"].includes(item?.type),
		isArmor: () => false,
		isShield: () => false,
		getUpgradeEffects: () => ({tags: [], notes: []}),
		getGemstoneSummary: () => "",
	};
	const originalE = globalThis.e_;
	globalThis.e_ = opts => {
		const element = originalE(opts);
		element._attrs = {};
		element.setAttribute = (name, value) => { element._attrs[name] = String(value); };
		createdElements.push(element);
		return element;
	};
	Rest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

beforeEach(() => {
	createdElements = [];
	jest.clearAllMocks();
	globalThis.InputUiUtil.pGetUserBoolean = jest.fn();
	globalThis.InputUiUtil.pGetUserEnum = jest.fn();
	globalThis.InputUiUtil.pGetUserString = jest.fn();
});

describe("EFA Spell-Storing Item eligibility and storage", () => {
	test("requires exact Artificer|EFA level 11, exact EFA list membership, one action, and no consumed material", () => {
		const state = makeState();
		const options = state.getEfaSpellStoringItemOptions();

		expect(options).toMatchObject({
			available: true,
			classUid: "Artificer|EFA",
			hosts: expect.arrayContaining([
				expect.objectContaining({itemId: "host-longsword", itemUid: "Longsword|XPHB"}),
				expect.objectContaining({itemId: "host-tools", itemUid: "Smith's Tools|XPHB"}),
			]),
			spells: expect.arrayContaining([expect.objectContaining({spellUid: "Cure Wounds|XPHB"})]),
		});
		const spellUids = options.spells.map(it => it.spellUid);
		expect(spellUids).not.toContain("Arcane Lock|XPHB");
		expect(spellUids).not.toContain("Cure Wounds|TCE");
		expect(spellUids).not.toContain("Cure Wounds|TST");
		expect(spellUids).not.toContain("Bonus Spell|EFA");
		expect(makeState({level: 10}).getEfaSpellStoringItemOptions()).toMatchObject({available: false, reason: "ineligible"});
		expect(makeState({source: "TCE"}).getEfaSpellStoringItemOptions()).toMatchObject({available: false, reason: "ineligible"});
	});

	test("stores a versioned exact host/spell descriptor independent of prepared state and replaces the prior host", () => {
		const state = makeState();

		const first = state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		expect(first).toMatchObject({
			ok: true,
			committed: true,
			storage: {
				version: 1,
				storageId: expect.stringMatching(/^efa-spell-storage-/),
				ownerClassUid: "Artificer|EFA",
				host: {
					inventoryItemId: "host-longsword",
					itemUid: "Longsword|XPHB",
				},
				spell: {
					uid: "Cure Wounds|XPHB",
					name: "Cure Wounds",
					source: "XPHB",
					level: 1,
				},
				casting: {
					ability: "int",
					abilityMod: 4,
					saveDc: 16,
					attackBonus: 8,
				},
				usesCurrent: 8,
				usesMax: 8,
				repair: {status: "active", reasons: []},
			},
		});
		expect(state.getSpells()).toEqual([]);

		const second = state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-tools",
			spellUid: "Faerie Fire|PHB",
		});
		expect(second).toMatchObject({ok: true, committed: true});
		expect(state.getEfaSpellStoringItem()).toMatchObject({
			itemId: "host-tools",
			storage: {spell: {uid: "Faerie Fire|PHB"}},
		});
		expect(state.getInventory().find(row => row.id === "host-longsword").item._spellStorage).toBeUndefined();
		expect(state.getItemPowers({activeOnly: true})).toEqual(expect.arrayContaining([
			expect.objectContaining({
				itemId: "host-tools",
				kind: "storedSpell",
				name: "Faerie Fire",
				usesCurrent: 8,
				usesMax: 8,
				spellSaveDc: 16,
				spellAttackBonus: 8,
			}),
		]));
	});

	test("accepts active M3 replicated Wand and Weapon hosts through the accepted focus resolver", () => {
		const state = makeState();
		const weapon = state.createGeneratedFeatureItem({
			item: {name: "Longsword +1", source: "XDMG", type: "M", weapon: true, weaponCategory: "martial"},
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			metadata: {sourceFeatureUid: State.EFA_REPLICATE_MAGIC_ITEM_FEATURE_UID, temporary: true},
			catalog: {
				plan: {slotId: "plan-weapon", selection: {name: "+1 Weapon", source: "XDMG", planUid: "+1 Weapon|XDMG", itemUid: "+1 Weapon|XDMG"}},
				resolvedItem: {name: "Longsword +1", source: "XDMG", itemUid: "Longsword +1|XDMG"},
			},
			creation: {order: 1, receiptId: "receipt", event: "long-rest", batchId: "batch"},
			lifecycle: {version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION, state: "active", callbacks: {}, metadata: {}},
		});
		const wand = state.createGeneratedFeatureItem({
			item: {name: "Replicated Wand", source: "XDMG", type: "WD"},
			owner: State.EFA_REPLICATE_MAGIC_ITEM_OWNER,
			metadata: {sourceFeatureUid: State.EFA_REPLICATE_MAGIC_ITEM_FEATURE_UID, temporary: true},
			catalog: {
				plan: {slotId: "plan-wand", selection: {name: "Replicated Wand", source: "XDMG", planUid: "Replicated Wand|XDMG", itemUid: "Replicated Wand|XDMG"}},
				resolvedItem: {name: "Replicated Wand", source: "XDMG", itemUid: "Replicated Wand|XDMG"},
			},
			creation: {order: 2, receiptId: "receipt-wand", event: "long-rest", batchId: "batch"},
			lifecycle: {version: State.GENERATED_FEATURE_ITEM_LIFECYCLE_VERSION, state: "active", callbacks: {}, metadata: {}},
		});
		state.setItemEquipped(weapon.itemId, true);
		state.setItemEquipped(wand.itemId, true);

		expect(state.getEfaSpellStoringItemOptions().hosts).toEqual(expect.arrayContaining([
			expect.objectContaining({
				itemId: weapon.itemId,
				generatedFeatureItem: expect.objectContaining({generatedItemId: weapon.generatedItemId}),
			}),
			expect.objectContaining({
				itemId: wand.itemId,
				generatedFeatureItem: expect.objectContaining({generatedItemId: wand.generatedItemId}),
			}),
		]));
	});

	test("round-trips exact identities, surfaces missing spell data as stale, and cleans host/source loss", () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		const json = state.toJson();
		const catalogPending = new State();
		catalogPending.loadFromJson(json);
		expect(catalogPending.getEfaSpellStoringItem()).toMatchObject({
			storage: {repair: {status: "stale", reasons: ["spell-catalog-unavailable"]}},
		});
		catalogPending.setSpellData(SPELLS);
		expect(catalogPending.getEfaSpellStoringItem()).toMatchObject({
			storage: {repair: {status: "active", reasons: []}},
		});
		const futureJson = JSON.parse(JSON.stringify(json));
		futureJson.inventory.find(row => row.id === "host-longsword").item._spellStorage.version = 2;
		const futureStorage = new State();
		futureStorage.setSpellData(SPELLS);
		futureStorage.loadFromJson(futureJson);
		expect(futureStorage.getEfaSpellStoringItem()).toMatchObject({
			storage: {repair: {status: "stale", reasons: ["unsupported-storage-version"]}},
		});

		const restored = new State();
		restored.setSpellData(SPELLS);
		restored.loadFromJson(json);

		expect(restored.getEfaSpellStoringItem()).toMatchObject({
			itemId: "host-longsword",
			storage: {
				repair: {status: "active", reasons: []},
				host: {inventoryItemId: "host-longsword", itemUid: "Longsword|XPHB"},
				spell: {uid: "Cure Wounds|XPHB"},
			},
		});

		restored.setSpellData(SPELLS.filter(spell => spell.name !== "Cure Wounds"));
		expect(restored.getEfaSpellStoringItem()).toMatchObject({
			storage: {repair: {status: "stale", reasons: ["spell-identity-unresolved"]}},
		});
		expect(restored.getItemPowers().find(power => power.kind === "storedSpell")).toMatchObject({
			isAvailable: false,
			unavailableReason: expect.stringMatching(/repair required/i),
		});

		const hostLoss = makeState();
		hostLoss.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		hostLoss.removeItem("host-longsword");
		expect(hostLoss.getEfaSpellStoringItem()).toBeNull();

		const sourceLoss = makeState();
		sourceLoss.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		sourceLoss.removeClass("Artificer", "EFA");
		sourceLoss.addClass({name: "Artificer", source: "TCE", level: 11});
		expect(sourceLoss.getEfaSpellStoringItem()).toBeNull();

		const replacedHost = makeState();
		replacedHost.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		replacedHost.replaceItem("host-longsword", {name: "Longsword", source: "PHB", type: "M", weapon: true, weaponCategory: "martial"});
		expect(replacedHost.getEfaSpellStoringItem()).toBeNull();
	});
});

describe("EFA Spell-Storing Item use transaction", () => {
	test("resolves the stored effect without publishing a class cast, then spends one use", async () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		const classCastHook = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", classCastHook, {hookId: "must-not-run"});
		const publish = jest.spyOn(state, "pPublishCommittedSpellCast");
		const focusGate = jest.spyOn(state, "getSpellCastFocusRequirement");
		const castEndingStates = jest.spyOn(state, "consumeStatesEndingOnSpellCast");
		const spells = makeSpells(state);
		const consumeMaterial = jest.spyOn(spells, "_pConsumeMaterialComponent");

		const result = await spells.pUseEfaSpellStoringItem({
			itemId: "host-longsword",
			holder: {uid: "character:character-artificer", label: "Ada"},
		});

		expect(result).toMatchObject({ok: true, committed: true, usesCurrent: 7});
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Cure Wounds", source: "XPHB", level: 1}),
			1,
			false,
			false,
			expect.objectContaining({
				storedSpell: expect.objectContaining({
					ownerClassUid: "Artificer|EFA",
					holderUid: "character:character-artificer",
				}),
				castingStats: expect.objectContaining({ability: "int", saveDc: 16, attackBonus: 8}),
				suppressComponentNotes: true,
			}),
		);
		expect(classCastHook).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
		expect(focusGate).not.toHaveBeenCalled();
		expect(castEndingStates).not.toHaveBeenCalled();
		expect(consumeMaterial).not.toHaveBeenCalled();
	});

	test("uses the stored Artificer modifier for spell healing after the owner Intelligence changes", () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		const storedModifier = state.getEfaSpellStoringItem().storage.casting.abilityMod;
		state.setAbilityBase("int", 10);
		const spells = makeSpells(state);
		const originalDice = Renderer.dice;
		Renderer.dice = {...(originalDice || {}), parseRandomise2: () => 9};
		let healing;
		try {
			healing = spells._rollSpellHealing(SPELLS[1], 1, 1, "int", storedModifier);
		} finally {
			Renderer.dice = originalDice;
		}
		expect(healing).toMatch(/\+ 4\)/);
	});

	test("cancellation spends neither a use nor a turn receipt", async () => {
		const state = makeState();
		state.startCombat();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		const spells = makeSpells(state, {cancelled: true});

		const result = await spells.pUseEfaSpellStoringItem({
			itemId: "host-longsword",
			holder: {uid: "creature:ally-1", label: "Ally"},
		});

		expect(result).toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(state.getEfaSpellStoringItem()).toMatchObject({storage: {usesCurrent: 8}});
		expect(Object.keys(state.toJson().turnReceipts.receipts)).toEqual([]);
	});

	test("gates the exact holder once per combat turn but does not invent an out-of-combat lock", async () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		const spells = makeSpells(state);
		const holder = {uid: "creature:ally-1", label: "Ally"};

		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({ok: true, committed: true});
		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({ok: true, committed: true});

		state.startCombat();
		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({ok: true, committed: true});
		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({
			ok: false,
			committed: false,
			reason: "alreadyUsed",
		});
		expect(state.getEfaSpellStoringItem()).toMatchObject({storage: {usesCurrent: 5}});
		state.resetTurnEconomy();
		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({ok: true, committed: true});
	});

	test("rolls back only the exact turn receipt when the storage resource cannot commit", async () => {
		const state = makeState();
		state.startCombat();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		const spells = makeSpells(state);
		const holder = {uid: "external:ally-a", label: "Ally A"};
		const originalCommitReceipt = state.commitTurnReceipt.bind(state);
		jest.spyOn(state, "commitTurnReceipt").mockImplementation(receipt => {
			const out = originalCommitReceipt(receipt);
			delete state._data.inventory.find(row => row.id === "host-longsword").item._spellStorage;
			return out;
		});

		await expect(spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder}))
			.resolves.toMatchObject({ok: false, committed: false, reason: "resource-commit-failed"});
		expect(Object.keys(state.toJson().turnReceipts.receipts)).toEqual([]);
	});

	test("requires the exact host to remain held and disables the item power after its final use", async () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({
			hostItemId: "host-longsword",
			spellUid: "Cure Wounds|XPHB",
		});
		state._data.inventory.find(row => row.id === "host-longsword").item._spellStorage.usesCurrent = 1;
		const spells = makeSpells(state);
		const holder = {uid: "character:character-artificer", label: "Ada"};

		state.setItemEquipped("host-longsword", false);
		expect(state.prepareEfaSpellStoringItemUse({itemId: "host-longsword", holder}))
			.toMatchObject({ok: false, reason: "host-not-held"});
		expect(state.getItemPowers().find(power => power.kind === "storedSpell"))
			.toMatchObject({isAvailable: false, unavailableReason: expect.stringMatching(/hold|held/i)});

		state.setItemEquipped("host-longsword", true);
		await expect(spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder}))
			.resolves.toMatchObject({ok: true, committed: true, usesCurrent: 0});
		expect(state.getEfaSpellStoringItem()).toMatchObject({
			storage: {
				usesCurrent: 0,
				repair: {status: "expired", reasons: ["uses-depleted"]},
			},
		});
		expect(state.getItemPowers().find(power => power.kind === "storedSpell"))
			.toMatchObject({isAvailable: false, unavailableReason: expect.stringMatching(/no uses/i)});
	});

	test("assigns concentration to an explicit external holder without breaking unrelated concentration", async () => {
		const state = makeState();
		state.setConcentration({name: "Bless", level: 1});
		state.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Faerie Fire|PHB"});
		const spells = makeSpells(state);
		const holder = {uid: "external:ally-a", label: "Ally A"};

		expect(await spells.pUseEfaSpellStoringItem({itemId: "host-longsword", holder})).toMatchObject({ok: true});
		expect(state.getConcentrations()).toEqual(expect.arrayContaining([
			expect.objectContaining({spellName: "Bless", holderUid: "character:character-artificer"}),
			expect.objectContaining({
				spellName: "Faerie Fire",
				holderUid: "external:ally-a",
				storageId: expect.stringMatching(/^efa-spell-storage-/),
			}),
		]));
	});

	test("routes Inventory and Actions invocation through the stored-effect transaction", async () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		const spells = makeSpells(state);
		const inventory = Object.create(Inventory.prototype);
		inventory._state = state;
		inventory._page = {
			_spells: spells,
			_saveCurrentCharacter: jest.fn(),
			_combat: {renderCombatItemPowers: jest.fn(), renderCombatActionEconomy: jest.fn()},
			_playMode: {_renderActionsHub: jest.fn()},
		};
		inventory._updateItemBonuses = jest.fn();
		inventory._renderItemList = jest.fn();
		const power = state.getItemPowers({activeOnly: true}).find(it => it.kind === "storedSpell");

		await expect(inventory._pInvokeItemPower(
			"host-longsword",
			power.id,
			{holder: {uid: "character:character-artificer", label: "Ada"}},
		)).resolves.toMatchObject({ok: true, usesCurrent: 7});
		expect(inventory._page._saveCurrentCharacter).toHaveBeenCalled();
		expect(inventory._page._combat.renderCombatItemPowers).toHaveBeenCalled();
		expect(inventory._page._playMode._renderActionsHub).toHaveBeenCalled();
	});

	test("requires an explicit stable identity when another creature is the acting holder", async () => {
		const state = makeState();
		const inventory = Object.create(Inventory.prototype);
		inventory._state = state;
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue({uid: "__external__", label: "Another creature", kind: "external"});
		globalThis.InputUiUtil.pGetUserString.mockResolvedValue("Ally One");

		await expect(inventory._pGetSpellStoringItemHolder({name: "Cure Wounds"})).resolves.toEqual({
			uid: "external:ally-one",
			label: "Ally One",
			kind: "external",
		});
		expect(globalThis.InputUiUtil.pGetUserString).toHaveBeenCalledWith(expect.objectContaining({
			htmlDescription: expect.stringMatching(/exact identity owns concentration/i),
		}));
	});

	test("renders a usable Inventory Powers affordance backed by exact stored-spell metadata", () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		const inventory = Object.create(Inventory.prototype);
		inventory._state = state;
		inventory._page = {
			_saveCurrentCharacter: jest.fn(),
			_renderActiveStates: jest.fn(),
			_combat: {renderCombatStates: jest.fn()},
		};
		const row = inventory._renderItemRow(state.getInventory().find(it => it.id === "host-longsword"));

		expect(row.outerHTML).toMatch(/Powers \(1\)/);
		expect(state.getItemPowers({activeOnly: true})).toEqual(expect.arrayContaining([
			expect.objectContaining({
				itemId: "host-longsword",
				name: "Cure Wounds",
				usesCurrent: 8,
				usesMax: 8,
				spellSaveDc: 16,
				spellAttackBonus: 8,
			}),
		]));
	});
});

describe("EFA Spell-Storing Item long-rest interaction", () => {
	test("uses labelled native selects, live status, and a mobile-safe single-column flow", () => {
		const state = makeState();
		const rest = Object.create(Rest.prototype);
		rest._state = state;
		const choice = rest._buildEfaSpellStoringItemSection();

		expect(choice.section.tag).toBe("fieldset");
		expect(choice.section._clazz).toContain("charsheet__rest-section");
		expect(choice.hostSelect.tag).toBe("select");
		expect(choice.spellSelect.tag).toBe("select");
		expect(choice.hostSelect._clazz).toContain("form-control");
		expect(choice.spellSelect._clazz).toContain("form-control");
		expect(choice.hostSelect.style.width).toBeUndefined();
		expect(choice.spellSelect.style.width).toBeUndefined();
		expect(choice.status._attrs).toMatchObject({role: "status", "aria-live": "polite"});
		expect(choice.getRequest()).toBeNull();
		expect(choice.status.textContent).toMatch(/no spell will be stored/i);

		choice.hostSelect.value = "host-longsword";
		choice.hostSelect._handlers.change();
		expect(choice.getRequest()).toBeNull();
		expect(choice.status.textContent).toMatch(/long rest will still finish/i);

		choice.spellSelect.value = "Cure Wounds|XPHB";
		choice.spellSelect._handlers.change();
		expect(choice.getRequest()).toEqual({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		expect(choice.status.textContent).toMatch(/8 uses/i);
	});

	test("commits a complete choice but leaves current storage unchanged for a blank or incomplete choice", async () => {
		const state = makeState();
		state.commitEfaSpellStoringItemAtLongRest({hostItemId: "host-longsword", spellUid: "Cure Wounds|XPHB"});
		const storageId = state.getEfaSpellStoringItem().storage.storageId;
		const rest = Object.create(Rest.prototype);
		rest._state = state;

		expect(rest._commitEfaSpellStoringItemChoice(null)).toBeNull();
		expect(state.getEfaSpellStoringItem().storage.storageId).toBe(storageId);

		expect(rest._commitEfaSpellStoringItemChoice({getRequest: () => null}))
			.toEqual({ok: true, committed: false, reason: "selection-skipped"});
		expect(state.getEfaSpellStoringItem().storage.storageId).toBe(storageId);

		expect(rest._commitEfaSpellStoringItemChoice({
			getRequest: () => ({hostItemId: "host-tools", spellUid: "Faerie Fire|PHB"}),
		}))
			.toMatchObject({ok: true, committed: true});
		expect(state.getEfaSpellStoringItem()).toMatchObject({
			itemId: "host-tools",
			storage: {spell: {uid: "Faerie Fire|PHB"}},
		});
	});

	test("the actual Finish Long Rest handler commits the selected exact host and spell", async () => {
		const state = makeState();
		state.setMaxHp(20);
		state.setCurrentHp(5);
		const rest = Object.create(Rest.prototype);
		rest._state = state;
		rest._page = {
			_lastRestSnapshot: null,
			getState: () => state,
			saveCharacter: jest.fn(),
			renderCharacter: jest.fn(),
			getMaterialsModule: () => null,
		};
		rest._showUndoRestAffordance = jest.fn();
		rest._showGamblerPreparedRollModal = jest.fn();
		rest._showScribingMemorizeModal = jest.fn();
		const modalInner = globalThis.e_({tag: "div"});
		const doClose = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: modalInner, doClose});

		await rest._showLongRestDialog();
		const hostSelect = createdElements.find(element => element.id?.startsWith("efa-spell-storage-host-"));
		const spellSelect = createdElements.find(element => element.id?.startsWith("efa-spell-storage-spell-"));
		hostSelect.value = "host-longsword";
		hostSelect._handlers.change();
		spellSelect.value = "Cure Wounds|XPHB";
		spellSelect._handlers.change();
		const confirm = createdElements.find(element => element.textContent === "🌙 Finish Long Rest");
		confirm.click();

		expect(state.getCurrentHp()).toBe(state.getMaxHp());
		expect(state.getEfaSpellStoringItem()).toMatchObject({
			itemId: "host-longsword",
			storage: {spell: {uid: "Cure Wounds|XPHB"}},
		});
		expect(rest._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(rest._page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(doClose).toHaveBeenCalledWith(true);
	});
});
