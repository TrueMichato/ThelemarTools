import {jest} from "@jest/globals";
import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const spell = JSON.parse(fs.readFileSync(new URL("../../../data/spells/spells-xge.json", import.meta.url)))
	.spell.find(it => it.name === "Shadow Blade" && it.source === "XGE");

const makeState = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 13});
	state.setAbilityBase("str", 10);
	state.setAbilityBase("dex", 16);
	state.addSpell(spell);
	return state;
};

const getBlade = state => state.getItems().find(item => item._summonedSpell?.spellUid === "shadow blade|xge");

const summon = (state, slotLevel = 2) => {
	state.setConcentration({name: spell.name, source: spell.source, level: slotLevel});
	return state.summonSpellWeapon(spell, slotLevel);
};

const makeCastFixture = ({cancelled = false, variantComponent = null} = {}) => {
	const state = makeState();
	state.setSpellSlots(2, 3, 2);
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._allSpells = [spell];
	spells._page = {
		_combat: {renderAttacks: jest.fn(), renderCombatActionEconomy: jest.fn()},
		_inventory: {render: jest.fn()},
		_renderActiveStates: jest.fn(),
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		saveCharacter: jest.fn(),
	};
	spells._pHandleCastingConstraints = jest.fn(async () => true);
	spells._pChooseVariantComponent = jest.fn(async () => ({cancelled: false, variantComponent}));
	spells._pResolveSpellCastFocus = jest.fn(async () => ({cancelled: false}));
	spells._showCastResult = jest.fn(async () => ({cancelled}));
	spells._pConsumeMaterialComponent = jest.fn(async () => ({}));
	spells._pPublishCommittedSpellCast = jest.fn(async () => ({ok: true}));
	spells._pApplyCommittedEfaArcaneFirearmDamage = jest.fn(async () => {});
	spells._updateConcentrationUI = jest.fn();
	spells.renderSlots = jest.fn();
	return {state, spells, spellId: state.getSpells().find(it => it.name === spell.name).id};
};

const makeCombatFixture = state => {
	const modes = [];
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._cachedAttacks = state.getItems().filter(it => it.weapon && it.equipped).map(it => state.buildAutoAttackFromWeapon(it));
	combat._page = {
		rollD20: ({mode}) => { modes.push(mode || "normal"); return {roll: 10, mode: mode || "normal"}; },
		pAnimateD20: jest.fn(),
		showDiceResult: jest.fn(() => null),
		getModeLabel: () => "",
		formatD20Breakdown: () => "",
		_offerGuidedStrikePostAttack: jest.fn(),
		_inventory: {render: jest.fn()},
		saveCharacter: jest.fn(),
	};
	combat._canRollAttackActionAttack = () => true;
	combat._getSelectedAmmoForWeapon = () => null;
	combat._getCombatLocalAttackBonus = () => ({bonus: 0, parts: []});
	combat._runPostAttackHooks = async () => {};
	combat._consumeOnAttackStates = () => {};
	combat._recordAttackForTurn = () => {};
	combat._isSneakAttackAvailableThisTurn = () => false;
	combat._renderSneakAttackToggle = () => {};
	combat.renderAttacks = jest.fn();
	return {combat, modes};
};

describe("XGE Shadow Blade summoned weapon", () => {
	afterEach(() => jest.restoreAllMocks());

	test.each([[2, "2d8"], [3, "3d8"], [4, "3d8"], [5, "4d8"], [6, "4d8"], [7, "5d8"], [9, "5d8"]])(
		"slot %i creates a proficient psychic sword with %s damage, not a universal buff",
		(slotLevel, dice) => {
			const state = makeState();
			expect(summon(state, slotLevel).ok).toBe(true);
			const blade = getBlade(state);
			expect(blade).toMatchObject({
				type: "M",
				weapon: true,
				weaponCategory: "simple",
				property: ["F", "L", "T"],
				range: "20/60 ft.",
				dmg1: dice,
				dmgType: "psychic",
				equipped: true,
			});
			const attack = state.buildAutoAttackFromWeapon(blade);
			expect(attack).toMatchObject({damage: dice, damageType: "psychic", abilityMod: "finesse", isThrown: true});
			expect(state.getAttackClassification(attack)).toMatchObject({isMelee: true, isThrown: true});
			expect(state._isWeaponProficient(blade)).toBe(true);
			expect(state.getAttackBonusBreakdown(attack).proficiency).toBe(state.getProficiencyBonus());
			expect(state.getExtraDamageFromStates().some(effect => effect.dice === "2d8" && effect.damageType === "psychic")).toBe(false);
		},
	);

	test("only the live sword receives its own dice, including after recast; unrelated attacks never inherit 2d8", () => {
		const state = makeState();
		const first = summon(state, 2);
		const oldId = first.itemId;
		state.addItem({name: "Dagger", source: "PHB", type: "M", weaponCategory: "simple", property: ["F"], dmg1: "1d4", dmgType: "P"}, 1, true);
		const dagger = state.getItems().find(it => it.name === "Dagger");
		expect(state.buildAutoAttackFromWeapon(dagger).damage).toBe("1d4");
		const second = summon(state, 7);
		expect(second.itemId).not.toBe(oldId);
		expect(state.getItemRaw(oldId)).toBeNull();
		expect(state.getItems().filter(it => it._summonedSpell)).toHaveLength(1);
		expect(state.buildAutoAttackFromWeapon(getBlade(state)).damage).toBe("5d8");
		expect(state.buildAutoAttackFromWeapon(dagger).damage).toBe("1d4");
	});

	test("drop dissipates at the turn boundary, re-summon spends a bonus action without a spell slot", () => {
		const state = makeState();
		state.startCombat();
		const {itemId} = summon(state, 5);
		state.setItemEquipped(itemId, false);
		expect(state.getItemRaw(itemId)).not.toBeNull();
		expect(state.resummonSpellWeapon(spell).ok).toBe(false);
		state.resetTurnEconomy();
		expect(state.getItemRaw(itemId)).toBeNull();
		expect(state.getSpellConcentration()?.spellName).toBe(spell.name);
		expect(state.resummonSpellWeapon(spell).ok).toBe(true);
		expect(getBlade(state)?.id).toBe(itemId);
		expect(getBlade(state)?.dmg1).toBe("4d8");
		expect(state.isActionTypeAvailable("bonus")).toBe(false);
		expect(state.resummonSpellWeapon(spell).ok).toBe(false);
	});

	test("breaking or expiring concentration removes the item, including after save/load", () => {
		const state = makeState();
		state.startCombat();
		const {itemId} = summon(state);
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getItemRaw(itemId)?.dmg1).toBe("2d8");
		restored.breakConcentration();
		expect(restored.getItemRaw(itemId)).toBeNull();
		expect(restored.resummonSpellWeapon(spell).ok).toBe(false);
		expect(restored.getWeaponProficiencies()).not.toContain(spell.name);

		const expiring = makeState();
		expiring.startCombat();
		summon(expiring);
		for (let i = 0; i < 10; i++) expiring.advanceRound();
		expect(expiring.getSpellConcentration()).toBeNull();
		expect(getBlade(expiring)).toBeUndefined();
	});

	test("released sword survives save/load until turn end, then returns under the same cast identity", () => {
		const state = makeState();
		state.startCombat();
		const {itemId} = summon(state, 3);
		state.unequip(itemId);
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getItemRaw(itemId)?._summonedSpell?.status).toBe("released");
		expect(restored.equip(itemId)).toBe(false);
		restored.resetTurnEconomy();
		expect(restored.getItemRaw(itemId)).toBeNull();
		expect(restored.resummonSpellWeapon(spell).ok).toBe(true);
		expect(getBlade(restored)).toMatchObject({id: itemId, dmg1: "3d8", equipped: true});
	});

	test("casting does not erase a separately learned sword proficiency when concentration ends", () => {
		const state = makeState();
		state.addWeaponProficiency(spell.name);
		summon(state);
		state.breakConcentration();
		expect(state.getWeaponProficiencies()).toContain(spell.name);
	});

	test("the sword grants its own proficiency even without simple-weapon proficiency", () => {
		const state = new CharacterSheetState();
		const sword = {name: spell.name, weaponCategory: "simple"};
		expect(state._isWeaponProficient(sword)).toBe(false);
		summon(state);
		expect(state._isWeaponProficient(getBlade(state))).toBe(true);
		state.breakConcentration();
		expect(state._isWeaponProficient(sword)).toBe(false);
	});

	test("a different concentration spell retires the sword and its temporary proficiency", () => {
		const state = makeState();
		const {itemId} = summon(state);
		state.setConcentration({name: "Invisibility", source: "PHB", level: 2});
		expect(state.getItemRaw(itemId)).toBeNull();
		expect(state.getWeaponProficiencies()).not.toContain(spell.name);
		expect(state.getSummonedSpellWeaponToResummon()).toBeNull();
	});

	test("a committed real cast spends the slot and materializes the sword; cancellation does neither", async () => {
		const committed = makeCastFixture();
		await committed.spells._castSpell(committed.spellId, {
			withMetamagic: false,
			decision: {slotLevel: 2, skipComponentPrompt: true},
		});
		expect(committed.state.getSpellSlotsCurrent(2)).toBe(1);
		expect(committed.state.getSpellConcentration()?.spellName).toBe(spell.name);
		expect(getBlade(committed.state)?.dmg1).toBe("2d8");
		expect(committed.spells._page._combat.renderAttacks).toHaveBeenCalled();

		const cancelled = makeCastFixture({cancelled: true});
		await cancelled.spells._castSpell(cancelled.spellId, {
			withMetamagic: false,
			decision: {slotLevel: 2, skipComponentPrompt: true},
		});
		expect(cancelled.state.getSpellSlotsCurrent(2)).toBe(2);
		expect(cancelled.state.getSpellConcentration()).toBeNull();
		expect(getBlade(cancelled.state)).toBeUndefined();
	});

	test("a deferred item cast creates its sword on publication, not while still pending", async () => {
		const {state, spells} = makeCastFixture();
		state.setConcentration({name: spell.name, source: spell.source, level: 2});
		const pending = {spell, spellData: spell, cast: {type: "item", slotLevel: 2}};
		expect(getBlade(state)).toBeUndefined();
		await spells.pCommitPendingSpellCast(pending);
		expect(getBlade(state)?.dmg1).toBe("2d8");
	});

	test("an incompatible remove-concentration component cannot spend a slot or leave an unsummoned cast", async () => {
		const fixture = makeCastFixture({variantComponent: {effects: [{type: "removeConcentration"}]}});
		await fixture.spells._castSpell(fixture.spellId, {
			withMetamagic: false,
			decision: {slotLevel: 2},
		});
		expect(fixture.state.getSpellSlotsCurrent(2)).toBe(2);
		expect(fixture.state.getSpellConcentration()).toBeNull();
		expect(getBlade(fixture.state)).toBeUndefined();
		expect(fixture.spells._showCastResult).not.toHaveBeenCalled();
	});

	test("legacy save replaces the universal buff with a weapon and ties it to expiry", () => {
		const state = makeState();
		state.startCombat();
		state.setConcentration({name: spell.name, source: spell.source, level: 5});
		state.activateState("custom", {
			name: spell.name,
			isSpellEffect: true,
			concentration: true,
			duration: {amount: 1, unit: "minute"},
			customEffects: [{type: "extraDamage", dice: "2d8", damageType: "psychic"}],
		});
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(getBlade(restored)?.dmg1).toBe("4d8");
		expect(restored.getExtraDamageFromStates()).toEqual([]);
		for (let i = 0; i < 10; i++) restored.advanceRound();
		expect(restored.getSpellConcentration()).toBeNull();
		expect(getBlade(restored)).toBeUndefined();
	});

	test("a same-name non-XGE spell cannot acquire Shadow Blade's summoned weapon", () => {
		const state = makeState();
		const other = {...spell, source: "HB"};
		state.setConcentration({name: other.name, source: other.source, level: 2});
		expect(state.summonSpellWeapon(other, 2)).toMatchObject({ok: false});
		expect(CharacterSheetState.parseSpellEffects(other).summonedWeapon).toBeUndefined();
	});

	test("the actual combat roll grants target-light advantage only to the live blade", async () => {
		const state = makeState();
		summon(state);
		const blade = getBlade(state);
		state.addItem({name: "Dagger", source: "PHB", type: "M", weaponCategory: "simple", dmg1: "1d4", dmgType: "P"}, 1, true);
		const {combat, modes} = makeCombatFixture(state);
		const attacks = combat._cachedAttacks;

		await combat._rollAttack(attacks[0].id, {}, {targetInDimLightOrDarkness: true});
		await combat._rollAttack(attacks[1].id, {}, {targetInDimLightOrDarkness: true});
		await combat._rollAttack(attacks[0].id, {}, {targetInDimLightOrDarkness: false});
		expect(modes).toEqual(["advantage", "normal", "normal"]);
		expect(state.getItemRaw(blade.id)).not.toBeNull();

		state.breakConcentration();
		expect(await combat._rollAttack(attacks[0].id, {}, {targetInDimLightOrDarkness: true})).toBe(false);
		expect(modes).toHaveLength(3);
	});

	test("the damage roll uses the sword's psychic dice, not extra dice on a dagger", async () => {
		const state = makeState();
		summon(state);
		state.addItem({name: "Dagger", source: "PHB", type: "M", weapon: true, weaponCategory: "simple", dmg1: "1d4", dmgType: "P"}, 1, true);
		const {combat} = makeCombatFixture(state);
		const damageFormulas = [];
		combat._parseDamage = formula => {
			damageFormulas.push(formula);
			return {total: 5, sides: 8, rolls: [5]};
		};
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;

		await combat._rollDamage(combat._cachedAttacks[0].id);
		await combat._rollDamage(combat._cachedAttacks[1].id);
		expect(damageFormulas).toEqual(["2d8", "1d4"]);
		expect(combat._page.showDiceResult.mock.calls.map(([result]) => result.title)).toEqual(["Shadow Blade Damage", "Dagger Damage"]);
	});

	test("the live attack row offers a pressed-state light toggle and Throw, while a pending throw offers damage only", () => {
		const state = makeState();
		const {itemId} = summon(state);
		const {combat} = makeCombatFixture(state);
		combat._channelCantripsCache = [];
		const attack = combat._cachedAttacks[0];
		const live = combat._renderAttackItem(attack).outerHTML;
		expect(live).toContain("charsheet__attack-dim-target");
		expect(live).toMatch(/aria-pressed="false"/);
		expect(live).toContain("charsheet__attack-throw");
		state.releaseSummonedSpellWeapon(itemId);
		const pending = combat._renderAttackItem({...attack, pendingThrownDamage: true}).outerHTML;
		expect(pending).toContain("charsheet__attack-damage");
		expect(pending).not.toContain("charsheet__attack-roll");
		expect(pending).not.toContain("charsheet__attack-throw");
	});

	test("a throw uses ranged attack classification and releases the sword only after its attack roll", async () => {
		const state = makeState();
		state.startCombat();
		const {itemId} = summon(state);
		const {combat, modes} = makeCombatFixture(state);
		const attackId = combat._cachedAttacks[0].id;
		const roll = await combat._rollAttack(attackId, {}, {thrown: true, targetInDimLightOrDarkness: true});
		expect(roll).toBe(true);
		expect(modes).toEqual(["advantage"]);
		expect(combat._getAttackRollKind(combat._pendingSummonedWeaponThrow.attack)).toMatchObject({isMelee: false, isRanged: true});
		expect(state.getItemRaw(itemId)?._summonedSpell?.status).toBe("released");
		expect(state.equip(itemId)).toBe(false);
		state.setItemEquipped(itemId, true);
		expect(state.getItemRaw(itemId)?.equipped).toBe(false);
		expect(await combat._rollAttack(attackId, {}, {targetInDimLightOrDarkness: true})).toBe(false);
		expect(modes).toHaveLength(1);
		const damageFormulas = [];
		combat._parseDamage = formula => {
			damageFormulas.push(formula);
			return {total: 7, sides: 8, rolls: [7]};
		};
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;
		await combat._rollDamage(attackId);
		expect(damageFormulas).toEqual(["2d8"]);
		expect(combat._pendingSummonedWeaponThrow).toBeNull();
		state.resetTurnEconomy();
		expect(state.getItemRaw(itemId)).toBeNull();
		expect(state.getSummonedSpellWeaponToResummon()).toEqual({name: spell.name, source: spell.source});
	});
});
