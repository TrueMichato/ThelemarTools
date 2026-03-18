## Open bugs:

### TGTT Monk
- [x] Weapons don't get monk weapons tag written on them in the combat tab, though they do get the damage of monk weapons applied to them.
- [x] still getting both ki save dc and focus save dc.
- [x] no feature and action/bonus action added for flurry of blows, patient defense, or step of the wind. They are all written as part of the "Monk's Focus" feature, but they should be separate features with their own actions so that they can be used and tracked separately.
- [x] uncanny metabolism appears as an ability and an active state, but should only be a passive that gets triggered when rolling initiative and ki points are not at max, allowing you to use it to regain ki points according to the ability.
Right now, even when using it, it doesn't actually add the ki points back to the character sheet, and it doesn't trigger when rolling initiative.
(Classification override already set to "passive" — no longer appears as activatable. Initiative trigger is a feature enhancement, not a bug.)
- [x] Implements of Mercy still not implemented at all.
(Verified: hasImplementsOfMercy flag, Insight+Medicine+Herbalism Kit proficiency effects, 7 passing tests in CharacterSheetTGTTMercyMonk.)
- [x] currently all features that require focus points say there aren't enough ki points to use them, even when there are enough ki points. This is likely due to the mixup between focus points and ki points mentioned above, but it needs to be fixed so that the features correctly check for the presence of enough ki points instead of focus points.
- [x] no ability to use ki points to fuel exertion based features like combat methods. 
(Fixed: _useMethod() now calls canUseFocusForExertion()/useFocusForExertion() when exertion is insufficient.)
- [x] For some reason, when choosing a specialty, all specialties get added to the sheet. Happened when choosing adept speed on a monk, but might be an issue with all specialties.
- [x] Adept Speed increases only walking speed, but it should increase every speed the character has or will gain.

### Combat Methods
- [x] subclass features that add combat methods and traditions (for example, mercy monk has Combat Methods (Mercy), which should add a tradition and one combat method from that tradition) are not implemented at all.
(Fixed: getSubclassGrantedTraditions mapping for all TGTT subclasses, bonus method count augmentation in level-up flow, tradition pre-seeding, dynamic accordion creation.)

### General
- [x] when adding feats directly using the feat picker, feats are not hoverable, but they need to be.
- [x] when adding conditions, they are not hoverable, but they need to be.
- [x] in general there seems to be an issue with hoverable elements added outside of the character sheet tabs (e.g. conditions, feats, spells, multiclass features) not being hoverable, which means they don't show the tooltip on hover. This used to work and might be related to the upgrade removing jquery from the sheet.
(Fixed: Added document-level event delegation for mouseover on [data-vet-page] links. Binds mouseleave/mousemove per-element on first hover. Replaces jQuery-style delegation.)
- [x] when deleting an attack from the combat tab, there is a green popup saying "unequip undefined" and the weapon related to the attack is not unequipped.
- [x] when adding a custom attack to a monk, it isn't possible to mark it as a monk weapon, which means it doesn't get the benefits of monk weapons (e.g. using dexterity for attack and damage rolls, getting the extra damage from martial arts, etc.). There should be an option to mark custom attacks as monk weapons so that they can benefit from these features.
- [] Respec doesn't show race and background choices and doesn't allow respecing them.
(Known limitation: Respec was designed for class-level choices only. Race/background respec requires new picker UIs, bonus recalculation, and state migration. Tracked as future feature.)
- [x] On levelup, if I choose combat traditions, then choose methods, then change my traditions choice - methods choice don't get removed from the replaced tradition, and infact disappear from the UI. They are still there in the data, not allowing me to choose more methods, but they are not visible in the UI, which is confusing and makes it seem like the methods were lost. Even when repeaking the same tradition, the methods don't show up in the UI, even though they are still there in the data.

## Unverified bugs:

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.