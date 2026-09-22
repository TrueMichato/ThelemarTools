import "../../../js/charactersheet/charactersheet-companion-rules.js";

const CharacterSheetCompanionRules = globalThis.CharacterSheetCompanionRules;
const EFA_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const TCE_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";

const getContext = (overrides = {}) => ({
	artificerLevel: 3,
	intelligenceModifier: 3,
	proficiencyBonus: 2,
	spellAttackBonus: 5,
	...overrides,
});

describe("CharacterSheetCompanionRules", () => {
	describe("EFA Steel Defender formulas", () => {
		it.each([
			{
				context: getContext(),
				expected: {maxHp: 20, ac: 15, hitDice: 3, rendFlat: 5, repairFlat: 3},
			},
			{
				context: getContext({
					artificerLevel: 9,
					intelligenceModifier: 4,
					proficiencyBonus: 4,
					spellAttackBonus: 8,
				}),
				expected: {maxHp: 50, ac: 16, hitDice: 9, rendFlat: 6, repairFlat: 4},
			},
			{
				context: getContext({
					artificerLevel: 15,
					intelligenceModifier: 5,
					proficiencyBonus: 5,
					spellAttackBonus: 10,
				}),
				expected: {maxHp: 80, ac: 17, hitDice: 15, rendFlat: 7, repairFlat: 5},
			},
		])("resolves level $context.artificerLevel values exactly", ({context, expected}) => {
			const resolved = CharacterSheetCompanionRules.resolve(EFA_UID, context);

			expect(resolved.identity.companionUid).toBe("Steel Defender|EFA");
			expect(resolved.statistics).toMatchObject({
				maxHp: expected.maxHp,
				ac: expected.ac,
				hitDice: {count: expected.hitDice, die: "d8"},
				passivePerception: 10,
			});
			expect(resolved.actions.forceEmpoweredRend).toMatchObject({
				attackBonus: context.spellAttackBonus,
				damage: {dice: "1d8", flat: expected.rendFlat, type: "force"},
			});
			expect(resolved.actions.repair.healing).toEqual({
				dice: "2d8",
				flat: expected.repairFlat,
			});
		});

		it("adds proficiency to every ability check and saving throw but keeps authored passive 10", () => {
			const resolved = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				intelligenceModifier: 4,
				proficiencyBonus: 3,
			}));

			expect(resolved.statistics.proficiencyPolicy).toEqual({
				abilityChecks: "all",
				savingThrows: "all",
				bonusFormula: "proficiencyBonus",
			});
			expect(resolved.statistics.abilityChecks).toEqual({
				str: 5,
				dex: 4,
				con: 5,
				int: 0,
				wis: 3,
				cha: 1,
			});
			expect(resolved.statistics.savingThrows).toEqual(resolved.statistics.abilityChecks);
			expect(resolved.statistics.passivePerception).toBe(10);
		});
	});

	describe("EFA action, command, lifecycle, and advancement metadata", () => {
		it("publishes Repair, Deflect Attack, command, and rest policies", () => {
			const resolved = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 5,
			}));

			expect(resolved.actions.repair).toMatchObject({
				actionType: "action",
				rangeFeet: 5,
				targets: ["self", "construct", "object"],
				uses: {max: 3, recharge: "daily"},
			});
			expect(resolved.reactions.deflectAttack).toMatchObject({
				actionType: "reaction",
				rangeFeet: 5,
				requiresVisibleAttacker: true,
				requiresDifferentProtectedTarget: true,
				effect: {attackRollMode: "disadvantage"},
				improvedDamage: null,
			});
			expect(resolved.commandPolicy).toMatchObject({
				turnTiming: "duringSummonerTurn",
				movement: "autonomous",
				reaction: "autonomous",
				defaultAction: "dodge",
				whileSummonerIncapacitated: {
					actsAutonomously: true,
					actionRestriction: null,
				},
			});
			expect(resolved.commandPolicy.commandMethods).toEqual([
				{cost: "bonusAction", permits: "anyAction"},
				{
					cost: "replaceOneAttack",
					unlockArtificerLevel: 5,
					permits: "forceEmpoweredRend",
				},
			]);
			expect(resolved.lifecycle).toMatchObject({
				onSummonerDeath: "vanishes",
				revival: {
					deathWindow: "1 hour",
					actionType: "magicAction",
					requiresTouch: true,
					spellSlot: {minimumLevel: 1, expend: 1},
					returnDelay: "1 minute",
					hitPointsRestored: "all",
				},
				replacement: {
					timing: "finishLongRest",
					requiresToolUid: "Smith's Tools|XPHB",
					toolRequirement: "inHand",
					previousDefenderFate: "vanishes",
				},
			});
			expect(resolved.restPolicy).toEqual({
				shortRest: {automaticChanges: []},
				longRest: {
					mayCreateReplacement: true,
					arcaneJoltRecharge: "all",
				},
				repairRecharge: "daily",
			});
		});

		it("publishes Arcane Jolt scaling and Intelligence-based uses", () => {
			const level9 = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 9,
				intelligenceModifier: 4,
			}));
			const lowInt = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 9,
				intelligenceModifier: -1,
			}));
			const level15 = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 15,
				intelligenceModifier: 5,
			}));

			expect(level9.arcaneJolt).toMatchObject({
				available: true,
				triggerSources: ["summonerMagicWeaponHit", "companionHit"],
				oncePerTurn: true,
				damage: {dice: "2d6", type: "force"},
				healing: {dice: "2d6", rangeFeet: 30, targets: ["creature", "object"]},
				uses: {max: 4, recharge: "longRest"},
			});
			expect(lowInt.arcaneJolt.uses.max).toBe(1);
			expect(level15.arcaneJolt).toMatchObject({
				damage: {dice: "4d6", type: "force"},
				healing: {dice: "4d6"},
				uses: {max: 5, recharge: "longRest"},
			});
		});

		it("does not add AC for EFA Improved Defender", () => {
			const level14 = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 14,
				intelligenceModifier: 5,
			}));
			const level15 = CharacterSheetCompanionRules.resolve(EFA_UID, getContext({
				artificerLevel: 15,
				intelligenceModifier: 5,
			}));

			expect(level14.statistics.ac).toBe(17);
			expect(level15.statistics.ac).toBe(17);
			expect(level15.improvedDefender).toEqual({
				available: true,
				unlockArtificerLevel: 15,
				armorClassBonus: 0,
				arcaneJoltDice: "4d6",
				deflectAttackDamage: {dice: "1d4", flat: 5, type: "force"},
			});
			expect(level15.reactions.deflectAttack.improvedDamage).toEqual({
				dice: "1d4",
				flat: 5,
				type: "force",
			});
		});
	});

	describe("TCE regression comparator", () => {
		it.each([
			{
				context: getContext({
					artificerLevel: 3,
					intelligenceModifier: 4,
					proficiencyBonus: 2,
					spellAttackBonus: 6,
				}),
				expected: {maxHp: 21, ac: 15, rendFlat: 2, repairFlat: 2, passive: 14},
			},
			{
				context: getContext({
					artificerLevel: 15,
					intelligenceModifier: 5,
					proficiencyBonus: 5,
					spellAttackBonus: 10,
				}),
				expected: {maxHp: 82, ac: 17, rendFlat: 5, repairFlat: 5, passive: 20},
			},
		])("keeps TCE formulas at level $context.artificerLevel", ({context, expected}) => {
			const resolved = CharacterSheetCompanionRules.resolve(TCE_UID, context);

			expect(resolved.statistics).toMatchObject({
				maxHp: expected.maxHp,
				ac: expected.ac,
				hitDice: {count: context.artificerLevel, die: "d8"},
				savingThrows: {
					str: 2,
					dex: 1 + context.proficiencyBonus,
					con: 2 + context.proficiencyBonus,
					int: -3,
					wis: 0,
					cha: -2,
				},
				skills: {
					athletics: 2 + context.proficiencyBonus,
					perception: 2 * context.proficiencyBonus,
				},
				passivePerception: expected.passive,
			});
			expect(resolved.actions.forceEmpoweredRend).toMatchObject({
				attackBonus: context.spellAttackBonus,
				damage: {dice: "1d8", flat: expected.rendFlat, type: "force"},
			});
			expect(resolved.actions.repair.healing).toEqual({
				dice: "2d8",
				flat: expected.repairFlat,
			});
		});
	});

	describe("UID dispatch and serialization contract", () => {
		it("returns null for unknown or incomplete feature UIDs", () => {
			expect(CharacterSheetCompanionRules.getDescriptor("Steel Defender")).toBeNull();
			expect(CharacterSheetCompanionRules.resolve("Steel Defender|EFA", getContext())).toBeNull();
			expect(CharacterSheetCompanionRules.resolve(
				"Steel Defender|Artificer|EFA|Battle Smith|TCE|3|EFA",
				getContext(),
			)).toBeNull();
		});

		it("keeps same-named EFA and TCE rules source-isolated", () => {
			const context = getContext({
				artificerLevel: 15,
				intelligenceModifier: 5,
				proficiencyBonus: 5,
				spellAttackBonus: 10,
			});
			const efa = CharacterSheetCompanionRules.resolve(EFA_UID, context);
			const tce = CharacterSheetCompanionRules.resolve(TCE_UID, context);

			expect(efa.identity.name).toBe(tce.identity.name);
			expect(efa.identity.source).toBe("EFA");
			expect(tce.identity.source).toBe("TCE");
			expect(efa.statistics.maxHp).toBe(80);
			expect(tce.statistics.maxHp).toBe(82);
			expect(efa.improvedDefender.armorClassBonus).toBe(0);
			expect(tce.improvedDefender.armorClassBonus).toBe(2);
			expect(efa.actions.forceEmpoweredRend.damage.flat).toBe(7);
			expect(tce.actions.forceEmpoweredRend.damage.flat).toBe(5);
		});

		it("exposes JSON-safe descriptors and detached resolver output", () => {
			const descriptor = CharacterSheetCompanionRules.getDescriptor(EFA_UID);
			const resolved = CharacterSheetCompanionRules.resolve(EFA_UID, getContext());
			const registryRoundTrip = JSON.parse(JSON.stringify(CharacterSheetCompanionRules.getRegistry()));
			const descriptorRoundTrip = JSON.parse(JSON.stringify(descriptor));
			const resolvedRoundTrip = JSON.parse(JSON.stringify(resolved));

			expect(registryRoundTrip[EFA_UID].identity.source).toBe("EFA");
			expect(descriptorRoundTrip).toEqual(descriptor);
			expect(resolvedRoundTrip).toEqual(resolved);

			descriptor.identity.source = "MUTATED";
			resolved.actions.repair.uses.max = 99;
			expect(CharacterSheetCompanionRules.getDescriptor(EFA_UID).identity.source).toBe("EFA");
			expect(CharacterSheetCompanionRules.resolve(EFA_UID, getContext()).actions.repair.uses.max).toBe(3);
		});
	});
});
