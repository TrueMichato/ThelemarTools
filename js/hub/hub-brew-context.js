export class HubBrewContext {
	constructor ({brewUtil}) {
		if (!brewUtil?.setBrewTemporary || !brewUtil?.clearBrewTemporary) {
			throw new TypeError(`A brew utility with temporary-overlay support is required.`);
		}
		this._brewUtil = brewUtil;
		this._active = null;
	}

	getActiveContext () {
		return this._active ? {...this._active} : null;
	}

	activate ({campaignId, bundleHash, brewDocs}) {
		if (typeof campaignId !== "string" || !campaignId.trim()) throw new TypeError(`campaignId must be a non-empty string.`);
		if (typeof bundleHash !== "string" || !bundleHash.trim()) throw new TypeError(`bundleHash must be a non-empty string.`);
		if (!Array.isArray(brewDocs)) throw new TypeError(`brewDocs must be an array.`);

		const cacheKey = `${campaignId}::${bundleHash}`;
		const isChanged = this._brewUtil.setBrewTemporary(brewDocs, {cacheKey});
		this._active = {campaignId, bundleHash, cacheKey};
		return isChanged;
	}

	clear () {
		const isChanged = this._brewUtil.clearBrewTemporary();
		this._active = null;
		return isChanged;
	}
}
