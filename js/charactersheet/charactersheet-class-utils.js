// Project globals — typed via globalThis cast for TypeScript checkJs
const {Parser, Renderer, MiscUtil, UrlUtil, SourceUtil} = /** @type {*} */ (globalThis);

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
	 * (S2 #15) Canonical name of the single shared resource pool that every Hochling
	 * "Divine Manifestation" Channel-Divinity option draws on. Kept here so the option
	 * synthesis (class-utils) and the pool/migration logic (state) agree on one string.
	 * @type {string}
	 */
	static RACE_MANIFESTATION_POOL_NAME = "Divine Manifestation";

	// ==========================================
	// Psionic manifesters (5etools `psionic` prop)
	// ==========================================

	/**
	 * Classes that learn `psionic` powers rather than spells.
	 *
	 * 5etools models psionic powers as their own top-level `psionic` prop with no link
	 * back to the class that learns them — there is no `classPsionicList` analogue of
	 * `fromClassList`. This table supplies the missing link DECLARATIVELY (data, not
	 * branching code): everything downstream — building the pickers, gating by order,
	 * counting how many powers are known at each level — is generic and reads only from
	 * here, so adding another psionic class is a data edit.
	 *
	 * `firstOrderType` / `higherOrderType` must not be prefixes of one another: the
	 * optional-feature engine matches feature types with `startsWith`.
	 *
	 * @type {Record<string, *>}
	 */
	static PSIONIC_MANIFESTERS = {
		"talent|talpsi": {
			className: "Talent",
			classSource: "TalPsi",
			powerSource: "TalPsi",
			firstOrderType: "PsiP1",
			higherOrderType: "PsiPH",
			firstOrderName: "1st-Order Powers",
			higherOrderName: "Powers Known",
			// 1st-order powers known, keyed by threshold level (Talent table).
			firstOrderProgression: {1: 4, 4: 5, 10: 6},
			// Powers of 2nd order or higher known = talent level + 1.
			higherOrderPerLevel: (/** @type {number} */ level) => level + 1,
			// Class level at which each power order becomes learnable/manifestable.
			orderUnlockLevels: {2: 1, 3: 5, 4: 9, 5: 13, 6: 17},
			manifestationAbility: "int",
		},
	};

	/**
	 * Look up the psionic-manifester config for a class entity (or plain name/source).
	 * @param {*} classNameOrEntity class entity, or class name string
	 * @param {string} [classSource]
	 * @returns {*} config or null
	 */
	static getPsionicManifesterConfig (/** @type {*} */ classNameOrEntity, /** @type {*} */ classSource = null) {
		const name = typeof classNameOrEntity === "string" ? classNameOrEntity : classNameOrEntity?.name;
		const source = typeof classNameOrEntity === "string" ? classSource : (classNameOrEntity?.source ?? classSource);
		if (!name) return null;
		return CharacterSheetClassUtils.PSIONIC_MANIFESTERS[`${name}|${source || ""}`.toLowerCase()]
			// Tolerate a missing source (saved characters record only the class name).
			|| Object.values(CharacterSheetClassUtils.PSIONIC_MANIFESTERS)
				.find((/** @type {*} */ cfg) => cfg.className.toLowerCase() === name.toLowerCase())
			|| null;
	}

	/**
	 * Parse a psionic power's `order` string ("3rd-Order") into a number.
	 * @param {*} power
	 * @returns {number} 0 when unparseable
	 */
	static getPsionicPowerOrder (/** @type {*} */ power) {
		const raw = power?.order;
		if (typeof raw === "number") return raw;
		const m = /^(\d+)/.exec(String(raw || ""));
		return m ? Number(m[1]) : 0;
	}

	/**
	 * Turn a pool of `psionic` powers into synthetic `optionalfeature` entities so the
	 * EXISTING optional-feature picker engine surfaces them in the Builder, Level-Up and
	 * Quick Build flows with no new per-flow UI.
	 *
	 * Powers of 2nd order or higher carry a class-level prerequisite derived from
	 * `orderUnlockLevels`, so the picker greys out powers the character can't yet learn
	 * for exactly the same reason it greys out an unmet invocation prerequisite.
	 *
	 * @param {Array<*>} psionics all known psionic powers
	 * @param {*} config a `PSIONIC_MANIFESTERS` entry
	 * @returns {Array<*>} synthetic optional features
	 */
	static buildPsionicOptionalFeatures (/** @type {*} */ psionics, /** @type {*} */ config) {
		if (!Array.isArray(psionics) || !config) return [];
		return psionics
			.filter(p => !config.powerSource || (p?.source || "").toLowerCase() === config.powerSource.toLowerCase())
			.map(power => {
				const order = CharacterSheetClassUtils.getPsionicPowerOrder(power);
				if (!order) return null;
				const isFirst = order === 1;
				const unlockLevel = isFirst ? 1 : (config.orderUnlockLevels?.[order] || 1);
				/** @type {*} */ const out = {
					...power,
					featureType: [isFirst ? config.firstOrderType : config.higherOrderType],
					_entityType: "psionicPower",
					_psionicOrder: order,
					_psionicPowerType: power.type || null,
					// Keep the original discipline code out of the optional-feature `type`
					// slot, which the renderer treats as a feature-type code.
					type: undefined,
				};
				if (unlockLevel > 1) {
					out.prerequisite = [
						...(power.prerequisite || []),
						{level: {level: unlockLevel, class: {name: config.className, visible: true}}},
					];
				}
				return out;
			})
			.filter(Boolean);
	}

	/**
	 * Build the two `optionalfeatureProgression` entries a psionic manifester needs.
	 * @param {*} config a `PSIONIC_MANIFESTERS` entry
	 * @param {number} [maxLevel]
	 * @returns {Array<*>}
	 */
	static buildPsionicProgressions (/** @type {*} */ config, /** @type {number} */ maxLevel = 20) {
		if (!config) return [];
		/** @type {Record<number, number>} */ const higher = {};
		for (let lvl = 1; lvl <= maxLevel; ++lvl) higher[lvl] = config.higherOrderPerLevel(lvl);
		return [
			{
				name: config.firstOrderName,
				featureType: [config.firstOrderType],
				progression: {...config.firstOrderProgression},
				required: true,
				_derived: true,
			},
			{
				name: config.higherOrderName,
				featureType: [config.higherOrderType],
				progression: higher,
				required: true,
				_derived: true,
			},
		];
	}

	/**
	 * Attach psionic power pickers to a class entity, idempotently.
	 * @param {*} classEntity
	 * @param {Array<*>} psionics
	 * @returns {Array<*>} the synthetic optional features created (empty when N/A)
	 */
	static augmentClassWithPsionicPowers (/** @type {*} */ classEntity, /** @type {*} */ psionics) {
		const config = CharacterSheetClassUtils.getPsionicManifesterConfig(classEntity);
		if (!config) return [];
		const existing = new Set((classEntity.optionalfeatureProgression || []).flatMap((/** @type {*} */ p) => p.featureType || []));
		if (!existing.has(config.firstOrderType)) {
			classEntity.optionalfeatureProgression = [
				...(classEntity.optionalfeatureProgression || []),
				...CharacterSheetClassUtils.buildPsionicProgressions(config),
			];
		}
		return CharacterSheetClassUtils.buildPsionicOptionalFeatures(psionics, config);
	}

	/**
	 * The 18 standard D&D 5e skills, as proper display names. Shared by the
	 * feature skill sub-choice pickers so the list lives in exactly one place.
	 * @type {string[]}
	 */
	static STANDARD_SKILLS = Object.freeze([
		"Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
		"History", "Insight", "Intimidation", "Investigation", "Medicine",
		"Nature", "Perception", "Performance", "Persuasion", "Religion",
		"Sleight of Hand", "Stealth", "Survival",
	]);

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

	/**
	 * Whether a class level is the one at which a generic Epic Boon feat is offered in the
	 * ASI/feat slot. Epic Boons are a 2024 (PHB'24 / TGTT) construct granted at class level
	 * 19; classes from other sources do NOT get the generic epic-boon slot.
	 *
	 * Uses EXACT source matching (via {@link CharacterSheetClassUtils.is2024Source}) so a
	 * 2024 sub-source such as "TGTT-IllR" — an Illrigger that grants its own Interdict Boons
	 * through `optionalfeatureProgression`, not epic-boon feats — is excluded and offered a
	 * normal ASI/Feat instead. This is the single source of truth shared by both the
	 * level-up and quick-build flows so their L19 behaviour can never drift.
	 *
	 * @param {string} source - The class entry source (e.g. "XPHB", "TGTT", "TGTT-IllR").
	 * @param {number} classLevel - The class level being gained.
	 * @returns {boolean}
	 */
	static isEpicBoonLevel (/** @type {*} */ source, /** @type {*} */ classLevel) {
		return classLevel === 19 && CharacterSheetClassUtils.is2024Source(source);
	}

	/**
	 * Whether a feat-list entry is actually an Illrigger Interdict Boon (`ItdBoon` optional
	 * feature) that has leaked into the feat pool. Interdict Boons are chosen via the
	 * Illrigger Interdict-boon `optionalfeatureProgression`, NOT the generic feat / epic-boon
	 * slot, so the feat and epic-boon pickers defensively exclude any such entry. Today the
	 * feat pool (`getFeats()`) never contains optional features, but this guard keeps a
	 * future data merge from surfacing boons as pickable feats.
	 * @param {*} entry - A candidate feat / optional-feature entry.
	 * @returns {boolean}
	 */
	static isInterdictBoonEntry (/** @type {*} */ entry) {
		if (!entry) return false;
		const types = entry.optionalfeatureType || entry.optionalFeatureTypes || entry.featureType;
		if (Array.isArray(types)) return types.includes("ItdBoon");
		return types === "ItdBoon";
	}

	/**
	 * Apply a POSITIVE "increase up to a maximum" ability bump without ever lowering
	 * an existing score. A "max <cap>" increase must never become a way to REDUCE a
	 * score that is already at or above the cap (e.g. a base of 22 from Primal Champion
	 * or a custom modifier). Applied to a score already ≥ cap this is a no-op.
	 *
	 * Replaces the naive `Math.min(cap, current + amount)` clamp used across the ASI /
	 * feat apply paths, which silently dropped a >cap score down to the cap.
	 *
	 * Positive-only: `amount` is expected to be ≥ 0. Reversions (removing an ASI) must
	 * subtract directly and must NOT go through this helper.
	 *
	 * @param {number} current - The current (base) ability score.
	 * @param {number} amount - The increase to apply (≥ 0).
	 * @param {number} [cap] - The maximum the increase may raise the score to (default 20).
	 * @returns {number} The new score: never below `current`, never above `cap` unless
	 *   `current` already exceeds `cap` (in which case `current` is preserved).
	 */
	static capAbilityIncrease (/** @type {*} */ current, /** @type {*} */ amount, /** @type {*} */ cap = 20) {
		return Math.max(current, Math.min(cap, current + amount));
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
	 * Strip the distance UNIT ("ft"/"ft."/"feet") from a formatted speed string while
	 * preserving the numeric value AND any trailing annotation (exhaustion " (-5)",
	 * " (halved)") and movement-type word prefixes. Display-only: the canonical
	 * `state.getSpeed()` string (and the exhaustion regex that reads it) keep the unit;
	 * callers strip purely for the overview/companion presentation the user reads.
	 *   "40 ft."                 -> "40"
	 *   "40 ft., fly 60 ft."     -> "40, fly 60"
	 *   "35 ft. (-5)"            -> "35 (-5)"
	 *   "15 feet (halved)"       -> "15 (halved)"
	 * @param {string} speedStr
	 * @returns {string}
	 */
	static stripSpeedUnit (/** @type {*} */ speedStr) {
		if (speedStr == null) return "";
		return String(speedStr)
			// Remove a standalone "ft"/"ft."/"feet" unit token (case-insensitive) plus the
			// space that precedes it, leaving the value and any following annotation intact.
			.replace(/\s*\b(?:ft|feet)\b\.?/gi, "")
			// Collapse any double spaces left behind (e.g. before a "(-5)" annotation).
			.replace(/\s{2,}/g, " ")
			.replace(/\s+,/g, ",")
			.trim();
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
	 * @param {Array<string>} [opts.preserveFeatureTypes] - Feature types whose source variants must remain available for a later progression-source filter
	 * @returns {Array<*>} Deduplicated optional features
	 */
	static deduplicateOptFeaturesByEdition (/** @type {*} */ optFeatures, /** @type {*} */ opts = {}) {
		const {showAll = false, preserveFeatureTypes = []} = opts;
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
			const shouldPreserveSource = (opt.featureType || []).some((/** @type {*} */ type) => preserveFeatureTypes.includes(type));
			const key = `${opt.name.toLowerCase()}${shouldPreserveSource ? `|${opt.source || ""}` : ""}`;
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
	 * A user-authored item has no DataLoader identity even when an imported save
	 * carries a non-Custom source label. Only real catalog entries may use the
	 * standard item hover.
	 * @param {*} item
	 * @returns {boolean}
	 */
	static isCatalogItemHoverTarget (/** @type {*} */ item) {
		const source = String(item?.source || "").trim();
		const isDerived = item?._isCraftingMaterial
			|| item?._isCraftedItem
			|| item?._isEmpoweredGemstone
			|| item?.cookedTier != null;
		const isSourceLoaded = !!source && !!(
			globalThis.SourceUtil?.isSiteSource?.(source)
			|| globalThis.BrewUtil2?.hasSourceJson?.(source)
			|| globalThis.PrereleaseUtil?.hasSourceJson?.(source)
		);
		return !!item?.name
			&& isSourceLoaded
			&& source.toLowerCase() !== "custom"
			&& !item?._isCustom
			&& !isDerived;
	}

	/**
	 * Execute an async renderer hover without allowing a failed/stale lookup to
	 * escape as an unhandled promise rejection.
	 * @param {Function} handler
	 * @param  {...any} args
	 * @returns {Promise<any|undefined>}
	 */
	static async pCallHoverHandlerSafely (handler, ...args) {
		try {
			return await handler(...args);
		} catch (e) {
			return undefined;
		}
	}

	/**
	 * Build a self-contained inline-hover entry from an inventory item's own data.
	 * This is intentionally independent of the item catalog so custom and imported
	 * source-less items always have a useful preview.
	 * @param {*} item
	 * @returns {{type: string, name: string, entries: Array}|null}
	 */
	static buildItemInlineHoverEntry (/** @type {*} */ item) {
		if (!item?.name) return null;

		const entries = [];
		const summary = [];
		const toLabel = (value) => {
			if (value == null || value === "") return "";
			if (typeof value === "object") return value.name || value.full || value.type || value.property || "";
			return String(value);
		};
		const list = (values) => (Array.isArray(values) ? values : values != null ? [values] : [])
			.map(toLabel)
			.filter(Boolean)
			.join(", ");
		const addLine = (label, value) => {
			if (value == null || value === "") return;
			entries.push(`{@b ${label}:} ${value}`);
		};
		const formatBonus = (value) => {
			if (value == null || value === "" || Number(value) === 0) return "";
			const num = Number(value);
			return Number.isFinite(num) && num > 0 ? `+${num}` : String(value);
		};

		if (item.type) summary.push(toLabel(item.type));
		if (item.rarity && !["none", "unknown"].includes(String(item.rarity).toLowerCase())) summary.push(String(item.rarity));
		if (item.requiresAttunement || item.reqAttune) summary.push("requires attunement");
		if (summary.length) entries.push(`{@i ${summary.join(", ")}}`);

		let valueText = item.value != null ? `${item.value} cp` : "";
		let weightText = item.weight != null ? `${item.weight} lb.` : "";
		try {
			valueText = Parser.itemValueToFullMultiCurrency?.(item) || valueText;
			weightText = Parser.itemWeightToFull?.(item) || weightText;
		} catch (e) { /* use the raw-value fallback */ }
		addLine("Value", valueText);
		addLine("Weight", weightText);

		const damage = item.damage || item.dmg1;
		const damageType = toLabel(item.dmgType);
		addLine("Damage", damage ? `${damage}${damageType ? ` ${damageType}` : ""}` : "");
		addLine("Properties", list(item.properties || item.property));
		addLine("Mastery", list(item.mastery));

		const armorParts = [];
		if (item.armorType) armorParts.push(toLabel(item.armorType));
		if (item.ac != null) armorParts.push(`AC ${item.ac}`);
		if (item.dexterityMax != null) armorParts.push(`Dexterity maximum ${item.dexterityMax}`);
		if (item.strength != null) armorParts.push(`Strength ${item.strength}`);
		if (item.stealth) armorParts.push("Stealth disadvantage");
		addLine("Armor", armorParts.join(", "));

		if (item.charges != null) {
			const current = item.chargesCurrent ?? item.charges;
			addLine("Charges", `${current}/${item.charges}${item.recharge ? `; recharges ${item.recharge}` : ""}`);
		}

		const bonuses = [
			["AC", item.bonusAc],
			["weapon", item.bonusWeapon],
			["weapon attacks", item.bonusWeaponAttack],
			["weapon damage", item.bonusWeaponDamage],
			["spell attacks", item.bonusSpellAttack],
			["spell save DC", item.bonusSpellSaveDc],
			["saving throws", item.bonusSavingThrow],
			["ability checks", item.bonusAbilityCheck],
		]
			.map(([label, value]) => {
				const bonus = formatBonus(value);
				return bonus ? `${bonus} ${label}` : "";
			})
			.filter(Boolean);
		addLine("Bonuses", bonuses.join(", "));

		addLine("Resistance", list(item.resist));
		addLine("Immunity", list(item.immune));
		addLine("Vulnerability", list(item.vulnerable));
		addLine("Condition Immunity", list(item.conditionImmune));

		const senses = Object.entries(item.senses || {})
			.filter(([, value]) => value != null && value !== "" && Number(value) !== 0)
			.map(([sense, value]) => `${sense} ${value} ft.`);
		addLine("Senses", senses.join(", "));

		if (Array.isArray(item.entries)) entries.push(...item.entries);
		else if (item.entries) entries.push(String(item.entries));

		for (const power of item.itemPowers || []) {
			const powerEntries = [];
			if (power.description) powerEntries.push(power.description);
			if (power.chargesCost) powerEntries.push(`{@b Cost:} ${power.chargesCost} charge${power.chargesCost === 1 ? "" : "s"}`);
			if (power.usesMax) powerEntries.push(`{@b Uses:} ${power.usesMax}`);
			if (powerEntries.length) entries.push({type: "entries", name: power.name || "Item Power", entries: powerEntries});
		}

		if (!entries.length) entries.push(item._isCustom || String(item.source || "").toLowerCase() === "custom" ? "Custom item." : "Item details are stored on this character.");

		// Inline entry strings are rendered as HTML. Custom/imported item data is
		// save-file input, so escape raw markup recursively while leaving 5etools
		// `{@tag ...}` syntax intact for the Renderer.
		const isSafeExternalUrl = (url) => {
			const clean = String(url || "").trim();
			const normalized = [...clean]
				.filter(char => {
					const code = char.charCodeAt(0);
					return code > 0x20 && code !== 0x7f;
				})
				.join("");
			if (!normalized) return false;
			if (!/^[a-zA-Z]+:/.test(normalized)) return true;
			try {
				return ["http:", "https:", "mailto:"].includes(new URL(normalized).protocol.toLowerCase());
			} catch (e) {
				return false;
			}
		};
		const isSafeInternalPath = (path) => {
			const clean = String(path || "").trim();
			return !!clean
				&& !/^[a-zA-Z]+:/.test(clean)
				&& !clean.startsWith("//")
				&& !clean.includes("\\")
				&& /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.html$/i.test(clean);
		};
		const sanitizeLinkTags = (str) => String(str)
			.replace(
				/\{@link\s+([^|}]+)(?:\|([^}]+))?\}/gi,
				(match, displayText, url) => isSafeExternalUrl(url ?? displayText) ? match : displayText,
			)
			.replace(
				/\{@(?:5etools|5etoolsImg)\s+([^|}]+)\|([^|}]+)(?:\|[^}]*)?\}/gi,
				(match, displayText, path) => isSafeInternalPath(path) ? match : displayText,
			);
		const escapeEntry = (value) => {
			if (typeof value === "string") return CharacterSheetClassUtils.escapeHtml(sanitizeLinkTags(value));
			if (Array.isArray(value)) return value.map(escapeEntry);
			if (value && typeof value === "object") {
				if (value.type === "link" && value.href?.type === "external" && !isSafeExternalUrl(value.href.url)) {
					return escapeEntry(value.text || value.href.url || "");
				}
				if (value.type === "link" && value.href?.type === "internal" && !isSafeInternalPath(value.href.path)) {
					return escapeEntry(value.text || value.href.path || "");
				}
				if (["image", "gallery"].includes(value.type)) return escapeEntry(value.title || value.altText || "");
				return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, escapeEntry(child)]));
			}
			return value;
		};
		return {
			type: "entries",
			name: CharacterSheetClassUtils.escapeHtml(item.name),
			entries: entries.map(escapeEntry),
		};
	}

	/**
	 * Build safe item-name HTML. Catalog items use the normal statblock hover;
	 * custom/source-less items use their own inline data.
	 * @param {*} item
	 * @param {*} [opts]
	 * @returns {string}
	 */
	static buildItemHoverNameHtml (/** @type {*} */ item, {displayLabel = null} = {}) {
		const label = displayLabel ?? item?.name ?? "Item";
		const safeLabel = CharacterSheetClassUtils.escapeHtml(label);
		if (!item?.name) return safeLabel;

		if (CharacterSheetClassUtils.isCatalogItemHoverTarget(item)
			&& typeof Renderer !== "undefined"
			&& Renderer.hover?.getHoverElementAttributes
			&& typeof UrlUtil !== "undefined") {
			try {
				const separator = typeof HASH_LIST_SEP !== "undefined" ? HASH_LIST_SEP : "_";
				const hash = UrlUtil.encodeForHash([item.name, item.source].join(separator));
				const page = UrlUtil.PG_ITEMS || "items.html";
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page, source: item.source, hash});
				return `<a href="${page}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
			} catch (e) { /* fall through to inline/plain */ }
		}

		const entry = CharacterSheetClassUtils.buildItemInlineHoverEntry(item);
		const inline = entry
			? CharacterSheetClassUtils.buildInlineEntriesHoverLink(label, entry.name, entry.entries)
			: null;
		return inline || safeLabel;
	}

	/**
	 * Wire an existing element to the same item hover used by item-name HTML.
	 * @param {HTMLElement} element
	 * @param {*} item
	 * @returns {{isInlineHover?: boolean, page?: string, source?: string, hash?: string, entry?: object}|null}
	 */
	static applyItemHoverPreview (/** @type {*} */ element, /** @type {*} */ item) {
		if (!element || !item?.name || typeof Renderer === "undefined" || !Renderer.hover) return null;
		element.classList?.add("charsheet__item-power--has-preview");

		if (CharacterSheetClassUtils.isCatalogItemHoverTarget(item)
			&& typeof Renderer.hover.pHandleLinkMouseOver === "function") {
			try {
				const page = UrlUtil.PG_ITEMS || "items.html";
				const separator = typeof HASH_LIST_SEP !== "undefined" ? HASH_LIST_SEP : "_";
				const hash = UrlUtil.encodeForHash([item.name, item.source].join(separator));
				element.setAttribute("data-vet-page", page);
				element.setAttribute("data-vet-source", item.source);
				element.setAttribute("data-vet-hash", hash);
				element.addEventListener?.("mouseover", event => Renderer.hover.pHandleLinkMouseOver(event, element));
				if (typeof Renderer.hover.handleLinkMouseMove === "function") element.addEventListener?.("mousemove", event => Renderer.hover.handleLinkMouseMove(event, element));
				if (typeof Renderer.hover.handleLinkMouseLeave === "function") element.addEventListener?.("mouseleave", event => Renderer.hover.handleLinkMouseLeave(event, element));
				return {page, source: item.source, hash};
			} catch (e) { /* fall through to inline */ }
		}

		if (typeof Renderer.hover.handleInlineMouseOver !== "function") return null;
		const entry = CharacterSheetClassUtils.buildItemInlineHoverEntry(item);
		if (!entry) return null;
		element.setAttribute("data-vet-entry", JSON.stringify(entry));
		element.addEventListener?.("mouseover", event => Renderer.hover.handleInlineMouseOver(event, element, entry));
		if (typeof Renderer.hover.handleLinkMouseMove === "function") element.addEventListener?.("mousemove", event => Renderer.hover.handleLinkMouseMove(event, element));
		if (typeof Renderer.hover.handleLinkMouseLeave === "function") element.addEventListener?.("mouseleave", event => Renderer.hover.handleLinkMouseLeave(event, element));
		return {isInlineHover: true, entry};
	}

	/**
	 * Add an accessible preview to an item-power row so its hover matches what the
	 * Inventory shows. Spell powers use the canonical 5etools spell statblock hover.
	 * Non-spell powers (abilities, toggles, on-hit riders, reference-only rows) have
	 * no catalog page of their own, so — exactly like the Inventory item name — they
	 * hover the parent item's statblock (via its name + source). Custom / source-less
	 * items have no catalog entry, so they fall back to a rich inline-entries hover
	 * built from the power's own description + resource metadata. Native `title`/ARIA
	 * stay as the final fallback.
	 * @param {HTMLElement} element
	 * @param {*} power
	 * @returns {{isSpell: boolean, title: string, page?: string, source?: string, hash?: string, isInlineHover?: boolean}|null}
	 */
	static applyItemPowerPreview (/** @type {*} */ element, /** @type {*} */ power) {
		if (!element || !power) return null;
		const isSpell = power.kind === "spell" && !!power.spellName;
		const castLevel = power.castLevel ? `Cast at level ${power.castLevel}` : "";
		const description = String(power.description || "").trim()
			|| (isSpell ? `Preview ${power.spellName}` : `${power.itemName || "Item"} power`);
		const title = [power.name, castLevel, description].filter(Boolean).join(". ");
		element.title = title;
		element.setAttribute?.("aria-label", title);
		element.classList?.add("charsheet__item-power--has-preview");
		const tagName = String(element.tagName || "").toLowerCase();
		if (!["a", "button", "input", "select", "textarea"].includes(tagName)) element.tabIndex = 0;

		if (typeof Renderer === "undefined" || !Renderer.hover) return {isSpell, title};

		// Spell powers reuse the canonical 5etools spell statblock hover.
		if (isSpell) {
			try {
				const source = power.spellSource || Parser.SRC_XPHB;
				const page = UrlUtil.PG_SPELLS || "spells.html";
				const separator = typeof HASH_LIST_SEP !== "undefined" ? HASH_LIST_SEP : "_";
				const hash = UrlUtil.encodeForHash([power.spellName, source].join(separator));
				element.setAttribute("data-vet-page", page);
				element.setAttribute("data-vet-source", source);
				element.setAttribute("data-vet-hash", hash);
				if (power.castLevel) element.setAttribute("data-cast-level", String(power.castLevel));
				if (typeof Renderer.hover.pHandleLinkMouseOver === "function") {
					element.addEventListener?.("mouseover", event => Renderer.hover.pHandleLinkMouseOver(event, element));
				}
				if (typeof Renderer.hover.handleLinkMouseMove === "function") {
					element.addEventListener?.("mousemove", event => Renderer.hover.handleLinkMouseMove(event, element));
				}
				if (typeof Renderer.hover.handleLinkMouseLeave === "function") {
					element.addEventListener?.("mouseleave", event => Renderer.hover.handleLinkMouseLeave(event, element));
				}
				return {isSpell, title, page, source, hash};
			} catch (e) {
				return {isSpell, title};
			}
		}

		const fallbackEntries = [description];
		if (power.chargesCost) fallbackEntries.push(`{@b Cost:} ${power.chargesCost} charge${power.chargesCost === 1 ? "" : "s"}`);
		if (power.usesMax) fallbackEntries.push(`{@b Uses:} ${power.usesCurrent ?? power.usesMax}/${power.usesMax}`);
		if (castLevel) fallbackEntries.push(`{@b ${castLevel}.}`);
		if (power.isDestructive) fallbackEntries.push(`{@b Destroys ${power.itemName || "the item"} when used.}`);
		if (power.isReferenceOnly) fallbackEntries.push(`{@i Rules reference — apply this effect manually.}`);
		const item = power.itemHoverData || {
			name: power.itemName || power.name || "Item Power",
			source: power.itemSource,
			_isCustom: power.itemSource === "Custom" || !power.itemSource,
			entries: fallbackEntries,
		};
		const preview = CharacterSheetClassUtils.applyItemHoverPreview(element, item);
		return preview ? {isSpell, title, ...preview} : {isSpell, title};
	}

	/**
	 * HTML-escape an arbitrary string for safe interpolation into innerHTML.
	 * @param {*} str
	 * @returns {string}
	 */
	static escapeHtml (str) {
		return String(str ?? "")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	/**
	 * Build a hoverable name link for a creature display model (e.g. a druid's
	 * current Wild Shape beast). Prefers the canonical bestiary statblock hover
	 * (when the model carries a `source`); falls back to an inline-entries hover
	 * built from the creature's traits/actions, then to a plain escaped span.
	 *
	 * The visible label is ALWAYS HTML-escaped (names may come from imported save
	 * data), so the returned string is safe to inject via innerHTML.
	 *
	 * @param {*} beast - A model with `{name, customName?, source?, hoverEntries?}`.
	 * @param {string} [extraClass] - Extra CSS class for the anchor/span.
	 * @returns {string} Safe HTML for the hoverable name, or "" when no model.
	 */
	static buildCreatureHoverNameHtml (/** @type {*} */ beast, /** @type {string} */ extraClass = "") {
		if (!beast) return "";
		const label = CharacterSheetClassUtils.escapeHtml(beast.customName || beast.name || "Beast");
		const cls = extraClass ? ` ${CharacterSheetClassUtils.escapeHtml(extraClass)}` : "";
		// Preferred: canonical bestiary statblock hover.
		if (beast.source && typeof UrlUtil !== "undefined" && typeof Renderer !== "undefined" && Renderer.hover?.getHoverElementAttributes) {
			try {
				const sep = typeof HASH_LIST_SEP !== "undefined" ? HASH_LIST_SEP : "_";
				const hash = UrlUtil.encodeForHash([beast.name, beast.source].join(sep));
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_BESTIARY, source: beast.source, hash});
				return `<a href="${UrlUtil.PG_BESTIARY}#${hash}" ${hoverAttrs} class="ve-help-subtle${cls}">${label}</a>`;
			} catch (e) { /* fall through to inline / plain */ }
		}
		// Fallback: inline-entries hover from the creature's own traits/actions.
		if (Array.isArray(beast.hoverEntries) && beast.hoverEntries.length) {
			const inline = CharacterSheetClassUtils.buildInlineEntriesHoverLink(beast.customName || beast.name, beast.name, beast.hoverEntries);
			if (inline) return inline;
		}
		return `<span class="${cls.trim()}">${label}</span>`;
	}

	/**
	 * Build a compact, single-line key-stats string for a creature display model
	 * (AC / HP / speed / senses / ability mods). All dynamic text is HTML-escaped,
	 * so the result is safe to inject via innerHTML.
	 *
	 * @param {*} beast - A model from `_buildBeastModel` (druid-resources).
	 * @returns {string} Safe HTML stat line, or "" when no model.
	 */
	static buildCreatureStatLineHtml (/** @type {*} */ beast) {
		if (!beast) return "";
		const esc = CharacterSheetClassUtils.escapeHtml;
		const parts = [];
		if (beast.ac != null) parts.push(`<span><strong>AC</strong> ${esc(beast.ac)}</span>`);
		if (beast.hpMax != null) {
			const hp = (beast.hpCurrent != null && beast.hpCurrent !== beast.hpMax)
				? `${esc(beast.hpCurrent)}/${esc(beast.hpMax)}`
				: `${esc(beast.hpMax)}`;
			parts.push(`<span><strong>HP</strong> ${hp}</span>`);
		}
		if (beast.speedLabel) parts.push(`<span><strong>Speed</strong> ${esc(beast.speedLabel)}</span>`);
		if (Array.isArray(beast.senses) && beast.senses.length) parts.push(`<span><strong>Senses</strong> ${esc(beast.senses.join(", "))}</span>`);
		if (beast.abilityMods) {
			const m = beast.abilityMods;
			const abil = ["str", "dex", "con", "int", "wis", "cha"]
				.map(k => `${k.toUpperCase()} ${esc(m[k])}`).join(" ");
			parts.push(`<span class="charsheet__beast-abilities">${abil}</span>`);
		}
		return parts.join(`<span class="charsheet__beast-sep"> • </span>`);
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
	 * Build the canonical hover target for a subclass so a link-style hover
	 * resolves against the DataLoader cache.
	 *
	 * The PG_CLASSES subclass hover is keyed in `DataLoader` under the
	 * **subclass** source (via `SourceUtil.getEntitySource`) with the hash
	 * produced by `UrlUtil.URL_TO_HASH_BUILDER["subclass"]`
	 * (`classHash,state:sub_<shortName>_<subclassSource>=b1`). The standard
	 * `{@subclass}` renderer queries the cache with that same subclass source —
	 * but the character sheet historically queried with the *class* source,
	 * producing a guaranteed cache miss for any homebrew subclass whose source
	 * differs from its parent class (e.g. Banneret `TGTT-2024` on Fighter
	 * `TGTT`). This helper realigns the sheet with the renderer.
	 *
	 * When the actual loaded subclass entity is available we derive the source
	 * and hash from THAT object, so the link target is byte-identical to the
	 * cache key registered via `DataLoader._pCache_addToCache` (same entity →
	 * same `getEntitySource` + same hash builder). Otherwise we fall back to a
	 * synthetic descriptor built from the resolved sources.
	 *
	 * @param {object} subclass - Stored subclass (`{name, source}` plus optional className/classSource/shortName)
	 * @param {object} [opts]
	 * @param {Array} [opts.allSubclasses] - Loaded subclass pool (to locate the canonical entity)
	 * @param {object} [opts.storedClass] - Stored class entry (fallback for className/classSource)
	 * @returns {{page: string, source: string, hash: string, href: string, displayName: string}}
	 */
	static buildSubclassHoverTarget (/** @type {*} */ subclass, /** @type {*} */ {allSubclasses = [], storedClass = null} = {}) {
		const resolved = CharacterSheetClassUtils.resolveSubclassHoverSources(subclass, allSubclasses || [], storedClass);
		const nameLc = (resolved.name || "").toLowerCase();
		const classNameLc = (resolved.className || "").toLowerCase();

		// Prefer the real loaded entity so the hash + source exactly match the
		// registered DataLoader cache key.
		const entity = (allSubclasses || []).find(sc =>
			(sc?.name || "").toLowerCase() === nameLc
			&& sc?.source === resolved.source
			&& (!classNameLc || (sc?.className || "").toLowerCase() === classNameLc));

		const hashEnt = entity || {
			name: resolved.name,
			source: resolved.source,
			className: resolved.className,
			classSource: resolved.classSource,
			shortName: resolved.shortName,
		};

		const source = (SourceUtil ? SourceUtil.getEntitySource(hashEnt) : hashEnt.source) || resolved.source;
		const hash = UrlUtil.URL_TO_HASH_BUILDER["subclass"](hashEnt);

		return {
			page: UrlUtil.PG_CLASSES,
			source,
			hash,
			href: `${UrlUtil.PG_CLASSES}#${hash}`,
			displayName: resolved.name,
		};
	}

	/**
	 * Canonicalize the source for a single-source catalog entity (optional
	 * feature / combat method) so a hover resolves against the loaded data.
	 *
	 * A feature stored on the character may carry a stale or alias source
	 * (e.g. "KaW") that differs from the canonical catalog source (e.g.
	 * "TGTT"), causing a cache miss even after the catalog is registered.
	 * Resolution is uniqueness-guarded to avoid ever silently picking the
	 * wrong same-name entry:
	 *   - exact name+source match → keep the stored source;
	 *   - else exactly one name-only match → adopt that entity's source;
	 *   - multiple ambiguous matches, or none → leave the source unchanged.
	 *
	 * `isInCatalog` lets callers decide between a real link (resolvable) and a
	 * graceful inline fallback (genuinely unknown entity).
	 *
	 * @param {string} name - Entity name
	 * @param {string} source - Stored source
	 * @param {Array} [catalog] - Loaded catalog (`_optionalFeaturesData` / `_combatMethodsData`)
	 * @returns {{source: string, isInCatalog: boolean}}
	 */
	static resolveCatalogEntitySource (/** @type {*} */ name, /** @type {*} */ source, /** @type {*} */ catalog = []) {
		const out = {source, isInCatalog: false};
		if (!name) return out;

		const nameLc = `${name}`.toLowerCase();
		const matches = (catalog || []).filter(e => (e?.name || "").toLowerCase() === nameLc);
		if (!matches.length) return out;

		out.isInCatalog = true;

		// Exact name+source match — keep the stored source.
		if (source && matches.some(e => e?.source === source)) return out;

		// Exactly one name-only match — safe to adopt its canonical source.
		if (matches.length === 1) {
			out.source = matches[0].source || source;
			return out;
		}

		// Ambiguous (several same-name entries, none matching) — do not guess.
		return out;
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
	 * Returns true iff `spell` may be traded away by the level-up "Swap a Known
	 * Spell" allowance.
	 *
	 * Swappable means a levelled spell the PLAYER picked. Note that "the player
	 * picked it" is not the same as "it has no `sourceFeature`": the Builder,
	 * QuickBuild and LevelUp all stamp a positive attribution ("Spells Known",
	 * "Wizard Spellbook", …) onto every spell the player chooses. Testing
	 * `!spell.sourceFeature` therefore selects only orphans and rejects the entire
	 * intended set — which is what CS-BUG-108 was.
	 *
	 * Excluded, and why:
	 *  - cantrips — the allowance is for levelled spells;
	 *  - `alwaysPrepared` — subclass/feat grants the character never "knew";
	 *  - any other feature attribution — a subclass or racial grant is not the
	 *    player's to trade (Divine Soul's affinity spell has its own dedicated
	 *    swap on the Spells tab, restricted to the Cleric list).
	 *
	 * Orphans (no attribution at all) remain swappable so characters saved before
	 * attribution existed don't silently lose the feature.
	 *
	 * @param {*} spell
	 * @returns {boolean}
	 */
	static isSwappableKnownSpell (spell) {
		if (!spell) return false;
		if (!(spell.level > 0)) return false;
		if (spell.alwaysPrepared) return false;
		if (!spell.sourceFeature) return true;
		return CharacterSheetClassUtils.isPlayerChosenSpell(spell);
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

		const {classes = [], totalLevel = 0, existingFeatures = [], cantrips = [], spells = [], toolProficiencies = [], state = null, levelPrerequisiteClassAliases = {}} = context;
		const reasons = [];

		// Normalized-tool matcher: prefer state.hasToolProficiency (already
		// strips apostrophes/whitespace), else fall back to a manual case-fold
		// against the toolProficiencies string list.
		const _hasTool = (/** @type {string} */ toolName) => {
			if (state && typeof state.hasToolProficiency === "function") {
				return state.hasToolProficiency(toolName);
			}
			const norm = (/** @type {*} */ s) => (s || "").toString().toLowerCase().replace(/['\s]+/g, "");
			const want = norm(toolName);
			return toolProficiencies.some((/** @type {*} */ t) => norm(t) === want);
		};

		for (/** @type {*} */ const prereq of prerequisite) {
			// Level prerequisite
			if (/** @type {*} */ prereq.level) {
				const reqLevel = prereq.level.level || prereq.level;
				if (/** @type {*} */ prereq.level.class) {
					const className = prereq.level.class.name?.toLowerCase();
					const alias = Object.entries(levelPrerequisiteClassAliases)
						.find(([from]) => from.toLowerCase() === className)?.[1];
					const effectiveClassName = alias?.toLowerCase() || className;
					const classMatch = classes.find((/** @type {*} */ c) => c.name.toLowerCase() === effectiveClassName);
					if (!classMatch || classMatch.level < reqLevel) {
						const classLabel = alias || prereq.level.class.name || "class";
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

			// Proficiency prerequisite. Currently scoped to `tool` (the kind
			// this codepath was extended for — see tracker issue #1148).
			// `armor`, `weapon`, `weaponGroup`, and `skill` proficiency prereqs
			// are intentionally NOT gated here yet — a future PR can extend
			// this branch without a re-audit of call sites.
			if (/** @type {*} */ prereq.proficiency) {
				for (/** @type {*} */ const profObj of prereq.proficiency) {
					if (profObj?.tool === undefined) continue;
					const spec = profObj.tool;
					// `tool: true` — any tool proficiency satisfies
					if (spec === true) {
						const hasAny = state && typeof state.getToolProficiencies === "function"
							? (state.getToolProficiencies() || []).length > 0
							: toolProficiencies.length > 0;
						if (!hasAny) reasons.push("Proficiency with any tool");
						continue;
					}
					// String or string[] — any-of semantics
					const options = Array.isArray(spec) ? spec : [spec];
					const met = options.some((/** @type {*} */ toolName) => _hasTool(toolName));
					if (!met) {
						const titled = options.map((/** @type {*} */ t) => (t || "").toString().toTitleCase());
						reasons.push(`Proficiency with ${titled.join(" or ")}`);
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
		const {cantrips = [], spells = [], levelPrerequisiteClassAliases = {}} = context;
		const chooseStr = spellReq.choose || "";
		const parts = chooseStr.split("|");

		let requiredLevel = null;
		let requiredClass = null;

		for (/** @type {*} */ const part of parts) {
			const [key, val] = part.split("=");
			if (key === "level") requiredLevel = parseInt(val);
			if (key === "class") requiredClass = val?.toLowerCase();
		}

		const aliasedClass = Object.entries(levelPrerequisiteClassAliases)
			.find(([fromClass]) => fromClass.toLowerCase() === requiredClass)?.[1]
			?.toLowerCase();
		const allowedClasses = new Set([requiredClass, aliasedClass].filter(Boolean));
		const pool = requiredLevel === 0 ? cantrips : [...cantrips, ...spells];
		return pool.some((/** @type {*} */ s) => {
			if (requiredLevel !== null && requiredLevel === 0 && !cantrips.includes(s)) return false;
			if (/** @type {*} */ requiredLevel !== null && requiredLevel > 0) {
				if (s.level !== undefined && s.level !== requiredLevel) return false;
			}
			if (requiredClass && !allowedClasses.has(s.sourceClass?.toLowerCase())) return false;
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

		const relevantBlocks = this.hasNamedSubclassChoice(subclass)
			? (() => {
				const choiceBlock = this.getNamedSubclassChoiceBlock(subclass, subclassChoice);
				return choiceBlock ? [choiceBlock] : [];
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

	/**
	 * Spell-picker class-filter predicate (Bug 7 / troubleshooting F9).
	 *
	 * The picker pool is the FULL spell list (so the class filter can broaden,
	 * not just narrow). This decides whether a spell is shown for the currently
	 * selected class names:
	 *   - "All Classes" (empty `selectedClasses`) → always show.
	 *   - Fast path: the spell's raw `fromClassList` membership intersects the
	 *     selection (covers a class's normal list for ANY selected class).
	 *   - Authoritative fallback (the character's OWN classes only): a spell may
	 *     be available via a subclass-EXPANDED list (Divine Soul → Cleric,
	 *     Chronurgy → EGW) that is NOT on the raw `fromClassList`. Without this,
	 *     the broadened pool would drop those from the DEFAULT view, which only
	 *     has the character's own classes selected.
	 *
	 * @param {*} spell
	 * @param {Set<string>} selectedClasses Selected class names; empty = "All Classes".
	 * @param {Array<{className:string}>} ownClassConfigs From `_buildPickerOwnClassConfigs`.
	 * @param {string[]} spellClasses Cached raw `fromClassList` names for `spell`.
	 * @returns {boolean}
	 */
	static spellMatchesPickerClassFilter (spell, selectedClasses, ownClassConfigs, spellClasses) {
		if (!selectedClasses || selectedClasses.size === 0) return true; // All Classes
		if (spellClasses && spellClasses.some(c => selectedClasses.has(c))) return true;
		if (selectedClasses.has("__NONE__")) return false;
		if (!ownClassConfigs || !ownClassConfigs.length) return false;
		return ownClassConfigs.some(own => selectedClasses.has(own.className) && this.spellIsAvailableForClass(spell, own));
	}

	static isDivineSoulSubclass (/** @type {*} */ subclass) {
		if (!subclass?.name && !subclass?.shortName) return false;
		return [subclass.name, subclass.shortName]
			.filter(Boolean)
			.some((/** @type {*} */ name) => String(name).toLowerCase() === "divine soul");
	}

	static isDaemonologistSubclass (/** @type {*} */ subclass) {
		if (!subclass?.name && !subclass?.shortName) return false;
		return [subclass.name, subclass.shortName]
			.filter(Boolean)
			.some((/** @type {*} */ name) => String(name).toLowerCase() === "daemonologist")
			&& subclass.source === "GrimHollowPG24";
	}

	/**
	 * Canonical "spells known" casters. In both 2014 and 2024 these classes use a fixed
	 * personal spell list (swap one on level-up), unlike prepared casters who re-prepare
	 * freely. 2024 stores their counts in `preparedSpellsProgression` despite the rename.
	 * @type {string[]}
	 */
	static KNOWN_CASTER_NAMES = ["Bard", "Ranger", "Sorcerer", "Warlock"];

	/**
	 * Canonical prepared casters — re-prepare from the full class list (Wizard from spellbook).
	 * @type {string[]}
	 */
	static PREPARED_CASTER_NAMES = ["Cleric", "Druid", "Paladin", "Wizard", "Artificer"];

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
		if (!CharacterSheetClassUtils.KNOWN_CASTER_NAMES.includes(className)) return 0;
		return 1;
	}

	/**
	 * Resolve a class's spellcasting model: "known" | "prepared" | "none".
	 *
	 * Edition-agnostic. Bard, Ranger, Sorcerer, and Warlock are KNOWN casters in BOTH
	 * editions — the 2024 rules only renamed "spells known" to "prepared spells" while
	 * keeping the mechanic (a fixed personal list, swapping one spell on level-up). The
	 * 2024 data therefore stores `preparedSpellsProgression` for EVERY caster, so the
	 * canonical known-caster set must be classified by NAME *before* the
	 * `preparedSpellsProgression` check. The genuine prepared casters (Cleric, Druid,
	 * Paladin, Wizard, Artificer) re-prepare freely from the whole list each long rest.
	 *
	 * This is the single source of truth shared by the state classifier
	 * (`_getClassSpellcastingInfo`) and the QuickBuild known/prepared detection.
	 *
	 * @param {{name?: string, source?: string, classData?: *}} [opts]
	 * @returns {"known"|"prepared"|"none"}
	 */
	static getClassSpellcastingModel (/** @type {*} */ {name, source, classData} = {}) {
		const cd = classData || {};
		const className = name || cd.name;

		// 1. Explicit 2014-style known progression (Bard/Ranger/Sorcerer/Warlock + homebrew).
		if (cd.spellsKnownProgression) return "known";

		// 2. Canonical known casters by name — covers 2024, where they share the
		//    `preparedSpellsProgression` field with genuine prepared casters.
		if (className && CharacterSheetClassUtils.KNOWN_CASTER_NAMES.includes(className)) return "known";

		// 3. Prepared progression / formula (Cleric/Druid/Paladin/Wizard, both editions).
		//    `spellsKnownProgressionFixed` is the Wizard spellbook (a prepared caster).
		if (cd.preparedSpellsProgression || cd.preparedSpells || cd.spellsKnownProgressionFixed) return "prepared";

		// 4. Canonical prepared casters by name (minimal class objects lacking progression).
		if (className && CharacterSheetClassUtils.PREPARED_CASTER_NAMES.includes(className)) return "prepared";

		// 5. Any other spellcaster defaults to prepared; non-casters have no model.
		if (cd.casterProgression || cd.spellcastingAbility) return "prepared";
		return "none";
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

	static normalizeSubclassChoice (/** @type {*} */ choice) {
		return this.normalizeDivineSoulAffinity(choice);
	}

	static hasNamedSubclassChoice (/** @type {*} */ subclass) {
		return this.isDivineSoulSubclass(subclass)
			|| (this.isDaemonologistSubclass(subclass) && (subclass.additionalSpells || []).some((/** @type {*} */ block) => block?.name));
	}

	static getNamedSubclassChoiceOptions (/** @type {*} */ subclass) {
		if (!this.hasNamedSubclassChoice(subclass)) return [];
		const allowedNames = this.isDaemonologistSubclass(subclass)
			? new Set(["arch daemon", "arch seraph"])
			: null;
		return (subclass.additionalSpells || [])
			.filter((/** @type {*} */ block) => block?.name && (!allowedNames || allowedNames.has(String(block.name).toLowerCase())))
			.map((/** @type {*} */ block) => this.normalizeSubclassChoice(block.name))
			.filter(Boolean);
	}

	static getNamedSubclassChoiceBlock (/** @type {*} */ subclass, /** @type {*} */ subclassChoice) {
		if (!this.hasNamedSubclassChoice(subclass)) return null;
		const normalized = this.normalizeSubclassChoice(subclassChoice);
		if (!normalized) return null;
		return (subclass.additionalSpells || []).find((/** @type {*} */ block) =>
			this.normalizeSubclassChoice(block?.name)?.key === normalized.key) || null;
	}

	static getNamedSubclassChoicePrompt (/** @type {*} */ subclass) {
		if (this.isDivineSoulSubclass(subclass)) {
			return {
				title: "Divine Soul Affinity",
				description: "Choose the Divine Soul affinity that grants your extra spell and Cleric spell access.",
			};
		}
		if (this.isDaemonologistSubclass(subclass)) {
			return {
				title: "Fair and Foul",
				description: "Choose whether you begin by siphoning power from Arch Daemons or Arch Seraphs.",
			};
		}
		return null;
	}

	static getOptionalFeaturePrerequisiteClassAliases (/** @type {*} */ subclass, /** @type {*} */ featureTypes) {
		if (!this.isDaemonologistSubclass(subclass) || !featureTypes?.includes("EI")) return {};
		return {Warlock: "Wizard"};
	}

	static getDivineSoulAffinityOptions (/** @type {*} */ subclass) {
		if (!this.isDivineSoulSubclass(subclass)) return [];
		return this.getNamedSubclassChoiceOptions(subclass);
	}

	static getDivineSoulAffinityBlock (/** @type {*} */ subclass, /** @type {*} */ subclassChoice) {
		if (!this.isDivineSoulSubclass(subclass)) return null;
		return this.getNamedSubclassChoiceBlock(subclass, subclassChoice);
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
	 * Get known-spell count at a class level (for known-caster classes only).
	 *
	 * Returns null for any class that is not a "known" spellcasting model, so callers can
	 * safely use it as both a detector and a count source. For 2024 known casters
	 * (Ranger/Bard/Sorcerer/Warlock), whose data carries `preparedSpellsProgression`
	 * instead of `spellsKnownProgression`, the count comes from that progression.
	 * @param {*} classData - The class data
	 * @param {string} className - The class name
	 * @param {number} classLevel - The class level
	 * @returns {number|null} Known spell count, or null if not a known caster
	 */
	static getKnownSpellsAtLevel (/** @type {*} */ classData, /** @type {*} */ className, /** @type {*} */ classLevel) {
		if (CharacterSheetClassUtils.getClassSpellcastingModel({name: className, classData}) !== "known") return null;
		const prog = classData.spellsKnownProgression
			|| classData.preparedSpellsProgression
			|| (/** @type {*} */ (CharacterSheetClassUtils._SPELLS_KNOWN_TABLES))[className];
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
				if (/** @type {*} */ typeof entry === "object"
					&& entry.type === "abilityDc"
					&& Array.isArray(entry.attributes)
					&& entry.attributes.length > 1) {
					results.push({
						count: 1,
						options: entry.attributes.map((ability) => ({
							name: Parser.attAbvToFull(ability),
							type: "inline",
							source: feature.source,
							entries: [`Use ${Parser.attAbvToFull(ability)} for ${entry.name || feature.name}.`],
						})),
					});
				}

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

		// "choose one of the following skills: ... You have proficiency in that skill."
		// (e.g. Moon Bard "Primal Lore"). Fixed list of named skills → single proficiency.
		if (/choose one of the following skills/i.test(text) && /proficiency in that skill/i.test(text)) {
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
	 * Resolve the list of skill options to offer for a feature skill sub-choice
	 * (proficiency / expertise / bonus).
	 *
	 * When `choice.from` is a fixed array (e.g. a subclass feature that names six
	 * specific skills) it is returned as-is. When it is `"any_proficient"` the
	 * options are derived from the character's ACTUAL skill proficiencies so that
	 * custom skills, TGTT Lore skills, and the TGTT `Might` skill (all real
	 * proficiencies) appear alongside the 18 standard skills — previously the
	 * picker hardcoded the 18 standard skills and silently dropped everything else.
	 *
	 * The returned values are display names; the caller round-trips them back to
	 * canonical keys via `name.toLowerCase().replace(/\s+/g, "")`, which is exactly
	 * how custom/Lore skill keys are stored, so a picked custom skill applies to
	 * that same custom skill.
	 * @param {{from: (string|string[])}} choice - Parsed skill choice.
	 * @param {*} state - CharacterSheetState (may be null/undefined during early build steps).
	 * @returns {string[]} Display names to offer as checkboxes.
	 */
	static resolveFeatureSkillChoiceOptions (/** @type {*} */ choice, /** @type {*} */ state) {
		if (Array.isArray(choice?.from)) return choice.from;
		const proficient = CharacterSheetClassUtils.getProficientSkillDisplayNames(state);
		return proficient.length ? proficient : [...CharacterSheetClassUtils.STANDARD_SKILLS];
	}

	/**
	 * Build the sorted list of display names for every skill the character is
	 * proficient in (level >= 1), covering standard, hardcoded-homebrew (e.g.
	 * `cooking`, `might`), custom, and TGTT Lore skills.
	 * @param {*} state - CharacterSheetState.
	 * @returns {string[]} Sorted display names.
	 */
	static getProficientSkillDisplayNames (/** @type {*} */ state) {
		if (!state?.getSkillProficiencies) return [];

		/** @type {Object<string, string>} */ const displayByKey = {};
		for (const name of CharacterSheetClassUtils.STANDARD_SKILLS) {
			displayByKey[name.toLowerCase().replace(/\s+/g, "")] = name;
		}
		// getCustomSkills() includes Lore skills; both are keyed by their stored name.
		const customs = state.getCustomSkills?.() || [];
		for (/** @type {*} */ const cs of customs) {
			if (!cs?.name) continue;
			displayByKey[cs.name.toLowerCase().replace(/\s+/g, "")] = cs.name;
		}

		const profs = state.getSkillProficiencies() || {};
		/** @type {string[]} */ const out = [];
		for (const key of Object.keys(profs)) {
			if ((profs[key] || 0) < 1) continue;
			out.push(displayByKey[key] || (key.charAt(0).toUpperCase() + key.slice(1)));
		}
		return out.sort((a, b) => a.localeCompare(b));
	}

	// =========================================================================
	// Subclass-feature prose choices (skill proficiency + bonus off-list cantrip).
	//
	// Some subclass features grant a fixed-list skill proficiency AND/OR a "bonus"
	// cantrip drawn from ANOTHER class's spell list that does NOT count against the
	// character's cantrips-known (e.g. the College of the Moon Bard's "Primal Lore":
	// learn Druidic + one Druid cantrip that doesn't count against cantrips known +
	// one of six skills). The generic FeatureChoiceParser in charactersheet-state.js
	// only recognises the "either A or B" phrasing, so these are seeded here from the
	// progression flows (LevelUp / QuickBuild) via the SAME pending-feature-choice
	// pipeline (state.addPendingFeatureChoice → page.processPendingFeatureChoices →
	// state.fulfillFeatureChoice) that every flow already drains. Because the cantrip
	// is fulfilled with `sourceFeature = feature.name` (NOT one of
	// PLAYER_CHOSEN_SPELL_FEATURES) it is added as a non-counting bonus cantrip.
	// =========================================================================

	/** Concatenate a feature's string entries for prose scanning (tags intact). */
	static _getFeatureProseText (/** @type {*} */ feature) {
		const entries = feature?.entries;
		if (Array.isArray(entries)) {
			const strings = entries.filter((/** @type {*} */ e) => typeof e === "string");
			if (strings.length) return strings.join(" ");
		}
		return typeof feature?.description === "string" ? feature.description : "";
	}

	/**
	 * Detect a "choose one of the following skills: … You have proficiency in that
	 * skill." fixed-list proficiency choice on a feature. Returns the normalized skill
	 * keys (lowercase, no spaces — matching state's `skillProficiencies` keys) or null.
	 * @param {*} feature
	 * @returns {{options: string[], count: number}|null}
	 */
	static findFixedSkillProficiencyChoiceInFeature (/** @type {*} */ feature) {
		const text = CharacterSheetClassUtils._getFeatureProseText(feature);
		if (!text) return null;
		if (!/choose one of the following skills/i.test(text) || !/proficiency in that skill/i.test(text)) return null;

		const displayNames = CharacterSheetClassUtils.extractSkillListFromText(text);
		if (displayNames.length < 2) return null;
		const options = displayNames.map((/** @type {*} */ s) => s.toLowerCase().replace(/\s+/g, ""));
		return {options, count: 1};
	}

	/**
	 * Detect a "one cantrip from the <Class> spell list … doesn't count against the
	 * number of cantrips you know" bonus off-list cantrip grant on a feature.
	 * @param {*} feature
	 * @returns {{className: string, replaceable: boolean}|null}
	 */
	static findBonusListCantripGrantInFeature (/** @type {*} */ feature) {
		const text = CharacterSheetClassUtils._getFeatureProseText(feature);
		if (!text) return null;
		if (!/doesn't count against the number of cantrips you know/i.test(text)) return null;

		const m = /one cantrip from the (\w+) spell list/i.exec(text);
		if (!m) return null;
		return {
			className: m[1].toTitleCase(),
			replaceable: /replace this cantrip/i.test(text),
		};
	}

	/**
	 * Build the {name, source} option list of every cantrip on a class's spell list.
	 * @param {Array<*>} allSpells - Full spell database.
	 * @param {string} className - Class whose cantrip list to gather (e.g. "Druid").
	 * @returns {Array<{name: string, source: string}>}
	 */
	static getClassCantripOptions (/** @type {*} */ allSpells, /** @type {*} */ className) {
		if (!Array.isArray(allSpells) || !className) return [];
		const out = [];
		const seen = new Set();
		for (const spell of allSpells) {
			if (spell?.level !== 0) continue;
			if (!CharacterSheetClassUtils.spellIsForClass(spell, className)) continue;
			const key = `${spell.name}|${spell.source}`.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({name: spell.name, source: spell.source});
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Seed pending feature choices (skill proficiency + bonus off-list cantrip) for any
	 * subclass features in `features` that grant them (e.g. Moon Bard "Primal Lore").
	 * Idempotent per build run: the cantrip is skipped once a cantrip sourced from the
	 * feature already exists, and duplicate pending entries are de-duped by
	 * `state.addPendingFeatureChoice`'s signature check.
	 * @param {*} state - CharacterSheetState.
	 * @param {Array<*>} features - Features gained (e.g. this level's new features).
	 * @param {{allSpells?: Array<*>}} [opts]
	 * @returns {boolean} True if at least one choice was seeded.
	 */
	static seedSubclassFeatureChoices (/** @type {*} */ state, /** @type {*} */ features, {allSpells = /** @type {*[]} */ ([])} = /** @type {*} */ ({})) {
		if (!state?.addPendingFeatureChoice || !Array.isArray(features)) return false;
		let seeded = false;

		for (const feature of features) {
			if (!feature?.name) continue;
			const featureId = feature.id || feature.name;

			const skillChoice = CharacterSheetClassUtils.findFixedSkillProficiencyChoiceInFeature(feature);
			if (skillChoice && !(typeof state.hasFulfilledFeatureSkillChoice === "function" && state.hasFulfilledFeatureSkillChoice(feature.name))) {
				if (state.addPendingFeatureChoice({
					featureName: feature.name,
					featureId,
					kind: "skill",
					options: skillChoice.options,
					count: skillChoice.count,
				})) seeded = true;
			}

			const cantripGrant = CharacterSheetClassUtils.findBonusListCantripGrantInFeature(feature);
			if (cantripGrant) {
				const alreadyGranted = (state.getCantripsKnown?.() || [])
					.some((/** @type {*} */ c) => c.sourceFeature === feature.name);
				const options = alreadyGranted ? [] : CharacterSheetClassUtils.getClassCantripOptions(allSpells, cantripGrant.className);
				if (options.length >= 2) {
					if (state.addPendingFeatureChoice({
						featureName: feature.name,
						featureId,
						kind: "cantrip",
						options,
						count: 1,
					})) seeded = true;
				}
			}

			// JSON-structured "choose one of the following sub-features" choices — Divine
			// Order (Protector/Thaumaturge), Blessed Strikes (Divine Strike/Potent
			// Spellcasting), Principles of Devotion, Specialties, etc. Generic: the state
			// resolves the option pool (inline `type:"options"` or a cross-referenced pool)
			// and enriches each option with a short description. Per-instance scoping key is
			// name+source+level, so a recurring series (Specialties L3/7/11/15/20) re-offers.
			if (typeof state.getStructuredFeatureChoices === "function") {
				const groups = state.getStructuredFeatureChoices(feature) || [];
				for (const group of groups) {
					// ⚠️ MERGE-OVERLAP FLAG (R44 Bug 9): Principles of Devotion (Cleric TGTT) is
					// OPT-IN and fully Overview-managed — the player chooses / changes / clears
					// it from the Overview tab, never as a forced level-up choice. Skip
					// auto-seeding it here so it is never pushed as a mandatory pending choice.
					// This is the single, deliberately narrow edit to this method's body,
					// permitted because opt-in Principles cannot be achieved without it.
					if (String(feature.name || "").trim().toLowerCase() === "principles of devotion") continue;

					// (a) Already resolved for THIS parent-instance (class + level-scoped)?
					if (typeof state.hasChosenSubfeatureForParent === "function"
						&& state.hasChosenSubfeatureForParent(feature.name, feature.source, feature.level, feature.className, feature.classSource)) continue;

					// (b) Builder / QuickBuild / LevelUp already applied a sub-feature inline for
					// this parent+level (feature present with matching parentFeature)? Record
					// it durably (the inline paths don't) so recurring-series exclusion and
					// higher-level upgrades (e.g. Improved Blessed Strikes) see the pick, then
					// skip re-offering.
					const appliedFeatures = (state._data?.features || []).filter((/** @type {*} */ f) =>
						String(f?.parentFeature || "").toLowerCase() === String(feature.name || "").toLowerCase()
						&& (feature.level == null || Number(f?.level) === Number(feature.level)));
					if (appliedFeatures.length) {
						if (typeof state._recordChosenSubfeature === "function") {
							appliedFeatures.forEach((/** @type {*} */ f) => state._recordChosenSubfeature({
								parent: feature.name,
								parentSource: feature.source,
								parentClass: feature.className,
								parentClassSource: feature.classSource,
								level: feature.level != null ? feature.level : null,
								name: f.name,
								source: f.source,
							}));
						}
						continue;
					}

					// (c) No-repeat series — exclude every option already chosen across levels
					// (scoped to this class so a multiclass same-named series stays separate).
					let options = group.options;
					if (group.unique && typeof state.getChosenSubfeatureKeysForSeries === "function") {
						const taken = state.getChosenSubfeatureKeysForSeries(feature.name, feature.source, feature.className, feature.classSource);
						options = options.filter((/** @type {*} */ o) => !taken.has(`${String(o.name).toLowerCase()}|${String(o.source || "").toLowerCase()}`));
					}
					if (!Array.isArray(options) || options.length < 2) continue;

					if (state.addPendingFeatureChoice({
						featureName: feature.name,
						featureId,
						featureSource: feature.source,
						featureClass: feature.className,
						featureClassSource: feature.classSource,
						level: feature.level,
						kind: "subfeature",
						options,
						count: group.count || 1,
						unique: group.unique,
					})) seeded = true;
				}
			}
		}

		return seeded;
	}

	/**
	 * Replace a feature-sourced bonus cantrip (e.g. Moon Bard "Primal Lore") with a new
	 * one, preserving its non-counting status. Removes the prior cantrip sourced from
	 * `featureName` and adds `newSpell` with the same `sourceFeature`. Backs the rules
	 * allowance to swap the granted cantrip on each level-up.
	 * @param {*} state - CharacterSheetState.
	 * @param {string} featureName - Source feature name (e.g. "Primal Lore").
	 * @param {*} newSpell - Full spell object to add.
	 * @param {{sourceClass?: string}} [opts]
	 * @returns {boolean} True if a replacement occurred.
	 */
	static replaceBonusFeatureCantrip (/** @type {*} */ state, /** @type {*} */ featureName, /** @type {*} */ newSpell, {sourceClass = null} = /** @type {*} */ ({})) {
		if (!state?.getCantripsKnown || !featureName || !newSpell?.name) return false;
		const prior = (state.getCantripsKnown() || []).filter((/** @type {*} */ c) => c.sourceFeature === featureName);
		for (const c of prior) {
			state.removeSpell(c.id || `${c.name}|${c.source}`, c.source);
		}
		state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(newSpell, {sourceFeature: featureName, sourceClass}));
		return true;
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
	/**
	 * Parse the level a subclass-feature reference is gained at.
	 *
	 * The 5etools subclassFeature ref format is
	 * `name|className|classSource|subclassShortName|subclassSource|level[|displayText]`
	 * so the level is canonically `parts[5]`. Many modern reprints (e.g. FRHoF
	 * Bladesinger, every Artificer EFA subclass, all PHB Cleric domains) carry an
	 * OPTIONAL 7th display-source element, which made the previous
	 * `parts[parts.length - 1]` parse return `NaN` and silently grant ZERO
	 * subclass features. Read `parts[5]` first, only falling back to the last
	 * element for malformed/legacy refs where `parts[5]` is non-numeric.
	 * @param {string[]} parts Pipe-split subclassFeature reference parts.
	 * @returns {number} The gained level, or `NaN` if it cannot be determined.
	 */
	static getSubclassFeatureRefLevel (/** @type {*} */ parts) {
		if (!Array.isArray(parts)) return NaN;
		const canonical = parseInt(parts[5]);
		if (!Number.isNaN(canonical)) return canonical;
		return parseInt(parts[parts.length - 1]);
	}

	/**
	 * Names of the sub-features a parent feature offers as a level-up CHOICE, rather
	 * than granting outright.
	 *
	 * The bare-sibling `refClassFeature` encoding is read by two places with different
	 * rules: `FeatureChoiceParser._extractStructuredChoices` classifies it from the
	 * prose, while `getLevelFeatures`'s extraction loop below materialises it from the
	 * shape. Because the identical shape means "learn all" for Cunning Strike and
	 * "learn one" for Blessed Strikes, no rule local to that loop can separate them —
	 * so it defers to the parser's verdict here instead of re-deriving one.
	 *
	 * @param {*} feature
	 * @returns {Set<string>} lower-cased option names; empty when the feature offers no choice.
	 */
	static getChoiceOptionNames (/** @type {*} */ feature) {
		const out = new Set();
		// `getLevelFeatures` is a static helper with no state handle, so the parser is
		// reached through the global it publishes (charactersheet-state.js).
		const parser = /** @type {*} */ (globalThis).FeatureChoiceParser;
		if (typeof parser?.extractChoices !== "function") return out;
		let groups;
		try { groups = parser.extractChoices(feature)?.subfeatureChoices; } catch (e) { return out; }
		if (!Array.isArray(groups)) return out;
		for (const group of groups) {
			if (!Array.isArray(group?.options)) continue;
			for (const opt of group.options) {
				if (opt?.name) out.add(String(opt.name).trim().toLowerCase());
			}
		}
		return out;
	}

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
			// Player choices encoded WITHOUT an `options` wrapper (bare sibling refs, e.g.
			// Blessed Strikes) are skipped via getChoiceOptionNames, which defers to the
			// parser rather than guessing from the shape — see that method for why.
			const featureNames = new Set(features.map((/** @type {*} */ f) => f.name));
			const extracted = [];
			for (const feature of features) {
				if (!feature.entries) continue;
				const choiceOptionNames = CharacterSheetClassUtils.getChoiceOptionNames(feature);
				for (/** @type {*} */ const entry of feature.entries) {
					if (typeof entry !== "object" || !Array.isArray(entry.entries)) continue;
					if (entry.type === "options") continue;
					for (/** @type {*} */ const sub of entry.entries) {
						if (sub?.type !== "refClassFeature" || !sub.classFeature) continue;
						const refParts = sub.classFeature.split("|");
						const refName = refParts[0];
						if (choiceOptionNames.has(String(refName).trim().toLowerCase())) continue;
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
									// (CS-BUG-079) Preserve the activation marker. Only the
									// refSubclassFeature expansion below used to copy it, so a
									// subclass option collected through THIS path lost its
									// `consumes` tag and could not be linked to its shared pool.
									// `uses` is deliberately NOT propagated here: it would mint a
									// new resource pool for features that merely document a count.
									...(feature.consumes ? {consumes: feature.consumes} : {}),
								});
							}
						} else if (typeof feature === "string") {
							const parts = feature.split("|");
							const featureLevel = CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts);
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
									// (CS-BUG-079) Preserve the activation marker. Only the
									// refSubclassFeature expansion below used to copy it, so a
									// subclass option collected through THIS path lost its
									// `consumes` tag and could not be linked to its shared pool.
									// `uses` is deliberately NOT propagated here: it would mint a
									// new resource pool for features that merely document a count.
									...(fullFeature?.consumes ? {consumes: fullFeature.consumes} : {}),
								});
							}
						}
					});
				} else if (typeof levelFeatures === "string") {
					const parts = levelFeatures.split("|");
					const featureLevel = CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts);
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
							// (CS-BUG-079) Preserve the activation marker. Only the
							// refSubclassFeature expansion below used to copy it, so a
							// subclass option collected through THIS path lost its
							// `consumes` tag and could not be linked to its shared pool.
							// `uses` is deliberately NOT propagated here: it would mint a
							// new resource pool for features that merely document a count.
							...(fullFeature?.consumes ? {consumes: fullFeature.consumes} : {}),
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
					// (CS-BUG-079) Preserve the activation marker. Only the
					// refSubclassFeature expansion below used to copy it, so a
					// subclass option collected through THIS path lost its
					// `consumes` tag and could not be linked to its shared pool.
					// `uses` is deliberately NOT propagated here: it would mint a
					// new resource pool for features that merely document a count.
					...(feature.consumes ? {consumes: feature.consumes} : {}),
				});
			});
		}

		// Expand refSubclassFeature entries from wrapper features (e.g., "Thief" feature that references "Fast Hands").
		// Many subclasses have a wrapper feature at the subclass level that contains references to actual
		// sub-features. Some wrappers nest references SEVERAL layers deep — e.g. the Hellspeaker subclass
		// wrapper references "Invoke Hell", whose OWN entries reference the actual options ("Honey-Sweet
		// Blades", "Turncoat"). We therefore recurse into each referenced feature's entries so deeply-nested
		// options surface, and we keep recursing even when the referenced wrapper itself is skipped (e.g. its
		// name collides with the class-level "Invoke Hell" feature that is already present — in which case we
		// still want its child options, just not a duplicate passive wrapper).
		/** @type {*[]} */ const expandedFeatures = [];
		/** @type {Set<string>} */ const expandVisited = new Set();

		// Look for refSubclassFeature entries in a set of entries, recursing into both nested entries and the
		// entries of any referenced feature so multi-level wrapper chains are fully resolved.
		const searchEntriesForRefs = (/** @type {*} */ entries) => {
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
					const refLevelParsed = CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts);
					const refLevel = Number.isNaN(refLevelParsed) ? level : refLevelParsed;

					// Only expand features at current level, and guard against re-processing / cycles.
					const visitKey = `${refFeatureName}|${refLevel}`;
					if (refLevel === level && !expandVisited.has(visitKey)) {
						expandVisited.add(visitKey);

						// Look up the referenced subclass feature
						const refFeature = CharacterSheetClassUtils.getSubclassFeatureData(
							subclassFeatures,
							refFeatureName,
							refClassName,
							refSubclassShortName,
							refSubclassSource,
							refLevel,
						);

						if (refFeature) {
							const alreadyPresent = features.some((/** @type {*} */ f) => f.name === refFeatureName && f.level === refLevel)
								|| expandedFeatures.some((/** @type {*} */ f) => f.name === refFeatureName && f.level === refLevel);
							if (!alreadyPresent) {
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
									// (R20 #17) Preserve activation markers so the option classifies/links
									// correctly downstream (e.g. Invoke Hell options carry
									// `consumes: {name: "Invoke Hell"}` and draw on the shared short-rest pool).
									...(refFeature.consumes ? {consumes: refFeature.consumes} : {}),
									...(refFeature.uses ? {uses: refFeature.uses} : {}),
								});
							}

							// Recurse into the referenced feature's OWN entries so nested options
							// (refSubclassFeature chains) are surfaced even when this wrapper was skipped
							// as a duplicate (e.g. subclass "Invoke Hell" colliding with class "Invoke Hell").
							searchEntriesForRefs(refFeature.entries);
						}
					}
				}
				// Recurse into nested entries
				if (entry?.entries) searchEntriesForRefs(entry.entries);
			}
		};

		for (const feature of features) {
			if (!(/** @type {*} */ (feature)).isSubclassFeature || !(/** @type {*} */ (feature)).entries) continue;
			searchEntriesForRefs(feature.entries);
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
	// Weapon Mastery (level-up detection)
	// ==========================================

	/**
	 * Parse the number of weapon masteries a "Weapon Mastery" feature grants from its
	 * prose entries (e.g. 2024 Fighter "two kinds", Illrigger TGTT "two kinds of weapons").
	 * Mirrors the builder's `_parseWeaponMasteryCount` so all flows agree.
	 * @param {Array<*>} entries
	 * @returns {number} parsed count, defaulting to 2
	 */
	static parseWeaponMasteryCountFromEntries (/** @type {*} */ entries) {
		if (!Array.isArray(entries) || !entries.length) return 2;
		const text = entries
			.map((/** @type {*} */ e) => (typeof e === "string" ? e : JSON.stringify(e)))
			.join(" ")
			.toLowerCase();
		if (text.includes("four kinds")) return 4;
		if (text.includes("three kinds")) return 3;
		if (text.includes("two kinds")) return 2;
		if (text.includes("one kind")) return 1;
		return 2;
	}

	/**
	 * Read the weapon-mastery count for a class at a given level from its
	 * `classTableGroups` (the authoritative source for the generic 2024 classes whose
	 * count scales by level). Returns 0 when no mastery column is present.
	 * @param {*} classData
	 * @param {number} level
	 * @returns {number}
	 */
	static getWeaponMasteryCountFromTable (/** @type {*} */ classData, /** @type {*} */ level) {
		if (!classData?.classTableGroups?.length || !level) return 0;
		for (const tableGroup of classData.classTableGroups) {
			const masteryColIndex = tableGroup.colLabels?.findIndex(
				(/** @type {*} */ col) => typeof col === "string" && (col === "Weapon Mastery" || col.toLowerCase().includes("mastery")),
			);
			if (masteryColIndex == null || masteryColIndex === -1) continue;
			const row = tableGroup.rows?.[level - 1];
			if (!row) continue;
			const value = row[masteryColIndex];
			if (typeof value === "number") return value;
			if (typeof value === "string") return parseInt(value) || 0;
		}
		return 0;
	}

	/**
	 * Compute the weapon-mastery count granted by a class at a single character level,
	 * combining the class table (scaling 2024 classes) with the prose of any "Weapon
	 * Mastery" feature listed at/below that level (homebrew like the Illrigger TGTT
	 * feature, which has no table column). Returns 0 when the class never grants masteries
	 * at or below `level`.
	 * @param {*} classData
	 * @param {number} level
	 * @param {Array<*>} [classFeatures=[]]
	 * @returns {number}
	 */
	static getWeaponMasteryCountAtLevel (/** @type {*} */ classData, /** @type {*} */ level, /** @type {*} */ classFeatures = []) {
		if (!classData || !level || level < 1) return 0;
		let count = CharacterSheetClassUtils.getWeaponMasteryCountFromTable(classData, level);

		// Walk each level up to `level` for a "Weapon Mastery" class feature and take the
		// highest prose-parsed count (covers fixed-count homebrew with no table column).
		for (let lvl = 1; lvl <= level; lvl++) {
			const levelFeatures = CharacterSheetClassUtils.getLevelFeatures(classData, lvl, null, classFeatures, []);
			const masteryFeature = levelFeatures.find((/** @type {*} */ f) => f.name === "Weapon Mastery");
			if (masteryFeature) {
				const parsed = CharacterSheetClassUtils.parseWeaponMasteryCountFromEntries(masteryFeature.entries || []);
				if (parsed > count) count = parsed;
			}
		}
		return count;
	}

	/**
	 * Detect whether crossing from `prevLevel` → `newLevel` first grants OR increases a
	 * class's weapon-mastery allotment, so the level-up flow can offer the picker at the
	 * exact level the masteries are gained (bug #12). Returns the NEW total count to
	 * choose, or null when nothing changed.
	 * @param {*} classData
	 * @param {number} prevLevel - class level before this level-up
	 * @param {number} newLevel - class level after this level-up
	 * @param {Array<*>} [classFeatures=[]]
	 * @returns {{count: number}|null}
	 */
	static getWeaponMasteryGainForLevelUp (/** @type {*} */ classData, /** @type {*} */ prevLevel, /** @type {*} */ newLevel, /** @type {*} */ classFeatures = []) {
		if (!classData || !newLevel) return null;
		const countAtNew = CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(classData, newLevel, classFeatures);
		if (countAtNew <= 0) return null;
		const countAtPrev = prevLevel > 0
			? CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(classData, prevLevel, classFeatures)
			: 0;
		// Offer the picker on first grant or any increase (re-pick the full set).
		if (countAtNew > countAtPrev) return {count: countAtNew};
		return null;
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
	 * Number of NEW *swappable* Forked Tongue spoken languages a character gains when their
	 * Illrigger level crosses the given range. Detection mirrors the name-based signal used by
	 * CharacterSheetState (`hasForkedTongue` @ class level 1, `hasForkedTongueImprovement` @ 9) —
	 * the base "Forked Tongue" feature lives in the external MCDM "IllriggerRevised" homebrew and
	 * its prose does not match the generic language-grant regex, so we key off the class name.
	 *
	 * - 2 when the range first reaches Illrigger level 1 (the initial Forked Tongue choices).
	 * - +1 when the range first reaches Illrigger level 9 (Forked Tongue Improvement).
	 *
	 * @param {string} className - The class being levelled (case-insensitive match on "Illrigger").
	 * @param {number} prevLevel - The class level BEFORE this change (0 at first level).
	 * @param {number} newLevel - The class level AFTER this change.
	 * @returns {{count: number}} New swappable languages granted across (prevLevel, newLevel].
	 */
	static getForkedTongueSwappableGrant (/** @type {*} */ className, /** @type {*} */ prevLevel, /** @type {*} */ newLevel) {
		if (!className || String(className).toLowerCase() !== "illrigger") return {count: 0};
		const prev = Number.isFinite(prevLevel) ? prevLevel : 0;
		const next = Number.isFinite(newLevel) ? newLevel : 0;
		let count = 0;
		if (prev < 1 && next >= 1) count += 2; // initial Forked Tongue (2 swappable)
		if (prev < 9 && next >= 9) count += 1; // Forked Tongue Improvement (+1)
		return {count};
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

	/**
	 * Central resolver for the effective subclass of a class entry.
	 *
	 * Some saved characters (and a class of stale exports) carry
	 * `cls.subclass === null` even though their subclass features are present in
	 * the character's flat `features[]` array (each `isSubclassFeature: true`,
	 * with `subclassName`/`subclassShortName`/`subclassSource`). Every detector
	 * that keys on `cls.subclass` (e.g. `hasArcaneShot`, `getSubclassGrantedTraditions`)
	 * silently no-ops on such data. This resolver heals the lookup WITHOUT
	 * mutating state: if `cls.subclass` is already populated it is returned as-is;
	 * otherwise we reconstruct a normalized `{name, shortName, source}` object from
	 * the embedded subclass features that belong to this class.
	 *
	 * Reconstruction is deliberately conservative:
	 * - Only features whose `className`/`classSource` match the class entry count.
	 * - If those features reference MORE THAN ONE distinct subclass (by
	 *   shortName), we return `null` rather than guess — picking the wrong one
	 *   could corrupt source-gated TGTT logic.
	 * - The reconstructed `source` is taken from the LOWEST-level matching
	 *   subclass feature (the gain-level feature, e.g. an L3 "Arcane Archer"
	 *   feature sourced to TGTT) rather than a later backfill feature that may be
	 *   sourced to the official book (e.g. an L7 feature sourced to XGE).
	 *
	 * @param {*} cls - The class entry (`{name, source, subclass, ...}`).
	 * @param {Array<*>} features - The character's flat features array.
	 * @returns {*} The effective subclass object, or `null` if none/ambiguous.
	 */
	static getSubclassFromFeatures (/** @type {*} */ cls, /** @type {Array<*>} */ features) {
		if (!cls) return null;
		if (cls.subclass) return cls.subclass;
		if (!Array.isArray(features) || !features.length) return null;

		const clsName = cls.name;
		const clsSource = cls.source;

		// Name-level match: the feature must be a subclass feature that identifies a
		// subclass and belongs to a class of this name (when a className is present).
		const nameMatches = features.filter((/** @type {*} */ f) => {
			if (!f || !f.isSubclassFeature) return false;
			if (!(f.subclassShortName || f.subclassName)) return false;
			if (f.className && clsName && f.className !== clsName) return false;
			return true;
		});
		if (!nameMatches.length) return null;

		// classSource disambiguation is only meaningful when this class actually owns
		// some of the name-matching features by source (e.g. a genuine same-name
		// multiclass: Barbarian|PHB + Barbarian|XPHB, each with its own features). When
		// NO name-matching feature aligns with this class's source — e.g. a TGTT
		// Barbarian re-using the official XPHB "World Tree" subclass features — matching
		// on class name alone is correct; requiring the source to match would wrongly
		// drop every feature and leave the subclass unrepaired.
		const hasSourceAligned = nameMatches.some((/** @type {*} */ f) => f.classSource && clsSource && f.classSource === clsSource);
		const matching = hasSourceAligned
			? nameMatches.filter((/** @type {*} */ f) => !f.classSource || !clsSource || f.classSource === clsSource)
			: nameMatches;
		if (!matching.length) return null;

		// Collect distinct subclasses keyed by shortName (case-insensitive).
		const byKey = new Map();
		for (const f of matching) {
			const shortName = f.subclassShortName || f.subclassName;
			const key = String(shortName).toLowerCase();
			if (!byKey.has(key)) byKey.set(key, []);
			byKey.get(key).push(f);
		}
		// Ambiguous: more than one distinct subclass for this class → do not guess.
		if (byKey.size !== 1) return null;

		const featuresForSubclass = byKey.values().next().value;
		// Choose the source from the lowest-level matching feature (gain-level).
		const sorted = [...featuresForSubclass].sort((/** @type {*} */ a, /** @type {*} */ b) => {
			const la = Number(a.level) || 0;
			const lb = Number(b.level) || 0;
			return la - lb;
		});
		const primary = sorted[0];
		const shortName = primary.subclassShortName || primary.subclassName;
		const name = primary.subclassName || primary.subclassShortName;
		const source = primary.subclassSource || primary.source || clsSource;

		return {name, shortName, source};
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
	 * Build a grouped, filter-friendly model for the combat-tradition picker.
	 *
	 * The picker's underlying selection stays a FLAT array of two-letter codes
	 * (`selectedCodes`); this only shapes how those codes are *presented*:
	 * - `grantedCodes` are auto-included in the selection and rendered as LOCKED
	 *   (a fixed tradition the subclass always grants — the player can't drop it).
	 * - `availableCodes` restricts the choosable list (e.g. an Arcane Archer can
	 *   only pick from BZ/RE/UW/UH). When empty, every tradition is choosable.
	 * - Any already-selected code that is neither granted nor in the available
	 *   pool is surfaced in an "Other" group so an out-of-pool legacy pick is
	 *   never silently hidden (or dropped) by the UI.
	 *
	 * @param {string[]} selectedCodes - Currently selected tradition codes (flat).
	 * @param {{grantedCodes?: string[], availableCodes?: string[]}} [opts]
	 * @returns {{selected: string[], groups: Array<{key:string,label:string,locked:boolean,traditions:Array<{code:string,name:string,locked:boolean,selected:boolean}>}>, grantedCodes: string[], choosableCodes: string[]}}
	 */
	static buildTraditionSelectionModel (/** @type {string[]} */ selectedCodes, {grantedCodes = /** @type {string[]} */ ([]), availableCodes = /** @type {string[]} */ ([])} = {}) {
		const all = CharacterSheetClassUtils.getAllTraditions();
		const nameOf = (/** @type {string} */ code) => CharacterSheetClassUtils.getTraditionName(code);

		const granted = [...new Set((grantedCodes || []).filter(Boolean))];
		const selected = [...new Set((selectedCodes || []).filter(Boolean))];
		// Granted traditions are always selected (and locked).
		for (const g of granted) if (!selected.includes(g)) selected.push(g);

		const grantedSet = new Set(granted);
		const availSet = new Set((availableCodes || []).filter(Boolean));

		const choosableCodes = (availSet.size ? Array.from(availSet) : all.map(t => t.code))
			.filter(c => !grantedSet.has(c));

		const knownSet = new Set([...grantedSet, ...choosableCodes]);
		const otherCodes = selected.filter(c => !knownSet.has(c));

		const toEntry = (/** @type {string} */ code) => ({
			code,
			name: nameOf(code),
			locked: grantedSet.has(code),
			selected: selected.includes(code),
		});
		const byName = (/** @type {*} */ a, /** @type {*} */ b) => a.name.localeCompare(b.name);

		const groups = [
			{key: "granted", label: "Granted by subclass (locked)", locked: true, traditions: granted.map(toEntry).sort(byName)},
			{key: "available", label: "Available", locked: false, traditions: choosableCodes.map(toEntry).sort(byName)},
			{key: "other", label: "Other (currently selected)", locked: false, traditions: otherCodes.map(toEntry).sort(byName)},
		].filter(g => g.traditions.length);

		return {selected, groups, grantedCodes: granted, choosableCodes};
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
	 * Whether a feature is a TGTT Battle Tactic (optionalFeatureType "BT"). Battle
	 * tactics render in their own dedicated combat-tab section (with reaction buttons +
	 * attack-bonus toggles), so they must never be treated as passive modifiers or as
	 * generic activatable active-states (e.g. Last Ditch Evasion is a reaction, not a
	 * toggle). Mirrors `isCombatMethod`.
	 * @param {*} feature
	 * @returns {boolean}
	 */
	static isBattleTactic (/** @type {*} */ feature) {
		if (!feature) return false;
		if (feature.optionalFeatureTypes?.some?.((/** @type {*} */ ft) => ft === "BT")) return true;
		if (Array.isArray(feature.featureType) && feature.featureType.some((/** @type {*} */ ft) => ft === "BT")) return true;
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
	 * @returns {Array<{name: string, kind: "usable"|"passive"|"method", actionType?: string, appliedElsewhere?: boolean, note: string}>}
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
				// Pursuit's +10 ft is already APPLIED as a real `speed:walk` named modifier
				// (and shown in the Speed breakdown), so it is flagged appliedElsewhere and
				// kept out of the "remember to use" reminder rows — it is not something the
				// player has to actively invoke.
				out.push({name: "Pursuit", kind: "passive", appliedElsewhere: true, note: "Your walking speed increases by 10 feet while in Predator focus."});
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
		out.push({name: "Hunter's Dodge", kind: "usable", actionType: "reaction", note: CharacterSheetClassUtils.getHuntersDodgeNote()});
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
	 * Generic classification predicate: should a Primal-Focus mode ability (from
	 * `getPrimalFocusModeAbilities`) be surfaced on an at-a-glance reminder list?
	 *
	 * Reminder surfaces (Overview Primal Focus block, Combat focus panel, the Primal
	 * Focus feature card) only want actionable controls (`usable`) and watch-for
	 * passives (`passive`). Two categories are deliberately excluded, BY KIND/FLAG
	 * (never by name) so the rule stays data-driven:
	 *  - `kind: "method"` — granted combat methods live in (and are actioned from) the
	 *    Combat Methods section; echoing them here is duplicative noise.
	 *  - `appliedElsewhere: true` — the entire effect is already concretely applied and
	 *    shown on another panel (e.g. Pursuit's +10 ft is a real speed modifier in the
	 *    Speed breakdown), so a "remember to use" reminder would double-surface it.
	 *
	 * Uses a positive whitelist so any future/unknown `kind` is excluded by default.
	 *
	 * @param {*} ability - One entry from `getPrimalFocusModeAbilities`.
	 * @returns {boolean}
	 */
	static isPrimalFocusReminderAbility (/** @type {*} */ ability) {
		return !!ability
			&& ["usable", "passive"].includes(ability.kind)
			&& !ability.appliedElsewhere;
	}

	/**
	 * Primal-Focus abilities that have their OWN dedicated control row (with a use
	 * counter) on every play surface, and therefore must NOT also be echoed in the
	 * generic focus-mode ability-row list. Kept as a named list (not an inline
	 * `!== "Hunter's Dodge"` check scattered across surfaces) so the de-dupe rule is
	 * shared and can't silently regress on one tab. Hunter's Dodge renders as a
	 * "🛡️ Hunter's Dodge N/M + Use" row on Overview, Combat, and the Features card.
	 * @type {string[]}
	 */
	static PRIMAL_FOCUS_DEDICATED_ROW_ABILITIES = ["Hunter's Dodge"];

	/**
	 * Should a Primal-Focus mode ability appear in the GENERIC reminder ability-row
	 * list? True when it's a reminder ability AND it doesn't already have its own
	 * dedicated control row (see {@link PRIMAL_FOCUS_DEDICATED_ROW_ABILITIES}).
	 * Use this on every surface that renders `charsheet__ranger-ability-row`s so the
	 * dedicated-row abilities are never double-listed.
	 * @param {*} ability - One entry from `getPrimalFocusModeAbilities`.
	 * @returns {boolean}
	 */
	static isPrimalFocusAbilityRowEligible (/** @type {*} */ ability) {
		return CharacterSheetClassUtils.isPrimalFocusReminderAbility(ability)
			&& !CharacterSheetClassUtils.PRIMAL_FOCUS_DEDICATED_ROW_ABILITIES.includes(ability?.name);
	}

	/**
	 * Canonical Hunter's Dodge (Ranger Prey focus) reminder note. Single source of
	 * truth shared by the focus-mode ability catalog and the dedicated use-button
	 * row's hover, so the two never drift.
	 * @returns {string}
	 */
	static getHuntersDodgeNote () {
		return "When a creature you can see attacks you or an ally within 30 feet, grant the target a bonus to AC equal to your proficiency bonus for that attack.";
	}

	/**
	 * Build a list of the Ranger's active passive / situational feature reminders
	 * from the flat `getFeatureCalculations()` output. These features grant
	 * always-on or situational benefits that previously had no at-a-glance home on
	 * a play surface (they only existed as Feature-tab encyclopedia cards). The list
	 * is purely derived from the calc flags, so it stays in sync with the feature
	 * pipeline and is easy to extend.
	 *
	 * Notes are intentionally worded to AVOID duplicating information already
	 * surfaced elsewhere (senses, resources, saving throws) — they highlight the
	 * situational reminder, not the numbers shown on those panels.
	 *
	 * Inclusion rule: a feature is surfaced ONLY when it carries a situational /
	 * conditional benefit that the player must actively invoke or watch for, with no
	 * dedicated home elsewhere on the sheet. Features whose ENTIRE mechanical benefit
	 * is already concretely applied and visible on another panel (Skills/Expertise,
	 * Languages, Spells, Resources, the Rest dialog) would be redundant noise, so they
	 * are tagged `appliedElsewhere: true` in the catalog and filtered out. This keeps
	 * the rule data-driven and self-documenting (a new fully-applied feature just sets
	 * the flag) rather than maintaining a separate denylist.
	 *
	 * @param {*} calcs - Output of `state.getFeatureCalculations()`.
	 * @returns {Array<{name: string, note: string, notes?: string[], source: string, level: (number|null), icon: string}>}
	 */
	static getRangerPassiveReminders (/** @type {*} */ calcs = {}) {
		const c = calcs || {};
		const out = [];
		const add = (cond, entry) => { if (cond) out.push(entry); };

		// --- Core / always-on Ranger line ---
		// Deft Explorer: Expertise, extra languages, and the extra prepared spell are
		// all baked into state and shown on the Skills / Languages / Spells panels —
		// nothing situational remains, so it is excluded from the reminder list.
		add(c.hasDeftExplorer, {name: "Deft Explorer", note: "Expertise in a skill, two extra languages, and an extra prepared spell from your Canny/Tracker benefits.", source: "TGTT", level: 1, icon: "🧭", appliedElsewhere: true});

		// --- TGTT mid-level passives ---
		// Enduring Traveler bundles three mechanically-distinct benefits; surface them as
		// separate `notes` bullets so each reads cleanly (the renderer falls back to the
		// joined `note` string when `notes` is absent, and the string is kept for
		// at-a-glance/title text + backward compatibility).
		add(c.hasEnduringTraveler, {
			name: "Enduring Traveler",
			notes: [
				"Immune to extreme cold, extreme heat, and high altitude.",
				"Automatically succeed on saving throws against exhaustion caused by natural travel or your environment.",
				"You can perform a second camp or journey activity in the same segment.",
			],
			note: "Immune to extreme cold, extreme heat, and high altitude; auto-succeed saves vs. exhaustion from natural travel/environment. You can perform a second camp/journey activity in the same segment.",
			source: "TGTT",
			level: 4,
			icon: "⛰️",
		});

		// Tireless: the exhaustion-reduction is applied interactively in the short-rest
		// dialog and the temp-HP grant is tracked in Resources — its whole benefit lives
		// on other surfaces, so it is excluded from the reminder list.
		add(c.hasTireless, {name: "Tireless", note: "Exhaustion reduction is applied from the short-rest dialog; the temp-HP grant is tracked in Resources.", source: "XPHB", level: 10, icon: "💪", appliedElsewhere: true});

		add(c.hasEphemeralInsight, {name: "Ephemeral Insight", note: "After studying a subject for 1 hour, gain a relevant skill or tool proficiency until you use this feature again.", source: "TGTT", level: 8, icon: "📖"});

		add(c.hasUnrivaledPioneer, {name: "Unrivaled Pioneer", note: "Reliable Survivalist: treat a d20 of 9 or lower as a 10 on Nature/Survival and navigation/tracking checks. Pick two skills to gain Expertise in. (Advantage on initiative; INT & WIS save proficiency shown on your saves.)", source: "TGTT", level: 9, icon: "🗺️"});

		add(c.hasInfallibleBearing, {name: "Infallible Bearing", note: "You always know the direction and approximate distance to the last creature you marked as your Quarry.", source: "TGTT", level: 13, icon: "🧲"});

		add(c.hasPenetratingSenses, {name: "Penetrating Senses", note: `Within ${c.penetratingSensesRange || 60} feet you can see invisible creatures, see through visual illusions, and perceive a shapechanger's true form. (Not truesight.)`, source: "TGTT", level: 14, icon: "🔮"});

		// Apex Sentinel: blindsight is already shown in Senses — surface the aura + tracking reminder.
		add(c.hasApexSentinel, {name: "Apex Sentinel", note: `Allies within ${c.apexSentinelAuraRange || 30} feet gain a bonus to their tracking/perception while you guide them, and you can track with uncanny precision. (Blindsight is shown in Senses.)`, source: "TGTT", level: 17, icon: "👁️"});

		add(c.hasBattleInstincts, {name: "Battle Instincts", note: "You can't be surprised while conscious, damage can't break your concentration, and you can retaliate with a reaction attack when a creature misses you (once per round).", source: "TGTT", level: 18, icon: "⚡"});

		add(c.hasApexFocus, {name: "Apex Focus", note: "Your speed is doubled, you never have disadvantage on weapon attacks, and you gain temporary hit points at the start of each of your turns. (Toggle the +2 AC option in combat when not in heavy armor.)", source: "TGTT", level: 20, icon: "🌟"});

		// --- Classic / XPHB-only passives (gated off for TGTT in the calc pipeline) ---
		add(c.hasHideInPlainSight, {name: "Hide in Plain Sight", note: "Spend 1 minute to camouflage yourself; gain a bonus to Stealth checks while you remain in place.", source: "PHB", level: 10, icon: "🌿"});
		add(c.hasRelentlessHunter, {name: "Relentless Hunter", note: "Taking damage can't break your concentration on Hunter's Mark.", source: "XPHB", level: 13, icon: "🎯"});
		add(c.hasVanish, {name: "Vanish", note: "You can Hide as a Bonus Action and can't be tracked by nonmagical means.", source: "PHB", level: 14, icon: "💨"});
		add(c.hasNaturesVeil, {name: "Nature's Veil", note: `As a Bonus Action, become invisible until the end of your next turn (${c.naturesVeilUses ?? "prof."}/long rest).`, source: "XPHB", level: 14, icon: "🍃"});
		add(c.hasPreciseHunter, {name: "Precise Hunter", note: "You have advantage on attack rolls against the creature currently marked by your Hunter's Mark.", source: "XPHB", level: 17, icon: "🏹"});
		add(c.hasFeralSenses, {name: "Feral Senses", note: `You can attack creatures you can't see without disadvantage and sense invisible creatures within ${c.feralSensesRange || 30} feet.`, source: "PHB", level: 18, icon: "👂"});
		add(c.hasFoeSlayer, {name: "Foe Slayer", note: `Once per turn, add +${c.foeSlayerBonus ?? "WIS"} to an attack or damage roll against your favored enemy.`, source: "PHB", level: 20, icon: "⚔️"});

		// Surface only genuinely situational reminders; features whose entire benefit is
		// already applied/shown on another panel are tagged `appliedElsewhere` and dropped.
		return out.filter(e => !e.appliedElsewhere);
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

	/**
	 * Score how "rich" a combat-method catalog entry is, so de-duplication can
	 * keep the most informative copy. The new `combatMethod` entity (explicit
	 * `tradition`/`degree`/`staminaCost`) is preferred over a legacy CTM
	 * optionalfeature that only encodes those via `featureType` strings.
	 * @param {*} m
	 * @returns {number}
	 */
	static _combatMethodRichness (/** @type {*} */ m) {
		if (!m) return -1;
		let r = 0;
		if (m._entityType === "combatMethod") r += 4;
		if (m.tradition !== undefined) r += 2;
		if (m.degree !== undefined) r += 1;
		if (m.staminaCost !== undefined) r += 1;
		if (Array.isArray(m.entries) && m.entries.length) r += 1;
		return r;
	}

	/**
	 * De-duplicate a combat-method picker catalog by `name|source` (case
	 * insensitive). The method picker concatenates the legacy optionalfeature
	 * pool with the new combatMethod entity pool; a method present in both
	 * would otherwise render as twin add/remove rows. When a `name|source`
	 * collides, the richer entry (see `_combatMethodRichness`) wins.
	 * @param {Array<*>} methods
	 * @returns {Array<*>}
	 */
	static dedupeCombatMethodCatalog (/** @type {*[]} */ methods = []) {
		const byKey = new Map();
		for (/** @type {*} */ const m of methods) {
			if (!m || !m.name) continue;
			const key = `${String(m.name).toLowerCase()}|${String(m.source || "").toLowerCase()}`;
			const existing = byKey.get(key);
			if (!existing) { byKey.set(key, m); continue; }
			if (CharacterSheetClassUtils._combatMethodRichness(m) > CharacterSheetClassUtils._combatMethodRichness(existing)) {
				byKey.set(key, m);
			}
		}
		return Array.from(byKey.values());
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
	static buildSpellStateObject (/** @type {*} */ spell, {sourceFeature, sourceClass, prepared = false, inSpellbook = false, ability = null}) {
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
			spellcastingAbility: ability || null,
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
	 * @param {string|null} [opts.ability] - Per-cantrip spellcasting ability override (e.g. a racial cantrip whose ability is chosen by the player)
	 * @returns {*} Cantrip state object
	 */
	static buildCantripStateObject (/** @type {*} */ spell, {sourceFeature, sourceClass, ability = null}) {
		return {
			name: spell.name,
			source: spell.source,
			school: spell.school,
			sourceFeature,
			sourceClass,
			spellcastingAbility: ability || null,
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
	static buildInnateSpellStateObject (/** @type {*} */ spell, {sourceFeature, atWill = false, uses, recharge = "long", ability = null, ritualOnly = false}) {
		return {
			name: spell.name,
			source: spell.source,
			level: spell.level,
			school: spell.school,
			atWill,
			uses,
			recharge,
			sourceFeature,
			spellcastingAbility: ability || null,
			castingTime: CharacterSheetClassUtils.getSpellCastingTime(spell),
			range: CharacterSheetClassUtils.getSpellRange(spell),
			components: CharacterSheetClassUtils.getSpellComponents(spell),
			duration: CharacterSheetClassUtils.getSpellDuration(spell),
			concentration: CharacterSheetClassUtils.spellIsConcentration(spell),
			ritual: CharacterSheetClassUtils.spellIsRitual(spell),
			// A grant that reads "but only as a ritual" — the caster can never spend a
			// slot on it. Kept separate from `ritual` (which is just the spell's tag).
			ritualOnly,
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
			// Proficiency-grant fields (5ET-843). Preserving these on the history
			// snapshot lets respec / stub features re-grant skill/tool/language
			// proficiencies on rebuild even when `ref` is set (so we don't roundtrip
			// the full entries).
			skillProficiencies: outFeature.skillProficiencies,
			toolProficiencies: outFeature.toolProficiencies,
			languageProficiencies: outFeature.languageProficiencies,
			skillToolLanguageProficiencies: outFeature.skillToolLanguageProficiencies,
			savingThrowProficiencies: outFeature.savingThrowProficiencies,
			_replaces: outFeature._replaces,
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
		if (!state || typeof getClassData !== "function") return {added: 0, backfilled: 0, classesProcessed: 0};

		const classes = state.getClasses?.() || [];
		let added = 0;
		let backfilled = 0;
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

				// (R22 #13/#7) Re-attach canonical `entries` to features that ALREADY exist
				// (so they were skipped by the dedupe above) but were persisted without them
				// by an older save — e.g. an Illrigger's Forked Tongue stored with only a
				// rendered description. Generic: scoped by name + class/subclass identity,
				// lenient on source so a TGTT `_copy` (base-brew-sourced canonical) still
				// matches the stored copy-sourced feature.
				if (typeof state.backfillFeatureContentFromCanonical === "function") {
					for (const lf of levelFeatures) {
						const didPatch = state.backfillFeatureContentFromCanonical(lf, {
							className: classEntry.name,
							level: lf.level || lvl,
							subclassName: classEntry.subclass?.name,
							isSubclassFeature: !!(lf.subclassName || lf.isSubclassFeature),
						});
						if (didPatch) backfilled++;
					}
				}
			}
		}

		return {added, backfilled, classesProcessed};
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
						state.setAbilityBase(ability, CharacterSheetClassUtils.capAbilityIncrease(current, amount, max));
					} else if (choices.ability) {
						// Apply chosen ability from feat choices
						const amount = ablChoice.choose.amount || 1;
						const current = state.getAbilityBase(choices.ability);
						state.setAbilityBase(choices.ability, CharacterSheetClassUtils.capAbilityIncrease(current, amount, max));
					}
				} else {
					Object.entries(ablChoice).forEach(([abl, bonus]) => {
						if (abl === "max") return;
						if (Parser.ABIL_ABVS.includes(abl)) {
							const current = state.getAbilityBase(abl);
							state.setAbilityBase(abl, CharacterSheetClassUtils.capAbilityIncrease(current, bonus, max));
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
				{name: "Rage",
					maxByLevel: (/** @type {*} */ lvl) => CharacterSheetState.getRageUsesMaxForClass({
						name: "Barbarian",
						source: classEntry.source || classData.source,
						level: lvl,
					}),
					recharge: "long"},
			],
			"Monk": [
				{name: "__MONK_RESOURCE__", maxByLevel: (/** @type {*} */ lvl) => lvl >= 2 ? lvl : 0, recharge: "short"},
			],
			"Sorcerer": [
				{name: "Sorcery Points",
					maxByLevel: (/** @type {*} */ lvl) => {
						// CS-BUG-080: single source of truth shared with
						// `getFeatureCalculations()` and `_ensureSorceryPoints()`.
						// TGTT Sorcerer grants Font of Magic at L1 (not L2 like
						// XPHB), so SP = sorcerer level from L1 onward. Was
						// previously `lvl + 1` here (CS-BUG-018) and STILL was in
						// the calculation copy until CS-BUG-080.
						const source = classEntry.source === "TGTT" || classData.source === "TGTT" ? "TGTT" : classData.source;
						return CharacterSheetState.getSorceryPointsMaxForClass({name: "Sorcerer", source, level: lvl});
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

	/**
	 * Determine the character level at which a race/subrace (or similar) feature
	 * ENTRY becomes available. Honors an explicit numeric `level`; otherwise parses
	 * the leading "unlock" sentence of the feature's first text entry using the
	 * "When you reach character level N" / "Starting at Nth level" prose convention
	 * already used elsewhere in the codebase. Defaults to 1 (always-on) when no
	 * leading gate is present.
	 *
	 * IMPORTANT: the match is anchored to the START of the first text entry, so
	 * later in-sentence scaling text ("...the damage increases when you reach 5th
	 * level...", e.g. Dragonborn Breath Weapon — a level-1 feature) never falsely
	 * gates the whole feature. When in doubt it returns 1, i.e. it never hides a
	 * feature that lacks an explicit leading level gate.
	 * @param {*} feature
	 * @returns {number}
	 */
	static getFeatureUnlockLevel (/** @type {*} */ feature) {
		if (!feature) return 1;
		if (typeof feature.level === "number" && feature.level > 0) return feature.level;

		const lead = CharacterSheetClassUtils._getFeatureLeadText(feature);
		if (!lead) return 1;

		const m = lead.match(/^when you reach (?:character\s+)?level\s+(\d+)\b/i)
			|| lead.match(/^when you reach (?:the\s+)?(\d+)(?:st|nd|rd|th)\s+level\b/i)
			|| lead.match(/^once you reach (?:character\s+)?level\s+(\d+)\b/i)
			|| lead.match(/^once you reach (?:the\s+)?(\d+)(?:st|nd|rd|th)\s+level\b/i)
			|| lead.match(/^(?:starting|beginning) at (?:character\s+)?level\s+(\d+)\b/i)
			|| lead.match(/^(?:starting|beginning) at (?:the\s+)?(\d+)(?:st|nd|rd|th)\s+level\b/i)
			|| lead.match(/^at (?:character\s+)?level\s+(\d+)\b/i)
			|| lead.match(/^at (?:the\s+)?(\d+)(?:st|nd|rd|th)\s+level\b/i);
		if (m) {
			const lvl = parseInt(m[1], 10);
			if (lvl >= 1 && lvl <= 20) return lvl;
		}
		return 1;
	}

	/**
	 * Extract the plain-text first text entry of a feature, with 5etools @tags and
	 * any HTML stripped, for leading level-gate detection.
	 * @private
	 * @param {*} feature
	 * @returns {string}
	 */
	static _getFeatureLeadText (/** @type {*} */ feature) {
		let raw = null;
		const entries = feature.entries;
		if (Array.isArray(entries)) {
			raw = entries.find((/** @type {*} */ e) => typeof e === "string") || null;
			if (!raw) {
				const objWithStr = entries.find((/** @type {*} */ e) =>
					e && typeof e === "object" && Array.isArray(e.entries) && e.entries.some((/** @type {*} */ se) => typeof se === "string"));
				if (objWithStr) raw = objWithStr.entries.find((/** @type {*} */ se) => typeof se === "string");
			}
		}
		if (!raw && typeof feature.description === "string") raw = feature.description;
		if (!raw || typeof raw !== "string") return "";

		let txt = raw;
		try { if (typeof Renderer !== "undefined" && Renderer.stripTags) txt = Renderer.stripTags(txt); } catch (e) { /* fall through to regex strip */ }
		txt = txt.replace(/<[^>]+>/g, " ");
		return txt.trim();
	}

	/**
	 * Reconcile race + subrace ENTRY features against the current total character
	 * level. Adds entry features whose unlock level has been reached and removes
	 * race/subrace entry features that are now above the character's level (e.g.
	 * after a level-down / respec). Idempotent — safe to call on every level change.
	 *
	 * Mirrors {@link updateRacialSpells} (which only handles `additionalSpells`);
	 * this handles the descriptive/level-gated trait entries — most notably the
	 * Aasimar "Celestial Revelation" trait, which unlocks at character level 3.
	 * @param {*} state - CharacterSheetState instance
	 * @param {*} [page] - unused; accepted for call-site parity with updateRacialSpells
	 */
	static updateRacialFeatures (/** @type {*} */ state, /** @type {*} */ page) {
		const race = state.getRace?.();
		const subrace = state.getSubrace?.();
		if (!race && !subrace) return;

		const totalLevel = state.getTotalLevel?.() || 1;

		/** @type {{entry:*, featureType:string, fallbackSource:string}[]} */
		const sources = [];
		const collect = (/** @type {*} */ data, /** @type {string} */ featureType) => {
			if (!Array.isArray(data?.entries)) return;
			data.entries.forEach((/** @type {*} */ entry) => {
				if (entry && typeof entry === "object" && entry.name) {
					sources.push({entry, featureType, fallbackSource: data.source});
				}
			});
		};
		collect(race, "Species");
		collect(subrace, "Subrace");
		if (!sources.length) return;

		// Remove race/subrace entry features now gated ABOVE the current level
		// (handles over-grant cleanup and level-down / respec).
		const overLevelKeys = new Set();
		sources.forEach(({entry, featureType, fallbackSource}) => {
			if (CharacterSheetClassUtils.getFeatureUnlockLevel(entry) > totalLevel) {
				overLevelKeys.add(`${featureType}|${entry.name}|${entry.source || fallbackSource}`);
			}
		});
		if (overLevelKeys.size) {
			(state.getFeatures?.() || [])
				.filter((/** @type {*} */ f) => (f.featureType === "Species" || f.featureType === "Subrace")
					&& overLevelKeys.has(`${f.featureType}|${f.name}|${f.source}`))
				.forEach((/** @type {*} */ f) => state.removeFeature(f.id));
		}

		// Add entries whose unlock level has been reached. addFeature dedups by
		// name+source, so already-present features are skipped.
		sources.forEach(({entry, featureType, fallbackSource}) => {
			if (CharacterSheetClassUtils.getFeatureUnlockLevel(entry) > totalLevel) return;
			state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
				{...entry, source: entry.source || fallbackSource},
				{featureType},
			));
		});

		// Re-apply the Hochling "Divine Manifestation" choice so its level-gated
		// options (Aasimar transformation @ L3, War God's Blessing @ L6) surface as
		// the character levels up past the builder's L1 race step.
		CharacterSheetClassUtils.applyRaceManifestation(state, page);
	}

	/**
	 * Curated definition of every Hochling "Divine Manifestation" option. Each option is
	 * either the special Aasimar transformation or one or more Cleric Channel-Divinity
	 * features from an approved domain. Only identifiers + a concise fallback description
	 * are stored here — the real rules `entries` are resolved at apply time from the loaded
	 * Cleric subclass-feature catalog (so this stays data-driven, not 16 hand-authored
	 * features). `requiresSave` marks options whose DC equals 8 + your proficiency bonus +
	 * your chosen Wisdom/Intelligence/Charisma modifier (the Divine Spark ability).
	 *
	 * The order of this object is also the order the builder picker presents the options.
	 * @returns {Object<string, {label:string, desc:string, aasimar?:boolean, description?:string, cd?:{cdName:string, sub:string, level:number, requiresSave?:boolean, description:string}[]}>}
	 */
	static getRaceManifestationOptionDefs () {
		return {
			trickery: {
				label: "Trickery Domain \u2014 Channel Divinity",
				desc: "Invoke Duplicity (illusory duplicate), and Cloak of Shadows (invisibility) at character level 6.",
				cd: [
					{cdName: "Channel Divinity: Invoke Duplicity", sub: "Trickery", level: 1, description: "As an action, create a perfect illusory duplicate of yourself in an unoccupied space within 30 feet for 1 minute (concentration). On your turn you can move it (bonus action), and you have advantage on attack rolls against any creature within 5 feet of both you and the illusion."},
					{cdName: "Channel Divinity: Cloak of Shadows", sub: "Trickery", level: 6, description: "As an action, become invisible until the end of your next turn or until you attack, make a damage roll, or cast a spell."},
				],
			},
			light: {
				label: "Light Domain \u2014 Channel Divinity",
				desc: "Radiance of the Dawn: dispel magical darkness and deal radiant damage (Constitution save).",
				cd: [
					{cdName: "Channel Divinity: Radiance of the Dawn", sub: "Light", level: 1, requiresSave: true, description: "As an action, dispel magical darkness within 30 feet and deal radiant damage to hostile creatures there: 2d10 + your character level, halved on a successful Constitution saving throw."},
				],
			},
			tempest: {
				label: "Tempest Domain \u2014 Channel Divinity",
				desc: "Destructive Wrath: maximize one lightning or thunder damage roll.",
				cd: [
					{cdName: "Channel Divinity: Destructive Wrath", sub: "Tempest", level: 1, description: "When you roll lightning or thunder damage, use your Channel Divinity to deal maximum damage instead of rolling."},
				],
			},
			grave: {
				label: "Grave Domain \u2014 Channel Divinity",
				desc: "Path to the Grave: curse a creature so the next hit against it has vulnerability.",
				cd: [
					{cdName: "Channel Divinity: Path to the Grave", sub: "Grave", level: 1, description: "As an action, curse a creature you can see within 30 feet until the end of your next turn. The next time you or an ally hits it with an attack, it has vulnerability to all of that attack's damage, then the curse ends."},
				],
			},
			war: {
				label: "War Domain \u2014 Channel Divinity",
				desc: "Guided Strike (+10 to one attack roll), and War God's Blessing at character level 6.",
				cd: [
					{cdName: "Channel Divinity: Guided Strike", sub: "War", level: 1, description: "You can use your Channel Divinity to strike with supernatural accuracy. When you make an attack roll, you can use your Channel Divinity to gain a +10 bonus to the roll. You make this choice after you see the roll, but before the DM says whether the attack hits or misses."},
					{cdName: "Channel Divinity: War God's Blessing", sub: "War", level: 6, description: "When a creature within 30 feet of you makes an attack roll, you can use your reaction to grant a +10 bonus to the roll, using your Channel Divinity. You make this choice after you see the roll, but before the DM says whether the attack hits or misses."},
				],
			},
			peace: {
				label: "Peace Domain \u2014 Channel Divinity",
				desc: "Balm of Peace: move without provoking opportunity attacks and heal creatures you pass.",
				cd: [
					{cdName: "Channel Divinity: Balm of Peace", sub: "Peace", level: 1, description: "As an action, move up to your Speed without provoking opportunity attacks. When you come within 5 feet of another creature during this move, you can restore 2d6 + your Wisdom modifier hit points to it (minimum 1); a creature can benefit only once per use."},
				],
			},
			order: {
				label: "Order Domain \u2014 Channel Divinity",
				desc: "Order's Demand: charm creatures around you (Wisdom save).",
				cd: [
					{cdName: "Channel Divinity: Order's Demand", sub: "Order", level: 1, requiresSave: true, description: "As an action, each creature of your choice that you can see within 30 feet must succeed on a Wisdom saving throw or be charmed by you until the end of your next turn or until it takes damage. You can also make each charmed creature drop what it's holding."},
				],
			},
			knowledge: {
				label: "Knowledge Domain \u2014 Channel Divinity",
				desc: "Knowledge of the Ages (gain a proficiency), and Read Thoughts (Wisdom save) at character level 6.",
				cd: [
					{cdName: "Channel Divinity: Knowledge of the Ages", sub: "Knowledge", level: 1, description: "As an action, gain proficiency with one skill or tool of your choice for 10 minutes."},
					{cdName: "Channel Divinity: Read Thoughts", sub: "Knowledge", level: 6, requiresSave: true, description: "As an action, choose one creature within 60 feet. It must succeed on a Wisdom saving throw or you can read its surface thoughts and gain advantage on Wisdom (Insight) and Charisma checks against it for 1 minute."},
				],
			},
			nature: {
				label: "Nature Domain \u2014 Channel Divinity",
				desc: "Charm Animals and Plants: charm nearby beasts and plant creatures (Wisdom save).",
				cd: [
					{cdName: "Channel Divinity: Charm Animals and Plants", sub: "Nature", level: 1, requiresSave: true, description: "As an action, each beast or plant creature of your choice that you can see within 30 feet must succeed on a Wisdom saving throw or be charmed by you for 1 minute or until it takes damage."},
				],
			},
			forge: {
				label: "Forge Domain \u2014 Channel Divinity",
				desc: "Artisan's Blessing: craft a nonmagical item through an hour-long ritual.",
				cd: [
					{cdName: "Channel Divinity: Artisan's Blessing", sub: "Forge", level: 1, description: "Through a 1-hour ritual you can create one nonmagical item \u2014 a simple or martial weapon, a suit of armor, ten pieces of ammunition, or a similar object \u2014 worth no more than 100 gp, requiring an amount of metal in raw materials."},
				],
			},
			death: {
				label: "Death Domain \u2014 Channel Divinity",
				desc: "Touch of Death: deal extra necrotic damage when you hit with a melee attack.",
				cd: [
					{cdName: "Channel Divinity: Touch of Death", sub: "Death", level: 1, description: "When you hit a creature with a melee attack, you can use your Channel Divinity to deal extra necrotic damage to the target equal to 5 + twice your character level."},
				],
			},
			beauty: {
				label: "Beauty Domain \u2014 Channel Divinity",
				desc: "All Eyes on Me: force creatures to fixate on you (Wisdom save).",
				cd: [
					{cdName: "Channel Divinity: All Eyes on Me", sub: "Beauty", level: 1, requiresSave: true, description: "As an action, present your holy symbol and force up to five creatures of your choice that can see you within 30 feet to make a Wisdom saving throw. On a failure, their attention fixes on you, giving them disadvantage on attack rolls, ability checks, and saving throws against creatures other than you."},
				],
			},
			blood: {
				label: "Blood Domain \u2014 Channel Divinity",
				desc: "Blood Curse: congeal a wounded creature's blood, restraining it (Constitution save).",
				cd: [
					{cdName: "Channel Divinity: Blood Curse", sub: "Blood", level: 1, requiresSave: true, description: "As an action, curse a creature within 60 feet that has blood and that you have damaged. It must succeed on a Constitution saving throw or be restrained for 1 minute as its blood congeals, repeating the save at the end of each of its turns to end the effect."},
				],
			},
			time: {
				label: "Time Domain \u2014 Channel Divinity",
				desc: "Temporal Manipulation: speed up or slow time to grant advantage or disadvantage.",
				cd: [
					{cdName: "Channel Divinity: Temporal Manipulation", sub: "Time", level: 1, description: "When a creature you can see within 60 feet uses its action in a way that requires a d20 roll, you can use your reaction to grant it advantage (by speeding up time) or impose disadvantage (by slowing time) on that action."},
				],
			},
			madness: {
				label: "Madness Domain \u2014 Channel Divinity",
				desc: "Touch of Madness (incapacitate, Wisdom save), and Paranoia at character level 6.",
				cd: [
					{cdName: "Channel Divinity: Touch of Madness", sub: "Madness", level: 1, requiresSave: true, description: "As an action, force a creature within 30 feet to make a Wisdom saving throw. On a failure, divine madness infects its mind and it is incapacitated for up to 1 minute, babbling incoherently and repeating the save at the end of each of its turns to end the effect."},
					{cdName: "Channel Divinity: Paranoia", sub: "Madness", level: 6, requiresSave: true, description: "As an action, present your holy symbol toward a creature within 30 feet. It must succeed on a Wisdom saving throw or become frightened of the nearest visible creature within 30 feet for 1 minute."},
				],
			},
			lust: {
				label: "Lust Domain \u2014 Channel Divinity",
				desc: "Impulsive Infatuation: charm a creature into rash action in your defense (Wisdom save).",
				cd: [
					{cdName: "Channel Divinity: Impulsive Infatuation", sub: "Lust", level: 1, requiresSave: true, description: "As an action, present your holy symbol and force one creature you can see within 30 feet to make a Wisdom saving throw. On a failure, it is charmed by you until the start of your next turn and must immediately use its reaction to move toward and defend you."},
				],
			},
			darkness: {
				label: "Darkness Domain \u2014 Channel Divinity",
				desc: "Cloying Darkness (extinguish light, Constitution save), and Night Terrors at character level 6.",
				cd: [
					{cdName: "Channel Divinity: Cloying Darkness", sub: "Darkness", level: 1, requiresSave: true, description: "As an action, conjure a sphere of darkness: light sources within 30 feet are extinguished and lower-level magical lights dispelled, and creatures of your choice within 30 feet must make a Constitution saving throw or be affected by the smothering dark."},
					{cdName: "Channel Divinity: Night Terrors", sub: "Darkness", level: 6, requiresSave: true, description: "As an action, conjure a 10-foot-radius cloud of darkness centered on a creature within 30 feet. The target must make a Wisdom saving throw, taking 8d4 psychic damage and becoming frightened on a failure."},
				],
			},
			aasimar: {
				label: "Celestial Revelation (Aasimar Transformation)",
				desc: "Gain the Aasimar Celestial Revelation transformation (available at character level 3).",
				aasimar: true,
				description: "When you reach character level 3, you can transform as a Bonus Action using one of the "
					+ "options below (choose the option each time you transform). The transformation lasts for 1 minute or "
					+ "until you end it (no action required). Once you transform, you can't do so again until you finish a "
					+ "Long Rest. Here are the transformation options: Heavenly Wings. Two spectral wings sprout from your "
					+ "back temporarily. Until the transformation ends, you have a Fly Speed equal to your Speed.",
			},
		};
	}

	/**
	 * Resolve the chosen Wisdom/Intelligence/Charisma ability that powers a Hochling's
	 * Divine Manifestation saving-throw DC. Reuses the Divine Spark cantrip's chosen
	 * casting ability (the first cantrip carrying an explicit per-spell ability), falling
	 * back to any innate spell's override, then the global spellcasting ability, then WIS.
	 * @param {*} state
	 * @returns {string} An ability abbreviation (e.g. "wis").
	 */
	static getRaceManifestationAbility (/** @type {*} */ state) {
		const abv = ["wis", "int", "cha"];
		const isWisIntCha = (/** @type {*} */ a) => typeof a === "string" && abv.includes(a.toLowerCase());

		const cantrip = (state?.getCantrips?.() || []).find((/** @type {*} */ c) => isWisIntCha(c.spellcastingAbility));
		if (cantrip) return cantrip.spellcastingAbility.toLowerCase();

		const innate = (state?.getInnateSpells?.() || []).find((/** @type {*} */ s) => isWisIntCha(s.spellcastingAbility));
		if (innate) return innate.spellcastingAbility.toLowerCase();

		const global = state?.getSpellcastingAbility?.();
		if (isWisIntCha(global)) return global.toLowerCase();
		return "wis";
	}

	/**
	 * Compute a Hochling's Divine Manifestation saving-throw DC: 8 + proficiency bonus +
	 * the modifier of the chosen Wisdom/Intelligence/Charisma ability (the Divine Spark
	 * ability). Works with no spellcasting class present.
	 * @param {*} state
	 * @returns {number}
	 */
	static computeRaceManifestationDc (/** @type {*} */ state) {
		const ability = CharacterSheetClassUtils.getRaceManifestationAbility(state);
		const prof = state?.getProficiencyBonus?.() || 0;
		const mod = state?.getAbilityMod?.(ability) || 0;
		return 8 + prof + mod;
	}

	/**
	 * Resolve the real rules `entries` for a Cleric Channel-Divinity feature from the loaded
	 * subclass-feature catalog (set on the state via setClassFeatureCatalog). Prefers a
	 * candidate that actually carries text — the classic PHB entry over the 2024 `_copy`
	 * stub whose `entries` are unresolved in the raw catalog.
	 * @param {*} state
	 * @param {string} cdName - Full feature name (e.g. "Channel Divinity: Guided Strike").
	 * @param {string} sub - Cleric subclass short name / domain (e.g. "War").
	 * @returns {Array<*>|null}
	 * @private
	 */
	static _resolveRaceManifestationCdEntries (/** @type {*} */ state, /** @type {*} */ cdName, /** @type {*} */ sub) {
		const pool = state?._subclassFeatureCatalog;
		if (!Array.isArray(pool) || !pool.length) return null;
		const nm = (cdName || "").toLowerCase();
		const sn = (sub || "").toLowerCase();
		const matches = pool.filter((/** @type {*} */ f) =>
			(f.name || "").toLowerCase() === nm
			&& (f.className || "").toLowerCase() === "cleric"
			&& (f.subclassShortName || "").toLowerCase() === sn);
		if (!matches.length) return null;
		const withText = matches.find((/** @type {*} */ f) => Array.isArray(f.entries) && f.entries.length);
		const chosen = withText || matches[0];
		return Array.isArray(chosen.entries) && chosen.entries.length ? chosen.entries : null;
	}

	/**
	 * Build the per-option list of synthesised manifestation feature objects. Each carries
	 * a `_raceManifestation` tag and a `level` unlock gate; `addFeature` dedups by
	 * name+source and honours the explicit `uses`. When `state` is supplied, real rules
	 * `entries` are pulled from its loaded Cleric subclass-feature catalog (so the child
	 * features hover with full text) and save-requiring options are stamped with the chosen
	 * save ability + computed DC. Falls back to the curated descriptions with no `state`.
	 * @param {*} [state]
	 * @returns {Object<string, *[]>}
	 */
	static getRaceManifestationFeatures (/** @type {*} */ state) {
		const defs = CharacterSheetClassUtils.getRaceManifestationOptionDefs();
		const out = {};
		const saveAbility = state ? CharacterSheetClassUtils.getRaceManifestationAbility(state) : null;
		const saveDc = state ? CharacterSheetClassUtils.computeRaceManifestationDc(state) : null;

		Object.entries(defs).forEach(([/** @type {*} */ id, /** @type {*} */ def]) => {
			if (def.aasimar) {
				out[id] = [{
					name: "Celestial Revelation",
					source: "TGTT",
					featureType: "Species",
					level: 3,
					_raceManifestation: id,
					description: def.description,
				}];
				return;
			}

			out[id] = (def.cd || []).map((/** @type {*} */ cd) => {
				const name = cd.cdName.replace(/^Channel Divinity:\s*/i, "");
				/** @type {*} */
				const feature = {
					name,
					source: "TGTT",
					featureType: "Species",
					level: cd.level,
					_raceManifestation: id,
					// (S2 #15) Every Channel-Divinity manifestation option draws on the SAME
					// single "Divine Manifestation" use (1/short rest per the Hochling trait),
					// so they carry a shared `consumes` pool rather than minting one pool each.
					// `_isResourceSystemFeature` (consumes.name !== "Stamina") suppresses the
					// per-feature pool; `ensureDivineManifestationPool()` mints the shared one.
					consumes: {name: CharacterSheetClassUtils.RACE_MANIFESTATION_POOL_NAME, amount: 1},
					description: cd.description,
				};

				const entries = state
					? CharacterSheetClassUtils._resolveRaceManifestationCdEntries(state, cd.cdName, cd.sub)
					: null;
				if (entries) feature.entries = MiscUtil.copyFast(entries);

				if (cd.requiresSave) {
					feature._manifestationRequiresSave = true;
					if (saveAbility) feature._manifestationSaveAbility = saveAbility;
					if (saveDc != null) {
						feature._manifestationSaveDc = saveDc;
						const abilFull = (saveAbility || "wis").toUpperCase();
						const note = `Saving throw DC = 8 + your proficiency bonus + your ${abilFull} modifier (currently DC ${saveDc}).`;
						feature.description = `${feature.description} ${note}`;
						if (feature.entries) feature.entries = [...feature.entries, note];
					}
				}

				return feature;
			});
		});

		return out;
	}

	/**
	 * Apply the Hochling "Divine Manifestation" race choice. Idempotent and
	 * level-aware: removes features belonging to the non-chosen option (or now gated
	 * above the current level), then grants the chosen option's features whose unlock
	 * level has been reached. Safe to call at any rebuild point (builder apply,
	 * level-up, quick-build) because `state.getTotalLevel()` is authoritative there.
	 * @param {*} state
	 * @param {*} [page] - unused; accepted for call-site parity
	 */
	static applyRaceManifestation (/** @type {*} */ state, /** @type {*} */ page) {
		const choice = state.getRaceManifestationChoice?.() || null;
		const totalLevel = state.getTotalLevel?.() || 1;
		const all = CharacterSheetClassUtils.getRaceManifestationFeatures(state);

		// Tear down any previously-granted manifestation feature that no longer
		// belongs (different choice, no choice, or now above the current level).
		(state.getFeatures?.() || [])
			.filter((/** @type {*} */ f) => f && f._raceManifestation)
			.forEach((/** @type {*} */ f) => {
				const keep = choice
					&& f._raceManifestation === choice
					&& (all[choice] || []).some((/** @type {*} */ def) => def.name === f.name && (def.level || 1) <= totalLevel);
				if (!keep) state.removeFeature(f.id);
			});

		if (!choice || !all[choice]) return;

		all[choice]
			.filter((/** @type {*} */ def) => (def.level || 1) <= totalLevel)
			.forEach((/** @type {*} */ def) => state.addFeature({...def}));
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
					toolProficiencies: ctx.state.getToolProficiencies?.() || [],
					state: ctx.state,
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
	 * Derive an `optionalfeatureProgression` for a class that declares its optional-feature
	 * choices ONLY as inline `refOptionalfeature` entries.
	 *
	 * 5etools class JSON is allowed to enumerate optional features inside a class feature's
	 * `entries` (`{"type": "refOptionalfeature", "optionalfeature": "Name|Source"}`) without
	 * ALSO declaring the machine-readable `optionalfeatureProgression` block that the sheet's
	 * three build flows read. When that happens the class renders its options as prose and
	 * the player is never asked to choose — the exact failure mode this derivation exists to
	 * prevent. MCDM's Talent ("Psionic Exertion", TalPsi) is the motivating case, but the
	 * logic is entirely generic: any class or brew with the same shape gets a picker for free.
	 *
	 * Two signals are combined:
	 *  - the ENUMERATING feature (the one carrying `refOptionalfeature` entries) contributes
	 *    a count of 1 at its own level;
	 *  - any sibling feature whose prose points back at it with a
	 *    `{@classFeature <Name>|<Class>|<Source>|<Level>}` tag is treated as an "additional
	 *    option" improvement and contributes +1 at ITS level.
	 *
	 * The featureType is looked up from the referenced optional features themselves, so no
	 * per-class registry is needed.
	 *
	 * Mutates `classData` in place (idempotent — an existing progression for the same
	 * featureType is never overwritten, so hand-authored data always wins).
	 *
	 * @param {*} classData class entity
	 * @param {Array<*>} classFeatures all classFeature entities (any class; filtered here)
	 * @param {Array<*>} optionalFeatures all optionalfeature entities, for featureType lookup
	 * @returns {boolean} whether a progression was added
	 */
	static deriveOptionalFeatureProgressions (/** @type {*} */ classData, /** @type {*} */ classFeatures, /** @type {*} */ optionalFeatures) {
		if (!classData?.name || !Array.isArray(classFeatures) || !classFeatures.length) return false;

		const own = classFeatures.filter(f =>
			f?.className === classData.name
			&& (!f.classSource || !classData.source || f.classSource === classData.source));
		if (!own.length) return false;

		const optByUid = new Map();
		(optionalFeatures || []).forEach(of => {
			if (!of?.name) return;
			optByUid.set(`${of.name}|${of.source || ""}`.toLowerCase(), of);
		});

		const existingTypes = new Set(
			(classData.optionalfeatureProgression || []).flatMap((/** @type {*} */ p) => p.featureType || []),
		);

		/** Collect every `refOptionalfeature` uid nested anywhere in an entries tree. */
		const collectRefs = (/** @type {*} */ node, /** @type {Set<string>} */ acc) => {
			if (!node) return;
			if (Array.isArray(node)) return node.forEach(n => collectRefs(n, acc));
			if (typeof node !== "object") return;
			if (node.type === "refOptionalfeature" && typeof node.optionalfeature === "string") acc.add(node.optionalfeature);
			collectRefs(node.entries, acc);
			collectRefs(node.items, acc);
		};

		let added = false;

		own.forEach(feature => {
			/** @type {Set<string>} */ const refs = new Set();
			collectRefs(feature.entries, refs);
			if (!refs.size) return;

			const featureTypes = [...new Set([...refs]
				.map(uid => optByUid.get(uid.toLowerCase()))
				.flatMap(of => of?.featureType || []))];
			if (!featureTypes.length) return;
			// Never shadow hand-authored data.
			if (featureTypes.some(ft => existingTypes.has(ft))) return;

			/** @type {Record<number, number>} */ const progression = {};
			const baseLevel = Number(feature.level) || 1;
			progression[baseLevel] = 1;

			// "you gain an additional {@classFeature Psionic Exertion|Talent|TalPsi|3} option"
			const backRef = new RegExp(
				`\\{@classFeature\\s+${feature.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
				"i",
			);
			const improvementLevels = own
				.filter(other => other !== feature && backRef.test(JSON.stringify(other.entries || "")))
				.map(other => Number(other.level) || 0)
				.filter(lvl => lvl > baseLevel)
				.sort((a, b) => a - b);

			let count = 1;
			improvementLevels.forEach(lvl => { progression[lvl] = ++count; });

			classData.optionalfeatureProgression = classData.optionalfeatureProgression || [];
			classData.optionalfeatureProgression.push({
				name: feature.name,
				featureType: featureTypes,
				progression,
				_derived: true,
			});
			featureTypes.forEach(ft => existingTypes.add(ft));
			added = true;
		});

		return added;
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

	static filterOptionalFeaturesForProgressionSource (options, featureTypes, progressionSource) {
		if (featureTypes?.includes("MV:B") && progressionSource !== Parser.SRC_PHB) {
			return (options || []).filter(opt => opt.source === Parser.SRC_XPHB);
		}
		if (featureTypes?.includes("MV:B") && progressionSource === Parser.SRC_PHB) {
			return (options || []).filter(opt => opt.source !== Parser.SRC_XPHB);
		}
		return options || [];
	}

	/**
	 * Compute optional feature gains between currentLevel and newLevel.
	 *
	 * Reads both the CLASS-level `optionalfeatureProgression` and the active subclass's
	 * progression (e.g. Arcane Archer "AS", Battle Master "MV:B"). A subclass progression
	 * is merged only when its featureType set does NOT intersect any class-level
	 * progression featureType — this prevents miscounting shared types (e.g. Champion's
	 * subclass "FS:F" vs the Fighter class "FS:F", where a shared global count would
	 * cancel the gain). A subclass CTM:* progression is skipped here (the level-up
	 * bonus-method path owns that grant), but the CLASS-level CTM:* progression is
	 * still processed — with subclass-granted bonus methods discounted from the
	 * "already known" count so they don't absorb a class-table increment
	 * (CS-BUG-091).
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
			const existingOptFeatures = state.getFeatures().filter((/** @type {*} */ f) => f.featureType === "Optional Feature");

			const matchesFeatureType = (/** @type {*} */ optFeatTypes) => {
				return optFeatTypes?.some((/** @type {*} */ ft) =>
					featureTypes.some((/** @type {*} */ progType) => ft === progType || ft.startsWith(progType)),
				);
			};

			const existingOfType = existingOptFeatures.filter((/** @type {*} */ f) =>
				matchesFeatureType(f.optionalFeatureTypes),
			).length;

			// CS-BUG-091: a subclass-GRANTED combat method is ADDITIVE to the class
			// table, not a draw against it. 27 TGTT subclasses say "you learn one
			// additional method from this tradition" (Eldritch Knight says two).
			// Because `optionalfeatureProgression` stores a CUMULATIVE total, letting a
			// granted method sit in `existingOfType` silently absorbs the class table's
			// NEXT increment, so the character is permanently one method short from the
			// level after the grant onward. Discount only the bonuses ALREADY on the
			// character — inferred as the excess over the class table's total at the
			// CURRENT level, capped at the subclass allowance — so this composes with,
			// rather than double-counting, the level-up path's own bonus augmentation at
			// the subclass-selection level (where the excess is still 0).
			// Scoped to CTM:* deliberately: every other progression type (invocations,
			// maneuvers, arcane shots, metamagic) has no additive-grant concept.
			let effectiveExisting = existingOfType;
			let alreadyGrantedBonus = 0;
			if (featureTypes.some((/** @type {*} */ ft) => ft.startsWith?.("CTM:"))) {
				const bonusAllowance = CharacterSheetClassUtils.getSubclassBonusMethodCount(subclassData, classData?.source);
				if (bonusAllowance > 0) {
					alreadyGrantedBonus = Math.min(bonusAllowance, Math.max(0, existingOfType - countAtCurrent));
					effectiveExisting = existingOfType - alreadyGrantedBonus;
				}
			}

			const newOptionsCount = countAtNew - effectiveExisting;
			if (/** @type {*} */ newOptionsCount > 0) {
				gains.push({
					featureTypes,
					name,
					currentCount: existingOfType,
					// Keep the headline total consistent with what the character will
					// actually know: currentCount + newCount === totalCount.
					totalCount: countAtNew + alreadyGrantedBonus,
					newCount: newOptionsCount,
					replacementCount: featureTypes.includes("MV:B") && countAtNew > countAtCurrent && existingOfType > 0 ? 1 : 0,
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
	 * @param {*} [subclassData] - Optional subclass data object (may ALSO have its own
	 *   `featProgression`, e.g. XPHB Champion Fighter's Additional Fighting Style at
	 *   level 7). When provided, its gains are merged into the same returned array using
	 *   the identical level-window logic — a subclass feat progression is just another
	 *   progression source keyed by class level, not a separate mechanic.
	 * @returns {Array<{progressionName: string, category: string[], count: number}>}
	 */
	static getClassFeatProgressionGains (/** @type {*} */ classData, /** @type {*} */ prevLevel, /** @type {*} */ newLevel, /** @type {*} */ subclassData = null) {
		/** @type {*[]} */ const gains = [];

		const lo = Math.max(0, Number(prevLevel) || 0);
		const hi = Number(newLevel) || 0;
		if (hi <= lo) return gains;

		const collect = (progressions) => {
			if (!progressions?.length) return;
			for (const prog of progressions) {
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
		};

		collect(classData?.featProgression);
		collect(subclassData?.featProgression);

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

	/**
	 * Resolve display metadata for a companion's TYPE so the overview indicator can
	 * render a clear, type-specific badge (and make a summoned Familiar unmistakable —
	 * bug #14). Pure and self-contained: it uses literal companion-type strings (the
	 * canonical values of `CharacterSheetState.COMPANION_TYPES`) rather than importing
	 * the State class, so it is safe to call before State loads (e.g. in unit tests).
	 *
	 * The type/origin contract: familiars are `"familiar"`, Wild Shape forms are
	 * `"wild_shape"`, etc. A malformed object `type` (historic arg-order bug) is
	 * tolerated by reading its `.type`, defaulting to `"custom"`.
	 *
	 * @param {{type?: string|object}} companion
	 * @returns {{type: string, label: string, isFamiliar: boolean, icon: string, colorRgb: string, cssClass: string}}
	 */
	static getCompanionBadgeMeta (/** @type {*} */ companion) {
		const rawType = companion?.type;
		let type = typeof rawType === "string"
			? rawType
			: (rawType && typeof rawType === "object" && typeof rawType.type === "string" ? rawType.type : "custom");

		// colorRgb is an "r, g, b" triple consumed as `rgba(<triple>, a)` by the indicator.
		const META = {
			familiar: {label: "Familiar", icon: "🧚", colorRgb: "20, 184, 166"}, // teal — deliberately distinct
			wild_shape: {label: "Wild Shape", icon: "🐾", colorRgb: "34, 197, 94"}, // green
			beast_companion: {label: "Companion", icon: "🦅", colorRgb: "139, 92, 246"},
			drake: {label: "Drake", icon: "🐉", colorRgb: "239, 68, 68"},
			steel_defender: {label: "Steel Defender", icon: "🛡️", colorRgb: "100, 116, 139"},
			summon: {label: "Summon", icon: "✨", colorRgb: "168, 85, 247"},
			mount: {label: "Mount", icon: "🐎", colorRgb: "180, 130, 80"},
			infernal: {label: "Infernal", icon: "😈", colorRgb: "220, 38, 38"},
			custom: {label: "Companion", icon: "🐾", colorRgb: "139, 92, 246"},
		};
		// Unrecognized types collapse to "custom" so `type`, `cssClass`, and the
		// rendered label/colour all stay coherent.
		if (!Object.prototype.hasOwnProperty.call(META, type)) type = "custom";
		const meta = (/** @type {*} */ (META))[type];
		return {
			type,
			label: meta.label,
			isFamiliar: type === "familiar",
			icon: meta.icon,
			colorRgb: meta.colorRgb,
			cssClass: `charsheet__companion-badge--${type}`,
		};
	}

	/**
	 * Resolve a language-proficiency KEY to a clean, displayable language name.
	 *
	 * Race / subrace / background `languageProficiencies` entries are keyed either
	 * by a plain language name ("common", "elvish") or — for homebrew languages —
	 * by a 5etools entity UID of the form `name|source` (e.g. "tabaxi|tgtt").
	 * Title-casing the raw key produced broken display text like "Tabaxi|Tgtt".
	 * This strips any `|source` suffix and title-cases the name part, so any
	 * homebrew language UID resolves to its proper name. Generic — not Tabaxi- or
	 * TGTT-specific.
	 *
	 * @param {string} key - A languageProficiencies key, plain name, or `name|source` UID.
	 * @returns {string} The displayable language name (title-cased).
	 */
	static resolveLanguageProficiencyName (key) {
		if (key == null) return "";
		const raw = String(key);
		// A UID is "name|source"; take the name part before the first pipe.
		const namePart = raw.includes("|") ? raw.split("|")[0] : raw;
		return namePart.trim().toTitleCase();
	}
}

// Export
export {CharacterSheetClassUtils};
globalThis.CharacterSheetClassUtils = CharacterSheetClassUtils;
