import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";
import {CharacterSheetItemUtils} from "./charactersheet-item-utils.js";

/**
 * Data-driven Replicate Magic Item plan decisions.
 *
 * This module owns plan catalog parsing and progression-only validation. It
 * deliberately has no inventory APIs; replicated item instances belong to M3.
 */
class CharacterSheetArtificerPlans {
	static VERSION = 1;
	static CLASS_NAME = "Artificer";
	static CLASS_SOURCE = "EFA";
	static FEATURE_NAME = "Replicate Magic Item";
	static FEATURE_SOURCE = "EFA";
	static FEATURE_UID = "Replicate Magic Item|Artificer|EFA|2";
	static DECISION_TYPE_ACQUIRE = "artificerPlan";
	static DECISION_TYPE_REPLACE = "artificerPlanReplacement";
	static CHOICE_KEY_ACQUIRE = "artificerPlans";
	static CHOICE_KEY_REPLACE = "artificerPlanReplacements";
	static EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID = "efa-armorer-armor-replication-plan";
	static EFA_ARMORER_ARMOR_REPLICATION_FEATURE_UID = "Improved Armorer|Artificer|EFA|Armorer|EFA|9|EFA";
	static EFA_ARMORER_ARMOR_REPLICATION_ITEM_KINDS = Object.freeze(["armor", "shield"]);

	static _copy (value) {
		if (value == null) return value;
		if (globalThis.MiscUtil?.copyFast) return MiscUtil.copyFast(value);
		return JSON.parse(JSON.stringify(value));
	}

	static _normalize (value) {
		return String(value || "").trim().toLowerCase();
	}

	static getItemUid (item) {
		if (!item?.name || !item?.source) return "";
		return `${item.name}|${item.source}`;
	}

	static isExactOwner ({className, classSource}) {
		return this._normalize(className) === this._normalize(this.CLASS_NAME)
			&& this._normalize(classSource) === this._normalize(this.CLASS_SOURCE);
	}

	static isExactDecisionOwner (decision) {
		const owners = [
			{className: decision?.className, classSource: decision?.classSource},
			{
				className: decision?.meta?.owner?.className,
				classSource: decision?.meta?.owner?.classSource,
			},
		];
		const hasExactCompleteOwner = owners.some(owner =>
			owner.className != null
			&& owner.classSource != null
			&& this.isExactOwner(owner),
		);
		return hasExactCompleteOwner
			&& owners.every(owner =>
				(owner.className == null || this._normalize(owner.className) === this._normalize(this.CLASS_NAME))
				&& (owner.classSource == null || this._normalize(owner.classSource) === this._normalize(this.CLASS_SOURCE)),
			);
	}

	static getPlansKnown (classLevel) {
		return CharacterSheetClassUtils.getEfaArtificerPlansKnown(Number(classLevel) || 0);
	}

	static getPlanGainCount (classLevel) {
		return Math.max(0, this.getPlansKnown(classLevel) - this.getPlansKnown(Number(classLevel) - 1));
	}

	static getPlanSlotIdsForLevel (classLevel) {
		const gained = this.getPlanGainCount(classLevel);
		const total = this.getPlansKnown(classLevel);
		return Array.from({length: gained}, (_, ix) => `efa-replicate-plan-${total - gained + ix + 1}`);
	}

	static getAcquisitionOpportunityId ({className, classSource, classLevel, slotId}) {
		return [
			"artificer-plan",
			this._normalize(className),
			this._normalize(classSource),
			`level-${Number(classLevel) || 0}`,
			slotId,
		].join("|");
	}

	static getReplacementOpportunityId ({className, classSource, classLevel, descriptorId = "base"}) {
		return [
			"artificer-plan-replacement",
			this._normalize(className),
			this._normalize(classSource),
			`level-${Number(classLevel) || 0}`,
			this._normalize(descriptorId),
		].join("|");
	}

	static getExtensionSlotId (id) {
		return `artificer-plan-extension|${this._normalize(id).replace(/[^a-z0-9-]+/g, "-")}`;
	}

	static getExtensionDescriptor ({
		id,
		className,
		classSource,
		subclassShortName = null,
		subclassSource = null,
		featureName,
		featureSource,
		classLevel,
		kind = "replacement",
		optional = true,
		constraints = {},
	}) {
		if (!id || !className || !classSource || !featureName || !featureSource || !Number(classLevel)) {
			throw new Error("Plan extension descriptors require stable owner, feature, and level identities.");
		}
		return {
			version: 1,
			id: String(id),
			owner: {
				className: String(className),
				classSource: String(classSource),
				subclassShortName: subclassShortName == null ? null : String(subclassShortName),
				subclassSource: subclassSource == null ? null : String(subclassSource),
				featureName: String(featureName),
				featureSource: String(featureSource),
			},
			classLevel: Number(classLevel),
			kind,
			optional: optional !== false,
			constraints: this._copy(constraints || {}),
		};
	}

	static getSourceQualifiedExtensions ({
		className,
		classSource,
		classLevel,
		subclassShortName = null,
		subclassSource = null,
	} = {}) {
		if (
			!this.isExactOwner({className, classSource})
			|| Number(classLevel) < 9
			|| this._normalize(subclassShortName) !== "armorer"
			|| this._normalize(subclassSource) !== "efa"
		) return [];
		return [this.getExtensionDescriptor({
			id: this.EFA_ARMORER_ARMOR_REPLICATION_EXTENSION_ID,
			className,
			classSource,
			subclassShortName,
			subclassSource,
			featureName: "Improved Armorer",
			featureSource: "EFA",
			classLevel: 9,
			kind: "acquire",
			optional: false,
			constraints: {itemKinds: [...this.EFA_ARMORER_ARMOR_REPLICATION_ITEM_KINDS]},
		})];
	}

	static getProgressionOpportunities ({
		className,
		classSource,
		classLevel,
		subclassShortName = null,
		subclassSource = null,
		extensions = [],
	}) {
		if (!this.isExactOwner({className, classSource})) return [];
		const out = this.getPlanSlotIdsForLevel(classLevel).map((slotId, slot) => ({
			version: 1,
			kind: "acquire",
			required: true,
			className,
			classSource,
			classLevel: Number(classLevel),
			slot,
			slotId,
			opportunityId: this.getAcquisitionOpportunityId({className, classSource, classLevel, slotId}),
			owner: {
				className,
				classSource,
				featureName: this.FEATURE_NAME,
				featureSource: this.FEATURE_SOURCE,
			},
		}));
		if (Number(classLevel) >= 2) {
			out.push({
				version: 1,
				kind: "replacement",
				required: false,
				className,
				classSource,
				classLevel: Number(classLevel),
				slot: 0,
				opportunityId: this.getReplacementOpportunityId({className, classSource, classLevel}),
				owner: {
					className,
					classSource,
					featureName: this.FEATURE_NAME,
					featureSource: this.FEATURE_SOURCE,
				},
				constraints: {},
			});
		}
		const registeredExtensions = [
			...this.getSourceQualifiedExtensions({
				className,
				classSource,
				classLevel,
				subclassShortName,
				subclassSource,
			}),
			...(extensions || []),
		].filter((extension, index, all) =>
			all.findIndex(other => this._normalize(other?.id) === this._normalize(extension?.id)) === index,
		);
		for (const extension of registeredExtensions) {
			if (Number(extension?.classLevel) !== Number(classLevel)) continue;
			if (this._normalize(extension?.owner?.className) !== this._normalize(className)
				|| this._normalize(extension?.owner?.classSource) !== this._normalize(classSource)) continue;
			const isAcquire = extension.kind === "acquire";
			const slotId = isAcquire ? this.getExtensionSlotId(extension.id) : null;
			out.push({
				version: 1,
				kind: extension.kind,
				required: extension.optional === false,
				className,
				classSource,
				classLevel: Number(classLevel),
				slot: 0,
				...(slotId ? {slotId} : {}),
				opportunityId: isAcquire
					? this.getAcquisitionOpportunityId({className, classSource, classLevel, slotId})
					: this.getReplacementOpportunityId({
						className,
						classSource,
						classLevel,
						descriptorId: extension.id,
					}),
				owner: this._copy(extension.owner),
				constraints: this._copy(extension.constraints || {}),
				extensionId: extension.id,
			});
		}
		return out;
	}

	static findFeature ({classFeatures = []} = {}) {
		return (classFeatures || []).find(feature =>
			this._normalize(feature?.name) === this._normalize(this.FEATURE_NAME)
			&& this._normalize(feature?.source) === this._normalize(this.FEATURE_SOURCE)
			&& this._normalize(feature?.className) === this._normalize(this.CLASS_NAME)
			&& this._normalize(feature?.classSource) === this._normalize(this.CLASS_SOURCE)
			&& Number(feature?.level) === 2,
		) || null;
	}

	static _walkEntries (value, fn) {
		if (Array.isArray(value)) {
			value.forEach(it => this._walkEntries(it, fn));
			return;
		}
		if (!value || typeof value !== "object") return;
		fn(value);
		Object.values(value).forEach(it => this._walkEntries(it, fn));
	}

	static _parseItemTag (value) {
		const match = /^\{@item ([^|}]+)\|([^|}]+)(?:\|([^}]+))?}$/.exec(String(value || "").trim());
		if (!match) return null;
		return {
			name: match[1].trim(),
			source: match[2].trim(),
			displayName: (match[3] || match[1]).trim(),
		};
	}

	static _parseFilterTag (value) {
		const match = /^\{@filter ([^|}]+)\|items\|(.+)}\*$/.exec(String(value || "").trim());
		if (!match) return null;
		const clauses = match[2].split("|").map(it => it.trim()).filter(Boolean);
		const byKey = {};
		for (const clause of clauses) {
			const [key, rawValue = ""] = clause.split("=");
			byKey[this._normalize(key)] = rawValue.split(";").map(it => it.trim()).filter(Boolean);
		}
		return {
			label: match[1].trim(),
			clauses,
			byKey,
		};
	}

	static _parseTableLevel (caption) {
		const match = /Artificer Level (\d+)\+/i.exec(String(caption || ""));
		return match ? Number(match[1]) : null;
	}

	static _itemMatchesWildcard (item, wildcard) {
		if (!item?.name || !item?.source) return false;
		const byKey = wildcard?.filter?.byKey || {};
		const rarities = byKey.rarity || [];
		if (rarities.length && !rarities.some(rarity => this._normalize(rarity) === this._normalize(item.rarity))) return false;
		const types = byKey.type || [];
		const requiredTypes = types.filter(type => !type.startsWith("!")).map(this._normalize);
		const excludedTypes = types.filter(type => type.startsWith("!")).map(type => this._normalize(type.slice(1)));
		const itemType = this._normalize(String(item.type || "").split("|")[0]);
		const isPotion = itemType === "p" || itemType === "potion";
		const isScroll = itemType === "sc" || itemType === "scroll";
		const isWondrous = !!item.wondrous || itemType === "w" || itemType === "wondrous item";
		const matchesNamedType = type => type === "potion" ? isPotion
			: type === "scroll" ? isScroll
				: type === "wondrous item" ? isWondrous
					: itemType === type;
		if (requiredTypes.length && !requiredTypes.some(matchesNamedType)) return false;
		if (excludedTypes.some(matchesNamedType)) return false;
		const miscellaneous = byKey.miscellaneous || [];
		if (miscellaneous.some(it => this._normalize(it) === "!cursed") && item.curse) return false;
		return true;
	}

	static parseCatalog ({feature, items = []} = {}) {
		if (!feature || this.getItemUid({
			name: feature.name,
			source: feature.source,
		}) !== `${this.FEATURE_NAME}|${this.FEATURE_SOURCE}`
			|| !this.isExactOwner({className: feature.className, classSource: feature.classSource})) {
			return {
				version: this.VERSION,
				featureUid: this.FEATURE_UID,
				tables: [],
				entries: [],
				candidates: [],
				issues: [{code: "missing-authoritative-feature", message: "The exact EFA Replicate Magic Item feature is unavailable."}],
			};
		}
		const itemByUid = new Map((items || []).map(item => [this._normalize(this.getItemUid(item)), item]));
		const tables = [];
		this._walkEntries(feature.entries || [], entry => {
			if (entry?.type !== "table") return;
			const tableLevel = this._parseTableLevel(entry.caption);
			if (!tableLevel || !String(entry.caption || "").startsWith("Magic Item Plans")) return;
			tables.push({entry, tableLevel});
		});
		tables.sort((a, b) => a.tableLevel - b.tableLevel);

		const entries = [];
		const candidates = [];
		const issues = [];
		for (const {entry: table, tableLevel} of tables) {
			for (let rowIndex = 0; rowIndex < (table.rows || []).length; ++rowIndex) {
				const row = table.rows[rowIndex];
				const raw = Array.isArray(row) ? row[0] : null;
				const itemTag = this._parseItemTag(raw);
				if (itemTag) {
					const itemUid = this.getItemUid(itemTag);
					const catalogItem = itemByUid.get(this._normalize(itemUid)) || null;
					const descriptor = {
						version: 1,
						id: `fixed|${this._normalize(itemUid)}`,
						kind: "fixed",
						repeatable: false,
						tableLevel,
						rowIndex,
						itemUid,
						name: itemTag.name,
						source: itemTag.source,
						displayName: itemTag.displayName,
						attunement: Array.isArray(row) ? row[1] : null,
						resolved: !!catalogItem,
					};
					entries.push(descriptor);
					if (!catalogItem) {
						issues.push({
							code: "missing-fixed-item",
							itemUid,
							message: `The fixed plan ${itemUid} could not be resolved in the item catalog.`,
						});
						continue;
					}
					candidates.push(this._toSelection({
						entry: descriptor,
						item: catalogItem,
					}));
					continue;
				}
				const filter = this._parseFilterTag(raw);
				if (!filter) continue;
				const wildcard = {
					version: 1,
					id: `wildcard|level-${tableLevel}|${this._normalize(filter.label).replace(/[^a-z0-9]+/g, "-")}`,
					kind: "wildcard",
					repeatable: true,
					tableLevel,
					rowIndex,
					label: filter.label,
					filter,
					attunement: Array.isArray(row) ? row[1] : null,
				};
				entries.push(wildcard);
				for (const item of items || []) {
					if (!this._itemMatchesWildcard(item, wildcard)) continue;
					candidates.push(this._toSelection({entry: wildcard, item}));
				}
			}
		}
		return {
			version: this.VERSION,
			featureUid: this.FEATURE_UID,
			tables: tables.map(({entry, tableLevel}) => ({
				caption: entry.caption,
				tableLevel,
				rowCount: entry.rows?.length || 0,
			})),
			entries,
			candidates,
			issues,
		};
	}

	static _toSelection ({entry, item}) {
		const itemUid = this.getItemUid(item);
		return {
			version: 1,
			planUid: itemUid,
			itemUid,
			name: item.name,
			source: item.source,
			planKind: entry.kind,
			catalogEntryId: entry.id,
			categoryId: entry.kind === "wildcard" ? entry.id : null,
			categoryLabel: entry.kind === "wildcard" ? entry.label : null,
			tableLevel: entry.tableLevel,
			repeatableCategory: entry.kind === "wildcard",
			displayName: entry.kind === "fixed" ? entry.displayName : item.name,
			itemKinds: CharacterSheetItemUtils.getCanonicalItemKinds(item),
		};
	}

	static matchesCandidateConstraints ({candidate, constraints = {}} = {}) {
		if (constraints.planKinds?.length && !constraints.planKinds.includes(candidate.planKind)) return false;
		if (constraints.categoryIds?.length && !constraints.categoryIds.includes(candidate.categoryId)) return false;
		if (constraints.itemUids?.length && !constraints.itemUids.some(uid => this._normalize(uid) === this._normalize(candidate.itemUid))) return false;
		if (
			constraints.itemKinds?.length
			&& !constraints.itemKinds.some(kind =>
				(candidate.itemKinds || []).some(candidateKind => this._normalize(candidateKind) === this._normalize(kind)),
			)
		) return false;
		return true;
	}

	static getEligibleCandidates ({catalog, classLevel, constraints = {}}) {
		const byItemUid = new Map();
		for (const candidate of catalog?.candidates || []) {
			if (Number(candidate.tableLevel) > Number(classLevel)) continue;
			if (!this.matchesCandidateConstraints({candidate, constraints})) continue;
			const key = this._normalize(candidate.itemUid);
			const existing = byItemUid.get(key);
			if (!existing || (existing.planKind === "wildcard" && candidate.planKind === "fixed")) byItemUid.set(key, candidate);
		}
		return [...byItemUid.values()].sort((a, b) =>
			String(a.name).localeCompare(String(b.name))
			|| String(a.source).localeCompare(String(b.source)),
		);
	}

	static getSelectionIdentity (selection) {
		return this._normalize(selection?.itemUid || selection?.planUid || this.getItemUid(selection));
	}

	static isExactSelection (selection) {
		if (!selection || typeof selection !== "object") return false;
		return !!selection.name && !!selection.source && !!selection.itemUid && !!selection.catalogEntryId;
	}

	static validatePlanSelection ({selection, catalog, classLevel, constraints = {}}) {
		if (!this.isExactSelection(selection)) {
			return {isValid: false, code: "unresolved-plan", message: "This plan choice is missing an exact source-qualified catalog identity."};
		}
		const candidates = this.getEligibleCandidates({catalog, classLevel, constraints});
		const exact = candidates.find(candidate =>
			this.getSelectionIdentity(candidate) === this.getSelectionIdentity(selection)
			&& candidate.catalogEntryId === selection.catalogEntryId,
		);
		if (!exact) return {isValid: false, code: "ineligible-plan", message: `${selection.name} (${selection.source}) is not eligible for this opportunity.`};
		return {isValid: true, selection: this._copy(exact)};
	}

	static validateDraft ({
		catalog,
		className = this.CLASS_NAME,
		classSource = this.CLASS_SOURCE,
		decisions = [],
		initialSlots = [],
	}) {
		const slots = new Map((initialSlots || []).map(slot => [slot.slotId, this._copy(slot)]));
		const issues = [];
		const ordered = [...(decisions || [])].sort((a, b) =>
			Number(a.classLevel) - Number(b.classLevel)
			|| Number(a.kind === "replacement") - Number(b.kind === "replacement")
			|| Number(a.slot) - Number(b.slot),
		);
		for (const decision of ordered) {
			if (!this.isExactOwner({className: decision.className || className, classSource: decision.classSource || classSource})) {
				issues.push({code: "wrong-owner", opportunityId: decision.opportunityId, message: "Plan decisions belong only to Artificer|EFA."});
				continue;
			}
			if (decision.kind === "acquire") {
				if (!decision.selection) {
					if (decision.required !== false) issues.push({code: "missing-plan", opportunityId: decision.opportunityId, message: "Choose a plan for this required opportunity."});
					continue;
				}
				const validation = this.validatePlanSelection({
					selection: decision.selection,
					catalog,
					classLevel: decision.classLevel,
					constraints: decision.constraints,
				});
				if (!validation.isValid) {
					issues.push({...validation, opportunityId: decision.opportunityId});
					continue;
				}
				const duplicate = [...slots.values()].find(slot =>
					this.getSelectionIdentity(slot.selection) === this.getSelectionIdentity(validation.selection),
				);
				if (duplicate) {
					issues.push({
						code: "duplicate-plan",
						opportunityId: decision.opportunityId,
						message: `${validation.selection.name} (${validation.selection.source}) is already known in ${duplicate.slotId}.`,
					});
					continue;
				}
				slots.set(decision.slotId, {
					slotId: decision.slotId,
					acquisitionLevel: decision.classLevel,
					acquisitionOpportunityId: decision.opportunityId,
					selection: validation.selection,
					constraints: this._copy(decision.constraints || {}),
					lineage: [],
				});
				continue;
			}
			if (decision.kind !== "replacement" || !decision.selection) continue;
			const targetSlotId = decision.selection.targetSlotId;
			const target = slots.get(targetSlotId);
			if (!target) {
				issues.push({code: "missing-replacement-target", opportunityId: decision.opportunityId, message: "The plan selected for replacement no longer exists."});
				continue;
			}
			const previousIdentity = this.getSelectionIdentity(decision.selection.previousPlan);
			if (previousIdentity && previousIdentity !== this.getSelectionIdentity(target.selection)) {
				issues.push({code: "stale-replacement-lineage", opportunityId: decision.opportunityId, message: "The replacement's previous-plan receipt no longer matches its target slot."});
				continue;
			}
			const validation = this.validatePlanSelection({
				selection: decision.selection.nextPlan,
				catalog,
				classLevel: decision.classLevel,
				constraints: decision.constraints,
			});
			if (!validation.isValid) {
				issues.push({...validation, opportunityId: decision.opportunityId});
				continue;
			}
			const targetValidation = this.validatePlanSelection({
				selection: validation.selection,
				catalog,
				classLevel: decision.classLevel,
				constraints: target.constraints || {},
			});
			if (!targetValidation.isValid) {
				issues.push({...targetValidation, opportunityId: decision.opportunityId});
				continue;
			}
			if (this.getSelectionIdentity(target.selection) === this.getSelectionIdentity(validation.selection)) {
				issues.push({
					code: "same-plan-replacement",
					opportunityId: decision.opportunityId,
					message: "Choose a new plan, or keep the current plans without recording a replacement.",
				});
				continue;
			}
			const duplicate = [...slots.values()].find(slot =>
				slot.slotId !== targetSlotId
				&& this.getSelectionIdentity(slot.selection) === this.getSelectionIdentity(validation.selection),
			);
			if (duplicate) {
				issues.push({
					code: "duplicate-plan",
					opportunityId: decision.opportunityId,
					message: `${validation.selection.name} (${validation.selection.source}) is already known in ${duplicate.slotId}.`,
				});
				continue;
			}
			slots.set(targetSlotId, {
				...target,
				selection: validation.selection,
				lineage: [
					...(target.lineage || []),
					{
						replacementOpportunityId: decision.opportunityId,
						replacementLevel: decision.classLevel,
						previousPlan: this._copy(target.selection),
						nextPlan: this._copy(validation.selection),
					},
				],
			});
		}
		return {
			isValid: !issues.length,
			issues,
			slots: [...slots.values()].sort((a, b) => String(a.slotId).localeCompare(String(b.slotId))),
		};
	}

	static projectDecisions ({decisions = [], initialSlots = []} = {}) {
		const slots = new Map((initialSlots || []).map(slot => [slot.slotId, this._copy(slot)]));
		const unresolved = [];
		const ordered = [...(decisions || [])].sort((a, b) =>
			Number(a.classLevel) - Number(b.classLevel)
			|| Number((a.kind || a.meta?.kind) === "replacement") - Number((b.kind || b.meta?.kind) === "replacement")
			|| Number(a.slot) - Number(b.slot),
		);
		for (const decision of ordered) {
			const kind = decision.kind || decision.meta?.kind;
			const opportunityId = decision.opportunityId || decision.meta?.opportunityId;
			if (!decision.selection || !["resolved", null, undefined].includes(decision.status)) {
				if (decision.required || decision.selection) unresolved.push(this._copy(decision));
				continue;
			}
			if (kind === "acquire") {
				const slotId = decision.slotId || decision.meta?.slotId;
				if (!slotId || !this.isExactSelection(decision.selection)) {
					unresolved.push(this._copy(decision));
					continue;
				}
				slots.set(slotId, {
					slotId,
					acquisitionLevel: decision.classLevel,
					acquisitionOpportunityId: opportunityId,
					selection: this._copy(decision.selection),
					constraints: this._copy(decision.constraints || decision.meta?.constraints || {}),
					lineage: [],
				});
				continue;
			}
			if (kind !== "replacement") continue;
			const target = slots.get(decision.selection.targetSlotId);
			if (!target || !this.isExactSelection(decision.selection.nextPlan)) {
				unresolved.push(this._copy(decision));
				continue;
			}
			if (this.getSelectionIdentity(target.selection) === this.getSelectionIdentity(decision.selection.nextPlan)) {
				unresolved.push(this._copy(decision));
				continue;
			}
			slots.set(target.slotId, {
				...target,
				selection: this._copy(decision.selection.nextPlan),
				lineage: [
					...(target.lineage || []),
					{
						replacementOpportunityId: opportunityId,
						replacementLevel: decision.classLevel,
						previousPlan: this._copy(target.selection),
						nextPlan: this._copy(decision.selection.nextPlan),
						semanticKey: decision.semanticKey || null,
					},
				],
			});
		}
		return {
			slots: [...slots.values()].sort((a, b) => String(a.slotId).localeCompare(String(b.slotId))),
			unresolved,
		};
	}

	static toHistoryChoices (decisions) {
		const acquisitions = (decisions || [])
			.filter(decision => (decision.kind || decision.meta?.kind) === "acquire" && decision.selection)
			.map(decision => ({
				opportunityId: decision.opportunityId || decision.meta?.opportunityId,
				slotId: decision.slotId || decision.meta?.slotId,
				acquisitionLevel: decision.classLevel,
				selection: this._copy(decision.selection),
			}));
		const replacements = (decisions || [])
			.filter(decision => (decision.kind || decision.meta?.kind) === "replacement" && decision.selection)
			.map(decision => ({
				opportunityId: decision.opportunityId || decision.meta?.opportunityId,
				replacementLevel: decision.classLevel,
				selection: this._copy(decision.selection),
			}));
		return {
			...(acquisitions.length ? {[this.CHOICE_KEY_ACQUIRE]: acquisitions} : {}),
			...(replacements.length ? {[this.CHOICE_KEY_REPLACE]: replacements} : {}),
		};
	}

	static getDecisionReceipt (decision) {
		if (!decision?.selection) return null;
		const isReplacement = decision.kind === "replacement" || decision.type === this.DECISION_TYPE_REPLACE;
		return {
			version: 1,
			family: "artificer-plan",
			sourceDecisionKey: decision.semanticKey || null,
			opportunityId: decision.opportunityId || decision.meta?.opportunityId || null,
			owner: this._copy(decision.owner || decision.meta?.owner || null),
			decisionLevel: Number(decision.classLevel) || null,
			acquisitionLevel: isReplacement ? null : (Number(decision.classLevel) || null),
			replacementLevel: isReplacement ? (Number(decision.classLevel) || null) : null,
			slotId: isReplacement ? decision.selection.targetSlotId : (decision.slotId || decision.meta?.slotId || null),
			selection: this._copy(isReplacement ? decision.selection.nextPlan : decision.selection),
			lineage: isReplacement ? {
				previousPlan: this._copy(decision.selection.previousPlan),
				nextPlan: this._copy(decision.selection.nextPlan),
				priorReplacementSemanticKey: decision.selection.priorReplacementSemanticKey || null,
			} : null,
			effects: [{
				type: "configuration",
				key: "artificer-plan",
				value: isReplacement ? "replacement" : "acquisition",
			}],
		};
	}
}

export {CharacterSheetArtificerPlans};
globalThis.CharacterSheetArtificerPlans = CharacterSheetArtificerPlans;
