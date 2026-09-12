# Reference-list rendering

Reference pages keep their complete loaded dataset and filtered/sorted results in
JavaScript, while large lists render only the viewport and a surrounding buffer.
Rows are constructed lazily. This reduces browser work; it does **not** change
source selection, download fewer books, or remove results.

## Compatibility option

Choose **Other Options → List rendering…**:

- **Automatic** uses measured, variable-height virtualization when more than 200
  entries match. Small lists use the ordinary renderer.
- **Render all rows** puts every matching row in the document. Use this for
  native browser Find or assistive technology requiring the complete list DOM.
  Large lists can take longer to render.

Browser Find sees only rendered text in Automatic mode; it is not intercepted.
The page's own search and filters always search the full logical dataset.
`StorageUtil` saves the choice per page under `listRenderingMode` (`automatic`
or `all`). Both Items panes share this preference. Changing modes preserves
search, filters, sort order, selection, preview state, and the scroll anchor.

If `ResizeObserver` is unavailable, the full renderer is used. A persistent
warning and the compatibility dialog explain why.

## Rollout boundary

`js/list2/list2-page-config.js` is the explicit main-list allowlist.
`list2.js` imports and exposes `ListPageConfig` for the classic `listpage.js`
script. `ListPage._initList` is the opt-in boundary; an arbitrary `new List()`
continues to use the legacy renderer.

The 27 included pages are:

`actions`, `backgrounds`, `bastions`, `bestiary`, `charcreationoptions`,
`combatmethods`, `conditionsdiseases`, `crafting`, `cultsboons`, `decks`,
`deities`, `feats`, `homecrafts`, `items`, `itemupgrades`, `languages`,
`objects`, `optionalfeatures`, `psionics`, `races`, `recipes`, `rewards`,
`spells`, `tables`, `trapshazards`, `variantrules`, and `vehicles`.

Classes' mixin-based presentation and Names/Encounter Generator's grouped
`TableListPage` are excluded. Pinned and encounter sublists, modal pickers,
character sheets, DM Screen, and independent list consumers are also excluded.
Inheriting `ListPage` alone does not opt a page in.

## Logical versus rendered items

| API | Meaning |
| --- | --- |
| `list.items` | Every registered logical item |
| `list.visibleItems` | Every matching item, in current sort order |
| `list.renderedItems` | Mounted viewport/buffer items, including a protected focused row |
| `list.isVirtualRendering` | Whether virtualization is currently active |
| `list.scrollToItem(item, {isFocus, align})` | Reveal a logical item, including an unmounted distant row |
| `list.setRenderingMode({isRenderAll})` | Change rendering without changing the logical result |
| `list.refreshRenderedItems()` | Refresh the viewport and model-to-DOM hooks without a logical update |
| `list.renderingUnsupportedReason` | Capability fallback explanation, or `null` |

Never use mounted `.list a` elements to count results, choose a random result,
navigate, select a range, pin, or export. Use logical items instead. `Hist`
chooses the first logical match on fresh load and respects `data.hashCurr` before
`data.hash` for custom page hashes. Deep links, j/k navigation, search Enter,
random selection, and the preview shortcut reveal logical targets through the
list API. Filtered-out entries are not forced back into the result list.

Logical `updated` events remain separate from viewport refreshes: scrolling
must not update filter counters or rerun page-level filtering.

## Authoring lazy rows

Pass a reusable element factory as the second `ListItem` constructor argument:

```js
const item = new ListItem(
	index,
	() => createRowElement(entity),
	entity.name,
	searchAndSortValues,
	{hash},
);
item.addElementInitializer(ele => {
	ele.addEventListener("click", evt => list.doSelect(item, evt));
});
```

An eager element is still accepted for legacy callers. Metadata preparation,
filter registration, exclusion checks, deduplication, and entity enhancement
must remain outside the factory and execute once. Put DOM construction and
row-specific event binding inside the factory or an initializer.

- `item.ele` constructs the element on demand. Do not read it in a loop over
  all logical items.
- `item.peekEle()` returns an existing element or `null`, without constructing.
- `item.addElementInitializer(fn)` runs immediately for an existing element and
  again on each reconstruction. Register listeners here; do not retain obsolete
  controls elsewhere.
- `item.addElementRenderHook(fn)` projects current model state onto mounted DOM.
  Hooks run on ordinary and virtual renders, including unchanged viewport
  renders. Compare model and DOM state before doing work.
- `item.isSelected` updates the model and any existing DOM without constructing
  an off-screen row.

The renderer measures actual row heights, including wrapping and previews.
Viewport overscan is pixel-based (one viewport per side, at least 200 pixels).
Remeasurement retains the current anchor's measured height until it can be
measured again, including when the viewport is hundreds of pixels inside a
tall preview. Native scroll anchoring is disabled while virtualizing so it
does not compete with this correction.
The retained DOM cache budget is `max(200, renderedItems.length * 2)`; mounted
and focused elements are protected. Factories must tolerate eviction and
reconstruction. Do not store detached row elements in `item.data` or closures
that outlive the row.

## Inline previews

`item.data.isPreviewExpanded` is authoritative. Shared preview initializers bind
the toggle and preview event handlers; a guarded render hook restores expanded
content when the row is rendered again. Unchanged expanded rows do not
regenerate their statblocks during scrolling.

**Expand all** changes that boolean for every logical matching item and refreshes
only rendered rows. Unmounted rows build their previews when reached. Collapsing
clears the mounted preview content; eviction discards row DOM without losing
expansion state. The `m` shortcut reveals the current matching row before
toggling it. Preview controls expose expansion state and support Enter/Space.

## Exports and printing

Pinning, context-menu bulk actions, table/book views, and exports consume logical
entities, not the mounted window. Standard print CSS hides `#listcontainer`;
printing a statblock or book therefore does not require rendering every list
row. No temporary rendering-mode override is needed for those existing print
paths, and printing does not change the saved preference.

A future print flow that explicitly prints the list must temporarily render all
matching rows and restore the prior mode and anchor afterward.

## Validation

Run the focused unit suite with:

```sh
npm run test:unit -- --testPathPatterns='jest/list2' --no-coverage
```

Browser coverage under `test/e2e/` exercises the rollout, mode parity, distant
navigation, cache bounds, both Items panes, and previews. Real layout assertions
belong in browser tests, not mocked-DOM unit tests.

See [`scripts/perf/README.md`](../scripts/perf/README.md) for measurement commands.
Use lifecycle readiness and complete ordered identities for comparisons.
Mounted row count alone is not a loading-complete signal. Measure cold and warm
loads, search/filter/sort response, and scroll/cache behavior separately; run
benchmarks sequentially on the same viewport, browser, and source configuration.

## Measured results

September 2026 local verification used Chromium 149 at 1440 x 1000 with the
checkout's automatic homebrew enabled. These are three-run medians from the
same-origin, lifecycle-based harness, not production guarantees:

| Page | Cold ready, before / after | Warm ready, before / after | Matching rows | Initially mounted, before / after |
| --- | --- | --- | ---: | --- |
| Items | 9.04 s / 4.64 s | 8.59 s / 4.01 s | 5,844 | 5,844 / 70 |
| Spells | 3.13 s / 2.63 s | 2.83 s / 2.09 s | 993 | 993 / 86 |
| Feats | 2.81 s / 2.45 s | 2.34 s / 1.91 s | 337 | 337 / 93 |

All loaded and matching identity digests remained unchanged. Items still held
14,285 logical entries; only 105 row trees were initially materialized.

An additional three-run interaction probe measured clear-search to the second
animation-frame callback: Items **721 ms / 151 ms**, Spells **117 ms / 34 ms**,
and Feats **50 ms / 34 ms**. This isolates the list pipeline and a paint
opportunity; it excludes input debounce and is **not INP**.

Shared-host variance mattered: an initial after-run slowed even unchanged
homebrew processing substantially. Rather than treating that discrepancy as
proof of a regression, verification alternated original `HEAD` JavaScript and
working-tree JavaScript at the same origin, reversing their order between
pairs. Three pairs gave Items **8.21 s / 4.64 s**, Spells **3.00 s / 2.74 s**,
and Feats **2.48 s / 2.41 s**, with identical logical content. The subsequent
standard cold/warm comparison above passed its regression checks. In
particular, the small Feats startup difference in the paired run is within
normal variance; not every change in the table is attributable to windowing.

A separate 420 x 900, fourfold-CPU-throttled interaction smoke passed for all
three pages, retaining their complete result sets with 38/28/30 mounted rows.
It was one cold run per page, not a real-device benchmark. Initial readiness
was still approximately 17/9/8 seconds: data projection and homebrew processing
remain significant costs, deliberately outside this rendering-only rollout.
