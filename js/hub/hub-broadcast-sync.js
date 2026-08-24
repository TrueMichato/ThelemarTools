export class HubBroadcastSync {
	constructor ({
		campaignId,
		tabId = crypto.randomUUID(),
		fnCreateChannel = name => new BroadcastChannel(name),
	}) {
		this._tabId = tabId;
		this._remoteEditors = new Map();
		this._listeners = new Set();
		this._channel = fnCreateChannel(`hub:${campaignId}`);
		this._channel.addEventListener("message", event => this._handleMessage(event.data));
	}

	_handleMessage (message) {
		if (!message || message.tabId === this._tabId || message.type !== "lease_claimed") return;
		this._remoteEditors.set(message.resourceId, {
			tabId: message.tabId,
			epoch: message.epoch,
			at: message.at,
		});
		for (const listener of this._listeners) listener({resourceId: message.resourceId, editor: this.getRemoteEditor(message.resourceId)});
	}

	announceLease ({resourceId, epoch}) {
		this._remoteEditors.delete(resourceId);
		this._channel.postMessage({
			type: "lease_claimed",
			tabId: this._tabId,
			resourceId,
			epoch,
			at: Date.now(),
		});
	}

	getRemoteEditor (resourceId) {
		const editor = this._remoteEditors.get(resourceId);
		return editor ? {...editor} : null;
	}

	onRemoteLease (listener) {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	close () {
		this._channel.close();
		this._listeners.clear();
	}
}
