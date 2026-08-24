export class HubRollLogAdapter {
	constructor ({api, campaignId, getCharacterId = () => null}) {
		this._api = api;
		this._campaignId = campaignId;
		this._getCharacterId = getCharacterId;
	}

	pLog ({formula, total, context = null, visibility = "all_members", detail = {}}) {
		return this._api.pLogRoll({
			campaignId: this._campaignId,
			characterId: this._getCharacterId(),
			formula,
			total,
			context,
			visibility,
			detail,
			idempotencyKey: crypto.randomUUID(),
		});
	}
}
