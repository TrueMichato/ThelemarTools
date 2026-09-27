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
		this._candidateState.setItemMaterialCatalog?.(this._liveState.getItemMaterialCatalog?.() || []);
		this._candidateState.setDraconicResonanceCatalog?.(this._liveState.getDraconicResonanceCatalog?.() || []);
		this._candidateState.setSpellData?.(this._page.getSpells?.() || this._liveState._allSpells || []);
		this._candidateState.setClassCatalog?.(this._page.getClasses?.() || []);
		this._candidateState.setClassSummonTemplateCatalog?.(this._liveState.getClassSummonTemplateCatalog?.() || []);
		if (this._candidateState.loadFromJson(this._originalSnapshot) === false) {
			throw new Error("Could not initialize the Respec draft.");
		}
		this._candidateState.captureRespecSpecialtyBonusProvenance();
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
		this._addUnattributedSpecialtyModifierWarnings(this._manifest);
		if (persist) this._persistManifest();
		return this._manifest;
	}

	_addUnattributedSpecialtyModifierWarnings (manifest) {
		if (!this._originalManifest || !this._originalSnapshot) return;
		const originalFeatures = this._originalSnapshot.features || [];
		const knownFeatureIds = new Set(originalFeatures.map(feature => feature.id).filter(Boolean));
		const knownDecisionKeys = new Set((this._originalManifest.decisions || []).map(decision => decision.semanticKey));
		const candidateFeatureIds = new Set(this._candidateState.getFeatures().map(feature => feature.id));
		const candidateModifiers = this._candidateState.getNamedModifiers?.() || [];
		const selectionName = selection => {
			const value = Array.isArray(selection) ? selection[0] : selection;
			return value?.choice || value?.name || (typeof value === "string" ? value : null);
		};
		for (const before of this._originalManifest.decisions || []) {
			if (before.type !== "featureChoice"
				|| before.className !== "Barbarian"
				|| before.classSource !== "TGTT"
				|| ![1, 6].includes(Number(before.classLevel))
				|| before.sourceKey !== "Specialties") continue;
			const outgoingName = selectionName(before.selection);
			if (!["Unyielding Might", "Lead the Pack"].includes(outgoingName)) continue;
			const after = (manifest.decisions || []).find(decision => decision.semanticKey === before.semanticKey);
			const originalOwnerStillPresent = originalFeatures.some(feature =>
				feature.name === outgoingName
					&& feature.parentFeature === "Specialties"
					&& feature.className === "Barbarian"
					&& feature.classSource === "TGTT"
					&& Number(feature.acquisitionLevel || feature.level) === Number(before.classLevel)
					&& candidateFeatureIds.has(feature.id));
			if (!after || (selectionName(after.selection) === outgoingName
				&& (!this._isDirty || originalOwnerStillPresent))) continue;
			for (const modifier of this._originalSnapshot.namedModifiers || []) {
				if (modifier.name !== outgoingName
					|| !CharacterSheetClassUtils.isTgttBarbarianSpecialtySkillBonus(modifier)
					|| (modifier.sourceFeatureId && knownFeatureIds.has(modifier.sourceFeatureId))
					|| (modifier.sourceDecisionKey && knownDecisionKeys.has(modifier.sourceDecisionKey))
					|| !candidateModifiers.some(candidate => modifier.id
						? candidate.id === modifier.id
						: candidate.name === modifier.name && candidate.type === modifier.type
							&& candidate.value === modifier.value)) continue;
				manifest.issues.push({
					severity: "warning",
					code: "unattributed-specialty-modifier",
					level: before.characterLevel,
					message: `An unattributed "${outgoingName}" bonus to ${modifier.type.slice("skill:".length)}${modifier.enabled === false ? " (currently disabled)" : ""} was preserved because its owner cannot be proven. Review this named modifier after applying Respec; ${selectionName(after.selection) === outgoingName ? "remove it manually only if it is an unintended extra bonus." : "remove it manually if it belonged to the old Specialty."}`,
				});
			}
		}
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
				id: value?.id,
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

	_getRepresentedSkillChoice (item, manifest) {
		if (item.family !== "feature" || item.value?.kind !== "skill") return null;
		const feature = this._candidateState.getFeatures?.().find(candidate => candidate.id === item.value.featureId);
		if (!feature) return null;
		const levels = (manifest?.levels || []).filter(level =>
			level.className === feature.className
			&& Number(level.classLevel) === Number(feature.level)
			&& (level.features || []).some(entity =>
				CharacterSheetProgression._matchesFeatureEntity(feature, entity)),
		);
		if (levels.length !== 1) return null;
		const ownerUid = CharacterSheetProgression.getEntityUid(feature);
		const normalize = value => String((value?.value ?? value?.name ?? value) || "")
			.trim().toLowerCase().replace(/['\s]+/g, "");
		const pendingOptions = (item.value.options || []).map(normalize).sort();
		const matches = (manifest?.decisions || []).filter(decision => {
			if (decision.type !== "nestedSkill"
				|| CharacterSheetProgression._normalize(decision.provenance?.ownerUid) !== CharacterSheetProgression._normalize(ownerUid)
				|| decision.characterLevel !== levels[0].characterLevel
				|| decision.className !== feature.className
				|| Number(decision.classLevel) !== Number(feature.level)
				|| Number(decision.count) !== Number(item.value.count || 1)) return false;
			if (item.sourceDecisionKey && ![
				decision.semanticKey,
				decision.parentSemanticKey,
				decision.rootSemanticKey,
			].includes(item.sourceDecisionKey)) return false;
			const options = (decision.options || []).map(normalize).sort();
			return options.length === pendingOptions.length
				&& options.every((option, ix) => option === pendingOptions[ix]);
		});
		return matches.length === 1 ? matches[0] : null;
	}

	_assertNoNewUnrepresentedPending (beforePending, manifest) {
		const beforeKeys = new Set(beforePending.map(item => item.key));
		const represented = new Set((manifest?.decisions || []).flatMap(decision => [
			decision.semanticKey,
			decision.parentSemanticKey,
			decision.rootSemanticKey,
		]).filter(Boolean));
		const newPending = this._getPendingCompatibilityItems()
			.filter(item => !beforeKeys.has(item.key));
		const skillChoices = new Map(newPending.map(item => [
			item.id,
			this._getRepresentedSkillChoice(item, manifest),
		]));
		const unexpected = newPending.filter(item =>
			item.family === "feature" && item.value?.kind === "skill"
				? !skillChoices.get(item.id) || (item.sourceDecisionKey && !represented.has(item.sourceDecisionKey))
				: !represented.has(item.sourceDecisionKey),
		);
		if (unexpected.length) {
			const labels = unexpected.map(item => item.label).join(", ");
			throw new Error(`The staged change created an unrepresented pending choice (${labels}); the mutation was rolled back.`);
		}
		// The manifest owns these new skill decisions; retain the decision, not
		// a second compatibility prompt which would survive Apply.
		for (const item of newPending) {
			if (skillChoices.get(item.id)) this._candidateState.removePendingFeatureChoice(item.id);
		}
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
		this._candidateState.adoptLegacyProgressionEvidence?.(this._manifest);
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
		if (["origin", "unplaced"].includes(decision?.scope)) {
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

	_reverseDecisionReceipt (decision) {
		const type = decision?.type;
		const family = ["class", "subclass", "subclassChoice"].includes(type)
			? "class"
			: [
				"skills", "tools", "expertise", "languages", "nestedSkill",
				"nestedSkillTool", "nestedExpertise", "nestedTool", "nestedLanguage",
				"nestedSave", "nestedWeapon", "nestedArmor", "nestedResistance",
				"nestedDamageType",
			].includes(type)
				? "proficiencies"
				: [
					"spellbookSpells", "knownSpells", "cantrips", "preparedSpells",
					"preparedCantrips", "spellSwap", "spellMastery", "signatureSpells",
					"nestedSpell", "nestedCantrip",
				].includes(type)
					? "spells"
					: ["asi", "feat", "asiOrFeat", "classFeatProgressionFeat"].includes(type)
						? "improvement"
						: ["optionalFeatures", "featureChoice", "nestedEntity", "nestedFeat", "nestedOptionalFeature"].includes(type)
							? "features"
							: ["originRace", "originBackground"].includes(type) ? "origin" : "configuration";
		const method = {
			class: "reverseProgressionClassReceipt",
			proficiencies: "reverseProgressionProficiencyReceipt",
			spells: "reverseProgressionSpellReceipt",
			improvement: "reverseProgressionImprovementReceipt",
			features: "reverseProgressionFeatureReceipt",
			origin: "reverseProgressionOriginReceipt",
			configuration: "reverseProgressionConfigurationReceipt",
		}[family];
		if (typeof this._candidateState[method] === "function") return this._candidateState[method](decision);
		return this._candidateState.reverseProgressionDecisionReceipt?.(decision);
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
			const isOriginAbility = decision.type === "nestedAbility"
				&& decision.scope === "origin"
				&& ["race", "background"].includes(decision.provenance?.ownerType);
			effects.push(...values.map(value => ({
				type: decision.type === "nestedAbility"
					? isOriginAbility ? "abilityBonusDelta" : "abilityDelta"
					: "configuration",
				sourceDecisionKey: decision.semanticKey,
				ability: decision.type === "nestedAbility" ? String(value) : undefined,
				amount: decision.type === "nestedAbility" ? amount : undefined,
				before: decision.type === "nestedAbility"
					? isOriginAbility
						? decision.meta?.receiptPreviousAbilityBonus?.[String(value || "").toLowerCase()]
						: decision.meta?.receiptPreviousAbility?.[String(value || "").toLowerCase()]
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
		const materializedFeats = (state?._data?.feats || [])
			.filter(feat => feat.sourceDecisionKey === decision?.semanticKey)
			.map(feat => ({id: feat.id, name: feat.name, source: feat.source}));
		const materializedFeatIds = new Set(materializedFeats.map(feat => feat.id));
		const materializedModifiers = [
			...(state?._data?.modifiers || []),
			...(state?._data?.namedModifiers || []),
		]
			.filter(modifier =>
				materializedFeatureIds.has(modifier.featureId)
					|| materializedFeatIds.has(modifier.featureId)
					|| materializedFeatIds.has(modifier.sourceFeatureId)
					|| modifier.sourceDecisionKey === decision?.semanticKey,
			)
			.map(modifier => ({
				id: modifier.id,
				featureId: modifier.featureId,
				sourceFeatureId: modifier.sourceFeatureId,
				sourceDecisionKey: modifier.sourceDecisionKey,
			}));
		const materializedResources = (state?.getResources?.() || [])
			.filter(resource =>
				resource.sourceDecisionKey === decision?.semanticKey
					|| materializedFeatureIds.has(resource.featureId)
					|| materializedFeatIds.has(resource.featId),
			)
			.map(resource => ({
				id: resource.id,
				name: resource.name,
				sourceDecisionKey: resource.sourceDecisionKey,
				featureId: resource.featureId,
				featId: resource.featId,
			}));
		if (materializedFeatures.length || materializedFeats.length || materializedModifiers.length || materializedResources.length) {
			effects.push({
				type: "materialized",
				features: materializedFeatures,
				feats: materializedFeats,
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

	_isMechanicallyCompleteSkillNoOp (decision, stored, selection, status) {
		const expectedLevel = {
			nestedSkill: 1,
			nestedExpertise: 2,
		}[decision?.type];
		if (!expectedLevel || stored?.status !== "resolved" || !stored.receipt) return false;
		if (status != null && status !== stored.status) return false;

		const normalize = value => this._candidateState.normalizeSkillProficiencyKey?.(
			typeof value === "string" ? value : value?.value ?? value?.name ?? value,
		) || String(value || "").toLowerCase().replace(/\s+/g, "");
		const toKeys = value => (value == null ? [] : (Array.isArray(value) ? value : [value]))
			.map(normalize)
			.filter(Boolean)
			.sort();
		const before = toKeys(stored.selection);
		const after = toKeys(selection);
		if (before.length !== after.length || before.some((key, ix) => key !== after[ix])) return false;

		const ownershipType = expectedLevel === 2 ? "expertise" : "skills";
		return after.every(skill => {
			if (this._candidateState.getSkillProficiency(skill) < expectedLevel) return false;
			const ownership = this._candidateState._getProgressionOwnershipEntry?.(ownershipType, skill);
			return !!ownership?.sources?.includes(decision.semanticKey);
		});
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
		const isDirtySnapshot = this._isDirty;
		const undoSnapshot = this._undoSnapshot;

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
		if (this._isMechanicallyCompleteSkillNoOp(decision, stored, selection, status)) return this._manifest;

		const rollback = error => {
			this._candidateState.loadFromJson(stateSnapshot);
			this._manifest = manifestSnapshot;
			this._isDirty = isDirtySnapshot;
			this._undoSnapshot = undoSnapshot;
			throw error;
		};

		const finalize = applyResult => {
			const effectiveSelection = applyResult && Object.prototype.hasOwnProperty.call(applyResult, "selection")
				? applyResult.selection
				: selection;
			const effectiveStatus = applyResult && Object.prototype.hasOwnProperty.call(applyResult, "status")
				? applyResult.status
				: status;
			// Mechanics may call updateLevelChoice, which replaces the decisions
			// array; write to its current row rather than a detached snapshot.
			const {container: currentContainer} = this._getDecisionStore(decision);
			const currentStored = currentContainer?.decisions?.find(item =>
				item.id === decisionId || item.semanticKey === decision.semanticKey,
			);
			if (!currentStored) throw new Error("The staged progression decision is no longer available in the draft ledger.");
			const updated = CharacterSheetProgression.normalizeDecision({
				...currentStored,
				selection: CharacterSheetProgression._copy(effectiveSelection),
				status: effectiveStatus,
				receipt: this._makeDecisionReceipt(decision, effectiveSelection, this._candidateState),
			}, currentContainer);
			Object.assign(currentStored, updated);
			if (!["origin", "unplaced"].includes(decision.scope)) {
				Object.assign(currentContainer, CharacterSheetProgression.projectDecisionsToChoices(currentContainer));
			}
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
		};

		let descendantSnapshots = [];
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
			descendantSnapshots = descendants.map(descendant => ({
				decision: CharacterSheetProgression._copy(descendant),
				selection: CharacterSheetProgression._copy(descendant.selection),
				status: descendant.status,
			}));
			// Descendant state cleanup is owned by the existing state/controller
			// handlers.  The ledger side is removed deepest-first before the parent
			// is written, preventing stale choices from surviving a replacement.
			for (const descendant of descendants) {
				this._reverseDecisionReceipt(descendant);
				const ownerUid = descendant.provenance?.ownerUid || "";
				const [parentName, parentSource] = ownerUid.split("|");
				if (parentName) {
					this._candidateState.removeChosenSubfeature?.(parentName, {
						parentSource: parentSource || null,
						level: descendant.classLevel || descendant.characterLevel,
						sourceDecisionKey: descendant.semanticKey,
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
			if (reverseParent) this._reverseDecisionReceipt(stored);
			const applyResult = typeof apply === "function"
				? apply({decision, stored, state: this._candidateState})
				: null;
			if (applyResult && typeof applyResult.then === "function") {
				return Promise.resolve(applyResult)
					.then(finalize)
					.catch(rollback);
			}
			return finalize(applyResult);
		} catch (error) {
			return rollback(error);
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
		const isDirtySnapshot = this._isDirty;
		const undoSnapshot = this._undoSnapshot;
		try {
			const result = await apply({state: this._candidateState});
			this._setDirty();
			this.refreshManifest({persist: false});
			this._assertNoNewUnrepresentedPending(pendingSnapshot, this._manifest);
			this._persistManifest();
			return result;
		} catch (error) {
			this._candidateState.loadFromJson(stateSnapshot);
			this._manifest = manifestSnapshot;
			this._isDirty = isDirtySnapshot;
			this._undoSnapshot = undoSnapshot;
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
				message: decision.meta?.validationMessage || `${decision.label} is ${decision.status}.`,
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

	_restoreLiveSnapshot (snapshot, rawData) {
		try {
			if (this._liveState.loadFromJson(snapshot) === false) {
				throw new Error("The character could not be restored after the failed Respec transaction.");
			}
		} finally {
			// Loading an older save can create migration fields and new modifier IDs.
			// Restore the exact data so the draft's unchanged-live guard allows retry.
			this._liveState._data = rawData;
		}
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
		const beforeApplyData = CharacterSheetProgression._copy(this._liveState._data);
		const candidate = this._candidateState.toJson();

		try {
			if (this._liveState.loadFromJson(candidate) === false) throw new Error("The rebuilt character could not be loaded.");
			this._liveState.reconcileFeatureCompanionGrants?.({reason: "respecApply"});
			await this._page.saveCharacter();
			this._page.renderCharacter();
		} catch (error) {
			this._restoreLiveSnapshot(beforeApply, beforeApplyData);
			throw error;
		}

		this._undoSnapshot = beforeApply;
		this._originalSnapshot = this._liveState.toJson();
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
		const currentData = CharacterSheetProgression._copy(this._liveState._data);
		try {
			if (this._liveState.loadFromJson(restore) === false) throw new Error("The previous character snapshot could not be restored.");
			await this._page.saveCharacter();
			this._page.renderCharacter();
		} catch (error) {
			this._restoreLiveSnapshot(current, currentData);
			throw error;
		}
		this._undoSnapshot = null;
		return true;
	}
}

export {CharacterSheetRespecEngine};
globalThis.CharacterSheetRespecEngine = CharacterSheetRespecEngine;
