import {HubApiClient} from "./hub-api-client.js";
import {HubBrewContext} from "./hub-brew-context.js";

export class HubCampaignContext {
	constructor ({campaignId, api = new HubApiClient(), brewUtil = globalThis.BrewUtil2, session = null, context = null}) {
		if (typeof campaignId !== "string" || !campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._api = api;
		this._brewContext = new HubBrewContext({brewUtil});
		// An already-verified session/context lets the caller activate without re-reading either.
		// Injecting only the session would still force a second context request, or would activate
		// brew before campaign metadata had been validated.
		this._session = session;
		this._injectedContext = context;
		this._context = null;
		this._isDisposed = false;
	}

	get context () {
		return this._context ? structuredClone(this._context) : null;
	}

	get api () { return this._api; }

	get isDisposed () { return this._isDisposed; }

	async pActivate ({signal = null} = {}) {
		if (this._isDisposed) throw new Error(`This campaign context has been disposed.`);
		const session = this._session || await this._api.pGetSession({signal});
		if (!session.signedIn) throw new Error(`Sign in to open a campaign context.`);
		this._session = session;
		this._context = this._injectedContext || await this._api.pGetCampaignContext({campaignId: this._campaignId, signal});
		if (this._context.rulesVersion?.ruleDecision?.blocking) {
			const error = new Error(`Campaign rules are not compatible with this client.`);
			error.code = this._context.rulesVersion.ruleDecision.errors?.[0]?.code || "RULES_UNAVAILABLE";
			throw error;
		}
		if (this._context.brewBundle) {
			this._brewContext.activate({
				campaignId: this._campaignId,
				bundleHash: this._context.brewBundle.contentHash,
				brewDocs: this._context.brewBundle.content,
			});
		} else this._brewContext.clear();
		return this.context;
	}

	async pRefresh ({signal = null, fnIsCurrent = () => true} = {}) {
		if (this._isDisposed) throw new Error(`This campaign context has been disposed.`);
		const context = await this._api.pGetCampaignContext({campaignId: this._campaignId, signal});
		if (this._isDisposed || !fnIsCurrent()) return null;
		this._injectedContext = null;
		this._context = context;
		if (this._context.brewBundle) {
			this._brewContext.activate({
				campaignId: this._campaignId,
				bundleHash: this._context.brewBundle.contentHash,
				brewDocs: this._context.brewBundle.content,
			});
		} else this._brewContext.clear();
		return this.context;
	}

	/**
	 * Idempotent cleanup. Clears the campaign brew overlay only; personal, site, and prerelease
	 * content are never touched.
	 */
	dispose () {
		this._isDisposed = true;
		this._context = null;
		this._injectedContext = null;
		return this._brewContext.clear();
	}
}
