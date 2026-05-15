/**
 * Character Sheet Cantrip & Prepared Spell Counts — Unit Tests
 *
 * Verifies the canonical helpers on CharacterSheetClassUtils:
 *   - PLAYER_CHOSEN_SPELL_FEATURES (set membership)
 *   - isPlayerChosenSpell
 *   - partitionCantripsByAttribution
 *   - countPlayerChosenCantrips
 *   - countPreparedSpells
 *
 * The original bug: three different cantrip-counting code paths in
 * `charactersheet-spells.js` used three different filter rules and produced three
 * different counts for the same character. Annabel (Lvl 7 TGTT Chronurgy Wizard,
 * 5 cantrips: 3 attributed + 2 orphan) showed `Cantrips (2/4)` in the spells-tab
 * group header, `Cantrips: 3/4` in the tracking box, and 5 in the Add-Spell modal.
 *
 * Canonical rule: a cantrip counts toward the cap iff it has a positive player-
 * attribution `sourceFeature` (member of PLAYER_CHOSEN_SPELL_FEATURES). Orphans
 * (`sourceFeature == null`) and feature-granted spells (subclass / racial) do
 * NOT count — orphans are surfaced in a separate "Other Cantrips" group.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const C = globalThis.CharacterSheetClassUtils;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cantrip = (name, opts = {}) => ({
	name,
	level: 0,
	source: opts.source || "XPHB",
	sourceFeature: opts.sourceFeature ?? null,
	sourceClass: opts.sourceClass ?? null,
	...opts,
});

const spell = (name, level, opts = {}) => ({
	name,
	level,
	source: opts.source || "XPHB",
	sourceFeature: opts.sourceFeature ?? null,
	sourceClass: opts.sourceClass ?? null,
	prepared: opts.prepared ?? false,
	alwaysPrepared: opts.alwaysPrepared ?? false,
	inSpellbook: opts.inSpellbook ?? false,
	...opts,
});

// Annabel-shaped fixture (the actual reported bug character).
const annabelCantrips = [
	cantrip("Chill Touch", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
	cantrip("Prestidigitation", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
	cantrip("Minor Illusion", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
	cantrip("Mending", {sourceFeature: null, sourceClass: null}),
	cantrip("Moment to Think", {source: "ValdaPlayerPack", sourceFeature: null, sourceClass: null}),
];

// ---------------------------------------------------------------------------

describe("PLAYER_CHOSEN_SPELL_FEATURES", () => {
	it("is exposed on CharacterSheetClassUtils as a frozen Set", () => {
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES).toBeInstanceOf(Set);
	});

	it("contains the canonical labels assigned by builder/levelup/quickbuild", () => {
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Spells Known")).toBe(true);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Cantrips Known")).toBe(true);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Wizard Spellbook")).toBe(true);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Prepared Spells")).toBe(true);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Spells Prepared")).toBe(true);
	});

	it("does NOT include feature-granted labels", () => {
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("High Elf Cantrip")).toBe(false);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has("Chronurgy Magic Spells")).toBe(false);
		expect(C.PLAYER_CHOSEN_SPELL_FEATURES.has(null)).toBe(false);
	});
});

describe("isPlayerChosenSpell", () => {
	it("returns true for spells with a player-attribution sourceFeature", () => {
		expect(C.isPlayerChosenSpell({sourceFeature: "Cantrips Known"})).toBe(true);
		expect(C.isPlayerChosenSpell({sourceFeature: "Spells Known"})).toBe(true);
		expect(C.isPlayerChosenSpell({sourceFeature: "Wizard Spellbook"})).toBe(true);
		expect(C.isPlayerChosenSpell({sourceFeature: "Prepared Spells"})).toBe(true);
	});

	it("returns false for orphans (sourceFeature == null) — orphans go in 'Other Cantrips'", () => {
		expect(C.isPlayerChosenSpell({sourceFeature: null})).toBe(false);
		expect(C.isPlayerChosenSpell({sourceFeature: undefined})).toBe(false);
		expect(C.isPlayerChosenSpell({})).toBe(false);
	});

	it("returns false for feature-granted spells", () => {
		expect(C.isPlayerChosenSpell({sourceFeature: "High Elf Cantrip"})).toBe(false);
		expect(C.isPlayerChosenSpell({sourceFeature: "Chronurgy Magic Spells"})).toBe(false);
		expect(C.isPlayerChosenSpell({sourceFeature: "Magical Tinkering"})).toBe(false);
	});

	it("returns false for null/undefined input", () => {
		expect(C.isPlayerChosenSpell(null)).toBe(false);
		expect(C.isPlayerChosenSpell(undefined)).toBe(false);
	});
});

describe("partitionCantripsByAttribution", () => {
	it("returns empty buckets for an empty / nullish list", () => {
		expect(C.partitionCantripsByAttribution([])).toEqual({attributed: [], orphan: [], featureGranted: []});
		expect(C.partitionCantripsByAttribution(null)).toEqual({attributed: [], orphan: [], featureGranted: []});
	});

	it("buckets Annabel's 5 cantrips into 3 attributed + 2 orphan + 0 feature-granted", () => {
		const {attributed, orphan, featureGranted} = C.partitionCantripsByAttribution(annabelCantrips);
		expect(attributed.map(c => c.name)).toEqual(["Chill Touch", "Prestidigitation", "Minor Illusion"]);
		expect(orphan.map(c => c.name)).toEqual(["Mending", "Moment to Think"]);
		expect(featureGranted).toEqual([]);
	});

	it("recognises feature-granted cantrips (e.g. High Elf Cantrip)", () => {
		const cs = [
			cantrip("Fire Bolt", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
			cantrip("Prestidigitation", {sourceFeature: "High Elf Cantrip", sourceClass: null}),
		];
		const {attributed, orphan, featureGranted} = C.partitionCantripsByAttribution(cs);
		expect(attributed.map(c => c.name)).toEqual(["Fire Bolt"]);
		expect(orphan).toEqual([]);
		expect(featureGranted.map(c => c.name)).toEqual(["Prestidigitation"]);
	});

	it("skips null entries gracefully", () => {
		const cs = [null, cantrip("X", {sourceFeature: "Cantrips Known"}), undefined];
		const {attributed, orphan} = C.partitionCantripsByAttribution(cs);
		expect(attributed).toHaveLength(1);
		expect(orphan).toHaveLength(0);
	});
});

describe("countPlayerChosenCantrips", () => {
	it("returns count=0 with no orphans for empty input", () => {
		const r = C.countPlayerChosenCantrips([]);
		expect(r.count).toBe(0);
		expect(r.orphans).toEqual([]);
		expect(r.byClass).toEqual({});
	});

	it("returns canonical count for Annabel — 3 attributed, 2 orphans surfaced separately", () => {
		const r = C.countPlayerChosenCantrips(annabelCantrips);
		expect(r.count).toBe(3);
		expect(r.orphans.map(c => c.name)).toEqual(["Mending", "Moment to Think"]);
		expect(r.byClass).toEqual({
			wizard: {count: 3, items: expect.any(Array)},
		});
		expect(r.byClass.wizard.items.map(c => c.name)).toEqual(["Chill Touch", "Prestidigitation", "Minor Illusion"]);
	});

	it("excludes feature-granted cantrips from count and from orphans", () => {
		const cs = [
			cantrip("Fire Bolt", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
			cantrip("Prestidigitation", {sourceFeature: "High Elf Cantrip", sourceClass: null}),
			cantrip("Mending", {sourceFeature: null, sourceClass: null}),
		];
		const r = C.countPlayerChosenCantrips(cs);
		expect(r.count).toBe(1);
		expect(r.orphans.map(c => c.name)).toEqual(["Mending"]);
		expect(r.featureGranted.map(c => c.name)).toEqual(["Prestidigitation"]);
	});

	it("breaks down per-class for multiclass characters", () => {
		const cs = [
			cantrip("Fire Bolt", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
			cantrip("Prestidigitation", {sourceFeature: "Cantrips Known", sourceClass: "Wizard"}),
			cantrip("Sacred Flame", {sourceFeature: "Cantrips Known", sourceClass: "Cleric"}),
		];
		const r = C.countPlayerChosenCantrips(cs);
		expect(r.count).toBe(3);
		expect(r.byClass.wizard.count).toBe(2);
		expect(r.byClass.cleric.count).toBe(1);
	});
});

describe("countPreparedSpells", () => {
	it("returns zero for empty / nullish input", () => {
		expect(C.countPreparedSpells([])).toEqual({current: 0, max: null, isOver: false, isAt: false});
		expect(C.countPreparedSpells(null)).toEqual({current: 0, max: null, isOver: false, isAt: false});
	});

	it("ignores cantrips (level 0) — they have their own counter", () => {
		const spells = [
			cantrip("Fire Bolt", {sourceFeature: "Cantrips Known", prepared: true}),
			spell("Magic Missile", 1, {prepared: true, sourceFeature: "Wizard Spellbook"}),
		];
		expect(C.countPreparedSpells(spells).current).toBe(1);
	});

	it("ignores spellbook spells with prepared:false (Wizard's spellbook is the pool, not the prepared list)", () => {
		const spells = [
			spell("Detect Magic", 1, {inSpellbook: true, prepared: false, sourceFeature: "Wizard Spellbook"}),
			spell("Shield", 1, {inSpellbook: true, prepared: false, sourceFeature: "Wizard Spellbook"}),
			spell("Mage Armor", 1, {inSpellbook: true, prepared: true, sourceFeature: "Wizard Spellbook"}),
		];
		expect(C.countPreparedSpells(spells).current).toBe(1);
	});

	it("counts alwaysPrepared spells (e.g. subclass spells) toward 'currently prepared'", () => {
		const spells = [
			spell("Slow", 3, {prepared: false, alwaysPrepared: true, sourceFeature: "Chronurgy Magic Spells"}),
			spell("Haste", 3, {prepared: true, sourceFeature: "Wizard Spellbook"}),
		];
		expect(C.countPreparedSpells(spells).current).toBe(2);
	});

	it("populates isOver / isAt against the supplied max", () => {
		const spells = [
			spell("A", 1, {prepared: true}),
			spell("B", 1, {prepared: true}),
			spell("C", 1, {prepared: true}),
		];
		expect(C.countPreparedSpells(spells, {max: 5})).toMatchObject({current: 3, max: 5, isOver: false, isAt: false});
		expect(C.countPreparedSpells(spells, {max: 3})).toMatchObject({current: 3, max: 3, isOver: false, isAt: true});
		expect(C.countPreparedSpells(spells, {max: 2})).toMatchObject({current: 3, max: 2, isOver: true, isAt: false});
	});
});

describe("Annabel regression — cross-surface consistency contract", () => {
	// Whatever surface in spells.js renders the cantrip count, it MUST go through the
	// canonical helper. The expected value for Annabel's 5 cantrips at L7 is 3/4.
	it("Annabel canonical count is 3 (not 2 from old !sourceFeature rule, not 5 from old isPlayerChosenSpell)", () => {
		expect(C.countPlayerChosenCantrips(annabelCantrips).count).toBe(3);
	});

	it("Annabel orphan list contains the 2 unattributed cantrips for the 'Other Cantrips' group", () => {
		const {orphans} = C.countPlayerChosenCantrips(annabelCantrips);
		expect(orphans).toHaveLength(2);
		expect(orphans.map(c => c.name).sort()).toEqual(["Mending", "Moment to Think"]);
	});
});
