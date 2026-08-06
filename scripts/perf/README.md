# Page-load performance harness

`scripts/perf/measure.mjs` measures how long content pages take to become usable, and writes the
result to JSON so two runs can be diffed. It exists so that performance work can be judged on
numbers rather than intuition — a previous optimisation attempt on this codebase made load times
*worse*, and there was no way to tell until users noticed.

## Quick start

```bash
# Baseline the deployed site
node scripts/perf/measure.mjs \
  --origin https://truemichato.github.io/ThelemarTools \
  --label before --out perf-before.json

# ...make a change, then measure this checkout locally
node scripts/perf/measure.mjs --serve \
  --label after --baseline perf-before.json --out perf-after.json
```

`--serve` starts a throwaway `http-server` on port 5099 against this checkout, with
`max-age=600` to match what GitHub Pages sends. It shuts the server down when the run finishes.

## What it measures

| Metric | Meaning |
|---|---|
| `listReadyMs` | Time until the list has ≥100 rows. This is the "page is usable" moment. |
| `longTaskTotalMs` | Total main-thread long-task time. The best proxy for "the page felt janky". |
| `longTaskMaxMs` | Largest single long task — a 1 s task is far worse than ten 100 ms tasks. |
| `brewRawMs` / `brewProcessedMs` | Time inside `BrewUtil2._pGetBrewRaw_` / `_pGetBrewProcessed_`. |
| `requestCount` / `bytesTransferred` | Network volume. |
| `remoteBrewRequestCount` | Requests to `raw.githubusercontent.com` — homebrew fetched cross-origin. |
| `servedFromCacheCount` | Requests satisfied without hitting the network. |
| `brewProps` | Entity count per homebrew prop. **A correctness check, not a perf metric.** |

Each page is measured in two phases: `cold` (empty HTTP cache) and `warm` (one unmeasured priming
load first). Each phase runs `--runs` times and reports the median.

## The correctness check

`brewProps` records how many entities each homebrew prop resolved to (`monster: 2503`,
`item: 4006`, and so on across ~63 props). When `--baseline` is supplied, the harness diffs these
counts and prints any that moved.

**Any difference is a failure.** It means a change dropped, duplicated or failed to merge
homebrew content. A performance win that changes these numbers is not a win.

## Reading the output

The comparison table only prints metrics that moved by more than `--noise` percent (default 5).
Anything smaller is within run-to-run variance and should not be interpreted. The process exits
non-zero if any compared metric regressed beyond that threshold.

## Pitfalls

These cost real time to discover; please don't re-learn them.

- **Only compare same-origin runs.** `localStorage` and IndexedDB are per-origin, so a browser
  that has homebrew stored on one origin and not another is not running the same test. Repeated
  40 MB loads also build up GC pressure that skews cross-origin comparisons badly.
- **Don't compare `bytesTransferred` between `--serve` and the deployed site.** `http-server`
  does not gzip; GitHub Pages does. The same payload measures ~15.8 MB locally and ~3.2 MB
  deployed. CPU metrics *are* comparable; byte counts are not.
- **Use at least 3 runs.** With `--runs 1`, long-task totals routinely vary by ±5%.
- **Node micro-benchmarks run 3–5× optimistic** versus the browser (warm JIT, no GC pressure, no
  competing parse work). Use the browser numbers for decisions.
- List rows are `.ve-lst__row`, not `.lst__row`.
- `ListPage`, `ListUtil`, `Omnisearch` and `MultiSource` are ES-module-scoped and are *not* on
  `window`. `List`, `FilterBox`, `Renderer`, `DataLoader` and `BrewUtil2` are global, which is why
  the instrumentation hooks `BrewUtil2`.
- Chrome refuses to connect to port 5060 (`ERR_UNSAFE_PORT`).
- An HTTPS page cannot `fetch` from `http://localhost` — it hangs silently with no console error.
