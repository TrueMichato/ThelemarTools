/**
 * Canonical weapon projection regressions for Round 61 Session 6.
 *
 * These tests use the real TGTT material/stance data, the real TCAH upgrades,
 * and the real Moorchlyne Ioun Stone #282 rather than lookalike fixtures. The
 * assertions split intrinsic weapon bonuses from external equipment bonuses so
 * a display can never become correct by accidentally counting one source twice.
 */

import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import {CharacterSheetPlayMode} from "../../../js/charactersheet/charactersheet-playmode.js";
import {CharacterSheetPdf} from "../../../js/charactersheet/charactersheet-pdf.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const TGTT = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url)));
const MOORCHLYNE = JSON.parse(fs.readFileSync(new URL("../../../homebrew/Moorchlyne Ioun Stones.json", import.meta.url)));
const ITEM_UPGRADES = JSON.parse(fs.readFileSync(new URL("../../../data/itemupgrades.json", import.meta.url))).itemUpgrade;
const CATALOG_ITEMS = JSON.parse(fs.readFileSync(new URL("../../../data/items.json", import.meta.url))).item;
const BASE_ITEMS = JSON.parse(fs.readFileSync(new URL("../../../data/items-base.json", import.meta.url))).baseitem;

const IounSand = TGTT.itemMaterial.find(it => it.name === "Ioun Sand");
const Obsidian = TGTT.itemMaterial.find(it => it.name === "Obsidian");
const Masterwork = ITEM_UPGRADES.find(it => it.name === "Masterwork");
const Sharpened = ITEM_UPGRADES.find(it => it.name === "Critical: Sharpened");
const Stone282 = MOORCHLYNE.item.find(it => it.name === "Ioun Stone #282, Pale Aquamarine Lozenge");
const PerfectEdge = TGTT.combatMethod.find(it => it.name === "Perfect Edge Stance");
const StrikeTheCracks = TGTT.combatMethod.find(it => it.name === "Strike the Cracks Stance");

const MANIFEST_CHAINS = {
	name: "Manifest Chains",
	source: "TGTT",
	description: "When you rage, you can choose to manifest a pair of spectral chains, connected to your arms.",
};
const GENERATED_CHAIN_ID = "tgtt-chained-fury:spectral-chains";

function addItem (state, item, {equipped = true, attuned = false} = {}) {
	state.addItem(item, 1, equipped);
	const row = state.getItems().slice(-1)[0];
	state.setItemEquipped(row.id, equipped);
	if (attuned) state.setItemAttuned(row.id, true);
	return state.getItems().find(it => it.id === row.id);
}

function getChainItem (state) {
	return state.getItems().find(item => item._generatedItemId === GENERATED_CHAIN_ID);
}

function getChainAttack (state) {
	return state.getFeatureGrantedAttacks().find(attack => attack.sourceItem?._generatedItemId === GENERATED_CHAIN_ID);
}

function makeChainedFury () {
	const state = new CharacterSheetState();
	state.setItemMaterialCatalog(TGTT.itemMaterial);
	state.setAbilityBase("str", 32); // +11
	state.setAbilityBase("dex", 10);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level: 17,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	state.addClass({name: "Fighter", source: "PHB", level: 3}); // total level 20 => PB +6
	state.addFeature(MANIFEST_CHAINS);
	state.activateState("rage");
	state.activateState("manifestChains");
	return state;
}

function equipDoubledStone282 (state) {
	const host = addItem(state, {
		name: "Ioun Sand Torc",
		source: "CUSTOM",
		type: "wondrous",
		wondrous: true,
		material: {name: IounSand.name, source: IounSand.source, quantity: 1},
	});
	const stone = addItem(state, {
		...Stone282,
		requiresAttunement: true,
	}, {attuned: true});

	expect(state.getIounHostPolicy(host)).toMatchObject({
		isHost: true,
		isMatrix: true,
		settings: 1,
		grants: [],
		perStone: 0,
	});
	expect(state.setIounStone(host.id, stone.id)).toEqual({success: true});
	return {
		host: state.getItems().find(it => it.id === host.id),
		stone: state.getItems().find(it => it.id === stone.id),
	};
}

describe("canonical attack projection", () => {
	it("loads the real authored catalogs used by the reported character", () => {
		expect(IounSand).toBeDefined();
		expect(Obsidian).toMatchObject({critical: 1});
		expect(Masterwork).toBeDefined();
		expect(Sharpened).toBeDefined();
		expect(Stone282).toMatchObject({bonusWeaponAttack: "+1"});
		expect(PerfectEdge).toBeDefined();
		expect(StrikeTheCracks).toBeDefined();
	});

	it("reconstructs the exact +22 chains attack without hiding a doubled source", () => {
		const state = makeChainedFury();
		const chainItem = getChainItem(state);
		state.replaceItem(chainItem.id, {...state.getItemRaw(chainItem.id), bonusWeapon: "+2"});
		state.applyItemUpgrade(chainItem.id, Masterwork, 0);
		const {stone} = equipDoubledStone282(state);

		const attack = getChainAttack(state);
		const breakdown = state.getAttackBonusBreakdown(attack);

		expect(state.getAbilityMod("str")).toBe(11);
		expect(state.getProficiencyBonus()).toBe(6);
		expect(stone.bonusWeaponAttack).toBe(2);
		expect(attack.attackBonus).toBe(3); // +2 weapon and +1 Masterwork, intrinsic exactly once
		expect(breakdown).toMatchObject({
			baseAbility: 11,
			effectiveAbility: 11,
			proficiency: 6,
			intrinsicLocal: 3,
			total: 22,
		});
		expect(breakdown.externalItemContributions).toEqual([
			expect.objectContaining({name: Stone282.name, value: 2, axis: "attack"}),
		]);
	});

	it("uses that exact +22 standing total in the real Combat roll pipeline", async () => {
		const state = makeChainedFury();
		const chainItem = getChainItem(state);
		state.replaceItem(chainItem.id, {...state.getItemRaw(chainItem.id), bonusWeapon: "+2"});
		state.applyItemUpgrade(chainItem.id, Masterwork, 0);
		equipDoubledStone282(state);
		const attack = getChainAttack(state);
		const captured = [];
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._cachedAttacks = [attack];
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		combat._page = {
			rollD20: () => ({roll: 10, mode: "normal"}),
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: args => { captured.push(args); return null; },
			getModifierString: value => `${value >= 0 ? "+" : ""}${value}`,
			_offerGuidedStrikePostAttack: () => {},
			saveCharacter: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		await combat._rollAttack(attack.id, null);

		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({modifier: 22, total: 32});
		expect(captured[0].title).toContain(`${Stone282.name} +2`);
	});

	it("reclassifies a Fortune-revised natural roll against the attack-specific threshold", async () => {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {getCriticalRange: () => 19};
		combat._page = {
			_pMaybeApplyFortuneIntervention: async () => ({applied: true, effectiveRoll: 19, note: "Revised"}),
			showDiceResult: () => {},
			formatD20Breakdown: roll => `d20(${roll.roll})`,
		};
		combat.renderAttacks = () => {};
		const ctx = {
			attack: {id: "test", name: "Test Weapon"},
			attackId: "test",
			rollResult: {roll: 1, mode: "normal"},
			rollModifier: 7,
			total: 8,
			isCrit: false,
			isNat20: false,
			isFumble: true,
		};

		await combat._pOfferFortuneIntervention(ctx);

		expect(ctx).toMatchObject({
			total: 26,
			rollResult: {roll: 19},
			isCrit: true,
			isNat20: false,
			isFumble: false,
		});
		expect(ctx.rollFollowup).toMatchObject({naturalRoll: "19"});
	});

	it("renders the Combat row with +22, Crit 17+, and 40 ft. reach", () => {
		const state = makeChainedFury();
		const chainItem = getChainItem(state);
		state.replaceItem(chainItem.id, {...state.getItemRaw(chainItem.id), bonusWeapon: "+2"});
		state.applyItemUpgrade(chainItem.id, Masterwork, 0);
		state.applyItemUpgrade(chainItem.id, Sharpened, 0);
		state.setItemMaterial(chainItem.id, Obsidian);
		state.addFeature(PerfectEdge);
		state.activateStance(PerfectEdge.name);
		state.addNamedModifier({name: "Reach Boon", type: "reach", value: "+10", enabled: true});
		equipDoubledStone282(state);

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {};
		combat._channelCantripsCache = [];
		const attack = getChainAttack(state);
		const row = combat._renderAttackItem(attack, {
			meleeReach: state.getMeleeReach(),
			reachBonus: state.getReachBonus(),
		});

		expect(row.outerHTML).toContain(">+22</span>");
		expect(row.outerHTML).toContain("Crit 17+");
		expect(row.outerHTML).toContain(">40 ft.</span>");
	});

	it("renders the Play Mode row from the same +22 / Crit 17+ / 40 ft. projection", () => {
		const state = makeChainedFury();
		const chainItem = getChainItem(state);
		state.replaceItem(chainItem.id, {...state.getItemRaw(chainItem.id), bonusWeapon: "+2"});
		state.applyItemUpgrade(chainItem.id, Masterwork, 0);
		state.applyItemUpgrade(chainItem.id, Sharpened, 0);
		state.setItemMaterial(chainItem.id, Obsidian);
		state.addFeature(PerfectEdge);
		state.activateStance(PerfectEdge.name);
		state.addNamedModifier({name: "Reach Boon", type: "reach", value: "+10", enabled: true});
		equipDoubledStone282(state);

		const elements = [];
		const playMode = Object.create(CharacterSheetPlayMode.prototype);
		playMode._state = state;
		playMode._page = {};
		playMode._elActionsHub = e_({});
		playMode._makeCard = parent => {
			const card = e_({});
			parent.appendChild(card);
			return card;
		};
		playMode._ce = (tag, className, parent) => {
			const element = e_({tag, clazz: className});
			element.className = className;
			parent?.appendChild(element);
			elements.push(element);
			return element;
		};
		playMode._getEntityNote = () => "";
		playMode._setIcon = () => {};
		playMode._makeClickable = () => {};
		playMode._isFavorite = () => false;

		playMode._renderAttacks();

		const readAll = className => elements
			.filter(it => it.className.split(" ").includes(className))
			.map(it => it.textContent);
		expect(readAll("pm-attack__bonus")).toContain("+22");
		expect(readAll("pm-attack__crit")).toContain("Crit 17+");
		expect(readAll("pm-attack__range")).toContain("40 ft.");
	});

	it("preserves chain composition and the doubled Ioun bonus through rage and level reconciliation", () => {
		const state = makeChainedFury();
		const original = getChainItem(state);
		state.replaceItem(original.id, {...state.getItemRaw(original.id), bonusWeapon: "+2"});
		state.applyItemUpgrade(original.id, Masterwork, 0);
		state.applyItemUpgrade(original.id, Sharpened, 0);
		state.setItemMaterial(original.id, Obsidian);
		const {host, stone} = equipDoubledStone282(state);

		state.deactivateState("rage");
		state._data.classes.find(cls => cls.name === "Barbarian").level = 10;
		state.applyClassFeatureEffects();
		state.activateState("rage");
		state.activateState("manifestChains");

		let item = getChainItem(state);
		let attack = getChainAttack(state);
		expect(item.id).toBe(original.id);
		expect(item.material).toMatchObject({name: Obsidian.name, source: Obsidian.source});
		expect(item.appliedUpgrades.map(it => it.name)).toEqual(expect.arrayContaining([Masterwork.name, Sharpened.name]));
		expect(state.getIounSetStoneIds(host.id)).toEqual([stone.id]);
		expect(state.getItems().find(it => it.id === stone.id).bonusWeaponAttack).toBe(2);
		expect(attack.attackBonus).toBe(3);
		expect(state.getAttackReach(attack)).toBe(25);
		expect(state.getAttackBonusBreakdown(attack).total).toBe(21); // total level 13 => PB +5

		state.deactivateState("rage");
		state._data.classes.find(cls => cls.name === "Barbarian").level = 17;
		state.applyClassFeatureEffects();
		state.activateState("rage");
		state.activateState("manifestChains");

		item = getChainItem(state);
		attack = getChainAttack(state);
		expect(item.id).toBe(original.id);
		expect(item.material).toMatchObject({name: Obsidian.name, source: Obsidian.source});
		expect(item.appliedUpgrades.map(it => it.name)).toEqual(expect.arrayContaining([Masterwork.name, Sharpened.name]));
		expect(state.getItems().find(it => it.id === stone.id).bonusWeaponAttack).toBe(2);
		expect(state.getAttackReach(attack)).toBe(30);
		expect(state.getAttackBonusBreakdown(attack).total).toBe(22);
	});

	it("applies Stone #282 to normal weapons and unarmed strikes with its authored scopes", () => {
		const state = makeChainedFury();
		equipDoubledStone282(state);
		const sword = addItem(state, {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			range: "5 ft.",
		});
		const bow = addItem(state, {
			name: "Longbow",
			source: "PHB",
			type: "R",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "P",
			range: "150/600 ft.",
		});
		const swordAttack = state.buildAutoAttackFromWeapon(sword);
		const bowAttack = state.buildAutoAttackFromWeapon(bow);
		const unarmed = {name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true, abilityMod: "str", attackBonus: 0, damageBonus: 0};

		expect(state.getAttackBonusBreakdown(swordAttack).externalItemContributions).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(state.getAttackBonusBreakdown(bowAttack).externalItemContributions).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(state.getAttackBonusBreakdown(unarmed).externalItemContributions).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(state.getWeaponDisplayDamageBreakdown(swordAttack).externalItemContributions).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(state.getWeaponDisplayDamageBreakdown(unarmed).externalItemContributions).toEqual([
			expect.objectContaining({value: 2}),
		]);
		expect(state.getWeaponDisplayDamageBreakdown(bowAttack).externalItemContributions).toEqual([]);
	});

	it("keeps unarmed-only item bonuses off weapon attacks", () => {
		const state = makeChainedFury();
		addItem(state, {
			name: "+2 Wraps of Unarmed Power",
			source: "XDMG",
			type: "wondrous",
			bonusWeaponAttack: "+2",
			bonusWeaponDamage: "+2",
			entries: ["You gain a +2 bonus to attack rolls and damage rolls made with Unarmed Strikes."],
		});
		const sword = state.buildAutoAttackFromWeapon(addItem(state, {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			range: "5 ft.",
		}));
		const unarmed = {name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true, abilityMod: "str", attackBonus: 0, damageBonus: 0};

		expect(state.getAttackBonusBreakdown(sword).externalItemContributions).toEqual([]);
		expect(state.getWeaponDisplayDamageBreakdown(sword).externalItemContributions).toEqual([]);
		expect(state.getAttackBonusBreakdown(unarmed).externalItemContributions).toEqual([
			expect.objectContaining({name: "+2 Wraps of Unarmed Power", value: 2}),
		]);
		expect(state.getWeaponDisplayDamageBreakdown(unarmed).externalItemContributions).toEqual([
			expect.objectContaining({name: "+2 Wraps of Unarmed Power", value: 2}),
		]);
	});

	it("keeps thrown melee weapons out of reach and ranged-weapon-only bonuses", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 16);
		state.addFeature({name: "Archery", source: "XPHB"});
		state.addClass({name: "Barbarian", source: "PHB", level: 1});
		state.addActiveState("rage");
		const handaxe = state.buildAutoAttackFromWeapon(addItem(state, {
			name: "Handaxe",
			source: "PHB",
			type: "M",
			weapon: true,
			weaponCategory: "simple",
			dmg1: "1d6",
			dmgType: "S",
			range: "20/60 ft.",
			property: ["T"],
		}));

		expect(state.getAttackClassification(handaxe)).toMatchObject({isMelee: true, isRanged: false, isThrown: true});
		expect(state.getAttackReach(handaxe)).toBeNull();
		expect(state.getAttackBonusBreakdown(handaxe).passiveFeatureContributions).toEqual([]);
		expect(state.getWeaponDisplayDamageBreakdown(handaxe).rage).toBe(0);
	});

	it("removes and restores the doubled Stone #282 contribution across unset, stow, and unbond", () => {
		const state = makeChainedFury();
		const {host, stone} = equipDoubledStone282(state);
		const attack = getChainAttack(state);
		const contribution = () => state.getAttackBonusBreakdown(getChainAttack(state)).externalItemContributions
			.find(it => it.name === Stone282.name)?.value || 0;
		const readStone = () => state.getItems().find(it => it.id === stone.id);

		expect(contribution()).toBe(2);
		expect(state.unsetIounStone(host.id, stone.id)).toEqual({success: true});
		expect(readStone().bonusWeaponAttack).toBe(1);
		expect(contribution()).toBe(0);

		state.setItemEquipped(stone.id, true);
		expect(state.setIounStone(host.id, stone.id)).toEqual({success: true});
		expect(readStone().bonusWeaponAttack).toBe(2);
		expect(contribution()).toBe(2);

		state.setItemEquipped(stone.id, false);
		expect(state.getIounSetStoneIds(host.id)).toEqual([]);
		expect(readStone().bonusWeaponAttack).toBe(1);
		expect(contribution()).toBe(0);

		state.setItemEquipped(stone.id, true);
		expect(state.setIounStone(host.id, stone.id)).toEqual({success: true});
		state.setItemAttuned(stone.id, false);
		expect(state.getIounSetStoneIds(host.id)).toEqual([]);
		expect(readStone().bonusWeaponAttack).toBe(1);
		expect(contribution()).toBe(0);
		expect(attack.sourceItem.id).toBe(getChainAttack(state).sourceItem.id);
	});

	it("does not count a dual-authored item through both effects[] and structured fields", () => {
		const state = makeChainedFury();
		addItem(state, {
			name: "Paired Accuracy Charm",
			source: "CUSTOM",
			type: "wondrous",
			bonusWeaponAttack: "+1",
			entries: ["You gain a +1 bonus to attack rolls with every weapon."],
			effects: [{type: "attack", value: 1}],
		});
		const chain = getChainAttack(state);
		const breakdown = state.getAttackBonusBreakdown(chain);
		const named = breakdown.passiveFeatureContributions.filter(it => it.name.includes("Paired Accuracy Charm"));
		const external = breakdown.externalItemContributions.filter(it => it.name === "Paired Accuracy Charm");

		expect(named.length + external.length).toBe(1);
		expect([...named, ...external][0].value).toBe(1);
	});

	it("never treats another equipped magic weapon as a character-wide bonus", () => {
		const state = makeChainedFury();
		addItem(state, {
			name: "+3 Longsword",
			source: "CUSTOM",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			bonusWeapon: "+3",
		});

		expect(state.getAttackBonusBreakdown(getChainAttack(state)).externalItemContributions).toEqual([]);
	});
});

describe("attack-specific critical projection", () => {
	function prepareCriticalState (stance) {
		const state = makeChainedFury();
		const chainItem = getChainItem(state);
		state.applyItemUpgrade(chainItem.id, Sharpened, 0);
		state.setItemMaterial(chainItem.id, Obsidian);
		if (stance) {
			state.addFeature(stance);
			expect(state.activateStance(stance.name)).toBe(true);
		}
		return state;
	}

	it("stacks Sharpened and a critical material on only the source weapon", () => {
		const state = prepareCriticalState();
		const chain = getChainAttack(state);
		const sword = state.buildAutoAttackFromWeapon(addItem(state, {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			range: "5 ft.",
		}));

		expect(state.getEffectiveItemBonuses(chain.sourceItem.id).critThreshold).toBe(18);
		expect(state.getCriticalRange({attack: chain})).toBe(18);
		expect(state.getCriticalRange({attack: sword})).toBe(20);
	});

	it("Perfect Edge expands the improved chains to 17 but gives a normal weapon 18", () => {
		const state = prepareCriticalState(PerfectEdge);
		const chain = getChainAttack(state);
		const sword = state.buildAutoAttackFromWeapon(addItem(state, {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmgType: "S",
			range: "5 ft.",
		}));

		expect(state.getCriticalRange({attack: chain})).toBe(17);
		expect(state.getCriticalRange({attack: sword})).toBe(18);
		expect(state.getCriticalRange({attack: {...chain, sourceItem: null, critThreshold: 17}})).toBe(17);
	});

	it("Strike the Cracks affects melee weapons only and never leaks to thrown attacks", () => {
		const state = prepareCriticalState(StrikeTheCracks);
		const chain = getChainAttack(state);
		const thrown = {
			name: "Handaxe",
			isMelee: true,
			isThrown: true,
			range: "20/60 ft.",
			abilityMod: "str",
			attackBonus: 0,
		};
		const unarmed = {name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true, abilityMod: "str", attackBonus: 0};

		expect(state.getCriticalRange({attack: chain})).toBe(17);
		expect(state.getCriticalRange({attack: thrown})).toBe(20);
		expect(state.getCriticalRange({attack: unarmed, kind: "unarmed"})).toBe(20);
	});
});

describe("item bonus scope across attack kinds", () => {
	it("keeps equipped melee reach off ranged spells in state, Combat, Play Mode, and PDF", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const charm = addItem(state, {
			name: "Reach Charm",
			source: "Custom",
			type: "wondrous",
			effects: [{type: "reach", value: 5}],
		});
		const sword = addItem(state, BASE_ITEMS.find(item => item.name === "Longsword" && item.source === "PHB"));
		const melee = state.buildAutoAttackFromWeapon(sword);
		const spell = {
			name: "Ray of Frost",
			isSpell: true,
			isRanged: true,
			abilityMod: "spellcasting",
			range: "60 ft.",
			damage: "1d8",
			damageType: "cold",
			attackBonus: 0,
			damageBonus: 0,
		};
		state.addAttack(spell);
		const spellAttack = state.getAttacks().find(attack => attack.name === spell.name);

		expect(state.getAttackRangeProjection(melee).display).toBe("10 ft.");
		expect(state.getAttackClassification(spellAttack).kind).toBe("spell");
		expect(state.getAttackReach(spellAttack)).toBeNull();
		expect(state.getAttackRangeProjection(spellAttack).display).toBe("60 ft.");
		const touchSpell = {...spellAttack, isMelee: true, isRanged: false, range: "Touch"};
		expect(state.getAttackReach(touchSpell)).toBeNull();
		expect(state.getAttackRangeProjection(touchSpell).display).toBe("Touch");

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {};
		combat._channelCantripsCache = [];
		const row = combat._renderAttackItem(spellAttack, {meleeReach: state.getMeleeReach()});
		expect(row.outerHTML).toContain("60 ft.");
		expect(row.outerHTML).not.toContain("10 ft.");

		const elements = [];
		const playMode = Object.create(CharacterSheetPlayMode.prototype);
		playMode._state = state;
		playMode._page = {};
		playMode._elActionsHub = e_({});
		playMode._makeCard = parent => {
			const card = e_({});
			parent.appendChild(card);
			return card;
		};
		playMode._ce = (tag, className, parent) => {
			const element = e_({tag, clazz: className});
			element.className = className;
			parent?.appendChild(element);
			elements.push(element);
			return element;
		};
		playMode._getEntityNote = () => "";
		playMode._setIcon = () => {};
		playMode._makeClickable = () => {};
		playMode._isFavorite = () => false;
		playMode._renderAttacks();
		expect(elements.filter(el => el.className === "pm-attack__range").map(el => el.textContent))
			.toEqual(expect.arrayContaining(["10 ft.", "60 ft."]));

		const pdf = new CharacterSheetPdf(state)._renderAttacks();
		expect(pdf).toMatch(/Ray of Frost<\/td>[\s\S]*?<td class="pdf-atk__range">60 ft\.<\/td>/);

		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(restored.getAttackRangeProjection(restored.getAttacks().find(attack => attack.name === spell.name)).display).toBe("60 ft.");
		restored.setItemEquipped(charm.id, false);
		expect(restored.getAttackRangeProjection(restored.buildAutoAttackFromWeapon(restored.getItems().find(item => item.id === sword.id))).display).toBe("5 ft.");
		expect(restored.getAttackRangeProjection(restored.getAttacks().find(attack => attack.name === spell.name)).display).toBe("60 ft.");
	});

	it("keeps a catalog weapon's crit, to-hit, and damage on its own attack and roll after save/load", async () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 18);
		const kas = addItem(state, CATALOG_ITEMS.find(item => item.name === "Sword of Kas" && item.source === "XDMG"), {attuned: true});
		const plain = addItem(state, BASE_ITEMS.find(item => item.name === "Longsword" && item.source === "PHB"));
		const thrown = addItem(state, BASE_ITEMS.find(item => item.name === "Handaxe" && item.source === "PHB"));
		const attacks = () => [
			state.buildAutoAttackFromWeapon(state.getItems().find(item => item.id === kas.id)),
			state.buildAutoAttackFromWeapon(state.getItems().find(item => item.id === plain.id)),
			state.buildAutoAttackFromWeapon(state.getItems().find(item => item.id === thrown.id)),
			{name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true, abilityMod: "str", attackBonus: 0, damageBonus: 0},
			{name: "Ray of Frost", isSpell: true, isRanged: true, range: "60 ft.", abilityMod: "spellcasting", attackBonus: 0, damageBonus: 0},
		];
		const check = current => {
			const handaxe = current[2];
			expect(current.map(attack => state.getCriticalRange({attack}))).toEqual([19, 20, 20, 20, 20]);
			expect(current.map(attack => state.getAttackBonusBreakdown(attack).intrinsicLocal)).toEqual([3, 0, 0, 0, 0]);
			expect(current.map(attack => state.getWeaponDisplayDamageBonus(attack))).toEqual([3, 0, 0, 0, 0]);
			expect(state.getAttackRangeProjection(handaxe).display).toBe(handaxe.range);
			expect(state.getLegacyCriticalRangeReadCount()).toBe(0);
		};
		check(attacks());
		const [enhanced, normal, handaxe, unarmed, spell] = attacks();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._cachedAttacks = [enhanced, normal, handaxe, unarmed, spell];
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		combat._channelCantripsCache = [];
		const shown = [];
		combat._page = {
			rollD20: () => ({roll: 19, mode: "normal"}),
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: result => { shown.push(result); return null; },
			getModifierString: value => `${value >= 0 ? "+" : ""}${value}`,
			saveCharacter: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};
		const preview = attack => combat._renderAttackItem(attack, {meleeReach: state.getMeleeReach()}).outerHTML;
		expect(preview(enhanced)).toContain("Crit 19+");
		for (const attack of [normal, handaxe, unarmed, spell]) expect(preview(attack)).not.toContain("Crit 19+");
		for (const attack of [enhanced, normal, handaxe, unarmed, spell]) {
			await combat._rollAttack(attack.id, null);
		}
		expect(shown.map(result => result.resultNote)).toEqual(["Critical Hit!", "", "", "", ""]);
		expect(shown.slice(0, 3).map(result => result.modifier)).toEqual([10, 7, 7]);
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = state;
		spells._page = combat._page;
		spells._rollSpellsTabAttack(null, "Wizard", 6);
		expect(shown.at(-1)).toMatchObject({resultNote: "", roll: 19});
		expect(state.getLegacyCriticalRangeReadCount()).toBe(0);

		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(restored.getItems().find(item => item.id === kas.id).critThreshold).toBe(19);
		const restoredAttacks = [kas.id, plain.id, thrown.id].map(id =>
			restored.buildAutoAttackFromWeapon(restored.getItems().find(item => item.id === id)));
		expect([
			...restoredAttacks,
			{name: "Unarmed Strike", isMelee: true, isUnarmedStrike: true},
			{name: "Ray of Frost", isSpell: true, isRanged: true, range: "60 ft."},
		].map(attack => restored.getCriticalRange({attack}))).toEqual([19, 20, 20, 20, 20]);
		restored.setItemEquipped(kas.id, false);
		expect(restored.getItems().find(item => item.id === plain.id).equipped).toBe(true);
		expect(restored.getCriticalRange({attack: restoredAttacks[1]})).toBe(20);
		expect(restored.getAttackBonusBreakdown(restoredAttacks[1]).intrinsicLocal).toBe(0);
	});
});

describe("ability substitution is a choice, not an additive bonus", () => {
	function makeState () {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "TGTT", level: 10});
		state.addClass({name: "Wizard",
			source: "XPHB",
			level: 3,
			subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "FRHoF"}});
		state.addWeaponProficiency("Longsword");
		state.setAbilityBase("str", 14); // +2
		state.setAbilityBase("int", 18); // +4
		state.setAbilityBase("cha", 20); // +5
		state.addFeature({name: "Lies", source: "TGTT", optionalFeatureTypes: ["IllMastery"]});
		state.setLiesWeaponType("Longsword");
		return state;
	}

	const attack = {name: "Longsword",
		isMelee: true,
		abilityMod: "str",
		attackBonus: 0,
		sourceItem: {name: "Longsword", type: "M", weapon: true, weaponCategory: "martial"}};

	it("uses base, Bladesong, Lies, and both with max-not-sum semantics", () => {
		const state = makeState();
		expect(state.getAttackAbilityBreakdown(attack)).toMatchObject({base: 2, total: 5, substitution: {name: "Lies", value: 3}});

		state.activateState("bladesong");
		expect(state.getAttackAbilityBreakdown(attack)).toMatchObject({base: 2, total: 5, substitution: {name: "Lies", value: 3}});

		state.setAbilityBase("cha", 16); // +3; Bladesong's INT +4 now wins
		expect(state.getAttackAbilityBreakdown(attack)).toMatchObject({base: 2, total: 4, substitution: {name: "Bladesong", value: 2}});
		expect(state.getAttackAbilityBreakdown(attack, {includeActiveStates: false})).toMatchObject({
			base: 2,
			total: 3,
			substitution: {name: "Lies", value: 1},
		});
	});

	describe("combat effect rendering", () => {
		let savedDocument;

		beforeEach(() => {
			savedDocument = globalThis.document;
		});

		afterEach(() => {
			globalThis.document = savedDocument;
		});

		it("renders an empty new-character effect panel without reading a stale critical variable", () => {
			const state = new CharacterSheetState();
			const container = globalThis.e_({outer: "<div></div>"});
			globalThis.document = {
				getElementById: id => id === "charsheet-combat-effects" ? container : null,
				querySelector: () => null,
				querySelectorAll: () => [],
				addEventListener: () => {},
				removeEventListener: () => {},
			};
			const combat = new CharacterSheetCombat({
				getState: () => state,
				getNotes: () => null,
			});

			expect(() => combat.renderCombatEffects()).not.toThrow();
			expect(container.innerHTML).toContain("No active effects");
		});
	});
});
