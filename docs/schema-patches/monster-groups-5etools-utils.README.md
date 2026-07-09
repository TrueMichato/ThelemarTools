# Monster groups schema patch (5etools-utils)

**Companion to:** ThelemarTools `feat(bestiary): first-class monsterGroup
entity` (branch `truemichato-monster-groups-cde`, tracker
5ET-409 / issue #517).

**Target repo:** `5etools-mirror-3/5etools-utils`

## What it does

Introduces a new first-class `monsterGroup` entity, mirroring
`legendaryGroup` in shape and role. Two schema files are added:

- `schema/site/bestiary/monstergroups.json` — validates the sitewide
  `data/bestiary/monstergroups.json` payload authored on the site.
- `schema/brew/bestiary/monstergroups.json` — brew variant, allowing
  homebrews to ship their own monsterGroup entities.

Additionally, the monster schema is extended (site + brew) with two
optional fields:

- `groupSource` (string) — an optional disambiguator on
  `mon.group[i]`. When set, callers can bind a monster's group label
  to a specific `monsterGroup.source` where two entities share a
  name across sources (e.g. `Slaadi|MM` vs `Slaadi|XMM`). Absent by
  default; the app resolves by name-lower matching in that case.
- `groupTag` (string, alternative name — see \"Naming decision\"
  below) — omitted; the existing `group[]` array remains the
  membership channel.

## Files in this bundle

- `site.monstergroups.json` — drop into `schema/site/bestiary/monstergroups.json`.
- `brew.monstergroups.json` — drop into `schema/brew/bestiary/monstergroups.json`.
- `monster-groups-5etools-utils.diff` — a Python-generated diff for
  the monster schema patches (adding the optional `groupSource`
  property to the monster block in each variant), plus the two new
  files.

Both schema files use `$ref` back to `util.json#/$defs/*` for
`source`, `entryArray`, `additionalSources`, `otherSources`,
`copyBlock`, `metaBlock`, `srd`, and `reprintedAs`. All refs use the
`../util.json` relative path that works from `schema/site/bestiary/`
and `schema/brew/bestiary/`.

## Applying

```bash
cd /path/to/5etools-utils
# 1. Copy the two new schema files into place.
mkdir -p schema/site/bestiary schema/brew/bestiary
cp /path/to/ThelemarTools/docs/schema-patches/monster-groups-5etools-utils/site.monstergroups.json \
   schema/site/bestiary/monstergroups.json
cp /path/to/ThelemarTools/docs/schema-patches/monster-groups-5etools-utils/brew.monstergroups.json \
   schema/brew/bestiary/monstergroups.json

# 2. Apply the monster-schema patch for `groupSource`.
git apply --directory=schema \
   /path/to/ThelemarTools/docs/schema-patches/monster-groups-5etools-utils/monster-groups-5etools-utils.diff
```

If the aggregate homebrew index (typically `schema/brew/homebrew.json`
or similar) enumerates permitted top-level properties for a brew
package, add `monsterGroup` there so brews can ship the array.

## Verification

Validate `data/bestiary/monstergroups.json` in this repository against
the new site schema:

```bash
cd /path/to/ThelemarTools
node node/validate-schema-brew-corpus.js data/bestiary/monstergroups.json
```

(Or use the utils repo's own validation entrypoint.)

## Coordination: skip-guard removal after this PR lands

While the utils schema is pending, `test/test-json.js` in ThelemarTools
carries a small `_SCHEMA_PENDING_UTILS` array that skips validation of
`data/bestiary/monstergroups.json` when the schema file isn't found on
disk in `node_modules/5etools-utils/schema/site/bestiary/`. This guard
is **self-clearing** — once this utils PR merges and users run
`npm install` (bumping their `5etools-utils` snapshot), the on-disk
check flips and validation resumes automatically. No further code
change is required in ThelemarTools for the skip to lift.

If desired, the reviewer merging this utils PR (or a follow-up
ThelemarTools PR) may remove the `_SCHEMA_PENDING_UTILS` array entry
outright once `5etools-utils` >= the merged version is pinned in
ThelemarTools' `package.json`. The entry lives at:

```js
// test/test-json.js
const _SCHEMA_PENDING_UTILS = [
    {suffix: "bestiary/monstergroups.json", schemaId: "bestiary/monstergroups.json"},
];
```

Delete the object literal (or the whole array if it becomes empty).


## Naming decision

We add the *entity* under the top-level `monsterGroup` property and
keep the *membership* channel on monsters as the existing `group[]`
array documented in `util.json#/$defs/group`. This mirrors how
`legendaryGroup` (top-level array on the bestiary data file) links to
the *reference* `legendaryGroup: {name, source}` object on each
monster — but we deliberately do NOT introduce a parallel reference
object on monsters. Bare-string membership through `group[]` is
preserved so:

1. Monsters that belong to a small, ad-hoc, unauthored family
   continue to work (bare string, no entity).
2. Backwards compatibility with the existing corpus is total — no
   monster data changes are required to opt in.

The optional `groupSource` string is the only disambiguation
affordance, and only needed when a single label maps to more than one
entity across sources.
