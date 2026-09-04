import {HubApiClient} from "./hub-api-client.js";
import {HubActiveCampaignCoordinator} from "./hub-active-campaign-coordinator.js";
import {HubActiveCampaignChannel} from "./hub-active-campaign-channel.js";
import {HubActiveCampaignStore} from "./hub-active-campaign-store.js";
import {HubActiveCampaignSwitcher, decorateCampaignNavigationLinks} from "./hub-active-campaign-switcher.js";
import {HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT} from "./hub-capabilities.js";

function _getPageName (location = globalThis.location) {
	return location?.pathname?.split("/").pop()?.toLowerCase() || "";
}

function _isSurfaceOwnedContext (location) {
	return ["charactersheet.html", "dmscreen.html"].includes(_getPageName(location));
}

function _isSurfaceResourcePinned (location) {
	if (!_isSurfaceOwnedContext(location)) return false;
	const params = new URLSearchParams(location?.search || "");
	return !!params.get("hubCampaign") || params.get("hubCharacter") === "1";
}

function _getExplicitLocalUrl (location) {
	const page = _getPageName(location);
	if (!["charactersheet.html", "dmscreen.html"].includes(page)) return null;
	return `${page}?local=1`;
}

function _getOpenSelectionUrl ({campaignId, location}) {
	const page = _getPageName(location);
	if (!["charactersheet.html", "dmscreen.html"].includes(page)) return null;
	return campaignId
		? `${page}?hubCampaign=${encodeURIComponent(campaignId)}`
		: `${page}?local=1`;
}

export class HubSiteContext {
	constructor ({
		api = new HubApiClient(),
		storage = null,
		channel = null,
		document = globalThis.document,
		location = globalThis.location,
		target = globalThis,
	} = {}) {
		this._api = api;
		this._document = document;
		this._location = location;
		this._target = target;
		this._campaign = null;
		this._isStartupResolved = false;
		this._isReloadScheduled = false;
		this._isExplicitLocalSurface = _isSurfaceOwnedContext(location)
			&& new URLSearchParams(location?.search || "").get("local") === "1";
		this._switcher = null;
		this._coordinator = new HubActiveCampaignCoordinator({
			api,
			...(storage ? {store: new HubActiveCampaignStore({storage})} : {}),
			...(channel ? {channel} : {}),
			host: {
				requiredCapabilities: [HUB_CAPABILITY_ACTIVE_CAMPAIGN_CONTEXT],
				isContextHost: !_isSurfaceOwnedContext(location),
				isResourcePinned: () => _isSurfaceResourcePinned(location),
				isExplicitLocal: () => new URLSearchParams(location?.search || "").get("local") === "1",
				getExplicitCampaignId: () => new URLSearchParams(location?.search || "").get("hubCampaign"),
				onSelectionVerified: ({campaign}) => { this._campaign = campaign; },
				pOnContextActivated: async ({campaign, context}) => {
					this._campaign = campaign;
					globalThis.HubCampaignPageContext = Object.freeze({
						campaignId: campaign.id,
						campaignName: campaign.name,
						role: campaign.role,
						rulesVersion: context.rulesVersion || null,
						brewBundle: context.brewBundle
							? {
								id: context.brewBundle.id,
								version: context.brewBundle.version,
								contentHash: context.brewBundle.contentHash,
							}
							: null,
						// ADR 0015 does not yet define enforcement. Preserve advertised metadata
						// for consumers without inventing source or edition filtering here.
						sourcePolicy: context.sourcePolicy || null,
						editionPolicy: context.editionPolicy || null,
					});
					if (this._isStartupResolved) this._scheduleReload();
				},
				onFenceGeneration: () => {
					if (this._isExplicitLocalSurface) return;
					this._document.documentElement.dataset.hubContextSwitching = "true";
				},
				pTeardownProjections: async () => {
					if (this._isExplicitLocalSurface) return;
					for (const element of this._document.querySelectorAll("main, #pagecontent, #listcontainer")) {
						element.setAttribute("aria-hidden", "true");
						element.replaceChildren();
					}
				},
				pTeardownRules: async () => {
					globalThis.HubCampaignPageContext = null;
				},
			},
		});
		this._unsubscribe = this._coordinator.subscribe(snapshot => {
			if (this._navContainer) {
				const selected = snapshot.storedSelection?.state === "selected"
					? snapshot.storedSelection.campaignId
					: null;
				decorateCampaignNavigationLinks({
					container: this._navContainer,
					campaignId: selected,
				});
			}
			if (!this._isStartupResolved || this._isReloadScheduled) return;
			if (snapshot.state === "local" && !_isSurfaceOwnedContext(this._location)) this._scheduleReload();
		}, {isEmitCurrent: false});
	}

	get coordinator () { return this._coordinator; }
	get activeCampaign () { return this._campaign; }

	async pInit () {
		if (this._isExplicitLocalSurface) {
			await this._coordinator.pSwitchToLocal({
				trigger: "explicit_url",
				isPersistSelection: false,
			});
			// Explicit local mode has no account scope and must ignore BroadcastChannel/storage
			// selections from authenticated tabs for its entire lifetime.
			this._coordinator.suspend();
		} else {
			await this._coordinator.pResolve();
		}
		this._isStartupResolved = true;
		if (!this._isExplicitLocalSurface) this._bindLifecycle();
		return this;
	}

	_bindLifecycle () {
		if (this._isLifecycleBound) return;
		this._isLifecycleBound = true;
		this._target.addEventListener?.("pagehide", event => {
			if (event.persisted) this._coordinator.suspend();
			else this.dispose();
		});
		this._target.addEventListener?.("pageshow", event => {
			if (!event.persisted) return;
			void this._coordinator.pResume();
		});
		this._target.addEventListener?.("online", () => {
			if (this._coordinator.state !== "offline_unverified") return;
			if (this._coordinator.activeCampaignId) void this._coordinator.pRevalidate({trigger: "retry"});
			else void this._coordinator.pResolve({trigger: "retry"});
		});
	}

	_scheduleReload () {
		if (this._isReloadScheduled) return;
		this._isReloadScheduled = true;
		queueMicrotask(() => this._location?.reload());
	}

	async pRenderNavigation ({container}) {
		if (!container) return;
		this._navContainer = container;
		decorateCampaignNavigationLinks({
			container,
			campaignId: this._coordinator.storedSelection?.state === "selected"
				? this._coordinator.storedSelection.campaignId
				: null,
			baseUrl: this._location.href,
		});
		let switcherHost = container.querySelector(".hub-context-switcher-host");
		if (!switcherHost) {
			switcherHost = this._document.createElement("li");
			switcherHost.className = "hub-context-switcher-host";
			container.append(switcherHost);
		}
		this._switcher ||= new HubActiveCampaignSwitcher({
			coordinator: this._coordinator,
			pListCampaigns: () => this._api.pListCampaigns(),
			getOpenSelectionUrl: ({campaignId}) => _getOpenSelectionUrl({campaignId, location: this._location}),
			getExplicitLocalUrl: () => _getExplicitLocalUrl(this._location),
		});
		await this._switcher.pRender({container: switcherHost});
	}

	dispose () {
		this._switcher?.dispose();
		this._unsubscribe?.();
		this._coordinator.dispose();
	}
}

let _pInstance = null;

export function pInitHubSiteContext () {
	return _pInstance ||= new HubSiteContext().pInit();
}
