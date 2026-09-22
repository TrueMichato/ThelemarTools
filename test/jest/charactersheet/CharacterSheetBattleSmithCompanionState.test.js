import "./setup.js";
import "../../../js/charactersheet/charactersheet-companion-rules.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const EFA_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const REANIMATOR_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const UNREGISTERED_UID = "Clockwork Assistant|Artificer|EFA|Machinist|HB|3|HB";

const getOwnerClass = (source, level) => ({
	name: "Artificer",
	source,
	level,
	subclass: {
		name: "Battle Smith",
		shortName: "Battle Smith",
		source,
	},
});

const getState = ({classes = [getOwnerClass("EFA", 3)], intelligence = 16, companions = []} = {}) => {
	const state = new CharacterSheetState();
	state.loadFromJson({
		abilities: {str: 10, dex: 10, con: 10, int: intelligence, wis: 10, cha: 10},
		classes,
		companions,
	});
	return state;
};

const addFeatureCompanion = (state, {
	featureUid = EFA_UID,
	source = "EFA",
	hp = {max: 20, current: 7, temp: 0},
	...overrides
} = {}) => state.addCompanion({
	name: "Steel Defender",
	source,
	type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
	origin: "Battle Smith",
	creatureType: "construct",
	hp,
	featureGrant: {uid: featureUid},
	...overrides,
});

describe("Battle Smith feature-companion State resolution", () => {
	test.each([
		{
			level: 3,
			intelligence: 16,
			expected: {maxHp: 20, ac: 15, rendFlat: 5, repairFlat: 3, hitDice: 3},
		},
		{
			level: 9,
			intelligence: 18,
			expected: {maxHp: 50, ac: 16, rendFlat: 6, repairFlat: 4, hitDice: 9},
		},
		{
			level: 15,
			intelligence: 20,
			expected: {maxHp: 80, ac: 17, rendFlat: 7, repairFlat: 5, hitDice: 15},
		},
	])("projects EFA level $level rules without duplicating formulas in State", ({level, intelligence, expected}) => {
		const state = getState({classes: [getOwnerClass("EFA", level)], intelligence});
		const id = addFeatureCompanion(state);

		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});

		const companion = state.getCompanion(id);
		const resolved = companion.scaling.resolved;
		expect(companion).toMatchObject({
			id,
			name: "Steel Defender",
			source: "EFA",
			ac: expected.ac,
			hp: {max: expected.maxHp, current: 7},
			hitDice: {die: "d8", current: 0, max: expected.hitDice},
		});
		expect(resolved.actions.forceEmpoweredRend.damage.flat).toBe(expected.rendFlat);
		expect(resolved.actions.repair.healing.flat).toBe(expected.repairFlat);
		expect(companion.actions.find(action => action.featureCompanionRule?.key === "forceEmpoweredRend"))
			.toMatchObject({name: "Force-Empowered Rend"});
		expect(companion.uses.repair).toEqual({
			current: 0,
			max: 3,
			recharge: "longRest",
		});
		expect(state.getCompanionAbilityCheckMod(id, "str")).toBe(resolved.statistics.abilityChecks.str);
		expect(state.getCompanionSaveMod(id, "cha")).toBe(resolved.statistics.savingThrows.cha);
		expect(state.getCompanionSkillMod(id, "Athletics")).toBe(resolved.statistics.abilityChecks.str);
	});

	test("projects the exact TCE comparator through the same feature-owned API", () => {
		const state = getState({
			classes: [getOwnerClass("TCE", 15)],
			intelligence: 20,
		});
		const id = addFeatureCompanion(state, {
			featureUid: TCE_UID,
			source: "TCE",
			hp: {max: 82, current: 9},
		});

		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: state.getFeatureCompanionSummonerContext(TCE_UID),
		});

		const companion = state.getCompanion(id);
		expect(companion).toMatchObject({
			source: "TCE",
			ac: 17,
			hp: {max: 82, current: 9},
			passive: 20,
			saveProficiencies: ["dex", "con"],
			skillProficiencies: {athletics: 1, perception: 2},
		});
		expect(companion.scaling.resolved.actions.forceEmpoweredRend.damage.flat).toBe(5);
		expect(companion.scaling.resolved.actions.repair.healing.flat).toBe(5);
		expect(state.getCompanionSaveMod(id, "dex")).toBe(6);
		expect(state.getCompanionSkillMod(id, "Perception")).toBe(10);
	});

	test("preserves stable identity, exact current HP, spent resources, and source-specific metadata", () => {
		const state = getState({classes: [getOwnerClass("EFA", 9)], intelligence: 18});
		const id = addFeatureCompanion(state, {
			customName: "Aegis",
			hp: {max: 20, current: 6, temp: 3, sourceSpecific: {ward: true}},
			setup: {status: "complete", appearance: "Brass hound", locomotion: "fourLegs", extra: {kept: true}},
			scaling: {sourceSpecificOverlay: {kept: true}},
			lifecycle: {
				status: "dead",
				generation: 4,
				diedAtGameMinute: 720,
				customTimestamp: 721,
			},
			uses: {
				repair: {current: 1, max: 3, recharge: "legacy", custom: {kept: true}},
				futurePool: {current: 0, max: 2, custom: {kept: true}},
			},
			turnUsage: {action: true, reaction: true, flags: {arcaneJoltUsed: true}},
			hitDice: {die: "d8", current: 2, max: 3, custom: {kept: true}},
			conditions: ["poisoned"],
		});
		state.getCompanion(id).customExtension = {kept: true};

		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});

		const companion = state.getCompanion(id);
		expect(companion.id).toBe(id);
		expect(companion.customName).toBe("Aegis");
		expect(companion.hp).toEqual({
			max: 50,
			current: 6,
			temp: 3,
			sourceSpecific: {ward: true},
		});
		expect(companion.setup).toEqual({
			status: "complete",
			appearance: "Brass hound",
			locomotion: "fourLegs",
			extra: {kept: true},
		});
		expect(companion.lifecycle).toEqual({
			status: "dead",
			generation: 4,
			diedAtGameMinute: 720,
			customTimestamp: 721,
		});
		expect(companion.uses).toEqual({
			repair: {current: 1, max: 3, recharge: "longRest", custom: {kept: true}},
			futurePool: {current: 0, max: 2, custom: {kept: true}},
		});
		expect(companion.turnUsage).toEqual({
			action: true,
			reaction: true,
			flags: {arcaneJoltUsed: true},
		});
		expect(companion.hitDice).toEqual({die: "d8", current: 2, max: 9, custom: {kept: true}});
		expect(companion.scaling.sourceSpecificOverlay).toEqual({kept: true});
		expect(companion.customExtension).toEqual({kept: true});
	});

	test("keeps a damaged defender damaged across level and Intelligence changes", () => {
		const state = getState({classes: [getOwnerClass("EFA", 3)], intelligence: 16});
		const id = addFeatureCompanion(state, {hp: {max: 20, current: 8}});
		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});

		const higherContext = {
			artificerLevel: 9,
			intelligenceModifier: 5,
			proficiencyBonus: 4,
			spellAttackBonus: 9,
		};
		state.reconcileFeatureOwnedCompanion(id, {summonerContext: higherContext});
		expect(state.getCompanion(id).hp).toMatchObject({max: 50, current: 8});

		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: {...higherContext, artificerLevel: 3},
		});
		expect(state.getCompanion(id).hp).toMatchObject({max: 20, current: 8});
	});

	test("round-trips resolved overlays without healing or restoring spent Repair uses", () => {
		const state = getState({classes: [getOwnerClass("EFA", 9)], intelligence: 18});
		const id = addFeatureCompanion(state, {
			hp: {max: 20, current: 5},
			uses: {repair: {current: 1, max: 3, recharge: "longRest"}},
			hitDice: {die: "d8", current: 3, max: 9},
		});
		state.reconcileFeatureOwnedCompanion(id, {
			summonerContext: state.getFeatureCompanionSummonerContext(EFA_UID),
		});
		const saved = state.toJson();

		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		expect(restored.getCompanion(id)).toEqual(saved.companions.find(companion => companion.id === id));
		expect(restored.getCompanion(id).hp.current).toBe(5);
		expect(restored.getCompanion(id).uses.repair.current).toBe(1);
		expect(restored.getCompanion(id).hitDice.current).toBe(3);
	});
});

describe("Battle Smith legacy migration and exact ownership", () => {
	test("migrates one unambiguous EFA legacy record idempotently without duplicates or free healing", () => {
		const state = getState({
			classes: [getOwnerClass("EFA", 9)],
			intelligence: 18,
			companions: [{
				id: "legacy-efa-defender",
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 7, temp: 0},
				customName: "Rivet",
			}],
		});

		const migrated = state.getCompanion("legacy-efa-defender");
		expect(state.getCompanions()).toHaveLength(1);
		expect(migrated.featureGrant.uid).toBe(EFA_UID);
		expect(migrated.id).toBe("legacy-efa-defender");
		expect(migrated.customName).toBe("Rivet");
		expect(migrated.hp).toMatchObject({max: 50, current: 7});
		expect(migrated.uses.repair.current).toBe(0);
		expect(state.getFeatureCompanionMigrationStatus().resultsById["legacy-efa-defender"])
			.toMatchObject({status: "migrated", featureUid: EFA_UID});

		const once = state.toJson();
		state._migrateCompanions();
		expect(state.toJson()).toEqual(once);
		expect(state.getCompanions()).toHaveLength(1);
	});

	test("leaves ambiguous, cross-source, and duplicate legacy records untouched with explicit statuses", () => {
		const noSource = getState({
			classes: [getOwnerClass("EFA", 3)],
			companions: [{
				id: "ambiguous-source",
				name: "Steel Defender",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 4},
			}],
		});
		expect(noSource.getCompanion("ambiguous-source").featureGrant).toBeUndefined();
		expect(noSource.getFeatureCompanionMigrationStatus().resultsById["ambiguous-source"].status)
			.toBe("ambiguousSource");

		const crossSource = getState({
			classes: [getOwnerClass("TCE", 3)],
			companions: [{
				id: "cross-source",
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 4},
			}],
		});
		expect(crossSource.getCompanion("cross-source").featureGrant).toBeUndefined();
		expect(crossSource.getFeatureCompanionMigrationStatus().resultsById["cross-source"].status)
			.toBe("ownerNotFound");

		const duplicates = getState({
			classes: [getOwnerClass("EFA", 3)],
			companions: ["a", "b"].map(id => ({
				id,
				name: "Steel Defender",
				source: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 4},
			})),
		});
		expect(duplicates.getCompanions()).toHaveLength(2);
		expect(duplicates.getCompanions().every(companion => !companion.featureGrant)).toBe(true);
		expect(duplicates.getFeatureCompanionMigrationStatus().resultsById.a.status)
			.toBe("ambiguousMultipleCandidates");
		expect(duplicates.getFeatureCompanionMigrationStatus().resultsById.b.status)
			.toBe("ambiguousMultipleCandidates");
	});

	test("binds coexisting EFA and TCE defenders only to their exact source owners", () => {
		const state = getState({
			classes: [getOwnerClass("EFA", 3), getOwnerClass("TCE", 3)],
			companions: [
				{
					id: "efa-defender",
					name: "Steel Defender",
					source: "EFA",
					type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
					origin: "Battle Smith",
					creatureType: "construct",
					hp: {max: 20, current: 8},
				},
				{
					id: "tce-defender",
					name: "Steel Defender",
					source: "TCE",
					type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
					origin: "Battle Smith",
					creatureType: "construct",
					hp: {max: 20, current: 9},
				},
			],
		});

		expect(state.getCompanion("efa-defender")).toMatchObject({
			source: "EFA",
			featureGrant: {uid: EFA_UID},
			hp: {max: 20, current: 8},
		});
		expect(state.getCompanion("tce-defender")).toMatchObject({
			source: "TCE",
			featureGrant: {uid: TCE_UID},
			hp: {max: 20, current: 9},
		});
	});

	test("leaves unrelated and future-descriptor companions isolated", () => {
		const state = getState({
			companions: [
				{
					id: "familiar",
					name: "Clockwork Owl",
					source: "TST",
					type: CharacterSheetState.COMPANION_TYPES.FAMILIAR,
					hp: {max: 5, current: 2},
					customExtension: {kept: true},
				},
				{
					id: "future-reanimator",
					name: "Reanimated Companion",
					source: "RHW",
					type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
					hp: {max: 25, current: 11},
					featureGrant: {uid: UNREGISTERED_UID},
					scaling: {kind: "futureDescriptor", custom: {kept: true}},
					customExtension: {kept: true},
				},
			],
		});
		const before = state.toJson().companions;

		state.migrateLegacyFeatureCompanions();
		state.recalculateCompanion("future-reanimator");

		expect(state.toJson().companions).toEqual(before);
		expect(state.getFeatureOwnedCompanions(EFA_UID)).toEqual([]);
		expect(state.getFeatureOwnedCompanions(UNREGISTERED_UID)).toHaveLength(1);
	});

	test("does not bind a conflicting legacy statblock identity", () => {
		const state = getState({
			companions: [{
				id: "conflicting-statblock",
				name: "Steel Defender",
				creatureName: "Clockwork Wolf",
				source: "EFA",
				creatureSource: "EFA",
				type: CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER,
				origin: "Battle Smith",
				creatureType: "construct",
				hp: {max: 20, current: 4},
			}],
		});

		expect(state.getCompanion("conflicting-statblock").featureGrant).toBeUndefined();
		expect(state.getFeatureCompanionMigrationStatus()).toMatchObject({
			status: "noCandidates",
			resultsById: {},
		});
	});

	test("deactivates, removes, and rebinds by exact owner without identity churn", () => {
		const state = getState({
			classes: [getOwnerClass("EFA", 3), getOwnerClass("TCE", 3)],
		});
		const efaId = addFeatureCompanion(state, {
			featureUid: EFA_UID,
			source: "EFA",
			uses: {repair: {current: 0, max: 3}},
			lifecycle: {status: "alive", generation: 3, custom: {kept: true}},
		});
		const tceId = addFeatureCompanion(state, {featureUid: TCE_UID, source: "TCE"});
		const unrelatedId = state.addCompanion({
			name: "Reanimated Companion",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			featureGrant: {uid: REANIMATOR_UID},
		});

		expect(state.deactivateFeatureOwnedCompanions(EFA_UID, {status: "inactive"})).toBe(1);
		expect(state.getCompanion(efaId)).toMatchObject({
			active: false,
			lifecycle: {status: "inactive", generation: 3, custom: {kept: true}},
		});
		expect(state.getCompanion(tceId).active).toBe(true);
		expect(state.getCompanion(unrelatedId).active).toBe(true);

		const rebound = state.rebindFeatureOwnedCompanion(efaId, {
			fromFeatureUid: EFA_UID,
			toFeatureUid: TCE_UID,
			summonerContext: state.getFeatureCompanionSummonerContext(TCE_UID),
		});
		expect(rebound.ok).toBe(true);
		expect(rebound.companion).toMatchObject({
			id: efaId,
			source: "TCE",
			featureGrant: {uid: TCE_UID},
			hp: {current: 7},
			uses: {repair: {current: 0}},
			lifecycle: {generation: 3},
		});

		expect(state.removeFeatureOwnedCompanions(TCE_UID)).toBe(2);
		expect(state.getCompanion(efaId)).toBeNull();
		expect(state.getCompanion(tceId)).toBeNull();
		expect(state.getCompanion(unrelatedId)).not.toBeNull();
	});

	test("leaves ownership untouched when a rebind target cannot resolve", () => {
		const state = getState();
		const id = addFeatureCompanion(state, {featureUid: EFA_UID, source: "EFA"});
		const before = structuredClone(state.getCompanion(id).featureGrant);

		expect(() => state.rebindFeatureOwnedCompanion(id, {
			fromFeatureUid: EFA_UID,
			toFeatureUid: TCE_UID,
		})).toThrow(RangeError);
		expect(state.getCompanion(id).featureGrant).toEqual(before);
	});
});

describe("Feature-companion explicit failures", () => {
	test("fails explicitly when the rules module or descriptor is unavailable", () => {
		const state = getState();
		const original = globalThis.CharacterSheetCompanionRules;
		try {
			delete globalThis.CharacterSheetCompanionRules;
			expect(() => state.resolveFeatureCompanionRules(EFA_UID, {}))
				.toThrow(ReferenceError);
		} finally {
			globalThis.CharacterSheetCompanionRules = original;
		}

		expect(() => state.resolveFeatureCompanionRules(UNREGISTERED_UID, {
			artificerLevel: 3,
			intelligenceModifier: 3,
			proficiencyBonus: 2,
			spellAttackBonus: 5,
		})).toThrow(RangeError);
	});

	test("fails explicitly on invalid summoner context", () => {
		const state = getState();
		expect(() => state.resolveFeatureCompanionRules(EFA_UID, {
			artificerLevel: 3,
			intelligenceModifier: 3,
			proficiencyBonus: 2,
		})).toThrow(TypeError);
	});
});
