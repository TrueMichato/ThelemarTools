/**
 * Carry-summary freshness across every server path that can invalidate it.
 *
 * The summary is authoritative precisely because only the Character Sheet can compute it —
 * which means the server can never repair a stale one. The safety property is therefore
 * *fail closed*: after anything that could change the answer, the projection must report
 * nothing rather than the previous answer. A stale capacity is worse than an absent one,
 * because a DM cannot tell it is wrong.
 *
 * There are three independent staleness vectors, and each needs its own mechanism:
 *   1. server-side document mutations (item grants, transfer escrow) change `inventory`
 *      while preserving unrelated fields;
 *   2. patches from a client that predates carry authority change the document without
 *      refreshing the summary;
 *   3. campaign rules and brew rotation change carry INPUTS without touching the document
 *      at all, so nothing in the document could reveal it.
 *
 * Equally important are the negatives: create/import must KEEP a freshly supplied block,
 * and a transfer participant that was only read must keep its own.
 */

import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {getExpectedCarryBasis} from "../../../server/src/carry-basis.js";
import {resolveCarryAuthority} from "../../../js/hub/hub-carry-authority.js";
import {computeCarrySettingsDigest} from "../../../js/hub/hub-carry-authority.js";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** A summary shaped exactly as `CharacterSheetState.toJson()` materialises one. */
function getCarryBlock (overrides = {}) {
	return {
		schemaVersion: 1,
		basis: {
			kind: "campaign",
			rulesVersionId: null,
			brewBundleHash: null,
			settingsDigest: computeCarrySettingsDigest({}),
		},
		bodyCapacity: 240,
		bodyLoad: 40,
		status: "normal",
		...overrides,
	};
}

function getCharacterData (overrides = {}) {
	return {
		name: "Bearer",
		abilities: {str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		hp: {current: 10, max: 10, temp: 0},
		inventory: [{id: "i1", item: {name: "Rope", weight: 10}, quantity: 1}],
		currency: {gp: 0},
		carry: getCarryBlock(),
		...overrides,
	};
}

/**
 * A campaign with a DM and a separate player who owns the characters.
 *
 * The owner distinction matters: an owner receives raw document truth, so only a
 * NON-owning viewer exercises the projection path the DM Screen actually reads.
 */
async function setup () {
	const store = new MemoryHubStore();
	const dm = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "1", displayName: "DM"});
	const player = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "2", displayName: "Player"});
	const {campaign} = await store.pCreateCampaign({accountId: dm.id, name: "C", idempotencyKey: "c-1"});
	await store.pCreateInvite({
		accountId: dm.id,
		campaignId: campaign.id,
		role: "player",
		tokenHash: "token-hash",
		expiresAt: new Date(Date.now() + 3_600_000),
		maxUses: 5,
		idempotencyKey: "i-1",
	});
	await store.pRedeemInvite({accountId: player.id, tokenHash: "token-hash", idempotencyKey: "i-2"});
	const {character} = await store.pCreateCharacter({
		accountId: player.id,
		campaignId: campaign.id,
		data: getCharacterData(),
		schemaVersion: 1,
		clientImportId: "import-1",
		idempotencyKey: "ch-1",
	});
	// Carry is NOT in the default `table` preset, so it is shared only when its owner opts
	// in. Every freshness assertion below therefore starts from a character that has chosen
	// to share it — otherwise the field would be absent for reasons unrelated to staleness.
	await store.pSetProjectionPolicy({
		accountId: player.id,
		characterId: character.id,
		policy: {version: 1, preset: "table", overrides: {carrySummary: {mode: "share"}}},
		expectedProjectionRevision: character.projectionRevision,
		idempotencyKey: "pol-1",
	});
	return {store, dm, player, campaign, character};
}

/** The carry summary the DM currently sees for this character, or `null` when unavailable. */
async function getVisibleCarry ({store, dm, campaign, characterId}) {
	const {projections} = await store.pListCampaignCharacterProjections({accountId: dm.id, campaignId: campaign.id});
	const projection = projections.find(it => (it.character?.id || it.id) === characterId);
	// A DM sees `dm_truth` carrying the peer preview; that preview is the surface the Party
	// Tracker reads.
	return projection?.peerPreview?.data?.carrySummary ?? projection?.data?.carrySummary ?? null;
}

function getStoredCarry (store, characterId) {
	return store._characters.get(characterId).data.carry;
}

describe("baseline", () => {
	it("carry is not shared by default — it is opt-in", async () => {
		const store = new MemoryHubStore();
		const dm = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "1", displayName: "DM"});
		const player = await store.pUpsertOAuthAccount({provider: "github", providerSubject: "2", displayName: "P"});
		const {campaign} = await store.pCreateCampaign({accountId: dm.id, name: "C", idempotencyKey: "c-1"});
		await store.pCreateInvite({
			accountId: dm.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash: "t",
			expiresAt: new Date(Date.now() + 3_600_000),
			maxUses: 5,
			idempotencyKey: "i-1",
		});
		await store.pRedeemInvite({accountId: player.id, tokenHash: "t", idempotencyKey: "i-2"});
		const {character} = await store.pCreateCharacter({
			accountId: player.id,
			campaignId: campaign.id,
			data: getCharacterData(),
			schemaVersion: 1,
			clientImportId: "im",
			idempotencyKey: "ch-1",
		});

		// The default `table` preset omits carrySummary entirely, so a fresh authoritative
		// summary still reaches nobody until its owner shares it.
		expect(await getVisibleCarry({store, dm, campaign, characterId: character.id})).toBeNull();
	});

	it("a freshly created character projects its supplied summary", async () => {
		const ctx = await setup();
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeDefined();
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id}))
			.toEqual({carried: 40, capacity: 240});
	});
});

describe("create and import must PRESERVE a fresh summary", () => {
	// Invalidating inside `normalizeCharacterInventory()` would have broken exactly this:
	// that function also runs on create and import, so a first cloud save would arrive
	// already stripped and the character would show "not synced" until an unrelated edit.
	it("create keeps the block the sheet supplied", async () => {
		const {store, character} = await setup();
		expect(getStoredCarry(store, character.id)).toMatchObject({bodyCapacity: 240, bodyLoad: 40});
	});

	it("re-import of an archived character keeps the newly supplied block", async () => {
		const {store, player, campaign, character} = await setup();
		await store.pArchiveCharacter?.({accountId: player.id, characterId: character.id, idempotencyKey: "a-1"})
			?.catch?.(() => {});
		const {character: reimported} = await store.pCreateCharacter({
			accountId: player.id,
			campaignId: campaign.id,
			data: getCharacterData({carry: getCarryBlock({bodyLoad: 99})}),
			schemaVersion: 1,
			clientImportId: "import-1",
			idempotencyKey: "ch-2",
		});
		expect(getStoredCarry(store, reimported.id)).toMatchObject({bodyLoad: 99});
	});
});

describe("item grant invalidates", () => {
	it("a granted item drops the summary, so no stale capacity is projected", async () => {
		const ctx = await setup();
		await ctx.store.pGrantItem({
			accountId: ctx.dm.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.character.id,
			item: {name: "Anvil", weight: 100},
			idempotencyKey: "g-1",
		});

		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeUndefined();
		// Omitted rather than zeroed: "not synced" must be distinguishable from
		// "carrying nothing".
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id})).toEqual({});
	});

	it("the owner's next authoritative save restores it", async () => {
		const ctx = await setup();
		await ctx.store.pGrantItem({
			accountId: ctx.dm.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.character.id,
			item: {name: "Anvil", weight: 100},
			idempotencyKey: "g-1",
		});
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id})).toEqual({});

		const lease = await ctx.store.pAcquireCharacterLease({
			accountId: ctx.player.id, sessionId: "s-1", characterId: ctx.character.id,
		});
		const current = ctx.store._characters.get(ctx.character.id);
		await ctx.store.pPatchCharacter({
			accountId: ctx.player.id,
			sessionId: "s-1",
			characterId: ctx.character.id,
			baseRevision: current.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "add", path: "/carry", value: getCarryBlock({bodyLoad: 140})}],
			idempotencyKey: "p-1",
		});

		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id}))
			.toEqual({carried: 140, capacity: 240});
	});
});

describe("transfer lifecycle invalidates the written participant only", () => {
	async function setupPair () {
		const ctx = await setup();
		const {character: other} = await ctx.store.pCreateCharacter({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			data: getCharacterData({name: "Receiver"}),
			schemaVersion: 1,
			clientImportId: "import-2",
			idempotencyKey: "ch-b",
		});
		await ctx.store.pSetProjectionPolicy({
			accountId: ctx.player.id,
			characterId: other.id,
			policy: {version: 1, preset: "table", overrides: {carrySummary: {mode: "share"}}},
			expectedProjectionRevision: other.projectionRevision,
			idempotencyKey: "pol-2",
		});
		return {...ctx, other};
	}

	it("escrow reservation invalidates the SOURCE but leaves the untouched target alone", async () => {
		const ctx = await setupPair();
		await ctx.store.pProposeTransfer({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.character.id,
			targetKind: "character",
			targetId: ctx.other.id,
			payload: {items: [{entryId: "i1", quantity: 1}]},
			idempotencyKey: "t-1",
		});

		// The source lost the stack, so its summary no longer describes it.
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeUndefined();
		// The target was only READ while validating the proposal. Nothing of it changed, so
		// destroying its authority would be gratuitous — and is exactly what invalidating
		// inside the container reader would have done.
		expect(getStoredCarry(ctx.store, ctx.other.id)).toBeDefined();
	});

	it("acceptance invalidates the destination too", async () => {
		const ctx = await setupPair();
		const {transfer} = await ctx.store.pProposeTransfer({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.character.id,
			targetKind: "character",
			targetId: ctx.other.id,
			payload: {items: [{entryId: "i1", quantity: 1}]},
			idempotencyKey: "t-1",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			transferId: transfer.id,
			decision: "accept",
			idempotencyKey: "t-2",
		});

		expect(getStoredCarry(ctx.store, ctx.other.id)).toBeUndefined();
		expect(await getVisibleCarry({...ctx, characterId: ctx.other.id})).toEqual({});
	});

	it("rejection restores the source stack and leaves no stale summary behind", async () => {
		const ctx = await setupPair();
		const {transfer} = await ctx.store.pProposeTransfer({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			sourceKind: "character",
			sourceId: ctx.character.id,
			targetKind: "character",
			targetId: ctx.other.id,
			payload: {items: [{entryId: "i1", quantity: 1}]},
			idempotencyKey: "t-1",
		});
		await ctx.store.pResolveTransfer({
			accountId: ctx.player.id,
			campaignId: ctx.campaign.id,
			transferId: transfer.id,
			decision: "reject",
			idempotencyKey: "t-2",
		});

		// The restore is itself a write, so the pre-transfer summary must not be resurrected
		// alongside the returned stack.
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeUndefined();
	});
});

describe("mixed-version patch protocol", () => {
	async function patch (ctx, patches, key) {
		const lease = await ctx.store.pAcquireCharacterLease({
			accountId: ctx.player.id, sessionId: "s-1", characterId: ctx.character.id, isTakeover: true,
		});
		const current = ctx.store._characters.get(ctx.character.id);
		return ctx.store.pPatchCharacter({
			accountId: ctx.player.id,
			sessionId: "s-1",
			characterId: ctx.character.id,
			baseRevision: current.revision,
			leaseEpoch: lease.epoch,
			patches,
			idempotencyKey: key,
		});
	}

	it("an old client's inventory patch fails closed", async () => {
		const ctx = await setup();
		await patch(ctx, [{op: "add", path: "/inventory/-", value: {id: "i2", item: {name: "Rock", weight: 50}, quantity: 1}}], "p-1");
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeUndefined();
	});

	it("an old client's UNRELATED patch also fails closed", async () => {
		// The patch does not obviously touch carry — but passive Might depends on skills,
		// expertise, class levels, proficiency bonus, named modifiers and feature choices,
		// so no allowlist of "carry-relevant paths" could be trusted to be complete.
		const ctx = await setup();
		await patch(ctx, [{op: "replace", path: "/name", value: "Renamed"}], "p-1");
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeUndefined();
	});

	it("a current client's unrelated save REFRESHES the summary and keeps it", async () => {
		const ctx = await setup();
		await patch(ctx, [
			{op: "replace", path: "/name", value: "Renamed"},
			{op: "replace", path: "/carry", value: getCarryBlock({bodyLoad: 41})},
		], "p-1");

		expect(getStoredCarry(ctx.store, ctx.character.id)).toMatchObject({bodyLoad: 41});
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id}))
			.toEqual({carried: 41, capacity: 240});
	});

	it("a malformed /carry write cannot preserve authority", async () => {
		const ctx = await setup();
		await patch(ctx, [
			{op: "replace", path: "/name", value: "Renamed"},
			{op: "replace", path: "/carry", value: {schemaVersion: 99, bodyLoad: 1}},
		], "p-1");
		// Written, but unusable — the resolver rejects the version, so nothing is projected.
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id})).toEqual({});
	});
});

describe("rules and brew rotation invalidate without touching the document", () => {
	it("activating a rules version stops the previous summary being trusted", async () => {
		const ctx = await setup();
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id}))
			.toEqual({carried: 40, capacity: 240});

		const {rulesVersion} = await ctx.store.pCreateRulesVersion({
			accountId: ctx.dm.id,
			campaignId: ctx.campaign.id,
			schemaVersion: 1,
			rules: {thelemar_carryWeight: false},
			idempotencyKey: "r-1",
		});
		await ctx.store.pActivateRulesVersion({
			accountId: ctx.dm.id,
			campaignId: ctx.campaign.id,
			rulesVersionId: rulesVersion.id,
			idempotencyKey: "r-2",
		});

		// The document is byte-identical; only the world around it moved. Switching the
		// Thelemar carry rule changes capacity outright, so the old number is now wrong.
		expect(getStoredCarry(ctx.store, ctx.character.id)).toBeDefined();
		expect(await getVisibleCarry({...ctx, characterId: ctx.character.id})).toEqual({});
	});
});

describe("single-read and list projections agree", () => {
	it("a character cannot look fresh in one path and stale in the other", async () => {
		const ctx = await setup();
		await ctx.store.pGrantItem({
			accountId: ctx.dm.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.character.id,
			item: {name: "Anvil", weight: 100},
			idempotencyKey: "g-1",
		});

		const single = await ctx.store.pGetCharacter({accountId: ctx.dm.id, characterId: ctx.character.id});
		const fromList = await getVisibleCarry({...ctx, characterId: ctx.character.id});
		expect(single.peerPreview.data.carrySummary).toEqual({});
		expect(fromList).toEqual({});
	});
});

describe("basis resolution", () => {
	it("a character with no campaign gets an explicit detached basis", () => {
		const basis = getExpectedCarryBasis({character: {campaignId: null, data: {settings: {}}}});
		expect(basis.kind).toBe("detached");
	});

	it("the campaign overlay is re-applied so the digest matches the sheet's effective settings", () => {
		// `setCampaignSettingsOverlay()` writes rule values over the character's own settings
		// and `getSettings()` returns the result, while `toJson()` restores the originals —
		// so the stored document holds the character's settings and the overlay has to be
		// re-applied here to reach the same digest.
		const character = {campaignId: "c", data: {settings: {thelemar_carryWeight: true}}};
		const overlaid = getExpectedCarryBasis({
			character,
			rulesVersion: {id: "r1", rules: {thelemar_carryWeight: false}},
		});
		const plain = getExpectedCarryBasis({character, rulesVersion: {id: "r1", rules: {thelemar_carryWeight: true}}});
		expect(overlaid.settingsDigest).not.toBe(plain.settingsDigest);
	});
});

describe("Memory and PostgreSQL invalidate identically", () => {
	// The PostgreSQL suites need a live database and skip without one, so the structural
	// guarantee is asserted here: both stores must call the same shared helpers at the same
	// points, or one of them will silently project stale carry in production.
	const stores = {
		memory: read("server/src/memory-hub-store.js"),
		postgres: read("server/src/postgres-hub-store.js"),
	};

	it.each(Object.entries(stores))("%s imports the shared invalidation helpers", (_name, source) => {
		expect(source).toContain("from \"../../js/hub/hub-carry-authority.js\"");
		expect(source).toContain("from \"./carry-basis.js\"");
	});

	it.each(Object.entries(stores))("%s strips on grant, on transfer write, and on an authority-less patch", (_name, source) => {
		// Two strip sites (grant + transfer writer) plus the patch guard.
		expect((source.match(/stripCarryAuthority\(/g) || []).length).toBeGreaterThanOrEqual(3);
		expect(source).toContain("hasFreshCarryWrite(patches)");
	});

	it.each(Object.entries(stores))("%s never strips inside inventory normalization", (_name, source) => {
		// Normalization also runs for create/import and for merely-read transfer containers.
		expect(source).not.toMatch(/normalizeCharacterInventory[\s\S]{0,120}stripCarryAuthority/);
	});

	it("neither store recomputes carry arithmetic", () => {
		for (const source of Object.values(stores)) {
			expect(source).not.toMatch(/\*\s*15\s*\*/);
			expect(source).not.toContain("powerfulBuild");
		}
	});
});

describe("the resolver is the only gate", () => {
	it("a document whose basis cannot be matched yields null, never a partial read", () => {
		const data = {carry: getCarryBlock()};
		expect(resolveCarryAuthority({data, expectedBasis: {kind: "campaign", rulesVersionId: "other", brewBundleHash: null, settingsDigest: computeCarrySettingsDigest({})}})).toBeNull();
	});
});
