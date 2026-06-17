/**
 * R25 S1 — Abilities-tab "Use" routing gap (bugs #1, #2, #3, #5, #8).
 *
 * The Abilities-tab combat-action card's Use button (`_useCombatAction`) was Monk-centric:
 * it parsed ki/focus/stamina and hardcoded a handful of Monk abilities, but NEVER dispatched
 * to the specialized ability pipeline (`_pUseFeatureAbility` → `_pHandleR20FeatureActivation`).
 * So clicking Use on Guided Strike / War God's Blessing (shared Divine Manifestation pool),
 * Forked Tongue (language-swap modal), Purge Toxins (spend stamina), and the Invoke Hell
 * options (shared Invoke Hell pool) silently no-op'd from that surface, while the Features-tab
 * path worked.
 *
 * These tests assert the ROUTING DISPATCH at the unit boundary:
 *  - a classified activatable ability is delegated to `_page._pUseFeatureAbility` (the same
 *    canonical pipeline the Features tab uses) and does NOT run the Monk resource fall-through;
 *  - action economy (the Action/Bonus/Reaction for the round) is still consumed on that path;
 *  - a NON-classified feature still falls through to the legacy combat path unchanged;
 *  - the state layer parses a bare "spend N stamina" cost (Purge Toxins) into the activation
 *    info so the unified pipeline consumes it — without overriding a named shared pool.
 *
 * Live (real rendered Abilities-tab card click, vaa = Hochling Illrigger 15) confirmed, in the
 * same dispatch this suite guards:
 *  - #2/#5 Guided Strike: rolled the weapon attack with "+10" in the breakdown, Divine
 *    Manifestation 1→0; multi-attack opened the "Which Attack?" picker (consume-only-on-roll);
 *    weapon-attack right-click "Guided Strike (+10)" still rolls + consumes.
 *  - #5 War God's Blessing: Divine Manifestation 1→0 (same shared pool).
 *  - #3 Forked Tongue: opened the "Forked Tongue — Swap Language" modal.
 *  - #1 Purge Toxins: stamina 10→8 (correct 2-stamina cost).
 *  - #8 Honey-Sweet Blades + Turncoat: Invoke Hell 3→2→1, each card labelled "Invoke Hell".
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetState = globalThis.CharacterSheetState;

describe("R25 — Abilities-tab Use routes classified abilities through the unified pipeline", () => {
	let combat;
	let toasts;
	let pUseFeatureAbilityCalls;
	let activatableNames;
	let kiSpends;
	let staminaSpends;

	function makeCombat () {
		toasts = [];
		pUseFeatureAbilityCalls = [];
		activatableNames = new Set();
		kiSpends = 0;
		staminaSpends = 0;

		globalThis.JqueryUtil = {doToast: (payload) => toasts.push(payload)};

		const mockState = {
			isInCombat: () => true,
			getFeatures: () => [],
			getFeatureCalculations: () => ({}),
			// If the Monk fall-through ran, these would fire — they must NOT for a routed ability.
			useKiPoint: () => { kiSpends++; return true; },
			canUseFocusForStamina: () => true,
			useFocusForStamina: () => { staminaSpends++; return true; },
		};

		const c = Object.create(CharacterSheetCombat.prototype);
		c._state = mockState;
		c._page = {
			// The genuine classification predicate the renderer/Features tab also use.
			_getActivatableAbilityForFeature: (feature) => (activatableNames.has(feature.name) ? {feature} : null),
			_pUseFeatureAbility: async (feature) => { pUseFeatureAbilityCalls.push(feature.name); return true; },
			_renderFeatures: () => {},
			_renderResources: () => {},
			_saveCurrentCharacter: () => {},
		};
		c.renderCombatActions = () => {};
		c.renderCombatResources = () => {};
		c._resetTurnActionUsage();
		return c;
	}

	beforeEach(() => { combat = makeCombat(); });

	it("delegates a classified ability to _pUseFeatureAbility and skips the Monk resource fall-through", async () => {
		const feature = {
			name: "Guided Strike",
			source: "TGTT-IllR",
			description: "As an action, you can spend 1 ki point to strike true.",
		};
		activatableNames.add("Guided Strike");

		await combat._useCombatAction(feature);

		// Routed to the canonical pipeline …
		expect(pUseFeatureAbilityCalls).toEqual(["Guided Strike"]);
		// … and the Monk-centric resource fall-through did NOT also fire (no double-spend).
		expect(kiSpends).toBe(0);
		expect(staminaSpends).toBe(0);
	});

	it("still consumes action economy for the round on the routed path", async () => {
		const feature = {
			name: "War God's Blessing",
			source: "TGTT-IllR",
			description: "As a reaction when an ally misses an attack roll, you can grant a bonus.",
		};
		activatableNames.add("War God's Blessing");

		expect(combat._isActionTypeAvailable("reaction")).toBe(true);
		await combat._useCombatAction(feature);

		expect(pUseFeatureAbilityCalls).toEqual(["War God's Blessing"]);
		expect(combat._turnActionUsage.reaction).toBe(true);
		expect(combat._isActionTypeAvailable("reaction")).toBe(false);
	});

	it("does NOT consume the round's action when the action type is already spent", async () => {
		const feature = {
			name: "Forked Tongue",
			source: "TGTT-IllR",
			description: "As an action, you can swap one language you know.",
		};
		activatableNames.add("Forked Tongue");
		combat._consumeActionType("action"); // action already used this round

		await combat._useCombatAction(feature);

		// Blocked before any dispatch — the pipeline is never called.
		expect(pUseFeatureAbilityCalls).toEqual([]);
		expect(toasts.some(t => t.type === "warning")).toBe(true);
	});

	it("leaves a NON-classified feature on the legacy combat path (no pipeline delegation)", async () => {
		const feature = {
			name: "Cunning Action",
			source: "PHB",
			description: "You can take a bonus action on each of your turns to Dash, Disengage, or Hide.",
		};
		// Not added to activatableNames → not a classified ability.

		await combat._useCombatAction(feature);

		expect(pUseFeatureAbilityCalls).toEqual([]);
		expect(toasts.some(t => t.type === "success")).toBe(true);
	});
});

describe("R25 #1 — state parses a bare 'spend N stamina' ability cost (Purge Toxins)", () => {
	it("classifies Purge Toxins as a limited-use ability that spends 2 stamina", () => {
		const purgeToxins = {
			name: "Purge Toxins",
			source: "TGTT-IllR",
			description: "As an action you can spend 2 stamina to end one poison affecting you.",
		};

		const info = CharacterSheetState.detectActivatableFeature(purgeToxins);
		expect(info).toBeTruthy();
		expect(info.interactionMode).toBe("limited");
		expect(info.activationAction).toBe("action");
		// The legacy combat regex required the literal "stamina point(s)"; the bare phrasing
		// must now parse so the unified pipeline can resolve a Stamina resource and deduct it.
		expect(info.staminaCost).toBe(2);
	});

	it("does NOT let a stamina mention override a feature linked to a named shared pool", () => {
		// An Invoke Hell option carries `consumes: {name: "Invoke Hell"}` → it links to that
		// shared pool, NOT an incidental stamina cost.
		const invokeHellOption = {
			name: "Honey-Sweet Blades",
			source: "TGTT-IllR",
			consumes: {name: "Invoke Hell", amount: 1},
			description: "As a bonus action you weave hellish charm. (You may also spend 1 stamina elsewhere.)",
		};

		const info = CharacterSheetState.detectActivatableFeature(invokeHellOption);
		expect(info).toBeTruthy();
		expect(info.resourceName).toBe("Invoke Hell");
		expect(info.staminaCost).toBeNull();
	});
});
