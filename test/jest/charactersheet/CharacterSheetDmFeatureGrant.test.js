/**
 * Bug #11 — Advanced, DM-gated feature grant from real data sources.
 *
 * The custom-ability system already grants REAL features generically:
 * `_registerCustomAbilityGrants` iterates `grants.features` and calls `addFeature(...)`,
 * tagged `sourceAbilityId` for teardown. This bug extends that so a grant can carry a
 * FULL feature payload from any data source (class/subclass feature, optional feature,
 * feat, or a pasted monster trait / boon / reward) — applied exactly like a normal
 * feature (uses/resources/modifiers/effects parsed automatically via
 * `buildFeatureStateObject` + `addFeature`) with visible provenance.
 *
 * Grant shape (produced by the modal UI, round-tripped through save/load):
 *   { grantKind: "dataFeature", name, source, dmGranted: true,
 *     origin: {sourceType, name, source}, data: <full feature payload> }
 *
 * Fixes under test:
 *  A. a `dataFeature` grant adds a real feature to state, its explicit `uses` block is
 *     materialised as a tracked resource, and provenance (`dmGranted`, `origin`,
 *     `sourceAbilityId`) is recorded on the feature.
 *  B. removing the custom ability tears the granted feature (and its resource) back down.
 *  C. a pasted / feat-style payload works the same way (data-driven, source-agnostic).
 *  D. legacy optional-feature grants (no `grantKind`) still work — backward compatible.
 */

import "./setup.js";

let CharacterSheetState;
beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** A full class-feature payload (as picked from the Class Features pool). */
function stoneheartResolveGrant () {
	return {
		grantKind: "dataFeature",
		name: "Stoneheart Resolve",
		source: "XPHB",
		dmGranted: true,
		origin: {sourceType: "classFeature", name: "Stoneheart Resolve", source: "XPHB"},
		featureType: "Class Feature",
		data: {
			name: "Stoneheart Resolve",
			source: "XPHB",
			className: "Fighter",
			classSource: "XPHB",
			level: 1,
			entries: [
				"You have a limited well of physical and mental stamina that you can draw on. You can use it a number of times, regaining all expended uses on a long rest.",
			],
			uses: {max: 2, recharge: "long"},
		},
	};
}

/** A pasted, homebrew/boon-style payload (not loaded in any sheet pool). */
function pastedBoonGrant () {
	return {
		grantKind: "dataFeature",
		name: "Ancient Blessing",
		source: "Homebrew",
		dmGranted: true,
		origin: {sourceType: "json", name: "Ancient Blessing", source: "Homebrew"},
		featureType: "Feature",
		data: {
			name: "Ancient Blessing",
			source: "Homebrew",
			entries: ["A gift from a forgotten god."],
			uses: {max: 3, recharge: "long"},
		},
	};
}

function baseGrants (features) {
	return {
		spells: [],
		proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
		features,
	};
}

describe("#11 Advanced DM-granted data-feature grants", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("con", 14);
	});

	test("a dataFeature grant adds a real feature with provenance recorded", () => {
		const abilityId = state.addCustomAbility({
			name: "Battlefield Training (DM)",
			mode: "passive",
			grants: baseGrants([stoneheartResolveGrant()]),
		});

		const feature = state.getFeatures().find(f => f.name === "Stoneheart Resolve");
		expect(feature).toBeDefined();
		// Provenance is preserved so the grant stays badged + auditable.
		expect(feature.dmGranted).toBe(true);
		expect(feature.origin).toMatchObject({sourceType: "classFeature", name: "Stoneheart Resolve"});
		expect(feature.sourceAbilityId).toBe(abilityId);
		// buildFeatureStateObject rendered a description from the entries.
		expect(typeof feature.description).toBe("string");
		expect(feature.description.length).toBeGreaterThan(0);
	});

	test("the granted feature's explicit uses are materialised as a tracked resource", () => {
		state.addCustomAbility({
			name: "Battlefield Training (DM)",
			mode: "passive",
			grants: baseGrants([stoneheartResolveGrant()]),
		});

		const feature = state.getFeatures().find(f => f.name === "Stoneheart Resolve");
		expect(feature.uses).toMatchObject({max: 2, recharge: "long"});

		const resource = state.getResources().find(r => r.name === "Stoneheart Resolve");
		expect(resource).toBeDefined();
		expect(resource.max).toBe(2);
		expect(resource.featureId).toBe(feature.id);
	});

	test("removing the ability tears the granted feature AND its resource back down", () => {
		const abilityId = state.addCustomAbility({
			name: "Battlefield Training (DM)",
			mode: "passive",
			grants: baseGrants([stoneheartResolveGrant()]),
		});

		expect(state.getFeatures().some(f => f.name === "Stoneheart Resolve")).toBe(true);
		expect(state.getResources().some(r => r.name === "Stoneheart Resolve")).toBe(true);

		state.removeCustomAbility(abilityId);

		expect(state.getFeatures().some(f => f.name === "Stoneheart Resolve")).toBe(false);
		expect(state.getResources().some(r => r.name === "Stoneheart Resolve")).toBe(false);
	});

	test("a pasted / homebrew payload is granted the same way (data-driven, source-agnostic)", () => {
		const abilityId = state.addCustomAbility({
			name: "Divine Boon (DM)",
			mode: "passive",
			grants: baseGrants([pastedBoonGrant()]),
		});

		const feature = state.getFeatures().find(f => f.name === "Ancient Blessing");
		expect(feature).toBeDefined();
		expect(feature.dmGranted).toBe(true);
		expect(feature.origin.sourceType).toBe("json");
		expect(feature.uses).toMatchObject({max: 3, recharge: "long"});

		state.removeCustomAbility(abilityId);
		expect(state.getFeatures().some(f => f.name === "Ancient Blessing")).toBe(false);
	});

	test("legacy optional-feature grants (no grantKind) still work — backward compatible", () => {
		const abilityId = state.addCustomAbility({
			name: "Extra Invocation",
			mode: "passive",
			grants: baseGrants([{name: "Agonizing Blast", source: "PHB", featureType: "EI"}]),
		});

		const feature = state.getFeatures().find(f => f.name === "Agonizing Blast");
		expect(feature).toBeDefined();
		// Legacy path applies as an Optional Feature and is NOT flagged DM-granted.
		expect(feature.dmGranted).toBeFalsy();
		expect(feature.sourceAbilityId).toBe(abilityId);

		state.removeCustomAbility(abilityId);
		expect(state.getFeatures().some(f => f.name === "Agonizing Blast")).toBe(false);
	});

	test("a dataFeature and a legacy grant coexist on one ability without cross-contamination", () => {
		state.addCustomAbility({
			name: "Mixed Grant (DM)",
			mode: "passive",
			grants: baseGrants([
				stoneheartResolveGrant(),
				{name: "Devil's Sight", source: "PHB", featureType: "EI"},
			]),
		});

		const dmFeature = state.getFeatures().find(f => f.name === "Stoneheart Resolve");
		const legacyFeature = state.getFeatures().find(f => f.name === "Devil's Sight");
		expect(dmFeature?.dmGranted).toBe(true);
		expect(legacyFeature).toBeDefined();
		expect(legacyFeature.dmGranted).toBeFalsy();
	});
});
