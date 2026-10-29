import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";

const State = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));

function makeCaster () {
	const state = new State();
	state.setId("original-caster");
	state.setName("Snapshot Caster");
	state.addClass({name: "Wizard", source: "PHB", level: 5, spellcastingAbility: "int"});
	state.addClass({name: "Warlock", source: "PHB", level: 3, spellcastingAbility: "cha"});
	for (const [ability, value] of Object.entries({str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 16})) state.setAbilityBase(ability, value);
	state.recalculateHp({syncCurrent: true});
	state.setSkillProficiency("arcana", 2);
	state.addSaveProficiency("wis");
	state.addNamedModifier({name: "Earned Alertness", type: "initiative", value: 5, enabled: true});
	state.addNamedModifier({name: "Permanent Training", type: "save:all", value: 1, enabled: true});
	state.setSpellcastingAbility("int");
	state.addCantrip({name: "Fire Bolt", source: "PHB", level: 0, sourceClass: "Wizard", sourceClassSource: "PHB"});
	state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard", sourceClassSource: "PHB"}, true);
	state.addSpell({name: "Shield", source: "XPHB", level: 1, sourceClass: "Warlock", sourceClassSource: "PHB"}, true);
	state.addInnateSpell({
		name: "Misty Step",
		source: "PHB",
		level: 2,
		sourceFeature: "Intrinsic Gift",
		grantId: "intrinsic-gift",
		uses: {current: 0, max: 1},
		recharge: "long",
		spellcastingAbility: "cha",
	});
	state.addResource({id: "intrinsic-pool", grantId: "intrinsic-pool", name: "Intrinsic Pool", current: 0, max: 3, recharge: "long"});
	state.setSpellSlots(1, 0, 4);
	state.setSpellSlots(2, 0, 3);
	state.setSpellSlots(3, 0, 2);
	state._data.spellcasting.pactSlots.current = 0;
	state.addFeature({name: "Ice Step", source: "PHB", featureType: "Class", description: "As a bonus action, teleport up to 15 feet to an unoccupied space you can see."});
	return state;
}

function prepare (state, spellSource = "PHB") {
	const result = state.prepareSimulacrumSnapshot({spellSource});
	expect(result).toMatchObject({ok: true});
	return result.companionData;
}

function addSnapshot (state, source = "PHB") {
	const data = prepare(state, source);
	const id = state.addCompanion(data);
	return {id, data, actor: state.hydrateCompanionActor(id).actor};
}

describe("Simulacrum snapshot foundation", () => {
	it("does not call live serialization or reconciling getters, change raw data, catalogs, or global state", () => {
		const state = makeCaster();
		state.addCompanion({name: "Existing Familiar", type: State.COMPANION_TYPES.FAMILIAR});
		state._data.notes.notes = "Do not copy this document";
		state._data.spawn = {spec: "wizard/5"};
		state._data.currency.gp = 1200;
		state._data.features.push({id: "legacy-unparsed", name: "Latent Gift", source: "PHB", description: "You can use this feature twice per long rest."});
		const catalog = [{name: "Shield", source: "PHB", level: 1}];
		state.setSpellData(catalog);
		const before = copy(state._data);
		const spies = ["toJson", "getResources", "getFeatures", "getFeatureCalculations"].map(key => jest.spyOn(state, key).mockImplementation(() => { throw new Error(`Live ${key} called`); }));
		const data = prepare(state);
		expect(state._data).toEqual(before);
		expect(globalThis.__csState).toBe(state);
		expect(catalog).toEqual([{name: "Shield", source: "PHB", level: 1}]);
		expect(data.actorSnapshot.state.id).toBeNull();
		expect(data.actorSnapshot.state.companions).toEqual([]);
		expect(data.actorSnapshot.state.notes.notes).toBe("");
		expect(data.actorSnapshot.state.spawn).toBeNull();
		expect(data.actorSnapshot.state.currency.gp).toBe(0);
		expect(data.actorSnapshot.actorId).not.toBe("original-caster");
		expect(data.actorSnapshot.origin).toEqual({actorId: "original-caster", name: "Snapshot Caster"});
		for (const spy of spies) spy.mockRestore();
	});

	it("tears down equipped armor/shield, weapon, stat-setting, magic, casting and defensive contributions", () => {
		const state = makeCaster();
		state.addResistance("cold");
		state.addItem({name: "Plate", source: "PHB", type: "HA", armor: true, ac: 18}, 1, true);
		state.addItem({name: "Shield", source: "PHB", type: "S", shield: true, ac: 2}, 1, true);
		const weaponId = "gift-sword";
		state.addItem({
			id: weaponId,
			name: "Gift Sword",
			source: "DMG",
			type: "M",
			weapon: true,
			dmg1: "1d8",
			dmgType: "S",
			bonusWeapon: "+3",
			bonusSpellAttack: "+2",
			bonusSpellSaveDc: "+2",
			effects: [
				{type: "ability:str", value: 4}, {type: "resistance:fire", value: 1},
				{type: "save:all", value: 2}, {type: "spellSlots:1", value: 1},
			],
		}, 1, true, true);
		state.setItemAbilityOverrides({static: {int: 22}, bonus: {con: 2}});
		state.setItemBonuses({proficiencyBonus: 1, spellAttack: 2, spellSaveDc: 2, spellDamage: 2, savingThrow: 1, abilityCheck: 1, spellSlots: {3: 1}});
		state.setItemDefenses({resist: ["lightning"], immune: [], vulnerable: [], conditionImmune: ["charmed"]});
		state.setItemSenses({darkvision: 120});
		state.setItemSenseBonuses({darkvision: 60});
		state.setItemGrantedSpells([{name: "Fireball", source: "PHB", itemId: weaponId}]);
		state.addAttack({...state.buildAutoAttackFromWeapon(state.getItemRaw(weaponId)), id: "stored-sword"});
		expect(state.getArmorClass()).toBeGreaterThan(12);
		expect(state.getAbilityScore("str")).toBe(14);
		expect(state.getResistances()).toContain("fire");
		expect(state.getAttacks().some(row => row.name === "Gift Sword")).toBe(true);
		const before = copy(state._data);
		const {id, actor} = addSnapshot(state);
		expect(actor.getInventory()).toEqual([]);
		expect(actor.getArmorClass()).toBe(12);
		expect(actor.getAbilityScore("str")).toBe(10);
		expect(actor.getAbilityScore("int")).toBe(18);
		expect(actor.getAbilityScore("con")).toBe(12);
		expect(actor.getProficiencyBonus()).toBe(3);
		expect(actor.getSpellSaveDc()).toBe(15);
		expect(actor.getSpellAttackBonus()).toBe(7);
		expect(actor.getSaveMod("wis")).toBe(4);
		expect(actor.getSkillMod("arcana")).toBe(10);
		expect(actor.getItemGrantedSpells()).toEqual([]);
		expect(actor.getResistances()).not.toContain("fire");
		expect(actor.getResistances()).toContain("cold");
		expect(actor.getSense("darkvision")).toBe(0);
		expect(actor.getAttacks().some(row => row.name === "Gift Sword")).toBe(false);
		expect(actor.getAttacks().some(row => /unarmed/i.test(row.name))).toBe(true);
		expect(actor.getSpellSlots()[1].max).toBe(4);
		expect(actor.getSpellSlots()[3].max).toBe(2);
		expect(state.getCompanion(id).statblock.action.some(row => row.name === "Gift Sword")).toBe(false);
		expect({...state._data, companions: []}).toEqual({...before, companions: []});
	});

	it("removes item-owned spell/pool rows without erasing overlapping intrinsic grants or permanent earned ability increases", () => {
		const state = makeCaster();
		state.increaseAbility("int", 1, 30);
		const itemId = "gift-stone";
		state.addItem({id: itemId, name: "Gift Stone", source: "DMG"}, 1, true);
		state.addInnateSpell({
			name: "Misty Step",
			source: "PHB",
			level: 2,
			sourceFeature: "Gift Stone",
			grantId: `item:${itemId}`,
			sourceType: "item",
			uses: {current: 0, max: 2},
		});
		state.addResource({id: "item-pool", grantId: `item:${itemId}`, name: "Intrinsic Pool", sourceItemId: itemId, current: 0, max: 2});
		expect(state.getResources().filter(row => row.name === "Intrinsic Pool")).toHaveLength(2);
		const {actor} = addSnapshot(state);
		expect(actor.getAbilityScore("int")).toBe(19);
		expect(actor.getInnateSpells().filter(row => row.name === "Misty Step")).toEqual([
			expect.objectContaining({grantId: "intrinsic-gift", recharge: "long", uses: {current: 1, max: 1}}),
		]);
		expect(actor.getResources().find(row => row.id === "item-pool")).toBeUndefined();
		expect(actor.getResources().find(row => row.id === "intrinsic-pool")).toMatchObject({current: 3, max: 3});
	});

	it("removes nested, bonded, upgraded, socketed, and generated equipment through removeItem", () => {
		const state = makeCaster();
		const [bagId, gemId, itemId] = ["bag", "gem", "bonded-staff"];
		state.addItem({id: bagId, name: "Bag", source: "PHB", containerCapacity: {weight: [30]}});
		state.addItem({id: gemId, name: "Gem", source: "DMG"});
		expect(state.putItemInContainer(gemId, bagId)).toEqual({success: true});
		state.addItem({
			id: itemId,
			name: "Bonded Staff",
			source: "DMG",
			type: "M",
			weapon: true,
			dmg1: "1d6",
			appliedUpgrades: [{name: "Mystic", source: "TGTT", degree: 1}],
			socketedGemstones: [{name: "Ruby", gemInstanceId: "gem-ruby", empowered: true, runtime: {resources: {charges: {current: 0, max: 3}}}}],
			iounBonded: true,
		}, 1, true, true);
		state._data.inventory.find(row => row.id === itemId).item._generatedItemId = "generated-staff";
		const teardown = jest.spyOn(State.prototype, "removeItem");
		const {actor} = addSnapshot(state);
		for (const id of [bagId, gemId, itemId]) expect(teardown).toHaveBeenCalledWith(id);
		expect(actor.getInventory()).toEqual([]);
		expect(actor.getGemstoneResources()).toEqual([]);
		teardown.mockRestore();
	});

	it("removes real armor upgrades and preserves overlapping intrinsic defenses and natural attacks", () => {
		const state = makeCaster();
		state.setCurrency("gp", 1000);
		state.addItem({id: "upgrade-armor", name: "Half Plate", source: "PHB", type: "MA", ac: 15}, 1, true);
		state.applyItemUpgrade("upgrade-armor", {name: "Reinforced", source: "TCAH", upgradeType: ["AU"]}, 200);
		state.addCustomAbility({name: "Intrinsic Fire Ward", effects: [{type: "resistance:fire"}]});
		state.addItem({id: "item-fire-ward", name: "Fire Ward", source: "DMG", effects: [{type: "resistance:fire"}]}, 1, true);
		state.addAttack({name: "Natural Claws", sourceFeature: "Species Claws", damage: "1d4", damageType: "slashing", isMelee: true});
		expect(state.getCritDamageReduction()).toBe(3);
		expect(state.getResistances()).toContain("fire");
		const {actor} = addSnapshot(state);
		expect(actor.getCritDamageReduction()).toBe(0);
		expect(actor.getResistances()).toContain("fire");
		expect(actor.getAttacks().some(row => row.name === "Natural Claws")).toBe(true);
	});

	it("does not regenerate Armorer model equipment during teardown, reads, export, or hydration", () => {
		const state = new State();
		state.setId("armorer-owner");
		state.addClass({name: "Artificer", source: "EFA", level: 3, subclass: {name: "Armorer", shortName: "Armorer", source: "EFA"}});
		state._data.chosenSubfeatures.push({parent: "Armor Model", parentSource: "EFA", parentClass: "Artificer", parentClassSource: "EFA", name: "Guardian", source: "EFA", level: 3});
		state.reconcileEfaArmorerState();
		expect(state.getInventory().some(row => row.item._efaArmorerWeaponId)).toBe(true);
		const {id, actor} = addSnapshot(state);
		for (let cycle = 0; cycle < 2; cycle++) {
			actor.getFeatureCalculations();
			actor.toJson();
			expect(actor.getInventory()).toEqual([]);
		}
		expect(state.commitCompanionActor(id, state.hydrateCompanionActor(id))).toMatchObject({ok: true});
		expect(state.hydrateCompanionActor(id).actor.getInventory()).toEqual([]);
		expect(state.getInventory().some(row => row.item._efaArmorerWeaponId)).toBe(true);
	});

	it("prevents getter/serialization-driven chain regeneration while retaining the source feature", () => {
		const state = new State();
		state.setId("chain-owner");
		state.addClass({name: "Barbarian", source: "TGTT", level: 3, subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"}});
		state.addFeature({name: "Manifest Chains", source: "TGTT", featureType: "Class", description: "You can manifest chains when you rage."});
		state.getFeatureCalculations();
		expect(state.getInventory().some(row => row.item._generatedItemId === State.CHAINED_FURY_CHAIN_ITEM_ID)).toBe(true);
		const {id, actor} = addSnapshot(state);
		for (let cycle = 0; cycle < 3; cycle++) {
			actor.getFeatureCalculations();
			actor.getResources();
			actor.toJson();
			expect(actor.getInventory()).toEqual([]);
		}
		expect(actor.getFeatures().some(row => row.name === "Manifest Chains")).toBe(true);
		expect(state.commitCompanionActor(id, state.hydrateCompanionActor(id))).toMatchObject({ok: true});
		expect(state.hydrateCompanionActor(id).actor.getInventory()).toEqual([]);
		actor.activateState("rage");
		actor.activateState("manifestChains");
		actor.getFeatureCalculations();
		expect(actor.getInventory().some(row => row.item._generatedItemId === State.CHAINED_FURY_CHAIN_ITEM_ID)).toBe(true);
	});

	it("returns to the normal form and removes inherited spells, concentration, temporary HP/attacks and combat toggles", () => {
		const state = makeCaster();
		state.activateState("rage");
		state.activateState("bladesong");
		state.activateWildShape({name: "Bear", abilities: {str: 19, dex: 10, con: 16}, ac: 14, hp: {max: 34}});
		state.addConcentration({name: "Haste", spellName: "Haste", kind: "spell"});
		state.addActiveState("custom", {name: "Haste", active: true, isSpellEffect: true, concentration: true, customEffects: [{type: "bonus", target: "ac", value: 2}]});
		state.addTemporaryAttack({name: "Flame Blade", damage: "3d6", sourceSpell: "Flame Blade"});
		state.grantTempHp(40);
		state.addCondition("poisoned");
		const before = copy(state._data);
		const {actor} = addSnapshot(state);
		expect(actor.isInWildShape()).toBe(false);
		expect(actor.getAbilityScore("str")).toBe(10);
		expect(actor.getArmorClass()).toBe(12);
		expect(actor.getTempHp()).toBe(0);
		expect(actor.isConcentrating()).toBe(false);
		expect(actor._data.activeStates).toEqual([]);
		expect(actor._data.temporaryAttacks).toEqual([]);
		expect(actor._data.conditions).toEqual([]);
		expect({...state._data, companions: []}).toEqual({...before, companions: []});
	});

	it.each(["PHB", "XPHB"])("initializes legitimate ordinary/Pact/innate/limited pools full once for %s and halves odd sanitized HP", source => {
		const state = makeCaster();
		expect(state.getMaxHp()).toBe(45);
		const {data, actor} = addSnapshot(state, source);
		expect(actor.getHp()).toEqual({current: 22, max: 22, temp: 0});
		expect(actor.getSpellSlots()[1]).toMatchObject({current: 4, max: 4});
		expect(actor.getPactSlots()).toMatchObject({current: 2, max: 2, level: 2});
		expect(actor.getInnateSpells()[0].uses.current).toBe(1);
		expect(actor.getResource("intrinsic-pool").current).toBe(3);
		expect(data.statblock.type).toEqual({type: "construct"});
		expect(data.statblock.hp).toEqual({average: 22, formula: "22"});
		expect(data.actorSnapshot.policy.recovery).toBe(source === "PHB" ? "no-slot-recovery" : "no-rests");
		expect(data.actorSnapshot.spell).toEqual({uid: `simulacrum|${source.toLowerCase()}`, source});
		expect(state.getSpellSlots()[1].current).toBe(0);
		expect(state.getPactSlots().current).toBe(0);
	});

	it("recomputes ability-derived limited pools from the item-free build before filling them", () => {
		const state = makeCaster();
		state.setItemAbilityOverrides({static: {int: 24}});
		const abilityId = state.addCustomAbility({
			name: "Mind Gift", mode: "limited", uses: {maxMode: "abilityMod", maxAbility: "int", recharge: "long"},
		});
		expect(state.getCustomAbility(abilityId).uses.max).toBe(7);
		state.getCustomAbility(abilityId).uses.current = 0;
		const {id, actor} = addSnapshot(state);
		expect(actor.getCustomAbility(abilityId).uses).toMatchObject({current: 4, max: 4});
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.getCustomAbility(abilityId).uses.current = 0;
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		expect(state.hydrateCompanionActor(id).actor.getCustomAbility(abilityId).uses.current).toBe(0);
	});

	it("keeps a zero-maximum snapshot terminal rather than silently clamping it healthy", () => {
		const state = new State();
		state.setId("frail-owner");
		state.addClass({name: "Wizard", source: "PHB", level: 1});
		state.setAbilityBase("con", 1);
		const data = prepare(state);
		expect(data.actorSnapshot.lifecycle).toBe("destroyed");
		expect(data.statblock.hp).toEqual({average: 0, formula: "0"});
		const id = state.addCompanion(data);
		expect(state.getCompanion(id).hp.max).toBe(0);
		expect(state.hydrateCompanionActor(id).actor.getMaxHp()).toBe(0);
	});

	it("preserves zero pools without refilling and persists terminal teardown across two real owner save/load cycles", () => {
		let state = makeCaster();
		const {id} = addSnapshot(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setSpellSlots(1, 0, 4);
		hydrated.actor._data.spellcasting.pactSlots.current = 0;
		hydrated.actor.setResourceCurrent("intrinsic-pool", 0);
		hydrated.actor._data.spellcasting.innateSpells[0].uses.current = 0;
		hydrated.actor.addActiveState("custom", {name: "Local Haste", active: true, isSpellEffect: true, customEffects: [{type: "bonus", target: "ac", value: 2}]});
		hydrated.actor.addConcentration({name: "Local Haste", kind: "spell"});
		hydrated.actor.setHp(0);
		expect(state.commitCompanionActor(id, hydrated)).toMatchObject({ok: true, revision: 1});
		for (let cycle = 0; cycle < 2; cycle++) {
			const saved = JSON.stringify(state.toJson());
			state = new State();
			state.loadFromJson(saved);
			const {actor} = state.hydrateCompanionActor(id);
			expect(actor.getSpellSlots()[1].current).toBe(0);
			expect(actor.getPactSlots().current).toBe(0);
			expect(actor.getResource("intrinsic-pool").current).toBe(0);
			expect(actor.getInnateSpells()[0].uses.current).toBe(0);
			expect(actor.getCurrentHp()).toBe(0);
			expect(actor.isConcentrating()).toBe(false);
			expect(actor.getActiveStates()).toEqual([]);
			expect(state.getCompanion(id).actorSnapshot.lifecycle).toBe("destroyed");
			expect(actor._data.companions).toEqual([]);
		}
	});

	it("keeps reduced max HP and local maximum-HP effects consistent through recalculation and reload", () => {
		const state = makeCaster();
		const {id} = addSnapshot(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.addActiveState("custom", {
			name: "Aid",
			sourceFeatureId: "local-aid",
			isSpellEffect: true,
			customEffects: [{type: "hpMaxIncrease", value: 5}],
		});
		hydrated.actor.recalculateHp();
		expect(hydrated.actor.getMaxHp()).toBe(27);
		expect(state.commitCompanionActor(id, hydrated)).toMatchObject({ok: true});
		expect(state.getCompanion(id).hp.max).toBe(27);
		expect(state.getCompanion(id).statblock.hp).toEqual({average: 27, formula: "27"});
		const loaded = new State();
		loaded.loadFromJson(JSON.stringify(state.toJson()));
		const next = loaded.hydrateCompanionActor(id);
		expect(next.actor.getMaxHp()).toBe(27);
		for (const active of [...next.actor._data.activeStates]) next.actor.removeActiveState(active.id);
		next.actor.recalculateHp();
		expect(next.actor.getMaxHp()).toBe(22);
		expect(loaded.commitCompanionActor(id, next).ok).toBe(true);
		expect(loaded.getCompanion(id).hp.max).toBe(22);
	});

	it("initializes source-specific limited counters once, retaining later zero values", () => {
		const state = makeCaster();
		state._data.spellcasting.signatureSpells = [{name: "Fireball", source: "PHB", level: 3, usesCurrent: 0, usesMax: 1, recharge: "short"}];
		state._data.lunarFreeCastsUsed = ["full", "new", "crescent"];
		state._data.efaArtificerTinker.tinkersMagicUsesSpent = 3;
		state._data.cartographerMappingMagic.illuminatedCartographyUses = 1;
		const {id, actor} = addSnapshot(state);
		expect(actor.getSignatureSpells()[0].usesCurrent).toBe(1);
		expect(actor._data.lunarFreeCastsUsed).toEqual([]);
		expect(actor._data.efaArtificerTinker.tinkersMagicUsesSpent).toBe(0);
		expect(actor._data.cartographerMappingMagic.illuminatedCartographyUses).toBe(0);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor._data.spellcasting.signatureSpells[0].usesCurrent = 0;
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		expect(state.hydrateCompanionActor(id).actor.getSignatureSpells()[0].usesCurrent).toBe(0);
		expect(JSON.stringify(state.getCompanion(id).statblock)).toContain("0 free uses remaining");
	});

	it("routes companion damage/temporary HP/conditions into canonical actor state, never summary resource stores", () => {
		const state = makeCaster();
		const {id} = addSnapshot(state);
		expect(state.setCompanionTempHp(id, 4)).toBe(true);
		expect(state.damageCompanion(id, 7)).toMatchObject({hpLost: 3, tempAbsorbed: 4});
		state.addCompanionCondition(id, "poisoned");
		expect(state.hydrateCompanionActor(id).actor.getHp()).toEqual({current: 19, max: 22, temp: 0});
		expect(state.hydrateCompanionActor(id).actor.hasCondition("poisoned")).toBe(true);
		state.removeCompanionCondition(id, "poisoned");
		const record = state.getCompanion(id);
		record.hp.current = 999;
		record.profBonus = 99;
		expect(state.getCompanion(id).hp.current).toBe(19);
		expect(state.getCompanion(id).profBonus).toBe(3);
		expect(state.updateCompanion(id, {hp: {current: 999}})).toBe(false);
	});

	it("does not follow owner PB, levels, equipment, resource spending, or rest", () => {
		const state = makeCaster();
		const {id} = addSnapshot(state);
		const before = copy(state.getCompanion(id).actorSnapshot);
		state.addClass({name: "Wizard", source: "PHB", level: 17});
		state.setAbilityBase("int", 24);
		state.addItem({name: "Future Robe", source: "DMG", bonusSpellSaveDc: "+5"}, 1, true);
		state.recalculateAllCompanions();
		state.onLongRest();
		expect(state.getCompanion(id).actorSnapshot).toEqual(before);
		expect(state.getCompanion(id).profBonus).toBe(3);
		expect(state.getCompanionSaveMod(id, "wis")).toBe(4);
		expect(state.getCompanionSkillMod(id, "arcana")).toBe(10);
		expect(state.getCompanionInitiative(id)).toBe(7);
		expect(state.getCompanionAbilityCheckMod(id, "dex")).toBe(2);
	});

	it("rejects stale commits and underlying build edits without changing the survivor", () => {
		const state = makeCaster();
		const {id} = addSnapshot(state);
		const a = state.hydrateCompanionActor(id);
		const b = state.hydrateCompanionActor(id);
		a.actor.setResourceCurrent("intrinsic-pool", 0);
		expect(state.commitCompanionActor(id, a).ok).toBe(true);
		expect(state.commitCompanionActor(id, b)).toMatchObject({ok: false, reason: "actor-commit-conflict"});
		const fresh = state.hydrateCompanionActor(id);
		fresh.actor.setAbilityBase("int", 20);
		expect(state.commitCompanionActor(id, fresh)).toMatchObject({ok: false, reason: "actor-build-frozen"});
		expect(state.hydrateCompanionActor(id).actor.getResource("intrinsic-pool").current).toBe(0);
	});

	it("retains corrupt envelopes with actionable diagnostics and never falls back to original stats", () => {
		const state = makeCaster();
		const {id} = addSnapshot(state);
		const json = state.toJson();
		json.companions[0].actorSnapshot.state.spellcasting.spellSlots[1].current = null;
		const loaded = new State();
		loaded.loadFromJson(json);
		expect(loaded.getCompanion(id).actorUnavailable).toMatchObject({ok: false, reason: "actor-snapshot-invalid"});
		expect(loaded.hydrateCompanionActor(id).issues).toContainEqual(expect.objectContaining({path: "state.spellcasting.spellSlots.1"}));
		expect(() => loaded.getCompanionSkillMod(id, "arcana")).toThrow("Companion actor unavailable");
		expect(loaded.toJson().companions[0].actorSnapshot).toEqual(json.companions[0].actorSnapshot);
	});

	it.each([
		["version", 99, "actor-version-unsupported"],
		["revision", null, "actor-snapshot-invalid"],
		["policy", {}, "actor-snapshot-invalid"],
		["frozen", {normalMaxHp: 45, level: null, proficiencyBonus: 3}, "actor-snapshot-invalid"],
	])("rejects malformed %s without load-time initialization", (key, value, reason) => {
		const data = prepare(makeCaster());
		data.actorSnapshot[key] = value;
		expect(State.validateCompanionActorSnapshot(data.actorSnapshot)).toMatchObject({ok: false, reason});
	});

	it("fails atomically when export fails and exposes catalog copies only to the detached actor", () => {
		const state = makeCaster();
		state.setSpellData([{name: "Shield", source: "PHB", level: 1}]);
		const {id} = addSnapshot(state);
		const before = copy(state.getCompanion(id));
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor._allSpells[0].name = "Actor-only catalog edit";
		hydrated.actor.setResourceCurrent("intrinsic-pool", 0);
		const exporter = {convertStateToMonster () { throw new Error("Export deliberately unavailable"); }};
		expect(state.commitCompanionActor(id, {...hydrated, exporter})).toMatchObject({
			ok: false,
			reason: "actor-commit-failed",
			issues: [{path: "state", message: "Export deliberately unavailable"}],
		});
		expect(state.getCompanion(id)).toEqual(before);
		expect(state._allSpells[0].name).toBe("Shield");
	});

	it.each([
		["future", "simulacrum-spell-source-required"],
		[null, "simulacrum-spell-source-required"],
	])("rejects unsupported spell source %s before mutation", (spellSource, reason) => {
		const state = makeCaster();
		const before = copy(state._data);
		expect(state.prepareSimulacrumSnapshot({spellSource})).toMatchObject({ok: false, reason});
		expect(state._data).toEqual(before);
	});
});

describe("Companion statblock fidelity", () => {
	it("retains exact numeric saves/skills, PB, initiative, structured defenses/speeds, spellcasting and bonus actions", () => {
		const state = new State();
		const creature = {
			name: "Precise Construct",
			source: "CSHEET",
			type: {type: "construct"},
			size: ["M"],
			hp: {average: 22, formula: "22"},
			ac: [{ac: 12}],
			str: 10,
			dex: 14,
			con: 12,
			int: 18,
			wis: 10,
			cha: 16,
			pbNote: "+3",
			save: {wis: "+4", str: "0"},
			skill: {arcana: "+10", "animal handling": "+5"},
			initiative: {initiative: 7, advantageMode: "adv"},
			speed: {walk: 30, fly: {number: 20, condition: "while hovering"}, canHover: true},
			resist: ["cold", {resist: ["bludgeoning"], note: "from nonmagical attacks"}],
			immune: [{immune: ["fire"], note: "while submerged"}],
			vulnerable: ["thunder"],
			conditionImmune: ["charmed"],
			bonus: [{name: "Ice Step", entries: ["Teleport."]}],
			spellcasting: [{name: "Spellcasting", ability: "int", spells: {1: {slots: 4, spells: ["{@spell shield|PHB}"]}}}],
		};
		const id = state.addCompanionFromBestiary(creature);
		const companion = state.getCompanion(id);
		expect(state.getCompanionSaveMod(id, "wis")).toBe(4);
		expect(state.getCompanionSaveMod(id, "str")).toBe(0);
		expect(state.getCompanionSkillMod(id, "arcana")).toBe(10);
		expect(state.getCompanionSkillMod(id, "animal handling")).toBe(5);
		expect(state.getCompanionInitiative(id)).toBe(7);
		expect(companion.spellcasting).toEqual(creature.spellcasting);
		expect(companion.resistances).toEqual(creature.resist);
		expect(companion.immunities).toEqual(creature.immune);
		expect(companion.vulnerabilities).toEqual(["thunder"]);
		expect(companion.speed.fly).toEqual(creature.speed.fly);
		expect(companion.speed.canHover).toBe(true);
		expect(companion.profBonus).toBe(3);
		expect(companion.statblock).toEqual(creature);
		expect(companion.bonusActions).toEqual(creature.bonus);
	});

	it("preserves nested entries and uncapped custom abilities independently of ordinary compact presentation", () => {
		const state = makeCaster();
		const nested = {type: "list", items: ["A complete nested ability.", {type: "item", name: "Afterward", entry: "Preserve the final clause."}]};
		state._data.features.push({
			id: "nested-feature",
			name: "Nested Feature",
			source: "PHB",
			entries: [nested],
			uses: {current: 0, max: 1, recharge: "long"},
		});
		for (let i = 0; i < 16; i++) {
			state.addCustomAbility({
				name: `Custom Gift ${i}`,
				description: `${"A complete description. ".repeat(40)}Final custom clause ${i}.`,
			});
		}
		const {data} = addSnapshot(state);
		expect(data.statblock.trait.find(row => row.name.startsWith("Nested Feature")).entries).toContainEqual(nested);
		for (let i = 0; i < 16; i++) expect(JSON.stringify(data.statblock)).toContain(`Final custom clause ${i}`);
		const ordinary = CharacterSheetNpcExporter.convertStateToMonster(state, {presentationMode: "compact"});
		expect(JSON.stringify(ordinary)).not.toContain("Final custom clause 15");
		expect(JSON.stringify(CharacterSheetNpcExporter.convertStateToMonster(state))).toContain("Final custom clause 15");
		expect(CharacterSheetNpcExporter.getSanitizedExportOptions({}).profile).toBe("npc");
	});

	it("projects all source-owned pools with spent values and current local defenses", () => {
		const state = makeCaster();
		for (let i = 0; i < 20; i++) state.addResource({id: `gift-pool-${i}`, name: `Gift Pool ${i}`, current: 0, max: 2});
		const {id} = addSnapshot(state);
		const hydrated = state.hydrateCompanionActor(id);
		hydrated.actor.setResourceCurrent("gift-pool-19", 0);
		hydrated.actor.addActiveState("custom", {
			name: "Local Ward",
			sourceFeatureId: "local-ward",
			customEffects: [{type: "resistance", target: "fire"}],
		});
		expect(state.commitCompanionActor(id, hydrated).ok).toBe(true);
		const {statblock} = state.getCompanion(id);
		expect(statblock.resist).toContain("fire");
		expect(JSON.stringify(statblock)).toContain("Gift Pool 19: 0/2 remaining");
		for (let i = 0; i < 19; i++) expect(JSON.stringify(statblock)).toContain(`Gift Pool ${i}: 2/2 remaining`);
	});

	it("keeps every meaningful feature beyond former NPC caps, full descriptions, exact spell editions and separate same-level ordinary/Pact routes", () => {
		const state = makeCaster();
		for (let i = 0; i < 35; i++) {
			state.addFeature({
				name: `Ice Ability ${i}`,
				source: "PHB",
				featureType: "Class",
				description: `As an action, choose a creature. ${"The creature can cross the ice safely. ".repeat(35)}Final meaningful clause ${i}.`,
			});
		}
		const {data} = addSnapshot(state);
		const text = JSON.stringify(data.statblock);
		for (let i = 0; i < 35; i++) {
			expect(text).toContain(`Ice Ability ${i}`);
			expect(text).toContain(`Final meaningful clause ${i}`);
		}
		expect(data.statblock.bonus.some(row => row.name === "Ice Step")).toBe(true);
		expect(data.statblock.save.wis).toBe("+4");
		expect(data.statblock.skill.Arcana ?? data.statblock.skill.arcana).toBe("+10");
		const ordinary = data.statblock.spellcasting.find(row => row.name === "Spellcasting (Wizard)");
		const pact = data.statblock.spellcasting.find(row => row.name === "Pact Magic (Warlock)");
		expect(ordinary.spells[2].slots).toBe(3);
		expect(pact.spells[2].slots).toBe(2);
		expect(text).toContain("{@spell Shield|PHB}");
		expect(text).toContain("{@spell Shield|XPHB}");
		expect(text).not.toContain("regains expended spell slots");
		const normal = CharacterSheetNpcExporter.convertStateToMonster(state, {presentationMode: "compact"});
		expect(normal.name).toBe("Snapshot Caster (NPC)");
		expect(normal.action.filter(row => row.name.startsWith("Ice Ability"))).toHaveLength(35);
	});
});
