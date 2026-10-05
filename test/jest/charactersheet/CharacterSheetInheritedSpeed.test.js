import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const {CharacterSheetState, CharacterSheetCombat} = globalThis;
const rogueData = JSON.parse(fs.readFileSync("data/class/class-rogue.json", "utf8"));
const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const swiftStance = brew.combatMethod.find(f => f.name === "Swift Stance");
const previousConfig = globalThis.VetoolsConfig;
const previousDocument = globalThis.document;

beforeAll(() => {
	globalThis.VetoolsConfig = {
		get (group, key) {
			if (group === "styleSwitcher" && key === "style") return "one";
			throw new Error(`Unexpected renderer configuration read: ${group}.${key}`);
		},
	};
	globalThis.document = {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener () {}, removeEventListener () {}};
});

afterAll(() => {
	globalThis.VetoolsConfig = previousConfig;
	globalThis.document = previousDocument;
});

function makeThief (source = "XPHB") {
	const state = new CharacterSheetState();
	state.addClass({name: "Rogue", source, level: 3, subclass: {name: "Thief", source}});
	const featureSource = source === "TGTT" ? "XPHB" : source;
	if (source === "TGTT") {
		const thief = brew.subclassFeature.find(f => f.name === "Thief" && f.className === "Rogue");
		expect(thief.entries).toContainEqual({type: "refSubclassFeature", subclassFeature: "Second-Story Work|Rogue|XPHB|Thief|XPHB|3"});
	}
	const feature = rogueData.subclassFeature.find(f => f.name === "Second-Story Work" && f.source === featureSource);
	state.addFeature({...feature, description: Renderer.get().render({entries: feature.entries})});
	state.addFeature({...swiftStance, _entityType: "combatMethod"});
	state.ensureStaminaInitialized();
	return state;
}

function makeCombat (state) {
	const combat = new CharacterSheetCombat({
		getState: () => state,
		getNotes: () => null,
		_renderActiveStates () {},
		_saveCurrentCharacter: jest.fn(),
		_renderCharacter () {},
	});
	combat.renderCombatStates = () => {};
	combat.renderCombatEffects = () => {};
	combat.renderCombatMethods = () => {};
	return combat;
}

function assertSpeeds (state, expected) {
	const formatted = [`${expected.walk} ft.`];
	for (const type of ["walk", "fly", "swim", "climb", "burrow"]) {
		const value = expected[type] || 0;
		expect(state.getSpeed(type)).toBe(value);
		expect(state.getSpeedByType(type)).toBe(value);
		const breakdown = state.getSpeedBreakdown(type);
		expect(breakdown.total).toBe(value);
		expect(breakdown.components.reduce((sum, c) => sum + c.value, 0)).toBe(value);
		if (type === "walk") expect(state.getWalkSpeed()).toBe(value);
		else if (value > 0) formatted.push(`${type} ${value} ft.`);
	}
	expect(state.getSpeed()).toBe(formatted.join(", "));
}

function activate (state, effects) {
	return state.activateState("custom", {name: "Movement test", customEffects: effects});
}

describe("Round66 authored Thief and Swift Stance acquisition", () => {
	it.each(["XPHB", "TGTT"])("direct stance activation inherits a single authored +5 for %s Thief", source => {
		const state = makeThief(source);
		expect(swiftStance).toMatchObject({tradition: "Rapid Current", degree: 1, staminaCost: 1, isStance: true});
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Second-Story Work", equalToWalk: true, enabled: true, type: "speed:climb"}),
		]));
		assertSpeeds(state, {walk: 30, climb: 30});
		expect(state.activateStance("Swift Stance")).toBe(true);
		assertSpeeds(state, {walk: 35, climb: 35});
		state.deactivateStance();
		assertSpeeds(state, {walk: 30, climb: 30});
	});

	it.each(["XPHB", "TGTT"])("real Combat payment/activation and end preserve one +5 and resource behavior for %s", async source => {
		const state = makeThief(source);
		state.setStaminaCurrent(state.getStaminaMax());
		const stamina = state.getStaminaCurrent();
		const before = state.toJson();
		expect(before.turnReceipts).toEqual({version: 1, turnId: 0, receipts: {}});
		expect(before.actionEconomyUsage).toEqual({action: false, bonus: false, reaction: false});
		const combat = makeCombat(state);
		const method = state.getCombatMethods().find(m => m.name === "Swift Stance");

		expect(await combat._pUseCombatMethod(method)).toMatchObject({ok: true, cost: 1, resource: "stamina"});
		expect(state.getStaminaCurrent()).toBe(stamina - 1);
		expect(state.isStateTypeActive("combatStance")).toBe(true);
		expect(state.getActiveStance()).toBe("Swift Stance");
		assertSpeeds(state, {walk: 35, climb: 35});
		expect(state.getStaminaCurrent()).toBe(stamina - 1);
		expect(state.toJson().turnReceipts).toEqual(before.turnReceipts);
		expect(state.toJson().actionEconomyUsage).toEqual(before.actionEconomyUsage);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		assertSpeeds(loaded, {walk: 35, climb: 35});
		expect(loaded.getStaminaCurrent()).toBe(stamina - 1);
		expect(loaded.toJson().turnReceipts).toEqual(before.turnReceipts);
		loaded.setSpeed("walk", 40);
		assertSpeeds(loaded, {walk: 45, climb: 45});

		expect(await makeCombat(loaded)._pUseCombatMethod(loaded.getCombatMethods().find(m => m.name === "Swift Stance")))
			.toMatchObject({ok: true, cost: 0, resource: "stamina"});
		expect(loaded.getStaminaCurrent()).toBe(stamina - 1);
		expect(loaded.isStateTypeActive("combatStance")).toBe(false);
		expect(loaded.getActiveStance()).toBeNull();
		assertSpeeds(loaded, {walk: 40, climb: 40});
	});

	it("does not give the PHB classic feature the XPHB climb mechanic", async () => {
		const state = makeThief("PHB");
		expect(state.getNamedModifiers().some(m => m.type === "speed:climb" && m.equalToWalk)).toBe(false);
		state.setStaminaCurrent(state.getStaminaMax());
		await makeCombat(state)._pUseCombatMethod(state.getCombatMethods().find(m => m.name === "Swift Stance"));
		assertSpeeds(state, {walk: 35});
	});

	it("does not deduplicate an unrelated general speed bonus that matches the stance bonus", async () => {
		const state = makeThief();
		expect(await makeCombat(state)._pUseCombatMethod(state.getCombatMethods().find(m => m.name === "Swift Stance")))
			.toMatchObject({ok: true, cost: 1});
		activate(state, [{type: "bonus", target: "speed", value: 5}]);
		assertSpeeds(state, {walk: 40, climb: 40});
		state.deactivateState("custom");
		assertSpeeds(state, {walk: 35, climb: 35});
	});

	it("disabled and removed grants preserve intrinsic movement and leave no phantom speed", () => {
		const state = makeThief();
		const grant = state.getNamedModifiers().find(m => m.type === "speed:climb" && m.equalToWalk);
		state.toggleNamedModifier(grant.id);
		state.activateStance("Swift Stance");
		assertSpeeds(state, {walk: 35});
		state.toggleNamedModifier(grant.id);
		assertSpeeds(state, {walk: 35, climb: 35});
		state.setSpeed("climb", 20);
		state.removeFeature("Second-Story Work", "XPHB");
		assertSpeeds(state, {walk: 35, climb: 20});
	});
});

describe("Round66 walking-derived composition", () => {
	it("applies wildcard multiplication and shared halving to every typed contribution exactly once", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.addNamedModifier({name: "Climb training", type: "speed:climb", value: 10, enabled: true});
		state.setItemBonuses({speedMultiply: {"*": 2}});
		assertSpeeds(state, {walk: 70, climb: 90});
		activate(state, [{type: "speedMultiplier", value: 0.5}]);
		assertSpeeds(state, {walk: 35, climb: 45});
		state.setItemBonuses({speedMultiply: {"*": 2, climb: 2}});
		assertSpeeds(state, {walk: 35, climb: 90});
		state.setSpeed("climb", 100);
		assertSpeeds(state, {walk: 35, climb: 220});
	});

	it("scales the walking portion with walking-only items without scaling the new climb bonus", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.addNamedModifier({name: "Climb training", type: "speed:climb", value: 10, enabled: true});
		state.setItemBonuses({speedMultiply: {walk: 2}});
		assertSpeeds(state, {walk: 70, climb: 80});
	});

	it("rounds only after destination bonuses and shared fractional multipliers", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.addNamedModifier({name: "Climb training", type: "speed:climb", value: 10, enabled: true});
		state.setItemBonuses({speedMultiply: {"*": 1.5}});
		activate(state, [{type: "speedMultiplier", value: 0.5}]);
		assertSpeeds(state, {walk: 26, climb: 33});
	});

	it.each(["named", "item", "active", "symbolic"])("normalizes %s walking-equality grants and general active bonuses", origin => {
		const state = new CharacterSheetState();
		if (origin === "named") state.addNamedModifier({name: "Climber", type: "speed:climb", value: 0, equalToWalk: true, enabled: true});
		if (origin === "item") state.setItemBonuses({speedEqual: {climb: "walk"}});
		if (origin === "active") activate(state, [{type: "climbSpeed", equalToWalk: true}]);
		if (origin === "symbolic") activate(state, [{type: "bonus", target: "speed:climb", value: "walking"}]);
		activate(state, [{type: "bonus", target: "speed", value: 5}]);
		state.addNamedModifier({name: "Climb training", type: "speed:climb", value: 10, enabled: true});
		state.setItemBonuses({...state.getItemBonuses(), speedMultiply: {"*": 2}});
		assertSpeeds(state, {walk: 70, climb: 90});
		state.setItemBonuses({...state.getItemBonuses(), speedMultiply: {walk: 0.1}});
		assertSpeeds(state, {walk: 3, climb: 13});
	});

	it("includes wildcard bonuses once but retains independent static speed and typed item bonuses", () => {
		const state = makeThief();
		state.setItemBonuses({speedBonus: {"*": 5, climb: 10}, speedStatic: {climb: 60}});
		assertSpeeds(state, {walk: 35, climb: 75});
		state.setItemBonuses({speedBonus: {"*": 5, climb: 10}, speedStatic: {climb: 20}});
		assertSpeeds(state, {walk: 35, climb: 45});
	});

	it("removes a projected item equality without removing intrinsic speed or unrelated active bonuses", () => {
		const state = new CharacterSheetState();
		state.setSpeed("climb", 10);
		state.setItemBonuses({speedEqual: {climb: "walk"}});
		activate(state, [{type: "bonus", target: "speed", value: 5}]);
		assertSpeeds(state, {walk: 35, climb: 35});
		state.setItemBonuses({});
		assertSpeeds(state, {walk: 35, climb: 15});
		state.deactivateState("custom");
		assertSpeeds(state, {walk: 30, climb: 10});
	});

	it("does not invent non-walk movement from generic or plain type bonuses", () => {
		const state = new CharacterSheetState();
		activate(state, [{type: "bonus", target: "speed", value: 5}]);
		state.addNamedModifier({name: "Climb bonus, not grant", type: "speed:climb", value: 10, enabled: true});
		assertSpeeds(state, {walk: 35});
	});

	it("includes Unarmored Movement consistently and inherits Adept Speed only once", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "TGTT", level: 2});
		state.addFeature({name: "Adept Speed", className: "Monk", source: "TGTT", description: "Your walking speed increases by 10 feet."});
		state.addNamedModifier({name: "Climber", type: "speed:climb", value: 0, equalToWalk: true, enabled: true});
		assertSpeeds(state, {walk: 50, climb: 50});
	});

	it("applies armor and exhaustion once to inherited speed, including zeroing and immunity", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.setArmor({name: "Heavy armor", type: "heavy", ac: 16, strength: 15});
		state.setExhaustionRules("2024");
		state.setExhaustion(1);
		assertSpeeds(state, {walk: 20, climb: 20});
		activate(state, [{type: "speedMultiplier", value: 0.5}]);
		assertSpeeds(state, {walk: 7, climb: 7});
		activate(state, [{type: "setSpeed", value: 0}]);
		assertSpeeds(state, {walk: 0});
		activate(state, [{type: "speedReductionImmunity"}]);
		assertSpeeds(state, {walk: 35, climb: 35});
	});

	it.each([
		["2024", 2, 25],
		["thelemar", 2, 35],
	])("preserves %s exhaustion at level %s across all speed reads", (rules, level, speed) => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.setExhaustionRules(rules);
		state.setExhaustion(level);
		assertSpeeds(state, {walk: speed, climb: speed});
	});

	it("inherits socketed Journey speed once and treats Volant flight as a final walking floor", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.addItem({name: "Journey host", source: "PHB", type: "M"}, 1, true, true);
		state.addItem({name: "Volant host", source: "PHB", type: "M"}, 1, true, true);
		const journeyHost = state.getItems().find(item => item.name === "Journey host").id;
		const volantHost = state.getItems().find(item => item.name === "Volant host").id;
		expect(state.socketGemstone(journeyHost, {name: "Journey", source: "TGTT"}).success).toBe(true);
		expect(state.socketGemstone(volantHost, {name: "Volant", source: "TGTT"}).success).toBe(true);
		expect(state.getGemstoneSpeedBonus()).toBe(10);
		activate(state, [{type: "speedMultiplier", value: 2}]);
		state.setExhaustionRules("2024");
		state.setExhaustion(1);
		expect(state.getGemstoneFlightSpeed()).toBe(state.getWalkSpeed() * 2);
		assertSpeeds(state, {walk: 85, climb: 85, fly: 170});

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		assertSpeeds(loaded, {walk: 85, climb: 85, fly: 170});
		expect(loaded.unsocketGemstone(journeyHost, "Journey")).toMatchObject({name: "Journey", source: "TGTT"});
		assertSpeeds(loaded, {walk: 65, climb: 65, fly: 130});
		expect(loaded.unsocketGemstone(volantHost, "Volant")).toMatchObject({name: "Volant", source: "TGTT"});
		assertSpeeds(loaded, {walk: 65, climb: 65});
	});

	it("keeps final walking-multiplier floors separate from general effects", () => {
		const state = makeThief();
		state.activateStance("Swift Stance");
		state.setItemBonuses({speedMultiply: {"*": 2}});
		state.setExhaustionRules("2024");
		state.setExhaustion(1);
		activate(state, [{type: "flySpeed", walkMultiplier: 2}]);
		assertSpeeds(state, {walk: 65, climb: 65, fly: 130});
		activate(state, [{type: "setSpeed", value: 0}]);
		assertSpeeds(state, {walk: 0});
	});

	it("keeps fixed active grants visible in all surfaces without adding them to a walking grant", () => {
		const state = makeThief();
		activate(state, [{type: "flySpeed", value: 60}, {type: "climbSpeed", value: 60}, {type: "bonus", target: "speed", value: 5}]);
		assertSpeeds(state, {walk: 35, climb: 65, fly: 65});
	});

	it("ignores a self-referential walking grant and never asks feature calculations for speed", () => {
		const state = makeThief();
		state.addNamedModifier({name: "Invalid walk equality", type: "speed:walk", value: 0, equalToWalk: true, enabled: true});
		activate(state, [{type: "walkSpeed", equalToWalk: true}]);
		const spy = jest.spyOn(state, "getFeatureCalculations");
		assertSpeeds(state, {walk: 30, climb: 30});
		expect(spy).not.toHaveBeenCalled();
	});
});
