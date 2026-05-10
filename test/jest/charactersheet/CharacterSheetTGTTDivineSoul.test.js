/**
 * TGTT Divine Soul Sorcerer — Full L1→20 test coverage.
 *
 * Covers:
 * - Font of Magic starting at L1 (TGTT), not L2
 * - Metamagic at L2 (TGTT), not L3. Progression: 2/3/4/5/6/7 at 2/3/6/10/13/17
 * - Active vs Passive Metamagic (TGTT split)
 * - Sorcery point economy (tuning, locking, effective max)
 * - Sorcerer Specialties at 4, 8, 12, 16, 20
 * - Divine Soul subclass features:
 *     Divine Magic (L3), Favored by the Gods (L3),
 *     Empowered Healing (L6), Angelic Form (L14),
 *     Unearthly Recovery (L18)
 * - Spell slot progression (full caster)
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Divine Soul Sorcerer", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER
	// =========================================================================
	function makeDivineSoul (level) {
		state.addClass({
			name: "Sorcerer",
			source: "TGTT",
			level,
			subclass: level >= 3
				? {
					name: "Divine Soul",
					shortName: "Divine Soul",
					source: "TGTT",
					additionalSpells: [
						{name: "Good", known: {"1": ["cure wounds|PHB"]}},
						{name: "Evil", known: {"1": ["inflict wounds|PHB"]}},
						{name: "Law", known: {"1": ["bless|PHB"]}},
						{name: "Chaos", known: {"1": ["bane|PHB"]}},
						{name: "Neutrality", known: {"1": ["protection from evil and good|PHB"]}},
					],
				}
				: undefined,
		});
		state.setAbilityBase("str", 8);
		state.setAbilityBase("dex", 14); // +2
		state.setAbilityBase("con", 14); // +2
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12); // +1
		state.setAbilityBase("cha", 18); // +4
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Sorcerer", () => {
			makeDivineSoul(1);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Sorcerer");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Divine Soul subclass at level 3", () => {
			makeDivineSoul(3);
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Divine Soul");
		});

		it("should use CHA as spellcasting ability", () => {
			makeDivineSoul(5);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// Spell DC = 8 + prof(3) + CHA(4) = 15
			expect(calcs.spellSaveDc).toBe(15);
			expect(calcs.spellAttackBonus).toBe(7);
		});

		it("should persist and normalize a Divine Soul affinity choice", () => {
			makeDivineSoul(3);
			state.setSubclassChoice("Sorcerer", "Good");

			expect(state.getSubclassChoice("Sorcerer")).toEqual({key: "good", name: "Good"});
		});

		it("should add the Divine Soul affinity spell once the choice is set", () => {
			makeDivineSoul(3);
			state.setSubclassChoice("Sorcerer", "Good");

			expect(state.ensureDivineSoulKnownSpell("Sorcerer")).toBe(true);
			expect(state.ensureDivineSoulKnownSpell("Sorcerer")).toBe(false);

			const spells = state.getSpells();
			expect(spells.some(sp => sp.name === "cure wounds" && sp.source === "PHB")).toBe(true);
		});
	});

	// =========================================================================
	// FONT OF MAGIC — starts at L1 in TGTT (not L2)
	// =========================================================================
	describe("Font of Magic (TGTT: starts at Level 1)", () => {
		it("should grant sorcery points at level 1 (TGTT: SP = level + 1)", () => {
			makeDivineSoul(1);
			const calcs = state.getFeatureCalculations();
			// TGTT: Font of Magic at L1 with SP = level + 1 = 2
			expect(calcs.hasFontOfMagic).toBe(true);
			expect(calcs.sorceryPoints).toBe(2);
		});

		it("should scale sorcery points = level + 1 per TGTT table", () => {
			const levels = [1, 2, 5, 10, 15, 20];
			levels.forEach(lvl => {
				const s = new CharacterSheetState();
				s.addClass({name: "Sorcerer", source: "TGTT", level: lvl});
				const calcs = s.getFeatureCalculations();
				expect(calcs.sorceryPoints).toBe(lvl + 1);
			});
		});
	});

	// =========================================================================
	// METAMAGIC SYSTEM (TGTT: starts at L2, Active/Passive split)
	// =========================================================================
	describe("Metamagic System", () => {
		describe("Metamagic Progression (TGTT schedule)", () => {
			it("should have Metamagic starting at level 2 (not level 3)", () => {
				makeDivineSoul(2);
				const calcs = state.getFeatureCalculations();
				expect(calcs.hasMetamagic).toBe(true);
				expect(calcs.metamagicOptions).toBe(2);
			});

			it("should follow TGTT progression: 2/3/4/5/6/7", () => {
				const progression = [
					{level: 2, options: 2},
					{level: 3, options: 3},
					{level: 6, options: 4},
					{level: 10, options: 5},
					{level: 13, options: 6},
					{level: 17, options: 7},
				];

				for (const {level, options} of progression) {
					const s = new CharacterSheetState();
					s.addClass({name: "Sorcerer", source: "TGTT", level});
					const calcs = s.getFeatureCalculations();
					expect(calcs.metamagicOptions).toBe(options);
				}
			});

			it("should differ from XPHB progression", () => {
				const tgtt = new CharacterSheetState();
				tgtt.addClass({name: "Sorcerer", source: "TGTT", level: 6});

				const xphb = new CharacterSheetState();
				xphb.addClass({name: "Sorcerer", source: "XPHB", level: 6});

				expect(tgtt.getFeatureCalculations().metamagicOptions).toBe(4);
				expect(xphb.getFeatureCalculations().metamagicOptions).toBe(2);
			});
		});

		describe("Passive Metamagics", () => {
			beforeEach(() => {
				makeDivineSoul(5);
				state.setSorceryPoints(5);
			});

			it("should list passive metamagic definitions", () => {
				const passives = state.getPassiveMetamagics();
				expect(passives.length).toBeGreaterThan(0);

				const keys = passives.map(m => m.key);
				expect(keys).toContain("careful");
				expect(keys).toContain("distant");
				expect(keys).toContain("empowered");
				expect(keys).toContain("warding");
			});

			it("should tune a passive metamagic", () => {
				expect(state.isMetamagicTuned("careful")).toBe(false);
				const result = state.tuneMetamagic("careful");
				expect(result).toBe(true);
				expect(state.isMetamagicTuned("careful")).toBe(true);
			});

			it("should not allow tuning active metamagics", () => {
				const result = state.tuneMetamagic("quickened");
				expect(result).toBe(false);
			});

			it("should lock sorcery points when tuning passives", () => {
				expect(state.getLockedSorceryPoints()).toBe(0);

				state.tuneMetamagic("careful"); // cost 1
				expect(state.getLockedSorceryPoints()).toBe(1);

				state.tuneMetamagic("warding"); // cost 2
				expect(state.getLockedSorceryPoints()).toBe(3);
			});

			it("should calculate effective SP max correctly", () => {
				expect(state.getEffectiveSorceryPointMax()).toBe(5);

				state.tuneMetamagic("careful"); // locks 1
				expect(state.getEffectiveSorceryPointMax()).toBe(4);
			});

			it("should free locked SP when detuning", () => {
				state.tuneMetamagic("careful");
				state.tuneMetamagic("distant");
				expect(state.getLockedSorceryPoints()).toBe(2);

				state.detuneMetamagic("careful");
				expect(state.getLockedSorceryPoints()).toBe(1);
			});

			it("should not allow tuning if insufficient effective SP", () => {
				// Lock 4 SP (careful=1, distant=1, supple=2)
				state.tuneMetamagic("careful");
				state.tuneMetamagic("distant");
				state.tuneMetamagic("supple");

				// Effective max is now 1, can't tune resonant (cost 2)
				const result = state.tuneMetamagic("resonant");
				expect(result).toBe(false);
			});
		});

		describe("Active Metamagics", () => {
			it("should list active metamagics including TGTT additions", () => {
				makeDivineSoul(5);
				state.setSorceryPoints(5);
				const actives = state.getActiveMetamagics();
				const keys = actives.map(m => m.key);

				// Standard
				expect(keys).toContain("quickened");
				expect(keys).toContain("twinned");
				expect(keys).toContain("subtle");

				// TGTT-specific
				expect(keys).toContain("aimed");
				expect(keys).toContain("focused");
				expect(keys).toContain("overcharged");
			});

			it("should have correct TGTT metamagic costs", () => {
				makeDivineSoul(5);
				state.setSorceryPoints(5);

				expect(state.getMetamagicInfo("aimed").cost).toBe(2);
				expect(state.getMetamagicInfo("overcharged").cost).toBe(4);
				expect(state.getMetamagicInfo("bouncing").cost).toBe(3);
			});
		});

		describe("Metamagic Info API", () => {
			it("should return full metamagic info with tuned status", () => {
				makeDivineSoul(5);
				state.setSorceryPoints(5);
				state.tuneMetamagic("careful");

				const info = state.getMetamagicInfo("careful");
				expect(info.name).toBe("Careful Spell");
				expect(info.type).toBe("passive");
				expect(info.tuned).toBe(true);
			});

			it("should return null for unknown metamagic", () => {
				makeDivineSoul(5);
				state.setSorceryPoints(5);
				expect(state.getMetamagicInfo("nonexistent")).toBeNull();
			});
		});

		// =====================================================================
		// COMPLETE PASSIVE METAMAGIC CATALOG
		// =====================================================================
		describe("Complete Passive Metamagic Catalog", () => {
			const passiveCatalog = [
				{key: "careful", name: "Careful Spell", cost: 1},
				{key: "distant", name: "Distant Spell", cost: 1},
				{key: "empowered", name: "Empowered Spell", cost: 1},
				{key: "extended", name: "Extended Spell", cost: 1},
				{key: "transmuted", name: "Transmuted Spell", cost: 1},
				{key: "resonant", name: "Resonant Spell", cost: 2},
				{key: "split", name: "Split Spell", cost: 1},
				{key: "supple", name: "Supple Spell", cost: 2},
				{key: "warding", name: "Warding Spell", cost: 2},
			];

			beforeEach(() => {
				makeDivineSoul(10);
				state.setSorceryPoints(11); // TGTT L10: 10 + 1 = 11
			});

			passiveCatalog.forEach(({key, name, cost}) => {
				it(`should include "${name}" (key=${key}, cost=${cost})`, () => {
					const passives = state.getPassiveMetamagics();
					const meta = passives.find(m => m.key === key);
					expect(meta).toBeDefined();
					expect(meta.name).toBe(name);
					expect(meta.cost).toBe(cost);
				});
			});

			it("should have exactly 9 passive metamagics", () => {
				const passives = state.getPassiveMetamagics();
				expect(passives.length).toBe(9);
			});
		});

		// =====================================================================
		// COMPLETE ACTIVE METAMAGIC CATALOG
		// =====================================================================
		describe("Complete Active Metamagic Catalog", () => {
			const activeCatalog = [
				{key: "heightened", name: "Heightened Spell", cost: 3},
				{key: "quickened", name: "Quickened Spell", cost: 2},
				{key: "seeking", name: "Seeking Spell", cost: 2},
				{key: "subtle", name: "Subtle Spell", cost: 1},
				{key: "twinned", name: "Twinned Spell", cost: "level"},
				{key: "aimed", name: "Aimed Spell", cost: 2},
				{key: "bestowed", name: "Bestowed Spell", cost: "level"},
				{key: "bouncing", name: "Bouncing Spell", cost: 3},
				{key: "focused", name: "Focused Spell", cost: "level"},
				{key: "lingering", name: "Lingering Spell", cost: "level"},
				{key: "overcharged", name: "Overcharged Spell", cost: 4},
				{key: "vampiric", name: "Vampiric Spell", cost: "halfLevel"},
			];

			beforeEach(() => {
				makeDivineSoul(10);
				state.setSorceryPoints(11);
			});

			activeCatalog.forEach(({key, name, cost}) => {
				it(`should include "${name}" (key=${key}, cost=${cost})`, () => {
					const actives = state.getActiveMetamagics();
					const meta = actives.find(m => m.key === key);
					expect(meta).toBeDefined();
					expect(meta.name).toBe(name);
					expect(meta.cost).toBe(cost);
				});
			});

			it("should have exactly 12 active metamagics", () => {
				const actives = state.getActiveMetamagics();
				expect(actives.length).toBe(12);
			});
		});

		// =====================================================================
		// TUNE / DETUNE ECONOMICS
		// =====================================================================
		describe("Tune/Detune Economics", () => {
			beforeEach(() => {
				makeDivineSoul(10); // SP max = 11
				state.setSorceryPoints(11);
			});

			it("should track tuned metamagics via getTunedMetamagics()", () => {
				state.tuneMetamagic("careful");
				state.tuneMetamagic("distant");
				const tuned = state.getTunedMetamagics();
				expect(tuned).toContain("careful");
				expect(tuned).toContain("distant");
				expect(tuned.length).toBe(2);
			});

			it("should reduce effective SP max by cumulative tuning costs", () => {
				// careful(1) + warding(2) + resonant(2) = 5 locked
				state.tuneMetamagic("careful");
				state.tuneMetamagic("warding");
				state.tuneMetamagic("resonant");
				expect(state.getLockedSorceryPoints()).toBe(5);
				expect(state.getEffectiveSorceryPointMax()).toBe(6); // 11 - 5
			});

			it("should restore effective SP when detuning", () => {
				state.tuneMetamagic("warding"); // cost 2
				state.tuneMetamagic("supple"); // cost 2
				expect(state.getLockedSorceryPoints()).toBe(4);
				expect(state.getEffectiveSorceryPointMax()).toBe(7);

				state.detuneMetamagic("warding");
				expect(state.getLockedSorceryPoints()).toBe(2);
				expect(state.getEffectiveSorceryPointMax()).toBe(9);
			});

			it("should prevent tuning when effective SP < cost", () => {
				// Lock 10 SP: careful(1) + distant(1) + empowered(1) + extended(1) + transmuted(1) + split(1) + resonant(2) + warding(2) = 10
				state.tuneMetamagic("careful");
				state.tuneMetamagic("distant");
				state.tuneMetamagic("empowered");
				state.tuneMetamagic("extended");
				state.tuneMetamagic("transmuted");
				state.tuneMetamagic("split");
				state.tuneMetamagic("resonant");
				state.tuneMetamagic("warding");
				expect(state.getLockedSorceryPoints()).toBe(10);
				expect(state.getEffectiveSorceryPointMax()).toBe(1);

				// supple costs 2, effective max is 1 → should fail
				const result = state.tuneMetamagic("supple");
				expect(result).toBe(false);
			});

			it("should not allow tuning an already-tuned metamagic", () => {
				state.tuneMetamagic("careful");
				const result = state.tuneMetamagic("careful");
				expect(result).toBe(false);
			});

			it("should report tuned status via getMetamagicInfo()", () => {
				state.tuneMetamagic("careful");
				expect(state.getMetamagicInfo("careful").tuned).toBe(true);

				state.detuneMetamagic("careful");
				expect(state.getMetamagicInfo("careful").tuned).toBe(false);
			});

			it("should tune all 5 cost-1 passives (total locked = 5)", () => {
				["careful", "distant", "empowered", "extended", "transmuted"].forEach(k => {
					expect(state.tuneMetamagic(k)).toBe(true);
				});
				expect(state.getLockedSorceryPoints()).toBe(5);
			});
		});

		describe("Active Metamagic Cast Helpers", () => {
			beforeEach(() => {
				makeDivineSoul(10);
				state.setSorceryPoints(11);
				[
					"Subtle Spell",
					"Focused Spell",
					"Aimed Spell",
					"Heightened Spell",
					"Bestowed Spell",
					"Twinned Spell",
					"Vampiric Spell",
				].forEach(name => {
					state.addFeature({
						name,
						source: "TGTT",
						featureType: "Optional Feature",
						optionalFeatureTypes: ["MM"],
					});
				});
			});

			it("should return only known active metamagics", () => {
				const keys = state.getKnownActiveMetamagics().map(it => it.key).sort();
				expect(keys).toEqual(["aimed", "bestowed", "focused", "heightened", "subtle", "twinned", "vampiric"]);
			});

			it("should calculate variable active metamagic costs from spell level", () => {
				expect(state.getMetamagicCost("subtle", 3)).toBe(1);
				expect(state.getMetamagicCost("twinned", 3)).toBe(3);
				expect(state.getMetamagicCost("twinned", 0)).toBe(1);
				expect(state.getMetamagicCost("vampiric", 5)).toBe(3);
			});

			it("should mark active metamagics unavailable when spell requirements are not met", () => {
				const options = state.getCastableActiveMetamagics({
					spell: {name: "Magic Missile", level: 1},
					spellData: {
						name: "Magic Missile",
						range: {type: "point", distance: {type: "point", amount: 120}},
						duration: [{type: "instant"}],
						entries: ["Three glowing darts of magical force."],
					},
					slotLevel: 1,
				});

				expect(options.find(it => it.key === "focused").isAvailable).toBe(false);
				expect(options.find(it => it.key === "aimed").unavailableReason).toBe("Requires a spell attack roll");
				expect(options.find(it => it.key === "heightened").unavailableReason).toBe("Requires a spell with a saving throw");
				expect(options.find(it => it.key === "bestowed").unavailableReason).toBe("Requires a spell with range: self");
				expect(options.find(it => it.key === "subtle").isAvailable).toBe(true);
			});

			it("should mark active metamagics unavailable when sorcery points are insufficient", () => {
				state.setSorceryPoints(1);
				const options = state.getCastableActiveMetamagics({
					spell: {name: "Hold Person", level: 2},
					spellData: {
						name: "Hold Person",
						savingThrow: ["wisdom"],
						range: {type: "point", distance: {type: "point", amount: 60}},
						duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
						entries: ["Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed."],
					},
					slotLevel: 2,
				});

				expect(options.find(it => it.key === "subtle").isAvailable).toBe(true);
				expect(options.find(it => it.key === "heightened").isAvailable).toBe(false);
				expect(options.find(it => it.key === "heightened").unavailableReason).toBe("Requires 3 sorcery points (1 available)");
				expect(options.find(it => it.key === "twinned").unavailableReason).toBe("Requires 2 sorcery points (1 available)");
			});
		});
	});

	// =========================================================================
	// FONT OF MAGIC — SP / SLOT CONVERSION
	// =========================================================================
	describe("Font of Magic — SP/Slot Conversion", () => {
		beforeEach(() => {
			makeDivineSoul(7); // SP max = 8
			state.setSorceryPoints(8);
			state.calculateSpellSlots();
		});

		describe("Conversion Cost Tables", () => {
			const spToSlotCosts = [
				{slotLevel: 1, cost: 2},
				{slotLevel: 2, cost: 3},
				{slotLevel: 3, cost: 5},
				{slotLevel: 4, cost: 6},
				{slotLevel: 5, cost: 7},
			];

			spToSlotCosts.forEach(({slotLevel, cost}) => {
				it(`should cost ${cost} SP to create a level-${slotLevel} slot`, () => {
					expect(state.getSpToSlotCost(slotLevel)).toBe(cost);
				});
			});

			it("should return null for invalid slot levels (0 and 6+)", () => {
				expect(state.getSpToSlotCost(0)).toBeNull();
				expect(state.getSpToSlotCost(6)).toBeNull();
			});

			const slotToSpReturns = [
				{slotLevel: 1, spReturn: 1},
				{slotLevel: 2, spReturn: 2},
				{slotLevel: 3, spReturn: 3},
				{slotLevel: 4, spReturn: 4},
				{slotLevel: 5, spReturn: 5},
			];

			slotToSpReturns.forEach(({slotLevel, spReturn}) => {
				it(`should return ${spReturn} SP when converting a level-${slotLevel} slot`, () => {
					expect(state.getSlotToSpReturn(slotLevel)).toBe(spReturn);
				});
			});
		});

		describe("Max Convertible Slot Level", () => {
			it("should allow converting up to level 5 for TGTT (non-XPHB)", () => {
				expect(state.getMaxConvertibleSlotLevel()).toBe(5);
			});

			it("should only allow up to level 3 for XPHB Sorcerer", () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Sorcerer", source: "XPHB", level: 7});
				expect(s.getMaxConvertibleSlotLevel()).toBe(3);
			});
		});

		describe("Slot → SP Conversion", () => {
			it("should convert a level 1 spell slot to 1 SP", () => {
				// Drain some SP first so we're below max
				state.useSorceryPoint(4); // 8 → 4
				const spBefore = state.getSorceryPoints().current;
				const slotsBefore = state.getSpellSlotsCurrent(1);
				const result = state.convertSlotToSorceryPoints(1);
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(spBefore + 1);
				expect(state.getSpellSlotsCurrent(1)).toBe(slotsBefore - 1);
			});

			it("should convert a level 3 spell slot to 3 SP", () => {
				state.useSorceryPoint(5); // 8 → 3
				const spBefore = state.getSorceryPoints().current;
				const result = state.convertSlotToSorceryPoints(3);
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(spBefore + 3);
			});

			it("should fail when no slots remaining", () => {
				// Exhaust all level 4 slots
				const max4 = state.getSpellSlotsMax(4);
				for (let i = 0; i < max4; i++) state.convertSlotToSorceryPoints(4);
				// Now try again — should fail
				const result = state.convertSlotToSorceryPoints(4);
				expect(result).toBe(false);
			});
		});

		describe("SP → Slot Conversion", () => {
			it("should create a level 1 slot for 2 SP", () => {
				const spBefore = state.getSorceryPoints().current;
				const result = state.convertSorceryPointsToSlot(1);
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(spBefore - 2);
			});

			it("should create a level 3 slot for 5 SP", () => {
				const spBefore = state.getSorceryPoints().current;
				const result = state.convertSorceryPointsToSlot(3);
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(spBefore - 5);
			});

			it("should reject conversion above max convertible level", () => {
				state.setSorceryPoints(20);
				const maxLevel = state.getMaxConvertibleSlotLevel();
				const result = state.convertSorceryPointsToSlot(maxLevel + 1);
				expect(result).toBe(false);
			});

			it("should reject conversion with insufficient SP", () => {
				// Set SP to 1 — L1 slot costs 2
				state.setSorceryPoints({current: 1, max: 20});
				const result = state.convertSorceryPointsToSlot(1);
				expect(result).toBe(false);
			});
		});

		describe("useSorceryPoint()", () => {
			it("should deduct SP when sufficient", () => {
				const result = state.useSorceryPoint(3);
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(5); // 8 - 3
			});

			it("should fail when insufficient SP", () => {
				state.setSorceryPoints({current: 1, max: 8});
				const result = state.useSorceryPoint(3);
				expect(result).toBe(false);
				expect(state.getSorceryPoints().current).toBe(1);
			});

			it("should default to 1 SP", () => {
				const result = state.useSorceryPoint();
				expect(result).toBe(true);
				expect(state.getSorceryPoints().current).toBe(7); // 8 - 1
			});
		});
	});

	// =========================================================================
	// SORCERER SPECIALTIES (TGTT-specific)
	// =========================================================================
	describe("Sorcerer (TGTT) Specialties", () => {
		it("should accept Specialty features at levels 4, 8, 12, 16, 20", () => {
			makeDivineSoul(20);
			const specialtyLevels = [4, 8, 12, 16, 20];
			specialtyLevels.forEach(lvl => {
				state.addFeature({
					name: `Sorcerer Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Sorcerer",
					level: lvl,
					description: `Sorcerer specialty at level ${lvl}.`,
				});
			});

			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			specialtyLevels.forEach(lvl => {
				expect(features.some(f => f.name === `Sorcerer Specialty (Lv ${lvl})`)).toBe(true);
			});
		});
	});

	// =========================================================================
	// DIVINE SOUL SUBCLASS FEATURES
	// =========================================================================
	describe("Divine Soul Subclass Features", () => {
		describe("Divine Magic (Level 3)", () => {
			it("should grant Divine Magic feature", () => {
				makeDivineSoul(3);
				state.addFeature({
					name: "Divine Magic",
					source: "TGTT",
					featureType: "Subclass",
					className: "Sorcerer",
					subclassName: "Divine Soul",
					level: 3,
					description: "Your link to the divine allows you to learn spells from the cleric spell list.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Divine Magic")).toBe(true);
			});
		});

		describe("Favored by the Gods (Level 3)", () => {
			it("should grant Favored by the Gods at level 3", () => {
				makeDivineSoul(3);
				state.addFeature({
					name: "Favored by the Gods",
					source: "TGTT",
					featureType: "Subclass",
					className: "Sorcerer",
					subclassName: "Divine Soul",
					level: 3,
					description: "You can add 2d4 to a failed saving throw or missed attack roll. Once per short or long rest.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Favored by the Gods")).toBe(true);
			});

			it("should track Favored by the Gods resource (short rest recharge)", () => {
				makeDivineSoul(3);
				state.addResource({name: "Favored by the Gods", max: 1, current: 1, recharge: "short"});

				const res = state.getResource("Favored by the Gods");
				expect(res.max).toBe(1);
				expect(res.recharge).toBe("short");
			});

			it("should compute favoredByTheGodsBonus = '2d4'", () => {
				makeDivineSoul(3);
				const calcs = state.getFeatureCalculations();
				expect(calcs.favoredByTheGodsBonus).toBe("2d4");
			});
		});

		describe("Empowered Healing (Level 6)", () => {
			it("should grant Empowered Healing at level 6", () => {
				makeDivineSoul(6);
				state.addFeature({
					name: "Empowered Healing",
					source: "TGTT",
					featureType: "Subclass",
					className: "Sorcerer",
					subclassName: "Divine Soul",
					level: 6,
					description: "When you or an ally within 5 feet rolls dice to determine HP regained by a spell, you can spend 1 sorcery point to reroll any number of those dice once.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Empowered Healing")).toBe(true);
			});
		});

		describe("Angelic Form (Level 14)", () => {
			it("should grant Angelic Form at level 14", () => {
				makeDivineSoul(14);
				state.addFeature({
					name: "Angelic Form",
					source: "TGTT",
					featureType: "Subclass",
					className: "Sorcerer",
					subclassName: "Divine Soul",
					level: 14,
					description: "You can use a bonus action to manifest spectral wings, gaining a flying speed of 30 feet.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Angelic Form")).toBe(true);
			});

			it("should compute flySpeed = 30", () => {
				makeDivineSoul(14);
				const calcs = state.getFeatureCalculations();
				expect(calcs.flySpeed).toBe(30);
			});
		});

		describe("Unearthly Recovery (Level 18)", () => {
			it("should grant Unearthly Recovery at level 18", () => {
				makeDivineSoul(18);
				state.addFeature({
					name: "Unearthly Recovery",
					source: "TGTT",
					featureType: "Subclass",
					className: "Sorcerer",
					subclassName: "Divine Soul",
					level: 18,
					description: "When you are reduced to fewer than half your hit points, you can use a bonus action to regain hit points equal to half your hit point maximum.",
				});
				state.addResource({name: "Unearthly Recovery", max: 1, current: 1, recharge: "long"});
				state.applyClassFeatureEffects();

				const features = state.getFeatures();
				expect(features.some(f => f.name === "Unearthly Recovery")).toBe(true);

				const res = state.getResource("Unearthly Recovery");
				expect(res.max).toBe(1);
				expect(res.recharge).toBe("long");
			});

			it("should compute unearthlyRecoveryHp at level 18", () => {
				makeDivineSoul(18);
				const calcs = state.getFeatureCalculations();
				// HP recovery = floor(maxHp / 2), or falls back to level
				expect(calcs.unearthlyRecoveryHp).toBeGreaterThanOrEqual(18);
			});
		});
	});

	// =========================================================================
	// SPELL SLOT PROGRESSION (Full Caster)
	// =========================================================================
	describe("Spell Slot Progression (Full Caster)", () => {
		const milestones = [
			{level: 1, maxSpellLevel: 1},
			{level: 3, maxSpellLevel: 2},
			{level: 5, maxSpellLevel: 3},
			{level: 9, maxSpellLevel: 5},
			{level: 11, maxSpellLevel: 6},
			{level: 13, maxSpellLevel: 7},
			{level: 15, maxSpellLevel: 8},
			{level: 17, maxSpellLevel: 9},
		];

		milestones.forEach(({level, maxSpellLevel}) => {
			it(`should have up to level-${maxSpellLevel} slots at Sorcerer level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Sorcerer", source: "TGTT", level});
				s.calculateSpellSlots();
				expect(s.getSpellSlotsMax(maxSpellLevel)).toBeGreaterThan(0);
				if (maxSpellLevel < 9) {
					expect(s.getSpellSlotsMax(maxSpellLevel + 1)).toBe(0);
				}
			});
		});
	});

	// =========================================================================
	// FULL L1→20 PROGRESSION
	// =========================================================================
	describe("Full L1→20 Progression", () => {
		it("should maintain valid state at every level", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Sorcerer",
					source: "TGTT",
					level: lvl,
					subclass: lvl >= 3
						? {name: "Divine Soul", shortName: "Divine Soul", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("cha", 18);

				expect(s.getTotalLevel()).toBe(lvl);
				s.applyClassFeatureEffects();
				const calcs = s.getFeatureCalculations();
				expect(calcs.spellSaveDc).toBeGreaterThanOrEqual(12);
			}
		});

		it("should track sorcery points = level + 1 at every level (TGTT)", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({name: "Sorcerer", source: "TGTT", level: lvl});
				const calcs = s.getFeatureCalculations();
				expect(calcs.sorceryPoints).toBe(lvl + 1);
			}
		});

		it("should track proficiency bonus correctly", () => {
			const profTable = [
				{level: 1, prof: 2}, {level: 4, prof: 2},
				{level: 5, prof: 3}, {level: 8, prof: 3},
				{level: 9, prof: 4}, {level: 12, prof: 4},
				{level: 13, prof: 5}, {level: 16, prof: 5},
				{level: 17, prof: 6}, {level: 20, prof: 6},
			];

			profTable.forEach(({level, prof}) => {
				const s = new CharacterSheetState();
				s.addClass({name: "Sorcerer", source: "TGTT", level});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
