import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const MENDING = {
	name: "Mending",
	source: "XPHB",
	level: 0,
	school: "T",
	components: {v: true, s: true},
	duration: [{type: "instant"}],
};
const CURE_WOUNDS = {
	name: "Cure Wounds",
	source: "XPHB",
	level: 1,
	school: "A",
	components: {v: true, s: true},
	duration: [{type: "instant"}],
};
const DETECT_MAGIC = {
	...CURE_WOUNDS,
	name: "Detect Magic",
	school: "D",
	ritual: true,
};
const WAIVED_MATERIAL_SPELL = {
	...CURE_WOUNDS,
	name: "Waived Material Spell",
	components: {
		v: true,
		s: true,
		m: {
			text: "a source-qualified test component worth 100 gp, which the spell consumes",
			cost: 10000,
			consume: true,
		},
	},
};
const WEAPON_FOCUS_RULE_ID = "test-proficient-weapon-focus";
const WEAPON_FOCUS_SOURCE_FEATURE_UID = "Weapon Focus Contract|Artificer|EFA|3|EFA";

function getWeaponFocusRequirement ({
	sourceFeatureUid = WEAPON_FOCUS_SOURCE_FEATURE_UID,
	filter = null,
} = {}) {
	return {
		required: true,
		ruleId: WEAPON_FOCUS_RULE_ID,
		sourceFeatureUid,
		filter: filter || {
			weapon: {
				category: "any",
				requiresProficiency: true,
			},
		},
	};
}

function makeState ({source = "EFA", subclass = null} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Artificer", source, level: 5, ...(subclass ? {subclass} : {})});
	state.setSpellSlots(1, 4, 4);
	return state;
}

function makeBattleReadyState () {
	return makeState({
		subclass: {
			name: "Battle Smith",
			shortName: "Battle Smith",
			source: "EFA",
		},
	});
}

function addTool (state, {
	id,
	name,
	source = "PHB",
	type = "AT",
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({
		id,
		name,
		source,
		type,
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped(id, equipped);
	if (proficient) state.addToolProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function addWeapon (state, {
	id,
	name = "Longsword",
	source = "XPHB",
	type = "M",
	weapon = true,
	weaponCategory = "martial",
	quantity = 1,
	equipped = true,
	proficient = true,
} = {}) {
	state.addItem({
		id,
		name,
		source,
		type,
		weapon,
		weaponCategory,
		quantity,
		equipped,
		_isCustom: true,
	});
	if (proficient) state.addWeaponProficiency(name);
	return state.getInventory().find(row => row.id === id);
}

function addExactSpell (state, spellData, {
	classSource = "EFA",
	subclassName = null,
	subclassSource = null,
} = {}) {
	const spell = {
		...spellData,
		prepared: true,
		sourceClass: "Artificer",
		sourceClassSource: classSource,
		...(subclassName ? {sourceSubclass: subclassName} : {}),
		...(subclassSource ? {sourceSubclassSource: subclassSource} : {}),
	};
	if (spellData.level === 0) {
		state.addCantrip(spell);
		const stored = state.getCantrips().find(it => it.name === spell.name && it.source === spell.source);
		stored.level = 0;
		return stored;
	}
	state.addSpell(spell, true);
	return state.getSpells().find(it => it.name === spell.name && it.source === spell.source);
}

function makeSpellsManager (state, allSpells, {cancelResult = false} = {}) {
	const page = {
		_combat: null,
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_updateAllCalculations: jest.fn(),
		_renderActiveStates: jest.fn(),
		saveCharacter: jest.fn(),
	};
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._page = page;
	spells._state = state;
	spells._allSpells = allSpells;
	spells._resolveMetamagicChoice = jest.fn(async () => null);
	spells._resolveVariantComponentChoice = jest.fn(async () => null);
	spells._showCastResult = jest.fn(async () => ({cancelled: cancelResult}));
	spells._refreshSorceryPointUI = jest.fn();
	spells._updateConcentrationUI = jest.fn();
	spells.renderSlots = jest.fn();
	spells.render = jest.fn();
	spells._renderSpellList = jest.fn();
	return spells;
}

beforeEach(() => {
	jest.clearAllMocks();
	globalThis.InputUiUtil.pGetUserEnum = jest.fn();
	globalThis.InputUiUtil.pGetUserBoolean = jest.fn();
});

describe("EFA source-aware casting ownership", () => {
	it("resolves exact EFA ownership while rejecting TCE, another class, and ambiguous legacy rows", () => {
		const state = makeState();
		state.addClass({name: "Wizard", source: "XPHB", level: 1});
		const tceState = makeState({source: "TCE"});

		expect(state.resolveSpellCastingClassIdentity({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		})).toEqual(expect.objectContaining({uid: "Artificer|EFA"}));
		expect(state.getSpellCastFocusRequirement({
			sourceClass: {name: "Artificer", source: "EFA"},
		})).toEqual(expect.objectContaining({
			classUid: "Artificer|EFA",
			ruleId: "efa-artificer-tools-required",
			sourceFeatureUid: "Spellcasting|Artificer|EFA|1|EFA",
		}));

		expect(tceState.resolveSpellCastingClassIdentity({
			sourceClass: "Artificer",
			sourceClassSource: "TCE",
		})).toEqual(expect.objectContaining({uid: "Artificer|TCE"}));
		expect(tceState.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "TCE",
		})).toBeNull();
		expect(state.getSpellCastFocusRequirement({
			sourceClass: "Wizard",
			sourceClassSource: "XPHB",
		})).toBeNull();
		expect(state.resolveSpellCastingClassIdentity({sourceClass: "Artificer"})).toBeNull();
		expect(state.getSpellCastFocusRequirement({sourceClass: "Artificer"})).toBeNull();
	});

	it("stamps mixed-source Reanimator|RHW grants with the EFA base class source", () => {
		const subclass = {name: "Reanimator", shortName: "Reanimator", source: "RHW"};
		const state = makeState({subclass});
		const cls = state.getClasses()[0];
		const grant = state._buildSubclassSpellEntry(
			{name: "Cure Wounds", source: "XPHB", level: 1, isCantrip: false},
			subclass,
			cls,
		);

		expect(grant).toEqual(expect.objectContaining({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			sourceSubclass: "Reanimator",
			sourceSubclassSource: "RHW",
		}));
		expect(state.resolveSpellCastingClassIdentity(grant)).toEqual(expect.objectContaining({
			uid: "Artificer|EFA",
			subclassUid: "Reanimator|RHW",
		}));
		expect(state.getSpellCastFocusRequirement(grant)).not.toBeNull();
	});
});

describe("Structured spell-focus filters", () => {
	it("commits a waived-material cast through a live proficient weapon with exact rule ownership", async () => {
		const state = makeState();
		const weapon = addWeapon(state, {id: "weapon-focus"});
		state.addItem({id: "feature-source", name: "Weapon Focus Feature", source: "EFA", _isCustom: true});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer, {hookId: "weapon-focus-consumer"});

		const receipt = await spells.pCastItemSpell({
			id: "weapon-focus-cast",
			itemId: "feature-source",
			itemName: "Weapon Focus Feature",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: getWeaponFocusRequirement(),
		}, {decision: {focusInventoryItemId: weapon.id}});

		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			castingClassUid: "Artificer|EFA",
			ruleId: WEAPON_FOCUS_RULE_ID,
			sourceFeatureUid: WEAPON_FOCUS_SOURCE_FEATURE_UID,
			focusRule: {
				ruleId: WEAPON_FOCUS_RULE_ID,
				sourceFeatureUid: WEAPON_FOCUS_SOURCE_FEATURE_UID,
			},
			focusInventoryItemId: "weapon-focus",
			focusItemUid: "Longsword|XPHB",
			cast: expect.objectContaining({
				ruleId: WEAPON_FOCUS_RULE_ID,
				sourceFeatureUid: WEAPON_FOCUS_SOURCE_FEATURE_UID,
			}),
		}));
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.any(Object),
			1,
			false,
			false,
			expect.objectContaining({
				ignoresMaterialComponents: true,
				spellcastingFocus: expect.objectContaining({inventoryItemId: "weapon-focus"}),
			}),
		);
		expect(consumer).toHaveBeenCalledWith(receipt);
	});

	it.each([
		["unproficient weapon", {proficient: false}],
		["unequipped weapon", {equipped: false}],
		["zero-quantity weapon", {quantity: 0}],
		["non-weapon item", {type: "G", weapon: false, weaponCategory: null}],
	])("rejects a %s before the cast transaction", async (_label, weaponOverrides) => {
		const state = makeState();
		const candidate = addWeapon(state, {
			id: "invalid-focus",
			...weaponOverrides,
		});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);

		const result = await spells.pCastItemSpell({
			id: "invalid-weapon-focus",
			itemId: "feature-source",
			itemName: "Weapon Focus Feature",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: getWeaponFocusRequirement(),
		}, {decision: {focusInventoryItemId: candidate?.id || "invalid-focus"}});

		expect(result).toBe(false);
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(consumer).not.toHaveBeenCalled();
	});

	it("preserves exact authorized wrapper IDs through commit without applying weapon or tool proficiency semantics", async () => {
		const state = makeState();
		state.addItem({
			id: "authorized-wrapper",
			name: "Arcane Armor",
			source: "EFA",
			type: "G",
			quantity: 1,
			equipped: true,
			_isCustom: true,
		});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);

		const staged = await spells.pCastItemSpell({
			id: "authorized-wrapper-focus",
			itemId: "feature-source",
			itemName: "Authorized Wrapper Feature",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: getWeaponFocusRequirement({
				filter: {inventoryItemIds: ["authorized-wrapper"]},
			}),
		}, {
			deferCommit: true,
			decision: {focusInventoryItemId: "authorized-wrapper"},
		});
		delete staged.pendingSpellCast.spell.spellcastingFocusRequirement;
		const receipt = await spells.pCommitPendingSpellCast(staged.pendingSpellCast);

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			ruleId: WEAPON_FOCUS_RULE_ID,
			sourceFeatureUid: WEAPON_FOCUS_SOURCE_FEATURE_UID,
			focusInventoryItemId: "authorized-wrapper",
			focusItemUid: "Arcane Armor|EFA",
			focusRule: {
				ruleId: WEAPON_FOCUS_RULE_ID,
				sourceFeatureUid: WEAPON_FOCUS_SOURCE_FEATURE_UID,
			},
		}));
	});

	it("rejects a name-only source feature owner instead of publishing ambiguous attribution", async () => {
		const state = makeState();
		addWeapon(state, {id: "weapon-focus"});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);

		const result = await spells.pCastItemSpell({
			id: "source-unsafe-focus",
			itemId: "feature-source",
			itemName: "Weapon Focus Feature",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: getWeaponFocusRequirement({
				sourceFeatureUid: "Weapon Focus Contract",
			}),
		}, {decision: {focusInventoryItemId: "weapon-focus"}});

		expect(result).toBe(false);
		expect(spells._showCastResult).not.toHaveBeenCalled();
	});
});

describe("EFA held tool-focus resolution", () => {
	it.each([
		["thieves' tools", {name: "Thieves' Tools", type: "T"}],
		["tinker's tools", {name: "Tinker's Tools", type: "AT"}],
		["another proficient artisan tool", {name: "Smith's Tools", type: "AT"}],
	])("returns the actual inventory wrapper for %s", (_label, tool) => {
		const state = makeState();
		const wrapper = addTool(state, {id: "tool", ...tool});
		const requirement = state.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});

		expect(state.getEligibleSpellCastFocusInventoryRows(requirement)).toEqual([wrapper]);
	});

	it("rejects unheld, non-proficient, generic-focus, pouch, and unrelated tool rows", () => {
		const state = makeState();
		addTool(state, {id: "unheld", name: "Tinker's Tools", type: "AT", equipped: false});
		addTool(state, {id: "no-prof", name: "Smith's Tools", type: "AT", proficient: false});
		state.addItem({id: "orb", name: "Orb", source: "PHB", type: "SCF", scfType: "arcane", _isCustom: true});
		state.setItemEquipped("orb", true);
		state.addItem({id: "pouch", name: "Component Pouch", source: "PHB", type: "G", _isCustom: true});
		state.setItemEquipped("pouch", true);
		addTool(state, {id: "instrument", name: "Lute", type: "INS"});

		const requirement = state.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});
		expect(state.getEligibleSpellCastFocusInventoryRows(requirement)).toEqual([]);
	});

	it("uses the accessible existing picker when several legal tools are held", async () => {
		const state = makeState();
		addTool(state, {id: "thieves", name: "Thieves' Tools", type: "T"});
		const tinkers = addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue(tinkers);

		const selected = await spells._pResolveSpellCastFocus({
			spell: {sourceClass: "Artificer", sourceClassSource: "EFA"},
		});

		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalledWith(expect.objectContaining({
			title: "Choose Artificer Spellcasting Tools",
			isResolveItem: true,
		}));
		expect(selected.focusInventoryRow).toBe(tinkers);
		expect(selected.focusReference).toEqual({
			inventoryItemId: "tinkers",
			itemUid: "Tinker's Tools|PHB",
			name: "Tinker's Tools",
			source: "PHB",
		});
	});
});

describe("EFA Battle Ready proficient-weapon focus", () => {
	it("extends the exact EFA requirement to tools or a proficient weapon with Battle Ready attribution", () => {
		const state = makeBattleReadyState();
		const tool = addTool(state, {id: "smith", name: "Smith's Tools", type: "AT"});
		const weapon = addWeapon(state, {id: "battle-ready-weapon", proficient: false});
		state.addWeaponProficiency("Martial Weapons");
		const requirement = state.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});

		expect(requirement).toEqual(expect.objectContaining({
			ruleId: CharacterSheetState.EFA_BATTLE_READY_FOCUS_RULE_ID,
			sourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			classUid: "Artificer|EFA",
			filter: expect.objectContaining({
				weapon: {category: "any", requiresProficiency: true},
			}),
		}));
		expect(state.getEligibleSpellCastFocusInventoryRows(requirement)).toEqual(
			expect.arrayContaining([tool, weapon]),
		);
		expect(state.getSpellcastingFocusStatus()).toEqual({
			ok: true,
			source: "Battle Ready proficient weapon",
			itemName: "Longsword",
		});
	});

	it("uses the canonical live/equipped/quantity/proficiency gates", () => {
		const state = makeBattleReadyState();
		addWeapon(state, {id: "legal"});
		addWeapon(state, {id: "unproficient", name: "War Pick", weaponCategory: "exotic", proficient: false});
		addWeapon(state, {id: "unequipped", name: "Battleaxe", equipped: false});
		addWeapon(state, {id: "empty", name: "Maul", quantity: 0});
		addWeapon(state, {id: "nonweapon", name: "Hammer", type: "G", weapon: false, weaponCategory: null});

		const requirement = state.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});
		expect(state.getEligibleSpellCastFocusInventoryRows(requirement).map(row => row.id)).toEqual(["legal"]);
	});

	it("removes the weapon option immediately with the exact feature and never grants it to TCE or ambiguous rows", () => {
		const state = makeBattleReadyState();
		addWeapon(state, {id: "weapon"});
		state.getClasses()[0].subclass = {name: "Alchemist", shortName: "Alchemist", source: "EFA"};
		state.applyClassFeatureEffects();

		const efaRequirement = state.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		});
		expect(efaRequirement.ruleId).toBe(CharacterSheetState.EFA_SPELLCASTING_TOOLS_RULE_ID);
		expect(efaRequirement.filter.weapon).toBeNull();
		expect(state.getEligibleSpellCastFocusInventoryRows(efaRequirement)).toEqual([]);

		const tceState = makeState({
			source: "TCE",
			subclass: {name: "Battle Smith", shortName: "Battle Smith", source: "TCE"},
		});
		expect(tceState.getSpellCastFocusRequirement({
			sourceClass: "Artificer",
			sourceClassSource: "TCE",
		})).toBeNull();
		expect(makeBattleReadyState().getSpellCastFocusRequirement({sourceClass: "Artificer"})).toBeNull();
	});

	it("explains an absent Battle Ready focus through the canonical material block", () => {
		const state = makeBattleReadyState();
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);
		const spell = {
			...WAIVED_MATERIAL_SPELL,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		};

		expect(spells._getMaterialComponentBlock(spell, WAIVED_MATERIAL_SPELL))
			.toContain("proficient weapon");
	});
});

describe("EFA committed cast receipts", () => {
	it("commits a Battle Ready weapon-focus cast with exact top-level and cast attribution", async () => {
		const state = makeBattleReadyState();
		const weapon = addWeapon(state, {id: "battle-ready-focus"});
		const spell = addExactSpell(state, MENDING);
		const spells = makeSpellsManager(state, [MENDING]);

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {focusInventoryItemId: weapon.id},
		});

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			ruleId: CharacterSheetState.EFA_BATTLE_READY_FOCUS_RULE_ID,
			sourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			focusInventoryItemId: weapon.id,
			focusItemUid: "Longsword|XPHB",
			focusRule: {
				ruleId: CharacterSheetState.EFA_BATTLE_READY_FOCUS_RULE_ID,
				sourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			},
			cast: expect.objectContaining({
				ruleId: CharacterSheetState.EFA_BATTLE_READY_FOCUS_RULE_ID,
				sourceFeatureUid: CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS.BATTLE_READY,
			}),
		}));
		expect(spells._getSpellFocusNote(spell, MENDING, {focusReference: receipt.focus})).toBe("Longsword");
	});

	it("commits a no-material cantrip through the selected tool and returns an exact receipt", async () => {
		const state = makeState();
		addTool(state, {id: "thieves", name: "Thieves' Tools", type: "T"});
		const spell = addExactSpell(state, MENDING);
		const spells = makeSpellsManager(state, [MENDING]);

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {focusInventoryItemId: "thieves"},
		});

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			castingClassUid: "Artificer|EFA",
			ruleId: "efa-artificer-tools-required",
			sourceFeatureUid: "Spellcasting|Artificer|EFA|1|EFA",
			spellEntryId: spell.id,
			spellUid: "Mending|XPHB",
			castType: "cantrip",
			slotLevel: 0,
			focusInventoryItemId: "thieves",
			focusItemUid: "Thieves' Tools|PHB",
		}));
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({id: spell.id, name: "Mending", sourceClassSource: "EFA"}),
			0,
			false,
			false,
			expect.objectContaining({
				spellcastingFocus: expect.objectContaining({inventoryItemId: "thieves"}),
			}),
		);
		expect(spells._getSpellFocusNote(spell, MENDING, {focusReference: receipt.focus})).toBe("Thieves' Tools");
	});

	it("commits a leveled slot cast and invokes exact-class consumers", async () => {
		const state = makeState();
		addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);
		spells._showCastResult.mockResolvedValue({
			cancelled: false,
			damageEvidence: {
				version: 1,
				resolution: "confirmed",
				damage: [{damageType: "fire", amount: 7}],
				targets: [{targetId: "target-1", targetName: "Goblin", outcome: "damaged"}],
			},
		});
		const consumer = jest.fn(async receipt => receipt.spellUid);
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer, {hookId: "savant"});
		const before = state.getSpellSlotsCurrent(1);

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {slotLevel: 1, focusInventoryItemId: "tinkers"},
		});

		expect(state.getSpellSlotsCurrent(1)).toBe(before - 1);
		expect(consumer).toHaveBeenCalledTimes(1);
		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			castType: "slot",
			slotLevel: 1,
			focusInventoryItemId: "tinkers",
			damageEvidence: {
				version: 1,
				resolution: "confirmed",
				damage: [{damageType: "fire", amount: 7}],
				targets: [{targetId: "target-1", targetName: "Goblin", outcome: "damaged"}],
			},
			followUps: [{hookId: "savant", ok: true, value: "Cure Wounds|XPHB"}],
		}));
	});

	it("publishes ritual damage evidence through the dedicated ritual action", async () => {
		const state = makeState();
		addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		const spell = addExactSpell(state, DETECT_MAGIC);
		state.canCastAsRitual = jest.fn(() => true);
		const spells = makeSpellsManager(state, [DETECT_MAGIC]);
		spells._showCastResult.mockResolvedValue({
			cancelled: false,
			damageEvidence: {
				version: 1,
				resolution: "confirmed",
				damage: [{damageType: "acid", amount: 6}],
				targets: [{targetId: "target-1", targetName: "Ooze", outcome: "damaged"}],
			},
		});

		const receipt = await spells._castSpellAsRitual(spell.id);

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			castType: "ritual",
			focusInventoryItemId: "tinkers",
			damageEvidence: expect.objectContaining({
				damage: [{damageType: "acid", amount: 6}],
			}),
		}));
	});

	it("publishes a no-slot resource cast only after that resource is spent", async () => {
		const state = makeState();
		addTool(state, {id: "smith", name: "Smith's Tools", type: "AT"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		state._data.resources.push({id: "efa-plan-cast", name: "Plan Cast", current: 1, max: 1, recharge: "long"});
		state.getNoSlotCastResourcesForSpell = () => [{
			resourceId: "efa-plan-cast",
			name: "Plan Cast",
			current: 1,
			max: 1,
			castLevel: 1,
		}];
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);
		const consumer = jest.fn(receipt => state.getResource("Plan Cast").current);
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer, {hookId: "resource-observer"});

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {autoSlot: true, focusInventoryItemId: "smith"},
		});

		expect(state.getResource("Plan Cast").current).toBe(0);
		expect(receipt).toEqual(expect.objectContaining({
			castType: "noSlotResource",
			cast: expect.objectContaining({resourceId: "efa-plan-cast"}),
			followUps: [{hookId: "resource-observer", ok: true, value: 0}],
		}));
	});

	it("supports exact EFA-attributed item casts and publishes waived casts with null focus", async () => {
		const state = makeState();
		addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		state.addItem({id: "item-source", name: "Prototype Wand", source: "EFA", _isCustom: true});
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);

		const receipt = await spells.pCastItemSpell({
			id: "cast-cure",
			itemId: "item-source",
			itemName: "Prototype Wand",
			spellName: "Cure Wounds",
			spellSource: "XPHB",
			castLevel: 1,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		}, {decision: {focusInventoryItemId: "tinkers"}});
		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			castType: "item",
			focusInventoryItemId: "tinkers",
			cast: expect.objectContaining({
				itemInventoryId: "item-source",
				itemUid: "Prototype Wand|EFA",
			}),
		}));

		const stateWaived = makeState();
		const waivedSpells = makeSpellsManager(stateWaived, [WAIVED_MATERIAL_SPELL]);
		const waivedConsumer = jest.fn();
		stateWaived.registerCommittedSpellCastHook("Artificer|EFA", waivedConsumer);
		const waived = await waivedSpells.pCastItemSpell({
			id: "waived",
			itemId: "missing-item",
			itemName: "Innate Device",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
		});
		expect(waived).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			castingClassUid: "Artificer|EFA",
			castType: "item",
			ruleId: null,
			sourceFeatureUid: null,
			focusRule: null,
			focusInventoryItemId: null,
			focusItemUid: null,
			focus: null,
		}));
		expect(waivedSpells._showCastResult).toHaveBeenCalledTimes(1);
		expect(waivedConsumer).toHaveBeenCalledWith(waived);
	});

	it("supports a waived cast with an exact source-qualified explicit focus override", async () => {
		const state = makeState();
		addTool(state, {
			id: "alchemist-supplies",
			name: "Alchemist's Supplies",
			source: "XPHB",
			type: "AT",
		});
		state.addItem({id: "feature-source", name: "Conjured Cauldron", source: "EFA", _isCustom: true});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer, {hookId: "explicit-focus"});

		const receipt = await spells.pCastItemSpell({
			id: "conjured-cauldron-cast",
			itemId: "feature-source",
			itemName: "Conjured Cauldron",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: {
				required: true,
				ruleId: "conjured-cauldron-focus",
				filter: {
					itemUids: ["Alchemist's Supplies|XPHB"],
					requiresProficiency: true,
				},
			},
		}, {decision: {focusInventoryItemId: "alchemist-supplies"}});

		expect(receipt).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			castingClassUid: "Artificer|EFA",
			focusInventoryItemId: "alchemist-supplies",
			focusItemUid: "Alchemist's Supplies|XPHB",
			focus: {
				inventoryItemId: "alchemist-supplies",
				itemUid: "Alchemist's Supplies|XPHB",
				name: "Alchemist's Supplies",
				source: "XPHB",
			},
		}));
		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.any(Object),
			1,
			false,
			false,
			expect.objectContaining({
				ignoresMaterialComponents: true,
				spellcastingFocus: expect.objectContaining({inventoryItemId: "alchemist-supplies"}),
			}),
		);
		expect(consumer).toHaveBeenCalledWith(receipt);
	});

	it("blocks an explicit focus override with the wrong item source before cast commit", async () => {
		const state = makeState();
		addTool(state, {
			id: "wrong-source-supplies",
			name: "Alchemist's Supplies",
			source: "PHB",
			type: "AT",
		});
		const spells = makeSpellsManager(state, [WAIVED_MATERIAL_SPELL]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);

		const result = await spells.pCastItemSpell({
			id: "explicit-focus",
			itemId: "feature-source",
			itemName: "Focus Feature",
			spellName: WAIVED_MATERIAL_SPELL.name,
			spellSource: "XPHB",
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
			ignoresMaterialComponents: true,
			spellcastingFocusRequirement: {
				required: true,
				filter: {itemUids: ["Alchemist's Supplies|XPHB"]},
			},
		});

		expect(result).toBe(false);
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(consumer).not.toHaveBeenCalled();
	});

	it("defers an item-cast receipt until the item-power transaction commits", async () => {
		const state = makeState();
		addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		state.addItem({id: "item-source", name: "Prototype Wand", source: "EFA", _isCustom: true});
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);

		const staged = await spells.pCastItemSpell({
			id: "cast-cure",
			itemId: "item-source",
			itemName: "Prototype Wand",
			spellName: "Cure Wounds",
			spellSource: "XPHB",
			castLevel: 1,
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		}, {
			deferCommit: true,
			decision: {focusInventoryItemId: "tinkers"},
		});

		expect(staged).toEqual(expect.objectContaining({ok: true, pendingSpellCast: expect.any(Object)}));
		expect(consumer).not.toHaveBeenCalled();
		const receipt = await spells.pCommitPendingSpellCast(staged.pendingSpellCast);
		expect(receipt).toEqual(expect.objectContaining({committed: true, castType: "item"}));
		expect(consumer).toHaveBeenCalledTimes(1);
	});

	it("cancelling a multi-focus picker is a complete pre-cost no-op", async () => {
		const state = makeState();
		addTool(state, {id: "thieves", name: "Thieves' Tools", type: "T"});
		addTool(state, {id: "tinkers", name: "Tinker's Tools", type: "AT"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		const spells = makeSpellsManager(state, [CURE_WOUNDS]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);
		globalThis.InputUiUtil.pGetUserEnum.mockResolvedValue(null);
		const before = state.getSpellSlotsCurrent(1);

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {slotLevel: 1},
		});

		expect(receipt).toBeUndefined();
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(consumer).not.toHaveBeenCalled();
	});

	it("target cancellation refunds the slot and emits no receipt or consumer call", async () => {
		const state = makeState();
		addTool(state, {id: "thieves", name: "Thieves' Tools", type: "T"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		const spells = makeSpellsManager(state, [CURE_WOUNDS], {cancelResult: true});
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);
		const before = state.getSpellSlotsCurrent(1);

		const receipt = await spells._castSpell(spell.id, {
			withMetamagic: false,
			decision: {slotLevel: 1, focusInventoryItemId: "thieves"},
		});

		expect(receipt).toBeUndefined();
		expect(state.getSpellSlotsCurrent(1)).toBe(before);
		expect(consumer).not.toHaveBeenCalled();
	});

	it("blocks a failed focus gate before costs and emits no receipt", async () => {
		const state = makeState();
		const spell = addExactSpell(state, MENDING);
		const spells = makeSpellsManager(state, [MENDING]);
		const consumer = jest.fn();
		state.registerCommittedSpellCastHook("Artificer|EFA", consumer);

		const receipt = await spells._castSpell(spell.id, {withMetamagic: false});

		expect(receipt).toBeUndefined();
		expect(spells._showCastResult).not.toHaveBeenCalled();
		expect(consumer).not.toHaveBeenCalled();
	});

	it("preserves wrapper/entity identity across save/load and resolves a serialized receipt", async () => {
		const state = makeState();
		const tool = addTool(state, {id: "stable-tool", name: "Tinker's Tools", type: "AT"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		const receipt = await state.pPublishCommittedSpellCast({
			spell,
			spellData: CURE_WOUNDS,
			focusInventoryRow: tool,
			focusRequirement: state.getSpellCastFocusRequirement(spell),
			cast: {type: "slot", slotLevel: 1, focusInventoryItemId: "stable-tool"},
		});
		const serializedReceipt = JSON.parse(JSON.stringify(receipt));
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

		expect(loaded.getSpells().find(it => it.id === spell.id)).toEqual(expect.objectContaining({
			sourceClass: "Artificer",
			sourceClassSource: "EFA",
		}));
		expect(loaded.resolveCommittedSpellCastReceiptFocus(serializedReceipt)).toEqual(expect.objectContaining({
			id: "stable-tool",
			item: expect.objectContaining({name: "Tinker's Tools", source: "PHB"}),
		}));
		expect(serializedReceipt).toEqual(expect.objectContaining({
			ruleId: "efa-artificer-tools-required",
			sourceFeatureUid: "Spellcasting|Artificer|EFA|1|EFA",
		}));
	});

	it("captures consumer failures without rolling back or rejecting the valid receipt", async () => {
		const state = makeState();
		const tool = addTool(state, {id: "stable-tool", name: "Tinker's Tools", type: "AT"});
		const spell = addExactSpell(state, CURE_WOUNDS);
		state.registerCommittedSpellCastHook("Artificer|EFA", () => "ok", {hookId: "good"});
		state.registerCommittedSpellCastHook("Artificer|EFA", () => {
			throw new Error("consumer exploded");
		}, {hookId: "bad"});

		const receipt = await state.pPublishCommittedSpellCast({
			spell,
			spellData: CURE_WOUNDS,
			focusInventoryRow: tool,
			focusRequirement: state.getSpellCastFocusRequirement(spell),
			cast: {type: "slot", slotLevel: 1, focusInventoryItemId: "stable-tool"},
		});

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			ok: true,
			ruleId: "efa-artificer-tools-required",
			sourceFeatureUid: "Spellcasting|Artificer|EFA|1|EFA",
			followUpFailed: true,
			followUps: [
				{hookId: "good", ok: true, value: "ok"},
				{hookId: "bad", ok: false, error: "consumer exploded"},
			],
		}));
		expect(state.resolveCommittedSpellCastReceiptFocus(receipt)?.id).toBe("stable-tool");
	});
});
