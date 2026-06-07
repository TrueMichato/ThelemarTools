/**
 * Hunter's Prey toggle (Ranger "Hunter" subclass).
 *
 * Covers the bugfix that replaces the legacy consumable "Use" resource with a
 * toggle between Colossus Slayer / Horde Breaker (and Giant Killer in the 2014
 * ruleset), swappable on a rest:
 * - hasHuntersPrey detection (Ranger Hunter L3+)
 * - getHuntersPreyOptions edition-awareness (2024 = 2 options, 2014 = 3)
 * - get/setHuntersPreyOption validation
 * - getFeatureCalculations option-aware effects
 * - addFeature no longer auto-creates a resource / uses for Hunter's Prey
 * - loadFromJson migration strips the orphan resource and feature uses
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Hunter's Prey toggle", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	function makeHunter (level, subclassSource = "TGTT-2024") {
		state.addClass({
			name: "Ranger",
			source: "TGTT",
			level,
			subclass: level >= 3
				? {name: "Hunter", shortName: "Hunter", source: subclassSource}
				: undefined,
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	}

	// =========================================================================
	// DETECTION
	// =========================================================================
	describe("hasHuntersPrey", () => {
		it("is true for a Ranger Hunter at level 3+", () => {
			makeHunter(3);
			expect(state.hasHuntersPrey()).toBe(true);
		});

		it("is false below level 3", () => {
			makeHunter(2);
			expect(state.hasHuntersPrey()).toBe(false);
		});

		it("is false for a Ranger with a different subclass", () => {
			state.addClass({
				name: "Ranger",
				source: "TGTT",
				level: 5,
				subclass: {name: "Gloom Stalker", shortName: "Gloom Stalker", source: "TGTT-2024"},
			});
			expect(state.hasHuntersPrey()).toBe(false);
		});

		it("is false for a non-Ranger class", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 5});
			expect(state.hasHuntersPrey()).toBe(false);
		});
	});

	// =========================================================================
	// OPTIONS (edition-aware)
	// =========================================================================
	describe("getHuntersPreyOptions", () => {
		it("offers two options for the 2024 Hunter (TGTT-2024)", () => {
			makeHunter(3, "TGTT-2024");
			const ids = state.getHuntersPreyOptions().map(o => o.id);
			expect(ids).toEqual(["colossus", "horde"]);
		});

		it("offers two options for the XPHB Hunter", () => {
			makeHunter(3, "XPHB");
			const ids = state.getHuntersPreyOptions().map(o => o.id);
			expect(ids).toEqual(["colossus", "horde"]);
		});

		it("offers Giant Killer for the 2014 Hunter (classic)", () => {
			makeHunter(3, "PHB");
			const ids = state.getHuntersPreyOptions().map(o => o.id);
			expect(ids).toEqual(["colossus", "giantKiller", "horde"]);
		});
	});

	// =========================================================================
	// GET / SET
	// =========================================================================
	describe("get/setHuntersPreyOption", () => {
		it("defaults to Colossus Slayer", () => {
			makeHunter(3);
			expect(state.getHuntersPreyOption()).toBe("colossus");
		});

		it("sets a valid option", () => {
			makeHunter(3);
			expect(state.setHuntersPreyOption("horde")).toBe(true);
			expect(state.getHuntersPreyOption()).toBe("horde");
		});

		it("rejects an invalid option and leaves the current pick unchanged", () => {
			makeHunter(3);
			expect(state.setHuntersPreyOption("colossus")).toBe(true);
			expect(state.setHuntersPreyOption("nonsense")).toBe(false);
			expect(state.getHuntersPreyOption()).toBe("colossus");
		});

		it("rejects Giant Killer for a 2024 Hunter", () => {
			makeHunter(3, "TGTT-2024");
			expect(state.setHuntersPreyOption("giantKiller")).toBe(false);
		});

		it("accepts Giant Killer for a 2014 Hunter", () => {
			makeHunter(3, "PHB");
			expect(state.setHuntersPreyOption("giantKiller")).toBe(true);
			expect(state.getHuntersPreyOption()).toBe("giantKiller");
		});
	});

	// =========================================================================
	// FEATURE CALCULATIONS
	// =========================================================================
	describe("getFeatureCalculations", () => {
		it("exposes Colossus Slayer damage when that option is active", () => {
			makeHunter(5);
			state.setHuntersPreyOption("colossus");
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasHuntersPrey).toBe(true);
			expect(calcs.huntersPreyOption).toBe("colossus");
			expect(calcs.colossusSlayerDamage).toBe("1d8");
			expect(calcs.hasHordeBreaker).toBeFalsy();
		});

		it("flags Horde Breaker and drops Colossus damage when Horde Breaker is active", () => {
			makeHunter(5);
			state.setHuntersPreyOption("horde");
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.huntersPreyOption).toBe("horde");
			expect(calcs.hasHordeBreaker).toBe(true);
			expect(calcs.colossusSlayerDamage).toBeUndefined();
		});

		it("flags Giant Killer for a 2014 Hunter", () => {
			makeHunter(5, "PHB");
			state.setHuntersPreyOption("giantKiller");
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.huntersPreyOption).toBe("giantKiller");
			expect(calcs.hasGiantKiller).toBe(true);
			expect(calcs.colossusSlayerDamage).toBeUndefined();
		});
	});

	// =========================================================================
	// RESOURCE SUPPRESSION
	// =========================================================================
	describe("addFeature does not create a consumable for Hunter's Prey", () => {
		it("does not stamp uses on the feature or create a resource", () => {
			makeHunter(3);
			state.addFeature({
				name: "Hunter's Prey",
				source: "TGTT",
				featureType: "Subclass",
				className: "Ranger",
				subclassName: "Hunter",
				level: 3,
				description: "3rd-level Hunter feature. You gain one of the following options. Whenever you finish a Short Rest or Long Rest, you can replace the chosen option with the other one. Colossus Slayer: Your tenacity can wear down even the most resilient foe. When you hit a creature with a weapon, the creature takes an extra 1d8 damage if it's below its hit point maximum. You can deal this extra damage only once per turn.",
			});

			const feature = state.getFeatures().find(f => f.name === "Hunter's Prey");
			expect(feature).toBeDefined();
			expect(feature.uses).toBeUndefined();

			const resource = state.getResources().find(r => r.name === "Hunter's Prey");
			expect(resource).toBeUndefined();
		});
	});

	// =========================================================================
	// MIGRATION
	// =========================================================================
	describe("loadFromJson migration", () => {
		it("removes the legacy orphan resource and strips feature uses", () => {
			const json = {
				classes: [
					{
						name: "Ranger",
						source: "TGTT",
						level: 6,
						subclass: {name: "Hunter", shortName: "Hunter", source: "TGTT-2024"},
					},
				],
				features: [
					{
						id: "feat-hp",
						name: "Hunter's Prey",
						source: "TGTT",
						className: "Ranger",
						level: 3,
						featureType: "Subclass",
						description: "Whenever you finish a Short Rest or Long Rest... once per turn.",
						uses: {current: 0, max: 1, recharge: "short"},
					},
				],
				resources: [
					{id: "res-hp", name: "Hunter's Prey", current: 0, max: 1, recharge: "short", featureId: "feat-hp"},
				],
			};

			state.loadFromJson(json);

			const feature = state.getFeatures().find(f => f.name === "Hunter's Prey");
			expect(feature).toBeDefined();
			expect(feature.uses).toBeUndefined();

			const resource = state.getResources().find(r => r.name === "Hunter's Prey");
			expect(resource).toBeUndefined();

			// Toggle state initialised, defaulting to Colossus Slayer
			expect(state.getHuntersPreyOption()).toBe("colossus");
		});

		it("leaves non-Hunter characters untouched", () => {
			const json = {
				classes: [{name: "Fighter", source: "XPHB", level: 5}],
				features: [],
				resources: [
					{id: "res-x", name: "Second Wind", current: 1, max: 1, recharge: "short"},
				],
			};

			state.loadFromJson(json);
			expect(state.getResources().some(r => r.name === "Second Wind")).toBe(true);
		});
	});
});
