import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const makeFury = (level = 6) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	for (const [lvl, name] of [[3, "Manifest Chains"], [6, "Chain Imprisonment"], [10, "Chain Control"], [14, "Unchained Fury"]]) {
		if (level >= lvl) state.addFeature({name, source: "TGTT", description: name});
	}
	state.activateState("rage");
	state.activateState("manifestChains");
	return state;
};

describe("CharacterSheet target/effect lifecycle", () => {
	it("opts Chained Fury riders into persistence without changing generic rider shape", () => {
		const state = makeFury(3);
		const options = state.getFeatureCalculations().attackOnHitOptions;
		expect(options.find(o => o.id === "chains-grapple").targetAware).toBe(true);
		expect(options.find(o => o.id === "chains-shove").targetAware).toBe(true);
		expect(options.find(o => o.id === "chains-grapple").description).toContain("Grapple");
	});

	it("persists a restrained Chained Fury target with recurring damage", () => {
		const state = makeFury(6);
		const result = state.applyChainedTargetEffect({
			targetName: "Ogre",
			size: "large",
			distance: 20,
			riderId: "chains-restrain",
			effect: "restrain",
			restraintSaveTotal: 10,
		});
		expect(result.ok).toBe(true);
		expect(result.target).toMatchObject({
			targetName: "Ogre",
			grappled: true,
			restrained: true,
			recurringDamage: {amount: 6, type: "force"},
		});
		expect(state.resolveChainedTargetTurn(result.target.id, 1)).toMatchObject({ok: true, damage: 6});
		expect(state.resolveChainedTargetTurn(result.target.id, 1)).toMatchObject({ok: true, damage: 0, alreadyResolved: true});
	});

	it("enforces chain occupancy, size, and reach", () => {
		const state = makeFury(3);
		expect(state.applyChainedTargetEffect({targetName: "Too far", distance: 16}).reason).toBe("out-of-range");
		expect(state.applyChainedTargetEffect({targetName: "Too big", size: "gargantuan", distance: 10}).reason).toBe("target-too-large");
		expect(state.applyChainedTargetEffect({targetName: "A", distance: 10}).ok).toBe(true);
		expect(state.applyChainedTargetEffect({targetName: "B", distance: 10}).ok).toBe(true);
		expect(state.applyChainedTargetEffect({targetName: "C", distance: 10}).reason).toBe("chain-capacity");
	});

	it("supports escape, release, and source teardown", () => {
		const state = makeFury(6);
		const target = state.createChainedTarget({targetName: "Bandit", distance: 10}).target;
		expect(state.escapeChainedTarget(target.id, 1)).toMatchObject({ok: false, escaped: false});
		expect(state.escapeChainedTarget(target.id, 30)).toMatchObject({ok: true, escaped: true});
		const second = state.createChainedTarget({targetName: "Cultist", distance: 10}).target;
		expect(state.getChainedTargets()).toHaveLength(1);
		state.deactivateState("rage");
		expect(state.getChainedTargets()).toHaveLength(0);
		expect(second).toBeDefined();
	});

	it("migrates malformed target entries and removes stale chain effects on load", () => {
		const state = makeFury(6);
		const json = state.toJson();
		json.targetEffects = [{id: "stale", source: "chained-fury", targetName: "Stale", size: "not-a-size"}];
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.getTargetEffects()).toEqual([]);
	});
});
