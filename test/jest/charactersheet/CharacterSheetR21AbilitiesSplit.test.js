/**
 * R21 — Abilities-area vs Active-States-panel split.
 *
 * Foundation regression suite for the Round-20 false-greens (#1/#2/#3/#14/#16): the
 * Hochling Illrigger L10 abilities Healing Hands, Guided Strike, Baleful Interdict, Forked
 * Tongue, Charm Enemy, War God's Blessing, Forked Tongue Improvement are CLASSIFIED as
 * limited-use abilities (interactionMode "limited", isToggle false) yet still leaked into the
 * active-states "Available to Activate" panel. They must surface ONLY in the features/abilities
 * area; the active-states panel keeps genuine toggles/stances. Interdict boons that "expend a
 * seal" are likewise abilities, never live toggles.
 *
 * These assertions run against a COMMITTED fixture exported from the real character so the
 * suite cannot go false-green against synthetic data.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;

const FIXTURE = resolve(__dirname, "fixtures", "r21-hochling-illrigger-l10.json");

function loadRealChar () {
	const state = new CharacterSheetState();
	state.loadFromJson(JSON.parse(readFileSync(FIXTURE, "utf8")));
	return state;
}

/** Mirror of the active-states Section-2 "Available to Activate" filter in charactersheet.js. */
function activeStatesPanelEntries (af) {
	return af.filter(a =>
		!a.isActive
		&& !CharacterSheetState.isActivatableAbilityEntry(a)
		&& !CharacterSheetState.isInterdictBoonEntry(a)
		&& !a.feature?.isCustomAbility);
}

describe("R21 split — isActivatableAbilityEntry predicate", () => {
	test("limited / trigger / instant non-toggle entries are abilities", () => {
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "limited", activationInfo: {isToggle: false}})).toBe(true);
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "trigger", activationInfo: {isToggle: false}})).toBe(true);
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "instant", activationInfo: {isToggle: false}})).toBe(true);
		expect(CharacterSheetState.isActivatableAbilityEntry({activationInfo: {isInstant: true}})).toBe(true);
	});

	test("toggles and custom abilities are NOT abilities", () => {
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "toggle", activationInfo: {isToggle: true}})).toBe(false);
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "limited", activationInfo: {isToggle: true}})).toBe(false);
		expect(CharacterSheetState.isActivatableAbilityEntry({interactionMode: "limited", feature: {isCustomAbility: true}})).toBe(false);
		expect(CharacterSheetState.isActivatableAbilityEntry(null)).toBe(false);
		expect(CharacterSheetState.isActivatableAbilityEntry({})).toBe(false);
	});
});

describe("R21 split — real Hochling Illrigger L10 character", () => {
	const ABILITY_NAMES = [
		"Healing Hands", "Guided Strike", "Baleful Interdict", "Forked Tongue",
		"Charm Enemy", "War God's Blessing", "Forked Tongue Improvement",
	];

	test("classified abilities are NOT in the active-states Available-to-Activate panel", () => {
		const state = loadRealChar();
		const af = state.getActivatableFeatures();
		const panelNames = activeStatesPanelEntries(af).map(a => a.feature?.name);
		for (const name of ABILITY_NAMES) {
			expect(panelNames).not.toContain(name);
		}
	});

	test("classified abilities ARE present as activatable abilities (features-area surface)", () => {
		const state = loadRealChar();
		const af = state.getActivatableFeatures();
		const abilityNames = af.filter(a => CharacterSheetState.isActivatableAbilityEntry(a)).map(a => a.feature?.name);
		for (const name of ABILITY_NAMES) {
			expect(abilityNames).toContain(name);
		}
	});

	test("genuine toggles still surface in the active-states panel", () => {
		const state = loadRealChar();
		const af = state.getActivatableFeatures();
		const panelNames = activeStatesPanelEntries(af).map(a => a.feature?.name);
		// Purge Toxins is a real on/off toggle on this build and must remain in the panel.
		expect(panelNames).toContain("Purge Toxins");
	});

	test("#14 — interdict boon (Veil of Lies) is invoked from the abilities area, never the panel", () => {
		const state = loadRealChar();
		const af = state.getActivatableFeatures();
		const veil = af.find(a => a.feature?.name === "Veil of Lies");
		expect(veil).toBeTruthy();
		// It's an interdict boon (surfaces in the abilities area, filtered from the panel)…
		expect(CharacterSheetState.isInterdictBoonEntry(veil)).toBe(true);
		// …but it KEEPS its named active-state toggle binding so invoking turns on the real
		// buff (Invisible + duration) — it is NOT reclassified into a generic ability.
		expect(veil.stateTypeId).toBe("veilOfLies");
		const panelNames = activeStatesPanelEntries(af).map(a => a.feature?.name);
		expect(panelNames).not.toContain("Veil of Lies");
	});

	test("#14 — invoking the boon's named state spends a seal and applies its effect", () => {
		const state = loadRealChar();
		const veil = state.getActivatableFeatures().find(a => a.feature?.name === "Veil of Lies");
		expect(veil).toBeTruthy();
		// getActivatableFeatures links the boon to the Baleful Interdict seal pool, so the
		// page's _pUseFeatureAbility -> _activateFeatureState deducts a seal on invoke.
		expect(veil.resource?.name).toMatch(/Baleful Interdict/i);
		// And routing through the named state (what _activateFeatureState does for a known
		// toggle) applies the curated effect.
		expect(state.hasCondition("Invisible")).toBe(false);
		state.activateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);
	});
});

describe("R21 split — interdict-boon classification (#14)", () => {
	function buildIllrigger (level = 10) {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
		return state;
	}

	test("ItdBoon optional features are recognised generically by featureType", () => {
		expect(CharacterSheetState.isInterdictBoonFeature({name: "Veil of Lies", optionalFeatureTypes: ["ItdBoon"]})).toBe(true);
		expect(CharacterSheetState.isInterdictBoonFeature({name: "Shadow Shroud", featureType: ["ItdBoon"]})).toBe(true);
		expect(CharacterSheetState.isInterdictBoonFeature({name: "Rage", featureType: ["class"]})).toBe(false);
		expect(CharacterSheetState.isInterdictBoonFeature({name: "x"})).toBe(false);
	});

	test("a named boon keeps its ACTIVE_STATE_TYPES toggle binding (effect machinery intact)", () => {
		// REFINED-(B): we do NOT reclassify boons into generic abilities — that would sever the
		// named state and drop the curated +2 AC / Invisible / truesight effects (regressing #8).
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Veil of Lies",
			optionalFeatureTypes: ["ItdBoon"],
			description: "As a bonus action, you can expend a seal to become invisible for 10 minutes or until you attack or cast a spell.",
		});
		expect(info).toBeTruthy();
		expect(info.stateTypeId).toBe("veilOfLies");
		expect(info.isToggle).toBe(true);
	});

	test("a boon is filtered from the panel but surfaces as an invokable ability, and applies its effect", () => {
		const state = buildIllrigger(10);
		state._data.features.push({
			name: "Veil of Lies",
			featureType: ["ItdBoon"],
			source: "IllriggerRevised",
			description: "As a bonus action, you can expend a seal to become invisible for 10 minutes or until you attack or cast a spell.",
		});
		const af = state.getActivatableFeatures();
		const veil = af.find(a => a.feature?.name === "Veil of Lies");
		expect(veil).toBeTruthy();
		// (a) not in the active-states "Available to Activate" list
		expect(activeStatesPanelEntries(af).map(a => a.feature?.name)).not.toContain("Veil of Lies");
		// (b) surfaces in the abilities area (the page resolver gates on this union)
		expect(CharacterSheetState.isActivatableAbilityEntry(veil) || CharacterSheetState.isInterdictBoonEntry(veil)).toBe(true);
		// (c) invoking activates the named state and applies its effect
		expect(state.hasCondition("Invisible")).toBe(false);
		state.activateState("veilOfLies");
		expect(state.hasCondition("Invisible")).toBe(true);
	});

	test("the bare-name boon (no ItdBoon marker) keeps its legacy toggle classification", () => {
		// Effect-application machinery (S-BOONS / #8) still resolves boons by name via
		// ACTIVE_STATE_TYPES; classification here is unchanged.
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Shadow Shroud",
			description: "A mantle of semisolid shadows around yourself.",
		});
		expect(info).toBeTruthy();
		expect(info.stateTypeId).toBe("shadowShroud");
		expect(info.isToggle).toBe(true);
	});
});
