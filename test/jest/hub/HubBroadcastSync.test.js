import {HubBroadcastSync} from "../../../js/hub/hub-broadcast-sync.js";

class FakeChannel {
	static channels = new Map();

	constructor (name) {
		this.name = name;
		this.listeners = new Set();
		const channels = FakeChannel.channels.get(name) || new Set();
		channels.add(this);
		FakeChannel.channels.set(name, channels);
	}

	addEventListener (type, listener) {
		if (type === "message") this.listeners.add(listener);
	}

	postMessage (data) {
		for (const channel of FakeChannel.channels.get(this.name)) {
			if (channel === this) continue;
			channel.listeners.forEach(listener => listener({data: structuredClone(data)}));
		}
	}

	close () {
		FakeChannel.channels.get(this.name)?.delete(this);
	}
}

describe("same-browser hub coordination", () => {
	beforeEach(() => FakeChannel.channels.clear());

	it("announces a lease claim to other tabs in the same campaign", () => {
		const tabA = new HubBroadcastSync({campaignId: "campaign", tabId: "a", fnCreateChannel: name => new FakeChannel(name)});
		const tabB = new HubBroadcastSync({campaignId: "campaign", tabId: "b", fnCreateChannel: name => new FakeChannel(name)});
		const seen = [];
		tabB.onRemoteLease(event => seen.push(event));

		tabA.announceLease({resourceId: "character-1", epoch: 3});

		expect(tabB.getRemoteEditor("character-1")).toEqual(expect.objectContaining({tabId: "a", epoch: 3}));
		expect(seen).toHaveLength(1);
		tabA.close();
		tabB.close();
	});

	it("isolates different campaigns", () => {
		const tabA = new HubBroadcastSync({campaignId: "a", tabId: "a", fnCreateChannel: name => new FakeChannel(name)});
		const tabB = new HubBroadcastSync({campaignId: "b", tabId: "b", fnCreateChannel: name => new FakeChannel(name)});
		tabA.announceLease({resourceId: "character-1", epoch: 1});
		expect(tabB.getRemoteEditor("character-1")).toBeNull();
	});
});
