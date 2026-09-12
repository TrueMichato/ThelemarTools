# Browser performance harness

See [Reference-list rendering](../../docs/list-virtualization.md) for the virtual
row lifecycle, compatibility option, rollout boundary, and measured results.

- **`measure.mjs`** measures load/interaction response and checks logical content.
- **`profile.mjs`** ranks sampled CPU self time during a real page load.

Requires the existing `playwright` and `http-server` development dependencies and Playwright
Chromium. Run benchmarks sequentially, without other browser tests or CPU-heavy jobs.

## Repeatable before/after measurements

```bash
# Run this BEFORE changing application code.
node scripts/perf/measure.mjs --serve --pages items,spells,feats \
  --runs 3 --label before --out perf-before-v2.json

# After the application change, use identical flags and the same machine.
node scripts/perf/measure.mjs --serve --pages items,spells,feats \
  --runs 3 --label after --baseline perf-before-v2.json --out perf-after-v2.json

# Optional interaction recipes (use the flag for BOTH baseline and candidate).
node scripts/perf/measure.mjs --serve --pages items,spells,feats \
  --runs 3 --interactions --out perf-interactions-v2.json

# CPU-throttled/narrow-viewport results form a SEPARATE comparison series.
node scripts/perf/measure.mjs --serve --pages items,spells,feats \
  --width 390 --height 844 --cpu-throttle 4 --out perf-narrow-v2.json
```

`--serve` binds this checkout to an OS-assigned, unique loopback port. `--port 5099` selects a
specific port instead; an occupied port fails rather than accidentally measuring another
checkout. The server verifies that it serves this checkout's `items.html`, uses `max-age=600`,
and closes on completion. No persistent process or separate dev server is needed.

Without `--serve`, use `--origin https://example.com/tools` or a running local origin (default:
`http://localhost:5050`). `--help` lists all options. The default suite remains
`bestiary,spells,items,classes,crafting`; Classes is intentionally **not** required to virtualize.

## Readiness and schema version

Results have `schemaVersion: 2` and `readinessVersion: "toolsLoaded-logical-paint-v2"`.
**Old row-stability/threshold baselines are incompatible.** Rebaseline unchanged application
code with v2; do not compare old `listReadyMs` values to new ones.

The browser init script listens for `toolsLoaded` **before application scripts run**. It then
checks that `dbg_page.primaryLists` are initialized/not dirty, have a nonempty loaded dataset,
and keep the same logical loaded/matching arrays and counts across two animation frames.
Standard pages must also display the correct `matching/loaded` result counter.
Classes, Names and Encounter Generator have an explicitly reported custom-counter exception;
they still require the lifecycle signal and logical lists. Arbitrary custom pages without
these contracts fail instead of falling back to mounted-row stability.

Two animation-frame callbacks allow a paint between callbacks. This is a **response proxy**,
not a guaranteed presentation timestamp, INP, or another Core Web Vital. Mounted rows are
never a readiness threshold. A valid filter can produce zero matches.

## Measurements

| Field | Meaning |
|---|---|
| `firstRowMs` | First observed row, descriptive only; not a readiness/comparison gate. |
| `toolsLoadedMs` | Application lifecycle event timestamp. |
| `listReadyMs` | Lifecycle + logical/counter checks + two-frame endpoint. |
| `logicalLoadedRows` | All registered primary-list items, not every raw data entity. |
| `logicalMatchingRows` | All matching/sorted items, including unmounted matches. |
| `listRows` / `logical.lists[].mountedRows` | Mounted primary rows only; sublists excluded. |
| Per-list `renderedLogicalRows` / `isVirtualRendering` | Public renderer diagnostics where supported; `null` on legacy lists. |
| `materializedRows` / per-list `materializedElements` | Retained row trees/descendant elements, including detached trees; `null` if safely unobservable. |
| `rowBuilderMs` / `rowBuilderCalls` | Synchronous `getListItem` time/calls, **including metadata/filter work**, not just DOM. |
| `loadPhases` | Reached page loading hooks, by method name; phases may overlap other metrics. |
| `longTaskTotalMs` / `longTaskMaxMs` / `longTaskCount` | Main-thread long tasks through the load collection window. |
| `brewRawMs` / `brewProcessedMs` | Wrapped BrewUtil2 load/processing time; nested calls are not exclusive CPU time. |
| `requestCount`, `bytesTransferred`, `bytesDecoded`, `servedFromCacheCount` | Resource Timing network metrics; cross-origin timing restrictions apply. |
| `remoteBrewRequestCount` | Requests to GitHub/GitHubusercontent hosts. |
| `brewProps` | Processed homebrew counts, a correctness signal rather than a speed metric. |

Load collection includes the existing 500 ms post-readiness tail for delayed observer/task
delivery. Logical identity/materialization traversal happens **after** this timing window;
it never reads a lazy `.ele` getter. It prefers `peekEle()`; a `null` return is an
unmaterialized row, **not** permission to fall back to `.ele`. Only legacy items without
`peekEle` use eager `ele` or `_ele` own data properties.
It does not estimate cumulative DOM construction/cache eviction when no safe diagnostic
surface exists. Row-builder calls are not a substitute for materialized-tree counts.

`pages.<page>.<phase>.runs` retains every observation, instrumentation reach, warnings, errors,
source configuration and per-list correctness digests. Top-level phase timings are medians.
Viewport, Chromium version, CPU throttling, origin, storage policy and enabled scenarios are
recorded. A missing hook/call, timeout, unexpected console/page/network error, missing hash,
duplicate identity, result-counter mismatch, or inconsistent run is a failure.

The one development-resource exception is a missing local `/sw-injector.js`, a generated
optional service-worker bootstrap. Its 404/aborted request/resource-console error are retained
as warnings. Data failures and JavaScript exceptions are **never** covered by this exception.
Service workers are blocked in both tools for controlled cache behavior.

## Content correctness

The harness uses each registered row's **actual page hash**, entity `__prop` discriminator,
and optional `customHashId`, rather than assuming `name|source` uniquely identifies everything.
It SHA-256 hashes ordered loaded and matching identity arrays per list and across primary
lists. Duplicate identities and matching objects absent from loaded items are rejected.

Within a phase, every run must have identical identities/order, homebrew counts and source
configuration. Before/after comparisons also check these values and interaction outcomes.
A digest detects a dropped/duplicated/reordered row; it does not prove the complete underlying
entity payload or exported content is unchanged. Export/selection behavior needs separate
functional tests. Dataset changes upstream require investigation and a new controlled baseline,
not acceptance as a performance improvement.

## Optional interaction scenarios

`--interactions` currently has tested recipes for Items, Spells and Feats. Other pages remain
in the load suite with an explicit interaction skip. Each recipe uses actual browser input:

1. Type `longsword`, `fireball`, or `alert`; require a nonempty narrower logical result and an
   observed logical update.
2. Click the clear-search control; require exact restoration of ordered matching identities.
3. Click Name sort for each primary list; require direction/order change with unchanged counts.
4. Click an included **real source mini-pill** associated with matching entities; verify source
   state and logical results change. If none is visible, report a skip, never a made-up timing.
5. Wheel each scrollable primary list; require scroll position movement. Non-scrollable lists skip.
6. Establish a first-row deep link, then press `k` to wrap to a far result; require the actual
   target hash and a mounted row intersecting the list viewport.

Scenarios report trusted-input-to-two-frame `responseMs`, logical update count, long-task
total/max, and full-result digests separately from initial loading. They never call internal
search/sort/filter setters to manufacture a successful input result. Deep-link setup and final
UI Reset are untimed; Reset verifies/restores initial matching identities before the next warm
run. These are single repeatable responses, **not** a sustained scroll/jank benchmark or
proof of bounded caching over a full-dataset traversal.

## Cache policy and comparison caveats

- Each cold run gets fresh origin storage and an explicit Chromium HTTP-cache clear.
- Warm runs share a context after one unmeasured priming load; origin storage and HTTP cache
  are warm. Priming errors fail the phase. No personal browser profile/storage is imported.
- Site defaults may automatically load remote homebrew. Source configuration and homebrew
  counts make this visible; this is not implicitly a site-data-only benchmark.
- Only compare the same configuration and browser version. Two harness-owned fresh loopback
  servers may differ in port; other cross-origin comparisons are refused.
- Local `http-server` does not gzip like production. Do not compare local byte counts with
  deployed transfers. Remote timing restrictions can hide transfer sizes.
- Default noise threshold is 5%; use at least three runs and repeat noisy results.
- A nonzero exit means validation/comparison failure or a regression beyond the threshold.
  A small DOM or a lower load time cannot override a failed correctness check.

## CPU profiling and harness tests

```bash
node scripts/perf/profile.mjs --serve --page items --top 30
node scripts/perf/profile.mjs --url https://example.com/tools/bestiary.html
node --test scripts/perf/*.test.mjs
npx eslint scripts/perf/*.mjs
```

The profiler shares lifecycle readiness, viewport/CPU flags, identity checks and error
instrumentation. It prints loaded/matching/mounted counts plus the matching digest.
High **self time** identifies candidate functions; `(program)` includes native work such as
JSON parsing/compilation/GC, while `(idle)` is waiting. Sampling overhead means profile spans
are not directly comparable with measurement load times. Method instrumentation itself also
adds overhead; before and after runs must use the same harness.
