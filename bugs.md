## Open bugs:

### Builder:
- [] When picking the Firbolg race and clicking next, I get the following bug (might be related to jquery removal):
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
_renderInnateSpellItem	@	charactersheet-spells.js:4367
(anonymous)	@	charactersheet-spells.js:4301
_renderInnateSpells	@	charactersheet-spells.js:4300
_renderSpellList	@	charactersheet-spells.js:4042
render	@	charactersheet-spells.js:4617
_renderCharacter	@	charactersheet.js:2319
renderCharacter	@	charactersheet.js:10732
_applyCurrentStep	@	charactersheet-builder.js:646
_nextStep	@	charactersheet-builder.js:269
(anonymous)	@	charactersheet-builder.js:225
- [] shields added from the builder are not equipable.

### General:
- [] when rightcliking a skill check, I get the following error (might be related to jquery removal):
charactersheet.js:8146 Uncaught TypeError: Cannot read properties of null (reading 'remove')
    at CharacterSheetPage._showSkillAbilityMenu (charactersheet.js:8146:53)
    at HTMLDivElement.<anonymous> (charactersheet.js:2656:52)
_showSkillAbilityMenu	@	charactersheet.js:8146
(anonymous)	@	charactersheet.js:2656
- [] shields always give a +2 AC bonus, but some homebrew shields (e.g. Buckler, Tower Shield) should give different bonuses. The code should be updated to check for specific shield types and apply the correct AC bonus.




## Unverified bugs:

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.