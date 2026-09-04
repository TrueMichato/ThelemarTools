const DM_ROLES = new Set(["dm", "co_dm"]);
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RESYNC_DELAY_MS = 100;

export class DmScreenHubController {
	constructor ({
		campaignId,
		api,
		document = globalThis.document,
		// Wrapped, not passed by reference: an unbound `globalThis.setTimeout` throws
		// "Illegal invocation" when called as a method on this controller.
		fnSetTimeout = (...args) => setTimeout(...args),
		fnClearTimeout = timer => clearTimeout(timer),
		staleAfterMs = DEFAULT_STALE_AFTER_MS,
		resyncDelayMs = DEFAULT_RESYNC_DELAY_MS,
		pOnAuthoritativeAccessError = null,
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
		this._pOnAuthoritativeAccessError = pOnAuthoritativeAccessError;

		this._campaign = null;
		this._board = null;
		this._repository = null;
		this._realtime = null;
		this._staleTimer = null;
		this._resyncTimer = null;
		this._partyInventoryTimer = null;
		// Monotonic per-request sequence. Two refreshes in the same generation can resolve out
		// of order (a slow earlier request landing after a fast later one), which would leave
		// the older weight on screen forever. Only a response at least as new as the newest
		// already applied may publish.
		this._partyInventoryRequestSeq = 0;
		this._partyInventoryAppliedSeq = 0;
		this._isSyncStale = false;
		// Monotonic generation. Every in-flight party-inventory request carries the value it
		// started under; `detach()` and each load/attach bump it, so a response that arrives
		// after teardown or after the campaign changed is discarded instead of publishing.
		this._generation = 0;
		// The last known stash weight summary, cached so `attach()` can publish it even when
		// the fetch resolved before a Board existed. Held in memory only — linked stash truth
		// is never written to Board state or localStorage.
		this._partyInventory = {state: "loading", stackCount: 0, knownWeight: 0, unknownStackCount: 0};
		// Set once authorization is lost, which is permanent for this generation: unlike a
		// transient network failure there is nothing to retry until a new verified attach.
		this._isPartyInventoryFenced = false;
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

	/**
	 * Apply an already-verified session and campaign without issuing any request.
	 *
	 * The active-context coordinator validates session and campaign once, so the controller must
	 * not re-read either; doing so previously cost the DM bootstrap two duplicate `GET /api/session`
	 * calls. All access-state and render behaviour is identical to `pLoadCampaign`.
	 */
	adoptVerifiedCampaign ({session, campaign}) {
		if (!session?.signedIn) {
			this._setAccessState({
				access: "signed_out",
				message: "Sign in to open this campaign DM workspace.",
			});
			return null;
		}

		this._campaign = campaign;
		if (this._campaign?.status !== "active") {
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
		// Started, not awaited: campaign access must not block on the stash. The result is
		// cached and republished by `attach()`, so it does not matter whether this resolves
		// before or after the Board exists.
		//
		// Deliberately here rather than in `pLoadCampaign()`: `dmscreen.js` adopts an
		// already-verified campaign through this method directly and never calls
		// `pLoadCampaign()`, so the fetch would otherwise never fire on the real DM bootstrap.
		this._isPartyInventoryFenced = false;
		void this.pRefreshPartyInventory();
		this._syncBodyState();
		this._render();
		return this.campaign;
	}

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

			const campaign = await this._api.pGetCampaign({campaignId: this._campaignId});
			return this.adoptVerifiedCampaign({session, campaign});
		} catch (error) {
			this._setAccessError(error);
			return null;
		}
	}

	attach ({board, repository, realtime, fnRetryWorkspace = null}) {
		// `detach()` bumps the generation, so anything in flight from a previous attachment
		// is already fenced by the time the new one is wired up.
		this.detach();
		this._isPartyInventoryFenced = false;
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
		// `dmscreen.js` calls `pLoadCampaign()` BEFORE the Board exists, so a fetch started
		// there has nowhere to publish. Publishing the cached summary here makes the ordering
		// irrelevant and handles re-attach for free.
		this._publishPartyInventory();
		// The load-time fetch is fenced by the `detach()` above, so if it had not already
		// produced a summary, start a fresh one now that this attachment owns the Board.
		// Without this the initial fetch would be discarded every time, because `attach()`
		// always follows `pLoadCampaign()`.
		if (this._partyInventory.state !== "known") void this.pRefreshPartyInventory();
		this._render();
	}

	detach () {
		for (const unsubscribe of this._unsubscribers.splice(0)) unsubscribe?.();
		this._clearStaleTimer();
		this._clearResyncTimer();
		this._clearPartyInventoryTimer();
		// Invalidate in-flight requests as well as pending timers: without this a fetch that
		// completes after teardown would publish onto a Board this controller no longer owns.
		this._generation++;
		this._board = null;
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
		if (this._isAuthoritativeAccessError(error)) {
			this._setAccessError(error);
			void this._pOnAuthoritativeAccessError?.(error);
			return;
		}
		this._state.workspace = "error";
		this._setAccessState({
			access: "unavailable",
			message: this._getErrorMessage(error, "The private DM workspace could not be loaded. Reload when the service is available."),
		});
	}

	handleRealtimeError (error) {
		if (this._isAuthoritativeAccessError(error)) {
			this._setAccessError(error);
			void this._pOnAuthoritativeAccessError?.(error);
			return;
		}
		this._state.sync = "stale";
		this._state.message = this._getErrorMessage(error, "Live party updates are unavailable. The private workspace remains open.");
		this._publishBoardStatus();
		this._render();
	}

	_isAuthoritativeAccessError (error) {
		return [401, 403, 404].includes(error?.status)
			|| [
				"AUTH_REQUIRED",
				"UNAUTHENTICATED",
				"FORBIDDEN",
				"CAMPAIGN_NOT_FOUND",
				"MEMBERSHIP_NOT_FOUND",
				"CAMPAIGN_ARCHIVED",
			].includes(error?.code);
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
		if (error?.code === "CAMPAIGN_ARCHIVED") {
			this._setAccessState({
				access: "archived",
				message: "This campaign is archived. Its live DM workspace is no longer available.",
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

	_notifyAuthoritativeAccessLoss (error) {
		if (this._pOnAuthoritativeAccessError) {
			void this._pOnAuthoritativeAccessError(error);
			return;
		}
		void this._pRevalidateAccess();
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
			// The stash is campaign-private and must leave the board with the projections. A
			// demoted co-DM otherwise keeps a live aggregate of a campaign they can no longer
			// read, and an in-flight response could republish it seconds later. Bumping the
			// generation fences those responses; the explicit publish replaces the number with
			// `unavailable` rather than leaving the last known weight on screen.
			this._clearPartyInventoryTimer();
			this._generation++;
			this._isPartyInventoryFenced = true;
			this._partyInventory = {state: "unavailable", stackCount: 0, knownWeight: 0, unknownStackCount: 0};
			this._publishPartyInventory();
		}
		this._syncBodyState();
		this._publishBoardStatus();
		this._render();
	}

	_handleWorkspaceStatus ({state, error} = {}) {
		if (!state) return;
		this._state.workspace = state;
		if (state === "error") {
			if (this._isAuthoritativeAccessError(error)) {
				this._setAccessError(error);
				this._notifyAuthoritativeAccessLoss(error);
				return;
			}
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
				this._notifyAuthoritativeAccessLoss(Object.assign(
					new Error(reason || "Campaign access changed."),
					{code: "FORBIDDEN", status: 403},
				));
				return;
			default:
				return;
		}
		this._publishBoardStatus();
		this._render();
	}

	_handleCampaignEvent (event) {
		if (event?.type === "rules.activated") void this._pRefreshCampaignContext({rulesVersionId: event.aggregateId});
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
			"party_inventory.invalidated",
			"transfer.reserved",
			"transfer.committed",
			"transfer.rejected",
			"transfer.cancelled",
			// Activating a rules version or a brew bundle changes the carry BASIS without
			// touching any character document, so no character-scoped invalidation is emitted.
			// Without these the server starts rejecting every stored carry summary while the
			// DM Screen keeps showing the last accepted numbers indefinitely.
			"rules.activated",
			"brew.activated",
		].includes(event?.type)) {
			this._queueProjectionResync();
		}

		if ([
			"party_inventory.invalidated",
			"transfer.committed",
			"transfer.rejected",
			"transfer.cancelled",
			"transfer.reserved",
		].includes(event?.type)) {
			this._queuePartyInventoryResync();
		}
		if (event?.type === "campaign.archived") {
			this._setAccessState({
				access: "archived",
				message: "This campaign was archived. Return to the Campaign Hub for details.",
			});
			this._notifyAuthoritativeAccessLoss(Object.assign(
				new Error("Campaign archived."),
				{code: "CAMPAIGN_ARCHIVED", status: 409},
			));
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
			this._notifyAuthoritativeAccessLoss(Object.assign(
				new Error("Campaign role no longer grants DM access."),
				{code: "DM_ROLE_REQUIRED", status: 403},
			));
		}
	}

	async _pRefreshCampaignContext ({rulesVersionId = null} = {}) {
		const generation = ++this._generation;
		try {
			const context = await this._api.pGetCampaignContext({campaignId: this._campaignId});
			if (generation !== this._generation || !this._board) return false;
			if (rulesVersionId && context?.rulesVersion?.id !== rulesVersionId) return false;
			if (context?.rulesVersion?.ruleDecision?.blocking) {
				this._board?.setHubCampaignContext?.(null);
				return false;
			}
			this._board.setHubCampaignContext?.(context);
			return true;
		} catch {
			if (generation === this._generation) this._board?.setHubCampaignContext?.(null);
			return false;
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

	_clearPartyInventoryTimer () {
		if (this._partyInventoryTimer == null) return;
		this._fnClearTimeout(this._partyInventoryTimer);
		this._partyInventoryTimer = null;
	}

	/**
	 * Coalesce party-inventory invalidations into a single refetch, mirroring
	 * {@link _queueProjectionResync}. A burst of transfers produces one request.
	 */
	_queuePartyInventoryResync () {
		if (this._isPartyInventoryFenced) return;
		this._clearPartyInventoryTimer();
		this._partyInventoryTimer = this._fnSetTimeout(() => {
			this._partyInventoryTimer = null;
			void this.pRefreshPartyInventory();
		}, this._resyncDelayMs);
	}

	/**
	 * Fetch the shared party stash and cache a WEIGHT SUMMARY of it.
	 *
	 * Only aggregate weight is kept and broadcast — never the item list. The Party Tracker
	 * needs the total to show party carrying load; it has no use for the contents, and not
	 * carrying them keeps the surface (and the blast radius) minimal.
	 */
	async pRefreshPartyInventory () {
		if (!this._campaignId || this._isPartyInventoryFenced) return;
		const generation = this._generation;
		const campaignId = this._campaignId;
		const seq = ++this._partyInventoryRequestSeq;
		/** A response may publish only if it is current AND not superseded by a newer one. */
		const isStale = () => generation !== this._generation
			|| campaignId !== this._campaignId
			|| seq <= this._partyInventoryAppliedSeq;
		try {
			const partyInventory = await this._api.pGetPartyInventory({campaignId});
			// Discard a response that lost its race: the controller was detached, re-attached,
			// or pointed at a different campaign while this request was in flight.
			if (isStale()) return;
			const inventory = Array.isArray(partyInventory?.inventory) ? partyInventory.inventory : [];
			const summary = inventory.reduce((acc, entry) => {
				const quantity = Number(entry?.quantity);
				const unitWeight = Number(entry?.item?.weight);
				if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitWeight) || unitWeight < 0) acc.unknownStackCount++;
				else acc.knownWeight += quantity * unitWeight;
				return acc;
			}, {knownWeight: 0, unknownStackCount: 0});
			this._partyInventory = {
				state: "known",
				stackCount: inventory.length,
				knownWeight: summary.knownWeight,
				unknownStackCount: summary.unknownStackCount,
			};
		} catch (error) {
			if (isStale()) return;
			// Losing authorization is not a blip to retry: nothing will change until a new
			// verified attach/load, and retrying would hammer an endpoint that will keep
			// refusing. A transient failure stays retryable via the next invalidation.
			if (error?.status === 401 || error?.status === 403) this._isPartyInventoryFenced = true;
			this._partyInventory = {state: "unavailable", stackCount: 0, knownWeight: 0, unknownStackCount: 0};
		}
		this._partyInventoryAppliedSeq = seq;
		this._publishPartyInventory();
	}

	/** Broadcast the cached stash summary, if a Board is currently attached. */
	_publishPartyInventory () {
		if (!this._board) return;
		this._board.fireBoardEvent({type: "hubPartyInventory", payload: {...this._partyInventory}});
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
