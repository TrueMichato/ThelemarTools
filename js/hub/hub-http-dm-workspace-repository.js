import {HubApiClient} from "./hub-api-client.js";

export class HubHttpDmWorkspaceRepository {
	canRemove = false;

	constructor ({campaignId, api = new HubApiClient()}) {
		if (typeof campaignId !== "string" || !campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._api = api;
		this._session = null;
		this._workspace = null;
		this._lease = null;
		this._pMutationQueue = Promise.resolve();
		this._conflictRecovery = null;
		this._pendingWrites = 0;
		this._recoveryStorage = globalThis.sessionStorage || null;
		this._recoveryVersion = 0;
		this._failedWrite = null;
		this._failedCommand = null;
		this._conflictBaseRevision = null;
		this._status = {state: "idle", error: null};
		this._statusListeners = new Set();
	}

	onStatus (listener) {
		this._statusListeners.add(listener);
		listener(this.getStatus());
		return () => this._statusListeners.delete(listener);
	}

	getStatus () {
		return {...this._status};
	}

	_setStatus (state, {error = null} = {}) {
		this._status = {state, error};
		for (const listener of this._statusListeners) listener(this.getStatus());
	}

	async _pEnsureSession () {
		this._session ||= await this._api.pGetSession();
		if (!this._session.signedIn) throw new Error(`Sign in to open a campaign DM workspace.`);
	}

	_getRecoveryKey () {
		const accountId = this._session?.account?.id;
		const workspaceId = this._workspace?.id;
		return accountId && workspaceId
			? `hub-dm-workspace-recovery:${this._campaignId}:${accountId}:${workspaceId}`
			: null;
	}

	_storeRecoveryDraft ({state, commandKey, recoveryVersion, baseRevision = this._workspace?.revision ?? null, baseState = this._workspace?.state ?? null}) {
		const recoveryKey = this._getRecoveryKey();
		try {
			if (recoveryKey) {
				this._recoveryStorage?.setItem(recoveryKey, JSON.stringify({
					version: recoveryVersion,
					baseRevision,
					baseState,
					state,
					commandKey,
				}));
			}
		} catch {
			// Recovery storage is best-effort; the live Board still holds the draft.
		}
		return recoveryKey;
	}

	async pGet () {
		this._setStatus("loading");
		try {
			await this._pEnsureSession();
			this._workspace = await this._api.pGetDmWorkspace({campaignId: this._campaignId});
			const pendingRecovery = this.getPendingRecovery();
			const recovery = this._failedWrite || pendingRecovery?.local;
			if (recovery) {
				this._failedWrite = structuredClone(recovery);
				if (pendingRecovery?.commandKey) this._failedCommand = {state: structuredClone(recovery), commandKey: pendingRecovery.commandKey};
				if (this._conflictRecovery) {
					this._setStatus("conflict");
				} else if (pendingRecovery?.baseRevision != null && pendingRecovery.baseRevision !== this._workspace.revision) {
					this._conflictBaseRevision = pendingRecovery.baseRevision;
					this._conflictRecovery = {
						local: structuredClone(recovery),
						server: structuredClone(this._workspace.state),
						serverRevision: this._workspace.revision,
					};
					this._setStatus("conflict");
				} else this._setStatus("ready");
				return structuredClone(recovery);
			}
			this._setStatus("ready");
			return structuredClone(this._workspace.state);
		} catch (error) {
			this._setStatus("error", {error});
			throw error;
		}
	}

	async pAcquireLease ({isTakeover = false} = {}) {
		if (!this._workspace) await this.pGet();
		this._lease = await this._api.pAcquireDmWorkspaceLease({
			campaignId: this._campaignId,
			workspaceId: this._workspace.id,
			isTakeover,
		});
		return structuredClone(this._lease);
	}

	pSet (state) {
		if (this._conflictRecovery) {
			this._conflictRecovery.local = structuredClone(state);
			const recoveryVersion = ++this._recoveryVersion;
			const isSameFailedState = this._failedCommand
				&& JSON.stringify(this._failedCommand.state) === JSON.stringify(state);
			const commandKey = isSameFailedState ? this._failedCommand.commandKey : crypto.randomUUID();
			this._failedWrite = structuredClone(state);
			this._failedCommand = {state: structuredClone(state), commandKey};
			this._storeRecoveryDraft({
				state,
				commandKey,
				recoveryVersion,
				baseRevision: this._conflictBaseRevision ?? Math.max(0, (this._workspace?.revision ?? 1) - 1),
				baseState: this._conflictRecovery.server,
			});
			const error = new Error(`DM workspace conflict requires explicit resolution.`);
			error.code = "WORKSPACE_CONFLICT";
			error.recovery = this.getConflictRecovery();
			this._setStatus("conflict", {error});
			return Promise.reject(error);
		}
		this._setStatus("saving");
		this._pendingWrites++;
		const recoveryVersion = ++this._recoveryVersion;
		const isSameFailedState = this._failedCommand
			&& JSON.stringify(this._failedCommand.state) === JSON.stringify(state);
		const commandKey = isSameFailedState ? this._failedCommand.commandKey : crypto.randomUUID();
		const recoveryKey = this._storeRecoveryDraft({state, commandKey, recoveryVersion});
		const pResult = this._pMutationQueue.then(
			() => this._pSet(state, commandKey),
			() => this._pSet(state, commandKey),
		);
		this._pMutationQueue = pResult.catch(() => {});
		let isSuccess = false;
		return pResult
			.then(out => {
				this._failedWrite = null;
				this._failedCommand = null;
				isSuccess = true;
				if (this._recoveryVersion === recoveryVersion) {
					try {
						if (recoveryKey) this._recoveryStorage?.removeItem(recoveryKey);
					} catch {
						// Recovery storage cleanup is best-effort.
					}
				}
				return out;
			})
			.catch(error => {
				this._failedWrite = structuredClone(state);
				this._failedCommand = {state: structuredClone(state), commandKey};
				this._setStatus(error?.code === "WORKSPACE_CONFLICT" ? "conflict" : "error", {error});
				throw error;
			})
			.finally(() => {
				this._pendingWrites--;
				if (isSuccess && !this._pendingWrites && !this._conflictRecovery) this._setStatus("saved");
			});
	}

	async _pSet (state, commandKey) {
		if (this._conflictRecovery) {
			this._conflictRecovery.local = structuredClone(state);
			const conflict = new Error(`DM workspace conflict requires explicit resolution.`);
			conflict.code = "WORKSPACE_CONFLICT";
			conflict.recovery = this.getConflictRecovery();
			throw conflict;
		}
		if (!this._workspace) await this.pGet();
		let result;
		try {
			await this.pAcquireLease();
			result = await this._api.pWriteDmWorkspace({
				campaignId: this._campaignId,
				workspaceId: this._workspace.id,
				baseRevision: this._workspace.revision,
				leaseEpoch: this._lease.epoch,
				state,
				idempotencyKey: commandKey,
			});
		} catch (error) {
			if (!["REVISION_CONFLICT", "LEASE_FENCED", "LEASE_HELD", "LEASE_EXPIRED"].includes(error?.code)) throw error;
			this._conflictBaseRevision = this._workspace.revision;
			const server = await this._api.pGetDmWorkspace({campaignId: this._campaignId});
			this._conflictRecovery = {
				local: structuredClone(state),
				server: structuredClone(server.state),
				serverRevision: server.revision,
			};
			this._workspace = server;
			const conflict = new Error(`DM workspace changed on another device.`);
			conflict.code = "WORKSPACE_CONFLICT";
			conflict.recovery = this.getConflictRecovery();
			throw conflict;
		}
		this._workspace = result.workspace;
		return structuredClone(this._workspace.state);
	}

	async pRemove () {
		return false;
	}

	hasPendingWrites () {
		return this._pendingWrites > 0 || !!this._conflictRecovery || !!this._failedWrite;
	}

	getPendingRecovery () {
		if (this._conflictRecovery) return this.getConflictRecovery();
		try {
			const recoveryKey = this._getRecoveryKey();
			const raw = recoveryKey ? this._recoveryStorage?.getItem(recoveryKey) : null;
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return parsed.state
				? {local: parsed.state, baseRevision: parsed.baseRevision, baseState: parsed.baseState, commandKey: parsed.commandKey}
				: {local: parsed};
		} catch {
			return null;
		}
	}

	getConflictRecovery () {
		return this._conflictRecovery ? structuredClone(this._conflictRecovery) : null;
	}

	async pResolveConflict ({choice}) {
		if (!this._conflictRecovery) return this._workspace?.state || null;
		if (choice === "server") {
			this._conflictRecovery = null;
			this._conflictBaseRevision = null;
			this._failedWrite = null;
			this._failedCommand = null;
			this._recoveryVersion++;
			try {
				const recoveryKey = this._getRecoveryKey();
				if (recoveryKey) this._recoveryStorage?.removeItem(recoveryKey);
			} catch {
				// Recovery storage cleanup is best-effort.
			}
			this._setStatus("ready");
			return structuredClone(this._workspace.state);
		}
		if (choice !== "local") throw new TypeError(`Conflict choice must be "local" or "server".`);
		const local = structuredClone(this._conflictRecovery.local);
		this._conflictRecovery = null;
		this._conflictBaseRevision = null;
		await this.pAcquireLease({isTakeover: true});
		return this.pSet(local);
	}
}
