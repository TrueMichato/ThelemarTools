# Open bugs

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

### Respec

[X] trying to change specialties lead to the following bug:
Uncaught (in promise) TypeError: levelUp._findFeatureOptions is not a function
    at CharacterSheetRespec._editFeatureChoice (charactersheet-respec.js:1470:32)
    at async CharacterSheetRespec._editChoice (charactersheet-respec.js:811:5)
_editFeatureChoice @ charactersheet-respec.js:1470
await in _editFeatureChoice
_editChoice @ charactersheet-respec.js:811
(anonymous) @ charactersheet-respec.js:774

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
