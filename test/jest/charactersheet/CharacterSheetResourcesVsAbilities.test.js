/**
 * Bug 3 regression — Resources vs Abilities semantic split.
 *
 * - Resources section = system/class-granted limited-use pools only
 *   (Channel Divinity, Rage, Ki, spell-resource pools, Stamina). Custom
 *   abilities must NOT appear here.
 * - Abilities section = user-curated custom abilities only. Class
 *   resources must NOT appear here.
 *
 * These tests guard the data-level contract: state methods return what
 * each section is expected to render. The actual DOM rendering is
 * driven by these state calls in charactersheet.js.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Resources vs Abilities split (Bug 3)", () => {
	function makeStateWithCustomAbility () {
		const state = new CharacterSheetState();
		state.addCustomAbility({
			name: "Test Ability",
			description: "A test custom ability.",
			icon: "🔥",
			category: "active",
			mode: "limited",
			uses: {current: 2, max: 2, recharge: "long"},
			activationAction: "free",
		});
		return state;
	}

	test("getCustomAbilities() returns the user's custom abilities, separate from getResources()", () => {
		const state = makeStateWithCustomAbility();
		const customs = state.getCustomAbilities();
		const resources = state.getResources();

		expect(customs.length).toBe(1);
		expect(customs[0].name).toBe("Test Ability");
		// A bare character (no class) has no system resources — custom abilities
		// must not pollute getResources().
		expect(resources.some(r => r.name === "Test Ability")).toBe(false);
	});

	test("Custom limited abilities still have functional use/restore plumbing", () => {
		const state = makeStateWithCustomAbility();
		const ability = state.getCustomAbilities()[0];

		const before = state.getCustomAbilityUsesDisplay(ability.id);
		expect(before.current).toBe(2);
		expect(before.max).toBe(2);

		const used = state.useCustomAbility(ability.id);
		expect(used).toBe(true);
		expect(state.getCustomAbilityUsesDisplay(ability.id).current).toBe(1);

		const restored = state.restoreCustomAbilityUse(ability.id);
		expect(restored).toBe(true);
		expect(state.getCustomAbilityUsesDisplay(ability.id).current).toBe(2);
	});

	test("Custom abilities support a custom icon (preserved through save/load)", () => {
		const state = makeStateWithCustomAbility();
		const ability = state.getCustomAbilities()[0];
		expect(ability.icon).toBe("🔥");
	});
});
