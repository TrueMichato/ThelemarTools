/**
 * R23 S-C — Interdiction / Resources fixes (Hochling Illrigger 15 Hellspeaker).
 *
 * Real-mechanic coverage for four player-facing bugs:
 *  - #6  Overview vs Combat resource consistency — getGenericPoolResources() is the single
 *        canonical set, redundant "<X> Improvement" riders are migrated away + never created.
 *  - #9  Moloch's Interdiction free boons carry a `source` (hoverable) and the seal-spending
 *        reaction boons (Red Cant / Slippery Ploy) expose a working Use activation.
 *  - #15 Hellsight grants truesight via a REAL sense effect while active and removes it when
 *        ended; a load-time migration strips the stale baked-in base sense.
 *
 * Asserts mechanics (resource sets, boon source/grants, sense add/remove, migrations), not
 * level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const buildHellspeaker = (level = 15, {cha = 18} = {}) => {
	const state = new CharacterSheetState();
	state._data.abilities.cha = cha;
	state.addClass({
		name: "Illrigger",
		source: "IllriggerRevised",
		level,
		subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "TGTT-IllR"},
	});
	state.applyClassFeatureEffects?.();
	return state;
};

const addBoon = (state, name) => {
	state._data.features.push({name, featureType: ["ItdBoon"], source: "IllriggerRevised"});
	return state;
};

// ==========================================================================
// #6 — Overview vs Combat resource consistency
// ==========================================================================
describe("#6 getGenericPoolResources — single canonical resource set", () => {
	it("keeps true pools with no linked feature AND classified limited-use ability pools", () => {
		const state = buildHellspeaker(15);
		// A true pool with no resolvable feature is always kept.
		state.addResource({name: "Invoke Hell", max: 1});
		// (R47) A resource linked to a classified limited-use ability is now ALSO surfaced
		// here as a trackable spend/restore pool — the Overview + Combat play tabs have no
		// abilities area of their own, so it otherwise rendered nowhere on either tab. Its
		// rich Use button still lives in the Features-tab abilities area; the two stay in
		// sync via setResourceCurrent()/setFeatureUses().
		const healingHands = {
			name: "Healing Hands",
			description: "As an action, you can touch a creature and restore a number of hit points equal to your level. Once you use this trait, you can't use it again until you finish a long rest.",
			uses: {max: 1, current: 1},
		};
		state._data.features.push(healingHands);
		state.addResource({name: "Healing Hands", max: 1});

		// Self-validate: the predicate the helper consumes must classify this as an ability,
		// otherwise the assertion below would be vacuous.
		const info = CharacterSheetState.detectActivatableFeature(healingHands);
		expect(CharacterSheetState.isActivatableAbilityEntry({feature: healingHands, activationInfo: info, interactionMode: info?.interactionMode})).toBe(true);

		const names = state.getGenericPoolResources().map(r => r.name);
		expect(names).toContain("Invoke Hell");
		expect(names).toContain("Healing Hands");
	});

	it("excludes interdiction-managed pools (Baleful Interdict, Charm Enemy)", () => {
		const state = buildHellspeaker(15);
		state._data.features.push({name: "Baleful Interdict"});
		state._data.features.push({name: "Charm Enemy"});
		state.addResource({name: "Baleful Interdict", max: 6});
		state.addResource({name: "Charm Enemy", max: 5});

		const names = state.getGenericPoolResources().map(r => r.name);
		expect(names).not.toContain("Baleful Interdict");
		expect(names).not.toContain("Charm Enemy");
	});

	it("excludes a redundant '<X> Improvement' rider pool", () => {
		const state = buildHellspeaker(15);
		state._data.features.push({name: "Forked Tongue"});
		state._data.features.push({name: "Forked Tongue Improvement"});
		state.addResource({name: "Forked Tongue Improvement", max: 1});

		const names = state.getGenericPoolResources().map(r => r.name);
		expect(names).not.toContain("Forked Tongue Improvement");
	});
});

describe("#6 migration + creation guard for redundant-improvement resources", () => {
	it("_migrateRedundantImprovementResources deletes the stale rider resource on load", () => {
		const state = buildHellspeaker(15);
		const json = state.toJson();
		json.features = [
			...(json.features || []),
			{name: "Forked Tongue"},
			{name: "Forked Tongue Improvement"},
		];
		json.resources = [
			...(json.resources || []),
			{id: "r-keep", name: "Invoke Hell", max: 1, current: 1},
			{id: "r-stale", name: "Forked Tongue Improvement", max: 1, current: 1},
		];
		state.loadFromJson(json);
		const names = state.getResources().map(r => r.name);
		expect(names).toContain("Invoke Hell");
		expect(names).not.toContain("Forked Tongue Improvement");
	});

	it("addFeature does not materialise a resource for a redundant rider", () => {
		const state = buildHellspeaker(15);
		state.addFeature({name: "Forked Tongue"});
		state.addFeature({name: "Forked Tongue Improvement", uses: {max: 1, current: 1}});
		const names = state.getResources().map(r => r.name);
		expect(names).not.toContain("Forked Tongue Improvement");
	});

	it("is idempotent — re-running the migration leaves the set unchanged", () => {
		const state = buildHellspeaker(15);
		state.addResource({name: "Invoke Hell", max: 1});
		const before = state.getResources().map(r => r.name).sort();
		state._migrateRedundantImprovementResources();
		state._migrateRedundantImprovementResources();
		const after = state.getResources().map(r => r.name).sort();
		expect(after).toEqual(before);
	});
});

// ==========================================================================
// #9 — Moloch's Interdiction free boons: hoverable + usable
// ==========================================================================
describe("#9 Moloch's Interdiction free boons", () => {
	it("grants Red Cant + Slippery Ploy at L15 (not Incontrovertible) each with a source", () => {
		const state = buildHellspeaker(15);
		const boons = state.getMolochInterdictionBoons();
		const names = boons.map(b => b.name);
		expect(names).toEqual(["Red Cant", "Slippery Ploy"]);
		expect(boons.every(b => !!b.source)).toBe(true); // source => hoverable in the panel
	});

	it("does not grant free boons to a non-Hellspeaker illrigger", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 15});
		expect(state.getMolochInterdictionBoons()).toEqual([]);
	});

	it("Red Cant + Slippery Ploy expose a seal-spending Use activation", () => {
		const state = buildHellspeaker(15);
		expect(state.hasInterdictBoonActivation("Red Cant")).toBe(true);
		expect(state.hasInterdictBoonActivation("Slippery Ploy")).toBe(true);
		expect(state.getInterdictBoonActivationLabel("Red Cant")).toBe("Expend a seal");
	});

	it("applying Red Cant spends exactly one seal and is gated when none remain", () => {
		const state = buildHellspeaker(15);
		state._data.features.push({name: "Baleful Interdict"});
		const max = state.getSealsMax();
		expect(max).toBeGreaterThan(0);
		state._setSealsAvailable(max);

		expect(state.canApplyInterdictBoonActivation("Red Cant")).toBe(true);
		const before = state.getSealsAvailable();
		const res = state.applyInterdictBoonActivation("Red Cant");
		expect(res).toBeTruthy();
		expect(before - state.getSealsAvailable()).toBe(1);

		state._setSealsAvailable(0);
		expect(state.canApplyInterdictBoonActivation("Red Cant")).toBe(false);
		expect(state.applyInterdictBoonActivation("Red Cant")).toBeNull();
	});
});

// ==========================================================================
// #15 — Hellsight truesight invoke / remove
// ==========================================================================
describe("#15 Hellsight grants + removes truesight via a real sense effect", () => {
	it("the hellsight active state carries a real truesight sense (not a note)", () => {
		const eff = CharacterSheetState.ACTIVE_STATE_TYPES.hellsight.effects;
		const sense = eff.find(e => e.type === "sense");
		expect(sense).toBeTruthy();
		expect(sense.target).toBe("truesight");
		expect(sense.value).toBe(60);
	});

	it("invoking Hellsight adds truesight 60; ending it removes truesight", () => {
		const state = buildHellspeaker(15);
		addBoon(state, "Hellsight");
		expect(state.getSenses().truesight).toBe(0);

		const id = state.addActiveState("hellsight");
		expect(state.getSenses().truesight).toBe(60);

		state.deactivateState?.(id) ?? state.removeActiveState?.(id);
		expect(state.getSenses().truesight).toBe(0);
	});

	it("_migrateInterdictBoonStaleSenses strips a stale baked truesight when Hellsight is inactive", () => {
		const state = buildHellspeaker(15);
		addBoon(state, "Hellsight");
		const json = state.toJson();
		json.senses = {...(json.senses || {}), truesight: 60}; // stale artifact from old code
		json.activeStates = []; // Hellsight not currently active
		state.loadFromJson(json);
		expect(state.getSenses().truesight).toBe(0);
	});

	it("does NOT strip a truesight that differs from the boon's grant value", () => {
		const state = buildHellspeaker(15);
		addBoon(state, "Hellsight");
		const json = state.toJson();
		json.senses = {...(json.senses || {}), truesight: 120}; // a real, larger permanent sense
		json.activeStates = [];
		state.loadFromJson(json);
		expect(state.getSenses().truesight).toBe(120);
	});
});
