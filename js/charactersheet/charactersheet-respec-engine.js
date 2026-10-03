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
		this._undoRawData = null;
		this._isDirty = false;
		this._preexistingPendingKeys = new Set();
		this._baselineDecisionIssues = new Map();
		this._touchedDecisionKeys = new Set();
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
		this._touchedDecisionKeys = new Set();
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
		this._baselineDecisionIssues = this._getDecisionIssueIndex(this._originalManifest);
		return this._candidateState;
	}

	cancel () {
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._originalSnapshot = null;
		this._isDirty = false;
		this._preexistingPendingKeys = new Set();
		this._baselineDecisionIssues = new Map();
		this._touchedDecisionKeys = new Set();
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
		const previous = this._manifest;
		this._setDirty();
		const next = this.refreshManifest();
		this._trackChangedDecisions(previous, next);
		return next;
	}

	static _getSemanticValue (value) {
		if (Array.isArray(value)) return value.map(item => this._getSemanticValue(item));
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => [key, this._getSemanticValue(item)]));
	}

	_getDecisionFingerprint (decision, manifest) {
		const contract = row => {
			const provenance = {...row.provenance};
			delete provenance.characterLevel;
			delete provenance.acquisitionLevel;
			return CharacterSheetRespecEngine._getSemanticValue({
				semanticKey: row.semanticKey,
				type: row.type,
				scope: row.scope,
				className: row.className,
				classSource: row.classSource,
				classLevel: row.classLevel,
				sourceKey: row.sourceKey,
				required: row.required,
				count: row.count,
				status: row.status,
				selection: row.selection,
				provenance,
				parentSemanticKey: row.parentSemanticKey,
				rootSemanticKey: row.rootSemanticKey,
				meta: row.meta,
				receipt: row.receipt,
				options: (row.options || []).map(option => CharacterSheetRespecEngine._getSemanticValue(option))
					.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
			});
		};
		const byKey = new Map((manifest?.decisions || []).map(row => [row.semanticKey, row]));
		const lineage = [];
		const seen = new Set([decision.semanticKey]);
		let parentKey = decision.parentSemanticKey;
		while (parentKey) {
			if (seen.has(parentKey)) return null;
			seen.add(parentKey);
			const parent = byKey.get(parentKey);
			if (!parent) return null;
			lineage.push(contract(parent));
			parentKey = parent.parentSemanticKey;
		}
		return JSON.stringify({decision: contract(decision), lineage});
	}

	_getDecisionIssueIndex (manifest) {
		const index = new Map();
		for (const decision of manifest?.decisions || []) {
			if (!["missing", "invalid", "ambiguous"].includes(decision.status)
				|| (!decision.required && decision.status === "missing")) continue;
			const key = decision.semanticKey;
			if (!key || index.has(key)) {
				if (key) index.set(key, null);
				continue;
			}
			index.set(key, this._getDecisionFingerprint(decision, manifest));
		}
		return index;
	}

	_trackChangedDecisions (before, after) {
		const beforeByKey = new Map((before?.decisions || []).map(decision => [decision.semanticKey, decision]));
		for (const decision of after?.decisions || []) {
			const previous = beforeByKey.get(decision.semanticKey);
			if (!previous || this._getDecisionFingerprint(previous, before) !== this._getDecisionFingerprint(decision, after)) {
				this._touchedDecisionKeys.add(decision.semanticKey);
			}
			beforeByKey.delete(decision.semanticKey);
		}
		for (const key of beforeByKey.keys()) this._touchedDecisionKeys.add(key);
	}

	_setDirty () {
		this._isDirty = true;
		this._undoSnapshot = null;
		this._undoRawData = null;
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
		const isOriginFeatAbility = decision?.scope === "origin" && type === "nestedAbility"
			&& decision.meta?.descriptorRules?.featAbilityChoice
			&& (decision.status !== "missing" || (decision.receipt?.effects || []).some(effect => effect.type === "abilityDelta"));
		const ownedFeat = isOriginFeatAbility
			? (this._candidateState.getFeats?.() || []).find(feat => feat.sourceDecisionKey === decision.parentSemanticKey)
			: null;
		let reversal = decision;
		if (decision?.scope === "origin" && decision.meta?.descriptorRules?.originFeatSpellChoice
			&& decision.meta.descriptorRules.spellMode === "innate" && ["nestedSpell", "nestedCantrip"].includes(type)) {
			const feat = this._candidateState._data.feats.find(row => row.sourceDecisionKey === decision.parentSemanticKey);
			const selected = Array.isArray(decision.selection) ? decision.selection : decision.selection ? [decision.selection] : [];
			for (const spell of selected) {
				const grantId = `respec:${decision.semanticKey}:${CharacterSheetProgression.getEntityUid(spell)}`;
				if (!(decision.receipt?.effects || []).some(effect =>
					(effect.ownership || []).some(owned => owned.type === "innateSpells" && owned.value?.grantId === grantId))) continue;
				const owned = this._candidateState.getInnateSpells().filter(row => row.grantId === grantId);
				if (!feat || owned.length !== 1 || owned[0].sourceFeature !== feat.name
					|| CharacterSheetProgression.getEntityUid(owned[0]) !== CharacterSheetProgression.getEntityUid(spell)) {
					throw new Error("The origin feat's exact innate spell grant no longer matches its receipt.");
				}
				this._candidateState.removeInnateSpell(owned[0].id);
				this._candidateState.releaseProgressionOwnership("innateSpells", spell, decision.semanticKey);
				reversal = CharacterSheetProgression._copy(reversal);
				for (const effect of reversal.receipt.effects) {
					if (effect.type === "ownership") effect.ownership = effect.ownership.filter(value => value.value?.grantId !== grantId);
				}
				if (feat?.appliedEffects && !this._candidateState._getProgressionOwnershipEntry("innateSpells", spell)?.sources?.includes(`feat:${feat.id}`)) {
					feat.appliedEffects.innateSpellsAdded = (feat.appliedEffects.innateSpellsAdded || [])
						.filter(value => CharacterSheetProgression.getEntityUid(value) !== CharacterSheetProgression.getEntityUid(spell));
				}
			}
		}
		const originBonuses = decision?.scope === "origin"
			&& ["race", "background"].includes(decision.provenance?.ownerType)
			? (decision.receipt?.effects || []).filter(effect => effect.type === "abilityBonusDelta")
			: [];
		if (originBonuses.length) {
			if (decision.receipt.sourceDecisionKey !== decision.semanticKey || originBonuses.some(effect =>
				effect.sourceDecisionKey !== decision.semanticKey || !Parser.ABIL_ABVS.includes(effect.ability)
				|| !Number.isFinite(effect.amount) || effect.amount < 0
				|| (this._candidateState._data.abilityBonuses[effect.ability] || 0) < effect.amount)) {
				throw new Error("The origin ability bonus no longer agrees with its source-owned receipt. Restore its saved choices before replacing this grant.");
			}
			reversal = CharacterSheetProgression._copy(decision);
			for (const effect of reversal.receipt.effects) {
				if (effect.type === "abilityBonusDelta") delete effect.before;
			}
		}
		if (isOriginFeatAbility) {
			const deltas = (decision.receipt?.effects || []).filter(effect => effect.type === "abilityDelta");
			if (!ownedFeat || !deltas.length || deltas.some(effect =>
				effect.sourceDecisionKey !== decision.semanticKey
				|| !Number.isFinite(effect.amount) || effect.amount < 0
				|| ownedFeat.appliedEffects?.abilityDeltas?.[effect.ability] !== effect.amount)) {
				throw new Error("The origin feat's ability receipt no longer agrees with its recorded owner. Restore its saved choices before replacing this grant.");
			}
			reversal = CharacterSheetProgression._copy(reversal);
			for (const effect of reversal.receipt.effects) {
				if (effect.type === "abilityDelta") delete effect.before;
			}
		}
		if (decision?.scope === "origin" && type === "nestedFeat") {
			const feats = this._candidateState.getFeats?.() || [];
			const owned = feats.filter(feat => feat.sourceDecisionKey === decision.semanticKey);
			for (const effect of decision.receipt?.effects || []) {
				for (const reference of effect.type === "materialized" ? effect.feats || [] : []) {
					const recorded = reference.id && feats.find(feat => feat.id === reference.id);
					if (recorded && !owned.includes(recorded)) {
						throw new Error("The origin feat receipt identifies a different grant's owner. Restore its saved choices before replacing this background.");
					}
				}
			}
			for (const feat of owned) this._candidateState.removeFeat(feat.id);
			reversal = CharacterSheetProgression._copy(decision);
			for (const effect of reversal.receipt?.effects || []) {
				if (effect.type === "materialized") effect.feats = [];
			}
		}
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
		const result = typeof this._candidateState[method] === "function"
			? this._candidateState[method](reversal)
			: this._candidateState.reverseProgressionDecisionReceipt?.(reversal);
		if (ownedFeat) {
			for (const effect of decision.receipt.effects) {
				if (effect.type === "abilityDelta") delete ownedFeat.appliedEffects.abilityDeltas[effect.ability];
			}
		}
		return result;
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
		const isOriginFeatInnate = decision.scope === "origin" && decision.meta?.descriptorRules?.originFeatSpellChoice
			&& decision.meta.descriptorRules.spellMode === "innate";
		const ownershipType = isOriginFeatInnate ? "innateSpells" : typeMap[decision?.type];
		const values = selection == null ? [] : (Array.isArray(selection) ? selection : [selection]);
		const effects = [];
		if (["nestedAbility", "nestedConfiguration"].includes(decision?.type) && values.length) {
			const featEffects = CharacterSheetProgression.getFeatAbilityDecisionEffects({...decision, selection}, state);
			const amount = Number(decision.meta?.descriptorRules?.amount) || 1;
			const isOriginAbility = decision.type === "nestedAbility"
				&& decision.scope === "origin"
				&& ["race", "background"].includes(decision.provenance?.ownerType);
			effects.push(...(featEffects || values.map(value => ({
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
			}))));
			if (decision.type === "nestedConfiguration" && decision.scope === "origin" && decision.meta?.originAbilityDistribution) {
				for (const [ability, amount] of Object.entries(values[0]?.fixedBonuses || {})) {
					effects.push({
						type: "abilityBonusDelta",
						sourceDecisionKey: decision.semanticKey,
						ability,
						amount,
						before: (state._data.abilityBonuses[ability] || 0) - amount,
					});
				}
			}
		}
		if (ownershipType) {
			effects.push({
				type: "ownership",
				ownership: values.map(value => {
					if (isOriginFeatInnate) {
						return {
							type: ownershipType,
							value: {...value, grantId: `respec:${decision.semanticKey}:${CharacterSheetProgression.getEntityUid(value)}`},
						};
					}
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
		if (!isOriginFeatInnate && ["nestedSpell", "nestedCantrip", "knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips"].includes(decision?.type) && values.length) {
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

	_validateAsiReceipt (decision, receipt, beforeAbilities, beforeFeatures, observedResult = null) {
		const fail = () => { throw new Error("The replacement ASI receipt does not match its owner or observed ability changes. The edit was rolled back; reopen this choice and apply it again with exact acquisition evidence."); };
		const hasOnly = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
			&& Object.keys(value).every(key => keys.includes(key));
		if (!hasOnly(receipt, ["version", "sourceDecisionKey", "effects"])
			|| receipt.version !== 1 || receipt.sourceDecisionKey !== decision.semanticKey
			|| !Array.isArray(receipt.effects)) fail();
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];
		const afterAbilities = observedResult?.abilities || this._candidateState._data.abilities;
		const afterFeatures = observedResult?.features || this._candidateState.getFeatures();
		const represented = new Set();
		for (const effect of receipt.effects) {
			if (effect?.type === "abilityDelta") {
				if (!hasOnly(effect, ["type", "sourceDecisionKey", "ability", "amount", "before", "after"])
					|| effect.sourceDecisionKey !== decision.semanticKey
					|| !abilities.includes(effect.ability) || represented.has(effect.ability)
					|| ![effect.amount, effect.before, effect.after].every(value => typeof value === "number" && Number.isFinite(value))
					|| effect.before !== beforeAbilities[effect.ability]
					|| effect.after !== afterAbilities[effect.ability]
					|| effect.amount < 0 || effect.amount !== effect.after - effect.before) fail();
				represented.add(effect.ability);
				continue;
			}
			if (effect?.type !== "materialized" || !hasOnly(effect, ["type", "features"])
				|| !Array.isArray(effect.features)) fail();
			for (const evidence of effect.features) {
				if (!hasOnly(evidence, ["id", "name", "source"])
					|| !["id", "name", "source"].every(key => typeof evidence[key] === "string" && evidence[key])) fail();
				const current = afterFeatures.find(feature => feature.id === evidence.id);
				const finalFeature = this._candidateState.getFeatures().find(feature => feature.id === evidence.id);
				const previous = beforeFeatures.find(feature => feature.id === evidence.id);
				if (!current || !finalFeature || finalFeature.name !== evidence.name || finalFeature.source !== evidence.source
					|| (finalFeature.sourceDecisionKey && finalFeature.sourceDecisionKey !== decision.semanticKey)
					|| current.name !== evidence.name || current.source !== evidence.source
					|| (current.sourceDecisionKey && current.sourceDecisionKey !== decision.semanticKey)
					|| (previous && previous.sourceDecisionKey !== decision.semanticKey)) fail();
			}
		}
		if (!represented.size || abilities.some(ability =>
			beforeAbilities[ability] !== afterAbilities[ability] && !represented.has(ability))) fail();
		return CharacterSheetProgression._copy(receipt);
	}

	_validateAsiReceiptTail (observedResult) {
		const fail = () => { throw new Error("The replacement ASI receipt has unproven changes after its observed result boundary. Only the exact retained paired feat may change abilities there; the edit was rolled back."); };
		const explained = Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, 0]));
		const isDeltaMap = map => map && typeof map === "object" && !Array.isArray(map)
			&& Object.entries(map).every(([ability, amount]) => Parser.ABIL_ABVS.includes(ability) && Number.isFinite(amount) && amount >= 0);
		for (const owner of observedResult.pairedOwners) {
			const before = observedResult.feats.filter(feat => feat.sourceDecisionKey === owner.semanticKey);
			const after = this._candidateState.getFeats().filter(feat => feat.sourceDecisionKey === owner.semanticKey);
			if (before.length > 1 || after.length !== 1
				|| [...before, ...after].some(feat => CharacterSheetProgression.getEntityUid(feat) !== owner.uid)) fail();
			const canonical = (this._page.getFeats?.() || []).find(feat => CharacterSheetProgression.getEntityUid(feat) === owner.uid);
			if (!canonical) fail();
			const current = after[0];
			const resolved = CharacterSheetClassUtils.resolveFeatAbilityChoice(canonical, current.choices || current._featChoices || {});
			if (!resolved.valid || resolved.optionIndex !== owner.abilityChoice.optionIndex
				|| resolved.option.max !== owner.abilityChoice.max
				|| Parser.ABIL_ABVS.some(ability => (resolved.increases[ability] || 0) !== (owner.abilityChoice.increases[ability] || 0))) fail();
			const oldDeltas = before.length ? before[0].appliedEffects?.abilityDeltas : {};
			const newDeltas = current.appliedEffects?.abilityDeltas;
			if (!isDeltaMap(oldDeltas) || !isDeltaMap(newDeltas)) fail();
			for (const ability of Parser.ABIL_ABVS) {
				const oldAmount = Object.hasOwn(oldDeltas, ability) ? oldDeltas[ability] : 0;
				const newAmount = Object.hasOwn(newDeltas, ability) ? newDeltas[ability] : 0;
				const increase = resolved.increases[ability] || 0;
				const beforeIncoming = observedResult.abilities[ability] - oldAmount;
				const expected = increase ? CharacterSheetClassUtils.capAbilityIncrease(
					beforeIncoming, increase, resolved.option.max,
				) - beforeIncoming : 0;
				if (!Number.isFinite(increase) || increase < 0 || beforeIncoming < 1 || newAmount !== expected) fail();
				explained[ability] += newAmount - oldAmount;
			}
		}
		for (const ability of Parser.ABIL_ABVS) {
			if (this._candidateState.getAbilityBase(ability) - observedResult.abilities[ability] !== explained[ability]) fail();
		}
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

	_normalizeStagedLegacyBardSpellChoice (decision, selection, container, stored) {
		if (!decision.meta?.legacyBardPrepared) return;
		const key = decision.type === "knownSpells" ? "preparedSpells" : "preparedCantrips";
		const previous = container?.choices?.[key];
		if (!Array.isArray(previous) || !previous.length) {
			throw new Error("The original Bard spell choice is no longer available to convert.");
		}
		const uid = CharacterSheetProgression.getEntityUid;
		const previousIds = new Set(previous.map(value => uid(value)));
		const retainedIds = new Set((Array.isArray(selection) ? selection : [selection])
			.filter(Boolean).map(value => uid(value)));
		const spells = decision.type === "knownSpells"
			? this._candidateState.getSpellsKnown()
			: this._candidateState.getCantripsKnown();
		for (const spell of spells) {
			if (!previousIds.has(uid(spell)) || !retainedIds.has(uid(spell))
				|| spell.sourceFeature !== "Prepared Spells"
				|| spell.sourceClass !== "Bard"
				|| spell.sourceClassSource !== decision.classSource) continue;
			spell.sourceFeature = decision.type === "knownSpells" ? "Spells Known" : "Cantrips Known";
			if (decision.type === "knownSpells") spell.prepared = false;
		}
		delete container.choices[key];
		stored.meta = {...stored.meta, legacyBardPrepared: false};
	}

	/**
	 * Stage one linked graph edit.  The snapshot is intentionally at the state
	 * boundary rather than just the ledger boundary: controller callbacks may
	 * materialise features, resources, or spells before a descriptor is refreshed.
	 */
	stageGraphMutation (decisionId, selection, {status = null, apply = null, reverseParent = false, legacyLanguageResolution = null} = {}) {
		const decision = this.getDecision(decisionId);
		if (!decision) throw new Error("That progression decision is no longer available.");
		if (!this._candidateState) throw new Error("No Respec draft is active.");
		const unresolvedLanguages = CharacterSheetProgression.getUnresolvedRogueLanguages({
			state: this._candidateState,
			manifest: this._manifest,
			decision,
		});
		if (unresolvedLanguages.length) {
			const selected = Array.isArray(selection) && selection.length === 1 ? selection[0] : null;
			const keyOf = value => this._candidateState._getProgressionOwnershipKey("languages", value);
			const selectedWasUnresolved = selected && unresolvedLanguages.some(value => keyOf(value) === keyOf(selected));
			if (!selected || !["attribute", "independent"].includes(legacyLanguageResolution?.mode)
				|| (legacyLanguageResolution.mode === "attribute" && !selectedWasUnresolved)
				|| (legacyLanguageResolution.mode === "independent" && selectedWasUnresolved)) {
				throw new Error("Confirm whether an existing unresolved language belonged to Rogue before staging this choice.");
			}
		}
		// Already-deferred Builder picks are still owned live choices. Confirming
		// "Defer" must not reverse their effects or erase that evidence.
		if (decision.status === "deferred" && !decision.required
			&& selection == null && status === "deferred"
			&& Number(decision.characterLevel) === 1
			&& ["knownSpells", "cantrips"].includes(decision.type)
			&& CharacterSheetProgression._hasBuilderBardSpellPicks({
				className: decision.className,
				classSource: decision.classSource,
				history: this._candidateState.getLevelHistory?.(),
			})) {
			return this._manifest;
		}
		const stateSnapshot = this._candidateState.toJson();
		const rawStateSnapshot = CharacterSheetProgression._copy(this._candidateState._data);
		const manifestSnapshot = CharacterSheetProgression._copy(this._manifest);
		const pendingSnapshot = this._getPendingCompatibilityItems(this._candidateState);
		const isDirtySnapshot = this._isDirty;
		const undoSnapshot = this._undoSnapshot;
		const undoRawData = this._undoRawData;
		const touchedSnapshot = new Set(this._touchedDecisionKeys);

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
			this._restoreStateSnapshot(this._candidateState, stateSnapshot, rawStateSnapshot);
			this._manifest = manifestSnapshot;
			this._isDirty = isDirtySnapshot;
			this._undoSnapshot = undoSnapshot;
			this._undoRawData = undoRawData;
			this._touchedDecisionKeys = touchedSnapshot;
			throw error;
		};

		let callbackEntryAbilities = null;
		let receiptBaseline = null;
		let receiptResult = null;
		const captureReceiptBaseline = () => {
			if (receiptBaseline) throw new Error("The ASI receipt baseline can only be captured once per edit.");
			receiptBaseline = CharacterSheetProgression._copy(this._candidateState._data.abilities);
		};
		const captureReceiptResult = () => {
			if (!["asi", "asiOrFeat"].includes(decision.type) || !receiptBaseline) {
				throw new Error("Capture the observed ASI baseline before capturing its result boundary.");
			}
			if (receiptResult) throw new Error("The ASI receipt result can only be captured once per edit.");
			const classUid = row => CharacterSheetProgression.getEntityUid({name: row.className, source: row.classSource});
			const paired = (manifestSnapshot.decisions || []).filter(row =>
				decision.type === "asi" && row.type === "feat" && row.sourceKey === "feat" && row.scope === "level"
				&& row.meta?.improvement?.kind === "asiAndFeat" && row.status === "resolved"
				&& classUid(row) === classUid(decision) && row.classLevel === decision.classLevel
				&& row.characterLevel === decision.characterLevel && row.semanticKey !== decision.semanticKey);
			if (paired.length > 1) throw new Error("The ASI result boundary has ambiguous paired feat ownership.");
			const pairedOwners = paired.map(row => {
				const uid = CharacterSheetProgression.getEntityUid(row.selection);
				const matches = (stateSnapshot.feats || []).filter(feat => CharacterSheetProgression.getEntityUid(feat) === uid);
				let original = matches.filter(feat => feat.sourceDecisionKey === row.semanticKey);
				if (row.receipt && (row.receipt.version !== 1 || row.receipt.sourceDecisionKey !== row.semanticKey)) {
					throw new Error("The ASI result boundary has a foreign paired feat receipt.");
				}
				const references = (row.receipt?.effects || []).flatMap(effect => effect.type === "materialized" ? effect.feats || [] : []);
				if (references.some(reference => !reference.id || CharacterSheetProgression.getEntityUid(reference) !== uid)
					|| new Set(references.map(reference => reference.id)).size > 1
					|| (original.length && references.some(reference => {
						const recorded = (stateSnapshot.feats || []).find(feat => feat.id === reference.id);
						return recorded && !original.includes(recorded);
					}))) {
					throw new Error("The ASI result boundary has contradictory paired feat materialized evidence.");
				}
				if (!original.length && references.length) {
					const ids = new Set(references.filter(reference => CharacterSheetProgression.getEntityUid(reference) === uid).map(reference => reference.id));
					original = matches.filter(feat => ids.has(feat.id) && (!feat.sourceDecisionKey || feat.sourceDecisionKey === row.semanticKey));
				}
				const level = (stateSnapshot.levelHistory || []).find(entry => entry.level === row.characterLevel);
				const ledgerFeatUid = CharacterSheetProgression.getEntityUid(level?.choices?.feat);
				const claims = (manifestSnapshot.decisions || []).filter(other =>
					other.status === "resolved"
					&& ["feat", "asiOrFeat", "classFeatProgressionFeat", "originFeat", "nestedFeat"].includes(other.type)
					&& CharacterSheetProgression.getEntityUid(other.selection?.mode === "feat" ? other.selection.feat : other.selection) === uid);
				if (!original.length && !references.length && matches.length === 1 && !matches[0].sourceDecisionKey
					&& ledgerFeatUid === uid && classUid({className: level?.class?.name, classSource: level?.class?.source}) === classUid(row)
					&& (stateSnapshot.levelHistory || []).filter(entry => entry.level <= row.characterLevel
						&& CharacterSheetProgression.getEntityUid(entry.class) === classUid(row)).length === row.classLevel
					&& claims.length === 1 && claims[0].semanticKey === row.semanticKey) original = matches;
				const canonical = (this._page.getFeats?.() || []).find(feat => CharacterSheetProgression.getEntityUid(feat) === uid);
				if (!canonical || original.length !== 1 || CharacterSheetProgression.getEntityUid(original[0]) !== uid) {
					throw new Error("The ASI result boundary lacks the exact original paired feat owner.");
				}
				const choices = original[0].choices || original[0]._featChoices || {};
				const resolved = CharacterSheetClassUtils.resolveFeatAbilityChoice(canonical,
					choices.ability != null || choices.abilityOption != null ? choices : level?.choices?.featChoices || choices);
				if (!resolved.valid) throw new Error("The ASI result boundary has an unresolved original paired feat ability choice.");
				return {semanticKey: row.semanticKey, uid, abilityChoice: {optionIndex: resolved.optionIndex, max: resolved.option.max, increases: resolved.increases}};
			});
			receiptResult = CharacterSheetProgression._copy({
				abilities: this._candidateState._data.abilities,
				features: this._candidateState.getFeatures(),
				feats: this._candidateState.getFeats(),
				pairedOwners,
			});
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
			let receipt = null;
			if (receiptResult && !Object.prototype.hasOwnProperty.call(applyResult || {}, "receipt")) {
				throw new Error("The observed ASI result requires its exact acquisition receipt; the edit was rolled back.");
			}
			if (["asi", "asiOrFeat"].includes(decision.type) && applyResult && Object.prototype.hasOwnProperty.call(applyResult, "receipt")) {
				let beforeAbilities = receiptBaseline;
				if (!beforeAbilities) {
					beforeAbilities = CharacterSheetProgression._copy(callbackEntryAbilities);
					if (!reverseParent && decision.selection != null) {
						const outgoing = decision.receipt?.effects?.filter(effect => effect.type === "abilityDelta") || [];
						if (decision.receipt?.version !== 1 || decision.receipt.sourceDecisionKey !== decision.semanticKey
							|| !outgoing.length || outgoing.some(effect => effect.sourceDecisionKey !== decision.semanticKey
								|| !["str", "dex", "con", "int", "wis", "cha"].includes(effect.ability)
								|| typeof effect.amount !== "number" || !Number.isFinite(effect.amount) || effect.amount < 0)
							|| new Set(outgoing.map(effect => effect.ability)).size !== outgoing.length) {
							throw new Error("Capture the observed post-teardown ASI baseline before applying this replacement; the edit was rolled back.");
						}
						for (const effect of outgoing) beforeAbilities[effect.ability] -= effect.amount;
					}
				}
				receipt = this._validateAsiReceipt(decision, applyResult.receipt, beforeAbilities, stateSnapshot.features || [], receiptResult);
				if (receiptResult) this._validateAsiReceiptTail(receiptResult);
			} else receipt = this._makeDecisionReceipt(decision, effectiveSelection, this._candidateState);
			const updated = CharacterSheetProgression.normalizeDecision({
				...currentStored,
				selection: CharacterSheetProgression._copy(effectiveSelection),
				status: effectiveStatus,
				receipt,
			}, currentContainer);
			Object.assign(currentStored, updated);
			if (!["origin", "unplaced"].includes(decision.scope)) {
				this._normalizeStagedLegacyBardSpellChoice(decision, effectiveSelection, currentContainer, currentStored);
				Object.assign(currentContainer, CharacterSheetProgression.projectDecisionsToChoices(currentContainer));
			}
			this._setDirty();
			const refreshed = this.refreshManifest({persist: false});
			// A parent replacement may leave some child identities legal (for
			// example, a recurring pool slot). Rehydrate only when the old
			// selection remains legal and the mutation has not chosen another.
			const keyOf = value => typeof value === "string"
				? value.toLowerCase()
				: `${String(value?.name || value?.value || value?.choice || "").toLowerCase()}|${String(value?.source || "").toLowerCase()}`;
			for (const snapshot of descendantSnapshots) {
				if (reverseParent && decision.meta?.originAbilityDistribution
					&& snapshot.decision.meta?.originAbilityDistribution) continue;
				const next = refreshed.decisions?.find(it => it.semanticKey === snapshot.decision.semanticKey);
				if (!next || snapshot.selection == null) continue;
				const selected = Array.isArray(snapshot.selection) ? snapshot.selection : [snapshot.selection];
				const legal = new Set((next.options || []).map(keyOf));
				if (selected.length !== next.count || selected.some(value => !legal.has(keyOf(value)))) continue;
				const discovered = Array.isArray(next.selection) ? next.selection : [next.selection];
				if (next.selection != null && (
					discovered.length !== selected.length
					|| discovered.some((value, ix) => keyOf(value) !== keyOf(selected[ix]))
				)) continue;
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
			this._touchedDecisionKeys.add(decision.semanticKey);
			for (const snapshot of descendantSnapshots) this._touchedDecisionKeys.add(snapshot.decision.semanticKey);
			this._trackChangedDecisions(manifestSnapshot, this._manifest);
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
			if (unresolvedLanguages.length) {
				const selectedKey = this._candidateState._getProgressionOwnershipKey("languages", selection[0]);
				for (const language of unresolvedLanguages) {
					if (legacyLanguageResolution.mode === "independent"
						|| this._candidateState._getProgressionOwnershipKey("languages", language) !== selectedKey) {
						this._candidateState.preserveUnrecordedProgressionLanguage(language, decision.semanticKey);
					}
				}
				if (legacyLanguageResolution.mode === "attribute") {
					this._candidateState.adoptUnattributedProgressionLanguage(selection[0], decision.semanticKey, {
						alsoIndependent: legacyLanguageResolution.alsoIndependent === true,
						manifest: this._manifest,
					});
				}
			}
			callbackEntryAbilities = CharacterSheetProgression._copy(this._candidateState._data.abilities);
			const applyResult = typeof apply === "function"
				? apply({decision, stored, state: this._candidateState, captureReceiptBaseline, captureReceiptResult})
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
		const rawStateSnapshot = CharacterSheetProgression._copy(this._candidateState._data);
		const manifestSnapshot = CharacterSheetProgression._copy(this._manifest);
		const pendingSnapshot = this._getPendingCompatibilityItems(this._candidateState);
		const isDirtySnapshot = this._isDirty;
		const undoSnapshot = this._undoSnapshot;
		const undoRawData = this._undoRawData;
		const touchedSnapshot = new Set(this._touchedDecisionKeys);
		try {
			const result = await apply({state: this._candidateState});
			this._setDirty();
			this.refreshManifest({persist: false});
			this._assertNoNewUnrepresentedPending(pendingSnapshot, this._manifest);
			this._persistManifest();
			this._trackChangedDecisions(manifestSnapshot, this._manifest);
			return result;
		} catch (error) {
			this._restoreStateSnapshot(this._candidateState, stateSnapshot, rawStateSnapshot);
			this._manifest = manifestSnapshot;
			this._isDirty = isDirtySnapshot;
			this._undoSnapshot = undoSnapshot;
			this._undoRawData = undoRawData;
			this._touchedDecisionKeys = touchedSnapshot;
			throw error;
		}
	}

	updateDecisionSelection (decisionId, selection, {status = null} = {}) {
		return this.stageGraphMutation(decisionId, selection, {status, reverseParent: true});
	}

	getValidation () {
		if (!this._manifest) this.refreshManifest();
		const issues = [...(this._manifest?.issues || [])];
		const decisionIssues = new Set();
		const rows = this._manifest?.decisions || [];
		const byKey = new Map();
		const ids = new Set();
		for (const decision of rows) {
			if (!decision.semanticKey || !decision.id || byKey.has(decision.semanticKey) || ids.has(decision.id)) {
				issues.push({severity: "error", code: "unsafe-decision-identity", message: "Respec discovery has missing or duplicate decision identities. Refresh the source data before applying changes."});
			}
			byKey.set(decision.semanticKey, decision);
			ids.add(decision.id);
		}
		for (const decision of rows) {
			const lineage = new Set([decision.semanticKey]);
			let parentKey = decision.parentSemanticKey;
			while (parentKey) {
				if (lineage.has(parentKey) || !byKey.has(parentKey)) {
					issues.push({severity: "error", code: "unsafe-decision-lineage", message: "Respec discovery has an incomplete or cyclic choice hierarchy. Refresh the source data before applying changes."});
					break;
				}
				lineage.add(parentKey);
				parentKey = byKey.get(parentKey).parentSemanticKey;
			}
		}
		for (const decision of this._manifest?.decisions || []) {
			if (decision.status === "resolved" || (!decision.required && decision.status === "deferred")) continue;
			if (!decision.required && !["invalid", "ambiguous"].includes(decision.status)) continue;
			const unattributed = CharacterSheetProgression.getUnresolvedRogueLanguages({
				state: this._candidateState,
				manifest: this._manifest,
				decision,
			});
			const issue = {
				level: decision.characterLevel,
				severity: "error",
				code: `decision-${decision.status}`,
				decisionId: decision.id,
				semanticKey: decision.semanticKey,
				message: unattributed.length
					? `${decision.label} has no recorded choice. ${unattributed.join(", ")} may be the Rogue's old language or independent grants; use Repair to attribute an existing language or confirm they are independent before selecting a new one.`
					: decision.meta?.validationMessage || `${decision.label} is ${decision.status}.`,
			};
			issues.push(issue);
			decisionIssues.add(issue);
		}
		const currentById = new Map((this._manifest?.decisions || []).map(decision => [decision.id, decision]));
		const errors = issues.filter(issue => issue.severity === "error").map(issue => {
			const decision = currentById.get(issue.decisionId);
			const baseline = decision && this._baselineDecisionIssues.get(decision.semanticKey);
			const carriedForward = decisionIssues.has(issue) && !!decision && ["decision-missing", "decision-invalid", "decision-ambiguous"].includes(issue.code)
				&& !!baseline
				&& !this._touchedDecisionKeys.has(decision.semanticKey)
				&& baseline === this._getDecisionFingerprint(decision, this._manifest);
			return {...issue, carriedForward};
		});
		const blockingErrors = errors.filter(issue => !issue.carriedForward);
		const carriedForwardIssues = errors.filter(issue => issue.carriedForward);
		return {
			issues: [...errors, ...issues.filter(issue => issue.severity !== "error")],
			errors,
			warnings: issues.filter(issue => issue.severity !== "error"),
			blockingErrors,
			carriedForwardIssues,
			canApply: !blockingErrors.length,
			isValid: !errors.length,
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

	_restoreStateSnapshot (state, snapshot, rawData) {
		try {
			if (state.loadFromJson(snapshot) === false) {
				throw new Error("The character could not be restored after the failed Respec transaction.");
			}
		} finally {
			// Migrations can change IDs or deduplicate evidence; a failed edit must preserve the exact data.
			state._data = rawData;
		}
	}

	_restoreLiveSnapshot (snapshot, rawData) {
		this._restoreStateSnapshot(this._liveState, snapshot, rawData);
	}

	async apply () {
		if (!this._candidateState) throw new Error("No Respec draft is active.");
		const validation = this.getValidation();
		if (!validation.canApply) {
			throw new Error(`Resolve ${validation.blockingErrors.length} required Respec item${validation.blockingErrors.length === 1 ? "" : "s"} before applying.`);
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
		this._undoRawData = beforeApplyData;
		this._originalSnapshot = this._liveState.toJson();
		this._candidateState = null;
		this._manifest = null;
		this._originalManifest = null;
		this._isDirty = false;
		this._baselineDecisionIssues = new Map();
		this._touchedDecisionKeys = new Set();
		return true;
	}

	async undo () {
		if (!this._undoSnapshot) return false;
		const restore = this._undoSnapshot;
		const current = this._liveState.toJson();
		const currentData = CharacterSheetProgression._copy(this._liveState._data);
		try {
			this._restoreLiveSnapshot(restore, CharacterSheetProgression._copy(this._undoRawData));
			await this._page.saveCharacter();
			this._page.renderCharacter();
		} catch (error) {
			this._restoreLiveSnapshot(current, currentData);
			throw error;
		}
		this._undoSnapshot = null;
		this._undoRawData = null;
		return true;
	}
}

export {CharacterSheetRespecEngine};
globalThis.CharacterSheetRespecEngine = CharacterSheetRespecEngine;
