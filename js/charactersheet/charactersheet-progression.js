import {CharacterSheetClassUtils} from "./charactersheet-class-utils.js";

/**
 * Shared progression analysis and history-ledger helpers.
 *
 * This module is intentionally controller-free. Builder, Level Up, Quick Build,
 * and Respec can all ask the same questions about a chronological class timeline
 * without duplicating the rules which create decision opportunities.
 */
class CharacterSheetProgression {
	static LEDGER_VERSION = 2;
	static MANIFEST_VERSION = 1;

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
	});

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
	}) {
		if (!CharacterSheetProgression.getDecisionAdapter(type)) {
			throw new Error(`No progression decision adapter is registered for "${type}".`);
		}
		const semanticKey = CharacterSheetProgression.getSemanticKey({
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
			normalized.decisions = CharacterSheetProgression.projectLegacyChoices(normalized);
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
		const historyByLevel = new Map(normalizedHistory.map(entry => [Number(entry.level), entry]));
		const stateClasses = state?.getClasses?.() || [];
		const decisions = [];
		const levels = [];
		const issues = [];
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
					count: spellbookCount,
					options: getLegalSpellOptions(maxSpellLevel),
					fallbackSelection: fallback,
					fallbackStatus: "resolved",
					meta: {maxSpellLevel},
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
					count: cantripGain,
					options: getLegalSpellOptions(0),
					fallbackSelection: fallback,
					fallbackStatus: "resolved",
					meta: {maxSpellLevel: 0},
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
						count,
						options: getLegalSpellOptions(maxSpellLevel),
						fallbackSelection: fallback,
						fallbackStatus: "resolved",
						meta: {maxSpellLevel},
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
						count,
						options: getLegalSpellOptions(maxSpellLevel),
						fallbackSelection: fallback,
						fallbackStatus: "resolved",
						meta: {maxSpellLevel},
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
