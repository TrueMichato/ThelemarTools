# NPC Export

Convert a live character sheet into a 5etools bestiary-shaped homebrew monster for previews, wild shape / companion consumption, downloads, clipboard paste, and Save to Homebrew.

## Entry points

| Surface | How |
|---------|-----|
| Toolbar | `#charsheet-btn-export-npc` |
| Play mode actions | **NPC Export** |
| Code | `CharacterSheetExport._showNpcExportDialog()` → `CharacterSheetNpcExporter.convertStateToMonster(state, options)` |

## Architecture

```
CharacterSheetState (read-only)
        │
        ▼
CharacterSheetNpcExporter.convertStateToMonster(state, options)   // pure
        │  monster JSON
        ▼
CharacterSheetExport dialog
  - source meta + export options (persisted)
  - live preview (Renderer.monster.getCompactRenderedString)
  - validation panel
  - Copy JSON | Download JSON | Save to Homebrew
```

- **Converter** (`js/charactersheet/charactersheet-npc-exporter.js`): all static, no DOM. Prefer state getters (`getSpellSaveDc`, `getInnateSpells`, `getPactSlots`, `getAcBreakdown`, `getFeatureCalculations`, …) over re-deriving rules.
- **Dialog** (`js/charactersheet/charactersheet-export.js`): UX shell only. Options sanitized through `getSanitizedExportOptions`.

Brew package shape:

```js
{
  _meta: { sources: [/* source meta */] },
  monster: [ /* one monster */ ],
}
```

## Export options

Persisted under `charsheet-npc-export-options` (source meta under `charsheet-npc-export-source-config`).

| Option | Values | Default | Notes |
|--------|--------|---------|-------|
| `defenseMode` | `persistent` \| `active` | `persistent` | Active includes current toggles (e.g. Rage resists) |
| `includeUnarmed` | `auto` \| `always` \| `never` | `auto` | Auto keeps monk/enhanced unarmed; drops plain unarmed when other weapons exist |
| `includeFeatures` | `auto` \| `allImportant` \| `manual` | `auto` | Manual uses `selectedFeatureIds` from the feature picker |
| `selectedFeatureIds` | `string[]` | `[]` | Cap 64 |
| `includeCustomModifiers` | bool | `true` | Named modifiers → trait note |
| `includeCustomAbilities` | bool | `true` | Custom abilities routed by action economy |
| `includeCombatMethods` | bool | `true` | TGTT methods grouped by stamina |
| `crMode` | `auto` \| `manual` | `auto` | |
| `crManual` | CR string | `"1"` | e.g. `"1/2"`, `"12"` |
| `legendaryEnabled` | bool | `false` | Off by default |
| `legendaryActions` | 0–5 | `3` | |
| `legendaryResistances` | 0–5 | `0` | Adds `Legendary Resistance (N/Day)` trait when > 0 |
| `nameSuffix` | string | `" (NPC)"` | Appended to display name |
| `includeCrBreakdown` | bool | `false` | Adds defensive/offensive CR note under Level Signal |

## Conversion pipeline (high level)

1. Identity: name + suffix, size, type (from race), alignment, languages, senses, passive Perception.
2. Defenses: AC + `from` labels via `getAcBreakdown` / armor / Unarmored Defense; HP average = max HP; formula from primary class hit die + CON.
3. Ability scores, saves, skills from state totals.
4. Attacks: merged sheet attacks + equipped weapons → bestiary action lines.
   - Range punctuation normalized (no `ft..`).
   - Damage strips `+0` / `-0`.
   - Thrown melee → `{@atk mw,rw}` with reach or range text.
   - Unarmed policy applied.
   - Extra Attack / multi-attack count → **Multiattack** action; Extra Attack trait suppressed when synthesized.
5. Spellcasting blocks:
   - Class slots (or **Pact Magic** when pact slots exist and normal slots do not).
   - Header uses character name + `getSpellSaveDc` / `getSpellAttackBonus` (ability-specific when available).
   - Separate **Innate Spellcasting** block from `getInnateSpells()` (`will` / `daily` keys).
6. **Class Resources** trait from `getGenericPoolResources()` + `getSyntheticCombatResources()` + stamina (Ki, Channel Divinity, Rage, Sorcery Points, Second Wind, Action Surge, …).
7. Features: classified trait / action / bonus / reaction; 2nd-person rewritten to NPC name; background fluff and already-applied modifier features omitted; optional manual picker. Specialties export when important/activatable; passive-only specialties may collapse into Custom Modifiers.
8. Magic items: Special Equipment trait + activation routing; defenses by mode. Orbiting Ioun stones tagged `orbiting` (equipped+attuned); stowed stones omitted.
9. TGTT combat methods → Combat Methods trait (stamina costs, DC). Divine Favor innate spells → Innate Spellcasting; narrative DF boons → features.
10. Armor upgrade / gemstone notes via state getters (no Upgrades UI module required).
11. CR: staged defensive (HP/AC tables) + offensive (DPR + attack bonus) blend with mild level anchor; `pbNote` stays **character** proficiency.
12. Optional legendary resistance trait + derived legendary actions (weapon attack, move, signature ability/cantrip).

## Validation

`getValidationIssues(monster)` is sync and structural (name/source/size/type/AC/HP/abilities/spellcasting shape/legendary fields). Hard errors block Save to Homebrew; warnings allow Download / Copy. Full browser-side monster schema validation is still out of scope (graceful hand validator only).

## Consumers

- Preview: `Renderer.monster.getCompactRenderedString`
- Homebrew manager paste / download / save
- `activateWildShapeFromBestiary` / `addCompanionFromBestiary` (must remain consumable)

## Testing

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetNpcExporter --no-coverage --forceExit
```

- Unit/regression: `CharacterSheetNpcExporter.test.js` (33)
- Class + systems matrix: `CharacterSheetNpcExporter.matrix.test.js` (23) — all 13 PHB/TCE/XPHB classes L5, multiclass, combat methods, specialties, divine favor, ioun/items, channel divinity, gemstones, custom abilities, resources, combined legendary boss

### Manual checklist

1. Martial PC → Multiattack, clean weapon lines, no `ft..`, armor name in AC `from`
2. Wizard with named DC mod + innate → DC matches sheet; innate block present
3. Warlock → Pact Magic slots + cantrips
4. Active defenses + Rage on → resists only in active mode
5. Legendary toggle → legendary section in compact preview
6. Copy JSON / Download / Save to Homebrew (overwrite & copy)
7. Manual feature picker shrinks preview when fluff deselected
8. Monk keeps Unarmed Strike; armed fighter hides default unarmed (auto)
9. Divine Favor god + favour tier → innate spells on NPC
10. Orbiting Ioun stones listed under Special Equipment with `orbiting`
11. TGTT combat methods + stamina → Combat Methods trait
12. Class resources (Ki / CD / Second Wind) under Class Resources

## Known limitations (post-upgrade)

- CR is advisory (DMG-inspired tables + level anchor), not a full monster redesign.
- No automatic lair actions / regional effects / mythic actions.
- No Foundry/Roll20-native formats — 5etools homebrew monster JSON only.
- Temporary combat buffs only appear when `defenseMode: "active"` (or as already-applied sheet state).
- Feature descriptions may truncate; picker surfaces truncation warnings.
- Validation is structural, not full `schema/site/monster.json`.
- Spell multiclass presentation prefers pact-only when no normal slots; edge multiclass mixes may need manual CR/feature cleanup.

## Key files

| File | Role |
|------|------|
| `js/charactersheet/charactersheet-npc-exporter.js` | Pure converter |
| `js/charactersheet/charactersheet-export.js` | Dialog, persistence, brew I/O |
| `test/jest/charactersheet/CharacterSheetNpcExporter.test.js` | Unit / regression |
| `.agents/skills/charactersheet-development/references/subsystem-details.md` | Agent quick ref |
