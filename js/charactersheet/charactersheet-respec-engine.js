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
		this._preexistingPendingKeys = new Set();
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
		// Materialise any lazy compatibility queues before taking the baseline.
		// Otherwise a first manifest refresh could mistake an existing legacy
		// pending item for a mutation-created obligation.
		this._candidateState.getPendingFeatureChoices?.();
		this._candidateState.getPendingSpellChoices?.();
		this._preexistingPendingKeys = new Set(
			this._getPendingCompatibilityItems(this._candidateState).map(item => item.key),
		);
		this._originalManifest = CharacterSheetProgression.buildManifest({
			page: this._page,
			state: this._candidateState,
		});
		this._addPreexistingPendingWarnings(this._originalManifest);
		this._manifest = this._originalManifest;
		this._persistManifest();
		return this._candidateState;
	}

	cancel () {
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._originalSnapshot = null;
		this._isDirty = false;
		this._preexistingPendingKeys = new Set();
	}

	refreshManifest ({persist = true} = {}) {
		if (!this._candidateState) this.begin();
		this._manifest = CharacterSheetProgression.buildManifest({
			page: this._page,
			state: this._candidateState,
		});
		this._addPreexistingPendingWarnings(this._manifest);
		if (persist) this._persistManifest();
		return this._manifest;
	}

	_getPendingCompatibilityItems (state = this._candidateState) {
		const normalize = value => {
			if (Array.isArray(value)) return value.map(normalize);
			if (!value || typeof value !== "object") return value;
			return Object.fromEntries(Object.entries(value)
				.filter(([key]) => key !== "id")
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, normalize(item)]));
		};
		const make = (family, value) => {
			const normalized = normalize(value);
			return {
				family,
				value: normalized,
				key: `${family}:${JSON.stringify(normalized)}`,
				sourceDecisionKey: value?.sourceDecisionKey || value?.parentSemanticKey || null,
				label: value?.featureName || value?.featureId || value?.slotKey || family,
			};
		};
		return [
			...(state?._data?.pendingFeatureChoices || []).map(value => make("feature", value)),
			...(state?._data?.pendingSpellChoices || []).map(value => make("spell", value)),
		];
	}

	_addPreexistingPendingWarnings (manifest) {
		const represented = new Set((manifest?.decisions || []).flatMap(decision => [
			decision.semanticKey,
			decision.parentSemanticKey,
			decision.rootSemanticKey,
		]).filter(Boolean));
		for (const item of this._getPendingCompatibilityItems()) {
			if (represented.has(item.sourceDecisionKey) || !this._preexistingPendingKeys.has(item.key)) continue;
			manifest.issues.push({
				severity: "warning",
				code: "unknown-pending-choice",
				message: `Pre-existing ${item.label} pending choice is not represented by a Respec decision; it will be preserved until repaired.`,
				pendingKey: item.key,
			});
		}
	}

	_assertNoNewUnrepresentedPending (beforePending, manifest) {
		const beforeKeys = new Set(beforePending.map(item => item.key));
		const represented = new Set((manifest?.decisions || []).flatMap(decision => [
			decision.semanticKey,
			decision.parentSemanticKey,
			decision.rootSemanticKey,
		]).filter(Boolean));
		const unexpected = this._getPendingCompatibilityItems()
			.filter(item => !beforeKeys.has(item.key) && !represented.has(item.sourceDecisionKey));
		if (!unexpected.length) return;
		const labels = unexpected.map(item => item.label).join(", ");
		throw new Error(`The staged change created an unrepresented pending choice (${labels}); the mutation was rolled back.`);
	}

	_persistManifest () {
		if (!this._candidateState || !this._manifest) return false;
		// A degraded catalog has no trustworthy decisions, so persisting it would
		// erase the saved ledger and release progression-owned values before loading
		// finishes.  This applies to non-class catalogs too.
		const discoveryBlockingCodes = new Set([
			"missing-class-data",
			"missing-nested-reference",
			"missing-choice-catalog",
			"discovery-incomplete",
			"unsupported-required-choice",
			"unsupported-persisted-decision",
			"adapter-missing-editor",
			"adapter-missing-mechanics",
			"adapter-missing-reverse",
		]);
		const hasIncompleteClassDiscovery = (this._manifest.issues || [])
			.some(issue => discoveryBlockingCodes.has(issue.code))
			|| (this._manifest.levels || []).some(level => !level.classData);
		if (hasIncompleteClassDiscovery) return false;
		this._candidateState.initializeProgressionOwnership?.(this._manifest);
		this._candidateState.reconcileProgressionOwnership?.(this._manifest);
		this._candidateState.setProgressionManifest(this._manifest);
		return true;
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

	_getDecisionStore (decision) {
		if (decision?.scope === "origin") {
			const base = this._candidateState.getCharacterBase?.() || {};
			return {container: base, key: "decisions"};
		}
		const entry = this._candidateState.getLevelHistoryEntry(decision?.characterLevel);
		return {container: entry, key: "decisions"};
	}

	_removeDescendantDecisions (rootSemanticKey, keep = null) {
		const removeFrom = decisions => (decisions || []).filter(decision =>
			decision.semanticKey === keep
				|| (decision.semanticKey !== rootSemanticKey
					&& decision.rootSemanticKey !== rootSemanticKey
					&& decision.parentSemanticKey !== rootSemanticKey),
		);
		const base = this._candidateState.getCharacterBase?.();
		if (base?.decisions) base.decisions = removeFrom(base.decisions);
		for (const entry of this._candidateState.getLevelHistory?.() || []) {
			if (entry.decisions) entry.decisions = removeFrom(entry.decisions);
		}
	}

	_makeDecisionReceipt (decision, selection, state = this._candidateState) {
		const typeMap = {
			nestedSkill: "skills",
			nestedSkillTool: "skills",
			nestedExpertise: "expertise",
			nestedTool: "tools",
			nestedLanguage: "languages",
			nestedSave: "saves",
			nestedWeapon: "weapons",
			nestedArmor: "armor",
			nestedResistance: "resistances",
			nestedDamageType: "resistances",
			nestedSpell: "spells",
			nestedCantrip: "cantrips",
			skills: "skills",
			tools: "tools",
			expertise: "expertise",
			languages: "languages",
			knownSpells: "spells",
			preparedSpells: "spells",
			spellbookSpells: "spells",
			cantrips: "cantrips",
			preparedCantrips: "cantrips",
		};
		const ownershipType = typeMap[decision?.type];
		const values = selection == null ? [] : (Array.isArray(selection) ? selection : [selection]);
		const effects = [];
		if (["nestedAbility", "nestedConfiguration"].includes(decision?.type) && values.length) {
			const amount = Number(decision.meta?.descriptorRules?.amount) || 1;
			effects.push(...values.map(value => ({
				type: decision.type === "nestedAbility" ? "abilityDelta" : "configuration",
				sourceDecisionKey: decision.semanticKey,
				ability: decision.type === "nestedAbility" ? String(value) : undefined,
				amount: decision.type === "nestedAbility" ? amount : undefined,
				before: decision.type === "nestedAbility"
					? decision.meta?.receiptPreviousAbility?.[String(value || "").toLowerCase()]
					: undefined,
				value: decision.type === "nestedConfiguration" ? value : undefined,
			})));
		}
		if (ownershipType) {
			effects.push({
				type: "ownership",
				ownership: values.map(value => {
					if (decision.type !== "nestedSkillTool" || !value || typeof value !== "object") return {type: ownershipType, value};
					const kind = String(value.kind || "").toLowerCase();
					return {
						type: kind === "tool" ? "tools" : kind === "language" ? "languages" : "skills",
						value: value.value ?? value.name ?? value,
					};
				}),
			});
		}
		const materializedFeatures = (state?.getFeatures?.() || [])
			.filter(feature => feature.sourceDecisionKey === decision?.semanticKey)
			.map(feature => ({id: feature.id, name: feature.name, source: feature.source}));
		const materializedFeatureIds = new Set(materializedFeatures.map(feature => feature.id));
		const materializedModifiers = [
			...(state?._data?.modifiers || []),
			...(state?._data?.namedModifiers || []),
		]
			.filter(modifier => materializedFeatureIds.has(modifier.featureId) || modifier.sourceDecisionKey === decision?.semanticKey)
			.map(modifier => ({id: modifier.id, featureId: modifier.featureId, sourceDecisionKey: modifier.sourceDecisionKey}));
		const materializedResources = (state?.getResources?.() || [])
			.filter(resource => resource.sourceDecisionKey === decision?.semanticKey || materializedFeatureIds.has(resource.featureId))
			.map(resource => ({
				id: resource.id,
				name: resource.name,
				sourceDecisionKey: resource.sourceDecisionKey,
				featureId: resource.featureId,
			}));
		if (materializedFeatures.length || materializedModifiers.length || materializedResources.length) {
			effects.push({
				type: "materialized",
				features: materializedFeatures,
				modifiers: materializedModifiers,
				resources: materializedResources,
				spells: values
					.filter(value => value && typeof value === "object" && value.name)
					.map(value => ({name: value.name, source: value.source})),
			});
		}
		if (["nestedSpell", "nestedCantrip", "knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips"].includes(decision?.type) && values.length) {
			effects.push({
				type: "spells",
				spellType: ["nestedCantrip", "cantrips", "preparedCantrips"].includes(decision.type) ? "cantrips" : "spells",
				spells: values
					.filter(value => value && typeof value === "object" && value.name)
					.map(value => ({name: value.name, source: value.source})),
			});
		}
		return {
			version: 1,
			sourceDecisionKey: decision.semanticKey,
			effects,
		};
	}

	/**
	 * Stage one linked graph edit.  The snapshot is intentionally at the state
	 * boundary rather than just the ledger boundary: controller callbacks may
	 * materialise features, resources, or spells before a descriptor is refreshed.
	 */
	stageGraphMutation (decisionId, selection, {status = null, apply = null, reverseParent = false} = {}) {
		const decision = this.getDecision(decisionId);
		if (!decision) throw new Error("That progression decision is no longer available.");
		if (!this._candidateState) throw new Error("No Respec draft is active.");
		const stateSnapshot = this._candidateState.toJson();
		const manifestSnapshot = CharacterSheetProgression._copy(this._manifest);
		const pendingSnapshot = this._getPendingCompatibilityItems(this._candidateState);
		const {container} = this._getDecisionStore(decision);
		const stored = container?.decisions?.find(it => it.id === decisionId || it.semanticKey === decision.semanticKey)
			|| (container
				? (() => {
					const missing = CharacterSheetProgression.normalizeDecision({
						...decision,
						selection: null,
						status: "invalid",
						receipt: null,
					}, container);
					container.decisions = [...(container.decisions || []), missing];
					return missing;
				})()
				: null);
		if (!stored) throw new Error("That progression decision could not be found in the draft ledger.");
		try {
			const descendants = [];
			const pendingParents = [decision.semanticKey];
			const seenDescendants = new Set();
			while (pendingParents.length) {
				const parentSemanticKey = pendingParents.shift();
				for (const candidate of this._manifest.decisions || []) {
					if (candidate.semanticKey === decision.semanticKey
						|| candidate.parentSemanticKey !== parentSemanticKey
						|| seenDescendants.has(candidate.semanticKey)) continue;
					seenDescendants.add(candidate.semanticKey);
					descendants.push(candidate);
					pendingParents.push(candidate.semanticKey);
				}
			}
			descendants.sort((a, b) => Number(b.depth || 0) - Number(a.depth || 0));
			const descendantSnapshots = descendants.map(descendant => ({
				decision: CharacterSheetProgression._copy(descendant),
				selection: CharacterSheetProgression._copy(descendant.selection),
				status: descendant.status,
			}));
			// Descendant state cleanup is owned by the existing state/controller
			// handlers.  The ledger side is removed deepest-first before the parent
			// is written, preventing stale choices from surviving a replacement.
			for (const descendant of descendants) {
				this._candidateState.reverseProgressionDecisionReceipt?.(descendant);
				const ownerUid = descendant.provenance?.ownerUid || "";
				const [parentName, parentSource] = ownerUid.split("|");
				if (parentName) {
					this._candidateState.removeChosenSubfeature?.(parentName, {
						parentSource: parentSource || null,
						level: descendant.classLevel || descendant.characterLevel,
					});
				}

				const descendantStore = this._getDecisionStore(descendant).container;
				if (descendantStore?.decisions) {
					descendantStore.decisions = descendantStore.decisions
						.filter(item => item.semanticKey !== descendant.semanticKey);
				}
			}
			// Generic manifest editors do not have a legacy callback which
			// knows how to tear down the previous selection.  Consume the
			// parent's compact receipt before applying its replacement. Legacy
			// editors opt out because their callback performs the historical
			// teardown itself.
			if (reverseParent) this._candidateState.reverseProgressionDecisionReceipt?.(stored);
			const applyResult = typeof apply === "function"
				? apply({decision, stored, state: this._candidateState})
				: null;
			const effectiveSelection = applyResult && Object.prototype.hasOwnProperty.call(applyResult, "selection")
				? applyResult.selection
				: selection;
			const effectiveStatus = applyResult && Object.prototype.hasOwnProperty.call(applyResult, "status")
				? applyResult.status
				: status;
			const updated = CharacterSheetProgression.normalizeDecision({
				...stored,
				selection: CharacterSheetProgression._copy(effectiveSelection),
				status: effectiveStatus,
				receipt: this._makeDecisionReceipt(decision, effectiveSelection, this._candidateState),
			}, container);
			Object.assign(stored, updated);
			if (decision.scope !== "origin") Object.assign(container, CharacterSheetProgression.projectDecisionsToChoices(container));
			this._setDirty();
			const refreshed = this.refreshManifest({persist: false});
			// A parent replacement may leave some child identities legal (for
			// example, a recurring pool slot). Rehydrate only exact semantic
			// matches whose old selections are still present in the new catalog.
			const keyOf = value => typeof value === "string"
				? value.toLowerCase()
				: `${String(value?.name || value?.value || value?.choice || "").toLowerCase()}|${String(value?.source || "").toLowerCase()}`;
			for (const snapshot of descendantSnapshots) {
				const next = refreshed.decisions?.find(it => it.semanticKey === snapshot.decision.semanticKey);
				if (!next || snapshot.selection == null) continue;
				const selected = Array.isArray(snapshot.selection) ? snapshot.selection : [snapshot.selection];
				const legal = new Set((next.options || []).map(keyOf));
				if (selected.length !== next.count || selected.some(value => !legal.has(keyOf(value)))) continue;
				const nextStore = this._getDecisionStore(next).container;
				if (!nextStore?.decisions) continue;
				const nextStored = CharacterSheetProgression.normalizeDecision({
					...next,
					selection: snapshot.selection,
					status: snapshot.status,
					receipt: snapshot.decision.receipt,
				}, nextStore);
				const existing = nextStore.decisions.find(it => it.semanticKey === next.semanticKey);
				if (existing) Object.assign(existing, nextStored);
				else nextStore.decisions.push(nextStored);
				Object.assign(next, nextStored);
			}
			this._assertNoNewUnrepresentedPending(pendingSnapshot, this._manifest);
			this._persistManifest();
			return this._manifest;
		} catch (error) {
			this._candidateState.loadFromJson(stateSnapshot);
			this._manifest = manifestSnapshot;
			throw error;
		}
	}

	/**
	 * Run a legacy editor mutation inside the same candidate-state transaction
	 * boundary as linked decision edits. This is used for historical choice
	 * families which predate a manifest descriptor but still need atomic
	 * rollback and discovery refresh.
	 */
	async stageCandidateMutation (apply) {
		if (typeof apply !== "function") throw new Error("A candidate mutation callback is required.");
		if (!this._candidateState) throw new Error("No Respec draft is active.");
		const stateSnapshot = this._candidateState.toJson();
		const manifestSnapshot = CharacterSheetProgression._copy(this._manifest);
		const pendingSnapshot = this._getPendingCompatibilityItems(this._candidateState);
		try {
			const result = await apply({state: this._candidateState});
			this._setDirty();
			this.refreshManifest({persist: false});
			this._assertNoNewUnrepresentedPending(pendingSnapshot, this._manifest);
			return result;
		} catch (error) {
			this._candidateState.loadFromJson(stateSnapshot);
			this._manifest = manifestSnapshot;
			throw error;
		}
	}

	updateDecisionSelection (decisionId, selection, {status = null} = {}) {
		return this.stageGraphMutation(decisionId, selection, {status, reverseParent: true});
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
