/**
 * Bug 3 (R44-b) — Bladesinger permanent +10 Speed leak.
 *
 * Bladesong's "Agility" benefit ("your Speed increases by 10 feet") is gated
 * "While the Bladesong is active", but that clause sits in a separate entry the
 * passive text parser could not associate, so it emitted a PERMANENT, enabled
 * `speed:walk +10` named modifier. Bladesong is already modelled by
 * ACTIVE_STATE_TYPES.bladesong (which grants the +10 gated on `state.active`), so
 * the parsed one double-stacked AND applied while inactive.
 *
 * Fix under test:
 *   - `_processFeatureModifiers` skips Bladesong's passive parse (no leak on new sheets);
 *   - `_migrateBladesongPassiveModifiers` strips the stale ENABLED speed/AC modifier
 *     from old saves while preserving the correct conditional (enabled:false) AC one;
 *   - net effect: Bladesong inactive → base speed; active → +10 (single).
 */

import "./setup.js";

let CharacterSheetState;
let state;

const BLADESONG_DESCRIPTION = [
	"As a Bonus Action, you invoke an elven magic called the Bladesong, provided you aren't wearing armor or using a Shield.",
	"The Bladesong lasts for 1 minute and ends early if you have the Incapacitated condition, if you don armor or a Shield, or if you use two hands to make an attack with a weapon.",
	"While the Bladesong is active, you gain the following benefits.",
	"Agility. You gain a bonus to your AC equal to your Intelligence modifier (minimum of +1), and your Speed increases by 10 feet. In addition, you have Advantage on Dexterity (Acrobatics) checks.",
].join(" ");

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

function makeBladesinger (level = 6) {
	state.addClass({
		name: "Wizard",
		source: "TGTT",
		level,
		subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"},
	});
	state.setAbilityBase("int", 18); // +4
	state.setAbilityBase("dex", 16);
}

describe("Bug 3 — Bladesong passive speed leak", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	test("adding the Bladesong feature registers NO permanent speed:walk modifier", () => {
		makeBladesinger(6);
		state.addFeature({
			name: "Bladesong",
			description: BLADESONG_DESCRIPTION,
			className: "Wizard",
			level: 2,
		});

		const speedMods = (state._data.namedModifiers || []).filter(
			m => typeof m.type === "string" && m.type.startsWith("speed:"),
		);
		expect(speedMods.length).toBe(0);
	});

	test("Bladesong inactive → base speed; active → +10 (no double)", () => {
		makeBladesinger(6);
		state.addFeature({
			name: "Bladesong",
			description: BLADESONG_DESCRIPTION,
			className: "Wizard",
			level: 2,
		});
		state.addResource({name: "Bladesong", max: 4, current: 4, recharge: "long"});

		const baseSpeed = state.getWalkSpeed();
		expect(state.isStateTypeActive("bladesong")).toBe(false);
		expect(state.getWalkSpeed()).toBe(baseSpeed); // inactive → no bonus

		state.activateState("bladesong");
		expect(state.isStateTypeActive("bladesong")).toBe(true);
		expect(state.getWalkSpeed()).toBe(baseSpeed + 10); // active → exactly +10, not +20
	});

	test("loading a legacy save strips the ungated 'From Bladesong' speed modifier", () => {
		state.loadFromJson({
			name: "Dark Moon Stone",
			features: [{id: "feat_bs", name: "Bladesong", description: BLADESONG_DESCRIPTION}],
			speed: {walk: 30},
			customModifiers: {speed: {walk: 10}}, // stale baked cache from the leak
			namedModifiers: [
				// The bug: an ENABLED, ungated permanent speed bonus.
				{name: "Bladesong", type: "speed:walk", value: 10, enabled: true, note: "From Bladesong", sourceFeatureId: "feat_bs"},
				// The correct conditional AC modifier — must be preserved.
				{name: "Bladesong", type: "ac", value: 4, enabled: false, conditional: "while Bladesong is active", sourceFeatureId: "feat_bs"},
			],
		});

		const mods = state._data.namedModifiers || [];
		// The ungated speed leak is gone.
		expect(mods.some(m => m.type === "speed:walk" && m.enabled !== false)).toBe(false);
		// The conditional AC modifier survives.
		expect(mods.some(m => m.type === "ac" && m.enabled === false)).toBe(true);
		// And the derived walking speed dropped back to base.
		expect(state.getWalkSpeed()).toBe(30);
	});

	test("migration is idempotent (a clean save is untouched)", () => {
		const clean = {
			name: "Clean Bladesinger",
			features: [{id: "feat_bs", name: "Bladesong", description: BLADESONG_DESCRIPTION}],
			speed: {walk: 30},
			namedModifiers: [
				{name: "Bladesong", type: "ac", value: 4, enabled: false, conditional: "while Bladesong is active", sourceFeatureId: "feat_bs"},
			],
		};
		state.loadFromJson(clean);
		const acCount = (state._data.namedModifiers || []).filter(m => m.type === "ac").length;
		state._migrateBladesongPassiveModifiers();
		expect((state._data.namedModifiers || []).filter(m => m.type === "ac").length).toBe(acCount);
	});
});
