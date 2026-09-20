import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";

/**
 * Shared progression analysis and history-ledger helpers.
 *
 * This module is intentionally controller-free. Builder, Level Up, Quick Build,
 * and Respec can all ask the same questions about a chronological class timeline
 * without duplicating the rules which create decision opportunities.
 */
class CharacterSheetProgression {
	static LEDGER_VERSION = 3;
	static MANIFEST_VERSION = 2;

	static DECISION_STATUSES = new Set(["resolved", "deferred", "missing", "invalid", "ambiguous"]);

	static DECISION_ADAPTERS = Object.freeze({
		class: {discovery: "timeline", editor: "class", validation: "class-reference", mechanics: "class-reassignment", projection: ["class"]},
		skills: {discovery: "starting-proficiencies", editor: "manifest-options", validation: "option-count", mechanics: "skill-proficiencies", projection: ["choices.skills"]},
		tools: {discovery: "starting-and-feature-proficiencies", editor: "manifest-options", validation: "option-count", mechanics: "tool-proficiencies", projection: ["choices.tools"]},
		expertise: {discovery: "class-features", editor: "manifest-options", validation: "option-count", mechanics: "skill-expertise", projection: ["choices.expertise"]},
		languages: {discovery: "class-features", editor: "languages", validation: "option-count", mechanics: "languages", projection: ["choices.languages"]},
		subclass: {discovery: "class-features", editor: "subclass", validation: "entity-option", mechanics: "subclass-reassignment", projection: ["choices.subclass"]},
		subclassChoice: {discovery: "subclass-data", editor: "manifest-options", validation: "entity-option", mechanics: "subclass-choice-refresh", projection: ["choices.subclassChoice"]},
		asi: {discovery: "class-features", editor: "improvement", validation: "asi-total", mechanics: "ability-scores", projection: ["choices.asi"]},
		feat: {discovery: "class-features-and-feat-progression", editor: "improvement", validation: "eligible-feat", mechanics: "feat-transaction", projection: ["choices.feat"]},
		asiOrFeat: {discovery: "class-features", editor: "improvement", validation: "improvement-mode", mechanics: "improvement-transaction", projection: ["choices.asi", "choices.feat"]},
		optionalFeatures: {discovery: "optional-feature-progression", editor: "optional-features", validation: "option-count", mechanics: "optional-features", projection: ["choices.optionalFeatures"]},
		featureChoice: {discovery: "feature-options", editor: "feature-choice", validation: "option-count", mechanics: "feature-choice", projection: ["choices.featureChoices"]},
		classFeatProgressionFeat: {discovery: "feat-progression", editor: "class-feat", validation: "eligible-feat", mechanics: "feat-transaction", projection: ["choices.classFeatProgressionFeats"]},
		combatTraditions: {discovery: "legacy-and-class-features", editor: "combat-traditions", validation: "option-count", mechanics: "combat-traditions", projection: ["choices.combatTraditions"]},
		combatMethods: {discovery: "legacy-and-class-features", editor: "combat-methods", validation: "option-count", mechanics: "combat-methods", projection: ["choices.combatMethods"]},
		weaponMasteries: {discovery: "class-progression", editor: "weapon-masteries", validation: "option-count", mechanics: "weapon-masteries", projection: ["choices.weaponMasteries"]},
		spellbookSpells: {discovery: "spell-progression", editor: "spells", validation: "legal-spell-set", mechanics: "known-spells", projection: ["choices.spellbookSpells"]},
		knownSpells: {discovery: "spell-progression", editor: "spells", validation: "legal-spell-set", mechanics: "known-spells", projection: ["choices.knownSpells"]},
		cantrips: {discovery: "spell-progression", editor: "spells", validation: "legal-spell-set", mechanics: "known-or-prepared-cantrips", projection: ["choices.knownCantrips", "choices.preparedCantrips"]},
		preparedSpells: {discovery: "spell-progression", editor: "spells", validation: "legal-spell-set", mechanics: "prepared-spells", projection: ["choices.preparedSpells"]},
		preparedCantrips: {discovery: "spell-progression", editor: "spells", validation: "legal-spell-set", mechanics: "prepared-cantrips", projection: ["choices.preparedCantrips"]},
		spellSwap: {discovery: "spell-progression", editor: "spell-swap", validation: "legal-spell-swap", mechanics: "known-spells", projection: ["choices.spellSwap"]},
		scholar: {discovery: "class-features", editor: "scholar", validation: "skill-option", mechanics: "skill-expertise", projection: ["choices.scholarSkill"]},
		spellMastery: {discovery: "class-features", editor: "spell-mastery", validation: "spell-mastery-levels", mechanics: "spell-mastery", projection: ["choices.spellMasterySpells"]},
		signatureSpells: {discovery: "class-features", editor: "signature-spells", validation: "signature-spell-levels", mechanics: "signature-spells", projection: ["choices.signatureSpells"]},
		hp: {discovery: "class-level", editor: "hit-points", validation: "hit-point-method", mechanics: "hit-points", projection: ["choices.hpRoll"]},
		nestedEntity: {discovery: "nested-descriptor", editor: "nested-choice", validation: "entity-option", mechanics: "nested-entity", projection: []},
		nestedSkill: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "skill-proficiencies", projection: []},
		nestedSkillTool: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "union-proficiencies", projection: []},
		nestedExpertise: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "skill-expertise", projection: []},
		nestedTool: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "tool-proficiencies", projection: []},
		nestedLanguage: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "languages", projection: []},
		nestedAbility: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "ability-configuration", projection: []},
		nestedSave: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "saving-throws", projection: []},
		nestedWeapon: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "weapon-proficiencies", projection: []},
		nestedArmor: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "armor-proficiencies", projection: []},
		nestedResistance: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "resistances", projection: []},
		nestedSpell: {discovery: "nested-descriptor", editor: "nested-choice", validation: "legal-spell-set", mechanics: "nested-spells", projection: []},
		nestedCantrip: {discovery: "nested-descriptor", editor: "nested-choice", validation: "legal-spell-set", mechanics: "nested-spells", projection: []},
		nestedFeat: {discovery: "nested-descriptor", editor: "nested-choice", validation: "eligible-feat", mechanics: "feat-transaction", projection: []},
		nestedOptionalFeature: {discovery: "nested-descriptor", editor: "nested-choice", validation: "entity-option", mechanics: "optional-features", projection: []},
		nestedConfiguration: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "nested-configuration", projection: []},
		originRace: {discovery: "base-node", editor: "nested-choice", validation: "entity-option", mechanics: "origin-race", projection: []},
		originBackground: {discovery: "base-node", editor: "nested-choice", validation: "entity-option", mechanics: "origin-background", projection: []},
	});

	static ADAPTER_EDITOR_HANDLERS = new Set([
		"class", "manifest-options", "languages", "subclass", "improvement", "feat",
		"optional-features", "feature-choice", "class-feat", "combat-traditions",
		"combat-methods", "weapon-masteries", "spells", "spell-swap", "scholar",
		"spell-mastery", "signature-spells", "hit-points", "nested-choice",
	]);

	static ADAPTER_MECHANICS_HANDLERS = new Set([
		"class-reassignment", "skill-proficiencies", "tool-proficiencies",
		"skill-expertise", "languages", "subclass-reassignment", "subclass-choice-refresh",
		"ability-scores", "feat-transaction", "improvement-transaction",
		"optional-features", "feature-choice", "combat-traditions", "combat-methods",
		"weapon-masteries", "known-spells", "known-or-prepared-cantrips",
		"prepared-spells", "prepared-cantrips", "spell-swap", "skill-expertise",
		"spell-mastery", "signature-spells", "hit-points", "nested-entity",
		"union-proficiencies", "ability-configuration", "saving-throws",
		"weapon-proficiencies", "armor-proficiencies", "resistances", "nested-spells",
		"nested-configuration", "origin-race", "origin-background",
	]);

	// The state layer currently uses the same named family for forward and
	// reverse operations. Keep explicit closure sets so a newly registered
	// adapter cannot accidentally become a display-only manifest row.
	static ADAPTER_APPLY_HANDLERS = new Set(CharacterSheetProgression.ADAPTER_MECHANICS_HANDLERS);
	static ADAPTER_REVERSE_HANDLERS = new Set(CharacterSheetProgression.ADAPTER_MECHANICS_HANDLERS);

	static getAdapterClosureIssues () {
		const issues = [];
		for (const [type, adapter] of Object.entries(CharacterSheetProgression.DECISION_ADAPTERS)) {
			if (!CharacterSheetProgression.ADAPTER_EDITOR_HANDLERS.has(adapter.editor)) {
				issues.push({code: "adapter-missing-editor", type, handler: adapter.editor});
			}
			if (!CharacterSheetProgression.ADAPTER_MECHANICS_HANDLERS.has(adapter.mechanics)) {
				issues.push({code: "adapter-missing-mechanics", type, handler: adapter.mechanics});
			}
			if (!CharacterSheetProgression.ADAPTER_APPLY_HANDLERS.has(adapter.mechanics)) {
				issues.push({code: "adapter-missing-apply", type, handler: adapter.mechanics});
			}
			if (!CharacterSheetProgression.ADAPTER_REVERSE_HANDLERS.has(adapter.mechanics)) {
				issues.push({code: "adapter-missing-reverse", type, handler: adapter.mechanics});
			}
		}
		return issues;
	}

	static getDecisionAdapter (type) {
		return CharacterSheetProgression.DECISION_ADAPTERS[type] || null;
	}

	static _copy (value) {
		if (value == null) return value;
		if (globalThis.MiscUtil?.copyFast) return MiscUtil.copyFast(value);
		return JSON.parse(JSON.stringify(value));
	}

	static _normalize (value) {
		return String(value || "").trim().toLowerCase();
	}

	static _slug (value) {
		return CharacterSheetProgression._normalize(value)
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown";
	}

	static getEntityUid (entity) {
		if (!entity?.name) return "";
		return `${CharacterSheetProgression._normalize(entity.name)}|${CharacterSheetProgression._normalize(entity.source)}`;
	}

	static getClassUid (nameOrEntity, source) {
		if (typeof nameOrEntity === "object") return CharacterSheetProgression.getEntityUid(nameOrEntity);
		return CharacterSheetProgression.getEntityUid({name: nameOrEntity, source});
	}

	static getSemanticKey ({className, classSource, classLevel, type, sourceKey = "", slot = 0}) {
		return [
			CharacterSheetProgression.getClassUid(className, classSource),
			`cl${Number(classLevel) || 0}`,
			CharacterSheetProgression._slug(type),
			CharacterSheetProgression._slug(sourceKey),
			`slot${Number(slot) || 0}`,
		].join(":");
	}

	static getDecisionId ({semanticKey, characterLevel}) {
		return `${semanticKey}@level-${Number(characterLevel) || 0}`;
	}

	static getAcquisitionKey ({ownerType, ownerUid, classLevel = 0, sourcePath = "", occurrence = 0}) {
		return [
			CharacterSheetProgression._slug(ownerType || "entity"),
			CharacterSheetProgression._slug(ownerUid || "unknown"),
			`cl${Number(classLevel) || 0}`,
			CharacterSheetProgression._slug(sourcePath || "root"),
			`occ${Number(occurrence) || 0}`,
		].join(":");
	}

	static getOriginSemanticKey ({originType, originUid, grantKey = "", slot = 0}) {
		return [
			"base",
			CharacterSheetProgression._slug(originType || "origin"),
			CharacterSheetProgression._slug(originUid || "unknown"),
			CharacterSheetProgression._slug(grantKey || "choice"),
			`slot${Number(slot) || 0}`,
		].join(":");
	}

	static getNestedSemanticKey ({parentSemanticKey = null, acquisitionKey = "", grantKey = "", selectedGrantKey = "", occurrence = 0, slot = 0}) {
		const anchor = parentSemanticKey || acquisitionKey || "nested";
		return [
			"nested",
			CharacterSheetProgression._slug(anchor),
			CharacterSheetProgression._slug(selectedGrantKey || grantKey || "choice"),
			`occ${Number(occurrence) || 0}`,
			`slot${Number(slot) || 0}`,
		].join(":");
	}

	static getDecisionTypeForDescriptor (descriptor, {nested = true} = {}) {
		const kind = String(descriptor?.kind || "configuration");
		if (!nested) return kind;
		const normalized = kind === "skillTool" ? "skillTool" : kind;
		return `nested${normalized[0].toUpperCase()}${normalized.slice(1)}`;
	}

	static _getSelectionCount (selection) {
		if (selection == null) return 0;
		if (Array.isArray(selection)) return selection.length;
		if (typeof selection === "object") return Object.keys(selection).length ? 1 : 0;
		return 1;
	}

	static _getDecisionStatus ({selection, count = 1, required = true, status = null, isValid = true}) {
		if (status && CharacterSheetProgression.DECISION_STATUSES.has(status)) return status;
		const selectionCount = CharacterSheetProgression._getSelectionCount(selection);
		if (!isValid && selectionCount) return "invalid";
		if (!required && !selectionCount) return "deferred";
		if (selectionCount < Math.max(1, Number(count) || 1)) return "missing";
		return "resolved";
	}

	static _getDecisionReceipt ({semanticKey, type, selection, meta = {}}) {
		if (selection == null) return null;
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
		};
		const values = Array.isArray(selection) ? selection : [selection];
		const effects = [];
		if (typeMap[type]) effects.push({type: "ownership", ownership: values.map(value => ({type: typeMap[type], value}))});
		if (type === "nestedAbility") {
			effects.push(...values.map(value => ({
				type: "abilityDelta",
				ability: String(value),
				amount: Number(meta.descriptorRules?.amount) || 1,
			})));
		}
		if (type === "nestedConfiguration") effects.push(...values.map(value => ({type: "configuration", value})));
		return {version: 1, sourceDecisionKey: semanticKey, effects};
	}

	static _isSelectionValid ({selection, count = 1, options = [], type}) {
		const selectionCount = CharacterSheetProgression._getSelectionCount(selection);
		if (selection == null) return true;
		if (selectionCount !== Math.max(1, Number(count) || 1)) return false;
		if (type === "asi") {
			return Object.values(selection).reduce((sum, value) => sum + (Number(value) || 0), 0) === 2;
		}
		if (type === "asiOrFeat") {
			if (selection.mode === "feat") return !!selection.feat?.name;
			if (selection.mode === "asi") {
				return Object.values(selection.asi || {}).reduce((sum, value) => sum + (Number(value) || 0), 0) === 2;
			}
			return false;
		}
		if (type === "hp") {
			return selection.method === "average"
				|| (selection.method === "roll" && Number.isFinite(Number(selection.value)) && Number(selection.value) >= 1);
		}
		if (type === "spellSwap") {
			if (!selection.removed?.name || !selection.added?.name) return false;
			if (!Array.isArray(options) || !options.length) return true;
			return options.some(option =>
				CharacterSheetProgression.getEntityUid(option) === CharacterSheetProgression.getEntityUid(selection.added),
			);
		}
		if (type === "spellMastery") {
			if (!Array.isArray(selection) || selection.length !== 2) return false;
			if (!selection.every(spell => [1, 2].includes(Number(spell.level)))) return false;
			if (new Set(selection.map(spell => Number(spell.level))).size !== 2) return false;
		}
		if (type === "signatureSpells") {
			if (!Array.isArray(selection) || selection.length !== 2) return false;
			if (!selection.every(spell => Number(spell.level) === 3)) return false;
		}
		if (!Array.isArray(options) || !options.length) return true;
		options = options.filter(option => option?._selectable !== false);
		const getOptionKeys = option => {
			const out = new Set();
			const add = value => {
				const normalized = CharacterSheetProgression._normalize(value);
				if (!normalized) return;
				out.add(normalized);
				out.add(normalized.replace(/['\s]+/g, ""));
			};
			if (typeof option === "string") {
				add(option);
				return out;
			}
			const name = option?.name || option?.choice || option?.label;
			add(name);
			if (name && option?.source) {
				const source = CharacterSheetProgression._normalize(option.source);
				for (const key of [...out]) out.add(`${key}|${source}`);
			}
			return out;
		};
		const optionKeys = new Set(options.flatMap(option => [...getOptionKeys(option)]));
		const selectedValues = Array.isArray(selection) ? selection : [selection];
		return selectedValues.every(value => [...getOptionKeys(value)].some(key => optionKeys.has(key)));
	}

	static _getEntityChoiceDescriptors (entity, opts = {}) {
		return CharacterSheetClassUtils.getChoiceDescriptors?.(entity, opts) || [];
	}

	static _getSelectedDescriptorValue ({descriptor, entity, state, parentDecision = null, legacyChoices = null}) {
		const values = [];
		const choices = [
			legacyChoices,
			entity?.choices,
			entity?._featChoices,
			entity?.choice,
			entity?.selectedChoices,
		].filter(Boolean);
		const pathTail = String(descriptor?.grantKey || "").split(".").at(-1);
		const pathKey = pathTail.replace(/\[\d+\]$/, "");
		for (const choice of choices) {
			if (choice) {
				for (const key of [pathKey, pathTail]) {
					if (!key || !Object.prototype.hasOwnProperty.call(choice, key)) continue;
					const value = choice[key];
					if (value != null) {
						if (pathTail !== pathKey && Array.isArray(value)) {
							const index = Number(pathTail.match(/\[(\d+)\]$/)?.[1]);
							return CharacterSheetProgression._copy(value[index] ?? value);
						}
						return CharacterSheetProgression._copy(value);
					}
				}
			}
			for (const key of [descriptor?.grantKey, descriptor?.label, descriptor?.sourcePath]) {
				if (!key || !Object.prototype.hasOwnProperty.call(choice || {}, key)) continue;
				const value = choice[key];
				if (value != null) return CharacterSheetProgression._copy(value);
			}
		}
		const sourcePath = String(descriptor?.sourcePath || descriptor?.grantKey || "");
		const choiceIndex = Number(sourcePath.match(/\[(\d+)\]/)?.[1] || 0);
		const originChoices = legacyChoices || {};
		if (descriptor?.kind === "ability") {
			if (sourcePath.includes("additionalSpells")) {
				const selected = originChoices.selectedRacialSpellAbilities?.[choiceIndex];
				if (selected != null) return selected;
			}
			if (sourcePath.includes(".ability[")) {
				const selected = originChoices.selectedAbilityChoices?.[`choose_${choiceIndex}_0`] ??
					originChoices.selectedAbilityChoices?.[sourcePath.match(/ability\[(\d+)\]/)?.[1] || choiceIndex];
				if (selected != null) return CharacterSheetProgression._copy(selected);
				const backgroundSelected = originChoices.selectedAbilityBonuses?.[`bg_${choiceIndex}`];
				if (backgroundSelected != null) return backgroundSelected;
			}
		}
		const stateChoices = [
			...(state?.getPendingFeatureChoices?.() || []),
			...(state?.getPendingSpellChoices?.() || []),
		].filter(choice => {
			const owner = String(choice.featureName || choice.featureId || "").toLowerCase();
			return owner && (
				owner === String(entity?.name || "").toLowerCase()
					|| owner === String(parentDecision?.provenance?.ownerUid || "").toLowerCase()
			);
		});
		const pending = stateChoices.find(choice =>
			String(choice.kind || "").toLowerCase() === String(descriptor.kind || "").toLowerCase()
					|| (descriptor.kind === "cantrip" && choice.kind === "cantrip"),
		);
		if (pending?.selection != null) return CharacterSheetProgression._copy(pending.selection);

		if (descriptor.kind === "entity") {
			const chosen = state?.getChosenSubfeatures?.() || [];
			const current = chosen.find(record =>
				String(record.parent || "").toLowerCase() === String(entity?.name || "").toLowerCase(),
			);
			if (current) {
				return {
					name: current.name,
					source: current.source,
				};
			}
		}
		return values.length ? values : null;
	}

	static _resolveNestedEntity ({option, page, parentEntity = null}) {
		if (!option) return null;
		if (typeof option === "string") option = {name: option};
		if (option.choice && !option.name) {
			option = {
				...option,
				name: option.choice,
				type: option.type || "optionalfeature",
			};
		}
		if (option.entries || option.choose || option.choices || option._featChoices) return option;
		const ref = option.ref || option.classFeature || option.subclassFeature || option.optionalfeature;
		const name = option.name || (typeof ref === "string" ? ref.split("|")[0] : "");
		const source = option.source || (typeof ref === "string" ? ref.split("|")[1] : "");
		const type = String(option.type || "").toLowerCase();
		if (type.includes("optional") || option.optionalfeature) {
			return (page?.getOptionalFeatures?.() || []).find(feature =>
				CharacterSheetProgression._normalize(feature.name) === CharacterSheetProgression._normalize(name)
						&& (!source || CharacterSheetProgression._normalize(feature.source) === CharacterSheetProgression._normalize(source)),
			) || null;
		}
		const optional = (page?.getOptionalFeatures?.() || []).find(feature =>
			CharacterSheetProgression._normalize(feature.name) === CharacterSheetProgression._normalize(name)
				&& (!source || CharacterSheetProgression._normalize(feature.source) === CharacterSheetProgression._normalize(source)),
		);
		if (optional) return optional;
		if (type.includes("class") || option.classFeature || ref?.split("|").length >= 4) {
			const parts = String(ref || "").split("|");
			return CharacterSheetClassUtils.getClassFeatureData?.(
				page?.getClassFeatures?.() || [],
				parts[0] || name,
				parts[1] || option.className || parentEntity?.className,
				parts[2] || source,
				Number(parts[3]) || option.level || 1,
			) || null;
		}
		if (type.includes("subclass") || option.subclassFeature) {
			return (page?.getSubclassFeatures?.() || []).find(feature =>
				CharacterSheetProgression._normalize(feature.name) === CharacterSheetProgression._normalize(name)
						&& (!source || CharacterSheetProgression._normalize(feature.source) === CharacterSheetProgression._normalize(source)),
			) || null;
		}
		const feat = (page?.getFeats?.() || []).find(candidate =>
			CharacterSheetProgression._normalize(candidate.name) === CharacterSheetProgression._normalize(name)
					&& (!source || CharacterSheetProgression._normalize(candidate.source) === CharacterSheetProgression._normalize(source)),
		);
		return feat || null;
	}

	static _getNestedSelectionFallback ({descriptor, entity, state}) {
		const selected = CharacterSheetProgression._getSelectedDescriptorValue({descriptor, entity, state});
		if (selected != null && (!Array.isArray(selected) || selected.length)) return selected;
		if (descriptor.kind === "entity") {
			const records = state?.getChosenSubfeatures?.() || [];
			const record = records.find(it => String(it.parent || "").toLowerCase() === String(entity?.name || "").toLowerCase());
			if (record) return {name: record.name, source: record.source};
		}
		return null;
	}

	static _discoverNestedForEntity ({
		entity,
		page,
		state,
		levelInfo,
		decisions,
		levelDecisions,
		storedPool,
		parentDecision = null,
		parentEntity = null,
		acquisitionKey,
		rootSemanticKey = null,
		depth = 1,
		visited = new Set(),
		issues,
		scope = "nested",
	}) {
		if (!entity || depth > 12) {
			if (depth > 12) {
				issues.push({
					level: levelInfo?.characterLevel || 0,
					severity: "error",
					code: "nested-depth-limit",
					message: `Nested choice discovery exceeded its safety depth near ${entity?.name || "unknown entity"}.`,
				});
			}
			return;
		}
		const descriptors = CharacterSheetProgression._getEntityChoiceDescriptors(entity, {
			sourcePath: entity.name || "entity",
			className: levelInfo?.className,
			classSource: levelInfo?.classSource,
		});
		const census = CharacterSheetClassUtils.getChoiceDescriptorCensus?.(entity);
		for (const unsupported of census?.entries?.filter(entry =>
			entry.classification === "unclassified" && entry.required !== false,
		) || []) {
			issues.push({
				level: levelInfo?.characterLevel || 0,
				severity: "error",
				code: "unsupported-required-choice",
				message: `Unsupported required choice shape on ${entity.name || "unknown entity"} at ${unsupported.path || "unknown path"}.`,
				sourcePath: unsupported.path,
				ownerUid: CharacterSheetProgression.getEntityUid(entity),
			});
		}
		descriptors.forEach((descriptor, descriptorIx) => {
			// A class/subclass feature's entity option is already represented by
			// the canonical featureChoice decision emitted for that level. Do not
			// duplicate it as an unparented nestedEntity; recurse from the selected
			// featureChoice below so all descendants retain the graph edge.
			if (!parentDecision
					&& descriptor.kind === "entity"
					&& decisions.some(decision =>
						decision.type === "featureChoice"
						&& CharacterSheetProgression._normalize(decision.label) === CharacterSheetProgression._normalize(entity.name),
					)) return;
			if (descriptor.required
					&& !descriptor.options?.length
					&& descriptor.rules?.optionSource?.kind !== "filter") {
				issues.push({
					level: levelInfo?.characterLevel || 0,
					severity: "error",
					code: "missing-choice-catalog",
					message: `No legal choice catalog is available for ${descriptor.label} on ${entity.name || "unknown entity"} (${descriptor.sourcePath}).`,
					sourcePath: descriptor.sourcePath,
					ownerUid: CharacterSheetProgression.getEntityUid(entity),
				});
			}
			const descriptorAcquisitionKey = acquisitionKey || CharacterSheetProgression.getAcquisitionKey({
				ownerType: "feature",
				ownerUid: CharacterSheetProgression.getEntityUid(entity),
				classLevel: levelInfo?.classLevel,
				sourcePath: descriptor.sourcePath,
				occurrence: descriptor.occurrence ?? descriptorIx,
			});
			const selectedGrant = CharacterSheetProgression._getNestedSelectionFallback({descriptor, entity, state});
			const selectedValues = Array.isArray(selectedGrant) ? selectedGrant : (selectedGrant == null ? [] : [selectedGrant]);
			const selectedKeys = selectedValues.map(value => CharacterSheetProgression.getEntityUid(value) || CharacterSheetProgression._slug(value));
			const visitedKey = [
				CharacterSheetProgression.getEntityUid(entity),
				descriptorAcquisitionKey,
				descriptor.grantKey,
				selectedKeys.join(","),
				descriptor.occurrence,
			].join("|");
			if (visited.has(visitedKey)) {
				issues.push({
					level: levelInfo?.characterLevel || 0,
					severity: "error",
					code: "nested-cycle",
					message: `Nested choice cycle detected at ${entity.name || "unknown"} (${descriptor.sourcePath}).`,
				});
				return;
			}
			const nextVisited = new Set(visited);
			nextVisited.add(visitedKey);
			const type = CharacterSheetProgression.getDecisionTypeForDescriptor(descriptor);
			const parentSemanticKey = parentDecision?.semanticKey || null;
			const semanticKey = CharacterSheetProgression.getNestedSemanticKey({
				parentSemanticKey,
				acquisitionKey: descriptorAcquisitionKey,
				grantKey: descriptor.grantKey,
				selectedGrantKey: selectedKeys.join("|"),
				occurrence: descriptor.occurrence,
				slot: descriptorIx,
			});
			const exact = storedPool.get(semanticKey)?.find(decision => decision.selection != null);
			const selection = exact?.selection ?? selectedGrant;
			const isValid = CharacterSheetProgression._isSelectionValid({
				selection,
				count: descriptor.count,
				options: descriptor.options,
				type,
			});
			const decision = CharacterSheetProgression._makeDecision({
				...levelInfo,
				characterLevel: levelInfo?.characterLevel || 0,
				className: levelInfo?.className || "Unknown",
				classSource: levelInfo?.classSource || "",
				classLevel: levelInfo?.classLevel || 0,
				type,
				label: descriptor.label,
				sourceKey: descriptor.grantKey,
				slot: descriptorIx,
				required: descriptor.required,
				count: descriptor.count,
				options: descriptor.options,
				selection,
				status: exact?.status || null,
				isValid,
				meta: {descriptorRules: descriptor.rules},
				scope,
				parentSemanticKey,
				rootSemanticKey: rootSemanticKey || semanticKey,
				depth,
				semanticKeyOverride: semanticKey,
				provenance: {
					ownerType: parentEntity?.featureType || "classFeature",
					ownerUid: CharacterSheetProgression.getEntityUid(entity),
					acquisitionKey: descriptorAcquisitionKey,
					selectedGrantKey: selectedKeys.join("|") || null,
					grantKind: descriptor.kind,
					grantKey: descriptor.grantKey,
					sourcePath: descriptor.sourcePath,
					occurrence: descriptor.occurrence,
					pickSlot: descriptorIx,
				},
			});
			decisions.push(decision);
			levelDecisions.push(decision);

			if (descriptor.kind !== "entity" && !["feat", "optionalFeature"].includes(descriptor.kind)) return;
			selectedValues.forEach((value, valueIx) => {
				const selectedEntity = CharacterSheetProgression._resolveNestedEntity({option: value, page, parentEntity: entity});
				if (!selectedEntity) {
					if (value && (value.ref || value.name)) {
						issues.push({
							level: levelInfo?.characterLevel || 0,
							severity: "error",
							code: "missing-nested-reference",
							message: `Could not resolve nested grant ${value.name || value.ref} from ${entity.name || "unknown"}.`,
							sourcePath: descriptor.sourcePath,
						});
					}
					return;
				}
				const childAcquisitionKey = CharacterSheetProgression.getAcquisitionKey({
					ownerType: descriptor.kind,
					ownerUid: CharacterSheetProgression.getEntityUid(selectedEntity),
					classLevel: levelInfo?.classLevel,
					sourcePath: `${descriptorAcquisitionKey}.${descriptor.grantKey}`,
					occurrence: valueIx,
				});
				CharacterSheetProgression._discoverNestedForEntity({
					entity: selectedEntity,
					page,
					state,
					levelInfo,
					decisions,
					levelDecisions,
					storedPool,
					parentDecision: decision,
					parentEntity: entity,
					acquisitionKey: childAcquisitionKey,
					rootSemanticKey: rootSemanticKey || semanticKey,
					depth: depth + 1,
					visited: nextVisited,
					issues,
					scope,
				});
			});
		});
	}

	static _buildOriginManifest ({page, state, storedBasePool, issues}) {
		const base = {scope: "origin", characterLevel: 0, decisions: []};
		const addOrigin = (originType, entity, choices, originIx) => {
			if (!entity) return;
			const originUid = CharacterSheetProgression.getEntityUid(entity);
			const entityType = originType === "race" ? "originRace" : "originBackground";
			const entityKey = CharacterSheetProgression.getOriginSemanticKey({
				originType,
				originUid,
				grantKey: "entity",
			});
			const entityStored = storedBasePool.get(entityKey)?.find(decision => decision.selection != null);
			const entityDecision = CharacterSheetProgression._makeDecision({
				characterLevel: 0,
				className: "Base",
				classSource: "",
				classLevel: 0,
				type: entityType,
				label: originType === "race" ? "Species" : "Background",
				sourceKey: `base:${originType}`,
				count: 1,
				options: [{name: entity.name, source: entity.source}],
				selection: entityStored?.selection || {name: entity.name, source: entity.source},
				scope: "origin",
				semanticKeyOverride: entityKey,
				rootSemanticKey: entityKey,
				provenance: {
					ownerType: originType,
					ownerUid: originUid,
					acquisitionKey: `base:${originType}:${originUid}`,
					selectedGrantKey: originUid,
					grantKind: "entity",
					grantKey: "entity",
					sourcePath: originType,
					occurrence: originIx,
					pickSlot: 0,
				},
			});
			base.decisions.push(entityDecision);
			const descriptors = CharacterSheetProgression._getEntityChoiceDescriptors(entity, {sourcePath: originType});
			const census = CharacterSheetClassUtils.getChoiceDescriptorCensus?.(entity);
			for (const unsupported of census?.entries?.filter(entry =>
				entry.classification === "unclassified" && entry.required !== false,
			) || []) {
				issues.push({
					level: 0,
					severity: "error",
					code: "unsupported-required-choice",
					message: `Unsupported required origin choice shape on ${entity.name || "unknown entity"} at ${unsupported.path || originType}.`,
					sourcePath: unsupported.path || originType,
					ownerUid: originUid,
				});
			}
			descriptors.forEach((descriptor, slot) => {
				if (descriptor.required
						&& !descriptor.options?.length
						&& descriptor.rules?.optionSource?.kind !== "filter") {
					issues.push({
						level: 0,
						severity: "error",
						code: "missing-choice-catalog",
						message: `No legal origin choice catalog is available for ${descriptor.label} on ${entity.name || "unknown entity"} (${descriptor.sourcePath}).`,
						sourcePath: descriptor.sourcePath,
						ownerUid: originUid,
					});
				}
				const type = CharacterSheetProgression.getDecisionTypeForDescriptor(descriptor);
				const key = CharacterSheetProgression.getOriginSemanticKey({
					originType,
					originUid,
					grantKey: descriptor.grantKey,
					slot,
				});
				const selected = CharacterSheetProgression._getSelectedDescriptorValue({
					descriptor,
					entity,
					state,
					legacyChoices: choices,
				});
				const selectedFallback = selected ??
					choices?.[`selected${descriptor.kind[0].toUpperCase()}${descriptor.kind.slice(1)}s`] ??
					(descriptor.kind === "ability" && descriptor.sourcePath.includes("additionalSpells")
						? descriptor.options?.[0]
						: null);
				// Some legacy Builder paths allowed the character to continue without
				// assigning a bonus from an origin's weighted ability block. Keep those
				// rows visible and editable, but do not make an absent historical
				// assignment block an otherwise unrelated Respec Apply.
				const hasAssignedAbilityChoice = Object.values(choices?.selectedAbilityChoices || {})
					.some(value => value && typeof value === "object" && Object.keys(value).some(key => !key.endsWith("_amount")));
				const hasAssignedAbilityBonus = Object.keys(choices?.selectedAbilityBonuses || {}).some(key => !key.endsWith("_weight"));
				const isUnassignedLegacyAbility = descriptor.kind === "ability"
					&& selectedFallback == null
					&& !hasAssignedAbilityChoice
					&& !hasAssignedAbilityBonus;
				const decision = CharacterSheetProgression._makeDecision({
					characterLevel: 0,
					className: "Base",
					classSource: "",
					classLevel: 0,
					type,
					label: descriptor.label,
					sourceKey: descriptor.grantKey,
					slot,
					count: descriptor.count,
					required: descriptor.required && !isUnassignedLegacyAbility,
					options: descriptor.options,
					selection: selectedFallback,
					meta: {descriptorRules: descriptor.rules},
					scope: "origin",
					semanticKeyOverride: key,
					rootSemanticKey: entityKey,
					depth: 1,
					parentSemanticKey: entityKey,
					provenance: {
						ownerType: originType,
						ownerUid: originUid,
						acquisitionKey: `base:${originType}:${originUid}`,
						selectedGrantKey: originUid,
						grantKind: descriptor.kind,
						grantKey: descriptor.grantKey,
						sourcePath: descriptor.sourcePath,
						occurrence: descriptor.occurrence,
						pickSlot: slot,
					},
				});
				base.decisions.push(decision);

				// Origin descriptors can themselves select a feature/feat with
				// another descriptor below it. Keep the origin decision as the
				// graph parent and discover only the selected entity's children;
				// the direct descriptor above remains the canonical origin row.
				if (["entity", "feat", "optionalFeature"].includes(descriptor.kind)) {
					const selectedValues = Array.isArray(selectedFallback)
						? selectedFallback
						: (selectedFallback == null ? [] : [selectedFallback]);
					selectedValues.forEach((value, valueIx) => {
						const selectedEntity = CharacterSheetProgression._resolveNestedEntity({
							option: value,
							page,
							parentEntity: entity,
						});
						if (!selectedEntity) return;
						CharacterSheetProgression._discoverNestedForEntity({
							entity: selectedEntity,
							page,
							state,
							levelInfo: {
								characterLevel: 0,
								className: "Base",
								classSource: "",
								classLevel: 0,
							},
							decisions: base.decisions,
							levelDecisions: base.decisions,
							storedPool: storedBasePool,
							parentDecision: decision,
							parentEntity: entity,
							acquisitionKey: `${key}.${descriptor.grantKey}.${valueIx}`,
							rootSemanticKey: entityKey,
							depth: 2,
							issues,
							scope: "origin",
						});
					});
				}
			});
		};
		const characterBase = state?.getCharacterBase?.() || {};
		addOrigin("race", state?.getRace?.(), characterBase.raceUserChoices, 0);
		addOrigin("background", state?.getBackground?.(), characterBase.backgroundUserChoices, 1);
		return base;
	}
	static _makeDecision ({
		characterLevel,
		className,
		classSource,
		classLevel,
		type,
		label,
		sourceKey = "",
		slot = 0,
		required = true,
		count = 1,
		options = [],
		selection = null,
		status = null,
		isValid = true,
		meta = {},
		scope = "level",
		parentSemanticKey = null,
		rootSemanticKey = null,
		depth = 0,
		provenance = null,
		receipt = null,
		semanticKeyOverride = null,
	}) {
		if (!CharacterSheetProgression.getDecisionAdapter(type)) {
			throw new Error(`No progression decision adapter is registered for "${type}".`);
		}
		const semanticKey = semanticKeyOverride || CharacterSheetProgression.getSemanticKey({
			className,
			classSource,
			classLevel,
			type,
			sourceKey,
			slot,
		});
		return {
			id: CharacterSheetProgression.getDecisionId({semanticKey, characterLevel}),
			semanticKey,
			characterLevel,
			className,
			classSource,
			classLevel,
			type,
			label,
			sourceKey,
			slot,
			required,
			count,
			options: CharacterSheetProgression._copy(options || []),
			selection: CharacterSheetProgression._copy(selection),
			status: CharacterSheetProgression._getDecisionStatus({selection, count, required, status, isValid}),
			meta: CharacterSheetProgression._copy(meta || {}),
			scope,
			parentSemanticKey,
			rootSemanticKey: rootSemanticKey || semanticKey,
			depth: Math.max(0, Number(depth) || 0),
			provenance: CharacterSheetProgression._copy(provenance),
			receipt: CharacterSheetProgression._copy(receipt || (
				(scope === "nested" || scope === "origin")
					? CharacterSheetProgression._getDecisionReceipt({semanticKey, type, selection, meta})
					: null
			)),
		};
	}

	static _legacyDecision ({entry, type, selection, sourceKey = type, slot = 0, label = type}) {
		const className = entry.class?.name || "Unknown";
		const classSource = entry.class?.source || "";
		const classLevel = Number(entry.classLevel) || Number(entry.level) || 0;
		return CharacterSheetProgression._makeDecision({
			characterLevel: entry.level,
			className,
			classSource,
			classLevel,
			type,
			label,
			sourceKey,
			slot,
			required: false,
			count: Array.isArray(selection) ? selection.length : 1,
			selection,
			status: selection == null ? "deferred" : "resolved",
			meta: {legacyProjection: true},
		});
	}

	/**
	 * Project the existing sparse `choices` object into compatibility decisions.
	 * These decisions preserve data but do not claim that every opportunity at the
	 * level has been discovered; only a full manifest can set `manifestComplete`.
	 */
	static projectLegacyChoices (entry) {
		const choices = entry?.choices || {};
		const decisions = [];
		const push = (type, selection, opts = {}) => {
			if (selection == null) return;
			if (Array.isArray(selection) && !selection.length) return;
			decisions.push(CharacterSheetProgression._legacyDecision({
				entry,
				type,
				selection,
				sourceKey: opts.sourceKey || type,
				slot: opts.slot || 0,
				label: opts.label || type,
			}));
		};

		push("asi", choices.asi, {label: "Ability Score Improvement"});
		push("feat", choices.feat, {label: "Feat"});
		push("subclass", choices.subclass, {label: "Subclass"});
		push("subclassChoice", choices.subclassChoice, {label: "Subclass Choice"});
		push("skills", choices.skills, {label: "Skill Proficiencies"});
		push("tools", choices.tools, {label: "Tool Proficiencies"});
		push("expertise", choices.expertise, {label: "Expertise"});
		push("languages", choices.languages, {label: "Languages"});
		push("combatTraditions", choices.combatTraditions, {label: "Combat Traditions"});
		push("weaponMasteries", choices.weaponMasteries, {label: "Weapon Masteries"});
		push("spellbookSpells", choices.spellbookSpells, {label: "Spellbook Spells"});
		push("knownSpells", choices.knownSpells, {label: "Known Spells"});
		push("cantrips", choices.knownCantrips || choices.cantrips, {label: "Cantrips"});
		push("preparedSpells", choices.preparedSpells, {label: "Prepared Spells"});
		push("preparedCantrips", choices.preparedCantrips, {label: "Prepared Cantrips"});
		push("spellSwap", choices.spellSwap, {label: "Spell Replacement"});
		push("spellMastery", choices.spellMasterySpells, {label: "Spell Mastery"});
		push("signatureSpells", choices.signatureSpells, {label: "Signature Spells"});
		push("hp", choices.hpRoll != null ? {method: "roll", value: choices.hpRoll} : null, {label: "Hit Points"});
		push("scholar", choices.scholarSkill, {label: "Scholar Expertise"});

		(choices.optionalFeatures || []).forEach((feature, slot) => {
			push("optionalFeatures", [feature], {
				label: feature.type || "Optional Feature",
				sourceKey: feature.type || "optionalFeatures",
				slot,
			});
		});
		(choices.featureChoices || []).forEach((feature, slot) => {
			push("featureChoice", [feature], {
				label: feature.featureName || "Feature Choice",
				sourceKey: feature.featureName || "featureChoice",
				slot,
			});
		});
		(choices.classFeatProgressionFeats || []).forEach((feat, slot) => {
			push("classFeatProgressionFeat", feat, {
				label: feat.progressionName || "Class Feat",
				sourceKey: feat.progressionName || "classFeatProgressionFeat",
				slot,
			});
		});

		return decisions;
	}

	static normalizeDecision (decision, entry = {}) {
		const normalized = {
			...CharacterSheetProgression._copy(decision || {}),
			characterLevel: Number(decision?.characterLevel ?? entry.level) || 0,
			className: decision?.className || entry.class?.name || "Unknown",
			classSource: decision?.classSource || entry.class?.source || "",
			classLevel: Number(decision?.classLevel ?? entry.classLevel ?? entry.level) || 0,
			required: decision?.required !== false,
			count: Math.max(0, Number(decision?.count) || 1),
			options: CharacterSheetProgression._copy(decision?.options || []),
			selection: CharacterSheetProgression._copy(decision?.selection),
			meta: CharacterSheetProgression._copy(decision?.meta || {}),
		};
		normalized.semanticKey = decision?.semanticKey || CharacterSheetProgression.getSemanticKey({
			className: normalized.className,
			classSource: normalized.classSource,
			classLevel: normalized.classLevel,
			type: normalized.type || "unknown",
			sourceKey: normalized.sourceKey || normalized.type || "unknown",
			slot: normalized.slot || 0,
		});
		normalized.id = decision?.id || CharacterSheetProgression.getDecisionId({
			semanticKey: normalized.semanticKey,
			characterLevel: normalized.characterLevel,
		});
		normalized.scope = decision?.scope
			|| (decision?.characterLevel === 0 ? "origin" : (decision?.parentSemanticKey ? "nested" : "level"));
		normalized.parentSemanticKey = decision?.parentSemanticKey || null;
		normalized.rootSemanticKey = decision?.rootSemanticKey || (
			normalized.parentSemanticKey
				? normalized.parentSemanticKey
				: normalized.semanticKey
		);
		normalized.depth = Math.max(0, Number(decision?.depth) || (normalized.parentSemanticKey ? 1 : 0));
		normalized.provenance = CharacterSheetProgression._copy(decision?.provenance || null);
		normalized.receipt = CharacterSheetProgression._copy(decision?.receipt || null);
		normalized.status = CharacterSheetProgression._getDecisionStatus({
			selection: normalized.selection,
			count: normalized.count,
			required: normalized.required,
			status: decision?.status,
		});
		return normalized;
	}

	static normalizeHistoryEntry (entry) {
		const out = CharacterSheetProgression._copy(entry || {});
		out.choices = out.choices && typeof out.choices === "object" ? out.choices : {};
		out.ledgerVersion = CharacterSheetProgression.LEDGER_VERSION;
		out.decisions = Array.isArray(out.decisions) && out.decisions.length
			? out.decisions.map(decision => CharacterSheetProgression.normalizeDecision(decision, out))
			: CharacterSheetProgression.projectLegacyChoices(out);
		out.manifestComplete = out.manifestComplete === true;
		out.complete = out.manifestComplete
			? !out.decisions.some(decision => decision.required && decision.status !== "resolved")
			: out.complete !== false;
		return out;
	}

	static normalizeHistory (history) {
		return (Array.isArray(history) ? history : [])
			.map(entry => CharacterSheetProgression.normalizeHistoryEntry(entry))
			.sort((a, b) => a.level - b.level);
	}

	static refreshDecisionSelectionsFromChoices (entry) {
		const normalized = CharacterSheetProgression.normalizeHistoryEntry(entry);
		if (!normalized.manifestComplete) {
			const legacy = CharacterSheetProgression.projectLegacyChoices(normalized);
			const preserved = (normalized.decisions || []).filter(decision => ["nested", "origin"].includes(decision.scope));
			normalized.decisions = [...legacy, ...preserved];
			return normalized;
		}
		normalized.decisions = normalized.decisions.map(decision => {
			const selection = CharacterSheetProgression._getLegacySelection({
				history: normalized,
				type: decision.type,
				sourceKey: decision.sourceKey,
				slot: decision.slot,
			});
			if (selection == null) return decision;
			return CharacterSheetProgression.normalizeDecision({
				...decision,
				selection,
				status: null,
			}, normalized);
		});
		normalized.complete = !normalized.decisions.some(decision => decision.required && decision.status !== "resolved");
		return normalized;
	}

	static projectDecisionsToChoices (entry) {
		const normalized = CharacterSheetProgression.normalizeHistoryEntry(entry);
		const choices = {...(normalized.choices || {})};
		const managedKeysByType = {
			skills: ["skills"],
			tools: ["tools"],
			expertise: ["expertise"],
			languages: ["languages"],
			subclass: ["subclass"],
			subclassChoice: ["subclassChoice"],
			asiOrFeat: ["asi", "feat"],
			asi: ["asi"],
			feat: ["feat"],
			combatTraditions: ["combatTraditions"],
			combatMethods: ["combatMethods"],
			optionalFeatures: ["optionalFeatures"],
			featureChoice: ["featureChoices"],
			classFeatProgressionFeat: ["classFeatProgressionFeats"],
			weaponMasteries: ["weaponMasteries"],
			spellbookSpells: ["spellbookSpells"],
			knownSpells: ["knownSpells"],
			cantrips: ["knownCantrips", "preparedCantrips"],
			preparedSpells: ["preparedSpells"],
			preparedCantrips: ["preparedCantrips"],
			spellSwap: ["spellSwap"],
			spellMastery: ["spellMasterySpells"],
			signatureSpells: ["signatureSpells"],
			scholar: ["scholarSkill"],
			hp: ["hpRoll"],
		};
		const representedTypes = new Set((normalized.decisions || []).map(decision => decision.type));
		for (const type of representedTypes) {
			for (const key of managedKeysByType[type] || []) delete choices[key];
		}
		if ((normalized.decisions || []).some(decision => decision.type === "feat" && decision.meta?.improvement?.kind === "feat")) {
			delete choices.asi;
			delete choices.feat;
		}
		const append = (key, values) => {
			if (!Array.isArray(values) || !values.length) return;
			choices[key] = [...(choices[key] || []), ...CharacterSheetProgression._copy(values)];
		};

		for (const decision of normalized.decisions || []) {
			if (decision.scope === "nested" || decision.scope === "origin") continue;
			const selection = decision.selection;
			if (selection == null) continue;
			switch (decision.type) {
				case "class": normalized.class = CharacterSheetProgression._copy(selection); break;
				case "skills": append("skills", selection); break;
				case "tools": append("tools", selection); break;
				case "expertise": append("expertise", selection); break;
				case "languages":
					append("languages", (selection || []).map(language => ({featureName: decision.sourceKey, language})));
					break;
				case "subclass": choices.subclass = CharacterSheetProgression._copy(selection); break;
				case "subclassChoice": choices.subclassChoice = CharacterSheetProgression._copy(selection); break;
				case "asiOrFeat":
					if (selection.mode === "asi") choices.asi = CharacterSheetProgression._copy(selection.asi);
					if (selection.mode === "feat") choices.feat = CharacterSheetProgression._copy(selection.feat);
					break;
				case "asi": choices.asi = CharacterSheetProgression._copy(selection); break;
				case "feat":
					if (!selection.legacyAsi) choices.feat = CharacterSheetProgression._copy(selection);
					break;
				case "combatTraditions": append("combatTraditions", selection); break;
				case "combatMethods": append("combatMethods", selection); break;
				case "optionalFeatures": append("optionalFeatures", selection); break;
				case "featureChoice": append("featureChoices", selection); break;
				case "classFeatProgressionFeat": append("classFeatProgressionFeats", [selection]); break;
				case "weaponMasteries": choices.weaponMasteries = CharacterSheetProgression._copy(selection); break;
				case "spellbookSpells": append("spellbookSpells", selection); break;
				case "knownSpells": append("knownSpells", selection); break;
				case "cantrips": append(/prepared/i.test(decision.sourceKey) ? "preparedCantrips" : "knownCantrips", selection); break;
				case "preparedSpells": append("preparedSpells", selection); break;
				case "preparedCantrips": append("preparedCantrips", selection); break;
				case "spellSwap": choices.spellSwap = CharacterSheetProgression._copy(selection); break;
				case "spellMastery": choices.spellMasterySpells = CharacterSheetProgression._copy(selection); break;
				case "signatureSpells": choices.signatureSpells = CharacterSheetProgression._copy(selection); break;
				case "scholar": choices.scholarSkill = selection; break;
				case "hp":
					if (selection.method === "roll" && Number.isFinite(Number(selection.value))) choices.hpRoll = Number(selection.value);
					break;
			}
		}
		normalized.choices = choices;
		normalized.complete = !(normalized.decisions || []).some(decision => decision.required && decision.status !== "resolved");
		return normalized;
	}

	static buildTimeline ({state, history = null} = {}) {
		const entries = CharacterSheetProgression.normalizeHistory(history || state?.getLevelHistory?.() || []);
		const totalLevel = Number(state?.getTotalLevel?.()) || entries.length;
		const entryByLevel = new Map(entries.map(entry => [Number(entry.level), entry]));
		const classes = state?.getClasses?.() || [];
		const fallbackQueue = [];
		classes.forEach(cls => {
			for (let i = 0; i < (Number(cls.level) || 0); ++i) {
				fallbackQueue.push({name: cls.name, source: cls.source});
			}
		});

		const classCounts = new Map();
		const timeline = [];
		for (let characterLevel = 1; characterLevel <= totalLevel; ++characterLevel) {
			const entry = entryByLevel.get(characterLevel);
			const fallback = fallbackQueue[characterLevel - 1] || fallbackQueue[0] || null;
			const classRef = entry?.class || fallback;
			if (!classRef?.name) {
				timeline.push({
					characterLevel,
					className: "Unknown",
					classSource: "",
					classLevel: 0,
					history: entry || null,
					inferred: true,
				});
				continue;
			}
			const classUid = CharacterSheetProgression.getClassUid(classRef);
			const classLevel = (classCounts.get(classUid) || 0) + 1;
			classCounts.set(classUid, classLevel);
			timeline.push({
				characterLevel,
				className: classRef.name,
				classSource: classRef.source,
				classLevel,
				history: entry || null,
				inferred: !entry,
			});
		}
		return timeline;
	}

	static _resolveClassData (page, className, classSource) {
		const classes = page?.getClasses?.() || [];
		return classes.find(cls =>
			CharacterSheetProgression._normalize(cls.name) === CharacterSheetProgression._normalize(className)
			&& CharacterSheetProgression._normalize(cls.source) === CharacterSheetProgression._normalize(classSource),
		) || classes.find(cls => CharacterSheetProgression._normalize(cls.name) === CharacterSheetProgression._normalize(className)) || null;
	}

	static _resolveSubclass (classData, storedSubclass) {
		if (!storedSubclass) return null;
		return CharacterSheetClassUtils.resolveFullSubclass(storedSubclass, classData) || storedSubclass;
	}

	static _getStoredDecisionPool (history) {
		const bySemanticKey = new Map();
		for (const entry of CharacterSheetProgression.normalizeHistory(history)) {
			for (const decision of entry.decisions || []) {
				if (!decision.semanticKey) continue;
				if (!bySemanticKey.has(decision.semanticKey)) bySemanticKey.set(decision.semanticKey, []);
				bySemanticKey.get(decision.semanticKey).push(decision);
			}
		}
		return bySemanticKey;
	}

	static _getLegacySelection ({history, type, sourceKey = "", slot = 0}) {
		const choices = history?.choices || {};
		switch (type) {
			case "class": return history?.class || null;
			case "skills": return choices.skills || null;
			case "tools": return choices.tools || null;
			case "expertise": return choices.expertise || null;
			case "languages": {
				if (!Array.isArray(choices.languages)) return null;
				const matched = sourceKey
					? choices.languages.filter(it => CharacterSheetProgression._normalize(it?.featureName) === CharacterSheetProgression._normalize(sourceKey))
					: choices.languages;
				return matched.map(it => typeof it === "string" ? it : it.language).filter(Boolean);
			}
			case "subclass": return choices.subclass || null;
			case "subclassChoice": return choices.subclassChoice || null;
			case "asiOrFeat": {
				if (choices.feat) return {mode: "feat", feat: choices.feat};
				if (choices.asi) return {mode: "asi", asi: choices.asi};
				return null;
			}
			case "asi": return choices.asi || null;
			case "feat": return choices.feat || null;
			case "optionalFeatures": {
				const typeKey = sourceKey.split("|")[0];
				const values = (choices.optionalFeatures || []).filter(it =>
					CharacterSheetProgression._normalize(it.type || "other") === CharacterSheetProgression._normalize(typeKey || "other"),
				);
				return values.length ? values : null;
			}
			case "featureChoice": {
				const values = (choices.featureChoices || []).filter(it =>
					CharacterSheetProgression._normalize(it.featureName) === CharacterSheetProgression._normalize(sourceKey),
				);
				return values.length ? values : null;
			}
			case "classFeatProgressionFeat": {
				const values = (choices.classFeatProgressionFeats || []).filter(it =>
					CharacterSheetProgression._normalize(it.progressionName) === CharacterSheetProgression._normalize(sourceKey),
				);
				return values[slot] || values[0] || null;
			}
			case "weaponMasteries": return choices.weaponMasteries || null;
			case "combatTraditions": return choices.combatTraditions || null;
			case "spellbookSpells": return choices.spellbookSpells || null;
			case "knownSpells": return choices.knownSpells || null;
			case "cantrips": return choices.knownCantrips || choices.preparedCantrips || choices.cantrips || null;
			case "preparedSpells": return choices.preparedSpells || null;
			case "preparedCantrips": return choices.preparedCantrips || null;
			case "spellSwap": return choices.spellSwap || null;
			case "spellMastery": return choices.spellMasterySpells || null;
			case "signatureSpells": return choices.signatureSpells || null;
			case "scholar": return choices.scholarSkill || null;
			case "hp": return choices.hpRoll != null ? {method: "roll", value: choices.hpRoll} : {method: "average"};
			default: return null;
		}
	}

	static _getSkillGrant (definitions, page) {
		const out = {count: 0, options: [], fixed: []};
		const allSkills = (page?.getSkillsList?.() || [])
			.map(skill => skill?.name || skill)
			.filter(Boolean);
		for (const definition of Array.isArray(definitions) ? definitions : (definitions ? [definitions] : [])) {
			if (definition?.choose) {
				out.count += Number(definition.choose.count) || 1;
				out.options.push(...(definition.choose.from || []));
				continue;
			}
			if (definition?.any) {
				out.count += Number(definition.any) || 1;
				out.options.push(...allSkills);
				continue;
			}
			if (definition && typeof definition === "object") {
				out.fixed.push(...Object.keys(definition).filter(key => !["choose", "any"].includes(key)));
			}
		}
		out.options = [...new Set(out.options.map(skill => String(skill).split("|")[0]).filter(Boolean))];
		return out;
	}

	static _getToolGrant (definitions) {
		const out = {count: 0, options: [], fixed: [], category: null};
		let anyCount = 0;
		let artisanCount = 0;
		let instrumentCount = 0;
		for (const definition of Array.isArray(definitions) ? definitions : (definitions ? [definitions] : [])) {
			if (!definition || typeof definition !== "object") continue;
			if (definition.choose) {
				out.count += Number(definition.choose.count) || 1;
				out.options.push(...(definition.choose.from || []));
			}
			if (definition.any) {
				anyCount += Number(definition.any) || 1;
				out.category = "any";
			}
			if (definition.anyArtisansTool) {
				artisanCount += Number(definition.anyArtisansTool) || 1;
				out.category = "artisan";
			}
			if (definition.anyMusicalInstrument) {
				instrumentCount += Number(definition.anyMusicalInstrument) || 1;
				out.category = "instrument";
			}
			out.fixed.push(...Object.entries(definition)
				.filter(([key, value]) => !["choose", "any", "anyArtisansTool", "anyMusicalInstrument"].includes(key) && value === true)
				.map(([key]) => key));
		}
		if (artisanCount && instrumentCount) {
			out.count += Math.max(artisanCount, instrumentCount);
			out.category = "artisanOrInstrument";
			out.options.push(
				...(globalThis.Renderer?.generic?.FEATURE__TOOLS_ARTISANS || []),
				...(globalThis.Renderer?.generic?.FEATURE__TOOLS_MUSICAL_INSTRUMENTS || []),
			);
		} else if (artisanCount) {
			out.count += artisanCount;
			out.options.push(...(globalThis.Renderer?.generic?.FEATURE__TOOLS_ARTISANS || []));
		} else if (instrumentCount) {
			out.count += instrumentCount;
			out.options.push(...(globalThis.Renderer?.generic?.FEATURE__TOOLS_MUSICAL_INSTRUMENTS || []));
		}
		if (anyCount) {
			out.count += anyCount;
			out.category = "any";
			out.options.push(...(globalThis.Renderer?.generic?.FEATURE__TOOLS_ALL || []));
		}
		out.options = [...new Set(out.options.filter(Boolean))];
		return out;
	}

	static _getClassSpellPools (state, page, history = []) {
		const pools = new Map();
		const loadedClasses = page?.getClasses?.() || [];
		const spellcastingClasses = (state?.getClasses?.() || []).filter(stored => {
			const classData = loadedClasses.find(it =>
				CharacterSheetProgression._normalize(it.name) === CharacterSheetProgression._normalize(stored.name)
				&& (!stored.source || CharacterSheetProgression._normalize(it.source) === CharacterSheetProgression._normalize(stored.source)),
			) || stored;
			return CharacterSheetClassUtils.getClassSpellcastingModel({
				name: stored.name,
				source: stored.source,
				classData,
			}) !== "none";
		});
		const soleSpellcastingClass = spellcastingClasses.length === 1 ? spellcastingClasses[0] : null;
		const add = (spell, kind) => {
			const ownerName = typeof spell?.sourceClass === "string" ? spell.sourceClass : spell?.sourceClass?.name;
			const isFeatureGranted = !!(
				spell?.fromFeat
				|| spell?.sourceFeatId
				|| (spell?.sourceFeature && !CharacterSheetClassUtils.isPlayerChosenSpell(spell))
			);
			if (!ownerName && isFeatureGranted) return;
			const classKey = CharacterSheetProgression._normalize(ownerName || soleSpellcastingClass?.name);
			if (!classKey) return;
			if (!pools.has(classKey)) pools.set(classKey, {knownSpells: [], cantrips: [], preparedSpells: [], preparedCantrips: [], spellbookSpells: []});
			const pool = pools.get(classKey);
			if (spell.inSpellbook || spell.sourceFeature === "Wizard Spellbook") pool.spellbookSpells.push(spell);
			if (kind === "cantrip") {
				if (/prepared/i.test(spell.sourceFeature || "")) pool.preparedCantrips.push(spell);
				else pool.cantrips.push(spell);
				return;
			}
			if (/prepared/i.test(spell.sourceFeature || "")) pool.preparedSpells.push(spell);
			else if (!spell.alwaysPrepared && !spell.grantedByClass) pool.knownSpells.push(spell);
		};
		(state?.getSpellsKnown?.() || []).forEach(spell => add(spell, "spell"));
		(state?.getCantripsKnown?.() || []).forEach(spell => add(spell, "cantrip"));

		for (const entry of [...(history || [])].sort((a, b) => Number(b?.level) - Number(a?.level))) {
			const swap = entry?.choices?.spellSwap;
			if (!swap?.added?.name || !swap?.removed?.name) continue;
			const classKey = CharacterSheetProgression._normalize(entry?.class?.name);
			const pool = pools.get(classKey);
			if (!pool) continue;
			const key = Number(swap.added.level) === 0 || Number(swap.removed.level) === 0 ? "cantrips" : "knownSpells";
			const ix = pool[key].findIndex(spell =>
				CharacterSheetProgression.getEntityUid(spell) === CharacterSheetProgression.getEntityUid(swap.added),
			);
			if (!~ix) continue;
			pool[key].splice(ix, 1, {
				...swap.removed,
				sourceClass: entry.class?.name,
				sourceFeature: key === "cantrips" ? "Cantrips Known" : "Spells Known",
			});
		}

		const spellData = page?.getFilteredSpellData?.() || page?.getSpells?.() || [];
		const getSpellLevel = spell => {
			if (spell.level != null) return Number(spell.level) || 0;
			const match = spellData.find(it =>
				CharacterSheetProgression._normalize(it.name) === CharacterSheetProgression._normalize(spell.name)
				&& (!spell.source || CharacterSheetProgression._normalize(it.source) === CharacterSheetProgression._normalize(spell.source)),
			);
			return Number(match?.level) || 0;
		};
		for (const pool of pools.values()) {
			Object.values(pool).forEach(spells => spells.sort((a, b) =>
				getSpellLevel(a) - getSpellLevel(b)
				|| String(a.name || "").localeCompare(String(b.name || "")),
			));
		}
		return pools;
	}

	static _takeReconstructedSelection ({pool, key, count, cursor}) {
		if (!count || !pool?.[key]?.length) return null;
		const start = cursor[key] || 0;
		const selected = pool[key].slice(start, start + count).map(spell => ({
			name: spell.name,
			source: spell.source,
			level: spell.level ?? (key.toLowerCase().includes("cantrip") ? 0 : undefined),
		}));
		cursor[key] = start + selected.length;
		return selected.length ? selected : null;
	}

	static _isLegacyUntrackedSpellProgression ({className, classSource, history, spellPool}) {
		if (Object.values(spellPool || {}).some(spells => spells?.length)) return false;
		const classUid = CharacterSheetProgression.getClassUid(className, classSource);
		const classHistory = (history || []).filter(entry =>
			CharacterSheetProgression.getClassUid(entry?.class) === classUid,
		);
		if (!classHistory.length) return false;

		const acquisitionTypes = new Set(["spellbookSpells", "knownSpells", "cantrips", "preparedSpells", "preparedCantrips"]);
		const storedDecisions = classHistory
			.flatMap(entry => entry.decisions || [])
			.filter(decision => acquisitionTypes.has(decision.type));
		if (storedDecisions.some(decision => decision.selection != null)) return false;
		if (storedDecisions.some(decision => decision.meta?.legacyUntracked)) return true;
		return classHistory.every(entry => entry.manifestComplete !== true);
	}

	static _getExistingSelection ({storedPool, semanticKey, history, type, sourceKey, slot, fallback = null, fallbackStatus = "ambiguous"}) {
		const exact = storedPool.get(semanticKey)?.find(decision => decision.selection != null);
		if (exact) return {selection: CharacterSheetProgression._copy(exact.selection), status: exact.status};
		const legacy = CharacterSheetProgression._getLegacySelection({history, type, sourceKey, slot});
		if (legacy != null) return {selection: CharacterSheetProgression._copy(legacy), status: null};
		if (fallback != null) return {selection: CharacterSheetProgression._copy(fallback), status: fallbackStatus};
		return {selection: null, status: null};
	}

	static _getMulticlassRequirementIssues ({classData, additionalClassData = [], state, history, characterLevel, classLevel}) {
		if (characterLevel <= 1 || classLevel !== 1) return [];
		const issues = [];
		const abilityAbbreviations = globalThis.Parser?.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"];
		const getAbilityLabel = ability => globalThis.Parser?.attAbvToFull?.(ability) || ability.toUpperCase();
		for (const requirementClass of [classData, ...additionalClassData]) {
			const requirements = requirementClass?.multiclassing?.requirements;
			if (!requirements || typeof requirements !== "object") continue;
			const getHistoricalScore = ability => {
				const laterAsi = (history || []).reduce((sum, entry) => {
					if (Number(entry.level) < characterLevel) return sum;
					return sum + (Number(entry.choices?.asi?.[ability]) || 0);
				}, 0);
				return (Number(state?.getAbilityScore?.(ability)) || 0) - laterAsi;
			};
			if (Array.isArray(requirements.or)) {
				const alternatives = requirements.or.flatMap(group => Object.entries(group || {}))
					.filter(([ability]) => abilityAbbreviations.includes(ability));
				if (alternatives.length && !alternatives.some(([ability, score]) => getHistoricalScore(ability) >= Number(score))) {
					const label = alternatives.map(([ability, score]) => `${getAbilityLabel(ability)} ${score}+`).join(" or ");
					issues.push(`${requirementClass.name} requires ${label} at character level ${characterLevel}.`);
				}
				continue;
			}
			for (const [ability, requiredScore] of Object.entries(requirements)) {
				if (!abilityAbbreviations.includes(ability)) continue;
				const historical = getHistoricalScore(ability);
				if (historical < Number(requiredScore)) {
					issues.push(`${requirementClass.name} requires ${getAbilityLabel(ability)} ${requiredScore}+ at character level ${characterLevel} (historical score ${historical}).`);
				}
			}
		}
		return issues;
	}

	/**
	 * Derive every known progression decision opportunity for the supplied
	 * chronological timeline. Existing selections are matched by semantic key so a
	 * class-level decision can move to a different character level without being lost.
	 */
	static buildManifest ({page, state, history = null, timeline = null} = {}) {
		const normalizedHistory = CharacterSheetProgression.normalizeHistory(history || state?.getLevelHistory?.() || []);
		const resolvedTimeline = timeline || CharacterSheetProgression.buildTimeline({state, history: normalizedHistory});
		const storedPool = CharacterSheetProgression._getStoredDecisionPool(normalizedHistory);
		const baseStoredPool = new Map(
			(state?.getCharacterBase?.()?.decisions || []).map(decision => [decision.semanticKey, [CharacterSheetProgression.normalizeDecision(decision)]]),
		);
		const historyByLevel = new Map(normalizedHistory.map(entry => [Number(entry.level), entry]));
		const stateClasses = state?.getClasses?.() || [];
		const decisions = [];
		const levels = [];
		const issues = [];
		issues.push(...CharacterSheetProgression.getAdapterClosureIssues().map(issue => ({
			...issue,
			severity: "error",
			message: `Progression adapter "${issue.type}" is not fully wired (${issue.handler}).`,
		})));
		const base = CharacterSheetProgression._buildOriginManifest({
			page,
			state,
			storedBasePool: baseStoredPool,
			issues,
		});
		decisions.push(...base.decisions);
		const spellPools = CharacterSheetProgression._getClassSpellPools(state, page, normalizedHistory);
		const spellPoolCursors = new Map();

		const addDecision = (levelInfo, config) => {
			const semanticKey = CharacterSheetProgression.getSemanticKey({
				className: levelInfo.className,
				classSource: levelInfo.classSource,
				classLevel: levelInfo.classLevel,
				type: config.type,
				sourceKey: config.sourceKey || "",
				slot: config.slot || 0,
			});
			const matched = CharacterSheetProgression._getExistingSelection({
				storedPool,
				semanticKey,
				history: levelInfo.history,
				type: config.type,
				sourceKey: config.sourceKey || "",
				slot: config.slot || 0,
				fallback: config.fallbackSelection,
				fallbackStatus: config.fallbackStatus,
			});
			const isValid = config.isValid !== false && CharacterSheetProgression._isSelectionValid({
				selection: matched.selection,
				count: config.count,
				options: config.options,
				type: config.type,
			});
			const decision = CharacterSheetProgression._makeDecision({
				...levelInfo,
				...config,
				selection: matched.selection,
				status: matched.status === "ambiguous" || (matched.status === "deferred" && matched.selection == null)
					? matched.status
					: null,
				isValid,
			});
			decisions.push(decision);
			return decision;
		};

		for (const timelineEntry of resolvedTimeline) {
			const historyEntry = historyByLevel.get(Number(timelineEntry.characterLevel)) || timelineEntry.history || null;
			const levelInfo = {...timelineEntry, history: historyEntry};
			const classData = CharacterSheetProgression._resolveClassData(page, levelInfo.className, levelInfo.classSource);
			if (!classData) {
				issues.push({
					level: levelInfo.characterLevel,
					severity: "error",
					code: "missing-class-data",
					message: `Class data is unavailable for ${levelInfo.className}${levelInfo.classSource ? ` (${levelInfo.classSource})` : ""}.`,
				});
				levels.push({...levelInfo, classData: null, decisions: []});
				continue;
			}

			const stateClass = stateClasses.find(cls =>
				CharacterSheetProgression.getClassUid(cls) === CharacterSheetProgression.getClassUid(classData),
			);
			const subclassRef = historyEntry?.choices?.subclass || stateClass?.subclass || null;
			const subclass = CharacterSheetProgression._resolveSubclass(classData, subclassRef);
			const levelDecisionsStart = decisions.length;
			const classUid = CharacterSheetProgression.getClassUid(classData);
			const spellPool = spellPools.get(CharacterSheetProgression._normalize(classData.name)) || null;
			const isLegacyUntrackedSpellProgression = CharacterSheetProgression._isLegacyUntrackedSpellProgression({
				className: classData.name,
				classSource: classData.source,
				history: normalizedHistory,
				spellPool,
			});
			const allSpellOptions = page?.getFilteredSpellData?.() || page?.getSpells?.() || [];
			const getLegalSpellOptions = maxSpellLevel => allSpellOptions.filter(spell => {
				if (!Number.isFinite(Number(spell.level))) return false;
				if (maxSpellLevel === 0 ? Number(spell.level) !== 0 : (Number(spell.level) < 1 || Number(spell.level) > maxSpellLevel)) return false;
				return CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
					className: classData.name,
					classSource: classData.source,
					subclass,
					subclassChoice: stateClass?.subclassChoice,
					includeCoreSpellsForHomebrew: !["PHB", "XPHB"].includes(classData.source),
				});
			});
			if (!spellPoolCursors.has(classUid)) {
				spellPoolCursors.set(classUid, {knownSpells: 0, cantrips: 0, preparedSpells: 0, preparedCantrips: 0, spellbookSpells: 0});
			}
			const spellCursor = spellPoolCursors.get(classUid);
			const featPool = page?.filterByAllowedSources?.(page?.getFeats?.() || []) || page?.getFeats?.() || [];
			const historicalAbilityScores = CharacterSheetClassUtils.getHistoricalAbilityScores({
				state,
				history: normalizedHistory,
				characterLevel: levelInfo.characterLevel,
			});
			const historicalOwnedFeats = CharacterSheetClassUtils.getHistoricalOwnedFeats({
				state,
				history: normalizedHistory,
				characterLevel: levelInfo.characterLevel,
				featCatalog: featPool,
			});

			const multiclassRequirementIssues = CharacterSheetProgression._getMulticlassRequirementIssues({
				classData,
				additionalClassData: [...new Map(resolvedTimeline
					.filter(it => it.characterLevel < levelInfo.characterLevel)
					.map(it => {
						const cls = CharacterSheetProgression._resolveClassData(page, it.className, it.classSource);
						return cls ? [CharacterSheetProgression.getClassUid(cls), cls] : null;
					})
					.filter(Boolean)).values()],
				state,
				history: normalizedHistory,
				characterLevel: levelInfo.characterLevel,
				classLevel: levelInfo.classLevel,
			});
			addDecision(levelInfo, {
				type: "class",
				label: "Class",
				sourceKey: "class-allocation",
				count: 1,
				options: (page?.getClasses?.() || []).map(cls => ({name: cls.name, source: cls.source})),
				fallbackSelection: {name: classData.name, source: classData.source},
				isValid: !multiclassRequirementIssues.length,
				meta: {multiclassRequirementIssues},
			});

			if (levelInfo.classLevel === 1) {
				const isFirstClass = levelInfo.characterLevel === 1;
				const skillGrant = CharacterSheetProgression._getSkillGrant(
					isFirstClass ? classData.startingProficiencies?.skills : classData.multiclassing?.proficienciesGained?.skills,
					page,
				);
				if (skillGrant.count > 0) {
					addDecision(levelInfo, {
						type: "skills",
						label: isFirstClass ? "Starting Skill Proficiencies" : "Multiclass Skill Proficiency",
						sourceKey: isFirstClass ? "starting-proficiencies" : "multiclass-proficiencies",
						count: skillGrant.count,
						options: skillGrant.options,
						meta: {isFirstClass, fixed: skillGrant.fixed},
					});
				}

				const toolGrant = CharacterSheetProgression._getToolGrant(
					isFirstClass
						? classData.startingProficiencies?.toolProficiencies
						: classData.multiclassing?.proficienciesGained?.toolProficiencies,
				);
				if (toolGrant.count > 0) {
					addDecision(levelInfo, {
						type: "tools",
						label: isFirstClass ? "Starting Tool Proficiencies" : "Multiclass Tool Proficiencies",
						sourceKey: isFirstClass ? "starting-proficiencies" : "multiclass-proficiencies",
						count: toolGrant.count,
						options: toolGrant.options,
						meta: {isFirstClass, category: toolGrant.category, fixed: toolGrant.fixed},
					});
				}
			}

			const subclassLevel = CharacterSheetClassUtils.getSubclassLevel(classData);
			if (levelInfo.classLevel === subclassLevel) {
				addDecision(levelInfo, {
					type: "subclass",
					label: classData.subclassTitle || "Subclass",
					sourceKey: "subclass",
					count: 1,
					options: (classData.subclasses || []).map(it => ({name: it.name, shortName: it.shortName, source: it.source})),
				});
			}
			if (subclass && CharacterSheetClassUtils.hasNamedSubclassChoice(subclass) && levelInfo.classLevel === subclassLevel) {
				addDecision(levelInfo, {
					type: "subclassChoice",
					label: CharacterSheetClassUtils.getNamedSubclassChoicePrompt(subclass)?.title || "Subclass Choice",
					sourceKey: `subclass-choice|${CharacterSheetProgression.getEntityUid(subclass)}`,
					count: 1,
					options: CharacterSheetClassUtils.getNamedSubclassChoiceOptions(subclass),
				});
			}

			const grantsBoth = !!state?.shouldGrantBothAsiAndFeat?.(levelInfo.characterLevel);
			const improvement = CharacterSheetClassUtils.getImprovementOpportunity(
				classData,
				levelInfo.classLevel,
				{grantBoth: grantsBoth},
			);
			if (improvement) {
				const legacyFeat = historyEntry?.choices?.feat || null;
				const excludeFeatUid = legacyFeat?.name
					? CharacterSheetProgression.getEntityUid(legacyFeat)
					: "";
				const eligibleFeats = CharacterSheetClassUtils.getEligibleFeats(featPool, state, {
					totalLevel: levelInfo.characterLevel,
					excludeFeatUid,
					abilityScores: historicalAbilityScores,
					ownedFeats: historicalOwnedFeats,
					featCatalog: featPool,
				}).sort((a, b) => {
					const categoryDelta = Number(b.category === "EB") - Number(a.category === "EB");
					return categoryDelta || String(a.name || "").localeCompare(String(b.name || ""));
				});

				if (improvement.kind === "asiAndFeat") {
					addDecision(levelInfo, {type: "asi", label: "Ability Score Improvement", sourceKey: "asi", count: 1});
					addDecision(levelInfo, {
						type: "feat",
						label: "Feat",
						sourceKey: "feat",
						count: 1,
						options: eligibleFeats,
						meta: {improvement},
					});
				} else if (improvement.kind === "feat") {
					const legacyAsi = historyEntry?.choices?.asi || null;
					addDecision(levelInfo, {
						type: "feat",
						label: improvement.label,
						sourceKey: "epic-boon-or-feat",
						count: 1,
						options: eligibleFeats,
						fallbackSelection: legacyAsi ? {mode: "asi", legacyAsi: CharacterSheetProgression._copy(legacyAsi)} : null,
						fallbackStatus: null,
						meta: {improvement, legacyAsiInvalid: !!legacyAsi},
					});
				} else {
					addDecision(levelInfo, {
						type: "asiOrFeat",
						label: improvement.label,
						sourceKey: "asi-or-feat",
						count: 1,
						options: eligibleFeats,
						meta: {improvement},
					});
				}
			}

			const features = CharacterSheetClassUtils.getLevelFeatures(
				classData,
				levelInfo.classLevel,
				subclass,
				page?.getClassFeatures?.() || [],
				page?.getSubclassFeatures?.() || [],
			);

			const optionalFeatureGains = CharacterSheetClassUtils.getOptionalFeatureProgressionDeltas(
				classData,
				levelInfo.classLevel - 1,
				levelInfo.classLevel,
				subclass,
			);
			const historicalClasses = [...new Map(resolvedTimeline
				.filter(it => Number(it.characterLevel) <= Number(levelInfo.characterLevel))
				.map(it => {
					const uid = CharacterSheetProgression.getClassUid(it.className, it.classSource);
					return [uid, {
						name: it.className,
						source: it.classSource,
						level: Math.max(...resolvedTimeline
							.filter(candidate =>
								Number(candidate.characterLevel) <= Number(levelInfo.characterLevel)
									&& CharacterSheetProgression.getClassUid(candidate.className, candidate.classSource) === uid)
							.map(candidate => Number(candidate.classLevel) || 0)),
					}];
				})).values()];
			const priorDecisionValues = type => decisions
				.slice(0, levelDecisionsStart)
				.filter(decision => decision.type === type)
				.flatMap(decision => Array.isArray(decision.selection) ? decision.selection : (decision.selection ? [decision.selection] : []));
			const historicalFeatures = [
				...(page?.getClassFeatures?.() || []).filter(feature => {
					const cls = historicalClasses.find(it =>
						CharacterSheetProgression._normalize(it.name) === CharacterSheetProgression._normalize(feature.className)
							&& (!feature.classSource || CharacterSheetProgression._normalize(it.source) === CharacterSheetProgression._normalize(feature.classSource)),
					);
					return cls && Number(feature.level) <= Number(cls.level);
				}),
				...(page?.getSubclassFeatures?.() || []).filter(feature => {
					const cls = historicalClasses.find(it =>
						CharacterSheetProgression._normalize(it.name) === CharacterSheetProgression._normalize(feature.className)
							&& (!feature.classSource || CharacterSheetProgression._normalize(it.source) === CharacterSheetProgression._normalize(feature.classSource)),
					);
					return cls && Number(feature.level) <= Number(cls.level);
				}),
				...priorDecisionValues("optionalFeatures"),
				...priorDecisionValues("featureChoice"),
			];
			const historicalOptionalFeatures = priorDecisionValues("optionalFeatures");
			const optionalPrereqContext = {
				classes: historicalClasses,
				totalLevel: levelInfo.characterLevel,
				existingFeatures: historicalFeatures,
				cantrips: [
					...priorDecisionValues("cantrips"),
					...priorDecisionValues("preparedCantrips"),
				],
				spells: [
					...priorDecisionValues("knownSpells"),
					...priorDecisionValues("preparedSpells"),
					...priorDecisionValues("spellbookSpells"),
				],
				toolProficiencies: priorDecisionValues("tools"),
				state: null,
				levelPrerequisiteClassAliases: CharacterSheetClassUtils.getOptionalFeaturePrerequisiteClassAliases(
					subclass,
					optionalFeatureGains.flatMap(gain => gain.featureTypes || []),
				),
			};
			for (const [slot, gain] of optionalFeatureGains.entries()) {
				const typeKey = (gain.featureTypes || []).join("_") || "other";
				const progressionOptions = CharacterSheetClassUtils.filterOptionalFeaturesForProgressionSource(
					page?.getOptionalFeatures?.() || [],
					gain.featureTypes || [],
					gain.progressionSource || subclass?.source || classData.source,
				);
				const eligibleOptions = CharacterSheetClassUtils.getEligibleOptionalFeatures(progressionOptions, {
					featureTypes: gain.featureTypes || [],
					prereqContext: optionalPrereqContext,
					alreadyKnown: historicalOptionalFeatures,
				});
				addDecision(levelInfo, {
					type: "optionalFeatures",
					label: gain.name || "Optional Features",
					sourceKey: `${typeKey}|${gain.name || "options"}|${gain.progressionSource || classData.source}`,
					slot,
					count: gain.newCount,
					options: eligibleOptions,
					meta: {
						featureTypes: gain.featureTypes || [],
						progressionSource: gain.progressionSource || classData.source,
						countBefore: gain.currentCount,
						countAfter: gain.totalCount,
					},
				});
			}

			const featureOptions = CharacterSheetClassUtils
				.getFeatureOptionsForLevel(features, levelInfo.classLevel, page?.getClassFeatures?.() || [])
				.filter(group => !group.options?.every(option => option.type === "optionalfeature"));
			featureOptions.forEach((group, slot) => {
				addDecision(levelInfo, {
					type: "featureChoice",
					label: group.featureName || "Feature Choice",
					sourceKey: group.featureName || `feature-choice-${slot}`,
					slot,
					count: group.count || 1,
					options: group.options || [],
					meta: {featureName: group.featureName},
				});
			});

			const classFeatGains = CharacterSheetClassUtils.getClassFeatProgressionGains(
				classData,
				levelInfo.classLevel - 1,
				levelInfo.classLevel,
				subclass,
			);
			classFeatGains.forEach((gain, gainIx) => {
				const legacySelections = (historyEntry?.choices?.classFeatProgressionFeats || [])
					.filter(feat => CharacterSheetProgression._normalize(feat.progressionName) === CharacterSheetProgression._normalize(gain.progressionName));
				const categoryFeats = CharacterSheetClassUtils.filterFeatsByCategory(
					page?.filterByAllowedSources?.(page?.getFeats?.() || []) || page?.getFeats?.() || [],
					gain.category || [],
				);
				for (let slot = 0; slot < (gain.count || 1); ++slot) {
					const current = legacySelections[slot];
					const options = CharacterSheetClassUtils.getEligibleFeats(categoryFeats, state, {
						totalLevel: levelInfo.characterLevel,
						excludeFeatUid: current?.name ? CharacterSheetProgression.getEntityUid(current) : "",
						abilityScores: historicalAbilityScores,
						ownedFeats: historicalOwnedFeats,
						featCatalog: featPool,
					});
					addDecision(levelInfo, {
						type: "classFeatProgressionFeat",
						label: gain.progressionName || "Class Feat",
						sourceKey: gain.progressionName || `class-feat-${gainIx}`,
						slot,
						count: 1,
						options,
						meta: {category: gain.category, progressionName: gain.progressionName},
					});
				}
			});

			const expertiseGrants = CharacterSheetClassUtils.getExpertiseGrantsForLevel(features);
			expertiseGrants.forEach((grant, slot) => {
				if (!grant.count) return;
				const skillOptions = (page?.getSkillsList?.() || [])
					.map(skill => skill?.name || skill)
					.filter(Boolean)
					.filter(skill => state?.getSkillProficiency?.(CharacterSheetProgression._normalize(skill).replace(/['\s]+/g, "")) >= 1);
				const toolOptions = grant.allowTools && grant.toolName && state?.hasToolProficiency?.(grant.toolName)
					? [grant.toolName]
					: [];
				addDecision(levelInfo, {
					type: "expertise",
					label: grant.featureName || "Expertise",
					sourceKey: grant.featureName || `expertise-${slot}`,
					slot,
					count: grant.count,
					options: [...new Set([...skillOptions, ...toolOptions])],
					meta: grant,
				});
			});

			const languageGrants = CharacterSheetClassUtils.getLanguageGrantsForLevel(features);
			languageGrants.forEach((grant, slot) => {
				if (!grant.count) return;
				addDecision(levelInfo, {
					type: "languages",
					label: grant.featureName || "Languages",
					sourceKey: grant.featureName || `languages-${slot}`,
					slot,
					count: grant.count,
					options: [...(globalThis.Parser?.LANGUAGES_ALL || [])],
					meta: grant,
				});
			});

			const isWizard = CharacterSheetProgression._normalize(classData.name) === "wizard";
			const spellModel = CharacterSheetClassUtils.getClassSpellcastingModel({
				name: classData.name,
				source: classData.source,
				classData,
			});
			if (isWizard) {
				const spellbookCount = levelInfo.classLevel === 1 ? 6 : 2;
				const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel);
				const fallback = CharacterSheetProgression._takeReconstructedSelection({
					pool: spellPool,
					key: "spellbookSpells",
					count: spellbookCount,
					cursor: spellCursor,
				});
				addDecision(levelInfo, {
					type: "spellbookSpells",
					label: levelInfo.classLevel === 1 ? "Starting Spellbook" : "Spellbook Additions",
					sourceKey: "wizard-spellbook",
					required: !isLegacyUntrackedSpellProgression,
					count: spellbookCount,
					options: getLegalSpellOptions(maxSpellLevel),
					fallbackSelection: fallback,
					fallbackStatus: "resolved",
					meta: {
						maxSpellLevel,
						...(isLegacyUntrackedSpellProgression ? {legacyUntracked: true} : {}),
					},
				});
			}

			const currentCantrips = CharacterSheetClassUtils.getCantripsAtLevel(classData, classData.name, levelInfo.classLevel);
			const previousCantrips = levelInfo.classLevel > 1
				? CharacterSheetClassUtils.getCantripsAtLevel(classData, classData.name, levelInfo.classLevel - 1)
				: 0;
			const cantripGain = Math.max(0, Number(currentCantrips || 0) - Number(previousCantrips || 0));
			if (cantripGain > 0) {
				// Cantrips are permanent learned choices even for prepared casters.
				// Keep them out of the runtime prepared-spell loadout bucket.
				const key = "cantrips";
				const fallback = CharacterSheetProgression._takeReconstructedSelection({pool: spellPool, key, count: cantripGain, cursor: spellCursor});
				addDecision(levelInfo, {
					type: key,
					label: "Cantrips Known",
					sourceKey: `${spellModel || "spell"}-cantrips`,
					required: !isLegacyUntrackedSpellProgression,
					count: cantripGain,
					options: getLegalSpellOptions(0),
					fallbackSelection: fallback,
					fallbackStatus: "resolved",
					meta: {
						maxSpellLevel: 0,
						...(isLegacyUntrackedSpellProgression ? {legacyUntracked: true} : {}),
					},
				});
			}

			if (!isWizard && spellModel === "known") {
				const current = CharacterSheetClassUtils.getKnownSpellsAtLevel(classData, classData.name, levelInfo.classLevel);
				const previous = levelInfo.classLevel > 1
					? CharacterSheetClassUtils.getKnownSpellsAtLevel(classData, classData.name, levelInfo.classLevel - 1)
					: 0;
				const count = Math.max(0, Number(current || 0) - Number(previous || 0));
				if (count > 0) {
					const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel);
					const fallback = CharacterSheetProgression._takeReconstructedSelection({pool: spellPool, key: "knownSpells", count, cursor: spellCursor});
					addDecision(levelInfo, {
						type: "knownSpells",
						label: "Spells Known",
						sourceKey: "known-spells",
						required: !isLegacyUntrackedSpellProgression,
						count,
						options: getLegalSpellOptions(maxSpellLevel),
						fallbackSelection: fallback,
						fallbackStatus: "resolved",
						meta: {
							maxSpellLevel,
							...(isLegacyUntrackedSpellProgression ? {legacyUntracked: true} : {}),
						},
					});
				}
			}

			if (!isWizard && spellModel === "prepared" && classData.preparedSpellsProgression) {
				const current = Number(classData.preparedSpellsProgression[levelInfo.classLevel - 1]) || 0;
				const previous = levelInfo.classLevel > 1 ? Number(classData.preparedSpellsProgression[levelInfo.classLevel - 2]) || 0 : 0;
				const count = Math.max(0, current - previous);
				if (count > 0) {
					const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel);
					const fallback = CharacterSheetProgression._takeReconstructedSelection({pool: spellPool, key: "preparedSpells", count, cursor: spellCursor});
					addDecision(levelInfo, {
						type: "preparedSpells",
						label: "Permanent Prepared Spells",
						sourceKey: "prepared-spells",
						required: !isLegacyUntrackedSpellProgression,
						count,
						options: getLegalSpellOptions(maxSpellLevel),
						fallbackSelection: fallback,
						fallbackStatus: "resolved",
						meta: {
							maxSpellLevel,
							...(isLegacyUntrackedSpellProgression ? {legacyUntracked: true} : {}),
						},
					});
				}
			}

			if (CharacterSheetProgression._normalize(classData.name) === "wizard" && levelInfo.classLevel === 2) {
				addDecision(levelInfo, {
					type: "scholar",
					label: "Scholar Expertise",
					sourceKey: "scholar",
					count: 1,
					options: ["arcana", "history", "investigation", "medicine", "nature", "religion"],
				});
			}

			const swapCount = CharacterSheetClassUtils.getSpellSwapCount?.(classData.name, classData.source, levelInfo.classLevel) || 0;
			if (swapCount > 0) {
				const maxSpellLevel = CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel);
				addDecision(levelInfo, {
					type: "spellSwap",
					label: "Spell Replacement",
					sourceKey: "spell-swap",
					count: 1,
					required: false,
					options: getLegalSpellOptions(maxSpellLevel),
					meta: {maxSpellLevel},
				});
			}

			const masteryCount = CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(
				classData,
				levelInfo.classLevel,
				page?.getClassFeatures?.() || [],
			);
			const previousMasteryCount = levelInfo.classLevel > 1
				? CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(classData, levelInfo.classLevel - 1, page?.getClassFeatures?.() || [])
				: 0;
			if (masteryCount > previousMasteryCount) {
				addDecision(levelInfo, {
					type: "weaponMasteries",
					label: "Weapon Masteries",
					sourceKey: "weapon-masteries",
					count: masteryCount,
					fallbackSelection: state?.getWeaponMasteries?.() || null,
					meta: {previousCount: previousMasteryCount},
				});
			}

			if (isWizard && levelInfo.classLevel === 18) {
				addDecision(levelInfo, {
					type: "spellMastery",
					label: "Spell Mastery",
					sourceKey: "spell-mastery",
					count: 2,
					options: [
						...(state?.getSpellMasteryCandidates?.(1) || []),
						...(state?.getSpellMasteryCandidates?.(2) || []),
					],
				});
			}
			if (isWizard && levelInfo.classLevel === 20) {
				addDecision(levelInfo, {
					type: "signatureSpells",
					label: "Signature Spells",
					sourceKey: "signature-spells",
					count: 2,
					options: state?.getSignatureSpellCandidates?.() || [],
				});
			}

			if (levelInfo.characterLevel > 1) {
				addDecision(levelInfo, {
					type: "hp",
					label: "Hit Point Gain",
					sourceKey: "hit-points",
					count: 1,
					meta: {hitDie: classData.hd?.faces || CharacterSheetClassUtils.getClassHitDie(classData)},
				});
			}

			// Discover the same permanent child choices which the feature/state
			// pipelines materialise.  The descriptors are compact and catalog-backed;
			// option lists stay transient in the manifest and are not persisted.
			const levelNestedDecisions = [];
			const nestedSeen = new Set();
			const discover = (entity, opts = {}) => {
				const uid = CharacterSheetProgression.getEntityUid(entity);
				const key = `${uid}|${opts.acquisitionKey || ""}|${opts.parentDecision?.semanticKey || ""}`;
				if (!entity || nestedSeen.has(key)) return;
				nestedSeen.add(key);
				CharacterSheetProgression._discoverNestedForEntity({
					entity,
					page,
					state,
					levelInfo,
					decisions,
					levelDecisions: levelNestedDecisions,
					storedPool,
					...opts,
					issues,
				});
			};
			for (const feature of features || []) {
				discover(feature, {
					acquisitionKey: CharacterSheetProgression.getAcquisitionKey({
						ownerType: feature.isSubclassFeature ? "subclassFeature" : "classFeature",
						ownerUid: CharacterSheetProgression.getEntityUid(feature),
						classLevel: levelInfo.classLevel,
						sourcePath: feature.name,
					}),
				});
			}
			for (const parentDecision of decisions.slice(levelDecisionsStart)) {
				if (!parentDecision.selection) continue;
				const values = Array.isArray(parentDecision.selection) ? parentDecision.selection : [parentDecision.selection];
				if (!["featureChoice", "optionalFeatures", "feat", "classFeatProgressionFeat", "nestedEntity", "nestedFeat", "nestedOptionalFeature"].includes(parentDecision.type)) continue;
				values.forEach((value, valueIx) => {
					let selectedEntity = CharacterSheetProgression._resolveNestedEntity({option: value, page, parentEntity: classData});
					if (!selectedEntity) return;
					// The catalog entity is intentionally immutable, while the state
					// copy carries acquisition-time subchoice values (notably feat
					// ability choices). Merge those values before recursively
					// discovering children so the graph reflects the candidate.
					const stateEntity = state?.getFeats?.().find(candidate =>
						CharacterSheetProgression.getEntityUid(candidate) === CharacterSheetProgression.getEntityUid(selectedEntity),
					);
					if (stateEntity) {
						selectedEntity = {
							...selectedEntity,
							...stateEntity,
							choices: stateEntity.choices || selectedEntity.choices,
							_featChoices: stateEntity._featChoices || selectedEntity._featChoices,
						};
					}
					discover(selectedEntity, {
						parentDecision,
						parentEntity: classData,
						acquisitionKey: CharacterSheetProgression.getAcquisitionKey({
							ownerType: parentDecision.type,
							ownerUid: CharacterSheetProgression.getEntityUid(selectedEntity),
							classLevel: levelInfo.classLevel,
							sourcePath: parentDecision.sourceKey,
							occurrence: valueIx,
						}),
						rootSemanticKey: parentDecision.rootSemanticKey || parentDecision.semanticKey,
						depth: (parentDecision.depth || 0) + 1,
					});
				});
			}
			for (const selected of state?.getChosenSubfeatures?.() || []) {
				const selectedEntity = CharacterSheetProgression._resolveNestedEntity({option: selected, page, parentEntity: classData});
				if (!selectedEntity) continue;
				discover(selectedEntity, {
					parentEntity: classData,
					acquisitionKey: CharacterSheetProgression.getAcquisitionKey({
						ownerType: "chosenSubfeature",
						ownerUid: CharacterSheetProgression.getEntityUid(selectedEntity),
						classLevel: levelInfo.classLevel,
						sourcePath: selected.parent || "chosen-subfeature",
					}),
				});
			}

			multiclassRequirementIssues.forEach(message => issues.push({
				level: levelInfo.characterLevel,
				severity: "warning",
				code: "multiclass-prerequisite",
				message,
			}));

			levels.push({
				...levelInfo,
				classData,
				subclass,
				features,
				decisions: decisions.slice(levelDecisionsStart),
			});
		}

		return {
			version: CharacterSheetProgression.MANIFEST_VERSION,
			base,
			levels,
			decisions,
			issues,
			unresolved: decisions.filter(decision =>
				decision.status === "invalid"
				|| decision.status === "ambiguous"
				|| (decision.required && decision.status !== "resolved"),
			),
			isComplete: !decisions.some(decision =>
				decision.status === "invalid"
					|| decision.status === "ambiguous"
					|| (decision.required && decision.status !== "resolved"),
			)
				&& !issues.some(issue => issue.severity === "error"),
		};
	}

	static reconcileHistoryWithManifest ({history, manifest}) {
		const entries = CharacterSheetProgression.normalizeHistory(history);
		const byLevel = new Map(entries.map(entry => [Number(entry.level), entry]));
		for (const level of manifest?.levels || []) {
			let entry = byLevel.get(Number(level.characterLevel));
			if (!entry) {
				entry = {
					level: level.characterLevel,
					class: {name: level.className, source: level.classSource},
					choices: {},
					timestamp: Date.now(),
				};
				entries.push(entry);
				byLevel.set(Number(level.characterLevel), entry);
			}
			entry.class = {name: level.className, source: level.classSource};
			entry.classLevel = level.classLevel;
			entry.ledgerVersion = CharacterSheetProgression.LEDGER_VERSION;
			entry.manifestVersion = CharacterSheetProgression.MANIFEST_VERSION;
			entry.manifestComplete = true;
			entry.decisions = (level.decisions || []).map(decision => CharacterSheetProgression.normalizeDecision({
				...decision,
				options: [],
			}, entry));
			entry.complete = !entry.decisions.some(decision => decision.required && decision.status !== "resolved");
		}
		return entries.sort((a, b) => a.level - b.level);
	}

	static reconcileCharacterBaseWithManifest ({base, characterBase}) {
		const out = CharacterSheetProgression._copy(characterBase || {});
		out.v = Number(out.v) || 1;
		const decisions = (base?.decisions || []).map(decision => CharacterSheetProgression.normalizeDecision({
			...decision,
			options: [],
			scope: "origin",
		}));
		out.decisions = decisions;
		out.ledgerVersion = CharacterSheetProgression.LEDGER_VERSION;
		out.manifestVersion = CharacterSheetProgression.MANIFEST_VERSION;
		out.complete = !decisions.some(decision => decision.required && decision.status !== "resolved");
		return out;
	}

	static getDecisionDisplayValue (decision) {
		const selection = decision?.selection;
		if (selection == null) return decision?.status === "deferred" ? "Deferred" : "Not selected";
		if (Array.isArray(selection)) {
			return selection.map(it => {
				if (typeof it === "string") return it;
				return it?.name || it?.choice || it?.language || JSON.stringify(it);
			}).join(", ");
		}
		if (typeof selection === "object") {
			if (selection.mode === "asi") {
				return Object.entries(selection.asi || {}).map(([ability, amount]) => `${ability.toUpperCase()} +${amount}`).join(", ");
			}
			if (selection.mode === "feat") return selection.feat?.name || "Feat";
			if (selection.method === "average") return "Average";
			if (selection.method === "roll") return `Rolled ${selection.value}`;
			return selection.name || selection.choice || JSON.stringify(selection);
		}
		return String(selection);
	}
}

export {CharacterSheetProgression};
globalThis.CharacterSheetProgression = CharacterSheetProgression;
