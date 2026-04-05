## Open bugs:

### Builder:
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
- [X] shields added from the builder are not equipable.
- [X] when a race gives choice of languages, we want the list to be sorted both by language type (common, exotic, secret etc.), name, and source. We also want this list to be aligned and better lookking overall.
- [X] nyuidj race let's you choose a dreamwalker ability, but no choice is presented in the builder. This should be fixed to allow players to choose their dreamwalker ability when picking, and also actually give the dreamwalk ability in addition.
- [X] Wizard cannot choose starting spells or cantrips for some reason. This might be a more broad issue with spell selection in the builder, since cleric also suffers from it. It needs to be investigated and fixed to ensure that all classes can properly select their starting spells and cantrips.
- [X] if I choose a class, move on, and then go back and change the class, I don't change my selection, I add another class - making my character a multicalss even if I didn't want to. This should be fixed to ensure that changing the class selection mid build properly updates the character's class and doesn't just add another class to the character sheet.

### Levelup / Quickbuild:
- [] when levelin up and coming to the ASI and Feat step, there is asyncrhonity between the scores in the ASI selection and the feat seleciton. if I had a 16 in str and used ASI to increase it to 18, the feat selection still shows the 16 str if the feat allows me to increase a score of my choosing. This should be fixed to ensure that the feat selection is aware of the ASI increases and shows the correct scores, and vice versa (if I pick a feat that increases my str, the ASI selection should show the increased str score as well).
- [] when filtering feats in the feat selection step, I get the following error (might be related to jquery removal):
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

### General:
- [X] when rightcliking a skill check, I get the following error (might be related to jquery removal):
charactersheet.js:8146 Uncaught TypeError: Cannot read properties of null (reading 'remove')
    at CharacterSheetPage._showSkillAbilityMenu (charactersheet.js:8146:53)
    at HTMLDivElement.<anonymous> (charactersheet.js:2656:52)
_showSkillAbilityMenu	@	charactersheet.js:8146
(anonymous)	@	charactersheet.js:2656
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
_renderCompanionsOverviewIndicator	@	charactersheet.js:3988
_renderCompanions	@	charactersheet.js:3593
_renderCharacter	@	charactersheet.js:2316
cbClose	@	charactersheet.js:9550
pHandleCloseClick	@	utils-ui.js:412
(anonymous)	@	utils-ui.js:513
- [X] spells added from level up / quickbuild have a Ritual button if they are ritual spells, but the spells added from the spell picker don't have the ritual button even if they are ritual spells. This should be fixed to ensure that all ritual spells, regardless of how they are added to the character sheet, have the ritual button for easy identification and use.
- [X] dreamwalker abilites are grouped in the featurs part under charsheet__feature-group mb-3 have the name DW C instead of the actual name.
- [X] images are trying to be loaded from the wrong path, asusming the site is hosted on a different domain or something. Error:
Aberrant%20Spirit.webp:1 
 GET https://truemichato.github.io/ThelemarTools/img/bestiary/tokens/XPHB/Aberrant%20Spirit.webp 404 (Not Found)



### Spells
- [] when summoning a familiar, the icons are not always correct for the animal, and very repetitive (all birds have the same icon). This should be fixed to show the correct icon for each familiar type.
- [] when summoning a familiar, there should be a way to create a custom familiar with a custom name and icon, rather than being limited to the predefined options. This would allow for more personalization and creativity in character creation.
- [X] when choosing a familiar in the familiar selection menu, I get the following error (might be related to jquery removal):
charactersheet.js:3988 Uncaught (in promise) TypeError: Cannot set properties of undefined (setting 'display')
    at CharacterSheetPage._renderCompanionsOverviewIndicator (charactersheet.js:3988:42)
    at CharacterSheetPage._renderCompanions (charactersheet.js:3593:8)
    at CharacterSheetSpells._selectFamiliar (charactersheet-spells.js:3300:34)
    at HTMLButtonElement.<anonymous> (charactersheet-spells.js:3227:17)
_renderCompanionsOverviewIndicator	@	charactersheet.js:3988
_renderCompanions	@	charactersheet.js:3593
_selectFamiliar	@	charactersheet-spells.js:3300
(anonymous)	@	charactersheet-spells.js:3227
- [] Find Greater Familiar spell is currently not implemented.

### Feats:
- [] The Telekenetic feat adds the mage hand spell as a level 1 spell instead of a cantrip, and it also adds it without most of its information, meaning there is a bug in the way feats in general add spells to the character sheet. This should be fixed to ensure that spells added by feats are added at the correct level and with all relevant information (e.g. spell level, casting time, range, components, etc.).





## Unverified bugs:

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.