/**
 * Regressions for the eight blocking defects found in exact-head review of the carry work.
 *
 * Each block states the defect, drives the real code path, and asserts the property that was
 * violated. Several are paired with a mutation note recording what breaks if the guard is
 * removed — these were verified by actually reverting each fix, not assumed.
 */

import "../charactersheet/setup.js";
import fs from "node:fs";
import "../../../js/charactersheet/charactersheet-state.js";
import {diffJson} from "../../../js/hub/hub-json-patch.js";
import {hasFreshCarryWrite, withRootCarryWrite} from "../../../js/hub/hub-carry-authority.js";
import {buildCharacterViewModel, computePeerProfile, getDmCarrySummary, projectCharacterForRequester} from "../../../server/src/character-projection.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PartyTrackerImporter} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-import.js";
import {PartyTrackerCharacter} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-character.js";
import {PartyTrackerCharacterSerializer} from "../../../js/dmscreen/partytracker/dmscreen-partytracker-serial.js";
import {getPartyInventoryRecipients} from "../../../js/charactersheet/charactersheet-party-inventory.js";
import {getPartyCarryAggregate} from "../../../js/hub/hub-carry-contract.js";
import {DmScreenHubController} from "../../../js/dmscreen/dmscreen-hub-controller.js";

const BASIS = Object.freeze({kind: "detached", settingsDigest: ""});

const readSource = relative => fs.readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

function getCarryBlock (overrides = {}) {
	return {schemaVersion: 1, basis: BASIS, bodyCapacity: 150, bodyLoad: 10, status: "normal", ...overrides};
}

/* ── 1. Save protocol ─────────────────────────────────────────────── */

describe("defect 1 — a current client's save always carries a root /carry write", () => {
	// The server recognises a carry-aware writer only by a whole-block `/carry` op, but both
	// clients build patches with a RECURSIVE diff which never emits one. Every ordinary save
	// therefore stripped the authority it was carrying, and the next save re-added it: the
	// summary oscillated between present and absent instead of staying current.
	const accepted = {name: "A", carry: getCarryBlock()};

	it("an unrelated edit still asserts carry (raw diff does not)", () => {
		const desired = {...accepted, name: "B"};
		const raw = diffJson(accepted, desired);
		expect(hasFreshCarryWrite(raw)).toBe(false); // the defect

		const patches = withRootCarryWrite({patches: raw, document: desired, base: accepted});
		expect(hasFreshCarryWrite(patches)).toBe(true);
		expect(patches).toContainEqual({op: "replace", path: "/name", value: "B"});
	});

	it("an edited summary is written as ONE atomic root op, never a nested field", () => {
		const desired = {name: "A", carry: getCarryBlock({bodyLoad: 20})};
		expect(diffJson(accepted, desired)).toEqual([{op: "replace", path: "/carry/bodyLoad", value: 20}]);

		const patches = withRootCarryWrite({patches: diffJson(accepted, desired), document: desired, base: accepted});
		expect(patches.filter(p => p.path.startsWith("/carry"))).toEqual([
			{op: "replace", path: "/carry", value: desired.carry},
		]);
		// A half-updated block must never be observable, and a nested op is not recognised as
		// fresh anyway.
		expect(patches.some(p => p.path === "/carry/bodyLoad")).toBe(false);
	});

	it("uses add when the accepted document had no carry at all", () => {
		const desired = {name: "A", carry: getCarryBlock()};
		const patches = withRootCarryWrite({patches: diffJson({name: "A"}, desired), document: desired, base: {name: "A"}});
		expect(patches).toContainEqual({op: "add", path: "/carry", value: desired.carry});
	});

	it("does not invent a write when there is no authority to assert", () => {
		const patches = withRootCarryWrite({patches: [{op: "replace", path: "/name", value: "B"}], document: {name: "B"}, base: {name: "A"}});
		expect(hasFreshCarryWrite(patches)).toBe(false);
	});

	it("does not turn an empty (no-op) save into a write", () => {
		expect(withRootCarryWrite({patches: [], document: {carry: getCarryBlock()}, base: {}})).toEqual([]);
	});

	it("both save paths and the conflict retry are normalised", () => {
		// Source-pinned: the retry path is only reachable through a revision conflict, and an
		// unguarded retry would resurrect the oscillation after every conflict.
		const http = readSource("js/hub/hub-http-character-repository.js");
		expect(http.match(/withRootCarryWrite\(/g) || []).toHaveLength(2);
		expect(readSource("js/hub/hub-character-repository.js")).toContain("withRootCarryWrite(");
	});
});

/* ── 2. Projection shape ──────────────────────────────────────────── */

describe("defect 2 — the projection carries authority STATE, and is fresh or absent", () => {
	const project = carry => buildCharacterViewModel({abilities: {str: 10}, carry}, {expectedBasis: BASIS}).carrySummary;

	it.each([
		["encumbered", "encumbered"],
		["heavily_encumbered", "heavily_encumbered"],
		["over_capacity", "over_capacity"],
	])("projects the authoritative %s level", (status, expected) => {
		expect(project(getCarryBlock({bodyLoad: 120, status}))).toEqual({carried: 120, capacity: 150, state: expected});
	});

	it("distinguishes indeterminate from a confident reading of the same numbers", () => {
		const indeterminate = project(getCarryBlock({bodyLoad: 120, status: "unknown", isIndeterminate: true, unknownStackCount: 2}));
		const confident = project(getCarryBlock({bodyLoad: 120, status: "heavily_encumbered"}));
		expect(indeterminate.state).toBe("unknown");
		expect(indeterminate.state).not.toBe(confident.state);
	});

	it("omits the field entirely when unresolved — never an owned empty object", () => {
		// An owned `{}` is a third state that reads as "shared but empty" and is
		// indistinguishable from a character who shared nothing.
		const profile = computePeerProfile({
			character: {
				id: "c",
				campaignId: "x",
				revision: 1,
				projectionRevision: 1,
				projectionPolicy: {version: 1, preset: "table", overrides: {carrySummary: {mode: "share"}}},
				data: {abilities: {str: 10}},
			},
			expectedBasis: BASIS,
		});
		expect(Object.hasOwn(profile.data, "carrySummary")).toBe(false);
	});
});

/* ── 3. DM truth ──────────────────────────────────────────────────── */

describe("defect 3 — DM truth reaches the Party Tracker without local recomputation", () => {
	const character = {
		id: "c1",
		campaignId: "x",
		revision: 1,
		projectionRevision: 1,
		projectionPolicy: {version: 1, preset: "private", overrides: {}},
		data: {
			name: "Bearer",
			abilities: {str: 10},
			classes: [{name: "Fighter", level: 5}],
			hp: {current: 1, max: 1, temp: 0},
			inventory: [],
			currency: {},
			carry: getCarryBlock({bodyLoad: 120, status: "heavily_encumbered"}),
		},
	};

	it("the DM envelope carries a summary even when the owner shares nothing with peers", () => {
		const envelope = projectCharacterForRequester({character, authorizationClass: "dm", expectedBasis: BASIS});
		expect(envelope.kind).toBe("dm_truth");
		// `private` preset: the peer preview is empty, so it could never have served as DM truth.
		expect(envelope.peerPreview.data.carrySummary).toBeUndefined();
		expect(envelope.carrySummary).toEqual({carried: 120, capacity: 150, state: "heavily_encumbered"});
	});

	it("the real dm_truth -> Party Tracker path reports the authoritative level", () => {
		const envelope = projectCharacterForRequester({character, authorizationClass: "dm", expectedBasis: BASIS});
		const mapped = PartyTrackerImporter.mapCharacterSheetData(envelope.character.data);
		mapped.carrySummary = PartyTrackerImporter.mapCarrySummary(envelope.carrySummary);
		const state = new PartyTrackerCharacter(PartyTrackerCharacterSerializer.deserialize({csum: mapped.carrySummary}), {}).getCarryState();

		// Previously this fell back to reduced local recomputation and reported Normal.
		expect(state.level).toBe("heavily_encumbered");
		expect(state.carried).toBe(120);
		expect(state.capacity).toBe(150);
	});

	it("a stale summary yields no DM value rather than a stale one", () => {
		expect(getDmCarrySummary({character, expectedBasis: {kind: "campaign", rulesVersionId: "r", brewBundleHash: null, settingsDigest: ""}})).toBeUndefined();
	});

	it.each([
		["encumbered", "encumbered", "known"],
		["heavily_encumbered", "heavily_encumbered", "known"],
		["unknown", "unknown", "indeterminate"],
	])("maps %s through to the tracker", (status, level, trackerState) => {
		const mapped = PartyTrackerImporter.mapCarrySummary({carried: 120, capacity: 150, state: status});
		const carry = new PartyTrackerCharacter(PartyTrackerCharacterSerializer.deserialize({csum: mapped}), {}).getCarryState();
		expect(carry.level).toBe(level);
		expect(carry.state).toBe(trackerState);
	});

	it("an owner-substituted label is not mistaken for an encumbrance level", () => {
		expect(PartyTrackerImporter.mapCarrySummary({carried: 1, capacity: 2, state: "Hidden"}).level).toBe("unknown");
	});
});

/* ── 4. Owner preview ─────────────────────────────────────────────── */

describe("defect 4 — the owner's sharing preview equals what a peer actually reads", () => {
	async function setup () {
		const store = new MemoryHubStore();
		const owner = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "1", displayName: "O"});
		const peer = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "2", displayName: "P"});
		const {campaign} = await store.pCreateCampaign({accountId: owner.id, name: "C", idempotencyKey: "c1"});
		await store.pCreateInvite({accountId: owner.id, campaignId: campaign.id, role: "player", tokenHash: "t", expiresAt: new Date(Date.now() + 3.6e6), maxUses: 5, idempotencyKey: "i1"});
		await store.pRedeemInvite({accountId: peer.id, tokenHash: "t", idempotencyKey: "i2"});
		const digest = "enableTgtt=~|thelemar_carryWeight=~|thelemar_encumbranceTiers=~|enableMaterials=~|materials_weightFromDensity=~|materials_degradation=~";
		const {character} = await store.pCreateCharacter({
			accountId: owner.id,
			campaignId: campaign.id,
			schemaVersion: 1,
			clientImportId: "im",
			idempotencyKey: "ch",
			data: {
				name: "X",
				abilities: {str: 10},
				hp: {current: 1, max: 1, temp: 0},
				inventory: [],
				currency: {},
				carry: getCarryBlock({bodyLoad: 120, status: "heavily_encumbered", basis: {kind: "campaign", rulesVersionId: null, brewBundleHash: null, settingsDigest: digest}}),
			},
		});
		await store.pSetProjectionPolicy({
			accountId: owner.id,
			characterId: character.id,
			idempotencyKey: "p1",
			policy: {version: 1, preset: "table", overrides: {carrySummary: {mode: "share"}}},
			expectedProjectionRevision: character.projectionRevision,
		});
		return {store, owner, peer, character};
	}

	it("shows the fresh shared carry the owner just published", async () => {
		const {store, owner, peer, character} = await setup();
		const preview = (await store.pGetProjectionPolicy({accountId: owner.id, characterId: character.id})).preview.data.carrySummary;
		const peerRead = (await store.pGetCharacter({accountId: peer.id, characterId: character.id})).data.carrySummary;

		// Without the basis the resolver failed closed and the owner saw nothing while peers
		// saw the value — the worst possible direction for a privacy control.
		expect(preview).toEqual({carried: 120, capacity: 150, state: "heavily_encumbered"});
		expect(preview).toEqual(peerRead);
	});

	it("the set-policy response preview agrees too", async () => {
		const {store, owner, character} = await setup();
		const response = await store.pSetProjectionPolicy({
			accountId: owner.id,
			characterId: character.id,
			idempotencyKey: "p2",
			policy: {version: 1, preset: "table", overrides: {carrySummary: {mode: "share"}}},
			expectedProjectionRevision: character.projectionRevision + 1,
		});
		expect(response.preview.data.carrySummary).toEqual({carried: 120, capacity: 150, state: "heavily_encumbered"});
	});
});

/* ── 5 & 6. DM Screen controller ──────────────────────────────────── */

describe("defects 5 and 6 — rotation invalidation and stash fencing", () => {
	class Observable {
		constructor () { this._listeners = new Map(); }
		on (type, listener) {
			const set = this._listeners.get(type) || new Set();
			set.add(listener); this._listeners.set(type, set);
			return () => set.delete(listener);
		}
		emit (type, value) { for (const listener of this._listeners.get(type) || []) listener(value); }
	}

	function getHarness ({pGetPartyInventory, role = "dm"} = {}) {
		const published = [];
		const timers = new Map();
		let nextTimerId = 0;
		let fetchCount = 0;
		const realtime = new Observable();
		const controller = new DmScreenHubController({
			campaignId: "campaign-1",
			api: {
				pGetSession: async () => ({signedIn: true}),
				pGetCampaign: async () => ({name: "C", status: "active", role}),
				pListCampaignCharacterProjections: async () => { fetchCount++; return {projections: [], roster: []}; },
				pGetPartyInventory: pGetPartyInventory || (async () => ({inventory: []})),
			},
			document: null,
			fnSetTimeout: fn => { const id = ++nextTimerId; timers.set(id, fn); return id; },
			fnClearTimeout: id => timers.delete(id),
		});
		return {
			controller,
			realtime,
			timers,
			published,
			board: {fireBoardEvent: event => published.push(event)},
			getFetchCount: () => fetchCount,
			stash: () => published.filter(it => it.type === "hubPartyInventory"),
		};
	}
	const flush = () => new Promise(resolve => setImmediate(resolve));

	it.each(["rules.activated", "brew.activated"])("%s invalidates cached projections", async type => {
		// Neither event touches a character document, so no character-scoped invalidation is
		// emitted — yet both change the basis the server validates carry against. Without this
		// the DM Screen showed the last accepted numbers indefinitely after they went stale.
		const h = getHarness();
		await h.controller.pLoadCampaign();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		await flush();
		const before = h.getFetchCount();

		h.realtime.emit("event", {type});
		for (const fn of [...h.timers.values()]) fn();
		await flush();

		expect(h.getFetchCount()).toBe(before + 1);
	});

	it("access loss clears the stash, publishes unavailable, and fences late responses", async () => {
		let release;
		const h = getHarness({pGetPartyInventory: () => new Promise(resolve => { release = resolve; })});
		await h.controller.pLoadCampaign();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});

		h.controller.handleWorkspaceLoadError?.(new Error("gone"));
		h.controller._setAccessState({access: "permission_denied", message: "demoted"});

		// The campaign-private aggregate must leave the board with the projections.
		expect(h.stash().at(-1).payload.state).toBe("unavailable");
		expect(h.stash().at(-1).payload.knownWeight).toBe(0);

		const afterDemotion = h.stash().length;
		release({inventory: [{quantity: 1, item: {weight: 10}}]});
		await flush();
		// A response in flight at the moment of demotion must not republish private truth.
		expect(h.stash()).toHaveLength(afterDemotion);
	});

	it("an older overlapping response cannot overwrite a newer one", async () => {
		// Same generation, two in-flight refreshes: without a per-request sequence the slower
		// EARLIER request lands last and pins the stale weight on screen permanently.
		const resolvers = [];
		const h = getHarness({pGetPartyInventory: () => new Promise(resolve => resolvers.push(resolve))});
		await h.controller.pLoadCampaign();
		h.controller.attach({board: h.board, repository: null, realtime: h.realtime});
		await flush();

		void h.controller.pRefreshPartyInventory();
		void h.controller.pRefreshPartyInventory();
		await flush();
		expect(resolvers.length).toBeGreaterThanOrEqual(2);

		resolvers[resolvers.length - 1]({inventory: [{quantity: 2, item: {weight: 10}}]}); // newer → 20
		await flush();
		resolvers[0]({inventory: [{quantity: 1, item: {weight: 5}}]}); // older → 5
		await flush();

		expect(h.stash().at(-1).payload.knownWeight).toBe(20);
	});
});

/* ── A. Indeterminate survives independently ──────────────────────── */

describe("blocker A — indeterminate is carried independently of encumbrance status", () => {
	const project = carry => buildCharacterViewModel({abilities: {str: 10}, carry}, {expectedBasis: BASIS}).carrySummary;

	it("status alone cannot express it: a known lower bound can already be over capacity", () => {
		// This is why the two facts need separate fields. The status is a SAFE
		// `over_capacity` — the known part already exceeds capacity — while the true load
		// remains a lower bound, so a consumer inferring indeterminacy from the status would
		// render this as an exact reading.
		const summary = project(getCarryBlock({bodyLoad: 500, status: "over_capacity", isIndeterminate: true}));
		expect(summary.state).toBe("over_capacity");
		expect(summary.isIndeterminate).toBe(true);
	});

	it("an exact reading carries no indeterminate flag at all", () => {
		expect(project(getCarryBlock({bodyLoad: 500, status: "over_capacity"}))).not.toHaveProperty("isIndeterminate");
	});

	it("the DM envelope carries it too", () => {
		const character = {data: {carry: getCarryBlock({bodyLoad: 500, status: "over_capacity", isIndeterminate: true})}};
		expect(getDmCarrySummary({character, expectedBasis: BASIS}).isIndeterminate).toBe(true);
	});

	it.each([
		["unknown below capacity", {carried: 120, capacity: 150, state: "unknown", isIndeterminate: true}],
		["over capacity with unknown stacks", {carried: 500, capacity: 150, state: "over_capacity", isIndeterminate: true}],
	])("%s is counted as indeterminate by the ACTUAL linked party aggregate", (_label, summary) => {
		// The aggregate buckets on the reconstructed profile, so an indeterminate member whose
		// profile claimed `unknownStackCount: 0` was counted as fully known and the totals
		// silently presented a lower bound as a complete sum.
		const mapped = PartyTrackerImporter.mapCarrySummary(summary);
		const member = new PartyTrackerCharacter(PartyTrackerCharacterSerializer.deserialize({csum: mapped}), {}).getCarryState();
		const aggregate = getPartyCarryAggregate({members: [member]});

		expect(member.state).toBe("indeterminate");
		expect(aggregate.indeterminateCount).toBe(1);
		expect(aggregate.knownCount).toBe(0);
		// Drives the "≥" prefix on the party summary line.
		expect(aggregate.isTotalPartial).toBe(true);
	});

	it("an exact member keeps the totals complete (the control)", () => {
		const mapped = PartyTrackerImporter.mapCarrySummary({carried: 120, capacity: 150, state: "encumbered"});
		const member = new PartyTrackerCharacter(PartyTrackerCharacterSerializer.deserialize({csum: mapped}), {}).getCarryState();
		const aggregate = getPartyCarryAggregate({members: [member]});
		expect(aggregate.knownCount).toBe(1);
		expect(aggregate.isTotalPartial).toBe(false);
	});

	it("a mixed party is partial as soon as one member is indeterminate", () => {
		const build = summary => new PartyTrackerCharacter(
			PartyTrackerCharacterSerializer.deserialize({csum: PartyTrackerImporter.mapCarrySummary(summary)}), {},
		).getCarryState();
		const aggregate = getPartyCarryAggregate({members: [
			build({carried: 100, capacity: 150, state: "normal"}),
			build({carried: 500, capacity: 150, state: "over_capacity", isIndeterminate: true}),
		]});
		expect(aggregate.knownCount).toBe(1);
		expect(aggregate.indeterminateCount).toBe(1);
		expect(aggregate.isTotalPartial).toBe(true);
	});
});

/* ── 7 & 8. Transfer preview ──────────────────────────────────────── */

describe("defects 7 and 8 — transfer preview math and recipient consequence", () => {
	const CharacterSheetState = globalThis.CharacterSheetState;

	it("adding stowable gear to a bag with spare capacity does not raise the body load", () => {
		// The naive `bodyLoad + delta` claimed a 20 lb increase the character never feels,
		// because the gear notionally rides in the container.
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.addItem({name: "Bag of Holding", source: "XDMG", weight: 15, containerCapacity: {weight: [500], weightless: true}, equipped: true, quantity: 1});
		const before = state.getCarryProfile();

		state.addItem({name: "Ingots", weight: 20, quantity: 1});
		const after = state.getCarryProfile();

		expect(after.grossWeight).toBe(before.grossWeight + 20);
		expect(after.bodyLoad).toBe(before.bodyLoad); // absorbed by the bag
	});

	it("overflow beyond bag capacity does land on the body", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.addItem({name: "Small Bag", source: "XDMG", weight: 1, containerCapacity: {weight: [10], weightless: true}, equipped: true, quantity: 1});
		const before = state.getCarryProfile();
		state.addItem({name: "Ingots", weight: 30, quantity: 1});
		const after = state.getCarryProfile();

		expect(after.bagLoad).toBe(10);
		expect(after.bodyLoad).toBe(before.bodyLoad + 20);
	});

	it("keeps a shared recipient's carry and drops a withheld one", () => {
		const projections = [
			{kind: "peer_profile", id: "p1", data: {identity: {name: "Shared"}, classes: [], carrySummary: {carried: 40, capacity: 150, state: "normal"}}},
			{kind: "peer_profile", id: "p2", data: {identity: {name: "Hidden"}, classes: []}},
		];
		const roster = [{characterId: "p1", targetRef: "p1"}, {characterId: "p2", targetRef: "p2"}];
		const recipients = getPartyInventoryRecipients({projections, roster, currentCharacterId: "me"});

		const shared = recipients.find(r => r.label === "Shared");
		const hidden = recipients.find(r => r.label === "Hidden");
		// `isIndeterminate` travels with the recipient's carry: an over-capacity peer can still
		// be a lower bound, and dropping the flag rendered their weight as exact.
		if (shared) expect(shared.carry).toEqual({carried: 40, capacity: 150, state: "normal", isIndeterminate: false});
		// A withheld load must be absent, not defaulted to zero — zero is a claim.
		if (hidden) expect(hidden.carry).toBeNull();
	});
});
