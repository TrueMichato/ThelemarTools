/**
 * Character Sheet Phase 2 Features - Unit Tests
 * Tests for Sorcerous Restoration, FeatureModifierParser patterns,
 * and Subclass Spell Auto-Population
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

/** Helper to set all 6 ability scores at once */
function setScores (s, scores) {
	for (const [ability, value] of Object.entries(scores)) {
		s.setAbilityBase(ability, value);
	}
}

describe("Phase 2 Features", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// Sorcerous Restoration
	// ==========================================================================
	describe("Sorcerous Restoration", () => {
		describe("PHB Level 20 Sorcerer", () => {
			beforeEach(() => {
				state.addClass({name: "Sorcerer", level: 20, source: "PHB"});
				state.setSorceryPoints({current: 10, max: 20});
			});

			it("should recover 4 SP on short rest", () => {
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(4);
				expect(state.getSorceryPoints().current).toBe(14);
			});

			it("should cap recovery at max SP", () => {
				state.setSorceryPoints({current: 18, max: 20});
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(2); // Only 2 to reach max
				expect(state.getSorceryPoints().current).toBe(20);
			});

			it("should recover 0 if already at max", () => {
				state.setSorceryPoints({current: 20, max: 20});
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(0);
			});

			it("should be called during onShortRest", () => {
				const spBefore = state.getSorceryPoints().current;
				state.onShortRest();
				const spAfter = state.getSorceryPoints().current;
				expect(spAfter).toBe(spBefore + 4);
			});
		});

		describe("XPHB Level 5 Sorcerer", () => {
			beforeEach(() => {
				state.addClass({name: "Sorcerer", level: 5, source: "XPHB"});
				state.setSorceryPoints({current: 1, max: 5});
			});

			it("should recover proficiency bonus SP (3 at L5)", () => {
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(3); // prof bonus at L5 = 3
				expect(state.getSorceryPoints().current).toBe(4);
			});
		});

		describe("Non-sorcerer", () => {
			it("should recover 0 SP", () => {
				state.addClass({name: "Wizard", level: 20, source: "PHB"});
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(0);
			});
		});

		describe("Low-level PHB Sorcerer", () => {
			it("should not have Sorcerous Restoration before L20", () => {
				state.addClass({name: "Sorcerer", level: 10, source: "PHB"});
				state.setSorceryPoints({current: 5, max: 10});
				const recovered = state.applySorcerousRestoration();
				expect(recovered).toBe(0);
			});
		});
	});

	// ==========================================================================
	// FeatureModifierParser - Damage Immunity
	// ==========================================================================
	describe("FeatureModifierParser - Damage Immunity", () => {
		it("should parse single damage immunity", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You are immune to poison damage.", "Test Feature",
			);
			const immunity = mods.find(m => m.type === "immunity:poison");
			expect(immunity).toBeTruthy();
			expect(immunity.isImmunity).toBe(true);
		});

		it("should parse multiple damage immunities", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You have immunity to fire and cold damage.", "Test Feature",
			);
			expect(mods.find(m => m.type === "immunity:fire")).toBeTruthy();
			expect(mods.find(m => m.type === "immunity:cold")).toBeTruthy();
		});

		it("should parse comma-separated damage immunities", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You are immune to fire, cold, and lightning damage.", "Test Feature",
			);
			expect(mods.find(m => m.type === "immunity:fire")).toBeTruthy();
			expect(mods.find(m => m.type === "immunity:cold")).toBeTruthy();
			expect(mods.find(m => m.type === "immunity:lightning")).toBeTruthy();
		});

		it("should not produce false positives for resistance", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You have resistance to fire damage.", "Test Feature",
			);
			const immunity = mods.find(m => m.type?.startsWith("immunity:"));
			expect(immunity).toBeFalsy();
		});
	});

	// ==========================================================================
	// FeatureModifierParser - Condition Immunity
	// ==========================================================================
	describe("FeatureModifierParser - Condition Immunity", () => {
		it("should parse 'immune to the charmed condition'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You are immune to the charmed condition.", "Test Feature",
			);
			const immunity = mods.find(m => m.type === "conditionImmunity:charmed");
			expect(immunity).toBeTruthy();
			expect(immunity.isConditionImmunity).toBe(true);
		});

		it("should parse 'immunity to being frightened'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You gain immunity to being frightened.", "Test Feature",
			);
			expect(mods.find(m => m.type === "conditionImmunity:frightened")).toBeTruthy();
		});

		it("should parse \"can't be poisoned\"", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You can't be poisoned.", "Test Feature",
			);
			expect(mods.find(m => m.type === "conditionImmunity:poisoned")).toBeTruthy();
		});

		it("should parse 'cannot be stunned'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You cannot be stunned.", "Test Feature",
			);
			expect(mods.find(m => m.type === "conditionImmunity:stunned")).toBeTruthy();
		});

		it("should not match 'advantage on saves against being charmed'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You have advantage on saving throws against being charmed.", "Test Feature",
			);
			const immunity = mods.find(m => m.type?.startsWith("conditionImmunity:"));
			expect(immunity).toBeFalsy();
		});
	});

	// ==========================================================================
	// FeatureModifierParser - Temporary Hit Points
	// ==========================================================================
	describe("FeatureModifierParser - Temp HP", () => {
		it("should parse flat temp HP amount", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You gain 5 temporary hit points.", "Test Feature",
			);
			const tempHp = mods.find(m => m.type === "tempHp");
			expect(tempHp).toBeTruthy();
			expect(tempHp.value).toBe(5);
		});

		it("should parse temp HP equal to ability modifier", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You gain temporary hit points equal to your Charisma modifier.", "Test Feature",
			);
			const tempHp = mods.find(m => m.type === "tempHp");
			expect(tempHp).toBeTruthy();
			expect(tempHp.abilityMod).toBe("cha");
		});

		it("should parse Constitution modifier temp HP", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You gain temporary hit points equal to your Constitution modifier.", "Test Feature",
			);
			const tempHp = mods.find(m => m.type === "tempHp");
			expect(tempHp).toBeTruthy();
			expect(tempHp.abilityMod).toBe("con");
		});
	});

	// ==========================================================================
	// FeatureModifierParser - Extra Damage Dice
	// ==========================================================================
	describe("FeatureModifierParser - Extra Damage Dice", () => {
		it("should parse 'deal an extra 1d6 fire damage'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"When you hit with a melee weapon attack, you deal an extra 1d6 fire damage.", "Test Feature",
			);
			const dmg = mods.find(m => m.type === "damage" && m.bonusDie);
			expect(dmg).toBeTruthy();
			expect(dmg.bonusDie).toBe("1d6");
			expect(dmg.damageType).toBe("fire");
		});

		it("should parse 'deals additional 2d8 radiant damage'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"Your weapon deals additional 2d8 radiant damage to undead.", "Test Feature",
			);
			const dmg = mods.find(m => m.type === "damage" && m.bonusDie);
			expect(dmg).toBeTruthy();
			expect(dmg.bonusDie).toBe("2d8");
			expect(dmg.damageType).toBe("radiant");
		});

		it("should parse 'deal an extra 1d10 psychic damage'", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You deal an extra 1d10 psychic damage.", "Test Feature",
			);
			const dmg = mods.find(m => m.type === "damage" && m.bonusDie);
			expect(dmg).toBeTruthy();
			expect(dmg.bonusDie).toBe("1d10");
			expect(dmg.damageType).toBe("psychic");
		});

		it("should not match non-extra damage descriptions", () => {
			const mods = FeatureModifierParser.parseModifiers(
				"You deal 1d6 slashing damage.", "Test Feature",
			);
			const dmg = mods.find(m => m.type === "damage" && m.bonusDie);
			expect(dmg).toBeFalsy();
		});
	});

	// ==========================================================================
	// Subclass Spell Auto-Population
	// ==========================================================================
	describe("Subclass Spell Auto-Population", () => {
		describe("getSubclassAlwaysPreparedSpells", () => {
			it("should return spells from subclass additionalSpells.prepared", () => {
				const cls = {
					name: "Cleric",
					level: 3,
					source: "PHB",
					subclass: {
						name: "Life Domain",
						source: "PHB",
						additionalSpells: [{
							prepared: {
								1: ["bless|PHB", "cure wounds|PHB"],
								3: ["lesser restoration|PHB", "spiritual weapon|PHB"],
								5: ["beacon of hope|PHB", "revivify|PHB"],
							},
						}],
					},
				};
				state.addClass(cls);

				const spells = state.getSubclassAlwaysPreparedSpells(cls);
				// At level 3, should have L1 and L3 spells (4 total)
				expect(spells.length).toBe(4);
				expect(spells.every(s => s.alwaysPrepared)).toBe(true);
				expect(spells.find(s => s.name === "bless")).toBeTruthy();
				expect(spells.find(s => s.name === "lesser restoration")).toBeTruthy();
				// L5 spells should NOT be included (character is only level 3)
				expect(spells.find(s => s.name === "beacon of hope")).toBeFalsy();
			});

			it("should return spells from subclass additionalSpells.known", () => {
				const cls = {
					name: "Warlock",
					level: 5,
					source: "PHB",
					subclass: {
						name: "The Fiend",
						source: "PHB",
						additionalSpells: [{
							known: {
								1: ["burning hands|PHB", "command|PHB"],
								3: ["blindness deafness|PHB", "scorching ray|PHB"],
							},
						}],
					},
				};
				state.addClass(cls);

				const spells = state.getSubclassAlwaysPreparedSpells(cls);
				expect(spells.length).toBe(4);
				expect(spells.find(s => s.name === "burning hands")).toBeTruthy();
			});

			it("should return empty for subclass without additionalSpells", () => {
				const cls = {
					name: "Fighter",
					level: 5,
					source: "PHB",
					subclass: {name: "Champion", source: "PHB"},
				};
				state.addClass(cls);
				expect(state.getSubclassAlwaysPreparedSpells(cls)).toEqual([]);
			});

			it("should return empty for class without subclass", () => {
				const cls = {name: "Fighter", level: 5, source: "PHB"};
				state.addClass(cls);
				expect(state.getSubclassAlwaysPreparedSpells(cls)).toEqual([]);
			});

			it("should return innate cantrips from additionalSpells.innate", () => {
				const cls = {
					name: "Sorcerer",
					level: 1,
					source: "PHB",
					subclass: {
						name: "Test Origin",
						source: "PHB",
						additionalSpells: [{
							innate: {
								"0": ["light#c"],
							},
						}],
					},
				};
				state.addClass(cls);

				const spells = state.getSubclassAlwaysPreparedSpells(cls);
				expect(spells.length).toBe(1);
				expect(spells[0].name).toBe("light");
				expect(spells[0].isCantrip).toBe(true);
				expect(spells[0].alwaysPrepared).toBe(true);
			});

			it("should return level-gated innate spells from additionalSpells.innate", () => {
				const cls = {
					name: "Warlock",
					level: 3,
					source: "PHB",
					subclass: {
						name: "Test Patron",
						source: "PHB",
						additionalSpells: [{
							innate: {
								"0": ["light#c"],
								"5": ["daylight"],
							},
						}],
					},
				};
				state.addClass(cls);

				const spells = state.getSubclassAlwaysPreparedSpells(cls);
				// Only Light cantrip — level 5 innate not yet available
				expect(spells.length).toBe(1);
				expect(spells[0].name).toBe("light");
			});
		});

		describe("populateSubclassSpells", () => {
			it("should add always-prepared spells to known spells", () => {
				state.addClass({
					name: "Cleric",
					level: 3,
					source: "PHB",
					subclass: {
						name: "Life Domain",
						source: "PHB",
						additionalSpells: [{
							prepared: {
								1: ["bless|PHB", "cure wounds|PHB"],
								3: ["lesser restoration|PHB"],
							},
						}],
					},
				});

				// populateSubclassSpells is called automatically by applyClassFeatureEffects
				// during addClass, so spells should already be present
				const spells = state.getSpells();
				const bless = spells.find(s => s.name === "bless");
				expect(bless).toBeTruthy();
				expect(bless.alwaysPrepared).toBe(true);
				expect(bless.prepared).toBe(true);

				// Calling again should be idempotent (no duplicates)
				const added = state.populateSubclassSpells();
				expect(added).toBe(0);
			});

			it("should not duplicate existing spells", () => {
				// Add bless manually BEFORE adding the class
				state.addSpell({name: "bless", source: "PHB", level: 1, prepared: false});

				state.addClass({
					name: "Cleric",
					level: 3,
					source: "PHB",
					subclass: {
						name: "Life Domain",
						source: "PHB",
						additionalSpells: [{
							prepared: {1: ["bless|PHB"]},
						}],
					},
				});

				const spells = state.getSpells().filter(s => s.name === "bless");
				expect(spells.length).toBe(1); // No duplicates
				expect(spells[0].alwaysPrepared).toBe(true);
			});
		});

		describe("getAlwaysPreparedSpells", () => {
			it("should return all always-prepared spells", () => {
				state.addSpell({name: "bless", source: "PHB", level: 1, alwaysPrepared: true, prepared: true});
				state.addSpell({name: "fireball", source: "PHB", level: 3, prepared: true});
				state.addSpell({name: "cure wounds", source: "PHB", level: 1, alwaysPrepared: true, prepared: true});

				const alwaysPrep = state.getAlwaysPreparedSpells();
				expect(alwaysPrep.length).toBe(2);
				expect(alwaysPrep.find(s => s.name === "bless")).toBeTruthy();
				expect(alwaysPrep.find(s => s.name === "cure wounds")).toBeTruthy();
				expect(alwaysPrep.find(s => s.name === "fireball")).toBeFalsy();
			});
		});

		describe("removeSubclassSpells", () => {
			it("should remove spells from a specific source feature", () => {
				state.addSpell({name: "bless", source: "PHB", level: 1, alwaysPrepared: true, prepared: true, sourceFeature: "Life Domain Spells"});
				state.addSpell({name: "fireball", source: "PHB", level: 3, prepared: true});
				state.addSpell({name: "cure wounds", source: "PHB", level: 1, alwaysPrepared: true, prepared: true, sourceFeature: "Life Domain Spells"});

				state.removeSubclassSpells("Life Domain Spells");

				const spells = state.getSpells().filter(s => s.level > 0);
				expect(spells.length).toBe(1);
				expect(spells[0].name).toBe("fireball");
			});

			it("should not remove manually added spells", () => {
				state.addSpell({name: "bless", source: "PHB", level: 1, prepared: true}); // No sourceFeature
				state.removeSubclassSpells("Life Domain Spells");

				const spells = state.getSpells().filter(s => s.name === "bless");
				expect(spells.length).toBe(1);
			});
		});

		describe("_parseSpellReference", () => {
			it("should parse name|source format", () => {
				const result = state._parseSpellReference("bless|PHB");
				expect(result.name).toBe("bless");
				expect(result.source).toBe("PHB");
				expect(result.isCantrip).toBe(false);
			});

			it("should parse name-only format with PHB default", () => {
				const result = state._parseSpellReference("bless");
				expect(result.name).toBe("bless");
				expect(result.source).toBe("PHB");
				expect(result.isCantrip).toBe(false);
			});

			it("should parse object format", () => {
				const result = state._parseSpellReference({name: "fireball", source: "XPHB", level: 3});
				expect(result.name).toBe("fireball");
				expect(result.source).toBe("XPHB");
				expect(result.level).toBe(3);
				expect(result.isCantrip).toBe(false);
			});

			it("should strip #c suffix and set isCantrip for name-only cantrip", () => {
				const result = state._parseSpellReference("light#c");
				expect(result.name).toBe("light");
				expect(result.source).toBe("PHB");
				expect(result.isCantrip).toBe(true);
			});

			it("should strip #c suffix and set isCantrip for name|source cantrip", () => {
				const result = state._parseSpellReference("mind sliver|tce#c");
				expect(result.name).toBe("mind sliver");
				expect(result.source).toBe("tce");
				expect(result.isCantrip).toBe(true);
			});

			it("should strip #c suffix for XPHB cantrip references", () => {
				const result = state._parseSpellReference("sacred flame|xphb#c");
				expect(result.name).toBe("sacred flame");
				expect(result.source).toBe("xphb");
				expect(result.isCantrip).toBe(true);
			});

			it("should return null for invalid input", () => {
				expect(state._parseSpellReference(null)).toBeNull();
				expect(state._parseSpellReference(42)).toBeNull();
				expect(state._parseSpellReference(undefined)).toBeNull();
			});
		});

		describe("Cantrips in known/prepared blocks", () => {
			it("should route cantrips from known block to cantripsKnown", () => {
				state.addClass({
					name: "Sorcerer",
					level: 1,
					source: "PHB",
					subclass: {
						name: "Aberrant Mind",
						source: "TCE",
						additionalSpells: [{
							known: {
								"1": [
									"mind sliver|tce#c",
									"arms of hadar",
									"dissonant whispers",
								],
							},
						}],
					},
				});

				// populateSubclassSpells is auto-called via applyClassFeatureEffects
				const cantrips = state.getCantrips();
				const spellsOnly = state.getSpellsKnown();

				// Mind Sliver should be in cantrips, not spells
				expect(cantrips.some(c => c.name.toLowerCase() === "mind sliver")).toBe(true);
				// Regular spells should be in spells
				expect(spellsOnly.some(s => s.name.toLowerCase() === "arms of hadar")).toBe(true);
				expect(spellsOnly.some(s => s.name.toLowerCase() === "dissonant whispers")).toBe(true);
				// Mind Sliver should NOT be in spellsKnown (only in cantrips)
				expect(spellsOnly.some(s => s.name.toLowerCase() === "mind sliver")).toBe(false);
			});

			it("should handle Cleric prepared block without cantrips", () => {
				state.addClass({
					name: "Cleric",
					level: 3,
					source: "PHB",
					subclass: {
						name: "Knowledge Domain",
						source: "PHB",
						additionalSpells: [{
							prepared: {
								"1": ["command", "identify"],
								"3": ["augury", "suggestion"],
							},
						}],
					},
				});

				const spells = state.getSpells();
				expect(spells.some(s => s.name.toLowerCase() === "command")).toBe(true);
				expect(spells.some(s => s.name.toLowerCase() === "augury")).toBe(true);
				// All should be always prepared
				const command = spells.find(s => s.name.toLowerCase() === "command");
				expect(command.alwaysPrepared).toBe(true);
			});
		});
	});
});
