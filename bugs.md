# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[] when clicking to exit quickbuild, the modal appears behind the quickbuild one:
<div class="ve-ui-modal__inner ve-flex-col ve-ui-modal__inner--no-min-height"><div class="ve-split-v-center ve-no-shrink  "><h4 class="ve-my-2">Close Quick Build?</h4></div><div class="ve-ui-modal__scroller ve-flex-col"><div class="ve-flex ve-w-100 ve-mb-1"><p>You have unsaved progress. Are you sure you want to close?</p></div><div class="ve-flex-v-center ve-flex-h-right ve-py-1 ve-px-1"><button class="ve-btn ve-btn-primary  ve-flex-v-center ve-mr-3">
				<span class="glyphicon glyphicon-ok ve-mr-2"></span><span>Close</span>
			</button><button class="ve-btn ve-btn-default ve-btn-sm ve-flex-v-center ve-mr-3">
				<span class="glyphicon glyphicon-remove ve-mr-2"></span><span>Cancel</span>
			</button></div></div></div>
[] Not all warlock invocations are implemented in calculations, and many have prerequisites that are not enforced in the UI (e.g. invocations that require a certain pact boon or warlock level). 

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
