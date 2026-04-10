import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

describe("CharacterSheetCombat action economy gating", () => {
	let combat;
	let inCombat;
	let toasts;
	let featureList;
	let useCustomAbilityCalls;

	beforeEach(() => {
		inCombat = true;
		toasts = [];
		useCustomAbilityCalls = 0;
		featureList = [];

		globalThis.JqueryUtil = {
			doToast: (payload) => toasts.push(payload),
		};

		const mockState = {
			isInCombat: () => inCombat,
			getFeatures: () => featureList,
			canUseCustomAbility: () => true,
			useCustomAbility: () => {
				useCustomAbilityCalls++;
				return true;
			},
		};

		combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = mockState;
		combat._page = {
			_renderFeatures: () => {},
			_renderResources: () => {},
			_renderOverviewAbilities: () => {},
			_customAbilities: {render: () => {}},
			_saveCurrentCharacter: () => {},
		};
		combat.renderCombatActions = () => {};
		combat.renderCombatResources = () => {};
		combat._resetTurnActionUsage();
	});

	it("tracks Cunning Action as bonus action usage even without limited uses", async () => {
		const feature = {
			name: "Cunning Action",
			source: "PHB",
			description: "You can take a bonus action on each of your turns to Dash, Disengage, or Hide.",
		};
		featureList.push(feature);

		await combat._useCombatAction(feature);
		expect(combat._turnActionUsage.bonus).toBe(true);
		expect(toasts.some(t => t.type === "success")).toBe(true);
	});

	it("blocks reusing the same bonus action in the same combat round", async () => {
		const feature = {
			name: "Cunning Action",
			source: "PHB",
			description: "You can take a bonus action on each of your turns to Dash, Disengage, or Hide.",
		};
		featureList.push(feature);

		await combat._useCombatAction(feature);
		await combat._useCombatAction(feature);

		const warningToasts = toasts.filter(t => t.type === "warning");
		expect(warningToasts.some(t => /bonus action/i.test(t.content))).toBe(true);
	});

	it("resets per-turn action economy on round reset", () => {
		combat._consumeActionType("bonus");
		expect(combat._isActionTypeAvailable("bonus")).toBe(false);

		combat._resetTurnActionUsage();
		expect(combat._isActionTypeAvailable("bonus")).toBe(true);
	});

	it("initializes _handOfHarmUsedThisTurn as false", () => {
		expect(combat._handOfHarmUsedThisTurn).toBe(false);
	});

	it("resets _handOfHarmUsedThisTurn on turn reset", () => {
		combat._handOfHarmUsedThisTurn = true;
		combat._resetTurnActionUsage();
		expect(combat._handOfHarmUsedThisTurn).toBe(false);
	});

	it("gates limited custom abilities by action economy", () => {
		const ability = {
			id: "ab1",
			name: "Shadow Jaunt",
			activationAction: "bonus",
		};

		combat._useCustomAbility(ability);
		combat._useCustomAbility(ability);

		expect(useCustomAbilityCalls).toBe(1);
		expect(toasts.some(t => t.type === "warning" && /bonus action/i.test(t.content))).toBe(true);
	});

	it("does not enforce action gating outside combat", () => {
		inCombat = false;
		combat._consumeActionType("bonus");
		expect(combat._isActionTypeAvailable("bonus")).toBe(true);
	});

	it("uses interaction mode to render Use/Activate labels", () => {
		expect(combat._getActivationButtonText({activationInfo: {interactionMode: "toggle"}})).toBe("Activate");
		expect(combat._getActivationButtonText({activationInfo: {interactionMode: "limited"}})).toBe("Use");
		expect(combat._getActivationButtonText({activationInfo: {interactionMode: "trigger"}})).toBe("Use");
		expect(combat._getActivationButtonText({activationInfo: {interactionMode: "instant"}})).toBe("Use");
		expect(combat._getActivationButtonText({activationInfo: {isToggle: true}})).toBe("Activate");
		expect(combat._getActivationButtonText({activationInfo: null})).toBe("Use");
	});

	it("forwards activationInfo through combat activation helper", () => {
		let callArgs = null;
		combat._page._activateFeatureState = (...args) => {
			callArgs = args;
		};
		combat._page._renderActiveStates = () => {};
		combat.renderCombatStates = () => {};

		const feature = {name: "Sneak Attack Trigger"};
		const stateTypeId = "custom";
		const stateType = {icon: "⚡"};
		const resource = {id: "r1", current: 1, max: 1};
		const resourceCost = 1;
		const activationInfo = {interactionMode: "trigger", effects: [{type: "extraDamage", value: "2d6"}]};

		combat._activateCombatFeature(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);

		expect(callArgs).not.toBeNull();
		expect(callArgs[0]).toBe(feature);
		expect(callArgs[1]).toBe(stateTypeId);
		expect(callArgs[2]).toBe(stateType);
		expect(callArgs[3]).toBe(resource);
		expect(callArgs[4]).toBe(resourceCost);
		expect(callArgs[5]).toBe(activationInfo);
	});
});

// ===================================================================
// Phase 2: Combat Action UI System Tests
// ===================================================================
describe("CharacterSheetCombat — Combat Action Modal & Resource Deduction", () => {
	let combat;
	let inCombat;
	let toasts;
	let featureList;
	let kiPoints;
	let kiUsed;

	beforeEach(() => {
		inCombat = true;
		toasts = [];
		featureList = [];
		kiPoints = {current: 5, max: 5};
		kiUsed = 0;

		globalThis.JqueryUtil = {
			doToast: (payload) => toasts.push(payload),
		};

		const mockState = {
			isInCombat: () => inCombat,
			getFeatures: () => featureList,
			getKiPointsCurrent: () => kiPoints.current,
			getKiPoints: () => kiPoints.max,
			useKiPoint: (amount = 1) => {
				if (kiPoints.current < amount) return false;
				kiPoints.current -= amount;
				kiUsed += amount;
				return true;
			},
			canUseFocusForStamina: () => true,
			useFocusForStamina: (amount) => {
				if (kiPoints.current < amount) return false;
				kiPoints.current -= amount;
				kiUsed += amount;
				return true;
			},
		};

		combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = mockState;
		combat._page = {
			_renderFeatures: () => {},
			_renderResources: () => {},
			_renderOverviewAbilities: () => {},
			_customAbilities: {render: () => {}},
			_saveCurrentCharacter: () => {},
		};
		combat.renderCombatActions = () => {};
		combat.renderCombatResources = () => {};
		combat._resetTurnActionUsage();
	});

	// --- _parseResourceCost ---

	describe("_parseResourceCost", () => {
		it("should parse ki point cost from description", () => {
			const feature = {description: "You can spend 1 ki point to attempt a stunning strike."};
			expect(combat._parseResourceCost(feature, "ki")).toBe(1);
		});

		it("should parse multi-ki cost", () => {
			const feature = {description: "You can spend 5 ki points to resurrect a creature."};
			expect(combat._parseResourceCost(feature, "ki")).toBe(5);
		});

		it("should parse focus point cost", () => {
			const feature = {description: "Spend 2 focus points to enhance your strike."};
			expect(combat._parseResourceCost(feature, "focus")).toBe(2);
		});

		it("should parse stamina cost", () => {
			const feature = {description: "Spend 1 stamina point to make a weapon attack."};
			expect(combat._parseResourceCost(feature, "stamina")).toBe(1);
		});

		it("should return 0 when no cost found", () => {
			const feature = {description: "You gain proficiency in all saving throws."};
			expect(combat._parseResourceCost(feature, "ki")).toBe(0);
			expect(combat._parseResourceCost(feature, "focus")).toBe(0);
			expect(combat._parseResourceCost(feature, "stamina")).toBe(0);
		});

		it("should return 0 for empty description", () => {
			expect(combat._parseResourceCost({}, "ki")).toBe(0);
			expect(combat._parseResourceCost({description: ""}, "ki")).toBe(0);
		});

		it("should parse focus cost from HTML-rendered descriptions", () => {
			const feature = {description: 'Once per turn when you hit a creature with an <a href="variantrules.html#unarmed%20strike_xphb" class="help-subtle">Unarmed Strike</a> and deal damage, you can expend 1 Focus Point to deal extra Necrotic damage.'};
			expect(combat._parseResourceCost(feature, "focus")).toBe(1);
		});

		it("should parse ki cost from description with HTML tags around other words", () => {
			const feature = {description: 'As a <a href="actions.html#magic_xphb">Magic</a> action, you can spend 1 ki point to touch a creature.'};
			expect(combat._parseResourceCost(feature, "ki")).toBe(1);
		});
	});

	// --- _useCombatAction with ki deduction ---

	describe("_useCombatAction with ki deduction", () => {
		it("should deduct ki points when using Stunning Strike", async () => {
			const feature = {
				name: "Stunning Strike",
				source: "XPHB",
				description: "When you hit, you can spend 1 ki point to attempt a stunning strike.",
			};
			featureList.push(feature);

			await combat._useCombatAction(feature);

			expect(kiUsed).toBe(1);
			expect(kiPoints.current).toBe(4);
			expect(toasts.some(t => t.type === "success" && t.content.includes("ki"))).toBe(true);
		});

		it("should block use when not enough ki points", async () => {
			kiPoints.current = 0;
			const feature = {
				name: "Stunning Strike",
				source: "XPHB",
				description: "When you hit, you can spend 1 ki point to attempt a stunning strike.",
			};

			await combat._useCombatAction(feature);

			expect(kiUsed).toBe(0);
			expect(toasts.some(t => t.type === "warning" && t.content.includes("Not enough"))).toBe(true);
		});

		it("should deduct stamina via focus for monks", async () => {
			const feature = {
				name: "Instant Strike",
				source: "TGTT",
				description: "As a bonus action, spend 1 stamina point to make a melee weapon attack.",
			};
			featureList.push(feature);

			await combat._useCombatAction(feature);

			expect(kiUsed).toBe(1);
			expect(toasts.some(t => t.type === "success")).toBe(true);
		});

		it("should still consume action economy when deducting resources", async () => {
			const feature = {
				name: "Stunning Strike",
				source: "XPHB",
				description: "When you hit, you can spend 1 ki point.",
			};
			featureList.push(feature);

			await combat._useCombatAction(feature);
			expect(combat._turnActionUsage.action).toBe(true);
		});

		it("should not deduct resources when feature has no resource cost", async () => {
			const feature = {
				name: "Cunning Action",
				source: "PHB",
				description: "You can take a bonus action to Dash, Disengage, or Hide.",
			};
			featureList.push(feature);

			await combat._useCombatAction(feature);

			expect(kiUsed).toBe(0);
			expect(kiPoints.current).toBe(5);
			expect(toasts.some(t => t.type === "success")).toBe(true);
		});

		it("should decrement feature uses AND deduct ki if both apply", async () => {
			const feature = {
				name: "Stunning Strike",
				source: "XPHB",
				description: "As an action, spend 1 ki point to attempt to stun a creature you hit.",
				uses: {current: 3, max: 3, recharge: "long"},
			};
			featureList.push(feature);

			await combat._useCombatAction(feature);

			expect(kiUsed).toBe(1);
			expect(feature.uses.current).toBe(2);
			expect(toasts.some(t => t.type === "success")).toBe(true);
		});
	});

	// --- getCombatClassifiedFeatures ---

	describe("getCombatClassifiedFeatures", () => {
		beforeEach(() => {
			// Need CharacterSheetState for FEATURE_CLASSIFICATION_OVERRIDES
			globalThis.CharacterSheetState = globalThis.CharacterSheetState || {};
			globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES = {
				"stunning strike": "combat",
				"deflect attacks": "reaction",
				"monk's focus": "passive",
				"hand of healing": "combat",
			};
		});

		it("should return features classified as combat or reaction", () => {
			featureList.push(
				{name: "Stunning Strike", description: "When you hit..."},
				{name: "Deflect Attacks", description: "As a reaction..."},
				{name: "Monk's Focus", description: "You gain benefits..."},
				{name: "Rage", description: "As a bonus action..."},
			);

			const result = combat.getCombatClassifiedFeatures();
			const names = result.map(f => f.name);

			expect(names).toContain("Stunning Strike");
			expect(names).toContain("Deflect Attacks");
			expect(names).not.toContain("Monk's Focus"); // passive
			expect(names).not.toContain("Rage"); // not in overrides
		});

		it("should return empty when no features match overrides", () => {
			featureList.push(
				{name: "Rage", description: "As a bonus action..."},
			);
			expect(combat.getCombatClassifiedFeatures()).toEqual([]);
		});

		it("should return empty when character has no features", () => {
			expect(combat.getCombatClassifiedFeatures()).toEqual([]);
		});
	});
});
