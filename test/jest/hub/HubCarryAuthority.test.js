/**
 * The carry authority boundary: when a materialised carry summary may be trusted, and —
 * more importantly — every way in which it must not be.
 *
 * A summary is authoritative because the Character Sheet computed it from state only the
 * sheet can see. That makes it valuable and dangerous in equal measure: the moment it stops
 * describing the document it travels with, it becomes a confident wrong answer. These tests
 * pin the fail-closed behaviour that keeps "we cannot verify this" distinct from "this
 * character is unencumbered".
 */

import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {
	CARRY_SCHEMA_VERSION,
	computeCarrySettingsDigest,
	createCampaignCarryBasis,
	createDetachedCarryBasis,
	hasFreshCarryWrite,
	isCarryBasisCurrent,
	resolveCarryAuthority,
	stripCarryAuthority,
} from "../../../js/hub/hub-carry-authority.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function mkChar ({str = 16, thelemar = false} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setSetting("thelemar_carryWeight", thelemar);
	state.setAbilityBase("str", str);
	return state;
}

/** The basis a sheet in this context would stamp — i.e. the matching expectation. */
function getExpectedBasis (state) {
	return state.getCarryAuthorityBasis();
}

describe("materialisation and round-trip", () => {
	it("toJson() carries a versioned summary that resolves back out", () => {
		const state = mkChar();
		state.addItem({name: "Anvil", weight: 100});
		const json = state.toJson();

		expect(json.carry.schemaVersion).toBe(CARRY_SCHEMA_VERSION);
		const resolved = resolveCarryAuthority({data: json, expectedBasis: getExpectedBasis(state)});
		expect(resolved).not.toBeNull();
		expect(resolved.bodyCapacity).toBe(240);
		expect(resolved.bodyLoad).toBe(100);
		expect(resolved.status).toBe("encumbered");
	});

	it("emits no raw item data or formula factors a peer could mine", () => {
		const state = mkChar();
		state.addItem({name: "Secret Plans", weight: 1});
		const keys = Object.keys(state.toJson().carry);
		expect(keys).not.toContain("inventory");
		expect(keys).not.toContain("sizeMultiplier");
		expect(keys).not.toContain("carryMultiplier");
		expect(keys).not.toContain("flatBonus");
	});
});

describe("stale-metadata stripping", () => {
	// The whole point of stripping on load: a derived value must never outlive the state it
	// was derived from, nor be mistaken for stored input the sheet would defer to.
	it("loadFromJson() drops the block so it can never become an input", () => {
		const state = mkChar();
		state.addItem({name: "Anvil", weight: 100});

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored._data.carry).toBeUndefined();
	});

	it("a load-mutate-reserialize cycle publishes the NEW truth, never the loaded one", () => {
		const state = mkChar();
		state.addItem({name: "Anvil", weight: 100});
		const staleJson = state.toJson();
		expect(staleJson.carry.bodyLoad).toBe(100);

		const restored = new CharacterSheetState();
		restored.loadFromJson(staleJson);
		restored.addItem({name: "Second Anvil", weight: 100});

		const freshJson = restored.toJson();
		expect(freshJson.carry.bodyLoad).toBe(200);
		expect(freshJson.carry.status).toBe("heavily_encumbered");
	});
});

describe("basis variants", () => {
	it("a character in no campaign stamps an explicit detached basis, not a bag of nulls", () => {
		const basis = mkChar().toJson().carry.basis;
		expect(basis.kind).toBe("detached");
		expect(basis).not.toHaveProperty("rulesVersionId");
	});

	it("a campaign character stamps the observed rules version and brew hash", () => {
		const state = mkChar();
		state.setCarryAuthorityContext({rulesVersionId: "rules-1", brewBundleHash: "brew-abc"});
		const basis = state.toJson().carry.basis;
		expect(basis).toMatchObject({kind: "campaign", rulesVersionId: "rules-1", brewBundleHash: "brew-abc"});
	});

	it("a campaign with no active rules version records null as an OBSERVATION", () => {
		// Null here means "there was no active rules version when I saved", which is a real
		// state — not a placeholder. The next test proves it still fails closed later.
		const state = mkChar();
		state.setCarryAuthorityContext({rulesVersionId: null, brewBundleHash: null});
		const json = state.toJson();
		expect(json.carry.basis.kind).toBe("campaign");
		expect(resolveCarryAuthority({data: json, expectedBasis: getExpectedBasis(state)})).not.toBeNull();
	});

	it("...and stops being trusted the moment a DM activates a rules version", () => {
		const state = mkChar();
		state.setCarryAuthorityContext({rulesVersionId: null, brewBundleHash: null});
		const json = state.toJson();

		const afterActivation = createCampaignCarryBasis({
			rulesVersionId: "rules-1",
			brewBundleHash: null,
			settingsDigest: json.carry.basis.settingsDigest,
		});
		expect(resolveCarryAuthority({data: json, expectedBasis: afterActivation})).toBeNull();
	});

	it("detached and campaign bases never satisfy one another", () => {
		const digest = computeCarrySettingsDigest({});
		expect(isCarryBasisCurrent(createDetachedCarryBasis({settingsDigest: digest}), createCampaignCarryBasis({settingsDigest: digest}))).toBe(false);
		expect(isCarryBasisCurrent(createCampaignCarryBasis({settingsDigest: digest}), createDetachedCarryBasis({settingsDigest: digest}))).toBe(false);
	});
});

describe("basis invalidation", () => {
	function getCampaignJson (mutate = () => {}) {
		const state = mkChar();
		state.setCarryAuthorityContext({rulesVersionId: "rules-1", brewBundleHash: "brew-abc"});
		mutate(state);
		return {json: state.toJson(), expected: getExpectedBasis(state)};
	}

	it("accepts a matching basis", () => {
		const {json, expected} = getCampaignJson();
		expect(resolveCarryAuthority({data: json, expectedBasis: expected})).not.toBeNull();
	});

	it("rejects a rotated rules version", () => {
		const {json, expected} = getCampaignJson();
		expect(resolveCarryAuthority({data: json, expectedBasis: {...expected, rulesVersionId: "rules-2"}})).toBeNull();
	});

	it("rejects a rotated brew bundle, which can change material-projected weights", () => {
		const {json, expected} = getCampaignJson();
		expect(resolveCarryAuthority({data: json, expectedBasis: {...expected, brewBundleHash: "brew-xyz"}})).toBeNull();
	});

	it("rejects a changed carry setting even though the document never moved", () => {
		const {json} = getCampaignJson();
		const rotated = createCampaignCarryBasis({
			rulesVersionId: "rules-1",
			brewBundleHash: "brew-abc",
			settingsDigest: computeCarrySettingsDigest({thelemar_carryWeight: false}),
		});
		expect(resolveCarryAuthority({data: json, expectedBasis: rotated})).toBeNull();
	});

	it("fails closed when the caller cannot supply an expected basis at all", () => {
		const {json} = getCampaignJson();
		expect(resolveCarryAuthority({data: json})).toBeNull();
		expect(resolveCarryAuthority({data: json, expectedBasis: null})).toBeNull();
	});
});

describe("settings digest", () => {
	it("is stable regardless of key insertion order", () => {
		const a = computeCarrySettingsDigest({enableTgtt: true, thelemar_carryWeight: false});
		const b = computeCarrySettingsDigest({thelemar_carryWeight: false, enableTgtt: true});
		expect(a).toBe(b);
	});

	it("distinguishes an absent setting from an explicitly false one", () => {
		expect(computeCarrySettingsDigest({})).not.toBe(computeCarrySettingsDigest({enableTgtt: false}));
	});

	it("ignores settings that cannot affect carry, so unrelated edits do not churn it", () => {
		const a = computeCarrySettingsDigest({thelemar_carryWeight: true});
		const b = computeCarrySettingsDigest({thelemar_carryWeight: true, speedEmojiLabels: false});
		expect(a).toBe(b);
	});
});

describe("malformed and legacy documents fail closed", () => {
	const expected = createDetachedCarryBasis({settingsDigest: "x"});
	const valid = () => ({
		schemaVersion: CARRY_SCHEMA_VERSION,
		basis: createDetachedCarryBasis({settingsDigest: "x"}),
		bodyCapacity: 240,
		bodyLoad: 100,
		status: "encumbered",
	});

	it("a legacy document with no carry block yields null", () => {
		expect(resolveCarryAuthority({data: {inventory: []}, expectedBasis: expected})).toBeNull();
	});

	it.each([
		["a future schema version", {schemaVersion: 2}],
		["an unknown key, which may carry unvalidated meaning", {somethingNew: 1}],
		["a NaN capacity", {bodyCapacity: NaN}],
		["a negative load", {bodyLoad: -1}],
		["an absurd capacity", {bodyCapacity: 1e12}],
		["a non-numeric capacity", {bodyCapacity: "240"}],
		["a missing status", {status: undefined}],
		["a malformed basis", {basis: {kind: "campaign"}}],
	])("rejects %s", (_label, patch) => {
		const carry = {...valid(), ...patch};
		if (patch.status === undefined && "status" in patch) delete carry.status;
		expect(resolveCarryAuthority({data: {carry}, expectedBasis: expected})).toBeNull();
	});

	it("accepts the untouched valid document, proving the rejections are specific", () => {
		expect(resolveCarryAuthority({data: {carry: valid()}, expectedBasis: expected})).not.toBeNull();
	});
});

describe("stripCarryAuthority", () => {
	it("removes the block and leaves everything else alone", () => {
		const data = {carry: {schemaVersion: 1}, inventory: [{id: "a"}], hp: {max: 10}};
		stripCarryAuthority(data);
		expect(data.carry).toBeUndefined();
		expect(data.inventory).toEqual([{id: "a"}]);
		expect(data.hp).toEqual({max: 10});
	});

	it("tolerates a document that never had one", () => {
		expect(() => stripCarryAuthority({})).not.toThrow();
		expect(() => stripCarryAuthority(null)).not.toThrow();
	});
});

describe("hasFreshCarryWrite — the mixed-version signal", () => {
	// The current sheet emits a /carry write on every owner save whose document otherwise
	// changes. Its presence is the ONLY reliable signal that the writer understood carry
	// authority: enumerating "carry-relevant paths" could never be complete, because passive
	// Might alone depends on skills, expertise, class levels, proficiency bonus, named
	// modifiers, feature choices and item-derived modifiers.
	it("recognises a fresh add or replace", () => {
		const value = {schemaVersion: CARRY_SCHEMA_VERSION};
		expect(hasFreshCarryWrite([{op: "replace", path: "/carry", value}])).toBe(true);
		expect(hasFreshCarryWrite([{op: "add", path: "/carry", value}])).toBe(true);
	});

	it.each([
		["an inventory-only patch from an old client", [{op: "add", path: "/inventory/0", value: {}}]],
		["a removal rather than a write", [{op: "remove", path: "/carry"}]],
		["a nested write that does not replace the whole block", [{op: "replace", path: "/carry/bodyLoad", value: 5}]],
		["a write of the wrong schema version", [{op: "replace", path: "/carry", value: {schemaVersion: 99}}]],
		["a non-object value", [{op: "replace", path: "/carry", value: 12}]],
		["an empty patch set", []],
		["a non-array", null],
	])("does not accept %s", (_label, patches) => {
		expect(hasFreshCarryWrite(patches)).toBe(false);
	});
});
