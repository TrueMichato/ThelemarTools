# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[x] hover bug for bladsong related things:
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TCE" hash="bladesinger%20styles_wizard_tce_bladesinging_tce_2_tce" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
onmouseover @ charactersheet.html:1
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TCE" hash="bladesong_wizard_tce_bladesinging_tce_2_tce" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
onmouseover @ charactersheet.html:1
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TCE" hash="training%20in%20war%20and%20song%20(bladesinging)_wizard_tce_bladesinging_tce_2_tce" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
onmouseover @ charactersheet.html:1
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TCE" hash="bladesinging_wizard_tce_bladesinging_tce_2_tce" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
onmouseover @ charactersheet.html:1
[X] when adding adept speed specialty from quickbuild and choosing it multiple times the speed bonus doesn't stack and the other ones doesn't show up in the features list.
[X] when doing quickbuild and choosing to roll for hit points, I want the player to be able to insert the rolled value if they want to instead of having to use the default value. 
[] In the builder and multiclassing, the Illrigger class appears both from the Illrigger source and the TGTT source, but only the TGTT version should be available for selection.



## Closed Bugs


## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
