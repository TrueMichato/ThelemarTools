import {CharacterSheetState} from "./charactersheet-state.js";
import {CharacterSheetProgression} from "./charactersheet-progression.js";

class CharacterSheetRespecEngine {
	constructor ({page, state}) {
		this._page = page;
		this._liveState = state;
		this._originalSnapshot = null;
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._undoSnapshot = null;
		this._isDirty = false;
	}

	get state () { return this._candidateState || this._liveState; }
	get manifest () { return this._manifest; }
	get isDraftActive () { return !!this._candidateState; }
	get isDirty () { return this._isDirty; }
	get canUndo () { return !!this._undoSnapshot; }

	syncCleanDraft () {
		if (!this._candidateState) {
			this.begin();
			return true;
		}
		if (this._isDirty) return false;
		if (JSON.stringify(this._liveState.toJson()) === JSON.stringify(this._originalSnapshot)) return false;
		this.begin();
		return true;
	}

	begin () {
		this._originalSnapshot = this._liveState.toJson();
		this._candidateState = new CharacterSheetState();
		if (this._candidateState.loadFromJson(this._originalSnapshot) === false) {
			throw new Error("Could not initialize the Respec draft.");
		}
		this._candidateState.setClassFeatureCatalog?.(
			this._page.getClassFeatures?.() || [],
			this._page.getSubclassFeatures?.() || [],
			this._page.getOptionalFeatures?.() || [],
		);
		this._candidateState._onProgressionLedgerChange = () => this._setDirty();
		this._isDirty = false;
		this._originalManifest = CharacterSheetProgression.buildManifest({
			page: this._page,
			state: this._candidateState,
		});
		this._candidateState.initializeProgressionOwnership(this._originalManifest);
		this._candidateState.reconcileProgressionOwnership(this._originalManifest);
		this._manifest = this._originalManifest;
		this._candidateState.setProgressionManifest(this._manifest);
		return this._candidateState;
	}

	cancel () {
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._originalSnapshot = null;
		this._isDirty = false;
	}

	refreshManifest () {
		if (!this._candidateState) this.begin();
		this._manifest = CharacterSheetProgression.buildManifest({
			page: this._page,
			state: this._candidateState,
		});
		this._candidateState.initializeProgressionOwnership?.(this._manifest);
		this._candidateState.reconcileProgressionOwnership?.(this._manifest);
		this._candidateState.setProgressionManifest(this._manifest);
		return this._manifest;
	}

	markDirty () {
		this._setDirty();
		return this.refreshManifest();
	}

	_setDirty () {
		this._isDirty = true;
		this._undoSnapshot = null;
	}

	getDecision (decisionId) {
		return this._manifest?.decisions?.find(decision => decision.id === decisionId) || null;
	}

	updateDecisionSelection (decisionId, selection, {status = null} = {}) {
		const decision = this.getDecision(decisionId);
		if (!decision) throw new Error("That progression decision is no longer available.");
		const entry = this._candidateState.getLevelHistoryEntry(decision.characterLevel);
		const stored = entry?.decisions?.find(it => it.id === decisionId || it.semanticKey === decision.semanticKey);
		if (!stored) throw new Error("That progression decision could not be found in the draft ledger.");
		const updated = CharacterSheetProgression.normalizeDecision({
			...stored,
			selection: CharacterSheetProgression._copy(selection),
			status,
		}, entry);
		Object.assign(stored, updated);
		Object.assign(entry, CharacterSheetProgression.projectDecisionsToChoices(entry));
		this._setDirty();
		return this.refreshManifest();
	}

	getValidation () {
		if (!this._manifest) this.refreshManifest();
		const issues = [...(this._manifest?.issues || [])];
		for (const decision of this._manifest?.decisions || []) {
			if (decision.status === "resolved" || (!decision.required && decision.status === "deferred")) continue;
			if (!decision.required && !["invalid", "ambiguous"].includes(decision.status)) continue;
			issues.push({
				level: decision.characterLevel,
				severity: "error",
				code: `decision-${decision.status}`,
				decisionId: decision.id,
				message: `${decision.label} is ${decision.status}.`,
			});
		}
		return {
			issues,
			errors: issues.filter(issue => issue.severity === "error"),
			warnings: issues.filter(issue => issue.severity !== "error"),
			isValid: !issues.some(issue => issue.severity === "error"),
		};
	}

	getChangeSummary () {
		if (!this._candidateState || !this._originalSnapshot) return [];
		const before = new Map((this._originalManifest?.decisions || []).map(decision => [decision.semanticKey, decision]));
		const after = new Map((this._manifest?.decisions || []).map(decision => [decision.semanticKey, decision]));
		const keys = new Set([...before.keys(), ...after.keys()]);
		const changes = [];
		for (const key of keys) {
			const oldDecision = before.get(key);
			const newDecision = after.get(key);
			const oldValue = oldDecision?.selection ?? null;
			const newValue = newDecision?.selection ?? null;
			if (JSON.stringify(oldValue) === JSON.stringify(newValue)
				&& oldDecision?.characterLevel === newDecision?.characterLevel) continue;
			changes.push({
				semanticKey: key,
				label: newDecision?.label || oldDecision?.label || "Progression decision",
				level: newDecision?.characterLevel || oldDecision?.characterLevel || null,
				before: oldValue,
				after: newValue,
				status: newDecision ? (oldDecision ? "changed" : "added") : "removed",
			});
		}
		const candidate = this._candidateState.toJson();
		for (const [key, label] of [["race", "Species"], ["background", "Background"]]) {
			const oldValue = this._originalSnapshot[key] || null;
			const newValue = candidate[key] || null;
			if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
			changes.push({
				semanticKey: `base:${key}`,
				label,
				level: 0,
				before: oldValue,
				after: newValue,
				status: "changed",
			});
		}
		return changes;
	}

	async apply () {
		if (!this._candidateState) throw new Error("No Respec draft is active.");
		const validation = this.getValidation();
		if (!validation.isValid) {
			throw new Error(`Resolve ${validation.errors.length} required Respec item${validation.errors.length === 1 ? "" : "s"} before applying.`);
		}

		const beforeApply = this._liveState.toJson();
		if (JSON.stringify(beforeApply) !== JSON.stringify(this._originalSnapshot)) {
			throw new Error("The live character changed while this Respec draft was open. Cancel and reopen Respec to preserve those newer changes.");
		}
		const candidate = this._candidateState.toJson();
		if (this._liveState.loadFromJson(candidate) === false) throw new Error("The rebuilt character could not be loaded.");

		try {
			await this._page.saveCharacter();
			this._page.renderCharacter();
		} catch (error) {
			this._liveState.loadFromJson(beforeApply);
			throw error;
		}

		this._undoSnapshot = beforeApply;
		this._originalSnapshot = candidate;
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._isDirty = false;
		return true;
	}

	async undo () {
		if (!this._undoSnapshot) return false;
		const restore = this._undoSnapshot;
		const current = this._liveState.toJson();
		if (this._liveState.loadFromJson(restore) === false) throw new Error("The previous character snapshot could not be restored.");
		try {
			await this._page.saveCharacter();
			this._page.renderCharacter();
		} catch (error) {
			this._liveState.loadFromJson(current);
			throw error;
		}
		this._undoSnapshot = null;
		return true;
	}
}

export {CharacterSheetRespecEngine};
globalThis.CharacterSheetRespecEngine = CharacterSheetRespecEngine;
