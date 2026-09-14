export class HubTransferResolutionKeys {
	constructor ({fnCreateKey = () => globalThis.crypto.randomUUID()} = {}) {
		this._fnCreateKey = fnCreateKey;
		this._keys = new Map();
	}

	_getRef ({campaignId, transferId, decision}) {
		return `${campaignId}\u0000${transferId}\u0000${decision}`;
	}

	get ({campaignId, transferId, decision}) {
		const ref = this._getRef({campaignId, transferId, decision});
		let key = this._keys.get(ref);
		if (!key) {
			key = this._fnCreateKey();
			this._keys.set(ref, key);
		}
		return key;
	}

	reconcilePending ({campaignId, pendingTransferIds}) {
		const pending = new Set(pendingTransferIds);
		const prefix = `${campaignId}\u0000`;
		for (const ref of this._keys.keys()) {
			if (!ref.startsWith(prefix)) continue;
			const transferId = ref.slice(prefix.length).split("\u0000", 1)[0];
			if (!pending.has(transferId)) this._keys.delete(ref);
		}
	}
}

export async function pResolveTransferAndRefresh ({pResolve, pRefresh}) {
	let resolution;
	try {
		resolution = await pResolve();
	} catch (resolutionError) {
		try {
			return {
				state: "resolution_failed_refreshed",
				resolutionError,
				refreshResult: await pRefresh(),
			};
		} catch (refreshError) {
			return {
				state: "resolution_failed_refresh_failed",
				resolutionError,
				refreshError,
			};
		}
	}

	try {
		return {
			state: "resolved_refreshed",
			resolution,
			refreshResult: await pRefresh(),
		};
	} catch (refreshError) {
		return {
			state: "resolved_refresh_failed",
			resolution,
			refreshError,
		};
	}
}
