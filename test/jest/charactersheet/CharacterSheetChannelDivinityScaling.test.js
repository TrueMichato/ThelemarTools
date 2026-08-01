/**
 * CS-BUG-033 — Channel Divinity pool must re-scale with Cleric level.
 *
 * `addFeature` parses the use count out of the feature text at grant-time ("twice")
 * and never re-scales it. `getFeatureCalculations().channelDivinityUses` was already
 * correct (1 / 2 / 3 at levels 2 / 6 / 18), but the player-facing resource stayed at
 * whatever it was when the feature was granted — so an 18th-level Cleric still only
 * had 2 uses on the sheet.
 *
 * These tests deliberately assert against the RESOURCE, not against
 * `getFeatureCalculations()`. The pre-existing Cleric suite only checked the
 * calculation, which is exactly why this bug went unnoticed.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Channel Divinity use scaling (CS-BUG-033)", () => {
	let state;

	const getChannelDivinityResource = () => state.getResources().find(r => r.name === "Channel Divinity");

	const addChannelDivinity = ({current, max}) => state.addFeature({
		name: "Channel Divinity",
		uses: {current, max, recharge: "short"},
	});

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("raises a stale 2-use pool to 3 at level 18", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});

		const resource = getChannelDivinityResource();
		expect(resource.max).toBe(3);
	});

	it("keeps a full pool full when it grows", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});

		expect(getChannelDivinityResource().current).toBe(3);
	});

	it("does not refund spent uses when the pool grows", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 1, max: 2});

		const resource = getChannelDivinityResource();
		expect(resource.max).toBe(3);
		expect(resource.current).toBe(1);
	});

	it("scales a level-2 pool up to 2 uses at level 6", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 6});
		addChannelDivinity({current: 1, max: 1});

		const resource = getChannelDivinityResource();
		expect(resource.max).toBe(2);
		expect(resource.current).toBe(2);
	});

	it("leaves the pool alone below the next threshold", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 17});
		addChannelDivinity({current: 2, max: 2});

		expect(getChannelDivinityResource().max).toBe(2);
	});

	it("never lowers a pool that is already larger than the progression", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 2});
		addChannelDivinity({current: 2, max: 2});

		expect(getChannelDivinityResource().max).toBe(2);
	});

	it("keeps the owning feature's own use pool in step", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});
		state.getResources();

		const feature = state.getFeatures().find(f => f.name === "Channel Divinity");
		expect(feature.uses.max).toBe(3);
		expect(feature.uses.current).toBe(3);
	});

	it("is idempotent across repeated reads", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 1, max: 2});

		state.getResources();
		state.getResources();

		const resource = getChannelDivinityResource();
		expect(resource.max).toBe(3);
		expect(resource.current).toBe(1);
	});

	it("does not invent a pool for a character who has no Channel Divinity", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});

		expect(getChannelDivinityResource()).toBeUndefined();
	});

	it("still reports the correct calculation alongside the resource", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});

		expect(state.getFeatureCalculations().channelDivinityUses).toBe(3);
		expect(getChannelDivinityResource().max).toBe(3);
	});

	it("re-syncs the feature when a later level-up resets it below the resource", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});
		state.getResources();

		// A later level-up re-parses the feature text ("twice") and resets the FEATURE
		// only; the resource is already correct at 3. Rest restoration reads the
		// feature, so leaving it stale restores just 2 of 3 uses (CS-BUG-033).
		const feature = state.getFeatures().find(f => f.name === "Channel Divinity");
		feature.uses.max = 2;
		feature.uses.current = 2;

		state.getResources();

		expect(state.getFeatures().find(f => f.name === "Channel Divinity").uses.max).toBe(3);
	});

	it("restores all three uses on a short rest at level 18", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 18});
		addChannelDivinity({current: 2, max: 2});
		state.getResources();

		const feature = state.getFeatures().find(f => f.name === "Channel Divinity");
		feature.uses.current = 0;
		getChannelDivinityResource().current = 0;

		state.getResources();
		state.onShortRest();

		expect(getChannelDivinityResource().current).toBe(3);
	});

	describe("Paladin", () => {
		it("raises a stale XPHB Paladin pool to 3 at level 11", () => {
			state.addClass({name: "Paladin", source: "XPHB", level: 11});
			addChannelDivinity({current: 2, max: 2});

			expect(getChannelDivinityResource().max).toBe(3);
		});

		it("leaves an XPHB Paladin at 2 uses below level 11", () => {
			state.addClass({name: "Paladin", source: "XPHB", level: 10});
			addChannelDivinity({current: 2, max: 2});

			expect(getChannelDivinityResource().max).toBe(2);
		});

		it("does not inflate a classic PHB Paladin, who gets a single use per rest", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 20});
			addChannelDivinity({current: 1, max: 1});

			expect(getChannelDivinityResource().max).toBe(1);
		});
	});

	describe("multiclass", () => {
		it("takes the larger contribution across classes sharing one pool", () => {
			state.addClass({name: "Paladin", source: "XPHB", level: 11});
			state.addClass({name: "Cleric", source: "PHB", level: 6});
			addChannelDivinity({current: 2, max: 2});

			// Paladin 11 grants 3, Cleric 6 grants 2 — the shared pool takes the larger.
			expect(getChannelDivinityResource().max).toBe(3);
		});

		it("ignores classes that grant no Channel Divinity at all", () => {
			// Fighter 14 + Cleric 6 keeps the character inside the 20-level cap, which
			// `addClass` enforces by refusing the second class outright.
			state.addClass({name: "Fighter", source: "XPHB", level: 14});
			state.addClass({name: "Cleric", source: "PHB", level: 6});
			addChannelDivinity({current: 1, max: 1});

			expect(getChannelDivinityResource().max).toBe(2);
		});
	});
});
