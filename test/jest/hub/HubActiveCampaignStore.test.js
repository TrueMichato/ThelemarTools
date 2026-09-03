import {HubActiveCampaignStore} from "../../../js/hub/hub-active-campaign-store.js";
import {
	ACTIVE_CAMPAIGN_STORAGE_KEY,
	ACTIVE_CAMPAIGN_WRITE_LOCK,
	makeSelectedRecord,
	parseActiveCampaignRecord,
	serializeActiveCampaignRecord,
} from "../../../js/hub/hub-active-campaign-record.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_B = "44444444-4444-4444-8444-444444444444";
const WRITER_A = "55555555-5555-4555-8555-555555555555";
const WRITER_B = "66666666-6666-4666-8666-666666666666";

/** Minimal deterministic storage; `testEnvironment` is `node`, so there is no real localStorage. */
class FakeStorage {
	constructor () {
		this.map = new Map();
		this.removals = [];
		this.writes = [];
	}

	getItem (key) { return this.map.has(key) ? this.map.get(key) : null; }
	setItem (key, value) { this.writes.push(value); this.map.set(key, value); }
	removeItem (key) { this.removals.push(key); this.map.delete(key); }
}

const makeStore = ({storage = new FakeStorage(), locks = null, writerId = WRITER_A, now = 1000} = {}) => {
	let clock = now;
	const store = new HubActiveCampaignStore({
		storage,
		locks,
		writerId,
		fnNow: () => clock,
		fnDelay: async () => {},
	});
	return {store, storage, setNow: value => { clock = value; }};
};

describe("HubActiveCampaignStore", () => {
	it("writes a durable selection and increments revision on each mutation", async () => {
		const {store, storage} = makeStore();
		const first = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		expect(first).toMatchObject({revision: 1, state: "selected", campaignId: CAMPAIGN_A});

		const second = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_B});
		expect(second.revision).toBe(2);
		expect(parseActiveCampaignRecord(storage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toEqual(second);
	});

	it("advances updatedAt strictly even when the clock does not move", async () => {
		const {store} = makeStore({now: 500});
		const first = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		const second = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_B});
		expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
	});

	it("clears with a durable tombstone rather than removing the key", async () => {
		const {store, storage} = makeStore();
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		const tombstone = await store.pClear({accountId: ACCOUNT_A});

		expect(tombstone).toMatchObject({state: "cleared", campaignId: null, revision: 2});
		expect(storage.removals).toHaveLength(0);
		expect(parseActiveCampaignRecord(storage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toEqual(tombstone);
	});

	it("serialises mutations through the origin-scoped write lock when available", async () => {
		const requested = [];
		const locks = {
			request: async (name, fn) => {
				requested.push(name);
				return fn();
			},
		};
		const {store} = makeStore({locks});
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		await store.pClear({accountId: ACCOUNT_A});
		expect(requested).toEqual([ACTIVE_CAMPAIGN_WRITE_LOCK, ACTIVE_CAMPAIGN_WRITE_LOCK]);
	});

	it("still mutates correctly with no Web Locks support", async () => {
		const {store, storage} = makeStore({locks: null});
		const record = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		expect(parseActiveCampaignRecord(storage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toEqual(record);
	});

	it("evicts malformed and oversized values but never a valid record", async () => {
		const {store, storage} = makeStore();
		storage.map.set(ACTIVE_CAMPAIGN_STORAGE_KEY, "{broken");
		expect(store.read()).toBeNull();
		expect(storage.removals).toEqual([ACTIVE_CAMPAIGN_STORAGE_KEY]);

		const record = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		storage.removals.length = 0;
		expect(store.read()).toEqual(record);
		expect(storage.removals).toHaveLength(0);
	});

	it("hides a record belonging to another account", async () => {
		const {store} = makeStore();
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		expect(store.readForAccount(ACCOUNT_A)).not.toBeNull();
		expect(store.readForAccount(ACCOUNT_B)).toBeNull();
	});

	it("restarts revision numbering when the account changes", async () => {
		const {store} = makeStore();
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		// A foreign record is not comparable, so account B must not inherit A's ordering position.
		const record = await store.pSelect({accountId: ACCOUNT_B, campaignId: CAMPAIGN_B});
		expect(record.revision).toBe(1);
	});

	it("repairs storage toward the winner verbatim, without bumping the revision", async () => {
		const {store, storage} = makeStore();
		const winner = makeSelectedRecord({accountId: ACCOUNT_A, campaignId: CAMPAIGN_B, revision: 7, updatedAt: 5000, writerId: WRITER_B});
		// Storage physically holds a lower record than the one this tab observed.
		storage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, serializeActiveCampaignRecord(
			makeSelectedRecord({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A, revision: 6, updatedAt: 4000, writerId: WRITER_A}),
		));

		const {winner: accepted, didRepairStorage} = await store.pAccept(winner);
		expect(didRepairStorage).toBe(true);
		expect(accepted).toEqual(winner);
		// Verbatim: a repair that assigned a new revision would create an endless race.
		expect(parseActiveCampaignRecord(storage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY))).toEqual(winner);
	});

	it("does not repair when storage already holds an equal or greater record", async () => {
		const {store, storage} = makeStore();
		const stored = makeSelectedRecord({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A, revision: 9, updatedAt: 9000, writerId: WRITER_A});
		storage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, serializeActiveCampaignRecord(stored));
		storage.writes.length = 0;

		const lower = makeSelectedRecord({accountId: ACCOUNT_A, campaignId: CAMPAIGN_B, revision: 3, updatedAt: 3000, writerId: WRITER_B});
		const {winner, didRepairStorage} = await store.pAccept(lower);
		expect(didRepairStorage).toBe(false);
		expect(winner).toEqual(stored);
		expect(storage.writes).toHaveLength(0);
	});

	it("keeps a clear tombstone winning an equal-revision race, and a restart cannot resurrect the selection", async () => {
		const {store, storage} = makeStore();
		await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		const tombstone = await store.pClear({accountId: ACCOUNT_A});

		// A late physical write of the losing equal-revision selection lands after the tombstone.
		const losing = makeSelectedRecord({
			accountId: ACCOUNT_A,
			campaignId: CAMPAIGN_A,
			revision: tombstone.revision,
			updatedAt: tombstone.updatedAt,
			writerId: tombstone.writerId,
		});
		storage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, serializeActiveCampaignRecord(losing));

		const {winner} = await store.pAccept(losing);
		expect(winner).toEqual(tombstone);
		// Durable convergence: a brand-new coordinator (browser restart) recovers the tombstone.
		const restarted = new HubActiveCampaignStore({storage, locks: null, writerId: WRITER_B, fnNow: () => 9999});
		expect(restarted.read()).toEqual(tombstone);
		expect(restarted.read().state).toBe("cleared");
	});

	it("ignores a cross-account record when accepting", async () => {
		const {store} = makeStore();
		const mine = await store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A});
		const foreign = makeSelectedRecord({accountId: ACCOUNT_B, campaignId: CAMPAIGN_B, revision: 99, updatedAt: 99999, writerId: WRITER_B});
		const {winner} = await store.pAccept(foreign);
		expect(winner).toEqual(mine);
	});

	it("degrades safely when storage is unavailable", async () => {
		const store = new HubActiveCampaignStore({storage: null, locks: null, writerId: WRITER_A, fnNow: () => 1});
		expect(store.read()).toBeNull();
		await expect(store.pSelect({accountId: ACCOUNT_A, campaignId: CAMPAIGN_A})).resolves.toMatchObject({revision: 1});
	});
});
