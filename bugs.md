## Open bugs:

### TGTT Monk
- [] Weapons don't get monk weapons tag, though they do get the damage of monk weapons applied to them.
- [] still getting both ki save dc and focus save dc.
- [] no feature and action/bonus action added for flurry of blows, patient defense, or step of the wind.
- [] uncanny metabolism appears as an ability and an active state, but should only be a passive that gets triggered when rolling initiative and ki points are not at max, allowing you to use it to regain ki points according to the ability.
Right now, even when using it, it doesn't actually add the ki points back to the character sheet, and it doesn't trigger when rolling initiative.
- [] Implements of Mercy still not implemented at all.
- [] general mixup between ki points and focus points, with some features referring to focus points instead of ki points and vice versa. Need to review the class and make sure all features are referring to the correct resource.
- [] currently all features that require focus/ki points say there aren't enough ki points to use them, even when there are enough ki points. This is likely due to the mixup between focus points and ki points mentioned above, but it needs to be fixed so that the features correctly check for the presence of enough ki points instead of focus points.
- [] no ability to use ki points to fuel exertion based features like combat methods. 

### Combat Methods
- [] subclass features that add combat methods and traditions (for example, mercy monk has Combat Methods (Mercy), which should add a tradition and one combat method from that tradition) are not implemented at all.

### General
- [] when adding feats directly using the feat picker, feats are not hoverable, but they need to be.
- [] when adding conditions, they are not hoverable, but they need to be.
- [] when adding a custom attack to a monk, it isn't possible to mark it as a monk weapon, which means it doesn't get the benefits of monk weapons (e.g. using dexterity for attack and damage rolls, getting the extra damage from martial arts, etc.). There should be an option to mark custom attacks as monk weapons so that they can benefit from these features.

## Unverified bugs:

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.