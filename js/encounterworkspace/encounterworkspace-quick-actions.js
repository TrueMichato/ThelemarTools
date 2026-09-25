import {EncounterWorkspaceState, getEncounterEffectiveMonster} from "./encounterworkspace-state.js";

export class EncounterWorkspacePostSaveError extends Error {
	constructor (message, {cause} = {}) {
		super(message, {cause});
		this.isEncounterStatblockSaved = true;
	}
}

export class EncounterWorkspaceQuickActionsAdapter {
	constructor ({id, getState, pCommit}) {
		this._id = id;
		this._getState = getState;
		this._pCommit = pCommit;
		this._subscribers = new Set();
		this._isSaving = false;
		this.isPersistent = true;
	}

	_getInstance () {
		const instance = this._getState().instances.find(it => it.id === this._id);
		if (!instance) throw new Error("This encounter monster no longer exists.");
		return instance;
	}

	subscribe (fn) {
		this._subscribers.add(fn);
		return () => this._subscribers.delete(fn);
	}

	getOperations () {
		return structuredClone(this._getInstance().statblockOperations);
	}

	getOverride () {
		return getEncounterEffectiveMonster(this._getInstance());
	}

	getCreature () { return this.getOverride(); }

	async applyChanges ({addOperations = [], removeIds = []}) {
		if (this._isSaving) throw new Error("Wait for the current statblock edit to finish saving.");
		this._isSaving = true;
		try {
			const instance = this._getInstance();
			const normalized = addOperations.map(operation => ({
				...structuredClone(operation),
				id: operation.id || CryptUtil.uid(),
			}));
			const result = EncounterWorkspaceState.withStatblockChanges(this._getState(), [{
				id: instance.id,
				addOperations: normalized,
				removeIds,
			}]);
			if (!result.changedIds.length) return null;
			await this._pCommit(result);
			try {
				this._subscribers.forEach(fn => fn({type: "change", operations: this.getOperations(), creature: this.getOverride()}));
			} catch (e) {
				throw new EncounterWorkspacePostSaveError(
					`Statblock edit was saved, but the editor could not refresh: ${e.message}. Close and reopen the editor or reload this page.`,
					{cause: e},
				);
			}
			return normalized[0]?.id || true;
		} finally {
			this._isSaving = false;
		}
	}

	addOperation ({operation}) { return this.applyChanges({addOperations: [operation]}); }

	removeOperation ({operationId}) { return this.applyChanges({removeIds: [operationId]}); }

	clear () {
		return this.applyChanges({removeIds: this.getOperations().map(it => it.id)});
	}
}
