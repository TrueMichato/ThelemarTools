# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[x] All races should have the tasha's ability of changing the ability score increase to be general bonus (if a race has a +2 to one ability and +1 to another, it should be possible to change the +2 to any ability and the +1 to any other ability). This is currently only implemented for races from 2014, but all races should be included.
[x] For divine soul sorcerer, cleric spells are still not appearing in the spell list. This is a major bug that needs to be fixed as soon as possible. We want them to appear both in spell picker as well as the pickers for builder/levelup/quick build.
[x] currently choosing spells in levelup/quickbuild/builder is required, and we do not support switching existing spells, even though this is part of the spellcasting feature of most classes. We should add the ability to switch spells in these pickers, and also make it optional to choose spells in the first place (e.g. for a level 1 character, they can choose to not select any spells and just choose later, but we still want them to know how many spells they need to pick). This requires clever UI work to both make this flexible and easy to use from the switching spells perspective, but also to make it clear that they can choose to not select spells and just choose spells later in the sheet.
[x] Spell Scribing Adept feat is not implemented.
[x] sheet doesn't have the ability to mark character as "silenced", and doesn't check silenced status for spellcasting verbal spells. This also raises the question of how to handle other conditions that affect spellcasting (thelemar has grapple and restrained affect somatic spells, frightened affects verbal spells, poisoned affects concentrations, being knocked prone requires concentration, etc). Please audit the current conditions system and make sure they all work correctly with spellcasting.

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
