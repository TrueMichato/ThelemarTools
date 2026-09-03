import {HubActiveCampaignChannel} from "../../../js/hub/hub-active-campaign-channel.js";
import {
	ACTIVE_CAMPAIGN_CHANNEL_NAME,
	ACTIVE_CAMPAIGN_SCHEMA_VERSION,
	ACTIVE_CAMPAIGN_STORAGE_KEY,
	makeClearedRecord,
	makeSelectedRecord,
} from "../../../js/hub/hub-active-campaign-record.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";
const WRITER_A = "55555555-5555-4555-8555-555555555555";
const WRITER_B = "66666666-6666-4666-8666-666666666666";

/** In-process broadcast bus so several channel instances can talk without a real browser. */
class FakeBus {
	constructor () { this.channels = new Set(); }

	create () {
		const bus = this;
		const channel = {
			name: ACTIVE_CAMPAIGN_CHANNEL_NAME,
			listeners: new Set(),
			posted: [],
			isClosed: false,
			addEventListener: (type, fn) => { if (type === "message") channel.listeners.add(fn); },
			removeEventListener: (type, fn) => { if (type === "message") channel.listeners.delete(fn); },
			postMessage: data => {
				channel.posted.push(data);
				for (const peer of bus.channels) {
					if (peer === channel || peer.isClosed) continue;
					for (const fn of peer.listeners) fn({data});
				}
			},
			close: () => { channel.isClosed = true; bus.channels.delete(channel); },
		};
		bus.channels.add(channel);
		return channel;
	}
}

class FakeTarget {
	constructor () { this.listeners = new Map(); }

	addEventListener (type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(fn);
	}

	removeEventListener (type, fn) { this.listeners.get(type)?.delete(fn); }

	emit (type, event) { for (const fn of [...(this.listeners.get(type) || [])]) fn(event); }

	countListeners (type) { return this.listeners.get(type)?.size || 0; }
}

const selected = over => makeSelectedRecord({
	accountId: ACCOUNT_A, campaignId: CAMPAIGN_A, revision: 1, updatedAt: 1000, writerId: WRITER_A, ...over,
});

describe("HubActiveCampaignChannel", () => {
	let bus;
	let target;

	beforeEach(() => {
		bus = new FakeBus();
		target = new FakeTarget();
	});

	const makeChannel = writerId => new HubActiveCampaignChannel({
		writerId,
		fnCreateChannel: () => bus.create(),
		target,
	});

	it("delivers a selection to other tabs", () => {
		const a = makeChannel(WRITER_A);
		const b = makeChannel(WRITER_B);
		const received = [];
		b.onMessage(payload => received.push(payload));

		a.post(selected());
		expect(received).toHaveLength(1);
		expect(received[0].record).toMatchObject({campaignId: CAMPAIGN_A, revision: 1});
		expect(received[0].isStorageSignal).toBe(false);
	});

	it("never reacts to its own write", () => {
		const a = makeChannel(WRITER_A);
		const received = [];
		a.onMessage(payload => received.push(payload));
		a.post(selected());
		expect(received).toHaveLength(0);
	});

	it("ignores messages for a different account or an unknown schema", () => {
		const a = makeChannel(WRITER_A);
		const b = makeChannel(WRITER_B);
		const received = [];
		b.onMessage(payload => received.push(payload));

		const base = {
			type: "selection_changed",
			schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION,
			accountId: "not-a-uuid",
			campaignId: CAMPAIGN_A,
			revision: 1,
			updatedAt: 1,
			writerId: WRITER_A,
		};
		a._channel.postMessage(base);
		a._channel.postMessage({...base, accountId: ACCOUNT_A, schemaVersion: 99});
		a._channel.postMessage({...base, accountId: ACCOUNT_A, type: "something_else"});
		expect(received).toHaveLength(0);
	});

	it("carries a clear as a complete tombstone", () => {
		const a = makeChannel(WRITER_A);
		const b = makeChannel(WRITER_B);
		const received = [];
		b.onMessage(payload => received.push(payload));

		a.post(makeClearedRecord({accountId: ACCOUNT_A, revision: 4, updatedAt: 4000, writerId: WRITER_A}));
		expect(a._channel.posted[0].type).toBe("selection_cleared");
		expect(received[0].record).toMatchObject({state: "cleared", campaignId: null, revision: 4});
	});

	it("treats a storage event as a signal to reread rather than a payload to trust", () => {
		const a = makeChannel(WRITER_A);
		const received = [];
		a.onMessage(payload => received.push(payload));

		target.emit("storage", {key: ACTIVE_CAMPAIGN_STORAGE_KEY, newValue: "{\"trust\":\"me\"}"});
		expect(received).toEqual([{record: null, isStorageSignal: true}]);

		// Unrelated keys are ignored entirely.
		target.emit("storage", {key: "some.other.key", newValue: "x"});
		expect(received).toHaveLength(1);
	});

	it("carries only identifiers, never campaign or account content", () => {
		const a = makeChannel(WRITER_A);
		a.post(selected());
		expect(Object.keys(a._channel.posted[0]).sort()).toEqual([
			"accountId", "campaignId", "revision", "schemaVersion", "type", "updatedAt", "writerId",
		]);
	});

	it("carries a bounded clear cause so receivers can distinguish logout from access loss", () => {
		const a = makeChannel(WRITER_A);
		const b = makeChannel(WRITER_B);
		const received = [];
		b.onMessage(payload => received.push(payload));

		const tombstone = makeClearedRecord({accountId: ACCOUNT_A, revision: 3, updatedAt: 3000, writerId: WRITER_A});
		a.post(tombstone, {cause: "logout"});
		expect(a._channel.posted[0].cause).toBe("logout");
		expect(received[0].cause).toBe("logout");

		// An unknown cause is dropped rather than forwarded, and a selection never carries one.
		a.post(makeClearedRecord({accountId: ACCOUNT_A, revision: 4, updatedAt: 4000, writerId: WRITER_A}), {cause: "something-else"});
		expect(a._channel.posted[1].cause).toBeUndefined();
		a.post(selected({revision: 5}), {cause: "logout"});
		expect(a._channel.posted[2].cause).toBeUndefined();
	});

	it("does not loop: repeated receipts of one logical record produce no unbounded rebroadcast", () => {
		const a = makeChannel(WRITER_A);
		const b = makeChannel(WRITER_B);
		const record = selected();

		// B echoes back whatever it receives, which is exactly the pattern that would loop if
		// duplicate posts were not suppressed.
		b.onMessage(payload => { if (payload.record) b.post(payload.record); });

		a.post(record);
		// A single post from A, a single echo from B, then quiescence.
		expect(a._channel.posted).toHaveLength(1);
		expect(b._channel.posted).toHaveLength(1);

		// Re-posting the identical logical record is suppressed at the source.
		expect(b.post(record)).toBe(false);
		expect(b._channel.posted).toHaveLength(1);
	});

	it("releases the channel and the storage listener on close", () => {
		const a = makeChannel(WRITER_A);
		expect(target.countListeners("storage")).toBe(1);
		const channel = a._channel;

		a.close();
		expect(channel.isClosed).toBe(true);
		expect(target.countListeners("storage")).toBe(0);
		// Closing twice is safe, and a closed channel neither posts nor emits.
		a.close();
		expect(a.post(selected())).toBe(false);
	});

	it("degrades to storage-only when BroadcastChannel is unavailable", () => {
		const a = new HubActiveCampaignChannel({
			writerId: WRITER_A,
			fnCreateChannel: () => { throw new Error("unsupported"); },
			target,
		});
		expect(a.hasChannel).toBe(false);
		expect(a.post(selected())).toBe(false);

		const received = [];
		a.onMessage(payload => received.push(payload));
		target.emit("storage", {key: ACTIVE_CAMPAIGN_STORAGE_KEY});
		expect(received).toEqual([{record: null, isStorageSignal: true}]);
	});
});
