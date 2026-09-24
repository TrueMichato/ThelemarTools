import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const getFeatureCompanionFields = () => ({
	featureGrant: {
		type: "subclassFeature",
		uid: "Steel Defender|Artificer|TCE|Battle Smith|TCE|3",
		className: "Artificer",
		classSource: "TCE",
		subclassShortName: "Battle Smith",
		subclassSource: "TCE",
		level: 3,
	},
	setup: {
		status: "pending",
		choices: {
			bodyPlan: "biped",
			sourceSpecific: {tool: "smith's tools"},
		},
	},
	scaling: {
		kind: "classSummon",
		descriptor: {className: "Artificer"},
	},
	lifecycle: {
		status: "active",
		createdAtGameMinute: 480,
		timingKnown: true,
	},
	uses: {
		repair: {
			current: 0,
			max: 3,
			recharge: "long",
			sourceSpecific: {toolChoice: "smith's tools"},
		},
	},
	turnUsage: {
		action: true,
		reaction: false,
		flags: {deflectAttack: true},
	},
	hitDice: {
		die: "d8",
		current: 1,
		max: 3,
	},
});

describe("Feature companion schema", () => {
	test("addCompanion preserves and deep-copies the optional feature companion fields", () => {
		const state = new CharacterSheetState();
		const fields = getFeatureCompanionFields();
		const id = state.addCompanion({
			name: "Schema Companion",
			type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			...fields,
		});

		const companion = state.getCompanion(id);
		expect(companion.featureGrant).toEqual(fields.featureGrant);
		expect(companion.setup).toEqual(fields.setup);
		expect(companion.scaling).toEqual(fields.scaling);
		expect(companion.lifecycle).toEqual({...fields.lifecycle, generation: 1});
		expect(companion.uses).toEqual(fields.uses);
		expect(companion.turnUsage).toEqual(fields.turnUsage);
		expect(companion.hitDice).toEqual(fields.hitDice);

		fields.featureGrant.classSource = "MUTATED";
		fields.setup.choices.sourceSpecific.tool = "mutated";
		fields.scaling.descriptor.className = "Mutated";
		fields.lifecycle.status = "destroyed";
		fields.uses.repair.sourceSpecific.toolChoice = "mutated";
		fields.turnUsage.flags.deflectAttack = false;
		fields.hitDice.current = 0;

		expect(companion.featureGrant.classSource).toBe("TCE");
		expect(companion.setup.choices.sourceSpecific.tool).toBe("smith's tools");
		expect(companion.scaling.descriptor.className).toBe("Artificer");
		expect(companion.lifecycle.status).toBe("active");
		expect(companion.uses.repair.sourceSpecific.toolChoice).toBe("smith's tools");
		expect(companion.turnUsage.flags.deflectAttack).toBe(true);
		expect(companion.hitDice.current).toBe(1);
	});

	test("addCompanionFromBestiary forwards and deep-copies feature companion fields", () => {
		const state = new CharacterSheetState();
		const fields = getFeatureCompanionFields();
		const id = state.addCompanionFromBestiary(
			{
				name: "Clockwork Hound",
				source: "TST",
				type: "construct",
				hp: {average: 12},
				str: 14,
				dex: 12,
				con: 14,
				int: 4,
				wis: 10,
				cha: 6,
			},
			CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
			"Test Feature",
			fields,
		);

		const companion = state.getCompanion(id);
		expect(companion.featureGrant).toEqual(fields.featureGrant);
		expect(companion.setup).toEqual(fields.setup);
		expect(companion.scaling).toEqual(fields.scaling);
		expect(companion.lifecycle).toEqual({...fields.lifecycle, generation: 1});
		expect(companion.uses).toEqual(fields.uses);
		expect(companion.turnUsage).toEqual(fields.turnUsage);
		expect(companion.hitDice).toEqual(fields.hitDice);

		fields.setup.choices.bodyPlan = "mutated";
		fields.scaling.descriptor.className = "Mutated";
		fields.uses.repair.current = 3;
		expect(companion.setup.choices.bodyPlan).toBe("biped");
		expect(companion.scaling.descriptor.className).toBe("Artificer");
		expect(companion.uses.repair.current).toBe(0);
	});

	test("updateCompanion normalizes schema updates without replacing identity or live HP", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({
			name: "Upgradeable Companion",
			type: CharacterSheetState.COMPANION_TYPES.CUSTOM,
			hp: {max: 18, current: 5, temp: 1},
		});
		const featureGrant = {
			uid: "Upgradeable Companion|Future Class|FTR|Future Subclass|FSB|3",
			className: "Future Class",
			classSource: "FTR",
			subclassShortName: "Future Subclass",
			subclassSource: "FSB",
		};
		const uses = {
			sourceSpecificPool: {
				current: 0,
				max: 2,
				unknownUseKey: {kept: true},
			},
		};

		state.updateCompanion(id, {
			featureGrant,
			uses,
			turnUsage: {flags: {sourceSpecificTurnFlag: true}},
			hitDice: {die: "d6"},
		});

		const companion = state.getCompanion(id);
		expect(companion.id).toBe(id);
		expect(companion.hp).toEqual({max: 18, current: 5, temp: 1});
		expect(companion.lifecycle).toEqual({generation: 1});
		expect(companion.uses).toEqual(uses);
		expect(companion.turnUsage).toEqual({
			action: false,
			reaction: false,
			flags: {sourceSpecificTurnFlag: true},
		});
		expect(companion.hitDice).toEqual({die: "d6", current: 0, max: 0});

		featureGrant.classSource = "MUTATED";
		uses.sourceSpecificPool.unknownUseKey.kept = false;
		expect(companion.featureGrant.classSource).toBe("FTR");
		expect(companion.uses.sourceSpecificPool.unknownUseKey.kept).toBe(true);
	});

	test("load migration preserves identity, current values, and arbitrary source-specific keys", () => {
		const state = new CharacterSheetState();
		state.loadFromJson({
			companions: [{
				id: "stable-feature-companion-id",
				name: "Persisted Companion",
				type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
				hp: {max: 30, current: 7, temp: 2},
				featureGrant: {
					uid: "Future Companion|Future Class|FTR|Future Subclass|FSB|3",
					className: "Future Class",
					classSource: "FTR",
					subclassShortName: "Future Subclass",
					subclassSource: "FSB",
				},
				setup: {
					status: "complete",
					unknownSetupChoice: {shape: "quadruped", nested: {kept: true}},
				},
				lifecycle: {
					status: "inactive",
					destroyedAtGameMinute: 900,
					timingKnown: false,
				},
				uses: {
					unknownResource: {
						current: 0,
						max: 4,
						recharge: "source-specific",
						unknownUseKey: {kept: true},
					},
				},
				turnUsage: {
					reaction: true,
					flags: {unknownTurnFlag: true},
				},
				hitDice: {die: "d10", current: 0, max: 4},
			}],
		});

		const companion = state.getCompanion("stable-feature-companion-id");
		expect(companion.id).toBe("stable-feature-companion-id");
		expect(companion.hp).toEqual({max: 30, current: 7, temp: 2});
		expect(companion.lifecycle).toEqual({
			status: "inactive",
			generation: 1,
			destroyedAtGameMinute: 900,
			timingKnown: false,
		});
		expect(companion.setup.unknownSetupChoice).toEqual({shape: "quadruped", nested: {kept: true}});
		expect(companion.uses.unknownResource).toEqual({
			current: 0,
			max: 4,
			recharge: "source-specific",
			unknownUseKey: {kept: true},
		});
		expect(companion.turnUsage).toEqual({
			action: false,
			reaction: true,
			flags: {unknownTurnFlag: true},
		});
		expect(companion.hitDice).toEqual({die: "d10", current: 0, max: 4});
	});

	test("migration is idempotent and round-trips the normalized schema", () => {
		const state = new CharacterSheetState();
		const fields = getFeatureCompanionFields();
		state.loadFromJson({
			companions: [{
				id: "round-trip-feature-companion",
				name: "Round Trip Companion",
				type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
				hp: {max: 20, current: 6, temp: 0},
				...fields,
				lifecycle: {status: "active"},
			}],
		});

		const once = state.toJson().companions[0];
		state._migrateCompanions();
		const twice = state.toJson().companions[0];
		expect(twice).toEqual(once);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.toJson().companions[0]).toEqual(once);
		expect(restored.getCompanion("round-trip-feature-companion").hp.current).toBe(6);
		expect(restored.getCompanion("round-trip-feature-companion").uses.repair.current).toBe(0);
	});

	test("legacy companions do not gain feature ownership or optional runtime stores", () => {
		const state = new CharacterSheetState();
		const id = state.addCompanion({
			name: "Legacy Familiar",
			type: CharacterSheetState.COMPANION_TYPES.FAMILIAR,
			hp: {max: 5, current: 2},
		});
		const companion = state.getCompanion(id);

		expect(companion.hp.current).toBe(2);
		expect(companion.scaling).toBeNull();
		for (const key of ["featureGrant", "setup", "lifecycle", "uses", "turnUsage", "hitDice"]) {
			expect(Object.hasOwn(companion, key)).toBe(false);
		}

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		const reloaded = restored.getCompanion(id);
		expect(reloaded.id).toBe(id);
		expect(reloaded.hp.current).toBe(2);
		for (const key of ["featureGrant", "setup", "lifecycle", "uses", "turnUsage", "hitDice"]) {
			expect(Object.hasOwn(reloaded, key)).toBe(false);
		}
	});
});
