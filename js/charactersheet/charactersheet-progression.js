import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";
import {CharacterSheetArtificerPlans} from "./charactersheet-artificer-plans.js";

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
		artificerPlan: {discovery: "class-catalog", editor: "class-plan", validation: "artificer-plan", mechanics: "configuration", projection: ["choices.artificerPlans"]},
		artificerPlanReplacement: {discovery: "class-catalog", editor: "class-plan", validation: "artificer-plan-replacement", mechanics: "configuration", projection: ["choices.artificerPlanReplacements"]},
		hp: {discovery: "class-level", editor: "hit-points", validation: "hit-point-method", mechanics: "hit-points", projection: ["choices.hpRoll"]},
		nestedEntity: {discovery: "nested-descriptor", editor: "nested-choice", validation: "entity-option", mechanics: "nested-entity", projection: []},
		nestedSkill: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "skill-proficiencies", projection: []},
		nestedSkillBonus: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "skill-bonus", projection: []},
		nestedSkillTool: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "union-proficiencies", projection: []},
		nestedExpertise: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "skill-expertise", projection: []},
		nestedTool: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "tool-proficiencies", projection: []},
		nestedLanguage: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "languages", projection: []},
		nestedAbility: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "ability-configuration", projection: []},
		nestedSave: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "saving-throws", projection: []},
		nestedWeapon: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "weapon-proficiencies", projection: []},
		nestedArmor: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "armor-proficiencies", projection: []},
		nestedResistance: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "resistances", projection: []},
		nestedDamageType: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "resistances", projection: []},
		nestedSpell: {discovery: "nested-descriptor", editor: "nested-choice", validation: "legal-spell-set", mechanics: "nested-spells", projection: []},
		nestedCantrip: {discovery: "nested-descriptor", editor: "nested-choice", validation: "legal-spell-set", mechanics: "nested-spells", projection: []},
		nestedFeat: {discovery: "nested-descriptor", editor: "nested-choice", validation: "eligible-feat", mechanics: "feat-transaction", projection: []},
		nestedOptionalFeature: {discovery: "nested-descriptor", editor: "nested-choice", validation: "entity-option", mechanics: "optional-features", projection: []},
		nestedConfiguration: {discovery: "nested-descriptor", editor: "nested-choice", validation: "option-count", mechanics: "nested-configuration", projection: []},
		originRace: {discovery: "base-node", editor: "nested-choice", validation: "entity-option", mechanics: "origin-race", projection: []},
		originBackground: {discovery: "base-node", editor: "nested-choice", validation: "entity-option", mechanics: "origin-background", projection: []},
	});

	static getAdapterClosureIssues ({allowUnavailable = false} = {}) {
		// The adapter table is only metadata. Validate it against the executable
		// controller/state surfaces when those modules have loaded, rather than
		// maintaining a second hand-written set of names which can drift from the
		// actual editor and reverse paths.
		const respecProto = globalThis.CharacterSheetRespec?.prototype;
		const stateProto = globalThis.CharacterSheetState?.prototype;
		if (!respecProto || !stateProto) {
			return allowUnavailable
				? []
				: [{
					code: "adapter-prototypes-unavailable",
					type: "*",
					handler: "CharacterSheetRespec/CharacterSheetState",
					message: "The executable Respec and State prototypes are not loaded; adapter closure cannot be verified.",
				}];
		}
		const editorMethods = {
			class: "_editClassAllocation",
			"manifest-options": "_editManifestOptions",
			languages: "_editManifestOptions",
			subclass: "_editSubclass",
			improvement: "_editImprovement",
			feat: "_editFeat",
			"optional-features": "_editOptionalFeatures",
			"feature-choice": "_editFeatureChoice",
			"class-feat": "_editClassFeatProgressionFeat",
			"combat-traditions": "_editCombatTraditions",
			"combat-methods": "_editCombatMethods",
			"weapon-masteries": "_editWeaponMasteries",
			spells: "_editManifestOptions",
			"spell-swap": "_editSpellSwapDecision",
			scholar: "_editManifestOptions",
			"spell-mastery": "_editManifestOptions",
			"signature-spells": "_editManifestOptions",
			"class-plan": "_editArtificerPlanDecision",
			"hit-points": "_editHpDecision",
			"nested-choice": "_editManifestOptions",
		};
		const applyMethods = {
			class: "_applyDecisionMechanicsClass",
			proficiencies: "_applyDecisionMechanicsProficiencies",
			spells: "_applyDecisionMechanicsSpells",
			improvement: "_applyDecisionMechanicsImprovement",
			features: "_applyDecisionMechanicsFeatures",
			origin: "_applyDecisionMechanicsOrigin",
			configuration: "_applyDecisionMechanicsConfiguration",
		};
		const reverseMethods = {
			class: "reverseProgressionClassReceipt",
			proficiencies: "reverseProgressionProficiencyReceipt",
			spells: "reverseProgressionSpellReceipt",
			improvement: "reverseProgressionImprovementReceipt",
			features: "reverseProgressionFeatureReceipt",
			origin: "reverseProgressionOriginReceipt",
			configuration: "reverseProgressionConfigurationReceipt",
		};
		const familyForType = type => {
			if (["class", "subclass", "subclassChoice"].includes(type)) return "class";
			if (["skills", "tools", "expertise", "languages", "nestedSkill", "nestedSkillTool", "nestedExpertise", "nestedTool", "nestedLanguage", "nestedSave", "nestedWeapon", "nestedArmor", "nestedResistance", "nestedDamageType"].includes(type)) return "proficiencies";
			if (["spellbookSpells", "knownSpells", "cantrips", "preparedSpells", "preparedCantrips", "spellSwap", "spellMastery", "signatureSpells", "nestedSpell", "nestedCantrip"].includes(type)) return "spells";
			if (["asi", "feat", "asiOrFeat", "classFeatProgressionFeat"].includes(type)) return "improvement";
			if (["optionalFeatures", "featureChoice", "nestedEntity", "nestedFeat", "nestedOptionalFeature"].includes(type)) return "features";
			if (type === "nestedSkillBonus") return "configuration";
			if (["originRace", "originBackground"].includes(type)) return "origin";
			return "configuration";
		};
		const hasEditor = name => typeof respecProto[editorMethods[name]] === "function";
		const issues = [];
		for (const [type, adapter] of Object.entries(CharacterSheetProgression.DECISION_ADAPTERS)) {
			if (!editorMethods[adapter.editor] || !hasEditor(adapter.editor)) {
				issues.push({code: "adapter-missing-editor", type, handler: adapter.editor});
			}
			const family = familyForType(type);
			if (!applyMethods[family] || typeof respecProto[applyMethods[family]] !== "function") {
				issues.push({code: "adapter-missing-apply", type, handler: applyMethods[family]});
			}
			if (!reverseMethods[family] || typeof stateProto[reverseMethods[family]] !== "function") {
				issues.push({code: "adapter-missing-reverse", type, handler: reverseMethods[family]});
			}
			if (family !== "configuration" && typeof respecProto[applyMethods[family]] === "function"
				&& respecProto[applyMethods[family]] === respecProto._applyManifestSelectionMechanics) {
				issues.push({code: "adapter-generic-apply", type, handler: applyMethods[family]});
			}
			if (family !== "configuration" && typeof stateProto[reverseMethods[family]] === "function"
				&& stateProto[reverseMethods[family]] === stateProto.reverseProgressionDecisionReceipt) {
				issues.push({code: "adapter-generic-reverse", type, handler: reverseMethods[family]});
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

	static getFeatureOwnerUid (entity) {
		if (!entity?.name) return "";
		return [
			entity.name,
			entity.source,
			entity.className,
			entity.classSource,
			entity.subclassShortName,
			entity.subclassSource,
			entity.level,
		].map(CharacterSheetProgression._normalize).join("|");
	}

	static _matchesFeatureEntity (candidate, entity) {
		for (const prop of ["name", "source", "className", "classSource", "subclassShortName", "subclassSource", "level"]) {
			if (entity?.[prop] == null) continue;
			if (CharacterSheetProgression._normalize(candidate?.[prop]) !== CharacterSheetProgression._normalize(entity[prop])) return false;
		}
		return true;
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

	static getFixedOriginFeatSemanticKey ({
		originType,
		originUid,
		featName,
		featSource,
	}) {
		const entityKey = CharacterSheetProgression.getOriginSemanticKey({
			originType,
			originUid,
			grantKey: "entity",
		});
		const featUid = CharacterSheetProgression.getEntityUid({
			name: featName,
			source: featSource,
		});
		return CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: entityKey,
			acquisitionKey: `base:${originType}:${originUid}`,
			grantKey: `fixed-feat:${featUid}`,
			identityMode: "opportunity",
		});
	}

	static getUnplacedFeatSemanticKey (feat) {
		return [
			"unplaced",
			"feat",
			CharacterSheetProgression._slug(feat?.name),
			CharacterSheetProgression._slug(feat?.source),
		].join(":");
	}

	static _getFeatDecisionSelections (decision) {
		if (!["feat", "asiOrFeat", "classFeatProgressionFeat", "nestedFeat"].includes(decision?.type)) return [];
		const selection = decision.selection;
		if (selection == null) return [];
		if (selection.mode === "asi") return [];
		if (selection.mode === "feat") return selection.feat ? [selection.feat] : [];
		const values = Array.isArray(selection) ? selection : [selection];
		return values
			.map(value => value?.feat?.name ? value.feat : value)
			.filter(value => value?.name);
	}

	static _getUnplacedFeatChoiceEvidence ({feat, catalogFeat, page, state, spec = null}) {
		spec ||= CharacterSheetClassUtils.buildFeatChoicesSpec(catalogFeat || feat, {page, state});
		const choices = feat?.choices || feat?._featChoices || {};
		const recorded = {};
		const missing = [];
		const addScalar = (key, expected) => {
			if (choices[key] != null && choices[key] !== "") recorded[key] = CharacterSheetProgression._copy(choices[key]);
			else if (expected) missing.push(key);
		};
		const addArray = (key, expected) => {
			const values = Array.isArray(choices[key]) ? choices[key].filter(Boolean) : [];
			if (values.length) recorded[key] = CharacterSheetProgression._copy(values);
			if (expected && values.length < (Number(expected.count) || 1)) {
				missing.push(key);
			}
		};
		addScalar("ability", spec.ability);
		addArray("skills", spec.skills);
		addArray("expertise", spec.expertise);
		addArray("tools", spec.tools);
		addArray("languages", spec.languages);
		if (spec.spells?.list) addScalar("spellList", spec.spells.list);
		if (spec.spells?.cantrips) addArray("cantrips", spec.spells.cantrips);
		if (spec.spells?.spells) addArray("spells", spec.spells.spells);
		if (Array.isArray(spec.optionalFeatures) && spec.optionalFeatures.length) {
			addArray("optionalFeatures", {count: spec.optionalFeatures.reduce((total, item) => total + (Number(item.count) || 1), 0)});
		}
		for (const key of ["ability", "skills", "expertise", "tools", "languages", "spellList", "cantrips", "spells", "optionalFeatures"]) {
			if (key in recorded) continue;
			if (Array.isArray(choices[key])) addArray(key, null);
			else addScalar(key, null);
		}
		return {
			recorded,
			missing,
			hasExpectedChoices: Object.values(spec).some(Boolean),
		};
	}

	static _parseFixedOriginFeatGrant (key) {
		if (!key || typeof key !== "string") return null;
		const [nameRaw, sourceRaw = "PHB"] = key.split("|");
		if (!nameRaw) return null;
		const titleCase = value => String(value || "").trim().replace(/\b\w/g, char => char.toUpperCase());
		const [baseName, subtype] = nameRaw.split(";").map(part => part.trim());
		return {
			name: subtype ? `${titleCase(baseName)} (${titleCase(subtype)})` : titleCase(baseName),
			source: String(sourceRaw || "PHB").toUpperCase(),
		};
	}

	static getNestedSemanticKey ({
		parentSemanticKey = null,
		acquisitionKey = "",
		grantKey = "",
		selectedGrantKey = "",
		occurrence = 0,
		slot = 0,
		identityMode = "selection",
	}) {
		const anchor = parentSemanticKey || acquisitionKey || "nested";
		const opportunityIdentity = [acquisitionKey, grantKey].filter(Boolean).join("|");
		const identity = identityMode === "opportunity"
			? opportunityIdentity
			: selectedGrantKey || grantKey || "choice";
		return [
			"nested",
			CharacterSheetProgression._slug(anchor),
			CharacterSheetProgression._slug(identity),
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
		if (type === CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE) {
			return CharacterSheetArtificerPlans.isExactSelection(selection);
		}
		if (type === CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE) {
			return !!selection?.targetSlotId
				&& CharacterSheetArtificerPlans.isExactSelection(selection?.previousPlan)
				&& CharacterSheetArtificerPlans.isExactSelection(selection?.nextPlan);
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

	static _getPreFeatureProficiencySnapshot ({entity, state}) {
		const currentTools = (state?.getToolProficiencies?.() || [])
			.map(tool => String(tool?.name ?? tool ?? "").trim())
			.filter(Boolean);
		const fixedContract = CharacterSheetClassUtils.getFixedProficiencyGrantContract?.(entity, {ownedTools: []});
		if (!fixedContract) return {tools: currentTools};

		const ownerUid = CharacterSheetProgression.getFeatureOwnerUid(entity);
		const storedFeature = (state?.getFeatures?.() || [])
			.find(feature => CharacterSheetProgression._matchesFeatureEntity(feature, entity));
		if (!storedFeature?.id) return {tools: currentTools};

		const fixedSource = `feature:${storedFeature.id}`;
		const choiceSource = `feature-choice:${storedFeature.id}`;
		const selectedByOwner = new Set([
			...(state?.getCharacterBase?.()?.decisions || []),
			...(state?.getLevelHistory?.() || []).flatMap(entry => entry.decisions || []),
		]
			.filter(decision => decision.type === "nestedTool"
				&& CharacterSheetProgression._normalize(decision.provenance?.ownerUid) === ownerUid)
			.flatMap(decision => Array.isArray(decision.selection) ? decision.selection : [decision.selection])
			.map(value => state?._getProgressionOwnershipKey?.("tools", value?.name ?? value)
				|| CharacterSheetProgression._slug(value?.name ?? value))
			.filter(Boolean));
		const trackedTools = state?._data?.grantedProficiencies?.tools || {};
		const getSources = tool => {
			const key = state?._getProgressionOwnershipKey?.("tools", tool)
				|| CharacterSheetProgression._slug(tool);
			return key ? trackedTools[key] || [] : [];
		};
		const fixedKeys = new Set(fixedContract.fixed.map(tool =>
			state?._getProgressionOwnershipKey?.("tools", tool) || CharacterSheetProgression._slug(tool),
		));

		return {
			tools: currentTools.filter(tool => {
				const sources = getSources(tool);
				const toolKey = state?._getProgressionOwnershipKey?.("tools", tool)
					|| CharacterSheetProgression._slug(tool);
				if (fixedKeys.has(toolKey)
					&& sources.length
					&& sources.every(source => source === fixedSource)) return false;
				if (sources.length && sources.every(source => source === choiceSource)) return false;
				if (selectedByOwner.has(toolKey)) return false;
				return true;
			}),
		};
	}

	static _getEntityChoiceDescriptors (entity, opts = {}) {
		const descriptors = (CharacterSheetClassUtils.getChoiceDescriptors?.(entity, opts) || [])
			.filter(descriptor => descriptor.rules?.poolDefinition !== "optionalFeature");
		for (const descriptor of descriptors) {
			const source = descriptor.rules?.optionSource;
			if (source?.kind === "proficientSkillsAtDecision" && !descriptor.options?.length) {
				const skillCatalog = (opts.skills?.length
					? opts.skills
					: CharacterSheetClassUtils.getChoiceSkillCatalog?.() || [])
					.map(skill => String(skill?.name || skill || "").trim().toLowerCase())
					.filter(Boolean);
				descriptor.options = [...new Set(skillCatalog)]
					.filter(skill => Number(opts.state?.getSkillProficiency?.(skill)) > 0)
					.sort((a, b) => a.localeCompare(b));
				descriptor.rules = {
					...descriptor.rules,
					optionSource: {
						...source,
						values: CharacterSheetProgression._copy(descriptor.options),
					},
				};
			}
			if (descriptor.options?.length || source?.kind !== "classFeature" || !source.ref) continue;
			const referenced = CharacterSheetClassUtils.getClassFeatureData?.(
				opts.classFeatures || [],
				...String(source.ref).split("|").slice(0, 4).map((value, ix) => ix === 3 ? Number(value) : value),
			);
			const referencedDescriptor = CharacterSheetClassUtils.getChoiceDescriptors?.(referenced, opts)
				?.find(candidate => candidate.kind === "entity");
			if (!referencedDescriptor) continue;
			descriptor.options = CharacterSheetProgression._copy(referencedDescriptor.options || []);
			descriptor.rules = {
				...descriptor.rules,
				optionSource: {
					...source,
					kind: "explicitList",
					values: CharacterSheetProgression._copy(descriptor.options),
				},
			};
		}
		return descriptors;
	}

	/**
	 * A recurring class-feature reference (for example the Warlock Specialty
	 * pool) points at the complete feature definition, including future-level
	 * entries.  A decision at class level N may only see entries available by N.
	 * Keep the original order and occurrence identity while narrowing the legal
	 * catalog; this makes a later migration deterministic instead of silently
	 * accepting a future choice.
	 */
	static _filterDescriptorOptionsForLevel (descriptor, classLevel) {
		const maxLevel = Number(classLevel) || 0;
		if (!maxLevel || !Array.isArray(descriptor?.options) || !descriptor.options.length) return descriptor;
		const filtered = descriptor.options.filter(option => {
			const ref = option?.ref || option?.classFeature || option?.subclassFeature;
			if (!ref) return true;
			const parts = String(ref).split("|");
			const referencedLevel = Number(
				option?.level
				|| option?.definitionLevel
				|| [...parts].reverse().find(part => /^\d+$/.test(String(part))) || 0,
			);
			return !referencedLevel || referencedLevel <= maxLevel;
		});
		return filtered.length === descriptor.options.length
			? descriptor
			: {
				...descriptor,
				options: filtered,
				rules: {
					...(descriptor.rules || {}),
					optionSource: descriptor.rules?.optionSource
						? {...descriptor.rules.optionSource, values: filtered}
						: descriptor.rules?.optionSource,
				},
			};
	}

	static getLegacyTrackedFeatureChoiceEvidence ({
		state,
		ownerUid,
		options = [],
		selection = null,
		type = "skills",
	} = {}) {
		const normalizedOwner = CharacterSheetProgression._normalize(ownerUid);
		const normalizeValue = value => {
			if (type === "skills") return String(value || "").trim().toLowerCase().replace(/['\s]+/g, "");
			if (type === "tools") {
				return state?._getProgressionOwnershipKey?.("tools", value)
					|| CharacterSheetProgression._slug(value);
			}
			return CharacterSheetProgression._slug(value);
		};
		const optionByKey = new Map(options.map(option => {
			const value = option?.value ?? option?.name ?? option;
			return [normalizeValue(value), value];
		}));
		const selectedKey = selection == null
			? null
			: normalizeValue(selection?.value ?? selection?.name ?? selection);
		const matches = [];
		for (const feature of state?.getFeatures?.() || []) {
			if (!feature?.id || CharacterSheetProgression.getEntityUid(feature) !== normalizedOwner) continue;
			const sourceId = `feature-choice:${feature.id}`;
			for (const [value, sources] of Object.entries(state?._data?.grantedProficiencies?.[type] || {})) {
				const valueKey = normalizeValue(value);
				if (!optionByKey.has(valueKey) || (selectedKey && valueKey !== selectedKey)) continue;
				if (!(sources || []).includes(sourceId)) continue;
				matches.push({
					value: CharacterSheetProgression._copy(optionByKey.get(valueKey)),
					featureId: feature.id,
					sourceId,
					type,
					trackedKey: value,
				});
			}
		}
		return matches.length === 1 ? matches[0] : null;
	}

	static _getSelectedDescriptorValue ({descriptor, entity, state, parentDecision = null, legacyChoices = null}) {
		if (descriptor?.rules?.selectedValues != null) {
			return CharacterSheetProgression._copy(descriptor.rules.selectedValues);
		}
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
				const selectedAbilityChoices = originChoices.selectedAbilityChoices || {};
				const ownerUid = CharacterSheetProgression.getEntityUid(entity);
				const ownerChoices = Object.entries(selectedAbilityChoices)
					.find(([key, value]) =>
						value && typeof value === "object" && CharacterSheetProgression._normalize(key) === ownerUid,
					)?.[1] || selectedAbilityChoices;
				const selected = ownerChoices[`choose_${choiceIndex}_0`] ??
					ownerChoices[sourcePath.match(/ability\[(\d+)\]/)?.[1] || choiceIndex];
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
		if (descriptor.kind === "skill") {
			const evidence = CharacterSheetProgression.getLegacyTrackedFeatureChoiceEvidence({
				state,
				ownerUid: CharacterSheetProgression.getEntityUid(entity),
				options: descriptor.options,
			});
			if (evidence) return evidence.value;
		}
		if (descriptor.kind === "tool") {
			const storedFeature = (state?.getFeatures?.() || [])
				.find(feature => CharacterSheetProgression._matchesFeatureEntity(feature, entity));
			const sourceId = storedFeature?.id ? `feature-choice:${storedFeature.id}` : null;
			if (sourceId) {
				const selected = (descriptor.options || [])
					.map(option => option?.value ?? option?.name ?? option)
					.filter(value => {
						const key = state?._getProgressionOwnershipKey?.("tools", value)
							|| CharacterSheetProgression._slug(value);
						return key && (state._data.grantedProficiencies.tools[key] || []).includes(sourceId);
					});
				if (selected.length === descriptor.count) return descriptor.count === 1 ? selected[0] : selected;
			}
		}
		if (descriptor.kind === "skillBonus") {
			const optionSkills = new Set((descriptor.options || [])
				.map(option => CharacterSheetProgression._normalize(option?.value ?? option?.name ?? option))
				.filter(Boolean));
			const ownerName = CharacterSheetProgression._normalize(entity?.name);
			const candidates = (state?.getNamedModifiers?.() || [])
				.filter(modifier => {
					if (modifier.sourceDecisionKey) return false;
					if (descriptor.rules?.bonusFormula === "proficiencyBonus" && modifier.proficiencyBonus !== true) return false;
					const skill = CharacterSheetProgression._normalize(String(modifier.type || "").match(/^skill:(.+)$/)?.[1]);
					if (!skill || !optionSkills.has(skill)) return false;
					const modifierName = CharacterSheetProgression._normalize(modifier.name);
					return modifierName === ownerName || modifierName.startsWith(`${ownerName} `);
				});
			if (candidates.length === 1) {
				return CharacterSheetProgression._normalize(candidates[0].type.split(":")[1]);
			}
		}
		// 2024 species origin-feat choices are materialized in the state as the
		// origin feat itself, rather than in the legacy race-choice map. Use that
		// exact feat identity as the selection for an anyFromCategory descriptor
		// so Human's Origin Feat remains editable after save/reload.
		if (descriptor.kind === "feat") {
			const originFeat = state?.getOriginFeat?.();
			if (originFeat?.name) {
				return {
					name: originFeat.name,
					...(originFeat.source ? {source: originFeat.source} : {}),
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
		// `subclassFeature` contains the word "class"; resolve it before the
		// generic class-feature branch or a subclass child can be looked up in the
		// wrong catalog.
		if (type.includes("subclass") || option.subclassFeature) {
			return (page?.getSubclassFeatures?.() || []).find(feature =>
				CharacterSheetProgression._normalize(feature.name) === CharacterSheetProgression._normalize(name)
						&& (!source || CharacterSheetProgression._normalize(feature.source) === CharacterSheetProgression._normalize(source)),
			) || null;
		}
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
		const feat = (page?.getFeats?.() || []).find(candidate =>
			CharacterSheetProgression._normalize(candidate.name) === CharacterSheetProgression._normalize(name)
					&& (!source || CharacterSheetProgression._normalize(candidate.source) === CharacterSheetProgression._normalize(source)),
		);
		return feat || null;
	}

	static _getNestedSelectionFallback ({descriptor, entity, state}) {
		const fixedProficiencyFallbackOwnerUid = descriptor.rules?.fixedProficiencyFallback
			? descriptor.rules?.ownerUid
			: null;
		if (fixedProficiencyFallbackOwnerUid) {
			const transaction = state?.getFixedProficiencyFallbackTransaction?.(fixedProficiencyFallbackOwnerUid);
			if (transaction?.status === "resolved" && transaction.selection) return transaction.selection;
		}
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
		let descriptors = CharacterSheetProgression._getEntityChoiceDescriptors(entity, {
			sourcePath: entity.name || "entity",
			className: levelInfo?.className,
			classSource: levelInfo?.classSource,
			state,
			skills: page?.getSkillsList?.() || [],
			classFeatures: page?.getClassFeatures?.() || [],
			subclassFeatures: page?.getSubclassFeatures?.() || [],
			optionalFeatures: page?.getOptionalFeatures?.() || [],
			feats: page?.getFeats?.() || [],
		});
		descriptors = descriptors.map(descriptor =>
			CharacterSheetProgression._filterDescriptorOptionsForLevel(descriptor, levelInfo?.classLevel),
		);
		const census = CharacterSheetClassUtils.getChoiceDescriptorCensus?.(entity, {
			feats: page?.getFeats?.() || [],
		});
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
			const descriptorAcquisitionKey = descriptor.rules?.acquisitionKey || acquisitionKey || CharacterSheetProgression.getAcquisitionKey({
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
			const parentSemanticKey = parentDecision?.semanticKey || descriptor.rules?.parentSemanticKey || null;
			const pickSlot = descriptor.rules?.pickSlot ?? descriptorIx;
			const semanticKey = CharacterSheetProgression.getNestedSemanticKey({
				parentSemanticKey,
				acquisitionKey: descriptorAcquisitionKey,
				grantKey: descriptor.grantKey,
				selectedGrantKey: selectedKeys.join("|"),
				occurrence: descriptor.occurrence,
				slot: pickSlot,
				identityMode: descriptor.rules?.identityMode,
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
				slot: pickSlot,
				required: descriptor.required,
				count: descriptor.count,
				options: descriptor.options,
				selection,
				status: exact?.status || null,
				receipt: exact?.receipt || null,
				isValid,
				meta: {descriptorRules: descriptor.rules},
				scope,
				parentSemanticKey,
				rootSemanticKey: rootSemanticKey || descriptor.rules?.rootSemanticKey || parentSemanticKey || semanticKey,
				depth,
				semanticKeyOverride: semanticKey,
				provenance: {
					ownerType: parentEntity?.featureType || "classFeature",
					ownerUid: descriptor.rules?.ownerUid || CharacterSheetProgression.getEntityUid(entity),
					acquisitionKey: descriptorAcquisitionKey,
					selectedGrantKey: selectedKeys.join("|") || null,
					grantKind: descriptor.kind,
					grantKey: descriptor.grantKey,
					sourcePath: descriptor.sourcePath,
					occurrence: descriptor.occurrence,
					pickSlot,
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

	static _buildOriginAbilityDistribution ({
		originType,
		entity,
		choices,
		originUid,
		entityKey,
		storedBasePool,
	}) {
		if (originType !== "background") return [];
		const modes = (entity?.ability || [])
			.map((abilitySet, modeIndex) => {
				const choose = abilitySet?.choose;
				if (!choose) return null;
				const weights = choose.weighted?.weights
					|| (choose.count ? Array(Number(choose.count) || 0).fill(Number(choose.amount) || 1) : []);
				const from = choose.weighted?.from || choose.from || [];
				if (!weights.length || !from.length) return null;
				return {
					name: weights.map(weight => `+${weight}`).join("/"),
					key: `mode-${modeIndex}`,
					modeIndex,
					weights: CharacterSheetProgression._copy(weights),
					from: CharacterSheetProgression._copy(from),
				};
			})
			.filter(Boolean);
		if (modes.length < 2) return [];

		const acquisitionKey = `base:${originType}:${originUid}`;
		const grantKey = `${originType}.ability.distribution`;
		const semanticKey = CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: entityKey,
			acquisitionKey,
			grantKey,
			identityMode: "opportunity",
		});
		const stored = storedBasePool.get(semanticKey)?.find(decision => decision.selection != null);
		const selectedBonuses = choices?.selectedAbilityBonuses || {};
		const selectedWeights = Object.keys(selectedBonuses)
			.filter(key => /^bg_\d+_weight$/.test(key))
			.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
			.map(key => Number(selectedBonuses[key]));
		const persistedMode = modes.find(mode =>
			mode.weights.length === selectedWeights.length
				&& mode.weights.every((weight, ix) => weight === selectedWeights[ix]),
		) || null;
		const selection = stored?.selection ?? persistedMode;
		const selectedMode = modes.find(mode =>
			mode.key === selection?.key
				|| (
					Array.isArray(selection?.weights)
					&& mode.weights.length === selection.weights.length
					&& mode.weights.every((weight, ix) => weight === Number(selection.weights[ix]))
				),
		) || null;
		const parent = CharacterSheetProgression._makeDecision({
			characterLevel: 0,
			className: "Base",
			classSource: "",
			classLevel: 0,
			type: "nestedConfiguration",
			label: "Background Ability Distribution",
			sourceKey: grantKey,
			count: 1,
			options: modes,
			selection,
			isValid: CharacterSheetProgression._isSelectionValid({
				selection,
				count: 1,
				options: modes,
				type: "nestedConfiguration",
			}),
			receipt: stored?.receipt || null,
			meta: {originAbilityDistribution: true},
			scope: "origin",
			semanticKeyOverride: semanticKey,
			rootSemanticKey: entityKey,
			depth: 1,
			parentSemanticKey: entityKey,
			provenance: {
				ownerType: originType,
				ownerUid: originUid,
				acquisitionKey,
				selectedGrantKey: originUid,
				grantKind: "configuration",
				grantKey,
				sourcePath: `${originType}.ability`,
				occurrence: 0,
				pickSlot: 0,
			},
		});
		const decisions = [parent];
		if (!selectedMode) return decisions;

		const selectedAbilities = selectedMode.weights.map((weight, ix) => selectedBonuses[`bg_${ix}`] || null);
		const selectedCounts = selectedAbilities.reduce((counts, ability) => {
			if (ability) counts.set(ability, (counts.get(ability) || 0) + 1);
			return counts;
		}, new Map());
		selectedMode.weights.forEach((amount, ix) => {
			const childGrantKey = `${grantKey}.${selectedMode.key}.ability-${ix}`;
			const childSemanticKey = CharacterSheetProgression.getNestedSemanticKey({
				parentSemanticKey: semanticKey,
				acquisitionKey,
				grantKey: childGrantKey,
				occurrence: selectedMode.modeIndex,
				slot: ix,
				identityMode: "opportunity",
			});
			const storedChild = storedBasePool.get(childSemanticKey)?.find(decision => decision.selection != null);
			const childSelection = storedChild?.selection ?? selectedAbilities[ix];
			const isUnique = !childSelection || selectedCounts.get(childSelection) === 1;
			decisions.push(CharacterSheetProgression._makeDecision({
				characterLevel: 0,
				className: "Base",
				classSource: "",
				classLevel: 0,
				type: "nestedAbility",
				label: `Background Ability +${amount}`,
				sourceKey: childGrantKey,
				slot: ix,
				count: 1,
				options: selectedMode.from,
				selection: childSelection,
				isValid: isUnique && CharacterSheetProgression._isSelectionValid({
					selection: childSelection,
					count: 1,
					options: selectedMode.from,
					type: "nestedAbility",
				}),
				receipt: storedChild?.receipt || null,
				meta: {
					originAbilityDistribution: true,
					originAbilitySelectionKey: `bg_${ix}`,
					descriptorRules: {
						amount,
						optionSource: {
							kind: "explicitList",
							values: selectedMode.from,
						},
					},
				},
				scope: "origin",
				semanticKeyOverride: childSemanticKey,
				rootSemanticKey: entityKey,
				depth: 2,
				parentSemanticKey: semanticKey,
				provenance: {
					ownerType: originType,
					ownerUid: originUid,
					acquisitionKey,
					selectedGrantKey: selectedMode.key,
					grantKind: "ability",
					grantKey: childGrantKey,
					sourcePath: `${originType}.ability[${selectedMode.modeIndex}]`,
					occurrence: selectedMode.modeIndex,
					pickSlot: ix,
				},
			}));
		});
		return decisions;
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
				receipt: entityStored?.receipt || null,
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
			const descriptors = CharacterSheetProgression._getEntityChoiceDescriptors(entity, {
				sourcePath: originType,
				feats: page?.getFeats?.() || [],
				classFeatures: page?.getClassFeatures?.() || [],
				subclassFeatures: page?.getSubclassFeatures?.() || [],
				optionalFeatures: page?.getOptionalFeatures?.() || [],
			});
			const census = CharacterSheetClassUtils.getChoiceDescriptorCensus?.(entity, {
				feats: page?.getFeats?.() || [],
			});
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
			const abilityDistributionDecisions = CharacterSheetProgression._buildOriginAbilityDistribution({
				originType,
				entity,
				choices,
				originUid,
				entityKey,
				storedBasePool,
			});
			base.decisions.push(...abilityDistributionDecisions);
			const hasAbilityDistribution = abilityDistributionDecisions.length > 0;
			(entity.feats || []).forEach((featEntry, featIx) => {
				if (!featEntry || typeof featEntry !== "object" || featEntry.anyFromCategory) return;
				Object.entries(featEntry).forEach(([rawKey, isGranted], grantIx) => {
					if (!isGranted || rawKey === "anyFromCategory") return;
					const parsed = CharacterSheetProgression._parseFixedOriginFeatGrant(rawKey);
					if (!parsed) return;
					const catalogFeat = (page?.getFeats?.() || []).find(feat =>
						CharacterSheetProgression.getEntityUid(feat) === CharacterSheetProgression.getEntityUid(parsed),
					);
					const selection = {name: catalogFeat?.name || parsed.name, source: catalogFeat?.source || parsed.source};
					const semanticKey = CharacterSheetProgression.getFixedOriginFeatSemanticKey({
						originType,
						originUid,
						featName: selection.name,
						featSource: selection.source,
					});
					const stored = storedBasePool.get(semanticKey)?.find(decision => decision.selection != null);
					base.decisions.push(CharacterSheetProgression._makeDecision({
						characterLevel: 0,
						className: "Base",
						classSource: "",
						classLevel: 0,
						type: "nestedFeat",
						label: `${selection.name} (Fixed ${originType === "race" ? "Species" : "Background"} Feat)`,
						sourceKey: `fixed-feat:${CharacterSheetProgression.getEntityUid(selection)}`,
						slot: grantIx,
						count: 1,
						options: [catalogFeat || selection],
						selection: stored?.selection || selection,
						receipt: stored?.receipt || null,
						meta: {
							fixedOriginGrant: true,
							originGrantIndex: featIx,
						},
						scope: "origin",
						semanticKeyOverride: semanticKey,
						rootSemanticKey: entityKey,
						depth: 1,
						parentSemanticKey: entityKey,
						provenance: {
							ownerType: originType,
							ownerUid: originUid,
							acquisitionKey: `base:${originType}:${originUid}`,
							selectedGrantKey: CharacterSheetProgression.getEntityUid(selection),
							grantKind: "feat",
							grantKey: `fixed-feat:${CharacterSheetProgression.getEntityUid(selection)}`,
							sourcePath: `${originType}.feats[${featIx}]`,
							occurrence: featIx,
							pickSlot: grantIx,
						},
					}));
				});
			});
			descriptors.forEach((descriptor, slot) => {
				if (
					hasAbilityDistribution
						&& descriptor.kind === "ability"
						&& String(descriptor.sourcePath || "").startsWith(`${originType}.ability[`)
				) return;
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
				const storedDecision = storedBasePool.get(key)?.find(item => item.selection != null);
				const selected = CharacterSheetProgression._getSelectedDescriptorValue({
					descriptor,
					entity,
					state,
					legacyChoices: choices,
				});
				const selectedFallback = storedDecision?.selection ?? selected ??
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
					receipt: storedDecision?.receipt || null,
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

	static _appendUnplacedFeatDecisions ({base, decisions, page, state, storedBasePool}) {
		const representedFeatUids = new Set(decisions
			.flatMap(decision => CharacterSheetProgression._getFeatDecisionSelections(decision))
			.map(selection => CharacterSheetProgression.getEntityUid(selection))
			.filter(Boolean));
		const catalogByUid = new Map((page?.getFeats?.() || []).map(feat => [
			CharacterSheetProgression.getEntityUid(feat),
			feat,
		]));

		for (const feat of state?.getFeats?.() || []) {
			const featUid = CharacterSheetProgression.getEntityUid(feat);
			if (!featUid) continue;
			const catalogFeat = catalogByUid.get(featUid);
			if (catalogFeat?.category === "EB") continue;
			const semanticKey = CharacterSheetProgression.getUnplacedFeatSemanticKey(feat);
			if (feat.sourceDecisionKey && feat.sourceDecisionKey !== semanticKey) continue;
			if (!feat.sourceDecisionKey && representedFeatUids.has(featUid)) continue;

			const stored = storedBasePool.get(semanticKey)?.find(decision => decision.selection != null);
			const selection = {name: feat.name, source: feat.source};
			const choiceSpec = CharacterSheetClassUtils.buildFeatChoicesSpec(catalogFeat || feat, {page, state});
			const decision = CharacterSheetProgression._makeDecision({
				characterLevel: null,
				className: "",
				classSource: "",
				classLevel: null,
				type: "nestedFeat",
				label: `${feat.name} (Unplaced Feat)`,
				sourceKey: `unplaced-feat:${featUid}`,
				required: false,
				count: 1,
				options: [catalogFeat || selection],
				selection,
				receipt: stored?.receipt || null,
				meta: {
					unplacedFeat: true,
					featId: feat.id,
					choiceEvidence: CharacterSheetProgression._getUnplacedFeatChoiceEvidence({
						feat,
						catalogFeat,
						page,
						state,
						spec: choiceSpec,
					}),
				},
				scope: "unplaced",
				semanticKeyOverride: semanticKey,
				provenance: {
					ownerType: "unplacedFeat",
					ownerUid: featUid,
					acquisitionKey: "unknown",
					selectedGrantKey: featUid,
					grantKind: "feat",
					grantKey: `unplaced-feat:${featUid}`,
					sourcePath: "feats",
				},
			});
			base.decisions.push(decision);
			decisions.push(decision);

			const activeChoiceKeys = Object.entries(choiceSpec)
				.filter(([, value]) => !!value)
				.map(([key]) => key)
				.sort();
			const isAbilityOnly = activeChoiceKeys.join("|") === "ability";
			const isAbilitySkillExpertise = activeChoiceKeys.join("|") === "ability|expertise|skills";
			if (!isAbilityOnly && !isAbilitySkillExpertise) continue;

			const acquisitionKey = `unplaced-feat:${featUid}`;
			const getChildSemanticKey = (choiceKey, slot) => CharacterSheetProgression.getNestedSemanticKey({
				parentSemanticKey: semanticKey,
				acquisitionKey,
				grantKey: choiceKey,
				occurrence: 0,
				slot,
				identityMode: "opportunity",
			});
			const featChoices = feat.choices || feat._featChoices || {};
			const appendChild = ({
				choiceKey,
				type,
				label,
				slot,
				options,
				selection,
				rules = {},
				meta = {},
			}) => {
				const childSemanticKey = getChildSemanticKey(choiceKey, slot);
				const storedChild = storedBasePool.get(childSemanticKey)?.find(child => child.selection != null);
				const rawSelection = storedChild?.selection ?? selection ?? null;
				const childSelection = type === "nestedAbility" && Array.isArray(rawSelection) && rawSelection.length === 1
					? rawSelection[0]
					: rawSelection;
				const child = CharacterSheetProgression._makeDecision({
					characterLevel: null,
					className: "",
					classSource: "",
					classLevel: null,
					type,
					label,
					sourceKey: choiceKey,
					slot,
					required: true,
					count: Number(rules.count) || 1,
					options,
					selection: childSelection,
					receipt: storedChild?.receipt || null,
					isValid: CharacterSheetProgression._isSelectionValid({
						selection: childSelection,
						count: Number(rules.count) || 1,
						options,
						type,
					}),
					meta: {
						unplacedFeatChoice: true,
						featId: feat.id,
						featChoiceKey: choiceKey,
						descriptorRules: {
							...rules,
							optionSource: rules.optionSource || {
								kind: "explicitList",
								values: options,
							},
						},
						...meta,
					},
					scope: "unplaced",
					parentSemanticKey: semanticKey,
					rootSemanticKey: semanticKey,
					depth: 1,
					semanticKeyOverride: childSemanticKey,
					provenance: {
						ownerType: "unplacedFeat",
						ownerUid: featUid,
						acquisitionKey,
						selectedGrantKey: childSelection || null,
						grantKind: choiceKey,
						grantKey: choiceKey,
						sourcePath: `feat.${choiceKey}`,
						occurrence: 0,
						pickSlot: slot,
					},
				});
				base.decisions.push(child);
				decisions.push(child);
				return child;
			};

			appendChild({
				choiceKey: "ability",
				type: "nestedAbility",
				label: `${feat.name} Ability`,
				slot: 0,
				options: choiceSpec.ability.from || [],
				selection: featChoices.ability,
				rules: {
					count: choiceSpec.ability.count,
					amount: Number(choiceSpec.ability.amount) || 1,
					max: Number(choiceSpec.ability.max) || 20,
				},
				meta: {unplacedFeatAbility: true},
			});
			if (!isAbilitySkillExpertise) continue;

			const skillCatalogByKey = new Map();
			for (const skill of [
				...(choiceSpec.skills?.from || []),
				...(page?.getSkillsList?.() || []).map(skill => skill?.name || skill),
			].filter(Boolean)) {
				const key = CharacterSheetProgression._normalize(skill).replace(/['\s]+/g, "");
				if (key && !skillCatalogByKey.has(key)) skillCatalogByKey.set(key, skill);
			}
			const skillCatalog = [...skillCatalogByKey.values()];
			const currentSkills = Array.isArray(featChoices.skills) ? featChoices.skills : [];
			const currentExpertise = Array.isArray(featChoices.expertise) ? featChoices.expertise : [];
			const skillSemanticKey = getChildSemanticKey("skills", 1);
			const expertiseSemanticKey = getChildSemanticKey("expertise", 2);
			const isIndependent = (type, value, sourceDecisionKey = null) => {
				const key = CharacterSheetProgression._normalize(value).replace(/['\s]+/g, "");
				const entry = state?._getProgressionOwnershipEntry?.(type, key);
				const ignoredSources = new Set([sourceDecisionKey, `feat:${feat.id}`].filter(Boolean));
				if (entry?.preserved || entry?.sources?.some(source => !ignoredSources.has(source))) return true;
				const grants = state?._data?.grantedProficiencies?.skills?.[key] || [];
				return !!grants.length && (type !== "expertise" || Number(state?.getSkillProficiency?.(key)) >= 2);
			};
			const isSelected = (values, value) => values.some(selected =>
				CharacterSheetProgression._normalize(selected) === CharacterSheetProgression._normalize(value),
			);
			const skillOptions = skillCatalog.filter(skill => {
				const key = CharacterSheetProgression._normalize(skill).replace(/['\s]+/g, "");
				const isCurrent = isSelected(currentSkills, skill);
				if (isCurrent && !isIndependent("skills", key, skillSemanticKey)) return true;
				return Number(state?.getSkillProficiency?.(key)) < 1;
			});
			const skill = appendChild({
				choiceKey: "skills",
				type: "nestedSkill",
				label: `${feat.name} Skill Proficiency`,
				slot: 1,
				options: skillOptions,
				selection: currentSkills.length ? currentSkills : null,
				rules: {count: choiceSpec.skills.count},
				meta: {unplacedFeatSkill: true},
			});
			const selectedSkillKeys = new Set((Array.isArray(skill.selection) ? skill.selection : [skill.selection])
				.filter(Boolean)
				.map(value => CharacterSheetProgression._normalize(value).replace(/['\s]+/g, "")));
			const expertiseOptions = skillCatalog
				.map(skill => CharacterSheetProgression._normalize(skill).replace(/['\s]+/g, ""))
				.filter((skill, ix, all) => skill && all.indexOf(skill) === ix)
				.filter(skill => {
					const isCurrent = isSelected(currentExpertise, skill);
					const skillOwnership = state?._getProgressionOwnershipEntry?.("skills", skill);
					const hasOwnedProficiency = skillOwnership?.preserved || skillOwnership?.sources?.length;
					const hasProficiency = selectedSkillKeys.has(skill)
						|| (state?._data?.progressionOwnership?.initialized
							? !!hasOwnedProficiency
							: Number(state?.getSkillProficiency?.(skill)) >= 1);
					if (!hasProficiency) return false;
					if (isIndependent("expertise", skill, expertiseSemanticKey)) return false;
					return Number(state?.getSkillProficiency?.(skill)) < 2 || isCurrent;
				});
			appendChild({
				choiceKey: "expertise",
				type: "nestedExpertise",
				label: `${feat.name} Expertise`,
				slot: 2,
				options: expertiseOptions,
				selection: currentExpertise.length ? currentExpertise : null,
				rules: {
					count: choiceSpec.expertise.count,
					optionSource: {kind: "proficientSkillsAtDecision"},
				},
				meta: {
					unplacedFeatExpertise: true,
					dependsOnSemanticKeys: [skill.semanticKey],
				},
			});
		}
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
			// A discovered selection is evidence of a choice, not proof that this
			// decision applied a reversible state effect. Receipts are created by the
			// canonical acquisition/edit mutation path (or reconstructed from exact
			// persisted evidence), never inferred from a selection alone.
			receipt: CharacterSheetProgression._copy(receipt || null),
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
		const isUnplaced = decision?.scope === "unplaced" || decision?.meta?.unplacedFeat;
		const normalized = {
			...CharacterSheetProgression._copy(decision || {}),
			characterLevel: isUnplaced ? null : (Number(decision?.characterLevel ?? entry.level) || 0),
			className: isUnplaced ? "" : (decision?.className || entry.class?.name || "Unknown"),
			classSource: isUnplaced ? "" : (decision?.classSource || entry.class?.source || ""),
			classLevel: isUnplaced ? null : (Number(decision?.classLevel ?? entry.classLevel ?? entry.level) || 0),
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
			// Sparse legacy rows are common in older saves. Re-project only the
			// compatibility families which are actually represented by `choices`,
			// while retaining every persisted graph decision (including unknown
			// newer payloads). The old implementation kept only nested/origin
			// rows and silently discarded top-level decisions which had not yet
			// been discovered by the current catalog.
			const legacyKeys = new Set(legacy.map(decision => decision.semanticKey));
			const preserved = (normalized.decisions || []).filter(decision => !legacyKeys.has(decision.semanticKey));
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
			artificerPlan: [CharacterSheetArtificerPlans.CHOICE_KEY_ACQUIRE],
			artificerPlanReplacement: [CharacterSheetArtificerPlans.CHOICE_KEY_REPLACE],
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
				case "artificerPlan":
					append(CharacterSheetArtificerPlans.CHOICE_KEY_ACQUIRE, [{
						opportunityId: decision.meta?.opportunityId,
						slotId: decision.meta?.slotId,
						acquisitionLevel: decision.classLevel,
						selection,
					}]);
					break;
				case "artificerPlanReplacement":
					append(CharacterSheetArtificerPlans.CHOICE_KEY_REPLACE, [{
						opportunityId: decision.meta?.opportunityId,
						replacementLevel: decision.classLevel,
						selection,
					}]);
					break;
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
			case "artificerPlan": {
				const values = choices[CharacterSheetArtificerPlans.CHOICE_KEY_ACQUIRE] || [];
				const matched = values.find(value =>
					value?.opportunityId === sourceKey
						|| value?.slotId === sourceKey
						|| Number(value?.slot) === Number(slot),
				);
				return matched?.selection || matched || null;
			}
			case "artificerPlanReplacement": {
				const values = choices[CharacterSheetArtificerPlans.CHOICE_KEY_REPLACE] || [];
				const matched = values.find(value => value?.opportunityId === sourceKey);
				return matched?.selection || matched || null;
			}
			case "scholar": return choices.scholarSkill || null;
			case "hp": return choices.hpRoll != null ? {method: "roll", value: choices.hpRoll} : {method: "average"};
			default: return null;
		}
	}

	static _getLegacyEpicBoonRepair ({improvement, legacyFeat, legacyAsi, state, featPool}) {
		if (improvement?.kind !== "feat" || legacyFeat?.name || !legacyAsi) return null;
		if (Object.values(legacyAsi).reduce((total, value) => total + (Number(value) || 0), 0) !== 2) return null;

		const canonicalByUid = new Map((featPool || []).map(feat => [
			CharacterSheetProgression.getEntityUid(feat),
			feat,
		]));
		const candidates = (state?.getFeats?.() || []).filter(stored => {
			if (stored.sourceDecisionKey) return false;
			const canonical = canonicalByUid.get(CharacterSheetProgression.getEntityUid(stored));
			if (canonical?.category !== "EB") return false;
			const ability = String(stored.choices?.ability || "").toLowerCase();
			const abilityGrant = CharacterSheetClassUtils.getEffectiveFeatAbility(canonical)
				?.find(entry => entry?.choose?.from?.includes(ability));
			if (!abilityGrant) return false;
			const deltas = stored.appliedEffects?.abilityDeltas;
			return deltas && typeof deltas === "object" && !Object.keys(deltas).length;
		});
		if (candidates.length !== 1) return null;

		const stored = candidates[0];
		const canonical = canonicalByUid.get(CharacterSheetProgression.getEntityUid(stored));
		const ability = String(stored.choices.ability).toLowerCase();
		const abilityGrant = CharacterSheetClassUtils.getEffectiveFeatAbility(canonical)
			.find(entry => entry?.choose?.from?.includes(ability));
		return {
			feat: {name: canonical.name, source: canonical.source},
			ability,
			amount: Number(abilityGrant.choose.amount) || 1,
			max: Number(abilityGrant.max) || 20,
			legacyAsi: CharacterSheetProgression._copy(legacyAsi),
		};
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

	static _isLegacyCumulativeSpellProgression ({className, classSource, history, spellPool}) {
		if (!Object.values(spellPool || {}).some(spells => spells?.length)) return false;
		const classUid = CharacterSheetProgression.getClassUid(className, classSource);
		const classHistory = (history || []).filter(entry =>
			CharacterSheetProgression.getClassUid(entry?.class) === classUid,
		);
		if (!classHistory.length) return false;

		const acquisitionTypes = new Set(["knownSpells", "cantrips"]);
		if (classHistory.some(entry =>
			(entry.decisions || []).some(decision =>
				acquisitionTypes.has(decision.type) && decision.meta?.legacyCumulative,
			),
		)) return true;

		const hasRecordedAcquisition = classHistory.some(entry =>
			["knownSpells", "knownCantrips", "cantrips", "spellSwap", "spellSwaps"].some(key => {
				const value = entry.choices?.[key];
				return Array.isArray(value) ? value.length : value != null;
			}),
		);
		return !hasRecordedAcquisition;
	}

	static _getExistingSelection ({
		storedPool,
		semanticKey,
		history,
		type,
		sourceKey,
		slot,
		fallback = null,
		fallbackStatus = "ambiguous",
		preferFallback = false,
	}) {
		if (preferFallback && fallback != null) {
			return {selection: CharacterSheetProgression._copy(fallback), status: fallbackStatus};
		}
		const exact = storedPool.get(semanticKey)?.find(decision => decision.selection != null);
		if (exact) return {selection: CharacterSheetProgression._copy(exact.selection), status: exact.status};
		const entry = Array.isArray(history) ? history[0] : history;
		const choices = entry?.choices || {};
		const sourceNeedle = CharacterSheetProgression._normalize(sourceKey);
		const matchesSource = value => {
			const haystack = [
				value?.featureName,
				value?.parent,
				value?.parentFeature,
				value?.sourceFeature,
				value?.sourceDecisionKey,
				value?.grantKey,
				value?.type,
			].map(CharacterSheetProgression._normalize).join("|");
			return !sourceNeedle || haystack.includes(sourceNeedle);
		};
		// Pre-child-ledger saves have several durable evidence stores. Preserve
		// their order: exact feat/chosen-subfeature records precede compatibility
		// snapshots, while fulfilled markers prove only that an obligation
		// existed and must never invent a selection.
		const featChoices = entry?.feat?.choices || entry?.feat?._featChoices || choices.featChoices;
		if (featChoices && ["nestedSkill", "nestedSkillTool", "nestedExpertise", "nestedTool", "nestedLanguage", "nestedAbility", "nestedSave", "nestedWeapon", "nestedArmor", "nestedResistance", "nestedDamageType", "nestedSpell", "nestedCantrip"].includes(type)) {
			const key = type.replace(/^nested/, "").toLowerCase();
			const candidate = featChoices[key]
				|| featChoices[`${key}s`]
				|| featChoices[`${key}Choices`];
			if (candidate != null) return {selection: CharacterSheetProgression._copy(candidate), status: null};
		}
		const chosen = (entry?.chosenSubfeatures || choices.chosenSubfeatures || [])
			.filter(value => matchesSource(value) && value?.name);
		if (chosen.length) {
			if (chosen.length > 1 && Number(slot) > 0) {
				const ordered = [...chosen].sort((a, b) =>
					`${a.name}|${a.source || ""}`.localeCompare(`${b.name}|${b.source || ""}`),
				);
				return {selection: CharacterSheetProgression._copy(ordered[Number(slot)] || ordered[0]), status: null};
			}
			return {selection: CharacterSheetProgression._copy(chosen.length === 1 ? chosen[0] : chosen), status: null};
		}
		const materialized = (entry?.features || choices.features || [])
			.filter(value => matchesSource(value) && (value?.name || value?.sourceFeature));
		if (materialized.length === 1 && type.startsWith("nested")) {
			return {selection: CharacterSheetProgression._copy(materialized[0]), status: null};
		}
		const replay = (choices.replayData?.featureChoices || [])
			.filter(value => matchesSource(value));
		if (replay.length) {
			const selected = replay[Number(slot)] || replay[0];
			if (selected?.choice || selected?.name) return {selection: CharacterSheetProgression._copy(selected.choice || selected), status: null};
		}
		const legacy = CharacterSheetProgression._getLegacySelection({history, type, sourceKey, slot});
		if (legacy != null) return {selection: CharacterSheetProgression._copy(legacy), status: null};
		const fulfilled = [
			...(entry?.fulfilledFeatureSkillChoices || []),
			...(entry?.fulfilledFeatureToolChoices || []),
			...(entry?.fulfilledSpellChoiceSlots || []),
		].map(CharacterSheetProgression._normalize);
		if (sourceNeedle && fulfilled.some(value => value.includes(sourceNeedle))) {
			return {selection: null, status: "missing"};
		}
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
		for (const entry of normalizedHistory) {
			for (const decision of entry.decisions || []) {
				if (CharacterSheetProgression.getDecisionAdapter(decision.type)) continue;
				issues.push({
					level: entry.level,
					severity: decision.required === false ? "warning" : "error",
					code: "unsupported-persisted-decision",
					message: `This save contains an unsupported progression decision type "${decision.type || "unknown"}"; it was preserved and must be resolved by a newer editor.`,
					decisionId: decision.id,
					semanticKey: decision.semanticKey,
				});
			}
		}
		for (const decision of state?.getCharacterBase?.()?.decisions || []) {
			if (CharacterSheetProgression.getDecisionAdapter(decision.type)) continue;
			issues.push({
				level: 0,
				severity: decision.required === false ? "warning" : "error",
				code: "unsupported-persisted-decision",
				message: `This save contains an unsupported origin decision type "${decision.type || "unknown"}"; it was preserved and must be resolved by a newer editor.`,
				decisionId: decision.id,
				semanticKey: decision.semanticKey,
			});
		}
		issues.push(...CharacterSheetProgression.getAdapterClosureIssues({allowUnavailable: true}).map(issue => ({
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
		const artificerPlanCatalog = CharacterSheetArtificerPlans.parseCatalog({
			feature: CharacterSheetArtificerPlans.findFeature({classFeatures: page?.getClassFeatures?.() || []}),
			items: page?.getItems?.() || [],
		});

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
				preferFallback: config.preferFallback,
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
				receipt: storedPool.get(semanticKey)?.find(item => item.selection != null)?.receipt || null,
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
			const spellModel = CharacterSheetClassUtils.getClassSpellcastingModel({
				name: classData.name,
				source: classData.source,
				classData,
			});
			const isLegacyCumulativeSpellProgression = spellModel === "known"
				&& CharacterSheetProgression._isLegacyCumulativeSpellProgression({
					className: classData.name,
					classSource: classData.source,
					history: normalizedHistory,
					spellPool,
				});
			const isLegacyCumulativeSpellLevel = isLegacyCumulativeSpellProgression
				&& Number(levelInfo.classLevel) === Number(stateClass?.level);
			const progressionAdditionalClassNames = CharacterSheetClassUtils.getProgressionAdditionalSpellListClassNames({
				className: classData.name,
				classSource: classData.source,
				classLevel: levelInfo.classLevel,
				subclass,
				subclassChoice: stateClass?.subclassChoice,
			});
			const allSpellOptions = page?.getFilteredSpellData?.() || page?.getSpells?.() || [];
			const getLegalSpellOptions = (maxSpellLevel, {includeProgressionAdditionalLists = false} = {}) => allSpellOptions.filter(spell => {
				if (!Number.isFinite(Number(spell.level))) return false;
				if (maxSpellLevel === 0 ? Number(spell.level) !== 0 : (Number(spell.level) < 1 || Number(spell.level) > maxSpellLevel)) return false;
				return CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
					className: classData.name,
					classSource: classData.source,
					subclass,
					subclassChoice: stateClass?.subclassChoice,
					additionalClassNames: includeProgressionAdditionalLists ? progressionAdditionalClassNames : [],
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
				characterLevel: levelInfo.characterLevel - 1,
				featCatalog: featPool,
			});
			for (const priorDecision of decisions) {
				if (priorDecision.scope === "unplaced") continue;
				for (const selectedFeat of CharacterSheetProgression._getFeatDecisionSelections(priorDecision)) {
					const selectedUid = CharacterSheetProgression.getEntityUid(selectedFeat);
					if (historicalOwnedFeats.some(feat =>
						CharacterSheetProgression.getEntityUid(feat) === selectedUid,
					)) continue;
					const canonical = featPool.find(feat =>
						CharacterSheetProgression.getEntityUid(feat) === selectedUid,
					);
					historicalOwnedFeats.push({...CharacterSheetProgression._copy(canonical || {}), ...CharacterSheetProgression._copy(selectedFeat)});
				}
			}

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

			for (const opportunity of CharacterSheetArtificerPlans.getProgressionOpportunities({
				className: classData.name,
				classSource: classData.source,
				classLevel: levelInfo.classLevel,
			})) {
				const options = CharacterSheetArtificerPlans.getEligibleCandidates({
					catalog: artificerPlanCatalog,
					classLevel: levelInfo.classLevel,
					constraints: opportunity.constraints,
				});
				addDecision(levelInfo, {
					type: opportunity.kind === "replacement"
						? CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE
						: CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE,
					label: opportunity.kind === "replacement" ? "Replace a Magic Item Plan" : "Magic Item Plan",
					sourceKey: opportunity.opportunityId,
					slot: opportunity.slot,
					required: opportunity.required,
					count: 1,
					options,
					meta: {
						kind: opportunity.kind,
						opportunityId: opportunity.opportunityId,
						slotId: opportunity.slotId || null,
						owner: opportunity.owner,
						constraints: opportunity.constraints || {},
						catalogVersion: artificerPlanCatalog.version,
					},
				});
			}

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
				const legacyAsi = improvement.kind === "feat" ? historyEntry?.choices?.asi || null : null;
				const legacyEpicBoonRepair = CharacterSheetProgression._getLegacyEpicBoonRepair({
					improvement,
					legacyFeat,
					legacyAsi,
					state,
					featPool,
				});
				const eligibleFeats = CharacterSheetClassUtils.getEligibleFeats(featPool, state, {
					totalLevel: levelInfo.characterLevel,
					abilityScores: historicalAbilityScores,
					ownedFeats: historicalOwnedFeats,
					featCatalog: featPool,
				}).sort((a, b) => {
					const categoryDelta = Number(b.category === "EB") - Number(a.category === "EB");
					return categoryDelta || String(a.name || "").localeCompare(String(b.name || ""));
				});
				const legacyFeatUid = CharacterSheetProgression.getEntityUid(legacyFeat);
				const legacyFeatData = featPool.find(feat =>
					CharacterSheetProgression.getEntityUid(feat) === legacyFeatUid,
				);
				const conflictingDecision = legacyFeat?.name && !legacyFeatData?.repeatable
					? decisions.find(decision =>
						decision.scope !== "unplaced"
							&& CharacterSheetProgression._getFeatDecisionSelections(decision).some(selected =>
								CharacterSheetProgression.getEntityUid(selected) === legacyFeatUid,
							),
					)
					: null;
				const conflictMeta = conflictingDecision
					? {
						nonRepeatableFeatConflict: {
							feat: CharacterSheetProgression._copy(legacyFeat),
							ownerDecisionKey: conflictingDecision.semanticKey,
							ownerLabel: conflictingDecision.label,
						},
						validationMessage: `${legacyFeat.name} is already granted by ${conflictingDecision.label}; choose a different feat for this opportunity.`,
					}
					: {};

				if (improvement.kind === "asiAndFeat") {
					addDecision(levelInfo, {type: "asi", label: "Ability Score Improvement", sourceKey: "asi", count: 1});
					addDecision(levelInfo, {
						type: "feat",
						label: "Feat",
						sourceKey: "feat",
						count: 1,
						options: eligibleFeats,
						isValid: !conflictingDecision,
						meta: {improvement, ...conflictMeta},
					});
				} else if (improvement.kind === "feat") {
					const canAdoptLegacyBoon = legacyEpicBoonRepair
						&& eligibleFeats.some(feat =>
							CharacterSheetProgression.getEntityUid(feat) === CharacterSheetProgression.getEntityUid(legacyEpicBoonRepair.feat),
						);
					addDecision(levelInfo, {
						type: "feat",
						label: improvement.label,
						sourceKey: "epic-boon-or-feat",
						count: 1,
						options: eligibleFeats,
						fallbackSelection: canAdoptLegacyBoon
							? legacyEpicBoonRepair.feat
							: legacyAsi ? {mode: "asi", legacyAsi: CharacterSheetProgression._copy(legacyAsi)} : null,
						fallbackStatus: null,
						preferFallback: canAdoptLegacyBoon,
						meta: {
							improvement,
							legacyAsiInvalid: !!legacyAsi,
							...(canAdoptLegacyBoon ? {legacyEpicBoonRepair} : {}),
							...conflictMeta,
						},
						isValid: !conflictingDecision,
					});
				} else {
					addDecision(levelInfo, {
						type: "asiOrFeat",
						label: improvement.label,
						sourceKey: "asi-or-feat",
						count: 1,
						options: eligibleFeats,
						isValid: !conflictingDecision,
						meta: {improvement, ...conflictMeta},
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
			if (isLegacyCumulativeSpellLevel) {
				const currentCantrips = CharacterSheetClassUtils.getCantripsAtLevel(classData, classData.name, levelInfo.classLevel);
				if (currentCantrips > 0) {
					addDecision(levelInfo, {
						type: "cantrips",
						label: "Current Cantrip Repertoire",
						sourceKey: "legacy-cantrip-repertoire",
						count: currentCantrips,
						options: getLegalSpellOptions(0),
						fallbackSelection: (spellPool?.cantrips || []).map(spell => ({
							name: spell.name,
							source: spell.source,
							level: 0,
						})),
						fallbackStatus: "resolved",
						meta: {
							maxSpellLevel: 0,
							legacyCumulative: true,
						},
					});
				}
				const currentSpells = CharacterSheetClassUtils.getKnownSpellsAtLevel(classData, classData.name, levelInfo.classLevel);
				if (currentSpells > 0) {
					addDecision(levelInfo, {
						type: "knownSpells",
						label: "Current Spell Repertoire",
						sourceKey: "legacy-known-spell-repertoire",
						count: currentSpells,
						options: getLegalSpellOptions(
							CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel),
							{includeProgressionAdditionalLists: true},
						),
						fallbackSelection: (spellPool?.knownSpells || []).map(spell => ({
							name: spell.name,
							source: spell.source,
							level: spell.level,
						})),
						fallbackStatus: "resolved",
						meta: {
							maxSpellLevel: CharacterSheetClassUtils.getMaxSpellLevelFromProgression(classData.casterProgression, levelInfo.classLevel),
							legacyCumulative: true,
							additionalClassNames: progressionAdditionalClassNames,
						},
					});
				}
			} else if (isWizard) {
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
			if (!isLegacyCumulativeSpellProgression && cantripGain > 0) {
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

			if (!isLegacyCumulativeSpellProgression && !isWizard && spellModel === "known") {
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
			if (!isLegacyCumulativeSpellProgression && swapCount > 0) {
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

		CharacterSheetProgression._appendUnplacedFeatDecisions({
			base,
			decisions,
			page,
			state,
			storedBasePool: baseStoredPool,
		});

		const artificerPlanDecisions = decisions
			.filter(decision => [
				CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE,
				CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE,
			].includes(decision.type))
			.map(decision => ({
				...decision,
				kind: decision.meta?.kind,
				opportunityId: decision.meta?.opportunityId,
				slotId: decision.meta?.slotId,
				owner: decision.meta?.owner,
				constraints: decision.meta?.constraints || {},
			}));
		for (const decision of artificerPlanDecisions) {
			const plan = decision.type === CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE
				? decision.selection?.nextPlan
				: decision.selection;
			if (decision.selection != null && !CharacterSheetArtificerPlans.isExactSelection(plan)) {
				const original = decisions.find(it => it.id === decision.id);
				original.status = "ambiguous";
				decision.status = "ambiguous";
				original.meta = {
					...(original.meta || {}),
					validationMessage: "This legacy plan choice lacks an exact source-qualified catalog identity. Repair it in Respec.",
				};
			}
		}
		const planValidation = CharacterSheetArtificerPlans.validateDraft({
			catalog: artificerPlanCatalog,
			decisions: artificerPlanDecisions.filter(decision => decision.status !== "ambiguous"),
		});
		for (const issue of planValidation.issues) {
			const original = decisions.find(decision => decision.meta?.opportunityId === issue.opportunityId);
			if (original) {
				original.status = "invalid";
				original.meta = {...(original.meta || {}), validationMessage: issue.message};
			}
			issues.push({
				level: original?.characterLevel || 0,
				severity: "error",
				code: issue.code,
				message: issue.message,
				decisionId: original?.id,
				semanticKey: original?.semanticKey,
			});
		}
		const hasEfaPlanProgression = resolvedTimeline.some(entry =>
			CharacterSheetArtificerPlans.isExactOwner(entry) && Number(entry.classLevel) >= 2,
		);
		if (hasEfaPlanProgression) {
			for (const issue of artificerPlanCatalog.issues || []) {
				issues.push({
					level: 0,
					severity: "error",
					code: issue.code,
					message: issue.message,
				});
			}
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

	/**
	 * Persist the canonical linked decision graph at acquisition time. This is
	 * shared by Builder, Level Up, Quick Build, deferred Features, and the spell
	 * picker so supported new saves do not depend on later Respec inference.
	 */
	static syncCanonicalDecisions ({page, state} = {}) {
		if (!page || !state) return null;
		const manifest = CharacterSheetProgression.buildManifest({page, state});
		CharacterSheetProgression._stampAcquisitionReceipts(manifest, state);
		state.setProgressionManifest?.(manifest);
		return manifest;
	}

	static _stampAcquisitionReceipts (manifest, state) {
		const typeMap = {
			skills: "skills",
			tools: "tools",
			expertise: "expertise",
			languages: "languages",
			knownSpells: "spells",
			preparedSpells: "spells",
			spellbookSpells: "spells",
			cantrips: "cantrips",
			preparedCantrips: "cantrips",
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
		};
		const valuesOf = selection => selection == null ? [] : (Array.isArray(selection) ? selection : [selection]);
		const effectsFor = decision => {
			const effects = [];
			const values = valuesOf(decision.selection);
			const ownershipType = typeMap[decision.type];
			if (["nestedAbility", "nestedConfiguration"].includes(decision.type) && values.length) {
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
			if (ownershipType && values.length) {
				effects.push({
					type: "ownership",
					ownership: values.map(value => {
						if (decision.type !== "nestedSkillTool" || !value || typeof value !== "object") {
							return {type: ownershipType, value};
						}
						const kind = String(value.kind || "").toLowerCase();
						return {
							type: kind === "tool" ? "tools" : kind === "language" ? "languages" : "skills",
							value: value.value ?? value.name ?? value,
						};
					}),
				});
			}
			const featureIds = new Set((state.getFeatures?.() || [])
				.filter(feature => feature.sourceDecisionKey === decision.semanticKey)
				.map(feature => feature.id));
			const features = (state.getFeatures?.() || [])
				.filter(feature => featureIds.has(feature.id))
				.map(feature => ({id: feature.id, name: feature.name, source: feature.source}));
			const feats = (state._data?.feats || [])
				.filter(feat => feat.sourceDecisionKey === decision.semanticKey)
				.map(feat => ({id: feat.id, name: feat.name, source: feat.source}));
			const featIds = new Set(feats.map(feat => feat.id));
			const modifiers = [
				...(state._data?.modifiers || []),
				...(state._data?.namedModifiers || []),
			]
				.filter(modifier =>
					featureIds.has(modifier.featureId)
						|| featIds.has(modifier.featureId)
						|| featIds.has(modifier.sourceFeatureId)
						|| modifier.sourceDecisionKey === decision.semanticKey,
				)
				.map(modifier => ({
					id: modifier.id,
					featureId: modifier.featureId,
					sourceFeatureId: modifier.sourceFeatureId,
					sourceDecisionKey: modifier.sourceDecisionKey,
				}));
			const resources = (state.getResources?.() || [])
				.filter(resource =>
					resource.sourceDecisionKey === decision.semanticKey
						|| featureIds.has(resource.featureId)
						|| featIds.has(resource.featId),
				)
				.map(resource => ({
					id: resource.id,
					name: resource.name,
					sourceDecisionKey: resource.sourceDecisionKey,
					featureId: resource.featureId,
					featId: resource.featId,
				}));
			if (features.length || feats.length || modifiers.length || resources.length) {
				effects.push({type: "materialized", features, feats, resources, modifiers});
			}
			if (["nestedSpell", "nestedCantrip", "knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips"].includes(decision.type) && values.length) {
				effects.push({
					type: "spells",
					spellType: ["nestedCantrip", "cantrips", "preparedCantrips"].includes(decision.type) ? "cantrips" : "spells",
					spells: values
						.filter(value => value && typeof value === "object" && value.name)
						.map(value => ({name: value.name, source: value.source})),
				});
			}
			return effects;
		};
		for (const decision of manifest.decisions || []) {
			if (decision.selection == null || decision.receipt) continue;
			if ([
				CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE,
				CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE,
			].includes(decision.type)) {
				decision.receipt = CharacterSheetArtificerPlans.getDecisionReceipt({
					...decision,
					kind: decision.meta?.kind,
					opportunityId: decision.meta?.opportunityId,
					slotId: decision.meta?.slotId,
					owner: decision.meta?.owner,
				});
				continue;
			}
			decision.receipt = {
				version: 1,
				sourceDecisionKey: decision.semanticKey,
				effects: effectsFor(decision),
			};
		}
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
			const priorByKey = new Map((entry.decisions || []).map(decision => [decision.semanticKey, decision]));
			const generatedDecisions = (level.decisions || []).map(decision => {
				const prior = priorByKey.get(decision.semanticKey);
				// Legal catalogs are transient, but selections, statuses,
				// provenance, and especially compact receipts are durable. Merge
				// those fields from the existing ledger instead of replacing them
				// with the discovery projection's null receipt.
				return CharacterSheetProgression.normalizeDecision({
					...decision,
					options: [],
					selection: prior?.selection ?? decision.selection,
					status: prior?.status ?? decision.status,
					meta: {...(decision.meta || {}), ...(prior?.meta || {})},
					provenance: prior?.provenance || decision.provenance,
					receipt: prior?.receipt || decision.receipt || null,
				}, entry);
			});
			const generatedKeys = new Set(generatedDecisions.map(decision => decision.semanticKey));
			const preservedUnknown = (entry.decisions || [])
				.filter(decision => !CharacterSheetProgression.getDecisionAdapter(decision.type))
				.filter(decision => !generatedKeys.has(decision.semanticKey))
				.map(decision => CharacterSheetProgression.normalizeDecision(decision, entry));
			entry.decisions = [...generatedDecisions, ...preservedUnknown];
			entry.complete = !entry.decisions.some(decision => decision.required && decision.status !== "resolved");
		}
		return entries.sort((a, b) => a.level - b.level);
	}

	static reconcileCharacterBaseWithManifest ({base, characterBase}) {
		const out = CharacterSheetProgression._copy(characterBase || {});
		out.v = Number(out.v) || 1;
		const priorByKey = new Map((out.decisions || []).map(decision => [decision.semanticKey, decision]));
		const generatedDecisions = (base?.decisions || []).map(decision => {
			const prior = priorByKey.get(decision.semanticKey);
			return CharacterSheetProgression.normalizeDecision({
				...decision,
				options: [],
				scope: decision.scope || prior?.scope || "origin",
				selection: prior?.selection ?? decision.selection,
				status: prior?.status ?? decision.status,
				meta: decision.meta?.unplacedFeat
					? {...(prior?.meta || {}), ...(decision.meta || {})}
					: {...(decision.meta || {}), ...(prior?.meta || {})},
				provenance: prior?.provenance || decision.provenance,
				receipt: prior?.receipt || decision.receipt || null,
			});
		});
		const generatedKeys = new Set(generatedDecisions.map(decision => decision.semanticKey));
		const preservedUnknown = (out.decisions || [])
			.filter(decision => !CharacterSheetProgression.getDecisionAdapter(decision.type))
			.filter(decision => !generatedKeys.has(decision.semanticKey))
			.map(decision => CharacterSheetProgression.normalizeDecision({...decision, scope: "origin"}));
		out.decisions = [...generatedDecisions, ...preservedUnknown];
		out.ledgerVersion = CharacterSheetProgression.LEDGER_VERSION;
		out.manifestVersion = CharacterSheetProgression.MANIFEST_VERSION;
		out.complete = !out.decisions.some(decision => decision.required && decision.status !== "resolved");
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
			if (decision?.type === CharacterSheetArtificerPlans.DECISION_TYPE_REPLACE) {
				return `${selection.previousPlan?.name || "Unknown plan"} → ${selection.nextPlan?.name || "Unknown plan"}`;
			}
			if (decision?.type === CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE) {
				return `${selection.name || "Unknown plan"}${selection.source ? ` (${selection.source})` : ""}`;
			}
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
