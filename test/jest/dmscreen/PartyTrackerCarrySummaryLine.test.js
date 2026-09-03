/**
 * The party summary line, driven through `PartyTrackerRoot._updateSummary()` itself.
 *
 * The party body total and the shared stash total are two independent sums. A single combined
 * "is anything uncertain" flag got both wrong at once: an exact body total was marked `≥`
 * because the stash happened to hold an unweighed stack, while that stash — the total actually
 * in doubt — printed bare. Each displayed quantity now owns its own partiality.
 */

import "../charactersheet/setup.js";
import {PartyTrackerRoot} from "../../../js/dmscreen/partytracker/dmscreen-partytracker.js";
import {PartyTrackerImporter} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-import.js";
import {PartyTrackerCharacterSerializer} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-serial.js";
import {PartyTrackerCharacter} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-character.js";

/**
 * Build a root with `_updateSummary()`'s collaborators stubbed to just what it reads, so the
 * real method runs rather than a reimplementation of it.
 */
function makeRoot ({members = [], stash = null} = {}) {
	const root = Object.create(PartyTrackerRoot.prototype);
	root._eleSummary = {textContent: ""};
	root._settings = {};
	root._hubCampaignStatus = null;
	root._hubCharacterIds = new Set();
	root._hubPartyInventory = stash;
	root._characters = members.map(summary => {
		// `"unavailable"` models a LINKED character whose sheet has published no current
		// summary — distinct from a manual character, which is derived locally and is known.
		const csum = summary === "unavailable"
			? {state: "unavailable"}
			: (summary ? PartyTrackerImporter.mapCarrySummary(summary) : undefined);
		const data = PartyTrackerCharacterSerializer.deserialize({csum});
		return {data, getSaveableData: () => data};
	});
	root._updateSummary();
	return root._eleSummary.textContent;
}

const EXACT_MEMBER = {carried: 50, capacity: 150, state: "normal"};
const INDETERMINATE_MEMBER = {carried: 50, capacity: 150, state: "unknown", isIndeterminate: true};

describe("party body total and stash total are marked independently", () => {
	it("an unweighed stack in the STASH does not make the party body total a lower bound", () => {
		// The reviewer's vector: every member is exact, so the body total is exact. Only the
		// stash is uncertain, and the stash is where the mark belongs.
		const text = makeRoot({
			members: [EXACT_MEMBER],
			stash: {state: "known", stackCount: 2, knownWeight: 10, unknownStackCount: 1},
		});
		expect(text).toContain("Carry: 50/150");
		expect(text).not.toContain("Carry: ≥50/150");
		expect(text).toContain("Stash: ≥10 lb");
	});

	it("an indeterminate MEMBER marks the body total but not an exact stash", () => {
		const text = makeRoot({
			members: [INDETERMINATE_MEMBER],
			stash: {state: "known", stackCount: 1, knownWeight: 10, unknownStackCount: 0},
		});
		expect(text).toContain("Carry: ≥50/150");
		expect(text).toContain("Stash: 10 lb");
		expect(text).not.toContain("Stash: ≥");
	});

	it("both are marked when both are uncertain", () => {
		const text = makeRoot({
			members: [INDETERMINATE_MEMBER],
			stash: {state: "known", stackCount: 2, knownWeight: 10, unknownStackCount: 1},
		});
		expect(text).toContain("Carry: ≥50/150");
		expect(text).toContain("Stash: ≥10 lb");
	});

	it("neither is marked when everything is exact (the control)", () => {
		const text = makeRoot({
			members: [EXACT_MEMBER],
			stash: {state: "known", stackCount: 1, knownWeight: 10, unknownStackCount: 0},
		});
		expect(text).toContain("Carry: 50/150");
		expect(text).toContain("Stash: 10 lb");
		expect(text).not.toContain("≥");
	});

	it("an unavailable stash shows a dash, never a number", () => {
		const text = makeRoot({members: [EXACT_MEMBER], stash: {state: "unavailable", stackCount: 0, knownWeight: 0, unknownStackCount: 0}});
		expect(text).toContain("Stash: —");
	});

	it("an unavailable MEMBER still makes the body total partial", () => {
		const text = makeRoot({
			members: [EXACT_MEMBER, "unavailable"],
			stash: {state: "known", stackCount: 1, knownWeight: 10, unknownStackCount: 0},
		});
		// The excluded member contributes nothing, so the sum is a lower bound.
		expect(text).toContain("Carry: ≥");
		expect(text).toContain("not synced");
	});
});

describe("the aggregate exposes the two partialities separately", () => {
	it("keeps member and stash uncertainty distinct", async () => {
		const {getCarryProfile, getPartyCarryAggregate} = await import("../../../js/hub/hub-carry-contract.js");
		const exact = getCarryProfile({sourceValue: 10, thresholdSourceValue: 10, capacityOverride: 150, grossWeight: 50});
		const aggregate = getPartyCarryAggregate({members: [{state: "known", profile: exact}], stashWeight: 10, stashUnknownStackCount: 1});

		expect(aggregate.isBodyTotalPartial).toBe(false);
		expect(aggregate.isStashTotalPartial).toBe(true);
		// The combined flag remains for callers asking "is anything here uncertain?".
		expect(aggregate.isTotalPartial).toBe(true);
	});

	it("marks the body total for an indeterminate member with an exact stash", async () => {
		const {getCarryProfile, getPartyCarryAggregate} = await import("../../../js/hub/hub-carry-contract.js");
		const indeterminate = getCarryProfile({sourceValue: 10, thresholdSourceValue: 10, capacityOverride: 150, grossWeight: 50, unknownStackCount: 1});
		const aggregate = getPartyCarryAggregate({members: [{state: "indeterminate", profile: indeterminate}], stashWeight: 10, stashUnknownStackCount: 0});

		expect(aggregate.isBodyTotalPartial).toBe(true);
		expect(aggregate.isStashTotalPartial).toBe(false);
	});
});
