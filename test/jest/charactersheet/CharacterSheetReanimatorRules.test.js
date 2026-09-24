import "../../../js/charactersheet/charactersheet-companion-rules.js";

const CharacterSheetCompanionRules = globalThis.CharacterSheetCompanionRules;
const RHW_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3";
const RHW_DATA_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const EFA_BATTLE_SMITH_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3";
const TCE_BATTLE_SMITH_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3";

const getContext = (overrides = {}) => ({
	artificerLevel: 3,
	intelligenceModifier: 3,
	proficiencyBonus: 2,
	spellAttackBonus: 5,
	spellSaveDc: 13,
	...overrides,
});

const getSetup = modifications => ({modifications});

function getCombinations (values, count) {
	if (!count) return [[]];
	if (values.length < count) return [];
	const [head, ...tail] = values;
	return [
		...getCombinations(tail, count - 1).map(combination => [head, ...combination]),
		...getCombinations(tail, count),
	];
}

describe("RHW Reanimated Companion rules", () => {
	describe("authoritative formulas and metadata", () => {
		it.each([
			{
				level: 3,
				intelligenceModifier: -2,
				proficiencyBonus: 2,
				spellAttackBonus: 0,
				spellSaveDc: 8,
				modifications: [],
			},
			{
				level: 5,
				intelligenceModifier: 0,
				proficiencyBonus: 3,
				spellAttackBonus: 3,
				spellSaveDc: 11,
				modifications: ["arcaneConduit"],
			},
			{
				level: 9,
				intelligenceModifier: 1,
				proficiencyBonus: 4,
				spellAttackBonus: 5,
				spellSaveDc: 13,
				modifications: ["arcaneConduit", "bloated"],
			},
			{
				level: 11,
				intelligenceModifier: 2,
				proficiencyBonus: 4,
				spellAttackBonus: 6,
				spellSaveDc: 14,
				modifications: ["ferocity", "gaunt"],
			},
			{
				level: 15,
				intelligenceModifier: 3,
				proficiencyBonus: 5,
				spellAttackBonus: 8,
				spellSaveDc: 16,
				modifications: ["arcaneConduit", "bloated", "moist"],
			},
			{
				level: 17,
				intelligenceModifier: 4,
				proficiencyBonus: 6,
				spellAttackBonus: 10,
				spellSaveDc: 18,
				modifications: ["ferocity", "gaunt", "moist"],
			},
			{
				level: 20,
				intelligenceModifier: 5,
				proficiencyBonus: 6,
				spellAttackBonus: 11,
				spellSaveDc: 19,
				modifications: ["arcaneConduit", "ferocity", "bloated"],
			},
		])("resolves exact level $level formulas", ({
			level,
			intelligenceModifier,
			proficiencyBonus,
			spellAttackBonus,
			spellSaveDc,
			modifications,
		}) => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({
					artificerLevel: level,
					intelligenceModifier,
					proficiencyBonus,
					spellAttackBonus,
					spellSaveDc,
				}),
				getSetup(modifications),
			);

			expect(resolved.statistics).toMatchObject({
				maxHp: 5 + (5 * level),
				ac: 10 + intelligenceModifier,
				hitDice: {count: level, die: "d8"},
				proficiencyBonus,
				spellAttackBonus,
				spellSaveDc,
			});
			expect(resolved.actions.dreadfulSwipe).toMatchObject({
				attackBonus: spellAttackBonus,
				damage: {
					flat: intelligenceModifier,
					type: "necrotic",
					ignoresResistance: level >= 9,
				},
			});
			expect(resolved.traits.deathBurst).toMatchObject({
				save: {ability: "dex", dc: spellSaveDc, onSuccess: "halfDamage"},
				damage: {
					dice: level >= 9 ? "4d4" : "2d4",
					flat: modifications.includes("bloated") ? intelligenceModifier : 0,
					type: "necrotic",
					ignoresResistance: level >= 9,
				},
			});
			expect(resolved.damageRules.necrotic.ignoresResistance).toBe(level >= 9);
		});

		it("publishes the authored base creature rules without state or DOM dependencies", () => {
			const resolved = CharacterSheetCompanionRules.resolve(RHW_UID, getContext(), getSetup([]));

			expect(resolved.identity).toEqual({
				name: "Reanimated Companion",
				source: "RHW",
				companionUid: "Reanimated Companion|RHW",
				classUid: "Artificer|EFA",
				subclassUid: "Reanimator|Artificer|EFA|RHW",
				featureUid: RHW_UID,
				runtimeOwnerUid: RHW_DATA_UID,
			});
			expect(resolved.statistics).toMatchObject({
				size: ["M"],
				creatureType: "undead",
				abilityScores: {str: 11, dex: 10, con: 16, int: 4, wis: 10, cha: 6},
				speed: {walk: 30},
				senses: {blindsight: 60},
				damageResistances: ["necrotic", "poison"],
				damageImmunities: ["lightning"],
				conditionImmunities: ["charmed", "exhaustion", "poisoned"],
				languages: {understands: "summonerKnownLanguages", canSpeak: false},
				passivePerception: 10,
			});
			expect(resolved.actions.dreadfulSwipe).toMatchObject({
				attackType: "melee",
				reachFeet: 5,
				damage: {dice: "1d4", flat: 3, type: "necrotic"},
				riders: [{
					id: "preventOpportunityAttacks",
					effect: "targetCannotTakeOpportunityAttacks",
					duration: "untilStartOfTargetNextTurn",
				}],
			});
			expect(resolved.traits.lightningAbsorption).toEqual({
				name: "Lightning Absorption",
				trigger: "subjectedToLightningDamage",
				damageImmunity: "lightning",
				healing: {formula: "lightningDamageDealt"},
			});
		});

		it("publishes authoritative creation, command, lifecycle, and rest policies", () => {
			const resolved = CharacterSheetCompanionRules.resolve(RHW_UID, getContext(), getSetup([]));

			expect(resolved.creationPolicy).toEqual({
				actionType: "magicAction",
				manifest: {
					rangeFeet: 5,
					space: "unoccupied",
				},
				toolEligibility: {
					requiresProficiency: true,
					allowed: [
						{kind: "tool", uid: "Tinker's Tools|XPHB"},
						{kind: "toolCategory", uid: "Artisan's Tools|XPHB"},
					],
				},
				freeCreation: {
					uses: 1,
					recharge: "longRest",
				},
				alternatePayment: {
					spellSlot: {minimumLevel: 1, expend: 1},
				},
				maximumActive: 1,
				prohibitedWhileActive: true,
			});
			expect(resolved.commandPolicy).toEqual({
				turnTiming: "duringSummonerTurn",
				movement: "autonomous",
				reaction: "autonomous",
				defaultAction: "dodge",
				commandMethods: [{cost: "bonusAction", permits: "anyAction"}],
				whileSummonerIncapacitated: {
					actsAutonomously: true,
					actionRestriction: null,
				},
			});
			expect(resolved.lifecycle).toEqual({
				duration: {until: "finishLongRest"},
				earlyDismissal: {
					actionType: "magicAction",
					outcome: "harmlessCollapse",
					triggersDeathBurst: false,
				},
				onSummonerDeath: {
					hitPoints: 0,
					outcome: "dies",
					triggersDeathBurst: true,
				},
				onCompanionDeath: {
					triggersDeathBurst: true,
				},
			});
			expect(resolved.restPolicy).toEqual({
				shortRest: {automaticChanges: []},
				longRest: {
					companionLifecycle: "expires",
					freeCreationRecharge: "all",
				},
			});
		});
	});

	describe("modification progression and derived effects", () => {
		it("publishes the exact unique pool, unlock levels, and required pick counts", () => {
			const descriptor = CharacterSheetCompanionRules.getDescriptor(RHW_UID);

			expect(Object.keys(descriptor.modifications.options)).toEqual([
				"arcaneConduit",
				"ferocity",
				"bloated",
				"gaunt",
				"moist",
			]);
			expect(Object.fromEntries(
				Object.entries(descriptor.modifications.options)
					.map(([id, option]) => [id, option.unlockArtificerLevel]),
			)).toEqual({
				arcaneConduit: 5,
				ferocity: 5,
				bloated: 9,
				gaunt: 9,
				moist: 9,
			});
			expect(descriptor.modifications.selection).toEqual({
				unique: true,
				requiredCountByArtificerLevel: [
					{minimum: 0, maximum: 4, count: 0},
					{minimum: 5, maximum: 8, count: 1},
					{minimum: 9, maximum: 14, count: 2},
					{minimum: 15, maximum: null, count: 3},
				],
			});
		});

		it.each([
			{level: 3, options: [], count: 0},
			{level: 5, options: ["arcaneConduit", "ferocity"], count: 1},
			{level: 9, options: ["arcaneConduit", "ferocity", "bloated", "gaunt", "moist"], count: 2},
			{level: 15, options: ["arcaneConduit", "ferocity", "bloated", "gaunt", "moist"], count: 3},
		])("accepts every legal level $level combination", ({level, options, count}) => {
			const combinations = getCombinations(options, count);

			for (const modifications of combinations) {
				const resolved = CharacterSheetCompanionRules.resolve(
					RHW_UID,
					getContext({artificerLevel: level}),
					getSetup(modifications),
				);
				expect(resolved.modifications.requiredCount).toBe(count);
				expect(resolved.modifications.selected).toHaveLength(count);
			}
		});

		it("encodes Arcane Conduit as declarative casting and damage-rider metadata", () => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 5, intelligenceModifier: 4}),
				getSetup(["arcaneConduit"]),
			);

			expect(resolved.modifications.effects.arcaneConduit).toMatchObject({
				castingOrigin: {
					mayCastFromCompanionSpace: true,
					usesSummonerSenses: true,
				},
				damageRider: {
					limit: "oncePerTurn",
					requiresCompanionWithinFeet: 120,
					spellClassUid: "Artificer|EFA",
					spellSchools: ["evocation", "necromancy"],
					trigger: "spellDealsDamage",
					damageRollBonus: 4,
					turnReceipt: {
						version: 1,
						ownerUid: RHW_DATA_UID,
						sourceUid: "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW",
						actionUid: "arcane-conduit:damage-rider",
						keyScope: "companionGeneration",
						executionStatus: "executable",
						committed: false,
					},
				},
				executionStatus: "executable",
			});
		});

		it("applies Ferocity without changing the Swipe Intelligence rider", () => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 5, intelligenceModifier: -1}),
				getSetup(["ferocity"]),
			);

			expect(resolved.actions.dreadfulSwipe.damage).toMatchObject({
				dice: "1d6",
				flat: -1,
				type: "necrotic",
			});
		});

		it("applies Bloated size, push, and Death Burst Intelligence damage", () => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 9, intelligenceModifier: 4}),
				getSetup(["arcaneConduit", "bloated"]),
			);

			expect(resolved.statistics.size).toEqual(["L"]);
			expect(resolved.actions.dreadfulSwipe.riders).toContainEqual({
				id: "bloatedPush",
				effect: "push",
				distanceFeet: 10,
				maximumTargetSize: "L",
			});
			expect(resolved.traits.deathBurst.damage).toMatchObject({dice: "4d4", flat: 4});
		});

		it("applies Gaunt walk, climb, and spell-save fear aura metadata", () => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 9, spellSaveDc: 16}),
				getSetup(["arcaneConduit", "gaunt"]),
			);

			expect(resolved.statistics.speed).toEqual({walk: 45, climb: 45});
			expect(resolved.modifications.effects.gaunt).toMatchObject({
				climbing: {
					difficultSurfaces: true,
					ceilings: true,
					requiresAbilityCheck: false,
				},
				fearAura: {
					trigger: "chosenCreatureStartsTurn",
					area: {shape: "emanation", radiusFeet: 10},
					save: {ability: "wis", dc: 16},
					onFailure: {
						condition: "frightened",
						duration: "untilStartOfCreatureNextTurn",
					},
				},
			});
		});

		it("applies Moist swim, squeezing, and exact Intelligence acid retaliation", () => {
			const resolved = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 9, intelligenceModifier: 0}),
				getSetup(["arcaneConduit", "moist"]),
			);

			expect(resolved.statistics.speed).toEqual({walk: 30, swim: 30});
			expect(resolved.modifications.effects.moist).toMatchObject({
				squeeze: {
					minimumSpaceInches: 1,
					extraMovement: false,
				},
				acidRetaliation: {
					trigger: "hitByAttackRoll",
					attackerMaximumRangeFeet: 10,
					damage: {flat: 0, type: "acid"},
				},
			});
		});

		it("combines Gaunt and Moist from final speed regardless of selection order", () => {
			const context = getContext({artificerLevel: 15});
			const forward = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				context,
				getSetup(["arcaneConduit", "gaunt", "moist"]),
			);
			const reverse = CharacterSheetCompanionRules.resolve(
				RHW_UID,
				context,
				getSetup(["moist", "gaunt", "arcaneConduit"]),
			);

			expect(reverse).toEqual(forward);
			expect(forward.statistics.speed).toEqual({walk: 45, climb: 45, swim: 45});
			expect(forward.modifications.selected).toEqual(["arcaneConduit", "gaunt", "moist"]);
		});

		it("recalculates purely without mutating or compounding setup", () => {
			const context = getContext({artificerLevel: 15, intelligenceModifier: 4});
			const setup = getSetup(["ferocity", "bloated", "moist"]);
			const contextBefore = structuredClone(context);
			const setupBefore = structuredClone(setup);

			const first = CharacterSheetCompanionRules.resolve(RHW_UID, context, setup);
			const second = CharacterSheetCompanionRules.resolve(RHW_UID, context, setup);

			expect(second).toEqual(first);
			expect(first.actions.dreadfulSwipe.damage).toMatchObject({dice: "1d6", flat: 4});
			expect(first.traits.deathBurst.damage).toMatchObject({dice: "4d4", flat: 4});
			expect(context).toEqual(contextBefore);
			expect(setup).toEqual(setupBefore);
		});
	});

	describe("validation and source isolation", () => {
		it.each([
			["name only", "Reanimated Companion"],
			["incomplete", "Reanimated Companion|Artificer|EFA|Reanimator|RHW"],
			["malformed", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW|Display"],
			["wrong class name", "Reanimated Companion|Wizard|EFA|Reanimator|RHW|3"],
			["wrong class source", "Reanimated Companion|Artificer|TCE|Reanimator|RHW|3"],
			["wrong subclass name", "Reanimated Companion|Artificer|EFA|Battle Smith|RHW|3"],
			["wrong subclass source", "Reanimated Companion|Artificer|EFA|Reanimator|EFA|3"],
			["wrong feature source", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|EFA"],
			["wrong level", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|5"],
			["non-numeric level", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|three"],
			["fractional level", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3.5"],
			["blank explicit feature source", "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|"],
		])("rejects %s identity", (_label, uid) => {
			expect(CharacterSheetCompanionRules.getDescriptor(uid)).toBeNull();
			expect(CharacterSheetCompanionRules.resolve(uid, getContext(), getSetup([]))).toBeNull();
		});

		it("normalizes canonical six-part and same-source seven-part identities", () => {
			expect(CharacterSheetCompanionRules.getDescriptor(RHW_DATA_UID))
				.toEqual(CharacterSheetCompanionRules.getDescriptor(RHW_UID));
			expect(CharacterSheetCompanionRules.resolve(RHW_DATA_UID, getContext(), getSetup([])))
				.toEqual(CharacterSheetCompanionRules.resolve(RHW_UID, getContext(), getSetup([])));
		});

		it("requires every finite Reanimator summoner-context value", () => {
			for (const key of [
				"artificerLevel",
				"intelligenceModifier",
				"proficiencyBonus",
				"spellAttackBonus",
				"spellSaveDc",
			]) {
				const missing = getContext();
				delete missing[key];
				expect(() => CharacterSheetCompanionRules.resolve(RHW_UID, missing, getSetup([]))).toThrow(TypeError);
			}

			expect(() => CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({spellSaveDc: Number.POSITIVE_INFINITY}),
				getSetup([]),
			)).toThrow(TypeError);
			expect(() => CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({spellAttackBonus: "   "}),
				getSetup([]),
			)).toThrow(TypeError);
		});

		it.each([
			["duplicate", 5, ["arcaneConduit", "arcaneConduit"]],
			["unknown", 5, ["graveWax"]],
			["locked", 5, ["bloated"]],
			["too few", 9, ["arcaneConduit"]],
			["too many", 9, ["arcaneConduit", "ferocity", "bloated"]],
		])("rejects %s modification selections", (_label, artificerLevel, modifications) => {
			expect(() => CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel}),
				getSetup(modifications),
			)).toThrow(RangeError);
		});

		it("rejects malformed modification setup while preserving optional setup for Battle Smith", () => {
			expect(() => CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 5}),
				{modifications: "arcaneConduit"},
			)).toThrow(TypeError);
			expect(() => CharacterSheetCompanionRules.resolve(
				RHW_UID,
				getContext({artificerLevel: 5}),
			)).toThrow(RangeError);

			const battleSmithContext = {
				artificerLevel: 9,
				intelligenceModifier: 4,
				proficiencyBonus: 4,
				spellAttackBonus: 8,
			};
			expect(CharacterSheetCompanionRules.resolve(EFA_BATTLE_SMITH_UID, battleSmithContext, {}))
				.toEqual(CharacterSheetCompanionRules.resolve(EFA_BATTLE_SMITH_UID, battleSmithContext));
			expect(CharacterSheetCompanionRules.resolve(TCE_BATTLE_SMITH_UID, battleSmithContext, {}))
				.toEqual(CharacterSheetCompanionRules.resolve(TCE_BATTLE_SMITH_UID, battleSmithContext));
		});

		it("keeps both accepted Battle Smith descriptors and formulas unchanged", () => {
			const context = {
				artificerLevel: 15,
				intelligenceModifier: 5,
				proficiencyBonus: 5,
				spellAttackBonus: 10,
			};
			const efa = CharacterSheetCompanionRules.resolve(EFA_BATTLE_SMITH_UID, context);
			const tce = CharacterSheetCompanionRules.resolve(TCE_BATTLE_SMITH_UID, context);

			expect(CharacterSheetCompanionRules.getDescriptor(EFA_BATTLE_SMITH_UID).identity).toEqual({
				name: "Steel Defender",
				source: "EFA",
				companionUid: "Steel Defender|EFA",
				classUid: "Artificer|EFA",
				subclassUid: "Battle Smith|Artificer|EFA|EFA",
				featureUid: EFA_BATTLE_SMITH_UID,
			});
			expect(CharacterSheetCompanionRules.getDescriptor(TCE_BATTLE_SMITH_UID).identity).toEqual({
				name: "Steel Defender",
				source: "TCE",
				companionUid: "Steel Defender|TCE",
				classUid: "Artificer|TCE",
				subclassUid: "Battle Smith|Artificer|TCE|TCE",
				featureUid: TCE_BATTLE_SMITH_UID,
			});
			expect(efa.statistics).toMatchObject({maxHp: 80, ac: 17});
			expect(efa.actions.forceEmpoweredRend.damage).toEqual({dice: "1d8", flat: 7, type: "force"});
			expect(tce.statistics).toMatchObject({maxHp: 82, ac: 17});
			expect(tce.actions.forceEmpoweredRend.damage).toEqual({dice: "1d8", flat: 5, type: "force"});
		});

		it("exposes JSON-safe detached descriptors and resolutions", () => {
			const descriptor = CharacterSheetCompanionRules.getDescriptor(RHW_UID);
			const resolved = CharacterSheetCompanionRules.resolve(RHW_UID, getContext(), getSetup([]));

			expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
			expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);

			descriptor.identity.source = "MUTATED";
			resolved.statistics.maxHp = 999;
			resolved.creationPolicy.toolEligibility.allowed[0].uid = "MUTATED";
			resolved.commandPolicy.commandMethods[0].permits = "nothing";
			resolved.lifecycle.earlyDismissal.triggersDeathBurst = true;
			resolved.restPolicy.longRest.freeCreationRecharge = "none";
			expect(CharacterSheetCompanionRules.getDescriptor(RHW_UID).identity.source).toBe("RHW");
			const recalculated = CharacterSheetCompanionRules.resolve(RHW_UID, getContext(), getSetup([]));
			expect(recalculated.statistics.maxHp).toBe(20);
			expect(recalculated.creationPolicy.toolEligibility.allowed[0].uid).toBe("Tinker's Tools|XPHB");
			expect(recalculated.commandPolicy.commandMethods[0].permits).toBe("anyAction");
			expect(recalculated.lifecycle.earlyDismissal.triggersDeathBurst).toBe(false);
			expect(recalculated.restPolicy.longRest.freeCreationRecharge).toBe("all");
		});
	});
});
