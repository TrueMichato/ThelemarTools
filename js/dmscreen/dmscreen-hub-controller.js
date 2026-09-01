const DM_ROLES = new Set(["dm", "co_dm"]);
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RESYNC_DELAY_MS = 100;

export class DmScreenHubController {
	constructor ({
		campaignId,
		api,
		document = globalThis.document,
		fnSetTimeout = globalThis.setTimeout,
		fnClearTimeout = globalThis.clearTimeout,
		staleAfterMs = DEFAULT_STALE_AFTER_MS,
		resyncDelayMs = DEFAULT_RESYNC_DELAY_MS,
	}) {
		if (!campaignId) throw new TypeError(`campaignId is required.`);
		if (!api) throw new TypeError(`api is required.`);

		this._campaignId = campaignId;
		this._api = api;
		this._document = document;
		this._fnSetTimeout = fnSetTimeout;
		this._fnClearTimeout = fnClearTimeout;
		this._staleAfterMs = staleAfterMs;
		this._resyncDelayMs = resyncDelayMs;

		this._campaign = null;
		this._board = null;
		this._repository = null;
		this._realtime = null;
		this._staleTimer = null;
		this._resyncTimer = null;
		this._isSyncStale = false;
		this._unsubscribers = [];
		this._fnRetryWorkspace = null;
		this._state = {
			access: "loading",
			sync: "connecting",
			workspace: "loading",
			linkedCharacterCount: 0,
			lastSyncedAt: null,
			message: null,
		};
		this._render();
	}

	get campaign () { return this._campaign ? structuredClone(this._campaign) : null; }
	get isBlocked () { return this._state.access !== "ready"; }
	getState () { return structuredClone(this._state); }

	async pLoadCampaign () {
		try {
			const session = await this._api.pGetSession();
			if (!session?.signedIn) {
				this._setAccessState({
					access: "signed_out",
					message: "Sign in to open this campaign DM workspace.",
				});
				return null;
			}

			this._campaign = await this._api.pGetCampaign({campaignId: this._campaignId});
			if (this._campaign.status !== "active") {
				this._setAccessState({
					access: "archived",
					message: "This campaign is archived. Its live DM workspace is no longer available.",
				});
				return null;
			}
			if (!DM_ROLES.has(this._campaign.role)) {
				this._setAccessState({
					access: "permission_denied",
					message: "Only the campaign DM or a co-DM can open this private workspace.",
				});
				return null;
			}

			this._state.access = "ready";
			this._state.message = null;
			this._syncBodyState();
			this._render();
			return this.campaign;
		} catch (error) {
			this._setAccessError(error);
			return null;
		}
	}

	attach ({board, repository, realtime, fnRetryWorkspace = null}) {
		this.detach();
		this._board = board;
		this._repository = repository;
		this._realtime = realtime;
		this._fnRetryWorkspace = fnRetryWorkspace;

		if (repository?.onStatus) {
			this._unsubscribers.push(repository.onStatus(status => this._handleWorkspaceStatus(status)));
		}
		if (realtime?.on) {
			this._unsubscribers.push(realtime.on("state", state => this._handleRealtimeState(state)));
			this._unsubscribers.push(realtime.on("event", event => this._handleCampaignEvent(event)));
			// A resync baseline now carries only a cursor and cache-invalidation refs, so the
			// projections themselves are refetched over HTTP.
			this._unsubscribers.push(realtime.on("cursor", () => this._queueProjectionResync()));
		}

		this._publishBoardStatus();
		this._render();
	}

	detach () {
		for (const unsubscribe of this._unsubscribers.splice(0)) unsubscribe?.();
		this._clearStaleTimer();
		this._clearResyncTimer();
	}

	/**
	 * Fetch linked characters through the authorization-scoped HTTP projector. This is the
	 * only way projections reach the DM Screen — the realtime socket carries invalidation
	 * metadata, never character data.
	 */
	async pRefreshProjections () {
		if (!this._campaignId) return;
		try {
			const result = await this._api.pListCampaignCharacterProjections({campaignId: this._campaignId});
			this.applySnapshot({characters: result?.projections || [], roster: result?.roster || []});
		} catch (error) {
			this.handleRealtimeError(error);
		}
	}

	applySnapshot (snapshot) {
		const characters = snapshot?.characters || [];
		this._board?.fireBoardEvent({
			type: "hubCharacterProjections",
			payload: {characters, roster: snapshot?.roster || []},
		});
		this._state.sync = "live";
		this._isSyncStale = false;
		this._state.linkedCharacterCount = characters.length;
		this._state.lastSyncedAt = Date.now();
		this._state.message = null;
		this._clearStaleTimer();
		this._publishBoardStatus();
		this._render();
	}

	handleWorkspaceLoadError (error) {
		this._state.workspace = "error";
		this._setAccessState({
			access: "unavailable",
			message: this._getErrorMessage(error, "The private DM workspace could not be loaded. Reload when the service is available."),
		});
	}

	handleRealtimeError (error) {
		this._state.sync = "stale";
		this._state.message = this._getErrorMessage(error, "Live party updates are unavailable. The private workspace remains open.");
		this._publishBoardStatus();
		this._render();
	}

	_setAccessError (error) {
		if (error?.status === 401 || error?.code === "UNAUTHENTICATED") {
			this._setAccessState({
				access: "signed_out",
				message: "Your session expired. Sign in again to reopen this campaign workspace.",
			});
			return;
		}
		if (error?.status === 403 || error?.code === "FORBIDDEN") {
			this._setAccessState({
				access: "permission_denied",
				message: "You no longer have permission to open this private DM workspace.",
			});
			return;
		}
		if (error?.status === 404 || ["CAMPAIGN_NOT_FOUND", "MEMBERSHIP_NOT_FOUND"].includes(error?.code)) {
			this._setAccessState({
				access: "access_lost",
				message: "This campaign is unavailable or your membership was removed.",
			});
			return;
		}
		this._setAccessState({
			access: "unavailable",
			message: this._getErrorMessage(error, "Campaign services are unavailable. Your local DM Screen data was not opened or changed."),
		});
	}

	_setAccessState ({access, message}) {
		this._state.access = access;
		this._state.message = message;
		if (access !== "ready") {
			this._state.sync = "stopped";
			this._clearStaleTimer();
			// Losing access drops the roster too: a demoted co-DM must not keep a cached
			// broader projection or its owner attribution.
			this._clearResyncTimer();
			this._board?.fireBoardEvent({
				type: "hubCharacterProjections",
				payload: {characters: [], roster: []},
			});
		}
		this._syncBodyState();
		this._publishBoardStatus();
		this._render();
	}

	_handleWorkspaceStatus ({state, error} = {}) {
		if (!state) return;
		this._state.workspace = state;
		if (state === "error") {
			this._state.message = this._getErrorMessage(error, "The last workspace save failed. Your latest changes remain in this tab.");
		} else if (state === "conflict") {
			this._state.message = "This workspace changed on another device. Review which version to keep.";
		} else if (["ready", "saved"].includes(state) && this._state.access === "ready") {
			this._state.message = null;
		}
		this._publishBoardStatus();
		this._render();
	}

	_handleRealtimeState ({state, reason} = {}) {
		switch (state) {
			case "connecting":
				this._state.sync = "connecting";
				break;
			case "syncing":
				this._state.sync = this._isSyncStale ? "stale" : "syncing";
				break;
			case "live":
				this._state.sync = "live";
				this._isSyncStale = false;
				this._state.lastSyncedAt ||= Date.now();
				this._clearStaleTimer();
				break;
			case "reconnecting":
				this._state.sync = this._isSyncStale ? "stale" : "reconnecting";
				this._armStaleTimer();
				break;
			case "access_lost":
				this._setAccessState({
					access: "access_lost",
					message: reason || "Your session or campaign access changed. Reload or sign in again.",
				});
				void this._pRevalidateAccess();
				return;
			default:
				return;
		}
		this._publishBoardStatus();
		this._render();
	}

	_handleCampaignEvent (event) {
		if ([
			"character.created",
			"character.cloned",
			"character.archived",
			"character.moved",
			"character.moved_out",
			"character.reactivated",
			"character.projection.invalidated",
			"xp.granted",
			"item.granted",
			"action.applied",
			"transfer.reserved",
			"transfer.committed",
			"transfer.rejected",
			"transfer.cancelled",
		].includes(event?.type)) {
			this._queueProjectionResync();
		}
		if (event?.type === "campaign.archived") {
			this._setAccessState({
				access: "archived",
				message: "This campaign was archived. Return to the Campaign Hub for details.",
			});
			return;
		}
		if (
			event?.type === "membership.role_changed"
			&& event.aggregateId === this._campaign?.membershipId
			&& !DM_ROLES.has(event.payload?.role)
		) {
			this._setAccessState({
				access: "permission_denied",
				message: "Your campaign role changed, so this private DM workspace is now closed.",
			});
		}
	}

	async _pRevalidateAccess () {
		try {
			const session = await this._api.pGetSession();
			if (!session?.signedIn) {
				this._setAccessState({
					access: "signed_out",
					message: "Your session expired. Sign in again to reopen this campaign workspace.",
				});
				return;
			}
			const campaign = await this._api.pGetCampaign({campaignId: this._campaignId});
			this._campaign = campaign;
			if (campaign.status !== "active") {
				this._setAccessState({
					access: "archived",
					message: "This campaign is archived. Its live DM workspace is no longer available.",
				});
				return;
			}
			if (!DM_ROLES.has(campaign.role)) {
				this._setAccessState({
					access: "permission_denied",
					message: "Your campaign role no longer permits access to this private DM workspace.",
				});
				return;
			}
			this._setAccessState({
				access: "access_lost",
				message: "The live connection was closed by the server. Reload to safely reopen the workspace.",
			});
		} catch (error) {
			this._setAccessError(error);
		}
	}

	_armStaleTimer () {
		if (this._staleTimer != null || this._isSyncStale) return;
		this._staleTimer = this._fnSetTimeout(() => {
			this._staleTimer = null;
			if (!["reconnecting", "syncing"].includes(this._state.sync)) return;
			this._isSyncStale = true;
			this._state.sync = "stale";
			this._publishBoardStatus();
			this._render();
		}, this._staleAfterMs);
	}

	_clearStaleTimer () {
		if (this._staleTimer == null) return;
		this._fnClearTimeout(this._staleTimer);
		this._staleTimer = null;
	}

	/**
	 * Coalesce invalidations into a single scoped refetch. Repeated invalidations during
	 * the delay collapse into one request.
	 */
	_queueProjectionResync () {
		this._clearResyncTimer();
		this._resyncTimer = this._fnSetTimeout(() => {
			this._resyncTimer = null;
			void this.pRefreshProjections();
		}, this._resyncDelayMs);
	}

	_clearResyncTimer () {
		if (this._resyncTimer == null) return;
		this._fnClearTimeout(this._resyncTimer);
		this._resyncTimer = null;
	}

	_publishBoardStatus () {
		if (!this._board) return;
		this._board.fireBoardEvent({
			type: "hubCampaignStatus",
			payload: {
				campaignId: this._campaignId,
				campaignName: this._campaign?.name || "Campaign",
				role: this._campaign?.role || null,
				...this.getState(),
			},
		});
	}

	_syncBodyState () {
		const body = this._document?.body;
		if (!body) return;
		body.classList.toggle("dm-hub--blocked", this._state.access !== "ready");
		body.dataset.hubDmAccess = this._state.access;
	}

	_getErrorMessage (error, fallback) {
		return typeof error?.message === "string" && error.message
			? error.message
			: fallback;
	}

	_getSyncText () {
		const lastSynced = this._state.lastSyncedAt
			? new Date(this._state.lastSyncedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"})
			: null;
		switch (this._state.sync) {
			case "live": return `Live party sync · ${this._state.linkedCharacterCount} linked${lastSynced ? ` · ${lastSynced}` : ""}`;
			case "syncing": return "Syncing party data...";
			case "reconnecting": return `Reconnecting; showing data${lastSynced ? ` from ${lastSynced}` : " from the last sync"}`;
			case "stale": return `Connection delayed; data${lastSynced ? ` from ${lastSynced}` : ""} may be stale`;
			case "connecting": return "Connecting to live party data...";
			default: return "Live party sync stopped";
		}
	}

	_getWorkspaceText () {
		switch (this._state.workspace) {
			case "saving": return "Saving workspace...";
			case "saved": return "Workspace saved";
			case "ready": return "Workspace ready";
			case "conflict": return "Workspace conflict needs review";
			case "error": return "Workspace save needs retry";
			default: return "Loading private workspace...";
		}
	}

	_render () {
		const mount = this._document?.querySelector?.("#dm-screen-hub-status");
		if (!mount) return;
		mount.replaceChildren();

		const banner = this._document.createElement("section");
		banner.className = `dm-hub__banner dm-hub__banner--${this._state.access}`;
		banner.dataset.access = this._state.access;
		banner.setAttribute("aria-labelledby", "dm-screen-hub-title");
		banner.setAttribute("aria-live", "polite");

		const identity = this._document.createElement("div");
		identity.className = "dm-hub__identity";
		const eyebrow = this._document.createElement("span");
		eyebrow.className = "dm-hub__eyebrow";
		eyebrow.textContent = this._campaign?.role === "co_dm" ? "Co-DM workspace" : "Campaign DM workspace";
		const title = this._document.createElement("strong");
		title.id = "dm-screen-hub-title";
		title.className = "dm-hub__title";
		title.textContent = this._campaign?.name || "Campaign";
		identity.append(eyebrow, title);

		const status = this._document.createElement("div");
		status.className = "dm-hub__status";
		if (this._state.access === "ready") {
			const sync = this._document.createElement("span");
			sync.className = `dm-hub__status-pill dm-hub__status-pill--${this._state.sync}`;
			sync.textContent = this._getSyncText();
			const workspace = this._document.createElement("span");
			workspace.className = `dm-hub__status-pill dm-hub__status-pill--workspace-${this._state.workspace}`;
			workspace.textContent = this._getWorkspaceText();
			status.append(sync, workspace);
		} else {
			const access = this._document.createElement("span");
			access.className = "dm-hub__status-pill dm-hub__status-pill--blocked";
			access.textContent = this._state.message || (this._state.access === "loading"
				? "Checking campaign access..."
				: "Campaign workspace unavailable");
			status.append(access);
		}
		if (this._state.message && this._state.access === "ready") {
			const message = this._document.createElement("span");
			message.className = "dm-hub__message";
			message.textContent = this._state.message;
			status.append(message);
		}

		const actions = this._document.createElement("div");
		actions.className = "dm-hub__actions";
		const campaignLink = this._document.createElement("a");
		campaignLink.className = "ve-btn ve-btn-default ve-btn-xs";
		campaignLink.href = `campaign.html?id=${encodeURIComponent(this._campaignId)}`;
		campaignLink.textContent = "Return to campaign";
		actions.append(campaignLink);

		if (["error", "conflict"].includes(this._state.workspace) && this._fnRetryWorkspace) {
			const retry = this._document.createElement("button");
			retry.className = "ve-btn ve-btn-primary ve-btn-xs";
			retry.type = "button";
			retry.textContent = this._state.workspace === "conflict" ? "Review conflict" : "Retry save";
			retry.addEventListener("click", () => this._fnRetryWorkspace());
			actions.prepend(retry);
		}
		if (!["ready", "loading"].includes(this._state.access)) {
			const reload = this._document.createElement("button");
			reload.className = "ve-btn ve-btn-primary ve-btn-xs";
			reload.type = "button";
			reload.textContent = this._state.access === "signed_out" ? "Sign in again" : "Reload";
			reload.addEventListener("click", () => {
				const location = this._document.defaultView?.location || globalThis.location;
				if (this._state.access === "signed_out") {
					const returnTo = `${location.pathname}${location.search}`;
					location.assign(`/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`);
					return;
				}
				location.reload();
			});
			actions.prepend(reload);
		}

		banner.append(identity, status, actions);
		mount.append(banner);
	}
}
