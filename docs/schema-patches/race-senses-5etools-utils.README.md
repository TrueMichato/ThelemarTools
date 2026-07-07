# Race senses schema patch (5etools-utils)

**Companion to:** ThelemarTools `feat(race): first-class support for
all four canonical senses` (branch `truemichato-race-senses-tag`,
tracker 5ET-1226).

**Target repo:** `5etools-mirror-3/5etools-utils`

## What it does

Adds `tremorsense` and `truesight` (both `{"type": "integer"}`) to
every race schema `properties` block that already declares
`darkvision` and `blindsight`. Six schema variants are patched
(site / site-fast / brew / brew-fast / ua / ua-fast), each with
six occurrences of the race-properties block:

- Base race, subrace, and the four `_versions`-nested race
  properties blocks.

## Applying

```bash
cd /path/to/5etools-utils
git apply --directory=schema /path/to/ThelemarTools/docs/schema-patches/race-senses-5etools-utils.diff
```

(The diff uses `a/` and `b/` prefixes relative to the schema root,
so `git apply --directory=schema` resolves them correctly. `git apply
--check` verifies cleanly against the current `5etools-utils` main.)

Or use the equivalent Python script (idempotent, JSON-safe — the
script that generated this diff):

```python
import json, os
targets = [
    "schema/site/races.json", "schema/site-fast/races.json",
    "schema/brew/races.json", "schema/brew-fast/races.json",
    "schema/ua/races.json",   "schema/ua-fast/races.json",
]
def add_senses(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get("properties"), dict):
            props = obj["properties"]
            if "darkvision" in props and "blindsight" in props:
                new_props = {}
                for k, v in props.items():
                    new_props[k] = v
                    if k == "blindsight":
                        new_props.setdefault("tremorsense", {"type": "integer"})
                        new_props.setdefault("truesight",   {"type": "integer"})
                obj["properties"] = new_props
        for v in obj.values(): add_senses(v)
    elif isinstance(obj, list):
        for v in obj: add_senses(v)
for p in targets:
    with open(p) as fh: data = json.load(fh)
    add_senses(data)
    with open(p, "w") as fh:
        json.dump(data, fh, indent="\t", ensure_ascii=False); fh.write("\n")
```

## Test fixture

Recommended companion addition on the schema side — a race entry
that exercises all four senses at once so a future omission fails
the schema smoke test:

```json
{
    "race": [
        {
            "name": "Full-Senses Test",
            "source": "TST",
            "size": ["M"],
            "speed": 30,
            "darkvision": 60,
            "blindsight": 30,
            "tremorsense": 60,
            "truesight": 30,
            "entries": [
                "A test race that grants all four canonical D&D 5e senses."
            ]
        }
    ]
}
```

Drop it at whatever path the existing site-fixture harness picks up
(`test/schema-fixtures/race-passing.json` or similar).

## Coordination

Do **not** merge this repo's PR before the 5etools-utils PR lands
— brew/site data using `tremorsense` or `truesight` will otherwise
fail schema validation in CI. If landing out of order is unavoidable,
guard downstream data authors from adopting the new fields until
the schema PR lands.
