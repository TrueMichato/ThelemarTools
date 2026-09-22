import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const PRISTINE_INTERVENTIONS = CharacterSheetState.ZERO_HP_INTERVENTIONS;

function registerInterventions (...definitions) {
	CharacterSheetState.ZERO_HP_INTERVENTIONS = [...PRISTINE_INTERVENTIONS, ...definitions];
}

function makeCustomIntervention (overrides = {}) {
	return {
		id: "customIntervention",
		featureName: "Custom Intervention",
		displayName: "Custom Intervention",
		saveAbility: null,
		dcBase: 0,
		dcAddsDamage: false,
		excludedDamageTypes: [],
		excludeCritical: false,
		spendOn: "success",
		usesMax: null,
		recharge: null,
		description: "A generic custom zero-HP intervention used by the transaction tests.",
		...overrides,
	};
}

function dropToZero (state, {current = 10, max = 40, damage = current, ...damageOptions} = {}) {
	state.setHp(current, max);
	state.takeDamage(damage, damageOptions);
	return state.getPendingZeroHpIntervention();
}

function makeLegacyStrengthOfTheGrave () {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state._data.saveProficiencies = ["cha"];
	state._data.classes = [{
		name: "Sorcerer",
		source: "PHB",
		level: 1,
		subclass: {name: "Shadow Magic", shortName: "Shadow", source: "XGE"},
	}];
	state.addFeature({
		level: 1,
		name: "Strength of the Grave",
		source: "XGE",
		description: "When damage reduces you to 0 hit points, make a Charisma saving throw (DC 5 + the damage taken). On a success, drop to 1 hit point instead.",
	});
	state.applyClassFeatureEffects();
	state.getResources();
	return state;
}

afterEach(() => {
	CharacterSheetState.ZERO_HP_INTERVENTIONS = PRISTINE_INTERVENTIONS;
});

describe("generic zero-HP intervention transaction", () => {
	it("preserves the legacy feature-use/resource intervention behavior", () => {
		const state = makeLegacyStrengthOfTheGrave();
		const feature = state.getFeatures().find(it => it.name === "Strength of the Grave");
		state._data.resources.push({
			id: "strength-of-the-grave-resource",
			name: feature.name,
			featureId: feature.id,
			current: 1,
			max: 1,
			recharge: "long",
		});
		dropToZero(state);

		const result = state.applyZeroHpIntervention("strengthOfTheGrave", {total: 15});
		const resource = state.getResources().find(it => it.featureId === feature.id || it.name === feature.name);

		expect(result).toMatchObject({
			applied: true,
			committed: true,
			success: true,
			hp: 1,
			consumption: {
				type: "featureUse",
				featureName: "Strength of the Grave",
				amount: 1,
				usesRemaining: 0,
			},
		});
		expect(feature.uses.current).toBe(0);
		expect(resource.current).toBe(0);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});

	it("honors a custom availability callback returning true", () => {
		registerInterventions(makeCustomIntervention({
			availability: () => true,
		}));
		const state = new CharacterSheetState();
		const pending = dropToZero(state);

		expect(pending.interventions.find(it => it.id === "customIntervention")).toMatchObject({
			available: true,
			unavailableReason: null,
		});
	});

	it("honors a custom availability callback returning false with a reason", () => {
		let outcomeCalculations = 0;
		registerInterventions(makeCustomIntervention({
			availability: () => ({available: false, unavailableReason: "A required destination is unavailable."}),
			hpOutcome: () => {
				outcomeCalculations++;
				return 1;
			},
		}));
		const state = new CharacterSheetState();
		const pending = dropToZero(state);

		expect(pending.interventions.find(it => it.id === "customIntervention")).toMatchObject({
			available: false,
			unavailableReason: "A required destination is unavailable.",
		});
		expect(outcomeCalculations).toBe(0);
	});

	it("runs custom consumption once and returns its structured descriptor", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			validation: ({state}) => {
				state._data.customCharges--;
				return {valid: true, selection: "validated-option"};
			},
			consumption: ({state, validation}) => {
				consumeCount++;
				expect(validation.selection).toBe("validated-option");
				state._data.customCharges--;
				return {type: "customCharge", spent: 1, remaining: state._data.customCharges};
			},
		}));
		const state = new CharacterSheetState();
		state._data.customCharges = 2;
		dropToZero(state);

		const result = state.applyZeroHpIntervention("customIntervention");
		expect(consumeCount).toBe(1);
		expect(state._data.customCharges).toBe(1);
		expect(result.consumption).toEqual({type: "customCharge", spent: 1, remaining: 1});
	});

	it("uses a custom calculated HP outcome", () => {
		registerInterventions(makeCustomIntervention({
			hpOutcome: {
				calculate: ({pending}) => Math.floor(pending.damage / 2) + 2,
			},
		}));
		const state = new CharacterSheetState();
		dropToZero(state, {damage: 10});

		const result = state.applyZeroHpIntervention("customIntervention");
		expect(result).toMatchObject({success: true, hp: 7});
		expect(state.getCurrentHp()).toBe(7);
	});

	it("returns an optional structured post-application payload", () => {
		registerInterventions(makeCustomIntervention({
			hpOutcome: 3,
			postApplicationResult: {
				build: ({hp, pending}) => ({
					kind: "relocation",
					destinationRef: "shelter-alpha",
					hp,
					triggerDamage: pending.damage,
				}),
			},
		}));
		const state = new CharacterSheetState();
		dropToZero(state);

		const result = state.applyZeroHpIntervention("customIntervention");
		expect(result.postApplication).toEqual({
			kind: "relocation",
			destinationRef: "shelter-alpha",
			hp: 3,
			triggerDamage: 10,
		});
	});

	it("cancels before commit without consuming anything", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			consumption: () => { consumeCount++; },
		}));
		const state = new CharacterSheetState();
		dropToZero(state);

		const result = state.applyZeroHpIntervention("customIntervention", {cancelled: true});
		expect(result).toMatchObject({applied: false, committed: false, cancelled: true});
		expect(consumeCount).toBe(0);
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});

	it("returns validation failure before commit without consuming anything", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			validation: ({state, options}) => {
				if (options.confirmed) return {valid: true};
				state._data.customCharges--;
				return {valid: false, error: "Choose a valid destination before applying."};
			},
			consumption: () => { consumeCount++; },
		}));
		const state = new CharacterSheetState();
		state._data.customCharges = 1;
		dropToZero(state);

		const result = state.applyZeroHpIntervention("customIntervention");
		expect(result).toMatchObject({
			applied: false,
			committed: false,
			validationFailed: true,
			error: "Choose a valid destination before applying.",
		});
		expect(consumeCount).toBe(0);
		expect(state._data.customCharges).toBe(1);
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getPendingZeroHpIntervention()).not.toBeNull();
	});

	it("rolls back and throws when post-application fails", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			hpOutcome: 6,
			consumption: ({state}) => {
				consumeCount++;
				state._data.customCharges--;
				return {type: "customCharge"};
			},
			postApplicationResult: () => {
				throw new Error("Destination application failed.");
			},
		}));
		const state = new CharacterSheetState();
		state._data.customCharges = 1;
		dropToZero(state);

		expect(() => state.applyZeroHpIntervention("customIntervention"))
			.toThrow("Custom Intervention failed to apply: Destination application failed.");
		expect(consumeCount).toBe(1);
		expect(state._data.customCharges).toBe(1);
		expect(state.getCurrentHp()).toBe(0);
		expect(state.getPendingZeroHpIntervention()).not.toBeNull();
	});

	it("returns deterministic chooser data and commits only the selected option", () => {
		let firstConsumes = 0;
		let secondConsumes = 0;
		registerInterventions(
			makeCustomIntervention({
				id: "firstIntervention",
				displayName: "First Intervention",
				hpOutcome: 2,
				consumption: () => { firstConsumes++; },
			}),
			makeCustomIntervention({
				id: "secondIntervention",
				displayName: "Second Intervention",
				hpOutcome: 4,
				consumption: () => { secondConsumes++; },
			}),
		);
		const state = new CharacterSheetState();
		const pending = dropToZero(state);

		expect(pending.chooser).toMatchObject({required: true});
		expect(pending.chooser.options.map(it => it.id)).toEqual(["firstIntervention", "secondIntervention"]);

		const result = state.applyZeroHpIntervention("secondIntervention");
		expect(result).toMatchObject({id: "secondIntervention", hp: 4, committed: true});
		expect(firstConsumes).toBe(0);
		expect(secondConsumes).toBe(1);
	});

	it("cannot consume the selected intervention twice", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			consumption: () => { consumeCount++; },
		}));
		const state = new CharacterSheetState();
		dropToZero(state);

		expect(state.applyZeroHpIntervention("customIntervention")).toMatchObject({committed: true});
		expect(state.applyZeroHpIntervention("customIntervention")).toBeNull();
		expect(consumeCount).toBe(1);
	});

	it("never offers or consumes an intervention when damage kills outright", () => {
		let consumeCount = 0;
		registerInterventions(makeCustomIntervention({
			consumption: () => { consumeCount++; },
		}));
		const state = new CharacterSheetState();
		dropToZero(state, {current: 10, max: 10, damage: 20});

		expect(state.isDead()).toBe(true);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
		expect(state.applyZeroHpIntervention("customIntervention")).toBeNull();
		expect(consumeCount).toBe(0);
	});

	it("keeps Death Ward ahead of the massive-damage exclusion", () => {
		registerInterventions(makeCustomIntervention());
		const state = new CharacterSheetState();
		state.setHp(10, 10);
		state.activateState("custom", {
			name: "Death Ward",
			customEffects: [{type: "deathWard"}],
			isSpellEffect: true,
		});

		state.takeDamage(20);
		expect(state.getCurrentHp()).toBe(1);
		expect(state.isDead()).toBe(false);
		expect(state.getPendingZeroHpIntervention()).toBeNull();
	});
});
