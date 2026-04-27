# bugs

## Open Bugs
[x] Combat Methods & Traditions choices in Builder are not hoverable and are not explained. Would be great to write a short explaination for people who don't know what these are, and to make the choices hoverable to the relevant section of the class.
Also, the hovers for methods in the combat tab and in the builder/levelup/quickbuild/respec are all pointing to optionalfeatures and not to combatmethods, which creates a hover bug:
render.js:15824 Uncaught (in promise) Error: Failed to load renderable content for: page="optionalfeatures.html" source="TGTT" hash="doubleteam_tgtt" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15824:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15739:9)
_pHandleLinkMouseOver_doVerifyToRender	@	render.js:15824
pHandleLinkMouseOver	@	render.js:15739
await in pHandleLinkMouseOver		
onmouseover
[] Font size change should affect all fonts across the sheet, including modals and popups. Currently it only affects the main sheet, and some elements (e.g. modals) still use the default font size. This should be fixed by applying the font size change more globally across all elements of the sheet.
[] gems are not empowerable in the inventory or item addition flows.
[] Item upgrades modal needs some visual improvements and hovers.
[] if no items exist in inventory there is an extra "add item" button, but it leads to custom item creation rather than the normal item addition flow. This should be fixed so that the button either leads to the normal item addition flow or is hidden when no items exist.
[] showing both regular items and magical items in the item addition modal is confusing, especially since the magical filter is not working. It would be better to separate regular items and magical items into different sections or tabs in the modal, so that it's clearer which items are which and the magical filter can work properly.
[] in the add item modal, the filter for item type (armor, weapon, etc.) is not working and shows empty text instead of choices.
[] in general across the sheet we want to make sure that chosen filter options are marked as selected in the UI, and that the filter options are clear and easy to use. Currently this is not always the case (for example, the item rarity filter shows the options but does not indicate which one is selected, and the item type filter shows empty text instead of the options). This should be fixed to improve usability.
[] It would be nice to be able to filter weapons based on their properties (e.g. finesse, reach) and masteries (e.g. vex, sap) in the item addition modal. Currently you can only filter by weapon type (simple, martial) and category (melee, ranged), but not by specific properties. Adding this feature would make it easier to find the right weapon when adding items.
[] the "magical" filter in the item addition modal is not working and not filtering items correctly. This should be fixed so that it properly filters items based on whether they are magical or not.
[] it would be nice to be able to sort items in the add item modal by different criteria (e.g. name, rarity) to make it easier to find the right item. Currently there is no sorting option, and items are displayed in a default order that may not be optimal for finding specific items. Adding sorting options would improve usability. Also, I think I would like it to be cascaded sorting - to be able to sort by rarity, and inside each rarity sort by name, for example. This should also be the default sorting order, so that items are sorted by rarity first and then by name within each rarity level.
[] In respec, trying to edit weapon masteries throws error:
utils.js:1411 Uncaught (in promise) Error: Failed to create exactly one DOM element from HTML "
			<p class="ve-muted mb-2">Choose up to 3 weapon masteries for this level history entry.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-mastery-count">3</span>/3</div>
		"!
    at ElementUtil._getOrModify_getEle (utils.js:1411:46)
    at ElementUtil.getOrModify (utils.js:1292:31)
    at CharacterSheetRespec._editWeaponMasteries (charactersheet-respec.js:948:21)
    at async CharacterSheetRespec._editChoice (charactersheet-respec.js:823:5)
_getOrModify_getEle @ utils.js:1411
getOrModify @ utils.js:1292
_editWeaponMasteries @ charactersheet-respec.js:948
await in _editWeaponMasteries
_editChoice @ charactersheet-respec.js:823
(anonymous) @ charactersheet-respec.js:777
[] in respec, options don't have hovers.
[] in respec, editing combat traditions doesn't allow actually changing them and doesn't show traditions other then the selected ones.
[] in respec, editing combat methods doesn't allow actually changing them and doesn't show methods at all. It is also called optional features CTM:1 and whatever.


## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
