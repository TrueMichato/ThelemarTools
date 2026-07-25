/**
 * B1 — Spell metadata sweep (Round 42).
 *
 * Many spell-add routes historically pushed lean entries missing `school` /
 * casting metadata, and dedup was CASE-SENSITIVE so `guidance|xphb` was never
 * coalesced with `Guidance|XPHB`. The Lunaria repro save shows Guidance ×3
 * (PHB + XPHB + lowercase-no-school) as a cantrip, Guiding Bolt ×3 as a spell,
 * and feat-granted Mend Plants / Vortex Warp / Magic Mouth with no school.
 *
 * These tests assert the REAL mechanics of the fix:
 *  - the choke points (`addSpell`/`addCantrip`/`addInnateSpell`) enrich from the
 *    catalog and coalesce case/edition-casing duplicates while keeping genuinely
 *    different editions (PHB≠XPHB) distinct;
 *  - `fulfillSpellChoice` attributes a feat "learn a spell" pick to its feature
 *    and carries the chosen casting ability (Forest Sage repro);
 *  - `populateSubclassSpells` grants single, enriched subclass spells;
 *  - the load-time `_migrateSpells` pass repairs an existing Lunaria-like save
 *    (enrich + coalesce + same-grant edition reconciliation) and is idempotent.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ─── Structured catalog fixtures (shape matches the real spell data files) ───

function mkSpell ({name, source, level, school, ritual = false, concentration = false}) {
	return {
		name,
		source,
		level,
		school,
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 30}},
		components: {v: true, s: true},
		duration: [{type: concentration ? "timed" : "instant", concentration, duration: {amount: 1, type: "minute"}}],
		concentration,
		ritual,
		subschools: [],
	};
}

/** The minimal catalog needed for the Lunaria repro plus an edition-exact guard. */
function makeCatalog () {
	return [
		mkSpell({name: "Guidance", source: "PHB", level: 0, school: "D"}),
		mkSpell({name: "Guidance", source: "XPHB", level: 0, school: "D"}),
		mkSpell({name: "Guiding Bolt", source: "PHB", level: 1, school: "V"}),
		mkSpell({name: "Guiding Bolt", source: "XPHB", level: 1, school: "V"}),
		mkSpell({name: "Mend Plants", source: "HUMBLEWOODTALES", level: 1, school: "T"}),
		mkSpell({name: "Vortex Warp", source: "SCC", level: 2, school: "C"}),
		mkSpell({name: "Magic Mouth", source: "XPHB", level: 2, school: "I", ritual: true}),
		mkSpell({name: "Detect Magic", source: "PHB", level: 1, school: "D", ritual: true}),
		mkSpell({name: "Detect Magic", source: "XPHB", level: 1, school: "D", ritual: true}),
	];
}

function newState () {
	const state = new CharacterSheetState();
	state.setSpellData(makeCatalog());
	return state;
}

// =========================================================================
// Choke-point enrichment + case-insensitive, edition-exact dedup (fresh add)
// =========================================================================

describe("choke points enrich + coalesce on fresh add", () => {
	it("addCantrip enriches a lean cantrip (fills school + casting metadata) and canonicalizes casing", () => {
		const state = newState();
		state.addCantrip({name: "guidance", source: "xphb", sourceFeature: "Circle of the Zodiac Spells"});

		const cantrips = state._data.spellcasting.cantripsKnown;
		expect(cantrips).toHaveLength(1);
		expect(cantrips[0].name).toBe("Guidance");
		expect(cantrips[0].source).toBe("XPHB");
		expect(cantrips[0].school).toBe("D");
		expect(cantrips[0].castingTime).toBe("1 action");
	});

	it("addCantrip coalesces a case/edition-casing duplicate into ONE entry", () => {
		const state = newState();
		state.addCantrip({name: "Guidance", source: "XPHB", school: "D", castingTime: "1 action"});
		state.addCantrip({name: "guidance", source: "xphb", sourceFeature: "Circle of the Zodiac Spells"});

		const cantrips = state._data.spellcasting.cantripsKnown;
		expect(cantrips).toHaveLength(1);
		// Missing attribution from the second add is filled onto the survivor.
		expect(cantrips[0].sourceFeature).toBe("Circle of the Zodiac Spells");
		expect(cantrips[0].school).toBe("D");
	});

	it("addSpell enriches a lean spell and coalesces a lowercase level-null duplicate", () => {
		const state = newState();
		state.addSpell({name: "Guiding Bolt", source: "XPHB", level: 1, school: "V", alwaysPrepared: true}, true);
		state.addSpell({name: "guiding bolt", source: "xphb", level: null, sourceFeature: "Circle of the Zodiac Spells"});

		const spells = state._data.spellcasting.spellsKnown;
		expect(spells).toHaveLength(1);
		expect(spells[0].name).toBe("Guiding Bolt");
		expect(spells[0].source).toBe("XPHB");
		expect(spells[0].level).toBe(1);
		expect(spells[0].school).toBe("V");
		expect(spells[0].alwaysPrepared).toBe(true);
	});

	it("addSpell keeps genuinely different editions (PHB ≠ XPHB) as separate entries", () => {
		const state = newState();
		state.addSpell({name: "Detect Magic", source: "PHB", level: 1, school: "D"}, false);
		state.addSpell({name: "Detect Magic", source: "XPHB", level: 1, school: "D"}, false);

		const spells = state._data.spellcasting.spellsKnown;
		expect(spells).toHaveLength(2);
		expect(spells.map(s => s.source).sort()).toEqual(["PHB", "XPHB"]);
	});

	it("addInnateSpell enriches, coalesces case-insensitively, and preserves the resource link + uses", () => {
		const state = newState();
		state.addInnateSpell({
			name: "Magic Mouth",
			source: "XPHB",
			level: 2,
			uses: 1,
			recharge: "long",
			sourceFeature: "Some Feat",
			linkedResourceId: "res-123",
		});
		// A lean, differently-cased re-grant must coalesce, not duplicate.
		state.addInnateSpell({name: "magic mouth", source: "xphb", level: null, sourceFeature: "Some Feat"});

		const innate = state._data.spellcasting.innateSpells;
		expect(innate).toHaveLength(1);
		expect(innate[0].school).toBe("I");
		expect(innate[0].linkedResourceId).toBe("res-123");
		expect(innate[0].uses).toEqual({current: 1, max: 1});
	});

	it("re-adding a spent innate spell does NOT restore its used charges", () => {
		const state = newState();
		state.addInnateSpell({name: "Magic Mouth", source: "XPHB", level: 2, uses: 1, sourceFeature: "Some Feat"});
		// Player spends the use.
		state._data.spellcasting.innateSpells[0].uses.current = 0;
		// A re-grant (e.g. reload / re-run of a populate route) must not top the charge back up.
		state.addInnateSpell({name: "magic mouth", source: "xphb", level: 2, uses: 1, sourceFeature: "Some Feat"});

		const innate = state._data.spellcasting.innateSpells.filter(s => s.name.toLowerCase() === "magic mouth");
		expect(innate).toHaveLength(1);
		expect(innate[0].uses).toEqual({current: 0, max: 1});
	});
});

// =========================================================================
// fulfillSpellChoice — Forest Sage "learn two spells" attribution repro
// =========================================================================

describe("fulfillSpellChoice attributes the pick + carries casting ability + enriches", () => {
	it("stamps sourceFeature + spellcastingAbility and fills school for a feat-granted spell pick", () => {
		const state = newState();
		state.addPendingSpellChoice({
			featureName: "Forest Sage",
			featureId: "feat-forest-sage",
			filter: "level=1;2",
			ability: "wis",
			prepared: false,
		});
		const choiceId = state._data.pendingSpellChoices[0].id;
		// Lean pick as it arrives from the spell picker (no school).
		state.fulfillSpellChoice(choiceId, {name: "Vortex Warp", source: "SCC", level: 2});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.name === "Vortex Warp");
		expect(spell).toBeTruthy();
		expect(spell.sourceFeature).toBe("Forest Sage");
		expect(spell.spellcastingAbility).toBe("wis");
		expect(spell.school).toBe("C");
	});
});

// =========================================================================
// populateSubclassSpells — single, enriched subclass grants
// =========================================================================

describe("populateSubclassSpells grants single enriched subclass spells", () => {
	function seedZodiacDruid (state) {
		state._data.classes = [{
			name: "Druid",
			source: "TGTT",
			level: 5,
			subclass: {
				name: "Circle of the Zodiac",
				shortName: "Zodiac",
				source: "TGTT",
				additionalSpells: [{
					known: {3: ["guidance|xphb#c"]},
					prepared: {3: ["guiding bolt|xphb"]},
				}],
			},
		}];
	}

	it("adds Guidance cantrip + Guiding Bolt spell exactly once, each enriched with school", () => {
		const state = newState();
		seedZodiacDruid(state);
		state.populateSubclassSpells();

		const guidance = state._data.spellcasting.cantripsKnown.filter(c => c.name.toLowerCase() === "guidance");
		expect(guidance).toHaveLength(1);
		expect(guidance[0].school).toBe("D");

		const bolt = state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "guiding bolt");
		expect(bolt).toHaveLength(1);
		expect(bolt[0].school).toBe("V");
		expect(bolt[0].level).toBe(1);
		expect(bolt[0].alwaysPrepared).toBe(true);
	});

	it("does not duplicate a pre-existing lowercase copy of the granted spell", () => {
		const state = newState();
		seedZodiacDruid(state);
		// A stale lowercase copy already sits in the arrays (as in older saves).
		state._data.spellcasting.cantripsKnown.push({name: "guidance", source: "xphb", sourceFeature: "Circle of the Zodiac Spells"});
		state._data.spellcasting.spellsKnown.push({name: "guiding bolt", source: "xphb", level: 1, sourceFeature: "Circle of the Zodiac Spells"});

		state.populateSubclassSpells();

		expect(state._data.spellcasting.cantripsKnown.filter(c => c.name.toLowerCase() === "guidance")).toHaveLength(1);
		expect(state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "guiding bolt")).toHaveLength(1);
	});
});

// =========================================================================
// Load migration — Lunaria-like save repair via _migrateSpells
// =========================================================================

describe("_migrateSpells repairs an existing Lunaria-like save", () => {
	function makeLunariaLikeSave () {
		return {
			classes: [
				{name: "Ranger", source: "TGTT-2024", level: 6, subclass: {name: "Hunter", source: "TGTT-2024"}},
				{
					name: "Druid",
					source: "TGTT",
					level: 5,
					subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
				},
			],
			spellcasting: {
				cantripsKnown: [
					{name: "Guidance", source: "PHB", school: "D", sourceFeature: "Circle of the Zodiac Spells"},
					{name: "guidance", source: "xphb", sourceFeature: "Circle of the Zodiac Spells"},
					{name: "Guidance", source: "XPHB", school: "D", grantedByClass: false, sourceFeature: "Circle of the Zodiac Spells"},
				],
				spellsKnown: [
					{name: "Guiding Bolt", source: "PHB", level: 1, school: "V", alwaysPrepared: true, prepared: true, sourceFeature: "Circle of the Zodiac Spells"},
					{name: "guiding bolt", source: "xphb", level: null, alwaysPrepared: true, sourceFeature: "Circle of the Zodiac Spells"},
					{name: "Guiding Bolt", source: "XPHB", level: 1, school: "V", alwaysPrepared: true, grantedByClass: false, sourceFeature: "Circle of the Zodiac Spells"},
					{name: "Mend Plants", source: "HUMBLEWOODTALES", level: 1, sourceFeature: "Plantmender"},
					{name: "Vortex Warp", source: "SCC", level: 2, sourceFeature: null},
					{name: "Magic Mouth", source: "XPHB", level: 2, sourceFeature: null},
					// Edition-exact guard: two genuinely-different-owner editions must both survive.
					{name: "Detect Magic", source: "PHB", level: 1, sourceFeature: "Elf Lineage"},
					{name: "Detect Magic", source: "XPHB", level: 1, sourceFeature: "Wizard Spells"},
				],
				innateSpells: [],
			},
		};
	}

	function loadLunaria () {
		const state = newState();
		state.loadFromJson(makeLunariaLikeSave());
		return state;
	}

	it("collapses triplicated Guidance to ONE enriched cantrip (edition = the 2024 grant)", () => {
		const state = loadLunaria();
		const guidance = state._data.spellcasting.cantripsKnown.filter(c => c.name.toLowerCase() === "guidance");
		expect(guidance).toHaveLength(1);
		expect(guidance[0].source).toBe("XPHB");
		expect(guidance[0].school).toBe("D");
	});

	it("collapses triplicated Guiding Bolt to ONE enriched spell, preserving alwaysPrepared + level", () => {
		const state = loadLunaria();
		const bolt = state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "guiding bolt");
		expect(bolt).toHaveLength(1);
		expect(bolt[0].source).toBe("XPHB");
		expect(bolt[0].school).toBe("V");
		expect(bolt[0].level).toBe(1);
		expect(bolt[0].alwaysPrepared).toBe(true);
	});

	it("enriches the lean feat-granted spells (Mend Plants / Vortex Warp / Magic Mouth) with school", () => {
		const state = loadLunaria();
		const byName = n => state._data.spellcasting.spellsKnown.find(s => s.name.toLowerCase() === n);
		expect(byName("mend plants").school).toBe("T");
		expect(byName("vortex warp").school).toBe("C");
		expect(byName("magic mouth").school).toBe("I");
		// Casting metadata is filled too, not just school.
		expect(byName("magic mouth").castingTime).toBe("1 action");
	});

	it("does NOT collapse genuinely different-owner PHB vs XPHB editions (edition-exact guard)", () => {
		const state = loadLunaria();
		const detect = state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "detect magic");
		expect(detect).toHaveLength(2);
		expect(detect.map(s => s.source).sort()).toEqual(["PHB", "XPHB"]);
	});

	it("is idempotent — a second migration pass changes nothing", () => {
		const state = loadLunaria();
		const before = JSON.stringify(state._data.spellcasting);
		state._migrateSpells();
		const after = JSON.stringify(state._data.spellcasting);
		expect(after).toBe(before);
	});
});

// =========================================================================
// Rubber-duck hardening — prepared preservation, strict-source enrichment,
// and conservative same-grant edition reconciliation
// =========================================================================

describe("prepared flag is preserved through the add routes", () => {
	it("addSpell honours the spell object's own prepared flag when no explicit arg is given", () => {
		const state = newState();
		state.addSpell({name: "Guiding Bolt", source: "XPHB", level: 1, prepared: true});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.name === "Guiding Bolt");
		expect(spell.prepared).toBe(true);
	});

	it("fulfillSpellChoice carries a prepared:true choice onto the stored spell", () => {
		const state = newState();
		state.addPendingSpellChoice({
			featureName: "Some Domain",
			featureId: "feat-some-domain",
			filter: "level=1;2",
			ability: "wis",
			prepared: true,
		});
		const choiceId = state._data.pendingSpellChoices[0].id;
		state.fulfillSpellChoice(choiceId, {name: "Vortex Warp", source: "SCC", level: 2});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.name === "Vortex Warp");
		expect(spell.prepared).toBe(true);
	});
});

describe("strict-source enrichment never stamps a different source's metadata", () => {
	it("leaves an explicit, unresolved homebrew source lean (no wrong-edition school)", () => {
		const state = newState();
		// "Guidance|HB" names a source NOT in the catalog; a name-only match to Guidance|PHB
		// must NOT stamp PHB's school/level onto this homebrew entry.
		state.addCantrip({name: "Guidance", source: "HB", sourceFeature: "Homebrew Feat"});

		const entry = state._data.spellcasting.cantripsKnown.find(c => c.source === "HB");
		expect(entry).toBeTruthy();
		expect(entry.school == null || entry.school === "").toBe(true);
		// Name casing is still canonicalized (safe — same spell name).
		expect(entry.name).toBe("Guidance");
	});

	it("still enriches when the caller supplies NO source (legacy ref)", () => {
		const state = newState();
		state.addSpell({name: "Guiding Bolt", level: 1});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.name === "Guiding Bolt");
		expect(spell.school).toBe("V");
	});

	it("corrects a stale concentration/ritual flag on an exact-source catalog match", () => {
		const state = newState();
		// Magic Mouth (XPHB) is a ritual in the catalog; a stale save-supplied false is fixed.
		state.addSpell({name: "Magic Mouth", source: "XPHB", level: 2, ritual: false, concentration: false});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.name === "Magic Mouth");
		expect(spell.ritual).toBe(true);
	});

	it("does NOT overwrite booleans for an explicit unresolved homebrew source", () => {
		const state = newState();
		// Guidance|HB is not in the catalog; a caller-supplied concentration flag survives.
		state.addSpell({name: "Guidance", source: "HB", level: 3, concentration: true});

		const spell = state._data.spellcasting.spellsKnown.find(s => s.source === "HB");
		expect(spell.concentration).toBe(true);
	});
});

describe("same-grant edition reconciliation is conservative", () => {
	function seedZodiacDruidSave (spellsKnown) {
		return {
			classes: [{
				name: "Druid",
				source: "TGTT",
				level: 5,
				subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
			}],
			spellcasting: {cantripsKnown: [], spellsKnown, innateSpells: []},
		};
	}

	it("does NOT reconcile a feat grant (sourceFeature is not a class/subclass '<X> Spells' owner)", () => {
		const state = newState();
		state.loadFromJson(seedZodiacDruidSave([
			{name: "Guiding Bolt", source: "PHB", level: 1, sourceFeature: "Some Feat"},
			{name: "Guiding Bolt", source: "XPHB", level: 1, sourceFeature: "Some Feat"},
		]));

		// The grant isn't an identifiable class/subclass spell list, so BOTH editions stay.
		const bolt = state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "guiding bolt");
		expect(bolt).toHaveLength(2);
		expect(bolt.map(s => s.source).sort()).toEqual(["PHB", "XPHB"]);
	});

	it("keeps the grant-edition copy and drops only the opposite edition for a real subclass grant", () => {
		const state = newState();
		state.loadFromJson(seedZodiacDruidSave([
			{name: "Guiding Bolt", source: "PHB", level: 1, school: "V", sourceFeature: "Circle of the Zodiac Spells"},
			{name: "Guiding Bolt", source: "XPHB", level: 1, school: "V", sourceFeature: "Circle of the Zodiac Spells"},
		]));

		const bolt = state._data.spellcasting.spellsKnown.filter(s => s.name.toLowerCase() === "guiding bolt");
		expect(bolt).toHaveLength(1);
		expect(bolt[0].source).toBe("XPHB"); // TGTT subclass → 2024 edition wins
	});
});
