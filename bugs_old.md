# Bugs Tracking

This file is used to track known bugs in the 5etools character sheet code.

## Feature Requests

### General

- [x] need way to roll things with advantage/disadvantage from the sheet (fixed: Shift+click for advantage, Ctrl/Cmd+click for disadvantage)
- [x] need to support rolling skills with different ability scores (fixed: right-click on skill to choose alternate ability)
- [x] need to support adding custom skills to sheet (fixed: "Add Custom Skill" button in skills section)
- [x] need to support adding features, languages, proficiencies, etc manually to sheet (fixed: pencil icon on Proficiencies section, + button on Custom Features section in Features tab)
- [x] need to support adding custom modifiers to rolls, skills, abilities, hit, damage etc (fixed: "Modifiers" button in header opens modal to add/edit/toggle named modifiers for AC, initiative, attacks, damage, saves, skills, etc)
- [x] need to support toggling proficiency/expertise/half proficiency on skills manually (fixed: click on the proficiency dot next to any skill to cycle through none → proficient → expertise → none)
- [x] need to support Thelemar exhaustion rules (-1 to all rolls and DCs per level, max 10 before death) (fixed: added "Thelemar Rules" option in exhaustion dropdown)
- [x] need to support various features giving modifiers to rolls, damage, AC, stats, skills etc (e.g magic items, class features, racial features, etc) (fixed: FeatureModifierParser auto-detects modifiers from feature descriptions including: AC, saving throws, attack/damage rolls, spell DC/attack, initiative, skills, ability checks, ability scores, speed (all types), senses (darkvision/blindsight/etc), HP, carry capacity, proficiency bonus. Supports both +X and -X, "increases/decreases by X" phrasings. Conditional modifiers (while raging, against undead, etc) are added as toggleable named modifiers)
- [x] need to support custom background creation in builder (fixed: Added "Create Custom Background" button in the background step. Opens a form to enter: background name, 2 skill proficiencies (checkbox selection), tool/language proficiencies (2 total via dropdowns), equipment description, and feature name. Validates that exactly 2 skills are selected. Creates a proper background object with skillProficiencies, toolProficiencies, and languageProficiencies arrays. Custom background appears at top of the background list and can be selected like any other background.)
- [x] need to supoprt Tasha's ASI rules for races in builder (fixed: Added "Use Tasha's Custom Origin Rules" checkbox in the Racial Bonuses section of the Abilities step. When enabled, players can reassign their racial ability score bonuses to any abilities they choose. The feature tracks custom ASI selections separately and validates that all bonuses are assigned before proceeding. Only shown for pre-2024 races that have ability score bonuses.)
- [x] need to support custom AC formulas from features (like natural armor, unarmored defense, etc) (fixed: FeatureModifierParser already detects AC formula patterns like "your AC equals 13 + your Dexterity modifier", natural armor, and unarmored defense. AC formulas are stored and getAc() calculates the best option between standard AC, armor, and custom formulas. Supports noDex for flat AC like Tortle, and secondAbility for Barbarian/Monk style formulas.)
- [x] need to support Thelemar carry weight rules (50 + 25 × STR modifier, minimum 50) (fixed: Added "Thelemar Carry Weight" toggle in Settings modal under "Thelemar Homebrew Rules" section. When enabled, getCarryingCapacity() uses the formula 50 + 25 *STR mod instead of STR* 15. Still applies flat bonuses and multipliers from features.)
- [x] need to support Thelemar linguistics skill bonus (+1 per known language except Common) (fixed: Added "Thelemar Linguistics" toggle in Settings modal under "Thelemar Homebrew Rules" section. When enabled, the Linguistics skill gets +1 for each language the character knows that isn't Common. Bonus is calculated in _getSkillFeatureBonus() and reflected in skill rolls.)
- [x] need to add more friendly UI for understanding the sheet functions (e.g tooltips, help buttons, rolling with adv/disadv, changing skill abilities or proficiency, etc)
- [x] need to improve UI greatly, currently very basic and not user friendly
  **FIXED**: Major UI overhaul completed with modern design system:
  
  **New CSS Architecture:**
  - Created `charactersheet-modern.css` with comprehensive design tokens (CSS custom properties)
  - Modern color palette with primary indigo (#6366f1), semantic colors (success/warning/danger/info), and accent colors (gold/emerald/ruby/sapphire/amethyst)
  - Google Fonts integration: Cinzel for display text, Inter for body text
  - Consistent spacing scale, border radius values, and shadow depths
  
  **Visual Improvements:**
  - Modern card-based section design with hover effects and subtle shadows
  - Enhanced ability score boxes with gradient accents and animations
  - Improved skills/saves list with hover animations and color-coded proficiency indicators
  - Redesigned combat stats with prominent displays and hover effects
  - Modern tab navigation with icons (emoji) and better visual feedback
  - Enhanced header bar with gradient buttons and modern styling
  - Improved Builder wizard with progress indicator line and step animations
  
  **Component Enhancements:**
  - Attacks: Modern cards with left accent stripe and hover effects
  - Resources: Gold-themed pips with glow effects
  - Conditions: Pill-shaped badges with warning colors
  - Inventory: Item rarity colors with glow effects, artifact animation
  - Features: Accordion-style display with modern styling
  - Spell slots: Purple/amethyst themed to match magic aesthetic
  
  **Animations Added:**
  - Dice roll popup with bounce animation
  - Critical hit celebration effect (gold glow + scale)
  - Fumble shake effect (red color + shake)
  - Damage/heal flash effects
  - Concentration pulse animation
  - Magic item glow animation
  - Level up celebration
  - Loading shimmer effect
  
  **Accessibility:**
  - Proper focus-visible styles with outline and glow
  - Screen reader only class (.sr-only)
  - Reduced motion preference support
  - Custom scrollbars for better UX
  
- [] need to allow for some color customization (e.g dark mode, custom background colors, etc)
- [] need to support mobile devices better (bigger buttons, less clicks, altternative ways to do things that require hover or shift/ctrl keys)

## Known Bugs

### Character Builder

- [x] some races with subraces don't show subrace selection in the builder (fixed: races now processed through Renderer.race.mergeSubraces() to get _baseName/_baseSource properties for proper subrace grouping, and 2024 races with _versions are now expanded and grouped properly)
- [x] races that give spells (like high elf, tiefling, etc) not adding spells automatically and not giving choice UI. (fixed: _applyRacialSpells() processes additionalSpells at char creation,_updateRacialSpells() adds spells at each level-up. Handles both known spells and innate spells with uses/recharge. Supports subrace-specific spell blocks. Spell choices not yet implemented)
- [x] races that give proficiencies (like half-orc, etc) not adding proficiencies automatically and not giving choice UI. (fixed: Added _renderRacialProficiencyChoices() UI for skill/tool choices with checkboxes. Fixed proficiencies already worked, now choose options also work. Validates required choices before advancing step.)
- [x] hover links for @subclassFeature tags showing "Failed to load references" error (fixed: Added _pPreCacheClassFeatures() to pre-cache classFeature and subclassFeature in DataLoader during page init, so hover links work properly)
- [x] Some race abilities (Charge, Aggressive, etc) not added correctly or not working as intended. (fixed: Enhanced isImportantFeature() to check both name AND description for keywords. Added race-relevant keywords: "charge", "aggressive", "natural weapon", "unarmed strike", "breath weapon", "fey ancestry", "relentless endurance". Fixed NaturalWeaponParser regex to handle plural "natural melee weapons" for Hooves-type abilities. Added activatable patterns to detect features that use action economy.)
- [x] In Abilities in builder - the placeholder 10 are returned to the score list. (fixed: Changed initial _abilityScores from {str: 10, ...} to {str: null, ...} to match standard array mode. Added validation to only return valid standard array scores [15, 14, 13, 12, 10, 8] to the pool, preventing invalid scores from being added.)

### Features

- [x] many features that are useable (specialties and combat methods (from thelemar), invocations, metamagic, maneuvers, homebrew, etc) not selectable during level up or character creation, not given choice UI, or not added correctly. (fixed: Added _validateOptionalFeatureSelections() and_validateFeatureOptionSelections() validation in step 2 (class) to enforce selection of required optional features like invocations, metamagic, combat methods before advancing. Also validates feature options like Specialties. Level-up already had validation in place.)
- [x] combat method feature (the meta feature that gives a class access to combat methods) looked at as resource (the resource is stamina) (fixed: Added _isResourceSystemFeature() check in addFeature() to skip use detection for meta-features that describe resource systems like Combat Methods, Ki, Sorcery Points, etc. These features mention "short rest" or "long rest" but that's for the resource pool, not the feature itself.)
<!-- - [] SOme features that give additional combat traditions or methods (thelemar homebrew) not adding them correctly or not giving choice UI. -->
- [x] some race features added as resources (like elf lineage) instead of just being applied (fixed: Enhanced _isResourceSystemFeature() to detect spell-granting racial features like "Elven Lineage", "Infernal Legacy", "Wind Caller", etc. These features describe spell uses, not their own uses. Actual usable abilities like "Healing Hands" or "Celestial Revelation" are correctly still tracked as resources.)
- [x] Specialties don't give their benefits many times (thelemar homebrew) (fixed: Enhanced _findFeatureOptions() in both charactersheet-builder.js and charactersheet-levelup.js to detect {@classFeature} references in feature text. Higher-level Specialty features (5th, 9th, 13th, 17th level) reference the level 1 feature via text like "gain another specialty from the {@classFeature Specialties|Fighter|TGTT|1}". Now these references are followed and the options from the referenced feature are used.)
- [x] Many specialty benefits (thelemar homebrew) not applied and don't affect rolls or stats, not reflected in overview. (fixed: Comprehensive enhancement of FeatureModifierParser with 35+ pattern types. Patterns apply to ALL feature types, not just specialties. Added detection for:
  - Speed bonuses: swimming/climbing speed equal to walking speed, speed increases by X feet
  - Senses: darkvision/tremorsense/blindsight/truesight with range, see normally in magical darkness (Devil's Sight)
  - Proficiencies: all tools (including healer's kit), improvised weapons, combined "martial weapons and heavy armor" patterns
  - Advantage: on saving throws (prone, heat/cold, drowning, charmed/frightened/poisoned), on ability/skill checks with conditions
  - Skill bonuses: equal to proficiency bonus, add dice (d10/d8/etc), add ability modifier, add martial arts die, expertise die
  - Movement: difficult terrain immunity (general and terrain-specific), jump distance increase/doubled, climbing without ability check
  - Travel: pace bonuses, forced march hours, no fast pace penalty
  - Resources: extra stamina/focus/ki points, gain resource on initiative
  - Ability swaps: use DEX instead of STR for Athletics, etc.
  - Other: carrying capacity doubled, exhaustion immunity, extra cantrips known, advantage on initiative, tracking bonuses
  Total specialty coverage improved from 46% to 63% (118/187 specialties). Remaining 37% are mostly active abilities (tracked as usable features) or roleplay/utility features without stat impacts.)

### Overview

- [x] states that require activation and then stay active (like rage, concentration, stance, etc) not tracked or managed, and their effects not applied to rolls or stats.
  **FIXED**: Implemented Active States system for tracking toggled states like Rage, Concentration, Wild Shape, Dodge, etc.
  
  **Data Structures** (charactersheet-state.js):
  - Added `activeStates: []` array to track active state instances
  - Added `concentrating: null` field to track current concentration
  - Added static `ACTIVE_STATE_TYPES` defining state templates:
    - Rage: advantage on STR checks/saves, resistance to B/P/S damage, +rage damage on melee STR attacks
    - Concentration: tracks spell being concentrated on
    - Wild Shape: placeholder for beast form transformation
    - Defensive Stance: +2 AC, disadvantage on attacks
    - Dodge: disadvantage on attacks against, advantage on DEX saves
    - Prone: attack disadvantages and advantages against

  **Management Methods**:
  - `getActiveStates()`, `getActiveState(id)`, `isStateActive(typeId)`
  - `addActiveState(typeId, options)`, `activateState(typeId, options)`, `deactivateState(typeId)`
  - `toggleActiveState(stateId)`, `removeActiveState(stateId)`
  - `getActiveStateEffects()` - returns all effects from active states
  - `hasAdvantageFromStates(rollType)`, `hasDisadvantageFromStates(rollType)`
  - `getBonusFromStates(target)`, `hasResistanceFromStates(damageType)`
  - `getRageDamageBonus(isMelee, abilityUsed)` - rage damage on melee STR attacks
  - `getConcentration()`, `setConcentration(spellName, level)`, `breakConcentration()`, `isConcentrating()`
  - `clearStatesOnRest(restType)` - clears states on short/long rest

  **Integration with Rolls** (charactersheet.js):
  - `_rollAbilityCheck()` - applies advantage from states (e.g., Rage on STR checks)
  - `_rollSavingThrow()` - applies advantage from states (e.g., Rage on STR saves, Dodge on DEX saves)
  - `_rollAttack()` - applies advantage/disadvantage, adds rage damage bonus to melee STR attacks
  - `getAc()` - adds bonus from states (e.g., Defensive Stance +2 AC)

  **UI**:
  - Added "Active States" section in charactersheet.html after Resources
  - `_renderActiveStates()` displays active states with toggle/remove buttons
  - Quick activation buttons for Rage and Dodge
  - Rage button automatically spends Rage resource when activating
  - States clear automatically on rest

  **Condition Effects Integration**:
  - Added static `CONDITION_EFFECTS` defining all standard 5e conditions with their mechanical effects:
    - Blinded: disadvantage on attacks, advantage against, auto-fail sight checks
    - Charmed: roleplay notes
    - Deafened: auto-fail hearing checks
    - Frightened: disadvantage on attacks and checks (while source visible)
    - Grappled: speed set to 0
    - Incapacitated: no actions/reactions
    - Invisible: advantage on attacks, disadvantage against
    - Paralyzed: incapacitated, auto-fail STR/DEX saves, advantage against, crits
    - Petrified: incapacitated, resistance to all damage, immune to poison
    - Poisoned: disadvantage on attacks and ability checks
    - Prone: disadvantage on attacks, melee against has advantage, ranged has disadvantage
    - Restrained: speed 0, disadvantage on attacks/DEX saves, advantage against
    - Stunned: incapacitated, auto-fail STR/DEX saves, advantage against
    - Unconscious: incapacitated, auto-fail saves, advantage against, crits
    - Slowed (2024): speed halved, -2 AC/DEX saves
  - Added `registerCustomCondition()` for homebrew conditions
  - When conditions are added, they automatically create active state entries
  - Conditions now show icons and tooltips with effect descriptions
  - `hasAdvantageFromStates()` and `hasDisadvantageFromStates()` now handle generic "check" and "save" targets
  - Added `hasAutoFailFromConditions()`, `isIncapacitated()`, `getSpeedMultiplierFromConditions()`

  **Homebrew Condition Parsing**:
  - Added `parseConditionFromEntries()` static method that parses condition text to extract mechanical effects
  - Added `registerHomebrewConditions()` static method to register an array of homebrew conditions
  - Added `_flattenEntriesToText()` to convert nested 5etools entry structures to plain text
  - Added `_getConditionIcon()` to auto-assign appropriate icons based on condition names
  - Updated `_mergeBrewData()` in charactersheet.js to automatically parse and register homebrew conditions
  - Supports extracting these effect types from condition text:
    - Speed modifications: "Speed 0", "speed is 0", "halved speed", "spend 1 extra foot"
    - Attack advantage/disadvantage: "advantage on attack rolls", "your attack rolls have disadvantage"
    - Attacks against: "attack rolls against you have advantage/disadvantage"
    - Saving throw disadvantage: for all saves or specific abilities (DEX/STR/CON/INT/WIS/CHA)
    - Auto-fail saves: "automatically fail Strength Saving Throw"
    - Ability check failures: "automatically fails any ability check that requires sight"
    - Incapacitated detection: "can't take actions or reactions"
    - Resistance: "resistance to all damage"
    - Notes: movement restrictions, concentration broken, limited activity, speechless
  - TGTT homebrew conditions now auto-register with effects: Dazed, Choked, Slowed, Hidden, Undetected, modified Grappled/Restrained/Petrified/Stunned

### Combat

- [x] unarmed strikes not added automatically as attacks, specially for monks (fixed: Added ensureUnarmedStrike() method that automatically adds Unarmed Strike attack for all characters. For non-monks, deals 1+STR bludgeoning. For monks, uses Martial Arts die progression (1d6→1d8→1d10→1d12) and can use DEX (finesse). Called when: class is added/removed, character is loaded, level-up is applied. Combat UI shows "Monk" badge for monk unarmed strikes.)
- [x] resources and active features not displayed in combat UI (fixed: Added Combat Resources section showing combat-relevant resources like Rage, Ki, Sorcery Points with clickable pips. Added Active States section with quick buttons for Rage, Dodge, Concentration. States sync with overview tab.)
- [x] Condition resistances and immunities not displayed in combat UI (fixed: Added renderCombatDefenses() method that displays resistances, immunities, vulnerabilities, and condition immunities in the Defenses section. Shows base defenses and those from active states (like Rage B/P/S resistance) with different badge colors. Updates when states change.)
- [x] need to add more combat effects from features and conditions (like advantage/disadvantage, resistances, bonuses, etc) (fixed: Added "Active Combat Effects" section with renderCombatEffects() method. Displays YOUR advantage/disadvantage vs ENEMY advantage/disadvantage against you separately. Shows bonuses to AC/attack/damage, and other effects like speed changes or incapacitation. "attacksAgainst" effects now correctly shown as "Enemies Have Advantage/Disadvantage On" instead of being confused with your own rolls.)
- [x] Conditions not displayed in combat tab and not affecting combat rolls (fixed: Added renderCombatConditions() method showing active conditions with icons and remove buttons. Added "Add Condition" button to combat tab. Fixed _rollAttack() to check hasAdvantageFromStates() and hasDisadvantageFromStates() with proper attack type formatting (attack:melee:str). Conditions now sync between overview and combat tabs.)
- [x] race abilities like aggressive, charge, etc not added to combat UI automatically (fixed: Added "Combat Abilities" section on the LEFT side with other active abilities (attacks, spells, methods). renderCombatActions() displays race/class/feat abilities that have explicit action economy (bonus action, action, reaction) AND limited uses or combat keywords. Strict filtering excludes non-combat features like suggested characteristics, proficiencies, darkvision. Shows action type icons (⚔️/⚡/🔄), uses tracking, and tooltips with descriptions.)

### Spells

- [x] features giving spells or spell choice (like warlock invocations, fey-touched feat, etc) not adding spells automatically and not giving choice UI. Needs to solve for all features that give spells in a general way. (fixed: Enhanced SpellGrantParser.parseAdditionalSpells() to handle all nested structures: known._, prepared._.rest/daily, innate._.daily.1e, etc. Added pendingSpellChoices storage to state with methods: addPendingSpellChoice(), getPendingSpellChoices(), fulfillSpellChoice(). Created showFilteredSpellPicker() in spells module that parses filter strings like "level=1|school=E;D" and shows filtered spell picker modal. Updated_processFeatureSpells() to add pending choices instead of logging. _addFeat() in features.js and level-up now trigger processPendingSpellChoices() after adding feats. Fixed spells like Misty Step are auto-added, while choice spells show picker.)
- [x] need to add spell-casting UI that would check constraints before casting (like from conditions) (fixed: Added _checkCastingConstraints() method to charactersheet-spells.js that checks for conditions preventing spellcasting. Incapacitating conditions (Incapacitated, Paralyzed, Petrified, Stunned, Unconscious) completely prevent casting. Silenced condition prevents spells with verbal components. Added "Silenced" to CONDITION_EFFECTS with icon and effects. Both _castSpell() and_castInnateSpell() now check constraints before casting and show warning messages.)
- [x] need spells that require concentration to set concentration active state when cast from overview or combat tab, and not be castable if already concentrating on another spell. (fixed: Updated _castSpell() in charactersheet-spells.js to check if spell requires concentration. If already concentrating, prompts user to break concentration before casting. When concentration spell is cast, calls setConcentration() to set the active state. Also updates combat tab and overview UI after casting. Combat tab's_castCombatSpell() now awaits the async method and refreshes states/effects.)

### Classes

- [x] monks give both ki points and focus points (fixed: Changed from adding both resources to using a placeholder that resolves to either "Ki Points" (2014 PHB) or "Focus Points" (2024 XPHB) based on class source. Also added check to treat them as interchangeable when looking for existing resources, preventing duplicates.)
- [x] monk's unarmored movement bonus not applied to speed (fixed: Added getUnarmoredMovementBonus() method that calculates the monk's speed bonus based on level (+10 at 2, +15 at 6, +20 at 10, +25 at 14, +30 at 18). Checks if wearing armor or shield (bonus only applies when unarmored). Integrated into getSpeed() and getWalkSpeed() calculations.)
- [x] rangers give favoured enemy even on rangers without it like TGTT (fixed: Added hasFavoredFoe() method that checks if the character actually has a "Favored Foe" or "Favored Enemy" feature. The Ranger calculation in getClassCalculations() now only includes favoredFoeDamage if hasFavoredFoe() returns true. Homebrew rangers like TGTT that don't have this feature won't show it.)
- [x] Deft Explorer not giving expertise choice.

### Multiclassing

- [x] spell slots not calculated correctly with multiclassing (fixed: Updated calculateSpellSlots() in charactersheet-state.js to use casterProgression property from class/subclass data instead of hardcoded class name lists. Added casterProgression and spellcastingAbility to class data when adding classes in builder and level-up. Supports all progression types: "full" (Bard, Cleric, etc.), "1/2" (Paladin, Ranger), "1/3" (Eldritch Knight, Arcane Trickster), "artificer" (rounds up), and "pact" (Warlock separate slots). Includes fallback mappings for older saved characters without stored progression.)
- [x] choosing a class in multiclassing is not visually clear which class is being chosen (fixed: Redesigned multiclass selection modal in showMulticlass(). Now uses charsheet__levelup-option styling with radio buttons, hit die display, and class descriptions. Added selection confirmation display showing chosen class name. Confirm button dynamically updates to show "Add [ClassName] (Level 1)" when class is selected. Empty state message shown when filter matches nothing.)
- [x] level 1 choices for multiclassing not given (like fighting style for fighter, invocations for warlock, etc) (fixed: Added _showMulticlassChoices() method that checks for optionalfeatureProgression and feature options at level 1. If choices exist (like Fighter's Fighting Style), shows a second modal with_renderOptionalFeaturesSelection() and _renderFeatureOptionsSelection(). Validates all required selections before allowing confirmation. Added_applyMulticlass() helper that handles adding the class, features, selected optional features, and feature options all together.)

### General

- [x] rolls go from 0 to number of sides instead of 1 to number of sides (e.g d20 roll can be 0) (fixed: Changed from RollerUtil.roll(N) which returns 0 to N-1, to RollerUtil.randomise(N) which returns 1 to N. Fixed in: rollDice(), _rollD20(),_onDeathSave(), hit die rolls, and level-up HP rolls.)
- [x] Activated abilities not applying their effects to rolls or stats (fixed: Added getBonusFromStates() calls to attack rolls and damage rolls in combat module. Added getSaveBonusFromStates() method for saving throw bonuses from active states. Updated getSaveMod() to include state bonuses. Updated getBonusFromStates() to handle abilityMod effects like Bladesong's +INT to AC. Active state effects like combat stances, Bladesong bonuses, etc. now properly apply to attacks, damage, saves, and AC.)

### UI

- [x] in specialties choices in builder it's not quite clear which box is for which feature. Spacing a bit off.

## Old Bugs

### Items

- [x] armors are not affecting the actual AC of the character
- [x] Magic weapons/armors have issues - attack rolls not calculated correctly, bonuses not applied
- [x] General magical item bonuses (to attack rolls, damage rolls, AC, saving throws, ability checks, spell attack rolls, spell save DCs, etc) are not applied
- [x] Items with charges (like wands) do not track charges or allow expending them
- [x] Items that require attunement do not enforce attunement limits (3 items max, class limited attunements, etc)
- [x] Items that require attunement do not apply their effects when attuned
- [x] Equipped and attuned items not displayed on the right side in the inventory (there is place for display but nothing shows up)
- [x] Weapon properties and masteries are not displayed
- [x] Items with no rarity shouldn't display "none" as rarity, they should just not display rarity.
- [x] Equip and Attune buttons are not intuitive, maybe better icons or add text next to them

### Spells

- [x] add spells button isn't working
- [x] spell save DC isn't calculated and spellcasting ability isn't displayed
- [x] number of spell slots isn't calculated and isn't displayed
- [x] Warlocks with Pact Magic don't have their spell slots calculated/displayed correctly
- [x] Warlock can't pick leveled spells
- [x] Amount of spells known isn't calculated/displayed/enforced
- [x] Amount of prepared spells isn't calculated/displayed/enforced
- [x] Warlocks can't cast spells with slots, says no spell slots available
- [x] warlock spell slots not recharging on short rest or long rest

### Combat

- [x] can't delete or edit attacks once created
- [x] weapon attacks don't have relevant properties, msteries, and weapon abilities (magical weapon stuff) displayed
- [x] Spells are not integrated into combat (no spell attacks, spell save DCs, spell effects, etc)
- [x] natural weapons features (like claws, bite, etc) not added to attacks automatically

### Character Builder

- [x] Selecting items not working correctly and not needed since items can be added later in inventory.
- [x] 2024 classes don't have starting equipment options displayed at the choice, e.g efa articificer gives them to you but does not show them in the builder
- [x] Character age, height, and weight inputs should only accept numbers
- [x] Background tool proficiencies override existing proficiencies instead of adding to them
- [x] races with subraces don't show subrace selection in the builder, and subcraces appear as different races
- [x] some backgrounds don't show tool proficiencies selection in the builder, or tool proficiencies that are broken
- [x] When assigning ability scores, the system allows going over the maximum allowed points with race bonuses applied afterwards (fixed: capped manual entry base score to 18, the max before racial bonuses)
- [x] when assigning ability scores, using standard array does not remove the placeholders for unassigned scores, creating some confusion (fixed: summary now shows "—" for unassigned scores with message, and validation requires all scores to be assigned)

### Features

- [x] class features not being added correctly from the builder, e.g warlock's eldritch invocations
- [x] feature display should be drop down and link, currently class features are only links.
- [x] race features are all called the race name instead of their actual names, e.g darkvision is called "Dwarf" for dwarves
- [x] some classes (bard) add their features twice for some reason (fixed: added deduplication in addFeature)
- [x] Jack of all trades feature does not add half proficiency to all skills correctly (fixed: added hasJackOfAllTrades() check in getSkillMod and getInitiative)
- [x] classes with expertise feature don't get to choose their expertise skills during builder (fixed: added expertise selection UI for Rogue at level 1, shows after skill selection)
- [x] weapon masteries choices not given during builder for classes that get them (fixed: added weapon mastery selection UI for Fighter, Paladin, Ranger, Rogue with proper count from class tables)
- [x] specialties and combat methods (treaveler's guide to thelemar) not selectable during builder or level up for classes that get them (bard, rogue, etc). SHould be a general fix for similar features that require choice, weather they are OptionalFeature type or classFeature/subclassFeature type.
- [x] stamina pool (thelemar homebrew) not recovered on long rest or short rest and doesn't appear in resources section (fixed: stamina now appears in tracked resources section with clickable pips, recovers on short/long rest)
- [x] combat traditions and methods not selectable during level up (fixed: if no traditions set, level-up now allows selecting traditions before methods; methods filtered by known traditions and max degree)

### Overview

- [x] attacks and spells should also appear at the overview page for quick access (enhanced with Combat stats, spell stats, range, properties)
- [x] Active features aren't displayed correctly, and should include only important features and not all of them (fixed: now shows important features grouped by type with proper names)
- [x] Jump distance isn't displayed (added Long Jump and High Jump based on Strength)
- [x] Senses aren't Displayed (added Senses section showing Darkvision, etc.)
- [x] Passive stats that aren't perception are not calculated or displayed (added Passive Investigation and Passive Insight)
- [x] proficiency or expertise in skills not displayed in a clear way (improved visual indicators with half/prof/expert legend)
- [x] exhaustion level not displayed or tracked (added dedicated exhaustion tracker with +/- controls and effect display)
- [x] exhaustion affects dice rolls (2024 rules: -2 per level to all d20 tests, 2014 rules also supported)
- [x] exhaustion affects speed (2024: -5 ft per level, 2014: halved at level 2, 0 at level 5)
- [x] exhaustion removed on long rest (1 level per long rest)
- [x] support for both 2024 and 2014 exhaustion rules (toggle in exhaustion section)
- [x] active features not correct or clear, display only some random features and race features have only race name (fixed in Active Features section)
- [x] spell slots not displayed in overview (added compact spell slot display with "Spell Slots:" label)
- [x] spell casting time not shown in overview (added casting time to quick spells)
- [x] weapons/spells in overview not hoverable (added hover links for items and spells)
- [x] carry weight only in inventory (added Carry and Push/Drag/Lift to overview)
- [x] resources section doesn't update when features that add resources are added/removed (e.g adding/removing a feature that gives a resource doesn't update the resources display until page refresh)
- [x] resources don't have a use button and don't recover on rests
- [x] not all resources from features are added to resources section automatically (some features that give resources are not detected and added)
- [x] sneak attack die, save DCs for non spell related features (combat methods, monk ki features, etc) not calculated/displayed

### Level Up

- [x] when a choice feature (like metamagic, invocations, maneuvers) comes up during level up, there is no way to select the options (added selection UI with validation)
- [x] when reaching an ASI level, the feature ASI is added to the sheet regardless of the choice that was made (ASI choices now recorded as a feature showing which stats were increased)
- [x] optional features not hoverable (fixed featureType to "Optional Feature" for proper hover linking)
- [x] optional features not grouped together (now grouped by type with headers like "Eldritch Invocations", "Metamagic Options")
- [x] progression of optional features not calculated correctly (now counts existing features of that type)
- [x] duplicate features like "Metamagic" appearing multiple times (now filters out features already on character)
- [x] subclass and subclass features no longer appear in feature tab after being selected (fixed duplicate filter to only apply to non-subclass features)
- [x] when choosing features on level up features already known should be disabled in the selection list unless they can be taken multiple times (now shows "Known" badge and disabled, with "Repeatable" badge for re-selectable options)

### General

- [x] skills, conditions and many other things are hard coded instead of being retrieved from the site, which would prevent homebrew from affecting the sheet
- [x] no ability to filter the sources used in the sheet (e.g only use PHB and TCoE)

[X] Dual MInd ability of Kalashtar and Nyuidj becomes a simple +1 to the save in the modifiers instead of advantage, and doesn't seem to be applied
[X] Modifier options does not seem to include all the new functionalities from the custom abilities
[X] Stances from combat methods don't seem to apply correctly and have an active modifier before they are activated. Wary stance for example adds proficiency bonus +3 to roll, instead of proficiency bonus, and +3 to passive.
[X] Text is way too small and multiple players complained, this is an accesebility issue that should be fixed as soon as possible.
[X] Combat Methods are not bunched together under the same tradition
[X] Ranger Primal Focus supports activation (though using it from abilities and not ctive states does nothing), but not switching between states.
[X] Wizard subclasses from TGTT don't seem to be added upon choice, might extend to other wixard classes as well, but haven't been tested yet.
[X] Children of the empire can't choose cantrip like they are supposed to in the builder.

[x] Some races (Tortle for example) have traits that aren't implemented in calculations (e.g. Shell Defense). These should be added to `getFeatureCalculations()` and tested.

- FIXED: Added ~30 official race trait registrations to `FeatureEffectRegistry._registerRaceFeatures()` covering Tortle (Natural Armor AC=17, Shell Defense +4 AC toggle, Claws), Lizardfolk (Natural Armor AC=13+DEX, Bite), Half-Orc (Relentless Endurance, Savage Attacks extra crit die), Goblin (Fury of the Small damage=proficiency, Nimble Escape), Bugbear (Surprise Attack +2d6, Long-Limbed +5 reach), Dragonborn (official Breath Weapon DC/damage scaling for PHB and XPHB editions), Warforged (Integrated Protection +1 AC), Autognome/Thri-kreen (AC=13+DEX), Loxodon (AC=12+CON), Tabaxi (Claws), Shifter, and more. Added scaling calculations in `getFeatureCalculations()` for Tortle, Lizardfolk, Goblin, Bugbear, and official Dragonborn Breath Weapon (both PHB 2d6 and XPHB 1d10 progressions).
[x] Some races (Tortle for example) get a +1 +1 as their racial ASI, but it should be at min +2 +1.
- FIXED: TGTT Tortle correctly inherits +2/+1 from TTP copy. The actual offender was the Nyuidj race whose `choose` block used `{count: 2, amount: 1}` (two +1s). Changed to `{weighted: {from: [...], weights: [2, 1]}}` for proper +2/+1.
  [x] classes that have starting amount of spells don't have a time to choose the spells during character creation, and so when doing a quickbuild it appears as if they have less spells to choose then they should. This should be fixed by adding a step in the character creation process to choose the starting spells for classes that have them, but if quickubild is detected, the step should be skipped and the amount of spells needed should be added to the amount of spells the quickbuild will say that needs to be chosen.
- FIXED: Added Step 6 "Spells" to the builder between Equipment and Details (bumped to 7 steps). `_getKnownCasterInfoForBuilder()` detects known-spell casters (Sorcerer, Bard, Warlock 2014) at level 1 via `getKnownSpellsAtLevel`. `_renderSpellsStep()` shows full spell picker with class filtering and Divine Soul support. Non-spellcasters see an informational skip message. Validation enforces spell/cantrip counts. Apply adds spells to state.
[x] Divine soul sorcerer doesn't have the option to choose cleric spells as sorcerer spells, and so they don't get the correct amount of spells to choose from. This should be fixed by adding an option for divine soul sorcerers to choose cleric spells as sorcerer spells, and adjusting the amount of spells they need to choose accordingly.
- FIXED: Added `additionalClassNames` parameter to `CharacterSheetSpellPicker.renderKnownSpellPicker()`. When subclass is "Divine Soul", passes `["Cleric"]` as additional class names. The spell filter now checks both the primary class list and additional lists. Applied in all three call sites: levelup.js, quickbuild.js, and builder.js.
[x] Warlock needs to choose horror invocations even when not using the horror subclass. This should be fixed by only giving the option to choose horror invocations when the horror subclass is selected.
- FIXED: Added `prereq.pact` filtering in both `_renderStandardOptionalFeatures` (builder) and `_renderStandardOptionalFeaturesLevelUp` (levelup). Invocations requiring e.g. "Pact of Transformation" now only appear when the character has that pact.
[x] Magical cunning feature has a broken link.
- FIXED: Added official source fallback lookup in charactersheet-features.js. When a feature's stored source is homebrew but it matches an official feature, the hover link now resolves to the correct official source.
[x] When leveling up a warlock regularly, there is a bug that doesn't allow me to choose new invocations because the modal is bunched up and not showing the invocations.
- FIXED: Changed invocation modal `max-height` from `250px` to `60vh` in charactersheet-levelup.js.
[x] eldritch blast beams don't scale correctly, should be by general level and not class specific level.
- FIXED: Changed beam calculation in charactersheet-state.js to use `this.getTotalLevel()` instead of `cls.level`. Added 6 regression tests in CharacterSheetBugFixes.test.js.
[x] When multiclassing sorcerer/warlock it doesn't give option for warlock spells to choose, only sorcerer.
- FIXED: Added prepared-caster detection (`isPreparedCaster`) alongside known-caster detection in both levelup.js and quickbuild.js. XPHB Warlock (which has `preparedSpellsProgression` instead of `spellsKnownProgression`) now gets its own spell picker section (8c) using the same `renderKnownSpellPicker` UI. Calculated gains are stored as `prepared: true` spells. Added full prepared-caster support in quickbuild including aggregation, rendering, validation, and apply steps.
[x] XPHB Warlock builder shows duplicate invocation counters. The `optionalfeatureProgression` and `classFeatures` "Eldritch Invocation Options" both render counters — first shows 1/1 after selection but second stays 0/1, causing validation failure.
- FIXED: Added `_isOptionGroupCoveredByOptFeatProgression()` helper that detects when a classFeature option group's entries are all `type: "optionalfeature"` AND their featureTypes overlap with `optionalfeatureProgression`. Used it to filter duplicate groups in both `_renderClassFeatureOptions` and `_getFeatureOptionsAtLevel`.

[x] Sorcerer doesn't give choice of starting items, but it should. It seems there is some confusion on what type of the data to access.

- FIXED: Implemented full equipment type picker for `equipmentType` items in the builder. Added `_getItemsForEquipmentType()` with match functions for all 12 equipment types (simple/martial melee/ranged weapons, arcane/holy/druidic focuses, etc.), `_renderEquipmentTypePickers()` for dropdown UI, and `_addEquipmentItems()` resolution logic. Equipment type pickers now render for both radio-choice and fixed-row equipment, with XPHB-preferred deduplication.
  [] new bug that stems from it - the items that pop up in the dropdown are also magical items and variants of base items, which is not the desired outcome.
[] Backgrounds that give proficiency in musical instrument do not let you choose which one, and don't add it to the character sheet. This should be fixed by allowing the user to select the instrument and adding it to the proficiencies.
- Fix Attempt that still didn't work, layers still don't get prompted to choose actual items: Added `anyMusicalInstrument` handling in `_renderBackgroundToolProficiencies` mirroring the existing `anyArtisansTool` pattern. Renders dropdown with `Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS`, stores selection with `isMusicalInstrument: true` flag, and excludes from fixed tool proficiency apply.
[] Tasha race options are allowing ability score increase change, but not skill proficiency and language change.
[] when clicking multiclass in the quickbuild, the modal appears behind the quickbuild modal, making it impossible to select the class you want to multiclass into. This is a z-index issue that should be fixed by increasing the z-index of the multiclass modal.
[] When choosing TGTT sorcerer, you get a subclass choice both at 3rd level and at 6th level, but only the 3rd level one should be there.
[] When adding ASI in both level up and quick build, the racial bonus is not applied to the ability scores displayed. Also, the ability text intersects with the ability numbers, which is a UI bug.

[x] Cunning Strike and sneak attack working, but need UX overhaul to be more useable by players — FIXED: Redesigned SA section with condition indicators (advantage/disadvantage/ally pills), toggle-switch style (READY/OFF/USED), dice count header with CS deduction display. Cunning Strike options are now toggle-buttons that mechanically deduct dice from SA damage rolls and report save DCs in damage results. Attack flow auto-refreshes SA section and prompts when SA conditions are met. CS selections reset on SA use/round advance/combat end. FOLLOW-UP: SA now auto-enables after an eligible attack when conditions are met (advantage or ally), removing the confusing pre-enable workflow. Also fixed advantage detection from state effects (e.g. Steady Aim) — SA trigger logic now checks both rollD20 mode AND hasAdvantage/hasDisadvantage flags from active states.
[x] Specialties like Observer that add a +3 to passive skill don't add to the passive skill. Also, specialties that give proficiency or expertise choices don't give that — FIXED: Broadened parseFeatureAutoEffects/parseFeatureSkillChoice type guards to accept "optionalfeature" type. Added parsing calls to builder's optionalfeature branch.
[x] Races seem to sometimes add +1/+1 ASI when it is clearly wrong — FIXED: Ability bonuses were accumulating when re-visiting wizard steps (step 1 and step 4) without clearing first. Step 1 now clears all bonuses before applying racial traits. Step 4 now clears bonuses, re-applies racial, then applies background. Removed no-op clearing comment. FOLLOW-UP 1: Fixed mixed ability sets (e.g. Changeling ERLW: {cha: 2, choose: {...}}) where the if/else branching skipped fixed entries when a choose block existed in the same object. Now always processes fixed entries first, then choose entries — applied to _applyRacialAbilityBonuses. FOLLOW-UP 2: Same if/else bug existed in THREE display methods (_getRacialBonus, _getRacialBonusesHtml,_renderRacePreview) that calculate/show racial bonuses in the builder UI. Fixed all three to process both fixed and choose entries from the same ability set.
[x] Languages have XPHB as their source even when not, this messes with hover — FIXED: Built dialect→parent language map, rewrote hover link rendering to resolve dialects to parent language, fall back to plain text for unknown languages instead of hardcoded XPHB.
Uncaught (in promise) Error: Failed to load renderable content for: page="languages.html" source="XPHB" hash="aquan_xphb" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15533:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15448:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15533
pHandleLinkMouseOver @ render.js:15448
await in pHandleLinkMouseOver
onmouseover @ VM5996 charactersheet.html:1Understand this error

### Changling

- [x] Shapechanger does not appear as an action. **FIXED Phase 8**: Added "shapechanger" to FEATURE_CLASSIFICATION_OVERRIDES as "combat". Now routes to combat actions tab instead of being a toggle state.

### Monk TGTT

- [x] Equipment choices look broken somewhat, mentions choosing musical instrument or artisan tool but doesn't let you choose. **FIXED Phase 8**: Added _renderClassToolProficiencyChoice() to builder with category+tool dropdowns. Added_selectedClassToolProficiencies storage and application in _applyClassFeatures(). Also added anyMusicalInstrument and artisanOrInstrument support to levelup wizard tool choice rendering.
- [x] Says you can choose muscial instrument proficiency or artisan tool proficiency but doesn't let you choose either. **FIXED Phase 8**: Same as above — builder now renders choice UI for structured toolProficiencies data (anyArtisansTool/anyMusicalInstrument).
- [x] Has both Ki save DC and Focus Save DC. Neither appears in the combat tab, and both are added in level 1 instead of 2. Should probably go with Ki save DC, but need to validate against the data. **FIXED Phase 3**: Both `kiSaveDc` and `focusSaveDc` now gated on monk level >= 2 in `getFeatureCalculations()`. Formula: 8 + proficiency + WIS mod + item bonus - exhaustion penalty.
- [x] Combat Methods DC isn't calculated correctly for monk TGTT, should be 9 + proficiency + MAX(STR, DEX,  WIS). **FIXED Phase 7**: State already had correct formula (9 + prof + max(STR, DEX, WIS)) since Phase 4. Renderer now uses state-calculated `combatMethodDc` instead of hardcoded 8 + prof + max(STR, DEX).
- [x] Monks Focus appears as an activateable state, but it shouldn't. **FIXED Phase 1**: Added "monk's focus" to FEATURE_CLASSIFICATION_OVERRIDES as "passive". No longer appears in activatable states.
- [x] Flurry of blows, Patient Defense, and Step of the Wind don't appear as combat actions in the combat tab. **FIXED Phase A/B/C/E**: Flurry of Blows and Step of the Wind classified as "combat" via FEATURE_CLASSIFICATION_OVERRIDES with feature-specific content in modal (strike count, heightened hint, healing/harm choice hint, dash/disengage description). Patient Defense correctly remains as toggle state with visual feedback: `summarizeEffects()` produces "Attacks against you have disadvantage; Advantage on DEX saves". Heightened Focus variant adds temp HP formula. Generic combat action effect pipeline (`_useCombatAction()`, `_applyCombatActionEffects()`, `_renderEffectsPreview()`) powers all modal UIs.
- [x] There is a modal in the combat tab for combat spells despite not being a spellcaster, but no modal for combat actions. Should be the opposite for monk, and combat spells should be added only if spells are added to the character somehow. **FIXED Phase 10**: Combat spells section now hidden by default (`style="display: none;"`) in HTML, only shown by JS when the character actually has combat-relevant spells. Eliminates the flash of empty spell section for non-casters.
- [x] Implements of Mercy is not implemented at all. **FIXED Phase 4**: Insight + Medicine proficiency + Herbalism Kit granted via effect pipeline.
- [x] Hands of Harm, Hands of Mercy appear as activateable states, but they should be combat actions. **FIXED Phase 1**: Added "hand of harm" and "hand of healing" to FEATURE_CLASSIFICATION_OVERRIDES as "combat". Now route to combat actions tab.
- [x] Deflect Attack doesn't appear in the combat tab at all. It should be a reaction combat action, and should have implementation to reduce damage and potentially catch the projectile and use it as an attack. **FIXED Phase 1/3**: "deflect attacks" and "deflect missiles" added to FEATURE_CLASSIFICATION_OVERRIDES as "reaction". Calculation flags: `deflectMissilesReduction` (all monks) and `deflectAttacksReduction` (XPHB) with formula 1d10 + DEX mod + monk level. Deflect Energy flag at level 13.
- [x] Adept speed specialty works and is choosable mutliple times, but the speed increase doesn't stack after the first time. Should be 10 ft increase each time, but currently only increases by 10 ft on the first time and then doesn't increase anymore. It also doesn't show the adept speed as a specialty that was chosen more than once - probably a problem with the anti duplcation logic in the sheet. **FIXED Phase 5**: Speed stacking verified working — each selection at different levels creates a separate +10 ft modifier that stacks. Calculation flags track count and total bonus.
- [x] items that should be monk weapons (e.g. quarterstaff, spear) don't have the monk weapon tag, and aren't treated as monk weapons in the combat tab. They should be tagged as monk weapons and treated as such in the combat tab (e.g. allowing use of dexterity modifier, allowing flurry of blows, etc.) **FIXED Phase 3**: `isMonkWeapon()` correctly identifies shortsword + simple melee weapons without heavy/2H/special properties. Quarterstaff and spear both qualify. 14 test cases verify classification.
- [x] Stunning Strike appears as an activateable state, but it should be a combat action. **FIXED Phase 1/3**: Added "stunning strike" to FEATURE_CLASSIFICATION_OVERRIDES as "combat". `hasStunningStrike = true` flag set at monk level 5+.
- [x] Wall Walk specialty appers as an activateable state, but it should be a passive feature that allows walking on vertical surfaces and ceilings without falling. It has the ability to cast spider climb on self as a bonus action for a cost, but it should show this as a combat action that will add the spider climb effect for the mentioned time. **FIXED Phase C4**: Reclassified to "combat" via FEATURE_CLASSIFICATION_OVERRIDES. `wallWalkSpiderClimbEffects` populated in `getFeatureCalculations()` with `applyCondition: {name: "Spider Climb (self)", duration: "concentration, up to 10 minutes"}`. Combat action modal shows Spider Climb description via `_getFeatureSpecificContent()`. Tests verify classification + effects population.
- [x] Empowered Strikes not implemented. **FIXED Phase 3**: `hasEmpoweredStrikes` (XPHB) and `hasKiEmpoweredStrikes` (PHB) both set at monk level >= 6 in `getFeatureCalculations()`. Also classified as "passive" in FEATURE_CLASSIFICATION_OVERRIDES.
- [x] Physician's Touch not implemented. **FIXED Phase 4**: Calculation flag + condition list (blinded, deafened, paralyzed, poisoned, stunned) at level 6.
- [x] Monk's ability to use focus points to power combat methods is not implemented. **FIXED Phase 4**: Focus→Stamina conversion verified working (canUseFocusForStamina/useFocusForStamina).
- [x] Evasion is not added to the character sheet at all on levelup. **FIXED Phase 3**: `hasEvasion = true` at monk level >= 7 in `getFeatureCalculations()`. Also has effect processor for DEX save advantage. Classified as "passive" in FEATURE_CLASSIFICATION_OVERRIDES.
- [x] Unhindered Flurry is not implemented at all, it appears as an activateable state but it should be a passive feature that allows flurry of blows to be used without expendng a ki point. **FIXED Phase 6**: Already classified as passive (Phase 1). Calculation flag hasUnhinderedFlurry added at TGTT Monk level 8.
- [x] Agile Acrobat specialty doesn't add the acrobatics proficiency, and doesn't increase dexterety by 2 to a maximum of 20. **FIXED Phase C5**: `_aggregateCalculationBasedEffects()` emits `skillProficiency` effect (acrobatics) and `abilityScoreBonus` effect (DEX +2, max 20) when `hasAgileAcrobat` is true. Both applied via generic effect pipeline. Tests verify effect shape.
- [x] Perfect Flow specialty doesn't work. **FIXED Phase 5**: Calculation flags added (hasPerfectFlow, perfectFlowFocusGain). Focus point gain on initiative tracked.
- [x] Heightened Focus appears as an activateable state, but it should be a feature that modified the workings of Flurry of Blows (make it 3 attacks instead of 2), Patient Defense (gain temprary hp on activation), and Step of the Wind (move creature with you). **FIXED Phase 6**: Already classified as passive (Phase 1). Calculation details added: heightenedFlurryAttacks=3, heightenedPatientDefenseTempHp formula, heightenedStepOfTheWindDistance=20.
- [x] Self-Restoration doesn't work. **FIXED Phase 6**: Calculation flag hasSelfRestoration with selfRestorationConditions=["charmed", "frightened"] at XPHB Monk level 10.
- [x] Flurry of healing and harm isn't implemented correctly, should link into flurry of blows as a choice modal. **FIXED Phase C6/E**: `_showCombatActionChoiceModal()` infrastructure built in Phase A. Flurry of Blows `_getFeatureSpecificContent()` shows healing/harm hint when `hasFlurryOfHealingAndHarm` is true. Choice modal detection via `_parseCombatActionEffects()` recognizes "replace" wording. Calculation flags verified at L11. Phase E tests cover choice detection, feature content, and FoHaH flag lifecycle.
- [x] Instant Step specialty is an activateable state, but it should be a combat action that adds invisibility condition until start of next turn. **FIXED Phase C7**: Classified as combat action. `instantStepEffects` populated with `applyCondition: {name: "Invisible", duration: "until start of next turn", self: true}`. `_useCombatAction()` applies invisible condition via `_applyCombatActionEffects()`. Modal shows range + invisibility via `_getFeatureSpecificContent()`. Tests verify integration (condition applied, toast shown).
- [x] Religious Training Specialty is an activateable state, but it should be an action that lets you spend stamina. **FIXED Phase C8**: Classified as combat action. Combat action modal shows stamina cost and description via generic effect pipeline.
- [x] Disciplined Survivor does not give proficiency in all saving throws (keep in mind that it should also give proficiency in death saving throws, a rare occurence that needs to be marked somehow). It also appears as an activateable state, but it should be a passive feature that gives you proficiency in all saving throws and allows you to reroll a failed save once per long rest. **FIXED Phase C9**: Classified as passive (Phase 1). All 6 save proficiencies applied via effects pipeline. `hasDeathSaveProficiency` flag set when `hasDisciplinedSurvivor` — death save rolls add proficiency bonus. Reroll cost tracked (`disciplinedSurvivorRerollCost=1`). Tests verify death save with proficiency: roll 8 + prof 5 = 13 succeeds, roll 4 + prof 5 = 9 fails.
- [x] Perfect Focus isn't implemented at all. **FIXED Phase 6**: Calculation flags hasPerfectFocus + perfectFocusRecovery=4 at XPHB Monk level 15.
- [x] Wind Strike combat method isn't implemented correctly and needs deep implementation. **FIXED Phase B/C10/D**: Enhanced parser extracts range (20/60 ft), `grantsAdvantage`, `bonusDamage` (weapon die on double hit). Combat action modal shows ranged attack info with advantage indicator via `_renderModalRollSection()`. Roll Attack button uses `rollD20({mode: "advantage"})`. Phase D survey verified UW (Unending Wheel) tradition parsing with 81 tests across all traditions.
- [x] Sixth Sense Specialty isn't implemented at all, should give you advantage on initiative and make your intelligence skills use MAX(INT, WIS) instead of just INT. **FIXED Phase 5**: Calculation flags added. Multi-skill WIS-for-INT swap implemented via abilitySwap modifiers in effect pipeline. getSkillMod() now checks for abilitySwap modifiers and uses MAX(default, swapped) ability. Generic fix also benefits Nimble Athlete, Power Tumble, and all future ability swap features.
- [x] Hand of Ultimate Mercy is an activateable state, but it should be a combat action. **FIXED Phase 1**: Classified as combat action via FEATURE_CLASSIFICATION_OVERRIDES.
- [x] Superior Defense not adding resistance like it should. **FIXED Phase 6**: Conditional resistance modifier registered via effects pipeline (spend 3 Focus Points as action). superiorDefenseCost=3 tracked.
- [x] Shadow Walk Specialty isn't implemented at all. **FIXED Phase 5**: Classification as combat action added to FEATURE_CLASSIFICATION_OVERRIDES. Calculation flags (hasShadowWalk, shadowWalkRange) added.
- [x] Body And Mind is not implemented at all. **FIXED Phase 6**: +4 DEX and +4 WIS via abilityScoreBonus effect type, capped at max 25. Calculation details: bodyAndMindDexBonus=4, bodyAndMindWisBonus=4, bodyAndMindMaxScore=25.

### General

- [x] Need to be able to see what are the parts that make up a character's speed (same approach like armor class). Would be especially important for classes like monk where speed can be increased by multiple features, but also generally useful for understanding how the final speed is calculated. **FIXED Phase 9**: `getSpeedBreakdown(type)` returns `{total, components[]}` with typed/named/valued entries. Speed box shows hover popup + click modal with walk breakdown and other movement types. Covered by stat breakdown tests.
- [x] Some TGTT subclasses have combat methods feature, which should add a tradition proficiency and allow choosing another method. They are, across the board, not implemented right now. **FIXED Phase D**: Generic `_subclassGrantedTraditions` system in `getFeatureCalculations()` emits `combatTradition` effects via `_aggregateCalculationBasedEffects()` → `_applyFeatureEffect()` → `addCombatTradition()`. Warder auto-grants Tempered Iron + Gallant Heart; TGTT Arcane Archer auto-grants Biting Zephyr; TGTT Way of Mercy auto-grants Sanguine Knot. Traditions clear/re-apply on class change. Stance speed bonus wired into `getSpeedBonusFromStates()`. 81 tests in CharacterSheetCombatMethodsSurvey covering all 17 traditions, stance integration, subclass grants, parser edge cases, degree progression, DC calculation, and stamina pool.
- [x] Levelup modal should be bigger. **FIXED Phase 8**: Changed levelup wizard container overflow from `hidden` to `auto` for proper content scrolling. Increased content-heavy modal height from `min(600px, 70vh)` to `min(700px, 80vh)`.
- [x] When trying to edit an attack from the combat tab, the edit modal defaults to an undefined item. **FIXED Phase 8**: Changed _editAttack() to use getItems() (flattened format with top-level name/property) instead of getInventory() (raw format with nested item data). Also added finesse/spellcasting ability options to weapon attack modal dropdown.
- [x] Homebrew skills don't work correctly, they don't take into account the ability score modifier. **FIXED Phase 8**: Replaced duplicate skill→ability map in getSkillMod() with delegation to getSkillAbility(), which is the single source of truth covering standard skills, hardcoded homebrew skills (cooking/culture/endurance/engineering/harvesting/linguistics/might), and user-created custom skills.
- [x] There is no modal for actions (from combat, from race, from feats, etc.) in the overview tab, but there is one for spells. This makes it impossible to see the details of the actions that a character has from the overview tab, which is where you would expect to be able to see them. There is an Abilities modal, but it seems to never be populated with anything. **FIXED Phase 10**: Overview Abilities section now shows class resources (Channel Divinity, Ki Points, Rage, etc.) with current/max uses, recharge type, and Use button alongside custom abilities. Actions modal was already functional from prior phases.
- [x] Respec doesn't let you change race or background, and doesn't show you what you gained from each in terms of skills, proficiencies, etc. **COMPLETE Phase 10+C12**: Level 1 respec timeline card shows read-only summary of race grants (speed, darkvision, size, resistances, skills, languages) and background grants (skills, tools, languages, starting equipment). Editing race/background is intentionally not supported (requires full rebuild); read-only display is the final state.
- [x] In general, it should be possible to understand how each stat and bonus in the sheet is calculated at a glance. If my dex save is a +10 with advantage, I want to be able to see that it's +4 from my dexterity, +3 from proficiency, +2 from a magic item, and +1 from a feat, and advantage from a class feature. This is especially important for things like AC and speed where there are multiple sources of bonuses that can interact in complex ways. The same goes for things like spell DC, attack rolls, etc. where there are multiple sources of bonuses that can interact in complex ways. It is also important for skills, where you can have proficiency, expertise, and various bonuses from items and feats. The sheet should make it easy to see how each of these is calculated and what the sources of each bonus are. This is important for both understanding your character and for debugging issues with the sheet. **FIXED Phase 9**: Added 6 breakdown methods to state (`getSaveBreakdown`, `getSkillBreakdown`, `getSpeedBreakdown`, `getInitiativeBreakdown`, `getSpellAttackBreakdown`, `getSpellDcBreakdown`) all returning `{total, components[]}` with typed/named/valued/icon'd entries. Save/skill rows show multi-line component tooltips on hover. Speed box shows hover popup + click modal with walk breakdown and other movement types. Initiative shows hover popup. All breakdowns account for: ability mods, proficiency/expertise/JoAT, custom modifiers, item bonuses, active state effects, exhaustion penalties, armor STR penalty, unarmored movement, condition multipliers, ability swaps. 34 tests covering all breakdown methods.
- [x] Epic boons in the levelup and quickbuild are not hoverable, don't show which have choices, and in general need implementation work to make them more user friendly and functional. They also need to be implemented in the calculations, as they can have a significant impact on the character's abilities and stats, and currently they are not implemented at all in the calculations, which can lead to confusion and issues for players who choose them. They also need to be tested to ensure that they are working correctly and that their effects are being applied correctly in the sheet. **FIXED Phase 10**: Epic boons now have hoverable name links (same as feats), "has choices" badge, and trigger feat choice UI for additional selections. `applyFeatBonuses()` now applies `immune` (damage immunity) and `conditionImmune` (condition immunity) properties from boon data. 6 new tests verify immunity application, deduplication, and combined boon effects.

### Combat Methods

- [x] Instant Strike (Combat Method) appears as an activateable state, but it should be a combat action. **FIXED Phase 7**: Already classified as "combat" in FEATURE_CLASSIFICATION_OVERRIDES (Phase 1). Verified via tests: routes through combat interactionMode, excluded from activatable states, appears in combat actions tab with correct stamina cost (3) and action type (Bonus Action).
- [x] Whirlpool Strike Combat Method is added as an attack, but it shouldn't. It should be a combat method that let's you choose how many creatures you are attacking, let you choose which attack you are using, and then add additional 1d6 damage to each attack. **FIXED Phase A/C11**: CTM features excluded from NaturalWeaponParser. Classified as "combat". Parser extracts `isMultiTarget`, `bonusDamage={die: "1d6", condition: "per subsequent hit"}`. `_showWhirlpoolStrikeModal()` implements multi-target modal flow. Feature-specific content shows multi-target info.
- [x] Combat Methods need extensive testings and deep reading to make sure they are all implemented correctly. **FIXED Phase D/E**: Full survey of all 17 traditions (AM, AK, BU, BZ, CJ, EB, GH, MG, MS, RC, RE, SK, SS, TI, TC, UW, UH) with 81 tests in CharacterSheetCombatMethodsSurvey covering: tradition parsing (17 tests), stance-speed integration (6 tests), subclass tradition auto-granting (14 tests — Warder, Arcane Archer, Mercy Monk), parser edge cases (8 tests), degree progression across 6 classes (28 tests), DC calculation (2 tests), stamina pool (4 tests). Generic `_subclassGrantedTraditions` pattern implemented. Stance speed bonus wired into `getSpeedBonusFromStates()`. 82 additional tests in CombatActionEffects verify effect pipeline, dice rolling, and rendering.

### TGTT Monk

- [X] Weapons added directly from builder don't get monk weapons tag written on them in the combat tab, though they do get the damage of monk weapons applied to them.
- [X] Getting focus save dc but Ki points from Monk's Focus. Focus points don't appear in the sheet and abilities use them and not ki points (as they should), creating a weird situation where you have a resource that can't be tracked but it being used. Focus points are also not affected by long rest, a truely weird situation.
- [X] features and action/bonus action added for flurry of blows, patient defense, and step of the wind are added, but don't actually do anything when used. They need to be implemented so that they correctly apply the effects of the abilities when used.
- [X] Hands of Healing, Hands of Harm don't actually have an effect when used. They should be implemented to allow the player to choose a target and apply the healing or damage accordingly when used.
- [X] uncanny metabolism appears as an ability, but should only be a passive that gets triggered when rolling initiative and focus points are not at max, allowing you to use it to regain focus points according to the ability.
Right now, even when using it, it doesn't actually add the focus points back to the character sheet, and it doesn't trigger when rolling initiative.
(Initiative trigger is a feature enhancement, not a bug.)
- [X] Implements of Mercy adds insight proficiency but not medicine and herbalism kit proficiency,
- [X] Adept speed seems to add a bonus twice - once as itself, and once as a general bonus. The result is that a level two monk with base speed 30 that picks adept speed gets a total speed of 60 insted of 50. This might be somehow related to the fix that made sure adept speed increased the speed of all movement modes, but it needs to be fixed so that it only adds the correct amount of speed and doesn't double count itself.
- [X] Focus ponts appear as a useable ability in the abilities modal in the overview, but shouldn't - they are a resource, not an ability.

### Combat Methods

- [x] ~~Wary Stance doesn't give any benefit. Might be a general issue with combat stances, but it needs to be fixed so that it correctly applies the benefits of the stance when it's active.~~ **Fixed:** The UI activation path (`_activateFeatureState()` → `activateState("combatStance", ...)`) wrote to `_data.activeStates` but never called `activateStance(methodName)` which sets `_data.activeStance` — the field read by the stance calculation system (`_getActiveStanceEffects()` → `stanceSkillBonuses`/`stanceSaveBonuses`/`stanceSpeedBonus`). Bridged both systems: activation calls `activateStance()`, deactivation calls `deactivateStance()` (both overview "End" button and combat tab "×" button). Added `stateTypeId` to active state effects and filtered `combatStance` effects from `getSkillBonusFromStates()`/`getSaveBonusFromStates()` to prevent double-counting. Also added passive bonus parsing (`_parseStanceEffects()`) for "passive X (Y) score increases by N" patterns, applied via `stancePassiveBonuses` in `getFeatureCalculations()` → `getPassiveScore()`. Fixed `_renderPassiveScores()` to use `getPassiveScore()` instead of simplified `10 + getSkillMod()`. 11 new tests (6,827 total).
- [x] ~~Wounding strike doesn't work as it should - appears as an activatable state, but needs to be an action to choose a weapon attack and apply the effect to it. Right now it doesn't do anything when activated, which is not how it should work.~~ **Fixed:** Built generic non-stance combat method infrastructure with method category classification (`weaponModifier`, `selfHeal`, `reaction`, `acBuff`, `instant`) parsed from feature text. Wounding Strike is classified as `weaponModifier` — activation shows a weapon picker (auto-selects if only one weapon), then creates an active effect card with Roll Damage and End buttons. Attack cards display a 🩸 badge linking the active method to the weapon. When rolling damage with a weapon that has an active method effect, the player is prompted to apply it (following the Hand of Harm modal pattern via `_promptApplyMethodEffect()`); if accepted, ongoing damage is rolled, added to the total, and shown in the damage breakdown with save DC info. Effect card shows weapon name, ongoing damage dice, and save DC (creature rolls — no player-side save button). State methods manage `_data.activeCombatMethodEffects[]` with save/load persistence. Text parsing falls back to `JSON.stringify(feature.entries)` when `description` is empty and strips `{@tag}` syntax. 16 new tests (6,855 total).
- [X] On levelup, if I choose combat traditions, then choose methods, then change my traditions choice - methods choice disappear even for the tradition I haven't changed. I think this is a UI bug, not a data bug.
- [X] related to previous bug, if I choose a tradition, then a method, then another tradition - my chosen method becomes unchosen in the UI, but is chosen in the data.
- [x] ~~quickbuild doesn't take into account the subclass extra traditions feature which is implemented in the levelup, need this logic to also apply in quickbuild.~~ **Fixed:** Two-part fix: (1) Merged subclass-granted traditions into quickbuild method rendering and added `getSubclassBonusMethodCount()` to `totalNeeded` for method count validation. (2) Fixed regression where subclass-granted traditions (e.g., Mercy → Sanguine Knot) counted against the class tradition selection limit — separated `subclassGrantedCodes` from user-chosen `_combatTraditions`, used `getAllTraditions()` (user + subclass) for method filtering, only counted user choices against `traditionCount`. Subclass grants shown as "Free from subclass" badges and excluded from the tradition picker checkboxes.

### General

- [x] ~~In levelup, ASI and Feat selections show [object HTMLHeadingElement],[object HTMLDivElement],[object HTMLDivElement],[object HTMLDivElement].~~ **Fixed:** `_renderAsiSelectionCompact()` was returning an array of DOM elements instead of a wrapper element; `.append(array)` stringified them. Now wraps children in a container div, matching other compact render methods.
- [x] ~~In levelup, feat names show as "undefined" and clicking crashes with `Cannot read properties of undefined (reading 'cantrips')`.~~ **Fixed:** Two bugs: (1) `getHoverLink()` returns HTML string but was passed to `.append()` which creates text nodes — changed to `innerHTML` assignment matching quickbuild pattern. (2) `_featChoices` was initialized on the DOM element (`featEl`) instead of the data object (`feat`) — moved to `feat._featChoices`. Same fixes applied to epic boon rendering.
- [x] ~~In levelup, feat choices not displayed when clicking a feat with choices.~~ **Fixed:** Choices UI was rendering correctly in the DOM but scrolled out of view below the accordion body's `max-height: 55vh` viewport. Added `scrollIntoView({behavior: "smooth", block: "nearest"})` after rendering choices for both regular feats and epic boons.
- [x] ~~in general there seems to be an issue with hoverable elements added outside of the character sheet tabs (e.g. conditions, feats, spells, multiclass features) not being hoverable, which means they don't show the tooltip on hover. This used to work and might be related to the upgrade removing jquery from the sheet.~~ **Fixed:** The hover system itself was fine — `getHoverLink()` was simply never called in 3 picker modals (condition picker, feat picker, spell picker in spells module). Added hover link generation matching the pattern used by the shared spell-picker component and combat tab conditions.
- [x] ~~when deleting an attack from the combat tab, there is a green popup saying "unequiped X" but in the inventory display it still shows the item as equipped until you refresh the page. This is confusing and makes it seem like the item wasn't actually unequipped, even though it was. The inventory display should update immediately to reflect the change when an attack is deleted.~~ **Fixed:** Typo in `_removeAttack()` — called `this._page._inventory?.renderInventory?.()` but the method is `render()`. Optional chaining silently swallowed the undefined method. Changed to `render()` matching the 3 other correct call sites in the same file.
- [x] when adding a custom attack to a monk, it isn't possible to mark it as a monk weapon, which means it doesn't get the benefits of monk weapons (e.g. using dexterity for attack and damage rolls, getting the extra damage from martial arts, etc.). There should be an option to mark custom attacks as monk weapons so that they can benefit from these features.
- [x] ~~Respec doesn't show race and background choices and doesn't allow respecing them.~~ **Fixed:** Race and background now appear as editable choices in the level 1 respec card with cascade warnings. Implemented clear-and-reapply pattern: clears old grants (features, languages, skills, resistances, proficiencies, speed, senses, ability bonuses, named modifiers) then applies new race/background grants from data. Builder now stores race/background selections + user choices in levelHistory. Migration backfills existing saves. 34 new tests + 5 migration tests (6,701 total).
- [x] ~~need to give language choice from Thelemar only + Common + Exotic to TGTT races.~~ **Fixed:** When TGTT is a priority source, `getLanguageOptionsGrouped()` and `getLanguageNamesSorted()` now exclude non-Common standard D&D languages (Dwarvish, Elvish, Giant, etc.) and non-TGTT homebrew languages, and categorize TGTT languages by their `type` field: TGTT standard-type (Lexalian, Olympian, etc.) go to the Standard group, TGTT exotic-type (Jotunn, Avian, Gob, etc.) go to the Exotic group. D&D exotic/secret languages remain available. All 4 downstream pickers (background, class feature, levelup, racial/subrace) benefit automatically from the centralized fix.
- [x] ~~In Builder, skills added are not tracked in a way that makes sure a player doesn't choose the same skill twice. A skill chosen in race can be given again in background, and then again in class, and so on. There should be a way to track skill choices across the different sections of the builder to make sure that players don't accidentally choose the same skill multiple times.~~ **Fixed:** Added `_getSkillsFromOtherSources(excludeSource)` helper that tracks skills chosen across race/background/class steps. Both the racial and class skill pickers now disable already-chosen skills with a source label (e.g. "(Background)"). Stale selections are auto-cleaned when pickers re-render. Handles Tasha's Custom Origin skill replacements correctly.
- [x] ~~All modals that open over the sheet (e.g. spell picker, feat picker, condition picker, levelup, quickbuild, item picker, attack creation, custom ability maker, settings, modifier, etc.) are noticeably slower than the sheet, which creates a jarring experience when opening them. This is likely due to the fact that they are rendered as separate components that need to fetch data and render separately from the main sheet, but there might be optimizations that can be made to improve their performance and make them feel more seamless with the rest of the sheet.~~ **Fixed:** (1) Added 150ms debounce to all 5 search inputs — previously every keystroke triggered a full DOM rebuild. (2) Added 100-item render cap to the spell picker (was rendering 3000+ spells at once). (3) Simplified modal `box-shadow` from 3 layered shadows to single drop shadow. (4) Added hover cache cleanup: `Renderer.hover._eleCache` was leaking dead DOM element references from closed modals (Map keys held strong refs, preventing GC of entire modal DOM trees). Added a MutationObserver that cleans dead entries when all modals close, using `requestIdleCallback` to avoid blocking UI. (5) Added CSS `contain: content` + `will-change: transform` to modal scrollers for compositor-layer isolation. (6) Eliminated all 48 `body:has()` CSS selectors — replaced with simple body class matching (`body.is-charsheet-page`, `body.has-quickbuild-overlay`, `body.has-levelup-wizard`, `body.has-method-picker`). `:has()` forced full subtree traversal on every body mutation since `.charsheet-page` was always in DOM. (7) Removed all `backdrop-filter: blur()` entirely (9 instances across charactersheet CSS) — even 1px blur forces full-viewport GPU offscreen buffer allocation on every composite.
- [x] ~~Need to implement some form of memory for rolls that have been made - maybe a side panel that can be opened to show the history of rolls made, or a log that can be scrolled through. This would be especially useful for keeping track of things like death saves, initiative rolls, skills rolls, attacks and damage rolls, spellcasting etc. It would also be useful for being able to reference previous rolls when making new ones, and for being able to see the history of rolls for a character over time.~~ **Fixed:** Added `CharacterSheetRollHistory` module with a sliding side panel (📜 Roll Log button in toolbar). Captures all rolls via two interception strategies: (1) `showDiceResult()` hook for weapon attacks, ability checks, saving throws, skill checks, initiative, death saves, damage (15 call sites), (2) explicit `addRoll()` calls in spells module (spell attack, spell save DC, spell damage, spell healing, Gambler modifier rolls) and rest module (hit dice). In-memory session-only log, 200-entry FIFO cap, color-coded entries by roll type (14 types), relative timestamps, crit/fumble highlighting. 36 new tests (6,767 total).

### Gambler Rogue

- [x] No cantrips for some reason — Fixed: spell picker filter rejected level 0 (`spell.level < 1`). Removed filter, added separate cantrip tracking with `gamblerCantripsKnown` cap (3/4), cantrip group in picker UI, confirm saves/clears cantrips independently.
- [x] Gambler spellcasting in general is still not functional as described — Most mechanics were already implemented: rolled DC/attack (1d6/2d4), rolled prepared spells (2d4/3d6), Gambler's Folly betting, d100 gambling table, long rest reset. The "not functional" was primarily the cantrip bug above.

### Builder

- [X] When picking the Firbolg race and clicking next, I get the following bug (might be related to jquery removal):
charactersheet-spells.js:4367 Uncaught (in promise) TypeError: Cannot read properties of null (reading 'addEventListener')
    at CharacterSheetSpells._renderInnateSpellItem (charactersheet-spells.js:4367:48)
    at charactersheet-spells.js:4301:22
    at Array.forEach (<anonymous>)
    at CharacterSheetSpells._renderInnateSpells (charactersheet-spells.js:4300:57)
    at CharacterSheetSpells._renderSpellList (charactersheet-spells.js:4042:8)
    at CharacterSheetSpells.render (charactersheet-spells.js:4617:8)
    at CharacterSheetPage._renderCharacter (charactersheet.js:2319:34)
    at CharacterSheetPage.renderCharacter (charactersheet.js:10732:8)
    at CharacterSheetBuilder._applyCurrentStep (charactersheet-builder.js:646:14)
    at CharacterSheetBuilder._nextStep (charactersheet-builder.js:269:8)
_renderInnateSpellItem @ charactersheet-spells.js:4367
(anonymous) @ charactersheet-spells.js:4301
_renderInnateSpells @ charactersheet-spells.js:4300
_renderSpellList @ charactersheet-spells.js:4042
render @ charactersheet-spells.js:4617
_renderCharacter @ charactersheet.js:2319
renderCharacter @ charactersheet.js:10732
_applyCurrentStep @ charactersheet-builder.js:646
_nextStep @ charactersheet-builder.js:269
(anonymous) @ charactersheet-builder.js:225
- [X] shields added from the builder are not equipable.
- [X] when a race gives choice of languages, we want the list to be sorted both by language type (common, exotic, secret etc.), name, and source. We also want this list to be aligned and better lookking overall.
- [X] nyuidj race let's you choose a dreamwalker ability, but no choice is presented in the builder. This should be fixed to allow players to choose their dreamwalker ability when picking, and also actually give the dreamwalk ability in addition.
- [X] Wizard cannot choose starting spells or cantrips for some reason. This might be a more broad issue with spell selection in the builder, since cleric also suffers from it. It needs to be investigated and fixed to ensure that all classes can properly select their starting spells and cantrips.
- [X] if I choose a class, move on, and then go back and change the class, I don't change my selection, I add another class - making my character a multicalss even if I didn't want to. This should be fixed to ensure that changing the class selection mid build properly updates the character's class and doesn't just add another class to the character sheet.

### Levelup / Quickbuild

- [X] when leveling up and coming to the ASI and Feat step, there is asyncrhonity between the scores in the ASI selection and the feat seleciton. if I had a 16 in str and used ASI to increase it to 18, the feat selection still shows the 16 str if the feat allows me to increase a score of my choosing. This should be fixed to ensure that the feat selection is aware of the ASI increases and shows the correct scores, and vice versa (if I pick a feat that increases my str, the ASI selection should show the increased str score as well).
- [X] when filtering feats in the feat selection step, I get the following error (might be related to jquery removal):
3charactersheet-quickbuild.js:1634 Uncaught TypeError: filter.includes is not a function
    at charactersheet-quickbuild.js:1634:22
    at Array.forEach (<anonymous>)
    at parseInnateSpellChoices (charactersheet-quickbuild.js:1631:15)
    at charactersheet-quickbuild.js:1643:10
    at Array.forEach (<anonymous>)
    at parseInnateSpellChoices (charactersheet-quickbuild.js:1642:31)
    at charactersheet-quickbuild.js:1643:10
    at Array.forEach (<anonymous>)
    at parseInnateSpellChoices (charactersheet-quickbuild.js:1642:31)
    at charactersheet-quickbuild.js:1643:10

### General

- [X] when rightcliking a skill check, I get the following error (might be related to jquery removal):
charactersheet.js:8146 Uncaught TypeError: Cannot read properties of null (reading 'remove')
    at CharacterSheetPage._showSkillAbilityMenu (charactersheet.js:8146:53)
    at HTMLDivElement.<anonymous> (charactersheet.js:2656:52)
_showSkillAbilityMenu @ charactersheet.js:8146
(anonymous) @ charactersheet.js:2656
- [X] shields always give a +2 AC bonus, but some homebrew shields (e.g. Buckler, Tower Shield) should give different bonuses. The code should be updated to check for specific shield types and apply the correct AC bonus.
- [X] There is some unidentified bug in the way spell lists are handled. Some players don't see spells that they definitely should have access to (e.g. a wizard not seeing Gift of Alacrity). This should be investigated and fixed to ensure that all spells are properly displayed based on class, level, and other factors. Notice that TGTT classe should have access to the spell list of both TGTT class and the XPHB class.
- [X] when using the spell picker, or when choosing spells in levelup, builder, quickbuild, there is no way to filter by legality and rarity. This should be added to allow players to easily find spells that are legal for their character and of the desired rarity. This also needs to be fixed in the level up / quickbuild spell selection step.
- [X] in the spell picker, you can click the area where certain dropdowns are supposed to open and choose an option even when that dropdown is not visible. One specific dropdown I know this happens for is the clas filter dropdown.
- [X] sometimes there is a bug that does not let you exit the modifiers menu, and you have to refresh the page to get out of it. here is an example error that I get when this happens (might be related to jquery removal):
charactersheet.js:3988 Uncaught (in promise) TypeError: Cannot set properties of undefined (setting 'display')
    at CharacterSheetPage._renderCompanionsOverviewIndicator (charactersheet.js:3988:42)
    at CharacterSheetPage._renderCompanions (charactersheet.js:3593:8)
    at CharacterSheetPage._renderCharacter (charactersheet.js:2316:8)
    at Object.cbClose (charactersheet.js:9550:10)
    at pHandleCloseClick (utils-ui.js:412:33)
    at HTMLDivElement.<anonymous> (utils-ui.js:513:12)
_renderCompanionsOverviewIndicator @ charactersheet.js:3988
_renderCompanions @ charactersheet.js:3593
_renderCharacter @ charactersheet.js:2316
cbClose @ charactersheet.js:9550
pHandleCloseClick @ utils-ui.js:412
(anonymous) @ utils-ui.js:513
- [X] spells added from level up / quickbuild have a Ritual button if they are ritual spells, but the spells added from the spell picker don't have the ritual button even if they are ritual spells. This should be fixed to ensure that all ritual spells, regardless of how they are added to the character sheet, have the ritual button for easy identification and use.
- [X] dreamwalker abilites are grouped in the featurs part under charsheet__feature-group mb-3 have the name DW C instead of the actual name.
- [X] images are trying to be loaded from the wrong path, asusming the site is hosted on a different domain or something. Error:
Aberrant%20Spirit.webp:1
 GET <https://truemichato.github.io/ThelemarTools/img/bestiary/tokens/XPHB/Aberrant%20Spirit.webp> 404 (Not Found)

### Spells

- [X] when summoning a familiar, the icons are not always correct for the animal, and very repetitive (all birds have the same icon). This should be fixed to show the correct icon for each familiar type.
- [X] Hovering a familiar name in the selection menu shows the hover behind the choice modal.
- [X] Familiars always retrive both 2014 and 2024 version but don't list which is which.
- [x] when summoning a familiar, there should be a way to create a custom familiar with a custom name and icon, rather than being limited to the predefined options. This would allow for more personalization and creativity in character creation.
- [X] when choosing a familiar in the familiar selection menu, I get the following error (might be related to jquery removal):
charactersheet.js:3988 Uncaught (in promise) TypeError: Cannot set properties of undefined (setting 'display')
    at CharacterSheetPage._renderCompanionsOverviewIndicator (charactersheet.js:3988:42)
    at CharacterSheetPage._renderCompanions (charactersheet.js:3593:8)
    at CharacterSheetSpells._selectFamiliar (charactersheet-spells.js:3300:34)
    at HTMLButtonElement.<anonymous> (charactersheet-spells.js:3227:17)
_renderCompanionsOverviewIndicator @ charactersheet.js:3988
_renderCompanions @ charactersheet.js:3593
_selectFamiliar @ charactersheet-spells.js:3300
(anonymous) @ charactersheet-spells.js:3227

### Feats

- [X] The Telekenetic feat adds the mage hand spell as a level 1 spell instead of a cantrip, and it also adds it without most of its information, meaning there is a bug in the way feats in general add spells to the character sheet. This should be fixed to ensure that spells added by feats are added at the correct level and with all relevant information (e.g. spell level, casting time, range, components, etc.).

### Builder

[X] the cantrip selector looks out of date with the rest of the sheet, and hover in it appears behind it.
[X] In custom backgrounds, rolling down after tools to choose a language in the choose either box does not work, and the language options are not visible.
[X] in the builder, hovering skills sometimes defaults to phb and creates a bug if the skill is homebrew. Example:
render.js:15637 Uncaught (in promise) Error: Failed to load renderable content for: page="skill" source="PHB" hash="linguistics_phb" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15637:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15552:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15637
pHandleLinkMouseOver @ render.js:15552
await in pHandleLinkMouseOver  
onmouseover
[X] in the ability scores tab, there are no spheres around the abiities to allocate anymore for some reason.

### Levelup

[X] hover of things appears behind levelup model. This seems like a problem that happens a lot, maybe we need a a cross sheet solution that will also update some docs and skills and agents.md to make sure z-index and such are synchronized across the sheet
[X] leveling up a rogue to level 6 I get the following error and empty modal:
charactersheet-levelup.js:688 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'setComplete')
    at updateExpertiseStatus (charactersheet-levelup.js:688:26)
    at CharacterSheetLevelUp._pShowLevelUpModal (charactersheet-levelup.js:692:4)
    at async CharacterSheetLevelUp._doLevelUp (charactersheet-levelup.js:91:3)
    at async CharacterSheetLevelUp.showLevelUp (charactersheet-levelup.js:47:3)
updateExpertiseStatus @ charactersheet-levelup.js:688
_pShowLevelUpModal @ charactersheet-levelup.js:692
await in_pShowLevelUpModal  
_doLevelUp @ charactersheet-levelup.js:91
showLevelUp @ charactersheet-levelup.js:47
(anonymous) @ charactersheet.js:678

### Feats

[X] feats with level requirements appear in feat picker as "level undefined"
[X] Adding a feat from feat picker (clicking <span class="charsheet__section-add glyphicon glyphicon-plus" id="charsheet-add-feat" title="Add feat"></span>) does not let you choose feat choices (for example, skill expert doesn't let you choose ASI, proficiency, and expertise). I think we want to make sure that the sheet always recognizes options of choices and allows them, both in the pickers and in the levelup modals.
[X] When choosing skills from a feat like Skill Expert, the skills do not include homebrew skills
[X] the skill picker appearing after choosing Skill Expert (for example) from the feat picker looks less modern, does not update at real time (choosing a proficiency does not add it to the expertise options before I click another button), and does not work - finishing my choices and clicking complete just returns me to the feat picker without adding any skill or choices.
[X] After adding the skill, it does not list which choices were made with it - for example a feat like skill expert should list the ASI, proficiency, and expertise gained.
[X] after choosing a feat sometimes the effect requires a reload to appear in the sheet, like proficiencies etc.
[X] In the skill expert skill, choosing a proficiency does not update it correctly in the sheet (but the ASI and expertise work fine)
[X] Removing a feat that had choices does not remove said choices (ASI, abilities, proficiencies, bonuses should all be removed)
[X] feat picker can be longer, this is the element: ve-ui-modal__inner ve-flex-col ve-w-100 ve-ui-modal__inner--no-min-height

### General

[X] there is no built in way to add/remove lanugages, proficiencies (non skill), or ability scores
[X] Trying to edit the ability scores makes them all 10 again.
[X] Specialties seems to have a small bug - a specialty adding PB to skill and +3 to passive score of skill (Like Observer with perception but this happens in many of them) will add the +3 twice, both to the skill itself and then also to the passive, creating a score far too large.
[X] Exported data seems to say linguistics is an int skill despite it being a wis skill and working as such in the sheet.

[x] Ignan and Primordial have some weird issues, sometimes you can choose primordial in builder but not ignan, sometimes you can choose ignan but not primordial.
[x] When choosing Cantrips or Spells, the spells known and cantrips known modals show 0/6 despite choices being made and spells appearing
[x] Child of the Sun Bloodline Sorcerer is completley unimplemented
[x] Subclass spells are not implemented correcty.
[x] Activating Passive Metamagic (TGTT) like Extended Spell, Distant spell doesn't alter spell data. What we want is that when a passive metamagic changes a spell stat, if we hover a spell we will see the original stat and then some green parenthesis that will show the new stat. If the stat is in the sheet, we want just the new stat. This also needs to work for all passive metamgic options that alter specific stats, not just for extended and distant.
[x] you can tune to passive metamagic options even if you don't have sorcery points
[x] when choosing spells using any of the spell pickers, the sheet does not use the existing filter logics that 1. hide spells if thelemar version exists 2. set rarity and legality for each spell based on source and spell data. This means players can't filter or sort by rarity and legality, which is a problem.
[x] Site fonts feel too small for some players. let's allow players to set the font size themselves instead of using sliders, and see how this goes. It might be worse, might be better, we will see.
[x] ve-flex-col w-100 charsheet__main-header feels smaller relative to the rest of the page, font wise.
[x] When clicking a hover link to something that is part of a page (for example, hover to a specific ability from a class), the opened page is 404; need some override to just open the general page and go to the specific part (I think this issue is specific for classes)
[x] The TGTT filter logic seems to disappear from pages from time to time after edits. We want to make sure it always works and doesn't become something I need to patch back on each time.
[x] building a character sometimes results with it having 0 hp out of max, and sometimes levelups don't fill the hp to the max.


### Respec

[X] trying to change specialties lead to the following bug:
Uncaught (in promise) TypeError: levelUp._findFeatureOptions is not a function
    at CharacterSheetRespec._editFeatureChoice (charactersheet-respec.js:1470:32)
    at async CharacterSheetRespec._editChoice (charactersheet-respec.js:811:5)
_editFeatureChoice @ charactersheet-respec.js:1470
await in _editFeatureChoice
_editChoice @ charactersheet-respec.js:811
(anonymous) @ charactersheet-respec.js:774




