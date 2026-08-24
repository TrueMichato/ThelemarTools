import {copyJson} from "./hub-json-patch.js";
import {HubRepositoryError} from "./hub-character-repository.js";

function requireString (value, label) {
	if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
}

function getMutationId () {
	if (!globalThis.crypto?.randomUUID) throw new Error(`crypto.randomUUID is required for hub mutation IDs.`);
	return globalThis.crypto.randomUUID();
}

export class LocalDmWorkspaceRepository {
	canRemove = true;

	constructor ({storage, storageKey}) {
		if (!storage?.pGet || !storage?.pSet || !storage?.pRemove) throw new TypeError(`A StorageUtil-compatible backend is required.`);
		requireString(storageKey, "storageKey");
		this._storage = storage;
		this._storageKey = storageKey;
	}

	async pGet () {
		return copyJson(await this._storage.pGet(this._storageKey));
	}

	async pSet (state) {
		await this._storage.pSet(this._storageKey, copyJson(state));
		return copyJson(state);
	}

	async pRemove () {
		return this._storage.pRemove(this._storageKey);
	}
}

export class HubDmWorkspaceMemoryAuthority {
	constructor ({fnNow = () => Date.now(), leaseTtlMs = 30_000} = {}) {
		this._fnNow = fnNow;
		this._leaseTtlMs = leaseTtlMs;
		this._workspaces = new Map();
		this._leases = new Map();
		this._mutationResults = new Map();
	}

	createWorkspace ({workspaceId, campaignId, ownerMembershipId, state, mutationId}) {
		requireString(workspaceId, "workspaceId");
		requireString(campaignId, "campaignId");
		requireString(ownerMembershipId, "ownerMembershipId");
		requireString(mutationId, "mutationId");
		const mutationKey = `${workspaceId}::${mutationId}`;
		if (this._mutationResults.has(mutationKey)) return copyJson(this._mutationResults.get(mutationKey));
		if (this._workspaces.has(workspaceId)) throw new HubRepositoryError("ALREADY_EXISTS", `DM workspace "${workspaceId}" already exists.`);
		const workspace = {
			id: workspaceId,
			campaignId,
			ownerMembershipId,
			revision: 1,
			state: copyJson(state),
		};
		this._workspaces.set(workspaceId, workspace);
		this._mutationResults.set(mutationKey, copyJson(workspace));
		return copyJson(workspace);
	}

	getWorkspace ({workspaceId, membershipId}) {
		const workspace = this._getWorkspaceOrThrow(workspaceId);
		if (workspace.ownerMembershipId !== membershipId) {
			throw new HubRepositoryError("FORBIDDEN", `This DM workspace belongs to another membership.`);
		}
		return copyJson(workspace);
	}

	_getWorkspaceOrThrow (workspaceId) {
		const workspace = this._workspaces.get(workspaceId);
		if (!workspace) throw new HubRepositoryError("NOT_FOUND", `DM workspace "${workspaceId}" was not found.`);
		return workspace;
	}

	acquireLease ({workspaceId, membershipId, sessionId, isTakeover = false}) {
		requireString(sessionId, "sessionId");
		this.getWorkspace({workspaceId, membershipId});
		const now = this._fnNow();
		const current = this._leases.get(workspaceId);
		const isActive = current && current.expiresAt > now;
		if (isActive && current.sessionId !== sessionId && !isTakeover) {
			throw new HubRepositoryError("LEASE_HELD", `DM workspace is being edited by another session.`);
		}
		const isSameHolder = isActive && current.sessionId === sessionId;
		const lease = {
			workspaceId,
			membershipId,
			sessionId,
			epoch: isSameHolder ? current.epoch : (current?.epoch || 0) + 1,
			expiresAt: now + this._leaseTtlMs,
		};
		this._leases.set(workspaceId, lease);
		return copyJson(lease);
	}

	renewLease ({workspaceId, membershipId, sessionId, leaseEpoch}) {
		this.getWorkspace({workspaceId, membershipId});
		const lease = this._leases.get(workspaceId);
		if (!lease || lease.expiresAt <= this._fnNow()) throw new HubRepositoryError("LEASE_EXPIRED", `The DM workspace lease has expired.`);
		if (lease.sessionId !== sessionId || lease.membershipId !== membershipId || lease.epoch !== leaseEpoch) {
			throw new HubRepositoryError("LEASE_FENCED", `This editor no longer owns the DM workspace lease.`);
		}
		lease.expiresAt = this._fnNow() + this._leaseTtlMs;
		return copyJson(lease);
	}

	writeWorkspace ({
		workspaceId,
		membershipId,
		sessionId,
		leaseEpoch,
		baseRevision,
		state,
		mutationId,
	}) {
		requireString(mutationId, "mutationId");
		const mutationKey = `${workspaceId}::${mutationId}`;
		if (this._mutationResults.has(mutationKey)) return copyJson(this._mutationResults.get(mutationKey));

		const current = this.getWorkspace({workspaceId, membershipId});
		const lease = this._leases.get(workspaceId);
		if (!lease || lease.expiresAt <= this._fnNow()) throw new HubRepositoryError("LEASE_EXPIRED", `The DM workspace lease has expired.`);
		if (lease.sessionId !== sessionId || lease.membershipId !== membershipId || lease.epoch !== leaseEpoch) {
			throw new HubRepositoryError("LEASE_FENCED", `This editor no longer owns the DM workspace lease.`);
		}
		if (current.revision !== baseRevision) {
			throw new HubRepositoryError("REVISION_CONFLICT", `DM workspace revision has changed.`, {
				expected: baseRevision,
				actual: current.revision,
				workspace: current,
			});
		}

		const nxt = {...current, revision: current.revision + 1, state: copyJson(state)};
		this._workspaces.set(workspaceId, nxt);
		this._mutationResults.set(mutationKey, copyJson(nxt));
		return copyJson(nxt);
	}
}

export class HubDmWorkspaceRepository {
	canRemove = false;

	constructor ({authority, workspaceId, membershipId, sessionId, fnGetMutationId = null}) {
		if (!authority) throw new TypeError(`authority is required.`);
		[["workspaceId", workspaceId], ["membershipId", membershipId], ["sessionId", sessionId]]
			.forEach(([label, value]) => requireString(value, label));
		this._authority = authority;
		this._workspaceId = workspaceId;
		this._membershipId = membershipId;
		this._sessionId = sessionId;
		this._fnGetMutationId = fnGetMutationId || getMutationId;
		this._pMutationQueue = Promise.resolve();
		this._accepted = null;
		this._lease = null;
	}

	async pGet () {
		this._accepted = this._authority.getWorkspace({
			workspaceId: this._workspaceId,
			membershipId: this._membershipId,
		});
		return copyJson(this._accepted.state);
	}

	async pAcquireLease ({isTakeover = false} = {}) {
		this._lease = this._authority.acquireLease({
			workspaceId: this._workspaceId,
			membershipId: this._membershipId,
			sessionId: this._sessionId,
			isTakeover,
		});
		return copyJson(this._lease);
	}

	pSet (state, opts = {}) {
		const pResult = this._pMutationQueue.then(
			() => this._pSet(state, opts),
			() => this._pSet(state, opts),
		);
		this._pMutationQueue = pResult.catch(() => {});
		return pResult;
	}

	async _pSet (state, {mutationId = null} = {}) {
		if (!this._accepted) await this.pGet();
		if (!this._lease) await this.pAcquireLease();
		try {
			this._lease = this._authority.renewLease({
				workspaceId: this._workspaceId,
				membershipId: this._membershipId,
				sessionId: this._sessionId,
				leaseEpoch: this._lease.epoch,
			});
		} catch (error) {
			if (!(error instanceof HubRepositoryError) || error.code !== "LEASE_EXPIRED") throw error;
			const canonical = this._authority.getWorkspace({
				workspaceId: this._workspaceId,
				membershipId: this._membershipId,
			});
			if (canonical.revision !== this._accepted.revision) {
				throw new HubRepositoryError("REVISION_CONFLICT", `DM workspace changed while the edit lease was expired.`, {
					expected: this._accepted.revision,
					actual: canonical.revision,
					workspace: canonical,
				});
			}
			this._accepted = canonical;
			await this.pAcquireLease();
		}
		this._accepted = this._authority.writeWorkspace({
			workspaceId: this._workspaceId,
			membershipId: this._membershipId,
			sessionId: this._sessionId,
			leaseEpoch: this._lease.epoch,
			baseRevision: this._accepted.revision,
			state,
			mutationId: mutationId || this._fnGetMutationId(),
		});
		return copyJson(this._accepted.state);
	}

	async pRemove () {
		return false;
	}
}
