/**
 * Damage & Vitals (R56) — model-layer tests.
 *
 * Covers the two features whose engine work lives in CharacterSheetState:
 *  - Feature 1: damage-type mitigation preview + application (applyDamageDefenses /
 *    takeDamage) for the streamlined intake control.
 *  - Feature 2: ability-score damage modeled as serialized active states — cascade into
 *    getAbilityScore / mods / saves / skills, floor-at-0 with no auto-kill, the mutation
 *    API, stacking, and a serialization round-trip.
 *
 * The UI wiring (charactersheet.js / charactersheet-combat.js / charactersheet-rest.js)
 * is intentionally NOT exercised here — these tests pin the engine contract the UI relies on.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	state = new CharacterSheetState();
});

// =============================================================================
// FEATURE 1 — damage-type mitigation preview + application
// =============================================================================
describe("Damage intake — mitigation preview (applyDamageDefenses)", () => {
	it("halves and reports resistance without mutating HP", () => {
		state.addResistance("fire");
		const preview = state.applyDamageDefenses(14, "fire", {});
		expect(preview.damage).toBe(7);
		expect(preview.applied).toBe("resistance");
	});

	it("zeroes and reports immunity", () => {
		state.addImmunity("poison");
		const preview = state.applyDamageDefenses(28, "poison", {});
		expect(preview.damage).toBe(0);
		expect(preview.applied).toBe("immunity");
	});

	it("doubles and reports vulnerability", () => {
		state.addVulnerability("cold");
		const preview = state.applyDamageDefenses(14, "cold", {});
		expect(preview.damage).toBe(28);
		expect(preview.applied).toBe("vulnerability");
	});

	it("passes untyped/undefended damage through unchanged", () => {
		const preview = state.applyDamageDefenses(12, null, {});
		expect(preview.damage).toBe(12);
		expect(preview.applied).toBeNull();
	});
});

describe("Damage intake — application (takeDamage)", () => {
	beforeEach(() => {
		state.setHp(30, 30, 0);
	});

	it("applies resisted damage to current HP", () => {
		state.addResistance("fire");
		state.takeDamage(14, {damageType: "fire"});
		expect(state.getCurrentHp()).toBe(30 - 7);
	});

	it("applies nothing when immune but still succeeds", () => {
		state.addImmunity("poison");
		const took = state.takeDamage(28, {damageType: "poison"});
		expect(took).toBe(true);
		expect(state.getCurrentHp()).toBe(30);
	});

	it("clamps current HP to 0 (never negative) on lethal damage", () => {
		state.takeDamage(999, {damageType: null});
		expect(state.getCurrentHp()).toBe(0);
	});

	it("consumes temp HP before current HP", () => {
		state.setHp(30, 30, 10);
		state.takeDamage(6, {damageType: null});
		expect(state.getTempHp()).toBe(4);
		expect(state.getCurrentHp()).toBe(30);
	});
});

// =============================================================================
// FEATURE 2 — ability-score damage
// =============================================================================
describe("Ability-score damage — cascade into scores/mods", () => {
	it("subtracts drain from the ability score and updates the modifier", () => {
		state.setAbilityBase("str", 16);
		expect(state.getAbilityScore("str")).toBe(16);
		expect(state.getAbilityMod("str")).toBe(3);

		state.applyAbilityDamage("str", 3);
		expect(state.getAbilityScore("str")).toBe(13);
		expect(state.getAbilityMod("str")).toBe(1);
		expect(state.getAbilityDamage("str")).toBe(3);
	});

	it("floors the score at 0 (NOT 3) and never below", () => {
		state.setAbilityBase("str", 8);
		state.applyAbilityDamage("str", 20);
		expect(state.getAbilityScore("str")).toBe(0);
	});

	it("does NOT auto-kill when STR or CON reaches 0", () => {
		state.setHp(25, 25, 0);
		state.setAbilityBase("con", 10);
		state.applyAbilityDamage("con", 50);
		expect(state.getAbilityScore("con")).toBe(0);
		// No HP mutation, not dead.
		expect(state.getCurrentHp()).toBe(25);
		expect(state.isDead?.() || false).toBe(false);
	});

	it("cascades a DEX drain into saving throws", () => {
		state.setAbilityBase("dex", 16);
		const before = state.getSaveBreakdown("dex").total;
		state.applyAbilityDamage("dex", 4); // 16 -> 12, mod +3 -> +1
		const after = state.getSaveBreakdown("dex").total;
		expect(after).toBe(before - 2);
	});

	it("cascades a STR drain into a STR-based skill (Athletics)", () => {
		state.setAbilityBase("str", 18);
		const before = state.getSkillMod("athletics");
		state.applyAbilityDamage("str", 4); // 18 -> 14, mod +4 -> +2
		const after = state.getSkillMod("athletics");
		expect(after).toBe(before - 2);
	});
});

describe("Ability-score damage — mutation API + stacking", () => {
	it("stacks multiple drains on the same ability", () => {
		state.setAbilityBase("con", 16);
		state.applyAbilityDamage("con", 2, {source: "Shadow"});
		state.applyAbilityDamage("con", 3, {source: "Chill Touch"});
		expect(state.getAbilityDamage("con")).toBe(5);
		expect(state.getAbilityScore("con")).toBe(11);
	});

	it("removeAbilityDamage clears every drain on one ability only", () => {
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 16);
		state.applyAbilityDamage("str", 2);
		state.applyAbilityDamage("str", 2);
		state.applyAbilityDamage("dex", 3);
		const removed = state.removeAbilityDamage("str");
		expect(removed).toBe(2);
		expect(state.getAbilityDamage("str")).toBe(0);
		expect(state.getAbilityDamage("dex")).toBe(3);
	});

	it("clearAllAbilityDamage removes drains across all abilities", () => {
		state.applyAbilityDamage("str", 2);
		state.applyAbilityDamage("con", 3);
		expect(state.hasAnyAbilityDamage()).toBe(true);
		expect(state.getTotalAbilityDamage()).toBe(5);
		const removed = state.clearAllAbilityDamage();
		expect(removed).toBe(2);
		expect(state.hasAnyAbilityDamage()).toBe(false);
		expect(state.getTotalAbilityDamage()).toBe(0);
	});

	it("ignores invalid abilities and non-positive amounts (but treats −N as magnitude N)", () => {
		expect(state.applyAbilityDamage("luck", 3)).toBeNull();
		expect(state.applyAbilityDamage("str", 0)).toBeNull();
		expect(state.getTotalAbilityDamage()).toBe(0);
		// Sign is ignored: a "−2" entry is a 2-point drain, matching the UI's "−N" affordance.
		state.applyAbilityDamage("str", -2);
		expect(state.getAbilityDamage("str")).toBe(2);
	});
});

describe("Ability-score damage — serialization round-trip", () => {
	it("survives toJson -> loadFromJson and still subtracts", () => {
		state.setAbilityBase("wis", 14);
		state.applyAbilityDamage("wis", 4, {source: "Feeblemind"});
		expect(state.getAbilityScore("wis")).toBe(10);

		const json = state.toJson();
		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(json)));

		expect(restored.getAbilityDamage("wis")).toBe(4);
		expect(restored.getAbilityScore("wis")).toBe(10);
		expect(restored.getAbilityMod("wis")).toBe(0);
	});
});
