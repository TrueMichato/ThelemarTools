/**
 * Bug #6 — Booming Blade / Green-Flame Blade reimplementation (combat side).
 *
 * Covers the transient on-hit rider mechanism:
 *  - the ✨ button arms the rider AFTER rolling the weapon attack,
 *  - the rider attaches to the NEXT matching weapon damage roll (crit-doubled),
 *  - a fresh attack roll discards an un-consumed rider,
 *  - the rider only applies to its own weapon and only when it has on-hit dice.
 *
 * Drives `CharacterSheetCombat` prototype methods with mock `_state`/`_page`.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

function makeCombat (overrides = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._pendingSpellRider = null;
	combat._state = {
		getCombatRound: () => 1,
		...overrides.state,
	};
	combat._page = {
		_spells: {
			getWeaponChannelCantripForCharacter: () => ({
				onHitDice: "1d8",
				onHitDamageType: "thunder",
				secondaryDice: "2d8",
				secondaryDamageType: "thunder",
				secondaryLabel: "thunder damage on moving",
			}),
		},
		...overrides.page,
	};
	// Avoid touching the (absent) DOM — the section render is exercised elsewhere.
	combat.renderCombatChanneledSpell = jest.fn();
	// Deterministic damage parse: total = sum of dice faces, doubled on crit.
	combat._parseDamage = (dice, isCrit, {maximize = false} = {}) => {
		const m = /^(\d+)d(\d+)/.exec(dice) || [];
		const n = Number(m[1] || 0) * Number(m[2] || 0);
		return {total: maximize ? n : isCrit ? n * 2 : n, dice, values: [n]};
	};
	return combat;
}

describe("_armChannelSpellRider", () => {
	it("arms a transient rider with the on-hit dice for the given weapon", () => {
		const combat = makeCombat();
		combat._armChannelSpellRider("atk-1", {spell: {name: "Booming Blade"}, spellData: {}});
		expect(combat._pendingSpellRider).toMatchObject({
			attackId: "atk-1",
			spellName: "Booming Blade",
			dice: "1d8",
			damageType: "thunder",
		});
		expect(combat.renderCombatChanneledSpell).toHaveBeenCalled();
	});

	it("does nothing when the character can't resolve the channel", () => {
		const combat = makeCombat({page: {_spells: {getWeaponChannelCantripForCharacter: () => null}}});
		combat._armChannelSpellRider("atk-1", {spell: {name: "Booming Blade"}, spellData: {}});
		expect(combat._pendingSpellRider).toBeNull();
	});
});

describe("_resolveChannelRiderDamage (rider attaches to next damage roll)", () => {
	it("returns the rider damage for the matching weapon attack", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", spellName: "Booming Blade", dice: "1d8", damageType: "thunder"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.channelSpell).not.toBeNull();
		expect(res.channelSpellDamage).toBe(8);
	});

	it("crit-doubles the on-hit dice", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8", damageType: "thunder"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", true);
		expect(res.channelSpellDamage).toBe(16);
	});

	it("does NOT attach to a different weapon", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-OTHER", false);
		expect(res.channelSpell).toBeNull();
		expect(res.channelSpellDamage).toBe(0);
	});

	it("does NOT attach to a spell attack", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: true}, "atk-1", false);
		expect(res.channelSpell).toBeNull();
	});

	it("does NOT attach when the rider has no on-hit dice (below level 5)", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: null};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.channelSpell).toBeNull();
	});

	it("reports riderMatched=true for the matching weapon even below level 5 (no dice)", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: null};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res.riderMatched).toBe(true);
		expect(res.channelSpellDamage).toBe(0);
	});

	it("reports riderMatched=false for a non-matching weapon", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-OTHER", false);
		expect(res.riderMatched).toBe(false);
	});

	it("maximizes and consumes an eligible armed effect on the on-hit thunder rider", () => {
		const consume = jest.fn(() => true);
		const combat = makeCombat({state: {
			canApplyPendingDamageMaximization: type => type === "thunder",
			consumePendingDamageMaximization: consume,
			getTriggeredDamageEffects: () => [{type: "forcedMovement", distance: 10}],
		}});
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8", damageType: "thunder"};
		const res = combat._resolveChannelRiderDamage({isSpell: false}, "atk-1", false);
		expect(res).toMatchObject({channelSpellDamage: 8, maximized: true});
		expect(res.triggeredEffects).toHaveLength(1);
		expect(consume).toHaveBeenCalledWith("thunder");
	});
});

describe("_clearPendingSpellRider (discard)", () => {
	it("clears the rider and refreshes the section", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._clearPendingSpellRider();
		expect(combat._pendingSpellRider).toBeNull();
		expect(combat.renderCombatChanneledSpell).toHaveBeenCalled();
	});
});

describe("fresh attack roll discards an un-consumed rider", () => {
	it("_rollAttack clears a pending rider before rolling", () => {
		const combat = makeCombat();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._cachedAttacks = [];
		combat._state.getAttacks = () => [{id: "atk-1", name: "Sword", range: "5 ft."}];
		combat._state.getTemporaryAttacks = () => [];
		combat._state.getActiveStateAttacks = () => [];
		// Throw right AFTER the discard guard (which runs before any bonus math) so we
		// don't have to mock the whole roll pipeline; the clear must already have happened.
		combat._state.getWeaponAbilityMod = () => { throw new Error("stop"); };
		expect(() => combat._rollAttack("atk-1", {})).toThrow("stop");
		expect(combat._pendingSpellRider).toBeNull();
	});
});

describe("_onChannelSpellButton arms AFTER rolling the attack", () => {
	it("calls _rollAttack first, then arms the rider (so its own roll isn't self-cleared)", async () => {
		const combat = makeCombat();
		const order = [];
		combat._channelCantripsCache = [{spell: {name: "Booming Blade"}, spellData: {}}];
		combat._rollAttack = jest.fn(() => order.push("attack"));
		combat._armChannelSpellRider = jest.fn(() => order.push("arm"));
		await combat._onChannelSpellButton("atk-1", {});
		expect(order).toEqual(["attack", "arm"]);
	});
});

describe("Spells-tab weapon-channel bridge", () => {
	const choice = {
		spell: {id: "bb", name: "Booming Blade", source: "TCE", level: 0},
		spellData: {
			name: "Booming Blade",
			source: "TCE",
			level: 0,
			duration: [{type: "round", duration: {type: "round", amount: 1}}],
			entries: ["You brandish the weapon used in the spell's casting and make a melee attack with it against one creature within 5 feet of you."],
			scalingLevelDice: [
				{label: "thunder damage on moving", scaling: {"1": "1d8", "5": "2d8"}},
				{label: "thunder damage on hit", scaling: {"5": "1d8"}},
			],
			damageInflict: ["thunder"],
		},
	};

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("prompts for an eligible weapon, then rolls before arming", async () => {
		const combat = makeCombat();
		combat._cachedAttacks = [
			{id: "unarmed", name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true, damage: "1", damageType: "bludgeoning"},
			{id: "sword", name: "Longsword", isMelee: true, damage: "1d8", damageType: "slashing"},
			{id: "staff", name: "Quarterstaff", isMelee: true, damage: "1d6", damageType: "bludgeoning"},
		];
		const order = [];
		combat._rollAttack = jest.fn(() => { order.push("attack"); return true; });
		combat._armChannelSpellRider = jest.fn(() => order.push("arm"));
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async () => 1);

		expect(await combat.pChannelSpellFromCast(choice)).toBe(true);
		expect(globalThis.InputUiUtil.pGetUserEnum).toHaveBeenCalledWith(expect.objectContaining({
			values: ["Longsword (1d8 slashing)", "Quarterstaff (1d6 bludgeoning)"],
		}));
		expect(combat._rollAttack).toHaveBeenCalledWith("staff", {});
		expect(order).toEqual(["attack", "arm"]);
	});

	it("cancels cleanly when no eligible weapon exists", async () => {
		const combat = makeCombat();
		combat._cachedAttacks = [{id: "unarmed", name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true}];
		combat._rollAttack = jest.fn();
		const toastSpy = jest.spyOn(globalThis.JqueryUtil, "doToast");
		expect(await combat.pChannelSpellFromCast(choice)).toBe(false);
		expect(combat._rollAttack).not.toHaveBeenCalled();
		expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringMatching(/requires an equipped melee weapon/i),
		}));
	});

	it("does not consume cast resources when the weapon bridge is cancelled", async () => {
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = {
			getSpells: () => [choice.spell],
			isConcentrating: () => false,
			getSorceryPoints: () => ({current: 3, max: 3}),
			useSorceryPoint: jest.fn(),
			consumeVariantComponent: jest.fn(),
		};
		spells._allSpells = [choice.spellData];
		spells._page = {
			saveCharacter: jest.fn(),
			_combat: {pChannelSpellFromCast: jest.fn(async () => false)},
		};
		spells._resolveMetamagicChoice = jest.fn(async () => ({
			cancelled: false,
			metamagic: {name: "Quickened Spell", cost: 2},
		}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._resolveVariantComponentChoice = jest.fn(async () => ({
			cancelled: false,
			variantComponent: {itemId: "component"},
		}));
		spells._pConsumeMaterialComponent = jest.fn();
		spells._showCastResult = jest.fn();

		await spells._castSpell(choice.spell.id, {withMetamagic: true});

		expect(spells._state.useSorceryPoint).not.toHaveBeenCalled();
		expect(spells._state.consumeVariantComponent).not.toHaveBeenCalled();
		expect(spells._pConsumeMaterialComponent).not.toHaveBeenCalled();
		expect(spells._page.saveCharacter).not.toHaveBeenCalled();
	});

	it("does not roll a weapon attack when the chosen metamagic is unaffordable", async () => {
		const channelSpy = jest.fn();
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = {
			getSpells: () => [choice.spell],
			isConcentrating: () => false,
			getSorceryPoints: () => ({current: 1, max: 3}),
			useSorceryPoint: jest.fn(),
		};
		spells._allSpells = [choice.spellData];
		spells._page = {saveCharacter: jest.fn(), _combat: {pChannelSpellFromCast: channelSpy}};
		spells._resolveMetamagicChoice = jest.fn(async () => ({
			cancelled: false,
			metamagic: {name: "Quickened Spell", cost: 2},
		}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._resolveVariantComponentChoice = jest.fn(async () => ({cancelled: false}));
		spells._pConsumeMaterialComponent = jest.fn();

		await spells._castSpell(choice.spell.id, {withMetamagic: true});

		expect(channelSpy).not.toHaveBeenCalled();
		expect(spells._state.useSorceryPoint).not.toHaveBeenCalled();
	});

	it("Spells-tab Cast arms the real rider and the next weapon damage roll folds it into the total", async () => {
		const attack = {
			id: "auto_sword",
			name: "Longsword",
			damage: "1d8",
			damageType: "slashing",
			abilityMod: "str",
			isMelee: true,
			isAutoGenerated: true,
			sourceItem: {id: "sword", name: "Longsword", dmg1: "1d8", dmg2: "1d10", handsUsed: 1},
		};
		const combat = makeCombat();
		combat._cachedAttacks = [attack];
		combat._state = {
			getCombatRound: () => 1,
			getAttacks: () => [attack],
			getTemporaryAttacks: () => [],
			getActiveStateAttacks: () => [],
			getWeaponDamageDie: item => item.dmg1,
			isMonkWeapon: () => false,
			getEffectiveItemBonuses: () => ({}),
			getWeaponAbilityMod: () => 3,
			getNamedModifiersByType: () => [],
			getItemWeaponScopedDamageContributions: () => [],
			getFeatureCalculations: () => ({}),
			getExtraDamageFromStates: () => [],
			getTotalLevel: () => 5,
			getSpellcastingAbilityForSpell: () => "int",
			getSpellcastingAbility: () => "int",
			getAbilityMod: () => 2,
		};
		combat._rollAttack = jest.fn(() => true);
		combat._promptUseCombatMethod = async () => null;
		combat._canApplySneakAttack = () => false;
		combat._getSelectedAmmoForWeapon = () => null;
		combat._parseDamage = (dice, isCrit) => {
			const total = dice === "1d8" ? 8 : 0;
			return {total: isCrit ? total * 2 : total, sides: 8, rolls: [total]};
		};
		combat._page.showDiceResult = jest.fn();
		combat._page.pAnimateDamageDice = jest.fn();

		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = {
			getSpells: () => [choice.spell],
			isConcentrating: () => false,
			getTotalLevel: () => 5,
			getSpellcastingAbilityForSpell: () => "int",
			getSpellcastingAbility: () => "int",
			getAbilityMod: () => 2,
		};
		spells._allSpells = [choice.spellData];
		spells._page = {saveCharacter: jest.fn(), _combat: combat, pAnimateDamageDice: jest.fn()};
		combat._page._spells = spells;
		spells._resolveMetamagicChoice = jest.fn(async () => ({cancelled: false, metamagic: null}));
		spells._pHandleCastingConstraints = jest.fn(async () => true);
		spells._resolveVariantComponentChoice = jest.fn(async () => ({cancelled: false}));
		spells._pConsumeMaterialComponent = jest.fn(async () => {});
		spells._showCastResult = jest.fn();

		await spells._castSpell(choice.spell.id, {withMetamagic: false});
		expect(combat._pendingSpellRider).toMatchObject({
			attackId: attack.id,
			spellName: "Booming Blade",
			dice: "1d8",
		});
		expect(spells._showCastResult).not.toHaveBeenCalled();

		await combat._rollDamage(attack.id);
		expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			total: expect.stringContaining("= 19"),
			subtitle: expect.stringContaining("Booming Blade on hit 1d8"),
		}));
		expect(combat._pendingSpellRider).toBeNull();
	});
});

describe("rider is discarded on unrelated re-renders / weapon removal", () => {
	const RENDER_SUBS = [
		"renderAttacks", "renderDeathSaves", "renderCombatChanneledSpell", "renderCombatSpells",
		"renderCombatMethods", "renderCombatRanger", "renderCombatDruidResources", "renderCombatFighter",
		"renderCombatDefenses", "renderCombatConditions", "renderCombatEffects", "renderCombatResources",
		"renderCombatActions", "renderCombatMetamagic", "renderCombatStates",
	];

	it("a full combat render() (tab switch / long rest) clears a pending rider", () => {
		const combat = makeCombat();
		// Stub every sub-render render() fans out to, plus the DOM/state it reads.
		for (const m of RENDER_SUBS) combat[m] = jest.fn();
		combat._state.getInitiative = () => 0;
		combat._page.getState = () => combat._state;
		const priorDoc = globalThis.document;
		globalThis.document = {getElementById: () => null};
		try {
			combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
			combat.render();
			expect(combat._pendingSpellRider).toBeNull();
		} finally {
			globalThis.document = priorDoc;
		}
	});

	it("removing the rider's own weapon clears the rider", () => {
		const combat = makeCombat();
		combat.renderAttacks = jest.fn();
		combat._state.getTemporaryAttacks = () => [];
		combat._state.removeAttack = jest.fn();
		combat._page.saveCharacter = jest.fn();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._removeAttack("atk-1");
		expect(combat._pendingSpellRider).toBeNull();
	});

	it("removing a DIFFERENT weapon keeps the rider armed", () => {
		const combat = makeCombat();
		combat.renderAttacks = jest.fn();
		combat._state.getTemporaryAttacks = () => [];
		combat._state.removeAttack = jest.fn();
		combat._page.saveCharacter = jest.fn();
		combat._pendingSpellRider = {attackId: "atk-1", dice: "1d8"};
		combat._removeAttack("atk-OTHER");
		expect(combat._pendingSpellRider).toMatchObject({attackId: "atk-1"});
	});

	it("clears the rider when dismissing a matching TEMPORARY attack", () => {
		const combat = makeCombat();
		combat.renderAttacks = jest.fn();
		combat._state.getTemporaryAttacks = () => [{id: "tmp-1", name: "Spiritual Weapon"}];
		combat._state.removeTemporaryAttack = jest.fn();
		combat._page.saveCharacter = jest.fn();
		combat._pendingSpellRider = {attackId: "tmp-1", dice: "1d8"};
		combat._removeAttack("tmp-1");
		expect(combat._pendingSpellRider).toBeNull();
	});

	it("clears the rider when UNEQUIPPING a matching auto_ weapon", () => {
		const combat = makeCombat();
		combat.renderAttacks = jest.fn();
		combat._state.getTemporaryAttacks = () => [];
		combat._state.getInventory = () => [{id: "w1", item: {name: "Rapier"}}];
		combat._state.unequip = jest.fn();
		combat._page._inventory = {render: jest.fn()};
		combat._page._saveCurrentCharacter = jest.fn();
		combat._pendingSpellRider = {attackId: "auto_w1", dice: "1d8"};
		combat._removeAttack("auto_w1");
		expect(combat._pendingSpellRider).toBeNull();
	});
});
