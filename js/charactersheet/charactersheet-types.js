/**
 * Character Sheet — Shared JSDoc Typedefs
 *
 * NO RUNTIME EXPORTS. This file exists purely to give the TypeScript `checkJs`
 * language service real type names for the recurring 5etools data shapes
 * referenced throughout `js/charactersheet/`. Each typedef captures the
 * **commonly used** subset of properties — anything beyond the named fields
 * is permitted via `[key: string]: *` so cast pressure stays manageable.
 *
 * Source-of-truth references:
 *  - 5etools schema (`5etools-utils/schema/site/...json`) for entity shapes.
 *  - `charactersheet-state.js`'s `_getDefaultState()` for the live `_data` shape.
 *  - `js/parser.js` / `js/render.js` for entry-system shapes.
 *
 * How other charactersheet/* files consume these:
 *   The whole `js/charactersheet/` tree is one TS `checkJs` project (per
 *   `jsconfig.json`'s `include`). Plain JSDoc `@typedef` declarations in this
 *   file are therefore **globally visible** to every other file in the
 *   project — no `import("./charactersheet-types.js")` reference needed.
 *
 *   Just write `@param {RaceData} race` directly.
 *
 * Conventions:
 *  - Property accessors that the rest of the codebase reads frequently are
 *    typed explicitly. Anything else falls through `[key: string]: *`.
 *  - Optional properties use `?` suffix on the property name.
 *  - Recursive shapes (entries) use a single self-referential typedef
 *    (`EntryNode`) with a permissive union.
 */

// Reference globalThis once so the file is non-empty for checkJs and
// stays parseable by ESLint as a regular script (no module markers).
void globalThis;

// ============================================================================
// Primitive aliases
// ============================================================================

/**
 * @typedef {"str" | "dex" | "con" | "int" | "wis" | "cha"} AbilityKey
 */

/**
 * @typedef {"tiny" | "small" | "medium" | "large" | "huge" | "gargantuan"} CreatureSize
 */

/**
 * Source abbreviation, e.g. "PHB", "XPHB", "MM", "TGTT".
 * @typedef {string} SourceCode
 */

/**
 * Edition discriminator: "classic" = 2014 PHB-era, "one" = 2024 XPHB-era.
 * @typedef {"classic" | "one"} Edition
 */

// ============================================================================
// Entry system (recursive)
// ============================================================================

/**
 * A single node within an entity's `entries` array. Can be a plain string
 * (with `@tag` markup) or an object describing a structured block.
 *
 * Property access on `EntryNode` is intentionally permissive — most consumers
 * narrow on `node.type` before reading specific fields.
 *
 * @typedef {string | EntryObject} EntryNode
 */

/**
 * Object form of an entry node. Real shape depends on `type`; consumers narrow
 * via `if (entry.type === "...")` blocks.
 *
 * @typedef {object} EntryObject
 * @property {string} [type] - "entries", "list", "table", "section", "inset", etc. Absent = inferred "entries".
 * @property {string} [name] - Display name on entry blocks.
 * @property {EntryNode[]} [entries] - Nested entries.
 * @property {EntryNode[]} [items] - List items (for `type === "list"`).
 * @property {string} [style] - Style hint (e.g. for lists).
 * @property {string[]} [colLabels] - Table column labels.
 * @property {string[]} [colStyles] - Table column styles.
 * @property {EntryNode[][]} [rows] - Table rows.
 * @property {string} [caption] - Caption (table/inset/etc.).
 * @property {string[]} [tags] - Quickref tags.
 * @property {string} [page] - Quickref/book navigation.
 * @property {*} [data] - Arbitrary structured payload (some types embed it).
 */

// ============================================================================
// Shared sub-shapes
// ============================================================================

/**
 * @typedef {object} EntitySource
 * @property {string} name
 * @property {SourceCode} source
 * @property {number} [page]
 * @property {SourceCode} [otherSources]
 */

/**
 * Hit Point block on a creature/race.
 * @typedef {object} HpBlock
 * @property {number} [average]
 * @property {string} [formula]
 * @property {boolean} [special]
 */

/**
 * Per-ability bonus hash.
 * @typedef {Partial<Record<AbilityKey, number>>} AbilityBonusHash
 */

/**
 * @typedef {object} SpeedBlock
 * @property {number} [walk]
 * @property {number} [fly]
 * @property {number} [swim]
 * @property {number} [climb]
 * @property {number} [burrow]
 * @property {boolean} [canHover]
 */

/**
 * @typedef {object} SensesBlock
 * @property {number} [darkvision]
 * @property {number} [blindsight]
 * @property {number} [tremorsense]
 * @property {number} [truesight]
 */

/**
 * Spell-component block (verbal/somatic/material).
 * @typedef {object} SpellComponents
 * @property {boolean} [v]
 * @property {boolean} [s]
 * @property {string | object} [m]
 * @property {boolean} [r]
 */

// ============================================================================
// Race / Subrace
// ============================================================================

/**
 * Race / Species data (5etools `data/races.json` shape).
 *
 * Permissive on the long tail because TGTT homebrew + 2024 variants extend
 * the schema with many feature-specific fields.
 *
 * @typedef {object} RaceData
 * @property {string} name
 * @property {SourceCode} source
 * @property {Edition} [edition]
 * @property {CreatureSize[]} [size]
 * @property {SpeedBlock | number} [speed]
 * @property {AbilityBonusHash[]} [ability] - Each entry one ASI option.
 * @property {EntryNode[]} [entries]
 * @property {AdditionalSpells[]} [additionalSpells]
 * @property {string[]} [languageProficiencies]
 * @property {string[]} [skillProficiencies]
 * @property {string[]} [toolProficiencies]
 * @property {string[]} [resist]
 * @property {string[]} [immune]
 * @property {string[]} [vulnerable]
 * @property {string[]} [conditionImmune]
 * @property {string[]} [traitTags]
 * @property {SubraceData[]} [subraces]
 * @property {*} [_versions] - Inline race variants (parameterized or simple).
 * @property {*} [_copy] - Inheritance directive.
 * @property {boolean} [hasFluff]
 * @property {boolean} [hasFluffImages]
 * @property {string} [page]
 * @property {string} [lineage]
 * @property {*} [reprintedAs]
 */

/**
 * Subrace data — same loose shape as `RaceData` but with a subrace-name field.
 * @typedef {RaceData & {raceName?: string, raceSource?: SourceCode, alias?: string[]}} SubraceData
 */

// ============================================================================
// Class / Subclass
// ============================================================================

/**
 * Class data (5etools `data/class/class-*.json` `class[]` entry).
 *
 * @typedef {object} ClassData
 * @property {string} name
 * @property {SourceCode} source
 * @property {Edition} [edition]
 * @property {string} [hd] - Hit die, e.g. "1d10".
 * @property {{faces?: number, number?: number}} [hdObj]
 * @property {AbilityKey[]} [proficiency] - Save proficiencies.
 * @property {*} [startingProficiencies]
 * @property {*} [startingEquipment]
 * @property {ClassFeatureRef[]} [classFeatures]
 * @property {SpellcastingProgression} [casterProgression]
 * @property {string[]} [spellsKnownProgression]
 * @property {string[]} [cantripProgression]
 * @property {string[]} [preparedSpellsProgression]
 * @property {string} [spellcastingAbility]
 * @property {SubclassData[]} [subclasses]
 * @property {*} [classTableGroups]
 * @property {boolean} [isReprinted]
 * @property {*} [_copy]
 * @property {string} [page]
 * @property {boolean} [hasFluff]
 * @property {boolean} [hasFluffImages]
 */

/**
 * @typedef {"full" | "1/2" | "1/3" | "pact" | "artificer" | null} SpellcastingProgression
 */

/**
 * Reference to a class feature in `class[].classFeatures` — string UID
 * or object with `classFeature` UID + flags.
 * @typedef {string | {classFeature: string, gainSubclassFeature?: boolean, tableDisplayName?: string}} ClassFeatureRef
 */

/**
 * Subclass data — `class[].subclasses[]` entry.
 *
 * @typedef {object} SubclassData
 * @property {string} name
 * @property {string} [shortName]
 * @property {SourceCode} source
 * @property {string} [className]
 * @property {SourceCode} [classSource]
 * @property {SubclassFeatureRef[]} [subclassFeatures]
 * @property {*} [subclassTableGroups]
 * @property {*} [_copy]
 * @property {string} [page]
 */

/**
 * @typedef {string | {subclassFeature: string}} SubclassFeatureRef
 */

// ============================================================================
// Features (class features, subclass features, optional features)
// ============================================================================

/**
 * Class / subclass feature data (5etools `classFeature[]` / `subclassFeature[]`).
 *
 * @typedef {object} FeatureData
 * @property {string} name
 * @property {SourceCode} source
 * @property {string} [className]
 * @property {SourceCode} [classSource]
 * @property {string} [subclassShortName]
 * @property {SourceCode} [subclassSource]
 * @property {number} [level]
 * @property {EntryNode[]} [entries]
 * @property {string} [featureType]
 * @property {boolean} [isSubclassFeature]
 * @property {*} [consumes]
 * @property {AdditionalSpells[]} [additionalSpells]
 * @property {string} [page]
 * @property {*} [_copy]
 * @property {boolean} [isReprinted]
 */

/**
 * Optional feature data (Eldritch Invocation, Battle Master Maneuver, etc.).
 *
 * @typedef {object} OptionalFeatureData
 * @property {string} name
 * @property {SourceCode} source
 * @property {string[]} [featureType] - e.g. ["EI"], ["MV:B"], ["MM"].
 * @property {*} [prerequisite]
 * @property {EntryNode[]} [entries]
 * @property {*} [consumes]
 * @property {AdditionalSpells[]} [additionalSpells]
 * @property {string} [page]
 * @property {*} [_copy]
 */

// ============================================================================
// Background / Feat
// ============================================================================

/**
 * @typedef {object} BackgroundData
 * @property {string} name
 * @property {SourceCode} source
 * @property {EntryNode[]} [entries]
 * @property {string[]} [skillProficiencies]
 * @property {string[]} [toolProficiencies]
 * @property {string[]} [languageProficiencies]
 * @property {AbilityBonusHash[]} [ability]
 * @property {string} [feats] - For 2024 backgrounds: starting feat reference.
 * @property {*} [startingEquipment]
 * @property {string} [page]
 * @property {*} [_copy]
 */

/**
 * @typedef {object} FeatData
 * @property {string} name
 * @property {SourceCode} source
 * @property {EntryNode[]} [entries]
 * @property {*} [prerequisite]
 * @property {AbilityBonusHash[]} [ability]
 * @property {string[]} [skillProficiencies]
 * @property {string[]} [toolProficiencies]
 * @property {string[]} [languageProficiencies]
 * @property {AdditionalSpells[]} [additionalSpells]
 * @property {string} [category]
 * @property {string} [page]
 * @property {*} [_copy]
 */

// ============================================================================
// Spells / Items / Conditions
// ============================================================================

/**
 * Spell data (5etools `data/spells/spells-*.json`).
 *
 * @typedef {object} SpellData
 * @property {string} name
 * @property {SourceCode} source
 * @property {Edition} [edition]
 * @property {number} level - 0 = cantrip.
 * @property {string} [school] - Single-letter code (A/C/D/E/V/I/N/T).
 * @property {*} [time] - Casting time array.
 * @property {*} [range] - Range descriptor.
 * @property {SpellComponents} [components]
 * @property {*} [duration]
 * @property {EntryNode[]} [entries]
 * @property {EntryNode[]} [entriesHigherLevel]
 * @property {boolean} [concentration]
 * @property {boolean} [meta] - { ritual?: boolean }
 * @property {string[]} [damageInflict]
 * @property {string[]} [conditionInflict]
 * @property {string[]} [savingThrow]
 * @property {string[]} [areaTags]
 * @property {string} [page]
 * @property {*} [_copy]
 */

/**
 * Additional-spells block on classes/feats/races/optional features.
 * @typedef {object} AdditionalSpells
 * @property {string} [name]
 * @property {string} [ability]
 * @property {Object<string, *>} [innate]
 * @property {Object<string, *>} [known]
 * @property {Object<string, *>} [prepared]
 * @property {Object<string, *>} [expanded]
 */

/**
 * Item data (5etools `data/items*.json`).
 *
 * @typedef {object} ItemData
 * @property {string} name
 * @property {SourceCode} source
 * @property {Edition} [edition]
 * @property {string} [type] - Item-type code (S, M, R, A, LA, MA, HA, etc.).
 * @property {EntryNode[]} [entries]
 * @property {number} [value] - Cost in copper pieces.
 * @property {string} [weight]
 * @property {*} [ac]
 * @property {*} [dmg1]
 * @property {*} [dmg2]
 * @property {string} [dmgType]
 * @property {string[]} [property]
 * @property {string} [mastery]
 * @property {*} [range]
 * @property {boolean} [wondrous]
 * @property {string} [rarity]
 * @property {boolean} [reqAttune] - or attune string requirement.
 * @property {*} [_copy]
 * @property {string} [page]
 */

/**
 * Inventory entry (state-side wrapper around an `ItemData`).
 *
 * @typedef {object} InventoryEntry
 * @property {ItemData & {appliedUpgrades?: *[], socketedGemstones?: *[]}} item
 * @property {number} [quantity]
 * @property {boolean} [equipped]
 * @property {boolean} [attuned]
 * @property {string} [id]
 */

/**
 * @typedef {object} ConditionData
 * @property {string} name
 * @property {SourceCode} source
 * @property {EntryNode[]} [entries]
 * @property {string} [page]
 */

// ============================================================================
// Character sheet runtime state (`_data`)
// ============================================================================

/**
 * Per-character class slot in `_data.classes`.
 *
 * @typedef {object} CharacterClassEntry
 * @property {string} name
 * @property {SourceCode} source
 * @property {number} level
 * @property {{name: string, source: SourceCode, shortName?: string} | null} [subclass]
 * @property {*} [subclassChoice]
 * @property {string} [hitDie]
 */

/**
 * Per-level history entry in `_data.levelHistory`.
 *
 * @typedef {object} LevelHistoryEntry
 * @property {number} level
 * @property {{name: string, source: SourceCode}} class
 * @property {{
 *   asi?: AbilityBonusHash,
 *   feat?: {name: string, source: SourceCode},
 *   subclass?: {name: string, source: SourceCode},
 *   skills?: string[],
 *   optionalFeatures?: Array<{name: string, source: SourceCode, type?: string}>,
 *   featureChoices?: Array<{featureName: string, choice: *}>,
 *   expertise?: string[]
 * }} [choices]
 * @property {boolean} [complete]
 * @property {number} [timestamp]
 */

/**
 * Spell slot block (per spell level).
 * @typedef {object} SpellSlotBlock
 * @property {number} current
 * @property {number} max
 */

/**
 * Top-level runtime data object held on the character sheet state.
 * Keys mirror `_getDefaultState()` in `charactersheet-state.js`.
 *
 * Permissive at the tail because TGTT homebrew + active refactors keep
 * extending the live shape.
 *
 * @typedef {object} CharacterSheetData
 * @property {string | null} id
 * @property {string} name
 * @property {number} xp
 * @property {{name: string, source: SourceCode} | null} race
 * @property {{name: string, source: SourceCode} | null} subrace
 * @property {CreatureSize | string} size
 * @property {string | null} alignment
 * @property {CharacterClassEntry[]} classes
 * @property {{name: string, source: SourceCode} | null} background
 * @property {LevelHistoryEntry[]} levelHistory
 * @property {Record<AbilityKey, number>} abilities
 * @property {Record<AbilityKey, number>} abilityBonuses
 * @property {Partial<Record<AbilityKey, number>>} abilityScoreMaximums
 * @property {{current: number, max: number, temp: number}} hp
 * @property {Object<string, SpellSlotBlock>} hitDice
 * @property {{successes: number, failures: number}} deathSaves
 * @property {boolean} inspiration
 * @property {AbilityKey[]} saveProficiencies
 * @property {Object<string, number>} skillProficiencies
 * @property {Array<{name: string, ability: AbilityKey}>} customSkills
 * @property {string[]} armorProficiencies
 * @property {string[]} weaponProficiencies
 * @property {string[]} toolProficiencies
 * @property {string[]} languages
 * @property {{base: number, armor: *, shield: boolean, bonuses: *[], itemBonus: number}} ac
 * @property {*[]} acFormulas
 * @property {Object<string, number | Object<string, number>>} itemBonuses
 * @property {{resist: string[], immune: string[], vulnerable: string[], conditionImmune: string[]}} itemDefenses
 * @property {{immuneThoughtReading: boolean, immuneLieDetection: boolean, immuneTelepathy: boolean, immuneAlignmentDetection: boolean}} itemMentalProtection
 * @property {{static?: AbilityBonusHash, bonus?: AbilityBonusHash} | null} itemAbilityOverrides
 * @property {*[]} itemGrantedSpells
 * @property {SpeedBlock} speed
 * @property {SensesBlock} senses
 * @property {SpellcastingState} spellcasting
 * @property {InventoryEntry[]} inventory
 * @property {{cp: number, sp: number, ep: number, gp: number, pp: number}} currency
 * @property {Array<*>} features
 * @property {Array<{name: string, source: SourceCode}>} feats
 * @property {string[]} weaponMasteries
 * @property {Object<string, string>} weaponMasteryProperties
 * @property {string[]} combatTraditions
 * @property {number} staminaCurrent
 * @property {number} staminaMax
 * @property {string | null} activeStance
 * @property {{mode: "predator" | "prey", switchesUsed: number, huntersDodgeUsed: number, quarryTargetId: string | null}} primalFocus
 * @property {{current: number, lucidFocusActive: boolean}} focusPool
 * @property {string | null} scholarExpertise
 * @property {Array<*>} attacks
 * @property {Array<*>} temporaryAttacks
 * @property {string[]} conditions
 * @property {number} exhaustion
 * @property {Array<*>} resources
 * @property {{personality: string, ideals: string, bonds: string, flaws: string, backstory: string, notes: string}} notes
 * @property {Array<*>} stickyNotes
 * @property {Array<*>} customAbilities
 * @property {Array<*>} activeCombatMethodEffects
 * @property {Object<string, *>} combatMethodWeaponChoices
 * @property {{skills: Object<string, string[]>, tools: Object<string, string[]>, weapons: Object<string, string[]>, armor: Object<string, string[]>, languages: Object<string, string[]>}} grantedProficiencies
 * @property {{age: string, height: string, weight: string, eyes: string, skin: string, hair: string, portraitUrl: string}} appearance
 * @property {string[]} resistances
 * @property {string[]} immunities
 * @property {string[]} vulnerabilities
 * @property {string[]} conditionImmunities
 * @property {*} customModifiers
 * @property {Array<NamedModifier>} namedModifiers
 * @property {Array<ToggleAbilityState>} activeStates
 * @property {Array<*>} tunedMetamagics
 * @property {Object<string, *>} [settings]
 */

/**
 * Spellcasting sub-state (`_data.spellcasting`).
 *
 * @typedef {object} SpellcastingState
 * @property {AbilityKey | null} ability
 * @property {Object<string, SpellSlotBlock>} spellSlots
 * @property {{current: number, max: number, level: number}} pactSlots
 * @property {Array<*>} spellsKnown
 * @property {Array<*>} cantripsKnown
 * @property {Array<*>} innateSpells
 * @property {number | null} [gamblerPreparedRolled]
 * @property {*} [gamblerPreparedRollDetails]
 * @property {boolean} [gamblerAutoRollTable]
 * @property {*} [gamblerLastBet]
 * @property {*} [gamblerLastTableRoll]
 * @property {number} [gamblerExtraLuckUsed]
 * @property {number} [gamblerMasterFortuneUsed]
 * @property {Array<*>} [scribingSpellbook]
 * @property {string | null} [scribingMemorizedSpellId]
 * @property {string | null} [scribingClass]
 * @property {number} [pendingScribingPicks]
 */

/**
 * Active toggle/state entry (Rage, Bladesong, etc.) — `_data.activeStates`.
 *
 * @typedef {object} ToggleAbilityState
 * @property {string} type - One of the 24 supported state types.
 * @property {string} [id]
 * @property {boolean} [active]
 * @property {*} [meta]
 * @property {number} [usesRemaining]
 * @property {string} [sourceFeature]
 * @property {string} [sourceClass]
 * @property {number} [activatedAt]
 */

/**
 * Named modifier entry (`_data.namedModifiers`).
 *
 * @typedef {object} NamedModifier
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {number} value
 * @property {string} [note]
 * @property {boolean} enabled
 * @property {string} [sourceFeatureId]
 */

// ============================================================================
// Feature calculations (returned by getFeatureCalculations())
// ============================================================================

/**
 * Result of `CharacterSheetState.getFeatureCalculations()`. Keys are highly
 * variable (per feature: `has{Feature}` boolean, plus optional
 * `{feature}Damage|Dc|Uses|Bonus|Range|Count|Die`). All callers index by
 * string; permissive value type is intentional.
 *
 * @typedef {Object<string, *>} FeatureCalculations
 */

// ============================================================================
// Misc shared shapes
// ============================================================================

/**
 * Feature/spell-resource consumption descriptor (used on features &
 * optional features).
 *
 * @typedef {object} ConsumesDescriptor
 * @property {string} [name]
 * @property {string | number} [amount]
 * @property {string} [recharge]
 * @property {string} [ability]
 */

/**
 * Generic name + source UID pair.
 * @typedef {{name: string, source: SourceCode}} NamedRef
 */

/**
 * Choice entry (for picker UIs).
 * @typedef {object} ChoiceEntry
 * @property {string} name
 * @property {string} [label]
 * @property {string} [value]
 * @property {*} [data]
 */

// ============================================================================
// Module export
// ============================================================================
//
// This file has no runtime symbols. Other modules pick up the typedefs
// automatically — `jsconfig.json` includes `js/**/*`, so `@typedef`
// declarations here are globally visible to every other file in the project.
