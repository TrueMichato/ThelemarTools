/**
 * Character Sheet — Barbarian feature classification overrides (R40 #5, #6, #8)
 *
 * Root-cause coverage for features that the toggle-analysis heuristic mis-classified as
 * persistent active-state toggles. Asserts the CORRECTED action economy:
 *  - #5 Path of Drowning Springs (TGTT, L6)  -> Bonus Action, NOT a toggle/active state.
 *  - #6 Branches of the Tree (World Tree, L6) -> Reaction, NOT a toggle/active state.
 *  - #8 Vitality of the Tree (World Tree, L3) -> Passive, never an active-state toggle.
 *
 * Both the direct `detectActivatableFeature` classification AND the resulting absence from
 * `getActivatableFeatures()` (the generic "Available to Activate" toggle list) are asserted.
 * Entries-only feature objects are used to prove the override survives the entries-only early
 * return (features arriving without a rendered `description`).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const PATH_OF_DROWNING_SPRINGS_TEXT =
	"While swimming, you can use a bonus action and expend one use of Rage to move up to your speed and make a Strength (Athletics) check to drag a creature with you.";
const BRANCHES_OF_THE_TREE_TEXT =
	"When a creature you can see within 30 feet of you starts its turn, you can take a Reaction to teleport that creature into an unoccupied space within 5 feet of you.";
const VITALITY_OF_THE_TREE_TEXT =
	"You gain Temporary Hit Points equal to your Barbarian level when you activate your Rage. Additionally, at the start of each of your turns while your Rage is active, you can give a creature within 10 feet Temporary Hit Points.";

describe("Classification — Path of Drowning Springs (#5)", () => {
	it("classifies as a Bonus Action combat ability, not a toggle (entries-only)", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Path of Drowning Springs",
			entries: [PATH_OF_DROWNING_SPRINGS_TEXT],
		});
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("combat");
		expect(info.activationAction).toBe("bonus");
	});

	it("classifies the same way when a rendered description is present", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Path of Drowning Springs",
			description: PATH_OF_DROWNING_SPRINGS_TEXT,
		});
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("combat");
		expect(info.activationAction).toBe("bonus");
	});

	it("does not appear in the generic active-states toggle list", () => {
		const state = new CharacterSheetState();
		state.addFeature({name: "Path of Drowning Springs", source: "TGTT", description: PATH_OF_DROWNING_SPRINGS_TEXT});
		const names = state.getActivatableFeatures().map(a => a.feature.name);
		expect(names).not.toContain("Path of Drowning Springs");
	});
});

describe("Classification — Branches of the Tree (#6)", () => {
	it("classifies as a Reaction, not a toggle (entries-only)", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Branches of the Tree",
			entries: [BRANCHES_OF_THE_TREE_TEXT],
		});
		expect(info).not.toBeNull();
		expect(info.isToggle).toBe(false);
		expect(info.interactionMode).toBe("reaction");
		expect(info.activationAction).toBe("reaction");
	});

	it("does not appear in the generic active-states toggle list", () => {
		const state = new CharacterSheetState();
		state.addFeature({name: "Branches of the Tree", source: "XPHB", description: BRANCHES_OF_THE_TREE_TEXT});
		const names = state.getActivatableFeatures().map(a => a.feature.name);
		expect(names).not.toContain("Branches of the Tree");
	});
});

describe("Classification — Vitality of the Tree (#8)", () => {
	it("classifies as passive (never activatable), even entries-only", () => {
		const infoEntries = CharacterSheetState.detectActivatableFeature({
			name: "Vitality of the Tree",
			entries: [VITALITY_OF_THE_TREE_TEXT],
		});
		expect(infoEntries).toBeNull();

		const infoDesc = CharacterSheetState.detectActivatableFeature({
			name: "Vitality of the Tree",
			description: VITALITY_OF_THE_TREE_TEXT,
		});
		expect(infoDesc).toBeNull();
	});

	it("classifies the Vitality Surge / Life-Giving Force sub-features as passive", () => {
		expect(CharacterSheetState.detectActivatableFeature({
			name: "Vitality Surge",
			entries: ["You gain Temporary Hit Points equal to your Barbarian level when you activate your Rage."],
		})).toBeNull();
		expect(CharacterSheetState.detectActivatableFeature({
			name: "Life-Giving Force",
			entries: ["At the start of each of your turns while raging you can give a creature within 10 feet Temporary Hit Points."],
		})).toBeNull();
	});

	it("keeps the sub-features passive even with a rendered description (override, not just missing description)", () => {
		// A rendered description containing "you can … as a bonus action / reaction" would
		// otherwise be picked up by the heuristic; the passive override must win.
		expect(CharacterSheetState.detectActivatableFeature({
			name: "Life-Giving Force",
			description: "While your Rage is active, at the start of each of your turns you can use a Bonus Action to give a creature within 10 feet Temporary Hit Points equal to your Rage Damage bonus in d6.",
		})).toBeNull();
	});

	it("does not appear in the generic active-states toggle list", () => {
		const state = new CharacterSheetState();
		state.addFeature({name: "Vitality of the Tree", source: "XPHB", description: VITALITY_OF_THE_TREE_TEXT});
		const names = state.getActivatableFeatures().map(a => a.feature.name);
		expect(names).not.toContain("Vitality of the Tree");
	});
});
