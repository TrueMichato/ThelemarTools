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

	_applyContext (context) {
		if (context.rulesVersion?.ruleDecision?.blocking) {
			const error = new Error(`Campaign rules are not compatible with this client.`);
			error.code = context.rulesVersion.ruleDecision.errors?.[0]?.code || "RULES_UNAVAILABLE";
			throw error;
		}
		this._context = context;
		if (context.brewBundle) {
			this._brewContext.activate({
				campaignId: this._campaignId,
				bundleHash: context.brewBundle.contentHash,
				brewDocs: context.brewBundle.content,
			});
		} else this._brewContext.clear();
		return this.context;
	}

	async pActivate ({signal = null} = {}) {
		if (this._isDisposed) throw new Error(`This campaign context has been disposed.`);
		const session = this._session || await this._api.pGetSession({signal});
		if (!session.signedIn) throw new Error(`Sign in to open a campaign context.`);
		this._session = session;
		const context = this._injectedContext || await this._api.pGetCampaignContext({campaignId: this._campaignId, signal});
		return this._applyContext(context);
	}

	async pRefresh ({
		signal = null,
		fnIsCurrent = () => true,
		expectedRulesVersionId,
		expectedBrewBundleVersionId,
	} = {}) {
		if (this._isDisposed) throw new Error(`This campaign context has been disposed.`);
		this.clear();
		const context = await this._api.pGetCampaignContext({campaignId: this._campaignId, signal});
		if (this._isDisposed || !fnIsCurrent()) return null;
		if (
			(expectedRulesVersionId !== undefined && (context?.rulesVersion?.id ?? null) !== expectedRulesVersionId)
			|| (expectedBrewBundleVersionId !== undefined && (context?.brewBundle?.id ?? null) !== expectedBrewBundleVersionId)
		) {
			const error = new Error(`Campaign context did not resolve to the expected active versions.`);
			error.code = "CAMPAIGN_CONTEXT_STALE";
			throw error;
		}
		this._injectedContext = null;
		return this._applyContext(context);
	}

	clear () {
		if (this._isDisposed) return false;
		this._context = null;
		this._injectedContext = null;
		return this._brewContext.clear();
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
