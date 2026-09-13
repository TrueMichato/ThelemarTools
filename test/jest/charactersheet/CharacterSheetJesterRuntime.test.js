import "./setup.js";
import fs from "node:fs";

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

const TGTT = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const ACTS = new Map(
	TGTT.optionalfeature
		.filter(feature => feature.featureType?.includes("JA"))
		.map(feature => [feature.name, feature]),
);
const BARD = TGTT.class.find(cls => cls.name === "Bard" && cls.source === "TGTT");
const JESTER = TGTT.subclass.find(sc => sc.name === "College of Jesters" && sc.source === "TGTT");

function addJester (state, level = 14) {
	state.addClass({
		name: "Bard",
		source: "TGTT",
		level,
		subclass: JESTER,
	});
}

function addAct (state, name) {
	const act = ACTS.get(name);
	state.addFeature({
		...act,
		featureType: "Optional Feature",
		optionalFeatureTypes: ["JA"],
	});
	return state.getFeature(name);
}

describe("College of Jesters runtime contracts", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		addJester(state);
	});

	test.each([
		["Pantomime", "one", "wis", "charmed"],
		["Prankster", "one", "wis", "dazed"],
		["Jester's Juggle", "allHostile", "wis", null],
		["Fool's Folly", "one", "int", "incapacitated"],
		["Witty Wordplay", "one", null, null],
		["Jester's Jest", "one", "wis", null],
	])("%s exposes a target-resolution contract", (name, targets, saveAbility, condition) => {
		const feature = addAct(state, name);
		const info = CharacterSheetState.detectActivatableFeature(feature);

		expect(info.targetResolution).toMatchObject({targets, saveAbility});
		expect(info.interactionMode).toBe("limited");
		expect(info.effects).toEqual([]);
		expect(info.targetResolution.summary).toMatch(new RegExp(name === "Witty Wordplay" ? "disadvantage" : "saving throw", "i"));
		if (condition) expect(info.targetResolution.onFailure).toContainEqual({type: "condition", condition});
	});

	it("keeps Dazzling Disguise inactive until its timed state is activated", () => {
		const feature = addAct(state, "Dazzling Disguise");
		const info = CharacterSheetState.detectActivatableFeature(feature);

		expect(state.hasAdvantageFromStates("skill:deception")).toBe(false);
		state.startCombat();
		state.addActiveState("custom", {
			name: feature.name,
			sourceFeatureId: feature.id,
			customEffects: info.effects,
			duration: info.duration,
		});

		expect(state.hasAdvantageFromStates("skill:deception")).toBe(true);
		expect(state.getActiveStates().find(active => active.sourceFeatureId === feature.id)?.duration).toBe("1 hour");
		for (let i = 0; i < 600; ++i) state.advanceRound();
		expect(state.hasAdvantageFromStates("skill:deception")).toBe(false);
	});

	it("describes turn-scoped movement and action benefits", () => {
		const disengage = addAct(state, "Trickster's Disengagement");
		const tumble = addAct(state, "Tumbler");
		const disengageInfo = CharacterSheetState.detectActivatableFeature(disengage);
		const tumbleInfo = CharacterSheetState.detectActivatableFeature(tumble);

		state.startCombat();
		state.addActiveState("custom", {
			name: disengage.name,
			sourceFeatureId: disengage.id,
			duration: disengageInfo.duration,
			actionBenefit: disengageInfo.actionBenefit,
		});
		state.addActiveState("custom", {
			name: tumble.name,
			sourceFeatureId: tumble.id,
			duration: tumbleInfo.duration,
			movementOverride: tumbleInfo.movementOverride,
		});

		expect(state.getActionEconomyOverrides()).toEqual(expect.arrayContaining([
			expect.objectContaining({activity: "Escape a Grapple", cost: "bonus", source: "Gifted Acrobat"}),
			expect.objectContaining({activity: "Disengage", cost: "bonus", targets: 5, source: "Trickster's Disengagement"}),
		]));
		expect(state.getMovementOverrides()).toEqual(expect.arrayContaining([
			expect.objectContaining({activity: "Stand from Prone", costFeet: 10, source: "Gifted Acrobat"}),
			expect.objectContaining({kind: "hostileSpacePermission", source: "Tumbler"}),
		]));
		state.advanceRound();
		expect(state.getActionEconomyOverrides()).not.toContainEqual(expect.objectContaining({source: "Trickster's Disengagement"}));
		expect(state.getMovementOverrides()).not.toContainEqual(expect.objectContaining({source: "Tumbler"}));
	});

	it("publishes Act-granted spells through the generic resource-cast contract", () => {
		state.setSpellData([
			{name: "Mirror Image", source: "PHB", level: 2, time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "self"}}, duration: [{type: "timed", duration: {type: "minute", amount: 1}}], components: {v: true, s: true}},
			{name: "Silent Image", source: "PHB", level: 1, time: [{number: 1, unit: "action"}], range: {type: "point", distance: {type: "feet", amount: 60}}, duration: [{type: "timed", duration: {type: "minute", amount: 10}, concentration: true}], components: {v: true, s: true, m: "a bit of fleece"}},
		]);
		addAct(state, "Jester's Jaunt");
		addAct(state, "Ridiculous Ruse");
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});

		expect(state.getResourceCastableSpells()).toEqual(expect.arrayContaining([
			expect.objectContaining({spell: "Mirror Image", cost: 1, resourceName: "Bardic Inspiration", ignoresMaterialComponents: true}),
			expect.objectContaining({spell: "Silent Image", cost: 1, resourceName: "Bardic Inspiration", concentration: true, ignoresMaterialComponents: true}),
		]));
	});

	it("arms Laughing Lunge as a serialized consume-on-attack state", () => {
		const feature = addAct(state, "Laughing Lunge");
		const info = CharacterSheetState.detectActivatableFeature(feature);

		expect(info.pendingAttack).toEqual(expect.objectContaining({
			advantage: true,
			damageDice: "1d6",
			damageType: "psychic",
			consume: "onAttack",
		}));

		state.addActiveState("custom", {
			name: feature.name,
			sourceFeatureId: feature.id,
			customEffects: info.effects,
			duration: info.duration,
			consumeOnAttack: true,
			pendingAttack: info.pendingAttack,
		});
		const saved = state.toJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(saved);

		expect(loaded.getActiveStates()).toContainEqual(expect.objectContaining({
			name: "Laughing Lunge",
			consumeOnAttack: true,
			pendingAttack: expect.objectContaining({advantage: true, damageDice: "1d6", damageType: "psychic"}),
		}));
		expect(loaded.consumePendingAttackRiders()).toEqual([
			expect.objectContaining({source: "Laughing Lunge", advantage: true, damageDice: "1d6", damageType: "psychic"}),
		]);
		expect(loaded.getPendingAttackRiders()).toEqual([]);
	});

	it("backfills Jester runtime metadata on legacy active states", () => {
		const feature = addAct(state, "Laughing Lunge");
		const legacy = state.toJson();
		legacy.activeStates.push({
			id: "legacy-laughing-lunge",
			stateTypeId: "custom",
			name: "Laughing Lunge",
			active: true,
			sourceFeatureId: feature.id,
			duration: null,
		});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(legacy);
		expect(loaded.getActiveStates()).toContainEqual(expect.objectContaining({
			id: "legacy-laughing-lunge",
			duration: "until your next attack",
			consumeOnAttack: true,
			pendingAttack: expect.objectContaining({
				advantage: true,
				damageDice: "1d6",
				damageType: "psychic",
			}),
		}));
	});

	it("removes legacy target-only states and restores missing self-effect metadata", () => {
		const pantomime = addAct(state, "Pantomime");
		const disguise = addAct(state, "Dazzling Disguise");
		const legacy = state.toJson();
		legacy.activeStates.push(
			{
				id: "legacy-pantomime",
				stateTypeId: "custom",
				name: pantomime.name,
				active: true,
				sourceFeatureId: pantomime.id,
			},
			{
				id: "legacy-disguise",
				stateTypeId: "custom",
				name: disguise.name,
				active: true,
				sourceFeatureId: disguise.id,
			},
		);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(legacy);

		expect(loaded.getActiveState("legacy-pantomime")).toBeNull();
		expect(loaded.getActiveState("legacy-disguise")).toMatchObject({
			duration: "1 hour",
			customEffects: [{type: "advantage", target: "skill:deception"}],
		});
	});

	it("rehydrates lean legacy Acts after the optional-feature catalog arrives", () => {
		const lunge = addAct(state, "Laughing Lunge");
		const legacy = state.toJson();
		const lean = legacy.features.find(it => it.id === lunge.id);
		delete lean.entries;
		delete lean.description;
		legacy.activeStates.push({
			id: "legacy-lean-lunge",
			stateTypeId: "custom",
			name: lunge.name,
			active: true,
			sourceFeatureId: lunge.id,
			duration: null,
		});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(legacy);
		expect(loaded.getActiveState("legacy-lean-lunge")).toMatchObject({duration: null});

		loaded.setClassFeatureCatalog([], [], [...ACTS.values()]);
		expect(loaded.getActiveState("legacy-lean-lunge")).toMatchObject({
			duration: "until your next attack",
			consumeOnAttack: true,
			pendingAttack: expect.objectContaining({damageDice: "1d6", damageType: "psychic"}),
		});
	});

	it("removes runtime states when their source Act is replaced", () => {
		const disguise = addAct(state, "Dazzling Disguise");
		const info = CharacterSheetState.detectActivatableFeature(disguise);
		state.addActiveState("custom", {
			name: disguise.name,
			sourceFeatureId: disguise.id,
			duration: info.duration,
			customEffects: info.effects,
		});

		expect(state.hasAdvantageFromStates("skill:deception")).toBe(true);
		state.removeFeature(disguise.id);
		expect(state.hasAdvantageFromStates("skill:deception")).toBe(false);
		expect(state.getActiveStates().some(it => it.sourceFeatureId === disguise.id)).toBe(false);
	});

	it("prunes orphaned Jester states once the optional-feature catalog is available", () => {
		const orphan = state.toJson();
		orphan.activeStates.push({
			id: "orphaned-disguise",
			stateTypeId: "custom",
			name: "Dazzling Disguise",
			active: true,
			sourceFeatureId: "removed-jester-act",
			customEffects: [{type: "advantage", target: "skill:deception"}],
		});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(orphan);
		expect(loaded.getActiveState("orphaned-disguise")).not.toBeNull();
		loaded.setClassFeatureCatalog([], [], [...ACTS.values()]);
		expect(loaded.getActiveState("orphaned-disguise")).toBeNull();
	});

	it("offers Bardic Inspiration riders and spends the base and secondary pools atomically", () => {
		addAct(state, "Fool's Folly");
		addAct(state, "Witty Wordplay");
		const privilege = TGTT.subclassFeature.find(feature => feature.name === "Jester's Privilege");
		state.addFeature({
			...privilege,
			description: privilege.entries.join(" "),
			uses: {current: 1, max: 1, recharge: "long"},
		});
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});
		const resource = state.getResources().find(it => it.name === "Bardic Inspiration");

		const augments = state.getResourceUseAugments("Bardic Inspiration");
		expect(augments.map(it => it.feature.name)).toEqual(expect.arrayContaining([
			"Fool's Folly",
			"Witty Wordplay",
			"Jester's Privilege",
		]));

		const result = state.spendResourceUse(resource.id, {augmentFeatureId: state.getFeature("Jester's Privilege").id});
		expect(result).toMatchObject({ok: true, resourceRemaining: 4, augmentUsesRemaining: 0});
		expect(state.getResources().find(it => it.id === resource.id).current).toBe(4);
		expect(state.getFeatureUses("Jester's Privilege")).toBe(0);
	});

	it("describes Jester's Privilege as affecting every creature in range", () => {
		const privilege = TGTT.subclassFeature.find(feature => feature.name === "Jester's Privilege");
		state.addFeature({...privilege, description: privilege.entries.join(" "), uses: {current: 1, max: 1, recharge: "long"}});
		state.addResource({name: "Bardic Inspiration", max: 5, current: 5, recharge: "short"});

		const augment = state.getResourceUseAugments("Bardic Inspiration").find(it => it.feature.name === "Jester's Privilege");
		expect(augment.activationInfo.targetResolution).toMatchObject({
			targets: "allCreatures",
			range: 60,
			saveAbility: "wis",
			dcSource: "rolledCheck",
		});
	});
});

describe("College of Jesters optional-feature replacement", () => {
	function makeStateWithActs (count) {
		const state = new CharacterSheetState();
		addJester(state, 3);
		[...ACTS.keys()].slice(0, count).forEach(name => addAct(state, name));
		return state;
	}

	it.each([
		[3, 4, 0, 1],
		[5, 6, 1, 1],
		[7, 8, 0, 1],
		[13, 14, 1, 1],
	])("offers the correct new/replacement counts for Bard %i→%i", (from, to, newCount, replacementCount) => {
		const state = makeStateWithActs(from >= 6 ? 4 : 3);
		const gain = CharacterSheetClassUtils.getOptionalFeatureGains(BARD, from, to, state, JESTER)
			.find(it => it.featureTypes.includes("JA"));

		expect(gain).toMatchObject({
			newCount,
			replacementCount,
			replacementLabel: "Jester's Act",
		});
	});
});
