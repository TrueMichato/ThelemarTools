/**
 * The transfer composer's carry line, driven through `_syncCarryDelta()` itself.
 *
 * The earlier defect-7 tests exercised `CharacterSheetState` and asserted the contract's
 * fill-bag-first behaviour. That is the layer BENEATH the bug: the composer had its own
 * arithmetic, so those tests passed while the rendered line was wrong in two ways at once.
 * Everything here therefore calls the composer and reads the text a player would see.
 *
 * Three different systems own the three endpoints, and each needs its own weight:
 *   - the acting character projects material weight and may absorb gear into a container;
 *   - the party stash is a plain document whose authoritative summary sums RAW stored weight;
 *   - a recipient is another sheet entirely, and nothing here is authoritative about it.
 */

import "./setup.js";
import {CharacterSheetPartyInventory} from "../../../js/charactersheet/charactersheet-party-inventory.js";
import {getCarryProfile} from "../../../js/hub/hub-carry-contract.js";
import {getPartyInventoryRecipients} from "../../../js/charactersheet/charactersheet-party-inventory.js";

/** A composer stub exposing the one element `_syncCarryDelta` writes into. */
function makeComposer () {
	const node = {textContent: "", classList: {toggle: () => {}}};
	return {querySelector: selector => (selector.includes("carry-delta") ? node : null), node};
}

/**
 * @param {object} params
 * @param {number} params.raw Stored weight on the item.
 * @param {?number} params.projected Material-projected weight, or null for "no projection".
 */
function makeUi ({
	raw = 10,
	projected = null,
	quantity = 1,
	draftKind = "character",
	destinationKind = "party_inventory",
	recipients = [],
	recipientId = null,
	stashInventory = [],
	characterProfile = getCarryProfile({sourceValue: 10, thresholdSourceValue: 10, grossWeight: 0}),
} = {}) {
	const entry = {id: "e1", quantity: 9, item: {name: "Ingots", weight: raw}};
	const ui = new CharacterSheetPartyInventory({
		campaignId: "campaign-1",
		api: {},
		repository: {pReconcileAuthoritativeCharacter: () => {}},
		fnGetCharacterData: () => ({inventory: [entry]}),
		fnAdoptCharacterData: () => {},
		fnSaveCharacter: () => {},
		fnIsCurrentCharacter: () => true,
		fnGetCarryProfile: () => characterProfile,
		fnProjectItemWeight: item => (projected == null ? item?.weight : projected),
	});
	ui._partyInventory = {inventory: stashInventory, currency: {}};
	ui._recipients = recipients;
	ui._draft = {
		kind: draftKind,
		destinationKind,
		entryId: draftKind === "party_inventory" ? "s1" : "e1",
		quantity,
		recipientId,
		blockers: [],
		maxQuantity: 9,
		transfer: null,
	};
	return ui;
}

function render (ui) {
	const composer = makeComposer();
	ui._syncCarryDelta(composer);
	return composer.node.textContent;
}

describe("stash arithmetic uses RAW stored weight, matching its authoritative summary", () => {
	// The composer previously reused the acting sheet's PROJECTED weight for the stash, so a
	// projected-5 / raw-10 item previewed "Stash: 0 → 5 lb" while the refresh that landed a
	// moment later reported 10 — the preview contradicted the very next screen.
	it("character → stash adds the raw weight, not the projected one", () => {
		const text = render(makeUi({raw: 10, projected: 5, destinationKind: "party_inventory"}));
		expect(text).toContain("Stash: 0 → 10 lb");
		expect(text).not.toContain("Stash: 0 → 5 lb");
	});

	it("stash → character subtracts the raw weight", () => {
		const ui = makeUi({
			raw: 10,
			projected: 5,
			draftKind: "party_inventory",
			destinationKind: "character",
			stashInventory: [{id: "s1", quantity: 3, item: {name: "Ingots", weight: 10}}],
		});
		expect(render(ui)).toContain("Stash: 30 → 20 lb");
	});

	it("still applies the PROJECTED weight to the acting character", () => {
		// Both weights are in play at once and must not be swapped: the character feels 5 lb.
		const text = render(makeUi({raw: 10, projected: 5, destinationKind: "party_inventory", characterProfile: getCarryProfile({sourceValue: 10, thresholdSourceValue: 10, grossWeight: 40})}));
		expect(text).toContain("You: 40 → 35 lb");
	});

	it("says so plainly when the stack has no recorded weight", () => {
		const text = render(makeUi({raw: NaN, projected: null}));
		expect(text).toMatch(/no recorded weight/);
	});
});

describe("the acting character's own line honours the container split", () => {
	it("gear absorbed by a bag does not raise the body load", () => {
		const withBag = getCarryProfile({
			sourceValue: 10,
			thresholdSourceValue: 10,
			externalCapacity: 500,
			grossWeight: 100,
			fillableWeight: 100,
		});
		const text = render(makeUi({raw: 20, draftKind: "party_inventory", destinationKind: "character", stashInventory: [{id: "s1", quantity: 1, item: {weight: 20}}], characterProfile: withBag}));
		// Body load is unchanged because the arriving gear rides in the container.
		expect(text).toContain("You: 0 → 0 lb");
	});
});

describe("a recipient's consequence is never fabricated", () => {
	const recipient = {id: "r1", label: "Kael", summary: "Fighter 3", carry: {carried: 10, capacity: 15, state: "normal"}};

	it("shows their current carry but claims no after-value or capacity verdict", () => {
		// The reviewer's vector: target at 10/15 receiving 20 lb, but with 500 lb of spare bag
		// capacity their body load genuinely stays at 10. The old line asserted
		// "10 → 30 · over capacity" — a confident fabrication about another character's sheet.
		const text = render(makeUi({
			raw: 20, destinationKind: "character", recipientId: "r1", recipients: [recipient],
		}));

		expect(text).toContain("Kael: currently 10 lb of 15");
		expect(text).toMatch(/impact not shown/);
		expect(text).not.toContain("10 → 30");
		expect(text).not.toMatch(/over capacity for Kael/);
	});

	it("does not leak anything about a recipient who withheld their carry", () => {
		const text = render(makeUi({
			raw: 20,
			destinationKind: "character",
			recipientId: "r2",
			recipients: [{id: "r2", label: "Silent", summary: "Rogue 3", carry: null}],
		}));
		expect(text).toContain("Silent: carry not shared");
		// No number of any kind may be attributed to them.
		expect(text).not.toMatch(/Silent: currently/);
	});

	it("differing material projection never reaches the recipient line", () => {
		const text = render(makeUi({
			raw: 10, projected: 5, destinationKind: "character", recipientId: "r1", recipients: [recipient],
		}));
		expect(text).toContain("Kael: currently 10 lb of 15");
		expect(text).not.toMatch(/Kael: 10 → /);
	});
});

describe("a lower bound is never rendered as an exact weight", () => {
	// The same invariant, at the last two places it leaks. A load containing a stack of
	// unknown weight is *at least* the figure we can add up, and printing it bare states a
	// precision we do not have — most damagingly when the lower bound already exceeds
	// capacity, where an unmarked number reads as a settled, exact reading.
	const indeterminateActor = getCarryProfile({
		sourceValue: 10,
		thresholdSourceValue: 10,
		capacityOverride: 150,
		grossWeight: 200,
		unknownStackCount: 2,
	});

	it("marks BOTH the actor's before and after values", () => {
		const text = render(makeUi({raw: 5, destinationKind: "party_inventory", characterProfile: indeterminateActor}));
		expect(text).toContain("You: ≥200 → ≥195 lb of 150");
		expect(text).not.toContain("You: 200 → 195");
	});

	it("keeps the truthful Over capacity verdict rather than softening it", () => {
		// The known part already exceeds capacity, and more weight cannot bring it back under,
		// so the tier IS settled. Downgrading it to "unknown" would make an overloaded
		// character read as merely unmeasured.
		expect(indeterminateActor.status).toBe("over_capacity");
		expect(render(makeUi({raw: 5, destinationKind: "party_inventory", characterProfile: indeterminateActor}))).toContain("Over capacity");
	});

	it("leaves an exact actor unmarked", () => {
		const exact = getCarryProfile({sourceValue: 10, thresholdSourceValue: 10, capacityOverride: 150, grossWeight: 200});
		const text = render(makeUi({raw: 5, destinationKind: "party_inventory", characterProfile: exact}));
		expect(text).toContain("You: 200 → 195 lb of 150");
		expect(text).not.toContain("≥");
	});

	it("marks a shared recipient's current weight, including over-capacity + unknown", () => {
		// `state` alone cannot reveal this case: it is a legitimate `over_capacity`.
		const text = render(makeUi({
			raw: 5,
			destinationKind: "character",
			recipientId: "r1",
			recipients: [{id: "r1", label: "Kael", summary: "F 3", carry: {carried: 120, capacity: 150, state: "over_capacity", isIndeterminate: true}}],
		}));
		expect(text).toContain("Kael: currently ≥120 lb of 150");
		expect(text).not.toContain("currently 120 lb");
	});

	it("leaves an exact recipient unmarked", () => {
		const text = render(makeUi({
			raw: 5,
			destinationKind: "character",
			recipientId: "r1",
			recipients: [{id: "r1", label: "Kael", summary: "F 3", carry: {carried: 120, capacity: 150, state: "encumbered", isIndeterminate: false}}],
		}));
		expect(text).toContain("Kael: currently 120 lb of 150");
	});

	it("preserves the flag end-to-end from the projection into the recipient list", () => {
		const projections = [{kind: "peer_profile", id: "r1", data: {identity: {name: "Kael"}, classes: [], carrySummary: {carried: 120, capacity: 150, state: "over_capacity", isIndeterminate: true}}}];
		const [recipient] = getPartyInventoryRecipients({projections, roster: [{characterId: "r1", targetRef: "r1"}], currentCharacterId: "me"});
		expect(recipient.carry.isIndeterminate).toBe(true);
	});
});
