import {HubApiClient} from "./hub-api-client.js";
import {HubBrewContext} from "./hub-brew-context.js";

export class HubCampaignContext {
	constructor ({campaignId, api = new HubApiClient(), brewUtil = globalThis.BrewUtil2}) {
		if (typeof campaignId !== "string" || !campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._api = api;
		this._brewContext = new HubBrewContext({brewUtil});
		this._context = null;
	}

	get context () {
		return this._context ? structuredClone(this._context) : null;
	}

	get api () { return this._api; }

	async pActivate () {
		const session = await this._api.pGetSession();
		if (!session.signedIn) throw new Error(`Sign in to open a campaign context.`);
		this._context = await this._api.pGetCampaignContext({campaignId: this._campaignId});
		if (this._context.brewBundle) {
			this._brewContext.activate({
				campaignId: this._campaignId,
				bundleHash: this._context.brewBundle.contentHash,
				brewDocs: this._context.brewBundle.content,
			});
		} else this._brewContext.clear();
		return this.context;
	}
}
