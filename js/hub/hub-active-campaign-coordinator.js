import {
	isActiveCampaignUuid,
	isStrictlyGreaterActiveCampaignRecord,
	ACTIVE_CAMPAIGN_STATE_SELECTED,
} from "./hub-active-campaign-record.js";
import {HubActiveCampaignChannel, CLEAR_CAUSE_ACCESS_LOSS, CLEAR_CAUSE_LOGOUT, CLEAR_CAUSE_SELECTION} from "./hub-active-campaign-channel.js";
import {HubActiveCampaignStore} from "./hub-active-campaign-store.js";
import {HubCampaignContext} from "./hub-campaign-context.js";

/** Ordered teardown markers (ADR 0013). Each marker has exactly one owner. */
export const TEARDOWN_MARKERS = Object.freeze([
	"teardown-generation",
	"teardown-realtime",
	"teardown-projections",
	"teardown-rules",
	"teardown-brew",
]);

const ALLOWED_TRIGGERS = new Set([
	"startup", "explicit_url", "resource_canonical", "picker",
	"broadcast_channel", "storage_event", "logout", "access_loss", "retry",
]);
const ALLOWED_RESULTS = new Set(["success", "failure", "refused"]);
const ALLOWED_ERROR_CODES = new Set([
	"AUTH_REQUIRED", "FORBIDDEN", "CAMPAIGN_NOT_FOUND", "MEMBERSHIP_NOT_FOUND", "CAMPAIGN_ARCHIVED",
	"CAMPAIGN_ID_INVALID", "NETWORK_UNAVAILABLE", "REQUEST_ABORTED", "RESPONSE_INVALID",
	"REQUEST_FAILED", "TEARDOWN_FAILED", "UNSAFE_PENDING_WRITES",
]);

/** Keep telemetry cardinality bounded: an unexpected label degrades to `other`, never a raw id. */
function _boundedLabel (value, allowed) {
	if (value == null) return null;
	return allowed.has(value) ? value : "other";
}

/** Authoritative loss of general campaign access. Clears a selection naming that campaign. */
const GENERAL_ACCESS_LOSS_CODES = new Set(["FORBIDDEN", "CAMPAIGN_NOT_FOUND", "MEMBERSHIP_NOT_FOUND"]);
/** Failures that prove nothing about access, so the preference is retained for retry. */
const TRANSIENT_CODES = new Set(["NETWORK_UNAVAILABLE", "REQUEST_ABORTED", "RESPONSE_INVALID"]);

function _isTransient (error) {
	if (!error) return false;
	if (TRANSIENT_CODES.has(error.code)) return true;
	return Number.isInteger(error.status) && error.status >= 500;
}

/**
 * Device- and account-scoped active campaign context coordinator (ADR 0013).
 *
 * Owns precedence resolution, generation fencing, the ordered teardown protocol, resource-pin and
 * switch-preflight semantics, and same-browser convergence. Hosts supply narrow callbacks; the
 * coordinator never reaches into page internals itself.
 */
export class HubActiveCampaignCoordinator {
	constructor ({
		api,
		host = {},
		store = null,
		channel = null,
		fnObserve = null,
		fnNow = () => Date.now(),
		fnCreateContext = args => new HubCampaignContext(args),
	}) {
		if (!api) throw new TypeError(`api is required.`);
		this._api = api;
		this._host = host;
		this._store = store || new HubActiveCampaignStore();
		this._channel = channel || new HubActiveCampaignChannel({writerId: this._store.writerId});
		this._fnObserve = fnObserve;
		this._fnNow = fnNow;
		this._fnCreateContext = fnCreateContext;

		this._state = "unresolved";
		this._generation = 0;
		this._abort = null;
		this._session = null;
		this._accountId = null;
		this._activeCampaignId = null;
		this._campaignContext = null;
		this._pendingCampaignId = null;
		this._staleCompletionCount = 0;
		this._lastTeardownMarker = null;
		this._isDisposed = false;
		this._isSuspended = false;

		this._unsubscribeChannel = this._channel.onMessage(payload => {
			void this._pHandleRemote(payload);
		});
	}

	get state () { return this._state; }
	get accountId () { return this._accountId; }
	get activeCampaignId () { return this._activeCampaignId; }
	get pendingCampaignId () { return this._pendingCampaignId; }
	get staleCompletionCount () { return this._staleCompletionCount; }
	get lastTeardownMarker () { return this._lastTeardownMarker; }
	get campaignContext () { return this._campaignContext; }
	get storedSelection () { return this._accountId ? this._store.readForAccount(this._accountId) : null; }

	_setState (next, {trigger = "startup", result = "success", errorCode = null, startedAt = null} = {}) {
		const from = this._state;
		this._state = next;
		if (!this._fnObserve) return;
		// Bounded labels only: no campaign id, account id, name, URL, rules, or brew.
		this._fnObserve({
			name: "hub_active_context_transition",
			from,
			to: next,
			trigger: _boundedLabel(trigger, ALLOWED_TRIGGERS),
			result: _boundedLabel(result, ALLOWED_RESULTS),
			durationMs: startedAt == null ? null : Math.max(0, Math.trunc(this._fnNow() - startedAt)),
			errorCode: _boundedLabel(errorCode, ALLOWED_ERROR_CODES),
			requestId: null,
		});
	}

	/** Begin a new fenced operation; every older in-flight operation becomes stale. */
	_nextGeneration () {
		this._abort?.abort();
		this._abort = new AbortController();
		return ++this._generation;
	}

	_isCurrent (generation) {
		// A disposed coordinator has no current generation, so nothing may install state.
		if (!this._isDisposed && generation === this._generation) return true;
		++this._staleCompletionCount;
		return false;
	}

	// #region session

	async _pGetSession ({signal, isForceRefresh = false} = {}) {
		if (!isForceRefresh && this._session) return this._session;
		const session = await this._api.pGetSession({signal});
		this._session = session;
		return session;
	}

	/**
	 * Adopt the account from a session, clearing any record bound to a different account before a
	 * candidate is read. A signed-out session writes a tombstone for the record's own account.
	 */
	async _pAdoptAccount (session) {
		const accountId = session?.signedIn ? session.account?.id : null;
		if (!accountId || !isActiveCampaignUuid(accountId)) {
			const orphan = this._store.read();
			if (orphan && orphan.state === ACTIVE_CAMPAIGN_STATE_SELECTED) {
				const cleared = await this._store.pClear({accountId: orphan.accountId});
				this._channel.post(cleared, {cause: CLEAR_CAUSE_LOGOUT});
			}
			this._accountId = null;
			return null;
		}
		if (this._accountId && this._accountId !== accountId) this._store.reset();
		this._accountId = accountId;
		const stored = this._store.read();
		if (stored && stored.accountId !== accountId) {
			// A record for another account is treated as no selection and replaced through the same
			// mutation protocol, so the current account starts from a revision-1 tombstone.
			const cleared = await this._store.pClear({accountId});
			this._channel.post(cleared, {cause: CLEAR_CAUSE_LOGOUT});
		}
		return accountId;
	}

	// #endregion

	// #region validation paths

	/**
	 * Selection-only verification: session (reused) plus campaign metadata. Never fetches the
	 * campaign context or brew, so a lightweight page can keep a selection fresh cheaply.
	 */
	async pVerifySelection ({campaignId, signal = null} = {}) {
		if (!isActiveCampaignUuid(campaignId)) throw Object.assign(new Error(`Malformed campaign id.`), {code: "CAMPAIGN_ID_INVALID"});
		const session = await this._pGetSession({signal});
		if (!session?.signedIn) throw Object.assign(new Error(`Sign in required.`), {code: "AUTH_REQUIRED"});
		const campaign = await this._api.pGetCampaign({campaignId, signal});
		this._assertCampaignUsable(campaign);
		return {session, campaign};
	}

	/**
	 * Heavy verification: session (reused) plus campaign metadata and context in parallel. The
	 * context is injected into `HubCampaignContext`, so activation itself issues no request and
	 * brew is never activated before metadata has been validated.
	 */
	async pVerifyContext ({campaignId, signal = null} = {}) {
		if (!isActiveCampaignUuid(campaignId)) throw Object.assign(new Error(`Malformed campaign id.`), {code: "CAMPAIGN_ID_INVALID"});
		const session = await this._pGetSession({signal});
		if (!session?.signedIn) throw Object.assign(new Error(`Sign in required.`), {code: "AUTH_REQUIRED"});
		const [campaign, context] = await Promise.all([
			this._api.pGetCampaign({campaignId, signal}),
			this._api.pGetCampaignContext({campaignId, signal}),
		]);
		this._assertCampaignUsable(campaign);
		return {session, campaign, context};
	}

	_assertCampaignUsable (campaign) {
		if (!campaign) throw Object.assign(new Error(`Campaign unavailable.`), {code: "CAMPAIGN_NOT_FOUND"});
		if (campaign.status !== "active") throw Object.assign(new Error(`Campaign is archived.`), {code: "CAMPAIGN_ARCHIVED"});
		if (!campaign.role) throw Object.assign(new Error(`Membership required.`), {code: "MEMBERSHIP_NOT_FOUND"});
	}

	// #endregion

	// #region resolution

	/**
	 * Resolve context once at startup. Precedence: authoritative resource campaign, explicit URL,
	 * account-matching stored selection, then local mode. A malformed, forbidden, or archived
	 * explicit candidate blocks that navigation rather than falling through to a stored campaign.
	 */
	async pResolve ({trigger = "startup", session: seededSession = null} = {}) {
		if (this._isDisposed) return this._state;
		const generation = this._nextGeneration();
		const signal = this._abort.signal;
		const startedAt = this._fnNow();

		try {
			// A host that has already completed its session bootstrap seeds it here, so resolution
			// never issues a duplicate `GET /api/session`.
			if (seededSession) this._session = seededSession;
			const session = seededSession || await this._pGetSession({signal, isForceRefresh: true});
			if (!this._isCurrent(generation)) return this._state;
			const accountId = await this._pAdoptAccount(session);
			if (!this._isCurrent(generation)) return this._state;
			if (!accountId) {
				this._setState("signed_out", {trigger, startedAt});
				return this._state;
			}

			const resourceCampaignId = await this._host.pGetResourceCampaignId?.();
			if (!this._isCurrent(generation)) return this._state;

			const explicitCampaignId = this._host.getExplicitCampaignId?.() ?? null;
			const stored = this._store.readForAccount(accountId);

			let candidate = null;
			let candidateTrigger = trigger;
			let isExplicit = false;
			if (resourceCampaignId) {
				candidate = resourceCampaignId;
				candidateTrigger = "resource_canonical";
				isExplicit = true;
			} else if (explicitCampaignId != null) {
				candidate = explicitCampaignId;
				candidateTrigger = "explicit_url";
				isExplicit = true;
			} else if (stored?.state === ACTIVE_CAMPAIGN_STATE_SELECTED) {
				candidate = stored.campaignId;
			}

			if (!candidate) {
				this._setState("local", {trigger: candidateTrigger, startedAt});
				return this._state;
			}
			return await this._pValidateAndApply({campaignId: candidate, generation, signal, trigger: candidateTrigger, isExplicit, startedAt});
		} catch (error) {
			if (!this._isCurrent(generation)) return this._state;
			return this._pHandleFailure({error, trigger, startedAt, campaignId: null});
		}
	}

	async _pValidateAndApply ({campaignId, generation, signal, trigger, isExplicit, startedAt}) {
		this._setState("validating", {trigger, startedAt});
		// A host that only needs selection state must never trigger a context/brew fetch.
		const wantsContext = this._host.isContextHost !== false && this._host.shouldActivateContext?.({campaignId, isExplicit}) !== false;

		try {
			const verified = wantsContext
				? await this.pVerifyContext({campaignId, signal})
				: await this.pVerifySelection({campaignId, signal});
			if (!this._isCurrent(generation)) return this._state;

			await this._pPersistSelection({campaignId, generation});
			if (!this._isCurrent(generation)) return this._state;

			if (!wantsContext) {
				this._activeCampaignId = campaignId;
				this._host.onSelectionVerified?.({campaignId, campaign: verified.campaign});
				this._setState("active", {trigger, startedAt});
				return this._state;
			}

			this._setState("activating", {trigger, startedAt});
			await this._pActivateVerified({campaignId, verified, generation, signal});
			if (!this._isCurrent(generation)) return this._state;
			this._setState("active", {trigger, startedAt});
			return this._state;
		} catch (error) {
			if (!this._isCurrent(generation)) return this._state;
			return this._pHandleFailure({error, trigger, startedAt, campaignId});
		}
	}

	async _pActivateVerified ({campaignId, verified, generation, signal}) {
		const context = this._fnCreateContext({
			campaignId,
			api: this._api,
			session: verified.session,
			context: verified.context,
		});
		try {
			await context.pActivate({signal});
		} catch (error) {
			// Brew activation may have partially applied before throwing.
			context.dispose();
			throw error;
		}
		if (!this._isCurrent(generation)) {
			// A stale activation must not leave brew installed.
			context.dispose();
			return;
		}
		this._campaignContext = context;
		this._activeCampaignId = campaignId;
		try {
			await this._host.pOnContextActivated?.({campaignId, campaign: verified.campaign, context: context.context});
		} catch (error) {
			// The host installed rules partially; clear rules and brew rather than reporting
			// `blocked` with a half-applied context still live.
			await this._runTeardown(["teardown-rules", "teardown-brew"], {isFenceGeneration: false});
			this._activeCampaignId = null;
			throw error;
		}
	}

	/**
	 * Hand over a session and campaign the host has already fetched, so persisting a selection
	 * costs zero additional requests.
	 */
	async adoptVerified ({session, campaign}) {
		this._session = session || this._session;
		const accountId = await this._pAdoptAccount(this._session);
		if (!accountId || !campaign) return null;
		if (campaign.status !== "active" || !campaign.role) {
			// An archived or inaccessible explicit campaign must still invalidate a stored
			// selection naming it, even though this path bypasses `pResolve`.
			await this._pClearForAccessLoss({campaignId: campaign.id});
			this._setState("blocked", {trigger: "explicit_url", result: "failure", errorCode: campaign.status !== "active" ? "CAMPAIGN_ARCHIVED" : "MEMBERSHIP_NOT_FOUND"});
			return null;
		}
		const record = await this._pPersistSelection({campaignId: campaign.id});
		this._activeCampaignId = campaign.id;
		this._setState("active", {trigger: "explicit_url"});
		return record;
	}

	/**
	 * Classify a failure raised by a host that performed its own bootstrap, so an explicit
	 * candidate that turns out to be archived or inaccessible still invalidates a matching
	 * stored selection.
	 */
	async pReportFailure ({error, campaignId = null, trigger = "explicit_url", session = null}) {
		// Classification clears through the store, which needs an adopted account. On the
		// host-owned bootstrap paths (`campaign.html`, DM Screen) `pResolve` never ran, so
		// without this the clear would silently no-op.
		if (!this._accountId) await this._pAdoptAccount(session || this._session);
		return this._pHandleFailure({error, trigger, startedAt: null, campaignId});
	}

	async _pPersistSelection ({campaignId, generation = null}) {
		if (!this._accountId) return null;
		// The store mutation may wait on a Web Lock, so recheck the fence immediately before and
		// after: a stale writer must never land a higher revision over a newer clear or select.
		if (generation != null && !this._isCurrent(generation)) return null;
		const record = await this._store.pSelect({accountId: this._accountId, campaignId});
		if (generation != null && generation !== this._generation) {
			// A newer operation won while this write was in flight; do not advertise this record.
			return null;
		}
		this._channel.post(record);
		return record;
	}

	// #endregion

	// #region failure classification

	async _pHandleFailure ({error, trigger, startedAt, campaignId}) {
		const code = error?.code || "REQUEST_FAILED";
		if (_isTransient(error)) {
			// Transient failures prove nothing about access, so the preference is retained.
			this._setState(code === "REQUEST_ABORTED" ? this._state : "offline_unverified", {trigger, result: "failure", errorCode: code, startedAt});
			return this._state;
		}
		if (code === "AUTH_REQUIRED") {
			await this._pClearForAccessLoss({campaignId: null});
			this._setState("signed_out", {trigger, result: "failure", errorCode: code, startedAt});
			return this._state;
		}
		if (code === "CAMPAIGN_ARCHIVED" || GENERAL_ACCESS_LOSS_CODES.has(code)) {
			await this._pClearForAccessLoss({campaignId});
		}
		this._setState("blocked", {trigger, result: "failure", errorCode: code, startedAt});
		return this._state;
	}

	/**
	 * Clear only a selection that names the lost campaign.
	 *
	 * Runtime teardown happens only when the lost campaign is the one actually active, or when
	 * authentication itself is gone: a failed switch to an inaccessible B must not tear down a
	 * still-valid, still-open A.
	 */
	async _pClearForAccessLoss ({campaignId}) {
		if (this._accountId) {
			const stored = this._store.readForAccount(this._accountId);
			const isMatching = !campaignId || (stored?.state === ACTIVE_CAMPAIGN_STATE_SELECTED && stored.campaignId === campaignId);
			if (isMatching && stored?.state === ACTIVE_CAMPAIGN_STATE_SELECTED) {
				const cleared = await this._store.pClear({accountId: this._accountId});
				this._channel.post(cleared, {cause: CLEAR_CAUSE_ACCESS_LOSS});
			}
		}
		const isActiveContextLost = !campaignId || campaignId === this._activeCampaignId;
		if (isActiveContextLost) await this.pTeardown({reason: "access_loss"});
	}

	/**
	 * A DM-only surface losing its role does not prove general membership loss, so the device
	 * selection survives while the private surface closes.
	 */
	async pHandleSurfaceRoleLoss () {
		await this._runTeardown(["teardown-generation", "teardown-realtime", "teardown-projections"]);
		this._setState("blocked", {trigger: "access_loss", result: "failure", errorCode: "FORBIDDEN"});
		return this.storedSelection;
	}

	// #endregion

	// #region teardown

	async _runTeardown (markers, {isFenceGeneration = true} = {}) {
		let failure = null;
		for (const marker of markers) {
			try {
				switch (marker) {
					case "teardown-generation":
						// A committed switch already fenced when it began; bumping again here would
						// invalidate the switch's own generation and skip `activate-next`.
						if (isFenceGeneration) {
							this._abort?.abort();
							++this._generation;
						}
						this._host.onFenceGeneration?.();
						break;
					case "teardown-realtime":
						await this._host.pTeardownRealtime?.();
						break;
					case "teardown-projections":
						await this._host.pTeardownProjections?.();
						break;
					case "teardown-rules":
						await this._host.pTeardownRules?.();
						break;
					case "teardown-brew":
						this._campaignContext?.dispose();
						this._campaignContext = null;
						await this._host.pTeardownBrew?.();
						break;
				}
				this._lastTeardownMarker = marker;
			} catch (error) {
				// Attempt the remaining cleanup, but never activate the next campaign.
				failure = failure || error;
			}
		}
		return failure;
	}

	/** Full ordered teardown. Idempotent; safe to call when nothing is active. */
	async pTeardown ({reason = "switch", isFenceGeneration = true} = {}) {
		this._setState("deactivating", {trigger: reason});
		const failure = await this._runTeardown(TEARDOWN_MARKERS, {isFenceGeneration});
		this._activeCampaignId = null;
		if (failure) {
			this._setState("blocked", {trigger: reason, result: "failure", errorCode: failure?.code || "TEARDOWN_FAILED"});
			return false;
		}
		return true;
	}

	// #endregion

	// #region switching

	/**
	 * Switch to a new campaign. A resource-pinned host adopts the device selection but keeps its
	 * open resource; a switchable host must pass write-safety preflight before any teardown runs.
	 */
	async pSwitchTo ({campaignId, trigger = "picker", isPersistSelection = true} = {}) {
		if (this._isDisposed) return this._state;
		if (!isActiveCampaignUuid(campaignId)) {
			this._setState("blocked", {trigger, result: "failure", errorCode: "CAMPAIGN_ID_INVALID"});
			return this._state;
		}
		if (campaignId === this._activeCampaignId) return this._state;

		this._pendingCampaignId = campaignId;
		if (this._host.isResourcePinned?.()) {
			// The new default is recorded and surfaced, but the open resource keeps its own context.
			this._setState("switch_pending", {trigger});
			this._host.onPendingSelection?.({campaignId});
			return this._state;
		}

		const preflight = await this._host.pPreflightSwitch?.({campaignId});
		if (preflight && preflight.safe === false) {
			this._setState("switch_pending", {trigger, result: "refused", errorCode: preflight.reason || "UNSAFE_PENDING_WRITES"});
			this._host.onPendingSelection?.({campaignId});
			return this._state;
		}

		const generation = this._nextGeneration();
		const signal = this._abort.signal;
		const startedAt = this._fnNow();
		// A switch must honour the same activation gate as startup resolution: a host may accept a
		// new device default for selection purposes while refusing to activate its context,
		// because its repository, realtime, and URL are bound to the campaign it was opened with.
		const wantsContext = this._host.isContextHost !== false
			&& this._host.shouldActivateContext?.({campaignId, isExplicit: false}) !== false;
		let verified;
		try {
			verified = wantsContext
				? await this.pVerifyContext({campaignId, signal})
				: await this.pVerifySelection({campaignId, signal});
		} catch (error) {
			if (!this._isCurrent(generation)) return this._state;
			return this._pHandleFailure({error, trigger, startedAt, campaignId});
		}
		if (!this._isCurrent(generation)) return this._state;

		if (!wantsContext) {
			// Adopt the device default without disturbing the open resource or its context.
			if (isPersistSelection) await this._pPersistSelection({campaignId, generation});
			this._pendingCampaignId = campaignId;
			this._setState("switch_pending", {trigger, startedAt});
			this._host.onPendingSelection?.({campaignId});
			return this._state;
		}

		if (!await this.pTeardown({reason: trigger, isFenceGeneration: false})) return this._state;

		this._setState("activating", {trigger, startedAt});
		try {
			if (this._host.isContextHost === false) this._activeCampaignId = campaignId;
			else await this._pActivateVerified({campaignId, verified, generation, signal});
			if (!this._isCurrent(generation)) return this._state;
			// A switch adopted from another tab is already durable at its own revision; writing a
			// fresh higher revision here would be a redundant write and a latent broadcast loop.
			if (isPersistSelection) await this._pPersistSelection({campaignId, generation});
			this._pendingCampaignId = null;
			this._setState("active", {trigger, startedAt});
		} catch (error) {
			return this._pHandleFailure({error, trigger, startedAt, campaignId});
		}
		return this._state;
	}

	/** Clear the selection immediately, before any logout request is issued. */
	async pClearSelection ({trigger = "logout"} = {}) {
		// Fence first so an in-flight select cannot land a higher revision over this tombstone.
		this._nextGeneration();
		if (this._accountId) {
			const cleared = await this._store.pClear({accountId: this._accountId});
			this._channel.post(cleared, {cause: CLEAR_CAUSE_LOGOUT});
		}
		await this.pTeardown({reason: trigger, isFenceGeneration: false});
		this._setState("signed_out", {trigger});
		return this._state;
	}

	// #endregion

	// #region same-browser synchronisation

	async _pHandleRemote (payload) {
		if (this._isDisposed || this._isSuspended) return;
		const observed = payload?.isStorageSignal ? this._store.read() : payload?.record;
		if (!observed) return;
		if (this._accountId && observed.accountId !== this._accountId) return;

		const previous = this._store.winner;
		const {winner, didRepairStorage} = await this._store.pAccept(observed);
		if (!winner) return;
		// Rebroadcast only after a repair physically raised storage, so tabs that saw only the
		// losing write converge. Repair never bumps the revision, so this terminates.
		if (didRepairStorage) this._channel.post(winner, {cause: payload?.cause});
		if (!isStrictlyGreaterActiveCampaignRecord(winner, previous)) return;

		if (winner.state !== ACTIVE_CAMPAIGN_STATE_SELECTED) {
			// A tombstone alone does not say *why* the selection was cleared. Logout and account
			// loss must always tear down, but a clear caused by losing access to some other
			// campaign must not dismantle an unrelated resource this tab still legitimately holds.
			const cause = payload?.cause || CLEAR_CAUSE_SELECTION;
			const isForcedTeardown = cause === CLEAR_CAUSE_LOGOUT
				|| !this._activeCampaignId
				|| !this._host.isResourcePinned?.();
			if (!isForcedTeardown) {
				this._pendingCampaignId = null;
				this._setState("switch_pending", {trigger: "broadcast_channel"});
				this._host.onPendingSelection?.({campaignId: null});
				return;
			}
			await this.pTeardown({reason: "broadcast_channel"});
			this._setState("local", {trigger: "broadcast_channel"});
			return;
		}
		if (winner.campaignId === this._activeCampaignId) return;
		await this.pSwitchTo({campaignId: winner.campaignId, trigger: "broadcast_channel", isPersistSelection: false});
	}

	// #endregion

	// #region lifecycle

	/** Persisted `pagehide`: stop synchronising, but retain context, rules, and brew. */
	suspend () {
		this._isSuspended = true;
	}

	/**
	 * Persisted `pageshow`: the session may have changed while the page was frozen, so a storage
	 * reread alone is insufficient — cross-account records are deliberately incomparable and would
	 * be ignored. Revalidate the account before trusting anything, and tear down fully on a
	 * signed-out or switched account before any resumed mutation is permitted.
	 */
	async pResume ({trigger = "startup"} = {}) {
		if (this._isDisposed) return this._state;
		this._isSuspended = false;
		const generation = this._nextGeneration();
		const signal = this._abort.signal;
		const previousAccountId = this._accountId;

		let session;
		try {
			session = await this._pGetSession({signal, isForceRefresh: true});
		} catch (error) {
			if (!this._isCurrent(generation)) return this._state;
			return this._pHandleFailure({error, trigger, startedAt: null, campaignId: null});
		}
		if (!this._isCurrent(generation)) return this._state;

		const accountId = session?.signedIn ? session.account?.id : null;
		if (!accountId || (previousAccountId && accountId !== previousAccountId)) {
			await this.pTeardown({reason: "access_loss"});
			this._session = session;
			await this._pAdoptAccount(session);
			this._setState(accountId ? "unresolved" : "signed_out", {trigger});
			if (accountId) return this.pResolve({trigger});
			return this._state;
		}

		await this._pAdoptAccount(session);
		const stored = this._store.readForAccount(accountId);
		// Route every same-account record through the normal comparison path, tombstones included:
		// a clear written by another tab while this page was frozen must tear down here too.
		if (stored) await this._pHandleRemote({record: stored, isStorageSignal: false});
		return this._state;
	}

	dispose () {
		if (this._isDisposed) return;
		this._isDisposed = true;
		// Fence as well as abort: a host callback or lock waiter may already have resolved, and
		// aborting alone would let it complete against the still-current generation.
		++this._generation;
		this._abort?.abort();
		this._unsubscribeChannel?.();
		this._channel.close();
		this._campaignContext?.dispose();
		this._campaignContext = null;
		this._store.reset();
	}

	// #endregion
}
