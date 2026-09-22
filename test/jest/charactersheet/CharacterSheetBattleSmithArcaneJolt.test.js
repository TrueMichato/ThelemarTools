import {jest} from "@jest/globals";
import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const ARCANE_JOLT_UID = "Arcane Jolt|Artificer|EFA|Battle Smith|EFA|9|EFA";
const EFA_STEEL_DEFENDER_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_STEEL_DEFENDER_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const REANIMATOR_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const CHARACTER_SHEET_PAGE_SOURCE = fs.readFileSync(new URL("../../../js/charactersheet/charactersheet.js", import.meta.url), "utf8");

const getOwnerClass = ({
	source = "EFA",
	level = 9,
	subclassName = "Battle Smith",
	subclassSource = source,
} = {}) => ({
	name: "Artificer",
	source,
	level,
	subclass: {
		name: subclassName,
		shortName: subclassName,
		source: subclassSource,
	},
});

const getState = ({
	level = 9,
	intelligence = 18,
	source = "EFA",
	subclassName = "Battle Smith",
	subclassSource = source,
	hp = {max: 50, current: 20, temp: 0},
	resources = [],
	companions = [],
} = {}) => {
	const state = new CharacterSheetState();
	state.loadFromJson({
		name: "Jolter",
		abilities: {str: 10, dex: 10, con: 10, int: intelligence, wis: 10, cha: 10},
		classes: [getOwnerClass({source, level, subclassName, subclassSource})],
		hp,
		resources,
		companions,
	});
	return state;
};

const getJoltResource = state => state.getResources().find(resource => resource.featureUid === ARCANE_JOLT_UID);

const addWeapon = (state, {
	id = `weapon-${Math.random()}`,
	name = "Jolt Blade",
	source = "EFA",
	rarity = "uncommon",
	...overrides
} = {}) => {
	state.addItem({
		id,
		name,
		source,
		type: "M",
		weapon: true,
		rarity,
		dmg1: "1d8",
		dmgType: "S",
		_isCustom: true,
		...overrides,
	}, 1, true, false);
	return state.getItemRaw(id);
};

const getAttack = item => ({
	id: `auto_${item.id}`,
	name: item.name,
	isMelee: true,
	isSpell: false,
	sourceItem: {
		id: item.id,
		name: item.name,
		source: item.source,
	},
});

const getSummonerTrigger = attack => ({
	type: "summonerMagicWeaponHit",
	hitConfirmed: true,
	attack,
});

const addEfaDefender = (state, {
	featureUid = EFA_STEEL_DEFENDER_UID,
	source = "EFA",
	hp = {max: 50, current: 30, temp: 0},
	lifecycle = {status: "alive"},
	active = true,
} = {}) => {
	const companionId = state.addCompanion({
		name: "Steel Defender",
		source,
		type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
		origin: "Battle Smith",
		creatureType: "construct",
		hp,
		active,
		featureGrant: {uid: featureUid},
		uses: {repair: {current: 3, max: 3, recharge: "longRest"}},
		hitDice: {die: "d8", current: 4, max: 9},
		lifecycle,
	});
	if (featureUid === EFA_STEEL_DEFENDER_UID) {
		state.reconcileFeatureOwnedCompanion(companionId, {
			summonerContext: state.getFeatureCompanionSummonerContext(featureUid),
		});
	}
	return companionId;
};

const useRend = (state, companionId, {
	hitConfirmed = true,
	attackD20 = 14,
	damageDie = 6,
} = {}) => state.commandCompanionAction({
	companionId,
	actionKey: "forceEmpoweredRend",
	commandMethod: "bonusAction",
	target: {name: "Training Dummy"},
	rangeConfirmed: true,
	hitConfirmed,
	rolls: {attackD20, damageDie},
});

describe("EFA Battle Smith Arcane Jolt resource ownership", () => {
	test("uses max(1, INT modifier) and preserves absolute spent uses across max changes, load, and repeated reads", () => {
		const minimum = getState({intelligence: 10});
		expect(getJoltResource(minimum)).toMatchObject({current: 1, max: 1, recharge: "long", spentUses: 0});

		const state = getState({intelligence: 20});
		const resource = getJoltResource(state);
		state.setResourceCurrent(resource.id, 2);
		expect(getJoltResource(state)).toMatchObject({current: 2, max: 5, spentUses: 3});
		expect(state.getEfaArcaneJoltStatus().resource.current).toBe(2);
		expect(state.getEfaArcaneJoltStatus().resource.current).toBe(2);

		state.setAbilityBase("int", 14);
		expect(getJoltResource(state)).toMatchObject({current: 0, max: 2, spentUses: 3});
		state.setAbilityBase("int", 20);
		expect(getJoltResource(state)).toMatchObject({current: 2, max: 5, spentUses: 3});

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(getJoltResource(restored)).toMatchObject({current: 2, max: 5, spentUses: 3});
	});

	test("adopts one legacy exact feature pool once without granting free uses", () => {
		const featureId = "legacy-jolt-feature";
		const state = getState({
			level: 8,
			intelligence: 20,
			resources: [{
				id: "legacy-jolt-resource",
				name: "Arcane Jolt",
				current: 1,
				max: 4,
				recharge: "long",
				featureId,
			}],
		});
		state._data.features.push({
			id: featureId,
			name: "Arcane Jolt",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Battle Smith",
			subclassSource: "EFA",
			level: 9,
		});
		state._data.classes[0].level = 9;
		delete state._data.migrationFlags.efaArcaneJoltResourceV1;
		state._migrateEfaArcaneJoltResource();

		expect(getJoltResource(state)).toMatchObject({
			id: "legacy-jolt-resource",
			current: 2,
			max: 5,
			spentUses: 3,
			classUid: "Artificer|EFA",
			subclassUid: "Battle Smith|Artificer|EFA|EFA",
		});
		expect(state.getResources().filter(resource => resource.featureUid === ARCANE_JOLT_UID)).toHaveLength(1);
	});

	test("preserves absolute spent uses through the Respec candidate and apply path", async () => {
		const state = getState({level: 15, intelligence: 20});
		const resource = getJoltResource(state);
		state.setResourceCurrent(resource.id, 3);
		const page = {
			getClasses: () => [{
				name: "Artificer",
				source: "EFA",
				hd: {number: 1, faces: 8},
				classFeatures: [],
			}],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			saveCharacter: jest.fn(async () => {}),
			renderCharacter: jest.fn(),
		};
		const engine = new CharacterSheetRespecEngine({page, state});
		engine.begin();
		await engine.stageCandidateMutation(({state: candidate}) => {
			candidate._data.abilities.int = 16;
			candidate.applyClassFeatureEffects();
		});
		expect(getJoltResource(engine.state)).toMatchObject({current: 1, max: 3, spentUses: 2});
		jest.spyOn(engine, "getValidation").mockReturnValue({isValid: true, errors: []});
		await engine.apply();
		expect(getJoltResource(state)).toMatchObject({current: 1, max: 3, spentUses: 2});
	});

	test("level-down/source loss prunes only the exact EFA pool and receipt", async () => {
		const state = getState({intelligence: 18});
		const weapon = addWeapon(state);
		state._data.resources.push(
			{id: "tce-jolt", name: "Arcane Jolt", current: 1, max: 2, classUid: "Artificer|TCE", subclassUid: "Battle Smith|Artificer|TCE|TCE"},
			{id: "rhw-jolt", name: "Arcane Jolt", current: 1, max: 1, classUid: "Artificer|EFA", subclassUid: "Reanimator|Artificer|EFA|RHW"},
		);
		state.commitTurnReceipt({
			key: "feature-companion:unrelated",
			ownerUid: EFA_STEEL_DEFENDER_UID,
			sourceUid: "Steel Defender|EFA",
			actionUid: "Companion Action|Steel Defender|EFA|unrelated",
		});
		await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "destructive",
			target: {type: "attackTarget", name: "Dummy"},
			rolls: {effectDice: 7},
		});

		state._data.classes[0].level = 8;
		state.getResources();
		expect(getJoltResource(state)).toBeUndefined();
		expect(state._data.resources.find(resource => resource.id === "tce-jolt")).toBeTruthy();
		expect(state._data.resources.find(resource => resource.id === "rhw-jolt")).toBeTruthy();
		expect(state.queryTurnReceipt("feature-companion:unrelated").used).toBe(true);
		expect(state.queryTurnReceipt(state._getEfaArcaneJoltTurnReceiptDescriptor().key).used).toBe(false);
	});
});

describe("Arcane Jolt summoner magic-weapon trigger", () => {
	test("requires a confirmed hit with a live canonically classified magic weapon", async () => {
		const state = getState();
		const magicWeapon = addWeapon(state);
		const attack = getAttack(magicWeapon);
		expect(state.canOfferEfaArcaneJoltForAttack(attack)).toBe(true);

		const result = await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(attack),
			effect: "destructive",
			target: {type: "attackTarget", name: "Ogre"},
			rolls: {effectDice: 8},
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			effect: "destructive",
			trigger: {type: "summonerMagicWeaponHit", sourceItemId: magicWeapon.id},
			damage: {
				amount: 8,
				dice: "2d6",
				type: "force",
				target: {type: "attackTarget", name: "Ogre"},
			},
			resource: {cost: 1, before: 4, after: 3, max: 4},
		});
	});

	test("rejects misses, spells, mundane/stale items, and malformed or wrong-owner generated provenance", async () => {
		const state = getState();
		const mundane = addWeapon(state, {id: "mundane", rarity: "none"});
		const magic = addWeapon(state, {id: "magic"});
		expect(state.canOfferEfaArcaneJoltForAttack(getAttack(mundane))).toBe(false);
		expect(state.canOfferEfaArcaneJoltForAttack({...getAttack(magic), isSpell: true})).toBe(false);

		const missed = await state.pUseEfaArcaneJolt({
			trigger: {...getSummonerTrigger(getAttack(magic)), hitConfirmed: false},
			effect: "destructive",
			target: {type: "attackTarget", name: "Dummy"},
			rolls: {effectDice: 7},
		});
		expect(missed).toMatchObject({ok: false, committed: false, reason: "attackNotHit"});
		expect(getJoltResource(state).current).toBe(4);

		state.removeItem(magic.id);
		expect(state.canOfferEfaArcaneJoltForAttack(getAttack(magic))).toBe(false);

		addWeapon(state, {
			id: "malformed-generated",
			name: "Malformed Generated Blade",
			rarity: "legendary",
			_isCustom: true,
			_isGeneratedFeatureItem: true,
			_generatedItemId: "malformed-generated-id",
			_generatedItemProvenance: {version: 1, owner: null},
		});
		expect(state.canOfferEfaArcaneJoltForAttack(getAttack(state.getItemRaw("malformed-generated")))).toBe(false);

		const wrongOwner = state.createGeneratedFeatureItem({
			item: {name: "Wrong Owner Blade", source: "EFA", type: "M", weapon: true, rarity: "legendary"},
			owner: {
				featureUid: "Other Feature|Artificer|EFA|9",
				classUid: "Artificer|EFA",
				subclassUid: null,
				featureSource: "EFA",
			},
		});
		expect(state.canOfferEfaArcaneJoltForAttack(getAttack(state.getItemRaw(wrongOwner.itemId)))).toBe(false);
	});

	test("accepts only live exact Replicate Magic Item provenance among generated weapons", () => {
		const state = getState();
		const replicated = state.createGeneratedFeatureItem({
			item: {name: "Replicated Moon-Touched Sword", source: "EFA", type: "M", weapon: true, rarity: "common"},
			owner: CharacterSheetState.EFA_REPLICATE_MAGIC_ITEM_OWNER,
		});
		const attack = getAttack(state.getItemRaw(replicated.itemId));
		expect(state.canOfferEfaArcaneJoltForAttack(attack)).toBe(true);

		state._data.inventory.find(row => row.id === replicated.itemId).item._generatedItemProvenance.version = 999;
		expect(state.canOfferEfaArcaneJoltForAttack(attack)).toBe(false);
	});
});

describe("Arcane Jolt Steel Defender trigger and shared receipt", () => {
	test("accepts only the exact live EFA defender's committed hit-confirmed Rend", async () => {
		const state = getState();
		const companionId = addEfaDefender(state);
		const rend = useRend(state, companionId);
		const result = await state.pUseEfaArcaneJolt({
			trigger: {type: "steelDefenderRend", operationResult: rend},
			effect: "destructive",
			target: {type: "attackTarget", name: "Training Dummy"},
			rolls: {effectDice: 6},
		});
		expect(result).toMatchObject({
			ok: true,
			trigger: {
				type: "steelDefenderRend",
				companionId,
				operationUid: "Force-Empowered Rend|Steel Defender|EFA",
			},
			damage: {amount: 6, type: "force"},
		});
	});

	test("rejects missed, failed, uncommitted, TCE, inactive, dead, and wrong-owner defender results without spending", async () => {
		const state = getState();
		const companionId = addEfaDefender(state);
		const miss = useRend(state, companionId, {hitConfirmed: false});
		const before = getJoltResource(state).current;
		for (const operationResult of [
			miss,
			{...miss, ok: false, committed: false},
			{...miss, ok: true, committed: false, rolls: {...miss.rolls, attack: {...miss.rolls.attack, hitConfirmed: true}, damage: {total: 5}}},
			{...miss, ok: true, committed: true, ownerUid: TCE_STEEL_DEFENDER_UID, sourceUid: "Steel Defender|TCE", operationUid: "Force-Empowered Rend|Steel Defender|TCE", rolls: {...miss.rolls, attack: {...miss.rolls.attack, hitConfirmed: true}, damage: {total: 5}}},
		]) {
			const rejected = await state.pUseEfaArcaneJolt({
				trigger: {type: "steelDefenderRend", operationResult},
				effect: "destructive",
				target: {type: "attackTarget", name: "Training Dummy"},
				rolls: {effectDice: 7},
			});
			expect(rejected.ok).toBe(false);
			expect(rejected.committed).toBe(false);
		}
		expect(getJoltResource(state).current).toBe(before);

		const committedHit = {
			...miss,
			ok: true,
			committed: true,
			rolls: {...miss.rolls, attack: {...miss.rolls.attack, hitConfirmed: true}, damage: {total: 5}},
		};
		state.getCompanion(companionId).active = false;
		expect(state.getEfaArcaneJoltTriggerStatus({type: "steelDefenderRend", operationResult: committedHit}).reason).toBe("defenderInactive");
		state.getCompanion(companionId).active = true;
		state.getCompanion(companionId).lifecycle.status = "dead";
		expect(state.getEfaArcaneJoltTriggerStatus({type: "steelDefenderRend", operationResult: committedHit}).reason).toBe("defenderInactive");
		state.getCompanion(companionId).lifecycle.status = "alive";
		state.getCompanion(companionId).featureGrant.uid = REANIMATOR_UID;
		expect(state.getEfaArcaneJoltTriggerStatus({type: "steelDefenderRend", operationResult: committedHit}).reason).toBe("defenderUnavailable");
	});

	test("shares one receipt across summoner and defender triggers until resetTurnEconomy, not combatRound", async () => {
		const state = getState();
		const weapon = addWeapon(state);
		const companionId = addEfaDefender(state);
		const rend = useRend(state, companionId);
		const player = await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "destructive",
			target: {type: "attackTarget", name: "Dummy"},
			rolls: {effectDice: 7},
		});
		expect(player.ok).toBe(true);

		state._data.combatRound = 99;
		const blocked = await state.pUseEfaArcaneJolt({
			trigger: {type: "steelDefenderRend", operationResult: rend},
			effect: "destructive",
			target: {type: "attackTarget", name: "Training Dummy"},
			rolls: {effectDice: 8},
		});
		expect(blocked).toMatchObject({ok: false, committed: false, reason: "alreadyUsedThisTurn"});
		expect(getJoltResource(state).current).toBe(3);

		state.resetTurnEconomy();
		const defender = await state.pUseEfaArcaneJolt({
			trigger: {type: "steelDefenderRend", operationResult: rend},
			effect: "destructive",
			target: {type: "attackTarget", name: "Training Dummy"},
			rolls: {effectDice: 8},
		});
		expect(defender).toMatchObject({ok: true, committed: true, resource: {after: 2}});
	});
});

describe("Arcane Jolt target preflight, effects, and rollback", () => {
	test("cancellation and invalid restorative acknowledgements are complete no-ops", async () => {
		const state = getState();
		const weapon = addWeapon(state);
		const trigger = getSummonerTrigger(getAttack(weapon));
		const resource = getJoltResource(state);
		const beforeUses = resource.current;
		const before = state.toJson();
		const cancelled = await state.pUseEfaArcaneJolt({trigger, effect: "restorative", cancelled: true});
		expect(cancelled).toMatchObject({ok: false, committed: false, reason: "cancelled"});
		expect(state.toJson()).toEqual(before);

		for (const target of [
			{type: "character", visible: false, distanceFeet: 10},
			{type: "character", visible: true, distanceFeet: 31},
			{type: "external", kind: "vehicle", name: "Cart", visible: true, distanceFeet: 5},
		]) {
			const rejected = await state.pUseEfaArcaneJolt({
				trigger,
				effect: "restorative",
				target,
				rolls: {effectDice: 7},
			});
			expect(rejected.ok).toBe(false);
			expect(rejected.committed).toBe(false);
			expect(getJoltResource(state).current).toBe(beforeUses);
			expect(state.queryTurnReceipt(state._getEfaArcaneJoltTurnReceiptDescriptor().key).used).toBe(false);
		}
	});

	test("resolves modeled character/companion/object healing and external manual healing with target-relative gates", async () => {
		const cases = [
			{
				label: "character",
				getTarget: () => ({type: "character", visible: true, distanceFeet: 30}),
				getBefore: state => state.getCurrentHp(),
				getAfter: state => state.getCurrentHp(),
			},
			{
				label: "companion",
				getTarget: state => {
					const companionId = state.addCompanion({
						name: "Homunculus",
						source: "EFA",
						type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
						creatureType: "construct",
						hp: {max: 20, current: 5, temp: 0},
						lifecycle: {status: "alive"},
					});
					return {type: "companion", companionId, visible: true, distanceFeet: 12};
				},
				getBefore: (state, target) => state.getCompanion(target.companionId).hp.current,
				getAfter: (state, target) => state.getCompanion(target.companionId).hp.current,
			},
			{
				label: "object",
				getTarget: state => {
					const companionId = state.addCompanion({
						name: "Damaged Turret",
						source: "HB",
						type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
						creatureType: "object",
						hp: {max: 30, current: 8, temp: 0},
						lifecycle: {status: "alive"},
					});
					return {type: "object", companionId, visible: true, distanceFeet: 6};
				},
				getBefore: (state, target) => state.getCompanion(target.companionId).hp.current,
				getAfter: (state, target) => state.getCompanion(target.companionId).hp.current,
			},
		];
		for (const testCase of cases) {
			const state = getState();
			const weapon = addWeapon(state);
			const target = testCase.getTarget(state);
			const before = testCase.getBefore(state, target);
			const result = await state.pUseEfaArcaneJolt({
				trigger: getSummonerTrigger(getAttack(weapon)),
				effect: "restorative",
				target,
				rolls: {effectDice: 7},
			});
			expect(result).toMatchObject({
				ok: true,
				effect: "restorative",
				target: {
					type: testCase.label,
					visible: true,
					distanceFrom: "attackTarget",
				},
				hp: {before, requested: 7},
			});
			expect(testCase.getAfter(state, target)).toBeGreaterThan(before);
		}

		const externalState = getState();
		const externalWeapon = addWeapon(externalState);
		const hpBefore = externalState.getCurrentHp();
		const external = await externalState.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(externalWeapon)),
			effect: "restorative",
			target: {type: "external", kind: "object", name: "Gate", visible: true, distanceFeet: 30},
			rolls: {effectDice: 6},
		});
		expect(external).toMatchObject({
			ok: true,
			target: {type: "external", kind: "object", name: "Gate", distanceFrom: "attackTarget"},
			hp: {manualApplication: true, requested: 6, actual: null},
		});
		expect(externalState.getCurrentHp()).toBe(hpBefore);
	});

	test("clamps modeled healing at maximum HP without treating a zero actual gain as a transaction failure", async () => {
		const state = getState({hp: {max: 50, current: 50, temp: 0}});
		const maximumHp = state.getMaxHp();
		state._data.hp.current = maximumHp;
		const weapon = addWeapon(state);
		const result = await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "restorative",
			target: {type: "character", visible: true, distanceFeet: 10},
			rolls: {effectDice: 7},
		});
		expect(result).toMatchObject({
			ok: true,
			committed: true,
			hp: {before: maximumHp, after: maximumHp, max: maximumHp, requested: 7, actual: 0},
		});
	});

	test("rejects dead or vanished modeled recipients before spending", async () => {
		const state = getState();
		const weapon = addWeapon(state);
		const companionId = state.addCompanion({
			name: "Lost Construct",
			source: "EFA",
			type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
			creatureType: "construct",
			hp: {max: 20, current: 0, temp: 0},
			lifecycle: {status: "dead"},
		});
		const before = getJoltResource(state).current;
		const result = await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "restorative",
			target: {type: "companion", companionId, visible: true, distanceFeet: 5},
			rolls: {effectDice: 7},
		});
		expect(result).toMatchObject({ok: false, committed: false, reason: "targetDeadOrUnavailable"});
		expect(getJoltResource(state).current).toBe(before);
	});

	test("rolls back modeled HP, the exact resource, and the exact receipt when publication fails", async () => {
		const state = getState();
		const weapon = addWeapon(state);
		const companionId = state.addCompanion({
			name: "Damaged Ally",
			source: "HB",
			type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
			creatureType: "construct",
			hp: {max: 20, current: 5, temp: 0},
			lifecycle: {status: "alive"},
		});
		const beforeUses = getJoltResource(state).current;
		const result = await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "restorative",
			target: {type: "companion", companionId, visible: true, distanceFeet: 5},
			rolls: {effectDice: 7},
			publishResult: jest.fn(async () => false),
		});
		expect(result).toMatchObject({
			ok: false,
			committed: false,
			reason: "transactionRolledBack",
			rollback: {
				resource: {ok: true, current: beforeUses},
				turnReceipt: {ok: true, rolledBack: true},
				hp: {ok: true, companionId},
			},
		});
		expect(state.getCompanion(companionId).hp.current).toBe(5);
		expect(getJoltResource(state).current).toBe(beforeUses);
		expect(state.queryTurnReceipt(state._getEfaArcaneJoltTurnReceiptDescriptor().key).used).toBe(false);
	});
});

describe("Improved Defender scaling, rest, and source isolation", () => {
	test("scales Arcane Jolt from 2d6 to 4d6 at EFA Artificer 15", async () => {
		const level9 = getState({level: 9});
		const level9Weapon = addWeapon(level9);
		const base = await level9.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(level9Weapon)),
			effect: "destructive",
			target: {type: "attackTarget", name: "Target"},
			rolls: {effectDice: 7},
		});
		expect(base.rolls.effect).toMatchObject({dice: "2d6", total: 7});

		const level15 = getState({level: 15, intelligence: 20});
		const level15Weapon = addWeapon(level15);
		const improved = await level15.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(level15Weapon)),
			effect: "destructive",
			target: {type: "attackTarget", name: "Target"},
			rolls: {effectDice: 14},
		});
		expect(improved.rolls.effect).toMatchObject({dice: "4d6", total: 14});
		expect(improved.damage).toMatchObject({amount: 14, dice: "4d6", type: "force"});
	});

	test("long rest restores only the exact Jolt pool and does not heal or revive the defender", async () => {
		const state = getState({level: 15, intelligence: 20});
		const weapon = addWeapon(state);
		const companionId = addEfaDefender(state, {
			hp: {max: 80, current: 11, temp: 0},
			lifecycle: {status: "dead"},
		});
		state._data.resources.push({
			id: "other-arcane-jolt",
			name: "Arcane Jolt",
			current: 0,
			max: 3,
			classUid: "Artificer|TCE",
			subclassUid: "Battle Smith|Artificer|TCE|TCE",
			recharge: null,
		});
		await state.pUseEfaArcaneJolt({
			trigger: getSummonerTrigger(getAttack(weapon)),
			effect: "destructive",
			target: {type: "attackTarget", name: "Target"},
			rolls: {effectDice: 14},
		});
		state.onLongRest();

		expect(getJoltResource(state)).toMatchObject({current: 5, max: 5, spentUses: 0});
		expect(state._data.resources.find(resource => resource.id === "other-arcane-jolt").current).toBe(0);
		expect(state.getCompanion(companionId)).toMatchObject({
			hp: {current: 11},
			lifecycle: {status: "dead"},
		});
	});

	describe("Arcane Jolt shared Page prompt contract", () => {
		test("keeps the compact shared post-hit decision and target acknowledgements in one Page method", () => {
			const start = CHARACTER_SHEET_PAGE_SOURCE.indexOf("\n\tasync pOfferEfaArcaneJolt (");
			const end = CHARACTER_SHEET_PAGE_SOURCE.indexOf("\n\tasync pUseCompanionOperation (", start);
			expect(start).toBeGreaterThan(-1);
			expect(end).toBeGreaterThan(start);
			const body = CHARACTER_SHEET_PAGE_SOURCE.slice(start, end);
			expect(body).toContain("data-jolt-action=\"skip\">Skip");
			expect(body).toContain("data-jolt-action=\"destructive\">Destructive");
			expect(body).toContain("data-jolt-action=\"restorative\">Restorative");
			expect(body).toContain("triggerStatus.resource.current");
			expect(body).toContain("available this turn");
			expect(body).toContain("I can see the recipient");
			expect(body).toContain("Distance from the attack target");
			expect(body).toContain("focusRestoreTarget");
		});
	});

	test("keeps EFA no-AC-bonus behavior, TCE AC, and exact Deflect retaliation unchanged", () => {
		const efa14 = getState({level: 14, intelligence: 20});
		const efa15 = getState({level: 15, intelligence: 20});
		const efa14Id = addEfaDefender(efa14);
		const efa15Id = addEfaDefender(efa15);
		expect(efa14.getCompanion(efa14Id).ac).toBe(17);
		expect(efa15.getCompanion(efa15Id).ac).toBe(17);
		expect(efa15.getCompanion(efa15Id).scaling.resolved.reactions.deflectAttack.improvedDamage).toEqual({
			dice: "1d4",
			flat: 5,
			type: "force",
		});

		const tce = getState({source: "TCE", level: 15, intelligence: 20});
		const tceId = addEfaDefender(tce, {featureUid: TCE_STEEL_DEFENDER_UID, source: "TCE"});
		tce.reconcileFeatureOwnedCompanion(tceId, {
			summonerContext: tce.getFeatureCompanionSummonerContext(TCE_STEEL_DEFENDER_UID),
		});
		expect(tce.getCompanion(tceId).ac).toBe(17);
		expect(getJoltResource(tce)).toBeUndefined();
	});
});
