/**
 * Divine Favor narrative boons as activatable, duration-tracked TOGGLES (R47-a, Bug 1).
 *
 * User report: "Attunement to Nature is still not a useable ability with a resource."
 *
 * Root cause: R46 Pass C (`applyDivineFavorEffects`) surfaced each `type:"narrative"` boon
 * (e.g. Pan → Disciple → "Attunement to Nature") as a plain Feature (Features tab) with no
 * `activatable` metadata, no per-day uses, and no combat keyword. The combat "Available to
 * Activate" surface derives from `getActivatableFeatures()`, which only routes a feature as a
 * toggle when it carries `activatable` metadata — so an at-will boon (action economy but no
 * uses / no combat keyword) was shown but never usable.
 *
 * Fix (all in owned files): Pass C now also registers each narrative boon as an activatable,
 * duration-tracked toggle (stable id + `activatable:{interactionMode:"toggle", ...}` + parsed
 * action/duration). Activation is routed through the OWNED `toggleDivineFavorBoonState()` so
 * the created active state carries the parsed duration/round countdown. combat.js
 * `_activateCombatFeature` + the "Currently Active" End (×) handler route DF boons through it.
 *
 * Evidence here (acceptance bar): a REAL `renderCombatStates` DOM-stub harness on the Lorian
 * Pan-favour (100) Tempest cleric fixture proves the boon surfaces in "Available to Activate",
 * activates (via the real `_activateCombatFeature`) into "Currently Active" with a 1-hour /
 * 600-round countdown, toggles off, and never duplicates on reload.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-combat.js";

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const BREW_PATH = path.join(__dirnameLocal, "..", "..", "..", "homebrew", "TravelersGuidetoThelemar.json");
const FIXTURE_PATH = path.join(__dirnameLocal, "fixtures", "lorian-tempest-cleric.json");

let PAN;

beforeAll(() => {
	const brew = JSON.parse(fs.readFileSync(BREW_PATH, "utf8"));
	PAN = (brew.divineFavor || []).find(g => g.name === "Pan" && g.source === "TGTT");
});

function makeState (catalog = [PAN]) {
	const s = new CharacterSheetState();
	s.setDivineFavorCatalog(catalog);
	return s;
}

/** A favour-25+ Pan cleric that has reconciled "Attunement to Nature" as a boon feature. */
function makeDiscipleState (favour = 25) {
	const s = makeState();
	s.setDivineFavorGod("Pan|TGTT");
	s.setDivineFavorLevel(favour);
	s.applyDivineFavorEffects();
	return s;
}

function boonFeature (state, name = "Attunement to Nature") {
	return (state.getFeatures() || []).find(f => f.name === name);
}

// ---------------------------------------------------------------------------
// 1. Description parsing — action economy + duration
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — _parseDivineFavorBoonActivation", () => {
	test("Attunement to Nature → action economy 'action', duration '1 hour'", () => {
		const desc = "As an action, you attune to the natural world around you ... up to a total duration of 1 hour.";
		const {activationAction, duration} = CharacterSheetState._parseDivineFavorBoonActivation(desc);
		expect(activationAction).toBe("action");
		expect(duration).toBe("1 hour");
		// The duration string must be understood by the existing round-tracker.
		expect(CharacterSheetState.parseDurationToRounds(duration)).toBe(600);
	});

	test("bonus-action + minutes duration parse", () => {
		const {activationAction, duration} = CharacterSheetState._parseDivineFavorBoonActivation(
			"As a bonus action you flare for a duration of 10 minutes.",
		);
		expect(activationAction).toBe("bonus");
		expect(duration).toBe("10 minutes");
		expect(CharacterSheetState.parseDurationToRounds(duration)).toBe(100);
	});

	test("reaction economy parse", () => {
		const {activationAction} = CharacterSheetState._parseDivineFavorBoonActivation(
			"As a reaction, when a creature you can see attacks you, ...",
		);
		expect(activationAction).toBe("reaction");
	});

	test("no stated duration → 'Until ended' (indefinite), default action economy", () => {
		const {activationAction, duration} = CharacterSheetState._parseDivineFavorBoonActivation(
			"You may radiate a calming aura around you.",
		);
		expect(activationAction).toBe("action");
		expect(duration).toBe("Until ended");
		expect(CharacterSheetState.parseDurationToRounds(duration)).toBeNull();
	});

	test("single 'round' duration is singularised", () => {
		const {duration} = CharacterSheetState._parseDivineFavorBoonActivation("lasts for 1 round.");
		expect(duration).toBe("1 round");
		expect(CharacterSheetState.parseDurationToRounds(duration)).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// 2. Stable feature id
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — _divineFavorBoonFeatureId", () => {
	test("deterministic, slugified, stable across calls", () => {
		const god = {name: "Pan", source: "TGTT"};
		const boon = {name: "Attunement to Nature"};
		const id1 = CharacterSheetState._divineFavorBoonFeatureId(god, boon);
		const id2 = CharacterSheetState._divineFavorBoonFeatureId(god, boon);
		expect(id1).toBe("dfboon_pan_attunement-to-nature");
		expect(id2).toBe(id1);
	});

	test("distinct gods/boons produce distinct ids", () => {
		const a = CharacterSheetState._divineFavorBoonFeatureId({name: "Pan"}, {name: "Attunement to Nature"});
		const b = CharacterSheetState._divineFavorBoonFeatureId({name: "Pan"}, {name: "Wild Shape"});
		const c = CharacterSheetState._divineFavorBoonFeatureId({name: "Sol"}, {name: "Attunement to Nature"});
		expect(new Set([a, b, c]).size).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// 3. Pass C registration — boon feature carries toggle metadata + 1/day pool
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — Pass C metadata", () => {
	function boonResource (state, featureId = "dfboon_pan_attunement-to-nature") {
		return (state.getResources() || []).find(r => r._dfNarrativeBoon && r.featureId === featureId);
	}

	test("Attunement to Nature is added with activatable toggle metadata + stable id", () => {
		const s = makeDiscipleState(25);
		const f = boonFeature(s);
		expect(f).toBeDefined();
		expect(f.id).toBe("dfboon_pan_attunement-to-nature");
		expect(f._divineFavor).toBe(true);
		expect(f._dfNarrativeBoon).toBe(true);
		expect(f._dfBoonDuration).toBe("1 hour");
		expect(f.activatable).toMatchObject({
			interactionMode: "toggle",
			stateTypeId: "custom",
			activationAction: "action",
			duration: "1 hour",
		});
		// The use pool lives on a separate tagged resource, NOT on the feature.
		expect(f.uses).toBeUndefined();
	});

	test("the boon mints a single 1/day (recharge:long) resource, full on first reconcile", () => {
		const s = makeDiscipleState(25);
		const matches = (s.getResources() || []).filter(r => r._dfNarrativeBoon && r.featureId === "dfboon_pan_attunement-to-nature");
		expect(matches).toHaveLength(1);
		const res = matches[0];
		expect(res.max).toBe(1);
		expect(res.current).toBe(1);
		expect(res.recharge).toBe("long");
		expect(res._divineFavor).toBe(true);
		// (R42/B4) Canonical, stable resource id — `res_dfboon_<featureId>` — so reload/reconcile
		// re-targets the same pool instead of minting a fresh one.
		expect(res.id).toBe("res_dfboon_dfboon_pan_attunement-to-nature");
	});

	test("the boon's 1/day pool surfaces in the generic Resources tracker", () => {
		const s = makeDiscipleState(25);
		const pool = (s.getGenericPoolResources() || []).find(r => r._dfNarrativeBoon);
		expect(pool).toBeDefined();
		expect(pool.name).toBe("Attunement to Nature");
	});

	test("re-applying does not duplicate the boon feature OR its resource (idempotent)", () => {
		const s = makeDiscipleState(25);
		s.applyDivineFavorEffects();
		s.applyDivineFavorEffects();
		const matches = (s.getFeatures() || []).filter(f => f.id === "dfboon_pan_attunement-to-nature");
		expect(matches).toHaveLength(1);
		expect((s.getResources() || []).filter(r => r._dfNarrativeBoon)).toHaveLength(1);
	});

	test("a spent use is preserved across an applyDivineFavorEffects reconcile", () => {
		const s = makeDiscipleState(25);
		// Consume the day's use.
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		expect(boonResource(s).current).toBe(0);
		// Reconcile (favour/god change or post-load): the spent use must NOT silently refill.
		s.applyDivineFavorEffects();
		expect(boonResource(s).current).toBe(0);
	});

	test("a spent use is preserved across a toJson/loadFromJson round-trip", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		const json = s.toJson();
		const s2 = makeState();
		s2.loadFromJson(json);
		s2.applyDivineFavorEffects();
		expect(boonResource(s2).current).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 4. Surfacing — getActivatableFeatures classifies the boon as an available toggle
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — getActivatableFeatures surfacing", () => {
	function boonEntry (state) {
		return (state.getActivatableFeatures() || [])
			.find(af => af.feature?.id === "dfboon_pan_attunement-to-nature");
	}

	test("boon appears as a toggle, initially inactive, linked to its 1/day pool", () => {
		const s = makeDiscipleState(25);
		const entry = boonEntry(s);
		expect(entry).toBeDefined();
		expect(entry.interactionMode).toBe("toggle");
		expect(entry.activationInfo.isToggle).toBe(true);
		expect(entry.isActive).toBe(false);
		// The 1/day pool is linked so both activate surfaces can show/gate remaining uses.
		expect(entry.resource).toBeDefined();
		expect(entry.resource).not.toBeNull();
		expect(entry.resource._dfNarrativeBoon).toBe(true);
		expect(entry.resource.max).toBe(1);
		expect(entry.resource.current).toBe(1);
	});

	test("boon is NOT filtered out as an ability / hidden surface (so it reaches the combat list)", () => {
		const s = makeDiscipleState(25);
		const entry = boonEntry(s);
		// These are exactly the gatekeepers renderCombatStates() applies to availableFeatures.
		expect(CharacterSheetState.isActivatableAbilityEntry(entry)).toBe(false);
		expect(CharacterSheetState.isInterdictBoonEntry(entry)).toBe(false);
		expect(CharacterSheetState.isHiddenFromGenericAbilitySurfaces(entry.feature, s.getFeatures())).toBe(false);
	});

	test("once toggled on, getActivatableFeatures reports it active", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		expect(boonEntry(s).isActive).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. toggleDivineFavorBoonState — active state creation, duration, off, expiry, orphan prune
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — toggleDivineFavorBoonState", () => {
	test("toggling on creates a tagged custom active state carrying the parsed duration", () => {
		const s = makeDiscipleState(25);
		const on = s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		expect(on).toBe(true);
		const st = s.getActiveStates().find(x => x._dfNarrativeBoon);
		expect(st).toBeDefined();
		expect(st.active).toBe(true);
		expect(st.sourceFeatureId).toBe("dfboon_pan_attunement-to-nature");
		expect(st.name).toBe("Attunement to Nature");
		expect(st.duration).toBe("1 hour");
	});

	test("in combat the toggle tracks a 1-hour / 600-round countdown", () => {
		const s = makeDiscipleState(25);
		s.startCombat();
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		const st = s.getActiveStates().find(x => x._dfNarrativeBoon);
		expect(st.roundsRemaining).toBe(600);
	});

	test("toggling off removes the state (returns false)", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		const off = s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		expect(off).toBe(false);
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon)).toBe(false);
	});

	test("advanceRound to 0 auto-deactivates the boon (duration end clears it)", () => {
		const s = makeDiscipleState(25);
		s.startCombat();
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		const st = s.getActiveStates().find(x => x._dfNarrativeBoon);
		// Fast-forward: shrink the remaining rounds so a single advance expires it.
		st.roundsRemaining = 1;
		const expired = s.advanceRound();
		expect(expired).toContain("Attunement to Nature");
		expect(s.getActiveStates().find(x => x._dfNarrativeBoon).active).toBe(false);
		// (R42/B4) Expiry stops the toggle but must NOT refund the daily use — it stays spent
		// until a long rest.
		const boonRes = (s.getResources() || []).find(r => r._dfNarrativeBoon && r.featureId === "dfboon_pan_attunement-to-nature");
		expect(boonRes.current).toBe(0);
	});

	test("returns null for a non-DF-boon feature id", () => {
		const s = makeDiscipleState(25);
		expect(s.toggleDivineFavorBoonState("does-not-exist")).toBeNull();
	});

	test("an active toggle survives a reconcile/reload (stable id) and is not duplicated", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		// Simulate the controller's post-load reconcile.
		s.applyDivineFavorEffects();
		const states = s.getActiveStates().filter(x => x._dfNarrativeBoon);
		expect(states).toHaveLength(1);
		expect(states[0].active).toBe(true);
		expect((s.getFeatures() || []).filter(f => f.id === "dfboon_pan_attunement-to-nature")).toHaveLength(1);
	});

	test("an active toggle survives a toJson/loadFromJson round-trip", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		const json = s.toJson();

		const s2 = makeState();
		s2.loadFromJson(json);
		s2.applyDivineFavorEffects(); // controller runs this post-load once the catalog is set
		const states = s2.getActiveStates().filter(x => x._dfNarrativeBoon && x.active);
		expect(states).toHaveLength(1);
		expect(states[0].sourceFeatureId).toBe("dfboon_pan_attunement-to-nature");
	});

	test("orphaned toggle state is pruned when the boon is no longer granted (favour drop)", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon)).toBe(true);

		// Drop below the Disciple tier — the boon feature is no longer re-added, so its
		// lingering toggle state must be pruned (block 1f).
		s.setDivineFavorLevel(10);
		s.applyDivineFavorEffects();
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon)).toBe(false);
	});

	test("orphaned toggle state is pruned when the god is cleared", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		s.setDivineFavorGod("");
		s.applyDivineFavorEffects();
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 5b. 1/day use pool (R42/B4) — activation consumes, long rest restores
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — 1/day use pool", () => {
	const FID = "dfboon_pan_attunement-to-nature";
	function pool (state) {
		return (state.getResources() || []).find(r => r._dfNarrativeBoon && r.featureId === FID);
	}

	test("activating (ON) consumes exactly one daily use (1 → 0)", () => {
		const s = makeDiscipleState(25);
		expect(pool(s).current).toBe(1);
		const on = s.toggleDivineFavorBoonState(FID);
		expect(on).toBe(true);
		expect(pool(s).current).toBe(0);
	});

	test("toggling OFF does NOT refund the spent use (stays 0)", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState(FID); // ON — spends the use
		s.toggleDivineFavorBoonState(FID); // OFF — must not refund
		expect(pool(s).current).toBe(0);
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon && x.active)).toBe(false);
	});

	test("when the pool is exhausted a fresh activation is REFUSED (no state, no double-spend)", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState(FID); // ON
		s.toggleDivineFavorBoonState(FID); // OFF (use already spent)
		expect(pool(s).current).toBe(0);
		// Attempting to re-activate while exhausted must be refused.
		const retry = s.toggleDivineFavorBoonState(FID);
		expect(retry).toBe(false);
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon && x.active)).toBe(false);
		expect(pool(s).current).toBe(0); // never went negative
	});

	test("a long rest restores the daily use (0 → 1) so the boon can be used again", () => {
		const s = makeDiscipleState(25);
		s.toggleDivineFavorBoonState(FID); // ON — spends the use
		s.toggleDivineFavorBoonState(FID); // OFF — stops the toggle, use stays spent
		expect(pool(s).current).toBe(0);
		s.recoverResources("long");
		expect(pool(s).current).toBe(1);
		// And it's usable again after the rest.
		expect(s.toggleDivineFavorBoonState(FID)).toBe(true);
		expect(pool(s).current).toBe(0);
	});

	test("consuming the use does NOT shorten the toggle duration (600-round countdown intact)", () => {
		const s = makeDiscipleState(25);
		s.startCombat();
		s.toggleDivineFavorBoonState(FID);
		const st = s.getActiveStates().find(x => x._dfNarrativeBoon && x.active);
		expect(st.roundsRemaining).toBe(600);
		expect(pool(s).current).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 6. REAL combat surface — renderCombatStates + _activateCombatFeature on the fixture
// ---------------------------------------------------------------------------
describe("Divine Favor boon toggle — REAL combat surfacing (Lorian fixture)", () => {
	let savedDocument;

	beforeAll(() => {
		savedDocument = globalThis.document;
	});
	afterAll(() => {
		globalThis.document = savedDocument;
	});

	/** Load the real Pan-favour-100 Tempest cleric and reconcile Divine Favor. */
	function loadLorian () {
		const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
		const s = makeState();
		s.loadFromJson(JSON.parse(raw));
		s.applyDivineFavorEffects();
		return s;
	}

	/**
	 * Build a real CharacterSheetCombat wired to a stub page + a single stub combat-states
	 * container, so the REAL renderCombatStates() / _activateCombatFeature() run end-to-end.
	 */
	function makeCombatHarness (state) {
		const container = globalThis.e_({outer: `<div id="charsheet-combat-states"></div>`});
		globalThis.document = {getElementById: (id) => (id === "charsheet-combat-states" ? container : null)};

		const page = {
			getState: () => state,
			_getFeatureHoverLink: (f) => f?.name,
			_saveCurrentCharacter: () => {},
			_renderActiveStates: () => {},
			_renderCharacter: () => {},
			_activateFeatureState: () => {},
		};

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = page;
		// Neutralise DOM-touching helpers not under test.
		combat._updateCombatTrackerUI = () => {};
		combat._initQuickStateButtons = () => {};
		combat._initCombatTracker = () => {};
		return {combat, container};
	}

	test("fixture has Attunement to Nature as a boon toggle feature", () => {
		const s = loadLorian();
		expect(s.getDivineFavorGodData()?.name).toBe("Pan");
		expect(s.getDivineFavor().favor).toBe(100);
		expect(boonFeature(s)?._dfNarrativeBoon).toBe(true);
	});

	test("boon renders in the combat 'Available to Activate' section", () => {
		const s = loadLorian();
		const {combat, container} = makeCombatHarness(s);
		combat.renderCombatStates();
		expect(container._html).toContain("Available to Activate");
		expect(container._html).toContain("Attunement to Nature");
	});

	test("activating via the real _activateCombatFeature creates an active toggle with a countdown, then renders in 'Currently Active'", () => {
		const s = loadLorian();
		s.startCombat();
		const {combat, container} = makeCombatHarness(s);

		const entry = (s.getActivatableFeatures() || [])
			.find(af => af.feature?.id === "dfboon_pan_attunement-to-nature");
		expect(entry).toBeDefined();

		// Exactly what the "Activate" button's click handler invokes.
		combat._activateCombatFeature(entry.feature, entry.stateTypeId, entry.activationInfo.stateType, entry.resource, 1, entry.activationInfo);

		const st = s.getActiveStates().find(x => x._dfNarrativeBoon && x.active);
		expect(st).toBeDefined();
		expect(st.roundsRemaining).toBe(600);
		// (R42/B4) The real combat activation path must route through the 1/day choke point:
		// the daily use drops 1 → 0 (not the generic-resource bypass, which would leave it at 1).
		const boonRes = (s.getResources() || []).find(r => r._dfNarrativeBoon && r.featureId === "dfboon_pan_attunement-to-nature");
		expect(boonRes.current).toBe(0);

		// Re-render: the boon now shows in "Currently Active" with a round reminder + End (×).
		combat.renderCombatStates();
		expect(container._html).toContain("Currently Active");
		expect(container._html).toContain("Attunement to Nature");
		expect(container._html).toContain("600r");
	});

	test("toggling the boon off via the real activation path removes the active state", () => {
		const s = loadLorian();
		s.startCombat();
		const {combat} = makeCombatHarness(s);
		const feature = boonFeature(s);

		combat._activateCombatFeature(feature, "custom", null, null, 1, {isToggle: true});
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon && x.active)).toBe(true);

		// _activateCombatFeature is a toggle → a second call turns it off.
		combat._activateCombatFeature(feature, "custom", null, null, 1, {isToggle: true});
		expect(s.getActiveStates().some(x => x._dfNarrativeBoon && x.active)).toBe(false);
	});

	test("reload after activation does not duplicate the boon in the combat surface", () => {
		const s = loadLorian();
		s.toggleDivineFavorBoonState("dfboon_pan_attunement-to-nature");
		s.applyDivineFavorEffects(); // reconcile/reload

		const {combat, container} = makeCombatHarness(s);
		combat.renderCombatStates();

		// Exactly one active _dfNarrativeBoon state, and exactly one boon feature.
		expect(s.getActiveStates().filter(x => x._dfNarrativeBoon && x.active)).toHaveLength(1);
		expect((s.getFeatures() || []).filter(f => f.id === "dfboon_pan_attunement-to-nature")).toHaveLength(1);
		// Rendered once in "Currently Active" (not also re-listed as available).
		const occurrences = container._html.split("Attunement to Nature").length - 1;
		expect(occurrences).toBe(1);
	});
});
