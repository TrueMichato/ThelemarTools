import {
	BestiaryQuickActionsEngine,
	BestiaryQuickActionsMinion,
	BestiaryQuickActionsOperations,
	BestiaryQuickActionsProficiency,
	BestiaryQuickActionsRegistry,
	BestiaryQuickActionsScaleTypes,
	BestiaryQuickActionsUtil,
	BestiaryQuickActionsValidationError,
} from "../../../js/bestiary/bestiary-quick-actions-engine.js";

const getCreature = () => ({
	name: "Clockwork Wolf",
	source: "TST",
	type: {type: "construct", tags: ["clockwork"]},
	cr: "5",
	hp: {average: 60, formula: "8d10 + 16"},
	ac: [{ac: 15}],
	trait: [{name: "Keen Hearing", entries: ["The wolf has advantage on Wisdom checks that rely on hearing."]}],
	action: [
		{name: "Multiattack", entries: ["The wolf makes two Bite attacks."]},
		{
			name: "Bite",
			entries: [
				"{@atk mw} {@hit +6} to hit, reach 5 ft., one target. {@h} 8 ({@damage 1d10 + 3}) piercing damage, and the target must succeed on a {@dc 14} Strength saving throw or be knocked {@condition prone}.",
			],
		},
	],
	bonus: [{name: "Pounce", entries: ["The wolf moves up to its speed."]}],
	reaction: [{name: "Parry", entries: ["The wolf adds 2 to its AC."]}],
});

describe("Bestiary Quick Actions override engine", () => {
	it("rebuilds in operation order and replays later operations when an earlier one is removed", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const creature = getCreature();
		const events = [];
		const unsubscribe = registry.subscribe(event => events.push(event));
		const patchId = registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.patch({set: {"hp.average": 22}}),
		});
		registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.addEntry({
				section: "trait",
				entry: {name: "Late Trait", entries: ["This is applied second."]},
			}),
		});

		expect(registry.getCreature({creature}).hp.average).toBe(22);
		expect(registry.removeOperation({creature, operationId: patchId})).toBe(true);
		expect(registry.getCreature({creature})).toMatchObject({
			hp: {average: 60},
			trait: expect.arrayContaining([expect.objectContaining({name: "Late Trait"})]),
		});
		expect(events.map(it => it.type)).toEqual(["addOperation", "addOperation", "removeOperation"]);

		unsubscribe();
		registry.clear({creature});
		expect(events).toHaveLength(3);
	});

	it("restores standard-creature fields when Minion is removed without discarding later edits", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const creature = getCreature();
		const minionId = registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.minion(),
		});
		registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.patch({set: {ac: [{ac: 19}]}}),
		});

		expect(registry.getCreature({creature})).toMatchObject({
			hp: {special: "12"},
			ac: [{ac: 19}],
		});
		expect(registry.removeOperation({creature, operationId: minionId})).toBe(true);
		expect(registry.getCreature({creature})).toMatchObject({
			hp: {average: 60, formula: "8d10 + 16"},
			ac: [{ac: 19}],
			bonus: [{name: "Pounce"}],
			reaction: [{name: "Parry"}],
		});
		expect(registry.getCreature({creature}).action.map(it => it.name)).toEqual(["Multiattack", "Bite"]);
	});

	it("does not bake earlier added entries into later item operations", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const creature = getCreature();
		const areaTraitId = registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.addEntry({
				section: "trait",
				entry: {name: "Ruin Runner", entries: ["The creature moves through ruins."]},
			}),
		});
		registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.applyItem({
				item: {name: "Blade of Testing", source: "TST"},
				fieldChanges: {str: 18},
				entries: [{section: "action", entry: {name: "Blade", entries: ["The creature attacks."]}}],
			}),
		});

		registry.removeOperation({creature, operationId: areaTraitId});
		const result = registry.getCreature({creature});
		expect(result.trait.map(it => it.name)).toEqual(["Special Equipment", "Keen Hearing"]);
		expect(result.str).toBe(18);
		expect(result.action.at(-1).name).toBe("Blade");
	});

	it("never mutates source objects or stores mutations made to returned copies", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const creature = getCreature();
		const original = structuredClone(creature);
		const operation = BestiaryQuickActionsOperations.patch({set: {"hp.average": 25}});
		registry.addOperation({creature, operation});

		const firstRead = registry.getCreature({creature});
		firstRead.hp.average = 999;
		firstRead.trait.push({name: "Leaked", entries: []});

		expect(creature).toEqual(original);
		expect(operation).toEqual(BestiaryQuickActionsOperations.patch({set: {"hp.average": 25}}));
		expect(registry.getCreature({creature}).hp.average).toBe(25);
		expect(registry.getCreature({creature}).trait).not.toEqual(expect.arrayContaining([expect.objectContaining({name: "Leaked"})]));
	});

	it("accepts flat serializable operations and the monster/getOverride integration aliases", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const monster = getCreature();
		registry.addOperation({
			monster,
			operation: {
				id: "flat-patch",
				type: "patch",
				patch: {passive: 18},
				label: "Quick edit",
			},
		});
		registry.addOperation({
			monster,
			operation: {
				id: "flat-entry",
				type: "addEntry",
				prop: "trait",
				entry: {name: "Flat Trait", entries: ["Added by an integration."]},
			},
		});

		expect(registry.getOverride({monster})).toMatchObject({
			passive: 18,
			trait: expect.arrayContaining([expect.objectContaining({name: "Flat Trait"})]),
		});
		expect(registry.getKey({monster})).toBe("clockwork wolf|tst::base");
		expect(BestiaryQuickActionsEngine.getOverride({
			monster,
			operations: [{type: "patch", patch: {passive: 19}}],
		}).passive).toBe(19);
	});

	it("uses independent canonical keys for every scale context", () => {
		const creature = getCreature();
		const scaled = {...creature, _isScaledCr: true, _scaledCr: 8};
		const keys = [
			BestiaryQuickActionsUtil.getRegistryKey({creature, scaleContext: BestiaryQuickActionsScaleTypes.BASE}),
			BestiaryQuickActionsUtil.getRegistryKey({creature, scaleContext: {type: "cr", value: 8}}),
			BestiaryQuickActionsUtil.getRegistryKey({creature, scaleContext: {type: "summonSpellLevel", level: 4}}),
			BestiaryQuickActionsUtil.getRegistryKey({creature, scaleContext: {type: "summonClassLevel", level: 11}}),
		];
		expect(new Set(keys).size).toBe(4);
		expect(BestiaryQuickActionsUtil.getRegistryKey({creature: scaled})).toBe(keys[1]);
		expect(keys[0]).toBe("clockwork wolf|tst::base");

		const registry = new BestiaryQuickActionsRegistry();
		registry.addOperation({
			creature,
			scaleContext: {type: "cr", value: 8},
			operation: BestiaryQuickActionsOperations.patch({set: {ac: [{ac: 20}]}}),
		});
		expect(registry.getCreature({creature, scaleContext: {type: "cr", value: 8}}).ac[0].ac).toBe(20);
		expect(registry.getCreature({creature}).ac[0].ac).toBe(15);
	});

	it("converts a creature to a table-driven minion without incompatible action economy", () => {
		const source = getCreature();
		const out = BestiaryQuickActionsMinion.convert(source);

		expect(out).toMatchObject({
			hp: {special: "12"},
			cr: {cr: "5", xp: 225},
			profBonus: 3,
			type: {type: "construct", tags: ["clockwork", "Minion"]},
		});
		expect(out.trait.at(-1)).toEqual(expect.objectContaining({name: "Minion"}));
		expect(out.action).toHaveLength(1);
		expect(out.action[0].name).toBe("Bite (Group Attack)");
		expect(out.action[0].entries[0]).toContain("{@atk mw} {@hit +6} to hit, reach 5 ft., one target.");
		expect(out.action[0].entries[0]).toContain("{@h} 8 piercing damage");
		expect(out.action[0].entries[0]).toContain("knocked {@condition prone}");
		expect(out).not.toHaveProperty("bonus");
		expect(out).not.toHaveProperty("reaction");
		expect(source).toEqual(getCreature());
	});

	it("preserves each unconditional damage packet average and leaves conditional damage explicit", () => {
		const creature = {
			...getCreature(),
			cr: "8",
			action: [{
				name: "Elemental Claw",
				entries: [
					"{@atk mw} {@hit +7} to hit, reach 10 ft., one target. {@h} 7 ({@damage 2d6}) slashing damage plus 3 ({@damage 1d6}) fire damage. If the target is prone, it takes {@damage 2d6} cold damage.",
				],
			}],
		};
		const out = BestiaryQuickActionsMinion.convert(creature);
		const text = out.action[0].entries[0];

		expect(text).toContain("{@h} 7 slashing damage plus 3 fire damage");
		expect(text).toContain("If the target is prone, it takes {@damage 2d6} cold damage");
	});

	it("uses printed attack averages and floors dice-only averages", () => {
		const creature = {
			...getCreature(),
			action: [
				{
					name: "Maul",
					entries: ["{@atk mw} {@hit +7} to hit. {@h} 15 ({@damage 2d8 + 6}) bludgeoning damage."],
				},
				{
					name: "Claw",
					entries: ["{@atk mw} {@hit +7} to hit. {@h} {@damage 1d6} slashing damage."],
				},
			],
		};
		const out = BestiaryQuickActionsMinion.convert(creature);

		expect(out.action[0].entries[0]).toContain("{@h} 15 bludgeoning damage");
		expect(out.action[1].entries[0]).toContain("{@h} 3 slashing damage");
	});

	it("preserves conditional alternate damage while converting later unconditional packets", () => {
		const creature = {
			...getCreature(),
			action: [{
				name: "Quarterstaff",
				entries: [
					"{@atk mw} {@hit 2} to hit. {@h}2 ({@damage 1d6 - 1}) bludgeoning damage, or 3 ({@damage 1d8 - 1}) bludgeoning damage if used with two hands, plus 11 ({@damage 2d10}) force damage.",
				],
			}],
		};
		const out = BestiaryQuickActionsMinion.convert(creature);

		expect(out.action[0].entries[0]).toContain("{@h}2 bludgeoning damage");
		expect(out.action[0].entries[0]).toContain("3 ({@damage 1d8 - 1}) bludgeoning damage if used with two hands");
		expect(out.action[0].entries[0]).toContain("plus 11 force damage");
	});

	it("applies semantic area effects and resolves PB placeholders from the final creature", () => {
		const creature = {
			...getCreature(),
			cr: "8",
			size: ["S"],
			hp: {average: 45, formula: "10d6 + 10"},
			resist: ["acid"],
			speed: {walk: 30},
			action: [{
				name: "Claw",
				entries: ["{@atk mw} {@hit +7} to hit. {@h} 8 ({@damage 1d10 + 3}) slashing damage."],
			}],
		};
		const out = BestiaryQuickActionsUtil.applyOperations({
			baseCreature: creature,
			operations: [
				BestiaryQuickActionsOperations.applyAreaTrait({
					trait: {name: "Acidic Nature", source: "FleeMortals"},
					area: "Swamp",
					entry: {name: "Acidic Nature", entries: ["The creature has resistance to acid damage."]},
					effects: [
						{type: "defense", prop: "resist", values: ["acid"], upgradeToImmunity: true},
						{type: "conditionImmune", values: ["poisoned"]},
						{type: "speed", mode: "climb", equalTo: "walk"},
						{type: "sense", value: "darkvision 60 ft."},
						{type: "sizeHitDice", from: ["S"], to: "M", dieFaces: 8},
						{type: "augmentMeleeDamage", text: "The attack deals {@damage PB} extra necrotic damage."},
					],
				}),
				BestiaryQuickActionsOperations.patch({set: {cr: "9"}}),
				BestiaryQuickActionsOperations.setLegendaryGroup({
					name: "Cave",
					source: "FleeMortals",
					lairActions: ["A target must make a DC 12 plus PB save or take {@damage PBd6} damage."],
				}),
			],
		});

		expect(out).toMatchObject({
			cr: "9",
			size: ["M"],
			hp: {average: 55, formula: "10d8 + 10"},
			resist: [],
			immune: ["acid"],
			conditionImmune: ["poisoned"],
			speed: {walk: 30, climb: 30},
			senses: ["darkvision 60 ft."],
		});
		expect(out.action[0].entries[0]).toContain("{@damage 4} extra necrotic damage");
		expect(out.legendaryGroup.lairActions[0]).toBe("A target must make a {@dc 16} save or take {@damage 4d6} damage.");
	});

	it("upgrades a resistance nested in a structured defense group without discarding its siblings", () => {
		const creature = {
			...getCreature(),
			resist: [{resist: ["acid", "cold"], note: "while bloodied"}],
		};
		const out = BestiaryQuickActionsUtil.applyOperations({
			baseCreature: creature,
			operations: [BestiaryQuickActionsOperations.applyAreaTrait({
				trait: {name: "Acidic Nature", source: "FleeMortals"},
				area: "Swamp",
				entry: {name: "Acidic Nature", entries: ["Acid resistance improves."]},
				effects: [{type: "defense", prop: "resist", values: ["acid"], upgradeToImmunity: true}],
			})],
		});

		expect(out.resist).toEqual([{resist: ["cold"], note: "while bloodied"}]);
		expect(out.immune).toEqual(["acid"]);
	});

	it("resolves all supported Flee Mortals proficiency placeholder forms", () => {
		const creature = {...getCreature(), cr: "9"};
		const resolved = BestiaryQuickActionsProficiency.resolve([
			"DC 10 plus PB; escape DC 12 plus PB; +PB AC; {@damage PBd6}; {@damage PB}; 2 × PB temporary hit points.",
		], creature);

		expect(resolved[0]).toBe("{@dc 14}; escape {@dc 16}; +4 AC; {@damage 4d6}; {@damage 4}; 8 temporary hit points.");
	});

	it("returns explicit validation and throws for unsupported or special challenge ratings", () => {
		const creature = {...getCreature(), cr: "Unknown"};
		const validation = BestiaryQuickActionsMinion.validate(creature);

		expect(validation).toMatchObject({isValid: false, code: "MINION_CR_UNSUPPORTED"});
		expect(() => BestiaryQuickActionsMinion.convert(creature)).toThrow(BestiaryQuickActionsValidationError);
		expect(creature).toEqual({...getCreature(), cr: "Unknown"});
		expect(BestiaryQuickActionsMinion.getStats("27")).toMatchObject({hp: 34, damage: 14, xp: 10500});
	});

	it("applies structured patches, entry edits, legendary groups, and item-derived changes", () => {
		const creature = getCreature();
		const out = BestiaryQuickActionsUtil.applyOperations({
			baseCreature: creature,
			operations: [
				BestiaryQuickActionsOperations.patch({
					set: {"speed.walk": 40, "save.dex": "+5"},
					remove: ["hp.formula"],
				}),
				BestiaryQuickActionsOperations.removeEntry({section: "trait", name: "Keen Hearing"}),
				BestiaryQuickActionsOperations.addEntry({
					section: "trait",
					entry: {name: "Area Trait", entries: ["Fog fills the area."]},
				}),
				BestiaryQuickActionsOperations.setLegendaryGroup({name: "Haunted Moor", source: "TST"}),
				BestiaryQuickActionsOperations.applyItem({
					item: {name: "Boots of Testing", source: "TST"},
					fieldChanges: {"speed.walk": 60, bonusAc: "+1"},
					entries: [{
						section: "action",
						entry: {name: "Boots of Testing", entries: ["The wolf clicks its heels."]},
					}],
				}),
			],
		});

		expect(out).toMatchObject({
			hp: {average: 60},
			speed: {walk: 60},
			save: {dex: "+5"},
			bonusAc: "+1",
			legendaryGroup: {name: "Haunted Moor", source: "TST"},
		});
		expect(out.hp).not.toHaveProperty("formula");
		expect(out.trait.map(it => it.name)).toEqual(["Special Equipment", "Area Trait"]);
		expect(out.trait[0].entries).toEqual(["The creature carries and can use {@item Boots of Testing|TST}."]);
		expect(out.action.at(-1).name).toBe("Boots of Testing");
		expect(creature).toEqual(getCreature());
	});

	it("merges multiple magic items into one independently replayed Special Equipment trait", () => {
		const operations = [
			BestiaryQuickActionsOperations.applyItem({item: {name: "Animated Shield", source: "DMG"}}),
			BestiaryQuickActionsOperations.applyItem({item: {name: "Boots of Speed", source: "DMG"}}),
		];
		const out = BestiaryQuickActionsUtil.applyOperations({baseCreature: getCreature(), operations});
		const withoutShield = BestiaryQuickActionsUtil.applyOperations({baseCreature: getCreature(), operations: operations.slice(1)});

		expect(out.trait.filter(it => it.name === "Special Equipment")).toHaveLength(1);
		expect(out.trait[0].entries).toEqual([
			"The creature carries and can use {@item Animated Shield|DMG}.",
			"The creature carries and can use {@item Boots of Speed|DMG}.",
		]);
		expect(withoutShield.trait[0].entries).toEqual(["The creature carries and can use {@item Boots of Speed|DMG}."]);
	});

	it("replays relative item bonuses against the preceding operation state", () => {
		const first = BestiaryQuickActionsOperations.applyItem({
			item: {name: "Ring One", source: "TST"},
			effects: {bonusAc: 1},
		});
		const second = BestiaryQuickActionsOperations.applyItem({
			item: {name: "Ring Two", source: "TST"},
			effects: {bonusAc: 2},
		});
		const both = BestiaryQuickActionsUtil.applyOperations({baseCreature: getCreature(), operations: [first, second]});
		const onlySecond = BestiaryQuickActionsUtil.applyOperations({baseCreature: getCreature(), operations: [second]});

		expect(both.ac[0].ac).toBe(18);
		expect(onlySecond.ac[0].ac).toBe(17);
	});

	it("handles conditional structured and wildcard item speed modifiers", () => {
		const out = BestiaryQuickActionsUtil.applyOperations({
			baseCreature: {...getCreature(), speed: {walk: {number: 30, condition: "while upright"}, fly: 20}},
			operations: [BestiaryQuickActionsOperations.applyItem({
				item: {name: "Speed Charm", source: "TST"},
				effects: {
					isConditional: true,
					conditionLabel: "Speed Charm",
					modifySpeed: {bonus: {"*": 10}},
				},
			})],
		});

		expect(out.speed.alternate).toEqual({
			walk: [{number: 40, condition: "while using {@item Speed Charm|TST|Speed Charm}"}],
			fly: [{number: 30, condition: "while using {@item Speed Charm|TST|Speed Charm}"}],
		});
		expect(out.speed).not.toHaveProperty("*");
	});

	it("composes dependent conditional speed modifiers into one alternate speed", () => {
		const out = BestiaryQuickActionsUtil.applyOperations({
			baseCreature: {...getCreature(), speed: {walk: 30}},
			operations: [BestiaryQuickActionsOperations.applyItem({
				item: {name: "Eagle Whistle", source: "TftYP"},
				effects: {
					isConditional: true,
					modifySpeed: {
						equal: {fly: "walk"},
						multiply: {fly: 2},
					},
				},
			})],
		});

		expect(out.speed).toEqual({
			walk: 30,
			alternate: {
				fly: [{
					number: 60,
					condition: "while using {@item Eagle Whistle|TftYP|Eagle Whistle}",
				}],
			},
		});
	});

	it("applies AC bonuses to formula-based AC without adding a hidden numeric AC", () => {
		const baseCreature = {...getCreature(), ac: [{special: "11 + the spell's level"}]};
		const conditional = BestiaryQuickActionsUtil.applyOperations({
			baseCreature,
			operations: [BestiaryQuickActionsOperations.applyItem({
				item: {name: "Formula Ward", source: "TST"},
				effects: {isConditional: true, bonusAc: 2},
			})],
		});
		const unconditional = BestiaryQuickActionsUtil.applyOperations({
			baseCreature,
			operations: [BestiaryQuickActionsOperations.applyItem({
				item: {name: "Formula Ring", source: "TST"},
				effects: {bonusAc: 1},
			})],
		});

		expect(conditional.ac).toEqual([
			{special: "11 + the spell's level"},
			{
				special: "11 + the spell's level + 2 (while using {@item Formula Ward|TST|Formula Ward})",
			},
		]);
		expect(unconditional.ac).toEqual([{
			special: "11 + the spell's level + 1 ({@item Formula Ring|TST})",
		}]);
	});

	it("keeps the prior valid registry state if removing an operation would break replay", () => {
		const registry = new BestiaryQuickActionsRegistry();
		const creature = {...getCreature(), cr: "Unknown"};
		const crPatchId = registry.addOperation({
			creature,
			operation: BestiaryQuickActionsOperations.patch({set: {cr: "5"}}),
		});
		registry.addOperation({creature, operation: BestiaryQuickActionsOperations.minion()});

		expect(() => registry.removeOperation({creature, operationId: crPatchId})).toThrow(BestiaryQuickActionsValidationError);
		expect(registry.getCreature({creature}).cr).toMatchObject({cr: "5"});
	});
});
