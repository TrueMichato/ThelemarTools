import {ACTIVE_CAMPAIGN_STATE_SELECTED} from "./hub-active-campaign-record.js";

const _LOCAL_VALUE = "__local__";

function _getCampaignName (campaigns, campaignId) {
	return campaigns.find(campaign => campaign.id === campaignId)?.name || "Campaign";
}

export function getCampaignAwareNavUrl ({href, campaignId, baseUrl}) {
	if (!href || href.startsWith("#")) return href;
	let url;
	let base;
	try {
		base = new URL(baseUrl);
		url = new URL(href, base);
	} catch {
		return href;
	}
	if (url.origin !== base.origin || !["http:", "https:"].includes(url.protocol)) return href;

	const page = url.pathname.split("/").pop()?.toLowerCase();
	if (!page?.endsWith(".html") || ["hub.html", "campaign.html"].includes(page)) return href;
	if (url.searchParams.get("local") === "1") return href;
	if (page === "charactersheet.html" && (url.searchParams.has("id") || url.searchParams.get("hubCharacter") === "1")) return href;

	if (campaignId) url.searchParams.set("hubCampaign", campaignId);
	else url.searchParams.delete("hubCampaign");

	const isRootRelative = href.startsWith("/");
	const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(href);
	if (isAbsolute) return url.href;
	const path = isRootRelative ? url.pathname : url.pathname.replace(/^\//, "");
	return `${path}${url.search}${url.hash}`;
}

export function decorateCampaignNavigationLinks ({container, campaignId, baseUrl = globalThis.location?.href}) {
	if (!container || !baseUrl) return;
	for (const anchor of container.querySelectorAll("a[href]")) {
		if (anchor.hasAttribute("download") || anchor.target === "_blank") continue;
		const original = anchor.dataset.hubCampaignOriginalHref || anchor.getAttribute("href");
		anchor.dataset.hubCampaignOriginalHref = original;
		anchor.setAttribute("href", getCampaignAwareNavUrl({href: original, campaignId, baseUrl}));
	}
}

export class HubActiveCampaignSwitcher {
	constructor ({
		coordinator,
		pListCampaigns,
		getOpenSelectionUrl = null,
		getExplicitLocalUrl = null,
	}) {
		this._coordinator = coordinator;
		this._pListCampaigns = pListCampaigns;
		this._getOpenSelectionUrl = getOpenSelectionUrl;
		this._getExplicitLocalUrl = getExplicitLocalUrl;
		this._campaigns = [];
		this._container = null;
		this._variant = "site";
		this._unsubscribe = null;
		this._campaignsAccountId = null;
		this._campaignsGeneration = 0;
	}

	async pRender ({container, variant = "site"}) {
		if (!container) return;
		this._container = container;
		this._variant = variant;
		this._campaigns = [];
		this._campaignsAccountId = this._coordinator.accountId;
		const generation = ++this._campaignsGeneration;
		this._unsubscribe?.();
		this._unsubscribe = this._coordinator.subscribe(snapshot => this._handleCoordinatorSnapshot(snapshot));
		this._render();
		await this._pRefreshCampaigns({accountId: this._campaignsAccountId, generation});
	}

	_handleCoordinatorSnapshot (snapshot) {
		const accountId = snapshot.accountId || null;
		if (accountId !== this._campaignsAccountId) {
			this._campaignsAccountId = accountId;
			this._campaigns = [];
			const generation = ++this._campaignsGeneration;
			if (accountId) void this._pRefreshCampaigns({accountId, generation});
		}
		this._render();
	}

	async _pRefreshCampaigns ({accountId, generation}) {
		if (!accountId) return;
		try {
			const campaigns = (await this._pListCampaigns())
				.filter(campaign => campaign.status === "active" && campaign.role)
				.sort((a, b) => a.name.localeCompare(b.name));
			if (
				generation !== this._campaignsGeneration
				|| accountId !== this._campaignsAccountId
				|| accountId !== this._coordinator.accountId
			) return;
			this._campaigns = campaigns;
			this._render();
		} catch {
			// The coordinator state remains authoritative. A failed roster refresh must not
			// manufacture a local fallback or discard the selected campaign.
		}
	}

	dispose () {
		this._campaignsGeneration++;
		this._campaigns = [];
		this._campaignsAccountId = null;
		this._unsubscribe?.();
		this._unsubscribe = null;
		this._container = null;
	}

	_getSelectedValue () {
		const stored = this._coordinator.storedSelection;
		if (stored?.state === ACTIVE_CAMPAIGN_STATE_SELECTED) return stored.campaignId;
		if (stored) return _LOCAL_VALUE;
		return this._coordinator.pendingCampaignId || this._coordinator.activeCampaignId || _LOCAL_VALUE;
	}

	_getStatusText () {
		const state = this._coordinator.state;
		const stored = this._coordinator.storedSelection;
		const selectedId = stored?.state === ACTIVE_CAMPAIGN_STATE_SELECTED ? stored.campaignId : null;
		switch (state) {
			case "unresolved":
			case "validating":
			case "activating":
				return "Checking campaign context...";
			case "deactivating":
				return "Removing previous campaign context...";
			case "offline_unverified":
				return "Offline; saved campaign context was not applied.";
			case "blocked":
				return "Campaign unavailable; private context was not applied.";
			case "signed_out":
				return "Local mode; sign in to use campaigns.";
			case "switch_pending":
				return selectedId
					? `${_getCampaignName(this._campaigns, selectedId)} selected for new pages; this resource stays pinned.`
					: "Local mode selected for new pages; this resource stays pinned.";
			case "active":
				return `Active campaign: ${_getCampaignName(this._campaigns, this._coordinator.activeCampaignId)}.`;
			default:
				return "Local mode; no campaign context is applied.";
		}
	}

	_render () {
		if (!this._container) return;
		const selectedValue = this._getSelectedValue();
		const currentIds = new Set(this._campaigns.map(campaign => campaign.id));
		const selectedName = selectedValue === _LOCAL_VALUE
			? "Local / no campaign"
			: _getCampaignName(this._campaigns, selectedValue);
		const campaigns = currentIds.has(selectedValue) || selectedValue === _LOCAL_VALUE
			? this._campaigns
			: [{id: selectedValue, name: selectedName, status: "active", role: "member"}, ...this._campaigns];

		const wrapper = document.createElement("div");
		wrapper.className = `hub-context-switcher hub-context-switcher--${this._variant}`;
		wrapper.dataset.state = this._coordinator.state;

		const label = document.createElement("label");
		label.className = "sr-only";
		label.textContent = "Active campaign context";

		const select = document.createElement("select");
		select.className = "hub-context-switcher__select";
		select.setAttribute("aria-label", "Active campaign context");
		select.disabled = ["unresolved", "validating", "activating", "deactivating"].includes(this._coordinator.state)
			|| !this._coordinator.accountId;
		select.append(new Option("Local / no campaign", _LOCAL_VALUE));
		for (const campaign of campaigns) select.append(new Option(campaign.name, campaign.id));
		select.value = selectedValue;
		select.addEventListener("change", async () => {
			select.disabled = true;
			if (select.value === _LOCAL_VALUE) await this._coordinator.pSwitchToLocal();
			else await this._coordinator.pSwitchTo({campaignId: select.value});
			this._render();
		});

		const status = document.createElement("span");
		status.className = "hub-context-switcher__status";
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		status.textContent = this._getStatusText();

		wrapper.append(label, select, status);
		const explicitLocalUrl = this._getExplicitLocalUrl?.();
		if (explicitLocalUrl) {
			const link = document.createElement("a");
			link.className = "hub-context-switcher__open";
			link.href = explicitLocalUrl;
			link.textContent = "Open local";
			wrapper.append(link);
		}
		if (this._coordinator.state === "switch_pending") {
			const openUrl = this._getOpenSelectionUrl?.({
				campaignId: selectedValue === _LOCAL_VALUE ? null : selectedValue,
			});
			if (openUrl) {
				const link = document.createElement("a");
				link.className = "hub-context-switcher__open";
				link.href = openUrl;
				link.textContent = selectedValue === _LOCAL_VALUE ? "Go local" : "Open selected";
				wrapper.append(link);
			}
		}
		this._container.replaceChildren(wrapper);
	}
}
