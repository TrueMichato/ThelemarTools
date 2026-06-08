// Project globals — typed via globalThis cast for TypeScript checkJs
const {Parser, Renderer, MiscUtil, UrlUtil} = /** @type {*} */ (globalThis);

/**
 * Character Sheet Class Utilities
 * Shared static helpers used by both LevelUp and QuickBuild modules.
 * Single source of truth for class data parsing, spell metadata, feature analysis,
 * combat traditions, and state mutation helpers.
 */
class CharacterSheetClassUtils {
	// ==========================================
	// Pure Utility Methods
	// ==========================================

	/**
	 * Check if a source uses 2024 (D&D One) edition rules.
	 * TGTT homebrew classes replace XPHB and follow the same 2024 mechanics.
	 * @param {string} source - The source abbreviation (e.g. "XPHB", "TGTT", "PHB")
	 * @returns {boolean}
	 */
	static is2024Source (/** @type {*} */ source) {
		return source === "XPHB" || source === "TGTT";
	}

	/**
	 * Check whether a source belongs to a priority bundle.
	 * A source matches if it equals a priority entry exactly, or if it is a
	 * sub-source of one (e.g. "TGTT-IllR" is a sub-source of priority "TGTT").
	 * The "-" delimiter is required so unrelated sources sharing a prefix
	 * (e.g. "TGTTX") do not falsely match.
	 * @param {string} source - Entity source string
	 * @param {Array<string>} prioritySources - Configured priority source list
	 * @returns {boolean}
	 */
	static isSourceInPriority (/** @type {*} */ source, /** @type {*} */ prioritySources) {
		if (!source || !prioritySources?.length) return false;
		return prioritySources.some(ps => source === ps || source.startsWith(`${ps}-`));
	}

	/**
	 * Check if a class level grants an Ability Score Improvement.
	 * @param {*} classData - The class data object
	 * @param {number} level - The class level
	 * @returns {boolean}
	 */
	static levelGrantsAsi (/** @type {*} */ classData, /** @type {*} */ level) {
		const standardAsiLevels = [4, 8, 12, 16, 19];
		if (/** @type {*} */ classData.name === "Fighter") {
			return [...standardAsiLevels, 6, 14].includes(level);
		}
		if (/** @type {*} */ classData.name === "Rogue") {
			return [...standardAsiLevels, 10].includes(level);
		}
		return standardAsiLevels.includes(level);
	}

	// ==========================================
	// Overview Display: Speed & Senses
	// ==========================================

	/**
	 * Display metadata for each movement type. `word` is the human label used for
	 * titles / aria; `wordPrefix` reproduces the exact prefix used by
	 * `CharacterSheetState.getSpeed()` in the legacy word display (walk has none).
	 * @type {Record<string, {emoji: string, word: string, wordPrefix: string}>}
	 */
	static SPEED_DISPLAY_META = {
		walk: {emoji: "🚶", word: "Walk", wordPrefix: ""},
		fly: {emoji: "🦅", word: "Fly", wordPrefix: "fly "},
		climb: {emoji: "🧗", word: "Climb", wordPrefix: "climb "},
		swim: {emoji: "🏊", word: "Swim", wordPrefix: "swim "},
		burrow: {emoji: "⛏️", word: "Burrow", wordPrefix: "burrow "},
	};

	/**
	 * Parse a formatted speed string (as produced by `getSpeed()` with no
	 * argument) into structured segments. The first comma-separated segment is
	 * the walk speed (no label); subsequent segments are prefixed with a movement
	 * type word ("fly "/"swim "/"climb "/"burrow "). Any trailing annotation on a
	 * segment (e.g. exhaustion " (-5)" / " (halved)") is preserved as part of the
	 * value so the display round-trips losslessly.
	 * @param {string} speedStr - e.g. "40 ft., fly 60 ft., swim 30 ft."
	 * @returns {Array<{type: string, value: string}>}
	 */
	static parseSpeedString (/** @type {*} */ speedStr) {
		const raw = (speedStr == null ? "" : String(speedStr)).trim();
		if (!raw) return [];
		const prefixed = Object.entries(CharacterSheetClassUtils.SPEED_DISPLAY_META)
			.filter(([type]) => type !== "walk");
		return raw.split(",").map((segRaw, ix) => {
			const seg = segRaw.trim();
			if (ix > 0) {
				for (const [type, meta] of prefixed) {
					if (seg.toLowerCase().startsWith(meta.wordPrefix)) {
						return {type, value: seg.slice(meta.wordPrefix.length).trim()};
					}
				}
			}
			// First segment, or an unrecognised prefix, is treated as walk.
			return {type: "walk", value: seg};
		});
	}

	/**
	 * Build display-ready speed segments from a formatted speed string. In word
	 * mode the rejoined `text` values reproduce the original input exactly so the
	 * setting-off path is a faithful fallback; in emoji mode the label is swapped
	 * for an icon while the `word`/`title` keep the type discoverable for a11y.
	 * @param {string} speedStr
	 * @param {{useEmoji?: boolean}} [opts]
	 * @returns {Array<{type: string, value: string, emoji: string, word: string, label: string, title: string, text: string}>}
	 */
	static buildSpeedDisplayParts (/** @type {*} */ speedStr, /** @type {*} */ opts = {}) {
		const useEmoji = !!opts.useEmoji;
		return CharacterSheetClassUtils.parseSpeedString(speedStr).map((part) => {
			const meta = CharacterSheetClassUtils.SPEED_DISPLAY_META[part.type]
				|| {emoji: "•", word: CharacterSheetClassUtils._humanizeKey(part.type), wordPrefix: `${part.type} `};
			const label = useEmoji ? meta.emoji : meta.word;
			const title = `${meta.word} speed`;
			const text = useEmoji ? `${meta.emoji} ${part.value}` : `${meta.wordPrefix}${part.value}`;
			return {type: part.type, value: part.value, emoji: meta.emoji, word: meta.word, label, title, text};
		});
	}

	/**
	 * Display metadata for known sense types. Generic/unknown keys fall back to a
	 * humanised label and a neutral icon so future senses surface automatically.
	 * @type {Record<string, {emoji: string, label: string}>}
	 */
	static SENSE_DISPLAY_META = {
		darkvision: {emoji: "🌙", label: "Darkvision"},
		blindsight: {emoji: "👁️", label: "Blindsight"},
		tremorsense: {emoji: "〰️", label: "Tremorsense"},
		truesight: {emoji: "🔮", label: "Truesight"},
	};

	/** Canonical render order for known senses. */
	static SENSE_DISPLAY_ORDER = ["darkvision", "blindsight", "tremorsense", "truesight"];

	/**
	 * Humanise a snake/camel-ish key into a Title Case label (fallback for
	 * unknown sense/speed keys).
	 * @param {string} key
	 * @returns {string}
	 */
	static _humanizeKey (/** @type {*} */ key) {
		const str = (key == null ? "" : String(key))
			.replace(/([a-z])([A-Z])/g, "$1 $2")
			.replace(/[_-]+/g, " ")
			.trim();
		if (!str) return "";
		return str.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	/**
	 * Build display-ready sense rows from the object returned by
	 * `CharacterSheetState.getSenses()`. Only senses with a positive finite range
	 * are included. Known senses render in canonical order first, then any unknown
	 * positive keys sorted alphabetically with a humanised label. Passive
	 * Perception is intentionally NOT included here — passive scores live with the
	 * other passive scores.
	 * @param {Record<string, number>} sensesObj
	 * @returns {Array<{type: string, range: number, emoji: string, label: string, title: string, text: string}>}
	 */
	static buildSensesDisplay (/** @type {*} */ sensesObj) {
		const senses = sensesObj && typeof sensesObj === "object" ? sensesObj : {};
		const known = CharacterSheetClassUtils.SENSE_DISPLAY_ORDER;
		const knownSet = new Set(known);
		const extraKeys = Object.keys(senses)
			.filter((k) => !knownSet.has(k))
			.sort((a, b) => a.localeCompare(b));
		const orderedKeys = [...known, ...extraKeys];

		const out = [];
		for (const type of orderedKeys) {
			const range = Number(senses[type]);
			if (!Number.isFinite(range) || range <= 0) continue;
			const meta = CharacterSheetClassUtils.SENSE_DISPLAY_META[type]
				|| {emoji: "👁️", label: CharacterSheetClassUtils._humanizeKey(type)};
			const text = `${meta.label} ${range} ft.`;
			out.push({type, range, emoji: meta.emoji, label: meta.label, title: text, text});
		}
		return out;
	}

	/**
	 * Check if a class level grants a subclass feature (data-driven).
	 * @param {*} classData - The class data with classFeatures
	 * @param {number} level - The class level
	 * @returns {boolean}
	 */
	static levelGrantsSubclass (/** @type {*} */ classData, /** @type {*} */ level) {
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			const levelFeatures = isArrayOfArrays
				? classData.classFeatures[level - 1] || []
				: classData.classFeatures.filter((/** @type {*} */ f) => {
					if (/** @type {*} */ typeof f === "string") {
						const parts = f.split("|");
						return parseInt(parts[3]) === level;
					}
					if (/** @type {*} */ typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parseInt(parts[3]) === level;
					}
					return f.level === level;
				});

			return levelFeatures.some((/** @type {*} */ f) =>
				typeof f === "object" && f.gainSubclassFeature,
			);
		}

		// Fallback: default subclass level 3
		return level === 3;
	}

	/**
	 * Get the level at which a class gains its subclass (data-driven).
	 * @param {*} classData - The class data with classFeatures
	 * @returns {number} The subclass level (default: 3)
	 */
	static getSubclassLevel (/** @type {*} */ classData) {
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			if (/** @type {*} */ isArrayOfArrays) {
				for (/** @type {*} */ let lvl = 1; lvl <= 20; lvl++) {
					const features = classData.classFeatures[lvl - 1] || [];
					if (features.some((/** @type {*} */ f) => typeof f === "object" && f.gainSubclassFeature)) return lvl;
				}
			} else {
				for (/** @type {*} */ const f of classData.classFeatures) {
					if (/** @type {*} */ typeof f === "object" && f.gainSubclassFeature) {
						const parts = f.classFeature.split("|");
						const lvl = parseInt(parts[3]);
						if (!isNaN(lvl)) return lvl;
					}
				}
			}
		}
		return 3;
	}

	/**
	 * Deduplicate optional features by source priority. When the same feature exists in multiple
	 * sources, keeps only the highest-priority version (TGTT > XPHB > PHB > others alphabetical).
	 * @param {Array<*>} optFeatures - All optional features
	 * @param {object} [opts] - Options
	 * @param {object} opts
	 * @param {boolean} [opts.showAll=false] - If true, skip deduplication and return all features
	 * @returns {Array<*>} Deduplicated optional features
	 */
	static deduplicateOptFeaturesByEdition (/** @type {*} */ optFeatures, /** @type {*} */ opts = {}) {
		const {showAll = false} = opts;
		if (!optFeatures?.length) return optFeatures;
		if (showAll) return optFeatures;

		// Source priority: lower = higher priority
		const SOURCE_PRIORITY = {"TGTT": 0, "XPHB": 1, "PHB": 2};

		const getSourcePriority = (/** @type {*} */ source) => {
			if (source in SOURCE_PRIORITY) return (/** @type {*} */ (SOURCE_PRIORITY))[source];
			return 100; // Other sources get equal low priority (kept if no higher-priority dupe)
		};

		// Group by lowercase name
		const groups = new Map();
		for (/** @type {*} */ const opt of optFeatures) {
			const key = opt.name.toLowerCase();
			if (!groups.has(key)) {
				groups.set(key, []);
			}
			groups.get(key).push(opt);
		}

		// For each group, pick the one with highest priority (lowest number)
		const result = [];
		for (const group of groups.values()) {
			if (/** @type {*} */ group.length === 1) {
				result.push(group[0]);
			} else {
				group.sort((/** @type {*} */ a, /** @type {*} */ b) => {
					const prioA = getSourcePriority(a.source);
					const prioB = getSourcePriority(b.source);
					if (prioA !== prioB) return prioA - prioB;
					return (a.source || "").localeCompare(b.source || "");
				});
				result.push(group[0]);
			}
		}

		return result;
	}

	/**
	 * @deprecated Use deduplicateOptFeaturesByEdition instead
	 */
	static filterOptFeaturesByEdition (/** @type {*} */ optFeatures, /** @type {*} */ classSource) {
		return CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(optFeatures);
	}

	/**
	 * Collapse same-named class variants (e.g. XPHB Druid vs TGTT Druid) down to a single
	 * preferred entry so pickers (multiclass, random, …) don't list visually-identical rows
	 * that differ only by source. The preferred variant is chosen so that homebrew/edition
	 * classes a character already uses are honoured, and TGTT is preferred when enabled.
	 *
	 * Preference order (lower wins):
	 *   0. Source already used by one of the character's existing classes
	 *   1. TGTT (only when `enableTgtt`)
	 *   2. XPHB
	 *   3. PHB
	 *   4. Any other source (alphabetical tie-break)
	 *
	 * @param {Array<*>} classes - Candidate class entities (ideally already source-filtered).
	 * @param {object} [opts]
	 * @param {Array<*>} [opts.existingClasses=[]] - Classes the character already has (objects with `source`).
	 * @param {boolean} [opts.enableTgtt=false] - Whether the TGTT global setting is on.
	 * @returns {Array<*>} One class per name, preferred-source resolved, original order preserved.
	 */
	static dedupeClassesBySourcePreference (/** @type {*} */ classes, /** @type {*} */ {existingClasses = [], enableTgtt = false} = {}) {
		if (!classes?.length) return classes;

		const existingSources = new Set(
			(existingClasses || [])
				.map((/** @type {*} */ c) => (c?.source || "").toUpperCase())
				.filter(Boolean),
		);

		const getPriority = (/** @type {*} */ source) => {
			const src = (source || "").toUpperCase();
			if (existingSources.has(src)) return 0;
			if (enableTgtt && src === "TGTT") return 1;
			if (src === "XPHB") return 2;
			if (src === "PHB") return 3;
			return 4;
		};

		// Group by lowercase name, preserving first-seen order for stable output.
		/** @type {Map<string, *[]>} */ const groups = new Map();
		const order = [];
		for (/** @type {*} */ const cls of classes) {
			const key = (cls?.name || "").toLowerCase();
			if (!groups.has(key)) {
				groups.set(key, []);
				order.push(key);
			}
			groups.get(key).push(cls);
		}

		const result = [];
		for (const key of order) {
			const group = groups.get(key);
			if (group.length === 1) {
				result.push(group[0]);
				continue;
			}
			group.sort((/** @type {*} */ a, /** @type {*} */ b) => {
				const prioA = getPriority(a.source);
				const prioB = getPriority(b.source);
				if (prioA !== prioB) return prioA - prioB;
				return (a.source || "").localeCompare(b.source || "");
			});
			result.push(group[0]);
		}

		return result;
	}

	/**
	 * The Druid "Magician" Primal Order option grants one extra cantrip from the Druid
	 * spell list. Detect whether Magician is among a flat list of selected feature options
	 * so build-time pickers can offer that extra cantrip pick at creation/level-up time.
	 * (The ongoing spells-tab budget is handled centrally by the state's spellcasting info.)
	 * @param {Array<*>} selectedFeatureOptions - Flat list of chosen feature-option objects (each may have `.name`).
	 * @returns {number} Number of bonus cantrips granted (0 or 1).
	 */
	static getMagicianBonusCantripCount (/** @type {*} */ selectedFeatureOptions) {
		if (!selectedFeatureOptions?.length) return 0;
		return selectedFeatureOptions.some((/** @type {*} */ o) => (o?.name || "").toLowerCase() === "magician") ? 1 : 0;
	}
	/**
	 * When TGTT mode is enabled OR the active class source is TGTT, restrict Metamagic (`MM`)
	 * optional features to TGTT-source entries so PHB-only metamagics (Distant, Empowered,
	 * Subtle, Twinned, …) don't leak into pickers that share the `MM` featureType code with
	 * the TGTT passive/active system. Other featureType codes are returned untouched.
	 *
	 * The class-source gate ensures TGTT Sorcerer pickers correctly hide XPHB metamagics
	 * even when the global TGTT settings flag is off, since a TGTT class is itself an
	 * explicit opt-in to the TGTT metamagic list (Bug 6).
	 * @param {Array<*>} optFeatures - Optional features (typically post-deduplication)
	 * @param {object} [opts]
	 * @param {boolean} [opts.enableTgtt=false] - Whether the TGTT global setting is on
	 * @param {string|null} [opts.classSource=null] - Source of the class currently driving this picker (if any). When equal to "TGTT" (case-insensitive), the filter applies regardless of the global flag.
	 * @returns {Array<*>} Filtered optional features
	 */
	static filterOptFeaturesForTgttMetamagic (/** @type {*} */ optFeatures, /** @type {*} */ {enableTgtt = false, classSource = null} = {}) {
		if (!optFeatures?.length) return optFeatures;
		const classSourceIsTgtt = !!classSource && String(classSource).toUpperCase() === "TGTT";
		if (!enableTgtt && !classSourceIsTgtt) return optFeatures;
		return optFeatures.filter((/** @type {*} */ opt) => {
			const isMetamagic = opt?.featureType?.some?.((/** @type {*} */ ft) => ft === "MM");
			if (!isMetamagic) return true;
			return (opt.source || "").toUpperCase() === "TGTT";
		});
	}

	/**
	 * Resolve the final d20 roll mode by combining state-based advantage/disadvantage
	 * with event-key modifiers (shift = advantage, ctrl/meta = disadvantage). Per RAW,
	 * advantage + disadvantage cancel to a normal roll regardless of source — so a
	 * passive Wis-save advantage (e.g. Nyuidj Dual Mind) plus a user-pressed Ctrl key
	 * resolves to a single d20, not disadvantage.
	 * @param {object} [opts]
	 * @param {boolean} [opts.stateAdvantage=false] - Advantage from passive sources (Bless, Nyuidj, Faerie Fire, …)
	 * @param {boolean} [opts.stateDisadvantage=false] - Disadvantage from passive sources (Frightened, Poisoned, …)
	 * @param {Event|null} [opts.event=null] - Triggering event; shiftKey adds adv, ctrlKey/metaKey adds disadv
	 * @returns {"advantage"|"disadvantage"|"normal"}
	 */
	static resolveD20Mode ({stateAdvantage = false, stateDisadvantage = false, event = null} = {}) {
		const evt = /** @type {*} */ (event);
		const eventAdv = !!(evt && evt.shiftKey);
		const eventDis = !!(evt && (evt.ctrlKey || evt.metaKey));
		const adv = !!stateAdvantage || eventAdv;
		const dis = !!stateDisadvantage || eventDis;
		if (adv && dis) return "normal";
		if (adv) return "advantage";
		if (dis) return "disadvantage";
		return "normal";
	}

	// ========================================================================
	// Class/Subclass feature hover-link source resolution
	// ========================================================================
	/**
	 * Sources considered "official" for purposes of class/subclass feature hover lookups.
	 * NOTE: this list is intentionally small — it must NOT be used as a fallback for the
	 * class source of a subclass feature, because subclass sources (TCE, XGE, …) are also
	 * in this list and would mask the true class source (e.g. PHB for Bladesinging Wizard).
	 */
	static _HOVER_OFFICIAL_SOURCES = Object.freeze(new Set([
		"PHB", "XPHB", "DMG", "XDMG", "MM", "XMM",
		"TCE", "XGE", "MPMM", "FTD", "SCC", "GGR", "AI", "EGW", "MOT", "VGM", "MTF",
	]));

	static _isHoverOfficialSource (/** @type {*} */ src) {
		if (!src) return false;
		return CharacterSheetClassUtils._HOVER_OFFICIAL_SOURCES.has(String(src).toUpperCase());
	}

	/**
	 * Resolve the (classSource, featureSource) pair to use when building a class/subclass
	 * feature hover-link hash.
	 *
	 * For SUBCLASS features the canonical hash format is
	 *   `name_classname_classsource_subclassshortname_subclasssource_level_featuresource`
	 * (see `data/class/class-wizard.json` + `search/index.json`). The class source is the
	 * class's own source (e.g. "PHB" for Wizard), NOT the subclass source (e.g. "TCE" for
	 * Bladesinging). Older saves may have `feature.classSource` undefined and
	 * `feature.source` set to the subclass source — in that case we MUST fall back to
	 * `storedClass.source`, never `feature.source`, or the hash points at a non-existent
	 * `wizard_tce` class and the hover errors out.
	 *
	 * For non-subclass (class) features the existing behaviour is preserved: prefer the
	 * stored classSource, otherwise prefer an official `feature.source`, otherwise fall
	 * back to the stored class's source.
	 *
	 * @param {*} feature - The stored feature object
	 * @param {*} [storedClass] - The matching entry from `state.getClasses()`, if any
	 * @returns {{classSource: string, featureSource: string}}
	 */
	static resolveFeatureHoverSources (/** @type {*} */ feature, /** @type {*} */ storedClass) {
		const featureSource = feature?.source;
		const isSubclassFeature = !!(feature?.subclassName || feature?.subclassShortName || feature?.isSubclassFeature);
		const isOfficial = CharacterSheetClassUtils._isHoverOfficialSource;

		let classSource = feature?.classSource;

		if (!classSource) {
			if (isSubclassFeature) {
				// feature.source is the SUBCLASS source for subclass features — never use it
				// as the class source. The class source must come from the stored class.
				classSource = storedClass?.source || null;
			} else if (isOfficial(featureSource)) {
				classSource = featureSource;
			} else {
				classSource = storedClass?.source || null;
			}
		} else if (!isSubclassFeature && !isOfficial(classSource) && isOfficial(featureSource)) {
			// Homebrew class storing an official feature (e.g. TGTT Warlock referencing an
			// XPHB feature): prefer the official source for the hover lookup.
			classSource = featureSource;
		}

		classSource = classSource || storedClass?.source || Parser.SRC_XPHB;
		return {classSource, featureSource};
	}

	/**
	 * Like {@link resolveFeatureHoverSources}, but when the resolved classSource is
	 * still a non-official (homebrew) source, also searches loaded feature data for
	 * the canonical match. This handles two scenarios:
	 *  - Class features: TGTT Warlock referencing an XPHB feature (already handled by
	 *    the call-site code at charactersheet.js:6793 and charactersheet-features.js:1178).
	 *  - Subclass features: TGTT Wizard with a Chronurgy (EGW) subclass — refSubclassFeature
	 *    `Chronal Shift|Wizard||Chronurgy|EGW|2` produces parts[2]="" → classSource
	 *    defaults to TGTT, but the canonical feature lives at classSource=PHB. The
	 *    Phase-4 class-feature fallback didn't search subclassFeatures, so the
	 *    bad hash leaked through (Bug 12 / Phase 5.5a).
	 *
	 * @param {*} feature - The stored feature object
	 * @param {*} storedClass - The matching entry from state.getClasses(), if any
	 * @param {{classFeatures?: Array, subclassFeatures?: Array}} [loadedFeatures]
	 * @returns {{classSource: string, featureSource: string, subclassSource: string|null}}
	 */
	static resolveCanonicalFeatureHoverSources (/** @type {*} */ feature, /** @type {*} */ storedClass, /** @type {*} */ loadedFeatures = {}) {
		let {classSource, featureSource} = CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedClass);
		let subclassSource = null;

		const isOfficial = CharacterSheetClassUtils._isHoverOfficialSource;
		const isSubclassFeature = !!(feature?.subclassName || feature?.subclassShortName || feature?.isSubclassFeature);
		const level = feature?.level || 1;

		if (isOfficial(classSource)) return {classSource, featureSource, subclassSource};

		// Non-official class source — try to find a canonical match in loaded data.
		try {
			if (isSubclassFeature && loadedFeatures.subclassFeatures?.length) {
				const subclassShortName = feature.subclassShortName || feature.subclassName;
				const officialMatch = loadedFeatures.subclassFeatures.find(f =>
					f.name === feature.name
					&& f.className === feature.className
					&& (f.subclassShortName === subclassShortName || f.subclassShortName?.toLowerCase() === subclassShortName?.toLowerCase())
					&& f.level === level
					&& isOfficial(f.classSource),
				);
				if (officialMatch) {
					classSource = officialMatch.classSource;
					featureSource = officialMatch.source || featureSource;
					subclassSource = officialMatch.subclassSource || subclassSource;
				}
			} else if (!isSubclassFeature && loadedFeatures.classFeatures?.length) {
				const officialMatch = loadedFeatures.classFeatures.find(f =>
					f.name === feature.name
					&& f.className === feature.className
					&& f.level === level
					&& isOfficial(f.source),
				);
				if (officialMatch) {
					classSource = officialMatch.classSource || officialMatch.source;
					featureSource = officialMatch.source;
				}
			}
		} catch (e) { /* fall through to the non-canonical result */ }

		return {classSource, featureSource, subclassSource};
	}

	/**
	 * Find a stored class/subclass feature in the loaded data pool that matches
	 * `feature` (by name + class + level, plus subclass short-name for subclass
	 * features). Used to decide whether a canonical `classfeatures.html` hover hash
	 * will actually resolve.
	 *
	 * Feature-options (inline picks like TGTT Specialties) and homebrew features
	 * that aren't present in the pool return `undefined` — signalling that a local
	 * inline hover (built from the feature's own stored entries) should be used
	 * instead of a hash that would 404 ("Failed to load renderable content").
	 *
	 * @param {*} feature - The stored character feature.
	 * @param {{classFeatures?: Array<*>, subclassFeatures?: Array<*>}} [pool] - Loaded data pools.
	 * @returns {*} The matching loaded feature, or undefined.
	 */
	static findLoadedFeatureEntity (/** @type {*} */ feature, /** @type {*} */ pool = {}) {
		if (!feature?.name || !feature?.className) return undefined;
		const nm = feature.name.toLowerCase();
		const cn = feature.className.toLowerCase();
		const lvl = Number(feature.level) || 1;
		const src = (feature.source || "").toLowerCase();
		const isSubclassFeature = !!(feature.subclassName || feature.subclassShortName || feature.isSubclassFeature);
		// Feature-options (inline picks like TGTT Specialties) are stored with the
		// LEVEL THEY WERE PICKED AT, not the canonical level the entry is defined at
		// (e.g. Build Shelter is a level-1 classFeature but picked at level 4). For
		// those we allow a level-agnostic fallback so the canonical hover still
		// resolves; ordinary features keep strict level matching so a genuinely wrong
		// level (e.g. Extra Attack stored at level 11) is treated as not-found.
		const isFeatureOption = !!(feature.isFeatureOption || feature.parentFeature);

		if (isSubclassFeature) {
			const ssn = (feature.subclassShortName || feature.subclassName || "").toLowerCase();
			const subFeats = pool.subclassFeatures || [];
			const nameClassSub = (/** @type {*} */ f) =>
				(f.name || "").toLowerCase() === nm
				&& (f.className || "").toLowerCase() === cn
				&& (f.subclassShortName || "").toLowerCase() === ssn;
			const exact = subFeats.find((/** @type {*} */ f) => nameClassSub(f) && (Number(f.level) || 1) === lvl);
			if (exact) return exact;
			if (!isFeatureOption) return undefined;
			// Source-aware, level-agnostic fallback: resolve only when exactly one
			// same-source entry exists, so a same-named feature from a different source
			// (e.g. PHB vs TGTT) is never crossed.
			const candidates = subFeats.filter((/** @type {*} */ f) =>
				nameClassSub(f) && (!src || (f.source || "").toLowerCase() === src));
			return candidates.length === 1 ? candidates[0] : undefined;
		}
		const clsFeats = pool.classFeatures || [];
		const nameClass = (/** @type {*} */ f) =>
			(f.name || "").toLowerCase() === nm
			&& (f.className || "").toLowerCase() === cn;
		const exact = clsFeats.find((/** @type {*} */ f) => nameClass(f) && (Number(f.level) || 1) === lvl);
		if (exact) return exact;
		if (!isFeatureOption) return undefined;
		const candidates = clsFeats.filter((/** @type {*} */ f) =>
			nameClass(f) && (!src || (f.source || "").toLowerCase() === src));
		return candidates.length === 1 ? candidates[0] : undefined;
	}

	/**
	 * Build a hoverable link for a feature using its own locally-stored `entries`,
	 * via the renderer's inline-hover mechanism. No hash / data-pool dependency, so
	 * it always resolves — used for feature-options (e.g. TGTT Specialties) and any
	 * feature missing from the loaded class data.
	 *
	 * @param {*} feature - The stored character feature (must carry `entries`).
	 * @returns {string|null} `<span>` HTML, or null if the feature has no entries.
	 */
	static buildLocalFeatureHoverLink (/** @type {*} */ feature) {
		const entries = Array.isArray(feature?.entries) && feature.entries.length ? feature.entries : null;
		if (!entries) return null;
		return CharacterSheetClassUtils.buildInlineEntriesHoverLink(feature.name, feature.name, entries);
	}

	/**
	 * Build a hoverable `<span>` whose visible label may differ from the hovered
	 * entry's heading. Used when the on-sheet label (e.g. an active-state name
	 * like "Zodiac Form: Octopus") should stay verbatim but the floating hover
	 * should show a specific entry (e.g. the "Octopus" constellation's own text).
	 *
	 * @param {string} displayLabel - Visible text of the link (HTML-escaped).
	 * @param {string} entryName - Heading shown inside the hover tooltip.
	 * @param {Array} entries - 5etools entry array rendered in the hover.
	 * @returns {string|null} `<span>` HTML, or null if entries/renderer unavailable.
	 */
	static buildInlineEntriesHoverLink (/** @type {*} */ displayLabel, /** @type {*} */ entryName, /** @type {*} */ entries) {
		try {
			if (typeof Renderer === "undefined" || !Renderer.hover?.getInlineHover) return null;
			if (!Array.isArray(entries) || !entries.length) return null;
			const hoverMeta = Renderer.hover.getInlineHover({type: "entries", name: entryName, entries});
			// displayLabel is sourced from save data (state.name); escape it.
			const safeLabel = String(displayLabel ?? entryName ?? "")
				.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			return `<span class="ve-help-subtle" ${hoverMeta.html}>${safeLabel}</span>`;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[CharSheet] buildInlineEntriesHoverLink error:", e);
			return null;
		}
	}

	/**
	 * Resolve the hover entity for a chosen Zodiac Form (Circle of the Zodiac).
	 * Given an active-state record carrying `zodiacForm.formId`, returns the
	 * SPECIFIC constellation's `{type:"entries", name, entries}` (e.g. Octopus),
	 * so its active-state hover references the chosen form rather than the generic
	 * "Zodiac Form: Month" feature. Pure; null if not a zodiac form or no entries.
	 *
	 * @param {*} state - An active-state record.
	 * @returns {{type:string, name:string, entries:Array}|null}
	 */
	static getZodiacFormHoverEntity (/** @type {*} */ state) {
		const formId = state?.zodiacForm?.formId;
		if (!formId) return null;
		const Cls = (typeof globalThis !== "undefined" && globalThis.CharacterSheetState) || null;
		const def = Cls?.getZodiacFormDef?.(formId);
		if (!def || !Array.isArray(def.entries) || !def.entries.length) return null;
		return {type: "entries", name: def.name, entries: def.entries};
	}

	/**
	 * Resolve the hover-link sources for a subclass entry.
	 *
	 * The `cls.subclass` slot on a character only stores `{name, source}` —
	 * the source there is the SUBCLASS source (e.g. "EGW" for Chronurgy
	 * Magic). The PG_CLASSES hover hash is built from the CLASS source
	 * (`subclass.classSource`, e.g. "PHB" for the Wizard that Chronurgy
	 * lives on) plus the subclass state portion. Using the wrong source
	 * here builds e.g. `chronurgy magic_tgtt-2014` which doesn't resolve.
	 *
	 * @param {{name?: string, source?: string, className?: string, classSource?: string, shortName?: string}} subclass - Stored subclass entry.
	 * @param {Array} [allSubclasses=[]] - Loaded subclass data (page._subclasses).
	 * @param {{className?: string, classSource?: string}} [storedClass] - Stored class entry, used as a fallback.
	 * @returns {{className: string, classSource: string, source: string, shortName: string, name: string}}
	 */
	static resolveSubclassHoverSources (/** @type {*} */ subclass, /** @type {*} */ allSubclasses = [], /** @type {*} */ storedClass = null) {
		let className = subclass?.className || storedClass?.name || "";
		const subclassSource = subclass?.source || Parser.SRC_XPHB;
		const subclassName = subclass?.name || "";
		const explicitClassSource = subclass?.classSource;

		let classSource = explicitClassSource;
		let shortName = subclass?.shortName;

		if (!classSource || !shortName || !className) {
			const match = (allSubclasses || []).find(sc =>
				sc?.name === subclassName
				&& sc?.source === subclassSource
				&& (!className || sc?.className === className));
			if (match) {
				classSource = classSource || match.classSource;
				shortName = shortName || match.shortName;
				className = className || match.className || "";
			}
		}

		classSource = classSource || storedClass?.source || Parser.SRC_PHB;
		shortName = shortName || subclassName;

		return {
			className,
			classSource,
			source: subclassSource,
			shortName,
			name: subclassName,
		};
	}

	/**
	 * Defensive PG_CLASSES hash-input normalizer.
	 *
	 * Catches the case where `{name, source}` does NOT resolve to a known class
	 * but DOES resolve to a known subclass — in which case the caller likely
	 * meant to hover the subclass's parent class. Returns the parent class
	 * descriptor instead (and logs a single warning per `(name, source)` pair).
	 *
	 * Used to harden every PG_CLASSES hash-builder call site against stale
	 * saves, malformed `{@class}` tags, and other upstream defects that would
	 * otherwise produce hashes like `chronurgy magic_tgtt-2014` (a subclass
	 * name in the class slot) which fail to load.
	 *
	 * @param {{name: string, source: string}} input - The proposed (name, source) pair
	 * @param {{allClasses?: Array, allSubclasses?: Array}} loadedData
	 * @returns {{name: string, source: string, wasNormalized: boolean}}
	 */
	static normalizePgClassesHashInput (input, loadedData = {}) {
		const result = {name: input?.name, source: input?.source, wasNormalized: false};
		if (!input?.name || !input?.source) return result;

		const allClasses = loadedData?.allClasses || [];
		const allSubclasses = loadedData?.allSubclasses || [];

		// If it already resolves to a known class, no normalization needed.
		const isKnownClass = allClasses.some(c =>
			c?.name?.toLowerCase() === input.name.toLowerCase()
			&& (c?.source === input.source || !input.source),
		);
		if (isKnownClass) return result;

		// Look up as a subclass — if found, redirect to the parent class.
		const subclassMatch = allSubclasses.find(sc =>
			sc?.name?.toLowerCase() === input.name.toLowerCase()
			&& (sc?.source === input.source || !input.source),
		);
		if (!subclassMatch || !subclassMatch.className) return result;

		// One-time warning per unique input — surfaces stale references without log-flooding.
		CharacterSheetClassUtils._pgClassesWarnSet = CharacterSheetClassUtils._pgClassesWarnSet || new Set();
		const warnKey = `${input.name}|${input.source}`;
		if (!CharacterSheetClassUtils._pgClassesWarnSet.has(warnKey)) {
			CharacterSheetClassUtils._pgClassesWarnSet.add(warnKey);
			// eslint-disable-next-line no-console
			console.warn(`[CharSheet] normalizePgClassesHashInput: substituting subclass "${input.name}|${input.source}" → parent class "${subclassMatch.className}|${subclassMatch.classSource}"`);
		}

		return {
			name: subclassMatch.className,
			source: subclassMatch.classSource || input.source,
			wasNormalized: true,
		};
	}

	/**
	 * Resolve a stored shallow subclass reference (or even a full one) to the
	 * canonical full subclass object from `classData.subclasses`, so callers
	 * always receive `additionalSpells`, `subclassFeatures`, etc.
	 *
	 * Background: `state.addClass` stores subclasses as lean `{name, source}`
	 * refs to keep saves small. Picker call sites that need to evaluate spell
	 * lists / filter queries (Chronurgy expanded spells, Divine Soul list,
	 * Bladesinging expanded spells, Order Domain expanded spells, etc.) need
	 * the full subclass object — without it, `additionalSpells` is undefined
	 * and filter-based spell inclusion silently fails.
	 *
	 * @param {object|null|undefined} storedSubclass - The shallow stored ref or full subclass.
	 * @param {object|null|undefined} classData - The parent class (with `.subclasses` array).
	 * @returns {object|null} The full subclass object, or the input unchanged if not resolvable.
	 */
	static resolveFullSubclass (storedSubclass, classData) {
		if (!storedSubclass) return storedSubclass || null;
		if (!classData?.subclasses?.length) return storedSubclass;

		// Already full? Either has additionalSpells / subclassFeatures, or is reference-equal
		// to one of classData.subclasses (the "I came from classData.subclasses" sentinel).
		if (storedSubclass.additionalSpells != null
			|| storedSubclass.subclassFeatures != null
			|| storedSubclass.subclassTableGroups != null) {
			return storedSubclass;
		}

		// Match by (name, source). Source is optional — if missing from storedSubclass,
		// match by name only (legacy saves may omit it).
		const name = (storedSubclass.name || "").toLowerCase();
		if (!name) return storedSubclass;

		const exactMatch = classData.subclasses.find(sc =>
			(sc?.name || "").toLowerCase() === name
			&& (!storedSubclass.source || sc?.source === storedSubclass.source),
		);
		let found = exactMatch;
		if (!found) {
			// Name-only fallback (legacy saves without source, or source-renamed brews).
			found = classData.subclasses.find(sc => (sc?.name || "").toLowerCase() === name);
		}
		if (!found) return storedSubclass;

		// Phase 7.1 defensive lazy merge:
		//   If the found subclass STILL has _copy and is missing additionalSpells /
		//   subclassFeatures, the eager merge in _pLoadData missed it (race condition,
		//   silent failure, missing parent at merge time, etc.). Kick off a lazy
		//   merge in place — pMergeCopy mutates `found` via copyApplier.getCopy.
		//   The merge resolves on the next microtask, so this call still returns the
		//   unmerged object once; the NEXT picker render (or any re-call) gets the
		//   merged version. A single console.warn surfaces the recovery for debugging.
		if (found._copy
			&& found.additionalSpells == null
			&& found.subclassFeatures == null
			&& typeof globalThis !== "undefined"
			&& globalThis._charSheetSubclassMergePool
			&& typeof DataUtil !== "undefined"
			&& DataUtil.subclass?.pMergeCopy) {
			try {
				DataUtil.subclass.pMergeCopy(globalThis._charSheetSubclassMergePool, found, {})
					.then(() => {
						// eslint-disable-next-line no-console
						console.warn(`[CharSheet][Phase7] Lazy-merged subclass "${found.name || found._copy?.name}|${found.source}" on demand (eager merge missed it).`);
					})
					.catch(e => {
						// eslint-disable-next-line no-console
						console.warn(`[CharSheet][Phase7] Lazy merge failed for "${found.name || found._copy?.name}|${found.source}":`, e?.message || e);
					});
			} catch (e) {
				// eslint-disable-next-line no-console
				console.warn(`[CharSheet][Phase7] Lazy merge threw for "${found.name || found._copy?.name}|${found.source}":`, e?.message || e);
			}
		}

		return found;
	}

	// ========================================================================
	// Spell counting (single source of truth across all UI surfaces)
	// ========================================================================
	// Spells with one of these sourceFeature labels are "player-chosen" and count
	// toward the cantrip / spell-known cap. Anything else (subclass spells, racial
	// innates, etc.) does NOT count. A cantrip with sourceFeature == null is an
	// "orphan" — it is shown in a separate "Other Cantrips" group and does NOT
	// count toward the cap (per design: orphans must be visible & actionable, not
	// silently inflate or hide the cap).
	static PLAYER_CHOSEN_SPELL_FEATURES = Object.freeze(new Set([
		"Spells Known",
		"Cantrips Known",
		"Wizard Spellbook",
		"Prepared Spells",
		"Spells Prepared",
	]));

	/**
	 * Returns true iff the spell has a positive player-attribution sourceFeature.
	 * Orphans (sourceFeature == null) and feature-granted (subclass / racial)
	 * spells return false.
	 * @param {*} spell
	 * @returns {boolean}
	 */
	static isPlayerChosenSpell (spell) {
		if (!spell || !spell.sourceFeature) return false;
		return CharacterSheetClassUtils.PLAYER_CHOSEN_SPELL_FEATURES.has(spell.sourceFeature);
	}

	/**
	 * Partition cantrips into three buckets so each can be rendered & counted
	 * independently. Pure: no DOM, no state.
	 * @param {Array<*>} cantrips
	 * @returns {{attributed: Array<*>, orphan: Array<*>, featureGranted: Array<*>}}
	 */
	static partitionCantripsByAttribution (cantrips) {
		const attributed = [];
		const orphan = [];
		const featureGranted = [];
		if (!cantrips?.length) return {attributed, orphan, featureGranted};
		for (const c of cantrips) {
			if (!c) continue;
			if (!c.sourceFeature) orphan.push(c);
			else if (CharacterSheetClassUtils.PLAYER_CHOSEN_SPELL_FEATURES.has(c.sourceFeature)) attributed.push(c);
			else featureGranted.push(c);
		}
		return {attributed, orphan, featureGranted};
	}

	/**
	 * Canonical cantrip-count helper. Returns the count of player-attributed
	 * cantrips (the number that appears as the numerator in "X/Y cantrips"),
	 * the orphan list (for the "Other Cantrips" group), and a per-class
	 * breakdown for multiclass status bars.
	 * @param {Array<*>} cantrips
	 * @returns {{count: number, orphans: Array<*>, featureGranted: Array<*>, byClass: Record<string, {count: number, items: Array<*>}>}}
	 */
	static countPlayerChosenCantrips (cantrips) {
		const {attributed, orphan, featureGranted} = CharacterSheetClassUtils.partitionCantripsByAttribution(cantrips);
		/** @type {Record<string, {count: number, items: Array<*>}>} */
		const byClass = {};
		for (const c of attributed) {
			const key = (c.sourceClass || "").toLowerCase();
			if (!byClass[key]) byClass[key] = {count: 0, items: []};
			byClass[key].count += 1;
			byClass[key].items.push(c);
		}
		return {count: attributed.length, orphans: orphan, featureGranted, byClass};
	}

	/**
	 * Canonical prepared-spells count. Counts leveled spells (level > 0) that
	 * are currently `prepared` or `alwaysPrepared`. Cantrips are excluded
	 * (they have their own counter). Spellbook spells with `prepared:false`
	 * are NOT counted — only the ones the player has marked prepared today.
	 * @param {Array<*>} spells
	 * @param {object} [opts]
	 * @param {number} [opts.max] - If supplied, returned `isOver`/`isAt` flags are populated.
	 * @returns {{current: number, max: number|null, isOver: boolean, isAt: boolean}}
	 */
	static countPreparedSpells (spells, {max = null} = {}) {
		const leveled = (spells || []).filter(s => s && s.level > 0);
		const current = leveled.filter(s => s.prepared || s.alwaysPrepared).length;
		const numericMax = typeof max === "number" ? max : null;
		return {
			current,
			max: numericMax,
			isOver: numericMax != null && current > numericMax,
			isAt: numericMax != null && current === numericMax,
		};
	}

	/**
	 * Pick the canonical `{sourceFeature, sourceClass}` to stamp on a spell that is
	 * being added through the manual Add-Spell modal. Mirrors what Builder, LevelUp,
	 * and QuickBuild stamp during their own add flows so the resulting spell counts
	 * toward the cap (and is not silently dumped into the "Other" orphan group).
	 *
	 * Heuristic when multiclass: the modal does not let the user pick which class
	 * the new spell belongs to, so we pick the first spellcasting class — preferring
	 * Wizard for leveled spells (so they go in the spellbook), and otherwise the
	 * first byClass entry.
	 *
	 * @param {object} opts
	 * @param {object} opts.spell        - The raw spell being added (needs `level`).
	 * @param {object|null} opts.info    - The spellcasting info from `getSpellcastingInfo()`.
	 * @param {Array<*>|null} [opts.classes] - Optional `getClasses()` snapshot for wizard/spellbook detection.
	 * @param {object|null} [opts.targetClass] - Authoritative class entry the spell is being added for (per-class card or multiclass picker prompt).
	 * @returns {{sourceFeature: string|null, sourceClass: string|null, sourceSubclass: string|null}}
	 */
	static pickAddedSpellAttribution (/** @type {*} */ {spell, info, classes = null, targetClass = null} = {}) {
		if (!spell) return {sourceFeature: null, sourceClass: null, sourceSubclass: null};

		const isCantrip = spell.level === 0;

		// Authoritative path: the caller knows exactly which class this spell
		// belongs to. Stamp it directly so attribution never relies on a guess.
		if (targetClass) {
			const isGamblerTarget = /^gambler$/i.test(targetClass.subclass?.name || "");
			const isWizardTarget = /^wizard$/i.test(targetClass.name || "");
			const sourceClass = isGamblerTarget ? "Gambler" : (targetClass.name || null);
			const sourceSubclass = isGamblerTarget ? "Gambler" : null;

			let sourceFeature;
			if (isCantrip) sourceFeature = "Cantrips Known";
			else if (isWizardTarget) sourceFeature = "Wizard Spellbook";
			else {
				const entry = Array.isArray(info?.byClass)
					? info.byClass.find(c => (c?.className || "").toLowerCase() === (targetClass.name || "").toLowerCase())
					: null;
				const castingType = entry?.type || info?.type;
				sourceFeature = castingType === "known" ? "Spells Known" : "Prepared Spells";
			}
			return {sourceFeature, sourceClass, sourceSubclass};
		}

		if (!info) return {sourceFeature: null, sourceClass: null, sourceSubclass: null};

		let sourceClass = null;
		const byClass = Array.isArray(info.byClass) ? info.byClass : null;
		const wizardEntry = byClass?.find(c => /wizard/i.test(c?.className || ""));
		const hasWizardClass = !!(classes && classes.some(c => /^wizard$/i.test(c?.name || "")));

		if (!isCantrip && (wizardEntry || hasWizardClass)) {
			sourceClass = wizardEntry?.className || (classes && classes.find(c => /^wizard$/i.test(c?.name || ""))?.name) || "Wizard";
		} else if (byClass?.length) {
			sourceClass = byClass[0].className || null;
		} else if (info.className) {
			sourceClass = info.className;
		} else if (classes?.length) {
			sourceClass = classes[0].name || null;
		}

		// Gambler is a per-spell mode: only stamp Gambler when the resolved class
		// entry is actually the Gambler subclass. This avoids the latent bug where
		// any Wizard leveled spell on a Wizard/Gambler character got mis-stamped
		// as a Gambler spell (and rolled Gambler dice at cast time).
		let sourceSubclass = null;
		const resolvedEntry = classes?.find(c => (c?.name || "").toLowerCase() === (sourceClass || "").toLowerCase());
		if (resolvedEntry && /^gambler$/i.test(resolvedEntry.subclass?.name || "")) {
			sourceClass = "Gambler";
			sourceSubclass = "Gambler";
		}

		let sourceFeature = null;
		if (isCantrip) {
			sourceFeature = "Cantrips Known";
		} else if (sourceClass && /^wizard$/i.test(sourceClass)) {
			sourceFeature = "Wizard Spellbook";
		} else {
			const entry = byClass?.find(c => c.className === sourceClass) || byClass?.[0] || null;
			const castingType = entry?.type || info.type;
			sourceFeature = castingType === "known" ? "Spells Known" : "Prepared Spells";
		}

		return {sourceFeature, sourceClass, sourceSubclass};
	}

	/**
	 * Check whether a character meets an optional feature's prerequisites.
	 * @param {Array<*>|null} prerequisite - The feature's `prerequisite` array (from data)
	 * @param {object} context - Character state context
	 * @param {Array<*>} context.classes - Array of {name, source, level}
	 * @param {number} context.totalLevel - Character's total level
	 * @param {Array<*>} context.existingFeatures - Already-chosen optional features (with `name` field)
	 * @param {Array<*>} context.cantrips - Known cantrips (with `name`, optionally `sourceClass`)
	 * @param {Array<*>} context.spells - Known spells (with `name`, optionally `sourceClass`)
	 * @returns {{met: boolean, reasons: string[]}} Whether prerequisites are met, with unmet reasons
	 */
	static checkPrerequisites (/** @type {*} */ prerequisite, /** @type {*} */ context) {
		if (!prerequisite?.length) return {met: true, reasons: []};

		const {classes = [], totalLevel = 0, existingFeatures = [], cantrips = [], spells = []} = context;
		const reasons = [];

		for (/** @type {*} */ const prereq of prerequisite) {
			// Level prerequisite
			if (/** @type {*} */ prereq.level) {
				const reqLevel = prereq.level.level || prereq.level;
				if (/** @type {*} */ prereq.level.class) {
					const className = prereq.level.class.name?.toLowerCase();
					const classMatch = classes.find((/** @type {*} */ c) => c.name.toLowerCase() === className);
					if (!classMatch || classMatch.level < reqLevel) {
						const classLabel = prereq.level.class.name || "class";
						reasons.push(`Level ${reqLevel} ${classLabel}`);
					}
				} else if (totalLevel < reqLevel) {
					reasons.push(`Level ${reqLevel}`);
				}
			}

			// Pact prerequisite (short form: "Blade", "Chain", "Tome", "Talisman").
			// Also handles full-name pacts like TGTT's "Pact of Transformation" or any
			// future homebrew pact whose name is supplied verbatim.
			if (/** @type {*} */ prereq.pact) {
				const pactLc = prereq.pact.toLowerCase().trim();
				const isFullName = pactLc.startsWith("pact of");
				const hasPact = existingFeatures.some((/** @type {*} */ f) => {
					const nameLc = f.name?.toLowerCase() || "";
					if (isFullName) {
						return nameLc === pactLc || nameLc.includes(pactLc);
					}
					return nameLc === `pact of the ${pactLc}`
						|| nameLc === `pact of ${pactLc}`
						|| nameLc.includes(`pact of the ${pactLc}`)
						|| nameLc.includes(`pact of ${pactLc}`);
				});
				if (!hasPact) {
					const label = isFullName
						? prereq.pact
						: `Pact of the ${prereq.pact.charAt(0).toUpperCase() + prereq.pact.slice(1)}`;
					reasons.push(label);
				}
			}

			// Spell prerequisite
			if (/** @type {*} */ prereq.spell) {
				for (/** @type {*} */ const spellReq of prereq.spell) {
					if (/** @type {*} */ typeof spellReq === "string") {
						// PHB format: "eldritch blast#c" — strip #c suffix, match by name
						const spellName = spellReq.replace(/#c$/i, "").toLowerCase().trim();
						const isCantrip = spellReq.endsWith("#c");
						const pool = isCantrip ? cantrips : [...cantrips, ...spells];
						const hasSpell = pool.some((/** @type {*} */ s) => s.name?.toLowerCase() === spellName);
						if (!hasSpell) {
							const displayName = spellName.split(" ").map((/** @type {*} */ w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
							reasons.push(`${displayName} ${isCantrip ? "cantrip" : "spell"}`);
						}
					} else if (typeof spellReq === "object" && spellReq.choose) {
						// XPHB format: {choose: "level=0|class=Warlock", entry: "...", entrySummary: "..."}
						const met = CharacterSheetClassUtils._checkSpellChoosePrereq(spellReq, context);
						if (!met) {
							const label = spellReq.entrySummary || spellReq.entry || "a required spell";
							reasons.push(label);
						}
					}
				}
			}

			// Optional feature prerequisite
			if (/** @type {*} */ prereq.optionalfeature) {
				for (/** @type {*} */ const ofReq of prereq.optionalfeature) {
					// Format is "name|source" UID
					const reqName = (typeof ofReq === "string" ? ofReq.split("|")[0] : ofReq.name || "").toLowerCase();
					const hasFeature = existingFeatures.some((/** @type {*} */ f) => f.name?.toLowerCase() === reqName);
					if (!hasFeature) {
						const displayName = reqName.split(" ").map((/** @type {*} */ w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
						reasons.push(displayName);
					}
				}
			}

			// Feature prerequisite (class/subclass feature)
			if (/** @type {*} */ prereq.feature) {
				for (/** @type {*} */ const fReq of prereq.feature) {
					const reqName = (typeof fReq === "string" ? fReq.split("|")[0] : fReq.name || "").toLowerCase();
					const hasFeature = existingFeatures.some((/** @type {*} */ f) => f.name?.toLowerCase() === reqName);
					if (!hasFeature) {
						const displayName = reqName.split(" ").map((/** @type {*} */ w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
						reasons.push(displayName);
					}
				}
			}
		}

		return {met: reasons.length === 0, reasons};
	}

	/**
	 * Check an XPHB-style spell "choose" prerequisite.
	 * Format: "level=0|class=Warlock" means "has a level-0 spell from class Warlock"
	 * @private
	 */
	static _checkSpellChoosePrereq (/** @type {*} */ spellReq, /** @type {*} */ context) {
		const {cantrips = [], spells = []} = context;
		const chooseStr = spellReq.choose || "";
		const parts = chooseStr.split("|");

		let requiredLevel = null;
		let requiredClass = null;

		for (/** @type {*} */ const part of parts) {
			const [key, val] = part.split("=");
			if (key === "level") requiredLevel = parseInt(val);
			if (key === "class") requiredClass = val?.toLowerCase();
		}

		const pool = requiredLevel === 0 ? cantrips : [...cantrips, ...spells];
		return pool.some((/** @type {*} */ s) => {
			if (requiredLevel !== null && requiredLevel === 0 && !cantrips.includes(s)) return false;
			if (/** @type {*} */ requiredLevel !== null && requiredLevel > 0) {
				if (s.level !== undefined && s.level !== requiredLevel) return false;
			}
			if (requiredClass && s.sourceClass?.toLowerCase() !== requiredClass) return false;
			return true;
		});
	}

	/**
	 * Get the hit die size for a class.
	 * @param {*} classData - The class data
	 * @returns {number} Hit die size (e.g. 6, 8, 10, 12)
	 */
	static getClassHitDie (/** @type {*} */ classData) {
		const hitDieMap = {
			"Barbarian": 12,
			"Fighter": 10,
			"Paladin": 10,
			"Ranger": 10,
			"Bard": 8,
			"Cleric": 8,
			"Druid": 8,
			"Monk": 8,
			"Rogue": 8,
			"Warlock": 8,
			"Sorcerer": 6,
			"Wizard": 6,
		};
		return classData.hd?.faces || (/** @type {*} */ (hitDieMap))[classData.name] || 8;
	}

	/**
	 * Get the spellcasting ability for a class.
	 * @param {*} classData - The class data
	 * @returns {string|null} Ability abbreviation or null
	 */
	static getSpellcastingAbility (/** @type {*} */ classData) {
		const abilityMap = {
			"Wizard": "int",
			"Artificer": "int",
			"Bard": "cha",
			"Paladin": "cha",
			"Sorcerer": "cha",
			"Warlock": "cha",
			"Cleric": "wis",
			"Druid": "wis",
			"Ranger": "wis",
			"Monk": "wis",
		};
		return classData.spellcastingAbility || (/** @type {*} */ (abilityMap))[classData.name] || null;
	}

	/**
	 * Extract the degree number from a combat method (either format).
	 * @param {*} opt - combatMethod entity or legacy CTM optionalfeature
	 * @returns {number} The degree (0 if not found)
	 */
	static getMethodDegree (/** @type {*} */ opt) {
		if (!opt) return 0;
		// New entity: explicit field
		if (opt.degree !== undefined && opt.tradition !== undefined) return opt.degree;
		// Legacy: extract from featureType or optionalFeatureTypes
		const types = opt.optionalFeatureTypes || (Array.isArray(opt.featureType) ? opt.featureType : []);
		for (/** @type {*} */ const ft of types) {
			const match = ft?.match?.(/^CTM:(\d)[A-Z]{2,3}$/);
			if (match) return parseInt(match[1]);
		}
		return 0;
	}

	/**
	 * Extract the tradition code from a combat method (either format).
	 * @param {*} opt - combatMethod entity or legacy CTM optionalfeature
	 * @returns {string|null} Two-letter tradition code or null
	 */
	static getMethodTraditionCode (/** @type {*} */ opt) {
		if (!opt) return null;
		// New entity: convert full name to code
		if (/** @type {*} */ opt.tradition && typeof opt.tradition === "string" && opt.tradition.length > 2) {
			return CharacterSheetClassUtils.getTraditionCode(opt.tradition);
		}
		// New entity: tradition might already be a code
		if (/** @type {*} */ opt.tradition && opt.tradition.length <= 3) {
			return opt.tradition.toUpperCase();
		}
		// Legacy: extract from featureType or optionalFeatureTypes
		const types = opt.optionalFeatureTypes || (Array.isArray(opt.featureType) ? opt.featureType : []);
		for (/** @type {*} */ const ft of types) {
			const match = ft?.match?.(/^CTM:\d?([A-Z]{2,3})$/);
			if (match) return match[1];
		}
		return null;
	}

	/**
	 * @deprecated Use getMethodTraditionCode instead
	 */
	static getMethodTradition (/** @type {*} */ opt) {
		return CharacterSheetClassUtils.getMethodTraditionCode(opt);
	}

	/**
	 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th...).
	 * @param {number} n
	 * @returns {string} The suffix
	 */
	static getOrdinalSuffix (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return s[(v - 20) % 10] || s[v] || s[0];
	}

	/**
	 * Get emoji for a spell school abbreviation.
	 * @param {string} school - Single-letter school abbreviation
	 * @returns {string} Emoji
	 */
	static getSchoolEmoji (/** @type {*} */ school) {
		const schoolEmojis = {
			"A": "✨", // Abjuration
			"C": "🌀", // Conjuration
			"D": "👁️", // Divination
			"E": "💫", // Enchantment
			"V": "🔥", // Evocation
			"I": "🎭", // Illusion
			"N": "💀", // Necromancy
			"T": "🔄", // Transmutation
		};
		return (/** @type {*} */ (schoolEmojis))[school] || "📜";
	}

	/**
	 * Check if a spell belongs to a class's spell list (using Renderer API with fallback).
	 * @param {*} spell - Spell data object
	 * @param {string} className - Class name to check
	 * @returns {boolean}
	 */
	/**
	 * @param {*} spell - Spell data object
	 * @param {string} className - Class name to check
	 * @param {*} [opts] - Options
	 * @param {object} opts
	 * @param {*} [opts.subclass] - Subclass object with name/shortName to also check fromSubclass lists
	 * @returns {boolean}
	 */
	static spellIsForClass (/** @type {*} */ spell, /** @type {*} */ className, /** @type {*} */ opts = {}) {
		try {
			const classList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
			if (classList?.some((/** @type {*} */ c) => c.name === className)) return true;
		} catch (e) { /* fall through */ }
		if (spell.classes?.fromClassList?.some((/** @type {*} */ c) => c.name === className)) return true;

		// Check variant/optional class lists (e.g. spells added via XGE/TCE expanded lists)
		try {
			const classListVariant = Renderer.spell.getCombinedClasses(spell, "fromClassListVariant");
			if (classListVariant?.some((/** @type {*} */ c) => c.name === className)) return true;
		} catch (e) { /* fall through */ }
		if (spell.classes?.fromClassListVariant?.some((/** @type {*} */ c) => c.name === className)) return true;

		// Check subclass spell lists if subclass is provided
		if (/** @type {*} */ opts.subclass) {
			const subName = (opts.subclass.name || "").toLowerCase();
			const subShort = (opts.subclass.shortName || "").toLowerCase();
			const matchesSub = (/** @type {*} */ entry) => {
				if (entry.class?.name !== className) return false;
				const eName = (entry.subclass?.name || "").toLowerCase();
				const eShort = (entry.subclass?.shortName || "").toLowerCase();
				return (subName && eName === subName) || (subShort && eShort === subShort);
			};
			try {
				const subList = Renderer.spell.getCombinedClasses(spell, "fromSubclass");
				if (subList?.some(matchesSub)) return true;
			} catch (e) { /* fall through */ }
			if (spell.classes?.fromSubclass?.some(matchesSub)) return true;
		}

		return false;
	}

	static _getNormalizedSpellRefIds (/** @type {*} */ value, /** @type {*} */ out = new Set()) {
		if (value == null) return out;

		if (typeof value === "string") {
			// Bug 5: filter-query strings like "source=EGW" or "level=0|class=Cleric"
			// are NOT spell references. They live in `{"all": "<query>"}` blocks (e.g.
			// Chronurgy Magic expanded list, Divine Soul expanded list). Treating them
			// as names creates ghost entries like "source=egw|phb" in the id-set and
			// causes real spells from EGW (Gift of Alacrity) / the Cleric list
			// (Guidance) to be excluded. Skip them here; they're handled by
			// _additionalSpellBlockMatchesSpell instead.
			if (this._isFilterQueryString(value)) return out;
			const [name, source = Parser.SRC_PHB] = value.split("|");
			if (name?.trim()) out.add(`${name.trim().toLowerCase()}|${String(source).trim().toLowerCase()}`);
			return out;
		}

		if (Array.isArray(value)) {
			value.forEach(it => this._getNormalizedSpellRefIds(it, out));
			return out;
		}

		if (typeof value !== "object") return out;

		if (value.choose?.from) this._getNormalizedSpellRefIds(value.choose.from, out);
		if (value.from) this._getNormalizedSpellRefIds(value.from, out);
		if (value.all) this._getNormalizedSpellRefIds(value.all, out);
		if (value.daily) this._getNormalizedSpellRefIds(value.daily, out);
		if (value.rest) this._getNormalizedSpellRefIds(value.rest, out);
		if (value.ritual) this._getNormalizedSpellRefIds(value.ritual, out);

		if (value.name) {
			const source = value.source || Parser.SRC_PHB;
			out.add(`${String(value.name).trim().toLowerCase()}|${String(source).trim().toLowerCase()}`);
		}

		Object.entries(value).forEach(([key, nestedValue]) => {
			if (["name", "source", "choose", "from", "all", "daily", "rest", "ritual", "ability", "resourceName"].includes(key)) return;
			this._getNormalizedSpellRefIds(nestedValue, out);
		});

		return out;
	}

	static _getAdditionalSpellBlockSpellIds (/** @type {*} */ block) {
		const out = new Set();
		if (!block || typeof block !== "object") return out;

		["innate", "known", "prepared", "expanded"].forEach(prop => {
			this._getNormalizedSpellRefIds(block[prop], out);
		});

		return out;
	}

	/**
	 * Bug 5: A filter-query string contains `=` and uses spell-page filter syntax
	 * (e.g. `"source=EGW"`, `"level=0|class=Cleric"`). These appear inside
	 * additionalSpells `{"all": "<query>"}` shorthand and must NOT be treated as
	 * pipe-separated `name|source` references.
	 */
	static _isFilterQueryString (/** @type {*} */ value) {
		if (typeof value !== "string") return false;
		if (!value.includes("=")) return false;
		// Split by `|` (filter AND-clause separator) and verify every segment is `key=value`.
		// Real spell refs are `name|source` — no `=` in either segment.
		return value.split("|").every(seg => /^[a-zA-Z_][\w-]*\s*=\s*[^=]+$/.test(seg.trim()));
	}

	/**
	 * Bug 5: Parse a filter-query string like `"source=EGW|class=Cleric"` into
	 * `[{key: "source", value: "EGW"}, {key: "class", value: "Cleric"}]`.
	 * All clauses are AND-ed together (matches 5etools filter shorthand).
	 */
	static _parseFilterQuery (/** @type {*} */ query) {
		if (typeof query !== "string" || !this._isFilterQueryString(query)) return [];
		return query.split("|")
			.map(seg => {
				const [rawKey, ...rest] = seg.split("=");
				return {
					key: String(rawKey || "").trim().toLowerCase(),
					value: rest.join("=").trim(),
				};
			})
			.filter(c => c.key && c.value);
	}

	/**
	 * Bug 5: True if the given spell matches all clauses of the parsed filter query.
	 * Supported keys: `source`, `level`, `class`, `subclass`, `school`.
	 * Unknown keys conservatively fail-closed (no match) — preserves current
	 * over-restrictive behaviour rather than silently widening pools.
	 */
	static _spellMatchesFilterQuery (/** @type {*} */ spell, /** @type {*} */ clauses) {
		if (!spell || !Array.isArray(clauses) || !clauses.length) return false;

		return clauses.every(({key, value}) => {
			const v = String(value || "").toLowerCase();
			switch (key) {
				case "source":
					return String(spell.source || "").toLowerCase() === v;
				case "level": {
					const lvl = Number(value);
					return Number.isFinite(lvl) && Number(spell.level) === lvl;
				}
				case "class":
					return this.spellIsForClass(spell, value);
				case "subclass": {
					// e.g. `subclass=Life Domain`. Walk fromSubclass entries.
					const matches = (entry) => String(entry.subclass?.name || "").toLowerCase() === v
						|| String(entry.subclass?.shortName || "").toLowerCase() === v;
					try {
						const fromSub = Renderer.spell.getCombinedClasses(spell, "fromSubclass");
						if (Array.isArray(fromSub) && fromSub.some(matches)) return true;
					} catch (e) { /* fall through */ }
					return Array.isArray(spell.classes?.fromSubclass) && spell.classes.fromSubclass.some(matches);
				}
				case "school":
					return String(spell.school || "").toLowerCase() === v;
				default:
					// Unknown filter key — fail closed to avoid silently broadening the pool.
					return false;
			}
		});
	}

	/**
	 * Bug 5: True if the given subclass `additionalSpells` block (innate/known/
	 * prepared/expanded) makes `spell` available. Walks both literal name refs
	 * (via the id-set) and filter-query refs (via {@link _spellMatchesFilterQuery}).
	 */
	static _additionalSpellBlockMatchesSpell (/** @type {*} */ block, /** @type {*} */ spell, /** @type {*} */ spellId) {
		if (!block || typeof block !== "object") return false;
		if (!spellId) return false;

		// Literal name-source match (preserves existing behaviour for {"name":..., "source":...} refs)
		if (this._getAdditionalSpellBlockSpellIds(block).has(spellId)) return true;

		// Filter-query match (Bug 5: walks `{"all": "<query>"}` shorthand in any sub-list)
		const sections = ["innate", "known", "prepared", "expanded"];
		for (const sec of sections) {
			const sectionValue = block[sec];
			if (!sectionValue) continue;
			if (this._sectionMatchesSpellViaFilter(sectionValue, spell)) return true;
		}
		return false;
	}

	static _sectionMatchesSpellViaFilter (/** @type {*} */ value, /** @type {*} */ spell) {
		if (value == null) return false;

		if (typeof value === "string") {
			if (!this._isFilterQueryString(value)) return false;
			return this._spellMatchesFilterQuery(spell, this._parseFilterQuery(value));
		}

		if (Array.isArray(value)) {
			return value.some(it => this._sectionMatchesSpellViaFilter(it, spell));
		}

		if (typeof value !== "object") return false;

		// Common shorthand: {"all": "<query>"}, {"choose": {"from": "<query>"}}, etc.
		if (value.all && this._sectionMatchesSpellViaFilter(value.all, spell)) return true;
		if (value.from && this._sectionMatchesSpellViaFilter(value.from, spell)) return true;
		if (value.choose?.from && this._sectionMatchesSpellViaFilter(value.choose.from, spell)) return true;

		// Walk nested level/category keys (e.g. expanded["1"], known["1e"])
		return Object.entries(value).some(([key, nested]) => {
			if (["name", "source", "choose", "from", "all", "ability", "resourceName"].includes(key)) return false;
			return this._sectionMatchesSpellViaFilter(nested, spell);
		});
	}

	static subclassAdditionalSpellsIncludeSpell (/** @type {*} */ spell, /** @type {*} */ subclass, /** @type {*} */ opts = {}) {
		if (!spell?.name || !subclass?.additionalSpells?.length) return false;

		const spellId = `${String(spell.name).trim().toLowerCase()}|${String(spell.source || Parser.SRC_PHB).trim().toLowerCase()}`;
		const subclassChoice = opts.subclassChoice;

		const relevantBlocks = this.isDivineSoulSubclass(subclass)
			? (() => {
				const affinityBlock = this.getDivineSoulAffinityBlock(subclass, subclassChoice);
				return affinityBlock ? [affinityBlock] : [];
			})()
			: subclass.additionalSpells;

		return relevantBlocks.some(block => this._additionalSpellBlockMatchesSpell(block, spell, spellId));
	}

	static getSpellListClassNames ({className, classSource, subclass, subclassChoice, includeCoreSpellsForHomebrew = false} = /** @type {*} */ ({})) {
		const out = new Set();
		if (className) out.add(className);

		this.getAdditionalSpellListClasses({className, subclass, subclassChoice})
			.forEach(it => out.add(it));

		const isNonStandardSource = classSource && !["PHB", "XPHB", "TCE", "XGE", "TGTT"].includes(classSource);
		if (includeCoreSpellsForHomebrew && isNonStandardSource && className) out.add(className);

		return [...out];
	}

	static spellIsAvailableForClass (/** @type {*} */ spell, /** @type {*} */ opts = {}) {
		const {
			className,
			classSource,
			subclass,
			subclassChoice,
			additionalClassNames = [],
			includeCoreSpellsForHomebrew = false,
		} = opts;

		if (!spell || !className) return false;

		if (this.spellIsForClass(spell, className, {subclass})) return true;
		if (this.subclassAdditionalSpellsIncludeSpell(spell, subclass, {subclassChoice})) return true;

		const resolvedClassNames = additionalClassNames.length
			? additionalClassNames
			: this.getSpellListClassNames({className, classSource, subclass, subclassChoice, includeCoreSpellsForHomebrew}).filter(it => it !== className);

		if (resolvedClassNames.some(it => this.spellIsForClass(spell, it))) return true;

		if (includeCoreSpellsForHomebrew && classSource && !["PHB", "XPHB", "TCE", "XGE", "TGTT"].includes(classSource)) {
			if (this.spellIsForClass(spell, className, {subclass})) return true;
		}

		return false;
	}

	static isDivineSoulSubclass (/** @type {*} */ subclass) {
		if (!subclass?.name && !subclass?.shortName) return false;
		return [subclass.name, subclass.shortName]
			.filter(Boolean)
			.some((/** @type {*} */ name) => String(name).toLowerCase() === "divine soul");
	}

	/**
	 * Get the number of spells a known-caster can swap on level-up at the given level.
	 * Per RAW, Sorcerer/Bard/Ranger/Warlock can swap 1 spell per level-up starting at level 2.
	 * Prepared casters don't use this — they freely swap via the Spells tab.
	 * @param {string} className
	 * @param {string} classSource
	 * @param {number} newLevel - The level being gained
	 * @returns {number} Number of swaps allowed (0 or 1)
	 */
	static getSpellSwapCount (/** @type {*} */ className, /** @type {*} */ classSource, /** @type {*} */ newLevel) {
		if (newLevel < 2) return 0;
		const knownCasters = ["Sorcerer", "Bard", "Ranger", "Warlock"];
		if (!knownCasters.includes(className)) return 0;
		return 1;
	}

	static normalizeDivineSoulAffinity (/** @type {*} */ choice) {
		if (!choice) return null;

		const rawName = typeof choice === "string"
			? choice
			: choice.name || choice.key;
		if (!rawName) return null;

		const name = String(rawName).trim();
		if (!name) return null;

		return {
			key: name.toLowerCase(),
			name,
		};
	}

	static getDivineSoulAffinityOptions (/** @type {*} */ subclass) {
		if (!this.isDivineSoulSubclass(subclass)) return [];
		return (subclass.additionalSpells || [])
			.filter((/** @type {*} */ block) => block?.name)
			.map((/** @type {*} */ block) => this.normalizeDivineSoulAffinity(block.name))
			.filter(Boolean);
	}

	static getDivineSoulAffinityBlock (/** @type {*} */ subclass, /** @type {*} */ subclassChoice) {
		if (!this.isDivineSoulSubclass(subclass)) return null;
		const normalized = this.normalizeDivineSoulAffinity(subclassChoice);
		if (!normalized) return null;

		return (subclass.additionalSpells || []).find((/** @type {*} */ block) => {
			const blockChoice = this.normalizeDivineSoulAffinity(block?.name);
			return blockChoice?.key === normalized.key;
		}) || null;
	}

	static getDivineSoulKnownSpell (/** @type {*} */ subclass, /** @type {*} */ subclassChoice) {
		const block = this.getDivineSoulAffinityBlock(subclass, subclassChoice);
		const spellRef = block?.known?.["1"]?.[0];
		if (!spellRef) return null;

		if (/** @type {*} */ typeof spellRef === "string") {
			const [name, source] = spellRef.split("|");
			return {
				name: name.trim(),
				source: source || Parser.SRC_PHB,
				level: 1,
			};
		}

		if (/** @type {*} */ spellRef?.name) {
			return {
				name: spellRef.name,
				source: spellRef.source || Parser.SRC_PHB,
				level: spellRef.level ?? 1,
			};
		}

		return null;
	}

	/**
	 * Resolve the *effective* Divine Soul affinity spell: the player's swap
	 * override if one is set, otherwise the alignment-derived default from the
	 * subclass's `additionalSpells` block.
	 *
	 * Single source of truth so that every caller (always-prepared population,
	 * builder/levelup ensure paths, swap UI) agrees on which spell is granted —
	 * no per-callsite override reasoning that could drift.
	 *
	 * @param {*} subclass - Divine Soul subclass object
	 * @param {*} subclassChoice - Affinity choice ({key,name} or string)
	 * @param {*} [override] - Optional `{name, source, level}` swap override
	 * @returns {{name:string, source:string, level:number}|null}
	 */
	static getEffectiveDivineSoulSpell (/** @type {*} */ subclass, /** @type {*} */ subclassChoice, /** @type {*} */ override) {
		if (override && override.name) {
			return {
				name: override.name,
				source: override.source || Parser.SRC_PHB,
				level: override.level ?? 1,
			};
		}
		return this.getDivineSoulKnownSpell(subclass, subclassChoice);
	}

	static getAdditionalSpellListClasses ({className, subclass, subclassChoice} = /** @type {*} */ ({})) {
		// Divine Soul Sorcerer (XGE / TGTT): the "Divine Magic" subclass feature
		// grants access to the entire Cleric spell list at L1 — unconditional,
		// not gated on the affinity pick. The affinity choice only grants ONE
		// specific 1st-level spell as always-prepared, handled via the per-block
		// `known` list in `subclassAdditionalSpellsIncludeSpell`.
		//
		// Previously we gated on `normalizeDivineSoulAffinity(subclassChoice)`,
		// which meant a freshly-created Divine Soul Sorcerer (no affinity picked
		// yet, or affinity persisted but not migrated) couldn't see Cleric
		// cantrips like Guidance in the spell picker — Bug 5.
		if (className === "Sorcerer" && this.isDivineSoulSubclass(subclass)) {
			return ["Cleric"];
		}
		return [];
	}

	/**
	 * Get the maximum spell level a class can cast at a given level.
	 * @param {string} className - Class name
	 * @param {number} classLevel - Current class level
	 * @returns {number} Max spell level (0 if non-caster)
	 */
	static getMaxSpellLevelForClass (/** @type {*} */ className, /** @type {*} */ classLevel) {
		const fullCasters = ["Wizard", "Cleric", "Druid", "Bard", "Sorcerer", "Warlock"];
		const halfCasters = ["Paladin", "Ranger", "Artificer"];

		if (fullCasters.includes(className)) {
			return Math.min(9, Math.ceil(classLevel / 2));
		}
		if (halfCasters.includes(className)) {
			return Math.min(5, Math.ceil((classLevel + 1) / 4));
		}
		return 0;
	}

	// ==========================================
	// Spell Metadata Helpers
	// ==========================================

	/**
	 * Get casting time string from spell data.
	 * @param {*} spell
	 * @returns {string}
	 */
	static getSpellCastingTime (/** @type {*} */ spell) {
		if (!spell.time?.length) return "";
		const time = spell.time[0];
		return `${time.number} ${time.unit}`;
	}

	/**
	 * Get range string from spell data.
	 * @param {*} spell
	 * @returns {string}
	 */
	static getSpellRange (/** @type {*} */ spell) {
		if (!spell.range) return "";
		const range = spell.range;
		if (/** @type {*} */ range.type === "point") {
			if (range.distance?.type === "self") return "Self";
			if (range.distance?.type === "touch") return "Touch";
			return `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
		}
		return `${range.distance?.amount || ""} ${range.distance?.type || ""}`.trim();
	}

	/**
	 * Get components string from spell data.
	 * @param {*} spell
	 * @returns {string}
	 */
	static getSpellComponents (/** @type {*} */ spell) {
		if (!spell.components) return "";
		const parts = [];
		if (spell.components.v) parts.push("V");
		if (spell.components.s) parts.push("S");
		if (/** @type {*} */ spell.components.m) {
			const mText = typeof spell.components.m === "string" ? spell.components.m : spell.components.m?.text || "";
			parts.push(mText ? `M (${mText})` : "M");
		}
		return parts.join(", ");
	}

	/**
	 * Get duration string from spell data.
	 * @param {*} spell
	 * @returns {string}
	 */
	static getSpellDuration (/** @type {*} */ spell) {
		if (!spell.duration?.length) return "";
		const dur = spell.duration[0];
		if (dur.type === "instant") return "Instantaneous";
		if (dur.type === "permanent") return "Until dispelled";
		if (/** @type {*} */ dur.concentration) {
			return `Concentration, up to ${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
		}
		return `${dur.duration?.amount || ""} ${dur.duration?.type || ""}`.trim();
	}

	/**
	 * Check if a spell requires concentration.
	 * @param {*} spell
	 * @returns {boolean}
	 */
	static spellIsConcentration (/** @type {*} */ spell) {
		return spell.concentration || spell.duration?.some?.((/** @type {*} */ d) => d.concentration) || false;
	}

	/**
	 * Check if a spell is a ritual.
	 * @param {*} spell
	 * @returns {boolean}
	 */
	static spellIsRitual (/** @type {*} */ spell) {
		return spell.ritual || spell.meta?.ritual || false;
	}

	// ==========================================
	// Known-Caster Progression Tables
	// ==========================================

	/** @private */
	static _SPELLS_KNOWN_TABLES = {
		"Bard": [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
		"Sorcerer": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
		"Warlock": [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
		"Ranger": [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
	};

	/** @private */
	static _CANTRIP_TABLES = {
		"Bard": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
		"Sorcerer": [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
		"Warlock": [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
	};

	/**
	 * Get known-spell count at a class level (for known-caster classes).
	 * @param {*} classData - The class data
	 * @param {string} className - The class name
	 * @param {number} classLevel - The class level
	 * @returns {number|null} Known spell count, or null if not a known caster
	 */
	static getKnownSpellsAtLevel (/** @type {*} */ classData, /** @type {*} */ className, /** @type {*} */ classLevel) {
		const prog = classData.spellsKnownProgression || (/** @type {*} */ (CharacterSheetClassUtils._SPELLS_KNOWN_TABLES))[className];
		if (!prog) return null;
		return prog[classLevel - 1] || 0;
	}

	/**
	 * Get cantrip count at a class level.
	 * @param {*} classData - The class data
	 * @param {string} className - The class name
	 * @param {number} classLevel - The class level
	 * @returns {number|null} Cantrip count, or null if no cantrip progression
	 */
	static getCantripsAtLevel (/** @type {*} */ classData, /** @type {*} */ className, /** @type {*} */ classLevel) {
		const prog = classData.cantripProgression || (/** @type {*} */ (CharacterSheetClassUtils._CANTRIP_TABLES))[className];
		if (!prog) return null;
		return prog[classLevel - 1] || 0;
	}

	/**
	 * Parse the maximum castable spell level from a caster progression string.
	 * @param {string} casterProgression - "full", "1/2", "1/3", "pact"
	 * @param {number} classLevel - Current class level
	 * @returns {number} Max spell level
	 */
	static getMaxSpellLevelFromProgression (/** @type {*} */ casterProgression, /** @type {*} */ classLevel) {
		if (/** @type {*} */ casterProgression === "full" || !casterProgression) {
			return Math.min(9, Math.ceil(classLevel / 2));
		} else if (casterProgression === "1/2") {
			return Math.min(5, Math.ceil(classLevel / 4));
		} else if (casterProgression === "1/3") {
			return Math.min(4, Math.ceil(classLevel / 7));
		} else if (casterProgression === "pact") {
			return Math.min(5, Math.ceil(classLevel / 2));
		} else if (casterProgression === "artificer") {
			return Math.min(5, Math.ceil(classLevel / 4));
		}
		return Math.min(9, Math.ceil(classLevel / 2));
	}

	// ==========================================
	// Feature Data Extraction
	// ==========================================

	/**
	 * Find entries of type "options" in a feature's entries array.
	 * These represent choices the player must make (like Specialties).
	 * @param {*} feature - The feature object with entries
	 * @param {number} characterLevel - Current character level for filtering
	 * @param {Array<*>} [classFeatures] - All class features (for ref lookup)
	 * @returns {Array<*>} Array of {count, options} objects
	 */
	static findFeatureOptions (/** @type {*} */ feature, /** @type {*} */ characterLevel = 1, /** @type {*} */ classFeatures = []) {
		if (!feature?.entries) return [];

		/** @type {*[]} */ const results = [];

		const searchEntries = (/** @type {*} */ entries) => {
			if (!Array.isArray(entries)) return;

			for (/** @type {*} */ const entry of entries) {
				if (/** @type {*} */ typeof entry === "object" && entry.type === "options") {
					const count = entry.count || 1;
					const options = [];

					if (/** @type {*} */ entry.entries) {
						for (/** @type {*} */ const opt of entry.entries) {
							if (/** @type {*} */ opt.type === "refClassFeature" && opt.classFeature) {
								const parts = opt.classFeature.split("|");
								const optLevel = parseInt(parts[3]) || 1;

								if (/** @type {*} */ optLevel <= characterLevel) {
									options.push({
										name: parts[0],
										className: parts[1],
										source: parts[2],
										level: optLevel,
										type: "classFeature",
										ref: opt.classFeature,
									});
								}
							} else if (opt.type === "refSubclassFeature" && opt.subclassFeature) {
								const parts = opt.subclassFeature.split("|");
								options.push({
									name: parts[0],
									className: parts[1],
									source: parts[2],
									subclassShortName: parts[3],
									subclassSource: parts[4],
									level: parseInt(parts[5]) || 1,
									type: "subclassFeature",
									ref: opt.subclassFeature,
								});
							} else if (opt.type === "refOptionalfeature" && opt.optionalfeature) {
								const parts = opt.optionalfeature.split("|");
								options.push({
									name: parts[0],
									source: parts[1] || "PHB",
									type: "optionalfeature",
									ref: opt.optionalfeature,
								});
							} else if (typeof opt === "object" && opt.type === "entries") {
								options.push({
									name: opt.name || "Option",
									type: "inline",
									entries: opt.entries,
									source: opt.source,
								});
							}
						}
					}

					if (/** @type {*} */ options.length > 0) {
						results.push({count, options});
					}
				}

				// Recurse into nested entries
				if (/** @type {*} */ typeof entry === "object") {
					if (entry.entries) searchEntries(entry.entries);
					if (entry.items) searchEntries(entry.items);
				}

				// Check for features that reference another feature's options via {@classFeature ...}
				// This handles higher-level Specialty features that reference the level 1 feature
				if (/** @type {*} */ typeof entry === "string") {
					const refMatch = entry.match(/\{@classFeature\s+([^}]+)\}/);
					if (refMatch && /another|additional|gain/i.test(entry)) {
						const refParts = refMatch[1].split("|");
						const refFeatureName = refParts[0];
						const refClassName = refParts[1];
						const refSource = refParts[2];
						const refLevel = parseInt(refParts[3]) || 1;

						const referencedFeature = CharacterSheetClassUtils.getClassFeatureData(
							classFeatures, refFeatureName, refClassName, refSource, refLevel,
						);
						if (/** @type {*} */ referencedFeature) {
							const refResults = CharacterSheetClassUtils.findFeatureOptions(
								referencedFeature, characterLevel, classFeatures,
							);
							for (/** @type {*} */ const refResult of refResults) {
								results.push({
									count: 1,
									options: refResult.options,
									featureName: feature.name,
									referencedFrom: refMatch[1],
								});
							}
						}
					}
				}
			}
		};

		searchEntries(feature.entries);
		return results;
	}

	/**
	 * Get feature options from features gained at a specific level.
	 * @param {Array<*>} features - Array of features gained at this level
	 * @param {number} level - The level being gained
	 * @param {Array<*>} [classFeatures] - All class features (for ref lookup)
	 * @returns {Array<*>} Array of {featureName, featureSource, count, options, isSubclassFeature} objects
	 */
	static getFeatureOptionsForLevel (/** @type {*} */ features, /** @type {*} */ level, /** @type {*} */ classFeatures = []) {
		const allOptions = [];

		for (const feature of features) {
			const featureOptions = CharacterSheetClassUtils.findFeatureOptions(feature, level, classFeatures);
			for (/** @type {*} */ const optionGroup of featureOptions) {
				allOptions.push({
					featureName: feature.name,
					featureSource: feature.source,
					isSubclassFeature: feature.isSubclassFeature,
					...optionGroup,
				});
			}
		}

		return allOptions;
	}

	/**
	 * Look up a class feature by reference parts.
	 * @param {Array<*>} classFeatures - All class features
	 * @param {string} featureName
	 * @param {string} className
	 * @param {string} source
	 * @param {number} level
	 * @returns {*}
	 */
	static getClassFeatureByRef (/** @type {*} */ classFeatures, /** @type {*} */ featureName, /** @type {*} */ className, /** @type {*} */ source, /** @type {*} */ level) {
		if (!classFeatures?.length) return null;

		return classFeatures.find((/** @type {*} */ f) => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (/** @type {*} */ source && f.source && f.source !== source) {
				return false;
			}
			return true;
		});
	}

	/**
	 * Look up full class feature data with flexible source matching.
	 * @param {Array<*>} classFeatures - All class features
	 * @param {string} featureName
	 * @param {string} className
	 * @param {string} source
	 * @param {number} level
	 * @returns {*}
	 */
	static getClassFeatureData (/** @type {*} */ classFeatures, /** @type {*} */ featureName, /** @type {*} */ className, /** @type {*} */ source, /** @type {*} */ level) {
		if (!classFeatures?.length) return null;

		// First try exact source match
		const exactMatch = classFeatures.find((/** @type {*} */ f) => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (source && f.source !== source) return false;
			return true;
		});
		if (exactMatch) return exactMatch;

		// Fall back to flexible PHB/XPHB/SRD matching
		return classFeatures.find((/** @type {*} */ f) => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.level !== level) return false;
			if (/** @type {*} */ source && f.source && f.source !== source) {
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		}) || null;
	}

	/**
	 * Look up full class feature data from a reference string.
	 * @param {Array<*>} classFeatures - All class features
	 * @param {string} featureRef - "FeatureName|ClassName|Source|Level" format
	 * @returns {*}
	 */
	static getClassFeatureDataFromRef (/** @type {*} */ classFeatures, /** @type {*} */ featureRef) {
		const parts = featureRef.split("|");
		const [name, className, source, level] = parts;
		return CharacterSheetClassUtils.getClassFeatureData(classFeatures, name, className, source, parseInt(level) || 1);
	}

	/**
	 * Look up full subclass feature data to get description/entries.
	 * @param {Array<*>} subclassFeatures - All loaded subclass features
	 * @param {string} featureName - Name of the feature
	 * @param {string} className - Parent class name
	 * @param {string} subclassShortName - Subclass short name
	 * @param {string} source - Feature source
	 * @param {number} level - Feature level
	 * @returns {*}
	 */
	static getSubclassFeatureData (/** @type {*} */ subclassFeatures, /** @type {*} */ featureName, /** @type {*} */ className, /** @type {*} */ subclassShortName, /** @type {*} */ source, /** @type {*} */ level) {
		if (!subclassFeatures?.length) return null;

		// First try exact source match
		const exactMatch = subclassFeatures.find((/** @type {*} */ f) => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.subclassShortName !== subclassShortName) return false;
			if (f.level !== level) return false;
			if (source && f.source !== source) return false;
			return true;
		});
		if (exactMatch) return exactMatch;

		// Fall back to flexible PHB/XPHB/SRD matching
		return subclassFeatures.find((/** @type {*} */ f) => {
			if (f.name !== featureName) return false;
			if (f.className !== className) return false;
			if (f.subclassShortName !== subclassShortName) return false;
			if (f.level !== level) return false;
			if (/** @type {*} */ source && f.source && f.source !== source) {
				const sourcesMatch = [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(source)
					&& [Parser.SRC_PHB, Parser.SRC_XPHB, "SRD"].includes(f.source);
				if (!sourcesMatch) return false;
			}
			return true;
		}) || null;
	}

	/**
	 * Analyze feature text to detect required skill/expertise/bonus choices.
	 * @param {*} opt - Feature option object
	 * @param {Array<*>} classFeatures - All loaded class features
	 * @returns {{type: string, count: number, from: (string|string[])}|null}
	 */
	static parseFeatureSkillChoice (/** @type {*} */ opt, /** @type {*} */ classFeatures = [], {optionalFeatures = /** @type {*[]} */ ([]), resolvedData = null} = /** @type {*} */ ({})) {
		if (!opt?.ref || (opt?.type !== "classFeature" && opt?.type !== "optionalfeature")) return null;

		const fullOpt = resolvedData
			|| (opt.type === "optionalfeature"
				? optionalFeatures.find((/** @type {*} */ f) => f.name === opt.name && f.source === opt.source) || optionalFeatures.find((/** @type {*} */ f) => f.name === opt.name)
				: CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, opt.ref));
		if (!fullOpt?.entries) return null;

		const text = JSON.stringify(fullOpt.entries);

		if (text.includes("You gain proficiency in one of the following")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "proficiency", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("bonus equal to your proficiency bonus on checks made with one of")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "bonus", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("Choose one skill you are proficient in")) {
			return {type: "bonus", count: 1, from: "any_proficient"};
		}

		if (/Choose two (more )?of your skill proficiencies/.test(text)) {
			return {type: "expertise", count: 2, from: "any_proficient"};
		}

		if (text.includes("Choose one of the following skills in which you have proficiency")) {
			const skills = CharacterSheetClassUtils.extractSkillListFromText(text);
			return {type: "expertise", count: 1, from: skills.length ? skills : "any_proficient"};
		}

		if (text.includes("Choose one skill proficiency") && text.includes("Expertise")) {
			return {type: "expertise", count: 1, from: "any_proficient"};
		}

		if (text.includes("Choose two skill proficiencies") && text.includes("Expertise")) {
			return {type: "expertise", count: 2, from: "any_proficient"};
		}

		return null;
	}

	/**
	 * Parse automatic modifiers from feature text that do not require user choices.
	 * @param {*} opt - Feature option object
	 * @param {Array<*>} classFeatures - All loaded class features
	 * @returns {Array<{type: string, value: number|string, note: string}>}
	 */
	static parseFeatureAutoEffects (/** @type {*} */ opt, /** @type {*} */ classFeatures = [], {optionalFeatures = /** @type {*[]} */ ([]), resolvedData = null} = /** @type {*} */ ({})) {
		if (!opt?.ref || (opt?.type !== "classFeature" && opt?.type !== "optionalfeature")) return [];

		const fullOpt = resolvedData
			|| (opt.type === "optionalfeature"
				? optionalFeatures.find((/** @type {*} */ f) => f.name === opt.name && f.source === opt.source) || optionalFeatures.find((/** @type {*} */ f) => f.name === opt.name)
				: CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, opt.ref));
		if (!fullOpt?.entries) return [];

		const text = JSON.stringify(fullOpt.entries);
		const effects = [];

		const passiveIncreaseMatch = text.match(/passive\s+\w+\s*\(\{@skill\s+([^}]+)\}\)\s*(?:score\s+)?increases?\s+by\s+(\d+)/i);
		if (/** @type {*} */ passiveIncreaseMatch) {
			const skill = passiveIncreaseMatch[1].toLowerCase().replace(/\s+/g, "");
			const value = parseInt(passiveIncreaseMatch[2]);
			effects.push({type: `passive:${skill}`, value, note: `+${value} passive ${passiveIncreaseMatch[1]}`});
		}

		// NOTE: PB-based skill bonus ("bonus to X checks equal to your proficiency bonus")
		// is NOT parsed here — it is already handled by FeatureModifierParser when addFeature()
		// calls _processFeatureModifiers(). Parsing it here too would double-count the bonus.

		const skillBonusFixedMatch = text.match(/gain\s+a?\s*\+?(\d+)\s*bonus\s+to\s+\w+\s*\(\{@skill\s+([^}]+)\}\)\s*checks?/i);
		if (/** @type {*} */ skillBonusFixedMatch) {
			const value = parseInt(skillBonusFixedMatch[1]);
			const skill = skillBonusFixedMatch[2].toLowerCase().replace(/\s+/g, "");
			effects.push({type: `skill:${skill}`, value, note: `+${value} to ${skillBonusFixedMatch[2]} checks`});
		}

		const speedIncreaseMatch = text.match(/(?:your\s+)?speed\s+increases?\s+by\s+(\d+)\s*(?:feet|ft)?/i);
		if (/** @type {*} */ speedIncreaseMatch) {
			const value = parseInt(speedIncreaseMatch[1]);
			effects.push({type: "speed", value, note: `+${value} ft. speed`});
		}

		const passiveSimpleMatch = text.match(/\+(\d+)\s*(?:bonus\s+)?(?:to\s+)?(?:your\s+)?passive\s+\{@skill\s+([^}]+)\}/i);
		if (/** @type {*} */ passiveSimpleMatch) {
			const value = parseInt(passiveSimpleMatch[1]);
			const skill = passiveSimpleMatch[2].toLowerCase().replace(/\s+/g, "");
			effects.push({type: `passive:${skill}`, value, note: `+${value} passive ${passiveSimpleMatch[2]}`});
		}

		const darkvisionIncreaseMatch = text.match(/darkvision\s+(?:increases?\s+by|out\s+to)\s+(\d+)\s*(?:feet|ft)?/i);
		if (/** @type {*} */ darkvisionIncreaseMatch) {
			const value = parseInt(darkvisionIncreaseMatch[1]);
			effects.push({type: "sense:darkvision", value, note: `Darkvision ${value} ft.`});
		}

		const acMatch = text.match(/(?:AC|armor\s+class)\s+increases?\s+by\s+(\d+)|\+(\d+)\s+(?:to\s+)?(?:AC|armor\s+class)/i);
		if (/** @type {*} */ acMatch) {
			const value = parseInt(acMatch[1] || acMatch[2]);
			effects.push({type: "ac", value, note: `+${value} AC`});
		}

		const initMatch = text.match(/\+(\d+)\s+(?:to\s+)?initiative|initiative\s+(?:bonus\s+(?:of\s+)?|increases?\s+by\s+)\+?(\d+)/i);
		if (/** @type {*} */ initMatch) {
			const value = parseInt(initMatch[1] || initMatch[2]);
			effects.push({type: "initiative", value, note: `+${value} initiative`});
		}

		return effects;
	}

	/**
	 * Extract skill names from feature text.
	 * @param {string} text
	 * @returns {string[]}
	 */
	static extractSkillListFromText (/** @type {*} */ text) {
		const allSkills = [
			"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
			"History", "Insight", "Intimidation", "Investigation", "Medicine",
			"Nature", "Perception", "Performance", "Persuasion", "Religion",
			"Sleight of Hand", "Stealth", "Survival",
		];

		const found = [];

		const tagMatches = text.matchAll(/\{@skill\s+([^}]+)\}/gi);
		for (/** @type {*} */ const m of tagMatches) {
			const skillName = m[1].trim();
			if (allSkills.some((/** @type {*} */ s) => s.toLowerCase() === skillName.toLowerCase())) {
				found.push(skillName.toTitleCase());
			}
		}

		if (found.length) return [...new Set(found)];

		for (/** @type {*} */ const skill of allSkills) {
			if (text.includes(skill)) found.push(skill);
		}

		return [...new Set(found)];
	}

	/**
	 * Get all features gained at a specific class level (including subclass features).
	 * @param {*} classData - The class data
	 * @param {number} level - The class level
	 * @param {*} subclass - The subclass object (optional)
	 * @param {Array<*>} classFeatures - All loaded class features (for description lookup)
	 * @param {Array<*>} subclassFeatures - All loaded subclass features (for homebrew fallback lookup)
	 * @returns {Array<*>} Array of feature objects
	 */
	static getLevelFeatures (/** @type {*} */ classData, /** @type {*} */ level, /** @type {*} */ subclass, /** @type {*} */ classFeatures = [], /** @type {*} */ subclassFeatures = []) {
		/** @type {*[]} */ const features = [];

		// Get base class features for this level
		if (classData.classFeatures && Array.isArray(classData.classFeatures)) {
			const isArrayOfArrays = Array.isArray(classData.classFeatures[0]);
			const levelFeatures = isArrayOfArrays
				? classData.classFeatures[level - 1] || []
				: classData.classFeatures;

			const featureRefs = isArrayOfArrays
				? levelFeatures
				: levelFeatures.filter((/** @type {*} */ f) => {
					if (/** @type {*} */ typeof f === "string") {
						const parts = f.split("|");
						return parseInt(parts[3]) === level;
					}
					if (/** @type {*} */ typeof f === "object" && f.classFeature) {
						const parts = f.classFeature.split("|");
						return parseInt(parts[3]) === level;
					}
					return f.level === level;
				});

			featureRefs.forEach((/** @type {*} */ featureRef) => {
				if (/** @type {*} */ typeof featureRef === "string") {
					const parts = featureRef.split("|");
					const featureName = parts[0];
					const className = parts[1] || classData.name;
					const classSource = parts[2] || classData.source;
					const featureSource = parts[4] || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureName, className, classSource, level);

					features.push({
						name: featureName,
						className,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: false,
						entries: fullFeature?.entries,
					});
				} else if (typeof featureRef === "object" && featureRef.classFeature) {
					const parts = featureRef.classFeature.split("|");
					const featureName = parts[0];
					const className = parts[1] || classData.name;
					const classSource = parts[2] || classData.source;
					const featureSource = parts[4] || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureName, className, classSource, level);

					features.push({
						name: featureName,
						className,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: !!featureRef.gainSubclassFeature,
						entries: fullFeature?.entries,
					});
				} else if (typeof featureRef === "object" && featureRef.name) {
					const classSource = featureRef.classSource || classData.source;
					const featureSource = featureRef.source || classSource;

					const fullFeature = CharacterSheetClassUtils.getClassFeatureData(classFeatures, featureRef.name, classData.name, classSource, level);

					features.push({
						name: featureRef.name,
						className: classData.name,
						classSource,
						source: featureSource,
						level,
						gainSubclassFeature: !!featureRef.gainSubclassFeature,
						entries: fullFeature?.entries,
					});
				}
			});

			// Extract refClassFeature sub-entries from parent features.
			// Some features (e.g. "Ki", "Monk's Focus") contain refClassFeature entries
			// pointing to standalone sub-features (e.g. "Flurry of Blows") that exist as
			// full classFeature objects but aren't listed in the top-level classFeatures array.
			// IMPORTANT: Skip "options" type entries — those are player choices (Specialties, etc.)
			// handled by findFeatureOptions/getFeatureOptionsForLevel, not automatic grants.
			const featureNames = new Set(features.map((/** @type {*} */ f) => f.name));
			const extracted = [];
			for (const feature of features) {
				if (!feature.entries) continue;
				for (/** @type {*} */ const entry of feature.entries) {
					if (typeof entry !== "object" || !Array.isArray(entry.entries)) continue;
					if (entry.type === "options") continue;
					for (/** @type {*} */ const sub of entry.entries) {
						if (sub?.type !== "refClassFeature" || !sub.classFeature) continue;
						const refParts = sub.classFeature.split("|");
						const refName = refParts[0];
						if (featureNames.has(refName)) continue;
						const refData = CharacterSheetClassUtils.getClassFeatureDataFromRef(classFeatures, sub.classFeature);
						if (!refData) continue;
						featureNames.add(refName);
						extracted.push({
							name: refName,
							className: refParts[1] || classData.name,
							classSource: refParts[2] || classData.source,
							source: refData.source || refParts[2] || classData.source,
							level: parseInt(refParts[3]) || level,
							gainSubclassFeature: false,
							entries: refData.entries,
							parentFeature: feature.name,
						});
					}
				}
			}
			if (extracted.length) features.push(...extracted);
		}

		// Subclass features
		if (/** @type {*} */ subclass && subclass.subclassFeatures) {
			subclass.subclassFeatures.forEach((/** @type {*} */ levelFeatures, /** @type {*} */ idx) => {
				if (Array.isArray(levelFeatures)) {
					levelFeatures.forEach((/** @type {*} */ feature) => {
						if (/** @type {*} */ typeof feature === "object" && feature.level === level) {
							const featureName = feature.name || Renderer.findName(feature);
							if (/** @type {*} */ featureName) {
								features.push({
									name: featureName,
									className: feature.className || subclass.className || classData.name,
									classSource: feature.classSource || subclass.classSource || classData.source,
									subclassName: subclass.name,
									subclassShortName: feature.subclassShortName || subclass.shortName,
									subclassSource: feature.subclassSource || subclass.source || classData.source,
									source: feature.source || subclass.source || classData.source,
									level: feature.level,
									entries: feature.entries,
									isSubclassFeature: true,
								});
							}
						} else if (typeof feature === "string") {
							const parts = feature.split("|");
							const featureLevel = parseInt(parts[parts.length - 1]);
							if (/** @type {*} */ featureLevel === level) {
								const featureName = parts[0];
								const featureClassName = parts[1] || classData.name;
								const featureClassSource = parts[2] || classData.source;
								const featureSubclassShortName = parts[3] || subclass.shortName;
								const featureSource = parts[4] || subclass.source || classData.source;

								// Look up full feature data to get entries/description
								const fullFeature = CharacterSheetClassUtils.getSubclassFeatureData(
									subclassFeatures,
									featureName,
									featureClassName,
									featureSubclassShortName,
									featureSource,
									featureLevel,
								);

								features.push({
									name: featureName,
									className: featureClassName,
									classSource: featureClassSource,
									subclassName: subclass.name,
									subclassShortName: featureSubclassShortName,
									subclassSource: featureSource,
									source: featureSource,
									level: featureLevel,
									entries: fullFeature?.entries,
									isSubclassFeature: true,
								});
							}
						}
					});
				} else if (typeof levelFeatures === "string") {
					const parts = levelFeatures.split("|");
					const featureLevel = parseInt(parts[parts.length - 1]);
					if (/** @type {*} */ featureLevel === level) {
						const featureName = parts[0];
						const featureClassName = parts[1] || classData.name;
						const featureClassSource = parts[2] || classData.source;
						const featureSubclassShortName = parts[3] || subclass.shortName;
						const featureSource = parts[4] || subclass.source || classData.source;

						// Look up full feature data to get entries/description
						const fullFeature = CharacterSheetClassUtils.getSubclassFeatureData(
							subclassFeatures,
							featureName,
							featureClassName,
							featureSubclassShortName,
							featureSource,
							featureLevel,
						);

						features.push({
							name: featureName,
							className: featureClassName,
							classSource: featureClassSource,
							subclassName: subclass.name,
							subclassShortName: featureSubclassShortName,
							subclassSource: featureSource,
							source: featureSource,
							level: featureLevel,
							entries: fullFeature?.entries,
							isSubclassFeature: true,
						});
					}
				}
			});
		}

		// Fallback: If subclass exists but has no subclassFeatures inline (common with homebrew),
		// look up features from the separate subclassFeatures array by subclass name/source
		if (subclass && (!subclass.subclassFeatures || subclass.subclassFeatures.length === 0) && subclassFeatures?.length > 0) {
			const matchingFeatures = subclassFeatures.filter((/** @type {*} */ f) => {
				// Match by subclass name and class name
				if (f.subclassShortName !== subclass.shortName && f.subclassShortName !== subclass.name) return false;
				if (f.className !== (subclass.className || classData.name)) return false;
				if (f.level !== level) return false;
				return true;
			});

			matchingFeatures.forEach((/** @type {*} */ feature) => {
				features.push({
					name: feature.name,
					className: feature.className || subclass.className || classData.name,
					classSource: feature.classSource || subclass.classSource || classData.source,
					subclassName: subclass.name,
					subclassShortName: feature.subclassShortName || subclass.shortName,
					subclassSource: feature.subclassSource || subclass.source || classData.source,
					source: feature.source || subclass.source || classData.source,
					level: feature.level,
					entries: feature.entries,
					isSubclassFeature: true,
				});
			});
		}

		// Expand refSubclassFeature entries from wrapper features (e.g., "Thief" feature that references "Fast Hands")
		// Many subclasses have a wrapper feature at the subclass level that contains references to actual sub-features
		/** @type {*[]} */ const expandedFeatures = [];
		for (const feature of features) {
			if (!(/** @type {*} */ (feature)).isSubclassFeature || !(/** @type {*} */ (feature)).entries) continue;

			// Look for refSubclassFeature entries in the feature's entries
			const searchEntries = (/** @type {*} */ entries) => {
				if (!Array.isArray(entries)) return;
				for (/** @type {*} */ const entry of entries) {
					if (/** @type {*} */ entry?.type === "refSubclassFeature" && entry.subclassFeature) {
						// Parse "FeatureName|ClassName|ClassSource|SubclassShortName|SubclassSource|Level"
						const parts = entry.subclassFeature.split("|");
						const refFeatureName = parts[0];
						const refClassName = parts[1] || classData.name;
						const refClassSource = parts[2] || classData.source;
						const refSubclassShortName = parts[3] || subclass?.shortName;
						const refSubclassSource = parts[4] || subclass?.source || classData.source;
						const refLevel = parseInt(parts[5]) || level;

						// Only expand features at current level
						if (refLevel !== level) continue;

						// Look up the referenced subclass feature
						const refFeature = CharacterSheetClassUtils.getSubclassFeatureData(
							subclassFeatures,
							refFeatureName,
							refClassName,
							refSubclassShortName,
							refSubclassSource,
							refLevel,
						);

						if (refFeature && !features.some((/** @type {*} */ f) => f.name === refFeatureName && f.level === refLevel)) {
							expandedFeatures.push({
								name: refFeatureName,
								className: refClassName,
								classSource: refClassSource,
								subclassName: subclass?.name,
								subclassShortName: refSubclassShortName,
								subclassSource: refSubclassSource,
								source: refFeature.source || refSubclassSource,
								level: refLevel,
								entries: refFeature.entries,
								isSubclassFeature: true,
							});
						}
					}
					// Recurse into nested entries
					if (entry?.entries) searchEntries(entry.entries);
				}
			};

			searchEntries(feature.entries);
		}

		// Add expanded features
		features.push(...expandedFeatures);

		// Filter out placeholder "gain subclass feature" entries when actual subclass features exist
		const actualSubclassFeatures = features.filter((/** @type {*} */ f) => f.isSubclassFeature);
		if (/** @type {*} */ actualSubclassFeatures.length > 0) {
			return features.filter((/** @type {*} */ f) => !f.gainSubclassFeature);
		}

		return features;
	}

	// ==========================================
	// Expertise & Language Detection
	// ==========================================

	/**
	 * Get expertise grants from features at a level.
	 * @param {Array<*>} features - Features gained at the level
	 * @returns {Array<*>} Array of {featureName, count, allowTools, toolName}
	 */
	static getExpertiseGrantsForLevel (/** @type {*} */ features) {
		const grants = [];

		for (const feature of features) {
			const expertiseInfo = CharacterSheetClassUtils.findExpertiseInFeature(feature);
			if (/** @type {*} */ expertiseInfo) {
				grants.push({
					featureName: feature.name,
					...expertiseInfo,
				});
			}
		}

		return grants;
	}

	/**
	 * Find expertise grant in a feature's entries.
	 * @param {*} feature - Feature with entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	static findExpertiseInFeature (/** @type {*} */ feature) {
		if (!feature?.entries) return null;

		if (/** @type {*} */ feature.name === "Expertise") {
			return CharacterSheetClassUtils.parseExpertiseEntries(feature.entries);
		}

		return CharacterSheetClassUtils.findExpertiseInEntries(feature.entries);
	}

	/**
	 * Recursively search entries for nested Expertise grants.
	 * @param {Array<*>} entries
	 * @returns {{count: number, allowTools: boolean, toolName: string}|null}
	 */
	static findExpertiseInEntries (/** @type {*} */ entries) {
		for (/** @type {*} */ const entry of entries) {
			if (/** @type {*} */ typeof entry === "object" && entry.type === "entries") {
				if (/** @type {*} */ entry.name === "Expertise") {
					return CharacterSheetClassUtils.parseExpertiseEntries(entry.entries || []);
				}
				if (CharacterSheetClassUtils.entryGrantsExpertise(entry.entries || [])) {
					return CharacterSheetClassUtils.parseExpertiseEntries(entry.entries || []);
				}
				if (/** @type {*} */ entry.entries) {
					const result = CharacterSheetClassUtils.findExpertiseInEntries(entry.entries);
					if (result) return result;
				}
			}
		}
		return null;
	}

	/**
	 * Check if entries text indicates an expertise grant.
	 * @param {Array<*>} entries
	 * @returns {boolean}
	 */
	static entryGrantsExpertise (/** @type {*} */ entries) {
		const entriesText = entries.map((/** @type {*} */ e) => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();
		return entriesText.includes("proficiency bonus is doubled")
			|| entriesText.includes("gain expertise")
			|| entriesText.includes("double your proficiency bonus");
	}

	/**
	 * Parse expertise entries to determine count and tool allowance.
	 * @param {Array<*>} entries
	 * @returns {{count: number, allowTools: boolean, toolName: string, fixedSkills: string[]}}
	 */
	static parseExpertiseEntries (/** @type {*} */ entries) {
		const entriesText = entries.map((/** @type {*} */ e) => typeof e === "string" ? e : JSON.stringify(e)).join(" ").toLowerCase();

		// Check for fixed/named skill expertise (e.g., "expertise in the Performance skill")
		const skillNames = Object.keys(Parser.SKILL_TO_ATB_ABV || {}).map((/** @type {*} */ s) => s.toLowerCase());
		const fixedSkills = [];

		// Pattern: "expertise in [the] {skill} [skill]" or "gain expertise in {skill}"
		const fixedSkillPattern = /(?:gain\s+)?expertise\s+in\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s*(?:skill)?/gi;
		let match;
		while ((match = fixedSkillPattern.exec(entriesText)) !== null) {
			const potentialSkill = match[1].toLowerCase().replace(/\s+/g, "");
			// Check if it's a valid skill name
			const normalizedSkillNames = skillNames.map((/** @type {*} */ s) => s.replace(/\s+/g, ""));
			if (normalizedSkillNames.includes(potentialSkill)) {
				fixedSkills.push(potentialSkill);
			}
		}

		// If we found fixed skills, return them with count matching
		if (/** @type {*} */ fixedSkills.length > 0) {
			const allowTools = entriesText.includes("thieves' tools") && !entriesText.includes("variantrule");
			return {
				count: fixedSkills.length,
				allowTools,
				toolName: allowTools ? "Thieves' Tools" : /** @type {*} */ (null),
				fixedSkills,
			};
		}

		let count = 1;

		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:two|2)\s+(?:skills?|proficienc)/i)
			|| entriesText.match(/two\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 2;
		}
		if (entriesText.match(/(?:choose|pick|select|gain|get)\s+(?:one|1|a)\s+(?:skill|proficienc)/i)
			|| entriesText.match(/one\s+(?:of\s+)?(?:your\s+)?skill(?:\s+proficienc)?/i)) {
			count = 1;
		}
		if (entriesText.includes("another")) count = 1;
		if (entriesText.includes("three") && entriesText.includes("expertise")) count = 3;
		if (entriesText.includes("four") && entriesText.includes("expertise")) count = 4;

		const allowTools = entriesText.includes("thieves' tools") && !entriesText.includes("variantrule");

		return {
			count,
			allowTools,
			toolName: allowTools ? "Thieves' Tools" : /** @type {*} */ (null),
			fixedSkills: [],
		};
	}

	/**
	 * Get language grants from features at a level.
	 * @param {Array<*>} features - Features gained at the level
	 * @returns {Array<*>} Array of {featureName, count, autoLanguages?}
	 */
	static getLanguageGrantsForLevel (/** @type {*} */ features) {
		const grants = [];

		for (const feature of features) {
			const langInfo = CharacterSheetClassUtils.findLanguageGrantsInFeature(feature);
			if (/** @type {*} */ langInfo) {
				grants.push({
					featureName: feature.name,
					count: langInfo.count,
					autoLanguages: langInfo.autoLanguages,
				});
			}
		}

		return grants;
	}

	/**
	 * Find language grant in a feature's entries.
	 * @param {*} feature
	 * @returns {{count: number, autoLanguages?: string[]}|null}
	 */
	static findLanguageGrantsInFeature (/** @type {*} */ feature) {
		// Special handling for Thieves' Cant - grants Thieves' Cant + 1 other language
		// Check name BEFORE entries since features from string refs may lack entries
		const nameLower = feature?.name?.toLowerCase() || "";
		if (/** @type {*} */ nameLower === "thieves' cant" || nameLower === "thieves cant") {
			return {
				count: 1,
				autoLanguages: ["Thieves' Cant"],
			};
		}

		if (!feature?.entries) return null;

		return CharacterSheetClassUtils.findLanguageGrantsInEntries(feature.entries, feature.name);
	}

	/**
	 * Recursively search entries for language grants.
	 * @param {Array<*>} entries
	 * @param {string} featureName
	 * @returns {{count: number}|null}
	 */
	static findLanguageGrantsInEntries (/** @type {*} */ entries, /** @type {*} */ featureName) {
		const entriesText = entries.map((/** @type {*} */ e) => {
			if (typeof e === "string") return e;
			if (/** @type {*} */ typeof e === "object" && e.type === "list" && e.items) {
				return e.items.map((/** @type {*} */ item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
			}
			return JSON.stringify(e);
		}).join(" ").toLowerCase();

		const langPatterns = [
			/learn\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/speak,?\s*read,?\s*and\s*write\s+(one|two|three|four|\d+)\s+(?:additional\s+)?languages?/i,
			/two\s+(?:additional\s+)?languages?\s+of\s+your\s+choice/i,
			/one\s+(?:additional\s+)?language\s+of\s+your\s+choice/i,
			/one\s+other\s+language\s+of\s+your\s+choice/i,
			/\{@b Languages?\.\}\s*You\s+learn\s+(one|two|three|four|\d+)\s+languages?/i,
		];

		for (/** @type {*} */ const pattern of langPatterns) {
			const match = entriesText.match(pattern);
			if (/** @type {*} */ match) {
				let count = 0;
				const numWord = match[1]?.toLowerCase();
				if (numWord === "one" || numWord === "1") count = 1;
				else if (numWord === "two" || numWord === "2") count = 2;
				else if (numWord === "three" || numWord === "3") count = 3;
				else if (numWord === "four" || numWord === "4") count = 4;
				else if (/^\d+$/.test(numWord)) count = parseInt(numWord);

				if (count === 0 && entriesText.includes("two additional languages")) count = 2;
				if (count === 0 && entriesText.includes("two languages of your choice")) count = 2;
				if (count === 0 && entriesText.includes("one additional language")) count = 1;
				if (count === 0 && entriesText.includes("one language of your choice")) count = 1;
				if (count === 0 && entriesText.includes("one other language of your choice")) count = 1;

				if (count > 0) return {count};
			}
		}

		// Recursively check nested entries
		for (/** @type {*} */ const entry of entries) {
			if (/** @type {*} */ typeof entry === "object" && entry.entries) {
				const result = CharacterSheetClassUtils.findLanguageGrantsInEntries(entry.entries, featureName);
				if (result) return result;
			}
		}

		return null;
	}

	// ==========================================
	// Combat Tradition Helpers
	// ==========================================

	/**
	 * Get combat traditions auto-granted by a subclass feature (e.g. "Combat Methods (Mercy)").
	 * Used during level-up to pre-seed traditions before the effect pipeline runs.
	 * @param {*} subclass - The subclass object ({ shortName, source, ... })
	 * @param {string} classSource - The class source (e.g. "TGTT")
	 * @returns {Array<{tradition: string, code: string}>} Granted traditions
	 */
	static getSubclassGrantedTraditions (/** @type {*} */ subclass, /** @type {*} */ classSource) {
		if (!subclass) return [];
		const lookupKey = subclass.shortName || subclass.name;
		if (!lookupKey) return [];
		const isTGTT = classSource === "TGTT" || subclass.source === "TGTT" || subclass.classSource === "TGTT";
		if (!isTGTT) return [];

		// Subclass → granted tradition(s) + bonus method count
		// "choice" entries mean the user picks from the listed options during level-up
		const GRANTS = {
			// --- Monk subclasses ---
			"Mercy": [{tradition: "Sanguine Knot", code: "SK", bonusMethods: 1}],
			"Shadow": [{tradition: "Mist and Shade", code: "MS", bonusMethods: 1}],
			"Shackled": [{tradition: "Unending Wheel", code: "UW", bonusMethods: 1}],
			"Five Animals": [{tradition: "Tooth and Claw", code: "TC", bonusMethods: 1}],
			"Elements": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Long Death": [{tradition: "Mist and Shade", code: "MS", bonusMethods: 1}],
			"Drunken Master": [{tradition: "Rapid Current", code: "RC", bonusMethods: 1}],
			"Sun Soul": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Astral Self": [{tradition: "Mirror's Glint", code: "MG", bonusMethods: 1}],
			"Ascendant Dragon": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1}],
			"Cobalt Soul": [{tradition: "Razor's Edge", code: "RE", bonusMethods: 1}],
			// Choice-based: user picks from listed traditions
			"Open Hand": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			"Debilitation": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			"Kensei": [{tradition: null, code: null, bonusMethods: 1, choice: true}], // any tradition
			// --- Fighter subclasses ---
			"Eldritch Knight": [{tradition: "Arcane Knight", code: "AK", bonusMethods: 1}, {tradition: "Eldritch Blackguard", code: "EB", bonusMethods: 1}],
			"Battle Master": [{tradition: null, code: null, bonusMethods: 1, choice: true}, {tradition: null, code: null, bonusMethods: 0, choice: true}],
			"Arcane Archer": [{tradition: "Biting Zephyr", code: "BZ", bonusMethods: 1, choice: true}, {tradition: "Razor's Edge", code: "RE", bonusMethods: 0, choice: true}, {tradition: "Unending Wheel", code: "UW", bonusMethods: 0, choice: true}, {tradition: "Unerring Hawk", code: "UH", bonusMethods: 0, choice: true}],
			"Champion": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0, choice: true}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0, choice: true}],
			"Purple Dragon Knight (Banneret)": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1, choice: true}, {tradition: "Sanguine Knot", code: "SK", bonusMethods: 0, choice: true}, {tradition: "Spirited Steed", code: "SS", bonusMethods: 0, choice: true}],
			"Cavalier": [{tradition: "Gallant Heart", code: "GH", bonusMethods: 1}, {tradition: "Spirited Steed", code: "SS", bonusMethods: 0}],
			"Samurai": [{tradition: "Razor's Edge", code: "RE", bonusMethods: 1}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0}],
			"Echo Knight": [{tradition: "Mirror's Glint", code: "MG", bonusMethods: 1}, {tradition: "Mist and Shade", code: "MS", bonusMethods: 0}],
			"Psi Warrior": [{tradition: "Rapid Current", code: "RC", bonusMethods: 1}, {tradition: "Mirror's Glint", code: "MG", bonusMethods: 0}],
			"Rune Knight": [{tradition: "Adamant Mountain", code: "AM", bonusMethods: 1}, {tradition: "Tempered Iron", code: "TI", bonusMethods: 0}],
			// --- Paladin subclasses ---
			"Oathbreaker": [{tradition: "Eldritch Blackguard", code: "EB", bonusMethods: 1}],
			// --- Rogue subclasses ---
			"Swashbuckler": [{tradition: "Comedic Jabs", code: "CJ", bonusMethods: 1}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0}],
			// --- Warder (special: grants 2 fixed traditions) ---
			"Warder": [{tradition: "Tempered Iron", code: "TI", bonusMethods: 1}, {tradition: "Gallant Heart", code: "GH", bonusMethods: 0}],
		};
		return (/** @type {*} */ (GRANTS))[lookupKey] || (/** @type {*} */ (GRANTS))[subclass.name] || [];
	}

	/**
	 * Subclass-specific tradition CHOICE pools: when a subclass grants the
	 * player a CHOICE of N traditions from a restricted (or unrestricted)
	 * pool — independent of the base-class tradition picker.
	 *
	 * `codes: null` → unrestricted (pick `pickCount` from any tradition).
	 * `codes: [...]` → restricted (pick `pickCount` from this specific pool).
	 *
	 * These choices are ADDITIONAL to any fixed (non-`choice`) entries in
	 * `getSubclassGrantedTraditions` and are presented to the user in a
	 * dedicated picker section at the level the subclass is selected.
	 */
	static SUBCLASS_TRADITION_CHOICE_POOLS = {
		// --- Fighter subclasses (TGTT) ---
		// `replacesBase: true` → this subclass choice IS the Fighter's sole tradition
		// flow; the base "Combat Methods" tradition picker is suppressed so the same
		// pick isn't offered twice (see shouldSuppressBaseTraditionPicker).
		"Arcane Archer": {pickCount: 2, codes: ["BZ", "RE", "UW", "UH"], replacesBase: true},
		"Champion": {pickCount: 2, codes: ["AM", "GH", "TI"], replacesBase: true},
		"Purple Dragon Knight (Banneret)": {pickCount: 2, codes: ["AM", "SK", "SS"], replacesBase: true},
		"Battle Master": {pickCount: 2, codes: null, replacesBase: true}, // unrestricted
		// --- Monk subclasses (TGTT) ---
		// No `replacesBase`: these are ADDITIVE on top of the Monk's base tradition
		// picks (pickCount 1 < base count 2), so the base picker stays.
		"Open Hand": {pickCount: 1, codes: ["AM", "TI"]},
		"Debilitation": {pickCount: 1, codes: ["AM", "TI"]},
		"Kensei": {pickCount: 1, codes: null}, // unrestricted
	};

	/**
	 * Return the subclass-choice tradition pool for a given subclass.
	 * @param {*} subclass - Subclass entity (uses shortName, falls back to name).
	 * @param {string} classSource - The classSource (must be TGTT to apply).
	 * @returns {{kind: "none"|"restricted"|"unrestricted", pickCount?: number, codes?: string[]|null}}
	 */
	static getSubclassTraditionChoicePool (/** @type {*} */ subclass, /** @type {*} */ classSource) {
		if (!subclass) return {kind: "none"};
		const lookupKey = subclass.shortName || subclass.name;
		if (!lookupKey) return {kind: "none"};
		const isTGTT = classSource === "TGTT" || subclass.source === "TGTT" || subclass.classSource === "TGTT";
		if (!isTGTT) return {kind: "none"};

		const map = (/** @type {*} */ (CharacterSheetClassUtils.SUBCLASS_TRADITION_CHOICE_POOLS));
		const entry = map[lookupKey] || map[subclass.name];
		if (!entry) return {kind: "none"};

		return {
			kind: entry.codes === null ? "unrestricted" : "restricted",
			pickCount: entry.pickCount,
			codes: entry.codes,
			replacesBase: !!entry.replacesBase,
		};
	}

	/**
	 * Single resolver (used by QuickBuild + LevelUp) deciding whether the base
	 * class combat-tradition picker should be SUPPRESSED in favour of the
	 * subclass-choice picker. True only when the active subclass has a
	 * tradition-choice pool flagged `replacesBase` (the Fighter subclasses,
	 * whose 2-pick choice fully stands in for the base Fighter tradition pick).
	 * Monk-style additive pools (no flag) return false so the base picker stays.
	 * Centralising this keeps both progression modules from offering the same
	 * tradition pick twice.
	 * @param {*} subclass - Subclass entity (uses shortName, falls back to name).
	 * @param {string} classSource - The classSource (must be TGTT to apply).
	 * @returns {boolean}
	 */
	static shouldSuppressBaseTraditionPicker (/** @type {*} */ subclass, /** @type {*} */ classSource) {
		const pool = CharacterSheetClassUtils.getSubclassTraditionChoicePool(subclass, classSource);
		return !!(pool && pool.replacesBase);
	}

	/**
	 * Get the total bonus methods a subclass grants.
	 * @param {*} subclass
	 * @param {string} classSource
	 * @returns {number}
	 */
	static getSubclassBonusMethodCount (/** @type {*} */ subclass, /** @type {*} */ classSource) {
		const granted = this.getSubclassGrantedTraditions(subclass, classSource);
		return granted.reduce((/** @type {*} */ sum, /** @type {*} */ t) => sum + (t.bonusMethods || 0), 0);
	}

	// ==========================================
	// Combat Method Canonical Maps
	// ==========================================

	static TRADITION_CODE_TO_NAME = {
		"AM": "Adamant Mountain",
		"AK": "Arcane Knight",
		"AS": "Ace Starfighter",
		"BU": "Beast Unity",
		"BZ": "Biting Zephyr",
		"CJ": "Comedic Jabs",
		"EB": "Eldritch Blackguard",
		"GH": "Gallant Heart",
		"MG": "Mirror's Glint",
		"MS": "Mist and Shade",
		"RC": "Rapid Current",
		"RE": "Razor's Edge",
		"SK": "Sanguine Knot",
		"SS": "Spirited Steed",
		"TI": "Tempered Iron",
		"TC": "Tooth and Claw",
		"UW": "Unending Wheel",
		"UH": "Unerring Hawk",
	};

	static TRADITION_CODE_TO_DESC = {
		"AM": "Focuses on hardiness, might, and enduring your opponents' blows.",
		"AK": "Blends magic with martial prowess.",
		"AS": "Masters space combat and aerial maneuvers.",
		"BU": "Develops deep connections with animal companions.",
		"BZ": "Masters ranged combat and thrown weapons.",
		"CJ": "Uses humor and wit as weapons.",
		"EB": "Channels dark magic through martial techniques.",
		"GH": "Embodies chivalry and noble combat.",
		"MG": "Focuses on defense, parries, and reflection.",
		"MS": "Emphasizes deception, feinting, and mental games.",
		"RC": "Prizes speed, swift strikes, and mobility.",
		"RE": "Requires awareness, concentration, and discipline.",
		"SK": "Focuses on teamwork and fighting alongside allies.",
		"SS": "Masters mounted combat.",
		"TI": "Channels confidence, conviction, and zealous pursuit.",
		"TC": "Embraces animalistic, predatory combat.",
		"UW": "Embodies mastery, patience, and refined training.",
		"UH": "Perfects precision strikes and keen observation.",
	};

	/**
	 * Get a short description for a tradition by code.
	 * @param {string} tradCode - Two-letter code
	 * @returns {string}
	 */
	static getTraditionDescription (/** @type {*} */ tradCode) {
		return (/** @type {*} */ (CharacterSheetClassUtils.TRADITION_CODE_TO_DESC))[tradCode] || "";
	}

	/**
	 * Returns a short explanatory blurb about the combat methods system for use
	 * in Builder/LevelUp/QuickBuild UIs.
	 *
	 * Optionally accepts class context to tailor the Method DC formula and
	 * Stamina-resource bullets to the supplied class/subclass — mirroring the
	 * runtime DC calc in `charactersheet-state.js`. When no context is
	 * passed the original generic blurb is returned (backward compatible).
	 *
	 * @param {{className?: string, classSource?: string, subclassName?: string}} [opts]
	 * @returns {string} HTML string
	 */
	static getCombatMethodsSystemSummary (/** @type {*} */ {className, classSource, subclassName} = {}) {
		const lcClass = className?.toLowerCase?.() || "";
		const lcSubclass = subclassName?.toLowerCase?.() || "";
		const isTgtt = classSource === "TGTT";

		// --- Resource bullet (Stamina pool, plus any class-specific alternates) ---
		let resourceBullet = `<p class="mb-1"><strong>Combat Methods</strong> are tactical techniques fueled by <strong>Stamina</strong> (pool = 2× your proficiency bonus; regains on short/long rest).</p>`;
		if (lcClass === "monk") {
			resourceBullet = `<p class="mb-1"><strong>Combat Methods</strong> are tactical techniques fueled by <strong>Stamina</strong> (pool = 2× your proficiency bonus; regains on short/long rest). As a Monk, you may spend <strong>Focus Points</strong> in place of stamina.</p>`;
		} else if (lcClass === "paladin" && isTgtt) {
			resourceBullet = `<p class="mb-1"><strong>Combat Methods</strong> are tactical techniques fueled by <strong>Stamina</strong> (pool = 2× your proficiency bonus; regains on short/long rest). As a Paladin, you may also <strong>sacrifice a spell slot</strong> to gain stamina equal to 1 + the slot level.</p>`;
		}

		// --- Method DC bullet (formula, plus any class-specific overrides) ---
		let dcBullet;
		if (lcClass === "monk" && isTgtt) {
			dcBullet = `<p class="mb-0"><strong>Method DC</strong> = 9 + proficiency bonus + STR, DEX, or WIS modifier (your choice).</p>`;
		} else if (lcClass === "paladin" && isTgtt) {
			dcBullet = `<p class="mb-0"><strong>Method DC</strong> = 8 + proficiency bonus + STR or DEX modifier (your choice). Paladins may instead use their <strong>spell save DC</strong>.</p>`;
		} else if (
			(lcClass === "warlock" && (lcSubclass === "hexblade" || lcSubclass === "the hexblade"))
			|| (lcClass === "wizard" && (lcSubclass === "bladesinging" || lcSubclass === "bladesinger"))
		) {
			dcBullet = `<p class="mb-0"><strong>Method DC</strong> = 8 + proficiency bonus + STR or DEX modifier (your choice). You may instead use your <strong>spell save DC</strong>.</p>`;
		} else {
			dcBullet = `<p class="mb-0"><strong>Method DC</strong> = 8 + proficiency bonus + STR or DEX modifier (your choice).</p>`;
		}

		return `<div class="ve-small ve-muted mb-2">${
			resourceBullet
		}<p class="mb-1"><strong>Traditions</strong> are schools of martial technique — like schools of magic for spellcasters. You must be proficient in a tradition to learn its methods.</p>`
			+ `<p class="mb-1">Methods are organized into <strong>degrees</strong> (1st–5th). Your class level determines the highest degree you can learn.</p>${
				dcBullet
			}</div>`;
	}

	static TRADITION_NAME_TO_CODE = Object.entries(CharacterSheetClassUtils.TRADITION_CODE_TO_NAME)
		.reduce((acc, [code, name]) => ({...acc, [name.toLowerCase()]: code}), {});

	/**
	 * Get all known traditions as an array of {code, name} objects, sorted by name.
	 * @returns {Array<{code: string, name: string}>}
	 */
	static getAllTraditions () {
		return Object.entries(CharacterSheetClassUtils.TRADITION_CODE_TO_NAME)
			.map(([code, name]) => ({code, name}))
			.sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name));
	}

	/**
	 * Map a tradition code to its full name.
	 * @param {string} tradCode - Two-letter code
	 * @returns {string}
	 */
	static getTraditionName (/** @type {*} */ tradCode) {
		return (/** @type {*} */ (CharacterSheetClassUtils.TRADITION_CODE_TO_NAME))[tradCode] || tradCode;
	}

	/**
	 * Map a tradition full name to its two-letter code.
	 * @param {string} tradName - Full tradition name
	 * @returns {string|null} Two-letter code or null
	 */
	static getTraditionCode (/** @type {*} */ tradName) {
		if (!tradName) return null;
		// Already a code?
		if ((/** @type {*} */ (CharacterSheetClassUtils.TRADITION_CODE_TO_NAME))[tradName.toUpperCase()]) return tradName.toUpperCase();
		return (/** @type {*} */ (CharacterSheetClassUtils.TRADITION_NAME_TO_CODE))[tradName.toLowerCase()] || null;
	}

	// ==========================================
	// Combat Method Adapter Helpers
	// ==========================================

	/**
	 * Check if a feature is a combat method (either new combatMethod entity or legacy CTM optionalfeature).
	 * @param {*} feature
	 * @returns {boolean}
	 */
	static isCombatMethod (/** @type {*} */ feature) {
		if (!feature) return false;
		// New combatMethod entity type
		if (feature._entityType === "combatMethod" || (feature.tradition !== undefined && feature.degree !== undefined && feature.staminaCost !== undefined)) return true;
		// Legacy CTM optionalfeature
		if (feature.optionalFeatureTypes?.some((/** @type {*} */ ft) => ft?.startsWith?.("CTM:"))) return true;
		if (feature.featureType?.some?.((/** @type {*} */ ft) => ft?.startsWith?.("CTM:"))) return true;
		return false;
	}

	/**
	 * Partition a class-feature display list into the buckets the Features tab renders
	 * separately: standalone features, parent-feature options (e.g. Specialties),
	 * auto-granted combat methods (regular features that are combat methods — e.g. the
	 * Ranger Primal Focus Upgrade's Singular Focus / Groundshatter), and player-picked
	 * optional features. Auto-granted combat methods are diverted out of standalone/options
	 * so they group under their tradition header (with hover + description) exactly once,
	 * while the optional-feature list is kept pure so callers like the metamagic summary
	 * are not polluted by combat methods.
	 * @param {Array<*>} features
	 * @returns {{regularFeatures: Array<*>, optionalFeatures: Array<*>, autoGrantedCombatMethods: Array<*>, standaloneFeatures: Array<*>, featureOptions: Array<*>}}
	 */
	static partitionClassFeaturesForDisplay (/** @type {*[]} */ features = []) {
		const regularFeatures = features.filter(f => f.featureType !== "Optional Feature");
		const optionalFeatures = features.filter(f => f.featureType === "Optional Feature");
		const autoGrantedCombatMethods = regularFeatures.filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		const standaloneFeatures = regularFeatures.filter(f => !f.parentFeature && !CharacterSheetClassUtils.isCombatMethod(f));
		const featureOptions = regularFeatures.filter(f => f.parentFeature && !CharacterSheetClassUtils.isCombatMethod(f));
		return {regularFeatures, optionalFeatures, autoGrantedCombatMethods, standaloneFeatures, featureOptions};
	}

	/**
	 * Resolve the combat methods granted by a feature's `grantsCombatMethods` field.
	 *
	 * Some features (e.g. the Ranger's Primal Focus Upgrade) grant specific combat methods
	 * directly rather than letting the player choose them. Each grant is a `{method, focus}`
	 * pair where `method` is a `"Name|Source"` UID and `focus` is an optional Primal Focus
	 * mode ("predator"/"prey") that gates when the method can be used.
	 *
	 * @param {*} feature - The granting feature (must have `grantsCombatMethods`).
	 * @param {Array<*>} combatMethodEntities - The combat method catalog to resolve UIDs against.
	 * @returns {Array<*>} Resolved combat method entities (copies), tagged with `requiresFocus`
	 *   and `_grantedBy`. Unknown UIDs are skipped.
	 */
	static resolveGrantedCombatMethods (/** @type {*} */ feature, /** @type {*[]} */ combatMethodEntities) {
		const grants = feature?.grantsCombatMethods;
		if (!Array.isArray(grants) || !grants.length) return [];
		if (!Array.isArray(combatMethodEntities) || !combatMethodEntities.length) return [];

		const grantedByUid = CharacterSheetClassUtils.getFeatureUid(feature);
		const resolved = [];
		for (const grant of grants) {
			const uid = typeof grant === "string" ? grant : grant?.method;
			if (!uid) continue;
			const [rawName, rawSource] = uid.split("|");
			const name = (rawName || "").trim().toLowerCase();
			const source = (rawSource || "").trim().toLowerCase();
			if (!name) continue;

			const entity = combatMethodEntities.find(m =>
				m?.name?.toLowerCase() === name
				&& (!source || (m?.source || "").toLowerCase() === source));
			if (!entity) continue;

			const focus = typeof grant === "object" && grant?.focus ? grant.focus : null;
			resolved.push({
				...entity,
				_entityType: "combatMethod",
				requiresFocus: focus,
				_grantedBy: feature?.name || null,
				// Ownership metadata for safe teardown: these methods were granted
				// automatically by a feature (not manually learned), so reconciliation
				// may remove them when the granting feature/level is gone — without ever
				// touching a player's manually-learned combat methods.
				_autoGranted: true,
				_grantedByFeatureUid: grantedByUid,
			});
		}
		return resolved;
	}

	/**
	 * Stable identity string for a class/feature object, used to link auto-granted
	 * artifacts (e.g. combat methods) back to the feature that granted them so they
	 * can be torn down precisely. Mirrors the classFeature UID ordering
	 * (name|className|classSource|level|source) but tolerates missing parts.
	 *
	 * @param {*} feature
	 * @returns {string}
	 */
	static getFeatureUid (/** @type {*} */ feature) {
		if (!feature) return "";
		return [
			feature.name || "",
			feature.className || "",
			feature.classSource || "",
			feature.level != null ? feature.level : "",
			feature.source || "",
		].join("|");
	}

	/**
	 * Declarative catalog of TGTT Ranger Primal Focus mode abilities, for UI display.
	 *
	 * Returns the abilities available in the given focus `mode`, gated by which Primal
	 * Focus upgrades are unlocked (the `upgrade1/2/3` flags from getFeatureCalculations'
	 * `primalFocusUpgrade1/2/3`, which correspond to levels 6 / 10 / 14). This is UI
	 * METADATA ONLY — the mechanical source of truth stays in the feature entries /
	 * getFeatureCalculations effects; this helper just tells the renderer what actionable
	 * controls (usable) and reminders (passive) to surface, and with what action type.
	 *
	 * @param {"predator"|"prey"} mode
	 * @param {{upgrade1?: boolean, upgrade2?: boolean, upgrade3?: boolean}} [flags]
	 * @returns {Array<{name: string, kind: "usable"|"passive"|"method", actionType?: string, note: string}>}
	 */
	static getPrimalFocusModeAbilities (/** @type {*} */ mode, /** @type {*} */ flags = {}) {
		const upgrade1 = !!flags.upgrade1; // level 6
		const upgrade2 = !!flags.upgrade2; // level 10
		const upgrade3 = !!flags.upgrade3; // level 14
		const out = [];

		if (mode === "predator") {
			out.push({name: "Focused Quarry", kind: "usable", actionType: "bonus", note: "Designate a creature you can sense within range as your Quarry; once per turn, deal extra damage when you hit it."});
			out.push({name: "Hunter's Insight", kind: "passive", note: "Advantage on Survival/Perception checks to track or spot your Quarry; learn its creature type when you designate it."});
			if (upgrade1) {
				out.push({name: "Singular Focus", kind: "method", note: "Combat method usable only while in Predator focus (see Combat Methods)."});
				out.push({name: "Pursuit", kind: "passive", note: "Your walking speed increases by 10 feet while in Predator focus."});
				out.push({name: "Intimidating Foe", kind: "passive", note: "Once per turn when you hit with a weapon attack, force a Wisdom save vs. your spell save DC; on a failure the creature is frightened (speed 0) until the end of your next turn."});
				out.push({name: "Predator Eye", kind: "usable", actionType: "bonus", note: "Intelligence (Nature) check vs. the target's Deception; on a success, learn one of its resistances or vulnerabilities."});
			}
			if (upgrade2) {
				out.push({name: "Relentless Momentum", kind: "passive", note: "Ignore speed reduction from damage, spells, or magical effects."});
				out.push({name: "Charging Strike", kind: "passive", note: "When you move at least 10 feet straight toward a creature, your first weapon attack against it that turn has advantage."});
				out.push({name: "Deflection", kind: "passive", note: "Creatures other than your Quarry have disadvantage on opportunity attacks against you."});
			}
			if (upgrade3) {
				out.push({name: "Blood Scent", kind: "passive", note: "After you deal damage to a target, you know its exact direction and distance for 1 hour, ignoring invisibility and magical concealment."});
			}
			return out;
		}

		// Prey focus
		out.push({name: "Hunter's Dodge", kind: "usable", actionType: "reaction", note: "When a creature you can see attacks you or an ally within 30 feet, grant the target a bonus to AC equal to your proficiency bonus for that attack."});
		if (upgrade1) {
			out.push({name: "Groundshatter", kind: "method", note: "Combat method usable only while in Prey focus (see Combat Methods)."});
			out.push({name: "Terrain Defense", kind: "passive", note: "Bonus to AC and Dexterity saves equal to half your proficiency bonus (min +1) when benefiting from cover or standing in difficult terrain."});
			out.push({name: "Improvised Sanctuary", kind: "usable", actionType: "action", note: "Reinforce a 5-foot section of natural terrain into protective cover."});
		}
		if (upgrade2) {
			out.push({name: "Unimpeded", kind: "passive", note: "You ignore difficult terrain up to a distance equal to your speed when moving."});
		}
		if (upgrade3) {
			out.push({name: "Inescapable Sight", kind: "usable", actionType: "bonus", note: "Sense the exact location of all hostile or obscured creatures within 60 feet until the end of your next turn."});
		}
		return out;
	}

	/**
	 * Get the full tradition name from a combat method (either format).
	 * @param {*} feature
	 * @returns {string|null}
	 */
	static getMethodTraditionName (/** @type {*} */ feature) {
		if (!feature) return null;
		// New entity: tradition is already a full name
		if (feature.tradition && typeof feature.tradition === "string" && feature.tradition.length > 2) return feature.tradition;
		// Legacy: extract code from featureType and convert
		const code = CharacterSheetClassUtils.getMethodTraditionCode(feature);
		return code ? CharacterSheetClassUtils.getTraditionName(code) : null;
	}

	/**
	 * Get the stamina cost from a combat method (either format).
	 * @param {*} feature
	 * @returns {number}
	 */
	static getMethodStaminaCost (/** @type {*} */ feature) {
		if (!feature) return 0;
		// New entity: explicit field
		if (feature.staminaCost !== undefined) return feature.staminaCost;
		// Legacy: from consumes object
		if (feature.consumes?.name === "Stamina") return feature.consumes.amount || 1;
		return 0;
	}

	/**
	 * Get the action type from a combat method (either format).
	 * @param {*} feature
	 * @returns {string|null}
	 */
	static getMethodActionType (/** @type {*} */ feature) {
		if (!feature) return null;
		// New entity: explicit field
		if (feature.actionType) return feature.actionType;
		return null;
	}

	/**
	 * Normalize a combat method (either format) to a common shape.
	 * @param {*} feature - combatMethod entity or legacy CTM optionalfeature
	 * @returns {*} Unified shape
	 */
	static normalizeMethodToCommon (/** @type {*} */ feature) {
		if (!feature) return null;

		const traditionCode = CharacterSheetClassUtils.getMethodTraditionCode(feature);

		return {
			name: feature.name,
			source: feature.source,
			tradition: CharacterSheetClassUtils.getMethodTraditionName(feature) || feature.tradition,
			traditionCode,
			degree: CharacterSheetClassUtils.getMethodDegree(feature),
			staminaCost: CharacterSheetClassUtils.getMethodStaminaCost(feature),
			actionType: CharacterSheetClassUtils.getMethodActionType(feature),
			entries: feature.entries,
			description: feature.description,
			prerequisite: feature.prerequisite,
			_isLegacyCTM: !feature._entityType && !feature.staminaCost,
			_original: feature,
		};
	}

	/**
	 * Get known combat traditions from existing optional features on the character.
	 * @param {Array<*>} existingOptFeatures - Character's existing optional features
	 * @param {*} state - Character state (for getCombatTraditions)
	 * @returns {Array<string>} Array of tradition codes
	 */
	static getKnownCombatTraditions (/** @type {*} */ existingOptFeatures, /** @type {*} */ state) {
		// First check explicitly stored traditions
		const storedTraditionsRaw = state.getCombatTraditions?.() || [];
		const storedTraditions = Array.from(new Set(
			storedTraditionsRaw
				.map((/** @type {*} */ t) => typeof t === "string" ? t : t?.code)
				.filter(Boolean),
		));
		if (storedTraditions.length > 0) return storedTraditions;

		// Fall back to inferring from existing combat method features
		const traditions = new Set();
		for (/** @type {*} */ const feature of existingOptFeatures) {
			if (CharacterSheetClassUtils.isCombatMethod(feature)) {
				const code = CharacterSheetClassUtils.getMethodTraditionCode(feature);
				if (code) traditions.add(code);
			}
		}
		return Array.from(traditions);
	}

	/**
	 * Get how many combat traditions a class should select.
	 * Attempts to parse from Combat Methods feature text; falls back to default.
	 * @param {object} opts
	 * @param {*} opts.classData
	 * @param {Array<*>} opts.classFeatures
	 * @param {number} [opts.defaultCount=2]
	 * @returns {number}
	 */
	static getCombatTraditionSelectionCount ({classData, classFeatures = [], defaultCount = 2} = /** @type {*} */ ({})) {
		const className = classData?.name;
		if (!className || !classFeatures?.length) return defaultCount;

		const combatMethodsFeature = classFeatures.find((/** @type {*} */ f) =>
			f.className === className
			&& f.name === "Combat Methods"
			&& f.level <= 5,
		);
		if (!combatMethodsFeature?.entries) return defaultCount;

		const text = JSON.stringify(combatMethodsFeature.entries).toLowerCase();
		const wordToNum = {
			one: 1,
			two: 2,
			three: 3,
			four: 4,
			five: 5,
			six: 6,
		};

		const parseToken = (/** @type {*} */ token) => {
			if (!token) return null;
			const asNum = Number(token);
			if (!Number.isNaN(asNum) && asNum > 0) return asNum;
			return (/** @type {*} */ (wordToNum))[token] || null;
		};

		const patterns = [
			/(\d+|one|two|three|four|five|six)\s+combat\s+traditions?\b/i,
			/choose\s+(\d+|one|two|three|four|five|six)\s+(?:different\s+)?traditions?\b/i,
			/gain\s+proficiency\s+in\s+(\d+|one|two|three|four|five|six)\s+combat\s+traditions?\b/i,
		];

		for (/** @type {*} */ const pattern of patterns) {
			const match = text.match(pattern);
			const parsed = parseToken(match?.[1]);
			if (parsed) return parsed;
		}

		return defaultCount;
	}

	/**
	 * Get the maximum method degree available at a given level from the class table.
	 * @param {*} cls - Class data
	 * @param {number} level - Class level
	 * @returns {number}
	 */
	static getMaxMethodDegree (/** @type {*} */ cls, /** @type {*} */ level) {
		if (!cls.classTableGroups) return 0;

		for (/** @type {*} */ const group of cls.classTableGroups) {
			const degreeColIdx = group.colLabels?.findIndex((/** @type {*} */ label) =>
				label.toLowerCase().includes("method degree"),
			);

			if (/** @type {*} */ degreeColIdx >= 0 && group.rows) {
				const row = group.rows[level - 1];
				if (/** @type {*} */ row) {
					const degreeVal = row[degreeColIdx];
					if (/** @type {*} */ typeof degreeVal === "string") {
						const match = degreeVal.match(/^(\d)/);
						if (match) return parseInt(match[1]);
					} else if (typeof degreeVal === "number") {
						return degreeVal;
					}
				}
			}
		}
		return 0;
	}

	/**
	 * Get available combat traditions from combat method entities and/or optional features.
	 * @param {Array<*>} allFeatures - combatMethod entities and/or optional features
	 * @returns {Array<{code: string, name: string}>}
	 */
	static getAvailableTraditions (/** @type {*} */ allFeatures) {
		const traditions = new Map();

		for (/** @type {*} */ const feature of allFeatures) {
			if (!CharacterSheetClassUtils.isCombatMethod(feature)) continue;
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(feature);
			if (tradCode && !traditions.has(tradCode)) {
				traditions.set(tradCode, {
					code: tradCode,
					name: CharacterSheetClassUtils.getTraditionName(tradCode),
				});
			}
		}

		return Array.from(traditions.values()).sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name));
	}

	/**
	 * Extract tradition codes from a class's Combat Methods feature description.
	 * @param {string} className
	 * @param {number} level
	 * @param {Array<*>} classFeatures - All loaded class features
	 * @returns {Set<string>} Set of tradition codes
	 */
	static extractTraditionsFromClassFeature (/** @type {*} */ className, /** @type {*} */ level, /** @type {*} */ classFeatures) {
		const traditions = new Set();
		if (!classFeatures?.length) return traditions;

		const combatMethodsFeature = classFeatures.find((/** @type {*} */ f) =>
			f.className === className
			&& f.name === "Combat Methods"
			&& f.level <= 5,
		);

		if (!combatMethodsFeature) return traditions;

		// Detect unrestricted marker: {@filter <text>|combatmethods} (no |tradition= suffix).
		// When present anywhere in the feature, the class is NOT restricted to a
		// specific subset — any tradition= filters elsewhere are advisory
		// (e.g. Fighter's "Getting Started" inset suggests TI + AM but allows all 17).
		// Returning an empty set signals "no restriction" to upstream callers,
		// which fall back to the full tradition pool.
		const hasUnrestrictedMarker = (/** @type {*} */ entries) => {
			if (!entries) return false;
			if (typeof entries === "string") {
				// Match {@filter <text>|combatmethods} where the closing brace
				// immediately follows `combatmethods` (no third |tradition=... segment).
				return /\{@filter [^|}]+\|combatmethods\}/.test(entries);
			}
			if (Array.isArray(entries)) return entries.some(hasUnrestrictedMarker);
			if (typeof entries === "object") {
				return hasUnrestrictedMarker(entries.entries)
					|| hasUnrestrictedMarker(entries.items)
					|| hasUnrestrictedMarker(entries.entry);
			}
			return false;
		};

		if (hasUnrestrictedMarker(combatMethodsFeature.entries)) return traditions;

		const extractFromEntries = (/** @type {*} */ entries) => {
			if (!entries) return;
			if (/** @type {*} */ typeof entries === "string") {
				// Legacy format: feature type=ctm:XX
				const ctmMatches = entries.matchAll(/feature\s+type[=:]\s*ctm:([a-z]{2,3})/gi);
				for (/** @type {*} */ const match of ctmMatches) {
					traditions.add(match[1].toUpperCase());
				}
				// New format: |combatmethods|tradition=Name
				const newMatches = entries.matchAll(/\|combatmethods\|tradition=([^}]+)/gi);
				for (/** @type {*} */ const match of newMatches) {
					const code = CharacterSheetClassUtils.getTraditionCode(match[1].trim());
					if (code) traditions.add(code);
				}
				return;
			}
			if (Array.isArray(entries)) {
				for (const entry of entries) extractFromEntries(entry);
				return;
			}
			if (/** @type {*} */ typeof entries === "object") {
				if (entries.entries) extractFromEntries(entries.entries);
				if (entries.items) extractFromEntries(entries.items);
				if (entries.entry) extractFromEntries(entries.entry);
			}
		};

		extractFromEntries(combatMethodsFeature.entries);
		return traditions;
	}

	/**
	 * Get available combat traditions filtered by what the class has access to.
	 * @param {Array<string>} classAllowedTypes
	 * @param {string} className
	 * @param {Array<*>} classFeatures
	 * @returns {Array<{code: string, name: string}>}
	 */
	static getAvailableTraditionsForClass (/** @type {*} */ allFeatures, /** @type {*} */ classAllowedTypes, /** @type {*} */ className, /** @type {*} */ classFeatures) {
		const allowedTraditionCodes = new Set();
		let hasDegreeOnlyCodes = false;

		for (/** @type {*} */ const ft of classAllowedTypes) {
			const match = ft.match(/^CTM:(\d)?([A-Z]{2,3})$/);
			if (/** @type {*} */ match && match[2]) {
				// Tradition-specific code like CTM:1AM → extract tradition
				allowedTraditionCodes.add(match[2]);
			} else if (/^CTM:\d+$/.test(ft)) {
				// Degree-only code like CTM:1 → class allows any degree-1 method;
				// the actual tradition restriction (if any) is encoded in the
				// class-feature text via `{@filter ...|combatmethods|tradition=Name}` tags.
				hasDegreeOnlyCodes = true;
			}
		}

		// 1. If the progression declared tradition-specific codes (CTM:NXX), use those.
		// 2. Otherwise, prefer class-feature text extraction so non-Fighter classes
		//    (Ranger / Monk / Paladin / Bard / Barbarian) are limited to the
		//    traditions explicitly listed in their Combat Methods feature.
		// 3. Only when neither yielded a list do degree-only codes mean "unrestricted".
		// 4. Final fallback: every CTM feature in the data pool.
		if (/** @type {*} */ allowedTraditionCodes.size === 0 && className) {
			const featureTraditions = CharacterSheetClassUtils.extractTraditionsFromClassFeature(className, 2, classFeatures);
			for (const trad of featureTraditions) allowedTraditionCodes.add(trad);
		}

		if (/** @type {*} */ hasDegreeOnlyCodes && allowedTraditionCodes.size === 0) {
			return CharacterSheetClassUtils.getAllTraditions();
		}

		if (/** @type {*} */ allowedTraditionCodes.size === 0) {
			return CharacterSheetClassUtils.getAvailableTraditions(allFeatures);
		}

		const traditions = new Map();
		for (/** @type {*} */ const tradCode of allowedTraditionCodes) {
			traditions.set(tradCode, {
				code: tradCode,
				name: CharacterSheetClassUtils.getTraditionName(tradCode),
			});
		}

		return Array.from(traditions.values()).sort((/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name));
	}

	// ==========================================
	// State Builder Helpers
	// ==========================================

	/**
	 * Build a spell state object ready for state.addSpell().
	 * Single source of truth — includes all enrichment fields.
	 * @param {*} spell - Raw spell data
	 * @param {object} opts
	 * @param {string} opts.sourceFeature - e.g. "Wizard Spellbook", "Spells Known"
	 * @param {string} opts.sourceClass - e.g. "Wizard", "Sorcerer"
	 * @param {boolean} [opts.prepared=false] - Whether spell is prepared
	 * @param {boolean} [opts.inSpellbook=false] - Whether spell is in spellbook
	 * @returns {*} Spell state object
	 */
	static buildSpellStateObject (/** @type {*} */ spell, {sourceFeature, sourceClass, prepared = false, inSpellbook = false}) {
		return {
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			ritual: CharacterSheetClassUtils.spellIsRitual(spell),
			concentration: CharacterSheetClassUtils.spellIsConcentration(spell),
			prepared,
			inSpellbook,
			sourceFeature,
			sourceClass,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			subschools: spell.subschools || [],
		};
	}

	/**
	 * Build a cantrip state object ready for state.addCantrip().
	 * @param {*} spell - Raw cantrip data
	 * @param {object} opts
	 * @param {string} opts.sourceFeature
	 * @param {string} opts.sourceClass
	 * @returns {*} Cantrip state object
	 */
	static buildCantripStateObject (/** @type {*} */ spell, {sourceFeature, sourceClass}) {
		return {
			name: spell.name,
			source: spell.source,
			school: spell.school,
			sourceFeature,
			sourceClass,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			subschools: spell.subschools || [],
		};
	}

	/**
	 * Build an innate spell state object ready for state.addInnateSpell().
	 * @param {*} spell - Raw spell data (full spell object from data)
	 * @param {object} opts
	 * @param {string} opts.sourceFeature
	 * @param {boolean} [opts.atWill=false]
	 * @param {number} [opts.uses]
	 * @param {string} [opts.recharge="long"]
	 * @returns {*} Innate spell state object
	 */
	static buildInnateSpellStateObject (/** @type {*} */ spell, {sourceFeature, atWill = false, uses, recharge = "long"}) {
		return {
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			atWill,
			uses,
			recharge,
			sourceFeature,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			concentration: CharacterSheetClassUtils.spellIsConcentration(spell),
			ritual: CharacterSheetClassUtils.spellIsRitual(spell),
			subschools: spell.subschools || [],
		};
	}

	/**
	 * Build a normalized feature object ready for state.addFeature(), preserving
	 * metadata-first fields while applying canonical class/level/source defaults.
	 * @param {*} feature - Raw feature payload
	 * @param {object} opts
	 * @param {string} [opts.className]
	 * @param {string} [opts.classSource]
	 * @param {number} [opts.level]
	 * @param {string} [opts.featureType="Class"]
	 * @param {string} [opts.subclassName]
	 * @param {string} [opts.subclassShortName]
	 * @param {string} [opts.subclassSource]
	 * @param {boolean} [opts.isSubclassFeature]
	 * @param {boolean} [opts.isFeatureOption]
	 * @param {string} [opts.parentFeature]
	 * @param {Array<string>} [opts.optionalFeatureTypes]
	 * @returns {*}
	 */
	static buildFeatureStateObject (
		/** @type {*} */ feature,
		{
			className,
			classSource,
			level,
			featureType = "Class",
			subclassName,
			subclassShortName,
			subclassSource,
			isSubclassFeature,
			isFeatureOption,
			parentFeature,
			optionalFeatureTypes,
		} = {},
	) {
		const outFeature = feature || {};

		const entries = outFeature.entries;
		let description = outFeature.description;
		if (!description && entries) {
			// Strip "options" entries before rendering — their children are player choices
			// (e.g. Specialties), not automatic grants, and would pollute the description
			// with modifier text from ALL options (causing false auto-modifier detection).
			const entriesToRender = CharacterSheetClassUtils._stripOptionsEntries(entries);
			try { description = Renderer.get().render({entries: entriesToRender}); } catch (e) { description = ""; }
		}

		const explicitFeatureType = typeof outFeature.featureType === "string"
			? outFeature.featureType
			: null;

		const normalizedOptionalFeatureTypes = outFeature.optionalFeatureTypes
			|| (Array.isArray(outFeature.featureType) ? outFeature.featureType : undefined)
			|| optionalFeatureTypes;

		return {
			...outFeature,
			name: outFeature.name,
			source: outFeature.source || classSource,
			className: outFeature.className || className,
			classSource: outFeature.classSource || classSource,
			level: outFeature.level || level,
			subclassName: outFeature.subclassName ?? subclassName,
			subclassShortName: outFeature.subclassShortName ?? subclassShortName,
			subclassSource: outFeature.subclassSource ?? subclassSource,
			featureType: explicitFeatureType || featureType,
			entries,
			description: description || "",
			isSubclassFeature: outFeature.isSubclassFeature ?? isSubclassFeature,
			isFeatureOption: outFeature.isFeatureOption ?? isFeatureOption,
			parentFeature: outFeature.parentFeature ?? parentFeature,
			optionalFeatureTypes: normalizedOptionalFeatureTypes,
		};
	}

	/**
	 * Build a compact, replay-safe history snapshot from a feature-like payload.
	 * Used to persist metadata-critical fields in level history without relying on
	 * display-only summary objects.
	 * @param {*} feature
	 * @param {*} [opts]
	 * @param {object} opts
	 * @param {string} [opts.type]
	 * @param {string} [opts.parentFeature]
	 * @returns {*}
	 */
	static buildHistoryFeatureSnapshot (/** @type {*} */ feature, {type, parentFeature} = {}) {
		const outFeature = feature || {};
		/** @type {*} */ const snapshot = {
			name: outFeature.name,
			source: outFeature.source,
			type: type || outFeature.type,
			parentFeature: parentFeature ?? outFeature.parentFeature,
			ref: outFeature.ref,
			level: outFeature.level,
			featureType: outFeature.featureType,
			optionalFeatureTypes: outFeature.optionalFeatureTypes || (Array.isArray(outFeature.featureType) ? outFeature.featureType : undefined),
			className: outFeature.className,
			classSource: outFeature.classSource,
			subclassName: outFeature.subclassName,
			subclassShortName: outFeature.subclassShortName,
			subclassSource: outFeature.subclassSource,
			isSubclassFeature: outFeature.isSubclassFeature,
			isFeatureOption: outFeature.isFeatureOption,
			activatable: outFeature.activatable,
			effects: outFeature.effects,
			uses: outFeature.uses,
			interactionMode: outFeature.interactionMode,
		};

		if (!snapshot.ref) {
			snapshot.entries = outFeature.entries;
			snapshot.description = outFeature.description;
		}

		return CharacterSheetClassUtils._filterUndefinedKeys(snapshot);
	}

	/**
	 * Remove `type: "options"` entries from an entries array (shallow).
	 * Used to prevent player-choice option lists (Specialties, etc.) from being
	 * rendered into feature descriptions, which would cause false modifier
	 * detection from ALL option texts.
	 * @param {Array<*>} entries
	 * @returns {Array<*>} filtered copy (original not mutated)
	 */
	static _stripOptionsEntries (/** @type {*} */ entries) {
		if (!Array.isArray(entries)) return entries;
		return entries
			.filter((/** @type {*} */ e) => !(typeof e === "object" && e?.type === "options"))
			.map((/** @type {*} */ e) => {
				if (typeof e === "object" && Array.isArray(e?.entries)) {
					return {...e, entries: CharacterSheetClassUtils._stripOptionsEntries(e.entries)};
				}
				return e;
			});
	}

	/**
	 * Remove undefined keys from a plain object.
	 * @param {*} obj
	 * @returns {*}
	 */
	static _filterUndefinedKeys (/** @type {*} */ obj) {
		return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
	}

	/**
	 * True iff the given lowercased feature name is an Ability Score
	 * Improvement placeholder. Uses substring matching for the spelled-out
	 * variants (covers "Ability Score Improvement (4)", etc.) and an exact
	 * match for the "asi" abbreviation. The exact match is critical:
	 * a naive `includes("asi")` check incorrectly matches "ev**asi**on",
	 * "stasis", "persuasion", etc., which silently filtered out the actual
	 * Evasion class feature when leveling Rogue/Monk past 7. See bugs.md
	 * "Evasion not visible as a feature" for the full investigation.
	 *
	 * @param {string} nameLower - Lowercased feature name.
	 * @returns {boolean}
	 */
	static _isAsiPlaceholderName (/** @type {string} */ nameLower) {
		if (!nameLower) return false;
		if (nameLower === "asi") return true;
		if (nameLower.includes("ability score improvement")) return true;
		if (nameLower.includes("ability score increase")) return true;
		return false;
	}

	/**
	 * Dedup features and build state objects for addFeature().
	 * Filters out ASI placeholders, gainSubclassFeature entries, and already-existing features.
	 * @param {Array<*>} features - Raw features for this level
	 * @param {Array<string>} existingFeatureNames - Lowercase names already on the character
	 * @param {object} opts
	 * @param {string} opts.className
	 * @param {string} opts.classSource
	 * @param {number} opts.level
	 * @returns {Array<*>} Array of feature data objects ready for state.addFeature()
	 */
	static dedupAndBuildFeatures (/** @type {*} */ features, /** @type {*} */ existingFeatureNames, {className, classSource, level}) {
		const featuresToAdd = features.filter((/** @type {*} */ f) => {
			if (f.gainSubclassFeature) return false;
			const nameLower = f.name.toLowerCase();
			if (CharacterSheetClassUtils._isAsiPlaceholderName(nameLower)) return false;
			if (!f.isSubclassFeature && !f.subclassName && existingFeatureNames.includes(nameLower)) return false;
			return true;
		});

		return featuresToAdd.map((/** @type {*} */ feature) => CharacterSheetClassUtils.buildFeatureStateObject(feature, {
			className,
			classSource,
			level,
			featureType: "Class",
		}));
	}

	/**
	 * Reconcile `_data.features` against the canonical class+level feature
	 * matrix: for every (class, level) the character has, ensure every feature
	 * that `getLevelFeatures` would produce is present on the character.
	 *
	 * Background: only the level-up wizard ingests features into
	 * `_data.features`. Direct `state.addClass()` / `state.levelUp()` calls
	 * (programmatic edits, save migrations that dropped features, etc.)
	 * compute calculation flags but never push canonical class features.
	 * That leaves users with mechanically-correct passives (e.g. Evasion at
	 * Rogue 7 sets `hasEvasion = true`) but no Features-tab card.
	 *
	 * Idempotent: relies on `state.addFeature`'s built-in dedupe on
	 * (name, source, className, level). Safe to call repeatedly. ASI / sub­
	 * class-feature placeholders / `gainSubclassFeature` markers are
	 * filtered out by `dedupAndBuildFeatures`.
	 *
	 * @param {*} state - CharacterSheetState instance.
	 * @param {object} opts
	 * @param {(name: string, source: string) => *} opts.getClassData -
	 *   Resolver for full class JSON (typically `(n, s) => page.getClasses().find(...)`).
	 * @param {Array<*>} [opts.classFeatures] - Class-features registry
	 *   (typically `page.getClassFeatures()`).
	 * @param {Array<*>} [opts.subclassFeatures] - Subclass-features registry
	 *   (typically `page.getSubclassFeatures()`).
	 * @returns {{added: number, classesProcessed: number}} - Summary for logging/tests.
	 */
	static reconcileClassFeatures (/** @type {*} */ state, {getClassData, classFeatures = [], subclassFeatures = []} = /** @type {*} */ ({})) {
		if (!state || typeof getClassData !== "function") return {added: 0, classesProcessed: 0};

		const classes = state.getClasses?.() || [];
		let added = 0;
		let classesProcessed = 0;

		for (const classEntry of classes) {
			const classData = getClassData(classEntry.name, classEntry.source);
			if (!classData) continue;
			classesProcessed++;

			let fullSubclassData = null;
			if (classEntry.subclass && classData.subclasses) {
				fullSubclassData = classData.subclasses.find((/** @type {*} */ sc) =>
					sc.name === classEntry.subclass.name
					&& (sc.source === classEntry.subclass.source || !classEntry.subclass.source),
				) || null;
			}

			const maxLevel = classEntry.level || 1;
			for (let lvl = 1; lvl <= maxLevel; lvl++) {
				let levelFeatures;
				try {
					levelFeatures = CharacterSheetClassUtils.getLevelFeatures(
						classData,
						lvl,
						fullSubclassData,
						classFeatures,
						subclassFeatures,
					);
				} catch (e) {
					continue;
				}
				if (!levelFeatures?.length) continue;

				// Existing class-feature names for THIS class only — matches the
				// scoping rule used by `_doLevelUp` so multiclass Evasions
				// (Rogue 7 + Monk 7) both survive dedupe.
				const existingForThisClass = (state.getFeatures?.() || [])
					.filter((/** @type {*} */ f) => f.className === classEntry.name && !f.subclassName && !f.isSubclassFeature)
					.map((/** @type {*} */ f) => (f.name || "").toLowerCase());

				const builtFeatures = CharacterSheetClassUtils.dedupAndBuildFeatures(
					levelFeatures,
					existingForThisClass,
					{
						className: classEntry.name,
						classSource: classData.source || classEntry.source,
						level: lvl,
					},
				);

				for (const feature of builtFeatures) {
					const before = state.getFeatures?.().length || 0;
					state.addFeature(feature);
					const after = state.getFeatures?.().length || 0;
					if (after > before) added++;
				}
			}
		}

		return {added, classesProcessed};
	}

	// ==========================================
	// State Mutation Helpers
	// ==========================================

	/**
	 * Resolve the saving-throw proficiencies a feat grants, given the player's choices.
	 *
	 * Half-feats such as Resilient tie their save proficiency to the chosen ability —
	 * the data carries `savingThrowProficiencies: [{choose: {from: [...]}}]` alongside an
	 * `ability: [{choose: {...}}]`, and the convention is that the chosen ability *is* the
	 * save (one pick, implicit tie). This helper also handles pre-resolved formats
	 * (`"con"` strings or `{con: true}` objects) used by other feats.
	 *
	 * @param {*} feat - The feat data
	 * @param {*} [choices] - Resolved feat choices (`{ability}` etc.)
	 * @returns {string[]} De-duped lowercase ability abbreviations to grant a save in
	 */
	static resolveFeatSaveProficiencies (/** @type {*} */ feat, /** @type {*} */ choices = {}) {
		if (!feat || !feat.savingThrowProficiencies) return [];
		const entries = Array.isArray(feat.savingThrowProficiencies)
			? feat.savingThrowProficiencies
			: [feat.savingThrowProficiencies];
		const out = new Set();
		const chosenAbility = choices?.ability && typeof choices.ability === "string"
			? choices.ability.toLowerCase()
			: null;
		for (const entry of entries) {
			if (!entry) continue;
			if (typeof entry === "string") {
				const abbr = entry.toLowerCase();
				if (Parser.ABIL_ABVS.includes(abbr)) out.add(abbr);
				continue;
			}
			if (typeof entry !== "object") continue;
			if (entry.choose) {
				// Tie to the chosen ability (Resilient et al.). Respect a `from` allowlist if present.
				if (!chosenAbility) continue;
				const from = Array.isArray(entry.choose.from)
					? entry.choose.from.map((/** @type {*} */ a) => String(a).toLowerCase())
					: null;
				if (from && !from.includes(chosenAbility)) continue;
				if (Parser.ABIL_ABVS.includes(chosenAbility)) out.add(chosenAbility);
				continue;
			}
			// Pre-resolved object form: {con: true, ...}
			for (const [key, val] of Object.entries(entry)) {
				if (val !== true) continue;
				const abbr = key.toLowerCase();
				if (Parser.ABIL_ABVS.includes(abbr)) out.add(abbr);
			}
		}
		return [...out];
	}

	/**
	 * Apply feat ability/skill/language bonuses to state.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} feat - The feat object
	 * @param {*} [featChoices] - Optional feat choices if not stored on feat._featChoices
	 */
	static applyFeatBonuses (/** @type {*} */ state, /** @type {*} */ feat, /** @type {*} */ featChoices = null) {
		const choices = featChoices || feat._featChoices || {};

		// Apply damage immunities from feat/boon data (e.g., Epic Boons with "immune": ["radiant"])
		if (/** @type {*} */ feat.immune) {
			feat.immune.forEach((/** @type {*} */ type) => {
				state.addImmunity(type);
			});
		}

		// Apply condition immunities from feat/boon data
		if (/** @type {*} */ feat.conditionImmune) {
			feat.conditionImmune.forEach((/** @type {*} */ cond) => {
				const condition = typeof cond === "string" ? cond : cond.conditionImmune;
				if (condition) state.addConditionImmunity(condition);
			});
		}

		const effectiveAbility = CharacterSheetClassUtils.getEffectiveFeatAbility(feat);
		if (/** @type {*} */ effectiveAbility) {
			effectiveAbility.forEach((/** @type {*} */ ablChoice) => {
				const max = ablChoice.max || 20;

				if (/** @type {*} */ ablChoice.choose) {
					// Check for epic boon choice first, then feat choice
					if (/** @type {*} */ feat._epicBoonAbilityChoice) {
						const {ability, amount} = feat._epicBoonAbilityChoice;
						const current = state.getAbilityBase(ability);
						state.setAbilityBase(ability, Math.min(max, current + amount));
					} else if (choices.ability) {
						// Apply chosen ability from feat choices
						const amount = ablChoice.choose.amount || 1;
						const current = state.getAbilityBase(choices.ability);
						state.setAbilityBase(choices.ability, Math.min(max, current + amount));
					}
				} else {
					Object.entries(ablChoice).forEach(([abl, bonus]) => {
						if (abl === "max") return;
						if (Parser.ABIL_ABVS.includes(abl)) {
							const current = state.getAbilityBase(abl);
							state.setAbilityBase(abl, Math.min(max, current + bonus));
						}
					});
				}
			});
		}

		// Apply saving-throw proficiencies (e.g., Resilient — tied to the chosen ability)
		CharacterSheetClassUtils.resolveFeatSaveProficiencies(feat, choices).forEach((/** @type {*} */ abbr) => {
			state.addSaveProficiency(abbr);
		});

		// Apply fixed skill proficiencies from feat data
		if (/** @type {*} */ feat.skillProficiencies) {
			feat.skillProficiencies.forEach((/** @type {*} */ sp) => {
				Object.keys(sp).forEach((/** @type {*} */ skill) => {
					if (/** @type {*} */ skill !== "choose" && skill !== "any") {
						state.addSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""));
					}
				});
			});
		}

		// Apply chosen skill proficiencies
		if (/** @type {*} */ choices.skills?.length) {
			choices.skills.forEach((/** @type {*} */ skill) => {
				state.addSkillProficiency(skill.toLowerCase().replace(/\s+/g, ""));
			});
		}

		// Apply fixed language proficiencies from feat data
		if (/** @type {*} */ feat.languageProficiencies) {
			feat.languageProficiencies.forEach((/** @type {*} */ lp) => {
				Object.keys(lp).forEach((/** @type {*} */ lang) => {
					if (/** @type {*} */ lang !== "anyStandard" && lang !== "any") {
						state.addLanguage(lang);
					}
				});
			});
		}

		// Apply chosen language proficiencies
		if (/** @type {*} */ choices.languages?.length) {
			choices.languages.forEach((/** @type {*} */ lang) => {
				state.addLanguage(lang);
			});
		}

		// Apply fixed tool proficiencies from feat data
		if (/** @type {*} */ feat.toolProficiencies) {
			feat.toolProficiencies.forEach((/** @type {*} */ tp) => {
				Object.keys(tp).forEach((/** @type {*} */ tool) => {
					if (/** @type {*} */ tool !== "anyArtisansTool" && tool !== "any" && tool !== "choose") {
						state.addToolProficiency(tool);
					}
				});
			});
		}

		// Apply chosen tool proficiencies
		if (/** @type {*} */ choices.tools?.length) {
			choices.tools.forEach((/** @type {*} */ tool) => {
				state.addToolProficiency(tool);
			});
		}

		// Apply chosen expertise
		if (/** @type {*} */ choices.expertise?.length) {
			choices.expertise.forEach((/** @type {*} */ skill) => {
				state.addExpertise(skill.toLowerCase().replace(/\s+/g, ""));
			});
		}

		// Apply chosen cantrips
		if (/** @type {*} */ choices.cantrips?.length) {
			choices.cantrips.forEach((/** @type {*} */ cantrip) => {
				// Check if spell is already known before adding
				const existingSpells = state.getSpells?.() || [];
				const existingInnate = state.getInnateSpells?.() || [];
				const alreadyKnown = [...existingSpells, ...existingInnate].some(
					(/** @type {*} */ s) => s.name === cantrip.name && s.source === cantrip.source,
				);
				if (!alreadyKnown) {
					state.addSpell({
						name: cantrip.name,
						source: cantrip.source,
						level: 0,
						fromFeat: feat.name,
					});
				}
			});
		}

		// Apply chosen spells
		if (/** @type {*} */ choices.spells?.length) {
			choices.spells.forEach((/** @type {*} */ spell) => {
				// Check if spell is already known before adding
				const existingSpells = state.getSpells?.() || [];
				const existingInnate = state.getInnateSpells?.() || [];
				const alreadyKnown = [...existingSpells, ...existingInnate].some(
					(/** @type {*} */ s) => s.name === spell.name && s.source === spell.source,
				);
				if (!alreadyKnown) {
					if (/** @type {*} */ spell.innate) {
						state.addInnateSpell({
							name: spell.name,
							source: spell.source,
							level: spell.level,
							daily: spell.daily || "1",
							fromFeat: feat.name,
						});
					} else {
						state.addSpell({
							name: spell.name,
							source: spell.source,
							level: spell.level,
							fromFeat: feat.name,
						});
					}
				}
			});
		}
	}

	/**
	 * Update hit dice tracking after gaining a level.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} classData
	 */
	static updateHitDice (/** @type {*} */ state, /** @type {*} */ classData) {
		// Reconcile the per-die-type pools from the current class levels rather
		// than incrementing by one. `recalculateHitDice()` derives `max` from the
		// class levels and preserves spent dice, and is idempotent — so when a
		// new multiclass is introduced via `state.addClass()` (which already
		// recalculates), calling this afterwards no longer double-counts the new
		// class's first Hit Die. `classData` is unused (kept for call-site compat).
		if (typeof state.recalculateHitDice === "function") {
			state.recalculateHitDice();
			return;
		}

		// Fallback for older state objects without the canonical recalc.
		const hitDie = `d${CharacterSheetClassUtils.getClassHitDie(classData)}`;
		const hitDice = state.getHitDiceByType();

		if (!hitDice[hitDie]) {
			hitDice[hitDie] = {current: 1, max: 1};
		} else {
			hitDice[hitDie].max += 1;
			hitDice[hitDie].current += 1;
		}

		state.setHitDice(hitDice);
	}

	/**
	 * Update class resources (Rage, Ki, Sorcery Points, etc.) after leveling up.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} classEntry - Class entry from state {name, source}
	 * @param {number} newLevel - New class level
	 * @param {*} classData - Full class data
	 */
	static updateClassResources (/** @type {*} */ state, /** @type {*} */ classEntry, /** @type {*} */ newLevel, /** @type {*} */ classData) {
		const resourceDefs = {
			"Barbarian": [
				{name: "Rage", maxByLevel: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 999], recharge: "long"},
			],
			"Monk": [
				{name: "__MONK_RESOURCE__", maxByLevel: (/** @type {*} */ lvl) => lvl >= 2 ? lvl : 0, recharge: "short"},
			],
			"Sorcerer": [
				{name: "Sorcery Points",
					maxByLevel: (/** @type {*} */ lvl) => {
						const isTGTT = classEntry.source === "TGTT" || classData.source === "TGTT";
						// TGTT Sorcerer grants Font of Magic at L1 (not L2 like XPHB),
						// so SP = sorcerer level from L1 onward. Was previously
						// `lvl + 1` (CS-BUG-018: off-by-one — L1=2/L3=4 instead of 1/3).
						if (isTGTT) return lvl;
						return lvl >= 2 ? lvl : 0;
					},
					recharge: "long"},
			],
			"Paladin": [
				{name: "Lay on Hands", maxByLevel: (/** @type {*} */ lvl) => lvl * 5, recharge: "long"},
			],
			"Bard": [
				{name: "Bardic Inspiration", maxByLevel: () => Math.max(1, state.getAbilityMod("cha")), recharge: newLevel >= 5 ? "short" : "long"},
			],
			"Rogue": [
				// CS-BUG-012: TGTT Trickster subclass grants Trickster Dice at L3
				// (4 dice), L9 (5), L13 (6), L17 (7). Recharges on short or long
				// rest. The feature is declared in homebrew JSON as prose only,
				// so we register the resource here when the active subclass is
				// Trickster (TGTT).
				{name: "Trickster Dice",
					maxByLevel: (/** @type {*} */ lvl) => {
						const isTrickster = (classEntry.subclass?.name === "Trickster" || classEntry.subclass?.shortName === "Trickster")
							&& (classEntry.subclass?.source === "TGTT");
						if (!isTrickster) return 0;
						if (lvl >= 17) return 7;
						if (lvl >= 13) return 6;
						if (lvl >= 9) return 5;
						if (lvl >= 3) return 4;
						return 0;
					},
					recharge: "short"},
			],
		};

		const classResourceDefs = (/** @type {*} */ (resourceDefs))[classData.name];
		if (!classResourceDefs) {
			state.recalculateResourceMaximums();
			return;
		}

		const currentResources = state.getResources();

		classResourceDefs.forEach((/** @type {*} */ resourceDef) => {
			let resourceName = resourceDef.name;
			if (/** @type {*} */ resourceName === "__MONK_RESOURCE__") {
				resourceName = "Focus Points";
			}

			let newMax;
			if (/** @type {*} */ typeof resourceDef.maxByLevel === "function") {
				newMax = resourceDef.maxByLevel(newLevel);
			} else if (Array.isArray(resourceDef.maxByLevel)) {
				newMax = resourceDef.maxByLevel[newLevel - 1] || 0;
			} else {
				newMax = resourceDef.maxByLevel;
			}

			const isMonkResource = resourceName === "Ki Points" || resourceName === "Focus Points";
			let existingResource;
			if (/** @type {*} */ isMonkResource) {
				existingResource = currentResources.find((/** @type {*} */ r) => r.name === "Ki Points" || r.name === "Focus Points");
			} else {
				existingResource = currentResources.find((/** @type {*} */ r) => r.name === resourceName);
			}

			if (/** @type {*} */ existingResource) {
				const oldMax = existingResource.max;
				if (/** @type {*} */ newMax > oldMax) {
					existingResource.max = newMax;
					existingResource.current += (newMax - oldMax);
				}
				// CS-BUG-008: keep recharge in sync with the resourceDef on every
				// level-up. Bardic Inspiration in particular flips long → short at
				// Bard L5 (Font of Inspiration); without this the resource carries
				// the L1–L4 "long" recharge forever.
				if (resourceDef.recharge && existingResource.recharge !== resourceDef.recharge) {
					existingResource.recharge = resourceDef.recharge;
				}
			} else if (newMax > 0) {
				state.addResource({
					name: resourceName,
					max: newMax,
					current: newMax,
					recharge: resourceDef.recharge,
				});
			}
		});

		state.recalculateResourceMaximums();
	}

	/**
	 * Update spell slots after leveling up.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} classEntry - Class entry from state
	 * @param {number} newLevel - New class level
	 * @param {*} classData - Full class data
	 */
	static updateSpellSlots (/** @type {*} */ state, /** @type {*} */ classEntry, /** @type {*} */ newLevel, /** @type {*} */ classData) {
		const spellcastingAbility = CharacterSheetClassUtils.getSpellcastingAbility(classData);
		if (!spellcastingAbility) return;

		const classes = state.getClasses();
		const isMulticlass = classes.length > 1;

		if (/** @type {*} */ isMulticlass) {
			state.calculateSpellSlots();
		} else {
			const slots = CharacterSheetClassUtils.getSpellSlotsForLevel(classData, newLevel);

			const spellcasting = state.getSpellcasting();
			spellcasting.ability = spellcastingAbility;

			Object.entries(slots).forEach(([level, count]) => {
				if (!spellcasting.spellSlots[level]) {
					spellcasting.spellSlots[level] = {current: count, max: count};
				} else {
					const diff = count - spellcasting.spellSlots[level].max;
					if (/** @type {*} */ diff > 0) {
						spellcasting.spellSlots[level].max = count;
						spellcasting.spellSlots[level].current += diff;
					}
				}
			});
		}
	}

	/**
	 * Get the spell slot table for a class at a given level.
	 * @param {*} classData
	 * @param {number} level
	 * @returns {*} Map of spell level → slot count
	 */
	static getSpellSlotsForLevel (/** @type {*} */ classData, /** @type {*} */ level) {
		const fullCasterSlots = {
			1: {1: 2},
			2: {1: 3},
			3: {1: 4, 2: 2},
			4: {1: 4, 2: 3},
			5: {1: 4, 2: 3, 3: 2},
			6: {1: 4, 2: 3, 3: 3},
			7: {1: 4, 2: 3, 3: 3, 4: 1},
			8: {1: 4, 2: 3, 3: 3, 4: 2},
			9: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			10: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
			11: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1},
			12: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1},
			13: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1},
			14: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1},
			15: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1},
			16: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1},
			17: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1},
			18: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1, 7: 1, 8: 1, 9: 1},
			19: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 1, 8: 1, 9: 1},
			20: {1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1},
		};

		const halfCasterSlots = {
			2: {1: 2},
			3: {1: 3},
			4: {1: 3},
			5: {1: 4, 2: 2},
			6: {1: 4, 2: 2},
			7: {1: 4, 2: 3},
			8: {1: 4, 2: 3},
			9: {1: 4, 2: 3, 3: 2},
			10: {1: 4, 2: 3, 3: 2},
			11: {1: 4, 2: 3, 3: 3},
			12: {1: 4, 2: 3, 3: 3},
			13: {1: 4, 2: 3, 3: 3, 4: 1},
			14: {1: 4, 2: 3, 3: 3, 4: 1},
			15: {1: 4, 2: 3, 3: 3, 4: 2},
			16: {1: 4, 2: 3, 3: 3, 4: 2},
			17: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			18: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			19: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
			20: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
		};

		const fullCasters = ["Wizard", "Sorcerer", "Cleric", "Druid", "Bard"];
		const halfCasters = ["Paladin", "Ranger"];

		if (fullCasters.includes(classData.name)) return (/** @type {*} */ (fullCasterSlots))[level] || {};
		if (halfCasters.includes(classData.name)) return (/** @type {*} */ (halfCasterSlots))[level] || {};
		return {};
	}

	/**
	 * Check for and add racial spells at the current character level.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} page - CharacterSheetPage instance (for getSpells)
	 */
	static updateRacialSpells (/** @type {*} */ state, /** @type {*} */ page) {
		const race = state.getRace();
		if (!race?.additionalSpells?.length) return;

		const totalLevel = state.getTotalLevel();
		const allSpells = page.getSpells();
		const raceName = race.name;
		const subraceName = race._subraceName || race.subrace;

		race.additionalSpells.forEach((/** @type {*} */ spellBlock) => {
			if (/** @type {*} */ spellBlock.name) {
				if (!subraceName || spellBlock.name.toLowerCase() !== subraceName.toLowerCase()) return;
			}

			if (/** @type {*} */ spellBlock.known) {
				Object.entries(spellBlock.known).forEach(([levelStr, spellsAtLevel]) => {
					const charLevel = parseInt(levelStr);
					if (charLevel !== totalLevel) return;
					CharacterSheetClassUtils._processRacialSpellList(state, spellsAtLevel, allSpells, raceName);
				});
			}

			if (/** @type {*} */ spellBlock.innate) {
				Object.entries(spellBlock.innate).forEach(([levelStr, spellConfig]) => {
					const charLevel = parseInt(levelStr);
					if (charLevel !== totalLevel) return;

					if (/** @type {*} */ typeof spellConfig === "object") {
						if (/** @type {*} */ spellConfig.daily) {
							Object.entries(spellConfig.daily).forEach(([uses, spellList]) => {
								CharacterSheetClassUtils._processRacialInnateSpells(state, spellList, allSpells, raceName, parseInt(uses), "long");
							});
						}
						if (/** @type {*} */ spellConfig.rest) {
							Object.entries(spellConfig.rest).forEach(([uses, spellList]) => {
								CharacterSheetClassUtils._processRacialInnateSpells(state, spellList, allSpells, raceName, parseInt(uses), "short");
							});
						}
						if (Array.isArray(spellConfig)) {
							CharacterSheetClassUtils._processRacialInnateSpells(state, spellConfig, allSpells, raceName, 0, null);
						}
					} else if (Array.isArray(spellConfig)) {
						CharacterSheetClassUtils._processRacialInnateSpells(state, spellConfig, allSpells, raceName, 0, null);
					}
				});
			}
		});
	}

	/** @private */
	static _processRacialSpellList (/** @type {*} */ state, /** @type {*} */ spellList, /** @type {*} */ allSpells, /** @type {*} */ sourceName) {
		if (!Array.isArray(spellList)) {
			if (/** @type {*} */ typeof spellList === "object" && spellList._) {
				CharacterSheetClassUtils._processRacialSpellList(state, spellList._, allSpells, sourceName);
			}
			return;
		}

		spellList.forEach((/** @type {*} */ spellRef) => {
			const spellData = CharacterSheetClassUtils._resolveSpellReference(spellRef, allSpells);
			if (/** @type {*} */ spellData) {
				const existing = state.getSpells().find((/** @type {*} */ s) =>
					s.name === spellData.name && s.source === spellData.source,
				);
				if (existing) return;

				state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spellData, {
					sourceFeature: sourceName,
					sourceClass: "",
					prepared: spellData.level === 0,
				}));
			}
		});
	}

	/** @private */
	static _processRacialInnateSpells (/** @type {*} */ state, /** @type {*} */ spellList, /** @type {*} */ allSpells, /** @type {*} */ sourceName, /** @type {*} */ uses, /** @type {*} */ recharge) {
		if (!Array.isArray(spellList)) return;

		spellList.forEach((/** @type {*} */ spellRef) => {
			const spellData = CharacterSheetClassUtils._resolveSpellReference(spellRef, allSpells);
			if (/** @type {*} */ spellData) {
				const existing = state.getInnateSpells().find((/** @type {*} */ s) =>
					s.name === spellData.name && s.source === spellData.source,
				);
				if (existing) return;

				const atWill = uses === 0;
				state.addInnateSpell({
					name: spellData.name,
					source: spellData.source,
					level: spellData.level,
					atWill,
					uses: atWill ? null : uses,
					recharge,
					sourceFeature: sourceName,
				});
			}
		});
	}

	/** @private */
	static _resolveSpellReference (/** @type {*} */ spellRef, /** @type {*} */ allSpells) {
		if (typeof spellRef !== "string") return null;

		let spellName = spellRef.replace(/#c$/, "");
		let source = null;

		const parts = spellName.split("|");
		spellName = parts[0].toLowerCase();
		if (parts.length > 1) source = parts[1].toUpperCase();

		return allSpells.find((/** @type {*} */ s) => {
			const nameMatch = s.name.toLowerCase() === spellName;
			if (!nameMatch) return false;
			if (source) return s.source === source;
			return true;
		});
	}

	// ------------------------------------------------------------------
	// Optional Feature Progression
	// ------------------------------------------------------------------

	/**
	 * Detect whether an optional feature is repeatable based on its entries.
	 * @param {object} opt - Optional feature data
	 * @returns {boolean}
	 */
	static isOptionalFeatureRepeatable (/** @type {*} */ opt) {
		if (!opt?.entries) return false;
		const checkEntries = (/** @type {*} */ entries) => {
			for (/** @type {*} */ const entry of entries) {
				if (typeof entry === "string" && entry.toLowerCase().includes("repeatable")) return true;
				if (entry?.name?.toLowerCase().includes("repeatable")) return true;
				if (entry?.entries && checkEntries(entry.entries)) return true;
			}
			return false;
		};
		return checkEntries(opt.entries);
	}

	/**
	 * Filter and annotate optional features eligible for selection given a feature-type
	 * progression slot. Shared by builder (level 1 / first selection) and level-up (any
	 * subsequent gain) so prerequisite + repeatable handling stays in one place.
	 *
	 * @param {Array<*>} allOptFeatures - All available optional features (already deduped by edition)
	 * @param {object} opts
	 * @param {string[]} opts.featureTypes - Feature type codes for this slot (e.g. ["EI"], ["MM"])
	 * @param {object} opts.prereqContext - Context for {@link checkPrerequisites}
	 * @param {Array<*>}  [opts.alreadyKnown=[]] - Optional features the character already has
	 *                                          (each with {name, source}); used for repeatable
	 *                                          handling and "Known" badge.
	 * @returns {Array<*>} Array of options, each annotated with:
	 *   `_meetsPrereqs`, `_prereqReasons`, `_alreadyKnown`, `_timesKnown`,
	 *   `_repeatable`, `_selectable`.
	 */
	static getEligibleOptionalFeatures (/** @type {*} */ allOptFeatures, {featureTypes, prereqContext, alreadyKnown = /** @type {*[]} */ ([])} = /** @type {*} */ ({})) {
		if (!allOptFeatures?.length || !featureTypes?.length) return [];

		const matchesFeatureType = (/** @type {*} */ optFeatTypes) => {
			return optFeatTypes?.some((/** @type {*} */ ft) =>
				featureTypes.some((/** @type {*} */ progType) => ft === progType || ft.startsWith(progType)),
			);
		};

		return allOptFeatures
			.filter((/** @type {*} */ opt) => matchesFeatureType(opt.featureType))
			.map((/** @type {*} */ opt) => {
				const {met, reasons} = CharacterSheetClassUtils.checkPrerequisites(opt.prerequisite, prereqContext || {});
				const timesKnown = alreadyKnown.filter(
					(/** @type {*} */ existing) => existing.name === opt.name && existing.source === opt.source,
				).length;
				const alreadyHas = timesKnown > 0;
				const repeatable = CharacterSheetClassUtils.isOptionalFeatureRepeatable(opt);
				const selectable = met && (!alreadyHas || repeatable);
				return {
					...opt,
					_meetsPrereqs: met,
					_prereqReasons: reasons,
					_alreadyKnown: alreadyHas,
					_timesKnown: timesKnown,
					_repeatable: repeatable,
					_selectable: selectable,
				};
			});
	}

	/**
	 * Parse a feat's optionalfeatureProgression into picker specs.
	 * @param {*} feat
	 * @returns {Array<*>|null}
	 */
	static getFeatOptionalFeatureChoiceSpec (/** @type {*} */ feat) {
		if (!feat?.optionalfeatureProgression?.length) return null;

		const specs = feat.optionalfeatureProgression
			.map((/** @type {*} */ prog) => {
				const featureTypes = prog.featureType || [];
				if (!featureTypes.length) return null;

				let count = 0;
				if (Array.isArray(prog.progression)) {
					count = prog.progression[0] || 0;
				} else if (typeof prog.progression === "object") {
					count = prog.progression["1"] || prog.progression["*"] || 0;
				}

				if (!count) return null;

				return {
					name: prog.name || featureTypes.join(", "),
					count,
					featureTypes,
				};
			})
			.filter(Boolean);

		return specs.length ? specs : null;
	}

	/**
	 * Get feat optional-feature options from the current optional-feature pool.
	 * @param {Array<*>} allOptFeatures
	 * @param {object} [opts]
	 * @param {string[]} [opts.featureTypes]
	 * @param {object} [opts.prereqContext]
	 * @param {Array<*>} [opts.alreadyKnown]
	 * @returns {Array<*>}
	 */
	static getFeatOptionalFeatureOptions (/** @type {*} */ allOptFeatures, {featureTypes, prereqContext = {}, alreadyKnown = []} = {}) {
		return CharacterSheetClassUtils.getEligibleOptionalFeatures(allOptFeatures, {
			featureTypes,
			prereqContext,
			alreadyKnown,
		});
	}

	// ==========================================
	// featProgression on optional features
	// (e.g. Lessons of the First Ones — invocation that grants an Origin feat)
	// ==========================================

	/**
	 * Get feat-progression picks for an optional feature, evaluated against how many
	 * times the user has already picked this same feature (1-based — 1 = first time).
	 *
	 * Each picked invocation/maneuver/etc. independently gets the picks listed by its
	 * `progression` map. A `"*"` key always triggers. Numeric keys match exact pick
	 * counts. The returned `count` is the number of feats the user must choose for
	 * that progression entry on THIS selection.
	 *
	 * @param {object} opt - The optional feature (must have `featProgression` to return anything)
	 * @param {number} [timesPicked=1] - 1-based count of how many times this opt has now been chosen
	 * @returns {Array<{progressionName: string, category: string[], count: number}>}
	 */
	static getOptFeatureFeatProgressionPicks (/** @type {*} */ opt, /** @type {*} */ timesPicked = 1) {
		if (!opt?.featProgression?.length) return [];
		/** @type {*[]} */ const out = [];
		for (const prog of opt.featProgression) {
			const map = prog.progression;
			if (!map || typeof map !== "object") continue;

			let count = 0;
			if (map["*"] != null) {
				count = Number(map["*"]) || 0;
			} else {
				const key = String(timesPicked);
				if (map[key] != null) count = Number(map[key]) || 0;
			}

			if (count > 0) {
				out.push({
					progressionName: prog.name || "Feat",
					category: Array.isArray(prog.category) ? [...prog.category] : [],
					count,
				});
			}
		}
		return out;
	}

	/**
	 * Filter the full feats list by category codes (e.g. ["O"] for Origin, ["EB"] for
	 * Epic Boon, ["G"] for General). Feats without a category are excluded unless
	 * `categories` is empty (in which case the input is returned unfiltered).
	 *
	 * Sub-typed categories like `FS:P` (Fighting Style: Paladin) match the bare base
	 * code (`FS`) — both the exact code and the `<code>:*` prefix form are accepted
	 * so callers can either request the whole family or a specific subtype.
	 *
	 * @param {Array<*>} feats - The pool of feats to filter
	 * @param {Array<string>} categories - Category codes to allow
	 * @returns {Array<*>} Filtered feats
	 */
	static filterFeatsByCategory (/** @type {*} */ feats, /** @type {*} */ categories) {
		if (!Array.isArray(feats)) return [];
		if (!Array.isArray(categories) || !categories.length) return feats;
		const allowed = new Set(categories);
		return feats.filter((/** @type {*} */ f) => {
			if (!f?.category) return false;
			if (allowed.has(f.category)) return true;
			// FS:P matches FS, EB:foo matches EB, etc.
			const colon = f.category.indexOf(":");
			if (colon > 0 && allowed.has(f.category.slice(0, colon))) return true;
			return false;
		});
	}

	/**
	 * Whether a feat already grants an ability score increase (fixed or "choose").
	 * Used to decide whether an uncategorized feat should receive a synthesized
	 * General-feat +1 ASI (we never double-grant on feats that already have one).
	 *
	 * @param {*} feat - The feat data
	 * @returns {boolean} true iff `feat.ability` carries at least one real ASI grant
	 */
	static featHasAbilityGrant (/** @type {*} */ feat) {
		if (!feat || !Array.isArray(feat.ability) || !feat.ability.length) return false;
		return feat.ability.some((/** @type {*} */ ab) => {
			if (!ab || typeof ab !== "object") return false;
			if (ab.choose) return true;
			return Object.keys(ab).some((/** @type {*} */ k) => k !== "max" && Parser.ABIL_ABVS.includes(k));
		});
	}

	/**
	 * Whether a feat should be treated as a General feat that grants a +1 ASI.
	 *
	 * Modern (2024) feats carry a `category` (Origin / General / Fighting Style /
	 * Epic Boon) and General feats grant a +1 ability score increase. Some
	 * partnered / homebrew feats (e.g. Humblewood's Plantmender) omit both the
	 * `category` and the `ability` grant entirely. Per the design rule, a feat
	 * with no category that does not already grant an ASI is treated as a General
	 * feat and grants a +1 increase to an ability of the player's choice.
	 *
	 * Guarded by `!feat.reprintedAs` so superseded legacy 2014 feats (Alert,
	 * Lucky, Tough, …) — which are category-less and ASI-less but carry a
	 * `reprintedAs` pointer to their 2024 replacement — are NOT retroactively
	 * buffed.
	 *
	 * @param {*} feat - The feat data
	 * @returns {boolean}
	 */
	static featDefaultsToGeneralAsi (/** @type {*} */ feat) {
		return !!feat
			&& typeof feat === "object"
			&& !feat.category
			&& !feat.reprintedAs
			&& !CharacterSheetClassUtils.featHasAbilityGrant(feat);
	}

	/**
	 * Resolve the effective `ability` array for a feat, synthesizing a
	 * "+1 to one ability of your choice" grant for uncategorized feats that
	 * default to General (see {@link featDefaultsToGeneralAsi}). Feats that
	 * already declare an ASI — or that carry a category — pass through unchanged.
	 *
	 * Returning the same `[{choose:{from,amount,count}}]` shape used by real
	 * half-feats means every downstream picker / applier / validator handles
	 * synthesized grants identically with no special-casing.
	 *
	 * @param {*} feat - The feat data
	 * @returns {*} The effective ability array (may be `feat.ability`/undefined)
	 */
	static getEffectiveFeatAbility (/** @type {*} */ feat) {
		if (CharacterSheetClassUtils.featHasAbilityGrant(feat)) return feat.ability;
		if (CharacterSheetClassUtils.featDefaultsToGeneralAsi(feat)) {
			return [{
				choose: {
					from: Parser.ABIL_ABVS,
					amount: 1,
					count: 1,
					entry: "Increase one ability score of your choice by 1, to a maximum of 20.",
				},
			}];
		}
		return feat.ability;
	}

	/**
	 * Build the "feat choices spec" describing every sub-choice a feat presents
	 * (skill / language / tool / expertise / ability / optionalFeature / spell choices).
	 * Pure helper — takes a context object so it can be reused from level-up, the
	 * builder, and quickbuild without inheriting their `this`.
	 *
	 * @param {object} feat - The feat data
	 * @param {object} ctx - Context for evaluating optional-feature progressions
	 * @param {object} [ctx.state] - CharacterSheetState (optional)
	 * @param {object} [ctx.page] - CharacterSheetPage (for filterByAllowedSources / getOptionalFeatures)
	 * @returns {*} Choices spec object (always returns an object; fields may be null)
	 */
	static buildFeatChoicesSpec (/** @type {*} */ feat, /** @type {*} */ ctx = {}) {
		/** @type {*} */ const choices = {skills: null, languages: null, tools: null, ability: null, expertise: null, spells: null, optionalFeatures: null};
		if (!feat || typeof feat !== "object") return choices;

		// Skills
		if (Array.isArray(feat.skillProficiencies)) {
			for (const sp of feat.skillProficiencies) {
				if (sp?.choose) {
					choices.skills = {count: sp.choose.count || 1, from: sp.choose.from || Object.keys(Parser.SKILL_TO_ATB_ABV)};
					break;
				}
				if (sp?.any) {
					choices.skills = {count: sp.any, from: Object.keys(Parser.SKILL_TO_ATB_ABV)};
					break;
				}
			}
		}

		// Languages
		if (Array.isArray(feat.languageProficiencies)) {
			for (const lp of feat.languageProficiencies) {
				if (lp?.anyStandard) { choices.languages = {count: lp.anyStandard, type: "standard"}; break; }
				if (lp?.any) { choices.languages = {count: lp.any, type: "any"}; break; }
			}
		}

		// Tools
		if (Array.isArray(feat.toolProficiencies)) {
			for (const tp of feat.toolProficiencies) {
				if (tp?.anyArtisansTool && tp?.anyMusicalInstrument) {
					choices.tools = {count: tp.anyArtisansTool, type: "artisanOrInstrument"};
					break;
				}
				if (tp?.anyArtisansTool) { choices.tools = {count: tp.anyArtisansTool, type: "artisan"}; break; }
				if (tp?.anyMusicalInstrument) { choices.tools = {count: tp.anyMusicalInstrument, type: "instrument"}; break; }
				if (tp?.any) { choices.tools = {count: tp.any, type: "any"}; break; }
				if (tp?.choose) { choices.tools = {count: tp.choose.count || 1, from: tp.choose.from || []}; break; }
			}
			if (!choices.tools) {
				const hasArtisan = feat.toolProficiencies.some((/** @type {*} */ tp) => tp?.anyArtisansTool);
				const hasInstrument = feat.toolProficiencies.some((/** @type {*} */ tp) => tp?.anyMusicalInstrument);
				if (hasArtisan && hasInstrument) choices.tools = {count: 1, type: "artisanOrInstrument"};
			}
		}

		// Expertise
		if (Array.isArray(feat.expertise)) {
			for (const exp of feat.expertise) {
				if (exp?.anyProficientSkill) { choices.expertise = {count: exp.anyProficientSkill, type: "proficient"}; break; }
				if (exp?.choose) { choices.expertise = {count: exp.choose.count || 1, from: exp.choose.from || []}; break; }
			}
		}

		// Ability score increases (choose from) — uses the effective ability array so
		// uncategorized feats that default to General surface a +1 ASI picker.
		const effectiveAbility = CharacterSheetClassUtils.getEffectiveFeatAbility(feat);
		if (Array.isArray(effectiveAbility)) {
			for (const ab of effectiveAbility) {
				if (ab?.choose) {
					choices.ability = {count: ab.choose.count || 1, amount: ab.choose.amount || 1, from: ab.choose.from || Parser.ABIL_ABVS};
					break;
				}
			}
		}

		// Optional-feature picks (Eldritch Adept etc.) — only available when ctx has state+page
		const featOptSpecs = CharacterSheetClassUtils.getFeatOptionalFeatureChoiceSpec(feat);
		if (featOptSpecs?.length && ctx?.page && ctx?.state) {
			try {
				const allOptFeaturesRaw = ctx.page.filterByAllowedSources(ctx.page.getOptionalFeatures?.() || []);
				const settings = ctx.state.getSettings?.() || {};
				const showAll = !!settings.showAllOptFeatureVersions;
				const enableTgtt = !!settings.enableTgtt;
				const dedupedOptFeatures = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(allOptFeaturesRaw, {showAll});
				const allOptFeatures = CharacterSheetClassUtils.filterOptFeaturesForTgttMetamagic(dedupedOptFeatures, {enableTgtt});
				const alreadyKnown = (ctx.state.getFeatures?.() || []).filter((/** @type {*} */ f) => f.featureType === "Optional Feature");
				const prereqContext = {
					classes: ctx.state.getClasses?.() || [],
					totalLevel: ctx.state.getTotalLevel?.() || 0,
					existingFeatures: alreadyKnown,
					cantrips: ctx.state.getCantripsKnown?.() || [],
					spells: ctx.state.getSpellsKnown?.() || [],
				};
				choices.optionalFeatures = featOptSpecs.map((/** @type {*} */ spec) => ({
					...spec,
					available: CharacterSheetClassUtils.getFeatOptionalFeatureOptions(allOptFeatures, {
						featureTypes: spec.featureTypes,
						prereqContext,
						alreadyKnown,
					}),
				}));
			} catch (e) {
				// Defensive — if ctx is incomplete, skip optional-feature picks gracefully
				choices.optionalFeatures = null;
			}
		}

		// Spells (Magic Initiate–style + additionalSpells choose entries)
		if (Array.isArray(feat.additionalSpells)) {
			/** @type {*} */ const spellChoices = {cantrips: null, spells: null, list: null};
			for (const addSpells of feat.additionalSpells) {
				if (addSpells?.name && addSpells?.ability) {
					spellChoices.list = {name: addSpells.name, ability: addSpells.ability};
				}
				const parseSpellBlock = (/** @type {*} */ block, /** @type {*} */ target) => {
					if (!block) return;
					for (const [key, val] of Object.entries(block)) {
						if (key === "_" || key === "daily" || key === "rest") {
							const spells = key === "_" ? val : (val?.["1e"] || val?.["1"] || Object.values(val || {})[0] || []);
							if (Array.isArray(spells)) {
								for (const spell of spells) {
									if (spell && typeof spell === "object" && spell.choose && typeof spell.choose === "string") {
										const filter = spell.choose;
										const count = spell.count || 1;
										const maxLevel = filter.match(/level=(\d+)/)?.[1];
										if (maxLevel === "0" || filter.includes("level=0")) {
											spellChoices.cantrips = {count, filter};
										} else {
											spellChoices.spells = {
												count,
												filter,
												innate: target === "innate",
												daily: key === "daily" ? "1" : null,
											};
										}
									}
								}
							}
						}
					}
				};
				parseSpellBlock(addSpells.innate, "innate");
				parseSpellBlock(addSpells.known, "known");
				parseSpellBlock(addSpells.prepared, "prepared");
			}
			if (spellChoices.cantrips || spellChoices.spells || spellChoices.list) choices.spells = spellChoices;
		}

		return choices;
	}

	/**
	 * Validate that all required sub-choices on a feat have been filled in.
	 * Apply-button gate for Bug 8 feat-progression picks.
	 *
	 * @param {object} feat - The feat (after `_featChoices` mutation by the picker UI)
	 * @param {object} [spec] - Optional pre-built spec; built from feat+ctx if omitted
	 * @param {object} [ctx] - Context passed to buildFeatChoicesSpec if spec absent
	 * @returns {boolean} true iff every required choice has been picked
	 */
	static isFeatChoiceSpecComplete (/** @type {*} */ feat, /** @type {*} */ spec = null, /** @type {*} */ ctx = {}) {
		if (!feat || typeof feat !== "object") return true;
		const sp = spec || CharacterSheetClassUtils.buildFeatChoicesSpec(feat, ctx);
		const fc = feat._featChoices || {};

		if (sp.skills && (!Array.isArray(fc.skills) || fc.skills.length < sp.skills.count)) return false;
		if (sp.languages && (!Array.isArray(fc.languages) || fc.languages.length < sp.languages.count)) return false;
		if (sp.tools && (!Array.isArray(fc.tools) || fc.tools.length < sp.tools.count)) return false;
		if (sp.expertise && (!Array.isArray(fc.expertise) || fc.expertise.length < sp.expertise.count)) return false;
		if (sp.ability) {
			const picked = fc.ability && typeof fc.ability === "object" ? Object.keys(fc.ability).length : 0;
			if (picked < sp.ability.count) return false;
		}
		if (Array.isArray(sp.optionalFeatures) && sp.optionalFeatures.length) {
			const picks = Array.isArray(fc.optionalFeatures) ? fc.optionalFeatures : [];
			for (const optSpec of sp.optionalFeatures) {
				const match = picks.find((/** @type {*} */ p) => p?.featureName === optSpec.name) || picks.find((/** @type {*} */ p) => p?.specIndex === sp.optionalFeatures.indexOf(optSpec));
				if (!match || !Array.isArray(match.picks) || match.picks.length < (optSpec.count || 1)) return false;
			}
		}
		if (sp.spells) {
			if (sp.spells.list && !fc.scribingClass) return false;
			if (sp.spells.cantrips && (!Array.isArray(fc.cantrips) || fc.cantrips.length < sp.spells.cantrips.count)) return false;
			if (sp.spells.spells && (!Array.isArray(fc.spells) || fc.spells.length < sp.spells.spells.count)) return false;
		}
		return true;
	}

	/**
	 * Did the inline feat spell picker (LevelUp / QuickBuild / Builder) actually collect
	 * spell or cantrip choices for this feat? When true, those flows should pass
	 * `skipAdditionalSpellChoices` to `addFeat` so the pending-choice pipeline doesn't
	 * re-prompt for the same `additionalSpells` choices (double-grant). When false (e.g.
	 * respec / optional-feature / fallback paths where the picker never ran), the flag must
	 * NOT be passed, or the chosen spells would be silently dropped.
	 *
	 * @param {object} feat - The feat (with inline picks on `_featChoices` and/or `choices`)
	 * @returns {boolean}
	 */
	static hasCollectedInlineSpellChoices (/** @type {*} */ feat) {
		if (!feat || typeof feat !== "object") return false;
		const sources = [feat.choices, feat._featChoices];
		return sources.some((/** @type {*} */ src) =>
			!!src && ((Array.isArray(src.spells) && src.spells.length > 0)
				|| (Array.isArray(src.cantrips) && src.cantrips.length > 0)),
		);
	}

	/**
	 * Read the cumulative count granted by an optionalfeature progression at a given
	 * level. Object progressions are keyed by threshold level (e.g. {3:2,7:3,10:4}); we
	 * resolve to the highest threshold key <= level so jump/rebuild paths (0->8, 3->10)
	 * are correct, not just single-level transitions.
	 * @param {*} progression
	 * @param {number} level
	 * @returns {number}
	 */
	static _readOptFeatureProgressionCount (/** @type {*} */ progression, /** @type {*} */ level) {
		if (Array.isArray(progression)) return progression[level - 1] || 0;
		if (progression && typeof progression === "object") {
			let bestLevel = 0;
			let count = 0;
			for (const [lvlStr, c] of Object.entries(progression)) {
				const lvl = parseInt(lvlStr);
				if (!Number.isNaN(lvl) && lvl <= level && lvl > bestLevel) {
					bestLevel = lvl;
					count = /** @type {*} */ (c);
				}
			}
			return count;
		}
		return 0;
	}

	/**
	 * Compute optional feature gains between currentLevel and newLevel.
	 *
	 * Reads both the CLASS-level `optionalfeatureProgression` and the active subclass's
	 * progression (e.g. Arcane Archer "AS", Battle Master "MV:B"). A subclass progression
	 * is merged only when its featureType set does NOT intersect any class-level
	 * progression featureType — this prevents miscounting shared types (e.g. Champion's
	 * subclass "FS:F" vs the Fighter class "FS:F", where a shared global count would
	 * cancel the gain). CTM:* (TGTT combat methods) are skipped here; they are augmented
	 * separately by the bonus-method path.
	 *
	 * @param {object} classData - The class data object
	 * @param {number} currentLevel - Previous class level
	 * @param {number} newLevel - New class level
	 * @param {object} state - Character state (needs getFeatures())
	 * @param {object} [subclassData] - Resolved full subclass data (with optionalfeatureProgression)
	 * @returns {Array<*>} Array of gain objects
	 */
	static getOptionalFeatureGains (/** @type {*} */ classData, /** @type {*} */ currentLevel, /** @type {*} */ newLevel, /** @type {*} */ state, /** @type {*} */ subclassData = null) {
		/** @type {*[]} */ const gains = [];

		const classProgressions = classData.optionalfeatureProgression || [];
		const classFeatureTypeSet = new Set(
			classProgressions.flatMap((/** @type {*} */ p) => p.featureType || []),
		);

		/** @type {*[]} */ const progressions = [...classProgressions];

		// Merge subclass-level progressions (Arcane Shot, Maneuvers, Runes, Disciplines).
		const subclassProgressions = subclassData?.optionalfeatureProgression || [];
		for (const p of subclassProgressions) {
			const types = p.featureType || [];
			// Skip combat methods (handled by the bonus-method augmentation path).
			if (types.some((/** @type {*} */ ft) => ft.startsWith?.("CTM:"))) continue;
			// Overlap-guard: skip if this type also exists at class level (shared-count hazard).
			if (types.some((/** @type {*} */ ft) => classFeatureTypeSet.has(ft))) continue;
			progressions.push(p);
		}

		if (!progressions.length) return gains;

		progressions.forEach((/** @type {*} */ optFeatProg) => {
			const featureTypes = optFeatProg.featureType || [];
			const name = optFeatProg.name || featureTypes.map((/** @type {*} */ ft) => ft.replace(/:/g, " ")).join(", ");

			const countAtCurrent = CharacterSheetClassUtils._readOptFeatureProgressionCount(optFeatProg.progression, currentLevel);
			const countAtNew = CharacterSheetClassUtils._readOptFeatureProgressionCount(optFeatProg.progression, newLevel);
			void countAtCurrent;

			const existingOptFeatures = state.getFeatures().filter((/** @type {*} */ f) => f.featureType === "Optional Feature");

			const matchesFeatureType = (/** @type {*} */ optFeatTypes) => {
				return optFeatTypes?.some((/** @type {*} */ ft) =>
					featureTypes.some((/** @type {*} */ progType) => ft === progType || ft.startsWith(progType)),
				);
			};

			const existingOfType = existingOptFeatures.filter((/** @type {*} */ f) =>
				matchesFeatureType(f.optionalFeatureTypes),
			).length;

			const newOptionsCount = countAtNew - existingOfType;
			if (/** @type {*} */ newOptionsCount > 0) {
				gains.push({
					featureTypes,
					name,
					currentCount: existingOfType,
					totalCount: countAtNew,
					newCount: newOptionsCount,
					required: optFeatProg.required || false,
				});
			}
		});

		return gains;
	}

	/**
	 * Determine the class-level `featProgression` feat picks newly granted across a level
	 * range, e.g. the 2024/TGTT Ranger's "Fighting Style" feat at level 2.
	 *
	 * Classes in the 2024 ruleset express Fighting Style (and similar) as a class-level
	 * `featProgression` entry whose `progression` map is keyed by the level at which that
	 * many NEW feats of the given `category` are granted (e.g. `{"2": 1}` = "+1 FS feat at
	 * level 2"). This is distinct from `optionalfeatureProgression` (optional features) and
	 * from optional-feature-level `featProgression` (handled by
	 * `getOptFeatureFeatProgressionPicks`).
	 *
	 * Epic Boon (`category` containing `"EB"`) is intentionally EXCLUDED here — it is already
	 * handled by the dedicated ASI / Epic Boon flow at level 19, so surfacing it again would
	 * double-prompt.
	 *
	 * Because picks are summed only for levels in `(prevLevel, newLevel]`, re-leveling never
	 * re-prompts for a pick granted at an earlier level.
	 *
	 * @param {*} classData - The class data object (may have `featProgression`)
	 * @param {number} prevLevel - The class level BEFORE this transition (0 for a fresh build)
	 * @param {number} newLevel - The class level AFTER this transition
	 * @returns {Array<{progressionName: string, category: string[], count: number}>}
	 */
	static getClassFeatProgressionGains (/** @type {*} */ classData, /** @type {*} */ prevLevel, /** @type {*} */ newLevel) {
		/** @type {*[]} */ const gains = [];
		if (!classData?.featProgression?.length) return gains;

		const lo = Math.max(0, Number(prevLevel) || 0);
		const hi = Number(newLevel) || 0;
		if (hi <= lo) return gains;

		for (const prog of classData.featProgression) {
			const category = Array.isArray(prog.category) ? [...prog.category] : [];
			// Epic Boon is handled by the dedicated ASI / Epic Boon flow — skip it here.
			if (category.includes("EB")) continue;

			const map = prog.progression;
			if (!map || typeof map !== "object") continue;

			let count = 0;
			if (Array.isArray(map)) {
				for (let lvl = lo + 1; lvl <= hi; ++lvl) count += Number(map[lvl - 1]) || 0;
			} else {
				for (let lvl = lo + 1; lvl <= hi; ++lvl) count += Number(map[String(lvl)]) || 0;
			}

			if (count > 0) {
				gains.push({
					progressionName: prog.name || "Feat",
					category,
					count,
				});
			}
		}

		return gains;
	}

	// ==========================================
	// Companion Icon Utilities
	// ==========================================

	/**
	 * Consolidated creature-to-emoji map. Merged from all previous per-site maps.
	 * Lookup uses `includes()` so "Giant Bat" matches "bat", "Dire Wolf" matches "wolf", etc.
	 */
	static _CREATURE_EMOJI_MAP = {
		// Mammals
		wolf: "🐺",
		bear: "🐻",
		lion: "🦁",
		tiger: "🐅",
		panther: "🐆",
		ape: "🦍",
		boar: "🐗",
		elk: "🦌",
		deer: "🦌",
		dog: "🐕",
		horse: "🐴",
		cat: "🐱",
		rat: "🐀",
		weasel: "🦨",
		// Birds
		eagle: "🦅",
		hawk: "🦅",
		owl: "🦉",
		raven: "🐦‍⬛",
		// Flying
		bat: "🦇",
		// Reptiles & Amphibians
		snake: "🐍",
		lizard: "🦎",
		crocodile: "🐊",
		frog: "🐸",
		toad: "🐸",
		// Arachnids & Insects
		spider: "🕷️",
		scorpion: "🦂",
		// Aquatic
		shark: "🦈",
		octopus: "🐙",
		crab: "🦀",
		fish: "🐟",
		seahorse: "🐴",
		// Fey
		pixie: "🧚",
		sprite: "🧚",
		dryad: "🌳",
		satyr: "🐐",
		unicorn: "🦄",
		// Elemental
		fire: "🔥",
		air: "💨",
		water: "💧",
		earth: "🗿",
		ice: "❄️",
		magma: "🌋",
		// Celestial
		angel: "👼",
		celestial: "✨",
		couatl: "🐍",
		pegasus: "🐴",
	};

	/**
	 * Fallback emoji by creature type when no name match is found.
	 */
	static _CREATURE_TYPE_EMOJI_MAP = {
		beast: "🐾", fey: "🧚", elemental: "✨", celestial: "👼",
	};

	/**
	 * Resolve the best emoji for a creature by name (includes-match) then type fallback.
	 * @param {string} name - Creature name
	 * @param {string|object} [type] - Creature type string or {type: string}
	 * @returns {string} emoji character
	 */
	static getCreatureEmoji (/** @type {*} */ name, /** @type {*} */ type) {
		const nameLower = (name || "").toLowerCase();
		const typeStr = typeof type === "string" ? type : type?.type;

		for (const [key, emoji] of Object.entries(CharacterSheetClassUtils._CREATURE_EMOJI_MAP)) {
			if (nameLower.includes(key)) return emoji;
		}

		return (/** @type {*} */ (CharacterSheetClassUtils._CREATURE_TYPE_EMOJI_MAP))[typeStr] || "🐾";
	}

	/**
	 * Generate HTML for a companion icon — token image with emoji fallback.
	 *
	 * If the companion has a `source`, tries to build a token image URL via
	 * `Renderer.monster.getTokenUrl()`. Returns an `<img>` with an `onerror`
	 * handler that swaps in the emoji fallback. If no source or Renderer is
	 * unavailable, returns the emoji directly in a `<span>`.
	 *
	 * @param {{name: string, source?: string, type?: string|object}} creature
	 * @param {"sm"|"md"|"lg"} [size="md"] - Size preset for dimensions
	 * @returns {string} HTML string — either an `<img>` or a `<span>` with emoji
	 */
	static getCompanionIconHtml (/** @type {*} */ creature, /** @type {*} */ size = "md") {
		const sizes = {sm: 24, md: 36, lg: 48};
		const px = (/** @type {*} */ (sizes))[size] || sizes.md;
		const emoji = CharacterSheetClassUtils.getCreatureEmoji(creature.name, creature.type);
		const emojiFontSize = size === "sm" ? "1.2em" : size === "lg" ? "2.2em" : "1.6em";

		const emojiHtml = `<span class="charsheet__companion-icon charsheet__companion-icon--${size}" style="font-size: ${emojiFontSize}; display: inline-flex; align-items: center; justify-content: center; width: ${px}px; height: ${px}px; line-height: 1;">${emoji}</span>`;

		if (!creature.source) return emojiHtml;

		// Try to build a token image URL
		try {
			if (typeof Renderer === "undefined" || !Renderer?.monster?.getTokenUrl) return emojiHtml;

			const tokenUrl = Renderer.monster.getTokenUrl({name: creature.name, source: creature.source, hasToken: true});
			if (!tokenUrl) return emojiHtml;

			// Escape emoji for use inside an onerror attribute
			const escapedEmoji = emojiHtml.replace(/"/g, "&quot;").replace(/'/g, "&#39;");

			return `<img
				src="${tokenUrl}"
				class="charsheet__companion-icon charsheet__companion-icon--${size}"
				style="width: ${px}px; height: ${px}px; border-radius: 50%; object-fit: cover;"
				alt="${(creature.name || "").replace(/"/g, "&quot;")}"
				loading="lazy"
				onerror="this.outerHTML='${escapedEmoji}'"
			>`;
		} catch (e) {
			return emojiHtml;
		}
	}
}

// Export
export {CharacterSheetClassUtils};
globalThis.CharacterSheetClassUtils = CharacterSheetClassUtils;
